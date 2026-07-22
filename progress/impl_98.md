# Impl 98 — API: `costoEnvio` (flete + IVA) en la carga por API

Rama: `feature/98-api-carga-valor-pagar` (desde `origin/dev`). Backend puro. Sin
migración (design §1: la feature solo LEE `tarifas` + `zona.es_central`).

## Decisiones del gate F1.4 (implementadas tal cual)
- **D1/R8** — tienda sin tarifa vigente (`resolver → null`) → `costoEnvio = "0.00"`;
  la orden se crea igual, nunca `null`, nunca `error`.
- **D2/R7** — valor = **flete + IVA del flete** (STRING escala 2, `ROUND_HALF_UP`),
  reutilizando `aplicarPorcentaje` de `lib/utils/ingreso-ordenex.ts`.
- **D3/R5** — nombre del campo: `costoEnvio`, en el bloque `ordenes` de la respuesta.

## Archivos modificados (código)
- `lib/utils/ingreso-ordenex.ts` — nuevo helper puro money-safe
  `costoEnvioDeTarifa(tarifa, esCentral): string` (flete por columna + IVA del flete;
  `"0.00"` si `tarifa === null`). Misma selección de columna + IVA que `derivarIngresoOrden`.
- `lib/interfaces/repositories/IOrdenRepository.ts` — `DistritoRow` gana `esCentral: boolean`.
- `lib/repositories/OrdenRepository.ts` — `findDistritosByCantonIds` proyecta
  `zona.esCentral` vía la N:M (`zonas: { select: { zonaId, zona: { select: { esCentral } } } }`);
  `esCentral` = flag de la única zona, `false` si 0 o >1 zonas.
- `lib/interfaces/services/IBulkOrdenService.ts` — `CargaViaApiOrden` gana `costoEnvio: string`
  (nunca `null`). `CargaViaApiRow`/`CargaViaApiSummary` sin cambio de forma.
- `lib/services/BulkOrdenService.ts` — nueva dependencia de constructor
  `ITarifaVigentePorTiendaRepository` (requerida: omisión del wiring = error de compilación).
  `cargarViaApi`: resuelve la tarifa del lote UNA vez (`resolveTarifaPorTienda`, sin N+1),
  propaga `esCentral` por `ResolvedGeo → resolveFila` (creada) y arma `costoEnvio` al ensamblar
  `ordenes`. `cargarMasiva` intacto (no toca la tarifa).
- `app/api/ordenes/api-key/carga/route.ts` — `buildBulkService` inyecta también
  `TarifaVigentePorTiendaRepository`. Resto del handler sin cambios.
- `app/api/ordenes/carga-masiva/chunk/route.ts` — mismo 2.º parámetro del constructor
  (la vía sesión no lo usa; se inyecta solo para satisfacer el contrato).

## Archivos modificados (tests)
- `tests/unit/utils/ingreso-ordenex.test.ts` — T2 (`costoEnvioDeTarifa`).
- `tests/unit/repositories/orden-repository.bulk.test.ts` — T4 (`esCentral` proyectado) +
  actualización de los mocks/aserciones existentes de `findDistritosByCantonIds`.
- `tests/unit/services/bulk-orden-service.carga-api.test.ts` — T7 (flete+IVA por creada) +
  T12 (contrato 88 intacto) + `buildService`/`buildTarifaRepo` para el nuevo parámetro.
- `tests/unit/services/bulk-orden-service.test.ts` — T11 (cargarMasiva no resuelve flete) +
  `tarifaRepoStub` para el nuevo parámetro.
- `tests/unit/services/rol-admin-satelite-authz.test.ts` — `tarifaRepoStub` (nuevo parámetro).
- `tests/integration/api/ordenes-api-key-carga.route.test.ts` — T10 (`costoEnvio` en la
  respuesta + shape de error/duplicada intacto).

## Mapa de trazabilidad R → test
| Req | Test |
|-----|------|
| R1  | bulk-orden-service.carga-api.test.ts › "R1/R2/R7: creada en zona NO-central"; "R3: la tarifa del lote se resuelve UNA sola vez" (resolver por la tienda dueña) |
| R2  | ingreso-ordenex.test.ts › costoEnvioDeTarifa no-central/central; orden-repository.bulk.test.ts › T4 esCentral true/false; bulk-orden-service.carga-api.test.ts › no-central/central |
| R3  | bulk-orden-service.carga-api.test.ts › "R3: la tarifa del lote se resuelve UNA sola vez (sin N+1)" |
| R4  | bulk-orden-service.carga-api.test.ts › "R4/R6: filas duplicada y error NO llevan costoEnvio" |
| R5  | bulk-orden-service.carga-api.test.ts › happy path `ordenes` con costoEnvio; ordenes-api-key-carga.route.test.ts › "R5: cada orden creada lleva su costoEnvio" |
| R6  | bulk-orden-service.carga-api.test.ts › "R4/R6…"; ordenes-api-key-carga.route.test.ts › "R6: filas error/duplicada conservan su shape" |
| R7  | ingreso-ordenex.test.ts › ivaFlete=0 / IVA 15% HALF_UP / STRING escala 2; bulk-orden-service.carga-api.test.ts › STRING escala 2 + COD/costoEnvio coexisten |
| R8  | ingreso-ordenex.test.ts › "tarifa null → '0.00'"; bulk-orden-service.carga-api.test.ts › "R8/D1: tienda SIN tarifa → '0.00', ninguna a error" |
| R9  | bulk-orden-service.test.ts › "cargarMasiva — sin resolución de flete (feature 98/R9)"; ordenes-carga-masiva-chunk.route.test.ts (no-regresión) |
| R10 | bulk-orden-service.carga-api.test.ts › "no-regresión del contrato 88 (feature 98/R10)" |

## Verificación (medida en este worktree)
- `pnpm db:generate` (schema limpio) → Prisma Client v7.8.0 OK.
- `pnpm typecheck` → **exit 0** (baseline previo también 0).
- `pnpm lint` (archivos tocados) → **exit 0**.
- `pnpm test` (suite completa) → **392 files passed, 3935 tests passed**, exit 0.
- Focalizados (6 archivos afectados) → 114/114; chunk route (R9) → 10/10.

## Veredicto
Implementación completa y en verde: `costoEnvio` (flete + IVA) por orden creada en la carga
por API, gap `"0.00"`, sin N+1, `cargarMasiva` intacto; typecheck/lint/suite completa en verde.
