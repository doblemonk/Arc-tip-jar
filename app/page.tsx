"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TipFlow from "./components/TipFlow";

interface Info {
  creatorConfigured: boolean;
  creatorName: string | null;
  subtitles: string[];
  storage: string;
  realTransferEnabled: boolean;
}

interface Creator {
  name: string;
  description: string;
  avatarUrl: string;
  thankYouMessage: string;
  recipientAddress: string;
}

export default function Home() {
  const [info, setInfo] = useState<Info | null>(null);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/info").then((r) => r.json()),
      fetch("/api/creator").then((r) => r.json()),
    ])
      .then(([infoBody, creatorBody]) => {
        if (infoBody.error) throw new Error(infoBody.error);
        setInfo(infoBody);
        setCreator(creatorBody.creator);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) {
    return (
      <div className="banner err">
        Could not load the tip jar: {error}
      </div>
    );
  }
  if (!info) return <p className="muted">Loading…</p>;

  if (!creator) {
    return (
      <div className="card">
        <h1>Arc Tip Jar</h1>
        <p>{info.subtitles?.[0] ?? "Send USDC on Arc. Support work you love."}</p>
        <p>
          No creator profile has been set up yet. If this is your tip jar,
          set it up first:
        </p>
        <Link href="/creator">
          <button type="button">Set up creator profile</button>
        </Link>
      </div>
    );
  }

  return (
    <TipFlow
      creator={creator}
      subtitle={info.subtitles?.[0] ?? "Send USDC on Arc. Support work you love."}
      realTransferEnabled={info.realTransferEnabled}
      storageMode={info.storage}
    />
  );
}
