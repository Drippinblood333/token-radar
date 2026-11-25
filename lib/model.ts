// Launch Radar model for token-radar-01 (Node 22, standard library only).
//
// The model prices a token that does not exist yet from the snapshot's own figures alone.
// Protocols that already launched a token are the comparables: within each category their
// market cap over TVL gives a multiple, and a pre-token protocol is priced as its TVL times
// its category's multiple, shrunk toward the global median so thin categories borrow strength
// from the whole field. Four adjustments, each read off the snapshot, move that base price:
// the last seven days of TVL momentum, the years the protocol has run with no token, the
// number of chains it is live on, and a dampener that stops the largest protocols from being
// priced as if size were free. Nothing is hardcoded by name: move the snapshot and the board
// moves with it.

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

export const MODEL_VERSION = 'launch-radar-3';

/** How many rows the board carries: the whole 40-name watchlist plus the best of the rest. */
export const BOARD_ROWS = 200;

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  s: string; // slug
  n: string; // name
  r: number; // rank
  v: number; // implied value, whole dollars
  t: number; // TVL, whole dollars
  c7: number | null; // TVL change over 7 days, percent
  cat: string | null;
  ch: string[]; // chains
  age: number | null; // days listed, null when the snapshot does not say
  m: number; // category multiple used, rounded to 3dp for display
  cm: number; // raw category median mcap/TVL before shrinkage, unclamped, 6dp
  cn: number; // launched protocols counted in this category
  f: [number, number, number]; // momentum, maturity, breadth factors, 3dp
  w: 0 | 1; // 1 when the protocol is on the snapshot's watchlist
  steps: string[];
}

export interface LiveRow {
  s: string;
  n: string;
  mcap: number;
  t: number;
  m: number; // its own mcap / TVL multiple, 3dp
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  scanned: number;
  watchlist_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
  /** Launched comparables per category (up to 4 each, by market cap): the peer table's other half. */
  catLive: Record<string, LiveRow[]>;
}

/** Days between two YYYY-MM-DD dates, or null when either side is missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Six decimals: the sandbox re-runs the blend from these, so rounding must not move a price. */
const round6 = (x: number): number => Math.round(x * 1_000_000) / 1_000_000;

/**
 * The comparables table: for every category, the median mcap/TVL of its launched protocols,
 * blended with the global median by count so a category with two thin comps does not price
 * a giant off noise. Multiples are clamped to [0.05, 8] — beyond that the ratio is measuring
 * something other than a launch price (a dead token, a custodial balance sheet).
 * `raw` and `counts` are the unshrunk medians and their sample sizes, so the dashboard's
 * model sandbox can re-run the shrinkage with a different blend weight and land on the
 * same numbers the board uses at the default weight of 8.
 */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; global: number; raw: Map<string, number>; counts: Map<string, number> } {
  const launched = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const global = clamp(median(launched.map((p) => p.mcap_usd! / p.tvl_usd)), 0.05, 8);
  const groups = new Map<string, number[]>();
  for (const p of launched) {
    const key = p.category ?? '(none)';
    const list = groups.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    groups.set(key, list);
  }
  const byCategory = new Map<string, number>();
  const raw = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [key, list] of groups) {
    // Raw is the median itself, unclamped: the board clamps only after blending, and the
    // sandbox must be able to repeat that order (a clamped raw median would price
    // Prediction Market at 1.08x instead of the board's 8x). Counts are the sample sizes.
    raw.set(key, median(list));
    counts.set(key, list.length);
    const blended = (list.length * median(list) + 8 * global) / (list.length + 8);
    byCategory.set(key, clamp(blended, 0.05, 8));
  }
  return { byCategory, global, raw, counts };
}

const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_HEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Records no token at all: the snapshot carries neither a gecko id nor a symbol for it. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * A pre-token protocol the radar may rank. Set aside, at every TVL level: bridge and
 * canonical-bridge entries (by the snapshot's own category they are denominations of other
 * protocols' assets moved across chains — WBTC, USDT0 and their kin — not a protocol still
 * to launch), an exchange's own shelf (the CEX category, and any name that opens with an
 * exchange's name), a name that marks the thing as a wrapped or staked product of a token
 * that already trades, and a later version of a protocol that already had its launch.
 * Staking, restaking and other service protocols that record no token and carry no such
 * marker stay in: by the record they are protocols still to launch in their own right.
 */
const ASSET_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'CEX']);
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && ASSET_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_HEAD.test(p.name)) return false;
  return true;
}

export interface Scored {
  protocol: SnapshotProtocol;
  implied: number;
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  age: number | null;
}

/** Price one candidate from the snapshot's figures, as the header comment lays out. */
export function impliedValue(p: SnapshotProtocol, asOf: string, multiples: { byCategory: Map<string, number>; global: number }): Scored {
  const multiple = multiples.byCategory.get(p.category ?? '(none)') ?? multiples.global;
  const momentum = p.change_7d === null ? 1 : 1 + (clamp(p.change_7d, -25, 40) / 100) * 0.6;
  const age = ageDays(asOf, p.listed_at);
  const maturity = age === null ? 0.9 : 0.8 + 0.35 * (1 - Math.exp(-(age / 365) / 2.5));
  const breadth = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const size = p.tvl_usd > 1_000_000_000 ? Math.pow(1_000_000_000 / p.tvl_usd, 0.08) : 1;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth * size));
  return { protocol: p, implied, multiple, momentum, maturity, breadth, age };
}

// ---------------------------------------------------------------------------
// Farm plans. Each plan is five steps written for its protocol: the action, a
// capital range set by the protocol's TVL tier, the fee the first chain charges,
// and the time it takes. Wording rotates on a hash of the slug so two hundred
// plans do not read as one plan pasted two hundred times, but the rotation is
// fixed: the same snapshot always writes the same board.
// ---------------------------------------------------------------------------

function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function money(x: number): string {
  if (x >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(2)}B`;
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(0)}K`;
  return `$${x}`;
}

function capitalRange(tvl: number): string {
  if (tvl >= 500_000_000) return '$5,000-$25,000';
  if (tvl >= 100_000_000) return '$2,000-$10,000';
  if (tvl >= 20_000_000) return '$500-$5,000';
  return '$100-$1,000';
}

function feeNote(chain: string | undefined): string {
  switch (chain) {
    case 'Ethereum':
      return '$5-$25 of gas per transaction on Ethereum mainnet';
    case 'Arbitrum':
    case 'Base':
    case 'Optimism':
    case 'zkSync Era':
    case 'Linea':
    case 'Scroll':
      return '$0.10-$2 of gas per transaction';
    case 'Solana':
      return 'about $0.01-$0.10 of fees per transaction';
    case 'BNB Chain':
    case 'Polygon':
    case 'Avalanche':
      return '$0.10-$1 of fees per transaction';
    default:
      return '$0.50-$5 of fees per transaction';
  }
}

type Family = 'dex' | 'lending' | 'yield' | 'perps' | 'gaming' | 'nft' | 'payments' | 'generic';

function familyOf(category: string | null): Family {
  switch (category) {
    case 'Dexs':
    case 'DEX':
      return 'dex';
    case 'Derivatives':
      return 'perps';
    case 'Lending':
      return 'lending';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Leveraged Farming':
    case 'Farm':
      return 'yield';
    case 'Gaming':
    case 'Games':
      return 'gaming';
    case 'NFT Marketplace':
    case 'NFT Lending':
    case 'NFT':
      return 'nft';
    case 'Payments':
    case 'Payment':
      return 'payments';
    default:
      return 'generic';
  }
}

const OPENERS: Record<Family, string[]> = {
  dex: [
    'Open {name} on {chain} and make your first swap of {cap}: route it through the main pool so the trade counts as real volume, not a wash pair.',
    'Start on {name} ({chain}): connect a wallet you control and swap {cap} through its deepest pool; expect {fee}.',
    'Make {name} your default swap venue on {chain} this week: a first trade of {cap} through the flagship pool, costing {fee}.',
  ],
  lending: [
    'Supply {cap} to {name} on {chain} as your first position: pick the market with the deepest liquidity so you can exit in one transaction; expect {fee}.',
    'Open a lending position on {name} ({chain}): deposit {cap} into its main market and leave it supplied; setup takes about 15 minutes and {fee}.',
    'Start farming {name} by supplying {cap} on {chain}: choose the blue-chip collateral market first, where rates and liquidation rules are clearest.',
  ],
  yield: [
    'Put {cap} into {name}\'s main vault on {chain}: read the strategy the vault runs before depositing, and expect {fee} to enter.',
    'Deposit {cap} into {name} on {chain}: start with its flagship vault rather than the newest one, and note the lock or cooldown before you commit.',
    'Open a {cap} position in {name} ({chain}): the vault does the compounding, your job is choosing the asset you would hold anyway.',
  ],
  perps: [
    'Fund a {name} account on {chain} with {cap} of collateral and place your first small perpetual trade; expect {fee} per order.',
    'Start on {name} ({chain}): deposit {cap}, trade the most liquid perpetual pair first, and keep leverage under 3x while you learn its funding rhythm.',
    'Open {name} on {chain} and trade {cap} of notional in its main market: volume, not profit, is what a future points program would see.',
  ],
  gaming: [
    'Create a {name} account and play its live game on {chain} with {cap} of in-game spend ready; expect {fee} per session transaction.',
    'Start {name} on {chain}: finish its onboarding quests with {cap} set aside for the items or passes the quests require.',
    'Play {name} the way a regular would: {cap} of budget on {chain}, a few sessions a week, rather than one burst on day one.',
  ],
  nft: [
    'Make your first trade on {name} ({chain}) with {cap}: buy or list in a collection with real floor depth, and expect {fee}.',
    'Start on {name}: list or buy one NFT in a liquid collection on {chain} with {cap}, so your wallet carries genuine marketplace history.',
    'Use {name} for the NFT trade you would make anyway: {cap} on {chain}, in collections where bids sit close to the floor.',
  ],
  payments: [
    'Route a real payment of {cap} through {name} on {chain}: use money you were sending anyway, and expect {fee}.',
    'Set up {name} ({chain}) and make it your rail for one recurring payment of {cap} a month; setup takes about 20 minutes.',
    'Start with {name}: hold a {cap} balance on {chain} and pay one real invoice or transfer through it this week.',
  ],
  generic: [
    'Open {name} on {chain} and complete its core action with {cap}: whatever the product does, do that first, properly; expect {fee}.',
    'Start using {name} ({chain}) this week: one real position or action of {cap}, from a wallet you will keep using, costing {fee}.',
    'Make {name} part of your routine on {chain}: a first {cap} position today, set up in about 15 minutes, so the history starts now.',
  ],
};

const WEEKLY: Record<Family, string[]> = {
  dex: [
    'Trade on {name} two or three times a week, $200-$1,000 a trade: steady organic volume over 8-12 weeks reads as a user, not a one-day airdrop sprint.',
    'Add a small liquidity position beside your swaps and rebalance it weekly, about 10 minutes a week, so both sides of the venue see your wallet.',
  ],
  lending: [
    'Keep the position supplied for 8-12 weeks and add on dips: lenders who stay through a full quarter are the ones snapshots of activity tend to catch.',
    'Borrow a small amount against your supply once a month and repay it cleanly: a wallet that has used both sides of {name} carries a fuller record.',
  ],
  yield: [
    'Compound or top up the vault position every two weeks, about 10 minutes each time; a growing balance over 8-12 weeks is the pattern to build.',
    'Hold through at least one full strategy rotation on {name}: vaults reward the wallets still there when a season closes, not the first week\'s tourists.',
  ],
  perps: [
    'Trade {name} on three separate days a week for 8-12 weeks, similar size each time: consistency of days active is cheaper to build than raw size.',
    'Keep a resting position open over weekends and let funding accrue both ways; hedged size still counts as open interest the venue can see.',
  ],
  gaming: [
    'Play three sessions a week for a season (about 8-12 weeks): games reward returning players, and short daily quests compound faster than marathon days.',
    'Enter one competitive or seasonal event a month on {name} and finish it; event completions are the milestones a future token drop would most plausibly count.',
  ],
  nft: [
    'Trade on {name} once a week for 8-12 weeks, rotating collections: twelve weeks of small real trades build more history than one large flip.',
    'Hold at least one NFT from a collection you actually like for a full quarter; holder snapshots are the cheapest criteria a drop can use.',
  ],
  payments: [
    'Send one payment a week through {name} for a full quarter: twelve real transactions beat a single large one for any usage-based accounting.',
    'Keep the balance parked on {name} between payments and top it up monthly; average balance over time is a number a points program can read.',
  ],
  generic: [
    'Use {name} on three separate days a week for 8-12 weeks, 10-15 minutes a session: repeat usage across weeks is the signal worth building.',
    'Do one more of {name}\'s core actions each week than the week before, and keep notes; a rising activity curve looks like adoption, not farming.',
  ],
};

const MILESTONES: string[] = [
  'Watch {name}\'s own channels for a points program, testnet or governance vote and join the first one: early participants in a program are usually counted from its first snapshot, and joining costs under an hour.',
  'If {name} opens a testnet, quests or an ambassador program, complete it in its first two weeks: these lists are the cheapest distribution a launch team will ever have, and they close fast.',
  'Vote in any {name} governance or community poll that appears, even a small one: governance records are public, permanent, and take five minutes to make.',
];

const HOLDS: string[] = [
  'Hold the position for at least one full quarter and review it monthly: if {name}\'s TVL falls by half or its team goes quiet for a month, cut the position — farming never justifies riding a dying protocol down.',
  'Review the position monthly against {name}\'s TVL trend (currently {tvl}, {chg} over the last 7 days): keep farming while the protocol grows, and exit in size if two monthly reviews in a row show decline.',
  'Set a calendar review every month: keep the {name} position only while its TVL and release cadence hold up, and never let it grow past what you would be content to lose entirely.',
];

function fill(template: string, p: SnapshotProtocol): string {
  const chain = p.chains[0] ?? 'its main chain';
  return template
    .replaceAll('{name}', p.name)
    .replaceAll('{chain}', chain)
    .replaceAll('{cap}', capitalRange(p.tvl_usd))
    .replaceAll('{fee}', feeNote(p.chains[0]))
    .replaceAll('{tvl}', money(p.tvl_usd))
    .replaceAll('{chg}', p.change_7d === null ? 'flat' : `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`);
}

/** Five concrete steps for one protocol, fixed for a given snapshot. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const fam = familyOf(p.category);
  const h = slugHash(p.slug);
  const pick = (arr: string[], slot: number): string => arr[(h >> (slot * 3)) % arr.length]!;
  const steps = [
    fill(pick(OPENERS[fam], 0), p),
    fill(pick(WEEKLY[fam], 1), p),
    fill(pick(MILESTONES, 2), p),
    fill(pick(HOLDS, 3), p),
    `Keep records as you go: screenshot your ${p.name} positions monthly and keep the wallet address unchanged, so any future claim or points accounting can find one continuous history instead of fragments.`,
  ];
  return steps.map((s) => (s.length > 600 ? s.slice(0, 597) + '...' : s));
}

/** The board: every rankable candidate priced, the best 200 kept, the watchlist always in. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; scored: Scored[]; multiples: { byCategory: Map<string, number>; global: number; raw: Map<string, number>; counts: Map<string, number> } } {
  const multiples = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const all = snapshot.protocols.filter(isRankable).map((p) => impliedValue(p, snapshot.as_of, multiples));
  const byRank = (a: Scored, b: Scored): number =>
    b.implied - a.implied || b.protocol.tvl_usd - a.protocol.tvl_usd || (a.protocol.slug < b.protocol.slug ? -1 : 1);
  all.sort(byRank);
  const kept = all.slice(0, BOARD_ROWS);
  const keptSlugs = new Set(kept.map((s) => s.protocol.slug));
  for (const s of all) {
    if (watch.has(s.protocol.slug) && !keptSlugs.has(s.protocol.slug)) kept.push(s);
  }
  kept.sort(byRank);
  const trimmed = kept.slice(0, Math.max(BOARD_ROWS, snapshot.watchlist.length));
  // Strictly decreasing values: a ranking that cannot separate two rows has not ranked them.
  let prev = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = trimmed.map((s, i) => {
    const value = Math.max(1, Math.min(s.implied, prev - 1));
    prev = value;
    return { slug: s.protocol.slug, name: s.protocol.name, rank: i + 1, implied_value_usd: value, farm_steps: farmSteps(s.protocol) };
  });
  return { board, scored: trimmed, multiples };
}

/** The twelve largest already-launched protocols, as the board's reference strip. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 12)
    .map((p) => ({ s: p.slug, n: p.name, mcap: p.mcap_usd!, t: p.tvl_usd, m: round3(p.mcap_usd! / p.tvl_usd) }));
}

/**
 * Launched comparables per category, up to four each by market cap: the detail view's
 * peer table shows a protocol next to the launched names its own multiple was read from.
 */
export function categoryLive(snapshot: Snapshot): Record<string, LiveRow[]> {
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? '(none)';
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const out: Record<string, LiveRow[]> = {};
  for (const [key, list] of groups) {
    out[key] = list
      .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
      .slice(0, 4)
      .map((p) => ({ s: p.slug, n: p.name, mcap: p.mcap_usd!, t: p.tvl_usd, m: round3(p.mcap_usd! / p.tvl_usd) }));
  }
  return out;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, scored, multiples } = buildBoard(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows: RadarRow[] = board.map((row, i) => {
    const s = scored[i]!;
    return {
      s: row.slug,
      n: row.name,
      r: row.rank,
      v: row.implied_value_usd,
      t: s.protocol.tvl_usd,
      c7: s.protocol.change_7d,
      cat: s.protocol.category,
      ch: s.protocol.chains,
      age: s.age,
      m: round3(s.multiple),
      cm: round6(multiples.raw.get(s.protocol.category ?? '(none)') ?? multiples.global),
      cn: multiples.counts.get(s.protocol.category ?? '(none)') ?? 0,
      f: [round3(s.momentum), round3(s.maturity), round3(s.breadth)],
      w: watch.has(row.slug) ? 1 : 0,
      steps: row.farm_steps,
    };
  });
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    early_size: board.length,
    live_size: live.length,
    global_multiple: round6(multiples.global),
    rows,
    live,
    catLive: categoryLive(snapshot),
  };
  return { board, radar };
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** The gate's shape, checked before anything is written: null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) {
    if (!known.has(row.slug)) return `row ${row.rank} names a protocol the snapshot does not hold: ${row.slug}`;
    if (row.rank < 1 || !Number.isInteger(row.rank)) return `row for ${row.slug} has a bad rank`;
    if (!(row.implied_value_usd > 0)) return `row for ${row.slug} has a non-positive implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row for ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `a farm step for ${row.slug} is ${len} characters, outside 20..600`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'ranks are not exactly 1..N';
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'implied value rises as rank ascends';
  }
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  return null;
}

/** The dashboard's data, written beside the page as data.js. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
