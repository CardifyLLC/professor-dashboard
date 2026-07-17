-- Supabase Storage Bucket Setup
-- Run this in Supabase SQL Editor to create storage buckets and policies

-- Create storage bucket for card images
-- NOTE: This bucket is currently NOT USED in the code
-- Reserved for future use (e.g., card templates, public gallery, general card designs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'card-images',
  'card-images',
  true, -- Public bucket so images can be accessed via URL
  10485760, -- 10MB file size limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for order images (organized by order)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-images',
  'order-images',
  true,
  10485760, -- 10MB file size limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for card-images bucket
-- Allow authenticated users to upload
CREATE POLICY "Allow authenticated uploads to card-images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'card-images');

-- Allow public read access
CREATE POLICY "Allow public read access to card-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'card-images');

-- Allow authenticated users to update their own files
CREATE POLICY "Allow authenticated updates to card-images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'card-images');

-- Allow authenticated users to delete their own files
CREATE POLICY "Allow authenticated deletes to card-images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'card-images');

-- Storage Policies for order-images bucket
-- Allow service role (backend) to upload
CREATE POLICY "Allow service role uploads to order-images"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'order-images');

-- Allow public read access
CREATE POLICY "Allow public read access to order-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'order-images');

-- Allow service role to update
CREATE POLICY "Allow service role updates to order-images"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'order-images');

-- Allow service role to delete
CREATE POLICY "Allow service role deletes to order-images"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'order-images');

