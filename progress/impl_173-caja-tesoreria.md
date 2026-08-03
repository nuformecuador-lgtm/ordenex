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
