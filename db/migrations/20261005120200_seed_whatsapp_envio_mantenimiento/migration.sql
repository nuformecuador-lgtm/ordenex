-- FICHA 474 (design §1.6, T1.3) — SIEMBRA del job RECURRENTE `whatsapp_envio_mantenimiento`.
--
-- POR QUE EN UNA MIGRACION Y NO EN UN SCRIPT: una siembra por script es un paso que alguien olvida
-- (leccion del repo). Un recurrente sin su primera fila no corre NUNCA, y no falla: simplemente no
-- hay nada en la cola. Aqui viaja con el despliegue, en todos los entornos que migran.
--
-- Va DESPUES de `20261005120000_job_tipo_whatsapp_envios`: usar un valor de enum en la misma
-- transaccion que lo anadio da 55P04.
--
-- PROXIMA 09:30 UTC (= 03:30 CR, UTC-6 fijo) estrictamente posterior al momento de migrar.
-- `dedupe_key` = `whatsapp_envio_mantenimiento:<fecha CR de esa corrida>`, la MISMA forma que usa
-- `recurrenciaWhatsappEnvioMantenimiento` (lib/services/jobs/whatsapp-envio-mantenimiento-handler.ts):
-- si el drenador ya re-encolo esa ocurrencia, el INSERT no crea otra.
--
-- Idempotente: `ON CONFLICT (dedupe_key) DO NOTHING` apunta al indice unico PARCIAL de la cola.
INSERT INTO "jobs" (
  "id", "tipo", "payload", "estado", "intentos", "max_intentos",
  "run_after", "dedupe_key", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'whatsapp_envio_mantenimiento',
  '{}'::jsonb,
  'pending',
  0,
  3,
  t."run_after",
  'whatsapp_envio_mantenimiento:' || to_char(t."run_after", 'YYYY-MM-DD'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT CASE
    WHEN date_trunc('day', now() AT TIME ZONE 'UTC') + interval '9 hours 30 minutes' > (now() AT TIME ZONE 'UTC')
      THEN date_trunc('day', now() AT TIME ZONE 'UTC') + interval '9 hours 30 minutes'
    ELSE date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day 9 hours 30 minutes'
  END AS "run_after"
) AS t
ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING;
