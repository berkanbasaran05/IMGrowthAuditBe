CREATE TABLE IF NOT EXISTS key_values (
  key text PRIMARY KEY,
  value text NOT NULL,
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS hash_values (
  bucket text NOT NULL,
  field text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (bucket, field)
);

CREATE TABLE IF NOT EXISTS list_values (
  sequence bigserial PRIMARY KEY,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS list_values_key_sequence_idx ON list_values(key, sequence DESC);
CREATE INDEX IF NOT EXISTS key_values_expiry_idx ON key_values(expires_at) WHERE expires_at IS NOT NULL;
