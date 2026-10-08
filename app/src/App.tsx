import { tr } from "./lib/i18n";
import { useDeposit } from "./lib/use-deposit";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { addresses, marketConfigured, coreConfigured, CHAIN_LABEL } from "./lib/chain-config";
// The certificate set the contract colleague delivered on 2026-09-15 (§71.80), generated from the
// delivery package's abi/*.json by `npm run abi:certs`
import { burnBoard, cachedBoard, closedPools, saveBoard, mintCost, withPairs } from "./lib/board-model";
import type { Holding, Lot, MintQuote, Pick, Ticker } from "./lib/board";
import {
  DEMO_ACCOUNT, DEMO_FEE_BPS, demoBoard, demoDepositAddress, demoDeposits, demoMyEntries, demoPoolLive, demoQuotes, demoAssets, demoEntries, demoFeatured, demoFunds, demoHoldings, demoJackpot, demoListings, demoMints, demoPoints, demoPools, demoResults, demoStats, demoWalletLots, demoWithdrawals, isDemo, demoMemePools, demoMemeLots, demoMemeHoldings, demoBurnBoard, demoBurnListings, demoNotices,
} from "./lib/demo";
import { FEATURED, KINDS, fmtUsdt, loadDepositAddress, loadDeposits, loadEntries, loadJackpot, loadMyEntries, loadPoolLive, loadPools, loadResults, loadStats, loadWithdrawals } from "./lib/arena";
import { POOLS, legCountIssue } from "./lib/strategy";
import type { Entry, Funds, JackpotState, Pool } from "./lib/arena";
import { ApiError, apiErrorText, apiPost, arenaConfigured, authToken, newIdemKey, serverNow } from "./lib/api";
// §71.120: ask the platform once on page open for the contract addresses (fall back to the ones
// baked in at build time), see lib/certindex.ts
import { EMPTY_STATUS, isPaused, loadStatus } from "./lib/status";
import { loadNotices } from "./lib/notices";
import type { Notice } from "./lib/notices";
import type { SiteStatus } from "./lib/status";
import { loadSession, login as apiLogin, logout as apiLogout, saveProfileToServer } from "./lib/session";
import type { Session } from "./lib/session";
import { bindPendingRef } from "./lib/referral";
import { connectEntry, forget, onAccountsChanged, resume, revoke } from "./lib/wallet";
import type { WalletEntry } from "./lib/wallet";
import { bareSym } from "./lib/ticker";
import { loadPoints, pointsOf } from "./lib/points";
import { costOf, floorsOf, sortListings } from "./lib/market-model";
import type { Floor, Listing } from "./lib/market";
import { MARKET_MAX_AGE_SECONDS, QUOTE_MS, emptyQuotes, loadQuotes } from "./lib/quotes";
import type { Quotes } from "./lib/quotes";
import { cachedAssets, loadAssets } from "./lib/assets";
import type { AssetsState } from "./lib/assets";
import type { MemePool } from "./lib/meme";
import { redeemBusyId, stakeBusyId } from "./lib/busy";
import type { PointsState } from "./lib/points";
import type { Draft } from "./lib/drafts";
import { Topbar } from "./components/Topbar";
import type { Tab } from "./components/Topbar";
import { PageHead } from "./components/PageHead";
import { Home } from "./components/Home";
import { Ribbon } from "./components/Ribbon";
import { SiteWall } from "./components/Wall";
import type { ArenaSource, FundsMode } from "./components/Arena";
import type { OneClickSubmit } from "./lib/one-click-stake";
import { Footer } from "./components/Footer";
import { readSite } from "./components/site-route";
import type { Site } from "./components/site-route";
import { ProfileBar } from "./components/ProfileBar";
import { WalletPicker } from "./components/WalletPicker";
import { loadProfile, saveProfile } from "./lib/profile";
import type { Profile } from "./lib/profile";

// Keep the first route small on mobile. These pages are independent entry points and are
// downloaded only when the user opens them.
const Account = lazy(() => import("./components/Account").then(m => ({ default: m.Account })));
const Builder = lazy(() => import("./components/Builder").then(m => ({ default: m.Builder })));
const Market = lazy(() => import("./components/Market").then(m => ({ default: m.Market })));
const Meme = lazy(() => import("./components/Meme").then(m => ({ default: m.Meme })));
const StakePools = lazy(() => import("./components/StakePools").then(m => ({ default: m.StakePools })));
/// The chain code (viem, the ABIs, every RPC reader and wallet write), loaded on first use rather than with the page
/// (§71.174, see lib/chain-lazy.ts). Handlers take what they need from it at their top; the module is cached after
/// the first call, so later calls cost nothing.
const chainLib = () => import("./lib/chain-lazy");
const StakeFaq = lazy(() => import("./components/StakeFaq").then(m => ({ default: m.StakeFaq })));
// The arena (with its two game boards), the funds dialog and the information pages are lazy too
// (§71.174): the home page needs none of them for its first paint, and together they were ~150 KB
// of the main bundle. The two arena components come from one module, so they share one chunk.
const Arena = lazy(() => import("./components/Arena").then(m => ({ default: m.Arena })));
const FundsModal = lazy(() => import("./components/Arena").then(m => ({ default: m.FundsModal })));
const SitePage = lazy(() => import("./components/SitePage").then(m => ({ default: m.SitePage })));

export default function App() {
  // Hash routing: a tab can be linked to, bookmarked, and survives a refresh
  const [tab, setTabState] = useState<Tab>(() => readHash());
  // The site information pages (§71.41): `#notices` / `#help` / `#disclaimer` / `#privacy`. They are
  // not navigation tabs; the top bar stays as it is (clicking any item returns to the main site) and
  // the page body is replaced wholesale by the information page.
  const [site, setSiteState] = useState<Site | null>(() => readSite());
  const setTab = (t: Tab) => { location.hash = t; setTabState(t); setSiteState(null); };
  // A new page opens at its top (§71.181). Hash routing kept the old scroll offset, so following a
  // link from far down one page landed partway down the next. Arena sub-routes keep the same tab and
  // are left alone; the first render is skipped so a refresh keeps the browser's own restore.
  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    if (scrollY > 0) scrollTo({ top: 0 });
  }, [tab]);

  // ?demo=1 demo data: the chain is not read, nothing can be written, the banner stays up. See lib/demo.ts.
  const demo = isDemo();
  // ?as=0x… previews any address read-only. When someone reports a problem the interface can be
  // reproduced without them handing over their wallet; writing still needs a real wallet, so this
  // parameter only affects reads.
  const preview = new URLSearchParams(location.search).get("as") as Address | null;
  // In demo mode the demo account is signed in straight away: open the page and there are holdings, a
  // balance and strategies to look at, with no need to press "Connect wallet" first.
  const [account, setAccount] = useState<Address | null>(
    preview && /^0x[0-9a-fA-F]{40}$/.test(preview) ? preview : demo ? DEMO_ACCOUNT : null
  );
  // A read-only preview is read-only (since §71.28 it no longer checks for a wallet extension): the
  // preview address is not one of your own, so a write could never be signed anyway.
  const readOnly = !!preview || demo;
  // Start from the board this browser last read (§71.174), so a refresh does not blank the chain pages.
  const [board, setBoard] = useState<Ticker[]>(() => (demo ? [] : cachedBoard() ?? []));
  const boardRef = useRef(board);
  boardRef.current = board;
  const boardReadAt = useRef(0);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  // Unstaked certificates in the wallet, split by batch (§71.80): to sell n certs of a batch on the
  // market, or to stake / redeem n certs of a batch on the account page, you first have to know which
  // batches are in hand.
  // 🔴 §69.16 was relaxed for exactly this (user, 2026-09-15): only the asset certificates we issue
  // ourselves are listed; USDT / asset-token / MEME balances in the wallet are still never read.
  const [lots, setLots] = useState<Lot[]>([]);
  // Deposit quotes (§71.80): how much of the asset token one certificate costs, through the certificate
  // contract's own oracle (no minting fee, §71.84).
  // An asset missing from the table = the chain cannot price it (no pool liquidity / spot too far from
  // the TWAP) → the card shows "—" and depositing is disabled.
  const [mints, setMints] = useState<Map<number, MintQuote>>(new Map());
  // Refresh performance counts while a race is running; reputation keeps its own rules.
  const [points, setPoints] = useState<PointsState>({ kind: "none" });
  useEffect(() => {
    let alive = true;
    const refresh = () => (demo ? Promise.resolve(demoPoints()) : loadPoints()).then((s) => { if (alive) setPoints(s); });
    void refresh();
    const timer = demo ? undefined : setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [demo]);
  const [pools, setPools] = useState<Pool[]>([]);
  // The perfect-score jackpot (§71.38, `GET /jackpot`): refreshed on the same tick as the pools; with a
  // wallet address it also brings back "my share count". If it cannot be read the interface writes "—".
  const [jackpot, setJackpot] = useState<JackpotState>({ kind: "none" });
  // Site status (§71.40, `GET /status`): the operator's emergency switches and notice. Refreshed on the
  // same tick as the pools; if it cannot be read the previous value is kept (initially = all on, no notice).
  const [status, setStatus] = useState<SiteStatus>(EMPTY_STATUS);
  // Notice history (§71.41, `GET /notices`): the home page notice board takes the first 5, the `#notices`
  // page shows all of them. Notices are not live data, so once every 60 seconds is enough; if they cannot
  // be read it stays null (the interface writes "No notices yet" rather than inventing content).
  const [notices, setNotices] = useState<Notice[] | null>(null);
  // Arena balance (§26, ledger §69). Null when not signed in or when the endpoint is not configured, and
  // the interface writes "shown after you sign in". Wallet USDT is not read (§69.15).
  const [funds, setFunds] = useState<Funds | null>(null);
  // The arena session (§69.3): if GET /me goes through, you are signed in. Only a session whose address
  // matches the current wallet counts as "signed in".
  const [session, setSession] = useState<Session | null>(null);
  // My strategies per match (poolId → strategy), which feeds the "in progress / entry open" counts in the
  // avatar popover (§69.15). A public endpoint, no sign-in needed.
  const [myEntries, setMyEntries] = useState<Map<number, Entry[]>>(new Map());
  // The deposit / withdraw dialog lives in App: both the arena page and the avatar popover open it (§69.15).
  const [fundsModal, setFundsModal] = useState<{ mode: FundsMode; amount?: bigint } | null>(null);
  // The "Connect wallet" picker (§71.28) and the name of the wallet currently connected (MetaMask etc.);
  // null when nothing is connected, or in demo / read-only preview.
  const [picker, setPicker] = useState(false);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [loginStage, setLoginStage] = useState<"prepare" | "wallet" | "verify" | null>(null);
  const loginLock = useRef(false);
  // Display name + avatar pattern. 🔴 Since §71.162 it follows the **wallet address**, not this machine:
  // the real copy lives on the back end (read from `GET /me`'s `profile`, written by `POST /profile`), and
  // this state is only a per-address cache on this device, so a name can be chosen before signing in and
  // the short address does not flash on refresh.
  const [profile, setProfile] = useState<Profile>(() => loadProfile(account));
  // "This address has already reconciled its profile with the back end once." 🔴 It has to be a ref; the
  // hydrate effect must not hang off `[session]` directly: `refresh()` below calls `setSession()` with a
  // fresh object every 12 seconds, so hanging off it would overwrite whatever the user has just typed and
  // not yet submitted, every 12 seconds. The cost is that a name changed on another device only shows up
  // here after a page refresh.
  const profileSynced = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chainReady, setChainReady] = useState(() => demo || coreConfigured());

  // The arena endpoint (VITE_API_BASE, §69) may not be configured yet. Demo mode counts as configured and signed in.
  const configured = demo || arenaConfigured();
  // Emergency switches (§71.40): while entries / withdrawals are paused the buttons grey out and say
  // "paused". Demo mode is not affected by the back office.
  const entriesPaused = !demo && isPaused(status, "entries");
  const withdrawalsPaused = !demo && isPaused(status, "withdrawals");
  const competitionAvailability = demo ? undefined : {
    summit: !isPaused(status, "summit"),
    daily: !isPaused(status, "daily"),
    activity: !isPaused(status, "activity"),
    rooms: { 5: !isPaused(status, "summit5"), 10: !isPaused(status, "summit10"), 50: !isPaused(status, "summit50"), 200: !isPaused(status, "summit200") },
  } as const;
  const loggedIn = demo || (!!account && !!session && session.address === account.toLowerCase());
  // How many certificates I have staked, used only to word the entry points on the home and staking pages
  // (the batches in the wallet go through lots, §71.80).
  const myShares = useMemo(() => holdings.reduce((a, h) => a + h.total, 0n), [holdings]);
  /// §71.30: the note shown when this site has no contract addresses configured for its chain (for
  /// example while the mainnet contracts are not deployed). Not an error, so not red; hidden in demo mode.
  /// 🔴 The staking board (§71.94): `loadBoard()` returns the burn family (MEME) as well — those are for
  /// the MEME Lab. Staking and Strategy Builder only recognise the redeemable family (MEME does not enter
  /// strategies and cannot be redeemed), so they are split apart once here; the write path (`deposit()`)
  /// still sees the whole `board`, because a burn has to be findable by id.
  /// 🔴 §71.138 corrected the "not tradable" half of that: burn certificates are standard ERC1155, and once
  /// registered they can be listed / bought / transferred on the certificate market (user, 2026-09-18:
  /// "the certificate market must recognise burn certificates and support trading them"). The market page
  /// and the account page therefore use `tradeBoard` below (= `certBoard` + the burn family), not `certBoard`.
  /// §71.95: the asset catalog's "Binance spot pair" column is then carried onto every card by contract
  /// address (`withPairs`), so cards / market / account can reach the spot leg for a price.
  /// The asset catalog (§71.31): the Binance US-equity tokens plus the crypto token list, which the operator
  /// lists and delists on the back office "Asset catalog" page. It follows the same tick as the quotes, so a
  /// listing change reaches the page quickly; the staking cards and the catalog itself, as well as the top
  /// ticker ribbon (§71.53), all need it, so it is not paused per tab either.
  /// If a pull fails the last usable copy is kept (a list once seen is never cleared), and it is only marked
  /// as an error when not a single copy has ever arrived — the pulling effect is a few hundred lines below.
  const [assets, setAssets] = useState<AssetsState>(() => demo ? demoAssets() : cachedAssets());
  /// **Every** redeemable asset registered on chain, **regardless of whether its pool is open or closed**.
  /// The market, My Account and Strategy Builder use this one.
  ///
  /// 🔴 §71.137: closing a pool closes the shelf, not anything already in someone's hands. A holder must
  /// still see their own batches and still be able to redeem / stake / list them — filtering these pages too
  /// would hide a user's own assets from their own account, which is far worse than showing one card too
  /// many (§29).
  const certBoard = useMemo(
    () => withPairs(board.filter((t) => t.mode === "redeem"), assets.assets),
    [board, assets],
  );
  /// The shelf on the staking page: the assets whose **pool is closed** are taken back off it by the catalog
  /// (§71.136, user 2026-09-18: "closing the pool has to close the whole card").
  /// The on-chain registry can only be added to, never deleted from (§71.135), so once the operator closes a
  /// pool this is the only place that can make the card disappear.
  /// Catalog not pulled / asset missing from the catalog → `closedPools` returns an empty set or one without
  /// it → the card stays, with the chain as the source of truth (§71.51).
  /// 🔴 This copy is only for the places that **display the shelf**: the staking page (`StakePools` /
  /// `StakeFaq`), the home page, the wall, and the top ticker ribbon.
  /// Do not pass it to the account page or the market page; the reason is on `certBoard` above.
  const closed = useMemo(() => closedPools(assets), [assets]);
  const stakeBoard = useMemo(
    () => certBoard.filter((t) => !closed.has(t.asset.toLowerCase())),
    [certBoard, closed],
  );
  // The account page's card takes a Holding rather than a Ticker, and its price has to come off the same leg
  // as the staking page (§71.95), so the catalog's spot pairs are attached here too.
  const myHoldings = useMemo(() => withPairs(holdings, assets.assets), [holdings, assets]);
  // Only pages that read the chain wait on it: the home and arena pages never start a chain read, so a
  // note there would never clear (§71.174).
  const chainNote = !demo && !chainReady && tabNeedsChain(tab) ? tr("Loading BNBChain data") : null;

  const currentIdentity = useRef(account);
  currentIdentity.current = account;
  const refreshVersion = useRef(0);
  /// `poll`: the 12-second background tick. It re-reads the board only once a minute (§71.174) — issued /
  /// staked totals move only when someone mints or stakes, and every read is a burst of RPC calls on a
  /// rate-limited public node. Any other call (after the user's own transaction, a page switch) reads it
  /// straight away.
  const refresh = useCallback(async (poll = false) => {
    const version = ++refreshVersion.current;
    const token = authToken();
    const current = () => version === refreshVersion.current && currentIdentity.current === account && authToken() === token;
    if (demo) {
      const b = demoBoard();
      setBoard(b);
      setPools(demoPools());
      setJackpot({ kind: "ok", jackpot: demoJackpot(account) });
      setMints(demoMints(b));
      if (account) { setHoldings(demoHoldings(b)); setLots(demoWalletLots(b)); }
      setFunds(account ? demoFunds() : null);
      setMyEntries(account ? demoMyEntries(b) : new Map());
      return;
    }

    // Arena reads are API-backed and do not need a chain read. Start them immediately so a
    // slow mobile RPC cannot delay the first arena paint or the sign-in controls.
    const arenaTask = (async () => {
      if (!arenaConfigured()) return;
      // Commit each response as it arrives; a delayed jackpot must not delay the balance.
      const results = await Promise.allSettled([
        loadPools().then(value => { if (current()) setPools(value); }),
        loadSession().then(value => {
          if (!current()) return;
          setSession(previous => value && previous?.address === value.address && previous.faction
            ? { ...value, faction: previous.faction } : value);
          if (value) void bindPendingRef();
          setFunds(value && account && value.address === account.toLowerCase()
            ? { arena: value.balance, pending: value.pending.length, withdrawable: value.withdrawable, locked: value.locked, unlockAt: value.unlockAt }
            : null);
        }),
        loadJackpot(account).then(value => { if (current()) setJackpot({ kind: "ok", jackpot: value }); }, error => {
          if (current()) setJackpot({ kind: "error", message: apiErrorText(error) });
        }),
        loadStatus().then(value => { if (current()) setStatus(value); }),
        account ? loadMyEntries(account).then(value => { if (current()) setMyEntries(value); }) : Promise.resolve(),
      ]);
      if (current()) {
        const failed = results.slice(0, 2).find(result => result.status === "rejected");
        if (failed?.status === "rejected") setError(tr("Could not load match data: {0}", apiErrorText(failed.reason)));
      }
    })();

    // Contract reads are needed by the builder, staking, market and account pages, but not by
    // the home or arena first screen. A later hash change recreates this callback and hydrates
    // the board when the user actually opens one of those pages.
    const needsChain = tabNeedsChain(tab);
    const chainTask = (async () => {
      if (!needsChain) return;
      try {
        const { resolveAddresses, syncChainTime, loadBoard, loadMintQuotes, loadHoldings, loadLots } = await chainLib();
        await resolveAddresses();
        void syncChainTime().catch(() => {});
        if (current()) setChainReady(coreConfigured());
        if (coreConfigured()) {
          const reuse = poll && boardRef.current.length > 0 && Date.now() - boardReadAt.current < BOARD_POLL_MS;
          const b = reuse ? boardRef.current : await loadBoard();
          if (!current()) return;
          if (!reuse) {
            boardReadAt.current = Date.now();
            setBoard(b);
            saveBoard(b);
          }
          const reads: Promise<unknown>[] = [];
          if (tab === "mint" || tab === "meme") reads.push(loadMintQuotes(b).then(value => { if (current()) setMints(value); }));
          if (account && (tab === "mine" || tab === "market")) {
            reads.push(
              loadHoldings(account, b).then(value => { if (current()) setHoldings(value); }),
              loadLots(account, b).then(value => { if (current()) setLots(value); }),
            );
          }
          await Promise.all(reads);
        }
      } catch (e) {
        console.error("Failed to load BNB Chain data", e);
        if (current()) setError(tr("Cannot read on-chain data from {0} right now. Please try again shortly.", CHAIN_LABEL));
      }
    })();

    await Promise.allSettled([arenaTask, chainTask]);
  }, [account, demo, tab]);

  const depositFlow = useDeposit(account, () => { void refresh(); });

  // A connected wallet is about to sign or read something: fetch the chain code in the background now so the
  // first click does not wait on it (§71.174). A failed fetch is retried by the handler that needs it.
  useEffect(() => { if (account && !demo) void chainLib().catch(() => {}); }, [account, demo]);

  useEffect(() => {
    const onHash = () => { setTabState(readHash()); setSiteState(readSite()); };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // The first pull after the effect (re)starts — page load, page switch, sign-in — is a full read.
    let polled = false;
    const pull = async () => {
      if (!document.hidden) await refresh(polled);
      polled = true;
      if (alive) timer = setTimeout(pull, 12_000);
    };
    // A hidden tab skips its pulls; coming back should not wait up to 12 s for the next one (§71.174).
    const onVisible = () => {
      if (document.hidden || !alive) return;
      clearTimeout(timer);
      void pull();
    };
    void pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); refreshVersion.current++; };
  }, [refresh]);

  /// A new address means a new profile (§71.162). Disconnecting (`account` becomes null) comes through here too.
  ///
  /// The bug the user reported on 2026-09-20 died exactly on this missing step: the display name used to live
  /// under one **global** localStorage key, so signing in with a different wallet, or on a different machine,
  /// still showed the previous address's name.
  useEffect(() => {
    setProfile(loadProfile(account));
    profileSynced.current = null; // a new address has to reconcile with the back end again
  }, [account]);

  /// After signing in, reconcile this address's profile with the back end once — once per address (`profileSynced`).
  ///
  /// Two cases:
  ///  - the back end has one (`profile` is not null): it wins, and it is written back into the local cache so the
  ///    next page open does not flash;
  ///  - the back end has none (a name was never chosen) but this machine has one: push the local copy up. This is
  ///    the smooth path for existing users — they named themselves on this machine, and the back end has to learn
  ///    that before they switch devices. A failed push is not worth interrupting them over; the name is still here.
  useEffect(() => {
    if (demo || !arenaConfigured()) return;
    const addr = account?.toLowerCase() ?? null;
    if (!addr || !session || session.address !== addr) return;
    if (profileSynced.current === addr) return;
    profileSynced.current = addr;
    if (session.profile) {
      setProfile(session.profile);
      saveProfile(addr, session.profile);
    } else {
      const local = loadProfile(addr);
      if (local.name) void saveProfileToServer(local).catch(() => { /* the name is still on this machine; push it at the next sign-in */ });
    }
  }, [account, session, demo]);

  /// Renaming / changing the avatar does three things at once: the interface, the local cache, and the back end.
  /// While signed out only the first two happen (the endpoint needs a session cookie); the hydrate that follows
  /// the signature will push it up.
  const changeProfile = useCallback((p: Profile) => {
    setProfile(p);
    saveProfile(account, p);
    if (!demo && loggedIn && arenaConfigured()) {
      void saveProfileToServer(p).catch((e) => setError(tr("Your display name could not be saved to the server (it is already changed on this device): {0}", apiErrorText(e))));
    }
  }, [account, demo, loggedIn]);
  // Notices (§71.41): far slower than the pools, once every 60 seconds; with no endpoint configured not a single
  // one is pulled and the interface says so itself.
  useEffect(() => {
    if (demo) { setNotices(demoNotices()); return; }
    if (!arenaConfigured()) return;
    let alive = true;
    const pull = () => { loadNotices(50).then((n) => { if (alive) setNotices(n); }, () => {}); };
    pull();
    const t = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [demo]);

  // Where the arena detail view gets its data: two sets, demo and endpoint, which the component does not distinguish.
  const source = useMemo<ArenaSource>(() => demo
    ? {
        entries: async (id) => { const p = demoPools().find((x) => x.id === id); return p ? demoEntries(p, demoBoard()) : []; },
        results: async (id) => { const p = demoPools().find((x) => x.id === id); return p ? demoResults(p) : { kind: "none" }; },
        myEntries: async () => demoMyEntries(demoBoard()),
        live: async (id) => { const p = demoPools().find((x) => x.id === id); if (!p) throw new Error("no pool"); return demoPoolLive(p, demoEntries(p, demoBoard())); },
        depositAddress: async () => demoDepositAddress(),
        deposits: async () => demoDeposits(),
        withdrawals: async () => demoWithdrawals(),
        stats: async () => demoStats(),
      }
    : { entries: loadEntries, results: loadResults, myEntries: loadMyEntries, live: loadPoolLive, depositAddress: loadDepositAddress, deposits: loadDeposits, withdrawals: loadWithdrawals, stats: loadStats },
  [demo]);

  /// "Connect wallet" (§71.28): opens the wallet picker (MetaMask / Binance Wallet / Trust Wallet by default, plus
  /// any other injected wallets detected, plus WalletConnect); actually asking the wallet for an address is in pickWallet.
  function connect() {
    if (demo) {
      // There is no chain to sign against in demo mode; a fixed address is handed out so My Account and the arena
      // have something to show.
      setAccount(DEMO_ACCOUNT);
      return;
    }
    setPicker(true);
  }

  /// A usable wallet was picked: lib/wallet.ts connects and remembers it (every later `walletClient()` goes through
  /// it) → the address is recorded. Injected wallets raise the extension's approval window; WalletConnect raises a QR
  /// code. Errors are not swallowed here — the picker shows a sentence for them (the most common by far being that
  /// the user pressed reject).
  async function pickWallet(e: WalletEntry) {
    const a = await connectEntry(e);
    setAccount(a);
    setWalletName(e.name);
    setPicker(false);
    setError(null);
  }

  /// Disconnect (from the avatar popover, §69.15): forget the address, clear everything that belongs only to that
  /// address, and end the arena session.
  /// The wallet extension's own site permission is revoked on a best-effort basis (MetaMask's
  /// wallet_revokePermissions); failing to revoke is not an error — the next press of "Connect wallet" will raise the
  /// account chooser regardless.
  async function disconnect() {
    setAccount(null);
    setHoldings([]);
    setLots([]);
    setFunds(null);
    setMyEntries(new Map());
    setFundsModal(null);
    if (session || (!demo && arenaConfigured())) { setSession(null); apiLogout().catch(() => { /* the session may well have expired already */ }); }
    // Revoke on the wallet's side first, best effort (injected wallet_revokePermissions / ending the WalletConnect
    // session), then forget the choice — forgetting means the next page open no longer restores it silently (§71.28).
    // revoke grabs the provider internally before doing anything, so forget can follow immediately.
    const done = demo ? Promise.resolve() : revoke();
    forget();
    setWalletName(null);
    await done;
  }

  // Restore the last wallet silently on page open (§71.28): it only asks eth_accounts and raises no dialog; if the
  // wallet has revoked its permission it counts as never connected. Demo / read-only preview do not restore.
  useEffect(() => {
    if (demo || preview) return;
    let alive = true;
    resume().then((r) => { if (alive && r) { setAccount(r.address); setWalletName(r.entry.name); } });
    return () => { alive = false; };
  }, [demo, preview]);

  // The account changed in the wallet, or the site was disconnected there: a new address clears everything that
  // belonged to the old one, along with the session (sessions are bound to an address, §69.3); an empty list means
  // the user disconnected inside the wallet.
  useEffect(() => {
    if (!walletName) return;
    return onAccountsChanged((accounts) => {
      const a = accounts[0] ?? null;
      setAccount(a);
      setHoldings([]);
      setLots([]);
      setFunds(null);
      setMyEntries(new Map());
      setFundsModal(null);
      if (session || (!demo && arenaConfigured())) { setSession(null); apiLogout().catch(() => { /* the session may have expired */ }); }
      if (!a) { forget(); setWalletName(null); }
    });
  }, [walletName, session]);

  async function send(id: number, run: () => Promise<`0x${string}`>) {
    setBusy(id);
    try {
      const { ensureChain, walletRpcClient } = await chainLib();
      await ensureChain(); // if the wallet is not on this site's chain, switch first (§71.30); no switch, no transaction
      const hash = await run();
      await walletRpcClient().waitForTransactionReceipt({ hash });
      setError(null);
      void refresh();
    } catch (e) {
      const m = (e as Error).message;
      // A contract's named custom error is far more use than the raw revert data
      const named = m.match(
        /(ZeroShares|ZeroAmount|ZeroPrice|MintPaused|AssetMintPaused|PriceDeviationTooHigh|AssetNotSupported|ListingNotActive|PriceAboveLimit|InsufficientRemaining|NothingPurchased|CurrencyNotAllowed|NoSuchListing|NotSeller|NotWhitelisted|Paused|ERC20InsufficientBalance|ERC20InsufficientAllowance|SafeERC20FailedOperation|ERC1155InsufficientBalance|ERC1155MissingApprovalForAll|AssetInAboveLimit|BurnIncomplete|AssetNotAssigned|AssetNotEnabled|PriceUnavailable|QuoteRouteUnavailable|QuoteRouteDisabled|QuoteRouteNotFound|OracleNotSet)/,
      );
      setError(named ? errorText(named[1]) : m.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  /// The arena's ledger writes (§69): these are not on-chain transactions, so there is no hash to wait on; on success
  /// it refreshes, and on failure the endpoint's own wording is shown (mapped to English by `apiErrorText`, §71.163).
  /// A 401 means the session is gone (cookie expired / wallet changed), so the signed-in state is cleared alongside it
  /// and the interface falls back to "Sign in".
  async function act(id: number, run: () => Promise<void>): Promise<boolean> {
    setBusy(id);
    try {
      await run();
      setError(null);
      void refresh();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession(null);
      setError(apiErrorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /// Split a `Pick[]` into the three arrays the contract wants. Within one operation every batch belongs to the same
  /// asset and the same certificate contract, so taking cert from the first row is enough; it also blocks "nothing
  /// ticked" and "ticked but the count is 0".
  function splitPicks(picks: Pick[], what: string): { cert: Address; ids: bigint[]; ns: bigint[] } {
    const rows = picks.filter((p) => p.n > 0n);
    if (rows.length === 0) throw new Error(tr("Transaction not submitted: select the certificates to {0} and fill in how many", what));
    return { cert: rows[0].cert, ids: rows.map((p) => p.batchId), ns: rows.map((p) => p.n) };
  }

  /// Deposit / burn (§52 / §71.80 / §71.94): hand over the asset token, get back `shares` **certificates**.
  /// This opens a **new batch**, whose number the contract assigns inside the transaction
  /// (`CertificateBase._createBatch`); the frontend cannot know it in advance.
  ///
  /// Both families share this one entry point and fork on `mode` — the approval half is identical, only the final
  /// `mint` signature differs:
  ///   · `redeem` (bStock / crypto staking): `RedeemableCertificate.mint(n, to)`, the token is locked inside the
  ///     certificate and can be redeemed;
  ///   · `burn` (MEME Lab): `BurnCertificate.mint(asset, n, to, maxAssetIn)`, the token goes straight to the burn
  ///     address and nothing can be redeemed.
  ///
  /// 🔴 The approval leaves 1% of headroom: the redeemable `mint(n, to)` takes no maxAssetIn, so if the price moves
  /// between signing and inclusion the contract pulls tokens at the price of that moment, and an approval that is
  /// exact to the last unit simply fails. This margin stays inside the system and is **never shown** (§71.54, decided
  /// by the user on 2026-09-14).
  /// Minting charges no fee (§71.84), so the approval is just the tokens owed plus 1%, with nothing else added.
  ///
  /// 🔴 The burn variant's `maxAssetIn` uses that same number (= quote × certificates × 1.01). It must **never** be
  /// `type(uint256).max`: that would expose the entire wallet balance to whoever can manipulate the pool (the contract
  /// colleague's integration doc §9.5 warns specifically about same-block price manipulation on V2 pools).
  const deposit = (id: number, shares: bigint) => send(id, async () => {
    const { walletClient, walletRpcClient, erc20Abi, burnCertificateAbi, redeemableCertificateAbi } = await chainLib();
    const t = board.find((x) => x.id === id);
    if (!t) throw new Error(tr("Transaction not submitted: that asset is not on the board"));
    if (shares <= 0n) throw new Error(tr("Transaction not submitted: at least 1 certificate"));
    const q = mints.get(id);
    // The chain cannot price it (no pool liquidity / spot too far from the TWAP) → the button is already disabled;
    // this is the backstop
    if (!q) throw new Error(tr("Transaction not submitted: the chain cannot price this asset right now"));
    if (q.paused) throw new Error(tr("Transaction not submitted: minting is paused for this asset's certificate"));
    const wc = walletClient()!;
    const need = (mintCost(q, shares) * 101n) / 100n;
    // Only the allowance given to the certificate contract is read, never how much of the asset token is in the wallet
    // (§69.16); if it is short, the wallet refuses at the signing step.
    const rpc = walletRpcClient();
    const balance = await rpc.readContract({ address: t.asset, abi: erc20Abi, functionName: "balanceOf", args: [account!] });
    if (balance < mintCost(q, shares)) throw new Error(tr("Your wallet does not hold enough of this token."));
    const allowance = await rpc.readContract({ address: t.asset, abi: erc20Abi, functionName: "allowance", args: [account!, t.cert] });
    if (allowance < need) {
      const h = await wc.writeContract({ account: account!, address: t.asset, abi: erc20Abi, functionName: "approve", args: [t.cert, need], chain: null });
      await rpc.waitForTransactionReceipt({ hash: h });
    }
    if (t.mode === "burn") {
      return wc.writeContract({
        account: account!, address: t.cert, abi: burnCertificateAbi,
        functionName: "mint", args: [t.asset, shares, account!, need], chain: null,
      });
    }
    return wc.writeContract({
      account: account!, address: t.cert, abi: redeemableCertificateAbi,
      functionName: "mint", args: [shares, account!], chain: null,
    });
  });

  const oneClickLock = useRef(false);
  const oneClickStake: OneClickSubmit = async (quote, progress) => {
    if (readOnly || !account) throw new Error(tr("Connect a wallet first"));
    if (oneClickLock.current || busy !== null) throw new Error(tr("Another transaction is in progress."));
    oneClickLock.current = true;
    setBusy(-1_000_002);
    try {
      const { ensureChain, writeOneClickStake } = await chainLib();
      await ensureChain();
      const result = await writeOneClickStake(quote, account, progress);
      void refresh();
      return result;
    } finally {
      oneClickLock.current = false;
      setBusy(null);
    }
  };

  /// Redeem (§52 / §71.80): burn the ticked batches, so many certificates each, and take back the tokens locked inside.
  /// How much each certificate holds was fixed **at the moment it was minted**; it has nothing to do with today's price
  /// and is not a share of a pool — what anyone else deposited does not change what you get back. Staked certificates
  /// have to be unstaked first.
  const redeem = (id: number, picks: Pick[]) => send(redeemBusyId(id), async () => {
    const { walletClient, redeemableCertificateAbi } = await chainLib();
    const { cert, ids, ns } = splitPicks(picks, tr("redeem"));
    const wc = walletClient()!;
    return wc.writeContract({
      account: account!, address: cert, abi: redeemableCertificateAbi,
      functionName: "redeemBatch", args: [ids, ns, account!], chain: null,
    });
  });

  /// Unstake the ticked batches, so many certificates each (§54 / §71.80: My Account ticks by batch and types the count).
  /// 🔴 The §37 gate that blocked unstaking during US market hours was removed by the user on 2026-09-15:
  /// **unstaking is always available**, and the frontend no longer makes any time-of-day judgement.
  const unstake = (id: number, picks: Pick[]) => send(id, async () => {
    const { walletClient, certificatePledgeAbi } = await chainLib();
    const { cert, ids, ns } = splitPicks(picks, tr("unstake"));
    const wc = walletClient()!;
    return wc.writeContract({
      account: account!, address: addresses.pledge, abi: certificatePledgeAbi,
      functionName: "redeem", args: [ids.map((batchId, k) => ({ certificate: cert, id: batchId, amount: ns[k] }))], chain: null,
    });
  });

  /// Stake the ticked certificates from the wallet (§55): certificates bought on the market sit in the wallet, and only
  /// count towards dividends once staked.
  /// Dividends are weighted by **certificate count** (user, 2026-09-15) — how much each one holds makes no difference,
  /// so staking n certificates is n votes; it starts from the next 15-minute settlement point (§71.80, replacing the
  /// original 7-day warm-up).
  /// The custody contract pulls the certificates with safeTransferFrom, so the first time it needs setApprovalForAll
  /// (a different operator from the market approval used for listing).
  const stakeShares = (id: number, picks: Pick[]) => send(stakeBusyId(id), async () => {
    const { walletClient, walletRpcClient, redeemableCertificateAbi, certificatePledgeAbi } = await chainLib();
    const { cert, ids, ns } = splitPicks(picks, tr("stake"));
    const wc = walletClient()!;
    const rpc = walletRpcClient();
    const ok = await rpc.readContract({ address: cert, abi: redeemableCertificateAbi, functionName: "isApprovedForAll", args: [account!, addresses.pledge] });
    if (!ok) {
      const h = await wc.writeContract({ account: account!, address: cert, abi: redeemableCertificateAbi, functionName: "setApprovalForAll", args: [addresses.pledge, true], chain: null });
      await rpc.waitForTransactionReceipt({ hash: h });
    }
    return wc.writeContract({
      account: account!, address: addresses.pledge, abi: certificatePledgeAbi,
      functionName: "pledge", args: [ids.map((batchId, k) => ({ certificate: cert, id: batchId, amount: ns[k] }))], chain: null,
    });
  });

  // The secondary market (§33): every active listing on the site, with the floor price derived from that same copy
  // (`floorsOf`) — one number written once, so the floor on a card can never disagree with the first row you see after
  // clicking into it (§71.78).
  // Not configured leaves it undefined and the interface hides the whole block.
  const marketOn = demo || marketConfigured();
  const [listings, setListings] = useState<Listing[] | undefined>(undefined);
  // 🔴 The fee rate is read from the chain (feeBps), never hardcoded. null = not read yet, and the copy then does not
  // mention a percentage at all.
  const [feeBps, setFeeBps] = useState<number | null>(null);
  useEffect(() => {
    if (!marketOn || board.length === 0 || (tab !== "market" && tab !== "mine")) return;
    let alive = true;
    (async () => {
      if (demo) { if (alive) { setListings(demoListings(board)); setFeeBps(DEMO_FEE_BPS); } return; }
      const { loadListings, loadFeeBps } = await chainLib();
      const [ls, fee] = await Promise.all([
        loadListings(board).catch(() => [] as Listing[]),
        loadFeeBps().catch(() => null),
      ]);
      if (alive) { setListings(ls); setFeeBps(fee); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketOn, demo, board, account, busy, tab]);
  // The MEME Lab (§59; moved onto the real contracts by §71.94 on 2026-09-16): a burn pool is simply an asset on the
  // board with `mode === "burn"`, and there is no separate event-pool contract any more. The price and the
  // "how much to burn per certificate" figure reuse `mints` directly (the same `quoteForFaceValue`, §71.78).
  // With no contract address configured it stays undefined and the page says so; configured but with no MEME registered
  // → [], and the page says there are no burn pools yet.
  //
  // 🔴 A burn goes through the `deposit()` above (which forks on mode), so there is **no** separate burn function here;
  // nor is there a "claim dividend" — dividends are centralised and paid off-chain by certificate count, and
  // `BurnCertificate` has no dividend function at all.
  const memeOn = demo || coreConfigured();
  const [memePools, setMemePools] = useState<MemePool[] | undefined>(undefined);
  useEffect(() => {
    if (!memeOn) return;
    let alive = true;
    (async () => {
      if (demo) { if (alive) setMemePools(demoMemePools()); return; }
      // No burn assets on the board (not read yet, or none registered) → nothing to read, and no reason to load
      // the chain code for it (§71.174); loadMemePools would return [] as well.
      const ps = burnBoard(board).length === 0 ? []
        : await chainLib().then(({ loadMemePools }) => loadMemePools(board, mints)).catch(() => [] as MemePool[]);
      if (alive) setMemePools(ps);
    })();
    return () => { alive = false; };
  }, [memeOn, demo, board, mints]);
  // In demo mode the burn pools are built separately (`demoBoard()` only holds the redeemable family), so the MEME
  // certificates in my hands are built separately too and merged into lots.
  const allLots = useMemo(
    () => (demo && memePools ? [...lots, ...(account ? demoMemeLots(memePools) : [])] : lots),
    [demo, memePools, lots, account],
  );
  /// Same again for the staked copy (§71.139): the staked uBNC in the demo has to be built separately too, or "My
  /// stakes" shows no burn-family card. On the real chain the burn family is already on the same board, and
  /// `loadHoldings()` reads it all in one pass.
  const allHoldings = useMemo(
    () => (demo && memePools && account ? withPairs([...holdings, ...demoMemeHoldings(memePools)], assets.assets) : myHoldings),
    [demo, memePools, account, holdings, assets, myHoldings],
  );

  /// 🔴 §71.138: **the certificate market recognises burn certificates** (user, 2026-09-18: "the certificate market
  /// must recognise burn certificates and support trading them. The frontend needs a way to list uBNC certificates").
  /// The contracts already did — `CertificateMarket._list` only checks "is this certificate contract in the registry",
  /// with no distinction between redeemable and burn; a burn certificate is a standard ERC1155 and freely transferable.
  /// So this is a frontend matter from end to end, with no contract change needed.
  ///
  /// One row per MEME (the layout the user picked: "one card per MEME"), but they are all named uBNC — they are backed
  /// by the same certificate contract instance, and the subtitle "From burning $XXX" tells them apart (`burnFrom`).
  /// In demo mode the burn pools are built separately, so a board is built separately here too, the same way `allLots` does.
  ///
  /// 🔴 These memos are declared here (rather than next to `certBoard` above) for exactly one reason: the `memePools`
  /// state is declared **after** the listings effect above, and an effect's dependency array is evaluated at render
  /// time, on the `useEffect` line itself — referencing a name that is `const`-declared later would be a TDZ error
  /// outright. `allLots` has always been written this way.
  const burnTickers = useMemo(
    () => (demo ? demoBurnBoard(memePools ?? []) : burnBoard(board)),
    [demo, memePools, board],
  );
  /// Everything tradable on the certificate market = the redeemable family (`certBoard`) plus the burn family (uBNC).
  /// 🔴 For the market page and the account page. **Not for Strategy Builder** (`Builder`): MEME does not enter the
  /// arena (§71.94), and not for the staking page either (burn certificates are only minted in the MEME Lab, §71.136).
  const tradeBoard = useMemo(() => [...certBoard, ...burnTickers], [certBoard, burnTickers]);
  /// Demo mode: the uBNC listings are built separately as well (`demoListings` only knows the redeemable family in
  /// `demoBoard()`).
  /// 🔴 Joining them requires a re-sort (`sortListings`): each half is sorted by price ascending, and the concatenation
  /// is not — while `floorsOf` takes exactly row 0 of the sorted list, so without the sort the floor price would
  /// disagree with the first row of the order book.
  const allListings = useMemo(
    () => (listings && demo ? sortListings([...listings, ...demoBurnListings(memePools ?? [])]) : listings),
    [listings, demo, memePools],
  );
  /// An asset's floor price = the cheapest row in its order book. Undefined while the market is not configured, and the
  /// account card then hides the whole block (rather than guessing).
  const floors = useMemo(() => (allListings ? floorsOf(allListings) : undefined), [allListings]);

  // Live quotes (§71): once every 30 seconds (QUOTE_MS). Since §71.54 that tick is a promise — 1 certificate is always
  // $10, how many tokens that is worth is computed live off this feed, and the amount is re-quoted every 30 seconds.
  // The staking cards use it, and so does the top ticker ribbon (§71.53, which is on every page, so it is not paused
  // per tab); no endpoint configured / stale → an empty table, and cards and ribbon show "—" (§25: never show a stale
  // price, never invent a number).
  const [quotes, setQuotes] = useState<Quotes>(emptyQuotes);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      if (demo) {
        return Promise.resolve(demoQuotes()).then((q) => { if (alive) setQuotes(q); });
      }
      // A slow/interrupted poll must not erase the last verified quote table.  The
      // loader still returns an empty map when the API explicitly reports stale or
      // disabled data, so only transport failures keep the previous snapshot.
      return loadQuotes().then((q) => { if (alive) setQuotes(q); }, () => {
        if (!alive) return;
        // Keep a snapshot only inside the same freshness window used by the
        // chart. Once it is older, clear it instead of displaying stale prices.
        setQuotes(previous => {
          const now = serverNow();
          const fresh = [...previous.values()].some(quote => now - quote.at <= MARKET_MAX_AGE_SECONDS);
          return fresh ? previous : emptyQuotes();
        });
      });
    };
    pull();
    const t = setInterval(pull, QUOTE_MS);
    return () => { alive = false; clearInterval(t); };
  }, [demo]);
  // Pulling the asset catalog (§71.31): the same tick as the quotes, which is why it sits next to them.
  // The state itself is declared above `stakeBoard` — the cards need the catalog's spot-pair column to reach a price
  // (§71.95), and the explanation is up there too.
  useEffect(() => {
    let alive = true;
    const pull = () => (demo ? Promise.resolve(demoAssets()) : loadAssets().catch(() => null))
      .then((a) => {
        if (!alive) return;
        if (a) setAssets(a);
        else setAssets((prev) => (prev.status === "ok" ? prev : { status: "error", assets: [], delisted: [] }));
      });
    pull();
    // Catalog membership changes rarely; keep the first read immediate, then avoid competing
    // with wallet/API actions on a metered mobile connection.
    const t = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [demo]);
  // How many times each asset has paid a dividend. The old source (the bStock drop index) is gone, so the cards show
  // "—" until the count is read from the current certificate-dividend records.
  const dividends: Map<string, number> | null = null;

  // The secondary market's writes (§33 / §41). busy uses a negative band: buy -50000-tokenId, list -60000-tokenId,
  // cancel -70000-listingId.
  const market = addresses.market as Address;
  /// Buy n certificates out of one listing (§41 / §71.80: a listing = several certificates of one batch, and only some
  /// of them can be bought).
  /// Payable = unit price × n; if the allowance is short, approve that amount first.
  ///
  /// 🔴 The three arguments are deliberate:
  /// · `currency` is always USDT — user, 2026-09-15: listings take USDT only, and the interface offers no currency choice;
  /// · `maxUnitPrice` = the price shown on screen — what you see is what you pay, and if someone moved the price the
  ///   transaction fails rather than paying more;
  /// · `allOrNothing = true` — you get exactly the number you pressed for, and a partial fill fails the whole thing
  ///   (reporting "there are not that many left") rather than delivering the baffling "pressed 3, got 1" experience.
  const buyListing = (tickerId: number, l: Listing, n: bigint) => send(-50_000 - tickerId, async () => {
    const { walletClient, walletRpcClient, erc20Abi, certificateMarketAbi } = await chainLib();
    if (n <= 0n) throw new Error(tr("Transaction not submitted: at least 1 certificate"));
    if (n > l.remaining) throw new Error(tr("Transaction not submitted: this listing does not hold that many"));
    const wc = walletClient()!;
    const cost = costOf(l, n);
    const rpc = walletRpcClient();
    const allowance = await rpc.readContract({ address: addresses.usdt, abi: erc20Abi, functionName: "allowance", args: [account!, market] });
    if (allowance < cost) {
      const h = await wc.writeContract({ account: account!, address: addresses.usdt, abi: erc20Abi, functionName: "approve", args: [market, cost], chain: null });
      await rpc.waitForTransactionReceipt({ hash: h });
    }
    return wc.writeContract({
      account: account!, address: market, abi: certificateMarketAbi, functionName: "buy",
      args: [
        addresses.usdt,
        [{ listingId: l.id, certificate: l.cert, id: l.batchId, amount: n, maxUnitPrice: l.unitPrice }],
        true,
      ],
      chain: null,
    });
  });
  /// List the ticked batches, so many certificates each (§71.80): one listing carries one unit price, and the whole lot
  /// goes out in a single transaction.
  /// tickerId only occupies a busy slot; prices and batches line up one to one (the two arrays are the same length).
  const listCerts = (tickerId: number, picks: Pick[], prices: bigint[]) => send(-60_000 - tickerId, async () => {
    const { walletClient, walletRpcClient, redeemableCertificateAbi, certificateMarketAbi } = await chainLib();
    const { cert, ids, ns } = splitPicks(picks, tr("list"));
    if (ids.length !== prices.length) throw new Error(tr("Transaction not submitted: the number of batches and the number of prices do not match"));
    if (prices.some((p) => p <= 0n)) throw new Error(tr("Transaction not submitted: every batch needs an asking price"));
    const wc = walletClient()!;
    const rpc = walletRpcClient();
    const ok = await rpc.readContract({ address: cert, abi: redeemableCertificateAbi, functionName: "isApprovedForAll", args: [account!, market] });
    if (!ok) {
      const h = await wc.writeContract({ account: account!, address: cert, abi: redeemableCertificateAbi, functionName: "setApprovalForAll", args: [market, true], chain: null });
      await rpc.waitForTransactionReceipt({ hash: h });
    }
    return wc.writeContract({
      account: account!, address: market, abi: certificateMarketAbi, functionName: "list",
      args: [ids.map((batchId, k) => ({ certificate: cert, id: batchId, amount: ns[k], unitPrice: prices[k], currency: addresses.usdt }))],
      chain: null,
    });
  });
  const cancelListing = (listingId: bigint) => send(-70_000 - Number(listingId), async () => {
    const { walletClient, certificateMarketAbi } = await chainLib();
    const wc = walletClient()!;
    return wc.writeContract({ account: account!, address: market, abi: certificateMarketAbi, functionName: "cancel", args: [[listingId]], chain: null });
  });

  // The arena's writes occupy busy with negative ids so they cannot collide with an asset id. They all go through the
  // ledger endpoints (§69) and no longer call the Competition / Distributor contracts.

  /// Sign-in (§69.3): what is signed is the whole text the server hands over, not a transaction, and it costs no gas.
  /// The session is an HttpOnly cookie; the frontend stores no token.
  const login = async () => {
    if (loginLock.current) return false;
    loginLock.current = true;
    setLoginStage("prepare");
    try { return await act(LOGIN_BUSY, async () => {
    const { walletClient } = await chainLib();
    const wc = walletClient();
    if (!wc || !account) throw new Error(tr("Connect a wallet first"));
    const s = await apiLogin(account, async (message) => {
      setLoginStage("wallet");
      const signature = await wc.signMessage({ account, message });
      setLoginStage("verify");
      return signature;
    });
    if (currentIdentity.current !== account) return;
    setSession(s);
    setFunds({ arena: s.balance, pending: s.pending.length, withdrawable: s.withdrawable, locked: s.locked, unlockAt: s.unlockAt });
    // Bind the referral code that has been waiting as soon as the signature goes through (§71.144). Not awaited:
    // whether the binding works should never hold up "signed in".
    void bindPendingRef();
    }); } finally { loginLock.current = false; setLoginStage(null); }
  };
  const logout = () => act(LOGIN_BUSY, async () => { await apiLogout(); setSession(null); setFunds(null); });

  /// Entering: POST /pools/{id}/entries. The buy-in comes out of the arena balance (§26); if the balance is short the
  /// endpoint returns Insufficient, and the dialog stops it well before that.
  /// legs carry only the bare ticker and the direction; the weights are equal-weighted server-side (§69.4); the display
  /// name and avatar pattern are registered with the strategy.
  const enterPool = (pool: Pool, draft: Draft, amount: bigint) => act(-1 - pool.id, async () => {
    // 🔒 §39: 3T = 3, 5T = 5, NT = 6–50. The dialog has already checked; this is the last gate before submitting.
    const issue = legCountIssue(draft.legs.length, POOLS[KINDS[pool.kind].key]);
    if (issue) throw new Error(tr("Not submitted: {0}", issue));
    // 🔒 §66: the buy-in has no ceiling, but it cannot be below the match minimum. The dialog checks this too, same reason.
    if (amount < pool.buyIn) throw new Error(tr("Not submitted: the buy-in is below this match's minimum of {0} USDT", fmtUsdt(pool.buyIn)));
    await apiPost(`/pools/${pool.id}/entries`, {
      idempotency_key: newIdemKey(),
      amount: amount.toString(),
      legs: draft.legs.map((l) => ({ ticker: bareSym(l.symbol), side: l.side })),
      name: profile.name,
      avatar: profile.variant,
    });
  });

  /// Withdraw (§69.6): POST /withdrawals/challenge for the challenge text → sign it in the wallet → POST /withdrawals to
  /// queue it.
  /// It only goes back to the wallet you signed in with, so the request carries no destination-address field; the payout
  /// itself is done by the custody back office (§71.111), not by the frontend.
  const withdrawFunds = (amount: bigint, onSubmitted: () => void) => act(FUNDS_BUSY, async () => {
    const { walletClient } = await chainLib();
    const wc = walletClient();
    if (!wc || !account) throw new Error(tr("Connect a wallet first"));
    const c = await apiPost<{ nonce: string; message: string }>("/withdrawals/challenge", { amount: amount.toString() });
    const signature = await wc.signMessage({ account, message: c.message });
    await apiPost("/withdrawals", { amount: amount.toString(), idempotency_key: newIdemKey(), nonce: c.nonce, signature });
    onSubmitted();
  });

  /// Cancel a queued withdrawal: the money returns to the arena balance at once. One already paid out cannot be
  /// cancelled (the endpoint returns 409).
  const cancelWithdrawal = (id: number) => act(FUNDS_BUSY, async () => {
    await apiPost(`/withdrawals/${id}/cancel`, {});
  });

  const canWrite = !!account && !readOnly;

  return (
    <div className="shell">
      {/* The site-wide code wall (§71.73): a layer of wallpaper fixed to the viewport, behind all content. With an empty list it does not render. */}
      <SiteWall board={stakeBoard} assets={assets} quotes={quotes} animated={tab === "home"} />
      <Topbar
        tab={tab}
        onTab={setTab}
        right={
          <ProfileBar
            key={`${account}:${loggedIn}`}
            address={account} profile={profile}
            faction={loggedIn && !demo ? session?.faction : undefined}
            factionEnabled={loggedIn && canWrite && !demo}
            onFaction={(faction) => setSession(current => current && current.address === account?.toLowerCase() ? { ...current, faction } : current)}
            onChange={changeProfile} onConnect={connect} onDisconnect={disconnect} walletName={walletName}
            points={pointsOf(points, account)} pointsState={points}
            holdings={holdings} pools={pools} myEntries={myEntries}
            funds={funds} arenaConfigured={configured} loggedIn={loggedIn} busy={busy !== null} canWrite={canWrite}
            onLogin={login} onLogout={logout} onFunds={(mode) => setFundsModal({ mode })} onGo={setTab}
          />
        }
      />

      <div className="stage">
        {demo && (
          <div className="demo-banner" role="status">
            <b>{tr("Demo mode")}</b>{tr("These numbers are simulated, for a look around only; you cannot enter a match or send a transaction.")}
          </div>
        )}
        <Ribbon board={stakeBoard} assets={assets} quotes={quotes} />
        {loginStage && <div className="site-banner" role="status" aria-live="polite">{loginStage === "prepare"
          ? tr("Preparing wallet sign-in…") : loginStage === "wallet"
            ? tr("Confirm the sign-in request in your wallet.") : tr("Verifying signature…")}</div>}
        {/* Operator notices and pause banners (§71.40): facts only (paused / the notice as written), with no reasons given and no promise of when it comes back (§29). Hidden in demo mode. */}
        {!demo && (status.notice || entriesPaused || withdrawalsPaused) && (
          <div className={`site-banner${status.notice?.level === "warn" || entriesPaused || withdrawalsPaused ? " warn" : ""}`} role="status">
            {entriesPaused && <b>{tr("Entries paused")}</b>}
            {withdrawalsPaused && <b>{tr("Withdrawals paused")}</b>}
            {status.notice && <span>{status.notice.text}</span>}
          </div>
        )}

        {site ? (
          <Suspense fallback={<main className="wide"><div className="note" role="status">{tr("Loading…")}</div></main>}>
            <SitePage
              page={site} notices={notices} configured={configured}
              board={stakeBoard} feeBps={feeBps} onGo={setTab}
            />
          </Suspense>
        ) : tab === "home" ? (
          <main className="wide">
            {chainNote && <div className="home-sec"><div className="note">{chainNote}</div></div>}
            {error && <div className="home-sec"><div className="note alert" role="alert" aria-live="assertive">{error}</div></div>}
            <Home
              configured={configured}
              myShares={myShares} notices={notices} onGo={setTab}
            />
          </main>
        ) : (
          <main>
            <PageHead key={tab} tab={tab} onTab={setTab} jackpot={jackpot} arenaConfigured={configured} />
            {chainNote && <div className="note">{chainNote}</div>}
            {error && <div className="note alert" role="alert" aria-live="assertive">{error}</div>}

            <Suspense fallback={<div className="note" role="status">{tr("Loading…")}</div>}>
            {tab === "mint" ? (
              // Asset Staking (§53 / §71): pool cards on top (live price conversion, total certificates staked, dividend
              // count, deposit), with the rules Q&A at the end. No tiers, and no activation progress shown.
              <>
                <StakePools board={stakeBoard} connected={canWrite} readOnly={readOnly} busy={busy} quotes={quotes} assets={assets} dividends={dividends} mints={mints} onDeposit={deposit} onOneClickStake={oneClickStake} account={account} />
                <StakeFaq board={stakeBoard} />
              </>
            ) : tab === "market" ? (
              // Certificate Market (§41): the certificate secondary market on its own page. listings undefined = the
              // contract is not configured, and the component says so itself.
              // 🔴 Uses `tradeBoard`, not `stakeBoard`: certificates already issued for a closed pool still have to be
              // tradable (§71.137); and not `certBoard` either, because burn certificates (uBNC) can equally be listed,
              // bought and transferred (§71.138).
              <Market
                board={tradeBoard} holdings={allHoldings} lots={allLots} quotes={quotes} account={account} canWrite={canWrite} busy={busy}
                listings={allListings} floors={floors ?? EMPTY_FLOORS} feeBps={feeBps}
                onBuy={buyListing} onList={listCerts} onCancel={cancelListing} onGo={setTab}
              />
            ) : tab === "meme" ? (
              // MEME Lab (§59 / §71.94): burn MEME for certificates. pools undefined = the on-chain contract address is
              // not configured.
              // A burn goes through `deposit()` (forking on mode into `BurnCertificate.mint`), and the busy id is the
              // board id.
              <Meme
                pools={memePools} dividends={dividends} lots={allLots} account={account} canWrite={canWrite} busy={busy}
                onBurn={deposit} onGo={setTab}
              />
            ) : tab === "build" ? (
              // 🔴 Strategy Builder only gets the redeemable family (`certBoard`): MEME does not enter the arena
              // (§71.94), the back end's `SYMBOL_CLASSES` has no meme class, and `enterable` is therefore always false.
              <Builder key={account ?? "guest"} board={stakeBoard} account={account} onGo={setTab} />
            ) : tab === "arena" ? (
              <Arena
                pools={pools} account={account} canWrite={canWrite} myEntries={myEntries}
                configured={configured} loggedIn={loggedIn} busy={busy !== null} source={source}
                featured={demo ? demoFeatured() : FEATURED} funds={funds} points={points} followDemo={demo}
                entriesPaused={entriesPaused}
                competitionAvailability={competitionAvailability}
                onEnter={enterPool}
                onFunds={(mode, amount) => setFundsModal({ mode, amount })}
                onLogin={login} onConnect={connect} onRaceChanged={() => void refresh()}
              />
            ) : (
              // My Account (§54): matches I entered / my stakes (unstaking lives here) / my dividends / MEME burn
              // certificates (§71.11 / §71.94) / the transaction record.
              <Account
                account={account} readOnly={readOnly} demo={demo} busy={busy}
                holdings={allHoldings} lots={allLots} quotes={quotes} pools={pools} board={tradeBoard} funds={funds}
                arenaConfigured={configured} source={source} jackpot={jackpot}
                onUnstake={unstake} onRedeem={redeem} onStake={stakeShares}
                onGo={setTab} onFunds={(mode) => setFundsModal({ mode })}
                floors={floors}
                meme={memeOn && memePools ? { pools: memePools } : undefined}
              />
            )}
            </Suspense>
          </main>
        )}
        {/* The wallet picker (§71.28): it closes itself once a wallet is picked and authorised; if the user presses reject in the wallet it stays open and shows why */}
        {picker && <WalletPicker onClose={() => setPicker(false)} onPick={pickWallet} />}
        {/* The deposit / withdraw dialog (§69): opened from the avatar popover and from the entry dialog's "add funds first" (the arena page's balance card, §71.22, is gone); after signing out funds becomes null and the dialog closes itself */}
        {fundsModal && funds && account && (
          <Suspense fallback={null}>
          <FundsModal
            mode={fundsModal.mode} funds={funds} account={account} busy={busy !== null} canWrite={canWrite} preset={fundsModal.amount} source={source}
            withdrawPaused={withdrawalsPaused} depositTransfer={depositFlow.transfer} depositActive={depositFlow.active}
            onClose={() => setFundsModal(null)}
            onDeposit={depositFlow.submit} onWithdraw={withdrawFunds} onCancel={cancelWithdrawal}
          />
          </Suspense>
        )}
        <Footer />
      </div>
    </div>
  );
}

/// The empty floor-price table handed to `Market` while the market is not configured. A module-level constant rather
/// than a fresh object each render, so the component is not handed a new reference every frame.
const EMPTY_FLOORS = new Map<number, Floor>();

/// The fixed negative busy ids for deposit / withdraw and for signing in; they cannot collide with any pool
/// (-1 - poolId) or any asset id.
const FUNDS_BUSY = -1_000_000;
const LOGIN_BUSY = -1_000_001;

/// How long the background tick reuses the board it last read (see `refresh`).
const BOARD_POLL_MS = 60_000;

/// The pages that read contracts (builder, staking, market, MEME, account). Home and arena are API-only.
function tabNeedsChain(tab: Tab): boolean {
  return tab === "build" || tab === "mint" || tab === "market" || tab === "meme" || tab === "mine";
}

/// No hash means the home page. `#start` (the old genesis mint page), `#board` (the old asset board) and `#stake` (the
/// spelling introduced when §52 renamed it) are all aliases of "Asset Staking", whose tab key is still mint (§40);
/// `#market` is the Certificate Market (§41); `#account` is an alias of "My Account", whose tab key is still mine
/// (§54); `#meme` is the MEME Lab (§59).
/// §67's two-level navigation: `#play` lands on the "Strategy" section's front page (the arena) and `#assets` on the
/// "Assets" section's front page (staking). No page's own hash changed.
function readHash(): Tab {
  // `#arena/<poolId>` is a single-match detail view (§68): the tab is still the arena, and Arena reads the pool number
  // out of the hash itself.
  const h = location.hash.slice(1).split("/")[0];
  if (h === "start" || h === "board" || h === "stake" || h === "assets") return "mint";
  if (h === "play") return "arena";
  if (h === "account") return "mine";
  return h === "mine" || h === "mint" || h === "market" || h === "meme" || h === "build" || h === "arena" || h === "home" ? h : "home";
}

function errorText(name: string): string {
  switch (name) {
    case "ZeroShares": return tr("At least 1 certificate");
    // Deposit / redeem (§71.80)
    case "MintPaused": return tr("Minting is paused for this asset's certificate; unstaking and redeeming are unaffected");
    case "AssetMintPaused": return tr("Deposits are paused for this asset; unstaking and redeeming are unaffected");
    case "PriceDeviationTooHigh": return tr("The on-chain spot price is too far from the average price, so deposits are blocked for now. Try again in a little while");
    case "AssetNotSupported": return tr("This asset is not listed yet");
    case "ERC1155InsufficientBalance": return tr("You do not hold enough certificates for this (staked ones have to be unstaked first)");
    case "ERC1155MissingApprovalForAll": return tr("Not approved yet; try again and the approval prompt comes first");
    case "SafeERC20FailedOperation": return tr("The token transfer failed: check that your wallet holds enough of the asset token and that it is approved");
    // Staking custody (§71.80)
    case "NotWhitelisted": return tr("This asset's certificate cannot be staked yet (it is not connected to the custody contract)");
    case "Paused": return tr("This feature is turned off for now");
    // MEME Lab (§59 / §71.94, the BurnCertificate family)
    case "AssetInAboveLimit": return tr("The on-chain pool quote moved by more than 1%. Refresh and try again");
    case "BurnIncomplete": return tr("This token did not actually reach the burn address (it may charge a transfer tax). The transaction was rolled back and nothing was taken from you");
    case "AssetNotAssigned": return tr("This token is not handled by this certificate contract. Try refreshing");
    case "AssetNotEnabled": return tr("This token has not been added to this certificate contract's list, so it cannot be burned yet");
    // The few added by admin contract v2 (§71.119). The old ABI does not have them, and hitting one would otherwise show a string of 0x hex.
    case "PriceUnavailable": return tr("The chain cannot price this asset at this moment. Try again in a little while");
    case "QuoteRouteUnavailable":
    case "QuoteRouteDisabled":
    case "QuoteRouteNotFound": return tr("Pricing this asset goes through a routing token to reach USDT, and that route is unavailable right now, so deposits are blocked for the moment");
    case "OracleNotSet": return tr("The registry has no price oracle configured for this asset, so deposits are blocked for now. Please contact the operator");
    // The secondary market (§41 / §71.80)
    case "ZeroAmount": return tr("The amount cannot be 0");
    case "ZeroPrice": return tr("The asking price cannot be 0");
    case "ListingNotActive": return tr("This listing was just bought or has been cancelled");
    case "PriceAboveLimit": return tr("The price just changed. Refresh and try again");
    case "InsufficientRemaining": return tr("There are not that many left");
    case "NothingPurchased": return tr("Nothing was bought. Try refreshing");
    case "CurrencyNotAllowed": return tr("This listing is not priced in USDT");
    case "NoSuchListing": return tr("That listing cannot be found. Try refreshing");
    case "NotSeller": return tr("This listing is not yours");
    case "ERC20InsufficientBalance": return tr("Your wallet does not hold enough tokens for this (buying needs USDT, depositing needs that asset's own token)");
    case "ERC20InsufficientAllowance": return tr("The token allowance is too low. Try the approval again");
    default: return name;
  }
}
