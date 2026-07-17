-- Allow anonymous uploads to order-images bucket
-- This is needed for client-side direct uploads to bypass Vercel's 4.5MB limit
-- NOTE: This is safe because the bucket is public and files are organized by order ID

-- Allow anonymous users to upload to order-images bucket
CREATE POLICY "Allow anonymous uploads to order-images"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'order-images');

-- Note: Public read access is already enabled by the existing policy
-- Note: Updates and deletes are restricted to service_role only (secure)

