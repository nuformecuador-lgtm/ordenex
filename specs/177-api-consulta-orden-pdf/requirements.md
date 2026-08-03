# Feature 177 — API: consulta de orden por guía o remisión y generación del PDF por orden y por carga

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en `tasks.md`
(tabla `R<n>→test`, `docs/specs.md` §Trazabilidad). Sin detalles de implementación: el
CÓMO vive en `design.md`.

**Alcance:** backend puro, canal integrador por API key (`Authorization: Bearer ordx_...`).
Tres endpoints NUEVOS bajo el prefijo `/api/ordenes/api-key/`:

1. **Consulta** del detalle de UNA orden propia por un identificador libre, resuelto contra
   `num_guia` **y** `num_remision`.
2. **Generación/obtención** del PDF de etiqueta de ESA orden (segmento propio `/generate`),
   con reuso del objeto ya subido a Storage y URL firmada de 5 minutos.
3. **Gemelo por carga**: mismo contrato sobre el PDF **consolidado** del lote.

**Fuera de alcance (declarado):** modificar el endpoint publicado `/api/ordenes/api-key/{numGuia}`
(feature 106); purgar PDFs antiguos (feature 178); rate-limiting; descarga proxy del binario;
UI; cambiar cómo la feature 141 persiste hoy `download_url` en la carga por API.

## Decisiones YA TOMADAS por el humano (no se reabren)

- Ruta **NUEVA**; `/api/ordenes/api-key/{numGuia}` (feature 106) queda **INTACTO**.
- `generatePdf` deja de ser query param: es el **segmento de ruta** `/generate`.
- **TTL** de la URL firmada = **5 minutos**.
- **Reuso**, no regeneración incondicional.

## Terreno verificado contra el código (no supuesto)

- `db/schema.prisma:480-481` — `Orden.numGuia Int? @unique @map("num_guia")` y
  `Orden.numRemision String @unique @map("num_remision")`. **Ambas son UNIQUE globales por
  separado; NO existe unicidad cruzada entre ellas** (habilita la pregunta abierta (a)).
- `db/schema.prisma:597` — `Carga @@unique([usuarioCarga, name])`: el `name` del lote es único
  **por usuario, no globalmente**; `Carga.id` es el uuid (habilita la pregunta abierta (c)).
- `db/schema.prisma:516` y `:589` — `orden.download_url` / `carga.download_url` guardan la
  **URL FIRMADA** (`EtiquetasDescargaService.ts:48` y `EtiquetasLotePdfService.ts:78`), que
  caduca. **Ninguna de las dos columnas tiene lector en `app/` ni en `lib/` hoy: son
  write-only** (verificado por búsqueda de `downloadUrl`/`download_url`).
- `middleware.ts:32` — `SELF_AUTH_ROUTES = ["/api/cron", "/api/ordenes/api-key", "/api/webhooks"]`,
  con match por prefijo.
- `lib/api/openapi-spec.ts` publica hoy **4 paths**; `docs/api/api-key-openapi.yaml` es espejo
  textual y hay guards en `tests/unit/api/openapi-contrato-en-reparto.test.ts`.
- `lib/services/ApiKeyAuthService.ts` → `{status:'ok', apiKeyId, actor:{usuarioId, rol}}` |
  `unauthenticated` | `forbidden`.
- `IEtiquetaGuiaService.generarEtiquetas` **NO filtra por owner** ("no filtra por visibilidad
  de la orden", `IEtiquetaGuiaService.ts:38`): el aislamiento por owner lo tiene que imponer
  esta feature ANTES de invocarlo.
- `IFileStorage` (`upload`/`remove`) **no ofrece ninguna operación de existencia**: no hay forma
  barata de preguntarle a Storage "¿este PDF ya está?".
- Errores: `lib/errors` con `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, `INTERNAL`.

---

## Bloque A — Autenticación y aislamiento (transversal a los tres endpoints)

**R1.** CUANDO llega una petición a cualquiera de los tres endpoints nuevos sin header
`Authorization`, o con un esquema distinto de `Bearer`, o con token vacío, el sistema DEBE
responder `401 UNAUTHORIZED` sin consultar órdenes, sin consultar cargas y sin tocar Storage.

**R2.** CUANDO llega una petición con un `Bearer <key>` que no corresponde a ninguna `api_key`
registrada, el sistema DEBE responder `401 UNAUTHORIZED`, indistinguible de "no presentó key".

**R3.** SI la key existe pero su usuario dedicado no está `activo`, o la propia key no está
`activa`, ENTONCES el sistema DEBE responder `403 FORBIDDEN` y NO ejecutar ninguna lectura de
órdenes/cargas, ninguna escritura y ninguna operación de Storage.

**R4.** El sistema DEBE resolver el *owner* de la petición como `actor.usuarioId` devuelto por
la autenticación, y NUNCA aceptar el owner/tienda desde el cuerpo, la query o los headers.

**R5.** El sistema DEBE tratar la API key como secreto: NUNCA la escribe (ni su hash) en
`console.*`, ni en el cuerpo de una respuesta de error, ni en logs.

---

## Bloque B — Resolución del identificador libre `{id}`

**R6.** CUANDO un owner autenticado solicita una orden por `{id}`, el sistema DEBE buscar entre
sus órdenes propias (`tienda_id = actor.usuarioId` **y** `deleted_at IS NULL`) aquellas cuyo
`num_guia` **o** cuyo `num_remision` coincida con `{id}`.

**R7.** El sistema DEBE aplicar el filtro por owner en la capa de REPOSITORIO (el `WHERE` por
`tienda_id`), no solo en el borde HTTP.

**R8.** SI `{id}` no es un entero positivo, ENTONCES el sistema DEBE resolverlo ÚNICAMENTE
contra `num_remision` (nunca contra `num_guia`, que es entero) y NO DEBE fallar por ello.

**R9.** SI `{id}` es un entero positivo, ENTONCES el sistema DEBE evaluar AMBAS columnas
(`num_guia` y `num_remision`) en la misma resolución.

**R10.** El sistema DEBE comparar `{id}` de forma EXACTA contra el valor almacenado: sin
comodines, sin prefijos, sin `LIKE`, sin normalización de mayúsculas/acentos.

**R11.** SI ninguna orden propia coincide con `{id}`, ENTONCES el sistema DEBE responder
`404 NOT_FOUND`.

**R12.** SI existe una orden con ese `num_guia`/`num_remision` pero pertenece a otro owner, o
está borrada (`deleted_at IS NOT NULL`), ENTONCES el sistema DEBE responder EXACTAMENTE el mismo
`404 NOT_FOUND` de R11: no se filtra la existencia de recursos ajenos.

**R13.** SI `{id}` llega vacío, solo con espacios, o excede la cota de longitud del borde,
ENTONCES el sistema DEBE responder `422 VALIDATION_ERROR` con detalle por campo y SIN consultar
la base de datos.

**R14.** *(Sujeto a la pregunta abierta (a); ver §Preguntas abiertas.)* SI `{id}` coincide a la
vez con el `num_guia` de una orden propia y con el `num_remision` de OTRA orden propia distinta,
ENTONCES el sistema DEBE responder `409 CONFLICT` y NO DEBE devolver ni operar sobre ninguna de
las dos.

**R15.** SI `{id}` coincide con el `num_guia` y el `num_remision` de la MISMA orden, ENTONCES el
sistema DEBE tratarlo como una única coincidencia y responder normalmente (no es ambigüedad).

---

## Bloque C — Consulta de detalle (endpoint 1)

**R16.** CUANDO la resolución de `{id}` produce exactamente una orden propia, el sistema DEBE
devolver `200` con el detalle de esa orden con la MISMA forma de datos que el detalle ya
publicado por la feature 106 (mismos campos, incluidas las evidencias de entrega/rechazo
resueltas como URLs firmadas de 5 minutos, y `[]` cuando no hay evidencias).

**R17.** El sistema NO DEBE alterar el endpoint `/api/ordenes/api-key/{numGuia}` de la feature
106: su ruta, su verbo, su contrato de entrada/salida y su comportamiento quedan idénticos.

**R18.** La respuesta de consulta NO DEBE exponer la ruta cruda del objeto en Storage, ni el
nombre del bucket, ni identificadores internos de la orden, ni PII de terceros (p. ej. datos del
mensajero).

---

## Bloque D — Generación/obtención del PDF por ORDEN (endpoint 2, `/generate`)

**R19.** El endpoint `/generate` por orden DEBE resolver `{id}` con las MISMAS reglas del
Bloque B (R6-R15), incluidos los mismos `404`, `422` y el mismo tratamiento de la ambigüedad.

**R20.** CUANDO se invoca `/generate` sobre una orden propia que NO tiene registrada una
referencia persistente a su PDF, el sistema DEBE generar el PDF de la etiqueta de ESA orden,
subirlo al bucket privado de etiquetas y registrar en la orden la **referencia persistente del
objeto** (la ruta dentro del bucket), no una URL.

**R21.** CUANDO se invoca `/generate` sobre una orden propia que YA tiene registrada esa
referencia, el sistema DEBE reutilizar el objeto existente: NO DEBE construir un PDF nuevo, NO
DEBE subir nada a Storage y NO DEBE sobrescribir la referencia.

**R22.** En ambos casos (R20 y R21) el sistema DEBE responder `200` con una URL firmada **emitida
en esa misma llamada**, su TTL en segundos, y un indicador de si el PDF se generó en esta
invocación o se reutilizó uno existente.

**R23.** El sistema NUNCA DEBE devolver una URL firmada leída de la persistencia: toda URL
devuelta se firma en el momento de responder.

**R24.** La URL firmada devuelta DEBE expirar a los **300 segundos** y DEBE firmarse con la
credencial de servidor, nunca desde el cliente.

**R25.** SI la orden resuelta no tiene etiqueta imprimible (p. ej. no tiene `num_guia`
asignado), ENTONCES el sistema DEBE responder `409 CONFLICT`, NO DEBE subir nada a Storage y NO
DEBE registrar ninguna referencia.

**R26.** `/generate` por orden NO DEBE modificar ninguna columna de la orden distinta de la
referencia al objeto: en particular NO toca `download_url`, `estatus_id`, `num_guia`,
`carga_id`, ni escribe en el historial de estados ni dispara webhooks de cambio de estado.

**R27.** MIENTRAS existan invocaciones repetidas de `/generate` sobre la MISMA orden, el sistema
DEBE dejar en Storage un ÚNICO objeto para esa orden: la segunda y sucesivas invocaciones no
suben ningún objeto adicional.

---

## Bloque E — Generación/obtención del PDF CONSOLIDADO por CARGA (endpoint 3, `/generate`)

**R28.** El endpoint por carga DEBE ofrecer el MISMO contrato de respuesta que R22 (URL firmada
recién emitida + TTL + indicador generado/reusado), sobre el PDF **consolidado** del lote.

**R29.** El sistema DEBE considerar propia una carga solo si su `usuario_carga` es
`actor.usuarioId`; SI la carga no existe o pertenece a otro owner, ENTONCES DEBE responder el
mismo `404 NOT_FOUND` (no se filtra la existencia de lotes ajenos).

**R30.** CUANDO se invoca sobre una carga propia SIN referencia persistente registrada, el
sistema DEBE generar UN PDF consolidado con las etiquetas de las órdenes de ese lote, subirlo al
bucket privado y registrar la referencia del objeto en la carga.

**R31.** CUANDO la carga YA tiene referencia registrada, el sistema DEBE reutilizar el objeto y
solo volver a firmarlo, sin construir ni subir un PDF nuevo.

**R32.** El PDF consolidado DEBE incluir únicamente órdenes de ESA carga que pertenecen al owner
y no están borradas.

**R33.** SI ninguna orden de la carga tiene etiqueta imprimible, ENTONCES el sistema DEBE
responder `409 CONFLICT` sin subir nada ni registrar referencia.

**R34.** SI el número de etiquetas del lote supera el tope configurado de etiquetas por PDF
(`etiquetasConfig.MAX_ETIQUETAS_POR_PDF`), ENTONCES el sistema DEBE responder `409 CONFLICT`
ANTES de construir el PDF, sin tocar Storage ni la base de datos.

**R35.** `/generate` por carga NO DEBE modificar ninguna columna de la carga distinta de la
referencia al objeto: en particular NO toca `download_url`, `name`, `total_files` ni las órdenes
del lote.

---

## Bloque F — Persistencia de la referencia al objeto

**R36.** El sistema DEBE persistir la referencia al PDF como la **ruta del objeto dentro del
bucket** (no como una URL), en un campo dedicado de la orden y otro de la carga, DISTINTO de
`download_url`.

**R37.** El sistema DEBE decidir "el PDF ya existe" ÚNICAMENTE por la presencia de esa referencia
persistente, y NUNCA por el contenido de `download_url` (que guarda una URL firmada caducable
escrita por las features 136/141 y por tanto no permite distinguir "el PDF existe" de "la URL
caducó").

**R38.** MIENTRAS una orden o una carga tenga `download_url` no nula y su referencia nueva a NULL
(filas heredadas de las features 136/141), el sistema DEBE tratarla como "sin PDF": la primera
invocación de `/generate` DEBE generar el PDF, poblar la referencia y responder `200`; NO DEBE
fallar, NO DEBE devolver la URL heredada y NO DEBE alterar `download_url`.

**R39.** La migración de esta feature DEBE ser ADITIVA (campos nuevos nullable, sin backfill, sin
borrar ni reinterpretar datos existentes) y DEBE incluir su `down.sql` que la revierte
exactamente (`docs/architecture.md` §Migraciones).

---

## Bloque G — Plataforma y contrato publicado

**R40.** Las tres rutas nuevas DEBEN quedar bajo el prefijo `/api/ordenes/api-key` para que el
middleware las trate como `SELF_AUTH_ROUTE` y NO las redirija a `/login`; una petición sin cookie
de sesión y con Bearer válido DEBE alcanzar el handler.

**R41.** El sistema DEBE publicar los tres endpoints nuevos en `lib/api/openapi-spec.ts`
(pasando de 4 a 7 paths) y DEBE mantener `docs/api/api-key-openapi.yaml` como espejo exacto,
sin romper los guards de contrato existentes.

**R42.** Todas las respuestas de error de los tres endpoints DEBEN usar el shape uniforme del
manejador global (`status`/`code`/`message`) con los códigos existentes
(`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`); NO se
introducen códigos nuevos.

**R43.** El TTL de la URL firmada de estos endpoints DEBE resolverse por configuración (variable
de entorno con default 300 s y cota superior), NUNCA hardcodeado en el servicio ni en el handler
(`docs/architecture.md` §"Sin hardcode de contexto").

---

## Preguntas abiertas (puerta F1.4)

Cada una con la recomendación por defecto del spec_author y su consecuencia. **Ninguna está
resuelta**: si el humano no responde, se implementa la recomendación y así queda documentado.

### (a) Desempate cuando `{id}` casa con el `num_guia` de una orden y el `num_remision` de OTRA

**Dato verificado:** en `db/schema.prisma:480-481` `num_guia` es `@unique` (nullable) y
`num_remision` es `@unique`; cada una es única por separado, pero **no hay ninguna restricción
cruzada**. Nada impide que exista la orden A con `num_guia = 100234` y la orden B con
`num_remision = "100234"`, ambas del mismo owner. Con el filtro por owner + `deleted_at IS NULL`
el número máximo de coincidencias es **2** (una por columna), nunca más.

- **Recomendación:** `409 CONFLICT` con mensaje de ambigüedad, sin devolver ninguna (R14).
- **Consecuencia si se acepta:** el integrador nunca recibe una orden equivocada. El caso solo
  puede darse DENTRO de su propio catálogo (el scope ya está acotado a su owner), es decir
  cuando él mismo usa remisiones numéricas que chocan con sus propias guías; en ese caso el 409
  le dice la verdad y tiene la salida del endpoint de la 106, que es inequívocamente por guía.
- **Alternativa:** precedencia `num_guia` > `num_remision` (o al revés) resolviendo en silencio.
  **Consecuencia:** el 100 % de las llamadas resuelve, pero en el caso ambiguo devuelve
  *silenciosamente* una orden que puede no ser la buscada — y `/generate` generaría el PDF de la
  orden equivocada, que es un error caro e invisible.

### (b) Verbo HTTP de `/generate`

- **Recomendación:** `POST`. Muta la orden/carga (crea el objeto en Storage y escribe la
  referencia), no es seguro ni idempotente en el sentido de GET, y ningún proxy/CDN debe poder
  cachearlo ni pre-fetchearlo.
- **Consecuencia si se acepta:** honestidad semántica; coste: un integrador que quiera "abrir el
  PDF" no puede pegar la URL en el navegador ni en un `<a href>`, necesita cliente HTTP.
- **Alternativa:** `GET` (lo que un integrador esperaría). **Consecuencia:** cualquier crawler,
  prefetch de navegador o reintento automático dispararía una generación de PDF; con el reuso de
  R21 el coste es acotado (solo la primera llamada genera), pero sigue siendo un `GET` que
  escribe en la base.
- **Tercera vía si se quiere lo mejor de ambas:** aceptar `POST` **y** `GET` en el mismo handler.
  Cuesta un test más y no rompe nada; dígalo y lo especifico.

### (c) Forma exacta de la ruta por carga e identificador del lote

**Dato verificado:** `Carga` tiene `@@unique([usuarioCarga, name])` (`schema.prisma:597`) — el
`name` es único **por usuario, NO globalmente**, y además es **nullable** (`name String?`,
`:588`: "NULL = sin nombre"). El `cargaId` (uuid) ya viaja hoy en la respuesta de la carga por
API key (`app/api/ordenes/api-key/carga/route.ts:303` lo usa desde `summary.cargaId`, y el
handler devuelve `...summary`), así que **el integrador ya tiene el uuid en la mano**.

- **Recomendación:** `POST /api/ordenes/api-key/carga/{cargaId}/generate`, con `{cargaId}` = el
  **uuid** de la carga, validado como uuid en el borde.
- **Consecuencia si se acepta:** identificador no ambiguo y ya conocido por el integrador; a
  cambio hay que documentar `cargaId` en el `CargaResponse` del OpenAPI, que **hoy no lo publica**
  (deuda preexistente detectada: `openapi-spec.ts` describe `CargaResponse` sin `cargaId`).
- **Alternativa:** identificar por `name`. **Consecuencia:** el `name` es opcional (una carga sin
  nombre sería inalcanzable) y solo único por usuario, así que la ruta necesitaría además el
  scope del owner para no ser ambigua; funciona, pero deja lotes sin nombre fuera del endpoint.
- **Sub-pregunta:** ¿confirma la forma `/api/ordenes/api-key/carga/{cargaId}/generate`? Nótese
  que `POST /api/ordenes/api-key/carga` ya existe (creación del lote): el endpoint nuevo cuelga
  del mismo segmento sin colisionar.

### (d) ¿Hace falta un modo forzar-regeneración?

- **Recomendación:** **no** en esta feature; el reuso es siempre (R21/R31). El PDF de etiqueta se
  deriva de datos que no cambian tras la asignación de guía, así que regenerar produciría un PDF
  idéntico y un objeto huérfano más en el bucket.
- **Consecuencia si se acepta:** si alguna vez el layout de la etiqueta cambia (p. ej. la feature
  150 cambió el tamaño de hoja), los lotes ya generados conservan el layout viejo y **no hay
  forma de refrescarlos por API**; habría que borrar la referencia a mano en base.
- **Alternativa:** aceptar `?force=true`. **Consecuencia:** una palanca que multiplica objetos en
  el bucket y hay que gobernar (la feature 178 purgará, pero solo lo referenciado por las
  columnas; los huérfanos sobrevivirían). Si se acepta, hay que decidir si el objeto anterior se
  borra (`IFileStorage.remove`) y si eso entra en esta feature.

### (e) Nota, no pregunta: acoplamiento con la feature 178

La feature 178 (purga semanal) declara hoy que deja a NULL `carga.download_url` y
`orden.download_url`. Con esta feature el "existe el PDF" pasa a leerse de la **referencia
nueva** (R37): si la 178 no la pone también a NULL al borrar el objeto, `/generate` devolverá
URLs firmadas de objetos ya inexistentes. Se declara aquí para que quede en el spec de la 178.
