# Feature 173 — La caja principal en modo tesorería · design

> El QUÉ está en `requirements.md`. Aquí va el CÓMO: modelo de datos, migración, flujos de
> escritura, contratos, retrocompatibilidad, inventario de analítica, pantallas y **las
> alternativas descartadas con su motivo**.
>
> Las marcas `[P1]`…`[P7]` remiten a `requirements.md § Preguntas al humano`. Donde una sección
> lleva marca, describe **el default recomendado**; si el humano responde otra cosa, cambia esa
> sección y solo esa.

---

## 0. El problema, en una frase

`derivarBalance` (`lib/utils/wallet-balance.ts:10`) devuelve `ingresos − egresos`. Mientras la caja
solo contuviera dinero **de Ordenex**, ese número era la ganancia y podía llamarse «balance» sin
mentir. En cuanto entra el contra-entrega —dinero **de las tiendas** que solo pasa por la caja— ese
mismo número deja de significar una sola cosa. La feature no consiste en meter dos categorías: **la
feature consiste en partir un número en dos y nombrarlos.** Todo lo demás es consecuencia.

---

## 1. Principio rector: dos cifras, **un solo libro**, una sola clasificación

### 1.1 La naturaleza es de la CATEGORÍA, no de la fila

No se añade ninguna columna al libro. La naturaleza (propio / de terceros) se **deriva** de la
categoría, con un `Record` **total** sobre el union de categorías —el molde exacto de
`CUBETA_POR_CATEGORIA` (`lib/utils/desglose-tienda.ts:34-49`), que la 171 ya validó—:

```ts
// lib/utils/caja-tesoreria.ts  (NUEVO)
export type NaturalezaMovimiento = "propio" | "terceros";

export const NATURALEZA_POR_CATEGORIA: Record<WalletMovimientoCategoria, NaturalezaMovimiento> = {
  // Propio: lo que Ordenex gana y lo que Ordenex gasta.
  ingreso_flete: "propio",
  ingreso_flete_devolucion: "propio",
  ingreso_comision_cod: "propio",
  ingreso_iva_flete: "propio",
  ingreso_iva_flete_devolucion: "propio",
  ingreso_iva_comision_cod: "propio",
  ingreso_ajuste: "propio",
  egreso_pago_mensajero: "propio",   // [P2]: sigue siendo devengo, ver §3.4
  egreso_gasto: "propio",
  egreso_sueldo: "propio",
  egreso_ajuste: "propio",
  egreso_gasto_fijo: "propio",
  egreso_gasto_variable: "propio",
  egreso_indemnizacion: "propio",
  // De terceros: dinero que solo pasa por la caja.
  ingreso_cod_recaudado: "terceros",        // NUEVO (§2.1)
  egreso_pago_tienda: "terceros",
  ingreso_reverso_pago_tienda: "terceros",  // NUEVO (§2.1)
};
```

Es un `Record` sobre el union **completo** a propósito (R3): el día que el enum de Postgres gane un
valor, el chequeo `_EnsureCategoriaExhaustive` de `lib/types/wallet.ts:50-57` lo obliga a entrar en
el union y **este objeto deja de compilar** hasta que alguien decida —y escriba— de quién es ese
dinero. Un `Partial<Record<…>>` o un `switch` con `default` lo dejarían caer en silencio dentro de
«propio», que es justo el error que esta feature existe para impedir.

### 1.2 Las dos derivaciones, en una función pura

```ts
export function derivarCaja(filas: readonly AgregadoCajaRow[]): CajaResumenDTO
// AgregadoCajaRow = { categoria: WalletMovimientoCategoria; tipo: "ingreso" | "egreso"; total: string }
```

- `entradas` = Σ de todas las filas `ingreso`; `salidas` = Σ de todas las `egreso`.
- **`enCaja` = `entradas − salidas`** (R4).
- `ingresosPropios` / `egresosPropios` = las mismas Σ acotadas a `naturaleza === "propio"`.
- **`ganancia` = `ingresosPropios − egresosPropios`** (R5).
- `deTerceros` = `ingresosTerceros − egresosTerceros` (la tercera línea, `[P6]`).
- Signo explícito para las dos cifras grandes, calculado en el servidor.

Money-safe de punta a punta: `Prisma.Decimal` dentro, `toFixed(2)` fuera, `number` en ninguna parte
(R7). Función **pura**, sin base de datos (R10), igual que sus tres hermanas (`derivarBalance`,
`derivarSaldoTienda`, `derivarDesgloseTienda`).

### 1.3 Qué pasa con `derivarBalance` — **no se toca**

Es la decisión que más código ahorra y la que más fácil sería equivocar. `derivarBalance` no está
mal: es «Σ ingresos − Σ egresos **sobre el conjunto que le den**», y eso sigue siendo exactamente
lo correcto para la analítica financiera, que la llama con subconjuntos de categorías declarados
por el catálogo (`AnaliticaFinancieraService.ts:203-221`). Lo que se rompió no es la función: es
**el rótulo** que la pantalla le puso a su resultado cuando el conjunto es el libro entero.

Por eso `derivarBalance` conserva firma, salida y tests **sin editar** (R9), y la semántica nueva
llega en una función nueva al lado. Es el mismo movimiento que hizo la 171 cuando añadió
`derivarDesgloseTienda` junto a `derivarSaldoTienda` sin tocarlo. Cambiar la firma de
`derivarBalance` habría arrastrado la analítica a un refactor que no pide esta feature y habría
puesto en riesgo cuatro métricas de dinero por un problema de nombres.

**Correspondencia exacta, y es lo que salva la retrocompatibilidad conceptual:** con la
clasificación de §1.1, **`ganancia` sobre el libro entero es, número por número, lo que hoy devuelve
`derivarBalance` sobre el libro entero** — porque hoy no existe ni una fila de terceros. El número
que el maestro lleva viendo desde la feature 42 **no cambia de valor: cambia de nombre**, de
«Balance general» a «Ganancia de Ordenex». La cifra que aparece de cero es la otra.

---

## 2. Modelo de datos

### 2.1 Dos valores nuevos de enum, y por qué son **dos** y no uno

`wallet_movimiento_categoria` gana:

| Valor | Tipo | Naturaleza | Quién lo emite |
| --- | --- | --- | --- |
| `ingreso_cod_recaudado` | `ingreso` | terceros | la aprobación del cierre del día (§3.1) |
| `ingreso_reverso_pago_tienda` | `ingreso` | terceros | la anulación de un pago a tienda (§3.3) |

`egreso_pago_tienda` **ya existe** (reservado desde la 42) y no requiere migración: solo pasa a
tener emisor.

**El segundo valor no es un lujo, es una corrección de una trampa.** El reflejo natural para el
reverso de la anulación era reusar `ingreso_ajuste`, que es lo que ya hace `reversarEgreso`
(`WalletEgresoService.ts:93-99`). Aquí sería un error caro: `ingreso_ajuste` es de naturaleza
**propia**, así que **anular un pago a una tienda aumentaría la ganancia de Ordenex** por el monto
anulado. Una cifra de utilidad que sube cada vez que alguien corrige un error administrativo es
exactamente el tipo de fallo silencioso que ningún test de la 172 habría detectado (allí la caja no
se tocaba). Con un valor propio, la anulación devuelve el dinero a la caja y **no roza la ganancia**
(R26).

La alternativa de emitir el reverso como `tipo: "ingreso"` con `categoria: "egreso_pago_tienda"`
—aritméticamente correcta con la clasificación de §1.1— queda descartada en §10(E).

### 2.2 La restricción categoría↔tipo en la caja `[P5]`

La migración de la 172 dejó el encargo por escrito
(`db/migrations/20260802120000_liquidacion_pago/migration.sql:123-126`). Se añade con la misma forma
que las dos que ya existen: **disyunción de listas cerradas**, que falla **cerrado** (R46) — un
valor futuro que nadie clasifique no casa ninguna rama y el `INSERT` se rechaza.

```sql
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN (
     'ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod',
     'ingreso_ajuste','ingreso_cod_recaudado','ingreso_reverso_pago_tienda'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN (
     'egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto','egreso_sueldo',
     'egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion'))
);
```

**Importa más aquí que en los otros dos libros**, porque la clasificación por naturaleza decide **por
categoría** y el signo lo da **el tipo**: una fila incoherente caería en la cubeta equivocada con el
signo contrario y descuadraría una de las dos cifras sin que nada fallara. Es el mismo límite que la
171 declaró y aceptó para el ledger de tienda; aquí se cierra.

**Coste y riesgo, declarados:** valida **las filas existentes** al aplicarse. Hay que medir
producción y preview **antes** de escribirla (tarea `T A.0`), igual que hizo la 172 en su `T A.0`.
Consta en `progress/` que **preview no es alcanzable por el MCP** desde estas sesiones, y eso ya
bloqueó un merge; el plan alternativo está en §13.

### 2.3 Ampliación mínima del contrato de escritura de la caja

`CrearMovimientoInput` (`lib/interfaces/repositories/IWalletMovimientoRepository.ts:17-25`) **no
acepta fecha de movimiento**: la columna existe con `DEFAULT CURRENT_TIMESTAMP`. El egreso del pago
a tienda tiene que llevar la **fecha real del pago** (R20) y el reverso, el **día de la anulación**
(R25). Se añade el campo **opcional**:

```ts
export interface CrearMovimientoInput {
  …
  /** Feature 173: fecha REAL del hecho. Ausente ⇒ la base pone CURRENT_TIMESTAMP (comportamiento actual). */
  fechaMovimiento?: Date;
}
```

Es exactamente lo que la 172 hizo con los otros dos libros (§2.4 de su design). Opcional y no
obligatorio para que **ninguno de los cinco escritores existentes cambie de comportamiento**: quien
no la pasa, sigue como está.

### 2.4 Migración y `down.sql`

Una sola carpeta, `<ts>_caja_tesoreria`:

1. `ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_cod_recaudado';`
2. `ALTER TYPE … ADD VALUE IF NOT EXISTS 'ingreso_reverso_pago_tienda';`
3. El `CHECK` de §2.2 `[P5]`.

Aditiva: no reescribe ni una fila, no toca RLS ni políticas (la caja ya tiene RLS habilitada sin
políticas desde la 42), no toca índices en el UP.

`down.sql` (R49): suelta el `CHECK`, suelta los **dos** índices que citan `categoria`
(`wallet_movimiento_tipo_categoria_idx` y `wallet_movimiento_origen_categoria_uq`), recrea el enum
con los **15** valores previos, migra la columna con `USING cast` y recrea los dos índices tal cual.
Es el espejo literal del `down.sql` de la 45 y de la 158. **Precondición documentada:** ninguna fila
puede usar los valores retirados; si la hay, el cast falla y el rollback aborta con un error claro —
que es el comportamiento correcto: revertir con contra-entrega ya registrado no es seguro.

**No se reescribe ningún `down.sql` previo** (R50). Es la decisión ya tomada en el repo y
documentada: *«el de la 45 lista 12 valores porque ese era su estado punto-en-el-tiempo»*
(`db/migrations/20260730120000_incidente_indemnizacion/down.sql:14-16`). El coste real de añadir un
valor de enum aquí no es tocar migraciones viejas, sino la **cascada de compilación** que dispara:
`WALLET_MOVIMIENTO_CATEGORIA_SEED` (obligado por `_EnsureCategoriaExhaustive`), `CATEGORIA_LABEL`
(`Record` completo, rompe el build sin la clave) y el `Record` nuevo de §1.1. Los tres son
**deseables**: obligan a decidir en vez de dejar caer.

### 2.5 Idempotencia: la clave de origen, movimiento por movimiento

Todo sale gratis del índice único parcial `(origen_tipo, origen_id, categoria) WHERE origen_id IS
NOT NULL` que la caja ya tiene, con `createMany({ skipDuplicates: true })` (R48):

| Movimiento | `origen_tipo` | `origen_id` | `categoria` |
| --- | --- | --- | --- |
| COD del cierre | `cierre_dia` | `<cierreId>` | `ingreso_cod_recaudado` |
| Pago a tienda | `pago_tienda` | `<pagoId>` | `egreso_pago_tienda` |
| Reverso de la anulación | `pago_tienda` | `<pagoId>` | `ingreso_reverso_pago_tienda` |

Las dos últimas comparten `(origen_tipo, origen_id)` y se distinguen por `categoria`: **caben las dos
y ninguna puede duplicarse**. Es el mismo truco que usa la 172 para que el pago y su contraasiento
convivan en el libro de tienda (`LiquidacionService.ts:492-496`). Reintentar una aprobación (R14),
reintentar un pago con la misma clave (R21) o intentar anular dos veces (R28) son **no-ops** a nivel
de base, no `if` en el servicio.

---

## 3. Los flujos que escriben

### 3.1 Aprobar un cierre del día → **el COD entra**

Servicio nuevo `CajaCodFeedService` (`lib/services/CajaCodFeedService.ts`), con interfaz en
`lib/interfaces/services/ICajaCodFeedService.ts`, construido con el molde de los tres feeds
existentes: **no persiste**, devuelve las filas a insertar.

```ts
construirIngresoCod(cierreId: string, tx: CajaCodFeedTxClient): Promise<CrearMovimientoInput[]>
```

Lee `wallet_tienda_movimiento` filtrando por `(origen_tipo = 'cierre_dia', origen_id = cierreId,
categoria = 'cod_recaudado', tipo = 'credito')`, suma, y devuelve **0 o 1** fila.

**Por qué lee lo que la misma transacción acaba de escribir, y no recalcula desde las gestiones:**
así el importe que entra en caja es, **por construcción**, idéntico al que se le acreditó a las
tiendas (R12). Si se recalculara desde `gestion_orden.montoRecibido`, habría dos fórmulas para el
mismo dinero y podrían divergir sin que nada fallara. Es el patrón literal de
`WalletIndemnizacionFeedService`, que lee de la base lo que el bloque anterior de la misma `tx`
escribió (`CierresAdminRepository.ts:569-579`).

**Dónde se engancha:** en `CierresAdminRepository.resolverCierre`, **después** del feed del ledger
por tienda (`:549-553`) y antes o después del resto —el orden entre feeds es indiferente salvo esa
única dependencia—, insertando con el repositorio de la 42 que el repo ya tiene inyectado. Cero
dependencias nuevas en ese constructor.

Cierre sin contra-entrega ⇒ lista vacía ⇒ ni una fila en 0.00 (R13). Todo dentro de la transacción
de aprobación (R15). El **cierre de bodega** no gana nada: no tiene ni feeds ni repos de wallet, y
los tests que lo afirman (`cierres-bodega-admin-service.test.ts:558-600`) se amplían con la cuarta
afirmación (R16).

**Fecha (R17):** no se pasa `fechaMovimiento`, así que la base pone `CURRENT_TIMESTAMP`, igual que
los otros cuatro movimientos de esa misma aprobación. Los cinco caen en el mismo instante, que es
lo que la conciliación de cierres da por hecho.

### 3.2 Pagar a una tienda → **el dinero sale**

En `LiquidacionService.registrarPagoTienda`, dentro de la **misma** `runTransaction` que ya escribe
el documento y el débito del ledger (R19), se añade una tercera escritura:

```
{ tipo: "egreso", categoria: "egreso_pago_tienda", monto: montoStr,
  origenTipo: "pago_tienda", origenId: creado.pago.id,
  descripcion: descripcionDePago(metodo, referencia),
  registradoPor: actor.usuarioId,
  fechaMovimiento: medianocheUtcDelDia(input.fechaPago) }   // R20
```

El `montoStr` es **el mismo string** ya redondeado que va al documento y al ledger
(`LiquidacionService.ts:263-264`): documento, ledger y caja no pueden discrepar por un redondeo.

`registrarPagoMensajero` **no gana ni una línea** (R22).

### 3.3 Anular un pago a tienda → **el dinero vuelve**

En `escribirContraasiento`, rama `tienda` únicamente, junto al `ajuste_credito` que ya escribe:

```
{ tipo: "ingreso", categoria: "ingreso_reverso_pago_tienda", monto: reverso.monto,
  origenTipo: "pago_tienda", origenId: reverso.pago.id,
  descripcion: descripcionDeAnulacion(...), registradoPor: actor.usuarioId,
  fechaMovimiento: fechaAnulacion }   // R25: el día de la anulación
```

La rama `mensajero` no gana nada (R27). Nada se borra ni se edita (R29): el reverso es una fila
nueva, como todo en estos libros.

Efecto medible (R30): tras anular, **`enCaja` vuelve al importe exacto anterior al pago** y
**`ganancia` es idéntica antes, después del pago y después de la anulación**.

### 3.4 Lo que NO escribe, y por qué `[P2]`

`egreso_pago_mensajero` se sigue emitiendo por el **costo total `P`** al aprobar, y la liquidación al
mensajero sigue sin tocar la caja (R66). La consecuencia, dicha sin adornos: **«Dinero en caja» será
menor que el dinero real, en exactamente la cuenta por pagar a mensajeros.** Se equivoca por lo bajo
—nunca dice que hay más dinero del que hay— y la diferencia es un número que el sistema ya publica.
Si el humano responde (b) a P2, esta sección se rehace entera y la feature crece: ver la pregunta.

---

## 4. Qué se inyecta en la 172, y qué invariante sustituye a su R40

Este es el punto que la 172 protegió a propósito, así que se toca con nombre y apellido.

**Lo que decía la 172** (`LiquidacionService.ts:126-129`): *«NO recibe el repositorio de la CAJA
PRINCIPAL, y es una decisión, no un olvido ([P2]/R40): al aprobar el cierre la caja ya cargó
`egreso_pago_mensajero = P`, y emitir `egreso_pago_tienda` restaría de la caja un dinero que nunca
entró en ella. **Sin la dependencia inyectada no hay forma de escribir allí aunque alguien lo
intente.**»*

**Qué cambia con la 173:** la premisa —«un dinero que nunca entró»— **deja de ser cierta para el
lado de la tienda** y sigue siéndolo para el del mensajero. La 173 es justo lo que hace correcto ese
egreso, **pero solo porque el COD entró antes** (§3.1). El orden importa: si se emitiera
`egreso_pago_tienda` sin haber metido el COD, la caja se hundiría exactamente como la 172 advirtió.

**Qué se inyecta.** *No* `IWalletMovimientoRepository`. Ese repositorio sabe escribir **cualquier**
categoría, incluida `egreso_pago_mensajero`: inyectarlo cambiaría una imposibilidad estructural por
una promesa de buena conducta. Se inyecta un **puerto estrecho**, con exactamente dos métodos y
ninguno más:

```ts
// lib/interfaces/services/ICajaPagoTiendaFeedService.ts
export interface ICajaPagoTiendaFeedService {
  movimientoDePago(p: { pagoId: string; monto: string; descripcion: string | null;
                        registradoPor: string; fechaMovimiento: Date }): CrearMovimientoInput;
  movimientoDeAnulacion(p: { … }): CrearMovimientoInput;
}
```

**El invariante que sustituye a R40:** *el servicio de liquidación no puede expresar una escritura en
la caja que no sea el egreso de un pago a tienda o su reverso* (R23). No es «no la llama»: es que
**no existe el método**. La garantía baja un escalón —de «no tiene la puerta» a «la puerta solo abre
a dos sitios»— y ese escalón se compensa con tres comprobaciones explícitas:

1. El puerto no expone categoría ni tipo: los fija el implementador del puerto, no quien lo usa.
2. Un test estructural afirma que `LiquidacionService` **no** recibe `IWalletMovimientoRepository`.
3. Los tests de rama del mensajero afirman **cero llamadas** al puerto, al pagar y al anular
   (R22, R27).

**Qué pasa con R40 de la 172:** queda **parcialmente superado**, y hay que decirlo en voz alta
porque **tests hoy verdes van a cambiar**. R40 afirmaba «la caja no recibe ninguna llamada, ni al
pagar ni al anular», medido con un doble de `tx` que espía `walletMovimiento`
(`specs/172-liquidacion/tasks.md:229-230, :505`). Tras la 173:

| Rama | R40 de la 172 | Estado tras la 173 |
| --- | --- | --- |
| Pago a **mensajero** | cero llamadas a la caja | **se conserva íntegro** (R22) |
| Anulación de pago a **mensajero** | cero llamadas | **se conserva íntegro** (R27) |
| Pago a **tienda** | cero llamadas | **superado**: exactamente **una** llamada, con categoría `egreso_pago_tienda` (R18) |
| Anulación de pago a **tienda** | cero llamadas | **superado**: exactamente **una**, con `ingreso_reverso_pago_tienda` (R24) |

Las aserciones de las dos ramas de tienda se **reescriben** (no se borran): pasan de «cero llamadas»
a «exactamente una llamada, con esta categoría, este monto, este origen y esta fecha». La tarea que
lo hace lo declara explícitamente para que el reviewer no lo lea como una regresión encubierta.

---

## 5. Contratos I/O

### 5.1 Repositorio de la caja

```ts
// IWalletMovimientoRepository (AMPLIADO)
export interface AgregadoCajaRow {
  categoria: WalletMovimientoCategoria;
  tipo: WalletMovimientoTipo;
  total: string;            // STRING escala 2
}
/** R4/R5/R8: groupBy(categoria, tipo) + SUM(monto) con los MISMOS filtros del listado. */
agregarPorCategoriaYTipo(filtros: BalanceFiltros): Promise<readonly AgregadoCajaRow[]>;
```

`agregarBalance` queda **sin consumidores** y se elimina en la misma tanda (conventions: nada de
código muerto). `derivarBalance` **se queda** (R9): su consumidor vivo es la analítica.

### 5.2 Frontera Server Action → cliente

```ts
export type CajaResumenDTO = {
  entradas: string; salidas: string;
  enCaja: string;   signoEnCaja: "positivo" | "negativo" | "cero";
  ingresosPropios: string; egresosPropios: string;
  ganancia: string; signoGanancia: "positivo" | "negativo" | "cero";
  deTerceros: string;              // [P6]
  periodoFiltrado: boolean;        // [P7]: la pantalla cambia el rótulo, no el número
};
```

Montos **siempre** STRING (R64). `WalletService.verBalance` se sustituye por `verResumenCaja`, con
el mismo guardia de rol evaluado **antes** de tocar la base (R65) y los mismos filtros (R8).

---

## 6. Retrocompatibilidad: los datos ya escritos `[P3]`

### 6.1 Qué se escribe y de dónde sale

Todo lo que hay que insertar es **derivable de documentos que ya existen**. Nada se inventa:

| Origen existente | Fila que falta en la caja | Monto |
| --- | --- | --- |
| Cada `cierre_dia` **aprobado** | `ingreso` / `ingreso_cod_recaudado`, origen `(cierre_dia, cierreId)` | Σ créditos `cod_recaudado` de ese cierre en `wallet_tienda_movimiento` |
| Cada `liquidacion_pago` con `tienda_id` | `egreso` / `egreso_pago_tienda`, origen `(pago_tienda, pagoId)` | `liquidacion_pago.monto` |
| Cada `liquidacion_anulacion` de un pago a tienda | `ingreso` / `ingreso_reverso_pago_tienda`, origen `(pago_tienda, pagoId)` | `liquidacion_pago.monto` |

Los pagos a **mensajero** y sus anulaciones no generan nada (coherente con §3.4).

### 6.2 Fechas (R41)

- COD del cierre: `MIN(fecha_movimiento)` de los movimientos de caja que ese cierre ya tiene; si el
  cierre no tuviera ninguno, `cierre_dia.resuelto_at`. Determinista y reproducible: dos ejecuciones
  producirían la misma fecha. **Nunca `now()`**, que metería dinero de 2026-07 en el mes en que se
  corrió el script y descuadraría cualquier informe por rango.
- Pago a tienda: `liquidacion_pago.fecha_pago`.
- Anulación: el día de `liquidacion_anulacion.created_at`.

### 6.3 Cómo se ejecuta

Un servicio testeable (`lib/services/CajaBackfillTesoreriaService.ts`) + un ejecutable
(`scripts/backfill-caja-tesoreria.ts`), con el precedente de `scripts/seed-zonas.ts` y de
`AnaliticaBackfillService`. Tres modos:

- `--simular` (R40): informa cuántas filas insertaría, de qué categoría y por qué monto total. **No
  escribe nada.** Es el modo por defecto: escribir exige un flag explícito.
- `--aplicar`: inserta con `createMany({ skipDuplicates: true })`. Idempotente por el índice único
  parcial (R39); correrlo dos veces inserta 0 filas la segunda vez.
- `--comprobar` (R43/R44): recorre los tres orígenes y **nombra** los que no tienen su movimiento de
  caja. Es lo que convierte «se me olvidó correrlo en preview» en un fallo visible en vez de un
  número que miente.

No modifica ni borra nada (R42): solo inserta.

### 6.4 Modo de fallo de cada opción (el contenido de P3)

- **(a) ejecutable idempotente, a mano por entorno** *(default)*: las dos cifras son correctas sobre
  toda la historia. **Falla si** alguien olvida ejecutarlo en un entorno; el número miente en
  silencio hasta que alguien corre `--comprobar`.
- **(b) dentro de la migración**: imposible de olvidar. **Falla en el diseño**: inserta filas de
  dinero que nadie revisó antes de correr en producción, y su `down.sql` tendría que **borrar** filas
  de un libro declarado append-only e inmutable — contradiría el principio central de los tres
  libros.
- **(c) solo hacia delante, con fecha de corte visible**: cero riesgo de escritura. **Falla en el
  significado**: durante meses las dos cifras coincidirían para cualquier rango anterior al corte, y
  eso es indistinguible de «no hubo dinero de terceros», que es exactamente la confusión que la
  feature viene a eliminar. Y arreglarlo después obliga a hacer (a) igualmente, con más filas.

---

## 7. Analítica financiera: inventario superficie por superficie

**Ninguna queda como «pendiente».** Estado tras la 173:

| Superficie | Qué le pasa | Acción |
| --- | --- | --- |
| `metrics.ts` → `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva` | Declaran **listas cerradas** que no incluyen las categorías nuevas ⇒ **no se inflan**. | **Ninguna.** Se añade un **guardia** que afirma que ninguna de las tres declara una categoría de terceros (R51). |
| `metrics.ts` → `egresos` | Ya declara `egreso_pago_tienda`; hoy nadie la emitía. Tras la 173 **su número crece** sin que su id ni su nombre cambien. | Actualizar la `descripcion` para que diga que incluye el dinero entregado a las tiendas (R53) `[P4]`. |
| `metrics.ts` → `cod_recaudado` | Ya se sirve en **dos vistas no sumables** (snapshot de cierre y ledger de tienda). Añadir la caja como tercera fuente crearía una tercera definición del mismo dinero. | **No se toca** (R52). Guardia que lo afirma. |
| `metrics.ts` → métricas nuevas | El tablero no tiene la cifra que el humano pidió. | Añadir `dinero_en_caja` (todas las categorías) y `ganancia_ordenex` (solo las propias), `fuente: ledger / wallet_movimiento`, alcance el de las financieras (R54) `[P4]`. |
| `IngresosAnaliticaRepository` | Valida las categorías declaradas contra `WALLET_MOVIMIENTO_CATEGORIA_SEED`; el SEED gana los dos valores solo. | **Ninguna** en el código. Test que confirma que sigue rechazando una categoría ajena (R57). |
| `AnaliticaFinancieraService.deCaja` | Usa `derivarBalance` sobre el subconjunto declarado. Con `derivarBalance` intacto, sigue correcto. | Añadir el manejador de las **dos métricas nuevas** (reusa `derivarCaja`, **no** reimplementa la resta). |
| `IDS_FINANCIERAS_SERVIDAS` + guardia de coherencia | Pasa de 8 a 10 ids; el guardia falla por defecto **y** por exceso. | Ampliar la lista; el guardia queda como está (R55). |
| `ConciliacionCierresAnaliticaRepository` | Agrupa los tres libros por `(origen_id, tipo)`. La fila nueva de caja con origen `cierre_dia` **aparecerá** en su salida. | **Ninguna.** El cuadre solo mira `wallet_tienda_movimiento` + `credito` (`AnaliticaFinancieraService.ts:441-443`) ⇒ **no cambia** (R56). Test que lo mide sobre datos con COD en caja. |
| `analytics_daily` / rollup diario | Las ocho financieras son `clase: live` con `fuente: ledger`; ninguna sale del rollup. | **Ninguna.** Guardia que lo afirma. |
| `lib/analytics/alcance-columnas.ts`, `types.ts` (`TablaDinero`) | Ya incluyen `wallet_movimiento`; no hay tabla nueva. | **Ninguna.** |
| Pantalla del tablero (`AnaliticaShell`) | Hoy está **vacía** (la 131 no está hecha): no hay dónde se pinte una métrica financiera. | **Ninguna.** Se declara para que nadie busque una pantalla que no existe. |

**Frontera con la feature 175** («analítica: corregir el catálogo de métricas», pendiente): los
cambios de catálogo de arriba los **causa** esta feature, así que el default los pone aquí. Si el
humano prefiere agruparlos en la 175, la 173 se queda sin R53/R54 y la métrica `egresos` cambia de
número con la descripción vieja hasta entonces. Es P4.

---

## 8. Frontend

Todo en `app/(app)/wallet/`. Sigue siendo Server Component que pre-obtiene y pasa por props (R64).

- **`WalletBalanceCard.tsx` → `CajaResumenCard.tsx`.** Renombrado a propósito: mientras el archivo se
  llame «balance», alguien volverá a poner esa palabra en pantalla. La tarjeta pasa a tener **dos
  bloques**:
  - **Dinero en caja** `[P1]`, con su desglose «Entró / Salió».
  - **Ganancia de Ordenex** `[P1]`, con su desglose «Ingresos de Ordenex / Gastos de Ordenex».
  - Tercera línea `[P6]`: **«Contra-entrega cobrado y aún no entregado a las tiendas»**, con la
    advertencia obligatoria: *«No es lo que se les debe: de este dinero, Ordenex descuenta flete,
    comisión e IVA. La deuda exacta por tienda está en Wallet → Tiendas.»* (R34). Enlace incluido.
  - Nota breve de diferencia (R60), en español llano: *«El dinero en caja incluye el contra-entrega
    que se cobró a nombre de las tiendas. La ganancia no: es solo lo que Ordenex gana menos lo que
    gasta.»*
- **`page.tsx`**: la descripción deja de decir «balance general» (R59).
- **`wallet-labels.ts`**: `CATEGORIA_LABEL` gana las dos claves —el build no compila sin ellas—:
  `ingreso_cod_recaudado: "Contra-entrega cobrado"`, `ingreso_reverso_pago_tienda: "Pago a tienda
  anulado"` (R61). El `Select` de categoría se puebla del SEED, así que el filtro las recoge **solo**
  (R61) — se verifica, no se implementa.
- **`wallet-ledger-descarga-columnas.ts`**: usa `CATEGORIA_LABEL`; la descarga las recoge sola (R62).
  Se verifica.
- **Rótulo condicional `[P7]`**: con filtros puestos, «Dinero en caja» pasa a «Movimiento neto del
  periodo». El número no cambia; el nombre deja de mentir.
- **Sin cambios**: `/wallet/tiendas` (tabla y desglose), `/wallet/mensajeros`, `/mi-wallet`,
  `/mis-pagos` (R63). Sus suites quedan **sin editar**, y eso es parte de la verificación.

---

## 9. Alcance por rol

Sin novedad y sin ampliar nada: la caja es de los roles de **acceso total** (`maestro` + `admin`),
guardia evaluado antes de tocar la base, y `notFound` para el resto (R65). El puerto nuevo de §4 no
introduce ningún camino de lectura ni de escritura para otro rol: la liquidación ya exige acceso
total (`esAccesoTotal` en `registrarPagoTienda` y `anularPago`).

---

## 10. Alternativas descartadas

**A) No escribir el COD en la caja y derivar «dinero en caja» leyendo también el ledger de tienda.**
*Descartada.* Evita la migración de enum entera. Pero: (1) el libro de la caja dejaría de explicar la
cifra de la caja — la pantalla mostraría un número que **ninguna fila del libro justifica**, y filtrar
por fecha o categoría daría una cabecera que no cuadra con su propio listado; (2) crea una **segunda
fuente** para un número de dinero, que es justo lo que `AnaliticaFinancieraService.ts:44-50` prohíbe
por escrito («no da un error, da una discusión»); (3) no resuelve la otra mitad del pedido: el humano
pidió que **salga** al pagarle a la tienda, y para eso hay que emitir `egreso_pago_tienda` de todos
modos.

**B) Una columna `naturaleza` en `wallet_movimiento` en vez de derivarla de la categoría.**
*Descartada.* Sería explícita y consultable. Pero crea una **segunda fuente de verdad** al lado de
`categoria`, sobre una tabla **append-only** con filas ya en producción: la columna nacería `NULL` o
exigiría un backfill de **todas** las filas, y un valor mal puesto en una fila inmutable no se corrige
—se compensa—. La derivación por categoría es total, se comprueba en compilación y no puede
desincronizarse consigo misma.

**C) Reusar `ingreso_ajuste` para el reverso de la anulación** (lo que ya hace `reversarEgreso`).
*Descartada.* Ahorra un valor de enum y **rompe la cifra principal de la feature**: `ingreso_ajuste`
es de naturaleza propia, así que anular un pago a una tienda **subiría la ganancia de Ordenex**. Es
un fallo que ningún test de la 172 podía atrapar, porque allí la caja no se tocaba. El coste marginal
del segundo valor de enum es cero: la misma migración, el mismo `down.sql`, la misma cascada de
compilación.

**D) Una tabla nueva `caja_tesoreria` en paralelo a `wallet_movimiento`.** *Descartada.* Dejaría la
caja «de resultado» intacta y libre de riesgo. Pero significa **dos libros de la misma caja**, con
dos idempotencias, dos derivaciones, dos pantallas y una conciliación permanente entre ambos; y el
día que discrepen no habría forma de decir cuál tiene razón. El libro de la caja ya es append-only,
ya tiene idempotencia por origen y ya está indexado: el modelo existente aguanta esto sin inventar
nada.

**E) Emitir el reverso como `tipo: "ingreso"` con `categoria: "egreso_pago_tienda"`.**
*Descartada.* Aritméticamente funciona con la clasificación de §1.1 (cubeta por categoría, signo por
tipo) y ahorra el segundo valor de enum. Pero el `CHECK` de §2.2 lo **rechazaría** —y con razón: una
categoría llamada `egreso_*` con tipo `ingreso` es exactamente la incoherencia que la restricción
existe para impedir—, y el listado del libro mostraría «Pago a tienda» en la columna de ingresos, que
es incomprensible para quien lo lea.

**F) Cambiar la firma de `derivarBalance` para que devuelva las dos cifras.** *Descartada.* Parece la
opción obvia («el problema está ahí»). Pero `derivarBalance` tiene un segundo consumidor —la
analítica financiera, sobre **subconjuntos** de categorías— donde «ingresos − egresos» sigue siendo
lo correcto y donde «ganancia» no significaría nada (¿la ganancia de un subconjunto que solo tiene
IVA?). Cambiarla arrastraría cuatro métricas de dinero a un refactor que esta feature no pide. El
repo ya resolvió este dilema una vez y del mismo modo: la 171 añadió `derivarDesgloseTienda` **al
lado** de `derivarSaldoTienda`, sin tocarlo.

---

## 11. Archivos que toca

**Base de datos**
- `db/migrations/<ts>_caja_tesoreria/{migration.sql,down.sql}` (NUEVO)
- `db/schema.prisma` (2 valores de enum + comentario)

**Backend**
- `lib/utils/caja-tesoreria.ts` (NUEVO: `NATURALEZA_POR_CATEGORIA`, `derivarCaja`)
- `lib/types/wallet.ts` (SEED + `CajaResumenDTO` + `AgregadoCajaRow`)
- `lib/interfaces/repositories/IWalletMovimientoRepository.ts` (`fechaMovimiento?`, `agregarPorCategoriaYTipo`, `−agregarBalance`)
- `lib/repositories/WalletMovimientoRepository.ts`
- `lib/interfaces/services/IWalletService.ts` + `lib/services/WalletService.ts` (`verResumenCaja`)
- `lib/actions/wallet.ts`
- `lib/interfaces/services/ICajaCodFeedService.ts` + `lib/services/CajaCodFeedService.ts` (NUEVOS)
- `lib/repositories/CierresAdminRepository.ts` (enganche del feed nuevo)
- `lib/interfaces/services/ICajaPagoTiendaFeedService.ts` + `lib/services/CajaPagoTiendaFeedService.ts` (NUEVOS)
- `lib/services/LiquidacionService.ts` (puerto nuevo + 2 escrituras) · `lib/actions/liquidacion.ts` (cableado)
- `lib/analytics/metrics.ts`, `lib/types/analitica-financiera.ts`, `lib/services/AnaliticaFinancieraService.ts` `[P4]`
- `lib/services/CajaBackfillTesoreriaService.ts` + `scripts/backfill-caja-tesoreria.ts` (NUEVOS) `[P3]`

**Frontend**
- `app/(app)/wallet/_components/CajaResumenCard.tsx` (renombra `WalletBalanceCard.tsx`)
- `app/(app)/wallet/_components/WalletModule.tsx`, `wallet-labels.ts`
- `app/(app)/wallet/page.tsx`

**Tests que cambian a propósito** (no son regresiones)
- `tests/unit/services/liquidacion-service.test.ts` y `liquidacion-anulacion.test.ts`: las
  aserciones de R40 de la 172 en las **dos ramas de tienda** (§4).
- `tests/unit/services/wallet-service.test.ts`, `tests/integration/wallet-page.test.tsx`,
  `tests/unit/actions/wallet-actions.test.ts`: `verBalance` → `verResumenCaja`.

---

## 12. Verificación

- **Unitario**: `derivarCaja` (pura, incluido el recorrido del SEED en runtime), los dos feeds,
  las dos ramas de `LiquidacionService`, el servicio de backfill.
- **Integración con Postgres** (`tests/integration/db/`): la migración (estática, patrón del repo),
  el `CHECK` actuando (código `23514`) **con contrapruebas de que no rechaza de más**, y la
  idempotencia real de las tres claves de origen.
- **Prueba por mutación obligatoria** en lo money-critical: si se cambia `NATURALEZA_POR_CATEGORIA`
  moviendo `ingreso_cod_recaudado` a «propio», **algún test debe ponerse rojo**. Igual si se cambia
  la categoría del reverso a `ingreso_ajuste` (§10-C). Un test que sobrevive a esas dos mutaciones no
  está midiendo la feature.
- **Sin E2E**: el repo no tiene arnés (precedente declarado en specs anteriores). El riesgo se cubre
  con integración contra Postgres y con la verificación por MCP de §13.
- **Producción y preview**: `--comprobar` del backfill + lectura por MCP de las filas nuevas.

---

## 13. Riesgos

1. **El `CHECK` valida filas existentes al aplicarse `[P5]`.** Mitigación: `T A.0` mide producción y
   preview **antes** de escribir la migración. Consta que **preview no es alcanzable por el MCP**
   desde estas sesiones, y eso ya bloqueó un merge. Plan alternativo si sigue sin serlo: escribir el
   `CHECK` como `NOT VALID` + `VALIDATE CONSTRAINT` en una segunda sentencia, que no bloquea el
   despliegue aunque haya filas viejas incoherentes. Se decide **con el dato medido**, no antes.
2. **El backfill olvidado en un entorno** `[P3]`. Mitigación: `--comprobar` (R43/R44) y una tarea de
   cierre que exige haberlo corrido y medido en cada entorno.
3. **Alguien lee «Dinero en caja» como utilidad.** Es el riesgo que motivó la feature. Mitigación:
   las dos cifras siempre juntas (R58), la palabra «balance» erradicada (R59) y la nota de diferencia
   (R60).
4. **Alguien lee la tercera línea como la deuda con las tiendas** `[P6]`. Es **mayor** que la deuda
   real. Mitigación: la advertencia obligatoria de §8 y R34; o responder (b) a P6.
5. **La caja queda mixta (tesorería + devengo del mensajero)** `[P2]`. Declarado en §3.4. Es una
   decisión del humano, no un descuido.
6. **La 172 acaba de llegar a producción (2026-08-03).** Esta feature reescribe dos de sus caminos.
   Mitigación: las aserciones que cambian se enumeran una a una en §4 y en `tasks.md`, para que el
   review no tenga que adivinar cuáles eran regresiones y cuáles cambios pedidos.
