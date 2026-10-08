import { tr } from "../lib/i18n";
import { useCallback, useMemo, useState } from "react";
import { useEffect } from "react";
import { erc20Abi, formatUnits } from "viem";
import type { Address } from "viem";
import { walletRpcClient } from "../lib/chain";
import type { AssetsState } from "../lib/assets";
import type { MintQuote, Ticker } from "../lib/board";
import { catalogBoard, fmtCert, mintCost } from "../lib/board";
import type { Quote, Quotes } from "../lib/quotes";
import { FACE_USDT, change24h, fmtAmount, fmtChange, fmtUsd, quoteOf, tokensPerFace } from "../lib/quotes";
import { bareSym } from "../lib/ticker";
import type { RwaPrice } from "../lib/rwa";
import { rwaGap, useRwaPrices } from "../lib/rwa";
import { useView } from "../lib/view";
import { CopyAddr, hasAddr } from "./CopyAddr";
import { ViewToggle } from "./ViewToggle";
import { OneClickStake } from "./OneClickStake";
import { oneClickPoolOpen, STAKE_ORDER_COUNT, type OneClickSubmit } from "../lib/one-click-stake";

interface Props {
  board: Ticker[];
  connected: boolean;
  /// Demo mode / the `?as=0x…` read-only preview: as far as the interface is concerned there is an
  /// account, it just does not send transactions. When disabling a button, do not say "connect a
  /// wallet first" — the demo banner plainly says an account is already connected, the two
  /// sentences contradict each other, and the user will think they have done something wrong.
  readOnly?: boolean;
  busy: number | null;
  /// Symbol → live price (§71): both the bare symbol (NVDA, BTC) and the bStocks token symbol from
  /// the catalog (NVDAB, §71.31) live in this one table. A pool card looks up the bare symbol
  /// first, then the token symbol, and failing both shows "—"
  quotes: Quotes;
  /// The asset catalog (§71.31): the Binance equity tokens that have been listed, which the
  /// operator lists and delists from the console; unconfigured = the endpoint is not set up or not
  /// enabled, error = it could not be fetched
  assets: AssetsState;
  /// Bare symbol → number of dividends. null = no readable payout record (the old bStock index is
  /// retired, 2026-10-05) → show "—"
  dividends: Map<string, number> | null;
  /// `Ticker.id` → the deposit quote (how many tokens per certificate), from the on-chain oracle
  /// (§71.80).
  /// An asset missing from this map = the chain cannot quote it → show "—" and disable depositing
  /// (§25 / §29)
  mints: Map<number, MintQuote>;
  /// Deposit for `shares` certificates: App checks the token allowance, sends an approve if it is
  /// short, then calls `RedeemableCertificate.mint(n, to)` (§71.80)
  onDeposit: (id: number, shares: bigint) => void;
  account?: `0x${string}` | null;
  onOneClickStake?: OneClickSubmit;
}

/// The body of the Asset Staking page (§53, revised in §71): one pool card per asset — top right of
/// the symbol line is the token's live price `$120.00` plus the change in small type (always against
/// 24 hours ago: since §71.94 **this side takes the token's own Binance spot price**, not the
/// perpetual price of the equity behind it; §71.26 — only Binance prices count)
/// `+2.35%` (§71.7 / §71.8, which replaced the words "equity · bNVDA"), the conversion line
/// (1 cert = `$10` ≈ how many tokens; §71.9 — money on a card is always written with `$`),
/// the total staked, the number of dividends, and the deposit control.
/// §71.54: **one certificate is fixed at $10, and how many tokens that costs is worked out live**.
/// Since §71.80 on-chain pools are quoted by the **on-chain oracle**
/// (`PriceOracle.quoteForFaceValue`, delivery doc §4.1) — that is the number actually paid when
/// signing, so the card's "1 cert = $10 ≈ how many tokens" shows that quote, not a conversion from
/// the Binance price.
/// 🔴 **Depositing is free of charge** (§71.84): the figure on the button is everything the wallet
/// will pay; there is no second fee.
/// The amount is allowed 1% of headroom (spare room left in the approval, since the contract's
/// `mint` has no maxAssetIn parameter) — **this does not go on the interface**, it stays inside the
/// system (settled by the user on 2026-09-14).
/// Pools the operator opened (offchain) have no on-chain quote: one is estimated from the live
/// Binance price and requoted every 30 seconds. With neither quote available it shows "—" (§25).
/// There is no grading by activation status and no activation line or progress bar; whether an
/// asset can be picked into a strategy is explained only in the questions at the foot of the page.
/// Cards are sorted by total staked, descending, then by symbol. Floor prices and trading are on
/// Asset Market; unstaking and redeeming are on My Account.
/// Cards come from two places (§71.51): pools listed in the on-chain Registry, plus tokens the
/// operator has "opened a pool" for in the asset catalog (which fills the page while the chain
/// still has no pool to read — for as long as the contracts are not deployed to BNB Chain, this
/// page does not come down to a single line saying "waiting on the chain"). Where the same token
/// appears in both, the chain wins.
/// For the operator-opened cards: the symbol, live price, `$10 = how many tokens` and
/// `1 cert = how many tokens` are all real (the price comes from Binance, the tokens per
/// certificate were filled in by the operator); only the figures that exist solely on chain (total
/// staked, number of dividends) show "—" (§25), and the deposit button is disabled and says
/// "Deposits not open yet" — it does not pretend it can take a deposit (§29).
/// One search box filters the pool cards by display symbol or token symbol.
/// §71.132 / §71.133: a copyable contract address hangs to the right of the symbol on **the pool
/// cards**, showing only "first 2 plus last 4" (`0x…3456`), with a copy icon beside it (no "copy"
/// caption and no "certificate" label — settled by the user on 2026-09-18).
/// 🔴 §71.133 changed which address that is: it is the **on-chain token contract** (`underlying` —
/// TSLAB / WBNB / BTCB), **not** the certificate contract we deploy (`cert`). The reason is the
/// user's own: this address is for searching in a swap, to go and buy the token — pasting a
/// certificate contract address into PancakeSwap finds nothing, and getting it wrong could send
/// money to the wrong place.
/// The "Supported tokens" catalog below **does not** carry it (the user on 2026-09-18: "don't show
/// it in supported tokens, only on the cards with a pool") — to see the address from that row,
/// follow the "Contract" link on the right (the block explorer, and the same token contract).
/// Only the abbreviation is shown; **what gets copied is always the full 42-character address**.
export function StakePools({ board, connected, readOnly, busy, quotes, assets, dividends, mints, onDeposit, onOneClickStake, account }: Props) {
  const [q, setQ] = useState("");
  const [view, setView] = useView();
  const rwa = useRwaPrices();
  const [oneClickAsset, setOneClickAsset] = useState<Ticker | null>(null);
  const [oneClickAssetCount, setOneClickAssetCount] = useState(STAKE_ORDER_COUNT);
  const [depositCheck, setDepositCheck] = useState<{ t: Ticker; shares: bigint } | null>(null);
  const closeOneClick = useCallback(() => setOneClickAsset(null), []);
  const openOneClick = useCallback((t: Ticker, count: number) => {
    setOneClickAssetCount(count);
    setOneClickAsset(t);
  }, []);
  const isOpen = (t: Ticker) => assets.status === "ok" && assets.assets.some((a) =>
    a.address.toLowerCase() === t.asset.toLowerCase() && oneClickPoolOpen(a));
  // On-chain pools plus the pools the operator opened in the catalog; where the same token is in
  // both, the chain wins (§71.51)
  const cards = useMemo(() => {
    const onAddr = new Set(board.map((t) => t.underlying.toLowerCase()));
    const onUnit = new Set(board.map((t) => t.unitSymbol.toUpperCase()));
    const shelf = catalogBoard(assets.assets).filter((t) => !onAddr.has(t.underlying.toLowerCase()) && !onUnit.has(t.unitSymbol.toUpperCase()));
    return board.concat(shelf);
  }, [board, assets]);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return cards
      .filter((t) => !k || t.symbol.toLowerCase().includes(k) || t.unitSymbol.toLowerCase().includes(k))
      .sort((a, b) => (a.pledged === b.pledged ? a.symbol.localeCompare(b.symbol) : b.pledged > a.pledged ? 1 : -1));
  }, [cards, q]);
  const total = board.reduce((a, t) => a + t.pledged, 0n);
  return (
    <section className="pools staking-pools">
      <div className="pools-bar">
        <span className="tot">
          {cards.length} {tr("pools · staked platform-wide")}{" "}
          {board.length === 0
            ? <b title={tr("No pools can be read from the chain yet, so there is no staked total to report")}>—</b>
            : <><b>{total.toLocaleString()}</b> {tr("certs")}</>}
        </span>
        <div className="pools-right">
          <input
            className="pools-q" type="search" placeholder={tr("Search assets, e.g. NVDA / BTC")} aria-label={tr("Search assets")}
            value={q} onChange={(e) => setQ(e.target.value)}
          />
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="note">{assets.status === "ok" ? tr("No staking pools are open") : tr("No on-chain data yet")}</div>
      ) : list.length === 0 ? (
        <div className="note">{tr("No assets match")}</div>
      ) : (
        <div className={`pool-grid${view === "rows" ? " rows" : ""}`}>
          {list.map((t) => {
            const sym = bareSym(t.symbol);
            return (
              <Pool
                key={`${t.id}-${t.unitSymbol}`} t={t} quote={quoteOf(quotes, t)} mint={mints.get(t.id)} rwa={rwa.get(t.underlying.toLowerCase())} rwaOn={rwa.size > 0}
                dividends={t.offchain ? null : dividends ? (dividends.get(sym) ?? 0) : null}
                connected={connected} readOnly={readOnly} busy={busy} onDeposit={(id, n) => {
                  const selected = cards.find((x) => x.id === id);
                  if (selected) setDepositCheck({ t: selected, shares: n });
                }}
                oneClick={isOpen(t)} onOneClick={(count) => openOneClick(t, count)}
              />
            );
          })}
        </div>
      )}

      {oneClickAsset && (
        <OneClickStake key={`${oneClickAsset.asset}-${oneClickAssetCount}-${account}`} t={oneClickAsset} count={oneClickAssetCount} open={isOpen(oneClickAsset)}
          readOnly={readOnly === true} onClose={closeOneClick} connected={connected} account={account} onSubmit={onOneClickStake} busy={busy !== null} />
      )}
      {depositCheck && (
        <DepositCheckModal
          t={depositCheck.t} shares={depositCheck.shares} account={account} readOnly={readOnly === true}
          mint={mints.get(depositCheck.t.id)} onClose={() => setDepositCheck(null)}
          onVerified={() => { onDeposit(depositCheck.t.id, depositCheck.shares); setDepositCheck(null); }} />
      )}
    </section>
  );
}

function DepositCheckModal({ t, shares, account, readOnly, mint, onClose, onVerified }: {
  t: Ticker; shares: bigint; account?: Address | null; readOnly: boolean; mint?: MintQuote;
  onClose: () => void; onVerified: () => void;
}) {
  const [state, setState] = useState<"checking" | "valid" | "invalid" | "error">("checking");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [symbol, setSymbol] = useState(t.unitSymbol);
  const [message, setMessage] = useState<string | null>(null);
  const required = mint ? mintCost(mint, shares) : null;

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!account || !hasAddr(t.underlying) || required === null) {
        if (alive) { setState("invalid"); setMessage(!account ? tr("Connect a wallet first") : tr("The live deposit quote is unavailable. Please refresh and try again.")); }
        return;
      }
      setState("checking"); setMessage(null);
      try {
        const rpc = walletRpcClient();
        const [actualBalance, actualSymbol, actualDecimals] = await Promise.all([
          rpc.readContract({ address: t.underlying, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          rpc.readContract({ address: t.underlying, abi: erc20Abi, functionName: "symbol" }),
          rpc.readContract({ address: t.underlying, abi: erc20Abi, functionName: "decimals" }),
        ]);
        if (!alive) return;
        setBalance(actualBalance); setSymbol(actualSymbol);
        if (actualDecimals !== t.unitDecimals || actualSymbol.toUpperCase() !== t.unitSymbol.toUpperCase()) {
          setState("invalid"); setMessage(tr("The token metadata does not match this asset. Check the contract address before continuing."));
        } else if (actualBalance < required) {
          setState("invalid"); setMessage(tr("Your wallet does not hold enough of this token."));
        } else {
          setState("valid");
        }
      } catch {
        if (alive) { setState("error"); setMessage(tr("The token contract could not be read from your wallet RPC.")); }
      }
    };
    void check();
    return () => { alive = false; };
  }, [account, required, t.underlying, t.unitDecimals, t.unitSymbol]);

  const display = (v: bigint | null) => v === null ? "—" : `${formatUnits(v, t.unitDecimals)} ${symbol}`;
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal slim deposit-check-modal" role="dialog" aria-modal="true" aria-labelledby="deposit-check-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3 id="deposit-check-title">{tr("Verify token before depositing")}</h3><button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button></div>
        <div className="modal-meta"><b>{t.symbol}</b><br />{tr("Check your wallet before opening the transaction request.")}</div>
        <div className="modal-sec deposit-check-info">
          <div><span>{tr("Token contract")}</span><code>{t.underlying}</code></div>
          <div><span>{tr("Required amount")}</span><b>{required === null ? "—" : `${formatUnits(required, t.unitDecimals)} ${t.unitSymbol}`}</b></div>
          <div><span>{tr("Wallet balance")}</span><b>{display(balance)}</b></div>
          <p className={`note${state === "valid" ? " ok" : state === "invalid" || state === "error" ? " alert" : ""}`} role="status">
            {state === "checking" ? tr("Checking token balance…") : state === "valid" ? tr("Token check passed. You can continue in your wallet.") : message}
          </p>
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>{tr("Cancel")}</button>
          <button className="act" disabled={readOnly || state !== "valid"} onClick={onVerified}>{readOnly ? tr("Preview only") : tr("Verify and continue")}</button>
        </div>
      </div>
    </div>
  );
}

interface PoolProps extends Pick<Props, "connected" | "readOnly" | "busy" | "onDeposit"> {
  t: Ticker;
  quote: Quote | undefined;
  /// The token's on-chain price from Binance Web3 API · RWA Data (§71.189); undefined = no row → the line is not drawn
  rwa: RwaPrice | undefined;
  /// The feed has data for some card: one without a row keeps an empty line of the same height so the grid stays aligned
  rwaOn: boolean;
  /// The on-chain deposit quote; undefined = the chain cannot quote it (no liquidity in the pool /
  /// the live price is too far from the TWAP)
  mint: MintQuote | undefined;
  dividends: number | null;
  oneClick: boolean;
  onOneClick: (count: number) => void;
}

/// One pool card: each deposit creates 10 certificates and the button says outright how many tokens it will cost,
/// so it is visible before signing (there is no fee, so that figure is the whole of it, §71.84).
/// Pools the operator opened (`offchain`, §71.51) have no matching pool on chain: the figures that
/// only exist on chain show "—", and the button is disabled and says "Deposits not open yet".
/// A pool that exists on chain but cannot be quoted (`mint` is undefined) is disabled the same way —
/// we do not invent a number for somebody to sign (§29).
function Pool({ t, quote, rwa, rwaOn, mint, dividends, connected, readOnly, busy, onDeposit, oneClick, onOneClick }: PoolProps) {
  const [n, setN] = useState(STAKE_ORDER_COUNT);
  const shares = BigInt(n);
  const off = t.offchain === true;
  const chg = quote ? change24h(quote) : null;
  const gap = rwa && quote ? rwaGap(rwa.price, quote.price) : null;
  // What it costs: from the on-chain quote, not converted from the Binance price. There is no
  // minting fee, so this is the whole of what will be paid (§71.84)
  const cost = mint ? mintCost(mint, shares) : null;
  const can = !off && mint !== undefined && cost !== null && !mint.paused;
  const title = off
    ? tr("Deposits not open yet")
    : !mint || cost === null
      ? tr("No valid quote can be read at the moment, so depositing is unavailable")
      : mint.paused
        ? tr("Deposits for this asset are paused; unstaking and redeeming certificates you already hold are unaffected")
        : connected
          ? tr("Deposit {0} for {1} {2} certificates (the {1} from one deposit share a single batch number, which exists only once the transaction is on-chain)", fmtCert(t, cost), n, t.symbol)
          : readOnly ? tr("Read-only mode, no transactions are sent: all you can see here is what it would cost and how many certificates it would buy") : tr("Connect a wallet first");
  return (
    <div className="pool" id={`pool-${bareSym(t.symbol)}`}>
      <div className="pool-top">
        {/* To the right of the symbol hangs this asset's **on-chain token contract** address
            (§71.133): `underlying`, not `cert`.
            The user on 2026-09-18: "on the staking page the contract address has to be the on-chain
            token's contract, not the certificate contract we created. Mainly so people can go and
            buy the token in a swap." — what gets copied is going to be pasted into PancakeSwap or
            similar to find the coin, and a certificate contract address finds no pool there. The
            card says uTSLA, which is the certificate's name, while the address is TSLAB's; the two
            not matching is **deliberate**, and the tooltip spells out that this is the "TSLAB token
            contract".
            If the address cannot be read (invalid / the zero address) it says so rather than
            showing `0x…0000` (§25). */}
        <span className="pool-id">
          <span className="sym">{t.symbol}</span>
          {hasAddr(t.underlying)
            ? <CopyAddr a={t.underlying} what={tr("{0} token contract", t.unitSymbol)} note={tr("paste this address into a swap to find and buy the token")} />
            : <span className="caddr dim" title={tr("The token contract address for this asset cannot be read at the moment, so there is nothing to copy")}>{tr("Address unavailable")}</span>}
        </span>
        {quote ? (
          <span className="px" title={tr("The live {0} price in USDT, taken from the Binance spot price and refreshed every 30 seconds; the small figure is the change against 24 hours ago", t.unitSymbol)}>
            <b>{fmtUsd(quote.price)}</b>
            {chg === null
              ? <small className="chg dim">—</small>
              : <small className={`chg${chg > 0 ? " gain" : chg < 0 ? " loss" : ""}`}>{fmtChange(chg)}</small>}
          </span>
        ) : (
          <span className="px dim" title={tr("The live {0} price is unavailable", t.unitSymbol)}>—</span>
        )}
      </div>
      <div
        className="pool-unit pool-face"
        title={mint
          ? tr("Each certificate converts at ${0}, and how much {1} that comes to is quoted by the on-chain oracle; what is shown here is the quote right now, and it is recalculated at the price of the moment you sign", FACE_USDT, t.unitSymbol)
          : tr("Each certificate converts at ${0}, and how much {1} that comes to is worked out live from the Binance price, requoted every 30 seconds", FACE_USDT, t.unitSymbol)}
      >
        <span className="k">{tr("1 cert")}</span>
        {mint ? (
          <>
            <span className="v">${FACE_USDT.toString()} = {fmtCert(t, mint.assetPerCert)}</span>
            <small className="pool-px">{tr("On-chain quote · recalculated at the price when you sign")}</small>
          </>
        ) : quote ? (
          <>
            <span className="v">${FACE_USDT.toString()} ≈ {fmtAmount(tokensPerFace(t, quote), t.unitDecimals)} {t.unitSymbol}</span>
            <small className="pool-px">{off ? tr("Requoted from the live price every 30 seconds") : tr("Reference price · the on-chain quote cannot be read right now")}</small>
          </>
        ) : (
          <>
            <span className="v">${FACE_USDT.toString()}</span>
            <small className="pool-px dim">{tr("The live price cannot be read, so how much {0} this comes to shows as “—”", t.unitSymbol)}</small>
          </>
        )}
        {/* §71.189 the token's own price on BNB Chain (Binance Web3 API · RWA Data), and its gap to the Binance spot
            price at the top right. Display only — deposits and settlement never read it; no row → not drawn. */}
        {rwa && (
          <small
            className="pool-rwa"
            title={tr("The price of {0} on BNB Chain, from Binance Web3 API · RWA Data and refreshed every 30 seconds; the percentage is how far it sits from the Binance spot price above. For reference only: deposits and settlement do not use it", t.unitSymbol)}
          >
            {tr("On-chain")} <b>{fmtUsd(rwa.price)}</b>
            {gap !== null && <> · {tr("vs spot")} <span className={gap > 0 ? "gain" : gap < 0 ? "loss" : ""}>{fmtChange(gap)}</span></>}
            <em>Binance Web3 API</em>
          </small>
        )}
        {!rwa && rwaOn && <small className="pool-rwa pool-rwa-gap" aria-hidden="true" />}
      </div>
      <div className="st-stats">
        <div className="pool-stat">
          <span className="k">{tr("Total staked")}</span>
          {off
            ? <span className="v dim" title={tr("There is no pool for this token on-chain, so there is no on-chain figure")}>—</span>
            : <span className="v">{t.pledged.toLocaleString()}<i>{tr("certs")}</i></span>}
        </div>
        <div className="pool-stat">
          <span className="k">{tr("Fee share paid")}</span>
          {dividends === null
            ? <span className="v dim">—</span>
            : <span className={`v${dividends === 0 ? " zero" : ""}`}>{dividends}<i>{tr("times")}</i></span>}
        </div>
      </div>
      <div className="dep-ctl">
        <div className="stake-quantity">
          <span>{tr("Quantity")}</span>
          <div className="stake-stepper" role="group" aria-label={tr("Quantity")}>
            <button type="button" aria-label={tr("Decrease quantity")} disabled={n <= 1} onClick={() => setN((v) => Math.max(1, v - 1))}>−</button>
            <output>{n} {tr(n === 1 ? "cert" : "certs")}</output>
            <button type="button" aria-label={tr("Increase quantity")} disabled={n >= 100} onClick={() => setN((v) => Math.min(100, v + 1))}>＋</button>
          </div>
        </div>
        <button
          className="act"
          disabled={!can || !connected || busy !== null}
          title={title}
          onClick={() => onDeposit(t.id, shares)}
        >
          {!can || cost === null ? tr("Deposits not open yet") : busy === t.id ? tr("Depositing") : tr("Deposit {0}", fmtCert(t, cost))}
        </button>
        {oneClick && (
          <button type="button" className="act ghosted" disabled={busy !== null} onClick={() => onOneClick(n)}>
            {tr("One-click stake · live USDT quote")}
          </button>
        )}
        {/* There used to be a line here reading "fee x% ≈ … (paid separately)". The contract
            colleague's 2026-09-15 delivery dropped the minting fee (the certificate contract no
            longer has `feeBps()` / `setFee()`), so the figure on the button is everything the wallet
            will pay and this line is no longer needed (§71.84).
            "Depositing is free of charge" is said once in the Help Center, not repeated on every card.
            The secondary-market fee is unaffected: it is still taken from the seller's proceeds on
            Asset Market, at whatever rate the chain says at the moment of the trade. */}
        {/* §71.80: one deposit = one batch = one number, and the N certificates in it are identical.
            The number is assigned by the contract when the transaction lands, so it cannot be given
            here — hence "issued once the transaction goes through" (§29 forbids promising anything
            we cannot read) */}
      </div>
    </div>
  );
}
