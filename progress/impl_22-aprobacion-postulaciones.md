# Impl feature 22 — Aprobación de postulaciones de mensajeros (backend puro, sin migración)

> Rama `feature/22-aprobacion-postulaciones`. Decisiones F1.4 aplicadas:
> P1 RECHAZAR→`inactivo` / APROBAR→`activo` (cero migraciones), P2 sin motivo,
> P3 TTL URL firmada 300 s configurable, P4 sin auditoría. Reusa contexto de la
> feature 21 (schema, storage, repos de documentos) sin duplicar ni migrar.

## Archivos creados

Producción:
- `lib/config/aprobacion-postulaciones.ts` — `SIGNED_URL_TTL_SECONDS` (default 300, env), `PAGE_SIZE_DEFAULT`/`PAGE_SIZE_MAX` (R9/R10).
- `lib/types/aprobacion-postulacion.ts` — `PostulacionPendienteDTO`, `DocumentoFirmadoDTO`, `listarPostulacionesSchema`, `idSchema`, `ListarPostulacionesResult`, `DecisionResult` (reusa `ActionError`).
- `lib/interfaces/external/ISignedUrlProvider.ts` — contrato de firma de URLs.
- `lib/interfaces/repositories/IAprobacionPostulacionRepository.ts` — `listPendientes`, `findMensajeroById`, `actualizarEstadoSiPendiente`, tipos `PostulacionRow`/`MensajeroEstado`.
- `lib/interfaces/services/IAprobacionPostulacionService.ts` — `listarPendientes`/`aprobar`/`rechazar` + results de dominio.
- `lib/repositories/AprobacionPostulacionRepository.ts` — solo Prisma; filtro rol `mensajero` + estado `pendiente` con include catálogos/documentos; `updateMany` condicional anti-carrera.
- `lib/services/AprobacionPostulacionService.ts` — guard `ROLES_APROBADORES={maestro,admin}`, paginación, URLs firmadas, transición atómica con distinción `not_found`/`conflict` vía count+reconsulta.
- `lib/storage/SupabaseSignedUrlProvider.ts` — `ISignedUrlProvider` sobre `createServerClient().storage.from(bucket).createSignedUrl(s)`, cliente inyectable para test sin red.
- `lib/actions/aprobacion-postulaciones.ts` — 3 Server Actions (`'use server'`): `listarPostulacionesPendientes`, `aprobarPostulacion`, `rechazarPostulacion`; `resolveActorFromSession` + `withErrorHandler` + `toActionError`; `deps` inyectables.

Tests:
- `tests/unit/services/aprobacion-postulacion-service.test.ts`
- `tests/integration/actions/aprobacion-postulaciones-action.test.ts`
- `tests/unit/storage/supabase-signed-url-provider.test.ts`
- `tests/unit/repositories/aprobacion-postulacion-repository.test.ts`

Sin migraciones, sin cambios en `app/`, `components/`, schema Prisma ni código de la feature 21.

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | action: 3 funciones exportadas `'use server'` en `aprobacion-postulaciones.ts` (sin route handler) |
| R2 | service `R2: maestro y admin autorizados en las 3 operaciones` (parametrizado maestro/admin) |
| R3 | service `R3/R5: roles no autorizados -> forbidden sin tocar repo/signedUrl` (mensajero/adminTienda/adminSatelite) |
| R4 | action `R4: sin sesion valida -> unauthenticated sin tocar el service` (listar/aprobar/rechazar) |
| R5 | service `R3/R5: ... forbidden sin tocar repo/signedUrl` (asserts repo/signed no llamados) |
| R6 | service `R6: devuelve las postulaciones pendientes que entrega el repo`; repo `R6/R7/R8: listPendientes filtra rol+estado` |
| R7 | service `R7: el DTO incluye identidad y contacto completos`; repo `R7: mapea vehiculo null` |
| R8 | service `R8: cada item trae 5 documentos con URL firmada`; provider `firma una URL...`/`batch` |
| R9 | service `R9: firma con SIGNED_URL_TTL_SECONDS y lo expone en el DTO`; provider `firma varias URLs en batch...ttl` |
| R10 | service `R10: traduce page/pageSize a skip/take y devuelve el total del repo` |
| R11 | service `R11: sin pendientes devuelve lista vacia...`; repo `R11: sin pendientes devuelve items vacios y total 0` |
| R12 | service `R12/R15: aprobar pendiente cambia estado a activo...`; repo `R12/R14/R18: updateMany condicional` |
| R13 | service `R13: aprobar id que no es mensajero -> not_found` |
| R14 | service `R14: aprobar mensajero no pendiente -> conflict` + `R14/R18 (carrera)...`; repo `R14/R18: count 0` |
| R15 | service `R12/R15: ...` (no reconsulta ni toca otro dato en camino feliz) |
| R16 | service `R16/R19: rechazar pendiente cambia estado a inactivo (no borra)` |
| R17 | service `R17: rechazar id inexistente/no mensajero -> not_found` |
| R18 | service `R18: rechazar mensajero no pendiente -> conflict`; repo `R14/R18: count 0` |
| R19 | service `R16/R19: ...` (repo sin delete; solo cambia estado) |
| R20 | action `R20: mapea los status de dominio al resultado tipado` (forbidden/not_found/conflict/ok listar y decisión) |
| R21 | action `R21: id invalido -> validation_error sin llamar al service` (id vacío / no-string) |

## Verificación (post-merge con `origin/dev`, F2.3)

La rama se sincronizó con `origin/dev` (merge `14ce336`), que trajo el hotfix
`5bf3e73` (completa el mock de `IUserRepository` en
`tests/unit/services/postulacion-login-regresion.test.ts`). Con eso el único rojo
de typecheck previo quedó resuelto.

- `npx tsc --noEmit`: **exit 0, cero errores** (suite completa, exit code real).
- `npx eslint .`: **exit 0, 0 errores** (135 warnings, todos en scripts de
  `.claude/skills/`, preexistentes y ajenos a la feature).
- Tests F22 aislados: **40 passed / 40** (4 archivos).
- `npx vitest run` (suite COMPLETA): **998 passed / 999** — el único fallo es
  `tests/integration/recuperar-contrasena-form.test.tsx` (feature 20), timeout
  flaky bajo carga paralela; **reejecutado aislado pasa 7/7**. No bloqueante y no
  relacionado con F22.

## Notas
- `package-lock.json` generado por `npm install` fue borrado (el repo usa pnpm).
- `.env` copiado del repo principal y `prisma generate` ejecutado en el worktree.
- Sin `console.log` de PII ni de URLs firmadas.

## Veredicto
Backend de la feature 22 completo y verde tras sincronizar con dev: typecheck 0
errores, lint 0 errores, suite 998/999 (único rojo = flaky preexistente de la
feature 20 que pasa aislado). R1–R21 mapeados a tests reales.
