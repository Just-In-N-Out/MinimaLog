import { supabase } from "@/integrations/supabase/client";
import { getAuthRedirectUrl } from "./auth-config";

export const sendMagicLink = async (email: string) => {
  const redirectUrl = getAuthRedirectUrl();

  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectUrl,
      shouldCreateUser: true,
    },
  });

  return { data, error };
};

export const getCurrentUser = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};
