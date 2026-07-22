# Feature 101 — Tasks

Checklist verificable. `[P]` = paralelizable con las tareas del mismo bloque sin
dependencia entre sí. Cada task lleva su criterio de "hecho". Trazabilidad R→test
en `requirements.md`.

## Bloque 1 — Migración (base de todo)

- [x] **T1. Migración aditiva `orden.prioridad`.**
  - `db/schema.prisma`: añadir `prioridad Boolean @default(false) @map("prioridad")` al modelo `Orden`.
  - Crear `db/migrations/20260722120000_orden_prioridad/migration.sql` (UP: `ADD COLUMN ... NOT NULL DEFAULT false`) con comentario de "aditiva, RLS de orden sin cambios".
  - Escribir `down.sql` (`DROP COLUMN IF EXISTS "prioridad"`).
  - **Hecho:** `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte limpio; `prisma generate` OK; el tipo `Orden` de Prisma expone `prioridad`. (R1, R11, R12)

## Bloque 2 — Backend de dominio (dependen de T1; T2/T3 son `[P]` entre sí)

- [x] **T2. `[P]` Encender prioridad en la liberación SLA (feature 99).**
  - `DevolucionSlaRepository.liberarDevueltaSla`: añadir `prioridad: true` al `data` del `updateMany` guardado.
  - Ajustar `tests/unit/repositories/devolucion-sla-repository.test.ts` (la aserción `upd.data` de la liberación) para incluir `prioridad: true`.
  - **Hecho:** test de liberación verde con `prioridad: true` en `data`; tests de `escalarDevueltaSla` intactos. (R2, R4)

- [x] **T3. `[P]` Apagar prioridad al reasignar desde bodega.**
  - `OrdenRepository.asignarBodegaLote`: añadir `prioridad: false` al `data` del `updateMany`.
  - `OrdenRepository.asignarSateliteLote`: añadir `"prioridad" = false` al `SET` del `UPDATE ... RETURNING`.
  - **Hecho:** tests unit de ambos writers afirman `prioridad: false` en la escritura. (R5)

- [x] **T4. `[P]` Aserción negativa de no-encendido (R3).**
  - Test que verifica que `escalarDevueltaSla` NO escribe `prioridad` y que el repo de recuperación manual (100, `RecuperacionBodegaRepository`) NO escribe `prioridad`.
  - **Hecho:** ambos tests verdes; ninguna ruta salvo la liberación toca `prioridad = true`. (R3)

## Bloque 3 — Exposición del DTO (dependen de T1)

- [x] **T5. Exponer `prioridad` en el listado de órdenes.**
  - `lib/types/orden.ts`: `OrdenDTO.prioridad?: boolean`.
  - `OrdenRepository.toDTO`: `prioridad: row.prioridad`.
  - **Hecho:** unit de `toListItemDTO` propaga `prioridad`. (R9)

- [x] **T6. Exponer `prioridad` en el listado satélite.**
  - `IRecepcionSateliteService.RecepcionSateliteDTO`: `prioridad: boolean`.
  - `IOrdenRepository.RecepcionSateliteRow`: `prioridad: boolean`.
  - `OrdenRepository.WITH_RECEPCION_SATELITE.select`: `prioridad: true`; `toRecepcionSateliteRow`: propagar.
  - Actualizar fixtures de test de `RecepcionSateliteDTO`.
  - **Hecho:** unit de `toRecepcionSateliteRow` propaga `prioridad`; suite satélite verde. (R9)

## Bloque 4 — Orden prioridad-first (dependen de sus bloques de DTO)

- [x] **T7. Sort central.** (depende de T5)
  - `OrdenRepository.list`: `orderBy = [{ prioridad: "desc" }, { [SORT_COLUMN[sortBy]]: sortDir }]`.
  - **Hecho:** unit afirma que el `orderBy` encabeza con `{ prioridad: "desc" }` sin perder el criterio de recencia. (R6)

- [x] **T8. Sort satélite.** (depende de T6)
  - `OrdenRepository.findRecepcionSateliteByZona`: `orderBy: [{ prioridad: "desc" }, { createdAt: "desc" }]`.
  - **Hecho:** unit afirma el `orderBy` del `findMany`; el grupo "Recibidas" queda prioridad-first. (R7)

## Bloque 5 — Resalte de fila (frontend)

- [x] **T9. `[P]` Prop `rowClassName` en `DataTable`.**
  - `components/shared/DataTable.tsx`: prop opcional `rowClassName?: (row: T) => string | undefined`, aplicada al `<tr>` de datos vía `cn("border-b", rowClassName?.(row))`.
  - **Hecho:** sin la prop, snapshot/estructura idéntica (retrocompatible); con la prop, el `<tr>` recibe la clase. (habilita R8)

- [x] **T10. Resalte en `/ordenes`.** (depende de T9, T5)
  - `OrdenesModule`: pasar `rowClassName={(row) => row.prioridad ? "<clase-resalte>" : undefined}` al `DataTable`; añadir el nombre accesible/badge "Prioritaria".
  - **Hecho:** component test: fila con `prioridad=true` en `en_bodega` lleva la clase de resalte + texto accesible; fila normal, no. (R8)

- [x] **T11. Resalte en `/recepcion-satelite`.** (depende de T9, T6)
  - `RecepcionSateliteModule`: pasar el mismo `rowClassName` al `DataTable` de "Recibidas".
  - **Hecho:** component test: fila `en_bodega_satelite` con `prioridad=true` resaltada; las demás no. (R8)

## Bloque 6 — No-regresión y cierre

- [x] **T12. `[P]` Verificar no-fuga (R10).**
  - Confirmar que `/novedades`, el apartado "Devueltas" (recuperación manual) y el portal del mensajero no reciben `rowClassName` de prioridad ni cambian de orden.
  - **Hecho:** test/observación de que esas superficies quedan sin resalte ni reordenamiento por prioridad. (R10)

- [x] **T13. Trazabilidad y verificación final.**
  - Completar la tabla R→test en `requirements.md` con las rutas reales.
  - **Hecho:** `./init.sh` en verde + suite de tests completa en verde; cada `R1..R12` mapeado a ≥1 test.

## Grafo de dependencias

```
T1 ─┬─ T2 [P]
    ├─ T3 [P]
    ├─ T4 [P]
    ├─ T5 ── T7 ── T10 ─┐
    └─ T6 ── T8 ── T11 ─┤
T9 [P] ─────────────────┤
                        └─ T12 [P], T13
```
