# Feature 115 — Tasks

Checklist ordenado y verificable. `[P]` = paralelizable con las tareas de su mismo
bloque. Cada task cita los `R<n>` que satisface, los archivos esperados (para validar
conflictos de zona/paralelismo) y su criterio de "hecho". La columna `R<n>→test` cierra
la trazabilidad (`docs/specs.md` §Trazabilidad).

## Archivos esperados (para validar conflictos de paralelismo)

**Nuevos (los crea 115):**
- `db/migrations/20260723120000_orden_mensajero_meta/migration.sql`  (UP)
- `db/migrations/20260723120000_orden_mensajero_meta/down.sql`       (DOWN)
- `lib/types/orden-mensajero-meta.ts`                                 (zod + result types)
- `lib/interfaces/repositories/IOrdenMensajeroMetaRepository.ts`
- `lib/repositories/OrdenMensajeroMetaRepository.ts`
- `lib/interfaces/services/IOrdenMensajeroMetaService.ts`
- `lib/services/OrdenMensajeroMetaService.ts`
- `lib/actions/orden-mensajero-meta.ts`                               (Server Action toggle)
- `app/(app)/mis-asignaciones/_components/MarcarLuegoToggle.tsx`      (control de card)
- Tests: `tests/unit/services/orden-mensajero-meta-service.test.ts`,
  `tests/unit/actions/orden-mensajero-meta-action.test.ts`,
  `tests/unit/services/mis-asignaciones-marcar-luego.test.ts`,
  `tests/components/MarcarLuegoToggle.test.tsx`,
  `tests/integration/repositories/orden-mensajero-meta.int.test.ts`

**Editados (mínimo; nota de conflicto):**
- `db/schema.prisma` — add `model OrdenMensajeroMeta` (con `marcarLuego` + `nota`) +
  inversos en `Usuario` y `Orden`.
- `lib/interfaces/services/IMisAsignacionesService.ts` — add `marcarLuego: boolean` a
  `MiAsignacionDTO`.
- `lib/services/MisAsignacionesService.ts` — inyectar meta-repo + merge en `toDTO`.
- `lib/actions/mis-asignaciones.ts` — `buildService()` pasa el nuevo repo.
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` — badge + sort + toggle.

> **Conflicto con la feature 116:** 116 (`depends_on: 115`) COMPARTE
> `db/schema.prisma` (misma modelo, usa `nota`), la interfaz/repo/servicio de meta y el
> módulo `MisAsignacionesModule`. Por eso 116 va DESPUÉS de 115, no en paralelo. 116 NO
> crea migración (la columna `nota` ya nace aquí, T1). 115 no toca ninguna otra feature
> `in_progress`.

## Zona BACKEND

### T1 — Migración + modelo Prisma  (R1, R2, R3, R4)
- Archivos: `db/schema.prisma` (add `model OrdenMensajeroMeta` con `marcarLuego`+`nota`,
  inversos en `Usuario`/`Orden`); `db/migrations/20260723120000_orden_mensajero_meta/migration.sql`;
  `.../down.sql`.
- Depende de: —
- Hecho cuando: `pnpm db:generate` tipa `OrdenMensajeroMeta`; UP crea la tabla con AMBAS
  columnas (`marcar_luego bool default false`, `nota text NULL`), `UNIQUE(usuario_id,
  orden_id)`, dos FK `ON DELETE CASCADE`, índices y RLS; `down.sql` revierte exacto;
  `pnpm db:migrate` y `pnpm db:rollback` corren en verde (round-trip).
- `R<n>→test`: R1/R2/R3 verificados por T7 (integración); R4 por revisión de `down.sql` +
  rollback en verde.

### T2 — Tipos + zod  (R9)
- Archivos: `lib/types/orden-mensajero-meta.ts`;
  `tests/unit/actions/orden-mensajero-meta-action.test.ts` (comparte fixture).
- Depende de: — `[P]` con T1
- Hecho cuando: `marcarLuegoSchema = z.object({ ordenId: z.string().min(1), marcarLuego:
  z.boolean() })`; `MarcarLuegoResult` discriminado (`ok|unauthenticated|forbidden|
  not_found|validation_error`).
- `R<n>→test`: R9 `el schema rechaza ordenId vacio y marcarLuego no booleano`.

### T3 — Interfaces + Repository  (R5, R6, R7, R8, R17, R20)
- Archivos: `lib/interfaces/repositories/IOrdenMensajeroMetaRepository.ts`;
  `lib/interfaces/services/IOrdenMensajeroMetaService.ts`;
  `lib/repositories/OrdenMensajeroMetaRepository.ts`.
- Depende de: T1, T2
- Hecho cuando: `upsertMarcarLuego(usuarioId, ordenId, marcarLuego)` hace `upsert` por el
  `UNIQUE(usuario_id, orden_id)`; `findMarcarLuegoByMensajero(usuarioId)` devuelve
  `Set<ordenId>` de las marcadas del PROPIO mensajero; typecheck en verde.
- `R<n>→test`: cubierto vía T4 (service con repo mock) y T7 (integración: R7 unicidad,
  R8/R20 solo su fila, R17 lectura).

### T4 — Service `OrdenMensajeroMetaService`  (R5, R6, R8, R11, R12, R13, R14, R15, R16)
- Archivos: `lib/services/OrdenMensajeroMetaService.ts`;
  `tests/unit/services/orden-mensajero-meta-service.test.ts`.
- Depende de: T3
- Hecho cuando: `ALLOWED_ROL="mensajero"`; carga la orden y valida propiedad
  (`mensajeroAsignadoId === actor`); `usuario_id` SIEMPRE del actor; NO toca
  estatus/prioridad/ruta/historial; resultados discriminados; tests con repo mock.
- `R<n>→test`: R5 `marcar setea marcar_luego=true (upsert)`; R6 `quitar setea false`;
  R8 `usa el usuario_id del actor, nunca el del input`; R11 `forbidden si el rol no es
  mensajero`; R12 `no puede escribir la fila de otro mensajero`; R13 `forbidden si la
  orden no esta asignada al actor`; R14 `not_found si la orden no existe/borrada`;
  R15 `el toggle no cambia el estatus de la orden`; R16 `el toggle no toca ruta/prioridad
  ni el historial de estados`.

### T5 — Server Action `marcarGestionarLuego`  (R9, R10, R11, R13, R14)
- Archivos: `lib/actions/orden-mensajero-meta.ts`;
  `tests/unit/actions/orden-mensajero-meta-action.test.ts`.
- Depende de: T4
- Hecho cuando: action `'use server'` con `withErrorHandler` + `resolveActorFromSession`
  + `UnauthenticatedError` (R10) + traductor `VALIDATION_ERROR`/`UNAUTHORIZED`; `deps`
  inyectables; propaga `forbidden`/`not_found` del service.
- `R<n>→test`: R9 `devuelve validation_error con entrada invalida`; R10 `devuelve
  unauthenticated sin sesion y sin tocar el service`; R11 `propaga forbidden (rol)`;
  R13 `propaga forbidden (orden ajena)`; R14 `propaga not_found`.

### T6 — Reflejo en el listado (`marcarLuego` en el DTO)  (R17, R20)
- Archivos: `lib/interfaces/services/IMisAsignacionesService.ts` (add `marcarLuego` al DTO);
  `lib/services/MisAsignacionesService.ts` (inyectar meta-repo + merge en `toDTO`);
  `lib/actions/mis-asignaciones.ts` (`buildService` pasa el repo);
  `tests/unit/services/mis-asignaciones-marcar-luego.test.ts`.
- Depende de: T3
- Hecho cuando: `listarMisAsignaciones` suma `metaRepo.findMarcarLuegoByMensajero(actor)`
  al `Promise.all` y cada DTO lleva `marcarLuego = metas.has(row.id)` (default `false`);
  solo lee filas del propio actor.
- `R<n>→test`: R17 `el DTO refleja marcar_luego del mensajero (false si no hay fila)`;
  R20 `el listado solo refleja las marcas del propio actor` (repo mock con marcas de
  otro mensajero -> no aparecen).

### T7 — Integración Repository/Service + DB  (R1, R2, R3, R7, R8, R15, R16, R17)
- Archivos: `tests/integration/repositories/orden-mensajero-meta.int.test.ts`.
- Depende de: T3, T4, T6
- Hecho cuando: contra DB de test — upsert crea una fila; segundo upsert con el mismo par
  NO duplica (R7); `usuario_id` fijado por el service; una segunda cuenta de mensajero no
  ve las marcas de la primera (R8/R20); tras el toggle la orden conserva `estatus`/ruta
  (R15/R16); `orden_mensajero_meta` tiene RLS habilitada (R2/R3) y ambas columnas
  (`marcar_luego`, `nota`) existen (R1/R2).
- `R<n>→test`: R7 `el upsert no crea filas duplicadas para el mismo (usuario, orden)`;
  R1/R2 `la tabla tiene marcar_luego y nota`; R3 `orden_mensajero_meta tiene RLS
  habilitada`; R8 `el usuario_id persistido es el del actor`; R15/R16 `la orden no cambia
  de estado ni de ruta tras marcar`.

## Zona FRONTEND

### T8 — Badge + orden visual + toggle en las cards  (R18, R19, R5, R6)
- Archivos: `app/(app)/mis-asignaciones/_components/MarcarLuegoToggle.tsx` **[NUEVO]**;
  `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` (badge + sort estable
  secundario + montar el toggle en la card);
  `tests/components/MarcarLuegoToggle.test.tsx`.
- Depende de: T5, T6 `[P]` con T7
- Hecho cuando: la card muestra `Badge` "Gestionar más tarde" cuando `orden.marcarLuego`
  (R18); un `useMemo` con `sort` estable hunde las marcadas al final SIN mutar la ruta
  (R19); el toggle llama a `marcarGestionarLuego({ ordenId, marcarLuego: !actual })` y
  hace `router.refresh()` (R5/R6); reutiliza primitivas shadcn/ui (`Badge`, `Button`), sin
  componentes nuevos innecesarios (`docs/architecture.md`).
- `R<n>→test`: R18 `la card marcada muestra el badge de gestionar mas tarde`; R19 `las
  marcadas se ordenan despues de las no marcadas sin cambiar la secuencia de ruta`;
  R5/R6 `el toggle llama a la action con el valor negado` (test de componente con action
  mockeada).

### T9 — (Opcional) E2E del toggle del mensajero  (R5, R6, R18)
- Archivos: `e2e/mis-asignaciones-marcar-luego.spec.ts` (extiende
  `e2e/mis-asignaciones.spec.ts` si aplica).
- Depende de: T8
- Hecho cuando: un mensajero marca una orden, ve el badge y la orden se hunde; recarga y
  la marca persiste; quita la marca y desaparece.
- `R<n>→test`: refuerza R5/R6/R18 end-to-end (no sustituye los tests de T4/T8).

## Orden sugerido y paralelismo
1. Backend: T1 → (T2 `[P]` con T1) → T3 → (T4 `[P]` T6) → T5 → T7.
2. Frontend: T8 tras T5/T6; T9 opcional tras T8.
3. Cada task = un commit `feat(115-marcar-gestionar-luego): <qué>` (`docs/conventions.md`).

## Cierre de trazabilidad
Todo `R1..R20` queda cubierto: R1–R3 (T1/T7), R4 (T1), R5–R6 (T4/T5/T8), R7 (T3/T7),
R8 (T4/T7), R9 (T2/T5), R10–R11 (T5), R12 (T4), R13–R14 (T4/T5), R15–R16 (T4/T7),
R17 (T6/T7), R18–R19 (T8), R20 (T6/T7).

## Nota de handoff a la feature 116
116 NO crea migración: reutiliza `orden_mensajero_meta` (columna `nota` ya creada en T1) y
EXTIENDE `IOrdenMensajeroMetaRepository`/`OrdenMensajeroMetaService` con métodos `nota`, más
su propia Server Action y UI. El modelo Prisma `OrdenMensajeroMeta` (con `nota String?`) ya
queda declarado por 115.
