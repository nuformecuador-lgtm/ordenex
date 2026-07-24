# Feature 121 — Ubicación compartida por el cliente en el chat de WhatsApp (webhook + minimapa)

> Requisitos en notación EARS (`docs/specs.md`). Numerados `R1..Rn`. Sin detalles de
> implementación (esos van en `design.md`). Cada requisito debe ser testeable y mapeable a un
> test concreto (ver `tasks.md`). Un requisito sin test es un fallo de la feature (`CLAUDE.md`
> §4, `docs/specs.md` §Trazabilidad).

## Contexto y alcance

Esta feature **EXTIENDE** el chat 1:1 mensajero↔cliente de la feature 120/109 (webhook de
entrada firmado + hilo persistido + panel en `mis-asignaciones`). WhatsApp permite al cliente
compartir su **ubicación** (mensajes `type=location`); hoy esos mensajes caen en
`tipoDeMeta()` a `"otro"` con `cuerpo=null` y se registran sin coordenadas. Esta feature:

1. **Backend:** parsea y normaliza los mensajes `type=location`, persiste la ubicación
   entrante con sus coordenadas (`latitud`/`longitud`) reutilizando el flujo de ingesta
   idempotente del chat, y expone las coordenadas en el contrato hacia la UI.
2. **Frontend:** en la burbuja de un mensaje de ubicación muestra un **icono clicable** que
   abre —dentro de la misma ventana (Dialog de shadcn)— un **minimapa Leaflet** con dos
   puntos: el compartido por el cliente y el GPS EN VIVO del repartidor.

**Decisiones ya cerradas con el humano (NO se reabren; ver `design.md` D1/D2):**

- **D1 — Posición del repartidor:** es el **GPS del navegador EN VIVO** (hook existente
  `hooks/useUbicacionActual.ts` de la feature 93), capturado al abrir el modal. Si el permiso
  está denegado o expira el timeout, el mapa muestra SOLO el punto del cliente + un aviso;
  NUNCA bloquea. No hay rastreo server-side de la posición del mensajero.
- **D2 — Alcance v1:** SOLO VISUALIZAR. Se almacena la ubicación entrante y se pinta en el
  minimapa. NO hay botón para adoptar la ubicación compartida como coordenadas de entrega de
  la orden (diferido a otra feature).

**Fuera de alcance:** adoptar la ubicación como coordenadas de la orden (D2); envío SALIENTE
de ubicación desde el mensajero; rastreo server-side del mensajero (D1); multimedia entrante
distinta de `location`; cambios en la verificación de firma HMAC del webhook (R3/R4 de la 120,
intactos).

---

## Ingesta del webhook — normalización de `type=location`

**R1** — CUANDO el webhook recibe (con firma válida, según R3/R4 de la feature 120) un mensaje
entrante con `type = "location"` que incluye `location.latitude` y `location.longitude`
numéricos, el sistema DEBE normalizarlo a un mensaje entrante de dominio con tipo `ubicacion`
y sus coordenadas `latitud`/`longitud`.

**R2** — CUANDO el sistema valida el cuerpo del webhook, DEBE seguir descartando (strip) los
campos no reconocidos del objeto `location` (p. ej. `name`, `address`) sin que su presencia o
ausencia rompa el parseo, manteniendo el comportamiento de strip zod de la feature 120 (R5).

**R3** — SI un mensaje `type = "location"` NO trae `latitude`/`longitude` numéricos válidos
(ausentes, no numéricos o fuera de rango geográfico), ENTONCES el sistema NO DEBE romper la
respuesta `200` del webhook (R9 de la 120) y DEBE degradar registrando el mensaje sin
coordenadas de ubicación (sin `latitud`/`longitud`), nunca lanzando una excepción que anule el
lote.

## Persistencia de la ubicación entrante

**R4** — CUANDO se ingiere un mensaje entrante normalizado de tipo `ubicacion` con coordenadas
válidas, el sistema DEBE persistirlo en el hilo correspondiente con dirección `entrante`, tipo
`ubicacion`, su `wa_message_id`, su marca de tiempo y sus coordenadas `latitud`/`longitud`.

**R5** — SI un mensaje entrante de ubicación trae un `wa_message_id` ya registrado, ENTONCES
el sistema NO DEBE crear un registro duplicado (idempotencia ante reenvíos de Meta,
consistente con R8 de la feature 120), y el dedupe DEBE conservarse aun con las nuevas
columnas de coordenadas.

**R6** — CUANDO se registra un mensaje entrante NUEVO de tipo `ubicacion`, el sistema DEBE
sellar la marca del último entrante del hilo (`ultimo_entrante_at`), abriendo la ventana de
24 h igual que un mensaje de texto; un mensaje de ubicación deduplicado (R5) NO DEBE re-sellar
esa marca.

**R7** — El cambio de esquema DEBE añadir el valor `ubicacion` al enum `ChatMensajeTipo`
(`chat_mensaje_tipo`) y las columnas nullable `latitud`/`longitud` a `chat_mensaje`, mediante
una migración versionada que incluya su `down.sql` documentando el patrón irreversible de
`ALTER TYPE ... ADD VALUE` de Postgres (recreación del enum en el down, precedente de la
feature 106 `cancelacion_api`).

## Contrato hacia la UI

**R8** — CUANDO la Server Action `listarHiloChat` devuelve el hilo, cada mensaje de tipo
`ubicacion` DEBE exponer sus coordenadas `latitud`/`longitud`, y todo mensaje que NO sea de
tipo `ubicacion` DEBE exponer esas coordenadas como `null`.

## UI — burbuja de ubicación y minimapa

**R9** — DONDE un mensaje del hilo es de tipo `ubicacion` con coordenadas, el panel del chat
DEBE renderizar en su burbuja un **icono clicable** (pin de ubicación) en lugar de (o además
de) un cuerpo de texto vacío, distinguible de las burbujas de texto.

**R10** — CUANDO el mensajero pulsa el icono de una burbuja de ubicación, el sistema DEBE
abrir —dentro de la misma ventana, sin navegar ni recargar— un modal (Dialog de shadcn) que
muestra un minimapa con el punto compartido por el cliente (coordenadas del mensaje).

**R11** — CUANDO se abre el modal de una ubicación, el sistema DEBE intentar capturar el GPS
EN VIVO del repartidor con `useUbicacionActual` (D1) y, si lo obtiene, DEBE dibujar en el
minimapa un segundo marcador con esa posición, distinguible del marcador del cliente.

**R12** — SI el GPS del repartidor no está disponible (permiso denegado o timeout, es decir
`useUbicacionActual` resuelve `null`), ENTONCES el minimapa DEBE mostrar SOLO el punto del
cliente y un aviso de que no se pudo obtener la ubicación del repartidor, sin bloquear la
apertura ni el cierre del modal (D1).

**R13** — CUANDO el mensajero cierra el modal de ubicación, el sistema DEBE cerrarlo sin
recargar la página ni perder el estado del panel del chat (el hilo y su refresco siguen
vivos).

**R14** — El componente del minimapa DEBE cargarse SIEMPRE con el patrón anti-SSR de la
feature 97 (`next/dynamic({ ssr: false })`), porque Leaflet toca `window`/`document`; el
minimapa NUNCA DEBE ejecutarse en el servidor.

## Seguridad y consistencia con la feature 120

**R15** — El sistema NO DEBE registrar en logs las coordenadas de la ubicación del cliente ni
su número de teléfono ni otro dato personal, en ninguna rama del webhook o del service (éxito
o error), consistente con R11 de la feature 120.

**R16** — MIENTRAS un mensajero consulta un hilo con mensajes de ubicación, el sistema DEBE
exponerle únicamente los hilos de órdenes asignadas a ese mensajero (scope por
`mensajeroAsignadoId` en la Server Action, R16 de la 120); esta feature NO reimplementa la
autorización, la reutiliza.

---

## Trazabilidad

Cada `R<n>` anterior tiene su test correspondiente listado en `tasks.md` (unit / integration /
component). Un requisito sin test es un fallo de la feature.

## Preguntas abiertas — RESUELTAS en la puerta humana F1.4 (2026-07-24)

Las decisiones de comportamiento observable estaban cerradas (D1/D2). Los 3 puntos menores se
resolvieron con el humano en F1.4:

- **P1 (afecta R4) — RESUELTA:** **solo lat/lng**. NO se guardan `location.name`/`location.address`
  de Meta aunque vengan (se strip-ean, R2).
- **P2 (afecta R9) — RESUELTA:** la burbuja de ubicación muestra el pin **junto con un texto
  visible "Ubicación compartida"**, renderizado **un poco más pequeño que el texto normal de una
  burbuja** (p. ej. `text-xs` frente al `text-sm` de las burbujas de texto). Sin volcar
  coordenadas crudas en el DOM visible (coherente con R15).
- **P3 (afecta R11) — RESUELTA:** el GPS del repartidor se pide **al abrir el modal** (lazy), no al
  montar el panel; así no se pide permiso de geolocalización hasta que el mensajero abre una
  ubicación.
