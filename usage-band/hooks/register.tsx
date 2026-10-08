import { atom, read, update } from 'claude-code'
import type { Color, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Snapshot, Tokens } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, { input: 0, output: 0, cacheRead: 0 })

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0 }
const BAR_CELLS = 10
// Full-height blocks: the filled part in the level colour, the track in subtle.
const BAR_GLYPH = '█'
const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

type Figures = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

const toSnapshot = ({ context, rateLimits, cost }: Figures): Snapshot => ({
  contextTokens: context.tokens ?? null,
  window: context.window,
  percent: context.percent ?? null,
  costUsd: cost?.usd ?? null,
  limits: rateLimits.map(({ kind, percentUsed }) => ({ kind, percentUsed })),
})

// Green while there is room, orange from 70%, red past 80%. Green and red are
// the theme keys Claude Code paints its own success and error rows with; the
// theme's `warning` is amber, so orange is xterm's 208, which any terminal
// that has 256 colours draws exactly.
const ORANGE = '#ff8700'
const level = (percent: number): Color => (percent > 80 ? 'error' : percent >= 70 ? ORANGE : 'success')

const compact = (n: number): string => {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

const dollars = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

// One run of text in one colour: the band is laid out from these so its width
// can be counted before it is drawn.
type Run = { text: string; color?: Color; bold?: boolean; bar?: 'filled' | 'track' }
type Segment = { runs: Run[]; priority: number }

const width = (runs: Run[]) => runs.reduce((sum, r) => sum + r.text.length, 0)

function segments(snap: Snapshot | null, used: Tokens): Segment[] {
  const out: Segment[] = []

  const percent = snap?.percent
  if (percent == null) {
    out.push({ priority: 0, runs: [{ text: 'context ', color: 'inactive' }, { text: 'waiting for first reply', color: 'subtle' }] })
  } else {
    const filled = Math.min(BAR_CELLS, Math.round(percent / (100 / BAR_CELLS)))
    out.push({
      priority: 0,
      runs: [
        { text: 'context ', color: 'inactive' },
        { text: BAR_GLYPH.repeat(filled), color: level(percent), bar: 'filled' },
        { text: BAR_GLYPH.repeat(BAR_CELLS - filled), color: 'subtle', bar: 'track' },
        { text: ` ${percent}%`, color: level(percent), bold: true },
      ],
    })
    if (snap?.contextTokens != null) {
      out.push({ priority: 3, runs: [{ text: ` ${compact(snap.contextTokens)}/${compact(snap.window)}`, color: 'inactive' }] })
    }
  }

  if (snap?.costUsd != null) {
    out.push({ priority: 1, runs: [{ text: dollars(snap.costUsd), color: 'claude', bold: true }] })
  }

  if (used.input + used.output > 0) {
    out.push({
      priority: 2,
      runs: [
        { text: '↑', color: 'suggestion' },
        { text: `${compact(used.input)} `, color: 'text' },
        { text: '↓', color: 'claude' },
        { text: compact(used.output), color: 'text' },
      ],
    })
    if (used.cacheRead > 0) {
      out.push({ priority: 5, runs: [{ text: `cached ${compact(used.cacheRead)}`, color: 'subtle' }] })
    }
  }

  for (const limit of snap?.limits ?? []) {
    out.push({
      priority: 4,
      runs: [
        { text: `${LIMIT_NAMES[limit.kind] ?? limit.kind} `, color: 'inactive' },
        { text: `${Math.round(limit.percentUsed)}%`, color: level(limit.percentUsed) },
      ],
    })
  }

  return out
}

// On the desktop the bar is a row of rounded pills drawn as an SVG. An SVG is
// drawn as an image, so it takes real colours, not theme keys: these are the
// ones the desktop's dark theme paints the same keys with.
const PILL_COLOURS: Record<string, string> = { success: '#0ca30c', error: '#e5484d', subtle: '#898781' }
const PILL_W = 12
const PILL_H = 8
const PILL_GAP = 3
const PILL_ROW_WIDTH = BAR_CELLS * (PILL_W + PILL_GAP) - PILL_GAP
const PILL_EXTRA_CELLS = 8

function pills(filled: number, track: number, color: Color | undefined): string {
  const fill = PILL_COLOURS[color ?? ''] ?? color ?? PILL_COLOURS.success
  const rects = Array.from({ length: filled + track }, (_, i) =>
    `<rect x="${i * (PILL_W + PILL_GAP)}" y="0" width="${PILL_W}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${i < filled ? fill : PILL_COLOURS.subtle}"/>`,
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PILL_ROW_WIDTH}" height="${PILL_H}" viewBox="0 0 ${PILL_ROW_WIDTH} ${PILL_H}">${rects}</svg>`
}

const SEPARATOR: Run = { text: ' · ', color: 'subtle' }
const MARK: Run = { text: '✻ ', color: 'claude' }

// Drops the least important segments until the row fits, keeping the order.
function fit(all: Segment[], columns: number): Run[] {
  let kept = all
  const total = (s: Segment[]) => width([MARK]) + s.reduce((sum, seg) => sum + width(seg.runs), 0) + width([SEPARATOR]) * Math.max(0, s.length - 1)

  while (kept.length > 1 && total(kept) > columns) {
    const worst = Math.max(...kept.map(s => s.priority))
    const at = kept.map(s => s.priority).lastIndexOf(worst)
    kept = kept.filter((_, i) => i !== at)
  }

  const runs: Run[] = [MARK]
  kept.forEach((seg, i) => {
    // The context tokens ride right after the bar, without a separator.
    if (i > 0 && !(seg.priority === 3 && kept[i - 1]?.priority === 0)) runs.push(SEPARATOR)
    runs.push(...seg.runs)
  })
  return runs
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Fill the band before the first turn: the window size and, on a resumed
    // session, what it has cost so far.
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    // Main-thread turns only: a subagent's tokens show up in the cost, not here.
    if (usage && !e.agentId) {
      await update($, tokens, t => ({
        input: t.input + usage.input_tokens + usage.cache_creation_input_tokens,
        output: t.output + usage.output_tokens,
        cacheRead: t.cacheRead + usage.cache_read_input_tokens,
      }))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, tokens, () => ZERO)
      await update($, snapshot, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : null
    // The pills are wider than the ten cells the text bar takes.
    const columns = e.props.bodyColumns - (Svg ? PILL_EXTRA_CELLS : 0)
    const runs = fit(segments(await read($, snapshot), await read($, tokens)), columns)
    const { Box, Text } = $.ui.resolve(e)

    const children = runs.flatMap((r, i) => {
      if (Svg && r.bar === 'track') return []
      if (Svg && r.bar === 'filled') {
        const track = runs[i + 1]?.bar === 'track' ? (runs[i + 1]?.text.length ?? 0) : 0
        return [<Svg source={pills(r.text.length, track, r.color)} alt={`${r.text.length} of ${r.text.length + track} context pills filled`} width={PILL_ROW_WIDTH} height={PILL_H} />]
      }
      return [
        <Text color={r.color} bold={r.bold}>
          {r.text}
        </Text>,
      ]
    })

    return (
      <Box flexDirection="row" alignItems="center" key="usage-band">
        {children}
      </Box>
    )
  })
}
