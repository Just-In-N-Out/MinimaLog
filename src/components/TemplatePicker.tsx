import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Search, Dumbbell, Plus } from "lucide-react";

interface Template {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  exercise_count?: number;
}

interface TemplatePickerProps {
  onSelect: (template: Template) => void;
  onCancel: () => void;
}

const TemplatePicker = ({ onSelect, onCancel }: TemplatePickerProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);

  const filteredTemplates = useMemo(() => {
    if (search.trim()) {
      return templates.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase())
      );
    }
    return templates;
  }, [search, templates]);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    if (!user) return;
    try {

      // Single query with nested join for exercise counts
      const { data: templateData } = await supabase
        .from("workout_templates")
        .select(`
          id,
          name,
          notes,
          created_at,
          template_exercises (id)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (templateData) {
        const templatesWithCounts = templateData.map((template: any) => ({
          id: template.id,
          name: template.name,
          notes: template.notes,
          created_at: template.created_at,
          exercise_count: template.template_exercises?.length || 0,
        }));

        setTemplates(templatesWithCounts);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load templates",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Dumbbell className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading templates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="h-10 w-10"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">Choose Template</h1>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-12 text-base"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 space-y-4">
        {filteredTemplates.length === 0 ? (
          <Card className="border-2">
            <CardContent className="py-12 text-center">
              <Dumbbell className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-semibold mb-2">
                {templates.length === 0 ? "No templates yet" : "No templates found"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {templates.length === 0
                  ? "Create your first template during a workout"
                  : "Try a different search term"}
              </p>
              <Button onClick={onCancel} variant="outline">
                Go Back
              </Button>
            </CardContent>
          </Card>
        ) : (
          filteredTemplates.map((template) => (
            <Card
              key={template.id}
              className="border-2 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onSelect(template)}
            >
              <CardHeader>
                <CardTitle className="text-xl">{template.name}</CardTitle>
                {template.notes && (
                  <CardDescription className="text-base">
                    {template.notes}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Dumbbell className="h-4 w-4" />
                  <span>{template.exercise_count} exercises</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
};

export default TemplatePicker;
