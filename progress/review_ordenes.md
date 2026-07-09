# Revisión — feature `ordenes` (id 6, complexity high)

Revisor: `reviewer`. Backend CRUD de órdenes. Sin UI (feature 7).
Verificación EJECUTADA por el reviewer, no confiada al reporte del implementer.

## Veredicto: **APROBADO** (0 bloqueantes)

## Verificación ejecutable (corrida por el reviewer)

| Comando | Resultado |
|---|---|
| `pnpm db:generate` | OK (Prisma Client v7.8.0) |
| `pnpm typecheck` (tsc --noEmit) | sin errores |
| `pnpm lint` (eslint) | sin errores |
| `pnpm test` (vitest run) | **35 archivos, 243 tests, 243 passed** |
| `./init.sh` | `== init OK ==` (verde; solo warn de .env, esperado) |

## Checklist CHECKPOINTS.md

- [x] `requirements.md` EARS numerado (R1–R42 + R14a/R14b).
- [x] `design.md` con alternativas descartadas (7 menciones).
- [x] `tasks.md` T001–T016 todas `[x]`.
- [x] Cada `R<n>` mapea a ≥1 test real (ver tabla).
- [x] `progress/impl_ordenes.md` contiene el mapa `R<n> → test`.
- [x] typecheck / lint / test verdes.
- [x] RLS activado en las 6 tablas nuevas (order_status, zona, provincia, canton, distrito, orden).
- [x] Migraciones versionadas + `down.sql` en orden inverso de FK; init.sh valida down.sql.
- [x] Sin secretos hardcodeados (config por env: `lib/config/ordenes.ts`).
- [x] Capas separadas: action (borde) → OrdenService (dominio) → OrdenRepository (solo Prisma). Interfaces en `lib/interfaces/`.
- [x] Controller sin queries/negocio; service sin HTTP; repo sin lógica de negocio.
- [x] Server Actions para mutaciones; sesión validada en servidor vía `cookies()`.
- [x] No se hardcodea país/moneda; N1 configurable.
- [x] No se tocó UI (git: "no UI files touched").
- [x] Sin webhooks en esta feature (N/A).

## Modelo `orden` (verificado en schema.prisma + migration.sql)

- num_guia: `Int @unique @default(autoincrement())` → SERIAL + índice único. ✓ (usuario nunca lo provee)
- num_remision: `String @unique`, provisto por usuario, obligatorio. ✓
- estatus_id: FK NOT NULL → order_status (default `en_bodega` aplicado en service/N1, no en DB — coherente con spec). ✓
- tienda_id: FK NOT NULL → usuario. ✓
- zona_id/provincia_id/canton_id: FK NOT NULL. distrito_id: FK nullable (ON DELETE SET NULL). ✓
- Únicos nullable de negocio: distrito_id y notas (+ deleted_at de sistema). ✓
- peso: Decimal(10,3) precisión fija. ✓  created_at/updated_at presentes. ✓

## Catálogo order_status
- Exactamente 7 valores en `ORDER_STATUS_SEED` (fuente única TS): entregada, devuelta, devuelta_origen, reprogramada, embalaje, en_ruta_bodega_principal, en_bodega. ✓
- `seedOrderStatus` upsert por value; test de idempotencia (2 corridas → 7 filas, id estable). ✓

## Geografía
- 4 tablas jerárquicas creadas VACÍAS (sin seed). FKs zona←provincia←canton←distrito. ✓
- Fixtures de geografía en tests de creación (R14b) presentes; caso geo inexistente → validation_error. ✓

## CRUD + matriz de autorización (tests positivos y negativos)
- maestro/admin: CRUD total → probado. ✓
- adminTienda: crea forzando su tienda_id; tienda ajena → forbidden (no crea); solo ve/edita/borra las suyas; ajena → not_found (lectura) / forbidden (mutación). ✓
- mensajero: solo lectura + cambio de estatus_id; crear/borrar → forbidden; otro campo en update → forbidden. ✓
- rol desconocido → forbidden en todas las ops. ✓
- Listado excluye soft-deleted (deletedAt: null en find/list/count). ✓
- Borrado LÓGICO (updateMany deletedAt), no físico. ✓

## Calidad de los tests (revisión con lupa — antecedente de tests falsos)
- `orden-service.test.ts`: ejercita el OrdenService REAL contra repo fake; asevera status y args reales (mock.calls) — NO tautológico.
- `ordenes-action.test.ts`: ejercita la action real (auth gate, zod, propagación) con service fake — real.
- `orden-repository.test.ts`: ejercita el repo real contra prisma mockeado; verifica where deletedAt:null, orderBy mapeado, P2002→dominio — real.
- `orden-schemas.test.ts`, `order-status.test.ts`, `seed-order-status.test.ts`, `ordenes-config.test.ts`: aseveran comportamiento real. Sin tautologías ni asserts vacíos.

## Tabla R<n> → test → estado

| R | Test | Estado |
|---|------|--------|
| R1 | ordenes-rls.test.ts (order_status en migración) | OK |
| R2 | order-status.test.ts (7 valores) + seed-order-status.test.ts | OK |
| R3 | seed-order-status.test.ts (idempotencia, id estable) | OK |
| R4/R5/R6 | migration.sql catálogos/geografía + down.sql inverso | OK |
| R7 | schema.prisma validado (campos) | OK |
| R8 | ordenes-rls.test.ts (num_guia SERIAL) | OK |
| R9 | orden-schemas.test.ts (num_remision obligatorio) | OK |
| R10 | orden-service.test.ts (default en_bodega) | OK |
| R11 | orden-service.test.ts (maestro/admin sin tiendaId→validation) | OK |
| R12 | orden-schemas.test.ts + ordenes-rls.test.ts (NOT NULL/nullable) | OK |
| R13 | ordenes-rls (DECIMAL) + orden-schemas (peso>0) | OK |
| R14 | ordenes-rls.test.ts (uniques) + orden-repository (P2002) | OK |
| R14a | schema + orden-schemas (notas opcional) | OK |
| R14b | orden-service (geo inexistente→validation) + ordenes-action | OK |
| R15/R17 | migration/down.sql ambas carpetas (rollback real DIFERIDO) | OK |
| R16 | ordenes-rls.test.ts (RLS en 6 tablas; anon real DIFERIDO) | OK |
| R18 | ordenes-action (sin sesión→unauthenticated, sin service) | OK |
| R19 | ordenes.ts resolveActor + matriz en orden-service | OK |
| R20 | orden-service (maestro/admin CRUD total) | OK |
| R21 | orden-service (fuerza tiendaId; solo suyas) + repo (where) | OK |
| R22 | orden-service (tiendaId ajeno→forbidden, no crea) | OK |
| R23/R41 | orden-service (mensajero crear/borrar forbidden, update solo estatus) | OK |
| R24 | orden-service (rol desconocido→forbidden en todas las ops) | OK |
| R25/R26 | orden-schemas + orden-service (FKs) + ordenes-action | OK |
| R27 | orden-service (default en_bodega + delega) + action (numGuia) | OK |
| R28 | orden-repository (P2002) + orden-service (conflict) + action | OK |
| R29 | orden-service (obtener not_found/ok) + action | OK |
| R30 | orden-repository (count) + orden-service (skip/take/total) + action | OK |
| R31 | orden-schemas (lista blanca) + repo (orderBy mapeado) + service | OK |
| R32 | orden-schemas (page/pageSize/sortBy inválidos) + action | OK |
| R33 | ordenes-config (cap) + orden-schemas (clamp) + action | OK |
| R34 | orden-repository (find/list filtran deletedAt) + service | OK |
| R35/R36/R37 | orden-service (actualizar) + action | OK |
| R38 | orden-service (estatusId inexistente→validation) + action | OK |
| R39/R40 | orden-repository (softDelete) + orden-service + action | OK |
| R42 | ordenes-action (resultado discriminado, sin PII/deletedAt) | OK |

## Deuda diferida (aceptable — documentada, patrón login/permissions/role-seed)
- Ejecución real de migraciones/seed contra Postgres (no hay DB). Cubierto estáticamente por ordenes-rls.test.ts (RLS/SERIAL/uniques/FK sobre el SQL) y `prisma validate`.
- R16 (rechazo query anon real) y R15/R17 (rollback+re-migrate sin diff) diferidos.
- Ningún requisito queda sin test por esta deuda; solo se difiere la ejecución contra DB real.

## Hallazgos
- Ninguno bloqueante.
- (menor) `mapCreateError` traduce cualquier P2002 a `NumRemisionDuplicadoError`; correcto hoy (num_remision es el único unique provisto por usuario), pero conviene revisitar si se añaden otros uniques. No bloquea.

## Conclusión
APROBADO. 0 bloqueantes. La feature cumple spec, docs y CHECKPOINTS; tests reales y verdes.
