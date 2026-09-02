# 363 — deshacer una asignación en zona satélite

Rama `fix/363-deshacer-zona-satelite`, worktree `R:\wt\352`. Sin commit: lo hace el leader.

## El defecto

«No puedo deshacer las asignaciones de Guanacaste, me sale un error con la zona». 17 guías
reportadas; medido en producción, las **94 órdenes vivas** de `FGAM Guanacaste (Tempisque)` son el
mismo caso, y afecta a **cualquier zona satélite** porque es el flujo normal.

`DeshacerAsignacionService`, paso 6 (R14/R15): el destino se derivaba del historial —correcto— y
después se verificaba contra la **zona de la orden**. La premisa era falsa: la zona dice a qué
bodega **pertenece** la orden, no dónde está el paquete. Una orden de zona satélite espera en la
bodega central hasta que la rutean. Mismo malentendido que corrigió la 357.

## Contra qué se verifica ahora, y por qué

La verificación **no se borra**: cambia de autoridad. Ahora el destino inferido se comprueba contra
el **inventario CERRADO de transiciones de la 140** (`TRANSICIONES`), filtrado por la familia de
esta acción (`deshacer_asignacion`). Derivado, no re-escrito.

Medido en runtime (`pnpm exec tsx`, no leído):

```
recolectando            -> {por_recolectar_en_tienda}
en_ruta_bodega_satelite -> {en_bodega_central}                        <- UNA sola
por_recoger             -> {en_bodega_central, en_bodega_satelite}
```

Las tres razones, en orden de peso:

1. **Contra el historial no se puede.** El destino ya sale del historial: compararlo con su propia
   fuente está siempre verde. Y en su versión útil —«solo se vuelve a donde la orden estuvo»—
   rompe justo las dos filas que **sí** son inferencia: `en_fulfillment` y `en_preparacion`
   normalizan a `en_bodega_central` sin que la orden haya pasado por ahí. Descartada.
2. **No es redundante, y esto es lo importante.** `assertTransicionValida` (la guardia de escritura
   de la 140) **ignora la familia a propósito**. Medido: desde `en_ruta_bodega_satelite` las
   aristas son `en_bodega_satelite via recepcion_satelite` (#10), `en_bodega_central via
   deshacer_asignacion` (#45) e `incidente`. Así que una inferencia equivocada que produjera
   `en_bodega_satelite` **no reventaría**: escribiría «recibida en la satélite» un paquete que
   nadie recibió, en silencio y con el historial diciendo `deshacer_asignacion`. Falsificar la
   custodia de un paquete es exactamente el riesgo que la guarda original quería cubrir.
   **Comprobado, no argumentado**: la mutación M2 (quitar la verificación entera) devuelve `ok` y
   la fila se mueve. No hay nada aguas abajo que lo pare.
3. Es la única autoridad **independiente** de la fuente del destino, y es la misma que ya gobierna
   qué puede escribir esta acción.

## La otra mitad de la condición, y con qué medida

`destino === "en_bodega_satelite" && esCentral` — una orden del GAM que volvería a una satélite.
**Se retira también**, y la medida dice por qué:

- `rutearABodegaSatelite` **rechaza** órdenes GAM («orden GAM no se rutea a satelite»), así que una
  orden solo llega a `en_bodega_satelite` mientras su zona es satélite.
- Pero la zona **cambia después**. `ESTADOS_SIN_CORRECCION` (`lib/types/correccion-datos-cliente.ts`)
  = `ESTADOS_TERMINALES` + `rechazada`, y `ESTADOS_TERMINALES` = `entregada`, `devuelta_a_tienda`,
  `incidente` (verificado en runtime). `por_recoger` **no está**: la ficha 327 sí permite corregir
  el distrito de una orden asignada, y su R5/R15 **reescriben la zona derivada**.
- Camino completo y vigente: orden de zona satélite → recibida en la satélite (#10) → asignada allí
  (#9, historial origen `en_bodega_satelite`) → se le corrige la dirección a un distrito del GAM →
  zona central, **paquete físicamente en la bodega satélite**.

Cuando eso pasa, el destino correcto **es** la satélite. La guarda no protegía: **bloqueaba** un
deshacer legítimo y dejaba la orden sin ninguna vía de reversión. Es la misma premisa falsa,
espejada. Bajo la verificación nueva pasa, porque `por_recoger → en_bodega_satelite` (#47) **sí**
es una reversión declarada.

> **Límite honesto de esta medida.** Es estructural (código + inventario de transiciones), **no de
> datos de producción**: en este worktree no tengo la herramienta MCP de Supabase, y la base local
> (`localhost/ordenex`, 67 órdenes) no contiene el caso — medido: 0 órdenes de zona central que
> hayan estado en `en_bodega_satelite`, 0 órdenes en `en_ruta_bodega_satelite`. Si el leader quiere
> el conteo real, la consulta es un `SELECT` de solo lectura sobre `orden ⋈ zona ⋈
> orden_historial_estado`.

## Lo que NO se tocó

- El destino sigue derivándose **del historial, jamás de la zona** (R11/R12).
- **R13, fallo cerrado**: sin fila, con origen NULL o con un origen fuera de la tabla de
  normalización, no se adivina destino. Sus 4 casos siguen verdes.
- **R5**: el `adminSatelite` solo deshace hacia su bodega (paso 7, intacto).
- **R20** todo-o-nada por lote.
- `OrdenRepository.deshacerAsignacionLote` — **sin cambios** (se mutó y se revirtió, SHA verificado).

## Efecto lateral declarado: se va el `ZonaRepository`

`centralZonaId` tenía **un solo** consumidor: la comparación retirada. Mantenerlo habría dejado una
consulta que nadie lee y un `validation_error` («zona central no configurada») que bloqueaba el
deshacer sin proteger nada. El service pasa de 3 a **2 dependencias**. La zona del **actor**
(R4/R5/R6) no cambia: sigue saliendo de `repo.findUsuarioZonaId`.

Un test nuevo fija que no vuelva por descuido (arity 2 + el fuente no menciona `findCentralZonaId`).

## Archivos

**Modificados**

- `lib/services/DeshacerAsignacionService.ts` — verificación nueva (`DESTINOS_DECLARADOS_DESHACER`),
  fuera `zonaRepo`/`centralZonaId`.
- `lib/services/mensajes-deshacer-asignacion.ts` — `MSG_DESTINO_NO_DECLARADO` nuevo;
  `MSG_ZONA_DESTINO_INCOHERENTE` queda como **alias del mismo valor** (ver deuda).
- `lib/actions/deshacer-asignacion.ts` — composition root sin `ZonaRepository`.
- `tests/unit/services/deshacer-asignacion-service.test.ts`
- `tests/unit/services/deshacer-asignacion.cierre-asimetria.test.ts`

**Creado**

- `tests/integration/db/deshacer-asignacion-zona-satelite.int.test.ts` — **contra Postgres real**.

## Mapa requisito → test

| Req | Test |
| --- | --- |
| R11/R12 (destino del historial, tabla cerrada) | `…-service.test.ts` › «T4.5/R11/R12 …» (4 casos) + «R11 (testigo): el destino sale del HISTORIAL, no de la zona» |
| R13 (fallo cerrado) | `…-service.test.ts` › «T4.6/R13 …» (4 casos) |
| **R14/R15 (reescritos, 363)** — el caso de las 17 guías | `…zona-satelite.int.test.ts` › «⭑ orden de zona SATELITE en `en_ruta_bodega_satelite` que vino de la central: se deshace» + su gemelo de historial; unit «orden de zona SATELITE … -> vuelve a la central» |
| **R14/R15 — lo que sigue impedido** | `…zona-satelite.int.test.ts` › «⭑ deshacer una orden EN CAMINO a la satelite NO puede dejarla como RECIBIDA en la satelite»; unit «en_ruta_bodega_satelite con destino inferido en_bodega_satelite -> conflict y CERO escrituras» |
| **R14/R15 — la otra mitad, retirada con medida** | `…zona-satelite.int.test.ts` › «orden de zona CENTRAL cuyo paquete quedo en la satelite: vuelve a la SATELITE»; unit homónimo |
| R14/R15 — la zona no decide | ambos ficheros › «misma orden en zona %s y mismo historial: el destino es el mismo» |
| R5 (adminSatelite hacia su bodega) | `…-service.test.ts` › «T4.2/R4/R5/R6 …» (sin cambios) |
| R20 (todo-o-nada) | int › «… conflict y CERO escrituras» (estado y historial releídos de Postgres) |
| Sin dependencia de zonas (363) | `…-service.test.ts` › «no consulta la zona central por ningun camino …» |

Sin `if (!datos) return;`: el `beforeAll` del test de integración **lanza** con instrucciones si
falta la base, las FKs, las dos zonas o los 4 estados del catálogo. Verificado por la mutación M5,
que lo pone rojo leyendo la fila real.

## Mutaciones — 5 aplicadas, 5 muertas, 0 supervivientes

Runner con **auto-comprobación**: guarda el SHA-256 antes de mutar y aserta que el revert deja el
archivo byte-idéntico. Los 5 reverts salieron `identico=True`.

| # | Mutación | Resultado | Línea de fallo real |
| --- | --- | --- | --- |
| **M1** | **Reintroducir la comprobación por zona** (`orden.zonaEsGam`) | **14 tests rojos** | `…zona-satelite.int.test.ts:224` — `expected 'conflict' to be 'ok'` ← **el caso de Guanacaste**; también `…-service.test.ts:139`, `:193`, `:226` |
| **M2** | **Quitar la verificación entera** | 2 rojos | `…zona-satelite.int.test.ts:263` — `expected 'ok' to be 'conflict'`; `…-service.test.ts:399`. **Devolvió `ok`**: nada aguas abajo lo para |
| M3 | Verificar sin filtrar por familia (= `assertTransicionValida`) | 2 rojos | `…zona-satelite.int.test.ts:263`; `…-service.test.ts:399`. Prueba que el filtro por familia **es** lo que caza |
| M4 | Motivo equivocado (`MSG_SIN_HISTORIAL` en vez del nuevo) | 2 rojos | `…-service.test.ts:401`; `…zona-satelite.int.test.ts:264` |
| M5 | El writer escribe el estado de **origen** en vez del destino (`OrdenRepository`) | 5 rojos | `…zona-satelite.int.test.ts:225` — `expected 'en_ruta_bodega_satelite' to be 'en_bodega_central'`. Prueba que el test lee la **fila**, no el retorno |

Las dos obligatorias (M1, M2) mueren con el caso que les tocaba. **Ninguna sobrevivió en verde**:
la verificación protege algo, y el arreglo se sostiene.

## Salida real de los gates

```
$ pnpm typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0
✖ 147 problems (0 errors, 147 warnings)        # heredados, `no-unused-vars` con `_` en tests

$ pnpm vitest run tests/unit/services tests/unit/guards tests/integration
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts
   + "lib/actions/tarifas.ts:67 obtenerTarifa"   # ROJO HEREDADO, el único tolerado
 Test Files  1 failed | 615 passed (616)
      Tests  1 failed | 9136 passed (9137)

$ pnpm vitest run tests/unit/components
 Test Files  77 passed (77)
      Tests  1149 passed (1149)                 # `CrearTiendaForm` no salió (flake conocido)

$ pnpm vitest run tests/unit/types tests/unit/repositories tests/unit/actions
 Test Files  249 passed (249)
      Tests  3863 passed (3863)

$ pnpm vitest run <las 9 suites de deshacer-asignacion>
 Test Files  9 passed (9)
      Tests  144 passed (144)
```

Único rojo: `superficie-de-uso` por `lib/actions/tarifas.ts:67`, comprobado nominalmente — la lista
tiene **un** elemento y no es mío.

## Lo dudoso / traspaso

1. **El texto de usuario quedó desfasado, a propósito.**
   `app/(app)/ordenes/_components/deshacer-asignacion-error-messages.ts` traduce este motivo a «La
   bodega de origen de alguna orden no corresponde a su zona actual. **Revisa la zona de la orden**
   antes de deshacer», que ahora manda al operador al sitio equivocado. Es capa de presentación y
   queda fuera de mi alcance. Por eso `MSG_ZONA_DESTINO_INCOHERENTE` sobrevive como **alias del
   mismo valor**: sin él la UI no compila. Pendiente: renombrar el identificador y reescribir la
   frase (algo como «El historial de alguna orden no permite deshacer hacia esa bodega»).
2. **R14/R15 de `specs/149-deshacer-asignacion/requirements.md` siguen escritos en términos de
   zona.** El texto del spec quedó desmentido por esta ficha; no lo he editado (spec aprobado e
   histórico). Decisión del leader si se enmienda ahí o se registra como spec de la 363.
3. **`MSG_ZONA_CENTRAL_NO_CONFIGURADA` ya no lo produce este service** (sigue exportado y sigue
   siendo el vocabulario de `GuiaAsignacionService`). El `if` de la UI que lo traduce es ahora
   inalcanzable **por este camino**.
4. **La medida de la «otra mitad» es estructural, no de datos de producción** (ver el recuadro
   arriba). Si el leader tiene acceso al MCP de Supabase, un `SELECT` de solo lectura lo cierra.
5. **Base local compartida**: los tests de integración corren en transacción revertida y no dejan
   filas, pero el otro agente comparte `localhost/ordenex`.

## Veredicto

La verificación cambia de autoridad —del dato equivocado (la zona) al inventario cerrado de
transiciones de la 140—, las 17 guías se deshacen contra Postgres real, lo que debía seguir
impedido sigue impedido y con nombre, y las 5 mutaciones mueren.
