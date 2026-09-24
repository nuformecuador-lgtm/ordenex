# Ficha 459 — Diseño técnico

> **Búsqueda.** MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) para localizar
> consumidores y escritores (`trace_path` de `derivarCaja`, `search_graph`), y **cada símbolo
> confirmado en el archivo real** el 2026-09-24 sobre `dev` (`3c1ae150`). Las referencias
> `archivo:línea` son de esa lectura. Las cifras de producción son las de
> `progress/medicion_457.md` (M6) y `progress/verificacion_caja.md`: son una **foto** y el contraste
> de §11 las vuelve a medir.

## 0. En una frase

La caja deja de sumar dos veces lo que Ordenex se queda de cada contra-entrega (un cambio de
**derivación**, sin tocar filas), gana los dos movimientos que faltaban (**pago por cuenta de una
tienda** y **saldo inicial o aporte de capital**), recibe las salidas de los 203 cobros que eran
pagos por cuenta (**migración de datos** con lista aprobada), y su tarjeta dice la verdad sobre lo
que sabe: un **flujo registrado** mientras nadie teclee un saldo inicial.

**Principio rector:** arreglar lo evidenciado, no rediseñar el dinero. El saldo de cada tienda, la
ganancia, los mensajeros y todos los caminos de escritura existentes se quedan como están (HF2); la
fase 0 lo fija con literales y mutaciones antes de tocar nada.

## 1. Lo medido

### 1.1 F1 — el cobro de un costo no toca la caja

`lib/services/CobroTiendaService.ts:120-133` escribe una sola fila `debito/cobro_manual` en el libro
de la tienda; el constructor (`:66-71`) no recibe ningún puerto de caja. Los 203 cobros de Nuform
son pagos por cuenta (HF1): faltan ₡25.769.034,50 de salidas de dinero **de las tiendas** en la
caja. No tocan la ganancia.

### 1.2 F2 — el doble conteo, en la derivación

Al aprobar un cierre, en la misma transacción: `WalletFeedService.ts:95-104` mete flete, comisión e
impuestos como ingresos **propios** de la caja; `WalletTiendaFeedService.ts:132-161` acredita a la
tienda el contra-entrega completo y le debita esos mismos conceptos con la misma función
(`derivarIngresoOrden`); `CajaCodFeedService.ts:37-74` mete en la caja el crédito completo como
`ingreso_cod_recaudado` (terceros). `derivarCaja` (`lib/utils/caja-tesoreria.ts:202-232`) hace
`enCaja = entradas − salidas` sumando las dos cosas (`:105-121`, `:208`). El cobro por rechazo
(`RechazoTiendaCobroService.ts:199-206`, `:289-318`) sigue el mismo patrón sin que entre efectivo.

Resultado medido: «Dinero en caja» y «De terceros» llevan dentro ₡8.070.773,47 que no son efectivo
(la parte de Ordenex del contra-entrega, o una deuda de la tienda cuando no hubo contra-entrega).
La pantalla lo admite sin decirlo: `CAJA_RESUMEN_AVISO_TERCEROS` (`wallet-labels.ts:123-126`).

### 1.3 Lo que está bien y se conserva (HF2)

`derivarSaldoTienda` / `derivarDesgloseTienda` (libro de tiendas), la ganancia (`derivarCaja` rama
propia y `derivarComposicionGanancia`, `caja-tesoreria.ts:343-388`), la cuenta por pagar de los
mensajeros, pagos y su anulación (172/205), gastos fijos (333), cobros por rechazo (337), premios
(293), cierres (42/43/44/158/173).

## 2. La derivación nueva

### 2.1 Qué es cada cifra

| Cifra | Definición | Antes |
| --- | --- | --- |
| **Entró** | Σ ingresos de la caja **que no son cargos a una tienda** | Σ de todos los ingresos |
| **Salió** | Σ de todos los egresos | igual |
| **Cifra principal** | Entró − Salió | igual (pero con el Entró de antes) |
| **Ganancia de Ordenex** | ingresos propios − egresos propios (los cargos SON ingresos propios) | **sin cambio** |
| **De las tiendas** | ingresos de terceros − egresos de terceros − **cargos a una tienda** | ingresos − egresos de terceros |
| **Capital de Ordenex** | ingresos de capital − egresos de capital | no existía |
| **De Ordenex** | ganancia + capital | era la ganancia |

**Cómo se tratan los ingresos propios (la decisión que pidió el encargo).** Un cargo a una tienda no
es una entrada de efectivo: es un **traspaso** de dinero que ya está en la caja (el contra-entrega,
que es de la tienda) al bolsillo de Ordenex; y si la orden no tuvo contra-entrega (prepagada, o
rechazada), es una **deuda de la tienda** que se cobra reduciendo su saldo. En los dos casos el
efecto es el mismo: la ganancia sube, «De las tiendas» baja lo mismo, y el efectivo no cambia. Eso
es exactamente lo que el libro de las tiendas ya registra con su débito espejo.

### 2.2 Cómo se implementa sin una sola resta nueva

`lib/utils/caja-tesoreria.ts`:

1. **Tercer dueño**: `NaturalezaMovimiento = "propio" | "terceros" | "capital"` (el tipo vive en
   `lib/types/wallet.ts:213`). `NATURALEZA_POR_CATEGORIA` clasifica los 4 conceptos nuevos de caja
   (§5).
2. **Nuevo `Record` TOTAL** `LIQUIDEZ_POR_CATEGORIA: Record<WalletMovimientoCategoria, "efectivo" |
   "cargo_a_tienda">`. `cargo_a_tienda` exactamente en los seis de `WALLET_INGRESO_CONCEPTO_SEED`
   (`lib/types/wallet.ts:102-109`); el resto `efectivo`. Una guardia afirma que el conjunto
   `cargo_a_tienda` **es** ese seed y que todos son `propio` e `ingreso` (R1, R9).
3. `acumular` gana tres acumuladores: `entradasEfectivo`, `cargosATiendas`, `ingresosCapital` /
   `egresosCapital`. Solo **suma** en cubetas; no resta.
4. `derivarCaja` llama a `derivarBalance` **cuatro** veces:
   - `caja = derivarBalance(entradasEfectivo, salidas)` → Entró, Salió, cifra principal.
   - `propio = derivarBalance(ingresosPropios, egresosPropios)` → ganancia (**idéntica**).
   - `terceros = derivarBalance(ingresosTerceros, egresosTerceros + cargosATiendas)` → los cargos
     entran como una salida del bolsillo de las tiendas: es el traspaso de §2.1.
   - `capital = derivarBalance(ingresosCapital, egresosCapital)`.
   - `deOrdenex = propio.balance + capital.balance` (suma, `montoEscala2`).
5. `derivarReparto(caja, deOrdenex, terceros)` — la misma función de cuatro ramas, con «De Ordenex»
   en vez de la ganancia (R11). La división de la rama 4 sigue protegida: allí `cifra = O + T > 0`.

**Identidad (R7), por construcción:** G + T + C = (ingP − egP) + (ingT − egT − cargos) + (ingC − egC)
= (ingP + ingT + ingC − cargos) − (egP + egT + egC) = Entró − Salió. Vale para cualquier subconjunto,
con filtros o sin ellos.

La guardia `tests/unit/guards/caja-derivaciones.guardia.test.ts:122-128` exige hoy **tres** llamadas
a `derivarBalance`; pasa a **cuatro** en el mismo commit, con el comentario de esta ficha (es la
propiedad «no hay restas propias» la que protege; la cuenta es su síntoma).

### 2.3 La invariante (R8) y por qué se cumple

Con `S` = Σ saldos del libro de tiendas (créditos − débitos) y `T` = «De las tiendas»:

| Libro de tiendas | Contrapartida en la caja | Efecto en S | Efecto en T |
| --- | --- | --- | --- |
| `cod_recaudado` (crédito) | `ingreso_cod_recaudado` (terceros, efectivo) | + | + |
| `ajuste_credito` (crédito, anulación de pago a tienda) | `ingreso_reverso_pago_tienda` | + | + |
| `pago_por_cuenta_anulado` (crédito) **nuevo** | `ingreso_reverso_pago_por_cuenta_tienda` **nuevo** | + | + |
| 6 cargos (débito) | 6 `ingreso_*` propios, cargo a tienda | − | − |
| `pago_tienda` (débito) | `egreso_pago_tienda` (terceros) | − | − |
| `pago_por_cuenta` (débito) **nuevo** | `egreso_pago_por_cuenta_tienda` **nuevo** | − | − |
| `cobro_manual` (débito) | **ninguna** (HF6), salvo los reclasificados | − | 0 / − |
| `ajuste_debito` (débito, sin productor) | ninguna | − | 0 |

Por tanto `T − S = Σ cobros de un costo no reclasificados + Σ ajuste_debito (0) + (Σ cargos de la
tienda − Σ cargos de la caja)`. El último término es 0 si los dos libros redondean igual y el
interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` está encendido (P15); el contraste C2 lo comprueba
cierre por cierre. Esa tabla es literalmente el `Record` de la guardia de R90 (§12.3).

### 2.4 Demostración con los números de producción (M6, 2026-09-24)

| | Hoy (app) | Fórmula nueva, sin reclasificar | + los 203 reclasificados | + un saldo inicial S (si algún día) |
| --- | --- | --- | --- | --- |
| Entró | 37.129.997,47 | 29.059.224,00 | 29.059.224,00 | 29.059.224,00 + S |
| Salió | 12.476.410,00 | 12.476.410,00 | 38.245.444,50 | 38.245.444,50 |
| **Cifra principal** | 24.653.587,47 «Dinero en caja» | 16.582.814,00 «Flujo de dinero registrado» | **−9.186.220,50** «Flujo…» | S − 9.186.220,50 «Dinero en caja» |
| Ganancia | −4.405.636,53 | −4.405.636,53 | −4.405.636,53 | −4.405.636,53 |
| De las tiendas | 29.059.224,00 | 20.988.450,53 | **−4.780.583,97** | −4.780.583,97 |
| Capital | — | 0,00 | 0,00 | S |
| Σ saldos de tiendas (medido) | −4.780.583,97 | −4.780.583,97 | −4.780.583,97 | −4.780.583,97 |
| Σ cobros sin reclasificar | 25.769.034,50 | 25.769.034,50 | 0,00 | 0,00 |
| **Diferencia R8** | — | 20.988.450,53 − (−4.780.583,97 + 25.769.034,50) = **0,00** | −4.780.583,97 − (−4.780.583,97 + 0) = **0,00** | 0,00 |
| Identidad R7 | — | −4.405.636,53 + 20.988.450,53 + 0 = 16.582.814,00 ✓ | −4.405.636,53 − 4.780.583,97 = −9.186.220,50 ✓ | ✓ |

- Entró de hoy: 29.059.224,00 + 8.070.773,47 (flete 4.372.000 + comisión 1.017.074,04 + flete por
  rechazo 1.753.200 + IVA flete 568.360 + IVA comisión 132.223,43 + IVA flete por rechazo 227.916).
- El sobrante de hoy, 24.653.587,47 − 16.582.814,00 = 8.070.773,47, es exactamente la suma de los
  cargos (F2).
- S **no se estima** (HF4): la columna es simbólica.
- Si el humano rechaza K de la lista, la columna 3 queda T = −4.780.583,97 + K y la invariante sigue
  en 0,00 porque esos K siguen siendo cobros sin reclasificar.

### 2.5 Estado de la caja: «flujo» o «saldo» (R14–R22)

- `WalletService.verResumenCaja` (`WalletService.ts:168-178`) lee además, **sin filtros**:
  `haySaldoInicialVigente` (existe un `aporte_capital` de clase `saldo_inicial` sin anulación) y
  `primerDiaDeLaCaja` (el día CR del `MIN(fecha_movimiento)` del libro). Dos consultas mínimas
  (índice `wallet_movimiento_fecha_movimiento_idx`; `aporte_capital` es una tabla diminuta).
- `derivarCaja(filas, { periodoFiltrado, haySaldoInicialVigente, primerDia })` las pasa al DTO como
  hoy pasa `periodoFiltrado` (el dato es de la consulta, no del dinero):
  `estado = haySaldoInicialVigente ? "saldo" : "flujo"`, `flujoDesde = primerDia`.
- **El número no cambia con el estado**; cambia el nombre y lo que la tarjeta explica. El estado
  «saldo» solo lo produce un saldo inicial tecleado por una persona (R27): la app nunca calcula uno.

### 2.6 Contrato `CajaResumenDTO` (`lib/types/wallet.ts:270-298`)

Se conservan todos los campos (con el `entradas` nuevo de R2) y se añaden, todos STRING salvo el
estado:

```ts
capital: string;               // R6
signoCapital: WalletBalanceSigno;
deOrdenex: string;             // ganancia + capital (R11)
signoDeTerceros: WalletBalanceSigno;
deTercerosAbsoluto: string;    // |deTerceros|, para «Las tiendas le deben ₡X» sin aritmética en el navegador (R23, R28)
estado: "flujo" | "saldo";     // R14
flujoDesde: string | null;     // YYYY-MM-DD (Costa Rica) del primer movimiento; null si el libro está vacío
```

`tests/integration/wallet-page.test.tsx` barre el resumen exigiendo STRING salvo `periodoFiltrado`:
la excepción se amplía a `estado` y `flujoDesde` (null) en el mismo commit, a conciencia.

## 3. La tarjeta (`CajaResumenCard.tsx`) y sus textos

### 3.1 Qué cambia

| Parte | Estado «flujo» | Estado «saldo» | Con filtros |
| --- | --- | --- | --- |
| Rótulo de la cifra principal (y `aria-label` de su región) | «Flujo de dinero registrado» | «Dinero en caja» | «Movimiento neto del periodo» |
| Pista | «Lo que entró menos lo que salió desde el {día}. No es el saldo del banco: la app no sabe con cuánto dinero empezó Ordenex.» | «El saldo inicial registrado más todo lo que entró menos todo lo que salió desde entonces, incluido el dinero de las tiendas.» | la de hoy |
| Línea si es negativa | «Sale negativo porque parte de los pagos se hicieron con dinero que Ordenex ya tenía antes de usar la app, y ese dinero no está registrado aquí.» | «El dinero en caja no puede ser negativo. Revisá el saldo inicial y los pagos registrados.» | — |
| Barra y mensajes de la barra | **no se pintan** | se pintan | se pintan si «saldo» |
| Bolsillo de las tiendas | igual en los dos estados (§3.3) | | |
| Bolsillo de Ordenex | Ganancia (sin cambios) + región nueva «Saldo inicial y aportes» | igual | igual |

`{día}` = `fechaLegible(flujoDesde)` + año, como `proximoCobroTexto` (`wallet-labels.ts:387-391`).
Si `flujoDesde` es null (libro vacío), la pista dice «Todavía no hay movimientos registrados.».

### 3.2 La identidad en pantalla

`tests/components/DineroIdentidadesEnPantalla.test.tsx:298-339` afirma hoy «terceros + ganancia =
en caja». Pasa a **«terceros + ganancia + capital = cifra principal»**, leída del DOM, con un
conjunto de prueba con céntimos y capital distinto de cero, en el mismo commit (es el contrato).

### 3.3 Textos exactos (en `wallet-labels.ts`, fuera del JSX)

```
CAJA_RESUMEN_LABEL.flujo            = "Flujo de dinero registrado"
CAJA_RESUMEN_LABEL.flujoPista(día)  = "Lo que entró menos lo que salió desde el {día}. No es el saldo del banco: la app no sabe con cuánto dinero empezó Ordenex."
CAJA_RESUMEN_LABEL.flujoVacio       = "Todavía no hay movimientos registrados."
CAJA_RESUMEN_AVISO_FLUJO_NEGATIVO   = "Sale negativo porque parte de los pagos se hicieron con dinero que Ordenex ya tenía antes de usar la app, y ese dinero no está registrado aquí."
CAJA_RESUMEN_LABEL.enCaja           = "Dinero en caja"                              (sin cambio)
CAJA_RESUMEN_LABEL.enCajaPista      = "El saldo inicial registrado más todo lo que entró menos todo lo que salió desde entonces, incluido el dinero de las tiendas."
CAJA_RESUMEN_AVISO_SALDO_NEGATIVO   = "El dinero en caja no puede ser negativo. Revisá el saldo inicial y los pagos registrados."
CAJA_RESUMEN_LABEL.enCajaPeriodo    = "Movimiento neto del periodo"                 (sin cambio)
CAJA_RESUMEN_LABEL.deTerceros       = "Lo que Ordenex les debe a las tiendas"
CAJA_RESUMEN_TIENDAS_DEBEN(monto)   = "Las tiendas le deben a Ordenex {monto}."
CAJA_RESUMEN_AVISO_TERCEROS         = "Es la suma de los saldos de todas las tiendas, ya descontados el flete, la comisión y el impuesto. Los cobros de un costo a una tienda bajan su saldo sin pasar por la caja. El detalle de cada tienda está en Wallet → Tiendas."
CAJA_RESUMEN_LABEL.capital          = "Saldo inicial y aportes"
CAJA_RESUMEN_LABEL.capitalPista     = "Dinero de Ordenex que no es ganancia."
CAJA_RESUMEN_NOTA_DIFERENCIA(rótulo)= "«{rótulo}» cuenta todo el dinero, también el que es de las tiendas. «Ganancia de Ordenex» es solo lo que Ordenex gana menos lo que gasta: no incluye el dinero de las tiendas ni el saldo inicial o los aportes."
```

El aviso viejo (`wallet-labels.ts:123-126`, «No es lo que se les debe a las tiendas: es más…») y la
pista vieja («Todo lo que entró y salió, incluido…», `:88`) **desaparecen**; una guardia de textos
lo vigila (R24).

### 3.4 La barra y sus mensajes

- Nombre accesible: `"Reparto del dinero en caja. De las tiendas: {T}. De Ordenex: {O} (ganancia y aportes)."`
  Solo se pinta en estado «saldo», así que «dinero en caja» es cierto donde aparece (R16).
- `CAJA_COMPOSICION_MENSAJE` (Record total, mismos cuatro modos):
  - `dos_bolsillos`: `null` (sin cambio).
  - `solo_tiendas`: «Lo de Ordenex (ganancia más aportes) está en negativo, así que hay dinero de las tiendas cubriendo ese saldo. Lo que hay en la caja no alcanza para entregarles todo lo suyo.»
  - `solo_ordenex`: «Las tiendas le deben a Ordenex, así que todo lo que hay en la caja es de Ordenex y además hay dinero por cobrarles.»
  - `sin_reparto`: «No hay nada que repartir: ni Ordenex ni las tiendas tienen dinero a favor en la caja.»

## 4. Modelo de datos

Todas las migraciones se escriben **a mano** (`db:migrate:create` falla con P3006 en este repo);
ninguna migración ya aplicada se edita. **Antes de fijar los timestamps, mirar los de `origin/dev`**
(colisión de ids entre sesiones) y usar uno posterior al último de `dev` (hoy
`20260924120200_order_status_retiro_huerfanos`). Nombres propuestos:

1. `20260925120000_caja_459_enums`
2. `20260925120100_historial_accion_459`
3. `20260925120200_pago_por_cuenta_y_capital`
4. `<ts posterior>_reclasificar_cobros_459` — **se escribe solo tras la aprobación de la lista** (§10).

El reparto es obligatorio: Postgres prohíbe usar un valor de enum en la transacción que lo añade
(55P04) y Prisma corre cada `migration.sql` en su propia transacción.

### 4.1 Migración 1 — valores de enum

| Enum | Valor nuevo |
| --- | --- |
| `wallet_movimiento_categoria` | `egreso_pago_por_cuenta_tienda`, `ingreso_reverso_pago_por_cuenta_tienda`, `ingreso_aporte_capital`, `egreso_reverso_aporte_capital` |
| `wallet_tienda_movimiento_categoria` | `pago_por_cuenta` (débito), `pago_por_cuenta_anulado` (crédito) |
| `wallet_origen_tipo` | `pago_por_cuenta_tienda`, `aporte_capital`, `cobro_manual_reclasificado` |

`ALTER TYPE … ADD VALUE IF NOT EXISTS`. **`down.sql`:** recrea los tres tipos con su lista previa
completa (medida con M3 de §11 en local y en producción: hoy 17 / 11 / 8 y deben coincidir en las dos
ramas, porque SF-001 no toca estos tres enums — comprobarlo), soltando y recreando antes/después todo
lo que los nombra: `wallet_movimiento_tipo_categoria_idx`, `wallet_movimiento_origen_categoria_uq`,
`wallet_tienda_movimiento_tienda_id_categoria_idx`, `wallet_tienda_movimiento_origen_uq`,
`pago_mensajero_movimiento_origen_uq` (con su predicado actual de la 293) y los CHECK. Moldes:
`20260803120000_caja_tesoreria/down.sql` (categorías de caja),
`20260908140000_wallet_tienda_categoria_cobro_manual/down.sql` (tienda) y
`20260827120000_premio_ranking_devengo/down.sql` (origen, usado por tres tablas). Precondición
ruidosa: con una fila que use un valor nuevo, el `USING` falla y el rollback aborta sin borrar.
**No se tocan los `down.sql` previos** (fotos históricas).

### 4.2 Migración 2 — historial de acciones

`historial_accion_tipo` + `pago_por_cuenta_tienda_registrado`, `pago_por_cuenta_tienda_anulado`,
`aporte_capital_registrado`, `aporte_capital_anulado` (los cuatro «mueve dinero»).
`historial_accion_entidad` + `pago_por_cuenta_tienda`, `aporte_capital` (1:1 con las tablas nuevas,
criterio de la 381/457).

**`down.sql` dinámico (P12):** estos dos catálogos son distintos en `prod` (52 tipos) y en `dev`
(SF-001 añadió al menos tres). Un `down` con lista fija escrita en `dev` borraría en `prod` valores
que no existen o, peor, en `dev` los de SF-001 si se escribiera en `prod` (lección «el `down.sql`
borra los valores posteriores»). El `down` hace, en un bloque `DO`:

1. `RAISE EXCEPTION` si alguna fila de `historial_accion` usa un valor de esta ficha.
2. Lee `array_agg(enumlabel ORDER BY enumsortorder)` de `pg_enum` para el tipo, **quita solo los
   valores de esta ficha**, y ejecuta con `format()` el `RENAME TO …_old` / `CREATE TYPE … AS ENUM
   (lista)` / `ALTER TABLE historial_accion ALTER COLUMN … TYPE … USING …::text::…` / `DROP TYPE
   …_old`, soltando y recreando los índices de `historial_accion` que nombran la columna (medir cuáles
   con `pg_depend` al implementar; hoy una sola columna depende de cada tipo, según la release del
   2026-09-21).

El test de migración lo prueba en las dos formas: sobre la base local (con SF-001) y sobre una copia
sin los valores de SF-001.

### 4.3 Migración 3 — tablas y restricciones

**`pago_por_cuenta_tienda`** (documento, INMUTABLE: sin `updated_at` ni `deleted_at`)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | text PK | uuid generado por el servicio |
| `clave_idempotencia` | text NOT NULL **UNIQUE** | la genera el diálogo al abrirse |
| `tienda_id` | text NOT NULL FK → `usuario(id)` RESTRICT | |
| `beneficiario` | text NOT NULL | CHECK `btrim(beneficiario) <> '' AND length(beneficiario) <= 120` |
| `monto` | decimal(12,2) | CHECK `monto > 0` |
| `metodo` | enum de método de pago EXISTENTE (el de `liquidacion_pago`; confirmar nombre en `schema.prisma`) | no se toca |
| `referencia` | text NULL | obligatoria si método ≠ efectivo (en el borde, como la 172) |
| `motivo` | text NOT NULL | CHECK `btrim(motivo) <> ''`; tope 200 en el borde |
| `fecha_pago` | date NOT NULL | |
| `comprobante_path`, `comprobante_content_type` | text NULL | CHECK los dos NULL o los dos NOT NULL |
| `registrado_por` | text NOT NULL FK → `usuario(id)` RESTRICT | |
| `created_at` | timestamp(3) DEFAULT now() | |

Índice `(tienda_id, fecha_pago)`. **Solo dos restricciones únicas** (PK y clave), escrito como premisa
en el comentario del modelo (molde `liquidacion_pago`, `schema.prisma:1912-1924`): el repositorio
trata un P2002 sin pista como choque de clave.

**`pago_por_cuenta_tienda_anulacion`**: `id` PK · `pago_id` FK **UNIQUE** RESTRICT · `motivo` NOT NULL
CHECK `btrim <> ''` · `anulado_por` FK RESTRICT · `created_at`. «Anulado» se deriva de que exista la
fila (molde `liquidacion_anulacion`).

**`aporte_capital`**: `id` · `clave_idempotencia` UNIQUE · `clase` text NOT NULL CHECK `clase IN
('saldo_inicial','aporte')` (texto con CHECK y no enum: su `down` es un `DROP TABLE`) · `monto` > 0 ·
`motivo` NOT NULL CHECK · `fecha` date · `comprobante_path/content_type` (par) · `registrado_por` FK
· `created_at`.

**`aporte_capital_anulacion`**: `id` · `aporte_id` FK UNIQUE · `motivo` · `anulado_por` · `created_at`.

**Un solo saldo inicial vigente (R70):** no se puede expresar con un índice (la anulación vive en otra
tabla). El servicio toma `pg_advisory_xact_lock(hashtext('aporte_capital:saldo_inicial'))` al
principio de la transacción y comprueba que no hay otro vigente; un test de dos transacciones reales
lo prueba.

**RLS:** las cuatro con `ENABLE ROW LEVEL SECURITY` sin policies (solo service role), patrón de los
libros (R99).

**Los dos CHECK tipo↔categoría**, recreados como ampliación (valida filas existentes; no puede fallar
por datos previos):

```sql
-- caja (lista de partida: 20260803120000_caja_tesoreria/migration.sql:61-71)
("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
   'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
   'ingreso_cod_recaudado','ingreso_reverso_pago_tienda',
   'ingreso_reverso_pago_por_cuenta_tienda','ingreso_aporte_capital'))
OR ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
   'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
   'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital'))
-- tienda (lista de partida: 20260908140100_wallet_tienda_check_cobro_manual/migration.sql:42-46)
("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado'))
OR ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
   'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta'))
```

**`down.sql`:** los dos CHECK vuelven a su lista previa **primero** (nombran los valores que retira el
`down` de la migración 1), después `DROP TABLE` de las cuatro. Como el `down` de la 1 corre después,
queda sin referencias.

**`db/schema.prisma`:** cuatro modelos, relaciones inversas en `Usuario`, valores de enum. Comprobar
ausencia de drift entre migraciones y datamodel con el procedimiento de la 381. **Tocar migraciones y
`schema.prisma` obliga al gate completo** (`./init.sh`).

## 5. Clasificación de los conceptos nuevos (todos los `Record` y listas)

| Concepto | Libro / tipo | Dueño | Liquidez | Cubeta del desglose | Fuente (`aporte-por-orden`) | Rótulo |
| --- | --- | --- | --- | --- | --- | --- |
| `egreso_pago_por_cuenta_tienda` | caja / egreso | terceros | efectivo | — | `sin_reparto / no_nace_de_un_cierre` | «Pago por cuenta de una tienda» |
| `ingreso_reverso_pago_por_cuenta_tienda` | caja / ingreso | terceros | efectivo | — | idem | «Pago por cuenta anulado» |
| `ingreso_aporte_capital` | caja / ingreso | **capital** | efectivo | — | idem | «Saldo inicial o aporte de capital» |
| `egreso_reverso_aporte_capital` | caja / egreso | capital | efectivo | — | idem | «Saldo inicial o aporte anulado» |
| `pago_por_cuenta` | tienda / débito | — | — | `pagado` (dinero entregado a la tienda a través de un tercero; decisión de la 458 §2.6) | idem | «Pago por cuenta de la tienda» |
| `pago_por_cuenta_anulado` | tienda / crédito | — | — | `aFavor` (como `ajuste_credito`) | idem | «Pago por cuenta anulado» |
| origen `pago_por_cuenta_tienda` | | | | | | caja y tienda: «Pago por cuenta de tienda» |
| origen `aporte_capital` | | | | | | «Saldo inicial o aporte» |
| origen `cobro_manual_reclasificado` | | | | | | «Cobro reclasificado como pago por cuenta» |
| dueño `capital` | | | | | | `DUENO_LABEL`: «Ordenex (capital)» |

Lista completa de lo que se toca (el compilador obliga en los marcados con *; los demás llevan test
propio porque no obligan):

- `lib/types/wallet.ts` — `WALLET_MOVIMIENTO_CATEGORIA_SEED`*, `WALLET_ORIGEN_TIPO_SEED`*,
  `NaturalezaMovimiento`*, `CajaResumenDTO`* (§2.6), `WalletMovimientoDTO.documento` (§7.3).
- `lib/types/wallet-tienda.ts` — `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`*.
- `lib/utils/caja-tesoreria.ts` — `NATURALEZA_POR_CATEGORIA`*, `LIQUIDEZ_POR_CATEGORIA`* (nuevo),
  `derivarCaja`, `derivarReparto`.
- `lib/utils/invariante-tiendas.ts` (nuevo) — `CONTRAPARTIDA_EN_CAJA`* y `TIPO_POR_CATEGORIA_TIENDA`*
  (§12.3).
- `lib/utils/desglose-tienda.ts` — `CUBETA_POR_CATEGORIA`*.
- `lib/utils/aporte-por-orden.ts` — `FUENTE_CAJA`*, `FUENTE_TIENDA`*.
- `lib/utils/finanzas-diarias.ts` — `ingresos` = entradas de efectivo (R13).
- `app/(app)/wallet/_components/wallet-labels.ts` — `CATEGORIA_LABEL`*, `ORIGEN_LABEL`*,
  `DUENO_LABEL`*, textos de §3.3–§3.4.
- `app/(app)/wallet/_components/WalletLedger.tsx` — `DUENO_PUNTO`* (token semántico existente para
  capital), acciones «Anular…» / «Ver comprobante» (R66, R67).
- `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` — `CATEGORIA_TIENDA_LABEL`*, y
  **`ORIGEN_TIENDA_LABEL`** (es `Record<string,string>` con caída al valor crudo: el compilador NO
  avisa) + pistas de «A tu favor» y «Pagado/Ya pagado» que nombren el pago por cuenta y su anulación.
- `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts` — las mismas pistas en la vista
  de acceso total.
- `lib/analytics/metrics.ts` — `dinero_en_caja` (+4 categorías y descripción nueva), `egresos` (+
  `egreso_pago_por_cuenta_tienda`, P13), `cuenta_por_pagar_tienda` (+2), `ganancia_ordenex` **no**.
- `lib/types/historial-accion.ts` y sus etiquetas — 4 tipos, 2 entidades, conteos.

## 6. Servicios

### 6.1 `PagoPorCuentaTiendaService` (`lib/services/`)

Servicio propio (molde `AbonoTiendaService` de la 457 y `CobroTiendaService` de la 381; no métodos en
`LiquidacionService`, cuyas guardias fijan su lista exacta de categorías).

```ts
constructor(
  pagoRepo: IPagoPorCuentaTiendaRepository,
  tiendaRepo: Pick<IWalletTiendaMovimientoRepository, "crearMovimientos" | "agregarSaldoPorTienda">,
  candado: Pick<ILiquidacionPagoRepository, "bloquearBeneficiario">,   // R42: el MISMO candado del pago a tienda
  usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
  caja: ICajaPagoPorCuentaFeedService,                                  // obligatorio: sin caja no se construye
  comprobantes: IFileStorage,
  runTransaction: PagoPorCuentaTxRunner,
  ahora: () => Date = () => new Date(),
)
```

**`registrar(input, comprobante | null, actor)`** — el orden es parte del requisito:

1. Rol (`esAccesoTotal`) antes de leer nada → `forbidden` (R38).
2. Escala 2 una vez: `montoStr` (money-safe; el mismo string va a las cuatro escrituras).
3. Tienda (`obtenerCuentaTienda`): inexistente / no `adminTienda` / no `activo` → `validation_error`
   bajo `tiendaId` (R36, P4). Mensajes de `CobroTiendaService.ts:28-32`.
4. Comprobante (si viene): validar tipo y tamaño; subir (§8). Fallo → `comprobante_no_guardado` (R56).
5. `runTransaction`: `candado.bloquearBeneficiario(tx, { tipo: "tienda", tiendaId })` (R42) →
   `pagoRepo.crear(tx, …)` (documento + fila de historial `pago_por_cuenta_tienda_registrado` en el
   MISMO método; choque de clave → `ClaveRepetidaError`) → `tiendaRepo.crearMovimientos(tx, [{ tipo:
   "debito", categoria: "pago_por_cuenta", origenTipo: "pago_por_cuenta_tienda", origenId: pago.id,
   monto: montoStr, descripcion, registradoPor, fechaMovimiento }])` →
   `caja.emitirEgresoDePagoPorCuenta(tx, { pagoId, monto: montoStr, descripcion: descripcionEnCaja,
   registradoPor, fechaMovimiento })`.
6. Saldo derivado DESPUÉS → `ok { pago, saldo }` (R40: sin tope; puede ser negativo).
7. Fuera de la transacción, ante cualquier desenlace distinto de `ok`: `compensarEvidencias(storage,
   [path])` (`lib/services/evidencias-compensadas.ts`) y, si fue clave repetida, `ya_registrado`
   releyendo por clave (R41, R56).

**Fecha (R35):** `fechaMovimiento = instanteDelMovimientoManual(fecha)`
(`lib/utils/fecha-movimiento-manual.ts:35-41`), la MISMA para las dos filas: hoy → `DEFAULT
now()`; un día anterior → inicio del día CR (06:00Z), la convención de la caja que el rollup diario
entiende. Ventana: la de `problemaDeFechaMovimiento` (`lib/types/wallet.ts:418-424`, 30 días por
configuración).

**`anular({ pagoId, motivo }, actor)`**: rol → leer el documento fuera (inmutable; hace falta la
tienda) → `no_encontrado` → transacción: candado de la tienda → `pagoRepo.anular(tx, …)` (fila de
anulación + historial `pago_por_cuenta_tienda_anulado`; choque del UNIQUE → `ya_anulado` releído
fuera) → crédito `pago_por_cuenta_anulado` por el monto DEL DOCUMENTO con el mismo origen (idempotente
por `wallet_tienda_movimiento_origen_uq`) → `caja.emitirReversoDePagoPorCuenta(…)`
(`ingreso_reverso_pago_por_cuenta_tienda`, mismo origen). Las dos filas con el mismo instante
`ahora()` (hoy CR, R47). El comprobante no se borra.

**Descripciones** (`lib/utils/descripcion-pago-por-cuenta.ts`, puras, R43):
- libro de tienda: `«A {beneficiario} · {motivo} · {Método}[ · {referencia}]»`;
- caja: `«{Tienda} · A {beneficiario} · {motivo} · {Método}[ · {referencia}]»`;
- anulación: el mismo texto precedido de `«Anulación · »` (el motivo de la anulación vive en su tabla).
Test que prohíbe forma de uuid.

### 6.2 `AporteCapitalService`

Mismo molde, sin tienda ni candado de tienda:

1. Rol → 2. escala 2 → 3. clase y fecha (no futura; **sin ventana hacia atrás**, P7) →
4. si `clase = saldo_inicial`: la fecha no puede ser posterior a `primerDiaDeLaCaja(sin capital)` (R71)
   → 5. comprobante → 6. transacción: `pg_advisory_xact_lock(...)` → si `saldo_inicial` y ya hay uno
   vigente → `ya_hay_saldo_inicial` (R70) → `aporteRepo.crear` (+ historial) →
   `caja.emitirIngresoDeCapital` (`ingreso_aporte_capital`, origen `aporte_capital`) → 7. compensación.
- **`anular`**: fila de anulación + historial → `caja.emitirReversoDeCapital`
  (`egreso_reverso_aporte_capital`) fechado hoy CR.
- **R27:** ningún método del servicio ni de la action devuelve un importe «sugerido».

### 6.3 Puertos de caja

`CajaPagoPorCuentaFeedService` y `CajaAporteCapitalFeedService` (molde exacto de
`CajaPagoTiendaFeedService`): `tipo`/`categoria`/`origenTipo` escritos como literales dentro de la
clase, `IWalletMovimientoRepository` encapsulado. Dos métodos cada uno. Las guardias de la 173 que
fijan la lista exacta de `CajaPagoTiendaFeedService`
(`tests/unit/services/liquidacion-caja-puerto.test.ts:195`,
`tests/unit/guards/liquidacion-alcance.test.ts:286`) **no se tocan**.

### 6.4 Repositorios

`PagoPorCuentaTiendaRepository` / `AporteCapitalRepository`: `crear` (documento + historial, un tipo
por método: la guardia del censo mide POR MÉTODO), `anular`, `obtenerPorClave`, `obtenerPorId`,
`estadoDeDocumentos(ids)` (para §7.3: `{ id, anulado, tieneComprobante }` en una consulta),
`haySaldoInicialVigente()`. `WalletMovimientoRepository` gana `primerDiaDeLaCaja({ excluirCapital })`.

## 7. Server Actions y contratos

### 7.1 `lib/actions/pago-por-cuenta-tienda.ts` (archivo nuevo)

Archivo nuevo y no `wallet-tienda.ts` / `liquidacion.ts`, que tienen tests de lista exacta de
exportaciones. Molde: `resolveActorFromSession` → `UnauthenticatedError` antes del servicio →
`schema.parse` (zod `.strict()`) → servicio bajo `withErrorHandler`. El `buildService()` inyecta el
puerto de caja REAL y el storage del bucket, y un test de integración que pasa POR LA ACTION comprueba
las filas en Postgres (el composition root que no inyecta ya costó 2 de 7 notificadores).

| Acción | Entrada | Salida (`status`) |
| --- | --- | --- |
| `registrarPagoPorCuentaTiendaAction(formData)` | `claveIdempotencia` uuid, `tiendaId` uuid (lo pone el selector), `beneficiario`, `monto` string, `metodo`, `referencia?`, `motivo`, `fecha?` (YYYY-MM-DD CR), `comprobante?` File | `ok {pago, saldo}` · `ya_registrado {pago, saldo}` · `comprobante_no_guardado` · `forbidden` · `validation_error {fieldErrors}` · `unauthenticated` |
| `anularPagoPorCuentaTiendaAction({ pagoId, motivo })` | `.strict()` | `ok {saldo}` · `ya_anulado` · `no_encontrado` · `forbidden` · `validation_error` · `unauthenticated` |
| `obtenerComprobantePagoPorCuentaAction({ pagoId })` | `.strict()`; acceso total o la tienda dueña | `ok {url}` · `sin_comprobante` · `no_encontrado` · `forbidden` · `unauthenticated` |

### 7.2 `lib/actions/aporte-capital.ts` (archivo nuevo)

| Acción | Entrada | Salida |
| --- | --- | --- |
| `registrarAporteCapitalAction(formData)` | `claveIdempotencia`, `clase` (`saldo_inicial`/`aporte`), `monto`, `fecha`, `motivo`, `comprobante?` | `ok {aporte}` · `ya_registrado` · `ya_hay_saldo_inicial` · `comprobante_no_guardado` · `forbidden` · `validation_error` · `unauthenticated` |
| `anularAporteCapitalAction({ aporteId, motivo })` | `.strict()` | `ok` · `ya_anulado` · `no_encontrado` · … |
| `obtenerComprobanteAporteCapitalAction({ aporteId })` | `.strict()`; solo acceso total | `ok {url}` · `sin_comprobante` · `no_encontrado` · … |

DTOs sin `tiendaId`, sin ids de usuario, sin clave ni ruta. Montos siempre STRING.

### 7.3 El libro de la caja

`WalletMovimientoDTO` gana `documento: { tipo: "pago_por_cuenta_tienda" | "aporte_capital";
anulado: boolean; tieneComprobante: boolean } | null`, resuelto en `WalletService` **en lote** (una
consulta por tipo de documento presente en la página) solo para las filas ORIGINALES
(`egreso_pago_por_cuenta_tienda` / `ingreso_aporte_capital` con su origen). El id del documento ya
viaja como `origenId` y no se pinta (H6). Las filas con origen `cobro_manual_reclasificado`, los
contra-asientos y las del resto de orígenes llevan `documento: null` (R66). Las descargas NO incluyen
`documento` (R58, R100).

## 8. El comprobante (pieza compartida con la 457)

- `lib/config/wallet-comprobante.ts` (patrón `lib/config/gestion.ts`): `WALLET_COMPROBANTE_BUCKET`
  (defecto `wallet-comprobantes`), `WALLET_COMPROBANTE_MAX_BYTES` (4 MB: el tope de Server Actions
  es `bodySizeLimit: "5mb"` con el multipart, `next.config.ts:74`, y no se toca), tipos
  `image/jpeg|png|webp`, `application/pdf`, TTL de la URL firmada (defecto 300 s).
- Entrada en `BUCKETS` (`lib/storage/buckets.ts:10-17`).
- `lib/utils/comprobante.ts` — validación pura compartida entre borde y servicio, y ruta aleatoria:
  `pagos-por-cuenta/<randomUUID()>.<ext>` y `aportes-capital/<randomUUID()>.<ext>` (R55).
- Subida `IFileStorage.upload`; compensación `compensarEvidencias`; lectura por URL firmada.
- **Operaciones:** el bucket NO existe (M5 de la 457) y ninguna migración crea buckets: crearlo
  privado en local, preview (solo el humano) y producción (leader por MCP o humano) **antes** de
  desplegar el bloque B. Sin bucket, registrar SIN comprobante funciona y CON comprobante responde
  `comprobante_no_guardado`: falla ruidoso.

## 9. El diálogo «Registrar movimiento» (`RegistrarMovimientoCajaDialog.tsx`)

### 9.1 Catálogo (`wallet-conceptos-manuales.ts:36-144`)

`CONCEPTO_MANUAL_IDS` pasa de 5 a 7, en tres tramos consecutivos para el agrupado del `Select`
(`components/ui/select.tsx:10-21`, `:160-171`):

| Grupo | Conceptos (en orden) |
| --- | --- |
| «Sale dinero de la caja» | Gasto variable · Sueldo · **Pago por cuenta de una tienda** · Ajuste que resta dinero |
| «Entra dinero a la caja» | **Saldo inicial o aporte de capital** · Ajuste que suma dinero |
| «No mueve la caja» | Cobrar un costo a una tienda |

El concepto inicial sigue siendo «Gasto variable». `DestinoConcepto` gana dos clases
(`pago_por_cuenta_tienda`, `aporte_capital`) — la unión discriminada obliga al diálogo a enrutarlas.
`LibroDestino` gana `"caja_y_tienda"` para el pago por cuenta; `CABECERA_POR_LIBRO` y
`FRASE_DEL_LIBRO` ganan su entrada (título «Pago por cuenta de una tienda»; frase «Se registra en la
caja como «Pago por cuenta de una tienda» y en el libro de la tienda como «Pago por cuenta de la
tienda».»).

### 9.2 La frase del efecto (R60): `FRASE_DEL_EFECTO: Record<ConceptoManualId, string>`

| Concepto | Frase |
| --- | --- |
| Gasto variable / Sueldo / Ajuste que resta | «Sale dinero de la caja y baja la ganancia de Ordenex.» |
| **Pago por cuenta de una tienda** | «Sale dinero de la caja: Ordenex le paga a otro en nombre de la tienda y se lo descuenta de su saldo. La ganancia de Ordenex no cambia.» |
| Saldo inicial o aporte de capital | «Entra dinero de Ordenex a la caja. No es ganancia: la ganancia no cambia.» |
| Ajuste que suma | «Entra dinero a la caja y sube la ganancia de Ordenex.» |
| **Cobrar un costo a una tienda** | «No sale ni entra dinero: es un cobro de Ordenex a la tienda que baja su saldo. La caja y la ganancia no cambian.» |

### 9.3 Campos por concepto

- **Pago por cuenta:** tienda (el `Select` y el SWR que ya usa el cobro, `:166-172`), «A quién se le
  pagó» (texto, placeholder «Ej. Facebook, Jet Cargo, nombre de la persona»), monto, fecha, motivo,
  método (`Select` efectivo / SINPE / transferencia), referencia (visible y obligatoria si no es
  efectivo), comprobante (opcional). Pista fija bajo la tienda (R62): «Si la tienda no tiene saldo
  suficiente, su saldo queda en contra: ella le deberá ese dinero a Ordenex.» Éxito (R63):
  «Pago registrado. El saldo de {tienda} queda en {money(saldo)} · {signo}.» + si negativo: « La
  tienda le debe ese dinero a Ordenex.»
- **Saldo inicial o aporte:** clase (dos opciones con su explicación: «Saldo inicial — el dinero que
  Ordenex tenía al empezar a usar la app. Solo puede haber uno.» / «Aporte de capital — dinero de
  Ordenex que entra después.»), monto (**vacío**, R27), fecha (sin `min`; `max` = hoy), motivo,
  comprobante. Éxito: «Registrado. {Saldo inicial | Aporte de capital} de {money(monto)}.»
- El `FormData` se arma **por concepto** con solo sus claves (R61); la clave de idempotencia se genera
  al abrir el diálogo.
- El cobro de un costo conserva campos, payload y textos (R64); solo gana su frase del efecto.

### 9.4 El libro (`WalletLedger.tsx`)

- Columna de acciones: «Anular…» (diálogo molde `AnularPagoDialog`: motivo obligatorio,
  `closeOnConfirm={false}`) cuando `documento && !documento.anulado`; texto «Anulado» cuando
  `documento?.anulado`; «Ver comprobante» cuando `documento?.tieneComprobante` (abre la URL firmada
  en otra pestaña). El «Reversar» de los egresos administrativos no cambia.
- Tras registrar o anular: `onRegistrado` → el módulo relee libro, tarjeta y composición (R65; mismo
  camino que hoy, `RegistrarMovimientoCajaDialog.tsx:307-308`).

## 10. Reclasificación de los 203 (bloque C)

### 10.1 El proceso

1. **Consulta de solo lectura** (C3 de §11) — la corre el leader por el MCP de Supabase y vuelca el
   resultado a `progress/reclasificacion_459/candidatos.csv` (id, tienda, día CR, monto, descripción,
   registrado por, marca «revisar a mano»).
2. **Revisión fila a fila por el humano**: por cada fila, «pago por cuenta» o «cobro de un costo».
   Las tres marcadas («COMPRA 40 LEMME BURN» 400.000, «ABONO TARJETA NUFORM CARLOS CASTILLO» 453.000,
   «FACEBOOK IVA» 11.233,20) se deciden explícitamente. Resultado:
   `progress/reclasificacion_459/lista_aprobada.csv` (id, tienda_id, monto, decisión) + en
   `progress/reclasificacion_459/aprobacion.md` quién aprobó, cuándo, número de filas y suma.
3. **La migración** se escribe entonces (timestamp de ese día, posterior a todo `origin/dev`), con la
   lista entre dos marcas `-- LISTA-INICIO` / `-- LISTA-FIN`.
4. **Simulación** en producción (C1-bis, solo lectura) con la lista: da las cifras esperadas
   «después».
5. Despliegue; **contraste después** (C1, C2): diferencia 0,00.

La guardia `reclasificacion-459-lista.guardia.test.ts` compara la lista entre marcas con
`lista_aprobada.csv` (filas, ids, montos, número y suma) y falla si difieren (R80, R88).

### 10.2 La migración (plantilla)

```sql
-- <ts>_reclasificar_cobros_459/migration.sql
-- Aprobada por <humano> el <fecha>: <N> filas, <suma>. Ver progress/reclasificacion_459/aprobacion.md.
DO $$
DECLARE
  n_esperados CONSTANT integer := <N>;
  suma_esperada CONSTANT numeric(14,2) := <SUMA>;
  n_presentes integer;
  n_escritas integer;
  suma_escrita numeric(14,2);
BEGIN
  CREATE TEMP TABLE aprobados (id text PRIMARY KEY, tienda_id text NOT NULL, monto numeric(12,2) NOT NULL)
    ON COMMIT DROP;
  -- LISTA-INICIO
  INSERT INTO aprobados (id, tienda_id, monto) VALUES
    ('<id>', '<tienda_id>', <monto>) --, …
  ;
  -- LISTA-FIN

  SELECT count(*) INTO n_presentes
  FROM wallet_tienda_movimiento m JOIN aprobados a ON a.id = m.id;

  IF n_presentes = 0 THEN
    RAISE NOTICE 'reclasificacion 459: ningun cobro de la lista existe en esta base; no se escribe nada';
    RETURN;                                             -- R83: local y preview
  END IF;
  IF n_presentes <> n_esperados THEN
    RAISE EXCEPTION 'reclasificacion 459: existen % de % cobros aprobados', n_presentes, n_esperados;  -- R83
  END IF;
  IF EXISTS (
    SELECT 1 FROM aprobados a JOIN wallet_tienda_movimiento m ON m.id = a.id
    WHERE m.categoria::text <> 'cobro_manual' OR m.tipo::text <> 'debito'
       OR m.tienda_id <> a.tienda_id OR m.monto <> a.monto
  ) THEN
    RAISE EXCEPTION 'reclasificacion 459: algun cobro no coincide en categoria, tienda o monto';        -- R82
  END IF;

  INSERT INTO wallet_movimiento
    (id, tipo, categoria, monto, origen_tipo, origen_id, descripcion, registrado_por, fecha_movimiento, created_at)
  SELECT gen_random_uuid()::text, 'egreso', 'egreso_pago_por_cuenta_tienda', m.monto,
         'cobro_manual_reclasificado', m.id,
         concat_ws(' · ', <nombre de la tienda, misma composición que el historial>, m.descripcion),
         m.registrado_por,                                -- P9
         m.fecha_movimiento,                              -- R81: el mismo instante
         CURRENT_TIMESTAMP
  FROM aprobados a
  JOIN wallet_tienda_movimiento m ON m.id = a.id
  JOIN usuario u ON u.id = m.tienda_id
  ON CONFLICT ("origen_tipo", "origen_id", "categoria") WHERE "origen_id" IS NOT NULL DO NOTHING;  -- R85

  SELECT count(*), COALESCE(sum(w.monto), 0) INTO n_escritas, suma_escrita
  FROM wallet_movimiento w JOIN aprobados a ON a.id = w.origen_id
  WHERE w.origen_tipo::text = 'cobro_manual_reclasificado'
    AND w.categoria::text = 'egreso_pago_por_cuenta_tienda';
  IF n_escritas <> n_esperados OR suma_escrita <> suma_esperada THEN
    RAISE EXCEPTION 'reclasificacion 459: escritas % por %, esperadas % por %',
      n_escritas, suma_escrita, n_esperados, suma_esperada;                                            -- R84
  END IF;
END $$;
```

**`down.sql`** (R86): `DELETE FROM wallet_movimiento WHERE origen_tipo = 'cobro_manual_reclasificado'
AND categoria = 'egreso_pago_por_cuenta_tienda' AND origen_id IN (<la misma lista>);` — borra
exactamente lo que el `up` escribió. Es la única excepción a «el libro no se borra», y existe solo
como reverso de esta migración.

**Sin historial:** una migración no tiene actor. El rastro es el origen de cada fila
(`cobro_manual_reclasificado` → id del cobro), el comentario de cabecera y `aprobacion.md`.

**Si el humano aprueba más filas después:** una migración **nueva** con esas filas; nunca editar la
aplicada (lección «migración editada en sitio = drift»).

**El test** (`tests/integration/db/reclasificacion-459-migration.test.ts`) lee el `migration.sql`
real, sustituye el tramo entre marcas por filas sembradas en la base de test, y prueba: escribe una
salida por cobro con el mismo instante y monto (R81); ninguna fila del libro de tiendas cambia
(comparación fila a fila antes/después); monto distinto, tienda distinta o categoría distinta →
excepción y cero filas (R82); presentes parciales → excepción; ninguno presente → cero filas y sin
error (R83); dos ejecuciones → una salida por cobro (R85); `down` borra exactamente esas filas (R86);
y la invariante R8 antes (con los cobros sin reclasificar) y después.

## 11. Contraste en producción (solo lectura, lo corre el leader por el MCP de Supabase)

Todas son `SELECT`. Resultados a `progress/contraste_459.md`, **antes** de tocar código (línea base)
y **después** de cada despliegue. Las fechas CR se calculan con la convención del repo
(`fecha_movimiento − 6 h`).

```sql
-- C0 — ¿algún concepto de la caja que esta ficha no clasifique? (se espera 0 filas)
SELECT categoria::text, tipo::text, COUNT(*) AS filas, SUM(monto) AS total
FROM wallet_movimiento
WHERE categoria::text NOT IN (
  'ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod','ingreso_iva_flete',
  'ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
  'ingreso_cod_recaudado','ingreso_reverso_pago_tienda','ingreso_reverso_pago_por_cuenta_tienda',
  'ingreso_aporte_capital',
  'egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto','egreso_sueldo','egreso_ajuste',
  'egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
  'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital')
GROUP BY 1, 2;

-- C1 — la caja con la fórmula de hoy y con la nueva, la identidad (R7) y la invariante (R8)
WITH caja AS (
  SELECT categoria::text AS cat, tipo::text AS tipo, SUM(monto) AS total
  FROM wallet_movimiento GROUP BY 1, 2
), clas AS (
  SELECT cat, tipo, total,
         CASE
           WHEN cat IN ('ingreso_cod_recaudado','ingreso_reverso_pago_tienda','egreso_pago_tienda',
                        'egreso_pago_por_cuenta_tienda','ingreso_reverso_pago_por_cuenta_tienda')
             THEN 'terceros'
           WHEN cat IN ('ingreso_aporte_capital','egreso_reverso_aporte_capital') THEN 'capital'
           ELSE 'propio'
         END AS dueno,
         cat IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
                 'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod') AS es_cargo,
         CASE WHEN tipo = 'ingreso' THEN total ELSE -total END AS con_signo
  FROM caja
), cifras AS (
  SELECT
    COALESCE(SUM(total)     FILTER (WHERE tipo = 'ingreso'), 0)                 AS entro_hoy,
    COALESCE(SUM(total)     FILTER (WHERE tipo = 'ingreso' AND NOT es_cargo), 0) AS entro_nueva,
    COALESCE(SUM(total)     FILTER (WHERE tipo = 'egreso'), 0)                  AS salio,
    COALESCE(SUM(con_signo), 0)                                                AS cifra_hoy,
    COALESCE(SUM(con_signo) FILTER (WHERE NOT es_cargo), 0)                     AS cifra_nueva,
    COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'propio'), 0)                 AS ganancia,
    COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'terceros'), 0)               AS de_tiendas_hoy,
    COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'terceros'), 0)
      - COALESCE(SUM(total) FILTER (WHERE es_cargo), 0)                         AS de_tiendas_nueva,
    COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'capital'), 0)                AS capital,
    COALESCE(SUM(total)     FILTER (WHERE es_cargo), 0)                         AS cargos_a_tiendas
  FROM clas
), tiendas AS (
  SELECT COALESCE(SUM(CASE WHEN tipo::text = 'credito' THEN monto ELSE -monto END), 0) AS suma_saldos,
         COALESCE(SUM(monto) FILTER (WHERE categoria::text = 'cobro_manual'), 0)       AS cobros_costo,
         COUNT(*) FILTER (WHERE categoria::text = 'cobro_manual')                     AS n_cobros_costo
  FROM wallet_tienda_movimiento
), reclasificados AS (
  SELECT COALESCE(SUM(c.monto), 0) AS cobros_reclasificados, COUNT(*) AS n_reclasificados
  FROM wallet_tienda_movimiento c
  WHERE c.categoria::text = 'cobro_manual'
    AND EXISTS (SELECT 1 FROM wallet_movimiento w
                WHERE w.origen_tipo::text = 'cobro_manual_reclasificado'
                  AND w.origen_id = c.id
                  AND w.categoria::text = 'egreso_pago_por_cuenta_tienda')
)
SELECT c.*, t.suma_saldos, t.cobros_costo, t.n_cobros_costo, r.cobros_reclasificados, r.n_reclasificados,
       c.de_tiendas_nueva - (t.suma_saldos + t.cobros_costo - r.cobros_reclasificados) AS diferencia_r8,
       c.cifra_nueva - (c.ganancia + c.de_tiendas_nueva + c.capital)               AS diferencia_r7
FROM cifras c CROSS JOIN tiendas t CROSS JOIN reclasificados r;

-- C1-bis — simulación de la reclasificación con la lista aprobada (antes de desplegar el bloque C)
WITH aprobados(id) AS (VALUES ('<id>') /* , … la lista aprobada */),
sim AS (
  SELECT COALESCE(SUM(m.monto), 0) AS suma_aprobada, COUNT(*) AS n_aprobados
  FROM wallet_tienda_movimiento m JOIN aprobados a ON a.id = m.id
  WHERE m.categoria::text = 'cobro_manual' AND m.tipo::text = 'debito'
)
SELECT n_aprobados, suma_aprobada FROM sim;
-- de_tiendas_despues = de_tiendas_nueva(C1) − suma_aprobada ; cifra_despues = cifra_nueva(C1) − suma_aprobada
-- y debe cumplirse de_tiendas_despues = suma_saldos + (cobros_costo − suma_aprobada).

-- C2 — contrapartidas cierre a cierre (cargos y contra-entrega): se esperan 0 filas
WITH caja AS (
  SELECT origen_tipo::text AS ot, origen_id AS oid, categoria::text AS cat, SUM(monto) AS m
  FROM wallet_movimiento
  WHERE categoria::text IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
                            'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod',
                            'ingreso_cod_recaudado')
  GROUP BY 1, 2, 3
), tienda AS (
  SELECT origen_tipo::text AS ot, origen_id AS oid,
         CASE categoria::text
           WHEN 'flete' THEN 'ingreso_flete'
           WHEN 'flete_devolucion' THEN 'ingreso_flete_devolucion'
           WHEN 'comision_cod' THEN 'ingreso_comision_cod'
           WHEN 'iva_flete' THEN 'ingreso_iva_flete'
           WHEN 'iva_flete_devolucion' THEN 'ingreso_iva_flete_devolucion'
           WHEN 'iva_comision_cod' THEN 'ingreso_iva_comision_cod'
           WHEN 'cod_recaudado' THEN 'ingreso_cod_recaudado'
         END AS cat,
         SUM(monto) AS m
  FROM wallet_tienda_movimiento
  WHERE categoria::text IN ('flete','flete_devolucion','comision_cod','iva_flete',
                            'iva_flete_devolucion','iva_comision_cod','cod_recaudado')
  GROUP BY 1, 2, 3
)
SELECT COALESCE(c.ot, t.ot) AS origen_tipo, COALESCE(c.oid, t.oid) AS origen_id,
       COALESCE(c.cat, t.cat) AS concepto, c.m AS en_caja, t.m AS en_tiendas,
       COALESCE(c.m, 0) - COALESCE(t.m, 0) AS diferencia
FROM caja c FULL JOIN tienda t ON c.ot = t.ot AND c.oid = t.oid AND c.cat = t.cat
WHERE COALESCE(c.m, 0) <> COALESCE(t.m, 0)
ORDER BY 1, 2, 3;

-- C3 — candidatos a reclasificar (para la revisión fila a fila del humano)
SELECT m.id,
       u.nombre                                        AS tienda,
       m.tienda_id,
       (m.fecha_movimiento - interval '6 hours')::date AS dia_cr,
       m.monto,
       m.descripcion,
       lower(split_part(btrim(m.descripcion), ' ', 1)) AS primera_palabra,
       NOT (lower(btrim(m.descripcion)) LIKE 'pago%')  AS revisar_a_mano,
       r.nombre                                        AS registrado_por,
       m.created_at
FROM wallet_tienda_movimiento m
JOIN usuario u ON u.id = m.tienda_id
LEFT JOIN usuario r ON r.id = m.registrado_por
WHERE m.categoria::text = 'cobro_manual'
ORDER BY m.fecha_movimiento, m.created_at, m.id;

-- C4 — sumas de control de C3 (se esperan 203 / 25.769.034,50; 200 «pago» / 24.904.801,30)
SELECT u.nombre AS tienda,
       COUNT(*) AS filas, SUM(m.monto) AS total,
       COUNT(*) FILTER (WHERE lower(btrim(m.descripcion)) LIKE 'pago%') AS filas_pago,
       SUM(m.monto) FILTER (WHERE lower(btrim(m.descripcion)) LIKE 'pago%') AS total_pago,
       MIN((m.fecha_movimiento - interval '6 hours')::date) AS desde,
       MAX((m.fecha_movimiento - interval '6 hours')::date) AS hasta
FROM wallet_tienda_movimiento m JOIN usuario u ON u.id = m.tienda_id
WHERE m.categoria::text = 'cobro_manual'
GROUP BY u.nombre;

-- C5 — lo que NO debe moverse: mensajeros (se repite antes y después; debe ser idéntico)
SELECT categoria::text, tipo::text, COUNT(*) AS filas, SUM(monto) AS total
FROM pago_mensajero_movimiento GROUP BY 1, 2 ORDER BY 1, 2;

-- C6 — catálogos y restricciones de hoy (para los down.sql) y el bucket
SELECT t.typname, COUNT(*) AS n, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS valores
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname IN ('wallet_movimiento_categoria','wallet_tienda_movimiento_categoria',
                    'wallet_origen_tipo','historial_accion_tipo','historial_accion_entidad')
GROUP BY t.typname ORDER BY t.typname;
SELECT conrelid::regclass AS tabla, conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conname IN ('wallet_tienda_movimiento_tipo_categoria_check','wallet_movimiento_tipo_categoria_check');
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'wallet-comprobantes';

-- C7 — el primer día de la caja (el «desde» de la tarjeta)
SELECT MIN((fecha_movimiento - interval '6 hours')::date) AS primer_dia_cr, COUNT(*) AS movimientos
FROM wallet_movimiento;
```

**Esperado en la línea base (M6, 2026-09-24; producción se mueve cada día, así que el contraste
vale por sus diferencias, no por estos números):** C0 0 filas · C1 `entro_hoy` 37.129.997,47,
`entro_nueva` 29.059.224,00, `salio` 12.476.410,00, `cifra_hoy` 24.653.587,47, `cifra_nueva`
16.582.814,00, `ganancia` −4.405.636,53, `de_tiendas_hoy` 29.059.224,00, `de_tiendas_nueva`
20.988.450,53, `capital` 0,00, `cargos_a_tiendas` 8.070.773,47, `suma_saldos` −4.780.583,97,
`cobros_costo` 25.769.034,50 (203), `cobros_reclasificados` 0,00, **`diferencia_r8` 0,00,
`diferencia_r7` 0,00** · C2 0 filas · C4 203 / 25.769.034,50.
**Tras el bloque C con la lista entera:** `cifra_nueva` −9.186.220,50, `de_tiendas_nueva`
−4.780.583,97 = `suma_saldos`, `diferencia_r8` 0,00, `ganancia` sin cambio, C5 idéntico.
**Regla (R91):** con cualquier diferencia ≠ 0,00 o C2 con filas, no se despliega y se investiga.

## 12. Fase 0 y guardias

### 12.1 Fotografía (antes de tocar una línea)

`tests/integration/db/caja-caracterizacion-459.test.ts` siembra por los **servicios reales** un
escenario con: un cierre aprobado con dos tiendas, contra-entrega, flete, comisión con céntimos (para
que un redondeo distinto se note), impuestos y pago al mensajero; una orden prepagada entregada
(cargo sin contra-entrega); un rechazo con cobro aprobado; un pago a tienda y su anulación; un reparto
a mensajero y la anulación de un pago; un cobro de un costo; un sueldo y su reverso; un gasto
variable; ajustes; un cobro de gasto fijo aprobado; un premio y su anulación; una indemnización.
Afirma como LITERALES (son el contrato): saldo y desglose de cada tienda; ganancia,
`ComposicionGananciaDTO` y `DesgloseEgresosDTO`; cuenta por pagar y libro de cada mensajero; filas
que cada camino escribió en cada libro (categoría, tipo, monto, origen). Un bloque aparte, con nombre
propio («lo que esta ficha cambia a propósito»), fija el `enCaja`, `entradas` y `deTerceros` de HOY;
la tarea T1.3 lo reescribe con los literales nuevos calculados a mano en un comentario (nunca con la
función que se prueba: lección «aserción contra su propia fuente»).

### 12.2 Mutaciones, con autocomprobación

Al menos 14, una a una: aplicar con Edit → `git diff` confirma el cambio → correr SOLO la fotografía
→ copiar al informe el nombre del caso rojo y el número de tests ejecutados (≠ 0) → `git checkout --
<archivo>` → verde. Lista: (1) cubeta de `cobro_manual` a `aFavor`; (2) signo del débito en
`derivarSaldoTienda`; (3) `egreso_sueldo` a `terceros`; (4) `ingreso_flete` a `terceros`; (5) el
`min(P,E)` del pago al mensajero; (6) quitar `emitirEgresoDePago` del pago a tienda; (7)
`ajuste_credito` → `ajuste_debito` en `escribirContraasiento`; (8) omitir el egreso del gasto fijo
aprobado; (9) `movimientosDeTienda` del cobro por rechazo devuelve `[]`; (10) omitir el reverso del
premio en la caja; (11) quitar `tipo: "credito"` en `CajaCodFeedService`; (12) quitar
`cod_recaudado` del feed de la tienda; (13) saltar `ingreso_ajuste` en `derivarComposicionGanancia`;
(14) categoría del cobro de un costo a `ajuste_debito`. Informe en `progress/fase0_459.md`. **Gate y
mutaciones nunca a la vez** sobre el mismo árbol.

### 12.3 La guardia de la invariante (R9, R90)

`lib/utils/invariante-tiendas.ts`:

```ts
export const TIPO_POR_CATEGORIA_TIENDA: Record<WalletTiendaMovimientoCategoria, "credito" | "debito">;
export const CONTRAPARTIDA_EN_CAJA: Record<WalletTiendaMovimientoCategoria, WalletMovimientoCategoria | "sin_contrapartida">;
```

`tests/unit/guards/caja-clasificacion-459.guardia.test.ts` afirma:
1. el conjunto `sin_contrapartida` es **exactamente** `{cobro_manual, ajuste_debito}` (literal: es el
   contrato; lo que se añada ahí es una excepción nueva a R8 y hay que decidirla);
2. para cada par, el efecto en «De las tiendas» de la categoría de caja (derivado de
   `NATURALEZA_POR_CATEGORIA`, `LIQUIDEZ_POR_CATEGORIA` y del prefijo) tiene el mismo signo que el
   efecto de la categoría de la tienda en su saldo;
3. toda categoría de caja con efecto ≠ 0 en «De las tiendas» es contrapartida de **exactamente una**
   categoría de tienda;
4. `cargo_a_tienda` ⇔ `WALLET_INGRESO_CONCEPTO_SEED`, y todas son `propio`;
5. `TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK de la base (lo contrasta el test de migración
   contra Postgres).
Con contraprueba: una copia del `Record` con un par invertido y otra con una categoría de caja
terceros sin pareja deben ponerla roja.

`tests/integration/db/caja-invariante-tiendas.test.ts` recorre el escenario de §12.1 **más** pago por
cuenta y su anulación, saldo inicial, aporte y su anulación y un cobro reclasificado (ejecutando el
SQL real de §10.2), y afirma R7 y R8 al céntimo tras cada paso. Comprueba que hay filas (nada de
`if (!filas) return`).

`tests/unit/guards/caja-textos-459.guardia.test.ts` (R16, R24, R27): el aviso viejo y la pista vieja
no existen en ningún archivo de `app/(app)/wallet/**` ni de `app/(app)/analitica/**`; la tarjeta en
estado «flujo» no contiene «Dinero en caja» en texto, pista ni `aria-label` (render); ningún componente
del diálogo ni action del aporte produce un importe por defecto. Con contraprueba.

## 13. Cada consumidor de la derivación y de la composición, y qué le pasa

| Consumidor | Dónde | Qué cambia |
| --- | --- | --- |
| `derivarCaja` | `lib/utils/caja-tesoreria.ts:202-232` | Fórmula de §2.2, estado y campos nuevos. |
| `derivarReparto` | `:157-177` | Recibe «De Ordenex» en vez de la ganancia; la lógica de ramas no cambia. |
| `derivarComposicionGanancia`, `categoriasDeFilaComposicion` | `:283-388` | **Nada.** Filtran por `propio`; el capital y los conceptos de terceros nuevos quedan fuera por construcción (verificado: `:286`, `:353`). |
| `WalletService.verResumenCaja` | `lib/services/WalletService.ts:168-178` | Lee estado y primer día; pasa opciones a `derivarCaja`. |
| `CajaResumenCard` | `app/(app)/wallet/_components/CajaResumenCard.tsx` | §3: rótulo por estado, pistas, avisos, región de capital, frase de «las tiendas le deben», barra solo en «saldo». |
| `BarraComposicionCaja` | `.tsx:83-112` | Nombre accesible con «De Ordenex»; se monta solo en «saldo». |
| `wallet-labels.ts` | `:85-126`, `:157-198`, `:49-70`, `:201-217` | Textos de §3.3–§3.4; `CAJA_RESUMEN_AVISO_TERCEROS` reemplazado; rótulos y `DUENO_LABEL`. |
| Libro y su descarga | `WalletLedger.tsx`, `wallet-ledger-descarga-columnas.ts:22-65` | Rótulos y dueño de los conceptos nuevos; acciones de §9.4. La descarga no lleva el resumen (medido en `tests/unit/services/wallet-caja-descarga.test.ts`), así que su única variación son los rótulos. |
| `WalletMovimientoRepository` (dueño por fila) | `:59` | Devuelve `capital` para los conceptos de capital. |
| Finanzas por día | `lib/utils/finanzas-diarias.ts:84-99` | `ingresos` = entradas de efectivo (R13). Sin superficie hoy (comentada en `analitica/page.tsx:525-545`). |
| Analítica `dinero_en_caja` | `AnaliticaFinancieraService.ts:232`, `:396-434` | Sin cambio de código: su valor cambia porque llama a `derivarCaja`. La **descripción** del catálogo (`metrics.ts:668-669`) se reescribe (hoy dice «es MAYOR»). |
| Analítica `ganancia_ordenex`, `ingreso_*` | `metrics.ts:701-733` | Nada. |
| Analítica `egresos` | `metrics.ts:604-652` | + `egreso_pago_por_cuenta_tienda` (P13) y descripción. |
| Analítica `cuenta_por_pagar_tienda` | `metrics.ts:735-767` | + `pago_por_cuenta`, `pago_por_cuenta_anulado`. |
| KPIs financieros | `app/(app)/analitica/_components/finanzas/cargar-kpis.ts:55-73`, `:141-146` | Sin superficie. El rótulo de la cifra de caja pasa a salir de la misma función que la tarjeta (por estado) y la pista de «Por pagar a tiendas» deja de decir que la línea de la wallet es el contra-entrega bruto. |
| Aviso de `wallet-labels.ts:123-126` | | **Se retira** (R24). |
| Desglose de tienda y `/mi-wallet` | `desglose-tienda.ts:34-53`, labels | Conceptos nuevos en su cubeta y pistas. Saldo sin cambio para los conceptos existentes (R92). |

## 14. Acoples con la 457 y la 458 (lo que el leader tiene que actualizar en sus specs)

**457 (va después):**
1. Su DH1 sigue valiendo con la fórmula nueva: un pago recibido entra como efectivo de terceros, sube
   «De las tiendas» y la cifra principal, no la ganancia. Su §2.4 cita `CAJA_RESUMEN_AVISO_TERCEROS`,
   que esta ficha retira: actualizar el razonamiento.
2. Sus categorías nuevas entran también en `LIQUIDEZ_POR_CATEGORIA` (`ingreso_abono_tienda`:
   efectivo) y en `CONTRAPARTIDA_EN_CAJA` (`abono_tienda` ↔ `ingreso_abono_tienda`;
   `abono_tienda_anulado` ↔ `egreso_reverso_abono_tienda`). La guardia de §12.3 se lo exige; y añade un
   caso al test de la invariante.
3. Sus mediciones M3/M4 y sus `down.sql` quedan **rancios**: tras esta ficha las listas son 21 / 13 /
   11 y los CHECK tienen los valores de §4.3. Re-medir; y valorar el `down` dinámico de §4.2 para su
   migración de historial.
4. Comprobante: `lib/config/wallet-comprobante.ts`, `BUCKETS`, `lib/utils/comprobante.ts` y el bucket
   los crea esta ficha; la 457 los **reutiliza** (su T3.3 pasa a «añadir el prefijo `abonos-tienda/`»)
   y hereda el tope de 4 MB y los tipos.
5. Su R60 (censo de productores de crédito del libro de tienda) debe incluir `pago_por_cuenta_anulado`
   producido por `PagoPorCuentaTiendaService.anular`, que en el mismo método escribe el reverso en la
   caja (cumple su propiedad: entra dinero en la misma transacción). Su R62 se sigue cumpliendo: ningún
   concepto nuevo del diálogo acredita a una tienda.
6. Su fase 0 (T0.2, dorados de caja) se escribe **sobre la fórmula de esta ficha** y sobre 21
   categorías, no 17. Sus conteos del historial (33→35, 21→22) parten de los de esta ficha (+4 tipos,
   +2 entidades).
7. Sus pistas de «A tu favor»/«Cargos» (`mi-wallet-labels.ts`, `desglose-tienda-labels.ts`) se
   editan también aquí: secuenciar en esos archivos.

**458:**
1. R93–R97 y la hija 458-1b se implementan aquí, con dos desviaciones: la anulación del pago por
   cuenta usa categorías **propias** (`ingreso_reverso_pago_por_cuenta_tienda` /
   `pago_por_cuenta_anulado`) y documento propio, no `wallet_anulacion` ni `ingreso_reverso_pago_tienda`
   (§18-A8); y R97 («Así queda») queda en la 458-3 (P11).
2. Su P10 (doble conteo) queda resuelta aquí; su R49/R78 («las mismas cifras que hoy produce la
   derivación») pasa a leerse «las que produce la derivación de la 459».
3. Su P15 queda resuelta (reclasificación con lista aprobada, sin tocar las filas de la tienda) y su
   P16 hecha.
4. Su §2.1 (`wallet_anotacion` para el beneficiario del pago por cuenta) ya no hace falta: el
   beneficiario vive en el documento. Su §4.3 debe tratar pago por cuenta y aporte como los pagos de la
   172: documento con anulación propia, no se duplican en `wallet_anulacion`.
5. Su «Así queda» (`EFECTO_POR_TIPO`, §4.4) se calcula con la derivación de esta ficha, e incluye la
   línea de capital.
6. Su fase 0 puede reutilizar la fotografía de §12.1.

## 15. Relación con SF-001: qué haría falta para sacarla sola por `docs/release.md` §2 bis

**No se decide aquí (P16).** Lo que haría falta, medido sobre lo que hay:

1. **Partirla en tres entregas** (tasks.md): **A** — derivación, estado y textos, **sin migración ni
   `schema.prisma`** (toca `lib/types/wallet.ts`, que es cimiento: gate completo, pero la condición 1
   de §2 bis se cumple); **B** — pago por cuenta y saldo inicial/aporte, con las migraciones 1–3; **C** —
   la reclasificación, con su migración de datos, cuando haya lista aprobada. A sola ya retira el doble
   conteo de la pantalla (la tarjeta pasaría a «Flujo de dinero registrado 16.582.814,00», «De las
   tiendas 20.988.450,53», y el aviso nuevo explica que los cobros de un costo no pasan por la caja).
2. **B y C llevan migración.** §2 bis pide parar y replantear; el precedente de la 453 sacó una
   migración aditiva por esta vía. Lo que hay que comprobar antes: que ninguna de las **12** migraciones
   pendientes de `dev` (las 6 de SF-001 y las 6 de la 454/455) toca `wallet_movimiento_categoria`,
   `wallet_tienda_movimiento_categoria`, `wallet_origen_tipo`, los dos CHECK ni las tablas de la wallet
   (`grep` sobre esas carpetas); que el `down` del historial es el dinámico de §4.2 (el catálogo difiere
   entre ramas); y que los timestamps de esta ficha son **posteriores** a los de `dev`, para que en `dev`
   el orden quede igual. En `prod` se aplicarán antes que las de SF-001, que llegarán después con
   timestamps menores: es la misma situación que dejó la 453 y aún no se ha visto desplegar.
3. **El orden de los valores en `pg_enum` quedará distinto** entre `prod` y `dev` (en `prod` los de esta
   ficha antes que los de SF-001). Inocuo para la app; solo afecta a quien compare listas en orden
   contra `prod`.
4. **Ramificar de `origin/prod`, `cherry-pick` de los commits de la ficha**, y resolver a mano, línea a
   línea, los conflictos que traiga SF-001 pegado: casi seguro `db/schema.prisma` (relaciones de
   `Usuario`), `lib/types/historial-accion.ts` y sus etiquetas, los conteos del historial y el de
   `schema-drift-saneamiento.test.ts`. **Desconfiar de los números**: el correcto en la rama suele ser
   ni el de `prod` ni el de `dev`. Comprobar primero `git diff origin/prod...origin/dev --name-only --
   <cada archivo que toca la ficha>`.
5. **Gate sobre una base copia** (receta de §2 bis): quitar de la copia lo de SF-001 **y ahora también
   lo de la 454/455**, que renombra valores de enum (no basta con dropear). Es la parte cara: medirla
   antes de comprometerse.
6. **Operaciones:** crear el bucket en producción y preview antes de B; contraste C0–C7 antes y después.
7. **Vuelta a `dev`** (`git merge prod`) resolviendo los mismos conflictos con la versión de `dev`, y
   comprobar que `schema.prisma` conserva las dos cosas y que `prisma validate` pasa.

## 16. Recorrido por rol (guion; sin arnés E2E, Playwright ad hoc en local sembrado)

El checkpoint E2E de pagos se declara inaplicable (no hay arnés) y se cubre con la integración de
§12 más este recorrido. Capturas y **números** en `progress/recorrido_459/`, un solo dev server.

**Maestro**
1. `/wallet` sin saldo inicial: la cifra se llama «Flujo de dinero registrado», con «desde el {día}»
   = C7 local; ningún texto ni `aria-label` de la tarjeta contiene «Dinero en caja»; no hay barra.
   Entró, Salió, flujo, ganancia, «De las tiendas» y capital = literales de la fotografía.
2. «De las tiendas» = Σ de la columna de saldos de `/wallet/tiendas` + Σ cobros de un costo (sumados
   a mano de la pantalla). Si es negativa, la frase «Las tiendas le deben a Ordenex ₡…» con el valor
   absoluto.
3. «Registrar movimiento»: tres grupos con su encabezado; al pasar por cada concepto cambia la frase
   del efecto; pago por cuenta y cobro dicen cosas opuestas sobre la caja.
4. Pago por cuenta a «Facebook», 10.000,00, SINPE, referencia, motivo, PDF: aviso con el saldo de la
   tienda y su signo (y «le debe» si quedó en contra). Tarjeta: flujo −10.000,00, «De las tiendas»
   −10.000,00, ganancia igual. Libro: fila «Pago por cuenta de una tienda», dueño «Tienda», origen
   «Pago por cuenta de tienda», descripción con tienda y beneficiario; «Ver comprobante» abre el PDF.
5. Mismo registro con la misma clave (doble clic) → una sola fila.
6. «Anular…» con motivo → contra-asiento «Pago por cuenta anulado» fechado hoy; las tres cifras
   vuelven; la fila original dice «Anulado». Segundo intento → «ya estaba anulado».
7. Cobrar un costo de 5.000,00: la frase dice que la caja no cambia; flujo, ganancia y «De las
   tiendas» iguales; el saldo de la tienda −5.000,00.
8. «Saldo inicial o aporte»: el monto aparece **vacío**; con clase «Saldo inicial» y fecha posterior al
   primer día → rechazado con el último día admitido; con fecha válida → la tarjeta pasa a «Dinero en
   caja», aparece la barra, el capital = monto. Segundo saldo inicial → «ya hay uno». Anularlo →
   vuelve a «Flujo de dinero registrado».
9. Aporte de capital (clase aporte) sin saldo inicial → sigue en «flujo»; capital sube; ganancia igual.
10. Descarga del libro: rótulos legibles, dueño «Ordenex (capital)» y «Tienda», sin uuids.
11. Filtro por periodo: rótulo «Movimiento neto del periodo» en los dos estados.

**Admin:** pasos 1–11 con el mismo resultado (P14).

**adminTienda:** `/mi-wallet` muestra «Pago por cuenta de la tienda — A Facebook · …» y «Pago por
cuenta anulado», nunca «Cobro de Ordenex» para esas filas; sus cobros de un costo (reclasificados o
no) se ven como hoy; ninguna acción de registrar o anular; `/wallet` → no encontrado; pedir el
comprobante de un pago por cuenta de otra tienda (llamando a la action con su id) → no encontrado.

**Mensajero:** `/wallet` → no encontrado; las seis actions → `forbidden`.

**Tras desplegar (producción):** C0–C2 y C5 del contraste con diferencias en 0,00; la tarjeta dice
«Flujo de dinero registrado» con el número de C1; errores de runtime en la hora siguiente: cero.

## 17. Trazabilidad R → test

| R | Test |
| --- | --- |
| R1, R9, R90 | `tests/unit/guards/caja-clasificacion-459.guardia.test.ts` (+ contraprueba) |
| R2–R7, R10, R11 | `tests/unit/utils/caja-derivacion-459.test.ts` (M6 como literales; identidad sobre subconjuntos al azar con semilla fija); `caja-derivaciones.guardia.test.ts` (4 llamadas) |
| R8, R89 | `tests/integration/db/caja-invariante-tiendas.test.ts` |
| R12 | `tests/unit/services/analitica-financiera-service.test.ts` (dinero_en_caja = cifra de la tarjeta por cubo), `metrics-caja-naturaleza.guardia.test.ts` |
| R13 | `tests/unit/analytics/finanzas-diario.test.ts` |
| R14, R21 | `tests/unit/services/wallet-service.test.ts` + `tests/integration/db/aporte-capital.test.ts` (registrar y anular cambian el estado) |
| R15–R20, R22, R23, R25, R26 | `tests/components/CajaResumenCard.test.tsx`, `tests/components/CajaComposicionBarra.test.tsx` |
| R7 en pantalla | `tests/components/DineroIdentidadesEnPantalla.test.tsx` |
| R16, R24, R27 | `tests/unit/guards/caja-textos-459.guardia.test.ts` |
| R28 | `tests/integration/wallet-page.test.tsx` (barrido STRING) + guardias money-safe |
| R29, R39, R40, R42, R46–R48 | `tests/integration/db/pago-por-cuenta-tienda.test.ts` (pasa por la action; filas en los tres sitios) |
| R30–R38, R41, R49–R52 | `tests/unit/services/pago-por-cuenta-tienda-service.test.ts`, `tests/unit/types/pago-por-cuenta-tienda-schema.test.ts`; R52 = lista exacta de exportaciones de `lib/actions/pago-por-cuenta-tienda.ts` |
| R42, R50 | `tests/integration/db/pago-por-cuenta-tienda-concurrencia.test.ts` (pago por cuenta ∥ pago a tienda; dos anulaciones) |
| R43 | `tests/unit/utils/descripcion-pago-por-cuenta.test.ts` |
| R44 | `tests/integration/mi-wallet-page.test.tsx`, `tests/unit/components/mi-wallet-labels.test.ts` |
| R45, R77, R87 | `tests/unit/components/wallet-labels.test.ts`, `tests/components/descarga/WalletDescarga.test.tsx` |
| R53, R78 | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`, `historial-accion-escrituras-cubiertas.guardia.test.ts`, `historial-accion-sin-datos-cliente.guardia.test.ts` |
| R54–R58 | `tests/unit/services/wallet-comprobante.test.ts` (doble de `IFileStorage`) |
| R59–R64 | `tests/unit/components/wallet-conceptos-manuales.test.ts`, `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` |
| R65–R67 | `tests/components/WalletLedgerAcciones459.test.tsx` |
| R68–R76 | `tests/unit/services/aporte-capital-service.test.ts`, `tests/integration/db/aporte-capital.test.ts` (incluye dos saldos iniciales simultáneos) |
| R79 | C3/C4 de §11, volcado en `progress/reclasificacion_459/` |
| R80, R88 | `tests/unit/guards/reclasificacion-459-lista.guardia.test.ts` |
| R81–R86 | `tests/integration/db/reclasificacion-459-migration.test.ts` |
| R91 | `progress/contraste_459.md` |
| R92–R96 | `tests/integration/db/caja-caracterizacion-459.test.ts` + `progress/fase0_459.md` |
| R97 | `tests/integration/db/pago-por-cuenta-tienda.test.ts` (listas de pagos a tienda y backfill de la 173 no los ven) |
| R98, R99 | `tests/integration/db/caja-459-migration.test.ts` |
| R100 | `tests/unit/descarga/columnas-sensibles.guardia.test.ts` + casos nuevos |

## 18. Alternativas descartadas

- **A1 — Calcular «De las tiendas» leyendo el libro de tiendas (Σ saldos) y la caja como G + T.** Dos
  fuentes para una cifra, sin filtros de periodo coherentes y, sobre todo, esconde las divergencias:
  la igualdad deja de poder comprobarse porque se impone. Se deja como **invariante probada** (R8,
  R89–R91), que es lo que caza un fallo.
- **A2 — Netear los cargos escribiendo filas** (un egreso de terceros por cada cargo, o cambiando el
  feed del cierre). Toca los caminos de escritura que funcionan, exige backfill sobre producción y
  contradice «ninguna fila cambia».
- **A3 — Pasar los cargos a «terceros».** Arregla la cifra principal pero cambia la ganancia (HF2).
- **A4 — Reclasificar cambiando la categoría de las 203 filas de la tienda (P15 opción A de la 458).**
  Edita filas inmutables que ya están bien; lo prohibió el encargo.
- **A5 — Un solo ajuste de 25,77 M (P15 opción B).** Pierde las fechas reales: los días del 8 al 23 de
  septiembre seguirían diciendo lo que no pasó.
- **A6 — Registrar el pago por cuenta como cobro + `egreso_ajuste`.** El egreso sería propio: bajaría
  la ganancia por dinero que no es de Ordenex (A9 de la 458).
- **A7 — Las tablas laterales de la 458 (`wallet_anotacion`, `wallet_anulacion`,
  `wallet_registro_idempotencia`) ya.** Es construir media 458-1 con prisa; el documento propio es el
  patrón vigente del dinero (172, 457) y la 458-1 ya prevé no duplicar a los que lo tienen.
- **A8 — Reusar `egreso_pago_tienda` / `ingreso_reverso_pago_tienda`.** Rótulo «Pago a tienda» para un
  pago a Facebook, guardias de la 173 que fijan la lista exacta de ese puerto, y la serie diaria
  («pago a tiendas») los contaría como pagos a la tienda.
- **A9 — Mostrar «Dinero en caja» con un saldo inicial estimado** (p. ej. el que deja la caja en cero).
  Prohibido por HF4: sería inventar una cifra de arranque.
- **A10 — El saldo inicial como `ingreso_ajuste`.** Infla la ganancia en millones que no se ganaron.
- **A11 — La reclasificación como script corrido por MCP.** Sin versión en el repo, sin `down`
  probado y sin la guardia de lista aprobada; el encargo pide una migración.
- **A12 — Estado «saldo» con cualquier aporte.** Un aporte posterior no convierte el flujo en saldo:
  solo lo hace el dinero de arranque. Por eso la clase del documento.

## 19. Riesgos y límites declarados

- **L1 — Interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION`** (P15): apagado, rompe R8. Vigilado por C2.
- **L2 — Redondeo por concepto** entre el feed de la caja (por cierre) y el de la tienda (por tienda y
  concepto). Hoy cuadra al céntimo (medido); C2 lo vigila cierre a cierre, y la fotografía lleva una
  comisión con céntimos repartida en dos tiendas.
- **L3 — El egreso del mensajero es devengo** ([P2] de la 173): el flujo registrado queda por debajo
  del efectivo en lo pendiente con los mensajeros (medido: 7.400,00). Fuera de alcance (HF2).
- **L4 — Cobros de un costo** fuera de la caja (P3): excepción declarada de R8.
- **L5 — Base local compartida:** las migraciones de B ponen rojo el gate de otras sesiones hasta que
  migren; `prisma generate` se pisa entre worktrees.
- **L6 — Bucket no creado en un entorno:** registro con comprobante falla ruidoso (R56).
- **L7 — La cifra de producción será negativa** tras el bloque C (≈ −9,18 M) y así se mostrará, con la
  línea de R17, hasta que alguien teclee un saldo inicial, si algún día lo hace.
- **L8 — «Entró» cambia de significado** (deja de incluir los cargos): la cifra baja en la tarjeta y en
  los KPIs sin superficie. Es la corrección, no una regresión; la fotografía lo fija con nombre propio.

## Línea base en PRODUCCIÓN (leader, MCP, solo lectura, 2026-09-24)
C1: cifra_hoy 24.653.587,47 · cifra_nueva 16.582.814,00 · ganancia −4.405.636,53 · de_tiendas_hoy 29.059.224,00 ·
de_tiendas_nueva 20.988.450,53 · capital 0 · suma_saldos −4.780.583,97 · cobros_costo 25.769.034,50 ·
**diferencia_r8 = 0,00 · diferencia_r7 = 0,00**. C2: **0 filas descuadradas**.
Decisiones del leader sobre las preguntas: P3 se mantiene (cobrar un costo no toca la caja; es el modelo del humano);
P12 aceptada (el down lee pg_enum en vez de recrear con lista fija, por la memoria «down.sql borra valores posteriores»).
