-- DBS CONTROL: actor attribution and append-only operational audit.
-- Additive only: preserves all existing OS, revisions, events and stored files.

CREATE OR REPLACE FUNCTION public.dbs_control_resolve_os_actor(
  p_idempotency_key text DEFAULT NULL,
  p_preferred_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid;
  v_auth_id uuid;
BEGIN
  IF NULLIF(btrim(p_idempotency_key), '') IS NOT NULL THEN
    SELECT sc.actor_user_id INTO v_actor
    FROM public.dbs_control_sync_commands sc
    JOIN public.users u ON u.id = sc.actor_user_id
    WHERE sc.idempotency_key = p_idempotency_key
      AND sc.actor_user_id IS NOT NULL
    ORDER BY sc.created_at DESC
    LIMIT 1;
    IF v_actor IS NOT NULL THEN
      RETURN v_actor;
    END IF;
  END IF;

  v_auth_id := auth.uid();
  IF v_auth_id IS NOT NULL THEN
    SELECT u.id INTO v_actor
    FROM public.users u
    WHERE u.auth_id = v_auth_id
    LIMIT 1;
    -- Never trust a caller-supplied actor when an authenticated identity
    -- exists, even for administrators inserting through the public API.
    RETURN v_actor;
  END IF;

  -- Service-role upload handlers have no auth.uid(); their server-side
  -- caller supplies the already-resolved internal users.id.
  IF p_preferred_actor IS NOT NULL THEN
    SELECT u.id INTO v_actor
    FROM public.users u
    WHERE u.id = p_preferred_actor
    LIMIT 1;
  END IF;

  RETURN v_actor;
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_resolve_os_actor(text, uuid)
  FROM PUBLIC, anon, authenticated;

-- Fix only revisions whose exact OS + timestamp maps to exactly one actor.
-- No before_data/after_data payload is rewritten.
WITH uniquely_attributed AS (
  SELECT
    e.work_order_id,
    e.created_at,
    (array_agg(DISTINCT e.actor_user_id))[1] AS actor_user_id
  FROM public.dbs_control_work_order_events e
  WHERE e.actor_user_id IS NOT NULL
  GROUP BY e.work_order_id, e.created_at
  HAVING count(DISTINCT e.actor_user_id) = 1
)
UPDATE public.dbs_control_work_order_revisions r
SET actor_user_id = u.actor_user_id
FROM uniquely_attributed u
WHERE r.actor_user_id IS NULL
  AND r.work_order_id = u.work_order_id
  AND r.recorded_at = u.created_at;

CREATE OR REPLACE FUNCTION public.dbs_control_protect_work_order_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_completed boolean := false;
  new_completed boolean := false;
  actor_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Exclusão física de Ordem de Serviço bloqueada: documento operacional deve ser preservado. Cancele a OS com justificativa e mantenha seu histórico.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_completed := lower(trim(coalesce(OLD.status, ''))) IN ('concluida','concluída','concluido','concluído');
    new_completed := lower(trim(coalesce(NEW.status, ''))) IN ('concluida','concluída','concluido','concluído');

    IF old_completed AND NOT new_completed THEN
      RAISE EXCEPTION 'OS concluída protegida: não é permitido reabrir ou rebaixar o status do documento assinado.'
        USING ERRCODE = '55000';
    END IF;

    IF old_completed AND (
      (nullif(trim(coalesce(OLD.signature_data, '')), '') IS NOT NULL AND nullif(trim(coalesce(NEW.signature_data, '')), '') IS NULL)
      OR (nullif(trim(coalesce(OLD.signature_name, '')), '') IS NOT NULL AND nullif(trim(coalesce(NEW.signature_name, '')), '') IS NULL)
      OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL)
      OR (nullif(trim(coalesce(OLD.technical_opinion, '')), '') IS NOT NULL AND nullif(trim(coalesce(NEW.technical_opinion, '')), '') IS NULL)
      OR (nullif(trim(coalesce(OLD.observation, '')), '') IS NOT NULL AND nullif(trim(coalesce(NEW.observation, '')), '') IS NULL)
    ) THEN
      RAISE EXCEPTION 'OS concluída protegida: assinatura, laudo, observação e data de conclusão não podem ser apagados.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  actor_id := public.dbs_control_resolve_os_actor(NEW.idempotency_key, NULL);
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'DBS_OS_ACTOR_REQUIRED: não foi possível identificar com segurança o usuário responsável pela alteração.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.dbs_control_work_order_revisions
    (work_order_id, protocol, action, before_data, after_data, actor_user_id)
  VALUES (
    NEW.id,
    NEW.protocol,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    actor_id
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_protect_work_order_document()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dbs_control_reject_os_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'DBS_OS_AUDIT_APPEND_ONLY: eventos e revisões de OS são registros permanentes e não podem ser alterados ou excluídos.'
    USING ERRCODE = '55000';
END;
$function$;

DROP TRIGGER IF EXISTS trg_dbs_control_os_events_append_only
  ON public.dbs_control_work_order_events;
CREATE TRIGGER trg_dbs_control_os_events_append_only
BEFORE UPDATE OR DELETE ON public.dbs_control_work_order_events
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_os_history_mutation();

DROP TRIGGER IF EXISTS trg_dbs_control_os_revisions_append_only
  ON public.dbs_control_work_order_revisions;
CREATE TRIGGER trg_dbs_control_os_revisions_append_only
BEFORE UPDATE OR DELETE ON public.dbs_control_work_order_revisions
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_os_history_mutation();

DROP TRIGGER IF EXISTS trg_dbs_control_os_attachments_append_only
  ON public.dbs_control_work_order_attachments;
CREATE TRIGGER trg_dbs_control_os_attachments_append_only
BEFORE UPDATE OR DELETE ON public.dbs_control_work_order_attachments
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_os_history_mutation();

CREATE OR REPLACE FUNCTION public.dbs_control_enforce_os_event_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid;
BEGIN
  actor_id := public.dbs_control_resolve_os_actor(NEW.idempotency_key, NEW.actor_user_id);
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'DBS_OS_ACTOR_REQUIRED: evento sem usuário responsável; gravação bloqueada para evitar histórico anônimo.'
      USING ERRCODE = '42501';
  END IF;
  NEW.actor_user_id := actor_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_enforce_os_event_actor()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dbs_control_os_event_actor
  ON public.dbs_control_work_order_events;
CREATE TRIGGER trg_dbs_control_os_event_actor
BEFORE INSERT ON public.dbs_control_work_order_events
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_enforce_os_event_actor();

CREATE OR REPLACE FUNCTION public.dbs_control_enforce_os_attachment_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid;
BEGIN
  actor_id := public.dbs_control_resolve_os_actor(NULL, NEW.uploaded_by_user_id);
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'DBS_OS_ACTOR_REQUIRED: anexo sem usuário responsável; upload não pode ser registrado.'
      USING ERRCODE = '42501';
  END IF;
  NEW.uploaded_by_user_id := actor_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_enforce_os_attachment_actor()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dbs_control_os_attachment_actor
  ON public.dbs_control_work_order_attachments;
CREATE TRIGGER trg_dbs_control_os_attachment_actor
BEFORE INSERT ON public.dbs_control_work_order_attachments
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_enforce_os_attachment_actor();

CREATE OR REPLACE FUNCTION public.dbs_control_log_os_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.dbs_control_work_order_events
    (work_order_id, actor_user_id, event_type, details, created_at)
  VALUES (
    NEW.work_order_id,
    NEW.uploaded_by_user_id,
    'attachment_added',
    jsonb_build_object(
      'attachment_id', NEW.id,
      'attachment_type', NEW.attachment_type,
      'file_name', NEW.file_name,
      'file_type', NEW.file_type
    ),
    NEW.created_at
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_log_os_attachment()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dbs_control_log_os_attachment
  ON public.dbs_control_work_order_attachments;
CREATE TRIGGER trg_dbs_control_log_os_attachment
AFTER INSERT ON public.dbs_control_work_order_attachments
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_log_os_attachment();

-- Bring existing attachment metadata into the audit timeline exactly once.
-- The binary objects stay in Storage; only metadata is recorded here.
INSERT INTO public.dbs_control_work_order_events
  (work_order_id, actor_user_id, event_type, details, created_at)
SELECT
  a.work_order_id,
  a.uploaded_by_user_id,
  'attachment_added',
  jsonb_build_object(
    'attachment_id', a.id,
    'attachment_type', a.attachment_type,
    'file_name', a.file_name,
    'file_type', a.file_type
  ),
  a.created_at
FROM public.dbs_control_work_order_attachments a
WHERE a.uploaded_by_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.dbs_control_work_order_events e
    WHERE e.event_type = 'attachment_added'
      AND e.details->>'attachment_id' = a.id::text
  );

COMMENT ON FUNCTION public.dbs_control_resolve_os_actor(text, uuid)
  IS 'Resolve DBS Control internal user id from trusted command idempotency, persisted user id or auth.uid mapping. Internal trigger helper.';
COMMENT ON FUNCTION public.dbs_control_reject_os_history_mutation()
  IS 'Blocks UPDATE and DELETE on append-only DBS Control operational audit tables.';
