/**
 * app/api/feature-flags/route.ts
 *
 * Returns the CURRENT user's evaluated feature flags as a flat
 * { [key]: boolean } map — never the raw rollout_percentage/override
 * config, which is admin-only (see app/api/admin/feature-flags/route.ts).
 * This route is what components/FeatureFlagsProvider.tsx calls once on
 * mount to hydrate the client-side flag context.
 *
 * Deliberately allows unauthenticated requests (evaluated as an
 * anonymous user — see lib/featureFlags.ts's "anonymous users can't be
 * consistently bucketed" note) rather than 401ing, since some flags
 * (e.g. an experimental logged-out landing page) may need to be
 * evaluable before login.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getEvaluatedFlags } from "@/lib/featureFlags";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.feature-flags");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  try {
    const flags = await getEvaluatedFlags(user?.id ?? null);
    return NextResponse.json(
      { flags },
      // Short private cache — flags can change (admin toggles a kill
      // switch) and this response is per-user (overrides), so this must
      // never be cached by a shared/CDN cache, only briefly by the
      // requesting browser to avoid a request on every navigation.
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (err) {
    // Matches lib/analytics.ts's philosophy: flag evaluation must never
    // break the page that asked for it. Fail closed (everything false)
    // rather than 500ing.
    log.error("Feature flag evaluation failed", {
      user_id: user?.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ flags: {} }, { status: 200 });
  }
}