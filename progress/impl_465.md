# impl 465 — Tarifas: Excel de cobertura por distrito (parte BACKEND)

Rama: `feature/465-tarifas-excel-cobertura` (desde `550803ed`). Tareas T1–T6 de `specs/465-tarifas-excel-cobertura/tasks.md`.
Frontend (T7–T10) pendiente: lo hace un frontend_dev en esta misma rama.

Búsqueda de código: se usó lectura directa de los archivos citados por el design (ya confirmados allí); el grafo no fue necesario.

## Archivos creados

| Archivo | Tarea |
| --- | --- |
| `lib/types/cobertura.ts` | T1 — `MotivoSinCobertura`, `ZonaUnicaCobertura`, `CoberturaDistritoDTO` (sin textos de UI) |
| `lib/interfaces/repositories/ICoberturaRepository.ts` | T3 — `DistritoCoberturaRow`, `ICoberturaRepository` (2 lecturas) |
| `lib/repositories/CoberturaRepository.ts` | T3 — `listDistritos()` (sin `where`, zonas sin colapsar, `disponibleDesdeCadena`, flags vía `SELECT_FLAG_PROPIO`) y `listZonaIdsConTarifaGeneral()` (`where: { tiendaId: null, zonaId: { not: null } }`, `distinct`) |
| `lib/utils/cobertura-distrito.ts` | T2 — `clasificarCobertura`, `compararCobertura` (sobre `zonaUnicaDeDistrito`) |
| `lib/interfaces/services/ICoberturaService.ts` | T5 |
| `lib/services/CoberturaService.ts` | T5 — puerta `maestro` antes de leer, `Promise.all`, clasifica, ordena, tope `descargaConfig.MAX_FILAS` |
| `lib/actions/cobertura.ts` | T6 — `listarCoberturaDistritos(deps?)` + composition root `buildCoberturaService()` |
| `tests/unit/utils/_cobertura-fixtures.ts` | fábrica de filas (no es test) |
| `tests/unit/utils/cobertura-distrito.test.ts` | T2 |
| `tests/unit/utils/cobertura-vs-resolve-geo.test.ts` | T4 |
| `tests/unit/services/CoberturaService.test.ts` | T5 |
| `tests/unit/actions/cobertura.test.ts` | T6 |
| `tests/unit/actions/cobertura.composition-root.test.ts` | T6 |
| `tests/integration/db/cobertura-repository.test.ts` | T3 (Postgres real) |

Ningún archivo existente modificado. Sin migraciones, sin `prisma generate`.

### Nota para el frontend_dev (OBLIGATORIO)

`listarCoberturaDistritos` lleva una anotación **transitoria** `@sin-superficie` (la guardia
`tests/unit/guards/superficie-de-uso.guardia.test.ts` exige superficie o anotación). En cuanto
`DescargarCoberturaButton` la importe desde `page.tsx`, la guardia se pone ROJA hasta que se
**borre** esa anotación (caduca sola). Es lo esperado.

## Contrato de la action (para el frontend)

```ts
// lib/actions/cobertura.ts  ("use server")
export async function listarCoberturaDistritos(
  deps?: CoberturaActionDeps, // { coberturaService?, getActor? } — solo para tests
): Promise<ListarCompletoResult<CoberturaDistritoDTO>>;
// ListarCompletoResult (lib/types/descarga-listado.ts):
//   { status: "ok"; items: CoberturaDistritoDTO[]; total: number }
// | { status: "limite_excedido"; total: number; limite: number }
// | ActionError   // aquí: { status: "unauthenticated" } (R3) | { status: "forbidden" } (R2)
```

`CoberturaDistritoDTO` (`lib/types/cobertura.ts`), ya **ordenado** por provincia/cantón/distrito (R6):

| Campo | Tipo | Columna R5 que alimenta |
| --- | --- | --- |
| `provincia`, `canton`, `distrito` | `string` | Provincia, Cantón, Distrito |
| `disponible` | `boolean` | Activo: «Sí»/«No» (R7) |
| `cobertura` | `boolean` | Cobertura: «Sí»/«No» (R8) |
| `motivo` | `"provincia_retirada" \| "canton_retirado" \| "distrito_retirado" \| "sin_zona" \| "varias_zonas" \| null` | Motivo sin cobertura (R9 textos: «Provincia retirada del catálogo», «Cantón retirado del catálogo», «Distrito retirado del catálogo», «Sin zona asignada», «Asignado a varias zonas»); `null` ⇔ cobertura → celda vacía (R10) |
| `zonas` | `string[]` (orden alfabético es) | Zona (R11): 1 → el nombre; 0 → «Sin zona»; >1 → «Varias zonas: » + `zonas.join(", ")`. Vale también para no disponibles |
| `zonaUnica` | `{ nombre; esCentral; tieneTarifaGeneral } \| null` | GAM (R12) = `esCentral` ? «Sí» : «No», vacía si `null`; Tarifa general (R14) = `tieneTarifaGeneral` ? «Sí» : «No», vacía si `null` |
| `zonaEspecial` | `boolean \| null` | Zona especial (R13): true «Sí», false «No», null «Sin definir» |

Uso previsto (design §3.6): `obtenerFilas={() => filasDesdeResultado(listarCoberturaDistritos(), filaCobertura)}`.
Ojo: `filasDesdeResultado` recibe la promesa; llamar a la action dentro del callback garantiza la lectura en cada clic (R4).

## Mapa R → test (parte backend)

| R | Test |
| --- | --- |
| R2 | `tests/unit/services/CoberturaService.test.ts` «465/R2 — solo maestro…» (4 roles → forbidden, 0 llamadas al repo); `tests/unit/actions/cobertura.test.ts` «forbidden llega tal cual» |
| R3 | `tests/unit/actions/cobertura.test.ts` «465/R3 — sin sesion» (unauthenticated, `getPrismaClient` y `listar` sin llamar) |
| R4 | `tests/integration/db/cobertura-repository.test.ts` «listDistritos: activos e inactivos…» (los 6 sembrados, incluidos 2 no disponibles); `CoberturaService.test.ts` «lee en CADA llamada» |
| R6 | `tests/unit/utils/cobertura-distrito.test.ts` «465/R6 — orden…» (3 niveles, tildes y mayúsculas); `CoberturaService.test.ts` «una fila por distrito, en orden…» |
| R7 | `cobertura-distrito.test.ts` «distrito activo bajo canton retirado: NO disponible»; integración «Bajo Cantón Retirado» (`disponible=false` con `activo=true`) |
| R8 | `cobertura-distrito.test.ts` «465/R7-R8» |
| R9 | `cobertura-distrito.test.ts` «465/R9 — el PRIMER motivo» (6 casos, incl. los tres niveles retirados a la vez y retirado con 0 zonas) |
| R10 | `cobertura-distrito.test.ts` «disponible + zona unica -> cobertura, sin motivo» (`motivo: null`) — el texto vacío lo fija el test de columnas del frontend |
| R11 | `cobertura-distrito.test.ts` «varias zonas: nombres en orden alfabetico…», «sin zona…», «distrito NO disponible con zona unica…»; integración «Dos Zonas» (las dos llegan sin colapsar) |
| R12 | `cobertura-distrito.test.ts` «zona unica central…» / «no central…»; integración «En La Central» (`esCentral: true` real) |
| R13 | `cobertura-distrito.test.ts` «465/R13 — zona especial tri-valuada»; integración «Cero Zonas» (`zonaEspecial` null) y «Una Zona» (true) |
| R14 | **integración** «listZonaIdsConTarifaGeneral: solo la zona con tarifa (NULL, Z)…» (siembra (NULL,Z1), (T,Z2), (T,NULL), (NULL,NULL)); `cobertura-distrito.test.ts` «la tarifa de OTRA zona no cuenta»; composition-root (el `where` llega literal) |
| R15 | `tests/unit/utils/cobertura-vs-resolve-geo.test.ts` (24 combinaciones contra `resolveGeo` real) |
| R21 | `CoberturaService.test.ts` «465/R21 — la descarga no escribe» (Proxy que revienta ante cualquier método que no sea una de las 2 lecturas); la interfaz no tiene escrituras |
| R1, R5, R16–R20 | frontend (T7–T9) |

## Mutaciones (medidas, no razonadas)

| Mutación | Test que la mata | Resultado |
| --- | --- | --- |
| `CoberturaRepository`: `where: { zonaId: { not: null } }` (quitar `tiendaId: null`) | integración R14 | ROJO: «expected [...] to not include '<id de Z2>'» |
| `CoberturaRepository`: `where: { tiendaId: null }` (quitar `zonaId: { not: null }`) | integración R14 | ROJO: «expected [...] to not include null» |
| `cobertura-distrito.ts`: «sin zona» antes que «distrito retirado» | `cobertura-vs-resolve-geo.test.ts` caso 4 | ROJO (1 failed / 24 passed) |

Las tres se revirtieron; archivos restaurados desde copia.

Integración: corre contra `localhost:5432/ordenex` (`prisma migrate status`: 227 migraciones, al día).
El worktree no traía `.env`: se copió el del checkout principal (gitignored, no se commitea) para que
`HAY_BASE_DE_DATOS` sea verdadero y la integración NO se salte. Test aislado: 2 passed, 0 skipped.

## Gate — salida real

`./init.sh` COMPLETO (el diff toca `lib/types/`), log íntegro en `progress/gate_465_backend.log`:

- `pnpm run typecheck`: limpio (sin salida de errores).
- `pnpm run lint`: `✖ 220 problems (0 errors, 220 warnings)` — warnings preexistentes del repo.
- `pnpm run test:json`: `Test Files  2334 passed (2334)` · `Tests  32420 passed | 26 skipped (32446)`.
  Los 26 skipped son de `tests/components/AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9),
  preexistentes; **0 archivos de `integration/db` saltados** y `tests/integration/db/cobertura-repository.test.ts (2 tests)` ejecutado.
- `== init OK ==` · `INIT_EXIT=0`.

Veredicto: backend de la 465 (T1–T6) hecho y verificado con gate completo verde; falta el frontend (T7–T10).
