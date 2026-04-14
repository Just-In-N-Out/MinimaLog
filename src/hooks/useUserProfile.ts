import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { PROFILE_SELECT_STRINGS } from "@/lib/profileFields";

export const useUserProfile = (userId: string, accessToken?: string) => {
  return useQuery({
    queryKey: ['userProfile', userId],
    queryFn: async () => {
      // Try using Supabase client first (more efficient)
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select(PROFILE_SELECT_STRINGS[0]) // Use the most comprehensive select string
          .eq("id", userId)
          .single();

        if (!error && data) {
          return data;
        }
      } catch (clientError) {
        console.warn("Supabase client profile fetch failed, falling back to REST API", clientError);
      }

      // Fallback to REST API if client method fails
      if (accessToken) {
        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();

        // Try up to 2 select string variations
        for (let i = 0; i < 2 && i < PROFILE_SELECT_STRINGS.length; i++) {
          try {
            const response = await fetchWithTimeout(
              `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=${PROFILE_SELECT_STRINGS[i]}`,
              {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${accessToken}`,
                  'apikey': apiKey
                },
                timeoutMs: 5000,
              }
            );

            if (response.ok) {
              const profiles = await response.json();
              if (profiles[0]) {
                return profiles[0];
              }
            }
          } catch (attemptError) {
            console.warn(`Profile REST API attempt ${i + 1} failed:`, attemptError);
          }
        }
      }

      throw new Error('Failed to load profile');
    },
    staleTime: 120000, // Profile data rarely changes, cache for 2 minutes
    gcTime: 600000,    // Keep in cache for 10 minutes
    enabled: !!userId,
    retry: 2, // Retry up to 2 times on failure
  });
};

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      const { data, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate and update the profile cache
      queryClient.setQueryData(['userProfile', variables.userId], data);
      queryClient.invalidateQueries({ queryKey: ['userProfile', variables.userId] });
    },
  });
};

export const usePublicProfile = (userId: string) => {
  return useQuery({
    queryKey: ['publicProfile', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_profiles" as any)
        .select("id, username")
        .eq("id", userId)
        .single();

      if (error) throw error;
      return data;
    },
    staleTime: 300000, // Public profiles are very stable, cache for 5 minutes
    gcTime: 900000,    // Keep in cache for 15 minutes
    enabled: !!userId,
  });
};
