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
