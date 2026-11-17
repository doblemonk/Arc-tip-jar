"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WalletBar, { ARC_CHAIN_ID, type WalletState } from "./WalletBar";

interface Creator {
  name: string;
  description: string;
  avatarUrl: string;
  thankYouMessage: string;
  recipientAddress: string;
}

interface Donation {
  id: number;
  amountBase: string;
  status: string;
  failureReason: string | null;
  needsManualReview: boolean;
  maxFeeBase: string | null;
  feeTotalUsdc: string | null;
  transferId: string | null;
  transferSubmitted: boolean;
  simulated: boolean;
  expiresAt: string;
  signedAt: string | null;
}

const PRESETS = ["1", "5", "10"];

function formatUsdc(base: string): string {
  const b = BigInt(base);
  const whole = b / 1_000_000n;
  const frac = (b % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${wholeStr}.${frac}` : `${wholeStr}.00`;
}

export default function TipFlow({
  creator,
  subtitle,
  realTransferEnabled,
  storageMode,
}: {
  creator: Creator;
  subtitle: string;
  realTransferEnabled: boolean;
  storageMode: string;
}) {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    chainId: null,
    hasProvider: false,
  });
  const [amount, setAmount] = useState("1");
  const [custom, setCustom] = useState(false);
  const [message, setMessage] = useState("");
  const [fee, setFee] = useState<{
    feeTotalUsdc: string;
    maxFeeBase: string;
  } | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [donation, setDonation] = useState<Donation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [thankYou, setThankYou] = useState<{
    text: string;
    source: string;
    note: string;
  } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onArc = wallet.chainId === ARC_CHAIN_ID;

  // --- live fee estimate (debounced) -------------------------------------
  useEffect(() => {
    setFee(null);
    setFeeError(null);
    const t = setTimeout(async () => {
      if (!amount || Number(amount) <= 0) return;
      setFeeLoading(true);
      try {
        const res = await fetch("/api/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountUsdc: amount,
            depositor: wallet.address ?? undefined,
            recipient: creator.recipientAddress,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          setFeeError(body.error ?? "Fee estimate failed");
        } else {
          setFee({
            feeTotalUsdc: body.feeTotalUsdc,
            maxFeeBase: body.maxFeeBase,
          });
        }
      } catch (e) {
        setFeeError((e as Error).message);
      } finally {
        setFeeLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [amount, wallet.address, creator.recipientAddress]);

  const feeWarns =
    fee !== null &&
    Math.round(parseFloat(fee.feeTotalUsdc) * 1_000_000) >=
      Math.round(parseFloat(amount || "0") * 1_000_000);

  // --- expiry countdown ---------------------------------------------------
  useEffect(() => {
    if (!donation || donation.status !== "awaiting_payment") {
      setSecondsLeft(null);
      return;
    }
    const tick = () =>
      setSecondsLeft(
        Math.max(0, Math.floor((new Date(donation.expiresAt).getTime() - Date.now()) / 1000)),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [donation]);

  const expired =
    donation?.status === "awaiting_payment" && secondsLeft === 0;

  // --- status polling ------------------------------------------------------
  const fetchStatus = useCallback(async (id: number) => {
    const res = await fetch(`/api/donations/${id}`);
    if (!res.ok) return;
    const body = await res.json();
    setDonation(body.donation);
    if (body.donation.status === "received" || body.donation.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
    }
  }, []);

  useEffect(() => {
    if (donation?.status === "processing") {
      pollRef.current = setInterval(() => fetchStatus(donation.id), 5000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
    return undefined;
  }, [donation?.status, donation?.id, fetchStatus]);

  // --- thank-you message (River, or saved default) ------------------------
  useEffect(() => {
    if (donation?.status !== "received" || thankYou) return;
    fetch("/api/ai/thank-you", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "thank-you",
        amount: `${formatUsdc(donation.amountBase)} USDC`,
        creatorName: creator.name,
        donorMessage: message || undefined,
      }),
    })
      .then((r) => r.json())
      .then((b) => {
        if (b.text) setThankYou({ text: b.text, source: b.source, note: b.note });
      })
      .catch(() => undefined);
  }, [donation?.status, donation?.amountBase, creator.name, message, thankYou]);

  const createDonation = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/donations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsdc: amount, message }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create donation");
      setDonation(body.donation);
      if (body.estimateError) {
        setNote(`Live fee estimate failed at creation: ${body.estimateError}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signWithWallet = async () => {
    if (!donation || !wallet.address) return;
    if (!onArc) {
      setError("Switch to Arc Testnet before signing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const prepRes = await fetch(`/api/donations/${donation.id}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donorAddress: wallet.address }),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error ?? "Could not build burn intent");
      const eth = window.ethereum;
      if (!eth) throw new Error("No wallet provider found.");
      const signature = (await eth.request({
        method: "eth_signTypedData_v4",
        params: [wallet.address, JSON.stringify(prep.typedData)],
      })) as string;
      const signRes = await fetch(`/api/donations/${donation.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      const signed = await signRes.json();
      if (!signRes.ok) throw new Error(signed.error ?? "Signing failed");
      setDonation(signed.donation);
      setNote(signed.note ?? null);
    } catch (e) {
      // A wallet rejection leaves the donation untouched (still awaiting_payment).
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signSimulated = async () => {
    if (!donation) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/donations/${donation.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulated: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Simulated signing failed");
      setDonation(body.donation);
      setNote(body.note ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDonation(null);
    setThankYou(null);
    setError(null);
    setNote(null);
  };

  return (
    <div>
      {storageMode === "memory" && (
        <div className="banner warn">
          Storage warning: Upstash Redis is not configured, so this deployment
          uses ephemeral in-memory storage. Donations will not survive a
          redeploy or a cold start. Set KV_REST_API_URL and KV_REST_API_TOKEN
          in Vercel to fix this.
        </div>
      )}
      {!realTransferEnabled && (
        <div className="banner info">
          Real transfer submission is disabled — no CIRCLE_API_KEY is set.
          Burn intents are built and signed for real, but donations stay in
          processing until a Gateway webhook (or the dashboard simulator)
          finalizes them.
        </div>
      )}

      <div className="card">
        {creator.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={creator.avatarUrl}
            alt={creator.name}
            style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }}
          />
        )}
        <h1 style={{ marginBottom: 4 }}>{creator.name}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{subtitle}</p>
        {creator.description && <p>{creator.description}</p>}
        <p className="small muted">
          Tips go to <code>{creator.recipientAddress}</code> on Arc Testnet.
        </p>
      </div>

      <WalletBar onChange={setWallet} />

      {!donation && (
        <div className="card">
          <h2>Send a tip</h2>
          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={amount === p && !custom ? "active" : "secondary"}
                onClick={() => {
                  setAmount(p);
                  setCustom(false);
                }}
              >
                {p} USDC
              </button>
            ))}
            <button
              type="button"
              className={custom ? "active" : "secondary"}
              onClick={() => setCustom(true)}
            >
              Custom
            </button>
          </div>
          {custom && (
            <div>
              <label htmlFor="amount">Custom amount (USDC, 0.01 – 1,000)</label>
              <input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="2.5"
              />
            </div>
          )}
          <label htmlFor="message">Message (optional)</label>
          <input
            id="message"
            value={message}
            maxLength={280}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Keep building!"
          />
          <div style={{ marginTop: 12 }}>
            {feeLoading && <p className="muted small">Estimating Gateway fee…</p>}
            {feeError && (
              <p className="small" style={{ color: "var(--err)" }}>
                Fee estimate failed: {feeError}
              </p>
            )}
            {fee && (
              <p className="small">
                Estimated Gateway fee: ~{fee.feeTotalUsdc} USDC (max{" "}
                {formatUsdc(fee.maxFeeBase)} USDC). Your tip: {amount} USDC.
              </p>
            )}
            {feeWarns && (
              <div className="banner warn">
                Heads up: the estimated fee is as large as the tip itself.
                Consider a larger tip — the fee is mostly fixed per transfer.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={createDonation}
            disabled={busy || !amount || Number(amount) <= 0}
            style={{ marginTop: 8 }}
          >
            {busy ? "Creating…" : `Tip ${amount || "…"} USDC`}
          </button>
          <p className="small muted">
            You sign a Gateway burn intent (EIP-712) with your wallet. No
            manual bridging, no Arc gas for you — the donor&apos;s Gateway
            balance must be funded first.
          </p>
        </div>
      )}

      {donation && (
        <div className="card">
          <h2>
            Tip #{donation.id} · {formatUsdc(donation.amountBase)} USDC{" "}
            <span className={`status-pill status-${donation.status}`}>
              {donation.status.replace("_", " ")}
            </span>
          </h2>
          {donation.status === "awaiting_payment" && (
            <>
              {secondsLeft !== null && !expired && (
                <p className="small muted">
                  Sign within {Math.floor(secondsLeft / 60)}:
                  {String(secondsLeft % 60).padStart(2, "0")} — unsigned tips
                  expire after 15 minutes.
                </p>
              )}
              {expired && (
                <div className="banner err">
                  This tip expired unsigned. Create a new tip to try again.
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={signWithWallet}
                  disabled={busy || expired || !wallet.address || !onArc}
                >
                  {busy ? "Signing…" : "Sign burn intent with wallet"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={signSimulated}
                  disabled={busy || expired}
                >
                  Simulate signing (test only)
                </button>
              </div>
              {!wallet.address && (
                <p className="small muted">
                  Connect your wallet above to sign, or use the clearly
                  labelled simulated signing fallback.
                </p>
              )}
              {wallet.address && !onArc && (
                <p className="small" style={{ color: "var(--warn)" }}>
                  You are on chain {wallet.chainId} — switch to Arc Testnet
                  to sign.
                </p>
              )}
            </>
          )}
          {donation.status === "processing" && (
            <>
              <p>
                Your burn intent is signed and the tip is processing.
                {donation.simulated
                  ? " (Simulated signing — no real transfer was submitted.)"
                  : donation.transferSubmitted
                    ? ` Transfer ${donation.transferId} was submitted to Circle Gateway.`
                    : " Real transfer submission is disabled (no Circle API key) — finalization happens via webhook."}
              </p>
              <p className="small muted">
                Status refreshes automatically. The thank-you page appears
                only once the tip is received.
              </p>
              <button type="button" className="secondary" onClick={() => fetchStatus(donation.id)}>
                Refresh status
              </button>
            </>
          )}
          {donation.status === "received" && (
            <div className="banner ok">
              <strong>Thank you — your tip was received!</strong>
              <p style={{ margin: "8px 0 0" }}>
                {thankYou
                  ? thankYou.text
                  : creator.thankYouMessage || "Your support means a lot."}
              </p>
              {thankYou && (
                <p className="small muted" style={{ margin: "8px 0 0" }}>
                  {thankYou.note} (source: {thankYou.source})
                </p>
              )}
            </div>
          )}
          {donation.status === "failed" && (
            <div className="banner err">
              <strong>This tip failed: {donation.failureReason}</strong>
              {donation.needsManualReview && (
                <p style={{ margin: "8px 0 0" }}>
                  Needs manual review — the funds may already have been
                  minted. Contact the creator.
                </p>
              )}
            </div>
          )}
          {donation.transferId && (
            <p className="small muted">
              Transfer: <code>{donation.transferId}</code>
              {donation.transferSubmitted ? " (real Circle transfer)" : " (local id — not a Circle transfer)"}
            </p>
          )}
          {error && (
            <p className="small" style={{ color: "var(--err)" }}>{error}</p>
          )}
          {note && <p className="small muted">{note}</p>}
          {(donation.status === "received" ||
            donation.status === "failed" ||
            expired) && (
            <button type="button" className="secondary" onClick={reset}>
              Send another tip
            </button>
          )}
        </div>
      )}
    </div>
  );
}
