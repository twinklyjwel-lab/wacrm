-- ============================================================
-- 037_jewellery_loyalty.sql
--
-- Jewellery-store CRM layer on top of contacts:
--
--   1. contacts: birthday / anniversary / ERP customer code / opt-out.
--   2. metal_rates      — daily gold & silver rate per gram per purity.
--   3. inventory_items  — article-level gold / silver stock.
--   4. invoices + invoice_items — purchases (imported from the Vasy
--      ERP via CSV/Excel or the public API, or entered manually). Each
--      line records the metal rate per gram at the time of purchase.
--   5. loyalty_settings — per-account earn / value / expiry rules,
--      WhatsApp template mapping and inbound keywords.
--   6. loyalty_lots     — one row per points credit (purchase, birthday,
--      anniversary, manual). Points are worth `bonus_value` until
--      `bonus_until`, then `base_value` until `expires_at`.
--   7. loyalty_redemptions (+ _lots) — FIFO redemptions with an audit
--      trail of which lots were drawn down.
--   8. loyalty_scheduled_messages — the retention queue (post-purchase
--      feedback, expiry reminders, birthday / anniversary wishes),
--      drained by /api/loyalty/cron.
--   9. redeem_loyalty_points() — atomic FIFO redemption.
--  10. `invoices` storage bucket (private; Meta gets a signed URL).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Contacts -------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS anniversary DATE,
  ADD COLUMN IF NOT EXISTS customer_code TEXT,
  ADD COLUMN IF NOT EXISTS loyalty_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Daily occasion sweep matches on month/day.
CREATE INDEX IF NOT EXISTS idx_contacts_birthday_md
  ON contacts (account_id, EXTRACT(MONTH FROM birthday), EXTRACT(DAY FROM birthday))
  WHERE birthday IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_anniversary_md
  ON contacts (account_id, EXTRACT(MONTH FROM anniversary), EXTRACT(DAY FROM anniversary))
  WHERE anniversary IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_customer_code
  ON contacts (account_id, customer_code)
  WHERE customer_code IS NOT NULL;

-- 2. Metal rates ----------------------------------------------
CREATE TABLE IF NOT EXISTS metal_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metal TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  -- Free text so stores can use their own labels: 24K, 22K, 18K, 999, 925 …
  purity TEXT NOT NULL,
  rate_per_gram NUMERIC(12, 2) NOT NULL CHECK (rate_per_gram >= 0),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, metal, purity, effective_date)
);
CREATE INDEX IF NOT EXISTS idx_metal_rates_lookup
  ON metal_rates (account_id, metal, purity, effective_date DESC);

-- 3. Inventory ------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  metal TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  purity TEXT NOT NULL,
  gross_weight NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (gross_weight >= 0),
  stone_weight NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (stone_weight >= 0),
  net_weight NUMERIC(10, 3) NOT NULL DEFAULT 0 CHECK (net_weight >= 0),
  making_charge_type TEXT NOT NULL DEFAULT 'per_gram'
    CHECK (making_charge_type IN ('per_gram', 'percent', 'fixed')),
  making_charge NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- Higher = shown first. Lets the store pin fast movers / high-value pieces.
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock', 'reserved', 'sold')),
  sold_invoice_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_list
  ON inventory_items (account_id, metal, status, priority DESC);

-- 4. Invoices -------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- ERP invoice number. Unique per account so re-imports are no-ops.
  external_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv', 'api', 'vasy')),
  invoice_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  making_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  points_earned INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  redeemed_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- Object path inside the private `invoices` bucket.
  pdf_path TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices (contact_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_account_date ON invoices (account_id, invoice_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_sold_invoice_fk'
  ) THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT inventory_items_sold_invoice_fk
      FOREIGN KEY (sold_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  sku TEXT,
  description TEXT NOT NULL,
  metal TEXT CHECK (metal IN ('gold', 'silver')),
  purity TEXT,
  net_weight NUMERIC(10, 3) NOT NULL DEFAULT 0,
  -- The gold / silver rate per gram the customer was billed at.
  metal_rate_per_gram NUMERIC(12, 2),
  making_charge NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);

-- 5. Loyalty settings -----------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- 1 point per `amount_per_point` rupees of invoice total.
  amount_per_point NUMERIC(12, 2) NOT NULL DEFAULT 100 CHECK (amount_per_point > 0),
  bonus_value NUMERIC(8, 2) NOT NULL DEFAULT 1.5,
  base_value NUMERIC(8, 2) NOT NULL DEFAULT 1,
  bonus_months INTEGER NOT NULL DEFAULT 1 CHECK (bonus_months >= 0),
  expiry_months INTEGER NOT NULL DEFAULT 3 CHECK (expiry_months > 0),
  birthday_points INTEGER NOT NULL DEFAULT 0 CHECK (birthday_points >= 0),
  anniversary_points INTEGER NOT NULL DEFAULT 0 CHECK (anniversary_points >= 0),
  google_review_url TEXT,
  store_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  send_hour INTEGER NOT NULL DEFAULT 10 CHECK (send_hour BETWEEN 0 AND 23),
  -- Reminder offsets (days before expiry).
  reminder_days INTEGER[] NOT NULL DEFAULT ARRAY[30, 7, 1],
  -- { "<kind>": { "name": "...", "language": "en" } } — see src/lib/loyalty/types.ts.
  templates JSONB NOT NULL DEFAULT '{}'::jsonb,
  points_keywords TEXT[] NOT NULL DEFAULT ARRAY['points', 'point', 'loyalty', 'balance'],
  orders_keywords TEXT[] NOT NULL DEFAULT ARRAY['order', 'orders', 'purchase', 'purchases', 'invoice'],
  occasions_last_run DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Loyalty lots ---------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('purchase', 'birthday', 'anniversary', 'manual')),
  -- For birthday / anniversary: the year, so a bonus is credited once a year.
  occasion_year INTEGER,
  points INTEGER NOT NULL CHECK (points > 0),
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bonus_until TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (remaining <= points)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_lots_contact
  ON loyalty_lots (contact_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_lots_active
  ON loyalty_lots (account_id, expires_at) WHERE remaining > 0;
-- One purchase credit per invoice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_lots_invoice
  ON loyalty_lots (invoice_id) WHERE source = 'purchase';
-- One occasion bonus per contact per year.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_lots_occasion
  ON loyalty_lots (contact_id, source, occasion_year)
  WHERE source IN ('birthday', 'anniversary');

-- 7. Redemptions ----------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  value NUMERIC(14, 2) NOT NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_contact
  ON loyalty_redemptions (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS loyalty_redemption_lots (
  redemption_id UUID NOT NULL REFERENCES loyalty_redemptions(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES loyalty_lots(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK (points > 0),
  value_per_point NUMERIC(8, 2) NOT NULL,
  PRIMARY KEY (redemption_id, lot_id)
);

-- 8. Scheduled retention messages -----------------------------
CREATE TABLE IF NOT EXISTS loyalty_scheduled_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'feedback', 'expiry_reminder', 'birthday', 'anniversary'
  )),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  lot_id UUID REFERENCES loyalty_lots(id) ON DELETE CASCADE,
  -- For expiry reminders: how many days before expiry this one is.
  days_before INTEGER,
  -- Dedupe key, e.g. 'feedback:<invoice>' / 'expiry:<contact>:<date>:7'.
  dedupe_key TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_sched_due
  ON loyalty_scheduled_messages (send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_loyalty_sched_account
  ON loyalty_scheduled_messages (account_id, send_at DESC);

-- RLS ---------------------------------------------------------
-- Same account-scoped shape as quick_replies (035): any member reads,
-- agent+ writes. Settings writes are admin+.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'metal_rates', 'inventory_items', 'invoices', 'invoice_items',
    'loyalty_lots', 'loyalty_redemptions', 'loyalty_scheduled_messages'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (is_account_member(account_id))',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (is_account_member(account_id, ''agent''))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (is_account_member(account_id, ''agent''))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (is_account_member(account_id, ''agent''))',
      t || '_delete', t);
  END LOOP;
END $$;

ALTER TABLE loyalty_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loyalty_settings_select ON loyalty_settings;
DROP POLICY IF EXISTS loyalty_settings_insert ON loyalty_settings;
DROP POLICY IF EXISTS loyalty_settings_update ON loyalty_settings;
CREATE POLICY loyalty_settings_select ON loyalty_settings FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY loyalty_settings_insert ON loyalty_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY loyalty_settings_update ON loyalty_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

-- Redemption lots have no account_id; visible through their redemption.
ALTER TABLE loyalty_redemption_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loyalty_redemption_lots_select ON loyalty_redemption_lots;
CREATE POLICY loyalty_redemption_lots_select ON loyalty_redemption_lots FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM loyalty_redemptions r
    WHERE r.id = redemption_id AND is_account_member(r.account_id)
  ));

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'metal_rates', 'inventory_items', 'invoices', 'loyalty_settings',
    'loyalty_scheduled_messages'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t);
  END LOOP;
END $$;

-- 9. Atomic FIFO redemption -----------------------------------
-- Locks the contact's live lots oldest-expiry-first, draws `p_points`
-- down across them, and records the redemption + per-lot audit rows.
-- Each point is valued at the lot's current rate (bonus_value inside
-- its bonus window, base_value after). Raises if the balance is short.
-- Service-role only: API routes enforce the caller's role first.
CREATE OR REPLACE FUNCTION redeem_loyalty_points(
  p_account_id UUID,
  p_contact_id UUID,
  p_points INTEGER,
  p_invoice_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
) RETURNS loyalty_redemptions
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings loyalty_settings;
  v_bonus NUMERIC := 1.5;
  v_base NUMERIC := 1;
  v_left INTEGER := p_points;
  v_take INTEGER;
  v_rate NUMERIC;
  v_value NUMERIC := 0;
  v_redemption loyalty_redemptions;
  v_lot loyalty_lots;
  v_draws JSONB := '[]'::jsonb;
  v_draw JSONB;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'points must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_settings FROM loyalty_settings WHERE account_id = p_account_id;
  IF FOUND THEN
    v_bonus := v_settings.bonus_value;
    v_base := v_settings.base_value;
  END IF;

  FOR v_lot IN
    SELECT * FROM loyalty_lots
    WHERE account_id = p_account_id
      AND contact_id = p_contact_id
      AND remaining > 0
      AND expires_at > NOW()
    ORDER BY expires_at ASC, earned_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left = 0;
    v_take := LEAST(v_left, v_lot.remaining);
    v_rate := CASE WHEN NOW() < v_lot.bonus_until THEN v_bonus ELSE v_base END;
    UPDATE loyalty_lots SET remaining = remaining - v_take WHERE id = v_lot.id;
    v_value := v_value + v_take * v_rate;
    v_left := v_left - v_take;
    v_draws := v_draws || jsonb_build_object('lot_id', v_lot.id, 'points', v_take, 'rate', v_rate);
  END LOOP;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'insufficient points: short by %', v_left USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO loyalty_redemptions (account_id, contact_id, invoice_id, points, value, note, created_by)
  VALUES (p_account_id, p_contact_id, p_invoice_id, p_points, ROUND(v_value, 2), p_note, p_user_id)
  RETURNING * INTO v_redemption;

  FOR v_draw IN SELECT * FROM jsonb_array_elements(v_draws) LOOP
    INSERT INTO loyalty_redemption_lots (redemption_id, lot_id, points, value_per_point)
    VALUES (
      v_redemption.id,
      (v_draw->>'lot_id')::UUID,
      (v_draw->>'points')::INTEGER,
      (v_draw->>'rate')::NUMERIC
    );
  END LOOP;

  IF p_invoice_id IS NOT NULL THEN
    UPDATE invoices
      SET points_redeemed = points_redeemed + p_points,
          redeemed_value = redeemed_value + ROUND(v_value, 2)
      WHERE id = p_invoice_id AND account_id = p_account_id;
  END IF;

  RETURN v_redemption;
END;
$$;

REVOKE ALL ON FUNCTION redeem_loyalty_points(UUID, UUID, INTEGER, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_loyalty_points(UUID, UUID, INTEGER, UUID, TEXT, UUID) TO service_role;

-- Contacts whose birthday / anniversary falls on (month, day). Leap-day
-- dates are matched on 28 Feb in non-leap years by the caller passing
-- p_include_leap_day.
CREATE OR REPLACE FUNCTION loyalty_occasion_contacts(
  p_account_id UUID,
  p_kind TEXT,
  p_month INTEGER,
  p_day INTEGER,
  p_include_leap_day BOOLEAN DEFAULT FALSE
) RETURNS TABLE (id UUID, name TEXT, phone TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT c.id, c.name, c.phone
  FROM contacts c
  WHERE c.account_id = p_account_id
    AND NOT c.loyalty_opt_out
    AND (
      (p_kind = 'birthday' AND c.birthday IS NOT NULL AND (
        (EXTRACT(MONTH FROM c.birthday) = p_month AND EXTRACT(DAY FROM c.birthday) = p_day)
        OR (p_include_leap_day AND EXTRACT(MONTH FROM c.birthday) = 2 AND EXTRACT(DAY FROM c.birthday) = 29)
      ))
      OR (p_kind = 'anniversary' AND c.anniversary IS NOT NULL AND (
        (EXTRACT(MONTH FROM c.anniversary) = p_month AND EXTRACT(DAY FROM c.anniversary) = p_day)
        OR (p_include_leap_day AND EXTRACT(MONTH FROM c.anniversary) = 2 AND EXTRACT(DAY FROM c.anniversary) = 29)
      ))
    );
$$;

REVOKE ALL ON FUNCTION loyalty_occasion_contacts(UUID, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION loyalty_occasion_contacts(UUID, TEXT, INTEGER, INTEGER, BOOLEAN) TO service_role;

-- 10. Invoice PDFs bucket -------------------------------------
-- Private: invoices carry personal data. The cron hands Meta a
-- short-lived signed URL when attaching the PDF to a WhatsApp message.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoices', 'invoices', FALSE, 16777216, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Members can read invoice PDFs" ON storage.objects;
CREATE POLICY "Members can read invoice PDFs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
