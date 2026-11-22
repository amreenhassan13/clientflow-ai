-- ClientFlow AI initial schema. Requires PostgreSQL 13+ (gen_random_uuid is built in).

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  service text NOT NULL,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'website',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
  estimated_value numeric(12, 2) NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
  sms_consent boolean NOT NULL DEFAULT false,
  sms_opted_out_at timestamptz,
  integration_hubspot text NOT NULL DEFAULT 'pending',
  integration_sms text NOT NULL DEFAULT 'pending',
  idempotency_key text UNIQUE,
  won_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_created_idx ON leads (created_at DESC);
CREATE INDEX leads_status_idx ON leads (status);
CREATE INDEX leads_won_idx ON leads (won_at) WHERE won_at IS NOT NULL;
CREATE INDEX leads_phone_idx ON leads (phone) WHERE phone IS NOT NULL;

-- Append-only activity log. Exported to BigQuery without personal data.
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads (id) ON DELETE SET NULL,
  kind text NOT NULL,
  source text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  exported_at timestamptz
);
CREATE INDEX events_unexported_idx ON events (created_at) WHERE exported_at IS NULL;

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('hubspot_sync', 'sms_welcome', 'survey_sms')),
  lead_id uuid REFERENCES leads (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, lead_id)
);
CREATE INDEX jobs_due_idx ON jobs (next_attempt_at) WHERE status = 'pending';

CREATE TABLE sms_messages (
  sid text PRIMARY KEY,
  lead_id uuid REFERENCES leads (id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('welcome', 'survey')),
  status text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sms_messages_once_idx ON sms_messages (lead_id, purpose) WHERE lead_id IS NOT NULL;

-- Phone numbers (hashed) that replied STOP. Checked before every send.
CREATE TABLE sms_suppressions (
  phone_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES leads (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  rating int CHECK (rating BETWEEN 1 AND 5),
  feedback text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key_hash text PRIMARY KEY,
  count int NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now()
);
