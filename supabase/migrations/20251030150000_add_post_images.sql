-- Add image_urls column to posts table
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;

-- Create post-images storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-images',
  'post-images',
  true,
  10485760, -- 10MB limit per image
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for post-images bucket

-- Allow authenticated users to upload their own post images
CREATE POLICY "Users can upload their own post images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'post-images' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to update their own post images
CREATE POLICY "Users can update their own post images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'post-images' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to delete their own post images
CREATE POLICY "Users can delete their own post images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'post-images' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow anyone to view post images (public read)
CREATE POLICY "Post images are viewable by anyone"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'post-images');
