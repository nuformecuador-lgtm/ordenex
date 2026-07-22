# Feature 100 — Resolver la novedad: reprogramar (tienda) o recuperar a bodega (bodega dueña)

> Acciones MANUALES que RESUELVEN una novedad y sacan la orden del estado `devuelta`
> ANTES de que venza su ventana SLA, de modo que el cron de la feature 99 la salte
> (solo actúa sobre órdenes que SIGUEN en `devuelta`). Depende de la 99 (ya en `dev`).
>
> Alcance verificado contra el código de `dev`: `/novedades` (87/89) es hoy solo lectura +
> `ContactoButtons`; la orden reposa en `devuelta`; el cron `procesar-devueltas-sla` (99) y
> `NovedadesService` se anclan a `estatus = devuelta`; toda transición pasa por el choke point
> `appendCambioEstado` (49). Esta feature añade DOS acciones sin reimplementar esa base.

Notación EARS. Cada `R<n>` es testeable y se mapea a un test en `design.md §Trazabilidad`.

---

## A. Reprogramar (adminTienda, en /novedades)

- **R1** — DONDE una orden reposa en `devuelta` y pertenece a la tienda del `adminTienda`,
  el sistema DEBE ofrecer la acción "Reprogramar" en `/novedades`, junto a los botones de
  contacto existentes.

- **R2** — CUANDO el `adminTienda` confirma una reprogramación con una fecha, el sistema DEBE
  transicionar la orden de `devuelta` a `reprogramada` a través de `appendCambioEstado`, NUNCA
  escribiendo `orden.estatus_id` de forma directa.

- **R3** — CUANDO el `adminTienda` reprograma, el sistema DEBE persistir, en la MISMA
  transacción que la transición, una gestión con `resultado = reprogramada`,
  `fecha_reprogramacion` = la fecha elegida y `motivo` (ver "Preguntas abiertas" Q1 para su
  obligatoriedad), de modo que el cron de liberación de la feature 46 pueda liberarla al llegar
  la fecha.

- **R4** — SI la fecha de reprogramación NO es mañana o posterior en el calendario de Costa Rica
  (misma regla que la reprogramación del mensajero, `esFechaFutura`), ENTONCES el sistema DEBE
  rechazar la acción con `validation_error`, sin modificar la orden ni el historial.

- **R5** — El sistema DEBE atribuir en la gestión sintética `mensajero_id` = el mensajero de la
  última gestión `devuelta` VIGENTE (`anulada_at IS NULL`) de la orden (misma derivación que la
  feature 99 usa para anclar la ventana).

- **R6** — SI el actor no es `adminTienda`, o la orden no pertenece a su tienda
  (`orden.tienda_id != actor.usuarioId`), ENTONCES el sistema DEBE responder `forbidden` /
  `not_found` sin modificar la orden ni el historial.

- **R7** — SI la orden ya NO está en `devuelta` en el momento de reprogramar (p. ej. el cron SLA
  la movió antes, o doble submit), ENTONCES el sistema DEBE responder `conflict` de forma
  idempotente, sin efectos (guarda por estado en el UPDATE).

- **R8** — La reprogramación NO DEBE incrementar el contador de intentos de entrega: el contador
  deriva del historial contando SOLO las transiciones con destino `devuelta` (feature 47/49), y
  el destino de esta transición es `reprogramada`.

- **R9** — MIENTRAS la orden esté en `reprogramada` con `fecha_reprogramacion` futura, el sistema
  DEBE mantenerla bloqueada (no reasignable/enviable antes de la fecha, feature 46) y el cron SLA
  de la feature 99 DEBE saltarla (no está en `devuelta`).

- **R10** — La gestión sintética de reprogramación DEBE ser NEUTRAL en dinero: no genera
  movimiento de wallet ni monto en el cierre (verificado: el cierre solo acredita `entregada` y
  `rechazada`; `reprogramada`/`devuelta` cuentan $0.00).

- **R11** — La transición de reprogramación DEBE registrarse en el historial con
  `actor_usuario_id` = el `adminTienda` y `origen_tipo` que distinga esta acción de la
  reprogramación del mensajero (`gestion`) y de la liberación del cron (`liberacion_reprogramada`)
  — valor propuesto `reprogramacion_tienda`; decisión final en "Preguntas abiertas" Q1.

---

## B. Recuperar a bodega (bodega dueña de la orden)

- **R12** — DONDE una orden reposa en `devuelta`, la bodega RESPONSABLE de su zona DEBE poder
  recuperarla a bodega (nuevo intento), sacándola de novedades y reiniciando el flujo.

- **R13** — CUANDO la bodega recupera, el sistema DEBE transicionar la orden de `devuelta` a
  `en_bodega` (si la zona de la orden es la central) o `en_bodega_satelite` (en otro caso), a
  través de `appendCambioEstado`, resolviendo el destino con la misma regla de zona que la
  liberación del cron (`resolverDestinoCierre` + `findCentralZonaId`).

- **R14** — CUANDO la bodega recupera, el sistema DEBE limpiar `mensajero_asignado_id` y
  `asignado_at` (handoff limpio a la bodega), igual que la liberación por SLA de la feature 99.

- **R15** — SI el actor no es la bodega responsable de la zona de la orden —maestro/admin cuando la
  zona resuelve a la bodega central; `adminSatelite` SOLO cuando la zona de la orden coincide con
  su propia zona— ENTONCES el sistema DEBE responder `forbidden` sin efectos.

- **R16** — SI la orden ya NO está en `devuelta` al recuperar, ENTONCES el sistema DEBE responder
  `conflict` de forma idempotente, sin efectos (guarda por estado en el UPDATE).

- **R17** — La transición de recuperación DEBE registrarse en el historial con `actor_usuario_id`
  = el admin que la ejecutó y un `origen_tipo` que la distinga de la liberación del cron
  (`liberacion_devuelta_sla`) — valor propuesto `recuperacion_manual`; decisión final en
  "Preguntas abiertas" Q2.

- **R18** — CUANDO la bodega recupera, la orden DEBE quedar fuera de `devuelta` (de modo que el
  cron SLA la salte) y volver a ser ASIGNABLE por la bodega en el flujo normal de asignación.

- **R19** — La recuperación manual NO DEBE encender `orden.prioridad` (la prioridad es de las
  órdenes liberadas por VENCIMIENTO del cron; es competencia de la feature 101). Ver Q en el
  gate.

---

## C. Transversales (aplican a ambas acciones)

- **R20** — Toda transición de esta feature DEBE ejecutar el UPDATE de `orden.estatus_id` y el
  append al historial en la MISMA transacción; SI el append falla, la transición se revierte
  (atomicidad del choke point 49).

- **R21** — Las acciones manuales DEBEN guardar su UPDATE por `estatus_id = devuelta`
  (`updateMany` con `count`), de modo que ante una carrera con el cron SLA de la feature 99 a lo
  sumo UNA gane y la otra sea no-op (sin doble efecto ni doble transición).

- **R22** — Ambas acciones DEBEN resolver el actor SERVER-SIDE (Server Action con sesión), y la
  página que expone cada acción DEBE aplicar defensa en profundidad por rol (guarda de la página
  además de la del service).

- **R23** — Ambas acciones DEBEN validar su entrada en el borde con zod: `ordenId` como uuid;
  `fechaReprogramacion` como `YYYY-MM-DD`. Entradas inválidas → `validation_error` antes de tocar
  el service.

- **R24** — El sistema NO DEBE registrar PII (teléfono, destinatario) ni secretos en los logs de
  estas acciones.

---

## Preguntas abiertas (gate F1.4 — cada una con recomendación)

**Q1 — Reprogramar por el admin de tienda: ¿gestión sintética o transición aparte? ¿motivo?
¿cómo cuenta para intentos/SLA?**
Recomendación: modelarla como una GESTIÓN SINTÉTICA `resultado=reprogramada` con
`fecha_reprogramacion` (actor = adminTienda), NO como una transición sin gestión. Motivo: es la
ÚNICA forma de REUSAR intacto el bloqueo + liberación de la feature 46 (su cron
`findOrdenesLiberables` lee `fecha_reprogramacion` de la gestión `reprogramada` vigente; sin
gestión la orden quedaría bloqueada para siempre). `motivo` OPCIONAL (la fecha es el dato
crítico; la reprogramación de tienda ocurre tras contactar al cliente y forzar un texto añade
fricción). No cuenta como intento (R8) y no altera la ventana SLA (al salir de `devuelta` el cron
99 la ignora; R9). `origen_tipo = reprogramacion_tienda` (valor NUEVO) para que la línea de
tiempo distinga tienda vs mensajero vs cron. Riesgo cubierto: la gestión es money-neutral (R10,
verificado) aunque quede atribuida al cierre del mensajero (consistente con las reprogramadas
existentes).

**Q2 — Recuperar a bodega: ¿reusa `liberarDevueltaSla` (99)? ¿`origen_tipo` nuevo? ¿limpia
mensajero?**
Recomendación: NO reusar `liberarDevueltaSla` tal cual (ese método fija actor NULL y
`origen_tipo=liberacion_devuelta_sla`, que etiquetarían una acción MANUAL como del cron y
perderían al actor para auditoría). Añadir un método hermano que replique su UPDATE guardado +
limpieza de mensajero + append, pero con `actor = el admin` y `origen_tipo = recuperacion_manual`
(valor NUEVO, análogo a `liberacion_devuelta_sla`). SÍ limpia mensajero y `asignado_at` (R14),
igual que la liberación del cron (nuevo intento, handoff limpio).

**Q3 — Autorización exacta.**
Recomendación: CONFIRMADA — tienda: su propia tienda (`orden.tienda_id = actor.usuarioId`,
patrón `OrdenService`/`NovedadesService`); bodega central: maestro/admin cuando la zona resuelve
a la central; satélite: `adminSatelite` SOLO su zona (`findUsuarioZonaId == orden.zonaId`, patrón
`DevolucionOrigenService.esBodegaResponsable`). Guarda SERVER-SIDE en el service + defensa en
profundidad en la página (R15/R22). Sin cambios de rol nuevos.

**Q4 — UI: ¿ambas acciones viven en /novedades? ¿/novedades deja de ser solo-adminTienda?**
Recomendación: SEPARAR por dueño de la acción, para NO romper la invariante de `/novedades` como
vista solo-`adminTienda`:
- REPROGRAMAR → en `/novedades` (adminTienda), botón + modal de fecha junto a `ContactoButtons`.
- RECUPERAR A BODEGA → en las superficies que YA tiene cada bodega (patrón exacto de la feature
  48 "Devolver a la tienda"): `adminSatelite` en `/recepcion-satelite` (acotado a su zona);
  maestro/admin en `/ordenes` sobre las órdenes `devuelta` de la zona central. NO se abre
  `/novedades` a la bodega ni se crea una página nueva (regla "sin sobre-ingeniería").
Alternativa descartada en `design.md §Alternativas`.

**Q5 — Interacción con el cron 99: ¿basta sacar la orden de `devuelta`? ¿hay carrera?**
Recomendación: CONFIRMADO — sacar la orden de `devuelta` (por cualquiera de las 2 acciones) es
suficiente para que el cron 99 la salte: `findDevueltasSla` filtra `estatus = devuelta`, y sus
UPDATE de escalado/liberación van guardados por `estatus_id = devuelta`. No hay carrera dañina:
la acción manual también guarda por `estatus_id = devuelta` (R21), así que manual y cron son
mutuamente excluyentes por el `count` del `updateMany`; el perdedor es no-op. No se requiere nada
adicional (ni lock ni flag).

**Q-bonus (feature 101) — ¿la recuperación manual enciende `orden.prioridad`?**
Recomendación: NO. La columna `orden.prioridad` NO existe hoy (feature 101 pendiente), y la
prioridad está pensada para las órdenes liberadas por VENCIMIENTO del cron, no por acción manual.
Queda FUERA de alcance de la 100 (R19). Solo se lleva al gate para ratificarlo.
