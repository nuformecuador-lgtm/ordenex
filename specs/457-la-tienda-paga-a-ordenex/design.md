# Ficha 457 — diseño técnico

> **Reescrito el 2026-09-25.** Búsqueda: el MCP `codebase-memory` (`R-job-singularis-projects-ordenex`)
> está RANCIO para la 459 y la 461 (`search_graph` no encuentra `PagoPorCuentaTiendaService`,
> `LIQUIDEZ_POR_CATEGORIA` ni `CajaCobroTiendaFeedService`); **todo lo que sigue se leyó del archivo
> real**: `origin/dev` (árbol de trabajo en `10288c39`: 459, 460, 462) y `origin/feature/461-final`
> (leído del worktree `.claude/worktrees/agent-ab5bd5126eb858a90`, rama `feature/461-cierre` =
> `461-final` @ `72f1fd7b` + `origin/dev` @ `b37553db`; contrastado con el worktree de `461-final`,
> `agent-abf7d7c9ab7387720`). Sin `git` en la sesión del autor: los `archivo:línea` son de esa lectura.
> Donde digo «medir», es que NO lo sé y hay que medirlo antes de escribir la migración.
>
> **Esta ficha nace después de que la 461 esté en `dev`.** Sus enums, CHECK, diccionarios y guardias
> son la base de la 457; escribirla sobre `dev` sin la 461 dejaría dos árboles con CHECK y `down`
> distintos que se pisan al mergear.

## 0. En una frase

Un **documento propio** (`abono_tienda`) que nace con su crédito en el libro de la tienda, su ingreso
de **efectivo de terceros** en la caja y su fila de historial en la misma transacción, bajo el mismo
candado que el pago de Ordenex a esa tienda y que el pago de un gasto de la tienda; con tope en la
deuda; con anulación uniforme (motivo + contra-asientos + «Anular…» en la fila original del libro de
la caja); con comprobante opcional en el bucket compartido de la 459; y con los nombres que la 461
reservó: **«Una tienda le paga a Ordenex»** / **«La tienda le paga a Ordenex»** / **«Le pagaste a
Ordenex»**. En la UI: el concepto en el diálogo «Registrar movimiento» y el botón «Registrar pago de la
tienda a Ordenex» en el desglose de `/wallet/tiendas` cuando la tienda debe.

**Principio rector:** reutilizar lo que la 459 y la 461 ya dejaron (comprobante, idempotencia con
clave del cliente, anulación con `documento`, candado compartido, `down` dinámico, guardias de
clasificación y de nombres) y no abrir ninguna excepción nueva a R7/R8.

### Nombres (todos; los textos visibles en §2)

| Pieza | Valor |
| --- | --- |
| Tabla del documento | `abono_tienda` |
| Tabla de la anulación | `abono_tienda_anulacion` |
| Categoría crédito, libro de tienda | `abono_tienda` |
| Categoría débito de la anulación, libro de tienda | `abono_tienda_anulado` |
| Categoría ingreso de caja (terceros, efectivo) | `ingreso_abono_tienda` |
| Categoría egreso de caja (terceros, efectivo), reverso | `egreso_reverso_abono_tienda` |
| Origen (`wallet_origen_tipo`) | `abono_tienda` (las cuatro filas de los dos libros; `origen_id` = id del documento) |
| Historial: tipos | `abono_tienda_registrado`, `abono_tienda_anulado` |
| Historial: entidad | `abono_tienda` |
| `DocumentoCajaDTO.tipo` | `"abono_tienda"` |
| `PREFIJO_COMPROBANTE` | `abono_tienda: "abonos-tienda"` |
| Servicio | `AbonoTiendaService` (`lib/services/`) |
| Puerto de caja | `ICajaAbonoTiendaFeedService` / `CajaAbonoTiendaFeedService` |
| Repositorio | `IAbonoTiendaRepository` / `AbonoTiendaRepository` |
| Tipos y schemas | `lib/types/abono-tienda.ts` |
| Server Actions | `lib/actions/abono-tienda.ts` (archivo NUEVO) |
| Descripciones puras | `lib/utils/descripcion-abono.ts` |
| Concepto del diálogo | `ConceptoManualId` `"abono_tienda"`, clase de destino `"abono_tienda"`, grupo `entra` |

## 1. La base medida (lo que hay al empezar)

### 1.1 Catálogos y restricciones (tras la 461; medidos en el clon `ordenex_461z`, `progress/impl_461.md` §9)

| Enum | Valores | Últimos |
| --- | --- | --- |
| `wallet_movimiento_categoria` | **23** | …, `ingreso_aporte_capital`, `egreso_reverso_aporte_capital`, `ingreso_cobro_tienda`, `egreso_reverso_cobro_tienda` |
| `wallet_tienda_movimiento_categoria` | **14** | …, `cobro_manual`, `pago_por_cuenta`, `pago_por_cuenta_anulado`, `cobro_tienda_anulado` |
| `wallet_origen_tipo` | **13** | …, `pago_por_cuenta_tienda`, `aporte_capital`, `cobro_manual_reclasificado`, `cobro_tienda`, `cobro_tienda_completado` |
| `historial_accion_tipo` | **61** en `dev` (prod: 52 el 2026-09-24 + lo que lleve la release) | …, `cobro_tienda_anulado`, `wallet_movimiento_manual_anulado` |
| `historial_accion_entidad` | **23** | …, `wallet_tienda_movimiento`, `pago_por_cuenta_tienda`, `aporte_capital` |

Los dos CHECK tipo↔categoría vigentes son los de
`db/migrations/20260926120100_cobro_tienda_461_anulacion_y_checks/migration.sql:40-63`: caja 12
ingresos + 11 egresos; tienda 4 créditos + 10 débitos (listas literales en §3.3). Las columnas
`clave_idempotencia` (UNIQUE, nullable) de los dos libros vienen de `20260926120400_…`; no las usa esta
ficha (el pago tiene documento y la clave vive en él, como el pago de un gasto).

Conteos que los tests fijan hoy y que esta ficha mueve: `HISTORIAL_ACCION_TIPOS` **61 → 63**,
`accionesDeCategoria("mueve_dinero")` **39 → 41**, `HISTORIAL_ACCION_ENTIDADES` **23 → 24**
(`tests/unit/historial-accion/catalogo-y-choke-point.test.ts:92-94,424,454`); `dinero_en_caja` **23 →
25** y su diferencia con `ganancia_ordenex` **7 → 9** categorías, la lista literal de terceros **5 → 7**
(`tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts:95-101,447,477-485`);
`ganancia_ordenex` sigue en **16**; `egresos` sigue en **10**; `WALLET_INGRESO_PROPIO_SEED` **8** y
`WALLET_EGRESO_NOMBRADO_SEED` **3** no cambian (las dos categorías nuevas son terceros).

### 1.2 Las piezas que se REUTILIZAN, con su ubicación real

| Pieza | Dónde (461) | Uso aquí |
| --- | --- | --- |
| Candado de la tienda | `LiquidacionPagoRepository.bloquearBeneficiario` (`:168-179`, `SELECT "id" FROM "usuario" WHERE "id" = $1 FOR UPDATE`) | R16/R38, inyectado como `Pick<ILiquidacionPagoRepository, "bloquearBeneficiario">` |
| Saldo derivado | `IWalletTiendaMovimientoRepository.agregarSaldoPorTienda` + `derivarSaldoTienda` | tope y saldo resultante |
| Fechas | `medianocheUtcDelDia` (`lib/utils/descripcion-pago.ts:82`) para el `@db.Date`; `inicioDelDiaCREnUtc` (`lib/utils/fecha-cr.ts`) para los asientos (461 T2, `LiquidacionService.ts:685,700,770`) | R20/R32 |
| Borde | `montoLiquidacionSchema`, `fechaPagoSchema`, `LIQUIDACION_REFERENCIA_MAX` (`lib/types/liquidacion.ts:73-116`), `METODO_PAGO_SEED`, `claveIdempotenciaSchema` (`lib/types/wallet.ts`, 461), `comprobanteSchema` y `ArchivoComprobanteLike` (`lib/types/pago-por-cuenta-tienda.ts:24-51`) | R4–R9, R13, R26 |
| Comprobante | `lib/config/wallet-comprobante.ts`, `lib/utils/comprobante.ts` (`problemaDeComprobante`, `rutaDeComprobante`, `PREFIJO_COMPROBANTE`), `BUCKETS.WALLET_COMPROBANTES`, `SupabaseFileStorage`, `SupabaseSignedUrlProvider`, `compensarEvidencias` | R26–R30, R42–R44 |
| Descripción del método | `descripcionDePago(metodo, referencia)` (`descripcion-pago.ts:41`) | R21 |
| P2002 | `esP2002`, `textoConstraintP2002` (`lib/repositories/_shared/prisma-unique.ts`) | clave repetida / ya anulado |
| Historial | `appendAccion`, `resolverActorCongelado` (`lib/repositories/registrar-accion.ts`); `etiquetaDeEntidad`, `etiquetaDePersona` | R61–R63 |
| `documento` en el libro | `WalletService.tipoDeDocumentoOriginal` (`:65-89`), `LectoresDocumentosCaja` (`IWalletService.ts:98-113`), `DocumentoCajaAcciones.ACCIONES` (`:73-102`) | R41 |
| Diálogo | `RegistrarMovimientoCajaDialog.tsx` (ocho conceptos tras esta ficha), `wallet-conceptos-manuales.ts` | R54–R58 |
| Desglose | `PagoTiendaAcciones.tsx` (hueco `acciones` del desglose; refresco dirigido con `esClaveSaldosTiendas`) | R59 |
| `down` de enums | `pg_temp.quitar_valores_de_enum_461` (`20260926120000_cobro_tienda_461_enums/down.sql:39-150`) | R75, copiada byte a byte con sufijo `_457` |

Molde principal, línea a línea: `lib/services/PagoPorCuentaTiendaService.ts` (`:93-327`),
`lib/repositories/PagoPorCuentaTiendaRepository.ts`, `lib/actions/pago-por-cuenta-tienda.ts`,
`lib/services/CajaPagoPorCuentaFeedService.ts`, `20260925120200_pago_por_cuenta_y_capital/migration.sql`.

### 1.3 Producción (foto del 2026-09-24, `progress/medicion_457.md`; se re-mide en §14)

Nuform, activa, saldo **−6.170.666,55** (1.285 movimientos). Los 203 `cobro_manual` (25.769.034,50)
son los que la 459 reclasifica al desplegar: **no cambian el saldo de la tienda** (la reclasificación
escribe en la caja, no en el libro de la tienda), así que la deuda que esta ficha va a cobrar sigue
siendo ≈ 6,17 M salvo movimientos posteriores. `liquidacion_pago` hacia tiendas: 0. `abono_tienda`
no existe. El bucket `wallet-comprobantes` **no existía**; su creación en preview y prod es un paso
previo del despliegue de la 459 (`feature_list.json`, ficha 459: «ANTES DE DESPLEGAR»).

## 2. Los nombres (HD3 de la 461; reservados en su §7.8 y en la guardia `nombres-wallet-461`)

| Superficie | Diccionario | Clave | Texto |
| --- | --- | --- | --- |
| Caja: tabla, filtro, descarga | `CATEGORIA_LABEL` | `ingreso_abono_tienda` | **Una tienda le paga a Ordenex** |
| | | `egreso_reverso_abono_tienda` | **Pago de una tienda a Ordenex anulado** |
| Caja: origen | `ORIGEN_LABEL` | `abono_tienda` | **Pago de una tienda a Ordenex** |
| Caja: dueño | `DUENO_LABEL` | `terceros` | «Tienda» (existe) |
| Caja: diálogo de anulación | `DOCUMENTO_CAJA_NOMBRE` | `abono_tienda` | «el pago de una tienda a Ordenex» |
| `/wallet/tiendas`: tabla, filtro, descarga | `CATEGORIA_TIENDA_LABEL` (`desglose-tienda-labels.ts`) | `abono_tienda` | **La tienda le paga a Ordenex** |
| | | `abono_tienda_anulado` | **Pago de la tienda a Ordenex anulado** |
| `/wallet/tiendas` y `/mi-wallet`: origen | `ORIGEN_TIENDA_LABEL` (`mi-wallet-labels.ts`) | `abono_tienda` | **Pago de una tienda a Ordenex** |
| `/mi-wallet`: tabla, filtro, descarga | `CATEGORIA_MI_WALLET_LABEL` | `abono_tienda` | **Le pagaste a Ordenex** |
| | | `abono_tienda_anulado` | **Ordenex anuló el pago que le hiciste** |
| Diálogo: concepto | `CONCEPTOS_MANUALES[].label` | `abono_tienda` | **Una tienda le paga a Ordenex** |
| Diálogo: grupo | `GRUPO_CONCEPTO_LABEL.entra` | | «Llega dinero a la caja» (existe) |
| Desglose: botón | `ABONO_TIENDA_TEXTO.abrir` (nuevo en `PagoTiendaAcciones.tsx`) | | **Registrar pago de la tienda a Ordenex** |
| Historial: tipos | `ACCION_LABELS` | `abono_tienda_registrado` | «Registró un pago de una tienda a Ordenex» |
| | | `abono_tienda_anulado` | «Anuló un pago de una tienda a Ordenex» |
| Historial: entidad | `ENTIDAD_LABELS` | `abono_tienda` | «Pago de una tienda a Ordenex» |

Pistas de cabecera (R50): `/mi-wallet` `aFavorHint` → «Lo cobrado a tus clientes, las correcciones a
tu favor, lo que le pagaste a Ordenex y lo que Ordenex te devolvió al anular»; `cargosHint` → «Fletes,
comisión, IVA, lo que Ordenex te cobró y los pagos a Ordenex que se anularon». `/wallet/tiendas`
`aFavorHint` → «Contra-entrega cobrado, correcciones a favor, pagos de la tienda a Ordenex y
devoluciones por anulaciones»; `cargosHint` → «Fletes, comisión, IVA, los cobros de Ordenex a la
tienda y sus pagos a Ordenex anulados».

**La guardia `tests/unit/guards/nombres-wallet-461.guardia.test.ts`** hoy prohíbe estos textos
(`NOMBRES_RESERVADOS_457`, `:91-97`, dentro de `PROHIBIDOS`). Esta ficha la cambia a conciencia
(R53): los cuatro reservados que se toman salen de `PROHIBIDOS` y entran en una lista
`NOMBRES_TOMADOS_457` con un caso nuevo que exige que cada uno sea el valor de **exactamente** la clave
de esta tabla y de ninguna otra; el quinto («Pago a Ordenex anulado», sin uso: D10) se retira de la
lista. Las contrapruebas que hoy usan «Una tienda le paga a Ordenex» y «Le pagaste a Ordenex» como
prohibidos (`:222,281,332`) se reescriben con un reservado ficticio. Los retirados (`NOMBRES_RETIRADOS_461`,
`FRASES_RETIRADAS_461`) no se tocan y siguen vigilando `app/(app)/wallet/**`, `app/(app)/mi-wallet/**`,
`lib/types/historial-accion*.ts` y `docs/ayuda/**`.

## 3. Modelo de datos y migraciones

### 3.1 `abono_tienda` (documento, INMUTABLE: sin `updated_at` ni `deleted_at`)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | text PK | uuid generado por el servicio (molde `pago_por_cuenta_tienda`) |
| `clave_idempotencia` | text NOT NULL **UNIQUE** | la genera el diálogo al abrirse (R13/R25) |
| `tienda_id` | text NOT NULL FK → `usuario(id)` RESTRICT | quién paga |
| `monto` | decimal(12,2) | CHECK `monto > 0` |
| `metodo` | `metodo_pago_value` | enum EXISTENTE (`efectivo`/`SINPE`/`transferencia`); no se toca |
| `referencia` | text NULL | obligatoria si método ≠ efectivo (en el borde, como la 172) |
| `motivo` | text NOT NULL | CHECK `btrim(motivo) <> ''`; tope 200 en el borde |
| `fecha_pago` | date NOT NULL | fecha REAL del pago |
| `comprobante_path`, `comprobante_content_type` | text NULL | CHECK `(path IS NULL) = (content_type IS NULL)` |
| `registrado_por` | text NOT NULL FK → `usuario(id)` RESTRICT | |
| `created_at` | timestamp(3) DEFAULT now() | instante del registro |

Índice `(tienda_id, fecha_pago)`. **Solo dos restricciones únicas** (PK y clave), premisa escrita en el
comentario del modelo: el repositorio trata un P2002 sin pista como choque de clave (§6.2).

### 3.2 `abono_tienda_anulacion` (INMUTABLE)

`id` text PK · `abono_id` text NOT NULL FK → `abono_tienda(id)` **UNIQUE** RESTRICT · `motivo` text NOT
NULL CHECK `btrim <> ''` · `anulado_por` FK → `usuario(id)` RESTRICT · `created_at`. «Anulado» se deriva
de que exista la fila. RLS habilitada sin policies en las dos (R76).

### 3.3 Enums nuevos y los dos CHECK (listas EXACTAS de partida = las de la 461)

Valores: `wallet_movimiento_categoria` + `ingreso_abono_tienda`, `egreso_reverso_abono_tienda`;
`wallet_tienda_movimiento_categoria` + `abono_tienda`, `abono_tienda_anulado`; `wallet_origen_tipo` +
`abono_tienda`; `historial_accion_tipo` + `abono_tienda_registrado`, `abono_tienda_anulado`;
`historial_accion_entidad` + `abono_tienda`. Todos con `ALTER TYPE … ADD VALUE IF NOT EXISTS`.

Por qué no se reutiliza ninguno existente: `ajuste_credito` es el contra-asiento del pago a tienda;
`cobro_tienda_anulado` y `pago_por_cuenta_anulado` son anulaciones de otros documentos; `ingreso_ajuste`
es PROPIO (subiría la ganancia, contra DH1); `ingreso_cod_recaudado` lo lee `CajaCodFeedService`;
`ingreso_reverso_*` son reversos; `egreso_pago_tienda` significa «salió hacia una tienda» y lo cuenta
`egresos`. El prefijo `ingreso_`/`egreso_` es obligatorio: `esCategoriaDeEgreso` y la guardia de la
invariante deducen el tipo del prefijo.

```sql
-- caja (partida: 20260926120100_cobro_tienda_461_anulacion_y_checks/migration.sql:41-53) + los dos de la 457
("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
   'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
   'ingreso_cod_recaudado','ingreso_reverso_pago_tienda','ingreso_reverso_pago_por_cuenta_tienda',
   'ingreso_aporte_capital','ingreso_cobro_tienda',
   'ingreso_abono_tienda'))                                                     -- 13
OR ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
   'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
   'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital','egreso_reverso_cobro_tienda',
   'egreso_reverso_abono_tienda'))                                              -- 12
-- tienda (partida: idem :57-63) + los dos de la 457
("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado',
   'cobro_tienda_anulado','abono_tienda'))                                      -- 5
OR ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
   'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta',
   'abono_tienda_anulado'))                                                     -- 11
```

Siguen siendo DISYUNCIÓN DE LISTAS CERRADAS. **Las listas se miden antes de escribir** (M4 de §14 en
local y en producción): si otra ficha las amplió entre medias, se parte de la vigente, no de este texto.

### 3.4 Las migraciones (a mano: `db:migrate:create` falla con P3006). **[2026-09-25] Dos, no tres**

Timestamps **posteriores** al último de `origin/dev` el día que se escriban (hoy el último conocido es
`20260926120500_wallet_461_fechas_cr_pagos`; mirar `origin/dev`: colisión de ids entre sesiones).
Propuestos: `20260927120000_abono_tienda_457_enums` y `20260927120100_abono_tienda_457_tablas_y_checks`.
El reparto es obligatorio: Postgres prohíbe USAR un valor de enum en la transacción que lo añade
(55P04) y los CHECK nombran los valores nuevos.

1. **`…_457_enums`** — los ocho `ADD VALUE IF NOT EXISTS` sobre los cinco tipos (la 461 ya metió los
   del historial en la misma migración que los de la wallet, con el `down` dinámico: mismo reparto).
   **`down.sql`:** `pg_temp.quitar_valores_de_enum_457`, la función de
   `20260926120000_cobro_tienda_461_enums/down.sql:39-150` copiada **byte a byte** salvo el sufijo
   (el test de migración lo exige, como hizo el de la 461), aplicada a los cinco tipos con sus valores.
   Ya cubre la precondición ruidosa (una fila con un valor → RAISE sin borrar), los CHECK e índices que
   nombran el tipo por texto y los DEFAULT; lee `pg_enum` y por eso vale igual en `prod` y en `dev`
   (R75). Ningún `down.sql` previo se toca.
2. **`…_457_tablas_y_checks`** — las dos tablas (DDL de `prisma migrate diff`), índices, FKs RESTRICT,
   CHECK del documento, RLS, y los dos CHECK tipo↔categoría recreados como AMPLIACIÓN (§3.3).
   **`down.sql`:** `DO` que hace RAISE si `abono_tienda` tiene filas o si algún movimiento de los dos
   libros usa una categoría de esta ficha; los dos CHECK vuelven a las listas de la 461; `DROP TABLE`
   de las dos. Se revierte ANTES que la 1 (los downs corren del más nuevo al más viejo), así que la 1
   no encuentra ningún CHECK que nombre sus valores.

`db/schema.prisma`: enums, modelos `AbonoTienda` y `AbonoTiendaAnulacion` (relaciones `tienda`,
`registrador`, `anulacion`, `anulador`) e inversas en `Usuario`. Sin drift (procedimiento de la 381).
Tocar migraciones y `schema.prisma` obliga al gate COMPLETO.

`tests/integration/db/abono-tienda-457-migration.test.ts` (molde `cobro-tienda-461-migration.test.ts`):
enums valor a valor contra el estado previo reconstruido; los CHECK rechazan los pares invertidos
(23514: `debito`+`abono_tienda`, `ingreso`+`egreso_reverso_abono_tienda`…); RLS activa en las dos;
`TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK; la función del `down` es la de la 461 salvo sufijo;
`down` con un abono presente falla sin borrar; sin abonos devuelve catálogos, CHECK y tablas al estado
previo. Y los censos de migraciones POSTERIORES que otros tests llevan a mano (los que la 461 tuvo que
alinear: `orden-traspaso-migration`, `caja-459-migration`, `wallet-tienda-cobro-migration`,
`liquidacion-migration`, `orden-incidente-migration`, `premio-ranking-devengo-migration`,
`caja-tesoreria-migration` 23→25, `cobro-tienda-461-migration`, `wallet-461-migration`) ganan las dos
carpetas de esta ficha: se localizan con `grep 20260926120500 tests/`.

## 4. Clasificación (TODOS los `Record` totales y las listas a mano)

| Categoría | Libro / tipo | `NATURALEZA` | `LIQUIDEZ` | `CUBETA` | `CONTRAPARTIDA_EN_CAJA` | `TIPO_POR_CATEGORIA_TIENDA` | `FUENTE_*` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ingreso_abono_tienda` | caja / ingreso | **terceros** | **efectivo** | — | — | — | `sin_reparto / no_nace_de_un_cierre` |
| `egreso_reverso_abono_tienda` | caja / egreso | **terceros** | **efectivo** | — | — | — | idem |
| `abono_tienda` | tienda / crédito | — | — | `aFavor` | `ingreso_abono_tienda` | `credito` | idem |
| `abono_tienda_anulado` | tienda / débito | — | — | `cargos` | `egreso_reverso_abono_tienda` | `debito` | idem |

### 4.1 Qué le pasa a cada cifra (derivación de `caja-tesoreria.ts:293-322` de la 461)

| | Entró | Salió | Cifra principal | Ganancia | «De las tiendas» | Capital | Saldo tienda |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Registrar un pago de M | **+M** | 0 | **+M** | 0 | **+M** | 0 | **+M** |
| Anularlo | 0 | **+M** | **−M** | 0 | **−M** | 0 | **−M** |

R7 por construcción: al registrar, G + (T + M) + C = (Entró + M) − Salió. R8: Σ saldos + M
(crédito `abono_tienda`) = T + M (ingreso terceros efectivo). Al anular, los dos lados bajan M. Es la
misma pareja «efectivo de terceros» que `cod_recaudado ↔ ingreso_cod_recaudado` y
`pago_por_cuenta_anulado ↔ ingreso_reverso_pago_por_cuenta_tienda`.

**Por qué DH1 es coherente con la caja de hoy [2026-09-25].** Una tienda con saldo en contra es una a
la que Ordenex ya le cobró (fletes, comisión, IVA, cobros: todos «cargos» que subieron la ganancia y
bajaron «De las tiendas» sin mover efectivo) más de lo que le recaudó. Cuando paga, ese dinero entra al
mismo bolsillo por el que habría entrado su contra-entrega: terceros efectivo. La ganancia no cambia (ya
se contó); cambian «Entró», la cifra principal y «De las tiendas». El aviso de la tarjeta
(`CAJA_RESUMEN_AVISO_TERCEROS`, 461) ya dice «es la suma de los saldos de todas las tiendas»: sigue siendo
cierto al céntimo.

### 4.2 Lo que se toca (el compilador obliga en los marcados con *; el resto lleva test propio)

- `lib/types/wallet.ts` — `WALLET_MOVIMIENTO_CATEGORIA_SEED`*, `WALLET_ORIGEN_TIPO_SEED`*,
  `DocumentoCajaDTO.tipo`* (+`"abono_tienda"`). `WALLET_INGRESO_PROPIO_SEED`, `WALLET_EGRESO_NOMBRADO_SEED`,
  `WALLET_INGRESO_CONCEPTO_SEED`: **sin cambio**.
- `lib/types/wallet-tienda.ts` — `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`*.
- `lib/utils/caja-tesoreria.ts` — `NATURALEZA_POR_CATEGORIA`*, `LIQUIDEZ_POR_CATEGORIA`*. `acumular`,
  `derivarCaja`, `derivarComposicionGanancia`: **ni una línea**.
- `lib/utils/invariante-tiendas.ts` — `TIPO_POR_CATEGORIA_TIENDA`*, `CONTRAPARTIDA_EN_CAJA`*.
- `lib/utils/desglose-tienda.ts` — `CUBETA_POR_CATEGORIA`*. `lib/utils/aporte-por-orden.ts` —
  `FUENTE_CAJA`*, `FUENTE_TIENDA`*.
- `lib/utils/finanzas-diarias.ts` — **sin cambio** de código: `ingresos`/`salidas` del día son efectivo y
  el abono y su reverso lo son; test con un caso (R19/R39).
- `lib/analytics/metrics.ts` — `dinero_en_caja` (+2 → 25, descripción); `cuenta_por_pagar_tienda`
  (+`abono_tienda`, +`abono_tienda_anulado`: es `string[]`, el compilador no obliga); `ganancia_ordenex`
  y `egresos` **no** (R52, D11).
- `lib/utils/comprobante.ts` — `PREFIJO_COMPROBANTE.abono_tienda = "abonos-tienda"`*.
- `lib/types/historial-accion.ts` y `historial-accion-etiquetas.ts` — §9.
- `app/(app)/wallet/_components/wallet-labels.ts` — `CATEGORIA_LABEL`*, `ORIGEN_LABEL`*,
  `DOCUMENTO_CAJA_NOMBRE`*. `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts` —
  `CATEGORIA_TIENDA_LABEL`*, pistas. `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` —
  `CATEGORIA_MI_WALLET_LABEL`*, **`ORIGEN_TIENDA_LABEL` (es `Record<string,string>` con caída al valor
  crudo: el compilador NO avisa; sin la clave, tabla y descargas pintarían `abono_tienda`)**, pistas.
- `app/(app)/wallet/_components/wallet-conceptos-manuales.ts`, `RegistrarMovimientoCajaDialog.tsx`,
  `DocumentoCajaAcciones.tsx`, `app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx` — §8.
- `lib/services/WalletService.ts` (`tipoDeDocumentoOriginal`, `conDocumentos`),
  `lib/interfaces/services/IWalletService.ts` (`LectoresDocumentosCaja.abonos`), `lib/actions/wallet.ts`
  (composition root de `WalletService`: inyecta `AbonoTiendaRepository` como lector `abonos`) — §8.3.

### 4.3 La guardia de la invariante (`tests/unit/guards/caja-clasificacion-459.guardia.test.ts`, versión 461)

Sus literales **no cambian**: sin contrapartida sigue siendo `["ajuste_debito"]` (la afirmación (1) y
su `it` «literal del contrato») y los cargos siguen siendo ocho. Las afirmaciones (2) y (3) recorren el seed y validan las dos parejas nuevas
solas. Se añade una **contraprueba** (R24): una copia con `ingreso_abono_tienda: "propio"` tiene que
producir `abono_tienda (1) ↔ ingreso_abono_tienda (0): no mueven igual` —es DH1 convertida en algo que
se rompe—, y otra con `LIQUIDEZ.ingreso_abono_tienda = "cargo_a_tienda"` tiene que producir
`cargos a tienda = […]` distinto de los ocho.

## 5. Servicio `AbonoTiendaService` (molde `PagoPorCuentaTiendaService`, línea a línea)

```ts
constructor(
  abonoRepo: IAbonoTiendaRepository,
  tiendaRepo: Pick<IWalletTiendaMovimientoRepository, "crearMovimientos" | "agregarSaldoPorTienda">,
  candado: Pick<ILiquidacionPagoRepository, "bloquearBeneficiario">,   // R16: EL MISMO candado
  usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
  caja: ICajaAbonoTiendaFeedService,                                    // obligatorio: sin caja no se construye (R65)
  comprobantes: IFileStorage,
  urls: ISignedUrlProvider,
  runTransaction: AbonoTiendaTxRunner,
  ahora: () => Date = () => new Date(),
  config: Pick<WalletComprobanteConfig, "MAX_BYTES" | "SIGNED_URL_TTL_SECONDS"> = walletComprobanteConfig,
)
```

### 5.1 `registrar(input, comprobante | null, actor)` — el orden es parte del requisito

> **Actualizado el 2026-09-26 (m4 de la revisión; el código ya iba así desde `6fe2acd0`):** la CLAVE
> se mira **antes** de la regla del dinero (paso 3b) y **otra vez** si la regla rechaza bajo el candado
> (paso 8). Con el orden original —la clave solo al final (paso 13)— el reenvío de un pago que ya salda
> la deuda (el doble clic del §17.4) respondía `sin_deuda`/`excede` sobre un pago que SÍ quedó (medido:
> la integración «R25» daba `excede`). La lectura por clave no escribe, va detrás del rol (R2 intacto) y
> no sube archivo. Y el saldo del paso 8 se lee por la MISMA transacción que tomó el candado (m3).

1. **Rol** (`esAccesoTotal`) antes de leer nada → `forbidden` (R2).
2. **Escala 2 una vez**: `montoStr` (R5). El MISMO string va a las cuatro escrituras.
3. **Tienda** (`obtenerCuentaTienda`): inexistente / no `adminTienda` → `validation_error` bajo
   `tiendaId` (R10). El estado **no** se exige (R11, D2): los mensajes `inexistente` y `rol` son los de
   `PagoPorCuentaTiendaService.ts:48-52`; el de `inactiva` no se usa.
3b. **Clave** (`abonoRepo.obtenerPorClave`, sin candado ni transacción): si ya tiene documento →
   `ya_registrado` con el pago ORIGINAL y el saldo de SU tienda (R25), sin subir el archivo ni evaluar la
   regla del dinero.
4. **Pre-chequeo optimista** del saldo SIN candado: si ya es ≥ 0 o el monto excede, se responde sin
   subir el archivo (ahorra subidas inútiles). No sustituye al paso 7.
5. **Comprobante** (si viene): `problemaDeComprobante` → `validation_error` bajo `comprobante` (R26);
   `upload({ path: rutaDeComprobante("abono_tienda", contentType), … })`; fallo →
   `comprobante_no_guardado`, nada escrito (R27/R28).
6. **Fechas [2026-09-25]:** `fechaPago = medianocheUtcDelDia(input.fechaPago)` (el `@db.Date`);
   `fechaMovimiento = inicioDelDiaCREnUtc(input.fechaPago)` para el crédito y para el ingreso (R20; 461
   T2/R73: a 00:00Z el rollup diario los contaba el día anterior).
7. `runTransaction`: `candado.bloquearBeneficiario(tx, { tipo: "tienda", tiendaId })` — la MISMA fila
   `usuario` que bloquean `registrarPagoTienda` (`LiquidacionService.ts:638`) y
   `PagoPorCuentaTiendaService.registrar` (`:179`) (R16).
8. Saldo bajo candado: `derivarSaldoTienda(agregarSaldoPorTienda(tiendaId, {}, tx))` —por el `tx` del
   candado, no por otra conexión del pool (m3)—. `saldo >= 0` → `sin_deuda` (R14). `monto > |saldo|` →
   `excede { deuda: |saldo| }` (R15). Los dos salen de la transacción sin escribir; ANTES de responderlos
   se vuelve a mirar la clave: si ya tiene documento (dos envíos SIMULTÁNEOS de la misma clave: el
   segundo esperó el candado y ve el saldo que dejó el primero) → `ya_registrado` (R25).
9. `abonoRepo.crear(tx, …)` → documento + fila de historial `abono_tienda_registrado` en el MISMO
   método (censo de la guardia, §9). `clave_repetida` → `ClaveRepetidaError` para salir de la transacción.
10. `tiendaRepo.crearMovimientos(tx, [{ tiendaId, tipo: "credito", categoria: "abono_tienda", origenTipo:
    "abono_tienda", origenId: id, monto: montoStr, descripcion: descripcionAbonoEnTienda(datos),
    registradoPor, fechaMovimiento }])` (R17, R20, R21).
11. `caja.emitirIngresoDeAbono(tx, { abonoId: id, monto: montoStr, descripcion:
    descripcionAbonoEnCaja(creado.abono.tiendaNombre, datos), registradoPor, fechaMovimiento })` (R17, R19).
12. `ok { abono: DTO, saldo }` con el saldo derivado DESPUÉS (R18).
13. Fuera de la transacción (`finally`): ante CUALQUIER desenlace distinto de `ok`,
    `compensarEvidencias(storage, [ruta])` (R29); si fue clave repetida, `ya_registrado` releyendo por
    clave, con el saldo de la tienda DEL DOCUMENTO original (R25).

### 5.2 `anular({ abonoId, motivo }, actor)`

Rol (R37) → `abonoRepo.obtenerPorId` FUERA (inmutable; hace falta la tienda para el candado) →
`no_encontrado` → `instante = inicioDelDiaCREnUtc(fechaCalendarioCR(this.ahora()))` (R32; el mismo
criterio que `LiquidacionService.anularPago`, `:770`) → transacción: candado de la tienda (R38) →
`abonoRepo.anular(tx, …)` (constancia + historial `abono_tienda_anulado`; choque del UNIQUE →
`YaAnuladoError` → `ya_anulado`, R36) → débito `abono_tienda_anulado` por `abono.monto` (DEL
DOCUMENTO, R34) con origen `(abono_tienda, abono.id)` —idempotente por
`wallet_tienda_movimiento_origen_uq`— → `caja.emitirReversoDeAbono(tx, …)` (`egreso_reverso_abono_tienda`,
mismo origen) → `ok { saldo }` (puede ser negativo, R38). El comprobante NO se toca (R33).

### 5.3 `obtenerComprobante(abonoId, actor)`

Copia de `PagoPorCuentaTiendaService.obtenerComprobante` (`:308-321`): acceso total → cualquiera;
`adminTienda` → solo si `abono.tiendaId === actor.usuarioId`, si no `no_encontrado` (R42/R43); sin
comprobante → `sin_comprobante` (R44); `urls.createSignedUrl(path, SIGNED_URL_TTL_SECONDS)`.

### 5.4 Descripciones puras (`lib/utils/descripcion-abono.ts`, molde `descripcion-pago-por-cuenta.ts`)

- Libro de tienda: `descripcionAbonoEnTienda({ motivo, metodo, referencia })` →
  `«{motivo} · {Método}[ · {referencia}]»` (con `descripcionDePago`).
- Caja: `descripcionAbonoEnCaja(tiendaNombre, datos)` → `«{Tienda} · {motivo} · {Método}[ · {ref}]»`.
- Anulación: `descripcionAnulacionAbono(original)` → `«Anulación · {original}»`. El motivo de la
  anulación NO entra (vive en su tabla). Ninguna lleva identificadores; test con regex de uuid (R21).

## 6. Puerto de caja y repositorio

### 6.1 `CajaAbonoTiendaFeedService` (molde exacto `CajaPagoPorCuentaFeedService.ts`)

Dos métodos con tipo, categoría y origen como **literales** dentro de la clase:
`emitirIngresoDeAbono` → `ingreso / ingreso_abono_tienda / abono_tienda`; `emitirReversoDeAbono` →
`egreso / egreso_reverso_abono_tienda / abono_tienda`. Las dos filas comparten `(abono_tienda, abonoId)`
y se distinguen por la categoría: `wallet_movimiento_origen_categoria_uq` las hace idempotentes. Las
guardias de la 173 que fijan la lista exacta de `CajaPagoTiendaFeedService` no se tocan.

### 6.2 `AbonoTiendaRepository` (molde `PagoPorCuentaTiendaRepository.ts`)

`crear(tx, …)` (documento + `appendAccion` `abono_tienda_registrado`, entidad `abono_tienda`, etiqueta
`etiquetaDeEntidad("abono_tienda", { tiendaNombre })`, `monto` = `row.monto` Decimal; P2002 sin pista o
con `clave_idempotencia` → `{ status: "clave_repetida" }`) · `anular(tx, …)` (constancia + `appendAccion`
`abono_tienda_anulado`; P2002 → `ya_anulado`) · `obtenerPorClave` · `obtenerPorId` ·
`estadoDeDocumentos(ids)` → `{ id, anulado, tieneComprobante }` (para el libro, §8.3). Un tipo de
historial por método: la guardia del censo mide POR MÉTODO.

## 7. Server Actions y contratos (`lib/actions/abono-tienda.ts`, archivo NUEVO)

Archivo nuevo y no `liquidacion.ts`/`wallet-tienda.ts` (tests de lista exacta de exportaciones). Molde:
`lib/actions/pago-por-cuenta-tienda.ts` entero (`buildService`, `crudoDelFormData`, `leerComprobante`,
`toActionError`). `buildService()` inyecta el puerto de caja REAL, `LiquidacionPagoRepository` (el
candado), `SupabaseFileStorage(undefined, walletComprobanteConfig.BUCKET)` y
`SupabaseSignedUrlProvider(...)`. Un test de integración pasa POR LA ACTION y encuentra las cuatro
filas en Postgres (el composition root que no inyecta ya costó 2 de 7 notificadores).

| Acción | Entrada | Salida (`status`) |
| --- | --- | --- |
| `registrarAbonoTiendaAction(formData)` | `claveIdempotencia` uuid, `tiendaId` uuid, `monto` string, `metodo` (`METODO_PAGO_SEED`), `referencia?`, `motivo`, `fechaPago` (YYYY-MM-DD), `comprobante?` File | `ok {abono, saldo}` · `ya_registrado {abono, saldo}` · `sin_deuda` · `excede {deuda}` · `comprobante_no_guardado` · `forbidden` · `validation_error {fieldErrors}` · `unauthenticated` |
| `anularAbonoTiendaAction({ abonoId, motivo })` `.strict()` | sin monto (R34) | `ok {saldo}` · `ya_anulado` · `no_encontrado` · `forbidden` · `validation_error` · `unauthenticated` |
| `obtenerComprobanteAbonoAction({ abonoId })` `.strict()` | acceso total o tienda dueña | `ok {url}` · `sin_comprobante` · `no_encontrado` · `forbidden` · `validation_error` · `unauthenticated` (reusa `ObtenerComprobanteResult` de `pago-por-cuenta-tienda.ts`) |

**Schemas (`lib/types/abono-tienda.ts`):** `registrarAbonoTiendaSchema = z.object({ claveIdempotencia:
claveIdempotenciaSchema, tiendaId: uuid, monto: montoLiquidacionSchema, metodo: z.enum(METODO_PAGO_SEED),
referencia: trim().max(LIQUIDACION_REFERENCIA_MAX).optional(), motivo: trim().min(1).max(200), fechaPago:
fechaPagoSchema, comprobante: comprobanteSchema.optional() }).strict().superRefine(referencia en
SINPE/transferencia)` (R4–R9, R12, R13; D3: sin ventana hacia atrás). `anularAbonoTiendaSchema` y
`obtenerComprobanteAbonoSchema` `.strict()`.

**`AbonoTiendaDTO`** = `{ id, tiendaNombre, monto, metodo, referencia, motivo, fechaPago,
registradoPorNombre, registradoAt, anulado, tieneComprobante }`. Sin `tiendaId`, sin ids de usuario, sin
clave, sin ruta (R48). `saldo` = `SaldoTiendaDTO`; `deuda` = STRING escala 2. Montos SIEMPRE string.
`tests/unit/descarga/columnas-sensibles.guardia.test.ts` debe seguir verde.

## 8. La UI mínima (DH6, acotada el 2026-09-25)

### 8.1 El catálogo (`wallet-conceptos-manuales.ts`) — de siete a **ocho** conceptos

`CONCEPTO_MANUAL_IDS` = `gasto_variable, sueldo, pago_por_cuenta_tienda, ajuste_egreso, aporte_capital,
abono_tienda, ajuste_ingreso, cobro_tienda` (tres tramos consecutivos; el grupo «Llega dinero a la
caja» queda «Aporte de dinero a la caja · Una tienda le paga a Ordenex · Corrección de caja (suma)»).
`DestinoConcepto` gana la rama `{ clase: "abono_tienda"; categoria: "ingreso_abono_tienda";
categoriaTienda: "abono_tienda" }` (la unión discriminada obliga al diálogo a enrutarla).
`libroDelConcepto` → `caja_y_tienda`; `nombreEnElLibroDeLaTienda` incluye la clase;
`cabeceraDelConcepto` → título = el nombre del concepto, descripción «Elegí la tienda, el monto, la
fecha real y el método. Solo se admite si la tienda tiene saldo en contra y hasta lo que debe. El pago
no se edita: si hay un error, se anula desde el libro de la caja con un motivo.» `descripcionLabel`
«Motivo del pago»; placeholder «Ej. Pago de lo que debía por los fletes de septiembre».

### 8.2 La frase de efecto (R55), UNA línea

`FRASE_DEL_EFECTO.abono_tienda` = **«Llega dinero de la tienda a la caja: paga lo que debe y su saldo
sube; la ganancia de Ordenex no cambia.»** La frase del libro sale sola de `FRASE_DEL_LIBRO.caja_y_tienda`:
«Se registra en la caja como «Una tienda le paga a Ordenex» y en el libro de la tienda como «La tienda le
paga a Ordenex».» (R57).

### 8.3 El diálogo (`RegistrarMovimientoCajaDialog.tsx`)

- Estado nuevo: ninguno (reutiliza `tiendaId`, `metodo`, `referencia`, `comprobante`, `clave`).
  Derivados: `esAbono`; `pideTienda = esCobro || esPagoPorCuenta || esAbono`; `pideMetodo =
  esPagoPorCuenta || esAbono`; `pideReferencia = pideMetodo && metodo !== "" && metodo !== "efectivo"`;
  el comprobante se monta con `esPagoPorCuenta || esAporte || esAbono`.
- Fecha: como el aporte, sin ventana hacia atrás (`min` sin valor, `max` hoy; rechazo «no puede ser
  posterior a hoy»); viaja SIEMPRE como `fechaPago` (D3).
- `formDataAbono()` arma SOLO sus claves (R56): `claveIdempotencia`, `tiendaId`, `monto`, `metodo`,
  `referencia` (si `pideReferencia`), `motivo`, `fechaPago`, `comprobante` (si hay). Ningún otro
  `FormData`/payload cambia.
- `registrar()`: `registrarAbonoTiendaAction(formDataAbono())` → `ok` → éxito con
  `TEXTO_ABONO.registrado(res.abono.tiendaNombre, res.saldo)` (R57); `ya_registrado` → éxito con
  `TEXTO_ABONO.yaRegistrado(res.abono.tiendaNombre, res.abono.monto, res.saldo)` (m7 de la revisión,
  2026-09-26: el importe es el del pago que QUEDÓ, por si el usuario cambió la cifra antes de reintentar); `sin_deuda` →
  `validation_error { tiendaId: [TEXTO_ABONO.sinDeuda] }`; `excede` → `{ monto:
  [TEXTO_ABONO.excede(money(res.deuda))] }` (R58; el importe viene del servidor); `comprobante_no_guardado`
  → aviso general existente.
- **Textos (`TEXTO_ABONO`):** `tienda` «Tienda que paga» · `pista` «Solo se admite si la tienda tiene
  saldo en contra, y hasta lo que debe.» · `sinTienda` «Elegí la tienda que paga.» · `sinDeuda` «Esta
  tienda no tiene saldo en contra: no hay nada que pagar.» · `excede(deuda)` «La tienda debe {deuda}: el
  pago no puede superar ese importe.» · `registrado(tienda, saldo)` «Pago registrado. El saldo de
  {tienda} queda en {money(saldo.saldo)} · {SALDO_SIGNO_LABEL[saldo.signo]}.» + si `negativo` « La tienda
  todavía le debe ese dinero a Ordenex.» (R57) · `yaRegistrado(tienda, monto, saldo)` «Este pago ya
  estaba registrado, por {money(monto)}. El saldo de {tienda} queda en …» con la misma cola (m7).
- **Props nuevas (D8):** `conceptoInicial?: ConceptoManualId` (defecto: el primero del catálogo),
  `tiendaFija?: { id: string; nombre: string }` (con ella el selector de concepto queda deshabilitado en
  `conceptoInicial`, el campo de la tienda muestra el nombre sin catálogo ni SWR y `tiendaId` es el
  fijo), `etiquetaBoton?: string` (defecto «Registrar movimiento»). Sin props, el diálogo se comporta
  byte a byte como hoy: el test existente lo fija.

### 8.4 El desglose de `/wallet/tiendas` (`PagoTiendaAcciones.tsx`)

Junto al botón de pagar: cuando `signo === "negativo"`, se monta
`<RegistrarMovimientoCajaDialog conceptoInicial="abono_tienda" tiendaFija={{ id: tiendaId, nombre:
tiendaNombre }} etiquetaBoton={ABONO_TIENDA_TEXTO.abrir} onRegistrado={refrescarEstaTienda} />` con
`ABONO_TIENDA_TEXTO.abrir = "Registrar pago de la tienda a Ordenex"`. `refrescarEstaTienda` ya relee el
desglose, sus comprobantes y la tabla de saldos (`esClaveSaldosTiendas`, auditoría P1 de la 461): R59
sin una lectura más. Con saldo cero o a favor no se monta (R59). El texto `sinSaldo` del pago no cambia.

### 8.5 El libro de la caja (`documento`, R41 y R60)

`DocumentoCajaDTO.tipo` + `"abono_tienda"`. `WalletService.tipoDeDocumentoOriginal`: `categoria ===
"ingreso_abono_tienda" && origenTipo === "abono_tienda"` → `"abono_tienda"` (el reverso, mismo origen y
otra categoría, queda `null`). `LectoresDocumentosCaja.abonos` (sin valor por defecto: sin él, ninguna
fila ofrecería «Anular…»), implementado por `AbonoTiendaRepository.estadoDeDocumentos` e inyectado en el
composition root de `WalletService` (`lib/actions/wallet.ts`). `DocumentoCajaAcciones.ACCIONES.abono_tienda
= { anular: (abonoId, motivo) => anularAbonoTiendaAction({ abonoId, motivo }), comprobante: (abonoId) =>
obtenerComprobanteAbonoAction({ abonoId }) }`; `DOCUMENTO_CAJA_NOMBRE.abono_tienda`. Tras anular,
`onAnulado` → el módulo relee tarjeta, libro y composición (camino existente, R60).

## 9. Historial de acciones

- `HISTORIAL_ACCION_TIPOS` + `abono_tienda_registrado` (productor `AbonoTiendaRepository.crear`) y
  `abono_tienda_anulado` (`AbonoTiendaRepository.anular`), los dos `mueve_dinero`, en el tramo A.1 junto
  a los de la 459/461. `HISTORIAL_ACCION_ENTIDADES` + `abono_tienda` (1:1 con la tabla, criterio de la
  381/459). `ACCION_LABELS`/`ENTIDAD_LABELS`: textos de §2 (P15 de la 461: verbo en pasado con la
  persona como sujeto). `historial-accion-etiquetas.ts`: `FuentesEtiqueta.abono_tienda = { tiendaNombre:
  string | null }`, constructor `(f) => unir(f?.tiendaNombre)`.
- NO se copian motivo, referencia ni ruta (R63).
- `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`: dos entradas `recibe_tx`
  (`AbonoTiendaRepository.crear` con mutación `/tx\.abonoTienda\.create\(/`; `.anular` con
  `/tx\.abonoTiendaAnulacion\.create\(/`), molde de las de la 459 (`:336-363`).
- `catalogo-y-choke-point.test.ts:391` — `expect(HISTORIAL_ACCION_TIPOS).not.toContain("abono_tienda_registrado")`
  pasa a `toContain`, con el comentario de la reapertura (2026-09-24, ficha 457) y los conteos 63/41/24.
  Lo que ese caso protegía se conserva en la guardia de §12 (R65/R67).

## 10. Analítica, composición y finanzas diarias

`dinero_en_caja` (+2, descripción: «incluye lo que las tiendas le pagan a Ordenex y su anulación»);
`cuenta_por_pagar_tienda` (+2); `ganancia_ordenex` **no**; `egresos` **no** (D11). La composición de
la ganancia no cambia (las dos son terceros: `derivarComposicionGanancia` las salta). Finanzas por día:
el abono cuenta en `ingresos` del día (efectivo) y su reverso en `salidas`; la ganancia del día no. Las
etiquetas de las métricas no se tocan (P7 de la 461).

## 11. La ayuda y el asistente (R68/R69) — frases LITERALES que el test exige

`docs/ayuda/oficina/wallet-caja.md`: en la tabla de nombres, fila «**Una tienda le paga a Ordenex** /
**Pago de una tienda a Ordenex anulado** | Lo que una tienda con saldo en contra le paga a Ordenex, y su
anulación. Es dinero de la tienda: sube lo que Ordenex les debe a las tiendas»; en la lista de orígenes
«**Pago de una tienda a Ordenex**»; el diálogo pasa a «**ocho conceptos en tres grupos**» y la fila del
grupo a «**Llega dinero a la caja** | Aporte de dinero a la caja · Una tienda le paga a Ordenex ·
Corrección de caja (suma)»; sección nueva «## Una tienda le paga a Ordenex: llega dinero de la tienda
y su saldo sube» con «**Entró** y la cifra grande suben en el monto.», «**Lo que Ordenex les debe a las
tiendas** sube en el monto: la deuda de esa tienda baja.», «La **ganancia de Ordenex no cambia**: lo que
la tienda debía ya se contó como ganancia al aprobar cada cierre.», «Solo se admite si la tienda tiene
**saldo en contra**, y **hasta lo que debe**.», qué se pide (tienda, monto, fecha real, motivo, método
con referencia obligatoria en SINPE y transferencia, comprobante opcional), cómo sale en cada libro
(dueño **Tienda**; «La tienda le paga a Ordenex»; «Le pagaste a Ordenex») y que también se registra
desde el desglose de la tienda en **Wallet · Tiendas** («Registrar pago de la tienda a Ordenex»); en
«Anular» el punto «Al anular un pago de una tienda a Ordenex, **Salió** sube en el monto, la cifra grande
y **lo que Ordenex les debe a las tiendas** bajan en el monto —la tienda vuelve a deber— y la ganancia no
cambia. En la caja aparece **Pago de una tienda a Ordenex anulado**; en el libro de la tienda, «Pago de
la tienda a Ordenex anulado».»; en «El comprobante», «El pago de una tienda a Ordenex sí puede
llevarlo.» La lista de «pago de un gasto, aporte, cobro, corrección» que se anulan gana «un pago de una
tienda a Ordenex».

`docs/ayuda/oficina/wallet-tiendas.md`: filas «**La tienda le paga a Ordenex** | Lo que la tienda le
pagó a Ordenex cuando estaba en contra. Su saldo sube | **Sí**: entró dinero de la tienda» y «**Pago de
la tienda a Ordenex anulado** | La anulación de ese pago: el saldo vuelve a bajar | Vuelve a salir»;
sección «## Registrar un pago de la tienda a Ordenex» («Cuando una tienda está **en contra**, desde las
acciones de su desglose registrás el pago que ella le hizo a Ordenex: **Registrar pago de la tienda a
Ordenex**. Se pide el monto —hasta lo que debe—, la fecha real, el motivo, el método (con referencia en
SINPE y transferencia) y un comprobante opcional. Su saldo sube en el monto y la fila se actualiza
sola. Se anula desde **Wallet · Caja**, en el libro, con motivo.»); «Lo que esta pantalla NO hace» gana
«ni pagos de la tienda a Ordenex» en el punto de las anulaciones.

`docs/ayuda/tienda/mi-wallet.md`: en «Lo que suma a tu favor», «- **Le pagaste a Ordenex** — lo que le
pagaste a Ordenex cuando tu saldo estaba en contra.»; en «Lo que resta», «- **Ordenex anuló el pago que
le hiciste** — la anulación de un pago tuyo registrado por error: tu saldo vuelve a bajar.»; sección «##
Un pago que le hiciste a Ordenex» («Si tu saldo quedó en contra y le pagaste a Ordenex, lo ves como
**Le pagaste a Ordenex**, con el motivo, el método y la referencia. **Sube tu saldo** en el monto. Si la
oficina lo anula por error, aparece **Ordenex anuló el pago que le hiciste** y tu saldo vuelve a bajar.
El comprobante de tu pago lo guarda la oficina.»).

Frontmatter de los tres: `actualizado` (la fecha de la implementación) y `fuentes` +
`lib/services/AbonoTiendaService.ts`, `lib/utils/descripcion-abono.ts` (y en la caja
`lib/actions/abono-tienda.ts`). `tests/unit/asistente/contexto-457.test.ts` (molde
`contexto-461.test.ts`): maestro y admin reciben esas frases en `oficina/wallet-caja` y
`oficina/wallet-tiendas`; adminTienda las de `tienda/mi-wallet`; mensajero, adminTienda y adminSatelite
no reciben la caja (R69). **`contexto-461.test.ts:78`** fija el literal del grupo «Llega dinero a la
caja» con dos conceptos: se reescribe con tres, listado en `progress/impl_457.md`. Y cuatro preguntas
reales al asistente en local, como hizo la 461 (T D.2): «¿cómo registro que Nuform me pagó?», «¿sube la
ganancia si una tienda me paga?», «¿cómo anulo un pago de una tienda?», y desde la tienda «¿qué es Le
pagaste a Ordenex?».

## 12. Guardias y tests que cambian (cada literal, con su R, en `progress/impl_457.md`)

| Test | Qué cambia | R |
| --- | --- | --- |
| `catalogo-y-choke-point.test.ts` | 61→63, 39→41, 23→24; `not.toContain("abono_tienda_registrado")` → `toContain` | R61–R64 |
| `metrics-caja-naturaleza.guardia.test.ts` | terceros 5→7 (`egreso_reverso_abono_tienda`, `ingreso_abono_tienda`), `dinero_en_caja` 23→25, diferencia 7→9 | R52 |
| `caja-clasificacion-459.guardia.test.ts` | literales intactos; +2 contrapruebas (abono propio / abono cargo) | R24 |
| `caja-composicion-exhaustiva.guardia` | **sin cambio** (8/3/«otros»); se corre como comprobación | R19 |
| `mi-wallet-labels.test.ts` | `ESCRIBEN_EN_LA_TIENDA` + `abono_tienda`; los dos diccionarios difieren en `abono_tienda` y `abono_tienda_anulado`; pistas | R46, R47, R50 |
| `wallet-labels.test.ts` (461) | +2 categorías, +1 origen, +1 `DOCUMENTO_CAJA_NOMBRE` | R45 |
| `desglose-tienda-labels.test.ts`, `desglose-movimientos-tienda.test.tsx`, `desglose-tienda-descarga-columnas.test.ts` | literales nuevos | R46, R48 |
| `wallet-tienda-descarga-columnas.test.ts`, `mi-wallet-page.test.tsx` | literales nuevos | R47, R48 |
| `wallet-conceptos-manuales.test.ts` | siete → ocho; grupo `entra` con tres; frase y cabecera literales | R54, R55, R67 |
| `wallet-registrar-movimiento-dialog.test.tsx` | payload del abono exacto; los otros seis intactos; props `conceptoInicial`/`tiendaFija`; `ya_registrado` un solo toast | R56–R58 |
| `nombres-wallet-461.guardia.test.ts` | reservados → tomados (§2); contrapruebas con un reservado ficticio | R53 |
| `historial-accion-escrituras-cubiertas.guardia` | +2 entradas `recibe_tx` | R61, R62 |
| `wallet-service.test.ts` y dobles de `LectoresDocumentosCaja` (8 archivos, medido por la 461) | +`abonos` | R41 |
| `WalletLedgerAcciones461.test.tsx` o uno nuevo `WalletLedgerAcciones457.test.tsx` | «Anular…»/«Ver comprobante» solo en la original; nada en el reverso | R41 |
| `contexto-461.test.ts` | literal del grupo «Llega dinero a la caja» | R68 |
| censos POSTERIORES de migraciones (§3.4) | +2 carpetas; `caja-tesoreria-migration` 23→25 | R75 |
| `desglose-tienda.test.ts`, `aporte-por-orden.test.ts`, `caja-tesoreria.test.ts` | recorren los seeds en runtime | R24 |

Guardia NUEVA `tests/unit/guards/abono-tienda-alcance.guardia.test.ts` (R65/R67), patrón de las de la
173/459: (1) censo de productores de `categoria: "abono_tienda"` en `lib/`: **solo** `AbonoTiendaService`;
(2) `AbonoTiendaService` no se construye sin `ICajaAbonoTiendaFeedService` (el constructor lo exige por
tipo) y el método que escribe el crédito llama a `emitirIngresoDeAbono` en el mismo `runTransaction`;
(3) el catálogo del diálogo tiene EXACTAMENTE un concepto cuya `categoriaTienda` sea de tipo `credito`
según `TIPO_POR_CATEGORIA_TIENDA`, y es `abono_tienda`. Con contraprueba (una fuente con un segundo
productor la pone roja) y control de no-vacuidad.

## 13. Fase 0 y mutaciones (R77; HD5 de la 461)

**Fotografía:** `tests/integration/db/caja-caracterizacion-459.test.ts` y
`caja-invariante-tiendas.test.ts` (461: 11 pasos) corren verdes sobre el SHA de partida (`dev` con la
461) y **sus literales no se tocan**: esta ficha no añade filas al escenario de la fotografía; añade dos
pasos a la invariante («pago de la tienda B a Ordenex» y «su anulación», sobre una tienda con saldo en
contra sembrada con un cobro), con R7 y R8 al céntimo tras cada uno (R23) y comprobación de que hay filas.

**Mutaciones de control** (antes de tocar nada; con autocomprobación: diff de UNA línea, `git diff` ≠ 0,
solo los tests nombrados, rojo con el nombre del caso y número de tests ≠ 0, `git checkout`, árbol
limpio): (a) quitar `emitirEgresoDePago` en `registrarPagoTienda`; (b) `LIQUIDEZ.ingreso_flete =
"efectivo"`; (c) `CUBETA.cobro_manual = "aFavor"`; (d) quitar `emitirCargoDeCobro` en `CobroTiendaService`;
(e) quitar `bloquearBeneficiario` en `PagoPorCuentaTiendaService.registrar` (si ninguno la mata, la
concurrencia de esta ficha la cubre).

**Mutaciones de la ficha** (T Z.1, sobre el árbol final): (1) el servicio no llama a
`emitirIngresoDeAbono` → rojo (R17/R23); (2) `NATURALEZA.ingreso_abono_tienda = "propio"` → rojo (guardia
(2), R19/R24: la ganancia sube); (3) `LIQUIDEZ.ingreso_abono_tienda = "cargo_a_tienda"` → rojo (R19: «Entró»
no sube; guardia (4)); (4) `CUBETA.abono_tienda = "cargos"` → rojo (R49); (5) quitar el candado → rojo
(concurrencia, R16); (6) tope `monto > deuda` → `>=` → rojo (R15); (7) anular con el monto de la petición
(`input.monto ?? abono.monto`, con la petición trayendo `monto: "1.00"`; lección de la 461: el mutante
equivalente) → rojo (R34); (8) anular sin el débito de la tienda → rojo (R31/R23); (9) `formDataAbono` sin
`claveIdempotencia` → rojo (R56); (10) `tipoDeDocumentoOriginal` sin la rama del abono → rojo (R41); (11)
`CATEGORIA_MI_WALLET_LABEL.abono_tienda` igual al nombre desde Ordenex → rojo (R47); (12) un segundo
productor de `categoria: "abono_tienda"` → rojo (guardia nueva, R65); (13) `PagoTiendaAcciones` sin el
botón con saldo negativo → rojo (R59); (14) el `down` de la migración 2 borra aunque haya filas → rojo
(R75). Informe en `progress/fase0_457.md`.

## 14. Medición de SOLO LECTURA en PRODUCCIÓN (la corre el leader por el MCP de Supabase) — R78

Resultado a `progress/contraste_457.md`, **antes** de escribir la migración (M3/M4 deciden las listas)
y **después** de desplegar. Todas son `SELECT`.

```sql
-- M1 — tiendas con saldo en contra (foto 2026-09-24: Nuform −6.170.666,55; la reclasificacion de la 459
--      NO toca el libro de la tienda, asi que se espera lo mismo salvo movimientos posteriores)
SELECT u.nombre, u.primer_apellido, u.estado::text AS estado,
       SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE -m.monto END) AS saldo, COUNT(*) AS movimientos
FROM wallet_tienda_movimiento m JOIN usuario u ON u.id = m.tienda_id
GROUP BY u.id, u.nombre, u.primer_apellido, u.estado
HAVING SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE -m.monto END) < 0
ORDER BY saldo ASC;

-- M2 — de que se compone la deuda de Nuform (por concepto)
SELECT m.categoria::text, m.tipo::text, COUNT(*) AS filas, SUM(m.monto) AS total
FROM wallet_tienda_movimiento m JOIN usuario u ON u.id = m.tienda_id
WHERE u.nombre ILIKE 'nuform%' GROUP BY 1, 2 ORDER BY 1, 2;

-- M3 — los CINCO catalogos, en su orden real. Antes de la release (foto 2026-09-24): 17 / 11 / 8 / 52 / 21.
--      Tras la release (459+461+SF-001+454-456): se esperan 23 / 14 / 13 / 61 / 23; el down NO copia
--      estas listas (lee pg_enum), pero el test de migracion compara valor a valor.
SELECT t.typname, COUNT(*) AS n, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS valores
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname IN ('wallet_movimiento_categoria','wallet_tienda_movimiento_categoria','wallet_origen_tipo',
                    'historial_accion_tipo','historial_accion_entidad')
GROUP BY t.typname ORDER BY t.typname;

-- M4 — los dos CHECK tipo<->categoria tal como estan (las listas de partida de §3.3 tienen que ser ESTAS)
SELECT conrelid::regclass AS tabla, conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conname IN ('wallet_tienda_movimiento_tipo_categoria_check','wallet_movimiento_tipo_categoria_check');

-- M5 — el bucket compartido (lo crea la 459 antes de desplegar; sin el, con comprobante = comprobante_no_guardado)
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'wallet-comprobantes';

-- M6 — LINEA BASE de los dos libros (se repite tras desplegar: debe ser IDENTICA, desplegar no escribe filas)
SELECT 'caja' AS libro, categoria::text, tipo::text, COUNT(*) AS filas, SUM(monto) AS total
FROM wallet_movimiento GROUP BY 2, 3
UNION ALL
SELECT 'tienda', categoria::text, tipo::text, COUNT(*), SUM(monto)
FROM wallet_tienda_movimiento GROUP BY 2, 3
ORDER BY 1, 2, 3;

-- M7 — lo que no debe existir todavia / lo que R74 protege
SELECT to_regclass('public.abono_tienda') AS tabla_abono_ya_existe,
       (SELECT COUNT(*) FROM liquidacion_pago WHERE tienda_id IS NOT NULL) AS pagos_a_tienda;

-- M8 — R7 y R8: es la C461-1 de specs/461-…/design.md §13 CON las dos categorias de esta ficha en la
--      lista de TERCEROS ('ingreso_abono_tienda','egreso_reverso_abono_tienda', §4, DH1). La C461-1
--      LITERAL las trataria como «propio» y daria diferencia_r8 = −Σ pagos vigentes (recorrido R79, F1:
--      medido −34.000,00 en el clon; y −4.000,00 con un solo pago de 4.000 en ordenex_457c). La consulta
--      COMPLETA, lista para pegar, es la «C457-1» de progress/contraste_457.md, seccion «SQL M8 para
--      despues del despliegue». Se corre antes y despues (diferencia_r8 = 0,00 y diferencia_r7 = 0,00).
--      Tras el primer pago de Nuform de M: entro +M, cifra +M, de_tiendas +M, suma_saldos +M, ganancia
--      igual, capital igual.
```

**Tras desplegar (R78):** M6 idéntico; M8 (la C457-1, NO la C461-1 literal) con las dos diferencias en 0,00; M3 con 25 / 16 / 14 / 63 /
24; M4 con las listas de §3.3; `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
('abono_tienda','abono_tienda_anulacion')` → `t`, `t`; errores de runtime en la hora siguiente = 0. **Tras
el primer pago real de Nuform:** M1 con el saldo subido en el monto y M8 en 0,00.

## 15. Acoples con la 458 (lo que la 458 enchufa; nada de esto lo hace la 457)

1. **Catálogo del diálogo nuevo (458-3, R35):** la entrada ya existe en el diálogo actual con
   `clase: "abono_tienda"`; 458-3 la migra a `RegistrarMovimientoDialog` con preselección (la misma que
   `conceptoInicial`/`tiendaFija`) y añade «Así queda» (R42): Entró +M, cifra +M, «De las tiendas» +M,
   saldo de la tienda +M, ganancia sin cambio (§4.1).
2. **Estado de cuenta de la tienda (458-4, R26):** la acción «Registrar pago recibido» se llama
   «Registrar pago de la tienda a Ordenex» y llama a `registrarAbonoTiendaAction` con la clave por
   apertura; la frase «<Tienda> le debe ₡… a Ordenex» necesita el importe ABSOLUTO desde el servidor:
   la 458-4 amplía `SaldoTiendaResumenDTO` (D9), no esta ficha.
3. **Comprobante (458 §2.2):** NO hace falta columna nueva en `wallet_comprobante`: el pago lleva
   `comprobante_path` en su documento, como el pago de un gasto y el aporte (459 §14-458.4); la 458-4 lo
   abre para la tienda con `obtenerComprobanteAbonoAction`, que ya autoriza a la tienda dueña (DH3, D7).
4. **Anulación (458 §4.3):** documento propio `abono_tienda_anulacion`; no se duplica en `wallet_anulacion`;
   el panel llama a `anularAbonoTiendaAction`. Chips (R24): «Pagos» incluye `abono_tienda` y
   `abono_tienda_anulado`.
5. **Glosario y etiquetas de la 458:** los textos de §2 (la 458 cita «Pago recibido de una tienda»:
   nombre retirado por esta ficha).
6. **`/mi-wallet` rehecha (458-4):** «Le pagaste a Ordenex» con «Ver comprobante» para la tienda dueña.
7. **Lo que la 458 daba por hecho de la 457 y ya no existe:** las actions de lista (D6). El estado de
   cuenta lee `estadoDeDocumentos` y el libro.

## 16. Alternativas descartadas

- **A1 — Ampliar `liquidacion_pago` con una dirección.** El backfill de la 173 lo convertiría en egreso
  (`CajaBackfillTesoreriaService` lee `liquidacionPago.findMany({ tiendaId: { not: null } })`), las
  sumas y listas de «lo pagado a la tienda» lo mezclarían, el historial diría «Registró un pago a
  tienda», y su trío de CHECK está bajo test sobre una tabla con datos de producción.
- **A2 — Registrar el pago como «Corrección de caja (suma)».** Es PROPIO (sube la ganancia, contra
  DH1), no toca el libro de la tienda y es exactamente el crédito sin documento que D3 temía.
- **A3 — Reusar `ajuste_credito`/`ajuste_debito` en el libro de tienda.** Indistinguible del
  contra-asiento de un pago a tienda anulado; conflacionar filas es irreversible (D2 de la 381).
- **A4 — Extender `CajaPagoTiendaFeedService` o `CajaPagoPorCuentaFeedService`.** Rompe las guardias
  que fijan su lista exacta y les da a otros servicios acceso a categorías que no son suyas.
- **A5 — Cuarta cubeta «Pagado por la tienda» en el desglose.** Cambia `DesgloseTiendaDTO` y las dos
  cabeceras: es rediseño y lo decide la maqueta de la 458.
- **A6 — Clasificar el pago como `propio` o como `cargo`.** Propio sube la ganancia (DH1); cargo no
  sube «Entró» aunque el dinero entra de verdad: rompe R7/R8 en cuanto la tienda paga.
- **A7 — Un diálogo propio en `/wallet/tiendas` (molde `RegistrarPagoDialog`).** Dos formularios del
  mismo pago con dos vocabularios; el diálogo único es la decisión de la 334 y de la 461 (D8).
- **A8 — Anular desde una lista de pagos de la tienda (spec anterior).** Duplica la acción que el libro
  de la caja ya ofrece a los demás documentos y es lo que la 458-4 pinta (D5).
- **A9 — Ventana de 30 días para la fecha del pago.** Una tienda paga hoy deudas de hace meses y el
  pago debe llevar su fecha real, como el pago de Ordenex a la tienda (D3).
- **A10 — `down.sql` con lista fija de enums.** Borraría en `prod` valores que no existen o en `dev`
  los de otras fichas (memoria «el down.sql borra los valores posteriores»).
- **A11 — Validar la firma binaria del comprobante.** El bucket es privado y se sirve por URL firmada;
  se queda la validación compartida de la 459 (MIME + tamaño).
- **A12 — Subir el comprobante DESPUÉS de confirmar la transacción.** Un fallo de subida dejaría un
  documento que dice tener comprobante sin tenerlo. Subir antes y compensar es el patrón del repo.

## 17. Recorrido por rol (guion; sin arnés E2E, Playwright ad hoc en local sembrado; R79)

Preparación: `prisma migrate deploy`; una tienda de prueba con saldo en contra (un cobro de Ordenex de
10.000,00 desde «Registrar movimiento» la deja en −10.000,00); un solo dev server. Capturas y números en
`progress/recorrido_457/`.

**Maestro**
1. `/wallet` → «Registrar movimiento»: tres grupos, ocho conceptos; «Llega dinero a la caja» ofrece
   «Una tienda le paga a Ordenex»; al elegirlo cambia la frase de una línea y la cabecera dice que solo
   con saldo en contra y hasta lo que debe; aparecen tienda, método, referencia (al elegir SINPE) y
   comprobante.
2. Registrar 4.000,00, SINPE, referencia «123456», motivo «Pago de lo que debía por los fletes de
   septiembre», fecha de ayer, con un PDF. → aviso «Pago registrado. El saldo de <Tienda> queda en
   -₡6.000,00 · En contra. La tienda todavía le debe ese dinero a Ordenex.»
3. Tarjeta: «Entró» y la cifra principal +4.000,00; «Lo que Ordenex les debe a las tiendas» +4.000,00;
   ganancia y capital iguales. Libro: fila «Una tienda le paga a Ordenex», dueño «Tienda», origen «Pago de
   una tienda a Ordenex · <Tienda> · Pago de lo que debía… · SINPE · 123456», fecha de ayer, con «Anular…»
   y «Ver comprobante» (abre el PDF). Filtro por concepto lo ofrece. Descarga: mismos textos, sin uuids.
4. Repetir el paso 2 con la MISMA clave (doble clic) → un solo aviso, una sola fila, el PDF duplicado no
   queda en el bucket.
5. Intentar 7.000,00 → bajo el monto: «La tienda debe ₡6.000,00: el pago no puede superar ese importe.».
   Registrar 6.000,00 → saldo 0,00 «En cero». Intentar otro → bajo la tienda: «Esta tienda no tiene saldo
   en contra: no hay nada que pagar.».
6. `/wallet/tiendas` → la tienda: fila «La tienda le paga a Ordenex» ×2, «A favor» +10.000,00, saldo 0,00
   = tabla; la fila no se despliega; con saldo 0 NO hay botón «Registrar pago de la tienda a Ordenex».
   Descarga sin uuids.
7. `/wallet` → «Anular…» en el de 4.000,00 con motivo «Referencia equivocada» → «Anulado»; contra-asiento
   «Pago de una tienda a Ordenex anulado» fechado HOY, dueño «Tienda»; «Salió» +4.000,00, cifra −4.000,00,
   «De las tiendas» −4.000,00, ganancia igual. Segundo intento → «Ya estaba anulado». En el desglose,
   «Pago de la tienda a Ordenex anulado» en «Cargos»; saldo −4.000,00; y AHORA el botón «Registrar pago de
   la tienda a Ordenex» aparece: pagar 4.000,00 desde ahí (concepto y tienda fijos) → la fila de la tabla
   de saldos se actualiza sin recargar.
8. `/historial-de-acciones`: «Registró un pago de una tienda a Ordenex» ×3 y «Anuló un pago de una tienda
   a Ordenex» ×1, con la tienda y el importe, SIN el motivo; los filtros por los dos tipos funcionan.

**Admin** — pasos 1–3 y 7 sobre otra tienda: mismas respuestas (paridad).

**adminTienda (la tienda del recorrido)**
9. `/mi-wallet`: «Le pagaste a Ordenex» con su motivo y método en el origen, y «Ordenex anuló el pago que
   le hiciste»; las aclaraciones de «A tu favor» y «Cargos de Ordenex» los nombran; el saldo cuadra con
   `/wallet/tiendas`. Descarga sin uuids. Ningún botón de registrar ni anular.
10. Llamar a `obtenerComprobanteAbonoAction` con el id de SU pago → `ok` (el PDF abre); con el de otra
    tienda → `no_encontrado`; `registrarAbonoTiendaAction` y `anularAbonoTiendaAction` → `forbidden`.

**Mensajero** — `/wallet` y `/mi-wallet` → no encontrado; las tres actions → `forbidden`.

## 18. Trazabilidad R → test (el implementer la copia a `progress/impl_457.md` con rutas finales)

| R | Test |
| --- | --- |
| R1, R17, R18, R20, R21 | `tests/integration/db/abono-tienda-457.test.ts` (POR LA ACTION; las cuatro filas en Postgres; instantes iguales al inicio del día CR) |
| R2, R3 | `tests/unit/services/abono-tienda-service.test.ts` (ningún repo llamado), `tests/unit/actions/abono-tienda-action.test.ts` |
| R4–R9, R12, R13, R34, R35 | `tests/unit/types/abono-tienda-schema.test.ts`; R5 además en la integración (string exacto en las tres tablas) |
| R10, R11 | `abono-tienda-service.test.ts` |
| R14, R15, R66 | `abono-tienda-service.test.ts` + integración (saldo ≤ 0 tras registrar) |
| R16, R38 | `tests/integration/db/abono-tienda-457-concurrencia.test.ts` (abono ∥ abono; abono ∥ pago a tienda; abono ∥ pago de un gasto; dos anulaciones) |
| R19, R39 | `tests/unit/utils/caja-derivacion-457.test.ts` (Entró/Salió/cifra/ganancia/terceros/capital ±M; identidad sobre subconjuntos con semilla fija), `tests/unit/analytics/finanzas-diario.test.ts` (+1 caso) |
| R22 | integración: cero filas en otras tiendas, en `pago_mensajero_movimiento` y en categorías propias/capital |
| R23 | `tests/integration/db/caja-invariante-tiendas.test.ts` (+2 pasos: pago y anulación) |
| R24 | `caja-clasificacion-459.guardia.test.ts` (+2 contrapruebas), `desglose-tienda.test.ts`, `aporte-por-orden.test.ts`, `caja-tesoreria.test.ts` |
| R25 | `abono-tienda-service.test.ts` + integración (doble envío = 1 fila por tabla, archivo compensado) |
| R26–R30, R42–R44 | `tests/unit/services/abono-tienda-comprobante.test.ts` (dobles de `IFileStorage`/`ISignedUrlProvider`) |
| R31–R33, R36, R37, R40 | `tests/unit/services/abono-tienda-anulacion.test.ts` + integración; R40 = lista exacta de exportaciones de `lib/actions/abono-tienda.ts` (tres) |
| R41, R60 | `tests/components/WalletLedgerAcciones457.test.tsx`, `wallet-service.test.ts` (`tipoDeDocumentoOriginal`, lector `abonos`), integración por `listarMovimientosAction` (`documento.tipo === "abono_tienda"`) |
| R45, R48 | `tests/unit/components/wallet-labels.test.ts`, `tests/components/descarga/WalletDescarga.test.tsx` |
| R46, R48, R49, R50 | `desglose-tienda-labels.test.ts`, `desglose-movimientos-tienda.test.tsx`, `desglose-tienda-descarga-columnas.test.ts`, `tests/unit/utils/desglose-tienda.test.ts` (cabecera = saldo con y sin abonos) |
| R47, R48, R50 | `mi-wallet-labels.test.ts` (dos diccionarios distintos), `mi-wallet-page.test.tsx`, `wallet-tienda-descarga-columnas.test.ts` |
| R51 | `desglose-tienda-ledger.test.tsx` (`naceDeUnCierre` exige `cierre_dia`) |
| R52 | `metrics-caja-naturaleza.guardia.test.ts`, `analitica-financiera-service.test.ts` |
| R53 | `nombres-wallet-461.guardia.test.ts` (tomados + retirados) |
| R54, R55, R57, R58, R67 | `wallet-conceptos-manuales.test.ts`, `wallet-registrar-movimiento-dialog.test.tsx`, `abono-tienda-alcance.guardia.test.ts` (3) |
| R56 | `wallet-registrar-movimiento-dialog.test.tsx` (payload exacto del abono; los otros seis intactos) |
| R59 | `tests/components/PagoTiendaAccionesAbono457.test.tsx` (botón solo con signo negativo; props del diálogo; refresco de las tres claves) |
| R61–R64 | `catalogo-y-choke-point.test.ts`, `historial-accion-escrituras-cubiertas.guardia`, `historial-accion-sin-datos-cliente.guardia`, `tests/components/HistorialAccionesAbonoTienda457.test.tsx` |
| R65, R67 | `abono-tienda-alcance.guardia.test.ts` + integración Σ `abono_tienda` = Σ `ingreso_abono_tienda` por `origen_id` |
| R68, R69 | `tests/unit/asistente/contexto-457.test.ts`, `contexto-461.test.ts` (literal reescrito), guardias `ayuda-*`, `nombres-wallet-461.guardia` sobre `docs/ayuda/**` |
| R70–R73 | fotografía `caja-caracterizacion-459.test.ts` (sin tocar literales) + `progress/fase0_457.md` (mutaciones de control) + `liquidacion-idempotencia`, `cobro-tienda-461`, `pago-por-cuenta-tienda` (verdes, sin tocar) |
| R74 | integración: con un abono presente, `sumarVigentesPorTienda`, `listarPagosDeTienda`, el backfill de la 173 y las consultas de las migraciones de datos de la 459/461 no lo ven |
| R75, R76 | `tests/integration/db/abono-tienda-457-migration.test.ts` |
| R77 | `progress/fase0_457.md` |
| R78 | `progress/contraste_457.md` (leader) |
| R79 | `progress/recorrido_457.md` + `progress/recorrido_457/` |

## 19. Riesgos y límites declarados

- **L1 — Escritores que no toman el candado.** El feed del cierre (COD), el cobro (461 P11) y el
  cobro por rechazo escriben en el libro de la tienda sin bloquear `usuario`. Si uno confirma mientras se
  registra un pago, el saldo final puede quedar por encima de cero (COD) o más abajo (cobro). La
  contabilidad sigue EXACTA (el saldo se deriva; R7/R8 valen) y no se inventa dinero. R66 se garantiza
  «bajo el candado». Medido por la auditoría: el `INSERT` con FK a `usuario` toma `FOR KEY SHARE`, que
  choca con el `FOR UPDATE`, así que el cobro ESPERA al pago (`progress/auditoria_wallet.md` §2).
- **L2 — Catálogo del diálogo = tiendas activas.** Una tienda inactiva con deuda se paga desde su
  desglose (`tiendaFija`), no desde el catálogo (D2). Si `listarSaldosTiendas` excluyera a las inactivas
  (medir en T6.4), la vía sería la 458-4.
- **L3 — Huérfano de almacenamiento.** Si el proceso muere entre la subida y la compensación, queda un
  archivo sin documento. Inocuo (privado, sin enlace); no se construye limpieza.
- **L4 — La descripción es una copia.** Si la tienda cambia de nombre, la caja conserva el del día del
  pago (igual que el historial). Deliberado.
- **L5 — Los asientos con «hoy» quedan a las 06:00Z.** Se hunden por debajo de los automáticos del día
  en el libro (lo que la 334 evitó para los manuales); es la convención que la 461 fijó para los pagos
  (T2) y se acepta por coherencia con el molde. Alternativa anotada: `instanteDelMovimientoManual`.
- **L6 — Base local compartida:** las migraciones ponen rojo el gate de otras sesiones hasta que
  migren; `prisma generate` se pisa entre worktrees. Clon propio (`CREATE DATABASE … TEMPLATE ordenex`).
- **L7 — Bucket no creado en un entorno:** registrar CON comprobante falla ruidoso (R28); SIN
  comprobante funciona.
- **L9 — Un pago retroactivo puede quedar ANTES del saldo inicial (m6 de la revisión, observación; no
  se cambia).** D3 deja la fecha del pago sin límite hacia atrás (molde del pago a tienda). La 459 exige
  que el saldo inicial no sea posterior al primer día con movimientos (`AporteCapitalService.ts:113-121`),
  pero esa regla solo se evalúa al REGISTRAR el saldo inicial: un pago retroactivo registrado después
  deja dinero «entrando» antes del saldo inicial. No rompe R7/R8 (las sumas no dependen del orden); es
  una rareza de lectura del libro por fechas. Si hiciera falta, el arreglo sería un límite inferior en
  `fechaPagoSchema` (el día del saldo inicial vigente), y es decisión del humano.
- **L8 — Sale después de la 461 y sin la pantalla de la 458:** el humano acotó la UI; la ficha SÍ se
  puede desplegar sola (el botón del desglose y el concepto del diálogo son la pantalla), pero su
  despliegue lo decide el humano con el pago real de Nuform delante.
