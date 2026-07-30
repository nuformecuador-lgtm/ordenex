# Feature 141 — Tabla `carga` + `carga_id` en `orden` — Requisitos (EARS)

> Zona: backend. Alcance: modelo de datos del LOTE de carga masiva y su propagación
> a las órdenes creadas por los dos caminos de carga masiva existentes; persistir y
> devolver el `carga_id`; permitir nombrar el lote; y —en la vía API key— elegir con
> `download_type` si las etiquetas del lote se generan como PDF consolidado o como un PDF por
> orden, persistiendo la URL resultante en `carga.download_url` o en `orden.download_url`.
> Fuera de alcance: cualquier UI (listado, filtro o visualización por lote), backfill
> histórico, `download_type` en la vía sesión/chunks.

## Decisiones cerradas con el humano (contexto, no son requisitos)

- D1. `download_url` existe en AMBAS tablas: `orden.download_url` y `carga.download_url`, nullable.
- D2. `batch_url` queda FUERA del alcance (no se crea).
- D3. `status` NO existe en `carga` (ni columna ni enum nuevo).
- D4. `carga.total_files` = tamaño TOTAL del lote declarado por el canal de carga (gate F1.4-2).
- D5. Disparadores: `BulkOrdenService.cargarMasiva` (vía sesión, UI /ordenes) y
  `BulkOrdenService.cargarViaApi` (vía API key). El alta manual de UNA orden no crea lote.
- D6. `num_guia` se mantiene exactamente como hoy; `carga_id` es un identificador de LOTE
  nuevo e independiente.
- D7. Todas las órdenes de un mismo lote nacen con el mismo `carga_id`; `orden.carga_id` es
  NULLABLE y no hay backfill del histórico.
- D8. **`carga.id` es un identificador INTERNO generado por el SERVIDOR**; el cliente nunca
  lo propone (gate F1.4-7).
- D9. **`carga.name` es el ÚNICO campo del lote que define el usuario**: opcional, único por
  usuario (gate F1.4-8/F1.4-9).
- D10. **`download_type` (`consolidate` | `individual`, default `consolidate`) es un parámetro
  SOLO de la vía API key; NO se persiste** (no hay columna) (gate F1.4-11).
- D11. **Esta feature SÍ cablea la generación de PDFs de etiquetas y escribe `download_url`**
  (gate F1.4-12). Esto **DEROGA** la decisión previa "`download_url` queda NULL en todo el
  alcance", que ya no rige.

> Nota sobre códigos HTTP: el manejador de errores del repo (`lib/errors`) mapea
> `VALIDATION_ERROR → 422`, `FORBIDDEN → 403` y `CONFLICT → 409`. Los requisitos usan esos
> códigos.

---

## 1. Modelo de datos

**R1.** El sistema DEBE persistir cada lote de carga masiva como una fila de la tabla
`carga`, con identificador propio, `fecha_carga`, `usuario_carga`, `name`, `download_url` y
`total_files`.

**R2.** El sistema DEBE almacenar en `carga.usuario_carga` una referencia NOT NULL al
usuario que realizó la carga, con integridad referencial contra la tabla `usuario`.

**R3.** El sistema NO DEBE definir en `carga` las columnas `batch_url` ni `status`, ni
introducir un enum nuevo para el estado de una carga (D2/D3).

**R4.** El sistema DEBE exponer en `orden` una columna `carga_id` NULLABLE con integridad
referencial contra `carga` y borrado restringido (`ON DELETE RESTRICT`).

**R5.** El sistema DEBE exponer en `orden` una columna `download_url` NULLABLE de texto.

**R6.** El sistema DEBE exponer `carga.download_url` NULLABLE de texto.

**R7.** El sistema DEBE registrar `carga.total_files` como entero NOT NULL que representa el
TAMAÑO TOTAL DEL LOTE (no el de un chunk ni el de un batch interno).

**R8.** El sistema DEBE exponer `carga.name` como texto NULLABLE: es un dato OPCIONAL que
define el usuario y NULL significa "lote sin nombre".

**R9.** El sistema DEBE imponer unicidad de `name` POR USUARIO mediante una restricción
compuesta sobre (`usuario_carga`, `name`), de modo que dos usuarios distintos puedan usar el
mismo nombre y un mismo usuario no pueda repetirlo.

**R10.** MIENTRAS varios lotes del mismo usuario tengan `name` NULL, el sistema DEBE
aceptarlos todos (la unicidad no aplica a los lotes sin nombre).

**R11.** MIENTRAS existan órdenes creadas antes de esta feature, el sistema DEBE mantener su
`carga_id` en NULL (la migración NO realiza backfill ni inventa lotes retroactivos).

**R12.** El sistema DEBE habilitar Row Level Security sobre `carga` sin definir policies,
resolviendo la autorización de negocio en la capa de servicio.

**R13.** El sistema DEBE proveer la migración con `migration.sql` (UP) y `down.sql` (DOWN),
de modo que el DOWN revierta exactamente lo que el UP crea (tabla `carga` con todas sus
columnas e índices —incluida la restricción única compuesta—, ambas columnas nuevas de
`orden`, sus índices y sus claves foráneas).

**R14.** El sistema DEBE mantener intactos `orden.num_guia` y su generación (ninguna
columna, índice, secuencia o constraint de `num_guia` es alterada por esta feature).

## 2. Identidad del lote (`carga.id`)

**R15.** El sistema DEBE generar el valor de `carga.id` en el SERVIDOR, dentro de la
transacción que persiste las órdenes del lote; NINGÚN valor propuesto por el cliente puede
convertirse en el id de una fila nueva de `carga`.

**R16.** CUANDO una carga masiva por sesión persiste órdenes y la petición NO trae
identificador de lote, el sistema DEBE crear la fila de `carga`, escribir el id generado en
`orden.carga_id` de todas las órdenes creadas en esa petición y devolver ese id en la
respuesta.

**R17.** CUANDO una petición trae un identificador de lote emitido previamente por el
servidor y perteneciente al actor, el sistema DEBE reutilizar esa fila de `carga` (sin crear
otra) y asociarle las órdenes creadas en esa petición.

**R18.** SI el identificador de lote recibido no cumple el formato del token emitido por el
servidor (UUID), ENTONCES el sistema DEBE rechazar la petición con error de validación
(`VALIDATION_ERROR`, HTTP 422) sin crear órdenes ni lote.

**R19.** SI el identificador de lote recibido no corresponde a ninguna fila de `carga`, o
corresponde a una cuyo `usuario_carga` es distinto del actor autenticado, ENTONCES el sistema
DEBE rechazar la petición como prohibida (`FORBIDDEN`, HTTP 403) sin crear ninguna orden, sin
crear ningún lote y sin modificar el lote existente.

## 3. Nombre del lote (`carga.name`)

**R20.** El sistema DEBE aceptar un nombre de lote OPCIONAL en AMBAS vías de carga (la vía
sesión y la vía API key).

**R21.** CUANDO una petición que crea el lote trae nombre, el sistema DEBE persistirlo en
`carga.name` de esa fila.

**R22.** CUANDO una petición que crea el lote NO trae nombre, el sistema DEBE dejar
`carga.name` en NULL.

**R23.** CUANDO una petición reutiliza un lote ya existente (chunk posterior de la misma
sesión), el sistema NO DEBE modificar el `name` ya persistido.

**R24.** SI el actor ya tiene un lote con el mismo `name`, ENTONCES el sistema DEBE rechazar
la carga con un error de conflicto (`CONFLICT`, HTTP 409) cuyo mensaje identifique el nombre
duplicado, y NO DEBE crear el lote ni ninguna orden de esa petición.

**R25.** SI dos usuarios distintos usan el mismo `name`, ENTONCES el sistema DEBE aceptar
ambos lotes.

## 4. Creación del lote — vía sesión (`cargarMasiva`)

**R26.** CUANDO una carga masiva por sesión persiste al menos una orden, el sistema DEBE
registrar exactamente UNA fila en `carga` para toda esa sesión de carga (aunque se envíe en N
chunks) y asociar TODAS las órdenes creadas en esa sesión a esa misma fila (`orden.carga_id`).

**R27.** CUANDO una carga masiva se ejecuta en modo `dryRun` (validación previa), el sistema
NO DEBE crear ninguna fila en `carga` ni escribir `carga_id` en ninguna orden.

**R28.** SI un chunk no persiste ninguna orden (todas sus filas resultaron duplicadas o con
error), ENTONCES el sistema NO DEBE crear la fila de `carga` a causa de ese chunk.

**R29.** CUANDO se crea la fila de `carga` por la vía sesión, el sistema DEBE fijar
`total_files` al total de filas de la SESIÓN de carga declarado por el cliente (la suma de
todos los chunks), y NO al número de filas del chunk que creó la fila; los chunks
posteriores de la misma sesión NO DEBEN acumular, sobrescribir ni recalcular `total_files`.

## 5. Creación del lote — vía API key (`cargarViaApi`)

**R30.** CUANDO una carga por API key persiste al menos una orden, el sistema DEBE registrar
exactamente UNA fila en `carga` por petición y asociar todas las órdenes creadas en esa
petición a esa fila.

**R31.** CUANDO se crea una fila de `carga` por la vía API key, el sistema DEBE fijar
`usuario_carga` al usuario dedicado de la API key autenticada (el mismo actor que ya queda
como `orden.tienda_id` y como actor del historial de estados).

**R32.** CUANDO se crea una fila de `carga` por la vía API key, el sistema DEBE fijar
`total_files` a la cantidad de objetos del array recibido en el payload de la petición (las
filas del lote), y NO al tamaño de los batches internos de persistencia.

**R33.** SI una carga por API key no persiste ninguna orden, ENTONCES el sistema NO DEBE
crear fila alguna en `carga`.

## 6. Transaccionalidad e invariantes

**R34.** CUANDO el sistema persiste un bloque de órdenes de un lote, DEBE asegurar la fila de
`carga` y escribir el `carga_id` de esas órdenes dentro de la MISMA transacción, de forma
que un fallo en cualquiera de las dos operaciones no deje ni órdenes sin lote ni lote sin
órdenes de ese bloque.

**R35.** MIENTRAS exista una fila en `carga`, el sistema DEBE garantizar que al menos una
orden la referencia (no se crean lotes huérfanos).

**R36.** El sistema DEBE asignar el mismo `carga_id` a todas las órdenes efectivamente
creadas dentro de un mismo lote, y NO DEBE modificar el `carga_id` de órdenes preexistentes
(las filas duplicadas que la carga salta conservan el `carga_id` que ya tuvieran, incluido NULL).

**R37.** CUANDO se crea una orden por el alta manual individual (fuera de la carga masiva),
el sistema DEBE dejar `carga_id` en NULL y NO DEBE crear fila alguna en `carga`.

**R56.** CUANDO una orden cambia de estado por una vía que NO es la carga masiva —en
particular al **deshacer la asignación**— el sistema DEBE conservar intactos su `carga_id` y su
`download_url`.

> **Añadido el 2026-07-30, después del resto de la spec** (de ahí que su número rompa el orden
> de lectura: los `R<n>` son identificadores, no posiciones). Lo destapó una **mutación
> superviviente** del re-review: añadir `carga_id = NULL, download_url = NULL` al `SET` de
> `deshacerAsignacionLote` dejaba **7110/7110 tests en verde**. El comportamiento ya era
> correcto, pero se cumplía **por accidente de implementación, no por contrato**: nada impedía
> que alguien ampliara ese `SET` «por limpieza» y se llevara por delante la trazabilidad de la
> carga.
>
> **Está redactado a propósito más ancho que el mutante** —«una vía que no es la carga masiva»,
> no «`deshacerAsignacionLote`»— para que alcance a vías futuras que hoy no existen. **R36** cubre
> el caso hermano (la carga no pisa el `carga_id` de órdenes preexistentes); éste cubre el de
> salida.
>
> Verificado en `tests/integration/repositories/deshacer-asignacion.trazabilidad-carga.test.ts`,
> colocado deliberadamente **lejos** de los tests unitarios que afirman la *forma* del SQL: un
> aserto de esa familia habría fijado el texto del `SET` en vez de su efecto.

## 7. Contratos expuestos

**R38.** CUANDO una carga masiva por sesión termina, la respuesta DEBE incluir el
identificador del lote (el creado en esa petición o el reutilizado), o `null` si no se creó
ninguno (dry-run o cero órdenes persistidas).

**R39.** CUANDO una carga por API key termina con éxito, la respuesta DEBE incluir el
identificador del lote creado, o `null` si no se creó ninguno, preservando todos los campos
que ya devolvía el endpoint (incluido `etiquetasPdf`).

**R40.** El sistema DEBE dejar `carga.download_url` y `orden.download_url` en NULL en la vía
sesión (`cargarMasiva` / chunks): esa vía no genera PDFs ni escribe URLs.
*(Este requisito SUPERA al antiguo "download_url queda NULL en todos los caminos": la vía API
key sí las escribe, ver §8.)*

**R41.** El sistema DEBE preservar las reglas de autorización vigentes de ambos caminos: la
vía sesión sigue exigiendo rol `adminTienda` y la vía API key sigue exigiendo rol `apiKey`;
esta feature no relaja ni amplía ningún permiso.

## 8. `download_type` y generación de etiquetas (SOLO vía API key)

**R42.** El sistema DEBE aceptar en la petición de carga por API key un parámetro OPCIONAL
`download_type` cuyos únicos valores válidos son `consolidate` e `individual`.

**R43.** SI la petición omite `download_type`, ENTONCES el sistema DEBE comportarse como si
hubiera recibido `consolidate`.

**R44.** SI `download_type` trae un valor distinto de `consolidate` o `individual`, ENTONCES
el sistema DEBE rechazar la petición con error de validación (`VALIDATION_ERROR`, HTTP 422)
antes de crear ninguna orden y sin tocar Storage.

**R45.** El sistema NO DEBE persistir `download_type` en ninguna tabla (no existe columna
para él).

**R46.** El sistema NO DEBE aceptar `download_type` como parámetro de la vía sesión
(`carga-masiva/chunk`): ese endpoint no lo interpreta ni cambia su comportamiento por él.

**R47.** CUANDO una carga por API key con `download_type = consolidate` crea al menos una
orden con etiqueta imprimible, el sistema DEBE generar UN único PDF con las etiquetas del
lote y persistir su URL en `carga.download_url` de la fila de `carga` de esa petición,
dejando en NULL el `orden.download_url` de esas órdenes.

**R48.** CUANDO una carga por API key con `download_type = individual` crea al menos una
orden con etiqueta imprimible, el sistema DEBE generar UN PDF por cada una de esas órdenes y
persistir la URL de cada PDF en el `orden.download_url` de SU orden, dejando en NULL
`carga.download_url`.

**R49.** SI una orden creada no tiene etiqueta imprimible (sin `num_guia` o no encontrada),
ENTONCES el sistema DEBE dejar su `orden.download_url` en NULL sin abortar la generación de
las demás.

**R50.** SI la carga por API key no crea ninguna orden, ENTONCES el sistema NO DEBE generar
ningún PDF ni escribir en Storage, y no habrá `download_url` que escribir (tampoco hay lote).

**R51.** SI la generación, el almacenamiento, la firma o la persistencia de una URL falla,
ENTONCES el sistema DEBE responder HTTP 200 sin revertir la carga (best-effort), DEBE dejar
en NULL el `download_url` afectado y DEBE hacer visible el fallo en la respuesta.

**R52.** SI el número de etiquetas a generar supera el tope configurado por petición,
ENTONCES el sistema NO DEBE iniciar la generación en ningún modo, DEBE conservar las órdenes
creadas con su `num_guia` y DEBE reportar el motivo en la respuesta.

**R53.** CUANDO el modo es `consolidate`, la respuesta DEBE seguir exponiendo el bloque
`etiquetasPdf` con la misma forma que hoy (URL + expiración, `{ error }` ante fallo, `null`
cuando no había nada que generar), preservando la compatibilidad hacia atrás del contrato
vigente.

**R54.** CUANDO el modo es `individual`, la respuesta DEBE exponer la URL del PDF de cada
orden creada dentro de la entrada de esa orden, con `null` si no se generó.

**R55.** La respuesta de la carga por API key DEBE indicar el modo de descarga efectivamente
aplicado (`consolidate` o `individual`), incluido el caso en que se aplicó por defecto.

---

## Decisiones cerradas del gate F1.4

Las dudas del primer borrador y el cambio de diseño posterior quedaron RESUELTOS por el
humano. No se reabren; los requisitos de arriba ya los reflejan.

1. **Nombre de la tabla: `carga` (SINGULAR)**, respetando la convención del repo
   (`orden`, `usuario`, `plantilla_mensaje`). Modelo Prisma `Carga` con `@@map("carga")`.
   La columna de `orden` conserva el nombre `carga_id`. (R1–R4, R12, R13)
2. **`total_files` = tamaño TOTAL del lote.** Vía API key: cantidad de objetos del array del
   payload (R32). Vía sesión: total de filas de la sesión declarado por el cliente, nunca el
   del chunk, y sin acumularse entre chunks (R7, R29).
3. **FK `orden.carga_id` con `ON DELETE RESTRICT`**: un lote con órdenes no puede borrarse.
   (R4, R13)
4. ~~**`download_url` queda NULL en toda esta feature**~~ — **DEROGADA por el punto 11**. Ya
   NO rige: la vía API key escribe `download_url` (en `carga` o en `orden` según
   `download_type`). En la vía sesión sí siguen quedando NULL (R40).
5. **Alcance = persistir y devolver `carga_id` (+ aceptar `name` y `download_type`).** Sin
   UI, sin listado ni filtro por lote. (R38, R39, R42–R55)
6. **Siguen vigentes D1–D7**, con D4 precisada por el punto 2.
7. **`carga.id` lo genera el SERVIDOR dentro de la transacción; el cliente NUNCA lo propone**
   (D8). La correlación entre chunks se hace con el token OPACO que el servidor emite en la
   respuesta del primer chunk y el cliente reenvía en los siguientes; como el id viaja por la
   red, se conserva el guard de propiedad (403), que además cubre el id inexistente.
   (R15–R19, R26, R38)
8. **`name`: TEXT NULLABLE, opcional, definido por el usuario**, aceptado en AMBAS vías de
   carga (R8, R20–R23).
9. **Unicidad de `name` POR USUARIO** (`UNIQUE(usuario_carga, name)`, con múltiples NULL
   permitidos por Postgres). Repetir un nombre propio hace fallar la carga con **409**
   (`CONFLICT`), mapeado de punta a punta: error de dominio tipado en el repositorio →
   `ConflictError` del borde HTTP. (R9, R10, R24, R25)
10. **La migración `20260727120000_carga_orden_carga_id` se MODIFICA EN SITIO** (no está
    aplicada en ninguna base ni mergeado su PR): la columna `name` y su índice único
    compuesto entran en ese mismo `migration.sql`/`down.sql`, sin migración correctiva.
11. **`download_type` (`consolidate` | `individual`, default `consolidate`), SOLO en la vía
    API key y sin persistirse** (D10; R42–R46). **Esta feature CABLEA la generación de PDFs y
    ESCRIBE `download_url`** (D11), derogando el punto 4: `consolidate` reusa el PDF único
    del lote de la feature 136 y guarda su URL en `carga.download_url`; `individual` genera
    un PDF por orden y guarda cada URL en `orden.download_url`. La generación sigue siendo
    **best-effort** (un fallo no revierte la carga; el `download_url` afectado queda NULL y
    el fallo se hace visible). (R47–R55)
