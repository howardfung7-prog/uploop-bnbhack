import { tr } from "../lib/i18n";
import { useEffect, useState } from "react";
import { discover, subscribe, walletErrorText, wallets } from "../lib/wallet";
import type { WalletEntry } from "../lib/wallet";

interface Props {
  onClose: () => void;
  /// A detected wallet was picked: App remembers it and asks it for an address (which raises the
  /// wallet's own approval window). If it throws, a line appears here and the dialog stays open.
  onPick: (e: WalletEntry) => Promise<void>;
}

/// The "Connect wallet" dialog (§71.28): the three defaults (MetaMask / Binance Wallet / Trust
/// Wallet), then any other wallet detected, then WalletConnect on the last row (scan from a phone,
/// §71.28 note 2).
/// An installed wallet reads "Detected" and can be clicked; one that is not installed is greyed
/// out, reads "Not detected" and carries the official download link. WalletConnect reads "Scan to
/// connect" when it is configured and "Not configured" when it is not.
/// Only facts: not installed means not installed, and it never says "coming soon" (§29).
export function WalletPicker({ onClose, onPick }: Props) {
  const [list, setList] = useState<WalletEntry[]>(() => { discover(); return wallets(); });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => subscribe(() => setList(wallets())), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const found = list.filter((e) => e.kind === "injected" && e.provider).length;

  async function go(e: WalletEntry) {
    if (!e.available || busy) return; // WalletConnect's provider is null until a session exists, so test available, not provider
    setBusy(e.id);
    setErr(null);
    try {
      await onPick(e);
    } catch (x) {
      setErr(tr("{0}: {1}", e.name, walletErrorText(x)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ov" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal slim" role="dialog" aria-modal="true" aria-label={tr("Connect wallet")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{tr("Connect wallet")}</h3>
          <button className="mini x" onClick={onClose} disabled={busy !== null} aria-label={tr("Close")}>×</button>
        </div>
        <div className="modal-meta">
          {tr("Connect with a wallet extension in this browser, or use WalletConnect and scan from a phone wallet.")}{" "}
          {found === 0
            ? tr("No wallet extension was detected in this browser; install one, reload this page and try again.")
            : tr("{0} detected.", `${found} ${found === 1 ? tr("extension") : tr("extensions")}`)}
        </div>
        <div className="modal-sec">
          <ul className="wl-list">
            {list.map((e) => {
              const on = e.available;
              const ready = e.kind === "walletconnect" ? tr("Scan to connect") : tr("Detected");
              const mark = e.icon ? <img src={e.icon} alt="" /> : <i>{e.name.slice(0, 1)}</i>;
              return (
                <li key={e.id}>
                  {on ? (
                    <button className="wl" disabled={busy !== null} onClick={() => go(e)}>
                      <span className="wl-ic">{mark}</span>
                      <span className="wl-nm">{e.name}</span>
                      <span className="wl-st ok">{busy === e.id ? tr("Waiting for the wallet…") : ready}</span>
                    </button>
                  ) : (
                    <div className="wl off">
                      <span className="wl-ic">{mark}</span>
                      <span className="wl-nm">{e.name}</span>
                      <span className="wl-st">
                        {e.why}
                        {e.install && <a href={e.install} target="_blank" rel="noreferrer">{tr("Download")}</a>}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {err && <div className="note alert">{err}</div>}
          <p className="pay sub">{tr("Connecting a wallet only identifies your address; it sends no transaction and costs no network fee. Sign-in signatures, token approvals and trades are each confirmed separately in your wallet.")}</p>
        </div>
      </div>
    </div>
  );
}
