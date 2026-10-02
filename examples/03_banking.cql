-- Domain: retail banking
-- Objects: 1 keyspace, 2 UDTs, 4 tables, 3 materialized views, 2 indexes, 2 functions, 1 aggregate
-- Requires: materialized_views_enabled and user_defined_functions_enabled on the server.

CREATE KEYSPACE IF NOT EXISTS bank
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TYPE IF NOT EXISTS bank.address (street text, city text, country text, postal_code text);
CREATE TYPE IF NOT EXISTS bank.contact (phone text, email text);

CREATE TABLE IF NOT EXISTS bank.accounts (
  account_id uuid PRIMARY KEY,
  holder text,
  iban text,
  balance decimal,
  opened date,
  address frozen<address>,
  contact frozen<contact>
);

CREATE TABLE IF NOT EXISTS bank.transactions_by_account (
  account_id uuid,
  txn_time timeuuid,
  kind text,
  amount decimal,
  counterparty text,
  PRIMARY KEY ((account_id), txn_time)
) WITH CLUSTERING ORDER BY (txn_time DESC);

CREATE TABLE IF NOT EXISTS bank.cards (
  card_id uuid PRIMARY KEY,
  account_id uuid,
  last4 text,
  expires date,
  status text
);

CREATE TABLE IF NOT EXISTS bank.daily_balances (
  account_id uuid,
  day date,
  balance decimal,
  PRIMARY KEY ((account_id), day)
) WITH CLUSTERING ORDER BY (day DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS bank.accounts_by_iban AS
  SELECT iban, account_id, holder FROM bank.accounts
  WHERE iban IS NOT NULL AND account_id IS NOT NULL
  PRIMARY KEY (iban, account_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS bank.cards_by_account AS
  SELECT account_id, card_id, last4, status FROM bank.cards
  WHERE account_id IS NOT NULL AND card_id IS NOT NULL
  PRIMARY KEY ((account_id), card_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS bank.transactions_by_kind AS
  SELECT kind, account_id, txn_time, amount FROM bank.transactions_by_account
  WHERE kind IS NOT NULL AND account_id IS NOT NULL AND txn_time IS NOT NULL
  PRIMARY KEY ((kind), account_id, txn_time);

CREATE INDEX IF NOT EXISTS cards_status_idx ON bank.cards (status);
CREATE INDEX IF NOT EXISTS accounts_holder_idx ON bank.accounts (holder);

CREATE OR REPLACE FUNCTION bank.mask_iban(iban text)
  RETURNS NULL ON NULL INPUT RETURNS text LANGUAGE java
  AS $$ if (iban.length() <= 4) return iban; return "****" + iban.substring(iban.length() - 4); $$;

CREATE OR REPLACE FUNCTION bank.add_signed(state decimal, kind text, amount decimal)
  CALLED ON NULL INPUT RETURNS decimal LANGUAGE java
  AS $$ if (amount == null || kind == null) return state; return "debit".equals(kind) ? state.subtract(amount) : state.add(amount); $$;

CREATE OR REPLACE AGGREGATE bank.net_flow(text, decimal)
  SFUNC add_signed STYPE decimal INITCOND 0;

INSERT INTO bank.accounts (account_id, holder, iban, balance, opened, address, contact)
  VALUES (bbbbbbbb-0000-0000-0000-000000000001, 'Grace Hopper', 'DE89370400440532013000', 2500.00, '2024-03-01',
          {street: '5 Navy Yard', city: 'Berlin', country: 'DE', postal_code: '10115'}, {phone: '+49301234567', email: 'grace@example.com'});
INSERT INTO bank.transactions_by_account (account_id, txn_time, kind, amount, counterparty)
  VALUES (bbbbbbbb-0000-0000-0000-000000000001, now(), 'credit', 1200.00, 'Payroll GmbH');
INSERT INTO bank.transactions_by_account (account_id, txn_time, kind, amount, counterparty)
  VALUES (bbbbbbbb-0000-0000-0000-000000000001, now(), 'debit', 45.30, 'Corner Market');
INSERT INTO bank.cards (card_id, account_id, last4, expires, status)
  VALUES (uuid(), bbbbbbbb-0000-0000-0000-000000000001, '4242', '2028-11-30', 'active');
