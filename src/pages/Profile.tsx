import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/queries/useFeed";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { User, LogOut, Settings } from "lucide-react";
import { signOut } from "@/lib/supabase";

const Profile = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);
  const queryClient = useQueryClient();
  const loading = authLoading || profileLoading;
  const [bodyweight, setBodyweight] = useState("");

  useEffect(() => {
    if (profile?.bodyweight) {
      setBodyweight(profile.bodyweight.toString());
    }
  }, [profile]);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Signed out",
        description: "You've been signed out successfully",
      });
      navigate("/auth");
    }
  };

  const toggleUnit = async (unit: "kg" | "lb") => {
    if (!user) return;
    try {

      const { error } = await supabase
        .from("profiles")
        .update({ unit_default: unit })
        .eq("id", user.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });

      toast({
        title: "Updated",
        description: `Default unit set to ${unit}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update unit preference",
        variant: "destructive",
      });
    }
  };

  const handleSaveBodyweight = async () => {
    if (!bodyweight || !user) return;

    try {

      const { error } = await supabase
        .from("profiles")
        .update({ bodyweight: parseFloat(bodyweight) })
        .eq("id", user.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
      toast({
        title: "Updated",
        description: "Bodyweight saved",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to save bodyweight",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <User className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
            <User className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Profile</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-xl">Account</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm text-muted-foreground">Name</Label>
              <p className="text-lg font-semibold">{profile?.name || "Not set"}</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Email</Label>
              <p className="text-lg font-semibold">{profile?.email}</p>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Member since</Label>
              <p className="text-lg font-semibold">
                {new Date(profile?.created_at).toLocaleDateString()}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Settings
            </CardTitle>
            <CardDescription>Customize your experience</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label className="text-base">Default Unit</Label>
              <div className="flex gap-2">
                <Button
                  variant={profile?.unit_default === "kg" ? "default" : "outline"}
                  onClick={() => toggleUnit("kg")}
                  className="flex-1 h-12"
                >
                  Kilograms (kg)
                </Button>
                <Button
                  variant={profile?.unit_default === "lb" ? "default" : "outline"}
                  onClick={() => toggleUnit("lb")}
                  className="flex-1 h-12"
                >
                  Pounds (lb)
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="bodyweight" className="text-base">
                Current Bodyweight (optional)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="bodyweight"
                  type="number"
                  step="0.1"
                  value={bodyweight}
                  onChange={(e) => setBodyweight(e.target.value)}
                  onBlur={handleSaveBodyweight}
                  placeholder="70.5"
                  className="h-12 text-base"
                />
                <div className="px-4 h-12 flex items-center justify-center bg-muted rounded-md font-semibold">
                  {profile?.unit_default || "kg"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Track your bodyweight over time
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardContent className="pt-6">
            <Button
              variant="outline"
              onClick={handleSignOut}
              className="w-full h-12 text-base"
            >
              <LogOut className="h-5 w-5 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Profile;
