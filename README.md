# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tsukiawa/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tsukiawa/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar — make.fun bounty token-radar-01, $1,325 in USDC. A dashboard ranking pre-token protocols by implied value, with farm plans.

## Model

Implied value is derived only from the snapshot figures, never a hardcoded list of names:

`implied = TVL × 0.18 × growth multiplier × maturity multiplier × chain-diversity multiplier`

- Growth: `1 + 0.007 × clamp(change_7d, -40, 100)`
- Maturity: grows with age with no token up to 730 days, then gently declines
- Diversity: `min(1 + 0.03 × (chains - 1), 1.15)`

The 0.18 base is calibrated against the live-token protocols in the same snapshot, whose median mcap/TVL is 0.2138. Live-token protocols are never ranked; they appear only in a separate "Live token" tab. The board covers all 40 watchlist protocols plus 158 other rankable pre-token protocols, 198 rows in total.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22+ only, standard library only. The program reads the sealed snapshot, writes the ranked board to `/output/board.json`, the dashboard data to `/output/data.js`, copies `dashboard/` and `screenshots/` to `/output`, and writes `/output/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tsukiawa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
