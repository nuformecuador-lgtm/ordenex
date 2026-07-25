# Feature 136 — Etiquetas PDF consolidadas en la carga por API

> Requisitos en notación EARS. Cada `R<n>` es testeable y se mapea a un test en
> `tasks.md`. Sin detalles de implementación (esos viven en `design.md`).

## Contexto (dado, no se reabre)

La carga por API `POST /api/ordenes/api-key/carga` (`handleCargaApi` →
`BulkOrdenService.cargarViaApi`, rol `apiKey`) crea órdenes y asigna `num_guia` en
la misma transacción. Esta feature añade, tras esa creación, la generación
server-side de un único PDF consolidado con las etiquetas del lote, su
almacenamiento en un bucket privado de Supabase Storage y la devolución de una URL
firmada en la respuesta del endpoint. Decisiones cerradas con el humano: (a)
disparo = carga vía API; (b) generación = server-side; (c) almacenamiento = un solo
PDF consolidado por lote; (d) respuesta = URL firmada.

## Requisitos

### Generación y contenido del PDF

- **R1** — CUANDO la carga vía API crea al menos una orden, el sistema DEBE generar
  un único documento PDF que contenga una etiqueta por cada orden creada en el lote.

- **R2** — El sistema DEBE producir el PDF con una etiqueta por página, cada página
  de tamaño 100 × 100 mm.

- **R3** — El sistema DEBE incluir en el PDF tantas páginas como órdenes creadas
  tenga el lote (una etiqueta por orden creada, sin duplicar ni omitir).

- **R4** — Cada etiqueta DEBE mostrar de forma legible los datos de su orden:
  número de guía, número de remisión, destinatario, teléfono, dirección, ubicación
  geográfica (zona / provincia / cantón / distrito), producto, monto a cobrar y
  tienda.

- **R5** — El código QR de cada etiqueta DEBE codificar la URL pública del paquete
  `<origin>/paquete/<numGuia>` (construida con `buildPaqueteUrl(numGuia)`), no el
  número de guía pelado.

- **R6** — El código de barras de cada etiqueta DEBE codificar el `num_guia` de la
  orden en formato CODE128.

- **R7** — El sistema DEBE generar el PDF server-side (en el runtime Node del
  endpoint), sin depender del navegador ni del DOM del cliente.

### Almacenamiento y respuesta

- **R8** — CUANDO el PDF del lote se genera con éxito, el sistema DEBE subirlo al
  bucket privado configurado con `contentType: "application/pdf"`.

- **R9** — El bucket de almacenamiento DEBE ser privado; el sistema NUNCA DEBE
  exponer el PDF mediante una URL pública.

- **R10** — CUANDO el PDF se almacena con éxito, el sistema DEBE devolver en el
  cuerpo de la respuesta del endpoint una URL firmada del objeto, con un TTL
  configurable, junto con su tiempo de expiración en segundos.

- **R11** — El sistema DEBE almacenar cada PDF bajo un path aislado por dueño (el
  `actor.usuarioId` de la tienda) que evite colisiones entre lotes distintos.

### Best-effort y casos límite

- **R12** — SI la generación o el almacenamiento del PDF falla, ENTONCES el sistema
  DEBE conservar las órdenes ya creadas (no revertir la carga), responder HTTP 200 y
  hacer el fallo VISIBLE en la respuesta con `etiquetasPdf: { error: <mensaje
  legible, sin PII ni secretos> }` (no se oculta con `null`).

- **R13** — SI la carga vía API no crea ninguna orden (todas duplicadas o con
  error), ENTONCES el sistema NO DEBE generar ni almacenar PDF, y la respuesta DEBE
  traer `etiquetasPdf: null`.

- **R14** — SI ninguna de las órdenes creadas produce etiqueta imprimible (todas
  omitidas por `sin_guia` / `no_encontrada`), ENTONCES el sistema NO DEBE generar
  PDF y la respuesta DEBE traer `etiquetasPdf: null`.

### Alcance y regresión

- **R15** — El sistema DEBE disparar esta generación ÚNICAMENTE desde la carga vía
  API; la carga masiva por sesión (`carga-masiva/chunk` → `cargarMasiva`) NO DEBE
  verse afectada.

- **R16** — La autenticación y autorización por API key existentes del endpoint NO
  DEBEN cambiar: las respuestas 401 (sin key / key inválida) y 403 (key sin
  permiso) DEBEN mantenerse idénticas, y la generación de PDF NO DEBE ejecutarse
  cuando la autenticación o autorización fallan.

- **R17** — El sistema DEBE preservar sin cambios los campos existentes del
  `CargaViaApiSummary` en la respuesta (total, creadas, duplicadas, conError,
  filas, ordenes); el bloque `etiquetasPdf` DEBE añadirse como campo adicional.

### Configuración

- **R18** — El nombre del bucket y el TTL de la URL firmada NO DEBEN estar
  hardcodeados: DEBEN resolverse por variable de entorno con un valor por defecto.

## Preguntas abiertas

Ninguna. Las ambigüedades del pedido original quedaron resueltas por las decisiones
cerradas con el humano (disparo, server-side, PDF consolidado, URL firmada) y por el
contexto técnico verificado del repo. Si al implementar aparece un desacuerdo de
contrato (p. ej. la forma exacta del bloque `etiquetasPdf`), se documenta aquí antes
de codificar.
