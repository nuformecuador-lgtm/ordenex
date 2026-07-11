# impl — Feature 33: bodega satélite "Mis asignaciones" y recepción por QR

> Zone: `fullstack` · complexity: `high` · branch: `feature/33-recepcion-qr-satelite`
> Ciclo único (backend → frontend). F1.4 APROBADA 2026-07-11 (AMBOS mecanismos de escaneo).
> Estado: implementado, suite en verde, `./init.sh` = `== init OK ==`. Pendiente de review.

## Resumen de lo implementado

### Backend (T1–T10)
- Nuevo 13.º valor de catálogo `en_bodega_satelite` en `ORDER_STATUS_SEED` + migración versionada con `down.sql` (patrón feature 30).
- Repo: `findUsuarioZonaId`, `findRecepcionSateliteByZona`, `recibirEnSatelite` (+ `RecepcionSateliteRow`, proyección `WITH_RECEPCION_SATELITE`).
- Service `RecepcionSateliteService` (`listar`/`recibir`) con la máquina de resultados de design §2.3 (forbidden → sin_zona → no_encontrada → zona_ajena → ya_recibida → estado_invalido → transición → race:conflict/ya_recibida). Idempotente (R14), guardado por estado+zona en la escritura (R18); no toca `mensajero_asignado_id`/`num_guia`.
- Server Actions `listarRecepcionSatelite` / `recibirPorQr` (zod `recibirSchema`, `withErrorHandler`, `resolveActorFromSession`, `deps` inyectable).

### Frontend (T11–T13, T15)
- Ruta NUEVA `app/(app)/recepcion-satelite/` (NO `mis-asignaciones`, que es del mensajero, feature 36). Página Server Component protegida por rol `adminSatelite` → `notFound` si no.
- `RecepcionSateliteModule`: dos secciones separadas "Por recibir" (`en_ruta_bodega_satelite`) y "Recibidas" (`en_bodega_satelite`), estado legible "En bodega satélite de <zona>", aviso si `sinZona`, `router.refresh()` tras recepción. Sin acciones de asignar/gestionar (R7).
- `EscanerRecepcion`: AMBOS caminos (decisión F1.4-a) — cámara (`html5-qrcode`, import dinámico client-only) + input keyboard-wedge; feedback por ítem con toast por cada resultado.
- Sidebar: ítem "Recepción satélite" visible solo para `adminSatelite`.
- E2E `e2e/recepcion-satelite.spec.ts` (escrito, ejecución diferida, typechequea con selectores reales).

## Migración y dependencia de cámara
- Carpeta: `db/migrations/20260711160000_order_status_en_bodega_satelite/` (`migration.sql` + `down.sql`, patrón EXACTO de la feature 30; `ALTER TYPE ADD VALUE IF NOT EXISTS` + `INSERT ON CONFLICT DO NOTHING`; down condicional, sin `DROP VALUE`).
- Dependencia de cámara elegida: **`html5-qrcode@2.3.8`** (mantenida, autocontenida, gestiona el ciclo de vida de la cámara). Añadida a `package.json` (`dependencies`) + `pnpm-lock.yaml`. Cargada con import dinámico dentro del Client Component (nunca en SSR). `pnpm run build` COMPILA y typechequea con la dep.

## Archivos creados / modificados

### Backend — creados
- `lib/interfaces/services/IRecepcionSateliteService.ts`
- `lib/services/RecepcionSateliteService.ts`
- `lib/types/recepcion-satelite.ts`
- `lib/actions/recepcion-satelite.ts`
- `db/migrations/20260711160000_order_status_en_bodega_satelite/{migration.sql,down.sql}`
- `tests/integration/db/order-status-en-bodega-satelite-migration.test.ts`
- `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts`
- `tests/unit/services/recepcion-satelite-service.test.ts`
- `tests/unit/actions/recepcion-satelite-action.test.ts`

### Backend — modificados
- `lib/types/order-status.ts` (13.º valor)
- `lib/interfaces/repositories/IOrdenRepository.ts` (`RecepcionSateliteRow` + 3 firmas)
- `lib/repositories/OrdenRepository.ts` (3 métodos + proyección)
- `app/(app)/ordenes/_components/estatus-label.ts` (label "En bodega satélite", build-green)
- `app/(app)/ordenes/_components/EstatusBadge.tsx` (entradas en los `Record<OrderStatusValue,…>`, build-green)
- Tests build-green/no-regresión: `tests/components/EstatusLabel.test.ts`, `tests/unit/types/order-status.test.ts`, `tests/unit/scripts/seed-order-status.test.ts`, `tests/integration/db/order-status-enum-migration.test.ts`, fakes de `IOrdenRepository` en `tests/unit/services/{orden-service,bulk-orden-service,asignacion-mensajero-service,rol-admin-satelite-authz}.test.ts`, y exclusión de la nueva migración en los 4 tests de orden temporal (`{postulacion-mensajero,usuario-fulfillment,vehiculos,zonas}-migration.test.ts`).

### Frontend — creados
- `app/(app)/recepcion-satelite/page.tsx`
- `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx`
- `app/(app)/recepcion-satelite/_components/RecepcionDetalle.tsx`
- `app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx`
- `e2e/recepcion-satelite.spec.ts`
- `tests/components/RecepcionSatelitePage.test.tsx`
- `tests/components/RecepcionSateliteModule.test.tsx`
- `tests/components/EscanerRecepcion.test.tsx`

### Frontend — modificados
- `app/(app)/_components/Sidebar.tsx` (ítem adminSatelite)
- `tests/components/Sidebar.test.tsx`
- `package.json` + `pnpm-lock.yaml` (html5-qrcode)

## Trazabilidad R1–R23 → test

| Req | Test (ruta : nombre) |
| --- | --- |
| R1  | `tests/unit/types/order-status.test.ts` : incluye `en_bodega_satelite` (13.º) · `seed-order-status.test.ts` : siembra 13 / idempotente |
| R2  | `tests/integration/db/order-status-en-bodega-satelite-migration.test.ts` : ALTER TYPE ADD VALUE + INSERT ON CONFLICT |
| R3  | `recepcion-satelite-service.test.ts` : rol≠adminSatelite→forbidden · `recepcion-satelite-action.test.ts` : unauthenticated · `RecepcionSatelitePage.test.tsx` : notFound por rol/sin actor · `Sidebar.test.tsx` : ítem solo adminSatelite |
| R4  | `orden-repository.recepcion-satelite.test.ts` : zona server-side · service : separa de SU zona |
| R5  | repo : `null` si sin zona · service : sin_zona / listas vacías+sinZona · `EscanerRecepcion.test.tsx` : sin_zona toast · `RecepcionSateliteModule.test.tsx` : aviso sinZona |
| R6  | repo : filtra zona+estatus+no borradas · service : grupo `porRecibir` · `RecepcionSateliteModule.test.tsx` : dos secciones |
| R7  | `RecepcionSateliteModule.test.tsx` : "Por recibir" no expone asignar/gestionar |
| R8  | repo/service : grupo `recibidas` · `RecepcionSateliteModule.test.tsx` : sección "Recibidas" |
| R9  | `RecepcionSateliteModule.test.tsx` : "En bodega satélite de <zona>" · `EstatusLabel.test.ts` : label |
| R10 | `recepcion-satelite-action.test.ts` : texto→delega · `EscanerRecepcion.test.tsx` : Enter→recibirPorQr, limpia+refresh |
| R11 | service : origen válido→en_bodega_satelite · repo : UPDATE no toca mensajero/numGuia |
| R12 | service : zona_ajena sin efectos · `EscanerRecepcion.test.tsx` : toast otra zona |
| R13 | service : estado_invalido con estado actual · `EscanerRecepcion.test.tsx` : toast estado |
| R14 | service : ya_recibida idempotente sin escribir · `EscanerRecepcion.test.tsx` : toast info+refresh |
| R15 | service : inexistente/borrada→no_encontrada · `EscanerRecepcion.test.tsx` : toast no encontrada |
| R16 | `recepcion-satelite-action.test.ts` : vacío/espacios→validation_error sin service · `EscanerRecepcion.test.tsx` : toast código inválido |
| R17 | `recepcion-satelite-service.test.ts` : forbidden antes de tocar datos |
| R18 | repo : true/false (race) · service : race→ya_recibida/conflict |
| R19 | no-regresión: contratos 17/30 intactos + suite completa verde; `en_ruta_bodega_satelite` sólo lo escribe la 30 |
| R20 | migration test : un solo valor nuevo |
| R21 | migration test : down reversible/condicional + estructura de carpeta |
| R22 | service (todas las ramas) + action (texto) + E2E `e2e/recepcion-satelite.spec.ts` (typechequea, ejecución diferida); lector físico y cámara = verificación MANUAL |
| R23 | esta tabla (la valida el reviewer) |

Todos los R1–R23 tienen al menos un test asociado.

## Salida real de las puertas de calidad
- `pnpm run typecheck`: VERDE (`tsc --noEmit`, incluye el E2E).
- `pnpm run lint`: 0 errores (135 warnings pre-existentes, todos en `.claude/skills/impeccable/scripts/*`, no tocados por esta feature).
- `pnpm test`: **174 archivos, 1493 tests, todos passed** (0 fallos).
- `./init.sh`: `== init OK ==` (todas las migraciones tienen down.sql; suite verde).
- `pnpm run build`: compila + typechequea CON la dep de cámara. Falla ÚNICAMENTE el prerender estático de `/postulacion` — pre-existente (feature 21, commit `c5c1c97`), ambiental (`prisma.vehiculo.findMany()` sin tablas en el entorno de build). Ajeno a la feature 33 y a la dep de cámara.

## E2E
`e2e/recepcion-satelite.spec.ts` escrito con la misma "EXECUTION NOTE" de ejecución diferida que `e2e/mis-asignaciones.spec.ts` / `e2e/auth.spec.ts`. Flujo: login adminSatelite → `/recepcion-satelite` → escribe `orden.id` en el input keyboard-wedge + Enter → verifica feedback y paso a "Recibidas" (`en_bodega_satelite`). TYPECHEQUEA con selectores reales (roles/aria-labels). NO se ejecuta en `pnpm test`.

## Deudas / hallazgos declarados
1. **Migración no aplicada contra Postgres real** (DEUDA ACEPTADA): sin DB en el entorno. Cubierta por test de integración ESTÁTICO por regex (patrón feature 30): verifica `ALTER TYPE ADD VALUE`, `INSERT ON CONFLICT`, `down.sql` condicional y nota de no-`DROP VALUE`. `pnpm db:migrate` / `pnpm db:rollback` contra Postgres = pendiente de entorno con DB.
2. **Verificación MANUAL** (no automatizable sin hardware/media): (a) lector físico keyboard-wedge, (b) camino de cámara (getUserMedia + decodificación QR). La lógica de recepción dado `orden.id` está cubierta a nivel service/action; el input keyboard-wedge como texto en component test + E2E.
3. **Build `/postulacion`**: falla de prerender pre-existente (feature 21), ambiental por falta de DB. No introducida por esta feature.
