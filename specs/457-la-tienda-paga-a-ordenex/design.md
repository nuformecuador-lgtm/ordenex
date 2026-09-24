# Ficha 457 — diseño técnico

> Búsqueda: índice `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) + lectura del
> archivo real para cada símbolo citado. Todo lo que sigue está confirmado en el árbol del
> 2026-09-24 (`dev` @ `e4abe08e`). Donde digo «medir», es que NO lo sé y hay que medirlo.

## 0. En una frase

Un **documento propio** (`abono_tienda`) que nace con su crédito en el libro de la tienda, su
ingreso de TERCEROS en la caja y su fila de historial en la misma transacción, bajo el mismo
candado que el pago a esa tienda; con anulación entera y simétrica; y con un comprobante opcional
en un bucket privado que la tienda puede leer por enlace firmado.

Nombres (decididos aquí; los textos visibles están en §4):

| Pieza | Valor |
| --- | --- |
| Tabla del documento | `abono_tienda` |
| Tabla de la anulación | `abono_tienda_anulacion` |
| Categoría crédito, libro de tienda | `abono_tienda` |
| Categoría débito compensatorio, libro de tienda | `abono_tienda_anulado` |
| Categoría ingreso de caja (terceros) | `ingreso_abono_tienda` |
| Categoría egreso de caja (terceros), reverso | `egreso_reverso_abono_tienda` |
| Origen (`wallet_origen_tipo`) | `abono_tienda` |
| Historial: tipos | `abono_tienda_registrado`, `abono_tienda_anulado` |
| Historial: entidad | `abono_tienda` |
| Servicio | `AbonoTiendaService` (`lib/services/`) |
| Puerto de caja | `ICajaAbonoTiendaFeedService` / `CajaAbonoTiendaFeedService` |
| Repositorio | `AbonoTiendaRepository` |
| Server Actions | `lib/actions/abono-tienda.ts` (archivo NUEVO) |

## 1. La decisión central: documento PROPIO, no ampliar `liquidacion_pago`

Se pidió decidir si `liquidacion_pago` gana una columna de dirección o si el pago recibido tiene
documento propio. **Documento propio.** Cada razón está medida en el árbol:

1. **El backfill de la caja lo convertiría en un egreso.** `CajaBackfillTesoreriaService.ts:188-189`
   lee `liquidacionPago.findMany({ where: { tiendaId: { not: null } } })` y emite
   `egreso_pago_tienda` por cada fila. Un pago recibido guardado ahí saldría de la caja al
   re-ejecutar el backfill: el mismo dinero contado al revés, sin un error.
2. **Las sumas y listas de «lo pagado a la tienda» lo mezclarían.** `sumarVigentesPorTienda` y
   `listarPorTienda` (`LiquidacionPagoRepository.ts:485-532`) filtran por `tiendaId` y nada más. Cada
   una necesitaría un filtro de dirección; olvidar uno es un fallo mudo (la familia que más ha
   costado en este repo).
3. **El historial mentiría.** `LiquidacionPagoRepository.crear` (`:229-246`) decide el tipo por
   `mensajeroId !== null ? pago_mensajero_registrado : pago_tienda_registrado`: un pago recibido
   quedaría como «Registró un pago a tienda». Y `anular` escribe `pago_anulado` («Anuló un pago»),
   ambiguo.
4. **La tabla tiene premisas escritas que no conviene tocar.** Su comentario de esquema
   (`schema.prisma:1912-1924`) prohíbe añadirle restricciones únicas, y su trío de CHECK
   (beneficiario XOR, cierre sii mensajero, monto > 0) está bajo test. Ampliarla obliga a reescribir
   CHECK sobre una tabla con datos de producción.
5. **Los campos no son los mismos.** El pago recibido lleva `motivo` obligatorio y comprobante; el
   pago de Ordenex lleva `nota`, `cierre_id` y `reparto_id`, que aquí no tienen sentido.
6. **Las guardias del puerto de la 173 fijan su lista exacta.**
   `tests/unit/services/liquidacion-caja-puerto.test.ts:195` y
   `tests/unit/guards/liquidacion-alcance.test.ts:286` exigen que `CajaPagoTiendaFeedService` nombre
   EXACTAMENTE `egreso_pago_tienda` e `ingreso_reverso_pago_tienda`. Con un puerto propio, esas
   guardias no se tocan.

Lo que SÍ se reutiliza, pieza por pieza y sin copiarla: el candado
(`ILiquidacionPagoRepository.bloquearBeneficiario({ tipo: "tienda" })`, inyectado como `Pick`), la
derivación del saldo (`agregarSaldoPorTienda` + `derivarSaldoTienda`), la fecha
(`medianocheUtcDelDia`, `fechaCalendarioCR`), los campos de borde (`montoLiquidacionSchema`,
`fechaPagoSchema`, `exigirReferenciaEnPagoElectronico`, `LIQUIDACION_REFERENCIA_MAX`) y la
detección de P2002 (`_shared/prisma-unique.ts`).

## 2. Modelo de datos

### 2.1 `abono_tienda` (documento, INMUTABLE: sin `updated_at` ni `deleted_at`)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | uuid PK | lo genera la base |
| `clave_idempotencia` | text **UNIQUE** | uuid del cliente al abrir el formulario (§5.3) |
| `tienda_id` | text FK → `usuario(id)` ON DELETE RESTRICT | quién paga |
| `monto` | decimal(12,2) | CHECK `monto > 0` |
| `metodo` | `metodo_pago_value` | enum EXISTENTE; no se toca |
| `referencia` | text NULL | obligatoria si método ≠ efectivo (se exige en el borde, como la 172) |
| `motivo` | text NOT NULL | CHECK `btrim(motivo) <> ''`; tope 200 en el borde |
| `fecha_pago` | date | fecha REAL del pago |
| `comprobante_path` | text NULL | ruta dentro del bucket, nunca URL |
| `comprobante_content_type` | text NULL | CHECK: los dos NULL o los dos NOT NULL |
| `registrado_por` | text FK → `usuario(id)` ON DELETE RESTRICT | NOT NULL |
| `created_at` | timestamptz DEFAULT now() | instante del registro |

Índice `(tienda_id, fecha_pago)` para la lista por tienda. **Solo dos restricciones únicas** (PK y
clave) y se escribe como premisa en el comentario del modelo, igual que en `liquidacion_pago`: el
repositorio tratará un P2002 sin pista como choque de clave (§5.3).

### 2.2 `abono_tienda_anulacion` (INMUTABLE)

`id` uuid PK · `abono_id` FK → `abono_tienda(id)` **UNIQUE** ON DELETE RESTRICT · `motivo` text NOT
NULL CHECK `btrim(motivo) <> ''` · `anulado_por` FK → `usuario(id)` RESTRICT · `created_at`.
«Anulado» se DERIVA de que exista la fila (molde exacto de `liquidacion_anulacion`, alternativa H de
la 172: nada que sincronizar).

### 2.3 RLS (R70)

Las dos tablas: `ENABLE ROW LEVEL SECURITY` sin policies (solo service role), patrón
`liquidacion_pago`. El comprobante vive en un bucket privado y solo se lee por URL firmada en el
servidor (§6).

### 2.4 Valores de enum nuevos y por qué cada uno

| Enum | Valor | Por qué no se reutiliza uno existente |
| --- | --- | --- |
| `wallet_tienda_movimiento_categoria` | `abono_tienda` (crédito) | `ajuste_credito` ya es el contraasiento de anular un pago a tienda; mezclarlos hace imposible filtrar «pagos de la tienda» y conflacionar filas es irreversible (argumento D2 de la 381). |
| `wallet_tienda_movimiento_categoria` | `abono_tienda_anulado` (débito) | `ajuste_debito` está sin productores y la 381 lo dejó reservado; con su rótulo «Ajuste (débito)» la tienda no entendería qué se le anuló (DH2). |
| `wallet_movimiento_categoria` | `ingreso_abono_tienda` (ingreso, terceros) | `ingreso_ajuste` es PROPIO (subiría la ganancia, contra DH1); `ingreso_cod_recaudado` lo lee `CajaCodFeedService` y la conciliación del cierre. |
| `wallet_movimiento_categoria` | `egreso_reverso_abono_tienda` (egreso, terceros) | `egreso_ajuste` es PROPIO (bajaría la ganancia al anular); `egreso_pago_tienda` significa «salió hacia una tienda» y lo cuenta `finanzas-diarias.ts` como pago a tiendas. El prefijo `egreso_` es obligatorio: `caja-tesoreria.ts:278` deduce el tipo del prefijo. |
| `wallet_origen_tipo` | `abono_tienda` | `pago_tienda` se rotula «Pago a tienda» (lo contrario) y su `origen_id` apunta a `liquidacion_pago`; `manual` lleva `origen_id` NULL y queda fuera del índice único (sin idempotencia). |
| `historial_accion_tipo` | `abono_tienda_registrado`, `abono_tienda_anulado` | ver §8. |
| `historial_accion_entidad` | `abono_tienda` | los 21 valores mapean 1:1 con tablas; esta es la tabla del documento. |

**Por qué DH1 (terceros) es coherente con la caja de hoy.** Al aprobar un cierre, la caja registra el
COD como `ingreso_cod_recaudado` (terceros) y los fletes como ingresos PROPIOS; el aviso vigente
`CAJA_RESUMEN_AVISO_TERCEROS` ya dice que la porción de las tiendas «es más de lo que se les debe,
porque de este dinero Ordenex todavía descuenta el flete». Una tienda con saldo en contra es una
cuyo flete se reconoció como ganancia sin que llegara el COD que lo traía. Cuando paga, ese dinero
entra al mismo bolsillo por el que habría entrado el COD: terceros. La ganancia no cambia (ya se
contó); cambia el dinero en caja. Es exactamente DH1.

### 2.5 Los dos CHECK tipo↔categoría

- `wallet_tienda_movimiento_tipo_categoria_check`: la rama `credito` gana `abono_tienda`; la rama
  `debito` gana `abono_tienda_anulado`. La lista de partida es la de
  `20260908140100_wallet_tienda_check_cobro_manual` (hay que **medirla**: M4).
- `wallet_movimiento_tipo_categoria_check`: la rama `ingreso` gana `ingreso_abono_tienda`; la rama
  `egreso` gana `egreso_reverso_abono_tienda`. Partida: `20260803120000_caja_tesoreria` (medir: M4).
- Siguen siendo DISYUNCIÓN DE LISTAS CERRADAS (fallan cerrado, R46 de la 173). Un test contra
  Postgres real comprueba que el par invertido (`debito`+`abono_tienda`, `egreso`+`ingreso_…`) lo
  rechaza la base.

## 3. Migraciones (a mano: `db:migrate:create` falla con P3006 en este repo)

Tres carpetas, y el reparto es obligatorio: Postgres prohíbe USAR un valor de enum en la
transacción que lo añade (55P04) y Prisma corre cada `migration.sql` en su propia transacción.
**Antes de fijar los timestamps, mirar los ids de `origin/dev`** (colisión de ids entre sesiones).

1. `2026092512xxxx_abono_tienda_enums` — solo `ALTER TYPE … ADD VALUE IF NOT EXISTS` de los cuatro
   valores de categoría y del origen. Aditiva.
2. `2026092512xxxx_historial_accion_abono_tienda` — los dos tipos y la entidad del historial.
   Aditiva. Va aparte para que su `down.sql` (recrea-con-lista, como TODOS los downs de esos dos
   enums desde la 362) no comparta archivo con los de la wallet.
3. `2026092512xxxx_abono_tienda` — las dos tablas, FKs, índices, CHECK, RLS y la recreación de los dos
   CHECK tipo↔categoría (que NOMBRAN los valores de la 1).

### 3.1 Los `down.sql` (R69) — el punto más delicado de la ficha

- **Ningún `down.sql` anterior se toca** (son fotos históricas).
- El `down` de la 3: `DROP` de las dos tablas y los dos CHECK vuelven a su lista PREVIA. Va primero en
  un rollback (los downs corren del más nuevo al más viejo) y deja sin referencias a los valores que
  retiran los downs de la 1 y la 2.
- Los `down` de la 1 y la 2 RECREAN cada enum con su lista completa previa (Postgres no tiene `DROP
  VALUE`), soltando y recreando antes/después todo lo que nombra el tipo: índices
  (`wallet_tienda_movimiento_tienda_id_categoria_idx`, `…_origen_uq`,
  `wallet_movimiento_tipo_categoria_idx`, `wallet_movimiento_origen_categoria_uq` y los de
  `pago_mensajero_movimiento` que llevan `origen_tipo`), los CHECK y el índice parcial del premio. El
  precedente de `wallet_origen_tipo` (usado por TRES tablas) es
  `20260827120000_premio_ranking_devengo/down.sql`; el de las categorías, los dos downs de la 381.
- **Las listas se MIDEN, no se copian de este spec:** consulta `pg_enum` en local y en producción
  (M3). Cada `down.sql` lleva el aviso de «foto del día» y la consulta para comprobarla, como los de
  la 381.
- **Precondición ruidosa:** si existe una fila con cualquiera de los valores nuevos, el `USING` del
  `ALTER COLUMN` falla y el rollback aborta. Es lo correcto: son asientos de dinero.
- Test de migración contra Postgres real (molde `tests/integration/db/wallet-tienda-cobro-migration.test.ts`):
  reconstruye el estado previo ejecutando las migraciones REALES anteriores y compara valor a valor y
  en orden; comprueba que la reversión con un pago recibido existente falla sin borrar nada.
- `db/schema.prisma`: modelos `AbonoTienda` y `AbonoTiendaAnulacion` + relaciones inversas en
  `Usuario` + valores de enum. Comprobar ausencia de drift entre migraciones y datamodel con el
  mismo procedimiento que usó la 381.
- Tocar migraciones y `db/schema.prisma` obliga al gate COMPLETO (`./init.sh`), no al rápido.

## 4. Clasificación de las categorías nuevas (todos los `Record` totales y listas a mano)

| Categoría | Tipo | Cubeta desglose (`CUBETA_POR_CATEGORIA`) | Naturaleza (`NATURALEZA_POR_CATEGORIA`) | Fuente (`FUENTE_*`) | Rótulo |
| --- | --- | --- | --- | --- | --- |
| `abono_tienda` | credito | `aFavor` | — | `sin_reparto / no_nace_de_un_cierre` | «Pago de la tienda a Ordenex» |
| `abono_tienda_anulado` | debito | `cargos` | — | idem | «Pago de la tienda anulado» |
| `ingreso_abono_tienda` | ingreso | — | `terceros` | idem | «Pago recibido de tienda» |
| `egreso_reverso_abono_tienda` | egreso | — | `terceros` | idem | «Pago recibido de tienda anulado» |
| origen `abono_tienda` | — | — | — | — | caja «Pago de tienda»; libro de tienda «Pago de la tienda» |

Por qué `aFavor`/`cargos` y no una cuarta cubeta: el desglose se DERIVA sumando cada fila a su cubeta
sin mirar el tipo (`desglose-tienda.ts:78-81`); una cubeta nueva cambia la forma de
`DesgloseTiendaDTO` y es rediseño (458). Con `aFavor`/`cargos` la aritmética `saldo = aFavor −
cargos − pagado` sigue cuadrando con `derivarSaldoTienda`, y la inflación de los dos importes brutos
tras una anulación es la MISMA limitación N1 que ya declara `DESGLOSE_MI_WALLET_AVISO` para el pago
anulado. Consecuencia en textos (R53):

- `/mi-wallet`: `aFavorHint` → «COD recaudado, tus pagos a Ordenex y ajustes»; `cargosHint` →
  «Fletes, comisión, IVA, cobros de Ordenex y pagos anulados».
- `/wallet/tiendas`: `aFavorHint` → «COD recaudado, pagos de la tienda y ajustes»; `cargosHint` →
  «Fletes, comisión, IVA, cobros y pagos anulados» (hoy dice «Fletes, comisión e IVA», que ya no era
  cierto desde la 381).
- `DESGLOSE_MI_WALLET_AVISO` y el aviso equivalente del maestro: una frase más que diga que «A tu
  favor» cuenta los pagos que después se anularon y «Cargos» su anulación.

Lista completa de lo que hay que tocar (el compilador obliga en los marcados con *; los demás son
listas `string[]` que NO obliga y llevan test propio):

- `lib/types/wallet-tienda.ts` — `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`*
- `lib/types/wallet.ts` — `WALLET_MOVIMIENTO_CATEGORIA_SEED`*, `WALLET_ORIGEN_TIPO_SEED`*
- `lib/utils/desglose-tienda.ts` — `CUBETA_POR_CATEGORIA`*
- `lib/utils/caja-tesoreria.ts` — `NATURALEZA_POR_CATEGORIA`*
- `lib/utils/aporte-por-orden.ts` — `FUENTE_CAJA`*, `FUENTE_TIENDA`*
- `app/(app)/wallet/_components/wallet-labels.ts` — `CATEGORIA_LABEL`*, `ORIGEN_LABEL`*
- `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` — `CATEGORIA_TIENDA_LABEL`*,
  **`ORIGEN_TIENDA_LABEL` (es `Record<string,string>` con respaldo al valor crudo: el compilador NO
  avisa; sin la clave, la pantalla y las dos descargas pintarían `abono_tienda`)**, `aFavorHint`,
  `cargosHint`, aviso.
- `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts` — hints y aviso del maestro.
- `lib/analytics/metrics.ts` — `dinero_en_caja` (+2), `cuenta_por_pagar_tienda` (+2). `ganancia_ordenex`
  NO. `egresos` NO (su cifra es la de salidas de Ordenex y hacia tiendas; la anulación de un ingreso no
  es un gasto) — si `metrics-caja-naturaleza.guardia.test.ts` exigiera lo contrario, se para y se
  consulta, no se fuerza.
- `lib/types/historial-accion.ts` + `historial-accion-etiquetas.ts` — §8.

`derivarCaja`, `derivarComposicionGanancia`, `derivarFinanzasDiarias`, `derivarSaldoTienda` y
`derivarDesgloseTienda` **no cambian ni una línea**: clasifican por los `Record` de arriba.

## 5. Servicio `AbonoTiendaService`

Servicio PROPIO (no métodos en `LiquidacionService`, que ya tiene 1.340 líneas y guardias de alcance
que nombran su lista exacta de categorías; ni en `WalletTiendaService`, que es de lectura — mismo
argumento que la 381 dejó en `CobroTiendaService.ts:60-64`).

```ts
constructor(
  abonoRepo: IAbonoTiendaRepository,
  tiendaRepo: Pick<IWalletTiendaMovimientoRepository, "crearMovimientos" | "agregarSaldoPorTienda">,
  candado: Pick<ILiquidacionPagoRepository, "bloquearBeneficiario">,   // EL MISMO candado del pago
  usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
  caja: ICajaAbonoTiendaFeedService,                                    // obligatorio: sin caja no se construye (R60)
  comprobantes: IFileStorage,
  runTransaction: AbonoTiendaTxRunner,
  ahora: () => Date = () => new Date(),
)
```

### 5.1 `registrar(input, comprobante | null, actor)` — el orden importa

1. **Rol** (`esAccesoTotal`) antes de leer nada → `forbidden` (R2).
2. **Escala 2 una vez**: `montoStr` (R5).
3. **Tienda** (`obtenerCuentaTienda`): inexistente / no es `adminTienda` → `validation_error` bajo
   `tiendaId` (R10). El estado NO se exige (R11, Q2).
4. **Pre-chequeo optimista** del saldo SIN candado: si ya es ≥ 0 o el monto excede, se responde sin
   subir el archivo (ahorra subidas inútiles). No sustituye al paso 7.
5. **Comprobante** (si viene): subir al bucket (§6). Fallo → `comprobante_no_guardado`, nada escrito
   (R25).
6. `runTransaction`:
7. `candado.bloquearBeneficiario(tx, { tipo: "tienda", tiendaId })` — `SELECT … FROM usuario WHERE
   id = $1 FOR UPDATE`, la MISMA fila que bloquea `registrarPagoTienda` (R15).
8. Saldo bajo candado: `derivarSaldoTienda(agregarSaldoPorTienda(tiendaId, {}))`. `saldo >= 0` →
   `sin_deuda` (R13). `monto > |saldo|` → `excede { deuda }` (R14).
9. `abonoRepo.crear(tx, …)` → documento + fila de historial `abono_tienda_registrado` en el MISMO
   método del repositorio (patrón `LiquidacionPagoRepository.crear`, censo de la guardia). Choque de
   clave → `ClaveRepetidaError` para salir de la transacción.
10. `tiendaRepo.crearMovimientos(tx, [{ tipo: "credito", categoria: "abono_tienda", origenTipo:
    "abono_tienda", origenId: abono.id, monto: montoStr, descripcion: descripcionDeAbono(…),
    registradoPor, fechaMovimiento: medianocheUtcDelDia(fechaPago) }])` (R16, R19, R20).
11. `caja.emitirIngresoDeAbono(tx, { abonoId, monto: montoStr, descripcion:
    descripcionDeAbonoEnCaja(tiendaNombre, …), registradoPor, fechaMovimiento })` (R16, R18).
12. `ok { abono, saldo }` con el saldo derivado DESPUÉS (R17).
13. Fuera de la transacción: ante CUALQUIER desenlace distinto de `ok` (rechazo, clave repetida,
    excepción), `compensarEvidencias(storage, [path])` y, si era clave repetida, responder
    `ya_registrado` releyendo por clave (R22, R26).

### 5.2 `anular({ abonoId, motivo }, actor)`

Espejo de `anularPago` (`LiquidacionService.ts:740-787`): rol → leer el documento FUERA (inmutable;
hace falta saber qué tienda bloquear) → `no_encontrado` → transacción: candado de la tienda →
`abonoRepo.anular(tx, …)` (fila de anulación + historial `abono_tienda_anulado`; choque del UNIQUE →
`YaAnuladoError` → `ya_anulado` releído fuera) → débito `abono_tienda_anulado` por el monto DEL
DOCUMENTO, `origenTipo/origenId` del ABONO (comparte clave con el crédito y solo cambia la
categoría: idempotencia gratis por el índice único parcial) → `caja.emitirReversoDeAnulacion(…)`
con `egreso_reverso_abono_tienda` → saldo resultante. Fecha de los dos contra-asientos:
`medianocheUtcDelDia(fechaCalendarioCR(ahora()))` (R29). El comprobante NO se borra (R30).

### 5.3 Idempotencia y el P2002

`clave_idempotencia` UNIQUE es la barrera de datos contra el doble clic. El repositorio disambigua con
`textoConstraintP2002` y trata un P2002 SIN pista como choque de clave (la tabla solo tiene PK y la
clave: premisa escrita en el modelo y comprobada por un test que enumera los índices únicos). La
relectura (`obtenerPorClave`) devuelve el pago ORIGINAL y el saldo actual de SU tienda, no la de la
petición.

### 5.4 Descripciones (puras, en `lib/utils/descripcion-abono.ts`)

- Libro de tienda: `«<motivo> · <Método>[ · <referencia>]»`.
- Caja: `«<Nombre de la tienda> · <motivo> · <Método>[ · <referencia>]»` — la caja no tiene columna de
  tienda, y DH2 exige que se vea de quién es el dinero sin abrir nada más. El nombre sale de
  `etiquetaDePersona` (el mismo que congela el historial).
- Anulación: el mismo texto precedido de «Anulación · ». El motivo de la anulación NO entra (vive en
  `abono_tienda_anulacion`, lo muestra la lista, igual que en la 172).
- Ninguna lleva identificadores. Test que lo fija.

### 5.5 Puerto `CajaAbonoTiendaFeedService`

Molde exacto de `CajaPagoTiendaFeedService`: dos métodos, `tipo`/`categoria`/`origenTipo` escritos
como literales dentro de la clase (el servicio no puede elegir categoría), `IWalletMovimientoRepository`
encapsulado. `ingreso`/`ingreso_abono_tienda` al registrar; `egreso`/`egreso_reverso_abono_tienda` al
anular; los dos con `origenTipo: "abono_tienda"`, `origenId: abonoId`.

## 6. El comprobante

- **Bucket** privado `wallet-comprobantes`, nombre por env `WALLET_COMPROBANTE_BUCKET` en
  `lib/config/wallet-comprobante.ts` (patrón `lib/config/gestion.ts`) y entrada en `BUCKETS`
  (`lib/storage/buckets.ts`). Lo crea operaciones en PRODUCCIÓN (el leader por el MCP de Supabase
  o el humano) y en PREVIEW (solo el humano: preview no es alcanzable por el MCP). Sin bucket, el
  registro SIN comprobante funciona y el CON comprobante devuelve `comprobante_no_guardado` (R25):
  falla ruidoso, no mudo.
- **Validación** (borde y servicio): MIME ∈ {`image/jpeg`, `image/png`, `image/webp`,
  `application/pdf`}, `0 < size ≤ 4 MB` (`WALLET_COMPROBANTE_MAX_BYTES`, por env). 4 MB y no 5: el
  tope de Server Actions es `bodySizeLimit: "5mb"` (`next.config.ts:74`) incluido el multipart, y
  tocar `next.config.ts` es configuración de build.
- **Ruta del objeto:** `abonos-tienda/<randomUUID()>.<ext>`: aleatoria, sin id de tienda, de pago ni
  de usuario (R24), porque la URL firmada lleva la ruta dentro.
- **Subida y compensación:** `IFileStorage.upload` + `compensarEvidencias`
  (`lib/services/evidencias-compensadas.ts`), el módulo que la 237 extrajo precisamente para no tener
  tres copias. `SupabaseFileStorage` se instancia con el bucket nuevo.
- **Lectura:** `obtenerComprobante(abonoId, actor)`: acceso total → cualquiera; `adminTienda` → solo
  si `abono.tienda_id === actor.usuarioId` (si no, `no_encontrado`, R44); sin comprobante →
  `sin_comprobante` (R45); si no → `getFile(bucket, path, TTL)` con TTL corto por env (defecto 300 s,
  `DEFAULT_SIGNED_URL_TTL_SECONDS`).
- La anulación no borra el archivo; el comprobante no sale en ninguna descarga (R51).

## 7. Server Actions y contratos (`lib/actions/abono-tienda.ts`, archivo nuevo)

Archivo NUEVO y no `lib/actions/liquidacion.ts`: aquel tiene un test que afirma la lista EXACTA de
sus exportaciones (R65 de la 172). Molde: `resolveActorFromSession` → `UnauthenticatedError` antes
del servicio → `schema.parse` → servicio bajo `withErrorHandler`. El `buildService()` inyecta el
puerto de caja REAL y el `SupabaseFileStorage` del bucket nuevo — y un test de integración que pasa
por la acción comprueba la fila de caja en Postgres (el composition root que no inyecta ya costó 2
de 7 notificadores muertos).

| Acción | Entrada | Salida (`status`) |
| --- | --- | --- |
| `registrarAbonoTiendaAction(formData)` | `claveIdempotencia` uuid, `tiendaId` uuid (lo pone el selector, nadie lo teclea), `monto` string, `metodo`, `referencia?`, `motivo`, `fechaPago`, `comprobante?` File | `ok {abono, saldo}` · `ya_registrado {abono, saldo}` · `sin_deuda` · `excede {deuda}` · `comprobante_no_guardado` · `forbidden` · `validation_error {fieldErrors}` · `unauthenticated` |
| `anularAbonoTiendaAction({abonoId, motivo})` `.strict()` | | `ok {abono, saldo}` · `ya_anulado {abono}` · `no_encontrado` · `forbidden` · `validation_error` · `unauthenticated` |
| `listarAbonosDeTiendaAction({tiendaId})` `.strict()` (acceso total) | | `ok {abonos}` · `forbidden` · … |
| `listarMisAbonosAction({})` `.strict()` (adminTienda; tienda = sesión) | | `ok {abonos}` · `forbidden` · `validation_error` si trae `tiendaId` (R40) |
| `obtenerComprobanteAbonoAction({abonoId})` `.strict()` | | `ok {url}` · `sin_comprobante` · `no_encontrado` · `forbidden` · … |

`AbonoTiendaDTO` = `{ id, monto, metodo, referencia, motivo, fechaPago, registradoPorNombre,
registradoAt, tieneComprobante, anulacion: { motivo, anuladoPorNombre, anuladoAt } | null }`. Sin
`tiendaId`, sin ids de usuario, sin clave, sin ruta (R42). `saldo` = `SaldoTiendaDTO` (string con
signo). Montos SIEMPRE string. La guardia `tests/unit/descarga/columnas-sensibles.guardia.test.ts`
debe seguir verde.

## 8. Historial de acciones

- `abono_tienda_registrado` → «Registró un pago recibido de una tienda»; `abono_tienda_anulado` →
  «Anuló un pago recibido de una tienda». Los dos `mueve_dinero`.
- Entidad `abono_tienda` → «Pago recibido de tienda»; etiqueta = `unir(tiendaNombre)` (molde
  `liquidacion_pago`). `monto` = el del documento (`Decimal`, sin `Number`).
- NO se copian `motivo`, `referencia` ni la ruta (R58, R5 de la 362).
- Dos tipos y dos métodos productores (`AbonoTiendaRepository.crear` y `.anular`): la guardia del censo
  mide POR MÉTODO; con los dos `appendAccion` en un método, borrar uno la dejaría verde.
- NO se reusa `pago_anulado`: su texto «Anuló un pago» no dice en qué dirección, y su productor
  censado es `LiquidacionPagoRepository.anular`.
- Tests con números duros que cambian: `accionesDeCategoria("mueve_dinero")` 33 → 35;
  `HISTORIAL_ACCION_ENTIDADES` 21 → 22 (y los demás conteos que las fichas 429/431 fijaron: medir).

## 9. Lectores: qué ve cada rol sin tocar sus pantallas

| Superficie | Qué cambia | Cómo llega |
| --- | --- | --- |
| `/mi-wallet` (adminTienda) libro, filtro, descarga | 2 conceptos + origen con rótulo; hints | diccionarios de `mi-wallet-labels.ts` + SEED |
| `/wallet/tiendas` desglose, filtro, descarga, saldo | idem (reexporta el mismo diccionario) | ídem |
| `/wallet` caja: libro, filtro, descarga, dueño, composición | 2 conceptos, origen «Pago de tienda», dueño «Tienda» | `CATEGORIA_LABEL`, `ORIGEN_LABEL`, `NATURALEZA_POR_CATEGORIA` |
| Detalle de fila de la ganancia (`DetalleFilaComposicion`) | nada: las dos son terceros y no tienen fila | `categoriasDeFilaComposicion` filtra por naturaleza |
| Despliegue de órdenes de una fila | no se ofrece (R54) | `naceDeUnCierre` ya exige `cierre_dia` |
| Analítica financiera | §4 | `metrics.ts` |
| `/historial-de-acciones` | 2 tipos, 1 entidad | §8 |

## 10. La reapertura de D3 (ficha 381) y el test que la guardaba

**Qué dijo D3 y por qué.** «Con respecto al abono no lo pongas, pues esto sí es automático»: un cobro
a una tienda se desquita solo cuando la gestión vuelve a generar COD. El abono que D3 rechazó era un
**crédito a mano, sin dinero**: una persona sube el disponible de una tienda desde «Registrar
movimiento» y la caja no se entera (D1 de la 381 dejaba los dos libros divergir a propósito).

**Por qué este caso es distinto.** Aquí entra dinero de verdad: hay un documento con método,
referencia y fecha real; el importe entra a la caja en la misma transacción; solo se admite con saldo
en contra y hasta lo que se debe; y deja historial. Es el espejo exacto del pago de Ordenex a la
tienda, que existe desde la 172. El automatismo de D3 sigue vigente para quien no paga; esta ficha
da la vía a quien SÍ quiere pagar (Nuform, 2026-09-24).

**Qué protegía el test** (`tests/unit/historial-accion/catalogo-y-choke-point.test.ts:379-381`,
`expect(HISTORIAL_ACCION_TIPOS).not.toContain("abono_tienda_registrado")`): que no existiera una forma
de **inventar dinero a favor de una tienda**. El nombre del tipo era el síntoma que se podía
comprobar; la propiedad es otra. **Cómo cambia sin perderla:**

1. Esa línea pasa a `toContain("abono_tienda_registrado")` con el comentario de la reapertura
   (2026-09-24, ficha 457) y las cifras de categoría actualizadas.
2. La propiedad se fija con una guardia nueva, `tests/unit/guards/abono-tienda-alcance.guardia.test.ts`,
   que lee las fuentes (patrón de las guardias de la 173):
   - **Censo de productores de CRÉDITOS del libro de tienda:** `cod_recaudado` solo en
     `WalletTiendaFeedService`; `ajuste_credito` solo en `LiquidacionService.escribirContraasiento`;
     `abono_tienda` solo en `AbonoTiendaService`. Un cuarto productor rompe la guardia (R60).
   - **El productor de `abono_tienda` no se construye sin puerto de caja** (parámetro obligatorio) y
     en el mismo método que escribe el crédito llama a `caja.emitirIngresoDeAbono` (R60).
   - **El catálogo del diálogo** (`wallet-conceptos-manuales.ts`) no tiene ningún destino que
     acredite a una tienda (R62).
3. Y la propiedad se prueba con dinero: tras cualquier registro válido el saldo es ≤ 0 (R61), y en
   Postgres real Σ `abono_tienda` del libro = Σ `ingreso_abono_tienda` de la caja para el mismo
   `origen_id` (R60).

## 11. Concurrencia y límites declarados

- **L1 — Escritores que no toman el candado.** El feed del cierre (COD) y el cobro manual escriben en
  el libro de la tienda sin bloquear `usuario`. Si uno confirma mientras se registra un pago
  recibido, el saldo final puede quedar por encima de cero (COD) o más abajo (cobro). La contabilidad
  sigue EXACTA (el saldo se deriva) y no se inventa dinero: la tienda pagó dinero real y después
  llegó su COD, que se le pagará como siempre. R61 se garantiza «en el instante de registrarse bajo
  el candado», que es lo que el candado puede garantizar.
- **L2 — Pago de Ordenex y pago recibido simultáneos** sobre la misma tienda: se serializan por la
  misma fila (R15). Test de integración con dos transacciones.
- **L3 — Huérfano de almacenamiento.** Si el proceso muere entre la subida y la compensación, queda
  un archivo sin documento. Inocuo (privado, sin enlace) y detectable; no se construye limpieza.
- **L4 — La descripción es una copia.** Si la tienda cambia de nombre, la caja conserva el nombre del
  día del pago (igual que el historial). Es deliberado: es lo que se sabía al registrar.

## 12. Alternativas descartadas

- **A1 — Ampliar `liquidacion_pago` con una dirección.** §1: el backfill lo convertiría en egreso,
  las sumas de «pagado» lo mezclarían, el historial mentiría y habría que reescribir CHECK sobre una
  tabla con datos de producción.
- **A2 — Registrar el pago como `ingreso_ajuste` desde «Registrar movimiento».** Sube la ganancia
  (contra DH1), no toca el libro de la tienda y es exactamente el crédito sin documento que D3 temía.
- **A3 — Reusar `ajuste_credito`/`ajuste_debito` en el libro de tienda.** Indistinguible del
  contraasiento de un pago anulado; no se puede filtrar ni rotular sin leer texto libre (D2 de la
  381). Conflacionar filas es irreversible.
- **A4 — Extender `CajaPagoTiendaFeedService` con dos métodos.** Rompe las dos guardias que fijan su
  lista exacta y le da a `LiquidacionService` acceso a categorías que no son suyas.
- **A5 — Cuarta cubeta «Pagado por la tienda» en el desglose.** Cambia `DesgloseTiendaDTO` y las dos
  cabeceras: es rediseño y lo decide la maqueta de la 458.
- **A6 — Validar la firma binaria del archivo (magic bytes).** Solo suben maestro/admin, el bucket es
  privado y se sirve por URL firmada: el riesgo no justifica la primera validación de ese tipo del
  repo. Se queda la de MIME + tamaño, que es la del repo.
- **A7 — Subir el comprobante DESPUÉS de confirmar la transacción.** Un fallo de subida dejaría un
  documento que dice tener comprobante sin tenerlo. Subir antes y compensar es el patrón del repo.

## 13. Decisiones abiertas

Ver «Preguntas abiertas» Q1-Q7 de `requirements.md`. Todas llevan decisión tomada y alternativa.

## 14. Medición de solo lectura en PRODUCCIÓN (la corre el leader por el MCP de Supabase)

Todas son `SELECT`. Resultado a `progress/medicion_457.md` antes de escribir los `down.sql`.

```sql
-- M1 — tiendas con saldo en contra (se espera Nuform ≈ -6170666.55)
SELECT u.nombre, u.primer_apellido, u.estado::text AS estado,
       SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE 0 END)        AS creditos,
       SUM(CASE WHEN m.tipo = 'debito'  THEN m.monto ELSE 0 END)        AS debitos,
       SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE -m.monto END) AS saldo,
       COUNT(*)                                                         AS movimientos
FROM wallet_tienda_movimiento m
JOIN usuario u ON u.id = m.tienda_id
GROUP BY u.id, u.nombre, u.primer_apellido, u.estado
HAVING SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE -m.monto END) < 0
ORDER BY saldo ASC;

-- M2 — de qué se compone la deuda de Nuform (por concepto)
SELECT m.categoria::text, m.tipo::text, COUNT(*) AS filas, SUM(m.monto) AS total
FROM wallet_tienda_movimiento m
JOIN usuario u ON u.id = m.tienda_id
WHERE u.nombre ILIKE 'nuform%'
GROUP BY 1, 2 ORDER BY 1, 2;

-- M3 — catálogos de enum de hoy, en su orden real (para los down.sql)
SELECT t.typname, COUNT(*) AS n, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS valores
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname IN ('wallet_tienda_movimiento_categoria', 'wallet_movimiento_categoria',
                    'wallet_origen_tipo', 'historial_accion_tipo', 'historial_accion_entidad')
GROUP BY t.typname ORDER BY t.typname;

-- M4 — los dos CHECK tipo<->categoria tal como están
SELECT conrelid::regclass AS tabla, conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conname IN ('wallet_tienda_movimiento_tipo_categoria_check',
                  'wallet_movimiento_tipo_categoria_check');

-- M5 — buckets existentes (¿existe ya uno de comprobantes? ¿restringe MIME el de evidencias?)
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets ORDER BY id;

-- M6 — LÍNEA BASE de la caja y del libro de tienda (se repite tras desplegar: debe ser idéntica,
--      porque desplegar no escribe ni una fila)
SELECT 'caja' AS libro, categoria::text, tipo::text, COUNT(*) AS filas, SUM(monto) AS total
FROM wallet_movimiento GROUP BY 2, 3
UNION ALL
SELECT 'tienda', categoria::text, tipo::text, COUNT(*), SUM(monto)
FROM wallet_tienda_movimiento GROUP BY 2, 3
ORDER BY 1, 2, 3;

-- M7 — línea base del pago a tiendas y sus anulaciones (R63/R68)
SELECT (SELECT COUNT(*) FROM liquidacion_pago WHERE tienda_id IS NOT NULL) AS pagos_a_tienda,
       (SELECT COUNT(*) FROM liquidacion_anulacion a JOIN liquidacion_pago p ON p.id = a.pago_id
         WHERE p.tienda_id IS NOT NULL)                                      AS anulados,
       to_regclass('public.abono_tienda')                                   AS tabla_abono_ya_existe;
```

## 15. Trazabilidad R → test (el implementer la copia a `progress/impl_457.md` con rutas finales)

| R | Test (archivo propuesto) |
| --- | --- |
| R1, R16, R17, R19 | `tests/integration/db/abono-tienda.test.ts` — registra y lee las 4 escrituras en Postgres |
| R2, R3 | `tests/unit/services/abono-tienda-service.test.ts` (ningún repo llamado) + `tests/unit/actions/abono-tienda-action.test.ts` |
| R4, R5, R6, R7, R8, R9, R12 | `tests/unit/types/abono-tienda-schema.test.ts`; R5 además en la integración (string exacto en las 3 tablas) |
| R10, R11 | `abono-tienda-service.test.ts` |
| R13, R14, R61 | `abono-tienda-service.test.ts` + integración (saldo ≤ 0 tras registrar) |
| R15, R35 | `tests/integration/db/abono-tienda-concurrencia.test.ts` (abono ∥ abono y abono ∥ pago a tienda) |
| R18, R36 | `tests/unit/utils/caja-tesoreria.test.ts` (ganancia igual, en caja y terceros suben) |
| R20 | `tests/unit/utils/descripcion-abono.test.ts` |
| R21 | integración: cero filas en otras tiendas, en `pago_mensajero_movimiento` y en categorías propias |
| R22 | `abono-tienda-service.test.ts` + integración (doble envío = 1 fila por tabla, archivo compensado) |
| R23, R24, R25, R26, R27 | `tests/unit/services/abono-tienda-comprobante.test.ts` (doble de `IFileStorage`) |
| R28, R29, R30, R31, R32, R33, R34, R37 | `tests/unit/services/abono-tienda-anulacion.test.ts` + integración; R37 = lista exacta de exportaciones de `lib/actions/abono-tienda.ts` |
| R38, R39, R40, R41, R42 | `tests/integration/db/abono-tienda-lectura.test.ts` (el WHERE por tienda en Postgres) + `abono-tienda-action.test.ts` |
| R43, R44, R45 | `abono-tienda-comprobante.test.ts` |
| R46, R47, R49, R50, R51 | `tests/unit/components/mi-wallet-labels.test.ts`, `desglose-tienda-labels.test.ts`, `tests/unit/descarga/*-descarga-columnas.test.ts` (literal: el texto ES el contrato) |
| R48 | `tests/components/descarga/WalletDescarga.test.tsx` + test de `wallet-labels` |
| R52, R66 | `tests/unit/utils/desglose-tienda.test.ts` (cabecera = saldo derivado, con y sin abonos) |
| R53 | tests de labels de las dos pantallas (literal) |
| R54 | `tests/unit/components/desglose-tienda-ledger.test.tsx` |
| R55 | `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts` |
| R56, R57, R58, R59 | `catalogo-y-choke-point.test.ts`, `historial-accion-escrituras-cubiertas.guardia.test.ts`, `historial-accion-sin-datos-cliente.guardia.test.ts` |
| R60, R62 | `tests/unit/guards/abono-tienda-alcance.guardia.test.ts` (§10) + integración Σ libro = Σ caja |
| R63, R64, R65, R67, R68 | FASE 0 (`tests/unit/caracterizacion/457-*.test.ts` + los existentes, con mutaciones) |
| R69 | `tests/integration/db/abono-tienda-migration.test.ts` |
| R70 | `abono-tienda-migration.test.ts` (`relrowsecurity = true`) |
