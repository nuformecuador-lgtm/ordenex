# Feature 180 — analitica financiera: desglose por fecha · bitacora de implementacion

> Rama `feature/180-analitica-financiera-serie-temporal`, cortada de `dev` @ `805fb253`.
> Spec en `specs/180-analitica-financiera-serie-temporal/`, puerta humana **cerrada** el 2026-08-05
> (§5 de `requirements.md`). Zona `backend`, `depends_on: 127`.

## 1. Que se implemento

Las **siete** metricas que hasta hoy publicaban `filas: []` en su vista de grano `fecha` —las **seis**
de caja (`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`, `egresos`, `dinero_en_caja`,
`ganancia_ordenex`) mas `cuenta_por_pagar_mensajero`— publican ya **una fila por cubo temporal** del
rango consultado. `cod_recaudado` y `cuenta_por_pagar_tienda` quedan **fuera** (Q1 = (a)): ya tienen
cubo por metodo y por tienda.

La granularidad la decide el **servidor** y viaja en el DTO (Q3 = (a)): `dia` hasta
`TOPE_PUNTOS_SERIE` = 62 dias, `semana` alineada al lunes CR por encima, con el primer cubo recortado
al inicio del rango. Con esas dos granularidades **ningun rango admisible por el borde** (hasta
`RANGO_TOPE_DIAS` = 366 dias) supera el techo de puntos del paquete de graficas.

Fuera de alcance, por decision de la puerta: el panel de lineas del tablero (Q4 = (a), esta ficha es
**solo backend** y el tablero no se ha tocado), el marcado del cubo en curso como parcial (Q2 = (a):
**no se ha metido ningun reloj** en el servicio financiero) y la cache (feature 179: no se ha anadido
ni retirado ningun `cacheTag`).

## 2. Las seis decisiones de la puerta, y donde se ven en el codigo

| | Decision | Donde vive |
|---|---|---|
| **Q1** (a) | las SIETE del conjunto | `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` en `lib/types/analitica-financiera.ts` |
| **Q2** (a) | el cubo en curso NO se marca parcial | ausencia deliberada: el constructor de `AnaliticaFinancieraService` no gana reloj (R26) |
| **Q3** (a) | el servidor agrega y lo declara | `granularidadDe()` en `lib/analytics/cubo-temporal.ts`; campo `granularidad` en `VistaFinanciera` |
| **Q4** (a) | solo backend | ni `app/` ni `components/` cambian de comportamiento; solo se completaron fixtures de test |
| **Q5** | cerrada por hecho consumado (⟨L1⟩) | ver §7 |
| **Q6** (a) | SQL crudo acotado y parametrizado | `sumarPorCuboYCategoria` y `cuentaPorPagarMensajerosPorCubo`; prosa de cabecera corregida |

## 3. Archivos

**Produccion — nuevos (1):**

- `lib/analytics/cubo-temporal.ts` — modulo **puro**: `GranularidadTemporal`, `CuboTemporal`,
  `granularidadDe()`, `trocear()`. Contrato compartido con la feature **176** (⟨D8⟩).

**Produccion — modificados (6):**

- `lib/analytics/types.ts` — `TOPE_PUNTOS_SERIE`, junto a `RANGO_TOPE_DIAS`.
- `lib/types/analitica-financiera.ts` — `GranularidadVista`, campo requerido `granularidad`,
  `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`, `tieneDesglosePorFecha()`.
- `lib/interfaces/repositories/IIngresosAnaliticaRepository.ts` — `AgregadoCuboCategoriaCaja`,
  `sumarPorCuboYCategoria`.
- `lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository.ts` — `AgregadoCuboTipo`,
  `cuentaPorPagarMensajerosPorCubo`, `cuentaPorPagarMensajerosAntesDe`.
- `lib/repositories/IngresosAnaliticaRepository.ts` y `lib/repositories/CuentasPorPagarAnaliticaRepository.ts`
  — los tres metodos, y la correccion de prosa de la Q6 (§7).
- `lib/services/AnaliticaFinancieraService.ts` — `serieDensa`, `agruparPorIndiceDeCubo`, y las series
  de `deCaja`, `deTesoreria` y `deCuentaDeMensajeros`.

**Tests — nuevos (9):** `tests/unit/analytics/cubo-temporal.test.ts`,
`cubo-temporal-tope.guardia.test.ts`, `financiera-desglose-ids.guardia.test.ts`,
`financiera-granularidad.test.ts`, `financiera-ingresos-cubo-repo.test.ts`,
`financiera-cuentas-por-pagar-cubo-repo.test.ts`, `financiera-180-trazabilidad.guardia.test.ts`;
`tests/unit/services/analitica-financiera-serie.test.ts`, `analitica-financiera-serie-frontera.test.ts`;
`tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`.

**Tests — modificados (12):** los guardias de §5 mas los fixtures que el campo requerido obligo a
completar (`financiera-contratos.test.ts`, `tablero-financiero-adaptar/cargar.test.ts`,
`_fake-prisma-dinero.ts`, `_dobles-analitica-financiera.ts`, `analitica-financiera-service.test.ts`,
`analitica-financiera-derivacion.test.ts`, `tests/components/TableroFinanciero.test.tsx`,
`AnaliticaPage.test.tsx`).

## 4. Las tres decisiones de diseno que sostienen las cifras

**⟨D4⟩ — la frontera del dia CR sigue viviendo en un solo archivo.** El troceo se hace en TypeScript
(`cubo-temporal.ts`, que deriva todo de `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`) y las
fronteras viajan a SQL como **parametros**. En las consultas **no hay** `AT TIME ZONE`, ni
`America/Costa_Rica`, ni `date_trunc` con zona, ni `interval '6 hours'`. Un `date_trunc` con zona
habria sido una **segunda** definicion del dia operativo, invisible para todos los tests de
`fecha-cr.ts`: el off-by-one de seis horas del que avisa `ranges.ts`, reintroducido por la puerta de
atras. El repositorio devuelve un **indice de cubo**, no una fecha: **el SQL nunca emite una fecha**.

**⟨D5⟩ — `cuenta_por_pagar_mensajero` es un acumulado corrido, no un flujo.** Es `esAcumulado: true`.
Su serie **no** es el movimiento del cubo —esa seria una cifra distinta, plausible y falsa, la peor
combinacion— sino el saldo al cierre sobre todo el libro anterior. Se construye con el **arrastre**
(`cuentaPorPagarMensajerosAntesDe`, `< rango.desde`, sin cota inferior) mas el movimiento de cada
cubo, acumulando `devengo` y `pago` **por separado** en `Prisma.Decimal` y llamando a
`derivarCuentaPorPagar` **una vez por cubo**. El servicio solo **suma**; la resta con signo la sigue
haciendo la funcion compartida que `/mi-wallet` usa. **Ni un `.sub(` nuevo** (R17).

**⟨D7⟩ / R27 — un solo constructor de importe por vista.** El importe de cada fila sale de la
**misma funcion** que el `total` de su vista, y por tanto es **la misma variante** de la union
`ImporteConNeto | ImporteSoloBruto`. Esto no lo atrapa el tipo por si solo, porque **cada fila se
tipa por separado**: una vista con total `solo_bruto` y filas con `neto` compila perfectamente. Por
eso tiene test propio, y por eso la mutacion 1 de §6 es la mas importante de la tanda.

## 5. Guardias: que se toco y por que, uno a uno

R31 exige **actualizar**, no relajar. Los cinco cambios, cada uno justificado por separado:

1. **`financiera-repositorios.guardia.test.ts` — lista de propagacion de 8 a 11 metodos.** Ampliacion
   pura: los tres metodos nuevos entran al caso que exige que un fallo de base suba tal cual. El
   conteo anclado (`toHaveLength(11)`) sigue siendo una asercion que obliga a mirar la lista cuando un
   repositorio gane un metodo. **Nada retirado.**
2. **`financiera-repositorios.guardia.test.ts` — detector de conversion a `number` ENSANCHADO con
   `\bNumber\s*\(`.** Es el unico cambio que **endurece** un detector, y se hizo porque se **midio**
   que la mutacion «emitir `suma` con `Number(x).toFixed(2)`» **sobrevivia** al detector viejo (solo
   miraba `parseFloat` y `.toNumber(`) y aun asi pasaba dinero por coma flotante. Hoy no hay ni una
   ocurrencia de `Number(` en los cuatro repositorios de la 127, asi que el ensanche **no amnistia ni
   obliga a tocar nada**. Lleva ademas su contrapeso: un caso que comprueba que **no** marca
   `new Prisma.Decimal(...)`, para que nadie acabe aflojandolo por falsos positivos. Evidencia en la
   mutacion 5 de §6.
3. **`financiera-fuente.guardia.test.ts` — censo de trece a catorce modulos.** `cubo-temporal.ts` es
   el unico archivo de produccion nuevo y **no entra por el brazo de descubrimiento por import**
   (es puro y no importa nada de la 127 — esa es justamente su propiedad, ⟨D8⟩). Sin declararlo, el
   sitio donde se decide la ventana de cada consulta quedaria fuera del censo de fuente. Se anadio
   ademas una asercion **nueva** (`toHaveLength(14)`): el guardia queda **mas** fuerte que antes.
4. **`modulo-puro.guardia.test.ts` — alta de `cubo-temporal` en `CARGADORES`.** Nueve modulos → diez.
   Ninguna asercion retirada; `ARISTAS_PERMITIDAS.length === 1` sigue intacta y verde.
5. **`financiera-180-trazabilidad.guardia.test.ts` — NUEVO.** Calcado del de la 127 para el mapa de
   §«Mapa completo». Anade dos casos que el de la 127 no tiene: los tests citados no pueden ser
   cascarones, y la seccion no puede comerse otro `## `.

**`cache-financiera.guardia.test.ts` sigue VERDE sin tocarlo** (R30 / T5.3): su ultimo commit es de
la feature 128. Ni un `cacheTag` anadido ni retirado.

## 6. Evidencia de mutacion

Diecinueve mutaciones, cada una aplicada al codigo de **produccion**, corrida, y restaurada por la
edicion inversa exacta (nunca con `git checkout`), verificando el arbol limpio despues.
**Dieciocho murieron; una no es matable por comportamiento y esta explicada en §6.1.**

| # | Mutacion | Resultado |
|---|---|---|
| 1 | `granularidadDe`: `<=` → `<` | **MUERTA** — 4 casos, entre ellos «un rango de 62 dias se trocea por dia» |
| 2 | primer cubo semanal anclado al lunes anterior | **MUERTA** — 4 casos de R21/R10 |
| 3 | troceo diario con off-by-one (se pierde el ultimo dia) | **MUERTA** — 6 casos, incl. cobertura exacta del rango |
| 4 | `TOPE_PUNTOS_SERIE = 61` | **MUERTA** — el guardia de igualdad con `MAX_PUNTOS_SERIE` |
| 5 | clave por `toISOString().slice(0,10)` | **NO MATABLE POR COMPORTAMIENTO** — ver §6.1 |
| 6 | `...AntesDe`: `lt: rango.desde` → `lt: rango.hasta` | **MUERTA** — el caso del saldo de arrastre |
| 7 | `...AntesDe`: anadirle `gte: rango.desde` | **MUERTA** |
| 8 | limite de cubo desplazado un dia en el SQL | **MUERTA** — el caso de integracion de la frontera de dia CR |
| 9 | `try { ... } catch { return [] }` en una consulta | **MUERTA** — el guardia de texto y el caso de propagacion, a la vez |
| 10 | filas con `importeConNeto(...)` fijo y total con el selector (**R27**) | **MUERTA** — 2 casos del test propio de R27, y **por separado** 2 del guardia de la 183 |
| 11 | publicar el movimiento del cubo en vez del saldo acumulado | **MUERTA** — R9, R13, R14 y R17 |
| 12 | `bruto` del cubo con `neto` acumulado | **MUERTA** — R13 muere **por el `bruto`**: el test compara campo a campo de verdad |
| 13 | serie dispersa (filtrar los cubos vacios) | **MUERTA** — R7, R8, y de rebote R1, R10, R19, R28 |
| 14 | emitir las filas en el orden de llegada del repositorio | **MUERTA** — R6, con el doble alimentado con los cubos **revueltos** a proposito |
| 15 | pasar `trocear(otroRango)` al repositorio | **MUERTA** — y **solo** el test de coherencia cubos ↔ consulta, que es lo correcto |
| 16 | perder el ultimo cubo de la serie | **MUERTA** — la invariante de conservacion, 3 casos |
| 17 | `Number(x).toFixed(2)` en un repositorio | **MUERTA con el detector ensanchado; SOBREVIVIA con el detector pre-180** — ver §5.2 |
| 18 | decision por **id suelto** en el servicio (`consulta.metrica.id === "egresos"`) | **MUERTA** — el guardia propio del R2; y `listasDeIdsAMano` **la deja pasar**, ver §7.5 |
| 19 | anadir `cod_recaudado` al conjunto con desglose | **MUERTA** — el guardia propio del R2 |

### 6.1 La unica mutacion que no es matable, dicha y no escondida

Emitir la clave del cubo con `desde.toISOString().slice(0, 10)` en vez de `fechaCalendarioCR(desde)`
**no la mata ningun test de comportamiento, y no puede matarla ninguno**: todo `desde` de un cubo es
por construccion `inicioDelDiaCREnUtc(fecha)` = `${fecha}T06:00:00.000Z`, y las 06:00Z caen en la
**misma** fecha en UTC y en CR. No existe entrada que las distinga.

Lo que si la mata es el **guardia de texto preexistente** `ranges-reuso.guardia.test.ts` («no
construye fechas con `toISOString().slice` en `lib/analytics`»), que se puso rojo. El caso de R10 se
reforzo ademas con `la clave se lee en hora de Costa Rica y no en UTC dentro de la ventana del cubo`,
que si discrimina cualquier derivacion de la clave a partir de un instante **interior** al cubo
(`hasta - 1ms` leido en UTC ya es el dia siguiente). El limite queda escrito en el propio test.

### 6.2 Matiz honesto sobre la mutacion 16 (R12)

Perder el ultimo cubo mata la invariante de conservacion **en el `toHaveLength` que precede a la
comparacion decimal**, no en el `Σ == total`. Que la aritmetica del detector discrimina de verdad lo
sostiene el caso hermano `R12 · el detector discrimina: perder un cubo rompe la igualdad`, que corta
la ultima fila del resultado y afirma que la Σ **deja** de ser igual al total — y que paso verde bajo
la mutacion, o sea que la comparacion no es una tautologia.

## 7. Hechos que contradecian a la spec, y como se trataron

1. **Donde la spec dice «la 182», es la 183**, y ya esta `done` en produccion (PR #288). La 183 **no
   hizo lo que su ficha anunciaba** (`progress/decision_183.md`): retiro el `neto` en **tres**
   metricas, no en cuatro, y `egresos` **gano** `ingreso_ajuste` y **conserva** el neto. Todo el
   trabajo de esta feature se hizo contra el codigo real, no contra la ficha.
2. **`ImporteAnalitico` es una union discriminada** con campo `forma`, no un registro de dos campos.
   Por eso R27 vale mas que cuando se escribio, y tiene test propio (§4, mutacion 10).
3. **La prosa «ni un `$queryRaw`» de `IngresosAnaliticaRepository` era falsa y contradecia a los
   guardias**, que ya permitian SQL crudo sobre las cinco tablas de `TablaDinero` si el archivo
   recibe `ConsultaAnalitica`. Corregida **en este mismo PR** (Q6), declarando que cambia, por que, y
   con que cuatro limites.
4. **El cast de `timestamp(3)` se midio contra Postgres, no se supuso.** Hace falta `::timestamp` y
   **no** `::timestamptz`: `fecha_movimiento` es `timestamp(3)` sin zona, y con `::timestamptz`
   Postgres interpretaria el texto en el huso de la **sesion** (el del proceso de Node) y desplazaria
   toda frontera cinco o seis horas **sin que nada fallara**. `width_bucket(anyelement, anyarray)`
   **si** esta disponible (PG >= 14), asi que no hizo falta la variante `CASE` de `design.md §5.1`.
5. **El guardia `listasDeIdsAMano` no sirve para probar el R2** (⟨L2⟩): solo marca arrays de **dos o
   mas** ids, asi que una decision por id **suelto** pasa verde. Se escribio un guardia propio,
   `financiera-desglose-ids.guardia.test.ts`, que marca **con uno solo**. **Medido, no supuesto**
   (mutacion 18): sembrando `consulta.metrica.id === "egresos"` en `AnaliticaFinancieraService.ts`,

   ```
   financiera-desglose-ids.guardia.test.ts   Tests  1 failed | 10 passed (11)
     × R2 · el censo no encuentra ni un id suelto entre comillas fuera de la declaracion
       + "lib/services/AnaliticaFinancieraService.ts: egresos: === \"egresos\""

   tablero-financiero.guardia.test.ts        Tests  24 passed (24)   ← listasDeIdsAMano LO DEJA PASAR
   ```

   Es exactamente la deuda que la ficha de la 183 declara sin dueno, y exactamente por lo que el R2
   no podia apoyarse en ese guardia. La 180 **no la salda** para el resto del repo: solo cubre el
   backend de la analitica financiera.
6. **Los numeros de linea de la tabla §1 de `requirements.md` estaban movidos.** Todo se localizo por
   simbolo.

## 8. Interacciones con las fichas hermanas, declaradas y no resueltas

- **176** — `lib/analytics/cubo-temporal.ts` se publica como contrato compartido (⟨D8⟩). Si la 176
  necesitase otra forma de cubo, la contradiccion aparece **en ese archivo** y no como dos contratos
  incompatibles descubiertos en la pantalla.
- **179** (cache) — **declarada, no resuelta**. El DTO de las siete metricas crece hasta ~62 filas: la
  179 debe dimensionar la entrada de cache con ese tamano. **La invalidacion no cambia**: las filas
  salen de los mismos ledgers y de la misma consulta, luego los mismos escritores la invalidan. Esta
  feature **no anade ni retira ningun `cacheTag`** (R30).
- **181** (etiquetas de tienda) — **sin interseccion**: no se han creado cubos `fecha x tienda` (R28).
- **132** (tablero) — el adaptador ya sabe leer `filas`, asi que la serie llega sin tocar el tablero.
  El **panel de lineas es una ficha nueva** (Q4 = (a)).

## 9. Deuda que esta feature NO cubre, dicha explicitamente

- **R30 se apoya en un guardia heredado de la 128** que verifica el **estado**, no el diff: mide que
  el dominio financiera no esta cacheado y sigue sin estarlo, pero no distingue «la 180 no lo toco»
  de «alguien lo quito y lo volvio a poner». Es lo mejor comprobable sin un guardia branch-scoped,
  que caducaria al mergear.
- **R31 se apoya en que los guardias ampliados esten verdes con sus cuentas ancladas** (11 metodos, 14
  modulos). Eso demuestra que cubren lo nuevo; no demuestra que nadie los relajara en el mismo commit.
  La mutacion 17 es la evidencia de que el unico detector que se ensancho se endurecio de verdad.
- **`pago_mensajero_movimiento` no tiene indice por `fecha_movimiento`** (solo
  `@@index([mensajeroId, fechaMovimiento])`, cuyo prefijo es el mensajero). Una agregacion sin
  mensajero cae en seq scan — **pero eso ya ocurria hoy** con `cuentaPorPagarMensajerosAlCorte`, que
  agrega el libro entero sin cota inferior. Esta feature **no empeora** el plan: anade una particion
  sobre la misma lectura. Si el volumen lo exigiera, el arreglo es una ficha propia con su migracion
  up/down, no un anexo silencioso a esta.
- **Dos dobles con filas cruzadas** (`categoria egreso_* + tipo ingreso`, que violan el CHECK
  categoria↔tipo de la 173) siguen en `financiera-ingresos-repo.test.ts` y
  `analitica-financiera-derivacion.test.ts`. Son deuda declarada de otra ficha y **no se han
  arreglado**; los dobles nuevos de esta feature **no los copian**.

## Mapa completo `R1..R32` → test

El guardia del R32 exige los 32 numeros sin saltos ni repetidos, y que cada fila cite al menos un
archivo `.test.ts` que EXISTA en el arbol. Lo que el guardia **no** puede comprobar —que el test
citado mida de verdad ese requisito— lo sostiene la seccion «Evidencia de mutacion».

| Req | Comportamiento que se verifica | Test |
|---|---|---|
| R1 | las SIETE del conjunto traen tantas filas como cubos, en las dos granularidades | `tests/unit/services/analitica-financiera-serie.test.ts` |
| R2 | el conjunto con desglose es UNA constante de siete ids y ningun archivo decide por un id suelto | `tests/unit/analytics/financiera-desglose-ids.guardia.test.ts` |
| R3 | las tres metricas de fuera publican el DTO de la 127 palabra por palabra | `tests/unit/analytics/financiera-granularidad.test.ts` |
| R4 | toda vista declara `granularidad`, con valor del dominio, y sin ella no compila | `tests/unit/analytics/financiera-granularidad.test.ts` |
| R5 | toda fila tiene exactamente las claves `cubo` e `importe`, y la vista sus siete de siempre | `tests/unit/analytics/financiera-granularidad.test.ts`, `tests/unit/services/analitica-financiera-serie-frontera.test.ts` |
| R6 | aunque el repositorio devuelva los cubos revueltos, la serie sale ascendente y sin claves repetidas | `tests/unit/services/analitica-financiera-serie.test.ts`, `tests/unit/analytics/cubo-temporal.test.ts` |
| R7 | con movimiento en un solo dia de cinco, la serie sigue trayendo CINCO filas | `tests/unit/services/analitica-financiera-serie.test.ts` |
| R8 | los cubos sin movimiento de una metrica de flujo valen cero con escala 2 en TODOS sus campos | `tests/unit/services/analitica-financiera-serie.test.ts` |
| R9 | en la acumulada, un cubo sin movimiento REPITE el saldo anterior y no vale cero | `tests/unit/services/analitica-financiera-serie.test.ts` |
| R10 | la clave de cada fila es la fecha CR del primer dia del cubo, leida en hora de Costa Rica | `tests/unit/analytics/cubo-temporal.test.ts`, `tests/unit/services/analitica-financiera-serie.test.ts` |
| R11 | toda frontera sale de `fecha-cr`; dos movimientos separados por 1 ms sobre las 06:00Z caen en cubos distintos | `tests/unit/analytics/cubo-temporal.test.ts`, `tests/integration/repositories/financiera-cubo-temporal.integration.test.ts` |
| R12 | Σ de las filas == total, campo a campo y en decimal exacto, en las dos granularidades | `tests/unit/services/analitica-financiera-serie.test.ts` |
| R13 | en la acumulada, la ULTIMA fila es el total de la vista campo a campo (tambien el `bruto`) | `tests/unit/services/analitica-financiera-serie.test.ts` |
| R14 | cada fila de la acumulada es el saldo al cierre sobre todo el libro anterior, con arrastre sin cota inferior | `tests/unit/services/analitica-financiera-serie.test.ts`, `tests/integration/repositories/financiera-cubo-temporal.integration.test.ts` |
| R15 | anadir el desglose no mueve ni un total, ni al cambiar de granularidad | `tests/unit/services/analitica-financiera-serie.test.ts` |
| R16 | ni el servicio ni los cuatro repositorios convierten dinero a `number`; todo importe es cadena de escala 2 | `tests/unit/services/analitica-financiera-serie-frontera.test.ts`, `tests/unit/analytics/financiera-repositorios.guardia.test.ts`, `tests/unit/analytics/financiera-ingresos-cubo-repo.test.ts` |
| R17 | los tres manejadores no escriben ninguna resta y llaman a la derivadora que les toca | `tests/unit/services/analitica-financiera-serie-frontera.test.ts`, `tests/unit/services/analitica-financiera-serie.test.ts` |
| R18 | hasta el tope de puntos se trocea por dia; un dia mas y pasa a semana alineada al lunes CR | `tests/unit/analytics/cubo-temporal.test.ts` |
| R19 | ningun rango admisible (1..366 dias) produce mas filas que el tope, empiece el dia que empiece | `tests/unit/analytics/cubo-temporal.test.ts`, `tests/unit/services/analitica-financiera-serie.test.ts` |
| R20 | `TOPE_PUNTOS_SERIE` es el mismo numero que `MAX_PUNTOS_SERIE`, leidos de las dos fuentes | `tests/unit/analytics/cubo-temporal-tope.guardia.test.ts` |
| R21 | con granularidad semana el primer cubo empieza en el inicio del rango y su clave es ESE dia | `tests/unit/analytics/cubo-temporal.test.ts` |
| R22 | los cubos que llegan al repositorio son `trocear(consulta.rango)`, y la consulta entra entera y sin forjar | `tests/unit/services/analitica-financiera-serie-frontera.test.ts`, `tests/unit/analytics/financiera-ingresos-cubo-repo.test.ts`, `tests/unit/analytics/financiera-cuentas-por-pagar-cubo-repo.test.ts`, `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` |
| R23 | el SQL crudo nuevo no nombra ninguna tabla fuera de `TablaDinero` | `tests/unit/analytics/financiera-fuente.guardia.test.ts`, `tests/unit/analytics/financiera-ingresos-cubo-repo.test.ts`, `tests/unit/analytics/financiera-cuentas-por-pagar-cubo-repo.test.ts` |
| R24 | un rol prohibido no llega a los tres metodos nuevos y ningun uuid sembrado cruza al DTO | `tests/unit/services/analitica-financiera-serie-frontera.test.ts`, `tests/unit/analytics/financiera-cuentas-por-pagar-cubo-repo.test.ts` |
| R25 | un fallo de cualquiera de los tres metodos nuevos sube tal cual; ni `try`/`catch` ni `"0.00"` por defecto | `tests/unit/analytics/financiera-repositorios.guardia.test.ts`, `tests/unit/services/analitica-financiera-serie-frontera.test.ts`, `tests/unit/analytics/financiera-ingresos-cubo-repo.test.ts` |
| R26 | dos ejecuciones con los mismos datos producen el mismo DTO; ni reloj ni orden del plan de la base | `tests/unit/services/analitica-financiera-serie.test.ts`, `tests/unit/analytics/cubo-temporal.test.ts`, `tests/unit/analytics/financiera-ingresos-cubo-repo.test.ts` |
| R27 | el total y TODAS las filas de una vista comparten variante de `ImporteAnalitico`, clave a clave | `tests/unit/services/analitica-financiera-serie.test.ts`, `tests/unit/analytics/financiera-forma-importe.guardia.test.ts` |
| R28 | toda clave de una vista temporal es SOLO una fecha, sin separador de dimensiones | `tests/unit/services/analitica-financiera-serie.test.ts`, `tests/unit/analytics/financiera-granularidad.test.ts` |
| R29 | `lib/analytics/cubo-temporal.ts` es un modulo puro: se importa sin `DATABASE_URL` y su troceo no depende del reloj | `tests/unit/analytics/modulo-puro.guardia.test.ts`, `tests/unit/analytics/cubo-temporal.test.ts` |
| R30 | ningun archivo envuelve el servicio ni los repositorios financieros con la cache | `tests/unit/analytics/cache-financiera.guardia.test.ts` |
| R31 | los guardias de superficie de la 127 cubren los archivos y los ONCE metodos nuevos, y siguen verdes | `tests/unit/analytics/financiera-repositorios.guardia.test.ts`, `tests/unit/analytics/financiera-fuente.guardia.test.ts` |
| R32 | el mapa `R1..R32` esta completo, sin saltos ni repetidos, y cita tests que existen en el arbol | `tests/unit/analytics/financiera-180-trazabilidad.guardia.test.ts` |

Los **32** requisitos tienen fila. **Ninguna se relleno con un test que no lo mida**: los dos
requisitos cuya cobertura es mas debil de lo que parece (R30 y R31) estan dichos en §9.

## 11. Verificacion — salida real

Baseline medido **en esta rama** antes de tocar nada (no citado de una bitacora vieja):
typecheck limpio; `tests/unit/analytics` + `analitica-financiera-service.test.ts` +
`guards/tablero-financiero.guardia.test.ts` = **102 archivos / 1108 tests, todos verdes**.

Al cierre:

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida — limpio)

$ pnpm exec vitest run tests/unit/analytics tests/unit/services tests/unit/guards
 Test Files  273 passed (273)
      Tests  3912 passed (3912)

$ pnpm exec vitest run tests/components/TableroFinanciero.test.tsx tests/components/AnaliticaPage.test.tsx
 Test Files  2 passed (2)
      Tests  72 passed (72)

$ pnpm run lint
✖ 48 problems (0 errors, 48 warnings)
```

**Delta de rojos: 0.** Los 48 warnings de lint son 44 preexistentes mas 4 nuevos, todos del mismo
tipo (`'_consulta' is defined but never used` en los stubs de doble de
`_dobles-analitica-financiera.ts`), que es la convencion ya usada en el repo para parametros de
firma no consumidos por un doble. **Cero errores** y **cero warnings** en los diez archivos nuevos.

El test de integracion (`tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`)
se salta solo sin `DATABASE_URL` y se corrio contra la base real pasandola **inline**; nunca se
escribio un `.env` dentro del worktree.

### 11.1 Gate por tanda

```
$ ./init.sh --rapido
✓ lint paso
  test:cambiados   Test Files  93 passed | 3 skipped (96)   Tests  1087 passed | 24 skipped
  test:guardias    Test Files  64 passed (64)               Tests   860 passed
✓ test:rapido paso
✓ todas las migraciones tienen down.sql
== init OK ==
```

### 11.2 Suite completa: 3 rojos, y **no son de esta feature**

```
$ pnpm exec vitest run
 Test Files  1 failed | 931 passed | 10 skipped (942)
      Tests  3 failed | 11615 passed | 157 skipped (11775)
```

Los tres estan en `tests/integration/db/analytics-daily-migration.test.ts` y **todos** dicen lo
mismo: `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. Es un guardia de
drift que invoca `prisma migrate diff` y necesita la variable.

**Causa: este worktree no tiene `.env` a proposito** (instruccion explicita: no crear uno dentro del
worktree). **No es una regresion**, y no se supone — se comprobo pasando la URL **inline**:

```
$ DATABASE_URL=<inline> pnpm exec vitest run tests/integration/db/analytics-daily-migration.test.ts
 Test Files  1 passed (1)
      Tests  62 passed (62)
```

Esta feature **no toca `db/schema.prisma` ni anade ninguna migracion** (⟨D⟩ `design.md` §4: ninguna
migracion, ninguna tabla nueva, ningun cambio de esquema, de RLS ni de indice), asi que no tiene por
donde afectar a ese guardia. En un checkout con `.env`, `./init.sh` completo pasa.

**Delta de rojos atribuible a la 180: 0.**
