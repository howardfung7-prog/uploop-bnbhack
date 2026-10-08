import { decodeEventLog, encodeFunctionData, erc20Abi, isAddress, toHex, zeroAddress } from "viem";
import type { Address, EIP1193Provider, Hash } from "viem";
import type { DepositInfo } from "./arena";
import type { DepositTransfer } from "./deposit-model";
export * from "./deposit-model";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Keep the exact provider and recipient captured at the click. Never retry a send request.
export async function submitDeposit(provider: EIP1193Provider, owner: Address, info: DepositInfo,
  amount: bigint, progress: (phase: "network" | "wallet") => void): Promise<Hash> {
  if (!info.address || !isAddress(info.address, { strict: false }) || same(info.address, zeroAddress)
    || !isAddress(info.token, { strict: false }) || same(info.token, zeroAddress)
    || !Number.isSafeInteger(info.chainId) || info.chainId <= 0) throw new Error("DepositConfiguration");
  if (amount <= 0n || amount < info.minDeposit) throw new Error("DepositAmount");
  progress("network");
  if (Number(await provider.request({ method: "eth_chainId" })) !== info.chainId) {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(info.chainId) }] });
  }
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!accounts[0] || !same(accounts[0], owner)) throw new Error("DepositAccountChanged");
  if (Number(await provider.request({ method: "eth_chainId" })) !== info.chainId) throw new Error("DepositNetworkChanged");
  progress("wallet");
  const hash = await provider.request({ method: "eth_sendTransaction", params: [{
    from: owner, to: info.token, chainId: toHex(info.chainId),
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [info.address, amount] }),
  }] });
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("DepositMissingHash");
  return hash;
}

// Receipt reads use the deposit network, never the site's unrelated public RPC.
// A successful receipt alone is insufficient: require the matching ERC20 Transfer event.
export async function depositReceipt(provider: EIP1193Provider, transfer: DepositTransfer): Promise<"pending" | "confirmed" | "failed" | "unverified"> {
  if (!transfer.hash || Number(await provider.request({ method: "eth_chainId" })) !== transfer.chainId) return "unverified";
  const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [transfer.hash] });
  if (!receipt) return "pending";
  if (Number(receipt.status) === 0) return "failed";
  if (Number(receipt.status) !== 1) return "unverified";
  const found = receipt.logs.some(log => {
    if (!same(log.address, transfer.token)) return false;
    try {
      const event = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
      return same(event.args.from, transfer.owner) && same(event.args.to, transfer.to) && event.args.value === BigInt(transfer.amount);
    } catch { return false; }
  });
  return found ? "confirmed" : "unverified";
}
