# Feature 43 — Wallet POR TIENDA (saldo a favor de la tienda) — requirements.md

> **Estado: `spec_ready` → puerta de aprobación humana F1.4 APROBADA (ver bloque de abajo).**
> Money-critical. `sdd: true`. Zona: fullstack, complexity: high. `depends_on`: feature 42
> (wallet/caja principal, YA en `dev`) y 18/54 (tarifas). Baseline VERDE sobre `origin/dev`
> f25f4a8. Rama `feature/43-wallet-por-tienda`.
>
> Los requisitos marcados `[F1.4-Qn]` quedaron FIJADOS por las decisiones del bloque
> "F1.4 APROBADA 2026-07-12".

---

## F1.4 APROBADA 2026-07-12

Puerta de aprobación humana F1.4 superada el **2026-07-12**. Decisiones EXACTAS (las
recomendaciones de la sección "F1.4 — decisiones" quedan fijadas salvo lo indicado en Q3):

- **Q1 (modelo del saldo): APROBADA la recomendación** → LEDGER propio
  `wallet_tienda_movimiento`, alimentado en el mismo enganche `resolverCierre` (misma
  `$transaction`), congelando los montos al aprobar (reutiliza `derivarIngresoOrden` de la 42).
  Sin cambios. (R1, R5–R8)
- **Q2 (base del COD): APROBADA la recomendación** → el crédito a favor usa el COD REALMENTE
  recaudado (`gestion_orden.montoRecibido`); los débitos (flete/comisión/IVAs) se toman tal cual
  de la 42 (la comisión sigue basada en `montoCobrar`, decisión de la 42 que la 43 NO altera).
  Sin cambios. (R9)
- **Q3 (devuelta/rechazada): APROBADA la OPCIÓN 1 (la tienda DEBE el flete de devolución →
  saldo negativo) PERO CON REQUISITO DE REVERSIBILIDAD.** El comportamiento aprobado (opción 1)
  es el DEFAULT; debe poder cambiarse a la opción 2 (la devolución NO afecta a la tienda) SIN
  rehacer la feature, mediante un interruptor de configuración de una sola fuente de verdad
  (`TIENDA_DEBITA_FLETE_DEVOLUCION`, ver R10 y R28). (R10, R15, R28)
- **Q4 (alcance): APROBADA la recomendación** → la 43 = MODELO del saldo + VISIBILIDAD
  (adminTienda ve el suyo; maestro ve todos). El PAGO/liquidación efectivo queda como FOLLOW-UP
  (feature aparte), con `pago_tienda`/`egreso_pago_tienda` RESERVADOS. (R23)
- **Q5 (vista/rol): APROBADA la recomendación** → pantalla NUEVA `/mi-wallet` para el
  `adminTienda` (acotada a su `usuarioId` = `tienda_id`) con saldo + desglose por
  cierre/concepto; el `maestro` ve el saldo de TODAS las tiendas (vista propia). (R18–R22)
- **Q6 (granularidad): APROBADA la recomendación** → un movimiento por CONCEPTO agregado por
  (tienda, cierre); categorías espejo 1:1 de la 42; omite conceptos en 0.00. (R8, R11)

Todos los requisitos `[F1.4-Qn]` de este documento están FIJADOS. La sección "F1.4 —
decisiones" de más abajo se conserva como MEMORIA de la deliberación (recomendaciones +
alternativas descartadas), no como decisión pendiente.

---

## Contexto y alcance

Cada **TIENDA** (usuario con rol `adminTienda`) tiene su PROPIA wallet: **cuánto le debe
ENTREGAR Ordenex**, es decir su **SALDO A FAVOR**. Ordenex recauda el dinero total de la venta
(COD) y parte le pertenece a la tienda. Por cada orden:

```
saldo de la tienda (por orden) = COD recaudado
                                − flete
                                − comisión del COD
                                − IVA del flete
                                − IVA de la comisión
```

**Observación clave (reutilización estricta de la feature 42):** los cuatro conceptos que se
restan del COD son EXACTAMENTE los mismos que Ordenex percibe como INGRESO en la feature 42
(caja principal). El saldo de la tienda es el **COMPLEMENTO EXACTO** del ingreso de Ordenex de
esa orden. Por tanto la 43 **NO define una fórmula nueva**: reutiliza el cálculo por concepto
de la 42 (`lib/utils/ingreso-ordenex.ts` → `derivarIngresoOrden`) y se alimenta en el MISMO
enganche del cierre aprobado (`CierresAdminRepository.resolverCierre`, dentro de la misma
`$transaction`).

### Hallazgos VERIFICADOS en código (no supuestos)

- **Tienda de una orden:** `orden.tiendaId` (`tienda_id`, FK → `usuario`, **NOT NULL**) es la
  tienda dueña de la orden (`db/schema.prisma`, `model Orden`). El `adminTienda` logueado **ES**
  la tienda: su `usuarioId` (de `resolveActorFromSession` → `Actor { usuarioId, rol }`) coincide
  con `orden.tiendaId`. Rol en `RolValue` = `adminTienda` (`@map("Admin Tienda")`).
- **COD recaudado:** `gestion_orden.montoRecibido` (`monto_recibido`, `Decimal(12,2)`, nullable)
  es el COD REALMENTE recaudado en una `entregada`; es `null` en `devuelta`/`rechazada`/
  `reprogramada`. `orden.montoCobrar` (`monto_cobrar`, nullable) es el COD TEÓRICO a recaudar.
- **Conceptos de descuento (ya calculados por la 42):** `derivarIngresoOrden({ resultado,
  esCentral, montoCobrar, cobraComision }, tarifa)` devuelve, por gestión, los conceptos
  `ingreso_flete`, `ingreso_iva_flete`, `ingreso_comision_cod`, `ingreso_iva_comision_cod`
  (camino `entregada`) o `ingreso_flete_devolucion`, `ingreso_iva_flete_devolucion` (camino
  `devuelta`/`rechazada`); `reprogramada` no aporta. Tarifa vigente por zona vía
  `ITarifaVigentePorZonaRepository.resolveTarifaPorZona(zonaId)`; `null` → conceptos 0.00 (42/R9).
- **Enganche del cierre:** `CierresAdminRepository.resolverCierre` ya abre `prisma.$transaction`
  y, al aprobar (`res.count === 1 && nuevoEstado === 'aprobado'`), llama
  `walletFeedService.construirMovimientosDeIngreso(cierreId, tx)` +
  `walletMovimientoRepo.crearMovimientos(tx, movs)`. La 43 engancha en el MISMO punto/tx.
- **Enums 42 ya reservados para la 43:** `WalletMovimientoCategoria.egreso_pago_tienda` y
  `WalletOrigenTipo.pago_tienda` (`lib/types/wallet.ts`, `db/schema.prisma`) están reservados
  para el PAGO/liquidación a la tienda (F1.4-Q4).
- **Idempotencia 42:** índice único parcial `(origen_tipo, origen_id, categoria)` +
  `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING). La 43 replica el patrón
  añadiendo la dimensión `tienda_id`.
- **Money-critical:** todo el flujo usa `Prisma.Decimal` y serializa a STRING `toFixed(2)`; cero
  `parseFloat`/`Number(` sobre montos (`lib/utils/wallet-balance.ts`, `cierre-totales.ts`).

### Fuera de alcance

- Recalcular/editar tarifas (18/54) o cierres (37/38/40/41) — la 43 los CONSUME.
- Contabilidad formal, conciliación bancaria, exportación contable.
- La captura editable de `orden.cobraComision` (deuda A5 de la 42).
- El flujo REAL de pago a mensajeros (44) y gastos/sueldos (45).
- **El PAGO/liquidación efectivo a la tienda** queda condicionado a F1.4-Q4 (recomendado como
  follow-up; ver R23).

---

## Requisitos (EARS)

### Modelo del saldo por tienda (append-only, inmutable) `[F1.4-Q1,Q6]`

**R1** `[F1.4-Q1]` — El sistema DEBE modelar el saldo de cada tienda como un LIBRO append-only
de movimientos por tienda: cada movimiento es una fila INMUTABLE, con dimensión `tienda_id`,
que representa un CRÉDITO a favor de la tienda (COD recaudado) o un DÉBITO (descuento de Ordenex
o pago a la tienda).

**R2** `[F1.4-Q1,Q6]` — Cada movimiento DEBE registrar, como mínimo: `tienda_id` (FK → usuario
rol adminTienda), `tipo` (`credito`|`debito`), `categoria` (concepto), `monto` (`Decimal(12,2)`
> 0), `origen_tipo` + `origen_id` (referencia polimórfica al origen: `cierre_dia`, `pago_tienda`
o `manual`), fecha del movimiento, y opcionalmente `registrado_por` y `descripcion`.

**R3** — El sistema NO DEBE permitir modificar (UPDATE) ni eliminar (DELETE) un movimiento ya
creado; una corrección DEBE realizarse mediante un movimiento de AJUSTE compensatorio, nunca
alterando el original (misma regla de inmutabilidad que 42/R3).

**R4** — El sistema DEBE calcular y persistir todos los montos con aritmética decimal exacta
(`Prisma.Decimal`) y exponerlos en la frontera Server Action→cliente como STRING con dos
decimales; NUNCA con `number`/`parseFloat`/`Number(`.

### Alimentación desde el cierre aprobado (reutiliza la 42, money-critical)

**R5** — CUANDO un `CierreDia` transiciona a `aprobado` (por `solicitado`→`aprobado` o
`vencido`→`aprobado`), el sistema DEBE generar, para cada tienda con órdenes en ese cierre, los
movimientos de saldo (crédito COD + débitos por concepto) correspondientes.

**R6** — La generación de movimientos por tienda DEBE ser IDEMPOTENTE a nivel de base de datos
mediante un constraint único sobre `(origen_tipo, origen_id, tienda_id, categoria)` (no un
check-then-insert en memoria; sin TOCTOU): re-aprobar el mismo cierre NO DEBE duplicar
movimientos.

**R7** — La generación de movimientos por tienda DEBE ser ATÓMICA con la transición del cierre
y con la alimentación de la caja principal (42): todo ocurre en la MISMA `$transaction` de
`resolverCierre`; si falla cualquier inserción, la aprobación (y la alimentación de 42 y 43) hace
rollback completo (todo-o-nada).

**R8** `[F1.4-Q1]` — Al derivar los DÉBITOS por concepto de cada gestión, el sistema DEBE
REUTILIZAR EXACTAMENTE el cálculo de la feature 42 (`lib/utils/ingreso-ordenex.ts`,
`derivarIngresoOrden`), sin definir una fórmula divergente. Las categorías de débito de la 43
DEBEN mapear 1:1 a los conceptos de ingreso de la 42: `flete`↔`ingreso_flete`,
`flete_devolucion`↔`ingreso_flete_devolucion`, `comision_cod`↔`ingreso_comision_cod`,
`iva_flete`↔`ingreso_iva_flete`, `iva_flete_devolucion`↔`ingreso_iva_flete_devolucion`,
`iva_comision_cod`↔`ingreso_iva_comision_cod`.

**R9** `[F1.4-Q2]` — El CRÉDITO a favor de la tienda (categoría `cod_recaudado`) DEBE calcularse
sobre el COD REALMENTE recaudado (`gestion_orden.montoRecibido`), NO sobre el COD teórico
(`orden.montoCobrar`). SI `montoRecibido` es `null` (devuelta/rechazada/reprogramada), ENTONCES
el crédito COD de esa orden DEBE tratarse como `0.00`.

**R10** `[F1.4-Q3]` — MIENTRAS el interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` esté en `true`
(default, opción 1 aprobada), CUANDO una gestión es `devuelta` o `rechazada`, el sistema DEBE
registrar los débitos de flete de devolución (`flete_devolucion`) y su IVA
(`iva_flete_devolucion`) —los mismos que Ordenex percibe en 42— SIN crédito COD, de modo que
esas órdenes DEJAN a la tienda DEBIENDO ese flete de devolución (aportan saldo NEGATIVO por esa
orden). MIENTRAS el interruptor esté en `false` (opción 2), CUANDO una gestión es `devuelta` o
`rechazada`, el sistema NO DEBE generar los débitos `flete_devolucion`/`iva_flete_devolucion` en
el ledger de la TIENDA (la devolución no afecta su saldo). En AMBOS estados, CUANDO una gestión
es `reprogramada` (u otro resultado en tránsito), el sistema NO DEBE generar ni crédito ni
débito. El interruptor NO altera en ningún caso el ingreso de Ordenex de la 42 (ver R28).

**R11** `[F1.4-Q6]` — El sistema DEBE crear UN movimiento por (tienda, cierre, concepto)
agregado: `origen_tipo = cierre_dia`, `origen_id` = id del cierre, `tienda_id` = tienda. NO DEBE
crear un movimiento para un concepto cuyo total agregado por esa tienda en ese cierre sea `0.00`.

**R12** — SOLO los `CierreDia` aprobados DEBEN alimentar el saldo por tienda; los `CierreBodega`
aprobados (feature 40) NO DEBEN generar movimientos (agregan cierres ya contados; evitar doble
conteo; fuente única = `CierreDia`, igual que 42/R11).

**R13** — CUANDO un `CierreDia` en estado `vencido` (feature 41) se aprueba, el sistema DEBE
alimentar el saldo por tienda EXACTAMENTE una vez, sin duplicar (garantía por el constraint de
R6, igual que 42/R12).

**R14** — SI no existe tarifa vigente para la zona de una orden, ENTONCES los DÉBITOS por
concepto de esa orden DEBEN ser `0.00` (heredado de 42/R9, ya que se reutiliza el mismo cálculo)
y el sistema NO DEBE bloquear la aprobación; el CRÉDITO `cod_recaudado` (que no depende de la
tarifa) DEBE seguir registrándose normalmente.

### Invariante de cuadre con la 42 (money-critical, testeable)

**R15** `[F1.4-Q3]` — El sistema DEBE satisfacer, de forma verificable por test, el invariante
de cuadre, cuyo enunciado DEPENDE del interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION`:
- **CUANDO el interruptor es `true`** (default): por cada cierre aprobado y para cada tienda,
  `saldo de la tienda + ingreso de Ordenex (42) = COD recaudado` cuadra EXACTAMENTE
  (`Σ(créditos cod_recaudado) − Σ(débitos de concepto) = COD recaudado de esa tienda − ingreso
  de Ordenex de las órdenes de esa tienda`); y a nivel de concepto, la suma del débito `X` de
  TODAS las tiendas de un cierre DEBE ser igual al ingreso `ingreso_X` que la 42 registró.
- **CUANDO el interruptor es `false`**: el cuadre se mantiene para las órdenes `entregada`,
  pero para las órdenes `devuelta`/`rechazada` la diferencia `COD recaudado − (saldo tienda +
  ingreso Ordenex)` DEBE ser EXACTAMENTE el flete de devolución + su IVA
  (`ingreso_flete_devolucion + ingreso_iva_flete_devolucion` de la 42), absorbido por Ordenex y
  SIN contraparte en el ledger de la tienda. A nivel de concepto, `Σ_tiendas(flete_devolucion)`
  y `Σ_tiendas(iva_flete_devolucion)` DEBEN ser `0.00`, mientras el ingreso homólogo de la 42
  permanece intacto.

El test de invariante DEBE cubrir AMBOS estados del interruptor.

### Saldo derivado (nunca almacenado)

**R16** — El sistema DEBE DERIVAR el saldo a favor de una tienda sumando sus movimientos
(`Σ(credito) − Σ(debito)` con `Prisma.Decimal`), y NUNCA leerlo de un saldo mutable almacenado
que pueda desincronizarse (mismo principio que 42/R16).

**R17** — El saldo de una tienda DEBE poder ser positivo (Ordenex le debe), negativo (la tienda
debe a Ordenex, p. ej. por devoluciones) o cero, y exponerse como STRING con dos decimales y
signo explícito, sin pérdida de precisión.

### Vista y permisos (adminTienda / maestro) `[F1.4-Q5]`

**R18** `[F1.4-Q5]` — El sistema DEBE exponer al `adminTienda` una pantalla con SU saldo a favor
(total) y el DESGLOSE por cierre y por concepto (crédito COD y débitos), paginado, más reciente
primero.

**R19** `[F1.4-Q5]` — MIENTRAS un `adminTienda` consulta su wallet, el sistema DEBE acotar los
datos a SU `tienda_id` (= `actor.usuarioId`) SIEMPRE en el WHERE de la query (nunca en memoria);
NO DEBE exponer movimientos ni saldo de ninguna otra tienda. Un usuario sin rol autorizado (ni
`adminTienda` dueño, ni `maestro`) DEBE recibir no autorizado (forbidden) sin exponer datos.

**R20** `[F1.4-Q5]` — DONDE el `maestro` acceda a la wallet por tienda, el sistema DEBE permitirle
ver el saldo a favor de TODAS las tiendas (lista de saldos + desglose por tienda), para efectos
de liquidación; el `maestro` NO queda acotado a una sola `tienda_id`.

**R21** — Los saldos y montos (datos financieros sensibles) DEBEN pre-obtenerse en un Server
Component y pasarse ya serializados (STRING) a los componentes `private/`; el cliente NO DEBE
recibir `Prisma.Decimal` ni recalcular montos.

**R22** — El sistema DEBE permitir filtrar el desglose por rango de fechas, por cierre y/o por
concepto (`categoria`); el saldo mostrado DEBE reflejar el conjunto filtrado cuando aplique o
exponer el saldo total claramente etiquetado.

### Pago / liquidación a la tienda `[F1.4-Q4]` (condicional)

**R23** `[F1.4-Q4]` — DONDE el humano habilite el PAGO/liquidación a la tienda en el alcance de
la 43, CUANDO el `maestro` registre un pago a una tienda, el sistema DEBE, en una sola
transacción atómica e idempotente: (a) insertar un EGRESO `egreso_pago_tienda` en la caja
principal (42, `wallet_movimiento`) con `origen_tipo = pago_tienda`, reduciendo el balance de la
empresa; y (b) insertar un DÉBITO `pago_tienda` en el ledger de esa tienda, reduciendo su saldo a
favor. Ambos montos DEBEN ser iguales y positivos. SI la 43 se limita a visibilidad (recomendado),
las categorías/orígenes de pago DEBEN quedar RESERVADOS en el modelo para un follow-up sin cambio
de esquema.

### Datos, RLS e integridad

**R24** — La tabla nueva del ledger por tienda DEBE tener RLS habilitada SIN policies
`anon`/`authenticated` (acceso solo vía service role), consistente con `wallet_movimiento`/
`gestion_orden`/`cierre_dia`.

**R25** — La persistencia DEBE introducirse mediante una migración ADITIVA con su `down.sql`
reversible; la migración NO DEBE romper la lectura de datos existentes.

**R26** — La tabla del ledger por tienda DEBE tener índices para: (a) la guardia de idempotencia
(constraint único parcial sobre `origen_tipo, origen_id, tienda_id, categoria` WHERE `origen_id
IS NOT NULL`), (b) el listado/saldo por tienda y fecha (`tienda_id, fecha_movimiento`), y (c) el
filtro por concepto; ninguna consulta de saldo/listado en ruta caliente DEBE quedar sin índice.

**R27** — El sistema NO DEBE exponer por ninguna vía (DTO/serialización) un monto ni un saldo
como `number`; siempre STRING con dos decimales (aserción transversal money-critical).

### Reversibilidad de la regla de devolución (Q3) `[F1.4-Q3]`

**R28** `[F1.4-Q3]` — El sistema DEBE exponer un interruptor de configuración
`TIENDA_DEBITA_FLETE_DEVOLUCION` (booleano) como ÚNICA fuente de verdad de la regla Q3, con
DEFAULT `true` (opción 1 aprobada: la tienda debe el flete de devolución + su IVA). El
interruptor DEBE cumplir:
- Cuando vale `true`, la alimentación GENERA los débitos `flete_devolucion` e
  `iva_flete_devolucion` en el ledger de la TIENDA para las gestiones `devuelta`/`rechazada`
  (R10, R15 caso `true`).
- Cuando vale `false`, la alimentación NO GENERA esos dos débitos en el ledger de la TIENDA (la
  devolución no afecta su saldo); el ingreso de Ordenex de la 42 NO cambia en ningún caso (la
  diferencia la ABSORBE Ordenex). El interruptor SOLO condiciona esas dos categorías de débito
  de la tienda, nunca el crédito COD ni los demás débitos ni el cálculo de la 42.
- El interruptor DEBE leerse en UN solo punto (config del módulo, p. ej.
  `lib/config/wallet-tienda.ts`), no repartido por el código, de modo que cambiar la regla sea
  un cambio local y auditable.

**R29** `[F1.4-Q3]` — Como los débitos de devolución de la tienda son SU PROPIA categoría en un
libro append-only e inmutable (R3), cambiar `TIENDA_DEBITA_FLETE_DEVOLUCION` a futuro DEBE ser
limpio y SIN reescribir la feature: hacia adelante se deja de generar (o se vuelve a generar)
esas dos categorías; lo HISTÓRICO ya registrado se revierte ÚNICAMENTE mediante movimientos de
AJUSTE compensatorio (`ajuste_credito`/`ajuste_debito`), NUNCA con `UPDATE`/`DELETE` de las
filas existentes (respeta R3). El sistema NO DEBE requerir migración de esquema para alternar el
interruptor.

---

## Trazabilidad R → tipo de test

| Req | Test (archivo / caso) — a fijar por el implementer |
| --- | --- |
| R1  | `tests/unit/services/wallet-tienda-service.test.ts` — movimiento por tienda = fila inmutable credito/debito |
| R2  | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` — persiste tienda_id/tipo/categoria/monto/origen/fecha |
| R3  | `tests/unit/services/wallet-tienda-service.test.ts` — sin update/delete; corrección = ajuste compensatorio |
| R4  | `tests/unit/utils/saldo-tienda.test.ts` — Decimal exacto, salida STRING 2 decimales |
| R5  | `tests/unit/services/cierres-admin-service.test.ts` — aprobar CierreDia genera movimientos por tienda |
| R6  | `tests/integration/db/wallet-tienda-idempotencia.test.ts` — doble aprobación = un solo set (constraint DB) |
| R7  | `tests/unit/repositories/cierres-admin-repository.test.ts` — fallo al insertar revierte la aprobación (misma tx que 42) |
| R8  | `tests/unit/services/wallet-tienda-feed-service.test.ts` — débitos por concepto = salida de `derivarIngresoOrden` (42), mapeo 1:1 |
| R9  | `tests/unit/services/wallet-tienda-feed-service.test.ts` — credito cod_recaudado = Σ montoRecibido; null → 0.00 |
| R10 | idem — flag=true: devuelta/rechazada genera débitos flete_devolucion+IVA sin credito (saldo negativo); flag=false: NO genera esos 2 débitos en la tienda; reprogramada → nada en ambos |
| R11 | idem — 1 movimiento por (tienda, cierre, concepto); no emite concepto con total 0.00 |
| R12 | `tests/unit/services/cierres-bodega-admin-service.test.ts` — aprobar CierreBodega NO genera movimientos de tienda |
| R13 | `tests/unit/services/cierres-admin-service.test.ts` — vencido→aprobado alimenta una vez |
| R14 | `tests/unit/services/wallet-tienda-feed-service.test.ts` — zona sin tarifa → débitos 0.00, credito COD intacto, sin lanzar |
| R15 | `tests/unit/services/wallet-tienda-feed-service.test.ts` — invariante en AMBOS estados del flag: flag=true → saldo tienda + ingreso 42 = COD (Σ débitos_X tiendas = ingreso_X 42); flag=false → en devuelta/rechazada la diferencia = flete_devolucion+IVA (Σ_tiendas flete_devolucion/iva = 0.00; ingreso 42 intacto) |
| R16 | `tests/unit/utils/saldo-tienda.test.ts` — saldo = Σcredito − Σdebito (Decimal), sin saldo almacenado |
| R17 | idem — saldo negativo/positivo/cero, STRING 2 dec + signo |
| R18 | `tests/integration/mi-wallet-page.test.ts` — adminTienda ve su saldo + desglose por cierre/concepto |
| R19 | `tests/unit/services/wallet-tienda-service.test.ts` + `tests/integration/mi-wallet-page.test.ts` — acotado a tienda_id en WHERE; otra tienda/rol → forbidden |
| R20 | `tests/unit/services/wallet-tienda-service.test.ts` — maestro ve saldos de todas las tiendas |
| R21 | `tests/integration/mi-wallet-page.test.ts` — datos vía Server Component → props STRING, sin Decimal al cliente |
| R22 | `tests/unit/services/wallet-tienda-service.test.ts` — filtros fecha/cierre/concepto aplican en el WHERE |
| R23 | `tests/integration/db/wallet-tienda-pago.test.ts` — (si Q4 aprobado) egreso 42 + débito tienda atómicos e idempotentes; (si no) enum/origen reservados presentes |
| R24 | `tests/integration/db/wallet-tienda-migration.test.ts` — RLS habilitada sin policies anon/authenticated |
| R25 | `tests/integration/db/wallet-tienda-migration.test.ts` — round-trip up/down reversible |
| R26 | `tests/integration/db/wallet-tienda-migration.test.ts` — índices + unique parcial de idempotencia presentes |
| R27 | `tests/unit/*` transversal — asserts de tipo STRING en todos los DTOs de monto/saldo |
| R28 | `tests/unit/services/wallet-tienda-feed-service.test.ts` — default true; con flag=false NO se emiten débitos flete_devolucion/iva_flete_devolucion en la tienda y el resto (crédito COD, otros débitos, cálculo 42) no cambia; flag leído desde un único punto de config |
| R29 | `tests/unit/services/wallet-tienda-service.test.ts` (o feed) — reversión histórica vía movimiento de ajuste compensatorio (ajuste_credito/ajuste_debito), sin UPDATE/DELETE; alternar el flag no requiere migración |

---

## F1.4 — decisiones (deliberación; FIJADAS en el bloque "F1.4 APROBADA 2026-07-12")

Cada pregunta trae RECOMENDACIÓN + alternativa descartada. **Todas quedaron FIJADAS el
2026-07-12** (ver bloque "F1.4 APROBADA"): Q1/Q2/Q4/Q5/Q6 por la recomendación; **Q3 por la
opción 1 con interruptor reversible (default `true`)**. Este bloque se conserva como memoria de
la deliberación.

**Q1 (LA PRINCIPAL, money-critical) — Modelo del saldo por tienda: ¿LEDGER propio por tienda
(`wallet_tienda_movimiento`, alimentado al aprobar el cierre, espejo de la 42) o DERIVADO
on-the-fly (recomputar por tienda desde las gestiones de los cierres aprobados)?**
- **Recomendación: LEDGER propio** `wallet_tienda_movimiento`, alimentado en el MISMO enganche
  (`resolverCierre`, misma `$transaction`) reutilizando `derivarIngresoOrden` (42) para los
  débitos y `montoRecibido` para el crédito COD. Razones: (a) **Consistencia con el snapshot de
  la 42:** la 42 CONGELA los conceptos al aprobar; si las tarifas cambian después (soft-delete +
  nueva tarifa), un derivado on-the-fly recomputaría con la tarifa ACTUAL y DIVERGIRÍA del monto
  congelado por la 42, rompiendo el invariante de cuadre (R15). El ledger congela los mismos
  montos en el mismo instante. (b) **Trazabilidad e idempotencia** por `(origen_tipo, origen_id,
  tienda_id, categoria)`, idéntico patrón a la 42. (c) La 42 agrega por concepto **por cierre**
  (across tiendas), por lo que su `wallet_movimiento` NO tiene dimensión de tienda: derivar
  igualmente exige releer gestiones y re-derivar; el ledger lo hace UNA vez, atómico. (d) 44/45
  seguirán el mismo patrón append-only.
- **Alternativa descartada — DERIVADO on-the-fly** (sin tabla nueva): elegante por evitar
  duplicación y "única fuente de verdad". Se descarta por el **riesgo de divergencia
  money-critical** con el snapshot congelado de la 42 ante cambios de tarifa (rompe R15), y
  porque `wallet_movimiento` (42) no tiene `tienda_id`: no se puede reconstruir el saldo por
  tienda desde los datos congelados de la 42, obligando a recomputar desde gestiones con la
  tarifa vigente actual (no la de la aprobación). Queda como opción si el humano acepta que el
  saldo por tienda "sigue" las tarifas actuales en vez de congelarse.

**Q2 — COD recaudado vs COD teórico: ¿el crédito a favor de la tienda se calcula sobre el COD
REALMENTE recaudado (`gestion_orden.montoRecibido`) o sobre `orden.montoCobrar`?**
- **Recomendación: sobre el COD REALMENTE recaudado (`montoRecibido`).** La tienda recibe su
  parte de lo que EFECTIVAMENTE se cobró. Los DÉBITOS (flete/comisión/IVAs) se toman TAL CUAL de
  la 42 (que hoy calcula la comisión sobre `montoCobrar`), de modo que el invariante R15 cuadra
  contra `montoRecibido`. **Nota a confirmar por el humano:** si `montoRecibido ≠ montoCobrar`,
  el crédito COD usa lo recaudado pero la comisión (débito) sigue basada en `montoCobrar`
  (decisión ya tomada por la 42, que la 43 NO altera). Alternativa: alinear también la comisión a
  `montoRecibido` — se descarta porque MODIFICA la 42 (fuera de alcance) y la 42 ya está aprobada.
- **Alternativa descartada — `montoCobrar` (teórico):** simplifica (un solo número), pero la
  tienda cobraría sobre dinero que quizá no se recaudó (entrega parcial), lo que no refleja el
  saldo real a entregar.

**Q3 — Resultados devuelta/rechazada (saldo NEGATIVO): ¿la tienda queda DEBIENDO el flete de
devolución que Ordenex cobró (42), o esas órdenes no afectan su saldo?**
> **RESUELTA (F1.4, 2026-07-12): OPCIÓN 1 aprobada COMO DEFAULT, con REVERSIBILIDAD.** La tienda
> debe el flete de devolución + su IVA (default), pero la regla es un interruptor de una sola
> fuente de verdad `TIENDA_DEBITA_FLETE_DEVOLUCION` (default `true`); ponerlo en `false` deja de
> generar esas 2 categorías de débito en la tienda (opción 2), sin tocar la 42, y la reversión
> histórica va por ajuste compensatorio append-only. Ver R10, R15 (invariante condicional),
> R28 y R29.
- **Recomendación: la tienda QUEDA DEBIENDO el flete de devolución (saldo negativo por esa
  orden).** Es coherente con la 42: si Ordenex percibe `ingreso_flete_devolucion` +
  `ingreso_iva_flete_devolucion`, la contraparte exacta es que la tienda lo DEBE (crédito COD =
  0, débitos = flete devolución + su IVA → saldo negativo). Mantiene el invariante R15 y refleja
  la regla real (`Tarifa.valorFleteDevuelto` existe justamente para esto). **Marcar para
  confirmación del humano** por ser una regla de negocio con impacto en lo que la tienda percibe.
- **Alternativa descartada — devolución/rechazo no afecta el saldo de la tienda:** rompería el
  cuadre con la 42 (Ordenex cobró un flete cuya contraparte no existiría en ninguna tienda) y
  regalaría el costo de devolución.

**Q4 — Alcance: ¿la 43 SOLO muestra el saldo (visibilidad) o también incluye el PAGO/liquidación
(registrar `egreso_pago_tienda` que reduce el saldo)?**
- **Recomendación: la 43 = MODELO del saldo + VISIBILIDAD (adminTienda ve su saldo; maestro ve
  todos).** El flujo de PAGO efectivo se recomienda como **follow-up** (feature aparte, patrón de
  la 44), para mantener el alcance money-critical acotado. El modelo se diseña de modo que el
  pago SLOTE sin cambio de esquema (categoría `pago_tienda` en el ledger + `egreso_pago_tienda`
  ya reservado en la 42). SI el humano quiere el pago DENTRO de la 43, R23 lo cubre: el maestro
  registra un pago que inserta atómicamente el egreso en la caja 42 y el débito en el ledger de
  la tienda (idempotente por un id de operación).
- **Alternativa descartada — meter todo el flujo de liquidación (aprobaciones, comprobantes,
  conciliación) en la 43:** demasiado alcance para una feature; se prefiere entregar primero la
  visibilidad correcta del saldo y añadir el pago después sobre un modelo ya probado.

**Q5 — Vista y rol: ¿pantalla nueva para el adminTienda (p. ej. `/mi-wallet`) o dentro del
dashboard de la 26? ¿El maestro también ve el saldo de todas las tiendas?**
- **Recomendación: pantalla NUEVA `/mi-wallet` para el `adminTienda`** (Server Component
  role-aware, acotado a su `usuarioId` = `tienda_id`), con saldo a favor + desglose por
  cierre/concepto; el módulo crecerá con el pago (Q4), como pasó con `/wallet`. El `maestro` ve
  el saldo de TODAS las tiendas desde una vista propia (recomendado: sección en `/wallet` o
  `/wallet/tiendas`) para liquidar. Confirmar la ruta exacta y si se integra o no en la 26.
- **Alternativa descartada — embeber el saldo dentro del dashboard adminTienda (26) sin ruta
  propia:** el desglose por cierre/concepto + el futuro pago justifican módulo propio; embeberlo
  lo dejaría estrecho.

**Q6 — Granularidad/consistencia con 42: si es ledger (Q1), ¿un movimiento por tienda por cierre,
o por concepto?**
- **Recomendación: por CONCEPTO, agregado por (tienda, cierre)** — alineado con la 42 (un
  movimiento por concepto agregado por cierre). Categorías de crédito: `cod_recaudado`; de
  débito: `flete`, `flete_devolucion`, `comision_cod`, `iva_flete`, `iva_flete_devolucion`,
  `iva_comision_cod` (espejo 1:1 de los 6 conceptos de la 42) + `pago_tienda` (reservado, Q4). Da
  desglose transparente a la tienda y cuadre por concepto contra la 42 (R15). Omite conceptos con
  total 0.00.
- **Alternativa descartada — un único movimiento NETO por (tienda, cierre):** pierde el desglose
  (la tienda no vería cuánto se le descuenta por flete vs comisión vs IVAs) y rompe el cuadre por
  concepto contra la 42.

---

## Preguntas abiertas (además de F1.4)

- **A1 — Punto de vista del maestro (Q5):** ¿la lista de saldos de todas las tiendas va en
  `/wallet` (junto a la caja principal) o en una ruta nueva `/wallet/tiendas`? Se asume una
  sección/ruta bajo el módulo wallet del maestro salvo indicación.
- **A2 — Moneda única (colones), sin multi-moneda:** se asume igual que el resto del sistema y
  que la 42.
- **A3 — Base de la comisión cuando `montoRecibido ≠ montoCobrar` (ligada a Q2):** se asume que
  la comisión (débito) sigue basada en `montoCobrar` (como la 42), y el crédito COD en
  `montoRecibido`. Confirmar si el negocio requiere alinear ambos (implicaría tocar la 42).
- **A4 — Órdenes de un cierre sin gestión con `montoRecibido`/entrega parcial:** se asume que el
  crédito COD = `montoRecibido` tal cual (0 si null); no se infiere recaudo de otras señales.
- **A5 — Tiendas sin ninguna orden en un cierre:** simplemente no generan movimientos en ese
  cierre (su saldo no cambia). No se crean filas 0.00 (R11).
