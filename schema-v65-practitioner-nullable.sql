-- V65: Allow NULL practitioner_id on bookings (for permanent practitioner deletion)
ALTER TABLE bookings ALTER COLUMN practitioner_id DROP NOT NULL;
