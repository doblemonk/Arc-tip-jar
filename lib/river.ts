import savedCopy from "./river-copy.json";

// ---------------------------------------------------------------------------
// River inference — OpenAI-compatible chat completions.
// Endpoint: POST https://api.river.ai/v1/chat/completions
// Auth: Bearer RIVER_API_KEY (server-side only, never sent to the browser).
// Default model: deepseek-ai/DeepSeek-V4.1-Flash (verified live).
// Do NOT default to Qwen/Qwen3.5-9B on this endpoint: it spends its whole
// token budget on reasoning_content and returns empty content (verified
// twice, even at max_tokens 2500). RIVER_MODEL env var can change the model.
// River usage bills the account owner's River account.
// ---------------------------------------------------------------------------

export const RIVER_API_URL = "https://api.river.ai/v1/chat/completions";
export const DEFAULT_RIVER_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

export function riverModel(): string {
  return process.env.RIVER_MODEL || DEFAULT_RIVER_MODEL;
}

export function isRiverConfigured(): boolean {
  return Boolean(process.env.RIVER_API_KEY);
}

export type AiSource = "river-live" | "river-saved-default";

export interface AiTextResult {
  text: string;
  source: AiSource;
  model: string;
  /** Human-readable note about where the text came from. */
  note: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function riverChat(
  messages: ChatMessage[],
): Promise<{ content: string; model: string }> {
  const apiKey = process.env.RIVER_API_KEY;
  if (!apiKey) throw new Error("RIVER_API_KEY is not configured");
  const model = riverModel();
  const res = await fetch(RIVER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 800,
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error?.message ||
        body?.message ||
        `River request failed: HTTP ${res.status}`,
    );
  }
  const content: string | undefined =
    body?.choices?.[0]?.message?.content?.trim();
  // Some models return their whole budget as reasoning_content and leave
  // `content` empty. That is a failed generation for our purposes — the
  // caller falls back to a saved default instead of showing nothing.
  if (!content) {
    throw new Error(
      "River returned an empty message (no content in the response)",
    );
  }
  return { content, model: body?.model ?? model };
}

function fillPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

function pickSavedThankYou(amount: string, creatorName: string): string {
  const variants: string[] = savedCopy.copy.thank_you_variants;
  const idx = Math.floor(Math.random() * variants.length);
  return fillPlaceholders(variants[idx], {
    amount,
    creator: creatorName,
  });
}

export const SAVED_SUBTITLES: string[] =
  savedCopy.copy.tip_page_subtitles;
export const SAVED_DASHBOARD_EMPTY_STATE: string =
  savedCopy.copy.dashboard_empty_state;
export const SAVED_COPY_MODEL: string = savedCopy.model;

/**
 * Generate a polished thank-you message for a received tip.
 * Live River call when RIVER_API_KEY is set; otherwise a saved variant
 * that River itself generated earlier — clearly labelled, never presented
 * as a live call.
 */
export async function generateThankYou(args: {
  amount: string;
  creatorName: string;
  donorMessage?: string;
}): Promise<AiTextResult> {
  const model = riverModel();
  if (isRiverConfigured()) {
    try {
      const { content } = await riverChat([
        {
          role: "system",
          content:
            "You write short, warm thank-you messages for a creator tip jar. " +
            "One or two sentences, plain English, no hashtags, no emojis, " +
            "no made-up facts. Mention the amount and the creator by name.",
        },
        {
          role: "user",
          content:
            `Write a thank-you message for a ${args.amount} tip to creator ` +
            `"${args.creatorName}"` +
            (args.donorMessage
              ? ` (donor wrote: "${args.donorMessage}")`
              : "") +
            `.`,
        },
      ]);
      return {
        text: content,
        source: "river-live",
        model,
        note: `Generated live by River (${model}).`,
      };
    } catch (err) {
      // Live call failed — fall through to the saved default and say so.
      console.warn("River thank-you call failed, using saved default:", err);
    }
  }
  return {
    text: pickSavedThankYou(args.amount, args.creatorName),
    source: "river-saved-default",
    model: SAVED_COPY_MODEL,
    note: isRiverConfigured()
      ? "Live River call failed, showing a saved default written by River."
      : "Live River AI is not configured (set RIVER_API_KEY in Vercel); showing a saved default written by River.",
  };
}

/**
 * Polish a creator's own text (bio/description or thank-you message).
 * Same route, same fallback rules as generateThankYou.
 */
export async function polishText(args: {
  text: string;
  kind: "bio" | "thank-you";
  creatorName?: string;
}): Promise<AiTextResult> {
  const model = riverModel();
  const kindLabel =
    args.kind === "bio" ? "creator bio/description" : "thank-you message";
  if (isRiverConfigured()) {
    try {
      const { content } = await riverChat([
        {
          role: "system",
          content:
            "You polish short creator-facing copy. Keep the author's meaning " +
            "and voice, fix grammar and flow, keep it the same length or " +
            "shorter. Plain English, no hashtags, no emojis, no new claims " +
            "about the creator. Reply with ONLY the polished text.",
        },
        {
          role: "user",
          content:
            `Polish this ${kindLabel}` +
            (args.creatorName ? ` for creator "${args.creatorName}"` : "") +
            `:\n\n${args.text}`,
        },
      ]);
      return {
        text: content,
        source: "river-live",
        model,
        note: `Polished live by River (${model}).`,
      };
    } catch (err) {
      console.warn("River polish call failed, using original text:", err);
    }
  }
  return {
    text: args.text,
    source: "river-saved-default",
    model: SAVED_COPY_MODEL,
    note: isRiverConfigured()
      ? "Live River call failed, so the original text is returned unchanged."
      : "Live River AI is not configured (set RIVER_API_KEY in Vercel); the original text is returned unchanged.",
  };
}
