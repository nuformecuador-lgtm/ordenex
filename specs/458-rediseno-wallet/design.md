# 458 — Diseño técnico

> Búsqueda hecha con el MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) y
> **cada símbolo confirmado en el archivo real** el 2026-09-24 (el índice estaba rancio:
> p. ej. `RegistrarMovimientoManualDialog` ya no existe, fusionado en
> `RegistrarMovimientoCajaDialog`). Las referencias `archivo:línea` son de esa lectura.

## 0. Principio rector y relación con la 457

**Arreglar lo evidenciado, no rediseñar el dinero.** La 458 cambia lo que la wallet DICE y cómo se
REGISTRA, no cómo se DERIVA el dinero: `derivarCaja`, `derivarSaldoTienda`/`derivarDesgloseTienda`,
la cuenta por pagar del mensajero y los caminos de escritura existentes se reutilizan tal cual
(R47, R77–R83). Lo nuevo en la base son tres tablas LATERALES (anotación, comprobante,
anulación) que se escriben junto a los libros y nunca los modifican.

**457.** El backend del pago recibido de una tienda (servicio, borde, efecto en el libro de la
tienda y en la caja, idempotencia, tope y anulación) lo define y construye la 457
(`specs/457-la-tienda-paga-a-ordenex/`). La 458 solo lo ENCHUFA: una entrada del catálogo (R35),
la acción «Registrar pago recibido» del estado de cuenta (R26), su «Así queda» (R42), su
comprobante (R67) y su anulación en el panel (R58). **Punto de acople que hay que cerrar cuando la
457 tenga design:** a qué fila se adjunta el comprobante del pago recibido (§2.2, columna
`destino`) y qué acción anula ese pago (§4.3).

## 1. Inventario medido (lo que hay hoy, 2026-09-24)

Barrido completo de `app/(app)/wallet/**` y `app/(app)/mi-wallet/**` (61 archivos), más los tipos,
servicios y componentes compartidos que pintan esas pantallas.

### 1.1 Clase 1 — filtro de cierre por identificador escrito a mano

| # | Dónde | Qué pasa |
| --- | --- | --- |
| C1.1 | `wallet/tiendas/_components/DesgloseMovimientosTienda.tsx:377-388` + `desglose-tienda-labels.ts:66-67` | `<Input type="text">` con placeholder **«ID del cierre»** en el desglose de cada tienda (acceso total). |
| C1.2 | `wallet/mensajeros/_components/DesglosePagosMensajero.tsx:318-329` + `wallet-mensajeros-labels.ts:212-216` | `<Input type="text">` con placeholder **«Pegá el identificador»**. |
| C1.3 | `DesglosePagosMensajero.tsx:375-377` + `wallet-mensajeros-labels.ts:215-216` | Texto de ayuda que **pide copiar la dirección** del enlace «Ver el cierre» (que lleva el uuid) y pegarla. Es pedir un identificador (R2). |
| C1.4 | `lib/types/wallet-tienda.ts:173`, `lib/types/wallet-mensajero.ts:157` | El borde acepta `cierreId: z.string().min(1)`: cualquier texto. |
| ok | `mi-wallet/_components/MiWalletFiltros.tsx:107-126` + `mi-wallet-cierres.ts:73-91` | Ya es selector (ficha 335). Sin defecto de clase 1; sí de fecha (§1.7). |

**Medido:** 2 campos vivos, 1 texto de ayuda que pide el uuid, 2 bordes de texto libre; 1
superficie ya corregida.

### 1.2 Clase 2 — origen crudo o sin nombre

`WalletOrigenTipo` tiene 8 valores (`lib/types/wallet.ts:71-90`).

| # | Dónde | Qué pasa |
| --- | --- | --- |
| C2.1 **vivo** | `mi-wallet/_components/mi-wallet-labels.ts:100-109` | `ORIGEN_TIENDA_LABEL` es `Record<string,string>` con **3 de 8** orígenes y `origenLabel` cae al valor crudo. Falta `gestion_orden`, que SÍ se escribe en el libro de la tienda: `RechazoTiendaCobroService.ts:295-301` (con `TIENDA_DEBITA_FLETE_DEVOLUCION` encendido). |
| | consumidores de C2.1 | `mi-wallet/_components/DesgloseTiendaLedger.tsx:29-32` (tabla de la tienda), `mi-wallet-descarga-columnas.ts:30-33` (su descarga), `wallet/tiendas/_components/DesgloseMovimientosTienda.tsx:164-167` (tabla de acceso total), `desglose-tienda-descarga-columnas.ts:46-49` (su descarga). **4 superficies** pintan o descargan `gestion_orden` crudo. |
| C2.2 latente | `wallet/mensajeros/_components/wallet-mensajeros-labels.ts:173-186` | `ORIGEN_PAGO_LABEL` parcial (**4 de 8**) con caída al crudo; consumidores `DesglosePagosMensajero.tsx:146-149` y `desglose-mensajero-descarga-columnas.ts:37-40`. Hoy no hay productor de los 4 que faltan en este libro. |
| C2.3 | `lib/types/wallet-tienda.ts:92`, `lib/types/wallet-mensajero.ts:82` | `origenTipo: string` en los DTO: el compilador no puede exigir etiqueta total. |
| C2.4 sin entidad | `wallet/_components/wallet-labels.ts:201-217` (total), `WalletLedger.tsx:59-62`, `wallet-ledger-descarga-columnas.ts:46-49`, `DetalleFilaComposicion.tsx:105` | La caja nunca pinta crudo, pero sí **genérico**: «Gestión de orden», «Pago a tienda», «Cierre del día» sin decir QUÉ orden, QUÉ tienda, QUÉ cierre. Los cobros por rechazo entran con `descripcion: null` (`RechazoTiendaCobroService.ts:260-266`), así que su fila dice «Gestión de orden» y nada más. |

**Medido:** 1 defecto vivo visible en 4 superficies; 2 mapas parciales con caída al crudo; 2 DTO
sin tipo cerrado; 3 superficies de caja con origen sin entidad ni enlace.

### 1.3 Clase 3 — conceptos sin movimientos en los filtros

| # | Dónde | Qué pasa |
| --- | --- | --- |
| C3.1 | `wallet/_components/wallet-labels.ts:229-235` → `WalletFiltros.tsx:113-122` | `CATEGORIA_OPTIONS` = las **17** categorías del SEED, sin mirar periodo. Incluye `egreso_gasto`, **sin productor** (en `lib/` solo aparece en el SEED, en `caja-tesoreria.ts:72` y en `lib/analytics/metrics.ts`). El comentario `WalletFiltros.tsx:17-19` defiende poblarlo del SEED. |
| C3.2 | `mi-wallet/_components/mi-wallet-labels.ts:112-118` → `MiWalletFiltros.tsx:131-140` y `DesgloseMovimientosTienda.tsx:395-406` | `CATEGORIA_TIENDA_OPTIONS` = las **11** del SEED, en 2 filtros. Incluye `ajuste_debito`, **sin productor** desde la 381 (`schema.prisma:1769`). El comentario `DesgloseMovimientosTienda.tsx:390-393` celebra poblarlo del SEED. |
| n/a | desglose del mensajero, desglose de la bodega | No tienen filtro de concepto (solo cierre+fechas, y un conmutador). |

**Medido:** 2 listas del SEED en 3 filtros; 2 conceptos reservados ofrecidos; 0 filtros que miren
el periodo.

### 1.4 Clase 4 — identificadores internos visibles

| # | Dónde | Qué pasa |
| --- | --- | --- |
| C4.1 **vivo** | `wallet-mensajeros-labels.ts:235-248` (`CIERRE_ENLACE.identificacion`) + `RepartoPrevisualizacion.tsx:111-118` | Cada enlace «Ver el cierre» lleva el **uuid en un `sr-only`**: un lector de pantalla lo lee. Consumidores: `DesglosePagosMensajero.tsx:189`, `PagoMensajeroAcciones.tsx:230`, `RepartoPrevisualizacion.tsx:233` (3 superficies). |
| C4.2 | C1.3 | El texto que pide copiar la URL con el uuid. |
| C4.3 latente | `lib/services/WalletEgresoService.ts:123` | `Reverso de: ${original.descripcion ?? original.id}`: si la descripción faltara, el uuid entraría en el texto del libro (pantalla y descarga). Hoy inalcanzable: los tres escritores de `origen_tipo = gasto` ponen descripción (`WalletEgresoService.ts:68` validada `min(1)`, `GeneracionGastosFijosService.ts:121`, `GastoFijoCobroService.ts:129`). |
| ok | `tests/unit/descarga/columnas-sensibles.guardia.test.ts:375-389` | Guardia existente que prohíbe forma de uuid en toda celda de descarga del árbol. Cubre R3. |
| excluido | `SaldosTiendasTable.tsx:207`, `CuentasPorPagarTable.tsx:291`, `SaldosSatelitesTable.tsx:341`, `DesgloseMovimientosTienda.tsx:321-324` | uuid dentro de atributos `id`/`htmlFor` del DOM: no se muestran ni se anuncian. Fuera de R1 y excluidos explícitamente de la guardia. |
| P1 | `cierres-admin/_components/cierre-enlace.ts:32-34` | uuid en `href` (`?cierre=`). Pregunta abierta P1. |

**Medido:** 1 uuid vivo en nombre accesible × 3 superficies; 1 texto que lo pide; 1 latente; 0 en
descargas.

### 1.5 Deuda que entra (pedida por el leader)

| # | Deuda | Evidencia | Requisito |
| --- | --- | --- | --- |
| D1 | **Dos formas de cobrar a una tienda con efecto distinto en la caja** | Cobro de un costo: solo débito `cobro_manual` en el libro de la tienda (`CobroTiendaService.ts:127`, decisión D1 de la 381). Cobro por rechazo: ingreso propio en la caja **y** débito en la tienda (`RechazoTiendaCobroService.ts:196-206`). | R43, R91 (se hace visible; unificar es decisión aparte) |
| D2 | **El modal mezcla libros** | `wallet-conceptos-manuales.ts:36-42` (5 conceptos, 2 libros) y la cabecera que cambia según el libro (`:205-221`, `RegistrarMovimientoCajaDialog.tsx:329-345`). | R35, R42 |
| D3 | **Anulación desigual** | Pago a tienda: con motivo (`AnularPagoDialog`, en `/wallet/tiendas`). Pago a mensajero: **solo en `/cierres-admin`** (`PagoMensajeroSeccion.tsx`; nada en `app/(app)/wallet/mensajeros`). Egresos administrativos: «Reversar» **sin motivo** (`WalletLedger.tsx:163-195`, `reversarEgresoSchema` en `lib/types/wallet.ts:556`). Ajustes de caja: **sin anulación** (`esEgresoAdministrativo`, `wallet-labels.ts:275-277`, solo admite `origen_tipo = gasto`). Cobro de un costo: **sin anulación** (`wallet-conceptos-manuales.ts:218-219`). Premio: con motivo. | R58–R66 |
| D4 | `ORIGEN_TIENDA_LABEL` sin `gestion_orden` | §1.2 C2.1 | R5, R86 |
| D5 | Categorías reservadas en filtros | §1.3 | R13, R14, R87 |
| D6 | **Desfase de la fila tras pagar (confirmado por lectura)** | `PagoTiendaAcciones.tsx:136-142` invalida solo `claveDesgloseTienda(tiendaId)` —con página 1 y sin filtros (`DesgloseMovimientosTienda.tsx:88-102`)— y la lista de pagos. La clave de la fila, `["wallet-tiendas:saldos", page, pageSize]` (`SaldosTiendasTable.tsx:129-131`), **no se invalida**: el saldo y la insignia de la fila quedan viejos, y como `PagoTiendaAcciones` recibe ESA fila (`resumen.saldo/signo`), el botón «Registrar pago» y el `disponible` del diálogo también. Si el desglose tenía filtros o estaba en otra página, tampoco se relee. Contraste: el mensajero invalida por predicado (`DesglosePagosMensajero.tsx:70-73`) y la bodega invalida también su tabla (`DesgloseConsolidacionesSatelite.tsx:181-188`). | R29 |
| D7 | Nota de importes brutos | `PagoTiendaAcciones.tsx:88-92`, `mi-wallet-labels.ts:68-72`, `wallet-mensajeros-labels.ts:113` | R22 + P3 |
| D8 | Fechas cortadas en UTC | `WalletLedger.tsx:233`, `DesgloseMovimientosTienda.tsx:192`, `DesglosePagosMensajero.tsx:155`, `mi-wallet-cierres.ts:47-53` (lo declara «trampa horaria deliberada»); filtros `z.coerce.date()` en `lib/types/wallet.ts:470-471` y `wallet-tienda.ts:175-176`. La propia `/wallet/satelites` ya lo evita (`satelites-labels.ts:36-52`). | R16 + P11 |
| D9 | **Falta el tipo «pago por cuenta de una tienda» (medido en producción)** | Los 203 `cobro_manual` de Nuform (₡25.769.034,50) son pagos hechos por su cuenta; ninguno salió de la caja. §1.9. | R93–R97, P14–P16 |

### 1.6 Comentarios y textos desactualizados (R92, R90)

| # | Dónde | Afirmación que ya no es cierta |
| --- | --- | --- |
| T1 | `DesgloseMovimientosTienda.tsx:345-350`, `desglose-tienda-labels.ts:35-38`, `lib/types/wallet-tienda.ts:213-218` y `:224` | «Pagado a la tienda hoy sale siempre en 0,00 … lo cierra la 172». La 172 está hecha. |
| T2 | `lib/types/wallet-tienda.ts:223` | `cargos` enumera los débitos sin `cobro_manual`. |
| T3 | `lib/types/wallet-tienda.ts:44`, `db/schema.prisma:1743` y `:1755` | `pago_tienda` «RESERVADO». Tiene productor desde la 172. |
| T4 | `lib/types/wallet-tienda.ts:92`, `lib/types/wallet-mensajero.ts:82`, `db/schema.prisma:1789` | Lista de orígenes del libro sin `gestion_orden`. |
| T5 | `WalletFiltros.tsx:17-19`, `DesgloseMovimientosTienda.tsx:390-393` | Defienden poblar el filtro del SEED (contra R13). |
| T6 | `wallet-mensajeros-labels.ts:200-211` | Justifica el campo del uuid «se pega, no se teclea». |
| T7 | `mi-wallet-cierres.ts:47-49` | Presenta el día UTC como deliberado. |
| T8 **visible** | `wallet/tiendas/_components/desglose-tienda-labels.ts:44` | `cargosHint: "Fletes, comisión e IVA"` en la vista de acceso total, mientras `/mi-wallet` ya dice «… y cobros de Ordenex» (`mi-wallet-labels.ts:50`). Texto de pantalla que miente desde la 381. |

`db/schema.prisma` solo se toca en la hija que ya migra (458-1): tocarlo obliga al gate completo.

### 1.7 Lo que funciona y NO se toca

`derivarCaja` y su clasificación (`lib/utils/caja-tesoreria.ts:62-232`), el desglose y saldo de
la tienda (`lib/utils/desglose-tienda.ts`), la cuenta por pagar del mensajero, los caminos de
escritura de pagos (172/205), su anulación, la cola y aprobación de gastos fijos (333), la cola de
cobros por rechazo (337), premios (293), conciliación de bodegas (431). Todo lo anterior entra en la
fotografía de la fase 0 (§8).

### 1.8 El posible doble conteo en «Dinero en caja» — verificado por lectura, pendiente de medir

**Cómo se forma** (lectura, no medición):

1. Al aprobar un cierre, `CajaCodFeedService.ts:37-74` mete en la caja el contra-entrega
   COMPLETO acreditado a las tiendas (`ingreso_cod_recaudado`, de terceros).
2. En la misma aprobación, el feed de la 42 mete el flete, la comisión y los IVA como ingresos
   PROPIOS. Ese dinero **no entra aparte**: sale de ese mismo contra-entrega (se le debita a la
   tienda en su libro).
3. `derivarCaja` (`caja-tesoreria.ts:202-232`) calcula `enCaja = entradas − salidas` sumando los
   dos.

**Ejemplo:** una orden con contra-entrega de 10.000 y flete de 2.000. Entra físicamente 10.000.
La caja anota 10.000 (terceros) + 2.000 (propio) = 12.000. Se le paga a la tienda lo suyo, 8.000.
Físicamente quedan 2.000; «Dinero en caja» dice 4.000. «Ganancia» dice 2.000 (correcto) y «De
terceros» 2.000, cuando a la tienda ya no se le debe nada. La pantalla lo admite sin decirlo:
`CAJA_RESUMEN_AVISO_TERCEROS` (`wallet-labels.ts:123-126`) explica que «de terceros» «es más»
porque «Ordenex todavía descuenta el flete».

Mismo patrón, en menor escala: el cobro por rechazo aprobado mete ingreso propio sin dinero
físico (D1), y el egreso del mensajero se carga por devengo al aprobar mientras la liquidación no
toca la caja (`LiquidacionService.ts:219-231`, decisión [P2] de la 173), así que «Dinero en caja»
mezcla devengos con efectivo.

**Veredicto:** probable y estructural; **no está medido**. La fase 0 lo mide (§8.3) y el leader lo
lleva al humano como hallazgo de dinero aparte (P10). La 458 no toca la derivación (R78).

**¿Es lo mismo que el hallazgo de §1.9?** No. Este es un INGRESO contado dos veces (el flete vive
dentro del contra-entrega y además se anota aparte) y existe aunque nadie registre nada a mano;
aquel es un EGRESO que falta (pagos por cuenta registrados como cobro, que no escriben en la caja).
Los dos inflan «Dinero en caja», por causas independientes, y se suman (§1.9).

### 1.9 Los 203 «cobros» de Nuform: pagos por cuenta sin salida de caja (medido)

Medición del leader en producción, solo lectura, 2026-09-24 (`progress/medicion_457.md`, commit
`c25eabe8`): Nuform tiene 203 `cobro_manual` por ₡25.769.034,50 (8–23 sep); 200 empiezan por
«pago» («PAGO SALARIO …», «PAGO FACEBOOK», «PAGO TIK TOK», «Pago importación Jet Cargo»), 1 por
«abono» (453.000), 1 por «compra» (400.000) y 1 por «facebook» (11.233,20). Nunca se registró un
pago a tienda en la app (`liquidacion_pago` hacia tiendas = 0). El saldo de Nuform
(−6.170.666,55) es correcto; la caja no refleja la salida porque `cobro_manual` no escribe en ella
(D1 de la 381).

**Cifras de la caja derivadas de la línea base M6** (cálculo sobre las sumas por categoría que
reporta la medición, asumiendo que M6 lista todas las categorías distintas de cero):

| | Importe |
| --- | --- |
| Ingresos de las tiendas (`ingreso_cod_recaudado`) | 29.059.224,00 |
| Ingresos propios (flete 4.372.000 + comisión 1.017.074,04 + flete por rechazo 1.753.200 + IVA flete 568.360 + IVA comisión 132.223,43 + IVA flete por rechazo 227.916) | 8.070.773,47 |
| Egresos propios (sueldo 8.871.709 + pago a mensajero 3.439.700 + gasto variable 165.000 + indemnización 1,00) | 12.476.410,00 |
| **Dinero en caja** (entradas − salidas) | **24.653.587,47** |
| **Ganancia** | **−4.405.636,53** |
| **De las tiendas** | **29.059.224,00** |
| Dinero en caja con los 203 pagos como salida (P15 A/B) | −1.115.447,03 |
| … y descontando además el doble conteo de §1.8 (cota: todo el ingreso propio del feed) | −9.186.220,50 |

Un saldo físico negativo es imposible: o parte de esos pagos salió de otra cuenta, o hay entradas
que la app no ve. Eso es lo que el humano tiene que contestar antes de P15. Reconstruyendo el
efectivo por el otro lado —lo que entró (el contra-entrega) menos lo que salió (lo que retuvo el
mensajero, sueldos, gasto variable, indemnización y los 203 pagos)— sale la misma cifra:
29.059.224,00 − 3.439.700 − 8.871.709 − 165.000 − 1,00 − 25.769.034,50 = −9.186.220,50.

**Lo que la 458 hace con esto:** crea el tipo que faltaba (R93–R97, §4.1) para que no se repita;
NO toca las 203 filas (R83). Qué se hace con ellas es P15.

## 2. Modelo de datos

Tres migraciones, cada una con `migration.sql` y `down.sql`:

1. `<ts>_pago_por_cuenta_tienda` (hija 458-1b) — los dos valores de enum nuevos de §2.6 y sus
   CHECK. Va SOLA porque `ALTER TYPE … ADD VALUE` no puede usarse en la misma transacción que lo
   añade, y porque su `down.sql` es el delicado (ver §2.6).
2. `<ts>_wallet_anotacion_idempotencia` (hija 458-1b) — §2.1 y §2.7: el pago por cuenta necesita
   el beneficiario y la idempotencia desde el primer día.
3. `<ts>_wallet_comprobante_anulacion` (hija 458-1) — §2.2 y §2.3.

Ninguna toca columnas ni filas de los libros (R83).

### 2.1 `wallet_anotacion` — a quién y con qué referencia (caja)

La necesitan los movimientos de CAJA registrados a mano (sueldo, gasto variable, ajustes, pago por
cuenta de una tienda): el resto de los «a quién» se deriva de datos que ya existen (§3.4). No lleva
«tipo de contraparte»: el concepto ya dice si es una persona (sueldo), un proveedor (gasto
variable) o el beneficiario de un pago por cuenta, y H2 pide solo el nombre.

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | uuid PK | |
| `movimiento_id` | uuid NOT NULL **UNIQUE**, FK `wallet_movimiento(id)` RESTRICT | 1:1 |
| `contraparte_nombre` | text NULL | CHECK `contraparte_nombre IS NULL OR length(trim(contraparte_nombre)) > 0` |
| `referencia` | text NULL | |
| `created_at` | timestamptz default now() | Sin `updated_at`/`deleted_at`: inmutable |

Se escribe **en la misma transacción** que el movimiento (el repositorio ya abre una:
`crearMovimientoRegistrado`).

### 2.2 `wallet_comprobante` — el archivo (H1, H3)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | uuid PK | |
| `caja_movimiento_id` | uuid NULL UNIQUE FK `wallet_movimiento` | destino |
| `tienda_movimiento_id` | uuid NULL UNIQUE FK `wallet_tienda_movimiento` | destino |
| `mensajero_movimiento_id` | uuid NULL UNIQUE FK `pago_mensajero_movimiento` | destino (premio) |
| `liquidacion_pago_id` | uuid NULL UNIQUE FK `liquidacion_pago` | destino (pagos a tienda / mensajero) |
| `storage_path` | text NOT NULL | path en bucket PRIVADO, nunca URL |
| `content_type` | text NOT NULL | CHECK en la lista de P7 |
| `tamano_bytes` | int NOT NULL | CHECK > 0 |
| `subido_por` | uuid NOT NULL FK `usuario` | |
| `created_at` | timestamptz | inmutable |

CHECK `num_nonnulls(caja_movimiento_id, tienda_movimiento_id, mensajero_movimiento_id,
liquidacion_pago_id) = 1` (precedente: el XOR de `liquidacion_pago`). El UNIQUE de cada destino
ES R72: un segundo comprobante choca contra la base. El destino del pago recibido de la 457 se
añade aquí como quinta columna o reusa `tienda_movimiento_id`, según lo que defina la 457 (§0).

### 2.3 `wallet_anulacion` — motivo y contra-asiento de lo que no tiene documento propio

Los pagos (172) y los premios (293) ya tienen su anulación documentada y **no se duplican** aquí.
Esta tabla cubre sueldo, gasto variable, gasto fijo cobrado, ajustes y cobro de un costo.

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | uuid PK | |
| `caja_movimiento_id` / `tienda_movimiento_id` | uuid NULL, **UNIQUE** cada una, FK | el ANULADO; CHECK `num_nonnulls = 1` |
| `contra_caja_movimiento_id` / `contra_tienda_movimiento_id` | uuid NULL UNIQUE FK | el contra-asiento; CHECK mismo libro que el anulado |
| `motivo` | text NOT NULL | CHECK `length(trim(motivo)) > 0` |
| `anulado_por` | uuid NOT NULL FK `usuario` | |
| `created_at` | timestamptz | inmutable; no se anula una anulación |

**Idempotencia y carrera (R61, R62):** dentro de UNA transacción se inserta primero la fila de
anulación con `ON CONFLICT DO NOTHING` (vía `createMany({ skipDuplicates })`, cuyo `count` es la
respuesta —NO se interpreta un P2002, que bajo Prisma 7 llega sin `meta.target`; ver la nota de
`liquidacion_pago` en `schema.prisma:1913-1923`—). `count = 0` ⇒ `ya_anulado`, sin escribir el
contra-asiento. El contra-asiento además es idempotente por el índice único parcial del libro,
porque lleva `origen_id` = id del original (§4.3).

### 2.4 RLS, índices, `down.sql`

- Las tres tablas: RLS habilitada **sin policies** (solo service role), patrón de los libros.
- Índices: los UNIQUE ya indexan cada FK de destino; `wallet_anotacion(contraparte_nombre)` con
  `lower()` para el filtro «A quién» por nombre libre (R55).
- `down.sql` de las tablas: `DROP TABLE` de las cuatro (§2.1–§2.3, §2.7). No toca ningún otro
  objeto. Se prueba con `pnpm run db:rollback` en local (`tests/integration/db/...-migration.test.ts`
  con el molde de `wallet-tienda-cobro-migration.test.ts`).

### 2.5 Almacenamiento

Bucket privado `wallet-comprobantes` (P8), resuelto por `WALLET_COMPROBANTE_BUCKET` en
`lib/config/wallet-comprobante.ts` junto con `TIPOS_ADMITIDOS`, `TAMANO_MAXIMO_BYTES` y
`URL_FIRMADA_TTL_SEGUNDOS` (nada literal en el código). Se añade a `lib/storage/buckets.ts`. Los
buckets del repo **no se crean por migración** (no hay `storage.buckets` en `db/migrations`): se
crean a mano en local, preview y producción ANTES de desplegar la hija que los usa; es un paso de
release (`docs/release.md`). Subida con `SupabaseFileStorage.upload`, lectura con
`SupabaseSignedUrlProvider.createSignedUrl` (precedente: evidencias de incidente, 158).

Ruta del objeto: `<año>/<mes>/<uuid aleatorio>.<ext>` — el nombre no contiene ningún id de
negocio, y la ruta nunca sale al cliente (R73).

### 2.6 Pago por cuenta de una tienda: dos conceptos nuevos (R93–R97)

| Libro | Valor nuevo | Tipo (CHECK) | Naturaleza / cubeta |
| --- | --- | --- | --- |
| caja (`wallet_movimiento_categoria`) | `egreso_pago_por_cuenta_tienda` | egreso | **terceros** en `NATURALEZA_POR_CATEGORIA` (no toca la ganancia) |
| tienda (`wallet_tienda_movimiento_categoria`) | `pago_por_cuenta` | débito | cubeta «pagado» de `derivarDesgloseTienda` (es dinero entregado a la tienda, a través de un tercero), NO «cargos»; la pista de «Pagado a la tienda» / «Ya pagado» pasa a decir «incluye lo pagado por su cuenta» |

- Los dos CHECK `tipo ↔ categoria` (M4 de la medición) se recrean con el valor nuevo en su rama.
- Los `Record` TOTALES (`NATURALEZA_POR_CATEGORIA`, `CATEGORIA_LABEL`, `CATEGORIA_TIENDA_LABEL`,
  `CUBETA_POR_CATEGORIA` en `lib/utils/desglose-tienda.ts:34`, `FUENTE_TIENDA` en
  `lib/utils/aporte-por-orden.ts:94`) dejan de compilar hasta que el valor se clasifica: es la red que ya
  existe y se usa a propósito. `caja-composicion-exhaustiva.guardia` y `metrics-caja-naturaleza
  .guardia` siguen verdes solo si la naturaleza es `terceros`. Se revisan las listas de categorías
  de `lib/analytics/metrics.ts` (`:640`, `:692`, `:726`, `:758`).
- **Por qué dos valores nuevos y no reusar `egreso_pago_tienda`/`pago_tienda`:** se reusaría la
  etiqueta «Pago a la tienda» para un pago a Facebook, y distinguirlos por la descripción es
  exactamente lo que la D2 de la 381 prohibió. Además `pago_tienda` nace de un documento de
  `liquidacion_pago` con tope en el saldo a favor, y el pago por cuenta no lo tiene (P14).
- **Enlace entre las dos filas:** se escriben en UNA transacción; la de la tienda con
  `origen_tipo = manual`, `origen_id = NULL`, y la de la caja con `origen_tipo = manual`,
  `origen_id = <id de la fila de la tienda>` (cae dentro del índice único parcial de la caja:
  idempotencia del par). La anotación (beneficiario, referencia) cuelga de la fila de caja; la
  tienda la lee por ese enlace (R95).
- **`down.sql` de los enums:** Postgres no quita un valor de un enum; el `down.sql` recrea el tipo
  con su lista. Antes de escribirlo se mira cómo lo hacen los `down.sql` previos de ESOS dos enums
  (381 para el de la tienda, 173 para el de la caja) y se escribe la lista COMPLETA vigente menos el
  valor nuevo, fallando con un mensaje claro si hay filas con él (lección «el `down.sql` borra los
  valores posteriores»: no se tocan los `down.sql` anteriores). Se corre `tests/integration/db`.

### 2.7 `wallet_registro_idempotencia` — un registro, una vez (R48)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `clave` | uuid PK | la genera el diálogo al abrirse (patrón de la 172) |
| `registrado_por` | uuid NOT NULL FK `usuario` | |
| `created_at` | timestamptz | |

Primera sentencia de la transacción de todo registro del catálogo que no tenga ya su propia clave
(los pagos de la 172 la tienen): `createMany({ skipDuplicates })`; `count = 0` ⇒ «ya registrado»
sin escribir nada. RLS sin policies.

## 3. Lecturas (servicio + repositorio, todo en el servidor)

### 3.1 Fechas en Costa Rica (R16)

Una sola pieza, `lib/utils/fecha-cr.ts` (ya existe: `fechaCalendarioCR`,
`ultimosNDiasCalendarioCR`): se añade `rangoDelPeriodoCR(desde, hasta)` → `[inicio del día CR en
UTC, inicio del día siguiente a «hasta» en UTC)`. Los schemas nuevos del periodo aceptan
`YYYY-MM-DD` y lo convierten con ella; el pintado de fechas usa el formateador de
`satelites-labels.ts:48-59` promovido a `lib/utils/` (sin `slice(0,10)` de un ISO UTC).

### 3.2 Estado de cuenta y saldo corrido (R17–R24)

`EstadoCuentaService.leer(input, actor)` con `input = { cuenta: {tipo: tienda|mensajero|bodega,
id}, desde, hasta, chip, page, pageSize }`.

- **Saldo inicial** = saldo de la cuenta con `fecha_movimiento < inicio del periodo` (un
  agregado). Reusa la misma derivación de saldo que hoy (`derivarSaldoTienda` para tienda; la de
  la cuenta por pagar para mensajero; `saldoSinConciliar` para bodega).
- **Saldo corrido** en el REPOSITORIO con una ventana:
  `SUM(CASE tipo WHEN <abono> THEN monto ELSE -monto END) OVER (ORDER BY fecha_movimiento,
  created_at, id)` sobre TODO el libro de la cuenta hasta `hasta`, y el filtro de chip y de
  periodo se aplican FUERA de la ventana (R21: el corrido es de la cuenta completa). El orden
  `(fecha_movimiento, created_at, id)` es R23. `$queryRaw` tipado, `numeric` → STRING escala 2
  (money-safe, R84). Índices existentes: `(tienda_id, fecha_movimiento)`,
  `(mensajero_id, fecha_movimiento)`.
- **Bodega:** el «libro» se arma con una UNION sobre `cierre_bodega`: cargo = declarado al
  consolidar (`solicitado_at`), abono = recibido al conciliar (`conciliado_at`).
- **Totales del periodo** (P3): abonos y cargos excluyendo los pares anulados; se comprueba R22
  en el servicio y un test lo afirma sobre la base.
- **Chip** (R24): `CHIP_POR_MOVIMIENTO` = `Record` TOTAL por libro sobre `(categoria, origen)`:
  Cierres = lo que nace de `cierre_dia`; Pagos = `pago_tienda`/`pago_mensajero`/pago recibido y sus
  reversos; Cobros = `cobro_manual` y lo que nace de `gestion_orden`; Ajustes = `ajuste_*`,
  `premio_ranking` y contra-asientos de `wallet_anulacion`. Un contra-asiento va al chip de su
  original. Totalidad comprobada por guardia.

### 3.3 Origen legible (R5–R9)

`OrigenLegibleService.resolver(filas, actor)` → para cada fila un `OrigenLegibleDTO { texto,
enlace: { etiqueta, href } | null }`. Lee en LOTE: agrupa los `origen_id` por tipo y hace **una
consulta por tipo presente en la página** (≤ 8, nunca una por fila):

| Origen | Texto | Enlace (si el rol accede) |
| --- | --- | --- |
| `cierre_dia` | «Cierre del 12 sep de Juan Pérez» | detalle del cierre |
| `gestion_orden` | «Cobro por rechazo · guía ABC123» | la orden por su guía |
| `pago_tienda` / `pago_mensajero` | «Pago del 12 sep · Transferencia» | estado de cuenta del beneficiario |
| `gasto` | «Gasto fijo: Alquiler — sep 2026» / «Sueldo» / «Gasto variable» | plantillas (gasto fijo) |
| `orden_incidente` | «Incidente · guía ABC123» | la orden |
| `ranking_snapshot_fila` | «Premio del podio del 12 sep» | ranking histórico de ese día |
| `manual` | el concepto del registro | — |

Los tres mapas de etiquetas pasan a `Record<WalletOrigenTipo, …>` TOTALES y los DTO a
`origenTipo: WalletOrigenTipo` (cierra C2.3): un origen nuevo **no compila** hasta tener nombre
(R9). La caída `?? origenTipo` desaparece de las cuatro descargas y dos tablas.

El `href` a la orden usa el filtro por URL de `/ordenes` (ficha 339) con la guía como término; se
confirma el nombre del parámetro al implementar (339/A1).

### 3.4 «A quién» y «Registró» en la caja (R52, R53)

| Origen del movimiento de caja | A quién |
| --- | --- |
| `cierre_dia` | el mensajero del cierre (P13) |
| `pago_tienda` | la tienda del pago (`liquidacion_pago.tienda_id`) |
| `gestion_orden` | la tienda del cobro (`rechazo_tienda_cobro.tienda_id` por `gestion_id`) |
| `ranking_snapshot_fila` | el mensajero del podio |
| `orden_incidente` | la tienda de la orden |
| `gasto` / `manual` | `wallet_anotacion.contraparte_nombre`; filas previas a la 458 sin anotación: «—» |

Registró: `registrado_por` → nombre del usuario; `NULL` → «Automático» + acción: «Aprobación del
cierre por <cierre_dia.resuelto_por>», «Plantilla de gasto fijo», etc. Misma lectura en lote.

### 3.5 Conceptos con movimientos y cierres del selector (R10–R15)

- `conceptosConMovimientos({libro, cuenta?, periodo, otrosFiltros})` → `groupBy(categoria)` con
  `_count`, **sin** el filtro de concepto (si no, el filtro solo se ofrecería a sí mismo). Si el
  concepto elegido no viene, el cliente lo conserva con 0 (R15).
- `cierresDeLaCuenta({cuenta, busqueda?})` → cierres con al menos un movimiento en esa cuenta
  (para tienda, generaliza la lectura de la 335 añadiendo el nombre del mensajero; para mensajero,
  sus cierres). Tope por configuración (`hayMas`, precedente 335).
- El borde del filtro pasa a `cierreId: z.string().uuid()` y el `WHERE` se compone SIEMPRE con la
  cuenta: un cierre ajeno devuelve cero filas (R12). Se prueba contra la base (lección «probar el
  WHERE donde vive»).

### 3.6 «Cómo quedó» (R54)

Para el movimiento abierto: caja y ganancia acumuladas hasta él (mismo agregado que el resumen,
con `fecha_movimiento, created_at, id ≤` el del movimiento, pasado por `derivarCaja`) y saldo de la
cuenta afectada tras él (la ventana de §3.2). Sin derivaciones nuevas.

## 4. Escrituras

### 4.1 Catálogo del registro único → camino EXISTENTE (R35, R47)

| Tipo (grupo) | Action que ya existe | Campos que pide | Libros | Caja | Ganancia |
| --- | --- | --- | --- | --- | --- |
| Pago recibido de una tienda (Entra) | **457** | tienda, monto ≤ lo que debe, fecha, motivo, método/referencia, comprobante | 457 | según 457 (sube, de terceros) | no cambia |
| Ajuste que suma (Entra) | `registrarMovimientoManualAction` | monto, fecha, motivo, a quién (opcional), comprobante | caja `ingreso_ajuste` | sube | sube |
| Pago a una tienda (Sale) | `registrarPagoTiendaAction` | tienda, monto ≤ saldo a favor, fecha, método, referencia, nota, comprobante | doc + tienda `pago_tienda` + caja `egreso_pago_tienda` | baja | no cambia |
| **Pago por cuenta de una tienda (Sale)** — NUEVO | `registrarPagoPorCuentaTiendaAction` (nueva; servicio `PagoPorCuentaTiendaService`, espejo de `CobroTiendaService`) | tienda, **beneficiario (nombre libre)**, monto (sin tope, P14), fecha, motivo, referencia, comprobante | tienda `pago_por_cuenta` + caja `egreso_pago_por_cuenta_tienda` (terceros), una transacción | **baja** | no cambia |
| Pago a un mensajero (Sale) | `registrarRepartoMensajeroAction` (205) | mensajero, monto, fecha, método, referencia, comprobante | doc(s) + libro del mensajero | **no cambia** ([P2] de la 173) | no cambia |
| Sueldo (Sale) | `registrarEgresoAdministrativoAction` | **a quién (nombre libre)**, monto, fecha, motivo/periodo, comprobante | caja `egreso_sueldo` | baja | baja |
| Gasto variable (Sale) | ídem | **proveedor (nombre libre)**, monto, fecha, motivo, comprobante | caja `egreso_gasto_variable` | baja | baja |
| Ajuste que resta (Sale) | `registrarMovimientoManualAction` | monto, fecha, motivo, a quién (opcional), comprobante | caja `egreso_ajuste` | baja | baja |
| Cobrar un costo (Cargo sin mover la caja) | `registrarCobroTiendaAction` | tienda, monto, fecha, motivo, comprobante | tienda `cobro_manual` | **no cambia** | no cambia |

Las columnas «Caja» y «Ganancia» son EXACTAMENTE lo que «Así queda» enseña, y salen del mismo
`EFECTO_POR_TIPO` que usa el servidor (§4.4).

**Qué cambia en cada borde, y nada más:** los schemas de sueldo/gasto variable/ajuste ganan
`contraparteNombre` y `referencia` opcionales (en el borde; la obligatoriedad de P5 se aplica en el
schema de sueldo y gasto variable); todos ganan un comprobante opcional. Los `.strict()` existentes
se conservan. La 334 decidió no unificar el backend porque `origen_tipo` decide qué se revierte:
se respeta.

**Comprobante en el registro (R67–R69):** la Server Action recibe `FormData`; (1) valida tipo y
tamaño en el servidor; (2) sube el archivo; (3) ejecuta la transacción del registro, que inserta
también `wallet_comprobante`; (4) si la transacción falla, borra el objeto. Si el borrado fallara,
el objeto queda sin fila que lo referencie en un bucket privado: inalcanzable (R69). Adjuntar
después (P6): `adjuntarComprobanteAction({destino, archivo})`, que choca contra el UNIQUE si ya hay
uno.

### 4.2 Guardas del registro

Roles de acceso total en cada action (R75), como hoy. Idempotencia (R48): los pagos de la 172
conservan su `clave_idempotencia`; el resto de tipos (sueldo, gasto variable, ajustes, cobro de un
costo, pago por cuenta) ganan una `clave` opcional en su borde y la tabla de §2.7. Sin clave el
comportamiento es el de hoy (compatibilidad de los bordes existentes); el diálogo nuevo la manda
siempre. Un pago por cuenta de ₡1.000.000 registrado dos veces por un doble clic es exactamente el
tipo de error que la medición de §1.9 muestra que ocurre a este volumen.

**Distinción cobro / pago por cuenta en el diálogo (R94):** los dos tipos viven en grupos
distintos del catálogo («Cargo sin mover la caja» frente a «Sale dinero»), cada uno con su frase
fija («Sale dinero de la caja: lo pagás a un tercero en nombre de la tienda» / «No sale dinero:
es un cargo de Ordenex a la tienda»), y su «Así queda» difiere en la línea de caja.

### 4.3 Anulación uniforme (R58–R66): contra-asientos

`anularMovimientoAction({ destino, motivo })` enruta por la clase del destino:

| Original | Libro | Contra-asiento | `origen_tipo` / `origen_id` del contra | Documento |
| --- | --- | --- | --- | --- |
| `egreso_sueldo`, `egreso_gasto_variable`, `egreso_gasto_fijo` (`origen gasto`) | caja | `ingreso_ajuste` — **igual que el reverso actual** | `gasto` / id original | `wallet_anulacion` (nuevo: motivo) |
| `ingreso_ajuste` (`origen manual`) | caja | `egreso_ajuste` | `manual` / id original | `wallet_anulacion` |
| `egreso_ajuste` (`origen manual`) | caja | `ingreso_ajuste` | `manual` / id original | `wallet_anulacion` |
| `cobro_manual` | tienda | `ajuste_credito` | `manual` / id original | `wallet_anulacion` |
| pago por cuenta (`pago_por_cuenta` + `egreso_pago_por_cuenta_tienda`) | tienda + caja | tienda `ajuste_credito`; caja `ingreso_reverso_pago_tienda` (terceros: vuelve a la caja como dinero de las tiendas y no sube la ganancia, R96) | `manual` / id de la fila original de cada libro | `wallet_anulacion` (una fila por libro, en la misma transacción) |
| pago a tienda | doc + tienda + caja | camino actual 172/173 (`ajuste_credito` + `ingreso_reverso_pago_tienda`) | `pago_tienda` | `liquidacion_anulacion` (sin cambio) |
| pago a mensajero | doc + mensajero | camino actual 172 | `pago_mensajero` | `liquidacion_anulacion` (sin cambio) |
| pago recibido de tienda | 457 | 457 | 457 | 457 |
| premio del ranking | mensajero + caja | camino actual 293 | — | el de la 293 (sin cambio) |

- El gasto egreso administrativo se sigue anulando por `WalletEgresoService.reversarEgreso`; la
  única diferencia es que ahora escribe `wallet_anulacion` con el motivo en la misma transacción,
  y la descripción del reverso deja de poder caer al uuid (C4.3 → R4).
- El cobro de un costo pasa a ser anulable (derogación explícita de la C1 de la 381, que era
  consecuencia de no tener abono manual; aquí es un contra-asiento documentado, no un abono).
- **R66, los reversos anteriores:** un movimiento de caja con `origen gasto` que tiene su
  `ingreso_ajuste` con `origen_id` = su id y SIN fila en `wallet_anulacion` se pinta anulado con
  «motivo no registrado». Lectura, sin backfill (R83).
- **R60:** no se ofrece anular filas de `cierre_dia`, contra-asientos (`origen_id` que apunta a
  otro movimiento del mismo libro) ni reversos de pago.
- **R63:** el efecto inverso por libro se afirma con la tabla de la fase 0: tras anular, todas las
  cifras de §8.1 vuelven exactamente a su valor previo.

### 4.4 «Así queda» (R42–R44)

`previsualizarMovimientoAction({ tipo, cuentaId?, monto })` (lectura, acceso total):

1. Lee el agregado actual de la caja (mismo que `verResumenCaja` sin filtros) y, si aplica, el
   saldo de la cuenta.
2. `EFECTO_POR_TIPO` (`Record` TOTAL sobre el tipo, **la misma tabla que el enrutado**) dice qué
   filas hipotéticas `(libro, tipo, categoria)` produce el registro.
3. `efectoDeMovimiento(actual, filasHipoteticas)` — función PURA en
   `lib/utils/efecto-movimiento.ts` — llama a `derivarCaja` sobre `actual` y sobre `actual +
   hipotéticas`, y a la derivación de saldo de la cuenta. **No reimplementa ninguna resta**
   (la guardia `caja-derivaciones.guardia.test.ts` exige que la resta viva en `derivarBalance`).
4. Devuelve STRING antes/después y, por línea, `cambia: boolean` para que el diálogo diga «La caja
   no cambia» (R43). Para pago a tienda, además `superaDisponible` con el tope (lo decide el
   servidor, no el navegador).

El diálogo pide la previsualización con un retardo corto tras dejar de teclear y NO la pide sin
monto válido ni cuenta (R42).

## 5. Rutas y pantallas

| Ruta | Server Component | Qué cambia |
| --- | --- | --- |
| `/wallet` | valida acceso total (sin cambio de guardia) | libro de caja nuevo (§5.2) |
| `/wallet/tiendas` | ídem | la fila deja de desplegar el desglose y enlaza al estado de cuenta |
| `/wallet/tiendas/[tienda]` | **nueva**; `notFound` si la tienda no existe o el rol no accede | estado de cuenta |
| `/wallet/mensajeros` | ídem | pestañas (cuentas y premios) se conservan; la fila enlaza |
| `/wallet/mensajeros/[mensajero]` | **nueva** | estado de cuenta |
| `/wallet/satelites` y `/wallet/satelites/[bodega]` | la segunda **nueva** | estado de cuenta + conciliación (R30) |
| `/mi-wallet` | `adminTienda`, tienda de la sesión (sin cambio de guardia ni de `ROLES_MI_WALLET`) | estado de cuenta en solo lectura |

Los segmentos dinámicos llevan el uuid (P1). Todo dato sensible se pre-obtiene en el Server
Component y baja por props (patrón actual); los refrescos van por Server Action + SWR.

### 5.1 Componentes y sistema de diseño

Se respeta `DESIGN.md` y `app/globals.css`: `AppPage` como único shell; cards hermanas; tokens
semánticos (abono en `text-success-strong`, cargo en `text-danger-strong`, jamás `emerald-*` ni
hex); `Badge` en variantes semánticas; `DataTable` con esqueleto, `EmptyState` que enseña el
siguiente paso y estado de error; `FormField` como único patrón de campo; `Modal` (con `size`) para
el registro; `Sheet` (`components/ui/sheet.tsx`) para el panel lateral; foco
`focus-visible:ring-3 focus-visible:ring-ring` OPACO en toda pieza nueva; `tabular-nums` y montos a
la derecha; anulado = `line-through` + texto `muted` sobre la fila (vía `rowClassName` del
`DataTable`) y el motivo en texto, no solo en color.

Piezas nuevas, promovidas a `components/shared/` porque las usan ≥ 2 fichas hijas:

- `estado-cuenta/` — `TarjetasEstadoCuenta`, `TablaEstadoCuenta`, `ChipsEstadoCuenta`.
- `wallet/RegistrarMovimientoDialog` (catálogo a la izquierda, formulario a la derecha,
  «Así queda» debajo; en móvil el catálogo pasa arriba como lista).
- `wallet/DetalleMovimientoPanel` + `wallet/AnularMovimientoDialog` (molde `AnularPagoDialog`:
  motivo obligatorio, `closeOnConfirm={false}`).
- `SelectorBuscable` (popover + input sobre `components/ui/popover.tsx`) para cierre, cuenta y «A
  quién». No hay combobox en el repo; esta es la primitiva, con estados vacío/cargando/error.

Textos fuera del JSX en módulos `*-labels.ts` (convención), vocabulario llano sin siglas ni
«SLA», «terceros» solo en código (en pantalla, «de las tiendas» / «de Ordenex», como la 231).

### 5.2 Libro de caja

Tarjetas: la `CajaResumenCard` actual (mismas cifras, R49) con la pista de «De terceros». Filtros:
`SegmentedToggle` Todo/Entra/Sale, `SelectorBuscable` «A quién», `Select` de concepto con cuenta,
periodo. Columnas: Fecha · Movimiento y motivo · A quién · Monto (dirección + dueño) · Registró ·
Ver. La aserción de orden de columnas de `tests/components/descarga/WalletDescarga.test.tsx` (ver
`WalletLedger.tsx:203-223`) se reescribe EN EL MISMO COMMIT que cambia las columnas, afirmando la
lista nueva como contrato (el literal ES el contrato aquí).

## 6. Contratos I/O (bordes nuevos)

Todos con zod `.strict()`, montos STRING, fechas `YYYY-MM-DD` de Costa Rica.

```ts
// Lectura del estado de cuenta
estadoCuentaSchema = { cuenta: { tipo: "tienda"|"mensajero"|"bodega", id: uuid },
  desde?: FechaCR, hasta?: FechaCR, chip?: "todo"|"cierres"|"pagos"|"cobros"|"ajustes",
  page, pageSize /* tope en config */ }
EstadoCuentaDTO = { saldoActual: string, signo, saldoInicial: string, abonos: string,
  cargos: string, saldoFinal: string, filas: FilaEstadoCuentaDTO[], total: number, page, pageSize }
FilaEstadoCuentaDTO = { ref: DestinoMovimiento /* viaja, nunca se pinta */, fecha: FechaCR,
  movimiento: string, motivo: string|null, referencia: string|null, origen: OrigenLegibleDTO,
  registro: RegistroDTO, cargo: string|null, abono: string|null, saldoCorrido: string,
  chip, anulacion: { motivo: string|null, por: string, fecha: FechaCR }|null,
  esContraAsiento: boolean, tieneComprobante: boolean, anulable: boolean }

// Registro
registrarMovimientoSchema = discriminatedUnion("tipo", [...]) // una rama por tipo de §4.1,
  // cada una con SOLO sus campos (R37) + comprobante?: File
previsualizarMovimientoSchema = { tipo, cuentaId?: uuid, monto: montoPositivoSchema }
EfectoMovimientoDTO = { lineas: { cuenta?: Linea, caja: Linea, ganancia: Linea },
  superaDisponible?: boolean }  // Linea = { antes: string, despues: string, cambia: boolean }

// Anulación y comprobante
anularMovimientoSchema = { destino: DestinoMovimiento, motivo: string.trim().min(1) }
adjuntarComprobanteSchema = { destino: DestinoMovimiento } + File
verComprobanteSchema = { destino: DestinoMovimiento } -> { url firmada temporal, rotulo }
DestinoMovimiento = { libro: "caja"|"tienda"|"mensajero", movimientoId: uuid }
                  | { pagoId: uuid }

// Filtros
conceptosConMovimientosSchema, cierresDeLaCuentaSchema, filtro de libro de caja +
  aQuien?: { tipo: "tienda"|"mensajero", id: uuid } | { nombre: string }
```

Resultados con la forma de estado del repo (`ok` | `validation_error` | `forbidden` |
`unauthenticated` | `not_found` | `ya_anulado` | …). Ninguna rama de error viaja con filas.

## 7. Guardias (R85–R89)

Todas descubren sus archivos **por carpeta** (`app/(app)/wallet/**`, `app/(app)/mi-wallet/**`,
`components/shared/{estado-cuenta,wallet}/**`), no por lista, y llevan **control de no-vacuidad**
y **contraprueba** (R89):

| Guardia | Qué caza | Contraprueba |
| --- | --- | --- |
| `wallet-sin-campo-id.guardia` (R85) | `<Input>` de texto cuyo valor/estado se llama `*Id`, o placeholder/ayuda que case `/\bID\b|identificador|pegá|copiá su dirección/i` | una fuente sintética con el campo de C1.1 |
| `wallet-origen-total.guardia` (R86) | mapas de origen que no sean `Record<WalletOrigenTipo, …>`, o `?? <x>.origenTipo` | fuente con el `origenLabel` de hoy |
| `wallet-conceptos-sin-seed.guardia` (R87) | `*_CATEGORIA_SEED.map(` alimentando `options` de un filtro | fuente con `CATEGORIA_OPTIONS` de hoy |
| `wallet-sin-uuid.guardia` (R88) | **render** de cada superficie con fixtures cuyos ids son uuid: busca forma de uuid en `textContent`, `aria-label`, `aria-describedby` resuelto, `placeholder`, `value` y `title` (excluye `id`/`htmlFor`/`href`) | render del `EnlaceCierre` de hoy (C4.1) |
| `wallet-textos-458.guardia` (R90, R92) | las afirmaciones de §1.6 | la fuente de hoy |

Se reutiliza `columnas-sensibles.guardia.test.ts` para las descargas nuevas (R3). La guardia de
render es la que mide lo que el usuario VE; las de fuente, las que impiden reintroducir la causa.

## 8. Fase 0 — caracterización antes de tocar nada (R77–R83)

### 8.1 Fotografía

`tests/integration/db/wallet-caracterizacion-458.test.ts` siembra en la base de test un escenario
que ejerce TODO lo que funciona: un cierre aprobado con contra-entrega, flete, comisión, IVA y pago
al mensajero; un rechazo con cobro aprobado; pago a tienda y su anulación; reparto a mensajero y
anulación de uno de sus pagos; cobro de un costo; sueldo y su reverso; gasto variable; ajustes;
cobro de gasto fijo aprobado; premio y su anulación; una consolidación de bodega parcial. Afirma
como LITERALES (son el contrato, no polizones): `CajaResumenDTO`, `ComposicionGananciaDTO`,
`DesgloseEgresosDTO`, saldo y desglose de cada tienda, cuenta por pagar de cada mensajero,
pendiente de la bodega. Cada hija corre esta fotografía antes y después: **debe dar lo mismo**.

### 8.2 Mutaciones, con autocomprobación

Al menos 10 mutaciones en código de producción (p. ej. invertir la naturaleza de
`ingreso_cod_recaudado` en `NATURALEZA_POR_CATEGORIA`; sacar `cobro_manual` de su cubeta; cambiar
`min(P,E)`; omitir el `ingreso_reverso_pago_tienda`; quitar un término del `WHERE` del saldo de
tienda; invertir el signo del saldo corrido). Por cada una: aplicar, correr SOLO la fotografía,
exigir rojo con el nombre del caso que cae, revertir, comprobar verde. El informe
(`progress/impl_458-0.md`) trae por mutación el comando, la salida con el caso rojo y el `git
diff --stat` limpio al final: sin eso la mutación no cuenta (lección «arnés que miente»). El gate
y las mutaciones NO corren en paralelo.

### 8.3 Medición del doble conteo (§1.8)

La fotografía fija el comportamiento ACTUAL (`enCaja` incluye el flete) como caso con nombre
propio. Además, el leader corre en producción, por el MCP de Supabase y en solo lectura, la suma
por cierre aprobado de `ingreso_cod_recaudado` frente a la de los ingresos propios que ese mismo
cierre descontó a las tiendas, y escribe el número en `progress/hallazgo_458_doble_conteo.md`
para el humano (P10). Producción se vació el 2026-08-25: un cero significa «aún no pasó», no «no
existe».

## 9. Partición en fichas hijas (propuesta)

Cada hija es entregable y verificable sola, con su propio spec breve derivado de este (los R que
cubre), su gate y su recorrido. Orden y paralelismo:

```
458-0 ──► 458-1b (pago por cuenta, P16) ──► 458-1 ──┬──► 458-3 ──┬──► 458-4
      └─► 458-2 ─────────────────────────────────────┘            └──► 458-5
                                       (457 ──► 458-3, 458-4)
```

| Hija | Zona | Qué entrega | R | Depende de | Gate |
| --- | --- | --- | --- | --- | --- |
| **458-0 Caracterización** | backend | Fotografía, informe de mutaciones, medición del doble conteo. Cero código de producción. | R77–R83 (línea base) | — | rápido |
| **458-1b Pago por cuenta de una tienda** (urgente, P16) | fullstack | Migraciones 1 y 2 de §2 (enums de §2.6, `wallet_anotacion`, `wallet_registro_idempotencia`), `PagoPorCuentaTiendaService` + action, y un SEXTO concepto en el diálogo ACTUAL (`wallet-conceptos-manuales.ts`) con su frase y el rótulo de R95 en `/mi-wallet`. Sin «Así queda» (llega con 458-3) y sin anulación (llega con 458-1, R96; hasta entonces, como el cobro de hoy, no se deshace). Deja de crecer la diferencia de §1.9. | R93, R95, R48 (este tipo) | 458-0 | **completo** (migración) |
| **458-1 Cimientos** | backend | Migración 3 de §2, bucket y config, servicios y actions de anotación (bordes de sueldo, gasto variable y ajustes), comprobante y anulación uniforme (incluida la del pago por cuenta); lecturas de §3 (fechas CR, saldo corrido, origen legible, a quién/registró, conceptos con movimientos, cierres por cuenta); «Así queda» en el servidor; comentarios de §1.6 que viven en `schema.prisma` y `lib/types`. | R4, R9, R12, R16 (servidor), R42–R44 (servidor), R47, R48, R58–R66 (servidor), R67–R73 (servidor), R74–R76, R83, R84, R96 | 458-0, 458-1b | **completo** (migración) |
| **458-2 Detalles y guardias** — lo pedido con «muchísima atención», sobre las pantallas ACTUALES | fullstack | Selector de cierre en tiendas y mensajeros; origen legible en las 6 superficies; filtros de concepto con cuenta en los 3 filtros; fuera el uuid del `sr-only` y la ayuda; «Cargos» con cobros; refresco de la fila tras pagar (D6); las 5 guardias. | R1–R3, R5–R8, R10, R11, R13–R15, R29 (pantalla actual), R85–R90, R92 | 458-0; las lecturas de 458-1 (si 458-1 no ha llegado, 458-2 las trae y 458-1 las reusa: se decide al abrirlas) | rápido |
| **458-3 Registro y detalle** | fullstack | `RegistrarMovimientoDialog` (catálogo, campos por tipo, «Así queda», comprobante, preselección) en `/wallet`; `DetalleMovimientoPanel` y `AnularMovimientoDialog` compartidos. La entrada «Pago recibido» se enchufa al final, cuando la 457 esté en `dev`. | R35–R48, R54 (panel), R58–R59, R61, R67–R69, R72–R73, R94, R97 | 458-1, 458-1b, 457 | rápido |
| **458-4 Estados de cuenta** | fullstack | Rutas nuevas de tienda, mensajero y bodega; `/mi-wallet` rehecha; chips, periodo, saldo corrido, anulados, acciones, descarga, comprobante visible para la tienda. | R16–R34, R65, R66, R70, R71, R91 | 458-3, 457 | rápido |
| **458-5 Libro de caja** | fullstack | `/wallet` con tarjetas, filtros, A quién, Registró, panel; colas y plantillas intactas. | R49–R57 | 458-3 | rápido |

458-4 y 458-5 no comparten archivos (las piezas comunes nacen en 458-3), así que pueden ir a la
vez. **Límite de zona:** 457, 458-1b y 458-2 son `fullstack`; como mucho dos a la vez. Orden
propuesto: 457 ∥ 458-1b primero (las dos tocan dinero de Nuform y la segunda frena la diferencia
de la caja), luego 458-2. 457 y 458-1b tocan ambas `wallet-conceptos-manuales.ts` y el diálogo
actual: se secuencian en ESOS archivos (la segunda en llegar rebasa sobre la primera) o 457 deja su
entrada del diálogo para 458-3, que es lo que ya dice su ficha.

Las R94 y R97 (distinción visible y aviso de saldo en contra) se completan en 458-3, con «Así
queda».

## 10. Recorrido por rol (guion; se ejecuta al cerrar cada hija y completo al cerrar 458-5)

Sin arnés E2E en el repo (el checkpoint E2E de pagos se declara inaplicable y se cubre con los
tests de integración de §7–§8 más este recorrido). Se hace con Playwright ad hoc sobre el dev
server local sembrado, capturas a `progress/recorrido_458-<hija>/`, y una tabla **maqueta vs app**
por pantalla con NÚMEROS (importes, filas, conteos), no con impresiones.

**Maestro**
1. `/wallet`: las tres tarjetas valen lo mismo que la fotografía de §8.1 sobre los mismos datos.
   El filtro de concepto solo trae conceptos del periodo, con su cuenta; «Gasto» (`egreso_gasto`)
   no aparece.
2. «Registrar un movimiento»: tres grupos + enlace a plantillas. Sueldo: pide a quién, monto,
   fecha, motivo, comprobante opcional; «Así queda» muestra caja y ganancia bajando lo mismo y
   «ninguna cuenta cambia». Registrar con un PDF.
3. La fila nueva: A quién = el nombre escrito; Registró = el maestro. «Ver» → panel con comprobante
   (se abre), «Cómo quedó». «Anular…» con motivo → original tachado + contra-asiento; tarjetas de
   vuelta a su valor.
4. `/wallet/tiendas` → la tienda con saldo en contra → estado de cuenta: frase «<Tienda> le debe
   ₡… a Ordenex»; «Registrar pago recibido» visible; «Pagar a la tienda» deshabilitado con motivo.
   Saldo inicial arriba; saldo corrido de la última fila = tarjeta = fila del listado.
5. «Cobrar un costo»: «Así queda» dice «La caja no cambia». Tras registrar, volver al listado: la
   fila ya muestra el saldo nuevo, sin recargar.
5b. «Pago por cuenta de una tienda» a «Facebook» por 10.000: el diálogo lo presenta en «Sale
   dinero» con su frase; «Así queda»: caja −10.000, ganancia sin cambio, saldo de la tienda
   −10.000 (y el aviso de R97 si queda en contra). Tras registrar: la caja baja 10.000 y «De las
   tiendas» también; en `/mi-wallet` de esa tienda se lee «Pago que Ordenex hizo por tu cuenta a
   Facebook», nunca «Cobro de Ordenex». Anularlo devuelve las tres cifras.
6. Filtro de cierre: buscar por el nombre de un mensajero y por un día; ningún control pide un ID.
7. Descargar el estado de cuenta; abrir el archivo: sin uuid, origen legible, saldo corrido.
8. `/wallet/mensajeros/<m>`: pagar (reparto) y anular un pago desde la wallet; comprobar que
   `/cierres-admin` sigue anulando igual.
9. `/wallet/satelites/<b>`: marcar recibido; el pendiente y la tabla de arriba cambian.
10. Árbol de accesibilidad (inspector de Playwright) de «Ver el cierre»: sin uuid.

**Admin:** los pasos 1–10 con el mismo resultado, salvo la cola de gastos fijos: la ve y NO la
decide (R76). Puede registrar y anular (P12).

**adminTienda:** `/mi-wallet` muestra su estado de cuenta desde su lado («Pago que hiciste a
Ordenex» con referencia y motivo, «Cobro de Ordenex»); abre el comprobante que subió Ordenex; no
hay botones de registrar/anular/adjuntar; `/wallet` y `/wallet/tiendas/<otra>` → no encontrado;
el comprobante de otra tienda (pidiendo su destino a mano) → rechazado.

**Mensajero (rol sin acceso):** `/wallet` → no encontrado.

## 11. Alternativas descartadas

- **A1 — Unificar el backend en un documento «registro» único** (una tabla y un servicio para todos
  los tipos). Descartada: es rediseñar el dinero para arreglar lo que la pantalla dice; la 334 ya
  documentó que `origen_tipo` decide qué se revierte y que fusionar caminos cambia el dinero en
  silencio; y el repo tiene dos specs descartados por proponer modelo nuevo en vez del arreglo
  mínimo.
- **A2 — Columnas nuevas en los tres libros** (contraparte, referencia, comprobante, anulado_por).
  Descartada: `anulado_*` volvería mutable una fila inmutable (la alternativa H de la 172, ya
  descartada), y el resto triplica migración, repositorios y tests de tres tablas append-only para
  lo que una tabla lateral resuelve.
- **A3 — Guardar «a quién» y la referencia dentro de `descripcion`.** Descartada: texto libre no se
  filtra, no se enlaza ni se descarga en columna (el mismo argumento de la D2 de la 381).
- **A4 — Saldo corrido y «Así queda» calculados en el navegador.** Descartada: prohibido por
  money-safe (R84) y por las guardias existentes.
- **A5 — Saldo corrido del subconjunto filtrado por chip.** Descartada: no cuadraría con la tarjeta
  ni con el listado (R21/R22) y enseñaría un «saldo» que no es de nadie.
- **A6 — Una FK polimórfica `(libro, movimiento_id)` en comprobante y anulación.** Descartada: sin
  integridad referencial y sin precedente; el repo usa FKs nullables + CHECK XOR
  (`liquidacion_pago`).
- **A7 — Guardias con lista fija de archivos.** Descartada: una pantalla nueva escaparía; se
  descubren por carpeta con control de no-vacuidad.
- **A9 — Registrar el pago por cuenta como `cobro_manual` + un egreso de caja aparte, sin conceptos
  nuevos.** Descartada: la tienda seguiría leyendo «Cobro de Ordenex» en un pago hecho por su
  cuenta (contra R95), y el egreso quedaría como `egreso_ajuste` (propio), que bajaría la ganancia
  por dinero que no es de Ordenex. Es, literalmente, la confusión que produjo §1.9.
- **A8 — Clave legible por cuenta en la URL** (alternativa de P1). Pospuesta a la respuesta del
  humano: toca `usuario` (cimientos) por una dirección que no es contenido.

## 12. Riesgos

- **Dinero:** mitigado por la fotografía y las mutaciones (§8) corridas antes y después de cada
  hija; por no tocar derivaciones; por reutilizar los caminos de escritura.
- **Base local compartida entre worktrees:** la migración de 458-1 pone rojo el gate de otras
  sesiones hasta que migren (`prisma migrate deploy` tras mergear).
- **Bucket no creado en un entorno:** el registro con comprobante fallaría con «no se pudo
  guardar» y NO registraría el movimiento (R69); aun así es paso obligatorio de release.
- **Tests ajenos que fijan columnas del libro** (`WalletDescarga.test.tsx`): se reescriben en el
  mismo commit, afirmando la lista nueva; borrar un componente borra su test: cada test retirado se
  lista en el informe de la hija con el requisito que lo sustituye.

## ACOPLES CON LA 459 (obligatorio, añadido por el leader el 2026-09-25)

La 459 («la caja muestra el dinero real») ya está en `dev` y cambia piezas que esta ficha supone. Antes de
implementar, lee **`specs/459-la-caja-muestra-el-dinero-real/design.md` §14**, que lista uno por uno los
acoples de esta ficha, y aplícalos. Lo esencial:
- La caja se deriva con la fórmula de la 459 (cargos a tiendas fuera de «Entró»; tres dueños: propio, terceros
  y capital; invariantes R7/R8). Toda cifra, dorado o «Así queda» se calcula sobre ella.
- Los catálogos crecieron (caja 21 categorías; historial +4 tipos y +2 entidades): las mediciones M3/M4 y los
  `down.sql` que se escribieron antes de la 459 están RANCIOS; se re-miden. El `down` de enums lee `pg_enum`.
- El comprobante (config, `BUCKETS`, utilidades y el bucket `wallet-comprobantes`) ya existe: se reutiliza.
- «Pago por cuenta de una tienda» y «Saldo inicial / aporte» ya existen, con documento y anulación propios.
