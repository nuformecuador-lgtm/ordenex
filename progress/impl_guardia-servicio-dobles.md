# Guardia: la salida real del servicio contra los dobles del tablero

**Fecha:** 2026-08-07 · **Rama:** `chore/guardia-servicio-dobles-tablero` (desde `origin/dev` @ `3713e743`)
**Tipo:** deuda de arnés, sin ficha y sin spec. No es una feature: es una guardia.
**Tandas:** 1 (las siete métricas temporales) y 2 (las tres no temporales), misma rama.

---

## 1. Qué la origina

El 2026-08-06 el tablero financiero estuvo **siete horas en producción** pintando una tabla de
treinta fechas donde el maestro esperaba «Dinero en caja», «Ganancia de Ordenex» y las otras
cinco. La señal de forma «KPI vs tabla» era `vista.filas.length === 0`, y la feature 180 la
invalidó al hacer que el servicio emitiera una serie **densa** (una fila por cubo del rango) para
las siete métricas de flujo. Reparado por hotfix (PR #305): la señal pasó a
`granularidad !== "no_temporal"`.

**Por qué ningún test lo vio**, que es lo único que esta guardia existe para cerrar: el doble del
tablero se llamaba `vistaSinFilas`, declaraba `grano: "fecha"` y `filas: []` **a mano**, y la
propia 180 pasó por delante de él, **lo editó** para añadirle `granularidad` y dejó escrito al
lado «el tablero NO la lee». No vio que su propio cambio invalidaba la premisa que ese doble
fijaba. El componente y su prueba compartían una premisa que el servicio ya no cumplía, y dos
piezas que se equivocan igual no se contradicen nunca.

---

## 2. Qué medí antes de escribir nada

Ejecuté el servicio real (`AnaliticaFinancieraService` con los dobles de repositorio de la 127,
sin base de datos) para las siete métricas temporales con la ventana del tablero
(`2026-07-05` … `2026-08-03`, 30 días). Lo que sale, campo a campo:

| Campo | Servicio (medido) | Doble del tablero (antes) | ¿Divergía? |
|---|---|---|---|
| `vista.id` | `"egresos"`, `"dinero_en_caja"`, … (el id de la **métrica**) | `"egresos__vista"`, … | **SÍ**, en las 7 |
| `vista.grano` | `"fecha"` | `"fecha"` | no |
| `vista.fuente` | `"wallet_movimiento"` (6) · `"pago_mensajero_movimiento"` (1) | `"wallet_tienda_movimiento"` (7) | **SÍ**, en las 7 |
| `vista.sumableCon` | `[]` | `[]` | no |
| `vista.granularidad` | `"dia"` | `"dia"` | no |
| `vista.filas` | 30 filas, claves `2026-07-05` … `2026-08-03` | 30 filas, las mismas | no |
| claves de fila | `["cubo","importe"]` | `["cubo","importe"]` | no |
| claves de vista | `["filas","fuente","grano","granularidad","id","sumableCon","total"]` | idem | no |
| `esAcumulado` | `true` solo en `cuenta_por_pagar_mensajero` | igual, pero **escrito a mano** | no (por ahora) |
| `unidad` | `"moneda"` | `"moneda"` | no |

Dos hallazgos nuevos, ambos del mismo tipo que causó el incidente —un campo que «el tablero no
lee», declarado a mano y falso—: la **fuente** y el **id de la vista**. Ninguno tenía consecuencia
visible hoy; el de `granularidad` tampoco la tenía el día antes de la 180.

**Además medí, y no cambié nada por ello:**

- `CUBOS_FECHA` del test de componente (aritmética propia de milisegundos sobre UTC) daba
  **exactamente** las mismas 30 claves que `trocear`. Era una segunda definición del troceo, no un
  error. Ahora se deriva de `trocear`.
- La fixture semanal (`RANGO_SEMANAL` = `2026-06-01`…`2026-08-02`, `CUBOS_SEMANA`) también
  coincide con `trocear`: 9 cubos, `granularidadDe` da `"semana"`. **No se tocó** (ver §6).
- `cuenta_por_pagar_tienda` declara en su fixture `id: "cuenta_por_pagar_tienda__vista"` y el
  servicio publica `"cuenta_por_pagar_tienda"`. Medido en la tanda 1 y dejado abierto a propósito;
  **atado y corregido en la tanda 2** (§3 bis, mutación F).

### `cuenta_por_pagar_mensajero`, medida antes de afirmar nada sobre ella

Es saldo al corte y su serie es un acumulado corrido, así que se midió aparte antes de asumir
simetría. Resultado: **su FORMA no difiere** de las seis de flujo — mismo `grano: "fecha"`, misma
`granularidad: "dia"`, las mismas 30 claves de cubo, las mismas claves de vista y de fila. Lo que
difiere es (a) `fuente` (`pago_mensajero_movimiento`), (b) `esAcumulado: true` y (c) **los
valores**: con movimiento sólo en el primer cubo, la métrica de flujo vuelve a `0.00` en los 29
cubos siguientes y la acumulada **repite** el saldo (`80.00` = 10.00 de arrastre + 70.00 del
primer cubo). La guardia afirma las tres cosas por separado en vez de forzar simetría.

---

## 3. Qué se hizo

### `tests/fixtures/dto-financiero-servido.ts` (nuevo)

La forma del DTO temporal deja de ser una declaración libre dentro de un `.test.tsx` y pasa a ser
**derivada** de las mismas funciones puras que usa el servicio: `resolverRango`, `trocear`,
`granularidadDe`, `esMetricaAcumulada`. Vive en `tests/fixtures/` para que la guardia (que corre
en `node` y arrastra Prisma) y el test de componente (jsdom) importen **el mismo** constructor;
importar un `.test.tsx` desde otro test registraría sus casos dos veces. Mismo sitio y mismo
motivo que `tests/fixtures/importe-analitico.ts`.

`FUENTE_TEMPORAL` es un registro **exhaustivo** sobre `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`:
una métrica que entre o salga del conjunto rompe la compilación (TS2739) en vez de dejar el doble
describiendo el reparto de ayer.

### `tests/components/TableroFinanciero.test.tsx` (modificado)

`RANGO`, `CUBOS_FECHA` y el constructor de DTO temporal se importan de la fixture compartida. El
archivo conserva lo que es suyo: la etiqueta y las **cifras** (deliberadamente ajenas a todos los
totales del archivo, para que un panel que pintara una fila donde va el titular no pueda acertar
por azar). `esAcumulado` deja de pasarse a mano.

### `tests/unit/guards/tablero-doble-vs-servicio.guardia.test.ts` (nuevo)

**Ejecuta el servicio real** y compara la forma que sale con la que el doble declara. Es la
diferencia con las dos guardias del tablero que ya existían
(`tablero-financiero.guardia.test.ts` y `tablero-lineas-trazabilidad.guardia.test.ts`): aquéllas
son censos de **texto** sobre archivos, no ejecutan nada y estructuralmente no pueden ver esta
divergencia. No se tocaron ni se duplicaron: miden otra cosa.

Sólo (a) derivar o sólo (b) comparar no bastaría, y por eso están las dos mitades:

- sólo (a) sería el espejo consigo mismo: el doble copiaría las **dependencias** del servicio, y
  el día que un manejador dejara de llamar a `granularidadDe`, el doble seguiría diciendo «dia»;
- sólo (b) ataría un literal escrito a mano, que es lo que se rompió en la 180.

---

## 4. Mutaciones de control — tanda 1

Todas con verificación de restauración **por hash** (`sha256sum -c`), por el aviso del encargo:
a un agente le falló un `writeFileSync` por un lock de Windows y dejó la mutación aplicada en
código de producción.

| # | Mutación | Archivo | Guardia | `TableroFinanciero.test.tsx` | Restaurado (hash) |
|---|---|---|---|---|---|
| **A** | `granularidadDelRango` devuelve `"no_temporal"` (equivale a escribir `granularidad: "no_temporal"` en el doble) | `tests/fixtures/dto-financiero-servido.ts` | **ROJA** (3/14) | ROJO (16 fallos) | OK |
| **B** | `serieDensa` devuelve `[]` | `lib/services/AnaliticaFinancieraService.ts` | **ROJA** (9/14) | **VERDE (93/93)** | OK |
| **C** | `FUENTE_TEMPORAL` vuelve a `wallet_tienda_movimiento` en las 7 (la mentira que había) | `tests/fixtures/dto-financiero-servido.ts` | **ROJA** (3/14) | **VERDE (93/93)** | OK |
| **D** | el id de la vista vuelve a `${metricaId}__vista` (la mentira que había) | `tests/fixtures/dto-financiero-servido.ts` | **ROJA** (3/14) | **VERDE (93/93)** | OK |
| **E** | `granularidadDe` compara contra `0` en vez de `TOPE_PUNTOS_SERIE` (30 días pasan a `"semana"`) | `lib/analytics/cubo-temporal.ts` | **ROJA** (4/14) | ROJO (10 fallos) | OK |

**La fila que justifica la guardia es la B**: el servicio cambia de forma y los 93 casos de
componente siguen en verde. Es la firma exacta del incidente. Las C y D son la misma firma sobre
las dos mentiras que el doble llevaba escritas hasta hoy.

Bajo la mutación B corrí además `tests/unit/analytics` + `analitica-financiera-serie-frontera`:
**1 archivo rojo de 119** (los tests propios de la 180, como es de esperar). Es decir: el backend
sí veía la B; lo que no la veía era el doble del tablero, y por eso la pantalla se equivocó
mientras todo lo demás estaba verde.

**Detalle de la E, que es el límite más interesante.** Los casos de comparación pura
(`formaDeDto(doble) toEqual formaDeDto(real)`) siguieron **verdes**: las dos partes derivan de
`granularidadDe`, así que se movieron juntas. Lo que la puso roja fueron los **anclajes escritos a
mano** de la guardia (`granularidad === "dia"` y `CUBOS` de longitud 30). Están ahí precisamente
por eso, y esta medición es la razón por la que no se retiran.

---

## 3 bis. Tanda 2 (2026-08-07) — las tres métricas NO temporales

Cierra el punto 5 de la §6, que quedaba abierto por escrito.

### Lo que medí antes de tocar nada

Ejecuté el servicio para `cod_recaudado`, `cuenta_por_pagar_tienda` y `conciliacion_cierres`, con
el repositorio vacío y con material, sobre la misma ventana del tablero:

| Campo | Servicio (medido) | Doble (antes) | ¿Divergía? |
|---|---|---|---|
| `cod_recaudado` · nº de vistas y orden | `[cod_recaudado__por_metodo, cod_recaudado__por_tienda]`, estable en 5 corridas | igual | no |
| `cod_recaudado` · identidad de cada vista | `metodo_pago`/`cierre_dia` y `tienda`/`wallet_tienda_movimiento`, ambas `no_temporal`, `sumableCon: []` | igual | no |
| `cuenta_por_pagar_tienda` · `vista.id` | `"cuenta_por_pagar_tienda"` | `"cuenta_por_pagar_tienda__vista"` | **SÍ** |
| `conciliacion_cierres` · `tipo` | `"conciliacion"`, sin clave `vistas` | igual | no |
| `conciliacion_cierres` · **`unidad`** | **`"conteo"`** | `"moneda"` | **SÍ** |
| filas de un desglose | 0 con repo vacío; N con material, en el orden de llegada | N propias del doble | no atable (ver abajo) |

**Hallazgo sobre el orden de las dos vistas de `cod_recaudado`.** Es determinista (`deRecaudo`
devuelve el literal `[vistaMetodo, vistaTienda]`) y estable en 5 corridas, pero **ningún spec lo
declara**: `grep` sobre `specs/127-*` y `specs/132-*` no encuentra una sola línea sobre el orden.
Y hay **dos consumidores que dependen de él**: el tablero pinta una sección por vista en orden del
DTO, y `TableroFinanciero.test.tsx` indexa `[0]` para el donut y `[1]` para las barras. Un
servicio que las intercambiara pondría el donut donde van las barras sin romper nada declarado.
Ahora está atado por ejecución, así que es un contrato ejecutable.

### Lo que se ató, y lo que no

**Se ata** (está escrito en el manejador, no depende de datos): `id`, `grano`, `fuente`,
`sumableCon`, `granularidad`, el **número** de vistas, el **orden** en que se publican, y la
cabecera entera menos `etiqueta`.

**No se ata, con la medición que lo justifica**: la cardinalidad y el orden de las **filas**. En
una serie temporal la densidad la decide el rango (`serieDensa` reparte sobre `cubos.map(() => [])`)
y por eso es una propiedad del código; en un desglose la deciden los datos (`porCubo` agrupa lo que
el repositorio devolvió y conserva su orden de llegada). Medido y afirmado en la guardia: con el
repo vacío, `cod_recaudado` publica `[0, 0]` filas; con material, `[2, 2]`, y `transferencia` sale
antes que `efectivo` porque así llegó. Forzar una atadura ahí convertiría la guardia en una fixture
disfrazada.

---

## 4 bis. DEFECTO ABIERTO — `conciliacion_cierres` formatea dinero con `unidad: "conteo"`

> **CERRADO el 2026-08-07** en la rama `fix/conciliacion-unidad-moneda` — ver
> `progress/impl_fix-conciliacion-unidad.md`. El panel declara hoy la unidad **por cifra**
> (`UNIDAD.importe`) y no lee la de la cabecera; hay caso de regresión que afirma `₡60,50` y
> niega «61», y una guardia para el mismo riesgo en el tablero
> (`tests/unit/analytics/financiera-unidad-de-vistas.guardia.test.ts`). El apartado se conserva
> entero porque es de donde salió el hallazgo, y no se toca su relato: sólo deja de afirmarse
> en presente. (El arreglo NO fue el literal de una línea que se propone al final: se declaró
> la unidad una sola vez para las tres cifras, el aviso y las columnas.)

**Esto no es una curiosidad de fixture. Es un defecto vivo en producción, y lo tapaban los dobles.**

- El catálogo declara `conciliacion_cierres` con `unidad: "conteo"` (`lib/analytics/metrics.ts`;
  `unidadDeConteo: "moneda"`), y el servicio lo publica tal cual en la cabecera del DTO.
- `PanelConciliacion.tsx:140` formatea las **tres cifras de dinero del cuadre** —«Total snapshot»,
  «Total ledger», «Diferencia»— con `formatearValor(aNumero(cifra.importe), datos.unidad)`.
- `formatearValor(x, "conteo")` usa `maximumFractionDigits: 0` y no pone moneda.

**Medido**, sustituyendo `unidad: "moneda"` por la de verdad en el doble de
`tests/components/PanelConciliacion.test.tsx` (probe temporal, restaurado por hash): el cuadre
renderiza `1 561` donde el test espera `₡1 560,50`, y `61` donde el importe es `60,50`. Es decir:
en producción esas tres cifras salen **redondeadas y sin moneda**, y un descuadre de ₡60,50 se
anuncia como «61». Dos de los siete casos de ese archivo se ponen rojos con la unidad correcta.

La causa está a la vista: el mismo archivo ya declara `unidad: "moneda"` **a mano** en las cuatro
columnas de dinero de la tabla (`COLUMNAS_CONCILIACION`, `PanelConciliacion.tsx:69-72`) y sólo el
bloque del cuadre usa `datos.unidad`. El arreglo probable es de una línea: usar el literal
`"moneda"` en la línea 140, igual que las columnas.

**NO LO HE TOCADO, y es deliberado.** (a) La UI está fuera de mi alcance. (b) Decidir si el cuadre
debe formatearse como dinero (arreglar el componente) o si el catálogo debería declarar otra unidad
es una decisión de producto, no mía; encajar cualquiera de las dos en las aserciones la
pre-decidiría. Queda **abierto** con el diagnóstico completo.

**Consecuencia inmediata sobre el árbol:** `tests/components/PanelConciliacion.test.tsx` sigue
declarando su propio doble con `unidad: "moneda"` y **no está atado** — es el único doble del DTO
financiero que queda mintiendo, y miente justo donde está el defecto. No lo corregí porque
corregirlo **exige** decidir antes lo del párrafo anterior: con la unidad de verdad, esos dos casos
sólo pueden pasar afirmando el redondeo, o sea bendiciendo el defecto. `TableroFinanciero.test.tsx`
sí quedó corregido y sigue verde (93/93): sus aserciones nunca dependieron de esa unidad, que es
precisamente por lo que la mentira llevaba ahí desde la 132 sin que nadie la viera.

---

## 4 ter. Mutaciones de control — tanda 2

Mismas reglas: restauración verificada por hash en las cuatro.

| # | Mutación | Archivo | Guardia | `TableroFinanciero.test.tsx` | Restaurado (hash) |
|---|---|---|---|---|---|
| **F** | el id vuelve a `cuenta_por_pagar_tienda__vista` (la divergencia que la §6.5 dejaba abierta) | `tests/fixtures/dto-financiero-servido.ts` | **ROJA** (2/25) | **VERDE (93/93)** | OK |
| **G** | `UNIDAD_SERVIDA.conciliacion_cierres` vuelve a `"moneda"` (la otra mentira) | `tests/fixtures/dto-financiero-servido.ts` | **ROJA** (3/25) | **VERDE (93/93)** | OK |
| **H** | las dos vistas de `cod_recaudado` INTERCAMBIADAS en el doble | `tests/fixtures/dto-financiero-servido.ts` | **ROJA** (2/25) | ROJO (5 fallos) | OK |
| **I** | las dos vistas INTERCAMBIADAS en el **servicio** (`deRecaudo`) | `lib/services/AnaliticaFinancieraService.ts` | **ROJA** (4/25) | **VERDE (93/93)** | OK |

**F, G e I repiten la firma del incidente**: el doble (o el servicio) miente y los 93 casos de
componente siguen en verde. La I es especialmente clara: intercambiar las vistas en **producción**
—lo que pondría el donut donde van las barras— no mueve una sola aserción del tablero, porque ese
archivo no ejecuta el servicio. Bajo la I corrí además `tests/unit/analytics` +
`analitica-financiera-serie-frontera`: 3 casos rojos de 1310, todos del backend.

La H es la que demuestra que el **orden** se ata de verdad: con un comparador de conjuntos o un
`sort()` de más habría pasado en verde.

---

## 5. Salida del gate

`./init.sh --rapido` (typecheck + lint + tests del grafo + todas las guardias) — ver §7.

---

## 6. Qué **NO** cubre esta guardia

La sección más valiosa. Nada de lo que sigue es un olvido: está medido y decidido.

1. **Las cifras y la `forma` del importe del doble.** El doble elige `bruto`/`neto` ajenos a todos
   los totales del test de componente a propósito, para que un panel que pintara una fila donde va
   el titular no pueda acertar por azar; atarlos al servicio destruiría esa propiedad. La `forma`
   (`solo_bruto` vs `bruto_y_neto`) **por métrica** la vigila
   `tests/unit/analytics/financiera-forma-importe.guardia.test.ts`, pero **sólo del lado del
   servicio**, contra un mapa escrito a mano. La elección de forma que hace el doble del tablero
   (`importeSoloBruto` en tres métricas, `importeConNeto` en cuatro) **sigue sin atar**. Hoy
   coincide — se comprobó — pero es un hueco abierto de la misma clase.
2. **La `moneda` del importe.** `tests/fixtures/importe-analitico.ts` la rellena con un marcador
   visible (`"moneda-que-nadie-lee"`) a propósito; el servicio pone el ISO de `lib/config/moneda`.
   Divergencia deliberada y documentada allí.
3. **La `etiqueta`.** El servicio la saca del catálogo, el doble la escribe a mano. El tablero
   pinta la que el DTO traiga, sea cual sea, así que una divergencia ahí no puede producir el
   defecto de forma. No se ata.
4. **Un cambio en `granularidadDe` / `trocear` / `resolverRango` mueve las dos partes a la vez.**
   Medido en la mutación E: la comparación pura se queda verde. Lo tapan los anclajes escritos a
   mano de la guardia (`"dia"`, 30 cubos) y los tests propios de la 180. Si alguien retira esos
   anclajes «porque son redundantes», este agujero se abre.
5. **Las filas de las tres fixtures NO temporales** (`cod_recaudado` ×2, `cuenta_por_pagar_tienda`,
   y el `porEstado`/`cuadre` de `conciliacion_cierres`). *Reescrito tras la tanda 2:* su
   **identidad** (`id`, `grano`, `fuente`, `sumableCon`, `granularidad`), el número de vistas, su
   **orden** y la cabecera **ya están atados**, y las dos divergencias que había —el sufijo
   `__vista` y la `unidad` de conciliación— están corregidas. Lo que sigue sin atar, y ahora por
   una razón medida y no por falta de tiempo, es la **cardinalidad, el orden y las cifras de sus
   filas**: los deciden los datos del repositorio, no el rango, así que no hay contrato que
   comparar (§3 bis). Si algún día el servicio pasara a rellenar esos desgloses densamente —como
   hizo la 180 con las series—, esta exclusión dejaría de estar justificada; el caso «sus filas las
   deciden los DATOS» de la guardia se pondría rojo y avisaría.
   **Sigue vivo aquí un solo hueco**, y no es de forma sino de decisión pendiente:
   `tests/components/PanelConciliacion.test.tsx` mantiene su propio doble con `unidad: "moneda"`,
   contradiciendo al servicio, porque corregirlo obliga a decidir antes el defecto de §4 bis. Es el
   **único doble del DTO financiero que queda mintiendo** en el árbol.
6. **Las fixtures de caso límite** (`panelSemanal`, `panelTemporalSinFilas`,
   `panelGranoTiendaPeroTemporal`, `panelNoTemporalDeFlujoSinFilas`, …) describen DTOs que el
   servicio **no produce hoy**, y lo declaran por escrito en su propio comentario. Están fuera a
   propósito: atarlas al servicio las borraría, y son las que ejercitan las ramas que hoy nadie
   alcanza en producción. La fixture semanal se comprobó coincidente con `trocear` (9 cubos) pero
   **no está atada**: si el servidor cambiara su anclaje semanal, seguiría verde.
7. **Nada sobre la PANTALLA.** Esta guardia no sabe si el KPI se ve, si la línea se dibuja, ni si
   el maestro entiende lo que lee. Sólo dice que el doble con el que se prueba la pantalla
   describe el DTO que el servicio produce. Que la pantalla haga lo correcto **con** ese DTO lo
   sostienen los 93 casos de `TableroFinanciero.test.tsx`, y en particular el bloque del hotfix.
8. **Nada sobre SQL.** Los dobles de repositorio devuelven filas fijas: el `WHERE` real no se
   ejecuta aquí. Eso es de `tests/integration/` y de la base falsa de la TANDA C.
9. **No hay E2E.** No existe harness de Playwright en este repo; el checkpoint E2E es inaplicable
   y el riesgo se cubre por la vía de arriba.

---

## 7. Archivos

**Nuevos**
- `tests/fixtures/dto-financiero-servido.ts` (tanda 1 como `dto-financiero-temporal.ts`; renombrado
  en la tanda 2, que lo extendió de las siete métricas temporales a las diez servidas)
- `tests/unit/guards/tablero-doble-vs-servicio.guardia.test.ts` (14 casos en la tanda 1, 25 tras la 2)
- `progress/impl_guardia-servicio-dobles.md` (este archivo)

**Modificados**
- `tests/components/TableroFinanciero.test.tsx`

**Tocados sólo durante las mutaciones y restaurados con hash verificado**
- `lib/services/AnaliticaFinancieraService.ts` (mutaciones B, I)
- `lib/analytics/cubo-temporal.ts` (mutación E)
- `tests/components/PanelConciliacion.test.tsx` (sonda de §4 bis)

---

## 8. Veredicto

Ningún doble del DTO financiero del tablero puede ya describir una forma que el servicio no produce
sin que algo se ponga rojo: nueve mutaciones, seis de ellas invisibles para la suite de componente.
Queda **un** doble mintiendo a propósito —el de `PanelConciliacion`— porque corregirlo exige
decidir antes el defecto de §4 bis, que es de producto y no mío.
