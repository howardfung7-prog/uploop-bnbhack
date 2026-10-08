import { FactionSelector } from "./FactionSelector";
import type { FactionId } from "../lib/factions";
import { tr } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import type { FundsMode } from "./Arena";
import type { Tab } from "./Topbar";
import { serverNow } from "../lib/api";
import { fmtUsdt2, phaseOf } from "../lib/arena";
import type { Entry, Funds, Pool } from "../lib/arena";
import { VARIANTS } from "../lib/avatar";
import type { Holding } from "../lib/board";
import { NAME_MAX, displayName, sanitizeName } from "../lib/profile";
import type { Profile } from "../lib/profile";
import { rankHow, rankOf } from "../lib/points";
import type { PlayerPoints, PointsState } from "../lib/points";

interface Props {
  address: string | null;
  profile: Profile;
  faction?: FactionId | null;
  factionEnabled?: boolean;
  onFaction?: (faction: FactionId) => void;
  onChange: (p: Profile) => void;
  onConnect: () => void;
  /// Disconnect: the front end forgets the address and leaves the arena session; the site's
  /// authorisation inside the wallet extension is revoked on a best-effort basis (no error if it cannot be).
  onDisconnect: () => void;
  /// The name of the connected wallet (MetaMask / Binance Wallet / Trust Wallet and so on, §71.28);
  /// null in demo, read-only preview, or when it cannot be recovered — then it just says "Connected".
  walletName: string | null;
  /// My row in the off-chain points table; null when it has not been published or I am not in it.
  points: PlayerPoints | null;
  /// The state of the whole points table. The rank needs it — "the table could not be read" and
  /// "I am not in the table" are two different things: the first shows nothing, the second shows
  /// Rookie (see `rankOf`).
  pointsState: PointsState;
  /// My staked positions (staked only): they decide the "Staked / Not staked" line.
  holdings: Holding[];
  pools: Pool[];
  /// My strategies per match (poolId → strategy). An empty map when the endpoint is not configured
  /// or no wallet is connected.
  myEntries: Map<number, Entry[]>;
  /// The arena balance (§69). null when not signed in or the endpoint is not configured; the
  /// interface writes "—", never 0 (§25).
  funds: Funds | null;
  arenaConfigured: boolean;
  loggedIn: boolean;
  busy: boolean;
  canWrite: boolean;
  onLogin: () => void;
  /// Sign out of the arena (clear the session, keep the wallet connected). Hidden in read-only /
  /// demo mode (§71.22; it used to live on the arena balance card).
  onLogout: () => void;
  /// Open the deposit / withdraw dialog (App renders the dialog itself).
  onFunds: (mode: FundsMode) => void;
  onGo: (t: Tab) => void;
}

/// Top right: the balance sits to the left of the avatar; clicking the avatar opens a panel with
/// the name (with "Edit" on the right) + address + rank · Connected / Disconnect · arena balance
/// and points (deposit / withdraw / sign out, §71.22) · match status · asset dividend status ·
/// go to My Account (the user on 2026-09-11, DECISIONS §69.15).
/// With no name set, the name is simply the first four and last four of the address; clicking the
/// avatar switches to the next pattern (8 of them), and there is no other editing area.
export function ProfileBar({
  address, profile, faction, factionEnabled = false, onFaction, onChange, onConnect, onDisconnect, walletName, points, pointsState, holdings, pools, myEntries,
  funds, arenaConfigured, loggedIn, busy, canWrite, onLogin, onLogout, onFunds, onGo,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Click outside the panel / press Esc to close it (Esc inside the rename box only leaves rename
  // mode — see the stopPropagation in onKeyDown)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (document.querySelector("dialog.faction-dialog[open]")) return; if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog.faction-dialog[open]")) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!address) {
    return <button className="wallet" onClick={onConnect}>{tr("Connect wallet")}</button>;
  }

  // Rank (§71.159): worked out by the back end from the settlement files, and it only ever goes up.
  // Anyone who has not played a paid match is Rookie (the starting point), but when the points table
  // cannot be read nothing at all is written — nobody should watch themselves lose a rank because
  // their connection dropped.
  const rank = rankOf(pointsState, address);

  // Matches: those in play (entry closed, locked, under review) and those still open for entry are
  // counted separately; too-few-entrants / settled / refunded do not count as "in play".
  const now = serverNow();
  let live = 0;
  let enrolled = 0;
  for (const pool of pools) {
    if (!myEntries.get(pool.id)?.length) continue;
    const ph = phaseOf(pool, now);
    if (ph === "closing" || ph === "locked" || ph === "review") live++;
    else if (ph === "open") enrolled++;
  }
  // Dividends: holding a stake counts as receiving dividends (since §71.80 the longest wait is the
  // next 15-minute settlement point, so there is no "warming up" state any more), otherwise not
  // staked. Only staked positions count; certificates sitting in the wallet do not. The exact
  // countdown is on the My Account card.
  const paying = holdings.filter((h) => h.total > 0n).length;
  const dividend = paying > 0 ? { dot: "on", text: <>{tr("Staked ·")} <b>{paying}</b> {paying === 1 ? tr("asset") : tr("assets")}</> }
    : { dot: "off", text: <>{tr("Not staked")}</> };

  /// 🔴 §71.162: this component **only** reports upwards, it does not store anything itself. Where
  /// it is stored, and whether it goes to the back end at all, is App's `changeProfile` to decide —
  /// the nickname follows the **address**, and all this component holds is an `address` prop, which
  /// is not enough to judge "should this be pushed to the back end" (that depends on being signed in).
  const commit = (p: Profile) => onChange(p);
  const startEdit = () => { setDraft(profile.name); setEditing(true); };
  const saveName = () => { if (editing) { commit({ ...profile, name: sanitizeName(draft) }); setEditing(false); } };
  const nextFace = () => commit({ ...profile, variant: (profile.variant + 1) % VARIANTS });
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* if the browser will not give us the clipboard, the user copies it by hand */ }
  };
  const go = (t: Tab) => { setOpen(false); onGo(t); };
  const openFunds = (m: FundsMode) => { setOpen(false); onFunds(m); };
  const toggle = () => setOpen((v) => !v);

  return (
    <div className="me" ref={box}>
      {/* The balance sits against the avatar, the two reading as one control. Not signed in writes
          "—", never 0 (§25); with the endpoint unconfigured this cell is not shown at all */}
      {arenaConfigured && (
        <button className={`tb-bal${funds ? "" : " off"}`} onClick={toggle} title={funds ? tr("Arena balance") : tr("Sign in to see your arena balance")}>
          <span className="k">{tr("Balance")}</span>
          <b>{funds ? fmtUsdt2(funds.arena) : "—"}</b>
          <span className="u">USDT</span>
        </button>
      )}
      <button className="wallet on" onClick={toggle} aria-expanded={open} aria-label={displayName(profile, address)}>
        <Avatar address={address} variant={profile.variant} size={18} />
        <span>{displayName(profile, address)}</span>
      </button>

      {open && (
        <div className="me-panel">
          <div className="me-top">
            <button className="me-face" onClick={nextFace} title={tr("Avatar pattern {0} of {1} — click for the next one. The pattern comes from the address; changing your name does not change it", profile.variant + 1, VARIANTS)}>
              <Avatar address={address} variant={profile.variant} size={40} />
            </button>
            <div className="me-id">
              {editing ? (
                <div className="me-name-row">
                  <input
                    className="me-name"
                    autoFocus
                    value={draft}
                    maxLength={NAME_MAX}
                    placeholder={short(address)}
                    onChange={(e) => setDraft(sanitizeName(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
                    }}
                    onBlur={saveName}
                  />
                  <button className="me-link" onMouseDown={(e) => e.preventDefault()} onClick={saveName}>{tr("Save")}</button>
                </div>
              ) : (
                <div className="me-name-row">
                  <b className="me-who">{displayName(profile, address)}</b>
                  <button className="me-link" onClick={startEdit}>{tr("Edit")}</button>
                </div>
              )}
              <span className="me-addr" title={address}>
                {profile.name ? short(address) : null}
                <button className="me-link" onClick={copy}>{copied ? tr("Copied") : profile.name ? tr("Copy") : tr("Copy address")}</button>
              </span>
              {/* Only the rank goes under the address (§71.159). Until the points table has been
                  read, nothing goes here — it does not write "none". */}
              {rank ? (
                <span className="me-rank">
                  <i className={`chip rank rank-${rank.toLowerCase()}`} title={`${rank} — ${rankHow(rank)}`}>{rank}</i>
                </span>
              ) : null}
            </div>
          </div>
          <div className="me-conn">
            <span><i className="dot on" />{tr("Connected")}{walletName ? ` · ${walletName}` : ""}</span>
            <button className="me-link warn" onClick={() => { setOpen(false); onDisconnect(); }}>{tr("Disconnect")}</button>
          </div>

          <section className="me-bal">
            <span className="me-k">{tr("Arena balance")}</span>
            {!arenaConfigured ? <small className="me-note2">{tr("The arena service is unavailable")}</small>
              : funds ? (
                <>
                  <div className="me-num">{fmtUsdt2(funds.arena)}<small>USDT</small></div>
                  {funds.pending > 0 && <small className="me-note2">{tr("Withdrawal under review")}{funds.pending > 1 ? tr(" · {0} requests", funds.pending) : ""}</small>}
                </>
              )
              : (
                <>
                  <div className="me-num off">—</div>
                  <small className="me-note2">{canWrite ? tr("Sign in to see your balance — signing costs no gas") : tr("Read-only / demo mode: no balance shown")}</small>
                </>
              )}
            {/* Points (§32, counted off-chain): no record writes "—" */}
            <div className="me-pts">
              <span className="me-k">{tr("Legacy points")}</span>
              <b>{points ? points.points.toLocaleString("en-US") : "—"}</b>
            </div>
            {arenaConfigured && (
              <div className="me-btns">
                {!loggedIn
                  ? <button className="me-btn primary" disabled={!canWrite || busy} onClick={onLogin}>{busy ? tr("Signing…") : tr("Sign in to the arena")}</button>
                  : (
                    <>
                      {/* The dialog still opens in read-only / demo mode so the flow can be seen; only
                          the confirm button is disabled (the same rule as on the arena page) */}
                      <button className="me-btn primary" disabled={!funds || busy} onClick={() => openFunds("deposit")}>{tr("Deposit")}</button>
                      <button className="me-btn" disabled={!funds || busy || funds.arena === 0n} onClick={() => openFunds("withdraw")}>{tr("Withdraw")}</button>
                      {canWrite && <button className="me-link" onClick={() => { setOpen(false); onLogout(); }}>{tr("Sign out")}</button>}
                    </>
                  )}
              </div>
            )}
          </section>

          <button className="me-line" onClick={() => go("arena")}>
            <span className="me-k">{tr("Matches")}</span>
            <span className="me-v">
              {!arenaConfigured ? <>—</>
                : live + enrolled === 0 ? <><i className="dot off" />{tr("No matches")}</>
                : (
                  <>
                    <i className={`dot ${live > 0 ? "on" : "warm"}`} />
                    {live > 0 && <>{tr("In play")} <b>{live}</b>{tr("||matches, after a count")}</>}
                    {live > 0 && enrolled > 0 && " · "}
                    {enrolled > 0 && <>{tr("Entry open")} <b>{enrolled}</b>{tr("||matches, after a count")}</>}
                  </>
                )}
            </span>
            <span className="me-arrow">›</span>
          </button>
          <button className="me-line" onClick={() => go("mint")}>
            <span className="me-k">{tr("Fee share")}</span>
            <span className="me-v"><i className={`dot ${dividend.dot}`} />{dividend.text}</span>
            <span className="me-arrow">›</span>
          </button>
          <FactionSelector address={address} faction={faction} enabled={factionEnabled}
            onSelected={onFaction ?? (() => {})} />
          <button className="me-line strong" onClick={() => go("mine")}>
            <span className="me-v">{tr("Go to My Account")}</span>
            <span className="me-arrow">→</span>
          </button>
        </div>
      )}
    </div>
  );
}

/// The first four and last four of the address (4 characters either side of the `0x`).
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
