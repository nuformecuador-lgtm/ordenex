# Feature 56 — Ingreso de bodega por rechazos (`cobroRechazado`) — requirements.md

> **F1.4 APROBADA por el humano el 2026-07-12** (SUPERSEDE "Preguntas abiertas"). Money-critical.
> Origen: SEPARADA de la feature 39. La 39 acotó el pago al MENSAJERO a `entregada -> cobroEntregado`;
> el `cobroRechazado` NO va al mensajero: es un **ingreso de la BODEGA** (satélite o central). `depends_on: 39`.
> Decisiones:
> - **Q1 (cuándo aplica):** el ingreso por rechazo aplica cuando la tarifa resuelta de la zona del mensajero
>   tiene `cobroRechazado > 0.00`; si es 0.00 o no hay tarifa → ingreso 0.00 (la condición vive EN la tarifa,
>   la captura el maestro por zona). Reusa el resolver `resolvePagoTarifa` de la 39, sin modelo nuevo.
> - **Q2 (qué resultados):** SOLO `rechazada` genera ingreso de bodega; `devuelta`/`reprogramada` = 0.00.
> - **Q3 (snapshot):** SNAPSHOT al solicitar (no derivado), money-critical, como 39/40.
> - **Q4 (niveles):** 3 niveles — `gestion_orden.ingreso_bodega_rechazo` + `cierre_dia.total_ingreso_bodega_rechazos`
>   + `cierre_bodega.total_ingreso_bodega_rechazos` (agregado). Migración aditiva + `down.sql`.
> - **Q5 (bodega responsable):** = destino del cierre (central si `esCentral`, satélite si no), misma resolución del cierre.
> - **Q6 (flag `tarifaFaltante`):** SÍ — añadir un flag `tarifaFaltante` resuelto SERVER-SIDE al DTO de detalle
>   (el resolver distingue `null` de `0.00` real), arreglando la deuda m1 de la 39 (aviso por heurística) para
>   entregas Y rechazos en este mismo PR.
> - **Q7 (UI):** exponer en las pantallas de cierre EXISTENTES (mensajero/admin/bodega), sin pantallas nuevas.
> Estado: `in_progress`.

## Contexto y alcance

Por cada gestión `rechazada` incluida en un cierre, el sistema calcula el `cobroRechazado`
de la tarifa de la zona (mismo resolver por zona+vehículo con fallback que la 39) y lo
ATRIBUYE a la bodega responsable del mensajero (central si su zona es central, satélite
en caso contrario). El monto se SNAPSHOTEA en el flujo de cierre (nivel gestión +
`cierre_dia` + agregado en `cierre_bodega`, espejo del pago-al-mensajero de la 39) y se
EXPONE en las pantallas de cierre existentes como "Ingreso de bodega por rechazos".

Es un concepto DISTINTO de: el pago al mensajero (39, `total_pago_mensajero`), el dinero
RECIBIDO por método de pago (37/40, `total_efectivo/simpe/transferencia/general`), lo que
se COBRA al cliente/tienda (18), y la caja central de Ordenex (42+).

### Hallazgo de modelo (verificado en código, no supuesto)

- El resolver `TarifaZonaMensajeroRepository.resolvePagoTarifa(zonaId, vehiculoId)` YA
  devuelve `PagoTarifa { cobroEntregado, cobroRechazado }` (ambos STRING escala 2). La 56
  REUSA ese resolver tal cual; **no lo duplica**. El campo `cobroRechazado` ya viaja en el
  DTO del resolver "para no reconsultar" (comentario en `ITarifaZonaMensajeroRepository.ts`).
- El destino de la bodega responsable ya lo resuelve `CierreDiaService.solicitarCierre`:
  `destinoTipo` (`bodega_central`/`bodega_satelite`) + `destinoZonaId` (zona del mensajero),
  vía `zonaRepo.findCentralZonaId()` con fallback seguro a satélite. La 56 reusa ese destino.
- El enum `GestionResultado` = `{ entregada, reprogramada, devuelta, rechazada }`
  (`schema.prisma`). La 56 solo considera `rechazada` (ver F1.4-Q2).
- El snapshot de la 39 vive en 3 columnas (`gestion_orden.pago_mensajero`,
  `cierre_dia.total_pago_mensajero`, `cierre_bodega.total_pago_mensajero`). La 56 replica
  el patrón con columnas nuevas para el ingreso de bodega.
- No existe hoy ningún flag en `orden`/`tienda`/`tarifa` que condicione "cuándo aplica el
  pago por rechazo": la regla condicional (F1.4-Q1) NO está definida en código ni docs.

### Fuera de alcance (otras features)

- El pago al MENSAJERO (39, ya hecho): esta feature no lo toca.
- Los COBROS al cliente/tienda: flete/comisión/IVA (18).
- La caja central de Ordenex y el libro de movimientos (42+); asiento contable del ingreso.
- Bloqueos/vencidos (41). La 56 solo CALCULA / SNAPSHOTEA / MUESTRA el ingreso de bodega
  por rechazos; NO lo asienta en ninguna caja ni ejecuta movimiento de dinero.

---

## Requisitos (EARS)

> Nota: los requisitos marcados `[F1.4-Qn]` dependen de una decisión abierta al final. Se
> redactan sobre la RECOMENDACIÓN del spec_author; si el humano decide distinto, se ajustan.

### Resolución de la tarifa (reuso del resolver de la 39)

**R1** — CUANDO el sistema deba resolver el ingreso de bodega por una gestión, el sistema
DEBE obtener el `cobroRechazado` de la tarifa resuelta por (`usuario.zona_id` del
MENSAJERO, `usuario.vehiculo_id`) con fallback a la tarifa por defecto de la zona
(`vehiculo_id IS NULL`), REUSANDO `resolvePagoTarifa` (sin duplicar el resolver).

**R2** — El ingreso de bodega DEBE calcularse a partir de la zona del MENSAJERO
(`usuario.zona_id`), NUNCA de la zona de la orden (`orden.zona_id`), consistente con la 39.

### Mapeo resultado -> ingreso de bodega

**R3** `[F1.4-Q1,Q2]` — CUANDO el resultado de la gestión es `rechazada` Y aplica el pago
por rechazo (condición F1.4-Q1), el sistema DEBE fijar el ingreso de bodega de esa gestión
en el `cobroRechazado` de la tarifa resuelta.

**R4** `[F1.4-Q2]` — CUANDO el resultado de la gestión es `entregada`, `reprogramada` o
`devuelta`, el sistema DEBE fijar el ingreso de bodega en `0.00` (no generan ingreso por
rechazo).

**R5** `[F1.4-Q1]` — SI para una gestión `rechazada` NO se satisface la condición de
aplicación del pago por rechazo (F1.4-Q1), ENTONCES el sistema DEBE fijar el ingreso de
bodega en `0.00`.

**R6** — SI no existe ninguna tarifa aplicable para la zona (ni específica por vehículo ni
por defecto), ENTONCES el sistema DEBE fijar el ingreso de bodega en `0.00` y NO DEBE
bloquear ni abortar el cierre (gap de datos seguro, mismo espíritu que la 39/R8).

**R7** — El sistema DEBE calcular todos los montos de ingreso con aritmética decimal exacta
(`Prisma.Decimal`) y exponerlos serializados como STRING con dos decimales; NUNCA con
`number`/`parseFloat`.

**R7b** — El ingreso de bodega por rechazos NUNCA DEBE pagarse al mensajero: es un concepto
INDEPENDIENTE de `gestion_orden.pago_mensajero` (39) y NUNCA DEBE alterar
`total_pago_mensajero` (39) ni los totales de dinero recibido por método de pago (37/40).

### Atribución a la bodega responsable

**R8** — El ingreso de una gestión `rechazada` DEBE atribuirse a la bodega RESPONSABLE del
mensajero = el DESTINO del cierre del día (`bodega_central` si la zona del mensajero es la
central, `bodega_satelite` en caso contrario), REUSANDO la resolución de destino que ya
calcula `CierreDiaService.solicitarCierre` (no re-resolver de forma distinta).

### Vista en vivo del cierre del mensajero (feature 37)

**R9** — MIENTRAS el mensajero visualiza su cierre del día (gestiones con
`cierre_id IS NULL`), el sistema DEBE exponer, por cada gestión `rechazada`, el ingreso de
bodega DERIVADO en ese instante (informativo, según R1-R6).

**R10** — MIENTRAS el mensajero visualiza su cierre del día, el sistema DEBE exponer el
TOTAL de ingreso de bodega por rechazos (suma de los ingresos por gestión), separado tanto
de los totales de dinero recibido como del total de pago al mensajero.

### Snapshot al solicitar el cierre (money-critical)

**R11** — CUANDO el mensajero solicita el cierre (`solicitarCierre`), el sistema DEBE
CONGELAR (snapshot) el ingreso de bodega de cada gestión `rechazada` incluida, resolviendo
la tarifa vigente en ese instante según R1-R6.

**R12** — CUANDO el mensajero solicita el cierre, el sistema DEBE CONGELAR el TOTAL de
ingreso de bodega por rechazos del cierre del día (suma de los ingresos por gestión
snapshoteados).

**R13** — El snapshot del ingreso (por gestión y total del cierre) DEBE persistirse en la
MISMA transacción atómica que crea el cierre y vincula sus gestiones (no debe existir un
cierre con gestiones vinculadas pero sin su ingreso snapshoteado, ni viceversa).

**R14** — SI la tarifa cambia después de solicitado el cierre, ENTONCES el ingreso de
bodega snapshoteado del cierre NO DEBE cambiar (el número congelado es la fuente de verdad).

### Vista del admin de cierres (feature 38)

**R15** — CUANDO un administrador (maestro/adminSatelite) ve el detalle de un cierre, el
sistema DEBE exponer, por cada gestión `rechazada` del cierre, el ingreso de bodega
SNAPSHOTEADO (no recalculado).

**R16** — CUANDO un administrador ve un cierre (cola, histórico o detalle), el sistema DEBE
exponer el TOTAL snapshoteado de ingreso de bodega por rechazos de ese cierre, separado de
los totales de dinero recibido y del total de pago al mensajero.

### Agregación en el cierre de bodega (feature 40)

**R17** — CUANDO el adminSatelite consolida los cierres de sus mensajeros y visualiza la
consolidación, el sistema DEBE exponer el TOTAL AGREGADO de ingreso de bodega por rechazos
(suma de los totales snapshoteados de los `cierre_dia` consolidables de su zona).

**R18** — CUANDO el adminSatelite solicita el cierre de bodega, el sistema DEBE CONGELAR el
total agregado de ingreso de bodega por rechazos en el `cierre_bodega`, en la MISMA
transacción que lo crea (money-critical, patrón R13).

**R19** — CUANDO el maestro ve el detalle de un cierre de bodega, el sistema DEBE exponer el
total de ingreso de bodega por rechazos de cada `cierre_dia` incluido y el total agregado
del cierre de bodega, ambos snapshoteados.

### Datos e integridad

**R20** — El ingreso de bodega por rechazos DEBE tratarse como un concepto INDEPENDIENTE:
agregarlo NUNCA debe alterar `total_efectivo`, `total_simpe`, `total_transferencia`,
`total_general` (37/40) ni `total_pago_mensajero` (39) existentes.

**R21** — La persistencia del snapshot de ingreso DEBE introducirse mediante una migración
ADITIVA (columnas nullable o con default) con su `down.sql` reversible; los cierres
anteriores a la migración DEBEN quedar con ingreso `0.00` (totales) o `null` (por gestión)
sin romper su lectura.

**R22** — El sistema NO DEBE exponer, por ninguna vía (DTO/serialización), un ingreso de
bodega como `number` ni con pérdida de precisión; siempre STRING con dos decimales.

### Deuda de la 39 (opcional — `[F1.4-Q6]`)

**R23** `[F1.4-Q6]` — DONDE el humano apruebe resolver la deuda de la 39, el sistema DEBE
exponer en el DTO de detalle de gestión un flag `tarifaFaltante` derivado SERVER-SIDE
(true cuando el resolver devolvió `null` = zona sin tarifa capturada), reemplazando la
heurística de frontend `entregada && pago === "0.00"` para entregas Y rechazos, eliminando
sus falsos positivos.

---

## Trazabilidad R -> test

| Req | Test (archivo / caso) |
| --- | --- |
| R1  | `tests/unit/utils/ingreso-bodega.test.ts` — usa cobroRechazado de la tarifa resuelta (reuso resolver) |
| R2  | `tests/unit/services/cierre-dia-service.test.ts` — resuelve por zona del mensajero, no de la orden |
| R3  | `tests/unit/utils/ingreso-bodega.test.ts` — rechazada + aplica -> cobroRechazado |
| R4  | idem — entregada/reprogramada/devuelta -> 0.00 |
| R5  | idem — rechazada sin aplicar (condición F1.4-Q1 falsa) -> 0.00 |
| R6  | idem — sin tarifa aplicable -> 0.00 sin lanzar |
| R7  | idem — Decimal exacto, salida STRING 2 decimales |
| R7b | `tests/unit/services/cierre-dia-service.test.ts` — ingreso NO altera pago_mensajero ni totales recibidos |
| R8  | `tests/unit/services/cierre-dia-service.test.ts` — ingreso atribuido al destino (central/satélite) del cierre |
| R9  | idem — listarCierreDia expone ingreso derivado por gestión rechazada |
| R10 | idem — expone totalIngresoBodegaRechazos separado de totales y de pago mensajero |
| R11 | idem — solicitarCierre snapshotea ingreso por gestión |
| R12 | idem — snapshotea total del cierre |
| R13 | `tests/unit/repositories/cierre-dia-repository.test.ts` — crearCierre persiste ingreso + total en una tx |
| R14 | `tests/unit/services/cierre-dia-service.test.ts` — cambio de tarifa post-cierre no altera snapshot leído |
| R15 | `tests/unit/services/cierres-admin-service.test.ts` — detalle expone ingreso snapshot por gestión |
| R16 | idem — resumen/detalle expone totalIngresoBodegaRechazos snapshot |
| R17 | `tests/unit/services/cierre-bodega-service.test.ts` — listarConsolidacion expone total agregado |
| R18 | `tests/unit/services/cierre-bodega-service.test.ts` — solicitarCierreBodega snapshotea total agregado |
| R19 | `tests/unit/services/cierres-bodega-admin-service.test.ts` — detalle expone ingreso por cierre_dia + agregado |
| R20 | `tests/unit/services/cierre-dia-service.test.ts` — totales recibidos y pago mensajero intactos |
| R21 | `tests/integration/db/ingreso-bodega-migration.test.ts` — round-trip migración + cierres previos = 0.00 |
| R22 | `tests/unit/*` transversal — asserts de tipo STRING en DTOs de ingreso |
| R23 | `tests/unit/services/cierre-dia-service.test.ts` — flag tarifaFaltante true cuando resolver -> null (si F1.4-Q6 aprobado) |

---

## Preguntas abiertas (F1.4) — recomendación + alternativa (NO cerradas)

**Q1 (LA PRINCIPAL, money-critical) — Regla condicional "siempre y cuando aplique el pago
a las rechazadas": ¿cuándo aplica el ingreso por rechazo?**
Hallazgo: NO existe en código ni docs ningún flag ni regla que defina esta condición
(busqué en `orden`, `tienda`, `tarifa_zona_mensajero`, specs 24/36/39). Es genuinamente
indefinido.
- **Recomendación:** opción (a) — aplica SIEMPRE que la tarifa resuelta de la zona del
  mensajero tenga `cobroRechazado > 0.00`. Es decir, "aplica el pago a las rechazadas" =
  la zona lo tiene CONFIGURADO en su `TarifaZonaMensajero`. Si `cobroRechazado == 0.00` o
  no hay tarifa (gap), el ingreso es `0.00` (no bloquea). Es la lectura literal más simple,
  reusa 100% el resolver de la 39 y no introduce modelo nuevo.
- **Alternativas:** (b) solo cierto sub-tipo de rechazo — requeriría distinguir en la
  máquina de estados (36) `rechazada` vs `devuelta`/`reprogramada`, pero hoy solo
  `rechazada` es final por rechazo; (c) un flag nuevo en la orden/tienda que active el
  cobro por rechazo — implica migración + UI nuevas, mayor alcance. Se descartan salvo que
  el humano confirme una semántica de negocio distinta.

**Q2 — ¿Qué resultado(s) generan ingreso de bodega?**
- **Recomendación:** SOLO `rechazada`. La feature es "por rechazos"; `devuelta` es un
  reintento intermedio (feature 47, reintentable, escala a rechazo) y `reprogramada` no es
  un rechazo. `entregada` paga al mensajero (39), no a la bodega.
- **Alternativa:** incluir `devuelta`. Se descarta salvo confirmación: mezclaría el
  contador de reintentos (47) con el ingreso final por rechazo.

**Q3 — Snapshot vs derivado (money-critical).**
- **Recomendación:** SNAPSHOT al solicitar el cierre (por gestión + total en `cierre_dia`,
  agregado en `cierre_bodega`), derivar solo en la vista en vivo del mensajero. Idéntico a
  la 39/40: `TarifaZonaMensajero` es editable (55) y un ingreso ya cerrado no debe mutar
  retroactivamente.
- **Alternativa descartada:** derivar siempre — riesgo de números de cierre mutables.

**Q4 — Nivel del snapshot.**
- **Recomendación (confirmar):** 3 niveles espejo 39 — `gestion_orden.ingreso_bodega_rechazo`
  (por gestión), `cierre_dia.total_ingreso_bodega_rechazos`,
  `cierre_bodega.total_ingreso_bodega_rechazos`.
- **Alternativa descartada:** solo total en `cierre_dia` — el detalle por gestión tendría
  que re-derivarse, reintroduciendo mutabilidad.

**Q5 — Bodega responsable.**
- **Recomendación (confirmar):** = bodega de la zona del mensajero (central si `esCentral`,
  satélite si no) = el `destinoTipo`/`destinoZonaId` que ya resuelve el `cierre_dia` (37).
  No se introduce una resolución distinta.

**Q6 — Deuda del flag `tarifaFaltante` de la 39 (¿resolverla aquí?).**
- **Recomendación:** SÍ, resolverla en la 56 (bajo, alcance acotado). El resolver ya
  distingue `null` (gap) de `0.00` real; exponer un flag `tarifaFaltante` server-side en el
  DTO de detalle arregla la deuda `m1` de la 39 (falso positivo del badge en entregas
  legítimas de ₡0.00) de forma limpia y sirve a entregas (39) Y rechazos (56).
- **Alternativa:** dejarlo fuera (la 56 no toca los DTOs de la 39 más de lo necesario) y
  abrir un follow-up. Se recomienda incluirlo por eficiencia (mismo resolver, mismo PR).

**Q7 — UI.**
- **Recomendación (confirmar):** exponer el ingreso en las pantallas de cierre EXISTENTES
  (`/cierre-dia`, `/cierres-admin`, detalle de bodega) como "Ingreso de bodega por
  rechazos", sin pantallas nuevas.
