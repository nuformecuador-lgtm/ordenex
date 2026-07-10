# Implementación — ordenes: carga masiva (endpoint) (feature 15)

Rama: `feature/15-carga-masiva-endpoint`. Zona: BACKEND puro (controllers,
services, repositories, migraciones, tests). Spec aprobado, decisiones humanas
2026-07-10 aplicadas al pie de la letra (exceljs, solo `adminTienda`, default
GLOBAL `en_preparacion`, `peso` nullable, zona derivada de provincia, sin
sembrar geografía).

## Archivos creados

- `db/migrations/20260710000000_carga_masiva_ordenes/migration.sql` (UP)
- `db/migrations/20260710000000_carga_masiva_ordenes/down.sql` (DOWN)
- `lib/parsers/spreadsheet.ts` — `parseSpreadsheet(buffer, ext)` con exceljs (CSV/XLSX)
- `lib/types/carga-masiva.ts` — `RowResult`, `BulkSummary`, `filaCargaSchema`, `findMissingHeaders`
- `lib/config/carga-masiva.ts` — `cargaMasivaConfig` (MAX_FILE_BYTES, MAX_ROWS, BATCH_SIZE)
- `lib/auth/resolve-actor.ts` — `resolveActorFromSession` extraído de `lib/actions/ordenes.ts`
- `lib/interfaces/services/IBulkOrdenService.ts`
- `lib/services/BulkOrdenService.ts`
- `app/api/ordenes/carga-masiva/route.ts` — Route Handler `POST` + `handleCargaMasiva` inyectable
- `tests/integration/db/carga-masiva-schema.test.ts`
- `tests/unit/parsers/spreadsheet.test.ts`
- `tests/unit/repositories/orden-repository.bulk.test.ts`
- `tests/unit/services/bulk-orden-service.test.ts`
- `tests/integration/api/ordenes-carga-masiva.route.test.ts`
- `tests/unit/config/carga-masiva-config.test.ts` (extra, no listado en tasks.md pero cubre R28 a nivel de config)

## Archivos modificados

- `db/schema.prisma` — `Orden.peso` nullable; `+direccion`, `+montoCobrar`,
  `+mensajeroSugeridoId`, relación `mensajeroSugerido -> Usuario`,
  `@@index([mensajeroSugeridoId])`; `Usuario.ordenesMensajeria` (back-relation);
  `OrderStatus` comentario actualizado a 8 valores.
- `package.json` / `pnpm-lock.yaml` — nueva dependencia `exceljs@4.4.0`.
- `lib/types/order-status.ts` — `ORDER_STATUS_SEED` suma `"en_preparacion"` (8vo valor).
- `lib/config/ordenes.ts` — `DEFAULT_ESTATUS_VALUE` fallback `"en_bodega"` → `"en_preparacion"`.
- `lib/types/orden.ts` — `OrdenDTO.peso: number | null`.
- `lib/interfaces/repositories/IOrdenRepository.ts` — `CreateOrdenData`/`UpdateOrdenData.peso: number | null`;
  `+direccion?`, `+montoCobrar?`, `+mensajeroSugeridoId?` en `CreateOrdenData`;
  nuevos métodos batch (`findExistingRemisiones`, `findProvinciasByNombres`,
  `findCantonesByProvinciaIds`, `findDistritosByCantonIds`, `findMensajerosByIds`,
  `createManyOrdenes`) + tipos `ProvinciaRow`/`CantonRow`/`DistritoRow`.
- `lib/repositories/OrdenRepository.ts` — `toDTO` con `peso` nullable; `create`/`toUpdateData`
  ajustados a `peso`/`montoCobrar`/`direccion`/`mensajeroSugeridoId`; implementación de
  los 6 métodos batch nuevos; `OrdenPrismaClient` amplía el `Pick` con `usuario`.
- `lib/actions/ordenes.ts` — usa `resolveActorFromSession` importado de `lib/auth/resolve-actor.ts`
  (comportamiento sin cambios).
- `tests/unit/types/order-status.test.ts` — 7→8 valores, incluye `en_preparacion`.
- `tests/unit/scripts/seed-order-status.test.ts` — `toHaveBeenCalledTimes(7→8)`, `rows.size` 7→8.
- `tests/unit/config/ordenes-config.test.ts` — default esperado `en_bodega`→`en_preparacion`.
- `tests/unit/services/orden-service.test.ts` — test de default renombrado y actualizado a
  `en_preparacion`; `buildRepo` extendido con mocks de los 6 métodos batch nuevos (requeridos
  por la interfaz `IOrdenRepository`, no ejercitados por el CRUD).
- `specs/carga-masiva-endpoint/tasks.md` — T1..T20 marcadas `[x]`.

## Mapa R → test

| R | Test |
|---|------|
| R1 | `tests/integration/db/carga-masiva-schema.test.ts` → "carga-masiva migration.sql (UP) — columnas nuevas (R1)" |
| R2 | `tests/integration/db/carga-masiva-schema.test.ts` → "FK e indice de mensajero_sugerido_id (R2)" |
| R3 | `tests/integration/db/carga-masiva-schema.test.ts` → "RLS conservada, sin policies (R3)" |
| R4 | `tests/integration/db/carga-masiva-schema.test.ts` → "peso nullable (R4)"; `tests/unit/repositories/orden-repository.bulk.test.ts` → "mapea peso null a null..." |
| R5 | `tests/unit/types/order-status.test.ts` → "incluye en_preparacion..." |
| R6 | `tests/integration/db/carga-masiva-schema.test.ts` → "seed idempotente en_preparacion (R6)" + down.sql "elimina el estatus en_preparacion SOLO si no esta referenciado" |
| R7 | `tests/unit/services/bulk-orden-service.test.ts` → "resuelve en_preparacion como estatus de las filas creadas" |
| R8 | `tests/unit/config/ordenes-config.test.ts` (default) + `tests/unit/services/orden-service.test.ts` → "R27/R7/R8: sin estatusId aplica default GLOBAL en_preparacion..." |
| R9 | `tests/integration/api/ordenes-carga-masiva.route.test.ts` → "R9/R24: adminTienda -> procede, delega en el service con el actor" |
| R10 | `tests/integration/api/ordenes-carga-masiva.route.test.ts` → "R10: sin sesion valida -> 401..." |
| R11 | `tests/unit/services/bulk-orden-service.test.ts` → "autorizacion (R11)"; `tests/integration/api/ordenes-carga-masiva.route.test.ts` → "R11: roles distintos de adminTienda -> 403..." |
| R12 | `tests/integration/api/ordenes-carga-masiva.route.test.ts` → "R12: sin archivo -> 422..." |
| R13 | `tests/unit/parsers/spreadsheet.test.ts` → "extension no soportada (R13)"; ruta → "R13: tipo de archivo no soportado -> 422" |
| R14 | `tests/unit/parsers/spreadsheet.test.ts` → "respeta comillas, comas escapadas y saltos de linea..." |
| R15 | `tests/unit/parsers/spreadsheet.test.ts` → "XLSX (R15)"; ruta → "R15: XLSX valido -> 200" |
| R16 | `tests/unit/parsers/spreadsheet.test.ts` → "normaliza cabeceras..."; ruta → "R16: cabeceras obligatorias ausentes -> 422" |
| R17 | ruta → "R17: archivo sin filas de datos -> 422" |
| R18 | `tests/unit/services/bulk-orden-service.test.ts` → "campos obligatorios (R18)" |
| R19 | `tests/unit/repositories/orden-repository.bulk.test.ts` → "resolucion geografica batch (R19)"; `tests/unit/services/bulk-orden-service.test.ts` → "geografia (R19/R20/R21)" |
| R20 | `tests/unit/services/bulk-orden-service.test.ts` → "provincia inexistente...", "canton ambiguo...", "distrito provisto pero inexistente..." |
| R21 | `tests/unit/services/bulk-orden-service.test.ts` → "deriva zonaId desde la provincia resuelta" |
| R22 | `tests/unit/repositories/orden-repository.bulk.test.ts` → "findMensajerosByIds (R22)"; `tests/unit/services/bulk-orden-service.test.ts` → "mensajero sugerido (R22)" |
| R23 | `tests/unit/services/bulk-orden-service.test.ts` → "monto_cobrar (R23)" |
| R24 | `tests/unit/services/bulk-orden-service.test.ts` → "tienda del actor (R24)"; ruta → "R9/R24" |
| R25 | `tests/unit/repositories/orden-repository.bulk.test.ts` → "findExistingRemisiones (R25)"; `tests/unit/services/bulk-orden-service.test.ts` → "R25: remision existente..."; ruta → "R25: remision existente -> fila duplicada..." |
| R26 | `tests/unit/services/bulk-orden-service.test.ts` → "R26: duplicado intra-archivo..." |
| R27 | `tests/unit/repositories/orden-repository.bulk.test.ts` → "createManyOrdenes (R27)" |
| R28 | `tests/unit/config/carga-masiva-config.test.ts`; ruta → "R28: excede el numero maximo de filas -> 422" |
| R29 | `tests/unit/services/bulk-orden-service.test.ts` → "exito parcial (R29)" |
| R30 | ruta → "R30: CSV valido -> 200 con el resumen..." |
| R31 | ruta → "R31: fallo interno inesperado -> AppErrorShape 500" |
| R32 | ruta → "R32: la respuesta nunca expone deleted_at ni datos internos" |

## Verificación (salida real)

`pnpm db:generate`: OK, "Generated Prisma Client (v7.8.0)... in 164ms".

`pnpm typecheck`:
```
> tsc --noEmit
(sin errores, exit 0)
```

`pnpm lint`:
```
> eslint
(sin salida, exit 0)
```

`pnpm test`:
```
 Test Files  60 passed (60)
      Tests  485 passed (485)
```
Baseline previo: 54 archivos / 413 tests. Delta: +6 archivos / +72 tests (feature 15
suma tests nuevos; ningún test de feature 6 se borró, solo se actualizaron 4 archivos
por el cambio de default `en_bodega` → `en_preparacion` y el nuevo 8º valor de estatus).

## Decisiones de implementación (dentro del margen del spec)

- **Autorización adelantada en el Controller (R11 "sin procesar el archivo").**
  El spec de tareas dice "Autoriza vía service", pero `IBulkOrdenService.cargarMasiva`
  requiere las filas ya parseadas como argumento. Para cumplir literalmente R11
  ("sin procesar el archivo" para roles no autorizados), el Route Handler valida
  `actor.rol !== "adminTienda"` ANTES de leer `formData()`/parsear, lanzando
  `ForbiddenError` directamente. `BulkOrdenService.cargarMasiva` también autoriza
  de forma independiente (primera línea del método, sin tocar `rows`), cumpliendo
  T14 al pie de la letra y sirviendo de defensa en profundidad para consumidores
  directos del service (como los tests unitarios). Documentado con comentario en
  `app/api/ordenes/carga-masiva/route.ts`.
- **Duplicado intra-archivo (R26) también expone `estatus`.** R30 dice "estatus
  (value, para duplicada/creada)" sin distinguir el origen del duplicado. Para
  duplicados intra-archivo, se reporta el mismo estatus que tendrá/tuvo la fila
  "ganadora" (el default `en_preparacion` si la ganadora se crea, o el estatus de
  la orden existente en DB si la ganadora en sí ya era un duplicado contra DB).
  Implementado con un `Map<numRemision, estatusReportado>` en `BulkOrdenService`.
  Cubierto por el test "R26: duplicado intra-archivo -> una creada, resto duplicada".
- **Guarda defensiva de estatus por defecto no disponible.** Si
  `findEstatusIdByValue(ordenesConfig.DEFAULT_ESTATUS_VALUE)` devuelve `null` (seed
  pendiente), `BulkOrdenService` marca TODAS las filas como error sin llamar a
  `createManyOrdenes`, siguiendo el mismo patrón defensivo que `OrdenService.crear`.
  No exigido explícitamente por ningún `R<n>` pero coherente con el resto del CRUD;
  cubierto por un test adicional en `bulk-orden-service.test.ts`.
- **Cast de tipos con `exceljs`.** `exceljs` declara en su propio `.d.ts` un tipo
  local `Buffer` (`extends ArrayBuffer`) que colisiona en TS estricto con el
  `Buffer` real de Node (genérico). Se resolvió con un cast dirigido y documentado
  (`buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]`), sin usar `any`
  explícito, en `lib/parsers/spreadsheet.ts`.
- **`findProvinciasByNombres`/`findCantonesByProvinciaIds`/`findDistritosByCantonIds`**
  traen el universo de filas candidatas (por nombre/por padres resueltos) y el
  `BulkOrdenService` arma índices en memoria case-insensitive + trim para resolver
  jerárquicamente y detectar ambigüedad (bucket con más de una fila para la misma
  clave normalizada), en vez de pedir una fila exacta por `findUnique` (que no
  detectaría ambigüedad ni permitiría comparación insensible a mayúsculas de forma
  eficiente en un solo round-trip por columna).
- **`lib/config/carga-masiva.ts` no tenía test explícito en `tasks.md`** (solo se
  menciona su cobertura via T19/R28 a nivel de ruta); se añadió igualmente
  `tests/unit/config/carga-masiva-config.test.ts` (patrón `ordenes-config.test.ts`)
  como cobertura adicional de bajo costo, sin sustituir la cobertura de R28 en T19.

## Deuda pendiente (fuera de alcance de esta sesión)

- **Aplicar la migración `20260710000000_carga_masiva_ordenes` contra Postgres
  real** (Supabase). No se corrió `prisma migrate dev` por instrucción explícita
  (requiere DB/shadow DB); la migración y su `down.sql` están escritos a mano y
  cubiertos solo por tests estáticos (lectura de `.sql`), igual que las features
  6/10 previas. Deuda de despliegue aceptada.
- **Geografía (zona/provincia/canton/distrito) sigue sin sembrar** (prerequisito
  operativo externo, fuera de alcance de esta feature per decisión humana). El
  endpoint reporta filas en error mientras esas tablas estén vacías.
- El `down.sql` reintenta `ALTER COLUMN "peso" SET NOT NULL`, que fallará
  explícitamente en un rollback real si existen órdenes con `peso NULL` (creadas
  por carga masiva); es el comportamiento deliberado documentado en el propio
  `down.sql` (no se corrompen datos silenciosamente).

## Veredicto

Feature 15 implementada completa: T1–T20 en verde, R1–R32 con test propio,
`pnpm typecheck` / `pnpm lint` / `pnpm test` (60 archivos, 485 tests) pasan sin
regresiones sobre el baseline (54/413).
