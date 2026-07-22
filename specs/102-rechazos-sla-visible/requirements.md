# Feature 102 — Ingreso de bodega por rechazos SLA VISIBLE en cierres + aviso a tienda y bodega — requirements.md

> Requisitos en notación EARS (docs/specs.md). Cada `R<n>` es verificable con un test
> (mapa en `tasks.md`). Money-marcado con **[💰]** = toca serialización/aritmética de dinero,
> aunque esta feature **NO mueve dinero** (solo LEE/EXPONE lo ya snapshoteado por 56).
>
> **Gate F1.4 (2026-07-22, decidido por el humano — NO reabrir):** el mecanismo del aviso es
> **VISIBILIDAD DERIVADA**. Prohibido: tabla de notificaciones, feed, campana, badge persistido,
> email. La feature es lectura/exposición sobre el snapshot existente de 56 y el historial
> inmutable de 49/99. Objetivo: **sin migración** (se justifica abajo por qué es alcanzable).

## Contexto de una línea (verificado en código)

El cron SLA (feature 99, `DevolucionSlaRepository.escalarDevueltaSla`) escala una orden
`devuelta → rechazada` creando una **gestión sintética** `resultado = "rechazada"`,
`cierre_id = NULL`, sin evidencia ni causa, y registra la transición por el choke point con
`origen_tipo = "escalado_devuelta_sla"` **enlazando esa gestión** (`gestion_orden_id`). El
snapshot de la feature 56 (`ingresoBodegaPorResultado` / `derivarIngresoBodega`) la cobra en el
PRÓXIMO cierre como `gestion_orden.ingreso_bodega_rechazo`, agregado en
`cierre_dia.total_ingreso_bodega_rechazos`. Ese total **HOY mezcla** rechazos SLA (cron) con
rechazos manuales (mensajero). Esta feature los **SEPARA** y hace visible el subtotal SLA, y
expone a la tienda que sus órdenes llegaron a rechazo por SLA con su monto.

### Hallazgos verificados (con Read/Grep, no supuestos)

- La **distinción limpia** SLA vs manual es el `origen_tipo` de `orden_historial_estado`
  (append-only, INMUTABLE — modelo `OrdenHistorialEstado`, feature 49): un rechazo SLA tiene una
  fila con `origen_tipo = "escalado_devuelta_sla"` enlazada a la gestión por `gestion_orden_id`;
  un rechazo manual del mensajero tiene `origen_tipo = "gestion"`. El valor del enum existe en
  `lib/types/orden-historial.ts` (`ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`). La relación es
  `GestionOrden.historialEstados` / `OrdenHistorialEstado.gestion` (schema verificado).
- La query del detalle de cierre del admin (`CierresAdminRepository.GESTION_ADMIN_SELECT`) HOY
  **NO** trae el `origen_tipo`: hay que extenderla para derivar el flag por gestión.
- El monto por gestión (`ingreso_bodega_rechazo`) YA está congelado (56); el subtotal SLA es una
  **partición money-safe** de números ya congelados por una clasificación INMUTABLE → no requiere
  columna nueva ni migración (ver `design.md §3`).
- La orden SALE de `/novedades` al pasar a `rechazada` (predicado anclado a `estatus = devuelta`,
  feature 99): `/novedades` por sí solo NO avisa del rechazo → se define una superficie derivada
  de solo-lectura para la tienda.
- El ledger de la tienda (`/mi-wallet`, `CATEGORIA_TIENDA_LABEL`) NO incluye el `cobroRechazado`
  de 56: ese ingreso es de la BODEGA, no de la tienda. A la tienda su wallet la mueve el
  `flete_devolucion`, concepto DISTINTO. Esto genera una **pregunta abierta** sobre qué monto
  mostrar a la tienda (ver "Preguntas abiertas", con recomendación por defecto = el monto de 56).

### Fuera de alcance

- Cambiar el snapshot de 56, la aritmética de 56/39, o los totales ya congelados.
- Cualquier movimiento de wallet / caja / asiento contable (42+): esta feature NO mueve dinero.
- El pago al mensajero (39), el dinero recibido por método (37/40), el flete/comisión/IVA (18/43).
- Reabrir el mecanismo del aviso (el gate ya fijó "visibilidad derivada").

---

## Requisitos (EARS)

### Clasificación SLA vs manual (backend, derivada del historial inmutable)

**R1** — CUANDO el sistema deba clasificar una gestión con `resultado = "rechazada"`, el sistema
DEBE derivar un flag `esRechazoSla` en `true` SÍ Y SOLO SÍ existe una fila enlazada de
`orden_historial_estado` con `gestion_orden_id` = esa gestión Y `origen_tipo =
"escalado_devuelta_sla"`; en cualquier otro caso el flag DEBE ser `false`.

**R2** — CUANDO una gestión `rechazada` proviene de un rechazo manual del mensajero
(`origen_tipo = "gestion"`), el sistema DEBE clasificarla como NO-SLA (`esRechazoSla = false`),
AUNQUE tenga un `ingreso_bodega_rechazo` snapshoteado (el monto no distingue el origen; solo el
historial lo hace).

**R3** — El sistema DEBE derivar la clasificación SLA EXCLUSIVAMENTE del `origen_tipo` inmutable
(append-only) ya escrito por la feature 99, y NO DEBE introducir una columna de snapshot nueva,
tabla nueva, ni migración para distinguir SLA de manual (objetivo del gate: sin migración).

### Desglose money-safe del ingreso de bodega por rechazos (backend) **[💰]**

**R4 [💰]** — CUANDO el sistema componga el desglose del "ingreso de bodega por rechazos" de un
cierre, el sistema DEBE particionar los montos por gestión YA snapshoteados
(`ingreso_bodega_rechazo`) en un subtotal SLA (gestiones con `esRechazoSla = true`) y un subtotal
manual (el resto), con aritmética decimal exacta (`Prisma.Decimal`) y salida STRING de dos
decimales.

**R5 [💰]** — El sistema DEBE garantizar que el subtotal SLA MÁS el subtotal manual sea IGUAL al
`total_ingreso_bodega_rechazos` ya congelado del cierre (la partición no crea ni pierde dinero).

**R6 [💰]** — Al producir el desglose SLA/manual, el sistema NO DEBE alterar
`total_ingreso_bodega_rechazos`, `total_pago_mensajero`, ni los totales de dinero recibido
(`total_efectivo/simpe/transferencia/general`): la feature es solo-lectura sobre el snapshot.

**R7 [💰]** — DADO que la clasificación SLA se deriva de historial INMUTABLE y de montos por
gestión ya CONGELADOS, el sistema DEBE producir el MISMO desglose SLA/manual para un cierre tanto
al momento de generarlo como cuando ya está cerrado, y ese subtotal NO DEBE cambiar SI la tarifa
se edita después (respeta el patrón de congelado, feature 69).

### Visibilidad en cierres — bodega central y satélite (frontend)

**R8** — CUANDO un administrador con acceso al detalle de un cierre (maestro/admin sobre bodega
central, o adminSatelite sobre su zona) lo visualiza, el sistema DEBE exponer, de forma
DISTINGUIBLE, el subtotal SLA del ingreso de bodega por rechazos, separado del subtotal manual y
junto al total combinado ya existente.

**R9** — CUANDO un administrador visualiza la sección de rechazadas del detalle de un cierre, el
sistema DEBE marcar cada fila de gestión como SLA (por el cron) o manual (por el mensajero), según
`esRechazoSla`, para que el origen de cada ingreso sea auditable.

**R10** — DONDE el visualizador sea adminSatelite, el sistema DEBE exponer el mismo desglose
SLA/manual para los cierres de su zona a través de la superficie de detalle de cierre que YA
consume (`verCierreDetalle`, alcance satélite), SIN una pantalla nueva.

**R11** — El sistema NO DEBE exponer el desglose de ingreso de bodega por rechazos (ni el subtotal
SLA) en la vista del cierre PROPIO del mensajero (`/cierre-dia`), consistente con la feature 56 (el
mensajero no percibe este ingreso).

### Aviso a la tienda — superficie derivada de solo-lectura (backend + frontend)

**R12** — MIENTRAS una orden de la tienda esté en `estatus = "rechazada"` alcanzado por el cron
SLA (existe transición con `origen_tipo = "escalado_devuelta_sla"` hacia `rechazada` para esa
orden), el sistema DEBE incluirla en una superficie derivada de solo-lectura accesible al
adminTienda de esa tienda, en una pantalla que la tienda YA visita, SIN tabla nueva.

**R13** — El sistema DEBE acotar SIEMPRE la lista de rechazos-por-SLA de la tienda al ámbito del
adminTienda autenticado (predicado: `estatus = rechazada` + tienda del actor + no borrada + origen
SLA), reusando el patrón de acotamiento por tienda de `/novedades` (feature 87/99); cualquier otro
rol NO DEBE ver esta superficie.

**R14 [💰]** — CUANDO el sistema liste los rechazos-por-SLA de la tienda, el sistema DEBE mostrar,
por cada orden, su identificador (`numGuia` con placeholder si es `null`, `numRemision` y
destinatario) y su MONTO de rechazo anclado en el concepto de la feature 56
(`ingreso_bodega_rechazo` / `cobroRechazado` — "el dinero que la 99 registra"), serializado como
STRING de dos decimales. **[La FUENTE del monto está sujeta a la Pregunta Abierta Q1; se
implementa sobre la recomendación por defecto = monto de 56.]**

**R15** — CUANDO una orden ya NO esté en `estatus = "rechazada"` por SLA o esté borrada, el sistema
DEBE retirarla de la lista de rechazos-por-SLA de la tienda (predicado anclado al estado VIVO, sin
doble superficie ni conteo duplicado).

### No-dinero, no-notificación, money-safe (transversal) **[💰]**

**R16** — El sistema NO DEBE crear, modificar ni mover dinero como parte de esta feature: todas
las salidas son proyecciones de solo-lectura sobre snapshots existentes (56) e historial inmutable
(49/99). NO DEBE emitir movimiento de wallet, caja, ni alterar totales de cierre.

**R17** — El sistema NO DEBE introducir tabla de notificaciones, feed, campana, badge persistido ni
email; la visibilidad DEBE derivarse EXCLUSIVAMENTE en pantallas que la tienda/bodega ya acceden
(decisión del gate).

**R18 [💰]** — El sistema NO DEBE exponer ningún monto como `number` ni con pérdida de precisión;
todo monto cruza el borde como STRING de dos decimales, y toda suma usa `Prisma.Decimal` (nunca
`parseFloat`/`Number`).

---

## Trazabilidad R → test (detalle en `tasks.md`)

| Req | Test (archivo / caso) |
| --- | --- |
| R1  | `tests/unit/utils/rechazo-sla-flag.test.ts` — `esRechazoSla` true con fila origen `escalado_devuelta_sla` enlazada |
| R2  | idem — rechazo manual (`origen_tipo = gestion`) con ingreso != 0 → `esRechazoSla` false |
| R3  | `tests/integration/db/no-migration-102.test.ts` — el schema/migraciones NO cambian; derivación por join |
| R4  | `tests/unit/utils/desglose-rechazos-sla.test.ts` — particiona SLA/manual money-safe STRING escala 2 |
| R5  | idem — subtotal SLA + subtotal manual === total del cierre |
| R6  | `tests/unit/services/cierres-admin-service.test.ts` — el desglose NO altera totales 56/39/recibido |
| R7  | `tests/unit/services/cierres-admin-service.test.ts` — mismo desglose live/cerrado; estable a cambio de tarifa |
| R8  | `tests/unit/services/cierres-admin-service.test.ts` — detalle expone subtotal SLA separado del manual |
| R9  | `e2e/cierres-admin-rechazos-sla.spec.ts` — cada fila rechazada marcada SLA/manual |
| R10 | `tests/unit/services/cierres-admin-service.test.ts` — alcance satélite recibe el mismo desglose |
| R11 | `tests/unit/services/cierre-dia-service.test.ts` — `/cierre-dia` (mensajero) NO expone el desglose |
| R12 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` — lista incluye orden rechazada por SLA de la tienda |
| R13 | idem — acotada a la tienda del actor; otro rol → forbidden |
| R14 | idem + `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` — monto de 56 STRING escala 2 |
| R15 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` — orden no-rechazada/borrada no aparece |
| R16 | `tests/unit/services/cierres-admin-service.test.ts` — sin movimiento de wallet/caja en el flujo de lectura |
| R17 | `tests/integration/db/no-migration-102.test.ts` — no hay tabla/enum de notificación nuevos |
| R18 | transversal — asserts de tipo STRING en cada DTO/monto nuevo |

---

## Preguntas abiertas — Gate F1.4 (cada una con recomendación por defecto)

> El mecanismo (visibilidad derivada) YA está cerrado por el gate. Estas preguntas son sub-decisiones
> que NO invento; el humano las resuelve antes de implementar. La recomendación es la opción por
> defecto verificada contra el código.

**Q1 [💰] — LA PRINCIPAL: ¿qué monto se muestra a la TIENDA por un rechazo SLA?**
Hallazgo VERIFICADO: el `cobroRechazado` de 56 (`ingreso_bodega_rechazo`) es un ingreso de la
BODEGA; NO figura en el ledger de la tienda (`/mi-wallet` no tiene categoría para él). Lo que SÍ
mueve la wallet de la tienda al devolverse/rechazarse una orden es el `flete_devolucion` (concepto
DISTINTO, feature 43). Hay ambigüedad real sobre cuál es "su monto" para la tienda.
- **Recomendación por defecto:** el **monto de 56** (`ingreso_bodega_rechazo` / `cobroRechazado`),
  por el título literal de la feature ("el dinero que la 99 registra" = el ingreso de bodega por
  rechazo). Es transparencia informativa: "tu orden llegó a rechazo y generó ₡X de ingreso de
  bodega", no un cargo a la tienda.
- **Alternativa:** el `flete_devolucion` (lo que realmente impacta la wallet de la tienda). Si el
  humano quiere "el monto que la tienda paga/ve en su plata", esta es la respuesta y la superficie
  natural sería `/mi-wallet`, no `/novedades`. Se deja SIN resolver: R14 se implementa sobre la
  recomendación por defecto y se re-redacta si el humano elige la alternativa.

**Q2 [💰] — Disponibilidad del monto ANTES del cierre.**
Hallazgo: la gestión sintética SLA nace con `ingreso_bodega_rechazo = NULL` (el snapshot 56 se
fija en el PRÓXIMO cierre). Entre el escalado y ese cierre, el snapshot aún no existe.
- **Recomendación:** anclar al SNAPSHOT (R14) — mostrar el monto cuando ya está congelado y un
  estado "pendiente de cierre" mientras es `NULL`. Respeta literalmente "ancla en el snapshot de
  56" y NO cablea el resolver de tarifa en una superficie nueva.
- **Alternativa:** DERIVAR el monto pre-cierre con `ingresoBodegaPorResultado` + el resolver de
  tarifa (como hace la vista en vivo del mensajero), mostrándolo de inmediato. Más código y un
  número que podría cambiar si la tarifa se edita antes del cierre.

**Q3 — Ubicación de la superficie de la tienda.**
- **Recomendación:** una sección/pestaña de solo-lectura "Rechazos por SLA" DENTRO de `/novedades`
  (pantalla que la tienda ya visita; es la continuación natural de la orden que "se graduó" de
  novedad a rechazo), sin ítem de menú nuevo.
- **Alternativa descartada por defecto:** una ruta nueva dedicada (agrega superficie de navegación).

**Q4 — ¿El subtotal SLA también en la LISTA de cierres (cola/histórico), no solo en el detalle?**
- **Recomendación:** SOLO en el DETALLE del cierre (donde ya se leen las gestiones por gestión).
  Llevarlo a la lista exigiría un subquery agregado por cierre (el subtotal SLA no está
  snapshoteado) — mayor costo y roza el "sin migración". El desglose es un concepto de detalle.
- **Alternativa:** agregarlo también a la lista con un subquery agregado por cierre. Se descarta
  salvo que el humano lo pida.
