# Feature 106 — Diseño técnico

El QUÉ vive en `requirements.md`. Aquí van las decisiones de implementación: modelo de
datos, rutas, contratos I/O, integraciones y las alternativas descartadas.

Todo lo que sigue reutiliza piezas verificadas contra el código; las rutas y símbolos
citados existen hoy salvo lo marcado como NUEVO.

---

## 0. Arquitectura por capas (Controller → Service → Repository)

```
app/api/ordenes/api-key/route.ts                  ← GET listado (Controller)
app/api/ordenes/api-key/[numGuia]/route.ts        ← GET detalle (Controller)
app/api/ordenes/api-key/[numGuia]/cancelar/route.ts ← PUT cancelar (Controller)
  ↓ (autenticación por key + validación zod en el borde)
lib/services/ApiOrdenLecturaService.ts   (NUEVO)  ← listar / detalle
lib/services/ApiOrdenCancelacionService.ts (NUEVO) ← cancelar (regla de estados + nota)
  ↓ (vía interfaces)
lib/repositories/OrdenRepository.ts               ← métodos scoped por owner (NUEVOS)
lib/storage/SupabaseSignedUrlProvider.ts          ← firma de evidencias (reuso)
lib/repositories/registrar-cambio-estado.ts       ← appendCambioEstado (choke point, reuso)
```

- El borde (route handler) copia la estructura de
  `app/api/ordenes/api-key/carga/route.ts`: `extraerBearer`, `deps` inyectables para
  tests (autenticar + services fake, sin DB/cookies reales), `withErrorHandler`,
  `isAppErrorShape` → `appErrorToResponse`.
- La regla de negocio (scope, estados permitidos, resolución de evidencias, nota de
  gestión) vive en los services, testeable sin HTTP ni DB.
- El scope por owner se aplica en el `WHERE` del repositorio (R7), y además el service lo
  reafirma comparando `tienda_id === actor.usuarioId` (defensa en profundidad).

---

## 1. Autenticación (transversal)

Idéntico a la carga por API (feature 88). `extraerBearer(req)` → `rawKey | null`;
`autenticar(rawKey)`: `unauthenticated` → `UnauthenticatedError` (401, R1/R2);
`forbidden` → `ForbiddenError` (403, R3); `ok` → `actor = { usuarioId, rol }`, owner =
`actor.usuarioId` (R4). Se autentica ANTES de parsear cuerpo/params. La key nunca entra a
logs ni a errores (R5).

---

## 2. Endpoint 1 — Listado `GET /api/ordenes/api-key`

**Entrada (query):** `?limit=<1..100, default 50>&offset=<0.., default 0>&estado=<opcional:
OrderStatusValue>`. Validado con zod (`z.coerce.number().int()` + `.min/.max`). Inválido →
`ValidationError` sin consultar (R9). Cualquier `tiendaId`/`owner` en la query se ignora
(no está en el schema) → R8.

**Salida (200):**
```json
{ "items": [ { "numGuia": 10234, "numRemision": "R-1", "estado": "en_bodega",
               "createdAt": "2026-07-20T15:04:00.000Z", "...campos públicos" } ],
  "pagination": { "limit": 50, "offset": 0, "total": 173 } }
```

**Repositorio (NUEVO):** `OrdenRepository.listByOwner({ ownerId, estatusId?, skip, take })`
reutiliza el patrón de `OrdenRepository.list` (línea 492) con `where.tiendaId = ownerId`
FORZADO (no opcional) y `deleted_at: null` (R6/R7/R11). Devuelve `{ items, total }`. Usa el
índice existente sobre `tienda_id`.

**Service (NUEVO):** `ApiOrdenLecturaService.listar(actor, { limit, offset, estado })`
resuelve `estatusId` si viene `estado`, llama al repo con `ownerId = actor.usuarioId`,
mapea a DTO público (sin PII de terceros).

---

## 3. Endpoint 2 — Detalle `GET /api/ordenes/api-key/[numGuia]`

**Identificador:** `num_guia` (decisión (d) del gate). Path param validado como entero
positivo (`z.coerce.number().int().positive()`); inválido → `ValidationError`.

**Flujo:**
1. `OrdenRepository.findDetalleByNumGuiaForOwner(numGuia, ownerId)` (NUEVO): orden con
   `estatus.value` + sus gestiones con `resultado IN ('entregada','rechazada')` y
   `evidencia_storage_path IS NOT NULL`, SOLO si `tienda_id === ownerId` y `deleted_at IS
   NULL`; `null` en cualquier otro caso. Include para evitar N+1.
2. `null` → `NotFoundError` (404). Cubre "no existe" (R13) y "de otro owner" (R14) con la
   MISMA respuesta.
3. Firmar cada `evidencia_storage_path` con
   `SupabaseSignedUrlProvider.createSignedUrls(paths, gestionConfig.SIGNED_URL_TTL_SECONDS)`
   contra `gestionConfig.EVIDENCIA_BUCKET` (`gestion-evidencias`).

**Salida (200):**
```json
{ "numGuia": 10234, "numRemision": "R-1", "estado": "entregada", "createdAt": "...",
  "...campos públicos",
  "evidencias": [ { "resultado": "entregada", "contentType": "image/jpeg",
                    "url": "https://<proyecto>.supabase.co/storage/v1/object/sign/...",
                    "expiraEnSegundos": 300 } ] }
```
- `evidencias: []` cuando no hay (R18).
- NUNCA se incluye `evidencia_storage_path` crudo, ni el bucket, ni el mensajero/actor de
  la gestión (R16). La URL la produce el servidor con service role (R17).

---

## 4. Endpoint 3 — Cancelación `PUT /api/ordenes/api-key/[numGuia]/cancelar`

**Verbo: PUT** (decisión (c) del gate). Sin cuerpo obligatorio; `numGuia` en el path.

**Regla de estados (R19/R20):**
```
ESTADOS_CANCELABLES = { "en_bodega", "en_ruta_bodega_principal" }
ESTADO_DESTINO       = "devuelta_origen"   // reutilizado, YA existe en ORDER_STATUS_SEED
```
`ApiOrdenCancelacionService.cancelar(actor, numGuia)`:
1. El repo abre transacción y lee la orden por `num_guia` DENTRO de la tx (extiende
   `findByNumGuiaForTransicion`, línea 1018, para exigir `tienda_id === ownerId` y
   `deleted_at IS NULL`).
2. No existe / borrada / de otro owner → `not_found` → `NotFoundError` (404) (R23/R24).
3. `estatusValue ∉ ESTADOS_CANCELABLES` → `conflict` → `ConflictError` (409) (R20). Una
   orden ya en `devuelta_origen` cae aquí.
4. En estado cancelable, EN LA MISMA TX (R25):
   - `UPDATE orden SET estatus_id = <devuelta_origen>`.
   - `appendCambioEstado(tx, [{ ordenId, estatusOrigenId, estatusDestinoId:
     devueltaOrigenId, actorUsuarioId: actor.usuarioId, origenTipo: 'cancelacion_api',
     motivo: 'cancelada por tienda' }])` (R21/R22/R26). El outbox de webhooks (feature 104)
     ya vive dentro de `appendCambioEstado` → la cancelación dispara el webhook sin código
     extra.
   - **NO se escribe nada en `gestion_orden`** (decisión (b) del gate; su esquema no se
     toca).

**Salida (200):** `{ "numGuia": 10234, "estadoAnterior": "en_bodega", "estado":
"devuelta_origen" }`

### 4.1 Nota `"cancelada por tienda"` en la bitácora (R26) — VERIFICADO contra el código

El marcador se persiste en `orden_historial_estado.motivo` a través de `appendCambioEstado`;
NO se toca `gestion_orden`.

- **`appendCambioEstado` YA acepta y persiste `motivo`** (VERIFICADO,
  `lib/repositories/registrar-cambio-estado.ts:33`): mapea `motivo: e.motivo ?? null` al
  `createMany` de `ordenHistorialEstado`. El tipo de entrada `CambioEstadoEntrada`
  (`IOrdenHistorialRepository`) ya incluye `motivo`. **No requiere extensión de la función.**
- La columna existe: `orden_historial_estado.motivo` (`String?`, columna real **`motivo`**,
  sin `@map`, `db/schema.prisma:941`; comentario del modelo: "de la gestion (R22); vacio en
  las demas transiciones"). Aquí se usa para el marcador de cancelación.
- `gestion_orden` NO se modifica: su esquema (incl. `mensajero_id` NOT NULL, enum
  `GestionResultado`) queda intacto. Esta feature solo LEE `gestion_orden` en el detalle
  (Bloque C / evidencias), nunca escribe en él.

---

## 5. Modelo de datos y migración

> La cancelación **NO** crea el estado `cancelada` ni migra el enum de estatus de orden
> (decisión (a): se reutiliza `devuelta_origen`, ya en `ORDER_STATUS_SEED`) y **NO** toca
> `gestion_orden` (decisión (b): el marcador va a la bitácora). La feature tiene UNA sola
> migración: el `origen_tipo` (§5.1).

### 5.1 Única migración: nuevo `origen_tipo` `cancelacion_api` (R27/R28)

**Por qué un valor nuevo y no reusar uno existente (VERIFICADO en
`lib/types/orden-historial.ts`, `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`):** el SEED lista un
valor por FAMILIA/call-site de transición. Los candidatos a reutilizar y por qué NO sirven:
- `carga_api` (feature 88): es el canal integrador, pero su semántica es "estado INICIAL en
  la carga por API" (creación), no una cancelación. Reutilizarlo mezclaría dos familias.
- `ajuste_estado` (feature 6): es el CRUD genérico (`OrdenService.actualizar`), otro
  call-site. La cancelación va por un método de repo NUEVO (`cancelarViaApi`), no por ese.
- Ningún otro valor representa una cancelación por integrador.
→ Se agrega `"cancelacion_api"` (una familia = un call-site, invariante del SEED). El SEED
tiene `satisfies readonly PrismaOrdenHistorialOrigenTipo[]` + guard `_EnsureExhaustive`, así
que el enum Postgres DEBE ganar el valor por migración o el build rompe.

Migración `db/migrations/<ts>_cancelacion_api_por_key/`:
- `migration.sql`: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS
  'cancelacion_api'`. El seed idempotente que itera el SEED lo cubre sin datos extra.
- `down.sql`: Postgres no soporta `DROP VALUE` de un enum → documenta la irreversibilidad
  parcial del `ADD VALUE` (MISMO patrón que la feature 104, verificar contra su migración).

Es la **ÚNICA** migración de la feature. NO se migra el enum de estatus de orden (se reutiliza
`devuelta_origen`, existente) NI la tabla `gestion_orden` (no se toca su esquema).

### 5.2 RLS
No se crean tablas. `orden`, `orden_historial_estado`, `gestion_orden` ya tienen su RLS
(solo service role); esta feature no la modifica. El scope por owner de esta API se aplica
en el `WHERE` del repo (el service role bypassa RLS), por eso R6/R7 exigen el filtro
explícito.

---

## 6. Integraciones
- **Supabase Storage:** `SupabaseSignedUrlProvider` (bucket `gestion-evidencias`), TTL
  `gestionConfig.SIGNED_URL_TTL_SECONDS` (5 min). Inyectable (`SignedUrlClientLike`) →
  tests sin red.
- **Webhooks feature 104:** automático vía `appendCambioEstado`; esta feature solo aporta
  el nuevo `origen_tipo` y usa el estado destino existente `devuelta_origen`.
- **Errores:** `lib/errors` — `UnauthenticatedError`, `ForbiddenError`, `ValidationError`,
  `NotFoundError`, `ConflictError` (confirmar que las dos últimas existen; si no, usar el
  mecanismo equivalente del manejador global, NO inventar formato — tarea T2).

---

## 7. Decisiones del gate F1.4 (CERRADO)

Todas aprobadas por el humano; sin secciones abiertas. Se conserva una alternativa
descartada por decisión para trazabilidad.

| # | Decisión FIJADA | Alternativa descartada |
|---|---|---|
| (a) | **Reutilizar `devuelta_origen`** como estado destino de la cancelación (ya existe en `ORDER_STATUS_SEED`). La cancelación se distingue de una devolución real por la nota `gestion_orden.motivo = "cancelada por tienda"`. | **Crear un estado nuevo `cancelada`** (migración de enum + seed): descartado por el humano a favor de reutilizar `devuelta_origen` + nota semántica, evitando ampliar el catálogo de estatus y su impacto en métricas/flujos. |
| (b) | **Marcador SOLO en la bitácora:** `appendCambioEstado` persiste `motivo = "cancelada por tienda"` en `orden_historial_estado.motivo`. `gestion_orden` NO se escribe ni se migra. | Escribir una fila en `gestion_orden`: descartado por el humano (opción más simple) — habría exigido relajar `mensajero_id` a NULLABLE y elegir un `resultado`, con ripple de esquema; el marcador en la bitácora cubre el requisito sin tocar `gestion_orden`. |
| (c) | **Verbo PUT** en `/api/ordenes/api-key/[numGuia]/cancelar`. | POST: descartado por decisión del humano. |
| (d) | **Identificador `num_guia`** (es lo que la carga por API devuelve al integrador; ya hay lookup UNIQUE). | `id` UUID interno: descartado — el integrador nunca lo recibe. |
| (e) | **Paginación `offset/limit`**, `limit` default 50, **máx 100**, `offset ≥ 0`; salida con `total`. | Cursor (keyset): descartado por ahora; follow-up. |
| (f) | **Signed URLs** con `gestionConfig.SIGNED_URL_TTL_SECONDS` (**5 min**); respuesta solo `{ url, contentType, resultado, expiraEnSegundos }`, sin PII del mensajero. | Proxy/stream del binario por el endpoint: descartado — coste de ancho de banda y pierde el CDN de Storage. |

> **Alternativa de arquitectura descartada:** exponer los tres endpoints como **una sola
> ruta REST `/api/ordenes/api-key/[[...slug]]`** multiplexando por método/segmento.
> Descartada: mezcla tres responsabilidades en un handler, complica zod y el mapeo de
> errores, y contradice el patrón "un handler = una responsabilidad" de la feature 88.

---

## 8. Seguridad (invariantes)
- Owner SIEMPRE = `actor.usuarioId`; nunca desde el input (R4).
- Scope en el repo (`WHERE tienda_id = ownerId`), reafirmado en el service (R7).
- 404 uniforme para inexistente y ajeno (no se filtra existencia) — R14/R23.
- La key nunca se loguea/serializa (R5).
- Evidencias: solo URL firmada de 5 min; sin path crudo, sin bucket, sin PII de terceros
  (R16/R17).
