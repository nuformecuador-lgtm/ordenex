# Feature 121 — Design

> Decisiones técnicas de la ubicación compartida en el chat de WhatsApp. Extiende la feature
> 120/109 (chat mensajero↔cliente). Todo lo que aquí no se redefine, se hereda de la 120 sin
> cambios (verificación de firma HMAC del webhook, scope por mensajero, ventana de 24 h,
> refresco por polling SWR). Referencias de reúso verificadas por el leader entre corchetes.

## 0. Principio rector

Esta feature es una **extensión aditiva** sobre superficies existentes: un nuevo valor de
enum, dos columnas nullable, un ramal más en el normalizador del webhook, un campo más en el
contrato, y una burbuja + modal nuevos en el panel. NO se crean tablas, ni servicios, ni
endpoints nuevos. Regla anti-sobre-ingeniería de `architecture.md` §"sin sobre-ingeniería".

---

## 1. Modelo de datos y migración

### 1.1 Cambios de esquema (`db/schema.prisma`)

- **Enum `ChatMensajeTipo`** (`@@map("chat_mensaje_tipo")`, hoy `texto | plantilla | otro`):
  añadir el valor **`ubicacion`**. [schema.prisma ~L201]
- **Modelo `ChatMensaje`** (`@@map("chat_mensaje")`): añadir dos columnas nullable
  **`latitud`** y **`longitud`** de tipo `Float?` (`@map("latitud")` / `@map("longitud")`).
  Nullable porque solo los entrantes de tipo `ubicacion` con coordenadas válidas las traen;
  todo el resto queda `NULL`. [schema.prisma ~L250]

### 1.2 Migración SQL (`db/migrations/<ts>_chat_mensaje_ubicacion/`)

Dos efectos, con la restricción de Postgres sobre enums (precedente feature 106
`cancelacion_api` [20260722130000_cancelacion_api_por_key]):

- **`migration.sql` (UP):**
  - `ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'ubicacion';`
  - `ALTER TABLE "chat_mensaje" ADD COLUMN "latitud" DOUBLE PRECISION;`
  - `ALTER TABLE "chat_mensaje" ADD COLUMN "longitud" DOUBLE PRECISION;`
  - **GOTCHA (documentado en el .sql):** Postgres NO permite USAR un valor de enum recién
    añadido en la MISMA transacción que lo añadió (error 55P04). Prisma Migrate corre cada
    `migration.sql` en una transacción. Como el `ADD VALUE` y los `ADD COLUMN` no USAN el
    valor `ubicacion` (solo lo declaran), pueden ir en la misma migración; su primer USO
    ocurre en transacciones posteriores (los inserts del webhook en runtime). Mismo precedente
    que la 106. `IF NOT EXISTS` hace el `ADD VALUE` idempotente. Migración ADITIVA: no toca
    RLS (heredada de la 120) ni otras tablas.
- **`down.sql` (DOWN, OBLIGATORIO):**
  - `ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "longitud";`
  - `ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "latitud";`
  - **Enum:** Postgres NO soporta `ALTER TYPE ... DROP VALUE`. El down RECREA el enum sin
    `ubicacion` (rename a `_old` → `CREATE TYPE` con `texto/plantilla/otro` → `ALTER TABLE
    chat_mensaje ALTER COLUMN tipo TYPE ... USING (tipo::text::...)` → `DROP TYPE _old`),
    patrón idéntico al down de la 106 [20260722130000_cancelacion_api_por_key/down.sql].
    **Precondición segura:** ninguna fila con `tipo = 'ubicacion'`; si la hubiera, el `USING`
    falla ruidosamente (comportamiento correcto: no se revierte borrando ubicaciones ya
    recibidas sin intervención explícita). Documentar la precondición en el `.sql`.

---

## 2. Borde tipado del webhook (`lib/types/whatsapp-webhook.ts`)

Punto de entrada de la extensión. Hoy `metaMessageSchema` solo lee `text.body` y
`tipoDeMeta()` manda todo lo no-texto a `"otro"`. Cambios:

- **Schema (a):** añadir al `metaMessageSchema` el campo opcional
  `location: z.object({ latitude: z.number(), longitude: z.number() }).optional()`. El strip
  por defecto de zod descarta `name`/`address` y demás campos extra (R2). Se validan como
  `z.number()`: un `latitude`/`longitude` no numérico hace fallar ESE campo → el `location`
  entero queda inválido → se trata como location sin coordenadas (R3), sin romper el lote.
- **Tipo de dominio (c):** extender `WebhookMensajeEntrante` con un sub-objeto opcional
  `ubicacion?: { latitud: number; longitud: number }` (o dos campos `latitud?/longitud?`; se
  elige el sub-objeto por cohesión: o vienen ambos o ninguno). [whatsapp-webhook.ts L53-61]
- **Normalización (b):** en `parseWebhookEventos`, cuando `m.type === "location"`:
  - si `m.location` tiene `latitude`/`longitude` numéricos → `tipo: "ubicacion"`,
    `cuerpo: null`, `ubicacion: { latitud, longitud }`.
  - si no (location sin coords válidas) → degradar a `tipo: "otro"`, `cuerpo: null`, sin
    `ubicacion` (R3). NO se lanza.
  - `tipoDeMeta` se amplía a un mapeo que reconozca `"location"`; el resto sigue a `"otro"`.
  - **Validación de rango (R3):** lat ∈ [-90, 90], lng ∈ [-180, 180]; fuera de rango =
    degradar a `otro` sin coords. Helper puro (`esCoordenadaValida`), testeable.

---

## 3. Service (`lib/services/ChatWhatsappService.ts`)

`ingerirEventos` propaga las coordenadas al insert del entrante, SIN tocar el dedupe ni el
sellado de `ultimo_entrante_at`:

- En el `insertarEntranteIdempotente({...})` [ChatWhatsappService L125-131] se añaden
  `latitud: mensaje.ubicacion?.latitud ?? null` y `longitud: mensaje.ubicacion?.longitud ??
  null`. Como el tipo `ubicacion` abre ventana igual que un texto, la lógica de
  `marcarUltimoEntrante` solo tras `insertado === true` (R6) queda **intacta**: no hay caso
  especial, un entrante de ubicación es un entrante más. El dedupe por `wa_message_id` (R5)
  sigue siendo el árbitro (índice único parcial de la 120, sin cambios).

No se toca `enviarTexto`/`enviarPlantilla`/`reintentarEnvio`: esta feature no envía
ubicaciones (D2, fuera de alcance).

---

## 4. Repositorio y contrato (`IChatMensajeRepository` + `ChatMensajeRepository`)

- **`InsertarEntranteInput`** [IChatMensajeRepository L22-28]: añadir
  `latitud?: number | null` y `longitud?: number | null`.
- **`ChatMensajeDTO`** [L8-19]: añadir `latitud: number | null` y `longitud: number | null`.
- **`ChatMensajeRepository`** [ChatMensajeRepository.ts]: incluir `latitud`/`longitud` en el
  objeto `SELECT`, en el tipo `Row`, en `toDTO`, y en el `data` de
  `insertarEntranteIdempotente` (los salientes los dejan `null`). `listarHilo` los propaga vía
  `SELECT`/`toDTO` sin cambios adicionales.
- **Vista (`lib/types/chat-whatsapp.ts`)** — `ChatMensajeVista` [L5-14]: añadir
  `latitud: number | null` y `longitud: number | null`. La Server Action `listarHiloChat`
  [chat-whatsapp.ts L211-218] mapea el DTO a la vista propagando ambos campos (R8). Los
  mensajes no-ubicación llegan con `null` (columnas nullable). El scope por mensajero (R16) NO
  se toca: ya lo impone `findByOrdenParaMensajero` / `OrdenEnvioReader`.

---

## 5. Frontend

### 5.1 Burbuja de ubicación (`ChatWhatsappPanel.tsx`, componente `Burbuja`)

- En `Burbuja` [ChatWhatsappPanel.tsx L85-114], cuando `mensaje.tipo === "ubicacion"` y trae
  `latitud`/`longitud`, renderizar un **botón con icono `MapPin`** (lucide-react, ya usado en
  el repo) en lugar del cuerpo de texto vacío. Etiqueta accesible corta ("Ver ubicación
  compartida"), sin volcar las coordenadas al DOM visible (R15/P2). El estado de "modal
  abierto" y qué coordenadas mostrar se maneja con `useState` local del panel (una sola
  ubicación seleccionada a la vez).
- **Autorización:** intacta; la burbuja solo pinta lo que el backend ya autorizó (R16).

### 5.2 Modal + minimapa

- **Dialog de shadcn** (`components/ui/dialog`) para el popup DENTRO de la misma ventana
  (R10/R13). Al abrir, se llama `pedirUbicacion()` de `useUbicacionActual` (R11/D1, lazy por
  P3); su resultado (`Coords | null`) se pasa al minimapa.
- **Minimapa — decisión de reúso (ver §Decisión 1):** se crea un componente propio
  **`UbicacionMapaInner.tsx`** co-ubicado en `mis-asignaciones/_components/`, con su wrapper
  **`UbicacionMapa.tsx`** que aplica `next/dynamic({ ssr: false })` (R14), calcando el patrón
  de `RutaMapa.tsx`/`RutaMapaInner.tsx` [feature 97]. Dibuja EXACTAMENTE 2 marcadores con
  `L.divIcon` (mismo GOTCHA de iconos de la 97): (1) punto del cliente (icono destino), (2)
  GPS del repartidor (icono "tú", omitido si es `null`). Reencuadre a los puntos disponibles
  (`fitBounds` con 2 puntos, `setView` con 1), reusando la lógica de `AjustarEncuadre`.
- **Degradación (R12):** si `pedirUbicacion()` resolvió `null` (denegado/timeout,
  `useUbicacionActual.denegado` para el copy), el minimapa pinta solo el punto del cliente y el
  Dialog muestra un aviso ("No se pudo obtener tu ubicación actual"). Nunca bloquea.

---

## 6. Variables de entorno

Ninguna nueva. El webhook, el envío y el mapa (tiles OSM públicos, feature 97) ya están
configurados. Esta feature no añade secretos.

---

## Decisiones y alternativas descartadas

### Decisión 1 — Minimapa: componente propio co-ubicado vs. generalizar `RutaMapaInner`

**Elegido:** crear `UbicacionMapaInner`/`UbicacionMapa` propios, co-ubicados.
**Descartado:** generalizar `RutaMapaInner` (feature 97) para que sirva a ambos casos.
**Por qué:** `RutaMapaInner` está modelado alrededor de *paradas numeradas de una ruta
optimizada* (secuencia, `Polyline`, orden de recorrido) — semántica que no aplica a "2 puntos
sueltos, sin ruta". Generalizarlo obligaría a añadir modos/flags que ensuciarían un componente
hoy claro, contra `architecture.md` §"sin sobre-ingeniería" (solo se promueve/generaliza
cuando ≥2 usos comparten la MISMA API, y aquí las APIs difieren). Se REUTILIZA en cambio el
**patrón** (wrapper `dynamic ssr:false`, `L.divIcon`, tiles OSM, `fitBounds`) y los tipos
livianos, copiando ~30 líneas de estructura probada. Coste: leve duplicación de andamiaje
Leaflet; beneficio: dos componentes simples y testeables por separado.

### Decisión 2 — Persistir lat/lng en columnas dedicadas vs. JSON

**Elegido:** dos columnas `latitud`/`longitud` (`DOUBLE PRECISION`, nullable) en
`chat_mensaje`.
**Descartado:** una columna `metadata jsonb` que guarde `{ latitude, longitude, name,
address }`.
**Por qué:** el minimapa solo necesita lat/lng (D2 = solo visualizar); dos columnas tipadas
son triviales de mapear en Prisma/DTO/vista, se validan como `number`, y evitan el
sobre-diseño de un blob JSON semiestructurado que invitaría a meter más campos "por si acaso"
(YAGNI). Si una feature futura adopta la ubicación como coordenadas de entrega, estas mismas
columnas sirven. `name`/`address` de Meta se descartan en v1 (P1).

### Decisión 3 — Minimapa Leaflet/OSM vs. imagen estática (Google Static Maps)

**Elegido:** reutilizar el stack Leaflet + tiles OSM de la feature 97.
**Descartado:** Google Static Maps API (una `<img>` con los 2 marcadores).
**Por qué:** Leaflet+OSM ya está integrado, probado y sin coste ni API key adicional; Static
Maps exigiría una credencial nueva, cuota/facturación y romper el principio §4 de
`architecture.md` (sin hardcode de contexto/credenciales) por un beneficio marginal (el mapa
no necesita ser estático). Reutilizar baja el riesgo y el tiempo.

### Decisión 4 — GPS del repartidor EN VIVO (cerrada, D1)

Reafirma D1: la "ubicación actual del repartidor" es el GPS del navegador vía
`useUbicacionActual` (feature 93), capturado al abrir el modal, con degradación no bloqueante
si se deniega/expira. **Descartado:** rastreo server-side de la posición del mensajero — no
existe tal fuente y crearla excede el alcance; además implicaría PII de ubicación persistida,
que esta feature evita (R15).

### Decisión 5 — Solo visualizar (cerrada, D2)

Reafirma D2: v1 NO ofrece "adoptar esta ubicación como coordenadas de entrega de la orden".
**Descartado (diferido):** un botón que escriba lat/lng en la orden — requiere reglas de
autorización, auditoría e impacto en geocodificación/ruteo (features 92/93/97) que merecen su
propia spec.
