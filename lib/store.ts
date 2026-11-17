import type { CreatorProfile, Donation, WebhookEvent } from "./types";

// ---------------------------------------------------------------------------
// Storage: Upstash Redis when configured, otherwise clearly-labelled ephemeral
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
  // Dynamic import so memory mode never touches the Redis SDK at all.
  const { Redis } = await import("@upstash/redis");
  return new Redis({
    url: process.env.KV_REST_API_URL as string,
    token: process.env.KV_REST_API_TOKEN as string,
  });
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
    // One round trip for the write + the id list (each call is a network hop).
    const [, current] = await kv
      .pipeline()
      .set(K.donation(d.id), d)
      .get(K.donationIds)
      .exec<[unknown, number[] | null]>();
    const ids = current ?? [];
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
    if (ids.length === 0) return [];
    // Single batched read instead of one request per donation.
    const rows = await kv.mget<(Donation | null)[]>(
      ...ids.map((id) => K.donation(id)),
    );
    const out = rows.filter((d): d is Donation => d != null);
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
    // SET NX: atomic duplicate check + write in one round trip.
    const written = await kv.set(K.webhook(ev.notificationId), ev, { nx: true });
    if (written === null) return "duplicate";
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
    if (order.length === 0) return [];
    const rows = await kv.mget<(WebhookEvent | null)[]>(
      ...order.map((id) => K.webhook(id)),
    );
    const out = rows.filter((ev): ev is WebhookEvent => ev != null);
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
    if (testIds.length > 0) {
      await kv.del(...testIds.map((id) => K.donation(id)));
      removedDonations = testIds.length;
    }
    const ids = (await kv.get<number[]>(K.donationIds)) ?? [];
    await kv.set(
      K.donationIds,
      ids.filter((id) => !testIds.includes(id)),
    );
    const testTransferIds = new Set(
      all.filter((d) => d.isTest).map((d) => d.transferId),
    );
    const order = (await kv.get<string[]>(K.webhookOrder)) ?? [];
    const keep: string[] = [];
    const drop: string[] = [];
    if (order.length > 0) {
      const rows = await kv.mget<(WebhookEvent | null)[]>(
        ...order.map((nid) => K.webhook(nid)),
      );
      order.forEach((nid, i) => {
        const ev = rows[i];
        if (ev && ev.transferId && testTransferIds.has(ev.transferId)) {
          drop.push(nid);
        } else if (ev) {
          keep.push(nid);
        }
      });
    }
    if (drop.length > 0) {
      await kv.del(...drop.map((nid) => K.webhook(nid)));
      removedEvents = drop.length;
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
