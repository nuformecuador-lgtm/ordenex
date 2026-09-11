# Feature 415 — bitácora de implementación

**Rama:** `feat/415-zona-y-costo-por-orden-api`
**SHA base:** `4a2f609499f9033776fbbf4ac156865ebc7362e7` (`docs(415): spec de la zona y el costo, y la ficha arranca`)
**Fecha:** 2026-09-10 · **Agente:** backend_dev · **Worktree:** aislado (con `.env` copiado, ver T13)
**Sincronizada con `dev`** (F2.3) a mitad de la ficha: `git merge origin/dev` (`dcec442b`, 14 commits por delante del SHA base), **sin un solo conflicto**. El porqué está en la sección del gate: la primera corrida salió ROJA por cinco tests de enum que `dev` ya había enmendado.

Qué se implementó: **tres campos ADITIVOS** sobre el MISMO ítem del listado —que el detalle hereda
por su `...toListItemDTO(row)`— en el canal integrador:

- **`zona: { id, nombre }`** — la zona DE LA ORDEN (el destino del paquete). Misma forma que
  `mensajero` y misma regla publicada («agrupá por `id`»). **Nunca es `null`**, y ésa es la única
  diferencia con `mensajero`: se declara en el tipo y en el contrato.
- **`costoEstimado` y `costoReal`** — el mismo objeto de cinco cadenas money-safe
  (`flete`, `iva`, `comision`, `ivaComision`, `fulfillment`), escenario **ENTREGADA**, **sin ningún
  campo sumado** ni con el nombre `total` ni con otro.

**Sin migración, sin endpoint nuevo, sin parámetro de query nuevo y sin una sola escritura.**
Ninguna task pidió salirse de ahí.

---

## T0 — base MEDIDA antes de escribir código (BLOQUEA TODO)

### T0.1 — los 22 símbolos, confirmados EN EL ARCHIVO REAL (no en el grafo)

> El MCP `codebase-memory` **no estaba en mi conjunto de herramientas** en esta sesión, así que la
> búsqueda se hizo con `grep` sobre los archivos reales. Lo digo explícitamente porque la regla 7
> de `CLAUDE.md` manda empezar por el grafo: no pude. Para lo que esta task pide da igual —la task
> exige precisamente **abrir el archivo**, porque el grafo devuelve de más—, pero conviene que
> conste.

Las líneas son las del árbol **ANTES** de esta ficha; después del cambio se corren unas cuantas.

| Símbolo | Existe | Archivo real : línea |
|---|---|---|
| `API_ORDEN_SELECT` | sí | `lib/repositories/OrdenRepository.ts:221` |
| `API_ORDEN_DETALLE_SELECT` | sí | `lib/repositories/OrdenRepository.ts:310` |
| `ApiOrdenSelectRow` | sí | `lib/repositories/OrdenRepository.ts:382` |
| `toApiOrdenRow` | sí | `lib/repositories/OrdenRepository.ts:435` |
| `listByOwner` | sí | `lib/repositories/OrdenRepository.ts:3048` |
| `findDetalleByOrdenIdForOwner` | sí | `lib/repositories/OrdenRepository.ts:3132` |
| `ApiOrdenRow` | sí | `lib/interfaces/repositories/IOrdenRepository.ts:1046` ⭑ |
| `ApiOrdenDetalleRow` | sí | `lib/interfaces/repositories/IOrdenRepository.ts:1131` |
| `toListItemDTO` | sí | `lib/services/ApiOrdenLecturaService.ts:30` — ⚠️ hay un **homónimo** en `lib/repositories/OrdenRepository.ts:774` que NO es éste y no se toca |
| `toDetalleDTO` | sí | `lib/services/ApiOrdenLecturaService.ts:119` |
| `ApiMensajeroDTO` | sí | `lib/types/api-orden.ts:53` |
| `derivarIngresoOrden` | sí | `lib/utils/ingreso-ordenex.ts:150` |
| `resolverFlete` | sí | `lib/utils/ingreso-ordenex.ts:126` |
| `montoFulfillmentDeTarifa` | sí | `lib/utils/ingreso-ordenex.ts:792` |
| `tarifaDe` | sí | `lib/utils/cierre-detalle.ts:93` — ⚠️ **hay otro homónimo** en `OrdenRepository.ts:1121` (el del listado interno), por eso el import se aliasea a `tarifaCongeladaDe` |
| `DETALLE_SELECT` | sí | `lib/utils/cierre-detalle.ts:22` |
| `serializarMontoCotizacion` | sí | `lib/utils/monto-cotizacion.ts:89` |
| `resolveTarifas` | sí | `lib/interfaces/repositories/ITarifaVigenteRepository.ts:106` |
| `TarifaVigente` | sí | `lib/interfaces/repositories/ITarifaVigenteRepository.ts:56` |
| `TarifaVigenteResuelta` | sí | `lib/interfaces/repositories/ITarifaVigenteRepository.ts:71` |
| `clavePar` | sí | `lib/utils/cascada-tarifa.ts:30` |
| `ParTarifa` | sí | `lib/utils/cascada-tarifa.ts:24` |

⭑ `ApiOrdenRow` está en la **1046**, exactamente donde el spec avisó que estaría (el grafo lo dio
en la 841 al escribirlo). Confirmado abriendo el archivo.

### T0.2 — la cobertura, reproducida en local, y EL MECANISMO CONFIRMADO

**Los conteos**, contra la base local (`localhost:5432/ordenex`), con las consultas al lado
(`scratchpad/t02-medicion.mjs`):

| Qué | Consulta | Local | Producción (medido por el humano) |
|---|---|---|---|
| Órdenes vivas | `SELECT count(*) FROM orden WHERE deleted_at IS NULL` | **69** | 1.652 |
| …con fila en `cierre_detail` | `JOIN cierre_detail cd ON cd.orden_id = o.id` | **15** (22 %) | 1.182 (72 %) |
| …ELEGIBLES (`cd.tienda_id = o.tienda_id` **y** `cierre.estado = 'aprobado'`) | ver script | **15** (100 % de las que tienen fila) | 1.182 (100 %) |
| Filas congeladas por estado del cierre | `GROUP BY cierre_dia.estado` | **`aprobado`: 21**, y ningún otro estado | idem: cero en `solicitado`/`rechazado`/`vencido` |
| Órdenes con **≥2** filas elegibles (D6) | `GROUP BY orden_id HAVING count(*) >= 2` | **5** | — |
| Órdenes con `zona_id IS NULL` | `SELECT count(*) FROM orden WHERE zona_id IS NULL` | **0** (confirma el NOT NULL) | — |

La base local **reproduce el patrón cualitativo** de producción: el 100 % de las filas congeladas
son de cierres `aprobado`, así que el filtro hoy tampoco recorta nada aquí. Y **5 órdenes con dos o
más filas elegibles**: D6 no es hipotético ni siquiera en local.

#### ⚠️ El punto 3 — CONFIRMADO, citando archivo y línea

> **`tx.cierreDetail.createMany` está en `lib/repositories/CierreDiaRepository.ts:942`**, dentro de
> **`async crearCierre(input: CrearCierreInput)`**, que abre en la **línea 651** y cierra en la
> **984** (`awk` sobre el rango: el siguiente método, `findCierresByMensajero`, empieza en la 994).
> O sea: **la fila se escribe al SOLICITAR el cierre**, no al aprobarlo.
>
> Y es la **ÚNICA escritura** de `cierre_detail` en todo el código: `grep -rn "cierreDetail\."` en
> `lib/`, `app/` y `scripts/` devuelve 9 coincidencias y las otras 8 son `findMany` o `count`
> (`CierreAporteRepository`, `CierresAdminRepository`, `CierresBodegaAdminRepository`,
> `lib/utils/cierre-detalle.ts`).

**El mecanismo sale como lo describe el spec, no al revés.** La afirmación que el leader hizo al
encargar la ficha —«`cierre_detail` sólo se escribe al aprobar»— **es falsa**, y el spec ya la
había corregido. La consecuencia es la que importa: **el filtro por `estado = 'aprobado'` NO es
redundante**. Con la versión equivocada lo habría sido por construcción y el primero que lo leyera
lo habría borrado como ruido; con el mecanismo real es lo único que impide que `costoReal` cambie
**hacia atrás** en cuanto vuelva a haber un cierre solicitado, o después de que uno se rechace (la
fila es INMUTABLE, 69/R10, así que un cierre rechazado **conserva** la suya).

Eso está escrito **junto al `where`**, con el número medido **y** con el mecanismo, y T7 lo mata:
ver las mutaciones M1 y M2 más abajo.

### T0.3 — el coste de consulta ANTES (línea base)

Medido con el espía `$on("query")` de `tests/integration/db/_postgres-real.ts`, **dentro de una
transacción interactiva**: fuera de ella Prisma paraleliza las relaciones y el ORDEN de las
consultas no es estable (medido: la misma lectura dio dos órdenes distintos). El test de la 405 ya
mide así, y por eso su literal ordenado no es flaky.

| Lectura | Consultas ANTES | Tablas |
|---|---|---|
| Detalle | **9** | `orden`, `order_status`, `usuario`, `gestion_orden`, `orden_historial_estado`, `orden_incidente`, `usuario`, `order_status`, `orden_incidente_evidencia` |
| Listado `limit=1` | **4** | `orden`, `order_status`, `usuario`, `orden` (el `count`) |
| Listado `limit=50` | **4** | idem |
| Listado `limit=100` | **4** | idem |

Cuerpo con `limit=100`: **68 ítems, 23.720 bytes** (~349 B/ítem). El owner medido es el de más
órdenes de la base local (68 vivas).

---

## Archivos creados

| Archivo | Qué es |
|---|---|
| `lib/utils/api-orden-costo.ts` | **Producción.** T2 — el módulo PURO: `costoEstimadoDe` / `costoRealDe`. Cero fórmulas propias |
| `tests/fixtures/api-orden-costeo-415.ts` | El defecto NEUTRO de los dos campos nuevos de la fila, para las ~15 fixtures que la construyen a mano |
| `tests/unit/types/api-orden-415-dto.test.ts` | T1 — la forma de los dos tipos, en ejecución y con `@ts-expect-error` |
| `tests/unit/utils/api-orden-costo.test.ts` | T2 — los cinco conceptos, con TODOS los importes a mano |
| `tests/unit/api/ordenes-api-key-composicion-415.test.ts` | T5 — los DOS composition roots, ejercitados de verdad |
| `tests/unit/api/openapi-415-zona-y-costo.test.ts` | T10 — el contrato publicado (`.ts` y su espejo `.yaml`) |
| `tests/unit/guards/costo-orden-forma-unica.guardia.test.ts` | T9 — forma única + lista blanca + comportamiento + auto-prueba |
| `tests/integration/db/costo-y-zona-api-415.test.ts` | **T7** — contra Postgres real. NO opcional |

## Archivos modificados

**Producción (6):**

| Archivo | Cambio |
|---|---|
| `lib/types/api-orden.ts` | T1: `ApiZonaDTO` y `ApiOrdenCostoDTO` (declarados UNA vez cada uno) · los tres campos de `ApiOrdenListItemDTO` · cabecera ACOTADA con el bloque fechado que distingue las dos «zona» |
| `lib/interfaces/repositories/IOrdenRepository.ts` | T3: `ApiOrdenRow` gana `zona` (**publicable**) y `costeo` (**NO publicable**, con el comentario que lo dice); tipos nuevos `ApiOrdenCosteoRow` y `ApiOrdenCongeladoRow` |
| `lib/repositories/OrdenRepository.ts` | T3: `API_ORDEN_SELECT` → **`apiOrdenSelect(ownerId)`** y `API_ORDEN_DETALLE_SELECT` → `apiOrdenDetalleSelect(ownerId)`; `zonaId`, `cobraComision`, `zona`, `distrito` y `cierreDetalles` acotada; `toApiOrdenRow` mapea `zona` y arma `costeo` money-safe; `congeladoDe` reconstruye con `tarifaDe` |
| `lib/services/ApiOrdenLecturaService.ts` | T4: dependencia nueva por constructor; `paresDistintos` + `tarifasDe`; `toListItemDTO(row, tarifa)` compone los tres campos; `toDetalleDTO` los hereda por el spread de siempre |
| `app/api/ordenes/api-key/route.ts` | T5: `buildLecturaService` construye y **PASA** el `TarifaVigenteRepository` |
| `app/api/ordenes/api-key/orden/[id]/route.ts` | T5: ídem en `buildDetallePorOrdenId` |

**Contrato y documentación (3):**

- `lib/api/openapi-spec.ts` — T10: schemas nuevos `Zona` y `OrdenCosto`; `OrdenListItem` gana las
  tres propiedades **y sus `required`**; la `description` de `mensajero` gana la cláusula que acota
  la palabra «zona» (que **no se retira** de la lista de exclusiones).
- `docs/api/api-key-openapi.yaml` — T10, espejo textual del `.ts`.
- `docs/api/CHANGELOG.md` — T12, **UNA** entrada fechada para las dos partes, arriba del todo.
- `docs/api/manual-metricas-por-mensajero.md` — T11: la «Corrección del 2026-09-10» reescrita **sin
  borrar el rastro**, la tabla de superficies, la regla nº 1 extendida a las dos entidades con
  nombre, el caso «Margen por paquete y por zona» y la aclaración de la zona del mensajero.

**Tests existentes enmendados (18)** — ninguno relajado a `toMatchObject`, a `toContain` ni a un
aserto de longitud:

| Archivo | Qué se enmendó |
|---|---|
| `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` | `SELECT_DETALLE_106` **ENMENDADO** con su bloque fechado 2026-09-10 (415), siguiendo el precedente de la 268, la 404 y la 405 |
| `tests/unit/repositories/orden-repository.api-lectura.test.ts` | el `toEqual` de la fila pública gana `zona` y `costeo` y **sigue siendo igualdad estructural**; fixture + 12 casos nuevos |
| `tests/unit/services/api-orden-lectura-service.test.ts` | fixture + el congelador de claves 10→13 + 10 casos nuevos |
| `tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts` | fixture + el congelador de claves del detalle 12→15 |
| `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` | fixture + el congelador de claves del detalle 12→15 |
| `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | fixture |
| `tests/unit/services/api-pdf-etiqueta-service.test.ts` | fixture |
| `tests/unit/services/api-pdf-etiqueta-columna-intacta.test.ts` | fixture (la misma fila alimenta el `select` de la etiqueta y el del canal) |
| `tests/unit/repositories/orden-repository.api-consulta-pdf.test.ts` | fixture |
| `tests/unit/types/api-mensajero-dto.test.ts` | las tres fixtures ganan los tres campos, para que lo que cada `@ts-expect-error` mide siga siendo lo que decía |
| `tests/unit/guards/mensajero-forma-unica.guardia.test.ts` | fixture + el 3.er argumento del constructor. **Su alcance NO se toca** |
| `tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts` | fixture + el 3.er argumento |
| `tests/unit/api/openapi-404-mensajero.test.ts` | el `required` de `OrdenListItem` **enmendado** 10→13, con su bloque fechado |
| `tests/unit/api/openapi-405-gestiones.test.ts` | las propiedades de `OrdenListItem` **enmendadas** 10→13, con su bloque fechado; sigue afirmando que `gestiones` NO se cuela en el ítem |
| `tests/integration/api/ordenes-api-key-listado.route.test.ts` | fixture + el congelador de claves 10→13 + **8 casos nuevos** con la cadena real |
| `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts` | fixture + el congelador 12→15 + **7 casos nuevos** |
| `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | fixture |
| `tests/integration/api/ordenes-api-key-orden-generate.route.test.ts` | fixture |
| `tests/integration/api/ordenes-api-key-tienda-destino-aislamiento.route.test.ts` | fixture (el doble de `IOrdenRepository` devuelve ahora lo que el repositorio REAL devuelve) |
| `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts` | fixture |
| `tests/integration/purga-pdf-regenera-177.test.ts` | fixture |
| `tests/integration/asimetria-sin-tarifa.test.ts` | **T8**: pasa de CUATRO superficies a CINCO, con la cabecera reescrita y la contraprueba |
| `tests/integration/db/gestiones-detalle-api-405.test.ts` | **`CONSULTAS_DEL_DETALLE` enmendado 9→12**, con el número MEDIDO y las tres consultas nuevas nombradas una a una |

**Ni una migración, ni una tabla, ni una columna, ni un índice, ni un endpoint, ni un parámetro de
query, ni una escritura.** El `where` del listado y el del detalle **no se tocaron**.

---

## El cambio de forma: `API_ORDEN_SELECT` → `apiOrdenSelect(ownerId)`

R33 exige acotar la fila congelada por su `tienda_id` **CONGELADO**, y eso es un valor de la
petición: un `where` con un valor de la petición no cabe en una constante de módulo.

**La propiedad que la constante garantizaba —que listado y detalle no puedan divergir— se
conserva, y se comprueba, no se promete.** `apiOrdenDetalleSelect(ownerId)` sigue haciendo el
spread de `apiOrdenSelect(ownerId)`, y hay un caso que lo afirma **clave a clave** sobre lo que
llega a Prisma en las dos llamadas:

> `orden-repository.api-lectura.test.ts` → «415/design §5.1: el detalle NO puede divergir del
> listado — misma proyección, misma fuente»: para CADA clave del `select` del listado, el `select`
> del detalle tiene la misma y con el mismo valor; y el `ownerId` que llega a los dos `where` del
> congelado es el mismo.

---

## Mapa `R<n> → test`

Los 40 requisitos tienen al menos un aserto que se pone rojo si el código está mal.

| R | Test (archivo → caso) |
|---|---|
| R1 | `api-orden-415-dto.test.ts` → «un valor del tipo tiene EXACTAMENTE las claves ['id','nombre']» · `api-orden-lectura-service.test.ts` → «`zona` viaja con `{id, nombre}`, nunca es null y no lleva `esCentral`» · `costo-y-zona-api-415.test.ts` → «`zona` es el `{id,nombre}` VIVO» |
| R2 | `api-orden-415-dto.test.ts` → «`zona` es REQUERIDO y NO admite `null`» · `ordenes-api-key-listado.route.test.ts` → «CADA ítem trae `zona` con las dos claves, y nunca `null`» · `openapi-415-zona-y-costo.test.ts` → «`zona` es un `$ref` pelado: sin `null` en ninguna forma» |
| R3 | `costo-y-zona-api-415.test.ts` → «`zona` es el `{id, nombre}` VIVO del catálogo aunque el congelado diga otro» · `openapi-415-zona-y-costo.test.ts` → «dice "agrupá por `id`, nunca por `nombre`"» |
| R4 | `orden-repository.api-lectura.test.ts` → «`zona` sale con `id` y `nombre` del catálogo, sin transformar» · `api-orden-415-dto.test.ts` → «`nombre` es el del catálogo tal cual» · `openapi-415-zona-y-costo.test.ts` (description) |
| R5 | `orden-repository.api-lectura.test.ts` → «…y SIN `esCentral`» + «el `select` pide `id`, `nombre` y `esCentral` de la zona, y NADA más» · `api-orden-415-dto.test.ts` → «una TERCERA clave no compila» · los dos asertos de exclusión de los bordes HTTP · la lista blanca de T9 |
| R6 | `api-orden-415-dto.test.ts` (comentario del tipo) · `openapi-415-zona-y-costo.test.ts` → «la de `Zona` dice de QUÉ zona habla» + «la de `mensajero` acota la palabra «zona»…». La reescritura de los cuatro textos es verificación **humana** del reviewer |
| R7 | `ordenes-api-key-listado.route.test.ts` → «`?zona=`, `?zona_id=`, `?costoEstimado=` y `?order_by=costo` se IGNORAN» (misma respuesta byte a byte y mismo `where`) · `api-orden-lectura-service.test.ts` → «ni la zona ni el costo llegan al repo como criterio» |
| R8 | `costo-y-zona-api-415.test.ts` → «el LISTADO emite 8 consultas, y NO cambia entre `limit=1` y `limit=50`» · `orden-repository.api-lectura.test.ts` → «una página de N órdenes con congelado NO añade consultas por ítem» |
| R9 | `api-orden-415-dto.test.ts` → «los tres campos son REQUERIDOS: omitirlos no compila» + «el ítem tiene TRECE claves exactas» · `api-orden-lectura-service.test.ts` → el congelador de 13 claves · `openapi-415-zona-y-costo.test.ts` → «las tres están en `required`» |
| R10 | `api-orden-costo.test.ts` → «una tarifa GAM produce los CINCO conceptos con estos valores exactos» · `api-orden-415-dto.test.ts` → «las claves son EXACTAMENTE las cinco» · `openapi-415-zona-y-costo.test.ts` → «exactamente cinco propiedades, todas requeridas» |
| R11 | `api-orden-415-dto.test.ts` → «una SEXTA clave llamada `total` no compila» **+ «una sexta clave con OTRO nombre tampoco compila»** · `api-orden-costo.test.ts` → «el objeto tiene las CINCO claves y NINGUNA que sume los cinco» (la suma 4545.35, a mano) · `costo-orden-forma-unica.guardia.test.ts` → «ninguna clave publicada suma los cinco» · `openapi-415-zona-y-costo.test.ts` → «NO declara `total` ni ninguna clave que suene a suma» |
| R12 | `api-orden-costo.test.ts` → «todo importe casa el dialecto money-safe, sin símbolo y sin separador de miles» · `openapi-415-zona-y-costo.test.ts` → «la description declara el dialecto crudo de escala 2» |
| R13 | `api-orden-costo.test.ts` → «`cobraComision: false` deja comisión e ivaComision en `"0.00"`, NO ausentes» · `api-orden-415-dto.test.ts` → «un concepto en `null` no compila» |
| R14 | `costo-orden-forma-unica.guardia.test.ts` → «los tres campos serializan IDÉNTICOS en las dos superficies» (objeto a objeto **y** el texto serializado) · `api-orden-415-dto.test.ts` → «los DOS campos de costo son el MISMO tipo» |
| R15 | `api-orden-costo.test.ts` → «el escenario es ENTREGADA — sale el flete de ENTREGA, nunca el de devolución» · `openapi-415-zona-y-costo.test.ts` → «la description lo dice con esas palabras» + «remite al escenario `devuelto` de la cotización» |
| R16 | `api-orden-costo.test.ts` → los cinco conceptos con los valores X, literales a mano (si hubiera una segunda fórmula, no coincidirían) |
| R17 | `api-orden-costo.test.ts` → «money-safe: `657.25` y no `657.26`, el céntimo que la 204 midió» · `orden-repository.api-lectura.test.ts` → «`costeo.montoCobrar` es una CADENA de dos decimales, no el `number` publicado» |
| R18 | `ordenes-api-key-listado.route.test.ts` → «la respuesta no lleva `zonaId`, `esCentral`, `tarifaId` ni `cierreId`» · `ordenes-api-key-orden-consulta.route.test.ts` → ídem para el detalle · `orden-repository.api-lectura.test.ts` → «el `select` del congelado NO pide ninguna columna que se publique» |
| R19 | `api-orden-lectura-service.test.ts` → «con tarifa vigente, `costoEstimado` son los CINCO conceptos exactos» + «3 órdenes en 2 zonas ⇒ UNA llamada a `resolveTarifas`» |
| R20 | `api-orden-costo.test.ts` → «`esCentral` elige la columna — true da la GAM, false la estándar, y difieren» + «un distrito con PACTO ESPECIAL usa el monto pactado y no la columna» |
| R21 | `orden-repository.api-lectura.test.ts` → «distrito con `zonaEspecial: null` y orden SIN distrito dan los DOS `false`» (con el contraste `true`, para que no salga verde por vacío) |
| R22 | `api-orden-costo.test.ts` → «LA ASIMETRÍA — el estimado sin tarifa es `null`; el real son cinco `"0.00"`» · `api-orden-lectura-service.test.ts` → «sin tarifa para el par, `costoEstimado` es `null` y NO cinco ceros» · **`asimetria-sin-tarifa.test.ts` → la QUINTA superficie, con su contraprueba** |
| R23 | `openapi-415-zona-y-costo.test.ts` → «la description de `costoEstimado` dice que PUEDE CAMBIAR mientras `costoReal` sea null» |
| R24 | `api-orden-lectura-service.test.ts` → «3 órdenes en 2 zonas ⇒ UNA llamada con los 2 pares DISTINTOS» + «una página VACÍA no llama ni una vez» · `ordenes-api-key-listado.route.test.ts` → «la página entera resuelve tarifas en UNA sola consulta, sea cual sea su tamaño» · `costo-y-zona-api-415.test.ts` → el literal de 8 consultas |
| R25 | `costo-y-zona-api-415.test.ts` → «una orden con cierre APROBADO trae `costoReal` con los importes congelados» · `orden-repository.api-lectura.test.ts` → «el congelado se reconstruye con la tarifa y el fulfillment de la FILA» |
| R26 | `costo-y-zona-api-415.test.ts` → **«cierre SOLICITADO ⇒ `costoReal: null` — y su fila SÍ existe»**, **«cierre RECHAZADO ⇒ `costoReal: null`, y la fila NO se borró»** y «sin ninguna fila congelada ⇒ `null` — es el 28 %» · `orden-repository.api-lectura.test.ts` → «el `select` lleva `tiendaId` **y** `cierre.estado: "aprobado"`» |
| R27 | `costo-y-zona-api-415.test.ts` → «con DOS cierres aprobados gana la fila MÁS RECIENTE, y repetir da lo mismo» (las dos filas con tarifas DISTINTAS: elegir mal da 1000.00 en vez de 2500.00) · `orden-repository.api-lectura.test.ts` → «`orderBy` de DOS claves y `take: 1`» |
| R28 | `costo-y-zona-api-415.test.ts` → «una fila congelada con `tarifa_id IS NULL` trae los cinco `"0.00"`» · `api-orden-costo.test.ts` (el bloque de la asimetría) · `api-orden-lectura-service.test.ts` |
| R29 | `costo-y-zona-api-415.test.ts` → «`tarifa_fulfillment IS NULL` trae `fulfillment: "0.00"` y el resto igual» · `api-orden-lectura-service.test.ts` → «692.00 congelado contra 696.00 vigente» (los dos a mano) · `ordenes-api-key-orden-consulta.route.test.ts` |
| R30 | La guardia `cierre-detail-inmutable` existente sigue verde (gate) + esta ficha no llama a ningún método de escritura: el `select` del congelado es de sólo lectura |
| R31 | `costo-y-zona-api-415.test.ts` → «el DETALLE emite EXACTAMENTE 12 consultas» + «el LISTADO emite 8 y no cambia con el tamaño de la página» (el escenario tiene órdenes con 0, 1 y 2 filas congeladas) |
| R32 | `ordenes-api-key-listado.route.test.ts` → «una orden de OTRO owner sigue sin aparecer, y su zona y su costo tampoco» · `ordenes-api-key-orden-consulta.route.test.ts` → «una orden de OTRO owner sigue dando 404…» · `api-orden-lectura-service.test.ts` → «el par lleva el `usuarioId` del actor» · `orden-repository.api-lectura.test.ts` → «el `where` del listado y el del detalle NO cambian» |
| R33 | `costo-y-zona-api-415.test.ts` → «una fila congelada de OTRA tienda no alimenta el `costoReal` del dueño actual» · `orden-repository.api-lectura.test.ts` → el `where` pedido |
| R34 | `orden-repository.api-lectura.test.ts` (`toEqual` estructural) · los cuatro congeladores de claves enmendados (servicio, detalle, los dos bordes HTTP) · `ordenes-api-key-orden-consulta.route.test.ts` → «el detalle conserva `evidencias[]` y `gestiones[]` junto a los tres campos nuevos» · `openapi-415-zona-y-costo.test.ts` → «las diez propiedades anteriores conservan nombre, tipo y `required`» |
| R35 | `orden-repository.no-regresion-106.test.ts` (literal congelado enmendado) · los dos asertos de exclusión de los bordes · `ordenes-api-key-orden-consulta.route.test.ts` → «`zona.id` NO resuelve un `{id}`» |
| R36 | `ordenes-api-key-listado.route.test.ts` → «401 sin key, 403 prohibida y 422 con un `limit` inválido» · `ordenes-api-key-orden-consulta.route.test.ts` → «401, 403 y 422 conservan su criterio» (+ el 404 de la orden ajena) |
| R37 | `openapi-415-zona-y-costo.test.ts` → los 4 casos del bloque R37 + los 4 del espejo `.yaml` |
| R38 | `openapi-415-zona-y-costo.test.ts` → «tiene la MISMA forma que `Mensajero`, clave a clave y tipo a tipo» + «dice "agrupá por `id`, nunca por `nombre`"» · T11 (la regla nº 1 del manual, verificación humana) |
| R39 | `openapi-415-zona-y-costo.test.ts` → «ninguna description afirma que el canal no publica ninguna zona» (escaneo de las 20+ descriptions del spec, con auto-comprobación de que el escaneo corrió) + «la de `mensajero` acota la palabra sin retirarla» |
| R40 | T12 (`docs/api/CHANGELOG.md`) y T11 (`docs/api/manual-metricas-por-mensajero.md`) — verificación **humana**; T12 bloquea la RELEASE |

---

## Mutaciones probadas — las diez murieron

Arnés en `scratchpad/mutaciones.py`, con **auto-comprobación obligatoria** por la memoria del repo
(«un arnés de mutaciones reportó 9/9 supervivientes DOS veces sin haber ejecutado un solo test»):

1. antes de mutar nada, corre la selección entera y **exige verde**, o aborta;
2. cada mutación **afirma que el texto cambió** (`assert` sobre el conteo del ancla y sobre el
   contenido del archivo);
3. cada corrida imprime **la línea literal de vitest**, no un veredicto resumido por mí;
4. al terminar, restaura y **vuelve a correr**: tiene que quedar verde otra vez.

```
=== AUTOCOMPROBACION 1: la seleccion sin mutar tiene que estar VERDE ===
  Test Files  13 passed (13)
  Tests  206 passed (206)
...
=== AUTOCOMPROBACION 2: restaurado, la seleccion vuelve a VERDE ===
  Test Files  13 passed (13)
  Tests  206 passed (206)
```

| # | Mutación (código de PRODUCCIÓN) | Resultado | Archivos rojos |
|---|---|---|---|
| M1 | quitar `cierre: { estado: "aprobado" }` del `where` del congelado — **el filtro de D5** | **MUERTA** (4 rojos) | `costo-y-zona-api-415`, `orden-repository.api-lectura`, `orden-repository.no-regresion-106` |
| M2 | quitar `tiendaId` del `where` del congelado (R33) | **MUERTA** (4 rojos) | los mismos tres |
| M3 | invertir el `orderBy` del congelado: gana la MÁS ANTIGUA (R27) | **MUERTA** (3 rojos) | los mismos tres |
| M4 | `costoEstimadoDe` sin tarifa devuelve cinco `"0.00"` en vez de `null` (R22 / D7) | **MUERTA** (6 rojos) | `api-orden-costo`, `api-orden-lectura-service`, `ordenes-api-key-listado.route`, `asimetria-sin-tarifa` |
| M5 | el `fulfillment` de `costoReal` sale del VIGENTE en vez del congelado (R29) | **MUERTA** (8 rojos) | `api-orden-lectura-service`, `ordenes-api-key-orden-consulta.route`, `costo-y-zona-api-415`, la guardia |
| M6 | `esZonaEspecial` con la negación en vez de `=== true` (R21, el tri-valuado) | **MUERTA** (2 rojos) | `orden-repository.api-lectura` |
| M7 | publicar `zona.esCentral` (R5) | **MUERTA** (2 rojos) | `orden-repository.api-lectura` |
| M8 | el composition root del listado **importa** el resolutor y **no lo pasa** (T5) | **MUERTA** (2 rojos) | `ordenes-api-key-composicion-415` |
| M9 | `costeo.montoCobrar` pasa por `number` en vez de por cadena (R17 / D9) | **MUERTA** (2 rojos) | `orden-repository.api-lectura` |
| M10 | el service NO copia `zona` al DTO (R1) | **MUERTA** (10 rojos, en 7 archivos) | los dos bordes, la guardia, el service, la base real, la asimetría, la composición |

### La contraprueba que de verdad pedía T7: las tres mutaciones del `WHERE`, contra **SOLO** el test de base real

Porque «murió» no dice **dónde** murió, y lo que T7 tiene que demostrar es que el filtro se mata
**donde vive** —en el motor— y no sólo con el aserto sobre lo que se le pide a Prisma
(`scratchpad/mut-solo-db.py`):

```
BASE (sin mutar): Tests  11 passed (11)

M1 -> Tests  2 failed | 9 passed (11)
   × R26: una orden con cierre SOLICITADO trae `costoReal: null` — y su fila SI existe
   × R26: una orden con cierre RECHAZADO trae `costoReal: null`, y la fila NO se borro

M2 -> Tests  1 failed | 10 passed (11)
   × R33: una fila congelada de OTRA tienda no alimenta el `costoReal` del dueno actual

M3 -> Tests  1 failed | 10 passed (11)
   × R27: con DOS cierres aprobados gana la fila MAS RECIENTE, y repetir da lo mismo

RESTAURADO: Tests  11 passed (11)
```

**`grep -rn MUTACION lib/ app/`** vuelve limpio y el typecheck queda en verde.

### Las cuatro trampas del repo, cubiertas por su nombre

- **Aserción contra su propia fuente.** Todos los importes esperados se escriben **a mano**, con la
  aritmética anotada al lado del caso. Ni un `expect(x).toBe(costoEstimadoDe(...))`. M5 lo
  confirma: si el fulfillment se comparara contra su fuente, M5 habría sobrevivido.
- **Los dobles no ven el SQL.** El `where` del congelado, el `take: 1`, el `orderBy` y el filtro por
  estado se ejecutan contra Postgres en T7, y la contraprueba de arriba mide que ese archivo
  **solo** los mata.
- **Test verde sin datos.** Los diez casos de T7 afirman primero que **sembraron** (`filasDeDos === 2`,
  `filasDelSolicitado === 1`, `not.toBeNull()`), y el archivo **no contiene ningún
  `if (!algo) return;`**. Los literales de consultas afirman además `length > 0`, para que un espía
  que no llegara a engancharse no los dejara verdes por vacío.
- **Literal: contrato o polizón.** Los siete literales congelados que esta ficha rompía **son el
  contrato**: se enmiendan con su bloque fechado y siguen siendo igualdades exactas. Ninguno pasó a
  `toContain`, a `toMatchObject` ni a un aserto de longitud.

---

## Gate

`./init.sh` **COMPLETO** (no `--rapido`): el diff toca nombres de dinero (`tarifa`, `cierre`,
`comision`, `flete`) en `lib/` **y** `lib/types/api-orden.ts`, así que el modo rápido se niega solo
y manda al completo (`docs/verification.md`).

**El log se escribe a archivo, sin canalizar por `tail`, y el `INIT_EXIT` va DENTRO del log.** Y no
es ceremonia: la **primera** corrida la lanzó la herramienta en segundo plano y me la notificó como
**«completed (exit code 0)»**, mientras el log decía `INIT_EXIT=1`. El gate estaba **ROJO** y el
exit code del comando decía lo contrario. Es exactamente el fallo que el encargo avisaba.

### Corrida 1 — `scratchpad/gate-415.log`, sobre el árbol SIN sincronizar con `dev`: **ROJO**

```
 Test Files  6 failed | 1880 passed (1886)
      Tests  7 failed | 27425 passed | 35 skipped (27467)
ROJOS NUEVOS (6 archivo(s) que no estan en el baseline):
  - tests/integration/db/liquidacion-reparto-migration.test.ts
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
  - tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts
  - tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
  - tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts
  - tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts
✗ hay rojos NUEVOS respecto del baseline (el detalle esta justo arriba)
INIT_EXIT=1
```

**Qué eran esos seis, medido y no supuesto. Ninguno era mío, pero uno sí era mi problema.**

- **Cinco (`notificacion-evento-*`)**: la rama iba **detrás de `dev`**. El fallo es
  `expected [13 valores] to deeply equal [11 valores]` sobre el enum `notificacion_evento`: la base
  local tiene aplicada la migración **`20260911120000_notificacion_evento_avisos_agregados`**
  —comprobado en `_prisma_migrations`—, que añade `novedades_sin_gestionar` y
  `devoluciones_represadas`. Esa migración **existe en `origin/dev`** (`dcec442b`) y **no existía en
  mi SHA base** (`4a2f6094`, 14 commits por detrás). O sea: no era deuda ajena ni un flake, era la
  sincronización con `dev` que pedía el paso F2.3 y que aún no había hecho.
- **Uno (`liquidacion-reparto-migration`)**: **`40P01`, «se ha detectado un deadlock»**, con **0
  tests fallidos** de ese archivo (era una *Failed Suite*, no un caso rojo). Es el patrón exacto de
  **contención sobre la base local compartida** que el encargo describía. Re-corrido **aislado**,
  pasa: `Tests 115 passed (122)` en los seis archivos juntos, y ese fichero sin un solo rojo.

**Acción:** `git fetch origin dev` + `git merge origin/dev` (F2.3). El merge entró **limpio, sin un
solo conflicto**; `pnpm exec prisma generate` y `pnpm run typecheck` quedaron en verde, y
`prisma migrate status` pasó de 189 a **190 migraciones**, ya al día con la base local.

### Corrida 2 — `scratchpad/gate-415-tras-merge.log`, ya con `origin/dev` mergeado: **VERDE**

```
 Test Files  1905 passed (1905)
      Tests  27647 passed | 26 skipped (27673)
   Duration  644.41s

✓ typecheck paso
✖ 184 problems (0 errors, 184 warnings)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1905 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

`pnpm run typecheck` → **0 errores**. `pnpm run lint` → **0 errores**, 184 warnings. Los 184 son
`no-unused-vars` preexistentes; se cruzó la lista de archivos con warning contra la lista de
archivos que esta rama toca y **sale UNO solo**, `tests/unit/services/api-pdf-etiqueta-service.test.ts`,
cuyos 4 warnings son de parámetros `_ordenId`/`_ownerId` que ya estaban antes (esta ficha solo le
añadió dos líneas de fixture). **Esta ficha no introduce ni un warning nuevo.**

Los tres avisos de `down.sql` faltante son deuda preexistente de tres migraciones de agosto, ajenas
a esta ficha: **aquí no se creó ninguna migración**.

### ⚠️ Los `skipped`, mirados uno a uno (no sólo el exit code)

**El `.env` SE COPIÓ del checkout principal**, y antes de copiarlo se comprobó a dónde apunta **sin
leerlo** (está bloqueado): `pnpm exec prisma migrate status` dice
`PostgreSQL database "ordenex", schema "public" at "localhost:5432"` — la base **local**, no
Supabase.

El resultado, con la cifra que imprime el propio gate:

```
✓ DATABASE_URL resuelta: los 160 archivos de tests contra Postgres SI se ejecutan
```

- **245 archivos de `tests/integration/db/` corrieron, y los 245 con `✓`.** Cero `↓` de archivo, y
  el grep de `↓` sobre el log entero devuelve **0**.
- Los **26 tests saltados** de toda la suite están —leídos del informe JSON, no del log— en
  **exactamente DOS archivos**, los dos de frontend y ajenos a esta ficha:
  `tests/components/AnaliticaPage.test.tsx` (17) y `tests/components/AnaliticaShell.test.tsx` (9).
  **Ni uno solo en `integration/db`.**
- **T7 EJECUTÓ**: `✓ tests/integration/db/costo-y-zona-api-415.test.ts (11 tests) 2026ms`. Sin
  `DATABASE_URL` ese archivo se salta entero y el gate habría salido «OK» igual.

Los 27 archivos que esta ficha toca o cubre aparecen **todos con `✓`** en el log. Los de la ficha:

```
✓ tests/unit/types/api-orden-415-dto.test.ts (13 tests)
✓ tests/unit/utils/api-orden-costo.test.ts (12 tests)
✓ tests/unit/guards/costo-orden-forma-unica.guardia.test.ts (11 tests)
✓ tests/unit/api/openapi-415-zona-y-costo.test.ts (29 tests)
✓ tests/unit/api/ordenes-api-key-composicion-415.test.ts (3 tests)
✓ tests/integration/db/costo-y-zona-api-415.test.ts (11 tests)
✓ tests/unit/repositories/orden-repository.api-lectura.test.ts (28 tests)
✓ tests/unit/repositories/orden-repository.no-regresion-106.test.ts (7 tests)
✓ tests/unit/services/api-orden-lectura-service.test.ts (18 tests)
✓ tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts (13 tests)
✓ tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts (19 tests)
✓ tests/unit/services/api-orden-lectura-service.filtros-257.test.ts (8 tests)
✓ tests/unit/guards/mensajero-forma-unica.guardia.test.ts (6 tests)
✓ tests/unit/types/api-mensajero-dto.test.ts (7 tests)
✓ tests/unit/api/openapi-404-mensajero.test.ts (20 tests)
✓ tests/unit/api/openapi-405-gestiones.test.ts (26 tests)
✓ tests/integration/api/ordenes-api-key-listado.route.test.ts (23 tests)
✓ tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts (31 tests)
✓ tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts (32 tests)
✓ tests/integration/asimetria-sin-tarifa.test.ts (8 tests)
✓ tests/integration/db/gestiones-detalle-api-405.test.ts (12 tests)
```

Y los dos tests de aislamiento que el design declara intocables siguen verdes **sin que su alcance
se haya tocado**: lo único que cambió en `ordenes-api-key-tienda-destino-aislamiento.route.test.ts`
fue la fixture del doble, que ahora devuelve lo que el repositorio REAL devuelve.


---

## Lo que queda abierto

1. **T12 bloquea la release, no el código.** La entrada del CHANGELOG está escrita y commiteada,
   pero **el aviso hay que MANDARLO** antes de desplegar: el texto *es* el aviso (se copia y se
   manda). En particular a quien tenga validación estricta de esquema —ya pasó con `mensajero`—.
2. **Verificación HUMANA pendiente del reviewer**, tal y como `tasks.md` la declara y sin sustituto
   automático: (a) la equivalencia palabra por palabra entre `lib/api/openapi-spec.ts` y
   `docs/api/api-key-openapi.yaml` (no hay comparador entre los dos artefactos; los asertos de
   `openapi-415-zona-y-costo.test.ts` cubren la estructura del espejo y las frases clave, no su
   redacción entera); (b) el diff de `docs/api/manual-metricas-por-mensajero.md` (T11 prohíbe
   expresamente cualquier criterio de `grep` sobre ese texto); (c) los cuatro textos de R39.
3. **El MCP `codebase-memory` no estaba disponible en esta sesión**: toda la búsqueda de código se
   hizo con `grep` sobre los archivos reales. Para T0.1 da igual (la task exige justamente abrir el
   archivo), pero conviene que conste por la regla 7 de `CLAUDE.md`.
4. **Sin E2E**: el repo no tiene harness de Playwright vivo y esta ficha es backend puro sin
   pantalla. No aplica.
5. **El número de consultas del detalle subió de 9 a 12 y el del listado de 4 a 8**, medido. Es el
   coste declarado del diseño (Prisma resuelve cada relación anidada con su propia consulta) y las
   dos cifras quedan CONGELADAS por su nombre de tabla, así que una relación más las pone rojas y
   dice cuál es. La invariante que importa se conserva: **el número no depende del tamaño de la
   página ni de cuántos cierres tenga cada orden**.
6. **`costoEstimado` se mueve**, y es el punto de la ficha. Un integrador que lo archive sin leer el
   aviso construirá una serie que cambia sola; por eso la advertencia va **en el contrato**, no
   sólo en el CHANGELOG.

---

**Veredicto:** los tres campos viajan aditivos y con la misma forma en el listado y en el detalle, los 40 requisitos tienen un test que se pone rojo con una mutación real (las diez murieron, con auto-comprobación verde antes y después), las tres propiedades del `WHERE` que sólo puede afirmar Postgres se matan contra Postgres, y `./init.sh` completo termina con `INIT_EXIT=0` —escrito DENTRO del log— sobre 1.905 archivos, 27.647 tests y **245 archivos de `integration/db` ejecutados, ninguno saltado**.
