import { atom, read, update } from 'claude-code'
import type { Color, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Snapshot, Tokens } from '../types'
import { C, LIMIT_NAMES, TILE_H, bandSvg, compact, dollars, level } from './look'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, { input: 0, output: 0, cacheRead: 0 })

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0 }
const BAR_CELLS = 10
// Rounded cells, as the desktop's pills: the filled part in the level colour.
const FILLED = '▰'
const TRACK = '▱'
// Roughly one cell of the desktop's code font, in CSS pixels.
const CELL_PX = 8

type Figures = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

const toSnapshot = ({ context, rateLimits, cost }: Figures): Snapshot => ({
  contextTokens: context.tokens ?? null,
  window: context.window,
  percent: context.percent ?? null,
  costUsd: cost?.usd ?? null,
  limits: rateLimits.map(({ kind, percentUsed }) => ({ kind, percentUsed })),
})

// One run of text in one colour: the band is laid out from these so its width
// can be counted before it is drawn.
type Run = { text: string; color?: Color; bold?: boolean }
type Segment = { runs: Run[]; priority: number }

const width = (runs: Run[]) => runs.reduce((sum, r) => sum + r.text.length, 0)

function segments(snap: Snapshot | null, used: Tokens): Segment[] {
  const out: Segment[] = []

  const percent = snap?.percent
  if (percent == null) {
    out.push({ priority: 0, runs: [{ text: 'context ', color: C.muted }, { text: 'waiting for first reply', color: C.dim }] })
  } else {
    const filled = Math.min(BAR_CELLS, Math.round(percent / (100 / BAR_CELLS)))
    out.push({
      priority: 0,
      runs: [
        { text: 'context ', color: C.muted },
        { text: FILLED.repeat(filled), color: level(percent) },
        { text: TRACK.repeat(BAR_CELLS - filled), color: C.track },
        { text: ` ${percent}%`, color: level(percent), bold: true },
      ],
    })
    if (snap?.contextTokens != null) {
      out.push({ priority: 3, runs: [{ text: ` ${compact(snap.contextTokens)}/${compact(snap.window)}`, color: C.muted }] })
    }
  }

  if (snap?.costUsd != null) {
    out.push({ priority: 1, runs: [{ text: dollars(snap.costUsd), color: C.text, bold: true }] })
  }

  if (used.input + used.output > 0) {
    out.push({
      priority: 2,
      runs: [
        { text: '↑', color: C.glow },
        { text: `${compact(used.input)} `, color: C.soft },
        { text: '↓', color: C.accent },
        { text: compact(used.output), color: C.text, bold: true },
      ],
    })
    if (used.cacheRead > 0) {
      out.push({ priority: 5, runs: [{ text: `cached ${compact(used.cacheRead)}`, color: C.dim }] })
    }
  }

  for (const limit of snap?.limits ?? []) {
    out.push({
      priority: 4,
      runs: [
        { text: `${LIMIT_NAMES[limit.kind] ?? limit.kind} `, color: C.muted },
        { text: `${Math.round(limit.percentUsed)}%`, color: level(limit.percentUsed), bold: true },
      ],
    })
  }

  return out
}

const SEPARATOR: Run = { text: ' · ', color: C.dim }
const MARK: Run = { text: '✻ ', color: C.accent }

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

    const snap = await read($, snapshot)
    const used = await read($, tokens)

    // Where the surface draws images and the band has the rows, a strip of stat tiles.
    if (e.surface !== 'terminal' && e.props.maxRows >= 3) {
      const { Box, Svg } = $.ui.resolve(e)
      const strip = bandSvg(snap, used, e.props.bodyColumns * CELL_PX)
      return (
        <Box flexDirection="row" key="usage-band">
          <Svg source={strip.source} alt={strip.alt} width={strip.width} height={TILE_H} />
        </Box>
      )
    }

    const runs = fit(segments(snap, used), e.props.bodyColumns)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" key="usage-band">
        {runs.map(r => (
          <Text color={r.color} bold={r.bold}>
            {r.text}
          </Text>
        ))}
      </Box>
    )
  })
}
