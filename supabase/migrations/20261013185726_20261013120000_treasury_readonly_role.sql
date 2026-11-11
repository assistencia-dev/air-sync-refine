-- Acesso exclusivo de consulta ao DBS TREASURY.
ALTER TYPE public.role_key ADD VALUE IF NOT EXISTS 'FINANCEIRO_LEITURA';
