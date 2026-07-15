-- ─────────────────────────────────────────────────────────────────────────────
-- 053_invitations.sql
-- Sprint 22, Phase 10 — Invitations
--
-- ── Finding: no email-sending infrastructure exists in this codebase ─────
-- Checked package.json (no resend/sendgrid/nodemailer/postmark/ses/twilio)
-- and grepped lib/ and app/ for any custom mailer. There isn't one — the
-- only email-related code is the Supabase-Auth-driven verify-email page,
-- not a general transactional sender. Choosing and wiring an email
-- provider (API keys, templates, a vendor decision) is a real
-- infrastructure choice that belongs to the person running this project,
-- not something to pick unilaterally inside a migration. So: the DATA
-- MODEL and the share-link/QR path are fully built and functional here —
-- an invite works completely via its link whether or not email exists.
-- Actual email delivery is architected (invitations.email, invite_type
-- ='email') but the send step is a clearly-marked stub in
-- lib/invites.ts, same "architecture only" treatment the brief itself
-- explicitly allows for QR codes.
--
-- ── QR codes ───────────────────────────────────────────────────────────
-- Not a separate delivery mechanism — a QR code is just the invite link
-- (/invite/{token}) rendered as an image, which happens client-side with
-- an image-generation library the frontend chooses. Nothing in this
-- migration is QR-specific; the token/link design is what needs to be
-- QR-friendly (short, URL-safe, no query-string state), and it is.
--
-- ── Anti-abuse, built in now rather than deferred to Phase 14 ────────────
-- Two guards baked into the schema/function itself, not left as "Phase 14
-- will audit this later": (1) a user can redeem at most ONE invite ever,
-- system-wide (a DB-level unique partial index, not just app logic) — the
-- obvious farming vector is one person redeeming many different invite
-- links to generate referral rewards for many different inviters
-- repeatedly; (2) self-referral is blocked (inviter_id <> redeemed_by).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — xp_awards: allow 'referral' as a source_type
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.xp_awards DROP CONSTRAINT IF EXISTS xp_awards_source_type_check;
ALTER TABLE public.xp_awards ADD CONSTRAINT xp_awards_source_type_check
  CHECK (source_type IN (
    'daily_quest','weekly_quest','challenge','chain_step',
    'chain_complete','log_saving','goal_complete',
    'event_complete','achievement','admin_grant','daily_checkin',
    'group_quest','referral'
  ));


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — invitations table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.invitations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_type  TEXT        NOT NULL CHECK (invite_type IN ('email', 'link')),
  email        TEXT,
  token        TEXT        NOT NULL UNIQUE,
  context_type TEXT        NOT NULL DEFAULT 'general' CHECK (context_type IN ('general', 'group')),
  group_id     UUID        REFERENCES public.groups(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'sent', 'opened', 'redeemed', 'expired', 'revoked')),
  redeemed_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  redeemed_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invitations_email_required_for_email_type
    CHECK (invite_type <> 'email' OR email IS NOT NULL),
  CONSTRAINT invitations_group_required_for_group_context
    CHECK (context_type <> 'group' OR group_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON public.invitations (inviter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_token    ON public.invitations (token);

-- One redemption per person, ever, system-wide. See file header.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_redeemed_by_once
  ON public.invitations (redeemed_by) WHERE redeemed_by IS NOT NULL;

-- Only owner/admin may create a group-context invite — a regular member
-- sharing a link should never be able to grant instant group membership,
-- the same permission boundary group_members_insert_invite_or_self_request
-- (045/048) already enforces for in-app group invites.
CREATE OR REPLACE FUNCTION public.enforce_invite_permissions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.context_type = 'group' THEN
    IF NOT EXISTS (SELECT 1 FROM public.groups WHERE id = NEW.group_id AND owner_id = NEW.inviter_id)
       AND COALESCE(public.user_group_role(NEW.group_id, NEW.inviter_id), '') <> 'admin' THEN
      RAISE EXCEPTION 'Only the group owner or an admin can create a group invite'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invite_permissions ON public.invitations;
CREATE TRIGGER trg_enforce_invite_permissions
  BEFORE INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invite_permissions();

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Inviter manages their own invites. No direct SELECT for anyone else —
-- redemption and preview go through the SECURITY DEFINER functions below,
-- which return a deliberately narrow, safe subset of columns (never the
-- inviter's email, never the full row) rather than opening RLS to
-- strangers holding a token.
CREATE POLICY "invitations_select_own"
  ON public.invitations FOR SELECT
  USING (auth.uid() = inviter_id);

CREATE POLICY "invitations_insert_own"
  ON public.invitations FOR INSERT
  WITH CHECK (auth.uid() = inviter_id AND status IN ('pending', 'sent'));

-- Inviter can only revoke (or mark opened/sent for their own tracking) —
-- redeemed_by/redeemed_at are never settable through this policy at all;
-- only redeem_invite() (SECURITY DEFINER, below) can set those.
CREATE POLICY "invitations_update_own_status_only"
  ON public.invitations FOR UPDATE
  USING (auth.uid() = inviter_id)
  WITH CHECK (
    auth.uid() = inviter_id
    AND redeemed_by IS NULL
    AND status IN ('pending', 'sent', 'opened', 'revoked')
    AND inviter_id = (SELECT i2.inviter_id FROM public.invitations i2 WHERE i2.id = invitations.id)
    AND token = (SELECT i2.token FROM public.invitations i2 WHERE i2.id = invitations.id)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C — Public preview (works for unauthenticated visitors, pre-signup)
-- ═══════════════════════════════════════════════════════════════════════════
-- Deliberately narrow: inviter display name/avatar and group name only —
-- never the inviter's email, never the raw invitations row. Returns NULL
-- for an unknown, expired, or already-redeemed/revoked token rather than
-- distinguishing those cases, so a token can't be used to probe state.

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv RECORD;
BEGIN
  SELECT * INTO v_inv FROM public.invitations
  WHERE token = p_token AND status IN ('pending', 'sent', 'opened') AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'inviter', (
      SELECT jsonb_build_object('display_name', p.display_name, 'avatar_emoji', p.avatar_emoji)
      FROM public.profiles p WHERE p.id = v_inv.inviter_id
    ),
    'context_type', v_inv.context_type,
    'group', (
      CASE WHEN v_inv.group_id IS NULL THEN NULL ELSE (
        SELECT jsonb_build_object('name', g.name, 'emoji', g.emoji) FROM public.groups g WHERE g.id = v_inv.group_id
      ) END
    )
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART D — Redemption (rewards, group auto-join, referral achievements)
-- ═══════════════════════════════════════════════════════════════════════════
-- Granted directly to `authenticated` (unlike 050/051's service-role-only
-- functions) — redemption is inherently one-shot and self-contained: each
-- token can be consumed exactly once, by someone who isn't its creator,
-- moving straight from pending to redeemed with no repeatable-trigger
-- surface the way group quest completion has. The anti-abuse guards live
-- inside the function itself, not in who's allowed to call it.

CREATE OR REPLACE FUNCTION public.redeem_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_inv    RECORD;
  v_inviter_xp INTEGER := 100;
  v_invitee_xp INTEGER := 50;
  v_referral_count INTEGER;
  v_new_achievement TEXT := NULL;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_inv FROM public.invitations
  WHERE token = p_token AND status IN ('pending', 'sent', 'opened') AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired');
  END IF;

  IF v_inv.inviter_id = v_caller THEN
    RETURN jsonb_build_object('success', false, 'error', 'self_referral');
  END IF;

  IF EXISTS (SELECT 1 FROM public.invitations WHERE redeemed_by = v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_redeemed_another_invite');
  END IF;

  UPDATE public.invitations
  SET status = 'redeemed', redeemed_by = v_caller, redeemed_at = NOW()
  WHERE id = v_inv.id;

  -- Group auto-join, if this was a group-context invite. Insert directly
  -- as 'active' — enforce_invite_permissions (PART B) already verified
  -- the inviter was owner/admin at CREATE time, so this is equivalent to
  -- an owner/admin having invited this specific person; no separate
  -- accept step is needed since redemption IS the accept.
  IF v_inv.context_type = 'group' AND v_inv.group_id IS NOT NULL THEN
    INSERT INTO public.group_members (group_id, user_id, status, invited_by)
    VALUES (v_inv.group_id, v_caller, 'active', v_inv.inviter_id)
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;

  -- Rewards. Direct xp_awards inserts (not award_xp()) for the same
  -- reason as 050's group quest XP: the inviter is not auth.uid(), and
  -- award_xp()'s C1 guard correctly forbids that path. This function IS
  -- the verified-server-side-event trust boundary — same architecture,
  -- applied to a different event.
  INSERT INTO public.xp_awards (user_id, source_type, source_id, xp_awarded)
  VALUES (v_inv.inviter_id, 'referral', v_inv.id::TEXT, v_inviter_xp)
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;
  IF FOUND THEN
    UPDATE public.profiles SET xp_total = xp_total + v_inviter_xp WHERE id = v_inv.inviter_id;
  END IF;

  INSERT INTO public.xp_awards (user_id, source_type, source_id, xp_awarded)
  VALUES (v_caller, 'referral', v_inv.id::TEXT || ':invitee', v_invitee_xp)
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;
  IF FOUND THEN
    UPDATE public.profiles SET xp_total = xp_total + v_invitee_xp WHERE id = v_caller;
  END IF;

  -- Referral achievements — milestone thresholds on the inviter's
  -- lifetime successful-redemption count. No achievement catalog table
  -- exists in this schema (achievement_id is a bare TEXT code, same
  -- finding as 051's achievement_unlocked trigger); matching display
  -- entries (title/icon/description) are added to lib/achievements.ts
  -- under the existing but previously-empty "social" category.
  SELECT count(*) INTO v_referral_count FROM public.invitations WHERE inviter_id = v_inv.inviter_id AND status = 'redeemed';

  v_new_achievement := CASE v_referral_count
    WHEN 1 THEN 'referral_first'
    WHEN 5 THEN 'referral_five'
    WHEN 10 THEN 'referral_ten'
    ELSE NULL
  END;

  IF v_new_achievement IS NOT NULL THEN
    INSERT INTO public.user_achievements (user_id, achievement_id)
    VALUES (v_inv.inviter_id, v_new_achievement)
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'joined_group_id', CASE WHEN v_inv.context_type = 'group' THEN v_inv.group_id ELSE NULL END,
    'invitee_xp', v_invitee_xp,
    'inviter_referral_count', v_referral_count
  );
END;
$$;
