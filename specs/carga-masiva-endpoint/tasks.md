# tasks.md — ordenes: carga masiva (endpoint) (feature 15)

> Orden de implementación: migración → seed/estatus → parseo → tipos/validación →
> resolución/repo → service → endpoint → tests. `[P]` = paralelizable con la task
> hermana marcada. Cada task tiene criterio de "hecho".
> **Decisiones humanas (2026-07-10) ya cerradas** (ver `requirements.md` →
> "Decisiones cerradas"): `peso` NULLABLE; default de estatus GLOBAL
> `en_preparacion`; slug `en_preparacion`; geografía = prerrequisito externo; `zona`
> derivada de la provincia; carga masiva SOLO rol `adminTienda` con
> `tienda_id = actor.usuarioId`.

## 1. Esquema y migración

- [x] **T1 — Extender `db/schema.prisma`.** Añadir a `Orden`: `direccion String?`,
  `montoCobrar Decimal? @db.Decimal(12,2) @map("monto_cobrar")`,
  `mensajeroSugeridoId String? @map("mensajero_sugerido_id")`, relación
  `mensajeroSugerido Usuario? @relation("OrdenMensajeroSugerido", ...)`, índice
  `@@index([mensajeroSugeridoId])`, y `peso Decimal? @db.Decimal(10,3)` (nullable).
  En `Usuario`: back-relation `ordenesMensajeria Orden[] @relation("OrdenMensajeroSugerido")`.
  **Hecho:** `pnpm db:generate` compila sin error de relación.
- [x] **T2 — Migración `<ts>_carga_masiva_ordenes`.** `migration.sql` con: DROP NOT NULL
  de `peso`; ADD COLUMN `direccion`, `monto_cobrar`, `mensajero_sugerido_id`; índice;
  FK `mensajero_sugerido_id → usuario(id)` `ON DELETE SET NULL`; `INSERT ... ON CONFLICT
  (value) DO NOTHING` de `en_preparacion`. RLS de `orden` sin tocar.
  **Hecho:** `pnpm db:migrate` aplica en verde; `\d orden` muestra las 3 columnas + FK.
  → R1, R2, R3, R6.
- [x] **T3 — `down.sql`.** Revertir en orden inverso (drop FK/índice/columnas), `DELETE`
  condicional del estatus `en_preparacion` solo si no referenciado, e intento de
  `SET NOT NULL` de `peso`. **Hecho:** `pnpm db:rollback` revierte sin residuos y
  `pnpm db:migrate` re-aplica. → R3, R6.
- [x] **T4 — Test de migración `tests/integration/migrations/carga-masiva-schema.test.ts`.**
  Verifica columnas nuevas, FK nullable, índice y presencia del estatus tras migrar.
  **Hecho:** test pasa contra DB de test. → R1, R2, R6.

## 2. Seed y estatus/default

- [x] **T5 — Añadir `en_preparacion` a `ORDER_STATUS_SEED`** (`lib/types/order-status.ts`).
  **Hecho:** la constante incluye 8 valores; `seedOrderStatus` lo crea idempotente.
  → R5, R7.
- [x] **T6 — Actualizar `tests/unit/types/order-status.test.ts` y
  `tests/unit/scripts/seed-order-status.test.ts`** para incluir `en_preparacion`
  y afirmar idempotencia (no duplica). **Hecho:** ambos tests pasan. → R5, R6.
- [x] **T7 — Default de estatus GLOBAL.** Cambiar `ordenesConfig.DEFAULT_ESTATUS_VALUE`
  de `en_bodega` a `en_preparacion` (afecta CRUD feature 6 y carga masiva).
  **Impacto feature 6:** actualizar el test de creación que hoy afirma `en_bodega`
  para que espere `en_preparacion`. `BulkOrdenService` lee ese mismo default de
  config (sin constante propia divergente). **Hecho:** `crear` sin estatus asigna
  `en_preparacion`; test de feature 6 actualizado en verde. → R7, R8.

## 3. Parseo CSV/XLSX

- [x] **T8 — Añadir dependencia `exceljs`** (`pnpm add exceljs`). **Hecho:** aparece en
  `package.json` y el lockfile; `pnpm typecheck` pasa.
- [x] **T9 [P] — `lib/parsers/spreadsheet.ts`.** `parseSpreadsheet(buffer, ext)`:
  streaming XLSX (`WorkbookReader`) y CSV (`workbook.csv.read`), normaliza cabeceras
  (lowercase+trim), emite filas `{ [col]: string }`. Rechaza extensión no csv/xlsx.
  **Hecho:** implementado, sin `any` en el borde. → R13, R14, R15, R16.
- [x] **T10 [P] — `lib/types/carga-masiva.ts`.** `RowResult`, `BulkSummary`,
  `RowResultado`, `filaCargaSchema` (zod): obligatorios no vacíos, `monto_cobrar`
  numérico ≥ 0 o null, `mensajero_sugerido_id` string|null. **Hecho:** `typecheck` pasa.
  → R18, R23.
- [x] **T11 — Test parseo `tests/unit/parsers/spreadsheet.test.ts`.** CSV con comillas/
  saltos internos; XLSX de una hoja; cabeceras con mayúsculas/espacios; faltan
  columnas obligatorias → error; archivo sin filas → error. **Hecho:** todos pasan.
  → R13, R14, R15, R16, R17.

## 4. Repositorio (extensión batch)

- [x] **T12 — Extender `IOrdenRepository` + `OrdenRepository`** con:
  `findExistingRemisiones(nums: string[]): Promise<Map<string,string>>` (remisión →
  estatus.value de la orden no borrada); `findProvinciasByNombres`, `findCantonesByProvinciaIds`,
  `findDistritosByCantonIds` (para índice geográfico); `findMensajerosByIds(ids)` →
  set de ids con rol `mensajero`; `createManyOrdenes(data[], batchSize)` con
  `createMany({ skipDuplicates: true })` en chunks. **Hecho:** interfaz + impl
  compilan. → R19, R21, R22, R25, R27.
- [x] **T13 — Test repo `tests/integration/repositories/OrdenRepository.bulk.test.ts`.**
  Contra DB de test: dedup por remisión existente devuelve su estatus; `createMany`
  en lotes con `skipDuplicates` no aborta ante colisión; resolución geo/mensajero.
  **Hecho:** pasa. → R19, R22, R25, R27.

## 5. Service

- [x] **T14 — `lib/interfaces/services/IBulkOrdenService.ts` + `lib/services/BulkOrdenService.ts`.**
  `cargarMasiva(rows, actor)`: autorización (SOLO rol `adminTienda`; cualquier otro →
  forbidden), fija `tienda_id = actor.usuarioId` en todas las filas, pre-cargas en
  bloque, validación por fila, dedup intra-archivo (primera ocurrencia) + contra DB,
  derivación de `zona` desde provincia, ensamblado de `CreateOrdenData[]`,
  persistencia batch, y armado de `BulkSummary`. **Hecho:** compila; sin HTTP ni
  parseo dentro del service. → R11, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R29.
- [x] **T15 — Test service `tests/unit/services/BulkOrdenService.test.ts`** (repo mockeado).
  Casos: SOLO `adminTienda` autorizado — rol `maestro`/`admin`/`mensajero`/desconocido
  → forbidden (R11); `adminTienda` fija `tienda_id = actor.usuarioId` en las órdenes
  creadas (R24); fila sin obligatorio → error (R18); geografía inexistente/ambigua →
  error (R20); zona derivada de provincia (R21); mensajero inválido/no-rol → error,
  vacío → null (R22); `monto_cobrar` no numérico → error, vacío → null (R23);
  remisión existente → duplicada + estatus (R25); duplicado intra-archivo → una
  creada, resto duplicada (R26); estatus por defecto `en_preparacion` (R7); éxito
  parcial: válidas creadas pese a filas malas (R29). **Hecho:** todos pasan.
  → R7, R11, R18–R26, R29.

## 6. Endpoint (Route Handler)

- [x] **T16 — `lib/config/carga-masiva.ts`.** `MAX_FILE_BYTES`, `MAX_ROWS`, `BATCH_SIZE`
  (env override, patrón `ordenesConfig`). El default de estatus NO se define aquí:
  se toma de `ordenesConfig.DEFAULT_ESTATUS_VALUE` (global, ver T7). **Hecho:**
  exporta `cargaMasivaConfig`. → R28.
- [x] **T17 — Extraer `resolveActorFromSession` a `lib/auth/resolve-actor.ts`** y
  reusarlo en `lib/actions/ordenes.ts` (sin cambiar su comportamiento). **Hecho:**
  tests de ordenes siguen en verde. → R10.
- [x] **T18 — `app/api/ordenes/carga-masiva/route.ts` (POST).** Envuelto en
  `withErrorHandler`: resuelve actor (401 si no hay), autoriza SOLO `adminTienda`
  (403 en otro caso, R11), lee `file` del FormData (422 si falta), valida
  extensión/tamaño (422), parsea con `parseSpreadsheet` acotando `MAX_ROWS`, llama a
  `BulkOrdenService.cargarMasiva` (que fija `tienda_id = actor.usuarioId`), responde
  200 con `BulkSummary` o `appErrorToResponse` en fallo estructural. **Sin campo
  `tiendaId`.** **Hecho:** handler compila; no contiene lógica de negocio ni Prisma
  directo. → R9, R10, R11, R12, R13, R16, R17, R28, R30, R31, R32.
- [x] **T19 — Test integración
  `tests/integration/api/ordenes-carga-masiva.route.test.ts`** (DB de test, actor
  inyectado): sin sesión → 401 (R10); roles NO `adminTienda` (`maestro`/`admin`/
  `mensajero`/desconocido) → 403 (R11); `adminTienda` → procede y las órdenes
  creadas llevan `tienda_id = actor.usuarioId` (R24); sin `file` → 422 (R12); tipo no
  csv/xlsx → 422 (R13); cabeceras faltantes → 422 (R16); archivo sin filas → 422
  (R17); exceder `MAX_ROWS`/tamaño → 422 (R28); CSV válido → 200 con resumen
  `{total,creadas,duplicadas,conError,filas[]}` (R30); remisión existente → fila
  `duplicada` con estatus (R25); XLSX válido → 200 (R15); respuesta no expone
  `deleted_at`/PII (R32); error interno → `AppErrorShape` 500 (R31). **Hecho:** todos
  pasan. → R9–R17, R24, R25, R28, R30, R31, R32.

## 7. Cierre

- [x] **T20 — `./init.sh` + `pnpm test` en verde** y actualizar `progress/current.md`.
  **Hecho:** suite completa pasa; feature marcable como implementada.

## Mapa Requisito → Test

| R | Test |
|---|------|
| R1 | T4 migración: columnas nuevas |
| R2 | T4 migración: FK/índice mensajero_sugerido_id |
| R3 | T3 rollback/re-migrate; RLS intacta |
| R4 | T4 (peso nullable) / T15 crear sin peso |
| R5 | T6 order-status incluye en_preparacion |
| R6 | T6 idempotencia seed + T4 estatus presente |
| R7 | T15 default en_preparacion en carga |
| R8 | T7 default GLOBAL en_preparacion + test feature 6 actualizado |
| R9 | T19 POST route existe/responde |
| R10 | T19 sin sesión → 401 |
| R11 | T15 / T19 solo adminTienda; otros roles → 403 |
| R12 | T19 sin file → 422 |
| R13 | T11 / T19 tipo inválido → 422 |
| R14 | T11 CSV con comillas/saltos |
| R15 | T11 / T19 XLSX una hoja |
| R16 | T11 / T19 cabeceras faltantes → 422 |
| R17 | T11 / T19 archivo sin filas → 422 |
| R18 | T15 fila sin obligatorio → error |
| R19 | T13 / T15 resolución geo jerárquica |
| R20 | T15 geografía inexistente → error de fila |
| R21 | T15 zona derivada de provincia |
| R22 | T13 / T15 mensajero inválido → error; vacío → null |
| R23 | T15 monto_cobrar no numérico → error; vacío → null |
| R24 | T15 / T19 tienda_id = actor.usuarioId (adminTienda) |
| R25 | T13 / T19 remisión existente → duplicada + estatus |
| R26 | T15 duplicado intra-archivo |
| R27 | T13 createMany batch skipDuplicates |
| R28 | T19 límites tamaño/filas → 422 |
| R29 | T15 éxito parcial |
| R30 | T19 forma del resumen 200 |
| R31 | T19 fallo estructural → AppErrorShape |
| R32 | T19 no expone deleted_at/PII |
