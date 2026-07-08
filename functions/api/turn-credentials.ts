/** Cloudflare Pages Function port of netlify/functions/turn-credentials.mts - same behavior, ported
 * because Cloudflare Pages Functions don't run on Node (no `process.env`; env vars come from the
 * `context.env` object) and use a different export convention (`onRequestGet` instead of a default
 * export). Proxies Metered.ca's TURN credential API server-side, so the API key never reaches the
 * client bundle. Returns an empty `iceServers` array (not an error) if METERED_API_KEY/
 * METERED_APP_NAME aren't set, so multiplayer still works STUN-only exactly as before until those
 * are configured - this endpoint is additive, never a hard dependency for connecting.
 *
 * Set these in the Cloudflare Pages dashboard (Settings -> Environment variables), never in this
 * repo:
 *   METERED_API_KEY  - from https://dashboard.metered.ca (free tier, 20GB/month)
 *   METERED_APP_NAME - the subdomain Metered assigned this account (the "app name" shown in
 *                       their dashboard, used as <app name>.metered.live) */

interface Env {
  METERED_API_KEY?: string;
  METERED_APP_NAME?: string;
}

export const onRequestGet = async (context: { env: Env }): Promise<Response> => {
  const apiKey = context.env.METERED_API_KEY;
  const appName = context.env.METERED_APP_NAME;

  if (!apiKey || !appName) {
    return Response.json({ iceServers: [] });
  }

  try {
    const response = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`);
    if (!response.ok) return Response.json({ iceServers: [] });
    const iceServers = await response.json();
    return Response.json({ iceServers });
  } catch {
    // Metered's own API being unreachable must not break multiplayer - falls back to STUN-only,
    // same as if this function were never configured at all.
    return Response.json({ iceServers: [] });
  }
};
