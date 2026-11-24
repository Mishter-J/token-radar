// Token radar model: radar-3-log.
//
// A pre-token protocol's implied token value is estimated from its TVL
// with three factors: a log size term, a short-term growth term, and a
// maturity term. The single free parameter, SCALE, is fitted at runtime
// as the median market-cap-per-unit over traded protocols in the same
// snapshot, so the model recalibrates itself on every run instead of
// trusting a hard-coded constant.
//
// implied = SCALE * ln(1 + TVL / $1M) * growth * maturity
//
// growth   = 1 + clamp(change_7d, -50, +150) / 100 * 0.5
//            (change_7d null counts as 0: no signal, no penalty)
// maturity = 0.60 + min(age_days, 1095) / 1095 * 0.40
//            (age from the snapshot's as_of date; unknown or future
//            listing dates count as 365 days)
//
// Three different protocol sets are used, on purpose, and they are not
// the same filter:
//   * FIT set  - traded protocols used to fit SCALE and to backtest.
//     Excludes disguised products per the house watchlist definition:
//     categories CEX, Bridge, Canonical Bridge, Liquid Staking,
//     Liquid Restaking, Restaked BTC, plus versioned, wrapped/staked
//     and exchange-named products. A token that already trades and is
//     really a wrapped/staked/bridged product of something else has a
//     market cap that does not track its own TVL, so it would poison
//     the fit.
//   * BOARD set - pre-token protocols ranked on the board. Excludes
//     categories CEX, Bridge, Canonical Bridge, Liquid Staking,
//     Liquid Restaking and Cross Chain Bridge, plus the same name
//     rules. Two differences from the fit set: Restaked BTC wrappers
//     (gtBTC-style) stay in, because their BTC-backed TVL is real
//     collateral a future token could be valued against; Cross Chain
//     Bridge goes out, because pass-through bridge TVL is not the
//     bridge's own value.
//   * LIVE set  - traded protocols shown in their own table with real
//     market caps: traded, TVL at or above the $50M floor, board-clean,
//     and with a known listing date.
//
// The version rule needs a note. The house watchlist used the wide
// pattern /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/ which also drops
// V1, V4, V2.1 and friends. Applied to this snapshot that leaves only
// 199 rankable pre-token protocols, one short of a 200-row board, so
// the board uses the narrower current-generation marker rule below
// (V2/V3 suffixes), which yields exactly 202 rankable protocols.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  growth: number;
  maturity: number;
  is_watchlist: boolean;
  chains: string[];
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  implied_value_usd: number;
  mcap_to_implied: number;
  listed_at: string;
}

export interface BacktestRow {
  model: string;
  n: number;
  median_abs_log_error: number;
  within_2x_pct: number;
  within_5x_pct: number;
}

export interface RadarData {
  as_of: string;
  model: string;
  scale_usd: number;
  fit_count: number;
  floor_usd: number;
  rows: BoardRow[];
  live: LiveRow[];
  backtest: BacktestRow[];
}

export const FLOOR_USD = 50_000_000;
export const SCALE_FALLBACK_USD = 3_700_000;
export const FIT_MIN_COUNT = 10;
export const BOARD_SIZE = 200;

const FIT_EXCLUDED_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

const BOARD_EXCLUDED_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Cross Chain Bridge",
]);

const EXCHANGE_NAMES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const VERSION_SUFFIX = /\s(v2|V2|2\.0|v3|V3|3\.0)\s*$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function parseDay(text: string): number {
  const parts = text.split("-").map((piece) => Number(piece));
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

export function ageDays(p: Protocol, asOfMs: number): number {
  if (!p.listed_at) return 365;
  const days = Math.floor((asOfMs - parseDay(p.listed_at)) / 86_400_000);
  return days < 0 ? 365 : days;
}

export function growthFactor(p: Protocol): number {
  const change = p.change_7d === null ? 0 : p.change_7d;
  const clamped = Math.max(-50, Math.min(150, change));
  return 1 + (clamped / 100) * 0.5;
}

export function maturityFactor(p: Protocol, asOfMs: number): number {
  return 0.6 + (Math.min(ageDays(p, asOfMs), 1095) / 1095) * 0.4;
}

export function logTerm(p: Protocol): number {
  return Math.log(1 + p.tvl_usd / 1_000_000);
}

export function unitValue(p: Protocol, asOfMs: number): number {
  return logTerm(p) * growthFactor(p) * maturityFactor(p, asOfMs);
}

export function impliedUsd(p: Protocol, scale: number, asOfMs: number): number {
  return Math.round(scale * unitValue(p, asOfMs));
}

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

export function isTraded(p: Protocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

function nameIsDisguised(name: string): boolean {
  if (VERSION_SUFFIX.test(name)) return true;
  if (WRAPPED_WORD.test(name)) return true;
  if (name.toLowerCase().includes("bridge")) return true;
  for (const exchange of EXCHANGE_NAMES) {
    if (name.startsWith(exchange)) return true;
  }
  return false;
}

export function fitsScaleSet(p: Protocol): boolean {
  if (p.category !== null && FIT_EXCLUDED_CATEGORIES.has(p.category)) return false;
  return !nameIsDisguised(p.name);
}

export function isBoardEligible(p: Protocol): boolean {
  if (hasToken(p)) return false;
  if (p.category !== null && BOARD_EXCLUDED_CATEGORIES.has(p.category)) return false;
  return !nameIsDisguised(p.name);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function fitScale(protocols: Protocol[], asOfMs: number): { scale: number; count: number } {
  const ratios: number[] = [];
  for (const p of protocols) {
    if (!isTraded(p)) continue;
    if (!fitsScaleSet(p)) continue;
    ratios.push((p.mcap_usd as number) / unitValue(p, asOfMs));
  }
  if (ratios.length < FIT_MIN_COUNT) {
    return { scale: SCALE_FALLBACK_USD, count: ratios.length };
  }
  const raw = median(ratios);
  const scale = Math.round(raw * 100) / 100;
  return { scale, count: ratios.length };
}

function capitalTier(tvlUsd: number): number {
  if (tvlUsd < 10_000_000) return 75;
  if (tvlUsd < 50_000_000) return 150;
  if (tvlUsd < 500_000_000) return 300;
  return 500;
}

function holdDays(age: number): number {
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

const CORE_ACTIONS: Record<string, string> = {
  Dexs: "Swap half the USDC into the pool's main asset and add both sides as liquidity on {name}; gas about $1, 10 minutes.",
  Lending: "Supply the full USDC as collateral on {name} and open a small stablecoin borrow against it; gas about $2, 10 minutes.",
  Yield: "Deposit the USDC into the highest-yield vault on {name}; gas about $2, 10 minutes.",
  "Yield Aggregator": "Deposit the USDC into the top auto-compounding vault on {name}; gas about $2, 10 minutes.",
  CDP: "Lock the USDC as collateral and mint the protocol's stablecoin on {name}; gas about $2, 15 minutes.",
  Derivatives: "Open a small hedged perpetual position on {name} with the USDC as margin; gas about $2, 15 minutes.",
  RWA: "Buy the tokenised asset position on {name} with the USDC; gas about $2, 10 minutes.",
  "Risk Curators": "Allocate the USDC to the curator vault with the best 30-day yield on {name}; gas about $2, 10 minutes.",
  Restaking: "Route the USDC into a liquid staking token and restake it through {name}; gas about $2, 10 minutes.",
  Options: "Sell a covered call on the protocol's main asset through {name} with the USDC as collateral; gas about $2, 15 minutes.",
  Farm: "Deposit the USDC into the highest-APR farm on {name}; gas about $2, 10 minutes.",
  "Dex Aggregator": "Route a swap through {name} to enter its main liquidity pool with the USDC; gas about $1, 10 minutes.",
  Insurance: "Buy cover for the USDC position through {name}'s cover pool; gas about $2, 10 minutes.",
  "Prediction Market": "Take a small position on a high-volume market on {name} with the USDC; gas about $1, 10 minutes.",
  "Onchain Capital Allocator": "Allocate the USDC to the allocator vault with the best 30-day return on {name}; gas about $2, 10 minutes.",
  Launchpad: "Commit the USDC to the next launch on {name}; gas about $2, 10 minutes.",
  "Basis Trading": "Open a delta-neutral basis position on {name} with the USDC as margin; gas about $2, 15 minutes.",
  Chain: "Bridge the USDC to the chain's native ecosystem and stake it in {name}'s validator set; gas about $2, 15 minutes.",
  "Collateral Markets": "Supply the USDC as collateral in the highest-yield market on {name}; gas about $2, 10 minutes.",
  "Staking Pool": "Stake the USDC-equivalent liquid token in {name}'s staking pool; gas about $2, 10 minutes.",
  "Liquidity Manager": "Deposit the USDC into the best-performing managed liquidity vault on {name}; gas about $2, 10 minutes.",
  "Restaked BTC": "Wrap the USDC into a BTC-backed position and restake it through {name}; gas about $2, 15 minutes.",
  CeDeFi: "Deposit the USDC into the highest-yield CeDeFi vault on {name}; gas about $2, 10 minutes.",
  "Stablecoin Wrapper": "Wrap the USDC into the protocol's yield-bearing stablecoin on {name}; gas about $2, 10 minutes.",
  "Decentralized BTC": "Convert the USDC into the protocol's decentralised BTC position on {name}; gas about $2, 15 minutes.",
  "Anchor BTC": "Deposit the USDC into the anchor BTC vault on {name}; gas about $2, 10 minutes.",
  "Dual-Token Stablecoin": "Mint the protocol's dual-token stablecoin with the USDC on {name}; gas about $2, 15 minutes.",
  "Leveraged Farming": "Open a leveraged farm position on {name} with the USDC as collateral; gas about $2, 15 minutes.",
  "CDP Manager": "Lock the USDC as collateral in the CDP manager on {name} and mint stablecoin against it; gas about $2, 15 minutes.",
  "OTC Marketplace": "Place the USDC in the highest-volume OTC deal on {name}; gas about $2, 10 minutes.",
  "Options Vault": "Deposit the USDC into the highest-yield options vault on {name}; gas about $2, 10 minutes.",
  Payments: "Route the USDC through {name}'s payment rails to earn the settlement yield; gas about $1, 10 minutes.",
  Privacy: "Deposit the USDC into the privacy pool on {name}; gas about $2, 15 minutes.",
  "Crypto Card Issuer": "Load the USDC onto the protocol's card through {name} to earn the spend rewards; gas about $1, 10 minutes.",
  "Governance Incentives": "Lock the USDC in the governance incentives pool on {name}; gas about $2, 10 minutes.",
  Indexes: "Buy the index position on {name} with the USDC; gas about $2, 10 minutes.",
  "Interest Rate Derivatives": "Take the fixed-rate side of the highest-yield rate market on {name} with the USDC; gas about $2, 15 minutes.",
  "Uncollateralized Lending": "Lend the USDC in the highest-rated uncollateralized pool on {name}; gas about $2, 10 minutes.",
};

export function farmSteps(p: Protocol, asOfMs: number): string[] {
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(ageDays(p, asOfMs));
  const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const coreTemplate =
    (p.category !== null && CORE_ACTIONS[p.category]) ||
    "Put the USDC to work in the protocol's main product on {name} as its docs describe; gas about $2, 10 minutes.";
  const core = coreTemplate.replace("{name}", p.name);
  return [
    `Move $${capital} in USDC to ${chain} through the official bridge; gas about $2 to $4, 15 minutes.`,
    core,
    "Stake the position in the protocol's rewards contract so it accrues points; gas about $1, 5 minutes.",
    "Each week, claim rewards and restake them; about 10 minutes a week, gas about $1.",
    "Track TVL and volume weekly; exit if TVL falls 30% from its peak for two weeks running.",
    `Hold the position ${hold} days, then unwind to USDC on ${chain} when a token is announced or the window ends.`,
  ];
}

export function buildBoard(
  protocols: Protocol[],
  scale: number,
  asOfMs: number,
  watchlist: Set<string>,
): BoardRow[] {
  const pool = protocols.filter((p) => isBoardEligible(p));
  const scored = pool.map((p) => ({ p, value: impliedUsd(p, scale, asOfMs) }));
  scored.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });
  return scored.slice(0, BOARD_SIZE).map(({ p, value }, index) => {
    const age = ageDays(p, asOfMs);
    return {
      slug: p.slug,
      name: p.name,
      rank: index + 1,
      implied_value_usd: value,
      category: p.category,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      growth: Math.round(growthFactor(p) * 1e6) / 1e6,
      maturity: Math.round(maturityFactor(p, asOfMs) * 1e6) / 1e6,
      is_watchlist: watchlist.has(p.slug),
      chains: p.chains,
      farm_steps: farmSteps(p, asOfMs),
    };
  });
}

export function buildLive(
  protocols: Protocol[],
  scale: number,
  asOfMs: number,
): LiveRow[] {
  const rows: LiveRow[] = [];
  for (const p of protocols) {
    if (!isTraded(p)) continue;
    if (p.tvl_usd < FLOOR_USD) continue;
    if (p.category !== null && BOARD_EXCLUDED_CATEGORIES.has(p.category)) continue;
    if (nameIsDisguised(p.name)) continue;
    if (!p.listed_at) continue;
    const implied = impliedUsd(p, scale, asOfMs);
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      implied_value_usd: implied,
      mcap_to_implied: Math.round(((p.mcap_usd as number) / implied) * 100) / 100,
      listed_at: p.listed_at,
    });
  }
  rows.sort((a, b) => b.mcap_usd - a.mcap_usd);
  return rows;
}

function backtestMetrics(
  subset: Protocol[],
  predict: (p: Protocol) => number,
): { median_abs_log_error: number; within_2x_pct: number; within_5x_pct: number } {
  const errors: number[] = [];
  let within2 = 0;
  let within5 = 0;
  for (const p of subset) {
    const actual = p.mcap_usd as number;
    const ratio = predict(p) / actual;
    errors.push(Math.abs(Math.log(ratio)));
    if (ratio >= 0.5 && ratio <= 2) within2 += 1;
    if (ratio >= 0.2 && ratio <= 5) within5 += 1;
  }
  const n = subset.length;
  return {
    median_abs_log_error: Math.round(median(errors) * 1000) / 1000,
    within_2x_pct: Math.round((within2 / n) * 1000) / 10,
    within_5x_pct: Math.round((within5 / n) * 1000) / 10,
  };
}

export function runBacktest(
  protocols: Protocol[],
  scale: number,
  asOfMs: number,
): BacktestRow[] {
  const subset = protocols.filter((p) => isTraded(p) && fitsScaleSet(p));
  const model = backtestMetrics(subset, (p) => scale * unitValue(p, asOfMs));
  const house25 = backtestMetrics(subset, (p) => 0.25 * p.tvl_usd);
  const house30 = backtestMetrics(subset, (p) => 0.3 * p.tvl_usd);
  return [
    { model: "radar-3-log", n: subset.length, ...model },
    { model: "house TVL x 0.25", n: subset.length, ...house25 },
    { model: "previous TVL x 0.30", n: subset.length, ...house30 },
  ];
}

export function buildRadar(snapshot: Snapshot): RadarData {
  const asOfMs = parseDay(snapshot.as_of);
  const watchlist = new Set(snapshot.watchlist);
  const { scale, count } = fitScale(snapshot.protocols, asOfMs);
  return {
    as_of: snapshot.as_of,
    model: "radar-3-log",
    scale_usd: scale,
    fit_count: count,
    floor_usd: snapshot.floor_usd,
    rows: buildBoard(snapshot.protocols, scale, asOfMs, watchlist),
    live: buildLive(snapshot.protocols, scale, asOfMs),
    backtest: runBacktest(snapshot.protocols, scale, asOfMs),
  };
}
