export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      coaches: {
        Row: {
          coach_user_id: string
          created_at: string
          id: string
          status: Database["public"]["Enums"]["coach_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          coach_user_id: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["coach_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["coach_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaches_coach_user_id_fkey"
            columns: ["coach_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          content: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          body_part: string | null
          created_at: string
          equipment: string | null
          id: string
          is_bodyweight: boolean
          muscle_group: string | null
          name: string
          owner_user_id: string | null
          updated_at: string
        }
        Insert: {
          body_part?: string | null
          created_at?: string
          equipment?: string | null
          id?: string
          is_bodyweight?: boolean
          muscle_group?: string | null
          name: string
          owner_user_id?: string | null
          updated_at?: string
        }
        Update: {
          body_part?: string | null
          created_at?: string
          equipment?: string | null
          id?: string
          is_bodyweight?: boolean
          muscle_group?: string | null
          name?: string
          owner_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercises_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string
          comment_id: string | null
          created_at: string
          id: string
          post_id: string | null
          read: boolean
          type: string
          user_id: string
        }
        Insert: {
          actor_id: string
          comment_id?: string | null
          created_at?: string
          id?: string
          post_id?: string | null
          read?: boolean
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string
          comment_id?: string | null
          created_at?: string
          id?: string
          post_id?: string | null
          read?: boolean
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          show_workout_details: boolean
          title: string
          user_id: string
          workout_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          show_workout_details?: boolean
          title: string
          user_id: string
          workout_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          show_workout_details?: boolean
          title?: string
          user_id?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_verified_16_plus: boolean
          age_verified_16_plus_at: string | null
          bodyweight: number | null
          created_at: string
          email: string
          goal: string | null
          id: string
          name: string | null
          onboarding_completed: boolean | null
          tracking_style: string | null
          unit_default: Database["public"]["Enums"]["unit_type"]
          updated_at: string
          vibe: string | null
        }
        Insert: {
          age_verified_16_plus?: boolean
          age_verified_16_plus_at?: string | null
          bodyweight?: number | null
          created_at?: string
          email: string
          goal?: string | null
          id: string
          name?: string | null
          onboarding_completed?: boolean | null
          tracking_style?: string | null
          unit_default?: Database["public"]["Enums"]["unit_type"]
          updated_at?: string
          vibe?: string | null
        }
        Update: {
          age_verified_16_plus?: boolean
          age_verified_16_plus_at?: string | null
          bodyweight?: number | null
          created_at?: string
          email?: string
          goal?: string | null
          id?: string
          name?: string | null
          onboarding_completed?: boolean | null
          tracking_style?: string | null
          unit_default?: Database["public"]["Enums"]["unit_type"]
          updated_at?: string
          vibe?: string | null
        }
        Relationships: []
      }
      prs: {
        Row: {
          achieved_at: string
          created_at: string
          est_1rm: number | null
          estimate_formula: string | null
          exercise_id: string
          id: string
          reps: number
          unit: Database["public"]["Enums"]["unit_type"]
          user_id: string
          weight: number
        }
        Insert: {
          achieved_at?: string
          created_at?: string
          est_1rm?: number | null
          estimate_formula?: string | null
          exercise_id: string
          id?: string
          reps: number
          unit: Database["public"]["Enums"]["unit_type"]
          user_id: string
          weight: number
        }
        Update: {
          achieved_at?: string
          created_at?: string
          est_1rm?: number | null
          estimate_formula?: string | null
          exercise_id?: string
          id?: string
          reps?: number
          unit?: Database["public"]["Enums"]["unit_type"]
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "prs_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_profiles: {
        Row: {
          created_at: string | null
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      session_metrics: {
        Row: {
          bodyweight: number | null
          bodyweight_unit: Database["public"]["Enums"]["unit_type"] | null
          created_at: string
          id: string
          mood: number | null
          preworkout: boolean
          sleep: number | null
          workout_id: string
        }
        Insert: {
          bodyweight?: number | null
          bodyweight_unit?: Database["public"]["Enums"]["unit_type"] | null
          created_at?: string
          id?: string
          mood?: number | null
          preworkout?: boolean
          sleep?: number | null
          workout_id: string
        }
        Update: {
          bodyweight?: number | null
          bodyweight_unit?: Database["public"]["Enums"]["unit_type"] | null
          created_at?: string
          id?: string
          mood?: number | null
          preworkout?: boolean
          sleep?: number | null
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_metrics_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: true
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      sets: {
        Row: {
          created_at: string
          id: string
          is_warmup: boolean
          notes: string | null
          reps: number
          rir: number | null
          rpe: number | null
          set_no: number
          unit: Database["public"]["Enums"]["unit_type"]
          updated_at: string
          weight: number
          workout_exercise_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_warmup?: boolean
          notes?: string | null
          reps: number
          rir?: number | null
          rpe?: number | null
          set_no: number
          unit: Database["public"]["Enums"]["unit_type"]
          updated_at?: string
          weight: number
          workout_exercise_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_warmup?: boolean
          notes?: string | null
          reps?: number
          rir?: number | null
          rpe?: number | null
          set_no?: number
          unit?: Database["public"]["Enums"]["unit_type"]
          updated_at?: string
          weight?: number
          workout_exercise_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sets_workout_exercise_id_fkey"
            columns: ["workout_exercise_id"]
            isOneToOne: false
            referencedRelation: "workout_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      template_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          order_index: number
          target_reps: number | null
          target_sets: number | null
          target_unit: Database["public"]["Enums"]["unit_type"] | null
          target_weight: number | null
          template_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          order_index: number
          target_reps?: number | null
          target_sets?: number | null
          target_unit?: Database["public"]["Enums"]["unit_type"] | null
          target_weight?: number | null
          template_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          order_index?: number
          target_reps?: number | null
          target_sets?: number | null
          target_unit?: Database["public"]["Enums"]["unit_type"] | null
          target_weight?: number | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_exercises_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workout_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_overrides: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          unit: Database["public"]["Enums"]["unit_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          unit: Database["public"]["Enums"]["unit_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          unit?: Database["public"]["Enums"]["unit_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_overrides_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          group_id: string | null
          id: string
          order_index: number
          workout_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          group_id?: string | null
          id?: string
          order_index: number
          workout_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          group_id?: string | null
          id?: string
          order_index?: number
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "workout_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_groups: {
        Row: {
          created_at: string
          id: string
          type: string
          workout_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          type?: string
          workout_id: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_groups_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_templates: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_templates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          locked_at: string | null
          notes: string | null
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          locked_at?: string | null
          notes?: string | null
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          locked_at?: string | null
          notes?: string | null
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "lifter" | "coach"
      coach_status: "pending" | "active" | "revoked"
      unit_type: "kg" | "lb"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["lifter", "coach"],
      coach_status: ["pending", "active", "revoked"],
      unit_type: ["kg", "lb"],
    },
  },
} as const
