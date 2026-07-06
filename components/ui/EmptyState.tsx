interface Props {
  emoji: string;
  title: string;
  description: string;
  action?: {
    label: string;
    href: string;
    icon?: React.ReactNode;
  };
  /**
   * Sprint 16: when true, skips the outer `card` background/border classes.
   * Added specifically for embedding inside a container that already has
   * its own card/panel styling (e.g. NotificationCenter's dropdown panel) —
   * without this, the component's own `.card` wrapper nested inside
   * another card produces a visible double-border. Defaults to false, so
   * every existing usage (none yet, but future page-level empty states
   * like the Goals page's own hand-rolled equivalent) keeps today's exact
   * appearance with no prop needed.
   */
  bare?: boolean;
  /** Additional classes on the outer wrapper — e.g. extra top margin when embedded lower on a page. */
  className?: string;
}

export default function EmptyState({ emoji, title, description, action, bare = false, className = "" }: Props) {
  return (
    <div className={`${bare ? "text-center" : "card p-10 text-center"} ${className}`}>
      <div className="text-5xl mb-4">{emoji}</div>
      <h3 className="font-display text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-white/40 text-sm mb-5 max-w-xs mx-auto leading-relaxed">{description}</p>
      {action && (
        <a href={action.href} className="btn-primary inline-flex items-center gap-2 text-sm px-5 py-2.5">
          {action.icon}{action.label}
        </a>
      )}
    </div>
  );
}