# Review â€” Feature 102 Â· Ingreso de bodega por rechazos SLA visible + aviso a tienda/bodega

Rol: reviewer. Rama feature/102-rechazos-sla-visible vs origin/dev. NO se edito codigo. Fecha: 2026-07-22.

## Veredicto global: APROBADO

Sin hallazgos MAYORES (bloqueantes). Los 18 requisitos mapean a un test real que se ejerce y pasa.
typecheck/lint verdes; suite completa verde salvo 3 flakies de timeout conocidos (verificados en aislado).
Trabajo aun SIN commitear (working tree) â€” commit + PR pendientes (proceso, no defecto).

## Checklist CHECKPOINTS.md

- [x] requirements.md (R1-R18 EARS), design.md (alternativas descartadas seccion 7), tasks.md.
- [x] tasks.md: T1-T14 en [x]. T0 (gate) resuelto con defaults Q1-Q4. T15 en [ ] = task de
      verificacion/bitacora final; su contenido esta cumplido; se marca al cierre. No bloqueante.
- [x] Cada R<n> -> >=1 test concreto (tabla abajo). progress/impl_102.md trae el mapa R->test.
- [x] pnpm typecheck sin errores. pnpm lint 0 errores (143 warnings preexistentes, ninguno en 102).
- [x] pnpm test: 4099 passed / 3 failed = SOLO flakies conocidos (timeout), verdes en aislado.
- [x] Flujo critico (recaudo/cierres): E2E existe (e2e/cierres-admin-rechazos-sla.spec.ts, no corre en
      CI por deuda de harness) + cobertura EJECUTABLE de R8/R9 en componente.
- [x] Datos/seguridad: SIN tabla nueva -> RLS N/A. SIN migracion -> down.sql N/A. Sin secretos. Sin webhooks.
- [x] Capas: Repository solo Prisma; Service sin HTTP (repo por constructor); Server Action lee sesion y
      delega; interfaces en lib/interfaces/{services,repositories}.
- [x] Permisos: /novedades Server Component valida adminTienda server-side (notFound); componentes
      privados por props; lectura interna por Server Action (no fetch a /api).
- [x] Config: el simbolo de colon es la convencion uniforme del repo (PriceLabel/money), no hardcode nuevo.
- [ ] ./init.sh verde de punta a punta: sus gates (una-feature-por-zona: solo 102 in_progress; specs
      presentes; typecheck/lint/test) se verificaron por separado y pasan. pnpm test termina con
      ELIFECYCLE por los 3 flakies bajo carga -> init.sh cortaria por ese rojo transitorio, NO por la feature.
- [ ] progress/review_102.md: este archivo (OK). progress/history.md: pendiente (leader).

## Gate F1.4 (visibilidad derivada) â€” cumplido

- SIN migracion / SIN cambio de schema: git diff origin/dev...HEAD -- db/ VACIO; sin archivos nuevos bajo
  db/. no-migration-102.test.ts afirma schema/migraciones sin conceptos prohibidos.
- Clasificacion SLA derivada del join orden_historial_estado.origen_tipo=escalado_devuelta_sla (constante
  unica ORIGEN_TIPO_RECHAZO_SLA), reusada por CierresAdminRepository y OrdenRepository.
- Q1 monto tienda = ingreso_bodega_rechazo (56); Q2 null->Pendiente de cierre; Q3 pestana en /novedades
  (NovedadesTabs, sin item de menu); Q4 subtotal SLA solo en el DETALLE. Todas OK.

## No mueve dinero (R6/R16)

Solo lectura: verCierreDetalle LEE el snapshot (total = cierre.totalIngresoBodegaRechazos, no recomputa),
no abre transaccion de escritura ni invoca resolverCierre. Tests: R6 (totales recibido/pago mensajero/56
intactos) y R16 (no invoca resolverCierre -> sin wallet/caja). El carril de tienda es count/findMany puros.

## Money-safe (R4/R5/R14/R18)

Sumas con Prisma.Decimal; salida toFixed(2) STRING. Grep de parseFloat / Number / parseInt en archivos
nuevos/tocados: unico match es un COMENTARIO, sin codigo money-unsafe. DTOs 100% serializables (sin
Prisma.Decimal/Date). Identidad sla + manual === total afirmada en util y service (caso consistente).

## R10 (adminSatelite) â€” adjudicado GENUINAMENTE satisfecho

/cierres-admin renderiza CierresAdminModule para TODO rol autorizado, incluido adminSatelite (page.tsx L87,
no condicional). Su Ver/decidir abre verCierreDetalle, que para adminSatelite resuelve alcance satelite
server-side y devuelve desgloseIngresoBodegaRechazos (test R10: scope bodega_satelite + destinoZonaId). Es
EXACTAMENTE la superficie que R10 nombra. El panel AGREGADO de zona (ConsolidacionBodegaModule ->
totalIngresoBodegaRechazosAgregado, ICierreBodegaService) muestra solo el total combinado, sin split â€”
consistente con Q4 y con la letra de R10. NO hay hueco.

## Autorizacion (R13)

RechazosSlaTiendaService corta por rol ANTES de tocar el repo (rol != adminTienda -> forbidden) y acota
SIEMPRE a actor.usuarioId. Tests: mensajero/adminSatelite/maestro -> forbidden sin consultar el repo;
count/find con tiendaId del actor. rechazoSlaWhere fija tiendaId, deletedAt:null, estatus.value=rechazada,
historialEstados.some(origen SLA); count y find comparten el MISMO where (R15).

## Tabla R<n> -> test

| R | Test(s) | Estado |
| --- | --- | --- |
| R1  | rechazo-sla-flag.test.ts + cierres-admin-repository.test.ts (102/R1) | OK |
| R2  | rechazo-sla-flag.test.ts (manual+ingreso!=0 -> false) | OK |
| R3  | no-migration-102.test.ts + git diff db/ vacio | OK |
| R4  | desglose-rechazos-sla.test.ts (particion STRING escala 2) | OK |
| R5  | desglose-rechazos-sla.test.ts + cierres-admin-service.test.ts (R5) | OK |
| R6  | cierres-admin-service.test.ts (R6: total=snapshot, totales intactos) | OK |
| R7  | cierres-admin-service.test.ts (R7: estable, sin resolver tarifa) | OK |
| R8  | cierres-admin-service.test.ts (R8) + CierresAdminModule.test.tsx (102/R8) | OK |
| R9  | CierresAdminModule.test.tsx (102/R9 EJECUTABLE) + service (R9) + e2e (no CI) | OK |
| R10 | cierres-admin-service.test.ts (R10: adminSatelite mismo desglose, alcance satelite) | OK |
| R11 | cierre-dia-service.test.ts (R11: sin desglose; esRechazoSla=false) | OK |
| R12 | rechazos-sla-tienda-service.test.ts + orden-repository.rechazos-sla.test.ts | OK |
| R13 | rechazos-sla-tienda-service.test.ts (otros roles -> forbidden; acota a tiendaId) | OK |
| R14 | orden-repository.rechazos-sla.test.ts + RechazosSlaModule.test.tsx | OK |
| R15 | orden-repository.rechazos-sla.test.ts (mismo where count/find) + service (vacia) | OK |
| R16 | cierres-admin-service.test.ts (R16: no invoca resolverCierre) | OK |
| R17 | no-migration-102.test.ts (sin modelo/enum/tabla de notificacion) | OK |
| R18 | asserts de tipo STRING en util/repo/service/componentes (transversal) | OK |

Cobertura: 18/18.

## Hallazgos

- menor â€” R5/R6, CierresAdminService.ts (~L161-166): el service devuelve total = snapshot mientras
  sla/manual se computan de found.gestiones; no hay asercion en runtime de sla+manual===total. En
  produccion coinciden por invariante de 56; en dato inconsistente (el propio test R6 fuerza 7.00 vs 5.00)
  el DTO mostraria sla+manual != total. Aceptable por diseno (R6 manda no recomputar). No bloqueante.
- menor (informativo) â€” R10, ConsolidacionBodegaModule: el panel AGREGADO de zona no incluye el split
  SLA/manual (solo el total). Esperado por Q4 y por la letra de R10 (anclado a verCierreDetalle).
- menor (proceso) â€” feature SIN commitear (working tree; 0 commits sobre origin/dev). Falta commit(s),
  entrada en progress/history.md y reejecutar ./init.sh estable antes del PR.

## Verificacion ejecutable

- pnpm typecheck -> OK (0 errores).
- pnpm lint -> 0 errores, 143 warnings preexistentes, ninguno en archivos de la feature 102.
- Targeted feature 102 (9 archivos) -> 177 passed.
- pnpm test (suite completa) -> 4099 passed / 3 failed. Los 3 = flakies conocidos (HomePage, HomePageRol,
  OrdenesModuleReuse), todos Test timed out in 5000ms. Reconfirmados VERDES en aislado (7/7). NO bloqueante.
