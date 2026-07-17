# Bitácora — Feature 89: novedades incluye las devoluciones del mensajero

> Backend puro. Re-ancla la query de `/novedades` (feature 87) del estatus ACTUAL
> `= "devuelta"` al predicado "tiene gestión de devolución VIGENTE Y la orden aún
> no está cerrada". Sin migración, sin cambios de frontend ni de tipos del DTO.

## Rama / worktree

- Worktree: `ordenex-f89`, rama `feature/89-novedades-devoluciones-mensajero`
  desde `origin/dev` (`28d5bf7`, ya trae la feature 87).

## Archivos tocados

| Archivo | Task | Cambio |
| --- | --- | --- |
| `lib/interfaces/repositories/IOrdenRepository.ts` | T1a | firma `estatusValue: string` → `cerrados: string[]` en `countDevueltasByTienda`/`findDevueltasByTienda`; JSDoc al predicado R1–R8. `CausaDevueltaVigente`/`NovedadOrdenRow` sin cambios. |
| `lib/interfaces/services/INovedadesService.ts` | T1b | JSDoc a la semántica "devuelta vigente y abierta"; sin cambio de firma. |
| `lib/repositories/OrdenRepository.ts` | T2 | helper privado `novedadWhere(tiendaId, cerrados)` (predicado central) usado en count Y find (R8). `where`: `deletedAt: null`, `estatus.value.notIn = cerrados`, `gestiones.some { resultado: "devuelta", anuladaAt: null }`. `findCausasDevueltaVigentes` sin cambios. |
| `lib/services/NovedadesService.ts` | T3 | `ESTATUS_DEVUELTA = "devuelta"` → `ESTATUS_CERRADOS = ["entregada","devuelta_origen","recibido_origen"]`, pasada a count/find. Mapeo a DTO, rol, paginación 10 y orden por recencia intactos. |
| `tests/unit/repositories/orden-repository.novedades.test.ts` | T5 | dobles de Prisma; verifica el `where` construido (R1/R3/R4/R5/R6/R7/R8). |
| `tests/unit/services/NovedadesService.test.ts` | T4 | repo mockeado; contrato del service (R8/R9/R10/R11/R12/R13). |

**NO tocados** (decisión #2): `lib/types/novedad.ts`,
`app/(app)/novedades/_components/NovedadesModule.tsx`, `lib/actions/novedades.ts`.

## Confirmaciones contra `schema.prisma`

- Back-relation en `Orden`: `gestiones GestionOrden[]` (`db/schema.prisma:347`). ✓
- `GestionOrden.resultado` es enum `GestionResultado` con valor `devuelta`
  (`schema.prisma:373-379`). ✓ (`RESULTADO_DEVUELTA = "devuelta"` ya existía en el repo, feature 87).
- `GestionOrden.anuladaAt` `DateTime? @map("anulada_at")` (feature 67, `schema.prisma:424`). ✓
- Los 3 valores de cierre existen en `ORDER_STATUS_SEED` (`lib/types/order-status.ts:20/22/33`). ✓

## Mapa R → test (archivo::caso)

| R | Test |
| --- | --- |
| R1 | `orden-repository.novedades.test.ts` :: "R1/R3/R5/R7: cuenta con el predicado central" + "R1/R3/R5/R7/R12: where central..." (gestión devuelta vigente + estatus != cerrado) |
| R2 | `orden-repository.novedades.test.ts` :: `estatus.value.notIn` = cerrados (orden abierta incluida) |
| R3 | `orden-repository.novedades.test.ts` :: "R1/R3/R5/R7..." (`notIn` excluye entregada/devuelta_origen/recibido_origen) |
| R4 | `orden-repository.novedades.test.ts` :: "R4: `en_bodega` (reintento) y `rechazada` (escalado) NO están en `cerrados`" |
| R5 | `orden-repository.novedades.test.ts` :: `where.deletedAt` toBeNull (borrada excluida) |
| R6 | `orden-repository.novedades.test.ts` :: "R6: el `some` incluye la orden una sola vez" + "R6: reduce a la fila MÁS RECIENTE por orden" |
| R7 | `orden-repository.novedades.test.ts` :: "R7: filtra `resultado=devuelta` y `anuladaAt=null`" (`some.anuladaAt: null`) |
| R8 | `orden-repository.novedades.test.ts` :: "R8: ambos métodos construyen exactamente el mismo predicado" + `NovedadesService.test.ts` :: "R8: count y find se invocan con el MISMO conjunto `cerrados`" |
| R9 | `NovedadesService.test.ts` :: "R9: acota al `tiendaId = actor.usuarioId` en count y en la lista" |
| R10 | `NovedadesService.test.ts` :: "R10: la causa fluye al DTO..." + "R10: orden sin gestión vigente / causa nula -> causa null" |
| R11 | `NovedadesService.test.ts` :: "R11: rol != adminTienda -> forbidden sin tocar el repo" |
| R12 | `NovedadesService.test.ts` :: "R12: ordena por la fecha de la última gestión vigente desc" + "R12 (fallback): sin gestión vigente ordena por Orden.createdAt desc" + "R13/R12: ... skip derivado" |
| R13 | `NovedadesService.test.ts` :: "R13/R12: respuesta { items, total, page, pageSize }" + "R8/R13: página vacía -> items [] con total" |

## Verificación

- `pnpm typecheck` → **0 errores** (baseline del leader = 0, mantenido).
- `pnpm lint` → **0 errores**, 140 warnings (todos preexistentes en archivos ajenos:
  `.claude/skills/*`, `app/(app)/configuracion/...`, `lib/actions/cierres-admin.ts`,
  `lib/services/EtiquetaGuiaService.ts`; ninguno en los archivos tocados).
- Tests aislados (`NovedadesService.test.ts` + `orden-repository.novedades.test.ts`):
  **2 archivos / 17 tests, todos verde.**
- `pnpm test` (suite completa) → **341 archivos passed / 1 failed; 3313 tests passed / 1 failed.**
  - Único fallo: `tests/components/CierreDiaPage.test.tsx` :: `getByRole("region", { name: "Entregadas" })`.
    **Preexistente y AJENO:** es un test de componente de frontend (feature de cierre de día),
    fuera del alcance backend de la 89; ninguno de sus archivos fue tocado. Ya venía nombrado
    como fallo preexistente en el encargo del leader (drift PR #82). No es regresión de esta feature.

## Tasks

- [x] T1a — interfaz repo (firma + JSDoc)
- [x] T1b — interfaz service (JSDoc)
- [x] T2 — repo: helper `novedadWhere` + predicado central en count/find
- [x] T3 — service: `ESTATUS_CERRADOS`
- [x] T4 — tests de service
- [x] T5 — tests de repo
- [x] T6 — typecheck/lint/test

## Veredicto

Feature 89 implementada según spec: `/novedades` re-anclada a la gestión de devolución
vigente + estatus abierto; typecheck 0, lint 0 errores, 17/17 tests propios verde, único
fallo de suite es preexistente y ajeno (CierreDiaPage).
