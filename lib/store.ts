import type { CreatorProfile, Donation, WebhookEvent } from "./types";

// ---------------------------------------------------------------------------
// Storage: Vercel KV when configured, otherwise clearly-labelled ephemeral
// in-memory storage. Memory mode NEVER pretends to persist: the app shows a
// warning banner and README documents it. No data is ever lost silently.
// ---------------------------------------------------------------------------

export function storageMode(): "kv" | "memory" {
  return process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? "kv"
    : "memory";
}

export function isKvConfigured(): boolean {
  return storageMode() === "kv";
}

async function kvClient() {
  // Dynamic import so memory mode never touches the KV SDK at all.
  const mod = await import("@vercel/kv");
  return mod.kv;
}

// --- in-memory fallback (per server instance; lost on redeploy/cold start) ---
const mem = {
  creator: null as CreatorProfile | null,
  donations: new Map<number, Donation>(),
  counter: 0,
  webhooks: new Map<string, WebhookEvent>(),
  webhookOrder: [] as string[],
};

const K = {
  creator: "arc-tip-jar:creator",
  counter: "arc-tip-jar:donations:counter",
  donation: (id: number) => `arc-tip-jar:donation:${id}`,
  donationIds: "arc-tip-jar:donationIds",
  webhook: (id: string) => `arc-tip-jar:webhook:${id}`,
  webhookOrder: "arc-tip-jar:webhookOrder",
};

export async function getCreator(): Promise<CreatorProfile | null> {
  if (isKvConfigured()) {
    return (await (await kvClient()).get<CreatorProfile>(K.creator)) ?? null;
  }
  return mem.creator;
}

export async function saveCreator(profile: CreatorProfile): Promise<void> {
  if (isKvConfigured()) {
    await (await kvClient()).set(K.creator, profile);
    return;
  }
  mem.creator = profile;
}

export async function nextDonationId(): Promise<number> {
  if (isKvConfigured()) {
    const kv = await kvClient();
    return await kv.incr(K.counter);
  }
  mem.counter += 1;
  return mem.counter;
}

export async function saveDonation(d: Donation): Promise<void> {
  if (isKvConfigured()) {
    const kv = await kvClient();
    await kv.set(K.donation(d.id), d);
    const ids = (await kv.get<number[]>(K.donationIds)) ?? [];
    if (!ids.includes(d.id)) {
      ids.push(d.id);
      await kv.set(K.donationIds, ids);
    }
    return;
  }
  mem.donations.set(d.id, d);
}

export async function getDonation(id: number): Promise<Donation | null> {
  if (isKvConfigured()) {
    return (await (await kvClient()).get<Donation>(K.donation(id))) ?? null;
  }
  return mem.donations.get(id) ?? null;
}

export async function listDonations(): Promise<Donation[]> {
  if (isKvConfigured()) {
    const kv = await kvClient();
    const ids = (await kv.get<number[]>(K.donationIds)) ?? [];
    const out: Donation[] = [];
    for (const id of ids) {
      const d = await kv.get<Donation>(K.donation(id));
      if (d) out.push(d);
    }
    return out.sort((a, b) => b.id - a.id);
  }
  return [...mem.donations.values()].sort((a, b) => b.id - a.id);
}

export async function findDonationByTransfer(
  transferId: string | null,
  transferSpecHash: string | null,
): Promise<Donation | null> {
  const all = await listDonations();
  for (const d of all) {
    if (transferId && d.transferId === transferId) return d;
    if (
      transferSpecHash &&
      d.transferSpecHash &&
      d.transferSpecHash.toLowerCase() === transferSpecHash.toLowerCase()
    ) {
      return d;
    }
  }
  return null;
}

/** Record a webhook event. Returns "new" or "duplicate" (same notificationId). */
export async function recordWebhookEvent(
  ev: WebhookEvent,
): Promise<"new" | "duplicate"> {
  if (isKvConfigured()) {
    const kv = await kvClient();
    const existing = await kv.get<WebhookEvent>(K.webhook(ev.notificationId));
    if (existing) return "duplicate";
    await kv.set(K.webhook(ev.notificationId), ev);
    const order = (await kv.get<string[]>(K.webhookOrder)) ?? [];
    order.push(ev.notificationId);
    await kv.set(K.webhookOrder, order);
    return "new";
  }
  if (mem.webhooks.has(ev.notificationId)) return "duplicate";
  mem.webhooks.set(ev.notificationId, ev);
  mem.webhookOrder.push(ev.notificationId);
  return "new";
}

export async function hasWebhookEvent(
  notificationId: string,
): Promise<boolean> {
  if (isKvConfigured()) {
    return (await (await kvClient()).get(K.webhook(notificationId))) != null;
  }
  return mem.webhooks.has(notificationId);
}

export async function listWebhookEvents(): Promise<WebhookEvent[]> {
  if (isKvConfigured()) {
    const kv = await kvClient();
    const order = (await kv.get<string[]>(K.webhookOrder)) ?? [];
    const out: WebhookEvent[] = [];
    for (const id of order) {
      const ev = await kv.get<WebhookEvent>(K.webhook(id));
      if (ev) out.push(ev);
    }
    return out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }
  return [...mem.webhooks.values()].sort((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt),
  );
}

/** Delete Test Lab donations + their webhook events. Returns counts. */
export async function deleteTestData(): Promise<{
  removedDonations: number;
  removedEvents: number;
}> {
  const all = await listDonations();
  const testIds = all.filter((d) => d.isTest).map((d) => d.id);
  let removedDonations = 0;
  let removedEvents = 0;
  if (isKvConfigured()) {
    const kv = await kvClient();
    for (const id of testIds) {
      await kv.del(K.donation(id));
      removedDonations++;
    }
    const ids = (await kv.get<number[]>(K.donationIds)) ?? [];
    await kv.set(
      K.donationIds,
      ids.filter((id) => !testIds.includes(id)),
    );
    const events = await listWebhookEvents();
    const testTransferIds = new Set(
      all.filter((d) => d.isTest).map((d) => d.transferId),
    );
    const order = (await kv.get<string[]>(K.webhookOrder)) ?? [];
    const keep: string[] = [];
    for (const nid of order) {
      const ev = await kv.get<WebhookEvent>(K.webhook(nid));
      if (
        ev &&
        ev.transferId &&
        testTransferIds.has(ev.transferId)
      ) {
        await kv.del(K.webhook(nid));
        removedEvents++;
      } else if (ev) {
        keep.push(nid);
      }
    }
    await kv.set(K.webhookOrder, keep);
    return { removedDonations, removedEvents };
  }
  for (const id of testIds) {
    if (mem.donations.delete(id)) removedDonations++;
  }
  const testTransferIds = new Set(
    all.filter((d) => d.isTest).map((d) => d.transferId),
  );
  for (const [nid, ev] of [...mem.webhooks.entries()]) {
    if (ev.transferId && testTransferIds.has(ev.transferId)) {
      mem.webhooks.delete(nid);
      removedEvents++;
    }
  }
  mem.webhookOrder = mem.webhookOrder.filter((nid) => mem.webhooks.has(nid));
  return { removedDonations, removedEvents };
}
