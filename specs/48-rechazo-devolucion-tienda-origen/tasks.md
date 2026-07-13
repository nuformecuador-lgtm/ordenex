# Feature 48 — Rechazo: devolución a la tienda de origen — tasks.md

> Checklist accionable. Cada task indica el/los `R<n>` que cubre y el test que lo verifica.
> `[P]` = paralelizable (sin dependencia con tareas del mismo bloque). Asume la opción
> RECOMENDADA de cada F1.4 (acción manual de la bodega responsable, reuso de `orden.tienda_id`,
> `origen_tipo = ajuste_estado`, sin migración). Si la aprobación cambia alguna, ajustar las
> tasks señaladas.

## 0. Puerta de aprobación (bloqueante)

- [ ] **T0** — Confirmar en la puerta de aprobación las decisiones F1.4 (a) manual vs
  automático, (e) `ajuste_estado` vs `origen_tipo` dedicado, (f) sin migración vs columna de
  auditoría. **Hecho:** el humano respondió "aprobado" (o eligió variantes) en
  `progress/current.md`. NADA de código antes de esto.

## 1. Backend — servicio de retorno (regla + autz)

- [x] **T1** — Crear la interfaz `lib/interfaces/services/IDevolucionOrigenService.ts` con
  `devolverATienda(ordenId, actor): Promise<Result>` y su tipo `Result`
  (`ok` | `forbidden` | `not_found` | `conflict` | `config_error`).
  **Cubre:** R4. **Hecho:** typecheck compila; la interfaz vive en `lib/interfaces/services/`.
- [x] **T2** — Implementar `lib/services/DevolucionOrigenService.ts`: carga la orden
  (`findById`), aplica la GUARDIA de estado (sólo desde `rechazada`; `devuelta_origen` →
  idempotente `ok`; otro → `conflict`) y resuelve el destino
  `findEstatusIdByValue("devuelta_origen")`.
  **Cubre:** R1, R2, R4, R5, R6. **Depende de:** T1.
  **Test (T2.1):** `tests/unit/services/devolucion-origen-service.test.ts` — "transiciona una
  orden rechazada a devuelta_origen"; "orden por rechazo directo Y por escalado son ambas
  retornables"; "estado != rechazada devuelve conflict"; "devuelta_origen es idempotente";
  "no requiere dato extra en la orden".
- [x] **T3** — Añadir a `DevolucionOrigenService` la AUTZ por bodega responsable: derivar
  `resolverDestinoCierre(orden.zonaId, findCentralZonaId())`; `bodega_central` → maestro/admin;
  `bodega_satelite` → adminSatelite de esa zona; resto → `forbidden`.
  **Cubre:** R10, R11. **Depende de:** T2. Reusa `lib/utils/bodega-responsable.ts` +
  `IZonaRepository.findCentralZonaId` + `IOrdenRepository.findUsuarioZonaId` (existentes).
  **Test (T3.1):** mismo archivo — "zona central: permite maestro/admin, niega
  adminSatelite/adminTienda/mensajero"; "zona satélite: permite el adminSatelite de esa zona,
  niega el de otra zona"; "centralZonaId null cae a satélite (fallback)".

## 2. Backend — escritura atómica por el choke point (reuso #11)

- [x] **T4** — Cablear `DevolucionOrigenService` para persistir la transición vía
  `OrdenRepository.update(ordenId, { estatusId }, { actorUsuarioId: actor.usuarioId,
  origenTipo: "ajuste_estado" })` (#11), que ya hace `UPDATE` + `appendCambioEstado` en la
  MISMA `$transaction`. NO crear un call-site nuevo.
  **Cubre:** R7, R8. **Depende de:** T2, T3.
  **Test (T4.1):** `tests/unit/repositories/orden-repository.test.ts` (o de integración) —
  "la transición rechazada→devuelta_origen deja UNA fila de historial con actor=admin y
  origen_tipo=ajuste_estado por el choke point"; "si el append falla, revierte el cambio de
  estado (atómico)".
- [ ] **T5** — (Endurecimiento opcional, sólo si el reviewer lo pide) guardia de estado de
  origen en el `UPDATE` (`WHERE estatus_id = <rechazada> RETURNING`) para que el append cubra
  sólo la fila si sigue en `rechazada`. **Cubre:** R5 (concurrencia). **Depende de:** T4.

## 3. Backend — controlador (Server Action)

- [x] **T6** — Crear `lib/actions/devolucion-origen.ts` (`'use server'`): valida `{ ordenId }`
  con zod, resuelve `Actor` de la sesión (`resolveActorFromSession`), instancia el service,
  ejecuta y devuelve el `Result`. Mutación interna → Server Action (no route handler).
  **Cubre:** R4, R11. **Depende de:** T2, T3, T4.
  **Test (T6.1):** `tests/unit/actions/devolucion-origen.test.ts` (o integración) — "actor sin
  permiso → forbidden sin efectos"; "ordenId inválido → validation".

## 4. Test de cobertura de la feature 49 (choke point)

- [x] **T7** — Actualizar `tests/unit/repositories/orden-historial-cobertura.test.ts`: DOCUMENTAR
  que el punto #11 (`OrdenRepository.update` / `ajuste_estado`) también sirve el retorno a
  tienda (`rechazada → devuelta_origen` vía `DevolucionOrigenService`), MANTENIENDO el conjunto
  cerrado en 11 y "un `origen_tipo` por familia" (sin 12.º punto, sin enum nuevo).
  **Cubre:** R9. **Depende de:** T4.
  **Test (T7.1):** el propio test de cobertura sigue verde: 11 puntos, 11 `origen_tipo` ==
  enum seed, cada familia una vez; añadir aserción de que NO existe `origen_tipo` nuevo tipo
  `devolucion_origen` (guarda la decisión F1.4-e recomendada).

## 5. Frontend — acción de retorno para la bodega responsable

- [x] **T8** — Añadir la acción/botón "Devolver a la tienda" en la superficie de la bodega
  central (`OrdenesRevisionMaestro` / apartado o filtro de `rechazada`), invocando la Server
  Action `devolverATienda`. Visible sólo a maestro/admin sobre órdenes `rechazada` de zona
  central. **Cubre:** R4, R10, R14. **Depende de:** T6. **Hecho:** apartados "Rechazadas"
  (acción "Devolver a la tienda", filtra `zonaEsGam === true`, abre `DevolverATiendaModal`) y
  "Devueltas a origen" (solo lectura) en `OrdenesRevisionMaestro.tsx`; modal nuevo
  `DevolverATiendaModal.tsx` (loop `await devolverATienda`, patrón `RutearSateliteModal`).
  **Test (T8.1):** `tests/components/DevolverATiendaModal.test.tsx` (4) +
  `tests/components/OrdenesRevisionMaestro.test.tsx` (filtro zona central / readOnly / apartados).
- [x] **T9 [P]** — Añadir la acción "Devolver a la tienda" en el módulo de bodega satélite
  (patrón features 33/34), acotada por zona al `adminSatelite`. Resuelve el sub-riesgo F1.4-d
  (adminSatelite no está en `OrdenService.KNOWN_ROLES`) reusando la superficie de bodega
  satélite, NO el listado genérico de órdenes. **Cubre:** R10, R14. **Depende de:** T6.
  **Hecho:** sección "Por devolver a tienda" en `RecepcionSateliteModule.tsx` (prop
  `porDevolver`, `FilaPorDevolver` con estado/error por fila, `router.refresh()` en éxito);
  `page.tsx` pasa `result.porDevolver`.
  **Test (T9.1):** `tests/components/RecepcionSateliteModule.test.tsx` (lista / dispara acción /
  error por fila / vacío).

## 6. Frontend — visibilidad para la tienda de origen

- [x] **T10** — Asegurar que el módulo de órdenes del `adminTienda` (`OrdenesModule`) muestra
  sus `rechazada` y `devuelta_origen` con etiquetas legibles y, si aplica, un apartado/badge
  "Devueltas/Rechazadas" o el filtro por estado ya soportado. Reusa el scope server-side
  (`OrdenService.listar` → `where.tienda_id`). **Cubre:** R12, R13. **Depende de:** T4.
  **Hecho (verificación):** `OrdenesModule` → `ordenesColumnsAdminTienda` (derivadas de
  `ordenesColumns`) → columna "Estatus" con `EstatusBadge`, que ya mapea `rechazada`→"Rechazada"
  y `devuelta_origen`→"Devuelta a origen". SIN cambio de lógica (scope ya server-side; no se
  fuerza filtro por estado — evita sobre-ingeniería).
  **Test (T10.1):** `tests/components/OrdenesEstatusLabelAdminTienda.test.tsx` (etiqueta legible
  de ambos estados, sin value crudo). El unit de `OrdenService.listar` es backend (fuera de este
  bloque frontend).
- [x] **T11 [P]** — Verificar que la línea de tiempo de la 49 (`HistorialOrdenTimeline`)
  muestra la entrada `rechazada → devuelta_origen` (dato ya provisto por la 49; sólo etiqueta).
  **Cubre:** R15. **Depende de:** T4. **Hecho (verificación):** `HistorialOrdenTimeline` pinta
  cualquier transición vía `estatusLabel`; `devuelta_origen`→"Devuelta a origen" sin lógica
  nueva.
  **Test (T11.1):** `tests/components/HistorialOrdenTimeline.test.tsx` (transición
  rechazada → devuelta_origen con actor y timestamp).

## 7. No regresión + aceptación

- [ ] **T12** — Verificar NO regresión de las features 36/47/49: rechazo directo
  (`en_reparto → rechazada`) y escalado (`devuelta → rechazada`) conservan estado destino,
  atomicidad, `mensajero_asignado_id` y autz. **Cubre:** R16.
  **Test (T12.1):** los tests previos de `mis-asignaciones-service.test.ts` y
  `orden-historial-cobertura.test.ts` siguen verdes sin modificarse (salvo la doc de T7).
- [x] **T13** — E2E (flujo crítico): orden → `rechazada` (por escalado o rechazo directo) →
  bodega responsable "Devolver a tienda" → `devuelta_origen`; el `adminTienda` la ve con
  etiqueta "Devuelta a origen" y la línea de tiempo muestra la transición.
  **Cubre:** R1, R4, R12, R15. **Depende de:** T8/T9, T10, T11.
  **Test (T13.1):** `e2e/devolucion-origen.spec.ts` (Playwright) — ESCRITO/DIFERIDO: el harness
  de seed/login E2E no existe (emails placeholder, igual que 46/47); deuda escrita-no-ejecutada,
  NO corre bajo `pnpm test` (importa `@playwright/test`).
- [ ] **T14** — `./init.sh` en verde: `typecheck` 0, `lint` 0, suite completa (incluidos los
  nuevos tests y el de cobertura de la 49). **Cubre:** R18. **Depende de:** todo lo anterior.
- [ ] **T15** — Documentar el mapa `R<n> → test` en `progress/impl_48-*.md` (trazabilidad).
  **Cubre:** R19. **Depende de:** T14.

## 8. (Condicional) Migración — SÓLO si se elige la variante de F1.4-e/f

> Ejecutar SÓLO si en T0 el humano eligió `origen_tipo` dedicado (`devolucion_origen`) o una
> columna de auditoría del retorno. Con la opción RECOMENDADA, este bloque NO aplica.

- [ ] **T16 (cond.)** — Crear la migración aditiva con `pnpm run db:migrate:create` (enum
  `ADD VALUE` o columnas `devuelta_origen_at`/`devuelta_origen_por`) y escribir el `down.sql`
  inverso exacto (recrear el enum sin el valor, o `DROP COLUMN`). **Cubre:** R17.
- [ ] **T17 (cond.)** — Demostrar el round-trip `db:migrate → db:rollback → db:migrate` contra
  Postgres local. **Cubre:** R17. **Depende de:** T16.
  **Test (T17.1):** `tests/*/migration-*.test.ts` documenta el round-trip; el test de cobertura
  crece a 12 puntos si se añadió `origen_tipo`.
