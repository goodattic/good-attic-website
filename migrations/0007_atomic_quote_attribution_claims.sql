-- Lease-token claims prevent simultaneous duplicate Quote events from both
-- reaching Jobber. A stale claim can be reclaimed after the short lease.
ALTER TABLE closed_loop_quote_attributions ADD COLUMN claim_token TEXT;
ALTER TABLE closed_loop_quote_attributions ADD COLUMN claim_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS closed_loop_quote_attributions_claim_idx
  ON closed_loop_quote_attributions (quote_id, claim_token, claim_expires_at);
