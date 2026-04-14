import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession, getCachedUserId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Search, Dumbbell, Plus, Trash2 } from "lucide-react";
import { shouldUseOfflineMode } from "@/lib/network";
import { getTemplatesOffline, cacheTemplates } from "@/lib/cache/templateCache";
import { getDB } from "@/lib/db/indexedDB";
import { queueOperation } from "@/lib/db/operationQueue";

interface Template {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  exercise_count?: number;
}

export type TemplateSummary = Template;

interface TemplatePickerProps {
  onSelect: (template: Template) => void;
  onCancel: () => void;
}

const TemplatePicker = ({ onSelect, onCancel }: TemplatePickerProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<Template[]>([]);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    if (search.trim()) {
      const filtered = templates.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase())
      );
      setFilteredTemplates(filtered);
    } else {
      setFilteredTemplates(templates);
    }
  }, [search, templates]);

  const hydrateFromCache = async (userId: string, showEmptyToast: boolean) => {
    const cachedTemplates = await getTemplatesOffline(userId);

    const templatesWithCounts = cachedTemplates.map((template: any) => ({
      id: template.id,
      name: template.name,
      notes: template.notes,
      created_at: template.created_at,
      exercise_count: template.template_exercises?.length || 0,
    }));

    setTemplates(templatesWithCounts);
    setFilteredTemplates(templatesWithCounts);

    if (templatesWithCounts.length === 0 && showEmptyToast) {
      toast({
        title: "No templates available",
        description: "Create templates online first so they're cached for offline use.",
      });
    } else if (templatesWithCounts.length > 0) {
      console.log(`[TemplatePicker] Loaded ${templatesWithCounts.length} cached templates`);
    }

    return templatesWithCounts.length;
  };

  const loadTemplates = async () => {
    try {
      const session = await getSupabaseSession();
      const useOffline = shouldUseOfflineMode();

      let userId = session?.user?.id ?? null;
      const accessToken = session?.access_token ?? null;

      if (!userId && useOffline) {
        userId = await getCachedUserId();
      }

      if (!userId) {
        toast({
          title: "Sign in required",
          description: "Please sign in online once to load your templates.",
          variant: "destructive",
        });
        setTemplates([]);
        setFilteredTemplates([]);
        return;
      }

      if (useOffline || !accessToken) {
        console.log('[TemplatePicker] Offline mode detected, loading cached templates');
        await hydrateFromCache(userId, true);
      } else {
        // ONLINE: Load from Supabase
        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();

        // Load templates via REST API
        const templateResponse = await fetch(`${supabaseUrl}/rest/v1/workout_templates?user_id=eq.${userId}&select=*&order=created_at.desc`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': apiKey
          }
        });
        const templateData = await templateResponse.json();

        if (templateData) {
          // Get exercise count for each template
          const templatesWithCounts = await Promise.all(
            templateData.map(async (template: any) => {
              const exerciseResponse = await fetch(`${supabaseUrl}/rest/v1/template_exercises?template_id=eq.${template.id}&select=id`, {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'apikey': apiKey
                }
              });
              const exercises = await exerciseResponse.json();

              return {
                ...template,
                exercise_count: exercises?.length || 0,
              };
            })
          );

          setTemplates(templatesWithCounts);
          setFilteredTemplates(templatesWithCounts);

          // Cache templates for offline use (synchronous to ensure completion)
          try {
            await cacheTemplates(userId);
            console.log(`[TemplatePicker] Successfully cached ${templatesWithCounts.length} templates for offline use`);
          } catch (err) {
            console.warn('[TemplatePicker] Failed to cache templates:', err);
            // Don't fail the whole operation if caching fails
          }
        }
      }
    } catch (error: any) {
      console.error('[TemplatePicker] Failed to load templates:', error);

      // Fallback to offline cache on error
      try {
        const session = await getSupabaseSession();
        const cachedUserId = session?.user?.id ?? (await getCachedUserId());
        if (cachedUserId) {
          await hydrateFromCache(cachedUserId, false);

          toast({
            title: "Offline mode",
            description: "Showing cached templates",
          });
        }
      } catch (fallbackError) {
        toast({
          title: "Error",
          description: "Failed to load templates",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!templateToDelete) return;

    setIsDeleting(true);
    try {
      const session = await getSupabaseSession();
      const useOffline = shouldUseOfflineMode();

      let userId = session?.user?.id ?? null;
      const accessToken = session?.access_token ?? null;

      if (!userId && useOffline) {
        userId = await getCachedUserId();
      }

      if (!userId) {
        toast({
          title: "Sign in required",
          description: "Please sign in to delete templates.",
          variant: "destructive",
        });
        return;
      }

      if (useOffline || !accessToken) {
        // OFFLINE: Queue the deletion
        console.log('[TemplatePicker] Deleting template offline:', templateToDelete.id);

        await queueOperation({
          type: 'delete',
          table: 'workout_templates',
          data: { id: templateToDelete.id },
          timestamp: new Date().toISOString(),
          userId,
        });

        // Remove from IndexedDB cache
        const db = await getDB();
        await db.delete('templates', templateToDelete.id);

        toast({
          title: "Template deleted",
          description: `"${templateToDelete.name}" will be deleted when you're back online.`,
        });
      } else {
        // ONLINE: Delete from Supabase (CASCADE will delete template_exercises)
        const { error } = await supabase
          .from('workout_templates')
          .delete()
          .eq('id', templateToDelete.id)
          .eq('user_id', userId);

        if (error) throw error;

        // Remove from IndexedDB cache
        try {
          const db = await getDB();
          await db.delete('templates', templateToDelete.id);
        } catch (cacheError) {
          console.warn('[TemplatePicker] Failed to remove from cache:', cacheError);
        }

        toast({
          title: "Template deleted",
          description: `"${templateToDelete.name}" has been deleted.`,
        });
      }

      // Remove from local state
      setTemplates((prev) => prev.filter((t) => t.id !== templateToDelete.id));
      setFilteredTemplates((prev) => prev.filter((t) => t.id !== templateToDelete.id));
      setTemplateToDelete(null);
    } catch (error: any) {
      console.error('[TemplatePicker] Failed to delete template:', error);
      toast({
        title: "Error",
        description: "Failed to delete template. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
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
    <div className="min-h-screen bg-background pb-[calc(24px+env(safe-area-inset-bottom))] flex flex-col">
      {/* Header */}
      <header
        className="border-b sticky top-0 bg-background z-10"
        style={{ paddingTop: `max(env(safe-area-inset-top, 0px) + 0.75rem, 2.75rem)` }}
      >
        <div className="container mx-auto px-4 pb-4">
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
      <div className="flex-1 overflow-y-auto">
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
                className="border-2 hover:bg-muted/50 transition-colors relative"
              >
                <div
                  className="cursor-pointer"
                  onClick={() => onSelect(template)}
                >
                  <CardHeader>
                    <CardTitle className="text-xl pr-10">{template.name}</CardTitle>
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
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-4 right-4 h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTemplateToDelete(template);
                  }}
                  aria-label="Delete template"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            ))
          )}
        </main>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!templateToDelete} onOpenChange={(open) => !open && setTemplateToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{templateToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTemplate}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TemplatePicker;
