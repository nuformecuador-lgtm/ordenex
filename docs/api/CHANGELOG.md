# Changelog del canal por API key

> **Qué es esto y por qué existe.** El canal por API key es un contrato público: hay integradores
> con código escrito contra él. Cuando ese contrato cambia, avisarlo **no es cortesía, es parte del
> despliegue** — las fichas lo escriben como una task que *bloquea la release, no el código*
> (239/T0.3, 268/T8). Hasta hoy ese aviso no tenía dónde vivir: se redactaba una vez, se mandaba
> por un canal que no constaba en ninguna parte, y la casilla se quedaba sin marcar. La de la 239
> sigue sin marcar, y la feature salió igual.
>
> **La convención:** todo cambio observable del canal —values nuevos, claves nuevas, un campo que
> cambia de forma, un endpoint que empieza a devolver algo que antes no devolvía— entra aquí como
> una entrada fechada **antes de la release**, y la bitácora de la ficha enlaza a ella. El texto de
> una entrada es el aviso: se copia y se manda, no se vuelve a redactar.
>
> **Qué NO entra:** cambios internos que el integrador no puede observar. Si no se nota desde
> fuera, no es del contrato.
>
> El contrato vigente vive en `docs/api/api-key-openapi.yaml` (espejo textual de
> `lib/api/openapi-spec.ts`, que es el que los tests muerden). Este archivo cuenta **qué cambió y
> cuándo**; aquel dice **qué hay hoy**. Si los dos se contradicen, manda el contrato.

---

## 2026-09-10 — Un campo NUEVO: `gestiones[]`, en el detalle de una orden

**Es ADITIVO: nada de lo que hoy funciona deja de funcionar.** No se retira ni se renombra ningún
campo, ningún path cambia, ningún código de estado cambia y ninguna respuesta pierde nada.
`GET /api/ordenes/api-key` (el listado) y el webhook `orden.estado_actualizado` **no cambian en
absoluto**. Si tu integración ignora las claves que no conoce —lo recomendado—, **no tenés que
hacer nada**.

**Qué es.** `GET /api/ordenes/api-key/orden/{id}` pasa a incluir `gestiones`: la lista de los
desenlaces que se registraron sobre esa orden, del más antiguo al más reciente. Antes solo veías el
resultado final; ahora podés ver cuántas veces se intentó, cuándo y quién.

```json
"gestiones": [
  {
    "createdAt": "2026-09-02T15:41:07.000Z",
    "resultado": "reprogramada",
    "estadoResultante": "reprogramada",
    "motivo": null,
    "mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" }
  },
  {
    "createdAt": "2026-09-04T18:02:55.000Z",
    "resultado": "devuelta",
    "estadoResultante": "devolucion_por_confirmar",
    "motivo": "wrong_address",
    "mensajero": { "id": "018f2c31-0000-4000-8000-0000000000bb", "nombre": "Ana Solís Vargas" }
  }
]
```

Cuando la orden todavía no se gestionó, llega `"gestiones": []`. **La clave viaja SIEMPRE**: nunca
es `null` y nunca se omite. Las **cinco** claves de cada elemento también están siempre presentes,
con `null` donde no aplica. Es la misma convención que ya tiene `motivo` en el webhook.

**Los nombres: pediste `fecha` y `tipo`; se llaman `createdAt` y `resultado`.** No es un capricho:

- `createdAt` es como se llama el instante de creación de un registro en el resto de este canal
  (lo lleva cada orden del listado), y `fecha` habría sido ambiguo — en una gestión reprogramada
  hay **otra** fecha, la de reprogramación, que es un dato distinto;
- `resultado` es como se llama ese mismo valor en `evidencias[]`, que ya publicamos con tres de
  sus cinco values.

Un concepto, un nombre. El mapeo es directo: `fecha` → `createdAt`, `tipo` → `resultado`.

**`motivo` es la causa TIPIFICADA, y NO es el comentario del mensajero.** Esto es lo más importante
de esta entrada, porque en nuestra base de datos hay dos cosas que se llaman `motivo` y solo una
sale:

- lo que recibís es la **causa tipificada** del desenlace, con seis valores posibles:
  `not_found` / `wrong_number` / `wrong_address` en una devolución, y `danado` / `perdido` /
  `robado` en un incidente. Es el mismo campo y los mismos valores que ya recibís en `data.motivo`
  del webhook;
- **NO es** el comentario en texto libre que el mensajero escribe al gestionar la orden. Ese texto
  **no sale del sistema** por decisión de privacidad, y no va a salir.

En cualquier otro `resultado` —`entregada`, `reprogramada`, `rechazada`— `motivo` es `null`. Y
también es `null` en devoluciones e incidentes **antiguos**, anteriores a que empezáramos a pedir
la causa: ese histórico no se rellenó. El contrato no distingue «no hubo causa» de «no se
registró».

**La asimetría de idioma es DELIBERADA.** Las causas de devolución van en **inglés**
(`not_found`, `wrong_number`, `wrong_address`) y las de incidente en **español** (`danado` —sin
eñe—, `perdido`, `robado`). Cada una se publicó con el value crudo de su catálogo interno, y
renombrar cualquiera de las dos rompería a quien ya las consume. No las vamos a «armonizar»: no
escribas código que asuma que van a cambiar, ni que las traduzca por su idioma.

**`estadoResultante` no se deduce del `resultado`.** Es el estado en que ESA gestión dejó la orden,
leído de nuestra línea de tiempo. Ojo con el caso que más confunde: una gestión `devuelta` deja la
orden en `devolucion_por_confirmar`, **no** en `devuelta`; es la aprobación posterior del cierre la
que la mueve. Puede llegar `null` en gestiones **antiguas**, anteriores a que existiera esa línea
de tiempo: no hay transición registrada que las respalde, y no es un fallo. Se publica **sin lista
cerrada de valores** a propósito, porque puede tomar values que la lista documentada de `estado`
todavía no enumera: tratá un value desconocido como texto, no como error.

**`mensajero` es el ATRIBUIDO a la gestión, y no siempre es quien la registró.** Tiene la misma
forma `{ id, nombre }` que el `mensajero` de la orden, y aquí **nunca es `null`**. Pero algunas
gestiones las crea el sistema o tu propia tienda —una reprogramación desde el escritorio, el
escalado automático por vencimiento de plazo, un rechazo manual, el desenlace de una solicitud de
ayuda, o el corte al llegar al tope de reintento— y quedan atribuidas al mensajero de la última
devolución. En el array se ven **idénticas** a una visita de calle. Si tu métrica es «tiempo por
mensajero», tenelo en cuenta: no todas las entradas son una visita física de esa persona.

**`gestiones.length` NO es nuestro contador de intentos de entrega.** El nuestro cuenta cierres
aprobados distintos con visita real, así que **varias gestiones del mismo cierre valen 1**. Este
array es la lista cruda, sin agrupar: si contás sus elementos, vas a obtener un número mayor que el
que usamos nosotros. No es el mismo dato y no deberían cuadrar.

**Qué NO está en el array:**

- las gestiones **anuladas**. Una anulación deshace el registro, y contarla inflaría justo la
  métrica de reintentos que este campo existe para medir;
- los **incidentes que reporta nuestro personal de bodega**. No son gestiones, no tienen mensajero
  atribuido y no cambian de dueño el paquete. Sus fotos sí siguen apareciendo en `evidencias[]`,
  como hasta ahora.

**Llega completo y sin paginar.** No hay tope ni `limit`: el array trae todas las gestiones
vigentes de la orden. Medido sobre nuestros datos reales, el máximo en una sola orden son 5 y el
promedio es 1,4, así que el cuerpo crece unos pocos cientos de bytes en el peor caso. Si algún día
eso cambiara, lo avisaríamos aquí antes de tocar nada — **nunca** vamos a recortar el array en
silencio.

**Si validás el esquema de forma estricta** (`additionalProperties: false` sobre nuestra respuesta),
esta clave nueva te va a hacer fallar. El contrato actualizado está en
`docs/api/api-key-openapi.yaml` y en `/api-docs`.

---

## 2026-09-09 — Un campo NUEVO: `mensajero`, en el webhook, en el listado y en el detalle

**Es ADITIVO: nada de lo que hoy funciona deja de funcionar.** No se retira ni se renombra ningún
campo, ningún path cambia, ningún código de estado cambia y ninguna respuesta pierde nada. Si tu
integración ignora las claves que no conoce —lo recomendado—, **no tenés que hacer nada**.

**Qué es.** Cada orden pasa a decir qué mensajero la lleva. El campo se llama `mensajero`, tiene
siempre la misma forma en las tres superficies del canal y lleva exactamente dos claves:

```json
"mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" }
```

o, cuando todavía no la lleva nadie:

```json
"mensajero": null
```

**Dónde aparece:**

1. dentro de `data`, en el evento `orden.estado_actualizado` del webhook;
2. en **cada ítem** de `GET /api/ordenes/api-key`;
3. en `GET /api/ordenes/api-key/orden/{id}`.

**La clave viaja SIEMPRE.** `null` no es «no se sabe» ni una omisión: significa **«todavía nadie la
lleva»**, y es un dato que podés contar. No ramifiques por «la clave existe», ramificá por su valor.
Es la misma convención que ya tiene `motivo`, no la de `evidenciasUrl`.

**El `id` es un UUID en TEXTO, no un entero.** Si esperabas algo como `"id": 123`, no existe: en
nuestro modelo la identidad de una persona es un UUID y se publica tal cual, como string. Es
**estable**: el mismo mensajero produce el mismo `id` en las tres superficies y en todas las
lecturas, y ese `id` no se reasigna nunca a otra persona. Agrupá por `id`, **no por `nombre`**: el
nombre es un texto para mostrar y puede corregirse, lo que te partiría la serie histórica en dos.

**Es quién la LLEVA, no quién la entregó.** El campo dice quién tiene la orden asignada **en el
momento de la lectura** —o, en el webhook, en el momento de **esa entrega**, igual que `motivo`: si
la orden se reasigna entre dos entregas del mismo `eventoId`, la segunda lleva el mensajero de
entonces—. Y hay flujos que **limpian** la asignación: generación de guía, quitar mensajero,
devolución o recuperación a bodega, liberación de una reprogramada y el barrido del cierre diario.
Consecuencia práctica, que preferimos decir antes de que la descubras: una orden **entregada o
devuelta conserva** su mensajero, así que la métrica de entregas por mensajero funciona; pero una
orden vieja **barrida por el cierre** puede aparecer con `mensajero: null` aunque alguien la
llevara. Para «quién gestionó cada intento» hace falta el historial de gestiones, que este cambio
**no** incluye.

**El bloque `data` del webhook pasa a tener CINCO claves siempre presentes** —`numGuia`,
`numRemision`, `estado`, `motivo` y `mensajero`— y `evidenciasUrl` sigue siendo la **única**
opcional, que se omite salvo en los eventos con `estado: "incidente"`. `mensajero` se inserta
**después de `motivo` y antes de `evidenciasUrl`**; el resto del cuerpo no se mueve.

**⚠️ Si tu cliente valida el esquema en estricto** (`additionalProperties: false`, un DTO generado
que rechaza claves desconocidas, un parser que falla ante un campo de más), **una clave nueva puede
romperte**. Es el mismo aviso que dimos al añadir `evidenciasUrl`: regenerá tu modelo contra el
contrato actualizado o relajá la validación antes de la fecha de despliegue.

**Qué NO cambia.** No hay parámetro de query nuevo: **no se puede filtrar ni ordenar el listado por
mensajero**, y un `?mensajero=...` se ignora como cualquier otra clave desconocida. Los nueve campos
publicados del ítem, el bloque `pagination`, el `evidencias[]` del detalle y el orden de las filas
entre páginas quedan **exactamente** como estaban. Del mensajero se publica **solo** su `id` y su
`nombre`: ningún otro dato personal suyo (teléfono, email, cédula, foto, zona, vehículo) sale por
este canal.

Los dos artefactos del contrato quedan actualizados (`lib/api/openapi-spec.ts` y su espejo
`docs/api/api-key-openapi.yaml`): `WebhookOrdenEstadoActualizado.data` y `OrdenListItem` declaran
`mensajero` dentro de `required` —`OrdenDetalle` lo hereda—, y los dos ejemplos del webhook lo
muestran, uno con objeto y otro con `null`.

---

## 2026-09-06 — Un motivo de error de fila NUEVO: provincia, cantón o distrito RETIRADOS del catálogo

**Qué cambia.** Ordenex pasa a poder **retirar** una provincia, un cantón o un distrito de su
catálogo geográfico sin borrarlo. Un nodo retirado deja de admitirse en cargas y cotizaciones
**nuevas**; las órdenes que ya lo referencian **no se tocan** y siguen consultándose y listándose
igual que siempre.

A partir de esta fecha, `POST /api/ordenes/api-key/carga` y `POST /api/ordenes/api-key/cotizacion`
pueden devolver, **dentro de la lista `errores`**, una fila con uno de estos tres mensajes:

- `la provincia esta retirada del catalogo`
- `el canton esta retirado del catalogo`
- `el distrito '<nombre>' esta retirado del catalogo`

**Qué NO cambia, y conviene leerlo antes de tocar nada:**

- **Sigue siendo `200` con éxito parcial.** La fila retirada viaja en `errores` exactamente igual
  que «distrito no encontrado en el cantón», y **las demás filas del lote se procesan**. No hay
  ningún `422` nuevo, ni ningún código de estado nuevo.
- **Ningún path, ningún schema, ningún nombre de campo se ha tocado.** La forma de la respuesta es
  la de siempre: `errores[].errores` sigue siendo un objeto de `campo -> string[]`.
- **La clave del error es la del nivel afectado** (`provincia`, `canton` o `distrito`), como ya
  ocurría con los motivos anteriores.

**Por qué el mensaje es propio y no «no encontrado».** Porque son cosas distintas: el nodo
**existe**, escrito exactamente como lo mandaste. Reutilizar «no encontrado» te mandaría a buscar
una errata en una dirección correcta. Si más de un nivel de la terna está retirado, se informa
siempre del **más alto**: primero provincia, luego cantón, luego distrito.

**Qué hacer si tu código enumera los motivos de error de fila.** Si tenés un `switch`, un mapa de
traducciones o una lista blanca de mensajes, añadí estos tres; si tu código trata cualquier entrada
de `errores` de forma genérica —lo recomendado—, **no tenés que hacer nada**. En ningún caso hace
falta reintentar: un nodo retirado no vuelve solo, hay que corregir la dirección de la fila o
pedirnos que lo reactivemos.

Los dos artefactos del contrato quedan actualizados (`lib/api/openapi-spec.ts` y su espejo
`docs/api/api-key-openapi.yaml`): las descripciones de `provincia`, `canton` y `distrito` de
`CargaRow` y `CotizacionRow` enumeran ahora este motivo, y el ejemplo de respuesta de
`/cotizacion` lo muestra.

---

## 2026-09-01 — El contrato retira la descripción en prosa de TODOS los endpoints (y la colección de Postman pasa a una petición por endpoint)

**No cambia ni un byte de las peticiones ni de las respuestas.** Ningún path, parámetro, schema,
código de estado ni ejemplo se ha tocado: si tu código funciona hoy, sigue funcionando mañana. Lo
que cambia es lo que el documento *cuenta*.

Se retiró el bloque `description` de nivel operación de los **diez endpoints y del webhook**, en los
dos artefactos (`lib/api/openapi-spec.ts` y `docs/api/api-key-openapi.yaml`). En Swagger UI cada
endpoint conserva su `summary`, sus parámetros —con sus descripciones, que **no** se tocaron—, sus
schemas y sus ejemplos, pero ya no hay párrafo explicativo debajo del título.

**Lo que dejó de estar escrito**, por si lo estabas usando como referencia:

- **Webhook `orden.estado_actualizado`**: cómo verificar la firma. Las cabeceras
  `X-Ordenex-Signature` y `X-Ordenex-Timestamp` siguen declaradas, pero el contrato ya no dice que
  la firma es `HMAC-SHA256` sobre `${timestamp}.${cuerpo}` con el secreto de tu suscripción, ni que
  hay que verificarla sobre el texto crudo antes de parsearlo. **Sigue siendo así**: la entrega no
  cambió, solo la documentación.
- **`POST /ordenes/api-key/cotizacion`**: que el precio se calcula suponiendo `cobra_comision = true`.
- **`GET /ordenes/api-key/analitica`**: qué métricas cuentan **gestiones** y cuáles cuentan órdenes.
  Sin ese dato, sumar dos series entre sí puede dar un total que no significa nada.
- **`POST /ordenes/api-key/carga`**: la nota del cambio incompatible de tarifas y el comportamiento
  con fulfillment (órdenes que nacen en `en_preparacion` y sin `num_guia`).
- **`POST /ordenes/api-key/habilitar`**: que solo `ayuda_tienda` y `devuelta` son habilitables, y
  que una `devuelta` nunca cambia de estado.

Todas esas reglas **siguen vigentes en el comportamiento del canal**; lo que se fue es su
descripción publicada. Las entradas anteriores de este changelog las conservan.

**El evento saliente deja de publicarse como operación.** `orden.estado_actualizado` vivía en la
sección `webhooks:` de nivel superior, que Swagger UI pinta como un endpoint más — y no lo es: no es
algo que vos llames, es Ordenex quien lo entrega a tu callback. Ahora se publica **solo su forma**,
como el schema `WebhookOrdenEstadoActualizado` de `components.schemas`, con las mismas propiedades,
los mismos enums y los mismos dos ejemplos.

**La entrega no cambia en nada**: se sigue enviando igual, firmada igual, a la misma URL. Lo que
desaparece del documento son las dos cabeceras `X-Ordenex-Signature` y `X-Ordenex-Timestamp`, que
solo una operación puede declarar. **Siguen viajando en cada entrega**; el contrato ya no las
enumera. Si generás tipos desde el contrato, el cuerpo lo tenés en el schema nuevo; las cabeceras
tendrás que escribirlas a mano.

**Se retira también el bloque `servers`.** Es el único punto de esta entrada que puede notarse fuera
de la vista: el contrato ya no propone ninguna URL base, así que Swagger UI deja de pintar el
desplegable de servidores y resuelve las rutas contra el origen que sirve el documento. **Si generás
tu cliente desde el `.yaml`**, el generador ya no encontrará una base y la tomará relativa o te
pedirá pasarla vos: revisá la configuración de tu cliente antes de actualizar el contrato. Las rutas
no cambian.

Del texto de la cabecera salen además dos referencias internas que nunca debieron publicarse: la
mención a la «feature 10» junto al shape de error —que sigue descrito, y con el mismo schema
`Error`— y la coletilla sobre ampliar el alcance «vía parámetros de la petición». La regla que
enunciaba no cambia: un `tiendaId` u `owner` en la query **se sigue ignorando**. Y se deja de
nombrar el prefijo `ordx_` de la key, tanto en la cabecera como en el esquema de seguridad, que
ahora se limita a decir dónde va: `Authorization: Bearer <tu-api-key>`. **Tu key no cambia y el
header tampoco**: se manda exactamente igual que hasta hoy.

En la misma release, `docs/api/ordenex-api-key.postman_collection.json` se rehízo: **una petición
por endpoint** (diez, sin carpetas de casos de éxito y error), el listado con la paginación y sus
cinco filtros en una sola petición —los filtros van desactivados, se activan a mano— y se añadió la
analítica, que faltaba.

---

## 2026-08-31 — RUPTURA: en `POST /ordenes/api-key/cotizacion`, las filas sin precio salen de `filas` y viajan en `errores` (y cada fila cotizada dice sobre qué monto se cotizó)

**Rompe si buscabas los fallos dentro de `filas`.** El mismo reparto que se le hizo hoy a
`POST /ordenes/api-key/carga`, ahora en la cotización: `filas` trae **solo lo que se cotizó** y una
lista nueva, `errores`, trae **solo lo que no**. El contenido de cada fila fallida no cambia ni una
clave. Y en la misma release, cada fila cotizada gana `montoCobrar`: **el valor sobre el que se
cotizó**.

```diff
 {
   "total": 2, "cotizadas": 1, "conError": 1,
   "filas": [
-    { "fila": 1, "numRemision": "REM-0001", "resultado": "cotizada", "costos": { ... } },
-    { "fila": 2, "numRemision": null, "resultado": "error", "errores": { "distrito": ["distrito no encontrado en el canton"] } }
+    { "fila": 1, "numRemision": "REM-0001", "montoCobrar": "25900.00", "resultado": "cotizada", "costos": { ... } }
   ],
+  "errores": [
+    { "fila": 2, "numRemision": null, "resultado": "error", "errores": { "distrito": ["distrito no encontrado en el canton"] } }
+  ]
 }
```

**Por qué las dos listas.** Igual que en la carga: el caso que hay que atender venía escondido
dentro del caso normal, y para saber si algo había fallado había que recorrer el lote entero
ramificando por `resultado` —o, peor, por la presencia de una clave opcional—. Con dos listas la
pregunta se responde sola: `if (respuesta.errores.length)`. Además `costos` deja de ser opcional en
`filas`: ahí ya no cabe una fila sin precio.

**Por qué `montoCobrar`.** Todo lo demás de la fila se **deriva** de él, y hasta hoy no viajaba de
vuelta. La cotización redondea el `monto_cobrar` al colón —igual que lo redondea la carga, para que
el precio prometido sea el que se cobra—, así que quien manda `11898.81` recibe la comisión de
`11899` y no tenía cómo saberlo: el desglose se leía como si no cuadrara. Ahora la respuesta lo
declara. Vale `"0.00"` cuando la fila no traía monto, que es exactamente la base que usó la comisión
COD, y viene en el mismo string money-safe crudo de escala 2 que el resto de los importes.

**Qué hacer.** Donde filtrabas `filas.filter(f => f.resultado === "error")`, leé `errores`
directamente: ese filtro **ya no devuelve nada nunca**, ni siquiera con filas fallidas — es un
silencio, no un error. Y si tu cliente valida en estricto, admití el campo nuevo `montoCobrar`.

**Lo que NO cambia:** los contadores. `total`, `cotizadas` y `conError` siguen contando sobre el lote
**completo**; `cotizadas` es siempre `filas.length` y `conError` siempre `errores.length`. Los dos
escenarios (`entregado`, `devuelto`) conservan sus importes concepto por concepto, el `409` conserva
su criterio (ninguna fila que llega a resolver tarifa la resuelve) y la respuesta sigue sin traer
bloque de totales del lote.

---

## 2026-08-31 — RUPTURA: se retira `GET /ordenes/api-key/{num_guia}` (usá `GET /ordenes/api-key/orden/{id}`)

**Rompe si consultabas el detalle por guía en esa URL.** El endpoint deja de existir: a partir de
esta release responde `404`, como cualquier ruta que el canal no publica.

**Reemplazo, uno a uno:** `GET /api/ordenes/api-key/orden/{id}`. Devuelve **el mismo cuerpo**
(idéntico schema `OrdenDetalle`: mismos nueve campos de la orden y el mismo array `evidencias` con
URLs firmadas de 5 min), los mismos `401`/`403`/`404`/`422`, y el mismo 404 uniforme para una orden
ajena o inexistente. La migración es cambiar la URL:

```diff
- GET /api/ordenes/api-key/100234
+ GET /api/ordenes/api-key/orden/100234
```

**Por qué se retira.** `/orden/{id}` acepta como identificador el `num_guia` **o** el
`num_remision`, así que el endpoint viejo era un segundo camino al mismo recurso que solo sabía
hacer la mitad. Y la mitad que le faltaba es la que más importa desde fulfillment: una orden que
nace en `en_preparacion` **no tiene guía todavía** (`numGuia: null`), y por la URL vieja era
inalcanzable durante toda esa ventana. Mantener dos rutas para un mismo detalle obligaba además a
publicar, probar y versionar dos veces lo mismo.

**Lo que NO cambia:** `PUT /api/ordenes/api-key/{num_guia}/cancelar` sigue igual, con la guía en el
path. El listado `GET /api/ordenes/api-key` sigue aceptando los filtros `num_guia` y `num_remision`.

---

## 2026-08-31 — RUPTURA: `POST /ordenes/api-key/cotizacion` ya no devuelve el bloque `totales`

**Rompe si leías `totales`.** La respuesta sigue trayendo `total`, `cotizadas`, `conError` y el
array `filas` con los dos escenarios de cada fila, exactamente igual que antes. Lo que desaparece
es el objeto `totales` del lote:

```diff
 {
   "total": 3, "cotizadas": 3, "conError": 0,
-  "totales": { "filasSumadas": 3, "filasExcluidas": 0, "entregado": { ... }, "devuelto": { ... } },
   "filas": [ ... ]
 }
```

**Por qué se retira.** Ese bloque sumaba TODAS las filas cotizadas en el escenario `entregado` y,
en paralelo, TODAS en el `devuelto`. Son dos compilados bajo dos premisas imposibles: «este lote se
entrega al 100%» y «este lote se rechaza al 100%». Ningún lote real es ninguna de las dos, así que
ninguno de los dos números es el costo del lote — y se leían justamente como eso. Lo que este
endpoint sabe y publica es el precio **por orden**.

**Qué hacer.** Si mostrabas `totales.entregado.total` o `totales.devuelto.total`, agregá vos los
importes de las filas con `resultado: "cotizada"`, aplicando la tasa de entrega que de verdad
esperás para tu operación. Los contadores `cotizadas` y `conError` sustituyen a `filasSumadas` y
`filasExcluidas` uno a uno: valen lo mismo. Los importes de cada fila son los **crudos** de la
entrada del 2026-08-28, aquí abajo: esta retirada no toca la forma de ningún valor.

---

## 2026-08-31 — RUPTURA: en `POST /ordenes/api-key/carga`, las filas con error salen de `filas` y viajan en `errores`

**Rompe si buscabas los fallos dentro de `filas`.** La respuesta se parte en dos listas: `filas`
trae **solo lo que entró** (`creada` y `duplicada`) y una lista nueva, `errores`, trae **solo lo que
falló**. El contenido de cada fila fallida no cambia ni una clave:

```diff
 {
   "total": 2, "creadas": 1, "duplicadas": 0, "conError": 1,
   "filas": [
     { "fila": 1, "numRemision": "REM-0001", "resultado": "creada", "estatus": "por_recolectar_en_tienda", "numGuia": 100234 },
-    { "fila": 2, "numRemision": "REM-0002", "resultado": "error", "errores": { "telefono": ["requerido"] } }
   ],
+  "errores": [
+    { "fila": 2, "numRemision": "REM-0002", "resultado": "error", "errores": { "telefono": ["requerido"] } }
+  ],
   "ordenes": [ ... ]
 }
```

**Por qué.** Hasta hoy el caso que hay que atender venía escondido dentro del caso normal: para
saber si algo había fallado, había que recorrer el lote entero y ramificar por `resultado` —o, peor,
por la presencia de una clave opcional— antes de poder hacer nada. Con dos listas, la pregunta se
responde sola: `if (respuesta.errores.length)`.

**Qué hacer.** Donde filtrabas `filas.filter(f => f.resultado === "error")`, leé `errores`
directamente. Ese filtro **ya no devuelve nada nunca**, ni siquiera con filas fallidas: es un
silencio, no un error, así que revisalo aunque tu integración no se haya roto en voz alta.

**Lo que NO cambia:** los contadores. `total`, `creadas`, `duplicadas` y `conError` siguen contando
sobre el lote **completo**, y `conError` es siempre `errores.length`. `ordenes`, `cargaId`,
`etiquetasPdf` y `manifiesto` siguen igual, y `filas` conserva el orden y la forma de siempre para
las filas que sí entraron. La cotización (`POST /ordenes/api-key/cotizacion`) recibió **el mismo
reparto** en la misma fecha —ver la entrada de arriba—: esta entrada decía al publicarse que allí no
cambiaba nada, y esa frase quedó desactualizada el mismo día.

---

## 2026-08-31 — NUEVO value en el webhook `orden.estado_actualizado`: `en_preparacion`

**Aditivo: no rompe nada, pero llega un `estado` que antes no llegaba.** Ningún evento que hoy
recibís deja de emitirse, y ningún campo cambia de forma. Lo que cambia es que empieza a llegar un
evento donde antes había silencio.

**Qué resuelve.** Cuando cargás una orden, el estado inicial depende del destino. Dos de las tres
ramas ya te avisaban al nacer la orden:

- recogida en tienda → nace en `por_recolectar_en_tienda`, que ya era evento público;
- resto → nace en `en_ruta_bodega_central`, que ya era evento público;
- **fulfillment** (el paquete ya está en nuestra bodega) → nace en `en_preparacion`, y **no te
  llegaba nada** hasta que la orden avanzaba a `en_bodega_central` al emitirse la guía. Ese hueco
  podía durar horas, y desde fuera se lee igual que «la orden no se creó».

Desde esta entrada, esa tercera rama también avisa.

```json
{
  "evento": "orden.estado_actualizado",
  "data": {
    "numGuia": null,
    "numRemision": "REM-0002",
    "estado": "en_preparacion",
    "motivo": null
  }
}
```

**Dos detalles que importan si tu código asume cosas:**

1. **`numGuia` viaja en `null`.** En la rama de fulfillment la guía se emite más tarde y nunca se
   fabrica un número. El campo ya estaba declarado como `integer | null` en el contrato, así que
   esto no es un cambio de forma — pero si tu handler daba por hecho «si llega evento, hay guía»,
   revisalo. La guía te llega en el evento siguiente, `en_bodega_central`.
2. **Es un evento de NACIMIENTO y llega una sola vez por orden.** No existe ninguna transición
   *hacia* `en_preparacion`: es estado inicial y nada más, así que no vas a ver reingresos con este
   value.

**Qué NO cambia.** Los estados internos de ruteo satélite (`por_recoger`, `en_ruta_bodega_satelite`,
`en_bodega_satelite`) siguen sin viajar nunca en un evento, y `devolucion_por_confirmar` tampoco.

**Si no querés hacer nada:** el contrato siempre pidió tratar un `estado` desconocido como
«ignorar», no como error. Si lo cumplís, no necesitás tocar código.

---

## 2026-08-31 — `GET /ordenes/api-key/analitica`: los tres parámetros pasan a ser opcionales, y se retira el tope de 366 días

**Aditivo: no rompe nada.** Toda llamada que hoy funciona sigue devolviendo exactamente lo mismo.
Lo que cambia es que ahora hay llamadas *más cortas* que antes eran un `422`.

**`GET /api/ordenes/api-key/analitica` sin ningún parámetro es una llamada válida** y devuelve
todas las métricas publicables sobre todo el histórico:

```
GET /api/ordenes/api-key/analitica
Authorization: Bearer ordx_...
```

**Qué significa cada ausencia:**

| Parámetro | Si no lo mandás (o lo mandás vacío) |
| --- | --- |
| `metricas` | Todas las publicables — el mismo resultado que `metricas=all`, que **no** se retira |
| `desde` | La serie arranca en el primer día del que hay datos |
| `hasta` | La serie llega hasta hoy (hora de Costa Rica) |

`desde` es inclusivo (`>=`) y `hasta` es inclusivo (`<=`), igual que antes.

**Se retira el tope de ventana de 366 días.** Ya podés pedir el histórico completo en una sola
llamada. Era la contradicción del cambio de arriba: pasado un año de operación, la llamada sin
fechas habría respondido `422` contra su propio caso base.

**Lo que NO cambió, y conviene no darlo por relajado:**

- Un hueco **dentro** de la lista sigue siendo `422`: `metricas=entregas,,rechazos`. El parámetro
  entero vacío es «no pedí ninguna»; un vacío en medio es una lista mal escrita.
- `all` mezclado con ids sigue siendo `422`: `metricas=all,entregas`.
- El **rango invertido** sigue siendo `422` (`desde` posterior a `hasta`).
- Una fecha que el calendario no tiene sigue siendo `422` (`desde=2026-02-31`).
- `data` sigue **omitiendo** los días que no se pueden leer —el día en curso y los anteriores a
  nuestro horizonte de histórico— y `data: []` sigue siendo un `200` correcto. **No rellenes los
  huecos con ceros.**

**Si pedís el histórico completo, contá con series largas.** Sin `desde`, `data` crece un punto
por día de operación; este endpoint no pagina.

---

## 2026-08-28 — ROMPEDOR: los importes de la cotización pasan a viajar CRUDOS

**Esto SÍ puede romper tu integración** si consumes `POST /api/ordenes/api-key/cotizacion`. No
cambia ningún nombre de campo, ni se añade ni se quita ninguno: cambia la **forma del valor**.

Antes cada importe llegaba formateado, con símbolo de moneda, miles agrupados y coma decimal:

```json
{ "flete": "₡2.500,00", "total": "-₡1.578,00" }
```

Ahora llega crudo, como un string *money-safe* de escala 2 —sin símbolo, sin separador de miles y
con el punto como separador decimal:

```json
{ "flete": "2500.00", "total": "-1578.00" }
```

Afecta a **todos** los importes de la respuesta, en los dos escenarios (`entregado` y `devuelto`)
y también dentro del bloque `totales`: `flete`, `iva`, `comision`, `ivaComision`, `fulfillment` y
`total`. Lo que **no** cambia: siguen siendo strings (nunca números JSON), siguen llevando
exactamente dos decimales, el cero sigue siendo explícito (`"0.00"`, nunca ausente ni `null`) y el
negativo sigue marcándose con un `-` al principio.

**Qué tienes que hacer.** Si parseabas quitando el símbolo y dando la vuelta a los separadores,
borra ese paso: el valor ya es un número en texto y `parseFloat`/`Decimal` lo aceptan tal cual.
Ojo con lo contrario —dejar el parser viejo puesto—: `"2500.00"` pasado por una limpieza que
esperaba miles con punto **no falla**, devuelve `2.5`. Es un error silencioso, así que revísalo
aunque tu integración parezca seguir funcionando.

**Por qué.** El canal hablaba dos dialectos de dinero: `POST /api/ordenes/api-key/carga` ya
devolvía `costoEnvio` crudo mientras la cotización devolvía lo mismo formateado, y eso obligaba a
mantener dos parsers para la misma moneda. Ahora los dos endpoints dicen el dinero igual. La
moneda no ha cambiado; solo dejó de viajar dentro del campo.

---

## 2026-08-28 — NUEVO: `DELETE /ordenes/api-key/orden/{id}` — eliminar una orden que aún no se gestionó

**Aditivo: no rompe nada.** Es un verbo nuevo sobre una URL que ya existía. Si no lo llamás, tu
integración no cambia en absoluto.

**Qué resuelve.** Entre que cargás una orden y que el paquete llega a la bodega central no tenías
ninguna salida: cancelar (`PUT .../{numGuia}/cancelar`) exige que la orden ya esté en
`en_bodega_central` o `en_ruta_bodega_central` —y se pide por número de guía, que con fulfillment
todavía no existe—. Ese hueco es lo que cierra este endpoint.

```
DELETE /api/ordenes/api-key/orden/{id}
Authorization: Bearer ordx_...

200 OK
{ "numGuia": 100234, "numRemision": "REM-0001", "estado": "en_bodega_central" }
```

**El identificador es el mismo del `GET`**: `num_guia` **o** `num_remision`, con la misma
precedencia (si es un entero positivo se busca primero por guía). Lo habitual aquí es la remisión,
porque una orden recién cargada puede no tener guía todavía; en ese caso la respuesta trae
`"numGuia": null`.

**Cuándo procede.** Solo en estos cuatro estados, es decir mientras el paquete sigue quieto en tu
tienda o en la bodega central y nadie lo ha movido hacia el cliente ni hacia otra bodega:

- `en_preparacion`
- `por_recolectar_en_tienda`
- `recolectando`
- `en_bodega_central`

**Haber generado la etiqueta NO impide eliminar.** Imprimir la guía deja la orden en
`en_bodega_central`, que está en la lista.

**Qué devuelve cada caso:**

| Situación | Código |
|---|---|
| Eliminada | `200` con `{ numGuia, numRemision, estado }` |
| No existe, ya la eliminaste, o es de otro integrador | `404` (el mismo en los tres) |
| Existe y es tuya, pero ya se gestionó (`en_reparto`, entregada, devuelta…) | `409` |
| `{id}` vacío o de más de 128 caracteres | `422` |

**Tres cosas que conviene saber:**

1. **Es un borrado lógico.** La orden desaparece del canal —un `GET` posterior a la misma URL
   devuelve `404`— y deja de aparecer en el listado. No se pierde el historial interno del envío.
2. **Libera tu `num_remision`.** La remisión es única *entre tus órdenes vivas*, así que después de
   eliminar podés volver a cargar la misma remisión. Antes de esto, una remisión gastada por error
   quedaba ocupada.
3. **Repetir el `DELETE` no es un error de servidor:** devuelve `404`, igual que cualquier orden
   que ya no está.

**Para una orden que ya va camino del cliente esto no sirve** — ahí la salida sigue siendo
`PUT /ordenes/api-key/{numGuia}/cancelar`, que no la borra: la manda de vuelta a tu tienda.

---

## 2026-08-25 — ROMPEDOR: desaparece el campo `generado` de las respuestas de `/generate`

**Esto SÍ puede romper tu integración.** Es el único cambio de esta tanda que quita algo del
contrato, y por eso va con aviso destacado.

Los dos endpoints de PDF de etiquetas:

- `POST /ordenes/api-key/orden/{id}/generate`
- `POST /ordenes/api-key/carga/{cargaId}/generate`

dejan de devolver el booleano `generado`. La respuesta pasa de tres claves a dos:

```json
// ANTES
{ "url": "https://...", "expiraEnSegundos": 300, "generado": true }
// AHORA
{ "url": "https://...", "expiraEnSegundos": 300 }
```

**Por qué se retira.** `generado` contaba si el PDF se había construido en esa llamada o si se
reutilizó el que ya estaba almacenado. Eso describe **nuestro estado interno de almacenamiento**,
no algo sobre lo que vos pudieras decidir: en los dos casos recibís exactamente lo mismo —una URL
firmada del mismo documento, con el mismo TTL— y la acción correcta es siempre la misma,
descargarla. Un campo que no habilita ninguna decisión del cliente pero sí filtra cómo tenemos
organizado el bucket es un campo que sobra.

**El comportamiento NO cambia.** El reuso sigue funcionando igual: la primera llamada construye el
PDF y las siguientes solo lo vuelven a firmar. Lo que se retira es *contarlo*, no *hacerlo*. La
`url` sigue cambiando en cada llamada (se firma de nuevo cada vez) aunque el PDF sea el mismo.

**Qué tenés que revisar, por orden de probabilidad de que te afecte:**

1. **Validación estricta de esquema.** Si generaste un cliente desde el OpenAPI con
   `additionalProperties: false` o con `generado` como requerido, la respuesta nueva te va a
   fallar la validación. Regenerá el cliente contra el contrato actualizado.
2. **Lecturas directas del campo.** Cualquier `if (res.generado)` pasa a leer `undefined`, que es
   *falsy*. Si tenías una rama que solo corría cuando `generado === true`, deja de correr en
   silencio; y una que corría con `false` pasa a correr siempre. Revisá los dos sentidos.
3. **Logs y métricas.** Si contabas construcciones vs. reusos con este campo, ya no podés. No hay
   sustituto en el contrato: es justamente el dato que se decidió no publicar.

Si no tocás `generado` en ningún sitio, no tenés que hacer nada.

---

## 2026-08-25 — `num_remision` pasa a ser único POR TIENDA (antes era único global)

**Qué cambia para vos: menos filas `duplicada`, ninguna nueva.** Este cambio solo RELAJA una
restricción; nada que hoy te funciona deja de funcionar.

`num_remision` no lo generamos nosotros: lo traés vos desde tu propio sistema. Hasta hoy ese
número tenía que ser único en TODO Ordenex, no solo en tu cuenta. La consecuencia era que si otra
tienda —una con la que no tenés ninguna relación— ya había cargado el número `1001`, tu fila con
`num_remision: "1001"` volvía como `duplicada` y no se creaba. Nunca fue lo que queríamos: es tu
numeración, y no tiene por qué coordinarse con la de nadie.

Desde ahora la identidad de una remisión es el par **(tu cuenta, número)**:

- `POST /ordenes/api-key/carga` — una fila se clasifica `duplicada` **solo** si vos ya cargaste ese
  `num_remision` antes. Si el único que existe es de otra tienda, tu fila se crea normalmente.
- `GET /ordenes/api-key/orden/{id}` y `POST /ordenes/api-key/orden/{id}/generate` — sin cambios.
  Estos endpoints ya resolvían el identificador **dentro de tu cuenta**, así que siguen devolviendo
  exactamente tu orden.

**Qué NO cambia, y conviene decirlo:**

- **`num_guia` sigue siendo único en todo Ordenex.** Ese número sí lo generamos nosotros, es el que
  va impreso en la etiqueta, y lo leen la bodega y el mensajero sin saber de qué tienda viene:
  tiene que ser único a nivel de sistema. No lo elegís vos y no cambia de significado.
- **Dentro de tu cuenta, `num_remision` sigue sin poder repetirse**, incluidas las órdenes
  anuladas. Reusar un número tuyo sigue dando `duplicada`.

No hay que cambiar nada en tu integración. Si tenías una lógica de reintento que renumeraba las
filas rechazadas como `duplicada`, ahora se va a disparar bastante menos.

---

## 2026-08-25 — fulfillment: se cobra en la cotizacion y cambia donde nace la orden

Este cambio afecta **solo a las tiendas con fulfillment** — las que tienen un monto de fulfillment
configurado en su tarifa, porque sus paquetes ya estan en nuestra bodega. Si tu tarifa no lo tiene,
la unica diferencia que veras es un campo nuevo con valor `"0.00"`, y ningun importe se mueve.

### 1. `POST /ordenes/api-key/cotizacion` — un sexto concepto: `fulfillment`

Los dos escenarios de cada fila (`entregado` y `devuelto`), y el bloque `totales` del lote, traen un
concepto nuevo:

```json
"entregado": { "flete": "₡2.500,00", "iva": "₡325,00", "comision": "₡906,50",
               "ivaComision": "₡117,85", "fulfillment": "₡1.000,00", "total": "₡21.050,65" },
"devuelto":  { "flete": "₡1.396,46", "iva": "₡181,54", "comision": "₡0,00",
               "fulfillment": "₡1.000,00", "total": "-₡2.578,00" }
```

Tres cosas que conviene leer antes de tocar tu integracion:

- **Entra en los dos `total`.** `entregado.total` (lo que recibis) baja por ese monto y
  `devuelto.total` (lo que debes) sube. Si vos recalculabas el total sumando los conceptos, ahora
  tenes que sumar uno mas.
- **Se cobra tambien en la devolucion**, a diferencia de la comision COD. Preparar y despachar el
  paquete ya costo, lo reciba el destinatario o no.
- **Nunca falta y nunca es `null`.** Sin fulfillment vale cero formateado, igual que `comision` en el
  escenario devuelto. Los cuatro conceptos que ya existian no cambian ni un centimo.

### 2. `POST /ordenes/api-key/carga` — `costoEnvio` crece, y aparece su desglose

Cada orden del bloque `ordenes` trae un campo nuevo, `fulfillment`, y **`costoEnvio` pasa a
incluirlo**: antes era flete + IVA del flete, ahora es flete + IVA + fulfillment.

```json
{ "id": "...", "numRemision": "REM-0001", "numGuia": null, "estado": "en_preparacion",
  "costoEnvio": "5.92", "fulfillment": "2.00" }
```

**Si tu tarifa no tiene fulfillment, `costoEnvio` vale exactamente lo que valia ayer** y el campo
nuevo es `"0.00"`. Si la tiene, el numero es mayor: revisalo si lo contabilizas.

### 3. Con fulfillment, tus ordenes nacen en `en_preparacion` y sin guia

Es el cambio con mas consecuencias, y solo aplica a tiendas con fulfillment:

- **`estado` = `en_preparacion`** en vez de `por_recolectar_en_tienda`. El paquete ya esta en la
  bodega: no hay nada que recolectar en tu local.
- **`numGuia` = `null`.** La guia se emite despues, cuando la orden se prepara. Nunca se fabrica un
  numero. Si tu codigo asume que toda orden creada trae un entero en `numGuia`, **esto lo rompe**:
  el campo ya declara `integer | null` en el contrato.
- **Ese lote no trae `manifiesto`.** No hay entrega de bultos que firmar.

El monto se resuelve **por orden**, con la tarifa de su par (tienda, zona), asi que un lote puede
traer ordenes de las dos clases. Cada fila dice en que estado nacio; no lo deduzcas del lote.

---

## 2026-08-23 — endpoint nuevo: habilitar pedidos con novedad, por lote

Cambio **aditivo**: nada de lo que hoy funciona deja de funcionar. Aparece un endpoint nuevo en el
canal, y ninguno de los ocho anteriores cambia de forma.

### `POST /api/ordenes/api-key/habilitar`

Habilita, en lote, pedidos que quedaron con una novedad. Cuerpo:

```json
{
  "ordenes": [
    { "num_guia": 100234, "nota": "el cliente pidió reintento mañana" },
    { "num_guia": 100235, "nota": "dirección corregida por el call center" }
  ]
}
```

`nota` es **obligatoria** (1 a 200 caracteres, se recorta). El lote acepta **entre 1 y 100 filas**.

Respuesta **200** con un resultado por fila —en el mismo orden y la misma cantidad que enviaste, así
que podés casar por índice— y un `resumen`. Cada fila trae uno de estos tres `resultado`:

- `habilitada` — la orden volvió a `en_reparto`.
- `habilitada_sin_cambio_de_estado` — se registró la habilitación y el estado **no** cambió.
- `error` — la fila no se procesó; el porqué va en `error.codigo`, que es un conjunto cerrado de
  cuatro: `fila_invalida`, `duplicada_en_lote`, `no_encontrada`, `estado_no_habilitable`.

### Tres cosas que conviene leer antes de integrar

1. **Solo dos estados son habilitables: `ayuda_tienda` y `devuelta`.** Ningún otro. En particular
   `reprogramada` **no** lo es y devuelve `estado_no_habilitable`, igual que `rechazada`,
   `incidente` y `sin_gestionar`.
2. **Una orden `devuelta` nunca cambia de estado.** Siempre responde
   `habilitada_sin_cambio_de_estado`, y no es una degradación: su paquete ya volvió a la bodega, así
   que no hay nadie en la calle a quien devolvérselo. En la práctica, de los dos estados
   habilitables **solo `ayuda_tienda`** (y solo si conserva mensajero asignado) puede producir
   `habilitada`.
3. **200 aunque todas las filas fallen.** Los únicos 4xx globales son 401, 403 y el 422 del
   envoltorio (cuerpo que no es JSON, sin `ordenes`, lote vacío o de más de 100 filas). Una fila mal
   formada **no** tira el lote: se marca `fila_invalida` y las demás siguen.

### Webhook

La fila que vuelve a `en_reparto` emite el evento de siempre, `orden.estado_actualizado` con
`data.estado = "en_reparto"`. **La habilitación sin cambio de estado no emite ningún evento** y no
existe ningún evento nuevo: si necesitás enterarte de esas, hoy la única fuente es la respuesta
síncrona de esta llamada.

### Repetir la llamada

Habilitar dos veces la misma orden devuelve `estado_no_habilitable` en la segunda —ya está en
`en_reparto`, que no es habilitable— y no escribe nada. No devolvemos un acuse `habilitada` falso.

---

## 2026-08-22 — el webhook avisa del ciclo de AYUDA y del INCIDENTE


Este aviso cubre los cambios que entran en la próxima release del canal por API key. Todos son
**aditivos**: nada de lo que hoy funciona deja de funcionar. El contrato completo y vigente está en
`docs/api/api-key-openapi.yaml` (y su espejo ejecutable en `lib/api/openapi-spec.ts`).

### 1. Dos values nuevos en `data.estado`

El webhook empieza a emitir dos estados que antes nunca viajaban:

- **`ayuda_tienda`** — la orden entra en el ciclo de ayuda: el mensajero no puede continuar y la
  tienda tiene que intervenir.
- **`incidente`** — la orden sufrió un incidente en manos del mensajero.

`data.estado` pasa además a publicarse **con `enum` explícito** en el contrato: son los 12 values
que este webhook puede entregar de verdad, un subconjunto del catálogo de `OrdenListItem.estado`.
Los estados internos de preparación y ruteo satélite (`en_preparacion`, `por_recoger`,
`en_bodega_satelite`, `en_ruta_bodega_satelite`) no viajan nunca.

> La lista puede **crecer de forma aditiva** en el futuro, siempre con aviso previo. Tratá un value
> desconocido como «ignorar», nunca como error.

### 2. `en_reparto` puede llegar dos veces sobre la misma orden

Cuando una orden sale del ciclo de ayuda y vuelve a reparto, se emite `en_reparto` de nuevo. Un
integrador puede por tanto recibir ese estado **dos veces** sobre la misma guía.

No es un duplicado que haya que descartar a ciegas: son dos cambios de estado reales, con
`eventoId` distinto. **Deduplicá por `eventoId`**, que es determinista para un mismo cambio de
estado (`webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAt>`) y que ya es la regla vigente
para los reintentos.

### 3. El evento de `incidente` trae la causa tipificada

El campo `data.motivo` —que hasta ahora sólo llevaba causa en las devoluciones— pasa a transportar
**dos enums distintos**, y cuál aplica lo decide `data.estado`:

| `estado` | valores posibles de `motivo` |
| --- | --- |
| `devuelta` | `not_found`, `wrong_number`, `wrong_address` (en inglés) |
| `incidente` | `danado`, `perdido`, `robado` (en español, `danado` sin eñe) |
| cualquier otro | siempre `null` |

⚠️ **La asimetría de idioma es deliberada**, no un error: cada enum se publica con el value crudo de
su catálogo interno, y renombrar cualquiera de los dos rompería a quien ya lo consume. No se va a
«armonizar» más adelante.

`motivo` sigue **presente siempre** (viaja como `null` cuando no aplica, nunca omitido), y es
`null` también en un `incidente` sin causa registrada. El contrato no distingue «no hubo causa» de
«no se registró».

### 4. El evento de `incidente` trae `evidenciasUrl`

`data` gana una **quinta clave, opcional**: `evidenciasUrl`. Viaja **sólo** en los eventos con
`estado: "incidente"` y se **omite** —no viaja como `null`— en cualquier otro caso. Ramificá por
«la clave existe», no por su valor.

Es un enlace al detalle de la orden en el canal por API key
(`GET /api/ordenes/api-key/orden/{id}`):

- **estable y determinista**: sin token, sin expiración, no caduca; dos entregas del mismo
  `eventoId` llevan exactamente el mismo valor;
- **no lleva credencial**: no podés abrirlo sin autenticarte. Invocalo con tu propio
  `Authorization: Bearer ordx_...`, igual que cualquier otra llamada al canal.

El detalle te devuelve las URLs **firmadas y frescas** de las fotos, con su TTL corto. La credencial
la ponés vos; el cuerpo del webhook nunca la transporta.

Como parte del mismo cambio, el array `evidencias[]` del detalle por API key pasa a **incluir las
evidencias con `resultado: "incidente"`**, que antes no aparecían.

### Ejemplo — evento de incidente

Es el ejemplo publicado en el contrato, palabra por palabra (`docs/api/api-key-openapi.yaml`,
`webhooks → orden.estado_actualizado → examples → incidente`):

```json
{
  "evento": "orden.estado_actualizado",
  "eventoId": "webhook_estado:018f2c31-0000-4000-8000-000000000002:21:2026-08-22T14:30:00.000Z",
  "ocurridoAt": "2026-08-22T14:30:00.000Z",
  "data": {
    "numGuia": 100235,
    "numRemision": "REM-0002",
    "estado": "incidente",
    "motivo": "robado",
    "evidenciasUrl": "https://app.ordenex.co/api/ordenes/api-key/orden/018f2c31-0000-4000-8000-000000000002"
  }
}
```

### Qué NO cambia

- La firma de las entregas: `X-Ordenex-Timestamp` y `X-Ordenex-Signature`
  (`sha256=<hex>`, HMAC-SHA256 sobre `${timestamp}.${cuerpo}`). Verificala sobre el texto crudo
  **antes** de parsear.
- Las cuatro claves `numGuia`, `numRemision`, `estado` y `motivo` siguen presentes siempre.
- El nombre del evento (`orden.estado_actualizado`) y la regla de respuesta: 2xx confirma, cualquier
  otra cosa se trata como fallo transitorio y se reintenta.
