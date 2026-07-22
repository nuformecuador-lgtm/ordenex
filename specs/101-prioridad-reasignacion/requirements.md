# Feature 101 — Prioridad de reasignación de las órdenes liberadas por SLA

Requisitos en notación EARS. Cada `R<n>` es testeable y sin detalle de
implementación. La feature es fullstack de baja complejidad y ADITIVA sobre las
features 99 (cron SLA, ya en `dev`) y 100 (resolver novedad, ya en `dev`).

## Contexto (verificado contra el código de `dev`)

- El cron SLA de la feature 99 libera a bodega las órdenes en `devuelta` cuya
  ventana `not_found` venció con intentos por debajo del umbral, vía
  `DevolucionSlaRepository.liberarDevueltaSla` (transición
  `devuelta → en_bodega` / `en_bodega_satelite`, `origen_tipo =
  liberacion_devuelta_sla`).
- La bodega DUEÑA reasigna esas órdenes: la central (maestro/admin) desde el
  apartado `en_bodega` de `/ordenes`; la satélite (adminSatelite) desde el
  apartado "Recibidas" (`en_bodega_satelite`) de `/recepcion-satelite`.
- `orden` es una tabla existente con RLS ya habilitada (solo service-role). Esta
  feature NO crea tablas ni RLS nueva.

## Requisitos

**R1 — Indicador persistente.** El sistema DEBE registrar en cada orden un
indicador booleano `prioridad` cuyo valor por defecto es `false`.

**R2 — Encendido por liberación SLA.** CUANDO el cron SLA libera una orden a
bodega por vencimiento de la ventana `not_found` (transición `devuelta →
en_bodega` / `en_bodega_satelite` con `origen_tipo = liberacion_devuelta_sla`),
el sistema DEBE fijar `prioridad = true` en esa orden dentro de la MISMA
transacción de la liberación.

**R3 — No encendido por otras vías.** SI una orden sale de `devuelta` por
cualquier otra vía —escalado del cron SLA a `rechazada` (`origen_tipo =
escalado_devuelta_sla`) o recuperación/liberación MANUAL de la feature 100
(`origen_tipo = recuperacion_manual`)— ENTONCES el sistema NO DEBE fijar
`prioridad = true`.

**R4 — Idempotencia del encendido.** SI la transición de liberación no afecta
ninguna fila (la orden ya salió de `devuelta`; re-corrida o carrera del cron),
ENTONCES el sistema NO DEBE modificar `prioridad`.

**R5 — Apagado al reasignar.** CUANDO una orden prioritaria se reasigna a un
mensajero desde la bodega dueña (asignación desde la bodega central o asignación
de la bodega satélite), el sistema DEBE fijar `prioridad = false` en la MISMA
escritura que asigna el mensajero.

**R6 — Orden prioridad-first en la bodega central.** MIENTRAS el maestro/admin
visualiza el listado de reasignación de la bodega central (apartado `en_bodega`
de `/ordenes`), el sistema DEBE listar las órdenes con `prioridad = true` antes
que las de `prioridad = false`, conservando el orden vigente (recencia) como
criterio de desempate.

**R7 — Orden prioridad-first en la bodega satélite.** MIENTRAS el adminSatelite
visualiza el listado de reasignación de su bodega (apartado "Recibidas",
`en_bodega_satelite`, de `/recepcion-satelite`), el sistema DEBE listar las
órdenes con `prioridad = true` antes que las de `prioridad = false`, conservando
el orden vigente como criterio de desempate.

**R8 — Resalte de fila.** DONDE una fila del listado de reasignación de la bodega
dueña corresponde a una orden con `prioridad = true`, el sistema DEBE resaltar
visualmente esa fila con un color llamativo y anunciar ese estado de forma
accesible (no solo por color).

**R9 — Exposición del indicador.** El sistema DEBE exponer `prioridad` en los DTO
de listado de las superficies de reasignación (listado de órdenes de `/ordenes`
y listado de la bodega satélite) para permitir el orden (R6/R7) y el resalte
(R8).

**R10 — Sin fuga a vistas ajenas.** El sistema NO DEBE reordenar ni resaltar por
`prioridad` en superficies ajenas a la reasignación de la bodega dueña (p. ej.
`/novedades`, el apartado "Devueltas" de recuperación manual, o el portal del
mensajero).

**R11 — Sin backfill.** Las órdenes existentes antes de esta feature DEBEN quedar
con `prioridad = false`; el sistema NO DEBE inferir prioridad retroactiva (no es
posible saber qué órdenes vencieron su ventana en el pasado).

**R12 — Migración aditiva y reversible.** El sistema DEBE introducir `prioridad`
mediante una migración Prisma ADITIVA con su `down.sql`, sin alterar la RLS ni
las columnas preexistentes de `orden`.

## Trazabilidad R → test (T13, rutas reales)

| Req | Test |
| --- | --- |
| R1  | `tests/integration/db/orden-prioridad-migration.test.ts` (columna BOOLEAN NOT NULL DEFAULT false + schema sin drift) |
| R2  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (liberar → `data` incluye `prioridad: true`) |
| R3  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (escalar `not.toHaveProperty("prioridad")`) + `tests/unit/repositories/recuperacion-bodega-repository.test.ts` (recuperación manual no toca `prioridad`) |
| R4  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (liberar `count = 0` → false, sin append) |
| R5  | `tests/unit/repositories/orden-repository.guia.test.ts` (`asignarBodegaLote` `prioridad: false`) + `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts` (`asignarSateliteLote` `"prioridad" = false`) |
| R6  | `tests/unit/repositories/orden-repository.test.ts` (`orderBy[0] = { prioridad: "desc" }`) |
| R7  | `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` (`orderBy [{prioridad:desc},{createdAt:desc}]`) |
| R8  | `tests/components/PrioridadResalte.test.ts` (clase + badge "Prioritaria") + `tests/components/RecepcionSateliteModule.test.tsx` (R8: Recibidas resalta) + `tests/components/DataTable.test.tsx` (prop `rowClassName`) |
| R9  | `tests/unit/repositories/orden-repository.test.ts` + `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` + `tests/unit/services/recepcion-satelite-service.test.ts` (DTO propaga `prioridad`) |
| R10 | `tests/components/RecepcionSateliteModule.test.tsx` (R10: "Devueltas" no resalta aunque `prioridad=true`) + gateo `en_bodega` en `OrdenesTabs.tsx` (default `resaltarPrioridad=false`) |
| R11 | `tests/integration/db/orden-prioridad-migration.test.ts` (DEFAULT constante, sin `UPDATE`/backfill) |
| R12 | `tests/integration/db/orden-prioridad-migration.test.ts` (`down.sql` DROP COLUMN, sin residuos) + round-trip real up→down→up (reviewer, en `progress/impl_101-prioridad-reasignacion.md`) |

## Preguntas abiertas — gate F1.4 (con recomendación)

**Q1 — Ciclo de vida de `prioridad`.** ¿Se apaga al reasignar a un mensajero o
queda encendida?
*Recomendación:* apagarla (`false`) en la MISMA escritura que asigna mensajero
desde bodega, en los dos puntos de reasignación: `OrdenRepository.asignarBodegaLote`
(usado por `GuiaAsignacionService.asignarDesdeBodega`, bodega central) y
`OrdenRepository.asignarSateliteLote` (usado por `AsignacionSateliteService.asignar`,
bodega satélite). Así una orden no hereda prioridad en ciclos futuros. `generarGuiaLote`
NO necesita tocarla (sus orígenes son `en_fulfillment`/`en_preparacion`, donde nunca
hay órdenes prioritarias); se deja fuera para no ampliar el cambio.

**Q2 — Alcance del orden + resalte.** ¿Dónde aplican el sort prioridad-first y el
resalte, y cómo desempata el orden?
*Recomendación:* aplican en las superficies de asignación de la bodega dueña: el
apartado `en_bodega` de `/ordenes` (maestro/admin) y el apartado "Recibidas"
(`en_bodega_satelite`) de `/recepcion-satelite` (adminSatelite). El sort es
`prioridad DESC` primero y LUEGO el orden vigente (recencia: `created_at DESC`
por defecto). NO se toca `/novedades`, el apartado "Devueltas", ni el portal del
mensajero. El indicador `prioridad` sólo es `true` mientras la orden está en
`en_bodega`/`en_bodega_satelite`, así que aunque el sort/resalte se implementen
por campo en el listado genérico, no aparecen filas resaltadas en otras tabs.

**Q3 — Superficie satélite.** ¿Dónde reasigna el adminSatelite las órdenes
liberadas por SLA?
*Recomendación:* en el apartado "Recibidas" de `/recepcion-satelite` (órdenes
`en_bodega_satelite`), que es de donde sale la acción "Asignar" hacia
`AsignarSateliteModal` → `AsignacionSateliteService.asignar`. El cron libera a
`en_bodega_satelite`, así que las prioritarias caen exactamente ahí. NO es el
grupo "Devueltas" que agregó la feature 100 (ese es la recuperación MANUAL,
`devuelta`, que por R3 no enciende prioridad).

**Q4 — Backfill.** ¿Se marca alguna orden histórica como prioritaria?
*Recomendación:* no. Default `false`, sin backfill: no se puede saber
retroactivamente qué órdenes vencieron su ventana `not_found`. (R11.)

**Q5 — ¿Toca la feature 99?** Encender `prioridad` en `liberarDevueltaSla`
modifica código de la 99 (ya en `dev`).
*Recomendación:* sí, es aceptable y mínimo: se añade `prioridad: true` al `data`
del `updateMany` guardado de la liberación (dentro de la guarda por
`estatus_id = devuelta`), sin tocar la lógica de ventanas/escalado. Rompe una
aserción del test `tests/unit/repositories/devolucion-sla-repository.test.ts`
(el `expect(upd.data).toEqual({ estatusId, mensajeroAsignadoId: null,
asignadoAt: null })`), que se AJUSTA para incluir `prioridad: true` (no se
afloja). El escalado (`escalarDevueltaSla`) y la recuperación manual (100)
quedan intactos y verificados por R3.
