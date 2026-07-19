"use client";

/**
 * components/social/UserSearchPicker.tsx
 *
 * Sprint 22. One search-as-you-type component reused by every "invite
 * someone" flow (add friend, invite to group, invite to shared goal,
 * request a partner) — all call the same /api/friends/search endpoint
 * (046), which already excludes private/blocked profiles server-side.
 * Results are rendered as a plain list of focusable buttons rather than
 * a full ARIA 1.2 combobox — simpler to get right, fully keyboard-
 * operable via normal Tab order, and avoids the well-known fragility of
 * hand-rolled combobox roving-tabindex implementations for a case that
 * doesn't need one (this isn't an autocomplete-into-a-text-field pattern,
 * it's "search, then click a result to act on it").
 */

import { useEffect, useId, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import UserAvatar, { UserName } from "./UserAvatar";

export interface SearchResultUser {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  friendship_status?: string;
}

interface UserSearchPickerProps {
  onSelect: (user: SearchResultUser) => void;
  placeholder?: string;
  /** Optional set of user ids to exclude from results (e.g. existing group members). */
  excludeIds?: string[];
}

export default function UserSearchPicker({ onSelect, placeholder = "Search by username or name…", excludeIds = [] }: UserSearchPickerProps) {
  const inputId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Search failed");
        setResults((data.results ?? []).filter((r: SearchResultUser) => !excludeIds.includes(r.id)));
        setError(null);
      } catch (err: any) {
        setError(err.message || "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div>
      <label htmlFor={inputId} className="sr-only">Search for a user</label>
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="input-field pl-10"
          autoComplete="off"
          aria-describedby={statusId}
        />
        {loading && (
          <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 animate-spin" aria-hidden="true" />
        )}
      </div>

      <div id={statusId} role="status" className="sr-only">
        {loading ? "Searching…" : error ? error : `${results.length} result${results.length === 1 ? "" : "s"}`}
      </div>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      {results.length > 0 && (
        <ul className="mt-3 max-h-64 overflow-y-auto space-y-1">
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onSelect(user)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-elevated transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                <UserAvatar emoji={user.avatar_emoji} size="sm" />
                <UserName displayName={user.display_name} username={user.username} className="flex-1 min-w-0" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
        <p className="text-xs text-white/40 mt-3 text-center py-2">No users found</p>
      )}
    </div>
  );
}
