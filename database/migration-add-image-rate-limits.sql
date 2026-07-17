-- Migration: add shared hourly image quota storage and RPC helper
-- Run this in your Supabase SQL Editor before relying on the 10k/hour limiter in production.

CREATE TABLE IF NOT EXISTS image_rate_limits (
  client_key TEXT PRIMARY KEY,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  image_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_rate_limits_window_start
  ON image_rate_limits(window_start DESC);

CREATE OR REPLACE FUNCTION consume_image_quota(
  p_client_key TEXT,
  p_requested_images INTEGER,
  p_max_images INTEGER DEFAULT 10000,
  p_window_seconds INTEGER DEFAULT 3600
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining_images INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := NOW();
  v_window_start TIMESTAMP WITH TIME ZONE := v_now - make_interval(secs => p_window_seconds);
  v_record image_rate_limits%ROWTYPE;
  v_next_count INTEGER;
BEGIN
  IF p_requested_images <= 0 THEN
    RETURN QUERY SELECT TRUE, p_max_images, p_window_seconds;
    RETURN;
  END IF;

  INSERT INTO image_rate_limits (client_key, window_start, image_count, updated_at)
  VALUES (p_client_key, v_now, 0, v_now)
  ON CONFLICT (client_key) DO NOTHING;

  SELECT *
  INTO v_record
  FROM image_rate_limits
  WHERE client_key = p_client_key
  FOR UPDATE;

  IF v_record.window_start < v_window_start THEN
    v_record.window_start := v_now;
    v_record.image_count := 0;
  END IF;

  v_next_count := v_record.image_count + p_requested_images;

  IF v_next_count > p_max_images THEN
    RETURN QUERY
    SELECT
      FALSE,
      GREATEST(0, p_max_images - v_record.image_count),
      GREATEST(1, p_window_seconds - FLOOR(EXTRACT(EPOCH FROM (v_now - v_record.window_start)))::INTEGER);
    RETURN;
  END IF;

  UPDATE image_rate_limits
  SET
    window_start = v_record.window_start,
    image_count = v_next_count,
    updated_at = v_now
  WHERE client_key = p_client_key;

  RETURN QUERY
  SELECT
    TRUE,
    GREATEST(0, p_max_images - v_next_count),
    GREATEST(1, p_window_seconds - FLOOR(EXTRACT(EPOCH FROM (v_now - v_record.window_start)))::INTEGER);
END;
$$;
