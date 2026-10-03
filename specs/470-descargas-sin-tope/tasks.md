# 470 — Descargas sin tope de filas · tasks

> Orden: **Bloque 1–3 backend (`backend_dev`) → Bloque 4 frontend (`frontend_dev`)**, en la MISMA rama
> `feature/470-descargas-sin-tope`. Después medición (T5), recorrido en la app (T6), gate, revisión,
> despliegue y verificación en producción (T7, leader).
> Gate esperado: **`./init.sh` completo** (el diff toca `lib/types/` y configuración: el modo rápido se
> niega solo). `[P]` = paralelizable con la anterior del mismo bloque. Un commit por task lógica.
> Mapa R → test: `progress/impl_470.md` (lo escribe cada implementador con su parte).
> Regla de los tests: **ningún test construye el cliente real de Storage** (el `.env` local apunta a
> Storage de producción): siempre se inyecta un doble.

## Bloque 1 — Sin tope propio (backend)

- [ ] **T1.1** `lib/config/descarga.ts`: `EXCEL_MAX_FILAS_DATOS = 1_048_575`; `MAX_FILAS` fijo a ese valor
  (deja de leer `DESCARGA_MAX_FILAS`); nuevos `UMBRAL_ALMACEN_BYTES`, `TTL_URL_SEGUNDOS`,
  `RETENCION_MINUTOS`, `BUCKET` con `readPositiveInt`/string y sus defaults (design §3.1). Comentario de
  cabecera explicando por qué el tope ya no es configurable.
  - Hecho: `tests/unit/config/descarga-config.test.ts` reescrito: `MAX_FILAS === 1048575` con y sin
    `DESCARGA_MAX_FILAS="2000"` (**R3**); defaults y env válidas/inválidas de las 4 nuevas.
- [ ] **T1.2** Confirmar que ningún servicio necesita cambio: con el tope en 1.048.575, cada `limite_excedido`
  significa «supera Excel». Test nuevo `tests/unit/services/wallet-caja-kardex-470.test.ts` (o ampliar el de
  la 468): `kardexConDetalle` con 14.153 filas de detalle (doble de repo) devuelve `ok` con las dos hojas,
  no `limite_excedido` (**R4**, **R1**).
  - Hecho: test verde; con un tope mockeado a 10, el mismo test devuelve `limite_excedido` (la mutación
    lo mata).
- [ ] **T1.3** Adaptar los tests que dependían del 5.000 (riesgo K6): `dinero-productos-sql.test.ts:215`
  (afirma 5000) al nuevo contrato; los que crean `MAX_FILAS + 1` objetos o un xlsx de `MAX_FILAS` filas
  (`tests/integration/descarga-170-volumen.test.ts`, `tests/unit/services/*-completo.test.ts`,
  `export-financiero-vacio`, `historial-accion/lectura-borde-y-servicio`, componentes de `tests/components/descarga/`)
  fijan un tope pequeño con `vi.mock("@/lib/config/descarga")` (patrón de
  `tests/integration/db/estado-cuenta-servidor-458d.test.ts:44-52`) o un volumen literal razonado.
  - Hecho: `pnpm exec vitest run descarga completo historial export-financiero dinero-productos` verde y
    ningún archivo de test tarda > 10 s más que en `dev` (anotar los tiempos antes/después en
    `progress/impl_470.md`).

## Bloque 2 — Almacén y purga (backend)

- [ ] **T2.1** [P] `lib/utils/codec-descarga.ts` (design §3.2) + `tests/unit/descarga/codec-descarga.test.ts`:
  ida y vuelta de `Date`, `bigint`, anidados, arrays (orden), `null`, strings con comillas/saltos/emoji;
  `Map`/`Set`/función ⇒ lanza nombrando el tipo.
  - Hecho: test verde. Cubre **R8** (parte de transporte).
- [ ] **T2.2** [P] `lib/interfaces/external/IAlmacenDescargas.ts` + `lib/storage/SupabaseAlmacenDescargas.ts`
  (design §3.3) + entrada `DESCARGAS` en `lib/storage/buckets.ts`. Tests con doble de `StorageClientLike`
  (`tests/unit/storage/almacen-descargas.test.ts`):
  - ruta = `tmp/<uuid v4>.json.gz`, regex estricta, dos llamadas ⇒ dos rutas distintas (**R9**);
  - `upload` con `upsert: false` y `contentType: "application/gzip"`;
  - «bucket not found» ⇒ `createBucket("descargas", { public: false })` y UN reintento; «already exists»
    en el create se tolera; segundo fallo ⇒ lanza (**R14**);
  - `firmar` llama `createSignedUrl(ruta, ttl)` con el TTL recibido; el doble no expone ningún método de
    URL pública y el código no lo llama (**R10**);
  - `purgarAnterioresA`: borra solo los `created_at < corte`, pagina, respeta `maximo`, bucket inexistente
    ⇒ 0, error del SDK en `remove` ⇒ lanza (**R17**).
  - Hecho: tests verdes; construir la clase sin cliente inyectado NO llama a `createServerClient` (perezoso).
- [ ] **T2.3** `lib/services/PurgaDescargasService.ts` (+ interfaz) y `app/api/cron/purga-descargas/route.ts`
  (clon de `purga-pdf-cargas`, design §3.6) + entrada en `vercel.json` `*/15 * * * *`.
  Tests `tests/unit/api/cron-purga-descargas.test.ts`:
  - sin header / secreto incorrecto / secreto no configurado ⇒ 401 y el servicio NO se construye (**R19**);
  - 200 con `{ objetosBorrados, quedaPendiente }` y nada más en el cuerpo (**R20**);
  - el corte es `now − RETENCION_MINUTOS` exacto (**R17**);
  - `vercel.json` contiene la ruta con una cadencia ≤ 15 min (**R18**).
  - Hecho: tests verdes; las guardias de crons/rutas del repo siguen verdes.

## Bloque 3 — Entrega y registro (backend)

- [ ] **T3.1** Re-censo del inventario (design §2.1): `grep` de `filasDesdeResultado|obtenerFilas|Completo\(|Kardex`
  en `app/` y `components/`. Toda descarga de Familia A que falte en la tabla se añade al registro y a
  `progress/impl_470.md` con archivo:línea.
  - Hecho: lista final en `progress/impl_470.md` (33 o más entradas) con las exclusiones razonadas.
- [ ] **T3.2** `lib/types/descarga-preparada.ts` + `lib/services/EntregaDescargaService.ts` (+ interfaz)
  (design §3.4). Tests `tests/unit/services/entrega-descarga.test.ts` (umbral inyectado):
  - resultado ≤ umbral ⇒ `{ modo: "directo", resultado }` con el MISMO objeto y CERO llamadas al almacén
    (**R6**);
  - resultado > umbral ⇒ guarda gzip, firma con `TTL_URL_SEGUNDOS` y devuelve `{ modo: "almacen", url }`
    (**R5**, **R10**);
  - resultados `unauthenticated`, `forbidden`, `validation_error`, `limite_excedido` ⇒ directo, almacén
    intacto (**R11**);
  - fallo de `guardar` o de `firmar` ⇒ lanza con contexto (**R15**, lado servidor).
  - Hecho: tests verdes; mutar `<=` por `<` o quitar la rama del umbral pone rojo algún test.
- [ ] **T3.3** `lib/actions/_shared/registro-descargas.ts` (imports estáticos, design §3.5) y
  `lib/actions/descargas.ts` con `prepararDescargaAction(nombre, input, deps)`. Tests
  `tests/unit/actions/preparar-descarga.test.ts` (registro y entrega inyectados):
  - nombre fuera del registro (`"borrarTodo"`, `""`, `123`) ⇒ `validation_error`, ninguna acción del
    registro llamada, entrega no llamada (**R12**);
  - la acción registrada recibe EXACTAMENTE `input` y un solo argumento (`mock.calls[0].length === 1`)
    (**R13**);
  - lo que devuelve la acción va a `entregar` tal cual y su salida es la respuesta (**R5/R6**);
  - `entregar` lanza ⇒ `ActionError` (no excepción) (**R15**).
  - Hecho: tests verdes; `superficie-de-uso.guardia` verde (las acciones registradas siguen alcanzables
    y no aparece ninguna anotación caducada).
- [ ] **T3.4** Archivo idéntico, extremo a extremo sin red: `tests/unit/descarga/archivo-identico-470.test.ts`.
  Con fixtures realistas de (a) el resultado de `libroCajaKardexConDetalleAction` (kardex + `porGuia`, con
  fechas) y (b) `listarOrdenesCompleto`: pasar cada uno por `EntregaDescargaService` con umbral 1 byte y un
  almacén en memoria, recuperar los bytes guardados, gunzip + `deserializarDescarga`, y comparar con el
  original: `toEqual` del resultado y, sobre todo, mismas filas/hojas/negritas al armarlas con el código
  de proyección real de la pantalla (`colocarLibroCaja` / `filaDescargaOrden`) y `construirDescarga` (leer
  el xlsx con exceljs y comparar celda a celda).
  - Hecho: test verde (**R8**). Mutación: quitar la etiqueta de `Date` del códec ⇒ rojo.

## Bloque 4 — Frontend (`frontend_dev`, tras Bloque 3 en la misma rama)

- [ ] **T4.1** `components/shared/descarga-datos.ts` con `descargarDatos` y `leerDesdeAlmacen` (design §4.1).
  Tests `tests/unit/components/descarga-datos.test.ts` (`prepararDescargaAction` y `fetch` mockeados):
  - `directo` ⇒ devuelve `resultado` sin llamar a `fetch` (**R6**);
  - `almacen` ⇒ `fetch(url)` una vez, descomprime y deserializa al objeto original (gz real producido con
    `node:zlib` en el test) (**R7**);
  - `fetch` con 403/404/red caída o gzip corrupto ⇒ lanza (**R16**);
  - sobre con `ActionError` ⇒ lanza (**R15**).
  - Hecho: tests verdes.
- [ ] **T4.2** Cablear las 33 descargas del inventario (design §2.1, §4.2) a `descargarDatos`, incluidos los
  casos con inyección (`DescargarGestionesDialog`, `HistorialAccionesModule`, `NovedadesModule`,
  `EstadoCuenta`, `MiEstadoCuenta`). Nada aguas abajo cambia.
  - Hecho: `pnpm typecheck` verde; diff limitado a las llamadas (revisable a ojo).
- [ ] **T4.3** `DescargarDatasetButton`: «Preparando el archivo…» mientras `generando` (`TEXTO_PREPARANDO`
  exportada), `aria-busy`, `aria-label` intacto; `catch` de `LimiteExcelExcedidoError` con
  `mensajeLimiteExcel`. `lib/utils/descarga-dataset.ts`: `LimiteExcelExcedidoError` + comprobación por hoja
  antes de exceljs (design §4.4). Tests:
  - `tests/components/DescargarDataset.test.tsx`: con `obtenerFilas` pendiente, el botón muestra
    «Preparando el archivo…», está deshabilitado, un segundo click no llama otra vez a `obtenerFilas`
    (**R21**); al resolver, `descargarBlob` recibe el nombre `<slug>-AAAA-MM-DD.xlsx` (**R22**);
  - `tests/unit/utils/descarga-dataset-excel.test.ts`: hoja principal o adicional con 1.048.576 filas ⇒
    `LimiteExcelExcedidoError` con hoja y filas, exceljs no se invoca; 1.048.575 no lanza por la guardia
    (probarlo con el contador de la guardia, sin armar el libro) (**R2**);
  - el control muestra `mensajeLimiteExcel` y no produce archivo (**R2**).
  - Hecho: tests verdes.
- [ ] **T4.4** Arreglar los tests de componentes que se rompan por el cableado (K8): si un test mockeaba el
  módulo de la acción, el mock sigue interceptando a través del registro (vitest mockea por módulo);
  si alguno falla por un import nuevo, mockear el módulo afectado. Nada de borrar aserciones.
  - Hecho: `pnpm exec vitest run tests/components` verde, mismo número de tests que en `dev` o más.
- [ ] **T4.5** Errores por pantalla tipo (**R15**, **R16**): tres tests de componente —Órdenes
  (`filasDesdeResultado`), libro de la caja con detalle (`WalletModule`), estado de cuenta con detalle
  (`EstadoCuenta`)— con `descargarDatos` rechazando: aviso en toast y `descargarBlob` NO llamado.
  - Hecho: tests verdes.
- [ ] **T4.6** Guardia `tests/unit/guards/descargas-por-registro.guardia.test.ts` (**R24**): para cada clave
  del registro, ningún archivo de `app/` o `components/` usa el símbolo de la acción (llamada o referencia,
  sin contar líneas de `import` ni comentarios), salvo la lista de excepciones con motivo
  (`useNovedadesFiltro.ts`, `cargar-kpis.ts`); y cada clave aparece en algún `descargarDatos("<clave>"`.
  Auto-prueba del detector en las dos direcciones (un fuente sintético con llamada directa ⇒ la detecta;
  uno limpio ⇒ no) y tamaño mínimo del árbol leído (lección de `superficie-de-uso.guardia`).
  - Hecho: guardia verde; volver a poner `listarOrdenesCompleto(` en `OrdenesModule` la pone roja.
- [ ] **T4.7** [P] Familia B (**R23**): `tests/unit/components/descarga-resultado.test.ts` — `filasLocales`
  con 5.001 y con 20.000 filas devuelve `ok` con todas, en orden, sin llamadas de red; con más de
  `MAX_FILAS` (tope mockeado pequeño) devuelve el aviso.
  - Hecho: test verde.

## Bloque 5 — Medición (backend_dev o frontend_dev, tras T4.3)

- [ ] **T5** Script de un solo uso (scratchpad, NO en el repo) que mida con el código real: `construirDescarga`
  con 50.000 y 200.000 filas × 15 columnas (xlsx y csv) y `serializarDescarga` + gzip de 50.000 filas:
  tiempo, pico de `heapUsed`/`rss` y tamaño del gz. Anotar en `progress/impl_470.md`.
  - Hecho: números escritos. Criterio informativo, no bloqueante: si 50.000 filas tardan > 60 s o pasan
    de 1,5 GB, avisar al leader en el informe (Q1). Cubre los riesgos K2/K3.

## Bloque 6 — Recorrido en la app (frontend_dev o leader, tras el gate verde)

- [ ] **T6.1** Dev server local con `DESCARGA_UMBRAL_ALMACEN_BYTES=1` en la línea de arranque (no en `.env`),
  para forzar la vía de almacén con los datos locales. **Riesgo K1, anotar en el informe:** esto escribe
  objetos temporales en el bucket `descargas` del Storage de PRODUCCIÓN (y lo crea si no existe); son
  privados, ilegibles a los 5 min y los borra el cron de prod.
  1. `/wallet` → libro de la caja → Descargar «Movimientos y detalle por guía» del periodo más amplio con
     datos: aparece «Preparando el archivo…», el archivo se baja solo; abrirlo: dos hojas, kardex y
     «Detalle por guía», total del detalle = total del periodo.
  2. `/ordenes` sin filtros → Descargar Excel y CSV: el número de filas coincide con el total de la tabla.
  3. Repetir 1 y 2 SIN la variable (vía directa) y comparar los dos archivos de cada caso (mismas hojas,
     columnas, filas): deben ser iguales.
  4. Capturar en la pestaña de red que la respuesta de la acción con la variable trae `modo: "almacen"`
     y una URL de `…/storage/v1/object/sign/descargas/tmp/<uuid>.json.gz?token=…`, y que la misma URL
     pedida a los 6 minutos responde error (TTL).
  - Hecho: informe en `progress/recorrido_470.md` con capturas o conteos; cualquier diferencia entre
    archivos es un rojo.

## Bloque 7 — Producción (LEADER, tras desplegar)

- [ ] **T7.1** Antes de la release: `vercel env ls` del proyecto **ordenex** — si existe `DESCARGA_MAX_FILAS`,
  anotarlo (ya no tiene efecto, R3) y borrarlo cuando convenga; no hace falta ninguna variable nueva.
- [ ] **T7.2** En producción, repetir la descarga que fallaba: `/wallet` → caja → «Movimientos y detalle
  por guía» del periodo completo (el que daba «tendría 14153 filas y la descarga admite hasta 5000»).
  Hecho: el archivo se baja; la hoja «Detalle por guía» tiene ≥ 14.153 filas; logs de Vercel
  (`get_runtime_errors`, `since` del despliegue) sin errores de `prepararDescargaAction`.
- [ ] **T7.3** Por MCP de Supabase (producción): `SELECT id, public FROM storage.buckets WHERE id = 'descargas'`
  ⇒ existe y `public = false`. A los ~75-90 min:
  `SELECT count(*) FROM storage.objects WHERE bucket_id = 'descargas' AND created_at < now() - interval '75 minutes'`
  ⇒ 0 (la purga funciona). Revisar también que el cron `/api/cron/purga-descargas` aparece y responde 200
  en los logs.
- [ ] **T7.4** Una descarga grande de Órdenes en producción (sin filtros) baja con todas las filas.

## Dependencias

```
T1.1 ─┬─ T1.2
      └─ T1.3
T2.1 [P] , T2.2 [P] ─ T2.3
T1.1 + T2.1 + T2.2 ─ T3.1 ─ T3.2 ─ T3.3 ─ T3.4
T3.3 ─ T4.1 ─ T4.2 ─ T4.3 ─ T4.4 ─ T4.5 ─ T4.6     (T4.7 [P] tras T1.1)
T4.3 ─ T5
todo ─ ./init.sh completo ─ reviewer ─ T6.1 ─ merge a dev ─ release a prod ─ T7.1…T7.4
```

## Cobertura R → task

| R | Task(s) | R | Task(s) |
|---|---|---|---|
| R1 | T1.2 | R13 | T3.3 |
| R2 | T4.3 | R14 | T2.2 |
| R3 | T1.1 | R15 | T3.2, T3.3, T4.1, T4.5 |
| R4 | T1.2, T7.2 | R16 | T4.1, T4.5 |
| R5 | T3.2, T3.3 | R17 | T2.2, T2.3, T7.3 |
| R6 | T3.2, T4.1 | R18 | T2.3 |
| R7 | T4.1, T6.1 | R19 | T2.3 |
| R8 | T2.1, T3.4, T6.1 | R20 | T2.3 |
| R9 | T2.2 | R21 | T4.3 |
| R10 | T2.2, T3.2, T6.1 | R22 | T4.3 |
| R11 | T3.2 | R23 | T4.7 |
| R12 | T3.3 | R24 | T4.6 |
