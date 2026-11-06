"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Donation {
  id: number;
  amountBase: string;
  status: string;
  failureReason: string | null;
  transferId: string | null;
  transferSubmitted: boolean;
}

function formatUsdc(base: string): string {
  const b = BigInt(base);
  const whole = b / 1_000_000n;
  const frac = (b % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${wholeStr}.${frac}` : `${wholeStr}.00`;
}

export default function DonationPage({
  params,
}: {
  params: { id: string };
}) {
  const [donation, setDonation] = useState<Donation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thankYou, setThankYou] = useState<{
    text: string;
    note: string;
    source: string;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/donations/${params.id}`)
      .then((r) => r.json())
      .then((b) => {
        if (b.error) throw new Error(b.error);
        setDonation(b.donation);
      })
      .catch((e) => setError((e as Error).message));
  }, [params.id]);

  useEffect(() => {
    if (donation?.status !== "received" || thankYou) return;
    fetch("/api/creator")
      .then((r) => r.json())
      .then((c) =>
        fetch("/api/ai/thank-you", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "thank-you",
            amount: `${formatUsdc(donation.amountBase)} USDC`,
            creatorName: c.creator?.name ?? "the creator",
          }),
        }),
      )
      .then((r) => r.json())
      .then((b) => {
        if (b.text) setThankYou({ text: b.text, note: b.note, source: b.source });
      })
      .catch(() => undefined);
  }, [donation?.status, donation?.amountBase, thankYou]);

  if (error) return <div className="banner err">{error}</div>;
  if (!donation) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <h1>
        Tip #{donation.id} · {formatUsdc(donation.amountBase)} USDC{" "}
        <span className={`status-pill status-${donation.status}`}>
          {donation.status.replace("_", " ")}
        </span>
      </h1>
      {donation.status === "received" && (
        <div className="banner ok">
          <strong>Thank you — your tip was received!</strong>
          {thankYou && (
            <>
              <p style={{ margin: "8px 0 0" }}>{thankYou.text}</p>
              <p className="small muted" style={{ margin: "8px 0 0" }}>
                {thankYou.note} (source: {thankYou.source})
              </p>
            </>
          )}
        </div>
      )}
      {donation.status === "failed" && (
        <div className="banner err">
          <strong>This tip failed: {donation.failureReason}</strong>
        </div>
      )}
      {donation.status === "processing" && (
        <p>
          Still processing — the thank-you message appears here once the tip
          is received.
        </p>
      )}
      {donation.transferId && (
        <p className="small muted">
          Transfer: <code>{donation.transferId}</code>
          {donation.transferSubmitted ? " (real Circle transfer)" : " (local id — not a Circle transfer)"}
        </p>
      )}
      <p style={{ marginTop: 16 }}>
        <Link href="/">← Back to the tip page</Link>
      </p>
    </div>
  );
}
