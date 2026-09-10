# Medir la operación por mensajero y por zona

> Para integradores del canal por API key. Publicado el **2026-09-10**.
>
> Cubre los tres campos que se añadieron ese día: `mensajero` (webhook, listado y detalle),
> `gestiones[]` (detalle) y el arreglo del `evidenciasUrl` del webhook.
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
| `GET /api/ordenes/api-key` (listado) | `mensajero` en cada ítem |
| `GET /api/ordenes/api-key/orden/{id}` (detalle) | `mensajero` **y** `gestiones[]` |

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

Acumulá por `data.mensajero.id` y por `data.estado`. Para la zona, cruzá con el `zona` que ya
recibís en el listado.

**Tres reglas que evitan una serie histórica rota:**

1. **Agrupá por `id`, nunca por `nombre`.** El `id` es un UUID en texto —no un entero— estable y
   que no se reasigna jamás a otra persona. El nombre es un texto para mostrar y puede corregirse:
   agrupar por él te partiría la serie en dos el día que alguien arregle una tilde.
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

## Qué NO se publica de un mensajero

Solo su `id` y su `nombre`. Ningún otro dato personal —teléfono, correo, cédula, foto, zona,
vehículo— sale por este canal.
