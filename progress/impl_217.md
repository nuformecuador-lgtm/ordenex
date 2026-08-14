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

---

## T15 — LA MUTACIÓN OBLIGATORIA (R24)

Es el riesgo más caro de la ficha porque **rompe en verde**. La mutación, exactamente la
que pide `design.md §6.2`: mover el bloque `@media print` **detrás** de `.dark` **y**
revertir T3 (quitar `quitarBloquesDeImpresion` del fixture).

**Antes de correrla, `git diff` confirmó que el árbol cambió de verdad** — una mutación
que no se aplicó y un arreglo que funciona se leen igual de verdes:

```
 app/globals.css             | 82 +++++++++++++++++++-------------
 tests/fixtures/contraste.ts |  2 +-
-const cssDePantalla = quitarBloquesDeImpresion(cssSinComentarios);
+const cssDePantalla = cssSinComentarios; // MUTACION: T3 revertida
```

**Detalle que casi hace inútil la mutación, y que conviene dejar escrito:** colocar el
bloque justo después de `.dark` **no basta**. El bloque `@media (prefers-color-scheme:
dark)` que viene a continuación vuelve a declarar todos los tokens, y como gana **el
último**, el veneno no llega. Hay que ponerlo **después de los dos** —que es, además,
dónde acaba lo que uno añade al final de un archivo—. Una mutación mal colocada habría
salido verde y me habría hecho concluir que la medida 1 no servía.

### Resultado: **ROJA**, 10 casos en dos guardias

```
× tema oscuro: --success-strong sobre success/15 …  expected 4.774… >= 6.59
× tema oscuro: --warning-strong sobre warning/15 …  expected 6.310… >= 7.58
× tema oscuro: --info-strong   sobre info/15    …   expected 5.352… >= 6.96
× P9  … EMPEORÓ: medía 6.6  … expected 4.774… >= 6.59
× P10 … EMPEORÓ: medía 7.59 … expected 6.310… >= 7.58
× P13 … EMPEORÓ: medía 8.47 … expected 5.483… >= 8.46
× P14 … EMPEORÓ: medía 7.97 … expected 5.244… >= 7.96
× P20 … EMPEORÓ … expected 3.763… >= 5.88
× P21 … EMPEORÓ … expected 3.175… >= 7.05
× P22 … EMPEORÓ … expected 2.899… >= 4.42

 Test Files  2 failed (2)
      Tests  10 failed | 40 passed (50)
```

**Y el rojo dice exactamente lo que la trampa predecía.** Los valores que devuelve «tema
oscuro» envenenado son, uno a uno, **los del tema CLARO**: P9 oscuro devuelve 4,774 —el
claro—, P13 devuelve 5,483 —el claro—, P20 devuelve 3,763, P21 devuelve 3,175. La
guardia estaba midiendo el tema equivocado, y lo único que lo delata es el **suelo por
par**: el umbral solo no habría bastado, porque casi todos los pares claros pasan de
sobra el 4,5. Ésa es la lección de la 210, y aquí se ve funcionando.

**Regalo de la mutación:** P22 envenenado da **2,89** — que es EXACTAMENTE lo que la 208
midió en su día para `Button destructive` dentro de la hoja fijada a claro. No es
casualidad: el envenenamiento reproduce el estado antiguo (tokens claros + variante
`dark:` disparando), así que ese 2,89 es una medición real del ANTES. Sirve como prueba
de que la 217 **no empeora** esa deuda: 2,89 antes → **4,43** hoy en pantalla oscura.

Restaurado con `git checkout` de los dos archivos · `git status` limpio · las dos
guardias verdes otra vez (50 tests).

---

## Tanda 4 — La prosa y la guardia que congelaba lo contrario (T17, T18)

*(T16 se cerró en la Tanda 2; ver la nota de reordenado de allí.)*

### T17 · `app/globals.css`

**(a) La viñeta 2 y el párrafo «LÍMITE MEDIDO».** `.tema-claro` pasa de tener **tres**
consumidores a **dos** (la landing y la elección «claro» del portal). La factura no se
borra de la prosa sin más: queda un párrafo que dice **que estuvo y por qué se fue**, con
la fecha del pedido humano. Un consumidor que desaparece en silencio manda al siguiente
lector a buscar un olvido que no existe. El párrafo «LÍMITE MEDIDO» conserva el límite
—fija tokens, no apaga `dark:`— porque sigue siendo cierto para los dos consumidores que
quedan; lo que se quita es la tabla de números que se midió **dentro de la hoja**, que ya
no describe nada, y se remite la deuda a las fichas 210/216.

**(b) El límite declarado junto al bloque de impresión (R15).** Quien lea la regla
encuentra ahí mismo, sin abrir el spec: que **no apaga** el variant `dark:` y por qué se
acepta —el resultado impreso es el que la hoja ya mostraba antes de la 217, con el número
del peor caso: 2,89 entonces / 4,43 hoy—; que el arreglo de raíz sale a **ficha propia**,
con sus tres razones; y **qué NO cubre** la impresión (sin botón, sin `@page`, y desde el
modal se arrastra el resto de la página).

### T18 · `tema-encendido.guardia.test.ts` — reexpresado, no relajado

El título decía «`.tema-claro` sigue fijando los valores claros (la landing y **la
factura** dependen de ello)». Desde esta feature esa frase afirma algo falso. El título
nuevo nombra a los **consumidores reales**, verificados abriendo los dos archivos:

- `app/page.tsx:50` — `className="tema-claro min-h-dvh …"`
- `lib/tema/tema.ts:64` — `return "tema-claro";`

**Ni una aserción cambió**: el cuerpo comprueba la definición de la clase en el CSS y eso
sigue siendo válido y sigue haciendo falta. Ningún caso borrado, ninguna aserción
debilitada.

### Cierre de tanda 4 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files 17 passed (17)     Tests   311 passed (311)
-> test:guardias       Test Files 96 passed (96)     Tests  1355 passed (1355)
== init OK ==
```

---

## Tanda 5 — Cerrar (T19, T20, T21, T22, T23)

### Los cinco requisitos que no tenían dueño ejecutable

Al montar el mapa `R → test` aparecieron **cinco** requisitos cuya única evidencia iba a
ser «el diff lo demuestra» o «está escrito en la prosa». Eso no es verificación: nadie se
entera el día que deja de ser cierto. Se les dio un test:

| R | Antes | Ahora |
| --- | --- | --- |
| **R4** | «los dos azules están muy por encima de AA» (razonado) | se **mide**: `--foreground` sobre el papel no puede dar menos que el `--color-navy` al que sustituye. Medido: navy **15,39** → foreground **15,70**. El cambio de tono es visible y **no cuesta contraste** |
| **R15** | la declaración del límite, en prosa | el comentario que precede a la regla de impresión **tiene que** nombrar el variant `dark:` |
| **R19** | la viñeta reescrita a mano | el comentario de `.tema-claro` no puede volver a listar la factura como consumidora |
| **R20** | el título reexpresado | vigilado por sus **dos** mitades: que no vuelva a atar la factura a la clase **y que no desaparezca** |
| **R22** | `git diff --name-only` | ejecutable: la hoja no importa servicios ni repositorios, no hace `fetch`, no nombra `prisma`, y sus **tres contratos de entrada** siguen exportándose con el mismo nombre |

### T20 · Bitácora de mutaciones — **18 aplicadas, 18 vistas rojas**

`design.md §6.7` pedía diez. Salieron dieciocho porque los cinco dueños nuevos también
necesitaban la suya (R24: una guardia que nadie vio morder no es evidencia).

Todas con `git diff` comprobado **antes** de correr el gate: una mutación que no se
aplicó y un arreglo que funciona se leen igual de verdes.

| # | Mutación | Guardia que se puso roja | Casos |
| --- | --- | --- | --- |
| 1 | **`@media print` detrás de `.dark` + T3 revertida** — *la obligatoria* | inventario de pares + la guardia de la 210 | **10** |
| 2 | devolver `tema-claro` a UNA de las dos hojas | censo de fuente + jsdom | 4 |
| 3 | devolver UN `text-navy` | censo de fuente | 2 |
| 4 | devolver el `/80` al `-strong` | censo de fuente | 1 |
| 5 | meter un `bg-white` en la hoja | censo (lista negra) | 1 |
| 6 | pintar un texto con un par no listado (`text-info-strong`) | **el CIERRE del inventario** | 1 |
| 7 | borrar el bloque `@media print` entero | espejo / ancestro / tinta | 3 |
| 8 | cambiar UN hex dentro del bloque (`--card: #fefefe`) | espejo `toEqual` | 1 |
| 9 | quitar el `@media print` dejando la regla suelta | ancestro | 1 |
| 10 | empeorar `--foreground` oscuro **en las dos declaraciones** | umbral **y** suelo | 5 |
| 11 | degradar `--foreground` claro por debajo del navy | R4 + suelos | 6 |
| 12 | romper la fórmula compartida (`+ 0.05` → `- 0.05`) | **el primer autocontrol de la 210** | 1 (y arrastra 8) |
| ~~13~~ | ~~borrar la declaración del límite `dark:` junto al bloque~~ | ~~R15~~ | **FALSA — ver la corrección abajo** |
| 14 | volver a listar la factura como consumidora de `.tema-claro` | R19 | 1 |
| 15 | **borrar** el caso de `.tema-claro` (relajar por borrado) | R20 | 1 |
| 16 | devolver «la factura» al título reexpresado | R20 | 1 |
| 17 | la hoja importa un servicio (`@/lib/services/…`) | R22 | 1 |
| 18 | empeorar `--foreground` oscuro **sólo en `.dark`** | *(ver abajo)* | 1 |

#### Dos hallazgos que sólo aparecieron al mutar

**(a) La mutación obligatoria mal colocada sale VERDE.** Poner el bloque `@media print`
justo después de `.dark` **no envenena nada**: el bloque `@media (prefers-color-scheme:
dark)` que viene a continuación vuelve a declarar todos los tokens y, como gana el
último, el veneno no llega. Hay que ponerlo **después de los dos** —que es, además, donde
uno añade cosas al final de un archivo—. Con la mutación mal colocada yo habría concluido
que la medida de T3 no servía para nada. *(Documentado arriba, en la sección de T15.)*

**(b) Mutación 18: empeorar `--foreground` sólo en `.dark` NO lo caza la guardia de
contraste.** Por lo mismo: el lector se queda con la última declaración, que es la del
bloque espejo. Quien lo caza es la guardia de la 211 («sistema toma EXACTAMENTE los
mismos tokens que oscuro»). Es correcto y conviene saberlo: **las dos guardias se cubren
los flancos**, ninguna sola habría bastado. Una regresión real de tokens tiene que pasar
por las dos.

#### Y un número que la mutación regaló

Envenenado, P22 (`Button` variant `destructive`) da **2,89** — que es EXACTAMENTE lo que
la 208 midió en su día para esa variante dentro de la hoja fijada a claro. No es
casualidad: el envenenamiento reproduce el estado antiguo (tokens claros + variante
`dark:` disparando). Sirve como medición del **antes**, y con ella se puede afirmar que
esta feature **no empeora** esa deuda: **2,89 antes → 4,43 hoy** en pantalla oscura.

### T21 · Frontera

`git diff --name-only` de mis commits (`804b6b05..HEAD`):

```
app/(app)/cierres-admin/_components/cierre-factura.tsx
app/globals.css
progress/impl_217.md
tests/components/CierreFacturaPapel.test.tsx
tests/fixtures/contraste.ts
tests/unit/guards/contraste-tokens.guardia.test.ts
tests/unit/guards/factura-contraste.guardia.test.ts
tests/unit/guards/tema-encendido.guardia.test.ts
```

Ocho archivos, **exactamente** el inventario de `design.md §0`. Cero `db/`, cero `lib/`,
cero `app/api/`, cero `components/ui/` — comprobado con un `grep` sobre el listado.
`feature_list.json` **no se tocó**: el bookkeeping es del leader.

**Los tests preexistentes de la factura, verdes SIN modificar** (R23):

```
pnpm exec vitest run tests/components/{CierreDetallePagos,CierresAdminModule,
  CierreDiaModule,CierresAdminPagoMensajero,CierreDetalleIncidente,
  CierresAdminIndemnizacion,CierresAdminDeepLink}.test.tsx

 Test Files  7 passed (7)
      Tests  180 passed (180)
```

Ninguno aparece en el `git diff --name-only`. Localizan la factura por sus nombres
accesibles y siguen encontrándola: R23 se cumple porque **no hizo falta tocarlos**.

### T19 · Lo que queda fuera, declarado con ancla y número fechado (2026-08-13)

*(La tabla completa está en la Tanda 3. Aquí, el resumen y a quién le toca.)*

- **R17 — preexistente, ajeno al pin y a R8:** el aviso «sin tarifa congelada»
  (`cierre-detalle-shared.tsx:651`, `text-destructive`) mide **3,76** en claro y **5,89**
  en oscuro. Vive en un componente COMPARTIDO con las tablas del detalle. Declarado como
  **P20**, con suelo. **No corregido**: un parche local lo dejaría roto en las demás
  vistas que montan ese componente.
- **R18 — variantes de primitiva bajo AA dentro de la hoja:** `Button` `default` (P21)
  **3,18** claro / 7,06 oscuro, y `Button` `destructive` (P22) **3,29** claro / **4,43**
  oscuro. Ambas de `components/ui/button.tsx`, que **no se tocó**.
- **Lo que NO queda verificado**, y se dice por delante: el resultado impreso real
  (ninguna pieza del gate renderiza en papel — la verificación es **estructural**), la
  composición en ejecución de las primitivas, y «que la hoja se vea bien». Ninguna de las
  cuatro piezas lo afirma.

### T22 · Mapa `R → test` — los 26 con dueño

| R | Test que lo cubre |
| --- | --- |
| **R1** | `factura-contraste` › «la hoja ya no se fija a tema claro, y ninguna prosa dice que lo haga (R1, R19)» · `CierreFacturaPapel` › «la hoja del DETALLE ya no fija su subárbol a tema claro» y «la hoja COMPACTA tampoco» |
| **R2** | `factura-contraste` › «cero tinta de valor fijo: ni un `text-navy`, ni un `border-navy` (R2)» y «ninguna utilidad de color de valor fijo (R2, R3)» |
| **R3** | `factura-contraste` › «el indicador de la pestaña activa usa un token que gira, no el de marca (R3)» · `CierreFacturaPapel` › «la pestaña seleccionada se marca con `border-foreground` y `text-foreground`» · inventario P1 y P12 |
| **R4** | `factura-contraste` › «R4: en tema claro el tono nuevo no tiene menos contraste que el navy que sustituye» · inventario P1 en claro |
| **R5** | los **7 archivos** de tests de componente preexistentes de cierres/factura, verdes **sin modificar** (180 tests) · el diff de T8: 18 líneas y cada par difiere sólo en el token de color |
| **R6** | `factura-contraste` › «P1…P14, P19 cumple su umbral y su suelo en los DOS temas» — 15 casos × 2 temas, con las capas compuestas |
| **R7** | `factura-contraste` › «CIERRE: toda utilidad de color de la hoja mapea a un par del inventario (R7)», «ningún par del inventario quedó obsoleto (R7)», «cada par medible tiene su suelo anotado» + el suelo dentro de cada caso |
| **R8** | `factura-contraste` › «ninguna opacidad sobre un token `-strong` (R8)» · inventario P9 |
| **R9** | `tema-encendido` › «hay UNA regla `.papel-al-imprimir` y vive dentro de `@media print`» · `factura-contraste` › «las DOS hojas llevan `papel-al-imprimir`, una por `<Card>` (R9)» · `CierreFacturaPapel` › los dos casos de la clase |
| **R10** | `tema-encendido` › «fija la TINTA y no solo la superficie (si no, en papel sale blanco sobre blanco)» |
| **R11** | `tema-encendido` › «NO fuerza la impresion de fondos: nada de `print-color-adjust`» · `factura-contraste` › «no fuerza la impresión de fondos ni añade un flujo de impresión (R11, R14)» |
| **R12** | `tema-encendido` › «declara los MISMOS tokens y los MISMOS valores que el tema claro, hex a hex» (`toEqual`, claves y valores) |
| **R13** | `tema-encendido` › «hay UNA regla … dentro de `@media print`» + los **4 casos de la 211** (`.dark`, `.tema-sistema`, `body:has`, el variant) verdes **sin tocarse** |
| **R14** | `factura-contraste` › «no fuerza la impresión de fondos ni añade un flujo de impresión (R11, R14)» — cero `window.print`, cero rótulo «Imprimir» |
| **R15** | `tema-encendido` › «el variant `dark:` dispara por CLASE y tambien por preferencia del sistema» (intacto) y «junto a la regla de impresion queda escrito su limite: no apaga el variant `dark:` (R15)» |
| **R16** | `factura-contraste` › «los exentos están en la lista, MARCADOS, y con su motivo escrito» (P15-P18) + la excepción `brand` escrita con su motivo en el código de la guardia |
| **R17** | `factura-contraste` › «la deuda AJENA que hoy queda bajo AA dentro de la hoja está NOMBRADA (R17, R18)» y «P20 es deuda declarada (R17): no se exige el umbral, pero NO puede empeorar» |
| **R18** | los mismos + «P21…P25 es deuda declarada» · T21: `git diff --name-only` sin `components/ui/` |
| **R19** | `factura-contraste` › «la hoja ya no se fija a tema claro, y ninguna prosa dice que lo haga (R1, R19)» y «ninguna guardia sigue afirmando que la factura depende de `.tema-claro` (R19, R20)» · `tema-encendido` › «la prosa de `.tema-claro` ya no lista la factura entre sus consumidores (R19)» |
| **R20** | `factura-contraste` › «ninguna guardia sigue afirmando que la factura depende de `.tema-claro` (R19, R20)» — vigila que no vuelva a mentir **y** que no se borre · el caso reexpresado en `tema-encendido` |
| **R21** | `tema-encendido` › «`.tema-claro` sigue fijando los valores claros (la landing … y la eleccion «claro» del portal …)» y «sistema toma EXACTAMENTE los mismos tokens que oscuro» |
| **R22** | `factura-contraste` › «la hoja sigue siendo presentación pura: ni servidor, ni datos, ni contratos nuevos (R22)» · T21 |
| **R23** | los 7 archivos preexistentes, verdes **sin modificar** · `CierreFacturaPapel`, que localiza las hojas por `role="region"` + `aria-label` y **nunca** por clase |
| **R24** | esta bitácora: **18 mutaciones, 18 rojas**, con la de `@media print` detrás de `.dark` como obligatoria |
| **R25** | `factura-contraste` › «ningún otro archivo de `tests/` tiene una segunda copia de la fórmula de contraste» y «el censo lee de verdad el árbol de `tests/` y encuentra la copia canónica» · la guardia de la 210 importando del fixture |
| **R26** | `contraste-tokens.guardia.test.ts` › los **tres autocontroles**, ahora sobre la copia compartida · `factura-contraste` › «ninguna verificación de `tests/` se apoya en el detector de `.claude/skills`» |

**26 de 26.** Ninguna fila «pendiente».

### T23 · Lo que sale a ficha aparte

1. **Apagar el variant `dark:` al imprimir en toda la app** — **ya está dada de alta: es
   la ficha 221**, que nació de la puerta de ésta. No hace falta abrir otra.
2. **Un flujo de impresión de la factura** (`@page`, ocultar el resto de la interfaz,
   paginar los renglones, y decidir si se imprime desde el modal o desde una vista
   propia). **No existe ficha.** Esta feature garantiza el color, no el formato (D8), y
   desde el modal la hoja se imprimiría recortada por el `overflow-y-auto`.
3. **Hallazgo que no tiene dueño:** `Button` variant `destructive` mide **3,29** en claro
   y **4,43** en oscuro (`button.tsx:24`). La **210** está `done` y sólo arregló el
   `Badge` —lo mandó al par de `danger`—; la **216** trata el naranja de marca, que es
   otro par. Así que esta variante está **bajo AA y sin ficha que la reclame**. No entra
   aquí (R18 lo prohíbe expresamente), pero queda medida, atornillada por su suelo, y
   señalada.

### Cierre de tanda 5 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files 17 passed (17)     Tests   316 passed (316)
-> test:guardias       Test Files 96 passed (96)     Tests  1360 passed (1360)
== init OK ==
```

`./init.sh` completo: **lo corre el leader antes del PR** (así se acordó en el encargo).

---

## CORRECCIÓN tras el rechazo del reviewer (2026-08-13)

`progress/review_217.md` **RECHAZÓ** la ficha. Tenía razón en los dos bloqueantes y en los
siete menores. Esto es lo que se corrigió, empezando por lo que más duele.

### La fila 13 de la tabla de mutaciones era FALSA

**Lo reporté como visto rojo y no podía serlo.** El caso de R15
(`tema-encendido.guardia.test.ts`) anclaba así:

```js
const donde = crudo.indexOf("@media print");
const comentarioDeArriba = crudo.slice(Math.max(0, donde - 3000), donde);
expect(comentarioDeArriba).toMatch(/`dark:`/);
```

`indexOf("@media print")` **no cae en la regla**. El primer literal está en
`app/globals.css:134`, dentro de la **prosa** del comentario de `.tema-claro` («…con la
regla `@media print` de aquí abajo»); la regla real vive 120 líneas más abajo. La ventana
de 3000 caracteres inspeccionaba otro comentario, y el `` `dark:` `` que la satisfacía era
prosa de la **feature 211**. Comprobado ahora, sobre el árbol real:

```
indexOf("@media print")   = 5635  → línea 134   (prosa)
indexOf("@media print {") = 12132 → línea 254   (la regla)
```

El reviewer lo demostró borrando el comentario **entero** de la regla (57 líneas) y viendo
el caso seguir **verde**. Yo, cuando «corrí la mutación 13», borré un párrafo de ese
comentario y vi un rojo… que era el mismo caso fallando por otra razón dentro de mi
sesión, no por lo que la fila afirmaba. **La fila queda tachada arriba y sustituida por
las dos de abajo, medidas después del arreglo.**

Es **exactamente el fallo que la feature 209 vino a cerrar**: leer prosa como si fuera
código. Y es la segunda vez que me muerde en esta misma ficha —la primera fue el censo
que se denunciaba a sí mismo, en la Tanda 0— con la diferencia de que aquella la vi yo y
ésta la vio el reviewer. La lección no es «usar el quitador»: es que **la localización por
`indexOf` de un literal que también aparece en prosa es un falso positivo silencioso**, y
que un caso que no se ve morder con la mutación que dice cubrir no vale nada.

**El arreglo** usa el quitador compartido para localizar la **regla** en el código, y se
apoya en algo que ese quitador garantiza y que aquí es justo lo que hace falta:
**conserva los saltos de línea**, así que el número de línea de la regla en el código es
el mismo que en el archivo crudo. Con eso se vuelve al crudo y se lee el comentario que
la regla tiene **pegado encima** —el bloque `/* … */` inmediatamente anterior, sin código
en medio—. Si no hay comentario pegado, o si no nombra el variant, es rojo.

### Mutación 13, ahora de verdad — **ROJA en sus dos variantes**

| Variante | Antes del arreglo | Después |
| --- | --- | --- |
| **13a** — borrar el párrafo «LO QUE ESTA REGLA **NO** APAGA» (19 líneas) | *(no medido con rigor)* | **ROJA** · 1 caso |
| **13b** — borrar el comentario **entero** de la regla (57 líneas) — *el escenario con el que el reviewer probó que el caso era hueco* | **VERDE** | **ROJA** · 1 caso |

```
### 13b: borrar el comentario ENTERO de la regla
 app/globals.css | 57 ---------------------------------------------------------
× junto a la regla de impresion queda escrito su limite: no apaga el variant `dark:` (R15)
AssertionError: la regla de impresion no lleva un comentario pegado encima. R15 pide que
su limite este declarado JUNTO a ella, no en `specs/`: quien lee la regla tiene que
encontrarlo ahi.: expected '}' to be '*/'
      Tests  1 failed | 15 passed (16)
```

### Las ocho mutaciones nuevas — todas rojas

| # | Mutación | Caso que se pone rojo | Casos |
| --- | --- | --- | --- |
| 13a | borrar el párrafo del límite `dark:` del comentario de la regla | R15 | 1 |
| 13b | borrar el comentario **entero** de la regla | R15 | 1 |
| 19 | `quitarBloquesDeImpresion` convertido en no-op (`return css;`) | la trampa del lector, defensa 1 | 1 |
| 20 | mover el bloque de impresión detrás de `.dark` | la trampa del lector, **defensa 2** (+ R15) | 2 |
| 21 | colar un `@page { margin: 1cm; }` en el CSS | R14 (mitad CSS) | 1 |
| 22 | relistar la factura como consumidora **sin escribir la ruta** | R19 (mitad CSS) | 1 |
| 23 | degradar `--danger-strong` claro | P11 + **P26** + la lista de deuda ajena | 3 |
| 24 | estrenar una superficie (`bg-primary` en el cuerpo de la hoja) | el cierre por utilidad **y** el cierre por fondos | 2 |
| 25 | mover un espaciado (`p-5` → `p-6`) | **R5** | 1 |

**Total de la ficha: 26 mutaciones aplicadas, 26 vistas rojas** — con la fila 13 original
retirada por falsa.

### Los siete menores, cerrados

**1. El par de `Badge` variant `destructive` entra al inventario — P26.** Lo pinta
`EstadoCierreBadge` para `rechazado` y `vencido`, en las **dos** hojas. Medido ahora:
**5,30 claro · 5,20 oscuro** — y son, a la centésima, los dos números que la 210 dejó
escritos en `badge.tsx`. Con eso son **once** las coincidencias contra mediciones ajenas.
Entra como `ajeno` con suelo, remitiendo a la guardia de la 210 para el umbral: duplicar
el criterio en dos sitios es cómo se desincronizan. La razón de que entre es R16 tal cual:
un par que no está en la lista y un par que nadie miró se leen igual.

**2. El CIERRE cierra por UTILIDAD, no por PAR — y ahora lo dice.** El reviewer tiene
razón: mover un `text-muted-foreground` (declarado) dentro de un `bg-success/15`
(declarado) crea un par que nadie midió y pasaba verde. **Elegí corregir la afirmación, no
el mecanismo**, y el motivo es el de toda la ficha: cerrar por par exige resolver el fondo
efectivo de cada texto recorriendo el árbol JSX y decidiendo de qué ancestro hereda cada
nodo. Eso es exactamente la clase de análisis que produce respuestas plausibles y falsas,
y **un cierre por par que se equivoque al resolver el fondo es PEOR que éste, porque
aprueba con un número**. Lo que sí se añadió, porque sí se puede cerrar del todo, es el
**cierre por FONDOS**: son siete, se enumeran, y estrenar una superficie es rojo. Con los
dos, lo único que escapa es la recombinación de tinta y fondo ya declarados — dicho así,
sin adorno, en el propio caso.

> **Queda una frase que no me corresponde tocar:** `design.md §6.3` dice «si mañana alguien
> pinta un texto de la hoja con una pareja que nadie listó, lo caza el cierre». Con el
> mecanismo real eso sólo es cierto si la tinta **o** el fondo son nuevos. El spec está
> aprobado y no lo edito; queda señalado para el leader.

**3. Las dos defensas contra la trampa del lector, ahora vigiladas por separado.** El
reviewer dio en el clavo: `quitarBloquesDeImpresion` es hoy un **no-op sobre el archivo
real** —el bloque está antes de `.dark`, así que no hay nada que quitar— y ningún caso
exigía que siguiera ahí. Los dos tirantes se podían retirar de uno en uno sin que el gate
dijera nada; sólo fallaban juntos. Ahora: la defensa 1 tiene un caso sobre un **CSS de
laboratorio** que sí reproduce la trampa (bloque de impresión al final, que es donde uno
añade cosas) y comprueba las dos mitades —que sin la pasada el último `--card` de la mitad
«oscuro» es `#ffffff`, y que con ella vuelve a ser `#10203a`—; la defensa 2 tiene su caso
de **orden** en `tema-encendido`.

**4. R4 se mide sobre los CUATRO fondos** en los que viven los dieciséis sitios migrados
(`card`, `muted` opaco, `muted/40`, `muted/50`), no sólo sobre el papel. El argumento
monotónico del reviewer es correcto —`#12233f` tiene menos luminancia que `#0b2545`— pero
un argumento que hay que reconstruir de memoria no es una verificación, y medir los cuatro
cuesta cuatro líneas. El porqué queda escrito en el caso, que era lo que se pedía.

**5. La mitad CSS de R19 busca la PALABRA, no la ruta.** Contar `cierre-factura` dejaba
pasar un «2. Las dos hojas de la factura del cierre»: la lista de consumidores no se
escribe con rutas de archivo, se escribe en prosa. Mutación 22: roja.

**6. R14 censa `@page`** en `app/globals.css`. El censo del `.tsx` cazaba el botón y
`window.print`, pero el formato de página se añade por CSS y por ahí no pasaba nadie.

**7. R5 estrena dueño ejecutable:** la foto congelada de las **83 utilidades no
cromáticas** de la hoja —tipografía, pesos, espaciados, anchos y estilos de borde, radios,
interlineado—. El color no aparece en esa lista, así que la 217 entera es invisible para
ella, que es lo que la hace un dueño honesto de «no rediseñes». Es una foto, como los
suelos: el día que haya que cambiar el layout de verdad, se actualiza a mano y ese rojo es
el momento de revisión que R5 quiere provocar.

### `tasks.md`: las 23 marcadas

Con una nota al principio del archivo sobre las dos que no salieron como el plan decía:
T16 se adelantó a la Tanda 2 (T10 no podía estar verde antes), y **T20 se dio por hecha
una vez sin estarlo** — la fila 13.

### Mapa `R → test`: filas corregidas

| R | Dueño, corregido |
| --- | --- |
| **R4** | `factura-contraste` › «R4: en tema claro el tono nuevo no tiene menos contraste que el navy que sustituye» — ahora sobre **los cuatro fondos** de los sitios migrados |
| **R5** | `factura-contraste` › «el resto de la hoja no se rediseña: tamaños, pesos, espaciados y bordes intactos (R5)» — dueño ejecutable propio, ya no sólo el diff |
| **R7** | + `factura-contraste` › «CIERRE: la hoja no estrena superficies — los fondos son exactamente los medidos (R7)» |
| **R14** | + `tema-encendido` › «no se cuela un flujo de impresion por el CSS: nada de `@page` (R14)» |
| **R15** | `tema-encendido` › «junto a la regla de impresion queda escrito su limite…» — **reanclado a la regla**, visto rojo en sus dos variantes |
| **R16** | + P26 en el inventario, medido y con suelo |
| **R19** | la mitad CSS busca la palabra «factura», no la ruta |
| **R25** | + `factura-contraste` › «`quitarBloquesDeImpresion` desactiva la trampa del lector aunque el bloque quede al final» |

### Gate tras la corrección — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files 17 passed (17)     Tests   322 passed (322)
-> test:guardias       Test Files 96 passed (96)     Tests  1366 passed (1366)
== init OK ==
```
