# Review - Feature 90 (infraestructura de cola de background jobs)

Rama feature/90-jobs-cola-infra @ 9db7256 (fix del bloqueante sobre 57c53ea). Worktree ordenex-f90.
Reviewer: verifica, no edita.

## Veredicto: APROBADO - 0 bloqueantes

El unico bloqueante (test heredado de la 46 que seguia afirmando el schedule ya eliminado) fue
corregido en 9db7256: el bloque se invirtio a afirmar la AUSENCIA de /api/cron/liberar-reprogramadas
en crons (toBeUndefined()), conservando el guard de corte-diario y sin duplicar la asercion positiva
de procesar-jobs (que ya vive en procesar-jobs-route.test.ts). Los tests de auth/conteos/error de la
ruta manual (R27) no se tocaron. Feature tecnicamente solida: typecheck 0, lint 0, correccion del
claim/backoff/recurrencia/migracion/controller verificada, alcance sin fugas.

---

## Evidencia medida (re-verificada tras el fix 9db7256)

- pnpm typecheck: 0 errores (baseline preservado). OK
- eslint sobre los archivos tocados (incl. ambos tests de ruta): 0 err / 0 warn. OK
- Tests de la feature en AISLADO (6 archivos, incluidos los DOS de ruta): 43 passed / 0 failed (1.6 s). OK
- git diff del fix (9db7256): solo tests/integration/actions/liberar-reprogramadas-route.test.ts
  (+ bookkeeping en impl_90.md/review_90.md). No re-introduce el schedule; usa toBeUndefined(). OK
- git diff --stat origin/dev...HEAD: acotado a los archivos de tasks.md; sin fugas a
  OrdenRepository/appendCambioEstado/carga masiva; liberar-reprogramadas/route.ts sin cambio de
  codigo; JobTipo solo liberar_reprogramadas. OK

## Cierre del bloqueante (antes BLOQUEANTE-1)

tests/integration/actions/liberar-reprogramadas-route.test.ts:108-116 ahora afirma:
    const cron = cfg.crons.find((c) => c.path === "/api/cron/liberar-reprogramadas");
    expect(cron).toBeUndefined();                    // realidad post-feature-90
    expect(...corte-diario...).toBeDefined();         // guard de la 41 conservado
Refleja la realidad post-migracion (schedule movido a procesar-jobs). No re-introduce el schedule
ni duplica la asercion positiva. Test verde. CERRADO.

## Checklist CHECKPOINTS / spec

- [x] requirements.md (EARS R1-R27) / design.md (alternativas A-F descartadas) / tasks.md (todas [x]).
- [x] progress/impl_90.md con mapa R->test.
- [x] typecheck sin errores. / [x] lint sin errores.
- [x] pnpm test (feature, 6 archivos) verde -- incluidos los dos tests de ruta.
- [x] RLS habilitada sin policies en jobs (migracion; estatico + evidencia docker declarada).
- [x] Migracion versionada y reversible (migration.sql + down.sql revierte tabla + 2 enums).
- [x] Sin secretos hardcodeados; todo por env; last_error/logs sin PII ni secreto.
- [x] Capas Controller->Service->Repo; interfaces en lib/interfaces/; DTOs planos.
- [x] Multi-config: parametros de cola por env con defaults; secreto reusa CRON_SECRET.

## Correccion tecnica verificada (positivo)

- Claim FOR UPDATE SKIP LOCKED (design 3.1): CTE atomica unica, toma pending vencido
  (run_after <= $now) OR processing colgado (locked_at < $visibilityCutoff), marca processing, sella
  locked_at, incrementa intentos, RETURNING j.*. now/visibilityCutoff INYECTADOS (no NOW() de Postgres). OK
- Backoff min(cap, base*2^(intentos-1)) + dead-letter al agotar max_intentos (por-fila). Test cubre
  saturacion en cap y last_error sin secreto. OK
- Recurrencia en exito (R23) Y en fallo terminal (R24): ambos con test unit. OK
- Idempotencia: ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING;
  dedupe_key = "liberar_reprogramadas:<YYYY-MM-DD CR>". OK
- Handler = wrapper delgado sobre ejecutarLiberacion(startOfDayCR(now)), sin reescribir logica (R22).
  Recurrencia 00:00 CR = 06:00 UTC (gate F1.4-1) con test de cruce de fin de mes. OK
- Migracion: indices PARCIALES, RLS ENABLE sin policy, down.sql revierte tabla + 2 enums. SQL correcto. OK
- Controller procesar-jobs: auth Bearer vs CRON_SECRET ANTES de efectos (401 sin construir service),
  withErrorHandler + isAppErrorShape + appErrorToResponse, 200 con conteos sin PII. Clon fiel de la 46. OK
- Decisiones gate F1.4 (1-5) respetadas. OK

---

## Hallazgos menores (no bloquean; quedan como seguimiento, NO condicionan la aprobacion)

- menor - Trazabilidad de comportamiento del SQL crudo (R7, R8, R10-R13, R25): no hay test EJECUTABLE
  reproducible en la suite que ejerza el SQL real (enqueue ON CONFLICT, claim FOR UPDATE SKIP LOCKED,
  visibility, run_after futuro). Cobertura = migracion estatica (regex) + service con repo fake. El
  round-trip real fue en Postgres docker desechable (documentado en impl_90.md), no reproducible en
  CI. Se acepta la evidencia docker declarada segun la latitud otorgada al review para lo DB-level;
  se registra el gap de reproducibilidad (la CTE del claim es el nucleo de la feature).
- menor - R26 (seed idempotente) sin test propio; seedJobLiberarReprogramadas es exportada y testeable
  con fake repo. La idempotencia subyacente (indice unico parcial + ON CONFLICT) si esta evidenciada.
- menor - Bitacora: impl_90.md reporto "55 passed, 6 archivos"; el real es 43 tests en 6 archivos
  (36 en 5 antes del fix). Inexactitud sin impacto funcional.
- menor - Layering: JobRepository.enqueue llama a loadJobsConfig() para el default de max_intentos
  (leve acoplamiento repo->config; consistente con el requisito por-fila).
- observacion (OK): logger por defecto de JobQueueService usa console.warn; paso lint, inyectable,
  sin PII/secreto.

Estos menores son deuda tecnica opcional para 91/92; no bloquean el cierre de la 90.
