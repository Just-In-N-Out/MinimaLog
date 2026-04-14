import { useState, useRef } from "react";
import { Camera, Trash2, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface PostImageUploadProps {
  postId?: string;
  userId: string;
  existingImages?: string[];
  onImagesChange: (imageUrls: string[]) => void;
  onFilesChange?: (files: File[]) => void; // New prop for passing files before upload
  maxImages?: number;
}

export const PostImageUpload = ({
  postId,
  userId,
  existingImages = [],
  onImagesChange,
  onFilesChange,
  maxImages = 5,
}: PostImageUploadProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>(existingImages);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          const MAX_SIZE = 1920;
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
          ctx.drawImage(img, 0, 0, width, height);

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
            0.85
          );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (previewImages.length + files.length > maxImages) {
      toast({
        title: "Too many images",
        description: `You can only upload up to ${maxImages} images per post.`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      const validFiles: File[] = [];
      const newPreviews: string[] = [];

      for (const file of files) {
        // Validate file type
        if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
          toast({
            title: "Invalid file type",
            description: `${file.name} is not a supported image format. Please use JPEG, PNG, or WebP.`,
            variant: "destructive",
          });
          continue;
        }

        // Validate file size (10MB)
        if (file.size > 10485760) {
          toast({
            title: "File too large",
            description: `${file.name} is larger than 10MB. Please choose a smaller image.`,
            variant: "destructive",
          });
          continue;
        }

        // Compress image
        const compressedBlob = await compressImage(file);

        // Convert compressed blob to File object
        const compressedFile = new File([compressedBlob], file.name, { type: 'image/jpeg' });
        validFiles.push(compressedFile);

        // Create preview URL
        const previewUrl = URL.createObjectURL(compressedBlob);
        newPreviews.push(previewUrl);
      }

      const updatedPreviews = [...previewImages, ...newPreviews];
      const updatedFiles = [...selectedFiles, ...validFiles];

      setPreviewImages(updatedPreviews);
      setSelectedFiles(updatedFiles);

      // If we have a postId, upload immediately (edit mode)
      if (postId) {
        await uploadFiles(validFiles, updatedPreviews);
      } else {
        // Otherwise just pass files to parent for later upload
        if (onFilesChange) {
          onFilesChange(updatedFiles);
        }
      }

      toast({
        title: postId ? "Images uploaded" : "Images added",
        description: postId
          ? `Successfully uploaded ${validFiles.length} image${validFiles.length > 1 ? 's' : ''}.`
          : `Added ${validFiles.length} image${validFiles.length > 1 ? 's' : ''}. They will be uploaded when you share.`,
      });
    } catch (error: any) {
      console.error("Image processing error:", error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to process images. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const uploadFiles = async (files: File[], previews: string[]) => {
    const uploadedUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Convert to base64 for upload
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      // Convert base64 to Blob for upload
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let j = 0; j < byteCharacters.length; j++) {
        byteNumbers[j] = byteCharacters.charCodeAt(j);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const uploadBlob = new Blob([byteArray], { type: 'image/jpeg' });

      // Generate unique filename
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const fileName = `${userId}/${postId}/${timestamp}-${randomSuffix}.jpeg`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("post-images")
        .upload(fileName, uploadBlob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        throw uploadError;
      }

      // Get public URL
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/post-images/${fileName}`;
      uploadedUrls.push(publicUrl);
    }

    onImagesChange([...existingImages, ...uploadedUrls]);
  };

  const handleRemoveImage = async (imageUrl: string, index: number) => {
    try {
      // If it's a blob URL (not uploaded yet), just remove locally
      if (imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageUrl);
        const newPreviews = previewImages.filter((_, i) => i !== index);
        const newFiles = selectedFiles.filter((_, i) => i !== index);
        setPreviewImages(newPreviews);
        setSelectedFiles(newFiles);
        if (onFilesChange) {
          onFilesChange(newFiles);
        }
      } else {
        // It's an uploaded image, delete from storage
        const urlParts = imageUrl.split('/post-images/');
        if (urlParts.length === 2) {
          const fileName = urlParts[1];

          const { error } = await supabase.storage
            .from("post-images")
            .remove([fileName]);

          if (error) {
            console.error("Delete error:", error);
            throw error;
          }
        }

        const newImages = previewImages.filter((_, i) => i !== index);
        setPreviewImages(newImages);
        onImagesChange(newImages);
      }

      toast({
        title: "Image removed",
        description: "Image has been deleted successfully.",
      });
    } catch (error: any) {
      console.error("Image delete error:", error);
      toast({
        title: "Delete failed",
        description: error.message || "Failed to delete image. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {previewImages.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full aspect-video rounded-lg border-2 border-dashed border-primary/60 bg-background hover:bg-muted/50 transition-colors flex flex-col items-center justify-center gap-3 disabled:opacity-50"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
              <span className="text-lg font-semibold text-primary">Processing...</span>
            </>
          ) : (
            <>
              <div className="p-4 rounded-lg border-2 border-primary">
                <ImageIcon className="h-12 w-12 text-primary" />
              </div>
              <span className="text-lg font-semibold text-primary">Add Photos/Video</span>
            </>
          )}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              Images ({previewImages.length}/{maxImages})
            </label>
            {previewImages.length < maxImages && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    Add More
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {previewImages.map((url, index) => (
              <div key={index} className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                <img
                  src={url}
                  alt={`Post image ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(url, index)}
                  className="absolute top-2 right-2 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-5 w-5 text-white drop-shadow-lg" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
