-- v11: Freestyle bookings (no predefined service)
-- Allow bookings without a service
ALTER TABLE bookings ALTER COLUMN service_id DROP NOT NULL;

-- Custom label for freestyle bookings (e.g. "Urgence dossier Martin")
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS custom_label VARCHAR(255);
