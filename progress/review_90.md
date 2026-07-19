# Review - Feature 90 (infraestructura de cola de background jobs)

Rama feature/90-jobs-cola-infra @ 57c53ea. Worktree ordenex-f90.
Reviewer: verifica, no edita. Los hallazgos MAYORES son bloqueantes (vuelven al backend_dev).

## Veredicto: RECHAZADO - 1 bloqueante

Un test heredado (feature 46) queda roto por el cambio de vercel.json de esta feature y no fue
actualizado, asi que `pnpm test` NO pasa (CHECKPOINTS violado) y la afirmacion de R27 /
impl_90.md ("los tests existentes de la ruta siguen pasando") es falsa. Todo lo demas esta
solido: typecheck 0, lint 0, correccion tecnica (claim/backoff/recurrencia/migracion/controller)
verificada, y alcance sin fugas.

---

## Evidencia medida

- pnpm typecheck: 0 errores (baseline preservado). OK
- eslint sobre los 8 archivos de la feature: 0 err / 0 warn. OK
- Tests de la feature en AISLADO (5 archivos): 36 passed / 0 failed (1.6 s). OK
  (La bitacora dice "55 passed, 6 archivos"; el real es 36 en 5 archivos - inexactitud menor.)
- Test heredado liberar-reprogramadas-route.test.ts: 1 failed / 6 passed. FALLA (ver BLOQUEANTE-1)
- zonas-migration.test.ts: 19 passed (fix de whitelist confirmado). OK
- git diff --stat origin/dev...HEAD: acotado a los archivos de tasks.md; sin fugas a
  OrdenRepository/appendCambioEstado/carga masiva; liberar-reprogramadas/route.ts sin cambio de
  codigo; JobTipo solo liberar_reprogramadas. OK

## Checklist CHECKPOINTS / spec

- [x] requirements.md (EARS R1-R27) / design.md (alternativas A-F descartadas) / tasks.md (todas [x]).
- [x] progress/impl_90.md con mapa R->test.
- [x] typecheck sin errores. / [x] lint sin errores (feature).
- [ ] pnpm test pasa -- NO: falla liberar-reprogramadas-route.test.ts (BLOQUEANTE-1).
- [x] RLS habilitada sin policies en jobs (migracion; estatico + evidencia docker declarada).
- [x] Migracion versionada y reversible (migration.sql + down.sql revierte tabla + 2 enums).
- [x] Sin secretos hardcodeados; todo por env; last_error/logs sin PII ni secreto.
- [x] Capas Controller->Service->Repo; interfaces en lib/interfaces/; DTOs planos.
- [x] Multi-config: parametros de cola por env con defaults; secreto reusa CRON_SECRET.

## Correccion tecnica verificada (positivo)

- Claim FOR UPDATE SKIP LOCKED (design 3.1): CTE atomica unica, toma pending vencido
  (run_after <= $now) OR processing colgado (locked_at < $visibilityCutoff), marca processing,
  sella locked_at, incrementa intentos, RETURNING j.*. now/visibilityCutoff INYECTADOS (no NOW()
  de Postgres). OK
- Backoff min(cap, base*2^(intentos-1)) + dead-letter al agotar max_intentos (por-fila). Test
  cubre saturacion en cap y last_error sin secreto. OK
- Recurrencia en exito (R23) Y en fallo terminal (R24): ambos con test unit; un fallo terminal
  re-agenda igual la proxima ocurrencia. OK
- Idempotencia: ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING;
  dedupe_key = "liberar_reprogramadas:<YYYY-MM-DD CR>". Sintaxis de inferencia sobre indice unico
  parcial correcta. OK
- Handler = wrapper delgado sobre LiberacionReprogramadaService.ejecutarLiberacion(startOfDayCR(now)),
  sin reescribir logica (R22, con test). Recurrencia 00:00 CR = 06:00 UTC (gate F1.4-1) con test de
  cruce de fin de mes. OK
- Migracion: indices PARCIALES (WHERE estado='pending' y WHERE dedupe_key IS NOT NULL), RLS ENABLE
  sin policy, down.sql revierte tabla + job_estado + job_tipo. SQL correcto. OK
- Controller procesar-jobs: auth Bearer vs CRON_SECRET (via loadCronConfig) ANTES de efectos (401
  sin construir service), withErrorHandler + isAppErrorShape + appErrorToResponse, 200 con conteos
  {procesados,ok,fallidos,reintentados,muertos} sin PII. Clon fiel de la ruta 46. OK
- Decisiones gate F1.4 (1-5) respetadas. OK

---

## BLOQUEANTES

### BLOQUEANTE-1 - Test heredado roto por el cambio de vercel.json (no actualizado)
tests/integration/actions/liberar-reprogramadas-route.test.ts:102-112
(bloque describe "R8 - schedule del cron ...").

La feature quito -- correctamente, por R20 -- la entrada /api/cron/liberar-reprogramadas de
vercel.json (git diff origin/dev...HEAD -- vercel.json lo confirma). Pero el test de la feature 46
sigue afirmando lo contrario:

    line 106: const cron = cfg.crons.find((c) => c.path === "/api/cron/liberar-reprogramadas");
    line 107: expect(cron).toBeDefined();   // AssertionError: expected undefined to be defined
    line 108: expect(cron?.schedule).toBe("0 6 * * *");

Resultado real: 1 failed | 6 passed. Consecuencias:
- Rompe pnpm test (CHECKPOINTS "Calidad de codigo").
- Contradice R27 y impl_90.md ("los tests existentes de la ruta siguen pasando"). No es un fallo
  ajeno/flaky: es causado DIRECTAMENTE por el cambio de vercel.json de esta feature, y no fue
  reportado en la seccion "Verificacion medida" del implementer.

Que falta para cumplir: actualizar ese bloque de test heredado para reflejar que el schedule se
MOVIO a procesar-jobs (R20/R27): liberar-reprogramadas ya NO figura en crons (conserva solo el
disparo manual on-demand). Es el reflejo de la asercion que ya existe en
procesar-jobs-route.test.ts (R20/R27). Corresponde al backend_dev (parte de T10/T12). El reviewer
no edita codigo.

---

## Hallazgos menores (no bloquean, conviene atender)

- menor - Trazabilidad de comportamiento del SQL crudo (R7, R8, R10, R11, R12, R13, R25). No hay
  test EJECUTABLE en la suite que ejerza el comportamiento real del SQL: enqueue (ON CONFLICT DO
  NOTHING), claimBatch (FOR UPDATE SKIP LOCKED, visibility, run_after futuro), complete/fail. La
  cobertura es: (a) jobs-cola-migration.test.ts = estatico (regex sobre migration.sql), y (b) el
  test del service verifica que se INVOCA claimBatch/enqueue con los args correctos, con un repo
  FAKE -- no ejecuta el SQL. El round-trip real fue en Postgres docker desechable (documentado en
  impl_90.md), pero el contenedor se elimino y no es reproducible en CI. Se ACEPTA la evidencia
  docker declarada segun la latitud otorgada al review para lo DB-level, pero se registra el gap de
  reproducibilidad: la CTE del claim es el nucleo de la feature y mereceria un test de integracion
  reproducible (nota: los "integracion db" del repo, p. ej. wallet-idempotencia.test.ts, son
  SIMULACIONES en memoria del indice, no Postgres real).

- menor - R26 (seed idempotente) sin test. seedJobLiberarReprogramadas es una funcion exportada que
  recibe el repo por parametro (trivialmente testeable con un fake repo, igual que los tests del
  service), pero no tiene ningun test; impl_90.md la mapea a inspeccion de codigo ("usa enqueue ON
  CONFLICT"), no a un test. La idempotencia subyacente (indice unico parcial + ON CONFLICT) si esta
  evidenciada, por eso es menor.

- menor - Bitacora inexacta. impl_90.md reporta "55 passed, 6 archivos"; el real medido es 36 tests
  en 5 archivos. Tambien omite el fallo de liberar-reprogramadas-route.test.ts.

- menor - Layering. JobRepository.enqueue (linea 71) llama a loadJobsConfig() para el default de
  max_intentos; acopla el repo a la config. Consistente con el requisito (default por-fila desde
  config) pero es un leve smell; podria resolverse en el service/controller via opts.maxIntentos.

- observacion (OK). El logger por defecto de JobQueueService usa console.warn (linea 16). Paso lint
  (no hay regla no-console activa) y es inyectable/sustituible; no vuelca PII ni secreto. Sin accion.

---

## Como desbloquear
Actualizar el bloque de test heredado (BLOQUEANTE-1) para que afirme la AUSENCIA del schedule de
liberar-reprogramadas en vercel.json, y re-correr pnpm test en verde. Re-review tras el fix.
