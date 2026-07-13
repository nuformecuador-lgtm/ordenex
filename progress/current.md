# Sesión activa

> Estado vivo de lo que se esta trabajando ahora. El leader lo mantiene al dia.
> Al cerrar una feature, se limpia de aca y se resume en history.md.

## Features en curso

| Branch | Zona | Fase | Estado |
|--------|------|------|--------|
| _(ninguna en curso)_ | — | — | — |

> Feature 49 (trazabilidad / historial de estados) CERRADA 2026-07-13: **impl COMPLETA (R1–R34) + reviewer APROBADO 0 bloqueantes** (el reviewer reprodujo el grep de cobertura y el round-trip de migración). Segunda de la **Fase 2 flujo mensajero** (grupo 46/47/49), TRANSVERSAL. Verde: typecheck 0, lint 0, **2225/2225 tests (+85)**, `init.sh` OK, round-trip REAL. **CHOKE POINT único** `registrar-cambio-estado.ts` (`OrdenEstadoService`): append inmutable a `orden_historial_estado` en la MISMA `$transaction` que el cambio de estado. **11/11 puntos** de escritura de estado instrumentados (OrdenRepository #1–#6/#11, `asignarSateliteLote` #7 con `$queryRaw...RETURNING` conservando anti-TOCTOU, GestionOrdenRepository #8/#9, LiberacionReprogramadaRepository #10). Contador de intentos **DERIVADO** (la regla 3→rechazo es de la 47). UI drawer "Ver historial" por rol server-side (mensajero vía nuevo `OrdenDTO.mensajeroAsignadoId` opcional). Migración aditiva `20260713120000_orden_historial_estado` (+ RLS + down.sql). Rama nace del tip de la 46. Commit `faeeb2a` + cierre. Estado `done` + `history.md` + `review_49`. **DEUDA menor**: test de cobertura/RLS estáticos; E2E diferido. **PENDIENTE: sync con `dev` + PR + merge (OK humano).** Siguiente del grupo: **47** (reintentos/escalado, consume el derivador de intentos) → 48.

> Feature 46 (reprogramación: bloqueo + liberación programada) CERRADA 2026-07-13: **impl COMPLETA (R1–R21) + reviewer APROBADO 0 bloqueantes**. Primera de la **Fase 2 flujo mensajero** (grupo 46/47/49 elegido por el humano). Fullstack/high, un ciclo, rama desde `origin/dev`. Verde: typecheck 0, lint 0, **2056/2056 tests (+48)**, `init.sh` OK, round-trip de migración por SQL directo. **BLOQUEO server-side real** (`MSG_ORDEN_REPROGRAMADA_BLOQUEADA` en `GuiaAsignacionService`+`AsignacionSateliteService`, antes del check de origen; envío por origen en `MisAsignacionesService`): orden `reprogramada` con `fechaReprogramacion>hoy(CR)` no reasignable/enviable. **LIBERACIÓN**: cron NUEVO `/api/cron/liberar-reprogramadas` (auth `CRON_SECRET`, `0 6` diario=00:00 CR, hora CR UTC−6) → `en_bodega`/`en_bodega_satelite` derivado de zona (`findCentralZonaId`, reúsa 30/33); idempotencia DERIVADA del estatus + `orden.liberada_reprogramada_at`. **AVISO** = visibilidad derivada "liberadas hoy" en ambas bodegas (sin tabla). Migración aditiva `20260713100000_orden_liberada_reprogramada_at` (+ down.sql). R21 (contador/historial) FUERA DE ALCANCE = 47/49. Commit `a9fa3c8` + cierre. Estado `done` + `history.md` + `review_46`. **PR #51 abierto a `dev`** (tu merge). Siguiente del grupo: **49** (trazabilidad, base) → 47 → 48.

> Feature 46 (reprogramación: bloqueo + liberación programada) CERRADA 2026-07-13: **impl COMPLETA (R1–R21) + reviewer APROBADO 0 bloqueantes**. Primera de la **Fase 2 flujo mensajero** (grupo 46/47/49 elegido por el humano). Fullstack/high, un ciclo, rama desde `origin/dev`. Verde: typecheck 0, lint 0, **2056/2056 tests (+48)**, `init.sh` OK, round-trip de migración por SQL directo. **BLOQUEO server-side real** (`MSG_ORDEN_REPROGRAMADA_BLOQUEADA` en `GuiaAsignacionService`+`AsignacionSateliteService`, antes del check de origen; envío por origen en `MisAsignacionesService`): orden `reprogramada` con `fechaReprogramacion>hoy(CR)` no reasignable/enviable. **LIBERACIÓN**: cron NUEVO `/api/cron/liberar-reprogramadas` (auth `CRON_SECRET`, `0 6` diario=00:00 CR, hora CR UTC−6) → `en_bodega`/`en_bodega_satelite` derivado de zona (`findCentralZonaId`, reúsa 30/33); idempotencia DERIVADA del estatus + `orden.liberada_reprogramada_at`. **AVISO** = visibilidad derivada "liberadas hoy" en ambas bodegas (sin tabla). Migración aditiva `20260713100000_orden_liberada_reprogramada_at` (+ down.sql). R21 (contador/historial) FUERA DE ALCANCE = 47/49. Commit `a9fa3c8` + cierre. Estado `done` + `history.md` + `review_46`. **DEUDA menor**: E2E diferido; round-trip por test estático+SQL manual. Con la 43 ya mergeada a `dev` (PR #50), el drift ambiental del Postgres local queda resuelto. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** Siguiente del grupo: **49** (trazabilidad, base) → 47 → 48.

> Feature 43 CERRADA y **MERGEADA a `dev`** (PR #50) 2026-07-13. Ver `history.md`.

> Feature 43 (wallet por tienda: saldo a favor) CERRADA 2026-07-12: **impl COMPLETA (R1–R29) + reviewer APROBADO 0 bloqueantes**. Verde REAL: prisma OK, typecheck 0, lint 0, **2092/2092 tests (+84)**, `init.sh` OK, **round-trip de migración REAL por introspección**, **invariante de cuadre verificado a mano en AMBOS estados del flag**, idempotencia por constraint DB viva, SIN regresión 37/38/39/40/56/41/42. Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Wallet POR TIENDA = complemento del ingreso de Ordenex de la 42: **ledger propio** `wallet_tienda_movimiento` congelado al aprobar (reutiliza `derivarIngresoOrden`), crédito sobre COD recaudado (`montoRecibido`); `devuelta`/`rechazada` → la tienda debe el flete de devolución (saldo negativo) **REVERSIBLE** vía flag `TIENDA_DEBITA_FLETE_DEVOLUCION` (default true); alcance = modelo + visibilidad (`/mi-wallet` adminTienda + `/wallet/tiendas` maestro); pago a la tienda = follow-up. Estado `done` + `history.md` + `review_43`. Commit `6923a7b`. **DESBLOQUEA el pago a tiendas (follow-up).**

> Feature 42 (wallet: caja principal de Ordenex) CERRADA 2026-07-12: **impl COMPLETA (R1–R26) + reviewer APROBADO 0 bloqueantes** tras 1 ciclo (rechazo inicial por falta de E2E → añadido `e2e/wallet.spec.ts`). Verde REAL: prisma OK, typecheck 0, lint 0, **2008/2008 tests (+77)**, `init.sh` OK, **round-trip de migración REAL** contra Postgres local (incl. drop de `orden.cobra_comision` y 3 enums), **idempotencia por constraint DB verificada viva**, SIN regresión 37/38/39/40/56/41. Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Módulo WALLET = caja principal: **libro append-only inmutable** `wallet_movimiento`, **balance DERIVADO** (suma `Decimal`, sin saldo mutable), UI `/wallet` rol maestro + movimiento manual. Ingresos derivados de la tarifa AL APROBAR el `CierreDia` (movimiento=snapshot; enganche idempotente+atómico en `CierresAdminRepository.resolverCierre`), split `entregada`/devolución + **nueva columna `orden.cobra_comision`** (default true; poblarla por-orden = deuda A5); 6 categorías de ingreso; `CierreBodega` no re-cuenta. Estado `done` + `history.md` + `review_42`. Commits `a9769ea`+`f85ee42`+`1f9124b`. **RAÍZ de la cadena de pagos → DESBLOQUEA 43/44/45.** **PENDIENTE: abrir PR a `dev` + merge (OK humano).**

> Feature 41 (reglas y bloqueos de cierre: obligatoriedad, vencidos) CERRADA 2026-07-12: **impl COMPLETA (R1–R24) + reviewer APROBADO 0 bloqueantes** (verde REAL con round-trip de migración real contra Postgres —incl. recreación del uq de la 40—: prisma OK, typecheck 0, lint 0, **1931/1931 tests (+64)**, `init.sh` OK, **SIN regresión 37/38/39/40/56**). Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Corte diario **Vercel Cron** (`/api/cron/corte-diario`+`CRON_SECRET`, `0 6 * * *`=00:00 CR, idempotente) crea fila real `cierre_dia estado='vencido'` (snapshot+gestiones) para quien no cerró; **bloqueo DERIVADO** del mensajero (`solicitado`∨`vencido`) y de la satélite (**regla estricta Q4**: cierres de sus mensajeros ∨ su propio `CierreBodega solicitado`) en las guardas de asignación 17/30/34; `vencido` resoluble por la bodega vía feature 38 extendida. Enum `vencido` añadido (migración aditiva + down). Estado `done` + `history.md` + `review_41`. Commit `dde6fba`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA menor: TOCTOU residual en el lote del maestro (pre-check sin `NOT EXISTS`; el path satélite sí; justificado/no bloqueante) → follow-up; R23 sin test de carrera real; E2E diferido.

> Feature 56 (ingreso de bodega por rechazos, `cobroRechazado`) CERRADA 2026-07-12: **impl COMPLETA (R1–R22+R7b+R23) + reviewer APROBADO 0 bloqueantes** (verde REAL con round-trip de migración real: `prisma validate` OK, typecheck 0, lint 0, **1867 tests** —1 flaky ajeno `LoginForm`, pasa aislado—, `init.sh` OK, migración round-trip OK, **SIN regresión 37/38/39/40**). Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Espejo de la 39 para el otro lado: el `cobroRechazado` de una gestión `rechazada` es INGRESO PARA LA BODEGA (destino del cierre), no pago al mensajero; reusa `TarifaZonaMensajero`/`resolvePagoTarifa` sin modelo nuevo, **SNAPSHOT** al solicitar (migración aditiva `20260712140000_ingreso_bodega_rechazos` en 3 niveles; snapshot inmutable verificado). **Q6 RESOLVIÓ la deuda m1 de la 39**: flag `tarifaFaltante` server-side reemplaza la heurística frontend (sin falsos positivos en entregas de ₡0.00). Estado `done` + `history.md` + `review_56`. **IMPL EN 2 COMMITS** (el `implementer` murió por el bug opus-4.8[1m] tras el backend): backend `6a0153d` + UI `40d99e2` (frontend_dev directo). Cierra el par pago-por-zona (mensajero 39 + bodega 56). **PENDIENTE: abrir PR a `dev` + merge (OK humano).**

> Feature 39 CERRADA y **MERGEADA a `dev`** (PR #46) 2026-07-12. Cadena de cierres 37/38/40/39 completa en `dev`. Ver `history.md`.

> Feature 39 (pago al mensajero por zona en el cierre) CERRADA 2026-07-12: **impl COMPLETA (R1–R23+R7b) + reviewer APROBADO 0 bloqueantes** (verde REAL con round-trip de migración real: `init.sh` OK, typecheck 0, lint 0, **1829/1829 tests**, build OK, **SIN regresión 37/38/40**). Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Estado `done` + `history.md` + `review_39`. Pago vía `TarifaZonaMensajero` (zona+vehículo del mensajero, fallback tarifa por defecto), **SNAPSHOT** al solicitar (migración aditiva `20260712130000_pago_mensajero_cierre` en 3 niveles; snapshot inmutable verificado), **SOLO `entregada` paga**; `cobroRechazado`→bodega separado a la **feature 56**. Commit `941ea7c`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA menor: aviso tarifa-faltante por heurística frontend (candidato flag server-side).

> Feature 56 (ingreso de bodega por rechazos, `cobroRechazado`) REGISTRADA `pending` 2026-07-12 (`depends_on: 39`): separada de la 39 por decisión del humano — el pago por rechazo va a la bodega, no al mensajero.

> Feature 40 CERRADA y **MERGEADA a `dev`** (PR #45) 2026-07-12. Features 37/55/38 también mergeadas (#42/#43/#44). Ver `history.md`.

> Feature 40 (cierre de bodega satélite → central) CERRADA 2026-07-12: **impl COMPLETA (R1–R25+E2E) + reviewer APROBADO 0 bloqueantes** (verde REAL con verificación en DB VIVA: `init.sh` OK, typecheck 0, lint 0, **1797/1797 tests (+58)**, build pasa, migración round-trip real, RLS `cierre_bodega` sin policies, índice único parcial y FK verificados). Fullstack un ciclo; F1.4 aprobada 2026-07-12 (todas recomendadas). Estado `done` + `history.md` + `review_40`. Segundo nivel de cierre (doble espejo 37/38): tabla nueva `CierreBodega` (agrega `cierre_dia` `aprobado` de la zona, totales snapshot agregados, auditoría, índice único parcial ≤1 `solicitado`/zona) + FK `cierre_bodega_id` en `cierre_dia`. adminSatélite solicita / maestro aprueba-rechaza, en `/cierres-admin` extendido role-aware (regresión 37/38 intacta). Migración `20260712120000_cierre_bodega`. Commit `105689d`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** **DESBLOQUEA 41** (reglas/bloqueos/vencidos).

> Feature 38 CERRADA 2026-07-12 y **MERGEADA a `dev`** (PR #44). Ver `history.md`. Features 37 y 55 también mergeadas (PRs #42/#43).

> Feature 38 (admin: cierres del día, aprobar/rechazar) CERRADA 2026-07-12: **impl COMPLETA (R1–R17+E2E) + reviewer APROBADO 0 bloqueantes** (verde REAL verificado por el reviewer: `prisma validate` OK, `typecheck` 0, `lint` 0, **1739/1739 tests (+116)**, `init.sh` OK, migración round-trip OK). Fullstack un ciclo; F1.4 aprobada 2026-07-12 (todas recomendadas). Estado `done` + `history.md` + `review_38`. Módulo `/cierres-admin` (cola `solicitado` + histórico + detalle completo con evidencias firmadas + aprobar/rechazar de a uno). Migración ADITIVA `20260712110000_cierre_dia_resolucion` (`resuelto_por`/`resuelto_at`/`motivo_rechazo` + `down.sql`). Alcance por rol+zona en el WHERE (maestro→`bodega_central`, adminSatelite→`bodega_satelite`+su zona); rechazo inmutable; concurrencia sin TOCTOU. Commit `0418a1a`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** **DESBLOQUEA 40** (cierre satélite→central) y complementa 39/41.

> Features 37 y 55 CERRADAS y **MERGEADAS a `dev`** 2026-07-12 (PRs #42 y #43). Ver `history.md`.

> Feature 55 (completar ZonaForm: `esCentral` + drift `provincia.zonaId`) CERRADA 2026-07-12: **impl COMPLETA (R1–R14) + reviewer APROBADO 0 bloqueantes** (verde REAL verificado por el reviewer: `prisma validate` valid, `migrate status` up-to-date 0 migraciones nuevas, `typecheck` 0, `lint` 0, **1614/1614 tests (+49)**, `init.sh` OK). Fullstack un ciclo; F1.4 aprobada 2026-07-12 (todo recomendado). Estado `done` + `history.md` + `review_55`. Reconstruyó `ZonaForm` (crear/editar + distritos N:M + `cobroVehiculo` + toggle `esCentral`), reasignación central transaccional (`P2002`→`conflict`), `GeoService`/`GeoActions` para el catálogo geo, drift `provincia.zonaId` reconciliado **solo-schema** (sin migración). **DESBLOQUEA el runtime de `bodega_central` en 30/34/37** (`findCentralZonaId` deja de ser null al marcar zona). **PR #43** abierto a `dev` (en merge). Deuda menor: `conflict` sin payload por-campo; confirmación de reasignación vía checkbox inline (reviewer: menor).

> Feature 37 (mensajero: "Cierre del día") CERRADA 2026-07-12: **impl COMPLETA (R1–R20+E2E) + reviewer APROBADO 0 bloqueantes** (verde REAL verificado por el reviewer: `prisma validate` OK, `typecheck` 0, `lint` 0, **1623/1623 tests (+58)**, `init.sh` OK, rollback round-trip OK). Fullstack un ciclo; F1.4 aprobada 2026-07-11; F2 retomada al reparar `dev` (54). Estado `done` + `history.md` + `review_37`. Módulo `/cierre-dia`: tabla NUEVA `cierre_dia` (+ enums `cierre_estado`/`cierre_destino_tipo`, FK nullable `cierre_id` en `gestion_orden`, RLS) con totales `Decimal` **snapshot** por método (efectivo/SIMPE/transferencia) + general; **Solicitar cierre** crea `solicitado`, vincula gestiones (todo-o-nada), deriva destino por zona vía **`findCentralZonaId()`**; histórico de cierres. Migración `20260712100000_cierre_dia` (con `down.sql`). Commit `59d5b23`. **PR #42 mergeado** a `dev` (`546c5c4`). DEUDA: migración no aplicada contra Postgres real; E2E escrito no ejecutado. Con la 55 mergeada, el runtime `bodega_central` queda operativo. **DESBLOQUEA 38 y base de 39/40/41.**

> Feature 54 (reconciliación del refactor #40 → dev verde + `esCentral`) CERRADA 2026-07-12: **impl COMPLETA + reviewer APROBADO 0 bloqueantes** (verde REAL: `prisma validate` OK, `typecheck` 0, **1565/1565 tests**, `init.sh` OK, `pnpm build` OK). Fix-feature ágil. Repuso `esCentral`/`findCentralZonaId` (17/30 actualizadas), recableó ZonaRepository/TarifaRepository/GeoRepository, arregló schema (`Zona.usuarios`) + migración #40 rota, restauró la feature 51 (el #40 la había revertido a Ecuador), reconció los tests de menú/migración. Se conservó la intención del #40 (tarifas/N:M/menú). Estado `done` + `history.md` + `review_54`. **PENDIENTE: PR a `dev` + merge (OK humano)** → con eso `dev` sano y se retoma la 37. FOLLOW-UP feature 55: completar `ZonaForm` (setear `esCentral`) — sin eso `findCentralZonaId`=null y el maestro no asigna en runtime.

> Feature 34 (asignación desde bodega satélite) CERRADA 2026-07-11: **impl COMPLETA (R1–R20) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh`, 1519 tests). Fullstack un ciclo, SIN migración. Estado `done` + `history.md` + `review_34`. `AsignacionSateliteService` paralelo (guardas rol+zona server-side, 5 errores tipados, lote todo-o-nada) + rename honesto `...Gam`→`...ByZona` (maestro verde) + UI "Asignar" en `recepcion-satelite`. **CIERRA la cadena satelital** (30→32→33→34→36). **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: E2E escrito no ejecutado.

> Feature 52 (fix build /postulacion) CERRADA 2026-07-11: `export const dynamic="force-dynamic"` en `app/postulacion/page.tsx`. `pnpm build` PASA, `init.sh` verde 1493 tests. Ciclo ágil (spec inline, sin reviewer aparte). Estado `done` + `history.md`. **PENDIENTE: PR a `dev` + merge.**

## Pendientes / deudas registradas (el humano pidió dejar constancia — 2026-07-11)

> Bugs y deudas detectadas que NO se pierden. Cada bug de código se registra como feature.

- **Feature 52 (build /postulacion)** — ✅ CERRADA (fix aplicado, `pnpm build` verde). Pendiente solo el PR/merge.
- **TAREA HUMANA — bucket `gestion-evidencias`**: crear el bucket PRIVADO en Supabase Storage (feature 36). Las fotos de evidencia de entrega/rechazo lo necesitan en runtime. Sin esto, la gestión de órdenes del mensajero falla al subir evidencia.
- **DEUDA DE DESPLIEGUE — migraciones**: ✅ **SALDADA 2026-07-11.** `DATABASE_URL` apunta a un **Postgres LOCAL** (`localhost:5432`, db `ordenex`), NO a un Supabase compartido (la nota vieja era incorrecta). Se aplicaron las 12 migraciones pendientes con `prisma migrate deploy` (17/24/27/28/30/33/36 y previas); `prisma migrate status` = "up to date"; `pnpm db:seed` (catálogos) OK. Verificado por leader.
- **DEUDA DE DESPLIEGUE — rollback (T020)**: ✅ **SALDADA 2026-07-11** (feature 53). Se verificó el round-trip
  contra la DB local (`db:rollback` → `migrate status` pendiente → `migrate deploy` reaplica → up to date) y de
  paso se ARREGLÓ `scripts/db-rollback.ts`, que estaba doblemente roto en Prisma 7 (`--schema` en `db execute` +
  `migrate resolve --rolled-back` P3012). Ahora hace `db execute` sin `--schema` y borra el registro de
  `_prisma_migrations` directamente.
- **DEUDA DE DESPLIEGUE — restante (env-dependiente)**: (1) **E2E** (`e2e/*.spec.ts`) escritos pero NO ejecutados — requieren dev server + usuarios sembrados de login por rol + fixtures (los specs usan emails placeholder); ejecutarlos de verdad necesita un HARNESS de seed/login e2e que hoy NO existe (candidato a feature propia). (2) **seed de ZONAS** (`seed-zonas.ts`) pendiente — necesita el **Excel de zonas** que debe proveer el humano. (3) **RLS con key anon** (T004) no ejecutada (config).
- **Posible feature futura — PWA**: convertir la app en PWA (mencionado por el humano en la F1.4 de la 33, para el escaneo móvil del adminSatelite). No creada aún.

> Feature 33 (bodega satélite: mis asignaciones + recepción QR) CERRADA 2026-07-11: **impl COMPLETA (R1–R23) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh` + `pnpm build`, 1493 tests). Fullstack un ciclo. Estado `done` + `history.md` + `review_33`. Módulo `/recepcion-satelite` del adminSatelite ("Por recibir"/"Recibidas"), recepción por escaneo (cámara `html5-qrcode` + lector keyboard-wedge) → estado NUEVO `en_bodega_satelite`; alcance por zona server-side, idempotente. Migración `20260711160000`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: migración no aplicada, verificación manual de hardware, E2E no ejecutado. **HALLAZGO ajeno (pre-existente):** `pnpm build` falla el prerender de `/postulacion` (feature 21, Prisma en prerender sin `export const dynamic`) → candidato a corrección aparte. Desbloquea 34.

> Feature 36 (mensajero: mis asignaciones y gestión) CERRADA 2026-07-11: **impl COMPLETA (R0–R35) + reviewer APROBADO** tras 1 ciclo de rechazo (bloqueantes de checkpoint: tasks sin marcar + falta E2E de recaudo; el humano decidió AÑADIR el E2E). Fullstack un ciclo. Estado `done` + `history.md` + `progress/review_36-...md`. Máquina de estados: `en_espera_aceptacion` →[Recoger]→ `en_reparto` (NUEVO) → gestión → entregada/reprogramada/devuelta/`rechazada`(NUEVO). Migración `20260711150000` (2 estados + enum `metodo_pago_value` + tabla `gestion_orden`+RLS + puntero `usuario.orden_en_gestion_id`). Módulo `/mis-asignaciones` del mensajero. Verificación: `pnpm test` **1433/1433**, `init.sh` verde. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: crear bucket `gestion-evidencias` (HUMANO), migración no aplicada, E2E no ejecutado. Desbloquea 37 (cierre del día) y base de 46/47/48/49.

> Feature 32 (etiqueta de guía con QR + código de barras) CERRADA 2026-07-11: **impl COMPLETA (R1–R15) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh`, 1314 tests). Fullstack un ciclo, SIN migración (read derivado). Estado `done` + `history.md` + `progress/review_32-...md`. Backend: `EtiquetaGuiaDTO`/`findEtiquetasByIds` (resuelve nombres geografía/tienda + direccion + monto), `EtiquetaGuiaService`, action. Frontend: acción "Imprimir etiquetas" sobre el lote → PDF 100×100mm por orden (jspdf), QR=`orden.id`, barcode=`num_guia`. Deps: qrcode.react, react-barcode, jspdf, jsbarcode. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: verificación manual del binario del PDF + escaneabilidad. Desbloquea 33.

> Feature 30 (asignación por zona GAM / ruteo bodega satélite) CERRADA 2026-07-11: **impl COMPLETA (R1–R22) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh`, 1287 tests verde). Fullstack un ciclo. Estado `done` + `history.md` + `progress/review_30-...md`. Backend: estado `en_ruta_bodega_satelite` (migración+down.sql), guardia R4, filtro mensajeros GAM, ruteo con `num_guia`. Frontend: columna Zona, badge dinámico, apartado + `RutearSateliteModal`, `GenerarGuiaModal` split GAM/no-GAM. F1.4 (6 decisiones recomendadas). **PENDIENTE: abrir PR a `dev` y merge (requiere OK humano, como el #32).** DEUDA: migración no aplicada contra Postgres real. Desbloquea 33/34/39.

> Feature 17 (revisión maestro / generar guía / asignación mensajero) CERRADA 2026-07-11: **PR #32 mergeado** a `origin/dev` (5e06aeb). Fullstack (R0–R32), reviewer APROBADO 0 bloqueantes, migración `num_guia` NULLABLE + secuencia + `mensajero_asignado_id` + estado `en_espera_aceptacion`. Suite 1244 verde tras integrar `dev` (feature 51). Desbloquea 30/32/36. Pendiente humano: aplicar la migración contra Postgres real (deuda de despliegue).

> Feature 23 (dashboard maestro) CERRADA 2026-07-10/11: **PR #28 mergeado** a `origin/dev`. Frontend puro (R1–R19). Feature 27 (fulfillment tienda) CERRADA: **PR #29 mergeado**. Feature 51 (corrección carga masiva CR) CERRADA: **PR #31 mergeado**. Ver `history.md`.

> Feature 22 (aprobación de postulaciones) CERRADA 2026-07-10: **PR #26 mergeado** a `origin/dev` (8eaed55), status `done`, entrada en `history.md`. Backend puro (R1–R21), reviewer APROBADO 0 mayores, sin migraciones. Rechazo→`inactivo`, URLs firmadas TTL 300s. Desbloquea la 23.

> Feature 21 (postulación de mensajero) CERRADA 2026-07-10: **PR #23 mergeado** a `origin/dev` (20db364), status `done`, entrada en `history.md`. Fullstack (R1–R26), reviewer APROBADO (bloqueante R17 resuelto). `primer_apellido` OBLIGATORIO; migración APLICADA y VERIFICADA contra Postgres real. Desbloquea la 22→23. Pendiente humano: crear bucket privado `mensajero-docs` en Supabase Storage.

> Feature 25 (gestión de usuarios) CERRADA 2026-07-10: **PR #24 mergeado** a `origin/dev` (95d5025), status `done`, entrada en `history.md`. Fullstack (R1–R36), otra sesión, reviewer APROBADO 0 bloqueantes.

> Feature 50 (vehiculos) CERRADA 2026-07-10: **PR #21 mergeado** a `origin/dev` (eb6a17d), status `done`, entrada en `history.md`. Backend puro (R1–R15, R12 N/A). Migración+seed **aplicados y verificados contra Postgres real**. Desbloquea la 21→22→23.

> Feature 20 (recuperación de contraseña) CERRADA 2026-07-10: **PR #20 mergeado** a `origin/dev`
> (b1ef459, 19:15Z), status -> `done`, entrada en `history.md`. Fullstack (reusa infra OTP, sin
> tabla nueva); implementada en 2 slices (backend + frontend), reviewer APROBADO en ambos, 0
> bloqueantes, suite 782/782 verde. Desbloquea la #25 (comparte `strongPasswordSchema`).

> Feature 31 (plantilla XLSX) CERRADA 2026-07-10: **PR #19 mergeado**, status -> `done`, entrada
> en `history.md`. Frontend puro (CSV→XLSX, exceljs import dinámico), reviewer APROBADO 0 bloqueantes.

> Feature 29 (enriquecer validación carga masiva) CERRADA 2026-07-10: **PR #17 mergeado** a
> `origin/dev` (7535961), status -> `done`, entrada en `history.md`. Frontend puro (R1–R19),
> reviewer APROBADO 0 bloqueantes, suite 721/721 verde. Corrió en paralelo con la 28 (backend).

> Feature 26 (dashboard/apartado admin de tienda) CERRADA 2026-07-10: **PR #14 mergeado** a
> `origin/dev` (e5a0f5d), status -> `done`, entrada en `history.md`. Frontend puro, corrió en
> paralelo con la 19 (backend). Reviewer APROBADO 0 bloqueantes; suite 689/689 verde. Deuda
> aceptada: sin e2e de login adminTienda (repo sin infra seed/login e2e). Cierre commiteado a
> `dev` (chore/state) — otra sesión trabaja la 28 en paralelo.

> Feature 28 (rename estado embalaje -> en_fulfillment) CERRADA 2026-07-10: **PR #15 mergeado** a
> `origin/dev` (d259e6a), status -> `done`, entrada en `history.md`. Backend puro; enum PG
> `order_status_value` standalone + rename de fila de catálogo, verificado contra Postgres real (R11).
> El cierre (done + history) viaja en la rama `chore/skills-cierre-28` junto con las skills de diseño.
> DEUDA nueva: `scripts/db-rollback.ts` (flag `--schema` roto en Prisma 7) -> feature aparte.


> Feature 18 (cobros crud) CERRADA 2026-07-10: PR #12 mergeado a `origin/dev` (a379d8e),
> status -> `done`, entrada en `history.md`. El cierre de la 18 + registro de la 19 viajan en
> el primer commit de `feature/19-rol-adminsatelite`.
> SKIP de la 17: deps 27/28 no `done`; no arranca hasta que cierren. Otras elegibles: 20, 21,
> 24 (necesita Excel), 25, 26, 28, 29.

> Feature 14 (botón carga masiva en órdenes) CERRADA 2026-07-10: PR #10 mergeado a
> `origin/dev` (bb511f1), status -> `done`, entrada en `history.md`. El cierre de la 14 +
> registro de la 16 viajan en el primer commit de `feature/16-carga-masiva-etapa2`.

> Feature 11 (notificaciones/toast) CERRADA 2026-07-10: PR #8 mergeado a `origin/dev`
> (1169312), status -> `done`, entrada en `history.md`. El cierre de la 11 + registro de
> la 15 viajan en el primer commit de `feature/15-carga-masiva-endpoint` (bookkeeping vía
> PR, sin commits directos a `dev`).
> NOTA: al mergear la 11, la zona frontend quedó libre → la feature 14 (frontend, low,
> depends_on 9 done) está desbloqueada y podría correr en PARALELO con la 15 (backend).

## Evaluaciones

> El leader documenta aca cada evaluacion de zone/complexity/particion.

- `trazabilidad / historial de estados de la orden` (id 49): **zone=fullstack, complexity=high,
  branch=feature/49-trazabilidad-historial-estados, depends_on=36 (done, en dev).** Evaluada 2026-07-13.
  Segunda del grupo "Fase 2 flujo mensajero" (46 -> **49** -> 47 -> 48); es la BASE TRANSVERSAL en la que
  se apoya la 47 (contador de intentos / escalado a rechazo). Fullstack (backend — tabla nueva de historial
  de estados + append en CADA transicion de la maquina de estados 17/30/33/34/36/46 + RLS + migracion;
  frontend — linea de tiempo en el detalle de la orden). complexity=high por ser TRANSVERSAL (instrumenta
  todos los puntos de escritura de estado del sistema). DECISION DE PROCESO (leader): NO se parte el entry;
  un ciclo fullstack (implementer delega backend_dev -> frontend_dev, un PR), precedente 16/24/30/41/46.
  **BASE DE RAMA (desviacion justificada de 'nacer de dev'):** la 49 se branquea desde el TIP de la
  feature/46 (= dev + 43 + 46), NO desde dev pelado, porque la 49 debe instrumentar TAMBIEN la transicion de
  liberacion que introdujo la 46 (`reprogramada -> en_bodega/en_bodega_satelite` via el cron), y la 46 aun no
  esta en dev (esta en PR #51). Consistente con el stacking de la cadena 37->43. Cuando el humano mergee #51,
  el PR de la 49 quedara limpio (git ya vera la 46 en dev). Preguntas ABIERTAS para F1.4 (el spec_author las
  formaliza): (a) DONDE vive el contador de intentos -> DERIVARLO del historial (contar transiciones de
  intento fallido/`devuelta`) sin columna nueva (recomendado; la 47 lo lee y aplica la regla de 3) vs. columna
  materializada en `orden`; (b) MECANISMO de captura -> helper/transicion CENTRALIZADA que toda escritura de
  estado invoca para append atomico al historial (recomendado, en la MISMA tx que el cambio de estado) vs.
  instrumentar cada call-site a mano; (c) FORMA de la tabla -> `orden_historial_estado` (orden_id, estatus_id
  origen/destino, actor/usuario_id, motivo?, created_at) append-only inmutable vs. reusar/extender algo
  existente; (d) BACKFILL de ordenes existentes -> sin backfill retroactivo (el historial arranca desde la
  feature; recomendado) vs. sembrar el estado actual como fila inicial; (e) ALCANCE del contador de intentos
  como concepto de la 49 vs. dejarlo integramente a la 47 (la 49 solo da el historial y la 47 deriva/aplica);
  (f) linea de tiempo -> UI en el detalle de la orden reusando patrones existentes, alcance de quien la ve
  (maestro/adminSatelite/tienda/mensajero) a definir. Insumos YA presentes en la rama: catalogo `order_status`,
  `gestion_orden`, servicios de transicion `GuiaAsignacionService`/`AsignacionSateliteService`/
  `MisAsignacionesService` + el cron `liberar-reprogramadas` (46).

- `reprogramacion: bloqueo y liberacion programada` (id 46): **zone=fullstack, complexity=high,
  branch=feature/46-reprogramacion-bloqueo-liberacion, depends_on=36 (done, en dev).** Evaluada
  2026-07-13. Seleccionada por el humano dentro del grupo "Fase 2 flujo mensajero (46/47/49)"; se
  arranca por la 46 (menor id, INDEPENDIENTE de 47/49). Fullstack (backend — job cron diario de
  liberacion en linea con `/api/cron/corte-diario` de la 41, guardas de bloqueo en las rutas de
  asignacion/envio 17/34, transicion de liberacion; frontend — reflejo "bloqueada hasta <fecha>" +
  aviso de liberacion). Insumos YA en dev: `gestion_orden.fechaReprogramacion` (Date) + `motivo` +
  `GestionResultado.reprogramada` + estado `reprogramada` (feature 36), infra Vercel Cron + `CRON_SECRET`
  (feature 41). DECISION DE PROCESO (leader): NO se parte el entry; por precedente (16/24/27/30/41) se
  corre como UN ciclo fullstack (implementer delega backend_dev -> frontend_dev, un PR). Rama creada
  desde `origin/dev` (f25f4a8, contiene 36/41/42). Orden previsto del grupo: 46 -> 49 (trazabilidad,
  base) -> 47 (reintentos, se apoya en 49) -> 48 (rechazo->tienda, depends 47). Preguntas ABIERTAS
  para F1.4 (el spec_author las formaliza): (a) estado destino de la LIBERACION -> volver a
  `en_bodega`/`en_bodega_satelite` segun la bodega responsable de la orden (recomendado, reusar el
  resolver de zona `findCentralZonaId`) vs. re-`en_espera_aceptacion` con el mismo mensajero; (b)
  DISPARADOR -> endpoint cron nuevo `/api/cron/liberar-reprogramadas` con el mismo schedule `0 6 * * *`
  (00:00 CR) de la 41 (recomendado) vs. plegarlo dentro de `corte-diario`; (c) alcance del BLOQUEO -> la
  orden `reprogramada` con `fechaReprogramacion > hoy` no reasignable/enviable (guarda server-side en
  17/34); (d) mecanismo del AVISO -> visibilidad derivada (seccion/badge "liberadas hoy" en la bodega
  responsable, sin tabla de notificaciones nueva) vs. registro persistente; (e) idempotencia del job
  (reejecucion no doble-libera) por diseno, patron de la 41.

- `paginacion` (id 8): **zone=frontend, complexity=medium, branch=feature/8-paginacion,
  depends_on=null.** Evaluada como frontend puro (compone con DataTable de feature 7;
  el backend `listarOrdenes({page,pageSize})` de feature 6 ya existe, no se toca).
  No es fullstack → sin particion. Rama creada desde `origin/dev` (ya al dia con
  order-list). Decisiones humanas Q1-Q4 (2026-07-09): server-side, selector 10/25/50
  (reset a pag 1), botones primera/ultima, ventana numerica con elipsis + aria-current.
- `componente carga masiva` (id 9): **zone=frontend, complexity=medium.** Componente
  de subida de archivo parametrizable (tipo, ruta API, plantilla). Zona ocupada por
  la 8 → en espera.
- `manejador de errores` (id 10): **zone=backend, complexity=medium,
  branch=feature/10-manejador-errores, depends_on=null.** SELECCIONADA (2026-07-09):
  zona backend libre mientras la 8 (frontend) sigue abierta → corren en paralelo.
  Estructura de error comun + wrapper para Server Actions/endpoints; NO toca UI.
  Worktree creado desde `origin/dev` en `../ordenex-f10`. Fase 1 (spec) en curso.
- `notificaciones` (id 11): **zone=frontend, complexity=low.** Toast de mensajes.
- `notificaciones - fix` (id 12): **zone=backend, complexity=medium, depends_on=10.**
  Reemplaza switch-case de errores por el manejador global (necesita la 10 done).
- `modal` (id 13): **zone=frontend, complexity=medium.** Modal reutilizable con
  soporte async (spinner + bloqueo de confirmacion).
- `ordenes - carga masiva` (id 14): **zone=frontend, complexity=low, depends_on=9.**
  Boton en ordenes que abre modal con el componente de carga masiva.
- `ordenes - carga masiva - etapa 2` (id 16): **zone=fullstack, complexity=medium,
  branch=feature/16-carga-masiva-etapa2, depends_on=15.** Evaluada 2026-07-10 con el
  codigo en mano: es FULLSTACK (backend nuevo — listar usuarios `role=mensajero` como
  `{id,nombre}` para el select y asignar/actualizar `mensajero_sugerido_id`; hoy no hay
  metodo de listado por rol en `UserRepository`; y frontend — resumen columna por columna
  + selects). DECISION DE PROCESO (leader): NO se parte la entrada del feature_list (que el
  humano curo) en dos; como las mitades son ESTRICTAMENTE SECUENCIALES (frontend depende del
  backend, sin paralelismo que ganar) se corre como UN ciclo fullstack (implementer delega
  backend_dev -> frontend_dev, un PR). Si el humano prefiere el split formal, se hace.
  Decisiones humanas (2026-07-10): (1) flujo POST-COMMIT — las ordenes ya las crea la 15 en
  `en_preparacion`; la 16 muestra el resumen y asigna mensajero sobre ordenes YA creadas, NO
  cambia la 15/14. (2) asignacion de mensajero AMBOS: select global "aplicar a todos" +
  override por fila.
- `dashboard/apartado del admin de tienda` (id 26): **zone=frontend, complexity=medium,
  branch=feature/26-dashboard-admin-tienda, depends_on=null.** Evaluada 2026-07-10:
  la descripcion dice "Frontend" y sus insumos estan done — autz por rol (feature 6),
  DataTable + columna tiendaNombre (feature 7), boton/modal de carga masiva (features
  14/16). NO hay backend nuevo: el filtrado de ordenes a la tienda del adminTienda ya lo
  hace la autz de la 6. Zona frontend LIBRE (unica en curso: 19 backend) -> corre en
  paralelo. Seleccionada por el humano ignorando la cadena de la 28 (28->27->17).
  ABIERTO para el spec: que mas muestra el dashboard del adminTienda ademas del modulo de
  ordenes (metricas/accesos) -> el humano decidira en la puerta de aprobacion F1.4.
- `gestion de zonas` (id 24): **zone=fullstack, complexity=high, branch=feature/24-gestion-zonas,
  depends_on=null.** Evaluada 2026-07-10: fullstack (migracion + seed XLSX + backend CRUD + UI en
  configuracion). Por precedente del repo (features 20/21/25 corrieron fullstack SIN partir) se corre
  como UN ciclo fullstack (implementer delega backend_dev->frontend_dev, un PR). Worktree
  `../ordenex-f24` desde `origin/dev`. Seleccionada por el humano (2026-07-10) excluyendo 23 y 27; la
  siguiente por id, la 17, esta bloqueada semanticamente por la 27 (in_progress). Es foundational:
  destraba 30 (asignacion por zona) y 39 (pago por zona). **F1 (spec R1-R28) COMPLETA -> spec_ready.**
  DOS GATES antes de impl: (1) es fullstack -> NO corre en paralelo con la feature 27 (tambien
  fullstack, in_progress en otra sesion); (2) el seed necesita el **Excel de zonas** que el humano debe
  proveer. Preguntas abiertas para F1.4 en `specs/24-gestion-zonas/requirements.md`.
  **F1.4 APROBADA por el humano 2026-07-10** (las 7 propuestas tal cual) -> status `in_progress` (F2.0).
  **IMPL EN ESPERA (no arrancada):** la feature 27 esta implementando AHORA en el checkout principal y
  ya tiene modificados `db/schema.prisma`, `UserRepository`/`IUserRepository`, `OrdenRepository` y la UI
  de configuracion -> arrancar la 24 chocaria en la migracion de `usuario` y los repos (regla #1 no
  negociable). La impl de la 24 arranca cuando la 27 este `done` en `dev`; entonces se sincroniza. El
  seed ademas espera el Excel. Rama `feature/24-gestion-zonas` pusheada con el spec para revision.

- `fulfillment de tienda + estado inicial condicional` (id 27): **zone=fullstack,
  complexity=high, branch=feature/27-fulfillment-tienda, depends_on=25.** Evaluada
  2026-07-10: fullstack (backend — campo booleano `fulfillment` en Usuario +
  migracion/down.sql + logica condicional en `BulkOrdenService`/carga masiva feature 15;
  frontend — switch 'esta tienda tiene fulfillment' en la UI de creacion de usuario de la
  feature 25). Deps 25 y 28 **done**. DECISION DE PROCESO (leader): NO se parte el entry
  del feature_list; las mitades son ESTRICTAMENTE SECUENCIALES (el switch del frontend
  depende del campo backend, sin paralelismo que ganar) -> se corre como UN ciclo
  fullstack (implementer delega backend_dev -> frontend_dev, un PR), mismo criterio que
  las features 16 y 25. Si el humano prefiere el split formal, se hace. Rama creada desde
  `origin/dev` (al dia con 21/25/50/28).

- `asignacion por zona (GAM) y ruteo a bodega satelite` (id 30): **zone=fullstack,
  complexity=high, branch=feature/30-asignacion-zona-ruteo-satelite, depends_on=24.**
  Evaluada 2026-07-11: fullstack (backend — nuevo `order_status` de ruteo a satelite,
  consultas de mensajeros filtradas por zona, transiciones de asignacion; frontend —
  UI del maestro: lista de mensajeros restringida a GAM + accion 'rutear a bodega
  satelite'). Deps 24 (zonas, con `distrito.zona_id` y `Usuario.zona_id`) y 17 (generar
  guia / `mensajero_asignado_id` / `en_espera_aceptacion`) **done**. DECISION DE PROCESO
  (leader): NO se parte el entry; por precedente del repo (16/24/25/27) se corre como UN
  ciclo fullstack (implementer delega backend_dev -> frontend_dev, un PR). Rama creada
  desde `origin/dev` (5e06aeb). Preguntas ABIERTAS para F1.4: (a) identificacion de la
  zona GAM -> flag `es_gam`/`es_central` en `zona` (recomendado) vs. por nombre 'GAM'
  -OJO: la 24 dejo `es_gam` como toggle de UI NO sembrado, hay que reconciliar-; (b)
  estado de ruteo -> UN `en_ruta_bodega_satelite` con nombre de zona derivado de
  `orden.zona_id` (recomendado, precedente `en_ruta_bodega_principal`) vs. estado por zona.

- `etiqueta de guia con QR y codigo de barras` (id 32): **zone=fullstack, complexity=medium,
  branch=feature/32-etiqueta-guia-qr, depends_on=17.** Evaluada 2026-07-11 con el código en mano:
  aunque "renderizar una etiqueta" suena frontend, el `OrdenDTO` (lib/types/orden.ts) NO expone
  `direccion`, `montoCobrar` ni los NOMBRES de provincia/canton/distrito (solo IDs; el listado
  añade `zonaNombre`/`tiendaNombre`). El modelo `Orden` sí tiene esos datos (direccion, montoCobrar,
  relaciones a geografía) → hace falta un READ backend que ensamble el payload completo de la
  etiqueta. Además NO hay librerías de QR ni de código de barras en package.json (deps nuevas). Por
  eso es FULLSTACK, un ciclo (precedente 16/24/25/27/30). Preguntas ABIERTAS para F1.4: (a) qué
  codifica el QR (orden.id UUID estable -recomendado, lo escanea la feature 33- vs num_guia); (b) qué
  codifica el código de barras (num_guia numérico -recomendado- vs num_remision); (c) render de la
  etiqueta (HTML imprimible con CSS print/window.print -recomendado, sin dep de PDF- vs PDF generado);
  (d) qué librerías QR + barcode (deps nuevas, el spec recomienda); (e) disparo (¿auto al 'Generar
  guía' vs acción "imprimir etiqueta" por orden/lote?; ¿una etiqueta por orden o hoja con el lote?).

- `mensajero - mis asignaciones y gestion de ordenes` (id 36): **zone=fullstack, complexity=high,
  branch=feature/36-mensajero-mis-asignaciones, depends_on=17.** Evaluada 2026-07-11: fullstack high,
  un ciclo. Las órdenes llegan al mensajero vía la 17 (`en_espera_aceptacion` + `mensajeroAsignadoId`);
  la 34 (asignación desde satélite) alimentará lo mismo más adelante pero NO bloquea (dep JSON = 17). Requiere
  NUEVO modelo de registro de gestión (evidencias/fotos en Supabase Storage -patrón `MensajeroDocumento`/
  `SupabaseFileStorage`/`ISignedUrlProvider` de la feature 21-, monto recibido, método de pago, motivos, fecha
  de reprogramación), NUEVO enum de método de pago (efectivo/SIMPE/transferencia; hoy NO existe), estado NUEVO
  'aceptada/por entregar', paso de aceptación (solo aceptar, sin rechazar la asignación), y bloqueo de gestión
  1-a-1. Preguntas ABIERTAS para F1.4: (a) nombre exacto del estado 'aceptada/por entregar'; (b) ¿el RESULTADO
  'RECHAZO' es estado NUEVO 'rechazada' o mapea a existente (devuelta/devuelta_origen)?; (c) forma del enum de
  método de pago (¿catálogo tabla como order_status vs enum PG?); (d) forma del modelo de gestión (un registro
  con `resultado` + campos nullable vs tablas separadas); (e) bloqueo 1-a-1 solo UI vs flag backend; (f) bucket
  de evidencias (reusar `mensajero-docs` vs nuevo `gestion-evidencias`); (g) aceptación en lote vs por-orden.

- `bodega satelite - mis asignaciones y recepcion por QR` (id 33): **zone=fullstack, complexity=high,
  branch=feature/33-recepcion-qr-satelite, depends_on=30.** Evaluada 2026-07-11: fullstack (vista del
  `adminSatelite` + transición de estado + escaneo). Se apoya en: `en_ruta_bodega_satelite` (feature 30, órdenes
  ruteadas a satélite), QR=`orden.id` (feature 32), `usuario.zonaId` del adminSatelite (feature 24), rol
  adminSatelite (feature 19). Añade estado NUEVO `en_bodega_satelite` (zona derivada de `orden.zonaId`, mismo
  patrón de la 30). Preguntas ABIERTAS para F1.4: (a) mecanismo de escaneo -> lector físico tipo teclado
  (keyboard-wedge, robusto/barato, recomendado) vs. cámara web (getUserMedia + lib QR) vs. ambos; (b) confirmar
  estado único `en_bodega_satelite` con zona derivada; (c) ¿el adminSatelite solo recibe órdenes de SU zona? (sí:
  rechazar escaneo de orden de otra zona); (d) recepción 1-a-1 por escaneo con feedback por item vs. lote;
  (e) ¿qué hace el escaneo de un QR inválido / orden no en_ruta_bodega_satelite / ya recibida?

## Conflictos pendientes

> Conflictos de merge que el agente no pudo resolver solo. El humano decide.

- ⛔ **`dev` ROTO por el PR #40 "adjustments" (2026-07-11, otra sesión)** — refactor grande mergeado a MEDIAS:
  renombró `cobros`→`tarifas` (ICobroRepository→ITarifaRepository, ICobroService→ITarifaService), remodeló
  `zona`/`distrito` (migraciones `rename_cobro_tarifas`, `zona_distrito_nm`), reescribió `IZonaRepository`/
  `lib/types/zona.ts`, y agregó sidebar/menú nuevo (shadcn). **Rompió el baseline**: `prisma validate` inválido
  (modelo `Zona` sin relación opuesta a `Usuario.zona`) + **86 errores de typecheck** (56 en producción). CAUSA
  concreta: quitó `ZonaDTO.esGam`/`pagoEntrega`/`pagoRechazo` y **eliminó `IZonaRepository.findGamZonaId()`**, PERO
  NO actualizó a sus consumidores → `lib/actions/ordenes-guia.ts` y `lib/services/GuiaAsignacionService.ts`
  (features 17/30/34) siguen llamando `findGamZonaId` y no compilan.
  - **Impacto**: `dev` no compila; NINGUNA feature nueva puede verificarse (init.sh rojo). La identificación de la
    zona GAM (base de 30/34/37) quedó sin mecanismo.
  - **Decisión del humano (2026-07-11)**: PAUSAR la feature 37; la **sesión dueña del refactor** (ramas
    `origin/adjustments`, `origin/worktree-menu-config-submenu`) debe dejar `dev` VERDE — reconciliando el código
    GAM de 17/30/34 con el nuevo modelo de zonas/tarifas (definir cómo se identifica GAM sin `esGam`). El leader NO
    repara el refactor ajeno a ciegas (colisión + decisión de diseño desconocida).
  - **Al retomar**: cuando `dev` compile en verde, la feature 37 arranca F2 con su spec INTACTO (`specs/37-...`,
    F1.4 ya aprobada). Verificar antes: `prisma validate` OK, `pnpm typecheck` 0 errores, `./init.sh` verde.

## Plan de la sesion
- [x] Features 1-29, 31, 50, 51: ciclos SDD completos (ver history.md).
- [x] Feature 17 (revisión maestro / generar guía): done, PR #32 mergeado 2026-07-11.
- [x] Feature 30 (asignación por zona GAM / ruteo satélite): done, PR #33 mergeado.
- [x] Feature 32 (etiqueta guía QR/barcode): done, PR #34 mergeado.
- [x] Feature 36 (mensajero mis asignaciones y gestión): done, PR #35 mergeado.
- [x] Feature 33 (recepción QR bodega satélite): done (impl+reviewer OK); pendiente PR a `dev`.
- [ ] Siguientes elegibles: **34** (asignación desde satélite, depends 33 done → desbloqueada), **37** (cierre del día,
      depends 36 done), **42** (wallet, depends 18 done), 35 (realtime).
- [ ] DEUDA nueva detectada: `/postulacion` (feature 21) rompe `pnpm build` (Prisma en prerender sin `dynamic`) → feature de corrección aparte.

## Notas / decisiones tomadas
- Modelos legacy de AGENTS.md (sonnet-4/opus-4.8) mapeados a sonnet/opus/haiku.
- Decision del humano (2026-07-09): TODOS los agentes con `opus`, ignorando la
  gradacion por complexity (la tabla resuelve a opus en todas las columnas).
- frontend_dev escalado de haiku a sonnet en login(home) por verificacion falsa.
- (2026-07-09) Refactor del proceso: ramas desde `dev`, PRs hacia `dev`,
  evaluacion automatica de `zone`/`complexity`, particion de `fullstack` y
  paralelismo por zonas disjuntas.

## Bloqueos / preguntas abiertas
- DEUDA DE DESPLIEGUE (parcial): ✅ **migraciones APLICADAS 2026-07-11** contra el Postgres
  LOCAL (`localhost:5432`), `prisma migrate deploy` + `db:seed` OK, `migrate status` up to date.
  RESTA (env-dependiente): ejecutar los E2E en verde (requieren harness de seed/login e2e —
  hoy los specs usan emails placeholder; candidato a feature propia), verificar rechazo RLS con
  key anon (T004), rollback de migracion (T020, destructivo), y el seed de ZONAS (necesita el
  Excel del humano). Hasta esos, CHECKPOINTS no llega al 100% pese al estado `done`.
