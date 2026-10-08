# claude-code-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview.md), one folder per mod. Needs Claude Code 2.1.287 or newer.

| Mod | What it does |
| --- | --- |
| [usage-band](usage-band) | A band above the prompt showing context fill, tokens, cost and rate limits in Claude Code's own colours |

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install usage-band --marketplace WeaponizedLego/claude-code-mods
```

Answer `y` to add the marketplace, then pick the user scope. Or from a shell:

```bash
claude plugin marketplace add WeaponizedLego/claude-code-mods
claude plugin install usage-band@claude-code-mods
```

Update later with `claude plugin marketplace update claude-code-mods`, then `claude plugin update usage-band@claude-code-mods`.

## Adding a mod

Put it in its own folder (`<mod>/.claude-plugin/plugin.json`, `<mod>/hooks/...`) and add an entry to `.claude-plugin/marketplace.json`. Check it with `claude plugin validate .`.
