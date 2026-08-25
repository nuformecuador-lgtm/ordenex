# Feature 278 — Bitácora de implementación

> Rama `feature/278-satelite-por-recibir-y-bodega`.
> **Esta entrega cubre SOLO la mitad de servidor: la retirada de la recepción EN LOTE
> (R34–R41, tanda 3B).** Las pantallas, el módulo, el sidebar, las guardias nuevas y el
> comentario del menú son de la mitad de frontend y **siguen pendientes** (§8).

---

## 1. T0.2 — El permiso medido: el QR NO comparte camino con el lote

Comprobado en el árbol **antes** de borrar nada, leyendo los archivos (no razonándolo).
Las líneas son las del árbol en el momento de la medición, sobre `origin/dev`:

| Qué se comprobó | Resultado | Dónde |
| --- | --- | --- |
| (a) `recibir()` llama al método **singular** | ✅ `this.repo.recibirEnSatelite(...)` | `lib/services/RecepcionSateliteService.ts:392`, dentro de `async recibir(numGuia, actor)` |
| (a) `recibirLote()` llama al método **de lote** | ✅ `this.repo.recibirLoteEnSatelite(...)` | `lib/services/RecepcionSateliteService.ts:436`, dentro de `async recibirLote(input, actor)` |
| (b) `recibirLoteEnSatelite` tiene **un solo** llamador en `lib/`, `app/`, `scripts/` | ✅ una sola invocación (`:436`). Las otras 4 apariciones son: la declaración de la interfaz (`IOrdenRepository.ts:1380`), la definición del repo (`OrdenRepository.ts:2948`), la clave del `Pick` (`RecepcionSateliteService.ts:80`) y dos JSDoc que la nombran de pasada | `grep -rn "recibirLoteEnSatelite" lib app scripts` |
| (c) `distinct()` solo lo usa `recibirLote` | ✅ definido en `:84`, invocado **una vez**, en `:416` (cuerpo de `recibirLote`) | `grep -n "distinct" lib/services/RecepcionSateliteService.ts` |

Además, los dos métodos son **dos SQL distintos**: el singular es un `updateMany` guardado
por `id + zonaId + deletedAt + estatus.value` dentro de `$transaction`; el de lote era un
`$queryRaw` `UPDATE … RETURNING "id"` sobre `id IN (…)`. Borrar el segundo no podía alterar
el primero, y la mutación B (§6) lo confirma midiendo en vez de razonando.

## 2. T0.3 — El verde de partida

Corrido **antes** del primer cambio, sobre los archivos que esta tanda iba a mover:

```
Test Files  12 passed (12)
Tests       459 passed (459)
```

(`recepcion-satelite-service`, `recepcion-satelite-action`,
`orden-repository.recepcion-satelite`, `cotizacion-api-key`, `bulk-orden-service`,
`bulk-orden-service.carga-api`, `orden-service`, `rol-admin-satelite-authz`,
`recepcion-satelite-asignadas`, `order-status-transiciones.guardia`,
`RecepcionSateliteModule`, `SateliteSeleccionOtrasPaginas`.)

Tras la retirada, el mismo conjunto **más** los 6 montajes restantes y
`EscanerRecepcion.test.tsx`: `19 passed (19)` / `553 passed (553)`.

## 3. Qué se retiró — producción (9 archivos, todo en dirección de borrar)

| Archivo | Qué se fue |
| --- | --- |
| `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` | el import de `recibirLote`, la función `aceptarRecepcion` y sus **dos** puntos de uso en el JSX (`onAceptarUna` + `textoBotonUna` de `PorAceptarSection`, y el `<Button>` "Aceptar" que iba en `acciones` de cada `SateliteOrderCard`). Con el último `<Button>` fuera, el import de `Button` quedó sin uso y también se va |
| `lib/actions/recepcion-satelite.ts` | la Server Action `recibirLote` con su JSDoc + los dos imports (`recibirLoteSchema`, `type RecibirLoteResult`) |
| `lib/types/recepcion-satelite.ts` | `recibirLoteSchema`, `RecibirLoteActionInput` y `RecibirLoteResult` |
| `lib/interfaces/services/IRecepcionSateliteService.ts` | `RecibirLoteInput`, `RecibirLoteServiceResult` y el método `recibirLote` del contrato |
| `lib/services/RecepcionSateliteService.ts` | el método `recibirLote`, el helper `distinct()`, la clave `"recibirLoteEnSatelite"` del `Pick` de dependencias y los dos imports de tipo |
| `lib/repositories/OrdenRepository.ts` | `recibirLoteEnSatelite` con su JSDoc (42 líneas, **solo borrados**: `git diff` no tiene ni una línea `+`) |
| `lib/interfaces/repositories/IOrdenRepository.ts` | la declaración de `recibirLoteEnSatelite` con su JSDoc |
| `lib/types/orden-guia.ts` | la mención a `recibirLoteSchema` en el comentario que enumera esquemas hermanos |

**Lo que NO se tocó** (R7/R38, comprobado con `git diff`): `recibirPorQr`,
`Service.recibir()`, `repo.recibirEnSatelite`, `findByNumGuiaForTransicion`,
`findEstatusIdByValue`, `appendCambioEstado`, `ORIGEN_RECEPCION` / `ESTADO_RECIBIDA`, el
catálogo de estados y el historial. **Cero migraciones, cero tablas, cero cambios de RLS**:
`git status db/` vacío. `tests/fixtures/sin-comentarios.ts` intacto (R47).

El diff del servicio es **solo líneas `-`**: `recibir()` no tiene ni una línea tocada.

## 4. Los 18 archivos de test: clasificación real y qué se hizo en cada uno

Ninguno se borró entero. La clasificación de `design.md` §15.3 se verificó archivo por
archivo contra el árbol; coincidió en los 18.

### (A) Muere el sujeto — 3 archivos (la tabla de destinos, en §5)

| Archivo | Qué se retiró | Qué queda |
| --- | --- | --- |
| `tests/unit/services/recepcion-satelite-service.test.ts` | `describe("recibirLote (feature 63)")` (8 casos), la clave `"recibirLoteEnSatelite"` del `Pick` y el doble de `fakeRepo` | `describe("recibir (R11-R18)")` **intacto** (12 casos) + un comentario que dice qué vivía ahí y dónde está su destino |
| `tests/unit/actions/recepcion-satelite-action.test.ts` | `describe("recibirLote — borde y delegacion")` (5 casos), el import y la clave `recibirLote` de `buildService` | `describe("recibirPorQr — validacion de borde (R16) y delegacion (R10)")` **intacto** (7 casos) |
| `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` | `describe("OrdenRepository.recibirLoteEnSatelite (feature 63)")` (4 casos) y su helper `buildPrismaRaw` (sin más usos) | `describe("OrdenRepository.recibirEnSatelite (R11/R18 · feature 49/#6)")` **intacto** (3 casos) |

### (B) Dobles tipados contra la interfaz — 5 archivos, cambio mecánico

El typecheck los denunció uno a uno; se quitó la clave sobrante:
`bulk-orden-service.test.ts`, `bulk-orden-service.carga-api.test.ts`,
`orden-service.test.ts`, `rol-admin-satelite-authz.test.ts` (clave `recibirLoteEnSatelite`
del literal `IOrdenRepository`) y `recepcion-satelite-asignadas.test.ts` (la clave **y** la
entrada del `Pick`).

### (C) Censos escritos a mano — 2 archivos, verdes y falsos si no se tocan

- **`tests/integration/cotizacion-api-key.test.ts`.** El diagnóstico del spec se confirmó
  **midiendo**: tras retirar `recibirLoteEnSatelite` de `IOrdenRepository`, el typecheck
  completo denunció 10 archivos… y de éste **no dijo ni una palabra**, porque
  `METODOS_ESCRITURA` alimenta un `Proxy` que acepta cualquier nombre. Se retiró el nombre
  **y** se ató la lista con `as const satisfies readonly (keyof IOrdenRepository)[]` (R41),
  reescribiendo el comentario que decía «pasaría igual si el método no existiera» para que
  explique por qué ahora ya no.
- **`tests/fixtures/inventario-transiciones-140.ts`.** Solo el `callSite` de la transición
  #10 (`en_ruta_bodega_satelite → en_bodega_satelite`), que pasa de
  `"RecepcionSateliteService.recibir/recibirLote"` a `"RecepcionSateliteService.recibir"`.
  **La fila se queda y el conteo no baja**: la transición sigue viva y sigue teniendo
  productor; lo que cambió es cuántos sitios la ejecutan.

### (D) Montajes del módulo — 8 archivos

`RecepcionSateliteModule.test.tsx`, `SateliteSeleccionOtrasPaginas.test.tsx`,
`SatelitePaginacion.test.tsx`, `SateliteDescarga.test.tsx`,
`RecepcionSateliteIncidente.test.tsx`, `ManifiestoFlujos.test.tsx`,
`CambiarDiaRepartoListados.test.tsx`, `deshacer-asignacion.ui.test.tsx`.

En los **8** se retiró la clave inerte `recibirLote: vi.fn()` del `vi.mock` (R39: un doble
que nombra un export inexistente es exactamente el fallo mudo que esta ficha viene a
cerrar). En **dos** hizo falta además tocar casos, porque su sujeto era el botón:

- `RecepcionSateliteModule.test.tsx`: los tres casos del "Aceptar" (ver §5) y la cabecera de
  dobles.
- `SateliteSeleccionOtrasPaginas.test.tsx`: el disparador de `releerListado`, ver §5.

⚠️ **La prop `porRecibir` sigue en los 8**: retirarla es T3.1/T4.3b y depende del módulo,
que es de frontend. Esta entrega no la toca.

### (E) NO se tocan

`progress/impl_lote_vacio_schemas.md`, `progress/impl_63-*.md` y los `design.md` de las
fichas 90, 140 y 149: son fotos históricas. `git status` lo confirma.

## 5. R40 — Cada caso retirado con su destino, sin una fila vacía

**Nada desapareció en silencio.** 20 casos retirados, 20 destinos.

### `tests/unit/services/recepcion-satelite-service.test.ts` — 8 casos

| Caso retirado | Destino |
| --- | --- |
| `autz: rol != adminSatelite -> forbidden, sin tocar datos` | **Repuesto** por `"R17: rol != adminSatelite -> forbidden, sin tocar datos"` del `describe("recibir")`, en el MISMO archivo: misma guarda, mismo servicio, y es la que sostiene el QR |
| `adminSatelite sin zona -> sin_zona, sin efectos` | **Repuesto** por `"R5: adminSatelite sin zona -> sin_zona, sin efectos"` (`describe("recibir")`) |
| `lote vacio -> ok con 0 recibidas, sin escribir` | **Muere con el código.** No hay lote. El QR recibe UN `numGuia`, no una lista: el concepto «lote vacío» deja de existir, y con él su regla |
| `catalogo incompleto (origen/destino sin seed) -> validation_error, sin escribir` | **Repuesto** por `"catalogo incompleto (destino sin seed) -> validation_error, sin escribir"` (`describe("recibir")`). El de lote pre-resolvía DOS estados (origen y destino) porque los necesitaba el `WHERE` del `UPDATE` en lote; el singular solo necesita el destino, y esa diferencia se va con el método |
| `transiciona el lote de SU zona … (escritura guardada por origen+zona+historial)` | **Repuesto** en su versión singular por `"R11/R18: origen valido y de la zona -> transiciona a en_bodega_satelite (guardado por estado+zona)"`, que afirma la llamada con la zona del actor, el estatus destino y el contexto de historial completo |
| `dedupe: ids repetidos se colapsan antes de la escritura` | **Muere con el código**, junto al helper `distinct()`. Sin lista de ids no hay nada que deduplicar; el QR resuelve UNA orden por `num_guia` (UNIQUE) |
| `alcance por zona/estado server-side: el conteo refleja SOLO lo transicionado` | **Partido.** El *alcance* sigue afirmado: por zona en `"R12: orden de otra zona -> zona_ajena, sin efectos"` y por estado en `"R13: origen distinto de en_ruta_bodega_satelite -> estado_invalido"`. El *conteo* **muere**: no hay número de recibidas que devolver |
| `idempotencia: re-ejecutar cuando ya no hay nada en el origen -> ok con 0 recibidas` | **Repuesto** por `"R14: orden ya en_bodega_satelite -> ya_recibida idempotente, sin escribir"`, que es la idempotencia del camino vivo. El «0 recibidas» muere con el conteo |

### `tests/unit/actions/recepcion-satelite-action.test.ts` — 5 casos

| Caso retirado | Destino |
| --- | --- |
| `sin actor -> unauthenticated, sin tocar el service` | **Repuesto** por `"recibir sin actor -> unauthenticated, sin tocar el service"` del `describe("R3: unauthenticated antes de tocar el service")`: el mismo `withErrorHandler`, el mismo `UnauthenticatedError` y el mismo orden borde-antes-que-service |
| `lote vacio (min 1) -> validation_error, sin tocar el service` | **Muere con `recibirLoteSchema`.** El borde del QR no recibe un array; sus cotas propias (entero positivo, forma inválida, UUID de etiqueta vieja) siguen afirmadas en los 4 casos `R16:` |
| `id vacio en el lote -> validation_error, sin tocar el service` | **Muere con `recibirLoteSchema`**, misma razón |
| `lote valido delega en el service con ordenIds y actor` | **Repuesto** por `"R10: num_guia valido delega en el service con el numGuia y el actor"` |
| `resultados de dominio del service pasan tal cual (forbidden / sin_zona)` | **Repuesto en el mecanismo** por `"resultados de dominio del service pasan tal cual (zona_ajena)"` y `"ya_recibida del service pasa tal cual (idempotente, R14)"`, que ejercitan el mismo paso limpio de dominio en el mismo cuerpo de action. Los *estados* `forbidden` y `sin_zona` siguen afirmados donde se producen: en el `describe("recibir")` del test de servicio |

### `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` — 4 casos

| Caso retirado | Destino |
| --- | --- |
| `UPDATE raw guardado por origen+zona+no borrada con RETURNING; count = filas recibidas` | **Muere con el código.** Afirmaba un SQL que ya no existe. El `WHERE` que sostiene el QR es OTRO (`updateMany` con `id + zonaId + deletedAt + estatus.value`) y tiene su propio caso vivo, `"R11/R18: UPDATE guardado por id+zona+deletedAt+origen"`, que la mutación B (§6) demuestra que muerde |
| `preserva el append de historial (recepcion_satelite) SOLO de los ids retornados` | **Muere con el código.** Su hermano singular conserva `"R14: recepcion deja 1 historial con origen pre-leido y tipo recepcion_satelite"`, con el mismo `origenTipo` y la misma forma de fila |
| `idempotencia: 0 filas cuando ninguna sigue en el origen; no deja rastro` | **Repuesto** por `"R18/R8: false si el UPDATE no afecto filas (race); NO deja rastro"`, que es la misma afirmación (no transiciona → no deja historial) en el método vivo |
| `devuelve 0 sin abrir transaccion cuando ordenIds esta vacio` | **Muere con el código.** Era la cota de lista vacía del repositorio; sin lista, no hay cota |

### `tests/components/RecepcionSateliteModule.test.tsx` — 3 casos

| Caso retirado / reexpresado | Destino |
| --- | --- |
| `"Feature 63: la sección 'Por recibir' expone 'Aceptar' por-orden (sin lote) y NO asignar/gestionar"` | **Reexpresado, no borrado**: afirmaba lo CONTRARIO de R1 y cambia de sentido con la decisión firmada. Pasa a `"Feature 278 (R1): 'Por recibir' lista las órdenes SIN ningún botón de acción"`, con control POSITIVO en el mismo caso (las dos remisiones visibles) para que un render roto no lo deje verde (R29) |
| `"Pedido humano 2026-08-19: NO hay 'Aceptar todas' ni forma de recibir varias de golpe"` | **Reexpresado** a `"Feature 278 (R1/R34): ninguna de las dos vías de recepción del botón sobrevive"`: la de lote (retirada el 2026-08-19) y la por-orden (esta ficha), con el mismo control positivo |
| `"Feature 63: 'Aceptar' de una fila envía solo ese ordenId"` | **Muere con el código.** Era la única prueba del cableado botón → `recibirLote`, y ese cableado ya no existe. No se repone con un equivalente porque **no hay acción equivalente**: la recepción pasa por el escáner, y ese camino ya lo afirma `tests/components/EscanerRecepcion.test.tsx`, que esta entrega no toca. Queda un comentario en el sitio exacto donde vivía |

### `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` — 0 casos retirados

Los **9 casos siguen**. Lo que cambió es el **disparador** del helper `releerListado`, que
usaba el botón «Aceptar» como «una acción CUALQUIERA que relee del servidor». Sustituido por
la recepción por QR (diseño §11), camino MANUAL (número de guía tecleado, sin cámara). Se
conserva intacto el anclaje POSITIVO (`waitFor` sobre las remisiones visibles tras la
relectura). Un detalle medido: el escáner vive en modal, y mientras está abierto el resto de
la página queda `aria-hidden`, así que el helper **cierra el modal** antes de juzgar la
tabla; sin eso, `getByRole("table")` no la encuentra y los 4 casos que releen caen. La
mutación D (§6) demuestra que el sustituto mide una relectura de verdad.

## 6. Mutaciones inyectadas — medir, no razonar

Cinco mutaciones, una a una, **todas revertidas** (`git diff` lo confirma).

| # | Mutación | Resultado |
| --- | --- | --- |
| **A** | En `RecepcionSateliteService.recibir()`, anular la guarda de zona ajena (`if (row.zonaId !== zonaId) return { status: "zona_ajena" }`) | 🔴 **ROJO.** `recepcion-satelite-service.test.ts` → `1 failed | 25 passed`, en `"R12: orden de otra zona -> zona_ajena, sin efectos"`. **El QR conserva su red tras la retirada** (R38, T5.2g) |
| **B** | En `OrdenRepository.recibirEnSatelite`, quitar `zonaId` del `where` del `updateMany` (el WHERE del método **singular**, el que sostiene el QR) | 🔴 **ROJO.** `orden-repository.recepcion-satelite.test.ts` → `1 failed | 7 passed`, en `"R11/R18: UPDATE guardado por id+zona+deletedAt+origen"`. Borrar el hermano de lote **no** dejó al singular sin cobertura de su `WHERE` |
| **C** | Reintroducir el consumo de `recibirLote` en `RecepcionSateliteModule.tsx` | 🔴 **NO COMPILA.** `error TS2339: Property 'recibirLote' does not exist on type 'typeof import(".../lib/actions/recepcion-satelite")'`. El camino en lote ya no existe de verdad, no solo «no se usa» (R34) |
| **D** | Quitar el `mutate()` de `releerBodega` (dejar solo `router.refresh()`) | 🔴 **ROJO.** `SateliteSeleccionOtrasPaginas.test.tsx` → `3 failed | 6 passed`. El disparador nuevo (QR) **mide una relectura real**, no es un no-op que pasaría igual |
| **E** | Devolver un `<Button>Aceptar</Button>` dentro del `renderItem` de cada tarjeta | 🔴 **ROJO.** `RecepcionSateliteModule.test.tsx` → `2 failed | 40 passed`, los dos casos reexpresados. Las ausencias que escribí **muerden** (R29) |

Y una sexta, la de R41, que merece su propio párrafo porque el censo era el problema:

| # | Mutación | Resultado |
| --- | --- | --- |
| **F** | Reintroducir `"recibirLoteEnSatelite"` en `METODOS_ESCRITURA` de `cotizacion-api-key.test.ts`, **ya con el `satisfies` puesto** | 🔴 **NO COMPILA.** `error TS2820: Type '"recibirLoteEnSatelite"' is not assignable to type 'keyof IOrdenRepository'`. **Contraste medido**: el mismo nombre inexistente, con el `as const` de antes y sin `satisfies`, atravesó un typecheck completo sin una sola queja. Un censo que no puede fallar no es un censo (R41) |

## 7. T3B.7 — Las siete guardas del QR, una a una, con su archivo y su caso

Los cuatro bloques que las sostienen **no tienen ni una línea tocada** (`git diff` de esos
`describe`, vacío):

| Guarda | Archivo | Caso |
| --- | --- | --- |
| Rol | `tests/unit/services/recepcion-satelite-service.test.ts` | `"R17: rol != adminSatelite -> forbidden, sin tocar datos"` |
| Zona propia (sin zona) | idem | `"R5: adminSatelite sin zona -> sin_zona, sin efectos"` |
| Zona ajena | idem | `"R12: orden de otra zona -> zona_ajena, sin efectos"` — **la mutación A la mata** |
| Estado de origen inválido | idem | `"R13: origen distinto de en_ruta_bodega_satelite -> estado_invalido con el estado actual"` |
| Orden inexistente o borrada | idem | `"R15: ninguna orden con ese num_guia -> no_encontrada, sin efectos"` **y** `"R15: orden borrada -> no_encontrada, sin efectos"` |
| Idempotencia de la ya recibida | idem | `"R14: orden ya en_bodega_satelite -> ya_recibida idempotente, sin escribir"` |
| Resolución de carrera | idem | `"R18: race — UPDATE no afecta y al re-leer esta recibida -> ya_recibida"` **y** `"R18: race — … NO esta recibida -> conflict"` |

Y las capas de arriba y abajo, también intactas: el borde en
`tests/unit/actions/recepcion-satelite-action.test.ts`
(`describe("recibirPorQr — validacion de borde (R16) y delegacion (R10)")`, 7 casos), la
escritura en `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts`
(`describe("OrdenRepository.recibirEnSatelite")`, 3 casos, **la mutación B la mata**) y la
UI del escáner en `tests/components/EscanerRecepcion.test.tsx`, sin editar.

## 8. Trazabilidad de esta entrega — R34…R41

| R | Dónde queda afirmado |
| --- | --- |
| R34 | typecheck (mutación **C**: reintroducir el consumo no compila) + ausencia del export en `lib/actions/recepcion-satelite.ts`. La guardia permanente es T5.1, **pendiente (frontend)** |
| R35 | typecheck: nadie importa `recibirLoteSchema`, `RecibirLoteActionInput` ni `RecibirLoteResult`, y ya no existen |
| R36 | `tests/unit/services/recepcion-satelite-service.test.ts`: el `Pick` de dependencias ya no declara el método en lote y el archivo compila; la interfaz no lo expone |
| R37 | `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` (el `describe` del lote ya no existe; el del singular sí) + typecheck |
| R38 | §7: las siete guardas nombradas, con los cuatro bloques sin editar; mutaciones **A** y **B** demuestran que muerden |
| R39 | `tests/integration/cotizacion-api-key.test.ts` (lista + `satisfies`), `tests/fixtures/inventario-transiciones-140.ts` (`callSite`) y los 8 `vi.mock` de los montajes: **ningún** doble, censo o inventario nombra ya el camino retirado en código ejecutable |
| R40 | §5: 20 casos retirados, 20 destinos, sin una fila vacía |
| R41 | `as const satisfies readonly (keyof IOrdenRepository)[]` + mutación **F**, con el contraste medido de que sin `satisfies` el mismo nombre falso pasaba en verde |

## 9. Gate

`./init.sh` **completo** (el rápido se habría negado: el diff toca `lib/types/`). El código
de salida se escribió DENTRO del log, y el log **no** se canalizó por `tail`.

Log: `progress/gate_278_backend.log`.

```
== Arnes SDD :: init (modo: completo) ==
✓ typecheck paso
✓ lint paso            (0 errors, 101 warnings — todas preexistentes)
✓ test paso
  Test Files  1375 passed (1375)
  Tests       18689 passed | 26 skipped (18715)
  Duration    387.99s
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
== init OK ==
INIT_EXIT=0
```

El aviso de `down.sql` es **preexistente y ajeno**: son tres migraciones de la familia
`ruta_*`; esta entrega no añade ninguna migración (`git status db/` vacío).

Antes del gate se corrió `pnpm run db:generate`, porque el cliente de Prisma se comparte
entre ramas en esta máquina y uno rancio pone rojo el gate con errores de archivos que la
rama no tocó.

## 10. Lo que queda pendiente — mitad de frontend

**Nada de las tandas 1, 2, 3, 4 (salvo lo listado en §4/§5), 5 y 6 está hecho.** En orden
de `tasks.md`:

- **T0.1** — medir el agujero del quitador en `lib/auth/menu-visibility.ts` (el ANTES de Q4).
  Sin hacer. Va **primero**, y si (b) o (c) salen `true` el §16 se re-decide en vez de
  aplicarse.
- **Tanda 1** — T1.0 (arreglar el comodín del comentario y medir el DESPUÉS), T1.0b (correr
  todas las guardias y **parar y reportar** lo que se destape, protocolo **P1 FIRMADA**),
  T1.1 (los `children` del ítem del satélite), T1.2–T1.6 (menú, `destino-post-login`,
  `AppLayout`, `Sidebar`, caso permanente de legibilidad).
- **Tanda 2** — T2.1 `en-bodega/page.tsx`, T2.2 `por-recibir/page.tsx`, T2.3 el redirect.
- **Tanda 3** — T3.1 `RecepcionSateliteModule` (quitar el bloque JSX de «Por recibir»
  entero, la prop `porRecibir` **sin sustituto**, y dejar el escáner con la condición
  `!sinZona` a secas), T3.2 `PorRecibirModule`, T3.3 `AvisoSinZonaSatelite`, T3.4
  `PorAceptarSection` (fuera `mostrarAcciones` — **esta entrega la dejó viva a propósito**,
  porque su retirada arrastra el JSDoc y la cabecera que R4 obliga a reescribir —, y el
  comentario de cabecera que todavía nombra `recibirLote`), T3.5 `SateliteOrderCard` (fuera
  la prop `acciones`, que esta entrega dejó de pasar pero no borró del contrato).
- **Tanda 4** — T4.1 (b)(c)(d)(e) de `RecepcionSateliteModule.test.tsx` — el caso R22 nuevo,
  los de `sinZona`, el de la línea 315 que afirma lo contrario de R42, y quitar `porRecibir`
  de `renderModule` —, T4.2 `PorAceptarSection.test.tsx`, **T4.3b: la prop `porRecibir`
  sigue en los 8 montajes**, T4.4 `RecepcionSatelitePage.test.tsx`, T4.5
  `PorRecibirModule.test.tsx`.
- **Tanda 5** — T5.1 la guardia `satelite-sin-boton-aceptar.guardia.test.ts` (su ámbito
  incluye los DOS archivos de servidor de los que se retiró el lote, con `recibirPorQr` como
  anclaje positivo) y T5.2 (a)(b)(d)(e)(f) — las mutaciones (c) y (g) ya están medidas aquí
  como **D** y **A**.
- **Tanda 6** — T6.1 rutas de los e2e, T6.2 `docs/release.md`, T6.3 ficha y bitácora,
  T6.4 gate completo **de nuevo** al cerrar la ficha entera.

### Nota de alcance: por qué esta entrega tocó tres archivos de la mitad de frontend

`design.md` §15.2 pone `RecepcionSateliteModule.tsx` en la tabla de la **retirada del lote**
(«`aceptarRecepcion` y el import de `recibirLote`»), y §17 dice que la cadena **no compila a
medias**. El único consumidor de la Server Action era ese botón: dejarlo vivo habría dejado
el árbol rojo. Se hizo el corte **mínimo** —import, función y sus dos puntos de uso— y se
dejó intacto todo lo demás del módulo (el bloque JSX de «Por recibir», `porRecibir`,
`mostrarAcciones`, el aviso de zona), que es T3.1/T3.4/T3.5. Los dos archivos de prueba que
cayeron por ese corte (`RecepcionSateliteModule.test.tsx` y
`SateliteSeleccionOtrasPaginas.test.tsx`) se adaptaron **en la dirección que `tasks.md` T4.1
y T4.3 mandan**, no con un parche provisional, para que la mitad de frontend los continúe en
vez de deshacerlos.
