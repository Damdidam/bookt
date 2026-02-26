-- v13b: Practitioner photo URL
ALTER TABLE practitioners
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
