# Feature 274 — Cobro por zona + tienda: cascada de resolución de tarifa

**Zona:** backend (dinero) · **Rama:** `feature/274-cascada-tarifa-zona-tienda` · **Depende de:** 273 (ya en `dev`)

## Contexto verificado contra la rama (no de memoria)

Lo que la 273 YA dejó en `db/schema.prisma` y que esta feature **no vuelve a migrar**:

- `tarifas.tienda_id` nullable (`schema.prisma:1169`), `tarifas.zona_id` nullable (`:1172`),
  `tarifas.is_default` (`:1175`), borrado **físico** (ya no hay `deleted_at`),
  `@@unique([zonaId, tiendaId])` creado a mano en SQL con `NULLS NOT DISTINCT` (`:1193`).
- `orden.zona_id` es **NOT NULL** (`schema.prisma:501`) y `orden.tienda_id` también (`:500`).
- Lo que la 273 **no** tocó, y es el motivo de esta ficha: `TarifaVigentePorTiendaRepository`
  sigue resolviendo con `where: { tiendaId }` + `orderBy createdAt desc`.

Superficies que hoy resuelven tarifa, comprobadas una por una:

| superficie | hoy | qué hace hoy sin tarifa | qué hace tras la 274 |
| --- | --- | --- | --- |
| `OrdenRepository` (listado y `findListItemsByIds`) | include `tienda.tarifasTienda { where: { status: "activo" }, take: 1 }` | `fleteConIva`/`comisionConIva` = `"0.00"`, `relaciones.tienda.tarifa` = `null` | **igual: `"0.00"`** |
| `CierreDiaRepository.crearCierre` | `resolveTarifasPorTiendas(tx, tiendaIds)` | 9 columnas del snapshot en NULL, el cierre se crea igual | **igual: NULL y el cierre se crea** |
| `BulkOrdenService` (carga vía API) | `resolveTarifaPorTienda(tiendaId)`, **una por lote** | `costoEnvio: "0.00"` | **cambia: fila en `error`, o `409` si ninguna resuelve** |
| `CotizacionOrdenService` | `resolveTarifaCotizablePorTienda(tiendaId)`, **una por petición** | `{ status: "sin_tarifa" }` → `409` en `app/api/ordenes/api-key/cotizacion/route.ts:141` | **cambia: fila en `error`, o `409` si ninguna resuelve** |

> **Corrección de un dato de la ficha, ya resuelta.** La `description` de la 274 afirma que hoy
> devuelven `409 sin_tarifa` «la cotización por API key **y la carga masiva por API**». En la
> rama, el único `sin_tarifa` de producción está en la ruta de cotización; la carga vía API
> degrada a `costoEnvio: "0.00"` (gap D1/R8 de la feature 98). El humano decidió el 2026-08-24
> que la carga vía API **pase también a `409`**: no es una descripción de lo existente, es un
> **cambio de contrato de una API pública** y esta ficha lo trata como tal (R29, R31 y la tarea
> de aviso a integradores en `tasks.md`).

### Tres superficies, dos comportamientos ante la misma ausencia

Tras esta feature conviven **dos respuestas distintas** al mismo hecho («no hay tarifa para el
par tienda-zona»), y la asimetría es deliberada (R39):

- **Listado y cierre de día liquidan `0.00` / NULL y no bloquean.** Son superficies internas:
  el operador tiene que poder ver el tablero y cerrar el día aunque falte configurar una zona.
  Un bloqueo aquí convierte un dato faltante en una parálisis operativa, y el hueco es visible
  en pantalla para quien puede arreglarlo.
- **Las dos APIs por key responden `409` cuando el lote entero se queda sin tarifa.** Son
  contratos con un tercero que va a actuar sobre la cifra —facturar, mostrar un precio al
  comprador final, conciliar—. Un `"0.00"` emitido hacia fuera no se lee como «falta un dato»
  sino como «el envío es gratis», y esa afirmación sale del sistema sin nadie que la revise.

**Coste declarado de esa asimetría:** el mismo hueco de configuración se ve de dos formas según
por dónde se mire, y quien depure un caso tendrá que saber por cuál de las dos superficies
entró. Es el precio de no bloquear la operación interna y de no mentir hacia fuera a la vez.

---

## Requisitos

### La cascada (el punto de decisión)

**R1.** El sistema DEBE resolver la tarifa de una orden a partir del par
`(tiendaId, zonaId)` de esa orden, eligiendo la primera fila de `tarifas` que exista según
este orden de prioridad: (1) `tienda_id = T AND zona_id = Z`; (2) `tienda_id = T AND
zona_id IS NULL`; (3) `tienda_id IS NULL AND zona_id = Z`.

**R2.** SI ninguno de los tres niveles de R1 tiene fila, ENTONCES el sistema DEBE resolver
`null` («sin tarifa»), y NO DEBE considerar la fila `(tienda_id IS NULL AND zona_id IS NULL)`
como un cuarto nivel.

**R3.** CUANDO existen a la vez una fila de nivel 1 y una de nivel 2 para el mismo par, el
sistema DEBE resolver la de nivel 1, **con independencia de cuál se creó después**.

**R4.** CUANDO una tienda no tiene ninguna fila propia (ni de nivel 1 ni de nivel 2) y existe
una fila con `tienda_id IS NULL AND zona_id = Z`, el sistema DEBE resolver esa fila para las
órdenes de esa tienda en la zona `Z`.

**R5.** El sistema NO DEBE usar la fecha de creación como criterio de selección entre
candidatas: la resolución DEBE dar el mismo resultado sea cual sea el orden en que la base
devuelva las filas candidatas.

**R6.** SI el par a resolver llega con `zonaId` nulo o desconocido, ENTONCES el sistema DEBE
considerar únicamente el nivel 2 (`tienda_id = T AND zona_id IS NULL`) y, si no existe,
resolver `null`.

**R7.** El sistema DEBE ofrecer una resolución en lote que, dados N pares
`(tiendaId, zonaId)`, devuelva la fila resuelta de cada par **con una sola consulta a la base**
(sin N+1), incluyendo en el resultado una entrada por cada par pedido (`null` cuando no
resuelve).

**R8.** El sistema DEBE resolver la tarifa con **una única regla** compartida por todas las
superficies: liquidación, listado, carga vía API y cotización DEBEN obtener la misma fila para
el mismo par `(tienda, zona)` en el mismo instante.

### Eliminación de `tarifas.status`

**R9.** Tras aplicar la migración de esta feature, la base NO DEBE tener la columna
`tarifas.status` ni el tipo `estado_tarifa`.

**R10.** CUANDO se aplica el `down.sql` de esa migración, el sistema DEBE restaurar el tipo
`estado_tarifa` y la columna `tarifas.status NOT NULL DEFAULT 'activo'`.

**R11.** El sistema NO DEBE aceptar `status` como campo de entrada al actualizar una tarifa:
CUANDO una petición de actualización incluye `status`, el sistema DEBE responder
`validation_error`.

**R12.** El sistema NO DEBE exponer `status` en el DTO de tarifa (`TarifaDTO`), ni en la tarifa
anidada que el listado de órdenes devuelve en `relaciones.tienda.tarifa`.

**R13.** El sistema NO DEBE conservar operaciones que dependan de `status` (en particular, la
inactivación masiva de las tarifas de una tienda, `inactivarPorTienda`).

### Prohibición de la fila global

**R14.** CUANDO se solicita **crear** una tarifa con `tiendaId` ausente o nulo **y** `zonaId`
ausente o nulo, el sistema DEBE responder `validation_error` y NO DEBE persistir la fila.

**R15.** CUANDO se solicita **actualizar** una tarifa y el par resultante de aplicar los campos
provistos sobre la fila existente queda con `tienda_id` nulo **y** `zona_id` nulo, el sistema
DEBE responder `validation_error` y NO DEBE aplicar la actualización.

**R16.** SI el par resultante acota al menos una de las dos dimensiones, ENTONCES el sistema
DEBE permitir la creación o la actualización (la prohibición de R14/R15 no DEBE bloquear
tarifas de tienda sin zona, ni de zona sin tienda).

### Nombre del resolver

**R17.** El árbol NO DEBE conservar los identificadores `TarifaVigentePorTiendaRepository` ni
`ITarifaVigentePorTiendaRepository` (ni sus archivos): el resolver DEBE llamarse
`TarifaVigenteRepository` / `ITarifaVigenteRepository`, porque ya no resuelve «por tienda».

### Listado de órdenes

**R18.** El sistema DEBE resolver la tarifa que muestra el listado de órdenes con la cascada de
R1, usando el par `(tienda, zona)` **de cada fila del listado**.

**R19.** El listado DEBE resolver las tarifas de una página con **una consulta adicional como
máximo**, con independencia del número de filas de la página.

**R20.** SI una orden del listado no resuelve tarifa, ENTONCES el sistema DEBE devolver
`relaciones.tienda.tarifa = null` y los importes derivados en `"0.00"`, sin error y sin
bloquear el listado.

**R21.** El sistema DEBE resolver, para una misma orden, **la misma fila de tarifa** en el
listado y en la liquidación del cierre de día.

### Cierre de día

**R22.** CUANDO se crea un cierre de día, el sistema DEBE congelar en `cierre_detail` la fila
de tarifa resuelta por la cascada de R1 para el par `(tienda, zona)` **de cada orden**,
resolviéndolas dentro de la misma transacción y con una sola consulta (R7).

**R23.** SI una orden del cierre no resuelve tarifa, ENTONCES el sistema DEBE dejar en NULL las
columnas de tarifa del snapshot y crear el cierre igual (el gap no bloquea).

**R24.** El sistema NO DEBE cambiar la forma del snapshot de `cierre_detail` (columnas
congeladas, `tarifa_id`, `fulfillment`) ni la aritmética de `lib/utils/ingreso-ordenex.ts`.

### Carga vía API (cambio de contrato de una API pública)

**R25.** CUANDO se cargan órdenes por la API, el sistema DEBE calcular el `costoEnvio` de cada
orden creada con la tarifa resuelta para el par `(tienda de la key, zona del distrito de esa
orden)`, y no con una única tarifa por lote.

**R26.** La carga vía API DEBE resolver las tarifas del lote con una sola consulta (R7).

**R27.** CUANDO al menos una fila del lote que llega a la resolución de tarifa la resuelve, el
sistema DEBE responder `200` y crear esas filas con su `costoEnvio` calculado.

**R28.** SI una fila del lote no resuelve tarifa **y** al menos otra fila del mismo lote sí la
resuelve, ENTONCES el sistema DEBE devolver esa fila con `resultado: "error"` y su mensaje de
error de fila (R38), NO DEBE crear la orden de esa fila y NO DEBE emitir para ella ningún
`costoEnvio` —tampoco `"0.00"`—.

**R29.** SI ninguna de las filas del lote que llegan a la resolución de tarifa la resuelve,
ENTONCES el sistema DEBE responder `409` con un mensaje fijo, y NO DEBE crear ninguna orden ni
ninguna fila de `carga` para esa petición.

**R30.** SI ninguna fila del lote llega a la resolución de tarifa (todas fallan por validación,
duplicidad o cobertura geográfica), ENTONCES el sistema DEBE responder `200` con esas filas en
su resultado actual y NO DEBE responder `409`: la tarifa no es el motivo del fallo.

**R31.** El sistema NO DEBE devolver `costoEnvio: "0.00"` como consecuencia de la ausencia de
tarifa, y DEBE declarar el nuevo `409` de la carga —y la retirada de ese `"0.00"`— en el
contrato publicado (`lib/api/openapi-spec.ts` y su espejo `docs/api/api-key-openapi.yaml`).

### Cotización por API key

**R32.** CUANDO se cotiza un lote, el sistema DEBE resolver la tarifa **por fila**, con la zona
del distrito resuelto para esa fila, y DEBE hacerlo con una sola consulta de tarifas por
petición (R7).

**R33.** CUANDO todas las filas cotizables del lote resuelven tarifa, el sistema DEBE responder
`200` con los costos de cada una y sin ninguna fila en error por motivo de tarifa.

**R34.** SI algunas filas cotizables resuelven tarifa y otras no, ENTONCES el sistema DEBE
responder `200`, cotizar normalmente las que resuelven, y devolver las que no como
`resultado: "error"` con su mensaje de error de fila (R38), **sin bloque `costos`**, contadas
en `conError` y en `totales.filasExcluidas`.

**R35.** SI ninguna de las filas que llegan a la resolución de tarifa la resuelve, ENTONCES el
sistema DEBE responder `409` con el mensaje fijo ya existente (`MSG_COTIZACION_SIN_TARIFA`) y
NO DEBE emitir ningún importe —ni siquiera cero— en esa respuesta.

**R36.** SI ninguna fila del lote llega a la resolución de tarifa (todas sin cobertura o sin
validar), ENTONCES el sistema DEBE responder `200` con el bloque `totales` en cero y
`filasSumadas: 0`, como hoy, y NO DEBE responder `409`.

**R37.** MIENTRAS no exista `tarifas.status`, la cotización DEBE resolver con la **misma** regla
que la liquidación (el resolver de cotización se colapsa en el único resolver).

### Errores de fila (común a las dos APIs)

**R38.** CUANDO una fila de cualquiera de las dos APIs por key queda sin tarifa en un lote donde
otra fila sí resuelve, el sistema DEBE reportarlo **por el mecanismo de errores por fila que ya
existe** —el campo `errores: Record<string, string[]>` dentro del objeto de la fila, con
`resultado: "error"`—, con la misma clave y el mismo mensaje en ambas APIs, y NO DEBE introducir
un campo, un código ni una estructura de error paralelos.

### Asimetría declarada entre superficies

**R39.** El sistema DEBE conservar el comportamiento no bloqueante de las superficies internas
ante la ausencia de tarifa: el listado DEBE seguir devolviendo `"0.00"` (R20) y el cierre de día
DEBE seguir creándose con las columnas de tarifa en NULL (R23). El `409` de R29 y R35 DEBE
aplicarse **únicamente** a los dos bordes de API por key.

### Alcance declarado

**R40.** El sistema NO DEBE introducir lecturas de `tarifas.tarifa_especial` ni de
`distrito.zona_especial` en la aritmética de dinero: siguen fuera de alcance.

---

## Trazabilidad exigida (mapa `R<n> → test`)

El implementer completa el mapa en `progress/impl_274.md`; el reviewer rechaza si falta uno.
Casos que **no pueden faltar** (`tasks.md` los desarrolla):

| R | test que lo cubre (ubicación prevista) |
| --- | --- |
| R1–R6 | `tests/unit/utils/cascada-tarifa.test.ts` (un caso por nivel + par sin zona) |
| R3 | caso explícito: nivel 2 **más reciente** que el nivel 1 y aun así gana el nivel 1 |
| R4 | caso explícito: tarifa con `tienda_id` NULL cobrada a una tienda sin tarifa propia |
| R5 | mismo conjunto de filas devuelto en orden invertido → misma resolución |
| R7 | assert sobre el nº de llamadas a Prisma (=1) y sobre el `where` exacto |
| R8, R21 | test que resuelve la misma orden por el camino del listado y por el del cierre y compara la fila |
| R9, R10 | `tests/integration/db/drop-tarifa-status-migration.test.ts` (Postgres real, esquema desechable) |
| R11, R12, R14, R15, R16 | `tests/unit/types/tarifa-schemas.test.ts`, `tests/unit/services/tarifa-service.test.ts`, `tests/integration/actions/tarifas-action.test.ts` |
| R13 | ausencia de `inactivarPorTienda` en la interfaz + guardia de que `status` no aparece en `lib/`/`app/` |
| R17 | guardia `tests/guards/tarifa-status-retirado.guard.test.ts` (segundo diente): ningún archivo de `lib/`, `app/` ni `tests/` menciona `TarifaVigentePorTienda` |
| R18–R20 | `tests/unit/repositories/orden-repository.test.ts` |
| R22–R24 | `tests/unit/repositories/cierre-dia-repository.test.ts`, `tests/integration/db/cierre-detail-congelado.test.ts` |
| R25–R31 | `tests/unit/services/bulk-orden-service.carga-api.test.ts`, `tests/integration/carga-api-key-sin-tarifa.test.ts`, `tests/unit/api/openapi-carga-409-sin-tarifa.test.ts` |
| R32–R37 | `tests/unit/services/cotizacion-orden-service.test.ts`, `tests/integration/cotizacion-api-key.test.ts` |
| R38 | test compartido: el objeto de fila de las dos APIs lleva la **misma** clave y el **mismo** literal (comparado contra la constante única, no re-escrito) |
| R39 | test que, con el MISMO estado de `tarifas`, obtiene `"0.00"` por el listado, NULL por el cierre y `409` por las dos APIs |
| R40 | test de ausencia: la aritmética no lee esas dos columnas |
