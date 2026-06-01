interface Props {
  emoji: string;
  title: string;
  description: string;
  action?: {
    label: string;
    href: string;
  };
}

export default function EmptyState({ emoji, title, description, action }: Props) {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl mb-4">{emoji}</div>
      <h3 className="font-display text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-white/40 text-sm mb-5 max-w-xs mx-auto leading-relaxed">{description}</p>
      {action && (
        <a href={action.href} className="btn-primary inline-flex items-center gap-2 text-sm px-5 py-2.5">
          {action.label}
        </a>
      )}
    </div>
  );
}