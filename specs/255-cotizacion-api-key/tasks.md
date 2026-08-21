# Feature 255 — tasks

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas de su mismo
bloque. Cada task lleva su criterio de **hecho**. El mapa `R<n> → test` cierra el documento; el
reviewer rechaza si falta algún requisito.

**Precondición del bloque entero: CUMPLIDA.** La puerta humana se resolvió el **2026-08-21** y las
seis decisiones (D1–D6) están registradas en `requirements.md`. No queda nada bloqueado: se puede
codificar en cuanto la feature pase a `in_progress`. D2 (por fila **y** por lote) añade el bloque
§9 (R51–R56) y con él la tarea **T7B**.

---

## Bloque 0 — Base

- [x] **T0.1** Confirmar el baseline en verde antes de tocar nada: `pnpm run typecheck`,
      `pnpm run lint` y los tres archivos de guardia citados en `design.md` §8 (openapi-177,
      dinero-sin-centimos, tarifa-vigente-por-tienda).
      **Hecho:** salida pegada en `progress/impl_255_backend.md` con el conteo de rojos previos.
      Sin baseline medido no se puede atribuir ningún rojo posterior.

## Bloque 1 — Piezas puras (sin DB, sin HTTP)

- [x] **T1 [P]** `lib/utils/monto-cotizacion.ts`: `formatMontoCotizacion(valor: Prisma.Decimal):
      string`. Símbolo y ambos separadores desde `monedaConfig`; agrupación desde la derecha;
      exactamente 2 decimales; signo delante del símbolo; cero sin signo. No redondea.
      **Hecho:** las 14 filas de la tabla de contrato (`design.md` §6.1) pasan como test
      parametrizado, y el fuente no contiene los literales `₡`, `.` ni `,` como separadores.

- [x] **T2 [P]** `lib/services/geo-resolucion.ts`: MUDANZA de `normalize`, `indexBy`, `lookup`,
      `resolveGeo` y `geoInputDesdeColumnasSeparadas` desde `BulkOrdenService.ts`. Sin cambiar ni
      una cadena, ni una rama, ni un orden de comprobación. `BulkOrdenService` las importa.
      **Hecho:** las suites existentes de la carga (unit + integración) pasan **sin editar ni una
      línea de test**, y `git diff` sobre `BulkOrdenService.ts` es solo imports + borrado.

- [x] **T3 [P]** `lib/types/cotizacion.ts`: `filaCotizacionSchema` (terna geográfica +
      `direccion` + `monto_cobrar` como STRING validado + `num_remision` opcional, decisión D5),
      tipos de la respuesta por fila, del bloque `costos` y del bloque `totales` de lote (con sus
      dos contadores). No-strict (claves extra ignoradas).
      **Hecho:** typecheck verde y test de schema.

## Bloque 2 — Datos

- [x] **T4** Extender `ITarifaVigentePorTiendaRepository` con
      `resolveTarifaCotizablePorTienda(tiendaId)` e implementarlo en
      `TarifaVigentePorTiendaRepository` con
      `where: { tiendaId, deletedAt: null, status: "activo" }`, `orderBy createdAt desc`, first.
      Docstring con la salida nombrada hacia la feature 70 (decisión D6).
      **Hecho:** el método nuevo tiene test propio Y las dos
      afirmaciones de ausencia de `status` de la feature 69 siguen verdes **sin editarlas**, igual
      que el test que exige el `TODO:` por grep.

## Bloque 3 — Service

- [x] **T5** `lib/interfaces/services/ICotizacionOrdenService.ts` +
      `lib/services/CotizacionOrdenService.ts`. Orden normativo: rol `apiKey` → tarifa cotizable
      (una sola vez) → precarga geográfica → por fila: validación, `resolveGeo`, dos llamadas a
      `derivarIngresoOrden`, totales, formateo. Resultado discriminado, sin HTTP.
      **Depende de:** T1, T2, T3, T4. **Hecho:** el service no importa nada de `next/*` ni recibe
      `Request`; typecheck verde.

- [x] **T6** Cobertura por fila: los tres modos de no-cobertura producen fila `error` con el
      mensaje reusado tal cual, y `esCentral` del distrito alimenta el precio en el mismo paso.
      **Hecho:** tests T6.1–T6.4 del mapa de abajo en verde.

- [x] **T7** Los dos escenarios y los dos `total`, con `Prisma.Decimal` de punta a punta y los
      signos de la decisión D1 (`entregado` = lo que recibe la tienda, `devuelto` = deuda).
      **Hecho:** tests T7.1–T7.6 en verde y **cero ocurrencias**
      de `Number(`, `parseFloat(` o `parseInt(` sobre importes en el service (test estructural).

- [x] **T7B** Bloque `totales` del LOTE (decisión D2, R51–R56): acumuladores `Prisma.Decimal` por
      escenario y concepto, alimentados con los valores de fila ANTES de formatear; formateo único
      al final; solo aportan las filas `cotizada`; contadores `filasSumadas` / `filasExcluidas`
      siempre presentes y con `filasSumadas + filasExcluidas === total`; bloque emitido también
      cuando no cotiza ninguna fila.
      **Depende de:** T7. **Hecho:** tests T7B.1–T7B.5 del mapa en verde, incluido el estructural
      que prohíbe sumar strings formateados o re-parsear un importe ya formateado.

## Bloque 4 — Borde HTTP

- [x] **T8** `app/api/ordenes/api-key/cotizacion/route.ts`: `extraerBearer` +
      `ApiKeyAuthService`, zod del cuerpo, traducción de errores, `runtime = "nodejs"`,
      `maxDuration = 60`, deps inyectables (`autenticar`, `cotizacionService`) como en
      `handleCargaApi`.
      **Depende de:** T5. **Hecho:** la ruta no contiene queries Prisma, ni `.toFixed(`, ni
      ningún `if` sobre "tiene API key".

- [x] **T9** Verificar que el middleware NO se toca: `PUBLIC_ROUTES` intacto y la guardia 229
      verde sin editarla.
      **Hecho:** `git diff middleware.ts` vacío y la guardia 229 en verde.

## Bloque 5 — Guardias y contrato publicado

- [x] **T10** Diente 6 de `tests/unit/guards/dinero-sin-centimos.guardia.test.ts`: censo de
      "salidas de máquina" con `lib/utils/monto-cotizacion.ts`, afirmación POSITIVA de que emite
      dos decimales, comprobación de que ninguna pantalla lo importa, y actualización de la prosa
      del diente 3 y de la cabecera del archivo.
      **Depende de:** T1. **Hecho:** los seis dientes verdes y la contraprueba del diente 6
      (un módulo que dejara de emitir decimales sería cazado) incluida en el propio archivo.

- [x] **T11** Publicar el endpoint en `lib/api/openapi-spec.ts` y en su espejo
      `docs/api/api-key-openapi.yaml`: request, response 200 (filas **y** bloque `totales` con sus
      dos contadores), 401/403/409/422, ejemplo con los dos escenarios, y la declaración explícita
      del supuesto `cobra_comision = true`, de que los importes van **solo formateados** y de que
      `totales` es una SUMA de las filas cotizadas, no el precio del lote.
      **Hecho:** ambos artefactos declaran el mismo path.

- [x] **T12** Actualizar `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` de SIETE a OCHO
      paths (objeto TS y `.yaml`, mismo orden), con un comentario que diga que el alta es de la
      255 y por qué.
      **Depende de:** T11. **Hecho:** el test vuelve a verde nombrando el path nuevo; no se
      relaja ninguna otra afirmación del archivo.

## Bloque 6 — Cierre

- [x] **T13** Test estructural de lectura pura: ningún método de escritura del repositorio se
      invoca durante una cotización.
      **Hecho:** T13.1–T13.3 del mapa en verde.

- [x] **T14** Comprobar que la feature no toca el esquema: sin cambios en `db/schema.prisma` y sin
      carpeta nueva en `db/migrations/`.
      **Hecho:** `git diff --stat` sobre `db/` vacío, y anotado en
      `progress/impl_255_backend.md` que los ítems de migración/RLS de `CHECKPOINTS.md` no aplican.

- [x] **T15** `progress/impl_255_backend.md` con el mapa `R<n> → test` completo (los 56), la deuda
      declarada de §4 (ventana 255↔70) y la decisión de no-E2E de §8.
      **Hecho:** los 56 requisitos aparecen con al menos un test nombrado.

- [x] **T16** `./init.sh --rapido` para cerrar la tanda y `./init.sh` completo antes del PR.
      **Hecho:** ambas salidas pegadas en la bitácora, en verde.

---

## Mapa `R<n> → test`

Ruta base de los archivos nuevos:
`tests/unit/services/cotizacion-orden-service.test.ts` (**COT**),
`tests/integration/cotizacion-api-key.test.ts` (**INT**),
`tests/unit/utils/monto-cotizacion.test.ts` (**FMT**),
`tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` (**REPO**, se amplía),
`tests/unit/guards/dinero-sin-centimos.guardia.test.ts` (**G230**, se amplía),
`tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` (**GAPI**, se amplía).

| R | Test |
| --- | --- |
| R1 | INT · `devuelve 401 sin header Authorization, y no consulta tarifa ni geografia` |
| R2 | INT · `una key inexistente devuelve el MISMO 401 que la ausencia de key` |
| R3 | INT · `devuelve 403 cuando el usuario dedicado de la key no esta activo` |
| R4 | INT · `ignora un tiendaId del cuerpo y cotiza siempre contra el dueño de la key` |
| R5 | COT · `no existe ninguna comprobacion de "tiene api key" tras autenticar` (estructural sobre el fuente del service y la ruta) |
| R6 | INT · `devuelve 422 con fieldErrors ante un cuerpo no-JSON y ante un schema invalido` |
| R7 | INT · `acepta el MISMO cuerpo que POST /carga sin recortarlo` |
| R8 | INT · `422 con lote vacio y con lote por encima de MAX_CHUNK_ROWS` |
| R9 | COT · `devuelve numRemision tal cual si viene y null si no viene` |
| R10 | COT · `dos filas con el mismo num_remision se cotizan las dos y ninguna es duplicada` |
| R11 | COT · `resuelve la tarifa UNA sola vez por peticion, no una por fila` |
| R12 | REPO · `resolveTarifaCotizablePorTienda filtra deletedAt null Y status activo, la mas reciente` |
| R13 | INT · `409 con mensaje explicito cuando la tienda no tiene tarifa cotizable, sin filas` |
| R14 | COT · `con tarifa ausente no llega a resolver la geografia de ninguna fila` |
| R15 | COT · `nunca emite un importe cero por ausencia de tarifa` + COT · `la rama tarifa===null de derivarIngresoOrden es inalcanzable desde la cotizacion` |
| R16 | INT · `el mensaje del 409 no contiene key, hash ni datos de la fila` |
| R17 | COT (T6.1) · `resuelve provincia -> canton -> distrito y toma la zona del distrito` |
| R18 | COT (T6.2) · `distrito no encontrado en el canton` |
| R19 | COT (T6.3) · `distrito ambiguo en el canton` |
| R20 | COT (T6.4) · `el distrito X no tiene zona asignada` |
| R18–R20 | COT (T6.4b) · `los tres mensajes son byte-identicos a los que emite cargarViaApi` |
| R21 | INT · `200 con la fila sin cobertura marcada y el resto cotizado` |
| R22 | COT · `una fila en error no trae bloque costos` |
| R23 | COT (T7.1) · `cada fila cubierta emite los escenarios entregado y devuelto` |
| R24 | COT (T7.2) · `delega en derivarIngresoOrden dos veces` (espía) + estructural: el service no multiplica ni divide importes |
| R25 | COT (T7.3) · `elige la columna GAM segun el esCentral de la zona del distrito de ESA fila` (lote mixto GAM/estandar) |
| R26 | COT · `el escenario entregado emite exactamente flete, iva, comision, ivaComision y total` |
| R27 | COT · `el escenario devuelto emite exactamente flete, iva, comision y total, sin ivaComision` |
| R28 | COT (T7.4) · `devuelto.comision es el cero explicito ₡0,00 y nunca falta ni es null` |
| R29 | COT · `asume cobraComision true` + GAPI · `la descripcion del endpoint declara el supuesto` |
| R30 | COT (T7.5) · `entregado.total = monto_cobrar menos los cuatro conceptos` |
| R31 | COT (T7.6) · `devuelto.total es negativo e igual a -(flete + iva)` (caso -1578 del humano) |
| R32 | COT · `sin monto_cobrar la comision es cero y entregado.total sale negativo` |
| R33 | COT · estructural: `cero Number(/parseFloat(/parseInt( sobre importes en el service` |
| R34 | INT · `cada importe aparece una sola vez y solo formateado (ningun campo crudo escala 2)` |
| R35 | FMT · tabla de contrato, filas 1–14 |
| R36 | FMT · `usa monedaConfig` (con `monedaConfig` sobreescrito el formato cambia) + estructural: el fuente no escribe los separadores a mano |
| R37 | FMT · fila 8 `-₡1.578,00` y fila 14 `-₡0,50` |
| R38 | FMT · filas 1, 2 y 13 (`menos cero` no se emite) |
| R39 | FMT · fila 10 (acarreo que cambia el nº de dígitos) + COT · `el service no redondea: el redondeo lo hace derivarIngresoOrden` |
| R40 | G230 · diente 2 verde con la ruta nueva incluida en el barrido (`app/**` sin `.toFixed(`) |
| R41 | G230 · diente 6 `salidas de maquina` (censo + contraprueba) |
| R42 | G230 · dientes 1 y 5, verdes sin excepciones nuevas |
| R43 | INT (T13.1) · `una cotizacion no invoca ningun metodo de escritura del repositorio` |
| R44 | INT (T13.2) · `no consume ningun num_guia` |
| R45 | INT (T13.3) · `no escribe ninguna fila de auditoria` |
| R46 | INT · `la respuesta trae total, cotizadas, conError y el indice 1-based por fila` |
| R47 | GAPI · `el canal por API key publica OCHO endpoints, en el objeto TS y en el .yaml` |
| R48 | Guardia 229 verde **sin editar** + `git diff middleware.ts` vacío (T9) |
| R49 | INT · `ni la key ni su hash aparecen en la respuesta` + estructural: la ruta no loguea el header |
| R50 | Suites existentes de `cargarViaApi` y del route de carga, verdes **sin editarlas** (T2) |
| R51 | INT · `la respuesta trae el bloque totales del lote con los escenarios entregado y devuelto` |
| R52 | COT (T7B.1) · `el bloque de lote espeja la forma de una fila: entregado con cinco conceptos, devuelto con cuatro y sin ivaComision` |
| R53 | COT (T7B.2) · `un lote mixto suma SOLO las filas cotizadas: la fila sin cobertura no aporta ni un cero` (lote con 2 cotizadas + 1 sin zona, importes esperados calculados a mano) |
| R54 | COT (T7B.3) · `emite filasSumadas y filasExcluidas, y su suma es el total de filas recibidas` (incluye el caso mixto y el caso sin exclusiones) + COT · `los contadores del bloque coinciden con cotizadas/conError de la raiz` |
| R55 | COT (T7B.4) · `el total del lote se acumula en Prisma.Decimal antes de formatear` (un lote de 3 filas cuyos céntimos solo cuadran si la suma es exacta) + estructural: `el service no suma strings formateados ni re-parsea un importe con simbolo` (cero ocurrencias de `replace(` sobre el símbolo o los separadores y cero `Number(` en el acumulador) |
| R56 | COT (T7B.5) · `un lote donde NINGUNA fila cotiza emite totales en cero con filasExcluidas igual al total, y nunca omite el bloque` + INT · `ese caso responde 200, no 409` |
