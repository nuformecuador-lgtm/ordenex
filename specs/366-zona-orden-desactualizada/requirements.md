# Ficha 366 — la zona estampada en la orden no sigue a la configuración de zonas

**Zona:** fullstack. **SDD:** sí. **Rama:** `fix/366-zona-orden-desactualizada`.

## Problema (diagnosticado, no se re-investiga)

`orden.zona_id` se deriva **una sola vez**, al crear la orden, a partir de la N:M `zona_distrito`.
Cuando un administrador mueve un distrito de una zona a otra desde la pantalla de zonas
(`ZonaRepository.update`), la orden ya creada **no se entera**: sigue con la zona vieja estampada, y
hoy **no existe ninguna vía manual** para corregirla (`CorregirDatosClienteService` solo re-deriva la
zona cuando el distrito **cambia de valor**; re-elegir el mismo distrito es un no-op).

Medido en producción el 2026-09-03: 42 órdenes desalineadas (mismo par de zonas), 41 de ellas en
`en_ruta_bodega_satelite` y 1 en `en_bodega_central`. La zona vieja estampada bloqueaba literalmente
la operación: `OrdenRepository.recibirEnSatelite` acota su guarda por la zona del actor, así que la
bodega de destino correcta no podía recibir esas órdenes. El leader ya re-estampó esas 42 a mano como
precondición fuera de esta ficha; **no** es evidencia de que el problema esté resuelto.

## Decisiones ya tomadas por el humano (2026-09-03) — no se reabren

1. **La propagación es automática al guardar la zona.** No una acción manual aparte, no un cron.
2. **No se re-tarifa hacia atrás.** Una orden ya facturada conserva su zona.

## Requisitos (EARS)

### Disparo y alcance del evento

**R1** — El sistema DEBE re-derivar automáticamente la zona de las órdenes afectadas cada vez que se
guarda una edición de una zona existente, sin que quien la guarda tenga que iniciar una acción aparte
ni confirmar un paso intermedio.

**R2** — CUANDO un distrito quede asociado, tras el guardado, a EXACTAMENTE una zona, el sistema DEBE
tratar esa zona como la zona correcta de ese distrito a efectos de esta re-derivación.

**R3** — El sistema NO DEBE asignar ninguna zona a un distrito que, tras el guardado, quede asociado a
cero zonas o a más de una: en ninguno de los dos casos cambia la zona de ninguna orden de ese distrito
por este mecanismo.

**R4** — CUANDO un distrito resuelva (R2) una zona correcta distinta de la zona hoy estampada en una
orden viva de ese distrito, y esa orden sea ELEGIBLE (R6), el sistema DEBE actualizar la zona de esa
orden a la zona resuelta, dentro de la misma operación de guardado.

**R5** — El sistema DEBE considerar, en cada guardado de una zona, tanto los distritos que la zona
tenía asignados ANTES del guardado como los que le quedan asignados DESPUÉS, de modo que volver a
guardar una zona sin cambios de fondo también reconcilie cualquier desalineación previa de sus propios
distritos.

### Elegibilidad de la orden (el corte de "ya facturada")

**R6** — Una orden es ELEGIBLE para esta re-derivación automática únicamente si: (a) no está
eliminada, (b) no tiene todavía ningún detalle congelado en un cierre, y (c) no tiene ninguna gestión
vigente (no anulada) cuyo resultado sea `entregada`, `rechazada` o `incidente`. Una gestión vigente con
resultado `reprogramada` o `devuelta` NO hace inelegible a la orden (enmendado el 2026-09-03; ver
`design.md` §1).

**R7** — SI una orden no es ELEGIBLE (R6) pero su distrito resuelve (R2) una zona distinta de la
estampada, ENTONCES el sistema DEBE dejar esa orden sin cambios y sin registrar ninguna fila de
historial por ella.

**R8** — El sistema NUNCA DEBE modificar ni crear un detalle de cierre como consecuencia de esta
re-derivación; un detalle de cierre ya emitido permanece exactamente igual.

**R9** — El sistema NO DEBE modificar ningún otro campo de la orden (estado, mensajero asignado, monto
a cobrar, dirección, provincia, cantón, distrito, etc.) como parte de esta re-derivación: únicamente la
zona.

### Rastro (historial de acciones, ficha 362)

**R10** — CUANDO la re-derivación cambie efectivamente la zona de una orden, el sistema DEBE registrar
en el historial de acciones el hecho —quién guardó la zona, cuándo, y qué orden se vio afectada— y NO
DEBE registrar en esa fila la dirección, el distrito, la zona anterior ni la zona nueva.

**R11** — Todas las filas de historial que resulten de un mismo guardado de zona DEBEN compartir un
mismo identificador de lote, distinguible del de otro guardado.

### Visibilidad para quien guarda la zona

**R12** — CUANDO el guardado de una zona termine con éxito, el sistema DEBE informar, en la misma
respuesta, cuántas órdenes cambiaron de zona por esta re-derivación (incluido cero).

### Alcance de la acción

**R13** — El sistema DEBE aplicar esta re-derivación únicamente al EDITAR una zona existente, y NO
DEBE aplicarla al CREAR una zona nueva.

**R14** — El sistema DEBE ser idempotente: si se repite el guardado de una zona sin que exista ninguna
orden elegible cuyo distrito difiera de su zona estampada, la cantidad informada en R12 DEBE ser cero
y no debe registrarse ninguna fila de historial nueva.

## Preguntas cerradas en la revisión de aprobación (2026-09-03)

**Q1 — Nombre/etiqueta del nuevo tipo de acción del catálogo.** CERRADA, sin objeción: se mantiene
`orden_zona_reconciliada` / "Actualizó la zona de una orden", categoría `mueve_dinero` (`design.md`
§7).

**Q2 — ¿Hace falta contar también las órdenes NO elegibles que quedaron con drift residual?** CERRADA:
NO. R12 informa únicamente cuántas órdenes se reconciliaron; no se añade un segundo conteo de deuda
residual. Queda declarado como riesgo aceptado en `design.md` §8, no como pregunta pendiente.
