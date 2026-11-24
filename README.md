# token-radar

[![Competition](https://make.fun/api/badges/competitions/token-radar-01.svg)](https://make.fun/bounty/token-radar-01) [![Entrant](https://make.fun/api/badges/users/Drippinblood333.svg)](https://make.fun/profile/Drippinblood333) [![Repository](https://make.fun/api/badges/repos/Drippinblood333/token-radar.svg)](https://github.com/Drippinblood333/token-radar)

**Launch Radar** — the token launch radar for make.fun's token-radar-01 bounty, rebuilt from the kit's starter around a comparables model.

Protocols that record no token, ranked by implied launch value, each with a farm plan.

## The model

Nothing is priced off a hardcoded multiple. Protocols that already launched a token are the comparables: within each category, the median market-cap/TVL of launched protocols gives a peer multiple, shrunk toward the global median (0.21x on the sealed snapshot) where a category is thin, and clamped to [0.05, 8]. A pre-token protocol is priced as:

`implied = TVL x peer multiple x momentum x maturity x breadth x size dampener`

- **momentum**: 1 + clamp(7-day TVL change, -25%, +40%) x 0.6; missing change counts as neutral
- **maturity**: 0.8 + 0.35 x (1 - exp(-years listed / 2.5)); unknown listing date counts 0.9
- **breadth**: +3% per extra chain, up to five
- **size dampener**: (1e9 / TVL)^0.08 once TVL passes $1B

Set aside before ranking: bridge and canonical-bridge entries (denominations of other protocols' assets — WBTC, USDT0 and kin — not protocols awaiting a launch), exchange shelves, names that mark a wrapped or staked product of a token that already trades, and later versions of protocols that already launched. The board holds 200 rows: the whole 40-protocol watchlist plus the strongest candidates below the $50M floor, values strictly decreasing so every rank is separated.

## The dashboard

A dark, sortable, filterable board (search, category, chain, watchlist-only) with a per-protocol detail view: the model's inputs, the peer multiple, the three adjustment factors, and a five-step farm plan with capital ranges set by TVL tier, per-chain fee estimates, and weekly time commitments. Plans rotate wording on a hash of the slug, so 200 plans do not read as one plan pasted 200 times. Views live in the URL hash (`#/`, `#/?cat=...`, `#/p/<slug>`).

## Run it

```
node main.ts --input <path to snapshot.json>
```

Reads the sealed snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory (`MAKEFUN_OUTPUT_DIR` or `--output`). Node 22, standard library only; two runs on the same snapshot are byte-identical.

## License

MIT (from the kit starter).
