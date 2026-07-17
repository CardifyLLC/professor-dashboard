ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_reason_key TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS refund_reference TEXT,
  ADD COLUMN IF NOT EXISTS rejection_email_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS rejection_email_status TEXT
    CHECK (rejection_email_status IN ('pending', 'sent', 'failed', 'skipped'));

CREATE TABLE IF NOT EXISTS order_rejection_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  email_subject TEXT NOT NULL,
  email_body_text TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_rejection_templates_active
  ON order_rejection_templates(active, sort_order);

DROP TRIGGER IF EXISTS update_order_rejection_templates_updated_at ON order_rejection_templates;
CREATE TRIGGER update_order_rejection_templates_updated_at
  BEFORE UPDATE ON order_rejection_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS order_rejection_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  refund_status TEXT NOT NULL CHECK (refund_status IN ('pending', 'succeeded', 'failed', 'skipped')),
  email_status TEXT NOT NULL CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  refund_reference TEXT,
  admin_note TEXT,
  error_message TEXT,
  action_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_rejection_actions_order_id
  ON order_rejection_actions(order_id, created_at DESC);

INSERT INTO order_rejection_templates (template_key, label, email_subject, email_body_text, sort_order)
VALUES
  (
    'bleed_settings',
    'Bleed Settings',
    'Action needed: fix bleed settings and reorder',
    E'Hello,\n\nThank you for your order. While reviewing your files, I noticed that the bleed settings need to be corrected before printing.\n\nTo make the process easier, I created a short video tutorial here:\nhttps://www.awesomescreenshot.com/video/50129474?key=0ebf39125c2de4e33f11d8f9c7508e9d\n\nI will go ahead and refund your order for now. Please place the order again once the bleed settings have been corrected.\n\nRegards,\nTyler',
    10
  ),
  (
    'official_backs',
    'Official Backs',
    'Order refunded: official backs are not allowed',
    E'Hello,\n\nI had to reject and refund your order because it included official backs. Please place the order again using an unofficial back.\n\nRegards,\nTyler',
    20
  ),
  (
    'payment_not_processed',
    'Payment Issue',
    'Payment issue on your order',
    E'Hello,\n\nIt looks like the payment associated with your order did not fully process.\n\nI just wanted to check whether you ran into an issue during checkout and make sure there was not an error on our end. Please let us know if you have any questions.\n\nRegards,\nTyler',
    30
  ),
  (
    'corner_defects',
    'Corner Defects',
    'Action needed: corner defects must be corrected',
    E'Hello,\n\nWhile preparing your order for print, I noticed several defects in the corners of your cards. After adding bleed, each card should be visually reviewed, and the "corner trim" slider should be adjusted as needed to minimize corner defects.\n\nI created a tutorial outlining the process here:\nhttps://www.tcgplaytest.com/tutorial.mp4\n\nI will go ahead and refund your order for now. Please place the order again once the files have been corrected and you are comfortable with the process.\n\nRegards,\nTyler',
    40
  )
ON CONFLICT (template_key) DO UPDATE SET
  label = EXCLUDED.label,
  email_subject = EXCLUDED.email_subject,
  email_body_text = EXCLUDED.email_body_text,
  sort_order = EXCLUDED.sort_order,
  active = TRUE;
