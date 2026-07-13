# Feature 44 — Wallet: pago a mensajeros y cuentas por pagar — requirements.md

> **Estado: `spec_draft` → pendiente de la puerta de aprobación humana F1.4.**
> Money-critical. `sdd: true`. Zona: fullstack, complexity: high. `depends_on`: 42
> (wallet/caja principal, en `dev`), 39 (pago al mensajero por zona, snapshot) y 37
> (cierre del día con totales por método de pago). Precedente de estilo/estructura:
> feature 43 (`specs/43-wallet-por-tienda/`).
>
> Los requisitos marcados `[F1.4-Qx]` quedan CONDICIONADOS a la decisión del humano en la
> sección "F1.4 — decisiones". Los NO marcados son firmes.

---

## Contexto y alcance

Cuando un `CierreDia` de un mensajero se APRUEBA, el sistema ya conoce, congelado como
snapshot:

- **Cuánto se le debe pagar al mensajero** = `cierre_dia.total_pago_mensajero`
  (`Decimal(12,2)`, snapshot de la feature 39, congelado al SOLICITAR el cierre).
- **Cuánto efectivo recaudó** = `cierre_dia.total_efectivo` (`Decimal(12,2)`, snapshot de la
  feature 37).

Regla de negocio (feature 44): el pago al mensajero **se toma del efectivo que él mismo
recaudó**. Por tanto, para cada cierre aprobado, con pago debido `P` y efectivo `E`:

```
pagado    = min(P, E)          // "lo ya pagado", tomado del efectivo recaudado
pendiente = P − pagado         // "lo pendiente" = CUENTA POR PAGAR al mensajero
```

Si el mensajero NO recaudó efectivo (`E = 0`, todo fue SIMPE/transferencia), entonces
`pagado = 0` y `pendiente = P`: el pago completo queda como CUENTA POR PAGAR. La wallet debe
**reflejar ambos**: lo ya pagado y lo pendiente (cuentas por pagar a mensajeros).

**Principio de reutilización estricta:** la 44 NO recalcula el pago ni el efectivo. Consume
los dos snapshots ya congelados por 39 y 37 en `cierre_dia`. Se engancha en el MISMO punto
idempotente y atómico del cierre aprobado que ya usan 42 y 43
(`CierresAdminRepository.resolverCierre`, dentro de la misma `$transaction`).

### Hallazgos VERIFICADOS en código (no supuestos)

- **Pago debido (snapshot 39):** `cierre_dia.total_pago_mensajero`
  (`total_pago_mensajero`, `Decimal(12,2)`, `@default(0)`, NOT NULL) es el total del pago al
  mensajero, congelado al solicitar el cierre (`db/schema.prisma`, `model CierreDia`; también
  `gestion_orden.pago_mensajero` por gestión). Solo `entregada` paga; el resto aporta `0.00`
  (`lib/utils/pago-mensajero.ts`, `pagoPorResultado`).
- **Efectivo recaudado (snapshot 37):** `cierre_dia.total_efectivo`
  (`total_efectivo`, `Decimal(12,2)`, `@default(0)`, NOT NULL). También existen
  `total_simpe`, `total_transferencia`, `total_general`.
- **Mensajero del cierre:** `cierre_dia.mensajero_id` (FK → `usuario`, NOT NULL). El rol es
  `mensajero` (`GestionMensajero`/`CierreMensajero`).
- **Enums de la 42 YA reservados para la 44:** `WalletMovimientoCategoria.egreso_pago_mensajero`
  y `WalletOrigenTipo.pago_mensajero` (`db/schema.prisma`, `lib/types/wallet.ts`) están
  reservados sin migración de enum adicional (patrón "reservar valores del enum").
- **Enganche del cierre:** `CierresAdminRepository.resolverCierre` abre `prisma.$transaction`
  y, al aprobar (`res.count === 1 && nuevoEstado === 'aprobado'`), alimenta 42
  (`walletFeedService.construirMovimientosDeIngreso` + `walletMovimientoRepo.crearMovimientos`)
  y 43 (`walletTiendaFeedService.construirMovimientosPorTienda` +
  `walletTiendaMovimientoRepo.crearMovimientos`). La 44 engancha en el MISMO punto/tx, después
  de 42/43.
- **Idempotencia 42/43:** índice único parcial `(origen_tipo, origen_id[, dimensión], categoria)
  WHERE origen_id IS NOT NULL` + `createMany({ skipDuplicates: true })` (ON CONFLICT DO
  NOTHING). La 44 replica el patrón añadiendo la dimensión `mensajero_id`.
- **Solo `CierreDia` alimenta (no `CierreBodega`):** 42/43 alimentan solo desde `CierreDia`
  aprobado; `CierreBodega` agrega cierres ya contados (evita doble conteo). La 44 hace lo mismo
  aunque `cierre_bodega.total_pago_mensajero` exista (snapshot agregado de 39).
- **Money-critical:** todo el flujo usa `Prisma.Decimal` y serializa a STRING `toFixed(2)`; cero
  `parseFloat`/`Number(` sobre montos (`lib/utils/wallet-balance.ts`,
  `lib/utils/saldo-tienda.ts`, `CierresAdminRepository`).

### Fuera de alcance

- Recalcular/editar el pago por zona (39) o los totales del cierre (37/38/40/41) — la 44 los
  CONSUME como snapshot.
- El `cobroRechazado`/ingreso de bodega por rechazos (feature 56) y el `montoRecibido` de la
  tienda (43): conceptos aparte.
- Contabilidad formal, conciliación bancaria, exportación contable.
- El PAGO/liquidación efectivo de la cuenta por pagar (saldar lo pendiente entregándole el
  dinero al mensajero) queda condicionado a F1.4-Qf (recomendado como follow-up; ver R23).

---

## Requisitos (EARS)

### Modelo del pago al mensajero (append-only, inmutable) `[F1.4-Qa,Qb]`

**R1** `[F1.4-Qa]` — El sistema DEBE modelar el pago a cada mensajero como un LIBRO
append-only de movimientos por mensajero: cada movimiento es una fila INMUTABLE, con dimensión
`mensajero_id`, que representa un DEVENGO (lo que Ordenex le debe al mensajero por sus
entregas) o un PAGO (lo que ya se le entregó: tomado del efectivo recaudado, o una liquidación
posterior).

**R2** `[F1.4-Qa,Qb]` — Cada movimiento DEBE registrar, como mínimo: `mensajero_id` (FK →
usuario rol mensajero), `tipo` (`devengo`|`pago`), `categoria` (concepto), `monto`
(`Decimal(12,2)` > 0), `origen_tipo` + `origen_id` (referencia polimórfica al origen:
`cierre_dia`, `pago_mensajero` o `manual`), fecha del movimiento, y opcionalmente
`registrado_por` y `descripcion`.

**R3** — El sistema NO DEBE permitir modificar (UPDATE) ni eliminar (DELETE) un movimiento ya
creado; una corrección DEBE realizarse mediante un movimiento de AJUSTE compensatorio
(`ajuste_devengo`/`ajuste_pago`), nunca alterando el original (misma regla de inmutabilidad
que 42/R3 y 43/R3).

**R4** — El sistema DEBE calcular y persistir todos los montos con aritmética decimal exacta
(`Prisma.Decimal`) y exponerlos en la frontera Server Action→cliente como STRING con dos
decimales; NUNCA con `number`/`parseFloat`/`Number(`.

### Alimentación desde el cierre aprobado (reutiliza snapshots de 39/37, money-critical)

**R5** — CUANDO un `CierreDia` transiciona a `aprobado` (por `solicitado`→`aprobado` o
`vencido`→`aprobado`), el sistema DEBE generar, para el mensajero de ese cierre, los
movimientos del pago (devengo + pago tomado del efectivo) correspondientes.

**R6** — La generación DEBE ser IDEMPOTENTE a nivel de base de datos mediante un constraint
único parcial sobre `(origen_tipo, origen_id, mensajero_id, categoria) WHERE origen_id IS NOT
NULL` (no un check-then-insert en memoria; sin TOCTOU): re-aprobar el mismo cierre NO DEBE
duplicar movimientos.

**R7** — La generación DEBE ser ATÓMICA con la transición del cierre y con la alimentación de
42 y 43: todo ocurre en la MISMA `$transaction` de `resolverCierre`; si falla cualquier
inserción, la aprobación (y la alimentación de 42, 43 y 44) hace rollback completo
(todo-o-nada).

**R8** — El sistema DEBE tomar el pago debido `P` y el efectivo `E` de los SNAPSHOTS ya
congelados del `cierre_dia` (`total_pago_mensajero` de la 39 y `total_efectivo` de la 37); NO
DEBE re-derivar el pago desde las tarifas ni recontar las gestiones (la 39 ya lo congeló).

**R9** — Al alimentar, el sistema DEBE calcular `pagado = min(P, E)` y `pendiente = P − pagado`
con `Prisma.Decimal` (comparación exacta, sin `Number`). El `pagado` DEBE quedar acotado por
el efectivo recaudado (`pagado ≤ E`) y por el pago debido (`pagado ≤ P`).

**R10** — La alimentación DEBE emitir: (a) un movimiento `devengo`/`pago_devengado` con
`monto = P` SI `P > 0`; (b) un movimiento `pago`/`pago_efectivo` con `monto = pagado` SI
`pagado > 0`. El `pendiente` NO se persiste como fila propia: es el saldo DERIVADO
(`Σ devengo − Σ pago`, R14). SI `P = 0` (cierre sin entregas que paguen), el sistema NO DEBE
generar ningún movimiento para ese mensajero en ese cierre.

**R11** — SOLO los `CierreDia` aprobados DEBEN alimentar el libro del pago al mensajero; los
`CierreBodega` aprobados (feature 40) NO DEBEN generar movimientos (agregan cierres ya
contados; evitar doble conteo; fuente única = `CierreDia`, igual que 42/R11 y 43/R12).

**R12** — CUANDO un `CierreDia` en estado `vencido` (feature 41) se aprueba, el sistema DEBE
alimentar el libro EXACTAMENTE una vez, sin duplicar (garantía por el constraint de R6, igual
que 42/R12 y 43/R13).

**R13** — El netting `pagado = min(P, E)` DEBE aplicarse POR CIERRE (por aprobación), NO
acumulado a través de varios cierres del mismo mensajero: cada `cierre_dia` neta su propio
pago contra su propio efectivo.

### Saldo derivado: cuenta por pagar (nunca almacenado)

**R14** — El sistema DEBE DERIVAR la CUENTA POR PAGAR (lo pendiente) de un mensajero sumando
sus movimientos (`Σ(monto tipo=devengo) − Σ(monto tipo=pago)` con `Prisma.Decimal`), y NUNCA
leerla de un saldo mutable almacenado que pueda desincronizarse (mismo principio que 42/R16 y
43/R16).

**R15** — El sistema DEBE satisfacer, de forma verificable por test, el invariante de cuadre:
por cada cierre aprobado y para cada mensajero,
`pago_devengado = pago_efectivo + cuenta_por_pagar_generada` (donde
`cuenta_por_pagar_generada = P − pagado`); y a nivel agregado,
`Σ(pago_devengado) = Σ(cierre_dia.total_pago_mensajero)` de los `CierreDia` aprobados. NINGÚN
peso devengado DEBE quedar sin representarse como pagado o como cuenta por pagar.

**R16** — La cuenta por pagar de un mensajero DEBE poder ser positiva (Ordenex le debe) o cero,
y NUNCA negativa en el flujo normal (una liquidación no puede exceder lo devengado pendiente);
DEBE exponerse como STRING con dos decimales, sin pérdida de precisión. El sistema DEBE exponer
además, por mensajero, `total_devengado` (`Σ devengo`) y `total_pagado` (`Σ pago`) como STRING.

### Egreso en la caja principal (42) `[F1.4-Qa]` (condicional)

**R17** `[F1.4-Qa]` — DONDE el humano habilite reflejar el pago al mensajero en la caja
principal (42), CUANDO un `CierreDia` se apruebe, el sistema DEBE insertar EN LA MISMA
transacción un EGRESO en `wallet_movimiento` con `tipo = egreso`,
`categoria = egreso_pago_mensajero`, `origen_tipo = cierre_dia`, `origen_id = cierreId` y
`monto = P` (el pago debido total), reduciendo el balance de la empresa; ese egreso DEBE ser
idempotente por el constraint existente de la 42 `(origen_tipo, origen_id, categoria)` (un solo
egreso por cierre). SI el humano NO lo habilita (recomendado como follow-up, alinear con 43),
las categorías/orígenes de egreso DEBEN quedar RESERVADOS (ya lo están) para incorporarlo sin
cambio de esquema. El egreso, si se emite, refleja el COSTO total del pago (accrual); la
posterior liquidación de la cuenta por pagar (R23) NO DEBE volver a generar un egreso en 42
(evita doble conteo).

### Vista y permisos `[F1.4-Qe]`

**R18** `[F1.4-Qe]` — El sistema DEBE exponer al `maestro` una pantalla con las CUENTAS POR
PAGAR a mensajeros: por cada mensajero, `total_devengado`, `total_pagado` y `cuenta_por_pagar`
(pendiente), y el DESGLOSE por cierre, paginado, más reciente primero.

**R19** `[F1.4-Qe]` — MIENTRAS el `maestro` consulta las cuentas por pagar, el sistema NO lo
DEBE acotar a un solo mensajero (ve a todos). Un usuario sin rol autorizado DEBE recibir no
autorizado (forbidden) sin exponer datos.

**R20** `[F1.4-Qe]` — DONDE el humano habilite la vista propia del mensajero, MIENTRAS un
`mensajero` consulta sus pagos, el sistema DEBE acotar los datos a SU `mensajero_id` (=
`actor.usuarioId`) SIEMPRE en el WHERE (nunca en memoria) y NO DEBE exponer los pagos ni la
cuenta por pagar de ningún otro mensajero.

**R21** — Los montos y saldos (datos financieros sensibles) DEBEN pre-obtenerse en un Server
Component y pasarse ya serializados (STRING) a los componentes `private/`; el cliente NO DEBE
recibir `Prisma.Decimal` ni recalcular montos.

**R22** — El sistema DEBE permitir filtrar el desglose por rango de fechas, por cierre y/o por
mensajero (en la vista del maestro); el saldo mostrado DEBE reflejar el conjunto filtrado
cuando aplique o exponer los totales claramente etiquetados.

### Liquidación de la cuenta por pagar `[F1.4-Qf]` (condicional)

**R23** `[F1.4-Qf]` — DONDE el humano habilite la liquidación en el alcance de la 44, CUANDO el
`maestro` registre el pago de una cuenta por pagar a un mensajero, el sistema DEBE, en una sola
transacción atómica e idempotente, insertar un movimiento `pago`/`liquidacion` en el libro del
mensajero (`origen_tipo = pago_mensajero`), reduciendo su cuenta por pagar; el monto DEBE ser
positivo y NO DEBE exceder la cuenta por pagar vigente. SI la 44 se limita a modelo +
visibilidad + enganche automático (recomendado), la categoría/origen de liquidación DEBEN
quedar RESERVADOS para un follow-up sin cambio de esquema.

### Datos, RLS e integridad

**R24** — La tabla nueva del libro por mensajero DEBE tener RLS habilitada SIN policies
`anon`/`authenticated` (acceso solo vía service role), consistente con `wallet_movimiento`/
`wallet_tienda_movimiento`/`cierre_dia`.

**R25** — La persistencia DEBE introducirse mediante una migración ADITIVA con su `down.sql`
reversible; la migración NO DEBE romper la lectura de datos existentes ni alterar los enums de
la 42 (que se reutilizan).

**R26** — La tabla DEBE tener índices para: (a) la guardia de idempotencia (constraint único
parcial sobre `origen_tipo, origen_id, mensajero_id, categoria` WHERE `origen_id IS NOT NULL`),
(b) el listado/saldo por mensajero y fecha (`mensajero_id, fecha_movimiento`), y (c)
movimientos de un origen (`origen_tipo, origen_id`); ninguna consulta de saldo/listado en ruta
caliente DEBE quedar sin índice.

**R27** — El sistema NO DEBE exponer por ninguna vía (DTO/serialización) un monto ni un saldo
como `number`; siempre STRING con dos decimales (aserción transversal money-critical).

---

## Trazabilidad R → tipo de test

| Req | Test (archivo / caso) — a fijar por el implementer |
| --- | --- |
| R1  | `tests/unit/services/wallet-mensajero-feed-service.test.ts` — fila inmutable devengo/pago por mensajero |
| R2  | `tests/unit/repositories/pago-mensajero-movimiento-repository.test.ts` — persiste mensajero_id/tipo/categoria/monto/origen/fecha |
| R3  | `tests/unit/services/wallet-mensajero-service.test.ts` — sin update/delete; corrección = ajuste compensatorio |
| R4  | `tests/unit/utils/cuenta-por-pagar.test.ts` — Decimal exacto, salida STRING 2 decimales |
| R5  | `tests/unit/services/cierres-admin-service.test.ts` — aprobar CierreDia genera movimientos del pago |
| R6  | `tests/integration/db/pago-mensajero-idempotencia.test.ts` — doble aprobación = un solo set (constraint DB) |
| R7  | `tests/unit/repositories/cierres-admin-repository.test.ts` — fallo al insertar revierte la aprobación (misma tx que 42/43) |
| R8  | `tests/unit/services/wallet-mensajero-feed-service.test.ts` — lee total_pago_mensajero/total_efectivo del cierre, no re-deriva |
| R9  | idem — pagado = min(P,E) con Decimal; pagado ≤ E y pagado ≤ P |
| R10 | idem — P>0 → pago_devengado=P; pagado>0 → pago_efectivo=pagado; pendiente derivado; P=0 → sin movimiento |
| R11 | `tests/unit/services/cierres-bodega-admin-service.test.ts` — aprobar CierreBodega NO genera movimientos del pago mensajero |
| R12 | `tests/unit/services/cierres-admin-service.test.ts` — vencido→aprobado alimenta una vez |
| R13 | `tests/unit/services/wallet-mensajero-feed-service.test.ts` — netting por cierre (dos cierres del mismo mensajero no se cruzan) |
| R14 | `tests/unit/utils/cuenta-por-pagar.test.ts` — cuenta por pagar = Σdevengo − Σpago (Decimal), sin saldo almacenado |
| R15 | `tests/unit/services/wallet-mensajero-feed-service.test.ts` — invariante pago_devengado = pago_efectivo + cuenta_por_pagar; Σdevengo = Σtotal_pago_mensajero |
| R16 | `tests/unit/utils/cuenta-por-pagar.test.ts` — pendiente positivo/cero, nunca negativo; total_devengado/total_pagado STRING |
| R17 | `tests/integration/db/pago-mensajero-idempotencia.test.ts` (si Qa aprobado) egreso_pago_mensajero en caja 42 al aprobar, idempotente; (si no) enum/origen reservados presentes |
| R18 | `tests/integration/wallet-mensajeros-page.test.tsx` — maestro ve cuentas por pagar de todos + desglose por cierre |
| R19 | `tests/unit/services/wallet-mensajero-service.test.ts` + page test — maestro no acotado; otro rol → forbidden/notFound |
| R20 | `tests/unit/services/wallet-mensajero-service.test.ts` (si Qe self-view) — mensajero acotado a su mensajero_id en el WHERE |
| R21 | `tests/integration/wallet-mensajeros-page.test.tsx` — datos vía Server Component → props STRING, sin Decimal al cliente |
| R22 | `tests/unit/services/wallet-mensajero-service.test.ts` — filtros fecha/cierre/mensajero aplican en el WHERE |
| R23 | `tests/integration/db/pago-mensajero-liquidacion.test.ts` — (si Qf aprobado) liquidacion reduce cuenta por pagar, no supera lo pendiente, sin egreso 42 nuevo; (si no) enum reservado |
| R24 | `tests/integration/db/pago-mensajero-migration.test.ts` — RLS habilitada sin policies anon/authenticated |
| R25 | `tests/integration/db/pago-mensajero-migration.test.ts` — round-trip up/down reversible; enums 42 intactos |
| R26 | `tests/integration/db/pago-mensajero-migration.test.ts` — índices + unique parcial de idempotencia presentes |
| R27 | `tests/unit/*` transversal — asserts de tipo STRING en todos los DTOs de monto/saldo |

---

## F1.4 — decisiones (deliberación; el humano fija cada una)

> ### ✅ F1.4 APROBADA (2026-07-13) — todas con la recomendación
> - **Qa = SÍ**: además del libro propio `pago_mensajero_movimiento`, se refleja el EGRESO
>   completo `P` en la caja principal (42) con `categoria=egreso_pago_mensajero`,
>   `origen_tipo=cierre_dia`, idempotente por el constraint existente de la 42. La liquidación
>   posterior NO vuelve a emitir egreso. → **R17 FIRME (habilitado)**.
> - **Qb = append-only con cuenta por pagar DERIVADA** (`Σdevengo − Σpago`), sin estado mutable. → R1/R2/R14 firmes.
> - **Qc = AUTOMÁTICO al aprobar el `CierreDia`** (mismo `resolverCierre`/tx idempotente). → R5/R7 firmes.
> - **Qd = `pagado = min(P,E)`, `pendiente = P − pagado`, `P=0` sin movimiento.** → R9/R10 firmes.
> - **Qe = SÍ**: vista del maestro `/wallet/mensajeros` (todos) **y** vista propia del mensajero
>   `/mis-pagos` (acotada a su `mensajero_id`). **adminSatélite NO ve** (egreso de la caja
>   central del maestro). → R18/R19/R20 FIRMES (self-view habilitada); A1=`/mis-pagos`, A2=adminSatélite NO.
> - **Qf = Modelo + visibilidad + enganche automático**; la LIQUIDACIÓN manual (saldar lo
>   pendiente) = FOLLOW-UP. Categoría `liquidacion` + `origen_tipo=pago_mensajero` quedan
>   RESERVADOS (sin migración futura). → **R23 diferido**: Bloque 8/T17 solo verifica que el
>   enum/origen quedan reservados y usables (NO se implementa el acto de liquidar en la 44).
> - Supuestos A3 (efectivo total en mano como bound del pago), A4 (colón, sin multimoneda) y A5
>   (bordes `P=0`/`E=0`/`E≥P`) confirmados según lo descrito.

Cada pregunta trae RECOMENDACIÓN + alternativa descartada.

**Qa (LA PRINCIPAL, money-critical) — Modelo del egreso e impacto en la caja 42.** ¿El pago al
mensajero se modela como un LIBRO propio por mensajero (`pago_mensajero_movimiento`, espejo de
la 43) para lo pagado/pendiente, y ADEMÁS se refleja como EGRESO en la caja principal (42), o
solo como libro propio?
- **Recomendación: LIBRO propio `pago_mensajero_movimiento`** (fuente de verdad de lo pagado y
  la cuenta por pagar, congelado al aprobar, mismo enganche `resolverCierre`) **Y SÍ reflejar
  el egreso completo `P` en la caja 42** (`egreso_pago_mensajero`, ya reservado) en la misma
  tx. Razón: el pago al mensajero es un COSTO real de Ordenex; el "balance general" es un
  entregable central de la 42 y sin ese egreso el balance sobrestima la utilidad (a diferencia
  del saldo a favor de la tienda de la 43, que es dinero de la tienda en tránsito, no un costo).
  El egreso se contabiliza por lo devengado (accrual); la liquidación posterior de la cuenta
  por pagar NO vuelve a golpear la caja (evita doble conteo). Idempotente por el constraint
  existente de la 42.
- **Alternativa descartada — solo libro propio, sin tocar la caja 42** (espejo exacto del
  alcance de la 43, que difirió `egreso_pago_tienda`): mantiene el alcance mínimo y no toca la
  caja, PERO deja el balance general de la 42 SIN reflejar el costo del pago a mensajeros
  (sobrestima utilidad). Queda como opción si el humano prefiere diferir el impacto en caja y
  primero entregar solo visibilidad; los enums ya reservados lo permiten sin migración.

**Qb — Modelo de la cuenta por pagar (lo pendiente).** ¿Fila con estado pagado/pendiente y
saldo mutable, derivado, o append-only con la cuenta por pagar como saldo derivado?
- **Recomendación: append-only con la cuenta por pagar DERIVADA** = `Σ(devengo) − Σ(pago)`. Al
  aprobar se congela `pago_devengado = P` (tipo devengo) y `pago_efectivo = pagado` (tipo pago);
  lo pendiente NO es una fila, es el saldo. Una liquidación futura agrega un `pago`/`liquidacion`
  que reduce el saldo. Razón: mismo patrón inmutable y auditable de 42/43 (nada de estados
  mutables que se desincronizan; correcciones por ajuste compensatorio).
- **Alternativa descartada — una fila "cuenta por pagar" con columna estado
  (pendiente→pagado) que se UPDATE-a al saldar:** viola la inmutabilidad (42/R3, 43/R3), abre
  TOCTOU y pierde el historial de pagos parciales. Se descarta.

**Qc — Disparador.** ¿Se congela AL APROBAR el `CierreDia` (mismo enganche idempotente que
42/43) o es una acción MANUAL "pagar" del maestro?
- **Recomendación: AUTOMÁTICO al aprobar el `CierreDia`** (mismo `resolverCierre`, misma tx,
  idempotente por constraint). El reflejo de lo pagado (del efectivo) y lo pendiente es
  consecuencia directa de la aprobación; no requiere acción humana. El ACTO de saldar la cuenta
  por pagar (entregar el dinero pendiente) SÍ es una acción aparte (ver Qf).
- **Alternativa descartada — todo manual:** obligaría al maestro a registrar el pago tomado del
  efectivo caso por caso, cuando ese dato ya está determinado por los snapshots del cierre.

**Qd — Reglas de monto.** Confirmar `pagado = min(P, E)`, `pendiente = P − pagado`, y el borde
`P = 0`.
- **Recomendación: confirmadas.** `pagado = min(P, E)` (acotado por el efectivo recaudado);
  `pendiente = P − pagado`; si `P = 0` (cierre sin entregas que paguen) NO se genera ningún
  movimiento. Si `E ≥ P`, `pendiente = 0` (pago cubierto íntegro por el efectivo). Todo con
  `Prisma.Decimal`.
- **Alternativa descartada — netear acumulando efectivo entre cierres:** rompe la limpieza del
  snapshot por cierre y la idempotencia por `(cierre)`. Se descarta (ver R13).

**Qe — Vista y rol.** ¿Vista del maestro de cuentas por pagar (recomendado `/wallet/mensajeros`,
espejo de `/wallet/tiendas`)? ¿El mensajero ve su propia cuenta por pagar?
- **Recomendación: vista del `maestro`** `/wallet/mensajeros` (cuentas por pagar de todos los
  mensajeros + desglose por cierre), espejo de `/wallet/tiendas`; **y vista propia del
  `mensajero`** `/mis-pagos` (acotada a su `mensajero_id`), espejo de `/mi-wallet`. Confirmar si
  el mensajero debe ver su cuenta por pagar (recomendado sí, transparencia) y si el
  `adminSatelite` ve las cuentas por pagar de los mensajeros de SU zona (recomendado NO en la
  44: el pago a mensajeros es un egreso de la caja CENTRAL de Ordenex, propiedad del maestro).
- **Alternativa descartada — embeber todo en `/wallet` sin rutas nuevas:** el desglose por
  cierre + la futura liquidación justifican módulos propios, como en 42/43.

**Qf — Alcance.** ¿La 44 = modelo + visibilidad + enganche automático (liquidación manual como
follow-up), o incluye el acto de saldar la cuenta por pagar?
- **Recomendación: acotar a modelo + visibilidad + enganche automático al aprobar; la
  LIQUIDACIÓN manual (saldar lo pendiente) queda como FOLLOW-UP** (categoría `liquidacion` +
  `origen_tipo = pago_mensajero` reservados → sin cambio de esquema). Mantiene el alcance
  money-critical acotado y entrega primero la visibilidad correcta. SI el humano lo pide dentro
  de la 44, R23 lo cubre.
- **Alternativa descartada — incluir el flujo completo de liquidación (comprobantes,
  conciliación) en la 44:** demasiado alcance; se prefiere el patrón incremental de 43.

---

## Preguntas abiertas (además de F1.4)

- **A1 — Ruta de la vista del mensajero (ligada a Qe):** se asume `/mis-pagos` (espejo de
  `/mi-wallet`) salvo indicación; confirmar el nombre.
- **A2 — Visibilidad del `adminSatelite`:** se asume que el `adminSatelite` NO ve las cuentas
  por pagar (el pago a mensajeros pertenece a la caja central del maestro). Confirmar si el
  negocio requiere que la bodega satélite vea lo que se debe a sus mensajeros.
- **A3 — Efectivo que incluye la parte de la tienda:** `total_efectivo` es todo el efectivo que
  el mensajero recaudó (incluye la parte que le corresponde a la tienda). Se asume que el pago
  se toma de ese efectivo total en mano (bound físico correcto: no se puede pagar más efectivo
  del recaudado). Confirmar que el negocio no restringe el pago solo a la parte de Ordenex.
- **A4 — Moneda única (colones), sin multi-moneda:** se asume igual que 42/43.
- **A5 — Mensajeros con cierre sin pago (`P = 0`) o sin efectivo (`E = 0`):** `P = 0` no genera
  movimientos (R10); `E = 0` genera devengo `P` y cuenta por pagar `P` sin `pago_efectivo`
  (R9/R10).
