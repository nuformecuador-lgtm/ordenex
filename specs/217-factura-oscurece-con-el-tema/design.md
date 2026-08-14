# Feature 217 — Diseño

Decisiones técnicas de «la factura del cierre oscurece con el tema». Cubre R1-R26 de
`requirements.md`.

> **Versión 2 — 2026-08-13, después de la puerta humana.** Las cinco preguntas
> abiertas están cerradas (D5-D9) y **plegadas al articulado**. El cambio más profundo
> respecto de la versión 1 es **D9**: la verificación de legibilidad **deja de
> apoyarse en un barrido de navegador** y pasa a apoyarse en un **inventario cerrado de
> pares (tinta, fondo)** medido con la aritmética que este repo ya tiene commiteada.

## 0. Qué NO aplica de la plantilla, y por qué

`docs/specs.md` pide modelo de datos, endpoints, contratos I/O e integraciones. Aquí
**no hay ninguno de los cuatro**, y se declara en vez de omitirse:

| Sección | Estado |
| --- | --- |
| Tablas, RLS, migraciones | **No aplica.** R22 lo prohíbe: `db/schema.prisma` y `db/migrations/` no se tocan. Esta feature no lee ni escribe un solo dato. |
| Rutas / endpoints | **No aplica.** Ninguna ruta nueva, ningún route handler, ninguna Server Action. |
| Contratos de entrada/salida | **No cambian.** `CierreFacturaResumenProps` (`cierre-factura.tsx:389`), `CierreFacturaCabecera` (`:689`) y `CierreFacturaDetalleProps` (`:723`) quedan idénticos. |
| Integraciones externas | **Ninguna.** |

Lo que sí hay: **presentación**, **CSS global**, una regla de medio (`@media print`)
que no existía en el repo, y **un instrumento de medida que pasa a ser compartido**.

### Archivos que se tocan (inventario cerrado)

| Archivo | Qué le pasa | Requisitos |
| --- | --- | --- |
| `tests/fixtures/contraste.ts` **(nuevo)** | La aritmética de contraste y el lector de tokens, extraídos y exportados | R25, R26 |
| `tests/unit/guards/contraste-tokens.guardia.test.ts` | Pasa a **consumir** el fixture; conserva sus tres autocontroles; **+ arreglo del lector** ante `@media print` (§6.2) | R25, R26 |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | Quitar los 2 pines, migrar las 16 utilidades fijas, quitar el `/80` de `:818`, estampar la clase de impresión, reescribir el bloque `:73-128` | R1-R5, R8, R9, R19 |
| `app/globals.css` | Bloque `@media print` nuevo; actualizar la viñeta 2 de `:121-127` y el párrafo «LÍMITE MEDIDO» `:139-147` | R9-R13, R15, R19, R21 |
| `tests/unit/guards/tema-encendido.guardia.test.ts` | Reexpresar el caso `:162` + casos del bloque de impresión (espejo, ancestro, ausencia de `print-color-adjust`) | R12, R13, R20, R21 |
| `tests/unit/guards/factura-contraste.guardia.test.ts` **(nueva)** | El **inventario cerrado de pares** + el censo de fuente de la factura | R2, R3, R6, R7, R8, R11, R14, R16, R19 |
| `tests/components/…` (componente de la factura) | Casos de clases estampadas en las dos hojas | R1, R3, R9 |
| `progress/impl_217.md` **(nuevo)** | Inventario con sus números fechados, mapa R→test, bitácora de mutaciones | R7, R17, R18, R24 |

**`progress/impl_208_modo-oscuro.md` NO se edita.** Es una foto de lo que era cierto
ese día, igual que un `down.sql`.

---

## 1. La forma del cambio, en una frase

Hoy la hoja **se aísla del tema** (fija los tokens claros en su subárbol). Después la
hoja **no se aísla de nada** (hereda los tokens vigentes) **excepto cuando el medio es
papel**, donde vuelve a fijar los mismos valores claros. El aislamiento no desaparece:
**cambia de condición**, de «siempre» a «sólo al imprimir». Eso permite reusar el
mecanismo que ya existe y está probado —fijar tokens en un subárbol por clase— en vez
de inventar uno.

---

## 2. Los 16 sitio a sitio (R3)

**No son todos el mismo papel semántico**, y por eso la tabla es sitio a sitio. Lo que
sí ocurre es que **quince de los dieciséis convergen en el mismo token**, y eso es una
conclusión, no un atajo: el navy era, en todos ellos, «el color del texto principal de
la hoja», que es exactamente lo que `--foreground` significa. El decimosexto (el
borde) toma el mismo token en su forma de borde.

| # | Ancla | Pieza | Papel semántico | Fondo real | Token destino |
| --- | --- | --- | --- | --- | --- |
| 1 | `:197` | `Renglon` (label, `emphasis`) | rótulo **enfatizado** de un renglón de liquidación | `bg-card` | `text-foreground` |
| 2 | `:212` | `Renglon` (value, `emphasis`) | importe enfatizado del renglón | `bg-card` | `text-foreground` |
| 3 | `:253` | `KpiFactura` (value) | cifra del KPI; el contador animado hereda de este span | `bg-muted/40` sobre `bg-card` | `text-foreground` |
| 4 | `:275` | `ParPagoIngreso` (pago al mensajero) | importe destacado en caja de borde punteado | `bg-card` (la caja no tiene fondo propio) | `text-foreground` |
| 5 | `:283` | `ParPagoIngreso` (ingreso de bodega) | idem, la otra cara del mismo movimiento | `bg-card` | `text-foreground` |
| 6 | `:352` | `LineaMonto` (monto ≠ 0) | importe de una línea del desplegable compacto | `bg-muted/50` | `text-foreground` |
| 7 | `:384` | `LineaFecha` (value) | **dato** (fecha) frente a su rótulo apagado | `bg-muted/50` | `text-foreground` |
| 8 | `:512` | `HojaResumen` (título) | **TITULAR** del comprobante compacto | `bg-card` | `text-foreground` |
| 9 | `:567` | `HojaResumen` (total general) | cifra mayor de la tarjeta | `bg-card` | `text-foreground` |
| 10 | `:671` | `CierreBodegaFacturaResumen` (cantidad de cierres) | dato **realzado dentro de prosa apagada** | `bg-card` | `text-foreground` |
| 11 | `:809` | `TarjetaTotal` (value, rama **no** éxito) | cifra de la tarjeta de totales | `bg-muted` (opaco) | `text-foreground` |
| 12 | `:854` | `TabResultado` activo — `border-navy` | **INDICADOR de selección** (borde inferior) | `bg-card` | `border-foreground` |
| 13 | `:854` | `TabResultado` activo — `text-navy` | etiqueta de la pestaña activa | `bg-card` | `text-foreground` |
| 14 | `:924` | `FilaGestion` (número de guía) | **identificador** de la fila | `bg-card`; en hover `bg-muted/50` | `text-foreground` |
| 15 | `:1098` | `CierreFacturaDetalle` (título) | **TITULAR** del comprobante detallado | `bg-card` | `text-foreground` |
| 16 | `:1317` | pie (recaudado) | dato realzado dentro de prosa apagada | `bg-muted/50` | `text-foreground` |

### Las cuatro decisiones que la tabla esconde

**(a) `text-foreground` y no `text-card-foreground`.** Los dos tokens valen **lo
mismo** en los tres bloques: `#12233f` en claro (`globals.css:153,155`) y `#e6ecf8` en
oscuro (`:213,215` y `:273,275`). La elección es de **consistencia**, no de contraste:
el archivo ya usa `text-foreground` para su realce en `:576`, `:882`, `:928`, y el
propio comentario de cabecera lo recomendaba (`:127`). Lo que se mide es **el par
real** (`foreground` sobre `card`), así que si algún día los dos tokens divergen, la
guardia lo dice sin depender de esta decisión.

**(b) El indicador de la pestaña NO va a `border-primary`.** Sería la elección
«natural» —un indicador de selección quiere el color de acento— y es **exactamente el
color que la ficha 216 tiene abierto**: `--primary` es el naranja `#f26419`, medido en
3,18 sobre blanco, que **cumple el 3:1 de componente pero no el 4,5:1 de texto**. Como
en `:854` el mismo condicional pinta **borde y texto a la vez**, usar `primary` metería
una violación nueva de texto normal. `border-foreground` + `text-foreground` mantiene
los dos por encima del umbral y no ata la hoja a una decisión de marca en revisión.

**(c) Ninguno pasa a un `-strong`.** Los cuatro `-strong` son **semánticos**: dicen
«esto salió bien / esto es un problema». Un titular o un importe neutro no tiene
semántica de estado, y teñirlo de verde o ámbar sería inventar información. Donde la
hoja **sí** quiere semántica ya la usa (`:800`, `:809` rama éxito, `:936`).

**(d) *(D5, nuevo en v2)* La nota de «Ingreso bruto» pierde el `/80` — R8.**
`cierre-factura.tsx:818` pinta `text-success-strong/80`. Un `-strong` existe
precisamente para garantizar 4,5:1; aplicarle una opacidad **anula la garantía por la
que se eligió el token**, y por eso ese texto mide 3,36 en los dos temas. Entra por
decisión humana (cuesta un carácter y es el único fallo propio vivo de la hoja) y por
un motivo de método que conviene no perder: **un `-strong` con alpha no es medible con
el inventario de §6.3** sin inventarle un caso especial de doble composición cuyo único
consumidor sería esa nota. Quitándolo, la hoja entera queda cubierta por pares
ordinarios. **Entrar en el alcance es también lo que la hace verificable.**

### Lo que cambia en tema CLARO, dicho antes de que se note (R4)

`--color-navy` es `#0b2545` (`globals.css:84`); `--foreground` claro es `#12233f`
(`:153`). **No son el mismo azul**: la hoja, en tema claro, pasa a un navy
ligerísimamente más frío. Los dos están muy por encima de AA sobre papel blanco, así
que **no hay regresión de contraste**, pero **hay un cambio visible** y va escrito aquí
para que nadie lo reporte como bug.

---

## 3. La superficie oscura no hay que construirla

`Card` ya pinta `bg-card text-card-foreground ring-1 ring-foreground/10`
(`components/ui/card.tsx:15`). Al quitar el pin, la hoja hereda:

| Token | Claro | Oscuro |
| --- | --- | --- |
| `--card` (el papel) | `#ffffff` | `#10203a` |
| `--card-foreground` / `--foreground` (la tinta) | `#12233f` | `#e6ecf8` |
| `--border` | `#e3e8f2` | `#22345a` |
| `--muted` (paneles y pie) | `#f1f4fb` | `#16294a` |
| `--muted-foreground` | `#4a5368` | `#9fadc9` |

«En oscuro la hoja es una superficie oscura legible» se cumple **sin añadir una sola
clase de fondo**. Lo único roto era la tinta fija, y eso es §2.

---

## 4. El `@media print`: dónde vive, qué declara y qué NO

### 4.1 La decisión *(D6: acotada a las dos hojas)*

**Una clase propia, `papel-al-imprimir`, estampada en los dos `<Card>` (donde hoy está
`tema-claro`), y un bloque `@media print` en `app/globals.css` que declara dentro de
esa clase EXACTAMENTE los mismos tokens que `:root, .tema-claro`.**

```css
/* Feature 217 — AL IMPRIMIR, EL PAPEL ES CLARO.  (esquema; el bloque real copia
   TODAS las declaraciones de `:root, .tema-claro`, sin excepción — R12) */
@media print {
  .papel-al-imprimir {
    --radius: 0.625rem;
    --background: #f7f8fc;
    --foreground: #12233f;
    --card: #ffffff;
    --card-foreground: #12233f;
    /* … el bloque COMPLETO, incluidos los cuatro `-strong` … */
  }
}
```

**Acotada a las hojas, no global (D6):** no se toca `.dark`, no se toca
`.tema-sistema`, no se toca `@custom-variant dark`, y por tanto **no hay que
reexpresar** `tema-encendido.guardia.test.ts:101` (que exige exactamente una regla con
selector `.dark`). La alternativa global queda descartada en §5-C con su porqué.

**Ubicación exacta: inmediatamente después del bloque `:root, .tema-claro`
(`globals.css:149-192`) y ANTES del bloque `.dark` (`:210`).** No es cosmética: ver
§6.2, donde esa colocación es la diferencia entre una guardia que mide y una que miente
en verde.

### 4.2 Por qué el mecanismo es «fijar tokens» y no «pintar colores»

Es la lección medida de la 208, girada de lado: `bg-white` a secas dejó **116** textos
bajo AA porque pintó el papel y dejó la tinta del tema. Una regla de impresión que sólo
dijera `background: white` haría **exactamente lo mismo en papel**. Fijando tokens,
papel, tinta, bordes, muted y los cuatro `-strong` viajan juntos.

### 4.3 La trampa de los fondos en impresión (R10)

Los navegadores **no imprimen los fondos** salvo que el usuario marque «gráficos de
fondo», que viene **desmarcado**. Consecuencia, y es el argumento fuerte de toda esta
sección:

- **Hoy** (con el pin): tinta `#12233f` sobre papel no impreso = navy sobre blanco.
  Legible por accidente afortunado.
- **Sin el bloque, después del cambio, desde tema oscuro**: la tinta sería `#e6ecf8`
  —casi blanco— y el fondo oscuro **no se imprimiría**. Resultado: **blanco sobre
  blanco, la factura sale en papel en blanco.**
- **Con el bloque**: la tinta vuelve a `#12233f` y el resultado no depende de que se
  imprima ninguna superficie.

Por eso el bloque **debe** fijar los tokens de tinta y no sólo los de superficie
(R10), y por eso **no** se añade `print-color-adjust: exact` (R11): forzaría a imprimir
el fondo… oscuro, que es precisamente el gasto de tóner que la decisión humana
descarta. El bloque arregla la **tinta**; el papel lo pone la hoja física.

### 4.4 Lo que el bloque NO puede hacer *(D7: aceptado y declarado — R15)*

**No apaga el variant `dark:`.** `@custom-variant dark` se resuelve contra el
**ancestro** (`globals.css:23-32`), no contra los tokens. Al imprimir desde tema
oscuro, las utilidades `dark:` de `Badge`/`Button` siguen disparando dentro de la hoja
y el bloque de tokens no las alcanza.

**Y no es una regresión, que es lo que lo hace aceptable:** «tokens claros + `dark:`
disparando» es **literalmente el estado que la hoja tiene HOY en pantalla en tema
oscuro**. El resultado impreso será el mismo que se ve hoy. Esto **va escrito junto al
bloque en `globals.css`** (R15), no sólo en este spec: quien lea la regla de impresión
tiene que encontrar ahí su límite.

**La solución de raíz sale a ficha aparte, y aquí queda por qué se separó.** Envolver
las dos ramas de `@custom-variant dark` en `@media not print` apagaría el variant al
imprimir en **toda la app** — que es probablemente lo correcto, porque imprimir en
oscuro no tiene sentido en ninguna pantalla. No entra aquí por tres razones: (1)
cambiaría el comportamiento de impresión de las quince rutas del portal, no de una;
(2) exige su propia medición, y esta ficha no puede firmarla; (3) mezclada con la
reversión del pin haría imposible saber cuál de los dos cambios movió qué. **Se da de
alta como ficha propia** (la registra el leader). Es el mismo arreglo de raíz que el
comentario del repo ya señalaba en `cierre-factura.tsx:114-116`.

### 4.5 Nombre de la clase

`papel-al-imprimir`: dice **qué** (papel) y **cuándo** (al imprimir). Descartados:
`tema-claro-impreso` (se confunde a simple vista con `tema-claro`, justo lo que esta
feature retira de este archivo), `hoja-papel` (dice qué, no cuándo, y se leería como un
pin permanente), `imprime-claro` (ajeno al estilo `tema-*` del repo).

### 4.6 Lo que esta feature NO cubre de la impresión *(D8 — R14)*

Escrito para que nadie lo lea como olvido:

- **No hay botón «Imprimir»**, ni `window.print()`. La única forma de imprimir sigue
  siendo el diálogo del navegador (Ctrl+P).
- **Imprimir el detalle arrastra el modal y el resto de la página.** La hoja del
  detalle vive dentro de un modal (`CierresAdminModule.tsx:820-837`) con
  `max-h-[70vh] overflow-y-auto` (`:822`); no hay `@page`, ni ocultamiento del resto de
  la interfaz, ni paginación, y **esta feature no los añade**. Es muy probable que el
  contenido salga recortado por el `overflow`.
- **No hay tamaño de página, ni márgenes, ni saltos controlados.**

Lo que esta feature garantiza es **el color de la tinta y del papel**. Un flujo de
impresión de verdad —`@page`, ocultar el resto, paginar los renglones, y decidir si se
imprime desde el modal o desde una vista propia— es otra ficha, y esta pone su primera
pieza.

---

## 5. Alternativas descartadas

**A. Quitar `tema-claro` y poner `bg-white`.** Descartada **por medición ajena, no por
criterio**: 116 textos bajo 4,5:1, mínimo 1,04, contra 20 sin tocar nada
(`cierre-factura.tsx:86-99`). Mueve el bug de 16 sitios a 116. Está aquí porque es la
primera idea que tiene cualquiera que lea la ficha.

**B. Dejar `tema-claro` y añadir sólo la regla de impresión.** Es el statu quo más
trabajo: no cumple el pedido humano (R1).

**C. Hacer que TODA la app imprima en claro** (`@media print` sobre `:root`, `.dark`,
`.tema-sistema` y los `body:has(...)`). **DESCARTADA POR LA PUERTA HUMANA (D6).** Es
más simple de razonar y probablemente correcta a largo plazo, pero (1) excede el
encargo, que habla de la factura; (2) obligaría a reexpresar
`tema-encendido.guardia.test.ts:101`, que exige **exactamente una** regla con selector
`.dark`; (3) nadie ha mirado cómo imprime el resto del portal porque nadie lo imprime,
y una regla global sin medición es una promesa. Queda emparentada con la ficha de §4.4.

**D. Utilidades `print:` de Tailwind en cada texto** (`print:text-navy`, …).
Descartada: son 143 textos en el detalle y 30 en el resumen. Es el error de A repetido
a mano, con la garantía de que el próximo texto que alguien añada se olvide.

**E. Estampar `tema-claro` por JavaScript en `onbeforeprint`/`onafterprint`.**
Descartada: el estado de impresión por JS es frágil (Safari/iOS y «guardar como PDF» no
siempre disparan los dos eventos), mete un efecto de cliente en un componente
presentacional, y CSS ya expresa «en papel, claro» de forma declarativa y sin carrera.

**F. Una hoja de estilos aparte (`app/print.css`).** Descartada: la mecánica del tema
vive entera en `globals.css` y **las guardias leen ese archivo**. Partirla en dos
obliga a duplicar el parser y crea el escenario de «lo cambié en el que no vigilaba
nadie».

**G. Referenciar los valores claros con variables intermedias** (`--claro-foreground` +
`var(...)`) para no repetir hexes. Evita repetir los valores, **no** la lista de
asignaciones, añade indirección a un archivo que hoy se lee de un vistazo, y toca el
bloque `:root` que ya consumen dos guardias y un test de paleta. La duplicación **con
guardia de espejo** (R12) es el patrón que este repo ya eligió para `.tema-sistema`
frente a `.dark` (`globals.css:263-267`), y se reusa en vez de estrenar otro.

**H. Migrar los 16 navy a `text-card-foreground`.** Equivalente hoy (mismo hex), pero
incoherente con los otros realces del archivo. Ver §2(a).

**I. *(nueva en v2)* Verificar la legibilidad con un barrido de navegador.**
**DESCARTADA POR D9.** Era el plan de la v1 de este spec y se cae por un dato de
hecho: **no existe en el repo un script que barra la app** (`scripts/` no tiene ninguno
de contraste), el barrido de la 210 no quedó commiteado, y el único candidato
disponible —`.claude/skills/impeccable/scripts/detector/`— **no está verificado**. En
una jornada con **tres mediciones falsas** por herramientas que rellenan lo que no
saben, montar el criterio de aceptación sobre una herramienta sin autocontroles es
comprar el mismo billete por cuarta vez. Lo que sí está commiteado y validado es la
**aritmética** (§6.1), y con ella el criterio se puede construir entero sin navegador
(§6.3).

---

## 6. Verificación

Cuatro piezas ejecutables, todas en el gate, ninguna de las cuales afirma «se ve
bien». Y una sección final que dice **qué no queda cubierto**, para que el verde no se
lea como más de lo que es.

### 6.1 El instrumento: una sola aritmética, compartida *(D9 — R25, R26)*

**Lo que ya existe y está validado**, dentro de un archivo de test:
`contraste-tokens.guardia.test.ts` trae `aRgb` (`:72`), `luminancia` (`:80`),
`contraste` (`:88`) y `componer` (`:100`), más el lector de tokens de `app/globals.css`
—`partirPorTema` (`:126`), `token` (`:140`) y `paleta` (`:161`)—. Y trae **sus tres
autocontroles**: tres razones publicadas por WCAG (`:176`), los dos extremos de la
composición alfa (`:183`) y el parser leyendo el token vigente y no un hex de un
comentario (`:188`).

**Lo que hace esta feature:** extraerlo a `tests/fixtures/contraste.ts` —el patrón de
`tests/fixtures/sin-comentarios.ts`, feature 209— y que la guardia de la 210 lo
consuma desde ahí **conservando sus tres autocontroles tal cual**, que a partir de ese
momento validan la copia compartida. Ningún otro archivo de `tests/` puede tener una
segunda copia de esa aritmética; se censa.

> **Decisión derivada, declarada para que sea revisable:** el encargo de la puerta
> hablaba de `contraste` y `componer`. Se extrae **también el lector de tokens**, por
> dos razones concretas: (1) sin él, la guardia nueva necesita **un segundo parser** de
> `globals.css`, que es literalmente lo que la feature 209 vino a cerrar —74 archivos
> con su propio quitador y cinco semánticas distintas—; (2) la trampa de `@media print`
> de §6.2 hay que arreglarla **una vez**, o quedará arreglada en una guardia y viva en
> la otra.

**Prohibido** (R26): sostener cualquier requisito de esta ficha sobre
`.claude/skills/impeccable/scripts/detector/` o sobre cualquier otra herramienta sin
autocontroles ejecutándose en el gate.

### 6.2 ⚠️ El arreglo del lector ante `@media print` — hacerlo ANTES del bloque

**Esto es lo más fácil de romper de toda la feature, y rompe en VERDE.**

`partirPorTema` parte el CSS por el primer `.dark` a principio de línea y `token()` se
queda con **la última** declaración de cada token en su mitad. Si el bloque `@media
print` se coloca **después** de `.dark`, sus hexes **claros** caen en la mitad
«oscuro» y ganan por ser los últimos: `token("oscuro","foreground")` devolvería
`#12233f` en vez de `#e6ecf8`, `token("oscuro","card")` devolvería `#ffffff`… y **todos
los casos de tema oscuro pasarían a medir los pares CLAROS y seguirían en verde**. Una
guardia de contraste midiendo el tema equivocado y aprobando.

Dos medidas, las dos obligatorias, y las dos **en el fixture compartido** para que
valgan para las dos guardias:

1. **Quitar los bloques `@media print { … }` del CSS antes de partir por tema**, de
   forma explícita y con el comentario que diga qué fallo evita. El bloque de impresión
   tiene su propia guardia (§6.5); el lector de tokens no debe verlo.
2. **Colocar el bloque antes de `.dark`** (§4.1), de modo que aunque alguien retire la
   medida 1, los valores que ganarían serían los mismos que ya están.

**Mutación obligatoria (R24):** mover el bloque detrás de `.dark` **sin** la medida 1 y
comprobar que la guardia se pone **roja**. Si sale verde, la medida 1 no está haciendo
nada.

### 6.3 El inventario CERRADO de pares (R6, R7) — el corazón de la verificación

Sustituye al barrido de navegador. Se enumeran **los pares (tinta, fondo) que las dos
hojas usan de verdad**, se miden con §6.1 en **los dos temas**, y la lista se **cierra**:
una utilidad de color de la hoja que no mapee a un par del inventario pone la guardia
en rojo.

**Inventario de partida** (verificado contra el archivo; cerrarlo y fijar sus suelos es
tarea T9). Las utilidades de opacidad se miden **componiendo** sobre lo que hay debajo,
nunca sobre un fondo supuesto.

| # | Tinta | Fondo | Dónde (anclas) | Umbral |
| --- | --- | --- | --- | --- |
| P1 | `foreground` | `card` | los 12 sitios migrados sobre el papel + `:576`, `:855`, `:882`, `:928`, `:933` | 4,5 |
| P2 | `foreground` | `muted` (opaco) | `:809` rama no-éxito, dentro de `:794` | 4,5 |
| P3 | `foreground` | `muted` @ **40 %** sobre `card` | `:253` dentro de `:249` | 4,5 |
| P4 | `foreground` | `muted` @ **50 %** sobre `card` | `:352`, `:384` (panel `:585`); `:1317` (pie `:1314`); `:924`/`:928`/`:933` en **hover** (`:922`) | 4,5 |
| P5 | `muted-foreground` | `card` | `:201`, `:234`, `:272`, `:280`, `:513`, `:544`, `:561`, `:575`, `:669`, `:929`, `:1103`, `:1111`, `:1323` | 4,5 |
| P6 | `muted-foreground` | `muted` (opaco) | `:800`, `:818` rama no-éxito; `:843` píldora neutral | 4,5 |
| P7 | `muted-foreground` | `muted` @ 40 % sobre `card` | `:250` dentro de `:249` | 4,5 |
| P8 | `muted-foreground` | `muted` @ 50 % sobre `card` | `:346`, `:351`, `:364`, `:383` (panel `:585`); `:1315` (pie `:1314`); `:929` en hover | 4,5 |
| P9 | `success-strong` | `success` @ **15 %** sobre `card` | `:800`, `:809`, **`:818` (tras R8)**, `:841` | 4,5 |
| P10 | `warning-strong` | `warning` @ 15 % sobre `card` | `:842` — las dos píldoras de conteo | 4,5 |
| P11 | `danger-strong` | `card` | `:213` (`Renglon` tone `danger`) | 4,5 |
| P12 | `foreground` (**borde**) | `card` | `border-foreground` de la pestaña activa, `:854` | **3,0** |
| P13 | `success-strong` | `card` | `:936` (total de la fila) | 4,5 |
| P14 | `success-strong` | `muted` @ 50 % sobre `card` | `:936` en **hover** de la fila (`:922`) | 4,5 |
| P15 | `border` | `card` | separadores `\|`, `:548` | **EXENTO** (decorativo, `aria-hidden`) |
| P16 | `brand` | `card` | wordmark «Ordenex», `:509` | **EXENTO** (WCAG 1.4.3, texto de marca) |

Tres reglas del inventario que no se pueden saltar:

1. **El hover cuenta como par propio.** La fila de gestión cambia de fondo al pasar el
   cursor (`hover:bg-muted/50`, `:922`) y eso mueve tres pares (P4, P8, P14). La 210
   encontró un defecto que **sólo existía con el cursor encima**; medir estáticas es
   exactamente cómo se le escapó a la 208.
2. **Los exentos figuran, marcados.** P15 y P16 no se miden contra un umbral, pero
   **están en la lista**: un exento que desaparece es indistinguible de un par que nadie
   miró (R16).
3. **Suelo por par** (R7), no sólo umbral: se anota el valor medido al cerrar el
   inventario y ningún cambio de token puede bajarlo. Es la lección de
   `contraste-tokens.guardia.test.ts:41-45` — `--warning-strong` pasaba AA por una
   centésima.
4. **Lo que entra por props no está en el archivo, y hay que ir a buscarlo.** Las hojas
   reciben subárboles ajenos: `acciones` (`:391`), `rotulo` (`:398`), `extra` y los
   `children` de `HojaFactura`. Un censo de `cierre-factura.tsx` **no los ve**. Hay que
   enumerar qué monta cada llamador dentro de la hoja —`CierresAdminModule.tsx:749,827`
   y `CierreDiaModule.tsx:730`— y clasificar cada pieza: token que gira (cae en un par),
   variante de primitiva (deuda 210/216, se declara y **no** se parchea, R18), o color
   propio fijo (**hallazgo**: se detiene y se consulta). Es el mismo agujero que el
   comentario del repo ya avisaba —«lo que sí hay que mirar es cualquier pieza NUEVA con
   `dark:` propio que se meta en la hoja», `cierre-factura.tsx:116-117`— sólo que ahora
   aplica a todo color, no sólo a `dark:`.

### Hasta dónde llega el CIERRE — *(corregido el 2026-08-13, tras la primera revisión)*

> **La versión anterior de este párrafo prometía de más**, y conviene que quede el texto de
> lo que decía: «si mañana alguien pinta un texto de la hoja con una pareja que nadie listó,
> lo caza el **cierre** del inventario». Con el mecanismo que la ficha implementó eso sólo
> es cierto **si la tinta o el fondo son nuevos**. Se corrige aquí para que el spec no exija
> lo que el test no puede probar.

**Lo que este método cubre y lo que no**, dicho como ya lo dice el archivo del que sale
(`contraste-tokens.guardia.test.ts:18-20`): la aritmética cubre **los pares declarados**;
lo que impide que aparezca uno sin declarar es el **cierre**, y el cierre opera en dos
planos, los dos ejecutables:

1. **Cierre por UTILIDAD.** Se recorre toda utilidad con prefijo de color de la hoja y cada
   una debe caer en un par del inventario —medido o exento, pero declarado—. Lo que el
   censo no sabe clasificar, lo denuncia: un `text-emerald-500` nuevo es rojo aunque nadie
   lo hubiera previsto.
2. **Cierre por FONDO.** Los fondos son pocos, se escriben como utilidad y **son ellos los
   que crean pares**, así que se enumeran y se congelan. Son **siete**: `bg-brand`,
   `bg-muted`, `bg-muted/40`, `bg-muted/50`, `bg-success/15`, `bg-warning/15` y
   `hover:bg-muted/50`. Estrenar una superficie es rojo.

**Lo que NO cubre, y es la única grieta: la RECOMBINACIÓN.** Mover una tinta ya declarada
—`text-muted-foreground`— dentro de un fondo ya declarado —`bg-success/15`— produce un par
que nadie midió, y ninguno de los dos planos lo ve: las dos utilidades están en la lista.

**Por qué se acepta esa grieta en vez de cerrarla — DECISIÓN, no limitación heredada.**
Cerrar por par exigiría resolver el **fondo efectivo** de cada texto: recorrer el árbol JSX
y decidir de qué ancestro hereda cada nodo, a través de condicionales, `cn()`, props y
`children` que llegan de otros archivos. Eso es exactamente la clase de análisis que
produce respuestas **plausibles y falsas**, que es el fallo que esta ficha existe para no
repetir (D9, tres mediciones falsas el 2026-08-13). Y hay una asimetría que decide el
asunto: **un cierre por par que se equivoque al resolver el fondo es PEOR que no tenerlo,
porque aprueba con un número** — y un número, en este repo, es lo que la gente cree.

La red de la recombinación es humana y va escrita como tal: **al mover una pieza de sitio
dentro de la hoja hay que releer el inventario**. La grieta queda declarada en el propio
caso de la guardia, no sólo aquí, para que quien lea su verde no lo lea como más de lo que
es.

### 6.4 Censo de fuente — misma guardia, `factura-contraste.guardia.test.ts`

Lee `cierre-factura.tsx` con el quitador **compartido** (`quitarComentarios`, feature
209 — nunca uno propio) y afirma:

| Aserción | Requisito |
| --- | --- |
| **0** apariciones de `text-navy` y de `border-navy` en código vivo | R2 |
| **0** apariciones de `tema-claro` en **todo** el archivo, comentarios incluidos | R1, R19 |
| **0** utilidades de color de valor fijo de la lista negra: `navy`, `navy-deep`, `asfalto-*`, `kraft-*`, `bg-white`, `text-white`, y arbitrarias `text-[#…]` / `bg-[#…]` | R2, R3 |
| **0** utilidades de opacidad sobre un token `-strong` (`text-*-strong/NN`) | **R8** |
| toda utilidad de color hallada mapea a un par del inventario de §6.3 | **R7** |
| los **fondos** de la hoja son exactamente los siete enumerados en §6.3 | **R7** |
| **exactamente 2** apariciones de `papel-al-imprimir`, una en cada `<Card>` | R9 |
| **0** apariciones de `print-color-adjust` | R11 |
| **0** apariciones de `window.print` y de un rótulo «Imprimir» | R14 |
| al menos una de `border-foreground` (el indicador de §2, #12) | R3 |

**Excepción declarada en la lista negra: `brand`.** `--color-brand` es fijo y sin
variante por tema, pero sus dos usos en la hoja son el **wordmark** (`:509`, exento) y
la **franja de marca** (`:315`, `aria-hidden`, sin texto). La excepción va **en el
código de la guardia con su motivo**, no como un agujero silencioso.

### 6.5 Censo de CSS — dentro de `tema-encendido.guardia.test.ts`

Va **ahí** y no en un archivo nuevo: ese archivo ya tiene el parser de reglas con
ancestros (`reglasDe`, `:71`), es el dueño del mecanismo del tema, y **es el que hay
que reexpresar de todas formas** (R20). Un cuarto parser de CSS en `tests/` es lo que
la feature 209 vino a cerrar.

| Aserción | Requisito |
| --- | --- |
| existe **exactamente una** regla con selector `.papel-al-imprimir` | R9 |
| sus **ancestros** contienen `@media print` (sin eso, aplicaría en pantalla) | R13 |
| sus declaraciones son **iguales, clave a clave y valor a valor**, a las de la regla que contiene `:root` y `.tema-claro` — `toEqual`, no subconjunto | R12 |
| ese bloque declara `--foreground` y `--card-foreground` (tinta, no sólo superficie) y tiene más de 20 declaraciones | R10, R12 |
| **0** `print-color-adjust` en `globals.css` | R11 |
| `.dark`, `.tema-sistema` y `@custom-variant dark` **no cambian** (los casos existentes siguen verdes sin tocarse) | R13, R15 |
| `.tema-claro` sigue existiendo, con `--background: #f7f8fc` | R21 |
| el caso `:162` **reexpresado**: nombra la landing (`app/page.tsx:50`) y la elección «claro» del portal (`lib/tema/tema.ts:64`), y **ya no la factura** | R20 |

### 6.6 Test de componente (jsdom)

Renderiza `CierreFacturaDetalle` y `CierreFacturaResumen` y afirma sobre el `<Card>`
—localizado por su `role="region"` + `aria-label`, nunca por una clase—: que **no**
contiene `tema-claro` (R1), que **sí** contiene `papel-al-imprimir` (R9), y que la
pestaña activa lleva `border-foreground` y `text-foreground` (R3).

jsdom **sólo** lee la cadena de clases: no compone color ni aplica `@media`. Se declara
así **en el propio test**, para que nadie lea su verde como «se ve bien».

### 6.7 Mutaciones obligatorias (R24)

Ninguna guardia cuenta hasta verla roja. Mínimo, con su resultado anotado en
`progress/impl_217.md`:

| Mutación | Guardia que debe ponerse roja |
| --- | --- |
| **mover el bloque `@media print` detrás de `.dark` sin el arreglo del lector** | §6.3 (vía §6.2) — **la obligatoria de esta ficha** |
| devolver `tema-claro` a **una** de las dos hojas | §6.4 y §6.6 |
| devolver **un** `text-navy` | §6.4 |
| devolver el `/80` a `:818` | §6.4 |
| pintar un texto de la hoja con una **tinta** no listada | §6.4 (cierre por utilidad) |
| estrenar una **superficie** en la hoja (un `bg-*` no listado) | §6.4 (cierre por fondo) |
| borrar el bloque `@media print` entero | §6.5 |
| cambiar **un** hex dentro del bloque de impresión | §6.5 (espejo) |
| quitarle el `@media print` dejando la regla suelta | §6.5 (ancestro) |
| empeorar `--foreground` oscuro hasta bajar de 4,5 sobre `card` | §6.3 (suelo y umbral) |
| romper la fórmula compartida (invertir el `+ 0.05`) | §6.1 (los tres autocontroles) |

### 6.8 Lo que NO queda verificado, dicho por delante

- **La composición en ejecución de las primitivas.** Los `dark:` de `Badge`/`Button`
  producen fondos que se resuelven en el navegador; el inventario mide los pares de la
  **hoja**, no los de las primitivas. Eso es R18 (deuda de 210/216), y queda
  **declarado**, no medido aquí.
- **El resultado impreso real.** Ninguna pieza del gate renderiza en papel. Lo que se
  verifica es que la regla existe, que está dentro de `@media print`, que fija la tinta
  y que no diverge del tema claro. Es una verificación **estructural**, y se llama así.
- **Que la hoja «se vea bien».** Ninguna de las cuatro piezas lo afirma, y ninguna
  debe leerse como si lo hiciera.
- **El barrido de «20/10 textos» de la ficha.** No es reproducible hoy: salió de una
  medición en navegador que no quedó en el repo. Queda como dato histórico y **no** se
  usa como criterio de aceptación.

---

## 7. Guardias y tests existentes que se mueven

| Archivo | Qué le pasa | Por qué |
| --- | --- | --- |
| `tests/unit/guards/contraste-tokens.guardia.test.ts` | Consume el fixture compartido; **conserva sus tres autocontroles**; el arreglo de `@media print` viaja al fixture | R25, R26, §6.2 |
| `tests/unit/guards/tema-encendido.guardia.test.ts:162` | **REEXPRESADO** (R20) | Su título afirma que la factura depende de `.tema-claro`. Tras esta feature es falso. Se reescribe para nombrar a los consumidores que quedan; **no se borra ni se relaja**. |
| `tests/unit/guards/tema-encendido.guardia.test.ts:101,106-160` | **Sin cambios** | D6 acota la regla a las hojas: `.dark` sigue teniendo exactamente una regla y el variant no se toca. |
| `tests/unit/components/analytics-paleta.test.ts` | **Sin cambios esperados**, pero se vigila | Parte el CSS por reglas que incluyan `:root` (`:62`). El bloque nuevo no añade un selector `:root`; se comprueba en el gate, no se supone. |
| `tests/components/TemaToggle.test.tsx`, `AppLayout.test.tsx`, `tests/unit/tema/tema.test.ts` | **Sin cambios** | Siguen defendiendo `.tema-claro` para el portal en «claro» (R21). |
| Tests de componente / E2E de la factura | **Sin cambios**: R23 prohíbe tocar textos y nombres accesibles | Si alguno se pone rojo, se corrige el **código**, no el test. |

---

## 8. Riesgos y límites declarados

1. **La trampa del lector (§6.2) falla en VERDE.** Es el riesgo más caro de la ficha y
   por eso tiene mutación obligatoria propia (R24).
2. **El inventario de pares vale lo que valga su cierre.** Si la lista se copia de este
   documento sin verificarla contra el archivo, hereda cualquier error mío. T9 exige
   recorrer el archivo y **cerrarla**, no transcribirla.
3. **`dark:` en impresión** (§4.4): límite conocido, no regresión, declarado junto a la
   regla y remitido a ficha aparte (R15).
4. **Imprimir el detalle arrastra el modal y el resto de la página** (§4.6). Se
   garantiza el color, no el formato (R14).
5. **La hoja del detalle vive también en el portal del mensajero**
   (`CierreDiaModule.tsx:36,730`). El cambio le llega igual, y es lo correcto: es el
   mismo comprobante. No hay verificación distinta para esa ruta porque el criterio es
   el mismo inventario de pares.
6. **`--color-navy` sigue existiendo** (`globals.css:84`) y lo usa la landing. Esta
   feature **no lo retira**: sólo deja de usarlo en la factura.

---

## 9. Lo que sale a ficha aparte

| Qué | Por qué se separó | Dónde queda escrito |
| --- | --- | --- |
| **Apagar el variant `dark:` al imprimir** (`@media not print` alrededor de las dos ramas de `@custom-variant dark`) | Cambia el comportamiento de impresión de **toda** la app; exige su propia medición; mezclado con la reversión del pin haría imposible atribuir un cambio a su causa | §4.4, R15 — la registra el leader |
| **Un flujo de impresión de la factura** (`@page`, ocultar el resto, paginar, decidir si se imprime desde el modal o desde una vista propia) | Esta ficha garantiza el color, no el formato (D8) | §4.6, R14 |
| **La deuda de paleta de `Button` variant `destructive`** y cualquier otra variante de primitiva bajo AA | Es global: parcharla dentro de la hoja deja las otras rutas rotas y esconde la deuda | R18 — fichas 210/216 |
