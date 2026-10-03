# 470 — Descargas sin tope de filas · design

> Lee primero `requirements.md` (R1–R24 y «Decisiones tomadas sin preguntar»). Base medida: `dev` @
> `758252ae`. Búsqueda de código: grafo `codebase-memory` + confirmación en archivo real.

## 0. Causa, medida

- El tope es `descargaConfig.MAX_FILAS` (`lib/config/descarga.ts:22`, env `DESCARGA_MAX_FILAS`, default
  5000). Lo aplican ~25 servicios (`OrdenService:424`, `EstadoCuentaService:191`, `DetalleEnLoteService:122`,
  `WalletService:369`, `CierresAdminService:621/663/716`…), el adaptador de cliente `filasLocales`
  (`components/shared/descarga-resultado.ts:102`) y `ordenes-de-fila-cuenta.ts:59`.
- Existe porque en Familia A el conjunto completo viaja **en la respuesta de una Server Action** y el
  navegador arma el archivo (`DescargarDatasetButton.tsx:221-267` → `construirDescarga`,
  `lib/utils/descarga-dataset.ts:171`). Vercel corta los cuerpos de respuesta de función a **4,5 MB**.
- Cualquier tope fijo vuelve a quedarse corto: el historial crece cada día.

Conclusión: el problema real no es el número de filas sino **el tamaño de la respuesta de la acción**.
Basta con que el conjunto grande no viaje en esa respuesta.

## 1. Decisión central (D1): cambia el TRANSPORTE del conjunto, no el lugar donde se arma el archivo

Flujo nuevo para Familia A (todas las tablas del inventario §2):

```
navegador                                   servidor (Server Action)                 Supabase Storage
---------                                   ------------------------                 ----------------
descargarDatos("libroCajaKardexConDetalle", filtros)
  └─► prepararDescargaAction(nombre, input) ──► REGISTRO[nombre](input)   (la acción de HOY: sesión,
                                              │                             zod, permisos, servicio)
                                              ├─ resultado serializado ≤ umbral ─► { modo: "directo", resultado }
                                              └─ > umbral ─► gzip ─► upload tmp/<uuid>.json.gz ─► bucket privado
                                                             createSignedUrl(ruta, 300 s)
                                                             ◄─ { modo: "almacen", url }
  ◄── si "almacen": fetch(url) → DecompressionStream("gzip") → deserializar → MISMO `resultado`
  └─► el código de HOY: proyectar filas, kardex, hojas, columnas elegidas → construirDescarga → descargarBlob
```

- `descargarDatos` devuelve **exactamente el mismo tipo** que la acción registrada. Todo lo que hay
  aguas abajo (proyección, `colocarCuenta`, `colocarLibroCaja`, `filasDesdeResultado`, mensajes,
  `construirDescarga`) no cambia ni una línea. Por eso R8 (archivo idéntico) se cumple **por
  construcción**, y se prueba igualmente (T3.4).
- Las acciones de descarga existentes **no se tocan** (ni su firma ni sus tests): se llaman desde el
  registro con la misma entrada, dentro de la misma petición y con la misma sesión (R13).

### Por qué un registro y no envolver cada acción

Envolver el `return` de cada acción cambiaría su tipo de retorno: el compilador obligaría a tocar todos
sus tests y, peor, un consumidor que haga `if (r.status !== "ok") return error` trataría el sobre nuevo
como error **sin fallar en compilación** (fallo mudo). Con el registro, las acciones y sus tests quedan
intactos y el sobre (`{ modo }`) vive solo entre `prepararDescargaAction` y `descargarDatos`.

## 2. Inventario de descargas (todas las tablas con «Descargar»)

### 2.1 Familia A — pasan por `descargarDatos` (R5–R16, R24)

| # | Pantalla / archivo consumidor | Acción registrada (`lib/actions/…`) | Clave de registro |
|---|---|---|---|
| 1 | Órdenes — `app/(app)/ordenes/_components/OrdenesModule.tsx:611` | `ordenes.ts` `listarOrdenesCompleto` | `listarOrdenesCompleto` |
| 2 | Usuarios — `configuracion/_components/UsuariosModule.tsx:539` | `usuarios.ts` `listarUsuariosCompleto` | `listarUsuariosCompleto` |
| 3 | API keys — `configuracion/api/_components/ApiKeysModule.tsx:220` | `api-keys.ts` `listarApiKeysCompleto` | `listarApiKeysCompleto` |
| 4 | Plantillas de mensaje — `configuracion/plantillas/_components/PlantillasModule.tsx:307` | `plantillas.ts` `listarPlantillasCompleto` | `listarPlantillasCompleto` |
| 5 | Cobertura (tarifas) — `configuracion/tarifas/_components/DescargarCoberturaButton.tsx:41` | `cobertura.ts` `listarCoberturaDistritos` | `listarCoberturaDistritos` |
| 6 | Gastos fijos (plantillas) — `wallet/_components/GastosFijosPlantillasPanel.tsx:479` | `gasto-fijo-plantilla.ts` `listarPlantillasCompletoAction` | `listarPlantillasGastoFijoCompleto` |
| 7 | Cierres del día pasados — `cierre-dia/_components/CierreDiaModule.tsx:398` | `cierre-dia.ts` `listarCierresPasadosCompleto` | `listarCierresPasadosCompleto` |
| 8 | Cierres admin pendientes — `cierres-admin/_components/CierresAdminModule.tsx:264` | `cierres-admin.ts` `listarPendientesCierresAdminCompleto` | idem |
| 9 | Cierres admin histórico — `CierresAdminHistoricoLista.tsx:112` | `cierres-admin.ts` `listarHistoricoCierresAdminCompleto` | idem |
| 10 | Gestiones de cierres (admin) — `CierresAdminModule.tsx:1120` → `DescargarGestionesDialog.tsx:317` (prop `accion`) | `cierres-admin.ts` `listarGestionesCierresAdminCompleto` | idem |
| 11 | Cierres bodega solicitados — `CierresBodegaSolicitadosLista.tsx:97` | `cierre-bodega.ts` `listarCierresBodegaSolicitadosCompleto` | idem |
| 12 | Consolidación bodega — `ConsolidacionBodegaModule.tsx:182` | `cierre-bodega.ts` `listarConsolidablesCompleto` | idem |
| 13 | Cierres bodega pendientes — `CierresBodegaAdminModule.tsx:369` | `cierre-bodega.ts` `listarPendientesCierresBodegaCompleto` | idem |
| 14 | Cierres bodega resueltos — `CierresBodegaResueltosLista.tsx:98` | `cierre-bodega.ts` `listarHistoricoCierresBodegaCompleto` | idem |
| 15 | Gestiones de cierres (bodega) — `CierresBodegaAdminModule.tsx:586` → `DescargarGestionesDialog` | `cierre-bodega.ts` `listarGestionesCierresBodegaCompleto` | idem |
| 16 | Saldos satélites — `wallet/satelites/_components/SaldosSatelitesTable.tsx:337` | `conciliacion-satelites.ts` `listarSaldosSatelitesCompletoAction` | `listarSaldosSatelitesCompleto` |
| 17 | Conciliación satélite — `ConciliacionSatelite.tsx:339` | `conciliacion-satelites.ts` `listarConsolidacionesSateliteCompletoAction` | `listarConsolidacionesSateliteCompleto` |
| 18 | Historial de acciones — `historico/acciones/_components/HistorialAccionesModule.tsx:176/263` (inyectable) | `historial-acciones.ts` `listarHistorialAccionesCompleto` | idem |
| 19 | Incidentes histórico — `incidentes/_components/IncidentesHistoricoTabla.tsx:138` | `incidentes.ts` `listarHistoricoIncidentesCompleto` | idem |
| 20 | Incidentes pendientes — `IncidentesAdminModule.tsx:429` | `incidentes.ts` `listarPendientesIncidentesCompleto` | idem |
| 21 | Novedades — `novedades/_components/NovedadesModule.tsx:241/692` (`recursos.listarCompleto`) | `novedades.ts` `listarNovedadesCompletoAction` | `listarNovedadesCompleto` |
| 22 | Ayuda a tiendas — `NovedadesModule.tsx:234/692` | `novedades.ts` `listarAyudaTiendaCompletoAction` | `listarAyudaTiendaCompleto` |
| 23 | Recepción satélite (bodega) — `recepcion-satelite/_components/RecepcionSateliteModule.tsx:596-612` (también alimenta `SateliteOrdenesListado.tsx:737`) | `recepcion-satelite.ts` `listarOrdenesBodegaCompleto` | idem |
| 24 | Cuentas por pagar mensajeros — `wallet/mensajeros/_components/CuentasPorPagarTable.tsx:295` | `wallet-mensajero.ts` `listarCuentasPorPagarCompletoAction` | `listarCuentasPorPagarCompleto` |
| 25 | Libro de la caja «Solo los movimientos» — `wallet/_components/WalletModule.tsx:233` (vía `WalletLedger.tsx:436`) | `wallet.ts` `libroCajaKardexAction` | `libroCajaKardex` |
| 26 | **Libro de la caja con detalle por guía (el caso medido)** — `WalletModule.tsx:229` | `wallet.ts` `libroCajaKardexConDetalleAction` | `libroCajaKardexConDetalle` |
| 27 | Detalle de un movimiento de cierre (caja) — `wallet/_components/DetalleMovimientoCierre.tsx:135` | `wallet.ts` `verDetalleDeMovimientoCompletoAction` | `verDetalleDeMovimientoCompleto` |
| 28 | Saldos de tiendas — `wallet/tiendas/_components/SaldosTiendasTable.tsx:216` | `wallet-tienda.ts` `listarSaldosTiendasCompletoAction` | `listarSaldosTiendasCompleto` |
| 29 | Detalle de mi movimiento — `mi-wallet/_components/DetalleMiMovimientoCierre.tsx:126` | `wallet-tienda.ts` `verDetalleDeMiMovimientoCompletoAction` | `verDetalleDeMiMovimientoCompleto` |
| 30 | Estado de cuenta tienda/mensajero (solo movimientos) — `components/shared/estado-cuenta/EstadoCuenta.tsx:147` | `estado-cuenta.ts` `estadoCuentaKardexAction` | `estadoCuentaKardex` |
| 31 | Estado de cuenta tienda/mensajero con detalle — `EstadoCuenta.tsx:152` | `estado-cuenta.ts` `estadoCuentaKardexConDetalleAction` | `estadoCuentaKardexConDetalle` |
| 32 | Mi estado de cuenta (solo movimientos) — `mi-wallet/_components/MiEstadoCuenta.tsx:47` | `estado-cuenta.ts` `miEstadoCuentaKardexAction` | `miEstadoCuentaKardex` |
| 33 | Mi estado de cuenta con detalle — `MiEstadoCuenta.tsx:48` | `estado-cuenta.ts` `miEstadoCuentaKardexConDetalleAction` | `miEstadoCuentaKardexConDetalle` |

Notas del inventario:

- La línea es la de `dev` @ `758252ae`; el implementador re-censa al empezar (T3.1) con
  `grep` de `filasDesdeResultado|obtenerFilas|Completo\(|Kardex` en `app/` y `components/` y añade
  al registro cualquier descarga de Familia A que falte. La guardia T4.6 deja el censo fijado.
- **Fuera del registro a propósito** (acciones sin superficie de descarga, con `@sin-superficie` o sin
  consumidor en `app/`): `listarMovimientosCompletoAction`, `listarMovimientosDeTiendaCompletoAction`,
  `listarPagosDeMensajeroCompletoAction`, `verEstadoCuentaCompletoAction`,
  `verMiEstadoCuentaCompletoAction`. Registrarlas las haría alcanzables y la guardia
  `superficie-de-uso.guardia` exigiría quitar su anotación: no es de esta ficha.
- **Mismas acciones usadas fuera de una descarga** (siguen llamándose directo, no son descargas):
  `useNovedadesFiltro.ts:164/245` (la pantalla de novedades carga con `listarCompleto`) y
  `analitica/_components/finanzas/cargar-kpis.ts:237-238` (KPIs con saldos de tiendas y cuentas por
  pagar). La guardia T4.6 las lista como excepciones con motivo.

### 2.2 Familia B — conjunto ya en el navegador; solo pierden el tope (R23)

| Pantalla | Archivo |
|---|---|
| Pagos registrados (liquidación) | `components/shared/liquidacion/PagosRegistradosTabla.tsx:237` |
| Ranking | `app/(app)/ranking/_components/RankingModule.tsx:126` |
| Ranking histórico | `ranking/historico/_components/RankingHistoricoModule.tsx:187` |
| Analítica · vista financiera | `analitica/_components/export-financiero/ExportarVistaFinanciera.tsx:187` |
| Analítica · operativo | `analitica/_components/operativo/ExportarOperativoPanel.tsx:153` |
| Analítica · productos | `analitica/_components/entregas/ProductosTabla.tsx:1130` |
| Detalle de un cierre (gestiones) | `cierres-admin/_components/cierre-detalle-shared.tsx:1672` |
| Cierre del día (gestiones del cierre abierto) | `cierre-dia/_components/CierreDiaModule.tsx:779` |
| Órdenes de una fila del estado de cuenta | `wallet/_components/ordenes-de-fila-cuenta.ts:50-74` — lee por páginas del borde (`detalleMovimientoConfig.MAX_PAGE_SIZE`) y luego `filasLocales`; cada página es pequeña, así que no necesita transporte: solo cambia su tope (`:59`) al de Excel |

## 3. Piezas nuevas y cambios (backend)

### 3.1 Configuración — `lib/config/descarga.ts`

```ts
/** Excel: 1.048.576 filas por hoja, cabecera incluida. */
export const EXCEL_MAX_FILAS_DATOS = 1_048_575;

export interface DescargaConfigEnv {
  MAX_FILAS: number;              // = EXCEL_MAX_FILAS_DATOS, FIJO (R1, R3): ya NO lee DESCARGA_MAX_FILAS
  UMBRAL_ALMACEN_BYTES: number;   // env DESCARGA_UMBRAL_ALMACEN_BYTES, default 2_000_000 (R5/R6)
  TTL_URL_SEGUNDOS: number;       // env DESCARGA_TTL_URL_SEGUNDOS, default 300 (R10)
  RETENCION_MINUTOS: number;      // env DESCARGA_RETENCION_MINUTOS, default 60 (R17)
  BUCKET: string;                 // env DESCARGAS_BUCKET, default "descargas" (R9)
}
```

- `MAX_FILAS` conserva su nombre: los ~34 usos (servicios, `filasLocales`, `ordenes-de-fila-cuenta`,
  `DineroProductosRepository`) siguen funcionando sin tocarse; ahora significan «límite de Excel».
  Quitar el tope de cada servicio uno a uno sería más diff, más riesgo y dejaría sin red de memoria al
  servidor ante un conjunto absurdo.
- **No se lee de entorno a propósito** (R3): si producción tuviera `DESCARGA_MAX_FILAS=5000` definido,
  leerlo dejaría el fallo intacto sin ninguna señal.
- Este módulo también se importa en el cliente (`descarga-resultado.ts`); allí las env no existen y rigen
  los defaults, que es lo correcto (el cliente solo usa `MAX_FILAS`).
- Umbral de 2 MB y no 4 MB: el cuerpo de la respuesta de una Server Action no es JSON sino el formato de
  React (con su sobrecoste y el del sobre). 2 MB deja más de 2× de margen frente a 4,5 MB.

### 3.2 Códec — `lib/utils/codec-descarga.ts` (puro, sin efectos)

- `serializarDescarga(valor: unknown): string` — `JSON.stringify` con un *replacer* que etiqueta lo que
  JSON perdería y una Server Action sí transporta: `Date` → `{ "__descarga_fecha__": iso }`, `bigint` →
  `{ "__descarga_bigint__": "123" }`. Cualquier otro tipo no serializable (`Map`, `Set`, función,
  símbolo) **lanza** con el nombre del tipo (fallo ruidoso, nunca un dato perdido en silencio).
- `deserializarDescarga<T>(texto: string): T` — `JSON.parse` con el *reviver* inverso.
- Límite conocido y aceptado: una propiedad con valor `undefined` llega como ausente (igual de falsa en
  `?.`/`??`, distinta solo para `"k" in obj`). T3.4 compara el archivo final, que es lo que importa.

### 3.3 Almacén — `lib/interfaces/external/IAlmacenDescargas.ts` + `lib/storage/SupabaseAlmacenDescargas.ts`

```ts
export interface IAlmacenDescargas {
  /** Sube bytes a `tmp/<uuid>.json.gz` (R9). Crea el bucket privado si no existe y reintenta 1 vez (R14). */
  guardar(bytes: Uint8Array): Promise<{ ruta: string }>;
  /** URL firmada de lectura (R10). Nunca URL pública. */
  firmar(ruta: string, ttlSegundos: number): Promise<string>;
  /** Borra los objetos de `tmp/` creados antes de `corte`, hasta `maximo` por llamada (R17). */
  purgarAnterioresA(corte: Date, maximo: number): Promise<{ borrados: number; quedaPendiente: boolean }>;
}
```

- Implementación con el patrón ya existente de `SupabaseFileStorage` / `SupabaseSignedUrlProvider`
  (`lib/storage/`): cliente Storage **perezoso** (`createServerClient().storage`, service role) e
  **inyectable** (`StorageClientLike` ampliado con `upload`, `createSignedUrl`, `list`, `remove`,
  `createBucket`) para testear sin red.
- `guardar`: `upload(ruta, bytes, { contentType: "application/gzip", upsert: false })`. Si el error es
  «bucket no existe» (mensaje `/not found/i` o `statusCode` 404 del SDK) → `createBucket(BUCKET, {
  public: false })` (un error «already exists» se ignora: carrera entre dos descargas) → reintento único.
  Cualquier otro error **lanza** con contexto: «fallo al subir la descarga temporal: <mensaje del SDK>»
  (sin la ruta: no es secreta, pero no aporta).
- `purgarAnterioresA`: `list("tmp", { limit: 1000, sortBy: { column: "created_at", order: "asc" } })`,
  toma los de `created_at < corte`, `remove` en lote; repite mientras la página entera sea vieja y no se
  llegue a `maximo` (5.000 por corrida). Bucket inexistente ⇒ `{ borrados: 0 }`, no es error. A
  diferencia de `SupabaseFileStorage.remove`, **sí** propaga el `error` del SDK (la purga debe fallar
  ruidosa, no en silencio: lección de `purga-pdf-cargas/route.ts:46-50`).
- `BUCKETS` (`lib/storage/buckets.ts`) gana `DESCARGAS: "descargas"` con el comentario «se crea solo, en el
  primer uso, PRIVADO».

### 3.4 Servicio de entrega — `lib/services/EntregaDescargaService.ts` (+ interfaz en `lib/interfaces/services/`)

```ts
type ResultadoPreparado<R> = { modo: "directo"; resultado: R } | { modo: "almacen"; url: string };
entregar<R>(resultado: R): Promise<ResultadoPreparado<R>>
```

1. `texto = serializarDescarga(resultado)`; `bytes = byteLength(texto)`.
2. Si `bytes <= UMBRAL_ALMACEN_BYTES` ⇒ `{ modo: "directo", resultado }` (el objeto original, no el
   texto: la respuesta es la de hoy, R6). Cero llamadas al almacén.
3. Si no ⇒ `gzip(texto)` (`node:zlib`, inyectable) → `almacen.guardar(gz)` → `almacen.firmar(ruta, TTL)` ⇒
   `{ modo: "almacen", url }`.
- Errores de subida o firma se propagan (R15): `withErrorHandler` de la acción los registra y los traduce
  a `ActionError`.
- No decide nada de permisos: solo recibe resultados que la acción ya autorizó.
- **Resultados de error** (R11): todo resultado cuyo `status` no sea `"ok"` es pequeño por naturaleza
  (conteos, sin filas), así que el punto 2 lo devuelve directo sin tocar el almacén. Se afirma con test,
  no se supone.

Tipo `ResultadoPreparado` en `lib/types/descarga-preparada.ts` (módulo de tipos, sin dependencias).

### 3.5 Registro + acción — `lib/actions/_shared/registro-descargas.ts` y `lib/actions/descargas.ts`

- `registro-descargas.ts` (módulo de servidor normal, **imports estáticos** de las 33 acciones de §2.1):
  `export const REGISTRO_DESCARGAS = { listarOrdenesCompleto, …, libroCajaKardexConDetalle: libroCajaKardexConDetalleAction, … } as const;`
  `export type RegistroDescargas = typeof REGISTRO_DESCARGAS; export type NombreDescarga = keyof RegistroDescargas;`
  Imports estáticos (no `import()` dinámico) porque `superficie-de-uso.guardia` resuelve alcanzabilidad
  por imports estáticos: así las acciones siguen siendo alcanzables a través del registro.
- `descargas.ts` (`"use server"`, solo exporta funciones async):

```ts
export async function prepararDescargaAction(
  nombre: unknown,
  input: unknown,
  deps: { entrega?: IEntregaDescargaService; registro?: Record<string, (i: unknown) => Promise<unknown>> } = {},
): Promise<ResultadoPreparado<unknown> | ActionError>
```

  1. `nombre` validado con `z.enum(Object.keys(REGISTRO_DESCARGAS))` — fuera del registro ⇒
     `validation_error` sin ejecutar nada (R12).
  2. `const resultado = await registro[nombre](input)` — **un solo argumento**: nunca se reenvían `deps`
     desde el navegador. La acción registrada resuelve la sesión, valida con su zod `.strict()` y
     autoriza exactamente como hoy (R13).
  3. `return entrega.entregar(resultado)` dentro de `withErrorHandler` → errores de almacén ⇒
     `ActionError` (R15).
- Seguridad: no abre superficie nueva. Las 33 acciones ya son Server Actions invocables desde el
  navegador; `prepararDescargaAction` solo puede invocar esas, con la misma entrada y la misma sesión. La
  URL firmada solo viaja en la respuesta a quien hizo la petición (R10/R13).

### 3.6 Purga — `lib/services/PurgaDescargasService.ts` + `app/api/cron/purga-descargas/route.ts`

- Clon estructural de `app/api/cron/purga-pdf-cargas/route.ts`: `runtime = "nodejs"`, `maxDuration = 60`,
  autorización `Bearer` con el mismo secreto (`loadCronConfig().CORTE_DIARIO_SECRET`) **antes** de
  construir nada (R19), `withErrorHandler` + `appErrorToResponse`, cuerpo solo con conteos
  `{ objetosBorrados, quedaPendiente }` (R20).
- Servicio: `ejecutar(now)` → `almacen.purgarAnterioresA(now − RETENCION_MINUTOS, 5000)`.
- `vercel.json`: `{ "path": "/api/cron/purga-descargas", "schedule": "*/15 * * * *" }` (R18). El plan
  admite crons sub-diarios: `procesar-jobs` ya corre cada minuto.
- No usa la cola `jobs`: la cola es para trabajo por evento con reintentos; esto es una barrida periódica
  idempotente y la cola ya mostró inanición por lotes (memoria «Cola: inanición por lote de 10»).

## 4. Cambios de frontend

### 4.1 `components/shared/descarga-datos.ts` (nuevo, cliente, sin React)

```ts
export async function descargarDatos<K extends NombreDescarga>(
  nombre: K,
  input: Parameters<RegistroDescargas[K]>[0],
): Promise<Awaited<ReturnType<RegistroDescargas[K]>>>
```

- Llama a `prepararDescargaAction(nombre, input)`. `modo: "directo"` ⇒ devuelve `resultado`.
  `modo: "almacen"` ⇒ `leerDesdeAlmacen(url)`: `fetch(url)` (sin credenciales), `!ok` ⇒ lanza;
  `body.pipeThrough(new DecompressionStream("gzip"))` → texto → `deserializarDescarga`. Un `ActionError`
  del propio sobre (nombre inválido, fallo de almacén) ⇒ **lanza** `Error` con el `code`.
- Lanzar es suficiente para R15/R16: todos los caminos ya terminan en un `catch` que produce el aviso sin
  archivo (`DescargarDatasetButton.tsx:268-271`, `EstadoCuenta.tsx:416-418`, etc.). T4.5 lo afirma por
  pantalla tipo.
- `import type` del registro: el cliente no arrastra código de servidor, solo tipos.

### 4.2 Cableado de las 33 descargas (mecánico)

`listarOrdenesCompleto({ … })` ⇒ `descargarDatos("listarOrdenesCompleto", { … })`, sin tocar nada más.
Casos con inyección:
- `DescargarGestionesDialog` recibe `accion` por prop: los padres pasan
  `(f) => descargarDatos("listarGestionesCierresAdminCompleto", f)` (idem bodega). El tipo de la prop no
  cambia.
- `HistorialAccionesModule:176`: el default pasa a `(i) => descargarDatos("listarHistorialAccionesCompleto", i)`;
  los tests que inyectan su doble siguen igual.
- `NovedadesModule`: `recursos` gana `descargarCompleto` para la descarga (`:692`); `listarCompleto` sigue
  directo para la pantalla (`useNovedadesFiltro`).
- `EstadoCuenta.tsx:147-153` y `MiEstadoCuenta.tsx:47-48`: los lectores (`leerKardex`,
  `leerKardexConDetalle`) llaman a `descargarDatos`. El tipo `LectorEstadoCuenta` no cambia.

### 4.3 `DescargarDatasetButton` (R21)

- Mientras `generando`: el texto visible del botón pasa a «Preparando el archivo…» (constante exportada
  `TEXTO_PREPARANDO`), `aria-busy="true"`. El `aria-label` sigue siendo `«Descargar <título>»` para no
  romper a quien localiza el control por su nombre accesible.
- `catch` específico de `LimiteExcelExcedidoError` (§4.4) ⇒ su mensaje; el resto sigue en `MENSAJE_FALLO`.

### 4.4 Guardia de Excel en el armado — `lib/utils/descarga-dataset.ts` (R2)

- `export class LimiteExcelExcedidoError extends Error { hoja; filas; limite }`. `construirDescarga`, para
  `xlsx`, comprueba cada hoja (principal y adicionales) **antes** de llamar a `exceljs`: más de
  `EXCEL_MAX_FILAS_DATOS` filas ⇒ lanza. CSV no tiene hojas: lo acota el tope de servicio.
- Mensaje (en `descarga-resultado.ts`, junto a los demás): `mensajeLimiteExcel(hoja, filas)` ⇒
  «La hoja «{hoja}» tendría {filas} filas y Excel admite hasta 1.048.575 por hoja. Acota el periodo o
  los filtros y vuelve a intentarlo.»
- Los avisos de tope de servicio existentes (`mensajeLimite`, `mensajeLimiteDetalle`,
  `ESTADO_CUENTA_TEXTO.limiteDescarga`) **no cambian de texto**: interpolan el máximo, que ahora es el de
  Excel, y siguen diciendo qué hacer.

## 5. Familia B: por qué basta con quitar el tope

En Familia B el conjunto ya llegó al navegador con la carga de la propia pantalla; pulsar «Descargar» no
hace ninguna petición (`filasLocales`, `descarga-resultado.ts:98-107`). El límite de 4,5 MB es de las
respuestas de función de Vercel, y aquí no hay ninguna. El único riesgo es memoria del navegador al
armar el xlsx, que es el mismo que ya existe y se mide en T5. Con `MAX_FILAS` = límite de Excel,
`filasLocales` deja de cortar en 5.000 sin tocar ninguna de esas pantallas.

## 6. Modelo de datos

- **Sin tablas, sin migraciones, sin RLS nuevas.** El único recurso nuevo es el bucket de Storage
  `descargas` (privado), creado por el código en el primer uso con la service role (R14). Así existe en
  producción, preview (que el MCP del leader no alcanza) y local sin pasos manuales.
- Contenido del bucket: solo `tmp/<uuid>.json.gz`, vida máxima ≈ 75 min (retención 60 + cadencia 15).

## 7. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| K1 | El `.env` local apunta Storage a **producción** (riesgo R3 de `docs/release.md`). | Los tests usan dobles inyectados (`StorageClientLike` falso); ningún test construye el cliente real (T2.2 lo afirma: el cliente es perezoso y los tests siempre inyectan). En el recorrido local con umbral forzado (T6.1) se escriben objetos temporales en el bucket `descargas` de producción: privados, ilegibles a los 5 min y purgados por el cron de prod. Se anota en el informe del recorrido. |
| K2 | Memoria del navegador con conjuntos de cientos de miles de filas (exceljs arma el libro en memoria). | T5 mide 50.000 y 200.000 filas; el caso real hoy es 14.153. Si 200.000 no cabe, se anota como límite práctico y Q1 decide si se arma en servidor. No bloquea: hoy el usuario no puede descargar NADA por encima de 5.000. |
| K3 | Memoria/tiempo de la función al leer conjuntos grandes de la DB, serializar y comprimir. | Mismas lecturas que hoy, sin tope de 5.000. Tiempo de función 300 s por defecto. Serializar + gzip de 50.000 filas se mide en T5. El tope de Excel acota el peor caso. |
| K4 | Pantallas que usan una acción «Completo» para pintar, no para descargar (`useNovedadesFiltro`, `cargar-kpis`), pierden el corte de 5.000. | Sus conjuntos están acotados por naturaleza (novedades abiertas; tiendas y mensajeros). Anotado; si algún día crecen, el problema sería de esa pantalla y su carga, no de la descarga. |
| K5 | Límite de tamaño de archivo del proyecto Supabase (50 MB por defecto). | El objeto va comprimido (JSON repetitivo: ~10× menos). Si se excediera, la subida falla ⇒ aviso R15, nunca un archivo truncado. |
| K6 | Tests que construyen `MAX_FILAS + 1` filas o un xlsx de `MAX_FILAS` filas (`descarga-170-volumen`, servicios `*-completo`) pasan a usar 1.048.576 y se vuelven lentos o se quedan sin memoria. | T1.3: esos tests fijan un tope pequeño con `vi.mock("@/lib/config/descarga")` (patrón ya usado en `tests/integration/db/estado-cuenta-servidor-458d.test.ts:44-52`) o un volumen literal; los dos tests que afirman `5000` (`descarga-config.test.ts`, `dinero-productos-sql.test.ts:215`) se reescriben al nuevo contrato. |
| K7 | Un tipo que el códec no conoce se perdería al ir por almacén. | El códec **lanza** con lo desconocido y T3.4 compara el archivo final directo vs almacén con fixtures reales del kardex con detalle y de órdenes. |
| K8 | Importar el registro (33 acciones) en el grafo de los tests de componentes. | Las acciones ya se importan hoy desde esos mismos componentes; si algún test de componente se rompe por un import nuevo, se mockea el módulo de acción afectado (T4.4). |

## 8. Alternativas descartadas

- **A1 — Armar el xlsx/csv en el servidor (lo que propuso el humano).** Descartada por coste y riesgo, no
  por resultado. La proyección de filas (`filaX` por tabla), la elección de columnas (preferencia en el
  `localStorage` del navegador, ficha 314), las negritas y el armado de las hojas del kardex
  (`colocarCuenta`, `colocarLibroCaja`, `filasKardex`, `filasDetallePorGuia`) viven en módulos de cliente
  de ~30 tablas. Moverlo exige: mandar al servidor las columnas elegidas, portar o duplicar ~30
  proyecciones y el armado del kardex, y un generador en servidor con streaming. Son días de trabajo y
  riesgo directo de que el archivo deje de ser idéntico. La entrega por almacén da al usuario lo mismo
  (Descargar → «Preparando el archivo…» → el archivo se baja solo; bucket privado; URL firmada corta;
  limpieza) con el archivo idéntico por construcción. Si un día hiciera falta (Q1), el registro y el
  almacén de esta ficha son reutilizables tal cual.
- **A2 — Paginar desde el navegador (N llamadas de < 4,5 MB y concatenar).** Sin Storage, pero: exige
  `skip/take` en ~25 servicios; entre página y página los datos cambian (filas duplicadas o perdidas sin
  señal: un fallo mudo); y el kardex con detalle no se puede trocear (saldo corrido e invariante
  hoja 2 = hoja 1 calculados en una sola lectura del servidor, ficha 468).
- **A3 — Route handler con respuesta en streaming.** Cambia el borde (lecturas internas por Server Action,
  `docs/architecture.md`) y se apoya en un comportamiento de la plataforma sobre cuerpos en streaming que
  no está medido en este repo. Descartada por no verificable antes de desplegar.
- **A4 — Subir `DESCARGA_MAX_FILAS` en Vercel.** No resuelve nada: por encima de ~4,5 MB la respuesta se
  corta igual (con 14.153 filas del detalle ya está en el filo) y el historial sigue creciendo.
- **A5 — Limpieza con la cola `jobs` o con un TTL del bucket.** La cola es para trabajo por evento y ya
  mostró inanición; Supabase Storage no ofrece caducidad automática de objetos. Cron propio, idempotente.
- **A6 — Mandar siempre por almacén (sin umbral).** Más simple en un eje, pero toda descarga pasaría a
  depender de Storage y los tests y el entorno local (que apunta a Storage de prod) lo tocarían siempre.

## 9. Variables de entorno nuevas (opcionales, todas con default)

`DESCARGA_UMBRAL_ALMACEN_BYTES` (2000000), `DESCARGA_TTL_URL_SEGUNDOS` (300),
`DESCARGA_RETENCION_MINUTOS` (60), `DESCARGAS_BUCKET` (descargas). Se documentan en `.env.example` si el
repo lo tiene. `DESCARGA_MAX_FILAS` deja de tener efecto (R3): si existe en Vercel, puede borrarse.
Ninguna es necesaria para desplegar.
