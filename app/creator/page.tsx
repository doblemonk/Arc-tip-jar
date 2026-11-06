"use client";

import { useState } from "react";
import Link from "next/link";

export default function CreatorSetup() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState<"bio" | "thank-you" | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const polish = async (kind: "bio" | "thank-you") => {
    const text = kind === "bio" ? description : thankYouMessage;
    if (!text.trim()) {
      setAiNote("Write something first, then polish it.");
      return;
    }
    setPolishing(kind);
    setAiNote(null);
    setError(null);
    try {
      const res = await fetch("/api/ai/thank-you", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "polish",
          text,
          kind,
          creatorName: name || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Polish failed");
      if (kind === "bio") setDescription(body.text);
      else setThankYouMessage(body.text);
      setAiNote(`${body.note} (source: ${body.source})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPolishing(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          avatarUrl,
          thankYouMessage,
          recipientAddress,
          pin,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save profile");
      setSaved(
        `Profile saved for ${body.creator.name}. ${body.note ?? ""} Your tip page is live at the home page.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h1>Creator setup</h1>
      <p className="muted">
        This is the only place the recipient address is set — every tip goes
        to this Arc Testnet address. The dashboard PIN unlocks the creator
        dashboard; if DASHBOARD_PIN is set in the environment, that PIN wins
        and this field is ignored.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="name">Name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />

        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What do you make, and why should people support it?"
        />
        <button
          type="button"
          className="secondary"
          onClick={() => polish("bio")}
          disabled={polishing !== null}
          style={{ marginTop: 8 }}
        >
          {polishing === "bio" ? "Polishing…" : "Polish my bio (River AI)"}
        </button>

        <label htmlFor="avatarUrl">Avatar URL (optional)</label>
        <input
          id="avatarUrl"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://…"
        />

        <label htmlFor="thankYouMessage">Thank-you message</label>
        <textarea
          id="thankYouMessage"
          value={thankYouMessage}
          onChange={(e) => setThankYouMessage(e.target.value)}
          placeholder="Shown to donors after a tip is received."
        />
        <button
          type="button"
          className="secondary"
          onClick={() => polish("thank-you")}
          disabled={polishing !== null}
          style={{ marginTop: 8 }}
        >
          {polishing === "thank-you" ? "Polishing…" : "Polish my thank-you message (River AI)"}
        </button>
        {aiNote && <p className="small muted">{aiNote}</p>}

        <label htmlFor="recipient">Recipient address (Arc Testnet)</label>
        <input
          id="recipient"
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
          placeholder="0x…"
          required
        />
        <p className="small muted">
          Your Arc Testnet wallet address. Tips are minted to this address
          on Gateway domain 26.
        </p>

        <label htmlFor="pin">Dashboard PIN</label>
        <input
          id="pin"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Choose a PIN (stored hashed)"
          autoComplete="new-password"
        />

        {error && <p className="small" style={{ color: "var(--err)" }}>{error}</p>}
        {saved && <div className="banner ok">{saved}</div>}

        <button type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? "Saving…" : "Save creator profile"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link href="/">← Back to the tip page</Link>
      </p>
    </div>
  );
}
