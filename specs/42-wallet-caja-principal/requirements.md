# Feature 42 — Wallet: caja PRINCIPAL de Ordenex — requirements.md

> **Estado: `spec_ready` — F1.4 APROBADA 2026-07-12. Spec CERRADO, listo para implementar.**
> Los requisitos `[F1.4-Qn]` quedaron fijados con las decisiones del humano (ver bloque
> "F1.4 APROBADA 2026-07-12" abajo). La sección "F1.4 — decisiones" se conserva como
> registro histórico de recomendaciones + alternativas descartadas.
> Money-critical. `sdd: true`. Zona: fullstack, complexity: high.
> `depends_on`: feature 18 (tarifas), features 37/38/40 (cierres). Baseline VERDE sobre
> `origin/dev` 84ddc3b (cadena 37/38/40/39/56/41 cerrada).

---

## F1.4 APROBADA 2026-07-12

Puerta de aprobación humana superada. Decisiones EXACTAS como quedaron (fijan los requisitos
`[F1.4-Qn]`; cualquier `[F1.4-Qn]` en el texto ya refleja lo aprobado):

- **Q1 (modelo del cobro) — APROBADA la recomendación CON UN CAMBIO.** El ingreso de Ordenex
  se calcula POR ORDEN, derivando de la tarifa vigente de la zona de la orden AL APROBAR el
  cierre; el movimiento append-only ES el snapshot (no se toca `solicitarCierre`/feature 37).
  **CAMBIO:** la **comisión COD (y su IVA) solo se cobra en órdenes `entregada` que además
  tengan "cobro de comisión"**. Esto es un dato NUEVO por orden. La 42 **añade la columna
  `Orden.cobraComision` (`cobra_comision`, `Boolean NOT NULL DEFAULT true`)** y la LEE; la
  comisión COD entra a la caja solo si la gestión es `entregada` Y `cobraComision = true`.
  DEFAULT `true` = retro-compatible (hoy todas las órdenes cobran comisión). Ver R8 y R26.
- **A1 (qué órdenes generan ingreso) — APROBADA y RESUELTA.** `entregada` = flete normal
  (`valorFleteGam` si `esCentral`, si no `valorFlete`) + comisión COD (condicionada, Q1) +
  IVA del flete + IVA de la comisión (solo si hubo comisión). `devuelta`/`rechazada` = flete
  de DEVOLUCIÓN (`valorFleteDevueltoGam` si `esCentral`, si no `valorFleteDevuelto`) + IVA del
  flete de devolución, SIN comisión COD. `reprogramada` (y demás resultados en tránsito) = NO
  genera ingreso todavía. Ver R8.
- **IVA del flete de devolución — DECIDIDO:** SÍ aplica, con el mismo porcentaje `ivaFlete`
  sobre el flete de devolución, en su propia categoría `ingreso_iva_flete_devolucion`
  (trazabilidad por concepto). Ver R8/R10.
- **Q2 (granularidad) — APROBADA la recomendación.** Un movimiento por CONCEPTO agregado por
  cierre. Con el flete de devolución hay MÁS conceptos (ver lista en R10). Idempotencia por
  `(origen_tipo, origen_id, categoria)`.
- **Q3 (qué cierres alimentan) — APROBADA la recomendación.** Solo `CierreDia` aprobados;
  `CierreBodega` NO re-cuenta; `vencido`→`aprobado` alimenta una sola vez. Sin cambios.
- **Q4 (modelo de egresos) — APROBADA la recomendación.** Una sola tabla `wallet_movimiento`
  con `tipo`/`categoria` + referencia polimórfica `origen_tipo`/`origen_id`. Sin cambios.
- **Q5 (UI/rol) — APROBADA la recomendación.** Módulo nuevo `/wallet` (libro + balance), rol
  `maestro`. Lectura de `admin` = pregunta abierta menor (A4). Sin cambios de fondo.
- **Q6 (manuales) — APROBADA la recomendación.** Alcance mínimo de movimientos manuales
  (ajuste ingreso/egreso, inmutables, descripción obligatoria) para el maestro. Sin cambios.

## Contexto y alcance

La **wallet** es la caja PRINCIPAL de Ordenex: un **LIBRO DE MOVIMIENTOS append-only**
(entradas/salidas) donde ENTRAN los ingresos de Ordenex y SALEN los egresos. Decisión de
modelo YA tomada por el humano (2026-07-10): **libro de movimientos inmutables, NO un
tablero de saldos calculados**. El **balance general** de la empresa (positivo/negativo) se
DERIVA comparando ingresos vs. egresos; no se almacena un saldo mutable global.

**Cada `CierreDia` APROBADO alimenta la caja** con los ingresos de Ordenex de sus órdenes.
Por cada orden, Ordenex percibe cuatro conceptos: (a) **flete**, (b) **comisión por el
COD**, (c) **IVA del flete** y (d) **IVA de la comisión**. Estos valores se derivan del CRUD
de tarifas (feature 18).

La 42 es la **RAÍZ del libro**: implementa los INGRESOS por cierre aprobado y deja el modelo
de **egresos GENÉRICO** (tipo/categoría + referencia polimórfica al origen) listo para que
las features 43 (pagos a tiendas), 44 (pagos a mensajeros) y 45 (gastos/sueldos) inserten
sus egresos DESPUÉS, sin cambiar el esquema.

### Hallazgos de modelo (VERIFICADOS en código, no supuestos)

- **Tarifas (feature 18, renombrado por 54):** tabla `tarifas`, modelo `Tarifa`
  (`db/schema.prisma`). `zonaId` **NOT NULL** → cada tarifa pertenece a UNA zona. Campos:
  `valorFlete` (`valor_flete`, MONTO `Decimal(12,2)`), `valorFleteGam` (`valor_flete_gam`,
  MONTO), `valorFleteDevuelto`/`valorFleteDevueltoGam` (MONTO), `fulfillment` (MONTO),
  `comisionCod` (`comision_cod`, **PORCENTAJE** `Decimal(5,2)` 0..100), `ivaFlete`
  (`iva_flete`, **PORCENTAJE**), `ivaComisionCod` (`iva_comision_cod`, **PORCENTAJE**).
  Soft-delete vía `deletedAt`. `TarifaService`/`ITarifaRepository` ya existen (antes
  `ICobro*`). **No existe hoy** ningún resolver "tarifa aplicable a una orden": la 18 es un
  CRUD; la resolución por zona/`esCentral` NO está implementada → alimenta a F1.4-Q1.
- **Zona:** flag `esCentral` (`es_central`, feature 54, renombrado del viejo `es_gam`).
  `findCentralZonaId` en `IZonaRepository`. La tarifa distingue variante normal (`valorFlete`)
  vs. central/GAM (`valorFleteGam`) pero NO hay regla en código que elija cuál → F1.4-Q1.
- **Orden:** `montoCobrar` (`monto_cobrar`, `Decimal(12,2)`, nullable) = monto COD a recaudar;
  `zonaId` **NOT NULL**. No hay campos de flete/comisión persistidos en la orden HOY. La 42
  añade `cobraComision` (`cobra_comision`, `Boolean NOT NULL DEFAULT true`) — booleano por
  orden que indica si lleva cobro de comisión COD (F1.4-Q1, R26). Convención de booleanos ya
  presente en `orden`/`zona`: camelCase + `@map` snake_case (`cobroVehiculo`→`cobro_vehiculo`,
  `esCentral`→`es_central`).
- **Cierres (lo que ALIMENTA la caja):** `CierreDia` es la fuente de verdad de las
  gestiones (`gestion_orden.cierre_id`). Enum `CierreEstado`
  = `{ solicitado, aprobado, rechazado, vencido }`. El punto EXACTO de transición a
  `aprobado` es `CierresAdminRepository.resolverCierre` (`lib/repositories/CierresAdminRepository.ts`):
  un `updateMany({ where: { id, estado: { in: ["solicitado","vencido"] }, ...alcance }, data: { estado:"aprobado", ... } })`.
  Un `vencido` (feature 41) también resuelve a `aprobado` por la misma vía. **Ahí** debe
  engancharse la alimentación de la caja (mismo statement/transacción, idempotente).
- **`CierreBodega` (feature 40)** AGREGA `cierre_dia` ya contados (relación
  `cierresDia`/`cierre_bodega_id`) → aprobar bodega NO debe re-contar el ingreso (F1.4-Q3).
- **Gestión (feature 36):** `GestionOrden` con `resultado`
  (`entregada|reprogramada|devuelta|rechazada`), `montoRecibido`, `metodoPago`. Precedente de
  snapshot: features 39/56 congelan `pago_mensajero` e `ingreso_bodega_rechazo` en
  `gestion_orden` al SOLICITAR el cierre. El ingreso de Ordenex (flete/comisión/IVAs) NO se
  snapshotea hoy en ninguna parte → F1.4-Q1/Q2.
- **Money-critical:** todo el flujo de cierres usa `Prisma.Decimal` y serializa a STRING
  `toFixed(2)` (ver `lib/utils/cierre-totales.ts`); cero `parseFloat`/`Number(` sobre montos.

### Fuera de alcance (otras features)

- Los flujos REALES de pago: pagos a tiendas (43), pagos a mensajeros (44), gastos/sueldos
  (45). La 42 sólo define el MODELO de egresos y los ingresos por cierre.
- Recálculo/edición de tarifas (18) y de cierres (37/38/40) — la 42 los CONSUME, no los muta.
- Contabilidad formal / conciliación bancaria / exportación contable.
- Los snapshots de dinero recibido (37/40), pago al mensajero (39) e ingreso de bodega por
  rechazos (56): son conceptos DISTINTOS del ingreso de Ordenex; la 42 no los altera.

---

## Requisitos (EARS)

### Libro de movimientos (modelo append-only, inmutable)

**R1** — El sistema DEBE modelar la wallet como un LIBRO append-only de movimientos: cada
movimiento es una fila INMUTABLE que representa un ingreso o un egreso.

**R2** — Cada movimiento DEBE registrar, como mínimo: `tipo` (`ingreso`|`egreso`),
`categoria` (concepto), `monto` (`Decimal(12,2)` > 0), `origen_tipo` + `origen_id`
(referencia polimórfica al origen, o marca de manual), fecha del movimiento, y
opcionalmente `registrado_por` (usuario) y `descripcion`.

**R3** — El sistema NO DEBE permitir modificar (UPDATE) ni eliminar (DELETE) un movimiento
ya creado; una corrección DEBE realizarse mediante un movimiento de AJUSTE compensatorio,
nunca alterando el original.

**R4** — El sistema DEBE calcular y persistir todos los montos con aritmética decimal exacta
(`Prisma.Decimal`) y exponerlos en la frontera Server Action→cliente como STRING con dos
decimales; NUNCA con `number`/`parseFloat`/`Number(`.

### Alimentación desde el cierre aprobado (money-critical)

**R5** — CUANDO un `CierreDia` transiciona a `aprobado` (por `solicitado`→`aprobado` o
`vencido`→`aprobado`), el sistema DEBE generar los movimientos de INGRESO de Ordenex
correspondientes a ese cierre.

**R6** — La generación de movimientos por la aprobación de un cierre DEBE ser IDEMPOTENTE:
aprobar (o intentar reflejar) el mismo cierre más de una vez NO DEBE crear movimientos
duplicados; la garantía DEBE ser a nivel de base de datos (constraint único sobre el
origen+concepto), no un check-then-insert en memoria (sin TOCTOU).

**R7** — La generación de movimientos DEBE ser ATÓMICA con la transición del cierre: si falla
la inserción de los movimientos, la aprobación DEBE revertirse por completo (todo-o-nada); no
debe quedar un cierre `aprobado` sin sus movimientos ni movimientos sin su cierre `aprobado`.

**R8** `[F1.4-Q1,A1,Q2]` — CUANDO se alimenta la caja desde un cierre aprobado, por cada
gestión del cierre el sistema DEBE derivar los conceptos según su `resultado`, usando la
tarifa vigente de la zona de la orden y la variante central (`esCentral`) vs. no-central:
  - Gestión **`entregada`** →
    `flete` = `valorFleteGam` si la zona de la orden es central (`esCentral`) o `valorFlete`
    en caso contrario; `iva_flete` = `flete` × `ivaFlete` / 100;
    Y **solo si la orden tiene `cobraComision = true`** (ver R26):
    `comision_cod` = `montoCobrar` × `comisionCod` / 100 e
    `iva_comision_cod` = `comision_cod` × `ivaComisionCod` / 100. SI `cobraComision = false`,
    NO se genera comisión COD ni su IVA (ambos ausentes, no `0.00` forzado por orden).
  - Gestión **`devuelta`** o **`rechazada`** →
    `flete_devolucion` = `valorFleteDevueltoGam` si la zona es central o `valorFleteDevuelto`
    en caso contrario; `iva_flete_devolucion` = `flete_devolucion` × `ivaFlete` / 100 (mismo
    porcentaje `ivaFlete`). NO se genera comisión COD ni su IVA (no hubo recaudo).
  - Gestión **`reprogramada`** (u otro resultado en tránsito) → NO genera ingreso alguno (la
    orden sigue en circulación; se contará cuando termine en `entregada`/`devuelta`/`rechazada`).

**R9** `[F1.4-Q1,A1]` — SI no existe tarifa vigente (no borrada) para la zona de una orden
que generaría ingreso, ENTONCES el sistema DEBE tratar TODOS los conceptos de esa orden
(flete, flete de devolución, comisión e IVAs, según su `resultado`) como `0.00` y NO DEBE
bloquear ni abortar la aprobación del cierre (gap de datos seguro, mismo espíritu que 39/R8 y
56/R6).

**R10** `[F1.4-Q2,A1]` — CUANDO se alimenta la caja desde un cierre aprobado, el sistema DEBE
crear los movimientos de ingreso con UN movimiento por CONCEPTO agregado por cierre, cada uno
con `origen_tipo = cierre_dia` y `origen_id` = id del cierre. Las categorías de ingreso son:
`ingreso_flete`, `ingreso_flete_devolucion`, `ingreso_comision_cod`, `ingreso_iva_flete`,
`ingreso_iva_flete_devolucion`, `ingreso_iva_comision_cod`. El sistema NO DEBE crear un
movimiento para un concepto cuyo total agregado sea `0.00` (p. ej. un cierre sin ninguna
devolución no produce `ingreso_flete_devolucion`; un cierre sin órdenes con comisión no
produce `ingreso_comision_cod` ni `ingreso_iva_comision_cod`).

**R11** `[F1.4-Q3]` — SOLO los `CierreDia` aprobados DEBEN alimentar la caja; los
`CierreBodega` aprobados (feature 40) NO DEBEN generar ingresos de Ordenex, porque agregan
`cierre_dia` ya contados (evitar doble conteo; fuente única = `CierreDia`).

**R12** — CUANDO un `CierreDia` en estado `vencido` (feature 41) se aprueba, el sistema DEBE
alimentar la caja EXACTAMENTE una vez, igual que un `solicitado`→`aprobado`, sin duplicar.

**R13** — SI un movimiento de ingreso ya existe para el par (`origen_tipo`, `origen_id`,
`categoria`), ENTONCES un nuevo intento de alimentación para ese mismo par DEBE ser un no-op
(no error de duplicado propagado al usuario, no segundo movimiento).

### Egresos genéricos (raíz para 43/44/45)

**R14** — El modelo de movimientos DEBE soportar EGRESOS genéricos mediante `tipo = egreso` +
una `categoria` extensible (p. ej. `egreso_pago_tienda`, `egreso_pago_mensajero`,
`egreso_gasto`, `egreso_sueldo`, `egreso_ajuste`) y la referencia polimórfica
`origen_tipo`/`origen_id`, de modo que las features 43/44/45 puedan INSERTAR sus egresos SIN
alterar el esquema; la 42 NO implementa esos flujos de pago.

**R15** `[F1.4-Q6]` — DONDE el humano habilite movimientos manuales en la 42, el rol maestro
DEBE poder registrar un movimiento manual (ingreso o egreso de ajuste) desde la UI, con
`origen_tipo = manual`, `registrado_por` = actor, `monto` > 0 y `descripcion` obligatoria; el
movimiento manual DEBE ser igual de inmutable que los automáticos (R3).

### Balance general (derivado)

**R16** — El sistema DEBE DERIVAR el balance general sumando los movimientos
(`SUM(ingreso) − SUM(egreso)` con `Prisma.Decimal`), y NUNCA leerlo de un saldo mutable
global almacenado que pueda desincronizarse.

**R17** — El balance DEBE poder ser positivo o negativo y exponerse como STRING con dos
decimales y signo explícito (o campo separado de signo), sin pérdida de precisión.

### Vista de la wallet (UI)

**R18** `[F1.4-Q5]` — El sistema DEBE exponer una pantalla `/wallet` (módulo nuevo) que
muestre el LIBRO de movimientos (paginado, más reciente primero) y el BALANCE general
derivado.

**R19** `[F1.4-Q5]` — MIENTRAS un usuario sin el rol autorizado (recomendado: `maestro`;
`admin` lectura a confirmar) intenta acceder a la wallet o a sus acciones, el sistema DEBE
responder no autorizado (forbidden) y NO exponer ningún movimiento ni balance.

**R20** `[F1.4-Q5]` — El sistema DEBE permitir filtrar el libro por `tipo`, `categoria` y
rango de fechas (y opcionalmente por zona), y el balance mostrado DEBE reflejar el mismo
conjunto filtrado cuando aplique (o exponer el balance global claramente etiquetado).

**R21** — Los montos y el balance (datos sensibles/financieros) DEBEN pre-obtenerse en un
Server Component y pasarse ya serializados (STRING) a los componentes `private/`; el cliente
NO DEBE recibir `Prisma.Decimal` ni recalcular montos.

### Datos, RLS e integridad

**R22** — Toda tabla nueva (movimientos y catálogos/enum asociados) DEBE tener RLS habilitada
SIN policies `anon`/`authenticated` (acceso solo vía service role), consistente con
`gestion_orden`/`cierre_dia`.

**R23** — La persistencia DEBE introducirse mediante una migración ADITIVA con su `down.sql`
reversible; la migración NO DEBE romper la lectura de datos existentes.

**R24** — La tabla de movimientos DEBE tener índices para: (a) la guardia de idempotencia
(constraint único parcial sobre `origen_tipo`,`origen_id`,`categoria` WHERE `origen_id IS NOT
NULL`), (b) el listado del libro por fecha, y (c) el filtro por `tipo`/`categoria`; ninguna
consulta de balance/listado en ruta caliente DEBE quedar sin índice.

**R25** — El sistema NO DEBE exponer por ninguna vía (DTO/serialización) un monto ni un
balance como `number`; siempre STRING con dos decimales (aserción transversal money-critical).

**R26** `[F1.4-Q1]` — La migración aditiva de la 42 DEBE añadir a `orden` la columna
`cobraComision` (`cobra_comision`, `Boolean NOT NULL DEFAULT true`), que indica si la orden
lleva cobro de comisión COD. El default `true` DEBE ser retro-compatible (las órdenes ya
existentes quedan marcadas como "cobran comisión", el comportamiento actual). El sistema DEBE
LEER `cobraComision` por orden al derivar el ingreso (R8): la comisión COD y su IVA solo entran
a la caja cuando la gestión es `entregada` Y `cobraComision = true`. La ESCRITURA por-orden de
este dato desde la UI/carga de la orden (features 14/15/16/17) queda FUERA del alcance de la 42
y se declara como deuda de seguimiento (ver A5): la 42 añade la columna con su default y la LEE,
pero no expone su captura editable.

---

## Trazabilidad R → tipo de test

| Req | Test (archivo / caso) — a fijar por el implementer |
| --- | --- |
| R1  | `tests/unit/services/wallet-service.test.ts` — un movimiento = fila inmutable ingreso/egreso |
| R2  | `tests/unit/repositories/wallet-movimiento-repository.test.ts` — persiste tipo/categoria/monto/origen/fecha |
| R3  | `tests/unit/services/wallet-service.test.ts` — no expone update/delete; corrección = ajuste compensatorio |
| R4  | `tests/unit/utils/wallet-balance.test.ts` — Decimal exacto, salida STRING 2 decimales |
| R5  | `tests/unit/services/cierres-admin-service.test.ts` — aprobar CierreDia genera movimientos de ingreso |
| R6  | `tests/integration/db/wallet-idempotencia.test.ts` — doble aprobación/insert = un solo set (constraint DB) |
| R7  | `tests/unit/repositories/cierres-admin-repository.test.ts` — fallo al insertar movimientos revierte la aprobación (tx) |
| R8  | `tests/unit/utils/ingreso-ordenex.test.ts` — `entregada`: flete (esCentral vs no) + IVA flete; comisión+IVA comisión SOLO si `cobraComision=true`; `entregada` con `cobraComision=false` → sin comisión ni su IVA; `devuelta`/`rechazada`: flete de devolución (esCentral vs no) + IVA flete devolución, SIN comisión; `reprogramada` → sin ingreso |
| R9  | idem — zona sin tarifa vigente → todos los conceptos (flete, flete devolución, comisión, IVAs) 0.00 sin lanzar |
| R10 | `tests/unit/services/wallet-feed-service.test.ts` — 1 movimiento por concepto agregado por cierre (hasta 6 categorías); no crea movimiento de concepto con total 0.00 (cierre sin devoluciones → sin `ingreso_flete_devolucion`; cierre sin comisión → sin `ingreso_comision_cod`/`ingreso_iva_comision_cod`) |
| R11 | `tests/unit/services/cierres-bodega-admin-service.test.ts` — aprobar CierreBodega NO genera ingresos |
| R12 | `tests/unit/services/cierres-admin-service.test.ts` — vencido→aprobado alimenta una vez |
| R13 | `tests/integration/db/wallet-idempotencia.test.ts` — reintento por (origen,categoria) existente = no-op |
| R14 | `tests/unit/repositories/wallet-movimiento-repository.test.ts` — acepta egresos con categoría/origen polimórfico |
| R15 | `tests/unit/services/wallet-service.test.ts` — maestro registra movimiento manual válido (si F1.4-Q6 aprobado) |
| R16 | `tests/unit/utils/wallet-balance.test.ts` — balance = Σingreso − Σegreso (Decimal), sin saldo almacenado |
| R17 | idem — balance negativo/positivo, STRING 2 decimales |
| R18 | `tests/integration/wallet-page.test.ts` — /wallet renderiza libro + balance |
| R19 | `tests/unit/services/wallet-service.test.ts` + `tests/integration/wallet-page.test.ts` — rol no autorizado → forbidden |
| R20 | `tests/unit/services/wallet-service.test.ts` — filtros tipo/categoria/fecha aplican en el WHERE |
| R21 | `tests/integration/wallet-page.test.ts` — datos vía Server Component → props, sin Decimal al cliente |
| R22 | `tests/integration/db/wallet-migration.test.ts` — RLS habilitada sin policies anon/authenticated |
| R23 | `tests/integration/db/wallet-migration.test.ts` — round-trip up/down reversible |
| R24 | `tests/integration/db/wallet-migration.test.ts` — índices + unique parcial de idempotencia presentes |
| R25 | `tests/unit/*` transversal — asserts de tipo STRING en todos los DTOs de monto/balance |
| R26 | `tests/integration/db/wallet-migration.test.ts` — `orden.cobra_comision` existe, `NOT NULL DEFAULT true`, filas existentes quedan `true` (retro-compat); + `tests/unit/utils/ingreso-ordenex.test.ts` — la lectura de `cobraComision` condiciona la comisión (cubierto por R8) |

---

## F1.4 — decisiones pendientes (el humano decide; NO cerradas)

Cada pregunta trae RECOMENDACIÓN + alternativa descartada. Los requisitos `[F1.4-Qn]` se
redactaron sobre la recomendación; si el humano decide distinto, se ajustan antes de implementar.

**Q1 (LA PRINCIPAL, money-critical) — Modelo del cobro: ¿el ingreso de Ordenex por orden se
calcula POR ORDEN (derivado de la tarifa aplicable a su zona) o POR ZONA/CONFIG (una config
global/por-zona con valores fijos)? ¿Y se DERIVA al aprobar o se SNAPSHOTEA antes?**
Hallazgo verificado: la tarifa (18) es **por zona** (`tarifas.zona_id` NOT NULL) y mezcla
MONTOS (`valorFlete`/`valorFleteGam`) con PORCENTAJES (`comisionCod`/`ivaFlete`/`ivaComisionCod`).
No existe hoy un resolver "tarifa aplicable a una orden" ni regla `valorFlete` vs
`valorFleteGam`.
- **Recomendación:** POR ORDEN, derivando de la tarifa vigente de la zona de la orden con la
  fórmula de R8 (flete según `esCentral`; comisión = `montoCobrar`×`comisionCod`%; IVAs sobre
  flete y comisión). El cálculo se hace AL APROBAR el cierre y se materializa como movimientos
  INMUTABLES (el movimiento append-only ES el snapshot), manteniendo la 42 auto-contenida sin
  tocar el flujo `solicitarCierre` (37). **Confirmar la fórmula exacta** (sobre todo:
  ¿`valorFleteGam` aplica cuando la zona de la orden es central?, ¿la comisión es % de
  `montoCobrar`?, ¿el IVA del flete se calcula sobre el flete y el de la comisión sobre la
  comisión?).
- **Alternativa descartada:** snapshotear los 4 conceptos en `gestion_orden` al SOLICITAR el
  cierre (paridad total con 39/56). Es más coherente con el patrón snapshot, pero MODIFICA la
  feature 37 (fuera del alcance de la 42) y adelanta trabajo antes de que el humano confirme la
  fórmula. Se puede adoptar en un refinamiento posterior si se prefiere.
- **Alternativa descartada:** config global/por-zona con montos fijos por concepto — contradice
  el modelo real de tarifas (18) y perdería el vínculo con `montoCobrar` de cada orden.

**Q2 — Disparador y granularidad de la entrada a caja.**
- **Recomendación:** disparador = APROBACIÓN del `CierreDia` (es "cada cierre aprobado alimenta
  la caja"). Granularidad = UN movimiento por CONCEPTO agregado por cierre (4 movimientos:
  flete/comisión/IVA flete/IVA comisión), `origen = cierre_dia`. Equilibra trazabilidad
  (concepto visible, reconciliable contra el cierre) con volumen de filas, y da una guardia de
  idempotencia limpia `(cierre_dia, categoria)`.
- **Alternativa descartada:** un movimiento por ORDEN y concepto (máxima trazabilidad, pero
  4×N filas por cierre e idempotencia más pesada). **Alternativa descartada:** un único
  movimiento agregado por cierre (pierde el desglose por concepto necesario para los reportes
  de IVA/comisión).

**Q3 — Qué cierres alimentan y doble conteo.**
- **Recomendación:** SOLO `CierreDia` aprobados. `CierreBodega` (40) AGREGA `cierre_dia` ya
  contados → NO alimenta la caja (evita doble conteo). Fuente única = `CierreDia`, que es donde
  viven las gestiones/órdenes. Un `vencido` (41) que luego se aprueba alimenta una sola vez (la
  idempotencia por `(cierre_dia, categoria)` lo garantiza).
- **Alternativa descartada:** alimentar desde `CierreBodega` — duplicaría el ingreso.

**Q4 — Modelo de egresos (para 43/44/45).**
- **Recomendación:** UNA sola tabla `wallet_movimiento` con `tipo` (ingreso/egreso) +
  `categoria` (enum extensible) + referencia polimórfica `origen_tipo`/`origen_id`. La 42
  implementa los INGRESOS por cierre (+ movimientos manuales básicos si Q6 lo aprueba) y deja
  las categorías/valores de egreso reservados para que 43/44/45 inserten. Alcance de la 42:
  hasta los ingresos por cierre + balance + UI de lectura (+ manual opcional).
- **Alternativa descartada:** tablas separadas por tipo (ingresos vs egresos) — complica el
  cálculo del balance (uniones) y la extensión por 43/44/45.

**Q5 — Balance y alcance de la UI.**
- **Recomendación:** balance general GLOBAL de la empresa, con filtros por rango de fechas /
  categoría / tipo (zona opcional). Pantalla NUEVA `/wallet` (módulo nuevo) con libro + balance.
  Rol: `maestro` (dueño de la caja central). Confirmar si `admin` tiene lectura.
- **Alternativa descartada:** embeber la wallet en el dashboard del maestro (23) sin ruta
  propia — el módulo es suficientemente grande y crecerá con 43/44/45; merece ruta propia.

**Q6 — Movimientos manuales en la 42.**
- **Recomendación:** incluir un alcance MÍNIMO de movimientos manuales (ajuste ingreso/egreso)
  para el maestro, porque valida el modelo append-only end-to-end y da una vía de corrección
  (R3) sin esperar a la 45. Si se prefiere alcance más chico, dejar los manuales para la 45 y
  que la 42 sólo haga ingresos-por-cierre + balance + UI de lectura.
- **Alternativa descartada:** permitir editar/borrar movimientos manuales — rompe la
  inmutabilidad (R3); las correcciones van siempre por ajuste compensatorio.

## Preguntas abiertas (además de F1.4)

- **A1 — RESUELTA (F1.4 2026-07-12).** `entregada` genera flete normal + comisión COD
  (condicionada por `cobraComision`) + IVAs; `devuelta`/`rechazada` generan flete de DEVOLUCIÓN
  + su IVA (mismo `ivaFlete`%), SIN comisión; `reprogramada` no genera ingreso todavía. Fijado
  en R8/R9/R10.
- **A2** — ¿La moneda es única (colones) y sin multi-moneda? El resto del sistema asume una sola
  moneda; se asume lo mismo aquí salvo indicación.
- **A3** — ¿El balance debe reflejar también los egresos que aún NO existen (43/44/45), es
  decir, se muestra "balance parcial" hasta que esas features lleguen? Se asume que sí: el
  balance suma lo que haya en el libro en cada momento.
- **A4 (menor)** — ¿El rol `admin` tiene lectura de la wallet, además del `maestro` (dueño de
  la caja)? F1.4-Q5 fijó `maestro` como rol autorizado; la lectura de `admin` queda por
  confirmar (R19 permanece con `maestro` como autorizado por defecto).
- **A5 (deuda/seguimiento) — punto de ESCRITURA de `cobraComision`.** La 42 añade la columna y
  la LEE (R26), pero NO expone su captura editable por-orden. Poblar `cobraComision` desde la
  creación/carga de la orden (features 14/15/16/17) es un follow-up: hasta entonces todas las
  órdenes usan el DEFAULT `true` (cobran comisión). Debe abrirse una feature de seguimiento para
  el punto de captura si el negocio necesita órdenes SIN cobro de comisión antes de esas features.
