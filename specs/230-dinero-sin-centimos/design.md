# Feature 230 — El dinero se pinta sin céntimos · design.md

> El **cómo** técnico. Cubre `requirements.md` R1–R20. Incluye las alternativas descartadas (§7),
> que es requisito de `docs/specs.md`.

---

## §0 Resumen en una pantalla

- **Es un cambio de PRESENTACIÓN y solo de presentación.** Sin migración, sin endpoint nuevo, sin
  cambio de DTO, sin RLS que revisar.
- **El formato tiene un único punto de paso:** `formatMontoString()` en `lib/config/moneda.ts` (lo
  consolidó la feature 201). Todo el dinero de la app entra por ahí.
- **Cambian 4 archivos de producción, y no hay un quinto** (§4).
- **El redondeo se hace sobre el STRING**, con acarreo manual, sin convertir a número en ningún
  momento (§2). No es purismo: hay **tres guardias vivas** que lo prohíben y el repo ya perdió un
  céntimo por una conversión.
- **El coste no está en el formateador**, está en lo que lo afirma: **276 aserciones en 265 líneas
  de 39 archivos de test** dicen hoy un importe con dos decimales (§9 y `tasks.md` bloque 5).
- **Una guardia nueva** es lo que impide que esto se deshaga (§6).

---

## §1 Por qué NO se tocan los 128 consumidores

```
                        money(value: string|null)  ──┐
   7 archivos de labels ──re-exportan──> money       │
                                                     ├──> formatMontoString(value, sinMonto)
                        formatMonto(n: number|null) ─┘        (lib/config/moneda.ts)
                              ↑
                     PriceLabel · KpiValorAnimado · analytics/formato.ts
```

Medido: 128 archivos consumen `money`, 18 `formatMonto`, 5 `PriceLabel`, y los 7 archivos de labels
(`wallet`, `wallet/mensajeros`, `mi-wallet`, `mis-pagos`, `ranking`,
`components/shared/liquidacion/liquidacion-labels.ts`,
`app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`) **re-exportan** `money` desde
`@/lib/config/moneda`. **Ninguno se toca: heredan.** Cambiar el punto de paso los cambia a todos, y
esa es exactamente la razón por la que la 201 lo consolidó.

---

## §2 El algoritmo: redondear el STRING, con acarreo manual

### 2.1 La restricción que gobierna el diseño

`Number(`, `parseFloat(` y `parseInt(` están **prohibidos** en el camino del dinero por tres guardias
vivas:

- `tests/unit/guards/liquidacion-money-safe.test.ts`
- `tests/unit/guards/pagos-aritmetica-decimal.guardia.test.ts`
- `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts`

más el barrido compartido de `tests/fixtures/money-safe.ts`. Y el propio módulo tiene un test que
afirma que **no llama a ninguna de las tres** (`tests/unit/config/moneda-formato.test.ts:238`), con
contraprueba incluida. Por tanto: **nada de `Math.round`, nada de `Number`, nada de `Decimal.js` en
el navegador.**

### 2.2 Las dos funciones nuevas, privadas del módulo

```ts
// Suma 1 a una parte entera representada como STRING, con acarreo manual.
// "999" -> "1000" | "9" -> "10" | "999999" -> "1000000" | "0" -> "1"
function sumarUno(enteros: string): string

// Devuelve la parte entera YA redondeada según D1 (half away from zero).
// Mira SOLO el primer dígito decimal: >= '5' sube, si no baja (R6).
function redondearEnteros(enteros: string, decimales: string | null): string
```

`sumarUno` recorre el string **de derecha a izquierda**: cada `'9'` se convierte en `'0'` y arrastra
el acarreo; el primer dígito distinto de `'9'` se incrementa y corta. Si al terminar queda acarreo,
antepone `'1'` — ése es el caso que **cambia el número de dígitos** y, por tanto, la agrupación
(R3), y por eso el redondeo va **antes** de `agruparMiles`, nunca después.

### 2.3 El nuevo flujo de `formatMontoString`

1. Ausencia (`null`, vacío, en blanco) → marcador. **Sin cambio** (R9).
2. `trim`. **Sin cambio.**
3. `FORMA_DECIMAL` no casa → `símbolo + texto` verbatim. **Sin cambio** (R8, y ver C2 en §6.4).
4. Separar signo y partir por el punto. **Sin cambio.**
5. **NUEVO:** `enteros = redondearEnteros(enteros, decimales)`; los decimales se **descartan**.
6. `agruparMiles(enteros)` sobre la parte ya redondeada.
7. **NUEVO:** si el resultado es cero, el signo **se cae** (R4: `-0,49 → ₡0`, nunca `-₡0`).
8. `signo + símbolo + agrupado`.

`monedaConfig.separadorDecimal` deja de usarse en el paso 6 — es el único uso de producción que
tiene, y de ahí la pregunta abierta **Q1**.

### 2.4 Tabla de contrato (entrada → salida), con la configuración por defecto

| Entrada | Hoy | Tras la 230 | Requisito |
| --- | --- | --- | --- |
| `"13331832.72"` | `₡13.331.832,72` | `₡13.331.833` | R2 |
| `"1234.49"` | `₡1.234,49` | `₡1.234` | R2 |
| `"1234.50"` | `₡1.234,50` | `₡1.235` | R2 |
| `"-4500.50"` | `-₡4.500,50` | `-₡4.501` | R2, R10 |
| `"999.50"` | `₡999,50` | `₡1.000` | R3 |
| `"9.99"` | `₡9,99` | `₡10` | R3 |
| `"999999.99"` | `₡999.999,99` | `₡1.000.000` | R3 |
| `"-0.49"` | `-₡0,49` | `₡0` | R4 |
| `"-0.00"` | `-₡0,00` | `₡0` | R4 |
| `"320"` | `₡320` | `₡320` | R5 |
| `"1234567"` | `₡1.234.567` | `₡1.234.567` | R5 |
| `"10.4999"` | `₡10,4999` | `₡10` | R6 |
| `"10.5001"` | `₡10,5001` | `₡11` | R6 |
| `"12345678901.99"` | `₡12.345.678.901,99` | `₡12.345.678.902` | R7 |
| `"99999999999.51"` | `₡99.999.999.999,51` | `₡100.000.000.000` | R7 |
| `"1.2.3"` | `₡1.2.3` | `₡1.2.3` | R8 |
| `null` / `""` / `"   "` | `-` (o `—`) | igual | R9 |

**Ceros a la izquierda:** `"000123.60"` se seguirá pintando con sus ceros (`₡000.124`). Es el
comportamiento de hoy, no lo introduce esta feature y no se normaliza aquí: hacerlo sería tocar la
rama de entradas fuera de contrato sin necesidad.

### 2.5 El test más importante del archivo **no muere: se transforma**

`tests/unit/config/moneda-formato.test.ts:262` — «los decimales sobreviven a un importe que un
`number` no puede representar» — es el que demuestra que el módulo trabaja dígito a dígito. Sigue
siendo el más importante, con el mismo propósito y otra afirmación: **el redondeo de un importe de
once dígitos es exacto** (`"99999999999.51" → ₡100.000.000.000`), algo que un `double` no puede
garantizar. Se **reescribe**, no se borra.

---

## §3 Modelo de datos, rutas y contratos: lo que NO hay

Se declara explícitamente para que el reviewer no lo busque:

- **Tablas / migraciones:** **ninguna**. La columna sigue siendo `DECIMAL(12,2)` (R17).
- **RLS:** sin cambios. No hay tabla nueva.
- **Endpoints / route handlers / Server Actions:** **ninguno** nuevo ni modificado.
- **DTO:** sin cambios. El dinero sigue cruzando la frontera como **string de escala 2** vía
  `Prisma.Decimal.toFixed(2)`, y los `toFixed(2)` de `lib/services/**` y `lib/utils/**`
  (`LiquidacionService`, `CierreBodegaService`, `wallet-balance`, `saldo-tienda`,
  `reparto-liquidacion-mensajero`, `AnaliticaFinancieraService`…) **son esa frontera y no se tocan**.
- **Integraciones externas:** ninguna afectada.

---

## §4 Los 4 archivos de producción que cambian

### 4.1 `lib/config/moneda.ts` — el único cambio de verdad *(backend_dev)*

§2. Añade `sumarUno` y `redondearEnteros`, cambia el cuerpo de `formatMontoString`, y actualiza los
docstrings del módulo (R18 / C4): el de `formatMontoString` dice hoy «los decimales se copian
VERBATIM», y el de `formatMonto` justifica su `toFixed(2)` con que «es lo que hace que un importe
entero se pinte `₡320,00` y no `₡320`» — tras la 230 los dos caminos dan `₡320`.

**`formatMonto` conserva su `toFixed(2)`** (ver §7/A3 y C3).

### 4.2 `components/shared/PriceLabel.tsx` — hereda, pero su docstring miente *(frontend_dev)*

No cambia una línea de código: `formatMonto` ya le da el formato nuevo. Cambia **solo el docstring**,
que hoy promete «SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`)» y cuyo punto 3 justifica los ceros
finales por la alineación de la coma en una columna `tabular-nums` — justificación que desaparece
cuando todas las filas son enteras (R18, C4). El contrato de «sin valor → cero, no marcador de
ausencia» **se conserva**: pasa a mostrar `₡0`.

### 4.3 `components/shared/KpiValorAnimado.tsx` — el prop `decimals` *(frontend_dev)*

`const decimals = moneda ? 2 : 0;` (línea 96) pasa a **0 siempre en modo moneda** (R14). El texto
sale de `formattingFn` —que es `formatMonto`— y ya vendría sin decimales, pero `decimals` gobierna
el valor de cada fotograma: dejarlo en 2 hace que el contador recalcule con céntimos durante toda la
animación. Con `0`, el valor animado y el pintado tienen la misma resolución.

⚠️ **`formatear` está memoizada a propósito** (comentario del archivo: react-countup reinicia la
animación si cambia la identidad de `formattingFn`). El cambio de `decimals` **no toca** esa
memoización ni sus dependencias.

### 4.4 `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:97` — la única fuga *(frontend_dev)*

```ts
render: (row) => (row.montoCobrar != null ? row.montoCobrar.toFixed(2) : "-"),
```

Pinta el monto **crudo**: sin símbolo, sin agrupar y sin pasar por el formateador. Es la única fuga
medida en `app/**` y `components/**` (los otros dos `toFixed(2)` del árbol están dentro de
comentarios de `ordenes-columns.tsx`). Se enruta por `formatMonto(row.montoCobrar)`, que ya devuelve
el marcador `"-"` cuando el monto es `null` — el mismo que la celda pinta hoy a mano (R13).

**Efecto lateral querido:** esa columna gana el símbolo y los separadores de miles que hoy no tiene.
No es un daño colateral, es la misma pantalla dejando de ser la excepción.

---

## §5 Las fronteras que NO se mueven, y el test que las fija

| Frontera | Estado medido | Cómo se fija |
| --- | --- | --- |
| **Base y DTO** | `DECIMAL(12,2)`; el dinero cruza como string de escala 2 | No hay migración en el diff; los tests de servicios siguen verdes **sin tocarlos** (R17) |
| **Descargas XLSX/CSV** | `lib/utils/descarga-dataset.ts` y `lib/utils/manifiesto-xlsx.ts` **no importan** el formateador: llevan el número crudo | Diente 3 de la guardia (§6.3): esos módulos no importan `@/lib/config/moneda` ni nombran `money`/`formatMonto` (R16) |
| **Analítica no monetaria** | `components/private/analytics/formato.ts`: `porcentaje`, `segundos` y `conteo` van por `Intl`, no por el formateador | Diente 4 de la guardia (§6.4): el porcentaje y la duración **conservan** su decimal (R15) |
| **Formularios** | Siguen aceptando céntimos al escribir | Fuera de alcance (Q2). No hay test aquí porque no hay cambio |

La contabilidad conserva los céntimos. Eso no es un descuido de la feature: es **el requisito R16**.

---

## §6 La guardia nueva — `tests/unit/guards/dinero-sin-centimos.guardia.test.ts`

Es lo que impide que esto se deshaga. Sin ella, la próxima feature reintroduce los céntimos y nadie
se entera. Se selecciona sola por patrón (`vitest run guard`), así que entra en
`./init.sh --rapido` desde el primer día (`docs/verification.md`).

**Cuatro dientes, y cada uno con su mutación que lo pone rojo.**

### 6.1 Diente 1 — comportamiento: ningún camino de dinero emite decimales

Corpus de importes **con forma decimal** (los de la tabla §2.4 más una batería determinista de
combinaciones: 0–3 decimales, negativos, 1–12 dígitos enteros, todos los primeros decimales 0–9)
por los **cinco** caminos públicos: `formatMontoString`, `money`, `formatMonto`, `PriceLabel`
(renderizado) y `formatearValor(v, "moneda")`.

Afirmación: ninguna salida casa `separador decimal + dígito`. Se afirma lo **fuerte** (ni un solo
dígito decimal) y, como sub-caso explícito, lo que pidió el humano (`,\d\d`).

**Mutación que lo pone rojo:** un formateador de mentira que conserve los céntimos (o revertir el
paso 5 de §2.3) debe hacer fallar este diente. Se ejecuta y se registra en
`progress/impl_230.md`; sin esa ejecución la guardia no cuenta como probada.

### 6.2 Diente 2 — estructura: nadie se salta el formateador

Barrido de `app/**` y `components/**` (con `quitarComentarios` de `tests/fixtures/sin-comentarios.ts`,
porque en este repo los docstrings **nombran a propósito** lo prohibido) buscando `.toFixed(`.

**Lista blanca censada** de usos no monetarios — hoy **uno**: `components/shared/BulkUpload.tsx:115`
(tamaño de archivo en MB). Cualquier `.toFixed(` nuevo en esos árboles pone la guardia roja hasta que
alguien lo justifique en la lista, que es exactamente el punto.

**Mutación que lo pone rojo:** el código anterior de la celda de `OrdenesCargaResumen`
(`row.montoCobrar.toFixed(2)`) se le pasa al barrido y debe ser cazado. Es la contraprueba de que el
diente mira algo.

### 6.3 Diente 3 — la frontera de las descargas (R16)

`lib/utils/descarga-dataset.ts` y `lib/utils/manifiesto-xlsx.ts` **no** importan `@/lib/config/moneda`
ni nombran `money(`/`formatMonto(`/`formatMontoString(`. Contraprueba: un fuente ficticio con ese
import debe ser cazado.

### 6.4 Diente 4 — el no-objetivo (R15, D2) y la excepción verbatim (C2)

Dos afirmaciones que **acotan** la guardia, para que el rojo del futuro sea informativo:

1. `formatearValor(0.842, "porcentaje")` y `formatearValor(5400, "segundos")` **conservan** su dígito
   decimal, comparados contra el mismo `Intl.NumberFormat` que los produce hoy (no contra un literal
   inventado). Si alguien «sanea» también los porcentajes, esto se pone rojo.
2. La rama **verbatim** (R8) queda **fuera** del diente 1, y se dice por qué: si el servidor mandara
   `"1,50"` —que no tiene forma de decimal—, se seguiría pintando `₡1,50`, con coma y dos dígitos.
   Está escrito en un test propio para que no se descubra como un rojo inexplicable (C2).

**Limitación conocida y declarada:** el diente 1 usa el separador decimal **configurado**. Si alguien
configurara el mismo carácter para miles y decimales, la guardia no podría distinguirlos — pero esa
configuración ya rompe el formato hoy, antes de esta feature.

---

## §7 Alternativas descartadas

**A1 — Convertir a número y redondear con `Math.round` / `Intl` (`maximumFractionDigits: 0`).**
Es lo obvio y es exactamente lo que este repo tiene prohibido. `Number("12345678901.99")` no cabe
exacto en un `double`; el repo **ya perdió un céntimo** por una conversión (documentado en la guardia
de la feature 204), y tres guardias vivas más el test del propio módulo lo cazarían. Además `Intl` en
`es-CR` agrupa con **espacio fino**, que es justo el aspecto del que la 201 salió. **Descartada.**
Nota: `Math.round(-0.5)` da `-0`, que además contradice D1 (half away from zero) y R4.

**A2 — Redondear en el servidor (services/repositories) y mandar el importe ya entero.**
Cambiaría el **dato** que cruza la frontera, rompería la escala 2 del contrato, tocaría los DTO y
arrastraría las descargas y la contabilidad con él. El humano pidió que **se pinte** sin céntimos.
**Descartada:** es presentación, y la presentación tiene un único punto de paso que ya existe.

**A3 — Cambiar el `toFixed(2)` de `formatMonto` por `toFixed(1)` (o `toFixed(0)`) para evitar el
doble redondeo.** Eliminaría el borde de C3 (`1234.4951` → `1235` en vez de `1234`), pero: (a) rompe
la afirmación money-safe existente de que el único `toFixed` del módulo es de **escala 2**
(`moneda-formato.test.ts:258`), que es la escala del **contrato de la frontera**; (b) `toFixed(0)`
delegaría el redondeo en el motor de JS —binario— justo en la operación que esta feature quiere
determinista; y (c) el borde solo existe para entradas que **ya están fuera del contrato** (más de
dos decimales en el camino numérico). **Descartada:** se conserva `toFixed(2)` y el comportamiento
resultante se **fija con un test** en vez de quedar implícito.

**A4 — Un flag de configuración (`MONEDA_DECIMALES=0|2`) para poder volver atrás.**
Duplicaría cada aserción de las 265 líneas («¿con flag o sin flag?»), dejaría dos formatos vivos a la
vez y volvería la guardia de §6 imposible de afirmar. El humano no pidió reversibilidad, pidió que
el ruido desaparezca. **Descartada.**

**A5 — Redondear en cada pantalla (los 128 consumidores).**
Es la que garantiza olvidarse de alguna. La 201 existió precisamente para acabar con las siete copias
de `money()`. **Descartada.**

---

## §8 Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| F1 | Reescribir 265 líneas de test «a ojo» convierte la suite en decorado | Se releen **una a una** (bloque 5 de `tasks.md`), nunca con `sed`. Cada línea afirma algo concreto: un redondeo, un cero, un negativo |
| F2 | Alguien reintroduce céntimos en una pantalla nueva | La guardia de §6, con sus dos contrapruebas ejecutadas |
| F3 | Una columna deja de cuadrar con su total (±1, ±2) | **Consecuencia aceptada** por el humano (requirements §3/A1). No se «arregla» |
| F4 | La celda del resumen de carga cambia más de lo esperado (gana símbolo y miles) | Declarado en §4.4; su test lo afirma explícitamente |
| F5 | `PriceLabel` pasa de `₡0,00` a `₡0` y algún consumidor lo lee como «sin dato» | Su contrato («sin valor → cero, no ausencia») **no cambia**; solo el aspecto. Cubierto por el test del componente |

---

## §9 Verificación

- `./init.sh --rapido` al cerrar **cada** tanda (typecheck + lint + relacionados + **todas** las
  guardias).
- `./init.sh` **completo antes del PR, sin excepción** — y aquí importa especialmente: el cambio está
  en un módulo **muy importado**, así que el grafo seleccionará mucho, pero no todo.
- El mapa `R<n> → test` se copia a `progress/impl_230.md` con la **salida real** de los tests, no con
  un «debería funcionar» (`docs/verification.md`).
- Las **dos mutaciones** de §6.1 y §6.2 se ejecutan y su salida (roja) se pega en
  `progress/impl_230.md`. Una guardia que nadie vio morder no está probada.
