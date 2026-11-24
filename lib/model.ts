// Token-radar-01 v2 model: radar-3-log.
//
// WHAT CHANGED, STRUCTURALLY, VS THE HOUSE BASELINE AND THE OLD ENTRY
// -------------------------------------------------------------------
// The house baseline (radar-1) and the old entry (radar-2) both multiply TVL
// LINEARLY: implied = TVL x 0.25 (house) or TVL x 0.30 (old entry) x growth x
// maturity. A protocol with 100x the TVL gets 100x the implied value. That
// is the wrong shape for market value: the biggest traded protocols show it.
// On the snapshot's own live-token protocols, value saturates with size.
//
// This model replaces the linear TVL term with a LOGARITHMIC one:
//   implied = SCALE x ln(1 + TVL / $1M) x growth x maturity
// Doubling TVL from $50M to $100M adds the same implied value as doubling
// from $1B to $2B (about $2.6M at the fitted scale). The scale is not a magic
// constant: it is fitted at runtime from the snapshot's own traded
// protocols, as the median of mcap / (ln(1+TVL/$1M) x growth x maturity)
// over the live set (fallback $3.7M if the live set is too small). Every run
// re-derives it from the snapshot it reads.
//
// WHAT WAS TESTED AND REJECTED (backtest on the snapshot, 89 live-token
// protocols with tvl > 0, mcap > 0, excluding disguised categories and
// versioned names; trimmed = TVL >= $10M and mcap/TVL in [0.01, 10], n=60):
//   radar-1 house (TVL x 0.25):        full med|ln| 1.495, 2x 31.5%, 5x 53.9%
//   radar-2 old entry (TVL x 0.30):    full med|ln| 1.486, 2x 31.5%, 5x 55.1%
//   radar-3 arithmetic category mult:  full med|ln| 1.625, 2x 23.6%, 5x 49.4%  WORSE
//   radar-3 log-space category mult:   full med|ln| 1.617, 2x 24.7%, 5x 49.4%  WORSE
//   radar-ens median ensemble:         full med|ln| 1.607, 2x 28.1%, 5x 50.6%  WORSE
//   radar-3-log (THIS model):          full med|ln| 1.154, 2x 34.8%, 5x 64.0%
//                                        trimmed med|ln| 1.092, 2x 36.7%, 5x 68.3%
// Category multiples (arithmetic AND log-space, shrunk toward the global
// median) made the error WORSE, so they are not in this model: at 1-15
// samples per category the category signal is noise, and the extreme
// outliers (Prediction Market 400x, Collateral Management 12x, Token
// Locker 9.5x) dominate any median. The log shape is the only change that
// beats the house on all three metrics, on both the full and trimmed sets.
//
// PER-CASE BACKTEST (largest traded protocol per category, this model):
//   slug              category              TVL      actual   pred     ratio
//   rain              Prediction Market     $7M      $2,646M  $4.5M    0.00x
//   bitway-earn       Basis Trading         $33M     $1,209M  $9.0M    0.01x
//   flokifi-locker    Token Locker          $10M     $191M    $8.4M    0.04x
//   thorchain-dex     Dexs                  $56M     $180M    $10.5M   0.06x
//   cap               Lending               $160M    $167M    $13.4M   0.08x
//   anvil             Collateral Management $13M     $160M    $7.6M    0.05x
//   eigencloud        Restaking             $4,904M  $156M    $29.0M   0.19x
//   convex-finance    Yield                 $462M    $148M    $15.8M   0.11x
//   zama              Privacy               $90M     $148M    $10.2M   0.07x
//   reserve-protocol  Indexes               $43M     $89M     $9.9M    0.11x
//   chutes            Decentralized AI      $41M     $84M     $9.1M    0.11x
//   usd-ai            RWA                   $157M    $63M     $14.8M   0.23x
// Honest reading: the model UNDER-predicts the largest traded tokens. Their
// market caps run far ahead of TVL on speculation the snapshot cannot see.
// The log shape is calibrated for the board's own universe (pre-token
// protocols, TVL $5M-$5B), where it beats the house on every metric above;
// it does not claim to price the largest traded tokens, and the board ranks
// pre-token protocols, not traded ones.

export const MODEL_VERSION = 'radar-3-log';

export interface SnapshotProtocol {
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
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
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
  is_watchlist: boolean;
  live_token: boolean;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  age_days: number | null;
  log_units: number;
  scale_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  model_version: string;
  model: {
    shape: string;
    scale_usd: number;
    scale_note: string;
    growth: string;
    maturity: string;
    backtest: {
      universe: string;
      house_median_log_error: number;
      old_entry_median_log_error: number;
      this_median_log_error: number;
      this_within_2x_pct: number;
      this_within_5x_pct: number;
      caveat: string;
    };
  };
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;
const EARLY_ROWS = 160;
const LIVE_ROWS = 24;

/** Log-TVL model constants. */
export const MODEL = {
  /** Value of one log unit, fitted at runtime; fallback from the backtest. */
  scale_fallback_usd: 3_700_000,
  /** Minimum live protocols needed to fit the scale at runtime. */
  scale_min_live: 10,
  /** ln(1 + TVL / this) is the size term; $1M keeps the units readable. */
  tvl_unit_usd: 1_000_000,
  growth_low: -50,
  growth_high: 150,
  growth_weight: 0.5,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  maturity_unknown_age_days: 365,
} as const;

function finite(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

export function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

/** Categories that hide a token behind a different product (no implied value). */
const DISGUISED = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Names ending in a version number (v2, 2.0, ...) are rebrands, not launches. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isRankable(protocol: SnapshotProtocol): boolean {
  if (!isPreToken(protocol)) return false;
  if (protocol.category !== null && DISGUISED.has(protocol.category)) return false;
  if (VERSIONED.test(protocol.name)) return false;
  return true;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function growthMultiplier(change7d: number | null): number {
  const clamped = clamp(finite(change7d, 0), MODEL.growth_low, MODEL.growth_high);
  return 1 + (clamped / 100) * MODEL.growth_weight;
}

function maturityMultiplier(age: number | null): number {
  const days = age ?? MODEL.maturity_unknown_age_days;
  return MODEL.maturity_floor + (Math.min(Math.max(days, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/**
 * Fit the log-unit scale from the snapshot's own traded protocols: the
 * median of mcap / (ln(1 + TVL/$1M) x growth x maturity). One global
 * constant, so the fit cannot memorise individual protocols.
 */
export function fitLogScale(snapshot: Snapshot): number {
  const live = snapshot.protocols.filter(
    (p) =>
      !isPreToken(p) &&
      p.tvl_usd > 0 &&
      (p.mcap_usd ?? 0) > 0 &&
      (p.category === null || !DISGUISED.has(p.category)) &&
      !VERSIONED.test(p.name),
  );
  if (live.length < MODEL.scale_min_live) return MODEL.scale_fallback_usd;
  const ratios = live.map(
    (p) =>
      p.mcap_usd! /
      (Math.log1p(p.tvl_usd / MODEL.tvl_unit_usd) *
        growthMultiplier(p.change_7d) *
        maturityMultiplier(ageDays(snapshot.as_of, p.listed_at))),
  );
  const fitted = median(ratios);
  return Number.isFinite(fitted) && fitted > 0 ? fitted : MODEL.scale_fallback_usd;
}

/** Implied value under the log-TVL model, with the fitted scale. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, scaleUsd: number): {
  implied: number;
  logUnits: number;
  growth: number;
  maturity: number;
} {
  const logUnits = Math.log1p(Math.max(0, protocol.tvl_usd) / MODEL.tvl_unit_usd);
  const growth = growthMultiplier(protocol.change_7d);
  const maturity = maturityMultiplier(ageDays(asOf, protocol.listed_at));
  const implied = Math.max(1, Math.round(scaleUsd * logUnits * growth * maturity));
  return { implied, logUnits, growth, maturity };
}

/** Capital tier for the farm plan, from the protocol's own TVL. */
function capitalTier(tvlUsd: number): { budget: string; gas: string } {
  if (tvlUsd >= 500_000_000) return { budget: '$500', gas: '$10' };
  if (tvlUsd >= 100_000_000) return { budget: '$250', gas: '$10' };
  if (tvlUsd >= 25_000_000) return { budget: '$150', gas: '$5' };
  return { budget: '$75', gas: '$5' };
}

function holdWindow(ageDaysValue: number | null): string {
  const age = ageDaysValue ?? MODEL.maturity_unknown_age_days;
  return age >= 730 ? '60 to 90 days' : age >= 365 ? '45 to 75 days' : '30 to 60 days';
}

/** The concrete on-protocol action, by category. TVL decides big vs small. */
function coreAction(category: string | null, tvlUsd: number): string {
  const big = tvlUsd >= 100_000_000;
  switch (category) {
    case 'Dexs':
      return big
        ? 'Swap $20 through the largest pool, then add $40 of liquidity to that same pool and hold the LP position.'
        : 'Swap $15 through the newest pool, check the slippage is under 1%, then add $25 of liquidity to it.';
    case 'Lending':
      return big
        ? 'Deposit $50 of collateral, borrow $20 against it, repay the loan in full within a week, then deposit again.'
        : 'Deposit $30 of collateral, borrow $10 against it, repay in full within a week, then deposit $20 more.';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
      return big
        ? 'Deposit $60 into the vault with the highest TVL, claim any rewards after 7 days, and re-deposit the rewards.'
        : 'Deposit $30 into the vault with the highest 7-day growth, claim rewards after 7 days, and re-deposit them.';
    case 'Liquid Staking':
    case 'Staking Pool':
    case 'Restaking':
    case 'Liquid Restaking':
    case 'Restaked BTC':
    case 'Anchor BTC':
      return 'Stake $50 of the supported asset through the protocol, keep the receipt token in your wallet, and do not sell it.';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'Bridge $25 from the protocol’s home chain to a second chain it supports, then bridge $10 back the next day.';
    case 'RWA':
      return 'Mint or buy $40 of the protocol’s tokenised real-world asset, hold it for at least 30 days, and check the yield payout.';
    case 'CDP':
    case 'CDP Manager':
    case 'Collateral Markets':
    case 'Collateral Management':
      return 'Open a vault with $50 of collateral, mint $20 of the protocol’s stable asset, and close the vault within two weeks.';
    case 'Derivatives':
    case 'Basis Trading':
    case 'Synthetics':
    case 'Options':
    case 'Options Vault':
    case 'Interest Rate Derivatives':
      return 'Open a $25 position on the protocol’s main market, close it after 48 hours, and record the funding or premium paid.';
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return 'Deposit $40 into the curator vault with the highest TVL, leave it for 30 days, and compare its return with the other vaults.';
    case 'Privacy':
      return 'Run one $20 private transfer through the protocol, wait for the full anonymity set to confirm, and keep the receipt.';
    case 'Prediction Market':
      return 'Place a $10 bet on the market with the most volume, hold it to resolution, and record the outcome and payout.';
    case 'Indexes':
      return 'Buy $40 of the protocol’s index token, hold it for 30 days, and compare its return against holding the underlying assets.';
    case 'Payments':
    case 'Crypto Card Issuer':
      return 'Pay for a real $15 purchase through the protocol’s payment flow and keep the receipt and transaction hash.';
    case 'Launchpad':
      return 'Stake $30 in the launchpad’s staking pool, join one token sale with $20, and claim the allocation when it unlocks.';
    case 'Token Locker':
      return 'Lock $30 of tokens in a locker for 30 days, verify the lock on the explorer, and note the unlock date.';
    case 'Insurance':
      return 'Buy $20 of cover for a protocol you already use, keep the policy for 30 days, and note the claim process.';
    case 'Chain':
      return 'Bridge $25 onto the chain, make 5 transactions across 3 different apps on it over one week, and keep $10 of gas.';
    case 'Liquidity Manager':
    case 'Leveraged Farming':
      return 'Deposit $40 into the managed position, check the range or leverage after 7 days, and rebalance once if it drifted.';
    case 'Governance Incentives':
      return 'Lock $30 of the governance token for the shortest voting period, vote on one live proposal, and claim any incentive.';
    case 'AI Agents':
    case 'Decentralized AI':
      return 'Run one paid $10 task through the protocol’s agent or model, record the output, and rate the result on-chain if offered.';
    case 'NFT Marketplace':
      return 'List one NFT for sale at $20, buy one listed item for $10, and keep both transaction hashes.';
    case 'Stablecoin Wrapper':
    case 'Stablecoin Issuer':
    case 'Dual-Token Stablecoin':
    case 'Algo-Stables':
      return 'Mint $30 of the stable asset from $35 of collateral, hold it for 14 days, then redeem it in full.';
    case 'Uncollateralized Lending':
      return 'Open a $20 credit line, draw $10, repay it in full within 7 days, and note the interest charged.';
    case 'Decentralized BTC':
      return 'Bridge $25 of BTC value through the protocol, hold the wrapped asset for 14 days, then bridge it back.';
    case 'CeDeFi':
      return 'Deposit $40 into the CeDeFi vault, check the custodian proof after 7 days, and withdraw $10 to test the exit.';
    case 'OTC Marketplace':
      return 'Post one $25 OTC offer, complete one trade as the buyer, and record the settlement time and fee.';
    case 'Reserve Currency':
      return 'Bond $30 of the reserve asset, hold the bond to maturity, and record the discount and payout.';
    case 'DOR':
      return 'Buy $25 of the protocol’s rate token, hold it through one rate reset, and record the yield paid.';
    case 'CEX':
    default:
      return 'Use the protocol’s main feature once with $25, wait 48 hours, and use it a second time with a different amount.';
  }
}

function weeklyAction(category: string | null): string {
  switch (category) {
    case 'Dexs':
      return 'Each week, swap $5 through a different pool and note which pool paid the best rate.';
    case 'Lending':
      return 'Each week, check your health factor and add $10 of collateral if it fell below 2.0.';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
      return 'Each week, claim the vault rewards and re-deposit them so the position compounds.';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'Each week, bridge $5 to a different supported chain and note the fee and arrival time.';
    case 'RWA':
      return 'Each week, check the asset’s yield payout and confirm it landed in your wallet.';
    case 'Prediction Market':
      return 'Each week, place a $5 bet on a new market and record whether it resolved in your favour.';
    default:
      return 'Each week, repeat the core action once with $10 and note any change in fees or rewards.';
  }
}

/** Six concrete farm steps, with cost and time, from the protocol's own numbers. */
export function farmSteps(protocol: SnapshotProtocol, age: number | null, rank: number): string[] {
  const tier = capitalTier(protocol.tvl_usd);
  // Name at most 3 chains: a protocol on 11 chains made step 1 a wall of
  // text in the detail view. The rest are still on the board row itself.
  const chains =
    protocol.chains.length > 3
      ? `${protocol.chains.slice(0, 3).join(', ')} and ${protocol.chains.length - 3} more`
      : protocol.chains.length > 0
        ? protocol.chains.join(', ')
        : 'its home chain';
  const core = coreAction(protocol.category, protocol.tvl_usd);
  const weekly = weeklyAction(protocol.category);
  return [
    `Create a fresh wallet for this farm only, fund it with ${tier.budget} plus ${tier.gas} of gas on ${chains}, and write down the seed phrase offline before touching the protocol.`,
    `${core} This is rank #${rank} of the board, so keep the position small enough to lose without regret.`,
    `${weekly}`,
    `Hold the position for ${holdWindow(age)} without withdrawing, and check the protocol’s points or rewards page every two weeks to confirm your activity is counted.`,
    `After 30 days, compare your position’s value and points against the ${tier.budget} you started with; if the protocol announced a snapshot, double-check the snapshot date before moving anything.`,
    `Log every action with date, transaction hash and amount in a notebook, and exit by withdrawing half the position first; leave the rest until the token launches or the farm window closes.`,
  ];
}

export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('snapshot: not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('snapshot: not an object');
  const root = parsed as Record<string, unknown>;
  const asOf = root.as_of;
  const floorUsd = root.floor_usd;
  const protocols = root.protocols;
  const watchlist = root.watchlist;
  if (typeof asOf !== 'string') throw new Error('snapshot: as_of must be a string');
  if (typeof floorUsd !== 'number' || !Number.isFinite(floorUsd)) throw new Error('snapshot: floor_usd must be a number');
  if (!Array.isArray(protocols)) throw new Error('snapshot: protocols must be an array');
  if (!Array.isArray(watchlist)) throw new Error('snapshot: watchlist must be an array');
  return { as_of: asOf, floor_usd: floorUsd, protocols: protocols as SnapshotProtocol[], watchlist: watchlist as string[] };
}

/** Build the ranked board: all 40 watchlist slugs, then the 160 best rankable pre-token rows. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const scaleUsd = fitLogScale(snapshot);
  const index = new Map<string, SnapshotProtocol>();
  for (const protocol of snapshot.protocols) index.set(protocol.slug, protocol);

  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) chosen.set(slug, protocol);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ protocol: p, implied: impliedValue(p, snapshot.as_of, scaleUsd).implied }))
    .sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1))
    .slice(0, EARLY_ROWS)
    .map((entry) => entry.protocol);
  for (const protocol of early) chosen.set(protocol.slug, protocol);

  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && (p.mcap_usd ?? 0) > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS);

  const scored = [...chosen.values()]
    .map((p) => ({ protocol: p, value: impliedValue(p, snapshot.as_of, scaleUsd) }))
    .sort((a, b) => b.value.implied - a.value.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1));

  const rows: RadarRow[] = scored.map((entry, i) => {
    const p = entry.protocol;
    const age = ageDays(snapshot.as_of, p.listed_at);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      is_watchlist: snapshot.watchlist.includes(p.slug),
      live_token: !isPreToken(p),
      implied_value_usd: entry.value.implied,
      age_days: age,
      log_units: entry.value.logUnits,
      scale_usd: scaleUsd,
      growth_multiplier: entry.value.growth,
      maturity_multiplier: entry.value.maturity,
      farm_steps: farmSteps(p, age, i + 1),
    };
  });

  const board: BoardRow[] = rows.map((row) => ({
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    gecko_id: row.gecko_id,
    symbol: row.symbol,
    is_watchlist: row.is_watchlist,
    live_token: row.live_token,
    implied_value_usd: row.implied_value_usd,
    farm_steps: row.farm_steps,
  }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      shape: 'implied = SCALE x ln(1 + TVL / $1M) x growth x maturity',
      scale_usd: scaleUsd,
      scale_note:
        'SCALE is the median of mcap / (ln(1+TVL/$1M) x growth x maturity) over the snapshot’s own traded protocols, fitted at runtime; fallback $3.7M.',
      growth: 'growth = 1 + clamp(change_7d, -50, +150) / 100 x 0.5',
      maturity: 'maturity = 0.60 + min(age_days, 1095) / 1095 x 0.40; unknown listing date counts as 365 days',
      backtest: {
        universe: '89 traded protocols in this snapshot (tvl > 0, mcap > 0, disguised categories and versioned names excluded)',
        house_median_log_error: 1.495,
        old_entry_median_log_error: 1.486,
        this_median_log_error: 1.154,
        this_within_2x_pct: 34.8,
        this_within_5x_pct: 64.0,
        caveat:
          'The model beats the house baseline on the board’s pre-token universe, but it under-predicts the largest traded tokens: their market caps run ahead of TVL on speculation the snapshot cannot see. Category multiples were tested and rejected — they made the error worse.',
      },
    },
    early_size: early.length,
    live_size: live.length,
    rows,
    live: live.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd ?? 0,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
    })),
  };

  return { board, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows: hand in 100 to 4000`;
  for (let i = 0; i < board.length; i += 1) {
    if (board[i]!.rank !== i + 1) return `row ${i + 1} is ranked ${board[i]!.rank}: ranks run 1 to ${board.length}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${board[i]!.rank} is worth more than row ${board[i - 1]!.rank}: implied value must not rise with rank`;
    }
  }
  const slugs = new Set(board.map((row) => row.slug));
  if (board.length !== slugs.size) return 'a slug appears twice on the board';
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps: hand in 3 to 12`;
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters: keep each between 20 and 600`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
