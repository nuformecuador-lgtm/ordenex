# Feature 137 — Tasks

> Convención: `[P]` = paralelizable (sin conflicto de archivos con otra `[P]` del mismo bloque).
> Cada task cierra solo con su "criterio de hecho". Requisitos entre paréntesis mapean a
> `requirements.md`. Precondición global: 135 (renombrado) y 136 (recepción central) mergeadas.

## Bloque 0 — Migraciones y catálogo (fundacional, bloquea casi todo lo demás)

- [ ] **T0.1 — Catálogo TS + 3 valores (R1).** Añadir `por_devolver`,
  `en_ruta_devolucion_central`, `por_devolver_a_tienda` a `ORDER_STATUS_SEED`.
  - Archivos: `lib/types/order-status.ts`.
  - Hecho: los 3 valores están en la lista tipada; `OrderStatusValue` los incluye; typecheck verde.

- [ ] **T0.2 — Migración catálogo `order_status` UP+DOWN (R1/R2).** `INSERT ... WHERE NOT EXISTS`
  por value (idempotente) + `down.sql` `DELETE` guardado por no-referencia. Patrón
  `20260722140000_order_status_sin_gestionar/*`.
  - Archivos: `db/migrations/<ts>_order_status_devolucion_rechazadas/migration.sql` + `down.sql`.
  - Hecho: `db:migrate` siembra las 3 filas; `db:rollback` las quita si no hay referencias; re-run
    idempotente.

- [ ] **T0.3 — Migración enum `orden_historial_origen_tipo` UP+DOWN (R3).** `ADD VALUE IF NOT
  EXISTS 'devolucion_rechazada'` + `down.sql` que recrea el enum sin ese valor. Patrón
  `20260722150000_orden_historial_origen_sin_gestionar/*`. Coordinar la "lista previa" del down con
  135/136.
  - Archivos: `db/migrations/<ts>_orden_historial_origen_devolucion_rechazada/migration.sql` +
    `down.sql`; `db/schema.prisma` (valor del enum `OrdenHistorialOrigenTipo`).
  - Hecho: `db:migrate` agrega el valor; Prisma client lo tipa; `db:rollback` reversible.

- [ ] **T0.4 — Test de seed del catálogo (R1).**
  - Archivos: `tests/unit/scripts/seed-order-status.test.ts` (o el existente que cubre el seed).
  - Hecho: el test verifica que el seed contiene los 3 valores nuevos.

## Bloque 1 — Backend: disparo por aprobación del cierre (depende de Bloque 0)

- [ ] **T1.1 — Extender `ResolverCierreInput` (R5).** Campo opcional `devolucionRechazadas`.
  - Archivos: `lib/interfaces/repositories/ICierresAdminRepository.ts`.
  - Hecho: la interfaz compila con el nuevo campo opcional; no rompe llamadas existentes.

- [ ] **T1.2 — `CierresAdminService.aprobarCierre`: resolver config `devolucionRechazadas` (R5).**
  Resolver ids de `rechazada`/`por_devolver`/`por_devolver_a_tienda` (reusa `centralZonaId`),
  pasarla SOLO en la rama `aprobado`. `rechazarCierre` NO la pasa (R10).
  - Archivos: `lib/services/CierresAdminService.ts`.
  - Hecho: config `undefined` si el catálogo está incompleto (no-op defensivo); typecheck verde.

- [ ] **T1.3 — `CierresAdminRepository.resolverCierre`: bloque de devolución de rechazadas
  (R5/R6/R7/R8/R11).** Dentro de la tx `aprobado`, tras la liberación `sin_gestionar`: `findMany`
  rechazadas del mensajero → agrupar por `resolverDestinoCierre` → `updateMany` guardado por
  `estatus_id = rechazada` (sin tocar mensajero/prioridad) → `appendCambioEstado`
  (`devolucion_rechazada`, actor = admin).
  - Archivos: `lib/repositories/CierresAdminRepository.ts`.
  - Hecho: satélite→`por_devolver`, central→`por_devolver_a_tienda`; historial con
    `devolucion_rechazada`; sin recompute de snapshot; todo en la misma tx.

- [ ] **T1.4 — Tests unit del bloque de aprobación (R5/R6/R7/R8/R10/R11/R12).**
  - Archivos: `tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts`,
    `tests/unit/services/CierresAdminService.aprobar.devolucion.test.ts`.
  - Hecho: cubre ruteo por zona, idempotencia (2ª aprobación = 0 filas), money-neutralidad
    (mensajero/prioridad intactos), `rechazado` no dispara nada (R10), y que una rechazada de
    origen SLA (con mensajero intacto) es recogida (R12).

## Bloque 2 — Backend: transiciones manuales (depende de Bloque 0; T2.x entre sí en paralelo)

- [ ] **T2.1 [P] — Service `por_devolver → en_ruta_devolucion_central` (R13/R14/R20/R21).** Nuevo
  service + interfaz + Server Action, molde `DevolucionOrigenService`/`devolucion-origen.ts`. Autz
  adminSatelite de la zona de la orden; guarda de estado; `ajuste_estado`.
  - Archivos: `lib/services/EnvioDevolucionCentralService.ts`,
    `lib/interfaces/services/IEnvioDevolucionCentralService.ts`,
    `lib/actions/envio-devolucion-central.ts`.
  - Hecho: transición guardada; forbidden sin efecto para no-adminSatelite / zona ajena;
    idempotente en `en_ruta_devolucion_central`.

- [ ] **T2.2 [P] — Repurpose `DevolucionOrigenService` → `por_devolver_a_tienda →
  devolviendo_a_tienda` (R9/R17/R18/R20/R21).** Cambiar constante de origen `rechazada →
  por_devolver_a_tienda`; autz maestro/admin (central), reemplazando `esBodegaResponsable` por-zona
  por check central directo; actualizar doc-comments.
  - Archivos: `lib/services/DevolucionOrigenService.ts`,
    `lib/interfaces/services/IDevolucionOrigenService.ts` (doc/semántica).
  - Hecho: origen `por_devolver_a_tienda`; solo maestro/admin autoriza; ya no existe salida directa
    desde `rechazada`.

- [ ] **T2.3 — Reuso recepción central 136 (R15/R16).** Registrar/gobernar el par
  `en_ruta_devolucion_central → por_devolver_a_tienda` en el mecanismo de recepción central de la
  136. Depende del contrato final de la 136 (pregunta abierta #3).
  - Archivos: los del service/repo de recepción central de la 136 (a confirmar).
  - Hecho: escanear en central una orden `en_ruta_devolucion_central` la deja en
    `por_devolver_a_tienda`; autz maestro/admin; guarda de estado; idempotente.

- [ ] **T2.4 — Verificar tramo final tienda `devolviendo_a_tienda → en_tienda` (R19).** Sin lógica
  nueva: confirmar que `RecepcionOrigenService` opera con los nombres renombrados por 135.
  - Archivos: `lib/services/RecepcionOrigenService.ts` (solo verificación/constantes vía 135).
  - Hecho: test existente de recepción tienda pasa con `devolviendo_a_tienda`/`en_tienda`.

- [ ] **T2.5 — Tests unit de las transiciones manuales (R13–R21).**
  - Archivos: `tests/unit/services/EnvioDevolucionCentralService.test.ts`,
    `tests/unit/services/DevolucionOrigenService.test.ts` (actualizar al nuevo origen),
    tests de la recepción central 136 (extender con el par nuevo).
  - Hecho: cada guarda de estado, autz y camino de idempotencia/conflict tiene su test.

## Bloque 3 — Frontend (depende de Bloque 0 para labels; de Bloque 2 para acciones)

- [ ] **T3.1 [P] — Labels + variantes de los 3 estados (R4).**
  - Archivos: `app/(app)/ordenes/_components/EstatusBadge.tsx`.
  - Hecho: los 3 estados renderizan etiqueta legible + variante; sin `any`; sin sigla "SLA".

- [ ] **T3.2 — `OrdenesTabs`: retirar acción en `rechazada`, añadir en `por_devolver_a_tienda`
  (R9/R17).** Quitar "Devolver a la tienda" de la tab `rechazada`; añadir "Enviar a la tienda" en
  la tab `por_devolver_a_tienda` reusando el modal (textos actualizados).
  - Archivos: `app/(app)/ordenes/_components/OrdenesTabs.tsx`,
    `app/(app)/ordenes/_components/DevolverATiendaModal.tsx` (labels/target).
  - Hecho: la tab `rechazada` no ofrece devolución manual; `por_devolver_a_tienda` ofrece "Enviar a
    la tienda" y dispara la Server Action repurposada.

- [ ] **T3.3 — Superficie adminSatelite "Enviar a central" (R13, pregunta abierta #2).** Listado de
  `por_devolver` de su zona + acción "Enviar a central" en `/recepcion-satelite`.
  - Archivos: `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` (+ componente
    modal/acción si aplica).
  - Hecho: el adminSatelite ve sus `por_devolver` y las envía a central; feedback por toast.

- [ ] **T3.4 — Recepción central UI 136 (R15).** El escáner/página central de la 136 acepta órdenes
  `en_ruta_devolucion_central` y muestra el resultado `por_devolver_a_tienda`.
  - Archivos: los de la UI de recepción central de la 136 (a confirmar).
  - Hecho: flujo QR central deja la orden en `por_devolver_a_tienda` con feedback.

## Bloque 4 — Cierre

- [ ] **T4.1 — Test de integración del recorrido completo (R5, R13–R19).** Cierre con rechazadas
  central+satélite aprobado → estados iniciales correctos → recorrido por-orden hasta `en_tienda`.
  - Archivos: `tests/integration/devolucion-rechazadas.flow.test.ts`.
  - Hecho: ambas ramas (central/satélite) llegan a `en_tienda`; historial completo y coherente.

- [ ] **T4.2 — Mapa de trazabilidad R→test + verificación ejecutable.**
  - Archivos: `progress/impl_137-devolucion-rechazadas-estados.md`.
  - Hecho: cada `R1..R22` mapeado a un test concreto; `./init.sh` y la suite en verde.

## Archivos esperados (resumen)

**Backend**
- `lib/types/order-status.ts` (M)
- `db/migrations/<ts>_order_status_devolucion_rechazadas/{migration.sql,down.sql}` (N)
- `db/migrations/<ts>_orden_historial_origen_devolucion_rechazada/{migration.sql,down.sql}` (N)
- `db/schema.prisma` (M: enum origen_tipo)
- `lib/interfaces/repositories/ICierresAdminRepository.ts` (M)
- `lib/services/CierresAdminService.ts` (M)
- `lib/repositories/CierresAdminRepository.ts` (M)
- `lib/services/EnvioDevolucionCentralService.ts` (N)
- `lib/interfaces/services/IEnvioDevolucionCentralService.ts` (N)
- `lib/actions/envio-devolucion-central.ts` (N)
- `lib/services/DevolucionOrigenService.ts` (M: origen `por_devolver_a_tienda` + autz central)
- `lib/interfaces/services/IDevolucionOrigenService.ts` (M: doc/semántica)
- `lib/services/RecepcionOrigenService.ts` (verificación vía 135)
- Recepción central 136 (M: registrar par `en_ruta_devolucion_central → por_devolver_a_tienda`)

**Frontend**
- `app/(app)/ordenes/_components/EstatusBadge.tsx` (M)
- `app/(app)/ordenes/_components/OrdenesTabs.tsx` (M)
- `app/(app)/ordenes/_components/DevolverATiendaModal.tsx` (M: labels/target)
- `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` (M)
- UI recepción central 136 (M)

**Tests**
- `tests/unit/scripts/seed-order-status.test.ts` (M)
- `tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts` (N)
- `tests/unit/services/CierresAdminService.aprobar.devolucion.test.ts` (N)
- `tests/unit/services/EnvioDevolucionCentralService.test.ts` (N)
- `tests/unit/services/DevolucionOrigenService.test.ts` (M)
- `tests/integration/devolucion-rechazadas.flow.test.ts` (N)
- `progress/impl_137-devolucion-rechazadas-estados.md` (N)

(N = nuevo, M = modificado)

## Dependencias entre bloques

```
Bloque 0 ──► Bloque 1 ──► T4.1
   │            │
   └──► Bloque 2 ──► Bloque 3 (T3.2/T3.3/T3.4) ──► T4.1 ──► T4.2
   └──► T3.1 (labels, solo necesita Bloque 0)
```
