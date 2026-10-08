import { tr } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { chain } from "../lib/chain";
import { fmtUsdt } from "../lib/arena";
import { fmtAmount } from "../lib/quotes";
import { burnedUsdt, fmtPrice, fmtTok, tick as tokName, tokensFor } from "../lib/meme";
import type { MemePool } from "../lib/meme";
import { certLabel } from "../lib/board";
import type { Lot } from "../lib/board";
import { bareSym } from "../lib/ticker";
import { memeQa } from "../lib/faq";

/// How the pool line is written. A non-empty `quoteSymbol` means this token's pool is not paired against USDT,
/// so the price is derived in two hops, "token → routing token → USDT" (§71.119). That has to show on screen:
/// without it someone opens the pool, sees a price quoted in a different unit from ours, and concludes our
/// number is wrong.
function poolOf(p: MemePool): string {
  const dex = tr("PancakeSwap {0} pool", p.priceSource === "v3" ? "V3" : "V2");
  return p.quoteSymbol ? tr("{0} · converted to USDT via {1}", dex, p.quoteSymbol) : dex;
}
import type { Tab } from "./Topbar";
import { useView } from "../lib/view";
import { ViewToggle } from "./ViewToggle";
import { ListingForm } from "./ListingForm";
import { Faq } from "./Faq";
import { isDemo } from "../lib/demo";

interface Props {
  /// undefined = the on-chain contract address is not configured yet; [] = configured, but the registry holds no MEME assets
  pools: MemePool[] | undefined;
  /// Bare symbol → number of dividends paid, the same table the staking page uses.
  /// null = the index cannot be fetched at all; an asset missing from the table has never appeared in a dividend
  /// record → both cases print "—" (§25, see the comment on the card)
  dividends: Map<string, number> | null;
  /// The certificate batches in my wallet (site-wide; this page picks out the ones belonging to each burn pool by tickerId)
  lots: Lot[];
  account: Address | null;
  canWrite: boolean;
  busy: number | null;
  /// Burn for n certificates: App's `deposit()` routes `mode === "burn"` to
  /// `BurnCertificate.mint(asset, n, to, maxAssetIn)`, checking the allowance first and approving when short.
  /// The busy id is `pool.id` (= the board id).
  onBurn: (id: number, n: bigint) => void;
  onGo: (t: Tab) => void;
}

type Scope = "live" | "all" | "held";
const SCOPES: [Scope, string][] = [["live", tr("Burnable")], ["all", tr("All")], ["held", tr("My holdings")]];

/// The body of the MEME Lab page (§59, moved onto the real contracts in §71.94 on 2026-09-16): one toolbar,
/// the burn-pool cards, and a closing Q&A; clicking a card opens the drawer that burns tokens for certificates.
///
/// Set by the user on 2026-09-16: for the MEME family, "just take the on-chain swap pool price and work out
/// $10 worth (burn only, they never enter a strategy)". So the price on the card comes from `PriceOracle`
/// reading PancakeSwap (not the Binance price), and there is no "enters the arena" marker anywhere — MEME never
/// goes into a strategy (the back end's `SYMBOL_CLASSES` no longer has a meme class at all).
///
/// 🔴 Token balances in the wallet are never read (§69.16); the certificate counts are certificates we issued
/// ourselves, which is §69.16's existing exception.
/// Unpaused pools come first, and within a group they are ordered by certificates issued, descending.
///
/// 🔴 §71.139 **overturns the §71.134 layout** (user, 2026-09-18: "in the MEME Lab, what is burnable should
/// mainly show which token gets burned, the same as the earlier design — $10 of value = how many coins. Here
/// only show the BNC certificates I hold, and which MEME they came from burning"):
///
/// - the card title goes back to **the token being burned** ($STOCKDOG / КОТ), not the certificate symbol;
/// - the whole "live price, $10 = N coins" block goes **back on the card** (§71.134 had removed it);
/// - the name uBNC appears on this page only in the **"I hold uBNC"** cell, and in the drawer's
///   "Burn for uBNC certificates" and "The uBNC I hold" headings — that is, "how many I have and from which
///   batch" and "what I get for burning". Nowhere else.
///
/// Why that is the right shape: this page is **where you go to burn**, and what you come here to decide is
/// "which one, and how much", so the first thing you see must be the token name and how many coins $10 buys.
/// Every burn hands back the same uBNC, so putting uBNC in the card title makes all seven cards read as one
/// name (which is exactly what the user saw).
/// §71.134's two cells ("how many staked, how many dividends") stay as they are — the user did not mention
/// them this time and did not complain about them.
///
/// 🔴 §71.142 splits this by **tab** (user, 2026-09-19: "under 'I hold', the card's main title should no longer
/// show the original MEME but uBNC, and should not show the MEME price. Show a click-through to staking, or how
/// much has been paid in dividends"):
///
/// | | Burnable / All | I hold |
/// |---|---|---|
/// | main title | the burned MEME (`$STOCKDOG`) | the certificate symbol (`uBNC`) |
/// | MEME live price, `$10 = N coins` | printed | **not printed** |
/// | the big-number cell | the live-price conversion | I hold N certs · from burning $STOCKDOG |
/// | clicking the card | opens the burn drawer | **jumps to My Account** to stake |
/// | the small line at the foot | burn-address balance | stake to share dividends by certificate count |
///
/// The only difference between the two pages is this one `held` flag — do not scatter it, or the next layout
/// change means hunting all over the page again.
export function Meme({ pools, dividends, lots, account, canWrite, busy, onBurn, onGo }: Props) {
  const [scope, setScope] = useState<Scope>("live");
  const [q, setQ] = useState("");
  const [view, setView] = useView();
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  /// How many certificates I hold per pool: the wallet's certificate batches, totalled by tickerId.
  const mineOf = useMemo(() => {
    const m = new Map<number, bigint>();
    for (const l of lots) m.set(l.tickerId, (m.get(l.tickerId) ?? 0n) + l.n);
    return m;
  }, [lots]);
  /// How many I hold in total (counting only the burn pools on this page).
  ///
  /// 🔴 Do not just sum the whole `mineOf` map: `lots` holds the **site-wide** certificate batches (uNVDA and
  /// uAAPL are in there too), and summing it would fold redeemable certificates into "the uBNC I hold".
  /// It has to be read pool by pool out of `pools`.
  const mineTotal = useMemo(
    () => (pools ?? []).reduce((a, p) => a + (mineOf.get(p.id) ?? 0n), 0n),
    [pools, mineOf],
  );
  /// The "I hold" filter has to say which certificate it means (§71.140). Burning any MEME gives back the same
  /// certificate (§71.136), so as long as the whole page uses one symbol, print it on the filter.
  /// 🔴 If it ever stops being one symbol (the contracts allow a certificate per pool), fall back to a plain
  /// "I hold" with no name — never pick one and print it, that would be inventing a name (§25).
  const certSym = useMemo(() => {
    const s = new Set((pools ?? []).map((p) => p.certSymbol));
    return s.size === 1 ? [...s][0] : "";
  }, [pools]);

  const list = useMemo(() => {
    if (!pools) return [];
    const k = q.trim().toLowerCase();
    return pools
      .filter((p) => {
        if (scope === "live" && p.paused) return false;
        if (scope === "held" && (mineOf.get(p.id) ?? 0n) <= 0n) return false;
        // Searching the token's own name (bnc) or the certificate symbol (ubnc) both have to work — the card
        // prints both, so we cannot recognise only one of them
        return !k || p.symbol.toLowerCase().includes(k) || p.certSymbol.toLowerCase().includes(k);
      })
      .sort((a, b) => {
        if (a.paused !== b.paused) return a.paused ? 1 : -1;
        return a.issued === b.issued ? a.symbol.localeCompare(b.symbol) : b.issued > a.issued ? 1 : -1;
      });
  }, [pools, scope, q, mineOf]);

  if (!pools) return <div className="note">{tr("The MEME Lab is unavailable right now. Please try again later.")}</div>;

  /// The small number after each of the three toolbar filters.
  ///
  /// 🔴 §71.140 (user, 2026-09-18: "in the demo data, what I hold should be uBNC certificates, not MEME"):
  /// "I hold" used to print the **number of pools** — swap certificates out of 2 MEMEs and it printed "2".
  /// But the cards on the same page say "I hold 3 uBNC" and "I hold 5 uBNC", 3 + 5 = 8, while the toolbar says 2,
  /// and the only conclusion available is that one of them is wrong.
  /// **What I hold is certificates, and certificates are counted in certs; pools are counted in pools.**
  /// So this cell counts certificates, with the unit spelled out — the word is what shows it is not counting pools.
  /// The first two still count pools (the sentence above already says "7 burn pools", which matches), and they
  /// spell out their unit too so the two can never be confused again.
  const counts: Record<Scope, string> = {
    live: tr("{0} pools", pools.filter((p) => !p.paused).length),
    all: tr("{0} pools", pools.length),
    held: tr("{0} certs", mineTotal.toLocaleString()),
  };
  const totalUsdt = pools.reduce((a, p) => a + burnedUsdt(p), 0n);
  const opened = open !== null ? pools.find((p) => p.id === open) ?? null : null;

  return (
    <div className="pools mk meme">
      <div className="pools-bar">
        <span className="tot">
          {tr("{0} burn pools ·", pools.length)} <b>${fmtUsdt(totalUsdt)}</b> {tr("value burned")}
        </span>
        <div className="mk-scope" role="tablist" aria-label={tr("Scope")}>
          {SCOPES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={scope === k} className={`mk-sc${scope === k ? " on" : ""}`} onClick={() => setScope(k)}>
              {/* "I hold" carries the certificate symbol (§71.140): what you hold is a uBNC certificate, not MEME.
                  `.asis` is not strictly needed right now (`.mk-sc` sets no text-transform), but every symbol read
                  off the chain gets the wrapper, so that whoever adds an uppercase rule here later does not end up
                  printing "UBNC" (the §71.139 rule). */}
              {k === "held" && certSym ? <>{tr("My holdings")} · <span className="asis">{certSym}</span></> : label}
              <small>{counts[k]}</small>
            </button>
          ))}
        </div>
        <input className="pools-q" type="search" placeholder={tr("Search tokens")} aria-label={tr("Search tokens")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="enter mk-sell lf-open" onClick={() => setApplying(true)} title={tr("Apply to have your MEME listed in the Lab")}>{tr("Listing application")}</button>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {pools.length === 0 ? (
        <div className="note">{tr("No burn pools are open.")}</div>
      ) : list.length === 0 ? (
        <div className="note">{scope === "held" ? tr("You hold no MEME burn certificates yet") : tr("No burn pools match")}</div>
      ) : (
        <div className={`pool-grid${view === "rows" ? " rows" : ""}`}>
          {list.map((p) => {
            const mine = mineOf.get(p.id) ?? 0n;
            // The dividend count comes from the same table the staking page uses. Not found means "—",
            // not 0 — see the comment below.
            const drops = dividends?.get(bareSym(p.certSymbol)) ?? null;
            /// 🔴 §71.142: on the "I hold" page the cards switch to the **certificate's point of view** (user,
            /// 2026-09-19: "under 'I hold', the card's main title should no longer show the original MEME but
            /// uBNC, and should not show the MEME price. Show a click-through to staking, or how much has been
            /// paid in dividends").
            /// The first two tabs are **where you go to burn** → the star is the MEME being burned plus
            /// "$10 = how many coins" (§71.139); this tab is where people come **after** they have burned → what
            /// they hold is called uBNC, the MEME's live price no longer feeds any decision they make, and leaving
            /// it there only suggests the certificate's value rises and falls with the MEME (which is false: the
            /// certificate holds no tokens, and dividends go by certificate count).
            const held = scope === "held";
            return (
              <button
                key={p.id}
                className={`pool mk-p st-${p.paused ? "ended" : "live"}`}
                /// 🔴 On this tab the card goes **straight to My Account** rather than opening the burn drawer —
                /// the stake button lives there (from §71.138 only uBNC can be staked), and a card reading
                /// "Stake it →" that opens a "burn for certificates" drawer is simply a lie.
                /// The drawer is not lost: the same pool still opens from the Burnable / All tabs.
                title={held ? tr("Stake these {0} in My Account", p.certSymbol) : undefined}
                onClick={() => (held ? onGo("mine") : setOpen(p.id))}
              >
                <div className="pool-top">
                  {/* On the first two tabs the title is **the token being burned** (§71.139): someone here to burn
                      needs "which one" answered first. This tab is the other way round — the main title is the
                      certificate symbol (§71.142).
                      🔴 `.asis` cannot be dropped: `.pool-top .sym` sets no uppercase today, but ~28 selectors
                      site-wide uppercase small labels, so every name read from an on-chain `symbol()` gets the
                      wrapper and never turns into "UBNC" again (§71.139). */}
                  <span className="sym">{held ? <span className="asis">{p.certSymbol}</span> : tokName(p.symbol)}</span>
                  {/* 🔴 This tab **does not print the MEME's live price** (§71.142). The certificate holds no
                      tokens and cannot be redeemed, so its value has nothing to do with where the MEME goes next;
                      putting the price beside it implies a relationship that does not exist (§25 / §29). */}
                  {held ? null : p.price > 0n
                    ? <span className="px" title={tr("The on-chain pool quote for {0} (in USDT) · price from the {1}", tokName(p.symbol), poolOf(p))}><b>{fmtPrice(p.price)}</b></span>
                    : <span className="px dim" title={tr("No valid on-chain quote can be read right now (price from the {0})", poolOf(p))}>—</span>}
                </div>
                {held ? (
                  /* Replaces the "$10 = how many coins" cell: what this tab has to answer is "how many do I have,
                     and where did they come from".
                     🔴 The "from burning $BNBCAT" line has to stay — the user's own words in §71.139 were "here
                     only show the BNC certificates I hold, and which MEME they came from burning". Without it all
                     seven cards are called uBNC and nothing tells them apart. */
                  <div className="pool-unit pool-face" title={tr("The number of {0} in my wallet that came from burning {1} (staked and listed ones are not counted)", p.certSymbol, tokName(p.symbol))}>
                    <span className="k">{tr("My holdings")}</span>
                    <span className="v">{tr("{0} certs", mine.toLocaleString())}<i>{tr("from burning {0}", tokName(p.symbol))}</i></span>
                    {/* "Dividends go by certificate count" is written on the `.st-line` below, so it is not
                        repeated here — this line only says what the certificate itself is. */}
                    <small className="pool-px">{tr("The certificate holds no tokens and cannot be redeemed")}</small>
                  </div>
                ) : (
                  /* 🔴 The block §71.139 put back: "$10 = how many coins". §71.134 had removed it and the user
                      asked for it back — how many coins one certificate costs is the only real decision on this
                      page, and it should not be visible only inside the drawer (§29).
                      When no price can be read it prints "—", never 0 (§25). */
                  <div className="pool-unit pool-face" title={tr("Converted at the current on-chain quote, for reference only; it is worked out again from the quote at the moment the transaction lands, with 1% tolerance")}>
                    <span className="k">{tr("Live price")}</span>
                    {p.tokensPerCert > 0n
                      ? <span className="v">${fmtUsdt(p.faceValue)} = {fmtAmount(p.tokensPerCert, p.decimals)} {tokName(p.symbol)}</span>
                      : <span className="v dim">—</span>}
                    <small className="pool-px">{tr("${0} burned per certificate", fmtUsdt(p.faceValue))}<span className="pool-liq"> {tr("· price from the {0}", poolOf(p))}</span></small>
                  </div>
                )}
                <div className="st-stats">
                  {!held && <div className="pool-stat"><span className="k">{tr("Issued")}</span><span className={`v${p.issued === 0n ? " zero" : ""}`} title={tr("The total {0} handed out for burning {1} (read from the chain)", p.certSymbol, tokName(p.symbol))}>{p.issued.toLocaleString()}<i>{tr("certs")}</i></span></div>}
                  <div className="pool-stat">
                    {/* 🔴 This cell is how many certificates are locked in the staking contract **site-wide**, not
                        "how many I staked". On the "I hold" tab the cell next to it says "I hold", so without the
                        words "site-wide" this reads as your own position (I staked 0 = I have not staked) — and
                        that is untrue.
                        How many I staked is not available on this page (`lots` only carries unstaked wallet
                        holdings); for that you go to My Account, which is exactly where this card leads. */}
                    <span className="k">{held ? tr("Staked site-wide") : tr("Staked")}</span>
                    <span className={`v${p.pledged === 0n ? " zero" : ""}`} title={tr("Certificates locked in the certificate staking contract site-wide (read from the chain); the fee share goes by certificate count")}>{p.pledged.toLocaleString()}<i>{tr("certs")}</i></span>
                  </div>
                  <div className="pool-stat">
                    <span className="k">{tr("Fee share paid")}</span>
                    {/* 🔴 Not found prints "—", never 0 (§25). The MEME dividend is "take 1%, buy BNC, hand it out by
                        certificate count", and that flow has no readable payout record yet (§71.130). Reading 0
                        out of a table that does not cover the question and printing it means "paid 0 times",
                        which is a made-up number, not an empty one. */}
                    {drops === null
                      ? <span className="v dim" title={tr("The MEME fee share is paid out off chain by the platform, by certificate count; there is no readable payout record yet, so no number is written here")}>—</span>
                      : <span className={`v${drops === 0 ? " zero" : ""}`}>{drops}<i>{drops === 1 ? tr("time") : tr("times")}</i></span>}
                  </div>
                  {/* 🔴 §71.139: the certificate symbol goes in the **unit** — "I hold 3 uBNC" — and together with
                      this card's own token name it reads "the uBNC I got from burning $STOCKDOG, I have 3".
                      From §71.142 this cell only appears on the first two tabs: on "I hold" it is already the star
                      and has moved up into the block above.
                      🔴 It cannot hang off the `.k` label: `.pool-stat .k` is styled `text-transform: uppercase`,
                      which would print "UBNC" — not this certificate's name (the on-chain `symbol()` is uBNC). */}
                  {!held && (
                    <div className="pool-stat">
                      <span className="k">{tr("My holdings")}</span>
                      <span className={`v${mine === 0n ? " zero" : ""}`} title={tr("The number of {0} in my wallet that came from burning {1} (staked and listed ones are not counted)", p.certSymbol, tokName(p.symbol))}>{mine.toLocaleString()}<i>{p.certSymbol}</i></span>
                    </div>
                  )}
                </div>
                {held ? (
                  /* The burn-address balance is a statistic about **this MEME** and has nothing to do with the
                     certificates I am holding — on this tab it becomes "why stake". The sentence matches the one
                     at the foot of the drawer and the one in My Account; it is not a new rule. */
                  <div className="st-line">{tr("Stake them and they receive the fee share by")} <b>{tr("certificate count")}</b>{tr(", regardless of how much was burned or where the MEME price goes")}</div>
                ) : (
                  <div className="st-line" title={tr("The token balance of the burn address (0x…dEaD), including tokens sent there from outside this site")}>
                    {tr("Burn address holds")} <b className={p.burned === 0n ? "zero" : ""}>{fmtTok(p.burned, p.decimals, 0)} {tokName(p.symbol)}</b>
                  </div>
                )}
                <div className="meme-chips">
                  {/* A closed pool (absent from the asset catalog) makes the whole card disappear (§71.136); the
                      "Burning paused" here is the on-chain `mintPaused` — no more burning, but certificates
                      already held are unaffected (§71.137).
                      🔴 On the "I hold" tab the title is uBNC, and a chip reading just "Burnable" would be read as
                      "this certificate can be burned" (certificates cannot be burned — only staked, sold or
                      transferred). So this tab only shows a chip when burning is **paused**, and puts the token
                      name in it — at that point it says something useful: this MEME can no longer be burned. */}
                  {held
                    ? p.paused && <span className="chip dark">{tokName(p.symbol)} {tr("burning paused")}</span>
                    : <span className={`chip ${p.paused ? "dark" : "live"}`}>{p.paused ? tr("Burning paused") : tr("Burnable")}</span>}
                </div>
                <span className="mk-cta">{held ? tr("Stake it →") : p.paused ? tr("View details →") : tr("Burn for a certificate →")}</span>
              </button>
            );
          })}
        </div>
      )}

      <Faq qa={memeQa()} />

      {applying && <ListingForm account={account} demo={isDemo()} onClose={() => setApplying(false)} />}

      {opened && (
        <Drawer
          p={opened} lots={lots.filter((l) => l.tickerId === opened.id)}
          account={account} canWrite={canWrite} busy={busy}
          onBurn={onBurn} onGo={onGo} onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function short(a: Address): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

/// The drawer: four quote cells → burn → the certificates I hold. The burn button spells out how many tokens
/// will go, so it is visible before signing.
function Drawer({ p, lots, account, canWrite, busy, onBurn, onGo, onClose }: {
  p: MemePool; lots: Lot[]; account: Address | null; canWrite: boolean; busy: number | null;
  onBurn: (id: number, n: bigint) => void;
  onGo: (t: Tab) => void; onClose: () => void;
}) {
  const [qty, setQty] = useState("1");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const n = /^\d+$/.test(qty) ? BigInt(qty) : 0n;
  const { need } = tokensFor(p, n);
  const burning = busy === p.id;
  const explorer = chain.blockExplorers?.default.url;
  const mine = lots.reduce((a, l) => a + l.n, 0n);
  // The token balance in the wallet is never read (§69.16): if it is short, the wallet refuses at the signing step
  const canBurn = canWrite && !p.paused && p.tokensPerCert > 0n && n > 0n && busy === null;

  return (
    <div className="ov right" onClick={onClose}>
      <aside className="mk-drawer" role="dialog" aria-modal="true" aria-label={tr("{0} burn pool", p.symbol)} onClick={(e) => e.stopPropagation()}>
        <div className="mk-dh">
          <div className="mk-dt">
            {/* The drawer title matches the card: the token being burned (§71.139). Which certificate you get is
                written on the heading of the "Burn for uBNC certificates" section below — that is where the
                button actually is. */}
            <h3>{tokName(p.symbol)}</h3>
            <div className="mk-dm">
              <span>MEME</span>
              {explorer
                ? <a className="ext" href={`${explorer}/token/${p.token}`} target="_blank" rel="noreferrer" title={tr("BNB Chain token contract {0}", p.token)}>{short(p.token)}</a>
                : <span title={p.token}>{short(p.token)}</span>}
              {explorer
                ? <a className="ext" href={`${explorer}/address/${p.pool}`} target="_blank" rel="noreferrer" title={tr("{0}: {1}", poolOf(p), p.pool)}>{tr("pool")} {short(p.pool)}</a>
                : <span title={p.pool}>{tr("pool")} {short(p.pool)}</span>}
              <span className={`chip ${p.paused ? "dark" : "live"}`}>{p.paused ? tr("Burning paused") : tr("Burnable")}</span>
            </div>
          </div>
          <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
        </div>

        <div className="mk-ds">
          <div><span className="k">{tr("1 cert costs")}</span><span className="v">{p.tokensPerCert > 0n ? fmtTok(p.tokensPerCert, p.decimals, 0) : "—"}<small>{tokName(p.symbol)}</small></span></div>
          <div><span className="k">{tr("Face value")}</span><span className="v">${fmtUsdt(p.faceValue)}<small>{tr("per cert")}</small></span></div>
          <div><span className="k">{tr("On-chain quote")}</span><span className="v">{p.price > 0n ? fmtPrice(p.price) : "—"}<small>{tr("per coin ·")} {poolOf(p)}</small></span></div>
          <div><span className="k">{tr("Issued")}</span><span className="v">{p.issued.toLocaleString()}<small>{tr("certs ·")} {p.pledged.toLocaleString()} {tr("staked ·")} {mine.toLocaleString()} {tr("held by me")}</small></span></div>
        </div>

        {/* ---- Burn ---- */}
        <section className="mk-sec">
          {/* 🔴 Which certificate you get is written on the heading of the section that actually has the button
              (§71.139 / §29).
              `.asis` cannot be dropped: `.mk-sec > .k` is styled `text-transform: uppercase`, and without the
              wrapper it prints "UBNC" — the on-chain `symbol()` is uBNC. */}
          <div className="k">{tr("Burn for")} <span className="asis">{p.certSymbol}</span> {tr("certificates")} <small>{tr("burn address holds")} {fmtTok(p.burned, p.decimals, 0)} {tokName(p.symbol)}</small></div>
          {p.paused ? (
            <div className="mk-empty">{tr("Burning for certificates is paused for this pool; certificates already issued are unaffected.")}</div>
          ) : p.tokensPerCert === 0n ? (
            <div className="mk-empty">{tr("No valid on-chain quote can be read right now (the liquidity is too thin, or the spot price is further from the TWAP than allowed), so burning is unavailable for the moment.")}</div>
          ) : !account ? (
            <div className="mk-empty">{tr("Connect a wallet to burn.")}</div>
          ) : (
            <>
              <div className="mk-buy">
                <label>{tr("Certificates")} <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label={tr("Certificates")} /></label>
                <span className="meme-need">{tr("Costs")} <b>{fmtTok(need, p.decimals, 0)}</b> {tokName(p.symbol)}</span>
                <button className="enter" disabled={!canBurn} onClick={() => onBurn(p.id, n)}
                  title={!canWrite ? tr("Read-only mode") : undefined}>
                  {burning ? tr("Sending…") : n > 0n ? tr("Burn {0} for {1} {2}", fmtTok(need, p.decimals, 0), n, n === 1n ? tr("cert") : tr("certs")) : tr("Burn")}
                </button>
              </div>
              <small className="mk-note">
                {tr("The number of tokens required is set by the on-chain quote at the moment the transaction executes, with 1% tolerance; beyond that the transaction fails. Burning cannot be undone, and the certificate cannot be redeemed for the original tokens. If your allowance is short you have to approve first, so make sure your wallet holds enough tokens and enough for the network fee.")}
              </small>
            </>
          )}
        </section>

        {/* ---- My certificates ---- */}
        <section className="mk-sec">
          {/* As above: `.asis` keeps uBNC's capitalisation */}
          {/* The translated heading keeps the certificate symbol's original capitalisation. */}
          <div className="k">{tr("My holdings in||before a held cert symbol")} <span className="asis">{p.certSymbol}</span> <small>{tr("batches that came from burning {0}", tokName(p.symbol))}</small></div>
          {!account ? (
            <div className="mk-empty">{tr("Connect a wallet to see them.")}</div>
          ) : lots.length === 0 ? (
            <div className="mk-empty">{tr("You do not hold any certificates from burning")} {tokName(p.symbol)} {tr("yet.")}</div>
          ) : (
            <div className="meme-mine">
              {lots.map((l) => (
                <div key={`${l.cert}-${l.batchId}`}>
                  {/* The whole batch label is read from the chain (uBNC #3), and `.meme-mine .k` uppercases too.
                      🔴 `.asis` has to go on the inner element: put it on the same element as `.k` and it loses on
                      specificity. */}
                  <span className="k"><span className="asis">{certLabel(p.certSymbol, l.batchId)}</span></span>
                  <b>{l.n.toLocaleString()} {l.n === 1n ? tr("cert") : tr("certs")}</b>
                </div>
              ))}
            </div>
          )}
          <small className="mk-note">
            {tr("The fee share is paid out by the platform, weighted by")} <b>{tr("certificate count")}</b>{tr(", regardless of how much was burned or where the MEME price goes; there is no on-chain claim to make. Your full holdings are listed here:")} <button className="link" onClick={() => onGo("mine")}>{tr("My Account")}</button>.
          </small>
        </section>
      </aside>
    </div>
  );
}
