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
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["savings_goals"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["savings_goals"]["Insert"]>;
      };
      transactions: {
        Row: { id: string; user_id: string; goal_id: string; amount: number; note: string | null; created_at: string; };
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
