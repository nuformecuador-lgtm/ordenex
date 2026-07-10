# Bitácora de implementación — feature `cobros-crud` (id 18, complexity medium)

CRUD backend de cobros (Server Actions → CobroService → CobroRepository), tabla
`cobro` multi-fila con `nombre` (D1), migración Prisma reversible con RLS.
Réplica exacta del patrón por capas del CRUD de órdenes (feature 6). Sin UI
(zona backend pura). Spec: `specs/cobros-crud/{requirements,design,tasks}.md`.

## Estado: VERDE

- `pnpm db:generate` → OK (Prisma Client v7.8.0, nuevo modelo `Cobro`).
- `pnpm run typecheck` (tsc --noEmit) → sin errores.
- `pnpm run lint` (eslint) → sin errores.
- `pnpm test` (vitest run) → **73 archivos, 660 tests, 660 passed** (baseline
  67 archivos / 572 tests; +6 archivos / +88 tests nuevos de `cobros`).
- `./init.sh` → verde (incluye typecheck/lint/test + verificación de que toda
  migración tiene `down.sql`).

Salida real `pnpm run typecheck`:
```
> ordenex@0.1.0 typecheck R:\ark-studio\projects\ricardo\ordenex
> tsc --noEmit
(sin salida = sin errores)
```

Salida real `pnpm run lint`:
```
> ordenex@0.1.0 lint R:\ark-studio\projects\ricardo\ordenex
> eslint
(sin salida = sin errores)
```

Salida real `pnpm test`:
```
 RUN  v4.1.10 R:/ark-studio/projects/ricardo/ordenex
 Test Files  73 passed (73)
      Tests  660 passed (660)
   Duration  20.08s
```

Salida real `./init.sh` (tramo final):
```
-> pnpm run typecheck
-> pnpm run lint
-> pnpm run test
 Test Files  73 passed (73)
      Tests  660 passed (660)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

## Archivos creados (rutas absolutas)

Schema y migración:
- `R:\ark-studio\projects\ricardo\ordenex\db\schema.prisma` (modificado: +modelo `Cobro`)
- `R:\ark-studio\projects\ricardo\ordenex\db\migrations\20260710120000_cobros\migration.sql`
- `R:\ark-studio\projects\ricardo\ordenex\db\migrations\20260710120000_cobros\down.sql`

Código (capas, patrón feature 6):
- `R:\ark-studio\projects\ricardo\ordenex\lib\config\cobros.ts`
- `R:\ark-studio\projects\ricardo\ordenex\lib\types\cobro.ts`
- `R:\ark-studio\projects\ricardo\ordenex\lib\interfaces\repositories\ICobroRepository.ts`
- `R:\ark-studio\projects\ricardo\ordenex\lib\interfaces\services\ICobroService.ts`
- `R:\ark-studio\projects\ricardo\ordenex\lib\repositories\CobroRepository.ts`
- `R:\ark-studio\projects\ricardo\ordenex\lib\services\CobroService.ts`
- `R:\ark-studio\projects\ricardo\ordenex\lib\actions\cobros.ts` (`'use server'`: crear/obtener/listar/actualizar/borrar, deps inyectables)

Tests:
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\config\cobros-config.test.ts`
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\types\cobro-schemas.test.ts`
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\repositories\cobro-repository.test.ts`
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\services\cobro-service.test.ts`
- `R:\ark-studio\projects\ricardo\ordenex\tests\integration\actions\cobros-action.test.ts`
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\db\cobros-rls.test.ts` (cobertura estática de la migración: RLS, tipos/NOT NULL, sin unique en `nombre`, sin FKs, `down.sql`)

## Archivos NO tocados (fuera de alcance, confirmado)

`feature_list.json` aparece modificado en `git status`, pero ese cambio ya
estaba presente en el working tree ANTES de iniciar esta tarea (no lo generé
yo; no toqué órdenes/UI/otras features). No se modificó ningún archivo de
`app/`, componentes, ni el CRUD existente de `orden`.

## Decisión de diseño tomada durante la implementación (documentada aquí, sin cambiar negocio)

`lib/actions/_shared/to-action-error.ts` es compartido con `ordenes` y está
tipado para devolver el `ActionError` de `lib/types/orden.ts`, que **sí**
incluye el estado `conflict`. El `ActionError` de cobros (`lib/types/cobro.ts`)
NO incluye `conflict` (decisión de negocio D1/design.md: `id` es uuid, `nombre`
no es único). Para reutilizar `toActionError` **sin modificarlo** y sin violar
la decisión de negocio, se agregó en `lib/actions/cobros.ts` un adaptador local
`toCobroActionError` que llama a `toActionError` y angosta el resultado: si
alguna vez devolviera `{status:"conflict"}` (nunca ocurre en el dominio de
cobros, pues `CobroService`/`CobroRepository` no lanzan `ConflictError`),
lanza un `Error` en vez de violar el contrato tipado — el mismo patrón que ya
usa `toActionError` para `INTERNAL` (re-lanzar sin envolver silenciosamente).
Esto es un detalle de plomería de tipos, no una decisión de negocio.

## Mapa de trazabilidad R1..R27 → test

| R | Archivo :: test |
|---|------|
| R1 | `db/schema.prisma` (modelo `Cobro`) + `cobros-rls.test.ts::migracion de cobro: columnas, tipos y NOT NULL` |
| R2 | `cobros-rls.test.ts::5 columnas de monto DECIMAL(12,2) NOT NULL` + `cobro-schemas.test.ts::rechaza monto negativo` + `cobro-repository.test.ts::CobroRepository.create::convierte numbers a Prisma.Decimal` |
| R3 | `cobros-rls.test.ts::3 columnas de porcentaje DECIMAL(5,2) NOT NULL` + `cobro-schemas.test.ts::rechaza porcentaje > 100 / negativo / acepta 100` |
| R4 | `db/schema.prisma` (`@map` snake_case, GAM→gam) + `cobros-rls.test.ts` (nombres de columna `valor_flete_gam`/`valor_flete_devuelto_gam`) |
| R5 | `cobro-schemas.test.ts::rechaza nombre vacio/ausente, columna numerica ausente, monto negativo, porcentaje fuera de rango` |
| R6 | `cobros-rls.test.ts::down.sql revierte solo la tabla cobro` (DROP TABLE + no menciona otras tablas) |
| R7 | `cobros-rls.test.ts::RLS habilitado en cobro` (estático); rechazo real con key `anon` **DIFERIDO** (sin Postgres real, como `ordenes` T004/T006) |
| R8 | `cobros-action.test.ts::R8: sin sesion valida -> unauthenticated sin tocar el service` (las 5 acciones) |
| R9 | `cobro-service.test.ts` (matriz READ_ROLES/WRITE_ROLES en las 4 secciones crear/obtener/listar/actualizar/borrar) + `cobros-action.test.ts::R9-R13` |
| R10 | `cobro-service.test.ts::R10: maestro crea/obtiene/lista/actualiza/borra` |
| R11 | `cobro-service.test.ts::R11: admin no puede crear/actualizar/borrar -> forbidden (pero obtiene/lista OK)` + `cobros-action.test.ts::admin lee pero no escribe` |
| R12 | `cobro-service.test.ts::R12: adminTienda/mensajero cualquier operacion -> forbidden` + `cobros-action.test.ts::adminTienda/mensajero -> forbidden en toda operacion` |
| R13 | `cobro-service.test.ts::R13: rol no reconocido -> forbidden` (las 5 operaciones) |
| R14 | `cobro-schemas.test.ts::crearCobroSchema — validacion de creacion` (acepta input válido; base de R15) |
| R15 | `cobro-schemas.test.ts::rechaza nombre vacio/ausente, columna ausente, negativo, no numerico, porcentaje>100` + `cobros-action.test.ts::R15/R23: validation_error con fieldErrors` |
| R16 | `cobro-service.test.ts::R16: crear valido persiste y devuelve el DTO` + `cobros-action.test.ts::R16: crear valido (maestro) -> ok con CobroDTO` |
| R17 | `cobro-service.test.ts::obtener::R17/R19: inexistente o borrado -> not_found` + `cobros-action.test.ts::R17/R21/R25` |
| R18 | `cobros-config.test.ts` (cap MAX_PAGE_SIZE + overrides env) + `cobro-schemas.test.ts::listarCobrosSchema` (defaults + acota pageSize) + `cobro-repository.test.ts::CobroRepository.list` (skip/take) + `cobro-service.test.ts::listar::R18: items/page/pageSize/total y skip` + `cobros-action.test.ts::R18/R19: listar` |
| R19 | `cobro-repository.test.ts::list::excluye borrados (where deletedAt:null)` + `findById::filtra deleted_at IS NULL` + `cobro-service.test.ts::R19` + `cobros-action.test.ts::R18/R19` |
| R20 | `cobro-schemas.test.ts::actualizarCobroSchema — todos opcionales, strict` |
| R21 | `cobro-service.test.ts::actualizar::R21: inexistente o borrado -> not_found` + `cobro-repository.test.ts::update::devuelve null si no existe o esta borrado` + `cobros-action.test.ts::R17/R21/R25` |
| R22 | `cobro-service.test.ts::actualizar::R10/R22: aplica solo los campos presentes / no toca id/created_at` |
| R23 | `cobro-schemas.test.ts::actualizarCobroSchema::rechaza nombre vacio/monto negativo/porcentaje fuera de rango` + `cobros-action.test.ts::actualizar con campo desconocido (strict)` |
| R24 | `cobro-repository.test.ts::softDelete::fija deleted_at solo si no estaba borrado` + `cobro-service.test.ts::borrar::R10/R24` + `cobros-action.test.ts::R24: borrar -> ok (soft)` |
| R25 | `cobro-service.test.ts::borrar::R25: inexistente o ya borrado -> not_found` + `cobro-repository.test.ts::softDelete::devuelve false si no habia fila` + `cobros-action.test.ts::R17/R21/R25` |
| R26 | `cobros-action.test.ts::R26/R27: resultado tipado sin filtrar internals` (Object.keys exacto) + `INTERNAL: throw inesperado se re-lanza` |
| R27 | `cobro-repository.test.ts::create/list` (Decimal→number, sin `deletedAt`) + `cobros-action.test.ts::R16` (sin `deletedAt`) + `cobro-schemas.test.ts` (tipos DTO) |

## Deuda diferida (justificada — no hay Postgres, mismo patrón que `ordenes` T004/T006/T012/T016)

- **T004 — RLS real con cliente `anon`**: no hay Postgres real disponible en
  este entorno. Cubierto **estáticamente** por `tests/unit/db/cobros-rls.test.ts`
  (verifica `ALTER TABLE "cobro" ENABLE ROW LEVEL SECURITY;` en `migration.sql`).
- **T012 — Rollback (`db:rollback` + re-migrate) sin diff de esquema**: diferido
  por la misma razón (sin DB real para aplicar/revertir). `down.sql` revisado
  manualmente línea por línea contra `migration.sql` (`DROP TABLE IF EXISTS
  "cobro";`, no toca ninguna otra tabla) y cubierto por
  `cobros-rls.test.ts::down.sql revierte solo la tabla cobro`.
- **Timestamp de migración**: `20260710120000_cobros`, posterior a
  `20260710000000_carga_masiva_ordenes` (la última existente al iniciar esta
  tarea), sin FKs por lo que no depende de orden de creación de otras tablas.

## Decisiones de negocio (NO tocadas, ya cerradas por el humano en el spec)

D1 (tabla multi-fila con `nombre`, sin `@unique`), D2 (IVA porcentaje 0..100),
D3 (`fulfillment` monto, `comision_cod` porcentaje), D4 (solo `maestro`
escribe), D5 (NOT NULL + rangos ≥0 / ≤100) — todas implementadas literalmente
como en `requirements.md`/`design.md`. No se tomó ninguna decisión de negocio
nueva ni se reinterpretó ninguna decisión existente.

## Veredicto

VERDE — 660/660 tests pasan (88 nuevos de `cobros`, 6 archivos nuevos);
`db:generate`/`typecheck`/`lint`/`init.sh` limpios. RLS-anon real y
rollback-real contra Postgres diferidos y documentados (sin DB en este
entorno), cubiertos estáticamente. Pendiente de revisión por `reviewer`.
