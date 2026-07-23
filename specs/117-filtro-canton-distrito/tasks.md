# Feature 117 — Tasks

> Checklist verificable. `[P]` = paralelizable con las tareas hermanas del mismo bloque.
> Cada task cierra con su criterio de "hecho". Nada se da por hecho sin que pasen
> `./init.sh` y la suite de tests (`docs/verification.md`).

## Bloque 0 — Preparación

- [x] **T0.** Crear rama `feature/117-filtro-canton-distrito` desde `dev`.
  - Hecho: `git status` en la rama correcta; árbol limpio.

## Bloque 1 — Lógica pura (sin React) `[P]` con T2

- [x] **T1.** Crear `lib/utils/filtro-canton-distrito.ts` con `derivarCantones`,
  `derivarDistritos` y `filtrarAsignaciones` (firmas en `design.md §3`). Reutiliza
  `normalizeName` (`lib/utils/normalize.ts`).
  - Hecho: `tsc` sin errores; funciones puras exportadas, sin imports de React ni de
    Server Actions.

- [x] **T2 [P].** Crear `tests/unit/filtro-canton-distrito.test.ts` cubriendo R2, R4, R6,
  R7, R13 (dedup insensible a acentos/caso, orden alfabético, exclusión de
  `distritoNombre === null` bajo distrito específico, estabilidad de opciones).
  - Hecho: los tests pasan y fallan si se rompe cualquiera de esas reglas.

## Bloque 2 — Presentación y estado (depende de T1)

- [x] **T3.** Crear `app/(app)/mis-asignaciones/_components/useFiltroCantonDistrito.ts`:
  estado `canton`/`distrito` (`""`=todos), `setCantonYReset` (R5), opciones memoizadas
  (R2/R4/R13), `hayFiltro` (R9), `limpiar` (R8), `aplicar(lista)` (R6/R7).
  - Hecho: `tsc` sin errores; hook devuelve el contrato descrito en `design.md §4`.

- [x] **T4.** Crear `app/(app)/mis-asignaciones/_components/FiltroCantonDistrito.tsx`:
  dos `Select` (`components/ui/select.tsx`) con `aria-label` "Filtrar por cantón" /
  "Filtrar por distrito"; distrito `disabled` sin cantón (R3); opción centinela "Todos…"
  (R8); botón "Limpiar filtros" condicionado a `hayFiltro` (R9).
  - Hecho: `tsc` sin errores; componente aislado renderiza los dos combobox y el botón.

## Bloque 3 — Integración en el módulo (depende de T3, T4)

- [x] **T5.** Editar `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`:
  montar `<FiltroCantonDistrito>`, calcular `porRecogerVisible` y `porGestionarVisible`
  (con salvaguarda R10 para `ordenEnGestionId`), y alimentar cards, `PorAceptarSection`,
  `paradasMapa` y `detalleOrden` desde las listas visibles (R14). Añadir el mensaje
  "sin coincidencias" (R11).
  - Hecho: `tsc` sin errores; el módulo compila y las listas visibles reemplazan a las
    crudas en render/mapa/detalle.

## Bloque 4 — Tests de componente e2e-lite (depende de T5)

- [x] **T6.** Extender `tests/components/MisAsignacionesModule.test.tsx` con casos para
  R1, R3, R5, R6, R8, R9, R10, R11, R14 usando el helper `elegirEnSelect` ya presente
  (`tests/components/MisAsignacionesModule.test.tsx:141`).
  - Hecho: todos los nuevos tests pasan; cada `R<n>` de la tabla de trazabilidad de
    `requirements.md` queda cubierto por al menos un test.

## Bloque 5 — Cierre

- [x] **T7.** Correr `./init.sh` + suite completa de tests; actualizar la traza
  requisito→test en `progress/impl_117.md` (lo hace el implementer).
  - Hecho: `./init.sh` en verde; suite en verde; mapa R→test completo (sin huecos).

## Dependencias

```
T0 ─┬─ T1 ─┬─ T3 ─┐
    │      └─ T2  ├─ T5 ─ T6 ─ T7
    └─ T4 ────────┘
```
- T1 y T4 pueden avanzar en paralelo tras T0 (T4 no importa la lógica pura, solo el hook
  para el cableado real en T5). T2 en paralelo con T3/T4.

## Archivos esperados (para validar conflictos de paralelismo)

Archivos **nuevos** (sin conflicto con otras features):

- `lib/utils/filtro-canton-distrito.ts`
- `tests/unit/filtro-canton-distrito.test.ts`
- `app/(app)/mis-asignaciones/_components/useFiltroCantonDistrito.ts`
- `app/(app)/mis-asignaciones/_components/FiltroCantonDistrito.tsx`

Archivos **editados** (RIESGO DE CONFLICTO):

- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` — **CONFLICTO** con
  las features **113** (card + modo foco) y **114** (buscador), que también editan este
  archivo. Las tres son `zone: frontend` y `depends_on: 36/59`. Por la regla 1 de
  `CLAUDE.md` (máx. 2 `in_progress` por zona **y sin conflicto de archivos**), **117 no
  puede correr en paralelo con 113 ni con 114**: deben serializarse sobre este archivo.
- `tests/components/MisAsignacionesModule.test.tsx` — **CONFLICTO** con 113/114 (mismo
  archivo de tests del módulo). Serializar igual.

Archivos que **NO** se tocan (verificación de alcance, R1/R12): `page.tsx`,
`MisAsignacionesService.ts`, `IMisAsignacionesService.ts`, repos, cualquier otra lista de
órdenes (maestro/admin/tienda), Server Actions.
</content>
