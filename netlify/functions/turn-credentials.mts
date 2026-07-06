/** Proxies Metered.ca's TURN credential API server-side, so the API key never reaches the client
 * bundle (a plain client-side fetch to Metered's own API would need the key embedded in the JS,
 * readable by anyone) - see MULTIPLAYER_PLAN.md §2/§7's TURN follow-up. Returns an empty
 * `iceServers` array (not an error) if METERED_API_KEY/METERED_APP_NAME aren't set as Netlify
 * environment variables, so multiplayer still works STUN-only exactly as before until those are
 * configured - this endpoint is additive, never a hard dependency for connecting.
 *
 * Set these in Netlify's dashboard (Site settings -> Environment variables), never in this repo:
 *   METERED_API_KEY  - from https://dashboard.metered.ca (free tier, 20GB/month)
 *   METERED_APP_NAME - the subdomain Metered assigned this account (the "app name" shown in
 *                       their dashboard, used as <app name>.metered.live) */
export default async (): Promise<Response> => {
  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME;

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
