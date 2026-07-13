# impl_49 — Trazabilidad / historial de estados de la orden

> Feature 49. Rama feature/49-trazabilidad-historial-estados (contiene 43 + 46).
> Coordinada por el implementer; codigo por backend_dev (2 fases) y frontend_dev
> (timeline/drawer, E2E, cierre del hueco del maestro). Spec F1.4 APROBADA (2026-07-13,
> todas las recomendaciones). NO se abre PR aqui (eso es F2.3+ tras el reviewer).

## Alcance entregado (F1.4)
Historial append-only inmutable de CADA transicion de orden.estatus_id + derivador de
intentos (R24/R25) + linea de tiempo por rol. Contador de intentos DERIVADO del historial
(sin columna materializada). Choke point CENTRALIZADO con append atomico en la MISMA
transaccion del cambio de estado. Sin backfill retroactivo. La regla "3 intentos -> rechazo"
NO se implementa aqui (es de la feature 47).

## Verificacion ejecutable (autoritativa, corrida por el implementer)
- typecheck (tsc --noEmit): 0 errores (exit 0).
- lint (eslint .): 0 errores (135 warnings, todos preexistentes en .claude/skills/; ninguno en la feature). exit 0.
- test (vitest run): 249 files / 2225 tests passing, 0 fallos, 0 flakes.
  - Baseline previo a la feature: 239 files / 2140 tests. Neto: +10 files, +85 tests.
  - Progresion: 239/2140 -> (backend fase 1) 244/2182 -> (backend fase 2) 246/2211 -> (frontend) 248/2218 -> (hueco maestro) 249/2225.
- prisma migrate status: Database schema is up to date! (35 migraciones, +1 la de la 49).

### Round-trip de migracion (R4/R32) — evidencia real
1. prisma migrate status -> Database schema is up to date!
2. pnpm db:rollback -> aplica down.sql: Script executed successfully. / Rollback completado: 20260713120000_orden_historial_estado
3. prisma migrate status -> 20260713120000_orden_historial_estado ... have not yet been applied (PENDIENTE)
4. prisma migrate deploy -> Applying migration 20260713120000_orden_historial_estado ... All migrations have been successfully applied.
5. prisma migrate status -> Database schema is up to date!

Nota de reconciliacion local: la rama traia la migracion de la 46 (20260713100000_orden_liberada_reprogramada_at) aun NO aplicada en el Postgres local; el implementer la aplico con migrate deploy (no destructivo) ANTES de crear la de la 49, dejando el historial local sin drift. NO se uso migrate reset.

## Los 11 puntos de escritura de estado instrumentados (design §2) — CONFIRMADOS
Cada uno deja su fila de historial en la MISMA transaccion atomica (R7), solo para las
ordenes efectivamente transicionadas (R8), preservando su guarda existente (R33).

| # | Archivo:simbolo | mecanismo aplicado | origen_tipo | R |
| --- | --- | --- | --- | --- |
| 1 | OrdenRepository.createManyOrdenes | chunk en $transaction; before/after SELECT por num_remision -> append solo a las INSERTADAS | carga_masiva | R9 |
| 2 | OrdenRepository.create | create+append en $transaction; origen null | creacion_manual | R10 |
| 3 | OrdenRepository.generarGuiaLote | append en el $transaction existente; origen pre-leido por orden; destino real | generacion_guia | R11 |
| 4 | OrdenRepository.asignarBodegaLote | envuelto en $transaction; pre-SELECT origen + updateMany | asignacion_bodega | R12 |
| 5 | OrdenRepository.rutearBodegaSateliteLote | append en el $transaction existente | ruteo_satelite | R13 |
| 6 | OrdenRepository.recibirEnSatelite | envuelto; append solo si count===1 | recepcion_satelite | R14 |
| 7 | OrdenRepository.asignarSateliteLote | $queryRaw ... RETURNING id en $transaction, anti-TOCTOU NOT EXISTS INTACTO | asignacion_satelite | R15 |
| 8 | GestionOrdenRepository.recogerLote | $queryRaw ... RETURNING id en $transaction | recoleccion | R16 |
| 9 | GestionOrdenRepository.crearGestionYTransicionar | append en el $transaction existente + gestionOrdenId + motivo | gestion | R17 |
| 10 | LiberacionReprogramadaRepository.liberarOrden | envuelto; actor NULL (cron); append solo si count>0 | liberacion_reprogramada | R18 |
| 11 | OrdenRepository.update | envuelto; append SOLO si estatusId cambia (nuevo != previo) | ajuste_estado | R19 |

- Anti-TOCTOU de #7 preservado: el NOT EXISTS (SELECT 1 FROM cierre_dia ...) + guarda estatus_id/zona_id/deleted_at se conservan caracter por caracter; unico cambio: $executeRaw (count) -> $queryRaw ... RETURNING id DENTRO del $transaction, y con los ids retornados se hace el append en la MISMA tx. Retorno sigue siendo el count (rows.length). Una orden que pierde la guarda no aparece en el RETURNING -> no deja rastro (R8).
- Choke point unico: appendCambioEstado(tx, entradas) en lib/repositories/registrar-cambio-estado.ts (funcion pura reutilizada por los 3 repos); OrdenHistorialRepository.registrarCambioEstado delega en ella. Convencion documentada: toda escritura de orden.estatus_id DEBE llamar a registrarCambioEstado en la misma tx.
- Punto ABIERTO / 12o camino: NO existe. Verificado por Grep sobre lib/ y por que scripts/seed-* y prisma/ no escriben estatus_id. Conjunto CERRADO de 11 fijado por el test de cobertura. Puntos que NO escriben estado (documentados, no instrumentados): asignarMensajeroSugerido, softDelete, setOrdenEnGestion/liberarOrdenEnGestion.

## Archivos creados/modificados

### Backend — Fase 1 (fundacion: tipos, esquema, migracion, RLS, helper, repo, lectura)
Creados:
- lib/types/orden-historial.ts
- db/migrations/20260713120000_orden_historial_estado/migration.sql
- db/migrations/20260713120000_orden_historial_estado/down.sql
- lib/interfaces/repositories/IOrdenHistorialRepository.ts
- lib/repositories/OrdenHistorialRepository.ts
- lib/interfaces/services/IOrdenHistorialService.ts
- lib/services/OrdenHistorialService.ts
- lib/actions/orden-historial.ts
- tests/unit/types/orden-historial-types.test.ts
- tests/integration/db/orden-historial-migration.test.ts
- tests/unit/repositories/orden-historial-repository.test.ts
- tests/unit/services/orden-historial-service.test.ts
- tests/unit/actions/orden-historial-action.test.ts

Modificados:
- db/schema.prisma (enum OrdenHistorialOrigenTipo + modelo OrdenHistorialEstado + relaciones opuestas en Orden/OrderStatus/Usuario/GestionOrden)
- lib/types/orden.ts (OrdenDTO.mensajeroAsignadoId — necesario para la autz de mensajero, R27; aditivo/opcional)
- lib/repositories/OrdenRepository.ts (toDTO mapea mensajeroAsignadoId)
- tests/integration/db/zonas-migration.test.ts (filtro de exclusion de la nueva migracion, mantenimiento 42/43/46)

### Backend — Fase 2 (instrumentacion de los 11 puntos + verificacion transversal)
Creados:
- lib/repositories/registrar-cambio-estado.ts (choke point unico appendCambioEstado)
- tests/unit/repositories/orden-historial-atomicidad.test.ts (R7)
- tests/unit/repositories/orden-historial-cobertura.test.ts (R6/R33)

Modificados (produccion):
- lib/repositories/OrdenHistorialRepository.ts, lib/interfaces/repositories/IOrdenHistorialRepository.ts (HistorialContexto)
- lib/interfaces/repositories/IOrdenRepository.ts (firmas con historial)
- lib/repositories/OrdenRepository.ts (#1,#2,#3,#4,#5,#6,#7,#11)
- lib/repositories/GestionOrdenRepository.ts (#8,#9)
- lib/repositories/LiberacionReprogramadaRepository.ts (#10)
- lib/services/BulkOrdenService.ts, OrdenService.ts, GuiaAsignacionService.ts, RecepcionSateliteService.ts, AsignacionSateliteService.ts

Modificados (tests): orden-repository.test.ts, orden-repository.bulk.test.ts, orden-repository.guia.test.ts, orden-repository.recepcion-satelite.test.ts, orden-repository.asignacion-satelite.test.ts, gestion-orden-repository.test.ts, liberacion-reprogramada-repository.test.ts, guia-asignacion-service.test.ts, recepcion-satelite-service.test.ts, asignacion-satelite-service.test.ts

### Frontend — linea de tiempo, drawer, E2E y cierre del hueco del maestro
Creados:
- app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx
- app/(app)/ordenes/_components/HistorialOrdenSheet.tsx
- tests/components/HistorialOrdenTimeline.test.tsx
- tests/components/HistorialOrdenSheet.test.tsx
- tests/components/OrdenesApartado.test.tsx
- e2e/historial-orden.spec.ts (deferido, convencion del repo: no corre bajo pnpm test)

Modificados:
- app/(app)/ordenes/_components/OrdenesModule.tsx (prop mostrarHistorial -> accion Ver historial por fila; listado plano adminTienda/mensajero/adminSatelite)
- app/(app)/ordenes/page.tsx (activa mostrarHistorial en el listado plano)
- app/(app)/ordenes/_components/OrdenesApartado.tsx (prop mostrarHistorial -> accion por fila; cierra el hueco del maestro/admin)
- app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx (pasa mostrarHistorial a los 5 apartados; maestro y admin ven Ver historial)
- tests/components/OrdenesPage.test.tsx, tests/components/OrdenesRevisionMaestro.test.tsx

Reusa el MISMO HistorialOrdenSheet (mismo aria-label "Ver historial de la orden <referencia>") en el listado plano y en los apartados del maestro; el drawer pre-fetchea via la Server Action obtenerHistorialOrden al abrir (datos por props, R28). Punto de extension realtime (feature 35) documentado en el Sheet (T6.3).

## Mapa R<n> -> test
| R | Test(s) |
| --- | --- |
| R1 | orden-historial-migration.test.ts (enum/tabla/columnas/FKs) + modelo en schema.prisma |
| R2 | orden-historial-migration.test.ts (fila INMUTABLE, sin updated_at/deleted_at) |
| R3 | orden-historial-migration.test.ts (RLS habilitada SIN policies) |
| R4 | orden-historial-migration.test.ts (DOWN reversible orden inverso) + round-trip real |
| R5 | orden-historial-migration.test.ts (indice orden_id,created_at) + orden-historial-repository.test.ts (findHistorialByOrden orderBy asc) |
| R6 | orden-historial-cobertura.test.ts (11 simbolos, conjunto cerrado) + orden-historial-repository.test.ts (registrarCambioEstado) |
| R7 | orden-historial-atomicidad.test.ts (4 mecanismos) + orden-repository.test.ts (fallo del append revierte) |
| R8 | orden-repository.bulk / recepcion-satelite / asignacion-satelite / gestion-orden / liberacion-reprogramada (casos count 0 / race -> sin rastro) |
| R9 | orden-repository.bulk.test.ts (1 historial por creada; duplicadas no dejan rastro) |
| R10 | orden-repository.test.ts (creacion individual, origen null) |
| R11 | orden-repository.guia.test.ts (destino real por orden, origen pre-leido) |
| R12 | orden-repository.guia.test.ts (asignacion_bodega, solo filas afectadas) |
| R13 | orden-repository.guia.test.ts (ruteo_satelite, origen pre-leido) |
| R14 | orden-repository.recepcion-satelite.test.ts (recepcion deja 1 historial) |
| R15 | orden-repository.asignacion-satelite.test.ts (solo ids retornados por RETURNING) |
| R16 | gestion-orden-repository.test.ts (recoleccion solo ids retornados) |
| R17 | gestion-orden-repository.test.ts (entregada/reprogramada/devuelta/rechazada con gestionOrdenId) |
| R18 | liberacion-reprogramada-repository.test.ts (actor NULL sistema, origen reprogramada) |
| R19 | orden-repository.test.ts (registra al cambiar estatus; otro campo no registra) |
| R20 | tests de R10/R11/R13/R14/R17/R19 (origen = estado previo/null) + estatus igual al previo no registra |
| R21 | liberacion-reprogramada-repository.test.ts (actor null=sistema) + bulk/creacion/gestion (actor=usuarioId) |
| R22 | gestion-orden-repository.test.ts (devuelta registra motivo; entregada sin motivo -> null) |
| R23 | orden-historial-types.test.ts (11 valores, conjunto cerrado) + orden-historial-migration.test.ts (enum) |
| R24 | orden-historial-repository.test.ts (contarPorDestino) + orden-historial-service.test.ts (contarIntentos N->N) |
| R25 | orden-historial-service.test.ts (contarIntentos 0->0 / N->N / seed pendiente->0) |
| R26 | orden-historial-service.test.ts (entradas ordenadas asc) + orden-historial-repository.test.ts (orderBy createdAt asc) |
| R27 | orden-historial-service.test.ts (matriz por rol) + HistorialOrdenSheet.test.tsx (forbidden) + OrdenesApartado.test.tsx / OrdenesRevisionMaestro.test.tsx (maestro y admin por UI) + e2e/historial-orden.spec.ts (adminTienda ajena no ve el boton) |
| R28 | orden-historial-action.test.ts (sin sesion -> unauthenticated; ok; forbidden/not_found) + HistorialOrdenSheet.test.tsx (consulta la Server Action; no fetch en cliente) |
| R29 | HistorialOrdenTimeline.test.tsx + HistorialOrdenSheet.test.tsx + OrdenesApartado.test.tsx + e2e/historial-orden.spec.ts |
| R30 | HistorialOrdenTimeline.test.tsx (etiquetas legibles via estatus-label, nunca UUID/value crudo) |
| R31 | typecheck 0 / lint 0 / 2225 tests verdes (esta bitacora) |
| R32 | round-trip de migracion (esta bitacora) |
| R33 | orden-historial-cobertura.test.ts + suite completa verde (features 15/17/30/33/34/36/46 intactas) |
| R34 | este mapa (R1..R33 con test) |

## Notas / desviaciones para el reviewer
- OrdenDTO.mensajeroAsignadoId (aditivo): findById no lo exponia; la autz del mensajero (R27) lo requiere (un mensajero recien asignado que aun no gestiono no tiene fila de historial con su actor). Se expuso opcional en OrdenDTO + toDTO, mismo patron que OrdenListItemDTO; sin query extra ni migracion.
- Threading de actor: #8/#9 usan el mensajeroId que ya viajaba como actor; #10 es actor NULL (cron). Por eso MisAsignacionesService y LiberacionReprogramadaService no cambiaron de firma.
- #8 recogerLote: reescrito de updateMany a $queryRaw ... RETURNING id (misma guarda) para saber EXACTAMENTE que filas transicionaron (R8), preservando el comportamiento observable.
- Hueco de UI del maestro cerrado: el diseno §6/F1.4-f exige que maestro/admin tambien tengan Ver historial. Se anadio la accion por fila a OrdenesApartado (los 5 apartados), disponible incluso en readOnly (admin) por ser de solo lectura.
- E2E: escrito y DEFERIDO (patron del repo; no corre bajo pnpm test, requiere dev server + DB + seed).

## Estado de tasks
Todas las tasks de tasks.md (Bloques 0-7, T0.1 ... T7.4) marcadas [x].

## Veredicto
Implementacion completa y verificada: 11 puntos instrumentados con append atomico, anti-TOCTOU intacto, migracion con round-trip verde y RLS, derivador de intentos, linea de tiempo por rol (los 4 roles con acceso UI), typecheck 0 / lint 0 / 249 files - 2225 tests verdes. Sin backfill. Queda a decision del reviewer.
