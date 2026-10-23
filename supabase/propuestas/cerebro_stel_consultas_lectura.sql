-- Registro privado para consultas de costes iniciadas por el backend autorizado.
-- No concede permisos ni acceso a STEL a usuarios anon/authenticated.
CREATE TABLE public.cerebro_stel_consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  token_hash text UNIQUE CHECK (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  claimed_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error_code text,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CHECK (token_hash IS NOT NULL OR claimed_at IS NOT NULL)
);
ALTER TABLE public.cerebro_stel_consultas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cerebro_stel_consultas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cerebro_stel_consultas TO service_role;
COMMENT ON TABLE public.cerebro_stel_consultas IS
  'Consultas STEL de solo lectura. Backend autorizado: capacidad SHA-256 de un uso y 5 minutos; resultados privados. No contiene claves API.';
