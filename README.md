[![Bounty: $1.325](https://img.shields.io/badge/Bounty-$1.325-blue)](https://make.fun/bounty/token-radar-01)
[![Built for make.fun](https://img.shields.io/badge/Built%20for-make.fun-purple)](https://make.fun)

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mishter-J/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mishter-J/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A radar for pre-token protocols: 200 protocols ranked by the token value
they *would* have, if they launched one tomorrow, plus a concrete farm
plan for each. Built from a single frozen DefiLlama snapshot
(2026-11-14, 758 protocols) — no live data, no network calls at runtime.

## The model — radar-3-log

```
implied = SCALE × ln(1 + TVL / $1M) × growth × maturity
growth   = 1 + clamp(change_7d, -50, +150) / 100 × 0.5
maturity = 0.60 + min(age_days, 1095) / 1095 × 0.40
```

- `SCALE` is **fitted at runtime**, not hard-coded: the median of
  `mcap / (ln(1 + TVL/$1M) × growth × maturity)` over the traded
  protocols in the snapshot. On this snapshot it comes out at
  **$3,672,561** (91 protocols; fallback $3,700,000 if the fit set is
  too small). Re-running on a new snapshot refits it automatically.
- `growth` uses the 7-day TVL change, clamped so a single wild week
  cannot dominate; a missing change counts as 0%.
- `maturity` credits age up to three years; an unknown or future
  listing date counts as 365 days.
- No protocol name is ever special-cased. The model sees numbers only.

## Board composition

200 rows: all 40 watchlist slugs, plus the 160 best other pre-token
protocols by implied value. A protocol is board-eligible when it has
no token (`gecko_id` and `symbol` both null) and is not a disguised
product: categories CEX, Bridge, Canonical Bridge, Liquid Staking,
Liquid Restaking and Cross Chain Bridge are out, as are versioned
names (`… V2` / `… V3` suffixes), wrapped/staked products, bridge-named
products, and products named after an exchange.

Two honest details:

- The 160 non-watchlist rows are **139 below the $50M floor and 21
  above it**. The board ranks by implied value, not by TVL, and 21
  above-floor pre-token protocols (for example the big curator and
  prediction-market venues) outrank the tail of the below-floor set.
  The floor is where the house's own reading started, not where this
  board stops.
- The version rule is deliberately narrower than the house watchlist
  pattern. The wide pattern (`V1`, `V4`, `V2.1`, …) would leave only
  199 rankable pre-token protocols in this snapshot — one short of a
  200-row board — so the board drops only current-generation markers
  (`V2`/`V3`/`2.0`/`3.0` suffixes), which yields exactly 202 rankable
  protocols.

A separate table lists the **24 live-token protocols** at or above the
$50M floor with their real market caps next to the model's implied
value. They are not on the board: their token already exists.

Top of the board on this snapshot: **steakhouse-financial,
$22,970,230**. Last row: **goonfi, $4,167,694**.

## Backtest — traded protocols, same snapshot

Predicted vs actual market cap on the 91 traded protocols the model
was fitted on (the fit set excludes the disguised categories above,
plus Restaked BTC, for the same reason: a wrapped product's market cap
does not track its own TVL).

| Model | n | Median \|ln(pred / actual)\| | Within 2× | Within 5× |
|---|---:|---:|---:|---:|
| radar-3-log | 91 | 1.154 | 35.2% | 63.7% |
| house TVL × 0.25 | 91 | 1.429 | 31.9% | 56.0% |
| previous TVL × 0.30 | 91 | 1.313 | 25.3% | 54.9% |

The model beats both flat TVL multiples on all three measures, and the
dashboard recomputes every row's implied value in the browser and flags
any row that does not match the board.

## Caveat

The model **underestimates the largest live tokens**. Market caps run
ahead of TVL because speculation prices in a future the TVL has not
reached yet — the top traded protocols trade at many times what this
model implies. Treat implied values as a ranking device for
pre-token protocols, not as a price target.

## Farm plans

Every row carries exactly 6 steps: move funds (capital tiered by TVL:
$75 under $10M, $150 under $50M, $300 under $500M, $500 above),
a category-specific core action, staking the position for points, a
weekly claim-and-restake loop, a TVL-drop exit rule, and a hold window
by age (90 days under 180 days old, 60 under a year, 30 otherwise).

## Run it

Requires Node 22, standard library only.

```sh
node main.ts --input /path/to/snapshot.json --output /path/to/out
```

Writes `board.json`, `data.js`, `dashboard/` and `screenshots/` into
the output directory, then `dossier.json` last. Two runs over the same
input are byte-identical: the scale is fitted from the snapshot, ties
break by slug, and nothing stamps a time.

Verified on the frozen 2026-11-14 snapshot (two runs, identical
SHA-256): `board.json` `d369cced…`, `data.js` `f2b76306…`,
`dossier.json` `a80fabaf…` (1,357,212 bytes, under the 1.5 MiB cap).
Screenshots are 1440×1200 JPEG q97 at 334,971 / 365,217 / 304,025
bytes; the dashboard totals 16,639 bytes with no network references.

## Files

- `main.ts` — entry point: read snapshot, write outputs, build dossier
- `lib/model.ts` — the model, the filters, the board, the farm plans
- `dashboard/` — `index.html`, `app.css`, `app.js` (under 64 KB total, no network)
- `screenshots/` — board, detail and filtered views
- `vendor/makefun-board.ts` — house dossier builder (unmodified)
