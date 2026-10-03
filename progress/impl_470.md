# 470 — Descargas sin tope de filas · implementación (parte de servidor)

> `backend_dev`, 2026-10-02. Rama `feature/470-descargas-sin-tope` (local `be470`), base `fce7664a`.
> Alcance: T1.1–T1.3, T2.1–T2.3, T3.1–T3.4 y la medición T5 del lado servidor. **El bloque 4 (pantalla)
> lo hace `frontend_dev` sobre esta misma rama**: ver «Contratos para el frontend» al final.
>
> Búsqueda de código: el grafo `codebase-memory` (`R-job-singularis-projects-ordenex`) **no devolvió
> nada** para `colocarLibroCaja|filasDetallePorGuia|filasKardex` (que sí existen: índice rancio o sin
> esos símbolos), así que la búsqueda se hizo con `grep` y lectura de los archivos reales.

## Archivos

Nuevos:

- `lib/utils/codec-descarga.ts` — `serializarDescarga` / `deserializarDescarga` (Date y bigint etiquetados; lo desconocido lanza `ValorNoSerializableError`). Puro, válido en cliente.
- `lib/interfaces/external/IAlmacenDescargas.ts` + `lib/storage/SupabaseAlmacenDescargas.ts` — `guardar` / `firmar` / `purgarAnterioresA`; cliente perezoso e inyectable.
- `lib/types/descarga-preparada.ts` — `ResultadoPreparado<R>`.
- `lib/interfaces/services/IEntregaDescargaService.ts` + `lib/services/EntregaDescargaService.ts`.
- `lib/interfaces/services/IPurgaDescargasService.ts` + `lib/services/PurgaDescargasService.ts`.
- `lib/actions/_shared/registro-descargas.ts` — `REGISTRO_DESCARGAS` (33), `NombreDescarga`, `RegistroDescargas`, `NOMBRES_DESCARGA`.
- `lib/actions/descargas.ts` — `prepararDescargaAction` (`"use server"`).
- `app/api/cron/purga-descargas/route.ts`.
- Tests: `tests/unit/descarga/codec-descarga.test.ts`, `tests/unit/storage/almacen-descargas.test.ts`, `tests/unit/api/cron-purga-descargas.test.ts`, `tests/unit/services/entrega-descarga.test.ts`, `tests/unit/actions/preparar-descarga.test.ts`, `tests/unit/descarga/archivo-identico-470.test.ts`, `tests/unit/services/wallet-caja-kardex-470.test.ts`.

Modificados:

- `lib/config/descarga.ts` — `EXCEL_FILAS_DATOS_POR_HOJA = 1_048_575`; `MAX_FILAS` fijo (ya no lee `DESCARGA_MAX_FILAS`); `UMBRAL_ALMACEN_BYTES` (2.000.000), `TTL_URL_SEGUNDOS` (300), `RETENCION_MINUTOS` (60), `BUCKET` ("descargas").
- `lib/storage/buckets.ts` — `DESCARGAS: "descargas"`.
- `vercel.json` — `{ "path": "/api/cron/purga-descargas", "schedule": "*/15 * * * *" }`.
- `tests/unit/config/descarga-config.test.ts` — reescrito al contrato nuevo (R3 incluido).
- `tests/unit/analytics/dinero-productos-sql.test.ts` — la aserción `5000` pasa a `1_048_575` (es el contrato ⟨Q4⟩: el tope común).
- `tests/unit/guards/cron-hora-cr.guardia.test.ts` — el censo de crons pasa de 10 a 11 con la entrada nueva escrita a mano.
- 26 archivos de test que probaban la **mecánica** del tope (N entra, N+1 no) ganan un `vi.mock("@/lib/config/descarga")` que fija `MAX_FILAS: 5000` (T1.3/K6); ninguna aserción tocada: `tests/integration/descarga-170-volumen.test.ts`, `tests/unit/analytics/export-financiero-vacio.test.ts`, `tests/unit/historial-accion/lectura-borde-y-servicio.test.ts`, `tests/components/descarga/{RankingDescarga,RankingHistoricoDescarga,AnaliticaExportCsv}.test.tsx` y en `tests/unit/services/`: `api-key-descarga`, `cierre-dia-pasados-completo`, `cierres-admin-completo`, `cierres-bodega-admin-completo`, `consolidacion-completo`, `gasto-fijo-plantillas-completo`, `incidentes-completo`, `orden-service-descarga`, `plantilla-descarga`, `recepcion-satelite-completo`, `saldos-tiendas-completo`, `usuario-descarga`, `wallet-caja-descarga`, `wallet-cuentas-paginado`, `wallet-desglose-mensajero-descarga`, `wallet-tienda-descarga`, `wallet-tienda-desglose`, `CierresAdminService.gestiones-completo`, `CierresBodegaAdminService.gestiones-completo`, `conciliacion-satelites-service`.

Sin migraciones, sin tablas, sin RLS (design §6).

## Mapa R → test (servidor)

| R | Test |
|---|---|
| R1 | `tests/unit/services/wallet-caja-kardex-470.test.ts` («el tope del servicio es el limite de Excel», «R4: 14.153 filas…»); `tests/unit/config/descarga-config.test.ts` |
| R2 | (frontend, T4.3) — el lado servidor sigue devolviendo `limite_excedido` por encima de 1.048.575: mecánica cubierta por los 26 tests con tope fijado |
| R3 | `tests/unit/config/descarga-config.test.ts` («R3: DESCARGA_MAX_FILAS definida a cualquier valor NO cambia el maximo») |
| R4 | `tests/unit/services/wallet-caja-kardex-470.test.ts` («R4: 14.153 filas de detalle devuelven ok…» + mutación con tope 10 ⇒ `limite_excedido`) |
| R5 | `tests/unit/services/entrega-descarga.test.ts` (R5/R10); `tests/unit/actions/preparar-descarga.test.ts` («almacen») |
| R6 | `tests/unit/services/entrega-descarga.test.ts` (R6, incluido el borde `<=` exacto); `tests/unit/actions/preparar-descarga.test.ts` («directo») |
| R7 | (frontend, T4.1) |
| R8 | `tests/unit/descarga/archivo-identico-470.test.ts`; `tests/unit/descarga/codec-descarga.test.ts` |
| R9 | `tests/unit/storage/almacen-descargas.test.ts` («ruta = tmp/<uuid v4>.json.gz…», bucket por defecto) |
| R10 | `tests/unit/storage/almacen-descargas.test.ts` (firmar, «nunca pide una URL publica»); `tests/unit/services/entrega-descarga.test.ts` (TTL) |
| R11 | `tests/unit/services/entrega-descarga.test.ts` (R11, 5 formas de error); `tests/unit/actions/preparar-descarga.test.ts` («R11: un resultado de error…») |
| R12 | `tests/unit/actions/preparar-descarga.test.ts` (R12, 9 nombres inválidos incl. `__proto__`) |
| R13 | `tests/unit/actions/preparar-descarga.test.ts` (R13: misma entrada, un argumento; «cada entrada es un envoltorio de a lo sumo UN argumento») |
| R14 | `tests/unit/storage/almacen-descargas.test.ts` («guardar · bucket inexistente») |
| R15 | `tests/unit/services/entrega-descarga.test.ts` (R15); `tests/unit/actions/preparar-descarga.test.ts` (R15: error devuelto, no excepción, sin detalles internos) |
| R16 | (frontend, T4.1/T4.5) |
| R17 | `tests/unit/storage/almacen-descargas.test.ts` (purgarAnterioresA); `tests/unit/api/cron-purga-descargas.test.ts` (corte exacto) |
| R18 | `tests/unit/api/cron-purga-descargas.test.ts` (vercel.json ≤ 15 min); `tests/unit/guards/cron-hora-cr.guardia.test.ts` |
| R19 | `tests/unit/api/cron-purga-descargas.test.ts` (4 casos de 401 sin construir nada) |
| R20 | `tests/unit/api/cron-purga-descargas.test.ts` (cuerpo exacto, fallo sin rutas) |
| R21–R24 | (frontend, bloque 4) |

Mutaciones medidas:

- Codec sin la etiqueta de `Date` ⇒ `archivo-identico-470` rojo (1 caso: «el resultado transportado es igual, con las fechas como Date»). Nota honesta: la comparación **celda a celda** del xlsx de órdenes no lo detecta (las columnas de `filaDescargaOrden` dan el mismo texto con la fecha en ISO), lo mata el `toEqual` del resultado transportado.
- Umbral `<=` → `<`: lo mata «BORDE: serializado de EXACTAMENTE el umbral ⇒ directo».
- Tope del detalle a 10: el mismo conjunto de 14.153 devuelve `limite_excedido` (test explícito).

## T1.3 — tiempos antes/después (los 41 archivos que leen el tope, sin `integration/db`)

Antes del cambio: 516/516 en verde. Con el tope en 1.048.575 y **sin** adaptar: 15 rojos y **dos workers muertos por OOM** (4 GB) en `RankingDescarga`/`RankingHistoricoDescarga`; `cierres-admin-completo` pasó de 0,2 s a 44 s. Tras adaptar: 519/519, y ningún archivo tarda más de 1 s por encima de `dev` (el mayor: `dinero-productos-sql` 34 ms → 0,6 s, que sigue con el tope REAL porque su caso ⟨Q4⟩ afirma el valor; `descarga-resultado` 10 ms → 0,5 s, sin mock a propósito para la T4.7 del frontend).

## T3.1 — re-censo

`grep` en `app/` y `components/` de `…Completo|…CompletoAction|…KardexAction|…KardexConDetalleAction|listarCoberturaDistritos`: aparecen **exactamente las 33** acciones del inventario (design §2.1) y ninguna más. Los usos fuera de descarga siguen siendo los de design §2.1 (`useNovedadesFiltro.ts`, `cargar-kpis.ts`). `DescargarCierresButton.tsx` recibe `accion`/`obtenerFilas` por prop de los módulos ya censados. Las exportaciones de analítica (`ExportarVistaFinanciera`, `ExportarOperativoPanel`) llaman a `consultarMetricaFinanciera`/`consultarAnaliticaOperativa` (series agregadas, tamaño acotado por el número de buckets, no listas): fuera del registro.

## T5 — medición (Node 22, este equipo; datos sintéticos en memoria, sin Storage)

Fila = `OrdenListItemDTO` completo con `relaciones` (la tabla más ancha: **22 columnas**, no 15 como decía el design).

| Caso | Tiempo | Pico heap | Pico RSS | Tamaño |
|---|---|---|---|---|
| `serializarDescarga` + gzip, 50.000 (servidor) | 0,7 s (0,5 + 0,23) | 132 MB | 283 MB | JSON 51,5 MB → gz **1,7 MB** |
| `serializarDescarga` + gzip, 200.000 (servidor) | 3,0 s | 433 MB | 874 MB | JSON 207 MB → gz **7,1 MB** |
| `construirDescarga` csv, 50.000 | 0,1 s | 141 MB | 222 MB | 9,6 MB |
| `construirDescarga` xlsx, 50.000 | 5,1 s | 936 MB | 1,23 GB | 3,6 MB |
| `construirDescarga` csv, 200.000 | 0,6 s | 401 MB | 561 MB | 38,8 MB |
| `construirDescarga` xlsx, 200.000 | 23,7 s | **2,2 GB** | 2,7 GB | 14,5 MB |

Lectura: el servidor va sobrado (gzip ~30×; 200.000 órdenes = 7 MB en Storage, lejos de los 50 MB de K5). El riesgo es el **xlsx en el navegador** (K2/Q1): 50.000 filas caben (< 60 s, < 1,5 GB), **200.000 piden ~2,2 GB de heap**, que un navegador de equipo modesto probablemente no da. El caso real de hoy (14.153) queda muy por debajo. Con 2 MB de umbral, una descarga de órdenes va por almacén a partir de ~2.000 filas.

## Desviaciones respecto al design

1. **Registro con envoltorios de un argumento** (`(input) => accion(input)`) en vez de las referencias directas: garantiza que nunca se reenvía `deps` y resuelve `listarCoberturaDistritos`, cuyo **primer** parámetro es `deps` (pasarle la entrada del navegador habría sido pasarle `deps`). Imports estáticos igualmente.
2. **Error del almacén ⇒ `AppErrorShape` (`status: "error"`, `code: "INTERNAL"`, mensaje genérico)**, no `ActionError`: el union `ActionError` no tiene un estado para «falló el servidor» y `toActionError` relanza en `INTERNAL` (sería una excepción, contra R15). El resto de códigos sí pasan por `toActionError`.
3. **`@sin-superficie` temporal en `prepararDescargaAction`**: hasta que el frontend la cablee nadie alcanzable la importa y `superficie-de-uso.guardia` se pondría rojo. **El frontend debe borrar la anotación** al cablear `descargarDatos` (la guardia exige quitarla en cuanto es alcanzable).
4. El cron no clona el `buildService` con Prisma (no hay repositorio): solo almacén + config.
5. **`EXCEL_MAX_FILAS_DATOS` del design se llama `EXCEL_FILAS_DATOS_POR_HOJA`** (exportada desde `lib/config/descarga.ts`): el nombre del design choca con `rollup-guards` R47. La T4.3 del frontend debe importar este nombre.

## Contratos para el frontend

**Servidor (ya en la rama):**

```ts
// lib/actions/descargas.ts  ("use server")
export async function prepararDescargaAction(
  nombre: unknown,          // una clave de REGISTRO_DESCARGAS
  input: unknown,           // la MISMA entrada que hoy se pasaba a la acción
  deps?: PrepararDescargaDeps, // SOLO tests; nunca desde el navegador
): Promise<PrepararDescargaResult>;

export type PrepararDescargaResult =
  | ResultadoPreparado<unknown>   // { modo: "directo"; resultado } | { modo: "almacen"; url }
  | ActionError                   // validation_error si el nombre no está en el registro (R12)
  | AppErrorShape;                // { status: "error", code: "INTERNAL", message } si falló almacén/firma (R15)

// lib/actions/_shared/registro-descargas.ts — importar SOLO tipos desde el cliente:
import type { NombreDescarga, RegistroDescargas } from "@/lib/actions/_shared/registro-descargas";
// lib/types/descarga-preparada.ts
import type { ResultadoPreparado } from "@/lib/types/descarga-preparada";
// lib/utils/codec-descarga.ts — puro, sin imports de Node: válido en el navegador
import { deserializarDescarga } from "@/lib/utils/codec-descarga";
```

**`descargarDatos` (T4.1, `components/shared/descarga-datos.ts`), firma sugerida:**

```ts
export async function descargarDatos<K extends NombreDescarga>(
  nombre: K,
  input: Parameters<RegistroDescargas[K]>[0],   // hoy es `unknown` en las 33
): Promise<Awaited<ReturnType<RegistroDescargas[K]>>>
```

- Discriminar el sobre: `if (typeof r === "object" && r !== null && "modo" in r)`. `directo` ⇒ devolver `r.resultado` (sin `fetch`). Cualquier otra cosa (`validation_error`, `status: "error"`) ⇒ `throw new Error(...)` con `status`/`code`: todos los consumidores ya terminan en un `catch` que da el aviso sin archivo (R15).
- `almacen` ⇒ `leerDesdeAlmacen(url)`:
  ```ts
  const res = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!res.ok || res.body === null) throw new Error(`descarga temporal: HTTP ${res.status}`);
  const texto = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return deserializarDescarga<T>(texto);
  ```
  El objeto se sube con `contentType: application/gzip` y **sin** `Content-Encoding`: el navegador NO lo descomprime solo, hay que pasar por `DecompressionStream`. Un gzip corrupto o una URL caducada (Supabase responde 400/404 a los 300 s) hacen lanzar (R16).
- La URL tiene la forma `…/storage/v1/object/sign/descargas/tmp/<uuid>.json.gz?token=…`; vale 300 s.
- **Borrar el `@sin-superficie`** del JSDoc de `prepararDescargaAction` al cablearla (desviación 3).
- Tests de componente: `vi.mock` de un módulo de acción sigue interceptando a través del registro (el registro importa ese módulo). Ojo: el envoltorio llama a la acción con **un** argumento, así que donde hoy se afirma `mock.calls[0]).toEqual([])` (p. ej. `WalletPropsDescarga.test.tsx:531/659`, acciones sin entrada) pasará a ser `[undefined]` o la entrada que se mande. Lo más simple en tests de pantalla es mockear `@/components/shared/descarga-datos`.
- `tests/unit/components/descarga-resultado.test.ts` **no** lleva el mock del tope: la T4.7 (5.001 y 20.000 filas ⇒ `ok`) puede escribirse con el tope real.

**Guardia T4.6 (`descargas-por-registro.guardia.test.ts`):** la clave del registro NO siempre es el nombre del símbolo; el símbolo a buscar en `app/`/`components/` es el que importa `registro-descargas.ts`:

| Clave | Símbolo | | Clave | Símbolo |
|---|---|---|---|---|
| `listarPlantillasGastoFijoCompleto` | `listarPlantillasCompletoAction` | | `listarSaldosSatelitesCompleto` | `listarSaldosSatelitesCompletoAction` |
| `listarConsolidacionesSateliteCompleto` | `listarConsolidacionesSateliteCompletoAction` | | `listarNovedadesCompleto` | `listarNovedadesCompletoAction` |
| `listarAyudaTiendaCompleto` | `listarAyudaTiendaCompletoAction` | | `listarCuentasPorPagarCompleto` | `listarCuentasPorPagarCompletoAction` |
| `libroCajaKardex` | `libroCajaKardexAction` | | `libroCajaKardexConDetalle` | `libroCajaKardexConDetalleAction` |
| `verDetalleDeMovimientoCompleto` | `verDetalleDeMovimientoCompletoAction` | | `listarSaldosTiendasCompleto` | `listarSaldosTiendasCompletoAction` |
| `verDetalleDeMiMovimientoCompleto` | `verDetalleDeMiMovimientoCompletoAction` | | `estadoCuentaKardex[ConDetalle]` / `miEstadoCuentaKardex[ConDetalle]` | `…Action` |

El resto: clave = símbolo. Cuidado con los prefijos: `listarPlantillasCompleto` (plantillas de mensaje) es prefijo de `listarPlantillasCompletoAction` (gastos fijos), y `libroCajaKardexAction` es prefijo… de nada, pero `libroCajaKardex` sí lo es de `libroCajaKardexConDetalle`: usar `\b<símbolo>\b`. Excepciones con motivo (design §2.1): las novedades — ojo, el símbolo NO aparece en `useNovedadesFiltro.ts` (recibe `listarCompleto` por parámetro) sino en `app/(app)/novedades/_components/NovedadesModule.tsx:234/241` (`recursos.listarCompleto: listarAyudaTiendaCompletoAction` / `listarNovedadesCompletoAction`, que la pantalla usa para pintarse); la excepción va en ese archivo y esas líneas, y la descarga (`:692`) debe ir por `descargarCompleto` — y `app/(app)/analitica/_components/finanzas/cargar-kpis.ts` (`listarSaldosTiendasCompletoAction`/`listarCuentasPorPagarCompletoAction` para los KPIs).

## Verificación

`./init.sh` **completo** en el worktree, con el `.env` del árbol principal copiado (`DATABASE_URL` → `localhost:5432/ordenex`, «los 329 archivos de tests contra Postgres SI se ejecutan») y `pnpm run db:generate` antes. Log: `progress/gate_470_backend.log` (sin commitear, como los demás logs).

**Corrida 1** (inicio 23:30): `INIT_EXIT=1`, 2 rojos, **los dos míos**, arreglados en `0b773a56`:
- `tests/unit/analytics/rollup-guards.test.ts` (R47 d): la guardia lee cualquier `const *MAX*FILAS*` como un segundo umbral de volumen del rollup ⇒ la constante se renombró `EXCEL_MAX_FILAS_DATOS` → **`EXCEL_FILAS_DATOS_POR_HOJA`** (desviación 5).
- `tests/unit/guards/censo-order-status-rename.test.ts` (R13): el fixture de `archivo-identico-470` usaba el value retirado `en_ruta` ⇒ fuera.

**Corrida 2** (commit `0b773a56`, inicio 23:51:56, 1.228 s):

```
✓ typecheck paso
✓ lint paso            (0 errors, 226 warnings — los de siempre)
✓ DATABASE_URL resuelta: los 329 archivos de tests contra Postgres SI se ejecutan
 Test Files  1 failed | 2385 passed (2386)
      Tests  1 failed | 33084 passed | 26 skipped (33111)
ROJOS NUEVOS: tests/components/OrdenesDescarga.test.tsx
INIT_EXIT=1
```

`skipped` = 26, los de siempre (las dos suites de Analítica). El único rojo **no es de esta rama**, es de reloj:
`expected 'ordenes-2026-10-02.xlsx' to be 'ordenes-2026-10-03.xlsx'`. El test calcula «hoy» con la fecha
LOCAL de la máquina (`hoyISO()`: `getDate()`; la máquina está en `America/Bogota`, UTC−5) y el código
nombra el archivo con el día calendario de **Costa Rica** (UTC−6, `fechaCalendarioCR`, ficha 457 O3). Entre
las 00:00 y la 01:00 de Bogotá discrepan: la corrida empezó a las 23:51 y ese archivo corrió pasada la
medianoche local. Ni el test ni `lib/utils/descarga-dataset.ts` ni nada de `components/` están en el diff
de la rama (`git diff fce7664a --stat` vacío para esos paths), el mismo archivo pasó en la corrida 1 (antes
de medianoche) y aislado da el mismo rojo mientras dure la ventana. Deuda ajena anotada (no va al
baseline: no es un rojo permanente): el test debería usar `fechaCalendarioCR(new Date())`.


## Veredicto

Servidor de la 470 (T1–T3 + T5 servidor) hecho y verde salvo un rojo de reloj ajeno a la rama; el bloque 4 (pantalla) queda para `frontend_dev` con los contratos de arriba.

---

# 470 — parte de pantalla (frontend)

> `frontend_dev`, 2026-10-03. Rama local `fe470` → `origin/feature/470-descargas-sin-tope`, base `0fdb3ee7`.
> Alcance: T4.1–T4.7, el arreglo de reloj de `OrdenesDescarga*` (fuera del spec, autorizado) y la
> verificación T6.1. Búsqueda de código: `grep` + lectura de archivos (los 33 símbolos venían censados
> con archivo:línea en el design y en la sección del servidor).

## Commits

- `aeca9298` test: `hoyISO()` de `OrdenesDescarga.test.tsx` y `OrdenesDescargaColumnas.test.tsx` pasa a
  `fechaCalendarioCR(new Date())`, y un caso nuevo fija el reloj en `2026-10-03T05:30Z` (00:30 Bogotá,
  23:30 CR) y afirma el literal `ordenes-2026-10-02.xlsx`. Corrido dentro de la franja (00:31 local): verde.
- `ddd743cf` T4.1/T4.2/T4.4/T4.6: `descargarDatos`, cableado de las 33, guardia R24, fuera el `@sin-superficie`.
- `d69e139b` T4.3/T4.5/T4.7: «Preparando el archivo…», guardia de Excel por hoja, tests de pantalla.

## Archivos

Nuevos: `components/shared/descarga-datos.ts`, `lib/utils/limite-excel.ts`,
`tests/unit/components/descarga-datos.test.ts`, `tests/unit/components/descarga-resultado-470.test.ts`,
`tests/unit/utils/descarga-dataset-excel.test.ts`, `tests/unit/guards/descargas-por-registro.guardia.test.ts`.

Modificados (producción): `components/shared/DescargarDatasetButton.tsx`, `components/shared/descarga-resultado.ts`
(`mensajeLimiteExcel`; comentario de `filasLocales` ya sin «5000»), `lib/utils/descarga-dataset.ts`,
`lib/actions/descargas.ts` (solo el JSDoc), `components/shared/estado-cuenta/EstadoCuenta.tsx` y 25 archivos de
`app/(app)/**` (cableado: una llamada y un import cada uno).

## Mapa R → test (pantalla)

| R | Test |
|---|---|
| R2 | `tests/unit/utils/descarga-dataset-excel.test.ts` (principal y adicional con 1.048.576 ⇒ `LimiteExcelExcedidoError`, exceljs no invocado; 1.048.575 no lanza por el contador); `tests/components/DescargarDataset.test.tsx` («R2: una hoja que pasa del límite…», texto literal y sin `descargarBlob`) |
| R6 | `tests/unit/components/descarga-datos.test.ts` («directo»: mismo objeto, sin `fetch`) |
| R7 | `tests/unit/components/descarga-datos.test.ts` («almacén»: una `fetch` sin credenciales, gzip real, `Date` y `bigint` reconstruidos); T6.1 abajo |
| R8 | T6.1 abajo (archivo directo = archivo por almacén, celda a celda) |
| R11 | `tests/unit/components/descarga-datos.test.ts` («los errores PROPIOS de la acción vuelven como resultado») |
| R15 | `descarga-datos.test.ts` (INTERNAL, validation_error, sobre sin forma ⇒ lanza); pantalla: `OrdenesDescarga.test.tsx`, `WalletCaja468.test.tsx`, `EstadoCuenta468.test.tsx` («470 R15/R16 … R15»); `DescargarDataset.test.tsx` («R15/R16: si obtener las filas LANZA…») |
| R16 | `descarga-datos.test.ts` (HTTP 400/403/404, red caída, gzip corrupto, JSON ilegible); pantalla: los mismos tres archivos («… R16: la URL firmada ya no se puede leer») |
| R21 | `tests/components/DescargarDataset.test.tsx` («R21: …Preparando el archivo…», deshabilitado, `aria-busy`, nombre accesible intacto, segundo click sin segunda obtención); T6.1 (captura del botón) |
| R22 | `tests/components/DescargarDataset.test.tsx` («R22: … `<slug>-AAAA-MM-DD.xlsx` con el día de Costa Rica», reloj fijado, generador real); `OrdenesDescarga.test.tsx` (franja 00:00–01:00) |
| R23 | `tests/unit/components/descarga-resultado-470.test.ts` (5.001 y 20.000 ⇒ ok, todas, en orden, sin red; tope fijado en 10 ⇒ aviso) |
| R24 | `tests/unit/guards/descargas-por-registro.guardia.test.ts` |

Mutaciones medidas: volver a poner `listarOrdenesCompleto({` en `OrdenesModule` ⇒ la guardia R24 da 2 rojos
(uso directo y clave sin `descargarDatos`). El caso de reloj fijado afirma un literal: con el `hoyISO()` local
antiguo daría `2026-10-03`.

## Desviaciones

1. **`LimiteExcelExcedidoError` vive en `lib/utils/limite-excel.ts`** (sin dependencias; `descarga-dataset.ts` lo
   reexporta y llama a `comprobarLimiteExcel`). El botón necesita reconocer el error con `instanceof` y no puede
   importar estáticamente `descarga-dataset` sin arrastrar el generador al bundle inicial (va por `import()`).
2. **`mensajeLimiteExcel(hoja, filas, limite)`** recibe también el límite y formatea los miles con punto a mano
   («1.048.575»), sin depender del ICU del navegador.
3. **T4.5 sin mockear `descargarDatos`**: en los tres archivos de pantalla se mockea `@/lib/actions/descargas` con
   un doble que **delega en la acción real** por defecto y en el caso sustituye UNA respuesta (`modo: "almacen"` +
   `fetch` 400, o `status: "error", code: "INTERNAL"`). Así el `descargarDatos` y el `leerDesdeAlmacen` que corren
   son los reales. Ningún test construye el cliente de Storage (el umbral por defecto deja todo en `directo`).
4. **Excepciones de la guardia R24 por archivo + símbolo, con UN uso permitido**, no por número de línea (las
   líneas se mueven con cualquier edición). Novedades (`NovedadesModule.tsx`, pintar la pestaña) y `cargar-kpis.ts`
   (KPIs). La guardia lee el mapa clave → símbolo del propio registro, tiene auto-prueba en las dos direcciones,
   descarta literales de texto (la clave `"listarOrdenesCompleto"` coincide con el símbolo) y exige ≥ 500 fuentes
   leídas (hay 672 en `app/` + `components/`; el 800 que puse primero era una suposición).
5. **Tests existentes adaptados al contrato nuevo, sin borrar ninguno**: 6 aserciones `mock.calls[0]).toEqual([])`
   pasan a `[undefined]` (el envoltorio del registro llama SIEMPRE con un argumento, R13) en
   `SaldosTiendasBuscador463`, `descarga/CierresDescarga`, `descarga/IncidentesDescarga` (2) y
   `descarga/WalletPropsDescarga` (2). Tres guardias que fijaban el camino viejo: `adaptador-conjunto.guardia`
   (el control positivo acepta `descargarDatos("<clave>"` además de la llamada directa),
   `cierres-descarga-detallada-puerta` (`accion={(f) => descargarDatos("…", f)}`) e
   `historial-acciones-solo-lectura.guardia` (el módulo ya no importa la lectura completa; se afirma la llamada
   por `descargarDatos`).
6. `HistorialAccionesModule`: el default es una función de módulo (`listarHistorialAccionesCompletoDescarga`) para
   que su identidad sea estable; los tests siguen inyectando por `acciones.listarCompleto`.
7. **T6.1 paso 2: `/ordenes` solo ofrece Excel** (no declara `formatos`), así que no hay CSV que comparar.

## Gate

`./init.sh` completo sobre `d69e139b`, con el `.env` del árbol principal (borrado al acabar). Log:
`progress/gate_470_frontend.log` (sin commitear, como los demás logs).

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 329 archivos de tests contra Postgres SI se ejecutan
 Test Files  2390 passed (2390)
      Tests  33130 passed | 26 skipped (33156)
INIT_EXIT=0
```

`skipped` = 26, los de siempre. Ningún flake. Duración 955 s.

## T6.1 — verificación en la app (`progress/recorrido_470/`)

Dev server propio (`pnpm dev -p 3470`), Playwright como `admin.qa@ordenex.test`. Dos corridas: umbral por defecto
(2 MB, vía directa) y `DESCARGA_UMBRAL_ALMACEN_BYTES=1` en la línea de arranque (vía del almacén). **K1:** la
segunda escribió **2 objetos temporales privados** en el bucket `descargas` del Storage de **producción**
(`tmp/b5389192-….json.gz` y `tmp/593b3f4f-….json.gz`), que purgará el cron de prod; si el bucket no existía, lo
creó esa corrida (privado). Dev server parado al acabar.

| Caso | Vía | Respuesta de la acción | Tiempo click → archivo | Archivo |
|---|---|---|---|---|
| `/wallet` caja, «Movimientos y detalle por guía», sin periodo (todo) | directo | 41.007 B, `modo: "directo"` | 1,5 s | 2 hojas: «Libro de movimientos» 39 filas (cabecera + saldo inicial + **36** movimientos + total; la tabla dice «1-20 de 36»), «Detalle por guía» 113 filas (112 + cabecera) |
| idem | almacén | **509 B**, `modo: "almacen"`, URL `…/object/sign/descargas/tmp/<uuid>.json.gz?token=…` | 7,8 s (incluye subir a Storage de prod la primera vez) | **idéntico** al directo, celda a celda y negritas |
| `/ordenes` sin filtros, Excel | directo | 178.730 B, `modo: "directo"` | 0,5 s | 86 filas = cabecera + **85** (la tabla dice «1-25 de 85»), 22 columnas |
| idem | almacén | **509 B**, `modo: "almacen"` | 1,8 s | **idéntico** al directo |

- **R21:** en las 4 descargas el botón mostró «Preparando el archivo…» (sondeo cada 25 ms; capturas `*-boton-preparando.png`).
- **Montos numéricos:** Entra/Sale/Cobrado a tiendas/Saldo son `number` en las dos hojas de la caja; «Monto a cobrar» y «Nº Guía» numéricos en órdenes (`comparacion.json` → `tipos`).
- **Hoja 2 = hoja 1:** «Total del periodo» (Entra 13.524.733,22 · Sale 40.800,5 · Cobrado 43.729,9) = «TOTAL GENERAL» del detalle.
- **R10/TTL:** las dos URLs firmadas llevan `exp − iat = 300`; pedidas a los 384–395 s responden **400 `InvalidJWT` «"exp" claim timestamp check failed»** (`ttl-url-firmada.json`; los tokens están redactados en `almacen-resultado.json`).
- Nombre del archivo con el día de CR: la corrida directa cayó a las 23:5x de CR (`…-2026-10-02.xlsx`) y la de almacén pasada la medianoche de CR (`…-2026-10-03.xlsx`).

Lo que el recorrido NO pudo medir: un conjunto local de verdad grande (la caja local tiene 36 movimientos y 85
órdenes); el caso real de 14.153 filas queda para T7.2 en producción.

## Veredicto (pantalla)

Bloque 4 hecho, gate completo verde (33.130 / 26 skipped) y verificado en la app por las dos vías con archivos idénticos.
