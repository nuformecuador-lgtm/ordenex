# progress/review_47.md - Review Feature 47 (reintentos de entrega y escalado a rechazo)

Reviewer del arnes SDD. Rama feature/47-reintentos-escalado-rechazo, commit de la feature 68eb8fd.
La rama nace de dev + el revert de #55 (commits 12a67cc, 6e7209c) y anade la 47 encima; el
"git diff dev...HEAD" grande es el REVERT, NO la feature. Verificacion sobre el commit 68eb8fd
aislado + la suite completa ejecutada por mi (no de palabra).

## VEREDICTO: APROBADO (OK) - 0 bloqueantes

---

## Verificacion ejecutable (corrida por el reviewer)

- pnpm run typecheck -> 0 errores.
- pnpm run lint -> 0 errores (135 warnings, TODAS en .claude/skills/impeccable/scripts/*, ajenas).
- pnpm run test (vitest run) -> Test Files 260 passed (260); Tests 2355 passed (2355). Coincide
  con impl_47 (+1 archivo, +31 tests sobre baseline 2324). Sin fallos ni flaky.
- OJO init.sh: la linea 59 enmascara un exit != 0 de la suite e imprime "== init OK ==" igual.
  Por eso corri typecheck/lint/test por separado y mire el conteo real (2355), no el "OK".

## Checklist CHECKPOINTS

- [x] specs/47/{requirements,design,tasks}.md presentes; design con alternativas descartadas.
- [x] Todas las tasks de tasks.md en [x] (Bloques 0-5, 16 casillas).
- [x] Cada R1..R22 mapea a >=1 test real (tabla abajo). impl_47.md trae el mapa.
- [x] typecheck 0 / lint 0 / test verde (2355).
- [x] Capas: REGLA en el service (resolverSeguimientoDevuelta), ESCRITURA en el repo, append por
  el unico choke point (registrar-cambio-estado.ts). Repo sin logica; service sin HTTP/Prisma.
- [x] Interfaces en lib/interfaces/ (IGestionOrdenRepository, IOrdenHistorialService).
- [x] Sin hardcode: umbral por env REINTENTOS_MIN_INTENTOS (default 3), patron lib/config/*.
- [x] Sin secretos nuevos. Sin tablas nuevas -> RLS N/A. Sin webhooks -> firma/idempotencia N/A.
- [x] E2E del flujo critico ESCRITO (e2e/reintentos-escalado.spec.ts, 276 lineas, real);
  ejecucion diferida (Playwright), misma convencion que la 49 -> ver menor-1.
- [ ] progress/history.md: entrada de cierre pendiente (tarea del leader, no del review).

## Trazabilidad R<n> -> test

| R | Que exige | Test que lo verifica (real, con asserts) |
|---|---|---|
| R1 | Derivar intentos consumiendo la 49 | mis-asignaciones-service.test.ts (contarIntentos con "o1"); orden-historial-service.test.ts (derivador) |
| R2 | Consumir derivador; seed pendiente->0 | orden-historial-service.test.ts (catalogo sin devuelta -> 0); mis-asignaciones-service.test.ts (catalogo incompleto -> validation_error) |
| R3 | Umbral configurable, entero>=1, default 3 | reintentos.test.ts (ausente/5/0/x/vacio/-2) |
| R4 | Solo devuelta cuenta; reprogramada no | mis-asignaciones-service.test.ts (reprogramada NO cuenta ni computa seguimiento; contarIntentos NO llamado) |
| R5 | Retorno a bodega por zona (+ edge null) | mis-asignaciones-service.test.ts (satelite/central/zonaId=null); gestion-orden-repository.test.ts (proyecta zonaId) |
| R6 | Reintento limpia mensajero, conserva num_guia | gestion-orden-repository.test.ts (reintento -> en_bodega_satelite, mensajero null, NO toca numGuia) |
| R7 | devuelta intermedia, nunca reposa | gestion-orden-repository.test.ts (2 orden.update + 2 appends en la misma tx) |
| R8 | Escalado sincrono, misma tx | mis-asignaciones-service.test.ts (N-esima escala); gestion-orden-repository.test.ts (escalado->rechazada) |
| R9 | N-esima escala; 1..N-1 reintentan | mis-asignaciones-service.test.ts ((N-1)=2 no escala; N=3 escala) |
| R10 | Choke point, actor=null, atomico | gestion-orden-repository.test.ts (seguimiento actorUsuarioId:null; atomicidad: append seguimiento falla -> tx propaga) |
| R11 | Primero devuelta, luego seguimiento; ambos por choke point | gestion-orden-repository.test.ts (DOS appends; origen del 2o = os-devuelta) |
| R12 | devuelta intermedia / rechazada final | R7/R8 + no-regresion rechazada directa (gestion-orden-repository R19). IMPLICITO -> menor-3 |
| R13 | NO escribe devuelta_origen | mis-asignaciones-service.test.ts (findEstatusIdByValue nunca con devuelta_origen) + grep en lib/ |
| R14 | Actualiza cobertura de la 49 | orden-historial-cobertura.test.ts (#9 compuesto; asercion enum NO gana reintento_devolucion/escalado_rechazo; 11 invariantes) |
| R15 | Mostrar intentos acumulados | HistorialOrdenSheet.test.tsx (Intento 3 de 3 / 1 de 3); orden-historial-service.test.ts; orden-historial-action.test.ts (propaga intentos/umbral) |
| R16 | X de N legible, solo con >=1 devolucion | HistorialOrdenSheet.test.tsx (intentos=0 NO muestra badge) |
| R17 | Visibilidad por rol reusada de la 49 | HistorialOrdenSheet.test.tsx (forbidden/not_found NO badge); orden-historial-service.test.ts (autz por rol antes de intentos) |
| R18 | Conserva autz gestion 36; escalado lo dispara el sistema | mis-asignaciones-service.test.ts (guardias R12/R18/R21/R31; seguimiento actor=null) |
| R19 | Sin regresion (entregada/reprogramada/rechazada directa = 1 transicion) | mis-asignaciones-service.test.ts (3 ramas sin seguimiento); gestion-orden-repository.test.ts (sin seguimiento -> 1 update + 1 append) + suite 36/46/49 verde |
| R20 | init verde | typecheck 0 / lint 0 / 2355 tests |
| R21 | Sin order_status ni columna nuevos; sin migracion | orden-historial-cobertura.test.ts (enum cerrado 11) + git show 68eb8fd sin cambios de schema/migrations |
| R22 | Cada R con test | Esta tabla + mapa en impl_47.md |

Todos los R mapean a tests que ASSERTAN el comportamiento (no vacios). Sin huecos.

## LO CRITICO - escalado atomico y trazable (verificacion explicita)

Codigo: lib/repositories/GestionOrdenRepository.crearGestionYTransicionar (L186-267).

- Misma $transaction? SI. Un unico this.prisma.$transaction(async (tx) => {...}) envuelve:
  (a) pre-lectura del estatus origen; (b) create de la gestion; (c) tx.orden.update a devuelta;
  (d) libera puntero 1-a-1; (e) appendCambioEstado(tx, [en_reparto->devuelta, actor=mensajero,
  origen_tipo=gestion, gestion_orden_id]); y si hay seguimiento: (f) tx.orden.update al destino
  (rechazada escalado / en_bodega|en_bodega_satelite reintento, limpiando mensajeroAsignadoId solo
  en reintento) + (g) 2o appendCambioEstado(tx, [devuelta->destino, actorUsuarioId=null,
  origen_tipo=gestion, gestion_orden_id]). Todo sobre el MISMO tx.
- Atraviesa el choke point de la 49? SI. Ambos appends llaman a appendCambioEstado
  (lib/repositories/registrar-cambio-estado.ts), el unico punto de append. No hay ningun
  tx.ordenHistorialEstado.create* directo ni orden.update sin su append emparejado.
- actor=null (sistema) + origen_tipo=gestion en el seguimiento? SI (L259-260).
- Cada cambio de estado con su linea de historial dentro de la tx? SI: los DOS orden.update tienen
  su appendCambioEstado en la misma tx. Ningun cambio de estado queda sin rastro ni fuera de la tx.
- Revierte si el 2o append falla? SI. El callback del $transaction es async; si el 2o createMany
  rechaza, la promesa del callback rechaza y Prisma revierte todo. Verificado por el test "R10
  atomicidad: si el append del seguimiento falla, la tx propaga el error" (mock que resuelve el 1er
  append y rechaza el 2o -> rejects.toThrow). Ademas el service, si crearGestionYTransicionar
  lanza, limpia el objeto de storage (best-effort) y re-propaga.
- Condicion de carrera en el conteo? El conteo se lee ANTES de la tx (en el service). La
  serializacion se apoya en: (1) la guardia de origen en_reparto - una devuelta saca la orden de
  en_reparto en la MISMA tx, asi que no cabe una 2a devuelta hasta completar el ciclo
  bodega->reasignacion->recoger; y (2) el puntero de bloqueo 1-a-1 del mensajero + la guardia de
  propiedad (solo el mensajero asignado gestiona, y una orden a la vez). Es la decision APROBADA en
  F1.4/design 2.3. No salta el umbral ni doble-escala bajo operacion normal. Ver menor-2.

## Contador DERIVADO (no materializado) - confirmado

OrdenHistorialService.contarIntentos = findEstatusIdByValue("devuelta") +
OrdenHistorialRepository.contarPorDestino(ordenId, devueltaId) (count sobre orden_historial_estado,
indice (orden_id, estatus_destino_id) de la 49). SIN columna nueva en orden, sin segunda fuente de
verdad. Solo devuelta cuenta (reprogramada no invoca el derivador: test R4). Umbral en
lib/config/reintentos.ts (default 3, entero>=1).

## SIN migracion - confirmado

git show --name-only 68eb8fd NO toca db/schema.prisma ni db/migrations/. Estatus
(devuelta/rechazada/en_bodega/en_bodega_satelite) ya en ORDER_STATUS_SEED; origen_tipo=gestion
reutilizado (sin ALTER TYPE). El test de cobertura afirma que el enum NO gana reintento_devolucion/
escalado_rechazo y sigue cerrado en 11.

## Cobertura de la 49 (R14) - sigue VERDE y exhaustiva

tests/unit/repositories/orden-historial-cobertura.test.ts: EXACTAMENTE 11 puntos, numeracion 1..11,
cada origen_tipo una sola vez, los 11 == enum seed, + asercion nueva de la 47 (enum sin valores
nuevos). No se relajo: se endurecio (guarda la decision de "sin migracion de enum").

## Fuera de alcance / zonaId / UI

- devuelta_origen: NO se escribe (grep en lib/ solo lo halla en el catalogo y un comentario;
  ningun call-site nuevo). Feature 48 no invadida (R13).
- findByIdsParaGestion proyecta zonaId -> OrdenGestionRow.zonaId; los consumidores
  (recoger/gestionar) no rompen (suite verde). Rutea central->en_bodega, satelite->
  en_bodega_satelite, null->en_bodega (fallback).
- Badge "Intento X de N" en HistorialOrdenSheet (solo con intentos>=1), visibilidad heredada del ok
  ya autorizado por la 49 (R17); sin regla de permisos nueva. Sin regresion 36/49.

## Hallazgos

- BLOQUEANTES: ninguno.
- menor-1 (deuda): e2e/reintentos-escalado.spec.ts esta ESCRITO y es real, pero NO se ejecuta bajo
  pnpm test (vitest solo corre tests/**; Playwright diferido, misma convencion que la 49). El flujo
  critico de escalado no tiene E2E ejecutado. Accion: correrlo con entorno Playwright + seed.
- menor-2 (deuda opcional): el conteo se lee antes de la tx (TOCTOU teorico). Mitigado por la
  guardia de origen en_reparto + el puntero 1-a-1; es el diseno APROBADO (F1.4 2.3). Si a futuro
  algun flujo habilita devueltas concurrentes de la misma orden, endurecer con recount dentro de la
  tx o SELECT ... FOR UPDATE. No bloqueante.
- menor-3 (documental): R12 se cubre de forma implicita (via R7/R8 + no-regresion de rechazada
  directa) sin un test que lo nombre. Trazabilidad real pero no explicita.

## Cierre

Feature 47 correcta y verificable: escalado/retorno atomicos por el choke point de la 49 en una
sola $transaction (con revert probado), contador derivado sin materializar, sin migracion,
cobertura de la 49 intacta, sin regresion (2355 verdes). VEREDICTO: OK.
