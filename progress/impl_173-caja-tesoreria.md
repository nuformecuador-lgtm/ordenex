# Feature 173 — La caja principal en modo tesorería · bitácora de implementación

> Rama `feature/173-caja-tesoreria`. Fase **backend**.
> Alcance de esta entrada: **TANDA A, excepto `T A.2`**.

---

## 1. Qué se hizo y qué NO

| Task | Estado | Nota |
| --- | --- | --- |
| `T A.0` — medir producción antes del `CHECK` | **NO HECHA** | Pendiente de autorización humana para leer producción por MCP. |
| `T A.1` — migración: dos valores de enum | **HECHA** | Round-trip up → down → up verificado contra el Postgres local. |
| `T A.2` — el `CHECK` categoría↔tipo | **NO HECHA — BLOQUEADA A PROPÓSITO** | Ver §5. |
| `T A.3` — tipos, SEED y contrato de escritura | **HECHA** | |
| `T A.4` — `NATURALEZA_POR_CATEGORIA` + `derivarCaja` | **HECHA** | Mutación obligatoria ejecutada (§4). |
| `T A.5` — guardia de que `derivarBalance` queda intacto | **HECHA** | La suite de `wallet-balance` **no aparece en el diff**. |

---

## 2. Archivos

### Creados

| Archivo | Task |
| --- | --- |
| `db/migrations/20260803120000_caja_tesoreria/migration.sql` | `T A.1` |
| `db/migrations/20260803120000_caja_tesoreria/down.sql` | `T A.1` |
| `lib/utils/caja-tesoreria.ts` | `T A.4` |
| `tests/unit/utils/caja-tesoreria.test.ts` | `T A.4` |
| `tests/unit/guards/caja-derivaciones.guardia.test.ts` | `T A.5` |
| `tests/integration/db/caja-tesoreria-migration.test.ts` | `T A.1` (R49/R50) |

### Modificados

| Archivo | Qué | Task |
| --- | --- | --- |
| `db/schema.prisma` | Los 2 valores del enum `WalletMovimientoCategoria`, al final (orden físico del enum). | `T A.1` |
| `lib/types/wallet.ts` | `WALLET_MOVIMIENTO_CATEGORIA_SEED` +2 valores; `AgregadoCajaRow` y `CajaResumenDTO` nuevos. | `T A.3` |
| `lib/interfaces/repositories/IWalletMovimientoRepository.ts` | `CrearMovimientoInput.fechaMovimiento?: Date` (opcional). | `T A.3` |
| `lib/repositories/WalletMovimientoRepository.ts` | **1 línea**: la clave `fechaMovimiento` solo viaja si el llamador la trae. Ver §3. | `T A.3` |
| `tests/unit/repositories/wallet-movimiento-repository.test.ts` | +2 asserts: sin `fechaMovimiento` la clave **no viaja**; con ella, viaja tal cual. | `T A.3` |
| `app/(app)/wallet/_components/wallet-labels.ts` | **2 líneas** de `CATEGORIA_LABEL`. Ver §3. | cascada de `T A.1` |
| `tests/integration/db/incidente-indemnizacion-migration.test.ts` | 2 asserts que leían el SEED **en vivo**, fijados al punto-en-el-tiempo. Ver §6. | rojo propio |

### Lo que NO está en el diff (y es parte de la verificación)

- `lib/utils/wallet-balance.ts` — **R9**: `derivarBalance` no se toca.
- `tests/unit/utils/wallet-balance.test.ts` — **R9 / `T A.5`**: su suite no se edita.
- **Ningún `down.sql` previo** — **R50**. El de la 45 sigue con 12 valores y el de la 158 con 14:
  son su estado punto-en-el-tiempo. El único que lista 15 es el de esta carpeta.

---

## 3. Dos cambios fuera de la lista literal de archivos, declarados

Los dos son mínimos, forzados y se declaran para que el review no tenga que adivinarlos.

**(a) `WalletMovimientoRepository.crearMovimientos` — 1 línea.** `T A.3` se titula «tipos, SEED y
**contrato de escritura**», y un contrato que la única implementación ignora en silencio no es un
contrato: la tanda C escribiría `fechaMovimiento` y Prisma la descartaría sin un error. La línea es
estrictamente aditiva y **ningún escritor existente cambia de comportamiento** —la clave se omite,
no se manda como `undefined`, así que quien no la pasa sigue cayendo en el `DEFAULT
CURRENT_TIMESTAMP` de la columna—. Los dos asserts nuevos del test lo miden en las dos direcciones.

**(b) `app/(app)/wallet/_components/wallet-labels.ts` — 2 líneas.** Es la **cascada de compilación
que el propio design anuncia** (§2.4): `CATEGORIA_LABEL` es un `Record` completo y **sin las dos
claves `pnpm typecheck` no pasa**. Salida real antes de añadirlas:

```
app/(app)/wallet/_components/wallet-labels.ts(31,14): error TS2739: Type '{ ... }' is missing the
following properties from type 'Record<...>': ingreso_cod_recaudado, ingreso_reverso_pago_tienda
```

Sin esas dos líneas, la tanda A entera se entrega con el árbol sin compilar. Los rótulos son los
**literales del design §8** (`"Contra-entrega cobrado"` / `"Pago a tienda anulado"`). **`T G.2` sigue
teniendo trabajo**: su «hecho» es *verificar* que el filtro y la descarga las recogen solas desde el
SEED, y eso no se ha tocado ni comprobado aquí.

---

## 4. `T A.4` — la mutación obligatoria, EJECUTADA

**Mutación:** en `lib/utils/caja-tesoreria.ts`, `ingreso_cod_recaudado: "terceros"` → `"propio"`.

**Resultado: 10 tests rojos** (`tests/unit/utils/caja-tesoreria.test.ts`):

```
     × R2 (design §2.1): las TRES categorias de tesoreria son de TERCEROS, y ninguna otra lo es
     × R5: `ganancia` = ingresos propios − egresos propios, sobre el MISMO conjunto
     × R1: sobre un conjunto CON dinero de terceros, las dos cifras son DISTINTAS
     × R2/R5: el contra-entrega ENTRA en la caja y NO roza la ganancia
     × R26/R30: pagar a la tienda y anular deja el dinero en caja igual y la ganancia intacta
     × R4/R5: signos NEGATIVO y CERO, en las dos cifras
     × acumula VARIAS filas del mismo tipo sin perder ninguna
     × R6: basta UNA fila de terceros para que las dos cifras se separen
     × R7: los nueve importes son STRING con DOS decimales, siempre
     × R7: money-safe — un importe fuera del rango exacto de un double no pierde centavos
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 10 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed | 1 passed (2)
      Tests  10 failed | 23 passed (33)
```

Detalle del que mide el **efecto sobre la ganancia**, no la clasificación:

```
 FAIL  tests/unit/utils/caja-tesoreria.test.ts > derivarCaja — las dos cifras (R1/R4/R5) >
       R2/R5: el contra-entrega ENTRA en la caja y NO roza la ganancia
AssertionError: expected '10500.00' to be '500.00' // Object.is equality

Expected: "500.00"
Received: "10500.00"

 ❯ tests/unit/utils/caja-tesoreria.test.ts:147:29
```

Es exactamente el fallo que la feature existe para impedir: la utilidad de Ordenex inflada en
₡10.000 de dinero que es de una tienda. **Mutación revertida**; las dos suites vuelven a 33 verdes.

> Nota para `T H.3`: la guardia `caja-derivaciones.guardia.test.ts` **sobrevive** a esta mutación, y
> está bien que sea así: mide que `derivarCaja` reusa `derivarBalance`, no la clasificación. Quien
> mide la clasificación es la suite de `T A.4`, y son 10.

Las otras dos mutaciones obligatorias de `T H.3` (reverso a `ingreso_ajuste`, fecha con `now()`)
corresponden a las tandas C y E y **no se han ejecutado**. Lo que sí está probado aquí es la
*aritmética* de la primera: `caja-tesoreria.test.ts` compara `ingreso_reverso_pago_tienda` contra
`ingreso_ajuste` sobre el mismo monto y demuestra que el segundo sube la ganancia ₡4.000.

---

## 5. `T A.2` — por qué NO está, y qué hereda quien la haga

El `CHECK` categoría↔tipo **valida las filas existentes al aplicarse**, y en Vercel **mergear es
aplicar**. `T A.0` —medir producción por MCP antes de escribirlo— está pendiente de una autorización
humana. Escribirlo a ciegas es exactamente el riesgo declarado en `design.md §13.1`.

Por eso: **no hay ningún `ADD CONSTRAINT` en `migration.sql`, ni siquiera comentado**, y el
`down.sql` **no suelta ningún `CHECK`** porque todavía no existe ninguno que soltar.

**Encargo explícito para quien reabra la carpeta `20260803120000_caja_tesoreria`:** al añadir el
`ADD CONSTRAINT` al `migration.sql` hay que añadir su `DROP CONSTRAINT IF EXISTS` **al principio**
del `down.sql` de la misma carpeta, antes de los `DROP INDEX`. Si no, el `down` deja la restricción
viva sobre un enum recreado.

Ninguna aserción de `tests/integration/db/caja-tesoreria-migration.test.ts` prohíbe `ADD CONSTRAINT`:
esa suite está escrita para que `T A.2` pueda ampliarla sin pelearse con ella.

---

## 6. Un rojo propio que hubo que arreglar (y por qué no fue tocando un `down.sql`)

Añadir dos valores al enum puso en rojo **2 asserts de la suite de la 158**:

```
 × R2/R3: WALLET_MOVIMIENTO_CATEGORIA_SEED contiene egreso_indemnizacion y conserva las 14 previas
   AssertionError: expected [ 'ingreso_flete', …(16) ] to have a length of 15 but got 17
 × R4: wallet_movimiento_categoria vuelve a los 14 valores previos, con USING cast
   AssertionError: expected [ 'ingreso_flete', …(13) ] to deeply equal [ 'ingreso_flete', …(15) ]
```

**Diagnóstico:** los dos leían `WALLET_MOVIMIENTO_CATEGORIA_SEED` **en vivo** para expresar un hecho
**punto-en-el-tiempo** (`toHaveLength(15)` y `SEED.filter(c => c !== "egreso_indemnizacion")`). Una
expectativa así convierte en rojo ajeno cada feature futura que amplíe el catálogo.

**Arreglo:** fijar esos 15 valores como literal en la propia suite (`CATEGORIAS_TRAS_LA_158`), que es
el criterio que `wallet-egreso-migration.test.ts` ya aplica con sus 12. **No se tocó ningún
`down.sql`**: el de la 158 sigue listando sus 14 valores intactos (R50). La suite de la 158 sigue
midiendo lo mismo, y ahora además afirma que los 15 de su momento siguen **en ese orden y al
principio** del SEED — es decir, que lo posterior se **añadió** y no reordenó nada.

Mi propia suite (`caja-tesoreria-migration.test.ts`) fija sus 15 y sus 17 a mano por la misma razón.

---

## 7. Trazabilidad `R<n>` → test

Los `R` que esta entrega **cierra**:

| R | Test que lo verifica |
| --- | --- |
| R1 (parte derivación) | `tests/unit/utils/caja-tesoreria.test.ts` — «sobre un conjunto CON dinero de terceros, las dos cifras son DISTINTAS» |
| R2 | idem — «TODA categoria del catalogo tiene naturaleza declarada» (**recorre el SEED en RUNTIME**) + «las TRES categorias de tesoreria son de TERCEROS, y ninguna otra lo es» |
| R3 | idem — el `Record` es total: `Object.keys(NATURALEZA_POR_CATEGORIA)` == SEED, en las dos direcciones. En compilación lo fuerza `Record<WalletMovimientoCategoria, …>` (quitar una clave no compila) |
| R4 | idem — «`enCaja` = entradas − salidas, con TODAS las naturalezas dentro» |
| R5 | idem — «`ganancia` = ingresos propios − egresos propios, sobre el MISMO conjunto» |
| R6 | idem — «un conjunto con TODAS las categorias propias del catalogo da enCaja === ganancia» + «basta UNA fila de terceros para que las dos cifras se separen» |
| R7 | idem — «los nueve importes son STRING con DOS decimales», «el signo es EXPLICITO», los dos casos money-safe y el barrido de `Number(`/`parseFloat(`/`parseInt(`/`toFixed(` sobre el módulo |
| R9 | `tests/unit/utils/wallet-balance.test.ts` **sin editar** + `tests/unit/guards/caja-derivaciones.guardia.test.ts` (firma, salida, la suite no editada, y que `derivarCaja` **reusa** `derivarBalance` 3 veces en vez de duplicar la resta con signo) |
| R10 | `caja-tesoreria.test.ts` — «la firma solo admite las filas ya agregadas, ni repositorio ni cliente» (arity 1, salida síncrona, y el módulo no nombra `PrismaClient`/`Repository`/`findMany`/`groupBy`/`await`) |
| R49 | `tests/integration/db/caja-tesoreria-migration.test.ts` — el `down` recrea el enum con **15** valores y los **2** índices, con `USING` cast y sin dejar el tipo `_old` |
| R50 | idem — el `down` de la 45 sigue con 12, el de la 158 con 14, y **ningún `down.sql` anterior nombra los dos valores nuevos** |

Los `R` que esta entrega **prepara** (los cierra otra tanda):

| R | Qué queda montado aquí |
| --- | --- |
| R20, R25 | `CrearMovimientoInput.fechaMovimiento?` + los 2 asserts de `wallet-movimiento-repository.test.ts`. Los cierran `T C.2` / `T C.3`. |
| R45, R46 | **Nada**: `T A.2` está bloqueada (§5). |
| R26, R30 | La aritmética ya está probada en `caja-tesoreria.test.ts`; el **emisor** es de la tanda C. |
| R61 | Las 2 claves de `CATEGORIA_LABEL` (§3b). La **verificación** (filtro y descarga las recogen solas) es de `T G.2`. |

---

## 8. Round-trip de la migración contra Postgres local

Base local: `PostgreSQL "ordenex" @ localhost:5432`. Al empezar, `prisma migrate status` →
`Database schema is up to date!` (107 migraciones).

```
$ npx prisma migrate deploy
Applying migration `20260803120000_caja_tesoreria`
All migrations have been successfully applied.

$ npx tsx scripts/db-rollback.ts
Aplicando rollback: 20260803120000_caja_tesoreria
Script executed successfully.
Script executed successfully.
Rollback completado: 20260803120000_caja_tesoreria

$ npx prisma migrate deploy
Applying migration `20260803120000_caja_tesoreria`
All migrations have been successfully applied.

$ npx prisma migrate status
108 migrations found in prisma/migrations
Database schema is up to date!
```

`ALTER TYPE … ADD VALUE` va **sin envolver en transacción propia** y con `IF NOT EXISTS`, siguiendo
el patrón «enum-existente» de las features 41/45/67/158: la restricción real de Postgres es que el
valor nuevo no se **use** en la misma transacción, y esta migración no lo usa (cero
`INSERT`/`UPDATE`/`DELETE`, aserción incluida en la suite).

---

## 9. Gate ejecutado

> Se corrió el gate **acotado** que ordenó el leader, no la suite completa.

**`pnpm typecheck`**

```
> tsc --noEmit
```

(sin salida ⇒ **verde**.)

**`pnpm lint`**

```
✖ 27 problems (0 errors, 27 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores.** Las 27 advertencias son la línea base del repo (`_args`/`_items` sin usar en suites
antiguas): **ninguna cae en un archivo de esta tanda** (comprobado filtrando la salida por
`caja-tesoreria`, `wallet-labels`, `wallet-movimiento`, `wallet.ts`, `caja-derivaciones`,
`IWalletMovimiento` → cero coincidencias).

**`pnpm exec vitest related --run`** sobre los 6 archivos de código tocados

```
 Test Files  103 passed (103)
      Tests  1471 passed (1471)
   Duration  72.77s
```

**`pnpm exec vitest run tests/integration/db`** (obligatorio: se toca una migración)

```
 Test Files  91 passed (91)
      Tests  1112 passed (1112)
   Duration  7.70s
```

**No corrido aquí:** `./init.sh --rapido` y `./init.sh` completo. Los corre el leader.

---

## 10. Veredicto

TANDA A entregada menos `T A.2`: enum migrado con round-trip verde, derivación pura de las dos cifras
con la mutación money-critical ejecutada y revertida, `derivarBalance` intacto y bajo guardia, y el
`CHECK` deliberadamente sin escribir a la espera de `T A.0`.

---
---

# TANDA B — El COD entra en la caja

> Misma rama `feature/173-caja-tesoreria`. Fase **backend**.
> Alcance de esta entrada: **`T B.1`, `T B.2`, `T B.3`, `T B.4`** — las cuatro **HECHAS**.

## B1. Qué se hizo

| Task | Estado | Nota |
| --- | --- | --- |
| `T B.1` — `CajaCodFeedService` | **HECHA** | Lee el **ledger**, no las gestiones. Contraprueba incluida. |
| `T B.2` — enganche en la aprobación | **HECHA** | Cero dependencias nuevas en el constructor (§B4). Orden afirmado por test. |
| `T B.3` — el cierre de bodega no toca la caja | **HECHA** | Cuarta afirmación, en la línea de las tres de 42/43/44. |
| `T B.4` — idempotencia | **HECHA** | Contra **Postgres real**, no contra un doble. |

## B2. Archivos

### Creados

| Archivo | Task |
| --- | --- |
| `lib/interfaces/services/ICajaCodFeedService.ts` | `T B.1` |
| `lib/services/CajaCodFeedService.ts` | `T B.1` |
| `tests/unit/services/caja-cod-feed-service.test.ts` | `T B.1` |
| `tests/unit/repositories/cierres-admin-caja-cod.test.ts` | `T B.2` |
| `tests/integration/db/caja-tesoreria-idempotencia.test.ts` | `T B.4` |

### Modificados

| Archivo | Qué | Task |
| --- | --- | --- |
| `lib/repositories/CierresAdminRepository.ts` | +45 líneas, **todas aditivas**: el import, la constante del feed y el bloque del COD tras el feed del ledger por tienda. | `T B.2` |
| `tests/unit/services/cierres-bodega-admin-service.test.ts` | +1 caso (`feature 173/R16`). | `T B.3` |
| `tests/unit/repositories/cierres-admin-repository.test.ts` | +1 línea en el doble de Prisma. Ver §B5. | cascada de `T B.2` |
| `tests/unit/services/cierres-admin-service.test.ts` | +1 `findMany` en el doble de `walletTiendaMovimiento`. Ver §B5. | cascada de `T B.2` |
| `tests/integration/db/cierre-detail-congelado.test.ts` | ídem. Ver §B5. | cascada de `T B.2` |

`git diff --stat` de la tanda: **90 inserciones, 0 borrados**. No hay ni una línea eliminada en
todo el diff de código y de tests.

### Lo que NO está en el diff (y es parte de la verificación)

- `lib/services/WalletMensajeroFeedService.ts` y `tests/unit/services/wallet-mensajero-feed-service.test.ts`
  — **R66 / `[P2]` = (a)**. El `egreso_pago_mensajero = P` del feed de la 44 **no se tocó**: ni a
  `min(P,E)`, ni movido a la liquidación, ni nada. Lo único que se hizo con él fue **medirlo**:
  `cierres-admin-caja-cod.test.ts` fija que sigue llegando a la caja con su monto íntegro junto al
  COD nuevo. El límite que eso deja («Dinero en caja» menor que el dinero real, en exactamente la
  cuenta por pagar a mensajeros) está declarado en `design.md §3.4` y **sigue vivo a propósito**.
- `lib/services/LiquidacionService.ts`, `lib/actions/liquidacion.ts` y las suites de liquidación —
  son la Tanda C.
- `lib/actions/cierres-admin.ts` — el composition root **no cambia** (§B4).
- `lib/utils/caja-tesoreria.ts` — se **reusa**, no se reimplementa: nada de esta tanda deriva cifras.

## B3. `T B.1` — por qué el feed lee el LEDGER

`construirIngresoCod(cierreId, tx)` hace `findMany` sobre `wallet_tienda_movimiento` con las
**cuatro** claves (`origen_tipo`, `origen_id`, `categoria = cod_recaudado`, `tipo = credito`),
suma con `Prisma.Decimal` y devuelve **0 o 1** fila. Sin `fechaMovimiento` (R17). Sin
`Number(`/`parseFloat(`/`parseInt(` (barrido sobre el módulo, ignorando comentarios).

El tipo del cliente de transacción es `Pick<PrismaClient, "walletTiendaMovimiento">`: el feed **no
puede** leer `gestion_orden` aunque alguien quisiera — lo impide el compilador antes que cualquier
test. Encima de eso, la **contraprueba de R12 exigida por la task** está escrita y ejecutada: con
el ledger diciendo `12801.00` y las gestiones diciendo `10000.00`, el movimiento sale por
`12801.00` **y** `gestionOrden.findMany` acumula **cero llamadas**. Su espejo también: con el
ledger vacío y las gestiones diciendo `5000.00`, no sale ninguna fila.

El doble del ledger **honra el `where`** como lo haría Postgres (filtra de verdad). Con un doble
complaciente, olvidar `categoria` o `tipo` en el WHERE seguiría verde y la caja se comería los
débitos de flete e IVA — dinero que Ordenex ya contó como propio — inflando el contra-entrega.

## B4. `T B.2` — cero dependencias nuevas en el constructor, y qué significa exactamente

El feed va como **constante de módulo** (`const CAJA_COD_FEED = new CajaCodFeedService()`), no como
octavo parámetro del constructor. Es lo que pide el design con esas palabras, y se puede hacer
porque el servicio **no tiene estado ni dependencias propias**, y porque lo que sí hace falta para
escribir —el repositorio de la caja de la 42— **ya estaba inyectado desde la feature 42**.

La alternativa (inyectarlo) obligaba a tocar los **12 sitios** que construyen
`CierresAdminRepository`, entre ellos `wallet-idempotencia.test.ts` (42) y
`cierres-admin-indemnizacion.test.ts` (158), con un octavo argumento mecánico cada uno. El acuerdo
está fijado por un test estructural: `expect(CierresAdminRepository.length).toBe(8)`.

El **orden** respecto al feed del ledger por tienda se afirma **midiendo**, no comentando: el doble
apunta en una traza cuándo se **escribe** el ledger y cuándo se **lee**, y el test exige
`escribe < lee`. La mutación de §B7-2 lo confirma.

Lo demás que fija esta suite: el ingreso es único y por la suma exacta; si la escritura en la caja
falla, el `$transaction` del doble **revierte de verdad** y quedan el cierre en `solicitado`, el
ledger vacío y la caja vacía (R15, medido, no deducido); rechazar no emite; un `count = 0` no emite.

## B5. Tres dobles de Prisma que ganaron un `findMany` (declarado)

Que el feed lea el ledger **de la base** tiene una consecuencia mecánica: los dobles de Prisma que
aprueban un cierre con contra-entrega necesitan exponer `walletTiendaMovimiento.findMany`. Sin
tocarlos, 6 tests de tres suites reventaban con `Cannot read properties of undefined (reading
'findMany')` — **rojos míos**, no ajenos, y por eso se arreglan aquí:

| Suite | Qué se añadió | Por qué es coherente |
| --- | --- | --- |
| `cierres-admin-repository.test.ts` | `findMany → []` | En esa suite el repositorio del ledger es un doble que **no escribe nada**: un ledger vacío es exactamente lo que corresponde. |
| `cierres-admin-service.test.ts` | `findMany` que filtra `tiendaRows` | Ahí el ledger **sí** se escribe (repositorio real sobre el doble): el `findMany` lee del mismo array. |
| `cierre-detail-congelado.test.ts` | `findMany` que filtra `movsTienda` | Ídem: el mismo libro que se escribe es el que se lee. |

Son **tres líneas de doble**, sin una sola aserción existente modificada ni borrada. **No cambia
ningún importe ni ninguna fórmula** —que es la sustancia de R68—; lo que cambia es que el doble ya
no está incompleto. Se declara aquí para que el review no tenga que deducirlo del diff.

La otra vía —que el feed **no** leyera la base— era peor: es literalmente romper R12.

Para acotar el alcance de esa cascada, el enganche solo pregunta al ledger cuando el feed de la 43
**acreditó** contra-entrega en esa misma aprobación. Esa guardia es la transcripción del
antecedente de R13 («si un cierre no acredita contra-entrega alguno») y **no decide el monto**: el
monto sale del ledger y solo del ledger. Hay un test que lo prueba con los dos números en
desacuerdo —ledger `8000.00`, array del feed `5000.00`— y el que entra en la caja es **8000.00**.

## B6. `T B.4` — la idempotencia, contra Postgres de verdad

`tests/integration/db/caja-tesoreria-idempotencia.test.ts` corre contra el Postgres local dentro de
una transacción que **siempre se revierte** (patrón de la 169). No hay ni una fila de dinero
inventada al terminar, pase lo que pase.

- **R14**: se siembra el ledger real (dos tiendas con COD, un débito de flete y un crédito de
  `ajuste_credito`), el feed **real** lee, el repositorio **real** inserta, y se repite el ciclo
  entero: `insertadas = 1` la primera vez y **`0` la segunda**, con **una** fila en la tabla y su
  monto intacto (`12801.00`).
- **R48**: el mismo `INSERT` **sin** `ON CONFLICT` **revienta**. Es la contraprueba de que la
  barrera es el índice único parcial y no la buena voluntad del código: quitar `skipDuplicates` no
  duplicaría, fallaría en alto.
- **R13** contra la base: un cierre sin créditos devuelve `[]` y `crearMovimientos` inserta `0`.
- Dos cierres distintos **no** se deduplican entre sí.
- Dos guardias **estructurales**: `crearMovimientos` no hace check-then-insert (`findFirst` /
  `findUnique` / `count` ⇒ cero coincidencias) y el bloque del enganche tampoco pregunta si el
  contra-entrega ya existe. La idempotencia **no es un `if`**.

De regalo, esta suite es la primera prueba **ejecutada** de que el valor de enum
`ingreso_cod_recaudado` de `T A.1` está aplicado en una base real.

## B7. Pruebas por mutación — EJECUTADAS y revertidas

### Mutación 1 (money-critical, la exigida): el WHERE del feed pierde `categoria`

`lib/services/CajaCodFeedService.ts`: se quita `categoria: "cod_recaudado"` del `findMany`. Es el
fallo realista: la caja se traga **cualquier** crédito del cierre, no solo el contra-entrega.

**Rojo en las tres suites, incluida la que corre contra Postgres:**

```
 ❯ tests/unit/services/caja-cod-feed-service.test.ts (14 tests | 3 failed)
     × R11/R12: con DOS tiendas en el cierre, el monto es la suma EXACTA de sus dos creditos
     × R11: el movimiento es un INGRESO de la categoria del contra-entrega, con el cierre como origen
     × R12: el WHERE acota por cierre, categoria Y tipo — las cuatro claves, ninguna de mas
 ❯ tests/unit/repositories/cierres-admin-caja-cod.test.ts (12 tests | 1 failed)
     × R12/R15: el feed LEE el ledger DESPUES de que se escribe (orden medido, no comentado)
 ❯ tests/integration/db/caja-tesoreria-idempotencia.test.ts (6 tests | 1 failed)
     × R14/R48: aprobar DOS veces el mismo cierre inserta UNA fila de contra-entrega
```

El detalle que importa, **medido contra Postgres**:

```
 FAIL  tests/integration/db/caja-tesoreria-idempotencia.test.ts >
       R14/R48: aprobar DOS veces el mismo cierre inserta UNA fila de contra-entrega
AssertionError: expected '13800.00' to be '12801.00' // Object.is equality

Expected: "12801.00"
Received: "13800.00"

 ❯ tests/integration/db/caja-tesoreria-idempotencia.test.ts:95:27
```

₡999 de un ajuste manual entrando en la caja como si fueran contra-entrega cobrado. **Mutación
revertida**; las tres suites vuelven a 32 verdes.

### Mutación 2: el feed del COD corre ANTES de escribir el ledger

`lib/repositories/CierresAdminRepository.ts`: el bloque del COD se mueve **encima** de
`walletTiendaMovimientoRepo.crearMovimientos`. Es exactamente el defecto que `T B.2` manda medir.

```
 ❯ tests/unit/repositories/cierres-admin-caja-cod.test.ts (12 tests | 4 failed)
     × R11/R12: UN ingreso `ingreso_cod_recaudado` con la SUMA exacta de los creditos del cierre
     × R12/R15: el feed LEE el ledger DESPUES de que se escribe (orden medido, no comentado)
     × R15: si la escritura en la caja falla, la aprobacion ENTERA revierte
     × el egreso `egreso_pago_mensajero` se sigue emitiendo tal cual, junto al COD

AssertionError: expected [] to have a length of 1 but got +0
 ❯ tests/unit/repositories/cierres-admin-caja-cod.test.ts:235:20
```

El ingreso desaparece entero: al leer, el ledger todavía estaba vacío. **Mutación revertida**; los
12 vuelven a verde.

## B8. Trazabilidad `R<n>` → test

| R | Test que lo verifica |
| --- | --- |
| R11 | `tests/unit/services/caja-cod-feed-service.test.ts` — «el movimiento es un INGRESO de la categoria del contra-entrega, con el cierre como origen» + `tests/unit/repositories/cierres-admin-caja-cod.test.ts` — «UN ingreso `ingreso_cod_recaudado` con la SUMA exacta de los creditos del cierre» |
| R12 | `caja-cod-feed-service.test.ts` — «con DOS tiendas … la suma EXACTA», «el WHERE acota por cierre, categoria Y tipo» y las **dos contrapruebas** («con el ledger y las gestiones DISCREPANTES, gana el ledger», «un ledger VACIO no se rescata con las gestiones») + `cierres-admin-caja-cod.test.ts` — «el monto sale del LEDGER, no del array que el feed de la 43 devolvió» |
| R13 | `caja-cod-feed-service.test.ts` — «devuelve lista VACIA», «creditos que SUMAN 0.00 tampoco emiten fila» + `cierres-admin-caja-cod.test.ts` — «NI UNA fila de contra-entrega (ni en 0.00)» + `caja-tesoreria-idempotencia.test.ts` (contra Postgres) |
| R14 | `tests/integration/db/caja-tesoreria-idempotencia.test.ts` — «aprobar DOS veces … inserta UNA fila» (Postgres real) + `cierres-admin-caja-cod.test.ts` — «aprobar DOS veces deja UNA sola fila, con su monto intacto» |
| R15 | `cierres-admin-caja-cod.test.ts` — «todo dentro de UNA transaccion», «el feed LEE el ledger DESPUES de que se escribe» y «si la escritura en la caja falla, la aprobacion ENTERA revierte» (estado, ledger y caja revertidos) |
| R16 | `tests/unit/services/cierres-bodega-admin-service.test.ts` — «feature 173/R16: aprobar un CierreBodega NO mete CONTRA-ENTREGA en la caja principal» |
| R17 | `caja-cod-feed-service.test.ts` — «NO se pasa `fechaMovimiento`: la clave ni siquiera esta presente» |
| R48 (parte cierre) | `caja-tesoreria-idempotencia.test.ts` — «el mismo insert sin `ON CONFLICT` revienta» + los dos guardias estructurales de que no hay check-then-insert |
| R66 / `[P2]` | `cierres-admin-caja-cod.test.ts` — «el egreso `egreso_pago_mensajero` se sigue emitiendo tal cual, junto al COD»; y la suite de `WalletMensajeroFeedService` **fuera del diff** |

## B9. Gate ejecutado

> Gate **acotado**, el que ordenó el leader. La suite completa NO se corrió.

**`pnpm typecheck`** → `tsc --noEmit`, sin salida, **exit 0**.

**`pnpm lint`**

```
✖ 27 problems (0 errors, 27 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores**, y las 27 advertencias son **la misma línea base de la Tanda A** (`_args`/`_items` en
suites antiguas): filtrando la salida por `caja-cod`, `CajaCod`, `cierres-admin-caja`,
`caja-tesoreria-idempotencia`, `CierresAdminRepository` y `cierres-bodega-admin-service` → **cero
coincidencias**.

**`pnpm exec vitest related --run`** sobre los archivos tocados (código y tests)

```
 Test Files  26 passed (26)
      Tests  418 passed (418)
   Duration  17.51s
```

**`pnpm exec vitest run tests/integration/db`** (obligatorio: la tanda toca la base)

```
 Test Files  92 passed (92)
      Tests  1118 passed (1118)
   Duration  8.55s
```

Delta contra la Tanda A: **+1 archivo, +6 tests**, que es exactamente el archivo nuevo de `T B.4`.

**No corrido aquí:** `./init.sh --rapido` ni `./init.sh` completo. Los corre el leader.

## B10. Veredicto de la Tanda B

TANDA B entregada completa: el contra-entrega entra en la caja leyendo el **ledger** —con la
contraprueba de las gestiones discrepantes escrita y verde—, enganchado tras el feed de la 43 con
el orden **medido** y sin una sola dependencia nueva en el constructor, idempotente **por índice
contra Postgres real**, con el cierre de bodega y el pago al mensajero intactos y dos mutaciones
money-critical ejecutadas, rojas y revertidas.

---
---

# TANDA C — El dinero sale y vuelve

> Misma rama `feature/173-caja-tesoreria`. Fase **backend**.
> Alcance de esta entrada: **`T C.1`, `T C.2`, `T C.3`, `T C.4`, `T C.5`** — las cinco **HECHAS**.

## C1. Qué se hizo

| Task | Estado | Nota |
| --- | --- | --- |
| `T C.1` — el puerto estrecho | **HECHA** | Dos métodos y ninguno más. Test estructural + de intento (§C4). |
| `T C.2` — el egreso del pago a tienda | **HECHA** | Tercera escritura de la **misma** `runTransaction`, mismo `montoStr`, fecha real del pago. |
| `T C.3` — el reverso de la anulación | **HECHA** | `ingreso_reverso_pago_tienda`. **Mutación obligatoria ejecutada** (§C7). |
| `T C.4` — la cadena y la idempotencia | **HECHA** | Las dos cifras medidas en ₡ en los tres momentos + Postgres real. |
| `T C.5` — guardia de alcance | **HECHA** | Censo de escritores de los otros dos libros: siguen siendo **uno cada uno**. |

## C2. Archivos

### Creados

| Archivo | Task |
| --- | --- |
| `lib/interfaces/services/ICajaPagoTiendaFeedService.ts` | `T C.1` |
| `lib/services/CajaPagoTiendaFeedService.ts` | `T C.1` |
| `tests/unit/services/liquidacion-caja-puerto.test.ts` | `T C.1` |
| `tests/unit/services/caja-cadena-pago-anulacion.test.ts` | `T C.4` |
| `tests/unit/guards/caja-173-alcance.guardia.test.ts` | `T C.5` |

### Modificados

| Archivo | Qué | Task |
| --- | --- | --- |
| `lib/services/LiquidacionService.ts` | El puerto en el constructor (5.º parámetro, **sin default**) y **dos escrituras**: una en `registrarPagoTienda`, otra en la rama `tienda` de `escribirContraasiento`. Los dos docstrings que citaban R40, reescritos. | `T C.2`, `T C.3` |
| `lib/interfaces/services/ILiquidacionService.ts` | `LiquidacionTx` gana `CajaPagoTiendaTxClient`. | `T C.2` |
| `lib/actions/liquidacion.ts` | El composition root construye `new CajaPagoTiendaFeedService(new WalletMovimientoRepository(prisma))`. | `T C.2` |
| `tests/unit/services/liquidacion-service.test.ts` | Aserciones de R40 **reescritas** (§C3) + cableado del puerto. | `T C.2` |
| `tests/unit/services/liquidacion-anulacion.test.ts` | Ídem (§C3). | `T C.3` |
| `tests/integration/db/caja-tesoreria-idempotencia.test.ts` | **+4 casos** contra Postgres real. | `T C.4` |
| `tests/integration/db/liquidacion-idempotencia.test.ts` | Cascada mecánica: el store gana el delegado `walletMovimiento`. Ver §C6. | `T C.2` |

### Lo que NO está en el diff (y es parte de la verificación)

- `lib/services/WalletMensajeroFeedService.ts` y `tests/unit/services/wallet-mensajero-feed-service.test.ts`
  — **R66 / `[P2]` = (a)**. Ni una línea.
- `lib/repositories/WalletMovimientoRepository.ts` — el repositorio de la caja **no cambia**: el
  puerto lo usa tal cual, con el `fechaMovimiento?` que ya dejó `T A.3`.
- `lib/utils/caja-tesoreria.ts` — se **reusa**; nada de esta tanda deriva cifras por su cuenta.
- Las suites de la 171 (`wallet-tiendas-*`, `mi-wallet-*`, `mis-pagos-*`) y el resto de las de la
  172.

## C3. ⚠️ Las aserciones REESCRITAS, una a una

Cinco cambios sobre tests que estaban **verdes**. Ninguno borra una comprobación: dos la
**invierten** porque su premisa cayó, dos la **amplían** y una **añade un paso al log**.

| # | Archivo | ANTES | DESPUÉS | Por qué |
| --- | --- | --- | --- | --- |
| 1 | `liquidacion-service.test.ts` | `it("R40 [P2]: la CAJA PRINCIPAL no recibe ni una llamada")` → bucle sobre los 7 métodos de `tx.walletMovimiento`, **todos** `not.toHaveBeenCalled()` | `it("R18/R20 [173]: la CAJA PRINCIPAL recibe EXACTAMENTE UNA escritura…")` → `emitirEgresoDePago` **1 vez**, `createMany` **1 vez**, y la fila con `tipo: egreso`, `categoria: egreso_pago_tienda`, `monto 15000.00`, `origen (pago_tienda, pago-1)`, `registradoPor u-admin`, `fechaMovimiento 2026-07-30T00:00:00.000Z`, y el `tx` **idéntico** al de la transacción | La premisa de R40 («restaría un dinero que nunca entró») cayó del lado de la tienda con la Tanda B |
| 2 | `liquidacion-anulacion.test.ts` | `it("anular un pago a una TIENDA no toca la caja")` → mismo bucle, todo en cero | `it("R24/R25/R26: anular un pago a una TIENDA devuelve el dinero a la caja, EXACTAMENTE una vez")` → `emitirReversoDeAnulacion` **1 vez**, fila con `tipo: ingreso`, `categoria: ingreso_reverso_pago_tienda` (**y `not.toBe("ingreso_ajuste")`**), `monto 15000.00`, mismo `origen (pago_tienda, …)`, `fechaMovimiento` = **día de la anulación** | Ídem: si al pagar sí se emite egreso, al anular sí hay que devolverlo |
| 3 | `liquidacion-service.test.ts` | `it("R40: el servicio ni siquiera tiene por donde escribir en la caja")` → 3 asserts (`IWalletMovimientoRepository`, `walletMovimiento`, `egreso_pago_tienda`) | `it("R23: el servicio no puede EXPRESAR ninguna otra escritura en la caja")` → **los mismos 3 más 5**: `egreso_pago_mensajero`, `ingreso_reverso_pago_tienda`, `ingreso_ajuste`, el puerto entra como `import type`, y `not.toMatch(/new CajaPagoTiendaFeedService/)` | **Amplía**, no relaja: la garantía baja de «no tiene la puerta» a «la puerta solo abre a dos sitios» y hay que pagar la diferencia |
| 4 | `liquidacion-anulacion.test.ts` | `it("R40: no hay por donde escribir en la caja aunque alguien lo intentara")` → 4 asserts | `it("R23: no hay por donde escribir en la caja más que las dos filas del puerto")` → **los mismos 4 más 2** (`ingreso_reverso_pago_tienda`, `ingreso_ajuste`) | Ídem |
| 5 | ambos | Log del camino feliz de **tienda**: `[… "crear:movimiento", "tx:commit"]` (registro) y `[… "crear:movimiento:tienda", "tx:commit"]` (anulación) | Los mismos **más `"crear:caja"`** antes de `"tx:commit"` | R19: la escritura de la caja va **dentro** de la transacción y **después** del ledger. El log es lo que lo mide |

**Lo que NO se tocó, y es la mitad del encargo:**

- `it("R40 [P2]: la CAJA PRINCIPAL no recibe ni una llamada al liquidar a un mensajero")` —
  `liquidacion-service.test.ts:1110`, **verbatim**.
- `it("anular un pago a un MENSAJERO tampoco")` — `liquidacion-anulacion.test.ts:1179`,
  **verbatim**.

Las dos siguen verdes, y ahora **no de forma vacía**: el puerto que se les inyecta es el REAL, así
que si alguien lo llamara desde la rama del mensajero escribiría de verdad y las dos caerían. Se
les añadieron **dos `it` nuevos** al lado (`R22` y `R27`), que afirman cero llamadas **al puerto**
—la tercera comprobación que `design.md §4` exige como compensación—.

## C4. `T C.1` — por qué el puerto ESCRIBE, y no solo construye

`design.md §4` esboza el puerto con dos métodos que **devuelven** `CrearMovimientoInput`. Se
implementó con dos métodos que **escriben** (`emitirEgresoDePago`, `emitirReversoDeAnulacion`), y
la razón está en el propio §4: un constructor de filas no persiste, así que alguien tiene que
insertarlas — y el único candidato sería `IWalletMovimientoRepository` **inyectado en
`LiquidacionService`**, que es exactamente lo que el mismo párrafo prohíbe («inyectarlo cambiaría
una imposibilidad estructural por una promesa de buena conducta»). Con el puerto escribiendo, el
repositorio queda **encapsulado dentro del puerto** y las tres comprobaciones de §4 se cumplen tal
cual están escritas. Se declara aquí porque es la única desviación de la letra del design.

Lo que mide `liquidacion-caja-puerto.test.ts` (12 tests):

- `LiquidacionService.length === 5` — cuatro dependencias de la 172 más el puerto; un sexto
  repositorio cambiaría ese número antes de que ningún test de comportamiento se enterara.
- La fuente del servicio **no nombra ninguna de las 17 categorías** del catálogo (barrido sobre
  `NATURALEZA_POR_CATEGORIA`, no sobre una lista copiada a mano).
- `Object.getOwnPropertyNames(CajaPagoTiendaFeedService.prototype)` === los dos métodos, y el
  contrato declara **esas dos firmas y ninguna más**.
- `MovimientoDeCajaDePagoTienda` **no tiene** `tipo`, `categoria` ni `origenTipo`.
- **Se intenta de verdad:** se cuela `{ tipo: "ingreso", categoria: "egreso_pago_mensajero",
  origenTipo: "pago_mensajero" }` en la petición de los dos métodos y las filas emitidas siguen
  siendo `egreso/egreso_pago_tienda` e `ingreso/ingreso_reverso_pago_tienda`.
- Las dos categorías que el puerto puede emitir son, leyendo el `Record` de naturaleza,
  **`terceros`**: por construcción nada de lo que este puerto escriba mueve la ganancia.
- El composition root: `new CajaPagoTiendaFeedService(new WalletMovimientoRepository(prisma))`, y
  `new WalletMovimientoRepository(` aparece **exactamente una vez** en `buildService` — no hay una
  segunda instancia suelta que pudiera acabar en el constructor del servicio.

## C5. `T C.2` / `T C.3` — dónde va cada escritura

- **Pago:** dentro de la misma `runTransaction`, **después** del débito del ledger, con el
  **mismo `montoStr`** ya redondeado (medido: entrada `"15000.5"` ⇒ documento, ledger y caja los
  tres `"15000.50"`) y `fechaMovimiento = medianocheUtcDelDia(input.fechaPago)`.
- **Anulación:** en `escribirContraasiento`, **solo** en la rama `tienda` —la del mensajero sale
  antes con su `return`—, con `fechaMovimiento = fechaAnulacion` (05/08, seis días después del
  pago) y el **mismo** `(origen_tipo, origen_id)` que el egreso.
- **R19 medido, no deducido:** con `tx.walletMovimiento.createMany` rechazando, el log queda en
  `["tx:abrir","bloquear:tienda:t1","leer:disponible","crear:documento","crear:movimiento"]` y
  **no llega a `tx:commit`**: si la caja falla, no queda el pago.

## C6. Una cascada mecánica, declarada

`tests/integration/db/liquidacion-idempotencia.test.ts` (suite de la 172) gana el delegado
`walletMovimiento` en su store en memoria y el puerto real en su `buildService`. Sin eso, el
camino de la tienda reventaba con `undefined.createMany`. El delegado modela el índice único
parcial y la visibilidad diferida al commit igual que sus dos hermanos, y **a propósito no escribe
en el `log`**: las aserciones de ese archivo comparan el log entero y son de la 172. **Ni una
aserción existente modificada**; el diff es de 64 líneas, todas aditivas.

## C7. `T C.3` — la mutación obligatoria, EJECUTADA

**Mutación:** en `lib/services/CajaPagoTiendaFeedService.ts`,
`categoria: "ingreso_reverso_pago_tienda"` → `"ingreso_ajuste"` en `emitirReversoDeAnulacion`.
Es la alternativa **C** que `design.md §10` descarta.

**Resultado: 8 tests rojos en 4 archivos.** El que importa —el que mide **la ganancia**, no la
categoría— es este:

```
 FAIL  tests/unit/services/caja-cadena-pago-anulacion.test.ts >
       R30 — pagar y anular deja el dinero en caja donde estaba y la ganancia intacta >
       R30: las TRES cifras del recorrido, en colones
AssertionError: expected [ '1690.00', '1690.00', '16690.00' ] to deeply equal
                         [ '1690.00', '1690.00', '1690.00' ]

- Expected
+ Received

  [
    "1690.00",
    "1690.00",
-   "1690.00",
+   "16690.00",
  ]

 ❯ tests/unit/services/caja-cadena-pago-anulacion.test.ts:307:71
```

**₡15 000 de ganancia inventada** por anular un pago: la utilidad de Ordenex sube exactamente lo
que se le devolvió a una tienda. Es el motivo entero de que el enum ganara **dos** valores y no
uno. `enCaja` **no** se movió (`21690.00` en los dos casos): por eso una aserción que solo mirase
el dinero en caja habría sobrevivido a la mutación.

El resto del rojo (los que miden la **categoría**, no el efecto):

```
 ❯ tests/unit/services/caja-cadena-pago-anulacion.test.ts (8 tests | 3 failed)
     × R30: las TRES cifras del recorrido, en colones
     × R24/R25: las dos filas del pago conviven en la caja, con su categoria y su fecha
     × R28: anular dos veces deja UN solo reverso, y la caja no sube dos veces
 ❯ tests/unit/services/liquidacion-anulacion.test.ts (1 failed)
     × R24/R25/R26: anular un pago a una TIENDA devuelve el dinero a la caja, EXACTAMENTE una vez
 ❯ tests/unit/services/liquidacion-caja-puerto.test.ts (2 failed)
     × su fuente nombra DOS categorias, y ninguna es la del mensajero
     × el `tipo` y la `categoria` son literales del puerto: colarlos en la peticion no sirve
 ❯ tests/integration/db/caja-tesoreria-idempotencia.test.ts (2 failed)
     × R28: anular dos veces tampoco duplica el reverso
     × R28/R48: el egreso y su reverso COMPARTEN origen y conviven
```

**Mutación revertida**; los 4 archivos vuelven a **98 verdes**.

> Nota para `T H.3`: ésta es la **segunda** de las tres mutaciones obligatorias. La primera está
> en §4 (Tanda A). La tercera (fechar un retroactivo con `now()`) es de la Tanda E.

## C8. `T C.4` — la cadena, en colones

`caja-cadena-pago-anulacion.test.ts` monta un store con los **tres** índices únicos reales
(`UNIQUE(clave_idempotencia)`, `UNIQUE(pago_id)` y el parcial de la caja) y visibilidad diferida
al commit, con el **servicio real, el puerto real y el repositorio real**. Semilla del libro:
contra-entrega ₡20 000, flete ₡3 000, IVA ₡390, sueldo ₡500, pago a mensajero ₡1 200.

| Momento | `enCaja` | `ganancia` |
| --- | --- | --- |
| antes del pago | `21690.00` | `1690.00` |
| tras pagar ₡15 000 a la tienda | `6690.00` | `1690.00` |
| tras anular ese pago | `21690.00` | `1690.00` |

Las dos cifras son **distintas** en la semilla a propósito: con un libro sin dinero de terceros, un
reverso mal clasificado podría pasar inadvertido. Además: `deTerceros` también vuelve a su sitio, y
las dos filas del pago conviven con sus categorías en ese orden.

**Idempotencia (R21/R28/R48)**, medida sobre los índices y no sobre un `if`:

- mismo `claveIdempotencia` dos veces ⇒ `ya_registrado`, **un** `egreso_pago_tienda`, `enCaja`
  baja **una** vez;
- anular dos veces ⇒ `ya_anulado`, **un** `ingreso_reverso_pago_tienda`, `enCaja` vuelve a
  `21690.00`;
- contraprueba: **dos pagos distintos** a la misma tienda **sí** mueven el dinero dos veces
  (`-8310.00`) — el índice no deduplica de más;
- llamar al puerto otra vez con el mismo pago devuelve **0** insertadas, sin error.

**Contra Postgres real** (`caja-tesoreria-idempotencia.test.ts`, +4 casos, todo dentro de una
transacción que siempre revierte):

- emitir el egreso dos veces ⇒ `1` y `0` insertadas, **una** fila, monto intacto y
  `fecha_movimiento = 2026-07-30T00:00:00.000Z` — **primera prueba ejecutada de que el
  `fechaMovimiento?` opcional de `T A.3` llega de verdad a la columna** (R20);
- el reverso dos veces ⇒ ídem, con `fecha_movimiento = 2026-08-05` (R25) — y **primera prueba
  ejecutada de que el valor de enum `ingreso_reverso_pago_tienda` de `T A.1` está aplicado en una
  base real**;
- egreso + reverso bajo el **mismo** `(pago_tienda, pagoId)` ⇒ **2** filas y neto `0.00`;
- dos pagos distintos ⇒ 2 filas.

## C9. `T C.5` — la guardia de alcance

`caja-173-alcance.guardia.test.ts` (8 tests) hace un **censo del árbol** (`lib/` + `scripts/`,
recursivo, sobre el código sin comentarios) buscando las 7 formas de escribir de Prisma:

- `wallet_tienda_movimiento` → **un** escritor: `WalletTiendaMovimientoRepository.ts`.
- `pago_mensajero_movimiento` → **un** escritor: `PagoMensajeroMovimientoRepository.ts`.
- Los tres módulos nuevos de la 173 no escriben en ninguno de los dos; `CajaCodFeedService` toca
  el ledger **solo** con `findMany` (medido: la lista de usos es exactamente `["findMany"]`).

Y R33, en las dos direcciones:

- **Compilando**: se construye `new WalletMovimientoRepository({ walletMovimiento })` con un
  objeto de **una sola tabla**. Que la línea compile ES la prueba de que el repositorio no puede
  pedir nada más; si necesitara otro libro, caería `tsc` antes que el test.
- **Leyendo**: su fuente declara `Pick<PrismaClient, "walletMovimiento">` y no nombra
  `walletTiendaMovimiento`, `pagoMensajeroMovimiento`, `gestionOrden` ni `cierreDia`.
- `caja-tesoreria.ts` sigue sin nombrar `PrismaClient`, `Repository`, `findMany`, `groupBy` ni
  `await`.
- El `tx` del puerto es también un `Pick` de una sola tabla.

## C10. Trazabilidad `R<n>` → test

| R | Test que lo verifica |
| --- | --- |
| R18 | `liquidacion-service.test.ts` — «la CAJA PRINCIPAL recibe EXACTAMENTE UNA escritura, y es el egreso del pago» + «el monto de la caja es EL MISMO string del documento y del ledger» |
| R19 | idem — «si la CAJA falla, la transacción no llega a commit» + el log de «documento y movimiento reciben EL MISMO `tx`» con `"crear:caja"` dentro de la transacción |
| R20 | idem — `fechaMovimiento = 2026-07-30T00:00:00.000Z` + `caja-tesoreria-idempotencia.test.ts` (contra Postgres) |
| R21 | `caja-cadena-pago-anulacion.test.ts` — «reintentar el pago con la MISMA clave deja UN solo egreso» + `caja-tesoreria-idempotencia.test.ts` — «emitir DOS veces el egreso del mismo pago inserta UNA fila» |
| R22 | `liquidacion-service.test.ts` — «R40 [P2]…» (**sin editar**) + «R22 [173/P2]: y el PUERTO de la caja tampoco recibe ninguna de sus dos llamadas» |
| R23 | `liquidacion-caja-puerto.test.ts` (12 tests: arity, censo de categorías, dos métodos, el intento de colar categoría/tipo, el `Pick` de una tabla y el composition root) |
| R24 | `liquidacion-anulacion.test.ts` — «anular un pago a una TIENDA devuelve el dinero a la caja, EXACTAMENTE una vez» |
| R25 | idem — `fechaMovimiento` = día de la anulación (05/08) y **no** el del pago (30/07) + `caja-tesoreria-idempotencia.test.ts` |
| R26 | `caja-cadena-pago-anulacion.test.ts` — «las TRES cifras del recorrido» (la mutación de §C7) + «si el reverso fuera de naturaleza PROPIA, la ganancia subiría ₡15 000» |
| R27 | `liquidacion-anulacion.test.ts` — «anular un pago a un MENSAJERO tampoco» (**sin editar**) + «R27 [173/P2]: y el PUERTO tampoco» |
| R28 | `caja-cadena-pago-anulacion.test.ts` — «anular dos veces deja UN solo reverso» + `caja-tesoreria-idempotencia.test.ts` — «anular dos veces tampoco duplica el reverso» (Postgres) |
| R29 | `liquidacion-anulacion.test.ts` — «el reverso es una fila NUEVA — ni un update ni un delete en el libro de la caja» (los 6 métodos de escritura, en cero) |
| R30 | `caja-cadena-pago-anulacion.test.ts` — la tabla de §C8: `enCaja` vuelve al importe exacto y `ganancia` idéntica en los tres momentos |
| R31 | `caja-173-alcance.guardia.test.ts` — el censo de escritores + `liquidacion-service.test.ts` y `liquidacion-anulacion.test.ts` («el egreso/reverso de la caja no añade nada a los otros dos libros») + `caja-cadena-pago-anulacion.test.ts` — el ledger recibe exactamente `["pago_tienda", "ajuste_credito"]` |
| R33 | `caja-173-alcance.guardia.test.ts` — cliente Prisma mínimo, comprobado **compilando** y leyendo |
| R48 (parte pago/anulación) | `caja-tesoreria-idempotencia.test.ts` — el egreso y su reverso comparten origen y conviven; y `caja-cadena-pago-anulacion.test.ts` — la contraprueba de que no deduplica de más |

## C11. Gate ejecutado

> Gate **acotado**, el que ordenó el leader. La suite completa NO se corrió.

**`pnpm typecheck`** → `tsc --noEmit`, sin salida, **exit 0**.

**`pnpm lint`**

```
✖ 27 problems (0 errors, 27 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores**, y las 27 advertencias son la **misma línea base** de las Tandas A y B (`_args`/
`_items` en suites antiguas). Filtrando la salida por `caja-173`, `caja-cadena`,
`liquidacion-caja`, `CajaPagoTienda`, `ICajaPagoTienda`, `liquidacion-service`,
`liquidacion-anulacion`, `liquidacion-idempotencia`, `actions/liquidacion`, `LiquidacionService` e
`ILiquidacionService` → **cero coincidencias**.

**`pnpm exec vitest related --run`** sobre los 12 archivos tocados (código y tests)

```
 Test Files  20 passed (20)
      Tests  483 passed (483)
   Duration  19.65s
```

**`pnpm exec vitest run tests/integration/db`**

```
 Test Files  92 passed (92)
      Tests  1122 passed (1122)
   Duration  8.02s
```

Delta contra la Tanda B: **+4 tests**, exactamente los 4 casos nuevos de `T C.4`. Ningún archivo
nuevo en `tests/integration/db`.

**No corrido aquí:** `./init.sh --rapido` ni `./init.sh` completo. Los corre el leader.

## C12. Veredicto de la Tanda C

TANDA C entregada completa: el pago a la tienda **sale** de la caja y su anulación la **devuelve**,
por un puerto de dos métodos que hace **imposible** —no prohibido— escribir `egreso_pago_mensajero`
desde la liquidación; las cinco aserciones reescritas están enumeradas con su antes y después, las
dos del **mensajero siguen intactas y ahora no son vacías**, y la mutación money-critical del
reverso a `ingreso_ajuste` se ejecutó, salió roja **midiendo ₡15 000 de ganancia inventada** y se
revirtió.

Addendum (§C13): la tanda dejó **una guardia ajena de la 172 en rojo** —`vitest related`
no selecciona las guardias, porque recorren el árbol y no se importan—. Cerrada afilándola:
de «la caja no entra» a «la caja entra por UNA puerta con DOS filas, y ninguna es la del
mensajero», con las dos mutaciones de `[P2]` ejecutadas en rojo y revertidas.

## C13. Un rojo AJENO que la Tanda C provocó, y cómo se cerró

**El fallo.** `tests/unit/guards/liquidacion-alcance.test.ts` —guardia de la **172**, `T H.4`—
quedó en rojo con el commit de la Tanda C:

```
FAIL tests/unit/guards/liquidacion-alcance.test.ts
  > feature 172 — los no objetivos, verificados sobre el código
  > "R68 / R40 / R62: ni la caja principal ni el catálogo de métricas entran en la feature"
AssertionError: lib/actions/liquidacion.ts nombra WalletMovimientoRepository:
  expected '"use server";\n\nimport { getPrismaCl…' not to contain 'WalletMovimientoRepository'
```

**Por qué se escapó del gate acotado, y la lección.** Se corrió `vitest related --run` sobre los
archivos tocados, y **ninguna guardia la selecciona el grafo de imports**: recorren el árbol de
archivos con `readFileSync`, no se importan entre sí. `related` no puede verlas. **Regla para las
tandas siguientes de esta feature: cuando se toque algo que una guardia pueda vigilar, correr
además `pnpm exec vitest run guard` (~5 s).** Se añade al gate acotado de esta feature.

**Qué afirmaba antes.** Un solo bloque `(a)` con **ocho** nombres prohibidos en **todos** los
archivos de la 172 —incluidos `IWalletMovimientoRepository`, `WalletMovimientoRepository` y
`walletMovimiento`—. Su premisa era la de R40: emitir `egreso_pago_tienda` restaría de la caja «un
dinero que nunca entró en ella».

**Por qué la frontera se movió, y solo del lado tienda.**

| Lado | Premisa de la 172 | Estado tras la 173 |
| --- | --- | --- |
| **Tienda** | «ese dinero nunca entró en la caja» | **Falsa**: la Tanda B mete el contra-entrega en la caja al aprobar el cierre. Entregarlo TIENE que restar (R18) |
| **Mensajero** | la caja ya cargó `egreso_pago_mensajero = P` al aprobar | **Sigue viva**, y es decisión humana explícita (`[P2] = (a)`, 2026-08-03) |

**Qué afirma ahora.** La guardia no se relaja: se **afila**. Pasa de «la caja no entra» a «la caja
entra por **una** puerta, esa puerta emite **exactamente dos** filas, y ninguna es la del
mensajero».

1. La lista de prohibidos se parte en dos:
   - `PROHIBIDO_EN_TODOS` (sin excepción, composition root incluido): **`egreso_pago_mensajero`**,
     `egreso_pago_tienda`, `ingreso_reverso_pago_tienda`, `ingreso_ajuste`, `reversarEgreso`,
     `WalletEgresoService`, `wallet_movimiento`. Las tres categorías de la tienda **siguen
     prohibidas** en la liquidación por un motivo distinto y también deliberado: **las fija el
     puerto, no quien lo llama** (R23). Verlas escritas ahí significaría que alguien recuperó la
     capacidad de elegir categoría.
   - `PROHIBIDO_FUERA_DEL_ROOT` (todos menos `lib/actions/liquidacion.ts`):
     `IWalletMovimientoRepository`, `WalletMovimientoRepository`, `walletMovimiento`. Que el
     **servicio** no pueda nombrarlos es lo que hace estrecho al puerto.
2. **Un `it` nuevo** (`R23 [173]: la caja entra por UNA puerta, con DOS filas, y ninguna es la del
   mensajero`) con el alcance cerrado, que es lo que sustituye a la mitad derogada de R40:
   - `new WalletMovimientoRepository(` aparece **exactamente una vez** en todo el composition
     root, y siempre envuelto en `new CajaPagoTiendaFeedService(...)`;
   - filtrando las **17** categorías del catálogo de la caja contra la fuente del puerto, las
     emitidas son **exactamente** `["egreso_pago_tienda", "ingreso_reverso_pago_tienda"]`;
   - el puerto **no contiene** `egreso_pago_mensajero`;
   - el puerto expone **dos** métodos públicos y ninguno más.
3. El bloque `(c)` de R62 —la restricción tipo↔categoría no se le añade a `wallet_movimiento`— y
   los `it` de R66 y R67 quedan **intactos**: la Tanda F aún no ha corrido y ese no-objetivo sigue
   vivo hoy.

### Mutaciones ejecutadas y revertidas (las DOS formas de romper `[P2]`)

**Mutación A — ampliar el puerto con un tercer método que escriba `egreso_pago_mensajero`:**

```
 ❯ tests/unit/guards/liquidacion-alcance.test.ts (4 tests | 1 failed)
     × R23 [173]: la caja entra por UNA puerta, con DOS filas, y ninguna es la del mensajero

AssertionError: expected [ 'egreso_pago_mensajero', …(2) ] to deeply equal
                         [ 'egreso_pago_tienda', …(1) ]

- Expected
+ Received

  [
+   "egreso_pago_mensajero",
    "egreso_pago_tienda",
    "ingreso_reverso_pago_tienda",
  ]

 ❯ tests/unit/guards/liquidacion-alcance.test.ts:251:29
```

**Mutación B — que el SERVICIO le pase esa categoría al puerto:**

```
 ❯ tests/unit/guards/liquidacion-alcance.test.ts (4 tests | 1 failed)
     × R68 / R40 [P2] / R62: la caja entra SOLO por la puerta de la tienda, …

AssertionError: lib/services/LiquidacionService.ts nombra egreso_pago_mensajero:
  expected 'import { Prisma } from "@prisma/clien…' not to contain 'egreso_pago_mensajero'
```

Las dos **revertidas** (`git checkout` de los dos módulos, diff vacío). La guardia sigue midiendo:
no se vació al mover la frontera.

### Gate de este arreglo

**`pnpm typecheck`** → sin salida, exit 0.

**`pnpm lint`** → `✖ 27 problems (0 errors, 27 warnings)`; cero coincidencias filtrando por
`liquidacion-alcance`.

**`pnpm exec vitest run guard`** (obligatorio esta vez)

```
 Test Files  47 passed (47)
      Tests  683 passed (683)
   Duration  3.94s
```

682 antes (con 1 rojo) → **683 verdes**: el `+1` es el `it` nuevo del alcance cerrado.

**`pnpm exec vitest related --run`** sobre la guardia y los tres módulos que vigila

```
 Test Files  20 passed (20)
      Tests  479 passed (479)
   Duration  19.82s
```

---
---

# TANDA A (cierre) — `T A.2`: el `CHECK` categoría↔tipo

> Misma rama `feature/173-caja-tesoreria`. Fase **backend**.
> Alcance de esta entrada: **`T A.2`** — **HECHA**. Con ella la **Tanda A queda cerrada entera**.

## A2.1 Qué desbloqueó esto, y qué NO se volvió a decidir

`T A.0` la corrió el **leader** el 2026-08-03 con autorización humana explícita:
`progress/medicion_TA0_173.md`. **Producción: 35 filas, 8 categorías, CERO que violarían la
restricción.** Por eso el `ADD CONSTRAINT` va **DIRECTO**, sin `NOT VALID` + `VALIDATE`. Esa
decisión **no se volvió a medir ni a revisar aquí**: se ejecuta.

**Preview sigue sin ser alcanzable por MCP** (quinta vía descartada en la medición). El riesgo
residual está **declarado** en ese archivo, no asumido: producción está medida y da 0; lo que
podría pasar es que preview tenga una fila incoherente que nadie ha visto y el build del PR salga
rojo. No es un riesgo que esta task pueda cerrar desde el código.

## A2.2 Archivos

### Modificados

| Archivo | Qué |
| --- | --- |
| `db/migrations/20260803120000_caja_tesoreria/migration.sql` | **+40 líneas, 0 borradas**: el `ADD CONSTRAINT` con la disyunción **literal** de `design.md §2.2` y su porqué. |
| `db/migrations/20260803120000_caja_tesoreria/down.sql` | **+9 líneas**: el `DROP CONSTRAINT IF EXISTS` **al principio**, antes de los `DROP INDEX` (el encargo de §5). |
| `tests/integration/db/caja-tesoreria-migration.test.ts` | **+13 tests** (6 estáticos del UP, 2 del DOWN, 5 **contra Postgres real**). |
| `specs/173-caja-tesoreria/tasks.md` | `T A.2` marcada, y la nota de `T A.0` que dejó el leader. |

### Lo que NO está en el diff

- **Ninguna otra migración.** El `CHECK` vive en la carpeta de `T A.1`, como manda la task.
- **Ningún `down.sql` previo** (R50) — sigue verde el assert que lo barre.
- `db/schema.prisma` — Prisma **no modela** los `CHECK`; el de la 172 tampoco está ahí. La
  restricción vive solo en el SQL, igual que sus dos hermanas.
- Ni una línea de `lib/` ni de `app/`.

## A2.3 La disyunción, literal — y qué significa «falla cerrado»

Va **carácter por carácter** como `design.md §2.2`: dos ramas, `IN` de listas cerradas, **cero
negaciones**. Las 17 combinaciones legítimas son las 17 categorías del catálogo, cada una con su
único tipo válido: **9 en `ingreso`, 8 en `egreso`**.

Falla cerrado significa esto, y se comprueba de dos maneras distintas: (a) la definición **no
contiene** `NOT IN`, `<>` ni `!=` —ni en el `.sql` ni en lo que devuelve `pg_get_constraintdef`—,
así que un valor futuro del enum que nadie clasifique **no casa ninguna rama** y el `INSERT` se
rechaza; y (b) el conjunto de etiquetas que el `CHECK` nombra **leído del motor** se compara con
`pg_enum` y tiene que ser el mismo: el día que alguien añada un valor al enum sin tocar este
`CHECK`, esa aserción se pone roja **antes** de que su primera fila se cuele en la cubeta
equivocada.

Se comprueba además `convalidated = true` en el catálogo: es la prueba de que las filas
existentes **sí** se revisaron al aplicarla, que es exactamente lo que `NOT VALID` habría evitado.

## A2.4 El `down.sql`: por qué el `DROP CONSTRAINT` va PRIMERO

El encargo de la Tanda A (§5) se cumple al pie de la letra, y no es cosmético: el `CHECK`
**nombra los dos valores nuevos del enum**. Si se soltara después del `ALTER COLUMN … TYPE`, la
restricción seguiría ligada al tipo que se está recreando y el rollback abortaría a medias. Va
antes incluso que los dos `DROP INDEX`. Dos asserts lo fijan por **posición en el archivo**
(`índice(DROP CONSTRAINT) < índice(DROP INDEX) < índice(cast)`), no por presencia.

El `down` **no recrea** el `CHECK`: la caja llegó a esta carpeta **sin** restricción
tipo↔categoría —la 172 la dejó fuera a propósito y lo dejó escrito—, así que recrearla dejaría la
base en un estado que nunca existió.

## A2.5 Los 13 tests, y por qué la mitad tiene que correr contra el motor

Una regex sobre el `.sql` demuestra que la restricción está **escrita**. Solo Postgres demuestra
que **rechaza** y —lo que pesa igual— que **no rechaza de más**: un `CHECK` demasiado estrecho
tumbaría las escrituras de las tandas B, C y E, que ya están hechas.

**Contra Postgres real** (5 tests, todos dentro de transacciones que **siempre** se revierten —
incluidos los intentos que deben fallar: si alguien borrara el `CHECK`, esos `INSERT` tendrían
éxito y no puede quedar ni una fila de dinero inventada en la base de desarrollo):

1. `ingreso` + `egreso_pago_tienda` ⇒ **23514**. Es la alternativa (E) que `design.md §10`
   descarta diciendo «el `CHECK` lo rechazaría»: aquí se comprueba que lo hace.
2. `egreso` + `ingreso_cod_recaudado` ⇒ **23514**. El fallo que más daño haría: el contra-entrega
   **restando** de la caja.
3. Las **17 combinaciones invertidas**, una por una, todas rechazadas. Se acumulan y se afirman
   juntas, para que el fallo nombre **todas** las que se colaron y no solo la primera.
4. **Contraprueba**: las **17 legítimas** entran todas, y se releen de la tabla.
5. El catálogo de Postgres: nombre de la restricción, `convalidated = true`, y las etiquetas que
   nombra == `pg_enum`, sin negaciones.

El **SQLSTATE se lee de `error.cause.code`, no del texto**: el mensaje viene en el idioma del
servidor (esta base responde en español, «viola la restricción «check» …»), así que casar una
frase sería casar una traducción. `23514` y el nombre de la restricción son iguales en cualquier
locale.

Las 17 combinaciones legítimas se declaran en el test **a mano**, en un `Record` **total** sobre
`WalletMovimientoCategoria`. A propósito **no** se derivan del prefijo del nombre: si el test
dedujera la clasificación de la misma convención de la que la dedujo quien escribió el SQL, los
dos se equivocarían juntos y el test sería un espejo.

## A2.6 Las DOS mutaciones — EJECUTADAS, rojas y revertidas

Cada mutación se aplicó **de verdad a la base** (`db-rollback` → editar → `migrate deploy`), no
solo al archivo.

### Mutación 1 — borrar **una rama entera** del `CHECK` (la de `egreso`)

**5 tests rojos**, en los dos niveles:

```
 ❯ tests/integration/db/caja-tesoreria-migration.test.ts (31 tests | 5 failed)
     × R45: la rama `egreso` lista EXACTAMENTE las categorias de egreso del catalogo
     × R46: FALLA CERRADO — el CHECK ENUMERA, no niega (nada de NOT IN / <> / !=)
     × R46: las 17 categorias del catalogo estan en UNA sola rama — ninguna suelta, ninguna repetida
     × R46: CONTRAPRUEBA — las 17 combinaciones LEGITIMAS entran todas
     × R46: FALLA CERRADO — el catalogo de Postgres lista el CHECK y nombra las 17, ni una mas
```

El que lo mide **contra el motor**, no contra el archivo:

```
 FAIL  … > R46: FALLA CERRADO — el catalogo de Postgres lista el CHECK y nombra las 17, ni una mas
AssertionError: expected [ 'ingreso_ajuste', …(8) ] to deeply equal [ 'egreso_ajuste', …(16) ]

- Expected
+ Received

@@ -1,14 +1,6 @@
  [
-   "egreso_ajuste",
-   "egreso_gasto",
-   "egreso_gasto_fijo",
-   "egreso_gasto_variable",
-   "egreso_indemnizacion",
-   "egreso_pago_mensajero",
-   "egreso_pago_tienda",
-   "egreso_sueldo",
    "ingreso_ajuste",
```

Y la contraprueba, reventando en el `createMany` de las 17 legítimas:

```
 FAIL  … > R46: CONTRAPRUEBA — las 17 combinaciones LEGITIMAS entran todas
DriverAdapterError: el nuevo registro para la relación «wallet_movimiento» viola la restricción
«check» «wallet_movimiento_tipo_categoria_check»
```

### Mutación 2 — **mover** `ingreso_cod_recaudado` a la rama `egreso` (mala clasificación)

Más sutil que la anterior: el `CHECK` sigue teniendo sus dos ramas y sus 17 valores. **5 tests
rojos**, y esta vez cae también el lado *positivo* —lo que el `CHECK` deja pasar y no debería—:

```
 ❯ tests/integration/db/caja-tesoreria-migration.test.ts (31 tests | 5 failed)
     × R45: la rama `ingreso` lista EXACTAMENTE las categorias de ingreso del catalogo
     × R45: la rama `egreso` lista EXACTAMENTE las categorias de egreso del catalogo
     × R45: y al reves — un egreso con categoria de ingreso, tambien 23514
     × R45: las 17 combinaciones INVERTIDAS son rechazadas, una por una
     × R46: CONTRAPRUEBA — las 17 combinaciones LEGITIMAS entran todas

 FAIL  … > R45: las 17 combinaciones INVERTIDAS son rechazadas, una por una
AssertionError: expected [ Array(1) ] to deeply equal []

- []
+ [
+   "egreso/ingreso_cod_recaudado -> ACEPTADA",
+ ]
```

**`ACEPTADA`** es la palabra que importa: con esa mutación, el contra-entrega recaudado podría
entrar en el libro **como egreso** —restando de «Dinero en caja» el dinero que acaba de entrar—
y ninguna de las dos cifras avisaría. Es exactamente el fallo silencioso que este `CHECK` existe
para impedir.

**Las dos mutaciones revertidas** (`migration.sql` restaurado, `git diff --stat` = *40
insertions, 0 deletions*), base re-migrada, **31 verdes**.

## A2.7 Round-trip `up → down → up` contra el Postgres local

Base: `PostgreSQL "ordenex" @ localhost:5432`. La carpeta ya estaba aplicada de la Tanda A, así
que **primero se revirtió** para no editar en sitio una migración ya registrada (la cicatriz
«migración editada en sitio = drift»): así el `checksum` de `_prisma_migrations` corresponde
siempre al `migration.sql` vigente.

```
$ npx tsx scripts/db-rollback.ts
Aplicando rollback: 20260803120000_caja_tesoreria
Script executed successfully.
Script executed successfully.
Rollback completado: 20260803120000_caja_tesoreria

$ npx prisma migrate deploy
The following migration(s) have been applied:
migrations/
  └─ 20260803120000_caja_tesoreria/
    └─ migration.sql
All migrations have been successfully applied.

$ npx prisma migrate status
108 migrations found in prisma/migrations
Database schema is up to date!
```

Se hizo **cuatro veces** (round-trip inicial + una por mutación + la vuelta) y ninguna falló. Que
el `down` no aborte es en sí la prueba de que el `DROP CONSTRAINT` va donde debe: con la
restricción viva, el `ALTER COLUMN … TYPE` del enum no habría podido correr.

**Dato ejecutado que vale la pena anotar:** `ALTER TYPE … ADD VALUE` y un `ADD CONSTRAINT` que
**usa** esos valores conviven en el **mismo** `migration.sql` sin el error «unsafe use of new
value». Se comprobó sobre una base donde los dos valores **no existían** (rollback previo), que
es exactamente el camino que tomará producción.

## A2.8 Trazabilidad `R<n>` → test

| R | Test que lo verifica |
| --- | --- |
| R45 | `tests/integration/db/caja-tesoreria-migration.test.ts` — «un INSERT incoherente (ingreso con categoria de egreso) devuelve 23514», «y al reves», «las 17 combinaciones INVERTIDAS son rechazadas, una por una» (contra Postgres) + los 3 estáticos de las dos ramas y del `ADD CONSTRAINT` + «va DIRECTO — sin `NOT VALID`» |
| R46 | idem — «CONTRAPRUEBA: las 17 combinaciones LEGITIMAS entran todas», «el catalogo de Postgres … nombra las 17, ni una mas» (etiquetas del `CHECK` == `pg_enum`, `convalidated = true`), «el CHECK ENUMERA, no niega» y «las 17 categorias … en UNA sola rama» |
| R49 (ampliado) | idem — «suelta el CHECK, y lo hace ANTES que los DROP INDEX y que el cast» + «el down NO recrea el CHECK» |
| R50 | idem — sin cambios: ningún `down.sql` previo entra en el diff |

## A2.9 Gate ejecutado

> Gate **acotado**, el que ordenó el leader. La suite completa NO se corrió.

**`pnpm typecheck`** → `tsc --noEmit`, sin salida, **exit 0**.

**`pnpm lint`**

```
✖ 27 problems (0 errors, 27 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores**, misma línea base de las tandas A/B/C.

**`pnpm exec vitest run guard`** (obligatorio desde §C13)

```
 Test Files  47 passed (47)
      Tests  683 passed (683)
   Duration  5.20s
```

**683, idéntico a la Tanda C**: ninguna guardia ajena se movió.

**`pnpm exec vitest related --run`** sobre los 3 archivos tocados

```
 Test Files  1 passed (1)
      Tests  31 passed (31)
   Duration  904ms
```

**`pnpm exec vitest run tests/integration/db`** (obligatorio: se toca una migración)

```
 Test Files  92 passed (92)
      Tests  1135 passed (1135)
   Duration  10.23s
```

Delta contra la Tanda C: **+13 tests**, exactamente los 13 de esta task. Ningún archivo nuevo.

**No corrido aquí:** `./init.sh --rapido` ni `./init.sh` completo. Los corre el leader.

## A2.10 Veredicto de `T A.2`

`CHECK` categoría↔tipo puesto **directo** sobre la caja con la disyunción literal del design,
ejercido contra Postgres real —**23514** en las 17 combinaciones incoherentes y las 17 legítimas
entrando— con el `DROP CONSTRAINT` al principio del `down.sql` como se encargó, round-trip verde
y **dos mutaciones ejecutadas**, una que borra una rama entera y otra que solo mueve una
categoría de sitio: las dos ponen rojo el test que las afirma, incluida la que dejaría entrar el
contra-entrega **como egreso**.

---
---

# TANDA D — Leer la caja

> Misma rama `feature/173-caja-tesoreria`. Fase **backend**.
> Alcance de esta entrada: **`T D.1` y `T D.2`** — las dos **HECHAS**.

## D1. Qué se hizo

| Task | Estado | Nota |
| --- | --- | --- |
| `T D.1` — repositorio: agregación por categoría y tipo | **HECHA** | El agregado por `tipo` a secas **eliminado**: cero referencias en el árbol (§D3). |
| `T D.2` — servicio y borde: `verResumenCaja` | **HECHA** | Guardia **antes** de la base con contraprueba de cero llamadas; montos STRING; filtros del listado por el **mismo** método. |

## D2. Archivos

### Modificados — código

| Archivo | Qué | Task |
| --- | --- | --- |
| `lib/interfaces/repositories/IWalletMovimientoRepository.ts` | `agregarPorCategoriaYTipo` **entra**, el agregado por `tipo` y su `BalanceAgregado` **salen**. | `T D.1` |
| `lib/repositories/WalletMovimientoRepository.ts` | `groupBy(["categoria","tipo"])` + `SUM(monto)` con el **mismo** `buildWhere` del listado; STRING escala 2. | `T D.1` |
| `lib/interfaces/services/IWalletService.ts` | `verBalance`/`VerBalanceServiceResult` → `verResumenCaja`/`VerResumenCajaServiceResult` (`CajaResumenDTO`). | `T D.2` |
| `lib/services/WalletService.ts` | `verResumenCaja` + el helper `hayFiltros`. Importa `derivarCaja` en vez de `derivarBalance`. | `T D.2` |
| `lib/actions/wallet.ts` | `verResumenCajaAction` (borde nuevo) + `verBalanceAction` convertida en **puente temporal** (§D5). | `T D.2` |

`lib/types/wallet.ts` **no se tocó**: `AgregadoCajaRow` y `CajaResumenDTO` ya estaban, los dejó
`T A.3`. Esta tanda los **usa**, que es para lo que se escribieron.

### Modificados — tests

| Archivo | Qué |
| --- | --- |
| `tests/unit/repositories/wallet-movimiento-repository.test.ts` | El `describe` del agregado viejo **sustituido** por el nuevo (6 casos) + el de R47. |
| `tests/unit/services/wallet-service.test.ts` | `verBalance` → `verResumenCaja`: 8 casos donde había 3. |
| `tests/unit/actions/wallet-actions.test.ts` | `verResumenCajaAction` (5 casos) + los 3 del puente, reescritos, + 1 que lo fija como proyección. |
| `tests/integration/db/wallet-egreso.test.ts` · `tests/integration/db/generacion-gastos-fijos.test.ts` | Cascada real (§D4): el doble de `groupBy` pasa a `(categoria, tipo)` y las cifras se derivan con `derivarCaja`. **Mismos números.** |
| 8 dobles de repositorio (`cierres-admin-repository`, `CierresAdminRepository.resolverCierre.devolucion`, `incidente-admin-repository`, `devolucion-rechazadas-flow`, `generacion-gastos-fijos-service`, `liquidacion-caja-puerto`, `wallet-egreso-service`, `wallet-indemnizacion-no-reversable`) | **Una línea cada uno**: el método del contrato que cambió de nombre. Cero aserciones tocadas. |

### Lo que NO está en el diff (y es parte de la verificación)

- **`app/`, entero.** Ni la página, ni `WalletModule`, ni `WalletBalanceCard`. La Tanda G es la
  que renombra la tarjeta y pinta las dos cifras; el puente de §D5 existe justamente para no
  invadirla.
- `lib/utils/caja-tesoreria.ts` y `lib/utils/wallet-balance.ts` — se **reusan**. Esta tanda no
  deriva ni una resta por su cuenta (R9 intacto: `derivarBalance` sigue con su consumidor vivo
  en la analítica, y su suite sigue **sin editar**).
- Las suites de la 171/172 de tienda y mensajero.
- `db/` — la Tanda D no toca la base.

## D3. `T D.1` — cero referencias, comprobado antes de borrar

El agregado viejo agrupaba **solo por `tipo`**. No es que fuera feo: **no puede** dar las dos
cifras, porque la naturaleza del dinero (propio / de terceros) es de la **categoría**. Con
`groupBy(["tipo"])` «dinero en caja» y «ganancia de Ordenex» serían el mismo número para siempre.

Se comprobó que no quedaba **ningún** consumidor antes de borrarlo, y se comprueba después:

```
$ git grep -n "agregarBalance" -- lib app scripts tests
(sin salida)
```

Hubo **11** referencias que hubo que resolver primero: 1 en el servicio (la sustituye
`verResumenCaja`), 2 en suites de integración que lo usaban **de verdad** (§D4) y 8 dobles de
repositorio que solo lo declaraban para satisfacer la interfaz. El nombre tampoco sobrevive en
comentarios de `lib/`: donde hacía falta explicar la sustitución, se describe («el agregado por
`tipo` a secas que traía la 42») sin nombrarlo, para que el grep de arriba signifique lo que
dice.

**El repositorio sigue sin `update` ni `delete`** (R47), y ahora se afirma sobre la **lista
completa y cerrada** de sus cinco métodos en vez de con cuatro `toBeUndefined()`: así caen igual
un `actualizarMonto` futuro —que no se llamaría «update»— y el método viejo si alguien lo
resucitara.

## D4. Dos cascadas reales, declaradas

`wallet-egreso.test.ts` (feature 45) y `generacion-gastos-fijos.test.ts` (feature 45/84) **usaban
el agregado viejo para medir dinero**, no solo para rellenar un doble. Sus tiendas en memoria
tenían un `groupBy` que **rechazaba** cualquier `by` que no fuera `["tipo"]`.

Los dos ahora agrupan por `(categoria, tipo)` y derivan con `derivarCaja`. **Ni un número
cambia**: `enCaja` sobre un conjunto es, número por número, lo que esas suites medían como
«balance» (design §1.3). Lo que cambia es el camino:

| Antes | Ahora |
| --- | --- |
| `derivarBalance(...await repo.agregarBalance({}))` → `.balance` | `derivarCaja(await repo.agregarPorCategoriaYTipo({}))` → `.enCaja` |
| `.egresos` | `.salidas` |
| `.signo` | `.signoEnCaja` |

Y el doble sigue siendo **exigente**, que es lo que lo hace valer: si el repositorio dejara de
pedir la categoría en el `by`, el doble lanza en vez de devolver algo plausible.

## D5. El puente `verBalanceAction`, y por qué existe

`WalletService.verBalance` **desaparece** — es lo que dice el design (§5.2: «se sustituye por
`verResumenCaja`»). Pero `/wallet` sigue siendo la pantalla de la 42 hasta `T G.3`, y esta fase
es **backend**: tocar la página, el módulo y la tarjeta sería hacer la Tanda G a destiempo y
reescribir sus tests dos veces.

Así que `verBalanceAction` sobrevive **en el borde** convertida en una **proyección de campos**
del DTO nuevo sobre la forma vieja. Cero aritmética, cero segunda derivación:

```
balance = { ingresos: resumen.entradas, egresos: resumen.salidas,
            balance:  resumen.enCaja,   signo:   resumen.signoEnCaja }
```

Es seguro precisamente porque **el número no cambia**: `enCaja` sobre un conjunto es lo que
devolvía `derivarBalance(Σingresos, Σegresos)` sobre ese mismo conjunto. Lo que la 173 parte en
dos es el **significado**, no este valor.

Un test lo fija en las dos direcciones: que el puente sea campo por campo el resumen, y que
`puente.balance.balance` **no** sea `resumen.ganancia` — si alguien confundiera los campos al
proyectar, la pantalla vieja empezaría a mostrar la **utilidad** bajo el rótulo «Balance
general», que es exactamente el error que motiva la feature.

**Está marcado en el código como puente y con quién lo borra (`T G.3`).** No es deuda encubierta:
es el precio de que el árbol compile entre dos tandas de una feature fullstack.

## D6. `T D.2` — las tres exigencias, medidas

**(1) El guardia ANTES de la base (R65).** La contraprueba que pide la task, con los **cinco**
métodos del repositorio en cero —no solo el que usa este camino—, y `forbidden` viajando solo
(`Object.keys(r) === ["status"]`). Medido, no comentado: la mutación A de §D7 lo confirma.

**(2) Los mismos filtros, por el mismo método (R8).** No se afirma que «use `construirFiltros`»
leyendo el código: se comparan **llamada contra llamada** sobre la misma entrada. Las claves con
que se llamó a `listar` son las del resumen **más** `page`/`pageSize`, y cada valor común
coincide uno a uno. `page`/`pageSize` se quedan fuera a propósito: son del **recorte**, no del
conjunto.

**(3) Montos STRING, cero `number` (R64).** Se barre el DTO **entero** con `Object.entries`, no
tres campos elegidos a mano: cualquier importe futuro que alguien añada como `number` cae ahí.
Cada uno casa `/^-?\d+\.\d{2}$/` —escala 2 también en el cero—, y `periodoFiltrado` es el único
no-STRING y no es dinero.

**`[P7]` = (a), resuelto como bandera y no como texto.** `periodoFiltrado` se calcula sobre los
filtros **ya construidos**, así que no puede desalinearse del conjunto que de verdad se agregó, y
el día que el libro gane un filtro lo ve solo. Se comprueba que **cada uno** de los cuatro filtros
la enciende y que **paginar no la enciende**. Y un test afirma que **ningún valor del DTO es
prosa**: o es un importe, o es un signo, o es el booleano. El servidor da el **hecho**; el rótulo
(«Dinero en caja» ↔ «Movimiento neto del periodo») lo elige `T G.1`.

El conjunto de prueba tiene dinero de las **dos** naturalezas a propósito
(`ingreso_cod_recaudado` ₡5 000 junto a flete ₡1 000 y gasto ₡300): `enCaja = 5700.00` y
`ganancia = 700.00`. Con un conjunto solo-propio las dos cifras coincidirían y ninguna aserción
distinguiría una derivación correcta de una que ignora la naturaleza.

## D7. Cuatro mutaciones — EJECUTADAS, rojas y revertidas

### Mutación A — el guardia de rol se evalúa DESPUÉS de leer la base

```
 ❯ tests/unit/services/wallet-service.test.ts (15 tests | 1 failed)
     × R65: rol no autorizado -> forbidden, y CERO llamadas al repositorio

AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
Number of calls: 1
```

El resultado seguía siendo `forbidden` —un test que solo mirara el `status` habría pasado en
verde— pero las cifras de la caja ya se habían leído para tirarlas.

### Mutación B — `periodoFiltrado` fijado a `false`

```
 ❯ tests/unit/services/wallet-service.test.ts (15 tests | 2 failed)
     × [P7]: sin filtros `periodoFiltrado` es false; con CUALQUIERA de los cuatro, true
     × [P7]: el servidor NO pinta texto — el DTO lleva el HECHO, no el rotulo

AssertionError: expected false to be true
 ❯ tests/unit/services/wallet-service.test.ts:234  expect(await bandera({ tipo: "egreso" })).toBe(true);
```

Es la mutación que deja la pantalla mintiendo con un número correcto: «Dinero en caja» sobre un
periodo filtrado, que **no** es el dinero que hay.

### Mutación C — el resumen se construye sus PROPIOS filtros y pierde `categoria`

```
 ❯ tests/unit/services/wallet-service.test.ts (15 tests | 2 failed)
     × R8: los filtros del resumen son LOS MISMOS del listado, resueltos por el mismo metodo
     × [P7]: sin filtros `periodoFiltrado` es false; con CUALQUIERA de los cuatro, true

AssertionError: expected { tipo: 'ingreso', …(2) } to deeply equal { tipo: 'ingreso', …(3) }

- Expected
+ Received

  {
-   "categoria": "ingreso_cod_recaudado",
    "desde": 2026-07-01T00:00:00.000Z,
    "hasta": 2026-07-31T00:00:00.000Z,
    "tipo": "ingreso",
  }
```

La cabecera sumando un conjunto y el listado enseñando otro. Cae **también** `[P7]`, porque la
bandera se deriva de esos mismos filtros: el descuadre se propaga solo.

### Mutación D — el agregado IGNORA los filtros (`where: {}`)

La cicatriz «probar el `WHERE` donde vive»: los tests de servicio usan dobles y **no ven el SQL**,
así que esta mutación los pasa todos en verde. Quien la caza es el test del repositorio.

```
 ❯ tests/unit/repositories/wallet-movimiento-repository.test.ts (14 tests | 1 failed)
     × R8: groupBy por (categoria, tipo) con SUM(monto) y los MISMOS filtros del listado

AssertionError: expected {} to deeply equal { tipo: 'ingreso', …(2) }

- Expected
+ Received

- {
-   "categoria": "ingreso_flete",
-   "fechaMovimiento": { "gte": …, "lte": … },
-   "tipo": "ingreso",
- }
+ {}
```

**Las cuatro revertidas** (`git diff --stat lib/` vuelve a sus 5 archivos y 157/44 líneas), suites
en verde.

## D8. Trazabilidad `R<n>` → test

| R | Test que lo verifica |
| --- | --- |
| R8 (parte datos) | `tests/unit/repositories/wallet-movimiento-repository.test.ts` — «groupBy por (categoria, tipo) con SUM(monto) y los MISMOS filtros del listado» (el `by`, el `where` completo y el `_sum`) + «sin filtros -> WHERE vacio» |
| R8 (servicio) | `tests/unit/services/wallet-service.test.ts` — «los filtros del resumen son LOS MISMOS del listado, resueltos por el mismo metodo» (comparación llamada-contra-llamada) + `tests/unit/actions/wallet-actions.test.ts` — «usa el MISMO schema del listado» |
| R47 | `wallet-movimiento-repository.test.ts` — «la superficie del repositorio son CINCO metodos — ni update, ni delete, ni el viejo» + `wallet-service.test.ts` — «el servicio NO expone update ni delete» |
| R64 | `wallet-service.test.ts` — «TODOS los importes cruzan como STRING» (barrido del DTO entero) + `wallet-actions.test.ts` — «el DTO cruza con los NUEVE importes como STRING» |
| R65 | `wallet-service.test.ts` — «rol no autorizado -> forbidden, y CERO llamadas al repositorio» (los 5 métodos) + `wallet-actions.test.ts` — «forbidden, y NI UNA cifra en la respuesta» y «sin sesion -> unauthenticated, sin tocar el service» |
| R1/R4/R5 (parte lectura) | `wallet-service.test.ts` — «maestro -> las DOS cifras, distintas, derivadas del conjunto agregado» (`enCaja` 5700.00 ≠ `ganancia` 700.00, `deTerceros` 5000.00) |
| `[P7]` | `wallet-service.test.ts` — «sin filtros false; con CUALQUIERA de los cuatro, true» (y paginar **no** la enciende) + «el servidor NO pinta texto» + `wallet-actions.test.ts` — «viaja tal cual desde el service» |

## D9. Gate ejecutado

> Gate **acotado**, el que ordenó el leader. La suite completa NO se corrió.

**`pnpm typecheck`** → `tsc --noEmit`, sin salida, **exit 0**.

**`pnpm lint`**

```
✖ 27 problems (0 errors, 27 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores y exactamente las 27 de la línea base.** Una versión anterior de esta tanda las dejó
en 29 (dos `_p`/`_ps` sin usar por un rest-destructuring); se reescribió esa aserción —comparando
conjuntos de claves, que además es más fuerte— y volvieron a 27. La línea base no se toca ni
por dos.

**`pnpm exec vitest run guard`** (obligatorio desde §C13)

```
 Test Files  47 passed (47)
      Tests  683 passed (683)
   Duration  3.92s
```

**683, idéntico a las Tandas C y A.2**: ninguna guardia ajena se movió. Es la comprobación que la
§C13 exige y que `vitest related` no puede hacer.

**`pnpm exec vitest related --run`** sobre los **18** archivos tocados

```
 Test Files  80 passed (80)
      Tests  1262 passed (1262)
   Duration  76.10s
```

**`pnpm exec vitest run tests/integration/db`**

```
 Test Files  92 passed (92)
      Tests  1135 passed (1135)
   Duration  8.75s
```

Igual que tras `T A.2`: la Tanda D **no añade ni quita** tests de integración de base, solo
cambia por dónde pasan dos de ellos.

**Delta de tests de las tres suites de la tanda** (medido con `git stash`, no deducido):

```
antes:  32 tests (3 archivos)
ahora:  47 tests (3 archivos)   → +15
```

**No corrido aquí:** `./init.sh --rapido` ni `./init.sh` completo. Los corre el leader.

## D10. Veredicto de la Tanda D

TANDA D entregada completa: la caja se lee por `groupBy(categoria, tipo)` con **los mismos
filtros del listado y el mismo método que los construye**, el agregado por `tipo` a secas
desapareció del árbol con sus 11 referencias resueltas una a una, y `verResumenCaja` entrega las
dos cifras **como STRING** con el guardia de rol evaluado **antes** de tocar la base —contraprueba
de cero llamadas a los cinco métodos del repositorio—. `[P7]` viaja como **hecho** y no como
texto. Cuatro mutaciones ejecutadas y revertidas, incluida la del `WHERE`, que ningún test de
servicio podía cazar y por eso vive en el test del repositorio.

---
---

# HALLAZGO — el `CHECK` de la 173 cazó un test de la 127 que sembraba una fila imposible

> Descubierto al correr el gate completo tras `T A.2`. **No es un fallo de la 173 y no se cierra
> con un arreglo de dato: queda ABIERTO a decisión humana.** Se documenta aquí porque el hallazgo
> sobrevive a esta feature.
>
> Estado del gate: **1 rojo de 1917 tests**, `tests/integration/actions/analitica-financiera-action.test.ts`
> → `F.4 · pago + contraasiento ajuste en el mismo rango: bruto 800, neto 0`.

## H1. Qué pasó

`F.4` siembra en `wallet_movimiento`, contra Postgres real:

```js
{ categoria: "egreso_gasto",  tipo: "egreso",  monto: "400.00", fecha: CR_MEDIODIA_DIA_A }
{ categoria: "egreso_ajuste", tipo: "ingreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A }
```

La segunda es una categoría `egreso_*` con tipo `ingreso`. El `CHECK` de `T A.2` la rechaza:

```
DriverAdapterError: el nuevo registro para la relación «wallet_movimiento» viola la restricción
«check» «wallet_movimiento_tipo_categoria_check»
```

## H2. El `CHECK` tiene razón: la aplicación NO puede producir esa fila

Verificado en los tres sitios que escriben ajustes en la caja, más la medición de producción:

| Dónde | Qué hace |
| --- | --- |
| `app/(app)/wallet/_components/RegistrarMovimientoManualDialog.tsx:30` | `categoriaDe(tipo)` **deriva** la categoría del tipo: `ingreso→ingreso_ajuste`, `egreso→egreso_ajuste`. No los cruza. |
| `lib/types/wallet.ts` (`registrarMovimientoManualSchema`) | Un `.refine` de zod **en el borde** rechaza cualquier par que no sea `ingreso↔ingreso_ajuste` o `egreso↔egreso_ajuste`. |
| `lib/services/WalletEgresoService.ts:93-99` | Revertir un gasto emite `tipo: "ingreso", categoria: "ingreso_ajuste"` — **no** un `egreso_ajuste` de tipo invertido. |
| `progress/medicion_TA0_173.md` | Producción: **0 filas incoherentes de 35**. |

O sea: el contraasiento real de un `egreso_gasto` es un **`ingreso_ajuste` con tipo `ingreso`**.
La 127 lo modeló como «misma categoría, tipo invertido», que no es el patrón de este repo.

## H3. Por qué NO basta con arreglar el dato — MEDIDO, no deducido

Se aplicó el patrón real al `seed` de `F.4` y se corrió:

```
 ❯ tests/integration/actions/analitica-financiera-action.test.ts (13 tests | 1 failed)
     × F.4 · pago + contraasiento ajuste en el mismo rango: bruto 800, neto 0

AssertionError: expected '400.00' to be '800.00'
```

**Los números SÍ se mueven**, así que la instrucción era pararse. El motivo:

- La métrica bajo prueba es `egresos`, y `lib/analytics/metrics.ts:471-479` declara **exactamente
  las ocho categorías `egreso_*`**.
- `IngresosAnaliticaRepository` filtra `categoria IN (las declaradas)` y usa `tipo` **solo** como
  clave de agrupación, nunca como filtro.
- Por tanto un `ingreso_ajuste` es **invisible** para `egresos`: bruto `400.00`, neto `-400.00`
  — es decir, `F.4` pasaría a ser idéntico a su propia contraprueba.

**La medición revertida**; el archivo de la 127 está exactamente como estaba.

## H4. El alcance real: no es una fila mala, es una propiedad que dejó de ser alcanzable

Censo de las `definicion.categorias` de las métricas del catálogo, leído del código:

```
ingreso_flete                prefijos=['ingreso']  n=2
ingreso_comision_cod         prefijos=['ingreso']  n=1
ingreso_iva                  prefijos=['ingreso']  n=3
egresos                      prefijos=['egreso']   n=8
```

Las **cuatro** métricas que leen `wallet_movimiento` declaran listas **homogéneas de prefijo**.
Con el `CHECK`, toda fila de una categoría `egreso_*` tiene tipo `egreso` y viceversa, luego:

> **Ninguna métrica de la caja puede contener las dos naturalezas de `tipo` a la vez, y por tanto
> `neto` es SIEMPRE `±bruto`.**

Eso no lo causó el `CHECK`: ya era cierto en producción por las tres barreras de §H2. El `CHECK`
solo convirtió «imposible por convención» en «imposible por restricción», y al hacerlo dejó
visible que **la distinción bruto/neto de la 127 para la caja principal no es alcanzable con datos
legales**. Es un hallazgo sobre la 127, no un daño de la 173.

## H5. Los otros sitios con el mismo patrón irreal — los TRES, dichos

Barrido del árbol (`tests/`, `lib/`, `app/`, `scripts/`) buscando pares `(categoria, tipo)`
literales cruzados sobre el catálogo de la caja:

| Sitio | ¿Bloquea? | Qué es |
| --- | --- | --- |
| `tests/integration/actions/analitica-financiera-action.test.ts:408` | **SÍ — el rojo** | Inserta contra Postgres real. |
| `tests/unit/analytics/financiera-ingresos-repo.test.ts:124` | No | Siembra un **doble en memoria** con `{egreso_ajuste, ingreso}` para el mismo fin (bruto/neto desglosado por tipo). Verde, pero modela lo mismo que la base ya no admite. |
| `tests/unit/services/analitica-financiera-derivacion.test.ts:177` | No | `{ingreso_flete, egreso}` sobre un doble, para probar que el par pago+contraasiento se cancela en el neto. Mismo caso, métrica de un solo prefijo. |
| `tests/unit/services/liquidacion-caja-puerto.test.ts:184` | No | **Deliberado y correcto, es de la 173**: cuela `{tipo:"ingreso", categoria:"egreso_pago_mensajero"}` en la petición del puerto para demostrar que el puerto lo **ignora**. Nunca se persiste. **No se toca.** |

Los tres primeros son **el mismo hallazgo**: existen para probar `neto ≠ bruto`, que es justo lo
que §H4 dice que ya no puede ocurrir. Arreglarlos por separado sería tapar tres síntomas de una
decisión.

## H6. La contraprueba de `F.4` sigue discriminando — COMPROBADO por mutación

Lo exige el encargo, así que se midió en vez de afirmarlo. Mutación en
`AnaliticaFinancieraService.deCaja`: que el `neto` **copie el bruto** en vez de aplicar el signo.

```
 ❯ tests/integration/actions/analitica-financiera-action.test.ts (13 tests | 2 failed)
     × F.4 · pago + contraasiento ajuste en el mismo rango: bruto 800, neto 0
     × F.4 · sin el contraasiento, el neto NO es cero: el caso de arriba mide algo

AssertionError: expected '400.00' to be '-400.00'
```

La contraprueba **se pone roja** con esa mutación: sigue midiendo que el neto lleva signo y no es
una copia del bruto. No queda vacua. **Mutación revertida.**

## H7. Las salidas posibles, con su consecuencia — la decisión NO es del backend

- **(A) Reescribir `F.4` para que mida lo que ahora es cierto**: dos egresos ⇒ bruto `800.00`,
  neto `-800.00`, y la comprobación «el neto no copia el bruto» se sostiene por el **signo**.
  *Consecuencia:* la 127 deja de afirmar la cancelación en la caja — una afirmación que ya no
  puede ser verdad. Es el cambio más pequeño y el más honesto, pero **cambia lo que la 127 dice**.
- **(B) Meter `ingreso_ajuste` en `definicion.categorias` de `egresos`.** Con eso, `F.4` con el
  patrón real vuelve a dar `800/0` sin tocar el `CHECK`. *Consecuencia:* cambia **el número de una
  métrica de dinero publicada** y toca el catálogo — territorio de `[P4]` y de la 175.
- **(C) Relajar el `CHECK`.** *Descartada*: `[P5] = (a)` es decisión humana ya tomada, el `CHECK`
  tiene razón y quitarle una rama es exactamente la mutación que §A2.6 demostró peligrosa.
- **(D) `it.skip` con el motivo.** Deja el gate verde y la deuda visible, pero un `skip` en un test
  de dinero es lo que este repo no hace.

**No se aplicó ninguna.** El árbol queda con `F.4` en rojo y todo lo demás verde, que es el estado
honesto mientras la decisión esté abierta.

## H8. Gate en este punto

- **`pnpm typecheck`** → exit 0.
- **`pnpm lint`** → `✖ 27 problems (0 errors, 27 warnings)` (línea base).
- **`pnpm exec vitest run guard`** → `47 passed / 683 passed`.
- **`pnpm exec vitest run tests/integration/db tests/integration/actions`** →
  `1 failed | 115 passed (116)` · `1 failed | 1442 passed (1443)`. **El único rojo es `F.4`.**

## H9. CIERRE — decisión humana: **opción (A)**, 2026-08-03

> El humano eligió **(A)**: reescribir `F.4` para que mida lo que **sí** es cierto bajo el `CHECK`.
> **No** se relajó el `CHECK` y **no** se tocó `lib/analytics/metrics.ts` — `egresos` **no** gana
> `ingreso_ajuste` en esta feature: eso es `[P4]` y es de la 175 (§H10).
>
> Nota de proceso que merece quedar: la medición de §H3 **corrigió el diagnóstico del leader**, que
> daba por hecho un filtro por `tipo` cuando el repositorio filtra por `categoria`. Pararse costó
> una corrida de tests y evitó un arreglo que habría dejado `F.4` midiendo lo mismo que su hermano.

### Qué quedó escrito

`tests/integration/actions/analitica-financiera-action.test.ts` — el par de `F.4`, reescrito. La
cabecera del bloque explica **por qué el neto ya no puede ser 0**, para que dentro de seis meses
nadie lo lea como un número tuneado para pasar: con el `CHECK`, una métrica de lista homogénea de
prefijo contiene un solo `tipo`, luego `neto = ±bruto`.

| Caso | Semilla (toda **legal**) | Mide |
| --- | --- | --- |
| **`F.4(a)`** · bruto 800, neto **−800** | `egreso_gasto` 400 + `egreso_sueldo` 400, las dos de tipo `egreso` | Que el bruto **agrega las dos filas sin signo** y que el neto es ese importe **con el signo cambiado**. Además, sin depender de los literales: `neto ≠ bruto`, el neto empieza por `-` y el bruto no. |
| **`F.4(b)`** · bruto 400, neto **−400** | `egreso_gasto` 400 + su contraasiento **REAL** `ingreso_ajuste`/`ingreso` 400 | Que el contraasiento **NO entra en `egresos`**: la métrica publica la salida bruta aunque el gasto se haya revertido. Se comprueba con un `count` que las **dos** filas están en el libro, para que el caso no pueda confundirse con una semilla que no llegó a escribirse. |

`F.4(b)` es el que hereda el papel del hermano («el caso de arriba mide algo») y además **deja
medido el hecho que la 175 tiene que decidir**.

### Los dos casos SIGUEN DISCRIMINANDO — dos mutaciones, ejecutadas

**Mutación 1 — el `neto` copia el `bruto`** (`AnaliticaFinancieraService.deCaja` deja de aplicar el
signo). **Los dos rojos**: el par mide el signo, no un literal.

```
 × F.4(a) · dos egresos en el mismo rango: bruto 800, neto -800 (el neto lleva SIGNO)
   → expected '800.00' to be '-800.00'
 × F.4(b) · el contraasiento REAL de un gasto NO entra en `egresos`: sigue en bruto 400, neto -400
   → expected '400.00' to be '-400.00'
      Tests  2 failed | 11 passed (13)
```

**Mutación 2 — el repositorio deja de filtrar por las categorías DECLARADAS por la métrica**
(`IngresosAnaliticaRepository`: `categoria IN (las declaradas)` → `IN (el enum entero)`). Aquí está
la prueba de que **no son el mismo test dos veces**:

```
 ✓ F.4(a) · dos egresos en el mismo rango: bruto 800, neto -800 (el neto lleva SIGNO)
 × F.4(b) · el contraasiento REAL de un gasto NO entra en `egresos`: sigue en bruto 400, neto -400
   → expected '800.00' to be '400.00'
      Tests  2 failed | 11 passed (13)
```

`F.4(a)` **verde**, `F.4(b)` **rojo**: `(b)` caza un defecto que `(a)` no puede ver. (El segundo
rojo de esa corrida es `F.1`, que vigila lo mismo para `ingreso_flete` — sano: el filtrado por
catálogo tiene dos guardianes, no uno.)

**Las dos mutaciones revertidas**; el par vuelve a verde y el archivo entero a **13/13**.

## H10. ENCARGO PARA LA 175 — explícito, con ruta y línea

Lo que la 173 **deja sin tocar a propósito**, porque arreglarlo hoy sería adivinar una decisión que
no es suya:

| Ruta y línea | Qué afirma hoy | Por qué no se toca |
| --- | --- | --- |
| `tests/unit/analytics/financiera-ingresos-repo.test.ts:124` | Siembra un doble en memoria con `{ categoria: "egreso_ajuste", tipo: "ingreso" }` para probar que el material del bruto y del neto llega desglosado por `tipo`. | **Verde** (doble en memoria: no pasa por el `CHECK`), pero afirma con un dato que **la base ya no acepta**. Si la 175 mete `ingreso_ajuste` en las categorías de `egresos`, el arreglo es uno; si retira la distinción bruto/neto, es otro. |
| `tests/unit/services/analitica-financiera-derivacion.test.ts:177` | Siembra `{ categoria: "ingreso_flete", tipo: "egreso" }` para probar que el par pago+contraasiento se cancela en el neto de `ingreso_flete`. | Ídem. Y aquí es **más agudo**: `ingreso_flete` declara dos categorías, las dos `ingreso_*`, así que esa cancelación no es alcanzable ni cambiando el catálogo de `egresos`. |

**La pregunta de fondo, que es la que hay que responder antes de tocar esos dos archivos:**

> ¿La distinción **`bruto` / `neto`** significa algo para las cuatro métricas que leen
> `wallet_movimiento`? Hoy no: con listas homogéneas de prefijo, `neto` es siempre `±bruto`, así
> que `neto` no aporta información sobre `bruto` — solo repite el signo que la métrica ya declara
> por su nombre.
>
> Dos salidas, y son excluyentes:
>
> - **(i)** Que `egresos` declare también `ingreso_ajuste` (y, por simetría, las tres de ingreso
>   declaren `egreso_ajuste`). Recupera la cancelación… **cambiando el número de métricas de dinero
>   YA PUBLICADAS**, que es exactamente lo que `[P4]` de la 173 quiso evitar.
> - **(ii)** Que esas cuatro métricas declaren **solo `bruto`** y se retire `neto`. Es honesto —
>   deja de publicar un número que no dice nada nuevo— pero toca el contrato de salida de la 127.

Registrado también por el leader en la ficha de la **175** de `feature_list.json`.

## H11. Gate tras el cierre

- **`pnpm typecheck`** → exit 0.
- **`pnpm lint`** → `✖ 27 problems (0 errors, 27 warnings)` (línea base, intacta).
- **`pnpm exec vitest run guard`** → `47 passed / 683 passed`.
- **`pnpm exec vitest run tests/integration/db tests/integration/actions`** →
  `116 passed (116)` · `1443 passed (1443)`. **Cero rojos**: el único que había era `F.4`.

---
---

# TANDA E — Los datos ya escritos `[P3]`

> Misma rama `feature/173-caja-tesoreria`. Fase **backend**.
> Alcance de esta entrada: **`T E.1`, `T E.2`, `T E.3`** — las tres **HECHAS**.

## E1. Qué se hizo

| Task | Estado | Nota |
| --- | --- | --- |
| `T E.1` — servicio de registro retroactivo | **HECHA** | **Reusa** los emisores de B y C. Su fuente no nombra ni una categoría ni un `origen_tipo` (§E4). |
| `T E.2` — ejecutable con tres modos | **HECHA** | Sin flag **no escribe nada**; `--comprobar` nombra y sale != 0 mientras quede uno. |
| `T E.3` — idempotencia contra Postgres | **HECHA** | Segunda pasada: **0** filas. Y sobre datos del **camino vivo**, tampoco duplica. |

## E2. Archivos

### Creados

| Archivo | Task |
| --- | --- |
| `lib/interfaces/services/ICajaBackfillTesoreriaService.ts` | `T E.1` |
| `lib/services/CajaBackfillTesoreriaService.ts` | `T E.1` |
| `tests/unit/services/caja-backfill-tesoreria.test.ts` (41 tests) | `T E.1` |
| `scripts/backfill-caja-tesoreria.ts` | `T E.2` |
| `tests/unit/scripts/backfill-caja-tesoreria-cli.test.ts` (20 tests) | `T E.2` — declarado en §E8 |
| `tests/integration/db/caja-backfill.test.ts` (5 tests) | `T E.3` |

### Modificados

| Archivo | Qué |
| --- | --- |
| `specs/173-caja-tesoreria/tasks.md` | `T E.1`/`T E.2`/`T E.3` marcadas + el archivo de test del CLI en la lista de `T E.2`. |

**Ni una línea de código existente cambia.** El diff sobre `lib/`, `app/`, `scripts/` y `db/` del
árbol previo está **vacío**: toda la tanda es aditiva y en archivos nuevos.

### Lo que NO está en el diff (y es parte de la verificación)

- `lib/services/CajaCodFeedService.ts` y `lib/services/CajaPagoTiendaFeedService.ts` — se **reusan
  tal cual**. La Tanda E no los toca ni los envuelve: los llama.
- `lib/interfaces/services/ICajaPagoTiendaFeedService.ts` — el puerto **sigue con dos métodos**.
  Ver §E8: la alternativa «extraer los constructores de fila a un módulo compartido» habría
  obligado a reescribir dos guardias (la de `T C.1` y la de la 172 recién afilada en §C13), y se
  descartó por eso.
- `lib/repositories/WalletMovimientoRepository.ts` — el único escritor, sin cambios.
- `lib/services/WalletMensajeroFeedService.ts` — **R66 / `[P2]` = (a)**. El backfill **no genera
  nada del lado mensajero**: ni el pago al mensajero, ni su anulación (§E5).
- `db/` — la Tanda E no toca la base. No hay migración: lo que inserta son filas, no esquema.
- `feature_list.json` — no se toca.

## E3. `T E.1` — de dónde sale cada cosa

`CajaBackfillTesoreriaService.ejecutar(modo)` hace cuatro cosas y ninguna más:

1. **Cosecha** los tres orígenes de `design.md §6.1` y, por cada documento, le pide la fila **al
   emisor del camino vivo**:
   - cierre aprobado → `ICajaCodFeedService.construirIngresoCod` (Tanda B), que suma los créditos
     `cod_recaudado` del **ledger** (no de las gestiones) y devuelve 0 o 1 fila;
   - pago a tienda y anulación → `ICajaPagoTiendaFeedService` (Tanda C), el **mismo** puerto que
     usa `LiquidacionService`.
2. **Fecha** la única fila que el emisor vivo no fecha (§E6).
3. **Descarta** lo que ya ocupa su clave `(origen_tipo, origen_id, categoria)`.
4. **Solo en `aplicar`**, inserta con `crearMovimientos` → `createMany({ skipDuplicates: true })`.

**Cómo obtiene las filas del puerto sin escribirlas** (`RecolectorDeFilasDeCaja`). El puerto de la
Tanda C **escribe**: es lo que `design.md §4` exige para que la liquidación no tenga el
repositorio. Pero `--simular` tiene que decir *de qué categoría* y *por qué monto* **sin tocar la
base**. Se resuelve montando el puerto real sobre un `IWalletMovimientoRepository` que se queda
las filas en memoria, inyectado por una **fábrica** (`crearPuertoDePago`). Así la simulación
reporta, campo por campo, la fila que la liquidación escribiría — y hay un test que lo compara
contra el puerto emitiendo por su cuenta.

Los otros cuatro métodos del recolector **lanzan**. Un `[]` complaciente convertiría un error de
cableado en un informe vacío que parece correcto.

**Coste declarado:** N consultas indexadas (una por cierre aprobado) en vez de una agregación
propia del ledger. Es deliberado: una agregación propia sería una **segunda fórmula** para el
mismo dinero, que es justo lo que la Tanda B decidió no tener. Un script que se corre a mano una
vez por entorno puede pagar ese coste; el libro de la caja no puede pagar dos fuentes.

## E4. «No una copia paralela» — medido, no prometido

El servicio **no nombra ni una de las 17 categorías de la caja ni ninguno de los 7 `origen_tipo`**.
Dos tests lo barren sobre el código sin comentarios, leyendo los catálogos del SEED en runtime (no
de una lista copiada a mano):

```
✓ su fuente no nombra NI UNA de las 17 categorias de la caja
✓ ni ninguno de los 7 `origen_tipo`: la clave de idempotencia se LEE de la fila emitida
✓ y tampoco compone las descripciones a mano: usa las dos funciones de la 172
✓ las filas que propone son, campo por campo, las que emite el puerto de la Tanda C
```

Eso obligó a un cambio de diseño respecto al primer borrador: la caja se consulta **después** de
tener las candidatas y con las claves que ellas traen (`origenTipo IN (...) AND origenId IN (...)`),
en vez de con un `WHERE origen_tipo IN ('cierre_dia','pago_tienda')` escrito a mano. Sin eso, el
backfill declaraba media clave de idempotencia por su cuenta. Y los rótulos del informe se llaman
`pago_a_tienda` / `anulacion_de_pago_a_tienda` —no `pago_tienda`— precisamente para que ese barrido
no pueda pasar por coincidencia de nombres.

Las descripciones salen de `descripcionDePago` y `descripcionDeAnulacion` (172); el día de la
anulación, de `medianocheUtcDelDia(fechaCalendarioCR(...))`, **las mismas dos funciones** que usa
`LiquidacionService`. Lo único que cambia es de dónde sale el instante: allí del reloj, aquí del
documento.

## E5. `[P2]` = (a): el backfill no genera nada del lado mensajero

Ni el diseño lo pide ni el código lo puede hacer:

- `liquidacionPago.findMany({ where: { tiendaId: { not: null } } })` — los pagos a mensajero no se
  examinan siquiera. Test: `examinados.pago_a_tienda` es **2** de 3 documentos.
- `liquidacionAnulacion.findMany({ where: { pago: { tiendaId: { not: null } } } })` — ídem con las
  anulaciones: **1** de 2.
- El puerto de la Tanda C **no puede** emitir `egreso_pago_mensajero` (R23, ya medido en §C4/§C13),
  así que aunque el WHERE fallara, la categoría no existiría por esa vía.
- Un test afirma que ninguna fila del informe lleva `egreso_pago_mensajero` **ni** `ingreso_ajuste`.

## E6. Las fechas — el punto peligroso de la tanda

| Origen | Fecha | De dónde sale |
| --- | --- | --- |
| cierre aprobado | `MIN(fecha_movimiento)` de los movimientos de caja que ese cierre ya tiene | design §6.2 |
| ídem, si no tiene ninguno | `cierre_dia.resuelto_at` | design §6.2 |
| ídem, si tampoco | `cierre_dia.solicitado_at` | **añadido, declarado abajo** |
| pago a tienda | `liquidacion_pago.fecha_pago` (`@db.Date` = medianoche UTC) | design §6.2 |
| anulación | día **calendario de CR** de `liquidacion_anulacion.created_at` | design §6.2 |

**El tercer escalón no está en el design y se declara aquí.** `resuelto_at` es NULLABLE en el
esquema (`db/schema.prisma`), así que un cierre aprobado con `resuelto_at` NULL dejaría la fila sin
fecha del origen — y «sin fecha» en `CrearMovimientoInput` significa `DEFAULT CURRENT_TIMESTAMP`,
es decir, **exactamente el `now()` que R41 prohíbe**. `solicitado_at` es obligatorio y es del propio
documento, así que la cadena nunca cae fuera del origen. Hay un test por cada escalón.

La anulación usa el **día de CR**, no el UTC: su `created_at` de prueba es `2026-08-06T04:00Z`, que
en Costa Rica son las 22:00 del **5**. Fecharla el 6 la sacaría de su propio día en cualquier
informe por rango. Es la misma convención del camino vivo.

## E7. `T H.3` mutación 3 (la obligatoria) — EJECUTADA, roja y revertida

**Mutación:** en `CajaBackfillTesoreriaService.dePagosATienda`,
`fechaMovimiento: pago.fechaPago` → `fechaMovimiento: this.deps.ahora()`.

**Resultado: 5 tests rojos en 2 archivos**, uno de ellos **contra Postgres real**:

```
 ❯ tests/unit/services/caja-backfill-tesoreria.test.ts (41 tests | 4 failed)
     × con el reloj en NAVIDAD, ni una sola fila lleva esa fecha
     × pago a tienda: la `fecha_pago` del documento
     × la fuente no construye ni una fecha, y el reloj se usa UNA sola vez
     × las filas que propone son, campo por campo, las que emite el puerto de la Tanda C
 ❯ tests/integration/db/caja-backfill.test.ts (5 tests | 1 failed)
     × las TRES filas llegan a la tabla con su categoria, su monto y la fecha de su ORIGEN
```

El que lo mide de frente:

```
 FAIL  tests/unit/services/caja-backfill-tesoreria.test.ts >
       R41 — ninguna fila se fecha con el reloj; todas con la coordenada de su origen >
       con el reloj en NAVIDAD, ni una sola fila lleva esa fecha
AssertionError: pago_a_tienda/pago-1: expected '2026-12-25T18:30:00.000Z'
                                          not to be '2026-12-25T18:30:00.000Z'
 ❯ tests/unit/services/caja-backfill-tesoreria.test.ts:474:72
```

Y el mismo defecto, **ya escrito en la tabla de Postgres**:

```
 FAIL  tests/integration/db/caja-backfill.test.ts > las TRES filas llegan a la tabla ...
- Expected
+ Received
      "categoria": "egreso_pago_tienda",
-     "fecha": "2026-07-30T00:00:00.000Z",
+     "fecha": "2026-12-25T18:30:00.000Z",
```

Un pago de julio contabilizado en diciembre, en un libro inmutable: irreparable salvo por
contraasiento. **Mutación revertida**; las dos suites vuelven a 46 verdes.

**Por qué el reloj está cableado y no es código muerto.** `informe.instante` sí sale de
`deps.ahora()`, y un test lo afirma. Sin eso, «no se fecha con el reloj» sería cierto por vacío y
la mutación no tendría código vivo que mutar. Encima, un test estructural fija que la fuente **no
contiene `new Date(` ni `Date.now(`** y que `ahora()` aparece **exactamente una vez**: las tres vías
de meter el reloj en una fila caen.

### Mutación 4 (extra) — el filtro de idempotencia deja de casar

`.filter((f) => !ocupadas.has(claveDeOrigen(f.movimiento)))` → la clave nunca casa. Es la
comprobación de que `T E.3` no pasa por vacío:

```
 ❯ tests/unit/services/caja-backfill-tesoreria.test.ts (41 tests | 6 failed)
 ❯ tests/integration/db/caja-backfill.test.ts (5 tests | 2 failed)
     × R39: dos ejecuciones seguidas — la SEGUNDA inserta 0 y ningun importe cambia
     × R39 (el caso que importa): sobre datos que YA pasaron por el camino vivo, no duplica

AssertionError: expected [ { ...(3) }, ...(2) ] to deeply equal []
+   { "documentoId": "93de593a-...", "movimiento": { "categoria": "ingreso_cod_recaudado",
+     "monto": "12801.00", "origenTipo": "cierre_dia", ... } }
```

Nótese que **la tabla no se duplicó** ni con esa mutación: el índice único parcial la contuvo. Es
justo la propiedad que `T E.3` promete —la barrera es la base, no el `if`— y lo que cae es el
CONTEO del informe, que es el daño real de ese defecto. **Mutación revertida.**

## E8. Dos cosas declaradas, para que el review no tenga que deducirlas

**(a) Un archivo de test más de los que `T E.2` listaba.** La task solo nombraba el script; la
trazabilidad manda R40/R43/R44 al test del **servicio**, y ahí están. Pero «sin flag no escribe
nada» y «no puede decir *al día* mientras quede uno» son propiedades **del CLI**, no del servicio:
se miden en `tests/unit/scripts/backfill-caja-tesoreria-cli.test.ts`, con el molde de la 125
(entorno inyectable, sin base y sin proceso hijo). `tasks.md` se actualizó para listarlo.

**(b) `destinoLegible` se reescribe en vez de importarse de `scripts/backfill-analitica.ts`.** Son
15 líneas sin lógica de dinero cuyo único fin es no imprimir la credencial. Importarlas de allí
habría metido este script en el censo estructural de la **feature 125**
(`tests/unit/analytics/backfill-guards.test.ts`, «el censo cubre todo lo que importa los modulos de
la 125»), que exige listar a cada consumidor. Un backfill de otra feature no tiene por qué entrar en
ese censo. Hay test de que no se filtra usuario ni contraseña, incluida una contraseña con `@`.

**Lo que NO se hizo y por qué:** el camino DRY de verdad —extraer los dos constructores de fila del
puerto a un módulo compartido y usarlo desde el puerto y desde el backfill— habría obligado a
reescribir dos guardias que otra tanda acaba de afilar: la de `T C.1` («su fuente nombra DOS
categorías») y la de la 172 (§C13, «filtrando las 17 categorías contra la fuente del puerto...»). Se
descartó: el recolector consigue la misma propiedad —una sola declaración de la categoría— sin tocar
nada de lo ya verificado.

## E9. `T E.2` — los tres modos

| Modo | Escribe | Código de salida | Qué dice |
| --- | --- | --- | --- |
| `--simular` (**defecto**) | **no** | 0 siempre | cuántas filas, de qué categoría, por qué monto |
| `--aplicar` | sí | 0 | filas insertadas + «corre ahora `--comprobar`» |
| `--comprobar` | **no** | **2** si queda uno, 0 si está al día | **nombra** cada documento pendiente |

- **Sin flag no escribe nada**, medido contando con qué modo se invocó al servicio: `["simular"]`.
- **Una errata (`--aplcar`) aborta**: `strict()` de zod. No se lee como «sin flag» y **no se crea el
  servicio** (cero conexiones). Dos modos a la vez también abortan.
- **R44 barrido sobre la salida entera**: con un pendiente, el texto —normal y de error, en
  minúsculas— **no contiene «al dia» ni «al día»**, ni siquiera negado. Por eso la rama de
  pendientes dice *«PENDIENTE: quedan N documentos...»* y la frase «AL DIA» se emite en **una sola
  rama** del informe.
- El eco imprime `host:puerto/base` **sin credencial**, y sin `DATABASE_URL` aborta antes de nada.

## E10. `T E.3` — contra Postgres real

Todo dentro de una transacción que **siempre se revierte** (patrón de la 169). La semilla —un cierre
aprobado con contra-entrega de dos tiendas más un débito y un ajuste, un pago a tienda y su
anulación— usa usuarios y zonas **ya existentes**; si la base no los tiene, la suite se salta.
Medido en la base local: 6 usuarios, 13 zonas, y **0** cierres/pagos/movimientos previos, así que
los conteos de esta suite son exactos, no aproximados. Un assert extra («las tres filas de esta
prueba están en el plan») impide que la suite pase en vacío si la semilla no llegara a escribirse.

- **R39, dos pasadas:** la primera inserta 3, la segunda **0**, y las filas leídas de la tabla son
  **campo por campo idénticas** antes y después. Luego `--comprobar` dice **al día**.
- **R39, el caso que importa:** se corre primero el **camino vivo** (`CajaCodFeedService` +
  `WalletMovimientoRepository` para el cierre; el puerto real para el pago y su anulación) y
  **encima** el backfill. Ni lo simula ni lo escribe: la tabla queda con sus **3** filas exactas.
- **R42 contra el motor:** `count(wallet_movimiento)` antes y después de `simular` y `comprobar`:
  **idéntico**. Y los dos **vieron** lo que falta (el informe nombra los documentos de la semilla).
- **El `CHECK` de `T A.2`** acepta las tres filas: cada `categoria` empieza por su `tipo`. Si el
  backfill emitiera una cruzada, el `aplicar` habría reventado con `23514`.
- Las dos filas del pago —egreso y reverso— **comparten** `(origen_tipo, origen_id)`, conviven y su
  neto sobre la caja es `0.00`.

## E11. Trazabilidad `R<n>` → test

| R | Test que lo verifica |
| --- | --- |
| R36 | `tests/unit/services/caja-backfill-tesoreria.test.ts` — «emite UN ingreso por cierre, con la SUMA EXACTA de sus creditos» (12801.00, con débito y ajuste del mismo cierre descartados), «un cierre SIN contra-entrega no emite fila, ni siquiera en 0.00», «un cierre que NO esta aprobado no se toca» + `tests/integration/db/caja-backfill.test.ts` (Postgres) |
| R37 | idem — «emite UN egreso `egreso_pago_tienda` con el monto, el origen y la descripcion del documento» + «`[P2]` = (a): un pago a MENSAJERO no genera absolutamente nada» + la fila leída de la tabla en integración |
| R38 | idem — «emite `ingreso_reverso_pago_tienda` —jamas `ingreso_ajuste`— por el monto del pago», «el egreso y su reverso COMPARTEN la clave de origen», «la anulacion de un pago a MENSAJERO tampoco genera nada» |
| R39 | `tests/integration/db/caja-backfill.test.ts` — «dos ejecuciones seguidas: la SEGUNDA inserta 0 y ningun importe cambia» y **«sobre datos que YA pasaron por el camino vivo, no duplica»** + unidad: «con la caja ya completa, no queda ni una pendiente» |
| R40 | `caja-backfill-tesoreria.test.ts` — «no llama al repositorio de la caja NI UNA vez, e informa 0 insertadas», «`comprobar` tampoco escribe», «dice cuantas filas, de que categoria y por que monto total», «lo que simula es lo que escribe» + `tests/unit/scripts/backfill-caja-tesoreria-cli.test.ts` — «sin argumentos, el servicio se invoca en modo `simular`» |
| R41 | `caja-backfill-tesoreria.test.ts` — «con el reloj en NAVIDAD, ni una sola fila lleva esa fecha», «pero el reloj SI esta cableado», los **tres** escalones de la cadena del cierre, «pago a tienda: la `fecha_pago` del documento», «anulacion: el DIA CALENDARIO DE COSTA RICA», «la fuente no construye ni una fecha, y el reloj se usa UNA sola vez» + la mutación de §E7 |
| R42 | idem — «en modo `simular`/`aplicar`/`comprobar`, cero `update`, `delete` y `upsert` en los CINCO delegados» (7 métodos × 5 delegados × 3 modos), «del repositorio de la caja solo usa `crearMovimientos`», «su fuente no nombra ninguna forma de modificar ni de borrar» + `caja-backfill.test.ts` — `count` idéntico contra Postgres |
| R43 | `caja-backfill-tesoreria.test.ts` — «los cinco, con su documento y su origen, no solo un conteo» y «recorre los TRES origenes, diciendo cuantos documentos miro de cada uno» + `backfill-caja-tesoreria-cli.test.ts` — «cada pendiente sale con su origen, su id, su categoria, su monto y su fecha» |
| R44 | `caja-backfill-tesoreria.test.ts` — «con cinco pendientes, `alDia` es false», «basta UNO —el mas pequeño de todos—», «con todo registrado, `alDia` es true» + `backfill-caja-tesoreria-cli.test.ts` — «la salida ENTERA no contiene esas palabras, ni siquiera negadas» y «sale con un codigo distinto de 0» |
| R66 / `[P2]` | `caja-backfill-tesoreria.test.ts` — pago y anulación de mensajero fuera; ninguna fila lleva `egreso_pago_mensajero`; `WalletMensajeroFeedService` y su suite **fuera del diff** |

## E12. Gate ejecutado

> Gate **acotado**, el que ordenó el leader. La suite completa NO se corrió.

**`pnpm typecheck`** → `tsc --noEmit`, sin salida, **exit 0**.

**`pnpm lint`**

```
✖ 27 problems (0 errors, 27 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores** y **exactamente las 27 de la línea base** de las tandas A/B/C/D. Filtrando la salida
por `backfill-caja`, `CajaBackfill` e `ICajaBackfill` → **cero coincidencias**.

**`pnpm exec vitest related --run`** sobre los 6 archivos de la tanda

```
 Test Files  3 passed (3)
      Tests  66 passed (66)
   Duration  937ms
```

**`pnpm exec vitest run guard`** (obligatorio desde §C13)

```
 Test Files  47 passed (47)
      Tests  683 passed (683)
   Duration  3.90s
```

**683, idéntico a las tandas C, A.2 y D**: ninguna guardia ajena se movió. En particular el censo de
escritores de `caja-173-alcance.guardia.test.ts` recorre **todo** `lib/` + `scripts/`, así que ya
cubre los dos módulos nuevos sin editarlo: siguen siendo **un** escritor por libro ajeno.

**`pnpm exec vitest run tests/integration/db tests/integration/actions`**

```
 Test Files  117 passed (117)
      Tests  1448 passed (1448)
   Duration  12.19s
```

Delta contra §H11 (116 archivos / 1443 tests): **+1 archivo y +5 tests**, que son exactamente los de
`T E.3`. **Cero rojos ajenos**: nada de esta tanda tocó otra feature.

**No corrido aquí:** `./init.sh --rapido` ni `./init.sh` completo. Los corre el leader.

## E13. Lo que queda abierto (y no es de esta tanda)

- **`T H.4`** — ejecutar `--simular` → revisión humana → `--aplicar` → `--comprobar` en **cada
  entorno**, y leer por MCP las filas nuevas en producción. El ejecutable está; correrlo contra
  entornos reales no es una decisión del backend. Recordatorio de `progress/medicion_TA0_173.md`:
  **preview no es alcanzable por MCP**, así que allí `--comprobar` es la única evidencia posible.
- **`T H.2`** — si amplía la lista explícita de módulos nuevos de la 173 en
  `caja-173-alcance.guardia.test.ts`, los dos de esta tanda son
  `lib/services/CajaBackfillTesoreriaService.ts` y `scripts/backfill-caja-tesoreria.ts`. El censo del
  árbol ya los cubre; la lista explícita es redundancia barata.

## E14. Veredicto de la Tanda E

TANDA E entregada completa: el registro retroactivo **solo inserta** —cero `update`/`delete`/
`upsert` medidos con espías sobre los cinco delegados y los tres modos—, **reusa** los emisores de
las tandas B y C hasta el punto de que su fuente no nombra ni una categoría ni un `origen_tipo`,
fecha cada fila con la coordenada de **su origen** —con la mutación obligatoria ejecutada, roja en 5
tests y también **contra Postgres**— y es idempotente por índice: dos pasadas seguidas insertan
**0** la segunda, y sobre datos que ya pasaron por el camino vivo tampoco duplica.
