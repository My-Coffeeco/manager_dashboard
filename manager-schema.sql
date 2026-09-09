-- My Coffee Co. manager database v1. Run in Supabase SQL Editor as the project owner.
-- Creates a NEW private schema only. Refuses to overwrite an existing schema/role.
-- Do not expose mcc_manager in Supabase Data API settings. No passwords belong here.
BEGIN;
CREATE ROLE mcc_manager_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA mcc_manager;
REVOKE ALL ON SCHEMA mcc_manager FROM PUBLIC;

CREATE TABLE mcc_manager.installation (
  id integer PRIMARY KEY CHECK (id = 1), version integer NOT NULL CHECK (version = 1),
  bootstrapped boolean NOT NULL DEFAULT false
);
INSERT INTO mcc_manager.installation VALUES (1, 1, false);
CREATE TABLE mcc_manager.stores (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE mcc_manager.roles (role text PRIMARY KEY CHECK (role = 'store_manager'));
CREATE TABLE mcc_manager.permissions (
  role text REFERENCES mcc_manager.roles(role), permission text NOT NULL,
  PRIMARY KEY (role, permission)
);
CREATE TABLE mcc_manager.admins (
  id uuid PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL, role text NOT NULL REFERENCES mcc_manager.roles(role),
  store_id text NOT NULL REFERENCES mcc_manager.stores(id),
  created_at bigint NOT NULL, disabled boolean NOT NULL DEFAULT false
);
CREATE TABLE mcc_manager.admin_sessions (
  token_hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES mcc_manager.admins(id),
  csrf text NOT NULL, expires bigint NOT NULL
);
CREATE INDEX ON mcc_manager.admin_sessions(expires);
CREATE TABLE mcc_manager.admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL,
  action text NOT NULL, target text NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE mcc_manager.admin_limits (
  key text PRIMARY KEY, attempts integer NOT NULL, reset_at bigint NOT NULL
);
CREATE INDEX ON mcc_manager.admin_limits(reset_at);
CREATE TABLE mcc_manager.admin_events (
  id text PRIMARY KEY, store_id text NOT NULL REFERENCES mcc_manager.stores(id),
  type text NOT NULL CHECK (type IN ('order','stock','inquiry')),
  occurred_at bigint NOT NULL, created_at bigint NOT NULL
);
CREATE TABLE mcc_manager.admin_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES mcc_manager.admins(id),
  event_id text NOT NULL REFERENCES mcc_manager.admin_events(id),
  message text NOT NULL, read_at bigint, UNIQUE(admin_id, event_id)
);
CREATE INDEX ON mcc_manager.admin_alerts(admin_id, read_at);
CREATE TABLE mcc_manager.admin_orders (
  id text NOT NULL, store_id text NOT NULL REFERENCES mcc_manager.stores(id),
  customer text NOT NULL, status text NOT NULL CHECK (status IN ('paid','payment_pending','shipped','delivered','cancelled')),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), paid_at bigint,
  updated_at bigint NOT NULL, PRIMARY KEY(id, store_id)
);
CREATE INDEX ON mcc_manager.admin_orders(store_id, paid_at);
CREATE TABLE mcc_manager.admin_stock (
  sku text NOT NULL, store_id text NOT NULL REFERENCES mcc_manager.stores(id),
  quantity bigint NOT NULL CHECK (quantity >= 0), threshold bigint NOT NULL CHECK (threshold >= 0),
  updated_at bigint NOT NULL, PRIMARY KEY(sku, store_id)
);
CREATE TABLE mcc_manager.admin_inquiries (
  id text NOT NULL, store_id text NOT NULL REFERENCES mcc_manager.stores(id),
  name text NOT NULL, type text NOT NULL CHECK (type IN ('Wholesale','Franchise')),
  status text NOT NULL CHECK (status IN ('new','in_review','closed')),
  submitted_at bigint NOT NULL, updated_at bigint NOT NULL, PRIMARY KEY(id, store_id)
);

INSERT INTO mcc_manager.stores VALUES ('mycoffeeco-online','My Coffee Co. - Online Store');
INSERT INTO mcc_manager.roles VALUES ('store_manager');
INSERT INTO mcc_manager.permissions VALUES
  ('store_manager','dashboard'), ('store_manager','orders'),
  ('store_manager','inventory'), ('store_manager','inquiries');

-- Only this restricted backend role can use the schema. No anonymous/customer API grants.
GRANT USAGE ON SCHEMA mcc_manager TO mcc_manager_app;
GRANT SELECT ON mcc_manager.installation, mcc_manager.stores, mcc_manager.roles,
  mcc_manager.permissions TO mcc_manager_app;
GRANT UPDATE(bootstrapped) ON mcc_manager.installation TO mcc_manager_app;
GRANT SELECT, INSERT ON mcc_manager.admins TO mcc_manager_app;
GRANT SELECT, INSERT, DELETE ON mcc_manager.admin_sessions TO mcc_manager_app;
GRANT INSERT ON mcc_manager.admin_audit TO mcc_manager_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcc_manager.admin_limits TO mcc_manager_app;
GRANT SELECT, INSERT ON mcc_manager.admin_events TO mcc_manager_app;
GRANT SELECT, INSERT ON mcc_manager.admin_alerts TO mcc_manager_app;
GRANT UPDATE(read_at) ON mcc_manager.admin_alerts TO mcc_manager_app;
GRANT SELECT, INSERT, UPDATE ON mcc_manager.admin_orders, mcc_manager.admin_stock,
  mcc_manager.admin_inquiries TO mcc_manager_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA mcc_manager TO mcc_manager_app;
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'mcc_manager' LOOP
    EXECUTE format('ALTER TABLE mcc_manager.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    EXECUTE format('CREATE POLICY backend_only ON mcc_manager.%I TO mcc_manager_app USING (true) WITH CHECK (true)', item.tablename);
  END LOOP;
END $$;
COMMIT;
