export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_emoji: string;
          xp_total: number;
          current_level: number;
          streak_days: number;
          longest_streak: number;
          last_active_date: string | null;
          streak_shields: number;
          total_shields_used: number;
          streak_paused_until: string | null;
          last_notification_hour: number | null;
          daily_quests_completed: number;
          weekly_quests_completed: number;
          quest_chains_completed: number;
          is_admin: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      savings_goals: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          category: string;
          goal_emoji: string;
          target_amount: number;
          current_amount: number;
          target_date: string | null;
          is_complete: boolean;
          // Code review fix: these four columns exist in the DB (migration
          // 014_consolidated_schema.sql) but were missing from this
          // hand-maintained type — is_active/goal_status are set but never
          // transitioned away from their defaults anywhere in the app (no
          // pause/archive feature exists yet, confirmed by grep), so they're
          // typed here for completeness but not yet meaningful signals.
          // completed_at IS meaningful: it's set by update_goal_amount()'s
          // trigger the moment a goal completes, and is what
          // lib/analyticsEngine.ts's getGoalCompletionTimestamp() now reads
          // first instead of proxying off the latest transaction.
          is_primary: boolean;
          is_active: boolean;
          goal_status: "active" | "paused" | "completed" | "archived";
          completed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["savings_goals"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["savings_goals"]["Insert"]>;
      };
      transactions: {
        // Sprint 19 audit fix: this Row type was missing `transaction_type`,
        // even though the column has existed since migration 014 and every
        // RPC/query in the codebase (get_dashboard_data, fetchTimelineEvents,
        // the balance/withdrawal triggers) already reads and writes it.
        // Source of truth is supabase/migrations/014_consolidated_schema.sql.
        Row: {
          id: string;
          user_id: string;
          goal_id: string;
          amount: number;
          note: string | null;
          transaction_type: "deposit" | "withdrawal" | "goal_purchase" | "adjustment";
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["transactions"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
      };
      challenges: {
        Row: { id: string; title: string; description: string; type: string; xp_reward: number; duration_days: number; is_active: boolean; };
        Insert: Omit<Database["public"]["Tables"]["challenges"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["challenges"]["Insert"]>;
      };
      user_challenges: {
        Row: { id: string; user_id: string; challenge_id: string; status: "active" | "completed" | "failed"; started_at: string; completed_at: string | null; };
        Insert: Omit<Database["public"]["Tables"]["user_challenges"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["user_challenges"]["Insert"]>;
      };
      user_achievements: {
        Row: { id: string; user_id: string; achievement_id: string; earned_at: string; };
        Insert: Omit<Database["public"]["Tables"]["user_achievements"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["user_achievements"]["Insert"]>;
      };
      daily_quest_logs: {
        Row: { id: string; user_id: string; quest_id: string; quest_date: string; xp_earned: number; created_at: string; };
        Insert: Omit<Database["public"]["Tables"]["daily_quest_logs"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["daily_quest_logs"]["Insert"]>;
      };
      quest_chain_progress: {
        Row: { id: string; user_id: string; chain_id: string; current_step: number; status: string; started_at: string; completed_at: string | null; };
        Insert: Omit<Database["public"]["Tables"]["quest_chain_progress"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["quest_chain_progress"]["Insert"]>;
      };
      activity_log: {
        Row: { id: string; user_id: string; activity_date: string; xp_earned: number; actions_count: number; };
        Insert: Omit<Database["public"]["Tables"]["activity_log"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["activity_log"]["Insert"]>;
      };
    };
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type SavingsGoal = Database["public"]["Tables"]["savings_goals"]["Row"];
export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
export type Challenge = Database["public"]["Tables"]["challenges"]["Row"];
export type UserChallenge = Database["public"]["Tables"]["user_challenges"]["Row"];
export type UserAchievement = Database["public"]["Tables"]["user_achievements"]["Row"];
export type DailyQuestLog = Database["public"]["Tables"]["daily_quest_logs"]["Row"];
export type QuestChainProgress = Database["public"]["Tables"]["quest_chain_progress"]["Row"];
export type ActivityLog = Database["public"]["Tables"]["activity_log"]["Row"];
// ─── Timeline ────────────────────────────────────────────────────────────────

export type TimelineEventType =
  | "deposit"
  | "withdrawal"
  | "goal_purchase"
  | "goal_created"
  | "goal_completed"
  | "achievement_earned"
  | "quest_completed"
  | "progress_milestone";

export type TimelineEventMeta =
  | { type: "deposit";      goalId: string; goalTitle: string; goalCategory: string; amount: number; note?: string; }
  | { type: "withdrawal";   goalId: string; goalTitle: string; goalCategory: string; amount: number; note?: string; }
  | { type: "goal_purchase";goalId: string; goalTitle: string; goalCategory: string; amount: number; note?: string; }
  | { type: "goal_created"; goalId: string; goalTitle: string; goalCategory: string; targetAmount: number; }
  | { type: "goal_completed";goalId: string; goalTitle: string; goalCategory: string; targetAmount: number; }
  | { type: "achievement_earned"; achievementId: string; achievementTitle: string; achievementIcon: string; achievementCategory: string; xpReward: number; }
  | { type: "quest_completed";    challengeId: string; challengeTitle: string; xpReward: number; }
  | { type: "progress_milestone"; goalId: string; goalTitle: string; goalCategory: string; milestone: 25 | 50 | 75; targetAmount: number; };

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  xpGained?: number;
  meta: TimelineEventMeta;
}

export interface TimelineEventGroup {
  date: string;
  events: TimelineEvent[];
}