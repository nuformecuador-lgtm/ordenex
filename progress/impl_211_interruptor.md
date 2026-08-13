# Feature 211 — el interruptor de tema en el encabezado (fase 2 de 2)

Rama `feature/211-interruptor-tema`. Zona frontend. La fase 1 (ficha 208) dejó el tema
oscuro correcto; **esto es lo que lo enciende**.

## Antes de nada: la rama no traía la fase 1

`feature/211-interruptor-tema` se había creado desde `dev` (`911d6255`) y **la 208 no está
mergeada a `dev`**: vive en `chore/208-navy-fijo`. Sin ella no existían ni `tema-claro`, ni
la landing blindada, ni `progress/impl_208_modo-oscuro.md`, ni la ficha 211 en
`feature_list.json`. Se trajo con **fast-forward** (`911d6255 → e60a2143`, sin merge commit
y sin conflictos, porque la 208 ya había mergeado `dev` dentro). **Este PR depende de que la
208 entre antes o a la vez.**

## Dónde se estampa la clase, y por qué ahí

**En un envoltorio del portal** (`providers/TemaProvider.tsx`, montado por
`app/(app)/layout.tsx`), **no en `<html>`**. El CSS declara el variant contra
DESCENDIENTES (`&:is(.dark *)`), así que cualquier ancestro sirve; y llevarlo a `<html>`
obligaría a leer la cookie en el layout raíz, que hoy es estático y sirve la landing
pública.

**El envoltorio es `display: contents`.** No crea caja, así que el layout de la app queda
EXACTAMENTE como estaba —el `sidebar-wrapper` sigue siendo el hijo flex del `<body>`— y aun
así las variables CSS y el selector `.dark *` alcanzan a todo el árbol. Medido:
`getComputedStyle(envoltorio).display === "contents"` y ninguna caja nueva.

### La trampa del enunciado, medida y resuelta de otra forma

El encargo avisaba: si la clase va en un `div` y nadie pinta el fondo, **el `<body>` se
queda claro**. Es cierto y es peor que eso: el `<body>` no solo pinta su propia caja, sino
que su fondo **propaga al lienzo del navegador**. Pintar el envoltorio con `bg-background`
lo tapa mientras el envoltorio cubra todo el alto — es decir, hasta que una página crezca,
encoja o alguien haga overscroll.

Se resolvió **al revés**: que el `<body>` tome los mismos tokens que su descendiente.

```css
.dark,
body:has(> .dark) { … }
```

`:has()` es lo único que deja a un ancestro reaccionar a un descendiente, y es exactamente
el caso. Coste: un selector. A cambio, el envoltorio no necesita pintar nada y no puede
haber franja porque no hay dos superficies que cuadrar.

**Verificado en el navegador, no de memoria** — `body`, sus hijos, `sidebar-wrapper`,
`sidebar-inset`, `main` y `header` en tema oscuro:

```
BODY.min-h-full.flex            -> rgb(10, 21, 36)   ← el lienzo
DIV.contents.dark               -> rgba(0, 0, 0, 0)  ← el envoltorio no pinta
DIV.group/sidebar-wrapper.flex  -> rgba(0, 0, 0, 0)
MAIN.relative.flex              -> rgb(10, 21, 36)
HEADER.flex.flex-row            -> lab(60.7379 53.4838 64.837 / 0.1)  ← el tinte por rol
cajas con fondo CLARO en tema oscuro: ninguna
```

## Cómo se aplica al instante, sin pedir permiso al servidor

Dos escrituras en el mismo manejador, y cada una resuelve una mitad del ciclo:

1. **`setTema(siguiente)`** — estado de React en el proveedor. La clase del envoltorio
   cambia en el mismo frame. Nadie espera a un servidor para ver cambiar un color.
2. **`document.cookie = …`** — para que la **siguiente** carga ya venga del servidor con la
   clase puesta. Es la misma técnica que ya usa `components/ui/sidebar.tsx` con
   `sidebar_state`.

**No es una Server Action a propósito**, y no contradice la regla de mutaciones del repo:
no se está mutando dominio, es una preferencia de presentación de tres valores. Una Server
Action metería un viaje de red en la ruta crítica de «pulsar y ver» — justo lo que se pide
evitar. La cookie va con `path=/`, `max-age` de un año y `SameSite=Lax`; **no** es
`HttpOnly`, porque el cliente tiene que poder escribirla.

Hidratación: el proveedor arranca con `useState(temaInicial)`, y `temaInicial` es lo que
resolvió el servidor. El primer render del cliente coincide con el HTML recibido.

## «Sistema» es el estado por defecto y no gasta ni JS ni cookie

`@media (prefers-color-scheme: dark)` sobre la clase `tema-sistema`. Y **con dos ramas, no
una**, que es la parte que no estaba en el encargo y sin la cual el estado por defecto
quedaba a medio pintar:

```css
@custom-variant dark {
  &:is(.dark *) { @slot; }
  @media (prefers-color-scheme: dark) {
    &:is(.tema-sistema *) { @slot; }
  }
}
```

Si solo giraran los tokens y las utilidades `dark:` no dispararan, medio árbol caería en el
bug que la 208 documentó como el más repetido del repo: «un token que gira sobre un fondo
fijo» (`Badge` success/warning/danger, `Button` outline/destructive, `EstatusBadge`…).
**Medido sobre el CSS servido: 50 utilidades `dark:` con rama por clase y las MISMAS 50 con
rama por preferencia del sistema; 0 en una sola.**

### Va acotado al portal, no colgado de `:root`

El encargo decía «`@media (prefers-color-scheme: dark)` en `globals.css`» sin más. Colgarlo
de `:root` habría hecho que **la landing y las tres páginas de auth cambiaran solas** según
el sistema operativo de quien mira. Y ahí hay una premisa del encargo que **no se
sostiene**: la fase 1 blindó con `tema-claro` la landing, sí, pero **NO las tres páginas de
auth** — su propio informe dice que son *theme-aware* por diseño (`bg-background`,
`dark:text-foreground`). Con la media query global habrían virado a oscuro con un SO
oscuro. Acotándola a `.tema-sistema`, que solo existe dentro de `(app)`, no se enteran.

### El precio: un bloque de tokens duplicado, con guardia

CSS no sabe reutilizar un bloque de declaraciones bajo otra condición, así que los 34
tokens de `.dark` están repetidos dentro del `@media`. No se deja a la buena fe:
`tests/unit/guards/tema-encendido.guardia.test.ts` compara los dos bloques declaración a
declaración y falla si divergen **en un hex o en un token de más o de menos** (mutaciones #4
y #4.1). Se evaluaron y descartaron `light-dark()` (rompe el troceo de
`analytics-paleta.test.ts` y no resuelve el variant) y la indirección por variables
`--oscuro-*` (más líneas, misma sincronización).

## El control

`components/shared/TemaToggle.tsx`, en el contenedor derecho del `PageHeader`, entre el
botón de instalar PWA y la campana. Cicla `sistema → claro → oscuro → sistema`.

- **Etiqueta visible** («Sistema»/«Claro»/«Oscuro») a partir de `sm`, además del icono
  (`Monitor`/`Sun`/`Moon`). Por debajo de `sm` el encabezado va justo de sitio y queda solo
  el icono, que conserva su nombre accesible. Un icono mudo que cicla no comunica nada con
  tres estados.
- **Nombre accesible que dice en cuál estás Y a cuál vas**: «Tema: Claro. Cambiar a
  Oscuro.». Empieza por la etiqueta visible (WCAG 2.5.3, *Label in Name*).
- **Región viva** que anuncia el estado ya aplicado: cambiar el `aria-label` de un botón
  enfocado no se re-anuncia de forma fiable.
- **`<button>` nativo** con el anillo estándar de `DESIGN.md`. Medido en el navegador:
  `:focus-visible` → `oklab(0.674118 0.140011 0.129901 / 0.5) 0 0 0 3px`, o sea
  `ring-3 ring-ring/50`, en los tres estados y en los dos temas. Enter y Espacio ciclan.

### Un hallazgo del camino: `role="status"` no podía quedarse

La región viva se escribió primero con `role="status"`. **El gate completo lo tumbó**:
`OrdenesPage` y `OrdenesPagination`, de otras features, hacen `getByRole("status")` para su
indicador de carga y pasaron a encontrar **dos** elementos. No es un problema de test: este
control está en **toda** página autenticada, así que un `role="status"` permanente vuelve
ambiguo ese rol en toda la aplicación y para cualquier feature futura. Se cambió a
`aria-live="polite" aria-atomic="true"` sin rol —`aria-live` es el mecanismo real;
`role="status"` solo lo implica— y las dos suites ajenas volvieron a verde **sin tocarlas**.

## Verificación en el navegador

Dev server ya levantado; Playwright vía `createRequire`. **El medidor aborta si fallan sus
controles** (7 conversiones incluidas 3 `lab()`, 4 ratios WCAG publicados y 1 composición
con alpha).

### Lo primero: que el CSS servido no esté rancio

La 208 dejó escrito que concluir «esta clase no hace nada» leyendo el archivo en vez del CSS
**servido** lleva a un arreglo peor. Aquí las cuatro piezas son nuevas, así que su presencia
en `document.styleSheets` es la sonda:

```
reglas totales en el CSS servido: 1661
regla de tokens .tema-sistema: '.tema-sistema @(prefers-color-scheme: dark)'
                               'body:has(> .tema-sistema) @(prefers-color-scheme: dark)'
reglas body:has: body:has(> .dark) [sin media] · body:has(> .tema-sistema) [prefers-color-scheme: dark]
utilidades dark: por CLASE 50 · por MEDIA 50 · en una sola rama 0
```

### 1. Los tres estados y el ciclo

| tema | clase del envoltorio | `body` | badge `dark:bg-success/15` | cookie | nombre accesible |
|---|---|---|---|---|---|
| sistema | `contents tema-sistema` | `#f7f8fc` | `#d1fae5` | — | «Tema: Sistema. Cambiar a Claro.» |
| claro | `contents tema-claro` | `#f7f8fc` | `#d1fae5` | `claro` | «Tema: Claro. Cambiar a Oscuro.» |
| oscuro | `contents dark` | `#0a1524` | `#021c13` | `oscuro` | «Tema: Oscuro. Cambiar a Sistema.» |
| **sistema** | `contents tema-sistema` | `#f7f8fc` | `#d1fae5` | `sistema` | «Tema: Sistema. Cambiar a Claro.» |

El ciclo **vuelve a «sistema»**. El badge se inyecta con la cadena de clases EXACTA de la
variante `success` de `Badge`: que cambie de fondo prueba que dispara el variant `dark:`, no
solo que giran los tokens.

### 2. La elección sobrevive a la recarga, y sin parpadeo

Dos pruebas independientes, porque una sola no distingue «no parpadea» de «parpadea rápido»:

- **El HTML crudo del servidor** (`context.request.get`, sin ejecutar una línea de JS) trae
  `data-tema="oscuro"` y `class="contents dark"`. No hay nada que corregir después del
  primer pintado porque ya viene puesto.
- **Muestreo del fondo del `<body>` en cada frame** desde el primero tras recargar:
  **87 frames, primero a t=104 ms, UN solo color distinto: `rgb(10, 21, 36)`.** Si hubiera
  parpadeo, los primeros frames saldrían claros.

Cookie en el contexto: `oscuro (persistente, sameSite=Lax, path=/)`.

### 3. `prefers-color-scheme` en estado «sistema»

Contexto de Playwright con `colorScheme`, sin cookie de elección:

| SO | `data-tema` | clase | cookie | `body` | badge |
|---|---|---|---|---|---|
| dark | `sistema` | `contents tema-sistema` | ninguna | `rgb(10,21,36)` | `lab(66.6921 -50.6678 17.0591 / 0.15)` |
| light | `sistema` | `contents tema-sistema` | ninguna | `rgb(247,248,252)` | `rgb(209,250,229)` |

El badge confirma lo que importa: con el SO en oscuro **el variant `dark:` también dispara**,
no solo los tokens. Y no se escribió ninguna cookie: nadie pulsó nada.

### 4. La landing y las tres páginas de auth no se mueven

Cada texto visible con su color, su pila de fondos compuesta y su ratio, comparado uno a uno
contra el mismo retrato en tema claro. Dos condiciones (cookie en `oscuro` y SO en oscuro) ×
dos anchos (1440 y 390, porque el wordmark de las páginas de auth vive en `md:hidden`):

| ruta | @1440 | @390 |
|---|---|---|
| `/` | 120/120 idénticos (×2) | 116/116 idénticos (×2) |
| `/login` | 9/9 idénticos (×2) | 8/8 idénticos (×2) |
| `/postulacion` | 26/26 idénticos (×2) | 25/25 idénticos (×2) |
| `/recuperar-contrasena` | 8/8 idénticos (×2) | 7/7 idénticos (×2) |

**630 comparaciones, 0 diferencias**, y el `body` da `rgb(247,248,252)` en las tres
condiciones. Confirmado, no asumido — y con la salvedad de arriba: las de auth no están
protegidas por `tema-claro` como decía el encargo, lo están porque el mecanismo está
acotado a `(app)`.

### 5. Contraste del control (5 roles × 2 temas)

| tema | maestro | admin | adminSatelite | adminTienda | mensajero |
|---|---|---|---|---|---|
| claro | **13.44** (h 11.10) | **13.23** (h 10.93) | **12.76** (h 10.56) | **13.73** (h 11.33) | **13.51** (h 11.16) |
| oscuro | **12.27** (h 11.17) | **12.45** (h 11.31) | **12.64** (h 11.42) | **11.98** (h 10.99) | **11.94** (h 10.94) |

En reposo da **exactamente el mismo número que el botón «Salir» de al lado** en las diez
celdas, que es lo esperado: mismo token de tinta sobre el mismo tinte. `h` = con el puntero
encima (`hover:bg-foreground/10`), mínimo 10.56.

**Tercera trampa del medidor, propia de esta sesión:** `page.click()` **deja el puntero
encima**, así que la primera pasada midió el estado *hover* creyendo que era el de reposo y
dio 11.10 donde había 13.44 — un número plausible y falso, y encima uno que habría hecho
pensar que el control contrasta peor que su vecino. Se aparta el ratón (`mouse.move(0,0)`) y
el hover se mide aparte, a propósito.

## Verificación por mutación

Suites: `tests/unit/tema`, `tests/unit/guards/tema-encendido.guardia.test.ts`,
`tests/components/TemaToggle.test.tsx`, `tests/components/AppLayout.test.tsx`.
Cada mutación se aplica sobre el archivo real y se restaura verificando el hash SHA-1.

| # | mutación | veredicto |
|---|---|---|
| 1 | **(a)** el ciclo se SALTA «sistema» (`claro ⇄ oscuro`) | **ROJO** — 3 casos |
| 2 | **(b)** la cookie NO se escribe | **ROJO** — 2 casos |
| 2.1 | (b bis) la cookie sin `path=/` ni `max-age` (muere al cerrar la pestaña) | **ROJO** |
| 3 | **(c)** se quita la región viva | **ROJO** |
| 3.1 | (c bis) el nombre accesible deja de decir el estado | **ROJO** — 3 casos |
| 3.2 | (c ter) la región existe pero pierde `aria-live` | **ROJO** |
| 3.3 | (c quater) la región viva se queda fija en «sistema» | **ROJO** |
| 4 | (d) un hex de `.tema-sistema` deja de espejar a `.dark` | **ROJO** |
| 4.1 | (d bis) a `.tema-sistema` le falta un token que `.dark` sí trae | **ROJO** |
| 5 | (e) se quita `body:has(> .dark)` → vuelve la franja clara | **ROJO** |
| 6 | (f) el variant `dark:` pierde la rama de `prefers-color-scheme` | **ROJO** |
| 7 | (g) el layout deja de montar el proveedor | **ROJO** — 3 casos |
| 8 | (h) los tokens de «sistema» salen del `@media` → oscuro SIEMPRE | **ROJO** |
| 9 | (i) el tema se estampa en el layout RAÍZ (dinamiza la landing) | **ROJO** |

**14 de 14 mueren.** Las que valen más son la 4.1, la 6 y la 8: son las tres formas de
romper el mecanismo **sin que se caiga nada** —todo compila, todo renderiza— y con un
síntoma que solo se ve mirando la aplicación con el sistema operativo en oscuro.

## Verificación

```
pnpm exec tsc --noEmit                                             exit 0

pnpm exec vitest run tests/components tests/unit tests/integration
  Test Files  1075 passed (1075)
       Tests  13493 passed (13493)
   Duration   281.97s                                              exit 0

pnpm exec eslint (archivos nuevos y tocados)                       exit 0
```

Tests propios: 25 nuevos (`tema.test.ts` 8, `TemaToggle.test.tsx` 11,
`tema-encendido.guardia.test.ts` 8) + 2 en `AppLayout.test.tsx`.

## Abiertos, heredados y no de esta ficha

- **Ficha 210** sigue viva y ahora es visible para todo el mundo: `Badge` variante
  `warning` (4.51/4.48) y `destructive` (3.30/2.89). Fallan **igual o peor en tema claro**,
  así que no son daño de encender el oscuro, pero encenderlo los pone delante de más ojos.
- **La 208 no está en `dev`.** Este PR la trae por fast-forward; si se mergea la 208 antes,
  este queda limpio.
- Sin sincronización entre pestañas: cambiar el tema en una no lo cambia en las otras hasta
  que recarguen. Se descartó a propósito (el patrón de `usePreferenciaSonido` lo resolvería
  con un evento propio) porque la cookie ya deja a las dos pestañas coherentes en la
  siguiente carga y añadir un `storage` listener por una preferencia de color es más
  máquina de la que el caso pide.
