# Feature 110 — Prioridad de reasignación unificada: reprogramadas y recuperadas

Requisitos en notación EARS. Cada `R<n>` es testeable y sin detalle de
implementación. La feature es de zona **backend**, complejidad **medium**, y es
ADITIVA sobre la 101 (ya en `dev`, `orden.prioridad` existe). **Sin migración.**

## Contexto (verificado contra el código de `dev`)

- Hoy SOLO el cron SLA enciende `prioridad`: `DevolucionSlaRepository.liberarDevueltaSla`
  añade `prioridad: true` al `data` de su `updateMany` guardado por `estatus_id = devuelta`
  (`origen_tipo = liberacion_devuelta_sla`).
- `LiberacionReprogramadaRepository.liberarOrden` (reprogramadas, feature 46, hoy job
  recurrente de la 90) transiciona `reprogramada → en_bodega` / `en_bodega_satelite` vía
  `updateMany` guardado por `estatus_id = reprogramada` (`origen_tipo = liberacion_reprogramada`,
  actor NULL). HOY su `data` NO toca `prioridad`.
- `RecuperacionBodegaRepository.recuperarABodega` (recuperación manual, feature 100)
  transiciona `devuelta → en_bodega` / `en_bodega_satelite` vía `updateMany` guardado por
  `estatus_id = devuelta` (`origen_tipo = recuperacion_manual`, actor = admin). HOY su `data`
  NO toca `prioridad`.
- El consumo del flag (orden `prioridad DESC` primero + resalte de fila) ya existe en la 101
  (`OrdenRepository`), cubre `en_bodega` y `en_bodega_satelite`, y NO se toca en esta feature.
- `prioridad` se APAGA (`false`) al reasignar en `OrdenRepository.asignarBodegaLote` y
  `asignarSateliteLote`; ese ciclo NO se modifica.

## Requisitos

**R1 — Encendido en la liberación de reprogramadas.** CUANDO la liberación programada
transiciona una orden `reprogramada` a bodega (`reprogramada → en_bodega` /
`en_bodega_satelite`, `origen_tipo = liberacion_reprogramada`), el sistema DEBE fijar
`prioridad = true` en esa orden dentro de la MISMA transacción/escritura de la liberación.

**R2 — Encendido en la recuperación manual.** CUANDO la recuperación manual a bodega
transiciona una orden `devuelta` a bodega (`devuelta → en_bodega` / `en_bodega_satelite`,
`origen_tipo = recuperacion_manual`), el sistema DEBE fijar `prioridad = true` en esa orden
dentro de la MISMA transacción/escritura de la recuperación.

**R3 — Idempotencia del encendido.** SI la escritura guardada de la liberación (R1) o de la
recuperación (R2) no afecta ninguna fila (la orden ya salió de su estado de origen: re-corrida
del job o carrera con el cron SLA), ENTONCES el sistema NO DEBE modificar `prioridad`.

**R4 — Encendido atómico (concurrencia-seguro).** El sistema DEBE encender `prioridad` como
parte del MISMO `updateMany` guardado por estado que cada operación ya ejecuta (R1 y R2), sin
introducir una escritura adicional ni una segunda transición.

**R5 — Sin migración.** El sistema DEBE reutilizar la columna existente `orden.prioridad`
(feature 101) y NO DEBE introducir migración, cambio de esquema ni cambio de RLS.

**R6 — Money-neutral y sin efectos colaterales.** El sistema NO DEBE alterar ningún otro campo,
la transición de estado, el actor, el `origen_tipo`, el historial ni ningún cálculo monetario de
las operaciones (R1/R2); el ÚNICO cambio observable respecto al comportamiento previo es
`prioridad = true`.

**R7 — Regresión del encendido por SLA.** MIENTRAS exista la liberación por SLA (features 99/101),
el sistema DEBE seguir fijando `prioridad = true` al liberar por vencimiento de la ventana
`not_found` (`origen_tipo = liberacion_devuelta_sla`), sin regresión.

**R8 — Regresión del apagado al reasignar.** CUANDO una orden prioritaria se reasigna a un
mensajero desde la bodega dueña (bodega central o satélite), el sistema DEBE fijar
`prioridad = false` en la MISMA escritura que asigna el mensajero, sin regresión (feature 101/R5).

**R9 — Escalado excluido.** SI una orden `devuelta` se escala a `rechazada` por el cron SLA
(`origen_tipo = escalado_devuelta_sla`), ENTONCES el sistema NO DEBE fijar `prioridad = true`
(el escalado no retorna a bodega para reasignar).

**R10 — Consumo del listado intacto.** El sistema DEBE reutilizar el orden prioridad-first y el
resalte de fila ya existentes (feature 101) para las órdenes que ahora encienden `prioridad`
(reprogramadas y recuperadas caen en `en_bodega` / `en_bodega_satelite`), sin modificar la lógica
de listado, orden ni resalte.

## Preguntas abiertas — gate F1.4 (con recomendación)

**Q1 — ¿La recuperación MANUAL debe encender `prioridad`?** La recuperación a bodega (feature 100)
es una acción DELIBERADA del admin, no automática; podría argumentarse que el admin ya decide el
orden a mano.
*Recomendación (por defecto): SÍ, encenderla.* La orden recuperada vuelve exactamente a la misma
superficie de reasignación (`en_bodega` / `en_bodega_satelite`) que las liberadas por SLA, y quien
recupera no es necesariamente quien reasigna después (otro turno/persona): el flag evita que la
orden se pierda en el backlog. Es el objetivo explícito de la 110 ("devueltas y recuperadas salen
prioritarias"). NOTA: esto invierte la decisión de la 101/R3 para la recuperación manual y vuelve
stale los comentarios de `RecuperacionBodegaRepository` y `DevolucionSlaRepository` que hoy dicen
"la recuperación MANUAL NO toca prioridad" (deben actualizarse).

**Q2 — ¿Alguna liberación a bodega que NO deba ser prioritaria?** ¿Existe un caso donde una
reprogramada o una recuperada NO deba ir primero?
*Recomendación (por defecto): NO, todas prioritarias.* No se identificó ninguno: toda orden que
retorna a bodega para reasignar comparte el objetivo de no quedar invisible en el backlog. El único
retorno excluido es el escalado a `rechazada` (R9), que no vuelve a bodega para reasignar.

**Q3 — ¿Diferenciar el resalte por origen (SLA vs reprogramada vs recuperación)?**
*Recomendación (por defecto): NO.* `prioridad` es un booleano único; el resalte es uniforme y ya
existe en la 101. Diferenciar por origen ampliaría el alcance a frontend sin necesidad operativa
declarada. Fuera de alcance de la 110.
