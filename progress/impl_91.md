# Implementación — Feature 91 · Geocodificación de direcciones de órdenes

Rama `feature/91-geocodificacion-ordenes`, worktree aislado `ordenex-f91`, base
`origin/dev` limpio (`af55013`, ya con la infraestructura de cola de la 90).

---

## 1. Archivos creados

### Migraciones (nunca aplicadas contra `DATABASE_URL` de desarrollo)
- `db/migrations/20260719120000_job_tipo_geocodificacion/migration.sql` — `ALTER TYPE
  "job_tipo" ADD VALUE IF NOT EXISTS 'geocodificacion'`. **Va sola** (error 55P04:
  Postgres no permite usar un valor de enum en la transacción que lo añadió).
- `db/migrations/20260719120000_job_tipo_geocodificacion/down.sql` — **recrea el tipo**
  (Postgres no tiene `DROP VALUE`), borrando antes las filas `jobs` del tipo. Precedentes
  seguidos: `20260716140000_rol_api_key`, `20260710130000_rol_admin_satelite`.
- `db/migrations/20260719130000_orden_geocode/migration.sql` — 5 columnas nullable en
  `orden` + tabla `geocode_cache` + índice único + `ENABLE ROW LEVEL SECURITY` sin policy.
- `db/migrations/20260719130000_orden_geocode/down.sql`

### Configuración, geo y cliente HTTP
- `lib/config/geocode.ts` — patrón `lib/config/cron.ts`: ausente o `""` → `null`, **nunca
  lanza**.
- `lib/geo/direccion-query.ts` — `construirQueryDireccion` + `hashDireccion`. Dos
  normalizaciones distintas (la consulta conserva acentos, la huella no).
- `lib/interfaces/external/IGeocodeClient.ts` — `GeocodeOutcome` (vocabulario de dominio).
- `lib/clients/google-geocode.ts` — **primer cliente HTTP saliente del repo**. `fetch`
  inyectable, zod en el borde, credencial como query param **nunca** en logs ni errores.

### Persistencia
- `lib/interfaces/repositories/IOrdenGeocodeRepository.ts`
- `lib/interfaces/repositories/IGeocodeCacheRepository.ts`
- `lib/repositories/OrdenGeocodeRepository.ts` — escritura vía `updateMany` con
  `deletedAt: null`.
- `lib/repositories/GeocodeCacheRepository.ts` — upsert por `direccion_hash`.

### Negocio y encolado
- `lib/services/GeocodificacionService.ts` — handler con la tabla de decisión normativa.
- `lib/services/jobs/geocodificacion-encolado.ts` — `dedupeKeyGeocodificacion` +
  `encolarGeocodificacion` (outbox), `maxIntentos: 8`.
- `lib/services/jobs/geocodificacion-handler.ts` — adaptador `JobHandler` + fábrica de deps.

### Tests
`tests/unit/config/geocode-config.test.ts`, `tests/unit/geo/direccion-query.test.ts`,
`tests/unit/clients/google-geocode.test.ts`,
`tests/unit/services/geocodificacion-service.test.ts`,
`tests/unit/services/geocodificacion-encolado.test.ts`,
`tests/integration/db/geocodificacion-migracion.test.ts`,
`tests/integration/db/geocodificacion-rollback.test.ts`,
`tests/integration/repositories/orden-geocode-enqueue.test.ts`,
`tests/integration/api/procesar-jobs-geocodificacion.test.ts`.

## 2. Archivos modificados

- `db/schema.prisma` — 5 columnas en `Orden`, modelo `GeocodeCache`, valor
  `geocodificacion` en `enum JobTipo`.
- `lib/geo/normalize.ts` — se **exportan** `collapseSpaces` y `stripDiacritics` (antes
  privadas). Comportamiento sin cambios; `canonicalZonaNombre`/`normalizeZonaKey` intactas.
- `lib/interfaces/repositories/IOrdenRepository.ts` — `UpdateOrdenData.direccion?`
  (campo del guard latente; el CRUD **no** se amplió).
- `lib/repositories/OrdenRepository.ts` — `jobRepo` inyectable por constructor; encolado en
  `create()` y `createManyOrdenes()`; guard latente en `update()`; `select` del `after` de
  la carga masiva ampliado a `{ id, estatusId, direccion }` (corrección C3).
- `app/api/cron/procesar-jobs/route.ts` — registro del handler en `buildHandlers()`;
  `buildRecurrencias()` **sin tocar** (no es recurrente); `vercel.json` **sin tocar**.
- `tests/integration/db/zonas-migration.test.ts` — dos exclusiones nuevas en la lista de
  "migraciones apendidas después". **Es el mantenimiento previsto de ese test**, no una
  relajación: el invariante que protege ("la migración de zonas no nace ANTES que sus
  predecesoras") queda idéntico. Precedente en el propio archivo: features 67, 69, 73, 76,
  81 y 90 añadieron exactamente la misma línea.

---

## 3. Mapa de trazabilidad — R1..R34 → test concreto

| R | Archivo de test | Nombre del test |
| --- | --- | --- |
| R1 | `tests/integration/db/geocodificacion-migracion.test.ts` | "la tabla orden expone latitud/longitud/geocoded_at/geocode_precision/geocode_status nullables" |
| R2 | `tests/integration/db/geocodificacion-migracion.test.ts` | "geocode_cache tiene direccion_hash con indice unico" |
| R3 | `tests/integration/db/geocodificacion-migracion.test.ts` | "geocode_cache tiene RLS habilitada y cero policies" |
| R4 | `tests/integration/db/geocodificacion-migracion.test.ts` | "job_tipo acepta el valor geocodificacion" |
| R5 | `tests/integration/db/geocodificacion-rollback.test.ts` | "el down del enum RECREA el tipo (Postgres no soporta DROP VALUE) sin geocodificacion" + "el down de datos quita las CINCO columnas anadidas a orden" |
| R6 | `tests/integration/repositories/orden-geocode-enqueue.test.ts` | "crear una orden con direccion deja un job geocodificacion pendiente" |
| R7 | `tests/integration/repositories/orden-geocode-enqueue.test.ts` | "si la creacion falla no queda job huerfano en la cola" |
| R8 | `tests/integration/repositories/orden-geocode-enqueue.test.ts` | "la carga masiva encola un job por orden nueva y ninguno por duplicado saltado" |
| R9 | `tests/unit/services/geocodificacion-encolado.test.ts` | "no encola cuando la direccion es null / vacia / solo espacios / solo tabuladores y saltos" |
| R10 | `tests/unit/services/geocodificacion-encolado.test.ts` | "encola cuando la direccion entrante difiere de la almacenada" |
| R11 | `tests/unit/services/geocodificacion-encolado.test.ts` | "no encola cuando el update no toca la direccion ni cuando la deja igual" |
| R12 | `tests/integration/repositories/orden-geocode-enqueue.test.ts` | "dos encolados de la misma orden y direccion producen una sola fila" |
| R13 | `tests/integration/repositories/orden-geocode-enqueue.test.ts` | "corregir la direccion de una orden ya geocodificada encola un job nuevo" (+ regresión "NO degenera en la forma sin hash `geocodificacion:<ordenId>`" en `geocodificacion-encolado.test.ts`) |
| R14 | `tests/unit/services/geocodificacion-encolado.test.ts` | "el payload encolado solo contiene ordenId" |
| R15 | `tests/unit/geo/direccion-query.test.ts` | "concatena direccion, distrito, canton, provincia y pais omitiendo los ausentes" |
| R16 | `tests/unit/geo/direccion-query.test.ts` | "construye la consulta sin distrito cuando la orden no lo tiene" |
| R17 | `tests/unit/geo/direccion-query.test.ts` | "dos variantes con acentos, mayusculas y espacios extra producen la misma huella" |
| R18 | `tests/unit/services/geocodificacion-service.test.ts` | "con respuesta OK escribe latitud, longitud, precision y geocoded_at" |
| R19 | `tests/unit/clients/google-geocode.test.ts` | "una respuesta con forma inesperada produce error de integracion sin credencial ni direccion" |
| R20 | `tests/unit/services/geocodificacion-service.test.ts` | "un resultado APPROXIMATE se guarda con su precision" |
| R21 | `tests/unit/services/geocodificacion-service.test.ts` | "ZERO_RESULTS registra el estado y completa el job sin reintento" |
| R22 | `tests/unit/services/geocodificacion-service.test.ts` | "INVALID_REQUEST registra el estado y completa el job sin reintento" |
| R23 | `tests/unit/services/geocodificacion-service.test.ts` | "OVER_QUERY_LIMIT, UNKNOWN_ERROR, 5xx y fallo de red lanzan para reintento" |
| R24 | `tests/unit/services/geocodificacion-service.test.ts` | "REQUEST_DENIED lanza y no escribe coordenadas" |
| R25 | `tests/unit/services/geocodificacion-service.test.ts` | "sin credencial configurada falla solo el job de geo y el resto del lote se procesa" |
| R26 | `tests/unit/services/geocodificacion-service.test.ts` | "un acierto en cache escribe coordenadas sin invocar al proveedor" |
| R27 | `tests/unit/services/geocodificacion-service.test.ts` | "un fallo de cache con respuesta OK guarda la entrada en el almacen" |
| R28 | `tests/unit/services/geocodificacion-service.test.ts` | "una entrada antigua del almacen se usa igual, sin expiracion por tiempo" |
| R29 | `tests/unit/services/geocodificacion-service.test.ts` | "ejecutar el mismo job dos veces deja el mismo estado final" |
| R30 | `tests/unit/services/geocodificacion-service.test.ts` | "un job de una orden inexistente o borrada se completa sin error" |
| R31 | `tests/unit/services/geocodificacion-service.test.ts` | "ningun log emitido contiene direccion, coordenadas ni credencial" (+ "el codigo del service no usa console.*") |
| R32 | `tests/integration/api/procesar-jobs-geocodificacion.test.ts` | "buildHandlers registra el tipo geocodificacion" + "buildRecurrencias NO registra geocodificacion (no es recurrente)" |
| R33 | `tests/unit/config/geocode-config.test.ts` | "la credencial ausente o vacia se resuelve a null sin lanzar" |
| R34 | `tests/unit/services/geocodificacion-encolado.test.ts` | "el encolado fija maxIntentos en 8, por encima del default de la cola" |

**34 de 34 requisitos con test concreto. Ninguno huérfano.**

---

## 4. Verificación MEDIDA

### `pnpm typecheck`
```
> tsc --noEmit
(sin salida — 0 errores)
```
Baseline de T0 = 0. **Sin regresión.**

### `pnpm lint`
```
✖ 140 problems (0 errors, 140 warnings)
```
0 errores. 140 warnings, dentro del baseline histórico (~140); los 2 warnings que
introdujo la primera versión de los tests se eliminaron antes de cerrar.

### `pnpm test` — tests de la feature en aislado
```
Test Files  9 passed (9)
     Tests  96 passed (96)
```

### `pnpm test` — suite completa
```
Test Files  3 failed | 353 passed (356)
     Tests  9 failed | 3435 passed (3444)     <- primera corrida
```
Tras corregir el bug propio (ver §6) y mantener `zonas-migration`:
```
Test Files  2 failed | 354 passed (356)
     Tests  2 failed | 3444 passed (3446)
```
Los 2 rojos restantes son **preexistentes y ajenos a esta feature**, medidos (§5).

### Round-trip REAL de las migraciones (docker, Postgres 16 desechable)
Contenedor `ordenex-f91-pg` (`postgres:16`, puerto 55491), **nunca** contra
`DATABASE_URL` de desarrollo (se verificó antes que `process.loadEnvFile()` NO pisa una
variable ya presente en el entorno, así que el override es seguro).

1. **UP** — `prisma migrate deploy`: *All migrations have been successfully applied.*
   - 5 columnas en `orden`, todas `is_nullable = YES`, `latitud`/`longitud` con
     `numeric_precision = 10`, `numeric_scale = 7`.
   - `geocode_cache` con `geocode_cache_pkey` + `geocode_cache_direccion_hash_key`.
   - `relrowsecurity = t`, `policies = 0`.
   - `job_tipo` = `liberar_reprogramadas`, `geocodificacion`.
2. Se sembraron filas reales: 1 job `geocodificacion`, 1 job `liberar_reprogramadas`,
   1 fila de `geocode_cache`.
3. **DOWN** (orden inverso: `orden_geocode` → `job_tipo_geocodificacion`): ambos
   *Script executed successfully*.
   - columnas residuales = **0**; `geocode_cache` = **0**; `job_tipo` de vuelta a un solo
     valor; `job_tipo_old` residual = **0**; el job `liberar_reprogramadas` **sobrevivió**
     y el `geocodificacion` fue borrado por el `DELETE` previo del `down.sql`.
4. **RE-UP**: ambos scripts OK; 5 columnas, RLS `t` con 0 policies, enum con los 2 valores.
5. `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma`: **ningún
   drift sobre `orden` ni `geocode_cache`**. El drift que reporta (`api_key`,
   `cierre_detail`, `jobs`, `premio_ranking`, todo `updated_at`/FK) es **preexistente** de
   features anteriores.

Contenedor eliminado al terminar.

---

## 5. Rojos clasificados (medidos, no supuestos)

| Test | Veredicto |
| --- | --- |
| `tests/components/CierreDiaPage.test.tsx` | **Preexistente**, ya señalado en el encargo. **Medido**: falla idéntico en `origin/dev` limpio. |
| `tests/integration/actions/generar-gastos-fijos-route.test.ts` — "vercel.json define /api/cron/generar-gastos-fijos" | **Preexistente, heredado de la 90 (PR #94).** Falla al aserar que `vercel.json` contiene `/api/cron/liberar-reprogramadas`; la 90 sustituyó ese cron por `/api/cron/procesar-jobs` y no actualizó este test. **Medido**: falla idéntico en `origin/dev` limpio. **NO lo toco** (guardrail: reportar, no relajar). |
| `tests/integration/db/zonas-migration.test.ts` | **Sí causado por mi cambio**, y **corregido con el mantenimiento previsto** del propio test (ver §2). No se debilitó el invariante. |

**Cómo se midieron:** worktree desechable en `af55013` (`origin/dev` limpio) con
`node_modules` compartido por junction. Resultado en la base:
`Test Files 2 failed (2) · Tests 2 failed | 9 passed (11)` — exactamente los mismos dos
tests. Worktree eliminado tras la medición.

No se observaron flakes de `Test timed out in 5000ms` en las corridas medidas.

---

## 6. Desviaciones y paradas

1. **Bug propio cazado por tests heredados (y corregido en el código, no en los tests).**
   La primera versión de `construirQueryDireccion` tipaba los componentes como
   `string | null`. Varios tests de `OrdenRepository` alimentan filas fake donde
   `direccion`/`cantonNombre` llegan como `undefined`, y `collapseSpaces(undefined)`
   reventaba **dentro de la transacción de creación de la orden** — habría abortado
   `create()` en producción ante cualquier proyección incompleta. Se corrigió la función
   (acepta `undefined` y lo trata como ausente) y se añadieron dos tests de regresión en
   `direccion-query.test.ts`. **Ningún test heredado fue relajado.**
2. **`.env.example` no existe en el repo.** El design (§2) pedía añadir
   `# GOOGLE_MAPS_API_KEY=` a la sección "Integraciones". `git ls-files` no devuelve
   ningún `.env*`: el archivo no está versionado. **No se creó** uno nuevo (sería inventar
   un artefacto fuera de alcance). Queda como seguimiento: documentar
   `GOOGLE_MAPS_API_KEY` y `GEOCODE_TIMEOUT_MS` donde el equipo documente el entorno.
3. **`buildHandlers` y `buildRecurrencias` pasan a estar exportadas** en
   `app/api/cron/procesar-jobs/route.ts` para que R32 verifique el registro real sin
   levantar el endpoint. El route ya exportaba `handleProcesarJobs`, así que no es un
   patrón nuevo.
4. **`UpdateOrdenData` gana `direccion?`** (solo la interfaz del repositorio). Era
   necesario para que el guard latente compile y sea testeable. **NO** se tocó
   `actualizarOrdenSchema` (sigue `.strict()` sin el campo) ni `toUpdateData()` (sigue sin
   proyectarlo): `update()` continúa siendo estructuralmente incapaz de escribir una
   dirección, exactamente como exige la decisión Q1.
5. **`OrdenPrismaClient` gana `$queryRaw`** en su `Pick`, requerido por `JobRepository`
   para el encolado outbox. Todos los callers pasan el `PrismaClient` real.

---

## 7. Seguimientos anotados (NO son alcance de esta feature)

1. **`createManyOrdenesConGuia` (feature 88, PR #92) — 4.º choke-point. BLOQUEADO, no
   ejecutable ahora.**
   - Condición de desbloqueo: **PR #92 mergeado en `dev`**. Verificado de nuevo en esta
     implementación: la función **no existe en `origin/dev` (`af55013`)**.
   - Acción prevista: aplicar `encolarGeocodificacion(this.jobRepo, tx, { id, direccion })`
     dentro de su `$transaction`, reusando el helper de `lib/services/jobs/
     geocodificacion-encolado.ts` (~5 líneas, sin diseño nuevo).
   - Requisito cubierto entonces: extensión de **R8** al cuarto writer.
   - Verificación prevista: test análogo al de carga masiva en
     `tests/integration/repositories/orden-geocode-enqueue.test.ts`.
   - Decisión **Q9**: no se implementa a ciegas contra un archivo ausente de la rama base.
2. **Purga de `jobs`.** Las filas `done` crecen sin límite. Con la clave compuesta de Q4
   esto es correcto (la re-geocodificación no choca), pero no es gratuito. La 90 no definió
   retención.
3. **Primer consumidor de coordenadas.** Cuando exista, revisar si hace falta índice sobre
   `(latitud, longitud)` o `geocoded_at`. Hoy no hay lector: un índice sería coste de
   escritura puro.
4. **Purga / auditoría de `geocode_cache`.** Sin TTL por decisión Q7; crecimiento monótono
   aceptado (filas diminutas, coordenadas estables).
5. **`.env.example` ausente** (ver §6.2).

---

## 8. Veredicto

Feature 91 implementada completa: 34/34 requisitos con test, typecheck 0, lint 0 errores,
round-trip real de migraciones verificado en Postgres desechable, y el único rojo restante
de la suite es preexistente y ajeno.
