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
