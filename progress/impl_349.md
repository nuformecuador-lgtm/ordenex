# Ficha 349 — backend: la bodega satélite proyecta como `/ordenes`

Worktree `R:\wt\349`, rama `fix/349-satelite-como-ordenes`. Solo backend (tipos, repositorio,
servicio, fixtures y tests). **Sin commit**: lo hace el leader.

---

## 1. Qué se hizo, en una frase

La pantalla «Órdenes de la bodega» del `adminSatelite` tenía **su propia proyección** de la fila
de `orden` —un `select` propio, una interfaz de fila propia y un mapeo campo a campo hasta el
DTO: **tres listas paralelas** para una sola fila—. Se retiran las tres: la fila de la bodega
**es** la de `/ordenes` (`OrdenListItemDTO`), armada por la **misma** `toListItemDTO`, y sale de
la capa de datos **recortada al alcance `zona`**.

No se añadieron cinco campos a mano a la lista paralela, que era la otra vía: eso habría repetido
exactamente el defecto que la ficha viene a arreglar.

---

## 2. El contrato para el frontend

`RecepcionSateliteDTO` = `FilaBodegaSatelite` (declarado en `lib/types/orden.ts`, al lado de
`OrdenListItemDTO`, del que deriva):

```ts
type FilaBodegaSatelite = OrdenListItemDTO & {
  estatusValue: string;          // obligatorio (parte los seis grupos del módulo)
  direccion: string | null;
  montoCobrar: number | null;
  zonaNombre: string;
  provinciaNombre: string;       // en la RAÍZ: los leen el filtro cantón/distrito y el buscador
  cantonNombre: string;
  distritoNombre: string | null;
  prioridad: boolean;
  fechaRepartoISO: string | null;
};
```

### 2.1 Lo que la fila trae AHORA y antes no

| columna de `/ordenes` | de dónde sale en la fila                  | forma                                   |
|-----------------------|-------------------------------------------|-----------------------------------------|
| Mensajero             | `relaciones.mensajeroAsignado`            | `{ id, nombre } \| null` — nombre YA resuelto, nunca el uuid |
| Fecha de creación     | `createdAt`                               | `Date` (`ordenesColumns` ya la coacciona defensivamente) |
| Tiempo                | `createdAt`                               | el mismo campo; se deriva al renderizar |
| Liberada el           | `fechaReprogramacion`                     | `string \| null`, **`YYYY-MM-DD` ya serializado** (nunca `Date`) |
| Estado (badge)        | `relaciones.estatus.value` (+ `estatusValue` de respaldo) | igual que `/ordenes` |
| Zona del badge        | `relaciones.zona.nombre` (+ `zonaNombre`) | igual que `/ordenes` |
| Provincia/Cantón/Distrito | `relaciones.{provincia,canton,distrito}` | `{ id, nombre } \| null` |

**Consecuencia buscada, y es lo que pidió el humano** («básicamente debe ser el mismo
componente»): `Column<OrdenListItemDTO>[]` es asignable a `Column<RecepcionSateliteDTO>[]` **sin
un solo cast** (contravarianza de `render` bajo `strictFunctionTypes`). La tabla de la bodega
puede montar `ordenesColumns` directamente, quitando por ID las tres columnas de dinero —
exactamente como ya hace `columnasDetalle` en `/monitoreo` (`COLUMNAS_SOLO_ALCANCE_GLOBAL`).

### 2.2 Lo que la fila NO trae, a propósito

`fleteConIva`, `comisionConIva`, `fleteOrigen`, `relaciones.tienda.tarifa` (de donde sale
**fulfillment**), `relaciones.tienda.email` y `.telefono`.

**Las claves NO EXISTEN** en el objeto (no valen `undefined`): las retira
`recortarPorAlcance(fila, "zona")` en la capa de datos, antes de devolver la fila. `montoCobrar`
**sí** se conserva.

Por qué está en el informe y no es una decisión mía a la ligera: **es una decisión ya firmada por
el humano**, la de la feature 260 (R13/R15/R17), y su motivo está escrito en el código:
`/ordenes` le hace `notFound()` al `adminSatelite`
(`app/(app)/ordenes/page.tsx:55`), así que esas cifras son cosas que ese alcance **nunca ha
podido ver**; `/monitoreo` sí lo admite «y no puede ser la puerta de atrás». Este listado
tampoco puede serlo. **Si el humano quiere que el satélite vea flete, comisión y fulfillment, se
cambia en UN sitio** (`CAMPOS_SOLO_ALCANCE_GLOBAL`, `lib/types/recorte-alcance-orden.ts`) **y
cambia para las dos pantallas a la vez.** No lo hice yo.

`fleteOrigen` se retira aparte y por otra razón, escrita junto a la línea: describe de dónde
salió un importe que no viaja, y con la tarifa sin resolver diría siempre `"normal"` — incluso
sobre un distrito marcado como zona especial sin pacto. Una afirmación sin referente y falsa
justo en el caso que ese campo existe para señalar.

---

## 3. El alcance NO se ensanchó

Lo que cambió es **qué columnas se leen**, nunca **qué filas**. Las tres consultas del módulo
—la página, el conjunto de la descarga y la vigencia de la selección— siguen con el mismo
`WHERE`: `zona del actor ∧ deleted_at IS NULL ∧ lista blanca de estados ∧ filtros`. No se tocó
ni una condición de `condicionesSatelite` ni el `where` de `hidratarSatelite`.

Demostrado contra Postgres, no razonado: ver §6 (mutaciones M1 y M2).

---

## 4. Los estados del filtro: qué dice la medición

Criterio pedido: *todo estado que pueda APARECER en la tabla tiene que poder FILTRARSE*.

**Respuesta: no falta ninguno. Cero estados aparecen sin poder filtrarse.** Y no por suerte: el
`WHERE` del listado lleva `os."value" IN (<lista blanca>)`, así que el conjunto de estados que
pueden aparecer **es** exactamente el conjunto que ofrece el desplegable. Medido contra la base
local (2026-09-01):

```
lista blanca del filtro (5): en_bodega_satelite, por_recoger, por_devolver,
                             devolviendo_a_bodega_central, devuelta

(1) LO QUE APARECE EN LA TABLA (zonas satélite, estados de la lista blanca):
  Quepos | en_bodega_satelite | 6
  -> estados que APARECEN y NO se pueden filtrar: NINGUNO

(2) LO QUE EXISTE EN UNA ZONA SATÉLITE Y EL LISTADO NO ENSEÑA:
  Quepos | en_reparto | 2
```

Contexto de la base: 13 zonas (12 satélite + GAM central), **una sola zona satélite con órdenes
vivas** (Quepos: 6 `en_bodega_satelite` + 2 `en_reparto`) y **un solo usuario `adminSatelite`**
(Sara → Quepos). No amplié la lista blanca: **ningún estado nuevo tiene filas que lo respalden**.

Lo que la medición sí encuentra es otra cosa, y es la que probablemente vio el humano: en la zona
del satélite existen 2 órdenes `en_reparto` que **el listado no enseña en absoluto** — no es que
aparezcan sin filtro, es que no aparecen. Eso no es un hueco del filtro sino del **alcance del
listado**, y el repo ya tiene decisiones firmadas sobre esa misma pregunta:

- feature 235 (T1.5) dejó fuera `ayuda_tienda` porque *«el paquete está EN LA MOTO, no en el
  estante del satélite»*. `en_reparto` es literalmente ese caso.
- feature 239 (P4) dejó fuera `devolucion_por_confirmar`, **firmada en contra de la
  recomendación del spec**, con el precio escrito en su `requirements.md`.

Ambas dicen que la vía para reabrirlo es la ficha, no añadir un `value` a la lista.
**Pregunta abierta para el humano** (§8, punto 1).

Aviso sobre esta medición: es la **base local**. Producción se vació a propósito el 2026-08-25 y
desde este worktree no tengo forma de consultarla (el MCP de Supabase no está en mi conjunto de
herramientas). Si el humano vio estados concretos en producción, esa lista manda sobre ésta.

---

## 5. Archivos

### Creados
- `lib/types/recorte-alcance-orden.ts` — el recorte por alcance de una fila de listado
  (`CAMPOS_SOLO_ALCANCE_GLOBAL`, `recortarPorAlcance`, `AlcanceOrden`). **Mudado** desde
  `lib/types/tablero-dia.ts`, no duplicado: el nombre «tablero del día» dejó de ser cierto al
  tener un segundo consumidor, y —lo que decide— la capa de datos no puede importar aquel módulo
  sin reabrir el camino `→ lib/analytics/alcance → lib/auth/acceso-total` que el guardia del
  bundle de cliente recorre **sin distinguir `import type`**. Es la misma medición que motivó
  `lib/types/alcance-tablero.ts`; su cabecera la cuenta entera. Módulo **sin imports de valor**.
- `tests/integration/db/satelite-bodega-alcance-real.test.ts` — 4 casos contra Postgres real.
- `tests/unit/guards/satelite-proyeccion-compartida.guardia.test.ts` — 3 casos.
- `tests/fixtures/fila-bodega-satelite.ts` — los campos base de la fila, en un solo sitio.

### Modificados
- `lib/types/orden.ts` — declara `FilaBodegaSatelite`.
- `lib/types/tablero-dia.ts` — reexporta el recorte; `AlcanceTableroDia` pasa a alias de
  `AlcanceOrden`. **Para sus consumidores no cambia nada** (mismos nombres, mismo módulo).
- `lib/interfaces/repositories/IOrdenRepository.ts` — `RecepcionSateliteRow` = alias.
- `lib/interfaces/services/IRecepcionSateliteService.ts` — `RecepcionSateliteDTO` = alias.
- `lib/repositories/OrdenRepository.ts` — se retiran `WITH_RECEPCION_SATELITE` y
  `toRecepcionSateliteRow`; entra `toBodegaSateliteRow`; las tres consultas del módulo hidratan
  con `WITH_ESTATUS_Y_TIENDA`.
- `lib/services/RecepcionSateliteService.ts` — `toDTO` deja de copiar campo a campo.
- `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` — el `toEqual` literal
  **crece**, no se relaja: sigue siendo exacto, y por eso ahora también afirma la AUSENCIA del
  dinero.
- `tests/unit/repositories/satelite-paginado-where.test.ts` — su doble de fila (`filaPrisma`)
  reproducía el `select` viejo; se actualiza al `include` compartido y `montoCobrar` pasa a ser
  un `Prisma.Decimal` de verdad. **Lo encontró la suite completa, no mis corridas dirigidas**:
  ese doble va con `as unknown as PrismaClient`, así que el typecheck no lo veía. Las aserciones
  del archivo —que son sobre el SQL— no cambian.
- 11 archivos de test + `tests/fixtures/satelite-bodega-almacen.ts` — esparcen
  `CAMPOS_BASE_ORDEN`. Ni una aserción existente cambia de valor (el spread va primero).

**No se tocó UI**: ni `recibidas-columns.tsx`, ni `SateliteOrdenesListado.tsx`, ni
`satelite-descarga-columnas.ts`, ni ninguna página.

---

## 6. Mutaciones — seis, ejecutadas, con su línea real, revertidas

Todas aplicadas de una en una sobre el árbol verde, con el test corrido de verdad y el archivo
restaurado desde copia. Ninguna sobrevivió.

**M1 (obligatoria) — quitar el recorte por zona del `WHERE`** (`condicionesSatelite`, la
condición `o."zona_id" = ${filtro.zonaId}`):
```
FAIL tests/integration/db/satelite-bodega-alcance-real.test.ts > un adminSatelite NO ve las
     ordenes de otra zona: ni en las filas, ni en el total
AssertionError: expected 22 to be 3 // Object.is equality
 ❯ satelite-bodega-alcance-real.test.ts:304:26   expect(pagina.total).toBe(...)
```
Dato relevante: **la fuga la delató el `total`, no las filas**. Con M1 sola, `hidratarSatelite`
sigue filtrando por `zonaId` en su propio `where` y descarta las ajenas — el usuario vería 3
filas y un total de 22. Es la segunda capa haciendo su trabajo, y es la razón por la que ese
`expect(total)` está en el test.

**M2 — quitar la zona de las DOS capas** (SQL + `hidratarSatelite`):
```
AssertionError: expected Set{ …(22) } to deeply equal Set{ …(3) }
 ❯ satelite-bodega-alcance-real.test.ts:303   expect(new Set(idsVistos)).toEqual(...)
```
Aquí sí hay fuga de filas, y el caso la ve.

**M3 — la proyección deja de recortar por alcance** (`toBodegaSateliteRow` devuelve
`toListItemDTO(row, null)` sin `recortarPorAlcance`):
```
FAIL ... > el dinero de la tienda NO viaja a un alcance de zona, y el monto a cobrar SI
AssertionError: expected true to be false
 ❯ satelite-bodega-alcance-real.test.ts:401:36   expect("fleteConIva" in orden).toBe(false)
```

**M4 — quitar la lista blanca de estados del `WHERE`**:
```
FAIL ... > la lista blanca de estados sigue mandando: lo que no esta en el estante, no sale
AssertionError: expected [ …(6) ] to not include 'd0db4e2f-…'
 ❯ satelite-bodega-alcance-real.test.ts:337:49
(y de paso el primer caso: expected Set{ …(6) } to deeply equal Set{ …(3) })
```

**M5 — el servicio vuelve a filtrar en silencio lo que el repositorio envía**
(`toDTO` devuelve `{ ...row, relaciones: undefined }`): reproduce el defecto histórico.
```
FAIL ... > la fila trae lo que la tabla de la bodega no recibia: mensajero, creacion y
     «Liberada el»
AssertionError: the given combination of arguments (undefined and string) is invalid …
 ❯ satelite-bodega-alcance-real.test.ts:372:57
     expect(orden.relaciones?.mensajeroAsignado?.nombre).toContain(…)
```

**M6 — la bodega vuelve a tener proyección propia** (`include` sin `mensajeroAsignado`):
```
FAIL tests/unit/guards/satelite-proyeccion-compartida.guardia.test.ts > el listado de la bodega
     pide a Prisma EXACTAMENTE la proyeccion del listado de ordenes
AssertionError: expected { Object (include, select) } to deeply equal { … }
-     "mensajeroAsignado": {
```

**Supervivientes: ninguno.** Una mutación que sí sobreviviría —y por qué no se cuenta— es quitar
`zonaId` **solo** del `where` de `hidratarSatelite`: el SQL de arriba ya filtró, así que no
cambia ni una fila. Es redundancia deliberada (defensa en profundidad; el propio repositorio la
documenta: *«una lista de ids nunca debe ser su única guarda»*), y su valor solo se ve compuesta
con M1 — que es justo lo que muestra el par M1/M2.

### Comprobación de que las mutaciones se ejecutaron de verdad
Tras revertir todo, el mismo comando vuelve a verde:
```
pnpm exec vitest run tests/integration/db/satelite-bodega-alcance-real.test.ts \
  tests/unit/guards/satelite-proyeccion-compartida.guardia.test.ts \
  tests/unit/repositories/orden-repository.recepcion-satelite.test.ts
 Test Files  3 passed (3)
      Tests  15 passed (15)
```

---

## 7. Mapa requisito → test

La ficha no tiene `specs/349/`; los requisitos son los del encargo. Se mapean igual.

| Requisito del encargo | Test |
|---|---|
| El DTO entrega `fechaCreacion` | `satelite-bodega-alcance-real.test.ts` · «la fila trae lo que la tabla de la bodega no recibía» (`createdAt`) |
| … `liberada` | mismo caso (`fechaReprogramacion === "2001-06-22"`) |
| … `mensajero` (no estaba en el DTO, ver §8.3) | mismo caso (`relaciones.mensajeroAsignado.nombre`) |
| … `tiempo` (idem) | mismo caso: deriva de `createdAt` |
| … `flete`, `comision`, `fulfillment` | **NO se entregan**, y se afirma: `satelite-bodega-alcance-real.test.ts` · «el dinero de la tienda NO viaja…» |
| Misma forma y significado que la central | `satelite-proyeccion-compartida.guardia.test.ts` (los 3 casos) + `orden-repository.recepcion-satelite.test.ts` (`toEqual` exacto) |
| Nada de una segunda manera de calcular lo mismo | `satelite-proyeccion-compartida.guardia.test.ts` |
| Compartir la proyección no ensancha el alcance | `satelite-bodega-alcance-real.test.ts` · «un adminSatelite NO ve las órdenes de otra zona» (M1/M2) |
| Dinero STRING / `Prisma.Decimal`, nunca `Number()` | no aplica en esta capa: los tres importes NO se derivan aquí (se pasa `tarifa = null`). `montoCobrar` sigue el paso a paso `Decimal → number` que ya tenía |
| Todo estado que aparece se puede filtrar | `satelite-bodega-alcance-real.test.ts` · «la lista blanca de estados sigue mandando» (M4) + medición §4 |

---

## 8. Lo dudoso y lo abierto

1. **`en_reparto` en el listado de la bodega.** Existen 2 órdenes así en la zona de Quepos que la
   pantalla no enseña. No las añadí: el criterio del repo (235/239) es que lo que va en la moto
   no se lista como si estuviera en el estante, y esas decisiones se firmaron a sabiendas. **Si
   el humano quiere verlas, es reabrir esa decisión, no añadir un `value`.**
2. **Los tres importes.** Decidí no exponerlos, por la decisión firmada de la 260. Es la pregunta
   que prefiero que conteste el humano; el cambio, si lo pide, es de una línea en un solo sitio.
3. **La premisa del encargo era incorrecta en un punto, y conviene decirlo.** El encargo daba por
   hecho que `mensajero` y `tiempo` «YA están en el DTO de la satélite». No lo estaban: el
   `RecepcionSateliteDTO` de `dev` no declaraba ni mensajero ni `createdAt`. Los campos que
   faltaban en el DTO eran **siete**, no cinco. Con la proyección unificada la distinción deja de
   importar —llegan todos—, pero si alguien contaba columnas contra esa lista, el número era otro.
4. **Coste de `listar()`, y no lo introduje yo pero lo empeoro.**
   `findRecepcionSateliteByZona` lee **toda la zona** en seis estados, sin paginar, y ahora con el
   `include` completo (7 relaciones + la subconsulta de `gestiones`) en vez del `select` de 15
   columnas. Y resulta que **sus consumidores casi no lo usan**: `en-bodega/page.tsx` solo lee
   `result.zonaNombre` y `result.sinZona` (líneas 143-144) —los cinco arrays de estado los
   reemplazó la tabla paginada de la 170— y `por-recibir/page.tsx` solo lee `result.porRecibir`.
   O sea: se proyecta toda la bodega para tirar seis arrays. No lo toqué porque arreglarlo cambia
   lo que `listar()` devuelve y eso son las páginas (UI, fuera de mi alcance). **A volumen local
   no es medible** (6 filas en la única zona satélite con datos); a volumen de producción no pude
   medirlo — producción se vació el 2026-08-25 y no la alcanzo desde aquí. Merece ficha propia.
5. **`satelite-descarga-columnas.ts` no gana columnas.** Ese módulo enumera a mano a propósito
   (su R5/R6: «si el DTO gana un campo, el archivo NO lo publica hasta que se declare aquí»). El
   archivo de descarga sigue con sus 13 columnas hasta que alguien decida ampliarlo. Es una
   decisión de pantalla, del agente de frontend o de otra ficha.
6. **La fila pesa más, y en la DESCARGA eso se nota.** La fila pasa de ~15 campos a ~30
   escalares más un objeto `relaciones` con 7 sub-objetos: del orden de 3-4x en JSON. En la
   página (25-50 filas) es irrelevante; en `listarOrdenesBodegaCompleto`, cuyo tope son
   `DESCARGA_MAX_FILAS = 5000`, el payload crece en la misma proporción. **No lo mitigué a
   propósito**: una proyección más delgada solo para la descarga sería una segunda proyección,
   que es el defecto de esta ficha. Y hay precedente exacto al mismo tope: `/ordenes` ya
   descarga `OrdenListItemDTO[]` con esta misma forma (`ListarOrdenesCompletoResult`). Lo digo
   porque es un cambio real de tamaño, no porque crea que hay que revertirlo.
7. **Dato para el frontend antes de montar «Liberada el»:** hoy, en la base local, **ninguna**
   fila del listado satélite tiene reprogramación vigente (las 2 que hay son de GAM). La columna
   existiría y estaría entera en «—». Igual con «Mensajero»: 0 de las 6 filas de Quepos tienen
   mensajero asignado. El dato viaja; que valga la pena pintarlo es otra pregunta.

---

## 9. Verificación

### `pnpm typecheck`
```
> ordenex@0.1.0 typecheck R:\wt\349
> tsc --noEmit
```
Verde, sin salida.

### `pnpm lint`
```
✖ 145 problems (0 errors, 145 warnings)
```
**0 errores.** Los 145 warnings son `no-unused-vars` preexistentes en tests, ajenos a esta ficha.

### `pnpm test` (suite completa, corrida DOS veces)

Primera corrida (20:36-20:54): **14 fallos en 2 archivos**. Uno era el heredado; los otros 13
salieron de `tests/unit/repositories/satelite-paginado-where.test.ts`, cuyo doble de fila
reproducía el `select` viejo (`montoCobrar: { toNumber: () => 1000 }`, sin `toFixed`). Se
arregló el doble (§5) — no la implementación.

```
 Test Files  2 failed | 1647 passed (1649)
      Tests  14 failed | 23195 passed | 26 skipped (23235)
 Duration  1075.65s
```

Segunda corrida, tras el arreglo (20:56-21:06):

```
 Test Files  1 failed | 1648 passed (1649)
      Tests  1 failed | 23208 passed | 26 skipped (23235)
 Duration  567.79s
EXIT=1
```

El **único** rojo es el heredado y tolerado por el encargo:

```
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — toda Server Action tiene
       superficie… > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación
AssertionError: … expected [ Array(1) ] to deeply equal []
+ [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

Nota honesta: la primera corrida es la que encontró el fallo real. Mis corridas dirigidas
(20 archivos de satélite) estaban verdes y **no** lo vieron, porque ese archivo no entraba en el
patrón que usé y su doble va con `as unknown as PrismaClient`, invisible al typecheck.

### Guardias (`pnpm run test:guardias`)
```
 Test Files  1 failed | 171 passed (172)
      Tests  1 failed | 2586 passed (2587)
```
El único rojo es el heredado y tolerado por el encargo:
`superficie-de-uso.guardia.test.ts` → `lib/actions/tarifas.ts:67 obtenerTarifa`.

---

## 10. Veredicto

La bodega satélite deja de tener proyección propia: entrega la misma fila que `/ordenes` —con
mensajero, fecha de creación, tiempo y «Liberada el»— y **sin** flete, comisión ni fulfillment,
que es una decisión firmada que dejo abierta para el humano.
