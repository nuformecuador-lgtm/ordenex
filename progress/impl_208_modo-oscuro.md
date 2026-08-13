# Feature 208 — terminar el modo oscuro (fase 1 de 2)

Rama `chore/208-navy-fijo`. Zona frontend. **Fase 1: deja el tema oscuro correcto. El
interruptor NO entra acá** (fase 2), para no encender algo con botones invisibles.

## La regla que se aplicó (una sola frase)

> El **navy que es SUPERFICIE se conserva**; el **navy que es tinta, línea o tinte sobre
> una superficie que gira con el tema se migra**.

Y su simétrica, que resultó ser el otro defecto del mismo tamaño:

> Un token que **gira** (`-strong`, `foreground`, `card`…) no puede ir sobre un fondo
> **fijo** (`-soft`, `asfalto-*`) sin su variante `dark:`.

Ambas quedaron escritas en `DESIGN.md` → «Tokens que GIRAN con el tema y tokens FIJOS».

## Censo: 42 usos migrados, 45 conservados

Medido con un script que **excluye comentarios** (si no, la propia documentación que se
añadió infla el número) y que **se autocomprueba** con 7 casos antes de contar: usos
reales, prosa, tres formas de comentario y la declaración del token.

| | usos reales | archivos |
|---|---|---|
| antes (HEAD, vía `git archive`) | 88 | 31 |
| después | 46 | 19 |
| **migrados** | **42** | |

(La ficha decía «92 en 32»; ese conteo incluye las 2 declaraciones del token en
`globals.css` y menciones en prosa. Los **88** son los que Tailwind compila.)

### Conservados, con su motivo

| dónde | usos | por qué se conserva |
|---|---|---|
| `cierres-admin/_components/cierre-factura.tsx` | 16 | **Correctos: la hoja tiene superficie FIJA propia** (`tema-claro`). Ver «El cabo suelto, cerrado» abajo. |
| `app/_landing/*` (Hero 4, Banda 4, Postular 2, Footer 1, Nav 1) | 12 | Landing pública: superficie **fija por diseño**, arte compuesto sobre fotografía. Blindada con `tema-claro`. |
| `pos-card/PosOrderCardMosaico` 3, `PosCardHeader` 2, `pos-estado` 2, `PosNavBlock` 1, `PosOrderCardDetalle` 1, `AsignacionDetalle` 1, `GestionarOrdenPanel` 1, `SateliteOrderCard` 1 | 12 | Bloques `bg-navy` **sólidos con texto blanco**: superficie fija con tinta fija. **13.2:1 en los dos temas**, porque ninguno de los dos colores gira. |
| `login/page`, `postulacion/page`, `recuperar-contrasena/page` | 3 | El panel de marca de escritorio (`bg-navy` + texto blanco). Mismo caso. |
| `RankingPodio` (chips de premio) | 2 | `text-navy-deep` sobre `bg-warning` / `bg-brand-light`: fijo sobre fijo, **7.3:1 y 12.7:1** en los dos temas. |
| `tests/components/LandingPage.test.tsx` | 1 | Afirma que la landing sigue siendo navy. Sigue siendo cierto. |

### Migrados

| archivo | de | a |
|---|---|---|
| `app/_components/LogoutButton.tsx` | `border-navy/40 text-navy hover:bg-navy/10 hover:text-navy` | `text-foreground hover:bg-foreground/10` (borde del propio `variant="outline"`) |
| `components/shared/NotificationsBell.tsx` (14) | `text-navy`, `bg-navy/5`, `bg-navy/10`, `text-navy/70`, `bg-navy/[0.03]`, `ring-navy/40`, `bg-background`, `bg-danger`+`text-white` | `text-foreground`, `bg-foreground/10`, `text-muted-foreground`, `bg-foreground/5`, `ring-ring/50` (estándar de `DESIGN.md`), `bg-popover`/`text-popover-foreground`, `bg-danger-strong`+`text-background`; icono `box` → `text-info-strong` |
| `components/ui/tabs.tsx` (5) | `border-navy text-navy hover:bg-navy/10 aria-selected:bg-navy/10` | `border-foreground text-foreground hover:bg-foreground/10 aria-selected:bg-foreground/10` |
| `RecuperarContrasenaForm` 4, `LoginForm` 2, `PostulacionForm` 2 | `text-navy dark:text-foreground` | `text-foreground` (decía dos veces lo mismo) |
| `login/page`, `postulacion/page`, `recuperar-contrasena/page` | `Logo text-navy` (wordmark de móvil, `md:hidden`) | `text-foreground` |
| `pos-card/PosCardHeader.tsx` | `border-b-4 border-navy` | `border-foreground` |
| `pos-card/PosAmountRow.tsx` | `border-navy/30` | `border-foreground/30` |
| `mis-asignaciones/KpisMensajero.tsx` | `text-navy` (KPIs de **dinero**) | `text-foreground` |
| `ordenes/EstatusBadge.tsx` (2) | `text-navy dark:bg-navy/20 dark:text-asfalto-2` | `text-foreground dark:bg-foreground/10` |
| `shared/Pagination.tsx` | `from-navy/10` | `from-foreground/10` |
| `shared/ColumnasManifiestoPopover.tsx` | `bg-background text-navy` | `bg-popover text-popover-foreground` |
| `paquete/[numGuia]/page.tsx` | `Logo text-navy` | `text-foreground` |

### Fuera del censo navy, mismo bug de fondo

- **`Sidebar.tsx`** — el rol del pie (`text-sidebar-foreground/70`) medía **4.47** en claro
  y 4.54 en oscuro. A `/85`: **5.91 / 6.13**, y sigue leyéndose como secundario.
- **`RankingPodio.tsx`** — pedestales `-soft`/`asfalto` (fijos) con tinta `-strong` (que
  gira): en oscuro «1º lugar» daba **1.50** y el porcentaje **1.23**. Se aplicó la técnica
  soft-badge de `DESIGN.md` (`dark:bg-{sem}/15` + `dark:text-{…}`), la misma de `Badge`.
- **`wallet/CajaResumenCard.tsx`** — el importe «de terceros» iba en `text-warning-strong`
  sobre `bg-warning-soft`: **4.51:1** en claro. Pasa el 4.50 por una centésima, y es
  dinero. La cifra pasa a `text-foreground` (**14.10**); el aviso lo siguen dando el
  icono, el rótulo, el borde y el fondo.

## El medidor, y por qué se puede creer

`scratchpad/medir-208.mjs` (Playwright vía `createRequire`). Barre **todo** el texto
visible de cada ruta, en los **2 temas** × los **5 roles**, componiendo el alpha contra la
pila de fondos hasta el primer ancestro opaco.

**Autocomprobación previa (aborta con exit 2 si algo falla):**
- 7 conversiones de color, **3 de ellas `lab()`** — que es exactamente lo que Chromium
  devuelve para las utilidades con opacidad (`color-mix`) y lo que un parseo ingenuo
  convierte en una tabla entera de números plausibles e inventados:
  `lab(54.2905 80.8095 69.8910)` → `#ff0000` (parseado como rgb daría un verde oscuro),
  `lab(29.5683 68.2986 -112.0294)` → `#0000ff`,
  `lab(14.1821 0.289634 -23.4347 / 0.05)` → navy al 5 %.
  Más un centinela que detecta que el navegador **no supo parsear** el color en vez de
  devolver silenciosamente el color anterior.
- 4 ratios WCAG publicados: negro/blanco **21.00**, `#767676`/blanco **4.54** (el límite AA
  clásico), rojo/blanco **3.998**, azul/blanco **8.592**.
- 1 composición con alpha: blanco al 50 % sobre negro → 127.5.

Salida: `autocomprobacion del medidor: OK (7 conversiones incl. 3 lab() + 4 ratios WCAG +
1 composicion alpha)`.

**Tres trampas propias que la autocomprobación (o la relectura) cazaron, y valen tanto como
el resultado:**

1. **Los `transition-all` mienten si medís rápido.** Con 80 ms tras cambiar de tema, el
   **primer rol** de cada bloque salía con colores a medio interpolar: el mismo badge daba
   **3.58** para `maestro` y **4.88** para los otros cuatro. Ese 3.58 es un número
   plausible y falso. Con 700 ms tras el tema y 450 ms tras el rol, los cinco coinciden.
2. **El marcador de dinero midió 0 importes y no se notó.** El regex vivía dentro de un
   template literal, así que `\s` y `\d` llegaban al navegador como `s` y `d` y
   `dinero` daba `false` **siempre** — 4620 importes "revisados", ninguno detectado, verde
   falso. Corregido a `\\s`/`\\d` y añadido un corte explícito («NINGUN importe detectado
   — el marcador esta roto, no es que no haya dinero», exit 3).
3. **El servidor de dev sirve CSS viejo, y eso da un falso NEGATIVO.** Al medir el cierre
   del cabo suelto, la primera comparación dijo que `tema-claro` **no hacía nada**: la hoja
   seguía navy. Era cierto en pantalla y falso como conclusión — el dev server llevaba
   sirviendo `globals.css` de antes de que se declarara `.tema-claro`, y la regla
   sencillamente **no estaba en el CSS servido** (`document.styleSheets` → `:root`, `.dark`,
   `:root`; ni rastro de `.tema-claro`). Se distinguió «lo strippea el pipeline» de «el
   servidor está rancio» metiendo un marcador de usar y tirar (`--sonda-208: 42`) en el
   bloque y volviendo a leer el CSS: apareció, y con él `.tema-claro`. **De no haberlo
   comprobado, la conclusión habría sido «el mecanismo no sirve» y el arreglo habría sido
   otro, peor.** Regla que queda: antes de concluir «esta clase no hace nada», leer el CSS
   **servido**, no el del archivo.

**Rutas medidas:** `/wallet`, `/dashboard`, `/ordenes`, `/analitica`, `/ranking` (admin),
`/mis-asignaciones` (mensajero), y `/`, `/login`, `/postulacion`, `/recuperar-contrasena`
sin sesión **y a dos anchos** (1440 y 390 — el wordmark navy de las páginas de auth vive en
`md:hidden` y a 1440 no se ve).

Los 5 roles se recorren poniendo `data-rol` sobre el `[data-slot="sidebar-inset"]`, que es
exactamente lo que hace el layout: se ejercita el CSS compilado, sin 5 logins.

**Tabs:** `/novedades` es exclusiva de `adminTienda` y `tienda.qa` pide OTP. En vez de
inventar el número, `scratchpad/medir-tabs.mjs` inyecta en `/ordenes` un elemento con la
**cadena de clases exacta** de `TabsTrigger` y comprueba que el CSS compilado la aplica
(si el borde saliera igual que el de un `<div>` pelado, aborta).

## Contraste antes → después (ratio WCAG, umbral 4.5)

Sin flecha = no cambió.

### Tema CLARO — `/wallet`, por rol

| elemento | maestro | admin | adminSatelite | adminTienda | mensajero |
|---|---|---|---|---|---|
| h1 encabezado | 13.45 | 13.27 | 12.77 | 13.76 | 13.52 |
| descripción | 6.60 | 6.51 | 6.26 | 6.75 | 6.63 |
| chip de fecha | 12.25 | 12.08 | 11.64 | 12.53 | 12.31 |
| **botón Salir** | 13.18 → **13.45** | 13.01 → **13.27** | 12.52 → **12.77** | 13.49 → **13.76** | 13.25 → **13.52** |
| **campana** | 13.18 → **13.45** | 13.01 → **13.27** | 12.52 → **12.77** | 13.49 → **13.76** | 13.25 → **13.52** |
| **contador campana** | 3.76 → **6.10** | 3.76 → **6.10** | 3.76 → **6.10** | 3.76 → **6.10** | 3.76 → **6.10** |
| insignia Ingreso/Egreso | 5.30 | 5.30 | 5.30 | 5.30 | 5.30 |
| importe (tabla) | 5.48 | 5.48 | 5.48 | 5.48 | 5.48 |
| sidebar: nombre | 7.64 | 7.64 | 7.64 | 7.64 | 7.64 |
| **sidebar: rol** | 4.47 → **5.91** | 4.47 → **5.91** | 4.47 → **5.91** | 4.47 → **5.91** | 4.47 → **5.91** |
| sidebar: item nav | 7.64 | 7.64 | 7.64 | 7.64 | 7.64 |
| sidebar: item activo | 12.81 | 12.81 | 12.81 | 12.81 | 12.81 |

### Tema OSCURO — `/wallet`, por rol

| elemento | maestro | admin | adminSatelite | adminTienda | mensajero |
|---|---|---|---|---|---|
| h1 encabezado | 13.88 | 14.01 | 14.40 | 13.36 | 13.41 |
| descripción | 7.28 | 7.35 | 7.56 | 7.01 | 7.03 |
| chip de fecha | 12.23 | 12.35 | 12.79 | 11.71 | 11.80 |
| **botón Salir** | 1.06 → **12.26** | 1.04 → **12.42** | 1.03 → **12.63** | 1.09 → **11.96** | 1.09 → **11.94** |
| **campana** | 1.07 → **13.88** | 1.08 → **14.01** | 1.11 → **14.40** | 1.03 → **13.36** | 1.03 → **13.41** |
| **contador campana** | 3.76 → **6.63** | 3.76 → **6.63** | 3.76 → **6.63** | 3.76 → **6.63** | 3.76 → **6.63** |
| insignia Ingreso/Egreso | 4.88 | 4.88 | 4.88 | 4.88 | 4.88 |
| importe (tabla) | 8.47 | 8.47 | 8.47 | 8.47 | 8.47 |
| sidebar: nombre | 8.06 | 8.06 | 8.06 | 8.06 | 8.06 |
| **sidebar: rol** | 4.54 → **6.13** | 4.54 → **6.13** | 4.54 → **6.13** | 4.54 → **6.13** | 4.54 → **6.13** |
| sidebar: item nav | 8.06 | 8.06 | 8.06 | 8.06 | 8.06 |
| sidebar: item activo | 14.88 | 14.88 | 14.88 | 14.88 | 14.88 |

Los cinco fondos por rol siguen sin tocarse (la 202 ya los midió) y siguen aguantando: el
mismo elemento varía como mucho 0.7 entre roles.

### Piezas fuera de `/wallet` (iguales en los 5 roles)

| pieza | claro antes → después | oscuro antes → después |
|---|---|---|
| Tab inactiva (texto y borde) | 14.50 → **14.79** | **1.19 → 15.47** |
| Tab activa (texto) | 14.50 → **12.19** | 1.19 → **12.14** |
| Podio 1º «1º lugar» (oro) | 4.51 → 4.51 | **1.50 → 7.59** |
| Podio 2º «2º lugar» (plata) | 9.71 → 9.71 | 9.71 → **10.51** |
| Podio 3º «3º lugar» (bronce) | 3.74 → 3.74 (ver «no se tocó») | **3.74 → 7.37** |
| KPI dinero mensajero | 15.39 → 15.70 | **1.06 → 13.74** |
| Wordmark login/postulación/recuperar (móvil) | 14.79 → 14.79 | **1.06 → 15.47** |

Salvedad honesta sobre la tab **activa**: su «antes» no es comparable. Al retirar
`bg-navy/10` del código, Tailwind deja de emitir esa utilidad, así que la sonda aislada no
pudo reproducir el relleno anterior y midió la activa sin fondo (de ahí el 14.50 idéntico
al de la inactiva). El «después» —12.19 / 12.14, con relleno— sí es real.

Del podio, las filas medidas son los rótulos «1º/2º/3º lugar», que son texto real. Los
porcentajes no se pudieron medir con datos reales: el ranking de QA no tiene ocupantes y lo
que se pinta es el guion del estado vacío, atenuado a `opacity-50` a propósito (ver «no se
tocó»).

### Dinero — TODOS los importes en pantalla

El barrido detecta y mide cada importe, no una muestra.

| | mínimo | dónde estaba el mínimo |
|---|---|---|
| antes | **1.06** | `₡0,00` — KPI del mensajero, oscuro |
| después | **5.19** | `₡4.343,50` — `text-success-strong` en tabla, claro |

4620 importes medidos por pasada. **Ninguno queda por debajo de 5.19 en ningún tema.** Los
dos que estaban al filo:
- `₡0,00` / `₡26.000,00` (KPIs del mensajero): **1.06 → 13.74**.
- `₡124.100,00` («de terceros», wallet): **4.51 → 14.10** en claro, 8.62 → 12.15 en oscuro.

## Páginas públicas: qué se decidió

**Landing (`/`) → CLARA POR DISEÑO.** Su arte está compuesto sobre fotografías y una paleta
fija (`kraft-*`, `asfalto-*`, `navy-deep`, `-soft`). No se le pone tema oscuro.

**Pero NO era inmune «de rebote», y eso hubo que arreglarlo.** `LandingServicios` usa
`text-success-strong` en dos chips, y los cuatro `-strong` **sí** tienen variante en
`.dark`: el día que la fase 2 ponga `.dark` en `<html>`, ese verde oscuro se vuelve verde
claro sobre un fondo `-soft` que sigue siendo claro (**~1.7:1**). Arreglo de raíz en vez de
parche: `globals.css` declara ahora `:root, .tema-claro { … }` y `app/page.tsx` lleva
`tema-claro` en su raíz. Cualquier token futuro queda cubierto solo.

**Verificado, no supuesto:** en la pasada final, las 45 entradas de páginas públicas dan
**exactamente el mismo ratio en claro y en oscuro** (p. ej. «Trabajá con nosotros» 2.88 en
ambos, «S-01» 3.03 en ambos). El tema ya no las alcanza.

**Login / postulación / recuperar-contraseña → THEME-AWARE, y se terminó de hacerlas así.**
No son claras por diseño: su panel de formulario ya usaba `bg-background` y sus títulos ya
traían `dark:text-foreground`. Lo único que se quedaba atrás era el wordmark de móvil
(`md:hidden`, por eso no salía en un barrido a 1440). El panel de marca lateral (`bg-navy`
+ texto blanco) es superficie fija y se conserva.

**`/paquete/[numGuia]` → theme-aware.** Usa `bg-card`/`border-border`/`text-muted-foreground`;
solo el wordmark iba en navy fijo.

## El cabo suelto, CERRADO: la factura del cierre

El encargo original decía: no tocar `cierre-factura.tsx` porque **es un documento impreso y
el papel siempre es blanco**. Se respetó, pero la premisa no se sostenía contra el código
(**no se imprime**: no hay `window.print()`, ni `@media print`, ni hoja de impresión en el
repo; los PDF de etiquetas van por otra vía y su archivo dice explícitamente que no usa
`print()`). Medido entonces: la hoja va en `<Card>` → `bg-card`, que gira, y el `text-navy`
no → **1.06:1 en oscuro**. Con esa medición sobre la mesa, el humano cerró el cabo: **la
hoja es papel, y su superficie es fija a propósito.**

### Cómo se cerró — y por qué NO como decía la recomendación anterior

La nota anterior recomendaba «una línea: `bg-white text-navy` en `HojaFactura`». **Se midió
antes de escribirla, y estaba mal.** Dentro de la hoja hay **143 textos**: solo 16 son navy
fijo; los otros ~127 usan tokens que **giran** (`muted-foreground`, `border`,
`card-foreground`, los cuatro `-strong`, `Badge`, `Button`). Pintar el papel sin mover los
tokens deja la tinta del tema en su valor oscuro. Los tres escenarios, en oscuro, sobre el
detalle en `/cierres-admin`:

| escenario | textos < 4.5:1 | mínimo |
|---|---|---|
| sin tocar nada | **20** | 1.00 |
| `bg-white` a secas (la recomendación anterior) | **116** | 1.04 |
| **`tema-claro`** (lo aplicado) | **3** | 3.36 |

Los 116 son el otro defecto de la ficha —«un token que gira no puede ir sobre un fondo
fijo»— cometido a propósito y a escala: la línea no arregla el bug, lo multiplica por seis.
Y los 3 que quedan **son exactamente los 3 que ya fallan en tema claro** (preexistentes, ya
en la tabla de «lo que no se tocó»).

Lo aplicado es `tema-claro` —la clase que esta misma feature ya había declarado en
`globals.css` para la landing— en el `<Card>` de **las dos** hojas. Fija los valores CLAROS
de todos los tokens del subárbol, así que papel, tinta, bordes, badges y botones quedan en
tema claro de una pieza, y los 16 navy vuelven a ser correctos por emparejamiento, no por
excepción.

**Las dos hojas, no solo una.** `HojaFactura` (el detalle, dentro del modal) tiene 11 de los
16 navy; `HojaResumen` (el comprobante compacto de la tira «Vista tipo factura») tiene los
otros 5, y medía **1.00–1.06** igual. Es el MISMO documento —su nombre accesible es
literalmente «Comprobante del cierre de…» y su botón abre la otra hoja—: dejar una en papel
y la otra girando con el tema le daría dos materiales al mismo comprobante.

### Contraste antes → después (la hoja completa, todos sus textos)

| hoja | tema | antes: <4.5 / mínimo | después: <4.5 / mínimo | fondo del papel |
|---|---|---|---|---|
| resumen (30 textos) | claro | 3 / 1.23 | **3 / 1.23** (sin cambio) | #ffffff → #ffffff |
| resumen (30 textos) | oscuro | 10 / **1.00** | **3 / 1.23** | #10203a → **#ffffff** |
| detalle (143 textos) | claro | 3 / 3.36 | **3 / 3.36** (sin cambio) | #ffffff → #ffffff |
| detalle (143 textos) | oscuro | 20 / **1.00** | **3 / 3.36** | #10203a → **#ffffff** |

**Dinero:** de los que fallaban en oscuro, **5 en el resumen y 9 en el detalle eran importes**
(`₡124.100,00` a 1.06, `₡18.468,16` a 1.01, los totales por método a 1.00…). Después:
**0 importes por debajo de 4.5 en ningún tema.** El marcador de dinero se comprobó que muerde
(48 importes detectados en el detalle) antes de creerle el cero.

Los 3 que quedan en cada hoja, para que no se lean como nuevos: en el resumen son los dos
separadores `|` (`text-border`, decorativos, `aria-hidden`) y el wordmark «Ordenex» en naranja
de marca (3.18, el mismo caso que el botón primario de toda la app); en el detalle son la nota
de «Ingreso bruto» en `success-strong/80` (3.36) y las dos píldoras de conteo en `warning/15`
(4.48). **Los seis dan el mismo número en claro que en oscuro, antes y después.**

### El tema claro NO se movió: comprobado texto a texto

No «se ve igual»: se comparó cada elemento por texto + color + fondo + ratio, antes vs
después, con la misma pasada del medidor.

```
resumen/claro:  30/30  idénticos   · fondo IGUAL (#ffffff)
detalle/claro: 143/143 idénticos   · fondo IGUAL (#ffffff)
```

Y lo que la hoja promete —mismo papel en los dos temas— también se comprobó así:
`detalle` **143/143 idénticos** entre claro y oscuro; `resumen` **28/30**, y las 2
diferencias son el botón «Ver detalles» (14.79 → 14.78 y 14.26 → 14.78), que es la fuga
`dark:` de abajo.

### Lo que `tema-claro` NO apaga (medido, incluido lo que no sale bien)

El variant `dark:` se define contra el **ancestro** (`&:is(.dark *)`), no contra los tokens:
dentro de un subárbol `tema-claro` **sigue disparando**. Los datos de QA solo traen un cierre
`aprobado`, así que los demás estados se midieron inyectando las **cadenas de clases exactas**
de `Badge`/`Button` en un host que reproduce el contexto real (`tema-claro bg-card
text-card-foreground`), con una comprobación previa de que la sonda muerde.

| pieza | claro | oscuro + `tema-claro` | |
|---|---|---|---|
| `Badge` secondary / outline, `Button` default | — | — | **idénticos** |
| `Button` outline («Ver», «Ver detalles») | 14.79 | 14.78 | un tinte |
| `Badge` success / danger | 4.84 · 5.30 | 4.76 · 5.32 | pasan |
| `Badge` warning | 4.51 | **4.48** | cruza el umbral por 0.02 |
| `Badge` + `Button` destructive (estado `rechazado`/`vencido`, «Destrabar») | **3.30** | **2.89** | ya fallaba en claro |

**Ninguno de los dos que quedan bajo AA es daño nuevo de esta clase:** `text-destructive`
sobre `bg-destructive/10` ya da 3.30 en tema claro, y el `--warning-strong` que pasa AA por
0.01 ya estaba anotado arriba como recomendación abierta. La fuga los mueve 0.41 y 0.03.
Arreglarlos es tocar esas variantes en **toda** la app —decisión de diseño, no de este
archivo—; y el arreglo de raíz de la fuga sería el propio variant `dark:`, no un parche por
componente. Queda escrito en `globals.css`, en `DESIGN.md` y en la cabecera del componente.

**Primera vez que se corrige a sí misma una recomendación de esta ficha**, y el motivo vale
tanto como el resultado: la recomendación estaba escrita pero **no medida**. Medirla costó
una pasada y evitó multiplicar el bug por seis.

## Lo que NO se tocó y por qué (todo medido)

Ninguno es una regresión de modo oscuro: **todos existen igual o peor en tema claro**, y
arreglarlos es cambiar la paleta de marca, que no me corresponde.

| caso | claro | oscuro | por qué se deja |
|---|---|---|---|
| Blanco sobre `bg-primary` (#f26419): botón primario, avatar, página activa de la paginación | **3.18** | 2.75 | Es el naranja de marca con su texto. Cambiarlo es decidir la marca. Afecta a `Button` default en toda la app. |
| `text-primary` sobre el fondo: «Descargar», «Histórico» | **2.99** | pasa | Ídem: naranja de marca sobre fondo claro. |
| Leyendas de recharts (`text` del color de la serie) | 2.02–2.99 | 2.97 | El color **codifica el dato**; el texto hereda el color de la serie. Es un rediseño de la paleta de gráficos. |
| Podio 3º «3º lugar» (`text-brand-dark` sobre `bg-brand-soft`) | **3.74** | 7.40 (arreglado) | En oscuro ya se arregló. En claro es fijo-sobre-fijo y pediría un `--brand-strong` que no existe. |
| Placeholder «—» del podio sin ocupante (`opacity-50`) | 1.91–2.64 | 2.98–3.88 (mejoró) | Relleno decorativo de un estado vacío, atenuado a propósito; ya fallaba en claro. |
| Flechas «/» de paginación, placeholder «Todos los distritos» | 3.13 | 4.40 (mejor) | `muted-foreground` sobre el fondo; pre-existente y no navy. |
| **`text-warning-strong` sobre `bg-warning-soft` = 4.51 en claro** | **4.51** | 7.6 | **Recomendación abierta:** pasa AA por 0.01 y afecta a la variante `warning` de `Badge` en toda la app. Con `--warning-strong: #92400e` (ámbar-800) daría **6.38** sobre el `-soft` y 7.10 sobre la card. Es un cambio de token con radio grande: decisión de diseño, no la tomé yo. |

## Verificación

```
pnpm exec vitest run tests/components tests/unit/guards
  Test Files  203 passed (203)
       Tests  2559 passed (2559)
   Duration   162.79s                                   exit 0

pnpm exec tsc --noEmit                                  exit 0
```

Y tras cerrar el cabo de la factura, sin cambios en los números:

```
pnpm exec vitest run tests/components tests/unit/guards
  Test Files  203 passed (203)
       Tests  2559 passed (2559)
   Duration   163.87s                                   exit 0

pnpm exec tsc --noEmit                                  exit 0
```

Ningún test afirmaba clases navy salvo `LandingPage.test.tsx` (`.bg-navy-deep`), que sigue
siendo cierto porque la landing se conserva.

Capturas antes/después de `/wallet`, `/ordenes`, `/ranking`, `/mis-asignaciones` y del login
móvil, en los dos temas, en el scratchpad de la sesión.

## El rojo del gate: el extractor de `globals.css`, no la paleta

`tests/unit/components/analytics-paleta.test.ts` cayó con «`--chart-1` falta en `:root`».
**Los tokens estaban.** Lo que se rompió fue la forma de trocear el CSS: el test buscaba la
**cadena literal `":root {"`**, y la fase 1 cambió el bloque a `:root,\n.tema-claro { … }`.
Al no encontrarla, `indexOf` se enganchó al **siguiente** `:root {` del archivo —el de
`--vista-cards-*-ms`, ~180 líneas más abajo— y concluyó que faltaba la paleta. Un falso rojo
con un mensaje perfectamente convincente.

### Cómo se localiza el bloque ahora

Se cambió el **extractor**, no la aserción (sigue siendo `toContain('--chart-N:')` sobre raíz
y sobre `.dark`). `cuerposDeRegla(css, selector)`:

1. **Quita los comentarios** antes de trocear.
2. Recorre el CSS con una **pila de llaves**, así que cada regla sabe cuál es su prelude
   (lo que hay entre el último `;`/`{`/`}` y su propia `{`) y cuál su cuerpo.
3. Parte el prelude por **comas de primer nivel** (`selectoresDe`: no corta dentro de
   `:is(a, b)` ni de `[attr="x,y"]`), normaliza espacios y pregunta si `:root` está en la
   lista **como elemento propio**.
4. Devuelve el cuerpo de **todas** las reglas que aplican a ese selector, unidas.

Aguanta que mañana se añada otro selector a la lista, que cambie el orden o el espaciado, y
—al recoger todas las reglas y no la primera— que los tokens se repartan en varios bloques,
que es lo que el CSS realmente hace.

### ¿Estaba el patrón copiado en otros tests?

**No.** Los tres archivos que tocan `globals.css` se revisaron: `LandingPage.test.tsx` lo
comprueba con regex sobre el archivo entero (`prefers-reduced-motion`, `scroll-behavior`) y
no trocea; `superficie-de-uso.guardia.test.ts` solo lo menciona como cadena dentro de un
fixture de imports. Un rastreo en todo el repo de `":root` / `'.dark ` da **una sola**
ocurrencia: la de este test. Nada más que arreglar.

### Verificación por mutación (el riesgo era dejarlo laxo)

Sobre una **copia** de `globals.css` —el archivo tiene trabajo sin commitear, así que
revertir con `git checkout` habría borrado la fase 1—:

| # | mutación | veredicto |
|---|---|---|
| 1 | quitar `--chart-1` de la raíz | **ROJO** — `--chart-1 falta en :root` |
| 2 | quitar `--chart-1` de `.dark` | **ROJO** — `--chart-1 falta en .dark` |
| 3 | dejar `--chart-1` en la raíz **solo como comentario** | **ROJO** — sin el stripping de comentarios esto habría pasado en verde |
| 4 | que el bloque de tokens deje de aplicar a `:root` (solo `.tema-claro`) | **ROJO** — se engancha al `:root` de animaciones y no encuentra la paleta |

La 3 y la 4 son las que demuestran que no se volvió permisivo: la 3 mata el atajo de «la
cadena aparece en algún sitio del bloque» y la 4 mata el de «con que exista un `:root`
cualquiera, vale». Tras cada una, `git hash-object app/globals.css` devuelve
`8f57e50efe5a87cd1f182b6abd7c4720ea2cc4b0`, idéntico al de antes de mutar.

```
pnpm exec vitest run tests/unit/components/analytics-paleta.test.ts
  Test Files  1 passed (1)
       Tests  6 passed (6)                                exit 0

pnpm exec vitest run tests/unit tests/components
  Test Files  889 passed (889)
       Tests  11358 passed (11358)
   Duration   254.51s                                     exit 0

pnpm exec tsc --noEmit                                    exit 0
pnpm exec eslint tests/unit/components/analytics-paleta.test.ts   exit 0
```

## Para la fase 2 (el interruptor)

- El `.dark` va en `<html>`; la landing y las dos hojas de la factura ya están blindadas con
  `tema-claro`. Comprobado con el CSS **servido** (no solo con el archivo): la clase llega, y
  en la landing `--success-strong` se queda en `#047857` con `.dark` puesto.
- Si el interruptor persiste preferencia, cuidado con la hidratación (el patrón de
  `usePreferenciaSonido` ya resuelve «fuente externa a React» en este repo).
- Queda **un** abierto, no dos: `--warning-strong` (pasa AA por 0.01 en claro y por −0.02
  dentro de un subárbol `tema-claro`). La superficie de la factura ya está decidida y
  aplicada.
- Deuda anotada, de radio grande y ajena a esta feature: `text-destructive` sobre
  `bg-destructive/10` da **3.30** en tema claro en `Badge`/`Button` variante `destructive`.
  No es de modo oscuro —falla igual hoy—, pero salió medido al cerrar la factura.
