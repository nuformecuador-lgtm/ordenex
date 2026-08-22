# Feature 260 — bitácora del BLOQUE 0 y el BLOQUE BACKEND

> Agente: `backend_dev`. Rama: `feat/260-detalle-orden-completa`. Sin commit y sin PR.
> Alcance cerrado aquí: **T0.1 · T0.2 · T0.3 · B1 · B2 · B3 · B4 · B5 · B6 · B7 · B8 · B9 · B10**.
> **Fuera de este bloque:** F1–F7, V1, C1–C5. Lo que eso implica está en «Lo que queda abierto».

---

## 1. Veredicto en una línea

El detalle del tablero ya produce **la orden completa por el camino que ya la produce**, recortada
por alcance en el servidor: 401 tests de la feature en verde, 1.927 guardias en verde, lint sin
errores, y **`pnpm typecheck` con 11 errores, todos dentro de los dos archivos de frontend que
F1/F3/F4 tienen que migrar** — que es exactamente el inventario que T0.2 anunciaba.

---

## 2. Archivos tocados

### Contrato (BLOQUE 0)

| Archivo | Qué |
| --- | --- |
| `lib/types/orden.ts` | **T0.1** — `OrdenTiendaRef.email` y `.telefono` pasan a opcionales, con el porqué escrito (hace representable el recorte de R13 sin un tipo paralelo ni un cast). |
| `lib/types/tablero-dia.ts` | **T0.2/T0.3** — `OrdenDetalleDia` pasa a `OrdenListItemDTO & { resultadoDelDia; asignadoAt }`; `DetalleMensajeroDia` gana `alcance`; nace `AlcanceTableroDia`; nacen `CAMPOS_SOLO_ALCANCE_GLOBAL` (con su `satisfies`) y `recortarPorAlcance`. |
| `lib/types/alcance-tablero.ts` | **NUEVO, y es una desviación del design** — ver §5.1. Módulo **sin un solo import** que declara `FiltroAlcanceTablero`. |

### Backend

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/repositories/ITableroDiaRepository.ts` | **B1** — `PaginaOrdenesDelDia` pasa a `{ filas: FilaDelDia[]; total }`, con `FilaDelDia = { ordenId, resultadoDelDia, asignadoAt }`. Reexporta `FiltroAlcanceTablero` desde el módulo nuevo (los importadores de la 192 no se enteran). |
| `lib/repositories/TableroDiaRepository.ts` | **B2** — el `SELECT` de la 2ª consulta pierde `num_guia`, `s."value"`, `destinatario`, `direccion` y el `JOIN "order_status"`. Nada más se toca: mismo CTE, mismo `LATERAL`, mismo `COUNT(*) OVER ()`, mismo `ORDER BY`, mismo `LIMIT/OFFSET`, **misma posición en el archivo**. |
| `lib/interfaces/repositories/IOrdenRepository.ts` | **B3** — declara `findListItemsByIds(ids, filtro)`. |
| `lib/repositories/OrdenRepository.ts` | **B3** — lo implementa reusando `WITH_ESTATUS_Y_TIENDA` y `toListItemDTO`; `deletedAt: null`; `zonaId` sólo con alcance `zona`; lista vacía ⇒ `[]` sin consultar. |
| `lib/services/TableroDiaService.ts` | **B5/B6** — el constructor gana `ordenes` e `historial` **obligatorios** (la caché se va al final); `detalle` compone los seis pasos del design §4. |
| `lib/actions/tablero-dia.ts` | **B6** — `construirServicio()` cablea `OrdenRepository` y `OrdenHistorialService` sobre el mismo cliente Prisma. |

### Tests nuevos

| Archivo | Cubre |
| --- | --- |
| `tests/fixtures/orden-detalle-dia.ts` | Fixture compartido: `OrdenListItemDTO` **completo** con los cinco campos restringidos marcados con **centinelas**. Lo van a necesitar también F5 y V1(c). |
| `tests/unit/tablero-dia/recorte-por-alcance.test.ts` | R13, R17, R43, R46 — la mitad **dato** del recorte, sobre la función pura. |
| `tests/unit/tablero-dia/detalle-contrato.test.ts` | R1, R18, R43 — asignabilidad y **techo de superficie** (por tipo y por valor). |
| `tests/unit/repositories/orden-repository-list-items-by-ids.test.ts` | R2, R5, R11, R19, R40 — el `where` y que el `include` es **el mismo objeto** que el de `list()`, derivado de la propia llamada. |
| `tests/unit/services/tablero-dia-detalle-hidratacion.test.ts` | R4, R5, R6, R7, R9, R10, R11, R12, R13, R18, R40, R46. |
| `tests/integration/orden-list-items-by-ids.test.ts` | **B4** — el `WHERE` contra Postgres: la borrada y la de otra zona no vuelven aunque su id vaya en la lista. |

### Tests modificados

`tests/unit/services/_doble-tablero-dia.ts` (dobles `OrdenesDoble`/`HistorialDoble` + `servicioDelTablero`),
`tests/unit/services/tablero-dia-{alcance,cache,cache-aislamiento.guardia,filas,ritmo,detalle-alcance}.test.ts`,
`tests/unit/services/{bulk-orden-service,bulk-orden-service.carga-api,orden-service,rol-admin-satelite-authz}.test.ts`
(los cuatro dobles de `IOrdenRepository` ganan el método nuevo),
`tests/unit/actions/tablero-dia-detalle-accion.test.ts` (**B7**),
`tests/unit/repositories/tablero-dia-detalle-sql.test.ts` (**B2**),
`tests/unit/tablero-dia/sumar-totales.test.ts` (§5.2),
`tests/unit/tablero-dia/_arbol-de-la-feature.ts` (el módulo nuevo entra en el censo),
`tests/integration/_semilla-tablero-dia.ts` (tarifa activa, `montoCobrar`, `servicioReal`),
`tests/integration/tablero-dia-detalle-{aislamiento,cuadre}.test.ts` (**B8/B9**),
`tests/integration/tablero-dia-dia-reparto.test.ts`.

---

## 3. Salida real de los comandos

### `pnpm run typecheck` — **ROJO, 11 errores, todos de frontend**

```
> tsc --noEmit

app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx(78,83): error TS2551: Property 'estatus' does not exist on type 'OrdenDetalleDia'. Did you mean 'estatusId'?
app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx(111,20): error TS2339: Property 'cliente' does not exist on type 'OrdenDetalleDia'.
app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx(112,62): error TS2339: Property 'destino' does not exist on type 'OrdenDetalleDia'.
app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx(215,15): error TS2322: Type '"ordenId"' is not assignable to type 'keyof OrdenDTO | ...'
tests/components/DetalleMensajeroPanel.test.tsx(138,3): error TS2322: Type 'string' is not assignable to type 'number'.
tests/components/DetalleMensajeroPanel.test.tsx(148,3): error TS2741: Property 'alcance' is missing in type '{ ... }' but required in type 'DetalleMensajeroDia'.
tests/components/DetalleMensajeroPanel.test.tsx(298,17): error TS2353: Object literal may only specify known properties, and 'ordenId' does not exist in type 'Partial<OrdenDetalleDia>'.
tests/components/DetalleMensajeroPanel.test.tsx(299,33): error TS2322: Type 'string' is not assignable to type 'number'.
tests/components/DetalleMensajeroPanel.test.tsx(525,34): error TS2322: Type 'string' is not assignable to type 'number'.
tests/components/DetalleMensajeroPanel.test.tsx(529,7): error TS2741: Property 'alcance' is missing in type '{ ... }' but required in type 'DetalleMensajeroDia'.
tests/components/DetalleMensajeroPanel.test.tsx(663,51): error TS2322: Type 'string' is not assignable to type 'number'.
 ELIFECYCLE  Command failed with exit code 2.
```

**Los 11 viven en DOS archivos y los DOS son del bloque frontend** (`F1`/`F3`/`F4`). No es un
descuido de este bloque: es lo que T0.2 declaraba como su criterio de «hecho» —«`pnpm typecheck`
señala exactamente los consumidores que hay que migrar, y esa lista roja ES el inventario del
trabajo restante»—. Ver §6.1: **el backend no puede dejar el typecheck verde sin invadir el bloque
que no le toca.**

Traducción del inventario para quien haga F3/F4: `orden.estatus` → `orden.estatusValue`,
`orden.cliente` → `orden.destinatario`, `orden.destino` → `orden.direccion`, `rowKey="ordenId"` →
`rowKey="id"`, `numGuia` pasa de `string | null` a `number | null`, y el fixture del detalle
necesita `alcance`.

**Y una comprobación aparte, porque T0.1 se declara verde por su cuenta:** ni uno de los 11 errores
menciona `email` ni `telefono`. Aflojar esos dos campos **no rompió a ningún consumidor**, que es lo
que `design.md §1.10` había medido y lo que yo verifiqué antes de tocarlos
(`grep` sobre `lib/`, `app/`, `tests/`: se escriben en `OrdenRepository.toRelaciones` y no los lee
nadie; el `row.tienda.telefono` de `GestionOrdenRepository.ts:272` sale de un `select` propio y va
al DTO de la 157).

### `pnpm run lint` — **VERDE**

```
✖ 99 problems (0 errors, 99 warnings)
LINT_EXIT=0
```

99 warnings es la línea base del árbol: la corrida intermedia dio 101 porque este bloque dejó dos
imports sin uso al cambiar el constructor del servicio (`tablero-dia-cache.test.ts` y
`tablero-dia-filas.test.ts`); se quitaron y volvió a 99. **Cero errores, cero warnings nuevos.**

### Los tests de la feature — **VERDE**

```
$ pnpm exec vitest run tests/unit/tablero-dia tests/unit/services/tablero-dia-*.test.ts \
    tests/unit/repositories/tablero-dia-*.test.ts \
    tests/unit/repositories/orden-repository-list-items-by-ids.test.ts \
    tests/unit/actions/tablero-dia-*.test.ts tests/integration/tablero-dia-*.test.ts \
    tests/integration/orden-list-items-by-ids.test.ts

 Test Files  34 passed (34)
      Tests  401 passed (401)
   Duration  4.46s
VITEST_EXIT=0
```

Los de integración **se ejecutaron de verdad** contra Postgres (no `describe.skip`): hay
`DATABASE_URL` en el entorno y los casos de `tablero-dia-detalle-*` y `orden-list-items-by-ids`
aparecen como `passed`, no como `skipped`. Y no son verdes por falta de datos: la mutación 1 de §4
los pone rojos con datos sembrados.

### `pnpm exec vitest related --run <los 9 archivos de código tocados>` — **VERDE**

```
 Test Files  281 passed (281)
      Tests  3824 passed | 17 skipped (3841)
   Duration  157.18s
RELATED_EXIT=0
```

### `pnpm run test:guardias` — **VERDE**

```
 Test Files  128 passed (128)
      Tests  1927 passed (1927)
   Duration  13.36s
GUARDIAS_EXIT=0
```

> El gate `./init.sh` **completo** lo corre el leader (`AGENTS.md > Regla del gate`), y esta ficha
> va al completo sin excepción porque toca `lib/types/**`. Aquí no se corrió.

---

## 4. Las mutaciones — ejecutadas, no afirmadas

Ocho mutaciones, una a una, aplicadas · ejecutadas · revertidas · verificado el revert. **Ninguna
corrió en paralelo con nada**, y al terminar `grep -rn "MUTACION" lib/ tests/` no devuelve una sola
línea de este bloque.

| # | Mutación | Qué se puso rojo (salida real) |
| --- | --- | --- |
| 1 | `findListItemsByIds` pierde `deletedAt: null` | **5 rojos.** Integración: `expected [ …(3) ] to not include '11d0787a-…'`. Unitario: `expected { id: { in: [ 'a','b' ] } } to deeply equal { id: …, deletedAt: null }` |
| 2 | `findListItemsByIds` pierde el `zonaId` | **2 rojos.** Integración: `expected [ …(2) ] to deeply equal [ Array(1) ]`. Unitario: `expected { Object (id, deletedAt) } to deeply equal { id, deletedAt, zonaId }` |
| 3 | el servicio hidrata con `{ tipo: "global" }` en vez del filtro autorizado | **1 rojo.** `expected { tipo: 'global' } to deeply equal { tipo: 'zona', …(1) }` |
| 4 | `recortarPorAlcance` devuelve la orden sin tocar | **7 rojos.** `el centinela FLETE-CENTINELA sobrevivio al recorte de alcance zona`; y de extremo a extremo contra Postgres: `expected '{"mensajeroId":"06ad75ae-…' not to contain '9999999.99'` |
| 5 | el servicio deja de llamar a `recortarPorAlcance` | **2 rojos.** `el centinela FLETE-CENTINELA viajo al cliente en alcance zona` + el de integración con el importe de la tarifa |
| 6 | el servicio deja de reimponer el orden de la página | **4 rojos.** `expected [ 'o2','o1','o3' ] to deeply equal [ 'o3','o1','o2' ]` |
| 7 | se pierde el corto-circuito de la página vacía (R5) | **2 rojos.** `expected [ { ids: [], …(1) } ] to deeply equal []`, y el de los tres casos malos: `expected [ { ids: [], filtro: {…} }, …(2) ] to deeply equal []` |
| 8 | la hidratación declara un `include` propio en vez de `WITH_ESTATUS_Y_TIENDA` | **5 rojos.** Unitario: `expected { estatus: {…} } to deeply equal { estatus: {…}, …(7) }`. Integración: `TypeError: Cannot read properties of undefined (reading 'tarifasTienda')` |

### Un hallazgo de las mutaciones, y hay que decirlo: **B8 no puede matar lo que su ficha dice**

`tasks.md > B8` pide demostrar rojo el test de aislamiento «quitando el `filtro` de la llamada de
hidratación». **Se ejecutó (mutación 3) y ese test siguió VERDE**, y no es que el test esté flojo:
es que ese caso **no puede** verlo. La consulta del día ya devuelve sólo ids de la zona A, así que
hidratar con filtro global devuelve exactamente las mismas filas. El segundo filtro es **defensa en
profundidad**: sólo es observable si se entra por la puerta que se salta la primera consulta.

Por eso ese agujero lo cubre `tests/integration/orden-list-items-by-ids.test.ts` (B4), que llama al
método **directamente** con un id de otra zona en la lista — y ahí la mutación 2 sí lo mata. La
cobertura existe; lo que no existe es la demostración *en ese archivo*, y el criterio de B8 se marca
cumplido por la mutación **1** (que sí lo pone rojo, vía `deletedAt`) más la 4 y la 5, que ponen
rojo su cláusula de recorte.

---

## 5. Desviaciones del design, con su porqué

### 5.1 `FiltroAlcanceTablero` se muda a `lib/types/alcance-tablero.ts`

`design.md §4.2` y §13/A7 dicen que `IOrdenRepository` importe el tipo desde
`ITableroDiaRepository` y que «el coste es una arista `import type` entre dos archivos de
`lib/interfaces/repositories/`, **sin runtime**».

**Esa premisa es falsa, y lo dijo un guardia ajeno.** Con la arista puesta,
`tests/unit/guards/pagos-captura.guardia.test.ts` se puso **rojo en dos cláusulas**. Ese guardia
recorre el árbol de imports de un panel de cliente y **no distingue `import type` al recorrer** (a
propósito: lo que audita después sí lo distingue). El camino que se abría, medido y no supuesto:

```
app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx
  -> app/(app)/ordenes/_components/estatus-label.ts
  -> lib/types/order-status.ts
  -> lib/interfaces/repositories/IOrdenRepository.ts
  -> lib/interfaces/repositories/ITableroDiaRepository.ts     ← la arista nueva
  -> lib/types/tablero-dia.ts
  -> lib/analytics/alcance.ts
  -> lib/auth/acceso-total.ts        (importa `RolValue` como VALOR de @prisma/client)
```

Comprobado además que **el guardia estaba verde antes** de este bloque (`git stash` + corrida: 31
tests en verde) y que vuelve a estarlo después. **No se tocó el guardia**: se movió el tipo.

La decisión que el design defendía —**una sola declaración** de la unión, no dos que puedan
divergir— se conserva entera: el tipo se declara una vez, en un módulo sin imports, y
`ITableroDiaRepository` lo **reexporta**, así que los consumidores de la 192 siguen importándolo de
donde su razonamiento está escrito. El módulo nuevo entra en `ARCHIVOS_BACKEND`, así que las
guardias de la feature lo censan como al resto.

### 5.2 Un patrón de `sumar-totales.test.ts` se relaja (y sólo eso)

`tests/unit/tablero-dia/sumar-totales.test.ts` exigía que el import fuera
`import { sumarTotalesTablero } from "@/lib/types/tablero-dia"` **con ese único especificador**. El
servicio ahora importa también `recortarPorAlcance` del mismo módulo. Se cambió el patrón a
`import { … sumarTotalesTablero … } from "@/lib/types/tablero-dia"`. Lo que la cláusula afirma —que
la suma **se importa** del contrato en vez de declararse en el servicio— sigue exactamente igual de
apretado; lo que se quitó fue una exigencia de formato que ninguna decisión respaldaba.

### 5.3 `FilaDelDia.resultadoDelDia` se expresa como `OrdenDetalleDia["resultadoDelDia"]`

El design lo escribía como `GestionResultado | null`. La cabecera de `ITableroDiaRepository` declara
que es un **contrato neutral, «sin Prisma»**, y escribirlo así habría metido un
`import type { GestionResultado } from "@prisma/client"` justo debajo de esa frase. Se expresa
contra el campo del contrato, que es el mismo tipo y una fuente menos.

---

## 6. Lo que queda abierto

### 6.1 ⛔ El typecheck no queda verde, y el backend no puede dejarlo verde

Los 11 errores son de `DetalleMensajeroPanel.tsx` y de su test, que son **F3 y F4**. Arreglarlos es
literalmente hacer el bloque frontend. Se deja rojo a propósito y dicho aquí, en vez de tocar UI
fuera de alcance. Traducción de campo a campo, en §3.

**Consecuencia operativa para el leader:** «el backend está verde» hay que leerlo como *lint, tests
de la feature, related y guardias en verde; typecheck rojo sólo en los dos archivos que el
frontend va a reescribir*. El árbol no compila entero hasta que F3/F4 aterricen.

### 6.2 Tareas que este bloque no toca

- **F1–F7** (módulo de columnas, panel, tests de componente, navegador, censo de la guardia del
  dinero).
- **V1** — la guardia de R44. Su cláusula **(c)** necesita `columnasDetalle`, que es F1. Lo que sí
  está escrito y verde es su materia prima: la cláusula (a) vive en
  `tests/unit/tablero-dia/recorte-por-alcance.test.ts` y la (b) —el **servicio real**, serializado a
  JSON, sin centinelas— en `tablero-dia-detalle-hidratacion.test.ts` y en el caso de integración de
  B8. Las mutaciones 4 y 5 de §4 son exactamente las dos primeras que V1 exige, **ya ejecutadas y
  con su salida pegada arriba**; falta la tercera (`columnasDetalle` deja de filtrar), que sólo se
  puede correr con F1 en disco.
- **C1** (la reversión de R49: la nota fechada en `specs/192-.../requirements.md` y el docstring de
  `COLUMNAS` en el panel, que es frontend) y **C3/C4/C5**.
- **C2** — su test **ya está escrito y verde**: `tests/unit/tablero-dia/detalle-contrato.test.ts`
  afirma el techo de superficie por tipo (una tercera clave propia **deja de compilar**) y por
  valor. La casilla se deja sin marcar porque C2 no es de este bloque; quien cierre el CIERRE sólo
  tiene que verificarlo.

### 6.3 Límites que se dicen, no se rodean

1. **El `findMany` de la hidratación queda fuera del censo de `frontera.guardia`.** El guardia
   prohíbe `findMany` sobre `ARCHIVOS_BACKEND` + `app/(app)/monitoreo/**`, y
   `lib/repositories/OrdenRepository.ts` no está ahí (tiene medio centenar de `findMany` legítimos,
   así que meterlo no es opción). **Está verde porque el guardia no llega, no porque la regla se
   cumpla sola.** Lo que sí se cumple es el fondo —«no traer el día a memoria»—: la consulta va por
   `id IN (≤ 25)`, y lo cubren dos tests, el de servicio (la lista de ids es exactamente la de la
   página) y el de integración contra Postgres. Está escrito también en el docstring del método.
2. **`total` y la página pueden desalinearse en un caso extremo** (una orden borrada entre las dos
   consultas). Se acepta, como dice el design §12.3: recontar rompería R8. El test de R7 lo fija
   como comportamiento esperado (`total: 3` con dos filas).
3. **`telefonoDest` sigue viajando en los dos alcances.** Es el teléfono del **destinatario**,
   escalar obligatorio de `OrdenDTO`, y no entró en el recorte de Q1. Dentro del techo de R18.

---

## 7. Mapa `R<n> → test` de lo cubierto por este bloque

| R | Test |
| --- | --- |
| R1 | `tests/unit/tablero-dia/detalle-contrato.test.ts` — asignabilidad y contravarianza del `render` |
| R2 | `tests/unit/repositories/orden-repository-list-items-by-ids.test.ts` — mismo `include` que `list()`, derivado; `tests/integration/orden-list-items-by-ids.test.ts` — relaciones y dinero derivado |
| R3 | `tests/unit/repositories/tablero-dia-detalle-sql.test.ts` + `tests/integration/tablero-dia-detalle-cuadre.test.ts` |
| R4 | `tests/unit/services/tablero-dia-detalle-hidratacion.test.ts` — orden preservado (el doble devuelve invertido) |
| R5 | idem — cero filas ⇒ cero llamadas; + el repositorio devuelve `[]` sin consultar |
| R6 | idem — intentos mergeados, con `0` para las que no traen |
| R7 | idem — el id que no resuelve se omite y el `total` no se recalcula |
| R8 | `tests/integration/tablero-dia-detalle-cuadre.test.ts` + `detalle-sql` (`COUNT(*) OVER ()`) |
| R9 | `tablero-dia-detalle-hidratacion.test.ts` — `pagina`/`pageSize` del servidor, con `ordenesConfig.DEFAULT_PAGE_SIZE` |
| R10 | `tablero-dia-detalle-alcance.test.ts` + hidratación (el denegado no llega a los colaboradores) |
| R11 | `orden-repository-list-items-by-ids.test.ts` + `tests/integration/orden-list-items-by-ids.test.ts` + hidratación (el filtro que llega es el de la autorización) |
| R12 | `tablero-dia-detalle-hidratacion.test.ts` + `tablero-dia-detalle-alcance.test.ts` (también en el vacío) |
| R13 | `tests/unit/tablero-dia/recorte-por-alcance.test.ts` + hidratación (payload serializado) + `tests/integration/tablero-dia-detalle-aislamiento.test.ts` |
| R17 | `recorte-por-alcance.test.ts` + hidratación + integración — el monto a cobrar sobrevive |
| R18 | `detalle-contrato.test.ts` (por tipo y por valor) + hidratación (sobre lo que el servicio devuelve) |
| R19 | `tests/integration/orden-list-items-by-ids.test.ts` — la borrada no vuelve |
| R31/R32 | `tests/unit/actions/tablero-dia-detalle-accion.test.ts` — las tres respuestas, byte a byte |
| R33 | idem — el id de la URL vuelve a pedirse al servidor |
| R35 | `tablero-dia-detalle-alcance.test.ts` — el detalle no pasa por la caché |
| R36 | `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` |
| R37/R38/R39 | `tests/unit/tablero-dia/frontera.guardia.test.ts` — 3 consultas, `["agregada","paginada","agregada"]` |
| R40 | `tablero-dia-detalle-hidratacion.test.ts` + `orden-repository-list-items-by-ids.test.ts` (sin `take`, sin `orderBy`) |
| R43 | `detalle-contrato.test.ts` + `recorte-por-alcance.test.ts` (retira **exactamente** lo declarado) |
| R46 | `recorte-por-alcance.test.ts` con `"global"` + hidratación (el payload global no pierde ningún centinela) |

Los que faltan (R14, R15, R16, R20–R30, R41, R42, R44, R45) son del bloque frontend, de V1 y del
cierre. **C5 sigue abierta**: el mapa de los 46 lo cierra quien termine la feature.
