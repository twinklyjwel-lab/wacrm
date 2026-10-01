-- ============================================================
-- 038_loyalty_gst_rate.sql
--
-- Points are earned on the invoice total excluding GST. Some billing
-- exports (e.g. the Vasy "Sales All Data" report) only carry a
-- GST-inclusive net amount, so the GST is backed out at this rate when
-- an invoice arrives without a GST figure. 3% is the GST on gold /
-- silver jewellery in India.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE loyalty_settings
  ADD COLUMN IF NOT EXISTS gst_included_rate NUMERIC(5, 2) NOT NULL DEFAULT 3
    CHECK (gst_included_rate >= 0 AND gst_included_rate <= 28);
