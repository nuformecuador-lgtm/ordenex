# Implementación 115 — Mensajero: marcar orden para "gestionar más tarde" (BACKEND)

Rama: `feature/115-marcar-gestionar-luego` (desde `origin/dev`). Zona BACKEND (tasks.md
T1–T7). La zona FRONTEND (T8/T9) queda pendiente para `frontend_dev` (ver más abajo).

## Archivos creados

- `db/migrations/20260723120000_orden_mensajero_meta/migration.sql` — UP (tabla con AMBAS
  columnas `marcar_luego`+`nota`, UNIQUE, 2 FK CASCADE, índices, RLS sin policies).
- `db/migrations/20260723120000_orden_mensajero_meta/down.sql` — DOWN (`DROP TABLE`).
- `lib/types/orden-mensajero-meta.ts` — `marcarLuegoSchema` + `MarcarLuegoResult` discriminado.
- `lib/interfaces/repositories/IOrdenMensajeroMetaRepository.ts` — contrato del repo.
- `lib/repositories/OrdenMensajeroMetaRepository.ts` — `upsertMarcarLuego` + `findMarcarLuegoByMensajero`.
- `lib/interfaces/services/IOrdenMensajeroMetaService.ts` — contrato del service.
- `lib/services/OrdenMensajeroMetaService.ts` — authz + guarda de propiedad + upsert.
- `lib/actions/orden-mensajero-meta.ts` — Server Action `marcarGestionarLuego`.
- `tests/unit/services/orden-mensajero-meta-service.test.ts`
- `tests/unit/actions/orden-mensajero-meta-action.test.ts`
- `tests/unit/services/mis-asignaciones-marcar-luego.test.ts`
- `tests/integration/repositories/orden-mensajero-meta.int.test.ts`

## Archivos modificados

- `db/schema.prisma` — `model OrdenMensajeroMeta` (`marcarLuego` + `nota String?`) + inversos
  en `Usuario` (`ordenMensajeroMetas`) y `Orden` (`mensajeroMetas`).
- `lib/interfaces/services/IMisAsignacionesService.ts` — `MiAsignacionDTO += marcarLuego?`.
- `lib/services/MisAsignacionesService.ts` — inyecta meta-repo + merge en `toDTO`
  (`findMarcarLuegoByMensajero`, solo filas del propio actor).
- `lib/actions/mis-asignaciones.ts` — `buildService()` pasa el nuevo repo.
- `tests/unit/services/mis-asignaciones-service.test.ts`,
  `mis-asignaciones-causa-devolucion.test.ts`, `mis-asignaciones-orden-ruta.test.ts` —
  fixtures actualizados por el nuevo arg del constructor del service.
- `tests/integration/db/zonas-migration.test.ts` — nueva migración añadida a la lista de
  exclusión de "apendidas después" (patrón del test).

## Nota de diseño (desviación menor documentada)

`MiAsignacionDTO.marcarLuego` se declaró **opcional** (`marcarLuego?: boolean`) en vez de
requerido, siguiendo la convención aditiva ya establecida en el repo para
`OrdenDTO.mensajeroAsignadoId?`/`prioridad?`: no rompe los fixtures de `MiAsignacionDTO` que
construyen otros tests de componentes (fuera del alcance de esta feature) sin tocar ningún
`.tsx`. El productor `toDTO` SIEMPRE fija un `boolean` concreto (`false` por defecto, o la
marca real del actor), así que R17 se cumple: el listado siempre incluye el valor por orden.

## Mapa R<n> → test (R backend: R1–R17, R20)

| R | Descripción | Test |
| - | ----------- | ---- |
| R1 | tabla con `marcar_luego` + UNIQUE | `orden-mensajero-meta.int.test.ts` › "R1: crea la tabla…", "R1/R7: UNIQUE…" |
| R2 | columna `nota` NULLABLE nace aquí | `orden-mensajero-meta.int.test.ts` › "R2: la MISMA migracion crea la columna nota…" |
| R3 | RLS habilitada sin policies | `orden-mensajero-meta.int.test.ts` › "R3: habilita RLS y NO define ninguna policy" |
| R4 | migración reversible (down.sql) | `orden-mensajero-meta.int.test.ts` › "R4: DROP TABLE arrastra…" |
| R5 | marcar → `marcar_luego=true` (upsert) | `orden-mensajero-meta-service.test.ts` › "R5: marcar setea…"; `…action.test.ts` happy path |
| R6 | quitar → `marcar_luego=false` | `orden-mensajero-meta-service.test.ts` › "R6: quitar setea false" |
| R7 | idempotencia (sin duplicados) | `orden-mensajero-meta.int.test.ts` › "R7: dos toggles… EXACTAMENTE una fila" |
| R8 | `usuario_id` siempre del actor | `orden-mensajero-meta-service.test.ts` › "R8: usa el usuario_id del actor…"; int › "R8: … usuario_id = actor" |
| R9 | validación de entrada (zod) | `orden-mensajero-meta-action.test.ts` › "T2/R9 …", "T5/R9 …" |
| R10 | sin sesión → `unauthenticated` | `orden-mensajero-meta-action.test.ts` › "T5/R10 …" |
| R11 | rol ≠ mensajero → `forbidden` | `orden-mensajero-meta-service.test.ts` › "R11 …"; action › "R11: propaga forbidden" |
| R12 | solo su propia fila | `orden-mensajero-meta-service.test.ts` › "R12: no puede escribir la fila de otro…" |
| R13 | orden ajena → `forbidden` | `orden-mensajero-meta-service.test.ts` › "R13 …"; int › "R20: m2 marcando o1 → forbidden"; action › "R13 …" |
| R14 | orden inexistente/borrada → `not_found` | `orden-mensajero-meta-service.test.ts` › "R14 …"; action › "R14: propaga not_found" |
| R15 | no cambia `estatus` | `orden-mensajero-meta-service.test.ts` › "R15/R16 …"; int › "R15/R16 …" |
| R16 | no toca ruta/prioridad/historial | `orden-mensajero-meta-service.test.ts` › "R15/R16 …"; int › "R15/R16 …" |
| R17 | DTO refleja la marca (false si no hay fila) | `mis-asignaciones-marcar-luego.test.ts` › "R17 …"; int › "R17: findMarcarLuegoByMensajero…" |
| R20 | privacidad: solo filas del propio actor | `mis-asignaciones-marcar-luego.test.ts` › "R20 …"; int › "R8/R20: un mensajero no ve las marcas de otro" |

R18/R19 son de la **zona FRONTEND (T8)** y NO se implementan aquí (ver abajo).

## Salida real de verificación (`./init.sh` en verde)

- `pnpm run typecheck` (`tsc --noEmit`): sin errores.
- `pnpm run lint` (`eslint`): `✖ 143 problems (0 errors, 143 warnings)` — 0 errores; los 143
  warnings son preexistentes y ninguno pertenece a los archivos de esta feature.
- `pnpm run test` (`vitest run`): `Test Files 456 passed (456)` · `Tests 4561 passed (4561)`.
- Migraciones: "todas las migraciones tienen down.sql".
- `== init OK ==`.

Nota de entorno: el worktree no trae `.env`; `prisma generate` se corre con un
`DATABASE_URL` dummy (no conecta a la DB). El round-trip real de la migración (up→down→up)
contra Postgres lo verifica el humano (patrón del repo: la suite usa mocks semánticos de
Prisma y asserts estáticos sobre el SQL, no levanta Postgres).

## PENDIENTE — zona FRONTEND (para `frontend_dev`)

**T8 (R18/R19/R5/R6 en la UI) queda sin hacer**, por decisión de reparto de trabajo:
- `app/(app)/mis-asignaciones/_components/MarcarLuegoToggle.tsx` **[NUEVO]** — control de card.
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` — badge "Gestionar más
  tarde" (R18), `useMemo` con sort estable que hunde las marcadas al final (R19), y montar el
  toggle que llama a `marcarGestionarLuego({ ordenId, marcarLuego: !actual })` + `router.refresh()`.
- `tests/components/MarcarLuegoToggle.test.tsx` **[NUEVO]**.
- T9 (E2E) opcional.

El backend deja todo listo: la Server Action `marcarGestionarLuego` y `MiAsignacionDTO.marcarLuego`
(siempre presente) están disponibles para la UI. NO se tocó ningún `.tsx` ni `MisAsignacionesModule.tsx`.

## Veredicto

Backend de la feature 115 COMPLETO y verificado (typecheck/lint/test en verde, 4561 tests);
falta solo la capa visual (T8/T9) a cargo de frontend_dev.
