# impl_386 — filtrar los cierres por estado (mitad de PANTALLA)

**Ficha 386** · `sdd: false`, sin spec · **sin migración, sin tocar la base, sin tocar el servidor**
· 2026-09-08
**Rama:** `worktree-agent-a666330198747cdbc` (worktree aislado, nacido del merge del PR #744).

La mitad de servidor está mergeada en `dev` y documentada en `progress/impl_386.md`. Esto es lo
que faltaba: el control de la barra y su traducción a la clave `estados`.

---

## LA DECISIÓN — qué pasa con los estados que no pertenecen a la lista activa

**Es una decisión de `frontend_dev`, no del humano.** El humano acotó la ficha a «solo el estado»
y no dijo nada de esto; el servidor dejó la semántica fijada (el filtro **interseca** con cada
lista, nunca la sustituye), y de ahí sale la pregunta: pedir `aprobado` estando en «Pendientes»
devuelve **vacío**, y eso es correcto pero se lee como una avería.

> **Se ofrecen los CUATRO estados en la barra, agrupados por la lista en la que aparecen, y el
> vacío se explica en el aviso que la barra ya pinta.**

### Por qué NO «solo los estados de la lista activa»

Las tres razones están medidas contra el código, no razonadas en el aire:

1. **La barra es UNA para los DOS listados**, por pedido humano del 2026-08-16
   (`CierresAdminModule` monta una sola `FiltrosCierresBarra` encima de las dos pestañas), y sus
   dos `useSWR` salen **a la vez** con el MISMO bloque de filtros, mire el usuario la pestaña que
   mire. Ofrecer solo los de la pestaña activa haría que el mismo control significara cosas
   distintas según dónde estés parado.
2. **Habría que PODAR la selección al cambiar de pestaña** —un `vencido` elegido en «Pendientes»
   deja de ser ofrecible en «Resueltos»— y `FilterComponent` **es dueño de su selección**: desde
   fuera solo se puede REMONTAR entero (el truco de la `key`, que la barra ya usa como `reset`).
   O sea: cambiar de pestaña le borraría al usuario el filtro que acaba de poner. Un control que
   se vacía solo se explica peor que una lista vacía.
3. **La descarga hereda `filtros`** (es el «esto que estoy viendo, entero» que fija el caso (3) de
   `CierresAdminFiltros.test.tsx`), así que el archivo dejaría de ser lo que se está viendo en
   cuanto la pestaña podara algo.

### Cómo se explica el vacío, entonces

Dos cosas, y las dos ocurren **antes** de que el usuario se quede mirando una lista vacía:

- **el desplegable AGRUPA los cuatro por su lista** («Pendientes»: Solicitado, Vencido ·
  «Resueltos»: Aprobado, Rechazado), con `role="group"` + `aria-label` —lo que `MultiSelectFilter`
  ya sabía hacer (R28)—, así que se ve a cuál pertenece cada estado **antes de elegirlo**;
- **el aviso de la barra añade una frase** cuando hay estado puesto: «Cada estado vive en una sola
  de las dos listas, así que la otra se ve vacía mientras el filtro esté puesto; el desplegable
  dice a cuál pertenece cada uno.»

El grupo **no se escribe a mano**: sale de `esColaCierreDia` (`lib/utils/colas-cierre.ts`), que es
el MISMO corte que el repositorio escribe como `in`/`notIn`. Así el desplegable no puede decir que
un estado vive en una lista y la consulta mandarlo a la otra.

### Vuelta atrás

Si el humano prefiere lo otro, el cambio está acotado a `FiltrosCierresBarra.tsx`:
`CierresAdminModule` le pasa su `tab` como prop, la barra filtra `OPCIONES_ESTADO` por
`esColaCierreDia` según esa prop y incrementa `reset` en cada cambio de pestaña para podar lo que
deje de ser ofrecible. Un `useMemo` y un `useEffect`. **No toca el servidor, ni `aFiltros`, ni el
contrato de `estados`.**

---

## La otra decisión: el filtro va APAGADO por defecto

`FiltrosCierresBarra` **la montan TRES pantallas**, no una:

| Pantalla | Bloque de filtros que su servidor acepta | ¿Admite `estados`? |
| --- | --- | --- |
| `CierresAdminModule` (cierres del día) | `filtrosCierresSchema` | **sí** |
| `CierresBodegaAdminModule` | `filtrosCierresBodegaSchema` (`.strict()`) | **no** |
| `ConsolidacionBodegaModule` | `filtrosCierresBodegaSchema` (`.strict()`) | **no** |

Así que la prop nueva es **`conEstado`, apagada por defecto**, al revés que `sinMensajero`. La
asimetría es deliberada: con la polaridad de `sinMensajero`, una pantalla nueva que montara esta
barra ofrecería de entrada un filtro que su propio servidor rechaza, y solo se enteraría cuando
alguien lo tocara. Además `aFiltros` **omite la clave** cuando no hay estado elegido (en vez de
emitirla con valor `undefined` como sus tres hermanas), de modo que lo que las dos pantallas de
bodega emiten **no cambia ni un byte**.

---

## La etiqueta: se REUSÓ, no se creó

**Ya existía `ESTADO_LABEL`** en `app/(app)/cierres-admin/_components/cierre-labels.ts` (módulo
PURO, promovido allí por la feature 170) con los cuatro textos: `Solicitado`, `Vencido`,
`Aprobado`, `Rechazado`. Es el mismo mapa con el que se pintan el badge de estado del detalle
(`EstadoCierreBadge`) y las celdas del archivo descargado. El desplegable lo lee de ahí, así que
la pantalla y el archivo no pueden decir cosas distintas. **No se creó ningún mapa nuevo.**

Lo único que se promovió a ese módulo son los dos nombres de las pestañas
(`TAB_PENDIENTES_LABEL` / `TAB_RESUELTOS_LABEL`), que vivían como literales privados de
`CierresAdminModule` y que ahora también necesita la barra para rotular los grupos. Misma
operación —y mismo motivo— que la feature 170 hizo con `DESTINO_TIPO_LABEL`.

---

## Archivos

### Modificados

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/FiltrosCierresBarra.tsx` | `CLAVE_ESTADO`, `FILTRO_ESTADO_LABEL`, `OPCIONES_ESTADO` (valores de `ESTADOS_FILTRO_CIERRES`, texto de `ESTADO_LABEL`, grupo de `esColaCierreDia`), `estadosONada`, la traducción a `estados` en `aFiltros`, la prop `conEstado` y `AVISO_ESTADO_POR_LISTA` |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | +`TAB_PENDIENTES_LABEL` / `TAB_RESUELTOS_LABEL` (promovidas desde `CierresAdminModule`) |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | pasa `conEstado`; sus dos literales de pestaña se leen ahora de `cierre-labels` |
| `tests/components/CierresAdminFiltros.test.tsx` | el `toEqual` de los filtros ofrecidos **actualizado** a cuatro (ver abajo) + tres casos nuevos de la ficha |

### Creados

| Archivo | Qué |
| --- | --- |
| `tests/components/FiltrosCierresBarraEstado.test.tsx` | 7 casos que montan la barra SOLA y miran el objeto que emite |

### NO tocados, a propósito

- **`lib/` entero**: el servidor ya estaba hecho y no hizo falta ni un byte. `filtros-cierres.ts`,
  `colas-cierre.ts` y `CierresAdminRepository.ts` solo se LEEN.
- **Ninguna migración, ningún `db/schema.prisma`, ninguna Server Action.**
- **`CierresBodegaAdminModule` y `ConsolidacionBodegaModule`**: no se tocan y no ganan el filtro.
- **`feature_list.json` y `progress/current.md`**: intactos.

---

## El `toEqual` literal que se puso rojo (y por qué se ACTUALIZÓ, no se relajó)

`tests/components/CierresAdminFiltros.test.tsx` tenía:

```ts
expect(opciones).toEqual(["Fecha de solicitud", "Bodega", "Mensajero"]);
```

**Ése ES el contrato** —«qué ofrece esta barra, y solo eso»—: su valor está justo en que un filtro
nuevo lo ponga rojo y obligue a decidir. Así que se actualizó a los cuatro, con el estado al
final. **No** se cambió por un `arrayContaining` (lo dejaría verde para siempre) **ni** se derivó
de la constante que genera las etiquetas (una aserción contra su propia fuente no prueba nada).

Por el mismo motivo, todas las etiquetas de los casos nuevos van **escritas a mano** en el
esperado: compararlas contra `ESTADO_LABEL` haría imposible que la mutación «pinta el enum crudo»
se pusiera roja.

---

## Mapa requisito → test

No hay `requirements.md` (`sdd: false`). Los `R<n>` son los del encargo, numerados aquí.
`BE` = `tests/components/FiltrosCierresBarraEstado.test.tsx`;
`CAF` = `tests/components/CierresAdminFiltros.test.tsx`.

| # | Requisito | Test |
| --- | --- | --- |
| F1 | La barra ofrece un filtro de ESTADO, y solo eso se añade a los tres de agosto | `CAF` → «la barra ofrece los filtros del pedido: fecha, bodega, mensajero y estado» (el `toEqual` literal) |
| F2 | Ofrece los CUATRO estados con nombre legible, **nunca** el valor crudo del enum | `BE` → «ofrece los CUATRO estados con su nombre legible…» (`toEqual` de las cinco etiquetas + `not.toMatch(/solicitado\|vencido\|aprobado\|rechazado/)`) |
| F3 | Los cuatro van agrupados por la lista en la que aparecen (la decisión, hecha pantalla) | `BE` → «los agrupa por la lista en la que aparecen…» (`role="group"` + `aria-label`) |
| F4 | El control emite `estados`, en PLURAL y como lista, con el value del enum | `BE` → «emite `estados` en PLURAL y como lista…» y «varios estados a la vez…» |
| F5 | Lo que la barra emite **lo acepta el borde real** | `BE` → los 4 casos que pasan el objeto emitido por `filtrosCierresSchema.safeParse` |
| F6 | **Desmarcarlo todo OMITE la clave**; nunca manda `[]` | `BE` → «DESMARCARLO TODO omite la clave…» (atajo «Todos») y «la X del control…» (`onChange([])` directo) |
| F7 | El filtro VIAJA al servidor en las DOS lecturas, no se aplica en el cliente | `CAF` → `(386-1)` |
| F8 | El filtro se lleva a la DESCARGA: el archivo sigue siendo lo que se está viendo | `CAF` → `(386-2)` |
| F9 | El vacío de la otra lista se EXPLICA, y solo cuando hay estado puesto | `CAF` → `(386-3)` (comprueba las dos mitades: con solo el mensajero la frase NO está) |
| F10 | Con solo el estado puesto la barra sigue ofreciendo «Limpiar todo» y su aviso | `CAF` → `(386-3)` (la nota existe con el estado como único filtro nuevo) |
| F11 | Las dos pantallas de BODEGA no lo ofrecen ni lo emiten | `BE` → «por defecto la barra NO ofrece el estado…» (las dos mitades: no se ofrece **y** no aparece la clave) |
| F12 | Los otros filtros no se tocan | `CAF` → los casos (1)–(4) de 2026-08-16 y los tres de la ficha 351, **sin editar**, siguen verdes |

---

## Mutaciones (arnés con autocomprobación)

El arnés (`mutar.mjs`, de un solo uso, en el scratchpad) **aborta** si: el texto buscado no aparece
exactamente una vez; la relectura tras escribir no contiene el reemplazo; vitest no emitió su línea
`Tests …`; o si tras restaurar el archivo no vuelve a ser **byte a byte** el original. Las cuatro
corridas imprimieron `RESTAURADO: relectura identica byte a byte al original.`

Las cuatro sobre `FiltrosCierresBarra.tsx`, contra `FiltrosCierresBarraEstado.test.tsx` +
`CierresAdminFiltros.test.tsx`.

### M1 — «desmarcarlo todo manda `[]` en vez de omitir la clave» → **ROJO**

```
-  const estados = estadosONada(seleccion[CLAVE_ESTADO]);
+  const estados = (seleccion[CLAVE_ESTADO] ?? []) as [CierreEstado, ...CierreEstado[]];
```

```
 Test Files  2 failed (2)
      Tests  8 failed | 12 passed (20)
 FAIL  BE > DESMARCARLO TODO omite la clave: no manda `[]`, que el borde rechaza
 FAIL  BE > la X del control también lo deja sin filtro, no con la lista vacía
       AssertionError: expected true to be false   ← la clave sobrevivió al desmarcado
 FAIL  BE > por defecto la barra NO ofrece el estado, y lo que emite no lleva la clave
 FAIL  CAF > (1) (2) (3) (4) [los cuatro de agosto] · (386-3)
```

Lo importante: el `filtrosCierresSchema.safeParse` del objeto emitido —el **mismo zod que valida la
Server Action**— se pone en `false`. No es un literal escrito a mano en el esperado.

### M2 — «el control pinta el valor crudo del enum» → **ROJO**

```
-  label: ESTADO_LABEL[estado],
+  label: estado,
```

```
 Test Files  2 failed (2)
      Tests  8 failed | 12 passed (20)
 FAIL  BE > ofrece los CUATRO estados con su nombre legible…
       AssertionError: expected [ 'Todos', 'solicitado', …(3) ] to deeply equal [ 'Todos', 'Solicitado', …(3) ]
 FAIL  BE > los agrupa por la lista…
       AssertionError: expected [ 'solicitado', 'vencido' ] to deeply equal [ 'Solicitado', 'Vencido' ]
 FAIL  BE > emite `estados`… · varios estados… · la X del control…
 FAIL  CAF > (386-1) (386-2) (386-3)
```

### M3 — «el filtro no llega a `aFiltros` y la consulta sale sin él» → **ROJO**

```
-    ...(estados === undefined ? {} : { estados }),
+    ...(void estados, {}),
```

```
 Test Files  2 failed (2)
      Tests  7 failed | 13 passed (20)
 FAIL  CAF > (386-1) el estado elegido VIAJA al servidor en las dos lecturas
       AssertionError: expected "vi.fn()" to be called with arguments: [ ObjectContaining{…} ]
 FAIL  CAF > (386-2) el estado se lleva a la descarga… · (386-3) el aviso…
 FAIL  BE > emite `estados`…   AssertionError: expected undefined to deeply equal [ 'vencido' ]
 FAIL  BE > varios estados…    AssertionError: expected undefined to deeply equal [ 'solicitado', 'vencido' ]
 FAIL  BE > DESMARCARLO TODO… · la X del control…
```

### M4 — «los cuatro estados en un solo grupo» (la decisión, mutada) → **ROJO** (extra)

```
-  group: esColaCierreDia(estado) ? TAB_PENDIENTES_LABEL : TAB_RESUELTOS_LABEL,
+  group: (void esColaCierreDia(estado), TAB_PENDIENTES_LABEL),
```

```
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
 FAIL  BE > los agrupa por la lista en la que aparecen…
       AssertionError: expected [ 'Solicitado', 'Vencido', …(2) ] to deeply equal [ 'Solicitado', 'Vencido' ]
```

Existe porque el agrupado **es** el mecanismo con el que se resuelve la decisión de arriba; si
nadie lo vigila, la mitad visible de esa decisión se puede borrar sin que la suite se entere.

---

## Gate

`pnpm install` (el worktree no traía `node_modules` propio) y `pnpm run db:generate` **antes** del
typecheck. `.env` copiado desde la raíz antes de correr —sin él ~134 archivos de
`tests/integration/db` se saltan y el gate dice OK sin comprobar nada— y **borrado antes de
commitear**.

### `./init.sh --rapido` → se niega, como debe

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    app/(app)/cierres-admin/_components/CierresAdminModule.tsx
    app/(app)/cierres-admin/_components/FiltrosCierresBarra.tsx
    app/(app)/cierres-admin/_components/cierre-labels.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

### `./init.sh` completo — **VERDE a la primera**

```
 Test Files  1791 passed (1791)
      Tests  25635 passed | 26 skipped (25661)
   Duration  972.39s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1791 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

`INIT_EXIT=0`, leído **de dentro del log** (`init.sh > log 2>&1; echo "INIT_EXIT=$?" >> log`, sin
`tail`). Los **26 `skipped` son exactamente los conocidos**. Cuadran los números contra la corrida
de la mitad de servidor: 1790 → **1791** archivos (el de la barra) y 25.651 → **25.661** tests
(+7 en el archivo nuevo, +3 en `CierresAdminFiltros`). El aviso de las tres migraciones sin
`down.sql` es deuda previa y ajena: esta ficha no crea migraciones.

**Ningún `40P01`.** El rojo por contención entre tests de migración que se vio en la mitad de
servidor no se reprodujo en esta corrida.

### Comandos sueltos

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: cero errores)

$ pnpm run lint
✖ 174 problems (0 errors, 174 warnings)      ← 0 errores; los 174 son preexistentes

$ pnpm exec vitest related --run FiltrosCierresBarra.tsx cierre-labels.ts CierresAdminModule.tsx
 Test Files  106 passed (106)
      Tests  1572 passed (1572)
```

---

## Dos cosas del encargo que NO eran exactas, medidas en el archivo real

1. **«El control en `FiltrosCierresBarra.tsx`» sugiere una sola pantalla, y son TRES.** La barra la
   montan también `CierresBodegaAdminModule` y `ConsolidacionBodegaModule`, cuyo bloque
   (`filtrosCierresBodegaSchema`) **no declara `estados` y es `.strict()`**. Ofrecer el control ahí
   habría dado `validation_error` en cuanto alguien lo tocara. De ahí `conEstado`, apagada por
   defecto. `progress/impl_386.md` ya lo advertía («NO entra… en los listados de bodega»); el
   encargo no lo repetía.
2. **«Busca si ya existe un mapa de etiquetas… si no existe, créalo»**: existe
   (`ESTADO_LABEL`, `cierre-labels.ts`) y se reusó. No hizo falta crear nada.

Y una que **sí** era exacta y conviene dejar escrita porque parece un bug y no lo es: la barra
emite `mensajeroIds: undefined` (y `desde`/`hasta`/`destinoZonaIds` igual) también a las dos
pantallas de bodega, cuyo `.strict()` **sí rechaza** una clave desconocida aunque su valor sea
`undefined` (medido con la zod v4 del repo). No revienta, y se midió por qué: el decodificador de
Server Actions de React (`reviveModel`, en
`node_modules/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.edge.development.js`)
hace `void 0 !== parentObj ? (value[k] = parentObj) : delete value[k]`, o sea **borra la clave**
cuando el valor revivido es `undefined`. Así que al servidor le llega `{}`. Se deja como está —no
es de esta ficha—, pero el `estados` nuevo **no se apoya en esa sutileza**: se omite en origen.

---

## Veredicto

Filtro de estado en la barra de `/cierres-admin`: los cuatro estados con su etiqueta legible
—reusando `ESTADO_LABEL`, nunca el enum crudo—, agrupados por la lista a la que pertenecen y con
el vacío explicado; emite `estados` en plural y omite la clave cuando no hay ninguno, así que las
dos pantallas de bodega siguen emitiendo exactamente lo de antes. Gate completo en verde a la
primera (`INIT_EXIT=0`, 26 `skipped` conocidos) y cuatro mutaciones muertas.
