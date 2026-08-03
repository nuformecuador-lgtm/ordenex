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
