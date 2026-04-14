import { useState, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Camera } from "lucide-react";
import { getSupabaseSession } from "@/lib/session";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { CapacitorHttp } from "@capacitor/core";
import { validateFileUpload } from "@/lib/fileValidation";

interface ProfilePictureUploadProps {
  currentAvatarUrl: string | null;
  username: string;
  onUploadSuccess: (newAvatarUrl: string) => void;
  onUploadError: (error: string) => void;
}

export const ProfilePictureUpload = ({
  currentAvatarUrl,
  username,
  onUploadSuccess,
  onUploadError,
}: ProfilePictureUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file using magic byte checking
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    const maxSize = 5 * 1024 * 1024; // 5MB

    const validation = await validateFileUpload(file, {
      allowedTypes: validTypes,
      maxSizeBytes: maxSize,
    });

    if (!validation.isValid) {
      onUploadError(validation.error || "Invalid file");
      return;
    }

    // Upload the file immediately
    await uploadFile(file);
  };

  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Create canvas for compression
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // Calculate new dimensions (max 1024px on longest side)
          const MAX_SIZE = 1024;
          let width = img.width;
          let height = img.height;

          if (width > height && width > MAX_SIZE) {
            height = (height * MAX_SIZE) / width;
            width = MAX_SIZE;
          } else if (height > MAX_SIZE) {
            width = (width * MAX_SIZE) / height;
            height = MAX_SIZE;
          }

          canvas.width = width;
          canvas.height = height;

          // Draw and compress
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob with quality 0.8 for JPEG
          canvas.toBlob(
            (blob) => {
              if (blob) {
                console.log(`Compressed from ${file.size} to ${blob.size} bytes`);
                resolve(blob);
              } else {
                reject(new Error('Failed to compress image'));
              }
            },
            'image/jpeg',
            0.8
          );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const uploadFile = async (file: File) => {
    setUploading(true);

    try {
      const session = await getSupabaseSession();
      if (!session?.user || !session?.access_token) {
        throw new Error("Not authenticated");
      }

      const userId = session.user.id;
      const supabaseUrl = getSupabaseUrl();
      const supabaseAnonKey = getSupabaseAnonKey();

      // Generate filename
      const timestamp = Date.now();
      const fileName = `${userId}/${timestamp}.jpeg`; // Always use JPEG after compression

      console.log("Starting upload process:", fileName);
      console.log("Original file details:", {
        name: file.name,
        size: file.size,
        type: file.type
      });

      // Compress image first
      const compressedBlob = await compressImage(file);
      console.log("Compressed to:", compressedBlob.size, "bytes");

      // Convert compressed blob to base64
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix (data:image/jpeg;base64,)
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(compressedBlob);
      });

      console.log("Converted to base64, length:", base64Data.length);

      // Import supabase client
      const { supabase } = await import("@/integrations/supabase/client");

      // Convert base64 back to Blob for proper upload
      // This ensures the binary data is correct
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const uploadBlob = new Blob([byteArray], { type: 'image/jpeg' });

      console.log("Uploading blob:", uploadBlob.size, "bytes");

      // Use Supabase client to upload
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, uploadBlob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        throw new Error(uploadError.message || "Failed to upload image");
      }

      console.log("Upload successful:", uploadData);

      // Get public URL
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${fileName}`;
      console.log("Public URL:", publicUrl);

      // Update profile using Supabase client
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);

      if (updateError) {
        console.error("Profile update error:", updateError);

        // Try to clean up uploaded file
        await supabase.storage.from("avatars").remove([fileName]);

        throw new Error(updateError.message || "Failed to update profile");
      }

      console.log("Profile updated successfully");
      onUploadSuccess(publicUrl);
    } catch (error) {
      console.error("Upload error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to upload image";
      onUploadError(errorMessage);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleAvatarClick = () => {
    if (!uploading) {
      fileInputRef.current?.click();
    }
  };

  const fallbackInitial = username?.charAt(0).toUpperCase() || "U";

  const avatarSrc = currentAvatarUrl;

  return (
    <div className="relative inline-block">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />

      <button
        type="button"
        onClick={handleAvatarClick}
        disabled={uploading}
        className="relative group cursor-pointer disabled:cursor-not-allowed"
      >
        <Avatar className="h-24 w-24">
          {avatarSrc && <AvatarImage src={avatarSrc} alt={username} cacheKey={currentAvatarUrl} />}
          <AvatarFallback className="text-3xl">{fallbackInitial}</AvatarFallback>
        </Avatar>

        {/* Camera badge indicator */}
        <div className="absolute bottom-0 left-0 bg-primary text-primary-foreground rounded-full p-2 shadow-lg">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
        </div>

        {/* Overlay on hover */}
        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-sm font-medium">Change</span>
        </div>
      </button>
    </div>
  );
};
