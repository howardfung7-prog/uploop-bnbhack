import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, apiErrorText } from "../lib/api";
import { FACTIONS, chooseFaction } from "../lib/factions";
import type { FactionId } from "../lib/factions";
import { tr } from "../lib/i18n";
import "./FactionSelector.css";

type Props = {
  address: string;
  faction?: FactionId | null;
  enabled: boolean;
  onSelected: (faction: FactionId) => void;
};

export function FactionSelector({ address, faction, enabled, onSelected }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<FactionId | null>(null);
  const saved = faction ?? confirmed;
  const current = FACTIONS.find(f => f.id === saved);
  return <>
    {current ? <div className="me-line faction-chosen" role="status">
      <span className="me-k">{tr("Faction")}</span>
      <span className="faction-chosen-name"><b>{current.name}</b><small>{current.title}</small></span>
    </div> : <button className="me-line faction-entry" disabled={!enabled || faction === undefined}
      title={!enabled ? tr("Sign in with your wallet to choose a faction.") : faction === undefined ? tr("Faction data is unavailable. Please refresh and try again.") : undefined}
      onClick={() => setOpen(true)}>
      <span className="me-v">{tr("Choose your faction")}</span><span className="me-arrow">›</span>
    </button>}
    {open && enabled && !current && createPortal(<FactionDialog address={address}
      onClose={() => setOpen(false)} onSelected={id => { setConfirmed(id); onSelected(id); setOpen(false); }} />, document.body)}
  </>;
}

export function FactionDialog({ address, onClose, onSelected }: {
  address: string; onClose: () => void; onSelected: (id: FactionId) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [selected, setSelected] = useState<FactionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { mounted.current = false; element.close(); document.body.style.overflow = overflow; };
  }, []);

  async function confirm() {
    if (!selected || submitting.current || locked) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      const id = await chooseFaction(address, selected);
      if (mounted.current) onSelected(id);
    } catch (e) {
      if (mounted.current) {
        if (e instanceof ApiError && e.code === "FactionLocked") {
          setLocked(true);
          setError(tr("This wallet has already chosen a faction. Please refresh to see it."));
        } else setError(apiErrorText(e));
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <dialog ref={dialog} className="faction-dialog" aria-labelledby="faction-title" aria-describedby="faction-warning"
    onCancel={e => { e.preventDefault(); if (!submitting.current) onClose(); }}>
    <header className="faction-heading">
      <div><span className="faction-eyebrow">UPLOOP · {tr("Faction")}</span><h2 id="faction-title">{tr("Choose your faction")}</h2></div>
      <button className="mini" aria-label={tr("Close")} disabled={busy} onClick={onClose}>×</button>
    </header>
    <p className="faction-intro">{tr("What kind of strategist are you?")}</p>
    <div className="faction-grid" role="group" aria-label={tr("Choose your faction")}>
      {FACTIONS.map((f) => <button key={f.id} type="button"
        className={`faction-card faction-${f.id}${selected === f.id ? " selected" : ""}`}
        aria-pressed={selected === f.id} disabled={busy || locked} onClick={() => setSelected(f.id)}>
        <strong>{f.name}</strong><span className="faction-role">{f.title}</span>
        <span className="faction-personality">{f.personality}</span>
        <span className="faction-motto">{f.motto}</span>
      </button>)}
    </div>
    <p id="faction-warning" className="faction-warning">{tr("Your choice is permanent and linked to this wallet. It cannot be changed after confirmation.")}</p>
    <p className="faction-fairness">{tr("Your faction expresses your strategy style. It does not affect prizes, protection or settlement.")}</p>
    {error && <p className="faction-error" role="alert">{error}</p>}
    <footer className="faction-actions"><button className="ghost" disabled={busy} onClick={onClose}>{tr("Cancel")}</button>
      <button className="enter" disabled={!selected || busy || locked} onClick={() => void confirm()}>{busy ? tr("Saving…") : tr("Confirm faction")}</button>
    </footer>
  </dialog>;
}
