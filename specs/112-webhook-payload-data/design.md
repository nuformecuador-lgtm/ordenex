# Feature 112 — Design

## 1. Decisiones (CERRADAS — gate F1.4 aprobado por humano)

- **Clave genérica = `data`.** El recurso de la orden se anida bajo `data`, no
  bajo `orden`. Se descartaron `body` y `response` (ver §4).
- **Se hace ahora.** La 104 recién se mergeó; ningún consumidor externo depende
  del contrato todavía, así que el breaking change es barato.
- **Backend puro, rama separada, sin migración.** No toca base de datos, RLS ni
  rutas HTTP. El cambio vive en el servicio de dominio y sus tests.

## 2. Modelo de datos

Sin cambios. No hay tablas nuevas, ni RLS, ni migraciones. Las tablas
`webhook_suscripciones` y `jobs` permanecen idénticas. El payload de *entrada*
del job (`{ ordenId, estatusDestinoId, ocurridoAt }`) no cambia.

## 3. Cambio concreto

### Punto único de cambio

`lib/services/WebhookEstadoService.ts`, método `ejecutar`, líneas 85-94. Es el
**único** lugar del repo que arma el cuerpo del webhook.

Cuerpo actual (104):
```json
{ "evento": "orden.estado_actualizado", "eventoId": "...", "ocurridoAt": "...",
  "orden": { "numGuia": 123, "numRemision": "...", "estado": "..." } }
```

Cuerpo nuevo (112):
```json
{ "evento": "orden.estado_actualizado", "eventoId": "...", "ocurridoAt": "...",
  "data": { "numGuia": 123, "numRemision": "...", "estado": "..." } }
```

Diff efectivo: la clave `orden:` del `JSON.stringify` pasa a `data:`. El orden de
serialización y todo lo demás queda igual.

### Contrato I/O (salida del webhook, tras el cambio)

| Campo       | Tipo   | Cambia | Notas                                             |
|-------------|--------|--------|---------------------------------------------------|
| `evento`    | string | no     | constante `"orden.estado_actualizado"` (R4)       |
| `eventoId`  | string | no     | `dedupeKeyWebhookEstado(...)`, determinista (R6)   |
| `ocurridoAt`| string | no     | del payload del job (R3)                           |
| `data`      | object | **sí** | antes `orden`; contenido idéntico (R1, R2)        |
| `data.numGuia`     | number | no | (R2)                                          |
| `data.numRemision` | string | no | (R2)                                          |
| `data.estado`      | string | no | (R2)                                          |

### Firma

`cabecerasFirma(secret, timestampUnix, cuerpo)` sigue firmando
`${timestamp}.${cuerpo}` (R5). El mecanismo no cambia. Como el cuerpo cambió, la
firma resultante cambia — comportamiento esperado, no un requisito nuevo.

## 4. Alternativa descartada

**Usar `body` o `response` como clave genérica.** Se descartó porque:
- `body` colisiona semánticamente con el "cuerpo HTTP" del propio POST y con la
  variable local `const cuerpo`, generando ambigüedad al leer logs y tests.
- `response` implica que el payload es una respuesta a una petición, lo que es
  falso: el webhook es una notificación push iniciada por Ordenex.
- `data` es el término neutro convencional para "la carga útil del evento" en
  sobres de eventos discriminados y no arrastra ninguna de esas connotaciones.

También se consideró **mantener `orden` y añadir `data` en paralelo** (doble
clave transitoria) para no romper. Descartado: introduce un contrato ambiguo y
deuda de limpieza, y el gate ya aprobó el breaking change directo por ser barato.

## 5. Documentación OpenAPI — fuera de alcance

Verificado en el worktree: `lib/api/openapi-spec.ts` y
`docs/api/api-key-openapi.yaml` **no documentan el webhook** (0 coincidencias de
"webhook"). El OpenAPI de la feature 106 cubre solo los endpoints de la API por
key. Por lo tanto esta feature **no toca documentación**: no hay sección de
webhook que actualizar. Documentar el contrato del webhook (con `data`) queda
como trabajo de una feature futura de documentación. Esta decisión evita inventar
una sección de doc que no existe.

## 6. Impacto en tests

- `tests/unit/services/webhook-estado-service.test.ts` línea 94 assertea
  `body.orden`. Debe pasar a `body.data`. Es el **único** assert sobre la forma
  del cuerpo en toda la suite.
- `tests/integration/api/procesar-jobs-webhook-estado.test.ts` **no** assertea la
  forma del cuerpo de salida (solo el payload de entrada del job y su
  `dedupeKey`), así que no requiere cambios por contrato. Se mantiene como
  verificación de que el flujo end-to-end sigue verde.
