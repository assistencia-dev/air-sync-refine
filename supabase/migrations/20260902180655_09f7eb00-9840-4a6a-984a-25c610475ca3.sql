ALTER TABLE public.rh_employees
  ADD COLUMN IF NOT EXISTS registration_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ficha_file_name text,
  ADD COLUMN IF NOT EXISTS ficha_storage_path text;