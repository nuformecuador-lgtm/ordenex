# Feature 90 — Infraestructura de cola de background jobs (bitácora de implementación)

Backend puro. Cola transactional-outbox + worker sobre Postgres, drenada por Vercel Cron
cada minuto (`/api/cron/procesar-jobs`), + migración del cron `liberar-reprogramadas`
(feature 46) a job recurrente. Decisiones del gate F1.4 (1–5) respetadas.

## Archivos creados

- `db/schema.prisma` (MOD): enums nativos `JobTipo`/`JobEstado` (`@@map`), modelo `Job` (`@@map("jobs")`).
- `db/migrations/20260717120000_jobs_cola/migration.sql` + `down.sql` (UP/DOWN).
- `lib/config/jobs.ts` — `loadJobsConfig()` (5 envs con defaults; secreto reusa `CRON_SECRET`).
- `lib/interfaces/repositories/IJobRepository.ts` — `JobDTO`, `EnqueueOpts`, `ClaimOpts`, `JobTxClient`.
- `lib/repositories/JobRepository.ts` — enqueue (ON CONFLICT DO NOTHING + `tx`), claim (CTE FOR UPDATE SKIP LOCKED), complete, fail.
- `lib/interfaces/services/IJobQueueService.ts` — `JobHandler`, `RecurrenciaSpec`, `DrenarResult`.
- `lib/services/JobQueueService.ts` — drenar: claim→handler→complete/backoff/dead-letter + recurrencia.
- `lib/services/jobs/liberar-reprogramadas-handler.ts` — handler delgado + recurrencia 00:00 CR + buildService.
- `app/api/cron/procesar-jobs/route.ts` — controller (clon de liberar-reprogramadas).
- `scripts/seed-jobs-liberar-reprogramadas.ts` — seed idempotente de la 1ª fila.
- `tests/unit/config/jobs-config.test.ts`, `tests/unit/services/job-queue-service.test.ts`,
  `tests/unit/services/liberar-reprogramadas-handler.test.ts`,
  `tests/integration/actions/procesar-jobs-route.test.ts`,
  `tests/integration/db/jobs-cola-migration.test.ts`.

## Archivos modificados (fuera del núcleo)

- `vercel.json` — añade `procesar-jobs` (`* * * * *`); elimina el schedule de `liberar-reprogramadas`; conserva corte-diario y generar-gastos-fijos.
- `tests/integration/db/zonas-migration.test.ts` — añade `_jobs_cola` al whitelist de migraciones post-zonas (patrón obligado para toda migración nueva; igual que features 67/73/76/81).
- `app/api/cron/liberar-reprogramadas/route.ts` — SIN cambio de código (repurpose por T10, R27).

## Mapa R → test

| R | Test |
|---|------|
| R1 | jobs-cola-migration (defaults/columnas) + round-trip real DB (defaults pending/0/{}) |
| R2 | jobs-cola-migration (enums) + round-trip real DB (enum inválido rechazado) |
| R3 | jobs-cola-migration (índice parcial) + real DB (`pg_indexes` WHERE estado='pending') |
| R4 | jobs-cola-migration (único parcial) + real DB (dedupe 1 fila; NULLs coexisten) |
| R5 | jobs-cola-migration (RLS sin policy) + real DB (`relrowsecurity=t`, 0 policies) |
| R6 | jobs-cola-migration (down existe/borra) + real DB (down→0,0,0 → re-up OK) |
| R7 | real DB (INSERT default pending/0) + repo enqueue |
| R8 | real DB (2 enqueue mismo dedupe → 1 fila) |
| R9 | IJobRepository.enqueue acepta `tx`; JobRepository usa `tx ?? this.prisma` |
| R10 | real DB (claim marca processing/intentos+1/locked) + service claim opts |
| R11 | real DB (2 sesiones concurrentes: B salta la fila lockeada por A → disjunto) |
| R12 | real DB (pending run_after futuro NO reclamado) |
| R13 | real DB (processing locked viejo rescatado; reciente NO) + service visibilityCutoff |
| R14 | job-queue-service (handler ok → complete, ok=1) |
| R15 | job-queue-service (backoff base*2^(n-1) saturado en cap; last_error sin secreto) |
| R16 | job-queue-service (intentos>=max → fail null, muertos=1) |
| R17 | procesar-jobs-route (sin/incorrecto/null secreto → 401 sin efectos) |
| R18 | procesar-jobs-route (200 conteos `{procesados,ok,fallidos,reintentados,muertos}` sin PII) |
| R19 | procesar-jobs-route (service lanza → ≥500 sin filtrar secreto) |
| R20 | procesar-jobs-route (vercel.json: procesar-jobs `* * * * *`; liberar-reprogramadas ausente) |
| R21 | jobs-config (cada env + default; visibility default 3_600_000) |
| R22 | liberar-reprogramadas-handler (invoca ejecutarLiberacion 1× con startOfDayCR(now)) |
| R23 | job-queue-service (éxito recurrente → enqueue próxima) + handler (00:00 CR + dedupe) |
| R24 | job-queue-service (fallo terminal recurrente → dead-letter + enqueue próxima) |
| R25 | real DB (dedupe único parcial: 2 mismos dedupe → 1) |
| R26 | seed usa enqueue ON CONFLICT DO NOTHING (mismo mecanismo de dedupe verificado en DB) |
| R27 | liberar-reprogramadas-route (401/200/error de la ruta manual siguen verdes; bloque de schedule INVERTIDO: liberar-reprogramadas ausente de crons, corte-diario conservado) + ruta sin cambio de código |

## Verificación medida

- `pnpm typecheck`: **0 errores** (baseline 0 preservado).
- `pnpm lint` (archivos de la feature): **0 errores, 0 warnings**.
- Tests de la feature en aislamiento (6 archivos): **55 passed, 0 failed** (1.73 s).
  Suite completa: 5 fallos NO relacionados con el código de esta feature — 1 era
  `zonas-migration` (whitelist, YA corregido) y los otros (p. ej. `no-embalaje`, un walk del
  FS con timeout de 5 s) fallaron por carga del run paralelo de 212 s; pasan en aislamiento
  (`no-embalaje`: 1 passed, 673 ms).

## Round-trip real (Postgres 16 desechable en docker — `ordenex-f90-pg`, base `f90`, NUNCA la DB compartida)

Ejecutado sobre la tabla `jobs` standalone (sin FKs). Evidencia verificada con psql:
- UP aplica limpio; `jobs_run_after_pending_idx` con `WHERE (estado='pending')`,
  `jobs_dedupe_key_key` UNIQUE con `WHERE (dedupe_key IS NOT NULL)`; `relrowsecurity=t`, 0 policies.
- Defaults: estado=pending, intentos=0, run_after no nulo, payload `{}`.
- Enum inválido rechazado; dedupe → 1 fila; 3 filas con dedupe NULL coexisten.
- Claim (now=12:00, cutoff=11:00): reclama SOLO pending-vencido y processing-viejo; ignora
  pending-futuro, processing-reciente y done; marca processing/intentos+1/locked=now.
- Concurrencia SKIP LOCKED: sesión A lockea j1 (tx abierta) → sesión B reclama SOLO j2 (disjunto).
- DOWN deja 0 tabla / 0 enums; re-UP reconstruye. Contenedor eliminado tras la prueba.

PENDIENTE de CI/humano: NO se ejecutó `prisma migrate deploy` de la cadena completa contra
`DATABASE_URL` (guardrail: DB dev compartida con features en vuelo). El round-trip de la
migración `jobs_cola` se validó de forma aislada en docker (arriba) y estáticamente en
`jobs-cola-migration.test.ts`.

## Veredicto

Infraestructura de cola de jobs completa y verificada (typecheck 0, lint 0, 55 tests verdes,
round-trip real en Postgres desechable); lista para review.
