# progress/impl_47.md - Feature 47: Reintentos de entrega y escalado a rechazo

Bitacora del implementer. Feature fullstack coordinada: backend_dev (B0-B3 + T4.1)
luego frontend_dev (T4.2 badge + T5.2 E2E). Rama feature/47-reintentos-escalado-rechazo
(nace de dev verde post-#55, con la feature 49 presente). Spec F1.4 aprobada por el humano
el 2026-07-13 con TODAS las recomendaciones.

## Veredicto
Implementada y VERDE. typecheck 0 errores; lint 0 errores; suite 260 archivos / 2355
tests, todos pasan. Sin migracion. El escalado/retorno son atomicos por el choke point de la
49; su test de cobertura sigue verde con las invariantes intactas. Pendiente: revision.

## Conteo de tests (evidencia ejecutable)
- ANTES (baseline, pre-47): Test Files 259 passed (259); Tests 2324 passed (2324); typecheck 0.
- DESPUES (post-47): Test Files 260 passed (260); Tests 2355 passed (2355); typecheck 0; lint 0 errores (135 warnings, todas en .claude/skills/impeccable/scripts/*, ajenas a la feature).
- Delta: +1 archivo de test, +31 tests. Sin fallos flaky en esta corrida.

## Migracion: NO hubo (R21 / design 7 / F1.4-h)
git status sin cambios en prisma/, schema ni db/migrations/. Reutiliza order_status ya
sembrados (devuelta/rechazada/en_bodega/en_bodega_satelite en ORDER_STATUS_SEED),
origen_tipo=gestion existente (SIN enum nuevo) y contador DERIVADO (sin columna
materializada). El test de cobertura afirma que el enum NO gana reintento_devolucion ni
escalado_rechazo.

## Atomicidad y choke point de la 49 (R8/R10/R11/R14)
Una gestion resultado=devuelta ahora deja DOS filas de historial dentro de la MISMA
$transaction de GestionOrdenRepository.crearGestionYTransicionar (#9 del inventario 49):
1. en_reparto -> devuelta (actor=mensajero, origen_tipo=gestion): la fila que el derivador
   contarIntentos CUENTA.
2. Seguimiento automatico (actor=NULL/sistema, origen_tipo=gestion, gestion_orden_id):
   - devuelta -> rechazada (ESCALADO, final) cuando intentoActual >= umbral; NO limpia
     mensajeroAsignadoId.
   - devuelta -> en_bodega / en_bodega_satelite (REINTENTO) cuando intentoActual < umbral;
     SI limpia mensajeroAsignadoId (handoff a bodega, patron 46).
Ambas escrituras pasan por appendCambioEstado (unico choke point de la 49). Si el 2o append
falla, la tx propaga y revierte todo (test de atomicidad verde). El umbral es configurable
(lib/config/reintentos.ts, env REINTENTOS_MIN_INTENTOS, default 3). El conteo se lee antes de
la tx; el puntero de bloqueo 1-a-1 del mensajero evita TOCTOU (design 2.3).

### Test de cobertura de la 49 (R14) - SIGUE VERDE
tests/unit/repositories/orden-historial-cobertura.test.ts: invariantes intactas
(EXACTAMENTE 11 puntos, cada origen_tipo una vez, los 11 origen_tipo == enum seed). Como el
seguimiento reutiliza origen_tipo=gestion, NO se anade un 12o punto: se documenta que #9 emite
una transicion COMPUESTA (gestion + seguimiento automatico actor=null, escribiendo tambien
destinos en_bodega/en_bodega_satelite/rechazada) y se anade una asercion de que el enum no
incorpora valores nuevos (confirma R14/R21, sin migracion).

## Decision de alcance de UI (implementer)
Superficie del conteo = el historial-sheet/timeline de la 49 (badge Intento X de N), alcanzado
por fila desde la tabla de ordenes existente (OrdenesModule con mostrarHistorial). Opcion
permitida por design 5 + tasks T4.1/T4.2 (exponer junto al historial O la lista). El dato viaja
server-side en el ok de la action del historial (intentos+umbral), autz de la orden reusada
(R17). No se toco la query caliente del listado (respeta sin sobre-ingenieria,
docs/architecture.md). El badge solo aparece con intentos >= 1 (R16).

## Archivos creados/modificados
### backend_dev
Creados:
- lib/config/reintentos.ts (R3)
- tests/unit/config/reintentos.test.ts
Modificados:
- lib/interfaces/repositories/IGestionOrdenRepository.ts (OrdenGestionRow.zonaId + crearGestionYTransicionar(... seguimiento?))
- lib/repositories/GestionOrdenRepository.ts (proyeccion zonaId + 2a escritura de estado y 2o append de seguimiento en la misma tx)
- lib/services/MisAsignacionesService.ts (deps historial/zonaRepo, regla de decision reintento/escalado en la rama devuelta)
- lib/actions/mis-asignaciones.ts (buildService inyecta OrdenHistorialService + ZonaRepository)
- lib/interfaces/services/IOrdenHistorialService.ts (ok gana intentos/umbral)
- lib/services/OrdenHistorialService.ts (computa intentos/umbral en obtenerHistorial)
- tests/unit/services/mis-asignaciones-service.test.ts, tests/unit/repositories/gestion-orden-repository.test.ts, tests/unit/repositories/orden-historial-cobertura.test.ts, tests/unit/services/orden-historial-service.test.ts, tests/unit/actions/orden-historial-action.test.ts

### frontend_dev
Creado:
- e2e/reintentos-escalado.spec.ts (T5.2 - WRITTEN, NOT EXECUTED; vitest solo corre tests/**, playwright diferido)
Modificados:
- app/(app)/ordenes/_components/HistorialOrdenSheet.tsx (badge Intento X de N en el caso ok)
- tests/components/HistorialOrdenSheet.test.tsx (fixtures ok + 5 tests del badge)
- tests/components/OrdenesApartado.test.tsx, tests/components/OrdenesRevisionMaestro.test.tsx (shape del ok, sin cambio de comportamiento)

## Mapa R<n> -> test
- R1 (derivar intentos, consumir 49) -> mis-asignaciones-service.test.ts (contarIntentos invocado); orden-historial-service.test.ts (ok incluye intentos)
- R2 (consumir el derivador; seed pendiente->0) -> orden-historial-service.test.ts (catalogo sin devuelta -> 0); mis-asignaciones-service.test.ts (catalogo incompleto -> validation_error)
- R3 (umbral configurable, default 3, entero>=1) -> tests/unit/config/reintentos.test.ts (ausente->3, 5->5, 0/x/vacio/-2->3)
- R4 (solo devuelta cuenta; reprogramada NO) -> mis-asignaciones-service.test.ts (reprogramada NO computa seguimiento)
- R5 (retorno a bodega por zona; edge zonaId null->en_bodega) -> mis-asignaciones-service.test.ts (zona central/satelite/null); gestion-orden-repository.test.ts (proyecta zonaId)
- R6 (limpia mensajero en reintento, conserva num_guia) -> gestion-orden-repository.test.ts (reintento -> en_bodega, mensajeroAsignadoId null, numGuia intacto)
- R7 (devuelta intermedia, nunca reposa) -> gestion-orden-repository.test.ts (2o update + 2o append en la misma tx)
- R8 (escalado sincrono, misma tx) -> mis-asignaciones-service.test.ts (N-esima escala); gestion-orden-repository.test.ts (escalado->rechazada); E2E reintentos-escalado.spec.ts
- R9 (N-esima escala; 1..N-1 reintentan) -> mis-asignaciones-service.test.ts ((N-1) no escala, N escala); E2E (3 devueltas -> rechazada, 2 en_bodega)
- R10 (choke point 49, actor null, atomico) -> gestion-orden-repository.test.ts (escalado actor=null + atomicidad: 2o append falla -> revierte)
- R11 (primero devuelta, luego seguimiento; ambas por el choke point) -> gestion-orden-repository.test.ts (DOS appends, orden devuelta->seguimiento)
- R12 (devuelta intermedia / rechazada final) -> cubierto por R7/R8 + no-regresion de rechazada directa
- R13 (NO escribe devuelta_origen) -> mis-asignaciones-service.test.ts (la 47 NO escribe devuelta_origen)
- R14 (actualiza cobertura 49) -> orden-historial-cobertura.test.ts (comentario #9 compuesto + asercion enum sin valores nuevos; 11 invariantes verdes)
- R15 (mostrar intentos acumulados) -> HistorialOrdenSheet.test.tsx (Intento 3 de 3 / Intento 1 de 3); orden-historial-service.test.ts (ok con intentos)
- R16 (X de N, legible, solo con >=1 devolucion) -> HistorialOrdenSheet.test.tsx (intentos=0 NO muestra badge; >=1 si)
- R17 (visibilidad por rol reusada de la 49) -> HistorialOrdenSheet.test.tsx (forbidden/not_found no muestran badge); orden-historial-service.test.ts (intentos tras autorizar)
- R18 (conserva autz gestion 36; escalado lo dispara el sistema) -> no-regresion mis-asignaciones-service.test.ts (guardia propiedad/rol intacta; seguimiento actor=null)
- R19 (sin regresion: entregada/reprogramada/rechazada directa = 1 sola transicion) -> mis-asignaciones-service.test.ts; gestion-orden-repository.test.ts (sin seguimiento -> 1 update + 1 append); suite 36/46/49 verde
- R20 (init verde: typecheck 0, lint 0, tests pasan) -> salida pnpm run typecheck / lint / test (arriba)
- R21 (sin order_status ni columna nuevos; sin migracion) -> orden-historial-cobertura.test.ts (enum cerrado) + git status (sin cambios de schema)
- R22 (cada R con test) -> este mapa

## E2E (T5.2) - WRITTEN, NOT EXECUTED
e2e/reintentos-escalado.spec.ts (Playwright) espeja el patron y notas de ejecucion de
e2e/historial-orden.spec.ts. Cubre: una orden con 3 devoluciones consecutivas (con
re-asignacion entre ellas) -> rechazada tras la 3a; el drawer Ver historial muestra el badge
Intento 3 de 3 y la linea de tiempo muestra las 3 devoluciones + el escalado a Rechazada. No
corre bajo pnpm test (vitest solo incluye tests/**); ejecucion diferida segun convencion del
repo (requiere app + DB de test + seed).

## Tasks
Las 16 casillas de specs/47-reintentos-escalado-rechazo/tasks.md marcadas [x]
(Bloques 0-5 completos).
