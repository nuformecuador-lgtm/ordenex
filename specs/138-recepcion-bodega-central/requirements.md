# Feature 136 — Recepción en bodega central · requirements.md

> Zona: fullstack · Complexity: medium · Rama: `feature/136-recepcion-bodega-central`
> Depende de: **135** (renombre de estados).

## Contexto y nombres de estado (leer antes de los requisitos)

Esta feature usa los nombres de estado **posteriores a la feature 135**:

| Rol en este flujo | Nombre HOY (pre-135) | Nombre NUEVO (post-135, el que usa este spec) |
| --- | --- | --- |
| Origen (dead-end de la carga API) | `en_ruta_bodega_principal` | `en_ruta_bodega_central` |
| Destino (recibida en central) | `en_bodega` | `en_bodega_central` |

**Problema que cierra:** `en_ruta_bodega_central` (post-135) solo lo produce la carga por API
(`BulkOrdenService.cargarViaApi`, constante `ESTATUS_INICIAL_API`) y **no tiene ninguna
transición de salida**: es un callejón sin salida. No existe una "recepción en bodega central"
análoga a la recepción satélite (feature 33). Esta feature añade ese disparador de recepción.

**Análogos de referencia (mismo patrón):** `RecepcionSateliteService` (feature 33, acotado por
zona) y `RecepcionOrigenService` (recepción en tienda de origen, acotado por tienda). La
recepción central NO se acota ni por zona ni por tienda: es global para maestro/admin.

Todos los rechazos son **sin efectos en datos**. La transición efectiva es atómica y deja rastro
en el historial de estados.

---

## Requisitos (EARS)

**R1 (Ubicuo).** El sistema DEBE ofrecer una recepción en bodega central que transicione una
orden desde `en_ruta_bodega_central` a `en_bodega_central`.

**R2 (Por evento).** CUANDO un actor con rol `maestro` o `admin` dispara la recepción de una
orden identificada por su `num_guia`, y esa orden existe, no está borrada y está en
`en_ruta_bodega_central`, el sistema DEBE transicionarla a `en_bodega_central`.

**R3 (Por evento).** CUANDO se ejecuta una recepción efectiva (R2), el sistema DEBE registrar la
transición en el historial de estados dentro de la **misma operación atómica** que el cambio de
estado (si una falla, ambas se revierten).

**R4 (Condicional).** SI el rol del actor no es `maestro` ni `admin`, ENTONCES el sistema DEBE
rechazar la recepción como no autorizada (`forbidden`), sin tocar datos.

**R5 (Condicional).** SI no hay sesión válida, ENTONCES el sistema DEBE rechazar la recepción
como no autenticada (`unauthenticated`), sin tocar datos.

**R6 (Condicional).** SI no existe ninguna orden con el `num_guia` indicado, o la orden está
borrada, ENTONCES el sistema DEBE responder `no_encontrada`, sin tocar datos.

**R7 (Condicional).** SI la orden ya está en `en_bodega_central`, ENTONCES el sistema DEBE
responder de forma idempotente (`ya_recibida`), sin re-transicionar y sin añadir historial.

**R8 (Condicional).** SI la orden existe pero su estado actual no es `en_ruta_bodega_central`
(ni el idempotente `en_bodega_central` de R7), ENTONCES el sistema DEBE rechazar la recepción
indicando el estado actual (`estado_invalido` + estado), sin tocar datos.

**R9 (De estado / concurrencia).** MIENTRAS dos recepciones concurrentes intentan recibir la
misma orden, el sistema DEBE garantizar que a lo sumo UNA transiciona (guardia por estado de
origen impuesta en la propia escritura); la otra DEBE resolverse como `ya_recibida` (idempotente)
o `conflict`, y NUNCA debe producir doble entrada de historial.

**R10 (Condicional).** SI el `num_guia` provisto no es un entero positivo válido (o el texto
escaneado no decodifica a un `num_guia`), ENTONCES el sistema DEBE rechazarlo en el borde como
error de validación (`validation_error`/"código inválido"), sin invocar la lógica de negocio.

**R11 (Ubicuo).** El sistema DEBE considerar elegible CUALQUIER orden en `en_ruta_bodega_central`
para maestro/admin, sin acotar por zona ni por tienda (diferencia explícita con la recepción
satélite, que se acota a la zona del `adminSatelite`).

**R12 (Por evento · UI).** CUANDO un `maestro`/`admin` abre el módulo de bodega (órdenes), el
sistema DEBE ofrecer un disparador de recepción con **dos entradas equivalentes**: (a) escaneo de
QR por cámara y (b) entrada manual del número de guía.

**R13 (Por evento · UI).** CUANDO el usuario escanea un QR de etiqueta que codifica
`/paquete/<numGuia>`, el sistema DEBE extraer el `num_guia` del texto y disparar la recepción con
ese valor.

**R14 (Por evento · UI).** CUANDO la recepción resulta efectiva o idempotente (`ok`/`ya_recibida`),
el sistema DEBE refrescar el listado de forma que la orden deje de figurar en la vista de
`en_ruta_bodega_central`.

**R15 (Por evento · UI).** CUANDO la recepción devuelve un resultado, el sistema DEBE notificar al
usuario con un mensaje claro y distinto por cada resultado (`ok`, `ya_recibida`, `no_encontrada`,
`estado_invalido`, `validation_error`, `forbidden`, `unauthenticated`, `conflict`).

**R16 (Opcional · DONDE).** DONDE el rol del actor es `maestro`/`admin`, el sistema DEBE mostrar el
disparador de recepción; para cualquier otro rol NO DEBE mostrarlo ni permitir la recepción.

**R17 (Ubicuo · trazabilidad).** El sistema DEBE clasificar la transición de recepción central en
el historial con un tipo de origen propio, distinguible del de la recepción satélite y del de la
recepción en origen.

**R18 (Ubicuo).** El sistema DEBE conservar sin cambios `num_guia` y `mensajero_asignado_id` de la
orden durante la recepción (la recepción solo cambia el estado).

---

## Trazabilidad (mapa requisito → prueba, lo completa el implementer)

Cada `R<n>` debe terminar mapeado a un test concreto en `progress/impl_136-recepcion-bodega-central.md`.
Requisitos de dominio (R1–R11, R17, R18) → tests unitarios del service + integración del repo.
Requisitos de borde (R5, R10) → test de la Server Action. Requisitos de UI (R12–R16) → test del
componente. R9 → test de concurrencia/guardia del repo.

---

## Preguntas abiertas

1. **Alcance por zona.** ¿La recepción central recibe CUALQUIER orden en `en_ruta_bodega_central`
   sin importar la zona (supuesto de R11), o debe acotarse a órdenes de zona central/GAM
   (`zonaEsGam`)? Supuesto actual: sin acotar por zona, porque la carga por API deja TODAS las
   órdenes del canal en ese estado con independencia de su zona.

2. **Re-encaminamiento posterior.** Tras recibir en central una orden cuya zona es satélite,
   ¿debe el sistema re-encaminarla automáticamente a la bodega satélite de su zona, o basta con
   dejarla en `en_bodega_central` para que el flujo existente de asignación/ruteo la gestione
   manualmente? Supuesto actual: solo se deja en `en_bodega_central`; el ruteo posterior lo cubre
   el flujo ya existente (no es parte de esta feature).

3. **Ubicación exacta de la UI.** Supuesto: un control a nivel del encabezado del módulo
   `/ordenes` para maestro/admin (espejo de `EscanerRecepcionOrigen`), no una página dedicada. Ver
   alternativa descartada en `design.md`. Confirmar si se prefiere página dedicada
   `/recepcion-bodega-central`.

4. **Recepción en lote.** ¿v1 solo 1-a-1 (una guía por escaneo/entrada), o también "recibir todas"
   en lote como la satélite (feature 63)? Supuesto actual: solo 1-a-1; el lote queda fuera de v1.

5. **Dependencia 135.** Esta feature asume que 135 ya renombró los estados en el catálogo
   `order_status` (seed) y en las constantes de `BulkOrdenService`. Si 135 no está mergeada, las
   constantes `en_ruta_bodega_central`/`en_bodega_central` no existen aún: no implementar antes de
   135.
