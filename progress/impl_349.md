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

---
---

# Ficha 349 — frontend: la tabla de la bodega MONTA las columnas de `/ordenes`

Worktree `R:\wt\349`, rama `fix/349-satelite-como-ordenes`. Sólo capa de presentación (columnas,
call-site, un comentario de la descarga, un e2e y dos archivos de test). **Sin commit**: lo hace
el leader. Nada de backend, base de datos ni rutas.

---

## F1. Qué se hizo, en una frase

`recibidas-columns.tsx` dejó de **escribir** trece columnas que espejaban «el estilo» de
`ordenes-columns.tsx` y pasó a **montar** las de `/ordenes` tal cual, quitando por identificador
las tres que leen un dato que el alcance `zona` no recibe. **El archivo ya no declara ni una
definición de columna**: cero `value:`, cero `render`, cero encabezados.

Consecuencia directa, y son las tres cosas que pidió el humano a la vez:

| lo que pidió | cómo sale |
|---|---|
| «no está mostrando la info completa» | +3 columnas: **Mensajero**, **Fecha de creación**, **Tiempo** (13 → 16 de datos) |
| «los estados no los muestra en badges» | «Estado» es ahora el **`EstatusBadge`** de `/ordenes`, con su variante semántica |
| «básicamente debe ser el mismo componente» | son **el mismo objeto** `Column`, no una copia: `recibidasColumns()` devuelve elementos de `ordenesColumns` |

---

## F2. Cómo se montaron las columnas

```ts
export function recibidasColumns(): Column<RecepcionSateliteDTO>[] {
  return ordenesColumns.filter(
    (columna) => !COLUMNAS_SIN_DATO_EN_ALCANCE_ZONA.includes(columna.id),
  );
}
```

Eso es **todo** el módulo. Lo que lo sostiene sin un solo `as` es lo que dejó el backend:
`Column<OrdenListItemDTO>[]` es asignable a `Column<RecepcionSateliteDTO>[]` por contravarianza
de `render` bajo `strictFunctionTypes`. **Comprobado, no supuesto**: `pnpm typecheck` pasa en
verde con la anotación de retorno puesta y sin ningún cast. Mismo patrón, mismo precedente y
misma razón que `columnasDetalle` en `/monitoreo` (260/R26).

El call-site: `conBadgePrioridad(recibidasColumns())` — el parámetro `zonaNombre` desaparece de
la firma. No es un descuido: el chip de `/ordenes` lee la zona **de la fila**
(`relaciones.zona.nombre`), no la del actor. `zonaNombre` sigue siendo prop del listado porque
la usa la regla de disponibilidad del incidente (R48).

### F2.1 Qué se quitó por id, y por qué

`flete`, `fulfillment`, `comision` — **exactamente los tres ids de `COLUMNAS_SOLO_ALCANCE_GLOBAL`
de `/monitoreo`**, porque son los que leen `CAMPOS_SOLO_ALCANCE_GLOBAL`, que
`recortarPorAlcance(fila, "zona")` retira en la capa de datos. `montoCobrar` **no** se quita
(260/R17): ese importe sí viaja y el satélite ya lo veía.

La lista se **declara** aquí en vez de importarse de `/monitoreo`, y la razón es concreta: este
módulo entra en el bundle de CLIENTE y el guardia del bundle recorre imports **sin distinguir
`import type`**, así que traerse `detalle-columnas` arrastraría `lib/types/tablero-dia` y con él
`→ lib/analytics/alcance → lib/auth/acceso-total` (es la misma medición que motivó el módulo
`lib/types/recorte-alcance-orden.ts` del backend). Que las dos declaraciones no puedan divergir
lo ata un test que **las compara**.

Y la exclusión no se justifica de palabra: hay un caso que **pinta** las tres columnas sobre la
fila de verdad ya recortada y comprueba que dicen `₡0`. Ése es el «₡0 que se lee como *esta
orden no paga flete*» de 260/R15 — la afirmación falsa que se evita retirando la COLUMNA y no
sólo el VALOR.

### F2.2 Qué NO se montó, y no es un olvido

- **«Liberada el»** — se monta `ordenesColumns`, no `ordenesColumnsReprogramada`. Esa columna
  pertenece en `/ordenes` a la pestaña acotada a `reprogramada`, y **`reprogramada` no es
  ninguno de los cinco estados de este listado** (`ESTADOS_BODEGA_SATELITE`). Mismo criterio que
  `/monitoreo` (260/R45), el otro listado de estados mezclados. Medido además contra la base
  local el 2026-09-01: de las 6 filas del listado satélite, **0 tienen reprogramación vigente**.
  Hay un caso que afirma que `reprogramada` no está entre los cinco, para que la cláusula no
  pueda quedarse verde por vacío si mañana entrara.
- **La descarga** (`satelite-descarga-columnas.ts`) **no gana columnas**: enumera a mano a
  propósito (170/R5, R6). Sólo se corrigió su comentario, que decía «espejan las columnas de
  datos de `recibidasColumns`» y desde hoy sería falso. Queda dicho ahí y en §F6.

---

## F3. Lo que cambió de aspecto, y lo que se retiró a sabiendas

El chip **pierde el sufijo « de \<zona\>»** que esta pantalla componía (33/R9: «En bodega
satélite de Quepos»). Es el precio de usar el mismo componente, y lo pago con dos apoyos:

1. **El dato no se pierde**: la zona de la orden está en su propia columna, tres celdas más
   allá. Verificado en el navegador y afirmado por dos casos (uno en el test de columnas, otro
   en `RecepcionSateliteModule.test.tsx`, que además comprueba que el texto compuesto **ya no
   aparece** — sin eso el caso pasaría igual con el render viejo).
2. **Ya había precedente en esta misma pantalla**: el archivo descargable lo retiró en la 170/R8
   con este motivo escrito: *«la zona ya viaja en su propia columna y repetirla en el estado
   convierte un dato en dos»*.

Aun así **lo señalo como decisión revisable** (§F6.1): es un requisito con nombre y apellido de
otra feature, y si el humano lo quiere de vuelta la vía limpia es que `EstatusBadge` componga el
sufijo para `en_bodega_satelite` igual que ya hace para `en_ruta_bodega_satelite` — y entonces
cambia en las DOS pantallas a la vez, que es lo correcto.

---

## F4. Medidas del navegador — con números

Un solo servidor de desarrollo, levantado en este worktree. **Aviso operativo:** `next dev` con
**Turbopack no arranca aquí** (`Symlink [project]/node_modules is invalid, it points out of the
filesystem root` — el `node_modules` del worktree es un junction al repo principal). Se levantó
con `pnpm exec next dev --webpack`, que sí funciona. Login real como `satelite.qa@ordenex.test`
(Sara → Quepos, el único `adminSatelite` de la base local); **no se corrió ningún seed**, así que
no se rotó la contraseña de nadie.

Medido con Playwright sobre `/recepcion-satelite/en-bodega` y, como referencia, `/ordenes` con
el admin. Palabras partidas = una palabra cuyo `Range.getClientRects()` devuelve rectángulos con
**distinta `top`**.

| pantalla | viewport | cols | filas | scrollport | contenido | **desborde** | scroll-H de la PÁGINA | palabras partidas | `wrap-anywhere` |
|---|---|---|---|---|---|---|---|---|---|
| bodega satélite | 1440x900 | 18 | 6 | 1134 px | 1958 px | **824 px** | **0 px** | **0** | **0** |
| bodega satélite | 390x844 | 18 | 6 | 340 px | 1958 px | **1618 px** | **0 px** | **0** | **0** |
| `/ordenes` | 1440x900 | 21 | 25 | 1134 px | 2374 px | 1240 px | 0 px | 0 | 0 |
| `/ordenes` | 390x844 | 21 | 25 | 340 px | 2374 px | 2034 px | 0 px | 0 | 0 |

Lecturas que importan:

- **La tabla desborda DENTRO de su scrollport, no empuja la página** en ninguno de los cuatro
  casos (`document.scrollWidth - clientWidth = 0`). Es el comportamiento buscado del `DataTable`.
- **La satélite desborda MENOS que `/ordenes`** (1958 px vs 2374 px), que es la pantalla que el
  humano dio por patrón. Gana ancho, sí, pero se queda por debajo del listado ya aprobado.
- **Cero palabras partidas** y **cero nodos con `overflow-wrap: anywhere` / `word-break:
  break-all`** en toda la tabla, en los cuatro casos y también **después** de desplazar el scroll
  hasta el final. El aviso de la otra ficha sobre `wrap-anywhere` **no aplica aquí**: la clase no
  aparece.
- **La flecha de scroll**: centro en **(1390, 450)** a 1440 y **(340, 443)** a 390 en la satélite;
  **(1390, 450)** y **(340, 422)** en `/ordenes`. **Idéntica antes y después de desplazar la tabla
  hasta el final** en las cuatro medidas → está pegada al scrollport (es `sticky`), no a la
  ventana, y se comporta igual que en `/ordenes`. La X coincide exactamente entre las dos
  pantallas; los 21 px de diferencia en Y a 390 vienen de que el cuerpo tiene 6 filas frente a 25,
  no de un anclaje distinto.
- **El `overflow: hidden` que rodea a la tabla es el del propio `DataTable`** (el marco con borde
  redondeado), el mismo objeto en las dos pantallas. **No hay ningún `Card` extra** envolviendo la
  sección satélite: `RecepcionSateliteModule` la monta en un `<section>` con
  `flex flex-col gap-3 border-t pt-6`. Ése era el escenario que el encargo pedía descartar, y
  queda descartado con la medida.

### F4.1 Lo que se ve de verdad (primera fila, base local)

```
Nº Guía  Pendiente | Nº Remisión 111137 | Estado [chip] En bodega satélite | Intentos 0
Destinatario Miguel - | Producto 1 * Crema anti verrugas. | Dirección Calle las brisas Granadilla
Tienda Tania | Zona Quepos | Provincia San José | Cantón Curridabat | Distrito Granadilla
Monto a cobrar ₡14.990 | Mensajero — | Fecha de creación 24/7/26, 5:40 p. m. | Tiempo 39d 3h
```

El chip lleva `bg-info-soft text-info-strong dark:bg-info/15` — la variante `info` que
`ORDER_STATUS_VARIANT` asigna a `en_bodega_satelite`, la misma que en `/ordenes`. Y **ninguna
columna de dinero de tienda** aparece.

«Mensajero» sale en «—» y no está roto: **medido contra Postgres el 2026-09-01**, de las 6 filas
del listado satélite **0 tienen mensajero** y **0 tienen reprogramación vigente** (consulta por
`zona.es_central = false` ∧ `deleted_at IS NULL` ∧ los cinco estados; confirma el dato del
backend de forma independiente).

Errores de consola en la pantalla: **2**, los dos «*Encountered a script tag while rendering React
component*». Rastreados a `app/layout.tsx:58` (`RESCATE_INLINE`), que es global y preexistente —
nada que ver con esta ficha.

---

## F5. Mutaciones — seis, ejecutadas, con su línea real, revertidas

Todas aplicadas de una en una sobre el árbol verde, corriendo los tests de verdad y restaurando
el archivo desde copia (`md5sum` de vuelta al original comprobado). **Ninguna sobrevivió.**

**M1 (obligatoria) — las columnas vuelven a escribirse a mano.** Se sustituye el módulo por
dieciséis definiciones propias que producen **los mismos ids, los mismos encabezados y el mismo
render**, badge incluido:
```
FAIL tests/unit/components/recibidas-columns.test.tsx > cada columna montada es EL MISMO OBJETO
     que declaró `ordenesColumns`
AssertionError: la columna `numGuia` NO sale de `ordenesColumns`: se declaró aparte:
     expected [ { id: 'numGuia', …(2) }, …(18) ] to include { id: 'numGuia', …(2) }
 ❯ tests/unit/components/recibidas-columns.test.tsx:149:9
(+ «el módulo NO declara ni una definición de columna propia»: expected […(15)] to have a length
   of +0 but got 15   ❯ :170:50)
(+ «el chip sale de la MISMA columna que `/ordenes`»: expected {…} to be {…} // Object.is)
```
**El dato que da valor a esta ficha, y por eso lo pongo aparte:** con M1 aplicada,
`RecepcionSateliteModule.test.tsx` —el test que fija la lista literal de cabeceras— se quedó
**entero en verde (61 casos)**. Es decir: sin el caso de IDENTIDAD, volver a la lista paralela no
lo habría notado nadie. Ése es exactamente el agujero por el que la bodega llegó a 13 columnas
mientras `/ordenes` tenía 19.

**M2 — el estado vuelve a texto plano** (se sobrescribe la columna `estatus` con
`render: (row) => row.estatusValue`): **11 casos rojos en dos archivos**.
```
FAIL tests/components/RecepcionSateliteModule.test.tsx > el estado va en badge con su etiqueta,
     y la zona en su propia columna
TestingLibraryElementError: Unable to find an element with the text: En bodega satélite
 ❯ tests/components/RecepcionSateliteModule.test.tsx:324:33
FAIL tests/unit/components/recibidas-columns.test.tsx > `en_bodega_satelite` sale dentro de un
     chip con su etiqueta
AssertionError: el estado `en_bodega_satelite` se pintó como texto plano, no como badge:
     expected null not to be null   ❯ :269:90
(los cinco estados del listado, uno por uno)
```

**M3 — deja de recortar el dinero** (`return ordenesColumns` sin filtrar):
```
FAIL ... > ninguna cabecera de dinero restringido llega a la tabla de la bodega
AssertionError: expected [ 'Nº Guía', 'Nº Remisión', …(17) ] to not include 'Flete + IVA'
 ❯ tests/unit/components/recibidas-columns.test.tsx:249:29
(+ los ids montados: expected […(19)] to deeply equal […(16)]  ❯ :157:49)
(+ RecepcionSateliteModule.test.tsx:592 — la lista de cabeceras)
```

**M4 — la exclusión arrastra una columna que SÍ tiene dato** (`"mensajero"` añadido a la lista):
```
FAIL ... > las tres excluidas MENTIRÍAN sobre la fila real: pintan ₡0,00 tras el recorte
AssertionError: la columna «Mensajero» no pinta el cero: la exclusión ya no está justificada:
     expected 'Ana' to be '₡0'   ❯ tests/unit/components/recibidas-columns.test.tsx:238:9
(+ «monta la columna «Mensajero»»: expected […(15)] to include 'Mensajero'  ❯ :303:34)
(+ «es la MISMA exclusión que `/monitoreo`» y el conteo de 3)
```
Éste es el caso que impide que la exclusión crezca «por si acaso»: retirar una columna exige que
esa columna mienta, y se comprueba pintándola.

**M5 — la lista de exclusión queda RANCIA** (`"flete"` → `"fleteTotal"`, el escenario de un
rename en `/ordenes`):
```
FAIL ... > cada id de la exclusión existe de verdad entre las columnas del listado
AssertionError: `fleteTotal` ya no es una columna del listado de órdenes: expected false to be true
 ❯ tests/unit/components/recibidas-columns.test.tsx:196:91
(+ la comparación con `/monitoreo` y la justificación medida)
```

**M6 — el módulo PADRE se escribe una columna a mano** (una columna «Teléfono» añadida en
`SateliteOrdenesListado.tsx`):
```
FAIL ... > el módulo padre sigue declarando SUS dos columnas y ninguna más
AssertionError: expected [ …(3) ] to have a length of 2 but got 3
 ❯ tests/unit/components/recibidas-columns.test.tsx:182:50
```
Cierra la puerta de al lado: sin esto, la lista paralela podía volver montándose en el listado
en vez de en el módulo de columnas.

### Comprobación de que las mutaciones se ejecutaron de verdad
Tras revertir (md5 idéntico al original en los dos archivos), el mismo comando vuelve a verde:
```
pnpm exec vitest run tests/unit/components/recibidas-columns.test.tsx \
  tests/components/RecepcionSateliteModule.test.tsx \
  tests/unit/components/detalle-columnas.test.tsx \
  tests/unit/components/ordenes-columns.test.tsx \
  tests/unit/descarga/satelite-descarga-columnas.test.ts
 Test Files  5 passed (5)
      Tests  117 passed (117)
```

---

## F6. Lo dudoso y lo abierto

1. **El sufijo « de \<zona\>» del estado (33/R9) se retira.** Es la única decisión de esta parte
   que cambia algo que un humano firmó, y por eso va la primera. Mi lectura del encargo es que
   «los estados en badge como la central» y «básicamente el mismo componente» **implican** usar
   el chip de `/ordenes`, que no compone ese sufijo; el dato sigue en la columna «Zona» y la
   descarga de esta misma pantalla ya lo había retirado con ese argumento (170/R8). **Si el
   humano lo quiere de vuelta**, la vía limpia NO es una columna propia aquí: es que
   `EstatusBadge` componga el nombre de zona también para `en_bodega_satelite` —ya lo hace para
   `en_ruta_bodega_satelite`— y entonces las dos pantallas dicen lo mismo. Son ~3 líneas en un
   solo archivo.
2. **El archivo descargable se queda en 13 columnas y la tabla enseña 16.** Es lo que R5/R6
   pide, y lo dejo escrito en el propio módulo para que sea visible en vez de implícito. Pero
   **es una divergencia real que alguien va a notar**: quien descargue no verá Mensajero, Fecha
   de creación ni Tiempo. Ampliarlo son tres líneas + tres claves en `filaDescargaSatelite`; no
   lo hice porque el encargo lo excluyó explícitamente y porque el criterio de qué se publica en
   un archivo es una decisión de producto, no mía.
3. **«Liberada el» fuera.** Argumentado en §F2.2 y medido (0 de 6 filas). Si el humano lo quiere,
   es cambiar `ordenesColumns` por `ordenesColumnsReprogramada` en una línea — pero entonces la
   columna sale vacía en las seis filas de hoy.
4. **El nombre `recibidas-columns.tsx` / `recibidasColumns` ya no describe lo que hay.** La
   sección «Recibidas» desapareció con la 170: hoy es un listado único de cinco estados. NO lo
   renombré —es churn puro y el encargo pedía el arreglo mínimo—, pero es deuda de nombre real y
   la anoto para que alguien la cobre cuando toque el archivo por otra razón.
5. **El caso de «Fecha de creación» no fija el texto exacto.** Lo compone `Intl` con la zona
   horaria de la máquina, y clavarlo aquí sería afirmar el reloj de quien corre el test. Se
   afirma que la celda trae un dato y no el marcador de ausencia, y que «Tiempo» tiene la forma
   `Xd Yh`. Es menos de lo que me gustaría; si alguien quiere el literal, hay que fijar `TZ` en
   el test, y eso es una decisión que afecta a más archivos que éste.
6. **`next dev` con Turbopack no arranca en este worktree** (junction de `node_modules`). No es
   de esta ficha y no lo toqué, pero cualquiera que quiera ver la app desde un worktree se va a
   dar contra ello: la salida es `pnpm exec next dev --webpack`.
7. **La medición del navegador es de la base LOCAL**, con 6 filas y una sola zona satélite con
   datos. El desborde en píxeles depende del CONTENIDO de las celdas (nombres largos de producto
   o dirección ensanchan la tabla), así que 1958 px es el ancho con estos seis paquetes, no una
   cota. Producción se vació el 2026-08-25 y desde aquí no la alcanzo.

---

## F7. Archivos

### Creados
- `tests/unit/components/recibidas-columns.test.tsx` — 26 casos. Los que cargan el peso: la
  IDENTIDAD de cada columna con la de `ordenesColumns`, el conteo de `value:` en los dos
  archivos de la pantalla, el badge por cada uno de los cinco estados del listado, y la
  justificación MEDIDA de la exclusión (las tres columnas de dinero pintadas sobre la fila real
  ya recortada).

### Modificados
- `app/(app)/recepcion-satelite/_components/recibidas-columns.tsx` — de 97 líneas con trece
  definiciones de columna a un `filter` sobre `ordenesColumns`. Cero `value:`.
- `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` — `recibidasColumns()`
  sin argumento (una línea + su comentario). Nada más.
- `app/(app)/recepcion-satelite/_components/satelite-descarga-columnas.ts` — **sólo comentario**:
  decía que sus columnas espejan las de `recibidasColumns` y desde hoy sería falso. Ni una
  columna, ni una clave, ni una línea de código.
- `tests/components/RecepcionSateliteModule.test.tsx` — la lista literal de cabeceras crece con
  las tres nuevas (sigue siendo literal a propósito: es el contrato de ESA pantalla), y el caso
  de R9 pasa a afirmar el chip + la zona en su columna + la **ausencia** del texto compuesto.
- `e2e/recepcion-satelite.spec.ts` — la aserción del estado deja de esperar el sufijo. Los e2e de
  este repo **no se ejecutan**, así que es una corrección por lectura y no una verificación; se
  cambia porque dejarla afirmando algo falso es peor que no tenerla.

**No se tocó**: ni backend, ni `lib/**`, ni `db/**`, ni rutas, ni `satelite-descarga-columnas`
más allá de su comentario, ni `EstatusBadge`, ni `ordenes-columns.tsx`.

---

## F8. Mapa petición → test

| Lo que pidió el humano | Test |
|---|---|
| «no está mostrando la info completa» | `recibidas-columns.test.tsx` · «monta la columna «Mensajero» / «Fecha de creación» / «Tiempo»» + los dos casos de valor (nombre resuelto, «—» sin mensajero) |
| «los estados no los muestra en badges» | `recibidas-columns.test.tsx` · «`<estado>` sale dentro de un chip», uno por cada uno de los cinco estados del listado + `RecepcionSateliteModule.test.tsx` · «el estado va en badge…» |
| «básicamente debe ser el mismo componente» | `recibidas-columns.test.tsx` · «cada columna montada es EL MISMO OBJETO que declaró `ordenesColumns`» (M1) + «el módulo NO declara ni una definición de columna propia» + «el módulo padre sigue declarando SUS dos columnas» (M6) |
| El dinero que el alcance no ve no se pinta | «ninguna cabecera de dinero restringido llega» (M3) + «las tres excluidas MENTIRÍAN sobre la fila real» (M4/M5) |
| La zona no se pierde al quitar el sufijo | «el chip ya NO repite la zona, y la zona sigue en su columna» + el caso equivalente del módulo |
| «Liberada el» no entra | «no monta la columna de la variante `reprogramada`» + «`reprogramada` de verdad NO está entre los estados» + «la cláusula NO es vacía» |

---

## F9. Verificación

### `pnpm typecheck`
```
> ordenex@0.1.0 typecheck R:\wt\349
> tsc --noEmit
```
Verde, sin salida. **Es también la prueba de la asignabilidad sin cast**: el `return` de
`recibidasColumns` devuelve `Column<OrdenListItemDTO>[]` bajo una firma
`Column<RecepcionSateliteDTO>[]`.

### `pnpm lint`
```
✖ 145 problems (0 errors, 145 warnings)
```
**0 errores**, el mismo número que dejó el backend. Ninguno de mis cinco archivos aparece.

### Guardias (`pnpm run test:guardias`)
```
 Test Files  1 failed | 172 passed (173)
      Tests  1 failed | 2589 passed (2590)
EXIT=1
```
El **único** rojo es el heredado y tolerado por el encargo:
`superficie-de-uso.guardia.test.ts` → `lib/actions/tarifas.ts:67 obtenerTarifa`.
(El +1 archivo / +3 casos frente al conteo del backend es su propio guardia nuevo,
`satelite-proyeccion-compartida.guardia.test.ts`, que él corrió antes de crearlo.)

### Suites de presentación, sobre el árbol FINAL
```
pnpm exec vitest run tests/unit/components tests/components tests/unit/descarga
 Test Files  402 passed (402)
      Tests  5296 passed | 26 skipped (5322)
 Duration  369.22s
EXIT=0
```
Corrida DESPUÉS de revertir las seis mutaciones y con el árbol tal como queda, no a mitad de
edición. Ni un rojo.

### Navegador
Un solo servidor de desarrollo, `--webpack`, apagado al terminar. Medidas en §F4.

**La suite COMPLETA no la corrí**: `./init.sh --rapido` se niega por diseño (el diff del backend
toca `lib/types/**`) y la completa la corre el leader, como dice el encargo.

---

## F10. Veredicto

La tabla de la bodega satélite deja de espejar a `/ordenes` y pasa a **montarla**: mismas
columnas, mismo objeto, mismo chip de estado, tres columnas más de las que tenía y ninguna del
dinero que ese alcance no puede ver. Lo que dejo abierto es el sufijo « de \<zona\>» del estado,
que retiré con precedente pero es una decisión del humano.
