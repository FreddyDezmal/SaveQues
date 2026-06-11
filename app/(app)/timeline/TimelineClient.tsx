"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import TimelineEventRow from "@/components/timeline/TimelineEventRow";
import type { TimelineEventGroup } from "@/lib/types";

interface Props {
  groups: TimelineEventGroup[];
  goalTitle?: string;
  backHref?: string;
  currencyCode?: string;
  locale?: string;
}

export default function TimelineClient({
  groups,
  goalTitle,
  backHref = "/dashboard",
  currencyCode = "ZAR",
  locale = "en-ZA",
}: Props) {
  const isEmpty = groups.length === 0;
  const totalEvents = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-10 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={backHref} className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-display text-xl font-bold text-white">
            {goalTitle ?? "Timeline"}
          </h1>
          {!isEmpty && (
            <p className="text-white/30 text-xs mt-0.5">
              {goalTitle ? "Goal activity" : "Your savings journey"} · {totalEvents} events
            </p>
          )}
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="card p-10 text-center mt-12">
          <div className="text-5xl mb-4">🌱</div>
          <p className="font-display font-semibold text-white text-base mb-1">Nothing here yet</p>
          <p className="text-white/40 text-sm">
            {goalTitle
              ? "Log your first deposit to start your goal story."
              : "Make your first deposit to start your savings journey."}
          </p>
          <Link
            href={goalTitle ? backHref : "/goals"}
            className="inline-flex mt-6 btn-primary text-sm"
          >
            {goalTitle ? "Back to goal" : "Go to Goals"}
          </Link>
        </div>
      )}

      {/* Event groups */}
      {!isEmpty && (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.date}>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-1 px-1">
                {group.date}
              </p>
              <div className="card px-4 divide-y divide-surface-border">
                {group.events.map((event) => (
                  <TimelineEventRow
                    key={event.id}
                    event={event}
                    currencyCode={currencyCode}
                    locale={locale}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
