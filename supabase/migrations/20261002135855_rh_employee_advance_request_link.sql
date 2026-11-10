ALTER TABLE public.rh_employee_advances ADD COLUMN IF NOT EXISTS source_request_id uuid REFERENCES public.rh_employee_requests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rh_employee_advances_source_request_uq ON public.rh_employee_advances(source_request_id) WHERE source_request_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
