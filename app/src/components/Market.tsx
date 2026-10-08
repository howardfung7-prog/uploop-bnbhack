import { tr } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { Holding, Lot, Pick, Ticker } from "../lib/board";
import { burnFrom, certLabel, certName, fmtBurned, fmtCert, lotKey, pickN } from "../lib/board";
import { fmtUsdt, fmtUsdtExact, parseUsdt } from "../lib/arena";
import { costOf, fmtBps } from "../lib/market";
import type { Floor, Listing } from "../lib/market";
import type { Quote, Quotes } from "../lib/quotes";
import { fmtUsd, quoteOf, unitValue } from "../lib/quotes";
import { marketQa } from "../lib/faq";
import { CLASS_LABEL } from "../lib/ticker";
import { useView } from "../lib/view";
import { ViewToggle } from "./ViewToggle";
import { Faq } from "./Faq";
import type { Tab } from "./Topbar";

/// Certificate market (DECISIONS.md §41 → the §55 minimal version, reworked around batches + certificate
/// counts in §71.80): one tagline, one toolbar, the pool cards, and a closing Q&A.
/// The cards reuse the §53 `.pool` style — symbol, lowest ask, how much each certificate in the floor batch
/// holds, how many are staked, how many you hold; clicking a card opens the right-hand drawer
/// (order book / buy / sell / cancel). The toolbar always carries "Sell certificates", which opens the sell
/// drawer: tick the batches, enter the counts, price each batch, list.
///
/// 🔴 §71.80: the number is a **batch** — one deposit = one number, and every certificate in a batch is
/// identical (it holds the same amount of the token); different batches hold different amounts.
/// One listing = N certificates from the same batch at one unit price, and **partial fills are supported**
/// (the buyer types how many they want).
/// A batch number is unique inside a single certificate contract but repeats across contracts (user, 2026-09-15),
/// so the interface always prints "asset + #batch" as a pair (`certLabel`); a bare number is never allowed anywhere.
/// §69.16, narrow relaxation: we may list **the asset certificates you hold yourself** (you cannot pick which
/// batch to sell without first knowing which batches you have); the USDT / asset-token / MEME-token balances
/// sitting in your wallet are still never read.
///
/// Only the lowest ask and the live listings are shown — no trade history, no average price, no chart
/// (§33: the chain keeps no history, so the interface does not invent one).
/// "Value" is the live Binance price × the tokens each certificate in that batch actually holds (§71.26, the
/// price comes from Binance only) — not a historical price, and certainly not a valuation.
/// Every number comes from the chain: listings and the floor from `CertificateMarket.listing`, the fee from
/// `feeBps`, the issued and staked counts from the `AssetRegistry` side.
/// Market not configured (listings === undefined) → the whole page shows one "unavailable" line and guesses nothing.

type Scope = "listed" | "all" | "held" | "mine";

export interface MarketProps {
  board: Ticker[];
  holdings: Holding[];
  /// Certificates in the wallet that are neither staked nor listed, grouped by batch (§71.80 / the §69.16
  /// relaxation): selling means ticking which batches, and how many of each.
  lots: Lot[];
  /// Symbol → live Binance quote (§71.26): used to work out "what is one certificate worth right now".
  quotes: Quotes;
  account: Address | null;
  canWrite: boolean;
  busy: number | null;
  /// undefined = the market is not configured. All live listings site-wide (already sorted by unit price, ascending).
  listings?: Listing[];
  /// The lowest ask per asset; assets with no listing are absent from the map.
  floors: Map<number, Floor>;
  /// On-chain feeBps; null = not read yet, in which case the copy does not name a percentage.
  feeBps: number | null;
  /// Buy n certificates from one listing. n ≤ listing.remaining.
  onBuy: (tickerId: number, listing: Listing, n: bigint) => void;
  /// List one or several batches at once, each with its own price (the contract's `list`). The two arrays are the same length.
  onList: (tickerId: number, picks: Pick[], prices: bigint[]) => void;
  onCancel: (listingId: bigint) => void;
  onGo: (t: Tab) => void;
}

const SCOPES: [Scope, string][] = [["listed", tr("Listed")], ["all", tr("All")], ["held", tr("My holdings")], ["mine", tr("My listings")]];

/// "1 cert" / "3 certs" — certificate counts are everywhere on this page and English needs the
/// singular. Chinese has no plural and uses one measure word for both, which is why the whole
/// phrase goes through the catalogue instead of picking a suffix here.
function certs(n: bigint): string {
  return n === 1n ? tr("{0} cert", n.toString()) : tr("{0} certs", n.toString());
}

/// "1 batch" / "2 batches" — same story as certs() above.
function batches(n: number): string {
  return n === 1 ? tr("{0} batch", String(n)) : tr("{0} batches", String(n));
}

// ---------------------------------------------------------------- what to call the two families (§71.138)
//
// 🔴 From §71.138 on this page carries both families at once: **redeemable** certificates (uNVDA, tokens locked
// up and redeemable) and **burn** certificates (uBNC, the tokens are already in the burn address and nothing can
// be redeemed) — user, 2026-09-18: "the certificate market has to recognise burn certificates and let them trade".
// On this page the two families differ in exactly two things: what they are called, and how their value is worked
// out. The five functions below are the only exit for those two things — no component may write `t.symbol`,
// `CLASS_LABEL[t.cls]` or `certValue(...)` itself, because that is how "uSTOCKDOG", "Stock" and
// "≈ $9.87 redeemable" — three things that do not exist — find their way back onto the page (§29).

/// What this card / row is called: burn certificates use the **certificate contract's own** symbol (uBNC),
/// redeemable ones use the asset's (uNVDA).
function nameOf(t: Ticker): string {
  return certName(t);
}

/// The line under the name: burn certificates read "From burning $BNBCAT" (twelve MEMEs, twelve cards, all named
/// uBNC — without this line you cannot tell them apart); redeemable ones read the asset class.
function subOf(t: Ticker): string {
  return t.mode === "burn" ? burnFrom(t) : CLASS_LABEL[t.cls];
}

/// "Backing per cert" / "Burned per cert": for burn certificates those tokens went to the burn address the moment
/// the certificate was minted, and the word "backing" would suggest the certificate is still attached to them and
/// could be swapped back (§29). The number itself is real (`assetPerCert`, fixed at mint time).
function perLabel(t: Ticker): string {
  return t.mode === "burn" ? tr("Burn amount per certificate") : tr("Backing per cert");
}

/// The amount in that cell: burn certificates count MEME, which carries a `$` site-wide (`$BNBCAT`); redeemable
/// ones count bStock tokens, which never carry one (`AAPLB`).
/// Without this single exit the same sentence prints "10,000 $BNBCAT" in the MEME Lab and "10,000 BNBCAT"
/// here (§71.139).
function amtOf(t: Ticker, amount: bigint): string {
  return t.mode === "burn" ? fmtBurned(t, amount) : fmtCert(t, amount);
}

/// 🔴 Burn certificates never get an "≈ $x" value. That number means "how much you would get back if you
/// redeemed right now", and this certificate redeems for nothing — putting a Binance-derived figure next to it
/// implies it has something redeemable underneath (§25 / §29).
/// What it is worth is decided purely by the per-certificate dividend, which happens off chain; the front end has
/// no on-chain reading for it, so it writes nothing (§29).
function valueOf(t: Ticker, assetPerCert: bigint, quote?: Quote): string | null {
  return t.mode === "burn" ? null : certValue(t, assetPerCert, quote);
}

export function Market(p: MarketProps) {
  const { board, listings, floors, lots, quotes } = p;
  const [q, setQ] = useState("");
  const [view, setView] = useView();
  const [scope, setScope] = useState<Scope>("listed");
  const [open, setOpen] = useState<number | null>(null);
  const [selling, setSelling] = useState(false);

  // When the market is not configured `listings` is undefined; run every hook before returning early
  // (hook order must not vary with props, see 41.3).
  const all = listings ?? [];
  const me = p.account?.toLowerCase() ?? null;

  const listedCount = board.filter((t) => floors.has(t.id)).length;
  const myTokens = new Set(all.filter((l) => me && l.seller.toLowerCase() === me).map((l) => l.tickerId));
  // "I hold" = staked, or still sitting in the wallet. Both have to count to match what people mean by "hold".
  const held = new Map(p.holdings.filter((h) => h.total > 0n).map((h) => [h.id, h]));
  const myLots = new Set(lots.map((c) => c.tickerId));

  // Fixed ordering: lowest ask first, then assets with no listing, ranked by how much is staked. No sort control (§55).
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const list = board.filter((t) => {
      if (scope === "listed" && !floors.has(t.id)) return false;
      if (scope === "mine" && !myTokens.has(t.id)) return false;
      if (scope === "held" && !held.has(t.id) && !myLots.has(t.id)) return false;
      // A burn card shows two names: the certificate name uBNC and the burned token's name $BNBCAT.
      // Both have to be searchable — people search for whatever they can see (§71.138).
      if (needle && ![nameOf(t), t.symbol, t.unitSymbol].some((s) => s.toUpperCase().includes(needle))) return false;
      return true;
    });
    list.sort((a, b) => {
      const fa = floors.get(a.id)?.unitPrice ?? null, fb = floors.get(b.id)?.unitPrice ?? null;
      if (fa !== null && fb !== null) return fa === fb ? a.symbol.localeCompare(b.symbol) : fa < fb ? -1 : 1;
      if (fa !== null) return -1;
      if (fb !== null) return 1;
      return Number(b.pledged - a.pledged) || a.symbol.localeCompare(b.symbol);
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, listings, p.holdings, lots, q, scope]);

  if (!listings) {
    return (
      <div className="panel">
        <div className="empty">
          <b>{tr("The certificate market is unavailable")}</b>
          {tr("Listings and trading cannot be served right now. Please try again later.")}
        </div>
      </div>
    );
  }

  const opened = open !== null ? board.find((t) => t.id === open) ?? null : null;
  const heldCount = new Set([...held.keys(), ...myLots]).size;
  const scopeCount = (k: Scope) => k === "listed" ? listedCount : k === "all" ? board.length : !p.account ? null : k === "held" ? heldCount : myTokens.size;
  /// How many certificates of one asset are listed in total (a single listing can be several certificates).
  const openShares = (id: number) => all.filter((l) => l.tickerId === id).reduce((a, l) => a + l.remaining, 0n);

  return (
    <div className="pools mk">
      {/* ---- Toolbar: every number comes from the chain ---- */}
      <div className="pools-bar">
        <span className="tot">
          <b>{listedCount}</b> / {board.length} {tr("assets have listings")}
          {p.feeBps !== null && <> {tr("· fee")} {fmtBps(p.feeBps)}{tr(", paid by the seller")}</>}
        </span>
        <div className="mk-scope" role="tablist" aria-label={tr("Scope")}>
          {SCOPES.map(([k, label]) => {
            const n = scopeCount(k);
            return (
              <button key={k} role="tab" aria-selected={scope === k} className={`mk-sc${scope === k ? " on" : ""}`} onClick={() => setScope(k)}>
                {label}{n !== null && <small>{n}</small>}
              </button>
            );
          })}
        </div>
        <input className="pools-q" placeholder={tr("Search symbols")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="enter mk-sell" disabled={!p.account} onClick={() => setSelling(true)}
          title={!p.account ? tr("Connect a wallet to sell") : tr("List the unstaked certificates in your wallet")}>
          {tr("Sell certificates")}
        </button>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {rows.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <b>{scope === "mine" ? (p.account ? tr("You have no listings") : tr("Wallet not connected")) : scope === "held" ? (p.account ? tr("You hold no certificates") : tr("Wallet not connected")) : tr("No assets match")}</b>
            {scope === "mine" && p.account && tr("Use 'Sell certificates' to list the certificates in your wallet")}
            {scope === "held" && p.account && <>{tr("Buy one under 'Listed', or go to")} <button className="link" onClick={() => p.onGo("mint")}>{tr("Asset Staking")}</button> {tr("and deposit a token")}</>}
            {scope === "listed" && !q && tr("Switch to 'All' to be the first to list one")}
          </div>
        </div>
      ) : (
        <div className={`pool-grid${view === "rows" ? " rows" : ""}`}>
          {rows.map((t) => {
            const f = floors.get(t.id) ?? null;
            const h = held.get(t.id);
            const own = myTokens.has(t.id);
            const wallet = lots.filter((c) => c.tickerId === t.id).reduce((a, c) => a + c.n, 0n);
            return (
              <button className={`pool mk-p${t.status === "live" ? " st-live" : ""}`} key={t.id} onClick={() => setOpen(t.id)}>
                <div className="pool-top">
                  <span className="sym">{nameOf(t)}</span>
                  {/* For a burn certificate this line is "From burning $BNBCAT"; the local id means nothing to it and
                      would crowd out the one sentence that tells the cards apart (§71.138) */}
                  <span className="cls">{t.mode === "burn" ? subOf(t) : <>{subOf(t)} · #{t.id}</>}</span>
                </div>
                <div className="pool-unit">
                  <span className="k">{tr("Lowest ask")}</span>
                  {f ? <span className="v">{fmtUsdt(f.unitPrice)}<i>{tr("USDT / cert")}</i></span> : <span className="v none">{tr("No listings")}</span>}
                </div>
                <div className="st-stats">
                  <div className="pool-stat">
                    {/* A cheap certificate may simply be a small one — the lowest ask always needs the amount
                        each certificate in that batch holds right next to it (§71.80) */}
                    <span className="k">{perLabel(t)}</span>
                    <span className={`v amt${f ? "" : " zero"}`}>{f ? amtOf(t, f.assetPerCert) : "—"}</span>
                  </div>
                  <div className="pool-stat">
                    <span className="k">{tr("Staked")}</span>
                    <span className={`v${t.pledged > 0n ? "" : " zero"}`}>{t.pledged.toLocaleString()}<i>{tr("certs")}</i></span>
                  </div>
                </div>
                <div className="st-line">
                  {h ? <>{tr("You have")} <b>{h.total.toString()}</b> {tr("staked")}</> : wallet > 0n ? <>{tr("You hold")} <b>{wallet.toString()}</b> {tr("in your wallet")}</> : own ? tr("You have a listing") : t.status === "live" ? tr("Active") : " "}
                  {/* 🔴 This used to read `h && own`: an asset with certificates in the wallet, none staked and a live
                      listing would lose the whole sentence — you filter by "My listings", the card comes up, and not a
                      word on it says why it is there (§29). uBNC happens to be exactly that combination in the demo,
                      which is what brought it to light. */}
                  {own && (h || wallet > 0n) && tr(" · you have a listing")}
                </div>
                <span className="mk-cta">{f ? tr("View listings · buy / sell") : tr("View · list for sale")}</span>
              </button>
            );
          })}
        </div>
      )}

      <Faq qa={marketQa(p.feeBps)} />

      {selling && (
        <SellDrawer
          board={board} holdings={p.holdings} lots={lots} quotes={quotes} floors={floors}
          account={p.account} canWrite={p.canWrite} busy={p.busy}
          feeBps={p.feeBps} onList={p.onList} onGo={p.onGo} onClose={() => setSelling(false)}
          onOpen={(id) => { setSelling(false); setOpen(id); }}
        />
      )}
      {opened && (
        <Drawer
          t={opened} floor={floors.get(opened.id) ?? null}
          book={all.filter((l) => l.tickerId === opened.id)} openShares={openShares(opened.id)}
          holding={p.holdings.find((h) => h.id === opened.id) ?? null}
          lots={lots.filter((c) => c.tickerId === opened.id)} quote={quoteOf(quotes, opened)}
          account={p.account} canWrite={p.canWrite} busy={p.busy} feeBps={p.feeBps}
          onBuy={p.onBuy} onList={p.onList} onCancel={p.onCancel}
          onGo={p.onGo} onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the detail drawer

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/// "What is one certificate worth right now": the live Binance price × the tokens each certificate in that batch
/// actually holds (§71.26). No quote, no number (§25).
function certValue(t: Ticker, assetPerCert: bigint, quote?: Quote): string | null {
  return quote ? fmtUsd(unitValue({ ...t, unit: assetPerCert }, quote)) : null;
}

function Drawer({ t, floor, book, openShares, holding, lots, quote, account, canWrite, busy, feeBps, onBuy, onList, onCancel, onGo, onClose }: {
  t: Ticker; floor: Floor | null; book: Listing[]; openShares: bigint; holding: Holding | null; lots: Lot[]; quote?: Quote;
  account: Address | null; canWrite: boolean; busy: number | null;
  feeBps: number | null;
  onBuy: (tickerId: number, listing: Listing, n: bigint) => void;
  onList: (tickerId: number, picks: Pick[], prices: bigint[]) => void;
  onCancel: (listingId: bigint) => void;
  onGo: (t: Tab) => void; onClose: () => void;
}) {
  const [pick, setPick] = useState<bigint | null>(null);
  const [qty, setQty] = useState("1");

  const isMine = (l: Listing) => !!account && l.seller.toLowerCase() === account.toLowerCase();

  // When the book changes (a fill, a cancellation, a different asset) move the selection to the first row that is
  // still there and reset the quantity to 1.
  useEffect(() => {
    setPick((cur) => (cur !== null && book.some((l) => l.id === cur) ? cur : book.find((l) => !isMine(l))?.id ?? null));
    setQty("1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, book.length, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = book.find((l) => l.id === pick) ?? null;
  const n = chosen ? pickN(qty, chosen.remaining) : 0n;
  const total = chosen && n > 0n ? costOf(chosen, n) : null;
  const buying = busy === -50_000 - t.id;

  return (
    <div className="ov right" onClick={onClose}>
      <aside className="mk-drawer" role="dialog" aria-modal="true" aria-label={tr("{0} listings", nameOf(t))} onClick={(e) => e.stopPropagation()}>
        <div className="mk-dh">
          <div className="mk-dt">
            <h3>{nameOf(t)}</h3>
            <div className="mk-dm">
              <span>{subOf(t)}</span>
              <span>#{t.id}</span>
              {t.status === "live" && <span className="chip live">{tr("Active")}</span>}
            </div>
          </div>
          <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
        </div>

        <div className="mk-ds">
          <div><span className="k">{tr("Lowest ask")}</span><span className="v">{floor ? <>{fmtUsdt(floor.unitPrice)}<small>{tr("USDT / cert")}</small></> : "—"}</span></div>
          <div><span className="k">{tr("Listed")}</span><span className="v">{openShares.toString()}<small>{tr("certs")}</small></span></div>
          <div><span className="k">{tr("Staked")}</span><span className="v">{t.pledged.toLocaleString()}<small>{tr("certs")}</small></span></div>
          <div><span className="k">{tr("Issued")}</span><span className="v">{t.issued.toLocaleString()}<small>{tr("certs")}</small></span></div>
        </div>

        {/* ---- The book: one row = one listing (several certificates from one batch, at one unit price) ---- */}
        <section className="mk-sec">
          <div className="k">{tr("Listings")} <small>{tr("cheapest per certificate first — click a row to pick it")}</small></div>
          {book.length === 0 ? (
            <div className="mk-empty">{tr("No listings yet.")}{account ? tr(" You can list any unstaked certificates you hold.") : ""}</div>
          ) : (
            <div className="mk-book n6" role="listbox" aria-label={tr("Listings")}>
              <div className="mk-bh"><span>{tr("Certificate")}</span><span>{tr("Quantity")}</span><span>{perLabel(t)}</span><span>{tr("Price USDT")}</span><span>{tr("Seller")}</span><span /></div>
              {book.map((l, i) => {
                const me = isMine(l);
                const val = valueOf(t, l.assetPerCert, quote);
                return (
                  <div
                    key={l.id.toString()} role="option" tabIndex={me ? -1 : 0} aria-selected={pick === l.id}
                    className={`mk-br${pick === l.id ? " on" : ""}${me ? " me" : ""}${i === 0 ? " floor" : ""}`}
                    onClick={() => { if (!me) { setPick(l.id); setQty("1"); } }}
                    onKeyDown={(e) => {
                      if (!me && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPick(l.id); setQty("1"); }
                    }}
                  >
                    <span className="ct"><b>{certLabel(nameOf(t), l.batchId)}</b>{i === 0 && <em>{tr("lowest")}</em>}</span>
                    <span className="qt">{certs(l.remaining)}</span>
                    <span className="am">{amtOf(t, l.assetPerCert)}{val && <small>≈ {val}</small>}</span>
                    <span className="pr"><b>{fmtUsdt(l.unitPrice)}</b></span>
                    <span className="sl">{me ? tr("You") : short(l.seller)}</span>
                    <span className="ac">
                      {me ? (
                        <button className="act ghosted" disabled={!canWrite || busy !== null} onClick={(e) => { e.stopPropagation(); onCancel(l.id); }}>
                          {busy === -70_000 - Number(l.id) ? tr("Cancelling") : tr("Cancel")}
                        </button>
                      ) : <i className="rd" />}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- Buy: pick a listing, type how many certificates ---- */}
        {book.some((l) => !isMine(l)) && (
          <section className="mk-sec">
            <div className="k">{tr("Buy")} <small>{chosen ? tr("{0} · {1} for sale · {2} {3}", certLabel(nameOf(t), chosen.batchId), certs(chosen.remaining), perLabel(t).toLowerCase(), amtOf(t, chosen.assetPerCert)) : tr("pick a listing above first")}</small></div>
            <div className="mk-buy">
              <label>{tr("Certificates")}
                <input inputMode="numeric" aria-label={tr("Certificates to buy")} value={qty} disabled={!chosen}
                  onChange={(e) => setQty(e.target.value)} />
              </label>
              <span className="mk-total">
                <small>{tr("You pay")}</small>
                <b>{total !== null ? fmtUsdt(total) : "—"}</b> USDT
              </span>
              <button className="enter" disabled={!canWrite || busy !== null || !chosen || n <= 0n} onClick={() => chosen && onBuy(t.id, chosen, n)}>
                {buying ? tr("Buying") : chosen && n > 0n ? tr("Buy {0} · {1}", certLabel(nameOf(t), chosen.batchId), certs(n)) : tr("Buy")}
              </button>
            </div>
            <small className="mk-note">
              {account ? tr("Once the trade goes through the certificates land in your wallet; stake them to take part in the fee share. If your allowance is short you have to approve USDT first, and if there are not enough certificates left to fill the order the whole trade fails.") : tr("Connect a wallet to buy.")}
              {" "}{tr("Eligible staked certificates receive the fee share by certificate count.")}
              {/* 🔴 A burn certificate has no such thing as redemption: the tokens went to the burn address the
                  moment it was minted, so the original sentence ("the token amount behind each certificate decides
                  how much you get back") is simply false for uBNC (§71.136 / §29) */}
              {t.mode === "burn"
                ? tr(" This certificate cannot be redeemed: the burned tokens are in the burn address and cannot be recovered. The figure above is how much was burned per certificate — it only says where the certificate came from.")
                : tr(" The token amount behind each certificate decides how much you get back on redemption; it does not give one certificate a bigger part of the fee share.")}
            </small>
          </section>
        )}

        {/* ---- Sell: tick your own batches, enter the counts, price each batch ---- */}
        <section className="mk-sec">
          <div className="k">{tr("Sell")} <small>{tr("you can sell unstaked certificates held in your wallet")}</small></div>
          {!account ? (
            <div className="mk-empty">{tr("Connect a wallet to sell.")}</div>
          ) : (
            <>
              <SellForm key={t.id} t={t} lots={lots} floor={floor} quote={quote} feeBps={feeBps} canWrite={canWrite} busy={busy} onList={onList} />
              {holding && holding.total > 0n && (
                <div className="mk-empty">
                  {tr("You have")} <b>{holding.total.toString()}</b> {tr("staked. Staked certificates cannot be sold — unstake them back to your wallet first.")}
                  <div><button className="act ghosted" onClick={() => onGo("mine")}>{tr("Unstake in My Account")}</button></div>
                </div>
              )}
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- the sell form (shared by both drawers)

/// Tick the batches in your wallet, enter how many to sell, price each batch, list them in one go (the contract's
/// `list`). Batches hold different amounts, so the price has to be set batch by batch — "set one price" is only a
/// shortcut, and every row is still editable afterwards.
function SellForm({ t, lots, floor, quote, feeBps, canWrite, busy, onList }: {
  t: Ticker; lots: Lot[]; floor: Floor | null; quote?: Quote;
  feeBps: number | null; canWrite: boolean; busy: number | null;
  onList: (tickerId: number, picks: Pick[], prices: bigint[]) => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [px, setPx] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState("");

  const listing = busy === -60_000 - t.id;
  const toggle = (l: Lot) => {
    const k = lotKey(l);
    setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
    setQty((m) => (m[k] ? m : { ...m, [k]: l.n.toString() }));          // default to listing the whole batch
    setPx((m) => (m[k] ? m : { ...m, [k]: floor ? fmtUsdtExact(floor.unitPrice) : "" }));
  };

  const picked = lots
    .filter((l) => sel.includes(lotKey(l)))
    .map((l) => {
      const k = lotKey(l);
      return { l, n: pickN(qty[k] ?? "", l.n), price: parseUsdt(px[k] ?? "") };
    });
  const ok = picked.length > 0 && picked.every((r) => r.n > 0n && r.price !== null && r.price > 0n);
  const shares = picked.reduce((a, r) => a + r.n, 0n);
  const gross = ok ? picked.reduce((a, r) => a + r.price! * r.n, 0n) : null;
  const fee = gross !== null && feeBps !== null ? (gross * BigInt(feeBps)) / 10_000n : 0n;
  const bulkOk = parseUsdt(bulk) !== null && parseUsdt(bulk)! > 0n;

  if (lots.length === 0) {
    return (
      <div className="mk-empty">
        {tr("There are no")} <b>{nameOf(t)}</b>
        {t.mode === "burn" && <> ({subOf(t)})</>} {tr("certificates in your wallet to list. Staked certificates and ones already listed are not counted here.")}
      </div>
    );
  }

  return (
    <>
      <div className="mk-book sell n4">
        <div className="mk-bh"><span>{tr("My certificates")}</span><span>{tr("Certs to sell")}</span><span>{perLabel(t)}</span><span>{tr("Price USDT")}</span></div>
        {lots.map((l) => {
          const k = lotKey(l);
          const on = sel.includes(k);
          const val = valueOf(t, l.assetPerCert, quote);
          return (
            <div key={k} className={`mk-br${on ? " on" : ""}`}>
              <label className="ct">
                <input type="checkbox" checked={on} onChange={() => toggle(l)} />
                <b>{certLabel(nameOf(t), l.batchId)}</b>
                <small>{tr("you have {0}", certs(l.n))}</small>
              </label>
              <span className="qt">
                <input
                  inputMode="numeric" aria-label={tr("{0} certificates to sell", certLabel(nameOf(t), l.batchId))}
                  placeholder={l.n.toString()} disabled={!on}
                  value={qty[k] ?? ""} onChange={(e) => setQty((m) => ({ ...m, [k]: e.target.value }))}
                />
              </span>
              <span className="am">{amtOf(t, l.assetPerCert)}{val && <small>≈ {val}</small>}</span>
              <span className="px">
                <input
                  inputMode="decimal" aria-label={tr("{0} price per certificate", certLabel(nameOf(t), l.batchId))}
                  placeholder={floor ? fmtUsdt(floor.unitPrice) : "USDT"} disabled={!on}
                  value={px[k] ?? ""} onChange={(e) => setPx((m) => ({ ...m, [k]: e.target.value }))}
                />
              </span>
            </div>
          );
        })}
      </div>

      <div className="mk-buy">
        <label>{tr("Set one price")} <input inputMode="decimal" placeholder="USDT" value={bulk} onChange={(e) => setBulk(e.target.value)} /></label>
        <button className="act ghosted" disabled={sel.length === 0 || !bulkOk}
          onClick={() => setPx((m) => ({ ...m, ...Object.fromEntries(sel.map((k) => [k, bulk])) }))}>
          {tr("Apply to the")} {sel.length} {tr("selected")}
        </button>
      </div>

      <div className="mk-buy">
        {gross !== null && <span className="mk-total"><small>{tr("You receive about")}</small><b>{fmtUsdt(gross - fee)}</b> USDT</span>}
        <button className="enter" disabled={!canWrite || busy !== null || !ok}
          onClick={() => {
            onList(t.id, picked.map((r) => ({ cert: r.l.cert, batchId: r.l.batchId, n: r.n })), picked.map((r) => r.price!));
            setSel([]); setQty({}); setPx({}); setBulk("");
          }}>
          {listing ? tr("Listing") : ok ? tr("List {0} · {1}", batches(picked.length), certs(shares)) : tr("List")}
        </button>
      </div>

      <small className="mk-note">
        {tr("Held by the contract and cancellable at any time; your first listing needs one extra approval. One price per batch, and a buyer can take just a few of the certificates.")}
        {feeBps !== null && feeBps > 0 && tr(" A {0} fee is taken out of your proceeds when a trade goes through.", fmtBps(feeBps))}
        {floor && tr(" Listing below the current lowest ask makes yours the lowest ask.")}
      </small>
    </>
  );
}

// ---------------------------------------------------------------- the sell drawer (the page-level entry point)

function SellDrawer({ board, holdings, lots, quotes, floors, account, canWrite, busy, feeBps, onList, onGo, onOpen, onClose }: {
  board: Ticker[]; holdings: Holding[]; lots: Lot[]; quotes: Quotes; floors: Map<number, Floor>;
  account: Address | null; canWrite: boolean; busy: number | null; feeBps: number | null;
  onList: (tickerId: number, picks: Pick[], prices: bigint[]) => void;
  onGo: (t: Tab) => void; onOpen: (tickerId: number) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only list assets you genuinely hold certificates of — after the §69.16 relaxation there is no need to make
  // people hunt through several dozen.
  const sellable = board.filter((t) => lots.some((c) => c.tickerId === t.id));
  const [sel, setSel] = useState<number>(sellable[0]?.id ?? 0);
  const t = sellable.find((x) => x.id === sel) ?? sellable[0] ?? null;
  const f = t ? floors.get(t.id) ?? null : null;
  const staked = holdings.filter((h) => h.total > 0n);
  const sharesOf = (id: number) => lots.filter((c) => c.tickerId === id).reduce((a, c) => a + c.n, 0n);

  return (
    <div className="ov right" onClick={onClose}>
      <aside className="mk-drawer" role="dialog" aria-modal="true" aria-label={tr("Sell certificates")} onClick={(e) => e.stopPropagation()}>
        <div className="mk-dh">
          <div className="mk-dt">
            <h3>{tr("Sell certificates")}</h3>
            <div className="mk-dm">
              <span>{account ? tr("Tick the batches, enter the counts, price each batch, then list") : tr("Wallet not connected")}</span>
              {feeBps !== null && feeBps > 0 && <span>{tr("Fee")} {fmtBps(feeBps)}{tr(", paid by the seller")}</span>}
            </div>
          </div>
          <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
        </div>

        <section className="mk-sec">
          <div className="k">{tr("List")} <small>{tr("you can sell unstaked certificates held in your wallet")}</small></div>
          {!account ? (
            <div className="mk-empty">{tr("Connect a wallet to sell.")}</div>
          ) : !t ? (
            <div className="mk-empty">
              {tr("There are no certificates in your wallet to list. Staked certificates and ones already listed are not counted here.")}
              <div><button className="act ghosted" onClick={() => onGo("mint")}>{tr("Deposit a token in Asset Staking")}</button></div>
            </div>
          ) : (
            <div className="mk-sl">
              <div className="mk-slh">
                <label className="mk-pick">{tr("Asset")}
                  <select value={t.id} onChange={(e) => setSel(Number(e.target.value))} aria-label={tr("Asset")}>
                    {sellable.map((x) => (
                      <option key={x.id} value={x.id}>
                        {/* Burn certificates are all called uBNC; `subOf` ("From burning $BNBCAT") is what keeps
                            them apart in the dropdown (§71.138) */}
                        {nameOf(x)} · {subOf(x)} · {certs(sharesOf(x.id))}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="mk-slf">{f ? <>{tr("Lowest")} <b>{fmtUsdt(f.unitPrice)}</b> {tr("USDT / cert ·")} {certLabel(nameOf(t), f.batchId)} {perLabel(t).toLowerCase()} {amtOf(t, f.assetPerCert)}</> : <span className="mute">{tr("Nothing listed for sale")}</span>}</span>
                <button className="link" onClick={() => onOpen(t.id)}>{tr("See its listings")}</button>
              </div>
              <SellForm
                key={t.id} t={t} lots={lots.filter((c) => c.tickerId === t.id)} floor={f} quote={quoteOf(quotes, t)}
                feeBps={feeBps} canWrite={canWrite} busy={busy} onList={onList}
              />
            </div>
          )}
        </section>

        {account && staked.length > 0 && (
          <section className="mk-sec">
            <div className="k">{tr("Staked")} <small>{tr("unstake back to your wallet before selling")}</small></div>
            <div className="mk-book">
              {staked.map((h) => (
                <div className="mk-br me" key={h.id}>
                  <span className="ct"><b>{h.symbol}</b></span>
                  <span className="am">{certs(h.total)}</span>
                  <span className="pr" />
                  <span className="sl">{tr("Active")}</span>
                  <span className="ac"><button className="act ghosted" onClick={() => onGo("mine")}>{tr("Unstake")}</button></span>
                </div>
              ))}
            </div>
            <small className="mk-note">{tr("You can unstake at any time; it takes effect immediately.")}</small>
          </section>
        )}
      </aside>
    </div>
  );
}
