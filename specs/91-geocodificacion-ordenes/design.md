# Feature 91 — Design

Consume la infraestructura de cola de la feature 90 (ya en `origin/dev`, PR #94
`af55013`). Rama base: `origin/dev` limpio, worktree aislado.

Referencias verificadas en el worktree `../ordenex-f90`:
`lib/interfaces/repositories/IJobRepository.ts`, `lib/services/JobQueueService.ts`,
`app/api/cron/procesar-jobs/route.ts`, `lib/config/jobs.ts`,
`db/migrations/20260717120000_jobs_cola/migration.sql`.

> **Gate F1.4 CERRADO (2026-07-19).** Las nueve preguntas Q1–Q9 se resolvieron con la
> recomendación del spec_author, **sin overrides** y **en bloque**. Ver
> `requirements.md` §"Decisiones del gate F1.4". Este design ya refleja las decisiones:
> no queda nada por confirmar antes de implementar.

---

## 0. Correcciones a la descripción de la feature — LEER ANTES DE IMPLEMENTAR

Tres afirmaciones de la descripción del encargo son **inexactas** y están verificadas
contra `origin/dev`. Se repiten aquí (además de en `requirements.md`) porque el
implementer trabaja sobre este archivo y no debe repetir el error.

**C1 — Los writers de dirección efectivos son DOS, no TRES.** `create()` y
`createManyOrdenes()`. `update()` **no puede** escribir `direccion`:
`actualizarOrdenSchema` (`lib/types/orden.ts:32-46`) es `.strict()` y no la incluye, y
`toUpdateData()` (`OrdenRepository.ts:579-595`) no la proyecta. La descripción cita
`lib/types/orden.ts:150` como campo de actualización, pero esa línea es
`OrdenListItemDTO.direccion`, un campo del **listado**. El enganche en `update()` se
implementa igual, como **guard latente** (decisión Q1).

**C2 — Los números de línea de la descripción están desplazados.** En `origin/dev`
limpio: `create()` en `:407` (tx `:410`), `update()` en `:483` (tx `:489`),
`createManyOrdenes()` en `:664` (tx `:674`). La descripción cita `:411/:487/:668`,
probablemente leídos desde la rama `flow`, que tiene `OrdenRepository.ts` modificado sin
commitear. **Esta feature nace de `origin/dev` limpio**, donde valen las líneas de
arriba; si no cuadran, re-localizar por nombre de función antes de editar.

**C3 — Hay que ampliar el `select` de `createManyOrdenes`.** El diff `before`/`after`
que identifica las órdenes realmente insertadas (`:678-691`) hace un `select` de
`{ id, estatusId }`. Para cumplir R8/R9 hay que ampliarlo a
`{ id, estatusId, direccion }`. Es aditivo sobre una query **que ya se ejecuta**: no
añade round-trip.

---

## 1. Modelo de datos

### 1.1 Columnas nuevas en `Orden`

```prisma
model Orden {
  // ...
  latitud          Decimal?  @db.Decimal(10, 7)
  longitud         Decimal?  @db.Decimal(10, 7)
  geocodedAt       DateTime? @map("geocoded_at")
  geocodePrecision String?   @map("geocode_precision")
  geocodeStatus    String?   @map("geocode_status")
}
```

`Decimal(10,7)` da ~1 cm de resolución y cubre el rango `[-180, 180]`. Costa Rica cabe
holgadamente.

`geocodeStatus` es `String?` y **no** un enum nativo, deliberadamente: es un valor
opaco del proveedor (`OK`, `ZERO_RESULTS`, `INVALID_REQUEST`, …) que Google puede
ampliar sin avisar. Un enum nativo obligaría a una migración `ALTER TYPE` cada vez que
aparezca un estado nuevo, y a un fallo duro en producción entretanto. El repo ya
distingue ambos casos: usa enums nativos para valores **de dominio propio**
(`JobEstado`, `RolValue`) y no para valores de terceros.

`geocodePrecision` guarda `location_type` de Google
(`ROOFTOP` | `RANGE_INTERPOLATED` | `GEOMETRIC_CENTER` | `APPROXIMATE`), por el mismo
motivo.

**Sin índice nuevo.** No hay ninguna query que filtre u ordene por estas columnas: no
existe consumidor (decisión (a) del alcance). Añadir un índice sin lector es coste de
escritura puro. Se anota como seguimiento para el primer consumidor.

### 1.2 Tabla `geocode_cache`

```prisma
model GeocodeCache {
  id           String   @id @default(uuid())
  direccionHash String  @unique @map("direccion_hash")
  latitud      Decimal  @db.Decimal(10, 7)
  longitud     Decimal  @db.Decimal(10, 7)
  precision    String
  payloadCrudo Json?    @map("payload_crudo") @db.JsonB
  createdAt    DateTime @default(now()) @map("created_at")

  @@map("geocode_cache")
}
```

Solo se cachean resultados **satisfactorios**. `ZERO_RESULTS` no entra: la orden ya
guarda ese estado en `geocode_status`, y cachear ausencias obligaría a distinguir "no
buscado" de "buscado sin resultado" en la misma tabla, complicándola sin ahorrar nada
(un `ZERO_RESULTS` no se reintenta, R21).

`payloadCrudo` guarda la respuesta cruda del proveedor para poder derivar campos
adicionales en el futuro sin re-pagar la consulta.

> **PII:** `geocode_cache` contiene direcciones postales de forma indirecta (la huella)
> y coordenadas de forma directa. Por eso RLS habilitada sin policies (§1.4). La
> dirección en claro **no** se persiste en la caché: solo su huella.

### 1.3 Ampliación del enum `job_tipo`

```sql
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'geocodificacion';
```

**Va en su propia migración, sola.** Postgres no permite USAR un valor de enum en la
misma transacción que lo añadió (error `55P04`), y Prisma Migrate corre cada
`migration.sql` en una transacción. Precedentes exactos en el repo:
`20260710130000_rol_admin_satelite` y `20260716140000_rol_api_key` (que documenta el
motivo en sus líneas 4-10, separando el `ADD VALUE` del `INSERT` que lo consume).

Esta feature no inserta filas con ese valor durante la migración, pero se mantiene la
separación por consistencia y para que el `down.sql` sea aislable.

El `down.sql` **no puede** usar `DROP VALUE` (no existe en Postgres): recrea el tipo.

```sql
-- down.sql de la migración del enum
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
```

> **Precondición del rollback:** ninguna fila de `jobs` con `tipo = 'geocodificacion'`.
> Si queda alguna, el `ALTER TABLE` falla RUIDOSAMENTE y el rollback aborta. Es el
> comportamiento correcto (mismo criterio que el `down.sql` de la 81). El `down.sql`
> las borra explícitamente antes:
> `DELETE FROM "jobs" WHERE "tipo" = 'geocodificacion';`

### 1.4 SQL clave de la migración de datos

```sql
-- Columnas de geocodificación en la orden. Aditivo: todas nullable, sin default.
ALTER TABLE "orden"
  ADD COLUMN "latitud"           DECIMAL(10,7),
  ADD COLUMN "longitud"          DECIMAL(10,7),
  ADD COLUMN "geocoded_at"       TIMESTAMP(3),
  ADD COLUMN "geocode_precision" TEXT,
  ADD COLUMN "geocode_status"    TEXT;

-- Caché de direcciones ya resueltas. Evita re-pagar al proveedor por direcciones
-- repetidas (misma tienda, mismo edificio) y abarata los reintentos de la cola.
-- Retención: PERMANENTE, sin TTL (gate F1.4-Q7). Los Terminos de Servicio de Google
-- permiten almacenar coordenadas geocodificadas de forma indefinida cuando se usan
-- junto a servicios de Google; el limite de 30 dias aplica a otro contenido.
-- Invalidacion: implicita, una direccion distinta produce una huella distinta.
CREATE TABLE "geocode_cache" (
  "id"             TEXT NOT NULL,
  "direccion_hash" TEXT NOT NULL,
  "latitud"        DECIMAL(10,7) NOT NULL,
  "longitud"       DECIMAL(10,7) NOT NULL,
  "precision"      TEXT NOT NULL,
  "payload_crudo"  JSONB,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "geocode_cache_direccion_hash_key"
  ON "geocode_cache" ("direccion_hash");

-- RLS habilitada SIN policies (solo service role), patron jobs / api_key /
-- wallet_movimiento. La cache guarda coordenadas: no es accesible desde el cliente.
ALTER TABLE "geocode_cache" ENABLE ROW LEVEL SECURITY;
```

Su `down.sql`: `DROP TABLE "geocode_cache";` + `ALTER TABLE "orden" DROP COLUMN …` (las
cinco).

---

## 2. Configuración — `lib/config/geocode.ts`

Clon estructural de `lib/config/cron.ts:10-15`: ausente o `""` → `null`, **nunca
lanza**.

```ts
export interface GeocodeConfig {
  GOOGLE_MAPS_API_KEY: string | null;
  GEOCODE_TIMEOUT_MS: number;   // default 10_000
}
export function loadGeocodeConfig(): GeocodeConfig { /* … */ }
```

`.env.example` gana, en la sección `# Integraciones (según feature)` (`:21-25`):

```
# GOOGLE_MAPS_API_KEY=
```

Comentada, como las cuatro que ya viven ahí.

---

## 3. Cliente HTTP — `lib/clients/google-geocode.ts`

**Primer cliente HTTP saliente server-side del repo.** `lib/clients/` no existe hoy y
no hay ningún consumo de API externa server-side (las "external" actuales —
`IEmailProvider`, `IFileStorage`, `ISignedUrlProvider` — son interfaces sin red).

Contrato en `lib/interfaces/external/IGeocodeClient.ts`
(`docs/architecture.md` §Interfaces: `interfaces/external/`):

```ts
export type GeocodeOutcome =
  | { status: "ok"; latitud: number; longitud: number; precision: string; crudo: unknown }
  | { status: "sin_resultados" }      // ZERO_RESULTS
  | { status: "consulta_invalida" }   // INVALID_REQUEST
  | { status: "transitorio"; detalle: string }   // OVER_QUERY_LIMIT | UNKNOWN_ERROR | 5xx | red
  | { status: "config_invalida"; detalle: string }; // REQUEST_DENIED

export interface IGeocodeClient {
  geocodificar(query: string): Promise<GeocodeOutcome>;
}
```

El cliente **traduce** los estados del proveedor a un vocabulario de dominio y **no
decide** qué hacer con ellos: la política (completar vs lanzar) vive en el service
(§5). Así la tabla de decisión de R21–R25 es testeable sin red.

**`fetch` inyectable** (`fetchImpl?: typeof fetch`), patrón de
`app/(app)/ordenes/_components/carga-masiva-chunks.ts:62` y `:82`. Permite testear
todos los estados sin red ni credencial.

La respuesta se valida con **zod en el borde** (`docs/architecture.md` §2), no se
castea: `{ status: string, results: [{ geometry: { location: {lat, lng}, location_type } }] }`.
Una forma inesperada produce error de integración (R19).

**La credencial va como query param** (`key=…`) porque la Geocoding API no acepta
cabecera de autorización. Implicaciones tratadas: la URL **nunca** se incluye en
mensajes de error ni en logs (R31); los mensajes de error citan la operación
(`"geocodificar dirección"`) y el estado, jamás la URL, la credencial ni la dirección.

---

## 4. Construcción de la consulta y huella — `lib/geo/direccion-query.ts`

No existe ningún helper que concatene una dirección legible: hay que crearlo.

```ts
export interface ComponentesDireccion {
  direccion: string | null;
  distritoNombre: string | null;
  cantonNombre: string;
  provinciaNombre: string;
}

/** Consulta legible para el proveedor. Omite componentes ausentes. R15/R16. */
export function construirQueryDireccion(c: ComponentesDireccion): string | null;

/** Huella determinista para la caché. R17. */
export function hashDireccion(query: string): string;
```

`construirQueryDireccion` une con `", "` los componentes no vacíos y añade
`"Costa Rica"`; devuelve `null` si `direccion` está vacía tras normalizar (R9/Q5).

**Dos normalizaciones distintas, deliberadamente:**

| | Consulta al proveedor | Huella de caché |
| --- | --- | --- |
| trim + colapso de espacios | sí | sí |
| minúsculas | **no** | sí |
| quitar diacríticos | **no** | sí |

La consulta **conserva** acentos y capitalización: Google los usa como señal y
degradarlos empeora el resultado. La huella los normaliza para que `"San José"` y
`"SAN JOSE"` compartan entrada de caché (R17).

Se reutiliza la base de `lib/geo/normalize.ts:10-17` (`collapseSpaces`,
`stripDiacritics`), hoy privadas y usadas solo para nombres de zona: se exportan sin
cambiar su comportamiento. `canonicalZonaNombre` y `normalizeZonaKey` no se tocan.

`hashDireccion` es una función hermana de `hashApiKey`, **no** una reutilización — ver
`requirements.md` Q6 para la justificación.

---

## 5. Handler — `lib/services/GeocodificacionService.ts`

Implementa `JobHandler = (job: JobDTO) => Promise<void>`
(`lib/interfaces/services/IJobQueueService.ts:7`). DI por constructor con interfaces
(`docs/architecture.md` §Service): `IOrdenGeocodeRepository`, `IGeocodeCacheRepository`,
`IGeocodeClient`, `GeocodeConfig`, `now`, `logger`.

Flujo:

1. Valida el payload con zod → `{ ordenId: string }`. Forma inválida → lanza.
2. Lee la orden con sus nombres de catálogo. No existe o `deletedAt != null` →
   **retorna** (job completado, R30). Una orden borrada no es un error del sistema.
3. Construye la consulta. `null` → registra `geocode_status = 'SIN_DIRECCION'` y
   retorna (R9). No debió encolarse, pero la dirección pudo vaciarse entre el encolado
   y la ejecución.
4. Calcula la huella y consulta la caché. **Acierto** → escribe coordenadas en la
   orden y retorna, sin tocar la red (R26).
5. **Sin credencial** (`GOOGLE_MAPS_API_KEY === null`) → **lanza**
   `GeocodeNoConfiguradoError` (R25). `JobQueueService.drenar` captura por job
   (`:72-76`), así que el resto del lote — incluido `liberar_reprogramadas`, que
   comparte cron — sigue drenando. Es exactamente el mismo mecanismo que ya protege a
   un tipo sin handler registrado (`:61-66`).
6. Llama al proveedor y aplica la tabla de decisión:

| `GeocodeOutcome` | Escribe en la orden | Desenlace del job |
| --- | --- | --- |
| `ok` | lat, lng, precision, `geocoded_at`, `status='OK'` + upsert en caché | retorna → `complete` |
| `sin_resultados` | `status='ZERO_RESULTS'`, `geocoded_at` | retorna → `complete` (R21) |
| `consulta_invalida` | `status='INVALID_REQUEST'`, `geocoded_at` | retorna → `complete` (R22) |
| `transitorio` | nada | **lanza** → backoff (R23) |
| `config_invalida` | nada | **lanza** → backoff → dead-letter (R24) |

Las dos filas "retorna → complete" son el núcleo de la decisión Q3: un
`ZERO_RESULTS` que lanzara gastaría 5 llamadas pagadas al proveedor por una dirección
que nunca va a resolver, y acabaría contaminando el dead-letter con ruido permanente.

**Idempotencia (R29):** el paso 4 y la escritura del paso 6 son ambos "leer estado,
escribir estado final por `ordenId`". Re-ejecutar produce el mismo resultado; la
segunda vez, además, acierta en caché y ni siquiera llama al proveedor. El upsert de
caché es por `direccion_hash` único, así que no duplica.

**Escritura de coordenadas:** `updateMany({ where: { id, deletedAt: null } })`, patrón
de `OrdenRepository.update()`. No usa `update()` porque no debe lanzar si la orden se
borró entre la lectura y la escritura.

**Logs (R31):** el logger inyectable solo emite mensajes agregados (`"[geocodificacion]
job sin credencial configurada"`). Nunca dirección, coordenadas ni credencial. Mismo
criterio que `JobsLogger` de la 90 (`JobQueueService.ts:11-16`).

---

## 6. Encolado desde los writers (transactional outbox)

Helper compartido en `lib/services/jobs/geocodificacion-encolado.ts`:

```ts
/**
 * Clave de idempotencia del job de geocodificacion (R12/R13, decision Q4).
 *
 * Los DOS componentes son obligatorios. NO simplificar a `geocodificacion:${ordenId}`:
 *  - el indice unico de `dedupe_key` es `UNIQUE ... WHERE dedupe_key IS NOT NULL`
 *    (migracion de la 90, :39): NO esta acotado por estado del job;
 *  - las filas de `jobs` no se purgan al completarse, asi que la fila `done` del primer
 *    encolado sigue ocupando la clave para siempre;
 *  - => corregir la direccion de una orden ya geocodificada chocaria con esa fila y el
 *    `ON CONFLICT DO NOTHING` descartaria el encolado EN SILENCIO: sin error, sin log,
 *    sin job. La orden conservaria para siempre las coordenadas de la direccion mala.
 *
 * Tampoco vale la huella sola: dos ordenes distintas con la misma direccion colisionan
 * y solo una recibiria coordenadas (rompe R6).
 */
export function dedupeKeyGeocodificacion(ordenId: string, hash: string): string {
  return `geocodificacion:${ordenId}:${hash.slice(0, 8)}`;
}

/** Encola dentro de la tx del writer. No-op si la dirección no es geocodificable. */
export async function encolarGeocodificacion(
  repo: IJobRepository,
  tx: JobTxClient,
  orden: { id: string; direccion: string | null },
): Promise<void>;
```

Usa el **4.º parámetro `tx`** de `IJobRepository.enqueue`
(`IJobRepository.ts:55-60`), que la 90 añadió explícitamente como "soporte
transactional-outbox para 91/92". Esto da R7 gratis: si la transacción del writer
revierte, el job desaparece con ella. No hay ventana en la que exista una orden sin su
job, ni un job sin su orden.

`maxIntentos: 8` en las opciones de encolado (override por fila, decisión Q3 → **R34**).
Es normativo, no un default sugerido: con el backoff base de 60 s de la 90, sube la
tolerancia a un corte del proveedor de ~15 min (default 5) a ~4 h antes del dead-letter.

### Puntos de enganche (líneas de `origin/dev`)

| Writer | Ubicación | Enganche |
| --- | --- | --- |
| `create()` | `OrdenRepository.ts:407`, tx `:410` | tras `tx.orden.create` (`:411-430`), junto al `appendCambioEstado` de `:432` |
| `createManyOrdenes()` | `:664`, tx `:674` | tras calcular `nuevas` (`:691`), junto al `appendCambioEstado` de `:693` |
| `update()` | `:483`, tx `:489` | tras el `updateMany` de `:500`; guard latente, ver C1/Q1 |

**Cambio necesario en la carga masiva (C3):** el `select` del `after` (`:687-690`) trae
`{ id, estatusId }`. Se amplía a `{ id, estatusId, direccion }` para poder decidir por
fila si encolar (R8/R9). Es aditivo sobre una query que ya se ejecuta.

**Guard de `update()` — latente por decisión Q1:** pre-lee `direccion` dentro de la tx
**solo si** `data.direccion !== undefined`, replicando el patrón que `update()` ya usa
para `estatusId` (`:492-498`), y encola solo si el valor difiere del almacenado
(R10/R11).

Hoy la condición **nunca se cumple** (C1) y así se queda: **no se amplía
`actualizarOrdenSchema` ni `toUpdateData`**. Se implementa igualmente porque el día que
el CRUD gane el campo `direccion`, sin este guard la orden quedaría con dirección nueva
y **coordenadas viejas, en silencio** — y nadie relacionaría ese bug con esta feature.
El código DEBE llevar un comentario que diga exactamente eso: que es un guard latente,
por qué hoy es inalcanzable, y que no es código muerto a eliminar.

### Decisión Q2 — un job por orden, no un job por lote

| | N jobs individuales | 1 job por lote |
| --- | --- | --- |
| Coste con Google | **igual** | **igual** |
| Reintento | por dirección | todo el lote reintenta por 1 fallo |
| `ZERO_RESULTS` en 1 de 200 | aislado | contamina el lote entero |
| Payload | `{ordenId}` | array de 200 ids |
| Aciertos de caché | por dirección | idem, pero re-pagando las ya hechas al reintentar |
| Filas en `jobs` | N | 1 |

El coste con el proveedor **es idéntico**: la Geocoding API no ofrece endpoint batch,
se paga por dirección resuelta en ambos diseños. Por tanto el único argumento a favor
del job por lote es el volumen de filas, que es barato (la 90 ya dejó el índice parcial
`jobs_run_after_pending_idx`). Todo lo demás favorece el job individual, sobre todo la
granularidad del reintento: un lote de 200 con una dirección irresoluble reintentaría
199 geocodificaciones ya pagadas cinco veces. **Se elige N jobs individuales.**

---

## 7. Wiring del cron

En `app/api/cron/procesar-jobs/route.ts`, dentro de `buildHandlers()` (`:32-39`):

```ts
handlers.set("geocodificacion", crearGeocodificacionHandler(buildGeocodificacionService(), now));
```

`buildRecurrencias()` (`:42-46`) **no se toca**: la geocodificación no es recurrente.
`vercel.json` **no se toca**: el drenado ya corre cada minuto.

Es la única línea de esta feature bajo `app/`, y es backend (registro de un handler en
un route de cron), consistente con `zone: "backend"`.

---

## 8. Alternativas descartadas

### 8.1 Geocodificar de forma síncrona al crear la orden — DESCARTADA

Sin cola: llamar a Google dentro del `create()`. Se descarta porque acopla la latencia
y la disponibilidad de un tercero al camino crítico de creación de órdenes: una caída
de Google impediría **crear órdenes**. Además, en carga masiva multiplicaría por N la
duración de un chunk, con el timeout de función de Vercel de por medio. La cola existe
precisamente para esto (feature 90).

### 8.2 Guardar coordenadas en tabla aparte (`orden_geocode` 1:1) — DESCARTADA

Más limpia conceptualmente (aísla PII de coordenadas, mantiene `orden` estrecha), pero
obliga a un join en todo consumidor futuro y a un `LEFT JOIN` en un listado ya pesado
(`OrdenRepository.list`). Con cinco columnas nullable y sin índice, el coste en `orden`
es despreciable. Se elige la columna directa. Se reconsideraría si aparecieran datos de
geocodificación de volumen (histórico de intentos, múltiples proveedores).

### 8.3 `dedupeKey = "geocodificacion:<ordenId>"` — DESCARTADA

Es la opción que sugería la descripción de la feature. Se descarta por un motivo
verificado en el código: el índice único de `dedupe_key` **no está acotado por estado**
(`UNIQUE … WHERE "dedupe_key" IS NOT NULL`, migración de la 90 `:39`) y las filas de
`jobs` no se purgan al completarse. Corregir la dirección de una orden ya geocodificada
chocaría con la fila `done` anterior y el `ON CONFLICT DO NOTHING` descartaría el
encolado **en silencio**: la corrección nunca se geocodificaría. Rompe R13. Se usa la
clave compuesta con la huella (Q4).

### 8.4 Enum nativo para `geocode_status` — DESCARTADA

Ver §1.1: ataría el esquema al vocabulario de un tercero, exigiendo una migración
`ALTER TYPE` (que además no puede usarse en la misma transacción) cada vez que Google
añada un estado, con fallo duro en producción entretanto.

### 8.5 Backfill del histórico — FUERA DE ALCANCE (decisión del humano)

Google cobra ~5 USD/1000 consultas; el coste es proporcional al histórico y no se pidió.
Si se quisiera después, la infraestructura ya está: basta un script que encole jobs
para las órdenes con `geocoded_at IS NULL`, y la caché absorbería las direcciones
repetidas.

### 8.6 Reutilizar `hashApiKey` para la huella de caché — DESCARTADA

Ver `requirements.md` Q6.

---

## 9. Seguimientos anotados (no son alcance de esta feature)

1. **`createManyOrdenesConGuia` (feature 88, PR #92).** Verificado: **no existe en
   `origin/dev`**. Será un cuarto choke-point cuando el PR #92 se mergee. Decisión Q9:
   **no se implementa a ciegas** contra un archivo que no está en la rama base. Cuando
   aterrice, aplicar el mismo `encolarGeocodificacion` dentro de su tx (~5 líneas,
   mismo helper). Seguimiento formal en `tasks.md` **T14**.
2. **Purga de `jobs`.** Las filas `done` crecen sin límite; con la clave compuesta de
   Q4 esto es correcto pero no gratuito. La 90 no definió retención.
3. **Primer consumidor de coordenadas.** Cuando exista, revisar si hace falta índice
   sobre `(latitud, longitud)` o `geocoded_at`.
4. **Purga / auditoría de `geocode_cache`.** Sin TTL por decisión Q7.
