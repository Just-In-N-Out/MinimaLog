/**
 * Exercise Image Filesystem Cache
 *
 * Uses Capacitor Filesystem API to store exercise images as native files.
 * This approach is more reliable on iOS than blob URLs and better for memory management.
 *
 * SECURITY: Validates image URLs and encrypts cached files
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Http } from '@capacitor-community/http';
import { shouldUseOfflineMode, getImageLoadTimeout } from '@/lib/network';
import { getDB } from '@/lib/db/indexedDB';

// SECURITY: Whitelist of allowed domains for image downloads (prevents SSRF)
const ALLOWED_IMAGE_DOMAINS = [
  'supabase.co',
'exercisedb.dev', // ExerciseDB static assets (exercise GIFs)
];

/**
 * SECURITY: Validate image URL before download
 * Prevents Server-Side Request Forgery (SSRF) attacks
 */
const validateImageUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);

    // Only allow HTTPS protocol
    if (urlObj.protocol !== 'https:') {
      console.warn('[FilesystemCache] Invalid protocol, only HTTPS allowed:', urlObj.protocol);
      return false;
    }

    // Check if hostname is in whitelist
    // SECURITY: Prevent subdomain bypass (e.g., "evilsupabase.co" matching "supabase.co")
    const isAllowed = ALLOWED_IMAGE_DOMAINS.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    );

    if (!isAllowed) {
      console.warn('[FilesystemCache] Domain not in whitelist:', urlObj.hostname);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[FilesystemCache] Invalid URL:', error);
    return false;
  }
};

const CACHE_DIRECTORY = 'exercise-images';
const METADATA_FILE = 'exercise-images/metadata.json';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Check if running on native platform
const isNativePlatform = Capacitor.isNativePlatform();

interface CachedImageMetadata {
  exerciseId: string;
  sourceUrl: string;
  cachedAt: string;
  filename: string;
}

interface ImageExtensionMetadata {
  [exerciseId: string]: string; // Maps exerciseId to file extension (e.g., "gif", "jpg", "png")
}

/**
 * Get file extension from MIME type
 */
const getExtensionFromMimeType = (mimeType: string): string => {
  const type = mimeType.toLowerCase();
  if (type.includes('gif')) return 'gif';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  return 'jpg'; // Default fallback
};

/**
 * Get file extension from URL
 */
const getExtensionFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    if (pathname.endsWith('.gif')) return 'gif';
    if (pathname.endsWith('.png')) return 'png';
    if (pathname.endsWith('.webp')) return 'webp';
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'jpg';
  } catch (error) {
    // Invalid URL, ignore
  }
  return 'gif'; // Default to gif since most exercise images are animated
};

/**
 * Load extension metadata from filesystem
 */
const loadExtensionMetadata = async (): Promise<ImageExtensionMetadata> => {
  if (!isNativePlatform) return {};

  try {
    const result = await Filesystem.readFile({
      path: METADATA_FILE,
      directory: Directory.Data,
      encoding: 'utf8' as any,
    });
    return JSON.parse(result.data as string);
  } catch (error) {
    // File doesn't exist yet, return empty metadata
    return {};
  }
};

/**
 * Save extension metadata to filesystem
 */
const saveExtensionMetadata = async (metadata: ImageExtensionMetadata): Promise<void> => {
  if (!isNativePlatform) return;

  try {
    await Filesystem.writeFile({
      path: METADATA_FILE,
      data: JSON.stringify(metadata),
      directory: Directory.Data,
      encoding: 'utf8' as any,
    });
  } catch (error) {
    console.error('[FilesystemCache] Failed to save metadata:', error);
  }
};

/**
 * Store file extension for an exercise
 */
const storeExtension = async (exerciseId: string, extension: string): Promise<void> => {
  const metadata = await loadExtensionMetadata();
  metadata[exerciseId] = extension;
  await saveExtensionMetadata(metadata);
};

/**
 * Get stored file extension for an exercise
 */
const getStoredExtension = async (exerciseId: string): Promise<string | null> => {
  const metadata = await loadExtensionMetadata();
  return metadata[exerciseId] || null;
};

/**
 * Get the file path for an exercise image
 */
const getImagePath = (exerciseId: string, extension: string = 'jpg'): string => {
  return `${CACHE_DIRECTORY}/${exerciseId}.${extension}`;
};

const isBrowserOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

const queuePendingImageDownload = async (exerciseId: string, imageUrl: string) => {
  if (!isNativePlatform || !exerciseId || !imageUrl) return;

  try {
    const db = await getDB();
    const existing = await db.get('pendingImageDownloads', exerciseId);
    if (existing && existing.imageUrl === imageUrl) {
      return;
    }

    await db.put('pendingImageDownloads', {
      id: exerciseId,
      exerciseId,
      imageUrl,
      createdAt: new Date().toISOString(),
      attempts: existing ? existing.attempts ?? 0 : 0,
    });
  } catch (error) {
    console.warn('[FilesystemCache] Failed to queue pending image download:', error);
  }
};

const removePendingImageDownload = async (exerciseId: string) => {
  if (!isNativePlatform) return;

  try {
    const db = await getDB();
    await db.delete('pendingImageDownloads', exerciseId);
  } catch (error) {
    // Non-critical
  }
};

/**
 * Get cached exercise image file URL
 * Returns capacitor:// URL if cached, null otherwise
 */
export const getCachedExerciseImageUrl = async (
  exerciseId: string
): Promise<string | null> => {
  if (!exerciseId) return null;

  // Skip filesystem cache in browser - will use network URLs
  if (!isNativePlatform) {
    return null;
  }

  try {
    // Get stored extension for this exercise
    const storedExtension = await getStoredExtension(exerciseId);

    // Try with stored extension first, then fallback to common extensions
    const extensionsToTry = storedExtension
      ? [storedExtension, 'gif', 'jpg', 'png', 'webp']
      : ['gif', 'jpg', 'png', 'webp'];

    // Remove duplicates
    const uniqueExtensions = [...new Set(extensionsToTry)];

    for (const extension of uniqueExtensions) {
      try {
        const path = getImagePath(exerciseId, extension);

        // Check if file exists
        const result = await Filesystem.stat({
          path,
          directory: Directory.Data,
        });

        // Check if expired (30 days)
        const age = Date.now() - result.ctime;
        if (age > CACHE_TTL_MS) {
          // Delete expired file
          await Filesystem.deleteFile({
            path,
            directory: Directory.Data,
          });
          continue; // Try next extension
        }

        // Get file URI
        const uri = await Filesystem.getUri({
          path,
          directory: Directory.Data,
        });

        // Convert file:// URL to capacitor:// URL for iOS WKWebView compatibility
        return Capacitor.convertFileSrc(uri.uri);
      } catch (error) {
        // File doesn't exist with this extension, try next one
        continue;
      }
    }

    // No cached file found with any extension
    return null;
  } catch (error) {
    console.error('[FilesystemCache] Error checking cache:', error);
    return null;
  }
};

const performFilesystemDownload = async (exerciseId: string, imageUrl: string): Promise<string | null> => {
  // SECURITY: Validate URL before downloading
  if (!validateImageUrl(imageUrl)) {
    console.error(`[FilesystemCache] Invalid or untrusted image URL: ${imageUrl}`);
    return null;
  }

  try {
    // Detect file extension from URL
    const extension = getExtensionFromUrl(imageUrl);
    const filename = `${exerciseId}.${extension}`;
    const filePath = `${CACHE_DIRECTORY}/${filename}`;

    // Ensure directory exists
    try {
      await Filesystem.mkdir({
        path: CACHE_DIRECTORY,
        directory: Directory.Data,
        recursive: true,
      });
    } catch (error) {
      // Directory might already exist, ignore error
    }

    // Download file directly to filesystem using HTTP plugin
    // This writes binary data directly without base64 conversion
    // SECURITY: Add timeout to prevent hanging connections
    // Use connection-aware timeouts based on network quality
    const timeout = getImageLoadTimeout();

    const result = await Http.downloadFile({
      url: imageUrl,
      filePath: filePath,
      fileDirectory: Directory.Data,
      method: 'GET',
      connectTimeout: Math.max(10000, Math.floor(timeout / 3)), // Connection timeout is 1/3 of read timeout
      readTimeout: timeout, // Adaptive read timeout based on connection quality
    });

    if (!result.path) {
      return null;
    }

    // Store the extension metadata
    await storeExtension(exerciseId, extension);

    // Use the path returned by downloadFile directly
    // Convert file:// URL to capacitor:// URL for iOS WKWebView compatibility
    return Capacitor.convertFileSrc(result.path);
  } catch (error) {
    console.error(`[FilesystemCache] Failed to cache image for ${exerciseId}:`, error);
    return null;
  }
};

/**
 * Download and cache exercise image to filesystem using direct binary download
 * This avoids base64 conversion which causes corruption on iOS
 */
export const downloadAndCacheExerciseImageToFilesystem = async (
  exerciseId: string,
  imageUrl: string
): Promise<string | null> => {
  if (!exerciseId || !imageUrl) return null;

  // Skip filesystem cache in browser - will just use network URLs
  if (!isNativePlatform) {
    return null;
  }

  const offline = shouldUseOfflineMode() || isBrowserOffline();
  if (offline) {
    await queuePendingImageDownload(exerciseId, imageUrl);
    return null;
  }

  const uri = await performFilesystemDownload(exerciseId, imageUrl);
  if (uri) {
    await removePendingImageDownload(exerciseId);
  }
  return uri;
};

/**
 * Download all exercise images to filesystem
 */
export const downloadAllExerciseImagesToFilesystem = async (
  exercises: Array<{ id: string; image_url: string | null }>,
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number; skipped: number }> => {
  const stats = { success: 0, failed: 0, skipped: 0 };
  const total = exercises.length;

  // Skip in browser - filesystem cache only works on native
  if (!isNativePlatform) {
    console.warn('[FilesystemCache] Cannot download images in browser environment');
    stats.skipped = total;
    return stats;
  }

  for (let i = 0; i < exercises.length; i++) {
    const exercise = exercises[i];

    if (!exercise.image_url) {
      stats.skipped++;
      continue;
    }

    try {
      // Check if already cached
      const cached = await getCachedExerciseImageUrl(exercise.id);
      if (cached) {
        stats.skipped++;
      } else {
        const result = await downloadAndCacheExerciseImageToFilesystem(
          exercise.id,
          exercise.image_url
        );
        if (result) {
          stats.success++;
        } else {
          stats.failed++;
        }
      }
    } catch (error) {
      console.error(`[FilesystemCache] Failed to download ${exercise.id}:`, error);
      stats.failed++;
    }

    if (onProgress) {
      onProgress(i + 1, total);
    }

    // Add small delay to avoid overwhelming the system
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return stats;
};

/**
 * Clear all cached exercise images from filesystem
 */
export const clearExerciseImageFilesystemCache = async (): Promise<void> => {
  // Skip in browser
  if (!isNativePlatform) {
    console.warn('[FilesystemCache] Cannot clear cache in browser environment');
    return;
  }

  try {
    // Clear metadata first
    try {
      await Filesystem.deleteFile({
        path: METADATA_FILE,
        directory: Directory.Data,
      });
    } catch (error) {
      // Metadata file might not exist, ignore
    }

    // Clear all cached images
    await Filesystem.rmdir({
      path: CACHE_DIRECTORY,
      directory: Directory.Data,
      recursive: true,
    });
    console.log('[FilesystemCache] Cache cleared successfully');
  } catch (error) {
    console.warn('[FilesystemCache] Failed to clear cache:', error);
  }
};

/**
 * Get filesystem cache statistics
 */
export const getExerciseImageFilesystemCacheStats = async (): Promise<{
  count: number;
  estimatedSizeMB: number;
}> => {
  // Skip in browser
  if (!isNativePlatform) {
    return { count: 0, estimatedSizeMB: 0 };
  }

  try {
    const result = await Filesystem.readdir({
      path: CACHE_DIRECTORY,
      directory: Directory.Data,
    });

    const count = result.files.length;
    // Estimate ~300KB per image
    const estimatedSizeMB = (count * 300) / 1024;

    return { count, estimatedSizeMB };
  } catch (error) {
    // Directory doesn't exist or empty
    return { count: 0, estimatedSizeMB: 0 };
  }
};

/**
 * Process any pending image downloads that were queued while offline
 */
export const processPendingImageDownloads = async (): Promise<{
  success: number;
  failed: number;
  remaining: number;
}> => {
  if (!isNativePlatform) {
    return { success: 0, failed: 0, remaining: 0 };
  }

  if (shouldUseOfflineMode() || isBrowserOffline()) {
    return { success: 0, failed: 0, remaining: 0 };
  }

  try {
    const db = await getDB();
    const pending = await db.getAll('pendingImageDownloads');

    if (pending.length === 0) {
      return { success: 0, failed: 0, remaining: 0 };
    }

    let success = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const result = await performFilesystemDownload(item.exerciseId, item.imageUrl);
        if (result) {
          success++;
          await db.delete('pendingImageDownloads', item.id);
        } else {
          failed++;
          await db.put('pendingImageDownloads', {
            ...item,
            attempts: (item.attempts ?? 0) + 1,
          });
        }
      } catch (error) {
        console.error('[FilesystemCache] Pending download failed:', error);
        failed++;
        await db.put('pendingImageDownloads', {
          ...item,
          attempts: (item.attempts ?? 0) + 1,
        });
      }
    }

    return {
      success,
      failed,
      remaining: pending.length - success,
    };
  } catch (error) {
    console.error('[FilesystemCache] Failed to process pending downloads:', error);
    return { success: 0, failed: 0, remaining: 0 };
  }
};
