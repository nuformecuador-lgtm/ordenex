# Ficha 373 — Eliminar una API key · implementación

Rama `feat/373-eliminar-api-key`. Zona `fullstack`, SDD. Cerrada el 2026-09-04.

## Qué se construyó

Un botón **Eliminar** en `Configuración > API` que borra **físicamente** una API key: su fila,
su cuenta dedicada sintética y su suscripción de webhook, en una sola transacción, dejando una
acción `api_key_eliminada` en el historial. El botón solo se habilita cuando el **servidor**
marca la key como `eliminable`; cuando no, sale apagado **diciendo por qué**.

## Las cuatro decisiones del humano (2026-09-04)

1. **La key debe estar `inactiva`** para poder eliminarse. Es la decisión que más protege: el
   guard bloquea por DATOS, pero una key recién creada y en uso tiene 0 órdenes y sería borrable,
   dejando al integrador fuera sin aviso. Desactivar es reversible y se nota; borrar no.
2. **Sin teclear el identificador.** Confirmación destructiva simple, patrón de la ficha 332. El
   R31 original se tachó: con el paso previo de desactivar, la fricción ya basta.
3. **Una tarifa configurada BLOQUEA** el borrado en vez de irse en la transacción: su FK es
   `CASCADE` y desaparecería sin fila de auditoría.
4. **Precedencia de motivos**: órdenes > dinero > tarifas > activa. Los motivos de datos van
   antes que el de estado porque son terminales; al revés, una key activa con órdenes diría
   «desactívala» y después el botón seguiría apagado.

## Medición contra producción que justifica el alcance

El 2026-09-04, las dos keys de producción («API Nuform» activa, «Api Pruebas» activa) tenían
**0 órdenes, 0 tarifas, 0 movimientos de wallet y 0 pagos**. Con la decisión 1, hoy ninguna de las
dos sería borrable sin desactivarla antes — y eso es lo correcto.

## Lo que el spec daba por bueno y no lo era

- **La tabla se llama `tarifas`, no `tarifa`.** Postgres devolvió `42P01` en el primer test de
  integración. Corregido en el repositorio y anotado para que nadie lo «arregle» al revés.
- **`P2003` no llega nunca** con el adaptador `@prisma/adapter-pg`: el error viene como
  `DriverAdapterError` con `code: undefined` y `cause.code: "23001"`. Con la comprobación ingenua,
  la FK inesperada habría sido un **500** en vez de un rechazo limpio. De ahí nace
  `lib/repositories/_shared/prisma-fk.ts`, hermano de `prisma-unique.ts`.

## Tensión aceptada (R13)

Una key `activa` **y** con órdenes reporta motivo `activa` por el camino del borrado, mientras el
listado muestra `ordenes`. Solo es alcanzable por carrera —el botón ya sale deshabilitado— y el
texto que lee la persona sale siempre del listado. Se acepta en vez de meter una consulta extra en
un camino que ya corta antes.

## Verificación

| Qué | Resultado |
|---|---|
| Gate COMPLETO (obligatorio: toca `db/schema.prisma` y una migración) | `INIT_EXIT=0` leído **dentro** del log · 1719 archivos / 24.510 tests · 26 saltados (preexistentes de AnaliticaPage/Shell) · `.env` presente |
| Tests nuevos | 89 unitarios backend + 34 integración + 28 de pantalla |
| Trazabilidad `R1`–`R39` | los 39 con test real, verificados por el reviewer abriendo cada archivo |
| Mutaciones | 7 (backend) + 6 (frontend) + 4 (reviewer). **Una sobrevivió y se corrigió** |
| `down.sql` | **ejecutado**, no leído: sus 4 sentencias contra la base local en transacción revertida |

**La mutación que sobrevivió** es la lección de la ficha: `appendAccion(this.prisma, …)` escrito
DENTRO del `$transaction` escribe **fuera** de la transacción, y con un doble los dos clientes son
el mismo objeto, así que ningún test lo notaba. La guardia del punto único se reforzó para exigir
la `tx` en las dos formas de invocación, y ahora protege las 45 acciones del catálogo.

## Verificación en pantalla (H3)

Conducida con Playwright sobre la app real, con tres keys sembradas para ver los tres estados:

| Key | Estado | Botón |
|---|---|---|
| Prueba Borrable (inactiva, sin datos) | **habilitado** | — |
| Prueba Tienda (activa, limpia) | deshabilitado | «Está activa. Desactívala antes de eliminarla.» |
| Prueba Manual (inactiva, con 2 órdenes) | deshabilitado | «Tiene órdenes a su nombre. No se puede eliminar.» |

La precedencia se confirma en pantalla: la que tiene órdenes dice `ordenes`, no `activa`. El
borrado real funcionó (3 botones → 2), con aviso de éxito y **cero errores de consola**. El modal
no pide teclear nada y enuncia la alternativa no destructiva.

**Defecto de maquetación encontrado al mirar, no por los tests:** a **1280 px** la tabla desborda
126 px y el botón «Eliminar» queda **fuera del área visible** (alcanzable solo desplazando en
horizontal); a 1440 y 1920 no desborda. Medido: el botón nuevo aporta ~82 px, así que sin él el
desbordamiento seguiría siendo de ~44 px — **la tabla ya desbordaba a 1280 antes de esta ficha**.
No se arregla aquí: excede el alcance y es del componente de tabla compartido.

## Rastro

`8b5e1187` ficha en curso · `e557d37c` backend · `287142bb` guardia de FKs · `56a2dbb7` pantalla.
Informe de revisión en `progress/review_373.md`.
