# Review — Feature 44: wallet, pago a mensajeros y cuentas por pagar

> Reviewer del arnes SDD. Worktree aislado `R:/ark-studio/projects/ricardo/ordenex-f44`.
> Verificacion ESTATICA de la migracion (NO se aplico ni se muto la DB local; otra sesion la
> comparte). Corridas: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (suite completa).

## VEREDICTO: RECHAZADO

Backend money-critical solido (modelo/migracion/feed/enganche/idempotencia/RLS impecables), pero
la VISTA DEL MAESTRO no cumple dos requisitos FIRMES ([F1.4-Qe] APROBADA): R18 (desglose por
cierre, paginado, mas reciente primero) y R22 (filtros server-side por fecha/cierre en la vista
del maestro). Ambos son gaps money-critical de auditoria -> BLOQUEANTES.

---

## Estado de la suite (verificado por el reviewer)

- `pnpm run typecheck`: 0 errores (`tsc --noEmit` limpio).
- `pnpm run lint`: 0 errores (135 warnings, TODOS en `.claude/skills/impeccable/scripts/*.mjs`
  pre-existentes; ninguno en archivos de la 44).
- `pnpm test`: 242 archivos, 2177 tests, 242 passed / 2177 passed (exit 0). El flaky conocido
  `OrdenesModuleReuse.test.tsx` paso en esta corrida. Sin regresiones en cierres (37/38/40/41/56)
  ni wallet (42/43).
- Money-safe (R27): grep parseFloat/Number(/.toNumber( sobre los fuentes de la 44 = solo
  comentarios, cero uso real. (Los Number( de ZonaForm.tsx y GestionarOrdenModal.tsx son ajenos.)

## init.sh

Solo corre typecheck/lint/test + valida feature_list.json y presencia de down.sql; NO ejecuta
db:migrate/seed. Seguro; equivale a las tres corridas ya verdes.

---

## Checklist CHECKPOINTS

- [x] requirements.md con R1..R27 EARS + bloque F1.4 APROBADA.
- [x] design.md con alternativas descartadas y su porque.
- [~] tasks.md: T1..T19 en [x]; T0 (puerta F1.4) y T20 (PR) siguen [ ] (menor).
- [~] Trazabilidad: 25/27 requisitos con test que verifica; R18 y R22 sin test que cubra la parte
  incumplida (ver bloqueantes).
- [x] impl_44-*.md con el mapa R->test (backend + frontend).
- [x] typecheck / lint / test verdes.
- [x] E2E money-critical escrito (e2e/wallet-mensajeros.spec.ts; convencion del repo: no se corre).
- [x] Tabla nueva con RLS habilitada sin policies anon/authenticated (R24).
- [x] Migracion aditiva con down.sql reversible (R25) + verificacion estatica.
- [x] Sin secretos hardcodeados.
- [x] Capas separadas (Controller/Service/Repository + interfaces en lib/interfaces/).
- [x] Paginas validan rol server-side; componentes reciben datos por props (STRING); Server Action.
- [x] Moneda: colon unico (A4), simbolo en labels de presentacion (patron 42/43).

---

## FOCOS money-critical (verificados)

- Cuadre del egreso Qa (R15/R17): WalletMensajeroFeedService emite egreso_pago_mensajero = P en
  la caja 42 SOLO si P>0, un unico egreso por cierre; se inserta con el repo de la 42 (constraint
  (origen_tipo, origen_id, categoria) -> idempotente). El feed test verifica Sigma(egreso 42) =
  Sigma(pago_devengado) = Sigma(total_pago_mensajero). La liquidacion futura (Qf) NO re-emite
  egreso (reservada). Correcto.
- Atomicidad (R7): el enganche en CierresAdminRepository.resolverCierre inserta libro 44 + egreso
  42 DENTRO de la misma $transaction, TRAS 42/43, solo si res.count===1 y nuevoEstado=aprobado.
  Test de rollback: fallo del insert del libro 44 -> revierte TODO (incl. 42/43). Correcto.
- min(P,E) y bordes (R9/R10/R13): calcularSplitPago PURA con Prisma.Decimal. Tests E>=P / E<P /
  E=0 / P=0 (sin movimiento ni egreso) + netting POR CIERRE. Correcto.
- Saldo derivado (R14): agregarCuentaPorPagar (groupBy tipo) + derivarCuentaPorPagar; sin saldo
  almacenado. Correcto.
- Inmutabilidad (R3): modelo sin updatedAt/deletedAt; repo sin update/delete; ajuste
  compensatorio. Correcto.
- Money STRING (R4/R27): DTOs STRING; satisfies exhaustivo contra enums Prisma; grep limpio.
- Idempotencia (R6/R12): indice unico parcial (origen_tipo, origen_id, mensajero_id, categoria)
  WHERE origen_id IS NOT NULL + createMany skipDuplicates. Tests: doble alimentacion = un set;
  dimension mensajero_id separa mensajeros; manuales (origen NULL) no deduplican. Correcto.
- RLS (R24): ENABLE ROW LEVEL SECURITY sin CREATE POLICY. Verificado en migration.sql y test.
- Acotado por rol (R19/R20): maestro no acotado + forbidden por rol; mensajero acotado a su
  mensajero_id SIEMPRE en el WHERE (no en memoria); input mensajeroId ignorado en vista propia;
  adminSatelite -> forbidden. Verificado en service/repo/action/page.

---

## Trazabilidad R -> test (verificada por el reviewer)

| Req | Test | Estado |
| --- | --- | --- |
| R1  | wallet-mensajero-feed-service.test.ts + schema (sin updatedAt/deletedAt) | OK |
| R2  | pago-mensajero-movimiento-repository.test.ts (persiste campos) | OK |
| R3  | wallet-mensajero-service.test.ts + pago-mensajero-idempotencia.test.ts (manual no dedup) | OK |
| R4  | cuenta-por-pagar.test.ts (Decimal, STRING 2dec) | OK |
| R5  | cierres-admin-repository.test.ts + cierres-admin-service.test.ts | OK |
| R6  | pago-mensajero-idempotencia.test.ts + migration (unique parcial) | OK |
| R7  | cierres-admin-repository.test.ts (fallo del libro 44 -> rollback total) | OK |
| R8  | wallet-mensajero-feed-service.test.ts (un findUnique, no re-deriva) | OK |
| R9  | cuenta-por-pagar.test.ts + feed (min(P,E)) | OK |
| R10 | feed (P>0/pagado>0/P=0) | OK |
| R11 | cierres-bodega-admin-service.test.ts (bodega sin feed pago mensajero; estructural) | OK |
| R12 | pago-mensajero-idempotencia.test.ts + repo (vencido una vez) | OK |
| R13 | feed (netting por cierre) | OK |
| R14 | cuenta-por-pagar.test.ts + repo agregarCuentaPorPagar | OK |
| R15 | feed (invariante por-cierre + Sigma devengo=Sigma snapshot + egreso 42 cuadra) | OK |
| R16 | cuenta-por-pagar.test.ts + service (positivo/cero, STRING) | OK |
| R17 | feed (egreso P) + cierres-admin-repository.test.ts (crearMovimientos x2) + migration | OK |
| R18 | wallet-mensajeros-page.test.tsx + wallet-mensajero-service.test.ts | PARCIAL: solo agregado por mensajero; falta desglose POR CIERRE paginado -> BLOQUEANTE |
| R19 | service + action + page (maestro no acotado; otro rol forbidden/notFound) | OK |
| R20 | service + repo (WHERE) + mis-pagos-page.test.tsx | OK |
| R21 | wallet-mensajeros-page.test.tsx + mis-pagos-page.test.tsx (props STRING) | OK |
| R22 | wallet-mensajero-service.test.ts (solo vista MENSAJERO) | PARCIAL: en la vista del maestro solo filtro client-side por nombre; faltan filtros server-side fecha/cierre -> BLOQUEANTE |
| R23 | pago-mensajero-liquidacion.test.ts (liquidacion + origen reservados; acto ausente) | OK |
| R24 | pago-mensajero-movimiento-migration.test.ts (RLS sin policies) | OK |
| R25 | idem (down reversible; enum 42 intacto) | OK |
| R26 | idem (2 indices + unique parcial) | OK |
| R27 | transversal STRING en *-actions.test.ts + DTOs + grep limpio | OK |

---

## Hallazgos

### BLOQUEANTE 1 — R18: la vista del maestro NO muestra el DESGLOSE por cierre, paginado, mas reciente primero

R18 (firme, [F1.4-Qe] APROBADA) exige que el maestro vea, por mensajero, total_devengado /
total_pagado / cuenta_por_pagar Y el DESGLOSE por cierre, paginado, mas reciente primero.

Lo implementado:
- listarCuentasPorPagarAction devuelve SOLO el AGREGADO por mensajero (listarCuentasPorPagarTodos
  -> una fila por mensajero, sin movimientos por cierre).
- WalletMensajeroService.listarCuentasPorPagar(actor:maestro) no expone desglose por cierre. El
  unico metodo que lista movimientos por cierre (repo.listarPorMensajero) esta en listarMisPagos,
  GATED a actor.rol === 'mensajero': el maestro no puede invocarlo.
- El componente del maestro DesglosePagosMensajero.tsx (fila expandible) muestra el split del
  AGREGADO (devengado/pagado/pendiente), NO una lista de movimientos por cierre. Su comentario lo
  reconoce: "el desglose por cierre requeriria una Server Action del maestro que hoy no existe".
- El test que declara cubrir R18 (wallet-mensajeros-page.test.tsx + service test) solo verifica el
  agregado por mensajero y props STRING; NINGUN test asserta un desglose por cierre para el maestro
  (porque no existe) -> requisito sin test que lo verifique.

Impacto money-critical: el maestro no puede auditar QUE cierres/fechas componen la cuenta por
pagar de cada mensajero (base para la futura liquidacion). Es el entregable central de la pantalla.

Nota SDD: design.md etiqueto el desglose por cierre como "(opcional)", pero el design NO puede
degradar un requisito FIRME; R18 no fue amendado en la puerta F1.4. El requisito manda.

Para cumplir (vuelve al implementer):
1. WalletMensajeroService: metodo del maestro (p.ej. listarPagosDeMensajero(mensajeroId, filtros,
   actor)) gated a maestro, que delegue en repo.listarPorMensajero({ mensajeroId, page, pageSize,
   cierreId, desde, hasta }) (el repo YA lo soporta; su firma acepta un mensajeroId arbitrario y
   ordena fechaMovimiento desc).
2. Server Action del maestro (p.ej. listarPagosDeMensajeroAction) con zod para mensajeroId +
   filtros (el schema listarPagosMensajeroSchema YA declara mensajeroId), montos STRING.
3. Frontend /wallet/mensajeros: al expandir un mensajero, renderizar el desglose por cierre
   paginado (mas reciente primero) desde la nueva action.
4. Tests que asserten el desglose por cierre del maestro (page/integration + service).

### BLOQUEANTE 2 — R22: la vista del maestro carece de filtros server-side por fecha/cierre

R22 (firme) exige filtrar el desglose por rango de fechas, por cierre y/o por mensajero EN LA
VISTA DEL MAESTRO, con el saldo reflejando el conjunto filtrado.

Lo implementado:
- La vista del maestro solo tiene filtro CLIENT-SIDE por NOMBRE de mensajero
  (CuentasPorPagarFiltros.tsx). No hay filtro server-side por fecha ni por cierre; y al no existir
  el desglose por cierre (Bloqueante 1) no hay nada por cierre que filtrar ni saldo que recalcule
  el conjunto filtrado. Los propios componentes lo reconocen en comentarios.
- El unico test de R22 (wallet-mensajero-service.test.ts) cubre listarMisPagos de la vista
  MENSAJERO, no la del maestro -> la parte "en la vista del maestro" queda sin test.

Para cumplir: la misma Server Action/servicio del Bloqueante 1 debe aceptar desde/hasta/cierreId y
aplicarlos en el WHERE (el repo YA lo construye via buildFiltrosWhere); el saldo del conjunto
filtrado se deriva con esos mismos filtros (agregarCuentaPorPagar(mensajeroId, filtros), ya
existente). Wire de UI (controles fecha/cierre) + tests del maestro.

Nota: R18 y R22 comparten UNA MISMA raiz: falta la Server Action + metodo de servicio del maestro
que exponga listarPorMensajero (desglose por cierre paginado) con filtros fecha/cierre. El repo y
el schema zod YA lo soportan; falta la capa service/action del maestro y el wire de UI + tests.

### menor 1 — tasks.md con T0 y T20 sin marcar

T0 (puerta F1.4) y T20 (typecheck/lint/test + PR) siguen [ ]. T0 esta sustancialmente hecho (F1.4
registrada); T20 es el paso de git/PR del leader. CHECKPOINTS pide "todas las tasks [x]". No afecta
el codigo.

### menor 2 — E2E no ejecutado

e2e/wallet-mensajeros.spec.ts esta escrito pero no se corre (convencion del repo, igual que 42/43).
Al agregar el desglose por cierre del maestro, extender el E2E para ejercerlo.

---

## Cierre

Reabrir para el implementer (backend + frontend) SOLO la vista del maestro: exponer el desglose
por cierre paginado (R18) y los filtros server-side fecha/cierre (R22), con sus tests. El resto de
la feature (backend money-critical, migracion/RLS/idempotencia, vista del mensajero /mis-pagos,
egreso Qa en caja 42, control de acceso) esta correcto y verde.

---

## RE-REVIEW (fix R18/R22) — 2026-07-13

Re-revision ENFOCADA tras el ciclo de correccion. Se verifican SOLO los 2 bloqueantes previos
(R18/R22, misma raiz: faltaba la capa service+action del maestro para el desglose por cierre +
filtros) y que el fix no rompio nada. Worktree aislado `R:/ark-studio/projects/ricardo/ordenex-f44`;
verificacion estatica de la DB (no se muto la DB local compartida).

### VEREDICTO: APROBADO

Ambos bloqueantes CERRADOS con codigo + test que los cubre. Sin regresion. Suite completa verde.

### BLOQUEANTE 1 — R18 (desglose por cierre del maestro): CERRADO

- Backend: `WalletMensajeroService.listarPagosDeMensajero(input, actor)` (nuevo) gateado a
  `maestro` (`actor.rol !== 'maestro' -> { status: 'forbidden' }` ANTES de tocar el repo); NO
  acota al actor: usa `input.mensajeroId`. Delega en `repo.listarPorMensajero` (paginado,
  `orderBy fechaMovimiento desc`) + `agregarCuentaPorPagar` + `obtenerNombreMensajero`.
- Interfaz `IWalletMensajeroService` + tipo `ListarPagosDeMensajeroResult` (lleva
  `mensajeroId`/`mensajeroNombre`, montos STRING).
- Server Action `listarPagosDeMensajeroAction` (`lib/actions/wallet-mensajero.ts`) con
  `listarPagosDeMensajeroSchema` (deriva del base y hace `mensajeroId` REQUERIDO); `mensajeroId`
  faltante/vacio -> `validation_error` en el borde sin tocar el service.
- Frontend: `DesglosePagosMensajero.tsx` (nuevo) se monta al EXPANDIR la fila del mensajero
  (`CuentasPorPagarTable.tsx` L132, boton `aria-expanded`), carga via SWR sobre esa action el
  desglose por cierre paginado, mas reciente primero (el backend ya lo devuelve desc). Montos
  STRING renderizados tal cual con `money`.
- Tests que ahora lo cubren:
  - `tests/unit/services/wallet-mensajero-service.test.ts` — "R18: el maestro obtiene el DESGLOSE
    por cierre de un mensajero ARBITRARIO (del input, no de si mismo), paginado" + "R19: rol NO
    maestro -> forbidden, sin tocar el repo".
  - `tests/unit/actions/wallet-mensajero-actions.test.ts` — bloque `listarPagosDeMensajeroAction
    (R18/R22/R27)`: unauthenticated, `mensajeroId` faltante/vacio -> validation_error, forbidden,
    y ok con montos STRING.
  - `tests/integration/wallet-mensajeros-page.test.tsx` — `DesglosePagosMensajero — desglose por
    cierre del maestro (R18)`: "al expandir carga el desglose por cierre paginado, mas reciente
    primero" (asserta el orden desc de las filas).

### BLOQUEANTE 2 — R22 (filtros server-side del maestro): CERRADO

- `listarPagosDeMensajero` acepta `desde/hasta/cierreId` y los pasa al repo tanto en el listado
  (`listarPorMensajero`) como en el saldo (`agregarCuentaPorPagar`); el repo los aplica en el
  WHERE via `buildFiltrosWhere`. El saldo mostrado = `result.data.cuenta` (conjunto FILTRADO).
- Frontend: `DesglosePagosMensajero` expone controles de filtro (cierre + rango de fechas); al
  aplicar, invoca la action con esos params, vuelve a page 1 y el saldo sale de `data.cuenta`.
- Tests que ahora lo cubren:
  - `tests/unit/services/wallet-mensajero-service.test.ts` — "R22: aplica los filtros fecha/cierre
    en el WHERE (listado) Y en la cuenta (conjunto filtrado)" (asserta
    `agregarCuentaPorPagar('m9', { cierreId, desde, hasta })`).
  - `tests/integration/wallet-mensajeros-page.test.tsx` — `DesglosePagosMensajero — filtros
    server-side fecha/cierre (R22)`: "aplica los filtros invocando la action con cierreId/desde/
    hasta y vuelve a la pagina 1" + "el saldo mostrado refleja el CONJUNTO FILTRADO
    (result.data.cuenta), no el agregado" (₡2000.00 agregado -> ₡1500.00 filtrado).

### Money-critical / no-regresion (verificado)

- Gate de seguridad: el metodo del maestro devuelve `forbidden` para mensajero/adminSatelite/tienda
  ANTES de tocar el repo (`repo.listarPorMensajero`/`agregarCuentaPorPagar` NO se invocan). Un rol
  no-maestro NO puede leer datos de ningun mensajero.
- Money STRING: grep `parseFloat`/`Number(`/`.toNumber(` sobre los 6 fuentes tocados por el fix
  (service/action/repo/types/2 componentes) = solo comentarios, cero uso real.
- Sin regresion: cierres (enganche `resolverCierre`), idempotencia, migracion/RLS y la vista del
  mensajero `/mis-pagos` verdes en aislado (5 archivos, 74 tests). El feed/egreso Qa en caja 42 y
  el resto del backend money-critical siguen intactos (ya APROBADOS en la 1a revision, sin cambio).

### Estado de la suite (RE-REVIEW, verificado por el reviewer)

- `pnpm run typecheck`: 0 errores.
- `pnpm run lint`: 0 errores, 135 warnings (TODOS en `.claude/skills/impeccable/scripts/*.mjs`
  pre-existentes; ninguno en archivos de la 44).
- `pnpm test`: 242 archivos, 2191 tests, 242/2191 passed (exit 0). +14 tests vs la 1a revision
  (2177), consistente con los nuevos tests del desglose+filtros del maestro. El flaky ajeno
  `OrdenesModuleReuse.test.tsx` paso en esta corrida; no es regresion.

### Trazabilidad actualizada

- R18: OK (antes PARCIAL) — `wallet-mensajero-service.test.ts` + `wallet-mensajero-actions.test.ts`
  + `wallet-mensajeros-page.test.tsx` asertan el desglose por cierre del maestro (orden desc) y el
  forbidden por rol.
- R22: OK (antes PARCIAL) — mismos test files asertan filtros en el WHERE y saldo del conjunto
  filtrado en la vista del MAESTRO (ademas de la vista mensajero ya cubierta).

### Menores pendientes (NO bloqueantes)

- menor 1: tasks.md T0 (puerta F1.4, sustancialmente hecha) y T20 (git/PR del leader) siguen `[ ]`.
- menor 2: `e2e/wallet-mensajeros.spec.ts` escrito, no ejecutado (convencion del repo, igual 42/43).

Ningun bloqueante NUEVO. La feature 44 queda APROBADA.
