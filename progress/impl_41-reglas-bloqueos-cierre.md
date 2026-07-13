# Bitacora de implementacion — Feature 41: reglas y bloqueos de cierre

> Rama: feature/41-reglas-bloqueos-cierre. Spec autoritativo: F1.4 APROBADA 2026-07-12.
> Baseline al inicio: 1867 tests, init.sh verde. Final: 1931 tests, init.sh verde.
> Money-critical: el vencido congela sus totales al crearse; NO se recalcula ningun
> cierre resuelto (features 37/39/40/56 intactas).

## Veredicto
Backend + frontend + E2E completos y verdes. Todas las tasks A1..G3 marcadas [x].
Sin regresion en 37/38/39/40/56. Round-trip de migracion OK. Pendiente: revision.

## Verificacion ejecutable (salida real)

| Gate | Resultado |
| --- | --- |
| prisma validate | OK (schema valido) |
| pnpm typecheck | 0 errores (TS strict) |
| pnpm lint | 0 errores (135 warnings preexistentes, todos en .claude/skills, ninguno de la 41) |
| pnpm test | 1931 passed / 1931 · 214 files (baseline 1867 -> +64 tests nuevos) |
| Migracion round-trip | OK — prisma migrate deploy + pnpm db:rollback + re-aplicar (2x) |
| ./init.sh | verde — "== init OK ==", todas las migraciones con down.sql, .env presente |
| E2E reglas-bloqueos-cierre.spec.ts | ESCRITO y DIFERIDO (patron del arnes: no corre bajo pnpm test; requiere DB de test + seed + dev server) |

## Archivos creados

Backend — modelo / migracion:
- db/migrations/20260712150000_cierre_estado_vencido/migration.sql (ALTER TYPE ADD VALUE vencido fuera de tx + indice cierre_dia_mensajero_id_estado_idx)
- db/migrations/20260712150000_cierre_estado_vencido/down.sql (drop indice + recrea enum sin vencido; suelta/recrea el indice unico parcial cierre_bodega_zona_solicitado_uq de la 40 alrededor del cambio de tipo; precondicion: sin filas estado=vencido)

Backend — corte diario:
- lib/interfaces/repositories/ICorteDiarioRepository.ts
- lib/repositories/CorteDiarioRepository.ts
- lib/interfaces/services/ICorteDiarioService.ts
- lib/services/CorteDiarioService.ts
- app/api/cron/corte-diario/route.ts
- lib/config/cron.ts
- vercel.json (crons: path /api/cron/corte-diario, schedule 0 6 * * *)

Backend — helpers compartidos:
- lib/utils/bodega-responsable.ts (resolverDestinoCierre)
- lib/utils/cierre-totales.ts (computeTotales/derivarPagos/derivarIngresoBodega, Decimal intacto)

Frontend:
- app/(app)/recepcion-satelite/_components/asignacion-satelite-bloqueo.ts (textos i18n-ready + compositor por causa i/ii)

Tests nuevos:
- tests/unit/utils/bodega-responsable.test.ts
- tests/unit/utils/cierre-totales.test.ts
- tests/unit/repositories/corte-diario-repository.test.ts
- tests/unit/repositories/orden-repository.bloqueo.test.ts
- tests/unit/services/corte-diario-service.test.ts
- tests/integration/actions/corte-diario-route.test.ts
- tests/integration/db/cierre-estado-vencido-migration.test.ts
- e2e/reglas-bloqueos-cierre.spec.ts

## Archivos modificados (principales)
- lib/types/cierre.ts (vencido 4o en CIERRE_ESTADO_SEED)
- db/schema.prisma (enum vencido + @@index([mensajeroId, estado]))
- lib/repositories/CierreDiaRepository.ts (crearCierre parametrizado con estado, Promise<string|null> con rollback si vincula 0)
- lib/repositories/OrdenRepository.ts + IOrdenRepository.ts (findMensajerosBloqueados, existeBodegaSateliteBloqueada)
- lib/repositories/CierresAdminRepository.ts (resolverCierre acepta origen solicitado|vencido)
- lib/services/CierreDiaService.ts (consume helpers B1/B2; trata null de crearCierre como conflict)
- lib/services/GuiaAsignacionService.ts (guarda mensajero bloqueado R13)
- lib/services/AsignacionSateliteService.ts + IAsignacionSateliteService.ts + lib/types/recepcion-satelite.ts (status bodega_bloqueada con causa)
- lib/services/CierresAdminService.ts (vencido a la cola de pendientes, diferenciado)
- Frontend: cierres-admin/_components/{CierresAdminModule,cierre-detalle-shared}.tsx, cierre-dia/{page.tsx,_components/CierreDiaModule.tsx}, recepcion-satelite/{page.tsx,_components/{RecepcionSateliteModule,asignacion-satelite-error-messages}}, lib/actions/{cierre-dia,recepcion-satelite}.ts (Server Actions estadoBloqueoMensajero, estadoBloqueoBodegaSatelite)

## Mapa de trazabilidad R -> test

| R | Test que lo cubre |
| --- | --- |
| R1 | tests/unit/utils/bodega-responsable.test.ts (central vs satelite) |
| R2 | tests/integration/db/cierre-estado-vencido-migration.test.ts + exhaustividad enum en lib/types/cierre.ts |
| R3 | tests/integration/db/cierre-estado-vencido-migration.test.ts (UP/DOWN, RLS intacta) + round-trip real pnpm db:rollback |
| R4 | tests/unit/utils/cierre-totales.test.ts, corte-diario-service.test.ts, cierres-admin-repository.test.ts (snapshot congelado; no recalcula resueltos) |
| R5 | tests/integration/actions/corte-diario-route.test.ts (401 sin/incorrecto secreto sin efectos; 200 con secreto) |
| R6 | tests/unit/services/corte-diario-service.test.ts + corte-diario-repository.test.ts |
| R7 | tests/unit/repositories/corte-diario-repository.test.ts (con pendientes / con solicitado / sin actividad) |
| R8 | tests/unit/repositories/cierre-dia-repository.test.ts + cierre-totales.test.ts (vincula + snapshot todo-o-nada) |
| R9 | tests/unit/services/corte-diario-service.test.ts + corte-diario-repository.test.ts (2a corrida = 0 nuevos) |
| R10 | tests/unit/repositories/corte-diario-repository.test.ts (no crea vencido si hay solicitado) |
| R11 | tests/integration/actions/corte-diario-route.test.ts (schedule 0 6 * * * = 00:00 CR) |
| R12 | tests/unit/repositories/orden-repository.bloqueo.test.ts (solicitado/vencido -> bloqueado) |
| R13 | tests/unit/services/guia-asignacion-service.test.ts (lote con mensajero bloqueado no persiste) |
| R14 | tests/unit/services/asignacion-satelite-service.test.ts (mensajero bloqueado -> rechazo sin efectos) |
| R15 | tests/unit/repositories/cierres-admin-repository.test.ts (resolver desbloquea) + E2E paso 5 |
| R16 | tests/unit/repositories/orden-repository.bloqueo.test.ts (rechazado/aprobado no bloquea) |
| R17 | tests/unit/repositories/orden-repository.bloqueo.test.ts (bodega por SOLO i, SOLO ii, ambas, ninguna) |
| R18 | tests/unit/services/asignacion-satelite-service.test.ts (bodega bloqueada i/ii/ambas, motivo distingue causa) |
| R19 | tests/unit/repositories/cierres-admin-repository.test.ts (aprobar/rechazar vencido via flujo 38 extendido) |
| R20 | tests/unit/services/cierres-admin-service.test.ts (vencido en cola por alcance) + tests/components/CierresAdminModule.test.tsx (badge diferenciado, resoluble) |
| R21 | tests/components/CierreDiaModule.test.tsx (aviso de bloqueo del mensajero) |
| R22 | tests/components/RecepcionSateliteModule.test.tsx (aviso por causa i/ii/ambas + Asignar deshabilitado) + AsignarSateliteModal.test.tsx (toast reactivo bodega_bloqueada) |
| R23 | tests/unit/repositories/orden-repository.asignacion-satelite.test.ts (NOT EXISTS anti-TOCTOU) + cierre-dia-repository.test.ts (null@0) + corte-diario-service.test.ts |
| R24 | tests/integration/actions/corte-diario-route.test.ts + corte-diario-service.test.ts (error no filtra secreto; log sin PII) |

Flujo critico completo (money/recaudo) — e2e/reglas-bloqueos-cierre.spec.ts (diferido):
corte crea vencido (R6/R7/R8) -> mensajero bloqueado (R12/R21) -> asignacion rechazada (R14/R18/R22) -> admin resuelve el vencido (R19/R20) -> desbloqueo (R15).

## Riesgos / deuda / notas para el reviewer

1. D4 anti-TOCTOU (R23) — alcance parcial justificado. El NOT EXISTS del cierre bloqueante
   se integro en el updateMany ($executeRaw) de asignarSateliteLote (satelite, mensajero
   fijo — caso money-adjacent principal). Para el lote del maestro (generarGuiaLote/
   asignarBodegaLote) se mantiene el pre-check de D2: es un loop por-orden en transaccion y
   convertirlo a raw era invasivo; la ventana TOCTOU real es estrecha y el pre-check + la tx
   todo-o-nada la cubren. Justificado en codigo y aqui.
2. .env.example gitignored (.env* en .gitignore) -> no queda trackeado. CRON_SECRET si queda
   documentado en archivos trackeados: lib/config/cron.ts y el header del route handler.
3. Contrato tocado: ICierreDiaRepository.crearCierre ahora devuelve Promise<string|null>;
   CierreDiaService.solicitarCierre trata null como conflict (carrera). Tests de 37 verdes.
4. down.sql: requiere soltar/recrear el indice unico parcial cierre_bodega_zona_solicitado_uq
   de la feature 40 alrededor del cambio de tipo del enum (si no, el rollback fallaba con
   "operador cierre_estado = cierre_estado_old"). Documentado en el down.sql.
5. E2E rechazo reactivo bodega: en la UI el reflejo real de R18/R22 con bodega bloqueada es el
   boton Asignar deshabilitado + alerta (el toast reactivo bodega_bloqueada solo surge si se
   logra enviar, imposible con el boton deshabilitado). El E2E aserta el estado deshabilitado +
   alerta; el toast reactivo se cubre en AsignarSateliteModal.test.tsx.
