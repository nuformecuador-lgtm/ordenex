# Feature 223 — El flujo de impresión de la factura del cierre · bitácora de implementación

Rama `feature/223-flujo-impresion-factura`, desde `dev` (con la 217, la 221 y la 222 dentro).
Spec: `specs/223-flujo-impresion-factura/{requirements,design,tasks}.md`, puerta humana pasada
el 2026-08-14.

> **Qué significa el verde de esta feature.** «La regla dice lo que decidimos que dijera», no «la
> factura sale bien en papel» (R33). Ninguna pieza del gate imprime. Lo que **no** queda
> verificado está listado abajo, no omitido.

---

## ⚠️ LO PRIMERO, PORQUE CAMBIA UNA LÍNEA DEL DISEÑO

**El CSS literal de `design.md §3.4`, rama A.1 (segundo selector), OCULTA EL PROPIO DIÁLOGO.**
Escrito tal cual, el resultado impreso no es «la hoja recortada»: es **una página en blanco** —el
fallo que `design.md §9.1` declara como el más caro de esta ficha—.

**Por qué.** `E:has(A B)` significa «E tiene un descendiente que casa con `:scope A B`»: **`A`
tiene que ser descendiente de `E`**. El popup del modal ES el `[role="dialog"]`, no lo *contiene*,
así que `popup:has([role="dialog"] .hoja-imprimible)` es **falso** y el popup cae dentro de
`*:not(:has([role="dialog"] .hoja-imprimible))`.

**Medido**, no razonado (jsdom 29.1.1 resuelve `:has()`; ver más abajo). Sobre el DOM real que
monta `CierresAdminModule` con el detalle abierto y una compacta desplegada detrás:

| Selector de ocultamiento | Elementos que engancha |
| --- | --- |
| A.1 tal como lo escribe `design.md §3.4` | `app`, `backdrop`, `titulo`, `botones`, `pago`, **`popup`** ← la hoja elegida vive dentro |
| A.1 con el predicado corregido | `app`, `backdrop`, `titulo`, `botones`, `pago` |

**Qué se cambió, y es una línea:** el segundo selector de A.1 pasa de

```css
> *:not(:has([role="dialog"] .hoja-imprimible))
```

a

```css
> *:not(:has([role="dialog"] .hoja-imprimible)):not(:has(.hoja-imprimible))
```

**Por qué esto NO es cambiar una decisión.** (a) Implementa la prosa que el propio diseño escribe
sobre A.1 —«fuera del diálogo: se poda todo lo que no lleva al diálogo»—, que el selector literal
contradecía; (b) A.2 y A.3 **ya llevan** un segundo `:not()` con esa misma función, A.1 era la
única sin él: es un desliz de transcripción, no una postura; (c) R6, sus dos niveles, la lista
blanca, el `:not()` con selectores simples y «CSS puro, sin JavaScript» quedan **intactos**.

**No se borró la versión del spec:** vive como **variante inocua de la mutación 3-bis**, para que
la regresión no pueda volver en silencio.

---

## Tanda 0 — El instrumento, los anclajes y la medición pendiente

### T1 · `tests/fixtures/css-reglas.ts` (nuevo) — R32, R30

`reglasDe`, `selectoresDe`, `declaracionesDe` y el tipo `Regla`, **copiados sin tocar una línea de
su lógica** desde `tema-encendido.guardia.test.ts:34-95`. Añadidos dos ayudantes:

- `reglasDeArchivo(ruta)` — lee con `codigoSinComentarios` (R30).
- `atReglaQueContiene(css, /regex/)` — **el localizador por CONTENIDO** que necesitan T5 y R24.
  Devuelve la at-rule abierta más interna que envuelve a la primera regla que case. Vive en el
  fixture y no en una guardia porque **dos** guardias lo consumen; con una copia en cada una,
  arreglarlo en una lo dejaría vivo en la otra.

`pnpm run typecheck` verde. El fixture no importa nada de `app/` y no ejecuta nada al importarse.

### T2 · `tema-encendido.guardia.test.ts` consume el fixture — R32

`vitest run tema-encendido.guardia.test.ts` → **16 passed**, cero renombrados, cero aserciones
cambiadas. El diff quita 62 líneas de definiciones y añade un `import`.

### T3 · Censo de segundas copias del parser — R32

Vive como **aserción de guardia** (`impresion-flujo.guardia.test.ts`), no como comprobación
manual de una vez: `feature 223 — el instrumento: un solo parser de reglas CSS (R32)`, tres casos
(autocomprobación del censo · cero copias · la guardia del tema importa el fixture).

**El censo encontró un infractor que nadie sabía que estaba ahí:**
`tests/unit/components/analytics-paleta.test.ts` (feature 130) tenía **su propio `selectoresDe`**,
su propio recorrido de llaves y **su propio quitador de comentarios a mano**
(`css.replace(/\/\*[\s\S]*?\*\//g, "")`) — exactamente lo que la 209 cerró. Pasa a consumir
`reglasDeArchivo`. **Ninguna de sus aserciones cambia**: sigue exigiendo que cada `--chart-N`
esté en `:root` y en `.dark`. Verde tras el cambio.

### T4 · MEDICIÓN del scroll lock — R10, R13 · **la única incógnita técnica del diseño**

`design.md §4.4` la dejó escrita: «si `@base-ui/react` bloquea el scroll con estilos en línea, el
`overflow: visible` de la cadena **pierde** y la hoja vuelve a salir recortada — un fallo que el
censo del CSS **no vería**, porque la declaración estaría escrita».

**Medido el 2026-08-14 en jsdom, con el `Modal` real abierto. Salida literal:**

```
document.body.style          = "position: relative; height: calc(100dvh - 768px);
                                width: calc(100vw - 1024px); box-sizing: border-box;
                                overflow: hidden; scroll-behavior: unset;"
document.documentElement.style = "scrollbar-gutter: stable; overflow-y: hidden;
                                overflow-x: hidden; scroll-behavior: unset;"
<html> lleva además el atributo `data-base-ui-scroll-locked`
```

**Sí lo hace, y no sólo con `overflow`.** El `<body>` —que es el primer elemento de la cadena que
la regla (B) neutraliza— recibe **cuatro** propiedades en línea que colisionan con la lista cerrada
de R10: `overflow`, `position`, `height` y `width`.

**Consecuencia para R13 — la lista de `!important` no es de uno, es de CINCO:**

| Declaración | Contra qué estilo en línea compite | Ancla |
| --- | --- | --- |
| `max-width: none` | `style={{ maxWidth: "75%" }}` del popup | `Modal.tsx:253-256` (H7) |
| `overflow: visible` | `overflow: hidden` del scroll lock | medido, T4 |
| `position: static` | `position: relative` del scroll lock | medido, T4 |
| `height: auto` | `height: calc(100dvh - …)` del scroll lock | medido, T4 |
| `width: auto` | `width: calc(100vw - …)` del scroll lock | medido, T4 |

Es la regla de R13 aplicada al hecho medido —`!important` **exclusivamente** donde compite un
estilo en línea, y con su motivo escrito—, no una ampliación de criterio: las otras nueve
declaraciones de (B) no tienen rival en línea y **no lo llevan**.

**Límite declarado:** el `<html>` también queda bloqueado (`overflow-y/x: hidden` en línea) y la
regla (B) **no lo alcanza**, porque R10 acota su alcance a «todo contenedor situado **entre
`<body>`** y la hoja». Queda medido y congelado por el caso, y escrito junto al bloque en
`app/globals.css`. Si en un motor real eso recortara, es una línea (`html:has(.hoja-imprimible)`)
y una decisión que no es mía.

Caso: `CierreFacturaPapel.test.tsx` › «con el diálogo abierto, el `<body>` recibe
overflow/position/height/width EN LÍNEA».

> Nota de método: la primera versión de este caso leía el `style` **síncronamente tras el
> `render`** y medía una lista **vacía** — es decir, pasaba afirmando «no hay estilos en línea»,
> justo lo contrario de lo que mide. El bloqueo lo escribe un efecto. Se corrigió con un
> `await findByRole("dialog")` y quedó anotado en el propio caso.

### T5 · Los anclajes dejan de ser POSICIONALES — R24, C3

Los tres casos que localizaban el bloque de la 217 como «el primer `@media print`» pasan a
localizarlo **por su contenido**: la at-rule que envuelve a la regla que declara los tokens de
`.papel-al-imprimir`.

- `tema-encendido.guardia.test.ts` — `APERTURA_MEDIA_PRINT` (posicional) se sustituye por
  `bloqueDeLa217()`, consumido por los casos «junto a la regla … queda escrito su límite (R15)» y
  «el bloque de impresión va ANTES de `.dark`».
- `impresion-sin-dark.guardia.test.ts:184` — su `precisa` pasa a salir de `atReglaQueContiene`.
  El caso conserva su punto (las dos at-rules viejas enganchan lo que no es) y lo mide contra el
  bloque localizado de verdad.

### T6 · `break-inside-avoid` en la versión instalada — R19

Compilado contra el compilador real, no leído de la documentación:

```
tailwindcss 4.3.2
break-inside-avoid -> .break-inside-avoid { break-inside: avoid; }
break-before-page  -> .break-before-page  { break-before: page; }
```

No hace falta la alternativa de `design.md §7-G`.

### T11 · Dónde monta el `Dialog.Portal` — R4, R6 *(adelantada: la necesitaba T5/T7)*

`design.md` (H4) la dejó como comprobación de una línea. **Medido: el contenedor NO es
`document.body`**, es un `<div data-base-ui-portal>` colgado del `<body>`:

```
popup.parentElement            → DIV[id, data-base-ui-portal]
popup.parentElement.parentElement → BODY
popup role="dialog" aria-modal="true"   ← R9 se sostiene
```

Por eso `tasks.md` T11 mandaba **releer A.1/A.2 antes de T14**. Se releyeron, y de esa relectura
salió el defecto de A.1 que abre esta bitácora. La fila que faltaba en la enumeración de R4 —el
contenedor del portal— queda escrita junto al bloque.

---

## Tanda 1 — El CSS

### T7-T9 · `app/globals.css` — el bloque del flujo

Después del bloque de la 217 y antes de `.dark`, fuera de todo `@layer`, sin un solo token.
Cadena (B) → ocultamiento (A) con sus tres ramas → hoja (C) → `~` entre candidatas (D), y el
`@page` dentro. El comentario pegado encima lleva lo que T9 pide: cómo se elige la hoja
(candidata + elegida, cero y varias), por qué lista blanca, la enumeración de lo que deja de
imprimirse **con su ancla**, el motivo medido de cada `!important`, de dónde sale el margen, lo
que `@page` **no** controla y lo que el bloque **no** promete.

Compilado contra el compilador real antes de creerlo:

```
compilado OK, bytes: 15797
@page presente: true
contexto: "…--info-strong: #1d4ed8; } } @media print { @page { size: portrait; margin: 12mm; } …"
```

### T18 · ADELANTADA a esta tanda *(desviación del orden de `tasks.md`, y su motivo)*

`tasks.md` pone T18 en la Tanda 3, pero **T8 escribe un `@page` y el caso
`tema-encendido.guardia.test.ts:331` lo prohíbe explícitamente**: la Tanda 1 no puede cerrar en
verde —como su propia nota de cierre exige— sin reexpresarlo antes. Se hizo al final de la
tanda, después de T10, que es de quien T18 depende. **Es un conflicto de orden dentro del spec,
no una decisión que me haya tomado**: el caso se REEXPRESA, no se borra ni se relaja.

Lo que defiende ahora, y sigue siendo cierto: (a) el formato **no se mezcla** con el bloque de
tokens de la 217 —cero declaraciones que no sean tokens en `.papel-al-imprimir`, y cero `@page`
dentro de ese bloque—; (b) **no aparece en un tercer sitio** —hay exactamente una `@page` en el
archivo—.

---

## Tanda 2 y 3 — El componente, la candidatura y la prosa

- **T12** — `hoja-imprimible` en el `<Card>` de `HojaFactura` **siempre** y en el de
  `HojaResumen` **condicionada a `open`**.
- **T13** — `break-inside-avoid` en las **cinco** piezas de la lista cerrada.
- **T15/T16** — ver abajo: aquí es donde la verificación excede lo que el diseño esperaba.
- **T17/T19** — la prosa de `cierre-factura.tsx` y la de `globals.css:281-287` reexpresadas;
  el límite del KPI animado escrito junto a `KpiFactura`.

### Una lectura del spec que conviene revisar: «la rejilla de KPI»

`R19` y `design.md §6.1` piden `break-inside-avoid` en «la **rejilla** de KPI (`:249`)». Los
otros cuatro anclajes de esa tabla son exactos (`:913` la fila, `:1272` la sección, `:1287` el
panel, `:1317` el pie); **`:249` no lo es**: no es la raíz de `KpiFactura` (`:245`) ni la de la
rejilla (`:1165`), es un `<span>` interior. Se estampó en **la rejilla** (`:1165`), porque es lo
que dice la palabra normativa y lo que justifica `design.md` («bloque corto y cerrado» — una
tarjeta suelta no es un bloque cerrado, las cuatro juntas sí), y porque protegida la rejilla
ninguna tarjeta puede partirse tampoco. **Si la intención era `KpiFactura`, es un cambio de una
línea y de un renglón en la lista congelada de la guardia.**

### Y una que no se pudo verificar como el diseño suponía: jsdom **sí** resuelve `:has()`

`design.md §6.6` da por hecho que «jsdom no compone estilos, no resuelve `@media print` ni
`:has()`». Lo primero y lo segundo son ciertos; **lo tercero no**: jsdom 29.1.1 resuelve `:has()`
en `querySelectorAll`. Eso permite algo que el diseño no contemplaba y que es mucho más fuerte
que un censo de texto: **leer los selectores reales de `app/globals.css` con el parser compartido
y evaluarlos contra el DOM montado**. Los selectores **no se copian** al test — copiarlos sería
el fallo que la 222 encontró en una guardia que describía clases retiradas.

Es lo que caza el defecto de A.1 que abre esta bitácora, y lo que da dueño ejecutable a R6, R7 y
R8 dentro del gate. **Sigue sin ser el papel**: no hay cascada, no hay `@media print` y no hay
paginación. Dicho con esas palabras en la cabecera del archivo.

---

## Tanda 4 — Mutaciones, motor real y mapa

### T20 · Las 19 mutaciones, **cada una con su variante inocua** — 38 corridas, 38 ROJAS

Método, y sin él ningún número de aquí valdría: se **commiteó antes de mutar**; cada mutación se
aplicó con un script con **autocomprobación** (si su ancla no aparecía, abortaba sin escribir) y
**se comprobó con `git diff` que estaba en el árbol** antes de correr nada. Una corrida sin
mutación en el árbol es un verde que no significa nada.

| # | Mutación | Resultado | Variante INOCUA | Resultado |
| --- | --- | --- | --- | --- |
| 1 | Borrar el bloque entero | 🔴 6 | Dejarlo fuera de `@media print` | 🔴 5 |
| 2 | Quitar la guarda `:has()` de una regla | 🔴 3 | Dejarla sólo en el primer selector | 🔴 2 |
| 3 | Borrar el `:not(:has([role=dialog]…))` del nivel 2 | 🔴 1 | Sustituirlo por `:not(:has(.hoja-imprimible))` (existe y no aplica nunca) | 🔴 2 |
| **3-bis** | *(nueva)* — | — | **A.1 tal como la escribe `design.md §3.4`** | 🔴 2 |
| 4 | Borrar la rama de nivel 1 | 🔴 4 | Anclarla en `[role="alertdialog"]` | 🔴 4 |
| 5 | Quitar la condición `open &&` | 🔴 4 | Marcarla con `!open &&` | 🔴 10 |
| 6 | Quitar `overflow: visible` de la cadena | 🔴 3 | Escribirlo en el comentario | 🔴 3 |
| 7 | Quitar `position: static` | 🔴 3 | Ponerlo en la regla de la hoja (C), donde no sirve | 🔴 3 |
| 8 | Borrar el `@page` | 🔴 5 | Escribirlo dentro de un comentario | 🔴 5 |
| 9 | `margin: 0` | 🔴 1 | `margin: 1px` | 🔴 1 |
| 10 | `size: A4 portrait` | 🔴 1 | `size: 21cm 29.7cm` | 🔴 1 |
| 11 | Anidar en `@layer utilities` | 🔴 2 | Anidar en `@layer` a secas | 🔴 2 |
| 12 | `--foo: #fff` dentro del bloque | 🔴 2 | Declararlo dentro del `@page` | 🔴 2 |
| 13 | Mover el bloque delante del de la 217 | 🔴 12 | Tercer `@media print` vacío al final | 🔴 1 |
| 14 | Poner (A) antes que (B) | 🔴 1 | Igualar especificidades dejando (A) después | 🔴 1 |
| 15 | Quitar la marca de `HojaFactura` | 🔴 6 | Estamparla en un `<div>` interior | 🔴 4 |
| 16 | Quitar `break-inside-avoid` de la fila | 🔴 1 | Ponerlo **también** en la sección de órdenes | 🔴 2 |
| 17 | Quitar el `!important` de `max-width` | 🔴 1 | `!important` en **todas** las declaraciones | 🔴 16 |
| 18 | Borrar `overflow-y-auto` de `CierresAdminModule` | 🔴 1 | Borrar `overflow-auto` de `Modal.tsx` | 🔴 1 |
| 19 | Montar dos hojas en el mismo `Modal` | 🔴 1 | Quitar el `role="dialog"` del popup | 🔴 6 |

**Ninguna variante inocua salió verde**, que es la condición que `tasks.md` T20 pone para dar la
guardia por terminada. Las dos que más importan:

- **#2 inocua** (guarda `:has()` sólo en el primer selector) pone roja, además del censo, la
  evaluación en jsdom **«sin ninguna candidata, la regla NO engancha nada»** — el caso de la
  página en blanco, atrapado por comportamiento y no por forma.
- **#3-bis** es el CSS que el diseño escribió, y muerde por dos vías distintas: el censo de la
  forma escrita **y** la evaluación contra el DOM real.

### T21 · La comprobación en un MOTOR REAL — **hecha, y con más alcance del prometido**

`tasks.md` T21 pide UNA comprobación **manual y fechada** en al menos un motor. No se hizo a
mano: se hizo **reproducible en Chromium/Blink** (Playwright 1.61.1, build 1228, ya instalado),
que es la misma evidencia sin depender de que alguien recuerde qué miró.

**Cómo, y qué es exactamente lo que se midió.** Se serializó el DOM que rinden **los componentes
de verdad** en los cuatro escenarios —incluidos el portal de Base UI y **los estilos en línea del
scroll lock**—, se le puso el CSS **compilado** de `app/globals.css`, y se le pidió a Chromium
resolver `@media print`, `:has()`, la cascada y los `!important`, terminando en un `page.pdf()`
real. **Fecha: 2026-08-14.**

| # | Lo que T21 manda mirar | Medido |
| --- | --- | --- |
| 1 | Sale **sólo** la hoja | 2 hojas en el DOM → **1** llega al papel. Barra lateral, cabecera, backdrop y botonera de decisión: `display: none`. El diálogo, visible. |
| 2 | **No** está recortada | Los **cinco** ancestros hasta el `<body>` computan `overflow: visible`, `max-height: none`, `max-width: none`, `position: static`, `transform: none`. `cadenaRecorta: false`. La hoja crece a **2382 px** en vez de quedarse en el `max-h-[70vh]`. |
| 3 | Un cierre largo continúa en la siguiente página | 28 órdenes → **PDF de 3 páginas** (ruta admin y ruta mensajero). |
| 4 | Con el detalle abierto, las compactas de detrás **no** salen | `hojasEnDom: 2 · hojasVisiblesEnPapel: 1`. |
| 5 | Dos compactas desplegadas, sin modal → salen las dos, una por página | **2** visibles, `break-before: page` computado en la segunda, **PDF de 2 páginas**. |
| 6 | Lista sin nada desplegado → imprime como antes | Barra lateral y cabecera **visibles**, PDF de 1 página. Nada oculto. |
| — | *(añadido)* la ruta del **mensajero**, con la misma regla y sin una línea propia | Hoja visible, nota «solo lectura» oculta, PDF de 3 páginas. **R11 en un motor.** |

**Y la contraprueba, que es lo que convierte el defecto de A.1 en un hecho.** Con el selector tal
como lo escribe `design.md §3.4`, en el mismo motor y el mismo escenario 1:

```
hojasEnDom = 2   hojasVisiblesEnPapel = 0   dialogoVisible = false
paginasPdf = 1   bytesPdf = 652        ← exactamente el tamaño del PDF «no se imprimió nada»
```

**Lo que esta comprobación NO es, y no puede leerse como si lo fuera:** no es la aplicación
corriendo. Los datos son de fixture, el DOM viene serializado de jsdom y no hay servidor, sesión
ni base. **No sustituye a mirar la app**, y no es cobertura permanente: **el harness se borró a
propósito** —montarlo en el gate es ficha aparte (`design.md §10`)— así que **nada de esto se
volverá a comprobar solo**. Lo que sí queda vivo en el gate es la forma del CSS y la evaluación
de sus selectores en jsdom.

**Lo que sigue sin verificarse, ni aquí ni en el gate:** el papel físico (márgenes reales de una
impresora, encabezado/pie del navegador, «gráficos de fondo»), otros motores (Gecko, WebKit),
cómo fragmenta cada uno el interior flex de la hoja, y la cifra del KPI en el instante de
imprimir (R29).

### T23 · `./init.sh` completo

**No corrido**: el encargo dice explícitamente que el gate completo lo corre el leader. Lo que sí
está corrido es `./init.sh --rapido` al cierre de cada tanda, todas en verde.

---

## T22 · Mapa R → test — **los 33 con dueño**

`FLUJO` = `tests/unit/guards/impresion-flujo.guardia.test.ts` ·
`PAPEL` = `tests/components/CierreFacturaPapel.test.tsx` ·
`TEMA` = `tests/unit/guards/tema-encendido.guardia.test.ts` ·
`SINDARK` = `tests/unit/guards/impresion-sin-dark.guardia.test.ts` ·
`CONTRASTE` = `tests/unit/guards/factura-contraste.guardia.test.ts`

| R | Dueño | Tipo |
| --- | --- | --- |
| R1 | `FLUJO` «TODOS los selectores… llevan su guarda» + `PAPEL` «sale la hoja del diálogo y NO la compacta» y «tampoco llegan al papel los controles» | evaluado en jsdom + motor (T21-1) |
| R2 | `FLUJO` «TODOS los selectores…» + **`PAPEL` «sin ninguna candidata, la regla NO engancha nada»** | evaluado + motor (T21-6) |
| R3 | `FLUJO` «recorre la cadena sin nombrar ningún contenedor, y sin nombrar ninguna pieza del portal» | estructural |
| R4 | `FLUJO` «enumera, con su ancla, qué deja de imprimirse» (×4) + `PAPEL` «tampoco llegan al papel los controles» | estructural + evaluado |
| **R5** | `FLUJO` «aparece EXACTAMENTE dos veces…», «la del DETALLE va sin condición; la COMPACTA, condicionada a `open`» + `PAPEL` «plegada NO la lleva» / «y la lleva en cuanto se despliega» | estructural + **ejecutado** |
| **R6** | `FLUJO` «existe la rama de NIVEL 1» / «de NIVEL 2» / «conserva su segundo `:not(:has(…))`» + `PAPEL` «sale la hoja del diálogo…» y «dos compactas desplegadas…» | estructural + evaluado + motor (T21-4,5) |
| **R7** | **`PAPEL` «sin ninguna candidata…»** + `FLUJO` guarda `:has()` | evaluado + motor (T21-6) |
| **R8** | `FLUJO` «una hoja por página… `break-before: page`» + `PAPEL` «dos compactas desplegadas…» | estructural + motor (T21-5) |
| **R9** | `PAPEL` «el popup expone `role="dialog"`» y «dentro del diálogo hay EXACTAMENTE una candidata» | ejecutado |
| R10 | `FLUJO` «declara las TRECE propiedades» + `PAPEL` «el scroll lock, medido» + `PAPEL` «la regla de la cadena cubre TODOS los ancestros» | estructural + evaluado + motor (T21-2) |
| R11 | `FLUJO` «sin nombrar ningún contenedor» + `PAPEL` «cubre TODOS los ancestros» (ruta admin) + T21 (ruta mensajero) | evaluado + motor |
| R12 | `FLUJO` «el módulo del admin conserva…», «el `Modal` conserva…», «ninguno estrena `print:`» | estructural |
| R13 | `FLUJO` «lleva `!important` EXACTAMENTE en las cinco…» + `PAPEL` «el scroll lock, medido» | estructural + **medido** |
| R14 | `FLUJO` «declara las TRECE…» (incluye `display`) + «la regla que OCULTA va DESPUÉS» | estructural |
| R15 | `FLUJO` «hay EXACTAMENTE una `@page`…», «declara `size` con ORIENTACIÓN y sin nombre de papel» | estructural |
| R16 | `FLUJO` «el margen es 12mm, está en UN solo sitio y no es cero» | estructural |
| R17 | `FLUJO` «declara que `@page` no controla…» (×4) | estructural |
| R18 | `FLUJO` «la hoja elegida deja de recortarse a sí misma» + R20 (sin `break-inside` en las raíces) | estructural + motor (T21-3) |
| R19 | `FLUJO` «`break-inside-avoid` está EXACTAMENTE en las cinco piezas» | estructural |
| R20 | `FLUJO` «NO se evita el corte en…» (×4) + la misma lista congelada | estructural |
| R21 | `FLUJO` «declara que las cabeceras de columna NO se repiten, y por qué» | estructural — **no hay test que pueda afirmar más** |
| R22 | `FLUJO` «declara que lo plegado y las pestañas no visitadas NO se imprimen» | estructural — ídem |
| R23 | `TEMA` (los tres casos de `.papel-al-imprimir`, **verdes sin tocarse**) + `FLUJO` «no nombra `.papel-al-imprimir`» + `CONTRASTE` | estructural |
| R24 | `TEMA` «junto a la regla… su límite» y «el bloque va ANTES de `.dark`» (**anclas por contenido**) + `SINDARK` «el ancla vieja…» + `FLUJO` «hay EXACTAMENTE dos `@media print`» | estructural |
| R25 | `FLUJO` «no nombra `.papel-al-imprimir` ni declara ningún token» | estructural |
| R26 | `FLUJO` «las reglas del bloque cuelgan de `@media print` y de NINGÚN `@layer`» | estructural |
| R27 | `CONTRASTE` «no fuerza la impresión de fondos ni añade un flujo» (**verde sin tocarse**) + `FLUJO` «sigue sin haber botón» | estructural |
| R28 | `TEMA` «el formato de página no se mezcla…» (REEXPRESADO) + `FLUJO` «la cabecera ya no afirma que no hay `@page`» y «conserva lo que sigue siendo cierto» | estructural |
| R29 | `FLUJO` «junto a `KpiFactura` está escrito que una impresión puede llevar una cifra intermedia» | estructural |
| R30 | Los censos usan `codigoSinComentarios`; autocomprobado en `FLUJO` «el censo lee el CÓDIGO… no su prosa» (CSS y `.tsx`); mutaciones 6i y 8i rojas | estructural |
| R31 | Esta bitácora, §T20: 19 + 19, **ninguna inocua verde** | evidencia |
| R32 | `FLUJO` «un solo parser de reglas CSS» (3 casos) | estructural |
| R33 | Cabeceras de `FLUJO` y `PAPEL` + §T21 de aquí (lo no verificado, listado) | declaración |

**33 de 33 con dueño. Ninguno huérfano.** Diez de ellos (R1, R2, R4, R5, R6, R7, R9, R10, R11 y
parcialmente R3) tienen además verificación **por comportamiento** —evaluación de los selectores
reales contra el DOM real—, que es más de lo que `design.md §6.6` daba por posible.

### Lo que NO queda verificado por el gate, listado y no omitido *(R33)*

1. **El papel físico.** Márgenes reales de una impresora, encabezado/pie del navegador, escala y
   «gráficos de fondo». Ninguna pieza del gate imprime.
2. **Otros motores.** Lo de T21 es Blink. Gecko y WebKit **no están medidos** y no se afirman.
3. **Dónde caen los cortes** y cuántas páginas salen con datos reales.
4. **La fragmentación del interior flex** de la hoja.
5. **La cifra del KPI** en el instante de imprimir (R29): declarada junto a la pieza, no
   arreglada.
6. **El `<html>` bloqueado por el scroll lock** (`overflow-y/x: hidden` en línea): fuera del
   alcance de R10 por decisión escrita; medido y congelado, no verificado en papel.
7. **La app corriendo.** T21 usa datos de fixture y DOM serializado. Mirar la aplicación de
   verdad sigue encontrando cosas que ninguna suite ve.
