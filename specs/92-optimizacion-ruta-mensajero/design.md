# Feature 92 — Optimización de ruta del mensajero · design

Base: `origin/dev` (5244cf3, ya trae 90 y 91). Zona `fullstack`.

---

## §0 — Correcciones a las premisas del briefing

Tres puntos del briefing del leader que **no** sobreviven a la lectura del código. Se documentan
aquí (precedente 78/73/91) porque cambian el diseño, no solo la redacción.

### §0.1 — La fuente de verdad de "dirección no encontrada" es la ORDEN, no la cola

El briefing plantea el gate como una consulta a `jobs`: *job agotado → "dirección no encontrada"*.
Verificado en `lib/services/GeocodificacionService.ts:141-163`: los desenlaces `sin_resultados`
(`ZERO_RESULTS`) y `consulta_invalida` (`INVALID_REQUEST`) **escriben el status en la orden y
`return`** — es decir, el job termina en `done`, **no** en `failed`. Lo mismo `SIN_DIRECCION`
(`:88-97`). Por tanto:

> El caso más frecuente de "la dirección no se pudo geocodificar" **nunca** aparece en `jobs` como
> job agotado. Un gate que solo mire `jobs` lo clasificaría como "no hay job" y re-encolaría en
> bucle una dirección que ya se sabe irresoluble, pagando una llamada cada vez.

De ahí el orden del árbol de decisión (R2 → R3 → R4): coordenadas, luego `geocode_status`
determinista, y **solo entonces** la cola. La cola queda para su único trabajo real: distinguir
"todavía no se intentó" de "se intentó y reventó por causa transitoria hasta agotar intentos".

### §0.2 — El prefijo no hace falta: la clave exacta se puede reconstruir

El briefing insiste en buscar por prefijo `geocodificacion:<ordenId>:` y en decidir "cuál manda"
entre varias filas. Verificado: `hashDireccion` está **exportado** (`lib/geo/direccion-query.ts`, lo
importa `geocodificacion-encolado.ts:7`) y `dedupeKeyGeocodificacion(ordenId, hash)` se calcula
sobre `orden.direccion` cruda (`:63`), no sobre la consulta completa. Como el gate ya tiene la orden
en la mano, **puede reconstruir la clave exacta de la dirección actual**.

Consecuencias, todas a favor de la clave exacta:

| | Prefijo `LIKE 'geocodificacion:<id>:%'` | Clave exacta reconstruida |
| --- | --- | --- |
| Índice | El único existente (`jobs_dedupe_key_key`, btree default) **no** sirve para `LIKE` bajo collation no-C → hay que crear otro con `text_pattern_ops` | Usa el índice único **ya existente** |
| Lote | `LIKE ANY(array)` no indexa bien → N consultas o seq scan | `WHERE dedupe_key IN (...)`, una consulta por lote |
| Semántica | Devuelve jobs de direcciones **históricas**; hay que inventar un desempate | Solo el job de la dirección **vigente**, que es el único que responde por ella |
| Dirección corregida | Un job `failed` de la dirección vieja bloquearía la orden aunque la dirección ya se corrigió | La ausencia de job para el hash nuevo dispara correctamente el encolado puntual (R7) |

El leader tiene razón en el diagnóstico (buscar por igualdad con `geocodificacion:<ordenId>` sin
hash **no encuentra nada nunca**), pero la solución correcta es reconstruir el hash, no relajar la
búsqueda a prefijo. → **Q1** del gate.

### §0.3 — "intentos agotados" ⇔ `estado = 'failed'`, y nada más

El briefing sugiere el predicado `intentos >= maxIntentos`. Verificado en `JobRepository.claimBatch`
(`:116`): el claim **incrementa `intentos` antes de ejecutar** el handler. Y en
`JobQueueService.manejarFallo` (`:97-101`): el dead-letter se decide comparando `intentos >=
maxIntentos` **en el momento del fallo**. Por tanto una fila `processing` con
`intentos == maxIntentos` está ejecutando su último intento y **puede terminar en `done` con
coordenadas**. Usar `intentos >= maxIntentos` como predicado bloquearía órdenes que están a punto de
resolverse. El único predicado correcto y estable es `estado = 'failed'` (R5).

### §0.4 — Rectificaciones menores (el briefing acierta, se confirma)

- `GestionOrdenRepository.ts:78` — único `orderBy`, `createdAt desc`. **Confirmado.**
- `MisAsignacionesService.ts:80-84` — partición en dos arrays preservando orden. **Confirmado**
  (además calcula KPIs, `:87-95`, que esta feature no toca).
- El módulo no usa SWR; `router.refresh()` en `:81,105,120,129,140`. **Confirmado.**
- `IJobRepository` no permite cancelar ni reprogramar un `pending`. **Confirmado** — condiciona el
  diseño del debounce (§4).
- Un matiz que el briefing no menciona: **el gate de asignabilidad no lo dispara el mensajero**. Los
  tres writers de `mensajero_asignado_id` son `GuiaAsignacionService.generarGuia` /
  `.asignarDesdeBodega` (rol `maestro`) y `AsignacionSateliteService.asignar` (rol
  `adminSatelite`). El toast "dirección no encontrada" vive por tanto en la UI del **maestro/bodega**
  (`GenerarGuiaModal`, `AsignarBodegaModal`, `AsignarSateliteModal`), no en la del mensajero.

---

## §1 — Modelo de datos

### §1.1 — Tablas nuevas

Dos tablas: cabecera por mensajero + detalle por parada.

```sql
CREATE TABLE "ruta_optimizada" (
  "id"             TEXT NOT NULL,
  "mensajero_id"   TEXT NOT NULL,          -- FK -> usuario, UNIQUE (una ruta vigente por mensajero)
  "estado"         "ruta_estado" NOT NULL DEFAULT 'vigente',  -- vigente | desactualizada
  "calculada_at"   TIMESTAMP(3),           -- NULL = nunca se calculó
  "origen_lat"     DECIMAL(10,7),
  "origen_lng"     DECIMAL(10,7),
  "origen_at"      TIMESTAMP(3),
  "origen_fuente"  TEXT,                   -- gps | ultima_conocida | centroide (vocabulario propio)
  "huella_set"     TEXT,                   -- huella del conjunto de paradas + origen (R36)
  "ultimo_error"   TEXT,                   -- mensaje agregado, SIN PII ni credenciales
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ruta_optimizada_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ruta_optimizada_mensajero_id_key" ON "ruta_optimizada" ("mensajero_id");

CREATE TABLE "ruta_optimizada_parada" (
  "id"        TEXT NOT NULL,
  "ruta_id"   TEXT NOT NULL,   -- FK -> ruta_optimizada ON DELETE CASCADE
  "orden_id"  TEXT NOT NULL,   -- FK -> orden ON DELETE CASCADE
  "secuencia" INTEGER NOT NULL,
  CONSTRAINT "ruta_optimizada_parada_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "..._ruta_orden_key"     ON "ruta_optimizada_parada" ("ruta_id", "orden_id");
CREATE UNIQUE INDEX "..._ruta_secuencia_key" ON "ruta_optimizada_parada" ("ruta_id", "secuencia");
CREATE INDEX        "..._orden_idx"          ON "ruta_optimizada_parada" ("orden_id");

ALTER TABLE "ruta_optimizada"        ENABLE ROW LEVEL SECURITY;  -- sin policies (solo service role)
ALTER TABLE "ruta_optimizada_parada" ENABLE ROW LEVEL SECURITY;
```

`down.sql`: `DROP TABLE ruta_optimizada_parada; DROP TABLE ruta_optimizada; DROP TYPE ruta_estado;`
— arrastra PKs, índices, FKs y la config de RLS (patrón exacto del `down.sql` de la 91).

RLS habilitada **sin policies**, patrón `jobs` / `geocode_cache` / `api_key` verificado: la tabla
solo se toca desde el servidor.

### §1.2 — Migración del enum `job_tipo`

Migración **propia y aislada**, sin ninguna sentencia que consuma el valor (R40, motivo 55P04
documentado en la migración de la 91):

```sql
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'optimizacion_ruta';
```

Orden de aplicación: `..._job_tipo_optimizacion_ruta` → `..._ruta_optimizada`.

### §1.3 — Índice que esta feature SÍ necesita en `orden`

La 91 dejó `latitud`/`longitud` **sin índice** por no tener consumidor (verificado en su
`migration.sql`). Esta feature es ese consumidor, pero el acceso es siempre
`WHERE mensajero_asignado_id = ? AND estatus...`, que ya está indexado
(`orden_mensajero_asignado_id_idx`). Las coordenadas se leen de las filas ya seleccionadas.
**Decisión: no se añade índice sobre `(latitud, longitud)`** — sería coste de escritura sin lector.

---

## §2 — Configuración y credencial

`lib/config/route-optimization.ts`, clon estructural de `lib/config/geocode.ts` (**nunca lanza**,
lee `process.env` en cada llamada, secreto → `string | null`):

| Env | Tipo | Default |
| --- | --- | --- |
| `GOOGLE_ROUTE_OPT_PROJECT_ID` | `string \| null` | — |
| `GOOGLE_ROUTE_OPT_SA_EMAIL` | `string \| null` | — |
| `GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY` | `string \| null` | — (PEM, `\n` escapados) |
| `ROUTE_OPT_TIMEOUT_MS` | `number` | `20_000` |
| `RUTA_DEBOUNCE_S` | `number` | `60` |
| `RUTA_ORIGEN_TTL_MIN` | `number` | `120` 🧭 |
| `RUTA_SYNC_MIN_INTERVALO_S` | `number` | `10` 🧭 |
| `RUTA_MAX_PARADAS` | `number` | `100` 🧭 |

**La credencial de la 91 (`GOOGLE_MAPS_API_KEY`) NO sirve**: Route Optimization no acepta API key.
Decisión ✅ del humano, tomada a sabiendas.

### §2.1 — Token OAuth2 (`lib/auth/google-sa-token.ts`)

Primer OAuth2 saliente del repo. Flujo JWT-bearer (RFC 7523):

1. Construir `{alg:RS256,typ:JWT}` + claims `{iss: sa_email, scope:
   "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token",
   exp: now+3600, iat: now}`.
2. Firmar con `node:crypto` `createSign("RSA-SHA256")` sobre la clave PEM.
3. `POST https://oauth2.googleapis.com/token` con
   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`.
4. Cachear `access_token` en memoria del módulo hasta `exp - 60 s` (R11).

`fetch` y reloj **inyectables** (patrón `GoogleGeocodeClient`): los tests no tocan la red ni
necesitan una clave real (se firma con un par RSA generado en el propio test).

Si falta cualquiera de las tres piezas → `RutaNoConfiguradoError` **antes** de firmar nada (R12).

---

## §3 — Cliente HTTP (`lib/clients/google-route-optimization.ts`)

Interfaz en `lib/interfaces/external/IRouteOptimizationClient.ts`:

```ts
export interface ParadaEntrada { ordenId: string; lat: number; lng: number; }
export interface OptimizarInput { origen: { lat: number; lng: number }; paradas: ParadaEntrada[]; }
export type OptimizarOutcome =
  | { status: "ok"; secuencia: string[] }              // ordenIds en orden de visita
  | { status: "transitorio"; detalle: string }
  | { status: "config_invalida"; detalle: string };

export interface IRouteOptimizationClient {
  optimizar(input: OptimizarInput): Promise<OptimizarOutcome>;
}
```

**Endpoint:** `POST https://routeoptimization.googleapis.com/v1/projects/{projectId}:optimizeTours`
con `Authorization: Bearer <token>`.

**Request (forma mínima):** un `vehicle` con `startWaypoint` en el origen; un `shipment` por parada
con un `deliveries[0].arrivalWaypoint` en sus coordenadas. El índice del shipment en el array es la
correspondencia con `ordenId` (se mantiene el array de entrada como tabla de traducción; **no** se
envía el `ordenId` al proveedor: no hace falta y reduce lo que sale del sistema).

**Response:** `routes[0].visits[]`, cada `visit` con `shipmentIndex`. La secuencia se reconstruye
mapeando `shipmentIndex → ordenId`.

> ⚠️ Los nombres exactos de campos del proveedor se verifican contra la documentación **en la task
> del cliente** (T5). No están en el repo ni en `docs/`, así que aquí son la forma esperada, no un
> hecho verificado. El schema zod es el que fija el contrato real (R13).

**Invariantes del archivo** (heredados de `google-geocode.ts`):
1. `fetch` inyectable.
2. Validación zod en el borde, sin `passthrough`.
3. Ningún mensaje de error cita token, URL, coordenadas ni dirección (R14).

Mapeo de desenlaces (R15): red/timeout/5xx/429 → `transitorio`; 401/403 → `config_invalida`;
2xx con forma inválida → lanza `RutaRespuestaInvalidaError`.

---

## §4 — Encolado, debounce y disparo inmediato

`lib/services/jobs/optimizacion-ruta-encolado.ts`, espejo de `geocodificacion-encolado.ts`:

```ts
export const DEDUPE_PREFIX = "optimizacion_ruta";
export const OPTIMIZACION_MAX_INTENTOS = 5;   // default de la cola; el fallo aquí no es crítico

/** Debounce: la ventana temporal hace que la clave NO quede ocupada para siempre (R18). */
export function dedupeKeyDebounce(mensajeroId: string, runAfter: Date): string {
  const ventana = Math.floor(runAfter.getTime() / 60_000);
  return `${DEDUPE_PREFIX}:${mensajeroId}:debounce:${ventana}`;
}

/** Inmediato: NAMESPACE DISTINTO + componente único por evento -> nunca lo traga el debounce. */
export function dedupeKeyInmediato(mensajeroId: string, eventoId: string): string {
  return `${DEDUPE_PREFIX}:${mensajeroId}:inmediato:${eventoId}`;
}
```

### §4.1 — Por qué el inmediato no queda descartado (punto duro C)

El problema real del briefing: si el inmediato compartiera `dedupeKey` con el debounce, el
`ON CONFLICT DO NOTHING` lo descartaría **en silencio**. Se resuelve con **dos espacios de claves
disjuntos**: `:debounce:` y `:inmediato:`. Nunca colisionan, así que el disparo de la gestión
siempre inserta su fila y siempre corre sin delay.

El precio es que el job de debounce en vuelo **también** correrá al vencer su minuto — y no se puede
cancelar (`IJobRepository` no expone cancelación; verificado). Por eso **R20**: el handler completa
sin llamar al proveedor si `ruta.calculada_at > job.createdAt`, es decir, si una optimización
posterior al evento que generó este job ya cubrió el trabajo. Coste evitado sin infraestructura
nueva y sin ampliar la interfaz de la cola.

> **Decisión explícita: NO se añade ningún método de cancelación a `IJobRepository`.** La guarda de
> obsolescencia (R20) resuelve el mismo problema en el handler, es testeable sin DB y no toca una
> interfaz compartida con las features 90 y 91.

### §4.2 — Elección de la ventana del debounce

`ventana = floor(runAfter / 60_000)` con `runAfter = now + 60 s`. Dos recogidas dentro del mismo
minuto de destino producen la misma clave → la segunda se descarta y el job corre en el `runAfter`
de la **primera**, que es exactamente la semántica pedida ("se espera el minuto entero del primero").

Efecto de borde honesto: si el segundo evento cae cerca del final de la ventana, el debounce efectivo
para ese segundo evento puede ser menor a 60 s (nunca mayor a 120 s). Se acepta: nunca dispara de
más y nunca deja de disparar.

Y como la ventana avanza con el reloj, la clave **nunca** queda permanentemente ocupada por una fila
`done` (R18) — la trampa que documentó el gate F1.4-Q4 de la 91.

### §4.3 — Puntos de enganche (outbox, dentro de la tx existente)

| Disparador | Archivo · función | Clave |
| --- | --- | --- |
| Recoger / aceptar | `GestionOrdenRepository.recogerLote` (`$transaction`) | `dedupeKeyDebounce` |
| Gestionar (los 4 resultados) | `GestionOrdenRepository.crearGestionYTransicionar` (`$transaction`) | `dedupeKeyInmediato(mensajeroId, gestionId)` |
| Botón manual | Server Action, **síncrono**, sin cola (§6) | — |

`GestionOrdenRepository` recibe `jobRepo: IJobRepository` por constructor, exactamente como
`OrdenRepository` en la 91 (verificado, `:11-13` y `:461`). El `tx` de Prisma se pasa como 4.º
parámetro de `enqueue` → si la transacción revierte, el job se va con ella.

Para la gestión, el `eventoId` es el `id` de la `gestion_orden` recién creada dentro de la misma
transacción: único por evento, disponible sin generar nada nuevo.

### §4.4 — Handler y registro

`lib/services/jobs/optimizacion-ruta-handler.ts` (delgado, espejo del de geocodificación) +
`handlers.set("optimizacion_ruta", ...)` en `buildHandlers()`. **No** se registra en
`buildRecurrencias()` (R21): se encola por evento.

Payload: `{ mensajeroId }` y nada más — ni coordenadas ni direcciones (regla de PII de la 91).

---

## §5 — Servicio de optimización

`lib/services/OptimizacionRutaService.ts`. DI por interfaces, sin HTTP ni Prisma.

```
ejecutar(mensajeroId, opts: { motivo, jobCreatedAt? })
  1. leer ruta vigente + órdenes en_reparto del mensajero (con lat/lng)
  2. R20  jobCreatedAt < ruta.calculada_at            -> completar, sin llamada
  3. R35  paradas con coordenadas <= 1                -> persistir trivial, sin llamada
  4. R38  paradas > RUTA_MAX_PARADAS                  -> recortar por createdAt asc
  5. resolver origen (§5.1)
  6. R36  huella(set de paradas + origen) == ruta.huella_set  -> completar, sin llamada
  7. client.optimizar(...)
     - ok            -> reemplazar paradas en UNA tx, estado='vigente', calculada_at=now
     - transitorio /
       config_invalida -> NO tocar paradas; estado='desactualizada', ultimo_error; LANZAR (backoff)
```

El paso 7 conserva el último orden válido ante fallo (R27, ✅ decisión 3 del humano). El estado
`desactualizada` es lo que alimenta el aviso de la UI (R30). **Nunca** se borra la secuencia previa.

### §5.1 — Resolución del origen (R24, punto duro del fallback)

```
gps reciente (origen_at >= now - RUTA_ORIGEN_TTL_MIN)  -> fuente "gps"
última conocida aunque vencida                          -> fuente "ultima_conocida"
centroide de las paradas                                -> fuente "centroide"
```

No hay cuarto escalón: si no hay ni una parada con coordenadas, ya cortó en el paso 3. La denegación
del permiso del navegador **no aborta nada** (R25): la acción simplemente no envía `ubicacion` y el
servicio cae al escalón siguiente. La fuente se persiste y se muestra en la UI, para que el mensajero
sepa que la ruta se calculó desde un punto aproximado.

### §5.2 — Escritura atómica de la secuencia

`RutaOptimizadaRepository.reemplazarSecuencia(mensajeroId, secuencia, meta)` en un `$transaction`:
`DELETE` de las paradas de la ruta + `createMany` de las nuevas + `UPDATE` de la cabecera. Los dos
índices únicos `(ruta_id, orden_id)` y `(ruta_id, secuencia)` hacen imposible persistir una
secuencia con huecos duplicados o dos posiciones para la misma orden (R26).

---

## §6 — Lectura y UI

### §6.1 — Orden de las cards

`GestionOrdenRepository.findMisAsignaciones` **no cambia su `orderBy`** (`createdAt desc` sigue
siendo el orden base y el de "Por recoger", R29). El reordenado vive en
`MisAsignacionesService.listarMisAsignaciones`, que ya particiona en dos arrays (`:80-84`):

```
porGestionar = [ ...con posición ordenados por secuencia asc,
                 ...sin posición en el orden que ya traían (createdAt desc) ]
```

`MiAsignacionDTO` gana `secuenciaRuta: number | null`, y el resultado del service gana
`ruta: { estado, calculadaAt, origenFuente, paradasSinOptimizar }`.

Esto responde el punto duro E: **el orden nuevo llega por el mismo camino que ya existe** —
Server Component → Server Action de prefetch → props → `router.refresh()`. No se introduce SWR ni un
fetcher de cliente.

### §6.2 — Botón de sincronización manual

`lib/actions/ruta-mensajero.ts` → `sincronizarRuta({ ubicacion? })`:
`resolveActorFromSession` → `rol !== "mensajero"` → `forbidden` (R33) → zod en el borde (R22) →
`OptimizacionRutaService.ejecutar(..., { motivo: "manual" })` **síncrono** → el cliente hace
`router.refresh()`.

Es síncrono a propósito (**Q5**): encolarlo obligaría a esperar hasta 60 s al cron sin feedback, en
un módulo que no tiene SWR con el que hacer polling. R34 (intervalo mínimo) acota el gasto ante
doble clic.

El botón se renderiza solo dentro de `MisAsignacionesModule`, que solo se monta desde una página que
ya hace `notFound()` para roles distintos de `mensajero` (verificado). La guarda de rol en la action
es defensa en profundidad.

### §6.3 — Geolocalización en el cliente

Hook `hooks/useUbicacionActual.ts`: `navigator.geolocation.getCurrentPosition` con timeout, estado
`{ coords | null, denegado: boolean }`. Se pide al montar el módulo y se adjunta (si existe) a
`recogerAsignaciones`, `gestionar` y `sincronizarRuta`. Denegación → se envía sin `ubicacion`.
`navigator.geolocation` se mockea en los tests de componente.

---

## §7 — Gate de asignabilidad

`lib/services/AsignabilidadCoordenadasService.ts` — servicio propio, consumido por los **tres**
writers de `mensajero_asignado_id` (§0.4), para que la regla no se duplique tres veces:

```ts
evaluar(ordenes: OrdenAsignabilidadRow[]): Promise<Map<string, EstadoAsignabilidad>>
```

Una sola pasada por lote:
1. Particionar por R2/R3 sin tocar la cola.
2. Para el resto, reconstruir las claves exactas y **una** consulta
   `findByDedupeKeys(keys)` (§8).
3. Clasificar por `estado` del job (R5/R6).
4. Para las órdenes sin job, `encolarGeocodificacion` puntual (helper de la 91, reutilizado tal
   cual) y clasificar `geocodificacion_encolada` / `geocodificacion_no_encolable` (R7).

El encolado puntual del paso 4 corre **fuera** de la transacción de asignación: la asignación se
aborta de todas formas (R8), así que el job debe sobrevivir al abort.

Los tres services traducen el mapa a su `DetalleConflicto` existente (`{ ordenId, motivo }`), sin
inventar un tipo de resultado nuevo.

---

## §8 — Ampliación de `IJobRepository`

Un único método nuevo:

```ts
/** Devuelve los jobs cuya `dedupe_key` esté en `keys`. Consulta única; usa el índice único. */
findByDedupeKeys(keys: string[]): Promise<JobDTO[]>;
```

Justificación (obligada por el briefing): la interfaz solo exponía
`enqueue`/`claimBatch`/`complete`/`fail`, y el gate necesita **leer** el estado de un job. Es una
lectura pura, sin lógica de negocio (`docs/architecture.md` §Repository), y no requiere índice nuevo
(§0.2). `keys` vacío → `[]` sin consulta.

**No** se añade `cancel` ni `reschedule` (§4.1).

---

## §9 — Alternativas descartadas

### A. Routes API `computeRoutes` con `optimizeWaypointOrder` — DESCARTADA POR OVERRIDE ✅

Era la recomendación del leader: reutiliza `GOOGLE_MAPS_API_KEY` (ya en producción por la 91), no
necesita service account, ni OAuth2, ni `projectId`, ni habilitar otro SKU. **El humano la descartó
explícitamente en el gate adelantado del 2026-07-19**, a sabiendas del coste de la credencial nueva.
Se documenta aquí porque es la alternativa con mayor impacto descartada, y para que el gate F1.4
pueda revertirla barato si el SKU resulta inasumible (**Q9**): el cambio quedaría contenido en
`lib/clients/` + `lib/config/` + `lib/auth/google-sa-token.ts`; el resto del diseño (persistencia,
debounce, reordenado, gate) es idéntico para ambas APIs. Ese aislamiento es deliberado.

### B. Columna `secuencia_ruta` en `orden` en vez de tablas nuevas — DESCARTADA

Más simple de leer (sin join). Descartada por tres motivos:
1. La secuencia es un atributo de **la ruta de un mensajero en un instante**, no de la orden. Al
   reasignar la orden a otro mensajero, la columna quedaría con una posición que ya no significa
   nada.
2. No hay dónde poner los metadatos que R27/R30 exigen (`calculada_at`, `estado`, `origen_fuente`,
   `ultimo_error`) sin ensuciar `orden` con cinco columnas más de otro dominio — `orden` ya lleva 5
   columnas de la 91.
3. Reemplazar la secuencia sería un `UPDATE` masivo sobre la tabla más caliente del sistema, en vez
   de un `DELETE`+`INSERT` sobre una tabla pequeña y aislada.

### C. Recalcular la ruta síncronamente en cada recogida/gestión — DESCARTADA

Elimina la cola y el debounce. Descartada: mete una llamada de red facturada y de latencia variable
dentro de la transacción crítica del mensajero (`recogerLote`, `crearGestionYTransicionar`), y
recoger 8 paquetes seguidos costaría 8 optimizaciones. Contradice además el pedido explícito de
debounce. (Se conserva **solo** para el botón manual, donde el usuario espera el resultado y es un
acto deliberado — §6.2.)

### D. Añadir `cancel`/`reschedule` a `IJobRepository` para matar el debounce en vuelo — DESCARTADA

Sería la forma "limpia" de evitar la optimización redundante. Descartada: amplía una interfaz
compartida con las features 90 y 91 (ambas en producción) para un caso que la guarda de obsolescencia
(R20) resuelve en el handler, sin migración, sin riesgo de carrera con `claimBatch` y con tests
unitarios sin DB.

### E. Índice `text_pattern_ops` para buscar el job por prefijo — DESCARTADA

Ver §0.2: la clave exacta reconstruida es más barata **y** más correcta.

### F. Guardar el origen en una columna de `usuario` — DESCARTADA

Menos tablas, pero mete un dato de geolocalización de una persona (dato personal sensible, cambia
cada minuto) en la tabla de identidad, que se lee en cada resolución de sesión. En
`ruta_optimizada` vive junto al artefacto que lo usa y desaparece con el `down.sql`.

---

## §10 — Fuera de alcance (confirmado con el briefing)

Mapas embebidos o visualización de la ruta; optimización multi-vehículo o reparto entre mensajeros;
ventanas horarias; backfill de rutas históricas; orden de las cards de "Por recoger"; purga de
`jobs`; coordenadas de bodega/zona.

## §11 — Seguimientos anotados

1. **Purga de `jobs`** (heredado de la 91 §9.2): con un segundo tipo por evento el crecimiento se
   acelera. → **Q8**.
2. **Coordenadas de bodega/zona** como origen real de la ruta cuando no hay GPS. → **Q4**.
3. **Reversión a Routes API** si el SKU resulta inasumible: contenida en tres archivos (§9.A).
