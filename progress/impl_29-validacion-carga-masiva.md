# impl_29-validacion-carga-masiva — registro de implementación (FRONTEND puro)

> Feature 29 — "enriquecer validación previa a la carga masiva". Zona: frontend.
> depends_on: 16 (done). Opción A (enriquecer el reporte POST-COMMIT del
> `BulkSummary`) aprobada en la puerta F1.4. Sin backend/DB/actions/api.

## Estado

Implementación **completa y verificada**. Suite en verde salvo dos tests de la
suite de AUTENTICACIÓN (`HomePage.test.tsx` R25, `LoginForm.test.tsx` R27) que
son **flaky bajo ejecución en paralelo** y **ajenos a feature 29** (feature 29 no
toca `app/page.tsx`, `LoginForm`, ni sus tests — ver "Verificación").

## Archivos tocados

### Componentes/helpers (frontend, `app/(app)/ordenes/_components/`)
- `carga-masiva-clasificacion.ts` — **nuevo**. `clasificarBulkSummary(data: unknown): ClasificacionCarga`
  con guards defensivos (`asRecord`/`typeof`/`Array.isArray`, sin `any`); tipos
  `OrdenExistente` / `OrdenConError` / `ClasificacionCarga`. Tres grupos disjuntos
  (`creada` / `duplicada` / `error`); `data`/`filas` inesperados → tres vacíos.
- `estatus-label.ts` — **nuevo**. `estatusLabel(value)` sobre
  `Record<(typeof ORDER_STATUS_SEED)[number], string>` (cubre los 8 value del seed:
  entregada, devuelta, devuelta_origen, reprogramada, en_fulfillment,
  en_ruta_bodega_principal, en_bodega, en_preparacion). Fallback: desconocido →
  value crudo; null/undefined/"" → "—".
- `OrdenesExistentesTabla.tsx` — **nuevo**. `DataTable<OrdenExistente>` de solo
  lectura (numRemision + estado legible vía `estatusLabel`); sin Select/botones.
- `OrdenesConErrorTabla.tsx` — **nuevo**. `DataTable<OrdenConError>` de solo lectura
  (fila/numRemision/motivo) + `formatErrores` (aplana `Record<string,string[]>`;
  vacío → "Error de validación").
- `OrdenesCargaResumenPaso.tsx` — **nuevo**. Contenedor del paso "resumen": `Alert`
  informativo (N nuevas cargadas / M ya existían y no se recargan) + `OrdenesCargaResumen`
  (solo si hay nuevas) + tabla existentes (solo si hay) + tabla errores (solo si hay).
- `OrdenesCargaMasivaButton.tsx` — **modificado**. `handleSuccess` llama
  `clasificarBulkSummary(result.data)`, guarda la clasificación en estado, avanza a
  "resumen" si `nuevas||existentes||errores` (los tres vacíos → sigue en "upload",
  solo toast). Conserva toast de conteos y `mutate(["ordenes:list",…])`. Renderiza
  `OrdenesCargaResumenPaso`. Reset de clasificación al cerrar el modal.

### Tests (`tests/components/`)
- `CargaMasivaClasificacion.test.ts` (nuevo, sin jsdom)
- `EstatusLabel.test.ts` (nuevo, sin jsdom)
- `OrdenesExistentesTabla.test.tsx` (nuevo, jsdom)
- `OrdenesConErrorTabla.test.tsx` (nuevo, jsdom)
- `OrdenesCargaResumenPaso.test.tsx` (nuevo, jsdom, mock de `lib/actions/mensajeros`)
- `OrdenesCargaMasivaButton.test.tsx` (ampliado, jsdom) — sin regresión en los tests previos

### Docs
- `specs/29-validacion-carga-masiva/tasks.md` — marcadas T5.1/T5.2.
- `specs/29-validacion-carga-masiva/design.md` — reword de la nota D5 (parentético)
  para no citar el literal del status renombrado por la feature 28, que activaba el
  guard `tests/unit/guards/no-embalaje.test.ts` (feature 28). Sin cambio de decisión
  ni de requisito.

## Mapa de trazabilidad R1–R19 → test

| R | Test / verificación |
| --- | --- |
| R1 | `CargaMasivaClasificacion.test.ts` — "separa creada/duplicada/error en tres grupos disjuntos (R1)" |
| R2 | `CargaMasivaClasificacion.test.ts` — "separa el resumen incluso con data desconocida (R2)", "ignora filas sin forma esperada sin lanzar (R2)" |
| R3 | `CargaMasivaClasificacion.test.ts` — "duplicada sin estatus → estatus: null (R3)", "error sin errores → errores: {} conservando fila/numRemision (R3)" |
| R4 | `OrdenesCargaResumenPaso.test.tsx` — "deja claro que solo se cargan las nuevas y muestra las tres secciones" |
| R5 | `OrdenesExistentesTabla.test.tsx` — "muestra el estado como etiqueta legible" |
| R6 | `OrdenesExistentesTabla.test.tsx` — "no ofrece ninguna accion de recarga sobre las existentes" |
| R7 | `OrdenesCargaResumenPaso.test.tsx` — "deja claro que solo se cargan las nuevas…" (Alert existentes) |
| R8 | `OrdenesCargaResumenPaso.test.tsx` — "deja claro que solo se cargan las nuevas…" (Alert "N nuevas cargadas") |
| R9 | `OrdenesCargaResumenPaso.test.tsx` — "conserva el select de mensajero por fila para las nuevas (R9)" + `OrdenesCargaResumen.test.tsx` (sin regresión) |
| R10 | `OrdenesCargaResumenPaso.test.tsx` — nuevas alimentadas por `numRemisionesNuevas` (creadas); `OrdenesCargaMasivaButton.test.tsx` "R11a…" (clasificación esperada) |
| R11 | `OrdenesCargaMasivaButton.test.tsx` — "R11a: creadas>0 y duplicadas>0 → avanza a resumen…" y `OrdenesCargaResumenPaso.test.tsx` "con creadas===0 muestra solo existentes… (R11)" |
| R12 | `OrdenesCargaMasivaButton.test.tsx` — "R12: creadas===0, duplicadas===0, conError===0 → no muestra secciones vacias" |
| R13 | `OrdenesCargaMasivaButton.test.tsx` — "R13: revalida la lista tras la carga (toast + mutate ordenes:list)", "R14…" toast conteos |
| R14 | Verificación de diff (T5.1): sin cambios en `lib/actions/`, `lib/services/`, `lib/repositories/`, `app/api/`, `db/` — check ejecutado, resultado "NONE" |
| R15 | `tsc --noEmit` verde (init.sh) + grep `any` = 0 en los archivos nuevos |
| R16 | Revisión T5.1: `DataTable`/`Modal`/`Select`/`Alert`/`useToast`/`BulkUpload` sin modificar (no aparecen en el diff) |
| R17 | `EstatusLabel.test.ts` — "traduce todos los estados del seed", "cae al value crudo si el estado es desconocido", "null/undefined/vacío → '—'" (+ `OrdenesExistentesTabla.test.tsx` en integración) |
| R18 | `OrdenesConErrorTabla.test.tsx` — "lista cada fila con error con su motivo"; `OrdenesCargaMasivaButton.test.tsx` "R12b: conError>0 → avanza al resumen con los errores" |
| R19 | `OrdenesConErrorTabla.test.tsx` — "muestra motivo generico si no hay detalle de errores", "une campo: mensajes…", "mapa vacío → motivo genérico" |

## Verificación (salida real)

### Alcance frontend puro (R14/R15/R16)
- R14 forbidden-zone check (`lib/actions|lib/services|lib/repositories|app/api|db`) → **NONE - R14 respetado**.
- Diff acotado a `app/(app)/ordenes/_components/` + `tests/components/` + `specs/29…` (docs).
- grep de `any` en los 5 archivos nuevos → **NONE**.
- `tsc --noEmit` (dentro de init.sh) → verde.

### Suite completa (`npx vitest run`)
- Tests propios de feature 29 (8 archivos, 60 tests): **todos verdes**.
- Suite total: **720 passed / 1 failed (721)** en la corrida representativa. El
  único fallo alterna entre `tests/components/HomePage.test.tsx` (R25, botón cerrar
  sesión) y `tests/components/LoginForm.test.tsx` (R27, mensajes de error): son
  **flaky bajo ejecución en paralelo** (pasan en aislamiento: `HomePage.test.tsx`
  → 3/3 passed) y **no pertenecen a feature 29** (el diff vs base `d259e6a` no toca
  `app/page.tsx`, `LoginForm` ni esos tests → no puede haberlos causado).
- El guard `tests/unit/guards/no-embalaje.test.ts` (feature 28), que inicialmente
  fallaba por una mención literal en `design.md`, quedó **verde** tras el reword.

### `./init.sh`
- **INIT_EXIT=0**, salida `== init OK ==`. typecheck y lint OK (solo warnings de
  `.claude/skills/` ajenos). El paso de vitest interno reflejó el mismo fallo flaky
  de auth, pero init reportó OK y exit 0.

## Notas
- Regla del arnés: no se hizo commit ni PR (lo coordina el leader).
- La flakiness de la suite de auth (HomePage/LoginForm) es previa e independiente
  de feature 29; se deja registrada explícitamente para no ocultarla.
</content>
</invoke>
