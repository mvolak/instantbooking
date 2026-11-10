/**
 * Conversational agent configuration, read from the server environment only.
 * Nothing here is ever sent to the browser.
 */

/** Economical, tool-capable default model, addressed through Vercel AI Gateway. */
export const DEFAULT_BOOKING_MODEL = "anthropic/claude-haiku-5.5";

/** Studio timezone used to interpret "today", "Thursday", "afternoon"… */
export const STUDIO_TIMEZONE = "Europe/Prague";

/** How far ahead the agent may search (days, including today). */
export const SEARCH_HORIZON_DAYS = 31;

export type ChatConfig = {
  /** AI Gateway model id, e.g. `anthropic/claude-haiku-5.5`. */
  model: string;
  /**
   * Server secret (≥ 32 chars) used to sign tool approvals, derive idempotency
   * keys and seal booking credentials. Must be identical on every instance.
   */
  signingSecret: string;
};

export type ChatConfigResult = { ok: true; config: ChatConfig } | { ok: false; missing: string[] };

/**
 * Reads the agent configuration. Missing configuration disables only the chat;
 * the rest of the site keeps working.
 */
export function readChatConfig(env: Record<string, string | undefined> = process.env): ChatConfigResult {
  const missing: string[] = [];
  // On Vercel the gateway can authenticate with the deployment's OIDC token instead of a key.
  if (!env.AI_GATEWAY_API_KEY && !env.VERCEL_OIDC_TOKEN) missing.push("AI_GATEWAY_API_KEY");
  const signingSecret = env.CHAT_SIGNING_SECRET ?? "";
  if (signingSecret.length < 32) missing.push("CHAT_SIGNING_SECRET");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: { model: env.BOOKING_AI_MODEL?.trim() || DEFAULT_BOOKING_MODEL, signingSecret },
  };
}
