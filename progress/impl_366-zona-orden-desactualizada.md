# Ficha 366 — informe de implementación

**Rama:** `fix/366-zona-orden-desactualizada` · **Zona:** fullstack (backend → frontend, secuenciado)
· **Spec:** `specs/366-zona-orden-desactualizada/` (14 requisitos EARS, aprobado por el humano el
2026-09-03 con una enmienda en la puerta).

## Qué se arregla, y por qué no era cosmético

`orden.zona_id` se derivaba **una sola vez**, al crear la orden, desde la N:M `zona_distrito`, y no
volvía a mirarla nunca. Al mover un distrito de zona, las órdenes ya creadas se quedaban con la zona
vieja, y **no existía ninguna vía manual** de corregirlo: `CorregirDatosClienteService` solo
re-deriva la zona cuando provincia/cantón/distrito **cambian de valor**, y aquí el distrito nunca
cambia — cambia el mapa.

Y bloqueaba la operación, no era estético: `OrdenRepository.recibirEnSatelite` acota su guarda por el
`zonaId` **del actor**, así que la bodega de destino correcta **no podía recibir** esas órdenes. El
2026-09-03 había **42 órdenes represadas** (41 `en_ruta_bodega_satelite`, 1 `en_bodega_central`,
todas del par Tempisque → El Coco). El humano las desatascó a mano como precondición fuera de esta
ficha; esto es el arreglo estructural.

## El corte de elegibilidad (decisión humana, enmendada en la puerta)

> Se re-estampa la orden cuyo **futuro** decide la zona. No se toca la que lleva **dinero**.

Inelegible = borrada, **o** con fila en `cierre_detail`, **o** con gestión vigente (no anulada) cuyo
`resultado` sea `entregada`, `rechazada` o `incidente`. Una gestión vigente `reprogramada` o
`devuelta` **NO** bloquea, y es deliberado: las dos se rutean hacia adelante por la zona
(`LiberacionReprogramadaService:202` y `DevolucionSlaService:241`, ambas vía `resolverDestinoCierre`),
así que dejarlas con la zona vieja las liberaría a la bodega equivocada — el atasco original.

Medido en producción el 2026-09-03: **0 de 160** reprogramaciones y **0 de 158** devoluciones llevan
pago al mensajero o ingreso por rechazo; el dinero vive en `entregada` (349 de 349 con pago) y
`rechazada` (33 sin cierre todavía: ventana real). `incidente` se excluye **por prudencia y no por
evidencia** (0 casos hoy, pero es valor del enum, tiene columna `indemnizacion` y es terminal, así
que no hay ruteo futuro que arreglar).

## Archivos tocados

**Migración y esquema**
- `db/migrations/20260903120000_historial_accion_orden_zona_reconciliada/migration.sql` —
  `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'orden_zona_reconciliada'`, **sola**,
  sin backfill (Postgres no admite usar un valor recién añadido en su misma transacción).
- `.../down.sql` — recrea el tipo con los 42 valores previos, con la precondición documentada.
  **Ningún `down.sql` anterior se tocó** (son fotos históricas); verificado por el reviewer con
  `git diff --name-only origin/dev...HEAD -- db/`, que devuelve exactamente tres rutas.
- `db/schema.prisma` — el valor nuevo con su docstring.

**Dominio**
- `lib/repositories/_shared/zona-colapso.ts` *(nuevo)* — el colapso de la N:M, extraído para que
  no existan dos copias de la regla que un día facturen distinto.
- `lib/repositories/OrdenRepository.ts` — importa la función compartida; sus dos llamadas quedan
  igual. Ningún `expect` de test existente cambió.
- `lib/repositories/ZonaRepository.ts:195-345` — la reconciliación dentro de la transacción que ya
  existía. El corte vive en el `WHERE` (`:290-303`); el `UPDATE` toca **solo** `zonaId` (`:309`);
  una fila de historial por orden **alcanzada** (no por candidata), con un lote por guardado
  (`:317-330`).
- `lib/interfaces/repositories/IZonaRepository.ts:44` — `UpdateZonaResult`.
- `lib/types/historial-accion.ts` — el tipo nuevo en el catálogo, categoría `mueve_dinero`.
- `lib/services/ZonaService.ts:111-117`, `lib/interfaces/services/IZonaService.ts:31`,
  `lib/types/zona.ts:151` — el actor baja y el conteo sube.

**UI**
- `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx:243-269` (las dos ramas de la
  llamada) y `:434-446` (`mensajeGuardado`) — el toast del
  guardado. `>1` → «Zona actualizada (N órdenes reubicadas)»; `=1` → «(1 orden reubicada)»;
  `=0` → «Zona actualizada», idéntico al texto previo; al **crear**, nunca (el campo no existe en
  `CrearZonaResult`).

**Tests**
- `tests/integration/db/zona-reconciliacion-ordenes.test.ts` *(nuevo, 17 casos)* — el `WHERE` contra
  Postgres real.
- `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts` *(nuevo, 5)*.
- `tests/unit/guards/zona-reconciliacion-no-retarifa.guardia.test.ts` *(nuevo, 6)* — recorta el
  cuerpo real de `update` y exige que el `data` del `updateMany` sea exactamente `{ zonaId }`.
- `tests/components/CrearZonaFormReconciliacion.test.tsx` *(nuevo, 4)*.
- Actualizados: `zona-repository.test.ts`, `zona-service.test.ts`, `zonas-action.test.ts`,
  `catalogo-y-choke-point.test.ts` (42→43 tipos, dinero 25→26),
  `historial-accion-escrituras-cubiertas.guardia.test.ts` (censo: `ZonaRepository#update`),
  `historial-acciones-filtros-def.test.ts`,
  `historial-accion-sin-datos-cliente.guardia.test.ts` (solo comentarios).

## Trazabilidad R → test

| Requisito | Test que lo prueba |
| --- | --- |
| R1 | T5 caso base (una sola llamada, sin paso intermedio) + component test de T7 |
| R2 | T5 caso base |
| R3 | T5 casos «0 zonas» y «>1 zonas» |
| R4 | T5 caso base |
| R5 | T5 casos «unión antes/después» y «distrito recién quitado» |
| R6 | T5 casos «ya facturada», `entregada`/`rechazada`/`incidente` NO elegibles, `reprogramada`/`devuelta` SÍ elegibles, «gestión anulada SÍ elegible», «orden borrada» |
| R7 | T5 «ya facturada» y las tres NO elegibles (además: sin fila de historial) |
| R8 | T5 «inmutabilidad de `cierre_detail`» (fila comparada antes/después) |
| R9 | T5 «nada más cambia» + la guardia de `zona-reconciliacion-no-retarifa` |
| R10 | `zona-repository.test.ts:504` («una fila por orden, todas con el mismo `lote_id`») + los unit de `ZonaService`. **No** el caso base de integración: ése no comprueba el «quién guardó» ni el `monto` |
| R11 | T5 mismo lote dentro de un guardado **y** lotes distintos entre guardados |
| R12 | unit de `ZonaRepository` (cuenta lo tocado) + unit de `ZonaService` (lo reenvía) |
| R13 | T5 «`create()` no reconcilia» — **reescrito** (`ae035eca`): la primera versión era VACÍA (dejaba el distrito en dos zonas, así que el colapso daba `null` y la aserción se cumplía aunque `create()` reconciliara). Ahora el distrito resuelve exactamente la zona nueva, y una mutación que hace reconciliar a `create()` lo pone en rojo |
| R14 | T5 «idempotencia» (segunda llamada ⇒ 0) |

El reviewer verificó este mapa de forma independiente: **14 de 14 acaban en un test que los ejercita
de verdad**.

## Verificación ejecutada

- **Gate completo (`./init.sh`) en la rama con `origin/dev` incorporado: `INIT_EXIT=0`** —
  `Test Files 1618 passed | 78 skipped (1696)`, `Tests 23268 passed | 902 skipped (24170)`,
  «sin rojos nuevos», `== init OK ==`.
- ⚠️ **Ese verde no medía la base, y hay que decirlo.** El worktree no tenía `.env`, y sin
  `DATABASE_URL` los bloques que piden base se saltan — **saltado no es fallado**, así que el arnés
  cantó OK. De los 78 archivos saltados, **61 son de `tests/integration/db/`** (reproducido: ese
  directorio sin `DATABASE_URL` da `122 passed | 61 skipped (183)`, o sea que **no** se salta
  entero) y **los otros 17 son suites de fuera de ese directorio que también tocan base**
  (`tests/integration/repositories/*.int.test.ts`, `tablero-dia-*`, `analitica-financiera-action`…).
  Entre los saltados estaba `zona-reconciliacion-ordenes.test.ts` con sus 17 tests. Completado a
  mano con `.env`: `tests/integration/db/` da **183 archivos / 2196 tests en verde**, y el archivo
  clave corrido aislado da **17 passed (17), 0 skipped**. El reviewer llegó al mismo hallazgo por su
  cuenta y midió el reparto 61/17 que corrige la primera redacción de este informe.
- **10 mutaciones sobre el backend, las 10 rojas** — es lo que da valor a los tests de arriba:

  | Mutación | Qué se puso rojo |
  | --- | --- |
  | quitar `"incidente"` de la lista | el caso de gestión `incidente` |
  | quitar el `resultado: { in: [...] }` entero | `reprogramada` **y** `devuelta` |
  | quitar `anuladaAt: null` | gestión anulada pasaba a elegible |
  | quitar `cierreDetalles: { none: {} }` | la ya facturada |
  | quitar `zonaId: { not: ... }` | idempotencia |
  | unión → solo la lista final | el distrito recién quitado |
  | quitar `deletedAt: null` | la orden borrada |
  | `data: { zonaId, montoCobrar }` | «nada más cambia» **y** la guardia de T8 |
  | `loteId` constante | dos guardados, dos lotes |
  | dejar el valor nuevo en el `down.sql` | el test de la migración |

- **El `down.sql` se ejecutó contra Postgres real** dentro de una transacción revertida: 43 valores
  → 42 sin el nuevo → `ROLLBACK`, base intacta. No se leyó: se corrió.
- **2 mutaciones sobre el frontend, las 2 rojas** (quitar el conteo del mensaje; pintarlo también
  con `0`).
- **Composition root verificado**: `lib/actions/zonas.ts:131` es el único llamador y sí pasa el actor
  de sesión; una sola implementación de `IZonaRepository`.

## Notas de entorno (no del código)

- La primera corrida del gate del backend dio 23 rojos y **16 eran del `node_modules` compartido**:
  otra sesión corrió `prisma generate` a mitad y el cliente quedó sin el valor nuevo del enum. Se
  resolvió regenerando desde el `db/schema.prisma` propio. Los otros 5 fueron timeouts de 20 s bajo
  carga, verdes en la segunda.
- La migración de este enum **pone rojo el gate de otras ramas** hasta que esta se mergee, porque los
  tests que comparan el enum de la base contra una lista literal ven un valor que su rama no declara.
  Es el efecto conocido y esperado.
- `dev` se movió durante la implementación (la ficha 368 de otra sesión, PR #686). Se incorporó con
  `git merge origin/dev` — sin conflictos salvo `feature_list.json`, resuelto tomando `dev`.

## Fuera de alcance (declarado)

- El desatasco de las 42 órdenes existentes: escritura medida contra producción, hecha aparte.
- `ZonaRepository.create` **no** reconcilia (R13), por decisión del design.

## Riesgo aceptado (design §8) — no queda cubierto por esta ficha

Una orden cuyo distrito quede **ambiguo** (0 o >1 zonas) o que sea **inelegible** por el corte
—ya facturada, o con gestión vigente `entregada`/`rechazada`/`incidente`— **se queda con la zona
vieja, y hoy sigue sin haber ninguna vía manual para corregirla**. La automatización no puede
resolverlo sola sin romper la garantía de no re-tarifar hacia atrás. Si esa deriva residual llega a
doler, hace falta ficha aparte: el propio spec lo dejó fuera de alcance a propósito, y el conteo que
el guardado informa **no** incluye esas órdenes (fue la pregunta Q2 del spec, cerrada por el humano
sin añadir ese segundo conteo).

El otro efecto declarado en §8: re-estampar una orden `en_ruta_bodega_satelite` **la mueve de bandeja
de bodega mientras el paquete viaja**. Es el comportamiento buscado —así es como se desatasca—, pero
el operador verá la orden aparecer en otra bodega sin haberla movido él.
