"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { ArrowLeft, ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import NotificationSettings from "@/components/notifications/NotificationSettings";
import VersionInfo from "@/components/settings/VersionInfo";
import { isValidUsernameFormat } from "@/lib/username";

interface Props {
  profile: any;
  email: string;
}

export default function SettingsClient({ profile, email }: Props) {
  const router = useRouter();
  const [currencyCode, setCurrencyCode] = useState(profile.currency_code ?? "ZAR");
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

  // ── Username — its own self-contained editor, not part of the shared
  // "Save changes" flow below. It needs a different UX (live typeahead
  // availability, distinct 409-taken error) than the free-text fields
  // PATCH /api/profile already handles, so it uses its own dedicated
  // POST /api/profile/username route instead.
  const [username, setUsername] = useState(profile.username ?? "");
  const originalUsername = profile.username ?? "";
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameSaved, setUsernameSaved] = useState(false);
  const [usernameError, setUsernameError] = useState("");

  useEffect(() => {
    if (username === originalUsername) { setUsernameStatus("idle"); return; }
    if (!username) { setUsernameStatus("idle"); return; }
    if (!isValidUsernameFormat(username)) { setUsernameStatus("invalid"); return; }

    setUsernameStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profile/username-available?username=${encodeURIComponent(username)}`);
        const body = await res.json();
        setUsernameStatus(body.available ? "available" : "taken");
      } catch {
        setUsernameStatus("idle");
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [username, originalUsername]);

  async function handleSaveUsername() {
    setUsernameSaving(true);
    setUsernameError("");
    const res = await fetch("/api/profile/username", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setUsernameError(data.error ?? "Couldn't save that username.");
      setUsernameSaving(false);
      return;
    }
    setUsernameSaving(false);
    setUsernameSaved(true);
    setTimeout(() => setUsernameSaved(false), 2000);
    router.refresh();
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");

    // Sprint 10 — Part 3: profile updates now go through PATCH /api/profile
    // instead of writing directly to Supabase from the browser. The route
    // validates display_name length and currency_code against the
    // supported list, and resolves the matching locale server-side.
    const res = await fetch("/api/profile", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name:  displayName,
        currency_code: currencyCode,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error ?? "Failed to save changes.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountError, setDeleteAccountError]   = useState("");

  async function handleDeleteAccount() {
    if (deleteInput !== "DELETE") return;
    setDeleteAccountLoading(true);
    setDeleteAccountError("");

    // Call the server-side deletion route which uses admin.deleteUser().
    // This is the only correct path — client-side profile deletion leaves
    // an orphaned auth.users record that blocks re-registration.
    const res = await fetch("/api/account", { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteAccountError(data.error ?? "Failed to delete account. Please try again.");
      setDeleteAccountLoading(false);
      return;
    }

    // Clear local session state then redirect
    const { createClient: createSupabaseClient } = await import("@/lib/supabase/client");
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/profile" className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-display text-2xl font-bold text-white">Settings</h1>
      </div>

      {/* Account */}
      <div className="mb-6">
        <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Account</p>
        <div className="card p-4 space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-1.5">Display name</label>
            <input
              className="input-field"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              maxLength={60}
            />
          </div>
          <div>
            <label htmlFor="settings-username" className="block text-sm text-white/60 mb-1.5">
              Username <span className="text-white/30">— how friends find you</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">@</span>
              <input
                id="settings-username"
                className="input-field pl-7"
                value={username}
                onChange={e => { setUsername(e.target.value.trim()); setUsernameError(""); }}
                placeholder="username"
                maxLength={20}
                aria-describedby="settings-username-status"
                aria-invalid={usernameStatus === "taken" || usernameStatus === "invalid"}
              />
            </div>
            <div id="settings-username-status" className="flex items-center justify-between mt-1.5 min-h-[20px]" role="status">
              <p className="text-xs">
                {usernameStatus === "checking" && <span className="text-white/40">Checking…</span>}
                {usernameStatus === "available" && <span className="text-emerald-400">✓ Available</span>}
                {usernameStatus === "taken" && <span className="text-red-400">Already taken</span>}
                {usernameStatus === "invalid" && <span className="text-red-400">3-20 characters: letters, numbers, underscores only</span>}
              </p>
              {username !== originalUsername && usernameStatus === "available" && (
                <button
                  type="button"
                  onClick={handleSaveUsername}
                  disabled={usernameSaving}
                  className="text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors disabled:opacity-40"
                >
                  {usernameSaving ? "Saving…" : usernameSaved ? "✓ Saved" : "Save username"}
                </button>
              )}
            </div>
            {usernameError && <p className="text-red-400 text-xs mt-1">{usernameError}</p>}
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1.5">Email</label>
            <div className="input-field opacity-50 cursor-not-allowed">{email}</div>
            <p className="text-xs text-white/30 mt-1.5">Email cannot be changed here</p>
          </div>
        </div>
      </div>

      {/* Currency */}
      <div className="mb-6">
        <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Currency</p>
        <div className="card p-4">
          <label className="block text-sm text-white/60 mb-1.5">Display currency</label>
          <select
            className="input-field"
            value={currencyCode}
            onChange={e => setCurrencyCode(e.target.value)}
          >
            {SUPPORTED_CURRENCIES.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <p className="text-xs text-white/30 mt-2">
            This only changes how amounts are displayed — your savings data is unchanged.
          </p>
        </div>
      </div>

      {/* Notifications */}
      <NotificationSettings
        profileId={profile.id}
        currentHour={profile.last_notification_hour ?? 20}
        notificationsEnabled={profile.notifications_enabled ?? false}
      />

      <Link
        href="/settings/notifications"
        className="card p-4 flex items-center justify-between hover:border-white/10 transition-colors mb-6 -mt-3"
      >
        <div>
          <p className="text-sm font-medium text-white">Notification preferences</p>
          <p className="text-xs text-white/40 mt-0.5">Choose which types of notifications you receive</p>
        </div>
        <ChevronRight size={16} className="text-white/20" />
      </Link>

      {/* Password */}
      <div className="mb-6">
        <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Security</p>
        <Link href="/auth/forgot-password" className="card p-4 flex items-center justify-between hover:border-white/10 transition-colors">
          <div>
            <p className="text-sm font-medium text-white">Change password</p>
            <p className="text-xs text-white/40 mt-0.5">Receive a reset link by email</p>
          </div>
          <ChevronRight size={16} className="text-white/20" />
        </Link>
      </div>

      {/* Save button */}
      {saveError && (
        <div className="mb-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
          {saveError}
        </div>
      )}
      <button onClick={handleSave} disabled={saving} className="btn-primary w-full mb-8">
        {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
      </button>

      <div className="mb-8">
        <VersionInfo />
      </div>

      {/* Danger zone */}
      <div>
        <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-3">Danger zone</p>
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full p-4 rounded-xl border border-red-500/20 text-red-400 text-sm flex items-center gap-2 hover:bg-red-500/5 transition-colors"
          >
            <Trash2 size={15} /> Delete my account
          </button>
        ) : (
          <div className="card p-4 border-red-500/20">
            <p className="text-sm text-white/70 mb-1">Are you sure?</p>
            <p className="text-xs text-white/40 mb-4">
              This permanently deletes your account, all goals, savings history, achievements, and streaks. This cannot be undone.
            </p>
            <p className="text-xs text-white/60 mb-2">Type <span className="font-mono text-red-400">DELETE</span> to confirm</p>
            <input
              className="input-field mb-3"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
            />
            <div className="flex gap-2">
              <button
                onClick={handleDeleteAccount}
                disabled={deleteInput !== "DELETE" || deleteAccountLoading}
                className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-sm font-medium disabled:opacity-40"
              >
                {deleteAccountLoading ? "Deleting…" : "Yes, delete everything"}
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); setDeleteAccountError(""); }}
                className="flex-1 btn-ghost text-sm py-2.5"
              >
                Cancel
              </button>
            </div>
            {deleteAccountError && (
              <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-xs">
                {deleteAccountError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}