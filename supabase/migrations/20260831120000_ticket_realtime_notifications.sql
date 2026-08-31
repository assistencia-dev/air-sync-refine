-- Permite que o cliente compare o status anterior e o novo ao receber eventos realtime.
ALTER TABLE public.tickets REPLICA IDENTITY FULL;

-- Garante que a tabela participe da publicação realtime do Supabase.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;
