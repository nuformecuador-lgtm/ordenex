# Feature 55 — Tasks

> Checklist discreto y verificable. `[P]` = paralelizable con las tasks del mismo bloque.
> Cada task cita los `R` que cubre y su criterio de "hecho". El plan asume la ruta
> RECOMENDADA (F1.4-B = reconstrucción completa; F1.4-A = reasignar con confirmación);
> las tasks marcadas **(cond.)** cambian según lo que apruebe el humano en F1.4.
>
> **Bloqueo previo:** este plan NO se implementa hasta que el humano cierre F1.4-A..D
> (ver `requirements.md`). El leader para en `spec_ready`.

## Bloque 0 — Reconciliación del drift schema/DB (R13, F1.4-C)
- [x] **T0. Limpiar `provincia.zonaId` del schema.** [P]
  - Editar `db/schema.prisma`: eliminar `Provincia.zonaId`, `Provincia.zona` y la relación
    inversa `Zona.provincias`; ajustar comentario del modelo `Zona`.
  - **Hecho:** `npx prisma validate` OK; `prisma generate` OK; diff schema↔migraciones sin
    drift para `provincia.zona_id`; `prisma migrate status` "up to date" (sin migración nueva).
- [x] **T1. Verificar no-uso + test de anti-regresión.** (depende de T0)
  - Grep `app/`, `lib/`, `tests/`, `scripts/` por `provincia.zonaId`, `.provincias`,
    accesos a la relación; corregir si hubiera; añadir/extender test (p. ej. en
    `tests/integration/db/zonas-migration.test.ts` o `provincia-schema-drift.test.ts`) que
    afirme que el schema no declara `provincia.zona_id` y que la DB tampoco.
  - **Hecho:** `pnpm typecheck` 0; test de drift verde.

## Bloque 1 — Backend: invariante de central + catálogo geo (R5, R6, R10)
- [x] **T2. Endurecer la invariante "una central" en el service.** (F1.4-A)  [P]
  - `ZonaService.crear/actualizar`: cuando `esCentral=true`, resolver la reasignación
    (recomendado) desmarcando la central previa en la MISMA transacción del repo, o
    rechazar (alternativa). Blindar el repo contra `P2002` sobre `es_central` → `conflict`.
  - **Hecho:** `zona-service.test.ts` cubre "marcar segunda central" según F1.4-A sin
    filtrar `P2002` como INTERNAL; `zona-repository.test.ts` verifica el reemplazo/traducción.
- [x] **T3. Exponer catálogo geográfico como Server Actions.** (Opción A)  [P]
  - Nuevo `lib/services/GeoService.ts` (+ `lib/interfaces/services/IGeoService.ts`) sobre
    `IGeoRepository`, con gate maestro; nuevas actions `lib/actions/geo.ts`:
    `listarProvincias`, `listarCantones(provinciaId)`, `listarDistritos(cantonId)` (zod +
    `withErrorHandler` + `resolveActorFromSession`, patrón `lib/actions/zonas.ts`).
  - **Hecho:** `tests/integration/actions/geo-action.test.ts` cubre R1/R10 (auth + items +
    distrito de otra zona con `zonaId/zonaNombre`); `GeoService` unit-testeado sin DB.

## Bloque 2 — Frontend: reconstruir `ZonaForm` (R3, R4, R7, R8, R9, R10, R11) — Opción A
> Depende de T2 y T3. Sustituye el stub actual de `ZonaForm.tsx`.
- [x] **T4. Campos escalares + toggles.** (depende de T2)
  - Reactivar `FormState` con `nombre`, `cobroVehiculo`, `esCentral`; `initialState` con
    prefill desde `ZonaDTO`; Switches para `cobroVehiculo` y `esCentral` (R3/R4/R7).
  - **Hecho:** `zona-form.test.tsx` :: prefill de `esCentral` en editar; submit envía los
    tres campos.
- [x] **T5. Selector de distritos navegando el catálogo.** (depende de T3, T4)
  - SWR sobre las nuevas actions; checkboxes; deshabilitar distritos de otra zona con su
    `zonaNombre`; pre-marcar en edición; enviar `distritoIds` completo (≥1).
  - **Hecho:** `zona-form.test.tsx` :: navegación provincia→cantón→distrito; distrito ajeno
    deshabilitado; conjunto enviado correcto (R10).
- [x] **T6. Editor de tarifas condicionado por `cobroVehiculo`.** (depende de T4)  [P]
  - Filas `{ cobroEntregado, cobroRechazado, vehiculoId? }`; vehículos desde
    `listarVehiculos`; respetar `applyTarifaRules` (≤1 sin vehículo / ≥1 con vehículo único).
  - **Hecho:** `zona-form.test.tsx` :: caso `cobroVehiculo=false` (1 tarifa sin vehículo) y
    `true` (tarifas con vehículo único); violaciones → `validation_error` por campo (R8).
- [x] **T7. `validate()`/`submit()` reales + errores por campo.** (depende de T4, T5, T6)
  - Construir payload, `schema.safeParse`, llamar `crearZona`/`actualizarZona(id, input)`;
    mapear `validation_error`/`conflict` a errores por campo conservando valores, sin cerrar
    el modal (R11). Retirar el stub de submit.
  - **Hecho:** `zona-form.test.tsx` :: `validation_error`/`conflict` → mensajes por campo,
    valores conservados; `ok` → devuelve resultado que dispara toast+mutate en el módulo.
- [x] **T8. Verificar cableado del módulo (R12).**  [P]
  - Confirmar `ZonasModule` (ya cableado): éxito → toast + `mutate` + cierre; error → toast.
  - **Hecho:** `zonas-module.test.tsx` :: crear/editar éxito refresca listado y muestra badge.

## Bloque 2-B — (cond.) Alternativa mínima si F1.4-B = mínimo (en vez de T3–T7)
- **T4'. Acción `marcarZonaCentral(id, esCentral)` + service.** (depende de T2)
  - `ZonaService.marcarCentral` (reasignación transaccional) + action con gate maestro.
  - **Hecho:** unit + integration de la acción; invariante de central respetada.
- **T5'. Control mínimo en el listado de zonas.**
  - Toggle/botón "Marcar como central" con confirmación en `ZonasModule`/`zonas-columns`.
  - **Hecho:** `zonas-module.test.tsx` :: marcar/desmarcar central refleja badge y refresca.
  - **Nota:** deja `ZonaForm` completo y catálogo geo como follow-up separado.

## Bloque 3 — Cierre y verificación (R1, R2, R14 + suite)
- [x] **T9. Trazabilidad R→test.** (depende de todo lo anterior)
  - Consolidar el mapa R1..R14 → test en `progress/impl_55-zonaform-escentral.md`.
  - **Hecho:** cada R tiene al menos un test citado y verde.
- [x] **T10. Verificación ejecutable final.** (depende de T9)
  - `npx prisma validate` OK · `pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm test` 100% ·
    `pnpm build` OK · `./init.sh` exit 0 · `prisma migrate status` "up to date".
  - Si se hubiera añadido alguna migración (NO previsto): round-trip `pnpm run db:rollback`
    + re-aplicar, verificando `down.sql`.
  - **Hecho:** `./init.sh` verde de punta a punta; sin regresiones en features 17/30/34/37
    (findCentralZonaId devuelve la zona marcada).

## Dependencias (resumen)
```
T0 ─▶ T1
T2 ─┬▶ T4 ─┬▶ T5 ─▶ T7 ─▶ T9 ─▶ T10
    │       ├▶ T6 ─┘
T3 ─┘       └▶ (T5 usa T3)
T8 [P con T4..T7]
(alternativa mínima): T2 ─▶ T4' ─▶ T5' ─▶ T9 ─▶ T10
```
