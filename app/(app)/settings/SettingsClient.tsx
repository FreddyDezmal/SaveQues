"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { ArrowLeft, ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import NotificationSettings from "@/components/notifications/NotificationSettings";

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    const selected = SUPPORTED_CURRENCIES.find(c => c.code === currencyCode);
    await supabase.from("profiles").update({
      display_name: displayName,
      currency_code: currencyCode,
      locale: selected?.locale ?? "en-ZA",
    }).eq("id", profile.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function handleDeleteAccount() {
    if (deleteInput !== "DELETE") return;
    const supabase = createClient();
    // Delete profile (cascades to all user data via FK)
    await supabase.from("profiles").delete().eq("id", profile.id);
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
            />
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
      <button onClick={handleSave} disabled={saving} className="btn-primary w-full mb-8">
        {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
      </button>

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
                disabled={deleteInput !== "DELETE"}
                className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-sm font-medium disabled:opacity-40"
              >
                Yes, delete everything
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                className="flex-1 btn-ghost text-sm py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}