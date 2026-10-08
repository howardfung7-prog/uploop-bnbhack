import { tr } from "../lib/i18n";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { EMPTY_LISTING, listingText, listingUrl, submitListing, validateListing } from "../lib/listing";
import type { Listing } from "../lib/listing";

/// The listing-application form (§63): token name, token address, market cap, Telegram contact,
/// whether this is the developer's address → submit.
/// Three possible destinations, and the interface says which: an endpoint is configured → really
/// sent; demo mode → not sent; nothing configured → the user is given the text to copy.
type Phase = { s: "form" } | { s: "busy" } | { s: "sent" } | { s: "copy"; why: string };

export function ListingForm({ account, demo, onClose }: { account: Address | null; demo: boolean; onClose: () => void }) {
  const [f, setF] = useState<Listing>(EMPTY_LISTING);
  const [err, setErr] = useState<string | null>(null);
  const [ph, setPh] = useState<Phase>({ s: "form" });
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof Listing>(k: K, v: Listing[K]) => { setF({ ...f, [k]: v }); setErr(null); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    const bad = validateListing(f);
    if (bad) { setErr(bad); return; }
    if (demo) { setPh({ s: "copy", why: tr("Demo mode does not actually send anything. The text is below and can be copied.") }); return; }
    if (!listingUrl()) { setPh({ s: "copy", why: tr("The application service is unavailable. Copy the text below and send it through one of the channels the platform has published.") }); return; }
    setPh({ s: "busy" });
    try {
      await submitListing(f, account);
      setPh({ s: "sent" });
    } catch (e) {
      setPh({ s: "copy", why: tr("{0}. The text is below; copy it and send it another way.", e instanceof Error ? e.message : tr("Submission failed")) });
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(listingText(f, account)); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="ov" onClick={onClose}>
      <div className="modal slim lf" role="dialog" aria-modal="true" aria-label={tr("Listing application")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{tr("Listing application")}</h3>
          <button className="mini x" onClick={onClose} aria-label={tr("Close")}>×</button>
        </div>
        <div className="modal-meta">
          {tr("Requirement: the MEME token must have at least 100 BNB in liquidity. Submitting starts an assessment; it is not a promise to list, nor a promise of any timescale.")}
          {account
            ? <> {tr("Submitted from the connected wallet:")} <b>{account.slice(0, 6)}…{account.slice(-4)}</b>{tr(".||after the applicant address")}</>
            : <> {tr("Connect a wallet before submitting so the developer address can be checked.")}</>}
        </div>

        {ph.s === "sent" ? (
          <div className="modal-sec">
            <div className="lf-done"><b>{tr("Submitted.")}</b> {tr("The application has been received. If we need to get in touch, we will use the Telegram you gave.")}</div>
          </div>
        ) : ph.s === "copy" ? (
          <div className="modal-sec">
            <div className="mk-empty">{ph.why}</div>
            <pre className="lf-pre">{listingText(f, account)}</pre>
            <div className="lf-row">
              <button className="act" onClick={copy}>{copied ? tr("Copied") : tr("Copy the application")}</button>
              <button className="mini" onClick={() => setPh({ s: "form" })}>{tr("Back to edit")}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-sec lf-fields">
              <label>
                <span className="k">{tr("Token name")}</span>
                <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={tr("e.g. BNBCAT")} maxLength={40} autoFocus />
              </label>
              <label>
                <span className="k">{tr("Token address")} <small>BNB Chain</small></span>
                <input value={f.token} onChange={(e) => set("token", e.target.value)} placeholder="0x…" spellCheck={false} maxLength={42} />
              </label>
              <label>
                <span className="k">{tr("Market cap")} <small>USDT</small></span>
                <input value={f.marketCap} onChange={(e) => set("marketCap", e.target.value)} placeholder={tr("e.g. 1200000")} inputMode="decimal" maxLength={20} />
              </label>
              <label>
                <span className="k">{tr("Telegram contact")}</span>
                <input value={f.tg} onChange={(e) => set("tg", e.target.value)} placeholder="@username" maxLength={40} />
              </label>
              <div className="lf-yn">
                <span className="k">{tr("Developer address")} <small>{tr("whether the connected wallet belongs to this token's developer")}</small></span>
                <div className="mk-scope" role="radiogroup" aria-label={tr("Developer address")}>
                  <button type="button" role="radio" aria-checked={f.isDev === true} className={`mk-sc${f.isDev === true ? " on" : ""}`} onClick={() => set("isDev", true)}>{tr("Yes")}</button>
                  <button type="button" role="radio" aria-checked={f.isDev === false} className={`mk-sc${f.isDev === false ? " on" : ""}`} onClick={() => set("isDev", false)}>{tr("No")}</button>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className={`lf-err${err ? " on" : ""}`}>{err ?? " "}</span>
              <button className="enter" disabled={ph.s === "busy"} onClick={submit}>{ph.s === "busy" ? tr("Submitting…") : tr("Submit")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
