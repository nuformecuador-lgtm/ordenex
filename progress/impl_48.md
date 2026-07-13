# Impl — Feature 48: rechazo, devolución a la tienda de origen

Rama feature/48-rechazo-devolucion-tienda-origen (nace del tip de la 47 = dev + 58 + 47).
Implementer coordinando backend_dev (2 pasadas) -> frontend_dev. F1.4 APROBADA (todas
recomendadas) 2026-07-13. SIN migración. Transición manual rechazada -> devuelta_origen vía
el choke point de la 49 reutilizando el punto #11 (OrdenRepository.update, origen_tipo = ajuste_estado).

## Veredicto
Implementación COMPLETA y verde. ./init.sh OK; typecheck 0, lint 0 errores, 2405/2405 tests
(baseline 2361 -> +44), SIN migración, sin regresión 36/47/49. Pendiente: revisión del reviewer.

## Conteo de tests
- Antes (baseline en la rama): 2361 passed / 261 archivos.
- Después: 2405 passed / 265 archivos (+44 tests, +4 archivos). 0 fallos.
- pnpm run typecheck -> 0 errores (ninguno dentro ni fuera de .next/).
- pnpm run lint -> 0 errores (135 warnings preexistentes en .claude/skills/impeccable/scripts/, ajenos).
- ./init.sh -> "== init OK ==" (migraciones con down.sql, .env presente).

## Confirmación: SIN migración
git status db/migrations/ db/schema.prisma = vacío. rechazada y devuelta_origen ya sembrados en
ORDER_STATUS_SEED; tienda de origen = orden.tiendaId (FK existente); el retorno reutiliza
origen_tipo = ajuste_estado (#11) -> sin ALTER TYPE, sin columna nueva.

## Transición atómica vía choke point 49 (+ cobertura verde)
DevolucionOrigenService.devolverATienda NO crea call-site nuevo: llama
OrdenRepository.update(ordenId, { estatusId }, { actorUsuarioId, origenTipo: "ajuste_estado" }).
Ese método (OrdenRepository.ts:346-391) ejecuta el UPDATE de estado + appendCambioEstado (choke
point de la 49) en la MISMA $transaction, registrando solo si el estatus cambia. Verificado por
tests/unit/repositories/orden-repository.test.ts: la transición deja UNA fila de historial
rechazada -> devuelta_origen con actorUsuarioId = admin de bodega y origen_tipo = ajuste_estado;
si el append falla, la tx aborta (atómico). orden-historial-cobertura.test.ts SIGUE en
EXACTAMENTE 11 puntos (1 por familia), con #11 documentado como servidor también del retorno,
+ aserción de que el enum NO gana devolucion_origen. Cobertura de la 49: verde.

## Archivos creados
Backend:
- lib/interfaces/services/IDevolucionOrigenService.ts — contrato devolverATienda(ordenId, actor).
- lib/services/DevolucionOrigenService.ts — regla: guardia de estado (solo rechazada;
  devuelta_origen idempotente; otro -> conflict) + autz por bodega responsable
  (resolverDestinoCierre + findCentralZonaId + findUsuarioZonaId) + transición vía update (#11).
- lib/actions/devolucion-origen.ts — Server Action, zod { ordenId }, resolveActorFromSession, withErrorHandler.
Frontend:
- app/(app)/ordenes/_components/DevolverATiendaModal.tsx — modal confirmación (patrón RutearSateliteModal).
- app/(app)/ordenes/_components/devolucion-origen-error-messages.ts — traductor status->mensaje.
Tests:
- tests/unit/services/devolucion-origen-service.test.ts
- tests/unit/actions/devolucion-origen.test.ts
- tests/components/DevolverATiendaModal.test.tsx
- tests/components/OrdenesEstatusLabelAdminTienda.test.tsx
- e2e/devolucion-origen.spec.ts (escrito, DIFERIDO — sin harness seed/login E2E, patrón 46/47).

## Archivos modificados
Backend:
- lib/interfaces/services/IRecepcionSateliteService.ts — porDevolver en rama ok.
- lib/services/RecepcionSateliteService.ts — bucket porDevolver (rechazadas de la zona, server-side).
- lib/types/recepcion-satelite.ts — porDevolver en el result de la action.
Frontend:
- app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx — apartado "Rechazadas" (acción
  "Devolver a la tienda", filtra zonaEsGam===true) + apartado read-only "Devueltas a origen" + modal.
- app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx — sección "Por devolver a tienda".
- app/(app)/recepcion-satelite/page.tsx — pasa porDevolver.
Tests:
- tests/unit/repositories/orden-historial-cobertura.test.ts (T7, sigue en 11)
- tests/unit/repositories/orden-repository.test.ts (T4.1 choke point + atomicidad)
- tests/unit/services/orden-service.test.ts (T10.1 visibilidad tienda server-side)
- tests/unit/services/recepcion-satelite-service.test.ts (T9 porDevolver por zona)
- tests/unit/actions/recepcion-satelite-action.test.ts, tests/components/RecepcionSatelitePage.test.tsx (fixtures porDevolver: [])
- tests/components/OrdenesRevisionMaestro.test.tsx, RecepcionSateliteModule.test.tsx, HistorialOrdenTimeline.test.tsx

## Mapa R -> test
- R1/R2 elegibilidad ambos caminos, sin dato extra -> devolucion-origen-service.test.ts
  "orden rechazada por rechazo directo Y por escalado son ambas retornables".
- R3 sin transición automática (36/47 intactos) -> no-regresión mis-asignaciones-service.test.ts
  + orden-historial-cobertura.test.ts (comportamiento sin cambio).
- R4 transición rechazada->devuelta_origen -> devolucion-origen-service.test.ts "transiciona...";
  devolucion-origen.test.ts (action); DevolverATiendaModal.test.tsx; RecepcionSateliteModule.test.tsx.
- R5 guardia de estado + idempotencia -> devolucion-origen-service.test.ts "estado != rechazada
  -> conflict" + "devuelta_origen es idempotente".
- R6 tienda de origen = orden.tiendaId (sin campo nuevo) -> fixtures del service + orden-service.test.ts.
- R7/R8 transición atómica por choke point 49 + actor + origen_tipo -> orden-repository.test.ts
  "UNA fila con actor=admin y origen_tipo=ajuste_estado" + "append falla -> revierte (atómico)".
- R9 cobertura 49 en 11, sin devolucion_origen -> orden-historial-cobertura.test.ts.
- R10 autz por bodega responsable -> devolucion-origen-service.test.ts (zona central/satélite/fallback)
  + OrdenesRevisionMaestro.test.tsx (filtro zona central; readOnly) + RecepcionSateliteModule.test.tsx.
- R11 actor sin permiso -> denegado sin efectos -> devolucion-origen-service.test.ts (forbidden sin update)
  + devolucion-origen.test.ts (forbidden/unauthenticated/validation).
- R12 visibilidad tienda server-side (tienda_id) -> orden-service.test.ts "adminTienda solo ve sus
  órdenes incl. rechazada/devuelta_origen"; "orden de otra tienda no aparece"; "filtro por estado".
- R13 etiquetas legibles -> OrdenesEstatusLabelAdminTienda.test.tsx ("Rechazada"/"Devuelta a origen").
- R14 visibilidad otros roles -> OrdenesRevisionMaestro.test.tsx (apartado "Devueltas a origen")
  + RecepcionSateliteModule.test.tsx (sección "Por devolver") + recepcion-satelite-service.test.ts (porDevolver por zona).
- R15 línea de tiempo 49 -> HistorialOrdenTimeline.test.tsx (transición a "Devuelta a origen" con actor y timestamp).
- R16 no regresión 36/47/49 -> mis-asignaciones-service.test.ts + orden-historial-cobertura.test.ts verdes sin cambio.
- R17 sin order_status nuevo, sin migración -> git status limpio en migrations/schema + orden-historial-cobertura.test.ts.
- R18 ./init.sh verde -> "== init OK ==", 2405/2405, typecheck 0, lint 0.
- R19 cada R mapeado -> este documento.

## Tasks (specs/48-.../tasks.md)
- [x] T1, T2, T3, T4, T6, T7 (backend)
- [x] T8, T9, T10, T11 (frontend), T13 (E2E escrito/diferido)
- T5 (endurecimiento opcional): NO solicitado (no realizado).
- T12 (no regresión) y T14 (init.sh): verificados en esta pasada. T15 (este log): hecho.

## Notas / deudas menores
- E2E DIFERIDO (T13): e2e/devolucion-origen.spec.ts escrito pero NO ejecutable (sin harness de
  seed/login E2E; emails placeholder), consistente con features 46/47.
- Fixture cross-cutting: al hacer porDevolver requerido en el result satélite, dos fixtures
  (recepcion-satelite-action.test.ts, RecepcionSatelitePage.test.tsx) requerían porDevolver: [];
  aplicado (solo fixtures, sin lógica). Typecheck limpio.
- Sub-riesgo F1.4-d respetado: NO se agregó adminSatelite a OrdenService.KNOWN_ROLES; la
  visibilidad/acción del satélite vive en la superficie de bodega (features 33/34), no en el
  listado genérico. Autz existente (features 6/26) intacta.
