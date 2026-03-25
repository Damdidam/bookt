ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_booking ON invoice_items(booking_id) WHERE booking_id IS NOT NULL;
