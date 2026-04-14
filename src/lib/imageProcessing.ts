/**
 * Image Processing Utilities
 * Handles downloading, converting, and uploading exercise images
 */

import { supabase } from '@/integrations/supabase/client';

/**
 * Download an image from a URL and return as Blob
 */
export async function downloadImageAsBlob(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download image from ${imageUrl}: ${response.statusText}`);
  }

  return await response.blob();
}

/**
 * Extract first frame from GIF and convert to static image
 * For now, we'll just use the GIF as-is since browser support is good
 * In the future, this could be enhanced to extract the first frame
 */
export async function extractFirstFrameFromGif(gifBlob: Blob): Promise<Blob> {
  // For now, return the GIF as-is
  // Browsers handle GIFs well, and extracting frames would require additional libraries
  return gifBlob;
}

/**
 * Upload image to Supabase Storage
 * Returns the public URL of the uploaded image
 */
export async function uploadExerciseImage(
  exerciseId: string,
  imageBlob: Blob,
  isCustom: boolean = false
): Promise<string> {
  const fileExtension = imageBlob.type.split('/')[1] || 'gif';
  const fileName = `${exerciseId}.${fileExtension}`;
  const filePath = isCustom ? `custom/${fileName}` : `exercisedb/${fileName}`;

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('exercise-images')
    .upload(filePath, imageBlob, {
      contentType: imageBlob.type,
      upsert: true, // Overwrite if exists
    });

  if (error) {
    throw new Error(`Failed to upload image: ${error.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('exercise-images')
    .getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Download and upload an exercise image from ExerciseDB
 * Returns the Supabase Storage public URL
 */
export async function processExerciseImage(
  exerciseId: string,
  gifUrl: string
): Promise<string> {
  try {
    // Download the GIF
    const imageBlob = await downloadImageAsBlob(gifUrl);

    // Extract first frame (or just use GIF as-is for now)
    const processedBlob = await extractFirstFrameFromGif(imageBlob);

    // Upload to Supabase Storage
    const publicUrl = await uploadExerciseImage(exerciseId, processedBlob, false);

    return publicUrl;
  } catch (error) {
    console.error(`Failed to process image for exercise ${exerciseId}:`, error);
    throw error;
  }
}

/**
 * Batch process multiple exercise images
 * Processes in batches to avoid overwhelming the system
 */
export async function batchProcessImages(
  exercises: Array<{ exerciseId: string; gifUrl: string }>,
  batchSize: number = 5,
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const total = exercises.length;

  for (let i = 0; i < exercises.length; i += batchSize) {
    const batch = exercises.slice(i, i + batchSize);

    const batchPromises = batch.map(async (exercise) => {
      try {
        const url = await processExerciseImage(exercise.exerciseId, exercise.gifUrl);
        return { exerciseId: exercise.exerciseId, url };
      } catch (error) {
        console.error(`Failed to process image for ${exercise.exerciseId}:`, error);
        return { exerciseId: exercise.exerciseId, url: exercise.gifUrl }; // Fallback to original URL
      }
    });

    const batchResults = await Promise.all(batchPromises);

    batchResults.forEach(result => {
      results.set(result.exerciseId, result.url);
    });

    if (onProgress) {
      onProgress(results.size, total);
    }

    console.log(`Processed ${results.size}/${total} images...`);

    // Small delay between batches
    if (i + batchSize < exercises.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Upload a custom exercise image from user's device
 */
export async function uploadCustomExerciseImage(
  exerciseId: string,
  file: File
): Promise<string> {
  // Validate file type
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (!validTypes.includes(file.type)) {
    throw new Error('Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.');
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024; // 5MB in bytes
  if (file.size > maxSize) {
    throw new Error('File size too large. Please upload an image smaller than 5MB.');
  }

  // Upload to Supabase Storage
  const publicUrl = await uploadExerciseImage(exerciseId, file, true);

  return publicUrl;
}

/**
 * Delete an exercise image from storage
 */
export async function deleteExerciseImage(imageUrl: string): Promise<void> {
  // Extract file path from public URL
  const urlParts = imageUrl.split('/exercise-images/');
  if (urlParts.length < 2) {
    throw new Error('Invalid image URL');
  }

  const filePath = urlParts[1];

  const { error } = await supabase.storage
    .from('exercise-images')
    .remove([filePath]);

  if (error) {
    throw new Error(`Failed to delete image: ${error.message}`);
  }
}
