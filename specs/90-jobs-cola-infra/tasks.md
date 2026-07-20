# Feature 90 — Infraestructura de cola de background jobs (tasks)

Checklist discreto y verificable. `[P]` = paralelizable con las tareas de su mismo bloque.
Cada tarea indica archivos esperados, dependencias y criterio de "hecho". Los `R<n>` refieren
a `requirements.md`.

> **Bloqueo del gate F1.4:** las preguntas abiertas de `requirements.md` (horario 00:00 vs
> 01:00 CR, `max_intentos` por-job vs global, `payload` con fecha CR vs derivada, conservar/
> eliminar ruta manual, contrato de conteos) deben resolverse ANTES de T5/T6/T7 (cálculo de
> recurrencia y payload). T1–T4 no dependen de ellas.

---

## Bloque 1 — Modelo de datos y migración (base, sin dependencias)

- [x] **T1. Enums + modelo Prisma.** (R1, R2)
  Archivos: `db/schema.prisma`.
  Añadir `enum JobTipo { liberar_reprogramadas @@map("job_tipo") }`,
  `enum JobEstado { pending processing done failed @@map("job_estado") }` y `model Job`
  (`@@map("jobs")`) según design §1.1/§1.2.
  Hecho: `pnpm run db:generate` regenera el cliente sin error y `Job`/`JobTipo`/`JobEstado`
  existen en el cliente Prisma.

- [x] **T2. Migración up/down.** (R3, R4, R5, R6) — depende de T1.
  Archivos: `db/migrations/<ts>_jobs_cola/migration.sql`, `db/migrations/<ts>_jobs_cola/down.sql`.
  `pnpm run db:migrate:create`; editar a mano `migration.sql` para añadir los dos `CREATE TYPE`,
  la tabla, el **índice parcial** `jobs_run_after_pending_idx ... WHERE estado='pending'`, el
  **único parcial** `jobs_dedupe_key_key ... WHERE dedupe_key IS NOT NULL`, y
  `ENABLE ROW LEVEL SECURITY` sin policies. Escribir `down.sql` (DROP TABLE + DROP TYPE x2).
  Hecho: `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte dejando el schema sin
  `jobs` ni los enums; ambos archivos existen.

---

## Bloque 2 — Config (independiente del bloque 1)

- [x] **T3. `loadJobsConfig()`.** (R21) — `[P]` (independiente de T1/T2).
  Archivos: `lib/config/jobs.ts`.
  Clon de `lib/config/cron.ts`: lee `JOBS_BATCH_SIZE`, `JOBS_MAX_ATTEMPTS`,
  `JOBS_BACKOFF_BASE_MS`, `JOBS_BACKOFF_CAP_MS`, `JOBS_VISIBILITY_TIMEOUT_MS` con defaults
  (visibility = 3_600_000). El secreto reutiliza `loadCronConfig()` (no env nuevo).
  Hecho: unit test `tests/unit/config/jobs-config.test.ts` verifica lectura de cada env y su
  default; `pnpm run typecheck` en verde.

---

## Bloque 3 — Repository (depende de T1; el test DB de T5 depende de T2)

- [x] **T4. Interfaz + DTO del repositorio.** (R7, R9, R10) — depende de T1.
  Archivos: `lib/interfaces/repositories/IJobRepository.ts` (+ tipo `JobDTO`, `EnqueueOpts`,
  `ClaimOpts` colocados junto a la interfaz o en `lib/types/`).
  Declarar `enqueue`, `claimBatch`, `complete`, `fail` según design §3.
  Hecho: `pnpm run typecheck` en verde; la interfaz no expone `PrismaClient`.

- [x] **T5. Implementación `JobRepository`.** (R7, R8, R9, R10, R11, R12, R13, R14, R16) —
  depende de T2 y T4.
  Archivos: `lib/repositories/JobRepository.ts`.
  Constructor `Pick<PrismaClient, "job" | "$transaction" | "$queryRaw" | "$executeRaw">`
  (estilo `ApiKeyRepository`). `enqueue` con `ON CONFLICT (dedupe_key) DO NOTHING` y soporte
  `tx`. `claimBatch` con la CTE `FOR UPDATE SKIP LOCKED` de design §3.1. `complete`/`fail`.
  Hecho: compila; tests de T8 pasan.

---

## Bloque 4 — Service, handler y recurrencia (depende de T3, T4; gate F1.4 resuelto)

- [x] **T6. Interfaz del service.** (R18) — depende de T4.
  Archivos: `lib/interfaces/services/IJobQueueService.ts` (+ tipos `JobHandler`, contrato de
  conteos de `drenar`).
  Hecho: `pnpm run typecheck` en verde.

- [x] **T7. Implementación `JobQueueService`.** (R14, R15, R16, R23, R24, R25) —
  depende de T3, T5, T6 y **gate F1.4**.
  Archivos: `lib/services/JobQueueService.ts`.
  DI por interfaces + `Map<JobTipo, JobHandler>` + `now` inyectable + logger sin PII. `drenar`:
  claim → handler → complete/backoff/dead-letter; re-agenda recurrentes en éxito Y en fallo
  terminal (`enqueue` con dedupe por día CR). Backoff `min(cap, base*2^(intentos-1))`.
  Hecho: unit tests de T9 pasan (backoff, dead-letter, recurrencia en éxito y en fallo).

- [x] **T8. Handler `liberar_reprogramadas` + registro de recurrencia.** (R22, R23, R24) —
  depende de T7 y **gate F1.4** (horario + payload).
  Archivos: `lib/services/jobs/liberar-reprogramadas-handler.ts` (ruta a confirmar), registro
  de "recurrencia por tipo".
  Wrapper delgado sobre `LiberacionReprogramadaService.ejecutarLiberacion(startOfDayCR(now))`
  usando el mismo `buildService()` (Liberacion/Zona/Orden repos). Próxima corrida CR +
  `dedupeKey = "liberar_reprogramadas:<YYYY-MM-DD CR>"` con `lib/utils/fecha-cr.ts`.
  Hecho: unit test verifica que invoca `ejecutarLiberacion` una vez y NO reimplementa la lógica.

---

## Bloque 5 — Controller, cron y seed (depende de T7/T8)

- [x] **T9. Route handler `procesar-jobs`.** (R17, R18, R19) — depende de T7.
  Archivos: `app/api/cron/procesar-jobs/route.ts`.
  Clon de `liberar-reprogramadas/route.ts`: `Deps` inyectables, `buildService()`, auth Bearer
  vs `CRON_SECRET` ANTES de efectos (401), `withErrorHandler` + `isAppErrorShape` +
  `appErrorToResponse`, `GET` delgado, 200 con conteos sin PII.
  Hecho: route test de T11 pasa.

- [x] **T10. `vercel.json` — añadir drenado, quitar liberar-reprogramadas.** (R20, R27) —
  depende de T9. `[P]` con T8 (solo toca JSON).
  Archivos: `vercel.json`.
  Añadir `{ "path": "/api/cron/procesar-jobs", "schedule": "* * * * *" }`; eliminar el bloque
  de `/api/cron/liberar-reprogramadas`. Conservar `corte-diario` y `generar-gastos-fijos`.
  Hecho: `procesar-jobs` presente con `* * * * *`; `liberar-reprogramadas` ausente de `crons`.

- [x] **T11. Seed inicial idempotente.** (R26) — depende de T5 y **gate F1.4**.
  Archivos: `scripts/seed-jobs-liberar-reprogramadas.ts` (o migración de datos idempotente —
  decidir aquí).
  `enqueue` de la primera fila `liberar_reprogramadas` con `ON CONFLICT DO NOTHING`.
  Hecho: ejecutarlo dos veces deja exactamente una fila para la fecha CR sembrada.

- [x] **T12. Repurpose ruta manual (verificación).** (R27) — depende de T10.
  Archivos: `app/api/cron/liberar-reprogramadas/route.ts` (sin cambios de código esperados).
  Confirmar que la ruta sigue autorizando y respondiendo conteos como disparo manual.
  Hecho: los tests existentes de la ruta siguen verdes; solo perdió su `schedule` (T10).

---

## Bloque 6 — Tests (mapeo R→test; algunos escritos junto a su bloque)

- [x] **T13. Tests de integración DB del repositorio.** (R1–R6, R7, R8, R10, R11, R12, R13,
  R14, R16, R25, R26) — depende de T5, T11.
  Archivos: `tests/integration/db/job-repository.test.ts` (patrón `tests/integration/db/`).
  Cubre: schema/índices/RLS/migración, enqueue+dedupe, claim SKIP LOCKED, no tomar `run_after`
  futuro, rescate por visibility timeout, complete/dead-letter, recurrencia sin duplicar, seed
  idempotente.
  Hecho: `pnpm test` (integración DB) pasa.

- [x] **T14. Unit tests del service.** (R14, R15, R16, R22, R23, R24) — depende de T7, T8.
  Archivos: `tests/unit/services/job-queue-service.test.ts`.
  Dobles de `IJobRepository` y handlers fake: backoff exponencial acotado, dead-letter al
  superar `max_intentos`, recurrencia en éxito y en fallo terminal, `last_error` sin secreto.
  Hecho: `pnpm test` pasa.

- [x] **T15. Unit test de config.** (R21) — depende de T3. `[P]` con T13/T14.
  Archivos: `tests/unit/config/jobs-config.test.ts`.
  Hecho: `pnpm test` pasa.

- [x] **T16. Route test de `procesar-jobs`.** (R17, R18, R19, R20) — depende de T9, T10.
  Archivos: `tests/integration/actions/procesar-jobs-route.test.ts`.
  Clon de `corte-diario-route.test.ts`: 401 sin/incorrecto/null secreto SIN efectos (spy no
  invocado), 200 con conteos sin PII, error del service → ≥500 sin filtrar secreto, y bloque
  que valida `vercel.json` (procesar-jobs presente, liberar-reprogramadas ausente).
  Hecho: `pnpm test` pasa.

- [x] **T17. Cierre de verificación.** — depende de todas.
  `./init.sh` en verde, `pnpm run typecheck`, `pnpm run lint`, `pnpm test`. Mapa `R<n> → test`
  en `progress/impl_90.md`. Marcar todas las tasks `[x]`.
  Hecho: CHECKPOINTS.md cumplido; cada R1–R27 mapea a al menos un test.

---

## Resumen de archivos esperados

| Archivo | Task |
|---------|------|
| `db/schema.prisma` (Job + enums) | T1 |
| `db/migrations/<ts>_jobs_cola/migration.sql` + `down.sql` | T2 |
| `lib/config/jobs.ts` | T3 |
| `lib/interfaces/repositories/IJobRepository.ts` | T4 |
| `lib/repositories/JobRepository.ts` | T5 |
| `lib/interfaces/services/IJobQueueService.ts` | T6 |
| `lib/services/JobQueueService.ts` | T7 |
| `lib/services/jobs/liberar-reprogramadas-handler.ts` (ruta a confirmar) | T8 |
| `app/api/cron/procesar-jobs/route.ts` | T9 |
| `vercel.json` | T10 |
| `scripts/seed-jobs-liberar-reprogramadas.ts` (o migración de datos) | T11 |
| `app/api/cron/liberar-reprogramadas/route.ts` (repurpose, sin cambio de código) | T12 |
| `tests/integration/db/job-repository.test.ts` | T13 |
| `tests/unit/services/job-queue-service.test.ts` | T14 |
| `tests/unit/config/jobs-config.test.ts` | T15 |
| `tests/integration/actions/procesar-jobs-route.test.ts` | T16 |
| `progress/impl_90.md` (mapa R→test) | T17 |

## Grafo de dependencias (resumen)

```
T1 ─┬─ T2 ─┬─ T5 ─┬─ T7 ─┬─ T8 ── T9 ── T10 ── T12
    │       │      │      │              └─ T16
    └─ T4 ──┘      │      └─ T11 ── T13
T3 [P] ── T15      T6 ────┘
                   T14 (← T7,T8)
Todo → T17
```
