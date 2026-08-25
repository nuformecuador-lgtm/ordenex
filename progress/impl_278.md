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

---

# Feature 278 — Mitad de FRONTEND (2026-08-24)

> Continúa la bitácora de arriba, que cubría la tanda 3B (retirada del lote, servidor).
> **Esta entrega cubre todo lo demás**: T0.1, tanda 1, tanda 2, tanda 3 (T3.1–T3.5), tanda 4
> (T4.1, T4.2, T4.3b, T4.4, T4.5), tanda 5 (T5.1 y las mutaciones a/b/d/e/f de T5.2) y tanda
> 6 entera. Las mutaciones (c) y (g) ya estaban medidas arriba, como **D** y **A**.

## 11. T0.1 / T1.0 — el agujero del quitador, MEDIDO antes y después

El spec afirmaba que la línea 228 era la única del archivo con un `/*` dentro de un `//`, y
que el bloque falso se tragaba de la 228 a la ~378. **No se heredó el número: se volvió a
medir**, con un script de un solo uso que pasa `lib/auth/menu-visibility.ts` por el
`quitarComentarios` del repo (el script se borró; su salida es lo que sigue).

| | ANTES (T0.1) | DESPUÉS del arreglo (T1.0) | Con los subítems ya puestos (T1.1) |
| --- | --- | --- | --- |
| (a) líneas no vacías que sobreviven | **76** (de 400 no vacías / 411 totales) | **156** (de 410 / 421) | **160** (de 432 / 443) |
| (b) contiene `label: "Incidentes"` | `false` | **`true`** | `true` |
| (c) contiene `"/recepcion-satelite"` | `false` | **`true`** | `true` |
| (c2) contiene las dos subrutas nuevas | `false` | `false` (aún no existían) | **`true`** |
| (d) aperturas de bloque dentro de un `//` | **1** → línea `228: // \`/mis-asignaciones/*\` (resuelven el rol server-side).` | **NINGUNA** | NINGUNA |

**El tamaño del agujero, medido y no razonado:** el bloque falso abría en la **228** y sólo
cerraba en el **378** (el `*/` del JSDoc de `puedeVer`, localizado con `awk`): **151 líneas**
invisibles para cualquier guardia que escanee este fuente. Ahí dentro viven «Entregas»,
«Recolección», el ítem del `adminSatelite`, «Novedades», «Ranking», «Wallet»,
«Configuración», los dos cierres e «Incidentes».

> ⚠️ **La ficha decía «79 líneas»** (dos veces, en `status_note`). Es **falso**: son **151**
> de fuente, y **80 líneas no vacías** de diferencia en el texto barrido (76 → 156). El dato
> se corrigió en la ficha.

Las dos comprobaciones que `tasks.md` T0.1 marcaba como puerta —«si (b) o (c) salen `true`,
el agujero no está donde se cree, se para y se re-decide §16»— salieron **las dos `false`**,
o sea el §16 aplicaba tal cual y no hubo que re-decidir nada.

**El arreglo (T1.0)** es el del diseño: la ruta con comodín pasa a nombrar
`` `/mis-asignaciones/reparto` `` y `` `/mis-asignaciones/recoger` ``. Más preciso que el
patrón y sin forma de reabrir el agujero. **`tests/fixtures/sin-comentarios.ts` no se tocó**
(R47): `git diff` de ese archivo, vacío.

**Y queda afirmado para siempre** (T1.6, R45/R46), en `tests/unit/auth/menu-visibility.test.ts`:
un caso que comprueba que ninguna línea abre un bloque dentro de un comentario de línea, y
otro que comprueba que el texto barrido conserva `label: "Incidentes"` y las dos subrutas.
El segundo lleva anclaje de anti-vacuidad (`export const SIDEBAR_ITEMS` presente y >100
líneas no vacías): si el quitador se comiera el archivo entero, se pone rojo en vez de
aprobar el vacío. La mutación **(f)** demuestra que muerde.

## 12. T1.0b · P1 FIRMADA — qué destapó abrir el agujero

**NINGUNA violación.** Corridas **inmediatamente después del arreglo del comentario y antes
de añadir los subítems**, para que cualquier rojo fuera atribuible sólo al comentario:

```
pnpm run test:guardias   (vitest run guard)
Test Files  141 passed (141)
Tests       2096 passed (2096)
GUARDIAS_EXIT=0
```

Repetido tras añadir los `children`: idéntico, 141/2096 en verde.

Así que **la obligación de P1 no llegó a activarse**: no hay ninguna violación previa que
nombrar, ni ninguna con tamaño que declarar, ni nada que tocara **roles o visibilidad del
menú** (el caso en el que la regla firmada manda parar y avisar antes de arreglar).

Comprobación complementaria, por si el patrón `guard` dejaba fuera algún escáner de fuentes:
de los 8 archivos de `tests/` que nombran `menu-visibility`, **el único que lee el fuente**
es `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts`, que es una guardia y entró
en esa corrida. El resto lo importan como valor. La corrida COMPLETA del gate (§17) es la
que cierra el hueco de un censo que recorra `lib/**` sin nombrar el archivo.

## 13. Tanda 1 — el menú, y los tres tests que se pusieron rojos a propósito

`lib/auth/menu-visibility.ts`: el ítem del satélite gana `children` con «Por recibir»
primero y «En bodega» después. Etiqueta del padre («Órdenes») y `href` del padre intactos —
patrón literal de «Entregas»—, y el comentario nuevo explica por qué se parte y por qué el
`href` se conserva, **sin escribir ninguna ruta con comodín** (R33).

Los tres que el diseño §5 anunciaba rojos lo estuvieron, y **se actualizaron a mano**:

| Test | Qué decía | Qué dice |
| --- | --- | --- |
| `tests/unit/auth/destino-post-login.test.ts` | `adminSatelite` → `/recepcion-satelite` | → `/recepcion-satelite/por-recibir`, **más** `not.toBe("/recepcion-satelite")`. La cabecera del archivo sigue prohibiendo derivar el esperado de `primerDestino`, y la nota del caso dice de dónde viene el cambio |
| `tests/unit/auth/menu-visibility.test.ts` | «el adminSatelite aterriza en su portal» + el caso R54 de la 192 | los dos con el literal nuevo. El R54 conserva su sentido: lo que afirma es que «Monitoreo» no mueve el aterrizaje de nadie |
| `tests/components/AppLayout.test.tsx` | buscaba un **enlace** `href="/recepcion-satelite"` | busca el **disparador** «Órdenes», lo abre y afirma los dos subenlaces. **Conserva las dos mitades negativas**: no ve `/ordenes` y no ve «Configuración». Añade que el `href` del padre ya NO aparece como enlace |

Y dos casos nuevos: `Sidebar.test.tsx` (T1.5a) afirma que con `/recepcion-satelite/en-bodega`
activo ese subítem queda `aria-current="page"`, su padre `aria-expanded="true"` y el hermano
**no** marcado (el activo es por igualdad exacta, no por prefijo — los dos empiezan igual);
y el comentario de `linkPorHref` (T1.5b) deja de decir que hay dos ítems «Órdenes» que son
enlace: sólo queda uno.

## 14. Tandas 2 y 3 — las rutas y los módulos

```
app/(app)/recepcion-satelite/
  page.tsx                        ← AHORA: redirect a /por-recibir. Sin gate propio y sin
                                    resolver la sesión (se afirma que no llama a NINGUNA
                                    de las seis lecturas ni al resolvedor de actor)
  por-recibir/page.tsx            ← NUEVO. UNA sola lectura: listarRecepcionSatelite
  en-bodega/page.tsx              ← el Server Component de hoy, movido con `git mv`
  _components/
    PorRecibirModule.tsx          ← NUEVO
    AvisoSinZonaSatelite.tsx      ← NUEVO (el texto en UN sitio, R25)
    RecepcionSateliteModule.tsx   ← conserva nombre y ruta (design D4); pierde el bloque
    SateliteOrderCard.tsx         ← pierde la prop `acciones`
app/(app)/_components/
    PorAceptarSection.tsx         ← pierde las piezas del botón; cabecera reescrita
```

Lo que se retiró, y lo que **no** se puso en su lugar:

- **`porRecibir` sale de `RecepcionSateliteModule` sin sustituto.** Con el escáner
  incondicional, «En bodega» no necesita ni un booleano sobre la lista (R18/R42). El
  typecheck lo denunció en los 8 montajes + la página, uno a uno.
- **`mostrarAcciones`, `onAceptarUna`, `textoBotonUna` y el `CardAction` + `<Button>`** salen
  de `PorAceptarSection`; con el último `<Button>` fuera, el import de `Button` también.
- **`acciones` sale de `SateliteOrderCard`** con su contenedor y su JSDoc. Comprobado antes
  de borrar: **ningún consumidor la pasaba**.
- **La condición del escáner pasa de `!sinZona && porRecibir.length > 0` a `!sinZona`**, en
  las dos pantallas.
- **`estadoLegible` se muda** de `RecepcionSateliteModule` a `PorRecibirModule`: su único
  consumidor era la tarjeta.
- **`releerBodega` conserva `router.refresh()` + `mutate()`** en «En bodega» (R22), y «Por
  recibir» usa `router.refresh()` a secas (R21) porque ahí no hay SWR.

El separador del listado dejaba de tener sentido atado a `mostrarPorRecibir`; pasa a
depender de si el escáner está montado (`sinZona`), que es lo único que ahora puede haber
encima.

## 15. Tanda 4 — el mapa de reexpresiones, sin un caso perdido

**Regla aplicada en todas** (R29): cada ausencia con una afirmación POSITIVA **en el mismo
caso**. Un `queryBy` que no encuentra nada pasa igual de verde si el render se rompió entero.

### `tests/components/RecepcionSateliteModule.test.tsx` — la pantalla «En bodega»

| Caso | Destino |
| --- | --- |
| `"R6/R8: muestra DOS secciones separadas 'Por recibir' y 'Recibidas'"` | **Reexpresado** → `"R18: 'En bodega' monta SU listado y NO la región 'Por recibir'"`. Positivo: la región del listado con su fila |
| `"Feature 278 (R1): 'Por recibir' lista las órdenes SIN ningún botón"` | **Reexpresado y ampliado de ámbito** → `"R1/R34: ninguna de las dos vías de recepción del botón sobrevive en 'En bodega'"`: la ausencia se afirma en TODA la pantalla. Positivo: el listado con su fila **y** el acceso al escáner |
| `"R5: si sinZona, muestra aviso accionable y NO ofrece el escáner"` | **Reexpresado** → `"R25/R27: sin zona muestra el aviso y NO ofrece el escáner, pero el listado sigue"`. El texto se afirma contra `AVISO_SIN_ZONA_SATELITE`, el literal exportado, no contra una copia a mano |
| `"con zona y órdenes por recibir, ofrece cámara y número tecleado"` | **Reexpresado** → `"R42: con zona ofrece cámara y número de guía tecleado"`, y el montaje ya **no** pasa ninguna lista: la demostración es el propio andamiaje |
| `"sin órdenes por recibir no se muestra la tarjeta de recepción ni la sección"` (T4.1d) | **AFIRMABA LO CONTRARIO de R42.** Reexpresado → `"R42/R43: el escáner NO depende de la lista de por-recibir — se ofrece con la bodega vacía"`, con la decisión firmada escrita dentro del caso |
| `"R7 (33, no regresión): 'Por recibir' NO ofrece seleccionar ni asignar"` | **Reexpresado** → `"R7/R18: la selección y 'Asignar' viven SOLO en el listado"`. Positivo: el listado SÍ tiene checkboxes |
| `"Feature 63: 'Por recibir' muestra el banner con el contador"` | **MUDADO** a `PorRecibirModule.test.tsx` → `"R2: el banner cuenta las órdenes por recibir"` |
| `"Feature 278 (R1/R34): ninguna de las dos vías sobrevive"` | **Partido**: la mitad de «En bodega» se queda (arriba); la de las tarjetas va a `PorRecibirModule.test.tsx` → `"R1/R2: … SIN ningún botón"` |
| `"Feature 63 + pedido humano: sin zona no se ofrece nada de recepción"` | **MUDADO** → `"R26/R43: sin zona sólo el aviso"`. Su mitad de esta pantalla es OTRA regla (R27) y la afirma el caso `R25/R27` |
| `"R18/R25: 'Por recibir' (cards) muestra el dato etiquetado"` y `"R19: … con 0 intentos"` | **MUDADOS** a `PorRecibirModule.test.tsx` con el mismo nombre. La columna «Intentos» del LISTADO se queda aquí, en sus tres casos |
| **NUEVO (T4.1b, R22)** | `"R22: recibir por guía mete la orden en el listado sin recargar la página"`. Afirma **las dos cosas**: que la lectura paginada se repitió (`mutate()` no es un no-op) **y** que la fila aparece. Sólo lo segundo dejaría pasar un `mutate()` que devolviera lo mismo; sólo lo primero, una revalidación que no llega a pintarse |

El andamiaje `renderModule` deja de pasar `porRecibir` y el tipo `GruposBodega` deja de
declararlo (T4.1e).

### `tests/components/PorAceptarSection.test.tsx` (T4.2)

Tres casos con el botón por sujeto —`"'aceptar' por-orden invoca onAceptarUna"`,
`"NO ofrece acción en lote"` y `"con mostrarAcciones=false lista sin botones"`— **se funden
en dos**: uno con la tarjeta POR DEFECTO y otro con `renderItem`, porque el consumidor real
usa el segundo camino y una ausencia afirmada sólo por el primero no vigila la pantalla que
existe. Positivos: título, banner, cada orden y el número de `listitem`. Lo que muere con el
código es el cableado botón→id: **no hay acción equivalente** que reponer, y el camino vivo
(el QR) ya lo afirma `EscanerRecepcion.test.tsx`, sin editar.

### T4.3b — los seis montajes restantes (más el séptimo, que la 3B ya había tocado)

`SatelitePaginacion`, `SateliteDescarga`, `ManifiestoFlujos`, `CambiarDiaRepartoListados`,
`RecepcionSateliteIncidente`, `deshacer-asignacion.ui` y `SateliteSeleccionOtrasPaginas`:
fuera la prop `porRecibir`. Dos necesitaron algo más que quitar una línea:

- **`deshacer-asignacion.ui.test.tsx`** tenía el caso `"R36: la sección 'Por recibir' NO
  ofrece deshacer"`, que inyectaba una orden `en_ruta_bodega_satelite` sólo para eso.
  **Reexpresado** a `"R36/R18: «En bodega» no monta la región 'Por recibir'"`, con positivo
  (el listado con su fila) y afirmando además que la orden inyectada ya no aparece.
- **`SateliteSeleccionOtrasPaginas.test.tsx`** tenía la constante `POR_RECIBIR`, viva sólo
  para dar un botón que releyera. Se retira: su sustituto (el QR, que la 3B ya cableó) no
  necesita ninguna orden montada porque el escáner está siempre.

### `tests/components/RecepcionSatelitePage.test.tsx` (T4.4) — de una ruta a tres

Tres bloques: el redirect, «Por recibir» y «En bodega». **Ningún caso de acceso por rol se
perdió**: los cuatro de la pantalla única se ejecutan ahora **contra las dos páginas** (ocho
casos), con la misma tabla de roles. Añadidos:

- R13: el redirect **no resuelve la sesión y no llama a ninguna de las seis lecturas** — se
  afirma mock a mock, no de pasada.
- R14: el destino del redirect **coincide con `primerDestino`** del `adminSatelite`. El
  esperado del aterrizaje va literal (no se deriva del redirect) y luego se comparan.
- R16: «Por recibir» hace **exactamente una** lectura; las otras cinco, ninguna.
- R44: cada pantalla muestra SU descripción y **ninguna dice «Mis asignaciones»**.

### `tests/components/PorRecibirModule.test.tsx` (T4.5) — nuevo, 10 casos

Además de los heredados: `"R5: la tarjeta no monta pie de acciones"` (afirma que hay
**exactamente un** control y es el del detalle), `"R28/R42: con zona y la lista VACÍA se dice
el vacío Y el escáner sigue ofreciéndose"` —el caso que el humano firmó—, `"R21: tras recibir
por guía se relee del servidor"` (positivo: la acción se invocó **con la guía tecleada**, no
es un no-op) y `"R16/R24: no monta listado, filtros, paginación, acciones de lote ni los
avisos de bodega"`, con nueve ausencias sostenidas por un positivo: las dos tarjetas.

## 16. Tanda 5 — la guardia nueva y las cinco mutaciones

**T5.1 — `tests/unit/guards/satelite-sin-boton-aceptar.guardia.test.ts`** (44 casos).
Ámbito: los cuatro archivos de pantalla **más** los dos de servidor de los que se retiró el
lote. Prohibidos en código ejecutable (leído con `quitarComentarios`, para juzgar lo que se
ejecuta y no la explicación de por qué ya no está): `recibirLote`, `recibirLoteSchema`,
`onAceptarUna`, `textoBotonUna`, `mostrarAcciones`, `aceptarRecepcion`. Más:

- la **otra vía** de reintroducción: que ninguno de los dos módulos de la sección importe
  `Button` ni monte un `<Button>` — que es exactamente como el botón estaba duplicado antes;
- **R4** sobre el texto CRUDO (lo que R4 corrige es la documentación), con su propio anclaje;
- **R33**: ninguna línea que nombre una subruta del satélite abre un bloque de comentario;
- **anti-vacuidad en tres capas (R31)**: los seis archivos existen; el texto **ya barrido**
  de cada uno conserva su anclaje positivo (`EscanerRecepcion`, `SateliteOrdenesListado`,
  `RecepcionDetalle`, `PorAceptarSection`, y en los dos de servidor el camino del QR —
  `recibirPorQr` y `recibirSchema`—, así que la misma pasada que comprueba que el lote no
  está demuestra que el QR sigue); y un caso que aplica los seis prohibidos a una **cadena de
  control** con el botón dentro y exige que los detecte **todos**.

**El sidebar queda FUERA de ese censo de fuente, con el motivo escrito** (R32) y apuntando a
la medida de T0.1. Sus dos casos se juzgan sobre el **valor importado `SIDEBAR_ITEMS`**, con
anti-vacuidad (`SIDEBAR_ITEMS.length > 5`, para que una lista recortada no apruebe el
vacío), y uno de ellos hace algo que un censo de texto no puede: comprobar que las dos
subrutas del menú **corresponden a `page.tsx` que existen** en el árbol.

### T5.2 — cinco mutaciones, una a una, todas revertidas

| # | Mutación | Resultado |
| --- | --- | --- |
| **(a)** | Devolver un `<Button>Aceptar</Button>` dentro del `renderItem` de cada tarjeta | 🔴 **ROJO**, `3 failed \| 51 passed`. Muertes: T4.5 `"R1/R2 … SIN ningún botón"` y `"R5: no monta pie de acciones"`, **y** T5.1 `"ninguno de los dos módulos importa Button"` |
| **(b)** | Devolver `onAceptarUna` + `textoBotonUna` (y el botón) a `PorAceptarSection` | 🔴 **ROJO**, `3 failed \| 47 passed`. Muertes: T5.1 (los dos prohibidos, uno por caso) y T4.2 `"no pinta NINGÚN botón con la tarjeta por defecto"` |
| **(d)** | Quitar los `children` del ítem del menú | 🔴 **ROJO**, `13 failed \| 130 passed` en **6 archivos**: `destino-post-login`, `menu-visibility` (R8, R9, R10, R12, R46, aterrizaje y R54), `AppLayout`, `Sidebar`, la guardia nueva y `RecepcionSatelitePage` (R14) |
| **(e)** | Condicionar el escáner a que la lista no esté vacía (en las DOS pantallas) | 🔴 **ROJO**, `3 failed \| 45 passed`: T4.5 `"R28/R42 … lista VACÍA"` y `"R42: con zona ofrece cámara…"`, y T4.1(d) `"R42/R43: el escáner NO depende de la lista"` |
| **(f)** | Volver a escribir el comodín en el comentario del menú | 🔴 **ROJO**, `2 failed \| 89 passed`: T1.6 entero — `"R45: ninguna línea abre un bloque…"` **y** `"R46: el fuente barrido conserva el ÚLTIMO ítem y las dos subrutas"` |

Las mutaciones **(c)** —quitar el `mutate()` de `releerBodega`— y **(g)** —romper la guarda
de zona ajena de `recibir()`— están medidas arriba, en §6, como **D** y **A**.

Un detalle de (f) que conviene no leer al revés: la que la mató fue **T1.6**, no el caso R33
de la guardia nueva. Es correcto — R33 vigila las líneas que nombran **subrutas del
satélite**, y el comodín reintroducido es de `/mis-asignaciones`. Las dos reglas cubren
tramos distintos a propósito.

`git diff` tras revertir las cinco: sin rastro en `lib/auth/menu-visibility.ts`,
`PorRecibirModule.tsx`, `RecepcionSateliteModule.tsx` ni `PorAceptarSection.tsx`.

## 17. Tanda 6 — arrastres y gate

**T6.1 — e2e.** Cuatro `goto` reapuntados: `e2e/recepcion-satelite.spec.ts` →
`/recepcion-satelite/por-recibir`; `e2e/asignacion-satelite.spec.ts` y las **dos** de
`e2e/reglas-bloqueos-cierre.spec.ts` → `/recepcion-satelite/en-bodega`. **NO se afirma que
estos specs pasen**: siguen sin ejecutarse en este repo (lo dice su propia cabecera), así que
esto es una corrección de ruta por lectura, y así queda escrito en cada uno.

**T6.2 — `docs/release.md`.** «Corregir el día desde `/recepcion-satelite`» pasa a
`/recepcion-satelite/en-bodega`, que es donde vive esa acción.

**T6.4 — gate COMPLETO**, no el rápido: el diff de la rama toca `lib/types/`. Antes se corrió
`pnpm run db:generate`, porque el cliente de Prisma se comparte entre ramas en esta máquina y
uno rancio pone rojo el gate con errores de archivos que la rama no tocó. El `INIT_EXIT=$?`
se escribió DENTRO del log y el log **no** se canalizó por `tail`.

Log: `progress/gate_278_frontend.log`.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=4)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso            (0 errors, 101 warnings — las MISMAS 101 preexistentes que midio
                        la mitad de servidor; ninguna en los archivos de esta entrega)
✓ test paso
  Test Files  1377 passed (1377)
  Tests       18754 passed | 26 skipped (18780)
  Duration    378.11s
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El aviso de `down.sql` es **preexistente y ajeno** (familia `ruta_*`); esta entrega no
añade ninguna migración: `git status db/` vacío y el diff de la mitad de frontend no toca
`db/`, `lib/services/`, `lib/repositories/`, `lib/actions/` ni `lib/interfaces/`.

### Las DOS corridas rojas de antes, y por qué no lo eran

Se dice porque un gate que sale verde a la tercera merece que se cuente qué pasó en las dos
primeras. **Ninguna de las tres fallas era de esta rama, y las tres se reprodujeron en
verde al correrlas aisladas.**

| Corrida | Qué salió rojo | Qué era |
| --- | --- | --- |
| 1ª | `tests/guards/tarifa-status-retirado.guard.test.ts` → `Test timed out in 20000ms` (tardó 29,5 s) | **Timeout bajo carga.** Aislado: **1,10 s, 8/8 en verde**. Es un censo que recorre `lib/`, `app/` y `tests/`; con 1.377 archivos en paralelo no le llega el turno |
| 1ª | `tests/unit/guards/ancla-de-carga.guardia.test.ts` | **UN DEFECTO REAL, Y ERA MÍO** — ver abajo. Arreglado |
| 2ª | `tests/integration/repositories/financiera-cubo-temporal.integration.test.ts` → «la ventana de 2019 ya tenía movimientos de caja: el fixture no es aislado» | **Base local compartida.** Otro test escribió `MovimientoCaja` en esa ventana mientras éste comprobaba que estaba vacía. Aislado: **1,02 s, 7/7 en verde**. Esta entrega no toca ni una línea de dinero, de repositorio ni de base |

### El defecto real que encontró el gate, y que no lo encontró la tanda 5

`ancla-de-carga.guardia.test.ts` denunció **las dos esperas del caso R22 nuevo** (T4.1b):

```
tests/components/RecepcionSateliteModule.test.tsx:414 — expect(within(listado()).getAllByText(/REM-B1/).length).toBeGreaterThan(0)
tests/components/RecepcionSateliteModule.test.tsx:445 — expect(within(listado()).getAllByText(/REM-NUEVA/).length).toBeGreaterThan(0)
```

Y tenía razón: **un `.length > 0` no distingue la pantalla asentada de la que todavía está
pintando el esqueleto**, porque durante la carga la tabla ya tiene su cabecera y su fila
`role="status"`. Las dos se reescribieron ancladas al CONTENIDO
(`expect(listado()).toHaveTextContent("REM-NUEVA")`).

> ⚠️ **ESTA REMEDICIÓN ESTABA MAL, y la corrige §20.** Aquí se escribió que con el `mutate()`
> fuera el caso se ponía rojo `1 failed | 37 passed`. **Ese número es la foto de `-t`, no la
> del gate**: la remedición se hizo corriendo el archivo aislado, y así escrita **no
> reproduce**. En corrida completa el archivo se quedaba **verde 38/38**. Lo destapó la
> revisión, es el bloqueante **B2**, y está medido de nuevo —esta vez con la suite entera—
> en **§20**.

Es, además, el argumento de por qué el gate completo va entero y no por partes: **este
defecto no lo veía ninguna de las cinco mutaciones de T5.2**, porque no era un fallo de la
pantalla sino de cómo la estaba mirando el test. Lo que §20 añade es el segundo filo del
mismo cuchillo: tampoco lo veía **remedir en aislado**.

## 18. Trazabilidad de esta entrega — R1…R33 y R42…R47

| R | Dónde queda afirmado |
| --- | --- |
| R1 | `PorRecibirModule.test.tsx` «R1/R2 … SIN ningún botón» + guardia T5.1 · mutación **(a)** |
| R2 | `PorRecibirModule.test.tsx` «R1/R2» (remisión, estado legible, detalle desplegable) y «R2: el banner cuenta» |
| R3 | `PorAceptarSection.test.tsx` (los dos caminos: tarjeta por defecto y `renderItem`) + typecheck · mutación **(b)** |
| R4 | guardia T5.1, caso sobre el texto crudo de `PorAceptarSection.tsx` |
| R5 | `PorRecibirModule.test.tsx` «R5: no monta pie de acciones» + typecheck (la prop no existe) |
| R6 | `EscanerRecepcion.test.tsx` (sin editar) + `PorRecibirModule.test.tsx` «R6: cámara y número tecleado» |
| R7 | `git status db/` vacío; en `lib/` sólo lo de §3 (esta mitad no tocó servidor salvo `lib/auth/menu-visibility.ts`) |
| R8 | `menu-visibility.test.ts` «R8: … declara Por recibir (primero) y En bodega», sobre `SIDEBAR_ITEMS` |
| R9 | `AppLayout.test.tsx` (disparador + dos subenlaces) + `menu-visibility.test.ts` «R9: el href del padre…» |
| R10 | `menu-visibility.test.ts` «R10: … sólo los alcanza el adminSatelite», con positivo antes de las cinco ausencias |
| R11 | `Sidebar.test.tsx` «con la ruta de un subítem del satélite activo…» |
| R12 | `destino-post-login.test.ts` (literal a mano) + `menu-visibility.test.ts` «R12» y el R54 de la 192 |
| R13 | `RecepcionSatelitePage.test.tsx` bloque 1, los dos casos |
| R14 | `RecepcionSatelitePage.test.tsx` «R14: el destino del redirect coincide con el aterrizaje» |
| R15 | `RecepcionSatelitePage.test.tsx` bloque 2 + `PorRecibirModule.test.tsx` |
| R16 | `RecepcionSatelitePage.test.tsx` «R16: … sólo hace UNA lectura» + `PorRecibirModule.test.tsx` «R16/R24» |
| R17 | `RecepcionSatelitePage.test.tsx` bloque 3 + los casos vigentes del listado en `RecepcionSateliteModule.test.tsx` |
| R18 | `RecepcionSateliteModule.test.tsx` «R18: … NO la región 'Por recibir'» + typecheck (la prop no existe y nada la sustituye) |
| R19 | `RecepcionSatelitePage.test.tsx`, bloques 2 y 3, tres casos cada uno |
| R20 | `RecepcionSatelitePage.test.tsx`, H1 «Por recibir» / «En bodega» |
| R21 | `PorRecibirModule.test.tsx` «R21: tras recibir por guía se relee del servidor» |
| R22 | `RecepcionSateliteModule.test.tsx` «R22: … sin recargar la página» · mutación **(c)** = **D** de §6 |
| R23 | casos vigentes de `RecepcionSateliteModule.test.tsx` + `SateliteSeleccionOtrasPaginas.test.tsx` |
| R24 | `RecepcionSateliteModule.test.tsx` (bloqueo, cierres, liberadas) + `PorRecibirModule.test.tsx` «R16/R24» |
| R25 | las DOS pantallas contra `AVISO_SIN_ZONA_SATELITE`, el literal exportado |
| R26 | `PorRecibirModule.test.tsx` «R26/R43: sin zona sólo el aviso» |
| R27 | `RecepcionSateliteModule.test.tsx` «R25/R27: … pero el listado sigue» |
| R28 | `PorRecibirModule.test.tsx` «R28/R42: … lista VACÍA» · mutación **(e)** |
| R29 | los tres archivos reexpresados (§15), cada ausencia con su positivo · mutaciones **(a)** y **(b)** |
| R30 | `satelite-sin-boton-aceptar.guardia.test.ts` (36 casos de prohibidos + la vía del `<Button>` propio) |
| R31 | esa guardia: existencia, anclaje en el texto barrido y la cadena de control que dispara |
| R32 | `menu-visibility.test.ts` sobre `SIDEBAR_ITEMS` + el bloque final de la guardia, que declara el sidebar fuera del censo de fuente y dice por qué |
| R33 | la guardia, caso «ninguna línea que nombre una subruta del satélite abre un bloque» |
| R42 | `PorRecibirModule.test.tsx` «R28/R42» + `RecepcionSateliteModule.test.tsx` «R42/R43» · mutación **(e)** |
| R43 | `PorRecibirModule.test.tsx` «R26/R43» + `RecepcionSateliteModule.test.tsx` «R25/R27» |
| R44 | `RecepcionSatelitePage.test.tsx`, bloques 2 y 3: cada descripción propia y ninguna dice «Mis asignaciones» |
| R45 | `menu-visibility.test.ts` «R45: ninguna línea abre un bloque…» · mutación **(f)** |
| R46 | `menu-visibility.test.ts` «R46: … el ÚLTIMO ítem y las dos subrutas» + los dos juegos de números de §11 |
| R47 | `git diff tests/fixtures/sin-comentarios.ts`, vacío |

## 19. Lo que un revisor debe mirar con lupa

1. **La medida de §11 es reproducible pero el script se borró** (T0.1 lo exige). Lo que
   queda vivo es la PERTENENCIA, no el número: T1.6 afirma que el último ítem y las dos
   subrutas se ven, y eso no caduca cuando el archivo crezca.
2. **El caso R22 mide dos cosas y hacen falta las dos.** Ver §15; si alguien recorta una,
   el `mutate()` puede volverse un no-op sin que nada se ponga rojo.
3. **Los e2e no se ejecutan.** Las cuatro rutas se corrigieron por lectura y así está dicho.
4. **`RecepcionSateliteModule.tsx` no se renombró** aunque ahora sea el módulo de «En
   bodega»: el motivo (cuatro registros por ruta + la guardia de contadores de cabecera)
   está escrito en su cabecera.
5. **La ficha decía «79 líneas» y son 151.** Corregido en `feature_list.json`.
6. **El gate salió verde a la tercera** y las dos rojas están contadas en §17: un timeout
   bajo carga, una base local compartida y un defecto de ancla que era mío.
7. **§20 corrige a §17**: la remedición del caso de R22 que dejé escrita ahí era la foto de
   `-t` y no reproducía en la suite. Es el bloqueante **B2**, y la medida buena —los dos
   números en corrida completa, con y sin `mutate()`— está en §20.

---

## 20. B2 — el caso de R22 no mordía en el gate, sólo aislado (2026-08-24)

**Bloqueante de la revisión, y era real.** El reviewer quitó el `mutate()` de `releerBodega`
y `tests/components/RecepcionSateliteModule.test.tsx` se quedó **verde 38/38, en 3 corridas
de 3**. Sólo caía ejecutado aislado con `-t`. La remedición que yo había escrito en §17
—«1 failed | 37 passed»— era la foto de `-t` y **no reproducía en la suite**.

### La causa, medida por el reviewer y confirmada aquí

`lecturasAntes` valía **0 en la corrida completa** y **1 en la aislada**. Es decir: cuando el
caso fotografiaba el contador, **la revalidación que SWR dispara al montar todavía no había
aterrizado**. De ahí salían las dos mitades falsas:

- el «+1» que el caso leía como «la relectura ocurrió» lo producía **el montaje**, no el
  `mutate()`;
- y la fila nueva la traía **esa misma lectura de montaje**, porque para cuando llegó, la
  respuesta del servidor ya se había cambiado.

Las dos afirmaciones pasaban por la razón equivocada. Lo que las dejaba pasar no era la
falta de una tercera aserción: era que **el punto de partida no estaba probado**.

Y no era una regresión suelta: la misma mutación **sí** ponía rojo
`SateliteSeleccionOtrasPaginas` (3 de 9). Lo que fallaba es que el test que la tabla de
trazabilidad nombra **para R22** no verificaba su mitad.

### El arreglo: un punto de partida PROBADO, no una espera más larga

El servidor responde primero una fila **sentinela** (`REM-MONTAJE`) que **no viene en el
`fallbackData`** que baja la página. Verla en la tabla demuestra —en el DOM, no en un
contador— que la revalidación de montaje ya aterrizó. **Sólo entonces** se cambia lo que el
servidor responde. A partir de ahí, cualquier lectura posterior sólo puede venir del
`mutate()`.

Para poder cambiar la respuesta ENTRE las dos lecturas hizo falta una escotilla en
`renderModule`: con `mockResolvedValue` el valor queda congelado antes del `render` y se lo
lleva el montaje, así que el caso de R22 —y sólo él— instala una `mockImplementation`. Los
otros 37 casos del archivo siguen igual.

**La propiedad doble se conserva**, que es lo que impide que recortar una mitad devuelva el
`mutate()` a ser un no-op:

1. hubo una lectura **nueva** después del punto de partida probado, y
2. lo que trajo **se pintó**: entra `REM-NUEVA` **y sale** `REM-MONTAJE`.

Más una tercera aserción que ahora está etiquetada como lo que es: `refreshMock` es
**compañía, no discriminante** — `router.refresh()` se sigue llamando sin `mutate()`.

Y el baseline dejó de suponerse: `expect(lecturasAntes).toBeGreaterThan(0)` deja **el propio
defecto de B2 clavado como aserción**. Si mañana la foto vuelve a tomarse antes de tiempo,
el caso se pone rojo por eso y no por otra cosa.

### La remedición, ESTA VEZ EN CORRIDA COMPLETA (`pnpm test`, no `-t`)

| | Suite entera CON `mutate()` | Suite entera SIN `mutate()` |
| --- | --- | --- |
| **Total** | `Test Files 1377 passed (1377)` · `Tests 18754 passed \| 26 skipped` · `TEST_EXIT=0` | `Test Files 2 failed \| 1375 passed (1377)` · `Tests 4 failed \| 18750 passed \| 26 skipped` · `TEST_EXIT=1` |
| **`RecepcionSateliteModule.test.tsx`** | **38 passed** | **38 tests \| 1 failed** ← el caso de R22 |
| **`SateliteSeleccionOtrasPaginas.test.tsx`** | 9 passed | 9 tests \| 3 failed |

El fallo del caso de R22, literal: `AssertionError: expected 1 to be greater than 1`. Es la
mitad (1): el punto de partida quedó asentado en **1** —ya no en 0— y el contador **no se
movió**, porque sin `mutate()` no hay segunda lectura. Antes del arreglo, ese mismo número
era `0 → 1` y pasaba.

### Punto 4 del encargo — ¿hay más casos con el mismo vicio?

El vicio necesita **dos** ingredientes: un **delta contra una foto** y un **productor de
fondo** que mueva el contador solo. Censados los archivos de esta entrega, sólo hay **dos**
sitios con esa forma, y **los dos se midieron en corrida completa** en vez de razonarse:

| Sitio | Forma | Medida en la suite entera | Veredicto |
| --- | --- | --- | --- |
| `RecepcionSateliteModule.test.tsx` — caso de R22 | delta + SWR | era el defecto | **Arreglado**, arriba |
| `deshacer-asignacion.ui.test.tsx:494` — `"R38 — revalida el listado…"` | delta + SWR | sonda `expect(llamadasPrevias).toBeGreaterThan(0)` inyectada y corrida en la suite entera: **PASA** | **Sano.** Su foto se toma tras varias interacciones `await`, así que la revalidación de montaje ya aterrizó. No es mío (feature 149/184) y no se toca |

El resto de mis aserciones sobre dobles **no son deltas**, así que el vicio no les aplica:
`RecepcionSatelitePage.test.tsx` juzga Server Components (sin SWR) con `toHaveBeenCalled` /
`not.toHaveBeenCalled` absolutos, y `PorRecibirModule.test.tsx` monta un módulo **sin SWR**.

Aun así, el de `PorRecibirModule` es el hermano directo del que falló, así que **se midió en
vez de argumentarse**: quitando el `router.refresh()` de su `onRecibida` y corriendo **la
suite entera**, `PorRecibirModule.test.tsx` sale `10 tests | 1 failed` en
`"R21: tras recibir por guía se relee del servidor"`. Muerde donde tiene que morder.

Las tres mutaciones/sondas de esta tanda quedaron **revertidas**: `git diff` de `app/` y de
`tests/unit/components/` vacío antes de commitear.

### La lección, que es la del bloqueante y no la del test

**«Pasa aislado» y «pasa en la suite» no son la misma medida**, y para una remedición la que
vale es la de la suite. Aislado, cada archivo arranca con sus temporizadores y su caché
limpios y las cosas ocurren en el orden que uno espera; dentro de 1.377 archivos en
paralelo, no. Una mutación remedida con `-t` puede estar midiendo un mundo que el gate no
tiene — y eso fue exactamente lo que dejó pasar B2.

### Gate tras cerrar B2

`./init.sh` **completo** de nuevo sobre el árbol con el caso ya arreglado (precedido de
`pnpm run db:generate`; `INIT_EXIT=$?` dentro del log, sin `tail`). Verde **a la primera**:

```
✓ typecheck   ✓ lint (0 errors, 101 warnings preexistentes)   ✓ test
Test Files  1377 passed (1377)
Tests       18754 passed | 26 skipped (18780)
Duration    384.22s
== init OK ==
INIT_EXIT=0
```

El conteo total **no cambia** respecto al gate de §17 —18.754— porque B2 no añadió ni quitó
casos: reescribió uno para que midiera lo que decía medir.
