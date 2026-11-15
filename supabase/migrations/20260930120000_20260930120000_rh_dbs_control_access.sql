-- DBS CONTROL: permissão opcional por funcionário, sem criar outro cadastro ou login.
ALTER TABLE public.rh_employees
  ADD COLUMN IF NOT EXISTS dbs_control_access_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_rh_employees_dbs_control_access
  ON public.rh_employees (dbs_control_access_enabled)
  WHERE dbs_control_access_enabled = true;
