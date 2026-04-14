const PROFILE_SELECT_FIELDS_WITH_FULL_NAME = [
  "id",
  "username",
  "full_name",
  "bio",
  "bodyweight",
  "height_cm",
  "created_at",
  "updated_at",
  "unit_default",
  "pr_summary",
  "goal",
  "tracking_style",
  "vibe",
  "onboarding_completed",
  "avatar_url",
  "is_private",
  "ai_tips_consent",
  "ai_tips_consent_granted_at",
] as const;

const PROFILE_SELECT_FIELDS_WITH_NAME = [
  "id",
  "username",
  "name",
  "bio",
  "bodyweight",
  "height_cm",
  "created_at",
  "updated_at",
  "unit_default",
  "pr_summary",
  "goal",
  "tracking_style",
  "vibe",
  "onboarding_completed",
  "avatar_url",
  "is_private",
  "ai_tips_consent",
  "ai_tips_consent_granted_at",
] as const;

export const PROFILE_SELECT_FIELD_SETS = [
  PROFILE_SELECT_FIELDS_WITH_FULL_NAME,
  PROFILE_SELECT_FIELDS_WITH_NAME,
] as const;

export const PROFILE_SELECT_STRINGS = PROFILE_SELECT_FIELD_SETS.map((fields) =>
  fields.join(",")
);
