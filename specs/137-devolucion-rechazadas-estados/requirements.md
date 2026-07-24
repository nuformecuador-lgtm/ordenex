# Feature 137 — Flujo de devolución de RECHAZADAS (estados + transiciones + UI)

> Zona: fullstack · Complejidad: high · Rama: `feature/137-devolucion-rechazadas-estados`
> Depende de: 135 (renombrado de estados) y 136 (recepción central).
>
> **Nomenclatura (post-135).** Este spec usa los nombres NUEVOS que introduce la feature 135:
> `en_tienda` (ex `recibido_origen`), `devolviendo_a_tienda` (ex `devuelta_origen`),
> `en_bodega_central` (ex `en_bodega`). Donde se cita código aún no renombrado (p. ej.
> `DevolucionOrigenService`, cuyo destino literal hoy es `devuelta_origen`) se asume que 135 ya
> aterrizó el renombrado antes de implementar la 137. Ver `design.md §0`.

## Contexto / alcance

Hoy una orden `rechazada` sale del sistema por una acción MANUAL suelta
(`DevolucionOrigenService`: `rechazada → devuelta_origen`, botón "Devolver a la tienda"). La 137
sustituye ese modelo por un **flujo de devolución centralizado** con tres estados nuevos, cuyo
disparador de salida de `rechazada` deja de ser un botón y pasa a ser **la aprobación del cierre**
(igual patrón que la liberación de `sin_gestionar` de la 109). Las devoluciones satélite pasan
OBLIGATORIAMENTE por la bodega central antes de volver a la tienda.

**Decisiones de negocio ya cerradas por el humano (no se reabren en este spec):**

- El disparador `rechazada → {por_devolver | por_devolver_a_tienda}` es la **APROBACIÓN DEL
  CIERRE**, no una acción manual. Destino según la **bodega responsable** de la orden
  (`resolverDestinoCierre` por zona): **satélite → `por_devolver`**; **central →
  `por_devolver_a_tienda`**.
- Aplica **solo a `rechazada`**. Las `devuelta` no entran directo; solo entran si **escalan a
  `rechazada`** (`DevolucionSlaService`), y ahí toman este flujo por la puerta de `rechazada`.

## Diagrama de estados (post-135)

```
                          (APROBACIÓN DEL CIERRE)
                          bodega responsable = satélite
rechazada ───────────────────────────────────────────────► por_devolver
    │                                                            │
    │ (APROBACIÓN DEL CIERRE)                                    │ adminSatelite: "enviar a central"
    │ bodega responsable = central                               ▼
    │                                              en_ruta_devolucion_central
    │                                                            │
    │                                                            │ recepción central (reusa 136)
    ▼                                                            ▼
por_devolver_a_tienda ◄──────────────────────────────────── por_devolver_a_tienda
    │
    │ central (maestro/admin): "enviar a la tienda"
    ▼
devolviendo_a_tienda
    │
    │ recepción QR de la tienda (reusa flujo existente)
    ▼
en_tienda
```

## Requisitos (EARS)

### Catálogo, migraciones y etiquetas

- **R1** — El sistema DEBE incluir en el catálogo `order_status` los tres valores nuevos
  `por_devolver`, `en_ruta_devolucion_central` y `por_devolver_a_tienda`, tanto en la fuente de
  verdad TS (`ORDER_STATUS_SEED`) como sembrados en la base vía migración idempotente
  (`INSERT ... WHERE NOT EXISTS` por `value`).
- **R2** — La migración de catálogo DEBE ser reversible: su `down.sql` DEBE eliminar los tres
  valores SOLO si ninguna `orden` ni fila de `orden_historial_estado` los referencia (best-effort,
  sin romper FKs).
- **R3** — El sistema DEBE agregar el valor `devolucion_rechazada` al enum
  `orden_historial_origen_tipo`, con su `down.sql` reversible (recreación del enum sin ese valor,
  seguro solo si ninguna fila lo usa), para clasificar en la línea de tiempo la transición
  disparada por la aprobación del cierre.
- **R4** — La UI DEBE mostrar una etiqueta legible en español y una variante semántica para cada
  uno de los tres estados nuevos; las etiquetas DEBEN ser distinguibles de las existentes
  (`en_bodega_central`, `en_ruta_bodega_principal`). En el texto de UI NO se usa la sigla "SLA" ni
  jerga interna.

### Salida de `rechazada` disparada por la aprobación del cierre

- **R5** — CUANDO un cierre se APRUEBA y existen órdenes que reposan en `rechazada` asignadas al
  mensajero del cierre (`mensajero_asignado_id = cierre.mensajero_id`), el sistema DEBE
  transicionar cada una según su bodega responsable (`resolverDestinoCierre` sobre la zona de la
  orden): bodega satélite → `por_devolver`; bodega central → `por_devolver_a_tienda`.
- **R6** — La transición de R5 DEBE ejecutarse de forma atómica dentro de la MISMA transacción de
  la aprobación del cierre (todo-o-nada junto con la transición del cierre, la liberación de
  `sin_gestionar` y la alimentación de wallets): si cualquier paso falla, se revierte todo.
- **R7** — La transición de R5 DEBE ser idempotente: reaprobar el mismo cierre, o una segunda
  corrida, DEBE encontrar cero órdenes en `rechazada` de ese mensajero (guarda por `estatus_id`) y
  no producir efecto duplicado.
- **R8** — La transición de R5 DEBE ser money-neutral: SOLO cambia `orden.estatus_id`; NO recalcula
  ningún snapshot del cierre, NO marca `prioridad` y NO reasigna ni limpia `mensajero_asignado_id`.
- **R9** — El sistema NO DEBE permitir que una orden salga de `rechazada` por ningún disparador
  distinto de la aprobación del cierre. En particular, se RETIRA la transición manual directa
  `rechazada → devolviendo_a_tienda` (ex `rechazada → devuelta_origen`).
- **R10** — CUANDO un cierre se RECHAZA (no se aprueba), el sistema NO DEBE transicionar ninguna
  orden `rechazada` (el rechazo del cierre no dispara devolución alguna).
- **R11** — CUANDO la transición de R5 se aplica sobre una orden, el sistema DEBE registrar una
  entrada en `orden_historial_estado` con `origen_tipo = devolucion_rechazada` y
  `actor_usuario_id` = el admin que aprobó el cierre.
- **R12** — Una orden en `devuelta` NO DEBE entrar al flujo de devolución de forma directa; SOLO
  DONDE `DevolucionSlaService` la escala a `rechazada`, la orden toma este flujo por la puerta de
  `rechazada` (la 137 no modifica `DevolucionSlaService`).

### Transiciones manuales del flujo

- **R13** — CUANDO el adminSatelite responsable de la zona de la orden ejecuta "enviar a central"
  sobre una orden en `por_devolver`, el sistema DEBE transicionarla a `en_ruta_devolucion_central`.
- **R14** — El sistema DEBE autorizar R13 ÚNICAMENTE al adminSatelite cuya zona coincide con la
  zona de la orden; cualquier otro actor (maestro, admin, adminTienda, mensajero, adminSatelite de
  otra zona) DEBE recibir `forbidden` sin efecto en datos.
- **R15** — CUANDO la recepción central (reuso de la feature 136) recibe/escanea una orden en
  `en_ruta_devolucion_central`, el sistema DEBE transicionarla a `por_devolver_a_tienda`.
- **R16** — El sistema DEBE autorizar R15 ÚNICAMENTE a maestro/admin (bodega central); la guarda de
  estado DEBE ser `en_ruta_devolucion_central` y la operación idempotente si la orden ya está en
  `por_devolver_a_tienda`.
- **R17** — CUANDO la bodega central (maestro/admin) ejecuta "enviar a la tienda" sobre una orden en
  `por_devolver_a_tienda`, el sistema DEBE transicionarla a `devolviendo_a_tienda`.
- **R18** — El sistema DEBE autorizar R17 ÚNICAMENTE a maestro/admin (bodega central), con guarda de
  estado `por_devolver_a_tienda`; idempotente si la orden ya está en `devolviendo_a_tienda`.
- **R19** — CUANDO la tienda dueña de la orden escanea el QR de una orden en `devolviendo_a_tienda`,
  el sistema DEBE transicionarla a `en_tienda`, reutilizando el flujo de recepción de tienda
  existente (`RecepcionOrigenService`, con los nombres renombrados por la 135), sin lógica nueva de
  transición en la 137.

### Guardias e integridad (transversal)

- **R20** — Cada transición (R5, R13, R15, R17, R19) DEBE defenderse en la base con un `UPDATE`
  guardado por el estado de origen en su cláusula `WHERE` (anti-TOCTOU); la comprobación previa en
  el service solo sirve para reportar mejor, no es la defensa real.
- **R21** — Cada transición manual (R13, R15, R17, R19) DEBE registrar una entrada en
  `orden_historial_estado` con el actor que la ejecutó (`origen_tipo = ajuste_estado`, reusando el
  choke point de la feature 49; no se agregan valores de enum para estas cuatro).
- **R22** — Toda entrada externa (Server Action / recepción) DEBE validarse y tiparse en el borde
  (zod), y cada transición DEBE quedar mapeada a al menos un test (unitario del service y/o de
  integración), según la regla de trazabilidad del arnés.

## Trazabilidad

Cada `R<n>` se mapea a su test en `tasks.md` (columna "criterio de hecho") y el implementer lo
documenta en `progress/impl_137-devolucion-rechazadas-estados.md`. Un requisito sin test es un
fallo de la feature.

## Preguntas abiertas

1. **Etiquetas exactas de UI (R4).** El `design.md §5` propone: `por_devolver` = "Por devolver";
   `en_ruta_devolucion_central` = "Devolviendo a B. Central"; `por_devolver_a_tienda` = "Por
   devolver a tienda". Confirmar textos (hay riesgo de confusión entre "Devolviendo a B. Central" y
   el existente `en_ruta_bodega_principal` = "Enviando a B. Central").
2. **Superficie del adminSatelite para "enviar a central" (R13).** `OrdenesTabs.accionesLote` es
   maestro-only; la superficie operativa del adminSatelite es `/recepcion-satelite`. El `design.md`
   propone montar el listado de `por_devolver` + acción "Enviar a central" en el módulo de
   `/recepcion-satelite`. Confirmar ubicación y si la acción es por-orden o por-lote.
3. **Contrato de reuso con la 136 (R15).** La 136 (recepción central) aún no tiene spec aprobado.
   La 137 asume que su servicio de recepción central admite registrar/gobernar el par de estados
   `en_ruta_devolucion_central → por_devolver_a_tienda` (o expone un punto de extensión). Si la 136
   fija un único par origen→destino hardcodeado, hay que coordinar el contrato antes de implementar.
4. **Autz del paso 3 (R17/R18).** Se define maestro/admin (central) porque `por_devolver_a_tienda`
   es, por construcción, un estado siempre físicamente en la central (las satélite llegan ahí solo
   tras la recepción central). Confirmar que NO debe reusarse `esBodegaResponsable` por-zona en este
   paso (daría el actor equivocado para órdenes de zona satélite ya recibidas en central).
