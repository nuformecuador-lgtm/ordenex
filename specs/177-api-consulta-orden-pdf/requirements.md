# Feature 177 — API: consulta de orden por guía o remisión y generación del PDF por orden y por carga

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en `tasks.md`
(tabla `R<n>→test`, `docs/specs.md` §Trazabilidad). Sin detalles de implementación: el
CÓMO vive en `design.md`.

**Alcance:** backend puro, canal integrador por API key (`Authorization: Bearer ordx_...`).
Tres endpoints NUEVOS bajo el prefijo `/api/ordenes/api-key/`:

1. **Consulta** del detalle de UNA orden propia por un identificador libre, resuelto contra
   `num_guia` **y** `num_remision`, con precedencia de `num_guia`.
2. **Generación/obtención** del PDF de etiqueta de ESA orden (`POST .../{id}/generate`),
   con reuso del objeto ya subido a Storage y URL firmada de 5 minutos.
3. **Gemelo por carga**: mismo contrato sobre el PDF **consolidado** del lote, identificado por
   el uuid de la carga.

Entra además en el alcance publicar `cargaId` en el `CargaResponse` del OpenAPI (R45), porque
la ruta del punto 3 lo exige y hoy el contrato no lo documenta.

**Fuera de alcance (declarado):** modificar el endpoint publicado `/api/ordenes/api-key/{numGuia}`
(feature 106); purgar PDFs antiguos (feature 178); rate-limiting; descarga proxy del binario;
UI; cambiar cómo la feature 141 persiste hoy `download_url` en la carga por API.

## Decisiones YA TOMADAS por el humano (no se reabren)

Previas al spec:

- Ruta **NUEVA**; `/api/ordenes/api-key/{numGuia}` (feature 106) queda **INTACTO**.
- `generatePdf` deja de ser query param: es el **segmento de ruta** `/generate`.
- **TTL** de la URL firmada = **5 minutos**.
- **Reuso**, no regeneración incondicional.

**Decisiones del humano del 2026-08-03** — las cuatro preguntas del spec quedaron resueltas y ya
NO hay preguntas abiertas. Ojo: eso NO es la puerta F1.4. La aprobación del spec sigue
**pendiente**; hasta que llegue, no se escribe código:

- **(a) Desempate guía-vs-remisión: gana `num_guia`.** Precedencia fija: primero se busca por
  `num_guia`; SOLO si no hay coincidencia se prueba `num_remision`. **No** se responde 409.
  Ver el §Riesgo declarado (a) más abajo.
- **(b) Verbo de `/generate`: solo `POST`.** Sin `GET`, ni siquiera adicional.
- **(c) Ruta por carga por uuid:** `POST /api/ordenes/api-key/carga/{cargaId}/generate`.
  Publicar `cargaId` en el schema `CargaResponse` del OpenAPI **entra en el alcance** de esta
  feature.
- **(d) Sin modo forzar-regeneración:** el reuso es siempre; no existe flag `force`.

## Riesgo declarado (a) — precedencia de `num_guia`

**Verificado:** `num_guia` y `num_remision` son `@unique` cada una por separado
(`db/schema.prisma:480-481`) y **no existe restricción cruzada** entre ellas. Con la
precedencia decidida, una orden propia cuyo `num_remision` coincide con el `num_guia` de OTRA
orden propia **queda inalcanzable por esa ruta**: toda petición con ese identificador devuelve
siempre la orden de la guía, y el integrador **no recibe ninguna señal** de que existía una
segunda coincidencia. Consecuencia práctica: `/generate` sobre ese identificador produce el PDF
de la orden de la guía, nunca el de la orden de la remisión. Riesgo asumido conscientemente por
el humano; la salida para el integrador es el endpoint de la 106, que es inequívocamente por
guía, o consultar por un identificador no ambiguo. Queda fijado por R14/R15, con un test
**discriminante** (ambas columnas casan a la vez y se comprueba CUÁL orden vuelve).

## Terreno verificado contra el código (no supuesto)

- `db/schema.prisma:480-481` — `Orden.numGuia Int? @unique @map("num_guia")` y
  `Orden.numRemision String @unique @map("num_remision")`. **Ambas son UNIQUE globales por
  separado; NO existe unicidad cruzada entre ellas** (origen del riesgo declarado (a)).
- `db/schema.prisma:597` — `Carga @@unique([usuarioCarga, name])`: el `name` del lote es único
  **por usuario, no globalmente**, y además es nullable; por eso el identificador de carga es
  el uuid `Carga.id` (decisión (c)), que ya viaja en la respuesta de la carga por API key.
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

**R14.** SI `{id}` coincide con el `num_guia` de una orden propia, ENTONCES el sistema DEBE
resolver a ESA orden, INCLUSO cuando exista otra orden propia distinta cuyo `num_remision`
también coincida con `{id}`: la coincidencia por `num_guia` tiene precedencia absoluta, la
coincidencia por `num_remision` se descarta, y la respuesta NO lleva ninguna señal de que
existía una segunda coincidencia (decisión (a); ver §Riesgo declarado (a)).

**R15.** SI ninguna orden propia tiene ese `num_guia` —porque `{id}` no es entero positivo o
porque ninguna guía coincide—, ENTONCES el sistema DEBE resolver `{id}` contra `num_remision`.
Por R14 y R15 la resolución produce siempre a lo sumo UNA orden, de modo que el sistema NO DEBE
responder nunca `409 CONFLICT` por coincidencia múltiple entre columnas.

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
Bloque B (R6-R15), incluidos los mismos `404`, los mismos `422` y la MISMA precedencia de
`num_guia` sobre `num_remision`.

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

**R44.** Los dos endpoints `/generate` (por orden y por carga) DEBEN responder ÚNICAMENTE al
verbo `POST` (decisión (b)); una petición `GET`, `PUT`, `PATCH` o `DELETE` a esas rutas NO DEBE
generar, reutilizar ni firmar ningún PDF.

**R45.** El schema `CargaResponse` publicado en `lib/api/openapi-spec.ts` y en
`docs/api/api-key-openapi.yaml` DEBE incluir el campo `cargaId` que la carga por API key ya
devuelve, para que el integrador sepa de dónde obtiene el `{cargaId}` que exige el endpoint por
carga (decisión (c)).

---

## Notas declaradas (no son preguntas)

**Acoplamiento con la feature 178.** La feature 178 (purga semanal) declara hoy que deja a NULL
`carga.download_url` y `orden.download_url`. Con esta feature el "existe el PDF" pasa a leerse
de la **referencia nueva** (R37): si la 178 no la pone también a NULL al borrar el objeto,
`/generate` devolverá URLs firmadas de objetos ya inexistentes. Se declara aquí para que entre
en el spec de la 178.

**Sin refresco de layout (decisión (d)).** Al no existir modo forzar-regeneración, un cambio
futuro del layout de la etiqueta (como el que hizo la feature 150 con el tamaño de hoja) NO es
refrescable por API: los PDFs ya generados conservan el layout viejo indefinidamente. La única
salida es purgar el objeto y su referencia (feature 178) para que la siguiente llamada
regenere. Consecuencia asumida.
