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

*(Las tandas siguientes se anotan según se cierran.)*
