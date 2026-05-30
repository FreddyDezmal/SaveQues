"use client";

interface Props {
  levelInfo: {
    level: number;
    title: string;
    progressPercent: number;
    currentLevelXP: number;
    nextLevelXP: number;
  };
  xpTotal: number;
}

export default function XPProgressBar({ levelInfo, xpTotal }: Props) {
  const { level, title, progressPercent, nextLevelXP } = levelInfo;
  const xpToNext = nextLevelXP - xpTotal;
  const isMax = level === 10;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
            <span className="font-display font-bold text-brand-400 text-sm">{level}</span>
          </div>
          <div>
            <p className="font-display text-sm font-semibold text-white">{title}</p>
            <p className="text-[11px] text-white/40">Level {level}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-sm font-bold text-brand-400">{xpTotal.toLocaleString()} XP</p>
          {!isMax && (
            <p className="text-[11px] text-white/40">{xpToNext.toLocaleString()} to next</p>
          )}
        </div>
      </div>

      <div className="xp-bar-container">
        <div
          className="xp-bar-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {!isMax && (
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-white/30">Lv {level}</span>
          <span className="text-[10px] text-white/30">Lv {level + 1}</span>
        </div>
      )}
    </div>
  );
}
