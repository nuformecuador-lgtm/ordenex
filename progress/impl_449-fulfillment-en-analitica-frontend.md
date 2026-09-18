# 449 — el fulfillment no aparece en el dinero de Analítica (MITAD DE FRONTEND)

Rama: `fix/449-frontend`, nacida del commit de backend de esta misma ficha, `3e69ee10` (que a su
vez sale de `origin/dev` = `94f58526`). **No se tocó `lib/`**: la cifra ya llegaba al DTO; lo que
faltaba era ponerla delante de alguien y meterla en la descarga.

## Qué se pinta, y dónde

`DineroProductoDTO.fulfillment` llega agregado por `(tienda, producto)` con tres estados escritos
en el contrato: `null` = ninguna orden liquidada (no hay snapshot que leer), `"0.00"` = hay
liquidadas y ninguna cobró bodega, `"696.00"` = el monto.

Se pinta en **los dos sitios del detalle de la fila**, que es donde el resto del dinero ya vive:

1. **El bloque de la fila desplegada** (`ProductosTabla.DetalleDeFila`), junto a «Cobró Ordenex» y
   «Para la tienda». Sale del DTO **que ya está en pantalla**: abrir la fila no cuesta una consulta
   más, y la cifra aparece sin esperar a nada.
2. **La cabecera del panel de la 347** (`DineroProductoDetalle`), como **sexto** importe y pegada a
   «Flete por rechazo». Los dos sitios repiten rótulos a propósito desde la 442 —los totales del
   panel existen «para cotejar» (R38)— y la cifra nueva sigue esa misma regla.

**Sólo cuando el monto es > 0.** `null` y `"0.00"` no pintan «—»: **no pintan nada**. Es la
excepción declarada de esta cifra frente a sus cuatro hermanas, y el motivo está escrito en
`hayMonto`: la mayoría de las tiendas no tiene bodega contratada, así que para ellas el `"0.00"` es
CIERTO y se leería como un concepto que les aplica y les salió en cero. Una celda de ceros entre
cinco importes con dato no informa: estorba.

El predicado es **money-safe**: mira los dígitos del string (`/[1-9]/`), sin `Number(`,
`parseFloat(` ni aritmética. Es la misma técnica con la que `lib/config/moneda` decide si emitir la
cola de céntimos.

## Archivos

### Producción (3)

| archivo | qué cambia |
| --- | --- |
| `app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx` | `hayMonto` (exportado), el rótulo/pista `Fulfillment`, el sexto `ImporteCabecera` condicionado, y la rejilla que pasa de `xl:grid-cols-5` a `xl:grid-cols-6` **sólo cuando hay sexta celda** |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` | `IdDinero` gana `"fulfillment"`; `DeclaracionDinero.soloSiHayMonto`; `importeDeFila` lee la RAÍZ del DTO; `seDeclara` filtra el bloque de la fila; `PRODUCTOS_COLUMNAS.fulfillment`; entrada en `MIN_DINERO` |
| `app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts` | la **vigesimoprimera** columna (`fulfillment`, con la marca de no-sumable) y su celda en la proyección |

### Tests (2)

| archivo | qué |
| --- | --- |
| `tests/components/ProductosTablaDinero.test.tsx` | `describe("FICHA 449 …")` con 7 casos, y el barrido de R6 gana el rótulo nuevo |
| `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` | las dos aserciones de orden pasan de VEINTE a VEINTIUNA, la marca de importe de SEIS a SIETE, y 2 casos nuevos |

## La 442 dejó ese archivo de descarga byte a byte igual a `origin/dev`; ahora se toca

Y se toca **a sabiendas**: una descarga que omite una cifra que la pantalla enseña es el mismo
defecto una capa más abajo. La columna va **al final**, detrás de `retorno`: meterla en medio
correría de sitio a las que van detrás y una hoja o macro que lea por posición se rompería en
silencio — que es el motivo por el que la 347 descartó una columna por desenlace.

## Decisiones que tomé yo (no venían en el encargo)

1. **La cifra se pinta en los DOS sitios del detalle, no sólo en el panel.** El encargo nombraba
   `DineroProductoDetalle.tsx` «y lo que haga falta de `ProductosTabla.tsx`». Ponerla sólo en el
   panel la habría dejado detrás de una segunda consulta (SWR) cuando el dato YA está en el DTO de
   la fila: sería el mismo defecto de la ficha —la cifra existe y no se ve— con otra latencia. Los
   dos sitios ya repiten «Cobró Ordenex» y «Para la tienda» por diseño, así que no es un patrón
   nuevo.
2. **Se llama «Fulfillment», el nombre que la cifra YA tiene en el resto de la app**
   (`FULFILLMENT_COL`, los rótulos del cierre y las cinco descargas de gestiones). Esta ficha nace
   de que la MISMA orden enseñaba la cifra allí y la escondía aquí; bautizarla de nuevo dejaría el
   defecto en pie con otra cara. Hay **dos casos** que lo comparan contra esa constante —otra
   fuente, no la propia—, uno en pantalla y otro en el encabezado del archivo. Es la lección de la
   338 con «Flete por rechazo».
3. **La pantalla se calla el `"0.00"` y el archivo NO.** Asimetría decidida. En pantalla la celda es
   prescindible; en el `.xlsx` la columna existe igual para todas las filas y la celda vacía ya
   significa otra cosa (R70: «no se sabe»). Escribir el `"0.00"` es lo único que mantiene
   distinguibles «hubo liquidadas y ninguna cobró bodega» y «no hay snapshot» seis meses después,
   que es cuando se abre el archivo. **Lo vigila una mutación propia (M8).**
4. **Las dos clases de rejilla se escriben enteras y se eligen**, en vez de concatenar un
   `xl:grid-cols-6` condicional: dos utilidades del mismo grupo y el mismo prefijo no se acumulan
   (es el caso hermano de `flex-wrap md:flex-nowrap`, que en este repo NO funciona) y además
   Tailwind necesita las cadenas LITERALES en el fuente para generarlas.
5. **`MIN_DINERO.fulfillment = "6rem"`, el mismo que sus dos hermanas no-columna, y sin inventar un
   número.** Hoy nadie lo lee (no es columna). Lo que sí está medido es la comparación RELATIVA —ver
   abajo—: el rótulo no es el más ancho de los cuatro, así que el mínimo que ya sostiene a
   «Cobró Ordenex» sostiene a éste.
6. **No hay columna por orden en la tabla del panel.** `OrdenDineroDTO` no trae `fulfillment` y eso
   es de `lib/`, que no se toca. La cifra es del GRUPO, y en el grupo se lee.

## La red: 9 mutaciones, una por requisito, todas MUERTAS

Arnés con **autocomprobación** (`assert` de ancla única, parseo del resumen de vitest exigiendo
tests ejecutados > 0, y restauración del árbol comprobada byte a byte). Base verde antes de mutar:
47 y 27 casos.

| # | requisito | mutación | rojo real |
| --- | --- | --- | --- |
| M1 | la cifra SE PINTA con su monto | `hayMonto` → `return false` | `Unable to find an element with the text: Fulfillment` (3 rojos) |
| M2 | NO se pinta con `"0.00"` | `hayMonto` → `return valor !== null` | `expected <span …></span> to be null` … `Fulfillment` |
| M3 | NO se pinta con `null` | `hayMonto` → `valor === null \|\| /[1-9]/…` | `expected <span …></span> to be null` … `Fulfillment` |
| M4 | es cifra PROPIA, no trozo del reparto | `importeDeFila` lee `liquidado.ordenex` | `expected '₡6.215' to be '₡2.784'` (3 rojos) |
| M5 | el aviso de no-sumable va DESPUÉS | se borra el `<p>` del aviso del panel | `Unable to find an element with the text: Cada importe es el de la ORDEN completa…` |
| M6 | un solo nombre en toda la app | `"Fulfillment"` → `"Servicio de bodega"` | `expected 'Servicio de bodega' to be 'Fulfillment'` |
| M7 | la DESCARGA lleva la cifra | se borra la celda de la proyección | `expected undefined to be '2784.00'` (5 rojos) |
| M8 | la descarga ESCRIBE el `"0.00"` | se vacía el cero, como hace la pantalla | `expected null to be '0.00'` |
| M9 | la columna va AL FINAL | se inserta antes de `retorno` | el `toEqual` de las 21 claves, con `- "retorno"` / `+ "fulfillment"` |

## Medido en el navegador (Chromium headless, no «se ve bien»)

Harness con el CSS **real** de la app (`app/globals.css` compilado con `@tailwindcss/postcss`) y las
clases exactas del componente. El importe de prueba es `₡1.816.300`: el fulfillment de TODA la
historia medido en producción el 2026-09-17, o sea el peor caso realista.

**La cabecera del panel (R63 — el corte):**

| contenedor | celdas ANTES (5) | celdas DESPUÉS (6) | importe | `scrollWidth > clientWidth` |
| --- | --- | --- | --- | --- |
| 1102 px (el medido por la 442 a 1440) | 208 px | **170 px** | 84 px | **false** |
| 1440 px (a sangre) | 275 px | 227 px | 84 px | false |
| 358 px (a 390) | 358 px, 1 columna | 358 px, 1 columna | 84 px | false |
| 284 px (el hueco medido por la 343/344) | 284 px, 1 columna | 284 px, 1 columna | 84 px | false |

La celda más estrecha que el cambio produce es **170 px** y el importe más ancho ocupa **84**: cabe
dos veces. **Cero** desbordamiento horizontal del documento en los cuatro anchos.

**Lo que sí crece es el alto:** la cabecera pasa de **84 → 100 px** a 1102 (una pista más se pliega a
dos renglones) y de **404 → 504 px** a 390, donde la rejilla es de una columna y la celda nueva es un
renglón entero. A 284 px, de 420 → 520.

**El bloque de la fila** (`flex-wrap`, celdas de `min-w-24` = 96 px) **no crece nada** en los cuatro
anchos: 1 renglón a 1102 y 1440, 2 a 358, 3 a 284 — los mismos que antes, porque la sexta celda cabe
en el renglón que ya había. El importe ahí ocupa 65 px en 96; `cortado=false`.

**Los rótulos como `<th>`** (mismo `text-xs font-bold`, tipografía del sistema — por eso la lectura
válida es la RELATIVA, no el número absoluto): `Fulfillment` **57 px**, igual que `Recaudado` (57) y
menos que `Cobró Ordenex` (80) y `Para la tienda` (72).

## Gate

`./init.sh --rapido` **se negó solo**, igual que en la mitad de backend y por lo mismo: el diff
contra `merge-base(origin/dev, HEAD)` arrastra el `lib/types/conteo-productos.ts` del commit de
backend.

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/types/conteo-productos.ts
✗ esto exige el gate completo. Corre: ./init.sh
RAPIDO_EXIT=1
```

Así que el **completo** (`progress/gate_449_frontend.log`, sección 2):

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 195 archivos de tests contra Postgres SI se ejecutan
 Test Files  2053 passed (2053)
      Tests  29941 passed | 26 skipped (29967)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2053 ejecutado(s))
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped`, mirados y no sólo contados:** son **26** y salen de dos archivos que ya los traían
—`AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9)—, los mismos que documentó la mitad
de backend. **Ninguno es de base de datos**: el gate dice `DATABASE_URL resuelta`, así que los 195
archivos contra Postgres SÍ corrieron. El worktree nacía **sin `.env`** y sin él la integración se
salta entera diciendo «init OK» igual; se copió el `.env` del checkout principal antes de correr
nada (y sin él `prisma generate` ni siquiera arranca: `Cannot resolve environment variable:
DATABASE_URL`).

**+9 tests frente a la mitad de backend** (29932 → 29941): 7 del `describe` nuevo de pantalla y 2 de
la descarga. `pnpm run lint`: **0 errores**, 202 warnings, todos `no-unused-vars` preexistentes y
ninguno en archivos de esta ficha.

⚠ **El gate se corrió DOS VECES y el log es el de la segunda.** La primera terminó verde con los
mismos números, pero durante su fase de typecheck todavía se editó un comentario de
`ProductosTabla.tsx`: un gate que lee un árbol que se mueve no vale como veredicto, así que se
repitió entero sobre el árbol congelado.

## Veredicto

La cifra que el backend subió hasta el DTO ya se ve en pantalla y viaja en la descarga, aparece sólo
cuando dice algo, sigue fuera de «Cobró Ordenex», está cubierta por el aviso de no-sumable y no se
corta a ningún ancho medido.
