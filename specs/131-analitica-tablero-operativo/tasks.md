# Feature 131 — analítica: tablero operativo · tasks

Leyenda: `[P]` = paralelizable con las tasks de su mismo bloque. Cada task lleva su **criterio de
hecho** verificable. Nadie corre la suite completa salvo el leader (`AGENTS.md > Regla del gate`).

---

## T0 — Puerta T0 (bloquea todo lo demás)

- [x] **T0.1 — Respuestas humanas a Q1…Q5. CERRADA (2026-08-03).**
  Registradas como **D1–D7** en `requirements.md §6` con su motivo, y propagadas a `design.md`
  (§1.2/§1.3 → D5 · §4.2 → D7 · §4.3 y §10.1 → D4 · §6.1 → D6 · §6.3 → D3 · §6.4 → D1/D2).
  **Hecho:** «Preguntas abiertas» dice **Ninguna**. De la puerta nacen **R27** —el «KPI total» que
  D3 pedía **no es computable hoy** sin caer en media de medias, así que el hueco se declara en
  pantalla en vez de rellenarse— y la **ficha nueva** descrita en `requirements.md §7`, que **da de
  alta el humano** en `feature_list.json`: esta spec **no toca ese archivo**.
  **Depende de:** nada.

- [ ] **T0.2 — Verificar que `dev` no se movió bajo los pies.**
  `git fetch origin dev` + `git log --oneline origin/dev -5` y comprobar que la 126 sigue en `dev`
  (`lib/actions/analitica-operativa.ts` presente) y que la 132 no ha aterrizado todavía.
  **Hecho:** los dos hechos anotados en `progress/impl_131.md` con el SHA de `origin/dev`.
  **Depende de:** nada. `[P]` con T0.1.

---

## T1 — Módulos puros (todo el riesgo real vive aquí)

Se escriben **antes** que la UI: son los que llevan 12 de los 27 requisitos y se prueban sin
render, sin jsdom y sin mocks de red.

- [ ] **T1.1 — `filtro-tablero.ts`** — `FiltroTablero`, estado inicial, `aRaw()`,
  `desdeSearchParams()`, `aSearchParams()`.
  **Hecho:** `tests/unit/analytics/tablero-filtro.test.ts` verde con los tres casos de R11/R13/R14,
  y el caso de R11 **pasa el objeto emitido por `analiticaFiltroSchema.safeParse` real** (no por una
  copia del esquema).
  **Depende de:** T0.

- [ ] **T1.2 — `agregacion.ts`** `[P]` — «otros» (R15), agregación semanal de conteos (R16, R17),
  herencia de parcialidad (R18), totales parciales (R9), propagación de `null` (R20).
  **Hecho:** `tests/unit/analytics/tablero-agregacion.test.ts` verde, incluyendo un caso que afirma
  que una serie de `unidad: "porcentaje"` **no** produce puntos agregados.
  **Depende de:** T0.

- [ ] **T1.3 — `catalogo-paneles.ts`** `[P]` — lista declarativa de paneles.
  **Hecho:** `tests/unit/analytics/tablero-catalogo-paneles.test.ts` verde: todo `metricaId` existe
  en `getMetrica()`, todos son `dominio: "operativa"`, toda `desagregacion` declarada está en los
  `granos` de su métrica, y el catálogo **no** consulta `estadoProduccion`.
  **Depende de:** T0.

- [ ] **T1.4 — `textos.ts`** `[P]` — textos de cobertura, penumbra, parcial, prohibido, sesión no
  válida, error saneado, aviso de recorte y aviso de grano.
  **Hecho:** ningún literal de fecha de horizonte en el archivo; los textos de cobertura se
  construyen como funciones de `(fechasNoComparables)`.
  **Depende de:** T0.

- [ ] **T1.5 — Mutaciones de T1.** Ejecutar las 12 mutaciones de la tabla de trazabilidad que
  corresponden a módulos puros (R9, R11, R13, R14, R15, R16, R17, R18, R20, R21) y confirmar que
  **cada una pone rojo el test nombrado**.
  **Hecho:** salida pegada en `progress/impl_131.md`, una línea por mutación, con el test que cayó.
  **Depende de:** T1.1–T1.4.

---

## T2 — Barra de filtros

- [ ] **T2.1 — `FiltrosOperativos.tsx`.** Cliente. `MultiSelectFilter` × 3 + selector de preset +
  `DateRangeFilter` para `personalizado`. Escribe en la URL con `router.replace`.
  **Hecho:** render con las cuatro etiquetas accesibles; cambiar zona actualiza la URL.
  **Depende de:** T1.1.

- [ ] **T2.2 — Catálogo de opciones con degradado (R22).** `obtenerCatalogoFiltrosOrdenes()` y
  `listarUsuariosPorRol("mensajero")` vía SWR; cualquier resultado distinto de `ok` y cualquier
  excepción → selector `disabled`, nunca pantalla rota.
  **Hecho:** `tests/components/FiltrosOperativos.test.tsx` verde en los casos de R12 y R22, y la
  mutación de R22 (propagar la excepción) los pone rojos.
  **Depende de:** T2.1.

---

## T3 — Paneles y estados

- [ ] **T3.1 — `PanelOperativo.tsx`.** Un panel: clave SWR `[metricaId, desagregacion, filtro]`,
  fetcher = `consultarAnaliticaOperativa`, y las **cinco** ramas de resultado (ok /
  validation_error / forbidden / unauthenticated / excepción) mapeadas a estado visual.
  **Hecho:** `tests/components/TableroOperativo.test.tsx` verde en R2, R3, R4, R24; la mutación de
  R2 (tratar `forbidden` como serie vacía) pone rojo su test nombrado.
  **Depende de:** T1.2, T1.3, T1.4.

- [ ] **T3.2 — `PanelesOperativos.tsx`.** Rejilla de paneles + aviso de cobertura + botón
  «Actualizar» (R23).
  **Hecho:** el botón dispara `mutate` de todas las claves y no modifica la URL; test de R23 verde y
  su mutación lo pone rojo.
  **Depende de:** T3.1.

- [ ] **T3.3 — Cobertura y parcialidad en pantalla (R5, R6, R8, R19, R27).**
  Incluye el panel de tasa/tiempo por encima del techo: aviso de reducir el rango y **cero cifras**
  (D3/R27). El test nombrado debe caer si alguien mete ahí un `KpiCard` con la media diaria.
  **Hecho:** los cuatro tests nombrados verdes; en particular, un caso con
  `fechasNoComparables: ["2026-07-10","2026-07-11"]` en el payload de prueba muestra recuento y
  extremos, y un punto con `parcial: true` se anuncia con su corte.
  **Depende de:** T3.1.

- [ ] **T3.4 — Mutaciones de T2/T3.** Ejecutar las mutaciones de R2, R3, R4, R5, R6, R8, R12, R19,
  R22, R23, R24, R27.
  **Hecho:** salida pegada en `progress/impl_131.md`.
  **Depende de:** T3.3, T2.2.

---

## T4 — Guardia de frontera (§1.4 del design)

- [ ] **T4.1 — Parte permanente.** Los cinco censos de §1.4, con el caso de discriminación.
  **Hecho:** `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` verde y las
  mutaciones de R1, R10 y R25 lo ponen rojo (una por caso).
  **Depende de:** T3.2.

- [ ] **T4.2 — Parte branch-scoped, con su cabecera de caducidad LITERAL.** El bloque lleva escrito
  en el archivo que **caduca en el merge**, por qué, y qué parte sobrevive.
  **Hecho:** la cabecera está en el archivo; la retirada queda anotada como decisión del PR en
  `progress/impl_131.md` (patrón T13.1 de la 126).
  **Depende de:** T4.1.

---

## T5 — Verificación de la trazabilidad

- [ ] **T5.1 — Tabla `R<n> → test → mutación` completa en `progress/impl_131.md`**, 27 filas, con la
  salida real de cada mutación.
  **Hecho:** ninguna fila dice «pendiente» y ninguna mutación quedó sin ejecutar.
  **Depende de:** T1.5, T3.4, T4.1.

---

## T6 — Cableado a la ruta (se hace AL FINAL, es la parte que colisiona)

- [ ] **T6.1 — `page.tsx`: dos props de slot.** `<AnaliticaShell filtros={…} operativo={…} />` y
  nada más. **Prohibido** en este archivo: `searchParams`, parámetros de la función, imports de
  `lib/actions`, `lib/services` o `lib/repositories`.
  **Hecho:** `tests/components/AnaliticaPage.test.tsx` sigue verde en sus aserciones R5 y R24 **sin
  modificarlas** (solo se añaden mocks). `AnaliticaPage.length === 0` sigue siendo cierto.
  **Depende de:** T3.2, T2.2.

- [ ] **T6.2 — Ampliar `tests/components/AnaliticaPage.test.tsx` con los mocks del nuevo árbol.**
  **Hecho:** el archivo conserva íntegros sus describes de la 129 (R1–R6, R24) y añade uno que
  afirma que las dos regiones ya **no** muestran el placeholder «llega en una entrega posterior».
  **Depende de:** T6.1.

- [ ] **T6.3 — Comprobar que el shell NO se tocó.** `git diff origin/dev --name-only` no incluye
  `AnaliticaShell.tsx` ni nada de `components/private/analytics/` ni de `lib/`.
  **Hecho:** salida pegada; coincide con la lista de §1 del design.
  **Depende de:** T6.1.

---

## T7 — Cierre

- [ ] **T7.1 — `pnpm typecheck` + `pnpm lint` + `pnpm exec vitest related --run <archivos nuevos>`.**
  (El subagente corre **solo** esto; la suite es del leader.)
  **Hecho:** cero errores; salida pegada.
  **Depende de:** T6.3.

- [ ] **T7.2 — Medir el coste de N invocaciones. NO es opcional: D4 la hace parte de la entrega.**
  Contar las invocaciones que dispara un cambio de filtro y anotar si se solapan o se serializan, y
  cuánto tardan.
  **Hecho:** número medido y método anotado en `progress/impl_131.md`. Si el resultado desaconseja
  la vía de D4, se **declara**; no se cambia el diseño sin volver a puerta humana, y la Server
  Action compuesta sigue descartada mientras la 128 no haya aterrizado.
  **Depende de:** T6.1.

- [ ] **T7.3 — Declarar en la review lo que NO se corrigió y lo que se contradijo a propósito.**
  Tres párrafos: (a) divergencia 2 de la 175 visible en el panel del embudo (design §10.5); (b)
  **D7** — se conservan los tests de `AnaliticaPage.test.tsx` y queda **deliberadamente sin cumplir**
  la expectativa de prefetch de `specs/129-…/design.md:143-145`, con el motivo (el guardia manda
  sobre la prosa del diseño), para que quien lea la 129 encuentre el rastro; (c) **R27** — el hueco
  de tasas/tiempos por encima del techo y la ficha que lo cierra (`requirements.md §7`).
  **Hecho:** los tres párrafos en `progress/impl_131.md`, sin adornos.
  **Depende de:** T7.1.

- [ ] **T7.4 — Sincronizar con `dev` y abrir PR.** `git fetch origin dev` + merge + resolución; si
  la 132 ya aterrizó —no debería, **D5** dice que la 131 va primero—, el conflicto esperado es en
  `page.tsx` y se resuelve **conservando los
  tres slots**.
  **Hecho:** `./init.sh` completo en verde (lo corre el **leader**) y PR abierto hacia `dev`.
  **Depende de:** T7.3.

---

## Mapa de dependencias

```
T0 ──┬─ T1.1 ─┬───────────── T2.1 ── T2.2 ─┐
     ├─ T1.2 ─┤                            ├─ T6.1 ── T6.2
     ├─ T1.3 ─┼─ T3.1 ─ T3.2 ─ T3.3 ─ T3.4 ┘        └ T6.3 ── T7.1 ── T7.2/T7.3 ── T7.4
     └─ T1.4 ─┘            └─ T4.1 ── T4.2
                 T1.5 ────────────────────── T5.1
```
