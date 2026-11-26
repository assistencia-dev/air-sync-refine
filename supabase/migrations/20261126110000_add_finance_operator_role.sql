-- Papel financeiro operacional: separado do perfil FINANCEIRO_LEITURA.
-- Migração isolada para que o novo valor do enum esteja confirmado antes das
-- funções seguintes passarem a referenciá-lo.
ALTER TYPE public.role_key ADD VALUE IF NOT EXISTS 'FINANCEIRO_OPERADOR';
