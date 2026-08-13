# Feature 217 — La factura del cierre oscurece con el tema · bitácora de implementación

Rama `feature/217-factura-oscurece-con-el-tema`, desde `origin/dev` (`804b6b05`).
Spec: `specs/217-factura-oscurece-con-el-tema/` (puerta humana PASADA el 2026-08-13).

Todo lo que aquí se mide sale de `tests/fixtures/contraste.ts`, que es la aritmética que
la 210 dejó commiteada y validada. **No se usó ninguna herramienta externa**; en
particular, ninguna medición se apoya en `.claude/skills/impeccable/scripts/detector/`
(D9 lo prohíbe por nombre, y hay una guardia que lo censa).

---

## Tanda 0 — El instrumento: una sola aritmética, compartida (T1-T4)

### T1 · `tests/fixtures/contraste.ts` (nuevo)

Extraídas **sin tocar una línea de su lógica**: `aRgb`, `luminancia`, `contraste`,
`componer`, y el lector de tokens (`partirPorTema`, `token`, `paleta`). El módulo no
importa nada de `app/` ni de producción: lo único que ejecuta al importarse es leer
`app/globals.css` como archivo de texto.

### T2 · La guardia de la 210 pasa a consumir el fixture

`git diff --stat tests/unit/guards/contraste-tokens.guardia.test.ts`:

```
 tests/unit/guards/contraste-tokens.guardia.test.ts | 111 ++-------------------
 1 file changed, 6 insertions(+), 105 deletions(-)
```

El diff **sólo quita definiciones y añade un `import`**: ningún caso cambió de nombre ni
de aserción. Los tres autocontroles (tres razones publicadas por WCAG, los dos extremos
de la composición alfa, el lector devolviendo el token vigente y no un hex de un
comentario) siguen ahí y **ahora validan la copia compartida**.

```
pnpm exec vitest run tests/unit/guards/contraste-tokens.guardia.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### T3 · El arreglo del lector ante `@media print` — ANTES de crear el bloque

`quitarBloquesDeImpresion()` en el fixture, aplicado **antes** de `partirPorTema`. El
comentario que lo acompaña nombra el fallo concreto que evita: si el bloque de impresión
cae detrás de `.dark`, sus hexes claros ganan por ser los últimos de esa mitad y
`token("oscuro", …)` devuelve los valores CLAROS — todas las comprobaciones de oscuro
pasan a medir el tema equivocado **en verde**. Vive en el fixture y no en una guardia
porque hay dos guardias que leen estos tokens: arreglado en una, quedaría vivo en la otra.

Se hizo **antes** que T5 a propósito (el orden T3 → T5 no es negociable en `tasks.md`).

### T4 · Censo del instrumento — `tests/unit/guards/factura-contraste.guardia.test.ts`

Tres casos: (a) autocomprobación de que el censo lee de verdad el árbol (`> 300` archivos
y la firma presente en la copia canónica: sin esto, un barrido que no lee nada reporta
cero infractores en verde); (b) cero segundas copias de la fórmula en `tests/`; (c) cero
referencias al detector de `.claude/skills` en `tests/`.

**Hallazgo de método, corregido:** la primera versión barría el texto crudo y **se
denunciaba a sí misma** por su propio comentario (`` `+ 0.05` `` en la prosa que explica
qué busca) y denunciaba al fixture por la línea que declara el medidor prohibido. Es
exactamente el fallo que la feature 209 documenta. Se barre el **código**, con
`quitarComentarios` compartido; así la prosa puede nombrar lo prohibido sin ser el
infractor. La alternativa —excluir del barrido al propio archivo que barre— se descartó:
sería un agujero, deja que la segunda copia se esconda justo donde nadie mira.

### Cierre de tanda 0 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files  2 passed (2)      Tests    16 passed (16)
-> test:guardias       Test Files 96 passed (96)     Tests  1317 passed (1317)
== init OK ==
```

---

## Tanda 1 — El CSS (T5, T6)

### T5 · El bloque `@media print` en `app/globals.css`

`@media print { .papel-al-imprimir { … } }` con **las 36 declaraciones** del bloque
`:root, .tema-claro`, sin excepción, colocado **inmediatamente después de ese bloque y
antes de `.dark`**. Sin `print-color-adjust`.

La colocación no es cosmética: es la segunda de las dos medidas contra la trampa del
lector (T3 es la primera). Aunque alguien retirase el `quitarBloquesDeImpresion` del
fixture, los valores que ganarían en la mitad «claro» son los que ya estaban ahí.

`git diff --stat app/globals.css` → `1 file changed, 72 insertions(+)`. **Cero líneas
quitadas**: no se tocó `.dark`, ni `.tema-sistema`, ni `@custom-variant dark` (D6).

### T6 · Los casos del bloque de impresión, en `tema-encendido.guardia.test.ts`

Van ahí y no en un archivo nuevo: ese archivo ya tiene el parser de reglas con ancestros
(`reglasDe`), es el dueño del mecanismo del tema, y es el que hay que reexpresar de todas
formas (R20). Un cuarto parser de CSS en `tests/` es lo que la 209 vino a cerrar.

Cuatro casos: una sola regla `.papel-al-imprimir` con `@media print` entre sus ancestros ·
espejo `toEqual` (claves y valores) contra `:root, .tema-claro` · fija la tinta
(`--foreground`, `--card-foreground` y los cuatro `-strong`) y tiene > 20 declaraciones ·
cero `print-color-adjust` en todo el archivo.

```
pnpm exec vitest run tests/unit/guards/tema-encendido.guardia.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)      (eran 8; +4 de la 217, ninguno de los 8 tocado)
```

`tests/unit/components/analytics-paleta.test.ts` — el que `design.md §7` mandaba vigilar
porque parte el CSS por reglas que incluyan `:root` — sigue verde sin tocarlo:
`Test Files 1 passed (1) · Tests 6 passed (6)`.

### Cierre de tanda 1 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files  3 passed (3)      Tests    28 passed (28)
-> test:guardias       Test Files 96 passed (96)     Tests  1321 passed (1321)
== init OK ==
```

---

## Tanda 2 — El componente (T7, T8, T9, T16, T10, T11)

> **Reordenado a propósito, y aquí queda el motivo.** `tasks.md` pone T16 (la prosa de la
> cabecera del `.tsx`) en la Tanda 4, pero **T10 no puede estar verde antes que T16**: su
> censo exige **0 `tema-claro` en TODO el archivo, comentarios incluidos** (R19), y el
> bloque de cabecera de la 208 nombraba el pin nueve veces. O se movía T16, o T10 se
> quedaba rojo dos tandas. Se movió T16. El resto del orden se respeta.

### T7 · El pin sale, la clase de impresión entra — en las DOS hojas

`cierre-factura.tsx`: `tema-claro` → `papel-al-imprimir` en el `<Card>` de `HojaFactura`
(el detalle) y en el de `HojaResumen` (el comprobante compacto). Las dos: el mismo
documento no puede tener dos materiales.

### T8 · Los 16 sitio a sitio, con la tabla de `design.md §2` delante

Quince `text-navy` → `text-foreground` y el `border-navy` de la pestaña activa →
`border-foreground`. **No se hizo un reemplazo en bloque**: cada sitio se abrió, se
comprobó contra su ancla y su papel semántico en la tabla del design (titular, cifra,
dato realzado, rótulo enfatizado, identificador, indicador de selección) y se editó solo.
La convergencia de quince de los dieciséis en `text-foreground` es una **conclusión** —el
navy era, en todos ellos, «el color del texto principal de la hoja»—, no un atajo.

Ninguno pasó a `primary`/`brand` (R3) ni a un `-strong`. El indicador de la pestaña lleva
además un comentario con el porqué: en ese condicional se pinta **borde y etiqueta a la
vez**, y `--primary` (3.18 sobre blanco) cumple el 3:1 de componente pero **no** el 4.5:1
de texto — es justo la deuda abierta de la ficha 216.

**El diff sólo cambia utilidades de color (R5).** 18 líneas de código tocadas, y cada par
`-`/`+` difiere únicamente en el token de color (o en la clase de la `<Card>`): ni un
tamaño, ni un peso, ni un espaciado, ni un borde, ni un icono, ni la jerarquía.

### T9 · La nota de «Ingreso bruto» pierde la opacidad (D5)

`text-success-strong/80` → `text-success-strong`. Un token `-strong` existe para
garantizar 4,5:1; ponerle alfa anula la garantía por la que se eligió. Con eso, la hoja
entera queda cubierta por **pares ordinarios** y el inventario no necesita un caso
especial de doble composición cuyo único consumidor sería esa nota.

### T16 (adelantado) · La prosa de la cabecera

Reescrito el bloque de la 208 (`:73-128`) y los comentarios de las dos `<Card>`. El bloque
nuevo dice: que la hoja **gira**; que al imprimir vuelve a claro y **por qué el mecanismo
es fijar tokens y no pintar un fondo** (los 116 de la 208 + los fondos que el navegador no
imprime); **qué NO apaga** la regla de impresión (el variant `dark:`, con su razón: el
resultado impreso es idéntico al que la hoja mostraba en pantalla antes de esta feature,
statu quo y no regresión); **qué NO cubre** la impresión (sin botón, sin `@page`, y desde
el modal se arrastra el resto de la página); y que `progress/impl_208_modo-oscuro.md`
describe la decisión **anterior** y no se edita.

Censo después: **0** `navy`, **0** `tema-claro` en todo el archivo, prosa incluida.

### T10 · Censo de fuente — `factura-contraste.guardia.test.ts`

Ocho casos, con el quitador **compartido** (feature 209) y una autocomprobación por
delante (si la hoja se renombra o se mueve, todo lo demás censaría una cadena vacía y
saldría verde sin mirar nada).

La **excepción `brand`** va escrita en el código de la guardia con su motivo, no como un
agujero en la expresión regular.

**Hallazgo contra el design (T12 lo recoge):** `design.md §6.4` dice que `brand` tiene
**dos** usos en las hojas (wordmark `:509` y franja `:315`). Son **tres**: falta
`border-t-brand` en la `<Card>` de `HojaResumen` (`:503`), el filete superior de la hoja
compacta. Misma naturaleza que la franja —decorativo, sin texto— así que **no cambia
ninguna decisión**, pero el inventario lo lista aparte en vez de heredar el error.

### T11 · Test de componente (jsdom) — `tests/components/CierreFacturaPapel.test.tsx`

Cinco casos sobre las dos hojas, localizadas por `role="region"` + `aria-label` y **nunca
por una clase** (localizarlas por la clase que se comprueba haría que el caso pasara por
construcción). La advertencia de que **jsdom sólo lee la cadena de clases** —no compone
color, no resuelve la cascada, no aplica `@media`— está escrita **en el propio archivo**,
arriba del todo, para que su verde no se lea como «se ve bien».

### Cierre de tanda 2 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files 17 passed (17)     Tests   285 passed (285)
-> test:guardias       Test Files 96 passed (96)     Tests  1329 passed (1329)
== init OK ==
```

---

## Tanda 3 — El inventario CERRADO de pares (T12, T13, T14)

### T12 · El inventario, cerrado recorriendo el archivo (no transcrito del design)

Se extrajo **toda** utilidad con prefijo de color de `cierre-factura.tsx` (código, sin
prosa) y se mapeó una a una. Resultado: **20 utilidades distintas**, todas con par.

Frente a la tabla de partida de `design.md §6.3`, el cierre encontró **tres cosas**:

| Hallazgo | Qué era | Qué se hizo |
| --- | --- | --- |
| **P19 faltaba** | La tinta POR DEFECTO de la hoja. `components/ui/card.tsx` pinta `bg-card text-card-foreground`, y **todo** texto sin clase de color lo hereda: el importe no enfatizado de un renglón, los `h4` del desglose de tarifa, los valores de `DesgloseFila`. No hay ninguna utilidad `text-card-foreground` escrita en la hoja, y por eso un censo de utilidades no lo ve. Era **el par más usado de la hoja y no estaba en la lista**. | Añadido y medido: **15,70 claro · 13,74 oscuro** |
| **`brand` tenía TRES usos, no dos** | `design.md §6.4` nombraba el wordmark (`:505`) y la franja (`:311`). Falta el `border-t-brand` de la `<Card>` compacta (`:499`). | Añadido como **P17**, exento con su motivo (decorativo, sin texto) |
| **`border-border` no estaba ni como medido ni como exento** | R16 dice que un exento ausente es indistinguible de un par que nadie miró. | Añadido como **P18**, exento con su motivo. El borde que **sí** es indicador de estado —el de la pestaña seleccionada— va aparte y **medido**, en P12 |

Ningún par quedó **indeterminado**: las cuatro capas de opacidad de la hoja
(`muted/40`, `muted/50`, `success/15`, `warning/15`) componen sobre `card`, que es
opaco. **No hay ninguna opacidad sobre otra opacidad** — el único caso que lo habría
sido, `text-success-strong/80`, lo quitó R8/T9, y ése era justamente su segundo motivo.

### T14 · Los 15 pares medibles, en los dos temas (2026-08-13)

| Par | Qué pinta | Claro | Oscuro | Umbral |
| --- | --- | --- | --- | --- |
| P1 | `foreground` / `card` — la tinta principal | 15,70 | 13,74 | 4,5 |
| P2 | `foreground` / `muted` opaco | 14,26 | 12,22 | 4,5 |
| P3 | `foreground` / `muted@40` sobre `card` | 15,13 | 13,10 | 4,5 |
| P4 | `foreground` / `muted@50` sobre `card` (incluye **hover**) | 15,01 | 12,92 | 4,5 |
| P5 | `muted-foreground` / `card` | 7,70 | 7,21 | 4,5 |
| P6 | `muted-foreground` / `muted` opaco | 6,99 | 6,41 | 4,5 |
| P7 | `muted-foreground` / `muted@40` | 7,42 | 6,87 | 4,5 |
| P8 | `muted-foreground` / `muted@50` (incluye **hover**) | 7,36 | 6,78 | 4,5 |
| P9 | `success-strong` / `success@15` — incluye la nota ya sin `/80` | **4,77** | 6,60 | 4,5 |
| P10 | `warning-strong` / `warning@15` | 6,31 | 7,59 | 4,5 |
| P11 | `danger-strong` / `card` | 6,47 | 5,89 | 4,5 |
| P12 | `foreground` **borde** / `card` — pestaña activa | 15,70 | 13,74 | **3,0** |
| P13 | `success-strong` / `card` | 5,48 | 8,47 | 4,5 |
| P14 | `success-strong` / `muted@50` — el mismo total **en hover** | 5,24 | 7,97 | 4,5 |
| P19 | `card-foreground` / `card` — la tinta heredada | 15,70 | 13,74 | 4,5 |

**El más justo es P9 en claro: 4,77.** Margen de 0,27 sobre AA. Es el par que la nota de
«Ingreso bruto» pasa a usar tras quitarle el `/80`; con el `/80` medía 3,36. Queda con
suelo, así que no puede bajar en silencio.

Exentos, en la lista y marcados (R16): **P15** separadores `|` · **P16** wordmark ·
**P17** franja y filete de marca · **P18** filetes y separadores estructurales.

#### Comprobación cruzada del instrumento — **nueve** coincidencias

No es autocomplacencia: son números que dejaron **otras features** en el repo, medidos
por otra vía y anteriores a esta guardia. Coinciden **a la centésima**:

| Medido aquí | Contra qué | Dónde estaba escrito |
| --- | --- | --- |
| P13 claro 5,48 | `--success-strong: #047857` vs card | `globals.css:185` |
| P13 oscuro 8,47 | `--success-strong: #34d399` vs card | `globals.css:245` |
| P9 oscuro 6,60 | `#34d399` vs `success/15` | `globals.css:245` |
| P11 claro 6,47 | `--danger-strong: #b91c1c` vs card | `globals.css:190` |
| P11 oscuro 5,89 | `--danger-strong: #f87171` vs card | `globals.css:247` |
| P10 claro 6,31 | `#92400e` vs `warning/15` | `globals.css:189` |
| P21 claro 3,18 | `--primary` sobre blanco | ficha 216 y `design.md §2b` |
| P22 claro 3,29 · oscuro 4,43 | `bg-destructive/10` + `text-destructive` | `badge.tsx`, comentario de la 210 |
| P23 claro 14,79 | `Button outline` | medición de la 208 |

Nueve aciertos independientes es lo más parecido a un control externo que se puede tener
sin navegador. **Y no es la única defensa**: la fórmula y el lector traen sus tres
autocontroles (tres razones publicadas por WCAG, los dos extremos de la composición alfa,
el parser leyendo el token vigente y no un hex de un comentario), que ahora corren sobre
esta misma copia compartida.

### T13 · Lo que entra a la hoja por props y por imports, clasificado

El censo de T12 lee `cierre-factura.tsx`; las hojas **muestran color que no está escrito
ahí**. Enumerado por llamador y por import, sin dejar ninguna pieza sin clasificar:

| De dónde entra | Qué monta | Clasificación |
| --- | --- | --- |
| `CierresAdminModule.tsx:749` → `acciones` | un `div` sin color + `Button` variants `default` / `outline` / `destructive` | **(b) primitiva** → P21, P22, P23 |
| `CierresAdminModule.tsx:827` → `CierreFacturaDetalle` | sólo datos y un callback `onVerEvidencia` | sin color |
| `CierreDiaModule.tsx:730` → `CierreFacturaDetalle` | sólo datos (audiencia `mensajero`) | sin color |
| `rotulo` (prop de la hoja compacta) | **ningún llamador la usa hoy** | nada que clasificar |
| `extra` | sólo lo usa `CierreBodegaFacturaResumen`, dentro del propio archivo | ya censado (P4/P8) |
| import `EstadoCierreBadge` | `Badge` variants `secondary` / `outline` / `destructive` | **(b) primitiva** → P25, P1, y el par de `danger` que ya vigila la 210 |
| import `renderPagoMensajero` | `Badge variant="outline"` | **(b)** → cae en P1 |
| import `DesgloseIngresoOrdenex` | `text-destructive`, `text-muted-foreground` y tinta heredada | **(a) tokens que giran** → **P20**, P5, P19 |
| import `KpiValorAnimado` | sin color propio; hereda | cae en P3 |
| `components/ui/card.tsx` | `bg-card text-card-foreground ring-foreground/10` | **(a)** → P19 (y el `ring`, decorativo) |

**Cero casos (c)** — ninguna pieza entra con color propio fijo. No hubo que detenerse a
consultar.

### R17 / R18 — la deuda que se declara y NO se parchea

Medido el 2026-08-13, dentro de la hoja, con la aritmética del fixture:

| Id | Qué | Claro | Oscuro | De quién es |
| --- | --- | --- | --- | --- |
| **P20** | el aviso «sin tarifa congelada» del desglose auditable, `text-destructive` (`cierre-detalle-shared.tsx:651`) | **3,76** | 5,89 | **R17**: preexistente, ajeno al pin y ajeno a R8. Vive en un componente COMPARTIDO con las tablas del detalle |
| **P21** | `Button` variant `default` (`button.tsx:12`) | **3,18** | 7,06 | **R18** — ficha 216 (`--primary` en texto normal) |
| **P22** | `Button` variant `destructive` (`button.tsx:24`) | **3,29** | **4,43** | **R18** — fichas 210/216. La 210 arregló el `Badge` (lo mandó al par de `danger`); el `Button` no se tocó |

Los que **sí** cumplen y quedan igualmente con suelo: P23 `Button outline` 14,79/12,08 ·
P24 el mismo botón heredando `muted-foreground` 7,25/6,34 · P25 `Badge secondary`
13,86/12,22.

**Ninguna se corrigió con clases locales.** `git diff --name-only` no incluye
`components/ui/` (T21 lo pega). Un parche local dejaría la misma variante rota en las
otras rutas y, encima, escondería la deuda.

Los tres quedan además **atornillados por su suelo**: si empeoran, la guardia se pone
roja aunque nadie los esté mirando. Y la lista de «cuáles están bajo AA» es un caso
ejecutable, no un párrafo: si la 210 o la 216 arreglan una, el caso se pone rojo y obliga
a actualizar la declaración. Un registro de deuda que no se entera de que la deuda se
pagó es tan falso como uno que no se entera de que creció.

### Cierre de tanda 3 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files 17 passed (17)     Tests   311 passed (311)
-> test:guardias       Test Files 96 passed (96)     Tests  1355 passed (1355)
== init OK ==
```
