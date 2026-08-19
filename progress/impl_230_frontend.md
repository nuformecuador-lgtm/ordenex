# Feature 230 — bitácora de `frontend_dev` (bloques 4 y 5)

> Alcance ejecutado: `app/**`, `components/**` y `tests/**`. **Ni un byte de `lib/**`** (cerrado por
> `backend_dev`), ni de `feature_list.json`, ni de `progress/design_231.md`, ni de
> `specs/231-*`. Sin commits: en este repo commitea el leader.
>
> Los **dos rojos que dejó el backend** quedan verdes **por corrección del código**, no por
> recortar la guardia: el diente 2 porque la fuga de `OrdenesCargaResumen` ya no existe, y el
> diente 5 porque los tres docstrings describen el formato vigente.

---

## 1. Archivos tocados

### Producción (3, los del bloque 4 — no hay un cuarto)

| Archivo | Qué | Task |
| --- | --- | --- |
| `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx` | la **fuga**: `row.montoCobrar.toFixed(2)` → `formatMonto(row.montoCobrar)`, con su import y el comentario que dice por qué la celda gana símbolo y miles | T4.1 (R13) |
| `components/shared/KpiValorAnimado.tsx` | `decimals` pasa a **0** (era `moneda ? 2 : 0`) + docstring `:21-22`, que afirmaba `₡3.500,00` (**contradicción C5**, sin task que la cubriera) | T4.2 (R14) + C5 (R18) |
| `components/shared/PriceLabel.tsx` | **solo prosa**: la promesa de «SIEMPRE dos decimales», el `₡0,00` del contrato de ausencia y el punto 3 que justificaba los ceros finales por la alineación de la coma | T4.3 (R18, C4) |

`decimals` queda en `0` **a secas** y no en `moneda ? 0 : 0`: el modo no moneda ya era 0 y una
ternaria con las dos ramas iguales es una mentira en potencia. La memoización de `formatear`
**no se tocó** (ni la función ni sus dependencias): react-countup reinicia la animación si cambia
la identidad de `formattingFn`.

### Tests (37 archivos)

- **34** del censo, reescritos aserción a aserción (tabla en §4).
- **`tests/unit/components/analytics-formato.test.ts`** — el que el backend midió de más
  (**contradicción C9**): 1 aserción (`formatear(3500, "moneda")`, con OTRA moneda configurada).
- **`tests/components/OrdenesCargaResumen.test.tsx`** — 1 aserción reescrita (`25.90` → `₡26`) y un
  `describe` nuevo de 3 casos para R13 (el criterio de Hecho de T4.1: `1234.56` → `₡1.235`, ningún
  dígito tras el separador en ninguna celda, y `null` → el mismo `SIN_MONTO` que pintaba a mano).
- **`tests/components/KpiValorAnimado.test.tsx`** — **no estaba en el censo y no fallaba**, y aun
  así había que tocarlo: R14 afirma el `decimals` que recibe el contador y el doble global de
  `react-countup` (`tests/setup/jest-dom.ts`) lo **ignora**. Se instala en el archivo un doble
  propio que hace lo mismo —renderizar `formattingFn(end)`— y además **guarda las props**. Con eso,
  4 casos nuevos: `decimals === 0` en moneda, `decimals === 0` sin moneda, ningún **fotograma**
  (inicial, intermedio, final) con parte decimal, y el texto final igual al del formateador. Sin
  ese doble, la única forma de medir R14 era leer el fuente, que no es medir lo que llega al
  componente.

**NO se tocaron**, y se comprueba que siguen verdes sin editarlos (R17 / T5.6):
`tests/components/TableroFinanciero.test.tsx`, `tests/components/AnalyticsKpiCard.test.tsx`,
`tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts` y
`tests/unit/analytics/financiera-unidad-de-vistas.guardia.test.ts`. Su escala 2 es de **frontera**
(DTO / tope de columna) o vive en prosa histórica, no en lo pintado.

---

## 2. Verificación — salida REAL

### `./init.sh --rapido` — **EXIT 0**

```
✓ typecheck paso
✓ lint paso            (69 problems, 0 errors, 69 warnings — todos preexistentes;
                        ninguno en los 40 archivos de esta tanda, comprobado con grep)
-> pnpm run test:rapido
 Test Files  168 passed (168)
      Tests  2424 passed (2424)
   Duration  138.64s
> ordenex@0.1.0 test:guardias
 Test Files  110 passed (110)
      Tests  1639 passed (1639)
   Duration  11.45s
✓ test:rapido paso
== init OK ==
```

### `pnpm run test:guardias` aparte — **EXIT 0**

La **contradicción C8** del backend es real: `test:rapido` es `test:cambiados && test:guardias` y
el `&&` cortocircuita. Hoy no cortocircuitó porque los relacionados pasaron, pero se corre igual
por separado, que es lo que la bitácora anterior pedía:

```
> vitest run guard
 Test Files  110 passed (110)
      Tests  1639 passed (1639)
   Duration  11.90s
EXIT=0
```

`./init.sh` **completo NO se corrió**: lo corre el leader antes del PR.

### Los dos rojos del backend, cerrados

```
> pnpm exec vitest run tests/unit/guards/dinero-sin-centimos.guardia.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

(antes de esta tanda: `19 tests | 2 failed`, diente 2 y diente 5.)

---

## 3. Mutaciones — TODAS ejecutadas, con la salida real

> Aplicadas con un arnés (`mutar.py`) que **aborta con exit 1 si el texto buscado no aparece
> exactamente una vez**. El árbol se restauró tras cada una y se verificó: `md5sum` de
> `lib/config/moneda.ts` idéntico antes y después (`85f31e7f9c9242de3386c6c15b4168b2`), y
> `git diff --stat` de los tres fuentes de producción sin cambios respecto del estado final.

| # | Mutación | Dónde | Resultado |
| --- | --- | --- | --- |
| **F1** | devolver la fuga: `formatMonto(row.montoCobrar)` → `row.montoCobrar.toFixed(2)` | `OrdenesCargaResumen.tsx` | 🔴 **4 tests**: diente 2 (con archivo y línea) + 3 del componente |
| **F2** | `const decimals = 0` → `moneda ? 2 : 0` | `KpiValorAnimado.tsx` | 🔴 **1 test**, dirigido |
| **F3** | devolver «SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`)» al docstring | `PriceLabel.tsx` | 🔴 **diente 5**, con archivo, línea y la línea entera |
| **F4** | devolver «(`₡3.500,00`)» al comentario | `KpiValorAnimado.tsx` | 🔴 **diente 5** (C5: sin esto, la guardia omitiría un mentiroso conocido) |
| **F5** | **truncar** en vez de redondear (`redondearEnteros` devuelve `enteros`) | `lib/config/moneda.ts` (temporal) | 🔴 **31 tests en 17 de 17 archivos** de los reescritos |
| **F6** | romper half away from zero: `>= "5"` → `> "5"` | `lib/config/moneda.ts` (temporal) | 🔴 **15 tests en 9 de 9 archivos** |

F5 y F6 son la autocomprobación del **bloque 5**: si las 234 líneas reescritas fueran decorado,
truncar o cambiar el sentido del medio no rompería nada.

### F1 — la fuga devuelta (R13, R19b)

```
MUTACION APLICADA en app/(app)/ordenes/_components/OrdenesCargaResumen.tsx
--- ANTES ---   render: (row) => formatMonto(row.montoCobrar),
--- DESPUES --- render: (row) => (row.montoCobrar != null ? row.montoCobrar.toFixed(2) : "-"),

 × ningun fuente de `app/**` ni `components/**` llama a `.toFixed(` sobre un importe (R19b) 63ms
 × muestra el resto de columnas de datos de cada orden 43ms
 × con 1234.56 la celda muestra ₡1.235: símbolo, miles y SIN céntimos 39ms
 × el medio se aleja del cero, y no queda ni un dígito tras la coma 31ms

AssertionError: un importe serializado sin pasar por el formateador compartido
(`@/lib/config/moneda`): expected [ Array(1) ] to deeply equal []
+   "app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:103",

 Test Files  2 failed (2)
      Tests  4 failed | 32 passed (36)
```

### F2 — `decimals` vuelve a 2 en moneda (R14)

```
--- ANTES ---   const decimals = 0;
--- DESPUES --- const decimals = moneda ? 2 : 0;

 × en modo moneda el contador recibe 0 decimales, no 2 6ms
AssertionError: expected 2 to be +0 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

Un solo test y solo uno: es lo que se quiere de un caso dirigido. Los otros tres del bloque nuevo
(el de los fotogramas, el del modo no moneda y el del texto final) **sobreviven a propósito**:
miden el texto, que lo gobierna `formattingFn`, no `decimals`.

### F3 — el docstring que volvía a mentir (R18)

```
--- DESPUES --- * separador de miles y SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`). UI pura, …

 × ningun fuente de la superficie de dinero promete decimales en su prosa 7ms
AssertionError: un docstring de la superficie de dinero sigue describiendo el formato con
centimos: expected [ Array(1) ] to deeply equal []
+   "components/shared/PriceLabel.tsx:17: * separador de miles y SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`). UI pura, reutilizable",

 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)
```

### F4 — el comentario de `KpiValorAnimado` (C5, R18)

```
--- DESPUES --- // la feature 201 unifico la agrupacion en `lib/config/moneda.ts` («₡3.500,00»).

 × ningun fuente de la superficie de dinero promete decimales en su prosa 7ms
+   "components/shared/KpiValorAnimado.tsx:23: // la feature 201 unifico la agrupacion en `lib/config/moneda.ts` («₡3.500,00»).",

 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)
```

### F5 — truncar en vez de redondear (el bloque 5 no es decorado)

```
--- ANTES ---   return decimales.charAt(0) >= "5" ? sumarUno(enteros) : enteros;
--- DESPUES --- return enteros;

 Test Files  17 failed (17)
      Tests  31 failed | 355 passed (386)
```

Los 17, uno a uno: `AnularPagoDialog`, `CajaResumenCard`, `CierreDetalleIncidente`,
`CierreDiaModule`, `CierresAdminModule` (4 casos), `CierresAdminPagoMensajero`,
`IncidentesAdminModule` (2), `KpiValorAnimado`, `OrdenesCargaResumen` (3), `PagosRegistradosTabla`,
`PanelConciliacion`, `PriceLabel` (6), `RecogerModule`, `RepartoPrevisualizacion`,
`ordenes-columns` (2), `wallet-desglose-egresos-card` (3), `wallet-indemnizacion-libro`.

### F6 — el medio deja de alejarse del cero

```
--- DESPUES --- return decimales.charAt(0) > "5" ? sumarUno(enteros) : enteros;

 Test Files  9 failed (9)
      Tests  15 failed | 215 passed (230)
```

---

## 4. El bloque 5, en números

- **234 líneas** con un importe de dos decimales reescritas, en **36 archivos** (179 de ellas
  llevan un `expect(` en la propia línea; el resto son continuaciones de un `expect` multilínea,
  entradas de un array de casos, constantes como `MONTO_TEXTO` y **17 líneas de prosa** que
  describían el formato viejo).
- **37.º archivo:** `KpiValorAnimado.test.tsx`, sin líneas reescritas y con 4 casos nuevos.
- **Ninguna se tocó con `sed` a ciegas.** Los reemplazos mecánicos se limitaron a la cola `,00`
  —que no cambia de valor al redondear— y **siempre** tras leer el archivo y decidir caso por caso;
  todo importe con cola distinta de `,00` se recalculó a mano aplicando D1 (`1.250,50 → ₡1.251`,
  `847,50 → ₡848`, `1.200,50 → ₡1.201`, `250,50 → ₡251`, `4,56 → ₡5`, `12.345.678.901,99 →
  ₡12.345.678.902`, `9.999.999.999,99 → ₡10.000.000.000`…).

### T5.7 — barrido de cierre del censo

`grep -rnE "₡-?[0-9][0-9.]*,[0-9][0-9]" tests/` deja **10 apariciones**, y las **diez están en
prosa**, ninguna en una aserción:

| Archivo:línea | Por qué se queda |
| --- | --- |
| `AnalyticsKpiCard.test.tsx:5` | explica por qué el esperado se **deriva** de la configuración en vez de escribir `₡3.500,00` a mano |
| `PanelConciliacion.test.tsx:31, :237` | la historia del defecto del 2026-08-07 (lo que producción pintaba) |
| `TableroFinanciero.test.tsx:343` | la misma historia |
| `financiera-unidad-de-vistas.guardia.test.ts:19` | la misma historia (**T5.6: no se toca**) |
| `indemnizacion-tope-negocio-incidente.test.ts:16` | el tope de la **columna** `9.999.999.999,99` (frontera, **T5.6: no se toca**) |
| `moneda-formato.test.ts:218, :263` | prosa del backend explicando qué cambió |
| `PriceLabel.test.tsx:39`, `desglose-tienda-labels.test.ts:42` | comentarios míos que dicen **qué afirmaba antes** la línea reescrita |

Cero sin justificar.

---

## 5. Lo que al releer resultó estar afirmando algo que ya no es cierto

> Esto es lo que pedía el encargo: decirlo en vez de maquillarlo. Ninguna de las cinco se
> «arregló» inventando una aserción nueva que pareciera fuerte; en las que se pudo, la red se
> mudó al sitio donde todavía puede medir algo, y se dejó escrito **dentro del test**.

### H1 — `IncidentesAdminModule`: los tres casos anti-`parseFloat` perdieron su presa

`tests/components/IncidentesAdminModule.test.tsx` tenía un `it.each` cuyo título era literalmente
«el monto «%s» **conserva sus decimales** (un `parseFloat` los comería)», con `"12500.00"`,
`"1200.50"` y `"0.10"`. Su valor estaba en que un `parseFloat` se come los ceros de la derecha de
un importe de escala 2 y eso **se veía en el DOM**. Desde la 230 la pantalla no pinta decimales:
esa diferencia **dejó de ser observable** y la mutación pasaría sin que nadie la viera.

Hecho: los tres casos pasan a afirmar el redondeo (que sí se ve, y distingue redondear de truncar)
y se **añade** un caso money-safe que barre el fuente del módulo con
`LLAMADAS_PROHIBIDAS_EN_DINERO` (no había ninguna guardia que cubriera ese archivo, se comprobó).
Con contraprueba, para que el barrido no pase por no mirar nada.

### H2 — `ordenes-columns`: el céntimo de la feature 204 ya no se ve

`expect(...).not.toHaveTextContent("657,26")` era la huella exacta del cálculo en el navegador que
la 204 vino a cerrar: el servidor decía `657.25` y el navegador `657.26`. **Los dos se pintan hoy
`₡657`.** Esa línea se retira porque quedó vacía, y en su lugar queda escrito lo que sigue
midiendo: dos filas con la MISMA tarifa y el MISMO monto que pintan importes **distintos** porque
el servidor dice cosas distintas (`₡657` vs `₡5`), afirmado ahora explícitamente con un
`not.toBe` entre las dos celdas. El resto de la red de la 204 sigue viva en
`tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts`, que prohíbe **nombrar** los campos
de la tarifa.

### H3 — `PanelConciliacion`: la regresión del 2026-08-07 se mide con menos margen

El caso se titulaba «pinta el descuadre con sus decimales y su símbolo (₡60,50), **NO redondeado a
«61»**». Desde la 230 el dinero **también** se redondea: el descuadre se lee `₡61`. Lo que
distingue el camino bueno del malo ya no es el decimal, sino el **símbolo** y el separador de
miles con punto, frente al `Intl` de `conteo` (sin símbolo y con espacio duro). La regresión sigue
cazada —usar `datos.unidad` daría `1 561` y `61` pelados—, pero el margen es más estrecho. Se
reescribió el título, se dejó el porqué en el propio test y se añadieron dos aserciones: que las
tres cifras llevan `monedaConfig.simbolo` y que las formas `conteo` y `moneda` del mismo importe
**siguen siendo distintas** (contraprueba de que las tres «ausentes» miran algo).

### H4 — `desglose-tienda-labels`: «el céntimo sobrevive» ya no se puede afirmar desde la salida

`money("1000.10") === "₡1.000,10"` afirmaba que el céntimo llega intacto a la pantalla. Ya no llega
**por diseño**. Se midió si quedaba algún importe dentro de `DECIMAL(12,2)` con el que un
`Number(x).toFixed(2)` devolviera algo distinto del original —para tener un caso que siguiera
discriminando desde el DOM— y **no lo hay**: `1000.10`, `12345678901.99`, `9999999999.99` y
`99999999999.51` sobreviven todos al viaje por `double`. La afirmación money-safe vive ahora donde
puede vivir: el barrido de `Number(`/`parseFloat(` sobre el fuente (en `moneda-formato` y en la
guardia de la 230). Escrito en el propio test.

### H5 — `CierresAdminPagoMensajero`: una deuda real de 10 céntimos se lee `₡0`

El caso «los TRES casos se distinguen entre sí» usaba `pendientePagoMensajero: "0.10"` con el
comentario «con deuda: el importe, **hasta el último céntimo**». Hoy esa celda pinta `₡0`. Las tres
filas **siguen distinguiéndose** (importe / «no debe nada» / «—»), pero la distinción ya no está en
la cifra sino en el texto. Se conservó el importe incómodo a propósito —no se cambió por uno
cómodo— y se añadió `expect(celda).not.toBe(sinPendiente)` para que la distinción quede afirmada.
Es la consecuencia **A2**, ya aceptada, en su forma más visible. El mismo efecto queda anotado en
`CajaResumenCard` (`deTerceros: "0.10"` → `₡0`) y en `IncidentesAdminModule` (indemnización de
`0.10` → `₡0`).

---

## 6. Hallazgo FUERA de mi alcance, para la puerta del leader

### ⚠️ H6 — dos mensajes de formulario anuncian un tope que la app RECHAZA

> **CERRADO en la tanda 2** (§8): es el **B1** del review. El leader decidió pintar el tope
> redondeado HACIA ABAJO y así está implementado (`moneyTope`). Lo de abajo se conserva tal y
> como se escribió antes de esa decisión, porque es la medición que la motivó.

No lo toco —`design.md` §4 dice «cambian 4 archivos de producción, y no hay un quinto», y estos
serían el quinto y el sexto—, pero hay que decidirlo antes del PR:

```
app/(app)/incidentes/_components/IncidentesAdminModule.tsx:104   MONTO_AYUDA
app/(app)/incidentes/_components/IncidentesAdminModule.tsx:113   MONTO_EXCEDE
app/(app)/cierres-admin/_components/CierresAdminModule.tsx:190   INDEMNIZACION_MONTO_EXCEDE
app/(app)/cierres-admin/_components/CierresAdminModule.tsx:197   INDEMNIZACION_MONTO_AYUDA
```

Las cuatro interpolan `money(INDEMNIZACION_MONTO_MAX)` en su **prosa**, y
`INDEMNIZACION_MONTO_MAX` es `"9999999999.99"`. Tras la 230 el texto pasa a decir:

> «El monto no puede superar **₡10.000.000.000** (10 dígitos y 2 decimales). Revisá si sobra un
> dígito.»

Es decir: **anuncia como máximo un número de once dígitos que el validador rechaza**, y en la misma
frase dice «10 dígitos». `MONTO_AYUDA` tiene el mismo problema («Mayor que 0 y hasta
₡10.000.000.000»). No es un fallo del formateador —es correcto redondear—, es un importe que **no
es una cantidad de dinero sino un límite**, y redondear un límite hacia arriba lo invalida.

Opciones, sin decidir: (a) interpolar el tope crudo, como ya hace
`liquidacion-labels.ts:194` (`montoTope: (max) => …${max}…`), que **no** pasa por `money` y por eso
no se ve afectado; (b) redactar el tope en dígitos («10 dígitos enteros y 2 decimales») sin
importe; (c) aceptarlo. Ningún test cae hoy porque los dos casos que tocan esos textos los
**importan** en vez de escribirlos a mano — que es justo por lo que ningún rojo lo delató.

---

## 7. Notas de método

- `test:cambiados` seleccionó **168 archivos** (los 36 que caían + 132 que ya pasaban). Los 36 se
  cerraron de uno en uno, corriendo el archivo tras cada edición; al final se corrió el conjunto
  entero dos veces (antes y después de las mutaciones).
- Un script auxiliar reescribió `tests/unit/components/ordenes-columns.test.tsx` con finales de
  línea CRLF por abrirlo sin `newline=""`. Detectado con `file` sobre los 40 archivos del diff y
  **normalizado de vuelta a LF**; ningún otro archivo quedó afectado.
- Se comprobó a mano que el reemplazo mecánico de la cola `,00` no se comiera el escapado de las
  expresiones regulares (`/₡3\.390,00$/`): en dos archivos sí se lo comió y se restauró
  (`ordenes-columns`, `PagoMensajeroAcciones`).

## 8. Tanda 2 — cierre del review (B1, m1, m2, B3)

> `progress/review_230.md` RECHAZO la feature con 3 bloqueantes. **B2 (ver la app) lo lleva el
> leader y no se toca aqui.** Lo demas se cierra en esta tanda.

### B1 — el tope de indemnizacion anunciaba un maximo que la app rechaza

Era el hallazgo H6 de la tanda 1, escalado en vez de arreglado. **Decision del leader, aplicada:**
un tope se pinta redondeado **HACIA ABAJO** (`₡9.999.999.999`). La razon esta escrita en el codigo,
donde vive el arreglo: **un maximo nunca se redondea al alza**, porque al alza deja de ser un
limite —anuncia como valido justo lo que el validador rechaza—; hacia abajo el mensaje queda mas
estricto que la realidad, que es el lado seguro, y vuelve a casar con el «(10 digitos)» de la
propia frase.

| Archivo | Cambio |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | **`moneyTope(max)`**, nueva: corta la cola decimal del STRING y delega en `money`. Un solo sitio para los dos modulos, que ya importaban `money` de aqui. Money-safe (`indexOf`/`slice`, sin `Number(` ni `.toFixed(`). Docstring con el porque y con la limitacion declarada (**es para una cota POSITIVA**: con un tope negativo truncar acercaria al cero, o sea al alza) |
| `app/(app)/incidentes/_components/IncidentesAdminModule.tsx` | `MONTO_AYUDA` y `MONTO_EXCEDE` pasan por `moneyTope` + prosa `:110-112` reescrita (**m2**) |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | `INDEMNIZACION_MONTO_AYUDA` y `INDEMNIZACION_MONTO_EXCEDE` idem + prosa `:185-188` (**m2**) |

**NO se tocaron** `INDEMNIZACION_MONTO_MAX` ni el validador: el contrato de datos es de la ficha 232.

**Y la mitad que faltaba: los tests.** El reviewer midio la causa de que ningun rojo lo delatara —
`toHaveTextContent(MONTO_EXCEDE)` **importando la misma constante** es afirmar una constante contra
si misma. Reescritas contra **literal** las 4 aserciones de esa familia que encontre (una en
`IncidentesAdminModule.test.tsx`, tres en `CierresAdminIndemnizacion.test.tsx`, estas ultimas
comparaban contra `money(INDEMNIZACION_MONTO_MAX)`, o sea contra la funcion que escribe el texto).

Y **tres casos nuevos**, porque un literal solo caza el valor de hoy:

- «el tope que ANUNCIA el mensaje es un monto que el validador ACEPTA» — extrae la cifra del propio
  mensaje (`/₡[\d.]+/`, sin volver a escribirla) y se la pasa a `montoValido(·, INDEMNIZACION_MONTO_MAX)`,
  el mismo validador que gobierna el boton. Es la **invariante**: cualquier redondeo al alza futuro
  cae aqui, valga lo que valga el tope. Con contraprueba (`"10000000000"` → `false`) y con el
  contrato fijado (`INDEMNIZACION_MONTO_MAX === "9999999999.99"`).
- «la ayuda del campo anuncia el MISMO tope que el error, y sin inflarlo».
- En `CierresAdminIndemnizacion`, la misma invariante sobre el texto pintado en la celda.

### m1 — la sexta asercion caducada

`tests/integration/wallet-tiendas-desglose.test.tsx`: «money-safe: los montos se pintan TAL CUAL,
con sus dos decimales» afirmaba `₡10.000` / `₡1.000` sobre importes redondos, o sea **nada**: sin
cola decimal esos dos salen identicos con o sin un `Number(` por el medio. Se le devuelve presa por
los dos lados: el caso responde ahora con importes que **discriminan** (acarreo `999.99` → `₡1.000`
y once digitos `12345678901.99` → `₡12.345.678.902`, donde truncar da otra cosa), y la afirmacion
money-safe se muda al **fuente** con un barrido nuevo sobre
`app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx` —que **no** lo cubria ninguna
guardia: la de la 172 censa `components/shared/liquidacion` y los `*Liquidacion*` de `lib/`—.

### B3 — el registro

- **`tasks.md`: 30 de 34 marcadas.** Las 4 sin marcar llevan escrito por que y de quien son:
  **T0.1** (la puerta humana SI se paso —`status_note` del 2026-08-18 con Q1/Q2/Q3 resueltas y
  Q1(b) implementada—, pero falta copiar las respuestas a `requirements.md` §4 con fecha, que es
  del leader y no del `frontend_dev`), **T6.1**, **T6.3** (= B2) y **T6.4**.
- **`progress/impl_230.md` creado**: mapa `R<n> → test` de los **20**, cada uno con el test
  nombrado y con la mutacion que lo mata; mas T0.2 (A1–A3, C1–C9) y el estado de los bloques.
  R13, R14 y R20 —los que el reviewer midio como no escritos en ningun sitio— quedan ahi.

### Mutacion obligatoria de B1 — EJECUTADA

```
MUTACION APLICADA en app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx
--- ANTES ---
  const punto = max.indexOf(".");
  return money(punto === -1 ? max : max.slice(0, punto));
--- DESPUES ---
  return money(max);

 × un monto por encima del TOPE se bloquea, y el mensaje dice QUE corregir 253ms
 × el tope que ANUNCIA el mensaje es un monto que el validador ACEPTA 5ms
 × la ayuda del campo anuncia el MISMO tope que el error, y sin inflarlo 180ms
 × m5: el mensaje dice QUE corregir - nombra el maximo y donde mirar 243ms
 × m5: la ayuda del campo anuncia el tope ANTES de que lo choque 199ms

AssertionError: expected 'El monto no puede superar ₡10.000.000...' to contain '₡9.999.999.999'
Received: "El monto no puede superar ₡10.000.000.000 (10 digitos y 2 decimales). Revisa si sobra un digito."
AssertionError: expected false to be true   <- la invariante: el tope anunciado ya NO lo acepta el validador

 Test Files  2 failed (2)
      Tests  5 failed | 62 passed (67)
```

Restaurado y verde de nuevo: **2 files / 67 tests passed**.

**Y la de m1**, para no declararla sin medirla — truncar en vez de redondear:

```
 × los montos del servidor se pintan redondeados y agrupados, sin recalcular 83ms
 Test Files  1 failed (1)
      Tests  1 failed | 30 passed (31)
```

`lib/config/moneda.ts` restaurado y verificado por md5 (`85f31e7f9c9242de3386c6c15b4168b2`).

### Gate de la tanda 2

`./init.sh --rapido` — **EXIT 0**

```
✓ typecheck paso
✓ lint paso            (69 problems, 0 errors, 69 warnings — todos preexistentes; cero en los
                        6 archivos de produccion y los 38 de test de esta feature)
> pnpm run test:cambiados
 Test Files  168 passed (168)
      Tests  2427 passed (2427)
   Duration  137.93s
> pnpm run test:guardias
 Test Files  110 passed (110)
      Tests  1639 passed (1639)
   Duration  11.71s
✓ test:rapido paso
== init OK ==
```

`pnpm run test:guardias` **aparte** (C8: el `&&` cortocircuita) — **EXIT 0**

```
 Test Files  110 passed (110)
      Tests  1639 passed (1639)
   Duration  11.72s
```

(2424 → 2427 tests: +2 en `IncidentesAdminModule` y +1 en `wallet-tiendas-desglose`; los 28 de
`CierresAdminIndemnizacion` ya estaban seleccionados por el grafo y siguen verdes tras reescribir
sus 3 aserciones del tope.)

---

## 9. Veredicto

Bloques 4 y 5 hechos y, tras el review, cerrados **B1** (el tope se pinta hacia abajo, con la
invariante afirmada contra el validador y no contra la constante que escribe el texto), **m1**,
**m2** y **B3** (30/34 tasks marcadas + `progress/impl_230.md` con el mapa 20/20).

Superficie total de `frontend_dev`: **6 archivos de produccion** (3 del bloque 4 + los 3 de B1) y
**38 de test**. `./init.sh --rapido` y `pnpm run test:guardias` en verde (EXIT 0). **8 mutaciones**
ejecutadas con salida roja real, incluida la de B1. **B2 (ver la app) queda pendiente, del leader.**
