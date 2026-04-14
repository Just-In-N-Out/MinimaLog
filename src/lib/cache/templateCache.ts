import { getDB } from '@/lib/db/indexedDB';
import { supabase } from '@/integrations/supabase/client';

/**
 * Cache user's workout templates
 */
export const cacheTemplates = async (userId: string): Promise<number> => {
  try {
    const db = await getDB();

    // Fetch user's templates with exercises
    const { data: templates, error } = await supabase
      .from('workout_templates')
      .select(`
        *,
        template_exercises (
          *,
          exercise:exercises (*)
        )
      `)
      .eq('user_id', userId);

    if (error) throw error;

    // Store in IndexedDB
    const tx = db.transaction('templates', 'readwrite');
    for (const tmpl of templates || []) {
      await tx.store.put(tmpl);
    }
    await tx.done;

    console.log('[TemplateCache] Cached templates:', templates?.length);
    return templates?.length || 0;
  } catch (error) {
    console.error('[TemplateCache] Failed to cache templates:', error);
    return 0;
  }
};

/**
 * Get templates from IndexedDB (offline use)
 */
export const getTemplatesOffline = async (userId: string): Promise<any[]> => {
  const db = await getDB();
  const all = await db.getAllFromIndex('templates', 'by-user', userId);
  return all;
};

/**
 * Get a single template with exercises from IndexedDB
 */
export const getTemplateByIdOffline = async (templateId: string): Promise<any | null> => {
  const db = await getDB();
  const template = await db.get('templates', templateId);
  return template || null;
};
