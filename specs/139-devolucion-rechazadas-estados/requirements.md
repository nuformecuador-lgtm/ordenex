# Feature 137 — Flujo de devolución de RECHAZADAS (estados + transiciones + UI)

> Zona: fullstack · Complejidad: high · Rama: `feature/137-devolucion-rechazadas-estados`
> Depende de: 135 (renombrado de estados) y 136 (recepción central).

## Nomenclatura (post-135)

Este spec usa los nombres NUEVOS. La feature 135 renombra:

- `recibido_origen` → **`devuelta_a_tienda`** (estado FINAL del flujo; etiqueta "Devuelta a tienda").
- `devuelta_origen` → **`devolviendo_a_tienda`** (paso previo al final).
- `en_bodega` → **`en_bodega_central`**.

La feature 137 introduce TRES estados nuevos:

- **`por_devolver`** — etiqueta "Por devolver".
- **`devolviendo_a_bodega_central`** — etiqueta "Devolviendo a bodega central".
- **`por_devolver_a_tienda`** — etiqueta "Por devolver a tienda".

Orden correcto de implementación: 135 → 136 → 137. Los servicios existentes que la 137
repurposa/reusa (`DevolucionOrigenService`, `RecepcionOrigenService`) ya deben referirse a los
destinos renombrados por la 135.

## Contexto / alcance

Hoy una orden `rechazada` sale del sistema por una acción MANUAL suelta
(`DevolucionOrigenService`: `rechazada → devuelta_origen`, botón "Devolver a la tienda"). La 137 lo
sustituye por un **flujo de devolución centralizado**: el disparador de salida de `rechazada` deja
de ser un botón y pasa a ser **la aprobación del cierre** (igual patrón que la liberación de
`sin_gestionar` de la 109). Las devoluciones satélite pasan OBLIGATORIAMENTE por la bodega central
antes de volver a la tienda.

**Decisiones de negocio ya cerradas por el humano (no se reabren):**

- El disparador `rechazada → {por_devolver | por_devolver_a_tienda}` es la **APROBACIÓN DEL
  CIERRE**, no una acción manual. Destino según la **bodega responsable** de la orden
  (`resolverDestinoCierre` por zona): **satélite → `por_devolver`**; **central →
  `por_devolver_a_tienda`**.
- Aplica **solo a `rechazada`**. Las `devuelta` no entran directo; solo entran si **escalan a
  `rechazada`** (`DevolucionSlaService`), y ahí toman este flujo por la puerta de `rechazada`.
- Los **ENVÍOS son POR LOTE** reutilizando el checkbox de selección múltiple que YA existe en las
  tablas de órdenes; las **RECEPCIONES** (central vía 136, tienda con el flujo existente) siguen
  siendo por QR + input de guía, por orden.

## Diagrama de estados (post-135)

```
                          (APROBACIÓN DEL CIERRE)
                          bodega responsable = satélite
rechazada ───────────────────────────────────────────────► por_devolver
    │                                                            │
    │ (APROBACIÓN DEL CIERRE)                                    │ adminSatelite (LOTE): "enviar a central"
    │ bodega responsable = central                               ▼
    │                                              devolviendo_a_bodega_central
    │                                                            │
    │                                                            │ recepción central QR (reusa 136)
    ▼                                                            ▼
por_devolver_a_tienda ◄──────────────────────────────────── por_devolver_a_tienda
    │
    │ central maestro/admin (LOTE): "enviar a la tienda"
    ▼
devolviendo_a_tienda
    │
    │ recepción QR de la tienda (flujo existente)
    ▼
devuelta_a_tienda
```

## Requisitos (EARS)

### Catálogo, migraciones y etiquetas

- **R1** — El sistema DEBE incluir en el catálogo `order_status` los tres valores nuevos
  `por_devolver`, `devolviendo_a_bodega_central` y `por_devolver_a_tienda`, tanto en la fuente de
  verdad TS (`ORDER_STATUS_SEED`) como sembrados en la base vía migración idempotente
  (`INSERT ... WHERE NOT EXISTS` por `value`).
- **R2** — La migración de catálogo DEBE ser reversible: su `down.sql` DEBE eliminar los tres
  valores SOLO si ninguna `orden` ni fila de `orden_historial_estado` los referencia (best-effort,
  sin romper FKs).
- **R3** — El sistema DEBE agregar el valor `devolucion_rechazada` al enum
  `orden_historial_origen_tipo`, con su `down.sql` reversible (recreación del enum sin ese valor),
  para clasificar en la línea de tiempo la transición disparada por la aprobación del cierre.
- **R4** — La UI DEBE mostrar una etiqueta legible en español y una variante semántica para cada
  uno de los tres estados nuevos: `por_devolver` = "Por devolver"; `devolviendo_a_bodega_central` =
  "Devolviendo a bodega central"; `por_devolver_a_tienda` = "Por devolver a tienda". En el texto de
  UI NO se usa la sigla "SLA" ni jerga interna.

### Salida de `rechazada` disparada por la aprobación del cierre

- **R5** — CUANDO un cierre se APRUEBA y existen órdenes que reposan en `rechazada` asignadas al
  mensajero del cierre (`mensajero_asignado_id = cierre.mensajero_id`), el sistema DEBE
  transicionar cada una según su bodega responsable (`resolverDestinoCierre` sobre la zona de la
  orden): bodega satélite → `por_devolver`; bodega central → `por_devolver_a_tienda`.
- **R6** — La transición de R5 DEBE ejecutarse de forma atómica dentro de la MISMA transacción de
  la aprobación del cierre (todo-o-nada junto con la transición del cierre, la liberación de
  `sin_gestionar` y la alimentación de wallets).
- **R7** — La transición de R5 DEBE ser idempotente: reaprobar el mismo cierre, o una segunda
  corrida, DEBE encontrar cero órdenes en `rechazada` de ese mensajero (guarda por `estatus_id`) y
  no producir efecto duplicado.
- **R8** — La transición de R5 DEBE ser money-neutral: SOLO cambia `orden.estatus_id`; NO recalcula
  ningún snapshot del cierre, NO marca `prioridad` y NO reasigna ni limpia `mensajero_asignado_id`.
- **R9** — El sistema NO DEBE permitir que una orden salga de `rechazada` por ningún disparador
  distinto de la aprobación del cierre. En particular, se RETIRA la transición manual directa
  `rechazada → devolviendo_a_tienda` (ex `rechazada → devuelta_origen`).
- **R10** — CUANDO un cierre se RECHAZA (no se aprueba), el sistema NO DEBE transicionar ninguna
  orden `rechazada`.
- **R11** — CUANDO la transición de R5 se aplica sobre una orden, el sistema DEBE registrar una
  entrada en `orden_historial_estado` con `origen_tipo = devolucion_rechazada` y
  `actor_usuario_id` = el admin que aprobó el cierre.
- **R12** — Una orden en `devuelta` NO DEBE entrar al flujo de devolución de forma directa; SOLO
  DONDE `DevolucionSlaService` la escala a `rechazada`, la orden toma este flujo por la puerta de
  `rechazada` (la 137 no modifica `DevolucionSlaService`).

### Transiciones de ENVÍO (por lote, reutilizando el checkbox existente)

- **R13** — CUANDO el adminSatelite responsable de la zona selecciona una o más órdenes en
  `por_devolver` (checkbox de selección múltiple existente) y pulsa "Enviar a central", el sistema
  DEBE transicionar cada orden seleccionada de `por_devolver` a `devolviendo_a_bodega_central`.
- **R14** — El sistema DEBE autorizar R13 ÚNICAMENTE al adminSatelite cuya zona coincide con la
  zona de la orden; cualquier otro actor (maestro, admin, adminTienda, mensajero, adminSatelite de
  otra zona) DEBE recibir `forbidden` sin efecto en datos.
- **R15** — CUANDO maestro/admin selecciona una o más órdenes en `por_devolver_a_tienda` (checkbox
  de selección múltiple existente en las tabs de órdenes) y pulsa "Enviar a la tienda", el sistema
  DEBE transicionar cada orden seleccionada de `por_devolver_a_tienda` a `devolviendo_a_tienda`.
- **R16** — El sistema DEBE autorizar R15 ÚNICAMENTE a maestro/admin (bodega central), con guarda
  de estado `por_devolver_a_tienda`.

### Transiciones de RECEPCIÓN (por QR + guía, por orden)

- **R17** — CUANDO la recepción central (reuso de la feature 136, escaneo QR / input de guía)
  recibe una orden en `devolviendo_a_bodega_central`, el sistema DEBE transicionarla a
  `por_devolver_a_tienda`, autorizando ÚNICAMENTE a maestro/admin (central); guarda de estado
  `devolviendo_a_bodega_central`; idempotente si ya está en `por_devolver_a_tienda`.
- **R18** — CUANDO la tienda dueña de la orden escanea el QR (o ingresa la guía) de una orden en
  `devolviendo_a_tienda`, el sistema DEBE transicionarla a `devuelta_a_tienda`, reutilizando el
  flujo de recepción de tienda existente (`RecepcionOrigenService`, con los nombres renombrados por
  la 135), sin lógica nueva de transición en la 137.

### Visibilidad de los nuevos estados (integrada en vistas existentes; NO es feature nueva)

- **R19** — MIENTRAS un maestro/admin usa el listado de órdenes por estado (`/ordenes`,
  `OrdenesTabs`), el sistema DEBE exponer los cuatro estados del flujo (`por_devolver`,
  `devolviendo_a_bodega_central`, `por_devolver_a_tienda`, `devuelta_a_tienda`) como tabs, sin
  excluirlos.
- **R20** — MIENTRAS un adminTienda usa el listado de sus órdenes (`/ordenes`, `OrdenesTabs`), el
  sistema DEBE exponer para sus órdenes los estados del flujo de devolución que apliquen a ellas
  (incluidos `por_devolver_a_tienda`, `devolviendo_a_tienda` y `devuelta_a_tienda`), sin excluirlos
  de sus tabs.
- **R21** — MIENTRAS un adminSatelite usa `/recepcion-satelite`, el sistema DEBE exponer, acotadas a
  su zona, las órdenes en `por_devolver` (sección accionable con el checkbox de selección múltiple +
  "Enviar a central") y las órdenes en `devolviendo_a_bodega_central` (visibilidad informativa,
  ya enviadas y en tránsito a central).

### Guardias e integridad (transversal)

- **R22** — Cada transición (R5, R13, R15, R17, R18) DEBE defenderse en la base con un `UPDATE`
  guardado por el estado de origen en su cláusula `WHERE` (anti-TOCTOU); la comprobación previa en
  el service solo sirve para reportar mejor.
- **R23** — Cada transición de lote y de recepción (R13, R15, R17, R18) DEBE registrar una entrada
  en `orden_historial_estado` con el actor que la ejecutó (`origen_tipo = ajuste_estado`, reusando
  el choke point de la feature 49; no se agregan valores de enum para estas cuatro).
- **R24** — Toda entrada externa (Server Action / recepción) DEBE validarse y tiparse en el borde
  (zod), y cada transición y cada requisito de visibilidad DEBE quedar mapeado a al menos un test
  (unitario del service/repo y/o de integración/UI), según la regla de trazabilidad del arnés.

## Trazabilidad

Cada `R<n>` se mapea a su test en `tasks.md` y el implementer lo documenta en
`progress/impl_137-devolucion-rechazadas-estados.md`. Un requisito sin test es un fallo de la
feature.

## Preguntas abiertas

1. **Confirmar textos de etiqueta (R4).** Riesgo de confusión entre `devolviendo_a_bodega_central`
   = "Devolviendo a bodega central" y el existente `en_ruta_bodega_principal` = "Enviando a B.
   Central". Confirmar redacción definitiva.
2. **Contrato de reuso con la 136 (R17).** La 136 (recepción central) aún no tiene spec aprobado.
   La 137 asume que su recepción admite gobernar el par `devolviendo_a_bodega_central →
   por_devolver_a_tienda` (o expone un punto de extensión). Si la 136 fija un único par
   origen→destino hardcodeado, coordinar el contrato antes de implementar.
3. **Autz del envío central (R15/R16).** Se define maestro/admin (central) porque
   `por_devolver_a_tienda` es, por construcción, un estado siempre físicamente en la central (las
   satélite llegan ahí solo tras la recepción central). Confirmar que NO debe reusarse
   `esBodegaResponsable` por-zona (daría el actor equivocado para una orden de zona satélite ya
   recibida en central).
4. **Alcance de la visibilidad de la tienda (R20).** Confirmar si el adminTienda debe ver también
   los estados internos de bodega del retorno (`por_devolver`, `devolviendo_a_bodega_central`) de
   sus propias órdenes, o solo los del tramo tienda (`por_devolver_a_tienda`, `devolviendo_a_tienda`,
   `devuelta_a_tienda`). El diseño propone exponer los del tramo tienda; ampliar es trivial (no
   excluirlos).
