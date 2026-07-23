# Feature 112 — Webhook: sobre genérico `data` en el cuerpo de entrega

## Contexto

La feature 104 introdujo la entrega de webhooks de estado de orden con un cuerpo
que anida el recurso bajo la clave específica `orden`. Esta feature cambia esa
clave por un sobre genérico `data`, para desacoplar el payload del recurso y
habilitar futuros tipos de evento discriminados por `evento`.

Es un **breaking change** intencional del contrato de salida del webhook. Se hace
ahora porque la 104 recién se mergeó y ningún consumidor externo depende aún del
contrato. No hay migración de base de datos: es backend puro.

**Fuera de alcance:** el mecanismo de firma HMAC, el esquema del payload de
*entrada* del job (`ordenId`/`estatusDestinoId`/`ocurridoAt`), el discriminador
`evento`, el `eventoId`, `ocurridoAt` y el contenido interno
(`numGuia`/`numRemision`/`estado`). Nada de eso cambia.

## Requisitos (EARS)

**R1** — When the WebhookEstadoService construye el cuerpo de una entrega de
webhook, the system shall anidar el recurso de la orden bajo la clave `data`
(no bajo `orden`).

**R2** — When the WebhookEstadoService construye el cuerpo de una entrega de
webhook, the system shall incluir dentro de `data` exactamente los campos
`numGuia`, `numRemision` y `estado`, con los mismos valores que producía la
feature 104.

**R3** — When the WebhookEstadoService construye el cuerpo de una entrega de
webhook, the system shall mantener sin cambios las claves de sobre `evento`,
`eventoId` y `ocurridoAt` (mismos nombres, misma posición, mismos valores).

**R4** — When the WebhookEstadoService emite un evento de estado de orden, the
system shall usar el discriminador `evento` con el valor constante
`"orden.estado_actualizado"`.

**R5** — When the WebhookEstadoService firma una entrega, the system shall
calcular la firma HMAC sobre `${timestamp}.${cuerpo}` sin cambiar el mecanismo,
usando el cuerpo ya serializado con la clave `data`.

**R6** — When the WebhookEstadoService reejecuta el mismo job (mismo
`ordenId`/`estatusDestinoId`/`ocurridoAt`), the system shall producir el mismo
`eventoId` y el mismo cuerpo serializado (determinismo preservado tras el
cambio de clave).

## Preguntas abiertas

Ninguna. El gate F1.4 fue aprobado por el humano con estas decisiones cerradas:
la clave genérica es `data`; el cambio se hace ahora; es backend puro sin
migración. La documentación OpenAPI del webhook **no existe** en el repo
(verificado: 0 coincidencias de "webhook" en `lib/api/openapi-spec.ts` y
`docs/api/api-key-openapi.yaml`), por lo que R sobre documentación no aplica y
se trata como fuera de alcance (ver design.md §5).
