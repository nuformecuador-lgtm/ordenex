# Feature 130 — analítica: componentes de gráficas · tasks

Convenciones: `[P]` = paralelizable con las tareas marcadas igual dentro del mismo bloque.
Cada task lleva su criterio de **hecho**. Un commit por task lógica
(`docs/conventions.md:24-26`), mensaje `feat(130): …` / `test(130): …` / `chore(130): …`.

**T0 está CERRADA** (puerta F1.4, 2026-07-31): T1 en adelante puede empezar (`docs/specs.md:31-40`).
Bloques: T1 dependencia · T2 núcleo puro · T3 componentes · T4 tests de componente · T5 guards y
coste · **T7 arreglo del compartido `KpiValorAnimado`** (paralelo a T2–T5) · T8 cierre.

---

## T0 — Puerta F1.4: **CERRADA** (2026-07-31)

**Estado: CERRADA. Cero preguntas abiertas.** D1 (recharts entra), D2 (la 129 está en `dev`) y D3
(la 135 está en `dev`) cerraron las antiguas Q1, Q4 y Q7 esa misma mañana. Las seis restantes las
respondió el humano en la puerta F1.4. **T1 en adelante está desbloqueado.**

- [x] **T0 — las seis respuestas, aplicadas al spec.**

| # | Pregunta | Respuesta del humano | Dónde vive ahora |
|---|---|---|---|
| **Q1** | primitiva shadcn vs recharts directo | **Recharts directo.** No se trae `components/ui/chart.tsx`. **Excepción razonada y con nombre** a `docs/architecture.md:136` | `design.md §3.2` · **R39** · R26 acotado a `lienzo/` |
| **Q2** | ¿"theme-aware" es algo más que tokens? | **Sólo tokens.** Cero hex sueltos; R16–R18 completan la feature. **El conmutador de tema NO es de esta feature** — si alguien lo espera, es ficha aparte | `requirements.md > Q2` · **R40** · `design.md §9.18` |
| **Q3** | 5 tokens vs 19 categorías | **Techo de 5 series + «otros» lo agrupa el tablero (131).** Ninguna leyenda repite color. Al desbordar: error con nombre fuera de producción, recorte anunciado en producción | `design.md §3.3` · **R30, R31, R34** · R19 reescrito |
| **Q4** | ¿`TablaResumen` es de esta feature? | **Sí, envoltorio fino aquí** sobre `DataTable`, con formato por `MetricaUnidad`. Los tableros no repiten formateo | `design.md §7.1` · **R22, R23, R38** |
| **Q5** | `KpiValorAnimado` con `"₡"` hardcodeado | **Se arregla en esta feature**: moneda por `lib/config/moneda.ts`. Con no-regresión explícita en sus dos consumidores | `design.md §7.2` · **R35, R36, R37** · T7 |
| **Q6** | densidad de datos | **El tablero agrega antes.** Tope de **62 puntos por serie**; agregar por semana/mes es de la 131 | `design.md §3.4` · **R32, R33, R34** · R10 acotado |

**Hecho (cumplido):** las seis respuestas están copiadas con fecha en
`requirements.md > Decisiones del humano (puerta F1.4, 2026-07-31)`, con su consecuencia asumida;
las secciones afectadas de `design.md` están reescritas; «Preguntas abiertas» queda **vacía**; los
requisitos nuevos son **R30–R41** y la trazabilidad los cubre. La feature pasa a `spec_ready`.

> **Corrección de premisa registrada al aplicar Q5:** `KpiValorAnimado` **no tiene test propio**
> (`tests/**/*Kpi*` → 0 archivos). La puerta se planteó asumiendo que sí. R37 crea ese test; el
> plan de §7.2 lo escribe **antes** de tocar el componente.

### T0.1 — Avisos dirigidos que salen de esta spec (no requieren decisión, sí destinatario)

- **→ dueño de la 131, dos deberes que la puerta F1.4 le traslada** (no son opcionales, y de aquí
  salen sus propios requisitos):
  1. **Agrupar en «otros»** cuando una métrica tenga más de **5** categorías —`ordenes_por_estado`
     tiene 19—. El paquete de la 130 **no** lo hace (R34) y **lanza** en desarrollo si recibe más
     de 5 series (R31).
  2. **Agregar por semana o mes** cuando el rango pase de **62 puntos** por serie (hasta 366 días
     son posibles). El paquete tampoco lo hace (R34) y lanza en desarrollo (R33).

  Ambas reglas fallan **ruidosamente en su test**, no en producción; en producción recortan y lo
  anuncian por texto. Mejor enterarse aquí que en la review.
- **→ dueño de la 131:** esta feature entrega bloques **sin llamador** (H1). El shell dice que es
  la 131 quien los enchufa por el slot `operativo`. El contrato de props está en
  `design.md §5`; si la 131 necesita otra forma, es más barato decirlo ahora que después.
- **→ quien traiga el tablero financiero:** no hay nada que arreglar en el shell. La ausencia de
  slot financiero es una **decisión ya tomada y razonada por la 129**
  (`specs/129-…/design.md:97-101`), coherente con D7 de la 135, y su extensión son los tres pasos
  mecánicos que esa feature dejó documentados (`design.md §8.3`). Se cita aquí para que nadie lo
  reabra como si fuera un olvido.

---

## T1 — Dependencia y línea base (después de T0)

- [ ] **T1.1 — Medir la línea base de bundle ANTES de instalar recharts.**
  Correr `pnpm build` y guardar la tabla por ruta (tamaño + First Load JS), con especial atención
  a `/analitica` y `/mis-asignaciones`.
  **Hecho:** la tabla está pegada en `progress/impl_130.md` bajo «línea base», con el SHA del
  commit medido. *(Va primero: después de instalar ya no se puede medir el antes.)*
  **Depende de:** T0.

- [ ] **T1.2 — Instalar `recharts` (D1).**
  `pnpm add recharts` (el repo es pnpm, nunca npm). Verificar que `pnpm-lock.yaml` queda coherente.
  **Hecho:** `package.json` lista `recharts` en `dependencies`; `pnpm install --frozen-lockfile`
  pasa; `pnpm typecheck` sigue en verde.
  **Depende de:** T1.1.

- [ ] **T1.3 [P] — Sincronizar la base con `dev`.**
  El worktree está en `dev` @ `71778fa3` y **no tiene** la 129 ni la 135 (D2/D3). Sin ellas, R3 no
  compila. **Lo hace el leader**, no el implementer.
  **Hecho:** `lib/analytics/types.ts` y `app/(app)/analitica/_components/AnaliticaShell.tsx`
  existen en el árbol de trabajo y `pnpm test` está en el mismo estado que `dev`.
  **Depende de:** T0. **Bloquea:** T2.1, T3.*, T4.*.

- [ ] **T1.4 [P] — Reconfirmar I19–I28 sobre el árbol de trabajo ya sincronizado.**
  Esos hechos están citados de `origin/dev` y son reproducibles con `git show origin/dev:<ruta>`;
  tras T1.3 se comprueban una vez más contra el árbol real (props del shell, `MetricaUnidad`,
  `RANGO_TOPE_DIAS`, `ROLES_ANALITICA`), porque `dev` avanza mientras esta feature vive.
  **Regla, aprendida a golpes en esta misma spec** (`requirements.md > Nota metodológica`): la
  fuente es `origin/dev`, **nunca** un archivo suelto del scratchpad de otra sesión — puede ser un
  respaldo obsoleto y ya produjo un hallazgo falso una vez.
  **Hecho:** cada hecho I19–I28 queda confirmado o corregido en `progress/impl_130.md`. Si alguno
  cambia, se corrige el spec **antes** de programar.
  **Ya NO está pendiente:** **I29–I32 los reconfirmó el leader contra `origin/dev` el 2026-07-31**
  (dos consumidores y el del portal es sólo un re-export; sin test propio; el string de moneda
  cambia; ningún test afirma hoy la salida en moneda del KPI). **I33 estaba MAL y quedó corregido**
  en la misma verificación: hay 13 consumidores de `formatMonto`/`loadMonedaConfig` y **cinco ya son
  `"use client"`** → H3 reencuadrado. No hace falta re-verificarlos.
  **Depende de:** T1.3.

---

## T2 — Núcleo puro (sin React, sin DOM)

- [ ] **T2.1 — `components/private/analytics/tipos.ts`.**
  `PuntoDato`, `SerieDato`, `EstadoVisual`, `GraficaProps`, `KpiCardProps`, con
  `import type { MetricaUnidad } from "@/lib/analytics/types"` (R3). Sin runtime, sin `index.ts`.
  **Hecho:** `pnpm typecheck` pasa; el archivo no contiene ningún `import` que no sea `import type`.
  **Depende de:** T1.3, T1.4.

- [ ] **T2.2 [P] — `paleta.ts` + su test** (R16–R19, R30).
  `TOKENS_SERIE`, `tokenDeSerie(indice)`, `varDeSerie(indice)`. **No cicla** (Q3): el índice válido
  es `[0, MAX_SERIES)` y la asignación es inyectiva.
  **Hecho:** `tests/unit/components/analytics-paleta.test.ts` verde, incluidos «cinco índices →
  cinco tokens distintos», «MAX_SERIES coincide con el número de tokens» y el test que lee
  `app/globals.css` y afirma que los tokens existen en `:root` **y** en `.dark`.
  **Depende de:** T2.1.

- [ ] **T2.4 [P] — `topes.ts` + su test** (R30–R33, Q3 y Q6).
  `MAX_SERIES = 5`, `MAX_PUNTOS_SERIE = 62`, `SeriesExcedidasError`, `PuntosExcedidosError`,
  y las dos funciones puras de recorte: series → conserva las **primeras** 5 en orden; puntos →
  conserva los **últimos** 62. Fuera de `production` lanzan; en `production` recortan y devuelven
  además el dato para el aviso textual («5 de 8»).
  **Hecho:** `tests/unit/components/analytics-topes.test.ts` verde con las dos ramas de `NODE_ENV`
  en las dos funciones (4 casos) y con la aserción `53 < MAX_PUNTOS_SERIE < 366` que ancla el
  número de `design.md §3.4`. Sin DOM: el archivo no importa `@testing-library/react`.
  **Depende de:** T2.1.

- [ ] **T2.3 [P] — `formato.ts` + su test** (R20, R21, y el total de R23).
  `formatearValor(valor, unidad)` para las cuatro unidades, con `lib/config/moneda.ts` para
  `moneda` y `SIN_MONTO` para `null`. Sin símbolo literal en el paquete (R13).
  **Hecho:** `tests/unit/components/analytics-formato.test.ts` verde; el archivo de test no importa
  `@testing-library/react`.
  **Depende de:** T2.1.

---

## T3 — Componentes

- [ ] **T3.1 — `SerieTextual.tsx`** (R10, R11, R31, R33).
  Alternativa textual compartida: una entrada por punto (categoría, serie, valor formateado), ya
  pasada por los recortes de `topes.ts`, más el **aviso textual** de recorte cuando lo haya.
  **No importa recharts.** Es la pieza de la que dependen casi todas las aserciones (§6.2).
  **Hecho:** renderiza N entradas para N puntos, muestra el marcador de ausente —no `0`— cuando
  `valor === null`, **nunca** emite más de `MAX_SERIES × MAX_PUNTOS_SERIE` entradas, y anuncia
  «se muestran X de Y» cuando ha recortado.
  **Depende de:** T2.2, T2.3, T2.4.

- [ ] **T3.2 — Envoltura de estados compartida** (R5–R8, R25).
  Precedencia error > carga > vacío > datos, espejo de `DataTable.tsx:316-425`. El vacío usa
  `EmptyState` con texto de *métrica sin datos en el rango*, nunca el del shell (R25).
  **Hecho:** los tres estados renderizan lo suyo y **nada más**; con error y carga a la vez, gana
  el error.
  **Depende de:** T3.1.

- [ ] **T3.3 — `KpiCard.tsx`** (R12–R15).
  Sin recharts y **sin animación**: formatea con `formato.ts`. Q5 decidió *arreglar* el compartido,
  **no** montarlo aquí (`design.md §7.2`); animar exigiría además enseñar a `KpiValorAnimado` a
  respetar `prefers-reduced-motion` (R28), y eso no está pedido.
  **Hecho:** `tests/components/AnalyticsKpiCard.test.tsx` verde en las cuatro unidades, el nulo y
  el signo de la variación anunciado por texto; el archivo no importa `react-countup`.
  **Depende de:** T3.2.

- [ ] **T3.4 [P] — `lienzo/BarrasLienzo.tsx`, `LineasLienzo.tsx`, `DonutLienzo.tsx`.**
  Los **únicos** archivos que importan `recharts`. Sin lógica de dominio: reciben series y colores
  ya resueltos por `paleta.ts` (R16). Ancho fluido, sin píxeles fijos (R24). Ningún `useState` +
  `useEffect` sincronizando con recharts (R29; precedente `components/ui/carousel.tsx:42-80`).
  **Q1 = recharts directo:** se compone `recharts` a mano y **no** se crea ni se importa
  `components/ui/chart*` (R39, excepción razonada en `design.md §3.2`).
  **Hecho:** `pnpm lint` en verde (incluida `react-hooks/set-state-in-effect`) y `pnpm typecheck`
  sin `any`; `components/ui/chart.tsx` sigue sin existir.
  **Depende de:** T3.2.

- [ ] **T3.5 [P] — `GraficaBarras.tsx`, `GraficaLineas.tsx`, `GraficaDonut.tsx`.**
  Estados + título accesible (R9) + `SerieTextual` + montaje **diferido** del lienzo (R27, vía
  `next/dynamic`/`React.lazy`). El componente renderiza sin que el lienzo haya cargado.
  **Hecho:** con el chunk del lienzo sin resolver, el título y la alternativa textual ya están en
  el DOM.
  **Depende de:** T3.4.

- [ ] **T3.6 — `TablaResumen.tsx`** (R22, R23, R38).
  **Q4 = (a): entra en esta feature.** Sobre `DataTable`, con formato por `MetricaUnidad` tomado de
  `formato.ts` y fila de totales calculada por función pura.
  **Hecho:** no existe ningún `<table>` propio en el archivo; la fila de totales es distinguible; y
  un llamador **no** pasa formateadores (si los pasara, la pieza no aporta y se rechaza,
  `design.md §7.1`).
  **Depende de:** T2.3.

---

## T4 — Tests de componente

- [ ] **T4.1 — `tests/components/AnalyticsGraficas.test.tsx`** (R5–R11, R28).
  `// @vitest-environment jsdom` en la primera línea (`vitest.config.ts:10`). Mock **local** de
  recharts (`vi.mock`), nunca global (§6.3). Estados con `it.each` sobre las tres gráficas.
  **Hecho:** verde, y ninguna aserción depende de anchos, coordenadas ni de cuántos `<rect>` pintó
  recharts (§6.2.3).
  **Depende de:** T3.5.

- [ ] **T4.2 [P] — `tests/components/AnalyticsKpiCard.test.tsx`** y, si aplica,
  `AnalyticsTablaResumen.test.tsx`.
  **Hecho:** verdes; el de la tabla afirma que hereda skeleton/vacío/error de `DataTable`.
  **Depende de:** T3.3, T3.6.

- [ ] **T4.3 — Si hiciera falta tocar `tests/setup/jest-dom.ts`: medir la suite antes y después.**
  Ese archivo es global (§6.3). Precedente: la 163 con `IntersectionObserver` (`:62-82`).
  **Hecho:** conteo de tests pasados/fallados antes y después, pegado en `progress/impl_130.md`,
  con delta **0** en tests ajenos. Si el delta no es 0, se revierte y se vuelve al mock local.
  **Depende de:** T4.1.

- [ ] **T4.4 — `tests/components/AnalyticsEncajeShell.test.tsx`** (R24, R25).
  Renderiza cada componente dentro de una `<section className="flex flex-col gap-4">`, que es el
  contenedor real del slot `operativo` (`design.md §8.1`).
  **Hecho:** ningún componente fija ancho ni alto en píxeles; el texto del vacío no repite el del
  shell.
  **Depende de:** T3.5.

- [ ] **T4.5 — Comprobación de mutación de la única aserción sobre el lienzo** (R41).
  El stub de `ResizeObserver` (`tests/setup/jest-dom.ts:45-55`) tiene `observe(){}` vacío, así que
  `ResponsiveContainer` renderiza **vacío** en vez de fallar: una aserción sobre el SVG puede estar
  verde sin medir nada (`design.md §6.2.1`). Se quita a mano el montaje del lienzo en
  `GraficaBarras.tsx`, se corre el test y **debe ponerse rojo**; se restaura.
  **Hecho:** en `progress/impl_130.md` consta el nombre del test, la mutación aplicada y la salida
  roja. Si la mutación no lo pone rojo, la aserción se reescribe: no vale como evidencia.
  **Depende de:** T4.1.

- [ ] **T4.6 [P] — `tests/components/AnalyticsGraficas.test.tsx`: tope de series y de puntos**
  (R10 acotado, R31, R33).
  Con 8 series y con 400 puntos, en `NODE_ENV` de producción simulado: la alternativa textual no
  pasa de `MAX_SERIES × MAX_PUNTOS_SERIE` entradas y aparece el aviso «X de Y».
  **Hecho:** verde, y el conteo de entradas se afirma con un número, no con un «alguna».
  **Depende de:** T3.5, T2.4.

---

## T5 — Guards y coste

- [ ] **T5.1 — `tests/unit/components/analytics-paquete-guard.test.ts`** (R1–R4, R26, R29, R34,
  R39, R40, R41).
  Censo estático sobre `components/private/analytics/**`: sin `fetch(`, sin `'use server'`, sin
  `next/headers`/`swr`/`lib/actions`/`lib/db`/`@prisma/client`; sin `@/lib/analytics/metrics`; sin
  `window`/`document`/`matchMedia`; sin `useState`+`useEffect` sincronizando; `recharts` sólo
  importado desde `analytics/lienzo/**` **en todo el repo**; **sin `components/ui/chart*`** (Q1,
  R39); **sin `next-themes` ni escritura de la clase `dark`** (Q2, R40); **sin agrupación en
  «otros» ni re-muestreo temporal** (Q3/Q6, R34); y, sobre `tests/`, que ningún test del paquete
  consulte nodos de recharts (R41).
  **Hecho:** verde, y **falla de verdad** si se introduce a mano cualquiera de esas violaciones
  (probado al escribirlo — un guard que no ha fallado nunca no es un guard,
  `docs/verification.md:21-24`).
  **Depende de:** T3.5.

- [ ] **T5.2 — Medir el bundle DESPUÉS y comparar** (R27).
  `pnpm build`; tabla por ruta frente a la línea base de T1.1.
  **Hecho:** en `progress/impl_130.md` están las dos tablas y una afirmación explícita de que el
  *First Load JS* de `/mis-asignaciones` **no cambia** y de que recharts viaja en un chunk propio,
  fuera del First Load de `/analitica`. Si cambia, la feature no pasa: se corrige el diferido.
  **Depende de:** T3.5, T1.1.

---

## T7 — Arreglo del compartido `KpiValorAnimado` (Q5)

**Bloque aparte a propósito.** Es el único trabajo de esta feature **fuera** de
`components/private/analytics/`, toca un archivo con dos consumidores vivos y debe poder revertirse
solo, sin arrastrar el resto de la 130. **Un commit por task**, y ninguno mezclado con el paquete.
Todo el bloque es **`[P]` respecto a T2–T5**: sólo depende de T1.3 y no toca ningún archivo del
paquete de analítica.

- [ ] **T7.1 — Test del comportamiento ACTUAL, antes de tocar nada** (R37).
  `tests/components/KpiValorAnimado.test.tsx` (`// @vitest-environment jsdom` en la primera línea).
  Cubre: entero sin moneda, valor con `moneda`, `null`/no numérico. Hoy **no existe ningún** test de
  este componente (I30): su cobertura es indirecta.
  **Hecho:** el archivo existe y está **verde contra el código sin modificar**. Escribirlo después
  del cambio no vale: certificaría el cambio, no lo que había.
  **Depende de:** T1.3.

- [ ] **T7.2 — Medir la suite ANTES del cambio.**
  `pnpm test` completo. Se anotan **archivos** y **tests** pasados/fallados, no sólo «verde»: una
  corrida con *unhandled errors* de workers omite archivos enteros y parece casi verde.
  **Hecho:** el conteo, con SHA, está en `progress/impl_130.md` bajo «baseline T7».
  **Depende de:** T7.1.

- [ ] **T7.3 — Aplicar el arreglo y comparar** (R35, R36).
  Quitar `const SIMBOLO = "₡"` (`components/shared/KpiValorAnimado.tsx:14`) y formatear con
  `lib/config/moneda.ts`. **No se toca `tests/setup/jest-dom.ts`**: el mock de `react-countup`
  (`:16-24`) llama a `formattingFn(end)` y sigue sirviendo sin cambios.
  **Hecho:** `tests/components/KpiValorAnimado.test.tsx`, `tests/components/MisAsignacionesPage.test.tsx`
  y `tests/components/CierresAdminModule.test.tsx` verdes; conteo de la suite completa **igual** al
  de T7.2 → **delta 0 en tests ajenos**, pegado en `progress/impl_130.md`. **Regla de corte: si el
  delta no es 0, se revierte el commit y Q5 vuelve a la puerta.** No se retocan tests ajenos para
  que encajen.
  **Depende de:** T7.2.

- [ ] **T7.4 — Dejar escrita la limitación que el arreglo NO resuelve (H3), con su encuadre.**
  `loadMonedaConfig` lee `process.env[name]` con clave dinámica, así que en cliente la configuración
  cae al *default* `es-CR`/`CRC`. **No es una frontera que abra esta feature:** cinco componentes
  `"use client"` ya consumen `formatMonto` en producción (I33 corregido); `KpiValorAnimado` es el
  sexto. El arreglo lo **alinea** con sus vecinos.
  **Hecho:** consta en `progress/impl_130.md` como limitación **preexistente** y fuera de alcance,
  con el mismo texto que `requirements.md > H3`, incluida la recomendación al humano de tratarla en
  ficha propia sobre `lib/config/moneda.ts` (seis consumidores cliente). **No se abre ficha desde
  aquí** y **no se cuenta como defecto de la 130**.
  **Depende de:** T7.3.

---

## T8 — Cierre

- [ ] **T8.1 — Mapa `R<n> → test` completo en `progress/impl_130.md`.**
  Las **41** filas de `requirements.md > Trazabilidad`, con el nombre real del test. Tres tienen
  evidencia que no es una aserción de vitest y **debe decirse cuál es**: R27 → medición de T5.2;
  R36 → delta 0 de suite de T7.3; R41 → comprobación de mutación de T4.5.
  **Hecho:** ningún `R<n>` sin test o sin evidencia (`CHECKPOINTS.md:11-13`).
  **Depende de:** T4.*, T5.*, T7.*.

- [ ] **T8.2 — `./init.sh` en verde.**
  Con `pnpm typecheck`, `pnpm lint` y `pnpm test` incluidos (`docs/verification.md:6-13`).
  **Hecho:** salida real pegada en `progress/impl_130.md`. Ojo con el baseline: mídelo en este
  árbol, no cites uno heredado.
  **Depende de:** T8.1.

- [ ] **T8.3 — Marcar todas las tasks `[x]`, entrada en `progress/history.md`, feature a
  `done` sólo tras `progress/review_130.md` con veredicto OK** (`CHECKPOINTS.md:43-46`).
  **Hecho:** los tres artefactos existen.
  **Depende de:** T8.2.
