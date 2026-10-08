import { PERIOD, isZh, tr } from "../lib/i18n";
import { useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import type { Address } from "viem";
import { apiGet, apiErrorText } from "../lib/api";
import { isDemo } from "../lib/demo";
import { MAX_DRAFTS, draftFits, loadDrafts, removeDraft, saveDraft, updateDraft } from "../lib/drafts";
import type { Draft } from "../lib/drafts";
import type { Ticker } from "../lib/board";
import { CLASS_HINT, CLASS_LABEL, CLASS_ORDER } from "../lib/ticker";
import { normalize, passes, validate, tierFor, tierRange, POOLS, POOL_KEYS } from "../lib/strategy";
import type { Leg, PoolKey, Side } from "../lib/strategy";

/// Building an index strategy. The long assets and the short assets sit side by side either side of
/// a central spine, the asset pool is below them, and the entry check is at the very bottom.
/// Up to 5 strategies can be saved and any of them edited at any time: click "Edit" to load one, and
/// saving updates it in place rather than making a copy (§25).
export function Builder({ board, account = null, onGo }: { board: Ticker[]; account?: Address | null; onGo?: (tab: "home" | "mint" | "market" | "meme" | "build" | "arena" | "mine") => void }) {
  const [demoSeed] = useState(() => isDemo() ? loadDrafts(account).find(d => d.pool === "three") : undefined);
  const [poolKey, setPoolKey] = useState<PoolKey>(demoSeed?.pool ?? "three");
  const [legs, setLegs] = useState<Leg[]>(() => demoSeed?.legs ?? []);
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts(account));
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState(demoSeed?.name ?? "");
  /// The saved strategy currently being edited; null = a new one.
  const [editing, setEditing] = useState<string | null>(demoSeed?.id ?? null);
  const [manageStrategies, setManageStrategies] = useState(false);
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [historyCache, setHistoryCache] = useState(() => readHistoryCache(account));
  const [clock, setClock] = useState(Date.now);
  const requestId = useRef(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    const sync = () => setHistoryCache(readHistoryCache(account));
    window.addEventListener("storage", sync);
    return () => { clearInterval(timer); window.removeEventListener("storage", sync); requestId.current++; };
  }, [account]);

  async function backtest(draft: Draft) {
    const cache = readHistoryCache(account);
    if (loadingHistory || (cache[draft.id]?.until ?? 0) > Date.now()) return;
    const id = ++requestId.current;
    const entry: HistoryEntry = { draft, until: Date.now() + HISTORY_COOLDOWN };
    cache[draft.id] = entry;
    writeHistoryCache(cache, account);
    setHistoryCache(cache);
    setClock(Date.now());
    setLoadingHistory(true);
    setHistory({ draft });
    try {
      const doc = isDemo() ? demoHistory(draft) : await apiGet<HistoryDoc>("/strategy-history", {
        symbols: draft.legs.map(l => l.symbol.replace(/^u/i, "")).join(","),
        sides: draft.legs.map(l => l.side).join(","),
      });
      const next = { ...readHistoryCache(account), [draft.id]: { ...entry, doc } };
      writeHistoryCache(next, account);
      if (requestId.current === id) {
        setHistoryCache(next);
        setHistory(current => current?.draft.id === draft.id ? { draft, doc } : current);
      }
    } catch (error) {
      // Failed reads can be retried; they never leave an empty 15-minute lockout.
      const next = readHistoryCache(account);
      delete next[draft.id];
      writeHistoryCache(next, account);
      if (requestId.current === id) {
        setHistoryCache(next);
        setHistory(current => current?.draft.id === draft.id ? { draft, error: apiErrorText(error) } : current);
      }
    } finally {
      if (requestId.current === id) setLoadingHistory(false);
    }
  }
  const full = drafts.length >= MAX_DRAFTS;
  const rules = POOLS[poolKey];

  // Every asset on the staking shelf is selectable. Staking status only controls whether
  // that asset receives dividend attribution after settlement; it must not gate long/short
  // strategy construction or arena entry.
  const live = useMemo(() => board, [board]);
  const locked = useMemo(() => [] as Ticker[], []);
  const used = useMemo(() => new Set(legs.map((l) => l.id)), [legs]);

  const bps = useMemo(() => normalize(legs), [legs]);
  const checks = useMemo(() => validate(legs, rules), [legs, rules]);
  const ok = passes(checks);

  const longs = legs.filter((l) => l.side === "long");
  const shorts = legs.filter((l) => l.side === "short");
  const longBps = longs.reduce((a, l) => a + (bps.get(l.id) ?? 0), 0);
  const shortBps = shorts.reduce((a, l) => a + (bps.get(l.id) ?? 0), 0);

  const fullLegs = legs.length >= rules.maxLegs;

  function add(t: Ticker, side: Side) {
    // 🔒 The ceiling follows the tier (3 / 5 / 50), and the buttons disable themselves too. The
    // functional update tests for duplicates and fullness against the very latest state, so even a
    // double click cannot slip in a duplicate or an extra asset.
    setLegs((ls) => (ls.some((l) => l.id === t.id) || ls.length >= rules.maxLegs ? ls : [...ls, { id: t.id, symbol: t.symbol, side }]));
  }
  const flip = (id: number) => setLegs((ls) => ls.map((l) =>
    l.id === id ? { ...l, side: l.side === "long" ? "short" : "long" } : l));
  const drop = (id: number) => setLegs((ls) => ls.filter((l) => l.id !== id));

  function save() {
    const d = editing ? updateDraft(editing, poolKey, legs, name, account) : saveDraft(poolKey, legs, name, account);
    setDrafts(loadDrafts(account));
    if (!d) { setEditing(null); return; } // full, or it was deleted: refresh the list and let the button text explain
    setEditing(d.id);      // carrying on editing after creating it updates the same one
    setName(d.name);
    setSaved(d.id);

    setTimeout(() => setSaved(null), 2200);
  }
  function open(d: Draft) {
    setPoolKey(d.pool);
    setLegs(d.legs);
    setName(d.name);
    setEditing(d.id);

  }
  function fresh() {
    setLegs([]);
    setName("");
    setEditing(null);

  }
  function discard(id: string) {
    removeDraft(id, account);
    setDrafts(loadDrafts(account));
    if (editing === id) setEditing(null);
    if (history?.draft.id === id) setHistory(null);
  }
  /// §39: when the asset count exactly fits a different tier, say so (picked 5T but only put in 3
  /// assets → point out that 3T would work).
  const fitsOther = !ok && legs.length > 0 ? tierFor(legs.length) : null;
  const saveLabel = saved ? tr("Saved")
    : !ok ? (legs.length === 0 ? tr("Pick some assets first") : tr("{0} failed — cannot save", checks.find((c) => !c.ok)?.label ?? tr("Check")))
    : editing ? tr("Save changes")
    : full ? tr("Full at {0}", MAX_DRAFTS)
    : tr("Save strategy");

  const failing = checks.filter((c) => !c.ok).length;
  const managerLabel = manageStrategies && drafts.length > 0 ? tr("Close strategy manager") : tr("Manage strategies");

  const eventLinks = (pool: PoolKey) => pool === "three"
    ? [{ label: tr("Summit race"), href: "#arena" }, { label: tr("Activity match"), href: "#arena/activity" }]
    : pool === "five"
      ? [{ label: tr("Daily arena"), href: "#arena/daily" }, { label: tr("Activity match"), href: "#arena/activity" }]
      : [{ label: tr("Activity match"), href: "#arena/activity" }];
  const eventLabel = (pool: PoolKey) => pool === "three"
    ? tr("Summit race / Activity match")
    : pool === "five" ? tr("Daily arena / Activity match") : tr("Activity match");
  const goEvent = (href: string) => {
    setManageStrategies(false);
    // Set the parent tab first, then restore the competition sub-route. The generic tab
    // handler writes `#arena`; doing this in the opposite order would erase `/daily` or
    // `/activity` before the hashchange listener can read it.
    onGo?.("arena");
    location.hash = href.slice(1);
  };

  return (
    <div className="builder">
      <div className="tier-head">
        <h2>{tr("Build an index strategy")}</h2>
        <span className="cnt">{legs.length}<small>/ {rules.minLegs === rules.maxLegs ? rules.maxLegs : `${rules.minLegs}–${rules.maxLegs}`} {tr("assets")}</small></span>
        <span className="hint">
          <b className={`tcode ${rules.key}`}>{rules.code}</b> {tr("format:")} <b>{tierRange(rules)}</b>
        </span>
        <div className="builder-controls">
          <div className="segs">
            {POOL_KEYS.map((k) => (
              <button key={k} className={poolKey === k ? "on" : ""} aria-label={`${POOLS[k].code} ${eventLabel(k)}`} onClick={() => setPoolKey(k)}>
                <b className={`tcode ${k}`}>{POOLS[k].code}</b>
                <span className="seg-label">{eventLabel(k)}</span>
              </button>
            ))}
          </div>
          <button
            className={`builder-manage ${manageStrategies ? "on" : ""}`}
            type="button"
            disabled={drafts.length === 0}
            title={drafts.length === 0 ? tr("No saved strategies") : managerLabel}
            aria-label={drafts.length === 0 ? tr("No saved strategies") : managerLabel}
            aria-expanded={manageStrategies}
            aria-controls="builder-strategy-manager"
            onClick={() => setManageStrategies(value => !value)}
          >
            {managerLabel} <small>{drafts.length}/{MAX_DRAFTS}</small>
          </button>
        </div>
      </div>

      {manageStrategies && drafts.length > 0 && <section id="builder-strategy-manager" className="tier builder-library">
        <div className="tier-head"><h2>{tr("Manage strategies")}</h2><span className="hint">{tr("Edit, delete or enter with a saved strategy")}</span></div>
        <div className="drafts">
          {drafts.map((d) => {
            const fits = draftFits(d);
            const cached = historyCache[d.id];
            const remaining = Math.max(0, Math.ceil(((cached?.until ?? 0) - clock) / 1000));
            const canBacktest = fits && (d.pool === "three" || d.pool === "five");
            return <div className={`draft${saved === d.id ? " fresh" : ""}${editing === d.id ? " editing" : ""}${fits ? "" : " bad"}${history?.draft.id === d.id ? " with-history" : ""}`} key={d.id}>
              <span className="nm"><b className={`tcode ${d.pool}`}>{POOLS[d.pool].code}</b>{d.name}{editing === d.id && <i className="tag">{tr("Editing")}</i>}{!fits && <i className="tag bad">{tr("Wrong asset count · cannot enter")}</i>}</span>
              <span className="meta">{d.legs.length} {tr("assets ·")} <b className="l">{d.legs.filter((l) => l.side === "long").length} {tr("long")}</b> <b className="s">{d.legs.filter((l) => l.side === "short").length} {tr("short")}</b></span>
              <span className="when">{new Date(d.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="d-actions"><span className="d-go">
                <button className="ghost" onClick={() => { open(d); setManageStrategies(false); }}>{editing === d.id ? tr("Reload") : fits ? tr("Edit") : tr("Fix")}</button>
                {fits && eventLinks(d.pool).map(link => <button className="ghost" key={link.href} onClick={() => goEvent(link.href)}>{tr("Enter · {0}", link.label)}</button>)}
                {canBacktest && <button className="ghost backtest-button" disabled={loadingHistory || remaining > 0} onClick={() => backtest(d)} title={tr("Each strategy can be backtested once every 15 minutes.")}>{loadingHistory && history?.draft.id === d.id ? tr("Backtesting…") : remaining > 0 ? tr("Backtest · {0}", countdown(remaining)) : tr("Backtest")}</button>}
                {canBacktest && cached?.doc && history?.draft.id !== d.id && <button className="ghost" disabled={loadingHistory} onClick={() => setHistory({ draft: cached.draft, doc: cached.doc })}>{tr("View result")}</button>}
                {history?.draft.id === d.id && <button className="ghost" onClick={() => setHistory(null)}>{tr("Collapse backtest")}</button>}
                <button className="ghost" onClick={() => discard(d.id)}>{tr("Delete strategy")}</button>
              </span></span>
              {history?.draft.id === d.id && <StrategyHistory view={history} />}
            </div>;
          })}
        </div>
        {!history && <div className="strategy-history-empty history-prompt">{tr("Choose Backtest on a saved 3T / 5T strategy to view its historical performance. Once every 15 minutes per strategy.")}</div>}
      </section>}

      {/* ---- the long and short sides ---- */}
      <div className="match">
        {(["long", "short"] as Side[]).map((side, idx) => {
          const list = side === "long" ? longs : shorts;
          const sideBps = side === "long" ? longBps : shortBps;
          return (
            <div className={`side ${side}`} key={side} style={{ order: idx === 0 ? 0 : 2 }}>
              <div className="side-head">
                <span className="t">{side === "long" ? tr("LONG") : tr("SHORT")}</span>
                <span className="n">{list.length} {list.length === 1 ? tr("asset") : tr("assets")} · {(sideBps / 100).toFixed(1)}%</span>
              </div>
              {list.length === 0 && (
                <div className="side-empty">
                  {side === "long" ? tr("No long assets picked yet") : tr("No short assets picked yet")}<br />
                  {tr("Pick an asset below and set it")} <b>{side === "long" ? tr("Long") : tr("Short")}</b>
                </div>
              )}
              {list.map((l, i) => (
                <div className="leg" key={l.id}>
                  <span className="jn">{String(i + 1).padStart(2, "0")}</span>
                  <span className="sym">{l.symbol}</span>
                  <span className="bps">{((bps.get(l.id) ?? 0) / 100).toFixed(2)}%</span>
                  <button className="mini" onClick={() => flip(l.id)} title={tr("Switch between long and short")}>⇄</button>
                  <button className="mini x" onClick={() => drop(l.id)} title={tr("Remove this asset")}>×</button>
                </div>
              ))}
            </div>
          );
        })}

        <div className="spine" style={{ order: 1 }}>
          <span className="vs">L/S</span>
          <div className="vbar" title={tr("Long {0}% · short {1}%", (longBps / 100).toFixed(1), (shortBps / 100).toFixed(1))}>
            <i className="l" style={{ flexGrow: longBps || (legs.length ? 0 : 1) }} />
            <i className="s" style={{ flexGrow: shortBps || (legs.length ? 0 : 1) }} />
          </div>
          <span className="pc l">{(longBps / 100).toFixed(0)}</span>
          <span className="pc s">{(shortBps / 100).toFixed(0)}</span>
        </div>
      </div>

      {/* ---- the asset pool ---- */}
      <div className="bench">
        <div className="b-sub">
          {tr("Asset pool · listed assets")} <span>{live.length - used.size} / {live.length} {tr("available")}{fullLegs && tr(" · full at {0}", rules.maxLegs)}</span>
        </div>
        {live.length === 0 && (
          <div className="bench-list">
            <span className="bench-empty">{tr("No listed staking assets are available yet.")}</span>
          </div>
        )}
        {/* Grouped by class: Crypto / Stock / Other. Every listed staking asset stays selectable;
            the small stake indicator is informational and does not gate either direction. */}
        {live.length > 0 && CLASS_ORDER.map((cls) => {
          const group = live.filter((t) => t.cls === cls);
          return (
            <div className="bench-cls" key={cls}>
              <div className="cls-h">
                <b>{CLASS_LABEL[cls]}</b>
                <span>{group.length ? tr("{0} / {1} available", group.length - group.filter((t) => used.has(t.id)).length, group.length) : tr("No listed assets")}</span>
                <small>{CLASS_HINT[cls]}</small>
              </div>
              {group.length > 0 && (
                <div className="bench-list">
                  {group.map((t) => {
                    const on = used.has(t.id);
                    return (
                      <div className={`pick${on ? " used" : ""}`} key={t.id}>
                        <span className="s">{t.symbol}{t.status === "live" && <small className="stake-live"> · {tr("Bonus")}</small>}</span>
                        {on ? (
                          <span className="in">{tr("Picked")}</span>
                        ) : (
                          <span className="pk" title={fullLegs ? tr("Full at {0} — remove one first", rules.maxLegs) : undefined}>
                            <button className="l" disabled={fullLegs} onClick={() => add(t, "long")}>{tr("Long")}</button>
                            <button className="s2" disabled={fullLegs} onClick={() => add(t, "short")}>{tr("Short")}</button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {locked.length > 0 && (
          <>
            <div className="b-sub muted">
              {tr("Not active · cannot be picked")} <span>{locked.length}</span>
            </div>
            <div className="bench-list">
              {locked.slice(0, 16).map((t) => (
                <div className="pick locked" key={t.id} title={tr("This asset is not active yet. Deposit a supported token and stake the certificate, and it can be used in a strategy.")}>
                  <span className="s">{t.symbol}</span>
                  <span className="in">{tr("Not active")}</span>
                </div>
              ))}
              {locked.length > 16 && <span className="pick locked more">{tr("… and")} {locked.length - 16} {tr("more")}</span>}
            </div>
          </>
        )}
      </div>

      {/* ---- the entry check ---- */}
      <div className={`ref${ok ? " ok" : ""}`}>
        <div className="ref-verdict">
          <span className="k">{tr("Entry check ·")} {rules.code}</span>
          <span className="v">{ok ? tr("Passed") : legs.length === 0 ? tr("Empty strategy") : tr("{0} failed", failing)}</span>
        </div>
        <div className="checks">
          {checks.map((c) => (
            <div className={`chk${c.ok ? " ok" : ""}`} key={c.label}>
              <span className="m">{c.ok ? "✓" : "✕"}</span>
              <span className="k">{c.label}</span>
              <span className="d">{c.detail}</span>
            </div>
          ))}
        </div>
        <div className="b-actions">
          <button className="ghost" onClick={() => setLegs([])} disabled={!legs.length}>
            {tr("Clear")}
          </button>
          {editing && (
            <button className="ghost" onClick={fresh} title={tr("Start a new strategy")}>
              {tr("New")}
            </button>
          )}
          <input
            className="name-in"
            value={name}
            maxLength={24}
            placeholder={tr("Strategy name (optional)")}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="enter" disabled={!ok || (full && !editing)} onClick={save}>
            {saveLabel}
          </button>
        </div>
        {editing && (
          <div className="b-editing">
            {tr("Editing")} <b>{drafts.find((d) => d.id === editing)?.name ?? tr("(deleted)")}</b> {tr("— saving updates this saved strategy.")}
          </div>
        )}
        {fitsOther && fitsOther !== poolKey && (
          <div className="b-editing warn">
            {tr("You have")} {legs.length} {tr("assets, which fits")} <b>{POOLS[fitsOther].code}</b> ({POOLS[fitsOther].name}){tr(PERIOD)}
            {tr("To enter a")} {rules.code} {tr("match, add or remove assets to reach")} {tierRange(rules)}{tr(", or")}
            <button className="ghost inl" onClick={() => setPoolKey(fitsOther)}>{tr("switch to")} {POOLS[fitsOther].code} {tr("and save")}</button>{tr(PERIOD)}
          </div>
        )}
        {!ok && legs.length > 0 && !fitsOther && (
          <div className="b-editing warn">
            {legs.length} {tr("assets do not match any format: 3T requires")} {POOLS.three.minLegs}{tr(", 5T takes")} {POOLS.five.minLegs}{tr(", and NT takes")} {POOLS.open.minLegs}–{POOLS.open.maxLegs}{tr(".||after the NT range")}
          </div>
        )}
        {full && !editing && ok && (
          <div className="b-editing warn">
            {tr("You have reached the limit of")} {MAX_DRAFTS} {tr("saved strategies.")} <b>{tr("Edit")}</b> {tr("an existing one, or delete one and start again.")}
          </div>
        )}
      </div>

    </div>
  );
}

interface HistoryCell { interval: "15m" | "1d" | "1w"; index: number; start: number; end: number; return_bps: string }
interface HistoryDoc { intervals: HistoryCell[]; assets: string[]; generated_at: number; history: true }

const HISTORY_COOLDOWN = 15 * 60 * 1000;
const historyStorageKey = (account?: string | null) => {
  if (isDemo()) return "uploop.strategy-history.demo";
  const owner = account?.trim().toLowerCase();
  return owner ? `uploop.strategy-history.${owner}` : "uploop.strategy-history.guest";
};
interface HistoryEntry { draft: Draft; until: number; doc?: HistoryDoc }
interface HistoryView { draft: Draft; doc?: HistoryDoc; error?: string }
type HistoryCache = Record<string, HistoryEntry>;
function readHistoryCache(account?: string | null): HistoryCache {
  try {
    const raw = JSON.parse(localStorage.getItem(historyStorageKey(account)) ?? "{}");
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => {
      const entry = value as HistoryEntry;
      return entry && Number.isFinite(entry.until) && entry.draft?.id && Array.isArray(entry.draft.legs)
        && (!entry.doc || Array.isArray(entry.doc.intervals));
    })) as HistoryCache;
  } catch { return {}; }
}
function writeHistoryCache(cache: HistoryCache, account?: string | null) {
  try {
    const entries = Object.entries(cache).sort((a, b) => b[1].until - a[1].until).slice(0, 30);
    localStorage.setItem(historyStorageKey(account), JSON.stringify(Object.fromEntries(entries)));
  } catch { /* A storage restriction must not prevent viewing a backtest. */ }
}
function countdown(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
function demoHistory(draft: Draft): HistoryDoc {
  const now = Math.floor(Date.now() / 1000);
  const quarterEnd = Math.floor(now / 900) * 900;
  const dayEnd = Math.floor(now / 86400) * 86400;
  const weekEnd = Math.floor((now - 4 * 86400) / 604800) * 604800 + 4 * 86400;
  return { intervals: [
    ...["26", "-11", "17", "2"].map((return_bps, index): HistoryCell => ({
      interval: "15m", index, start: quarterEnd - (4 - index) * 900, end: quarterEnd - (3 - index) * 900, return_bps,
    })),
    { interval: "1d", index: 0, start: dayEnd - 86400, end: dayEnd, return_bps: "622" },
    { interval: "1w", index: 0, start: weekEnd - 604800, end: weekEnd, return_bps: "813" },
  ], assets: draft.legs.map(l => l.symbol), generated_at: now, history: true };
}
function StrategyHistory({ view: { draft, doc, error } }: { view: HistoryView }) {
  const locale = isZh() ? "zh-CN" : "en-GB";
  const date = (t: number) => new Date(t * 1000).toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
  const time = (t: number) => new Date(t * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const label = (c: HistoryCell) => c.interval === "15m"
    ? [tr("4th previous 15 min"), tr("3rd previous 15 min"), tr("2nd previous 15 min"), tr("Previous 15 min")][c.index]
    : c.interval === "1d" ? tr("Previous complete day") : tr("Previous complete week");
  const value = (c: HistoryCell) => { const n = Number(c.return_bps) / 100; return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; };
  return <section className="strategy-history" aria-label={tr("Historical performance")} aria-live="polite">
    <div className="strategy-history-head"><div><b>{tr("Historical performance")}{isDemo() && <em className="strategy-history-demo">{tr("Demo data")}</em>}</b><p>{draft.name} <span className={`tcode ${draft.pool}`}>{draft.pool === "three" ? "3T" : "5T"}</span></p></div></div>
    <p className="strategy-history-description">{tr("Last 4 completed 15-minute intervals, oldest to newest. Each return is calculated independently.")}</p>
    {error ? <div className="strategy-history-empty" role="alert">{error}</div> : !doc ? <div className="strategy-history-empty">{tr("Loading historical performance…")}</div> : <>
      <div className="strategy-history-grid">
        {doc.intervals.map(c => <div className={`strategy-history-cell ${Number(c.return_bps) >= 0 ? "history-positive" : "history-negative"}`} key={`${c.interval}-${c.index}`}>
          <h3>{label(c)}</h3><strong>{value(c)}</strong>
          <span className="history-time">{c.interval === "15m" ? `${time(c.start)} – ${time(c.end)}` : `${date(c.start)} – ${date(c.end)}`}</span>
          <span className="history-date">{c.interval === "15m" ? (date(c.start) === date(c.end) ? date(c.start) : `${date(c.start)} – ${date(c.end)}`) : tr("Completed interval")}</span>
        </div>)}
      </div>
      <p className="strategy-history-note">{tr("Updated {0} · Times shown in your local time · Historical performance is not a forecast", `${date(doc.generated_at)} ${time(doc.generated_at)}`)}</p>
    </>}
  </section>;
}
