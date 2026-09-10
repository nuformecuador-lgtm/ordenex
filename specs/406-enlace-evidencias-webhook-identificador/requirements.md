# Feature 406 — el enlace de evidencias del webhook apunta a un identificador que el endpoint no sabe resolver

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en la tabla de
trazabilidad de `tasks.md` (`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el CÓMO
vive en `design.md`.

---

## El defecto, confirmado en el archivo real el 2026-09-10

No se re-investigó desde cero: se **confirmó línea a línea en el código**, no en el índice del grafo
(que, para este archivo, devolvía números de línea rancios — `evidenciasUrlDe` en 202-207 cuando
vive en 276-281).

- `lib/services/WebhookEstadoService.ts:276-281` — `evidenciasUrlDe(estado, ordenId)` devuelve
  `` `${origin}${PATH_ORDEN_API_KEY}/${ordenId}` ``, donde `ordenId` es el **uuid** de
  `orden.id` que viene en el payload del job (`payloadSchema`, línea 71-75).
- `lib/services/ApiOrdenResolucionService.ts:48-87` — `resolver` normaliza con un `trim`, calcula
  `candidatoNumGuia` (regex `^[1-9][0-9]*$` acotada a int4) y pide al repositorio filas que casen
  por `num_guia` **o** por `num_remision` en **igualdad exacta**. Un uuid no es ninguno de los dos:
  `filas.length === 0` → `{ status: "not_found" }`.
- `app/api/ordenes/api-key/orden/[id]/route.ts:125` — ese `not_found` se convierte en el **404
  uniforme** del canal.

Resultado: el campo `data.evidenciasUrl` que viaja en los eventos de `incidente` es un enlace que
**siempre** responde 404. El integrador recibe un enlace roto.

**Causa raíz documental (no un descuido de código):** el design de la 268 (§6) eligió la variante
`/orden/{id}` «por `orden.id` y no por `{numGuia}` porque `num_guia` puede ser NULL». La premisa
—que `{id}` acepta el `orden.id`— es falsa: en la 177 `{id}` significa «identificador libre = guía o
remisión», nunca el uuid interno. El comentario de `PATH_ORDEN_API_KEY`
(`WebhookEstadoService.ts:53-54`) repite esa premisa errónea y también hay que corregirlo.

## Por qué no corre prisa, y qué significa eso para el alcance

El enlace **solo** viaja en eventos con `data.estado === "incidente"` (268/R24, implementado en
`evidenciasUrlDe`), y producción tiene **cero** incidentes registrados y **cero** eventos de ese
tipo emitidos (medido, `feature_list.json` ficha 406). Hoy no hay ningún consumidor dañado. Pero se
estrena roto ante el primer incidente real, y el destinatario es un integrador externo (Daniel
Marín, el mismo de la 404/405).

Consecuencia deliberada, y es la regla que gobierna todo este spec: **esto es el arreglo mínimo de
lo evidenciado, no un rediseño.** No se crea ninguna tabla, ningún endpoint, ningún parámetro nuevo,
ninguna migración. Las alternativas que sí implicaban eso están **descartadas y escritas** en
`design.md` §7.

## Alcance

**Dentro:** el identificador con el que se construye `data.evidenciasUrl` en
`WebhookEstadoService`, y el contrato publicado que lo describe y lo ejemplifica (OpenAPI TS +
espejo YAML + CHANGELOG del canal).

**Fuera, declarado:**

- No se toca `ApiOrdenResolucionService` ni ninguna de sus reglas (`num_guia` > `num_remision`,
  igualdad exacta, owner forzado, 404 uniforme).
- No se toca ningún endpoint del canal por API key, ni su autenticación, ni su DTO.
- No se toca `db/schema.prisma` ni se añade migración alguna.
- No se toca `IWebhookOrdenReader` ni `WebhookOrdenReader`: los dos identificadores públicos
  (`numGuia`, `numRemision`) **ya** están en `DatosEntregaOrden` y **ya** viajan en el mismo objeto
  `data`. Este arreglo no necesita leer nada nuevo.
- No se cambia cuándo viaja el campo (268/R24 sigue mandando): solo en `incidente`, y omitido en
  cualquier otro caso.
- La ambigüedad heredada de la 177 (una remisión numérica que coincide con la guía de OTRA orden
  viva de la misma tienda; riesgo (a) declarado en la 177) **no se cierra aquí**. Ver R4 y §7.4 del
  design: este arreglo la reduce, no la elimina.

---

## Bloque A — El enlace resuelve

**R1.** CUANDO el sistema emita un evento `orden.estado_actualizado` con `data.estado` igual a
`"incidente"` y `data.evidenciasUrl` presente, el sistema DEBE emitir en el último segmento de ruta
de esa URL un identificador que `ApiOrdenResolucionService.resolver`, invocado con el owner de esa
orden, resuelva con `status: "ok"` **a esa misma orden** (`orden.id` idéntico).

**R2.** CUANDO se consulte `GET /api/ordenes/api-key/orden/{id}` usando el identificador emitido en
`data.evidenciasUrl` y una API key cuyo owner sea el dueño de la orden, el sistema DEBE responder
**200** con el detalle de **esa** orden, y NO 404.

**R3.** El sistema DEBE resolver ese identificador contra el SQL real de
`OrdenRepository.findByGuiaORemisionForOwner` (`tienda_id` forzado y `deleted_at IS NULL`), no solo
contra un doble en memoria.

**R4.** SI la orden tiene `num_guia` asignado, ENTONCES el sistema DEBE construir
`data.evidenciasUrl` con la representación decimal de ese `num_guia`.

**R5.** SI la orden NO tiene `num_guia` asignado, ENTONCES el sistema DEBE construir
`data.evidenciasUrl` con su `num_remision`, codificado de forma que viaje como **un solo** segmento
de ruta y que su decodificación devuelva el valor almacenado carácter a carácter.

**R6.** El sistema NUNCA DEBE emitir el `orden.id` (uuid interno), ni ningún otro identificador
interno, en `data.evidenciasUrl`.

## Bloque B — Cuándo NO se emite el enlace

**R7.** SI el identificador elegido no sobreviviría **sin cambios** a la validación de borde del
endpoint —vacío tras recortar espacios, distinto de su propia versión recortada, o de más de 128
caracteres—, ENTONCES el sistema DEBE **omitir** la clave `data.evidenciasUrl` en vez de emitir un
enlace que el endpoint rechazaría.

**R8.** SI el identificador elegido no se puede codificar como segmento de ruta (por ejemplo un
sustituto UTF-16 desemparejado, que hace lanzar `URIError` a `encodeURIComponent`), ENTONCES el
sistema DEBE omitir la clave `data.evidenciasUrl` y completar la entrega con normalidad, sin
propagar ningún error a la cola de jobs.

**R9.** MIENTRAS `data.estado` sea distinto de `"incidente"`, el sistema DEBE seguir omitiendo la
clave `data.evidenciasUrl` —omitida, no `null`— tal como exige 268/R24.

**R10.** SI el origin de la aplicación no se resuelve, ENTONCES el sistema DEBE seguir omitiendo la
clave `data.evidenciasUrl`, y NUNCA emitir una ruta relativa ni un `https://undefined/...`
(268/R24).

## Bloque C — Lo que este arreglo NO puede romper

**R11.** El sistema DEBE conservar el orden de inserción de las claves de `data`, con
`evidenciasUrl` como **última** clave, y la firma `X-Ordenex-Signature` DEBE verificar contra el
cuerpo ya construido con el enlace corregido.

**R12.** El sistema DEBE seguir emitiendo `data.evidenciasUrl` sin token, sin query string y sin
expiración (268/R22/R25): no es una URL firmada y no transporta credencial.

**R13.** El sistema NO DEBE alterar el comportamiento observable de `ApiOrdenResolucionService`, de
los endpoints del canal por API key, ni del esquema de datos: el diff de esta feature NO DEBE
contener ningún archivo bajo `db/`.

## Bloque D — El contrato publicado dice la verdad

**R14.** El sistema DEBE publicar, en `lib/api/openapi-spec.ts` y en su espejo
`docs/api/api-key-openapi.yaml`, un ejemplo de `data.evidenciasUrl` cuyo último segmento de ruta sea
**el mismo identificador público que ese propio ejemplo declara** en `data.numGuia` (o, si el
ejemplo no tiene guía, en `data.numRemision`), y ninguno de los dos documentos DEBE seguir
mostrando un uuid en esa posición.

**R15.** El sistema DEBE describir en el contrato publicado **con qué identificador** se construye
el enlace y que ese identificador es el mismo que el consumidor ya recibe en `data`; y los dos
documentos (TS y YAML) DEBEN decir lo mismo.

**R16.** El sistema DEBE dejar en `docs/api/CHANGELOG.md` una entrada **fechada** que declare que el
enlace de `incidente` viajaba con un identificador que el endpoint no resolvía y que ahora viaja con
uno que sí, sin reescribir la entrada histórica de la feature 268.

---

## Riesgos declarados (no son requisitos; se aceptan a sabiendas)

1. **El enlace deja de ser insensible a la base.** Con `orden.id` el enlace era idéntico entre los
   cinco reintentos del mismo job pasara lo que pasara. Con `num_guia` el enlace cambia si la guía
   se genera **entre** dos reintentos del mismo `eventoId`. Se acepta porque `data.numGuia` ya tiene
   exactamente esa propiedad hoy (se lee de la base en cada entrega), igual que `data.motivo`
   (256/R15, «el motivo VIGENTE EN EL MOMENTO DE LA ENTREGA»): el arreglo no abre una clase nueva de
   variación, alinea el enlace con un campo que ya la tenía. El `eventoId` —la clave de
   deduplicación— no depende del cuerpo en absoluto. La frase del OpenAPI que hoy promete que «las
   dos entregas de un mismo `eventoId` llevan exactamente el mismo valor» hay que precisarla (R15).
2. **Colisión heredada de la 177.** Con la orden **sin guía**, el enlace lleva la remisión; si esa
   remisión es un entero decimal canónico y coincide con el `num_guia` de otra orden viva de la
   misma tienda, la precedencia absoluta de la 177 (R14) resuelve la **otra** orden. Es un defecto
   preexistente del endpoint, no lo introduce esta feature, y este arreglo lo reduce (con guía, que
   es el caso común, no se produce). Cerrarlo exigiría tocar el resolver, que está fuera de alcance.
   Se declara en el design (§7.4) y **no** se disimula.
3. **Órdenes con remisión de más de 128 caracteres o con espacios de borde** quedan sin enlace
   (R7). No se sabe si existen: ver pregunta abierta Q4.

---

## Preguntas abiertas

**Q1 — ¿Guía primero, o siempre la remisión?** El arreglo recomendado usa `num_guia` cuando existe y
`num_remision` cuando no (design §5). La alternativa es usar **siempre** `num_remision`: es el
identificador que el propio integrador envió, es `NOT NULL`, y hace el enlace inmutable entre
reintentos (cierra el riesgo 1) — a cambio de exponerse **siempre** a la colisión del riesgo 2 en
vez de solo cuando no hay guía. Se recomienda guía-primero porque un enlace que apunta a **otra
orden** es un fallo mudo y un enlace que cambia entre reintentos no lo es. **Se pide firma humana**
porque es una decisión de contrato público.

**Q2 — ¿Se corrige el ejemplo de la entrada histórica del 2026-08-22 en `docs/api/CHANGELOG.md`?**
Ese ejemplo publicado lleva hoy el uuid. La recomendación es **no reescribir** la entrada (describe
lo que la 268 efectivamente entregó, igual que una migración aplicada es una foto histórica) y en su
lugar añadir la entrada nueva de R16 diciendo explícitamente que aquel enlace nunca resolvió. Si se
prefiere corregirla en sitio, se hace y se dice.

**Q3 — ¿Hay que avisar al integrador antes de desplegar?** Medido: 0 incidentes y 0 eventos de este
tipo en producción, luego **0 consumidores** han recibido nunca este enlace. Con ese número, avisar
no protege a nadie y no se propone como puerta de despliegue. Si el humano quiere avisar igual, es
una decisión suya, no un bloqueo del arnés.

**Q4 — ¿Cuál es el `max(length(num_remision))` real en producción, y hay remisiones con espacios de
borde?** No se ha medido (el spec_author no ejecuta consultas). Determina si R7 llega a activarse
alguna vez o es puramente defensivo. Se puede medir en solo-lectura con un `SELECT` antes de
implementar; el arreglo no depende del resultado.

**Q5 — ¿Next.js decodifica los segmentos dinámicos de ruta antes de entregarlos en `params`?** El
arreglo lo asume (R5) y el precedente del repo lo respalda (`lib/clients/whatsapp-media.ts` codifica
un id en un segmento de ruta con `encodeURIComponent`), pero no está medido **en este endpoint**.
Los tests del handler lo invocan con el `rawId` ya decodificado, así que no lo prueban. Ver la task
T9, que lo mide en vez de asumirlo; si resultara falso, R5 cambia de forma y se para a preguntar.
