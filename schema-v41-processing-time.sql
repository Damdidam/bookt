-- v41: Processing time (temps de pose) for services, variants, and bookings
ALTER TABLE services ADD COLUMN IF NOT EXISTS processing_time INTEGER DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS processing_start INTEGER DEFAULT 0;
ALTER TABLE service_variants ADD COLUMN IF NOT EXISTS processing_time INTEGER DEFAULT 0;
ALTER TABLE service_variants ADD COLUMN IF NOT EXISTS processing_start INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS processing_time INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS processing_start INTEGER DEFAULT 0;
