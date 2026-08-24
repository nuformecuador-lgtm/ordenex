# Feature 258 — bitácora del bloque FRONTEND (F1–F7)

Rama: `feat/258-monitoreo-backend` (no se cambió de rama). Sin commit y sin PR: eso lo hace el
leader. Alcance: **sólo F1–F7**. No se tocó `lib/` salvo lo que se dice abajo (no se tocó: el
bloque backend está cerrado y su contrato se consumió tal cual).

---

## Tareas cerradas

| Tarea | Estado |
| --- | --- |
| F1.1 — `VARIANTE_CONTADOR` clavado por clave de contador | cerrada |
| F1.2 — `ContadoresTablero` sobre `Badge`, con densidad | cerrada |
| F1.3 — `Lock` verificado en `lucide-react` | cerrada (existe; **no** hizo falta el fallback `XCircle`) |
| F1.4 — `TableroDiaTarjetas.test.tsx` ampliado | cerrada |
| F2.1 — `TableroDiaEstados` con iconos + vacío de filtro | cerrada |
| F2.2 — iconos en los dos `Alert` del módulo | cerrada |
| F2.3 — `TableroDiaEstados.test.tsx` (nuevo) | cerrada |
| F3.1 — detalle: `Sheet` → `Modal` + `DataTable` + `Pagination` | cerrada |
| F3.2 — `DetalleMensajeroPanel.test.tsx` actualizado | cerrada |
| F4.1 — `filtrar-mensajeros.ts` (nuevo) | cerrada |
| F4.2 — `TableroDiaControles.tsx` (nuevo) | cerrada |
| F4.3 — cableado en módulo / rejilla / tarjeta | cerrada |
| F4.4 — totales recalculados sobre lo filtrado | cerrada |
| F4.5 — `TableroDiaFiltro.test.tsx` (nuevo) | cerrada |
| F5.1 — `COLOR_SEGMENTO` | cerrada (**con un delta: ver §Deltas 1**) |
| F5.2 — `ComposicionBarra.tsx` (nuevo) | cerrada |
| F5.3 — `TableroDiaComposicion.test.tsx` (nuevo) | cerrada |
| F6.1 — `serie-ritmo.ts` (nuevo) | cerrada |
| F6.2 — `GraficaLineas` montada | cerrada (**con un delta: ver §Deltas 2**) |
| F6.3 — tests de la línea | cerrada |
| F7.1 — `primitivas.guardia.test.ts` (nuevo) | cerrada |
| F7.2 — `page.tsx` sin cambios, `TableroDiaPage.test.tsx` pasa sin tocarlo | cerrada |
| **F7.3 — revisión visual en los dos temas** | **NO cerrada: no puedo levantar la app. Ver §Abierto 1** |
| **F7.4 — gate completo** | **NO cerrada: la corre el leader** |

Las casillas están marcadas en `specs/258-monitoreo-tablero-primitivas/tasks.md` (F7.3 y F7.4
siguen en `[ ]`).

---

## Archivos

### Creados — código

- `app/(app)/monitoreo/_components/ComposicionBarra.tsx` — la barra apilada (R66–R70).
- `app/(app)/monitoreo/_components/TableroDiaControles.tsx` — `Input` de filtro + `SegmentedToggle`.
- `app/(app)/monitoreo/_components/filtrar-mensajeros.ts` — normalización, filtro e iniciales (puras).
- `app/(app)/monitoreo/_components/serie-ritmo.ts` — el adaptador de la serie (R59/R77).
- `app/(app)/monitoreo/_components/densidad.ts` — el tipo `DensidadTablero` y su valor inicial.

> **`densidad.ts` no está en el mapa de archivos del design**, y es el único archivo nuevo que no
> estaba previsto. Motivo: la densidad la consumen CUATRO archivos (módulo, rejilla, tarjeta y
> contadores) y tenerla dentro de `TableroDiaControles.tsx` ataba la forma del dato al componente
> que lo dibuja — cualquiera de los cuatro habría acabado importando el componente por su tipo.
> Son 12 líneas de tipo + constantes, sin JSX.

### Creados — tests

- `tests/components/TableroDiaEstados.test.tsx`
- `tests/components/TableroDiaFiltro.test.tsx`
- `tests/components/TableroDiaComposicion.test.tsx`
- `tests/components/TableroDiaRitmo.test.tsx`
- `tests/unit/components/serie-ritmo.test.ts`
- `tests/unit/components/filtrar-mensajeros.test.ts`
- `tests/unit/tablero-dia/primitivas.guardia.test.ts`

### Modificados — código

- `app/(app)/monitoreo/_components/contadores.ts` — `+ ClaveContador`, `+ CLAVES_CONTADOR`,
  `+ etiquetaContador`, `+ VARIANTE_CONTADOR`, `+ COLOR_SEGMENTO`. No se tocó nada de la 192.
- `…/ContadoresTablero.tsx` — los ocho contadores pasan a `Badge`; acepta `densidad`; monta la
  barra cuando quien la usa le da su etiqueta. El `<dl>/<dt>/<dd>` pasa a `<div>`: un `Badge` es
  un `span` y `dl > span` no es HTML válido.
- `…/MensajeroCard.tsx` — avatar de iniciales (`aria-hidden`), `aria-pressed`, densidad.
- `…/TableroDiaRejilla.tsx` — columnas y `gap` por densidad. **El orden no se toca.**
- `…/TableroDiaEstados.tsx` — `Loader2` / `CalendarDays` / `TriangleAlert`; vacío con `EmptyState`;
  `+ TableroDiaSinCoincidencias` (`Search` + CTA).
- `…/TableroDiaTotales.tsx` — rótulo y `data-filtrado` (R64), «N de M» en `role="status"`, la barra
  y `GraficaLineas` en su propia `Card`.
- `…/TableroDiaModule.tsx` — `Lock` e `Info` en los dos `Alert`; estado de filtro y densidad;
  recálculo de totales con `sumarTotalesTablero`; `+ export` de los dos avisos (para F2.3).
- `…/DetalleMensajeroPanel.tsx` — `Sheet` → `Modal`, `Table` cruda → `DataTable`, avatar en la
  cabecera, `EmptyState` en el vacío.
- `app/(app)/monitoreo/page.tsx` — **sin cambios** (F7.2).

### Modificados — fuera de `app/(app)/monitoreo/`, y por qué

Los tres son consecuencia de F3.1 y ninguno es opcional: **sin ellos, `dev` queda rojo**. Los
encontró la corrida de guardias, no el ojo.

1. **`components/ui/table.tsx`** — anotado `/** @sin-superficie … */`.
   `DetalleMensajeroPanel.tsx` era **el único importador de esta primitiva en todo el repo**
   (comprobado con `git grep -l "components/ui/table" HEAD`). Al migrarlo a `DataTable`, la
   primitiva se queda huérfana y `tests/unit/guards/superficie-de-uso.guardia.test.ts` se pone
   rojo. Las tres salidas y por qué se eligió ésta:
   - borrarla → **prohibido por R20** («no eliminar archivos de `components/ui/`»);
   - hacer que `DataTable` se apoye en ella → toca una pieza que montan 30 listados, fuera de
     alcance;
   - anotarla → **es el remedio que la propia guardia prescribe** por escrito.
   El coste: hubo que convertir `function Table` en `export function Table` y sacarla del bloque
   `export { … }` del final, porque el lector de anotaciones sólo reconoce
   `export function|const|class`. **Los nombres exportados no cambian y ningún consumidor se
   entera.** Es deuda real y está dicha: ver §Abierto 2.
2. **`tests/unit/descarga/censo-tablas.ts`** — alta del detalle como tabla `fuera` de alcance, con
   su motivo escrito. No es una tabla nueva para el usuario: es la de la 192, ahora sobre la
   primitiva.
3. **`tests/unit/descarga/cobertura-tablas.guardia.test.ts`** — totales: 25→26 archivos, 25→26
   instancias, 5→6 exclusiones, 26→27 censadas. **Se subieron a los números exactos, no se
   aflojó ningún matcher.**

### Modificados — tests

- `tests/components/TableroDiaTarjetas.test.tsx` — se conservan TODAS las aserciones de la 192; se
  añade el bloque de F1.4. Único cambio en lo existente: `<TableroDiaTotales>` recibe ahora la prop
  obligatoria `ritmoEntregas` (ver §Deltas 3).
- `tests/components/DetalleMensajeroPanel.test.tsx` — ver §«Tests de la 192 que hubo que tocar».

---

## Verificación — salida real

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TC_EXIT=0
```

### `pnpm run lint`

```
✖ 97 problems (0 errors, 97 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

LINT_EXIT=0
```

**0 errores**, y **97 warnings es exactamente el número que reportó el bloque backend**: ninguno
de los archivos de este bloque aparece en la salida (`grep -icE "monitoreo|TableroDia|serie-ritmo|
filtrar-mensajeros|Composicion|DetalleMensajero|ui.table"` sobre el log → **0**).

Durante el trabajo hubo 99 (2 míos) y se corrigieron los dos, no se silenciaron:
- `react-hooks/exhaustive-deps` en `TableroDiaModule` (`tablero?.filas ?? []` fuera del `useMemo`
  creaba un array nuevo en cada render: la memoización no memoizaba nada). Se metió dentro.
- un import sin usar en `TableroDiaFiltro.test.tsx`.

### `pnpm exec vitest run tests/components tests/unit/tablero-dia`

```
 Test Files  230 passed (230)
      Tests  3084 passed | 26 skipped (3110)
   Duration  206.64s

VITEST_EXIT=0
```

### `pnpm exec vitest run guard tests/unit/components tests/unit/tablero-dia`

```
 Test Files  179 passed (179)
      Tests  2538 passed (2538)
   Duration  46.20s

VITEST_EXIT=0
```

### `pnpm exec vitest run` (suite completa, corrida al final y sin nada mutando el árbol)

```
 Test Files  1269 passed (1269)
      Tests  16790 passed | 26 skipped (16816)
   Duration  338.44s

VITEST_EXIT=0
```

El exit code se capturó **dentro** del log (`echo "VITEST_EXIT=$?" >> …`), no por un `echo`
posterior. Los 26 `skipped` son los de siempre en esta máquina. Esto **no sustituye a `./init.sh`
completo**: el gate corre además typecheck, lint y las guardias de árbol en su orden.

---

## Las mutaciones: qué pasó al matar cada test

Un test verde no prueba nada hasta que se le mata. Seis mutaciones, cada una revirtiendo el
archivo desde copia antes de la siguiente, y con `git status` limpio al final.

### La que pedía el encargo: el `[]` del adaptador de la serie (R59)

| # | Mutación en `serie-ritmo.ts` | Resultado |
| --- | --- | --- |
| **M1** | quitar el `if (!hayEntregas) return [];` (se sustituye por `void hayEntregas;` para que el typecheck no lo tape) | **ROJO, 3 tests** de `serie-ritmo.test.ts`: «devuelve `[]` cuando todos los acumulados valen 0, aunque los puntos existan», «y el marco lo lee como *no hay datos*» y «una lista vacía tampoco produce serie». El primero falla con `expected [ { id: 'entregas', …(2) } ] to deeply equal []` |
| **M2** | relajar la condición: `punto.acumulado > 0` → `>= 0` (la forma en que esto se rompe *de verdad*, no borrando la línea sino tocándola) | **ROJO, 2 tests**: los dos primeros de arriba |

Además, la mitad de componente lo cubre `TableroDiaRitmo.test.tsx` › «con todos los acumulados a
cero sale el `EmptyState` y NO la lista de puntos», que afirma sobre lo que el usuario ve
(`SerieTextual` ausente) y no sobre la función.

Tras M1 y M2 el archivo se restauró desde copia y los 11 tests volvieron a verde.

### Las otras cuatro

| # | Mutación | Resultado |
| --- | --- | --- |
| M3 | `COLOR_SEGMENTO.enReparto`: `bg-chart-13` → `bg-info` (deshacer el delta 1) | **ROJO**: `TableroDiaComposicion.test.tsx` › «en tema oscuro supera el 3:1» — `el segmento de «En reparto» (bg-info) da 2.34:1 sobre la pista en tema oscuro: se funde con ella` |
| M4 | quitar `data-filtrado` de `TableroDiaTotales` | **ROJO**: `TableroDiaFiltro.test.tsx` › «R64: con filtro cambian las TRES señales» |
| M5 | los ceros SÍ pintan segmento (`> 0` → `>= 0` en `ComposicionBarra`) | **ROJO**: `TableroDiaComposicion.test.tsx` › «un contador a 0 NO pinta segmento» |
| M6 | `variant={VARIANTE_CONTADOR[clave]}` → `variant="secondary"` fijo | **ROJO**: `TableroDiaTarjetas.test.tsx` › «la variante de cada contador es EXACTAMENTE la que dice el mapa, por CLAVE» |

Y **la guardia de F7.1 se cazó a sí misma dos veces antes de darla por buena**: sus casos
«la cláusula NO es vacía» salieron rojos con dos detectores mal escritos —el de
`…/analytics/lienzo/` exigía que la ruta llevara `analytics/`, y el de dominio en primitivas
llevaba un `\b` que impedía casar `TableroDiaRejilla`—. Los dos se corrigieron. Esa es la mitad
del valor de escribir los positivos.

---

## Los tests de la 192 que hubo que actualizar, y por qué

Sólo **dos** aserciones existentes cambiaron. Ninguna se aflojó.

1. **`DetalleMensajeroPanel.test.tsx` › «con el TECLADO: la tarjeta se alcanza con Tab».**
   Antes: `await usuario.tab(); expect(document.activeElement).toBe(tarjeta())` — es decir, la
   tarjeta era el **primer** punto de tabulación. Con la barra de controles (F4.2) delante van el
   campo de filtro y el conmutador de densidad, que es el orden correcto de lectura.
   Ahora: se tabula **hasta** la tarjeta con un tope de 10 y se afirma lo mismo que R47 pide —que
   la tarjeta **sea alcanzable** con el teclado—. Si dejara de ser focusable, el bucle terminaría
   sin foco en ella y el test caería igual. **No se cambió el `expect`, se cambió cómo se llega.**

2. **`TableroDiaTarjetas.test.tsx` › «Totales».** El render pasa de
   `<TableroDiaTotales totales={…} />` a `<TableroDiaTotales totales={…} ritmoEntregas={RITMO} />`.
   Es la **llamada**, no la aserción: las cinco aserciones de ese test están intactas.

Todo lo demás de los tres archivos de la 192 **pasa sin tocarse**, incluidos los anclajes que el
encargo mandaba conservar: `data-mensajero`, `data-contador`, `data-grupo`, los nueve `data-slot`,
el `role="button"` con el nombre del mensajero, el `role="status"` del esqueleto y el
`role="alert"` de los avisos. `TableroDiaModule.test.tsx` y `TableroDiaPage.test.tsx` **no se
tocaron en absoluto** (F7.2).

El `data-slot="detalle-mensajero-panel"` **cambió de sitio en el DOM** (del `SheetContent` a un
`div` dentro de `children` del `Modal`) y **el selector de los tests no cambió**, que es lo que
R62 pide. Se le añadió un caso propio que afirma que aparece al abrir y **desaparece** al cerrar.

---

## Deltas respecto del design, dichos y no escondidos

### 1. `enReparto` va en `bg-chart-13`, no en `bg-info` (F5.1 vs. design §11.6 + F7.3)

`design.md` §11.6 avisaba de esto y **dejó la salida escrita**: si `bg-info` se funde con la pista
en tema oscuro, se cambia por `bg-chart-13` (que gira), **nunca por un hex nuevo**. F7.3 mandaba
comprobarlo a ojo en el navegador.

No puedo levantar la app, así que se comprobó con **la aritmética del propio repo**
(`tests/fixtures/contraste.ts`, que está validada contra tres razones publicadas por WCAG y que
lee los tokens vigentes de `app/globals.css` con los comentarios fuera). Medido, contraste del
segmento contra la pista `--muted`:

| clase | claro | oscuro |
| --- | --- | --- |
| `bg-info` (`#1a56db`, FIJO) | 5.61 | **2.34** ← por debajo del 3:1 de WCAG 1.4.11 |
| `bg-chart-13` (`#1e3a8a` / `#93c5fd`, GIRA) | 9.41 | 8.03 |

Lo fija un test (`TableroDiaComposicion.test.tsx` › «se separa de la pista en los DOS temas») que
además afirma **que `bg-info` sí falla**, para que la comprobación no sea decorado. La mutación M3
lo confirma.

**Lo que este método NO cubre, y conviene no olvidarlo** (memoria del repo: «medir color en el
navegador: la herramienta miente» — aquí el riesgo es el simétrico): mide dos tokens, no la
pantalla compuesta. Aplicando el MISMO umbral a los otros siete segmentos salen dos números bajos
que **no** he cambiado:

| clase | claro | oscuro |
| --- | --- | --- |
| `bg-success` (`#10b981`) | **2.30** | 5.71 |
| `bg-warning` (`#f59e0b`) | **1.95** | 6.74 |
| `bg-danger` (`#ef4444`) | 3.42 | 3.85 |
| `bg-muted-foreground/40` (`otros`) | 1.89 | 2.22 |

No se tocan, y el motivo va escrito para que el humano pueda no estar de acuerdo:
- `success` y `warning` son colores **claros y saturados sobre una pista casi blanca**: la razón de
  contraste los castiga, pero el hue se distingue perfectamente. El modo de fallo que §11.6 nombra
  es el contrario —**oscuro sobre oscuro**, donde el segmento se lee como un agujero en la barra—,
  y ése sólo lo tenía `info`.
- `otros` es tenue **a propósito** (`DESIGN.md`: nada de saturación en lo que no arrancó); su dato
  vive en el `Badge` de debajo. Está afirmado como tal en el test, no ignorado.
- Y hay un atenuante estructural para los cuatro: la barra suma el 100 % de las `asignadas`, así
  que **la pista sólo se ve cuando no hay ningún segmento**. Lo que el ojo compara son segmentos
  entre sí.

**Si el humano prefiere el `bg-info` del design, se revierte cambiando una línea de
`COLOR_SEGMENTO` y el suelo del test.**

### 2. La línea va en su propia `Card`, hermana de la de totales

El design (§7) la ponía «dentro de `TableroDiaTotales`». Sigue montándose **desde ese archivo**
(F7.1 lo exige y lo comprueba), pero se pinta en una `Card` hermana, no dentro de la tarjeta de
totales. Motivo: con filtro activo esa tarjeta se titula «Totales de lo filtrado» (R64) y **la
línea sigue hablando del día entero** — no hay serie por mensajero. Meterla bajo ese encabezado
reabriría por la puerta de al lado exactamente la confusión que R64 cierra. `DESIGN.md` pide
tarjetas hermanas, nunca anidadas. El título del design (**«Entregas acumuladas»**) se conserva
literal. Lo afirma `TableroDiaRitmo.test.tsx` › «la monta en su PROPIA tarjeta».

### 3. `ritmoEntregas` es prop OBLIGATORIA de `TableroDiaTotales`

Podría haber sido opcional con default `[]` y ningún test existente se habría enterado — y la
pantalla se habría quedado sin línea sin que nada se pusiera rojo, que es el mismo razonamiento
por el que el backend hizo el campo del contrato obligatorio. Coste: una línea en el render de
`TableroDiaTarjetas.test.tsx`.

### 4. Una sola instancia de `DataTable` en el detalle

El design (§8) dibujaba dos ramas (`isLoading` y datos). Se monta **una** con `isLoading={cargando}`:
así el estado de carga y el de datos no pueden divergir en columnas, y el censo de tablas cuenta
una tabla y no dos. R36 se mantiene: con cero órdenes **y sin carga en curso** no se monta tabla
ninguna, y `document.querySelector("table")` sigue siendo `null` en los tres casos malos.

---

## Lo que queda abierto

1. **F7.3 — la revisión visual en los dos temas NO está hecha.** No puedo levantar la app ni
   entrar como `maestro`/`adminSatelite`. Lo que sí quedó cubierto por otra vía: el foco concreto
   que F7.3 nombraba (`bg-info` contra la pista en oscuro) está **medido y fijado por un test**
   (§Deltas 1). Lo que sigue **sin mirar** y sólo se ve con ojos: que ningún texto quede ilegible,
   que no asome una franja del tema contrario, que la curva gire de color, y que los ocho `Badge`
   quepan en la rejilla más estrecha en densidad compacta (`design.md` §11.3 avisa de que el
   `Badge` mide `h-5` fijo; la etiqueta y la cifra van **en línea** dentro del chip, que es la
   forma que ese riesgo pedía, pero no lo he visto renderizado).
2. **`components/ui/table.tsx` queda en disco sin nadie que la monte**, anotada `@sin-superficie`.
   Es deuda real y de una sola decisión: o se borra en un chore, o `DataTable` pasa a apoyarse en
   ella (que es lo que `DESIGN.md` insinúa al decir «Badge/EstatusBadge: sobre la primitiva
   Badge»). **Ninguna de las dos entra en esta ficha**: R20 prohíbe borrarla y `DataTable` la
   montan 30 listados.
3. **F7.4 — el gate completo lo corre el leader**, `./init.sh` completo (se tocó `lib/types/` en
   el bloque backend, así que `--rapido` se niega solo) y **secuencialmente**, sin ningún subagente
   mutando el árbol a la vez.
4. **No se tocó ninguna guardia de `recharts`** (R74): `tests/unit/components/analytics-paquete-guard.test.ts`
   no aparece en el diff. El lienzo sigue llegando por `lazy(() => import(…))` y ningún archivo del
   árbol escribe `from "recharts"` — lo censan las dos guardias.
5. **El filtro sigue sin ir a la URL** (R73) y **la barra apilada y el avatar entran**, como se
   decidió. Nada de eso quedó a medias.

---

# Segunda pasada — los dos defectos que la app enseñó y la suite no (2026-08-21)

El coordinador levantó la app con datos reales (26 órdenes, 17 gestiones, 2 mensajeros) y
condujo `/monitoreo` con Playwright en los dos temas. **La suite estaba verde y aun así había
dos defectos.** Los dos corregidos en la misma rama, sin commit.

## 1. El número de «Reprogramadas» no se leía en la tarjeta

**Lo medido:** viewport 1440, columna de la rejilla de 109 px. `Badge` es `overflow-hidden` +
`whitespace-nowrap` y aquí va a `w-full`. Sin decir quién absorbe la falta de sitio, los dos
hijos se salen y el navegador recorta por la derecha: el que desaparecía era **la cifra**.
`scrollWidth > clientWidth` sólo en `reprogramadas` —la etiqueta más larga—; en los totales no
pasaba porque la caja mide 364 px.

**Por qué ningún test lo vio:** el `1` seguía en el DOM. `toHaveTextContent("1")` pasaba con el
defecto puesto, y con él los 16.790 tests. Es la familia «no falla, aparenta», y esta vez la
metí yo.

**El arreglo, y por qué no depende del ancho del texto.** Se declara explícitamente quién cede:

| parte | clases | qué hace |
| --- | --- | --- |
| etiqueta | `min-w-0 truncate` | es la que cede, con puntos suspensivos. `min-w-0` es lo que le permite bajar de su ancho de contenido dentro de un flex; sin él `truncate` no llega a activarse nunca |
| cifra | `shrink-0` | no encoge, no se recorta, se lee siempre |

Truncar es **sólo visual**: la etiqueta sigue entera en el DOM, así que el nombre accesible del
contador no pierde nada (R45). Los cinco desenlaces ganan además un `title` con el texto
completo; **los tres cubos conservan su `ayudaBucket` exacta**, que es contrato de la 192.

Como la garantía es estructural y no depende de cuánto mida el texto, **vale para los ocho
contadores y para cualquier ancho de columna** — incluidas «Sin recoger» y «En reparto» cuando
la rejilla baja a 2 columnas. El test lo recorre sobre las ocho claves, en las dos densidades y
en los dos sitios (tarjeta y tira).

**El test.** `TableroDiaTarjetas.test.tsx` › «la cifra de un contador NO se recorta nunca».
No afirma sobre `textContent` —eso ya pasaba con el defecto— **ni mide la caja**: en jsdom no
hay layout y `scrollWidth`/`clientWidth` valen 0 para todo. Afirma el **reparto del espacio**
entre los dos hijos, que es exactamente lo que decide el resultado, y que son dos cajas
distintas (si compartieran nodo, el truncado se comería el número por el mismo sitio).

## 2. La gráfica se comía la pantalla, y más de la mitad estaba vacía

**Lo medido:** ritmo 371 px, totales 251, tarjeta 239. Y el eje arrancaba a las 12 a. m. con
ocho horas de línea plana en cero.

### 2a. Las horas planas del principio ya no se pintan

Recorte **en el adaptador** (`serie-ritmo.ts`), no en el backend: el servicio sigue publicando
`0..H` completo —es su contrato— y esta capa decide desde dónde se pinta.

Se conserva **un cero delante** de la primera entrega, y no es un detalle: sin él la curva
empezaría directamente en 3 y nadie podría ver que subió *desde* cero.

Los dos invariantes que el encargo mandaba no romper, y cómo se sostienen:

- **El cuadre con `entregadas` (R52):** se recorta SÓLO por delante. Hay un test que lo afirma
  sobre cuatro series distintas — «el recorte NO toca el último punto».
- **El vacío (R59):** el recorte se aplica **después** de decidir si hay entregas. Si se
  aplicara antes, un día sin ninguna daría una serie con cero puntos en vez de ninguna serie, y
  `GraficaLineas` vería `series.length > 0` con `puntos.length === 0`. Sigue devolviendo `[]`.
- Y no puede comerse un hueco intermedio: la serie es monótona no decreciente, así que después
  de la primera entrega no vuelve a haber ceros.

### 2b. El techo de altura

`proporcion="bajo"` no basta, y **no es un fallo suyo**: el paquete fija el alto por proporción
y no por píxeles (su R24 lo dice, y con razón: un `h-[300px]` se rompe dentro de una columna
flex). Con 32:9 el alto es el ancho / 3,56 — a ancho completo de la tarjeta eso son ~310 px de
lienzo, hagas lo que hagas.

`GraficaLineas` **sí admite acotarla por `className`**, así que se hizo ahí, con dos palancas y
ninguna que alcance dentro del DOM del paquete:

1. `className="mx-auto w-full max-w-2xl"` — techo de **ancho**, que es lo que le pone techo al
   alto. Con 672 px el lienzo mide 672 × 9/32 = **189 px**.
2. La línea pasa a ir **al lado** de la tira de totales en `xl` (`grid xl:grid-cols-2`), no
   debajo. Ahí la columna mide ~545 px, el techo ni siquiera muerde y el lienzo baja a ~153 px.

Geometría resultante (**aritmética sobre la proporción del paquete, no una medición de
navegador** — conviene que la vuelvas a medir):

| ancho disponible | lienzo | tarjeta del ritmo |
| --- | --- | --- |
| `xl`, columna ~545 px | ~153 px | ~185 px |
| apilada, tope 672 px | 189 px | ~221 px |
| móvil, ~350 px | ~98 px | ~130 px |

En todos los casos por debajo de una tarjeta de mensajero (239 px), y en `xl` la fila entera la
gobierna la tira de totales (251 px), así que la página pierde ~370 px de alto.

**Lo que se descartó, y por qué:** pisar el `aspect-[32/9]` del lienzo con una variante
arbitraria (`[&>div]:…`). Funcionaría hoy, pero alcanza dentro de la estructura del paquete: el
día que `GraficaLineas` la cambie, la clase deja de aplicarse **en silencio** y la gráfica
vuelve a comerse la pantalla sin que nada se ponga rojo. Hay un test que prohíbe esa forma en
este archivo. **Si hace falta una franja más baja a ancho completo, lo correcto es una
`proporcion` nueva en el paquete de analítica, que es otra ficha.**

## Las mutaciones de esta pasada

| # | Mutación | Resultado |
| --- | --- | --- |
| **M7** | quitar `shrink-0` de la cifra (volver a dejar que encoja: **el defecto exacto**) | **ROJO, 3 tests**: las dos densidades + la tira. `la cifra de entregadas puede encogerse: con la etiqueta larga se sale de la caja: expected [ 'font-semibold', 'tabular-nums' ] to include 'shrink-0'` |
| **M8** | quitar `min-w-0` de la etiqueta (`truncate` deja de activarse y vuelve a empujar) | **ROJO, 2 tests** |
| **M9** | deshacer el recorte de horas planas | **ROJO, 4 tests** entre el puro y el de componente, incluido «las horas planas del principio no llegan a la alternativa textual» |
| **M10** | colar el recorte también por la COLA (`slice(primera - 1, -1)`) | **ROJO, 6 tests**, con el mensaje que importa: `el recorte se comió el último punto: la línea ya no cuadra con el contador: expected +0 to be 5` |
| **M11** | quitar el techo de ancho de la gráfica | **ROJO**: `la gráfica no lleva techo de ancho: su alto vuelve a ser el de la tarjeta entera` |

Cada archivo se restauró desde copia antes de la siguiente y se verificó con `grep` que no
quedó ningún resto.

## Verificación de esta pasada — salida real

```
pnpm run typecheck   → TC_EXIT=0
pnpm run lint        → 97 problems (0 errors, 97 warnings) · LINT_EXIT=0
                       (los mismos 97 de siempre; 0 en archivos de esta feature)
pnpm exec vitest run → Test Files  1269 passed (1269)
                       Tests  16803 passed | 26 skipped (16829)
                       VITEST_EXIT=0
```

13 tests más que en la primera pasada (16.790 → 16.803): los que fijan estos dos arreglos.

## Un test existente actualizado, y por qué

`serie-ritmo.test.ts` › «basta UNA entrega en cualquier hora para que la curva exista» afirmaba
`toHaveLength(9)` sobre `[0,0,0,0,0,0,0,1,1]`. Con el recorte son **3** (la hora 6, que es el
cero desde el que sube, y las dos con dato). El 9 era incidental —lo que ese test mide es que la
serie EXISTE—, así que se actualizó a 3 y se le añadió la comprobación de los valores
(`[0, 1, 1]`), que dice más que la longitud. **Es un cambio de comportamiento deliberado, no una
aserción aflojada.**

## Lo que sigue abierto tras esta pasada

- **F7.3 sigue sin cerrar por mi parte**: las alturas de arriba son aritmética sobre la
  proporción del paquete, no una medición de navegador. **Conviene volver a medir** ritmo /
  totales / tarjeta con la app levantada, y de paso mirar que el chip truncado se lea bien
  (que la elipsis caiga donde debe y que el número quede pegado al borde derecho sin tocarlo).
- **El techo de ancho deja aire a los lados por debajo de `xl`** (gráfica de 672 px centrada en
  una tarjeta más ancha). Es el precio de no pisar el `aspect` del paquete. Si molesta, la
  salida limpia es la `proporcion` nueva en el paquete de analítica.
- Lo demás de la lista anterior sigue igual: `components/ui/table.tsx` anotada, y el gate
  completo (`./init.sh`) lo corre el leader.

---

# Tercera pasada — la etiqueta completa, los dos huecos de test y el mapa (2026-08-21)

Revisión APROBADA (78/78, cero bloqueantes) y gate verde. Quedaban cuatro cosas; las cuatro
cerradas. Misma rama, sin commit.

## 1. La etiqueta se lee ENTERA (pedido del humano)

La elipsis salvaba la cifra pero dejaba «Reprograma…». Requisito nuevo: **etiqueta entera Y
cifra, las dos legibles, a cualquier ancho**.

**Lo hecho:** vuelve la **anatomía de dos líneas** de la feature 192 —etiqueta arriba, cifra
debajo— pero **dentro del `Badge`**, que es lo que aporta el color semántico (R15). Puestas una
encima de otra dejan de disputarse el ancho: la etiqueta dispone de la caja entera.

| parte | clases | qué garantiza |
| --- | --- | --- |
| chip (cómoda) | `h-auto flex-col items-start justify-start gap-0 rounded-md px-2 py-1 whitespace-normal` | la caja puede crecer a dos líneas |
| etiqueta | `w-full leading-tight break-words` | **nunca se recorta**: si no cupiera a lo ancho, parte en dos líneas en vez de esconder letras |
| cifra | `shrink-0` | **no encoge nunca** — se conserva del arreglo anterior, que era correcto |

En densidad **compacta** el chip vuelve a ser de una línea a propósito: la etiqueta va `sr-only`
(sigue en el nombre accesible, R45) y sin etiqueta visible no hay nada que pueda empujar a la
cifra fuera.

**Lo que esto pisa del diseño, dicho y no escondido.** `design.md` §11.3 previó este choque y
dijo que, si no cabía, «la salida es la densidad, no un `className` que pise la altura de la
primitiva». **Aquí se pisa:** `h-auto` sobre el `h-5` del `Badge`. Es una decisión humana
posterior y explícita, tomada tras ver la pantalla con datos reales; la salida por densidad se
descartó porque obligaba a elegir entre leer la etiqueta y ver los ocho contadores a la vez.

### Medido en el navegador, no deducido

Playwright, sesión `admin` (`admin.qa@ordenex.test`), datos reales, **los dos temas**
(`body background` claro `rgb(247, 248, 252)` / oscuro `rgb(10, 21, 36)` — confirmado, no
supuesto: la primera corrida usó el nombre de cookie equivocado y midió claro dos veces; se
corrigió a `ordenex_tema` y se repitió).

Criterio: `scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1` sobre la etiqueta,
sobre la cifra y sobre el chip.

> ⚠️ El probe descarta el **falso positivo de `sr-only`**: un nodo `sr-only` mide 1×1 con
> overflow oculto, así que da «recortado» SIEMPRE y no significa nada — esa etiqueta está
> invisible a propósito. La primera lectura marcaba «8 de 8 recortados» en compacta por eso.
> Se filtra por `getComputedStyle(et).position === "absolute"`.

**Resultado: 0 recortes reales, de 8 contadores, en todas las combinaciones.**

| escenario | chip ancho | recortes reales |
| --- | --- | --- |
| tarjeta · cómoda · 1440 | 107 px | **0 / 8** |
| tira · cómoda · 1440 | 170 px | **0 / 8** |
| tarjeta · compacta · 1440 | 44–79 px | **0 / 8** |
| tira · compacta · 1440 | 99–170 px | **0 / 8** |
| tarjeta · 1280 / 1024 / 768 / 390 | 101 / 59 / 150 px | **0 / 8** en cada uno |

Y las dos filas que importaban: `"Reprogramadas1"` con `etiq=false cifra=false` en la tarjeta de
107 px —el caso exacto que fallaba— y `"Sin recoger2"` / `"En reparto2"` igual a 768 px, que era
el otro riesgo señalado. **Cero errores de consola** en los dos temas.

### Alturas remedidas (mismo navegador, misma sesión)

| viewport | gráfica (tarjeta del ritmo) | tira de totales | tarjeta de mensajero |
| --- | --- | --- | --- |
| 1440 | **209 px** (antes 371) | 319 | 322 |
| 1280 | 186 | 319 | 337 |
| 1024 | 249 | 319 | 322 |
| 768 | 182 | 319 | 382 |
| 390 | 147 | 367 | 355 |

La gráfica está por debajo de la tarjeta de un mensajero **en los cinco anchos**. Las tarjetas
crecen de 239 a 322 px: es el precio de las dos líneas, y estaba aceptado.

## 2. M-2 · `cerrarDetalle` conserva el resto de la URL — ahora con test

El código estaba bien; lo que faltaba era la aserción. Tres casos en
`DetalleMensajeroPanel.test.tsx`: cerrar con `?mensajero=m-1&zona=cartago&vista=compacta`
conserva `zona` y `vista`; abrir una tarjeta con `?zona=cartago` añade el suyo sin perderla; y
sin más parámetros la URL queda limpia, sin un `?` colgando.

## 3. M-1 · el avatar de la cabecera del detalle — ahora con test

R71 sólo estaba probado en la tarjeta. Dos casos nuevos: la cabecera del modal muestra las
iniciales (`aria-hidden`) con el nombre completo al lado; y si el id llegó por la URL sin
tarjeta detrás, **no se inventa un avatar** ni se hace eco del identificador (R13).

## 4. M-3 · el mapa `R → test` citaba dos cláusulas inexistentes

Corregido el **mapa**, no la guardia (que comprueba a propósito otra cosa y lo explica en su
código). Las dos filas dicen ahora la cláusula real **y por qué es esa**:

- **R20** → cláusula (h): «ninguna primitiva conoce el dominio del tablero del día» + «las
  primitivas que esta pantalla monta EXISTEN todas». No es un inventario congelado, y es
  deliberado: un `toEqual` de nombres convertiría la guardia en un peaje para cualquier ficha
  futura que estrene una primitiva legítima, y la salida barata sería borrarla.
- **R48** → cláusula (d): «el par `-soft`/`-strong` lo pone `Badge`, no el árbol» +
  `TableroDiaComposicion.test.tsx` › «En reparto» se separa de la pista en los DOS temas». **No**
  se censa «ningún token fijo del `@theme` en el árbol», y es deliberado: `bg-success` /
  `bg-warning` / `bg-danger` son fijos y son el rol correcto para una barra según `DESIGN.md`;
  prohibirlos de plano habría prohibido el diseño aprobado.

## Las mutaciones de esta pasada

| # | Mutación | Resultado |
| --- | --- | --- |
| **M12** | `cerrarDetalle` → `router.replace(pathname)` a secas (**la mutación exacta que pedía el encargo**) | **ROJO**: `cerrar el detalle se llevó por delante el resto de la URL: expected null to be 'cartago'` |
| **M13** | quitar el avatar de la cabecera del modal | **ROJO**: `la cabecera del detalle no monta el avatar de iniciales (R71): expected undefined to be defined` |
| **M14** | devolver la elipsis a la etiqueta (`truncate`, el arreglo que el humano rechazó) | **ROJO, 2 tests**: `la etiqueta de entregadas vuelve a truncarse: se lee a medias: expected [ 'min-w-0', 'truncate' ] to not include 'truncate'` |
| **M15** | quitar `h-auto` (el chip vuelve al alto fijo del `Badge` y la segunda línea se corta) | **ROJO**: `el chip conserva el alto fijo del Badge: la segunda línea se corta` |

Cada archivo restaurado desde copia antes de la siguiente, con `grep` de comprobación.

## F7.3 — la revisión visual, POR ESCRITO (ya no sólo en el chat)

**Hecha, y en dos tandas.** La primera la condujo el coordinador y encontró los dos defectos de
la segunda pasada. Ésta es la de verificación tras la corrección:

- **Cómo:** `pnpm dev` con la salida a un archivo, Playwright (`@playwright/test` resuelto con
  `createRequire`, sin crear archivos en el árbol del repo), Chromium headless.
- **Rol:** `admin` (`admin.qa@ordenex.test`). **`ROLES_ACCESO_TOTAL` son maestro y admin**, así
  que `admin` cubre el alcance global de esta pantalla. **`adminSatelite` NO se condujo**: pide
  OTP y su alcance por zona ya está cubierto por los tests de servicio e integración del bloque
  backend, no por la capa visual — queda dicho, no dado por hecho.
- **Datos:** los reales de la base local — 26 órdenes asignadas hoy, 17 gestiones, 2 mensajeros.
  La identidad de los ocho sumandos cuadra contra la base: 26 = 12+2+1+1+1 + 4+4+1.
- **Temas:** los dos, verificados por el `background` computado del `body`, no por la cookie que
  se envió.
- **Anchos:** 1440, 1280, 1024, 768 y 390.
- **Resultado:** gráfica **209 px** (antes 371) y **los ocho contadores sin recorte** en tarjeta
  y en tira, en las dos densidades y en los cinco anchos. Cero errores de consola.

> ⚠️ **Lo que esta revisión NO midió**, para que no se lea como más de lo que es: contraste
> percibido (eso vive en `TableroDiaComposicion.test.tsx`, medido sobre los tokens con la
> aritmética validada del repo, no con la herramienta del navegador — memoria del repo:
> «medir color en el navegador: la herramienta miente»); el modal en `adminSatelite`; y la
> lectura de la curva con más de dos mensajeros.

### ⚠️ Efecto colateral en la base LOCAL, dicho

Para entrar hizo falta una contraseña QA, que no se versiona. Se rotó la de los cuatro usuarios
QA de la base **local** con `QA_PASSWORD='MedirMonitoreo255!' pnpm exec tsx -r dotenv/config
scripts/seed-usuarios-qa.ts`. Afecta a `admin.qa`, `mensajero.qa`, `tienda.qa` y `satelite.qa`
**sólo en local**; no toca datos de negocio y el seed es idempotente. Si tenías otra contraseña
memorizada, ésta es la que hay ahora.

## Verificación de esta pasada — salida real

```
pnpm run typecheck   → TC_EXIT=0
pnpm run lint        → 97 problems (0 errors, 97 warnings) · LINT_EXIT=0
pnpm exec vitest run → Test Files  1269 passed (1269)
                       Tests  16810 passed | 26 skipped (16836)
                       VITEST_EXIT=0
```

## Estado de `tasks.md`

**No queda ninguna casilla sin marcar.** B6.1, F7.3 y F7.4 estaban en `[ ]` estando hechas y se
marcaron; F7.3 queda documentada arriba.

## Lo que sigue abierto

- **`components/ui/table.tsx`** sigue en disco sin nadie que la monte, anotada `@sin-superficie`
  con su motivo. Es deuda de una sola decisión —borrarla en un chore, o hacer que `DataTable` se
  apoye en ella— y **ninguna de las dos entra en esta ficha** (R20 prohíbe borrarla).
- **La tarjeta de mensajero pasa de 239 a 322 px** con la anatomía de dos líneas. Es el precio
  aceptado; si con quince mensajeros resulta demasiado alto, la salida ya existe y no cuesta
  código: el conmutador de **densidad compacta**, que baja el chip a 18 px.
- **El techo de ancho de la gráfica deja aire a los lados por debajo de `xl`.** Si molesta, la
  salida limpia es una `proporcion` nueva en el paquete de analítica, que es otra ficha.

---

# Cuarta pasada — la etiqueta no se parte dentro de la palabra (2026-08-21)

Confirmaste 0 recortes de 8 y las alturas. Pero la captura enseñaba `Reprogramad / as`:
`break-words` evitaba el recorte **rompiendo la palabra**, y eso no es la etiqueta completa.

**Y el test no lo cazaba, con razón**: una palabra partida **no desborda** —cabe, rompiéndose—
así que `scrollWidth > clientWidth` daba `false`. Era un defecto que pasaba la comprobación que
existía. Familia conocida.

## Lo hecho

Se le quitó a la etiqueta **todo** lo que le permitía deformarse: sin `truncate` (escondería
letras) y **sin `break-words`** (partiría la palabra). Con `overflow-wrap` en su valor por
defecto el navegador sólo puede cortar **entre palabras**: «Sin recoger» puede bajar de línea,
«Reprogramadas» no se parte jamás.

Eso deja el problema donde de verdad estaba: **la caja tiene que ser bastante ancha**. Y eso
**no se puede fiar al viewport** — la misma pantalla de 768 px da una tarjeta de 189 px, donde
sólo cabe UNA columna, y una tira de ~700 px, donde caben tres. Por eso las columnas pasan a
decidirse con **umbrales de contenedor** (`@container` + `@[...]`), contra el ancho real de la
caja:

| rejilla | palabra más larga (medida) | umbrales |
| --- | --- | --- |
| los cinco desenlaces | «Reprogramadas» = **99,6 px** | `grid-cols-1 @[16rem]:grid-cols-2 @[26rem]:grid-cols-3` |
| los tres cubos | «recoger» = **47 px** | `grid-cols-1 @[9rem]:grid-cols-2 @[13rem]:grid-cols-3` |

Los umbrales salen de la medición, no de una estimación de anchura de glifos.

**No se sacrificó nada de lo ganado:** la cifra conserva `shrink-0`, el chip conserva `h-auto`
y las dos líneas, y la etiqueta sigue entera en el DOM y en el `title`.

### El fallo intermedio que la medición cazó, y que yo no había previsto

Con la primera corrección los **cinco desenlaces** quedaron limpios, pero la medición marcó
**2 roturas de 8 a 768 px**: eran `sinRecoger` y `enReparto`, que yo había dejado en un
`grid-cols-3` fijo. Con la tarjeta a 189 px eso da cajas de 43 px y «recoger» pide 47. Se les
aplicó el mismo tratamiento con sus propios umbrales. **Lo encontró la medición, no el
razonamiento**: yo había dado por buenos los cubos porque sus etiquetas «son cortas».

## Remedición — 24 combinaciones, 0 defectos

Playwright, sesión `admin`, datos reales, **los dos temas** (`body background` claro
`rgb(247, 248, 252)` / oscuro `rgb(10, 21, 36)`), viewports 1440 / 1280 / 1024 / 768 / 390,
tarjeta y tira, densidades cómoda y compacta.

Dos criterios a la vez, no uno:

- **recorte** — `scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1`, descartando
  el falso positivo de `sr-only` (mide 1×1 con overflow oculto: da «recortado» siempre);
- **rotura dentro de palabra** — se clona la palabra más larga de la etiqueta en un `span`
  `white-space: nowrap; width: max-content` con la MISMA fuente computada, y se compara su
  ancho real con el `clientWidth` de la caja. Si la palabra pide más de lo que hay, se parte.

```
=================== TOTAL de recortes + roturas en TODAS las combinaciones: 0
```

Muestra del peor caso de cada sitio (`caja` = ancho útil de la etiqueta; `lineas` = líneas que
ocupa):

```
=== TARJETA 1440 · comoda ===
  reprogramadas  chip= 164x 41 caja= 148 palabra="Reprogramadas"= 99.6 lineas=1 recorte=false ROTURA=false
  sinRecoger     chip= 107x 41 caja=  91 palabra="recoger"=   47   lineas=1 recorte=false ROTURA=false

=== TARJETA 768 · comoda ===   (la tarjeta más estrecha: 189 px de contenido)
  reprogramadas  chip= 192x 41 caja= 176 palabra="Reprogramadas"= 99.6 lineas=1 recorte=false ROTURA=false
  sinRecoger     chip=  92x 41 caja=  76 palabra="recoger"=   47   lineas=1 recorte=false ROTURA=false
```

Las ocho etiquetas caben en **una sola línea** en todos los anchos medidos — mejor que el
requisito, que sólo pedía que el salto cayera entre palabras. **Cero errores de consola** en los
dos temas.

### Alturas tras el cambio

| viewport | gráfica | tira de totales | tarjeta de mensajero |
| --- | --- | --- | --- |
| 1440 | 209 px | 319 | 355 |
| 1280 | 186 | 319 | 355 |
| 1024 | 249 | 319 | 355 |
| 768 | 182 | 319 | **501** |
| 390 | 147 | 367 | 355 |

La gráfica sigue por debajo de la tarjeta en los cinco anchos. La tarjeta pasa de 322 a 355 px
(y a 501 px en 768, donde los cinco desenlaces caen a una columna): **ése es el precio de no
partir nunca una palabra en una tarjeta de 189 px de ancho**, y está dicho abajo como deuda
abierta con su salida.

## La comprobación que faltaba, y sus mutaciones

El test de recorte no podía ver esto, así que se añadió lo que sí lo ve en jsdom —las clases que
gobiernan la rotura, y los umbrales que garantizan la caja—:

- la etiqueta **no** lleva `break-words` ni `break-all` (ni `truncate`);
- la raíz lleva `@container` —sin él los umbrales `@[...]` no se resuelven contra nada— y las
  dos rejillas llevan sus clases de columnas por contenedor.

| # | Mutación | Resultado |
| --- | --- | --- |
| **M16** | devolver `break-words` a la etiqueta (**el defecto exacto**) | **ROJO, 2 tests**: `la etiqueta de entregadas puede partirse dentro de una palabra: expected [ 'w-full', 'leading-tight', …(1) ] to not include 'break-words'` |
| **M17** | cambiar los umbrales de contenedor por breakpoints de viewport (`grid-cols-2 sm:grid-cols-3`) | **ROJO**: «las columnas se deciden por el ANCHO REAL de la caja, no por el viewport» |
| **M18** | quitar el `@container` de la raíz | **ROJO**: `sin un contenedor de consulta, los umbrales @[...] no se resuelven contra nada: expected [ 'flex', 'flex-col', 'gap-3' ] to include '@container'` |

Cada archivo restaurado desde copia antes de la siguiente, con `grep` de comprobación.

> **Nota de método, porque volvió a morder:** el heredoc se come una capa de escapado. Un
> `split(/\s+/)` escrito así llegó al archivo como `split(/s+/)` y una de las aserciones nuevas
> se puso roja con un mensaje que culpaba al código y no al parser. Se reparó escribiendo el
> backslash con `String.fromCharCode(92)` y se verificó el archivo con `grep` antes de darlo por
> bueno. (Memoria del repo: «todo lo inline pierde una capa».)

## Verificación de esta pasada — salida real

```
pnpm run typecheck   → TC_EXIT=0
pnpm run lint        → 97 problems (0 errors, 97 warnings) · LINT_EXIT=0
pnpm exec vitest run → Test Files  1269 passed (1269)
                       Tests  16811 passed | 26 skipped (16837)
                       VITEST_EXIT=0
```

## Lo que sigue abierto

- **La tarjeta a 768 px mide 501 px**, porque ahí los cinco desenlaces caen a una sola columna.
  Es el coste de la garantía, y la salida ya existe sin escribir código: el conmutador de
  **densidad compacta**, que devuelve el chip a 18 px de alto. Si con quince mensajeros resulta
  incómodo, la decisión de producto es si la densidad compacta debería ser la inicial en
  pantallas estrechas — eso es una ficha aparte, no un arreglo de ésta.
- **`components/ui/table.tsx`** sigue en disco sin nadie que la monte, anotada `@sin-superficie`.
- **El techo de ancho de la gráfica deja aire a los lados por debajo de `xl`.** La salida limpia
  es una `proporcion` nueva en el paquete de analítica, que es otra ficha.

---

# Quinta pasada — la cabecera de la tarjeta desbordaba en una banda (2026-08-21)

Las etiquetas quedaron cerradas (tu verificación: 72 comprobaciones, 0 defectos). Lo que
apareció es otra cosa, **en la cabecera**, y con una lección de método: **mis tres mediciones
anteriores estaban verdes porque las tres medían los CONTADORES**. Medir la pieza que arreglas
no basta; hay que medir la caja que la contiene.

## 1. El nodo que desborda, localizado midiendo

Recorrí el subárbol entero de la tarjeta reportando cada nodo con `scrollWidth > clientWidth`.
No es lo que yo habría supuesto:

```
---- viewport 820 · 2 col · tarjeta cw=252 sw=259  <-- DESBORDA
     cabecera {"cw":252,"sw":259,"desborda":true}
     titulo   {"cw":175,"sw":175,"desborda":false}
     accion   {"cw":64,"sw":64,"desborda":false}
     [t0] div[card] > div[card-header]
            cw=252 sw=259 exceso=7 overflowX=visible minW=auto
```

Dos datos que lo explican todo:

- el `scrollWidth` de la cabecera está **clavado en 259 px** por mucho que encoja la tarjeta
  (242, 252, 226 → siempre 259): es un **suelo**, no un desbordamiento progresivo;
- el título **no** desborda: se queda en **175 px** y se niega a bajar.

**La causa.** `CardHeader` es una rejilla `grid-cols-[1fr_auto]`, y `1fr` es
`minmax(auto, 1fr)`: su mínimo es el **min-content del item**. El item es `CardTitle`, un flex
con el avatar (`shrink-0`, 28 px) y el nombre en `nowrap` (por su propio `truncate`). Ese
min-content valía 28 + 8 + 139 = **175 px**, y `CardTitle` no llevaba `min-w-0`, así que la
columna no podía bajar de ahí. Con 175 + 64 de la acción + huecos + 32 de padding salen los
259 px que la caja de 226 no puede contener.

El avatar es de esta ficha (R71), así que **el estrechón es nuestro**: tu lectura era correcta.

## 2. El arreglo

Una clase, en `MensajeroCard.tsx` (no en la primitiva):

- **`min-w-0` en `CardTitle`** → desaparece el mínimo automático, la columna encoge y el
  `truncate` que el nombre ya tenía por fin se activa. **Quien cede es el NOMBRE**, con puntos
  suspensivos — es un nombre propio y ahí la elipsis es aceptable, como dijiste.
- **`shrink-0` en el bloque de `asignadas`**, para que la intención quede escrita y testeable:
  la cifra titular no cede nunca, igual que las ocho de los contadores.

El nombre sigue completo en el DOM y en el `aria-label` del control.

**No hizo falta tocar `TableroDiaRejilla`**, así que no hay decisión que consultarte sobre
cuándo la rejilla pasa a 2 columnas: el arreglo aguanta **toda** la banda y todo lo que hay por
encima y por debajo (ver la matriz). Cambiar el breakpoint habría tocado la 192 para arreglar
un síntoma; esto arregla la causa.

## 3. La matriz ampliada, y lo que encontró de más

Ahora mide **tres** criterios y no uno:

- **(a) la caja contenedora** — `caja`, `cabecera`, `titulo`, `accion` y `contenido`, en cada
  tarjeta **y en la tira**;
- **(b) el recorte de cada contador** (etiqueta y cifra);
- **(c) la rotura dentro de palabra** de cada etiqueta.

Anchos: **1440, 1280, 1024, 900, 860, 830, 820, 800, 768, 740, 700, 640, 500, 390** (añadidos
900 y 820, y de paso 860/830/800/740/500 para cercar la banda por los dos lados). Dos temas ×
dos densidades.

```
=========== 2352 comprobaciones · PROBLEMAS: 0
```

Cero errores de consola en los dos temas.

### La matriz NO está verde por vacío: se comprobó mutando en el navegador

Quité el `min-w-0` y volví a correrla entera. Reporta el defecto donde tú lo viste **y en un
sitio más que ninguno de los dos había listado**:

```
   1280 px · 4 col ·  ... <-- 2 PROBLEMAS      (densidad COMPACTA: las tarjetas caen a 4 columnas)
    830 px · 2 col ·  ... <-- 2 PROBLEMAS
    820 px · 2 col ·  ... <-- 2 PROBLEMAS
          tarjeta0.caja     DESBORDA cw=252 sw=259 texto="MMMarco Mensajero13AsignadasRe"
          tarjeta0.cabecera DESBORDA cw=252 sw=259 texto="MMMarco Mensajero13Asignadas"
    800 px · 2 col ·  ... <-- 2 PROBLEMAS
    768 px · 2 col ·  ... <-- 4 PROBLEMAS      (las DOS tarjetas)
```

Ese **1280 en compacta** es el hallazgo: en densidad compacta la rejilla va a cuatro columnas,
las tarjetas quedan igual de estrechas y el mismo defecto aparecía en una pantalla grande. Con
el arreglo, 0. Restaurado y verificado con `grep`.

## 4. Test y mutaciones

En jsdom no hay layout, así que se fija el **mecanismo**, como con `shrink-0` en los contadores:

| # | Mutación | Resultado |
| --- | --- | --- |
| **M19** | quitar `min-w-0` de `CardTitle` (**el defecto exacto**) | **ROJO**: «el título puede encogerse: sin `min-w-0` la columna se niega a bajar de su min-content» |
| **M20** | quitar `shrink-0` del bloque de asignadas | **ROJO**: `la cifra titular puede encogerse: con la tarjeta estrecha se recorta a «1» sobre «13»: expected [ 'flex', 'flex-col', 'items-end' ] to include 'shrink-0'` |
| **M21** | quitar el `truncate` del nombre | **ROJO**: «quien cede es el NOMBRE, con puntos suspensivos» |

Cuatro casos nuevos, incluido que el avatar es `shrink-0` (es la mitad del estrechón) y que el
nombre sigue completo en el DOM y en el `aria-label`.

## Verificación de esta pasada — salida real

```
pnpm run typecheck   → TC_EXIT=0
pnpm run lint        → 97 problems (0 errors, 97 warnings) · LINT_EXIT=0
pnpm exec vitest run → Test Files  1269 passed (1269)
                       Tests  16815 passed | 26 skipped (16841)
                       VITEST_EXIT=0
```

## Lo aprendido, para que no se repita

**Tres mediciones seguidas dieron verde sobre una pantalla que tenía un número recortado.** No
porque el criterio fuera malo —`scrollWidth > clientWidth` es el correcto— sino por **dónde se
aplicaba**: siempre sobre la pieza recién tocada. La matriz mide ahora de fuera hacia dentro
(caja → cabecera → pieza), que es el orden en el que un usuario se encuentra los defectos.

## Lo que sigue abierto

- **La tarjeta a 768 px mide ~501 px de alto** (los cinco desenlaces caen a una columna). Es el
  coste de no partir nunca una palabra en una tarjeta estrecha; la salida ya existe sin código:
  la densidad compacta. Si con quince mensajeros incomoda, «¿compacta por defecto en pantallas
  estrechas?» es ficha aparte.
- **`components/ui/table.tsx`** sigue en disco sin nadie que la monte, anotada `@sin-superficie`.
- **El techo de ancho de la gráfica deja aire a los lados por debajo de `xl`.** La salida limpia
  es una `proporcion` nueva en el paquete de analítica, que es otra ficha.
