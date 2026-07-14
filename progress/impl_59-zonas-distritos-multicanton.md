# impl_59 — Zonas: seleccionar distritos de VARIOS cantones

> Bitácora de implementación (Fase 2). Feature 59, rama `feature/59-zonas-distritos-multicanton`.
> **FRONTEND PURO** (sin backend, migraciones ni cambios de contrato). F1.4 aprobada 2026-07-13
> (todas las recomendadas). Orquestada por el leader: `frontend_dev → reviewer`.

## Resultado
- **Reviewer APROBADO 0 bloqueantes de código** (`progress/review_59.md`). El único "rechazo" fue por
  gates documentales del leader (impl/tasks/history), ya cerrados.
- Verde REAL: `npx tsc --noEmit` 0, `eslint` 0, **`zona-form.test.tsx` 22/22**, suite completa
  **2551 passed** (2 flakes ambientales `HomePage`/`LoginForm` que pasan aislados; no son regresión).
- Sin tocar backend: `git` solo cambió `app/(app)/configuracion/_components/ZonaForm.tsx` y
  `tests/unit/components/zona-form.test.tsx` (+ spec y archivos de estado). Contrato
  `crearZona`/`actualizarZona` intacto; `arbolZonas()` usado SOLO como lectura.

## Qué se construyó
- **Estado `selected`** migrado de `Record<string,string>` a `Record<string, DistritoSeleccionado>`
  (`{distritoNombre, cantonId, cantonNombre, provinciaId, provinciaNombre}`) — **fuente de verdad única**.
  Cambiar de provincia/cantón NO resetea `selected`; solo reapunta las keys SWR.
- **Resumen agrupado** provincia→cantón (`data-testid="resumen-distritos"`, `role="group"` + aria-labels),
  derivado por `useMemo` de `selected`, con botón **"Quitar"** por distrito (`aria-label="Quitar <distrito>"`).
- **Sync bidireccional** resumen↔checkbox automática (mismo `selected`; el checkbox lee `id in selected`).
- **Contador** `data-testid="distritos-seleccionados"` conservado (no rompe el test existente).
- **R10** heredada: distritos de OTRA zona siguen `disabled`, nunca entran a `selected` ni al resumen.
- **Pre-marcado multi-cantón en edición** (R9) vía SWR `["zonas:arbol", zona.id]` sobre `arbolZonas()`
  (frontend puro): siembra `selected` con TODOS los cantones/distritos de la zona (`provinciaId: null`,
  merge idempotente); `seedSeleccionEdicion` enriquece la provincia al navegar cada cantón.
- **Envío** intacto: `distritoIds: Object.keys(selected)` (set completo N:M).

## Mapa de trazabilidad R → test (verificado por el reviewer abriendo cada caso)
Todos los tests en `tests/unit/components/zona-form.test.tsx`. Detalle fino en la tabla de
`specs/59-zonas-distritos-multicanton/requirements.md` y las citas `R` por tarea en `tasks.md`.

| Req | Cubre | Test (tarea) |
| --- | --- | --- |
| R1 | acumulación al cambiar de cantón sin pérdida | seleccionar A→B→A, A sigue marcado (T2) |
| R2 | agregar distritos de varios cantones/provincias | marca en cantón A y B → conjunto tiene ambos (T3) |
| R3 | resumen lista TODOS los seleccionados | resumen con selección en 2 cantones (T4) |
| R4 | resumen agrupado provincia→cantón | estructura agrupada del resumen (T4) |
| R5 | quitar por distrito desde el resumen | quitar baja el total en 1 (T5) |
| R6 | sync bidireccional resumen↔checkbox | quitar desmarca el checkbox del cantón abierto (T6) |
| R7 | contador `distritos-seleccionados` conservado | contador intacto tras el refactor (T0/T1) |
| R8 | R10 heredada (otra zona `disabled`, no agregable) | distrito de otra zona ausente del resumen (T7) |
| R9 | pre-marcado multi-cantón en edición | `mode="editar"` con ≥2 cantones lista todo desde el inicio (T9) |
| R10 | envío = set completo `distritoIds` | "arma el conjunto completo de distritoIds" (T1) |
| R11 | a11y/responsive del bloque | "Quitar <distrito>" localizable; wrap en `Modal` (T8) |
| R12 | verificación integral / no-regresión | `init.sh` verde + suite `ZonaForm` intacta (T11) |

## Deuda menor (reviewer, no bloqueante)
- Numeración "R" mezclada entre feature 55 y 59 en algún docstring/test (confunde trazabilidad; cosmético).
- Sin test del enriquecimiento perezoso de provincia al navegar en edición (opcional).
- Deuda preexistente escalar↔N:M de zonas sembradas (fuera de alcance, respetada).

## Pendiente
- PR a `dev` + merge (OK humano). Frontend puro → sin acción de despliegue/migración.
