CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id varchar(120) UNIQUE,
  name varchar(120) NOT NULL,
  contact_name varchar(100),
  email varchar(120),
  phone varchar(40),
  sector varchar(100),
  owner_name varchar(80),
  status varchar(24) NOT NULL DEFAULT 'onboarding',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_status_check CHECK (status IN ('onboarding','active','paused','completed','lost'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL,
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  value numeric(14,2) NOT NULL DEFAULT 0,
  monthly_value numeric(14,2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'TRY',
  billing varchar(20) NOT NULL DEFAULT 'one_time',
  status varchar(20) NOT NULL DEFAULT 'draft',
  start_date date,
  end_date date,
  signed_at date,
  document_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'TRY',
  status varchar(20) NOT NULL DEFAULT 'planned',
  due_date date,
  paid_at date,
  invoice_no varchar(80),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title varchar(180) NOT NULL,
  assignee varchar(80),
  due_date date,
  status varchar(20) NOT NULL DEFAULT 'todo',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type varchar(50) NOT NULL DEFAULT 'note',
  summary text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(80)
);

CREATE INDEX IF NOT EXISTS contracts_customer_id_idx ON contracts(customer_id);
CREATE INDEX IF NOT EXISTS payments_customer_id_idx ON payments(customer_id);
CREATE INDEX IF NOT EXISTS payments_due_status_idx ON payments(due_date, status);
CREATE INDEX IF NOT EXISTS tasks_customer_id_status_idx ON tasks(customer_id, status);
CREATE INDEX IF NOT EXISTS activities_customer_id_occurred_idx ON activities(customer_id, occurred_at DESC);
