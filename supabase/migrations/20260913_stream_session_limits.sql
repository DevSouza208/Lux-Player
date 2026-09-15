-- ============================================================
-- [LUX-IPTV-STREAM-001] CONTROLE DE STREAMS SIMULTÂNEOS
-- ============================================================
-- Conta somente sessões de reprodução. App aberto/login não ocupam slot.
-- Contas Lux diferentes que compartilham a mesma origem IPTV usam o mesmo
-- source_key calculado pela Edge Function e, portanto, compartilham o limite.
-- ============================================================

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS stream_limit integer NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_stream_limit_check'
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_stream_limit_check CHECK (stream_limit BETWEEN 1 AND 20);
  END IF;
END $$;

COMMENT ON COLUMN public.usuarios.stream_limit IS
  'Máximo de streams simultâneos permitido para a fonte IPTV vinculada à conta. Contas que compartilham a mesma fonte compartilham a capacidade.';

-- Estado inicial solicitado: todos os clientes existentes começam com limite 3.
UPDATE public.usuarios SET stream_limit = 3;

CREATE TABLE IF NOT EXISTS public.stream_sessions (
  session_id text PRIMARY KEY,
  user_name text NOT NULL REFERENCES public.usuarios(usuario) ON UPDATE CASCADE ON DELETE CASCADE,
  source_key text NOT NULL,
  device_id text NOT NULL DEFAULT '',
  profile_key text NOT NULL DEFAULT '',
  media_key text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stream_sessions IS
  'Sessões temporárias de reprodução IPTV. Uma sessão expira quando deixa de enviar heartbeat.';
COMMENT ON COLUMN public.stream_sessions.source_key IS
  'Hash opaco da fonte IPTV; permite contar em conjunto contas diferentes que usam a mesma lista/credencial.';

CREATE INDEX IF NOT EXISTS stream_sessions_source_heartbeat_idx
  ON public.stream_sessions (source_key, last_heartbeat DESC);
CREATE INDEX IF NOT EXISTS stream_sessions_user_heartbeat_idx
  ON public.stream_sessions (user_name, last_heartbeat DESC);

ALTER TABLE public.stream_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stream_sessions FROM anon, authenticated;

-- Aquisição atômica de slot. O advisory lock evita que duas requisições simultâneas
-- ultrapassem o limite por lerem a mesma contagem antes do INSERT.
CREATE OR REPLACE FUNCTION public.acquire_stream_session(
  p_session_id text,
  p_user_name text,
  p_source_key text,
  p_limit integer,
  p_device_id text DEFAULT '',
  p_profile_key text DEFAULT '',
  p_media_key text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active integer := 0;
  v_limit integer := LEAST(20, GREATEST(1, COALESCE(p_limit, 3)));
BEGIN
  IF p_session_id IS NULL OR length(p_session_id) < 8 OR length(p_session_id) > 128 THEN
    RAISE EXCEPTION 'session_id inválido';
  END IF;
  IF p_source_key IS NULL OR length(p_source_key) < 16 OR length(p_source_key) > 128 THEN
    RAISE EXCEPTION 'source_key inválido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_key, 0));

  DELETE FROM public.stream_sessions
   WHERE last_heartbeat < now() - interval '90 seconds';

  -- Trocar canal/episódio na mesma aba atualiza a sessão existente sem consumir
  -- um segundo slot da mesma pessoa/dispositivo.
  IF EXISTS (
    SELECT 1 FROM public.stream_sessions
     WHERE session_id = p_session_id AND user_name = p_user_name
  ) THEN
    UPDATE public.stream_sessions
       SET source_key = p_source_key,
           device_id = left(COALESCE(p_device_id, ''), 200),
           profile_key = left(COALESCE(p_profile_key, ''), 200),
           media_key = left(COALESCE(p_media_key, ''), 500),
           last_heartbeat = now()
     WHERE session_id = p_session_id AND user_name = p_user_name;

    SELECT count(*) INTO v_active
      FROM public.stream_sessions
     WHERE source_key = p_source_key
       AND last_heartbeat >= now() - interval '90 seconds';

    RETURN jsonb_build_object('allowed', true, 'active', v_active, 'limit', v_limit, 'reused', true);
  END IF;

  SELECT count(*) INTO v_active
    FROM public.stream_sessions
   WHERE source_key = p_source_key
     AND last_heartbeat >= now() - interval '90 seconds';

  IF v_active >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'active', v_active, 'limit', v_limit, 'reused', false);
  END IF;

  INSERT INTO public.stream_sessions(
    session_id, user_name, source_key, device_id, profile_key, media_key, started_at, last_heartbeat
  ) VALUES (
    p_session_id, p_user_name, p_source_key,
    left(COALESCE(p_device_id, ''), 200),
    left(COALESCE(p_profile_key, ''), 200),
    left(COALESCE(p_media_key, ''), 500),
    now(), now()
  );

  v_active := v_active + 1;
  RETURN jsonb_build_object('allowed', true, 'active', v_active, 'limit', v_limit, 'reused', false);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_stream_session(text,text,text,integer,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_stream_session(text,text,text,integer,text,text,text) TO service_role;