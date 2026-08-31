# Implementación — Feature 320 · la tienda retira por API sus órdenes no gestionadas

- **Rama:** `feat/320-api-eliminar-orden` · commit `b096451c`
- **Fecha:** 2026-08-28
- **Gate:** `./init.sh` **completo**, `INIT_EXIT=0`. 21.299 verdes / 26 skipped. Un archivo rojo, el
  del baseline (`superficie-de-uso` → `obtenerTarifa`, ficha 275). **Delta 0.**
  Sin migración: `deleted_at` ya existía.

## De dónde sale

Hueco medido el 2026-08-28: **entre que la tienda carga una orden y que el paquete llega a bodega
central, el integrador no tiene ninguna salida.** Cancelar exige `en_bodega_central` o
`en_ruta_bodega_central`, y borrar era exclusivo del `maestro`.

Es la **parte 2 de la ficha 319**, que arregló el criterio en la app; ésta lo lleva al canal API.

## Verbo y ruta: `DELETE /api/ordenes/api-key/orden/{id}`

**El primer `DELETE` de toda la API pública.** Va en el path que ya existe —mismo módulo, otro
verbo— y no en un sub-recurso `/eliminar`:

1. Retira literalmente el recurso que esa ruta identifica: tras el borrado, un `GET` a la **misma
   URL** devuelve 404. Ningún nombre de acción en el path dice eso mejor.
2. `cancelar` es un `PUT` a `/{numGuia}/cancelar` y **hace bien en serlo**: no retira nada,
   transiciona a `devolviendo_a_tienda` y la orden sigue viva. Acción que deja el recurso vivo →
   sub-recurso; acción que lo retira → `DELETE`.
3. El integrador no aprende URL nueva: es la que ya usa para consultar.
4. El motivo por el que la feature 177 eligió `POST` para `/generate` —un `GET` es pre-fetcheable
   por navegadores, crawlers y proxies— **no aplica**: `DELETE` no se pre-fetchea ni se cachea.

Códigos: **200** `{numGuia, numRemision, estado}` · **401** · **403** (key inactiva) · **404**
(inexistente, ya borrada o ajena) · **409** (estado no eliminable) · **422** (`{id}` inválido).

Sin `eliminada: true`: un campo constante que no habilita ninguna decisión. El canal ya retiró
`generado` el 2026-08-25 por ese mismo motivo.

## La identificación era el punto de la ficha

`{id}` acepta **guía o remisión**, reutilizando la resolución de la 177 (`idOrdenApiSchema` +
`ApiOrdenResolucionService`), sin escribir una segunda forma de resolver una orden.

**Por qué importa:** una orden con fulfillment nace en `en_preparacion` y **todavía no tiene guía**
justo cuando más falta hace poder retirarla. Identificar por `num_guia` la habría dejado inalcanzable
en toda esa ventana — que es exactamente el defecto que hoy tiene `cancelar`. `num_remision` es `NOT
NULL`, lo provee el propio integrador y es única por tienda entre las vivas. Cuando no hay guía, el
200 devuelve `"numGuia": null`.

## Frontera multi-tenant

Servicio propio (`ApiOrdenEliminacionService`). **El predicado de estado se comparte**
(`esEstadoEliminable`, fuente única de la 319 — éste es su tercer consumidor y se añadió a su
guardia); **la autorización no**: la de la app corta por rol `maestro` y no acota por tienda a
propósito, porque el maestro puede borrar cualquier orden.

El dueño va **dentro del `where` de las dos sentencias**:

- `findParaEliminacionApi(ordenId, ownerId)` → `where { id, tiendaId, deletedAt: null }`
- `softDeleteViaApi(...)` → `where { id, tiendaId, deletedAt: null, estatus.value IN estadosPermitidos }`

**Las cuatro claves en el mismo statement**, así que no hay ventana entre leer y escribir: ni por
dueño, ni por un borrado ajeno, ni por un cambio de estado. `count = 0` → 404. La lista de estados la
pasa el servicio; el repositorio aplica el filtro pero no lo decide, y una lista vacía no borra nada
(falla cerrado).

**Ajena, inexistente y ya borrada colapsan en el mismo 404, nunca 403**: la API no revela la
existencia de recursos de otro dueño, que es lo que su propia documentación promete.

La reversión parcial de la decisión firmada del 2026-08-27 —«borrar es solo del maestro»— queda
**escrita junto al código que la sostiene**, no escondida: en `EliminarOrdenService` al lado del
corte por rol, y en la interfaz del servicio nuevo.

## Mutaciones — cuatro, todas cazadas

| Mutación | Rojos |
| --- | --- |
| quitar `tiendaId` del `where` del UPDATE | **2** en 2 archivos — el unitario del repo y **el de Postgres real**, donde la tienda A borra la orden de la B |
| aceptar cualquier estado | **23** en 3 archivos |
| responder 403 en vez de 404 para una orden ajena | **3** |
| quitar el `DELETE` de la colección de Postman | **2** |

La última merece un apunte: **la documentación está protegida por tests**, no solo escrita.

## Documentación del canal — los cuatro artefactos

1. `lib/api/openapi-spec.ts` — operación `delete` y schema de respuesta; la portada del canal pasa a
   decir «crear, listar, consultar, **cancelar y eliminar** órdenes».
2. `docs/api/api-key-openapi.yaml` — espejo textual, mismos paths y mismo orden.
3. `docs/api/ordenex-api-key.postman_collection.json` — carpeta «10 · Eliminar una orden propia», con
   cuatro requests: por remisión, por guía, 404 y 409.
4. `docs/api/CHANGELOG.md` — entrada fechada, redactada como el aviso que se copia y se manda.

**Corrección al rastreo del leader:** el censo `PATHS_ESPERADOS` **no sube a once**, sigue en diez —
esta ficha estrena **verbo**, no path. El rojo que sí tocaba estaba en el mismo archivo:
`expect(Object.keys(operacion)).toEqual(["parameters", "get"])` pasa a incluir `"delete"`, subido a
propósito y con el motivo al lado.

## Deuda ajena encontrada y NO arreglada

- **Ficha 280, confirmada de primera mano:** el script de «2 · Carga › lote válido» de Postman lee
  `b.resultados`, pero la respuesta trae `filas`/`ordenes`, así que `{{numGuia}}` y `{{numRemision}}`
  nunca se rellenan. Los dos requests de camino feliz de esta ficha usan esas variables —igual que la
  carpeta 6, que ya vivía con lo mismo—, así que **hoy hay que pegar el valor a mano**.
- La cabecera de la colección sigue diciendo «Los 8 endpoints» cuando hay más, y la colección **no
  incluye `/analitica`**. Deuda previa, sin ficha propia.
