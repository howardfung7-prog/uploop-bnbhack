// The deposit dialog's state shapes and its pure helpers, split out of ./deposit-transfer.ts so the page's main
// bundle does not carry viem's encoders for them (§71.174). ./deposit-transfer.ts re-exports all of it.
import type { Address, Hash } from "viem";

export type DepositPhase = "network" | "wallet" | "submitted" | "confirmed" | "credited" | "failed";
export interface DepositTransfer {
  owner: Address;
  chainId: number;
  token: Address;
  to: Address;
  amount: string;
  phase: DepositPhase;
  startedAt: number;
  hash?: Hash;
  error?: string;
}
export function depositErrorKey(error: unknown): string {
  const seen = new Set<unknown>();
  let e = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const item = e as { code?: number; message?: string; cause?: unknown; data?: { originalError?: unknown } };
    if (item.code === 4001) return "You cancelled the wallet request.";
    if (item.code === -32002) return "A wallet request is already pending. Open your wallet to complete or reject it before retrying.";
    if (item.code === 4902) return "Add the displayed deposit network in your wallet, then try again.";
    if (/insufficient funds|insufficient balance|exceeds balance/i.test(item.message ?? "")) return "Insufficient token balance or network fee. Check your wallet.";
    if (item.message === "DepositConfiguration") return "Deposit configuration is invalid. No transfer was requested.";
    if (item.message === "DepositAmount") return "Check the deposit amount and minimum.";
    if (item.message === "DepositAccountChanged" || item.message === "DepositNetworkChanged") return "Wallet account or network changed. Reopen the deposit dialog.";
    e = item.cause ?? item.data?.originalError;
  }
  return "No transaction hash was received. Check your wallet activity before retrying; a transfer may still have been sent.";
}

export function depositExplorer(chainId: number, hash: string): string | null {
  const base: Record<number, string> = { 56: "https://bscscan.com", 97: "https://testnet.bscscan.com", 11155111: "https://sepolia.etherscan.io", 1: "https://etherscan.io" };
  return base[chainId] && /^0x[0-9a-f]{64}$/i.test(hash) ? `${base[chainId]}/tx/${hash}` : null;
}
