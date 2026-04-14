import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { Lock } from "lucide-react";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [validLink, setValidLink] = useState<boolean | null>(null); // null = checking, true = valid, false = invalid
  const [storedAccessToken, setStoredAccessToken] = useState<string | null>(null); // Store the access token
  const [storedCode, setStoredCode] = useState<string | null>(null); // Store the PKCE code
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (import.meta.env.DEV) console.log("ResetPassword mounted");
    
    // Check for valid reset tokens in URL and STORE them
    const checkResetLink = () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const searchParams = new URLSearchParams(window.location.search);
        
        const accessToken = hashParams.get("access_token");
        const type = hashParams.get("type");
        const code = searchParams.get("code");
        
        if (import.meta.env.DEV) console.log("Detected reset params");
        
        // For password reset, we just need the access_token in the hash with type=recovery
        // OR a PKCE code in the query params
        if ((accessToken && type === "recovery") || code) {
          if (import.meta.env.DEV) console.log("Valid reset link detected");
          
          // STORE the tokens in state so we can use them later
          if (accessToken) {
            setStoredAccessToken(accessToken);
            if (import.meta.env.DEV) console.log("Stored access token");
          }
          if (code) {
            setStoredCode(code);
            if (import.meta.env.DEV) console.log("Stored PKCE code");
          }
          
          setValidLink(true);
          toast({
            title: "Ready to reset",
            description: "Enter your new password below",
          });
          return;
        }
        
        // No valid tokens found
        if (import.meta.env.DEV) console.warn("No valid recovery tokens found in URL");
        setValidLink(false);
        setTimeout(() => {
          toast({
            title: "Invalid reset link",
            description: "Please request a new password reset link from the login page",
            variant: "destructive",
          });
        }, 500);
        
      } catch (e) {
        console.error("Error checking reset link");
        setValidLink(false);
        toast({
          title: "Error",
          description: "Failed to verify reset link",
          variant: "destructive",
        });
      }
    };

    // Small delay to ensure URL is fully loaded
    const timer = setTimeout(checkResetLink, 300);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast({
        title: "Invalid password",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirm) {
      toast({
        title: "Passwords do not match",
        description: "Please confirm your new password",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    if (import.meta.env.DEV) console.log("Starting password update");
    
    try {
      // Use the stored tokens from state (captured on page load)
      let accessToken = storedAccessToken;
      const code = storedCode;
      
      if (import.meta.env.DEV) console.log("Token presence checked");
      
      // If we have a PKCE code, exchange it for a session first
      if (code && !accessToken) {
        if (import.meta.env.DEV) console.log("Exchanging PKCE code for session");
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !data?.session?.access_token) {
          console.error("Failed to exchange code:", error);
          toast({ 
            title: "Invalid reset link", 
            description: "Please request a new password reset link",
            variant: "destructive" 
          });
          setLoading(false);
          return;
        }
        accessToken = data.session.access_token;
        if (import.meta.env.DEV) console.log("Obtained session from code exchange");
      }
      
      if (!accessToken) {
        console.error("No access token available!");
        toast({ 
          title: "Invalid reset link", 
          description: "Please request a new password reset link",
          variant: "destructive" 
        });
        setLoading(false);
        return;
      }
      
      if (import.meta.env.DEV) console.log("Updating password via REST");
      
      // Make direct REST API call to Supabase
      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();
      const apiUrl = `${supabaseUrl}/auth/v1/user`;
      
      if (import.meta.env.DEV) console.log("Calling password update endpoint");
      
      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': apiKey
        },
        body: JSON.stringify({ password })
      });
      
      if (import.meta.env.DEV) console.log("Password update response received");
      
      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error_description || responseData.msg || 'Failed to update password');
      }

      if (import.meta.env.DEV) console.log("Password updated successfully");
      
      // CRITICAL: Clear EVERYTHING and force full app restart
      if (import.meta.env.DEV) console.log("Clearing storage and reloading");
      
      // Clear all localStorage
      localStorage.clear();
      
      // Clear all sessionStorage
      sessionStorage.clear();
      
      // Clear cookies if any
      document.cookie.split(";").forEach((c) => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
      
      toast({ title: "Success!", description: "Password updated! Restarting app..." });
      
      // Force complete page reload after short delay
      setTimeout(() => {
        if (import.meta.env.DEV) console.log("Reloading app");
        // Use location.replace to prevent back button issues
        window.location.replace('/auth');
      }, 1000);
    } catch (err: any) {
      console.error("Password reset error");
      toast({ 
        title: "Error", 
        description: err?.message || "An unexpected error occurred", 
        variant: "destructive" 
      });
    } finally {
      if (import.meta.env.DEV) console.log("Password update complete");
      setLoading(false);
    }
  };

  return (
    <div 
      className="h-full w-full flex flex-col overflow-hidden bg-background"
      onClick={(e) => {
        // Dismiss keyboard when tapping outside input
        if (e.target === e.currentTarget) {
          (document.activeElement as HTMLElement)?.blur?.();
        }
      }}
    >
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-h-full flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            {/* Header section - fixed, not in card */}
            <div className="text-center mb-8 space-y-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
                  <Lock className="h-8 w-8 text-primary-foreground" />
                </div>
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Set New Password</h1>
              <p className="text-base text-muted-foreground">
                Enter and confirm your new password
              </p>
            </div>

            {/* Form card */}
            <Card className="border-2">
              <CardContent className="pt-6 pb-8 px-6">
                {validLink === null && (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Verifying reset link...</p>
                  </div>
                )}
                
                {validLink === false && (
                  <div className="text-center py-8 space-y-4">
                    <p className="text-destructive font-medium">Invalid or expired reset link</p>
                    <p className="text-sm text-muted-foreground">Please request a new password reset link from the login page</p>
                    <Button onClick={() => navigate('/auth')} variant="outline" className="mt-4">
                      Back to Login
                    </Button>
                  </div>
                )}
                
                {validLink === true && (
                  <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label 
                      htmlFor="password" 
                      className="text-base font-medium"
                    >
                      New Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="h-12 text-base"
                      autoComplete="new-password"
                      enterKeyHint="next"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label 
                      htmlFor="confirm" 
                      className="text-base font-medium"
                    >
                      Confirm New Password
                    </Label>
                    <Input
                      id="confirm"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="h-12 text-base"
                      autoComplete="new-password"
                      enterKeyHint="done"
                    />
                  </div>
                  
                  {/* Primary action button */}
                  <div className="pt-2">
                    <Button 
                      type="submit" 
                      className="w-full h-12 text-base font-semibold" 
                      disabled={loading}
                      aria-label={loading ? "Updating password..." : "Update password"}
                    >
                      {loading ? "Updating..." : "Update Password"}
                    </Button>
                  </div>
                </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
