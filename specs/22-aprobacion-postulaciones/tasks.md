# Feature 22 — Aprobación de postulaciones de mensajeros — tasks.md

> Backend puro. Sin migraciones (decisión P1 = `inactivo`). Orden con dependencias;
> `[P]` = paralelizable con las tareas del mismo bloque. Cada task ata sus `R<n>`.
> "Hecho" = criterio verificable + `pnpm run typecheck`/`lint` verdes para el archivo.

## Bloque 0 — Contratos y tipos (base, sin dependencias)

- [x] **T1 [P]** Crear `lib/config/aprobacion-postulaciones.ts` con
  `SIGNED_URL_TTL_SECONDS` (default 300, override env) y `PAGE_SIZE_MAX`/
  `PAGE_SIZE_DEFAULT`, patrón de `lib/config/postulacion.ts`.
  Satisface: R9, R10. Hecho: exporta config tipada, sin hardcode; test de config
  lee overrides de env.

- [x] **T2 [P]** Crear `lib/types/aprobacion-postulacion.ts`: `PostulacionPendienteDTO`,
  `ListarPostulacionesInput` + `listarPostulacionesSchema` (zod, page/pageSize
  acotados a `PAGE_SIZE_MAX`), `idSchema`, y tipos de resultado de action
  (`ListarPostulacionesResult`, `DecisionResult`, `ActionError` reusado de orden).
  Satisface: R7, R8, R10, R20, R21. Hecho: schemas parsean casos válidos/ inválidos
  en test de types.

- [x] **T3 [P]** Crear `lib/interfaces/services/IAprobacionPostulacionService.ts`
  con `IAprobacionPostulacionService` (`listarPendientes`, `aprobar`, `rechazar`)
  y sus result de dominio discriminados. Reusa `Actor` de `IOrdenService`.
  Satisface: R2–R5, R12–R21. Hecho: compila; result cubre todos los `status`.

- [x] **T4 [P]** Crear `lib/interfaces/repositories/IAprobacionPostulacionRepository.ts`
  (`findMensajeroById`, `actualizarEstadoSiPendiente`, `listPendientes`,
  `findDocumentos`). Reusa `MensajeroDocumentoDTO` de feature 21.
  Satisface: R6, R7, R8, R12–R19. Hecho: compila.

- [x] **T5 [P]** Crear `lib/interfaces/external/ISignedUrlProvider.ts`
  (`createSignedUrl`, `createSignedUrls`). Satisface: R8, R9. Hecho: compila.

## Bloque 1 — Implementaciones (dependen del Bloque 0)

- [x] **T6** (dep T5) Implementar `lib/storage/SupabaseSignedUrlProvider.ts` sobre
  `createServerClient().storage.from(bucket).createSignedUrl(s)`, con
  `StorageClientLike`-style inyectable para test sin red; bucket desde
  `postulacionConfig.BUCKET`. Satisface: R8, R9. Hecho: unit con doble verifica
  path+ttl pasados y URL devuelta; error de storage se envuelve con contexto.

- [x] **T7** (dep T4) Implementar `lib/repositories/AprobacionPostulacionRepository.ts`
  (solo Prisma): filtro rol `mensajero` + estado `pendiente` con include de
  `tipoIdentificacion`/`vehiculo`/`documentos`; `updateMany` condicional que
  devuelve `count`. Satisface: R6, R7, R8, R11, R12, R14, R16, R18.
  Hecho: unit repo con Prisma mock verifica `where` (rol+estado) y forma de salida.

- [x] **T8** (dep T3, T4, T5, T1) Implementar
  `lib/services/AprobacionPostulacionService.ts`:
  guard `ROLES_APROBADORES={maestro,admin}`; `listarPendientes` (paginación +
  URLs firmadas por documento); `aprobar` (`pendiente→activo`); `rechazar`
  (`pendiente→inactivo`); distinción `not_found` vs `conflict` vía count+reconsulta.
  Satisface: R2, R3, R5, R6–R19. Hecho: los unit del Bloque 2 pasan.

- [x] **T9** (dep T8, T2) Implementar `lib/actions/aprobacion-postulaciones.ts`
  (`'use server'`): `listarPostulacionesPendientes`, `aprobarPostulacion`,
  `rechazarPostulacion` con `resolveActorFromSession` + `withErrorHandler` +
  `toActionError`; `deps` inyectables (`service?`, `getActor?`); zod en el borde.
  Satisface: R1, R4, R20, R21. Hecho: integration action tests pasan.

## Bloque 2 — Tests (dependen de la implementación que cubren)

- [x] **T10 [P]** (dep T8) Unit de service en
  `tests/unit/services/aprobacion-postulacion-service.test.ts` con fakes de repo
  y signed-url-provider (patrón `postulacion-mensajero-service.test.ts`):
  cubre R2, R3, R5, R6–R19. Hecho: un test por comportamiento de la tabla de
  trazabilidad; nombres describen conducta.

- [x] **T11 [P]** (dep T9) Integration de action en
  `tests/integration/actions/aprobacion-postulaciones-action.test.ts` (patrón
  `ordenes-action.test.ts`): cubre R1, R4, R20, R21. Hecho: verifica
  `unauthenticated` sin sesión, mapeo de status, `validation_error` por id inválido.

- [x] **T12 [P]** (dep T6) Unit de `SupabaseSignedUrlProvider`
  (`tests/unit/storage/supabase-signed-url-provider.test.ts`): cubre R8, R9.
  Hecho: doble de storage verifica ttl/path y manejo de error.

- [x] **T13 [P]** (dep T7) Unit de repository
  (`tests/unit/repositories/aprobacion-postulacion-repository.test.ts`): cubre
  R6, R11, R14/R18 (count). Hecho: Prisma mock verifica queries.

## Bloque 3 — Cierre y trazabilidad

- [x] **T14** (dep T10–T13) Escribir `progress/impl_22-aprobacion-postulaciones.md`
  con el mapa `R<n> → test` (copia de la tabla §9 de design). Satisface:
  trazabilidad CHECKPOINTS. Hecho: cada R1..R21 tiene su test nombrado.

- [x] **T15** (dep T14) Verificación final: `pnpm run typecheck`, `pnpm run lint`,
  `pnpm test` y `./init.sh` en verde. Hecho: todo verde; sin `console.log` de PII
  ni de URLs firmadas; sin migraciones nuevas (confirmar con P1=`inactivo`).

## Notas de dependencia

- Bloque 0 es totalmente paralelizable (solo tipos/contratos).
- T8 es el cuello de botella (depende de 3 interfaces + config).
- Si F1.4 resuelve P1 = `rechazado` (nuevo enum): añadir **T7b** migración
  up/down `estado_usuario` + ajustar destino en T8/T10 (ver design §7) ANTES de T8.
