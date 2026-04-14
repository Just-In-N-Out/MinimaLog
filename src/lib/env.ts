const requireEnvVar = (key: keyof ImportMetaEnv) => {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const getSupabaseUrl = () => {
  return requireEnvVar("VITE_SUPABASE_URL");
};

export const getSupabaseAnonKey = () => {
  const key =
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!key) {
    throw new Error(
      "Missing required environment variable: VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return key;
};

