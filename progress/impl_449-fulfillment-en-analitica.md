# 449 — el fulfillment no aparece en el dinero de Analítica (MITAD DE BACKEND)

Rama: `fix/449-fulfillment-en-analitica`, nacida de `origin/dev` = `94f58526`.
Alcance: **solo backend**. Ni un componente, ni una página, ni
`analitica-productos-descarga-columnas.ts`. El trabajo termina cuando la cifra VIAJA hasta el DTO.

## El agujero, y por dónde se tapa

`DineroProductosRepository` congelaba **nueve** columnas de tarifa y `tarifa_fulfillment` no era
una de ellas; `tarifaDe` tampoco la devuelve. La misma orden enseñaba el fulfillment en el detalle
del cierre (`COLUMNA_FULFILLMENT`) y lo escondía en Analítica.

**La restricción que manda:** `ITarifaVigenteRepository` prohíbe por escrito que el fulfillment
entre en `TarifaVigente`, «porque meterla la pondría al alcance de `derivarIngresoOrden`, y esa
función decide dinero que se liquida». Así que la cifra viaja en un **campo aparte** desde el
`SELECT` hasta el DTO. `TarifaVigente`, `tarifaDe` y `congeladaDe` quedan **intactos** (comprobado:
`git status` no los lista).

## Archivos

### Producción (4)

| archivo | qué cambia |
| --- | --- |
| `lib/interfaces/repositories/IDineroProductosRepository.ts` | `FilaDineroCruda.fulfillment: string \| null`, con los tres estados documentados |
| `lib/repositories/DineroProductosRepository.ts` | `d."tarifa_fulfillment"` al `SELECT` y a `FilaCruda`; `fulfillmentDe()` money-safe; se emite APARTE de `congelada` |
| `lib/types/conteo-productos.ts` | `DineroProductoDTO.fulfillment: string \| null`, al lado de `retorno` y FUERA del reparto |
| `lib/services/ConteoProductosService.ts` | `cifrasDelGrupo` agrega la cifra por `(tienda, producto)`; `fulfillmentDeOrden()` la cuenta UNA vez por orden; `OrdenQueAporta.gestiones` se estrecha a `FilaDineroCruda[]` |

### Tests (9)

| archivo | qué |
| --- | --- |
| `tests/unit/analytics/fulfillment-fuera-de-la-formula.guardia.test.ts` | **NUEVO** — la guardia del invariante (4 mitades + autocomprobación) |
| `tests/unit/analytics/dinero-productos-sql.test.ts` | proyección, money-safe y los dos `null` distinguibles |
| `tests/unit/analytics/conteo-productos-dinero.test.ts` | la agregación: suma, una vez por orden, R30, multiproducto, aislamiento |
| `tests/integration/repositories/dinero-productos.int.test.ts` | contra Postgres real: siembra con fulfillment + filas ajenas, y el cuadre en SQL a mano |
| `tests/unit/analytics/_dinero-falso.ts` | el fixture gana `fulfillment` (por defecto imita al repositorio) |
| `tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts` | fixture al día |
| `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` | fixture al día |
| `tests/components/ProductosTablaDinero.test.tsx` | fixture al día |
| `tests/components/descarga/ProductosDescargaColumnas.test.tsx` | fixture al día |

Los cuatro últimos son **solo fixtures**: `DineroProductoDTO` ganó un campo obligatorio y sin
ellos el typecheck queda rojo. No se tocó ni un componente ni la lógica de descarga.

## Decisiones que tomé yo (no venían en el encargo)

1. **La cifra cuelga del DTO al lado de `retorno`, no dentro de `liquidado`.** Dentro de
   `liquidado` vive la invariante R20 (`ordenex + tienda === recaudado`); un sumando nuevo ahí
   invita a romperla. `retorno` ya está fuera por un motivo del mismo tipo.
2. **Se cuenta UNA VEZ POR ORDEN, no por gestión ni por cierre.** `ordenex`/`tienda`/`retorno` se
   derivan por gestión porque la fórmula depende del `resultado`; el fulfillment no depende del
   resultado. El contrato público lo dice con todas las letras: el escenario devuelto cobra «el
   MISMO monto que en el escenario entregado: preparar y despachar el paquete ya costó, lo reciba
   el destinatario o no». Acumular por gestión multiplicaría una sola preparación por el número de
   intentos registrados. Cuando dos snapshots discrepan gana el PRIMERO (determinista: las filas
   llegan `ORDER BY o."id", g."id"`); elegir es preferible a sumar.
3. **Solo cuenta lo LIQUIDADO** (cierre aprobado + tarifa congelada), el mismo umbral que las otras
   cifras derivadas, por el motivo ya escrito en `ESTADO_CIERRE_LIQUIDADO`: un cierre solicitado se
   ha llegado a BORRAR en este repo, y con él su snapshot.
4. **Los tres estados del campo crudo**, escritos en el contrato:
   - `null` = **no se pudo leer**: la gestión no tiene fila de `cierre_detail`.
   - `"0.00"` = **no hay fulfillment**: la columna vale 0, **o** es `NULL` por ser una fila anterior
     al 2026-08-19 (sin backfill posible). Para una SUMA las dos son cero colones.
   - `"696.00"` = el monto congelado.
   Difiere a propósito de `TarifaSnapshotDTO`, que conserva el `null` porque MUESTRA la tarifa en
   vez de sumarla; está dicho en el comentario.
5. **`== null` y no `=== null`** al serializar, con el precedente de `tarifaDe` para
   `tarifa_especial`: una fila que no proyecte la columna llega `undefined` y con `===` reventaba
   un camino de dinero (lo descubrió un fixture existente, no una suposición).
6. **`aporteEsCero` NO cambia.** Una orden cuyo único aporte fuera el fulfillment se seguiría
   descartando. Hoy es inalcanzable —toda orden liquidada con tarifa tiene `ordenex > 0`— y
   tocarlo movería los cardinales de `ordenes` y rompería el cuadre del detalle. Queda anotado.
7. **`Prisma.Decimal` entra en `ConteoProductosService`** solo como acumulador, igual que ya hace
   `lib/utils/dinero-por-producto.ts`. No es una fórmula nueva.

## Mapa `R<n> → test`

Sin spec (`"sdd": false`), los requisitos salen del encargo y de la ficha.

| R | qué exige | test |
| --- | --- | --- |
| R1 | `tarifa_fulfillment` en el `SELECT` y en `FilaCruda`, y llega a `FilaDineroCruda` | `dinero-productos-sql.test.ts` › «la columna esta en el `SELECT`, con su alias»; `fulfillment-fuera-de-la-formula.guardia.test.ts` › (c) «PROYECTA …»; `dinero-productos.int.test.ts` › (449-a) |
| R2 | money-safe: `Decimal → string` escala 2, nunca `number` | `dinero-productos-sql.test.ts` › «money-safe · `Decimal(696)` …»; `dinero-productos.int.test.ts` › (k) |
| R3 | `NULL` y `0` = «no hay fulfillment», distinguibles de «no se pudo leer» | `dinero-productos-sql.test.ts` › «CON snapshot y columna `NULL` …», «SIN snapshot …», «y los dos estados son DISTINGUIBLES …»; `dinero-productos.int.test.ts` › (449-g) |
| R4 | la cifra llega al DTO agregada por `(tienda, producto)`, una vez por orden | `conteo-productos-dinero.test.ts` › bloque FICHA 449 (8 casos); `dinero-productos.int.test.ts` › (449-a), (449-b), (449-d), (449-e), (449-f) |
| R5 | invariante: el fulfillment NO entra en `TarifaVigente`/`tarifaDe`, ni se suma a `ordenex` | `fulfillment-fuera-de-la-formula.guardia.test.ts` (10 casos, mitades a/b/c/d + autocomprobación); `dinero-productos.int.test.ts` › (449-c), (449-h) |

## Las mutaciones — seis, todas en ROJO, con el mensaje real

Se aplicaron una a una sobre el árbol verde y se revirtieron desde copia.

**M1 (R1) · quitar `d."tarifa_fulfillment"` del `SELECT`** → 7 rojos.
```
× PROYECTA `tarifa_fulfillment` y la emite en su campo propio (la ficha esta hecha)
× la columna esta en el `SELECT`, con su alias
× (449-a) la cifra de bodega llega a la fila, y es la SUMA escrita a mano
AssertionError: expected '0.00' to be '2888.00'
AssertionError: expected '\n      SELECT o."id"             AS …' to contain 'd."tarifa_fulfillment"'
Tests  7 failed | 57 passed (64)
```

**M2 (R2) · `.toString()` en vez de `.toFixed(2)`** → 3 rojos.
```
× money-safe · `Decimal(696)` sale como `"696.00"`, STRING escala 2 y nunca number
× (k) R22 · todo importe que sale del repositorio es STRING escala 2
AssertionError: expected '696' to be '696.00'
AssertionError: expected '696' to match /^-?\d+\.\d{2}$/
Tests  3 failed | 51 passed (54)
```

**M3 (R3) · quitar la guarda `if (f.detalle_id === null) return null;` de `fulfillmentDe`** → 3 rojos.
```
× SIN snapshot -> `null`: ESE es «no se pudo leer», y NO es lo mismo que el cero
× y los dos estados son DISTINGUIBLES sobre las mismas dos filas
× (449-g) ⚠ `null` y `"0.00"` NO son el mismo hecho, medido contra Postgres
AssertionError: t347-3c8f0ba7-3f7: expected '0.00' to be null
AssertionError: expected '0.00' not to be '0.00'
Tests  3 failed | 51 passed (54)
```

**M4 (R4) · acumular por GESTIÓN en vez de una vez por orden** → 4 rojos.
```
× ⚠ UNA VEZ POR ORDEN · dos gestiones de la MISMA orden no cobran dos bodegas
× y tampoco dos veces cuando la orden esta en DOS cierres (R18)
× (449-a) la cifra de bodega llega a la fila, y es la SUMA escrita a mano
× (449-b) EL CUADRE CONTRA LA BASE, con un SQL escrito A MANO y su variante
AssertionError: expected '3584.00' to be '2888.00'
AssertionError: expected '1392.00' to be '696.00'
AssertionError: expected '1496.00' to be '696.00'
Tests  4 failed | 51 passed (55)
```

**M5 (R5-a) · sumar el fulfillment dentro de `liquidado.ordenex`** → 7 rojos, incluidos los cuadres
que ya existían antes de esta ficha.
```
× no esta dentro de `liquidado.ordenex`, y `ordenex + tienda === liquidado.recaudado`
× (h) R11/R14/R15/R19/R20/R21 · las cifras del grupo, CALCULADAS A MANO
× (j) R38/R40 · EL CUADRE — las CINCO aserciones sobre el detalle real
× (v4) EL CUADRE CONTRA LA BASE, con un SQL escrito A MANO y fuera del codigo de la ficha
× (449-c) ⚠ NO se suma a «Cobró Ordenex»: R20 sigue siendo EXACTA
AssertionError: expected '18030.00' to be '15142.00'
AssertionError: expected '4651.00' to be '3955.00'
Tests  7 failed
```

**M6 (R5-b) · meterlo en `TarifaVigente` y devolverlo desde `tarifaDe`** —la prohibición
literal— → 4 rojos, en las dos mitades de la guardia (ejecución y fuente) y en la integración.
```
× la `TarifaVigente` reconstruida NO tiene ninguna clave que lo nombre
× el cuerpo de `interface TarifaVigente` no nombra el fulfillment
× `tarifaDe` y `TarifaCongeladaRow` tampoco lo nombran en su fuente
× (449-h) ⚠ el fulfillment NO entra en la tarifa congelada de ninguna fila
AssertionError: 990002: expected [ 'fulfillment' ] to deeply equal []
AssertionError: expected true to be false
Tests  4 failed | 28 passed (32)
```

Ninguna mutación sobrevivió en verde.

## Gate

`./init.sh --rapido` **se negó solo**, como manda la regla 5, porque el diff toca `lib/types/`:

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/types/conteo-productos.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```
(`progress/gate_449_backend.log`)

Así que se corrió el **completo** (`progress/gate_449_backend_completo.log`):

```
✓ node v24.13.0
✓ dependencias: 58 declaradas, todas presentes
✓ feature_list.json: sin ids duplicados (444 fichas), cupo por zona respetado (in_progress=0)
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 195 archivos de tests contra Postgres SI se ejecutan
 Test Files  2053 passed (2053)
      Tests  29932 passed | 26 skipped (29958)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped`, mirados:** son **26**, y **ninguno es de base de datos** — el gate dice
`DATABASE_URL resuelta: los 195 archivos … SI se ejecutan`. Los 26 salen de dos archivos de
componentes que ya los traían (`AnaliticaPage.test.tsx` 17, `AnaliticaShell.test.tsx` 9). El test
de integración de esta ficha **corrió**: 22 casos, todos ejecutados contra Postgres.

`pnpm run lint`: **0 errores**, 202 warnings (todos `no-unused-vars` preexistentes, ninguno en
archivos de esta ficha).

## Veredicto

La cifra viaja del `SELECT` al DTO por un carril propio, el fulfillment sigue fuera del alcance de
`derivarIngresoOrden` con una guardia que lo demuestra por cuatro vías, y las seis mutaciones
mueren en rojo: listo para que el frontend lo pinte.
