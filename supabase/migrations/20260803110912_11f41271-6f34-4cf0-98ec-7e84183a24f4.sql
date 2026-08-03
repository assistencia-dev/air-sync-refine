ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS assumed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS assumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS last_maintenance_date timestamptz;

ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('aberto','atribuido','em_rota','em_atendimento','aguardando_peca','concluido','cancelado'));

CREATE SEQUENCE IF NOT EXISTS public.ticket_protocol_seq START 1;

ALTER TABLE public.tickets
  ALTER COLUMN protocol_number DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.set_ticket_protocol()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.protocol_number IS NULL OR NEW.protocol_number = '' THEN
    NEW.protocol_number := 'OS-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.ticket_protocol_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.tickets ALTER COLUMN protocol_number DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_set_ticket_protocol ON public.tickets;
CREATE TRIGGER trg_set_ticket_protocol
BEFORE INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.set_ticket_protocol();