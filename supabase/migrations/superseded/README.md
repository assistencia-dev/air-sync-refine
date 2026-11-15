# Superseded migrations (preserved, not applied)

These SQL files are retained for historical traceability and intentionally moved out of the active top-level Supabase migration queue. Do not execute them.

- `20261027130000_enterprise_hardening.sql`, `20261027130001_enterprise_indexes_and_status_catalog.sql`, `20261027130002_enterprise_security_and_outbox_dlq.sql`, and `20261027130003_enterprise_function_hardening.sql`: their status catalog, Outbox DLQ, hardening indexes, policies, and Outbox functions are already present in the official database through the applied enterprise/index, Outbox, and RLS batch migrations. Reapplying these older consolidated migrations could replace newer policies.
- `20261027130005_rls_policy_consolidation.sql` and `20261027130007_rls_explicit_commands.sql`: superseded by the applied RLS explicit batches and the newer collaborator base/company-scope RLS migration. Reapplying would risk overwriting the current scope guard.
- `20261103090000_dbs_purchase_orders_partial_receipts.sql`: obsolete purchase-order schema. The active system uses `dbs_control_purchases`, `dbs_control_purchase_items`, `dbs_control_purchase_receipts`, and `dbs_control_purchase_receipt_items`, with applied migrations `20261111133659`, `20261111134918`, `20261111140750`, `20261111141203`, and `20261112142603`. Do not create the parallel legacy `dbs_purchase_orders` model.

No production rows were changed by this archival move. Files are preserved byte-for-byte; only their location changes so the CLI does not treat superseded SQL as pending migrations.
