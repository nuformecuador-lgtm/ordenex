# 458 — Diseño técnico (reescrito el 2026-09-25 sobre la 459, la 461, la 462 y la 457)

> **Búsqueda.** MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`, índice `ready`
> pero rancio para la 459 y la 461) solo para orientar; **cada símbolo se confirmó en el archivo
> real** del árbol de trabajo (`feature/461-recorrido` = `dev` con la 459 y la 462 dentro, más un
> commit de docs de la 461). Las referencias `archivo:línea` son de esa lectura.
> **Límite:** el código de la 461 (`origin/feature/461-final`) no está en el árbol de trabajo y esta
> sesión no tiene herramienta de shell para leer otra rama. Lo que la 461 construye se toma de su
> spec aprobado y de `progress/contraste_461.md`; §0.2 lista lo que cada hija confirma al abrirse.

## 0. Principio rector y punto de partida

### 0.1 Arreglar lo evidenciado, no rediseñar el dinero

La 458 cambia lo que la wallet **dice** y cómo se **registra** y se **anula**; no cambia cómo se
**deriva** el dinero. `derivarCaja` (con la fórmula de la 461: cargos fuera de «Entró», tres dueños,
reversos de cargos), `derivarDesgloseTienda`, la cuenta por pagar del mensajero (`SUM devengo − SUM
pago`) y `saldoDe` de la bodega se reutilizan tal cual. Lo único que entra en la base son tablas
LATERALES (anotación, anulación, comprobante) y los valores de catálogo imprescindibles para anular
el cobro por rechazo. Ninguna fila existente se modifica ni se borra.

### 0.2 Lo que otras fichas dejaron y esta ficha USA (y lo que hay que confirmar en `461-final`)

| Pieza | Ficha | Estado en el árbol de trabajo | Qué confirma la hija al abrirse |
| --- | --- | --- | --- |
| `derivarCaja` con `LIQUIDEZ_POR_CATEGORIA`, `NATURALEZA_POR_CATEGORIA`, cuatro `derivarBalance` | 459 (+461 `reversosDeCargos`) | `lib/utils/caja-tesoreria.ts:62-294` (459). El acumulador `reversosDeCargos` es de la 461 | que `acumular` tiene la cubeta `reversosDeCargos` y `terceros = derivarBalance(ingT + rev, egT + cargos)` |
| `CONTRAPARTIDA_EN_CAJA`, `TIPO_POR_CATEGORIA_TIENDA`, `SIN_CONTRAPARTIDA` | 459 (+461) | `lib/utils/invariante-tiendas.ts:28-75` (hoy `cobro_manual: SIN_CONTRAPARTIDA`) | que la 461 dejó `cobro_manual: "ingreso_cobro_tienda"` y `cobro_tienda_anulado` |
| Documento con anulación propia: `pago_por_cuenta_tienda(_anulacion)`, `aporte_capital(_anulacion)` | 459 | `db/schema.prisma:2052-2123` | — |
| `cobro_tienda_anulacion`, `anularCobroTiendaAction`, `CajaCobroTiendaFeedService`, origen `cobro_tienda(_completado)`, `ingreso_cobro_tienda`, `egreso_reverso_cobro_tienda`, `cobro_tienda_anulado` | 461 | **NO está** (`CobroTiendaService.ts` de `dev` sin `anular`) | nombres reales de tabla, action y categorías; y **cómo anula la 461 la corrección de caja** (D13 de requirements) |
| `documento` por fila del libro (`DocumentoCajaDTO {tipo, anulado, tieneComprobante}`, `LectoresDocumentosCaja`, `tipoDeDocumentoOriginal`) | 459 (+461 `cobros`) | `lib/services/WalletService.ts:55-132`; `lib/types/wallet.ts:257-264` | que `DocumentoCajaDTO.tipo` ya incluye `"cobro_tienda"` |
| Comprobante: `lib/config/wallet-comprobante.ts`, `lib/utils/comprobante.ts` (`problemaDeComprobante`, `PREFIJO_COMPROBANTE`, `rutaDeComprobante`), `BUCKETS.WALLET_COMPROBANTES`, `DocumentoCajaAcciones` (ver comprobante por URL firmada) | 459 | presentes (`buckets.ts:22`; `comprobante.ts:34-75`) | que la 457 añadió `abonos-tienda` a `PREFIJO_COMPROBANTE` |
| Clave de idempotencia generada al abrir el diálogo (`crypto.randomUUID()`) y `FormData` por concepto | 459 | `RegistrarMovimientoCajaDialog.tsx:197-199, 360-384` | que la 461 añadió clave al cobro, la corrección, el sueldo y el gasto (D2) |
| Los siete conceptos, tres grupos, `FRASE_DEL_EFECTO`, dos diccionarios del libro de la tienda (`CATEGORIA_TIENDA_LABEL` desde Ordenex, `CATEGORIA_MI_WALLET_LABEL` desde la tienda), nombres retirados y reservados, guardia `nombres-wallet-461` | 461 | **NO está** (hoy `wallet-conceptos-manuales.ts:126-209` con los nombres viejos; `desglose-tienda-labels.ts:20-27` reexporta el diccionario de `/mi-wallet`) | los textos finales de §7 de la 461 y el nombre de la guardia |
| Filtros de periodo en día CR (T1) y fecha de caja de los pagos (T2) | 461 | **NO está** (`lib/types/wallet.ts:520-521`, `wallet-tienda.ts:179-180`, `wallet-mensajero.ts:159-160` siguen con `z.coerce.date()`) | qué pieza usó la 461 en el borde (se espera `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, `lib/utils/fecha-cr.ts:118-131`) para reutilizarla en los schemas nuevos |
| Refresco de la fila de saldos tras pagar/anular (P1) y «Reversar» oculto sobre reversado (P3, a medias) | 461 | **NO está** (`PagoTiendaAcciones.tsx:136-142` invalida solo dos claves; `WalletLedger.tsx:290-300`) | cómo decidió la 461 «ya reversado» (si mira la página, R71 lo sustituye; si mira el servidor, R71 lo generaliza) |
| Estado de la caja («flujo»/«saldo»), `rotuloCifraPrincipal`, `pistaCifraPrincipal` | 459 | `wallet-labels.ts:103-202` | — |
| `hrefDetalleCierre`, `RUTA_CIERRES_ADMIN` (uuid solo en el `href`) | 205/462 | `app/(app)/cierres-admin/_components/cierre-enlace.ts:21-32`; la 462 lo importa para su franja (design 462 §… `:439-441`) | — |
| Selector de cierres de `/mi-wallet` (`opcionesDeCierre`, `CierresDeLaTienda {opciones, hayMas, disponible}`) | 335/459 | `mi-wallet-cierres.ts:24-90`; repositorio `listarCierresDeTienda` (`WalletTiendaMovimientoRepository.ts:199-212`) | — |
| `AnularPagoDialog` (motivo obligatorio, `closeOnConfirm={false}`), `SegmentedToggle`, `Sheet`, `Popover`, `DataTable` (`renderExpanded`, `rowClassName`, `descarga`) | varias | `components/shared/liquidacion/AnularPagoDialog.tsx:65-137`; `components/shared/SegmentedToggle.tsx`; `components/ui/sheet.tsx`, `popover.tsx`; `DataTable.tsx:178-200` | — |
| Pago de la tienda a Ordenex: `abono_tienda(_anulacion)`, `ingreso_abono_tienda`, `egreso_reverso_abono_tienda`, `abono_tienda(_anulado)`, `AbonoTiendaService`, `registrarAbonoTiendaAction(formData)`, `anularAbonoTiendaAction`, `listarAbonosDeTiendaAction`, `listarMisAbonosAction`, `obtenerComprobanteAbonoAction` | 457 (spec; **otro agente lo está actualizando en paralelo**) | no existe aún | nombres finales de tabla, actions y textos reservados (461 §7.8) |

## 1. Inventario medido HOY (árbol de trabajo, 2026-09-25)

### 1.1 Lo pedido con «muchísima atención», estado real

| # | Dónde | Qué pasa | Estado |
| --- | --- | --- | --- |
| C1.1 | `wallet/tiendas/_components/DesgloseMovimientosTienda.tsx:379-386` + `desglose-tienda-labels.ts:66-68` | `<Input>` con placeholder **«ID del cierre»** | **vivo** (ni la 459 ni el spec de la 461 lo tocan) |
| C1.2 | `wallet/mensajeros/_components/DesglosePagosMensajero.tsx:320-329, 376-378` + `wallet-mensajeros-labels.ts:214-216` | `<Input>` «Pegá el identificador» y ayuda que pide copiar la dirección del enlace | **vivo** (P2 de la auditoría) |
| C1.3 | `lib/types/wallet-tienda.ts:177`, `wallet-mensajero.ts:157` | `cierreId: z.string().min(1)` (cualquier texto) | vivo |
| ok | `mi-wallet/_components/MiWalletFiltros.tsx:107-126` | Selector (335) rotulado con día CR | hecho |
| C2.1 | `mi-wallet-labels.ts:117-128` `ORIGEN_TIENDA_LABEL: Record<string,string>` + `origenLabel` con caída al crudo; `wallet-mensajeros-labels.ts:173-186` ídem | mapas parciales; la 461 les añade claves pero no los cierra por tipo | vivo (R5, R9) |
| C2.2 | `WalletLedger.tsx:61-64` (`ORIGEN_LABEL[origen] · descripcion`) | origen sin ENTIDAD ni enlace: «Cierre del día», «Gestión de orden» | vivo (R6–R8); la 461 renombra los rótulos (§7.3) sin añadir entidad |
| C3.1 | `wallet-labels.ts:389-395` `CATEGORIA_OPTIONS` del SEED → `WalletFiltros.tsx`; `mi-wallet-labels.ts:131-137` `CATEGORIA_TIENDA_OPTIONS` del SEED → `MiWalletFiltros.tsx:131-136` y `DesgloseMovimientosTienda.tsx:398-404` | tres filtros poblados del catálogo completo, con `egreso_gasto` y `ajuste_debito` | vivo (R13–R15) |
| C4.1 | `wallet-mensajeros-labels.ts:235-248` `CIERRE_ENLACE.identificacion` (` (${cierreId})` en `sr-only`) | uuid en el nombre accesible del enlace «Ver el cierre» | vivo (R1) |
| C4.2 | `lib/services/WalletEgresoService.ts:123` `Reverso de: ${original.descripcion ?? original.id}` | uuid latente en el texto del libro | vivo (R4) |

### 1.2 Anulación: qué camino tiene qué (tras 459 y 461)

| Camino | Documento / anulación | «Anular…» en pantalla | Queda para la 458 |
| --- | --- | --- | --- |
| Pago de Ordenex a una tienda (172) | `liquidacion_anulacion` | `/wallet/tiendas` (`PagoTiendaAcciones`) | mover al panel «Ver» y al estado de cuenta |
| Pago de Ordenex a un mensajero (172/205) | `liquidacion_anulacion` | **solo `/cierres-admin`** (`PagoMensajeroSeccion.tsx:117-121`); `wallet/mensajeros/PagoMensajeroAcciones.tsx` solo registra | **P6**: ofrecerla en el estado de cuenta con `anularPagoAction` / `anularRepartoAction` (`lib/actions/liquidacion.ts:222,245`) |
| Pago de un gasto de una tienda, aporte (459) | tablas propias | `DocumentoCajaAcciones` en `/wallet` | mover al panel; nada nuevo |
| Cobro de Ordenex a una tienda (461) | `cobro_tienda_anulacion` | `DocumentoCajaAcciones` (rama `cobro_tienda`) | mover al panel; ofrecerla también en el estado de cuenta de la tienda |
| Corrección de caja (461, «D3 parcial») | molde de la 461 (a confirmar) | según la 461 | mover al panel |
| Sueldo, gasto de Ordenex, gasto fijo cobrado | **sin motivo**: `reversarEgreso` (`WalletEgresoService.ts:88-130`) escribe `ingreso_ajuste` con origen `gasto`/id | «Reversar» (`WalletLedger.tsx:290-300`) sin estado «reversado» si el reverso no está en la página | **R63, R71, R72**: motivo + constancia + estado derivado |
| Indemnización por incidente | **nada** (`WalletIndemnizacionIncidenteFeedService.ts:25-54`: `egreso_indemnizacion`, origen `orden_incidente`) | nada | **R63** |
| Cobro por rechazo aprobado (337) | **nada** (`RechazoTiendaCobroService.ts:174-313`: caja `ingreso_flete_devolucion` + `ingreso_iva_flete_devolucion` con origen `gestion_orden`/gestión; tienda débitos espejo si `TIENDA_DEBITA_FLETE_DEVOLUCION`) | nada | **R63, R68, R73** (35 en producción por ₡95.824) |
| Premio del ranking (293) | anulación propia con motivo | `/wallet/mensajeros` (pestaña premios) | mover al panel |
| Pago de la tienda a Ordenex (457) | `abono_tienda_anulacion` | lo que la 457 deje | enchufar en el panel y en el estado de cuenta |

### 1.3 Otras medidas de hoy

- Orden sin desempate: `WalletTiendaMovimientoRepository.listarPorTienda` (`:109`) y
  `PagoMensajeroMovimientoRepository.listarPorMensajero` (`:198`) ordenan solo por
  `fechaMovimiento desc`; la caja sí desempata (`WalletMovimientoRepository.ts:194`). → R23.
- Claves SWR: `["wallet-tiendas:saldos", page, pageSize]` (`SaldosTiendasTable.tsx:129-131`),
  `claveDesgloseTienda`, `clavePagosDeTienda` (`PagoTiendaAcciones.tsx:56`), predicado
  `CLAVE_DESGLOSE`/`"wallet-satelites:saldos"` (`DesgloseConsolidacionesSatelite.tsx:180-188`).
- Bodega: pendiente = `saldoDe(totalEfectivo, montoRecibido)` por consolidación
  (`CierreBodegaRepository.ts:19-22, 134-136`; `lib/utils/conciliacion-satelite.ts`); marcas en
  `cierre_bodega.conciliado_at / conciliado_por / monto_recibido` (`schema.prisma:1476-1479`).
- `/analitica`: `cargar-kpis.ts:141-158` ya usa `rotuloCifraPrincipal` sin filtros; el panel MENSUAL
  (serie por mes del tablero financiero) rotula con la etiqueta del catálogo (`metrics.ts`
  «Dinero en caja», m3 de `progress/review_459.md:121`). → R62.
- `app/(app)/wallet/page.tsx:110`: `description="Caja principal de Ordenex: libro de movimientos,
  dinero en caja y ganancia de Ordenex"` (R16 de la 459 en el subtítulo). → R101.
- Nombre de la tienda: `etiquetaDePersona` en avisos/historial («Tania Tienda») frente a `nombre`
  en tablas («Tania») (P5). → R33.
- `listarMovimientosTiendaSchema` no es `.strict()` (m1; `wallet-tienda.ts:172-181`). → R36.
- `WalletService.listarMovimientos` ya resuelve `documento` EN LOTE por tipo presente
  (`WalletService.ts:97-132`): es el molde de R71.

### 1.4 Comentarios y textos desactualizados que quedan (R101)

| # | Dónde | Afirmación |
| --- | --- | --- |
| T1 | `desglose-tienda-labels.ts:35-38` | «Pagado a la tienda hoy sale siempre en 0,00 … lo emitirá la 172» |
| T2 | `lib/types/wallet-tienda.ts` (comentario de `cargos`) | enumera los débitos sin `cobro_manual` |
| T3 | `schema.prisma:1759, 1771` | `pago_tienda` «RESERVADO» |
| T4 | `schema.prisma:1809, 1877` | orígenes del libro «cierre_dia \| pago_tienda \| manual» |
| T5 | `WalletFiltros.tsx` (cabecera) y `DesgloseMovimientosTienda.tsx:390-393` | defienden poblar el filtro del SEED |
| T6 | `wallet-mensajeros-labels.ts:200-211` | justifica pegar el uuid |
| T9 | `wallet/page.tsx:110` | «dinero en caja» en el subtítulo |

(T7 y T8 los cerraron la 459 y la 461; se comprueba al abrir 458-A.)

## 2. Modelo de datos

Migraciones **a mano** (`db:migrate:create` falla con P3006), con `down.sql`, timestamps
**posteriores** al último de `origin/dev` cuando se escriban (hoy el último conocido de la 461 es
`20260926120200_cobro_tienda_461_completar_caja`; la 457 traerá los suyos): se propone
`2026092812xxxx_wallet_458_*`. Se reparten en dos porque Postgres prohíbe usar un valor de enum en
la transacción que lo añade (55P04). Ninguna toca filas (R89). Solo la hija **458-B** migra.

### 2.1 Migración 1 — valores de enum

| Enum | Valor nuevo | Para |
| --- | --- | --- |
| `wallet_movimiento_categoria` | `egreso_reverso_flete_devolucion`, `egreso_reverso_iva_flete_devolucion` | reversos de cargo del cobro por rechazo (D7) |
| `wallet_tienda_movimiento_categoria` | `flete_devolucion_anulado`, `iva_flete_devolucion_anulado` (crédito) | créditos espejo |
| `historial_accion_tipo` | `cobro_rechazo_tienda_anulado`, `egreso_caja_anulado` (si la 461 no dejó un tipo generalizable para la anulación de un movimiento de caja) | R64 |

`ALTER TYPE … ADD VALUE IF NOT EXISTS`. **`down.sql`:** la función dinámica de la 459
(`20260925120000_caja_459_enums/down.sql`, `quitar_valores_de_enum_459`) copiada y renombrada
`_458`, que lee `pg_enum`, falla con RAISE si una fila usa un valor, y recrea los CHECK e índices
que nombran el tipo por texto. Ningún `down.sql` previo se toca.

### 2.2 Migración 2 — tablas laterales y CHECK

**`wallet_anotacion`** — «a quién» y referencia de los movimientos de caja registrados a mano que no
tienen documento propio (sueldo, gasto de Ordenex, corrección de caja). El pago de un gasto y el
aporte ya llevan lo suyo en su documento (459).

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | text PK (uuid) | |
| `movimiento_id` | text NOT NULL **UNIQUE** FK `wallet_movimiento(id)` RESTRICT | 1:1 |
| `contraparte_nombre` | text NULL | CHECK `contraparte_nombre IS NULL OR btrim(contraparte_nombre) <> ''`; tope 120 en el borde (como `beneficiario`) |
| `referencia` | text NULL | tope `LIQUIDACION_REFERENCIA_MAX` en el borde |
| `created_at` | timestamp(3) default now() | inmutable |

Índice `lower(contraparte_nombre)` para el filtro «A quién» por nombre libre (R59).

**`wallet_movimiento_anulacion`** — SOLO si la 461 no dejó un molde reutilizable (D13). Constancia
de la anulación de un movimiento de caja sin documento propio: sueldo, gasto de Ordenex, gasto fijo
cobrado, indemnización (y la corrección de caja si la 461 la dejó sin tabla).

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | text PK | |
| `movimiento_id` | text NOT NULL **UNIQUE** FK `wallet_movimiento(id)` RESTRICT | el anulado; UNIQUE = R66/R67 |
| `contra_movimiento_id` | text NOT NULL UNIQUE FK `wallet_movimiento(id)` RESTRICT | el contra-asiento |
| `motivo` | text NOT NULL | CHECK `btrim(motivo) <> ''` |
| `anulado_por` | text NOT NULL FK `usuario(id)` RESTRICT | |
| `created_at` | timestamp(3) default now() | |

**`rechazo_tienda_cobro_anulacion`** (molde: `cobro_tienda_anulacion` de la 461 /
`pago_por_cuenta_tienda_anulacion`): `id` · `cobro_id` UNIQUE FK `rechazo_tienda_cobro(id)`
RESTRICT · `motivo` (CHECK no vacío) · `anulado_por` FK · `created_at`. «Anulado» se deriva de que
exista la fila; `rechazo_tienda_cobro.estado` sigue `aprobado` (R73; la tabla tiene `updated_at`
pero esta ficha no la actualiza).

**`wallet_comprobante`** (D12) — el archivo de los caminos sin documento propio:

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | text PK | |
| `caja_movimiento_id` | text NULL UNIQUE FK `wallet_movimiento` | sueldo, gasto, corrección |
| `tienda_movimiento_id` | text NULL UNIQUE FK `wallet_tienda_movimiento` | cobro de Ordenex a una tienda (`cobro_manual`) |
| `liquidacion_pago_id` | text NULL UNIQUE FK `liquidacion_pago` | pago de Ordenex a una tienda / a un mensajero |
| `storage_path`, `content_type` | text NOT NULL | ruta en el bucket privado; CHECK `content_type` en la lista de `WALLET_COMPROBANTE_MIME` |
| `subido_por` | text NOT NULL FK `usuario` | |
| `created_at` | timestamp(3) | inmutable |

CHECK `num_nonnulls(caja_movimiento_id, tienda_movimiento_id, liquidacion_pago_id) = 1` (precedente:
XOR de `liquidacion_pago`). El UNIQUE de cada destino ES R79 (segundo comprobante → choque).
**Nota:** la FK a `liquidacion_pago` se declara en ESTA tabla; `liquidacion_pago` no gana ninguna
restricción (prohibición de la 205, `schema.prisma:1933-1944`).

**Los dos CHECK tipo↔categoría** se recrean como ampliación (listas de la 461 + los valores de §2.1):
caja, rama `egreso` + `egreso_reverso_flete_devolucion`, `egreso_reverso_iva_flete_devolucion`;
tienda, rama `credito` + `flete_devolucion_anulado`, `iva_flete_devolucion_anulado`.

RLS habilitada sin policies en las cuatro tablas (R92). **`down.sql`:** `DO` que hace RAISE si
alguna tabla tiene filas o algún movimiento usa una categoría nueva; los CHECK vuelven a las listas
de la 461; `DROP TABLE` de las cuatro. `db/schema.prisma`: modelos `WalletAnotacion`,
`WalletMovimientoAnulacion` (si aplica), `RechazoTiendaCobroAnulacion`, `WalletComprobante`, enums,
relaciones inversas opcionales. **Migraciones y `schema.prisma` obligan al gate completo.**

### 2.3 Clasificación de los conceptos nuevos (todos los `Record` totales)

| Concepto | Libro/tipo | Dueño | Liquidez | Composición | `aporte-por-orden` | Cubeta tienda | `CONTRAPARTIDA_EN_CAJA` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `egreso_reverso_flete_devolucion` | caja/egreso | propio | `cargo_a_tienda` | egresos nombrados (+1) | `sin_reparto / no_nace_de_un_cierre` | — | ← `flete_devolucion_anulado` |
| `egreso_reverso_iva_flete_devolucion` | caja/egreso | propio | `cargo_a_tienda` | egresos nombrados (+1) | ídem | — | ← `iva_flete_devolucion_anulado` |
| `flete_devolucion_anulado` | tienda/crédito | — | — | — | ídem | `aFavor` | `egreso_reverso_flete_devolucion` |
| `iva_flete_devolucion_anulado` | tienda/crédito | — | — | — | ídem | `aFavor` | `egreso_reverso_iva_flete_devolucion` |

Efecto (idéntico al reverso de cargo de la 461 §2.1): «Entró»/«Salió»/cifra principal sin cambio;
ganancia −M; «De las tiendas» +M; saldo de la tienda +M. Se tocan: `WALLET_MOVIMIENTO_CATEGORIA_SEED`,
`WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`, `WALLET_EGRESO_NOMBRADO_SEED`, `NATURALEZA_POR_CATEGORIA`,
`LIQUIDEZ_POR_CATEGORIA`, `TIPO_POR_CATEGORIA_TIENDA`, `CONTRAPARTIDA_EN_CAJA`, `CUBETA_POR_CATEGORIA`,
`FUENTE_CAJA`/`FUENTE_TIENDA`, `metrics.ts` (`dinero_en_caja` y `ganancia_ordenex` +2; `egresos` **no**;
`cuenta_por_pagar_tienda` +2 créditos), `finanzas-diarias.ts` (salidas solo efectivo: ya lo hace la 461),
`CATEGORIA_LABEL` («Flete por rechazo cobrado a la tienda anulado», «IVA del flete por rechazo cobrado a
la tienda anulado»), `CATEGORIA_TIENDA_LABEL` («Cobro por rechazo anulado», «IVA del cobro por rechazo
anulado»), `CATEGORIA_MI_WALLET_LABEL` («Ordenex anuló el flete por rechazo y te lo devolvió», «Ordenex
anuló el IVA del flete por rechazo y te lo devolvió»), `ESCRIBEN_EN_LA_TIENDA`, conteos de las guardias
(`caja-composicion-exhaustiva` nombrados 3→5; `metrics-caja-naturaleza` 23→25, 16→18;
`caja-clasificacion-459` (4) cargos +2). Los literales se escriben a mano y se anotan en el informe.

El reverso de la indemnización (D8) NO añade concepto: `ingreso_ajuste` con `origen_tipo =
orden_incidente`, `origen_id = incidenteId` (idempotente por `wallet_movimiento_origen_categoria_uq`).

## 3. Lecturas (servicio + repositorio, todo en el servidor)

### 3.1 Fechas en Costa Rica (R16)

Se REUTILIZA lo que hay: `fechaDiaMovimientoCR` (`lib/utils/fecha-dia-iso.ts:48`) para pintar,
`inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (`lib/utils/fecha-cr.ts:118-131`) para el
borde del periodo (`desde` inclusivo, `hasta` exclusivo con `lt`), y la pieza que la 461 haya
promovido para sus schemas (se confirma). Los schemas nuevos aceptan `YYYY-MM-DD` validado con
`esFechaCalendarioValida`. Ningún `z.coerce.date()` nuevo.

### 3.2 Estado de cuenta y saldo corrido (R17–R25)

`EstadoCuentaService.leer(input, actor)`, `input = { cuenta: {tipo: "tienda"|"mensajero"|"bodega",
id}, desde?, hasta?, chip?, page, pageSize }`.

- **Saldo inicial** = agregado de la cuenta con `fecha_movimiento < inicioDelDiaCREnUtc(desde)`, con
  la misma resta que hoy deriva el saldo (tienda: créditos − débitos; mensajero: devengos − pagos;
  bodega: Σ `saldoDe(total_efectivo, monto_recibido)` de las consolidaciones solicitadas antes).
- **Saldo corrido** en el repositorio con ventana, `$queryRaw` tipado, `numeric` → STRING escala 2:

  ```sql
  -- tienda (mensajero: pago_mensajero_movimiento con tipo = 'devengo'; misma forma)
  SELECT m.*, SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE -m.monto END)
           OVER (ORDER BY m.fecha_movimiento, m.created_at, m.id)::text AS saldo_corrido
  FROM wallet_tienda_movimiento m
  WHERE m.tienda_id = $1 AND m.fecha_movimiento < $hastaExclusivo
  ```

  El filtro de periodo (`>= desde`) y de chip se aplican FUERA de la ventana (R21: el corrido es de la
  cuenta completa) y luego se pagina. El orden `(fecha_movimiento, created_at, id)` es R23 y se lleva
  también a `listarPorTienda` y `listarPorMensajero` (m4). Índices existentes
  `(tienda_id, fecha_movimiento)`, `(mensajero_id, fecha_movimiento)`.
- **Bodega:** el «libro» se arma con una UNION sobre `cierre_bodega` de la zona: fila «Declarado»
  (cargo = `total_efectivo`, fecha `solicitado_at`, origen la consolidación) y fila «Recibido» (abono =
  `monto_recibido`, fecha `conciliado_at`, «Registró» = `conciliado_por`); saldo corrido = pendiente
  acumulado; coincide con `saldoDe` (R22).
- **Totales del periodo** (D3): abonos y cargos excluyendo los pares anulados (original con
  `anulacion` no nula + su contra-asiento); R22 se afirma en el servicio y en un test contra la base.
- **Chip** (R24, D10): `CHIP_POR_MOVIMIENTO` = `Record` TOTAL por libro sobre `(categoria, origen)`:
  tienda — Cierres: `cod_recaudado` y los 6 cargos con origen `cierre_dia`; Pagos: `pago_tienda`,
  `ajuste_credito`, `pago_por_cuenta(_anulado)`, `abono_tienda(_anulado)`; Cobros: `cobro_manual`,
  `cobro_tienda_anulado`, `flete_devolucion`/`iva_flete_devolucion` con origen `gestion_orden` y sus
  `_anulado`; Correcciones: `ajuste_debito`. Mensajero — Cierres: `pago_devengado`, `pago_efectivo`;
  Pagos: `liquidacion`, `ajuste_devengo`/`ajuste_pago` con origen `pago_mensajero`; Premios:
  `premio_ranking` y `ajuste_pago` con `premio_dia`; Correcciones: el resto. Bodega — Declarado /
  Recibido. Un contra-asiento va al chip de su original. Totalidad comprobada por guardia (R98).

### 3.3 Origen legible con entidad y enlace (R5–R9)

`OrigenLegibleService.resolver(filas, actor)` → `OrigenLegibleDTO { texto, enlace: {etiqueta, href} |
null }`. Lee EN LOTE: agrupa `origen_id` por tipo y hace **una consulta por tipo presente** en la
página (molde: `WalletService.listarMovimientos`, `:97-132`).

| Origen | Texto (rótulo 461 §7.3 + entidad) | Enlace (si el rol accede) |
| --- | --- | --- |
| `cierre_dia` | «Cierre del día · 12 sep · Juan Pérez» | `hrefDetalleCierre(id)` |
| `gestion_orden` | «Gestión de orden · cobro por rechazo · guía ABC123» | la orden por su guía (filtro por URL de `/ordenes`, ficha 339; parámetro a confirmar) |
| `pago_tienda` / `pago_mensajero` | «Pago de Ordenex a una tienda · 12 sep · SINPE» | estado de cuenta del beneficiario |
| `gasto` | «Sueldo» / «Gasto de Ordenex» / «Gasto fijo de Ordenex · Alquiler — sep 2026» | plantillas (gasto fijo) |
| `orden_incidente` | «Incidente de orden · guía ABC123» | la orden |
| `ranking_snapshot_fila` | «Premio del ranking · podio del 12 sep» | ranking histórico de ese día |
| `manual` | «Registrado a mano» | — |
| `pago_por_cuenta_tienda` | «Pago de un gasto de una tienda · Tania · a Facebook» | estado de cuenta de la tienda |
| `aporte_capital` | «Aporte de dinero a la caja» | — |
| `cobro_manual_reclasificado`, `cobro_tienda`, `cobro_tienda_completado` | textos de la 461 §7.3 + tienda | estado de cuenta de la tienda |
| `abono_tienda` (457) | «Pago de una tienda a Ordenex · Tania · 12 sep · SINPE» | estado de cuenta de la tienda |

Los tres diccionarios pasan a `Record<WalletOrigenTipo, …>` TOTALES y los DTO a `origenTipo:
WalletOrigenTipo` (cierra C2.1): un origen nuevo **no compila** sin nombre (R9). La caída `??
origenTipo` desaparece de `origenLabel` en `mi-wallet-labels.ts:126-128` y
`wallet-mensajeros-labels.ts:184-186`.

### 3.4 «A quién» y «Registró» (R56, R57)

| Origen del movimiento de caja | A quién |
| --- | --- |
| `cierre_dia` | el mensajero del cierre (`cierre_dia.mensajero_id`) |
| `pago_tienda` / `pago_mensajero` | el beneficiario de `liquidacion_pago` |
| `gestion_orden` | la tienda de `rechazo_tienda_cobro` (por `gestion_id`) |
| `ranking_snapshot_fila` | el mensajero del podio |
| `orden_incidente` | la tienda de la orden |
| `pago_por_cuenta_tienda` | «Tania · a Facebook» (tienda y beneficiario del documento) |
| `cobro_tienda(_completado)`, `cobro_manual_reclasificado` | la tienda del cobro |
| `abono_tienda` | la tienda del pago |
| `aporte_capital` | «Ordenex» |
| `gasto` / `manual` | `wallet_anotacion.contraparte_nombre`; filas anteriores sin anotación: «—» |

Registró: `registrado_por` → nombre con `etiquetaDeCuenta` (R33); `NULL` → «Automático · <acción>»
(«Aprobación del cierre por <resuelto_por>», «Plantilla de gasto fijo», «Cobro por rechazo aprobado
por <decidido_por>», «Incidente resuelto por <resuelto_por>», «Premio del ranking»). Misma lectura en
lote.

### 3.5 Conceptos con movimientos y cierres del selector (R10–R15)

- `conceptosConMovimientos({libro, cuenta?, periodo, otrosFiltros})` → `groupBy(categoria)` con
  `_count`, **sin** el filtro de concepto. El cliente conserva el elegido con 0 (R15). Los rótulos
  salen del diccionario de la superficie (desde Ordenex o desde la tienda).
- `cierresDeLaCuenta({cuenta, busqueda?})` → generaliza `listarCierresDeTienda`
  (`WalletTiendaMovimientoRepository.ts:199-212`) añadiendo el nombre del mensajero (JOIN
  `cierre_dia`) y una variante por mensajero; tope por configuración con `hayMas` (precedente 335).
- Borde: `cierreId: z.string().uuid()`; el `WHERE` se compone SIEMPRE con la cuenta (R12). Test
  contra la base (lección «probar el WHERE donde vive») con una mutación que quita la cuenta.

### 3.6 Estado de anulación derivado para TODA fila (R71, R72)

Se generaliza `documento` de la 459: `LectoresDocumentosCaja` gana `egresos` (sueldo/gasto/gasto
fijo: `anulado` = existe `ingreso_ajuste` con origen `gasto` y `origen_id` = su id; motivo desde la
constancia o «motivo no registrado»), `indemnizaciones` (ídem con origen `orden_incidente`),
`rechazos` (`rechazo_tienda_cobro_anulacion` por `gestion_id`) y los que la 461/457 añadan.
`tipoDeDocumentoOriginal` (`WalletService.ts:59`) gana `egreso_caja`, `indemnizacion`,
`rechazo_tienda_cobro` (las DOS filas del rechazo apuntan al mismo documento). Las dos filas del
rechazo y la de la indemnización ganan `tieneComprobante: false`. El libro de la tienda y el del
mensajero ganan el mismo campo `documento` para sus filas originales (pago 172 → `liquidacion_anulacion`;
cobro → `cobro_tienda_anulacion`; abono → 457; rechazo → nueva). Ningún componente vuelve a mirar
otras filas para decidir «anulado» (guardia R98).

### 3.7 «Cómo quedó» (R58)

Para el movimiento abierto: `derivarCaja` sobre las filas con `(fecha_movimiento, created_at, id) ≤`
las del movimiento (cifra principal con su rótulo, ganancia, «De las tiendas», capital) y el saldo de
la cuenta afectada tras él (la ventana de §3.2). Sin derivaciones nuevas.

## 4. Escrituras

### 4.1 Catálogo del registro único → camino EXISTENTE (R37, R50, R51)

| Concepto (grupo 461) | Action que ya existe | Campos | Libros | Cifra principal | Ganancia | De las tiendas | Capital |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Gasto de Ordenex (Sale) | `registrarEgresoAdministrativoAction` (+ anotación, comprobante, clave 461) | a quién, monto, fecha, motivo, comprobante | caja `egreso_gasto_variable` | baja | baja | — | — |
| Sueldo (Sale) | ídem | a quién, monto, fecha, motivo/periodo, comprobante | caja `egreso_sueldo` | baja | baja | — | — |
| Ordenex paga un gasto de una tienda (Sale) | `registrarPagoPorCuentaTiendaAction(formData)` (459) | tienda, beneficiario, monto, método, referencia, fecha, motivo, comprobante | tienda `pago_por_cuenta` + caja `egreso_pago_por_cuenta_tienda` | baja | — | baja | — |
| Corrección de caja (resta) (Sale) | `registrarMovimientoManualAction` (+ anotación opcional, comprobante, clave 461) | monto, fecha, motivo, a quién (opcional), comprobante | caja `egreso_ajuste` | baja | baja | — | — |
| **Ordenex le paga a una tienda** (Sale) | `registrarPagoTiendaAction` (172) (+ comprobante) | tienda, monto ≤ saldo a favor, método, referencia, fecha, nota, comprobante | doc + tienda `pago_tienda` + caja `egreso_pago_tienda` | baja | — | baja | — |
| **Ordenex le paga a un mensajero** (Sale) | `registrarRepartoMensajeroAction` (205) (+ comprobante) | mensajero, monto, método, referencia, fecha, comprobante | doc(s) + mensajero `liquidacion` | **no cambia** ([P2] de la 173) | — | — | — |
| Aporte de dinero a la caja (Llega) | `registrarAporteCapitalAction(formData)` (459) | clase, monto, fecha, motivo, comprobante | caja `ingreso_aporte_capital` | sube | — | — | sube |
| Corrección de caja (suma) (Llega) | `registrarMovimientoManualAction` | ídem resta | caja `ingreso_ajuste` | sube | sube | — | — |
| **Una tienda le paga a Ordenex** (Llega) | `registrarAbonoTiendaAction(formData)` (457) | tienda, monto ≤ deuda, método, referencia, fecha, motivo, comprobante | doc + tienda `abono_tienda` + caja `ingreso_abono_tienda` | sube | — | sube | — |
| Ordenex le cobra a una tienda (Se descuenta) | `registrarCobroTiendaAction` (461: + línea de caja) (+ comprobante) | tienda, monto, fecha, motivo, comprobante | tienda `cobro_manual` + caja `ingreso_cobro_tienda` (cargo) | **no cambia** | sube | baja | — |

Las columnas de efecto son EXACTAMENTE lo que «Así queda» enseña y salen del mismo
`EFECTO_POR_TIPO` (§4.4). Qué cambia en cada borde, y nada más: los schemas de sueldo, gasto y
corrección ganan `contraparteNombre` (obligatorio en los dos primeros, D5), `referencia?` y
`comprobante?` (`FormData`, molde 459); los de pago a tienda/mensajero y cobro ganan `comprobante?`.
Los `.strict()` se conservan. Cada action escribe su anotación/comprobante EN LA MISMA transacción.
La 334 decidió no unificar el backend porque `origen_tipo` decide qué se anula: se respeta.

**Comprobante en el registro (R74–R76, molde 459):** la action (1) valida con
`problemaDeComprobante`; (2) sube con `rutaDeComprobante(<destino>, mime)` (prefijos nuevos en
`PREFIJO_COMPROBANTE`: `wallet_movimiento: "movimientos-caja"`, `wallet_tienda_movimiento:
"cobros-tienda"`, `liquidacion_pago: "pagos"`); (3) ejecuta la transacción del registro, que inserta
`wallet_comprobante`; (4) si falla, borra el objeto. Adjuntar después (D6):
`adjuntarComprobanteAction(formData: destino + archivo)`, que choca contra el UNIQUE si ya hay uno.

### 4.2 Anulación uniforme (R63–R73): contra-asientos por camino

`anularMovimientoAction({ destino, motivo })` (`.strict()`, sin monto) enruta por la clase del
destino a la action/servicio que ya existe o al nuevo:

| Original | Libro(s) | Contra-asiento(s) | Constancia | Historial |
| --- | --- | --- | --- | --- |
| `egreso_sueldo`, `egreso_gasto_variable`, `egreso_gasto_fijo` (origen `gasto`) | caja | `ingreso_ajuste`, origen `gasto`/id original — **igual que hoy** (`WalletEgresoService.reversarEgreso`), ahora con motivo y sin caer al uuid (R4) | `wallet_movimiento_anulacion` (o molde 461) | `egreso_caja_anulado` |
| `egreso_indemnizacion` (origen `orden_incidente`) | caja | `ingreso_ajuste`, origen `orden_incidente`/incidente (D8) | ídem | ídem |
| corrección de caja | caja | lo que la 461 dejó | 461 | 461 |
| cobro de Ordenex a una tienda | tienda + caja | 461 (`anularCobroTiendaAction`) | 461 | 461 |
| **cobro por rechazo aprobado** | caja + tienda | caja: `egreso_reverso_flete_devolucion` (monto_flete) y `egreso_reverso_iva_flete_devolucion` (monto_iva, si > 0), origen `gestion_orden`/gestión; tienda: `flete_devolucion_anulado` e `iva_flete_devolucion_anulado` **solo si existen los débitos originales** (interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION`) | `rechazo_tienda_cobro_anulacion` | `cobro_rechazo_tienda_anulado` (mueve dinero; entidad `rechazo_tienda_cobro`; etiqueta = tienda) |
| pago de un gasto, aporte | 459 | 459 | 459 | 459 |
| pago de Ordenex a tienda / mensajero | 172 (`anularPagoAction` / `anularRepartoAction`) | 172 | `liquidacion_anulacion` | 172 |
| pago de la tienda a Ordenex | 457 | 457 | 457 | 457 |
| premio del ranking | 293 (`anularPremioAction`) | 293 | 293 | 293 |

Reglas comunes: rol antes de leer (R82); monto leído del original en el servidor; los contra-asientos
con el MISMO instante = `ahora()` inyectado (hoy CR; R64, lección de la 461 §5.1); constancia primera
con `createMany({ skipDuplicates })` cuyo `count = 0` ⇒ `ya_anulado` sin escribir nada más (R66, R67;
no se interpreta un P2002 sin `meta.target`); el contra-asiento además idempotente por el índice
único parcial del libro (`origen_id` = id del original o de la gestión). `RechazoTiendaCobroService`
gana `anular` (interfaz ampliada; su docstring de «decisión atómica» se conserva). `ICobroTienda…`
no se toca (461).

**R72, reversos anteriores:** un egreso con `ingreso_ajuste` de origen `gasto`/su id y SIN constancia
se pinta anulado con «motivo no registrado». Lectura, sin backfill (R89).

**R73:** anular no cambia `rechazo_tienda_cobro.estado` ni `gestion_orden` ni la orden; la cola
(`CobrosRechazoTiendaPendientesPanel`) no lo vuelve a listar (sigue `aprobado`) y su detalle dice
«Anulado el <día> por <quién> · <motivo>».

### 4.3 Efecto inverso (R68), por libro

| Anulación de | Saldo cuenta | Cifra principal | Ganancia | De las tiendas | Capital |
| --- | --- | --- | --- | --- | --- |
| sueldo / gasto / gasto fijo / indemnización | — | +M | +M | — | — |
| cobro por rechazo | +M (flete+IVA) | — | −M | +M | — |
| cobro de Ordenex a una tienda (461) | +M | — | −M | +M | — |
| pago de un gasto (459) | +M | +M | — | +M | — |
| aporte (459) | — | −M | — | — | −M |
| pago de Ordenex a tienda (172) | +M | +M | — | +M | — |
| pago de Ordenex a mensajero (172) | +M (cuenta por pagar) | — | — | — | — |
| pago de la tienda a Ordenex (457) | −M | −M | — | −M | — |
| premio (293) | −M | +M | +M | — | — |

Se afirma con la fotografía (§8): tras anular, las cifras vuelven a sus literales.

### 4.4 «Así queda» (R44–R47)

`previsualizarMovimientoAction({ concepto, cuentaId?, monto })` (lectura, acceso total):

1. Lee el agregado actual de la caja sin filtros (`verResumenCaja`) y, si aplica, el saldo de la cuenta.
2. `EFECTO_POR_TIPO` (`Record` TOTAL sobre el concepto, **la misma tabla que el enrutado**) dice qué
   filas hipotéticas `(libro, tipo, categoria)` produce el registro.
3. `efectoDeMovimiento(actual, hipoteticas)` — función PURA en `lib/utils/efecto-movimiento.ts` — llama
   a `derivarCaja` sobre `actual` y sobre `actual + hipotéticas` y a la derivación del saldo de la
   cuenta. **No reimplementa ninguna resta** (`caja-derivaciones.guardia` exige que la resta viva en
   `derivarBalance`; sigue en cuatro llamadas).
4. Devuelve STRING antes/después por línea (`cuenta?`, `cifraPrincipal` con su rótulo, `ganancia`,
   `deTiendas`, `capital`) con `cambia: boolean` (R45), `saldoEnContra: boolean` (R47) y
   `superaDisponible` para el pago a tienda / el abono (tope decidido por el servidor).

El diálogo pide la previsualización con un retardo corto y no la pide sin monto válido ni cuenta.

## 5. Rutas y pantallas

| Ruta | Server Component | Qué cambia |
| --- | --- | --- |
| `/wallet` | valida acceso total (sin cambio de guardia) | libro de caja nuevo (§5.2), diálogo único, panel «Ver» |
| `/wallet/tiendas` | ídem | la fila deja de desplegar el desglose y enlaza «Ver estado de cuenta» |
| `/wallet/tiendas/[tiendaId]` | **nueva**; `notFound` si la cuenta no existe o el rol no accede | estado de cuenta + acciones R26–R28 |
| `/wallet/mensajeros` | ídem; pestañas (cuentas y premios) se conservan | la fila enlaza |
| `/wallet/mensajeros/[mensajeroId]` | **nueva** | estado de cuenta + R29 + anulación de pagos (R70) |
| `/wallet/satelites` y `/wallet/satelites/[zonaId]` | la segunda **nueva** | estado de cuenta + conciliación (R31) |
| `/mi-wallet` | `adminTienda`, tienda de la sesión (sin cambio de guardia ni de `ROLES_MI_WALLET`) | estado de cuenta en solo lectura con las lecturas de la 461 §7.5 |

Los segmentos dinámicos llevan el uuid (D1). Todo dato sensible se pre-obtiene en el Server Component
y baja por props; los refrescos van por Server Action + SWR con claves por cuenta (R30).

### 5.1 Componentes y sistema de diseño

`DESIGN.md` y `app/globals.css`: `AppPage` como único shell; cards hermanas; tokens semánticos (abono
`text-success-strong`, cargo `text-danger-strong`; jamás `emerald-*` ni hex); `Badge` semántico;
`DataTable` con esqueleto, `EmptyState` que enseña el siguiente paso y estado de error; `FormField`;
`Modal` (con `size`) para el registro; `Sheet` para el panel; foco `focus-visible:ring-3
focus-visible:ring-ring` opaco; `tabular-nums` y montos a la derecha; anulado = `line-through` + texto
`muted` (vía `rowClassName`) y el motivo en texto. Textos fuera del JSX en `*-labels.ts`; vocabulario
llano sin siglas («contra-entrega», no «COD»), «terceros» solo en código.

Piezas nuevas, promovidas a `components/shared/` porque las usan ≥ 2 hijas:

- `estado-cuenta/` — `TarjetasEstadoCuenta`, `TablaEstadoCuenta`, `ChipsEstadoCuenta`.
- `wallet/RegistrarMovimientoDialog` (catálogo a la izquierda en tres grupos, formulario a la derecha,
  «Así queda» debajo; en móvil el catálogo arriba como lista). Sustituye a `RegistrarMovimientoCajaDialog`.
- `wallet/DetalleMovimientoPanel` (Sheet) + `wallet/AnularMovimientoDialog` (molde `AnularPagoDialog`).
- `SelectorBuscable` (popover + input sobre `components/ui/popover.tsx`) para cierre, cuenta y «A
  quién». No hay combobox en el repo; esta es la primitiva, con estados vacío/cargando/error.

### 5.2 Libro de caja

Tarjetas de la 459 intactas (R53). Filtros: `SegmentedToggle` Todo/Entra/Sale, `SelectorBuscable` «A
quién», `Select` de concepto con cuenta, periodo. Columnas: Fecha · Movimiento y motivo · A quién ·
Monto (dirección + dueño) · Registró · Ver. La aserción de orden de columnas de
`tests/components/descarga/WalletDescarga.test.tsx` se reescribe EN EL MISMO COMMIT que cambia las
columnas, afirmando la lista nueva como contrato (el literal ES el contrato aquí).

## 6. Contratos I/O (bordes nuevos)

Todos con zod `.strict()`, montos STRING, fechas `YYYY-MM-DD` de Costa Rica.

```ts
// Estado de cuenta
estadoCuentaSchema = { cuenta: { tipo: "tienda"|"mensajero"|"bodega", id: uuid },
  desde?: FechaCR, hasta?: FechaCR, chip?: ChipDeLaCuenta, page, pageSize /* tope en config */ }
EstadoCuentaDTO = { saldoActual: string, signo, frase: string, saldoInicial: string,
  abonos: string, cargos: string, saldoFinal: string, filas: FilaEstadoCuentaDTO[], total, page, pageSize }
FilaEstadoCuentaDTO = { ref: DestinoMovimiento /* viaja, nunca se pinta */, fecha: FechaCR,
  concepto: string, motivo: string|null, referencia: string|null, origen: OrigenLegibleDTO,
  registro: { nombre: string|null, automatico: string|null }, cargo: string|null, abono: string|null,
  saldoCorrido: string, chip, anulacion: { motivo: string|null, por: string, fecha: FechaCR }|null,
  esContraAsiento: boolean, tieneComprobante: boolean, anulable: boolean, naceDeUnCierre: boolean }

// Registro único
registrarMovimientoSchema = discriminatedUnion("concepto", [...])  // una rama por concepto de §4.1,
  // cada una con SOLO sus campos (R39) + claveIdempotencia: uuid + comprobante?: File
previsualizarMovimientoSchema = { concepto, cuentaId?: uuid, monto: montoPositivoSchema }
EfectoMovimientoDTO = { lineas: { cuenta?: Linea, cifraPrincipal: Linea & { rotulo: string },
  ganancia: Linea, deTiendas: Linea, capital: Linea }, saldoEnContra: boolean, superaDisponible?: boolean }
// Linea = { antes: string, despues: string, cambia: boolean }

// Anulación y comprobante
anularMovimientoSchema = { destino: DestinoMovimiento, motivo: string.trim().min(1) }
adjuntarComprobanteSchema = FormData { destino: DestinoMovimiento, comprobante: File }
verComprobanteSchema = { destino: DestinoMovimiento } -> { status: "ok", url, rotulo } | "sin_comprobante" | "no_encontrado" | …
DestinoMovimiento = { libro: "caja"|"tienda"|"mensajero", movimientoId: uuid }
                  | { documento: "liquidacion_pago"|"pago_por_cuenta_tienda"|"aporte_capital"|"abono_tienda"|"rechazo_tienda_cobro", id: uuid }

// Filtros
conceptosConMovimientosSchema, cierresDeLaCuentaSchema, filtro del libro de caja +
  aQuien?: { tipo: "tienda"|"mensajero", id: uuid } | { nombre: string }
```

Resultados con la forma de estado del repo (`ok` | `validation_error` | `forbidden` |
`unauthenticated` | `no_encontrado` | `ya_anulado` | `no_anulable` | `comprobante_no_guardado` | …).
Ninguna rama de error viaja con filas.

## 7. Guardias (R93–R99)

Todas descubren sus archivos **por carpeta** (`app/(app)/wallet/**`, `app/(app)/mi-wallet/**`,
`components/shared/{estado-cuenta,wallet}/**`), no por lista, con control de no-vacuidad y contraprueba:

| Guardia | Qué caza | Contraprueba |
| --- | --- | --- |
| `wallet-sin-campo-id.guardia` (R93) | `<Input>` cuyo estado se llama `*Id`, o placeholder/ayuda que case `/\bID\b|identificador|pegá|copiá su dirección/i` | fuente sintética con C1.1 |
| `wallet-origen-total.guardia` (R94) | mapas de origen que no sean `Record<WalletOrigenTipo, …>`, o `?? <x>.origenTipo` | `origenLabel` de hoy |
| `wallet-conceptos-sin-seed.guardia` (R95) | `*_CATEGORIA_SEED.map(` alimentando `options` de un filtro | `CATEGORIA_OPTIONS` de hoy |
| `wallet-sin-uuid.guardia` (R96) | **render** de cada superficie con fixtures uuid: forma de uuid en `textContent`, `aria-label`, `aria-describedby` resuelto, `placeholder`, `value`, `title` (excluye `id`/`htmlFor`/`href`) | render del `EnlaceCierre` de hoy (C4.1) |
| `nombres-wallet-461.guardia` ampliada (R97) | nombres retirados/reservados en las carpetas nuevas | la de la 461 |
| `estado-anulado-en-servidor.guardia` + `estado-cuenta-chips-total.guardia` (R98) | un componente que compare `origenId` de una fila con `id` de otra para decidir «anulado»; un `Record` de chips no total | `WalletLedger` de hoy (si la 461 dejó la comparación en el cliente) |
| `wallet-textos-458.guardia` (R101) | las afirmaciones de §1.4 | la fuente de hoy |

Se reutiliza `columnas-sensibles.guardia.test.ts` para las descargas nuevas (R3).

## 8. Fase 0 — caracterización antes de tocar dinero (458-B; R84, R85, R88, R91)

### 8.1 Fotografía

Se REUTILIZA `tests/integration/db/caja-caracterizacion-459.test.ts` y su fixture (ya ejercen todos
los caminos de la caja, incluido el cobro con la 461) y se añade `wallet-caracterizacion-458.test.ts`
que afirma como LITERALES: saldo y desglose de cada tienda, cuenta por pagar de cada mensajero,
pendiente de cada bodega, el saldo corrido fila a fila de una cuenta con 6 movimientos (dos en el
mismo instante), el saldo inicial de un periodo y los totales netos. Bloque nuevo con nombre propio
«lo que la 458 añade a propósito»: tras anular el cobro por rechazo de la foto (flete 1.800 + IVA
234, cifras de ejemplo del fixture), la ganancia baja 2.034 y «De las tiendas» sube 2.034; la cifra
principal, «Entró» y «Salió» no cambian; R7 y R8 dan 0,00. Los literales se calculan **a mano en un
comentario**. Cada hija corre las dos fotografías antes y después: **deben dar lo mismo**.

### 8.2 Mutaciones (≥ 10, una a una, con autocomprobación)

1. Invertir el signo del saldo corrido. 2. Quitar `created_at` del `ORDER BY` de la ventana (dos filas
del mismo instante). 3. Quitar la cuenta del `WHERE` de `cierresDeLaCuenta`. 4. `egreso_reverso_flete_
devolucion` como `efectivo` (sube «Salió»). 5. `flete_devolucion_anulado` en cubeta `cargos`. 6. Anular
el rechazo sin el crédito de la tienda. 7. Anular con el monto de la petición en vez del del cobro.
8. Constancia sin `skipDuplicates` (dos anulaciones a la vez → dos). 9. `EFECTO_POR_TIPO` del aporte sin
la línea de capital. 10. `tipoDeDocumentoOriginal` sin `rechazo_tienda_cobro` (la fila no ofrece
«Anular…»). 11. `LectoresDocumentosCaja.egresos` que mire la página en vez de la base. 12. Totales del
periodo sin excluir el par anulado (R22 sigue, pero el literal cae). Por cada una: aplicar → correr
SOLO la fotografía → rojo con el nombre del caso y número de tests ≠ 0 → revertir → verde; informe
`progress/fase0_458-B.md` con `git diff --stat` vacío al final. Gate y mutaciones nunca a la vez.

## 9. Partición en fichas hijas (nueva)

```
461 ──► 457 ──┬──► 458-A (detalles + guardias, fullstack) ──┐
              └──► 458-B (cimientos, backend, migración) ────┴──► 458-C (registrar + Ver) ──┬──► 458-D (estados de cuenta)
                                                                                             └──► 458-E (libro de caja)
```

| Hija | Zona | Qué entrega | R | Depende de | Gate |
| --- | --- | --- | --- | --- | --- |
| **458-A Detalles y guardias** (lo pedido con «muchísima atención», sobre las pantallas ACTUALES) | fullstack | Selector de cierre en `/wallet/tiendas` y `/wallet/mensajeros` (P2, C1); origen con entidad y enlace en las 6 superficies y sus descargas; los 3 filtros de concepto con cuenta; fuera el uuid del `sr-only`; una función de etiqueta de cuenta (P5); rótulo del panel mensual de `/analitica`; `.strict()` del paginado de `/mi-wallet`; textos de §1.4; las guardias R93–R97, R99; ayuda de filtros/orígenes y asistente. Lecturas nuevas en servicios propios (`OrigenLegibleService`, `FiltrosWalletService`) para no chocar con 458-B. | R1–R15, R16 (selectores), R33, R36, R62, R84, R90, R93–R97, R99, R101 (parte), R102–R104 | 461 y 457 en `dev` | rápido; fotografías antes/después |
| **458-B Cimientos** | backend | Migraciones §2; anulación con motivo de sueldo/gasto/gasto fijo/indemnización y del cobro por rechazo; estado de anulación derivado por fila (P3 completo); `EstadoCuentaService` con saldo corrido, saldo inicial, totales netos, chips y orden estable (m4); «A quién»/«Registró»; «Cómo quedó»; «Así queda»; comprobante lateral (registrar, adjuntar, ver con alcance); bordes de sueldo/gasto/corrección con contraparte; permisos; **fase 0**. | R16 (servidor), R20–R25 (servidor), R44–R47, R50, R51, R56, R57, R63–R69, R71–R92, R98 | 461 y 457 en `dev`; [P] con 458-A | **completo** (migración, `schema.prisma`, `lib/types/`) |
| **458-C Registrar un movimiento y Ver** | fullstack | `RegistrarMovimientoDialog` (diez conceptos, tres grupos, campos por concepto, «Así queda», comprobante, preselección, clave) sustituyendo a `RegistrarMovimientoCajaDialog` en `/wallet`; `DetalleMovimientoPanel` + `AnularMovimientoDialog` compartidos y enchufados en el libro actual; ayuda de registrar/anular y asistente. | R37–R43, R44–R49 (pantalla), R52, R58, R63–R67 (pantalla), R71 (pantalla), R74–R76, R79, R80 (pantalla), R100, R102–R104 | 458-A, 458-B | rápido |
| **458-D Estados de cuenta y Mi wallet** | fullstack | Rutas nuevas de tienda, mensajero y bodega; `/mi-wallet` rehecho; chips, periodo, saldo corrido, anulados tachados, acciones (R26–R29), anulación del pago a mensajero desde la wallet (P6), descarga con saldo corrido, refresco dirigido, comprobante visible para la tienda; retiro de los tres desgloses; ayuda de tiendas/mensajeros/satélites/mi-wallet y asistente. | R17–R36, R70, R72 (pantalla), R78, R81, R102–R104 | 458-C | rápido |
| **458-E Libro de caja** | fullstack | `/wallet` con columnas nuevas, filtros Todo/Entra/Sale y «A quién», panel «Ver» y refrescos; colas y plantillas intactas; subtítulo; ayuda de la caja; **recorrido completo final** de la 458. | R53–R61, R101, R102–R104 | 458-C; [P] con 458-D | rápido |

**Límite de zona:** como mucho dos `fullstack` a la vez: 458-A sola (o con 458-B, que es backend);
luego 458-C; luego 458-D ∥ 458-E (no comparten archivos: las piezas comunes nacen en 458-C). Todas
arrancan DESPUÉS de que la 461 y la 457 estén en `dev`, porque las tres tocan
`wallet-conceptos-manuales.ts`, los tres `*-labels.ts` y `RegistrarMovimientoCajaDialog.tsx`.

## 10. Recorrido por rol (guion; se ejecuta al cerrar cada hija y completo al cerrar 458-E)

Sin arnés E2E en el repo (el checkpoint E2E se declara inaplicable y se cubre con los tests de
integración de §7–§8 más este recorrido). Playwright ad hoc sobre UN solo dev server local sembrado,
capturas a `progress/recorrido_458-<hija>/`, tabla **maqueta vs app** por pantalla con NÚMEROS.

**Maestro**
1. `/wallet`: las tarjetas valen lo mismo que la fotografía sobre los mismos datos; el filtro de
   concepto solo trae conceptos del periodo con su cuenta; «Otro gasto de Ordenex» (`egreso_gasto`)
   no aparece.
2. «Registrar un movimiento»: diez conceptos en tres grupos + enlace a plantillas. «Sueldo»: pide a
   quién, monto, fecha, motivo, comprobante opcional; «Así queda»: cifra principal y ganancia bajan lo
   mismo, «De las tiendas» y capital «no cambian». Registrar con un PDF.
3. La fila nueva: A quién = el nombre escrito; Registró = el maestro. «Ver» → panel con comprobante
   (se abre), «Cómo quedó». «Anular…» con motivo → original tachado «Anulado» + contra-asiento
   «Anulación de: Sueldo…»; tarjetas de vuelta a su valor; segundo intento → «Ya estaba anulado».
4. `/wallet/tiendas` → tienda con saldo en contra → estado de cuenta: «<Tienda> le debe ₡… a
   Ordenex»; «La tienda le paga a Ordenex» visible; «Ordenex le paga a la tienda» deshabilitado con
   motivo. Saldo inicial arriba; saldo corrido de la última fila = tarjeta = fila del listado.
5. «Ordenex le cobra a la tienda» 5.000: «Así queda»: saldo −5.000, ganancia +5.000, «De las
   tiendas» −5.000, cifra principal «no cambia». Tras registrar, volver al listado: la fila muestra el
   saldo nuevo.
6. «Ordenex paga un gasto de una tienda» a «Facebook» por 10.000: «Así queda»: cifra −10.000, «De las
   tiendas» −10.000, ganancia «no cambia», saldo −10.000 con el aviso de saldo en contra si aplica; en
   `/mi-wallet` de esa tienda se lee «Ordenex pagó un gasto por ti · A Facebook…».
7. Un cobro por rechazo aprobado (sembrado): «Ver» → «Anular…» con motivo → dos reversos en la caja
   («Flete por rechazo cobrado a la tienda anulado», «IVA…»), dos créditos en la tienda; ganancia
   −(flete+IVA), «De las tiendas» +(flete+IVA), «Entró» igual; la cola no lo vuelve a ofrecer.
8. Filtro de cierre: buscar por el nombre de un mensajero y por un día; ningún control pide un ID.
9. Descargar el estado de cuenta; abrir el archivo: sin uuid, origen legible, saldo corrido.
10. `/wallet/mensajeros/<m>`: «Ordenex le paga al mensajero» (reparto) y «Anular…» un pago desde la
    wallet; comprobar que `/cierres-admin` sigue anulando igual.
11. `/wallet/satelites/<b>`: marcar recibido; el pendiente y la fila del listado cambian.
12. Árbol de accesibilidad de «Ver el cierre»: sin uuid. `/analitica`: el panel mensual dice
    «Movimiento neto del periodo».

**Admin:** los pasos 1–12 con el mismo resultado, salvo la cola de gastos fijos: la ve y NO la decide.

**adminTienda:** `/mi-wallet` muestra su estado de cuenta desde su lado («Le pagaste a Ordenex» con
referencia y motivo, «Ordenex te cobró», «Ordenex pagó un gasto por ti»); abre el comprobante que
subió Ordenex; no hay botones de registrar/anular/adjuntar; `/wallet` y `/wallet/tiendas/<otra>` →
no encontrado; el comprobante de otra tienda (destino a mano) → «no encontrado».

**Mensajero y adminSatelite (roles sin acceso):** `/wallet*` y `/mi-wallet` → no encontrado; las
actions de registrar/anular/previsualizar → `forbidden` sin escribir.

## 11. Acoples con otras fichas (lo que el leader anota o pasa a otros agentes)

- **457 (la está actualizando otro agente en paralelo):** (a) su R62 se reescribe como «…sin que
  entre en la caja el mismo importe en la misma transacción» (D9 de requirements); (b) la entrada
  «Una tienda le paga a Ordenex» del catálogo y la acción del estado de cuenta las pinta la 458-C/D,
  no la 457 (su DH6 y Q1); (c) `PREFIJO_COMPROBANTE.abonos-tienda` y `tipoDeDocumentoOriginal`
  `abono_tienda` los deja la 457 y la 458 los reutiliza; (d) su `AbonoTiendaDTO` debe llevar lo que
  `FilaEstadoCuentaDTO` necesita (motivo, método, referencia, registró, anulación) — ya lo prevé.
- **461:** (a) su R39 («exactamente estos siete conceptos») queda **superado** por R37 de esta ficha
  al llegar 458-C; el test que fija «siete» se reescribe con la lista nueva como contrato y se lista
  con su R; (b) su R20 («Anular…» en el libro de la caja) se extiende al panel y al estado de cuenta;
  (c) sus textos §7 son la fuente de todos los rótulos de esta ficha; los cuatro conceptos nuevos de
  §2.3 se nombran con su misma regla y se añaden a su guardia de nombres; (d) su molde de anulación
  de la corrección de caja decide D13.
- **459:** §14 de su design ya está aplicado aquí (§0.2); su fotografía se reutiliza (§8).
- **462:** comparte `hrefDetalleCierre` (`cierre-enlace.ts`) y el criterio «identificador solo en la
  dirección» (su R33 = D1 de esta ficha). Ningún archivo de la 462 se toca.
- **Guardias existentes que cambian literal:** `caja-composicion-exhaustiva` (nombrados 3→5),
  `metrics-caja-naturaleza` (23→25, 16→18), `caja-clasificacion-459` (cargos +2, contrapartidas +2),
  `catalogo-y-choke-point` (+1 o +2 tipos de historial), `WalletDescarga.test.tsx` (columnas). Cada
  literal cambiado se anota en el informe de la hija.

## 12. Alternativas descartadas

- **A1 — Unificar el backend en un documento «registro» único.** Rediseñar el dinero para arreglar
  lo que la pantalla dice; la 334 documentó que `origen_tipo` decide qué se anula; el repo tiene dos
  specs descartados por proponer modelo nuevo en vez del arreglo mínimo.
- **A2 — Columnas nuevas en los tres libros** (contraparte, comprobante, anulado_por). Vuelve
  mutables filas inmutables y triplica migración, repositorios y tests para lo que una tabla lateral
  resuelve; además `liquidacion_pago` no puede ganar restricciones únicas (205).
- **A3 — Guardar «a quién» y la referencia dentro de `descripcion`.** Texto libre no se filtra ni se
  enlaza (D2 de la 381; la 461 P5 lo aceptó SOLO para el beneficiario que ya vive en un documento).
- **A4 — Saldo corrido y «Así queda» calculados en el navegador.** Prohibido por money-safe (R90).
- **A5 — Saldo corrido del subconjunto filtrado por chip.** No cuadraría con la tarjeta ni con el
  listado (R21/R22).
- **A6 — FK polimórfica `(libro, movimiento_id)` en comprobante y anulación.** Sin integridad
  referencial; el repo usa FKs nullables + CHECK XOR.
- **A7 — Guardias con lista fija de archivos.** Una pantalla nueva escaparía.
- **A8 — Clave legible por cuenta en la URL.** Toca `usuario` por una dirección que no es contenido;
  la 462 ya firmó el criterio contrario.
- **A9 — Un solo par de categorías para anular el cobro por rechazo** (flete + IVA juntos). El IVA
  anulado dejaría de distinguirse del flete anulado en la analítica y en la composición.
- **A10 — Anular el cobro por rechazo reutilizando `egreso_reverso_cobro_tienda` /
  `cobro_tienda_anulado` de la 461.** Rotularía «Cobro a una tienda anulado» un flete por rechazo, y
  distinguirlos por la descripción es lo que la D2 de la 381 prohibió.
- **A11 — Categoría propia `ingreso_reverso_indemnizacion`.** Un valor de enum y una clasificación
  más para un camino con una fila en producción; el molde del reverso del gasto ya existe.
- **A12 — Conservar «Reversar» para los gastos.** Dos palabras para la misma acción es la falencia
  que motiva la ficha.
- **A13 — Conservar el desglose desplegable además del estado de cuenta.** Dos lecturas del mismo
  dinero que pueden divergir (P1 de la auditoría).
- **A14 — Cambiar `rechazo_tienda_cobro.estado` a `anulado`.** Un estado nuevo en su enum, un CHECK
  (`decidido_at` NULL ⇔ `pendiente`) que revisar y una fila que deja de ser inmutable; la constancia
  lateral es el patrón de la 172/459/461.

## 13. Riesgos

- **Dinero:** mitigado por las fotografías y las mutaciones (§8) antes y después de cada hija; por no
  tocar derivaciones; por reutilizar los caminos de escritura.
- **El código de la 461 no se pudo leer:** §0.2 lista lo que se confirma; si un molde difiere, cambia
  la tarea, no el requisito.
- **Base local compartida entre worktrees:** la migración de 458-B pone rojo el gate de otras
  sesiones hasta que migren (`prisma migrate deploy` tras mergear); `prisma generate` se pisa.
- **Tests que viven dentro de lo que se retira** (`DesgloseMovimientosTienda`,
  `DesglosePagosMensajero`, `DesgloseConsolidacionesSatelite`, `RegistrarMovimientoCajaDialog`,
  `WalletLedger` «Reversar»): cada test retirado se lista con el requisito que lo sustituye.
- **Colisión de timestamps de migración** con la 457 y la 461: mirar `origin/dev` antes de fijarlos.
- **Bucket:** ya existe en local/preview/prod desde la 459 (paso de release de la 459); sin bucket,
  registrar CON comprobante responde `comprobante_no_guardado` y NO registra (R76).

## 14. SQL de SOLO LECTURA para producción (las corre el leader)

```sql
-- Q458-1 (D7) — alcance de la anulación del cobro por rechazo: cobros aprobados, suma flete+IVA,
-- y cuántos tienen sus dos filas de caja y sus débitos espejo. Esperado el 2026-09-25: 35 / 95.824,00.
SELECT count(*) AS aprobados, sum(monto_flete + monto_iva) AS total,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_movimiento w
                        WHERE w.origen_tipo::text = 'gestion_orden' AND w.origen_id = c.gestion_id
                          AND w.categoria::text = 'ingreso_flete_devolucion')) AS con_linea_caja,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_tienda_movimiento t
                        WHERE t.origen_tipo::text = 'gestion_orden' AND t.origen_id = c.gestion_id
                          AND t.categoria::text = 'flete_devolucion')) AS con_debito_tienda
FROM rechazo_tienda_cobro c WHERE c.estado::text = 'aprobado';

-- Q458-2 (R72) — reversos anteriores sin motivo (se pintarán «motivo no registrado»). Informativo.
SELECT count(*) FROM wallet_movimiento r
WHERE r.categoria::text = 'ingreso_ajuste' AND r.origen_tipo::text = 'gasto' AND r.origen_id IS NOT NULL;

-- Q458-3 (R68/R91) — TRAS desplegar: C461-1 de la 461 con `es_cargo` ampliado a
-- 'egreso_reverso_flete_devolucion','egreso_reverso_iva_flete_devolucion'. Se esperan diferencia_r7 =
-- diferencia_r8 = 0,00 y la cifra principal idéntica a la de antes.

-- Q458-4 (R23) — grupos del mismo instante mayores que la página por defecto (20). Se espera 0 filas.
SELECT 'tienda' AS libro, tienda_id AS cuenta, fecha_movimiento, count(*) FROM wallet_tienda_movimiento
GROUP BY 1,2,3 HAVING count(*) > 20
UNION ALL
SELECT 'mensajero', mensajero_id, fecha_movimiento, count(*) FROM pago_mensajero_movimiento
GROUP BY 1,2,3 HAVING count(*) > 20;
```
