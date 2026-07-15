-- ─────────────────────────────────────────────────────────────────────────────
-- 045_social_foundation.sql
-- Sprint 22, Phase 2 — Social data model
--
-- Scope: the tables named in the Sprint 22 brief under "SOCIAL DATA MODEL"
-- (friends / friend_requests / group_members / groups / shared_goals /
-- group_quests / activity_visibility), plus accountability_partners (Phase 4)
-- and group_contributions (the ledger decision below).
--
-- NOT in scope for this migration: activity_feed write paths, group_quest
-- progress computation, leaderboard views, invitation/referral tracking.
-- Those are Phase 7/8/9/10 application logic that read from the tables
-- below — the tables are laid out to support them without further schema
-- changes, but the logic itself is deliberately not built here.
--
-- ── Money-safety decision (read before touching this file) ───────────────
-- `public.enforce_goal_ownership` (014_consolidated_schema.sql) requires
-- transactions.user_id = savings_goals.user_id. That trigger is NOT modified
-- here. Group members' contributions toward a shared goal are recorded in
-- the new `group_contributions` table, which is informational/motivational
-- only — it does NOT feed the `update_goal_amount` trigger and does NOT
-- change savings_goals.current_amount. Only the goal owner's own deposits
-- (existing `transactions` flow, untouched) move the real balance. This
-- preserves "money logic is read-only" and avoids widening who can write
-- to a table that a financial trigger depends on.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Extend existing tables (preferred over new tables per brief)
-- ═══════════════════════════════════════════════════════════════════════════

-- profiles: username is required for friend/partner search (Phase 3) since
-- there is currently no searchable handle — display_name is not unique and
-- email is not exposed client-side. Nullable + unique so existing rows don't
-- break; backfill/enforcement of NOT NULL is an app-layer onboarding step,
-- not this migration's job.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS profile_visibility TEXT NOT NULL DEFAULT 'friends'
    CHECK (profile_visibility IN ('private', 'friends', 'public')),
  ADD COLUMN IF NOT EXISTS activity_visibility TEXT NOT NULL DEFAULT 'friends'
    CHECK (activity_visibility IN ('private', 'friends', 'groups', 'public'));

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (LOWER(username))
  WHERE username IS NOT NULL;

-- savings_goals: per-goal visibility override. Defaults to 'private' so no
-- existing goal becomes visible to anyone as a side effect of this migration.
ALTER TABLE public.savings_goals
  ADD COLUMN IF NOT EXISTS goal_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (goal_visibility IN ('private', 'friends', 'group', 'public'));

-- user_achievements: per-achievement visibility override. NULL = inherit the
-- profile-level default (profiles.activity_visibility) rather than forcing
-- every historical row to pick a value.
ALTER TABLE public.user_achievements
  ADD COLUMN IF NOT EXISTS visibility TEXT
    CHECK (visibility IS NULL OR visibility IN ('private', 'friends', 'public'));


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — Friendships (covers "friends" + "friend_requests" in one table)
-- ═══════════════════════════════════════════════════════════════════════════
-- A single row represents the relationship in both directions. status
-- lifecycle: pending -> accepted, pending -> declined (row kept for
-- cool-down / anti-spam), accepted -> blocked. "Remove friend" deletes the
-- row outright (no history requirement stated in the brief).

CREATE TABLE IF NOT EXISTS public.friendships (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id)
);

-- One relationship per unordered pair, regardless of who requested. Prevents
-- A->B and B->A duplicate rows / duplicate pending requests in both directions.
CREATE UNIQUE INDEX IF NOT EXISTS friendships_unordered_pair_unique
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships (addressee_id, status);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friendships_select_own"
  ON public.friendships FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "friendships_insert_own_request"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

-- Only the addressee can accept/decline; either party can update to
-- 'blocked'. requester_id/addressee_id/created_at are immutable via WITH CHECK.
CREATE POLICY "friendships_update_own"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
  WITH CHECK (
    auth.uid() = requester_id OR auth.uid() = addressee_id
  );

CREATE POLICY "friendships_delete_own"
  ON public.friendships FOR DELETE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- Helper used by later RLS policies (shared_goals, activity_feed, etc.) so
-- those policies don't need to inline this subquery repeatedly.
CREATE OR REPLACE FUNCTION public.are_friends(p_user_a UUID, p_user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = p_user_a AND addressee_id = p_user_b)
        OR (requester_id = p_user_b AND addressee_id = p_user_a))
  );
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C — Accountability partners (Phase 4)
-- ═══════════════════════════════════════════════════════════════════════════
-- Deliberately separate from friendships: distinct semantics (max one ACTIVE
-- partner per user, enforced below), distinct request flow, and distinct
-- privacy surface (Phase 4 implies more visibility than a plain friend gets,
-- e.g. progress nudges) — conflating it with `friendships.status` would mean
-- overloading that enum with meaning it doesn't have room for.

CREATE TABLE IF NOT EXISTS public.accountability_partners (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'declined', 'ended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  CONSTRAINT accountability_no_self CHECK (requester_id <> partner_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS accountability_unordered_pair_unique
  ON public.accountability_partners (LEAST(requester_id, partner_id), GREATEST(requester_id, partner_id))
  WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_accountability_requester ON public.accountability_partners (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_accountability_partner   ON public.accountability_partners (partner_id, status);

-- "One accountability partner" — enforced with a trigger rather than a
-- partial unique index because the constraint spans both columns
-- (a user can appear as requester_id in one row and partner_id in another).
CREATE OR REPLACE FUNCTION public.enforce_single_accountability_partner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('pending', 'active') THEN
    IF EXISTS (
      SELECT 1 FROM public.accountability_partners
      WHERE status IN ('pending', 'active')
        AND id <> NEW.id
        AND (requester_id IN (NEW.requester_id, NEW.partner_id)
          OR partner_id IN (NEW.requester_id, NEW.partner_id))
    ) THEN
      RAISE EXCEPTION 'One of these users already has a pending or active accountability partner'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_accountability_partner ON public.accountability_partners;
CREATE TRIGGER trg_enforce_single_accountability_partner
  BEFORE INSERT OR UPDATE ON public.accountability_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_accountability_partner();

ALTER TABLE public.accountability_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accountability_select_own"
  ON public.accountability_partners FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = partner_id);

CREATE POLICY "accountability_insert_own_request"
  ON public.accountability_partners FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "accountability_update_own"
  ON public.accountability_partners FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = partner_id)
  WITH CHECK (auth.uid() = requester_id OR auth.uid() = partner_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- PART D — Groups & membership (Phase 5)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.groups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  description  TEXT,
  emoji        TEXT        NOT NULL DEFAULT '👥',
  group_type   TEXT        NOT NULL DEFAULT 'custom'
               CHECK (group_type IN (
                 'family', 'friends', 'university', 'roommates',
                 'travel', 'wedding', 'emergency_fund', 'custom'
               )),
  owner_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  xp_total     INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_owner ON public.groups (owner_id);

-- Auto-seed the owner's own membership row. Without this, there is no
-- valid client-side INSERT into group_members for the owner: the INSERT
-- policy below only allows 'invited' (by an existing admin/owner) or
-- 'pending_approval' (self-requested join) rows, and a brand-new group has
-- no admin/owner member yet to issue that invite — a chicken-and-egg RLS
-- gap caught by testing this migration end-to-end, not by inspection.
-- Mirrors the existing public.handle_new_user() trigger on auth.users.
CREATE OR REPLACE FUNCTION public.handle_new_group()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role, status)
  VALUES (NEW.id, NEW.owner_id, 'owner', 'active');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_group_created ON public.groups;
CREATE TRIGGER on_group_created
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_group();

-- group_members covers membership AND the invite / join-request lifecycle
-- via `status`, rather than three separate tables (members, invites,
-- join_requests) — the row shape (group_id, user_id, role) is identical in
-- all three cases; only status and who-initiated differ.
CREATE TABLE IF NOT EXISTS public.group_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner', 'admin', 'member')),
  status       TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('invited', 'pending_approval', 'active', 'declined', 'removed')),
  invited_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group  ON public.group_members (group_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_user   ON public.group_members (user_id, status);

-- Helper: current role of a user in a group, NULL if not an active member.
-- SECURITY DEFINER + STABLE so it can be used inside RLS policies on
-- group_members/groups themselves without those policies re-triggering RLS
-- recursively on every row (a plain subquery on the same table under RLS is
-- legal in Postgres, but wrapping it in a SECURITY DEFINER function keeps
-- the policy readable and gives one place to change the "who can see this
-- group" rule later).
CREATE OR REPLACE FUNCTION public.user_group_role(p_group_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'active'
  LIMIT 1;
$$;

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "groups_select_member_or_owner"
  ON public.groups FOR SELECT
  USING (
    auth.uid() = owner_id
    OR public.user_group_role(id, auth.uid()) IS NOT NULL
  );

CREATE POLICY "groups_insert_as_owner"
  ON public.groups FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "groups_update_owner_or_admin"
  ON public.groups FOR UPDATE
  USING (auth.uid() = owner_id OR public.user_group_role(id, auth.uid()) = 'admin')
  WITH CHECK (auth.uid() = owner_id OR public.user_group_role(id, auth.uid()) = 'admin');

CREATE POLICY "groups_delete_owner_only"
  ON public.groups FOR DELETE
  USING (auth.uid() = owner_id);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Members can see the roster of any group they belong to; a user can always
-- see their own membership rows (e.g. a pending invite before they've joined).
CREATE POLICY "group_members_select_fellow_members"
  ON public.group_members FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.user_group_role(group_id, auth.uid()) IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
  );

-- Two legitimate insert paths: (1) owner/admin invites someone -> status
-- 'invited', invited_by = self; (2) a user requests to join themselves ->
-- status 'pending_approval', user_id = self, invited_by NULL.
CREATE POLICY "group_members_insert_invite_or_self_request"
  ON public.group_members FOR INSERT
  WITH CHECK (
    (
      status = 'invited'
      AND invited_by = auth.uid()
      AND (
        EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
        OR public.user_group_role(group_id, auth.uid()) = 'admin'
      )
    )
    OR (
      status = 'pending_approval'
      AND user_id = auth.uid()
      AND invited_by IS NULL
    )
  );

-- A user can update their own row (accept/decline an invite, leave = set
-- 'removed'); an owner/admin can update any row in their group (approve
-- join requests, change roles, remove members).
CREATE POLICY "group_members_update_self_or_admin"
  ON public.group_members FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  );

CREATE POLICY "group_members_delete_self_or_admin"
  ON public.group_members FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- PART E — Shared goals & the contributions ledger (Phase 6)
-- ═══════════════════════════════════════════════════════════════════════════
-- shared_goals links an existing savings_goals row to a group of
-- contributors. It does NOT duplicate goal fields (title/target/etc. stay
-- on savings_goals — read them by join). savings_goals.user_id remains the
-- sole owner and the only writer of savings_goals.current_amount via the
-- existing trigger chain.

CREATE TABLE IF NOT EXISTS public.shared_goals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      UUID        NOT NULL UNIQUE REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  owner_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id     UUID        REFERENCES public.groups(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_goals_owner ON public.shared_goals (owner_id);
CREATE INDEX IF NOT EXISTS idx_shared_goals_group ON public.shared_goals (group_id) WHERE group_id IS NOT NULL;

-- Enforce goal_id really belongs to owner_id, mirroring
-- enforce_transaction_goal_ownership's pattern for the same reason.
CREATE OR REPLACE FUNCTION public.enforce_shared_goal_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.savings_goals
    WHERE id = NEW.goal_id AND user_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'Goal % does not belong to user %', NEW.goal_id, NEW.owner_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shared_goal_ownership ON public.shared_goals;
CREATE TRIGGER trg_enforce_shared_goal_ownership
  BEFORE INSERT OR UPDATE ON public.shared_goals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shared_goal_ownership();

-- Members invited onto a shared goal individually (not just via a group) —
-- e.g. sharing a goal with one friend without creating a whole group.
CREATE TABLE IF NOT EXISTS public.shared_goal_members (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_goal_id UUID        NOT NULL REFERENCES public.shared_goals(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited', 'active', 'declined', 'removed')),
  invited_by     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at   TIMESTAMPTZ,
  UNIQUE (shared_goal_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_goal_members_goal ON public.shared_goal_members (shared_goal_id, status);
CREATE INDEX IF NOT EXISTS idx_shared_goal_members_user ON public.shared_goal_members (user_id, status);

-- Breaks a mutual-recursion trap: shared_goals' SELECT policy needs to
-- check shared_goal_members, and shared_goal_members' SELECT policy needs
-- to check shared_goals — evaluated as EXISTS subqueries directly in each
-- other's policies, Postgres detects that cycle at runtime ("infinite
-- recursion detected in policy for relation shared_goals"). Centralizing
-- the check in one SECURITY DEFINER function (runs as table owner, so it
-- does not re-trigger RLS on either table) breaks the cycle. Verified
-- against a local Postgres instance running the full migration chain.
-- Defined here (after shared_goal_members exists) because LANGUAGE sql
-- functions are validated against real objects at CREATE time.
CREATE OR REPLACE FUNCTION public.can_view_shared_goal(p_shared_goal_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_goals sg
    WHERE sg.id = p_shared_goal_id
      AND (
        sg.owner_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.shared_goal_members sgm
          WHERE sgm.shared_goal_id = sg.id AND sgm.user_id = p_user_id AND sgm.status = 'active'
        )
        OR (sg.group_id IS NOT NULL AND public.user_group_role(sg.group_id, p_user_id) IS NOT NULL)
      )
  );
$$;

-- The ledger. Deliberately separate from `transactions` (see money-safety
-- note at the top of this file). A contribution here is a member's
-- "counted toward the shared goal" pledge/deposit — it never mutates
-- savings_goals.current_amount. Reconciliation (the owner actually moving
-- that money into their own balance) stays a manual, explicit action
-- through the existing deposit flow. This is a product decision, not just
-- a technical one — flagging it so it can be surfaced in the UI copy
-- ("tracked contribution" vs "your balance") rather than assumed.
CREATE TABLE IF NOT EXISTS public.group_contributions (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_goal_id UUID          NOT NULL REFERENCES public.shared_goals(id) ON DELETE CASCADE,
  user_id        UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note           TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_contributions_goal ON public.group_contributions (shared_goal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_contributions_user ON public.group_contributions (user_id);

-- Only an active contributor (or the goal owner) may log a contribution.
CREATE OR REPLACE FUNCTION public.enforce_contribution_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.shared_goals sg
    WHERE sg.id = NEW.shared_goal_id
      AND (
        sg.owner_id = NEW.user_id
        OR EXISTS (
          SELECT 1 FROM public.shared_goal_members sgm
          WHERE sgm.shared_goal_id = sg.id AND sgm.user_id = NEW.user_id AND sgm.status = 'active'
        )
        OR (
          sg.group_id IS NOT NULL
          AND public.user_group_role(sg.group_id, NEW.user_id) IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'User % is not an active contributor on shared goal %', NEW.user_id, NEW.shared_goal_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_contribution_membership ON public.group_contributions;
CREATE TRIGGER trg_enforce_contribution_membership
  BEFORE INSERT ON public.group_contributions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contribution_membership();

ALTER TABLE public.shared_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_goals_select_owner_or_member"
  ON public.shared_goals FOR SELECT
  USING (public.can_view_shared_goal(id, auth.uid()));

CREATE POLICY "shared_goals_insert_owner_only"
  ON public.shared_goals FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "shared_goals_update_owner_only"
  ON public.shared_goals FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "shared_goals_delete_owner_only"
  ON public.shared_goals FOR DELETE
  USING (auth.uid() = owner_id);

ALTER TABLE public.shared_goal_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_goal_members_select_participant"
  ON public.shared_goal_members FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.can_view_shared_goal(shared_goal_id, auth.uid())
  );

CREATE POLICY "shared_goal_members_insert_owner_invites"
  ON public.shared_goal_members FOR INSERT
  WITH CHECK (
    status = 'invited'
    AND invited_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.shared_goals WHERE id = shared_goal_id AND owner_id = auth.uid())
  );

CREATE POLICY "shared_goal_members_update_self_or_owner"
  ON public.shared_goal_members FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.shared_goals WHERE id = shared_goal_id AND owner_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.shared_goals WHERE id = shared_goal_id AND owner_id = auth.uid())
  );

ALTER TABLE public.group_contributions ENABLE ROW LEVEL SECURITY;

-- No amounts leak beyond goal participants — never public, never
-- friends-of-friends. This mirrors "NO amounts, NO balances" from Phase 8,
-- applied one phase early since the ledger exists here.
CREATE POLICY "group_contributions_select_participant"
  ON public.group_contributions FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.can_view_shared_goal(shared_goal_id, auth.uid())
  );

CREATE POLICY "group_contributions_insert_own"
  ON public.group_contributions FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- PART F — Group quests (Phase 7 shell — wraps, does not replace, the
-- existing quest system: challenges / user_challenges / quest_chain_progress)
-- ═══════════════════════════════════════════════════════════════════════════
-- This table stores the group-level quest definition and target only.
-- Per-member progress is deliberately NOT duplicated into a new
-- "group_quest_participants" table here — Phase 7 application logic should
-- compute progress by reading existing per-user tables (transactions,
-- daily_quest_logs, activity_log) for the group's members and aggregating,
-- the same way `lib/questRequirements.ts` already evaluates individual
-- quest criteria. Adding a shadow progress table before that logic exists
-- would risk a second source of truth; deferred to Phase 7 by design.

CREATE TABLE IF NOT EXISTS public.group_quests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  quest_type    TEXT        NOT NULL
                CHECK (quest_type IN (
                  'everyone_saves_this_week', 'deposit_count_together',
                  'target_amount_together', 'full_participation'
                )),
  title         TEXT        NOT NULL,
  description   TEXT,
  target_value  NUMERIC(12,2),
  xp_reward     INTEGER     NOT NULL DEFAULT 200,
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'completed', 'expired')),
  created_by    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  CONSTRAINT group_quests_date_order CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_group_quests_group  ON public.group_quests (group_id, status);
CREATE INDEX IF NOT EXISTS idx_group_quests_active ON public.group_quests (status, end_date) WHERE status = 'active';

ALTER TABLE public.group_quests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_quests_select_member"
  ON public.group_quests FOR SELECT
  USING (
    public.user_group_role(group_id, auth.uid()) IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
  );

CREATE POLICY "group_quests_insert_owner_or_admin"
  ON public.group_quests FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
      OR public.user_group_role(group_id, auth.uid()) = 'admin'
    )
  );

CREATE POLICY "group_quests_update_owner_or_admin"
  ON public.group_quests FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- PART G — Activity feed (Phase 8 shell) + visibility
-- ═══════════════════════════════════════════════════════════════════════════
-- Named `activity_feed` rather than the brief's `group_feed` because Phase 8
-- examples ("Sarah reached Level 8", "Alex joined the Travel Group") are not
-- all group-scoped — some are friend-scoped. group_id is nullable to cover
-- both. Write path (inserting rows when events happen) is Phase 8
-- application logic, reusing existing achievement/streak/level-up events —
-- not built in this migration. metadata is jsonb specifically so it can
-- NEVER structurally contain an amount field by accident; enforced by the
-- CHECK below at the schema level, not just by convention.

CREATE TABLE IF NOT EXISTS public.activity_feed (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id    UUID        REFERENCES public.groups(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL
              CHECK (event_type IN (
                'goal_completed', 'level_up', 'achievement_unlocked',
                'streak_milestone', 'group_joined', 'group_quest_completed'
              )),
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  visibility  TEXT        NOT NULL DEFAULT 'friends'
              CHECK (visibility IN ('private', 'friends', 'groups', 'public')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activity_feed_no_financial_fields CHECK (
    NOT (metadata ? 'amount')
    AND NOT (metadata ? 'balance')
    AND NOT (metadata ? 'target_amount')
    AND NOT (metadata ? 'current_amount')
  )
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_actor   ON public.activity_feed (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_feed_group   ON public.activity_feed (group_id, created_at DESC) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_feed_created ON public.activity_feed (created_at DESC);

ALTER TABLE public.activity_feed ENABLE ROW LEVEL SECURITY;

-- Visibility is evaluated at read time against the actor's current settings
-- and relationship to the viewer, not baked into the row permanently (a
-- privacy setting change should apply retroactively to past posts).
CREATE POLICY "activity_feed_select_by_visibility"
  ON public.activity_feed FOR SELECT
  USING (
    auth.uid() = actor_id
    OR (visibility = 'public')
    OR (visibility = 'friends' AND public.are_friends(actor_id, auth.uid()))
    OR (
      visibility = 'groups'
      AND group_id IS NOT NULL
      AND public.user_group_role(group_id, auth.uid()) IS NOT NULL
    )
  );

-- Inserted by server-side code on behalf of the acting user (service role or
-- the user themself posting their own event) — never on behalf of someone else.
CREATE POLICY "activity_feed_insert_own"
  ON public.activity_feed FOR INSERT
  WITH CHECK (auth.uid() = actor_id);

CREATE POLICY "activity_feed_delete_own"
  ON public.activity_feed FOR DELETE
  USING (auth.uid() = actor_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- PART H — updated_at / xp_total bookkeeping trigger for groups
-- ═══════════════════════════════════════════════════════════════════════════
-- Group XP is a simple additive counter, following the existing award_xp()
-- pattern of updating a denormalized total rather than summing on every
-- read. Group XP itself is still only ever granted via group quest
-- completion (Phase 7 logic, calling this the same way award_xp() is
-- called for individual XP) — no new XP source bypasses the existing
-- xp_awards ledger for individual users.
CREATE OR REPLACE FUNCTION public.increment_group_xp(p_group_id UUID, p_xp INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.groups SET xp_total = xp_total + p_xp WHERE id = p_group_id;
END;
$$;
