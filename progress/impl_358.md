# impl 358 — la tienda elimina sus órdenes por pantalla

Worktree `R:\wt\351`, rama `feature/358-tienda-borra-por-pantalla`. Backend + el cableado mínimo
de pantalla. **Sin commit** (lo hace el leader). **No se levantó dev server** (hay otro agente
compartiendo la carpeta de compilación).

## Lo que se decidió y por qué

El humano abrió el borrado por pantalla a la tienda, **acotado a lo suyo**. No es un permiso
nuevo: es la misma regla que la tienda ya tenía por API key desde la ficha 320 —mismo predicado
de estado, mismo dueño forzado dentro del `where`— con otra forma.

Lo reportado tenía **dos ausencias a la vez**, y hacían falta las dos para que apareciera la
casilla:

1. **Servidor**: `EliminarOrdenService` cortaba en `actor.rol !== "maestro"`, y `OrdenService`
   sólo anotaba `eliminable` para el `maestro`.
2. **Pantalla**: `selectable` colgaba de `accionesLote`, que el `adminTienda` no recibe. Sin esa
   prop la tabla se montaba **sin columna de casillas**, así que aunque `eliminable` hubiera
   viajado, «Eliminar» no tenía cómo alcanzar ninguna fila.

## Dónde se acota por dueño (la parte delicada)

**Dentro del `where` de la sentencia**, como ya hacía `softDeleteViaApi`:

`lib/repositories/OrdenRepository.ts` — `softDelete(params: { ids, ownerId })`:

```ts
where: {
  id: { in: [...params.ids] },
  deletedAt: null,
  ...(params.ownerId !== null ? { tiendaId: params.ownerId } : {}),
}
```

- `ownerId: string` → la orden tiene que ser de esa tienda. Una orden ajena colada en el lote no
  se toca y el conteo devuelto lo delata.
- `ownerId: null` → sin frontera. Sólo lo produce el `maestro`.
- El parámetro es **obligatorio y nullable a propósito**, no opcional con default: un olvido de
  cableado rompe el typecheck, no borra de más.

El service **también** comprueba pertenencia en el bucle de precarga, pero eso **no es la
frontera**: existe para poder devolver el motivo por orden y respetar el todo-o-nada. Está
medido: quitando ese `if`, la orden ajena **sigue sin borrarse** (0 filas) y lo único que se
pierde es el `conflict` (ver mutación 2).

Una orden ajena se rechaza con `MSG_ORDEN_NO_EXISTE`, el **mismo motivo que un id inventado**, y
el chequeo va **antes** que el de `deletedAt`: distinguirlos le confirmaría a una tienda que ese
id existe —y, si fuera después, hasta si la competencia la borró—. Es el criterio que la 320 ya
había escrito para el 404 uniforme del canal API.

## La autorización SÍ se unificó

Módulo nuevo `lib/services/alcance-borrado-orden.ts`, con **una sola copia** de «el dueño es
`actor.usuarioId`»:

```ts
resolverAlcanceBorradoOrden(actor):
  | { alcance: "denegado" }
  | { alcance: "todas" }                    // maestro
  | { alcance: "propias"; ownerId: string } // adminTienda | apiKey
```

Lo usan los **tres** consumidores: `EliminarOrdenService` (pantalla), `ApiOrdenEliminacionService`
(canal API) y `OrdenService.marcarEliminable` (¿ofrezco el botón?). Es el mismo patrón que
`esEstadoEliminable`, que ya centralizaba la otra mitad de la decisión desde la 319.

**El canal API no cambia de comportamiento**: para `apiKey` el dueño sigue siendo
`actor.usuarioId`; cualquier otro rol ya obtenía `not_found` (su `usuarioId` no es la `tienda_id`
de ninguna orden), y ahora se rechaza explícitamente con el mismo 404 uniforme. Lo que cambia es
de dónde sale la regla.

**Los dos servicios siguen existiendo**, pero ya no por la regla de dueño: por el grano (una
orden contra un lote), por los estados de salida (404/409 uniformes contra un `conflict` con
detalle por orden) y porque en el canal API el dueño es obligatorio (`string`, no `string | null`).
La cabecera de `IApiOrdenEliminacionService` decía lo contrario y **se corrigió en sitio** en vez
de borrarla, porque explica por qué son dos.

## Lo que NO se tocó

- Los cuatro estados eliminables (`ESTADOS_ELIMINABLES`, ficha 319): intactos y con su fuente única.
- El todo-o-nada por lote.
- El `maestro` sigue borrando cualquier orden (`ownerId: null`).
- El `admin` sigue **sin** poder borrar (estrechamiento del 2026-08-27).
- **Decisión declarada**: a `softDelete` **no** se le pasó la lista de estados en el `where`, a
  diferencia de `softDeleteViaApi`. Allí el lote es de una orden (0 ó 1); aquí es de N, y filtrar
  por estado podría borrar N-1 y dejar una fuera — un borrado **parcial**, que es justo lo que el
  todo-o-nada existe para impedir. La carrera queda declarada en el contrato (`eliminadas` puede
  ser menor que el lote), no tapada. Es el comportamiento previo, sin cambio.
- `restore` **no** recibe `ownerId`: recuperar sigue siendo del `maestro`. Queda escrito en su
  docstring que el día que se le abra a la tienda lo necesita igual que su gemelo.

## Archivos

### Creados
- `lib/services/alcance-borrado-orden.ts` — la regla de dueño, única copia.
- `tests/unit/services/alcance-borrado-orden.test.ts`
- `tests/integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts` — **contra Postgres**.

### Modificados (backend)
- `lib/interfaces/repositories/IOrdenRepository.ts` — firma de `softDelete`; corregidas las
  afirmaciones «sin frontera de tienda» y «el único acotado por tienda», ya falsas.
- `lib/repositories/OrdenRepository.ts` — `tiendaId` en el `where` de `softDelete`; docstring de
  `restore` corregida.
- `lib/services/EliminarOrdenService.ts` — alcance compartido, pertenencia en la precarga,
  `ownerId` al repositorio.
- `lib/services/ApiOrdenEliminacionService.ts` — deriva el dueño del módulo compartido.
- `lib/services/OrdenService.ts` — `marcarEliminable` para maestro **y** tienda, con pertenencia.
- `lib/interfaces/services/IApiOrdenEliminacionService.ts` — cabecera corregida.

### Modificados (pantalla, mínimo)
- `app/(app)/ordenes/page.tsx` — `puedeEliminar = maestro || adminTienda`; prop nueva
  `puedeVerEliminadas = maestro`.
- `app/(app)/ordenes/_components/OrdenesListado.tsx`:
  - prop `puedeVerEliminadas` — el interruptor «Eliminadas» y «Recuperar» siguen siendo del
    `maestro`. Sin partir la prop, la tienda habría recibido un interruptor que el servidor
    rechaza con `forbidden`.
  - `haySeleccion = accionesLote || puedeEliminar` para `selectable`/`bloqueoSeleccion`/`acciones`.
  - guarda `if (!accionesLote) return [];` al inicio de `accionesDe` — sin ella, la tienda vería
    «Asignar mensajero», «Generar guía» y compañía al marcar una fila.
  - `EliminarOrdenModal` sale del bloque de `accionesLote` y se monta con `haySeleccion` — si no,
    la tienda vería el botón y al pulsarlo no se abriría nada (fallo mudo).

## Mapa requisito → test

| R | Qué | Test |
|---|---|---|
| R1 | La tienda borra las suyas | `eliminar-orden-pantalla-frontera-tienda.test.ts` «R1»; `eliminar-orden-service.test.ts` «la tienda dueña borra su orden…» |
| **R2** | **La tienda A NO borra la de la B; el recorte va en el `where`** | `eliminar-orden-pantalla-frontera-tienda.test.ts` «⭑ R2» (conteo real de filas + fila viva, atacando el `where` directamente) |
| R2b | El estado sigue filtrando para la tienda | mismo archivo, «R2b» |
| R3 | El maestro sigue borrando cualquiera | mismo archivo, «R3»; `eliminar-orden-service.test.ts` «el maestro NO queda acotado…» |
| R4 | `admin`/`adminSatelite`/`mensajero` siguen `forbidden` | `eliminar-orden-service.test.ts` matriz de roles; `alcance-borrado-orden.test.ts` |
| R5 | `eliminable` viaja a la tienda, sólo en lo suyo | `orden-service.test.ts` «⭑ adminTienda: sobre una orden de OTRA tienda → false» + los tres hermanos; `eliminar-criterio-unico.test.ts` (catálogo entero, dos roles) |
| R6 | Una sola regla de dueño para los dos canales | `alcance-borrado-orden.test.ts` (incl. recorrido del enum `RolValue` completo) |
| R7 | Todo-o-nada con lote mixto | `eliminar-orden-pantalla-frontera-tienda.test.ts` «R7»; `eliminar-orden-service.test.ts` «lote MIXTO» |
| R8 | La tienda **no** recibe «Eliminadas» ni «Recuperar» | `recuperar-orden.ui.test.tsx` «⭑ FICHA 358: quien puede ELIMINAR pero no VER…» |
| R9 | Pantalla: hay casilla, hay «Eliminar», el modal está montado, y no hay acciones de flujo | `eliminar-orden.ui.test.tsx`, bloque «la tienda: casilla y «Eliminar»…» (4 casos) |
| R10 | El cableado de la **página** manda las props al rol correcto | `OrdenesPage.test.tsx` «⭑ eliminar: el adminTienda recibe la casilla…» + el caso del `admin` |

El test del corazón corre **contra Postgres** y afirma el **conteo de filas afectadas**, no el
`status`. Sin base alcanzable el archivo se **salta** (`describe.skip`), no pasa en verde; con
base y sin catálogo, revienta ruidosamente en el `beforeAll`. **No hay ningún `if (!datos)
return;`**: los `if (r.status !== "ok") return;` de `orden-service.test.ts` son estrechamiento de
tipo que va **después** de su `expect`, y son la convención ya existente de ese archivo.

## Mutaciones (8, todas revertidas)

| # | Mutación | Resultado |
|---|---|---|
| 1 | Quitar `tiendaId` del `where` de `softDelete` | **ROJO** — `eliminar-orden-pantalla-frontera-tienda.test.ts:187` `AssertionError: expected 1 to be +0`. La tienda A borró la orden de la B. |
| 2 | Quitar la pertenencia del bucle de `EliminarOrdenService` | **ROJO 9 tests / 3 archivos** — integración R2: `expected { status: 'ok', eliminadas: +0 } to deeply equal { status: 'conflict', … }`. Nótese el **`eliminadas: 0`**: sin el `if`, el `where` siguió impidiendo el borrado. Es la prueba de que la frontera vive en el `where`. |
| 3 | `resolverAlcanceBorradoOrden`: `adminTienda` → `"todas"` | **ROJO 13 tests / 4 archivos** — integración: `AssertionError: expected 2026-09-02T14:44:14.595Z to be null` (la orden de la tienda B quedó borrada de verdad). |
| 4 | Quitar `o.tiendaId === ownerId` de `marcarEliminable` | **ROJO 5 tests** — `orden-service.test.ts:648` y `eliminar-criterio-unico.test.ts:166`, `expected true to be false`. |
| 5 | `haySeleccion = accionesLote` (sin `|| puedeEliminar`) | **ROJO 3 tests** — `eliminar-orden.ui.test.tsx:247` `Unable to find role="checkbox" and name "Seleccionar orden REM-o1"`. Es literalmente el defecto reportado. |
| 6 | Quitar la guarda `if (!accionesLote) return []` de `accionesDe` | **ROJO 2 tests** — `eliminar-orden.ui.test.tsx:262` `expected <button …> to be null` (la tienda veía «Asignar mensajero»). |
| 7 | `incluirEliminados: puedeEliminar` (sin partir la prop) | **ROJO 1 test** — `recuperar-orden.ui.test.tsx:236` `expected [ 'Estado', 'Zona', … ] to not include 'Eliminadas'`. |
| 8 | Revertir `page.tsx` a `puedeEliminar = rol === maestro` | **ROJO 1 test** — `OrdenesPage.test.tsx:401` `Unable to find … role "checkbox"`. |

**Ninguna sobrevivió en verde.** La 8 se añadió precisamente porque, al medir, el cableado de la
página no tenía ningún test: la mutación habría sobrevivido y el defecto reportado habría vuelto
a producción con la suite entera en verde. Se cerró con dos casos nuevos en `OrdenesPage.test.tsx`.

Además, las mutaciones 1 y 3 confirman de paso lo que este repo ya tenía medido cuatro veces: la
suite de **dobles queda en verde** ante una mutación del `WHERE`; sólo el test contra Postgres la
caza.

## Verificación ejecutada

```
$ pnpm typecheck
> tsc --noEmit
(sin salida — verde)

$ pnpm lint
✖ 145 problems (0 errors, 145 warnings)
(0 errores; ninguna advertencia en archivos tocados por esta ficha — verificado por grep)

$ ./init.sh --rapido   (log completo con INIT_EXIT dentro)
✓ typecheck paso
✓ lint paso
  relacionados: Test Files 314 passed (314) | Tests 4521 passed | 17 skipped (4538)
  guardias:     Test Files 1 failed | 172 passed (173) | Tests 1 failed | 2590 passed (2591)
✓ tests: sin rojos nuevos (1 archivo(s) rojo(s) sobre 483 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

El único rojo es el heredado y tolerado:
`superficie-de-uso.guardia.test.ts` → `["lib/actions/tarifas.ts:67 obtenerTarifa"]`.

Corridas adicionales fuera del gate:
- `tests/components` + `tests/unit/components` completos: **367 archivos, 5131 passed, 26 skipped**.
- Los 8 archivos de la ficha juntos tras el último retoque de comentarios: **211 passed**.

## Lo dudoso / lo que queda abierto

1. **`apiKey` pasa la puerta del service de pantalla.** `resolverAlcanceBorradoOrden` le responde
   «propias», así que un actor con rol `apiKey` sería aceptado por `EliminarOrdenService`. Es
   inalcanzable en la práctica (la Server Action resuelve el actor de la sesión) y sería inocuo
   —queda acotado a su propia tienda, exactamente igual que por su canal—. Se prefirió una sola
   regla a una regla con excepción por canal, que es como divergen. Si se quisiera cerrar, el
   sitio es la Server Action, no el service.
2. **La carrera de estado en el lote de la app sigue destapada**, como antes de esta ficha: si
   una orden cambia de estado entre la precarga y el `updateMany`, se borra igual. Ponerlo en el
   `where` rompería el todo-o-nada (borrado parcial). Queda escrito en el código; no es regresión.
3. **Nada de pantalla quedó pendiente** para que la casilla aparezca. Lo que **no** se hizo, y no
   se pidió: la tienda no tiene forma de ver ni recuperar sus órdenes borradas (sigue siendo del
   `maestro`, por decisión). Si el humano quisiera dársela, es ficha aparte y `restore` necesita
   su `ownerId`.
4. **No se midió en producción** cuántas órdenes de tienda quedan hoy en un estado eliminable.
   NA-495 ya se borró a mano, así que no hay caso vivo que reproducir. La producción se vació el
   2026-08-25, así que un cero no significaría nada.
5. **Sin E2E**: no hay harness en este repo. El riesgo de pantalla se cubre con los 4 casos de
   `eliminar-orden.ui.test.tsx` sobre el componente real y los 2 de `OrdenesPage.test.tsx` sobre
   la página real.

## Veredicto

Verde: la tienda borra lo suyo por pantalla, la frontera entre inquilinos vive dentro del `where`
y está medida contra Postgres con 3 mutaciones que la ponen roja, y la regla de dueño existe una
sola vez para los dos canales.
