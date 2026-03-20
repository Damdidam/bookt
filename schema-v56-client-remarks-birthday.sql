-- V56: Add remarks (rich text for staff) and birthday to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS birthday DATE;
