# Feature 91 — Tasks

Rama `feature/91-geocodificacion-ordenes` desde `origin/dev` limpio, en **worktree
aislado** (no se hace checkout sobre `flow`: WIP ajeno + drift de sesiones paralelas).

`[P]` = paralelizable con las tareas de su mismo bloque.
Criterio global: `./init.sh` en verde y suite de tests pasando antes de cerrar.

> **Gate F1.4 CERRADO (2026-07-19).** Q1–Q9 resueltas con la recomendación del
> spec_author, sin overrides. **Ningún task queda bloqueado**: T0–T16 son ejecutables de
> principio a fin. Ver `requirements.md` §"Decisiones del gate F1.4".
>
> **Antes de tocar `OrdenRepository.ts`, leer `design.md` §0** (correcciones C1/C2/C3 a
> la descripción del encargo: dos writers y no tres, líneas desplazadas, `select` de la
> carga masiva a ampliar).

---

## Bloque 0 — Preparación

### T0 · Worktree y rama
Crear worktree aislado desde `origin/dev` y verificar que la infraestructura de la 90
está presente (`lib/config/jobs.ts`, `lib/services/JobQueueService.ts`,
`app/api/cron/procesar-jobs/route.ts`, migración `20260717120000_jobs_cola`).
**Hecho:** `pnpm install --force` + `pnpm db:generate` OK y baseline de
tests/typecheck **medido** (no citado de `progress/current.md`, que caduca).
**Depende de:** —

---

## Bloque 1 — Esquema y migraciones

### T1 · Schema Prisma
Añadir a `Orden` las cinco columnas de §1.1 del design y el modelo `GeocodeCache`
(§1.2); añadir `geocodificacion` al enum `JobTipo`.
**Hecho:** `pnpm db:generate` sin errores y el tipo `Prisma.OrdenUpdateInput` expone
los campos nuevos.
**Depende de:** T0

### T2 · Migración A — enum `job_tipo` (va SOLA)
`db/migrations/<ts>_job_tipo_geocodificacion/` con `migration.sql`
(`ALTER TYPE … ADD VALUE IF NOT EXISTS 'geocodificacion'`) y `down.sql` que **recrea el
tipo** (Postgres no tiene `DROP VALUE`), borrando antes las filas `jobs` de ese tipo.
Seguir el precedente `20260716140000_rol_api_key` (incluido el comentario que explica
el `55P04`).
**Hecho:** `pnpm db:migrate` aplica; `pnpm db:rollback` revierte sin residuos; ambos
re-ejecutables.
**Depende de:** T1

### T3 · Migración B — columnas de orden + `geocode_cache`
`db/migrations/<ts>_orden_geocode/` con el SQL de §1.4 (columnas nullable, tabla,
índice único, `ENABLE ROW LEVEL SECURITY`) y su `down.sql`. Incluir en la cabecera el
comentario sobre retención permanente y ToS de Google (Q7).
**Hecho:** migración aplica y revierte; `geocode_cache` con RLS habilitada y **cero
policies** verificado en la DB.
**Depende de:** T2 (orden de timestamps)

### T4 · Tests de migración y rollback
`tests/integration/db/geocodificacion-migracion.test.ts` y `…-rollback.test.ts`.
**Cubre:** R1, R2, R3, R4, R5.
**Hecho:** los 5 requisitos con test verde.
**Depende de:** T3

---

## Bloque 2 — Piezas puras (paralelizables entre sí)

### T5 · [P] Config `lib/config/geocode.ts`
Clon de `lib/config/cron.ts:10-15`: ausente/`""` → `null`, nunca lanza. Añadir
`# GOOGLE_MAPS_API_KEY=` comentada en `.env.example` §`# Integraciones (según feature)`.
**Cubre:** R33.
**Hecho:** `tests/unit/config/geocode-config.test.ts` verde, incluido el caso
"credencial vacía → null sin lanzar".
**Depende de:** T0

### T6 · [P] Query y huella de dirección — `lib/geo/direccion-query.ts`
Exportar `collapseSpaces`/`stripDiacritics` desde `lib/geo/normalize.ts` **sin alterar
su comportamiento**; implementar `construirQueryDireccion` y `hashDireccion` (§4).
Respetar las **dos normalizaciones distintas** (consulta conserva acentos, huella no).
**Cubre:** R15, R16, R17.
**Hecho:** `tests/unit/geo/direccion-query.test.ts` verde; los tests existentes de
`normalize.ts` / `ZonaService` / `seed-zonas` siguen verdes (regresión).
**Depende de:** T0

### T7 · [P] Cliente `lib/clients/google-geocode.ts` + `IGeocodeClient`
Crear `lib/clients/` y `lib/interfaces/external/IGeocodeClient.ts` con el tipo
`GeocodeOutcome` (§3). `fetchImpl?: typeof fetch` inyectable. Validación **zod en el
borde** de la respuesta. El cliente **traduce** estados, no decide política.
**Cubre:** R19 (y habilita R18, R20–R24).
**Hecho:** `tests/unit/clients/google-geocode.test.ts` cubre OK, ZERO_RESULTS,
REQUEST_DENIED, INVALID_REQUEST, OVER_QUERY_LIMIT, UNKNOWN_ERROR, HTTP 5xx, fallo de
red y forma inesperada — **sin red y sin credencial**. Un test asegura que ningún
mensaje de error contiene la URL, la credencial ni la dirección.
**Depende de:** T0

---

## Bloque 3 — Persistencia

### T8 · Repositorios de geocodificación
`IOrdenGeocodeRepository` (leer orden + nombres de catálogo; escribir coordenadas y
estado vía `updateMany` con `deletedAt: null`) e `IGeocodeCacheRepository`
(`findByHash`, `upsert` por `direccion_hash`), con sus implementaciones Prisma.
Solo queries, sin lógica de negocio (`docs/architecture.md` §Repository).
**Hecho:** typecheck OK; tests de integración de lectura/escritura verdes.
**Depende de:** T4

---

## Bloque 4 — Handler

### T9 · `lib/services/GeocodificacionService.ts`
Implementa `JobHandler`. DI por interfaces. Flujo y tabla de decisión de §5.
**Cubre:** R18, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31.
**Hecho:** `tests/unit/services/geocodificacion-service.test.ts` verde con **un caso
por fila de la tabla de decisión**, más: acierto de caché sin llamada al proveedor,
doble ejecución idempotente, orden inexistente/borrada, entrada de caché antigua sin
expiración, y un espía del logger que verifica que ningún mensaje contiene dirección,
coordenadas ni credencial.
**Depende de:** T5, T6, T7, T8

### T10 · Registro en el drenador
En `app/api/cron/procesar-jobs/route.ts`, `handlers.set("geocodificacion", …)` dentro
de `buildHandlers()` (`:32-39`). **No tocar** `buildRecurrencias()` ni `vercel.json`.
**Cubre:** R32.
**Hecho:** `tests/integration/api/procesar-jobs-geocodificacion.test.ts` verifica que
el handler se resuelve y que el job **no** se re-agenda; los tests existentes de
`procesar-jobs` siguen verdes.
**Depende de:** T9

---

## Bloque 5 — Encolado (outbox)

### T11 · Helper de encolado
`lib/services/jobs/geocodificacion-encolado.ts` con `dedupeKeyGeocodificacion` y
`encolarGeocodificacion(repo, tx, orden)`, no-op si la dirección no es geocodificable.

⚠️ **Clave normativa (Q4):** `geocodificacion:<ordenId>:<hash8>`. Los dos componentes
son **obligatorios**. Simplificar a `geocodificacion:<ordenId>` rompe la
re-geocodificación tras corregir una dirección, **en silencio** (el único de
`dedupe_key` no está acotado por estado y las filas `done` no se purgan). Copiar el
comentario de cabecera de `design.md` §6 al código.

`maxIntentos: 8` (Q3 → R34), no el default de la cola.
**Cubre:** R9, R12, R14, R34.
**Hecho:** `tests/unit/services/geocodificacion-encolado.test.ts` verde: no encola con
dirección null/vacía/solo espacios; payload solo `{ordenId}`; clave estable para el
mismo par y **distinta al cambiar la dirección**; `maxIntentos` = 8 en las opciones de
encolado.
**Depende de:** T6, T8

### T12 · Enganche en `create()` y `createManyOrdenes()`
`OrdenRepository.create()` (`:407`, tx `:410`) y `createManyOrdenes()` (`:664`, tx
`:674`). En la carga masiva, **ampliar el `select` del `after`** (`:687-690`) a
`{ id, estatusId, direccion }` para decidir por fila.
**Cubre:** R6, R7, R8.
**Hecho:** `tests/integration/repositories/orden-geocode-enqueue.test.ts` verde:
creación deja job pendiente; transacción revertida no deja job; lote encola uno por
orden nueva y ninguno por duplicado saltado; dos encolados iguales → una fila;
dirección corregida → job nuevo. Los tests existentes de `OrdenRepository` y de carga
masiva siguen verdes.
**Depende de:** T11

### T13 · Guard latente en `update()`
`OrdenRepository.update()` (`:483`, tx `:489`): pre-lectura condicional de `direccion`
(patrón de `estatusId`, `:492-498`) y encolado solo si el valor difiere.
**Cubre:** R10, R11.
> **Q1 RESUELTA — se implementa como guard latente.** Alcance cerrado:
> - **SÍ:** pre-lectura condicional + comparación + encolado dentro de la tx del update.
> - **NO:** ampliar `actualizarOrdenSchema`, `toUpdateData` ni el formulario de edición.
>   Permitir editar `direccion` es **otra feature**, fuera de alcance.
>
> Se implementa aun siendo hoy inalcanzable porque, sin el guard, el día que el CRUD
> gane el campo la orden quedaría con dirección nueva y coordenadas viejas **en
> silencio**.
**Hecho:** test unitario del guard verde (encola si difiere; no encola si es igual, si
no viene el campo, o si la dirección nueva no es geocodificable); comentario en el
código que documenta que el guard es **latente y deliberado**, por qué hoy es
inalcanzable (C1) y que **no es código muerto a eliminar**.
**Depende de:** T12

---

## Bloque 6 — Cierre

### T14 · [P] Seguimientos documentados — incluido el 4.º choke-point de la 88
Anotar en `progress/impl_91.md` los 4 seguimientos de design §9.

**Foco: `createManyOrdenesConGuia` (feature 88, PR #92).** Decisión **Q9**: esta función
**NO existe en `origin/dev`** (PR #92 sin mergear), así que **NO es ejecutable en esta
feature** y **NO se implementa a ciegas**. T14 es una task de **seguimiento documental**,
no de código: deja escrito el trabajo pendiente para cuando el PR #92 aterrice en `dev`.

Contenido mínimo de la nota de seguimiento:
- condición de desbloqueo: **PR #92 mergeado en `dev`**;
- acción prevista: aplicar `encolarGeocodificacion` dentro de la tx de
  `createManyOrdenesConGuia`, reusando el helper de T11 (~5 líneas, sin diseño nuevo);
- requisito que quedaría cubierto entonces: extensión de R8 al cuarto writer;
- verificación prevista: un test análogo al de carga masiva en
  `tests/integration/repositories/orden-geocode-enqueue.test.ts`.

**Hecho:** los 4 seguimientos escritos con su archivo/línea de enganche previsto, y el
de la 88 marcado explícitamente como **bloqueado por PR #92, no ejecutable ahora**.
**Depende de:** T13

### T15 · [P] Mapa de trazabilidad
`progress/impl_91.md` con la tabla `R<n>` → test concreto (archivo + nombre del test),
para los **34** requisitos (R34 entró con la decisión Q3).
**Hecho:** los 34 mapeados; ninguno sin test (el reviewer rechaza si falta alguno).
**Depende de:** T13

### T16 · Verificación final
`./init.sh` en verde, suite completa, typecheck limpio y `pnpm db:rollback` de las dos
migraciones probado en orden inverso.
**Hecho:** todo verde y baseline comparado contra el medido en T0.
**Depende de:** T14, T15

---

## Grafo de dependencias

```
T0
├─→ T1 → T2 → T3 → T4 ─────────────→ T8 ─┐
├─→ T5 [P] ──────────────────────────────┤
├─→ T6 [P] ───────────────────┬───────────┤
└─→ T7 [P] ──────────────────┐│           │
                             ││           │
                             └┴───────────┴─→ T9 → T10
                                             │
                              T6 + T8 ──→ T11 → T12 → T13 ─┬─→ T14 [P] ─┐
                                                          └─→ T15 [P] ─┴─→ T16
```

Sin gates pendientes: el F1.4 se cerró el 2026-07-19.

**Ruta crítica:** T0 → T1 → T2 → T3 → T4 → T8 → T9 → T10 … y en paralelo la rama de
encolado T11 → T12 → T13.
**Frente paralelo temprano:** T5, T6 y T7 no dependen de la DB y pueden hacerse
mientras se resuelven las migraciones.
