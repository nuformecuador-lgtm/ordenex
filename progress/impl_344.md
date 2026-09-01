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

---
---

# Ficha 344 — bitácora de implementación: FRONTEND (bloques B6–B9)

> Tanda de **frontend**. No se ha tocado ningún servicio, repositorio ni schema: lo único que se
> editó bajo `lib/` fueron **cuatro docstrings**, para borrar el `@sin-superficie` que el backend
> dejó con instrucciones de borrarlo al cablear.

---

## 8 — Archivos

### Nuevos

| archivo | qué es |
| --- | --- |
| `app/(app)/wallet/_components/detalle-movimiento-labels.ts` | textos y nombres accesibles del panel de la caja + `resultadosTexto` |
| `app/(app)/wallet/_components/detalle-movimiento-descarga-columnas.ts` | las 5 columnas del archivo de la caja y su proyector |
| `app/(app)/wallet/_components/DetalleMovimientoCierre.tsx` | el panel de la caja: SWR + `DataTable` + `Pagination` + descarga |
| `app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts` | sus textos, **sin frase de mensajero** (R15) |
| `app/(app)/mi-wallet/_components/detalle-mi-movimiento-descarga-columnas.ts` | las 4 columnas del archivo de la tienda |
| `app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx` | el panel de la tienda |
| `hooks/useAnchoDelScrollHorizontal.ts` | el ancho VISIBLE del contenedor con scroll horizontal (ver § 12) |
| `tests/components/DetalleMovimientoCierre.test.tsx` | 26 casos (R1–R14, R20, R25, R28, R31, R33, R42, R45, R47–R52) |
| `tests/components/DetalleMiMovimientoCierre.test.tsx` | 21 casos, el espejo de la tienda + los dos de R15 |
| `tests/unit/descarga/detalle-movimiento-descarga-columnas.test.ts` | el `toEqual` de contrato de la caja (R35/R36/R37) |
| `tests/unit/descarga/detalle-mi-movimiento-descarga-columnas.test.ts` | el de la tienda |

### Modificados

| archivo | cambio |
| --- | --- |
| `app/(app)/wallet/_components/WalletLedger.tsx` | `renderExpanded` + `expandAriaLabel`; `naceDeUnCierre` para R6. **Las columnas visibles no se tocan.** |
| `app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx` | lo mismo, en el libro de la tienda |
| `lib/actions/wallet.ts` | **borrados los DOS `@sin-superficie`**, sustituidos por la superficie viva que los reemplaza |
| `lib/actions/wallet-tienda.ts` | ídem, los otros dos |
| `tests/unit/descarga/censo-tablas.ts` | + las DOS tablas nuevas, las dos `con_descarga`, con su motivo |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | 29→31 archivos, 29→31 instancias, 30→32 censadas, 19→21 `con_descarga` |
| `tests/components/descarga/WalletDescarga.test.tsx` | el conteo de encabezados del libro pasa de 7 a 8: la columna «Desglose» que ANTEPONE la primitiva. Ninguna columna de datos se mueve, y la de más se nombra aparte. |

---

## 9 — Las tres decisiones de esta tanda

### 9.1 — El nombre accesible se compone con el CONCEPTO y la FECHA de la fila (R5)

`Ver las órdenes que componen Flete del 2026-08-13`. El botón que antepone `DataTable` no lleva
texto visible (sólo el chevron), así que ése es su único nombre; el panel, su tabla, su paginación
y su control de descarga se nombran con los mismos dos datos. El libro tiene decenas de filas
abribles: un «Ver detalle» repetido no identificaría ninguna.

### 9.2 — `sin_reparto` NO viaja como error

El fetcher devuelve `{ modo: "ok" | "sin_reparto" }` y sólo lanza para `not_found`, `forbidden`,
`unauthenticated` y `validation_error`. Tratar `sin_reparto` como error dejaría el panel diciendo
«no se pudo cargar», que es exactamente la fila muda que R48 prohíbe. El panel de un concepto sin
reparto **no monta tabla ni control de descarga**: no promete un desglose que no existe.

La descarga descarta esa rama en UNA línea antes de `filasDesdeResultado`, como dejó escrito el
backend, y si llegara devuelve el MOTIVO en vez de un error genérico.

### 9.3 — El importe del movimiento SÍ se pinta en la cabecera del panel

Es el `monto` que el backend manda «para poder cotejar», rotulado «Importe del movimiento: ₡…».
No es un subtotal de página (R47): es el mismo dato que la fila de arriba ya muestra, y el caso de
R47 afirma que dentro del `<tbody>` hay exactamente tantos importes como órdenes.

---

## 10 — Mapa `R<n> → test` (lo que ESTA tanda cubre)

| R | Test |
| --- | --- |
| R1 | `DetalleMovimientoCierre.test.tsx` › al abrir una fila de cierre se muestran las órdenes que componen su importe |
| R2 | › con el libro pintado y sus filas cerradas no se lee ningún detalle |
| R3 | › abrir una fila cuesta exactamente UNA lectura, y sólo de esa fila |
| R4 | › dos filas abiertas mantienen páginas independientes |
| R5 | › el control de abrir nombra SU fila, no un genérico repetido |
| R6 | › una fila que no nace de un cierre NO ofrece control de apertura |
| R7 | › un fallo de lectura se cuenta DENTRO de la fila y el libro sigue en pie |
| R8 | › un detalle sin órdenes muestra su estado vacío explícito |
| R9/R12 | › la cabecera dice la fecha del cierre, el mensajero y el «N de M» |
| R10/R13/R14 | › cada orden muestra guía, destinatario, tienda, resultado y aporte |
| R11 | › cada orden lleva enlace al listado de órdenes con SU guía |
| R15 | `DetalleMiMovimientoCierre.test.tsx` › con el payload del contrato no hay rastro de mensajero · › **aunque el payload TRAJERA el nombre, esta pantalla no lo pinta** |
| R20 | › una orden con DOS gestiones sale UNA vez y nombra los dos resultados |
| R25/R28 | › el total es el del CONJUNTO y se puede navegar a la página siguiente |
| R31 | › el panel monta su control de descarga, con el nombre de SU fila |
| R33 | › la descarga sale de la LECTURA DEDICADA y el navegador no recorta nada |
| R35 | `detalle-movimiento-descarga-columnas.test.ts` › declara sus columnas ENUMERADAS, en el orden de la pantalla (y su gemelo de la tienda) |
| R36 | › no expone ningún identificador interno — ni el de la orden |
| R37 | › emite el aporte TAL CUAL, sin recalcularlo ni adornarlo |
| R42 | `DetalleMovimientoCierre.test.tsx` › el input de la lectura son DOS claves y ninguna más |
| R45 | › ninguna fuente nueva del panel opera con dinero (barrido sobre las SEIS) |
| R47 | › el panel no pinta ningún subtotal de la página visible |
| R48/R49 | › la fila se abre IGUAL y el panel dice de dónde sale ese importe · › los TRES conceptos sin reparto tienen frase propia |
| R50 | › el aporte se lee ENTERO — `₡1.700`, `₡3.400` y `₡10.200` · › **el panel se ACOTA al hueco visible del libro** + la medición en Chromium (§ 12) |
| R51 | › la celda del aporte no lleva ninguna clase que trunque ni abrevie |
| R52 | › apilar cuatro columnas en una no esconde NINGÚN dato |

---

## 11 — Las mutaciones de esta tanda, con su salida REAL

> Las tres que exigía el encargo, más una cuarta que exige el arreglo de móvil. Cada una se
> aplicó, se corrió, se leyó su rojo y se revirtió.

### 11.1 — Que una fila `sin_reparto` se quede MUDA

Se sustituyó el párrafo del motivo por un `<p />` vacío.

```
 tests/components/DetalleMovimientoCierre.test.tsx (24 tests | 2 failed | 22 skipped)
     x R48: la fila se abre IGUAL y el panel dice de dónde sale ese importe 1192ms
     x R48/R49: los TRES conceptos sin reparto tienen frase propia, ninguno queda mudo 1076ms

TestingLibraryElementError: Unable to find an element with the text:
  /el total que el cierre del día dejó anotado/
  <section aria-label="Órdenes que componen Flete del 2026-08-14" …>
    <p class="text-muted-foreground" />
  </section>
```

Revertida → 2 passed.

### 11.2 — Que `/mi-wallet` pinte el nombre del mensajero

Se añadió al panel de la tienda la línea del mensajero que sí tiene el de la caja.

```
 tests/components/DetalleMiMovimientoCierre.test.tsx (21 tests | 1 failed | 19 skipped)
     x R15: aunque el payload TRAJERA el nombre, esta pantalla no lo pinta 97ms

AssertionError: expected 'Cierre del día 2026-08-14Mensajero: K…' not to contain
  'Kevin Solano Ramírez'
Received: "Cierre del día 2026-08-14Mensajero: Kevin Solano Ramírez1 de 9 órdenes tuyas del
  cierre aportan a este conceptoImporte del movimiento: ₡28.800DescargarGuía…"
```

**Y aquí hay un hallazgo que cambió el test.** El primer caso de R15 —el que usa el payload del
contrato, con `mensajeroNombre: null`— **sobrevivió en verde**: con `null` no se pinta de todas
formas. Por eso hay un SEGUNDO caso que fuerza el nombre en el payload: el servidor manda `null`
HOY, y la pantalla tiene que seguir callada aunque mañana ese `null` se rompa. Revertida → verde.

### 11.3 — Que el total salga de `items.length`

`const total = payload?.total ?? 0` → `const total = ordenes.length`, en los DOS paneles.

```
 tests/components/DetalleMovimientoCierre.test.tsx + DetalleMiMovimientoCierre.test.tsx
     x R4: dos filas abiertas mantienen páginas independientes            (x2, uno por libro)
     x R25/R28: el total es el del CONJUNTO y se puede navegar a la página siguiente
     x R25/R28: el total es el del CONJUNTO, no el largo de la página

AssertionError: expected "vi.fn()" to be called 3 times, but got 2 times
TestingLibraryElementError: Unable to find an element with the text: 1-25 de 28
      Tests  4 failed | 41 passed (45)
```

Revertida → 45 passed. (Con la mutación la barra decía «1-25 de 25» y «Página siguiente» quedaba
deshabilitada: nadie llegaría nunca a las tres órdenes restantes.)

### 11.4 — Quitar el acotamiento de ancho en móvil (el arreglo de § 12)

Se borró el `style={estiloAcotado}` de la sección del panel de la caja.

```
 tests/components/DetalleMovimientoCierre.test.tsx (26 tests | 1 failed)
     x R50: en móvil el panel se ACOTA al hueco visible del libro y se pega a su borde 115ms

AssertionError: expected '' to be '308px' // Object.is equality
```

Revertida → 26 passed.

---

## 12 — El navegador de verdad (T9.1/T9.2), y lo que encontró

### 12.1 — La base local NO tiene con qué llenar el panel, y está medido

Los 19 movimientos de cierre de `/wallet` abren su panel, pero **ninguno de los repartibles trae
órdenes**: dicen «0 de 1», «0 de 2», «0 de 12». La causa se midió contra la base local en SOLO
LECTURA:

```
cierres con al menos una gestion ENTREGADA: 0
movimientos de caja con origen cierre: 19

MOV …e9de742 monto 2000  cierre f4c93d88…  cierre_detail: 1   gestion_orden del cierre: 0
MOV …c850a78 monto 4000  cierre 942993c5…  cierre_detail: 2   gestiones: 2 (las dos reprogramada)
MOV …4ebc2fd monto 12000 cierre 70ebf5e2…  cierre_detail: 12  gestiones: 13 (reprogramada/devuelta/rechazada)
  con tarifa congelada: 12 | count con el WHERE del repositorio: 0
```

**No es un fallo del código**: `ingreso_flete` exige `resultado = 'entregada'`, y en esta base no
existe **ni una** gestión entregada ligada a un cierre. Los movimientos de wallet locales no los
produjo el feed a partir de esas gestiones — están sembrados aparte. El `count` con el `WHERE` del
repositorio da 0, que es exactamente lo que la pantalla enseña.

Sembrar una gestión `entregada` para poder ver filas **quedó bloqueado** (la escritura contra la
base local no está autorizada en este modo). Por eso la medición de abajo se hizo **reescribiendo
el array `ordenes` de la respuesta REAL de la Server Action** con `page.route`: el componente
recorre su camino completo —SWR, fetcher, render, juego de columnas de móvil, `money`— y lo único
sustituido son los datos que la base local no puede dar. Los anchos, el CSS y el viewport son los
de la aplicación de verdad.

### 12.2 — EL DEFECTO QUE APARECIÓ, y no lo habría visto ninguna prueba en memoria

A 390x844, con el juego de columnas de móvil ya funcionando:

```
===== /wallet telefono (390x844) =====   [ANTES del arreglo]
encabezados: ["Orden","Aporte"]
ancho seccion: 1080 | contenedor de scroll de la tabla del PANEL: client=1054 scroll=1054 DESBORDE=0
  fila 0: APORTE="₡1.700"      x=[1064,1108] ventana=390 dentroDeLaVentana=false RECORTADO_EN_SU_CAJA=false
  fila 1: APORTE="₡3.400"      x=[1059,1108] ventana=390 dentroDeLaVentana=false
  fila 2: APORTE="₡10.200"     x=[1055,1108] ventana=390 dentroDeLaVentana=false
  fila 3: APORTE="₡1.234.568"  x=[1035,1108] ventana=390 dentroDeLaVentana=false
flechas de scroll DENTRO del panel: 0
libro de FUERA: {"client":308,"scroll":1104,"desborde":796}
```

Las tres medidas que pedía `tasks.md § T9.1` salían **bien**: el texto de cada celda es el del
payload, el desborde del panel es **0** y no aparecen flechas. Y aun así **el importe no se podía
leer**: el panel vive dentro de una celda del libro, y el libro declara anchos mínimos por columna
que suman ~1.104 px, así que la sección heredaba **1.080 px** en un hueco visible de **308**. La
columna del aporte —la última— aterrizaba **674 px fuera del área visible**. El número estaba
entero en el DOM y hacía falta arrastrar el libro entero de lado para verlo. Es el mismo modo de
fallo de la ficha 343 (allí, 25 px), un orden de magnitud peor, y la causa NO era el juego de
columnas: era el ancho heredado.

**El arreglo** (`hooks/useAnchoDelScrollHorizontal.ts`): en móvil el panel se acota al
`clientWidth` del contenedor con scroll que lo contiene (`max-width`, que sólo puede ENCOGER) y se
pega a su borde izquierdo (`position: sticky; left: 0`). Medido después:

```
===== /wallet telefono (390x844) =====   [DESPUÉS]
ancho seccion: 308 | contenedor de scroll de la tabla del PANEL: client=282 scroll=282 DESBORDE=0
  fila 0: APORTE="₡1.700"      x=[292,336] ventana=390 dentroDeLaVentana=true RECORTADO_EN_SU_CAJA=false
  fila 1: APORTE="₡3.400"      x=[287,336] ventana=390 dentroDeLaVentana=true
  fila 2: APORTE="₡10.200"     x=[283,336] ventana=390 dentroDeLaVentana=true
  fila 3: APORTE="₡1.234.568"  x=[263,336] ventana=390 dentroDeLaVentana=true
flechas de scroll DENTRO del panel: 0
```

Y con el libro **arrastrado 600 px a la derecha** el importe SIGUE dentro de la ventana
(`x=[280,324]`), que es lo que aporta el `sticky` frente a un `max-width` a secas — se comprobó
también la variante sin `sticky` y sólo funciona con el libro sin desplazar.

### 12.3 — El texto EXACTO de cada celda de aporte, leído en pantalla

| ancho | `/wallet` | `/mi-wallet` |
| --- | --- | --- |
| 1440x950 | `₡1.700` · `₡3.400` · `₡10.200` · `₡1.234.568` | `₡1.700` · `₡3.400` · `₡10.200` · `₡1.234.568` |
| 1024x900 | `₡1.700` · `₡3.400` · `₡10.200` · `₡1.234.568` | `₡1.700` · `₡3.400` · `₡10.200` · `₡1.234.568` |
| **390x844** | **`₡1.700` · `₡3.400` · `₡10.200` · `₡1.234.568`** | **`₡1.700` · `₡3.400` · `₡10.200` · `₡1.234.568`** |

Ninguna celda recortada en su caja a ningún ancho (`RECORTADO_EN_SU_CAJA=false` en las 24
medidas), y las clases de la celda son siempre
`px-3 py-2 align-middle text-right tabular-nums whitespace-nowrap` — sin `truncate`, sin
`line-clamp`, sin `overflow-hidden`.

Las cabeceras leídas en pantalla:

```
/wallet     1440/1024: ["Guía","Destinatario","Tienda","Resultado","Aporte"]   390: ["Orden","Aporte"]
/mi-wallet  1440/1024: ["Guía","Destinatario","Resultado","Aporte"]            390: ["Orden","Aporte"]

/wallet    : "Cierre del día 2026-08-13 · Mensajero: Marco Mensajero · 28 de 23 órdenes del
              cierre aportan a este concepto · Importe del movimiento: ₡2.000"
/mi-wallet : "Cierre del día 2026-08-13 · 28 de 23 órdenes tuyas del cierre aportan a este
              concepto · Importe del movimiento: ₡2.000"        <- SIN mensajero (R15), en vivo
paginación : "1-25 de 28"                                        <- el total del servidor
```

(El «28 de 23» es artefacto de la reescritura del payload, no de la pantalla: se inyectaron 4
órdenes con `total: 28` sobre un cierre de 23.)

### 12.4 — La franja de 768 a 1279 px, declarada y NO tapada

A 1024 el panel de `/wallet` sigue heredando 1.080 px y el libro pide **418 px** de arrastre: el
aporte queda en `x=[1291,1364]` con una ventana de 1024. **No se acota ahí a propósito**: meter
las CINCO columnas de escritorio en 686 px cambiaría un problema por otro (el panel pasaría a
desbordar por dentro). Es la misma deuda que `specs/343` declaró para su banda, y el corte
correcto sería por ancho de CONTENEDOR (`@container`), no por viewport. `/mi-wallet` **no** la
sufre: a 1024 su libro no desborda (`desborde: 0`) y las cuatro celdas están dentro.

### 12.5 — T9.2: el enlace a la orden y la descarga

```
ENLACES del panel: [{"nombre":"Ver en órdenes la guía 990003","href":"/ordenes?q=990003"}, …]
tras el enlace -> http://localhost:3004/ordenes?q=990003
termino en el buscador: "990003"     <- la orden llega filtrada

con una guía de 1 dígito (/ordenes?q=7): "Escribe al menos 3 caracteres para buscar"
   <- el caso borde Q4, heredado: lo dice POR ESCRITO, no falla en silencio

control de descarga: "Descargar Órdenes que componen Flete del 2026-08-13"
ARCHIVO: ordenes-que-componen-flete-del-2026-08-13-2026-08-31.xlsx
```

Antes de pulsar, la lectura del conjunto **no se llama ni una vez** (afirmado también en el test
de R33).

### 12.6 — Un tropiezo de entorno, para quien vuelva

El servidor de `localhost:3004` estaba levantado desde ANTES del commit del backend y respondía
**404 «Failed to find Server Action»** a las cuatro acciones nuevas. Se reinició (`rm -rf .next` +
`next dev -p 3004`). Tras el reinicio, la PRIMERA visita a una ruta recién compilada vuelve a dar
ese 404 —el navegador recibe chunks de una compilación anterior—; la segunda pasada ya va bien. En
los scripts de medición se resuelve con un `page.reload()` tras el primer `goto`. **No dejar
ficheros nuevos en la raíz del repo mientras se mide**: el watcher recompila y vuelve a invalidar
los ids de las acciones.

---

## 13 — Verificación de esta tanda

```
$ pnpm typecheck   (npx tsc --noEmit)
TYPECHECK_EXIT=0     (0 líneas de salida)

$ pnpm lint        (npx eslint .)
LINT_EXIT=0
143 problems (0 errors, 143 warnings)   <- el MISMO conteo que la tanda de backend;
                                           ninguna advertencia cae en un archivo nuevo
```

### Los tests por nombre

```
$ npx vitest run tests/components/DetalleMovimientoCierre.test.tsx \
    tests/components/DetalleMiMovimientoCierre.test.tsx
 Test Files  2 passed (2)      Tests  47 passed (47)

$ npx vitest run tests/unit/descarga/detalle-movimiento-descarga-columnas.test.ts \
    tests/unit/descarga/detalle-mi-movimiento-descarga-columnas.test.ts
 Test Files  2 passed (2)      Tests  17 passed (17)
```

### Los vecinos y las guardias que esta tanda mueve

```
$ npx vitest run  (los 20 archivos tocados o vecinos: los dos paneles, los dos módulos de
                   columnas, las cuatro guardias de descarga, la paginación transversal,
                   WalletDescarga, ControlDescargaTransversal, la guardia 335 de mi-wallet,
                   los tres tests del libro de caja, la barra de composición, las dos páginas
                   de integración, los contadores de cabecera y el panel de la 343)
 Test Files  20 passed (20)    Tests  225 passed (225)

$ npx vitest run tests/unit/descarga tests/unit/guards
 Test Files  1 failed | 139 passed (140)
      Tests  1 failed | 1761 passed (1762)
```

**El único rojo NO es de esta ficha y ya venía de `dev`**, el mismo que anotó la tanda de backend:

```
 FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
 + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

Las **cuatro** Server Actions de la 344 **salieron de esa lista** al cablearse sus consumidores, y
la otra mitad de la guardia —la que falla cuando una anotación `@sin-superficie` sobrevive a su
motivo— pasa: los cuatro `@sin-superficie` están borrados.

### Los censos, antes y después

| medida | antes | después |
| --- | --- | --- |
| archivos con `<DataTable>` | 29 | **31** |
| instancias de `<DataTable>` | 29 | **31** |
| tablas censadas | 30 | **32** |
| `con_descarga` | 19 | **21** |
| `fuera` | 11 | 11 (sin cambio) |

La guardia se vio **fallar primero**, que es la convención escrita en su propio archivo:

```
AssertionError: hay tablas sin registrar en tests/unit/descarga/censo-tablas.ts:
+ [ "app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx #1",
+   "app/(app)/wallet/_components/DetalleMovimientoCierre.tsx #1" ]
```

Y la de aserciones de orden también, antes de escribir los dos `toEqual` a mano:

```
AssertionError: estas listas de columnas descargables no tienen ninguna aserción de orden que
las NOMBRE: + [ "COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO (…)",
                "COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO (…)" ]
```

El censo transversal de paginación sigue en su igualdad exacta (ninguna constante nueva con el
prefijo `PAGINACION_*_LABEL`), la de columnas sensibles descubre los dos módulos por convención y
pasa, y la del adaptador de conjunto sigue en cero llamadas a la relectura.

---

## 14 — Lo que queda dudoso

1. **El cuadre no se pudo ver en pantalla.** La base local no tiene ni una gestión `entregada`
   ligada a un cierre (§ 12.1), así que ningún panel enseñó una suma real que cotejar contra el
   importe de su fila. Eso lo cubre el test contra Postgres del backend, pero **no se ha visto con
   datos de verdad**; en cuanto haya un cierre con entregas —o autorización para sembrar una— hay
   que abrir una fila y comprobar que la suma de aportes es el importe de la fila.
2. **La franja 768–1279 px** (§ 12.4) sigue con el aporte fuera de la ventana en `/wallet`. Está
   medido y declarado, no tapado; el arreglo correcto es un corte por ancho de CONTENEDOR.
3. **La descarga se ejercitó con un payload reescrito.** El archivo se produjo con el nombre
   correcto y el control se comporta como debe, pero las CELDAS del `.xlsx` no se abrieron: lo que
   fija su contenido son los dos `toEqual` escritos a mano y el caso de `"1000.10"`.
