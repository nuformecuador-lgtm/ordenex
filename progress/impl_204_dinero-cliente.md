# 204 — aritmética de dinero en el navegador (columnas de órdenes)

Rama `chore/204-dinero-cliente`. La ficha exigía **medir antes de arreglar**. Se midió. El
error es real y alcanzable con los datos que hay hoy en la base: **es ficha de corrección**,
no de blindaje. El blindaje también se hizo, porque la medición mostró que el barrido
existente no habría cazado este código ni censando el archivo.

---

## Fase 1 — la medición

### 1. Qué hacían exactamente las dos funciones

En `app/(app)/ordenes/_components/ordenes-columns.tsx`:

```ts
calcularFleteConIva:   flete * (1 + ivaFlete/100)
calcularComisionConIva: (montoCobrar * comisionCod/100) * (1 + ivaComisionCod/100)
```

Entradas, y con qué tipo llegan:

| dato | columna DB | cómo cruza al cliente |
|---|---|---|
| `valorFlete` / `valorFleteGam` | `DECIMAL(12,2)` | `toTarifaDTO`: `Decimal.toNumber()` → `number` |
| `ivaFlete`, `comisionCod`, `ivaComisionCod` | `DECIMAL(5,2)` (0..100) | igual, `number` |
| `montoCobrar` | `DECIMAL(12,2)` | `toListItemDTO`: `Decimal.toNumber()` → `number` |

Es decir: cuando el navegador operaba, los importes YA eran `double`. Después el resultado
pasa por `PriceLabel → formatMonto → monto.toFixed(2)`, que es donde se decide el céntimo.

El servidor, para la misma orden, hace otra cosa (`derivarIngresoOrden`,
`lib/utils/ingreso-ordenex.ts`):

```
flete    = round2(flete) + round2(flete · ivaFlete/100)          ← el IVA se redondea SOLO
comisión = round2(monto · comisionCod/100)                        ← la comisión se redondea…
           + round2( round2(monto · comisionCod/100) · ivaComisionCod/100 )   ← …ANTES del IVA
```

### 2. ¿Puede diferir? Sí, por DOS mecanismos distintos

**(a) El medio exacto que no existe en binario.** Cuando el importe cae justo en `x.xx5`,
`Prisma.Decimal` con `ROUND_HALF_UP` sube y el `double` casi siempre está por debajo del medio,
así que `toFixed(2)` baja.

```
monto 14900.00, comisión 3.50%, IVA 13%
  comisión exacta      = 521.5          IVA exacto = 67.795 → HALF_UP → 67.80
  SERVIDOR             = 589.30
  NAVEGADOR: 521.5 * 1.13 = 589.29499999999995907  → toFixed(2) → 589.29
  DIFERENCIA: -0.01
```

**(b) Doble redondeo — y éste ni siquiera es un problema de binario, es OTRA fórmula.** El
servidor redondea la comisión a 2 decimales ANTES de aplicarle el IVA; el navegador se lo
aplicaba a la comisión sin redondear.

```
monto 16618.40, comisión 3.50%, IVA 13%
  comisión exacta      = 581.644
  SERVIDOR: round2(581.644)=581.64 ; IVA=round2(75.6132)=75.61  → 657.25
  NAVEGADOR: 581.644 * 1.13 = 657.25772  → toFixed(2) → 657.26
  DIFERENCIA: +0.01
```

Barrido exhaustivo (2.000.000 de importes, de 0,01 a 20.000,00, `Prisma.Decimal` contra la
fórmula del navegador):

| camino | parámetros | importes que difieren |
|---|---|---|
| comisión | 2,50% + IVA 13% | 565.492 / 2.000.000 (28,3%) |
| comisión | 3,00% + IVA 13% | 565.397 (28,3%) |
| comisión | **3,50% + IVA 13% (la tarifa real)** | **564.833 (28,2%)** |
| comisión | 5,00% + IVA 13% | 564.984 (28,3%) |
| flete | IVA 13% | 19.698 (0,98%) — todos los fletes acabados en `.50` |
| flete | IVA 15% | 85.495 (4,3%) — los acabados en `.10/.30/.50/.70/.90` |
| flete | IVA 12% y 14% | **0** (esos porcentajes nunca producen un medio exacto) |

La desviación máxima medida es siempre **exactamente 0,01**, y va en los dos sentidos.

### 3. ¿Alcanzable con los datos reales? Sí — medido fila a fila contra la base

Base local (`localhost:5432/ordenex`), única tarifa `activo`:

```
valor_flete 3000.00 · valor_flete_gam 2000.00 · comision_cod 3.50
iva_flete 13.00 · iva_comision_cod 13.00
```

Cruzando cada orden viva con la tarifa activa de su tienda — **66 órdenes**:

- **Comisión + IVA: 14 de 66 filas se veían desviadas un céntimo.** Ejemplos reales, con su
  número de guía cuando lo tienen: `monto 14900.00 → cierre 589.30 / tabla 589.29`;
  `16618.40 → 657.25 / 657.26`; `guía 990015, 6500.00 → 257.08 / 257.07`;
  `12900.00 → 510.20 / 510.19`; `14618.40 → 578.15 / 578.16`.
- **Flete + IVA: 0 de 66.** El fallo está **latente**, no ausente: con `valorFlete` 3000.00 y
  2000.00 (redondos) los dos caminos coinciden, pero basta editar la tarifa a cualquier flete
  acabado en `.50` para que aparezca (`2500.50 al 13% → cierre 2825.57 / tabla 2825.56`). El
  formulario de tarifas acepta decimales (`z.number().nonnegative()`, `DECIMAL(12,2)`), así que
  está a una edición de distancia.

Los montos de la base no son todos redondos: hay `14618.40`, `16618.40`, `25.90`, `15260.00`.

### 4. ¿Sobrevive al formateo? Sí — nace en él

Toda la comparación de arriba se hizo sobre el STRING FINAL de 2 decimales, que es
exactamente lo que pinta `PriceLabel` (`formatMonto` → `monto.toFixed(2)` → agrupación de
miles). El redondeo no absorbe la diferencia: el redondeo es donde se decide.

### Veredicto de la fase 1

**Bug real, visible en pantalla y alcanzable hoy** en la columna "Comisión + IVA" (14 de 66
órdenes). **Latente pero a una edición de tarifa** en "Flete + IVA". Corrección, no blindaje.

---

## Fase 2 — lo que se hizo

**La derivación se movió al servidor y viaja como STRING.** No se reimplementó nada: la
función nueva llama a `derivarIngresoOrden` con `resultado: "entregada"`, que es lo que se le
factura a la tienda si la orden se entrega, así que el listado **no puede** divergir del cierre
por construcción.

### Archivos

| archivo | qué |
|---|---|
| `lib/utils/ingreso-ordenex.ts` | **+** `costosListadoOrden(tarifa, orden)` → `{ fleteConIva, comisionConIva }`, STRING escala 2. Envuelve `derivarIngresoOrden`. Sin tarifa → `"0.00"` (R9), nunca `null`. |
| `lib/repositories/OrdenRepository.ts` | **+** `toTarifaVigente` (la tarifa como STRING, para operar) y la derivación dentro de `toListItemDTO`. |
| `lib/types/orden.ts` | **+** `fleteConIva?: string` / `comisionConIva?: string` en `OrdenListItemDTO` (opcionales por el patrón aditivo del DTO). |
| `app/(app)/ordenes/_components/ordenes-columns.tsx` | **−** `calcularFleteConIva` y `calcularComisionConIva`. Las celdas pintan `row.fleteConIva` / `row.comisionConIva`. |
| `tests/unit/utils/ingreso-ordenex.test.ts` | **+** 18 casos con los números medidos + contraprueba. |
| `tests/unit/repositories/orden-repository.test.ts` | **+** 7 casos: los derivados entran por `Prisma.Decimal` y salen en STRING. |
| `tests/unit/components/ordenes-columns.test.tsx` | **+** 5 casos: la celda pinta el STRING y NO reacciona a la tarifa. |
| `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` | **NUEVO** — el blindaje. |

Se tocó `ordenes-columns.tsx` (archivo de UI) porque el encargo lo pedía explícitamente y
porque dejarlo fuera habría dejado la derivación duplicada y el bug vivo. El cambio es la
RETIRADA de aritmética, no un cambio de presentación: los mismos `PriceLabel`, el mismo
formato, la misma degradación a `₡0,00`.

### El blindaje, y por qué no bastaba con ampliar el censo

La ficha proponía, para la rama de blindaje, «ampliar el censo del barrido». **Se midió que no
habría servido**: el barrido money-safe existente persigue CONVERSIONES (`Number(`,
`parseFloat(`, `parseInt(`, `.toFixed(`) y el código viejo no tenía ninguna — los importes ya
llegaban como `number` y bastaba con multiplicarlos. Censar el archivo lo habría dejado en
verde con el bug dentro. Está comprobado en el propio test, ejecutando el código viejo contra
`LLAMADAS_PROHIBIDAS_EN_DINERO`: caza 0.

Por eso la guardia nueva afirma dos cosas: (1) el barrido de conversiones sobre las dos tablas
de órdenes, que ningún censo alcanzaba; y (2) la regla que sí muerde — **ningún archivo de
`app/(app)/ordenes/_components/**` ni de `app/(app)/recepcion-satelite/_components/**` puede
nombrar `valorFlete`, `valorFleteGam`, `valorFleteDevuelto`, `valorFleteDevueltoGam`,
`comisionCod`, `ivaFlete` ni `ivaComisionCod`**. Para recalcular en el navegador hay que
nombrarlos. Es auto-capturante (barre el árbol entero, no una lista), y no caza la CITA: el
docstring del archivo los nombra a propósito y el barrido es sobre el código sin comentarios.

Vive aparte de `liquidacion-money-safe.test.ts` a propósito: aquel declara «los archivos que la
feature 172 creó o modificó» y valida su censo contra los árboles de liquidación; meterle una
tabla de órdenes convertiría esa afirmación en mentira.

### Lo que NO se tocó

Las columnas `montoCobrar` y `fulfillment` siguen con `toValidNumber`. No son derivaciones:
son un `DECIMAL(12,2)` que solo se formatea, sin ninguna operación en medio, y ese viaje sí es
exacto — medido: `Number(s).toFixed(2) === s` para los 2.000.001 importes de 0,00 a 20.000,00 y
para `9999999999.99`, `1234567890.12`, `19999999999.98`. (`PriceLabel` convierte el STRING a
`number` internamente; por eso mismo es inocuo aquí, y por eso no se tocó su contrato, que la
feature 201 acaba de fijar y cuyo test exige `value="4500.5" → ₡4.500,50`.)

---

## Mapa requisito → test

La ficha no tiene spec (`sdd: false`). Los requisitos son los de su descripción:

| requisito | test |
|---|---|
| **R1** — la derivación ocurre en el SERVIDOR, con Decimal | `tests/unit/utils/ingreso-ordenex.test.ts` → «costosListadoOrden — comisión + IVA, con los montos reales» (6 casos) y «— flete + IVA» (4 casos) |
| **R2** — el listado no puede divergir del cierre | idem → «es EXACTAMENTE lo que factura el cierre: comisión + su IVA de derivarIngresoOrden» y «coincide con costoEnvioDeTarifa» |
| **R3** — el DTO entrega el STRING ya derivado | `tests/unit/repositories/orden-repository.test.ts` → «204: comisión + IVA de 14900.00 → '589.30'», «…16618.40 → '657.25'», «204: son STRING de escala 2» |
| **R4** — sin tarifa / sin comisión → `"0.00"`, no error ni `null` (R9) | `orden-repository.test.ts` → «204: sin tarifa activa…», «204: una orden que no cobra comisión…»; `ingreso-ordenex.test.ts` → «degradación y contrato de salida» (4 casos) |
| **R5** — el cliente PINTA y no calcula | `tests/unit/components/ordenes-columns.test.tsx` → «pinta el STRING derivado del servidor», «NO recalcula: con la MISMA tarifa…», «NO recalcula: destrozar la tarifa…» |
| **R6** — la corrección es REAL (los números cambian) | `ingreso-ordenex.test.ts` → «CONTRAPRUEBA: la fórmula del navegador difería» (5 casos `it.each` + flete + el caso que NO se movió) |
| **R7** — nadie vuelve a meter aritmética de dinero en estas tablas | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` (7 casos) |
| **R8** — el resto del listado intacto | `ordenes-columns.test.tsx` → «las otras dos columnas de dinero (monto y fulfillment) siguen intactas» + los 22 casos preexistentes del archivo, sin tocar |

## Mutaciones (que muerdan, no que existan)

| # | mutación | resultado |
|---|---|---|
| M1 | `costosListadoOrden` pasa a la fórmula del navegador (IVA sobre la comisión sin redondear) | **6 tests rojos** en `ingreso-ordenex.test.ts` + `orden-repository.test.ts` (`expected '578.16' to be '578.15'`) |
| M2 | el repo manda `fleteConIva` en el campo de la comisión | **4 tests rojos** en `orden-repository.test.ts` |
| M3 | vuelve `calcularComisionConIva` al componente | **6 rojos**: 4 en `ordenes-columns.test.tsx` (incluido el caso "bueno": pinta 589,29 donde el servidor dice 589,30) y 2 en la guardia (`una tabla de órdenes volvió a mirar la tarifa para operar con ella`) |

## Comandos

```
$ pnpm exec tsc --noEmit
(sin salida)

$ pnpm exec vitest run tests/unit/guards tests/components tests/unit
 Test Files  890 passed (890)
      Tests  11398 passed (11398)
   Duration  260.92s

$ pnpm run lint
✖ 60 problems (0 errors, 60 warnings)
(los 60 son `no-unused-vars` preexistentes en dobles de test; ninguno en los archivos tocados)
```

## Veredicto

El bug era real y estaba en pantalla: 14 de 66 órdenes de la base mostraban un céntimo distinto
del que factura el cierre; se movió la derivación al servidor y la tabla ahora solo pinta.
