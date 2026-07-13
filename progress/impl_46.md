# Implementación — Feature 46: reprogramación (bloqueo y liberación programada)

> Rama `feature/46-reprogramacion-bloqueo-liberacion`. Ciclo backend_dev → frontend_dev
> coordinado por el implementer. Spec F1.4 aprobada (todas las recomendaciones).
> NO se abrió PR (eso es F2.3+ tras el reviewer).

## Veredicto

VERDE. Backend (migración + estados destino + guardas de bloqueo + job cron + repo/service)
y frontend (aviso derivado "liberadas hoy" en ambas bodegas) implementados y verificados:
`./init.sh` en verde (typecheck + lint 0 errores + 2056 tests) y round-trip de migración OK.

## Verificación ejecutable

- `./init.sh`: VERDE. typecheck limpio; lint 0 errors (135 warnings PREEXISTENTES en
  `.claude/skills/**`, ajenos a la feature); todas las migraciones con `down.sql`; `.env` presente.
- Tests: **antes 2008** (223 files) → **después 2056** (230 files), todos verdes.
  - Nuevos: 48 (backend 39 + frontend 9 unit/componente) + 3 escenarios E2E (diferidos, ver abajo).
- Round-trip de migración `20260713100000_orden_liberada_reprogramada_at` contra Postgres
  LOCAL (localhost:5432): **OK**. Verificado por SQL directo con aserciones `RAISE EXCEPTION`:
  - UP (`migration.sql`) → columna `liberada_reprogramada_at` NULLABLE + índice parcial
    `orden_liberada_reprogramada_at_idx ... WHERE liberada_reprogramada_at IS NOT NULL` PRESENTES.
  - DOWN (`down.sql`) → columna e índice AUSENTES.
  - RE-UP → PRESENTES de nuevo (round-trip reversible e idempotente).
  - Estado final: DB revertida (down) para quedar consistente con el `pending` que reporta Prisma.
  - MATIZ DE ENTORNO (no defecto de la 46): el flujo `pnpm run db:migrate`/`db:rollback` NO
    corre limpio porque el Postgres local tiene aplicada `20260712170000_wallet_tienda_movimiento`
    (feature 43) que NO existe en esta rama (última común: `20260712160000_wallet_movimiento`).
    `prisma migrate status`: "The migration from the database are not found locally". Por eso
    el round-trip se validó con `prisma db execute` sobre el SQL real. Quien resuelva el drift
    de la 43 aplicará la 46 con `migrate deploy` sin conflicto.

## Archivos creados

Backend:
- `db/migrations/20260713100000_orden_liberada_reprogramada_at/migration.sql` (+ `down.sql`)
- `lib/utils/fecha-cr.ts` — `startOfDayCR(now?)` (America/Costa_Rica, UTC-6 sin DST)
- `lib/interfaces/repositories/ILiberacionReprogramadaRepository.ts`
- `lib/repositories/LiberacionReprogramadaRepository.ts`
- `lib/interfaces/services/ILiberacionReprogramadaService.ts`
- `lib/services/LiberacionReprogramadaService.ts`
- `lib/services/mensajes-bloqueo.ts` — `MSG_ORDEN_REPROGRAMADA_BLOQUEADA`
- `app/api/cron/liberar-reprogramadas/route.ts`
- Tests: `tests/integration/db/orden-liberada-reprogramada-migration.test.ts`,
  `tests/unit/utils/fecha-cr.test.ts`,
  `tests/unit/repositories/liberacion-reprogramada-repository.test.ts`,
  `tests/unit/services/liberacion-reprogramada-service.test.ts`,
  `tests/integration/actions/liberar-reprogramadas-route.test.ts`

Frontend:
- `lib/actions/liberacion-reprogramada.ts` — Server Action `listarLiberadasHoy` (filtro por rol)
- `components/private/BodegaLiberadasHoy.tsx` — sección/badge "Liberadas hoy (reprogramación)"
- Tests: `tests/components/BodegaLiberadasHoy.test.tsx`,
  `tests/unit/actions/liberacion-reprogramada-action.test.ts`
- E2E: `e2e/reprogramacion-liberacion.spec.ts`

## Archivos modificados

- `db/schema.prisma` — campo `liberadaReprogramadaAt DateTime? @map("liberada_reprogramada_at")` en `Orden`
- `lib/services/GuiaAsignacionService.ts` — guarda `reprogramada` en `generarGuia` y `asignarDesdeBodega`
- `lib/services/AsignacionSateliteService.ts` — guarda `reprogramada` en `asignar`
- `vercel.json` — 2.ª entrada de cron `/api/cron/liberar-reprogramadas` `"0 6 * * *"`
- `app/(app)/ordenes/page.tsx` + `_components/OrdenesRevisionMaestro.tsx` — aviso bodega central (maestro, en_bodega)
- `app/(app)/recepcion-satelite/page.tsx` + `_components/RecepcionSateliteModule.tsx` — aviso bodega satélite (adminSatelite)
- Tests ampliados: `guia-asignacion-service.test.ts`, `asignacion-satelite-service.test.ts`,
  `mis-asignaciones-service.test.ts`, `zonas-migration.test.ts` (excluye la carpeta 46 del check de timestamp)

## Mapa de trazabilidad R<n> -> test

| R | Test que lo verifica |
| --- | --- |
| R1  | tests/unit/services/guia-asignacion-service.test.ts + asignacion-satelite-service.test.ts (bloqueo) |
| R2  | tests/unit/services/guia-asignacion-service.test.ts (generarGuia + asignarDesdeBodega) |
| R3  | tests/unit/services/asignacion-satelite-service.test.ts |
| R4  | tests/unit/services/mis-asignaciones-service.test.ts (recoger/gestionar rechaza reprogramada) |
| R5  | guia-asignacion + asignacion-satelite (rechazo server-side sin efectos) |
| R6  | tests/integration/actions/liberar-reprogramadas-route.test.ts (401 sin construir service) |
| R7  | tests/integration/actions/liberar-reprogramadas-route.test.ts (200 + resumen sin PII) |
| R8  | liberar-reprogramadas-route.test.ts / vercel.json (path + schedule "0 6 * * *") |
| R9  | tests/unit/utils/fecha-cr.test.ts (fronteras 23:59 / 00:01 CR) |
| R10 | tests/unit/repositories/liberacion-reprogramada-repository.test.ts (selección <= hoy) |
| R11 | tests/unit/repositories/liberacion-reprogramada-repository.test.ts (excluye futuras) |
| R12 | tests/unit/services/liberacion-reprogramada-service.test.ts (central->en_bodega, satélite->en_bodega_satelite) |
| R13 | tests/unit/services/liberacion-reprogramada-service.test.ts (limpia mensajero + marca corridaAt) |
| R14 | tests/unit/services/liberacion-reprogramada-service.test.ts (una orden falla => omitidas++, no aborta) |
| R15 | liberacion-reprogramada-repository.test.ts (findLiberadasHoy) + tests/components/BodegaLiberadasHoy.test.tsx |
| R16 | tests/unit/actions/liberacion-reprogramada-action.test.ts (destinatario por rol/zona) + BodegaLiberadasHoy.test.tsx |
| R17 | repository.test.ts (UPDATE 0 filas si ya no está en reprogramada) + service.test.ts (2ª corrida => liberadas=0) |
| R18 | tests/integration/db/orden-liberada-reprogramada-migration.test.ts + round-trip SQL directo (arriba) |
| R19 | tests/integration/actions/liberar-reprogramadas-route.test.ts (sin secreto/PII en respuesta) |
| R20 | liberar-reprogramadas-route.test.ts (controller delega) + ubicación de guardas en servicios de dominio |
| R21 | fuera de alcance CONFIRMADO (ver nota T17 abajo) — sin columnas/tablas de intentos/historial en el diff |

## E2E (T16)

`e2e/reprogramacion-liberacion.spec.ts` escrito (3 escenarios: bloqueo no-asignable; cron 200 +
"liberadas hoy"; cron 401). NO ejecutable en este entorno (`CRON_SECRET` vacío en `.env` y sin
DB sembrada) — MISMA convención que TODOS los `e2e/*.spec.ts` del repo, que están escritos-pero-
diferidos y no corren bajo `pnpm test`. Queda listo para correr con seed + `CRON_SECRET`.

## T17 — fuera de alcance (R21) confirmado

NO se añadió contador de intentos de entrega (feature 47) ni historial de estados (feature 49).
El diff no introduce columnas/tablas de intentos ni historial: la única columna nueva es
`orden.liberada_reprogramada_at` (marca de auditoría/aviso). La 46 solo referencia que 47/49 llegan después.

## Tasks

T1–T18 marcadas `[x]` en `specs/46-reprogramacion-bloqueo-liberacion/tasks.md`.
