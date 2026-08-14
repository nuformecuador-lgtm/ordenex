# Feature 224 — Al imprimir, los tokens tampoco giran · bitácora de implementación

Rama `feature/224-tokens-al-imprimir`, worktree aislado `C:/w224`, sobre `dev` (`d0385556`).
Ficha **sin SDD** (`sdd: false`, `low`, `frontend`, `depends_on: [221]`): no hay spec, la ficha
ES el encargo.

Toda medición de contraste sale de `tests/fixtures/contraste.ts` — `contraste()`, `componer()`,
`token()` y `paleta()`, la aritmética que la 210 validó contra razones publicadas de WCAG y que
la 217 sacó a fixture. **No se escribió una segunda copia de la fórmula** y **no se usó
`.claude/skills/impeccable/scripts/detector/`** (hay guardia que censa las dos cosas por nombre).

---

## 1 · El cambio, en una línea

`app/globals.css:650-691` — un tercer bloque `@media print` que redeclara los **35 tokens
claros** para `.dark`, `body:has(> .dark)`, `.tema-sistema` y `body:has(> .tema-sistema)`, con
`html` delante de cada selector. Vive **pegado encima de `.dark`** (`:709`).

```css
@media print {
  html .dark,
  html body:has(> .dark),
  html .tema-sistema,
  html body:has(> .tema-sistema) {
    --background: #f7f8fc;
    --foreground: #12233f;
    … 33 más …
  }
}
```

No se tocó ningún componente, ni la paleta, ni el bloque de la 217, ni el de la 223. Nada fuera
de `app/globals.css` en `app/`.

---

## 2 · LA CONTRADICCIÓN, Y CÓMO SE RESOLVIÓ

El encargo la enuncia y es real:

- Las guardias exigen que **todo** `@media print` viva **ANTES** de `.dark`
  (`impresion-flujo.guardia.test.ts`, `tema-encendido.guardia.test.ts`). No es capricho: es la
  **segunda** de las dos defensas del lector de tokens. Si un bloque de impresión cae detrás de
  `.dark`, sus hexes claros son los últimos de la mitad «oscuro» del archivo y
  `token("oscuro", …)` empieza a devolverlos — **toda la verificación de tema oscuro mediría el
  tema claro, en verde**.
- Y ahí, un `@media print { .dark { … } }` **no hace nada**: un `@media` no suma especificidad,
  así que empata (0-1-0 contra 0-1-0) y pierde por orden.

**La ficha lo dice al revés** («un `@media print` detrás de `.dark` no hace nada»). El código
dice lo contrario y es lo que se midió.

### La salida: ganar por ESPECIFICIDAD, no por orden

`html` delante añade un selector de tipo. Sube `.dark` de 0-1-0 a 0-1-1 y
`body:has(> .dark)` de 0-1-1 a 0-1-2. Gana esté donde esté, sin `!important`.

**Ninguna guardia se relajó.** Una se REEXPRESÓ (§5) y no por esta razón, sino porque su forma
—contar bloques— caducó al añadir el tercero.

### Medido en un navegador de verdad, no razonado

Dos mediciones independientes, las dos en Chromium **149.0.7827.55** con
`emulateMedia({ media: "print" })` y `getComputedStyle`:

**(a) Repro mínimo de la cascada** — el mismo orden de declaraciones que `globals.css`, cuatro
formas de escribir el bloque:

| variante | selector del bloque print | tinta AL IMPRIMIR | tinta EN PANTALLA |
| --- | --- | --- | --- |
| V0 | `.dark` (0-1-0), antes de `.dark` | `#e6ecf8` **← PIERDE** | `#e6ecf8` |
| V1 | `html .dark` (0-1-1), antes | **`#12233f`** ← gana | `#e6ecf8` |
| V2 | `.dark` + `!important`, antes | `#12233f` | `#e6ecf8` |
| V3 | `.dark.dark` (0-2-0), antes | `#12233f` | `#e6ecf8` |
| V4 | `.dark`, al final del archivo | `#12233f` | `#e6ecf8` |

Las cuatro últimas ganan y **ninguna toca la pantalla**. Se elige V1: `!important` en 35
declaraciones rompe cualquier excepción legítima futura, y la clase duplicada no se puede leer.
V4 gana pero es la que envenena el lector de tokens: descartada por eso, no por la cascada.

**(b) La hoja REAL** — se compiló `app/globals.css` con el `tailwindcss` instalado (**4.3.2**,
API `compile()`), se montó el DOM del portal (`<body> > div.contents.dark`, que es lo que estampa
`providers/TemaProvider.tsx`) y se leyó `getComputedStyle` sobre `Badge` success/warning/danger/
info, un texto `text-foreground`, una hoja `.papel-al-imprimir` y el `<body>`:

| sonda | tema | medio | ANTES (dev) | DESPUÉS |
| --- | --- | --- | --- | --- |
| `Badge` success, tinta | oscuro | print | `rgb(52,211,153)` `#34d399` | **`rgb(4,120,87)` `#047857`** |
| `Badge` warning, tinta | oscuro | print | `#fbbf24` | **`#92400e`** |
| `Badge` danger, tinta | oscuro | print | `#f87171` | **`#b91c1c`** |
| `Badge` info, tinta | oscuro | print | `#93b4f7` | **`#1d4ed8`** |
| texto `text-foreground` | oscuro | print | `rgb(230,236,248)` `#e6ecf8` | **`rgb(18,35,63)` `#12233f`** |
| `<body>` fondo | oscuro | print | `rgb(10,21,36)` | **`rgb(247,248,252)`** |
| todo lo anterior | oscuro | **screen** | sin cambios | **sin cambios** |
| `.papel-al-imprimir` | oscuro | print | `#12233f` | `#12233f` (la 217, intacta) |

Y la comprobación cruzada que cierra la ficha: **imprimir desde `.dark` y desde `.tema-claro`
dan hoy la MISMA tabla, celda a celda**. Eso es «el papel es el tema claro», ejecutado y no
afirmado.

**Límite de la medición, por delante:** sólo Chromium. En este entorno no hay Firefox ni WebKit
instalados. Lo que se apoya en el motor es el desempate por especificidad, que es de CSS
Selectors 4 §17 y no del navegador; y la guardia lo recalcula por su cuenta (§4).

---

## 3 · LOS NÚMEROS: antes y después

### 3a · Papel por defecto (SIN «gráficos de fondo», que viene DESMARCADO)

Es el camino real: los navegadores no imprimen superficies salvo que el usuario lo marque. Ahí
lo único que decide la legibilidad es **la tinta**. Sobre papel blanco `#ffffff`:

| par | antes | después |
| --- | --- | --- |
| texto `--foreground` (el **1,19** que nombra la ficha) | 1.19 | **15.70** |
| `Badge` success (`--success-strong`) | 1.92 | **5.48** |
| `Badge` warning | 1.67 | **7.09** |
| `Badge` danger | 2.77 | **6.47** |
| `Badge` info | 2.08 | **6.70** |
| texto secundario (`--muted-foreground`) | 2.26 | **7.70** |

El **1,92** que la ficha nombra —`token("oscuro","success-strong")` contra `#ffffff`— pasa a
**5,48**, que es el mismo número que el CSS ya tenía anotado para el tema claro (`vs card 5.48`).

### 3b · El PRECIO de la 221, borrado (CON «gráficos de fondo» marcado)

Con la 221 sola, los cuatro `Badge` imprimían su fondo `-soft` **claro** bajo una tinta que
seguía siendo la **oscura**. Ahora las dos mitades del par son claras:

| `Badge` | con la 221 sola | con la 224 |
| --- | --- | --- |
| success | 1.70 | **4.84** |
| warning | 1.50 | **6.37** |
| danger | 2.26 | **5.30** |
| info | 1.91 | **6.16** |

Los cuatro por encima de AA. Y son, a la centésima, los pares que el propio CSS anota para el
tema claro (`vs success-soft 4.84`, `vs warning-soft 6.37`, `vs danger-soft 5.30`,
`vs info-soft 6.16`): otra comprobación cruzada de que el papel es exactamente el tema claro.

### 3c · LO QUE **NO** COMPRA, medido y declarado

El papel hereda los límites que el tema claro ya tiene en pantalla:

| token | antes (papel) | después (papel) | mismo valor en «claro», pantalla |
| --- | --- | --- | --- |
| `--destructive` | 2.77 | 3.76 | 3.76 |
| `--primary` | 2.60 | 3.18 | 3.18 |

Mejoran pero **no llegan a 4.5**. No es una regresión de esta ficha —son acentos, no texto de
lectura, y miden lo mismo hoy en «claro»— pero tampoco los arregla: es deuda de PALETA
(fichas 210/216). Queda como caso ejecutable en la guardia, no como nota.

---

## 4 · LA GUARDIA ESPEJO

`tests/unit/guards/impresion-tokens.guardia.test.ts` (nueva, **37 casos**).

Qué mira, y por qué así:

1. **Autocomprobación del calculador de especificidad** (16 casos). Sin ella, un
   `especificidadDe` que devolviera siempre `[0,0,0]` dejaría verde EL caso de la ficha. Se
   comprueban simples, compuestos, `:where()` (cero), `:is()/:not()/:has()` (máximo de sus
   argumentos), `*`, tipos y pseudo-elementos. Y el desempate: **un empate NO es ganar**, que es
   literalmente el bug de esta ficha.
2. **Autocomprobación del censo**: lee el CÓDIGO y no la prosa (`Feature 224` en el crudo y NO
   en lo censado — el comentario del bloque nombra a propósito `html .dark` y `@media print`).
3. **EL caso**: para cada uno de los cuatro caminos, el gemelo de impresión tiene que **ganarle
   en especificidad** a la regla que declara los tokens oscuros.
4. **Y no por orden**: el bloque está antes de las **dos** declaraciones de la tinta oscura. Se
   ancla en `--foreground: #e6ecf8`, no en un selector: un ancla que nombra un selector caduca
   en cuanto alguien lo escribe distinto (lección de la 221 y la 223, pagada dos veces).
5. **Espejo exacto**: claves == las de `.dark`; valores == los de `:root, .tema-claro`, hex a
   hex. Un token nuevo en `.dark` sin gemelo aquí sale en papel oscuro.
6. **Estructura**: dentro de `@media print`, fuera de todo `@layer`, sin `print-color-adjust`.
7. **Los números** de §3, atados al comentario del CSS: si alguien mueve la tabla y no la prosa
   (o al revés), rojo.

### El instrumento nuevo: `tokenAlImprimir()` (`tests/fixtures/contraste.ts`)

`token()` lee de `cssDePantalla`, que es el archivo **con las at-rules de impresión borradas**.
Eso es correcto y deliberado, pero deja un agujero que ya había mordido: la guardia de la 221
afirmaba «al imprimir, la tinta sigue siendo `#34d399`» midiendo `token("oscuro", …)`, una
aserción **ciega al papel** que habría seguido verde diciendo lo contrario el día que llegara
esta ficha. `tokenAlImprimir()` lee el otro lado —el bloque `@media print` de la 224— y lanza si
hay cero o más de una regla así, en vez de devolver la primera. Vive en el fixture y no en una
guardia porque **dos** guardias lo consumen.

---

## 5 · LAS GUARDIAS TOCADAS: reexpresadas, ninguna relajada

### `impresion-flujo.guardia.test.ts` — «exactamente dos bloques» → INVENTARIO

Exigía `toEqual(["@media print","@media print"])`. Con el tercer bloque se ponía roja. **Subir
el 2 a 3 habría sido relajar sin ganar nada**: lo que el caso protege no es el número, es que
ningún bloque de impresión quede **sin dueño** y que ninguno caiga detrás de `.dark`.

Pasa a ser un **inventario por CONTENIDO** —217 (`.papel-al-imprimir`), 223 (`.hoja-imprimible`),
224 (`.dark`)— con tres exigencias: el recuento y el prelude exacto de cada bloque; que cada
entrada del inventario case con **exactamente uno**; y que no haya **huérfanos**. Es
estrictamente más fuerte: antes un cuarto bloque se legalizaba alargando un `toEqual`; ahora hay
que darle nombre, y el rojo dice cuál es.

La marca de la 224 es `.dark` **a secas** y no su selector entero, a propósito: `html` es una de
las formas de ganar la cascada y hay otras que también valen. Con el selector completo escrito,
cambiar de una a otra ponía el censo rojo por no encontrar el bloque — un rojo que no señala
ningún defecto. **Se descubrió plantando la variante inocua I2, que salió roja la primera vez.**

### `impresion-sin-dark.guardia.test.ts` — dos casos que habrían mentido en verde

- **«LÍMITE: el papel NO cambia (1.92)»**. Medía `token("oscuro","success-strong")` contra
  blanco, y esa medida da 1.92 **pase lo que pase dentro de `@media print`**. Habría seguido
  verde afirmando lo contrario de lo que pasa. Ahora mide **las dos cosas con el lector que las
  ve**: `token()` para la pantalla (sigue 1.92) y `tokenAlImprimir()` para el papel (5.48), y
  exige que el CSS anote «1.92 → 5.48».
- **«PRECIO declarado» (6.60 → 1.70 …)**. Ese precio ya no se cobra. Se reexpresa a **«el PRECIO
  que esta regla cobraba lo BORRÓ la 224»**, con las dos columnas: la caída que había
  (`[1.70, 1.50, 2.26, 1.91]`) y el par de hoy (`[4.84, 6.37, 5.30, 6.16]`), cada uno ≥ 4.5, y
  la prosa del CSS atada al dato. Conservar la columna «antes» no es nostalgia: si mañana alguien
  retira el bloque de la 224, la de «después» se hunde hasta ella y esto se pone rojo con el
  número exacto.

### La prosa del CSS que esta ficha vuelve falsa (reescrita, no borrada)

- `:34-58` (221) — «el papel NO cambia … sigue midiendo 1.92» y el párrafo del precio. Reescritos
  para decir qué hacía **esta** regla y **quién levantó su límite**, con «1.92 → 5.48».
- `:265-271` (217) — «El resto del portal imprime hoy como imprimía ayer». Ya no.
- `:306-313` (217) — «las quince rutas … imprimen como antes de las dos». De las dos reglas sigue
  siéndolo; del papel, no.
- `:443-446` (223) — «GRÁFICOS DE FONDO … tiene un precio ya medido». **Tuvo**.

### Lo que NO hizo falta tocar, y por qué

`tema-encendido.guardia.test.ts:37-41` (`reglaCon`, «una sola regla por selector») **sigue verde
sin cambios**. Los selectores del bloque nuevo son `html .dark`, no `.dark`, así que
`selectores.includes(".dark")` sigue encontrando exactamente una regla. No es un truco para
esquivarla: es consecuencia de la forma que la cascada obligó a elegir, y se comprobó al revés —
con la mutación M1 (quitar el `html`), esa guardia **también se pone roja**, con el mensaje «no
hay ninguna regla para `.dark`: expected 2 to be 1».

---

## 6 · LAS MUTACIONES

Árbol commiteado antes de cada una. El mutador **ABORTA si el texto no cambia**, imprime el
`git diff --stat` real, corre `vitest run guard` **entero** (no un subconjunto), guarda la salida
completa en un log y revierte comprobando byte a byte que el árbol volvió. Este repo ya tuvo un
arnés que reportó 9/9 supervivientes sin haber ejecutado un test.

### Las letales — las siete muerden

| # | mutación | diff | resultado |
| --- | --- | --- | --- |
| **M1** | quitar el `html ` de los CUATRO selectores | `4 ins / 4 del` | **ROJA** — 2 archivos, 5 casos |
| **M2** | quitar el `html ` de UNO solo (la rama del `<body>`) | `1 ins / 1 del` | **ROJA** — 1 caso |
| **M3** | borrar el bloque entero | `42 del` | **ROJA** — 3 archivos, 22 casos |
| **M4** | mover el bloque al FINAL (detrás de `.dark`) | `43 ins / 42 del` | **ROJA** — 2 archivos, 3 casos |
| **M5** | un hex deja de ser el del tema claro (`--foreground: #000000`) | `1 ins / 1 del` | **ROJA** — 3 casos |
| **M6** | quitar un token del bloque (`--success-strong`) | `1 del` | **ROJA** — 2 archivos, 6 casos |
| **M7** | `.dark` estrena un token y el bloque no lo espeja | `1 ins` | **ROJA** — 2 archivos, 2 casos |

Mensaje real de **M1**, que es EL caso de la ficha:

```
AssertionError: `.dark` (0-1-0) NO le gana a `.dark` (0-1-0). Un `@media` NO suma
especificidad: con un empate manda el ORDEN, y este bloque vive ANTES a propósito, así que
perdería. Estaría escrito, compilaría, se leería perfecto… y el papel seguiría saliendo con
la tinta del tema oscuro. Medido en Chromium: con `.dark` a secas la tinta impresa es
`#e6ecf8`; con `html .dark`, `#12233f`.
```

Y **M2**, que muerde con el nombre del camino concreto:

```
AssertionError: `body:has(> .dark)` (0-1-1) NO le gana a `body:has(> .dark)` (0-1-1).
```

### M1 no es una mutación inerte, y se demostró en el navegador

Una mutación que pone una guardia roja podría estar poniéndola roja por una tontería. Se plantó
M1 y se volvió a **compilar y medir la hoja real** en Chromium:

| sonda | tema | medio | con M1 plantada |
| --- | --- | --- | --- |
| `Badge` success, tinta | oscuro | print | `rgb(52,211,153)` = `#34d399` (el OSCURO) |
| texto `text-foreground` | oscuro | print | `rgb(230,236,248)` = `#e6ecf8` (1,19:1) |
| `<body>` fondo | oscuro | print | `rgb(10,21,36)` (el oscuro) |

Es decir: **exactamente el estado anterior a la ficha**. El bloque está escrito entero, compila,
y no hace absolutamente nada. La guardia roja señala un defecto real e invisible.

### Las inocuas — las tres sobreviven

| # | variante | diff | resultado |
| --- | --- | --- | --- |
| **I1** | reordenar dos declaraciones del bloque (mismo juego, mismos valores) | `1 ins / 1 del` | **VERDE** ✓ |
| **I2** | otra forma correcta de ganar: `:root ` en vez de `html ` | `4 ins / 4 del` | **VERDE** ✓ |
| **I3** | mover el bloque entre el de la 217 y el de la 223 (sigue antes de `.dark`) | `43 ins / 42 del` | **VERDE** ✓ |

**I2 salió ROJA la primera vez**, y ése es el hallazgo de esta ronda: el inventario de
`impresion-flujo` identificaba el bloque por `"html .dark"`, así que rechazaba una
implementación igual de correcta. Se corrigió la marca a `.dark` y se volvieron a correr M1 y M3
para confirmar que la corrección no aflojó nada (siguen rojas). Sin la variante inocua, esa
rigidez se habría descubierto el día que alguien tocara el selector, con un rojo que no señala
ningún defecto.

---

## 7 · EL GATE

`./init.sh --rapido`, con el árbol en su estado final:

```
✓ node v24.13.0 · ✓ dependencias presentes
✓ regla max-2-por-zona respetada
✓ typecheck paso
✓ lint paso            (65 warnings preexistentes, 0 en lo tocado — comprobado archivo a archivo)
  test:cambiados   Test Files   5 passed (5)     ·  Tests    172 passed (172)
  test:guardias    Test Files 100 passed (100)   ·  Tests   1509 passed (1509)
✓ test:rapido paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==   (EXIT=0)
```

El `!` del `.env` es del worktree recién creado, no del cambio: `.env` está gitignored y vive en
el árbol principal. Para poder correr el gate hizo falta `pnpm install` y `prisma generate` en
`C:/w224` (el cliente Prisma se generó con un `DATABASE_URL` de marcador pasado por entorno, sin
escribir ningún archivo: `prisma generate` sólo necesita que la variable resuelva).

El gate completo (`./init.sh` sin flags) lo corre el leader antes del PR.

---

## 8 · LO QUE QUEDA ABIERTO

1. **`.papel-al-imprimir` (feature 217) es hoy REDUNDANTE en la práctica, y no se tocó.** Con
   este bloque dentro, el subárbol de la hoja ya recibe los tokens claros por herencia del
   envoltorio, así que la regla de la 217 fija los mismos valores dos veces. **No es un
   duplicado inútil**: sigue siendo la única defensa si algún día un subárbol fija tokens
   oscuros por otra vía (un `.dark` anidado, un componente con sus propios tokens), y retirarla
   toca dos guardias y el `.tsx` de la hoja. Es decisión de otra ficha; queda dicho para que no
   se descubra como sorpresa. `impl_221.md §6` ya lo anticipaba con estas palabras: «su propia
   decisión sobre si `.papel-al-imprimir` sigue teniendo sentido después».
2. **Sólo Chromium.** No hay Firefox ni WebKit instalados en este entorno, así que las dos
   mediciones de navegador son de un solo motor. El desempate por especificidad es de la
   especificación, no del motor, y la guardia lo recalcula por su cuenta; aun así, «medido en
   los tres» no se puede afirmar y no se afirma.
3. **`--destructive` (3.76) y `--primary` (3.18) siguen bajo AA sobre papel blanco.** Miden lo
   mismo en el tema claro en pantalla, así que no es regresión: es deuda de PALETA, fichas
   210/216. Queda como caso ejecutable, no como nota.
4. **Nadie imprime en el gate.** Ninguna pieza del arnés saca papel: lo verificado es la
   estructura del CSS, la aritmética de los pares y —fuera del gate, a mano y fechado— la
   cascada en un navegador. Los cortes de página, la escala y el diálogo de impresión siguen
   siendo del usuario (límites que la 223 ya declaró).
5. **La ficha 224 enuncia la contradicción al revés** («un `@media print` detrás de `.dark` no
   hace nada»). Lo cierto es lo contrario: detrás gana, y lo que lo prohíbe es el lector de
   tokens, no la cascada. Queda anotado por si alguien vuelve al `feature_list.json` — el
   bookkeeping no se tocó, es del leader.

---
---

# RONDA DE REVISIÓN — 1 bloqueante y 5 menores

El reviewer dio el MECANISMO por bueno y lo verificó por su cuenta. Lo que falló fue la
**exhaustividad del barrido de §5**: quedó una tercera guardia con la misma ceguera al papel, y
un límite medido sin declarar. Lo que sigue es lo que se cambió, con sus números recalculados.

**Todos los números de esta sección se REMIDIERON con la aritmética canónica; ninguno se copió
del informe del reviewer.** El instrumento se controló antes de usarlo: negro/blanco = **21.00**,
blanco/blanco = **1.00**, y la razón es simétrica (`contraste(a,b) === contraste(b,a)` = 21.00).
Sin ese control, un medidor roto rellena la tabla entera con números plausibles.

---

## R1 · BLOQUEANTE B1 — la TERCERA guardia ciega al papel

**Dónde estaba:** `impresion-sin-dark.guardia.test.ts`, fila **F4**, dentro de la lista
`TINTA_FIJA` («la tinta es de PALETA FIJA»).

Dos defectos encajados, y por eso sobrevivió a la ronda anterior:

1. **Clasificación falsa.** `RankingPodio` 3.º es `text-asfalto-7 dark:text-foreground`
   (`RankingPodio.tsx:54`). La rama base ES paleta fija; la rama `dark:` es un **TOKEN**. La
   fila no pertenecía a esa familia, y precisamente por eso la 224 la mueve.
2. **Medida con el lector ciego.** Su `tintaAntes` era `token("oscuro","foreground")`, que lee el
   CSS con los `@media print` ya borrados. Da 1.19 pase lo que pase dentro de `@media print`.

Y el cierre del círculo: el caso exigía `crudo.toContain("1.19 → 11.39")`, así que **la frase
falsa del CSS no se podía corregir sin poner la guardia roja**. Una afirmación falsa atornillada
por un test verde.

### Recalculado (aritmética canónica, control 21.00 verificado)

| F4 «antes» | hex | vs papel blanco |
| --- | --- | --- |
| lo que medía la guardia — `token("oscuro","foreground")` | `#e6ecf8` | **1.19** |
| lo que de verdad sale hoy — `tokenAlImprimir("foreground")` | `#12233f` | **15.70** |
| «después» — `paleta("asfalto-7")` | `#1f3a63` | **11.39** |

Confirmado además en el navegador, sobre la hoja real compilada (Chromium 149,
`emulateMedia({media:"print"})`): la sonda `text-asfalto-7 dark:text-foreground` computa
`rgb(31,58,99)` = `#1f3a63` al imprimir desde `.dark` — el variant está apagado, gana la rama
base. Y en `screen` sigue computando `rgb(230,236,248)`, o sea que la pantalla no se toca.

### QUÉ SE AFIRMA AHORA en esa fila

> **Con la 224 dentro, la 221 no mejora F4 en papel: la BAJA, 15.70 → 11.39.**
> Si el variant `dark:` siguiera disparando imprimiría `--foreground` ya CLARO (15.70); como no
> dispara, imprime `asfalto-7` (11.39).
>
> **No es un defecto de legibilidad**: las dos pasan AAA (≥7.0) con margen y el texto se lee
> igual de bien. Lo que deja de ser cierto es la FRASE «esta regla mejora el papel», para esta
> fila y sólo para ésta.
>
> **Y no se revierte la 221 por ella**: apagar el variant al imprimir es una decisión de toda la
> app, medida en cuatro familias, y ésta es la única que pierde — 4.31 puntos sobre un suelo de
> 11.39. Revertirla cambiaría el papel de las quince rutas para no ganar nada legible.

### Dónde vive ahora

- `impresion-sin-dark.guardia.test.ts` — F4 sale de `TINTA_FIJA` y pasa a una **FAMILIA 3**
  propia, con las tres medidas y el `toContain("15.70 → 11.39")`. Y la cabecera de `TINTA_FIJA`
  dice ahora, con su motivo, que exige paleta fija **por las dos ramas**.
- `app/globals.css:45-56` — el bullet se parte en dos: el de paleta fija pierde a `RankingPodio`,
  y hay un bullet nuevo «Y HAY UNA FILA MIXTA, EN LA QUE ESTA REGLA NO COMPRA: LA BAJA».

---

## R2 · m1 — el límite MEDIDO que no se había declarado, y es el que más cae

Recalculado, imprimiendo desde tema oscuro, sobre papel blanco:

| token | antes | después | mismo par imprimiendo desde «claro» |
| --- | --- | --- | --- |
| `--primary-foreground` (`Badge`/`Button` default, `Pagination`, 15 usos) | 18.33 | **1.00** | 1.00 |
| `--sidebar-primary-foreground` | 18.21 | **1.00** | 1.00 |
| `--border` | 12.30 | **1.23** | 1.23 |
| `--input` (**no estaba en el informe; salió al barrer los 16 tokens**) | 10.29 | **1.23** | 1.23 |
| `--sidebar-foreground` | 2.26 | 2.03 | 2.03 |
| `--sidebar-border` | 12.30 | 11.39 | 11.39 |

Confirmado en el navegador: la sonda `bg-primary text-primary-foreground` computa al imprimir
desde `.dark` una tinta `rgb(255,255,255)` — y el fondo naranja que la sostiene es justo lo que
la impresora **no** pone. Blanco sobre blanco.

**Por qué se declara en vez de arreglarse aquí, y por qué el caso mide DOS columnas:** la última
columna es idéntica a la de «después». Es decir, **no es una regresión contra el tema claro: es
el tema claro**. Lo legible que era en oscuro lo era por ACCIDENTE (una tinta clara pensada para
un fondo de color, sobre un papel que no lo lleva). Darle un valor propio en el bloque rompería
el espejo exacto —lo que la ficha compra y lo que su guardia exige— y dejaría el papel de
«oscuro» mejor que el de «claro», que es incoherente. El arreglo de raíz es el patrón de la 208
llevado al papel y toca `Badge`/`Button`/`Pagination`: **ficha propia**.

Queda con **caso ejecutable** (`impresion-tokens.guardia.test.ts`, cuatro filas `P1`-`P4`, cada
una con su columna «claro») y declarado junto al bloque (`globals.css:645-664`), con el mismo
estándar que ya se le aplicaba a `--destructive`/`--primary`.

---

## R3 · Los menores

| # | qué | cerrado |
| --- | --- | --- |
| **m2** | `.find(...)!` reventaba con `TypeError` antes de imprimir el diagnóstico | **sí** — `expect(gemelo).toBeDefined()` con su mensaje; comprobado con `Rm2`, que ahora falla con `AssertionError: el bloque de impresión no tiene gemelo para \`body:has(> .dark)\`` |
| **m3** | el «gana» se comparaba contra una lista escrita a mano | **sí** — se ancla en `reglasOscurasDePantalla`, localizadas por lo que DECLARAN (`--foreground: #e6ecf8`). La lista a mano se queda, pero sólo como INVENTARIO de caminos, en un caso propio |
| **m4** | `tokenAlImprimir` reparseaba el CSS en cada llamada | **sí** — memoización **perezosa** (ver abajo) |
| **m5** | la prosa citaba `tema-sistema-espeja-dark.guardia.test.ts`, inexistente | **sí** — corregida, y con censo nuevo |

**m4, y por qué perezosa y no a nivel de módulo:** el archivo calcula `cssDePantalla` y `TEMAS`
eagerly, pero esos no lanzan por un defecto de UNA regla. `tokenAlImprimir` sí lanza si el bloque
de impresión no está, y a nivel de módulo esa excepción caería en el `import` de **todos** los
consumidores del fixture —incluidos `contraste-tokens` y `factura-contraste`, que no miden papel—
convirtiendo un defecto de la regla de impresión en un rojo de guardias que no hablan de ella.
Perezoso, el fallo llega a quien lo provoca y con su mensaje. Se aprovechó para relajar el patrón
del selector de `(html\s+)?\.dark` a `\.dark`: era la misma rigidez que la variante inocua I2
destapó en el inventario la ronda anterior, viva también aquí.

**m5, y la guardia que lo impide de raíz:** la cita se corrigió a `tema-encendido.guardia.test.ts`
(el caso «sistema toma EXACTAMENTE los mismos tokens que oscuro»). Y como **ninguna guardia
censaba las citas dentro del CSS** —por eso pudo caducar— se añadió una:
`tema-encendido.guardia.test.ts`, caso «cada ruta de `tests/` que cita la prosa de `globals.css`
existe en el disco», con su autocomprobación (exige encontrar más de 3 citas, para que un regex
roto no reporte cero rotas en verde).

---

## R4 · LAS MUTACIONES DE ESTA RONDA

Mismo arnés: ABORTA si el texto no cambia, `git diff --stat` real, `vitest run guard` **entero**,
log completo a disco, y revertido comprobado byte a byte.

### Las letales — las nueve muerden

| # | mutación | archivo | resultado |
| --- | --- | --- | --- |
| **RB1a** | borrar del CSS el bullet de la fila MIXTA | `globals.css` | **ROJA** — `toContain("15.70 → 11.39")` |
| **RB1b** | volver a medir el «antes» de F4 con el lector CIEGO | la guardia | **ROJA** — `expected 1.19 to be 15.7` |
| **Rm1a** | borrar del CSS «18.33 → 1.00» | `globals.css` | **ROJA** |
| **Rm1b** | «arreglar» `--primary-foreground` con un valor propio | `globals.css` | **ROJA** — 2 casos: el espejo y `P1` |
| **Rm2** | quitar un selector del bloque | `globals.css` | **ROJA** con `AssertionError` (antes: `TypeError`) |
| **Rm3b** | re-oscurecer el papel con una regla NUEVA que le gana al bloque | `globals.css` | **ROJA** — 4 casos, incluido el cálculo propio |
| **Rm5a** | volver a citar una guardia que no existe | `globals.css` | **ROJA** |
| **X1 / X2 / X4** | re-corridas de M1, M2 y M4 de la ronda anterior | `globals.css` | **ROJAS** — el reanclaje de m3 no aflojó nada |

La de **Rm3b** es la que cierra m3, y su mensaje sale del cálculo de esta guardia, no de rebote:

```
AssertionError: `html .dark` (0-1-1) NO le gana a `html .dark` (0-1-1). Un `@media` NO suma
especificidad: con un empate manda el ORDEN, y este bloque vive ANTES a propósito, así que
perdería. […]
```

### Las inocuas — las cinco sobreviven

| # | variante | resultado |
| --- | --- | --- |
| **RB1i** | reformular la frase del bullet de F4 conservando sus números | **VERDE** ✓ |
| **Rm1i** | reformular el porqué de m1 sin tocar ningún número | **VERDE** ✓ |
| **Rm3i** | reordenar los dos selectores de la regla de pantalla (misma semántica) | **VERDE** ✓ |
| **Rm5i** | citar otra ruta de `tests/` que sí existe | **VERDE** ✓ |
| **XI2** | re-corrida de I2 (`:root ` en vez de `html `) | **VERDE** ✓ |

### La mutación que NO muerde donde debería, y va dicha

**Rm3 — subir la especificidad de la regla de PANTALLA en su sitio** (`\n.dark,` → `\nhtml .dark,`).
Sale **ROJA**, pero **de rebote y no por el cálculo de esta guardia**: `partirPorTema`
(`tests/fixtures/contraste.ts`) exige un `.dark` a principio de línea y lanza, así que **cuatro
archivos de guardia mueren en el `import`** —incluido el de la 224— antes de que nada mida nada.
La salida real: `Tests 5 failed | 1389 passed (1394)`, con 1.516 → 1.394 tests porque cuatro
ficheros ni se cargan.

No se «arregla»: el mensaje de `partirPorTema` es explícito («el parser de esta guardia caducó y
hay que revisarlo a mano») y nadie mergea eso. Pero **no es el rojo que uno querría**, y la razón
está declarada aquí y en el comentario del caso. Lo que sí se consiguió es que la misma intención
—devolver el papel a oscuro por el lado de la pantalla— tenga un camino que esta guardia caza
directamente y con su mensaje: **Rm3b**. Hacer que el caso *in situ* también lo cazara exigiría
que `impresion-tokens` dejara de depender de `contraste.ts`, y eso mueve un fixture compartido
por seis guardias para ganar un mensaje mejor en un escenario que ya falla ruidosamente: no
compensa, y se deja declarado en vez de forzarlo.

---

## R5 · EL GATE, tras la revisión

```
✓ typecheck paso · ✓ lint paso (65 warnings preexistentes, 0 en lo tocado)
  test:cambiados   Test Files   6 passed (6)     ·  Tests    195 passed (195)
  test:guardias    Test Files 100 passed (100)   ·  Tests   1516 passed (1516)
== init OK ==   (EXIT=0)
```

1.509 → **1.516** casos de guardia (+7: la FAMILIA 3 de F4, el inventario de caminos, las cuatro
filas de lo que se pierde, su declaración en prosa y el censo de citas).

---

## R6 · LO QUE SE AÑADE A «LO QUE QUEDA ABIERTO»

6. **`--primary-foreground` y `--sidebar-primary-foreground` se pierden en papel (1.00).** Tinta
   que se apoya en un fondo que el navegador no imprime — el patrón de la 208 llevado al papel.
   No se arregla en este bloque sin romper el espejo con el tema claro; el arreglo toca `Badge`,
   `Button` y `Pagination`. **Ficha propia recomendada**, `frontend`, y afecta también a quien
   imprime desde tema claro (o sea: no lo introdujo esta ficha, lo hizo visible).
7. **`--border` 12.30 → 1.23 y `--input` 10.29 → 1.23**: los bordes casi desaparecen del papel.
   Mismo caso, misma ficha, menor gravedad (son líneas, no texto).
8. **La mutación Rm3 no la caza esta guardia con su propio mensaje** (ver R4). Declarado, con la
   razón y con el coste de cerrarlo.
