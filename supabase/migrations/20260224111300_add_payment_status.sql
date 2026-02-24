ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS paid_at timestamptz;
