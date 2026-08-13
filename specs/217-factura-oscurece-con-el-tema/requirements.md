# Feature 217 — La factura del cierre oscurece con el tema

Requisitos en notación EARS. Cada `R<n>` es verificable. Feature `frontend`,
complejidad **medium**, `depends_on: null`.

> **Esta feature REVIERTE una decisión medida, no arregla un olvido.** La feature 208
> fijó las dos hojas del comprobante a tema claro (`tema-claro`) porque «la hoja es
> papel». El **pedido humano del 2026-08-13** —hecho después de que se le confirmara
> que el comportamiento era deliberado y medido— cambia esa decisión: la hoja **gira
> con el tema**, y **al imprimir sigue saliendo blanca**.
>
> **Estado: puerta de aprobación humana PASADA el 2026-08-13.** Las cinco preguntas
> abiertas de la primera ronda están **CERRADAS** y plegadas al articulado (D5-D9,
> abajo). No queda ninguna decisión pendiente.
>
> Lo que aquí se escribe sustituye al bloque de comentario de
> `cierre-factura.tsx:73-128` y a la viñeta 2 de `app/globals.css:125-127`.

## Lo que entra como ENTRADA, no como sugerencia

### Primera ronda — el pedido (2026-08-13)

| # | Decisión | Origen |
| --- | --- | --- |
| **D1** | Las **DOS** hojas giran con el tema: `HojaFactura` (`cierre-factura.tsx:313`) y `HojaResumen` (`:503`). El mismo documento no puede tener dos materiales. | Pedido humano + `impl_208_modo-oscuro.md:270-274` |
| **D2** | **Al imprimir, la hoja sale clara.** «Una factura que oscurece en pantalla y se imprime en oscuro gasta tóner y sale ilegible.» | `feature_list.json` ficha 217 |
| **D3** | Quitar el pin **no basta**: los 16 `text-navy`/`border-navy` hay que migrarlos a tokens en el mismo cambio. Medido: `bg-white` a secas dejó **116** textos bajo 4,5:1 contra 20 sin tocar nada. | `cierre-factura.tsx:86-99` |
| **D4** | El logotipo «Ordenex» (3,18) está **EXENTO**: WCAG 1.4.3 exime el texto de una marca. | ficha 217 y ficha 216 |

### Segunda ronda — la puerta humana (2026-08-13), CERRANDO las cinco preguntas

| # | Decisión | Cierra | Dónde vive ahora |
| --- | --- | --- | --- |
| **D5** | **La nota de «Ingreso bruto» ENTRA en el alcance.** Motivo del humano: el arreglo es de **un carácter** y es el **único fallo propio de la hoja que sigue vivo**. Deja de ser exclusión y pasa a requisito con su test. | Q1 | **R8** |
| **D6** | **La regla de impresión se ACOTA a las dos hojas**, con la clase propia del diseño. No se toca la regla global y **no** hay que reexpresar `tema-encendido.guardia.test.ts:101`. | Q2 | **R9-R13**, `design.md §4.1` |
| **D7** | **Se ACEPTA que el variant `dark:` siga disparando al imprimir.** Argumento: el resultado impreso es **idéntico al que la hoja ya muestra hoy**, así que no es regresión. La solución de raíz —envolver `@custom-variant dark` en `@media not print`— **NO entra aquí**: afecta a toda la app y se da de alta como **ficha aparte**. | Q3 | **R15**, `design.md §4.4` |
| **D8** | **NO se añade botón «Imprimir».** La feature garantiza el **color**, no el flujo. Lo que NO cubre queda escrito para que nadie lo lea como olvido. | Q4 | **R14**, `design.md §4.6` |
| **D9** | **El medidor SÍ está commiteado, y no es el que el spec citó.** `contraste(a,b)` vive en `tests/unit/guards/contraste-tokens.guardia.test.ts:88` y `componer(color,fondo,alpha)` en `:100`, validadas contra tres razones publicadas de WCAG y dos extremos de composición alfa. Lo que **no** existe es un script que barra la app: en `scripts/` no hay ninguno de contraste. **Queda PROHIBIDO usar `.claude/skills/impeccable/scripts/detector/`**: no está verificado, y esta jornada ya tuvo **tres mediciones falsas** por herramientas que rellenan lo que no saben. | Q5 | **R25, R26**, `design.md §6` |

**Consecuencia de D9, y es lo que más cambia respecto de la primera versión de este
spec:** la legibilidad en oscuro **no** se demuestra con un barrido de navegador. Se
demuestra **enumerando los pares (tinta, fondo) que la hoja usa de verdad** y
midiéndolos con esa fórmula. Es ejecutable, corre en el gate y no necesita navegador.

---

## Hechos VERIFICADOS contra el código (`dev`, 2026-08-13)

Cada anclaje se comprobó abriendo el archivo. Lo que **no** se pudo verificar está
dicho como tal.

### El pin y las utilidades fijas

- **Dos pines**, uno por hoja: `cierre-factura.tsx:313` y `:503`. Ambos entran (D1).
- **16 utilidades fijas en código vivo**, en 15 líneas: `text-navy` en `:197`, `:212`,
  `:253`, `:275`, `:283`, `:352`, `:384`, `:512`, `:567`, `:671`, `:809`, `:854`,
  `:924`, `:1098`, `:1317`, y `border-navy` en `:854` (esa línea lleva las dos). Las
  otras 8 menciones de «navy» del archivo viven en prosa.
- **La superficie oscura ya existe y ya gira**: `Card` pinta `bg-card
  text-card-foreground ring-1 ring-foreground/10` (`components/ui/card.tsx:15`), y
  `--card` vale `#ffffff` en claro (`globals.css:154`) y `#10203a` en oscuro (`:214`,
  `:274`). **No hay que construir la superficie oscura legible**: es el token de
  tarjeta. Lo único roto era la tinta fija.

### La impresión NO existe hoy: esta regla se CREA, no se preserva

- **Cero vías de impresión en todo el repo**: ni `window.print()`, ni `@media print`,
  ni hoja de impresión. Los únicos aciertos de `@media print` están en
  `specs/32-etiqueta-guia-qr/` —una **planificación superada**— y en la prosa de
  `cierre-factura.tsx:121`.
- `app/(app)/ordenes/_components/etiquetas-pdf.ts` genera los PDF de etiquetas por
  otra vía y **dice explícitamente que NO usa print**.

### Ningún test congela el pin, pero una guardia afirma que la factura depende de él

- Lo único que nombra la clase en `tests/` es el **TÍTULO** de un caso:
  `tests/unit/guards/tema-encendido.guardia.test.ts:162` — «`.tema-claro` sigue
  fijando los valores claros (**la landing y la factura** dependen de ello)». Su
  cuerpo (`:163-165`) sólo comprueba la definición de la clase en `globals.css`.
- Tras esta feature **la landing sigue dependiendo** (`app/page.tsx:50`) y **el portal
  en «claro» también** (`lib/tema/tema.ts:64`); **la factura deja de hacerlo**. El
  título pasa a afirmar algo falso → **R20**.

### Dos filas de la «trampa `dark:`» están CADUCAS (hallazgo de código, no medición)

La tabla de la trampa (`cierre-factura.tsx:104-117`, repetida en la ficha) describe
cadenas de clases y tokens que **ya no son los del código**:

| Fila | Estado hoy | Ancla |
| --- | --- | --- |
| `Badge warning` 4,51 → 4,48 | **CADUCA.** La 210 cambió `--warning-strong` de `#b45309` a `#92400e`; hoy el par mide 6,37 sobre `-soft` y **6,31 sobre `warning/15`**, con suelo atornillado. | `globals.css:186-189`; `contraste-tokens.guardia.test.ts:56` |
| `Badge destructive` 3,30 → 2,89 | **CADUCA para `Badge`.** La 210 lo movió a `bg-danger-soft text-danger-strong dark:bg-danger/15` (5,30 / 5,20). Sigue vigente para **`Button` variant `destructive`**, que la 210 no tocó. | `badge.tsx:38`; `button.tsx:24` |
| `Button outline` 14,79 → 14,78 · `Badge success` 4,84 → 4,76 · `danger` 5,30 → 5,32 | **VIGENTES**: sus tokens y cadenas no se movieron. | `globals.css:185,190`; `button.tsx:14` |

Esto **no es una re-medición**: es leer qué clases y qué hexes hay hoy.

### ⚠️ El barrido de «20/10 textos» NO es reproducible, y no se usa como criterio

La ficha y `impl_208` citan 20 textos bajo AA en el detalle y 10 en el resumen sin el
pin. **Ese número salió de una medición en navegador que no quedó en el repo**: no hay
script, no hay salida, no hay desglose de a qué texto corresponde cada fallo. Sigue
siendo un dato histórico útil para entender por qué se hizo la 208, pero **este spec
NO lo cita como verificable y NO lo usa como criterio de aceptación**. El criterio es
el inventario de pares de **R6/R7**, que sí se puede volver a calcular en cualquier
momento a partir de `app/globals.css`.

Lo mismo vale para «los 3 textos que ya fallan». Sus **anclas** siguen siendo útiles
(`impl_208_modo-oscuro.md:290-294`) y esta feature las resuelve una por una:

| Cuál | Ancla | Qué le pasa en esta feature |
| --- | --- | --- |
| nota de «Ingreso bruto», `text-success-strong/80` | `cierre-factura.tsx:818` | **ENTRA** (D5) → **R8** |
| las dos píldoras de conteo, `bg-warning/15 text-warning-strong` | `cierre-factura.tsx:842` | **Ya cerradas por la 210**; el par entra al inventario y se mide (**R6**) |
| los dos separadores `\|`, `text-border`, `aria-hidden` | `cierre-factura.tsx:548` | **EXENTOS**: decorativos, no son texto (**R16**) |
| el wordmark «Ordenex», `text-brand` | `cierre-factura.tsx:509` | **EXENTO** por WCAG 1.4.3 (D4, **R16**) |

---

## Grupo A — La hoja gira con el tema

**R1 — El papel deja de ser fijo.** MIENTRAS el portal esté en tema oscuro, el
sistema DEBE pintar **las dos** hojas del comprobante —el detalle y el resumen
compacto— sobre la superficie de tarjeta del tema vigente, y NO DEBE fijar el
subárbol de ninguna de las dos a los valores claros.

**R2 — Cero tinta de valor fijo.** El sistema NO DEBE conservar en el código vivo de
la factura ninguna utilidad de color cuyo valor no gire con el tema. Censo objetivo,
con los comentarios ya quitados: **0** `text-navy` y **0** `border-navy` en
`app/(app)/cierres-admin/_components/cierre-factura.tsx`.

**R3 — Cada sitio a su token, por su papel semántico.** CADA una de las 16
utilidades fijas DEBE quedar sustituida por un token que tenga valor propio en tema
claro **y** en tema oscuro, elegido por el papel que ese texto cumple —titular,
cifra, dato realzado, rótulo enfatizado, indicador de selección—. La sustitución NO
DEBE recaer en el token de marca (`primary` / `brand`): ese es exactamente el color
que la ficha 216 tiene abierto por incumplir AA en texto normal (3,18 sobre blanco).
El mapeo sitio a sitio vive en `design.md §2` y es parte del requisito.

**R4 — El cambio de tono en tema CLARO se declara.** El sistema DEBE aceptar que en
tema claro esos 16 sitios pasen de `#0b2545` (`--color-navy`) a `#12233f`
(`--foreground`), y NO DEBE dejar ninguno de ellos con un contraste **menor** que el
que tiene hoy sobre su fondo. No es un efecto colateral: es la consecuencia de R3 y
va escrita, no descubierta.

**R5 — El resto de la hoja no se rediseña.** El sistema NO DEBE cambiar tamaños,
pesos, espaciados, bordes, iconos ni jerarquía visual de las hojas. Esta feature
cambia **de qué depende el color**, no cómo se ve la factura.

**R6 — Legibilidad por PARES, no por impresión visual.** El sistema DEBE alcanzar,
para **cada par (tinta, fondo) que las dos hojas usan de verdad** y en **los dos
temas**, un contraste **≥ 4,5:1** cuando el par pinta texto y **≥ 3:1** cuando pinta
un indicador de interfaz (el borde de la pestaña activa), salvo lo exento por R16 y
lo declarado por R18. El fondo DEBE medirse **compuesto**: donde la hoja usa una
utilidad de opacidad (`bg-muted/40`, `bg-muted/50`, `bg-success/15`, `bg-warning/15`),
el par se mide componiendo esa capa sobre la superficie que hay debajo, no sobre un
fondo supuesto.

**R7 — El inventario de pares DEBE ser CERRADO, y un par nuevo no puede colarse.** El
sistema DEBE mantener el inventario de pares de R6 como una lista **exhaustiva y
enumerada**, y DEBE fallar SI alguna de las hojas usa una utilidad de color que no
mapea a un par del inventario. Además, ningún par DEBE quedar por debajo del **suelo**
que se mida al cerrarlo: un cambio de token que empeore un par existente DEBE poner la
verificación en rojo, aunque siga cumpliendo el umbral.

> **Por qué el suelo y no sólo el umbral.** Es la lección de la 210, escrita en
> `contraste-tokens.guardia.test.ts:41-45`: `--warning-strong` pasaba AA **por una
> centésima**, así que una guardia que sólo comprobara `>= 4.5` habría dejado revertir
> aquella ficha sin poner nada en rojo. Aprobar por una centésima no es aprobar.

**R8 — La nota de «Ingreso bruto» pierde la opacidad *(D5)*.** El sistema NO DEBE
aplicar una utilidad de opacidad sobre un token `-strong` en las hojas. Concretamente,
`text-success-strong/80` (`cierre-factura.tsx:818`) DEBE quedar en
`text-success-strong`.

> **Dos motivos, y el segundo es de método.** (1) El `/80` anula precisamente la
> garantía por la que existe el token `-strong` (contraste ≥ 4,5:1), y por eso ese
> texto mide 3,36 en los dos temas: es el único incumplimiento **propio** de la hoja
> que sigue vivo, y cuesta un carácter. (2) Un `-strong` con alpha **no es medible con
> el inventario de R6** sin inventarle un caso especial de doble composición cuyo único
> consumidor sería esa nota. Quitándolo, la hoja entera queda cubierta por pares
> ordinarios: **entrar en el alcance es también lo que la hace verificable**.

---

## Grupo B — Al imprimir, la hoja sale blanca

**R9 — El papel impreso es claro, venga de donde venga.** CUANDO cualquiera de las
dos hojas se envíe a impresión —incluida la exportación a PDF del propio diálogo de
impresión del navegador—, el sistema DEBE resolver los tokens del subárbol de esa
hoja a sus valores **claros**, sea cual sea el tema activo en pantalla.

**R10 — Sin depender de que el navegador imprima fondos.** La regla de impresión DEBE
fijar los tokens de **tinta** (`--foreground`, `--card-foreground` y los cuatro
`-strong`), no sólo los de superficie. SI la opción «gráficos de fondo» del diálogo de
impresión está DESACTIVADA —que es su valor por defecto—, ENTONCES el texto de las
hojas DEBE seguir siendo oscuro sobre papel blanco.

**R11 — Sin forzar tóner.** El sistema NO DEBE forzar la impresión de la superficie
oscura (`print-color-adjust: exact` / `-webkit-print-color-adjust: exact`) sobre las
hojas ni sobre ninguno de sus ancestros.

**R12 — La declaración de impresión no puede divergir de la de tema claro.** La regla
de impresión DEBE declarar **los mismos tokens y los mismos valores** que la
declaración de tema claro vigente; SI alguna diverge —un token añadido a una y no a la
otra, un hex cambiado en una sola—, ENTONCES la verificación DEBE fallar de forma
ejecutable y nombrar el token que difiere.

**R13 — La regla de impresión no se ve en pantalla, y se ACOTA a las hojas *(D6)*.**
El sistema NO DEBE producir ningún cambio de color, tamaño ni disposición en pantalla
por causa de la regla de impresión: su alcance DEBE limitarse al medio de impresión.
Y DEBE limitarse además a **las dos hojas**: el sistema NO DEBE alterar el
comportamiento de impresión del resto del portal, ni modificar la regla `.dark` ni la
`.tema-sistema` para conseguirlo.

**R14 — No se añade un flujo de impresión *(D8)*.** El sistema NO DEBE añadir un botón
«Imprimir», ni `window.print()`, ni `@page`, ni paginación, ni ocultamiento del resto
de la interfaz al imprimir. Esta feature garantiza el **color** del papel cuando
alguien imprime desde el navegador; el flujo de impresión de la factura, si algún día
se quiere, es otra ficha. Lo que **no** queda cubierto DEBE quedar escrito
(`design.md §4.6`), no omitido.

**R15 — El variant `dark:` al imprimir: aceptado y declarado *(D7)*.** El sistema NO
DEBE intentar apagar el variant `dark:` dentro de las hojas ni modificar
`@custom-variant dark` (`globals.css:23-32`). SI la impresión se lanza desde tema
oscuro, ENTONCES las utilidades `dark:` de las primitivas seguirán disparando dentro
de la hoja, y eso DEBE quedar declarado por escrito junto a la regla de impresión,
con su razón: **el resultado impreso es idéntico al que la hoja ya muestra hoy en
pantalla, de modo que no es una regresión sino el statu quo**. La solución de raíz
—envolver las dos ramas del variant en `@media not print`— queda **fuera de esta
feature** por ser un cambio de toda la app, y DEBE quedar remitida a su ficha propia.

---

## Grupo C — Alcance: lo que NO entra, y por qué

**R16 — Exenciones que no cuentan como incumplimiento.** El sistema NO DEBE contar
como incumplimiento, ni antes ni después del cambio: (a) el logotipo «Ordenex»
(`cierre-factura.tsx:509`), por WCAG 1.4.3 —texto de una marca— (D4); (b) los
separadores `|` decorativos y `aria-hidden` (`:548`), que no son texto expuesto.
Ninguno DEBE ser «arreglado» por esta feature, y los dos DEBEN figurar en el
inventario de R7 **marcados como exentos**, no ausentes: un exento que desaparece de
la lista es indistinguible de un par que nadie miró.

**R17 — Lo preexistente ajeno al pin queda declarado, no parcheado.** SI al cerrar el
inventario de R7 aparece un par que incumple hoy por una causa ajena al pin y ajena a
R8, ENTONCES esta feature NO DEBE corregirlo dentro de la hoja, DEBE dejarlo declarado
con su ancla y su medición fechada, y **NO DEBE empeorarlo** (R7).

**R18 — La deuda de paleta de las primitivas NO se parchea dentro de la hoja.** SI una
variante de `Badge` o de `Button` incumple AA dentro de la hoja, ENTONCES es deuda de
las fichas 210/216 —que la tratan para **toda** la app— y el sistema NO DEBE
corregirla mediante clases locales de la factura. Un parche local a un problema global
deja la misma variante rota en las otras quince rutas y además esconde la deuda. La
feature DEBE dejar constancia de qué variantes quedan por debajo del umbral dentro de
la hoja, con su medición fechada. *(Hoy, por lectura de código: el candidato vivo es
`Button` variant `destructive`, `button.tsx:24`.)*

---

## Grupo D — Lo que la reversión deja atrás

**R19 — Ninguna prosa puede seguir afirmando el pin.** El sistema NO DEBE dejar en el
código de producción, en el CSS ni en los tests ninguna afirmación de que la factura
se fija a tema claro. Alcanza, como mínimo: el bloque `cierre-factura.tsx:73-128`, los
comentarios de `:308-309` y `:496-499`, la viñeta 2 de `app/globals.css:121-127` y el
párrafo «LÍMITE MEDIDO» (`:139-147`) en la parte que habla de la hoja. *(Los archivos
de `progress/` son fotos históricas y **NO se editan**: `impl_208_modo-oscuro.md`
describe lo que era cierto ese día.)*

**R20 — La guardia que congela lo contrario se REEXPRESA, no se relaja.** CUANDO una
guardia afirme lo contrario de lo que esta feature establece, ENTONCES DEBE quedar
reescrita de modo que siga defendiendo lo que sigue siendo cierto y deje de afirmar lo
que ya no lo es. Concretamente,
`tests/unit/guards/tema-encendido.guardia.test.ts:162` DEBE dejar de decir que **la
factura** depende de `.tema-claro` y DEBE seguir defendiendo a sus consumidores
reales. El sistema NO DEBE borrar el caso ni debilitar sus aserciones.

**R21 — `.tema-claro` sigue existiendo, intacta.** El sistema NO DEBE eliminar la
clase `.tema-claro` ni cambiar ninguno de sus valores: la landing pública
(`app/page.tsx:50`) y la elección explícita «claro» del portal (`lib/tema/tema.ts:64`)
siguen dependiendo de ella. Esta feature le quita **un** consumidor, no la clase.

---

## Grupo E — Frontera de la feature

**R22 — Sin datos, sin contratos, sin servidor.** El sistema NO DEBE cambiar esquema,
migraciones, RLS, consultas, servicios, repositorios, acciones, rutas ni contratos de
entrada/salida. El cambio DEBE quedar contenido en la capa de presentación
(`app/(app)/cierres-admin/_components/`), en el CSS global y en `tests/`.

**R23 — Sin tocar el texto ni la semántica accesible.** El sistema NO DEBE cambiar
ningún texto visible, `aria-label`, nombre accesible, `role` ni estructura de las dos
hojas. Los tests de componente y los E2E localizan la factura por esos nombres
(`cierre-factura.tsx:136-137` lo dice explícitamente).

**R24 — Toda guardia nueva DEBE verse fallar.** El sistema NO DEBE dar por verificada
ninguna guardia de esta feature sin haberla visto **en rojo** ante una mutación
concreta y anotada. La lista mínima está en `design.md §6.6` e incluye, **de forma
obligatoria**, la que demuestra que el bloque `@media print` colocado detrás de
`.dark` envenena el lector de tokens y lo deja midiendo los pares **claros** como si
fueran los oscuros —**en verde**—. Una guardia que nadie vio morder no es evidencia.

---

## Grupo F — El instrumento de medida *(D9)*

**R25 — Una sola fórmula de contraste en todo el repo, y en un sitio compartido.** El
sistema DEBE extraer la aritmética de contraste —hoy encerrada dentro de un archivo de
test, `contraste-tokens.guardia.test.ts:72-109` (`aRgb`, `luminancia`, `contraste`,
`componer`) y `:126-170` (el lector de tokens de `app/globals.css`)— a un **fixture
compartido**, siguiendo el patrón de `tests/fixtures/sin-comentarios.ts`. La guardia
de la 210 DEBE pasar a consumirla desde ahí **sin cambiar sus autocontroles**, y el
sistema NO DEBE admitir una segunda copia de esa aritmética en ningún otro archivo de
`tests/`.

> **Por qué también el lector de tokens, y no sólo las dos funciones.** Sin él, la
> guardia nueva de esta feature necesita **un segundo parser** de `app/globals.css`
> — exactamente lo que la feature 209 vino a cerrar (74 archivos con su propio
> quitador y **cinco semánticas distintas**). Y hay una razón más fuerte: la trampa de
> `@media print` (R24, `design.md §6.2`) hay que arreglarla **una vez**, en el lector
> compartido, o quedará arreglada en una guardia y viva en la otra. *(Extensión
> derivada por el spec_author sobre D9, declarada aquí para que sea revisable.)*

**R26 — Los autocontroles viajan con la fórmula y son condición previa.** El sistema
DEBE conservar, ejecutándose sobre la copia compartida, los tres autocontroles que la
210 ya tiene: la fórmula reproduce **tres razones publicadas por WCAG**
(`contraste-tokens.guardia.test.ts:176`), la composición alfa reproduce **sus dos
extremos** (`:183`), y el lector devuelve **el token vigente y no un hex que viva en un
comentario** (`:188`). SI cualquiera de los tres falla, ENTONCES ninguna medición de
esta feature DEBE considerarse válida. El sistema NO DEBE usar ninguna herramienta de
medición externa no verificada para sostener un requisito de esta ficha —en particular
`.claude/skills/impeccable/scripts/detector/`, expresamente **descartado** por D9.

---

## Trazabilidad R → test

El mapa propuesto está en `tasks.md §Mapa R → verificación`. Se completa con rutas
reales en `progress/impl_217.md` durante la implementación. Ningún requisito puede
quedar sin dueño; el reviewer rechaza si falta uno.

**Aviso de método, que este spec asume y que D9 vuelve exigible:** ninguna guardia de
este repo compone estilos, jsdom no calcula color heredado ni resuelve `@media print`,
y no hay harness de E2E ejecutable. Por eso la verificación se sostiene sobre **cuatro
piezas ejecutables** —censo de fuente, censo de CSS con espejo, aritmética de pares
sobre los tokens vigentes, y presencia de clases en el DOM de jsdom— y **ninguna de
ellas afirma «se ve bien»**. `design.md §6` lo desarrolla y dice, para cada una, qué
cubre y qué no.

---

## Preguntas abiertas

**Ninguna.** Las cinco de la primera ronda se cerraron en la puerta humana del
2026-08-13 y viven como D5-D9. Si al implementar aparece un par que no se puede medir
con la aritmética de tokens —una capa de opacidad sobre otra capa de opacidad, o un
color que el lector no sepa resolver—, **la regla es abstenerse**: se marca
**indeterminado**, no se le pone un número plausible, y se vuelve a la puerta. Un
verificador que rellena lo que no sabe no es optimista, es falso, y en este repo ya
mordió tres veces el mismo día.
