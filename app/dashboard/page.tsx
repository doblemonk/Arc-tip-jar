"use client";

import { useState } from "react";

interface Totals {
  receivedCount: number;
  totalReceivedBase: string;
  failedCount: number;
  reviewCount: number;
  processingCount: number;
  awaitingCount: number;
  orphanCount: number;
  testDonationCount: number;
}

interface DonationRow {
  id: number;
  amountBase: string;
  status: string;
  failureReason: string | null;
  needsManualReview: boolean;
  transferId: string | null;
  transferSubmitted: boolean;
  simulated: boolean;
  donorAddress: string | null;
  donorChainId: number | null;
  walletSignature: string | null;
  createdAt: string;
  isTest: boolean;
}

interface WebhookRow {
  notificationId: string;
  notificationType: string;
  receivedAt: string;
  donationId: number | null;
  outcome: string;
  detail: string;
}

interface DashboardData {
  totals: Totals;
  donations: DonationRow[];
  webhookEvents: WebhookRow[];
  storage: string;
  realTransferEnabled: boolean;
  riverConfigured: boolean;
}

function formatUsdc(base: string): string {
  const b = BigInt(base);
  const whole = b / 1_000_000n;
  const frac = (b % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${wholeStr}.${frac}` : `${wholeStr}.00`;
}

export default function Dashboard() {
  const [pin, setPin] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [simDonationId, setSimDonationId] = useState("");
  const [simOverrides, setSimOverrides] = useState("");
  const [simResult, setSimResult] = useState<string | null>(null);

  const [labResults, setLabResults] = useState<{
    total: number;
    passed: number;
    failed: number;
    results: { name: string; passed: boolean; detail: string }[];
  } | null>(null);

  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  const load = async (pinValue: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load dashboard");
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runLab = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/test-lab/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Test Lab failed");
      setLabResults(body);
      await load(pin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    setBusy(true);
    setError(null);
    setSimResult(null);
    try {
      let overrides = {};
      if (simOverrides.trim()) {
        overrides = JSON.parse(simOverrides);
      }
      const res = await fetch("/api/simulate-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          donationId: Number(simDonationId),
          overrides,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Simulator failed");
      setSimResult(
        `Outcome: ${body.outcome} — ${body.detail} (donation #${body.donationId ?? "—"})`,
      );
      await load(pin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cleanup = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/test-lab/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Cleanup failed");
      setCleanupResult(
        `Removed ${body.removedDonations} Test Lab donations and ${body.removedEvents} webhook events. Real tips and the creator profile are untouched.`,
      );
      setConfirmCleanup(false);
      await load(pin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/donations/${id}/reconcile`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Reconcile failed");
      setError(null);
      alert(body.detail ?? "Reconciled.");
      await load(pin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="card">
        <h1>Creator dashboard</h1>
        <p className="muted">
          PIN-protected. Totals, history, failure reasons, the webhook log,
          the simulator and Test Lab live here.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(pin);
          }}
        >
          <label htmlFor="pin">Dashboard PIN</label>
          <input
            id="pin"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoComplete="current-password"
          />
          {error && <p className="small" style={{ color: "var(--err)" }}>{error}</p>}
          <button type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? "Unlocking…" : "Unlock dashboard"}
          </button>
        </form>
      </div>
    );
  }

  const orphans = data.webhookEvents.filter((e) => e.outcome === "orphan");

  return (
    <div>
      <div className="card">
        <h1>Creator dashboard</h1>
        {data.storage === "memory" && (
          <div className="banner warn">
            Storage warning: Vercel KV is not configured — this deployment
            uses ephemeral in-memory storage.
          </div>
        )}
        <div className="grid2">
          <div>
            <div className="stat">{formatUsdc(data.totals.totalReceivedBase)} USDC</div>
            <div className="stat-label">Total received ({data.totals.receivedCount} tips)</div>
          </div>
          <div>
            <div className="stat">{data.totals.failedCount}</div>
            <div className="stat-label">
              Failed ({data.totals.reviewCount} need manual review)
            </div>
          </div>
          <div>
            <div className="stat">{data.totals.processingCount}</div>
            <div className="stat-label">Processing</div>
          </div>
          <div>
            <div className="stat">{data.totals.orphanCount}</div>
            <div className="stat-label">Orphan webhook events</div>
          </div>
        </div>
        <p className="small muted">
          Real transfer submission: {data.realTransferEnabled ? "enabled (CIRCLE_API_KEY set)" : "disabled (no CIRCLE_API_KEY)"} · River AI:{" "}
          {data.riverConfigured ? "live" : "saved defaults only"} · Test Lab
          donations in store: {data.totals.testDonationCount}
        </p>
        <button type="button" className="secondary" onClick={() => load(pin)}>
          Refresh
        </button>
      </div>

      <div className="card">
        <h2>History</h2>
        {data.donations.length === 0 ? (
          <p className="muted">
            No tips yet — share your tip link and your first one will land here.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Wallet</th>
                <th>Transfer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.donations.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.id}
                    {d.isTest ? " (test)" : ""}
                  </td>
                  <td>{formatUsdc(d.amountBase)} USDC</td>
                  <td>
                    <span className={`status-pill status-${d.status}`}>
                      {d.status.replace("_", " ")}
                    </span>
                    {d.failureReason && (
                      <div className="small">{d.failureReason}</div>
                    )}
                    {d.needsManualReview && (
                      <div className="small" style={{ color: "var(--warn)" }}>
                        Needs manual review
                      </div>
                    )}
                  </td>
                  <td className="small">
                    {d.donorAddress
                      ? `${d.donorAddress.slice(0, 6)}…${d.donorAddress.slice(-4)}`
                      : "—"}
                    {d.donorChainId ? <div>chain {d.donorChainId}</div> : null}
                    {d.simulated && <div>simulated signing</div>}
                  </td>
                  <td className="small">
                    {d.transferId ? <code>{d.transferId.slice(0, 24)}…</code> : "—"}
                    <div>{d.transferSubmitted ? "real" : "local id"}</div>
                  </td>
                  <td>
                    {d.status === "processing" && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => reconcile(d.id)}
                        disabled={busy}
                      >
                        Reconcile
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Webhook simulator</h2>
        <p className="small muted">
          Sends a gateway.mint.finalized event through the same processing as
          a real Circle webhook. Expected values — stated explicitly, because
          the old version hid them and three test donations failed on it:
        </p>
        <ul className="small">
          <li>
            <strong>token: &quot;USDC&quot;</strong> — the token SYMBOL as
            published by GET /v1/info. /v1/info publishes no token addresses,
            so a contract address here is wrong and fails with TOKEN_MISMATCH.
          </li>
          <li><strong>env: &quot;testnet&quot;</strong> — anything else fails with WRONG_ENV.</li>
          <li><strong>domain: 26</strong> — Arc Testnet; anything else fails with WRONG_DOMAIN.</li>
          <li><strong>amount:</strong> the donation&apos;s exact amount in integer base units.</li>
          <li><strong>attestations[].to:</strong> the creator&apos;s recipient address.</li>
        </ul>
        <label htmlFor="simId">Donation ID</label>
        <input
          id="simId"
          inputMode="numeric"
          value={simDonationId}
          onChange={(e) => setSimDonationId(e.target.value)}
          placeholder="e.g. 3"
        />
        <label htmlFor="simOverrides">
          Overrides (JSON, optional — e.g. to test a failure path)
        </label>
        <textarea
          id="simOverrides"
          value={simOverrides}
          onChange={(e) => setSimOverrides(e.target.value)}
          placeholder='{"token": "0x3600000000000000000000000000000000000000"}'
        />
        <button
          type="button"
          onClick={simulate}
          disabled={busy || !simDonationId}
          style={{ marginTop: 12 }}
        >
          Send simulated mint.finalized
        </button>
        {simResult && <p className="small" style={{ marginTop: 8 }}>{simResult}</p>}
        {error && <p className="small" style={{ color: "var(--err)" }}>{error}</p>}
      </div>

      <div className="card">
        <h2>Webhook log</h2>
        {data.webhookEvents.length === 0 ? (
          <p className="muted">No webhook events yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Notification</th>
                <th>Type</th>
                <th>Outcome</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.webhookEvents.map((e) => (
                <tr key={e.notificationId}>
                  <td className="small"><code>{e.notificationId.slice(0, 24)}</code></td>
                  <td className="small">{e.notificationType}</td>
                  <td>
                    <span className="status-pill status-processing">{e.outcome}</span>
                  </td>
                  <td className="small">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {orphans.length > 0 && (
          <div className="banner warn" style={{ marginTop: 12 }}>
            {orphans.length} orphan event(s): no donation matched their
            transferId. Nothing was changed for those events.
          </div>
        )}
      </div>

      <div className="card">
        <h2>Test Lab</h2>
        <p className="small muted">
          Runs the blueprint&apos;s 12 cases against the real store and
          webhook logic with throwaway test donations.
        </p>
        <button type="button" onClick={runLab} disabled={busy}>
          Run Test Lab (12 cases)
        </button>
        {labResults && (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>
                {labResults.passed}/{labResults.total} passed
              </strong>
            </p>
            <table>
              <tbody>
                {labResults.results.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.passed ? "✅ PASS" : "❌ FAIL"}</td>
                    <td className="small">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Remove Test Lab data</h2>
        <p className="small muted">
          Permanently deletes Test Lab donations and their webhook events.
          Real tips and the creator profile are never touched.
        </p>
        {cleanupResult && <div className="banner ok">{cleanupResult}</div>}
        {!confirmCleanup ? (
          <button
            type="button"
            className="secondary"
            onClick={() => setConfirmCleanup(true)}
          >
            Remove Test Lab data…
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="danger" onClick={cleanup} disabled={busy}>
              Yes, delete Test Lab data
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setConfirmCleanup(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
