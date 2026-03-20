import { supabase } from "@/integrations/supabase/client";

export const signUp = async (email: string, password: string, name: string, birthYear: number) => {
  const redirectUrl = `${window.location.origin}/`;
  
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectUrl,
      data: {
        name,
        birth_year: birthYear,
      },
    },
  });

  if (!error && data.user) {
    // Update profile with age verification
    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;
    
    await supabase
      .from('profiles')
      .update({
        age_verified_16_plus: age >= 16,
        age_verified_16_plus_at: new Date().toISOString(),
      })
      .eq('id', data.user.id);
  }

  return { data, error };
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

export const getCurrentSession = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
};
