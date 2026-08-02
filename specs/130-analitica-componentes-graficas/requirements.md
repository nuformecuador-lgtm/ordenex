# Feature 130 — analítica: componentes de gráficas · requirements

> Ficha (`feature_list.json:1486-1496`): *"Frontend. Componentes de visualizacion reutilizables
> en components/private/analytics: kpi-card, barras, lineas, donut, tabla-resumen; theme-aware;
> reciben data POR PROPS (sin fetch propio). Reusa shadcn/ui chart (recharts) si aplica."*
> `zone: frontend` · `complexity: medium` · `depends_on: null` · `sdd: true`.

## Decisiones del humano — 2026-07-31

Cerradas. Mandan sobre cualquier redacción anterior de esta spec.

**D1 — `recharts` entra como dependencia nueva.** Decidido por el humano. Deja de ser pregunta
abierta: SVG a mano y cualquier otra librería pasan a `design.md §8` como alternativas
descartadas por decisión. **Contrapartida que no se disimula:** peso de bundle para el mensajero,
que trabaja en móvil y que **sí** es uno de los cinco roles con acceso a `/analitica`. R26 y R27
la acotan y la hacen medible.

**D2 — la feature 129 está mergeada en `dev`.** Verificado por archivos (no por estado de PR):
`dev` @ `79056b24` contiene `app/(app)/analitica/page.tsx` y
`app/(app)/analitica/_components/AnaliticaShell.tsx`. Existe consumidor real y sus slots son un
contrato, no una hipótesis. Lo que D2 **no** trae es un llamador: ver **H1**.

**D3 — la feature 135 está mergeada en `dev`.** Verificado por archivos:
`lib/analytics/{types,metrics,ranges,filters}.ts`. **Su contrato pasa de PROPUESTO a VIGENTE**:
`MetricaUnidad`, `MetricaId`, `METRICAS` y `getMetrica` son la fuente de verdad de la que cuelgan
las props de esta feature. La antigua pregunta «qué forma tienen los datos por props» queda
derivada, no preguntada (R3, `design.md §5`).

## Decisiones del humano (puerta F1.4, 2026-07-31)

**Puerta F1.4: CERRADA.** D1–D3 (arriba) cerraron las antiguas Q1, Q4 y Q7. Las seis que quedaban
se responden aquí. Cada una lleva **la consecuencia que se asume**, para que nadie la reabra en la
review como si fuera un descuido. Estas respuestas mandan sobre cualquier redacción anterior.

**Q1 — primitiva shadcn vs recharts directo → RECHARTS DIRECTO.** No se trae
`components/ui/chart.tsx`; los lienzos componen recharts a mano y el color sale de `paleta.ts`.
**Consecuencia asumida, y no se esconde:** esto **contradice `docs/architecture.md:136`** («nunca
crees un componente si ya existe en shadcn/ui»). Es una **excepción razonada y con nombre**,
documentada en `design.md §3.2`: el `ChartConfig` de la primitiva obliga a **cada llamador** a
escribir a mano el mapa serie→color —exactamente lo que R16 prohíbe— y ese coste se multiplicaría
por 131, 132 y 133. Se paga a cambio: nadie hereda el tooltip, la leyenda ni el `ChartStyle` de
shadcn, y esas piezas se escriben aquí. → **R39** (y R26 acotado a `lienzo/`).

**Q2 — «theme-aware» → SOLO TOKENS.** Significa **cero hex sueltos**: todo color de serie sale de
`--chart-1..--chart-5`, ya declarados en `:root` **y** en `.dark` (I4). R16–R18 cubren la feature
por completo. **Consecuencia asumida, dicha sin ambigüedad: el conmutador de tema NO es de esta
feature.** Hoy nadie aplica la clase `.dark` (I16) y esta feature no la va a aplicar. Quien espere
un interruptor de claro/oscuro funcionando está esperando **otra ficha**, que no existe todavía.
Que la 130 pase con el modo oscuro invisible **no es un hallazgo**: es esta decisión. → **R40**.

**Q3 — 5 tokens contra 19 categorías → TECHO DE 5 SERIES + «otros» lo agrupa el tablero.** El
paquete declara un máximo de **5 series** y **ninguna leyenda repite color** (R30). Agrupar la cola
en «otros» es responsabilidad del **tablero (131)**, no del componente. **Comportamiento al
desbordar, decidido y testeable (R31): ruidoso en desarrollo, degradado seguro en producción** —
en `development`/`test` lanza un error con nombre propio; en `production` recorta a las 5 primeras
en el orden recibido y lo **anuncia con texto accesible**. Justificación en `design.md §3.3`.
**Consecuencia asumida:** `ordenes_por_estado` (19 categorías, I26) **no se puede pintar entera**
por este paquete; el tablero agrega o no la pinta. → **R30, R31, R34** + R19 reescrito.

**Q4 — `TablaResumen` → SÍ, envoltorio fino en esta feature.** Se queda en la 130 como envoltorio
delgado sobre `DataTable` que fija el formato por `MetricaUnidad` y la fila de totales, tal como
R22/R23 ya especifican. **Consecuencia asumida:** los tableros 131/132 **no repiten formateo**; a
cambio, la 130 entrega cinco piezas y no cuatro, y `TablaResumen` debe aportar algo real (formato +
totales) o sería un archivo de más (`docs/architecture.md:142-145`). → **R22, R23, R38**.

**Q5 — `KpiValorAnimado` → SE ARREGLA EN ESTA FEATURE.** Deja de hardcodear `const SIMBOLO = "₡"`
(`components/shared/KpiValorAnimado.tsx:14`) y pasa a resolver la moneda con `lib/config/moneda.ts`.
**Consecuencia asumida:** la 130 toca un **componente compartido vivo** —lo usan el portal del
mensajero y los cierres— y el **string que renderiza cambia** (`"₡ 3.500"` → formato `currency`).
Por eso la no-regresión es requisito explícito y con tests nombrados. → **R35, R36, R37**.

**Q6 — densidad → EL TABLERO AGREGA ANTES.** La gráfica declara un **tope de 62 puntos por serie**
(R32) y agregar por semana o mes cuando el rango es largo (hasta 366 días, I27) es responsabilidad
del **tablero (131)**, igual que el techo de series. El componente sigue siendo presentación pura
(R2). El desborde de puntos se comporta igual que el de series (R33). **Consecuencia asumida:**
pasarle a una gráfica un rango anual **sin agregar** es un error del llamador y va a fallar en su
propio test, no en producción. **R10 queda acotado por este tope**: la alternativa textual nunca
emite 366 entradas por serie. → **R32, R33, R34** + R10 acotado.

> **Corrección de una premisa de la puerta.** Al aplicar Q5 se verificó que
> `components/shared/KpiValorAnimado.tsx` **NO tiene test propio**: no existe ningún
> `tests/**/*Kpi*`. Su única cobertura es indirecta, vía los tests de sus dos consumidores (I29).
> La premisa «tiene test propio» con la que se planteó Q5 era falsa, y eso **agrava** el riesgo en
> vez de aliviarlo: sin test propio, el cambio de formato viaja sin red. R35 lo corrige exigiendo
> ese test que hoy falta.

## Alcance

Cinco piezas de presentación en `components/private/analytics/`, más los módulos puros de color y
formato. Reciben datos ya agregados y ya autorizados, por props. **Fuera de alcance:** obtener
datos, resolver permisos, definir métricas (135), la ruta y el shell (129, ya hechos) y el cableado
del tablero (131/132/133).

---

## Inventario verificado

Base de este worktree: `feature/130-…` desde `dev` @ `71778fa3`. **Este árbol todavía no contiene
la 129 ni la 135** (el leader lo sincroniza en T1.3); los hechos de esas dos features se citan de
`origin/dev` y cada cita es reproducible con `git show origin/dev:<ruta>`.

### En esta base (verificado directamente)

| # | Hecho | Evidencia |
|---|---|---|
| I1 | `recharts` **no** es dependencia todavía | `package.json:25-58` / `:59-79`; `node_modules/recharts/` no existe |
| I2 | `components/ui/chart.tsx` (primitiva shadcn) **no** existe | glob `components/ui/chart*` → 0 resultados |
| I3 | `components/private/` contiene **un** archivo | `components/private/BodegaLiberadasHoy.tsx` |
| I4 | Existen **5** tokens de color de serie, en los dos temas | `app/globals.css:109-113` (`:root`), `:149-153` (`.dark`), publicados como utilidades en `:21-25` |
| I5 | Esos 5 tokens **no los usa nadie** hoy | grep `--color-chart\|chart-1\|chart-2` en todo el worktree → único match `app/globals.css` |
| I6 | Hay un KPI animado ya promovido a `shared/` | `components/shared/KpiValorAnimado.tsx:23-55` |
| I7 | Ese KPI **hardcodea el símbolo de moneda** | `components/shared/KpiValorAnimado.tsx:14` (`const SIMBOLO = "₡"`), contra `docs/architecture.md:28-29` |
| I8 | La moneda por configuración ya existe | `lib/config/moneda.ts:20-42` (`loadMonedaConfig`, `formatMonto`, `SIN_MONTO = "-"`) |
| I9 | Precedente de fila de KPIs con datos por props | `app/(app)/mis-asignaciones/_components/KpisMensajero.tsx:46-83` |
| I10 | `DataTable` es la única tabla del repo: genérica, con skeleton/empty/error | `components/shared/DataTable.tsx:236-525`; `DESIGN.md:30` |
| I11 | `ResizeObserver` está stubbeado en el setup, pero **nunca notifica** | `tests/setup/jest-dom.ts:45-55` (`observe(){}` vacío) |
| I12 | `IntersectionObserver` se añadió al setup por exigencia de embla (precedente 163) | `tests/setup/jest-dom.ts:62-82` |
| I13 | `react-countup` está mockeado globalmente | `tests/setup/jest-dom.ts:16-24` |
| I14 | `react-hooks/set-state-in-effect` es **ERROR** aquí | `components/ui/carousel.tsx:42-53` (comentario de la 163) sobre `eslint.config.mjs:5-7` |
| I15 | Los tests de componente declaran su entorno por archivo | `vitest.config.ts:10` + `tests/components/EmptyState.test.tsx:1` |
| I16 | **No existe conmutador de tema**: nadie aplica la clase `.dark` | grep `next-themes\|ThemeProvider\|classList.*dark` en `app/` → 0; sólo usos estáticos del variante `dark:` |
| I17 | La regla de color es explícita: cero hex sueltos | `DESIGN.md:9` |
| I18 | El shell de página es `AppPage`, con `Container` y `gap-6` | `DESIGN.md:23-24` |
| I29 | `KpiValorAnimado` tiene **exactamente dos** consumidores en producción. **El archivo del portal del mensajero es SOLO UN RE-EXPORT**, no una copia divergente (su propio comentario `:2-5` lo dice): arreglar el compartido cubre a los dos de una vez y **no hay que tocar el portal**. *(Confirmado por el leader contra `origin/dev`, 2026-07-31.)* | `app/(app)/mis-asignaciones/_components/KpiValorAnimado.tsx:2-5,7-9` (re-export) → `KpisMensajero.tsx:27,32,37,42`; `app/(app)/cierres-admin/_components/cierre-factura.tsx:9,210` |
| I30 | `KpiValorAnimado` **no tiene test propio**: `tests/**/*Kpi*` → 0 archivos. Su cobertura es indirecta | `tests/components/MisAsignacionesPage.test.tsx:97-119`; `tests/components/CierresAdminModule.test.tsx` (única que monta `cierre-factura`) |
| I31 | El string de moneda **cambia** al aplicar Q5: hoy `` `${SIMBOLO} ${n}` `` con `minimumFractionDigits: 0` (`KpiValorAnimado.tsx:33-38`) → «₡ 3.500»; `formatMonto` usa `style: "currency"` (`lib/config/moneda.ts:36-42`) → «₡3.500,00» | los dos archivos citados |
| I32 | Ningún test del repo afirma hoy la salida en moneda del KPI: `grep "₡ "` en `tests/` → 0 resultados (los `"₡500.00"` de los cierres vienen de `money()`, no del KPI) | grep en `tests/` |
| I33 | ~~«Los consumidores de `formatMonto` son todos servidor/PDF; ninguno es `"use client"`»~~ — **FALSO, corregido por el leader contra `origin/dev` (2026-07-31).** Lo cierto: `formatMonto`/`loadMonedaConfig` tienen **13** consumidores de producción y **cinco son `"use client"`**. `KpiValorAnimado` no sería el primero: sería el **sexto** | `git grep -l "formatMonto\|loadMonedaConfig" origin/dev` → 13 archivos. Clientes: `app/(app)/ordenes/_components/EtiquetaGuia.tsx:1`; `app/(app)/mis-asignaciones/_components/chat-demo/ChatConversacion.tsx`; `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle.tsx` y `PosOrderCardMosaico.tsx` (vía `pos-card/pos-format.ts`, que usa `formatMonto`, importado por `PosAmountRow.tsx`); `app/(app)/recepcion-satelite/_components/SateliteOrderCard.tsx` |

### De la 129 y la 135 (fuera de esta base — verificado contra `origin/dev`)

Esta base todavía no tiene esas dos features (el leader la sincroniza en T1.3), así que sus hechos
se citan de `origin/dev`, que es la fuente de verdad desde que ambas están mergeadas. **Toda cita
de abajo es reproducible con `git show origin/dev:<ruta>`.**

| # | Hecho | Cita reproducible |
|---|---|---|
| I19 | El shell declara **dos** slots: `filtros?: ReactNode` y `operativo?: ReactNode` | `git show origin/dev:app/(app)/analitica/_components/AnaliticaShell.tsx` `:7-12` — idéntico a `specs/129-…/design.md:82-87` |
| I20 | El shell no recibe `rol` ni declara slot financiero, **por decisión escrita y razonada** de la 129 | `specs/129-…/design.md:97-101` + comentario del propio archivo `:27-37` |
| I21 | El shell es Server Component (sin `"use client"`), monta `AppPage` y dos `<section aria-label>` con `flex flex-col gap-4` | `AnaliticaShell.tsx:38-66` |
| I22 | Cada slot vacío cae a un `EmptyState` propio del shell («llega en una entrega posterior») | `AnaliticaShell.tsx:48-63` |
| I23 | El shell declara que **la 131**, no el shell, enchufa los componentes de la 130 | `AnaliticaShell.tsx:19-25` |
| I24 | `MetricaUnidad = "conteo" \| "porcentaje" \| "moneda" \| "segundos"`, declarada «para la 130» | `git show origin/dev:lib/analytics/types.ts` `:34` |
| I25 | `metrics.ts` exporta `METRICAS`, `MetricaId`, `getMetrica`, `listarMetricas`, `sonSumables`, `ANALITICA_TAGS` | `lib/analytics/metrics.ts:553-615` |
| I26 | El catálogo vigente incluye `ordenes_por_estado`, con **19** categorías | `specs/135-…/design.md:160` |
| I27 | El rango `personalizado` admite hasta **366** días | `lib/analytics/types.ts:209` (`RANGO_TOPE_DIAS = 366`) |
| I28 | `mensajero` **es** uno de los cinco roles lectores de analítica | `lib/analytics/types.ts:54-62` (`ROLES_ANALITICA`) |

> **Nota metodológica (2026-07-31).** La primera redacción de esta spec citó copias sueltas del
> scratchpad de otra sesión (`…/884c2c17-…/scratchpad/{bk129,bk129b,bak}/`) en vez de
> `origin/dev`, y de ahí dedujo un hallazgo «el design de la 129 no coincide con su código» que
> **era falso**: aquellas copias eran respaldos anteriores al cierre de la feature. Verificado
> contra `origin/dev`, el design de la 129 (`:82-87`) es **byte-idéntico** a su archivo shipped.
> Que tres copias coincidieran entre sí no las hacía actuales — sólo hermanas. **Regla para el
> resto de la feature: un hecho de inventario sólo vale si se reproduce con `git show origin/dev:`.**

### Hallazgos (no son requisitos; son cosas que alguien tiene que saber)

**H1 — la 130 no se enchufa al shell: se enchufa a la 131, que no existe.** El propio shell lo
dice (I23). Es decir: D2 da **destino contractual** a estos componentes, pero **no un llamador**.
Al mergear la 130, el grafo será `AnaliticaShell` (existe) ← `131` (no existe) ← `130` (esta
feature). Sigue sin haber un solo `import` de estos componentes en producción hasta que aterrice
la 131. Es aceptable y está dicho; lo que no sería aceptable es venderlo como "ya integrado".

**H2 — el mensajero ve `/analitica`.** `ROLES_ANALITICA` lo incluye (I28). Así que "recharts no le
llega al móvil del mensajero" es **falso** si entra a la pantalla. Lo que R26/R27 pueden garantizar
es que no le llegue en `/mis-asignaciones` ni en el resto de la app, y que dentro de `/analitica`
llegue diferido. Decirlo de otro modo sería mentir.

**H3 — la moneda por configuración no es configurable en cliente; es una limitación
PREEXISTENTE del producto, no una frontera que abra esta feature.** *(Reencuadrado el 2026-07-31
tras corregir I33.)*

La observación técnica sigue en pie: `loadMonedaConfig` lee `process.env[name]` con **clave
dinámica** (`lib/config/moneda.ts:8`) y Next sólo *inlinea* variables `NEXT_PUBLIC_*` y sólo con
acceso estático; en el navegador el objeto queda vacío y el formato cae al *default* `es-CR`/`CRC`.

Lo que cambia es a quién le pasa eso. **`KpiValorAnimado` no sería el primer consumidor cliente de
`formatMonto`: sería el sexto** (I33). Ya lo son `EtiquetaGuia`, `ChatConversacion`,
`PosOrderCardDetalle`, `PosOrderCardMosaico` y `SateliteOrderCard` — es decir, la limitación **ya
afecta en producción al detalle de la orden del mensajero y a la recepción satélite**.

Consecuencia para el veredicto de Q5, en la dirección contraria a la que decía la redacción
anterior: **el arreglo no introduce ningún riesgo nuevo, alinea el KPI con el comportamiento que ya
tienen sus cinco vecinos.** Y sí consigue lo que pedía `docs/architecture.md:28-29`: que el símbolo
deje de estar escrito dentro del componente y salga de un único módulo de configuración.

**Recomendación al humano (no es un defecto de la 130, y no se abre desde aquí):** si la moneda debe
poder cambiarse por despliegue **en cliente**, eso es una ficha propia sobre `lib/config/moneda.ts`
—variable `NEXT_PUBLIC_`, o pasar el valor ya formateado desde el servidor— con **seis** consumidores
cliente a revisar, no uno. Decidirlo dentro de la 130 sería arreglar medio problema en el sitio
equivocado.

---

## Requisitos

### Ubicación, pureza y frontera de datos

**R1.** El sistema DEBE exponer los cinco componentes (`KpiCard`, `GraficaBarras`,
`GraficaLineas`, `GraficaDonut`, `TablaResumen`) bajo `components/private/analytics/`.

**R2.** El sistema DEBE renderizar cada componente **exclusivamente** a partir de sus props: los
archivos del paquete NO DEBEN contener `fetch(`, `'use server'`, ni importaciones de
`next/headers`, `swr`, `@/lib/actions/*`, `@/lib/db` o `@prisma/client`.

**R3.** El sistema DEBE tomar la unidad de valor del contrato vigente de la 135 mediante
`import type … from "@/lib/analytics/types"` (D3), NO DEBE redeclarar esa unión, y **NO DEBE
importar `@/lib/analytics/metrics`** desde ningún archivo del paquete: el catálogo de 23 métricas
es dato de servidor y no debe cruzar al bundle del cliente.

**R4.** MIENTRAS un componente del paquete se renderice, el sistema NO DEBE leer `document`,
`window.matchMedia` ni `localStorage` para decidir colores, tema o formato.

### Estados obligatorios (`DESIGN.md:26-36`)

**R5.** CUANDO una gráfica (`GraficaBarras`, `GraficaLineas`, `GraficaDonut`) recibe una serie de
datos vacía, el sistema DEBE renderizar el `EmptyState` compartido y NO DEBE renderizar el lienzo.

**R6.** MIENTRAS la prop de carga esté activa, el sistema DEBE renderizar un `Skeleton`, DEBE
anunciar el estado con un único elemento `role="status"`, y NO DEBE renderizar el lienzo ni el
estado vacío.

**R7.** SI la prop de error trae un mensaje, ENTONCES el sistema DEBE renderizarlo en un elemento
`role="alert"` y NO DEBE renderizar el lienzo, el vacío ni el skeleton.

**R8.** El sistema DEBE resolver los estados con la precedencia **error > carga > vacío > datos**,
igual que `components/shared/DataTable.tsx:316-425`.

### Accesibilidad y verificabilidad sin layout

**R9.** El sistema DEBE dar a cada gráfica un nombre accesible tomado de una prop obligatoria de
título, consultable por rol/etiqueta sin inspeccionar el SVG.

**R10.** El sistema DEBE renderizar, junto a cada gráfica y dentro del mismo componente, una
**alternativa textual equivalente** con una entrada por punto de dato (categoría, serie y valor ya
formateado). Esa alternativa DEBE existir en el DOM aunque el lienzo mida 0×0, y DEBE emitir como
máximo `MAX_SERIES × MAX_PUNTOS_SERIE` entradas (R30, R32) — nunca una entrada por día de un rango
anual. *(Es el requisito que hace verificable la feature en jsdom; ver `design.md §6`.)*

**R11.** CUANDO un punto de dato es `null`, el sistema DEBE representarlo como dato ausente
(marcador de `lib/config/moneda.ts:30`) en la alternativa textual y como **hueco** en el lienzo, y
NO DEBE sustituirlo por `0`.

### KPI

**R12.** El sistema DEBE renderizar en `KpiCard` la etiqueta y el valor formateado según la unidad
recibida (`conteo`, `porcentaje`, `moneda`, `segundos`).

**R13.** CUANDO la unidad es `moneda`, el sistema DEBE formatear el valor con
`lib/config/moneda.ts` y NO DEBE emitir ningún símbolo de moneda literal desde el paquete
(el defecto I7 no se hereda).

**R14.** CUANDO el valor del KPI es `null`, el sistema DEBE mostrar el marcador de dato ausente y
NO DEBE mostrar `0`.

**R15.** DONDE se pase una variación respecto al período anterior, el sistema DEBE comunicar su
signo mediante **texto** además del color, y DEBE usar los tokens semánticos `-strong` para ese
texto (`DESIGN.md:15`).

### Color y tema

**R16.** El sistema DEBE tomar el color de cada serie de un **único** módulo de paleta del
paquete, y ningún archivo del paquete DEBE contener un literal hexadecimal ni una utilidad de la
escala cruda de Tailwind (`emerald-*`, `red-*`, `text-[#…]`).

**R17.** El módulo de paleta DEBE resolver el color de una serie como **función pura y
determinista** de su índice, evaluable sin DOM.

**R18.** El sistema DEBE mapear cada color de serie a los tokens `--chart-1..--chart-5`
(`app/globals.css:109-113`, `:149-153`), de modo que el cambio de tema no requiera ejecutar
JavaScript en el componente.

**R19.** El sistema DEBE asignar el color por posición de forma **inyectiva** dentro del techo
declarado: para dos índices distintos en `[0, MAX_SERIES)` el token resultante DEBE ser distinto.
*(Q3: la regla ya no es «qué hacer al ciclar»; es que **no se cicla**. El desborde lo gobierna R31.)*

### Formato y unidades

**R20.** El sistema DEBE formatear los valores según la unidad declarada, con el locale de
`lib/config/moneda.ts:21` y sin literal de idioma incrustado en los componentes.

**R20-bis — decidido al implementar, 2026-08-01: la unidad `porcentaje` viaja como FRACCIÓN.**
El sistema DEBE interpretar un valor de unidad `porcentaje` como razón en `[0,1]` (`0,842` = 84,2 %)
y NO como puntos porcentuales. Es coherente con el catálogo de la 135, que define esas métricas como
una **razón numerador/denominador** (`DefinicionMetrica.razon`, `lib/analytics/types.ts`), y con
`Intl`, que multiplica por 100 en `style: "percent"`. **Consecuencia para el tablero (131): pasa la
razón cruda, NO la pre-multipliques por 100** — si lo haces verás «35 000 %» y el fallo será tuyo,
no del componente. *(El spec no fijaba la escala; se decide aquí para que no la invente cada
llamador.)*

**R21.** El formateo DEBE vivir en una función pura del paquete, invocable y testeable sin
renderizar ningún componente.

### Tabla resumen

**R22.** El sistema DEBE construir `TablaResumen` sobre `components/shared/DataTable.tsx` y NO
DEBE emitir un elemento `<table>` propio. *(Q4 = envoltorio fino aquí; ver `design.md §7`.)*

**R23.** DONDE se declare una fila de totales, el sistema DEBE renderizarla distinguible de las
filas de datos y DEBE calcularla con una función pura, nunca sumando dentro del JSX.

*(El formateo por unidad de `TablaResumen` es **R38**.)*

### Encaje con el shell de la 129 (D2)

**R24.** El sistema DEBE renderizar correctamente dentro del contenedor del slot `operativo` del
shell —una `<section className="flex flex-col gap-4">` (I21)—: DEBE aceptar una clase adicional
opcional y NO DEBE imponer un ancho ni un alto fijos en píxeles al contenedor raíz.

**R25.** El estado vacío de un componente (R5) DEBE describir **la métrica sin datos en el rango
consultado** y NO DEBE reutilizar el texto del `EmptyState` del shell («llega en una entrega
posterior», I22): son dos vacíos distintos y confundirlos hace ilegible la pantalla.

### Coste de la dependencia (D1)

**R26.** El sistema DEBE confinar la importación de `recharts` a los archivos de
`components/private/analytics/lienzo/`; ningún otro directorio DEBE importarla, ni directa ni
transitivamente. *(Q1 = recharts directo: no hay primitiva en `components/ui/` que exceptuar.)*

**R27.** El sistema DEBE cargar el código de `recharts` de forma **diferida**, de modo que no
forme parte del *First Load JS* de ninguna ruta distinta de `/analitica`; la comprobación DEBE
hacerse sobre la salida real de `next build` y quedar registrada en `progress/impl_130.md`.

### Calidad

**R28.** MIENTRAS el usuario tenga activada la reducción de movimiento, el sistema NO DEBE animar
la entrada de las gráficas ni del KPI (`DESIGN.md:38`).

**R29.** El sistema DEBE pasar `pnpm lint` sin errores, incluida `react-hooks/set-state-in-effect`
(I14): ningún componente del paquete DEBE sincronizar estado con una fuente externa mediante
`useState` + `useEffect`.

### Techo de series y de puntos (Q3, Q6)

**R30.** El sistema DEBE declarar en el paquete una constante `MAX_SERIES = 5`, igual al número de
tokens existentes (I4), y DEBE garantizar que **dos series visibles nunca comparten color**: en una
leyenda de hasta 5 entradas, el conjunto de tokens asignados DEBE tener 5 elementos distintos.

**R31.** CUANDO una gráfica recibe más de `MAX_SERIES` series, ENTONCES el sistema DEBE, si
`process.env.NODE_ENV !== "production"`, lanzar un error con nombre propio (`SeriesExcedidasError`)
cuyo mensaje incluya el número recibido y el tope; y, si `NODE_ENV === "production"`, NO DEBE
lanzar: DEBE conservar las **primeras `MAX_SERIES` en el orden recibido**, descartar el resto y
anunciar el recorte con **texto** legible por lector de pantalla (cuántas se muestran de cuántas).

**R32.** El sistema DEBE declarar en el paquete una constante `MAX_PUNTOS_SERIE = 62` como número
máximo de puntos por serie. *(Justificación y aritmética en `design.md §3.4`; el número es
requisito, no orientación.)*

**R33.** CUANDO una serie trae más de `MAX_PUNTOS_SERIE` puntos, ENTONCES el sistema DEBE aplicar
la **misma** política que R31: error con nombre (`PuntosExcedidosError`) fuera de producción; y en
producción conservar los **últimos** `MAX_PUNTOS_SERIE` puntos —los más recientes— descartando los
más antiguos, y anunciar el recorte con texto.

**R33-bis — enmienda del humano, 2026-08-01: el donut tiene su propio techo.**

CUANDO la gráfica es `GraficaDonut`, ENTONCES el techo que se aplica a sus **segmentos** DEBE ser
`MAX_SERIES` (5), NO `MAX_PUNTOS_SERIE` (62), y al desbordar DEBE conservar los **PRIMEROS** en el
orden recibido, no los últimos. La política de entornos no cambia: fuera de producción lanza
`SeriesExcedidasError`; en producción recorta y **anuncia el recorte con texto**.

**Por qué el donut tiene regla propia.** En un donut el color no distingue series: distingue
**segmentos**. El tope es 5 porque la paleta tiene 5 colores y `paleta.ts` lanza
`IndiceSerieFueraDeRangoError` para todo índice `>= MAX_SERIES` **en cualquier `NODE_ENV`,
producción incluida**. Con 62 segmentos habría que repetir colores —dos porciones del mismo color
en la misma leyenda se leen como la misma categoría—, que es **exactamente** lo que Q3 descartó; y
sin recorte, un donut de 6 o más categorías (`ordenes_por_estado` tiene 19, I26) **reventaría en el
navegador también en producción**.

**Por qué conserva los PRIMEROS y no los últimos.** Aquí la dirección es la contraria a la de R33 y
es deliberado: en una serie ordenada por magnitud los primeros son los que más pesan. Quedarse con
los últimos dejaría a la vista las 5 categorías **más pequeñas** escondiendo las dominantes — un
donut engañoso, que es peor que uno recortado y anunciado. En una serie **temporal** manda el
criterio opuesto (lo reciente es lo que se mira), y por eso R33 conserva los últimos: son dos formas
distintas de leer los datos, no una incoherencia.

**Alcance de la enmienda: SÓLO el donut.** R33 sigue intacta para `GraficaBarras` y
`GraficaLineas`: 62 puntos por serie, `PuntosExcedidosError` fuera de producción y conservar los
**últimos**. Esas dos gráficas no se tocan.

**R34.** El sistema NO DEBE implementar dentro del paquete ninguna agrupación de series en «otros»
ni ninguna agregación temporal (por semana o por mes): esos dos cálculos pertenecen al tablero
(131). Ningún archivo del paquete DEBE contener lógica de agrupación o de re-muestreo temporal.

### Arreglo del compartido `KpiValorAnimado` (Q5)

**R35.** El sistema DEBE resolver el formato de moneda de `components/shared/KpiValorAnimado.tsx`
con `lib/config/moneda.ts` (`loadMonedaConfig`/`formatMonto`) y ese archivo NO DEBE contener ningún
símbolo de moneda literal ni ningún código ISO de moneda escrito a mano.

**R36.** MIENTRAS se aplique R35, el sistema NO DEBE alterar el comportamiento observable de los
dos consumidores actuales de `KpiValorAnimado` (I29) en nada que no sea el formato de moneda:
`tests/components/MisAsignacionesPage.test.tsx` y `tests/components/CierresAdminModule.test.tsx`
DEBEN seguir verdes, y el delta de tests ajenos rotos en la suite completa DEBE ser **0**.

**R37.** El sistema DEBE cubrir `KpiValorAnimado` con un test propio
(`tests/components/KpiValorAnimado.test.tsx`), que hoy no existe (I30), afirmando al menos: valor
sin moneda, valor con moneda formateado por configuración, y `null`/no numérico.

### Consecuencias de Q1, Q2 y Q4

**R38.** `TablaResumen` DEBE fijar el formato de cada celda a partir de la `MetricaUnidad` de su
columna usando la **misma** función pura que las gráficas (R20, R21), de modo que un llamador NO
DEBA pasar formateadores propios.

**R39.** El sistema NO DEBE añadir la primitiva `components/ui/chart.tsx` ni importar desde el
paquete ningún componente de `components/ui/chart*`: los lienzos componen `recharts` directamente
(Q1, excepción razonada a `docs/architecture.md:136` documentada en `design.md §3.2`).

**R40.** El sistema NO DEBE incluir en esta feature ningún conmutador de tema: ningún archivo del
paquete DEBE escribir la clase `dark` sobre `document`, importar `next-themes` ni exponer una prop
de tema. El cumplimiento de «theme-aware» se agota en R16–R18 (Q2).

### Aserciones que midan algo (I11)

**R41.** Los tests de esta feature NO DEBEN basar ninguna aserción de contenido en nodos generados
por `recharts`: el stub global de `ResizeObserver` tiene `observe(){}` vacío (I11), así que
`ResponsiveContainer` renderiza **vacío** en vez de fallar y una aserción sobre el SVG pasaría o
fallaría por motivos ajenos al dato. Toda aserción de contenido DEBE recaer en la alternativa
textual (R10) o en las funciones puras (R17, R21). La única aserción admisible sobre el lienzo es
que **se intenta montar**, y DEBE demostrarse que falla si se quita ese montaje (comprobación de
mutación registrada en `progress/impl_130.md`, `docs/verification.md:21-24`).

---

## Trazabilidad `R<n> → test`

El implementer materializa estas rutas y repite el mapa en `progress/impl_130.md`
(`CHECKPOINTS.md:11-13`).

| R | Test |
|---|---|
| R1 | `tests/unit/components/analytics-paquete-guard.test.ts` › «expone los cinco componentes en components/private/analytics» |
| R2 | `tests/unit/components/analytics-paquete-guard.test.ts` › «ningun archivo del paquete hace fetch, usa server actions ni toca la base» |
| R3 | `tests/unit/components/analytics-paquete-guard.test.ts` › «toma la unidad de lib/analytics/types con import type y no importa el catalogo metrics» |
| R4 | `tests/unit/components/analytics-paquete-guard.test.ts` › «ningun componente lee window, document ni matchMedia» |
| R5 | `tests/components/AnalyticsGraficas.test.tsx` › «con serie vacia muestra el estado vacio y no el lienzo» (3 gráficas, `it.each`) |
| R6 | `tests/components/AnalyticsGraficas.test.tsx` › «mientras carga muestra skeleton y anuncia el estado una sola vez» |
| R7 | `tests/components/AnalyticsGraficas.test.tsx` › «con error muestra el mensaje en un role=alert y nada mas» |
| R8 | `tests/components/AnalyticsGraficas.test.tsx` › «con error y carga simultaneos gana el error» |
| R9 | `tests/components/AnalyticsGraficas.test.tsx` › «cada grafica toma su nombre accesible del titulo recibido» |
| R10 | `tests/components/AnalyticsGraficas.test.tsx` › «publica una entrada de texto por punto de dato aunque el lienzo mida cero» + «nunca emite mas de MAX_SERIES x MAX_PUNTOS_SERIE entradas» |
| R11 | `tests/components/AnalyticsGraficas.test.tsx` › «un punto nulo se muestra como dato ausente, no como cero» |
| R12 | `tests/components/AnalyticsKpiCard.test.tsx` › «muestra etiqueta y valor formateado por unidad» (4 unidades, `it.each`) |
| R13 | `tests/unit/components/analytics-paquete-guard.test.ts` › «ningun archivo del paquete escribe un simbolo de moneda, un codigo ISO ni un locale» + `analytics-formato.test.ts` › «con otra moneda configurada el valor NO lleva el simbolo del colon». *(La aserción sobre la salida por defecto NO basta: con es-CR/CRC `formatMonto` y un `₡` a mano dan el MISMO string.)* |
| R14 | `tests/components/AnalyticsKpiCard.test.tsx` › «un valor nulo muestra el marcador de dato ausente y no cero» |
| R15 | `tests/components/AnalyticsKpiCard.test.tsx` › «la variacion dice su signo con texto, no solo con color» |
| R16 | `tests/unit/components/analytics-paleta.test.ts` › «ningun archivo del paquete contiene un hex ni un color crudo de tailwind» |
| R17 | `tests/unit/components/analytics-paleta.test.ts` › «el color de una serie es determinista para el mismo indice» |
| R18 | `tests/unit/components/analytics-paleta.test.ts` › «los tokens declarados existen en app/globals.css, en :root y en .dark» |
| R19 | `tests/unit/components/analytics-paleta.test.ts` › «los cinco indices del techo dan cinco tokens distintos: ninguna leyenda repite color» |
| R20 | `analytics-formato.test.ts` › «formatea conteo, porcentaje, moneda y segundos segun la unidad» + «con otro locale configurado cambian los separadores del conteo» + guard › «ningun archivo del paquete … ni un locale» *(la cláusula «sin literal de idioma incrustado» la mide el guard, no la salida)* |
| R21 | `tests/unit/components/analytics-formato.test.ts` › «formatea sin renderizar ningun componente» |
| R22 | `tests/components/AnalyticsTablaResumen.test.tsx` › «se apoya en DataTable: hereda skeleton, vacio y error» |
| R23 | `tests/components/AnalyticsTablaResumen.test.tsx` › «la fila de totales se distingue de las filas de datos» + `analytics-formato.test.ts` › «totaliza en una funcion pura» |
| R24 | `tests/components/AnalyticsEncajeShell.test.tsx` › «renderiza dentro de una section flex-col gap-4 sin fijar ancho ni alto en pixeles» |
| R25 | `tests/components/AnalyticsEncajeShell.test.tsx` › «el vacio de la grafica habla del rango sin datos, no de una entrega posterior» |
| R26 | `tests/unit/components/analytics-paquete-guard.test.ts` › «recharts solo se importa desde el paquete de analitica» |
| R27 | Task **T5.2** (medición sobre `next build`, evidencia en `progress/impl_130.md`) + `analytics-paquete-guard.test.ts` › «los componentes de grafica se montan por importacion diferida» |
| R28 | `tests/components/AnalyticsGraficas.test.tsx` › «con prefers-reduced-motion no aplica clases de animacion» |
| R29 | Gate `pnpm lint` en `./init.sh` (`docs/verification.md:6-13`) + `analytics-paquete-guard.test.ts` › «ningun componente sincroniza estado con useEffect» |
| R30 | `tests/unit/components/analytics-paleta.test.ts` › «MAX_SERIES vale 5 y coincide con el numero de tokens declarados» |
| R31 | `tests/unit/components/analytics-topes.test.ts` › «con 6 series lanza SeriesExcedidasError fuera de produccion» + «en produccion conserva las 5 primeras en orden» + `tests/components/AnalyticsGraficas.test.tsx` › «anuncia por texto cuantas series muestra de cuantas» |
| R32 | `tests/unit/components/analytics-topes.test.ts` › «MAX_PUNTOS_SERIE vale 62 y es mayor que 53 semanas y menor que 366 dias» |
| R33 | `tests/unit/components/analytics-topes.test.ts` › «con 63 puntos lanza PuntosExcedidosError fuera de produccion» + «en produccion conserva los 62 ultimos» |
| R33-bis | `tests/components/AnalyticsGraficas.test.tsx` › «techo de SEGMENTOS del donut» › «con 6 categorias lanza SeriesExcedidasError fuera de produccion» + «en produccion recorta a 5 segmentos, no revienta, y anuncia el recorte por texto» + «con 5 categorias exactas pinta las cinco y no anuncia recorte» |
| R20-bis | `tests/unit/components/analytics-formato.test.ts` › «formatea conteo, porcentaje, moneda y segundos segun la unidad» (0,842 → 84,2 %) |
| R34 | `tests/unit/components/analytics-paquete-guard.test.ts` › «el paquete no agrupa en otros ni re-muestrea por semana o mes» |
| R35 | `tests/components/KpiValorAnimado.test.tsx` › «el valor en moneda usa lib/config/moneda y el archivo no tiene simbolo literal» |
| R36 | `tests/components/MisAsignacionesPage.test.tsx` (suite completa, sin cambios) + `tests/components/CierresAdminModule.test.tsx` (idem) + Task **T7.3** (delta 0 en la suite, evidencia en `progress/impl_130.md`) |
| R37 | `tests/components/KpiValorAnimado.test.tsx` › «sin moneda muestra el entero», «con moneda usa el formato configurado», «valor nulo o no numerico no rompe» |
| R38 | `tests/components/AnalyticsTablaResumen.test.tsx` › «formatea cada columna por su MetricaUnidad sin que el llamador pase formateadores» |
| R39 | `tests/unit/components/analytics-paquete-guard.test.ts` › «no existe components/ui/chart y el paquete no lo importa» |
| R40 | `tests/unit/components/analytics-paquete-guard.test.ts` › «el paquete no importa next-themes ni escribe la clase dark» |
| R41 | `tests/unit/components/analytics-paquete-guard.test.ts` › «ningun test del paquete consulta nodos de recharts» + Task **T4.5** (comprobación de mutación del montaje del lienzo, registrada) |

**R27 y R36/R41 son los únicos requisitos con evidencia parcialmente fuera de vitest** (medición de
bundle y comparación de suite/mutación, registradas en `progress/impl_130.md`). R27 en particular, y conviene que se vea: es una
medición sobre `next build`. `docs/verification.md:15-20` acepta «salida real» como evidencia, pero
un umbral numérico se degrada solo. Por eso T5.2 exige registrar la cifra, no sólo mirarla.

Sin E2E: `CHECKPOINTS.md:19-21` lo reserva para flujos críticos (auth, pagos, recaudo, ingesta,
webhooks). Estos son componentes de presentación sin ruta propia ni mutaciones; el E2E corresponde
a la 131/132 cuando exista tablero que recorrer.

---

## Preguntas abiertas

**Ninguna. La puerta F1.4 está cerrada** (2026-07-31). Las nueve preguntas que tuvo esta spec están
respondidas: D1 (librería), D2 (consumidor) y D3 (forma del dato) el 2026-07-31 por la mañana, y
Q1–Q6 en la propia puerta F1.4 — ver **«Decisiones del humano (puerta F1.4, 2026-07-31)»** al
principio de este archivo. `tasks.md > T0` replica las seis respuestas.

Lo que **no** es una pregunta abierta y conviene no confundir con una:

- **H1** (la 130 se mergea sin llamador hasta que aterrice la 131) es un hecho aceptado y escrito,
  no un hueco pendiente de decidir.
- **H2** (el mensajero sí entra a `/analitica`) acota qué puede prometer R27; no lo reabre.
- **H3** (la moneda por configuración no es *overridable* en cliente) es una limitación conocida de
  `lib/config/moneda.ts`, anterior a esta feature y **fuera de su alcance**; se documenta para que
  no se lea como un defecto introducido por Q5.
- **El conmutador de tema** (Q2) es explícitamente otra ficha, todavía inexistente.
- **Agrupar en «otros» y agregar por semana/mes** (Q3, Q6) son trabajo del tablero **131**, no de
  esta feature: R34 lo prohíbe aquí y `tasks.md > T0.1` lo comunica a su dueño.
