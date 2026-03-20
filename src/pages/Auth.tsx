import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { signUp, signIn, getCurrentUser } from "@/lib/supabase";
import { supabase } from "@/integrations/supabase/client";
import { Dumbbell } from "lucide-react";

const Auth = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Check if user is already authenticated
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (user) {
        navigate("/");
      }
    };
    checkAuth();
  }, [navigate]);

  const validateForm = () => {
    if (!email || !password) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return false;
    }

    if (isSignUp) {
      if (!name || !birthYear || !ageConfirmed) {
        toast({
          title: "Missing fields",
          description: "Please complete all signup requirements",
          variant: "destructive",
        });
        return false;
      }

      const year = parseInt(birthYear);
      const currentYear = new Date().getFullYear();
      const age = currentYear - year;

      if (age < 16) {
        toast({
          title: "Age requirement",
          description: "You must be at least 16 years old to use this app",
          variant: "destructive",
        });
        return false;
      }

      if (year < 1900 || year > currentYear - 16) {
        toast({
          title: "Invalid birth year",
          description: "Please enter a valid birth year",
          variant: "destructive",
        });
        return false;
      }
    }

    return true;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await signUp(email, password, name, parseInt(birthYear));
        
        if (error) {
          if (error.message.includes("already registered")) {
            toast({
              title: "Account exists",
              description: "This email is already registered. Please sign in instead.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Signup failed",
              description: error.message,
              variant: "destructive",
            });
          }
        } else if (data.user) {
          // Save onboarding data if it exists
          const onboardingData = localStorage.getItem("onboarding_data");
          if (onboardingData) {
            const prefs = JSON.parse(onboardingData);
            await supabase
              .from("profiles" as any)
              .update({
                onboarding_completed: true,
                vibe: prefs.vibe,
                goal: prefs.goal,
                tracking_style: prefs.tracking_style
              })
              .eq("id", data.user.id);
            localStorage.removeItem("onboarding_data");
          }
          
          toast({
            title: "Welcome!",
            description: "Your account has been created successfully",
          });
          navigate("/");
        }
      } else {
        // Sign in
        const { data, error } = await signIn(email, password);
        
        if (error) {
          if (error.message.includes("Invalid login credentials")) {
            toast({
              title: "Invalid credentials",
              description: "The email or password you entered is incorrect. Please try again.",
              variant: "destructive",
            });
          } else if (error.message.includes("Email not confirmed")) {
            toast({
              title: "Email not confirmed",
              description: "Please check your email and confirm your account before signing in.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Sign in failed",
              description: error.message,
              variant: "destructive",
            });
          }
        } else if (data.user) {
          toast({
            title: "Welcome back!",
            description: "You have successfully signed in",
          });
          navigate("/");
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md border-2">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
              <Dumbbell className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold">myweightforme</CardTitle>
          <CardDescription className="text-base">
            {isSignUp ? "Create your account" : "Sign in to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    required={isSignUp}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="birthYear">Birth Year</Label>
                  <Input
                    id="birthYear"
                    type="number"
                    value={birthYear}
                    onChange={(e) => setBirthYear(e.target.value)}
                    placeholder="YYYY"
                    min="1900"
                    max={new Date().getFullYear() - 16}
                    required={isSignUp}
                    className="h-12"
                  />
                </div>
                <div className="flex items-start space-x-3 py-2">
                  <Checkbox
                    id="ageConfirm"
                    checked={ageConfirmed}
                    onCheckedChange={(checked) => setAgeConfirmed(checked as boolean)}
                    required={isSignUp}
                  />
                  <Label 
                    htmlFor="ageConfirm" 
                    className="text-sm leading-relaxed cursor-pointer"
                  >
                    I confirm that I am 16 years of age or older
                  </Label>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="h-12"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="h-12"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full h-12 text-base font-semibold" 
              disabled={loading}
            >
              {loading ? "Please wait..." : (isSignUp ? "Create Account" : "Sign In")}
            </Button>
          </form>
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setAgeConfirmed(false);
                setBirthYear("");
                setName("");
              }}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              {isSignUp 
                ? "Already have an account? Sign in" 
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
