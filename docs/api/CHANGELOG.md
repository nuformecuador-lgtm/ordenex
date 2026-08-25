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
