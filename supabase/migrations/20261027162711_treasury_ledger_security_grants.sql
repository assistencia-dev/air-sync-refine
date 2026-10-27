begin;

-- The ledger RPC is called only by the authenticated server bridge. Explicitly
-- revoke inherited API-role grants; revoking PUBLIC alone is not sufficient
-- when an earlier migration granted a role directly.
revoke execute on function public.post_treasury_ledger_entry(
  text, uuid, date, date, text, text, text, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.post_treasury_ledger_entry(
  text, uuid, date, date, text, text, text, text, uuid, text, jsonb, jsonb
) to service_role;

commit;
