# Bitácora de implementación — Feature 36 · Mensajero: "Mis asignaciones" y gestión de órdenes

Zone: `fullstack` · complexity: `high` · branch: `feature/36-mensajero-mis-asignaciones`
Ciclo: F2 (implementación) tras aprobación humana F1.4 (2026-07-11). Coordinado por el
`implementer` delegando en `backend_dev` (primero) y `frontend_dev` (después).

## Terminología final aplicada (SUPERSEDE el borrador provisional)
- Estado tras recoger = **`en_reparto`** (NO `aceptada`).
- Acción del mensajero = **"Recoger"** / `recogerAsignaciones` (NO "aceptar").
- Estado previo = `en_espera_aceptacion` (EXISTENTE, feature 17); label ajustado a "Por recoger".
- Resultado RECHAZO → estado **`rechazada`**.
- Método de pago enum nativo `metodo_pago_value` con valor `SIMPE` (F1.4-c), coherente en
  `lib/types/metodo-pago.ts`, `db/schema.prisma` y la migración.
- Regla (h) estricta: ENTREGADA exige `montoRecibido === orden.montoCobrar` exacto.

---

## 1. Archivos creados / modificados

### Backend (delegado a `backend_dev`)
Creados:
- `lib/types/metodo-pago.ts` — `METODO_PAGO_SEED` (efectivo, SIMPE, transferencia) + `MetodoPagoValue`
- `lib/types/gestion-orden.ts` — `recogerSchema`, `escogerSchema`, `gestionarSchema` (discriminado), `validarEvidencia`, `esFechaFutura`, result types
- `lib/config/gestion.ts` — bucket privado gestion-evidencias, MAX_FILE_BYTES, MIME, TTL (por env)
- `lib/interfaces/repositories/IGestionOrdenRepository.ts`
- `lib/repositories/GestionOrdenRepository.ts`
- `lib/interfaces/services/IMisAsignacionesService.ts`
- `lib/services/MisAsignacionesService.ts`
- `lib/actions/mis-asignaciones.ts` (Server Action)
- Migración `db/migrations/20260711150000_gestion_orden_estados_metodo_pago/` (migration.sql UP + down.sql DOWN)
- Tests: `tests/unit/types/metodo-pago.test.ts`, `tests/unit/config/gestion-config.test.ts`,
  `tests/unit/types/gestion-orden-schemas.test.ts`, `tests/unit/repositories/gestion-orden-repository.test.ts`,
  `tests/unit/services/mis-asignaciones-service.test.ts`, `tests/unit/actions/mis-asignaciones-action.test.ts`,
  `tests/integration/db/gestion-orden-migration.test.ts`

Modificados:
- `lib/types/order-status.ts` — añadidos `en_reparto` (11º) y `rechazada` (12º); NO `aceptada`
- `db/schema.prisma` — enums MetodoPagoValue/GestionResultado, modelo GestionOrden, columna Usuario.ordenEnGestionId (FK→orden ON DELETE SET NULL) + lados inversos
- `app/(app)/ordenes/_components/estatus-label.ts` — labels en_reparto/rechazada + en_espera_aceptacion → "Por recoger"
- `app/(app)/ordenes/_components/EstatusBadge.tsx` — claves nuevas (Record exhaustivo, R33)
- Tests preexistentes ajustados por catálogo 10→12 y orden de migraciones (order-status, seed-order-status, EstatusLabel, y 4 tests de migración db)

### Frontend (delegado a `frontend_dev`)
Creados:
- `app/(app)/mis-asignaciones/page.tsx` — Server Component: valida rol mensajero server-side (→ notFound), pre-fetch, props
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` — dos apartados, Recoger/Recoger todas, bloqueo 1-a-1, router.refresh
- `app/(app)/mis-asignaciones/_components/GestionarOrdenModal.tsx` — modal 4 resultados, campos condicionales, valida con gestionarSchema, envía FormData
- `app/(app)/mis-asignaciones/_components/AsignacionDetalle.tsx` — detalle completo (R11)
- `app/(app)/mis-asignaciones/_components/metodo-pago-options.ts`
- Tests: `tests/components/MisAsignacionesModule.test.tsx`, `tests/components/MisAsignacionesPage.test.tsx`, `tests/components/Sidebar.test.tsx`

Modificados:
- `app/(app)/_components/Sidebar.tsx` — item "Mis asignaciones" gated por rol mensajero
- `app/(app)/layout.tsx` — async: resuelve actor y pasa rol al Sidebar
- `tests/components/AppLayout.test.tsx` — adaptado a layout async

---

## 2. Migraciones creadas
`db/migrations/20260711150000_gestion_orden_estados_metodo_pago/`
- UP (migration.sql): `ALTER TYPE order_status_value ADD VALUE IF NOT EXISTS` en_reparto/rechazada
  + `INSERT order_status ON CONFLICT DO NOTHING`; `CREATE TYPE metodo_pago_value`; `CREATE TYPE gestion_resultado`;
  `ALTER TABLE usuario ADD COLUMN orden_en_gestion_id` (FK→orden ON DELETE SET NULL);
  `CREATE TABLE gestion_orden` + FKs + índices (orden_id, mensajero_id) + `ENABLE ROW LEVEL SECURITY`.
- DOWN (down.sql): drop tabla/tipos/columna en orden inverso; borra filas de catálogo en_reparto/rechazada
  SOLO si ninguna orden las referencia (los valores del enum Postgres no se eliminan — patrón features 17/28/30).

---

## 3. Verificación ejecutable (salida real)

`./init.sh` → **== init OK ==** (verde).
- `pnpm run typecheck` (tsc --noEmit): 0 errores
- `pnpm run lint` (eslint): 0 errores, 135 warnings (todos preexistentes en `.claude/skills/*`, ninguno en la feature)
- `pnpm run test` (vitest): **167 archivos, 1417 tests, todos PASS** (Duration 41s)
- Chequeo del arnés: "todas las migraciones tienen down.sql" OK; ".env presente" OK

---

## 4. Mapa de trazabilidad R → test

| Req | Test (archivo::caso) |
| --- | --- |
| R0  | revisión documental: F1.4 cerrada (bloque "Decisiones F1.4 APROBADAS" en requirements.md) — reviewer |
| R1  | order-status.test.ts::"12 valores" / "en_reparto (11) y rechazada (12)" / "seedOrderStatus idempotente" |
| R2  | gestion-orden-migration.test.ts::"ADD VALUE IF NOT EXISTS" / "INSERT ON CONFLICT" / "down borra solo si no referenciado" |
| R3  | gestion-orden-migration.test.ts::"NO usa aceptada" + mis-asignaciones-service.test.ts::"R30 rechazo → estado rechazada" |
| R4  | EstatusLabel.test.ts::"traduce todos los estados del seed" (en_reparto/rechazada) |
| R5  | metodo-pago.test.ts (3 casos) + gestion-orden-migration.test.ts::"enum metodo_pago_value SIMPE" |
| R6  | gestion-orden-migration.test.ts::"tabla gestion_orden campos nullable" / "FKs" / "enum gestion_resultado" |
| R7  | gestion-orden-migration.test.ts::"índices" / "RLS habilitada sin policies" / "DOWN reversible" |
| R8  | mis-asignaciones-service.test.ts::"R8 persiste storage_path (no URL)" + gestion-config.test.ts::"bucket privado gestion-evidencias" |
| R9  | gestion-orden-repository.test.ts::"filtra por mensajero_asignado_id" + MisAsignacionesPage.test.tsx + Sidebar.test.tsx |
| R10 | MisAsignacionesModule.test.tsx::"dos apartados separados" + mis-asignaciones-service.test.ts::"separa por recoger/por gestionar" |
| R11 | MisAsignacionesModule.test.tsx::"detalle completo" + gestion-orden-repository.test.ts::"proyección nombres legibles" |
| R12 | mis-asignaciones-service.test.ts::"rol != mensajero → forbidden" + mis-asignaciones-action.test.ts::"unauthenticated" + MisAsignacionesPage.test.tsx::"no-mensajero → notFound" |
| R13 | gestion-orden-repository.test.ts::"filtro en el WHERE por mensajero" |
| R14 | MisAsignacionesModule.test.tsx::"únicamente Recoger, no Rechazar" |
| R15 | mis-asignaciones-service.test.ts::"R15/R16 recoge lote" + gestion-orden-repository.test.ts::"recogerLote guardia propiedad+origen" |
| R16 | mis-asignaciones-service.test.ts::"R15/R16 lote" + MisAsignacionesModule.test.tsx::"Recoger todas / Recoger fila" + gestion-orden-schemas.test.ts::recogerSchema |
| R17 | mis-asignaciones-service.test.ts::"orden ajena → forbidden" / "origen inválido → conflict" |
| R18 | mis-asignaciones-service.test.ts::"origen no en_reparto → conflict" |
| R19 | mis-asignaciones-service.test.ts::"fija orden activa" + MisAsignacionesModule.test.tsx::"con una activa las demás bloqueadas" |
| R20 | mis-asignaciones-service.test.ts::ordenEnGestionId + gestion-orden-repository.test.ts::setOrdenEnGestion + migración (columna puntero) |
| R21 | mis-asignaciones-service.test.ts::"segunda orden con otra activa → conflict" + MisAsignacionesModule.test.tsx::"escoger conflict → toast, no abre modal" |
| R22 | gestion-orden-schemas.test.ts::ENTREGADA + mis-asignaciones-service.test.ts::"monto != montoCobrar → validation_error" + MisAsignacionesModule.test.tsx |
| R23 | mis-asignaciones-service.test.ts::"entrega válida → gestion+entregada" / "tx falla → limpia storage (mock)" |
| R24 | gestion-orden-schemas.test.ts::validarEvidencia + "foto no imagen/>max → rechazo" + gestion-config.test.ts |
| R25 | gestion-orden-schemas.test.ts::REPROGRAMAR + esFechaFutura + mis-asignaciones-action.test.ts |
| R26 | mis-asignaciones-service.test.ts::"reprogramar válida" + gestion-orden-repository.test.ts::"fecha DATE" |
| R27 | gestion-orden-schemas.test.ts::DEVOLUCION + mis-asignaciones-action.test.ts |
| R28 | mis-asignaciones-service.test.ts::"devolución válida → devuelta" |
| R29 | gestion-orden-schemas.test.ts::RECHAZO + mis-asignaciones-action.test.ts |
| R30 | mis-asignaciones-service.test.ts::"rechazo válido → rechazada" / "tx falla → limpia storage" |
| R31 | mis-asignaciones-service.test.ts::"orden ajena / origen inválido → rechazo sin efectos" (escoger/gestionar) |
| R32 | mis-asignaciones-service.test.ts::cada rama fija solo el estatus resultante (sin efectos 37/46/47/48/49) |
| R33 | EstatusLabel.test.ts + order-status.test.ts + build verde (EstatusBadge Record exhaustivo) |
| R34 | este mapa; storage siempre mockeado vía IFileStorage/ISignedUrlProvider (patrón feature 21/22) |

Todos los R0–R34 mapeados a al menos un test concreto. **Trazabilidad: sí (completa).**

---

## 5. Deudas y hallazgos (declarados)

1. **Bucket gestion-evidencias (TAREA HUMANA):** crear en Supabase el bucket privado NUEVO
   `gestion-evidencias` (NO reusar mensajero-docs). El código lo referencia por env
   `GESTION_EVIDENCIA_BUCKET` (default gestion-evidencias). Sin el bucket, la subida de evidencias falla en runtime.
2. **Migración no aplicada (deuda ACEPTADA):** `20260711150000_gestion_orden_estados_metodo_pago`
   no se aplicó contra Postgres (no hay DB en el entorno). Cubierta por test de integración
   ESTÁTICO (`gestion-orden-migration.test.ts`), que verifica también la RLS. Pendiente
   `pnpm db:migrate` (up) y `pnpm db:rollback` (down) en entorno con DB. `prisma generate` sí ejecutado.
3. **Env vars nuevas (con defaults):** `GESTION_EVIDENCIA_BUCKET`, `GESTION_MAX_FILE_BYTES` (5 MB),
   `GESTION_SIGNED_URL_TTL_SECONDS` (300).
4. **E2E T21 (Playwright) PENDIENTE:** camino feliz recoger→escoger→ENTREGAR con foto+monto+método.
   No ejecutable de extremo a extremo sin DB real ni bucket; queda como verificación manual
   una vez aplicada la migración y creado el bucket. Marcado como deuda (T21 sin cerrar).
5. **Sidebar por rol:** el sidebar no filtraba por rol; se resolvió con rol opcional alimentado
   por el layout ahora async. La PÁGINA valida el rol server-side como defensa real.
6. **Sin acción "soltar":** si el mensajero abre el modal de gestión (que ya fijó ordenEnGestionId
   vía escogerParaGestion) y cancela sin registrar resultado, el puntero persiste (bloqueo robusto
   a recarga por diseño). El backend solo libera al gestionar. Señalado por si se desea una acción
   de liberación futura.
7. **No-regresión:** se ajustaron tests preexistentes por el conteo de catálogo (10→12) y el orden
   de migraciones, sin tocar lógica de features 6/7/17/26/30/32; contratos estables.

## 6. Estado de tasks
T1–T18 marcadas `[x]` en tasks.md. **T19, T20 y T21 marcadas `[x]`** tras el ciclo de correcciones
(ver §7): el mapa R→test está completo (incluye R35), `./init.sh` queda verde y el E2E scaffold
cierra T21 (escrito, typecheckea, NO ejecutado — patrón del repo, ver `e2e/auth.spec.ts`).

---

## 7. Ciclo de correcciones (post-review RECHAZADO) — 2026-07-11

Cierres de checkpoint + 3 arreglos menores sobre la impl base (commit `9efe147`). Coordinado por el
`implementer` delegando en `backend_dev` (A/B/C + R35) y `frontend_dev` (cableado + E2E). Decisión
humana: AÑADIR el E2E ahora (no diferirlo), siguiendo el patrón "escrito pero NO ejecutado".

### 7.1 Arreglos aplicados
1. **BLOQUEANTE-2 / T21 — E2E scaffold.** `e2e/mis-asignaciones.spec.ts` (nuevo): camino feliz del
   recaudo (mensajero → recoger `en_espera_aceptacion`→`en_reparto` → gestionar → ENTREGADA con
   foto + `montoRecibido == montoCobrar` + método → `entregada`) + camino RECHAZO (foto+motivo →
   `rechazada`) + REPROGRAMAR (fecha futura+motivo → `reprogramada`). Usa selectores reales
   (regiones por `aria-label`, botones por texto, `Resultado de la gestión`/`Monto recibido`/
   `Método de pago`/`Foto de evidencia…`/`Motivo`). Incluye la MISMA EXECUTION NOTE que
   `e2e/auth.spec.ts` (requiere dev server + DB test + mensajero sembrado + bucket
   `gestion-evidencias`). TYPECHECKEA; NO se ejecuta (no corre en `pnpm test`).
2. **menor-1 — `withErrorHandler` en las actions.** `lib/actions/mis-asignaciones.ts`: nueva
   `toMisAsignacionesActionError` (espejo de `toGuiaActionError`) y las 4 actions + la nueva
   `liberarGestion` envueltas en `withErrorHandler` (patrón `ordenes-guia.ts`): un error excepcional
   (caída de DB en la tx, fallo de storage) pasa por el manejador (se normaliza/loguea) en vez de
   propagarse crudo; los retornos de dominio (forbidden/conflict/validation_error/unauthenticated)
   intactos.
3. **menor-3 — liberar el puntero al CANCELAR.** Backend: `IGestionOrdenRepository`/
   `GestionOrdenRepository` → `liberarOrdenEnGestion(mensajeroId, ordenId)` (`updateMany` con
   `where: { id: mensajeroId, ordenEnGestionId: ordenId }` → concurrencia-seguro, solo el puntero
   propio y solo si apunta a esa orden). `IMisAsignacionesService`/`MisAsignacionesService` →
   `liberarGestion(ordenId, actor)` (forbidden si no es mensajero; ok idempotente). `gestion-orden.ts`
   → `liberarSchema` + `LiberarResult`; action `liberarGestion`. Frontend
   (`MisAsignacionesModule.tsx`): handler `cancelarGestion` cableado al `onOpenChange(!next)` del
   `GestionarOrdenModal` (libera + `router.refresh`); el path de ÉXITO NO libera (el backend ya
   limpió el puntero en su transacción). → **R35**.
4. **menor-2 — comparación de montos en Decimal.** `MisAsignacionesService.ts`: la rama `entregada`
   usa `new Prisma.Decimal(input.montoRecibido).equals(new Prisma.Decimal(orden.montoCobrar))` en
   vez de `!==` sobre float; preserva la regla (h) y el `validation_error` si no cuadra.
5. **BLOQUEANTE-1 — bookkeeping.** T19/T20/T21 → `[x]` en `tasks.md`.

### 7.2 Archivos tocados en el ciclo
Backend: `lib/actions/mis-asignaciones.ts`, `lib/services/MisAsignacionesService.ts`,
`lib/repositories/GestionOrdenRepository.ts`, `lib/interfaces/repositories/IGestionOrdenRepository.ts`,
`lib/interfaces/services/IMisAsignacionesService.ts`, `lib/types/gestion-orden.ts`.
Frontend: `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`, `e2e/mis-asignaciones.spec.ts`.
Spec/tests: `specs/36-mensajero-mis-asignaciones/requirements.md` (R35 + fila de trazabilidad),
`tests/unit/actions/mis-asignaciones-action.test.ts`, `tests/unit/services/mis-asignaciones-service.test.ts`,
`tests/unit/repositories/gestion-orden-repository.test.ts`, `tests/components/MisAsignacionesModule.test.tsx`.

### 7.3 Trazabilidad nueva
| Req | Test (archivo::caso) |
| --- | --- |
| R35 | gestion-orden-repository.test.ts::"liberarOrdenEnGestion limpia solo el propio puntero que apunta a esa orden / count 0 → false" + mis-asignaciones-service.test.ts::"liberarGestion: rol != mensajero → forbidden / mensajero → ok delega" + mis-asignaciones-action.test.ts::"liberarGestion: unauthenticated / validation_error / ok" + MisAsignacionesModule.test.tsx::"cancelar modal → liberarGestion + refresh; éxito → NO libera" |

R0–R34 intactos; R35 aditivo (no se renumeró nada). menor-1 cubierto por
mis-asignaciones-action.test.ts (error excepcional vía withErrorHandler); menor-2 por
mis-asignaciones-service.test.ts (Decimal exacto ok / diferencia mínima → validation_error).

### 7.4 Verificación ejecutable (salida real del ciclo)
- `./init.sh` → **== init OK ==** (verde).
- `pnpm run typecheck` (tsc --noEmit, incluye `e2e/mis-asignaciones.spec.ts`): 0 errores.
- `pnpm run lint`: 0 errores (135 warnings preexistentes en `.claude/skills/*`, ninguno de la feature).
- `pnpm test` (vitest): **167 archivos, 1433 tests, todos PASS** (~41s).
- E2E: NO ejecutado (no corre en `pnpm test`; requiere DB/bucket/servidor reales, ver EXECUTION NOTE).

### 7.5 Deudas que SIGUEN abiertas (sin cambios)
- Bucket `gestion-evidencias` (tarea humana) y migración no aplicada contra Postgres (deuda aceptada);
  el E2E queda ESCRITO pero NO EJECUTADO hasta que el entorno (DB test + seed mensajero + bucket) esté listo.
