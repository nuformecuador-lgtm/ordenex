# Ficha 436 — diseño técnico

Traduce `progress/design_sf001_p4_asistente.md` a decisiones de código. **No lo rediseña**: donde el
código lo desmiente está dicho en `requirements.md` (H1–H4) y aquí se toma la vía que el código
permite.

Regla que gobierna todo el documento: **la pieza entera se verifica sin red y sin gastar un céntimo**.
Cada decisión de abajo se eligió, entre otras cosas, por si se podía probar contra un doble.

---

## 0. Mapa de archivos

| Archivo | Qué es |
| --- | --- |
| `lib/interfaces/external/IAsistenteProvider.ts` | **El puerto.** Neutral: sin Next, sin Prisma, sin `process.env`. Molde: `IRoutesClient` |
| `lib/clients/anthropic-asistente.ts` | **El adaptador de producción.** `fetch` y credencial **inyectables**. Molde: `lib/clients/google-routes.ts:143-155` |
| `tests/unit/asistente/_doble-proveedor.ts` | **El doble.** Captura la petición y emite trozos guionizados |
| `lib/asistente/contexto.ts` | Puro: catálogo + rol → bloques de documentación con su `cache_control` |
| `lib/asistente/instrucciones.ts` | Puro: el texto de sistema (los cuatro límites, el formato de cita) |
| `lib/asistente/citas.ts` | Puro: marcador → enlace, **validando contra el conjunto entregado** |
| `lib/asistente/protocolo.ts` | Puro: los tipos del stream y su serialización NDJSON |
| `lib/config/asistente.ts` | Credencial, modelo, tope, timeout. Molde: `lib/config/geocode.ts` |
| `lib/services/AsistenteService.ts` + su interfaz | Orquesta: rol → contexto → tope → proveedor → trozos |
| `lib/repositories/AsistenteUsoRepository.ts` + su interfaz | El contador del tope. **Único acceso a datos de la ficha** |
| `app/api/asistente/route.ts` | El borde HTTP: sesión, zod, streaming |
| `components/shared/AsistentePanel.tsx` | El panel lateral (cliente) |
| `db/migrations/<ts>_asistente_uso_diario/` | `migration.sql` + `down.sql` |

---

## 1. El puerto y el adaptador

### 1.1 El puerto (`IAsistenteProvider`)

Contrato **neutral**, con el mismo estilo de desenlace-unión que `IRoutesClient`: nada lanza salvo lo
que el llamador debe distinguir.

```ts
export interface DocumentoContexto {
  slug: string;        // `oficina/wallet-caja` — es la identidad Y la URL
  titulo: string;
  cuerpo: string;      // Markdown SIN frontmatter (R2: el catálogo ya lo quitó)
}

export interface MensajeAsistente {
  autor: "usuario" | "asistente";
  texto: string;
  imagenes?: readonly ImagenAdjunta[];   // sólo en mensajes del usuario (D12)
}

export interface ImagenAdjunta { medio: string; datosBase64: string; }

export interface ConsultaAsistente {
  instrucciones: string;
  documentos: readonly DocumentoContexto[];   // YA acotados por rol (R9)
  mensajes: readonly MensajeAsistente[];      // la conversación, que vive en el cliente (D10)
}

export type TrozoProveedor =
  | { tipo: "texto"; texto: string }
  | { tipo: "fin"; tokensEntrada: number; tokensSalida: number; tokensCacheLectura: number };

export type RespuestaAsistente =
  | { status: "ok"; trozos: AsyncIterable<TrozoProveedor> }
  | { status: "sin_credencial" }
  | { status: "transitorio"; detalle: string }
  | { status: "config_invalida"; detalle: string };

export interface IAsistenteProvider {
  responder(consulta: ConsultaAsistente): Promise<RespuestaAsistente>;
}
```

**Por qué `AsyncIterable` y no un callback:** el borde necesita poder cortar (el usuario cierra el
panel) y un iterador se cancela solo al salir del `for await`. Y un doble de test es doce líneas.

**`sin_credencial` es un desenlace, no una excepción** (R20). Es el mismo criterio que
`lib/config/geocode.ts:1-6`: la ausencia de credencial no tumba nada, la decide quien llama.

### 1.2 El adaptador

`AnthropicAsistenteClient` recibe por constructor `{ apiKey, modelo, fetchImpl?, timeoutMs? }`. Tres
invariantes copiadas de `google-routes.ts:9-18`:

1. **`fetch` inyectable** → los tests no tocan la red.
2. **Validación en el borde** de la respuesta del proveedor (el stream se lee como SSE y cada evento
   se valida antes de convertirse en `TrozoProveedor`).
3. **Ningún mensaje de error cita credencial ni URL** (R21). El `detalle` que viaja hacia arriba es
   `"asistente: HTTP 429"`, nunca el cuerpo del proveedor.

Forma de la petición (D3/D4/D7/D9), escrita aquí porque es lo que el test de R4/R6 afirma:

```jsonc
{
  "model": "claude-sonnet-5",
  "max_tokens": 1024,
  "stream": true,
  "system": [
    { "type": "text", "text": "<instrucciones>" },
    { "type": "text", "text": "<doc 1>" },
    // … un bloque por documento, en orden estable (slug ascendente) …
    { "type": "text", "text": "<doc N>", "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [ /* la conversación del cliente */ ]
  // SIN "tools"  (R4)   ·   SIN "thinking"  (D7)
}
```

**El `cache_control` va en el ÚLTIMO bloque de documentación y en ninguno más** (R6): marca el final
del prefijo cacheable. El orden por slug no es estético: un orden inestable produce un prefijo
distinto en cada consulta y la caché deja de acertar.

**Un prefijo por rol, cinco en total** (lo dice el diseño aprobado). Sale gratis: el prefijo se
refresca con el uso y se cobra por lo que se lee.

---

## 2. El borde HTTP

### 2.1 Ruta

`POST /api/asistente` — Route Handler, **runtime Node por defecto**. El streaming **no exige**
`edge`, y `edge` sí habría exigido renunciar a `fs` (el catálogo) y a Prisma (el contador): con
`edge` esta ficha no se puede construir.

**No hace falta tocar `middleware.ts`.** `/api/asistente` no está en `PUBLIC_ROUTES` ni en
`SELF_AUTH_ROUTES` (`middleware.ts:11-34`), así que cae en el camino por defecto: sesión validada
contra la base y, al ser ruta de API, rechazo **401 con JSON** en vez de redirect
(`middleware.ts:103-107`). R12 sale de infraestructura que ya existe; lo que se añade es el control
que lo **exige** en la guardia.

**Por qué Route Handler y no Server Action:** `docs/architecture.md:113-119` manda Server Action para
mutaciones internas, pero una Server Action **no puede devolver un stream incremental**. R19 es un
requisito de producto (el diseño: «una pantalla quieta»), y es lo que decide la vía.

### 2.2 Contrato de entrada

```ts
const cuerpoSchema = z.object({
  mensajes: z.array(z.object({
    autor: z.enum(["usuario", "asistente"]),
    texto: z.string().trim().min(1).max(4000),
    imagenes: z.array(z.object({
      medio: z.enum(["image/png", "image/jpeg", "image/webp"]),
      datosBase64: z.string().max(IMAGEN_MAX_BASE64),
    })).max(IMAGEN_MAX_POR_MENSAJE).optional(),
  })).min(1).max(MENSAJES_MAX),
  rutaActual: z.string().startsWith("/").max(200).optional(),
}).strict();
```

**`.strict()` es la mitad de R8.** Un cuerpo con `rol`, `slugs` o `consultasHoy` **no se ignora en
silencio: se rechaza con 422**, que es más ruidoso y más fácil de probar. La otra mitad es que en el
handler no existe ninguna lectura de esos nombres.

`rutaActual` se admite **sólo** para R27, y su único efecto es señalar cuál de los documentos **que
esa persona ya puede leer** es el de partida. No amplía el conjunto: se cruza contra el contexto ya
acotado, y si no casa, se ignora. Un `rutaActual` mentiroso no abre ninguna puerta.

### 2.3 Contrato de salida — NDJSON

`content-type: application/x-ndjson`. Una línea JSON por evento:

```jsonc
{"tipo":"inicio","documentos":[{"slug":"mensajero/reparto","titulo":"Reparto"}, …]}
{"tipo":"texto","texto":"Para cerrar el día…"}
{"tipo":"texto","texto":" tenés que…"}
{"tipo":"fin"}
```

y, en su lugar, ante un fallo ya empezado el stream:

```jsonc
{"tipo":"error","code":"INTERNAL","message":"No se pudo consultar al asistente."}
```

Los rechazos que ocurren **antes** de empezar a emitir (sin sesión, rol no admitido, validación, tope
alcanzado, sin credencial) salen como respuesta normal con el `AppErrorShape` de la feature 10
(`lib/errors/http.ts`), no como línea de stream.

**El `inicio` lleva los documentos del contexto** porque el cliente necesita ese conjunto para
validar las citas (R24). No filtra nada: es exactamente lo que esa persona ya puede leer en `/ayuda`,
y es el mismo criterio con el que la 433 baja el mapa del «?» al cliente
(`providers/AyudaProvider.tsx:15-18`).

**Por qué NDJSON y no `text/event-stream`:** SSE está pensado para `EventSource`, que **sólo hace
GET** y no admite cuerpo ni imágenes; habría que usar `fetch` igualmente y quedarse con el
framing de SSE sin ninguna de sus ventajas. NDJSON se lee con `response.body.getReader()` y se parte
por `\n`, y un test lo reconstruye sin ninguna dependencia.

### 2.4 Códigos

| Caso | Código | HTTP |
| --- | --- | --- |
| Sin sesión | `UNAUTHORIZED` | 401 (lo emite el middleware) |
| `apiKey` o rol fuera de `ROLES_AYUDA` | `FORBIDDEN` | 403 |
| Cuerpo inválido o con claves de más | `VALIDATION_ERROR` | 422 |
| **Tope diario alcanzado** | `CONFLICT` | 409 |
| Sin credencial / proveedor caído | `INTERNAL` | 500 con mensaje propio |

**Alternativa descartada: añadir `RATE_LIMITED` (429) a `lib/errors/codes.ts`.** Es lo semánticamente
correcto y aun así se descarta: ese archivo es un contrato transversal —seis códigos, consumido por
las 24 rutas de `app/api` y por los `status` de dominio de los servicios
(`lib/errors/codes.ts:36-42`)— y ampliarlo por una sola ficha obliga a tocar `HTTP_STATUS_BY_CODE`,
`MSG` y el puente de dominio, y a revisar cada `switch` exhaustivo que hoy cierra sobre seis valores.
Es un cambio de cimientos por un matiz de código HTTP. `CONFLICT` dice la verdad —«la operación entra
en conflicto con el estado actual», y el estado es «ya usaste tus consultas de hoy»— y el usuario no
lee números: lee el mensaje, que sí es específico (R15). Si mañana hay un segundo consumidor de
«demasiadas peticiones», entonces sí vale la pena tocar el catálogo.

---

## 3. El acotamiento por rol

**Una sola línea, y es la razón de ser de la ficha.** El servicio no recibe documentos: recibe el
catálogo y el rol, y aplica **el mismo predicado que decide el gate de `/ayuda/<slug>`**.

```ts
// lib/asistente/contexto.ts
export function contextoPara(docs: readonly DocumentoAyuda[], rol: RolValue | null): DocumentoContexto[]
```

Tres cosas que no son adorno:

1. **El predicado se IMPORTA, no se reimplementa.** Es el hallazgo m3 de la revisión de la 433: la
   guardia `ayuda-pantalla-ruta-existe.guardia.test.ts` reimplementaba la regla y por eso «no se
   enteraría» de un cambio del predicado (`feature_list.json`, ficha 435). Aquí el mismo error sería
   peor: el módulo de ayuda cerraría la puerta y el asistente la dejaría abierta. El test de R9 lo
   ancla comparando contra el predicado importado, no contra una lista de slugs.
2. **Cuál de los dos predicados** — hoy sólo existe `documentoVisiblePara`; la 435 añade el de
   lectura. R9 está redactado por función-rol («el que decide el gate de `/ayuda/<slug>`») y no por
   nombre, precisamente para que el significado no se mueva bajo el spec. Propuesta y motivo en
   **Q1** de `requirements.md`.
3. **Aquí no hay empate que resolver.** Lo que preocupa a la 435 —que el maestro tenga dos candidatos
   para `/ordenes` y gane uno por orden alfabético— es un problema de `mapaRutaDocumento`, que elige
   **uno**. El asistente recibe un **conjunto**: los dos documentos de `/ordenes` entran los dos y el
   modelo tiene delante ambas explicaciones. R27 (el documento de partida) sí elige uno, y para eso
   usa el mismo mapa acotado de la 433, con su desempate ya decidido.

**Lo que esto impide, dicho con nombre:** un mensajero pregunta «¿cómo funciona la caja?» y en su
petición **no viaja ni una línea** de `oficina/wallet-caja.md`, `oficina/cierres.md` ni
`oficina/configuracion-tarifas.md`. R11 lo mide buscando los títulos de los **18** documentos de
`docs/ayuda/oficina/` en el texto que se manda y exigiendo cero.

---

## 4. El tope de gasto — modelo de datos

### 4.1 La tabla

`asistente_uso_diario` — **una fila por usuario y día**.

| columna | tipo | nota |
| --- | --- | --- |
| `id` | TEXT PK | patrón del repo |
| `usuario_id` | TEXT NOT NULL | FK → `usuario(id)` **ON DELETE CASCADE**: el conteo de una persona borrada no significa nada |
| `fecha` | DATE NOT NULL | **fecha calendario de Costa Rica** a medianoche UTC, convención del repo (`lib/utils/fecha-cr.ts:47`, `fechaCalendarioCR`) |
| `consultas` | INTEGER NOT NULL DEFAULT 0 | |
| `created_at` / `updated_at` | TIMESTAMP(3) | |

- `CREATE UNIQUE INDEX asistente_uso_diario_usuario_fecha_key ON (usuario_id, fecha)` — **este índice
  ES la atomicidad de R17**: el incremento es un `upsert` (`INSERT … ON CONFLICT DO UPDATE SET
  consultas = consultas + 1`), así que dos peticiones simultáneas chocan contra la **base** y no
  contra un `if` del código. Mismo argumento que `ranking_snapshot_dia_fecha_key`
  (`db/migrations/20260811120000_ranking_snapshot/migration.sql:57-61`).
- `CHECK (consultas >= 0)`.
- `COMMENT ON TABLE/COLUMN` con la semántica que los tipos no dicen (patrón `analytics_daily` /
  `ranking_snapshot`).
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` **sin policies**, patrón `ranking_snapshot`
  (`migration.sql:184-189`): este repo no usa Supabase Auth, el recorte lo aplica el servidor y aquí
  no se accede nunca desde el cliente.
- `down.sql`: `DROP TABLE`. Aditiva pura, sin backfill, sin tocar ningún objeto preexistente.

**Lo que esta tabla NO guarda, y es deliberado:** ni la pregunta, ni la respuesta, ni la imagen, ni
el `slug` consultado. Es un **contador** (R30). La guardia de R30 falla si alguien le añade una
columna de texto libre.

### 4.2 La lectura y la escritura

`AsistenteUsoRepository.consumirUnaConsulta(usuarioId, fecha, tope)`:

- hace el `upsert` con incremento **y devuelve el valor resultante**;
- si el resultante **supera** el tope, el servicio rechaza (R15) — y como el incremento ya ocurrió,
  la consulta rechazada **no** llama al proveedor y **no** cuenta doble en el siguiente intento.

**Orden deliberado: se cuenta ANTES de llamar al proveedor.** Al revés (llamar y luego contar) una
ráfaga simultánea se cuela entera antes de que nadie haya contado nada, que es exactamente lo que un
tope existe para impedir. El coste aceptado: una consulta que el proveedor no llega a atender (caída,
timeout) **gasta cupo**. Con el número de Q2 (30/día) eso es ruido; escribirlo aquí es para que no se
descubra como sorpresa.

### 4.3 La configuración

`lib/config/asistente.ts`, clon estructural de `lib/config/geocode.ts` (ausente/vacío → `null`,
**nunca lanza**):

| variable | default | qué es |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `null` | la credencial. `null` ⇒ desenlace `sin_credencial` (R20) |
| `ASISTENTE_MODELO` | `claude-sonnet-5` | D7 |
| `ASISTENTE_MAX_CONSULTAS_DIA` | `30` | **pendiente de Q2** |
| `ASISTENTE_TIMEOUT_MS` | `60_000` | más alto que el de geocode: una respuesta larga streameada tarda |

Entran en `.env.example` con su comentario. **Tocar `.env.example` hace que el gate rápido se niegue**
(`docs/verification.md:79`) — pero esta ficha ya lleva migración, así que no cambia nada.

---

## 5. Imágenes y el aviso de datos

- **Formatos:** `image/png`, `image/jpeg`, `image/webp`. Lista blanca; nada de `image/*`.
- **Tamaño:** se reutiliza el tope de **5 MB** que ya rige para la evidencia de gestión
  (`next.config.ts:66-76` lo fija para Server Actions por `GESTION_MAX_FILE_BYTES`). Aquí la vía es un
  Route Handler, cuyo límite de cuerpo en Vercel es ~4,5 MB, así que el tope **efectivo** se fija por
  debajo y el cliente comprime antes de enviar, igual que hace `GestionarOrdenPanel`. Pendiente de Q6.
- **Audio: no se ofrece.** No es «no implementado»: no hay control de grabación ni `accept` que lo
  admita (R29). El diseño lo dice con todas las letras: el modelo que responde no transcribe voz.
- **El aviso (R28)** va **dentro del panel y siempre visible**, no en un desplegable ni en un
  documento. Texto propuesto, en el idioma del usuario y sin siglas:

  > *Lo que escribas y las imágenes que adjuntes se envían a un servicio externo para poder
  > responderte. No compartas datos de un cliente si no hace falta.*

  Se afirma por su literal en el test, como los rótulos de la 431 (`tasks.md` T16 de aquella ficha):
  un aviso que nadie ancla se «mejora» hasta desaparecer.

---

## 6. Dónde vive: el panel

`AsistentePanel.tsx`, cliente, montado **una sola vez** desde `app/(app)/layout.tsx` —igual que
`PushReactivacion` y `RevisionSinpeBodega`, y por la misma razón escrita allí
(`app/(app)/layout.tsx:137-158`): el layout no se pinta sin sesión y persiste entre navegaciones. Es
**hermano** de `{children}`, jamás envolviéndolo: un envoltorio podría dejar de pintar la página con
un `return null`, y un hermano no tiene dónde hacerlo. Eso es lo que hace R22 estructural.

El estado «abierto/cerrado» y la conversación viven en un contexto cliente
(`providers/AsistenteProvider.tsx`), que es también lo que hace que **la conversación desaparezca al
recargar** (R30, D10).

**El control de apertura (Q3).** Propuesta: el «?» del encabezado pasa a abrir el panel, y el panel
lleva como primera acción visible **«Leer la ayuda de esta pantalla»** apuntando a `/ayuda/<slug>`.
Así no se pierde nada de la 433 y se gana el asistente en el mismo gesto. Coste medido: seis
aserciones de `tests/components/AyudaBoton.test.tsx` pasan de afirmar un `href` a afirmar que el
control abre el panel **con ese slug como contexto**, y `tests/components/PageHeader.test.tsx:101`
cambia de buscar un enlace a buscar el control. **No se toca `AyudaProvider`**: el mapa ruta→slug
sigue siendo el mismo dato y el mismo acotamiento.

**Lo que `/design` tiene que resolver** (T7), porque es superficie nueva:

1. Qué pasa en el par medido de **Q4** (`/configuracion/sinpe` + `adminSatelite`, hoy sin «?»).
2. **La colisión en el módulo del mensajero**: ahí ya vive un chat flotante
   (`app/(app)/mis-asignaciones/_components/chat/ChatFlotante.tsx`) y el layout ya reserva `pb-12`
   por él (`app/(app)/layout.tsx:113-115`). Dos burbujas en la misma esquina, en un teléfono, es una
   pantalla peor que la de ahora.
3. El panel a 390 px, que es donde trabajan 18 de los 37 usuarios.

---

## 7. `outputFileTracingIncludes` — la trampa, medida

El diseño aprobado pide **añadir la ruta del asistente** a esa lista. **No hay nada que añadir**: la
clave declarada es `"/**"` (`next.config.ts:59-61`), que cubre todas las páginas y rutas, y la
guardia de la 433 **exige** que siga siéndolo
(`tests/unit/guards/ayuda-md-viajan-a-produccion.guardia.test.ts:83-90`: *«acotar la clave deja sin
.md al layout del portal»*). Acotarla para nombrar la ruta nueva **rompería** esa guardia.

Lo que sí falta, y es donde el riesgo vive de verdad: **hoy nada mide que la ruta del asistente lea
el catálogo**. Si mañana alguien le pone una fuente distinta, la guardia sigue verde y el asistente
diría «no lo sé» a todo en producción con la suite en verde. Por eso R31 amplía esa guardia con un
caso que ata las dos puntas: la ruta del asistente existe, **su única vía de documentación es
`lib/ayuda/catalogo.ts`**, y la clave sigue siendo `/**`.

Y por eso T25 es **puerta de despliegue**: la única prueba de verdad de que los `.md` viajan es
preguntar algo en el entorno desplegado y ver que **cita un documento**.

---

## 8. Alternativas descartadas

### 8.1 RAG (búsqueda de fragmentos) — descartado por el diseño, con medida

Es lo que proponía el documento firmado. El diseño aprobado ya lo midió: **33 documentos ≈ 21.000
tokens**, caben enteros y cacheados (≈ $0,004/consulta contra ≈ $0,012 de RAG), y el modo de fallo de
RAG —«el buscador trae el fragmento equivocado y el asistente responde mal con total seguridad»— es
peor que el problema que resuelve. Se reproduce aquí para que no se reabra.

### 8.2 El contador del tope en memoria del proceso — **descartado**

Sería lo que evita la migración, y por eso se consideró en serio. Se descarta porque **en Vercel no
funciona**: cada función tiene su propio proceso y los arranques en frío son la norma, así que un
contador en memoria cuenta «las consultas de esta instancia desde que arrancó». Un tope que no se
puede afirmar no es un tope, y además **no sería verificable**: un test de R17 sobre un `Map` afirma
sobre el `Map`, no sobre el sistema —exactamente la familia de la aserción-contra-su-propia-fuente—.
El precio de la vía elegida se dice entero: **una migración, y con ella el gate rápido negado**
(`docs/verification.md:75`) y una tabla más en el esquema.

### 8.3 Un almacén de clave-valor (Redis/KV) para el contador — descartado

Resuelve lo de 8.2 sin migración, pero **añade un proveedor, una credencial y un entorno más que
configurar por separado en `preview` y `production`** — justo el paso donde este repo ya se equivocó
una vez con la base de datos. Y contradice D13: una pieza que sólo se puede probar de verdad contra
una infraestructura que no existe todavía. Postgres ya está, ya tiene el patrón de migración up/down,
ya tiene RLS y ya se prueba contra una base real en `tests/integration/db/**`.

### 8.4 Runtime `edge` para la ruta — descartado

Es el reflejo habitual ante «streaming». Pero `edge` **no tiene `fs`** (el catálogo lee los `.md` del
disco, `lib/ayuda/catalogo.ts:1-2`) ni puede abrir la conexión a Postgres que necesita el contador —el
mismo motivo por el que `middleware.ts:115-118` fija `runtime: "nodejs"`—. El streaming en Node
funciona con `ReadableStream` sin ninguna concesión. El diseño aprobado ya lo dice; aquí queda el
porqué técnico.

### 8.5 Persistir la conversación — descartado en la v1 (D10)

Una tabla, una pantalla y una decisión de retención de datos que nadie ha pedido. Su coste real está
dicho en **Q5**: sin ella nadie sabrá qué se pregunta ni cuántas veces el asistente dice «no lo sé».

### 8.6 Generar un módulo `.ts` con los documentos dentro para el asistente — descartado

Evitaría depender de `fs` en la ruta. Es exactamente la vía que la 433 ya descartó, con su motivo
escrito en `lib/ayuda/catalogo.ts:15-26`: el texto pasaría a vivir en dos sitios y se
desincronizaría en cuanto alguien editara un `.md` sin correr el script, **sin que nada se pusiera
rojo**. Además el asistente heredaría un corpus distinto del que el usuario lee en `/ayuda`, que es
la peor forma posible de que este sistema mienta.

---

## 9. Integraciones y secretos

- **Proveedor:** API de Anthropic, `claude-sonnet-5`, streaming. Única integración nueva.
- **Credencial:** `ANTHROPIC_API_KEY`. **No existe todavía** (Q7). Nada de la implementación depende
  de ella: el doble cubre la suite entera. Va a Vercel en `preview` y `production` **por separado**.
- **Datos que salen de casa:** el texto que escribe el usuario y las imágenes que adjunta.
  Autorizado por el humano; el aviso es R28, y **está en la pantalla**, no en un documento.
- **Datos que NO salen:** ninguna fila de la base. El contexto son archivos del repositorio (R1/R3).
