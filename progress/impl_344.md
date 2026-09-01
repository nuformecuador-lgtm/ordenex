# Ficha 344 — bitácora de implementación: BACKEND (bloques B1–B5)

> Tanda de **backend**. No se ha tocado `app/`, `components/`, `hooks/` ni ninguna descarga:
> los bloques B6–B9 (paneles, columnas de descarga y medición en navegador) son de la tanda de
> frontend y quedan pendientes.

---

## 0 — Lo medido antes de tocar nada

**T0.1 — la premisa de producción.** La midió el LEADER el 2026-08-31 y viene en la ficha:
**80 movimientos** de `wallet_movimiento` con `origen_tipo = 'cierre_dia'` y **los 80** con
`origen_id`. Trazabilidad del 100 %: del movimiento se llega al cierre y del cierre a sus órdenes.
Esta sesión NO la volvió a medir (no tiene acceso a producción); se trabaja sobre esa medida.

**T0.3 — los seis símbolos, confirmados en el ARCHIVO REAL** (no en el grafo del MCP, que devuelve
de más):

| símbolo | archivo real | línea |
| --- | --- | --- |
| `derivarIngresoOrden` | `lib/utils/ingreso-ordenex.ts` | 145 |
| `agregarIngresosPorConcepto` | `lib/utils/ingreso-ordenex.ts` | 385 |
| `construirMovimientosDeIngreso` | `lib/services/WalletFeedService.ts` | 32 |
| `construirMovimientosPorTienda` | `lib/services/WalletTiendaFeedService.ts` | 68 |
| `DETALLE_SELECT` / `tarifaDe` | `lib/utils/cierre-detalle.ts` | 22 / 93 |
| `MAPEO_CONCEPTO_TIENDA` | `lib/utils/mapeo-concepto-tienda.ts` | 18 |

Los dos feeds leen sus gestiones con `gestionOrden.findMany({ where: { cierreId } })` —**sin**
`anuladaAt: null`—, y ese `where` es el que el repositorio del detalle replica exactamente.

**Censo de tablas, foto ANTES de la tanda de frontend** (`tests/unit/descarga/censo-tablas.ts`):
**30 censadas = 19 `con_descarga` + 11 `fuera`**. Esta tanda **no lo mueve** (no añade ninguna
tabla); los +2/+2 los hará B8.

---

## 1 — Archivos

### Nuevos

| archivo | qué es |
| --- | --- |
| `lib/types/detalle-movimiento.ts` | contrato: `MOTIVO_SIN_REPARTO_SEED`, `OrdenAporteDTO`, `DetalleMovimientoPayload` y los dos schemas de borde |
| `lib/utils/aporte-por-orden.ts` | PURO: `FUENTE_CAJA`, `FUENTE_TIENDA`, `CRITERIO_DE_APORTE`, `satisfaceCriterio`, `aporteDeOrden` |
| `lib/config/detalle-movimiento.ts` | `DEFAULT_PAGE_SIZE = 25`, `MAX_PAGE_SIZE = 100`, con sus dos variables de entorno |
| `lib/interfaces/repositories/ICierreAporteRepository.ts` | contrato del repositorio |
| `lib/repositories/CierreAporteRepository.ts` | la consulta acotada, su `count` y la cabecera del cierre |
| `lib/interfaces/services/IDetalleMovimientoService.ts` | contrato del servicio (4 métodos, 4 estados) |
| `lib/services/DetalleMovimientoService.ts` | los dos libros con UNA sola derivación |

### Modificados

| archivo | cambio |
| --- | --- |
| `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` | + `obtenerPorIdDeTienda(id, tiendaId)` |
| `lib/repositories/WalletTiendaMovimientoRepository.ts` | su implementación, con `tiendaId` en el `WHERE` |
| `lib/actions/wallet.ts` | + `verDetalleDeMovimientoAction` y `…CompletoAction` + `buildDetalleService()` |
| `lib/actions/wallet-tienda.ts` | + `verDetalleDeMiMovimientoAction` y `…CompletoAction` + `buildDetalleService()` |
| `tests/unit/guards/caja-173-alcance.guardia.test.ts` | el catálogo nuevo, declarado en `CATALOGOS_PREEXISTENTES` (la guardia lo exigió: se vio fallar primero) |
| `tests/unit/actions/wallet-actions.test.ts` | el censo literal de la superficie de `lib/actions/wallet.ts` pasa de 5 a 7 acciones |
| 11 archivos de test con dobles del ledger de tienda | + `obtenerPorIdDeTienda: vi.fn(async () => null)` (el typecheck los cantó, que es lo que su propio contrato dice que pasaría) |

---

## 2 — Las tres decisiones que se apartan de `design.md`, con su motivo

### 2.1 — La supresión de los aportes en cero (Q2 del humano)

`design.md § Q2` asumía **mostrar** la orden que aporta «0,00»; el humano decidió lo contrario, y
`design.md` ya había escrito la condición de esa decisión: «el filtro tendría que ir también en el
`count` para que R28 siga siendo cierto». Por eso **no se filtra en memoria**: el criterio gana dos
hechos que **son columnas** —`cierre_detail.monto_cobrar > 0` y `gestion_orden.monto_recibido > 0`—
y viajan en el MISMO `where` que pagina y que cuenta.

**Qué cubre:** el caso real y frecuente —una orden que cobra comisión y no tenía COD que recaudar
deriva `ingreso_comision_cod = 0.00`— y su gemelo del crédito de la tienda.

**Qué NO cubre, dicho en vez de escondido:** un aporte que sale 0,00 porque la TARIFA congelada
valía cero (flete 0, IVA 0 %, comisión 0 %). Filtrarlo exigiría **calcular el importe dentro del
`WHERE`**, o sea escribir la fórmula de dinero por segunda vez en SQL — exactamente lo que R18/R46
prohíben. En ese caso la fila aparece con «0,00»: es la conducta que `design.md` daba por defecto,
la suma sigue cuadrando y el `count` sigue casando con las filas. Queda escrito en el docstring de
`CRITERIO_DE_APORTE`.

### 2.2 — Un servicio propio en vez de dos métodos en `WalletService`/`WalletTiendaService`

`design.md § 3.3` los ponía como métodos de los dos servicios de wallet. Se implementan en
`DetalleMovimientoService` por dos motivos, el segundo **medido**:

1. Los dos libros comparten TODO menos dos líneas (el guard de rol y el `tiendaId`). Repartidos en
   dos clases, la derivación del aporte se escribiría **dos veces**, y que la caja y el libro de la
   tienda deriven el mismo dinero desde dos sitios es el fallo que esta ficha existe para no
   cometer.
2. `WalletService` y `WalletTiendaService` se construyen en **12 archivos (70 llamadas)**. Darles
   una dependencia obligatoria más obligaba a tocar los tests de seis features ajenas para pasarles
   un doble que no usan.

Lo que no cambia: el guard es el MISMO predicado de rol de cada pantalla, evaluado ANTES de la base
(R39), y no se añade ningún permiso (R43). `wallet-tienda-detalle-movimiento.test.ts` compara el
detalle contra el propio `WalletTiendaService.listarMisMovimientos` rol por rol, para que no puedan
divergir.

### 2.3 — UN solo schema de borde para los dos libros

`tasks.md § T4.1` pedía «espejo para el libro de la tienda». Se declara **uno**
(`verDetalleDeMovimientoSchema`) y lo usan los cuatro bordes: la entrada son las MISMAS dos claves
y el alcance **nunca viaja en ella**. Dos copias idénticas serían dos definiciones que pueden
divergir, y la que divergiera sería justo la que decide qué se puede pedir.

---

## 3 — Mapa `R<n> → test` (lo que esta tanda cubre)

| R | Test |
| --- | --- |
| R9 | `tests/unit/repositories/cierre-aporte-repository.test.ts` › la cabecera trae la fecha del cierre y el nombre COMPLETO del mensajero |
| R12 | `tests/unit/repositories/cierre-aporte-repository.test.ts` › contar las ordenes del cierre lleva el mismo acotamiento por tienda · `…postgres.test.ts` › el detalle trae solo las ordenes que aportan (`ordenesDelCierre === 9`) |
| R15 | `tests/unit/services/wallet-tienda-detalle-movimiento.test.ts` › el detalle de la tienda no lleva el nombre del mensajero |
| R16 | `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › el detalle trae solo las ordenes que aportan a ese concepto |
| R17 | `…postgres.test.ts` › la suma de todas las paginas es el importe del movimiento, centimo a centimo · › el credito COD de la tienda cuadra con su importe |
| R18 | `tests/unit/utils/aporte-por-orden-equivalencia.test.ts` › el criterio coincide con la derivacion en las 120 combinaciones |
| R19 | `…postgres.test.ts` › el detalle trae solo las ordenes que aportan (los cinco intrusos, uno a uno) |
| R20 | `…postgres.test.ts` › una orden con dos gestiones sale una vez con el aporte sumado |
| R21 | `tests/unit/repositories/cierre-aporte-repository.test.ts` › el criterio del concepto viaja dentro del where |
| R22 | `tests/unit/utils/aporte-por-orden.test.ts` › el aporte se deriva del snapshot congelado, no de datos vivos · `cierre-aporte-repository.test.ts` › proyecta el SNAPSHOT congelado y no lee `tarifas` ni la orden vivas |
| R23 | `…postgres.test.ts` › la orden sin tarifa congelada no aparece y no altera la suma |
| R24 | `…postgres.test.ts` › el detalle devuelve una pagina y el total es el del conjunto |
| R26 | `tests/unit/config/detalle-movimiento-config.test.ts` › el tamano y el tope salen de la configuracion |
| R27 | `tests/unit/config/detalle-movimiento-config.test.ts` › respeta el override de entorno e ignora el valor basura |
| R28 | `…postgres.test.ts` › el detalle devuelve una pagina y el total es el del conjunto, no el largo de la pagina |
| R29 | `tests/unit/actions/detalle-movimiento-action.test.ts` › un pageSize sobre el tope es validation_error y no devuelve ordenes |
| R30 | `…postgres.test.ts` › recorrer las paginas devuelve cada orden exactamente una vez |
| R32 | `tests/unit/services/wallet-detalle-movimiento.test.ts` › el modo completo devuelve el conjunto sin recorte por pagina |
| R34 | `tests/unit/services/wallet-detalle-movimiento.test.ts` › por encima del tope devuelve solo conteos y ninguna fila |
| R38 | `tests/unit/services/wallet-detalle-movimiento.test.ts` › un rol sin acceso total recibe forbidden sin ordenes |
| R39 | `tests/unit/services/wallet-detalle-movimiento.test.ts` › el forbidden no llega a llamar al repositorio |
| R40 | `…postgres.test.ts` › la tienda no ve ni una orden de otra tienda del mismo cierre |
| R41 | `…postgres.test.ts` › el movimiento de otra tienda responde no encontrado |
| R42 | `tests/unit/actions/detalle-movimiento-action.test.ts` › una clave de tienda colada muere en el borde |
| R43 | `tests/unit/services/wallet-tienda-detalle-movimiento.test.ts` › usa el mismo predicado de rol que el listado de /mi-wallet |
| R44 | `tests/unit/services/wallet-detalle-movimiento.test.ts` › todo importe cruza la frontera como texto |
| R46 | `tests/unit/utils/aporte-por-orden.test.ts` › sumar los aportes por orden da el mismo agregado que el feed |
| R48 | `tests/unit/services/wallet-detalle-movimiento.test.ts` › un concepto que no se reparte abre su detalle y dice de donde sale · `…postgres.test.ts` › los tres conceptos sin reparto abren su detalle |
| R49 | `tests/unit/utils/aporte-por-orden.test.ts` › los dos catalogos cubren todas las categorias de sus enums (+ la mitad de compilación, § 4.5) |

**Pendientes de la tanda de FRONTEND (B6–B9):** R1–R8, R10, R11, R13, R14, R25, R31, R33, R35–R37,
R45, R47, R50–R52.

---

## 4 — Las mutaciones, con su salida REAL

> En este repo hay un arnés de mutaciones que reportó supervivientes **sin haber ejecutado un solo
> test**. Cada una de abajo se aplicó, se corrió, se leyó su rojo y se revirtió.

### 4.1 — T1.4: quitar `"rechazada"` del criterio de `ingreso_flete_devolucion`

```
 ❯ tests/unit/utils/aporte-por-orden-equivalencia.test.ts (5 tests | 3 failed) 12ms
     × el criterio coincide con la derivacion en las 120 combinaciones 8ms
     × con el COD en cero o ausente, el criterio deja fuera exactamente los aportes de 0,00 1ms
     × el criterio NO depende de la zona ni del pacto especial del distrito 1ms

AssertionError: celda ingreso_flete_devolucion / rechazada / cobraComision=true / tarifa=true:
expected false to be true // Object.is equality
```

Revertida → 5 passed.

### 4.2 — T5.1 (1): quitar la restricción de `resultado` del `WHERE`

```
 ❯ tests/integration/db/detalle-movimiento-cierre-postgres.test.ts (11 tests | 6 failed) 969ms
     × el detalle trae solo las ordenes que aportan a ese concepto (R16/R19) 342ms
     × la suma de todas las paginas es el importe del movimiento, centimo a centimo (R17) 125ms
     × de las nueve ordenes del cierre solo aportan las que el criterio admite, y no se muestran los ceros 50ms
     × el detalle devuelve una pagina y el total es el del conjunto, no el largo de la pagina (R24/R28) 50ms
     × recorrer las paginas devuelve cada orden exactamente una vez (R30) 75ms
     × la tienda no ve ni una orden de otra tienda del mismo cierre (R40) 50ms

AssertionError: expected Set{ …(8) } to deeply equal Set{ …(4) }      ← 4 aportantes → 8
AssertionError: ingreso_flete: la orden 503 aporta 0,00 y no deberia estar en el detalle
```

**Y aquí hay un hallazgo que se anota porque cambió el test.** En la PRIMERA pasada de esta
mutación el caso del **cuadre (R17) sobrevivió en verde**: las órdenes intrusas no derivan nada, su
aporte sale «0,00» y la Σ seguía dando el importe de la fila. Es decir, **la suma sola no detecta
que el `WHERE` se abrió**. Se añadió al caso del cuadre la aserción «ninguna fila aporta 0,00» —que
además es el invariante que la decisión Q2 acaba de crear— y con ella la mutación **también** lo
pone rojo (es el segundo bloque de arriba, ya con la aserción dentro). Revertida → 11 passed.

### 4.3 — T5.1 (2): quitar `tiendaId` del `where` de las ÓRDENES

```
 ❯ tests/integration/db/detalle-movimiento-cierre-postgres.test.ts (11 tests | 2 failed) 959ms
     × la tienda no ve ni una orden de otra tienda del mismo cierre (R40) 46ms
     × el credito COD de la tienda cuadra con su importe (R17 en el otro libro) 68ms

AssertionError: se colo la orden de la otra tienda: expected [ …(4) ] to not include 'da6bf7f9-…'
AssertionError: expected '44150.00' to be '43150.00'   ← los 1 000,00 de la tienda B, dentro
```

Revertida → 11 passed.

### 4.4 — T5.1 (3): quitar `tiendaId` de la lectura del MOVIMIENTO

```
 ❯ tests/integration/db/detalle-movimiento-cierre-postgres.test.ts (11 tests | 1 failed) 956ms
     × el movimiento de otra tienda responde no encontrado (R41) 46ms

AssertionError: expected { status: 'ok', data: { …(7) } } to deeply equal { status: 'not_found' }
+   "monto": "777.00",              ← el importe del libro de la tienda B…
+   "ordenes": [ { "guia": "501", "tiendaNombre": "Tienda A 344", … } ]   ← …servido a la tienda A
```

Revertida → 11 passed.

### 4.5 — T5.1 (4): devolver `items.length` como `total`

```
 ❯ tests/integration/db/detalle-movimiento-cierre-postgres.test.ts (11 tests | 4 failed) 880ms
     × la suma de todas las paginas es el importe del movimiento, centimo a centimo (R17) 55ms
     × el detalle devuelve una pagina y el total es el del conjunto, no el largo de la pagina (R24/R28) 78ms
     × recorrer las paginas devuelve cada orden exactamente una vez (R30) 43ms
     × el credito COD de la tienda cuadra con su importe (R17 en el otro libro) 43ms

AssertionError: ingreso_flete: la Σ del detalle no es el importe de la fila:
  expected '1000.00' to be '13777.00'
AssertionError: expected [ 1, 1, 1, 1 ] to deeply equal [ 4, 4, 4, 4 ]
```

Revertida → 11 passed.

### 4.6 — R49, la mitad de COMPILACIÓN: quitar una entrada de `FUENTE_CAJA`

```
lib/utils/aporte-por-orden.ts(55,14): error TS2741: Property 'egreso_indemnizacion' is missing in
type '{ ingreso_flete: …; … }' but required in type 'Record<"ingreso_flete" | … , FuenteDeAporte>'.
```

Revertida → `tsc --noEmit` exit 0. Una categoría nueva en el enum rompe el build en vez de caer en
un `default` silencioso.

---

## 5 — Verificación

```
$ pnpm typecheck   (npx tsc --noEmit)
TYPECHECK_EXIT=0     (0 líneas de salida)

$ pnpm lint        (npx eslint)
LINT_EXIT=0
✖ 143 problems (0 errors, 143 warnings)      ← todo warnings preexistentes de `_arg no usado`
```

### Los ocho archivos de test nuevos, por nombre

```
$ npx vitest run tests/unit/utils/aporte-por-orden-equivalencia.test.ts \
    tests/unit/utils/aporte-por-orden.test.ts \
    tests/unit/config/detalle-movimiento-config.test.ts \
    tests/unit/repositories/cierre-aporte-repository.test.ts \
    tests/unit/services/wallet-detalle-movimiento.test.ts \
    tests/unit/services/wallet-tienda-detalle-movimiento.test.ts \
    tests/unit/actions/detalle-movimiento-action.test.ts \
    tests/integration/db/detalle-movimiento-cierre-postgres.test.ts

 Test Files  8 passed (8)
      Tests  72 passed (72)
```

### Los archivos MODIFICADOS de otras features

```
$ npx vitest run  (los 11 con dobles del ledger + los dos censos tocados)
 Test Files  11 passed (11)
      Tests  152 passed (152)

$ npx vitest run tests/unit/actions/wallet-actions.test.ts tests/unit/actions/wallet-tienda-actions.test.ts
 Test Files  2 passed (2)
      Tests  30 passed (30)

$ npx vitest run tests/unit/guards/caja-173-alcance.guardia.test.ts
  (verde tras declarar el catálogo; se vio FALLAR primero con
   «expected [ 'lib/utils/aporte-por-orden.ts' ] to deeply equal []»)
```

### Barridos amplios

```
$ npx vitest run tests/unit
 Test Files  1 failed | 1060 passed (1061)
      Tests  1 failed | 15642 passed (15643)

$ npx vitest run tests/integration/db
 Test Files  170 passed (170)
      Tests  2076 passed (2076)
```

**El único rojo NO es de esta ficha y ya venía de `dev`:**

```
 FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
 › ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
 + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

Comprobado con `git grep -n "obtenerTarifa" origin/dev -- app components lib hooks`: en `origin/dev`
la única aparición es **su propia definición**, así que esa acción ya estaba huérfana antes de esta
tanda. No se toca: anotarla exige saber por qué perdió su pantalla, y eso es de otra ficha. **Las
cuatro Server Actions de la 344 SÍ pasan esa guardia**, con su `@sin-superficie` y el aviso de que
quien monte el panel debe borrarlo.

**Dos flakes conocidos, verdes en aislado** (`tests/integration` completo, dos corridas seguidas,
fallo distinto en cada una): `habilitacion-api-migration.test.ts` con un deadlock `40P01` —la
familia que `_postgres-real.ts` documenta— y `recuperar-contrasena-form.test.tsx` (jsdom, sin
relación con esta ficha). Corridos por nombre: **32 passed**. El test nuevo de esta ficha toma
`serializarEscriturasReales` como PRIMERA sentencia de su transacción, igual que los otros 42 que
escriben en tablas reales.

---

## 6 — El contrato que hereda el frontend

- `verDetalleDeMovimientoAction(input, deps?)` y `verDetalleDeMiMovimientoAction(input, deps?)` —
  `input = { movimientoId, page?, pageSize? }`, `.strict()`. Estados: `ok` · `sin_reparto` ·
  `not_found` · `forbidden` · `unauthenticated` · `validation_error`.
- `verDetalleDeMovimientoCompletoAction` / `verDetalleDeMiMovimientoCompletoAction` —
  `input = { movimientoId }`. Estados: los de `ListarCompletoResult<OrdenAporteDTO>` (`ok` con
  `items`/`total`, `limite_excedido` con solo conteos, `ActionError`) **más** `sin_reparto`. Para
  usar `filasDesdeResultado` hay que descartar antes esa rama (una línea): un concepto sin reparto
  no tiene filas que descargar y su panel tampoco monta el control.
- Cada fila: `{ ordenId, guia, destinatario, tiendaNombre, resultados[], aporte }`. `aporte` es
  STRING escala 2 y se pinta tal cual. `resultados` trae **un valor por gestión** (una orden con dos
  gestiones trae dos), sin agrupar.
- El panel además recibe `monto` (el de la fila, para cotejar), `cierre.fecha` (ISO),
  `cierre.mensajeroNombre` (`null` en `/mi-wallet`), `total` (N) y `ordenesDelCierre` (M).
- **Los tres conceptos que no se desglosan** (`egreso_pago_mensajero`, `ingreso_cod_recaudado`,
  `egreso_indemnizacion`) devuelven `sin_reparto` con `motivo`, del catálogo
  `MOTIVO_SIN_REPARTO_SEED` (`snapshot_del_cierre`, `suma_del_libro_por_tienda`, `otro_productor`,
  `no_nace_de_un_cierre`). La fila **se abre** y dice de dónde sale su importe.
- Al montar los paneles hay que **borrar el `@sin-superficie`** de las cuatro acciones y sumar
  **+2/+2/+2** al censo de tablas (hoy 30 = 19 `con_descarga` + 11 `fuera`).

---

## 7 — Veredicto

Backend de la 344 **completo y verde**: el criterio vive en una sola tabla atada a
`derivarIngresoOrden` por 480 celdas de equivalencia, el cuadre y el alcance por tienda están
medidos contra Postgres con cuatro mutaciones que enrojecen, y el único rojo del árbol
(`obtenerTarifa`) ya venía de `dev`.
