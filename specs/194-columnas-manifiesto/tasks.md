# Feature 194 — Columnas del manifiesto elegibles por acción · tasks.md

Convenciones: `[P]` = paralelizable con las tareas marcadas igual dentro del mismo bloque.
Cada tarea declara los requisitos que cubre, los archivos exactos y su criterio de "hecho".
Ningún archivo de `lib/services/`, `lib/actions/`, `lib/types/manifiesto.ts`, `app/` ni
`db/` se toca en esta feature.

---

## [x] T0 — Puerta de aprobación
Depende de: nada.
Requisitos: —
El humano lee los tres archivos de `specs/194-columnas-manifiesto/` y responde las tres
preguntas abiertas de `requirements.md`.
**Hecho cuando**: la feature 194 pasa a `spec_ready` → `in_progress` con las respuestas
anotadas en `status_note` o en `progress/`.

---

## [x] T1 [P] — Módulo puro de preferencia
Depende de: T0.
Requisitos: R14, R16, R17, R19, R20, R21, R22.
Archivos: **crear** `lib/manifiesto/preferencia-columnas.ts`.
Contenido: `claveColumnas`, `leerCrudoColumnas`, `sanearOcultas`, `columnasVisibles`,
`guardarOcultas` según design §3. Sin React, sin imports de componentes. Comentario de cabecera
que explique por qué se guardan las OCULTAS y no las visibles (design §9/A1).
**Hecho cuando**: `pnpm typecheck` y `pnpm lint` verdes y el módulo no importa nada de
`components/`, `hooks/` ni `app/`.

## [x] T2 [P] — Etiquetas legibles
Depende de: T0 (y de la respuesta a la pregunta abierta 1).
Requisitos: R5.
Archivos: **crear** `lib/manifiesto/etiquetas-columnas.ts`.
Contenido: mapa `header -> etiqueta` de las 12 actuales + `etiquetaColumna(header)` con
fallback al propio `header`.
**Hecho cuando**: typecheck verde y el mapa NO se declara como exhaustivo (nada de
`Record<ClaveCerrada, string>` que rompa al publicarse una columna nueva — R23).

## [x] T3 [P] — Parámetro opcional del generador
Depende de: T0.
Requisitos: R7, R8, R9, R13, R23, R24.
Archivos: **modificar** `lib/utils/manifiesto-xlsx.ts`.
Contenido: segundo parámetro `clavesVisibles?: readonly string[]`; filtro sobre
`COLUMNAS_MANIFIESTO` preservando orden; 0 resultantes → conjunto completo; ampliar el
comentario de cabecera (líneas 18-32) sin derogar la regla 160/R28.
**Hecho cuando**: `pnpm vitest run tests/unit/utils/manifiesto-xlsx.test.ts` pasa **sin haber
modificado ese archivo de test** (prueba de R24).

---

## [x] T4 — Tests del módulo puro
Depende de: T1.
Requisitos: R14, R16, R17, R19, R20, R21, R22.
Archivos: **crear** `tests/unit/manifiesto/preferencia-columnas.test.ts`.
Casos mínimos, uno por requisito:
- sin valor guardado devuelve todas las columnas publicadas (R17);
- guarda bajo `ordenex:manifiesto-columnas:<flujo>` y lo recupera (R14);
- guardar en `carga_masiva` no altera la clave de `asignacion_satelite` (R16);
- descarta una clave guardada que ya no está en las publicadas (R19) — se pasa una lista
  `publicadas` de prueba, NO la constante real, para no acoplarse a "12" (R23);
- si todas las guardadas ocultarían todo, devuelve todas visibles (R20);
- JSON inválido / `{"ocultas":"x"}` / `[1,2]` / `localStorage` que lanza → todas visibles y no
  lanza (R21);
- una columna publicada que no figura en la lista guardada sale VISIBLE (R22).
**Hecho cuando**: los 8 casos pasan y ninguno afirma un número total de columnas.

## [x] T5 — Tests del generador con subconjunto
Depende de: T3.
Requisitos: R7, R8, R9, R13, R24.
Archivos: **crear** `tests/unit/utils/manifiesto-xlsx-columnas.test.ts` (archivo NUEVO; el
vigente `manifiesto-xlsx.test.ts` no se toca).
Casos: cabecera contiene solo las claves máquina pedidas y no las ocultas (R7, R9); pasar las
claves en orden invertido produce igualmente el orden de `COLUMNAS_MANIFIESTO` (R8); array
vacío → todas las publicadas (R13); sin segundo parámetro → todas las publicadas (R24).
**Hecho cuando**: pasan y los asertos se expresan como "contiene / no contiene / índice
relativo", nunca como `toHaveLength(12)` (R23).

## [x] T6 — Hook de preferencia
Depende de: T1.
Requisitos: R15, R18, R12 (guard).
Archivos: **crear** `hooks/usePreferenciaColumnasManifiesto.ts`.
Contenido: `useSyncExternalStore` con snapshot = string crudo, `getServerSnapshot` = `null`,
suscripción a `storage` + `ordenex:manifiesto-columnas-cambio`, derivación con `useMemo`,
`alternar` con guard de "última visible", `restablecer`.
**Hecho cuando**: typecheck + lint verdes (en particular sin violar
`react-hooks/set-state-in-effect`) y un render de prueba no entra en bucle.

## [x] T7 — Popover de selección
Depende de: T2, T6.
Requisitos: R1, R2, R3, R4, R5, R6, R12.
Archivos: **crear** `components/shared/ColumnasManifiestoPopover.tsx`.
Contenido: trigger icono con `aria-label="Elegir columnas del manifiesto"`, `Popover` de
`@base-ui/react/popover` (patrón `NotificationsBell.tsx:145`), una `Checkbox` + `Label` por
columna publicada con nombre accesible que incluya la clave máquina, acción "Restablecer",
última casilla marcada deshabilitada con texto de ayuda.
**Hecho cuando**: typecheck + lint verdes y NO se añade ninguna dependencia a `package.json`.

## [x] T8 — Enganche en el botón compartido
Depende de: T3, T7.
Requisitos: R10, R11, R25.
Archivos: **modificar** `components/shared/DescargarManifiestoButton.tsx`.
Contenido: envolver botón + popover en un `flex items-center gap-1`; seguir devolviendo `null`
con selección vacía; pasar `clavesVisibles` a `buildManifiestoXlsx`; no tocar la llamada a
`obtenerManifiesto` ni `manifiestoFileName`; conservar el import dinámico del generador.
**Hecho cuando**: `pnpm vitest run tests/components/DescargarManifiestoButton.test.tsx
tests/components/ManifiestoFlujos.test.tsx tests/components/GenerarGuiaModal.test.tsx` pasa
**sin modificar esos archivos de test**.

---

## [x] T9 — Tests de UI del selector
Depende de: T7.
Requisitos: R1, R2, R3, R4, R5, R6, R12.
Archivos: **crear** `tests/components/ColumnasManifiestoPopover.test.tsx`.
Casos: el control existe junto al botón y se abre (R1); lista una casilla por columna publicada
en el orden del archivo (R2); refleja marcada/desmarcada según lo guardado (R3); el nombre
accesible contiene la clave máquina (R4); una columna sin etiqueta declarada se muestra con su
header (R5); "Restablecer" vuelve a todas marcadas (R6); con una sola marcada, esa casilla está
deshabilitada y el aviso de mínimo es visible (R12).
**Hecho cuando**: pasan en jsdom y ninguno afirma un número total de columnas (R23).

## [x] T10 — Test de integración botón + preferencia
Depende de: T8, T9.
Requisitos: R10, R11, R14, R15, R16, R18, R25.
Archivos: **crear** `tests/components/DescargarManifiestoColumnas.test.tsx`.
Casos:
- un solo click en el botón descarga con la preferencia guardada, sin abrir el selector (R10);
- el nombre del archivo no cambia al exportar un subconjunto (R11);
- desmarcar una columna persiste y sigue vigente tras remontar (R14, R15);
- **aislamiento**: cambiar `carga_masiva` no altera lo que ofrece `asignacion_satelite` (R16);
- dos botones del mismo flujo montados a la vez se sincronizan sin recargar (R18);
- `obtenerManifiesto` se llama con el MISMO input de hoy, sin información de columnas (R25);
- `buildManifiestoXlsx` recibe las claves visibles esperadas (mock, mismo patrón del test
  vigente de `DescargarManifiestoButton`).
**Hecho cuando**: pasan y el mock de `@/lib/utils/manifiesto-xlsx` se mantiene (exceljs fuera).

## [x] T11 — Verificación de invariantes no derogadas
Depende de: T4, T5, T9, T10.
Requisitos: R23, R26.
Archivos: ninguno de producción. Revisión + ejecución.
Acciones: `git diff --stat` no muestra cambios en `lib/services/`, `lib/actions/`,
`lib/types/manifiesto.ts`, `app/`, `db/`; los tests vigentes del route handler de API key
pasan sin modificarse (R26); grep de los tests nuevos sin `toHaveLength(12)` ni equivalentes
sobre el total de columnas (R23).
**Hecho cuando**: las tres comprobaciones quedan anotadas en `progress/impl_194.md`.

## [x] T12 — Mapa de trazabilidad y gate
Depende de: T11.
Requisitos: todos.
Archivos: **crear** `progress/impl_194.md`.
Contenido: tabla `R1..R26 -> archivo::nombre del test`, sin huecos.
**Hecho cuando**: `./init.sh` completo termina en verde (obligatorio antes del PR, no basta
`--rapido`) y la tabla cubre los 26 requisitos.

---

## Orden sugerido

```
T0
 ├─ T1 [P] ──┬─ T4
 │           └─ T6 ── T7 ── T9
 ├─ T2 [P] ──┘        │
 └─ T3 [P] ── T5      │
             └──────── T8 ── T10
                              └── T11 ── T12
```
