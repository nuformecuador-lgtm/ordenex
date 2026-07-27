# Feature 141 — Tabla `carga` + `carga_id` en `orden` — Requisitos (EARS)

> Zona: backend. Alcance: modelo de datos del LOTE de carga masiva y su propagación
> a las órdenes creadas por los dos caminos de carga masiva existentes; persistir y
> devolver el `carga_id`.
> Fuera de alcance: cualquier UI (listado, filtro o visualización por lote), escritura de
> `download_url` (la produce una feature posterior), backfill histórico.

## Decisiones cerradas con el humano (contexto, no son requisitos)

- D1. `download_url` existe en AMBAS tablas: `orden.download_url` y `carga.download_url`, nullable.
- D2. `batch_url` queda FUERA del alcance (no se crea).
- D3. `status` NO existe en `carga` (ni columna ni enum nuevo).
- D4. `carga.total_files` = tamaño del lote declarado por el canal de carga (ver F1.4-2).
- D5. Disparadores: `BulkOrdenService.cargarMasiva` (vía sesión, UI /ordenes) y
  `BulkOrdenService.cargarViaApi` (vía API key). El alta manual de UNA orden no crea lote.
- D6. `num_guia` se mantiene exactamente como hoy; `carga_id` es un identificador de LOTE
  nuevo e independiente.
- D7. Todas las órdenes de un mismo lote nacen con el mismo `carga_id`; `orden.carga_id` es
  NULLABLE y no hay backfill del histórico.

---

## 1. Modelo de datos

**R1.** El sistema DEBE persistir cada lote de carga masiva como una fila de la tabla
`carga`, con identificador propio, `fecha_carga`, `usuario_carga`, `download_url` y
`total_files`.

**R2.** El sistema DEBE almacenar en `carga.usuario_carga` una referencia NOT NULL al
usuario que realizó la carga, con integridad referencial contra la tabla `usuario`.

**R3.** El sistema NO DEBE definir en `carga` las columnas `batch_url` ni `status`, ni
introducir un enum nuevo para el estado de una carga (D2/D3).

**R4.** El sistema DEBE exponer en `orden` una columna `carga_id` NULLABLE con integridad
referencial contra `carga`.

**R5.** El sistema DEBE exponer en `orden` una columna `download_url` NULLABLE de texto.

**R6.** El sistema DEBE exponer `carga.download_url` NULLABLE de texto.

**R7.** El sistema DEBE registrar `carga.total_files` como entero NOT NULL que representa el
TAMAÑO TOTAL DEL LOTE (no el de un chunk ni el de un batch interno).

**R8.** MIENTRAS existan órdenes creadas antes de esta feature, el sistema DEBE mantener su
`carga_id` en NULL (la migración NO realiza backfill ni inventa lotes retroactivos).

**R9.** El sistema DEBE habilitar Row Level Security sobre `carga` sin definir policies,
resolviendo la autorización de negocio en la capa de servicio.

**R10.** El sistema DEBE proveer la migración con `migration.sql` (UP) y `down.sql` (DOWN),
de modo que el DOWN revierta exactamente lo que el UP crea (tabla `carga`, ambas columnas
nuevas de `orden`, sus índices y sus claves foráneas).

**R11.** El sistema DEBE mantener intactos `orden.num_guia` y su generación (ninguna
columna, índice, secuencia o constraint de `num_guia` es alterada por esta feature).

## 2. Creación del lote — vía sesión (`cargarMasiva`)

**R12.** CUANDO una carga masiva por sesión persiste al menos una orden, el sistema DEBE
registrar exactamente UNA fila en `carga` para esa sesión de carga y asociar TODAS las
órdenes creadas en esa sesión a esa misma fila (`orden.carga_id`).

**R13.** CUANDO la sesión de carga se envía en varios lotes HTTP (chunks) portando el mismo
identificador de lote, el sistema DEBE reutilizar la fila de `carga` ya existente en lugar
de crear una nueva (idempotencia por identificador de lote).

**R14.** CUANDO una carga masiva se ejecuta en modo `dryRun` (validación previa), el sistema
NO DEBE crear ninguna fila en `carga` ni escribir `carga_id` en ninguna orden.

**R15.** SI un lote HTTP no persiste ninguna orden (todas sus filas resultaron duplicadas o
con error), ENTONCES el sistema NO DEBE crear la fila de `carga` a causa de ese lote.

**R16.** SI el identificador de lote recibido no cumple el formato UUID, ENTONCES el sistema
DEBE rechazar la petición con error de validación (HTTP 400) sin crear órdenes ni lote.

**R17.** SI el identificador de lote recibido corresponde a una fila de `carga` cuyo
`usuario_carga` es distinto del actor autenticado, ENTONCES el sistema DEBE rechazar la
petición como prohibida (HTTP 403) sin crear ninguna orden ni modificar el lote existente.

**R18.** CUANDO se crea la fila de `carga` por la vía sesión, el sistema DEBE fijar
`total_files` al total de filas de la SESIÓN de carga declarado por el cliente (la suma de
todos los chunks), y NO al número de filas del chunk que creó la fila; los chunks
posteriores de la misma sesión NO DEBEN acumular, sobrescribir ni recalcular `total_files`.

## 3. Creación del lote — vía API key (`cargarViaApi`)

**R19.** CUANDO una carga por API key persiste al menos una orden, el sistema DEBE registrar
exactamente UNA fila en `carga` por petición y asociar todas las órdenes creadas en esa
petición a esa fila.

**R20.** CUANDO se crea una fila de `carga` por la vía API key, el sistema DEBE fijar
`usuario_carga` al usuario dedicado de la API key autenticada (el mismo actor que ya queda
como `orden.tienda_id` y como actor del historial de estados).

**R21.** CUANDO se crea una fila de `carga` por la vía API key, el sistema DEBE fijar
`total_files` a la cantidad de objetos del array recibido en el payload de la petición (las
filas del lote), y NO al tamaño de los batches internos de persistencia.

**R22.** SI una carga por API key no persiste ninguna orden, ENTONCES el sistema NO DEBE
crear fila alguna en `carga`.

## 4. Transaccionalidad e invariantes

**R23.** CUANDO el sistema persiste un bloque de órdenes de un lote, DEBE asegurar la fila de
`carga` y escribir el `carga_id` de esas órdenes dentro de la MISMA transacción, de forma
que un fallo en cualquiera de las dos operaciones no deje ni órdenes sin lote ni lote sin
órdenes de ese bloque.

**R24.** MIENTRAS exista una fila en `carga`, el sistema DEBE garantizar que al menos una
orden la referencia (no se crean lotes huérfanos).

**R25.** El sistema DEBE asignar el mismo `carga_id` a todas las órdenes efectivamente
creadas dentro de un mismo lote, y NO DEBE modificar el `carga_id` de órdenes preexistentes
(las filas duplicadas que la carga salta conservan el `carga_id` que ya tuvieran, incluido NULL).

**R26.** CUANDO se crea una orden por el alta manual individual (fuera de la carga masiva),
el sistema DEBE dejar `carga_id` en NULL y NO DEBE crear fila alguna en `carga`.

## 5. Contratos expuestos

**R27.** CUANDO una carga masiva por sesión termina, la respuesta DEBE incluir el
identificador del lote creado, o `null` si no se creó ninguno (dry-run o cero órdenes).

**R28.** CUANDO una carga por API key termina con éxito, la respuesta DEBE incluir el
identificador del lote creado, o `null` si no se creó ninguno, preservando todos los campos
que ya devolvía el endpoint (incluido `etiquetasPdf`).

**R29.** El sistema DEBE dejar `carga.download_url` y `orden.download_url` en NULL en todos
los caminos de esta feature (ninguna ruta de esta feature les escribe valor).

**R30.** El sistema DEBE preservar las reglas de autorización vigentes de ambos caminos: la
vía sesión sigue exigiendo rol `adminTienda` y la vía API key sigue exigiendo rol `apiKey`;
esta feature no relaja ni amplía ningún permiso.

---

## Decisiones cerradas del gate F1.4

Las seis dudas abiertas del primer borrador quedaron RESUELTAS por el humano. No se
reabren; los requisitos de arriba ya las reflejan.

1. **Nombre de la tabla: `carga` (SINGULAR)**, respetando la convención del repo
   (`orden`, `usuario`, `plantilla_mensaje`). Modelo Prisma `Carga` con `@@map("carga")`.
   La columna de `orden` conserva el nombre `carga_id`. (R1–R4, R9, R10)
2. **`total_files` = tamaño TOTAL del lote.** Vía API key: cantidad de objetos del array del
   payload (R21). Vía sesión: total de filas de la sesión declarado por el cliente, nunca el
   del chunk, y sin acumularse entre chunks (R7, R18).
3. **FK `orden.carga_id` con `ON DELETE RESTRICT`** (confirmada la propuesta del diseño):
   un lote con órdenes no puede borrarse. (R4, R10)
4. **`download_url` queda NULL en toda esta feature**, en `carga` y en `orden`. Las columnas
   se crean y nadie las escribe; ninguna integración con la feature 136 dentro de este
   alcance (solo se documenta como punto de integración futuro). (R5, R6, R29)
5. **Alcance = solo persistir y devolver `carga_id`.** Sin UI, sin listado ni filtro por
   lote. (R27, R28)
6. **Siguen vigentes D1–D7** tal como se enuncian arriba, con D4 precisada por el punto 2.
