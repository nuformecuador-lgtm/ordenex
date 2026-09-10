# Feature 406 — design

Decisiones técnicas del arreglo. Los requisitos (el QUÉ) viven en `requirements.md`; el desglose
ejecutable en `tasks.md`.

---

## 1. Lo que se midió en el código, no lo que se supone

Todo lo de esta sección está **confirmado en el archivo real el 2026-09-10**, no en el índice del
grafo (que para `WebhookEstadoService.ts` devolvía líneas rancias: daba `evidenciasUrlDe` en 202-207
cuando vive en 276-281, seguramente por la entrada de la ficha 403).

| Hecho | Dónde |
|---|---|
| El enlace se construye con el **uuid**: `` `${origin}${PATH_ORDEN_API_KEY}/${ordenId}` `` | `lib/services/WebhookEstadoService.ts:276-281` |
| `ordenId` sale del payload del job (`payloadSchema`), es `orden.id` | `lib/services/WebhookEstadoService.ts:71-75`, `138` |
| El resolver solo casa por `num_guia` (`^[1-9][0-9]*$`, ≤ int4) o `num_remision` (igualdad exacta) | `lib/services/ApiOrdenResolucionService.ts:38-43, 48-87` |
| El `where` real: `tienda_id = ownerId`, `deleted_at IS NULL`, `OR [numGuia?, numRemision]`, `take: 2` | `lib/repositories/OrdenRepository.ts:2894-2909` |
| `not_found` → 404 uniforme del canal | `app/api/ordenes/api-key/orden/[id]/route.ts:125` |
| Borde del path: `z.string().trim().min(1).max(128)` | `lib/api/api-orden-identificador.ts:16` |
| `numGuia: number \| null` y `numRemision: string` **ya** están en el DTO que el service recibe | `lib/interfaces/repositories/IWebhookOrdenReader.ts:8-16` |
| …y **ya** viajan en el mismo objeto `data` | `lib/services/WebhookEstadoService.ts:236-239` |
| `orden.num_guia` es `Int?` **`@unique` global**; `num_remision` es `String` NOT NULL | `db/schema.prisma:617-619` |
| `num_remision` es única **por tienda y solo entre vivas** (índice parcial `orden_tienda_id_num_remision_key`) | `db/schema.prisma:741-779` |
| `num_remision` no declara longitud máxima (zod de creación: `z.string().min(1)`, sin `.max`) | `lib/types/orden.ts:38` |
| El owner de la API key y el `orden.tienda_id` son **el mismo id** | `lib/utils/api-key-owner.ts:27-35` + `WebhookEstadoService.ts:146` (`findActivaByOwner(datos.tiendaId)`) |

Ese último hecho es el que hace que el arreglo sea posible sin tocar nada más: el integrador que
recibe el evento es, por construcción, el owner que el resolver exige.

## 2. La decisión

**Se corrige el emisor: `data.evidenciasUrl` se construye con el identificador público que el
endpoint SÍ resuelve.** No se toca el resolver.

```
identificador = numGuia !== null ? String(numGuia) : numRemision
evidenciasUrl = `${origin}/api/ordenes/api-key/orden/${encodeURIComponent(identificador)}`
```

Tres propiedades que lo justifican, cada una medida arriba:

1. **`num_guia` gana con precedencia ABSOLUTA** en el resolver (177/R14) y es `@unique` **global**:
   cuando existe, la resolución es exacta y no hay ambigüedad posible.
2. **`num_remision` es `NOT NULL`**, así que **siempre** hay un identificador. Eso preserva la
   propiedad que llevó a la 268 a elegir el uuid («el enlace siempre se puede construir»), que era
   la única razón real de aquella elección.
3. **Cero lecturas nuevas.** Los dos valores ya están en `DatosEntregaOrden` y ya se publican en el
   mismo `data`. El enlace pasa a apuntar a la orden que el propio cuerpo ya nombra.

## 3. Archivos de producción que se tocan

| Archivo | Cambio |
|---|---|
| `lib/services/WebhookEstadoService.ts` | `evidenciasUrlDe` cambia de firma (`(estado, ordenId)` → `(datos)`) y construye el enlace con el identificador público; se añade un helper privado `identificadorPublicoDe`; `armarData` pierde el parámetro `ordenId` (queda sin uso, y `strict`+lint lo marcarían) y su llamada en `ejecutar` se ajusta; se corrige el comentario **falso** de `PATH_ORDEN_API_KEY` (líneas 52-54: «Se elige la variante por `orden.id`…»). |
| `lib/api/openapi-spec.ts` | Descripción de `evidenciasUrl` (qué identificador lleva) y el **ejemplo** de `incidente`, cuyo último segmento pasa de uuid a `100235` (el `numGuia` que ese mismo ejemplo declara). |
| `docs/api/api-key-openapi.yaml` | Espejo textual exacto de lo anterior. |
| `docs/api/CHANGELOG.md` | Entrada **nueva** fechada (R16). La entrada histórica del 2026-08-22 no se reescribe (Q2). |

**Nada más.** Sin migraciones, sin `db/schema.prisma`, sin `lib/types/**`, sin `lib/interfaces/**`,
sin repositorios, sin route handlers, sin `middleware.ts`. Consecuencia práctica para el gate: el
diff **no** dispara la negativa de `--rapido` (`docs/verification.md` §«Cuándo `--rapido` se
niega»), pero **sí** hay que correr `./init.sh` completo antes de la release, como siempre.

## 4. Solape con la feature 404 — SE SECUENCIA, no se paraleliza

La 404 (`mensajero` en el webhook y en la API) está **en curso ahora mismo** y toca los mismos
archivos. Su propio design lo anticipó: §11 punto 5 anota este defecto como «observación colateral,
FUERA DE ALCANCE». **Este spec asume que la 404 entra ANTES.**

| Archivo | Qué toca la 404 | Qué toca la 406 | ¿Mismas líneas? |
|---|---|---|---|
| `lib/services/WebhookEstadoService.ts` | `DataEvento` gana `mensajero`; `armarData` inserta `mensajero` **después de `motivo` y antes del bloque de `evidenciasUrl`** (404 design §Archivos) | `armarData` pierde el parámetro `ordenId`; cambia la línea `const evidenciasUrl = this.evidenciasUrlDe(...)`; reescribe `evidenciasUrlDe` | **SÍ, adyacentes.** La 404 inserta justo encima de la línea que la 406 modifica (hoy 256-260). Git dará conflicto si van en paralelo. |
| `tests/unit/services/webhook-estado-service.test.ts` | Congela `Object.keys(body.data)` con `mensajero` dentro del describe `268/R22-R25` | Cambia la constante `ENLACE` y las aserciones de `pathname` del mismo describe | **SÍ, mismo bloque** (hoy 660-810). |
| `lib/api/openapi-spec.ts` | Añade `mensajero` a `properties`, a `required` y a los **dos ejemplos** | Cambia el valor de `evidenciasUrl` **dentro del segundo ejemplo** | **SÍ, mismo objeto de ejemplo** (hoy 1038-1051). |
| `docs/api/api-key-openapi.yaml` | Idem, espejado | Idem, espejado | **SÍ** (hoy 865-873). |
| `docs/api/CHANGELOG.md` | Entrada nueva al inicio | Entrada nueva al inicio | **SÍ**, cabecera del archivo. |

**Regla de ejecución (T1 de `tasks.md`):** no se abre la rama de la 406 hasta que la 404 esté
mergeada en `dev`, y la rama se saca de ese `dev`. Si por lo que sea la 406 tuviera que empezar
antes, el orden de aplicación es el mismo (la 406 rebasa sobre la 404, nunca al revés) y los cinco
conflictos de arriba se resuelven a mano, no con `-X ours`.

**Lo que la 406 NO toca y la 404 sí:** `lib/interfaces/repositories/IWebhookOrdenReader.ts` y
`lib/repositories/WebhookOrdenReader.ts`. La 406 no necesita ningún dato nuevo.

## 5. El constructor del enlace, en detalle

Dos funciones privadas en `WebhookEstadoService`, ninguna con conocimiento de HTTP ni de Prisma
(sigue cumpliendo `docs/architecture.md` §Service):

**`identificadorPublicoDe(datos): string | null`**

1. `bruto = datos.numGuia !== null ? String(datos.numGuia) : datos.numRemision`.
2. Se valida contra **el mismo `idOrdenApiSchema`** que usa el borde
   (`lib/api/api-orden-identificador.ts`), y se exige además que el valor **no cambie** al pasar por
   él: `parsed.success && parsed.data === bruto`. Si no, `null` (R7).
   - Importar ese schema es correcto y deliberado: el módulo es zod puro, **sin HTTP** (lo dice su
     propia cabecera), y así el emisor y el borde no pueden divergir. Escribir a mano «≤ 128» aquí
     sería la segunda copia de una regla que ya tiene dueño.
   - La igualdad `parsed.data === bruto` es la que caza el caso de espacios de borde: el schema
     **recorta**, y el resolver compara la remisión por **igualdad exacta** contra la columna, así
     que una remisión guardada como `" REM-1 "` es inalcanzable por ese endpoint. Mejor omitir que
     enlazar a un 404.
3. `null` también si `encodeURIComponent` no puede procesarlo (R8). `encodeURIComponent` **lanza
   `URIError`** ante un sustituto UTF-16 desemparejado — no es teoría, este repo ya se lo comió en
   `lib/utils/chat-media-headers.ts:62-66`. Un `URIError` aquí saldría por el `throw` de `ejecutar` y
   la cola lo trataría como fallo recuperable: cinco reintentos y dead-letter **de una entrega que
   por lo demás estaba perfecta**. Omitir la clave es infinitamente mejor que perder el evento.

**`evidenciasUrlDe(datos): string | null`** — mismo orden de guardas que hoy, con una más:

1. `datos.estado !== "incidente"` → `null` (R9, sin cambios).
2. `origin === null` → `null` (R10, sin cambios).
3. `identificadorPublicoDe(datos) === null` → `null` (R7/R8, **nuevo**).
4. `` `${origin}${PATH_ORDEN_API_KEY}/${encodeURIComponent(ident)}` `` (R4/R5/R6).

`encodeURIComponent` sobre un entero decimal es la identidad, así que el caso común no cambia de
forma. Sobre una remisión codifica `/`, `?`, `#`, `%` y el espacio, que son justo los que romperían
el segmento de ruta. Precedente en el repo: `lib/clients/whatsapp-media.ts:136`.

**Lo que NO cambia:** el orden de inserción de claves de `data` (la firma se calcula sobre el string
serializado — 99/R18, 256/R7, y la 404 depende de ello), la convención de omisión de la clave, y la
ausencia de query string.

## 6. Cómo se prueba que el enlace RESUELVE, no que la cadena «tiene buena pinta»

Esta es la parte que decide si la feature vale algo. Tres capas, con una regla común: **jamás
comparar la URL contra la función que la construye.** Ese es el modo de fallo «aserción contra su
propia fuente» que en este repo ya dejó pasar un tope que la app rechazaba.

### Capa 1 — Cierre de lazo por el borde (obligatoria, sin DB)

Archivo nuevo: `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts`.

```
WebhookEstadoService REAL  ──entrega──▶  cuerpo (string)
        │                                    │ JSON.parse → data.evidenciasUrl
        │                                    ▼
        │                          new URL(...).pathname → último segmento
        │                                    │ decodeURIComponent
        ▼                                    ▼
   ordenId del job          handleConsultaOrdenApi(req, ident, deps)  ← handler REAL
                                             │ deps.resolucionService = ApiOrdenResolucionService REAL
                                             ▼
                                    200 + detalle de ESA orden
```

Por qué esto no es tautológico: el identificador atraviesa **tres módulos independientes** que
nadie comparte —el constructor (`WebhookEstadoService`), el parser de URL del runtime, y el resolver
(`ApiOrdenResolucionService`, con su regex y su precedencia escritas a mano en otro archivo)—. El
aserto final no es sobre la cadena: es **`orden.id` resuelto === `orden.id` del job**.

El harness ya existe y se copia de `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts`
(líneas 48-83): repo fake que filtra por `numGuia === ident.numGuia || numRemision === ident.numRemision`,
con `expect(ownerId).toBe(ACTOR.usuarioId)` dentro. Se reusa tal cual.

**Va rojo hoy:** con el código actual el segmento es un uuid, el repo fake devuelve `[]`, el
resolver da `not_found` y el handler responde **404**. Es el test que reproduce el defecto.

### Capa 2 — El `WHERE` donde vive (Postgres real)

Archivo nuevo: `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts`, envuelto en
`HAY_BASE_DE_DATOS` (`tests/integration/db/_postgres-real.ts`), con `crearPrismaDeTest()`.

La capa 1 usa un doble, y un doble **no ve el SQL**: en este repo se midió cuatro veces seguidas que
una mutación del `WHERE` deja los tests de servicio en verde. Aquí se siembra tienda + orden(es)
reales, se toma el identificador del cuerpo real del webhook y se llama al
`OrdenRepository.findByGuiaORemisionForOwner` **real**, afirmando que la fila devuelta es la orden
sembrada. Patrón a copiar: `tests/integration/db/orden-remision-borrada-libera-numero.test.ts`.

Dos casos mínimos, y los dos **con datos**: orden con guía, y orden sin guía. Nada de
`if (!fila) return;` — ese es el patrón que reporta `passed` sin comprobar nada (ya pasó aquí).

**Esta capa NO puede ser la única evidencia:** `docs/verification.md` §«Sin `DATABASE_URL` la suite
se encoge» — 147 archivos se **saltan** sin base, y en un worktree eso es lo normal. La capa 1 tiene
que sostener el requisito por sí sola, y por eso R1/R2 se mapean a ella y R3 a esta.

### Capa 3 — El contrato publicado, cruzado consigo mismo

En el test de OpenAPI: extraer del ejemplo de `incidente` el último segmento de
`data.evidenciasUrl` y afirmar que es igual a `String(ejemplo.data.numGuia)` — **dos campos
distintos del mismo ejemplo publicado**, no la función contra sí misma. Va rojo hoy
(`018f2c31-…-0002` ≠ `100235`). Y lo mismo contra el YAML, que es el que el integrador lee.

### Autocomprobación de las mutaciones

En este repo un arnés de mutaciones reportó 9/9 supervivientes **dos veces sin haber ejecutado un
test**. Por eso T11 exige pegar la salida roja de cada mutación, no su resumen. Las cuatro:

| Mutación | Debe poner rojo |
|---|---|
| Volver a `` `${origin}${PATH}/${ordenId}` `` (el bug original) | Capa 1 (404), capa 2 |
| Invertir la precedencia (`numRemision` cuando hay guía) | El caso «con guía» de la capa 1 debe seguir verde (resuelve igual) → **este test no basta**: el aserto que lo caza es el unitario de R4, que fija el literal a mano |
| Quitar `encodeURIComponent` | El caso de remisión con `/` de la capa 1 |
| Quitar la guarda de R7 (>128 / trim) | El caso de remisión larga: la clave debe estar ausente |

La segunda fila está escrita a propósito: dice **qué test NO caza qué**, que es la información que
falta en la mayoría de los mapas de trazabilidad.

## 7. Alternativas descartadas

### 7.1 Enseñarle al resolver a aceptar también el `orden.id` — DESCARTADA

Era la otra salida obvia. Consistiría en añadir en `ApiOrdenResolucionService.resolver` una rama que
detecte un uuid y resuelva por `orden.id`, con su método de repositorio y su `where` con owner.

**Por qué no:**

1. **Convierte un id interno en identificador público.** El DTO del canal (feature 106) se diseñó
   explícitamente «sin `storage_path`, sin bucket y sin ids internos», y la 405 lo repite como
   requisito. Esta salida haría exactamente lo contrario: publicaría el uuid de `orden.id` como
   parte del contrato del endpoint, y una vez publicado no se retira.
2. **Es más superficie de cambio, no menos.** Toca el service, `IOrdenRepository`, `OrdenRepository`
   (método y query nuevos), y modifica el comportamiento de **dos** verbos ya vivos —`GET` y el
   `DELETE` de la 320— más `POST .../generate`, que comparten resolución. Un borrado por API key
   pasaría a aceptar un identificador que hoy rechaza. El arreglo del emisor no toca ninguno.
3. **Añade una tercera regla de precedencia** a un lugar donde la precedencia fue una puerta de
   decisión humana (177/F1.4). Reabrirla por un enlace roto es desproporcionado.
4. **No arregla el enlace del pasado ni del futuro mejor que (a).** El enlace seguiría llevando el
   uuid; simplemente habría un segundo camino para resolverlo.
5. Es, literalmente, «modelo nuevo en vez del arreglo mínimo», que es lo que en este repo ya tumbó
   dos specs.

### 7.2 Un endpoint propio de evidencias (`/orden/{id}/evidencias`) — DESCARTADA

Ya la descartó el design de la 268 §7.3 («superficie nueva para una proyección de lo que el detalle
ya devuelve») y nada ha cambiado. Además es exactamente lo que la regla de alcance de esta ficha
prohíbe: endpoint nuevo.

### 7.3 Meter el `orden.id` en `data` para que el consumidor arme la URL — DESCARTADA

Campo nuevo en el contrato público, con un id interno dentro, y traslada al integrador un trabajo
que es nuestro. Peor en las tres dimensiones.

### 7.4 Usar **siempre** `num_remision` — DESCARTADA (pero es la pregunta abierta Q1)

Tiene una virtud real: el enlace queda inmutable entre reintentos (cierra el riesgo 1 de
`requirements.md`) y `num_remision` es `NOT NULL`, así que nunca falta.

**Por qué no se recomienda:** se expondría **siempre** a la colisión de la 177 —una remisión que sea
un entero decimal canónico y coincida con el `num_guia` de otra orden viva de la misma tienda hace
que la precedencia absoluta resuelva la **otra** orden—, y una remisión numérica es plausible: el
integrador la trae de su propio sistema. Un enlace que devuelve **200 con la orden equivocada** es
un fallo mudo; un enlace que cambia de valor entre dos reintentos no lo es (y el `eventoId`, que es
por donde se deduplica, no depende del cuerpo). Con guía-primero esa colisión solo puede darse en
órdenes sin guía, que es un subconjunto estricto.

Se deja como **Q1** porque es contrato público y merece firma humana, no una decisión del spec.

### 7.5 Omitir el campo hasta que exista un identificador «bueno» — DESCARTADA

Sería no arreglar nada: el 268/R24 quiere el enlace en los incidentes, y `num_remision` garantiza
que siempre hay uno. La omisión se reserva para los casos de R7/R8, que son de imposibilidad real.

## 8. Modelo de datos, migraciones, RLS

**Ninguno.** Cero tablas, cero columnas, cero migraciones, cero cambios de RLS. R13 lo convierte en
un aserto verificable: el diff no contiene ningún archivo bajo `db/`.

## 9. Contratos de entrada/salida

**Entrada:** sin cambios. El payload del job sigue siendo `{ ordenId, estatusDestinoId, ocurridoAt }`
y `ordenId` se sigue usando para el `eventoId` (`dedupeKeyWebhookEstado`), que **no cambia**.

**Salida (cuerpo del evento), con la 404 ya dentro:**

```jsonc
{
  "evento": "orden.estado_actualizado",
  "eventoId": "webhook_estado:018f2c31-0000-4000-8000-000000000002:21:2026-08-22T14:30:00.000Z",
  "ocurridoAt": "2026-08-22T14:30:00.000Z",
  "data": {
    "numGuia": 100235,
    "numRemision": "REM-0002",
    "estado": "incidente",
    "motivo": "robado",
    "mensajero": { "id": "…", "nombre": "…" },
    "evidenciasUrl": "https://app.ordenex.co/api/ordenes/api-key/orden/100235"
  }
}
```

El `eventoId` conserva el uuid: es una clave de deduplicación opaca, no una URL, y cambiarla rompería
la idempotencia de consumidores que ya deduplican por ella. **Solo** cambia el último segmento de
`evidenciasUrl`.

Y una orden **sin guía**, que es el caso que justifica el fallback:

```jsonc
"data": { "numGuia": null, "numRemision": "REM-0002", "estado": "incidente", "motivo": "robado",
          "evidenciasUrl": "https://app.ordenex.co/api/ordenes/api-key/orden/REM-0002" }
```

**Integraciones:** ninguna nueva. El endpoint enlazado ya existe (177), ya exige
`Authorization: Bearer ordx_…`, ya fuerza el owner y ya devuelve 404 uniforme. La credencial la
sigue poniendo el integrador; el cuerpo del webhook nunca la transporta (268/R22, R12 de esta
ficha).

## 10. Riesgo de que esto se vuelva a romper

El defecto vivió tres semanas porque **nada ataba el emisor al resolver**: dos módulos que no se
importan, cada uno correcto por su cuenta. La capa 1 de §6 es precisamente ese lazo, y queda como
test permanente: el día que alguien cambie la regla de resolución del `{id}`, ese test se pone rojo
aunque el cambio esté en el otro archivo. Es lo único de esta ficha que no es «arreglar la línea».
