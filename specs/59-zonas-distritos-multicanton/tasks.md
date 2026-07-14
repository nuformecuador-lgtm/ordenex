# Feature 59 — Tasks

> Checklist discreto y verificable. `[P]` = paralelizable con tasks del mismo bloque.
> Cada task cita los `R` que cubre, su test y su criterio de "hecho". **Todo frontend.**
> El plan asume la ruta RECOMENDADA de F1.4; las tasks **(cond.)** cambian según lo que
> apruebe el humano.
>
> **Bloqueo previo:** no se implementa hasta que el humano cierre F1.4-a..f (ver
> `requirements.md`). El leader para en `spec_ready`. NO tocar backend/migraciones.
>
> **✅ ESTADO 2026-07-13: COMPLETA y verificada.** F1.4 aprobada (ruta recomendada). frontend_dev
> en verde; reviewer **APROBADO 0 bloqueantes de código** (`progress/review_59.md`). `tsc` 0, `eslint` 0,
> `zona-form.test.tsx` **22/22**, suite **2551 passed** (2 flakes ambientales aislados verdes).
> Trazabilidad R1–R12 → test. **T9-alt = N/A** (F1.4-e aprobó la recomendación `arbolZonas`).

## Bloque 0 — Refactor del estado de selección (R6, R7, R10, R12)
- [x] **T0. Migrar `selected` a `Record<string, DistritoSeleccionado>`.**
  - En `ZonaForm.tsx`: nuevo tipo interno `DistritoSeleccionado` ({distritoNombre, cantonId,
    cantonNombre, provinciaId, provinciaNombre}); `toggleDistrito(distrito)` captura contexto
    provincia/cantón desde `provinciaId/provinciaOptions` y `cantonId/cantonOptions`; `removeDistrito(id)`;
    `buildCandidate` sigue enviando `distritoIds: Object.keys(selected)`.
  - **Hecho:** `pnpm typecheck` 0; el test existente sigue verde (checkbox por nombre, contador,
    `input.distritoIds` sin cambios de forma); contador `data-testid="distritos-seleccionados"` intacto.
- [x] **T1. Verificar no-regresión del envío (R10, R12).** (depende de T0) [P]
  - **Hecho:** `zona-form.test.tsx` :: caso existente "arma el conjunto completo de distritoIds"
    pasa; enviar sigue produciendo `distritoIds` = keys de `selected`.

## Bloque 1 — Selección cruzada multi-cantón (R1, R2)
> Depende de T0.
- [x] **T2. Confirmar/asegurar acumulación al cambiar de cantón (R1).**
  - Verificar que `setCantonId`/`setProvinciaId` NO reseteen `selected` (hoy no lo hacen); añadir
    test de regresión de acumulación.
  - **Hecho:** `zona-form.test.tsx` :: seleccionar en cantón A, cambiar a B, volver a A → A sigue
    marcado y el total no baja.
- [x] **T3. Agregar distritos de varios cantones (R2).** (depende de T0) [P]
  - **Hecho:** `zona-form.test.tsx` :: marcar distrito de cantón A y de cantón B (mockear un 2º
    cantón/distritos) → conjunto contiene ambos; caso análogo con provincias distintas.

## Bloque 2 — Resumen agrupado + quitar + sync (R3, R4, R5, R6, R8, R11)
> Depende de T0. Núcleo visible de la feature.
- [x] **T4. Render del resumen agrupado provincia→cantón (R3, R4).**
  - `useMemo` que deriva la agrupación de `selected`; contenedor `data-testid="resumen-distritos"`,
    `role="group"` + `aria-label`; encabezados de provincia/cantón; fila por distrito. Grupo por
    cantón cuando la provincia sea `null` (F1.4-e).
  - **Hecho:** `zona-form.test.tsx` :: con selección en 2 cantones, el resumen los lista agrupados
    aunque solo uno esté abierto.
- [x] **T5. Botón "quitar" por distrito (R5).** (depende de T4)
  - Botón `aria-label="Quitar <distrito>"` → `removeDistrito(id)`; actualiza resumen y contador.
  - **Hecho:** `zona-form.test.tsx` :: quitar desde el resumen elimina el distrito y baja el total en 1.
- [x] **T6. Sincronización bidireccional resumen↔checkbox (R6).** (depende de T4, T5)
  - Un único `selected`: checkbox `checked = id in selected`; quitar/marcar mutan el mismo estado.
  - **Hecho:** `zona-form.test.tsx` :: quitar desde el resumen un distrito del cantón abierto desmarca
    su checkbox; desmarcar el checkbox lo saca del resumen.
- [x] **T7. R10 heredada en el resumen (R8).** (depende de T4) [P]
  - Confirmar que los distritos de OTRA zona siguen `disabled` y nunca entran a `selected`/al resumen.
  - **Hecho:** `zona-form.test.tsx` :: distrito con `zonaId` de otra zona no agregable y ausente del
    resumen (extiende el caso existente "deshabilita un distrito asignado a otra zona").
- [x] **T8. Accesibilidad/responsive del bloque (R11).** (depende de T4) [P]
  - Encabezados semánticos + `aria-label`; contenedor con `flex-wrap`/`overflow` dentro de `max-w-lg`.
  - **Hecho:** `zona-form.test.tsx` :: botones "quitar" localizables por nombre accesible por distrito;
    revisión estática del contenedor (clases de wrap/overflow); sin `console`/warnings de a11y.

## Bloque 3 — Pre-carga multi-cantón en edición (R9) — (cond. F1.4-e recomendado)
> Depende de T0, T4.
- [x] **T9. Pre-cargar `selected` desde `arbolZonas()` al editar.**
  - SWR de lectura `["zonas:arbol", zona.id]` sobre `arbolZonas`; localizar nodo de la zona; sembrar
    `selected` (provincia `null`) para todos sus cantones/distritos; merge idempotente. Mantener
    `seedSeleccionEdicion` para enriquecer provincia al navegar.
  - **Añadir `arbolZonas` al mock** de `@/lib/actions/zonas` en `zona-form.test.tsx` (ajuste de test,
    no de contrato).
  - **Hecho:** `zona-form.test.tsx` :: `mode="editar"` con distritos en ≥2 cantones → el resumen los
    lista TODOS desde el inicio (antes de navegar cada cantón).
- [—] **T9-alt. (cond.) — N/A.** Fallback perezoso solo aplicaba si el humano rechazaba la recomendación
  F1.4-e; el humano APROBÓ la recomendación (`arbolZonas`), así que R9 se cumple "desde el inicio" y este
  fallback NO aplica.

## Bloque 4 — Cierre y verificación (R12 + suite)
- [x] **T10. Trazabilidad R→test.** (depende de todo lo anterior)
  - Consolidar el mapa R1..R12 → test en `progress/impl_59-zonas-distritos-multicanton.md`.
  - **Hecho:** cada R tiene ≥1 test citado y verde.
- [x] **T11. Verificación ejecutable final.** (depende de T10)
  - `pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm test` (incluida `zona-form.test.tsx` sin regresiones) ·
    `pnpm build` OK · `./init.sh` exit 0.
  - **Hecho:** `./init.sh` verde; suite existente del `ZonaForm` intacta; sin cambios en backend,
    migraciones ni contrato de `crearZona`/`actualizarZona`.

## Dependencias (resumen)
```
T0 ─┬▶ T1 [P]
    ├▶ T2 ──▶ (regresión)
    ├▶ T3 [P]
    └▶ T4 ─┬▶ T5 ─▶ T6
           ├▶ T7 [P]
           ├▶ T8 [P]
           └▶ T9 (cond. F1.4-e)
T1..T9 ─▶ T10 ─▶ T11
```
