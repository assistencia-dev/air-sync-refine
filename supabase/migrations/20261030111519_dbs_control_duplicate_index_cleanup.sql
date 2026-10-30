-- Hygiene only: remove the duplicate non-unique index identified by the
-- Supabase advisor. The primary key and dbs_control_base_clients_base_idx
-- continue to cover the (base_id, client_id) lookup. No operational row is
-- deleted or rewritten.
drop index if exists public.idx_dbs_control_base_clients_base_client;
