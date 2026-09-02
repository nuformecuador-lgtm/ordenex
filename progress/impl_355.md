# Ficha 355 — el filtro de estados de la bodega satélite pasa a ser el de la central

Rama `fix/355-filtro-estados-satelite`, worktree `R:\wt\349`. Zona: frontend. Sin commit (lo hace
el leader).

---

## 1. Qué pidió el humano, y por qué la medición anterior no lo respondía

Con las dos capturas delante (2026-09-02):

> «quiero que veas la diferencia del filtro de estados: esto es lo que filtra la central […] y
> esto lo que filtran las satélite […]. **Las satélite deberían poder filtrar por estado igual
> que la central, solo que con sus órdenes nada más**.»

Y su criterio general, dicho antes: *«los filtros de las órdenes de la central son los que están
casi perfectos»*. La central es el patrón.

La ficha 349 midió que **«todo estado que aparece en la tabla se puede filtrar»** y concluyó que
no faltaba ninguno (`progress/impl_349.md` §4). **Esa medición era correcta y sigue siéndolo**;
respondía a otra pregunta. El humano no pide que no falten estados alcanzables: pide que el
filtro sea **el mismo control con el mismo vocabulario**, acotado a sus órdenes.

Las tres divergencias, medidas en el código antes de tocar nada:

| | `/ordenes` (central) | `/recepcion-satelite/en-bodega` |
|---|---|---|
| opciones | catálogo `order_status` (22) | `ESTADOS_BODEGA_SATELITE`, 5 escritos a mano |
| etiquetas | `ORDER_STATUS_LABELS` | un `Record` propio |
| buscador | «Filtrar estados…» | «Buscar…» (el default de `MultiSelectFilter`) |
| resumen | «Todos» | «Todos los estados» |
| sin coincidencias | «Ningún estado coincide» | «Sin estados» |

Las etiquetas eran lo grave y es lo que el humano viene señalando en toda la tanda: el MISMO
estado con DOS nombres según la pantalla.

| `value` | decía la satélite | dice el catálogo (y la central) |
|---|---|---|
| `en_bodega_satelite` | Recibidas | En bodega satélite |
| `por_recoger` | Asignadas (por recoger) | Por recoger |
| `devolviendo_a_bodega_central` | En tránsito a central | Devolviendo a bodega central |
| `devuelta` | Devueltas | Devuelta |
| `por_devolver` | Por devolver | Por devolver *(coincidía)* |

---

## 2. Qué se unificó

**El control de estado se declara UNA vez y lo montan las dos superficies.**

Módulo nuevo `app/(app)/ordenes/_components/filtro-estado-def.ts`:

- `filtroEstado(catalogo, { key, valor, exclude })` → el `FilterDef` completo: etiqueta, `kind`,
  `placeholder`, `searchPlaceholder`, `emptyMessage` y opciones.
- `estadosOfrecidos(catalogo, exclude)` → el recorte «catálogo − retirados del seed − exclude»,
  que vivía dentro de `OrdenesListado.tsx` (`VALUES_VIGENTES`).
- Las etiquetas salen de `estatusLabel` → `ORDER_STATUS_LABELS`, el MISMO mapa que pinta el chip
  de cada fila desde la 349.

Lo ÚNICO propio de cada superficie es qué viaja en la selección, y por eso es un parámetro
cerrado (`valor: "id" | "value"`) y no una función libre:

- `/ordenes` emite el **id** de catálogo (`filter.status_id`, lo que espera `listarOrdenes`);
- la bodega emite el **value** (`estados`, lo que espera `listarOrdenesBodegaPaginado` y valida
  su `z.enum`).

`OrdenesListado.tsx` **no cambia de comportamiento**: monta la misma declaración que antes tenía
inline. Se le retiran `VALUES_VIGENTES`, `labelDe` (tercera copia del mapa de etiquetas) y las
seis líneas del `FilterDef`.

El catálogo lo pide la bodega con SWR **con la misma clave que la central**
(`"order-status:catalogo"`), así que las dos pantallas comparten entrada de caché.
`listarOrderStatus` ya autorizaba a `adminSatelite` (feature 63/R2): no hizo falta tocar
autorización, ni servicio, ni borde.

---

## 3. La decisión: los estados que su alcance NUNCA puede devolver

**Se OFRECEN, y el vacío se explica en pantalla.** El desplegable de la bodega tiene hoy las 22
entradas del catálogo, las mismas y en el mismo orden que la central.

Por qué, en orden de peso:

1. **Es lo que se pidió**, literalmente: «igual que la central».
2. **La ficha exige que el conjunto salga del catálogo compartido, «no de una lista escrita
   aparte»** — y `ESTADOS_BODEGA_SATELITE` ES una lista escrita aparte. No hay término medio:
   cualquier recorte a cinco vuelve a necesitarla, y con ella vuelve el riesgo de que las dos
   pantallas se separen sin que nadie lo note. Ese fue el argumento decisivo.
3. **Ocultarlos tampoco era honesto**: al `adminSatelite` sus órdenes SÍ pasan por
   `en_reparto`, `ayuda_tienda` o `en_ruta_bodega_satelite` — simplemente no las enseña ESTE
   listado (unas viven en «Por recibir», otras están en la moto). Un desplegable de cinco
   sugería que su mundo tiene cinco estados; el de 22 con un vacío explicado dice la verdad.

El precio, dicho: 17 de las 22 opciones devuelven cero en este listado. Se compensa nombrándolo
en pantalla en vez de dejar una tabla en blanco.

**Lo que se pierde y se acepta:** los nombres viejos decían el ROL del estado dentro del flujo de
la bodega («Asignadas (por recoger)» es más explícito que «Por recoger»). A cambio, desplegable,
chip de la fila y pantalla del maestro dicen todos lo mismo.

### El texto del vacío, y dónde va

- Todo lo elegido es inalcanzable → *«Ninguna orden de esta bodega puede estar en «Entregada»:
  ese estado no forma parte de este listado.»*
- Mezcla (`Entregada` + `En bodega satélite`) → *«"Entregada" no es un estado de este listado: no
  suma órdenes.»* — el resultado es correcto, pero sin este aviso parecería un filtro ignorado.

**Va bajo el CONTADOR, no en el `emptyMessage` de la tabla, y eso lo decidió el navegador, no una
preferencia.** La primera versión lo puso en el vacío del `DataTable`; a 1440 se leía bien, pero
el vacío vive en un `<td colSpan>` dentro del contenedor con scroll horizontal y **a 390 px
quedaba fuera de la vista**: la pantalla enseñaba una tabla en blanco sin ninguna explicación.
Medido con Playwright y corregido. Bajo el contador se lee a las dos anchuras y además cae dentro
del `role="status"` de la barra, así que un lector de pantalla lo anuncia al cambiar el filtro.

---

## 4. El límite que NO se cruzó

**La regla escrita se queda intacta:** la selección INTERSECA la lista blanca de los cinco
estados y nunca la amplía (`estadosDelListado`, `lib/utils/estados-bodega-satelite.ts`). No se
tocó ese archivo, ni el servicio, ni el borde (`z.enum(ESTADOS_BODEGA_SATELITE)`), ni el
repositorio. Cero cambios fuera de la capa de presentación.

Lo que sí apareció al ofrecer el catálogo entero es **un caso que antes era inalcanzable**: que
la intersección quede vacía con una selección que no lo estaba (elegir sólo `entregada`).

⚠️ **Y ahí hay una trampa que hay que dejar escrita**: en el servidor, `estados: []` NO significa
«ninguna», significa **«todas»** — `estadosDelListado([])` devuelve los cinco, porque la lista
vacía es el «sin filtro» del desplegable. Mandar la intersección vacía al servidor habría
enseñado el listado COMPLETO justo cuando el usuario pidió lo contrario.

Solución, toda en presentación:

- `seleccionAFiltroSatelite` emite `estados: []` — la clave VIAJA, y viaja vacía — cuando la
  selección no estaba vacía y la intersección sí. Es la marca de «nada puede casar».
- `filtroSinResultados(filtro)` la reconoce, y los TRES puntos que hablan con el servidor cortan
  antes de salir: `leerPagina`, `comprobarVigencia` y `obtenerFilasDescarga`.
- `serializarFiltroSatelite({ estados: [] })` = `"estados="`, que NO es `FILTRO_SATELITE_VACIO`
  (`""`): si colisionaran, la selección imposible reutilizaría la página sin filtros que
  pre-cargó el servidor y el listado saldría entero por la puerta de atrás.

**El corte es del cliente y sólo puede QUITAR filas, nunca añadirlas.** Si algún día se olvidara,
el peor caso sería enseñar las órdenes de la bodega en vez de ninguna: el borde no deja salir de
los cinco estados ni de la zona del actor. La dirección peligrosa está cerrada por construcción.

### Un agujero que existía antes y queda cerrado de paso

Con la lista de cinco opciones, `?estado=entregada` en la URL llegaba a
`seleccionAFiltroSatelite`, no casaba con ninguna opción declarada, `seleccionDesdeUrl` lo
descartaba y **el listado salía COMPLETO**. Hoy `entregada` es una opción declarada, la
intersección se ejecuta y el resultado es cero. No es un alcance nuevo (siempre fueron sus
órdenes), pero era la respuesta contraria a la que la regla escrita prometía.

---

## 5. Archivos

### Creados
- `app/(app)/ordenes/_components/filtro-estado-def.ts` — la declaración compartida del control.
- `tests/unit/components/satelite-filtro-estado.test.ts` — 14 casos: unificación + intersección.
- `tests/components/SateliteFiltroEstadoAlcance.test.tsx` — 6 casos de pantalla: el desplegable
  renderizado y el límite de alcance con el doble de las TRES capas del servidor.
- `tests/fixtures/order-status-catalogo.ts` — el catálogo `order_status` para suites jsdom.

### Modificados
- `app/(app)/ordenes/_components/OrdenesListado.tsx` — monta la declaración compartida; pierde
  `VALUES_VIGENTES`, `labelDe` y el `FilterDef` inline. Sin cambio de comportamiento.
- `app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros.ts` — el filtro de estado
  pasa a `filtroEstado`; se retiran `ETIQUETA_ESTADO` y `ESTADOS_SATELITE`; `etiquetaEstado`
  delega en `estatusLabel`; nacen `estadosFueraDelListado` y `filtroSinResultados`.
- `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` — SWR del catálogo, la
  explicación bajo el contador.
- `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` — los tres cortes.
- `tests/components/descarga/SateliteDescarga.test.tsx`,
  `tests/components/paginacion/SatelitePaginacion.test.tsx`,
  `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` — doblan
  `listarOrderStatus` y llegan a la opción por su etiqueta de catálogo (era «Recibidas»).
- `tests/unit/components/filtros-acotados-por-rol.test.ts` — retira cinco imports muertos, uno de
  ellos a `ESTADOS_SATELITE`, que ya no existe.

---

## 6. Verificación

### Navegador (Playwright, Chromium headless)

⚠️ **Sobre el «un solo servidor de desarrollo»:** había ya DOS corriendo (`:3000` y `:3001`) y
ninguno servía este worktree, así que no podían enseñar este cambio. Se levantó uno propio en
`:3010` desde `R:\wt\349` — `.next` es por directorio, no se comparte con los otros. Y hubo que
usar **`next dev --webpack`**: Turbopack **PANICA** con el junction de `node_modules` de los
worktrees (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`).
Dato reutilizable: en un worktree, el dev server sólo arranca con `--webpack`.

Sesión `satelite.qa@ordenex.test` (zona Quepos, 6 órdenes) y `admin.qa@ordenex.test`. Sin OTP: el
riesgo no llega al umbral en local.

**Las dos listas, leídas del DOM. Son idénticas, entrada por entrada:**

```
central  · 1440x900 · /ordenes                        buscador: "Filtrar estados…"
satélite · 1440x900 · /recepcion-satelite/en-bodega   buscador: "Filtrar estados…"
satélite ·  390x844 · /recepcion-satelite/en-bodega   buscador: "Filtrar estados…"

 0. Todos                          12. En ruta a bodega satélite
 1. Ayuda solicitada a la tienda   13. Entregada
 2. Devolución por confirmar       14. Incidente
 3. Devolviendo a bodega central   15. Por devolver
 4. Devolviendo a tienda           16. Por devolver a tienda
 5. Devuelta                       17. Por recoger
 6. Devuelta a tienda              18. Por recolectar en tienda
 7. En bodega central              19. Rechazada
 8. En bodega satélite             20. Recolectando
 9. En preparación                 21. Reprogramada
10. En reparto                     22. Sin gestionar
11. En ruta a bodega central
```

Las tres corridas devuelven **23 opciones** (22 del catálogo + el atajo «Todos» que pone
`MultiSelectFilter`), en el mismo orden. Antes la satélite daba 5, con otros nombres y con
«Buscar…».

**El vacío explicado** (`satelite`, elegir «Entregada»), a las dos anchuras:

```
Órdenes de la bodega
0 de 6 órdenes
Ninguna orden de esta bodega puede estar en «Entregada»: ese estado no forma parte de este listado.
Estado: Entregada
[tabla] Ninguna orden coincide con los filtros.
```

**La mezcla** («Entregada» + «En bodega satélite»), 1440:

```
Órdenes de la bodega
6 de 6 órdenes
«Entregada» no es un estado de este listado: no suma órdenes.
Estado: 2 seleccionados
[6 filas, todas En bodega satélite]
```

### Mutaciones — 4 aplicadas, 4 rojas, 4 revertidas

**M1 (la obligatoria) — la selección AMPLÍA la lista blanca en vez de intersecarla.**
`filtro.estados = elegidos.filter(esEstadoDelListado)` → `filtro.estados = elegidos`.

```
FAIL tests/unit/components/satelite-filtro-estado.test.ts > NINGÚN estado de fuera del listado entra en el filtro, uno por uno
AssertionError: «entregada» se coló en el filtro: expected [ 'entregada' ] to deeply equal []
FAIL tests/components/SateliteFiltroEstadoAlcance.test.tsx > elegir un estado que su alcance no devuelve da CERO filas, no el listado entero
AssertionError: expected 2 to be 1
```
6 casos rojos. El segundo es el que importa: la consulta SALIÓ, y en producción el borde la
habría rechazado entera (`z.enum`), rompiendo la pantalla en vez de filtrar.

**M2 — la lista vacía se OMITE (el comportamiento previo a la ficha: «ninguna» cae a «todas»).**
`if (estados.length > 0) filtro.estados = estados`.

```
FAIL tests/components/SateliteFiltroEstadoAlcance.test.tsx > elegir un estado que su alcance no devuelve da CERO filas, no el listado entero
AssertionError: expected [ 'REM-01', 'REM-02', 'REM-03', …(7) ] to deeply equal []
FAIL tests/unit/components/satelite-filtro-estado.test.ts > la selección imposible NO comparte clave de caché con «sin filtros»
AssertionError: expected '' not to be ''
```
5 casos rojos. Es exactamente el fallo que se temía: elegir «Entregada» y ver las diez.

**M3 — se quita el corte de `leerPagina`.** `estados: []` viaja al servidor.

```
FAIL tests/components/SateliteFiltroEstadoAlcance.test.tsx > elegir un estado que su alcance no devuelve da CERO filas, no el listado entero
AssertionError: expected [ 'REM-01', 'REM-02', 'REM-03', …(7) ] to deeply equal []
```
2 casos rojos. Confirma con un test que `estados: []` significa «todas» en el servidor.

**M4 — las opciones vuelven a escribirse a mano** (los cinco de `ESTADOS_BODEGA_SATELITE`, con
placeholder y `emptyMessage` propios).

```
FAIL tests/unit/components/satelite-filtro-estado.test.ts > REACCIONA al catálogo: con tres estados ofrece tres, y sin catálogo ninguno
AssertionError: expected [ 'en_bodega_satelite', …(4) ] to deeply equal [ Array(3) ]
FAIL … > los textos del control son los de la central, incluido el del buscador
AssertionError: expected 'Todos los estados' to be 'Todos'
```
11 casos rojos. Es la mutación que ata la unificación: la lista escrita a mano no puede
REACCIONAR al catálogo y por eso no puede pasar «con tres ofrece tres» y «sin catálogo ninguno» a
la vez.

**Ninguna mutación sobrevivió.**

### Suite y gates

- `pnpm typecheck` — verde.
- `pnpm lint` — **0 errores**, 145 warnings, todos preexistentes (`no-unused-vars` en tests
  ajenos). Ninguno en los archivos de esta ficha.
- `tests/unit/components/` + `tests/components/` completos — **5.095 verdes, 26 skipped, 1 rojo**:
  `CrearTiendaForm.test.tsx › una tienda con SÓLO tarifas de zona tampoco se ofrece`. **Es un
  flake bajo carga, no una regresión**: pasa aislado (4/4 en segundos) y su sujeto —tiendas y
  tarifas— no toca nada de esta ficha. Mismo patrón ya conocido en el repo.

Un hallazgo colateral de la corrida: la primera forma del corte de la descarga **fabricaba** un
`DescargaFilasResult` a mano y la puso roja la guardia transversal
(`ControlDescargaTransversal` · *«ninguna tabla se salta el tope»*). La guardia tenía razón: se
rehízo para que lo sustituido sea la LECTURA y el resultado siga pasando por
`filasDesdeResultado`, que es el único punto que traduce el tope y los errores.

---

## 7. Lo dudoso / abierto

1. **17 opciones de 22 devuelven cero en este listado.** Es la consecuencia directa de la
   decisión, está explicada en pantalla y es lo que se pidió, pero es un cambio de sensación de
   uso: el desplegable pasa de 5 a 22 entradas. Si al humano le resulta ruidoso, el escape
   natural NO es volver a la lista de cinco, sino un `exclude` por rol en
   `app/(app)/ordenes/exclude-por-rol.ts` — que es el mecanismo que la central ya usa para el
   `adminTienda`, y que dejaría la decisión donde vive el resto.
2. **El vacío de `DataTable` no se lee a 390 px** en NINGUNA de las ~25 tablas del repo: el `<td
   colSpan>` queda fuera del scroll horizontal. Esta ficha lo esquivó (movió su mensaje fuera de
   la tabla), **no lo arregló**. Vale una ficha propia: hoy «No hay órdenes en la bodega.» y
   «Ninguna orden coincide con los filtros.» son invisibles en móvil en todas ellas.
3. **El dev server registra la contraseña en claro** en el log de la Server Action de login
   (`login({"email":…,"password":"…"})`). Es preexistente y de desarrollo, pero si ese mismo
   registro de argumentos está activo en Vercel, las contraseñas están en los logs de
   producción. No se investigó — fuera del alcance de esta ficha, pero conviene mirarlo.
4. **Turbopack no arranca en un worktree** (panic por el junction de `node_modules`). Anotado
   arriba; afecta a cualquier agente que quiera ver la app desde un worktree.

---

## 8. Post-gate (2026-09-02) — el ancla de carga de los cuatro casos

El gate completo, tras el merge, dejó **un rojo real** que las corridas dirigidas no vieron:
`tests/unit/guards/ancla-de-carga.guardia.test.ts` señalaba **cuatro esperas** de
`tests/components/SateliteFiltroEstadoAlcance.test.tsx` (:296, :333, :350, :376), todas de la
misma forma:

```ts
await waitFor(() => expect(remisionesVisibles()).toHaveLength(10));
```

**Por qué era un defecto de verdad y no una regla de estilo.** Durante la carga, el `DataTable`
pinta un `<tr role="status">` («Cargando», sr-only) más filas skeleton `aria-hidden`. Hay
estados TRANSITORIOS que satisfacen un conteo, así que un `waitFor` anclado sólo a un número
puede darse por cumplido **con la tabla a medio pintar**. Y estos cuatro casos son precisamente
los que verifican el **límite de alcance** del `adminSatelite`: un verde a media carga los
dejaría sin afirmar lo que dicen afirmar. Es la misma familia del «verde por accidente».

**Arreglo, el que pide la guardia (aserción de CONTENIDO, no ausencia de `role="status"`):**

```ts
const TODAS_LAS_REMISIONES: string[] = CONJUNTO.map((o) => o.numRemision);
…
await waitFor(() => expect(remisionesVisibles()).toEqual(TODAS_LAS_REMISIONES));
```

Decir **cuáles** diez es más fuerte que decir **diez** —ningún estado intermedio lo cumple— y
además documenta el punto de partida contra el que los tres casos de filtrado comparan.

### Comprobación de que el ancla nueva no tapa la prueba

No basta con que la guardia pase: había que confirmar que los cuatro casos **siguen cayendo**
cuando se rompe lo que vigilan. Se re-aplicaron dos mutaciones ya usadas en §6, ahora con el
ancla nueva:

**M1 — la selección AMPLÍA la lista blanca en vez de intersecarla** (el recorte de alcance roto):

```
× elegir un estado que su alcance no devuelve da CERO filas, no el listado entero
  AssertionError: expected 2 to be 1                     ← la consulta SALIÓ
× y el ARCHIVO dice lo mismo que la pantalla: tampoco trae nada
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
× una selección MEZCLADA trae la parte alcanzable, y avisa de la otra
  AssertionError: expected [] to deeply equal [ 'REM-07', 'REM-08', 'REM-09', …(1) ]
```

**Exactamente los mismos tres casos y los mismos mensajes que antes del cambio de ancla**, y en
los tres el fallo está en la aserción de fondo, no en el ancla de la carga inicial (que M1 no
altera: al montar todavía no hay filtro de estado). El cuarto caso —`CONTROL POSITIVO`— no cae
bajo M1 **y no debe caer**: elige un estado que SÍ es de la lista blanca, así que ampliar no
cambia nada; su trabajo es probar que el desplegable emite. Para verificar que su ancla tampoco
lo tapa se re-aplicó **M4 (las opciones vuelven a escribirse a mano)**: **6 de 6 rojos**,
`CONTROL POSITIVO` incluido.

Conclusión: el arreglo del ancla no encubrió ninguna prueba.

### Gate

- `pnpm typecheck` — verde.
- `tests/unit/guards/ancla-de-carga.guardia.test.ts` — **verde** (0 infractores).
- `pnpm test` **completa**: `Test Files 1 failed | 1656 passed (1657)`,
  `Tests 1 failed | 23404 passed | 26 skipped (23431)`. El único rojo es el heredado y tolerado:

  ```
  FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
    + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
  ```

  **Ni `historico-conversaciones.int` ni `CrearTiendaForm` salieron rojos** en esta corrida (el
  `CrearTiendaForm` que sí cayó en la corrida parcial de §6 era el flake bajo carga: aquí, en la
  suite entera, pasa).

Sólo cambia `tests/components/SateliteFiltroEstadoAlcance.test.tsx`. Sin commit.
