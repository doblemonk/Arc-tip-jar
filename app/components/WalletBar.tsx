"use client";

import { useCallback, useEffect, useState } from "react";

export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = "0x4cef52";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export interface WalletState {
  address: string | null;
  chainId: number | null;
  hasProvider: boolean;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletBar({
  onChange,
}: {
  onChange: (w: WalletState) => void;
}) {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    chainId: null,
    hasProvider: typeof window !== "undefined" && Boolean(window.ethereum),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;
    try {
      const accounts = (await eth.request({
        method: "eth_accounts",
      })) as string[];
      const chainHex = (await eth.request({
        method: "eth_chainId",
      })) as string;
      const next: WalletState = {
        address: accounts[0] ?? null,
        chainId: chainHex ? parseInt(chainHex, 16) : null,
        hasProvider: true,
      };
      setWallet(next);
      onChange(next);
    } catch {
      // Ignore — wallet stays disconnected.
    }
  }, [onChange]);

  useEffect(() => {
    refresh();
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccounts = () => refresh();
    const onChain = () => refresh();
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [refresh]);

  const connect = async () => {
    const eth = window.ethereum;
    if (!eth) {
      setError("No wallet found in this browser. Use the simulated signing fallback below, or install a wallet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainHex = (await eth.request({
        method: "eth_chainId",
      })) as string;
      const next: WalletState = {
        address: accounts[0] ?? null,
        chainId: chainHex ? parseInt(chainHex, 16) : null,
        hasProvider: true,
      };
      setWallet(next);
      onChange(next);
    } catch (err) {
      setError(
        `Wallet connection was rejected or failed: ${(err as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    const next: WalletState = {
      address: null,
      chainId: wallet.chainId,
      hasProvider: wallet.hasProvider,
    };
    setWallet(next);
    onChange(next);
  };

  const switchToArc = async () => {
    const eth = window.ethereum;
    if (!eth) return;
    setBusy(true);
    setError(null);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_ID_HEX }],
      });
    } catch (err) {
      const e = err as { code?: number; message?: string };
      if (e.code === 4902) {
        // Chain is not in the wallet — add it (ChainList: chain 5042002).
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: ARC_CHAIN_ID_HEX,
                chainName: "Arc Testnet",
                nativeCurrency: {
                  name: "USDC",
                  symbol: "USDC",
                  decimals: 18,
                },
                rpcUrls: ["https://rpc.testnet.arc.io"],
                blockExplorerUrls: ["https://explorer.testnet.arc.io"],
              },
            ],
          });
        } catch (addErr) {
          setError(`Could not add Arc Testnet: ${(addErr as Error).message}`);
        }
      } else {
        setError(`Could not switch network: ${e.message ?? "unknown error"}`);
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const onArc = wallet.chainId === ARC_CHAIN_ID;

  return (
    <div className="walletbar">
      {!wallet.hasProvider && (
        <span className="muted small">
          No wallet detected in this browser — you can still try the
          clearly-labelled simulated signing fallback.
        </span>
      )}
      {wallet.address ? (
        <>
          <span className="address">{shortAddress(wallet.address)}</span>
          <span
            className={`chain-badge ${onArc ? "" : "wrong"}`}
            title={
              onArc
                ? "Connected to Arc Testnet"
                : "Wrong network — signing is blocked until you switch"
            }
          >
            {wallet.chainId === null
              ? "Chain unknown"
              : onArc
                ? "Arc Testnet · 5042002"
                : `Chain ${wallet.chainId} — not Arc Testnet`}
          </span>
          {!onArc && (
            <button type="button" onClick={switchToArc} disabled={busy}>
              Switch to Arc Testnet
            </button>
          )}
          <button type="button" className="secondary" onClick={disconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <button type="button" onClick={connect} disabled={busy || !wallet.hasProvider}>
          Connect Wallet
        </button>
      )}
      {error && <span className="small" style={{ color: "var(--err)" }}>{error}</span>}
    </div>
  );
}
