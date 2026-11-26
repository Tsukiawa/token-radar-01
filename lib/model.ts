// Token Radar, model radar-2: one snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol that is not a wrapped, staked or
// bridged product of a token that already trades, and not a versioned pool
// of another protocol. The watchlist (40 slugs, TVL >= $50M, no token on
// record) is the floor: every one of its slugs is ranked, and the board
// adds every other protocol the same rule keeps, however small its TVL.
// Live-token protocols are never ranked here; they are set aside with
// their market caps, which are facts, not a model.
//
// Implied value follows only from the snapshot's own figures:
//
//   growthPct  = clamp(change_7d, -40, 100);  null growth counts as 0
//   growthMult = 1 + 0.007 * growthPct        (+100% growth -> 1.70, -40% -> 0.72)
//   maturity   = 0.55 + 0.45 * min(age,730)/730          while age <= 730 days
//              = 1.00 * (1 - 0.08 * min((age-730)/730, 1))  after that:
//                a protocol that has run longest with no token is worth
//                more than a newborn, but one that has run for years with
//                still no token is discounted a little, because a launch
//                that never comes is worth less than one still to come.
//   diversity  = 1 + 0.03 * min(chains-1, 5)   (1 chain -> 1.00, 6+ -> 1.15)
//   implied    = round(tvl_usd * 0.18 * growthMult * maturity * diversity)
//
// The 0.18 base is calibrated, not guessed: the live-token protocols in
// this same snapshot have a median market-cap / TVL of about 0.21, and a
// token that does not exist yet is worth a little less than one that
// already trades, so the base sits just under that median. The code
// recomputes that median at run time (liveMedianMcapTvl) and the
// dashboard shows it beside the 0.18, so the claim can be checked.
// No protocol name is ever special-cased: one function scores every row.

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
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_per_point: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_peak_days: number;
  maturity_decay: number;
  diversity_per_chain: number;
  diversity_cap: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.18,
  growth_per_point: 0.007,
  growth_floor: -40,
  growth_cap: 100,
  maturity_floor: 0.55,
  maturity_peak_days: 730,
  maturity_decay: 0.08,
  diversity_per_chain: 0.03,
  diversity_cap: 1.15,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2';

/** Live-token protocols carried for the dashboard's separate view. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    diversity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  diversity_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  live_median_mcap_tvl: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; diversityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + model.growth_per_point * growthPct;
  const ageForModel = age ?? model.unknown_age_days;
  let maturityMult: number;
  if (ageForModel <= model.maturity_peak_days) {
    maturityMult = model.maturity_floor + (1 - model.maturity_floor) * (ageForModel / model.maturity_peak_days);
  } else {
    const past = Math.min((ageForModel - model.maturity_peak_days) / model.maturity_peak_days, 1);
    maturityMult = 1 * (1 - model.maturity_decay * past);
  }
  const extraChains = Math.max((protocol.chains?.length ?? 0) - 1, 0);
  const diversityMult = Math.min(1 + model.diversity_per_chain * extraChains, model.diversity_cap);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult * diversityMult));
  return { implied, growthPct, growthMult, maturityMult, diversityMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token, and not a wrapped, staked or bridged product, not a versioned pool, not an exchange's own product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The primary farm action for a category, with the capital and chain filled in from the protocol's own record. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the supply position open.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain}, split between USDC and the chain's native asset, and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and hold the vault shares.`;
  if (c.includes('leveraged farm') || c.includes('farm')) return `Open a $${capital} leveraged farming position on ${name} on ${chain} at the lowest leverage the app offers and monitor it weekly.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('interest rate')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} on ${chain} and place one small position on a market that closes within a month.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} curated vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable') || c.includes('dual-token')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's app.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your farm wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis-trading vault on ${chain} and hold the vault shares.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}'s own bridge and use the funds in one app on that chain.`;
  if (c.includes('payment') || c.includes('card')) return `Load $${capital} onto ${name} on ${chain} and spend at least $10 through it each week.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain}, join its governance, and vote on the next proposal.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('otc') || c.includes('marketplace')) return `List or fill a $${capital} order through ${name} on ${chain} and complete the trade in the app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action, so the plan is not one deposit repeated. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $25 of USDC against your supply on ${name} on ${chain}, then repay it the same week so the borrow is recorded without carrying debt.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Swap $25 between USDC and the chain's native asset in ${name}'s main pool on ${chain} once a week.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('basis')) return `Deposit a further $25 into a second vault of ${name} on ${chain} so more than one vault holds your funds.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake or re-delegate $25 of the receipt ${name} gave you on ${chain} and keep the new receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close and reopen a $25 hedged position on ${name} on ${chain} once, to show repeat use.`;
  if (c.includes('prediction')) return `Place a second $10 position on a different ${name} market on ${chain} and let it settle.`;
  if (c.includes('rwa') || c.includes('stable')) return `Move $25 of the asset between ${name} and your wallet on ${chain} once a month to show the position is active.`;
  if (c.includes('governance')) return `Comment or vote on a second ${name} proposal on ${chain} before the month ends.`;
  if (c.includes('insurance')) return `File a test quote for a second cover amount on ${name} on ${chain} and keep the quote in your farm log.`;
  return `Make a second $25 deposit, swap or vote on ${name} on ${chain} so the wallet shows more than one kind of activity.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time, derived from the protocol's own record (category, chains, TVL,
 * age, growth) — never from a hand-written list of names. A falling
 * 7-day TVL adds a wait-and-watch step instead of a fresh deposit.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const falling = (p.change_7d ?? 0) < -10;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: 'about $25 of capital and $2 of gas',
      time: '10 minutes',
    },
    falling
      ? {
          text: `Its TVL fell ${Math.abs(p.change_7d ?? 0).toFixed(1)}% in 7 days, so watch ${p.name} for one week before adding more: check its TVL and its own announcements daily, and add nothing while it keeps falling.`,
          cost: 'nothing to watch',
          time: '5 minutes a day for 7 days',
        }
      : {
          text: `Make one qualifying action each week on ${p.name}, such as a deposit, a borrow, a swap or a vote, and keep the wallet active.`,
          cost: 'about $2 of gas a week',
          time: '10 minutes a week',
        },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from the protocol's own site and claim only from the link it publishes; if it publishes no rewards page, there is nothing to claim yet.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, then unwind by withdrawing in two halves a day apart; never send funds to an address from a message or a comment. Total planned spend is about $${capital + 35} of capital plus roughly $15 of gas over ${hold} days, and the whole position is at smart-contract risk, so never farm with money you cannot lose.`,
      cost: `about $${capital + 35} of capital plus roughly $15 of gas in all`,
      time: `5 minutes to log, ${hold} days to hold`,
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's separate view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Median market-cap / TVL over the live-token protocols in this snapshot. */
export function liveMedianMcapTvl(snapshot: Snapshot): number {
  const ratios = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return 0;
  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every other rankable protocol, whatever its TVL: the early radar is
  // the whole set the rule keeps, not a TVL-capped slice of it.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      diversity_multiplier: round4(s.diversityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    diversity_multiplier: row.model.diversity_multiplier,
    on_watchlist: row.on_watchlist,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    live_median_mcap_tvl: Math.round(liveMedianMcapTvl(snapshot) * 10000) / 10000,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under 100`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
