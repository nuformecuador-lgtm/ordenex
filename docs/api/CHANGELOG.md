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
`filasExcluidas` uno a uno: valen lo mismo.

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
