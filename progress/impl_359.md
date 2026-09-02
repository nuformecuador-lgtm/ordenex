# Ficha 359 — los céntimos se muestran SOLO CUANDO EXISTEN

> Worktree `R:\wt\352`, rama `feature/359-centimos-cuando-existen`.
> Implementado el 2026-09-02. **Sin commit**: lo commitea el leader.

---

## 1. Dónde cambió la regla

**En un solo punto de paso: `lib/config/moneda.ts`.** Los cinco caminos públicos
(`formatMontoString`, `money`, `formatMonto`, `PriceLabel`, `formatearValor(·,"moneda")`)
delegan todos ahí, así que no hizo falta dispersar nada por pantalla.

La regla vieja (feature 230) usaba la cola decimal para **redondear la parte entera** y la
descartaba. La nueva **cuadra a la escala 2 —la misma del dato y de la frontera— y emite la
cola solo cuando no es toda ceros**. Concretamente:

| pieza                | antes                                        | ahora                                                        |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `ESCALA_PRESENTACION` | implícita en 0                                | `2`, exportada (la lee el KPI animado)                        |
| `redondearEnteros`   | half-away-from-zero a escala 0                | `cuadrarAEscala`: half-away-from-zero a escala 2, con acarreo que puede desbordar a los enteros |
| composición          | `signo + símbolo + miles`                     | `componer(...)`: añade `separadorDecimal + cola` si la cola ≠ 0 |
| `separadorDecimal`   | no gobernaba la salida (solo lo leía la guardia) | **vuelve a gobernar la salida**, y la guardia lo sigue leyendo de ahí |

Que el cambio bastara en un punto se comprueba, además de por el gate, con la parte D del
test de identidades: censo de las 13 pantallas + comprobación de que todas pasan por
`@/lib/config/moneda` (directamente o a través de su archivo de etiquetas hermano).

### Lo que NO bastó con un solo punto (y por qué)

**`components/shared/KpiValorAnimado.tsx`.** No formatea, pero le dice a `countup.js` cuántos
decimales conserva **el valor de cada fotograma, incluido el último**. La 230 lo forzaba a `0`
en modo moneda con un motivo correcto entonces («el texto ya no los muestra»). Con la regla
nueva, un KPI de dinero con cola aterrizaba en `₡13.331.833` mientras la tabla de al lado leía
`₡13.331.832,72` — la misma familia de contradicción que la ficha mata, por otra puerta. Se
pasa a `ESCALA_PRESENTACION`, importada del módulo de moneda para que no sean dos decisiones.

---

## 2. Qué pasó con la guardia

`tests/unit/guards/dinero-sin-centimos.guardia.test.ts`
→ **`tests/unit/guards/dinero-centimos-cuando-existen.guardia.test.ts`** (`git mv`, historial
conservado).

**Se queda entera y se refuerza. No se debilita ni un diente.** Los seis dientes siguen ahí, el
corpus (>100 importes por tipo de camino, bordes de acarreo y agrupación incluidos) es el
mismo, y todas las contrapruebas siguen dentro del archivo.

Lo que cambia:

- **Diente 1** — pasa de «ninguna salida lleva separador decimal seguido de dígito» a **«la
  cola sale SI Y SOLO SI existe»**, afirmado en las dos direcciones. Y se afirma contra un
  **oráculo independiente**: `Prisma.Decimal` (mismo tipo con el que el servidor calcula, mismo
  redondeo por defecto), nunca contra el propio formateador. Se comprueba, para cada salida:
  presencia/ausencia de cola contra el oráculo, que la cola tenga exactamente los dígitos de la
  escala, que sea la del oráculo, y **que la parte entera no se haya movido** (es lo que caza un
  acarreo indebido: `999.50` ya no puede salir como mil).
- Se añaden dos casos nuevos: **el importe redondo no arrastra `,00`** (la dirección que se
  pierde si alguien «simplifica» a un `toFixed(2)`), y **el borde `999.50` → `₡999,50`** con su
  contraparte de que el acarreo sigue existiendo una escala más abajo (`999.999` → `₡1.000`).
- La CONTRAPRUEBA pasa de un formateador de mentira a **dos**: el de la 230 (cuadrar al colón)
  y el `toFixed(2)` de siempre. Cada uno tiene que ser cazado en **todo** el subconjunto que le
  toca.
- **Diente 5** es el único que cambia de presa: perseguía «promesas de decimales» y ahora
  persigue **descripciones de la regla retirada** («sin céntimos», «sin parte decimal»). Se
  conserva `siempre dos decimales`, que era falso con la 230 y lo sigue siendo con la 359. Se
  añade una **contraparte en positivo** (la superficie censada tiene que DECIR cuál es la regla:
  la ausencia de mentira no es documentación). El precio del diente está escrito en el propio
  archivo: en esos 3 fuentes no se puede escribir «sin céntimos» ni para contar la historia.
- **Diente 6** — su caso «convive con las pantallas» tuvo que cambiar de ejemplo: hasta ahora
  un importe CON cola separaba la salida de máquina de la de pantalla; ahora ahí coinciden en la
  cifra y la diferencia real está en el **importe redondo** (`1578.00` en el JSON, `₡1.578` en
  pantalla). Se afirman los dos.
- **`montoExacto` entra en el censo**: los caminos públicos pasan de **cinco a seis**, y los
  tres sitios que contaban cinco (`toBe(5)`, el regex `EXPORTA_CAMINO_PUBLICO`, la prosa) se
  actualizaron a seis.
- Se añade `moneyTope` con **su propio caso**, fuera del censo de «misma cadena» porque tiene
  regla propia: se exige (a) que para todo lo de escala 2 dé la MISMA cadena que `money`, y (b)
  que **nunca quede por encima** del importe recibido; y se exige que las dos reglas de verdad
  se separen en alguna parte, para que (a) no pueda estar verde por ser `money` con otro nombre.

---

## 3. Qué pasó con `montoExacto`

**Se retira como implementación y se conserva como alias.** El cuerpo se mudó a
`lib/config/moneda.ts`; `components/shared/DesglosePagoField.tsx` lo **re-exporta**
(`export { montoExacto }`), que es el mismo patrón con el que la 201 absorbió las siete copias
de `money()`. **Ningún consumidor cambia un import** (`OrdenesConMontoAjustadoTabla`, el propio
campo, y los tests de la 300).

Por qué alias y no borrado: en el sitio de llamada el nombre sigue diciendo algo cierto («aquí
la cola no se puede esconder»), y borrarlo obligaba a tocar dos pantallas y sus tests sin ganar
nada. Por qué no dos implementaciones: sería una segunda copia de la misma regla, que es
exactamente cómo divergen estas cosas — la 300 la escribió aparte y por eso arregló UNA pantalla
y dejó doce.

**Entra en la guardia** como sexto camino público y se le pasa el corpus entero (mutación M7:
si vuelve a tener cuerpo propio y divergente, tres suites se ponen rojas).

Efecto colateral bueno, medido: en `tests/components/OrdenesCargaPreview.test.tsx:381` vivía la
línea `expect(formatMonto(ORIGINAL)).toBe(APLICADO_EN_PANTALLA)` — la prueba escrita de que el
formateador general fundía los dos importes y por eso hacía falta el sexto. Hoy afirma lo
contrario.

---

## 4. `moneyTope` — se queda, y dónde faltaba

`moneyTope` **se conserva con su nombre, su export y sus dos consumidores**; el cuerpo se mudó
a `lib/config/moneda.ts` como `formatMontoTope` y `cierre-detalle-shared.tsx` lo re-exporta.

**Un cambio de implementación que hay que declarar, porque el encargo decía «se queda igual».**
La garantía es idéntica —«un máximo NUNCA se cuadra al alza»—; lo que se movió es **dónde
corta**: antes en la escala 0 (porque esa era la escala que se pintaba), ahora en la escala 2
(por la misma razón). Dejarlo cortando por el punto habría convertido los topes en **el único
dinero de la app que esconde una cola que existe**, y el efecto medido en el único tope real
del repo es que el mensaje mejora en vez de empeorar:

- antes: «El monto no puede superar **₡9.999.999.999**» — 99 céntimos **por debajo** del límite
  que el validador acepta, y en contradicción con el «(10 dígitos y **2 decimales**)» de su
  propia frase;
- ahora: «El monto no puede superar **₡9.999.999.999,99**» — el límite exacto.

Está fijado con un test que **extrae la cifra del propio mensaje, la recompone a money-safe y se
la pasa al mismo `montoValido` que gobierna el botón** (`IncidentesAdminModule.test.tsx`).

**Aplicado donde faltaba:** `REPARTO_PREVISUALIZACION.excede` — el «Como máximo se pueden
aplicar ₡X» pasa de `money(imputable)` a `moneyTope(imputable)`. Para todo lo que emite el
servidor (`imputable` sale de un `Decimal.toFixed(2)`) las dos funciones dan la MISMA cadena,
así que **la identidad `imputable + sobrante = lo tecleado` sigue cerrando en pantalla** — y
está comprobado con la pantalla renderizada. `moneyTope` está ahí por lo que garantiza, no por
lo que cambia.

Los topes de indemnización (`CierresAdminModule`, `IncidentesAdminModule`) ya usaban `moneyTope`
y no se tocaron; lo que cambia es lo que ese `moneyTope` pinta.

---

## 5. Las identidades que ahora cierran

Archivo nuevo: **`tests/components/DineroIdentidadesEnPantalla.test.tsx`** (25 casos).

**El método**: se **parsea lo que se pinta** (símbolo, miles y coma deshechos, a céntimos
enteros en `bigint`) y se comprueba `A ± B = C` sobre **las cadenas**, nunca sobre los `Decimal`
de origen. Todos los importes llevan céntimos a propósito: con cifras redondas estas identidades
cerraban también antes de la ficha, así que un caso redondo no probaría nada.

- **Parte A — el teorema.** `parsear ∘ pintar` es la identidad sobre la escala 2 (corpus de 103
  importes), y de ahí se deriva —comprobando, no razonando— que **2.266 identidades**
  suma/resta cierran. Contraprueba: con la regla de la 230 se rompen **más de 200**.
- **Parte B — tres pantallas renderizadas de verdad**, leyendo del DOM.
- **Parte C — el resto del censo**, a través de la misma función de etiqueta que llama cada
  pantalla.
- **Parte D — el censo de las 13**, con su identidad declarada, más la comprobación de que
  ninguna declara un formateador propio.

### Un ejemplo real por pantalla

| pantalla | identidad | lo que se lee AHORA | lo que se leía con la 230 |
| --- | --- | --- | --- |
| `PanelConciliacion` | snapshot − ledger = diferencia | `₡1.560,50` − `₡1.500` = `₡60,50` | `₡1.561` − `₡1.500` = **`₡61`** (y la alerta «no cuadran» encendida junto a una diferencia que podía leerse como cero) |
| `CajaResumenCard` | entradas − salidas = en caja | `₡15.416,47` − `₡3.000,55` = `₡12.415,92` | `₡15.416` − `₡3.001` = **`₡12.416`**, y la resta a ojo daba `₡12.415` |
| `CajaResumenCard` | terceros + ganancia = en caja | `₡10.000` + `₡2.415,92` = `₡12.415,92` | `₡10.000` + `₡2.416` ≠ `₡12.416` por poco |
| `RepartoPrevisualizacion` | imputable + sobrante = lo tecleado | `₡4.500,35` + `₡4.499,65` = `₡9.000` | `₡4.500` + `₡4.500` = `₡9.000` **por casualidad**; con `4500.60` habría anunciado `₡4.501`, más de lo que el servidor acepta |
| `RepartoPrevisualizacion` | pendiente − aplicado = queda | `₡4.000` − `₡1.234,56` = `₡2.765,44` | `₡4.000` − `₡1.235` = `₡2.765` **no da** |
| `cierre-factura` / `CierreDiaModule` / `CierresAdminModule` | efectivo + SINPE + transferencia = general | `₡100` + `₡50,25` + `₡10,10` = `₡160,35` | `₡100` + `₡50` + `₡10` = `₡160` (cuadraba por casualidad) |
| `cierre-detalle-shared` | los seis sumandos del ingreso = total | flete `₡2.500` + IVA `₡325` + rechazo `₡0` + IVA `₡0` + **comisión COD `₡416,47`** + IVA `₡54,14` = `₡3.295,61` | los seis redondeados sumaban `₡3.296` contra un total de `₡3.296` — con otros datos, ±1 |
| `CierresAdminModule` (pago a tienda) | cobrado − flete − comisión = pago | `₡25.000` − `₡2.825` − `₡847,50` = `₡21.327,50` | `₡25.000` − `₡2.825` − `₡848` = **`₡21.327`** contra un `₡21.328` pintado |
| `ComposicionGananciaCard` | 7 filas de egresos = total | 300 + 125,50 + 800 + 25,25 + 700 + 45,75 + 194,25 = **`₡2.190,75`** | las 7 sumaban `₡2.192` y el total decía `₡2.191` (**la «consecuencia aceptada» A1 de la 230, dada de baja**) |
| `DesglosePagoField` / `AsignacionDetalle` | a cobrar − capturado = diferencia | `₡11.898,81` − `₡11.898` = `₡0,81` | `₡11.899` − `₡11.898` = `₡0` **junto a un error de descuadre** |
| `CuentasPorPagarTable` | devengado − pagado = cuenta por pagar | `₡18.850,47` − `₡6.450,15` = `₡12.400,32` | ±1 |
| `DesgloseMovimientosTienda` | las líneas suman el total | `₡1.200,15` − `₡300,55` + `₡416,47` + `₡0,50` = `₡1.316,57` | ±1 |
| `DineroProductoDetalle` | recaudado = Ordenex + tienda + pendiente | `₡416,47` + `₡11.482,53` + `₡0,50` = `₡11.899,50` | ±1 |
| `IncidentesAdminModule` | el tope anunciado = el que acepta el validador | `₡9.999.999.999,99` | `₡9.999.999.999` (99 céntimos por debajo) |

Y tres cosas que **ya no** se leen mal, medidas en sus tests:

- `CajaResumenCard`: `deTerceros: "0.10"` se leía **`₡0`** («consecuencia A2, aceptada por el
  humano»). Hoy se lee `₡0,10`.
- `PagosRegistradosTabla` / `AnularPagoDialog`: el tope de la columna `9999999999.99` se pintaba
  **`₡10.000.000.000`** — once dígitos, un importe que la propia columna `DECIMAL(12,2)` no
  admite. Hoy `₡9.999.999.999,99`.
- `ordenes-columns`: la afirmación que la 230 dio por perdida por escrito («`₡657,25` y NO el
  `657,26` que salía de multiplicar en el navegador», la huella del cálculo del cliente que la
  feature 204 cerró) **está recuperada**.

### Bordes obligatorios

| caso | resultado | dónde está fijado |
| --- | --- | --- |
| céntimo `.50` | `999.50` → `₡999,50` (**ya no `₡1.000`**) | `moneda-formato` «EL BORDE QUE SE DIO LA VUELTA», guardia diente 1, identidades parte A |
| `.00` explícito | `1234.00` → `₡1.234`, y `=== money("1234")` | `moneda-formato` «y la ESCONDE cuando no la tiene» |
| negativo | `-416.47` → `-₡416,47`; `-0.49` → `-₡0,49` (**la 230 daba `₡0`, sin signo**) | `moneda-formato` «el cero NO lleva signo…» |
| cero | `0.00` y `-0.00` → `₡0`, sin signo | mismo caso |
| acarreo | sigue vivo una escala más abajo: `999.999` → `₡1.000` | `moneda-formato` «el acarreo puede desbordar la cola» |

---

## 6. Las mutaciones

**Siete aplicadas, siete muertas, cero supervivientes.** El arnés
(`scratchpad/mutar.py`) **se autocomprueba**: si el objetivo no aparece exactamente una vez, o
si el md5 del fuente no cambia en disco, aborta con código ≠ 0 y no ejecuta nada. Existe por la
lección de `arnes-de-mutaciones-que-miente`. Los fuentes se restauraron desde copia y se
verificó el md5 al final (`765dcfcd…` para `moneda.ts`, `315564ef…` para el KPI).

| # | mutación | md5 tras mutar | línea de fallo real | mensaje |
| --- | --- | --- | --- | --- |
| **M1** | **volver a redondear siempre** (regla 230: cuadrar al colón y tirar la cola) | `74650faa` | `DineroIdentidadesEnPantalla.test.tsx:188:70` · `dinero-centimos-cuando-existen.guardia.test.ts:364:84` | `el formateador perdió céntimos por el camino: expected [ '999.50 -> ₡1.000 -> 100000', …(87) ] to deeply equal []` — **41 de 93 tests rojos** |
| **M2** | **esconder la cola cuando el 2.º dígito es `0`** (`,50` desaparece) → rompe identidades | `87bd6d71` | `DineroIdentidadesEnPantalla.test.tsx:188:70` · guardia `:364:84` | `expected [ '999.50 -> ₡999 -> 99900', …(13) ] to deeply equal []` — 21 rojos |
| **M3** | truncar en vez de cuadrar al vecino más cercano | `cee83963` | `DineroIdentidadesEnPantalla.test.tsx:692:41` · `moneda-formato.test.ts:100:42` · guardia `:364:84` | `expected '₡9.999.999.999,99' not to be '₡9.999.999.999,99'` (las dos reglas de `moneyTope` dejan de separarse) — 12 rojos |
| **M4** | emitir SIEMPRE la cola (vuelven los `,00` que quitó la 230) | `1353138c` | `moneda-formato.test.ts:76:43` · `DineroIdentidadesEnPantalla.test.tsx:225:30` · guardia `:364:84` | `expected '₡1.234,00' to be '₡1.234'` — 22 rojos |
| **M5** | la **cota** se cuadra al vecino más cercano (puede quedar POR ENCIMA) | `83b879eb` | `moneda-formato.test.ts:390:40` · `DineroIdentidadesEnPantalla.test.tsx:691:41` · guardia `:444:86` | `expected '₡10.000.000.000' to be '₡9.999.999.999,99'` — 4 rojos |
| **M6** | el KPI animado vuelve a `decimals = 0` en modo moneda | `c3c6b66b` | `KpiValorAnimado.test.tsx:220:37` y `:249:37` | `expected +0 to be 2` — 2 rojos |
| **M7** | `montoExacto` vuelve a tener **cuerpo propio y divergente** | `c986c4f8` | `DineroIdentidadesEnPantalla.test.tsx:648:39` · `moneda-formato.test.ts:361:46` · guardia `:364:84` | `expected '₡11.898,81' to be '₡11.898'` — 5 rojos |

Las **tres** suites (guardia, identidades y `moneda-formato`) cazan las seis mutaciones del
módulo de moneda de forma independiente. **Ninguna sobrevivió en verde.**

---

## 7. Impacto visual — el número

**La medida exacta y libre de fuente: +3 caracteres** (`separadorDecimal` + 2 dígitos) **y solo
en las filas cuyo importe tiene cola.**

**En píxeles: ≈ +16 px.** ⚠️ Es un número **derivado, no medido de nuevo**: el encargo prohíbe
levantar el servidor de desarrollo, así que se deriva de las dos mediciones que la ficha 348 ya
tomó en Chromium con esta misma fuente y tamaño (`ProductosTabla`): `₡393.433` = 65 px (8
caracteres) y `₡12.345.678` = 81 px (11 caracteres) → **3 caracteres con la forma «separador +
2 dígitos» = 16 px**. Lo que se añade tiene esa misma forma (coma + 2 dígitos) y las celdas
llevan `tabular-nums`, así que los dígitos son de ancho fijo; el margen de error es el de la
coma frente al punto, ±1–2 px.

### Cuántas columnas se ensanchan

**27 columnas de dinero** en tablas, contadas así: 25 con un `render:` que llama al formateador
(`grep -rn "render:.*\(money\|formatMonto\|montoExacto\|PriceLabel\)" app components`) más las
**3** de `ProductosTabla`, que salen de UNA sola línea `render:` porque se generan con un `map`
sobre `ORDEN_DINERO`; el `ImporteCelda` móvil de `DetalleFilaComposicion` es la MISMA columna
que su `render:` de escritorio y no se cuenta dos veces. Clasificadas contra la medición de
producción que trae la ficha:

| clase | columnas | efecto |
| --- | --- | --- |
| **Se ensanchan SIEMPRE** (dato con cola en el 100 % de las filas medidas) | **3** — `ordenes-columns` › *Comisión con IVA*; `ProductosTabla` › *Cobró Ordenex* y *Recaudado*; `cierre-detalle-shared` › columnas de concepto que incluyen la comisión | +16 px cada una |
| **Se ensanchan A VECES** (~26 % de filas: 40 de 152 movimientos de wallet medidos, y lo derivado de ellos) | **8** — `DesgloseTiendaLedger`, `DesglosePagosMensajero`, `DesgloseMovimientosTienda`, `DetalleFilaComposicion` (`monto`); `CuentasPorPagarTable` (`devengado`, `pagado`); `CobrosRechazoTiendaPendientesPanel` (`montoIva`); `IncidentesHistoricoTabla` (`indemnizacion`) | +16 px en las filas con cola; la columna crece al máximo de sus filas |
| **NO se ensanchan** (0 con cola en 1.575 filas medidas: 971 montos a cobrar + 577 fletes + 27 totales de cierre) | **14** — montos a cobrar, pagos al mensajero, montos recibidos, fletes, `fulfillment`, gastos fijos, pagos registrados | sin cambio |
| **Ya mostraban cola** | **2** — `OrdenesConMontoAjustadoTabla` (usaba `montoExacto` desde la 300) | sin cambio |

### ⚠️ La columna de la wallet por la que se peleó ayer: SÍ se vuelve a romper. Este es el número.

`app/(app)/wallet/_components/DetalleFilaComposicion.tsx` — la columna **Importe** del panel que
arreglaron las fichas 339/344 el 2026-08-31. La ficha 339 dejó **medido en Chromium** (y escrito
en el docstring del propio archivo):

| viewport | antes de la 339 | después de la 339 | **con la ficha 359 (derivado)** |
| --- | --- | --- | --- |
| **390 px** (móvil) | 309 px pedidos / 284 disponibles → **25 px de recorte** | 284 / 284 → **desborde 0, margen cero** | 284 + 16 = **300 / 284 → ~16 px de recorte vuelve**, en las filas con cola |
| **768 px** | desborde 147 px (declarado, no arreglado) | igual, **147 px** | **~163 px** |
| **1024 px** | desborde 19 px (declarado) | igual, **19 px** | **~35 px** |
| **1280 / 1440 px** | cabe | cabe | cabe (hay holgura) |

Por qué el +16 px va directo al ancho mínimo de la tabla: la ficha 339 lo dejó escrito —«la
celda de texto lleva `wrap-anywhere`, así que puede encoger hasta casi nada y **el ancho mínimo
de la tabla pasa a ser prácticamente el del importe**»— y `ImporteCelda` es
`whitespace-nowrap`, o sea que empuja en vez de partirse. El margen que la 339 consiguió era
exactamente **cero** (284 sobre 284).

**Consecuencia y por qué no la arreglo aquí:** es dinero recortado, que la propia 339 clasifica
como «el punto grave — no se ve roto, se ve como OTRO número». Pero arreglarlo es rediseñar el
layout de esa tabla, que es otra ficha (y la 339 ya dejó dicho cuál es el instrumento correcto:
`@container`, no el viewport). **Queda declarado y con el número, no tapado.** Afecta a ~26 % de
las filas de ese panel y solo por debajo de 1280 px.

El resto de las columnas de dinero **no tienen ese problema**: `ProductosTabla` es la otra con
mínimos declarados y ahí sobra sitio —su `minWidth` de dinero es 6 rem = 96 px y la cifra medida
pide 89, así que con +16 px la columna crece unos 9 px por encima de su suelo y el scroller pasa
de 1.416 a ~1.448 px de contenido a 1440—; las demás son de ancho automático y reflúyen.

---

## 8. Archivos

### Producción (6)

| archivo | qué |
| --- | --- |
| `lib/config/moneda.ts` | **la regla**. `ESCALA_PRESENTACION` exportada, `cuadrarAEscala`, `componer`, `formatMontoTope`/`moneyTope`, `montoExacto` |
| `components/shared/DesglosePagoField.tsx` | `montoExacto` pasa de cuerpo propio a **re-export** |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | `moneyTope` pasa de cuerpo propio a **re-export** |
| `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts` | `excede(...)` pinta el `imputable` con `moneyTope` |
| `components/shared/KpiValorAnimado.tsx` | `decimals` en modo moneda: `0` → `ESCALA_PRESENTACION` |
| `components/shared/PriceLabel.tsx` | docstring (la regla y el porqué del `tabular-nums`) |

### Tests (24)

- **Nuevo**: `tests/components/DineroIdentidadesEnPantalla.test.tsx` (25 casos).
- **Renombrado + reescrito**: `tests/unit/guards/dinero-sin-centimos.guardia.test.ts` →
  `dinero-centimos-cuando-existen.guardia.test.ts` (28 casos).
- **Reescrito**: `tests/unit/config/moneda-formato.test.ts` (40 casos).
- **Aserciones actualizadas una a una** (21 archivos): `AnularPagoDialog`, `CajaResumenCard`,
  `CierreDetalleIncidente`, `CierreDiaModule`, `CierresAdminModule`, `CierresAdminPagoMensajero`,
  `ComposicionGananciaCard`, `CorregirDatosCliente.novedades`, `CorregirDatosCliente.ordenes`,
  `DetalleFilaComposicion`, `GestionarOrdenPanelCentimos`, `IncidentesAdminModule`,
  `KpiValorAnimado`, `OrdenesCargaPreview`, `OrdenesCargaResumen`, `PagosRegistradosTabla`,
  `PanelConciliacion`, `PriceLabel`, `RecogerModule`, `RepartoPrevisualizacion`,
  `paginacion/CuentasPorPagarPaginacion`, `integration/wallet-tiendas-desglose`,
  `unit/components/desglose-tienda-labels`, `unit/components/ordenes-columns`,
  `unit/components/wallet-indemnizacion-libro`.

**Ninguna aserción se barrió con `sed`.** Cada una se releyó con su comentario: donde la 230
había dejado por escrito una pérdida («aquí se perdió una afirmación», «consecuencia aceptada
A1/A2», «este caso se quedó sin presa»), se comprobó si la ficha 359 la devuelve y se dejó
anotado en el sitio. Tres de esas pérdidas se recuperan (ver §5).

---

## 9. Verificación

```
$ pnpm typecheck
> ordenex@0.1.0 typecheck R:\wt\352
> tsc --noEmit
(verde, sin salida)
```

```
$ pnpm lint
✖ 147 problems (0 errors, 147 warnings)
(0 errores; los 147 warnings son `no-unused-vars` preexistentes en tests)
```

```
$ pnpm test
 Test Files  1 failed | 1661 passed (1662)
      Tests  1 failed | 23516 passed | 26 skipped (23543)
   Duration  546.17s
```

(Corrida FINAL, del 2026-09-02 12:03, **después** de restaurar las mutaciones y con el md5 de
los dos fuentes mutados verificado contra su copia. No se corrió el gate en paralelo con
ninguna mutación.)

**El único rojo es el heredado y tolerado:**

```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
  > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
  expected [ "lib/actions/tarifas.ts:67 obtenerTarifa" ] to deeply equal []
```

Antes de tocar nada la suite tenía **86 rojos en 27 archivos** (más ese mismo); tras el trabajo,
solo queda ese. Los tres archivos nuevos o reescritos suman **93 casos**, todos verdes.

Tamaño real de los corpus, contado y no estimado:

- guardia, diente 1: **941 importes** por los caminos de STRING y **220** por los numéricos,
  contra el oráculo `Prisma.Decimal`;
- identidades, parte A: **103 importes** de escala 2 y **2.266 identidades** suma/resta
  comprobadas parseando lo pintado.

> ⚠️ **Sin E2E ni navegador**: el encargo prohíbe levantar el servidor de desarrollo (hay otros
> agentes compartiendo la carpeta de compilación). Por eso el número de anchos de §7 es
> **derivado** de mediciones ya hechas en el repo y no una medición nueva, y está marcado como
> tal.

---

## 10. Lo dudoso

1. **`moneyTope` cambió de comportamiento visible**, aunque el encargo decía «se queda igual».
   Interpreté «se queda» como «no lo retires, la garantía sigue haciendo falta». La garantía es
   idéntica; lo que se movió es la escala del corte. **Si la intención era que el tope siguiera
   pintándose `₡9.999.999.999`**, revertir es una línea (`slice(0, ESCALA)` → `slice(0, 0)` con
   su `esCero`) y tres aserciones. Mi argumento para cambiarlo está en §4; lo decisivo fue que
   **dejarlo cortando en la escala 0 y a la vez aplicarlo al `imputable` del reparto —las dos
   cosas que pedía el encargo— habría ROTO la identidad `imputable + sobrante = lo tecleado`**
   (un imputable de `4500.35` se habría anunciado `₡4.500` junto a un sobrante de `₡499,65` y un
   total de `₡5.000`). Las dos instrucciones solo son compatibles si el tope corta en la escala
   que se pinta.

2. **`KpiValorAnimado` no estaba en el censo de 13 y lo toqué igual.** No formatea, pero su
   `decimals` decide la cifra del último fotograma; con `0` habría sido una contradicción nueva
   introducida por esta ficha. Es el único sitio fuera del punto único de paso que necesitó
   cambio, y lo digo aquí porque el encargo pedía justificarlo.

3. **Un tope sigue sin formatear, y no lo toqué:**
   `components/shared/liquidacion/liquidacion-labels.ts:194` →
   `montoTope: (max) => \`El monto no puede superar ${max}.\``, invocado con
   `LIQUIDACION_MONTO_MAX` crudo (`RegistrarPagoDialog.tsx:301`). El usuario lee
   `9999999999.99` sin símbolo ni miles. No es una de las 13 contradicciones —no pasa por el
   formateador en absoluto, así que no puede descuadrar ninguna identidad— y arreglarlo cambia
   un texto de UI que nadie pidió. **Queda anotado como deuda de una línea.**
   Lo mismo con `lib/utils/tope-indemnizacion.ts:53` (`MSG_TOPE_TECNICO`), que sirve al
   validador del servidor.

4. **La rama VERBATIM sigue fuera del oráculo de la guardia**, y ahora es menos distinguible:
   un `formatMontoString("1,50")` sale `₡1,50`, que es indistinguible de una salida legítima.
   Antes la rama era la única que podía emitir una coma y por eso destacaba. Sigue estando
   declarada como excepción en el diente 4, con un caso (`₡1,5`, una cola de un solo dígito) que
   ninguna regla del módulo produce. **No es peor que antes en cobertura, pero sí menos
   llamativa;** si algún día importa, el sitio es el diente 4.

5. **El diente 5 prohíbe una FRASE, no una afirmación.** En `moneda.ts`, `PriceLabel.tsx` y
   `KpiValorAnimado.tsx` ya no se puede escribir «sin céntimos» ni siquiera para contar que esa
   era la regla de la 230. La prosa histórica de esos tres archivos cuenta la regla vieja por lo
   que hacía («se pintaba cuadrado al colón», «la cola se descartaba»). Es deliberado y está
   escrito en el propio diente: la alternativa era un regex de tiempos verbales que fallaría en
   silencio.

6. **Los porcentajes no se tocaron**, como pedía el encargo. El diente 4 de la guardia sigue
   vigilando que el porcentaje conserva su decimal y que la duración también.

7. **`OrdenesCargaResumen` / feature 304 sigue redondeando el DATO al cargar.** Esta ficha es de
   presentación y no toca eso; lo único que cambia es que la tabla «órdenes con el monto
   redondeado» ahora enseña la diferencia con el formateador general en vez de con una
   excepción. La entrada de órdenes con céntimos la cierra la ficha 299.
