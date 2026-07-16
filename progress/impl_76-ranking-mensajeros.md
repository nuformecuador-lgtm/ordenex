# Implementación 76 — Ranking DIARIO de mensajeros + tabla de premios (BACKEND)

> Zona: backend (controllers/services/repositories/migraciones/RLS/Server Actions/tests).
> Frontend (T8-T10: página, RankingModule, menu-visibility) queda para el frontend_dev.
> **Cambio de alcance (2026-07-16):** la tabla de premios lleva además un campo
> `descripcion` (texto libre opcional por posición, INDEPENDIENTE del monto). Incorporado.

## Baseline medido (antes de tocar nada, en el worktree `feature/76`, dev @ a014515)

- `typecheck`: **0 errores**.
- `lint`: **0 errores**, 139 warnings preexistentes.
- `test`: **2921 passed, 1 failed** — la falla es `tests/unit/guards/no-embalaje.test.ts`
  (timeout 5000ms de un walk del filesystem), flaky documentado bajo carga; NO es regresión.

## Estado final

- `typecheck`: **0 errores**.
- `lint`: **0 errores**, 139 warnings (mismos que baseline; no introduje warnings nuevos).
- `test` (corrida final completa): **312 files, 2963 passed, 0 failed**.
  - Durante la iteración vi timeouts flaky esporádicos en tests de componente
    (`HomePage.test.tsx`, `OrdenesModuleReuse.test.tsx`) bajo carga: pasan en aislamiento y
    NO los toqué (son frontend). La corrida final los dio verdes.

## Migraciones — validadas ESTÁTICAMENTE (no aplicadas: no hay Postgres en el entorno)

No hay `DATABASE_URL`/Postgres local, así que NO afirmo "migración aplicada". Verificación:

- `prisma validate` → schema válido.
- `prisma migrate diff --from-empty --to-schema db/schema.prisma --script` confirma que el DDL
  que Prisma espera coincide EXACTO con mis `migration.sql`:
  - `"asignado_at" TIMESTAMP(3)` en `orden`.
  - índice `orden_mensajero_asignado_id_asignado_at_idx ON "orden"("mensajero_asignado_id","asignado_at")`.
  - tabla `premio_ranking(id TEXT, posicion INTEGER, monto DECIMAL(12,2), descripcion TEXT,
    created_at, updated_at, PK premio_ranking_pkey)` + índice único `premio_ranking_posicion_key`.
  - Mis migraciones añaden encima (Prisma no lo expresa, patrón del repo): `CHECK (posicion
    BETWEEN 1 AND 3)`, INSERT de 3 filas seed (monto/descripcion NULL), `ENABLE ROW LEVEL SECURITY`.
- Round-trip up/down: cada carpeta tiene `down.sql` que revierte exactamente
  (`DROP INDEX`+`DROP COLUMN` / `DROP TABLE`).
- Guard de orden de migraciones (`tests/integration/db/zonas-migration.test.ts`) actualizado con
  las 2 nuevas carpetas en la whitelist "apendidas después" (patrón de mantenimiento).

## Archivos creados

- `db/migrations/20260716120000_orden_asignado_at/{migration.sql,down.sql}` (T0a, R24)
- `db/migrations/20260716130000_premio_ranking/{migration.sql,down.sql}` (T2, R8/R21; incl. `descripcion`)
- `lib/config/ranking.ts` (T1, R7/R22)
- `lib/types/ranking.ts` (DTOs; incl. `descripcion`)
- `lib/interfaces/repositories/IRankingRepository.ts` (T4)
- `lib/interfaces/repositories/IPremioRankingRepository.ts` (T4; `upsertPremio` + `UpsertPremioInput`)
- `lib/interfaces/services/IRankingService.ts` (T4)
- `lib/repositories/RankingRepository.ts` (T3, R1)
- `lib/repositories/PremioRankingRepository.ts` (T5, R8/R9/R10; monto+descripcion)
- `lib/services/RankingService.ts` (T6)
- `lib/actions/ranking.ts` (T7, R10/R11/R12/R18/R19; zod con `descripcion`)
- Tests: `tests/unit/config/ranking.test.ts`, `tests/unit/repositories/ranking-repository.test.ts`,
  `tests/unit/repositories/premio-ranking-repository.test.ts`,
  `tests/unit/services/ranking-service.test.ts`, `tests/unit/actions/ranking-actions.test.ts`

## Archivos modificados

- `db/schema.prisma`: `Orden.asignadoAt DateTime? @map("asignado_at")` + `@@index([mensajeroAsignadoId, asignadoAt])`;
  nuevo `model PremioRanking` (monto + descripcion, ambos nullable).
- Writers/limpieza (choke-point R23 / LC1) — ver lista abajo.
- Tests ajenos cuyas aserciones de forma EXACTA cambiaron por el estampado (no aflojados,
  reflejan la nueva conducta R23/LC1): `orden-repository.guia.test.ts`,
  `orden-repository.asignacion-satelite.test.ts`, `cierre-dia-repository.test.ts`,
  `gestion-orden-repository.test.ts`, `liberacion-reprogramada-repository.test.ts`,
  `zonas-migration.test.ts` (whitelist).

## CONFIRMACIÓN — enumeración exhaustiva de writers de `mensajero_asignado_id` (R23)

Grep `mensajeroAsignadoId|mensajero_asignado_id` en TODO el repo (no solo design). Los ÚNICOS
puntos que ESCRIBEN la columna en un `data:`/SQL `SET` (los demás son reads/where/relaciones):

Writers NO-NULO (estampan `asignado_at = now`) — **4/4 instrumentados**:
- **W1** `lib/repositories/OrdenRepository.ts:835` `generarGuiaLote` — condicional: estampa solo
  si `mensajeroAsignadoId != null` (el ruteo sin mensajero deja NULL). [design decía :899-901]
- **W2** `lib/repositories/OrdenRepository.ts:877` `asignarBodegaLote` — siempre. [design :941-943]
- **W3** `lib/repositories/OrdenRepository.ts:~1124` `asignarSateliteLote` (raw SQL) — añadí
  `"asignado_at" = NOW()` al SET. [design :1251-1253]
- **W4** `lib/repositories/CierreDiaRepository.ts:483` deshacer-gestión repone — siempre. [design :481-483]

Paths de limpieza (ponen `asignado_at = NULL`, defensivo LC1) — **3/3**:
- **C1** `lib/repositories/GestionOrdenRepository.ts:271` (`limpiaMensajero`). [design :284]
- **C2** `lib/repositories/OrdenRepository.ts:923` `rutearBodegaSateliteLote`. [design :989]
- **C3** `lib/repositories/LiberacionReprogramadaRepository.ts:87` handoff a bodega. [design :87]

Descartados como writers: `CierreDiaRepository.ts:207` (es un `count` where), `GuiaAsignacionService`
(solo construye el `GenerarGuiaDecisionData` que consume W1; no toca la DB). NINGÚN writer quedó
sin instrumentar. `OrdenService`/carga-masiva NO setean `mensajero_asignado_id` en el create.

## Mapa R → test (backend: R1-R12, R16, R19, R21-R24)

| R   | Test |
| --- | ---- |
| R1  | `ranking-repository.test.ts` — contar entregadas (entregada+vigente+rango) y asignadas (asignadoAt∈rango, no-null) |
| R2  | `ranking-service.test.ts` "pct = entregadas/asignadas *100 a 1 decimal STRING" |
| R3  | `ranking-service.test.ts` "0/0 -> pct null y al final; sin posicion de podio" |
| R4  | `ranking-service.test.ts` "ordena desc por pct" |
| R5  | `ranking-service.test.ts` "desempata por # entregas desc" y "por nombre asc (estable)" |
| R6  | `ranking-service.test.ts` (toMatchObject entregadasHoy/asignadasHoy en las filas) |
| R7  | `ranking-service.test.ts` "asignadas < umbral -> fuera del podio"; `config/ranking.test.ts` default 1 |
| R8  | `premio-ranking-repository.test.ts` "lista las 3 posiciones"; migración UNIQUE(posicion)+CHECK |
| R9  | `ranking-service.test.ts` "premio null, no '0'"; `premio-ranking-repository.test.ts` (monto null preservado) |
| R10 | `ranking-actions.test.ts` "maestro guarda/vacía"; `premio-ranking-repository.test.ts` upsertPremio |
| R11 | `ranking-service.test.ts` (monto/posición inválidos → invalid) + `ranking-actions.test.ts` (zod en el borde) |
| R12 | `ranking-service.test.ts` (premios/pct STRING) + `ranking-actions.test.ts` (resultado serializado) |
| R16 | `ranking-service.test.ts` "maestro -> esEditable true" |
| R17 | `ranking-service.test.ts` "mensajero -> esEditable false (solo-lectura)" |
| R18 | `ranking-service.test.ts` "otro rol -> forbidden sin datos" + `ranking-actions.test.ts` "sin sesión -> unauthenticated" |
| R19 | `ranking-service.test.ts` "mensajero editando -> forbidden sin persistir" + `ranking-actions.test.ts` |
| R21 | migración `premio_ranking` (RLS + down.sql) — validada estáticamente; guard de orden verde |
| R22 | `ranking-service.test.ts` "rango del día por helper CR"; `config/ranking.test.ts` (umbral por env) |
| R23 | W1/W2 `orden-repository.guia.test.ts`; W3 `orden-repository.asignacion-satelite.test.ts`; W4 `cierre-dia-repository.test.ts` |
| R24 | migración `orden_asignado_at` (columna nullable + down.sql) — `prisma migrate diff` confirma; guard verde |
| LC1 | `ranking-service.test.ts` "devolución intradía no cuenta en num ni denom"; C1 `gestion-orden-repository.test.ts`, C2 `orden-repository.guia.test.ts`, C3 `liberacion-reprogramada-repository.test.ts` |

Nota: R13-R15, R17(UI), R20 son frontend (T8-T10). El campo `descripcion` (cambio de alcance)
está en schema/migración/repo/interfaz/service/action y cubierto por tests de repo/service/action;
el contrato I/O de `premios` ahora es `{ posicion, monto: string|null, descripcion: string|null }`.

## Veredicto

Backend de la 76 completo (T0a-T7 + `descripcion`): typecheck 0, lint 0 errores, 2963 tests
verdes; migraciones validadas estáticamente (no aplicadas por falta de DB) con up/down; 4/4
writers de asignación instrumentados (R23) + 3/3 limpiezas (LC1); ninguno sin estampar.
