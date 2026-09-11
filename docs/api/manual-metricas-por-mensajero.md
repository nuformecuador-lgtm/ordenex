# Medir la operación por mensajero y por zona

> Para integradores del canal por API key. Publicado el **2026-09-10**.
>
> Cubre los campos que se añadieron ese día: `mensajero` (webhook, listado y detalle),
> `gestiones[]` (detalle), el arreglo del `evidenciasUrl` del webhook y —desde la actualización de
> esa misma fecha— **`zona`, `costoEstimado` y `costoReal`** en el listado y en el detalle.
>
> Este documento explica **cómo usarlos**. El detalle exacto de cada cambio está en
> [`CHANGELOG.md`](./CHANGELOG.md), y el contrato vigente en
> [`api-key-openapi.yaml`](./api-key-openapi.yaml) y en `/api-docs`. Si este documento y el
> contrato se contradicen, **manda el contrato**.

---

## Lo primero: no hay endpoints nuevos

**No tenés que apuntar a ninguna ruta nueva ni cambiar tu autenticación.** Los datos viajan dentro
de las respuestas que ya recibís hoy:

| Dónde | Qué gana |
|---|---|
| Webhook `orden.estado_actualizado` | `data.mensajero` |
| `GET /api/ordenes/api-key` (listado) | `mensajero`, **`zona`, `costoEstimado` y `costoReal`** en cada ítem |
| `GET /api/ordenes/api-key/orden/{id}` (detalle) | lo mismo del ítem **más** `gestiones[]` |

⚠️ **El webhook NO gana ni la zona ni el costo.** Su cuerpo va firmado y el orden de sus claves es
parte de esa firma; meter dinero ahí es otra decisión, con su propio aviso. Si necesitás la zona o
el costo de una orden que te llegó por webhook, pedila por el detalle con su `numGuia`.

Todo es **aditivo**: ningún campo se retira ni se renombra, ningún path cambia, ningún código de
estado cambia.

⚠️ **La única forma de que esto te rompa** es que valides el esquema en estricto
(`additionalProperties: false`, un DTO generado que rechace claves desconocidas). Si es tu caso,
regenerá tu modelo contra el contrato actualizado **antes** de leer nada más.

## Autenticación, sin cambios

```
Authorization: Bearer ordx_...
```

La misma key de siempre. Solo ves las órdenes cuya tienda es la dueña de tu key: una guía o
remisión ajena responde **404**, igual que una que no existe.

---

## Caso 1 — Tasa de entrega, novedades y devoluciones por mensajero

**Fuente recomendada: el webhook.** Cada cambio de estado te llega ya con quién llevaba la orden en
ese momento, así que no necesitás consultar nada después.

```json
"data": {
  "numGuia": 100235,
  "numRemision": "REM-0002",
  "estado": "entregada",
  "motivo": null,
  "mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" }
}
```

Acumulá por `data.mensajero.id` y por `data.estado`.

> **Corrección del 2026-09-10, y su desenlace.** Una versión anterior de este documento decía que
> la zona se podía cruzar con el listado. **Cuando se escribió, era falso**: el ítem no publicaba
> ninguna zona, y así se corrigió aquí mismo ese día.
>
> **Desde la actualización del 2026-09-10 esa instrucción original ES CIERTA**: el ítem del listado
> y el detalle publican `zona`, así que la medición por zona ya se puede hacer, y se hace cruzando
> por `zona.id`. Se deja escrito el recorrido entero —y no solo el resultado— porque quien leyó la
> corrección tiene que poder saber que ya no aplica.
>
> El ítem lleva hoy trece claves: `numGuia`, `numRemision`, `estado`, `destinatario`,
> `telefonoDest`, `producto`, `direccion`, `montoCobrar`, `createdAt`, `mensajero`, `zona`,
> `costoEstimado` y `costoReal`.

**Tres reglas que evitan una serie histórica rota:**

1. **Agrupá por `id`, nunca por `nombre` — y esto vale para las DOS entidades con nombre del
   payload, `mensajero` y `zona`.** El `id` es un UUID en texto —no un entero— estable, y no se
   reasigna jamás a otra persona ni a otra zona. El nombre es un texto para mostrar y puede
   corregirse: agrupar por él te partiría la serie en dos el día que alguien arregle una tilde, o
   el día que «FGAM El Coco» pase a llamarse «FGAM Coco». Una sola regla para los dos campos, a
   propósito: tienen la misma forma `{ id, nombre }` para que no tengas que recordar cuál es cuál.
2. **`mensajero: null` significa «todavía nadie la lleva»**, no «no se sabe». La clave **viaja
   siempre**: ramificá por su valor, no por si la clave existe.
3. **Es quién la LLEVA, no quién la entregó.** Hay flujos que limpian la asignación (generar guía,
   quitar mensajero, devolución a bodega, liberar una reprogramada, el barrido del cierre diario).
   En la práctica: una orden **entregada o devuelta conserva** su mensajero —así que esta métrica
   funciona—, pero una orden vieja barrida por el cierre puede aparecer con `null` aunque alguien
   la llevara.

**Si preferís el listado en vez del webhook** (`GET /api/ordenes/api-key`), tenés el mismo campo en
cada ítem. Pero ojo: te da la foto de **ahora**, no la de cada momento. Para un censo diario está
bien; para una serie temporal, el webhook es la fuente correcta.

**No se puede filtrar ni ordenar el listado por mensajero.** No hay parámetro de query para eso, y
un `?mensajero=...` se ignora como cualquier clave desconocida. Agrupá del lado tuyo.

---

## Caso 2 — Reintentos y tiempos por mensajero

Para esto necesitás el **detalle**, que ahora incluye la lista completa de desenlaces registrados
sobre la orden, del más antiguo al más reciente:

```
GET /api/ordenes/api-key/orden/{id}
```

donde `{id}` es el **número de guía** o el **número de remisión**.

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

- **Tiempos**: restá los `createdAt` consecutivos, o el primero contra la fecha de creación de la
  orden. Vienen en UTC con formato ISO.
- **Reintentos**: contá elementos —leyendo antes la advertencia de abajo.
- La clave **viaja siempre**; una orden sin gestionar trae `"gestiones": []`, nunca `null`.
- Las **cinco** claves de cada elemento están siempre presentes, con `null` donde no aplica.
- Llega **completo y sin paginar**. Sobre datos reales el máximo en una orden son 5 y el promedio
  1,4, así que el cuerpo crece unos cientos de bytes en el peor caso.

### Cuatro advertencias que cambian tus números

**1. `gestiones.length` NO es el contador de intentos de entrega.** El nuestro cuenta cierres
aprobados distintos con visita real, así que **varias gestiones del mismo cierre valen 1**. Este
array es la lista cruda, sin agrupar: si contás elementos vas a obtener un número **mayor** que el
nuestro. No es el mismo dato y no deberían cuadrar.

**2. `mensajero` es el ATRIBUIDO, y no siempre es quien la registró.** Algunas gestiones las crea el
sistema o la propia tienda —una reprogramación desde el escritorio, el escalado automático por
vencimiento de plazo, un rechazo manual, el desenlace de una solicitud de ayuda, o el corte al
llegar al tope de reintento— y quedan atribuidas al mensajero de la última devolución. En el array
se ven **idénticas** a una visita de calle. Si tu métrica es «tiempo por mensajero», tenelo en
cuenta: no todas las entradas son una visita física de esa persona.

**3. `estadoResultante` no se deduce del `resultado`.** Es el estado en que **esa** gestión dejó la
orden. El caso que más confunde: una gestión `devuelta` deja la orden en `devolucion_por_confirmar`,
**no** en `devuelta` — es la aprobación posterior del cierre la que la mueve. Puede llegar `null` en
gestiones antiguas, y se publica **sin lista cerrada de valores**: tratá un valor desconocido como
texto, no como error.

**4. Qué NO está en el array.** Las gestiones **anuladas** (una anulación deshace el registro, y
contarla inflaría justo la métrica de reintentos) y los **incidentes reportados por bodega** (no son
gestiones, no tienen mensajero atribuido). Las fotos de esos incidentes sí siguen en `evidencias[]`.

---

## `motivo`: es la causa tipificada, no el comentario del mensajero

Lo que recibís es un valor de una lista cerrada:

| En una devolución | En un incidente |
|---|---|
| `not_found` | `danado` (sin eñe) |
| `wrong_number` | `perdido` |
| `wrong_address` | `robado` |

En cualquier otro `resultado` —`entregada`, `reprogramada`, `rechazada`— es `null`. También es
`null` en devoluciones e incidentes **antiguos**, anteriores a que empezáramos a pedir la causa: ese
histórico no se rellenó, y el contrato **no distingue** «no hubo causa» de «no se registró».

**No es** el comentario en texto libre que el mensajero escribe al gestionar la orden. Ese texto
**no sale del sistema** por decisión de privacidad, y no va a salir.

**La asimetría de idioma es deliberada** —las causas de devolución en inglés, las de incidente en
español—: cada una se publicó con el valor crudo de su catálogo y renombrarlas rompería a quien ya
las consume. No escribas código que asuma que van a cambiar, ni que las traduzca por su idioma.

---

## De regalo: el enlace de evidencias del webhook ya funciona

En los eventos con `estado: "incidente"`, `data.evidenciasUrl` **daba 404 siempre**, para cualquier
orden — se construía con un identificador interno que el endpoint no resuelve. No funcionó nunca, y
preferimos decirlo así.

Ahora lleva el `numGuia`, o el `numRemision` si la orden todavía no tiene guía, y se invoca tal cual
con tu propio `Authorization: Bearer ordx_...`:

```
"evidenciasUrl": "https://app.ordenex.co/api/ordenes/api-key/orden/100235"
```

Dos detalles: el segmento va **codificado como componente de ruta** (una remisión `A/B C` viaja como
`A%2FB%20C`), y si el identificador no sobreviviría a la validación del endpoint **el campo se
omite**, para no mandarte un enlace que sabemos que va a fallar.

---

## Caso 3 — Margen por paquete y por zona

Es lo que pediste: **restar de lo que cobrás el costo del envío**, y poder agruparlo por zona. Los
dos datos viajan ahora en el mismo ítem del listado, así que no hace falta ninguna llamada extra.

Un ítem completo, con los trece campos:

```json
{
  "numGuia": 100234,
  "numRemision": "REM-0001",
  "estado": "en_reparto",
  "destinatario": "Ana Solís",
  "telefonoDest": "0991234567",
  "producto": "Caja",
  "direccion": "Calle 1",
  "montoCobrar": 25900,
  "createdAt": "2026-09-07T15:04:00.000Z",
  "mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" },
  "zona": { "id": "018f2c31-0000-4000-8000-00000000za01", "nombre": "GAM" },
  "costoEstimado": { "flete": "2500.00", "iva": "325.00", "comision": "906.50",
                     "ivaComision": "117.85", "fulfillment": "696.00" },
  "costoReal": { "flete": "2500.00", "iva": "325.00", "comision": "906.50",
                 "ivaComision": "117.85", "fulfillment": "692.00" }
}
```

**El margen se calcula así:** sumás los cinco conceptos del costo y los restás de `montoCobrar`.
**No publicamos un campo con esa suma**, y no es un olvido: el único `total` que este canal publica
—el de la cotización— significa lo contrario («lo que recibís vos»), y dos `total` de signo
opuesto es exactamente el error que preferimos no darte.

### Por qué son DOS campos y no uno

| | de dónde sale | ¿se mueve? |
|---|---|---|
| `costoEstimado` | la tarifa **vigente hoy** para tu tienda en la zona de la orden | **sí**, mientras `costoReal` sea `null` |
| `costoReal` | la tarifa **congelada** cuando la orden entró en un cierre aprobado | no (salvo un segundo cierre aprobado) |

No guardamos histórico de tarifas: cuando una cambia, se edita en sitio. Si publicáramos solo el
estimado, **cada ajuste de tarifa te reescribiría hacia atrás la rentabilidad histórica sin que
pudieras enterarte**. Ya pasó, y está medido: el `fulfillment` cambió de 692,00 a 696,00 en 1 de
cada 6 órdenes cerradas. Son 4 colones, pero prueban que la tarifa se mueve.

**La regla práctica:** mientras `costoReal` sea `null`, usá `costoEstimado` y tratalo como una
estimación —no lo archives como definitivo—. Cuando llega `costoReal`, ése es el número que se
congeló al cerrar y ya no cambia: archivá ese.

### Cuándo es `null` cada uno, y qué significa

- **`costoEstimado: null`** → no hay ninguna tarifa configurada para tu tienda en esa zona.
  **No significa que el envío sea gratis.** Deliberadamente no te mandamos cinco ceros: un `0.00`
  ahí sería una cifra falsa servida como precio. Si te aparece, escribinos: es un hueco de
  configuración, no un dato del envío.
- **`costoReal: null`** → esa orden todavía no ha entrado en ningún cierre aprobado. Es lo normal
  en una orden reciente.
- **`costoReal` con los cinco conceptos en `"0.00"`** → esto **sí** es un cero de verdad: esa orden
  se cerró cuando tu tienda no tenía tarifa, y por esos conceptos se liquidó cero. Es distinto de
  `null`, y por eso se dice distinto.

### ⚠️ Los dos son el escenario de ENTREGA

`costoReal` es **lo que se congeló al cerrar**, no «la línea que entró en tu wallet». Los dos
campos responden a la misma pregunta —«¿cuánto cuesta este paquete si se entrega?»— y difieren solo
en qué tarifa los alimenta.

Si la orden terminó **rechazada**, lo que se te factura es el **flete de devolución y su IVA**, que
son conceptos distintos y que **no** son estos importes. Ese escenario lo sirve la cotización
(`POST /api/ordenes/api-key/cotizacion`), en su bloque `devuelto`.

### Lo que no se puede hacer

**No podés filtrar ni ordenar el listado por zona ni por costo.** No hay parámetro de query para
eso: un `?zona=GAM`, un `?zona_id=...` o un `?order_by=costo` se ignoran como cualquier clave
desconocida, y la respuesta sale idéntica a la que saldría sin ellos. Agrupá del lado tuyo, por
`zona.id`.

`zona.id` tampoco sirve como identificador de orden: el `{id}` del detalle solo casa por `numGuia`
o por `numRemision`.

---

## Qué NO se publica de un mensajero

Solo su `id` y su `nombre`. Ningún otro dato personal —teléfono, correo, cédula, foto, zona,
vehículo— sale por este canal.

⚠️ **La palabra «zona» de esa lista es la zona DEL MENSAJERO**: en qué zona trabaja esa persona.
Es un dato suyo y sigue sin publicarse. **No la confundas con el campo `zona` del ítem**, que es
otra cosa: el **destino del paquete**, y ése sí se publica.
