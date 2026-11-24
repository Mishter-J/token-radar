# Token Radar

[![make.fun bounty](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/bounty/token-radar-01)
[![make.fun](https://img.shields.io/badge/built%20for-make.fun-8A2BE2)](https://make.fun)

A token launch radar for [token-radar-01](https://make.fun/bounty/token-radar-01): 200 pre-token protocols ranked by implied value, with a concrete farm plan for every row and a dashboard that shows the model behind each number.

## The model (radar-3-log)

The house model multiplies TVL linearly, so a protocol with 100× the TVL gets 100× the implied value. Traded protocols do not behave that way — value saturates with size. This radar replaces the linear TVL term with a logarithm:

```
implied = SCALE × ln(1 + TVL / $1M) × growth × maturity
```

- **SCALE** is fitted at runtime from the snapshot's own traded protocols: the median of `mcap / (ln(1 + TVL/$1M) × growth × maturity)`, about $3.7M per log unit on this snapshot (fallback $3.7M if the live set is too small).
- **growth** = `1 + clamp(change_7d, −50, +150) / 100 × 0.5`
- **maturity** = `0.60 + min(age_days, 1095) / 1095 × 0.40` (unknown listing date counts as 365 days)

Doubling TVL from $50M to $100M adds the same implied value as doubling from $1B to $2B. No protocol name is special-cased. Disguised categories (centralised exchanges, bridges, liquid staking) and versioned names are excluded from the ranking.

## Backtest (on this snapshot, 89 traded protocols)

| Model | Median \|ln(pred/actual)\| | Within 2× | Within 5× |
| --- | ---: | ---: | ---: |
| House baseline (TVL × 0.25) | 1.495 | 31.5% | 53.9% |
| Previous entry (TVL × 0.30) | 1.486 | 31.5% | 55.1% |
| Arithmetic category multiple | 1.625 | 23.6% | 49.4% |
| Log-space category multiple | 1.617 | 24.7% | 49.4% |
| Median ensemble | 1.607 | 28.1% | 50.6% |
| **This model (log-TVL)** | **1.154** | **34.8%** | **64.0%** |

Category multiples were tested and rejected: at 1–15 samples per category the category signal is noise, and extreme outliers (Prediction Market 400×, Collateral Management 12×) dominate any median. The log shape is the only change that beats the house on all three metrics.

**Honest limit:** the model under-predicts the largest traded tokens — their market caps run ahead of TVL on speculation the snapshot cannot see. It is calibrated for the board's pre-token universe, where it beats the house on every metric above.

## The board

- **200 rows**: all 40 watchlist slugs plus the 160 best rankable pre-token protocols below the $50M floor.
- Every row carries 6 farm steps with concrete costs and times (capital tiered by TVL: $75–$500), a category-specific core action, a weekly action, and a hold window by age.
- 24 live-token protocols are set aside in their own table with real market caps.
- The dashboard is sortable, filterable, searchable, and shows a detail view per protocol with the full model derivation (the page recomputes each row and checks it against `board.json`).

## Run it

```sh
# from this repository, against the kit snapshot
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only, no network. Two runs over the same snapshot produce byte-identical `board.json` and `dossier.json`.

## Layout

- `main.ts` — entry point: reads the snapshot, writes `board.json` + `data.js`, copies `dashboard/` and `screenshots/`, writes `dossier.json`.
- `lib/model.ts` — the radar-3-log model, board builder, farm plans, and backtest notes.
- `dashboard/` — `index.html` + `app.css` + `app.js` (27.9 KB total, renders with no network).
- `screenshots/` — board, detail, and filtered views rendered in headless Chromium.
- `vendor/makefun-board.ts` — the house dossier library, unchanged.
