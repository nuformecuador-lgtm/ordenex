# Feature 129 — Analítica: ruta, shell y sidebar — Tasks

Convenciones: `[P]` = paralelizable con las tareas del mismo bloque. Cada task
lleva su criterio de HECHO. La implementación arranca tras la aprobación humana
del spec (`docs/specs.md` §"puerta de aprobación").

---

## T0 — PUERTA: preguntas abiertas — **CERRADA (2026-07-30)**

Todas las preguntas están respondidas por escrito y propagadas a
`requirements.md` (bloque "Decisiones cerradas con el humano", D1–D8) y a
`design.md`. **T0 no bloquea nada.**

- [x] **T0.1 — RESUELTA. Q1: ¿cinco roles o subconjunto?**
  Respuesta del humano: **SOLO `maestro` y `admin`.** El ítem no se publica a los
  cinco roles en la 129: sin métrica hasta la 131, la página está vacía y darles la
  entrada a `mensajero`/`adminTienda`/`adminSatelite` sería un control que no lleva
  a ninguna parte. **La ampliación es alcance explícito de la 133.**
  Propagado a: R2, R3, R8, R9, R10, R17, "Nota de traspaso" (`requirements.md`);
  D1/D2, §2, §5, A4 y §7 (`design.md`); T1.2, T1.4, T2.1, T4.1, T4.3 (aquí).
- [x] **T0.2 — RESUELTA. Q2: etiqueta.** **"Analítica"**, con tilde, como el resto
  de labels del menú. Propagado a R7 (D3) y a T1.2/T4.1/T4.2.
- [x] **T0.3 — RESUELTA. Q3: clave de icono.** **`chartColumn` → `ChartColumn`** de
  `lucide-react`. Verificado en el paquete instalado: `package.json` declara
  `"lucide-react": "^1.23.0"` y `node_modules/lucide-react/dist/lucide-react.d.ts`
  declara `ChartColumn` (línea 4138) y lo exporta con ese nombre exacto (línea
  24763); **no hace falta nombre alternativo.** Propagado a R11/R12 (D4) y a
  T1.1/T1.3.
- [x] **T0.4 — RESUELTA. Q4: disposición del shell.** **Pila vertical de regiones
  con slots nombrados**, no pestañas; es el contrato que rellenan 130/131/132.
  Propagado a R20 (D5) y a `design.md` §3 / A5.
- [x] **T0.5 — RESUELTA. Q5: región financiera.** **NO se declara en la 129**; la
  añade la 132. La 129 deja sólo el punto de extensión, escrito en el JSDoc del
  shell (`design.md` §3.2). Propagado a R20 (D6) y a T3.1/T3.4.
- [x] **T0.6 — RESUELTA. Q6: posición en `SIDEBAR_ITEMS`** *(decisión del LEADER,
  registrada como tal)*: **justo después de "Inicio" y antes de "Órdenes"**, es
  decir como segundo elemento del array. Razón: comparte exactamente los roles
  `["maestro","admin"]` con "Inicio" y es una vista de resumen, no una sección
  operativa. No hay regla de orden escrita en el repo; queda declarada aquí.
  Propagado a R16 (D7) y a T1.2/T4.1.
- [x] **T0.7 — RESUELTA. Q7: referencias cruzadas de `feature_list.json`.**
  **Desfase de numeración confirmado, NO cambio de alcance** (130/131/132 citan
  "129/128" por una renumeración previa; mismo desfase en 124/125/126). Anotado en
  `design.md` §8 para quien implemente la 131. **No se toca `feature_list.json`
  desde esta feature**: ese registro lo lleva el leader.

---

## T1 — Menú: fuente de verdad

Sin dependencias (T0 cerrada).

- [ ] **T1.1** Añadir la clave `chartColumn` al tipo `IconKey` en
  `lib/auth/menu-visibility.ts`, con comentario que diga por qué NO se reutiliza
  ninguna existente (criterio ya escrito en las líneas 21-24 de ese archivo).
  HECHO: `pnpm run typecheck` falla señalando `ICON_BY_KEY` como incompleto — esa
  falla ES la prueba de que R12 tiene garantía de compilador; se resuelve en T1.3.
- [ ] **T1.2** Añadir el ítem a `SIDEBAR_ITEMS`: `label: "Analítica"`,
  `href: "/analitica"`, `iconKey: "chartColumn"`, `roles: ROLES_ANALITICA`, sin
  `children`, **como segundo elemento del array** (tras "Inicio", antes de
  "Órdenes"). Comentario del patrón: qué feature lo introduce, por qué SOLO
  `maestro`/`admin` (sin métrica hasta la 131), que la 133 amplía, y "este ítem sólo
  decide qué se MUESTRA; la defensa real es el `notFound()` de la página".
  HECHO: el ítem existe en esa posición y `pnpm run lint` pasa.
- [ ] **T1.3** Añadir el import `ChartColumn` de `lucide-react` y la entrada
  `chartColumn: ChartColumn` en `ICON_BY_KEY` de
  `app/(app)/_components/Sidebar.tsx` (mapa en las líneas 138-151).
  HECHO: `pnpm run typecheck` vuelve a verde.
- [ ] **T1.4** Declarar y exportar `ROLES_ANALITICA = ["maestro", "admin"] as const`
  en `lib/auth/menu-visibility.ts` y usarla en el `roles` del ítem (la reusará
  T2.1). **No usar `esAccesoTotal`** (`design.md` §2) ni `ROLES_SEED` (incluye
  `apiKey`, `design.md` §5).
  HECHO: no hay dos listas de roles de analítica en el repo (`rg ROLES_ANALITICA`
  devuelve una sola definición, importada en dos sitios).

## T2 — Ruta y gate

Depende de: T1.4 (por `ROLES_ANALITICA`).

- [ ] **T2.1** Crear `app/(app)/analitica/page.tsx`: Server Component `async` que
  llama `resolveActorFromSession()`, aplica `notFound()` si no hay actor o el rol no
  está en `ROLES_ANALITICA`, y devuelve el shell. Comentario de cabecera al estilo
  de `app/(app)/incidentes/page.tsx:10-24`: qué feature, qué defiende, por qué sólo
  `maestro`/`admin` (D1) con la 133 como ampliación, y que el prefetch de la ficha
  queda fuera de alcance con su razón.
  HECHO: `/analitica` responde el shell para `maestro`/`admin` y 404 para el resto,
  verificado por los tests de T4.3.
- [ ] **T2.2** Verificar que NO se importa nada de analítica de datos: la página no
  referencia `lib/actions/*analitica*`, `lib/services/*Analitica*` ni repositorios.
  HECHO: la lista de imports de `page.tsx` contiene sólo `next/navigation`,
  `resolve-actor`, `menu-visibility` (por `ROLES_ANALITICA`) y el shell.

## T3 — Shell del tablero

Sin dependencias (T0 cerrada). Paralelizable con T1/T2 salvo el ensamblaje de T2.1.

- [ ] **T3.1** `[P]` Crear
  `app/(app)/analitica/_components/AnaliticaShell.tsx` con la interfaz
  `AnaliticaShellProps` de exactamente DOS slots (`filtros?`, `operativo?`) — **sin
  `financiero`** (D6) —, sin `"use client"`, sin fetch, sin cálculo.
  HECHO: el componente compila y su superficie de props es exactamente la del
  `design.md` §3.
- [ ] **T3.2** `[P]` Renderizar el encabezado con `AppPage`
  (`components/shared/AppPage.tsx`, título "Analítica") y las dos regiones apiladas
  verticalmente como `<section aria-label="Filtros">` y
  `<section aria-label="Tablero operativo">`.
  HECHO: el DOM expone un heading de página y exactamente dos `region` con esos
  nombres accesibles.
- [ ] **T3.3** `[P]` Placeholder por región con `components/shared/EmptyState.tsx`
  cuando el slot llega vacío. Texto que declare que el panel llega en una entrega
  posterior. **Cero cifras, cero series, cero ejes** (R22).
  HECHO: `rg` sobre el shell no encuentra ningún literal numérico de métrica y el
  test de T4.4 lo asegura.
- [ ] **T3.4** Documentar en el JSDoc del shell quién enchufa cada slot
  (130 componentes, 131 filtros + operativo, 133 recorte por rol) **y los tres pasos
  mecánicos que debe dar la 132 para añadir la región financiera** (`design.md` §3.2:
  prop nueva, `<section aria-label="Tablero financiero">` bajo la operativa, su
  placeholder).
  HECHO: el JSDoc nombra las cuatro features y enumera los tres pasos de la 132.

## T4 — Tests (trazabilidad R → test)

Depende de: T1, T2, T3. Los cuatro archivos son `[P]` entre sí.

- [ ] **T4.1** `[P]` Extender `tests/unit/auth/menu-visibility.test.ts`: el ítem
  "Analítica" existe y es único por `href` (R7); `puedeVer`/`itemsVisibles` lo
  incluye para `maestro` y `admin` (R8); lo excluye para `mensajero`,
  `adminTienda`, `adminSatelite`, `apiKey` y actor `null` (R9); su `iconKey` es
  `chartColumn` y no coincide con ninguna otra (R11); no trae `children` (R15); su
  índice en `SIDEBAR_ITEMS` es el siguiente al de "Inicio" y anterior al de
  `/ordenes` (R16); el conjunto de etiquetas visibles por rol no cambia salvo la
  adición para maestro/admin (R17).
  HECHO: los siete casos pasan.
- [ ] **T4.2** `[P]` Extender `tests/components/Sidebar.test.tsx`: toda clave de
  `IconKey` resuelve a un componente en `ICON_BY_KEY` (R12); el ítem renderiza un
  enlace a `/analitica` con la etiqueta "Analítica" y su icono (R13); con
  `pathname="/analitica"` el enlace queda `aria-current="page"` (R14).
  HECHO: los tres casos pasan; se usa el helper `linkPorHref` ya existente.
- [ ] **T4.3** `[P]` Crear `tests/components/AnaliticaPage.test.tsx`, calcado de
  `tests/components/IncidentesPage.test.tsx` (mock de `resolveActorFromSession` y de
  `notFound` que lanza): `maestro` y `admin` ven el shell (R1, R2); `mensajero`,
  `adminTienda`, `adminSatelite` y `apiKey` reciben `notFound` (R3); sin sesión,
  `notFound` (R4); el rol sólo sale del mock de sesión, nunca de una prop (R5); el
  gate corre antes de renderizar (R6); la página renderiza con SÓLO `resolve-actor`
  mockeado, es decir no invoca ninguna acción de analítica (R24).
  HECHO: todos los casos pasan.
- [ ] **T4.4** `[P]` Crear `tests/components/AnaliticaShell.test.tsx`: el shell es un
  componente con props tipadas y renderiza el encabezado (R18, R19); expone
  exactamente las regiones "Filtros" y "Tablero operativo" por nombre accesible y
  **ninguna región financiera** (R20); con contenido en un slot lo renderiza en su
  región (R21); sin contenido muestra el estado vacío y ningún texto numérico de
  métrica (R22); render sin mocks de datos ⇒ no fetchea (R23).
  HECHO: todos los casos pasan.
- [ ] **T4.5** Verificar R10 (las dos capas autorizan el mismo conjunto): test que
  compara el `roles` del ítem `/analitica` de `SIDEBAR_ITEMS` con `ROLES_ANALITICA`
  usada por el guard, y falla si divergen. Vive en
  `tests/unit/auth/menu-visibility.test.ts`.
  HECHO: el test existe y falla si se edita uno solo de los dos sitios (verificado
  a mano cambiando uno y revirtiendo).
- [ ] **T4.6** Verificar R25 (sin dependencias nuevas): `git diff` de `package.json`
  y `pnpm-lock.yaml` vacío.
  HECHO: ambos archivos sin cambios en la rama.

### Mapa previsto `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `tests/components/AnaliticaPage.test.tsx` |
| R2 | `tests/components/AnaliticaPage.test.tsx` |
| R3 | `tests/components/AnaliticaPage.test.tsx` |
| R4 | `tests/components/AnaliticaPage.test.tsx` |
| R5 | `tests/components/AnaliticaPage.test.tsx` |
| R6 | `tests/components/AnaliticaPage.test.tsx` |
| R7 | `tests/unit/auth/menu-visibility.test.ts` |
| R8 | `tests/unit/auth/menu-visibility.test.ts` |
| R9 | `tests/unit/auth/menu-visibility.test.ts` |
| R10 | `tests/unit/auth/menu-visibility.test.ts` (T4.5) |
| R11 | `tests/unit/auth/menu-visibility.test.ts` |
| R12 | `tests/components/Sidebar.test.tsx` (+ garantía de `Record<IconKey, …>` en typecheck) |
| R13 | `tests/components/Sidebar.test.tsx` |
| R14 | `tests/components/Sidebar.test.tsx` |
| R15 | `tests/unit/auth/menu-visibility.test.ts` |
| R16 | `tests/unit/auth/menu-visibility.test.ts` |
| R17 | `tests/unit/auth/menu-visibility.test.ts` |
| R18 | `tests/components/AnaliticaShell.test.tsx` |
| R19 | `tests/components/AnaliticaShell.test.tsx` |
| R20 | `tests/components/AnaliticaShell.test.tsx` |
| R21 | `tests/components/AnaliticaShell.test.tsx` |
| R22 | `tests/components/AnaliticaShell.test.tsx` |
| R23 | `tests/components/AnaliticaShell.test.tsx` |
| R24 | `tests/components/AnaliticaPage.test.tsx` |
| R25 | `T4.6` (diff de `package.json` / `pnpm-lock.yaml`) |

## T5 — Verificación y cierre

Depende de: T4.

- [ ] **T5.1** Medir el baseline ANTES de afirmar nada: `pnpm run typecheck`,
  `pnpm run lint`, `pnpm test` sobre la rama base, y luego sobre la rama de la
  feature. Delta esperado de tests rojos: **0**.
  HECHO: ambas salidas pegadas en `progress/impl_129-analitica-ruta-shell-sidebar.md`.
- [ ] **T5.2** `./init.sh` en verde.
  HECHO: salida pegada en el archivo de progreso.
- [ ] **T5.3** Escribir `progress/impl_129-analitica-ruta-shell-sidebar.md` con el
  mapa `R<n> → test` real (no el previsto) y las decisiones D1–D8 de T0.
  HECHO: el archivo existe y cubre los 25 requisitos.
- [ ] **T5.4** Dejar constancia de dos cosas para que el reviewer no las lea como
  omisiones: (a) el E2E se declaró **inaplicable** (`design.md` A7: decisión del
  humano 2026-07-30 + la feature no toca un flujo crítico de los listados en
  `CHECKPOINTS.md`), con su cobertura sustitutiva; (b) la **desviación deliberada
  respecto a la ficha** en cuanto a roles (`design.md` §7), que la 133 cierra.
  HECHO: ambas notas están en el archivo de progreso.

## Notas de ejecución (restricciones vigentes de este checkout)

- **No tocar `app/(app)/ranking/`**: otra sesión trabaja ahí en vivo.
- **No tocar `feature_list.json`**: lo lleva el leader (D8).
- **Nada de `git` que mueva HEAD** (checkout/switch/stash/reset) en este checkout.
- Commits por task lógica (`docs/conventions.md`): p. ej.
  `feat(129): item de sidebar de analitica`, `feat(129): ruta y gate de /analitica`,
  `test(129): gating y shell`.
