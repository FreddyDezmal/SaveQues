import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Returns the current user's notification_logs rows for the in-app
 * Notification Center / full inbox (Sprint 15 Phase 4, extended Sprint
 * 27 Phase 2 with archive/delete/deep_link).
 *
 * Query params:
 *   limit     — default 30, max 50 (unchanged from Sprint 15)
 *   archived  — "true" to return ONLY archived notifications (the
 *               Archived tab), omitted/"false" to return the normal
 *               inbox (archived rows excluded). Deleted rows are ALWAYS
 *               excluded regardless of this param — there's no "view
 *               deleted" UI; that's what soft-delete's audit trail is
 *               for, not a user-facing view.
 *   category  — one of lib/notificationTaxonomy.ts's NotificationCategory
 *               values, filters client-visible rows to that category.
 *               Validated against the real category list, not passed
 *               through unchecked into the query (category isn't a
 *               stored column — filtering happens after fetch, see below).
 *
 * Reuses the existing RLS-scoped user client (not the service client) —
 * the existing "notification_logs_read_own" SELECT policy already
 * covers every column added this sprint, unchanged.
 */

const VALID_CATEGORIES = ["social", "goals", "quests", "achievements", "groups", "partners", "system"];

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 30, 1), 50);
    const archivedOnly = req.nextUrl.searchParams.get("archived") === "true";
    const categoryParam = req.nextUrl.searchParams.get("category");
    const category = categoryParam && VALID_CATEGORIES.includes(categoryParam) ? categoryParam : null;

    let query = supabase
      .from("notification_logs")
      .select("id, notification_type, title, body, sent_at, clicked_at, read_at, deep_link, archived_at")
      .eq("user_id", user.id)
      .is("deleted_at", null) // soft-deleted rows never appear in any inbox view
      .order("sent_at", { ascending: false })
      .limit(limit);

    query = archivedOnly ? query.not("archived_at", "is", null) : query.is("archived_at", null);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Category filtering happens here, not in the query — category is
    // DERIVED from notification_type (lib/notificationTaxonomy.ts), not a
    // stored column, so it can't be a .eq() filter. This route's `limit`
    // is applied BEFORE this filter, meaning a category filter can
    // legitimately return fewer than `limit` rows even when more exist —
    // acceptable for the inbox's "recent N, optionally narrowed" UX, but
    // worth stating plainly rather than leaving it to look like a bug.
    let notifications = data ?? [];
    if (category) {
      const { getNotificationTaxonomy } = await import("@/lib/notificationTaxonomy");
      notifications = notifications.filter(
        (n: { notification_type: string }) => getNotificationTaxonomy(n.notification_type as any).category === category
      );
    }

    // Unread count always reflects the real inbox (non-archived,
    // non-deleted), regardless of the archived/category params on THIS
    // request — the bell badge shouldn't change just because the user is
    // currently viewing the Archived tab or a category filter.
    const { count: unreadCount } = await supabase
      .from("notification_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .is("archived_at", null)
      .is("read_at", null);

    return NextResponse.json({ notifications, unreadCount: unreadCount ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}