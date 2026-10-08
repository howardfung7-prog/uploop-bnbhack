import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { API_BASE, ApiError, apiErrorText } from "./api";
import { loadDepositAddress, loadDeposits } from "./arena";
import type { DepositInfo } from "./arena";
import { chosenProvider } from "./wallet";
import { depositErrorKey } from "./deposit-model";
import type { DepositTransfer } from "./deposit-model";

/// The viem-backed send and receipt code, loaded when a deposit is actually sent or tracked (§71.174).
const transferLib = () => import("./deposit-transfer");

const storageKey = (owner: string) => `uploop:deposit:${API_BASE}:${owner.toLowerCase()}`;
function restore(owner: Address): DepositTransfer | null {
  try {
    const t = JSON.parse(localStorage.getItem(storageKey(owner)) ?? "null") as DepositTransfer | null;
    return t && t.owner.toLowerCase() === owner.toLowerCase() && /^0x[0-9a-f]{64}$/i.test(t.hash ?? "")
      && ["submitted", "confirmed", "credited", "failed"].includes(t.phase) ? t : null;
  } catch { return null; }
}
// Only reads get a deadline. Timing out a wallet signing request would allow duplicate sends.
async function readWithDeadline<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("DepositReadTimeout")), 12_000);
    })]);
  } finally { clearTimeout(timer); }
}

export function useDeposit(account: Address | null, onCredited: () => void) {
  const [transfer, setTransfer] = useState<DepositTransfer | null>(() => account ? restore(account) : null);
  const sending = useRef(false);
  const creditedCallback = useRef(onCredited);
  creditedCallback.current = onCredited;
  const save = useCallback((t: DepositTransfer) => {
    setTransfer(t);
    if (t.hash) {
      try { localStorage.setItem(storageKey(t.owner), JSON.stringify(t)); } catch { /* still tracked in memory */ }
    }
  }, []);
  useEffect(() => { setTransfer(account ? restore(account) : null); }, [account]);

  const current = transfer?.owner.toLowerCase() === account?.toLowerCase() ? transfer : null;
  const active = !!current && !["credited", "failed"].includes(current.phase);
  const submit = async (info: DepositInfo, amount: bigint) => {
    if (!account || sending.current || active || !info.address) return;
    sending.current = true;
    let t: DepositTransfer = { owner: account, chainId: info.chainId, token: info.token, to: info.address,
      amount: amount.toString(), phase: "network", startedAt: Date.now() };
    save(t);
    try {
      const provider = chosenProvider();
      if (!provider) throw new Error("DepositAccountChanged");
      // Revalidate the session's destination immediately before asking the wallet to send.
      const fresh = await readWithDeadline(loadDepositAddress());
      if (fresh.address?.toLowerCase() !== info.address.toLowerCase() || fresh.token.toLowerCase() !== info.token.toLowerCase()
        || fresh.chainId !== info.chainId) throw new Error("DepositConfiguration");
      const { submitDeposit } = await transferLib();
      const hash = await submitDeposit(provider, account, fresh, amount, phase => { t = { ...t, phase }; save(t); });
      t = { ...t, phase: "submitted", hash };
      save(t);
    } catch (error) { save({ ...t, phase: "failed", error: error instanceof ApiError ? apiErrorText(error) : depositErrorKey(error) }); }
    finally { sending.current = false; }
  };

  useEffect(() => {
    if (!current?.hash || !active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const t = current;
    const poll = async () => {
      // An unavailable wallet RPC must not stop checking authoritative backend crediting.
      const [records, receipt] = await Promise.allSettled([
        readWithDeadline(loadDeposits(t.owner)),
        chosenProvider() ? readWithDeadline(transferLib().then(({ depositReceipt }) => depositReceipt(chosenProvider()!, t))) : Promise.resolve("unverified"),
      ]);
      if (!alive) return;
      if (records.status === "fulfilled" && records.value.deposits.some(d => d.credited && d.txhash.toLowerCase() === t.hash!.toLowerCase())) {
        save({ ...t, phase: "credited", error: undefined });
        creditedCallback.current();
        return;
      }
      if (receipt.status === "fulfilled" && receipt.value === "failed") {
        save({ ...t, phase: "failed", error: "The deposit transaction reverted. No tokens were deposited; network fees may have been spent." });
        return;
      }
      if (receipt.status === "fulfilled" && receipt.value === "confirmed" && t.phase !== "confirmed") {
        save({ ...t, phase: "confirmed" });
        return;
      }
      timer = setTimeout(poll, 6_000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [current, active, save]);
  return { transfer: current, active, submit };
}
