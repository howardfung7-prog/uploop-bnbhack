import type { Ticker } from "../lib/board";
import type { Address, Hash } from "viem";
import { erc20Abi, formatUnits } from "viem";
import { tr } from "../lib/i18n";
import { fmtUsdt2 } from "../lib/arena";
import { addresses, CHAIN_ID, chain, walletRpcClient } from "../lib/chain";
import { useEffect, useRef, useState } from "react";
import { formatOneClickUsdt, oneClickError, ONE_CLICK_FEE_BPS, quoteOneClick, STAKE_ORDER_COUNT, type OneClickQuote,
  type OneClickSubmit, type OneClickProgress, type OneClickResult } from "../lib/one-click-stake";

export function OneClickStake({ t, open, readOnly, count = STAKE_ORDER_COUNT, onClose, onSubmit, busy, connected, account }: {
  t: Ticker; open: boolean; readOnly: boolean; count?: number; onClose: () => void;
  onSubmit?: OneClickSubmit; busy?: boolean; connected?: boolean; account?: Address | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const requestId = useRef(0);
  const submittedHash = useRef<Hash | undefined>(undefined);
  const [quote, setQuote] = useState<OneClickQuote | null>(null);
  const [phase, setPhase] = useState<OneClickProgress | null>(null);
  const [hash, setHash] = useState<Hash | undefined>();
  const [result, setResult] = useState<OneClickResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked.current) onClose();
      if (e.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]") ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { e.preventDefault(); dialogRef.current?.focus(); return; }
        if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose]);
  useEffect(() => {
    if (!open || readOnly || busy || result || hash) { setLoading(false); return; }
    let alive = true;
    const pull = async () => {
      if (locked.current) return;
      const id = ++requestId.current;
      setLoading(true);
      try {
        const next = await quoteOneClick(t.asset, count);
        if (alive && id === requestId.current && !locked.current) { setQuote(next); setError(null); }
      } catch (e) {
        if (alive && id === requestId.current && !locked.current) { setQuote(null); setError(oneClickError(e)); }
      } finally { if (alive && id === requestId.current) setLoading(false); }
    };
    void pull();
    const timer = setInterval(() => void pull(), 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [t.asset, count, open, readOnly, busy, result, hash, reload]);
  useEffect(() => {
    if (!open || readOnly || !connected || !account || result || hash) {
      setWalletBalance(null);
      setBalanceError(null);
      setBalanceLoading(false);
      return;
    }
    let alive = true;
    let reading = false;
    setWalletBalance(null);
    setBalanceLoading(true);
    setBalanceError(null);
    const read = async () => {
      if (reading || locked.current) return;
      reading = true;
      try {
        const rpc = walletRpcClient();
        if (await rpc.getChainId() !== CHAIN_ID) throw new Error(tr("Switch your wallet to {0} to read the USDT balance.", chain.name));
        const balance = await rpc.readContract({ address: quote?.usdt ?? addresses.usdt, abi: erc20Abi, functionName: "balanceOf", args: [account] });
        if (await rpc.getChainId() !== CHAIN_ID) throw new Error(tr("Switch your wallet to {0} to read the USDT balance.", chain.name));
        if (alive) { setWalletBalance(balance); setBalanceError(null); }
      } catch (e) {
        if (alive) {
          setWalletBalance(null);
          setBalanceError(e instanceof Error ? e.message.split("\n")[0] : tr("The wallet USDT balance could not be read."));
        }
      } finally {
        reading = false;
        if (alive) setBalanceLoading(false);
      }
    };
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [open, readOnly, connected, account, result, hash, reload, quote?.usdt]);
  const submit = async () => {
    if (!quote || !onSubmit || !connected || !open || readOnly || locked.current || busy || loading || hash
      || balanceLoading || balanceError || walletBalance === null || walletBalance < quote.maxUsdtIn) return;
    locked.current = true;
    ++requestId.current;
    setPhase("confirming"); setError(null);
    try {
      setResult(await onSubmit(quote, (next, txHash) => {
        setPhase(next);
        if (txHash) { submittedHash.current = txHash; setHash(txHash); }
      }));
    } catch (e) {
      setError(submittedHash.current
        ? tr("Transaction submitted. Confirmation could not be verified here. Check the transaction before trying again.") + " " + oneClickError(e)
        : oneClickError(e));
      setQuote(null);
    } finally { locked.current = false; setPhase(null); }
  };
  const txUrl = hash && chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined;
  const insufficient = !!quote && walletBalance !== null && walletBalance < quote.maxUsdtIn;
  const reason = !open ? tr("This pool is closed") : readOnly ? tr("Preview only · no transaction will be sent")
    : result ? tr("Purchase completed and the certificates were pledged.")
    : phase === "approving" ? tr("Approve USDT in your wallet, then wait for confirmation.")
    : phase === "pending" ? tr("Transaction submitted. Waiting for confirmation…")
    : phase === "confirming" ? tr("Preparing purchase · confirm in your wallet when prompted.")
    : error ?? balanceError ?? (insufficient ? tr("USDT balance is insufficient. Add USDT or lower the quantity.") : loading ? tr("Getting a live PancakeSwap quote…") : !connected ? tr("Connect a wallet first")
      : tr("PancakeSwap purchase → certificates → automatic staking"));
  return (
    <div className="ov" onClick={() => { if (!locked.current) onClose(); }}>
      <div ref={dialogRef} className="modal slim one-click-modal" role="dialog" tabIndex={-1} aria-modal="true" aria-label={tr("One-click stake")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>{tr("One-click stake")}</h3><button ref={closeRef} className="mini x" onClick={onClose} disabled={!!phase} aria-label={tr("Close")}>×</button></div>
        <div className="modal-meta"><b>{t.symbol}</b><br />{tr("{0} certificates · bought on PancakeSwap and pledged in one transaction", count)}</div>
        <div className="modal-sec one-click-breakdown">
          <div><span>{tr("PancakeSwap purchase")}</span><b>{quote ? `${formatOneClickUsdt(quote.usdtIn - quote.feeUsdt)} USDT` : "—"}</b></div>
          <div><span>{tr("Service fee")}</span><b>{quote ? `${formatOneClickUsdt(quote.feeUsdt)} USDT` : "—"}</b></div>
          <small>{tr("{0}% of the token purchase amount. Gas is paid separately.", ONE_CLICK_FEE_BPS / 100)}</small>
          <div><span>{tr("Estimated total")}</span><b>{quote ? `${formatOneClickUsdt(quote.usdtIn)} USDT` : "—"}</b></div>
          <div className="total"><span>{tr("Maximum USDT payment")}</span><b title={quote ? formatUnits(quote.maxUsdtIn, 18) : undefined}>{quote ? `${formatOneClickUsdt(quote.maxUsdtIn)} USDT` : "—"}</b></div>
          {connected && !readOnly && <div><span>{tr("Wallet USDT balance")}</span><b title={walletBalance === null ? undefined : formatUnits(walletBalance, 18)}>{balanceLoading ? tr("Checking token balance…") : walletBalance === null ? "—" : `${fmtUsdt2(walletBalance)} USDT`}</b></div>}
          {insufficient && <small className="alert">{tr("You need at least {0} USDT in your wallet for the maximum payment.", formatOneClickUsdt(quote!.maxUsdtIn))}</small>}
          {insufficient && <small className="alert">{tr("USDT shortfall: {0}", formatOneClickUsdt(quote!.maxUsdtIn - walletBalance!))}</small>}
          <small>{quote ? tr("Includes the {0}% service fee on the token purchase and {1}% headroom. Gas is paid separately in BNB. Your arena balance is not used.", ONE_CLICK_FEE_BPS / 100, quote.slippageBps / 100) : tr("Gas is paid separately in BNB. Your arena balance is not used.")}</small>
          <small>{tr("If the full purchase and pledge cannot complete within this limit, the transaction reverts; Gas may still be spent.")}</small>
          {result && <><div className="total"><span>{tr("Actual payment")}</span><b>{formatOneClickUsdt(result.usdtIn)} USDT</b></div>
            <div><span>{tr("Certificate batch")}</span><b>#{result.id.toString()} · {result.count}</b></div>
            {result.refundedAsset > 0n && <small>{tr("Unused tokens returned to your wallet: {0} {1}", formatUnits(result.refundedAsset, t.unitDecimals), t.unitSymbol)}</small>}</>}
          {txUrl && <a href={txUrl} target="_blank" rel="noreferrer">{tr("View transaction")}</a>}
        </div>
        <div className="modal-foot">
          <span className={`dim${error || balanceError || insufficient ? " alert" : ""}`} role="status">{reason}</span>
          {result || (hash && !phase) ? <button className="act" onClick={onClose}>{tr("Close")}</button>
            : (error || balanceError) && !phase ? <button className="act" onClick={() => { setError(null); setReload(n => n + 1); }}>{tr("Refresh quote")}</button>
            : <button className="act" disabled={!quote || !onSubmit || !connected || readOnly || loading || balanceLoading || walletBalance === null || insufficient || !!phase || busy || !open} onClick={() => void submit()}>{readOnly ? tr("Preview only") : phase ? tr("Confirming transaction…") : tr("Buy and pledge")}</button>}
        </div>
      </div>
    </div>
  );
}
