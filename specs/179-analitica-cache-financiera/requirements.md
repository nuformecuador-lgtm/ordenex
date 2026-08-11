# 179 — analitica: cache financiera + invalidacion por ledger · requirements

> Zona: backend. `complexity: medium`. `depends_on: [128]`. Rama
> `feature/179-analitica-cache-financiera`, worktree `C:/w179`, nacida de `origin/dev`.
>
> **De donde sale.** `specs/128-analitica-cache-invalidacion/design.md §14` y la decision **D2**
> (`specs/128/requirements.md:49-62`). La 128 cacheo el dominio `operativa` y dejo el dinero
> FUERA a proposito, con **R15 prohibiendolo con un guardia vivo**
> (`tests/unit/analytics/cache-financiera.guardia.test.ts`). Esta feature es el PR que sustituye
> ese guardia por la invalidacion real. **Retirarlo sin la invalidacion completa deja el agujero
> abierto y en silencio; retirarlo y sustituirlo son la misma tanda o no son nada.**
>
> **Lo que compra:** el tablero financiero deja de pagar sus consultas de ledger en cada request.
> **Lo que arriesga:** servir dinero rancio. La diferencia entre las dos cosas es que TODOS los
> escritores de los tres ledgers invaliden, no cuatro de cinco.

**Como se leen las mutaciones.** Un requisito no esta cubierto porque exista un test verde: esta
cubierto porque **romper la implementacion de esa forma concreta pone rojo el test nombrado**.
Cada `R<n>` lleva su mutacion escrita. Sin mutacion, el requisito no vale.

---

## 0. Lo que la ficha dice y el arbol desmiente (medido, no heredado)

Todo lo de esta seccion esta verificado leyendo `C:/w179`. Donde la ficha y el arbol discrepan,
manda el arbol y se dice aqui en vez de arrastrarlo.

**(0.a) Los escritores no son cinco: son OCHO puntos de escritura, en SIETE piezas vivas mas un
CLI.** Los tres ledgers (`wallet_movimiento`, `wallet_tienda_movimiento`,
`pago_mensajero_movimiento`) se escriben EXCLUSIVAMENTE por `createMany` dentro de los tres
repositorios (`WalletMovimientoRepository.ts:76`, `WalletTiendaMovimientoRepository.ts:84`,
`PagoMensajeroMovimientoRepository.ts:126`) — no hay una sola escritura cruda fuera de ellos. Los
llamadores de `crearMovimientos` en `lib/`, `app/` y `scripts/` son, hoy, EXACTAMENTE estos:

| # | punto de escritura | entrada | ¿en un request de Next? | ¿en la lista de la ficha? |
|---|---|---|---|---|
| 1 | `lib/services/WalletEgresoService.ts:51` y `:93` | Server Action `lib/actions/wallet-egresos.ts` | si | si |
| 2 | `lib/services/LiquidacionService.ts:225,322,549,565` | Server Action `lib/actions/liquidacion.ts` | si | si |
| 3 | `lib/services/GeneracionGastosFijosService.ts:73` | Route handler `app/api/cron/generar-gastos-fijos/route.ts:66` | **si** | si |
| 4 | `lib/repositories/IncidenteAdminRepository.ts:327` | Server Action `lib/actions/incidentes.ts` → `IncidenteAdminService` | si | si (indemnizaciones) |
| 5 | `lib/repositories/CierresAdminRepository.ts:665,672,697,708,713,725` | `aprobarCierre` (`CierresAdminService.ts:421`) y `aprobarCierreBodega` (`CierresBodegaAdminService.ts:289`) | si | si |
| 6 | `lib/services/WalletService.ts:177` (`registrarMovimientoManual`) | Server Action `lib/actions/wallet.ts:150` | si | **NO** |
| 7 | `lib/services/CajaPagoTiendaFeedService.ts:40` y `:65` | (a) via `LiquidacionService` → cubierto por #2; (b) via el CLI de #8 | (a) si / (b) **no** | **NO** |
| 8 | `lib/services/CajaBackfillTesoreriaService.ts:92` | `scripts/backfill-caja-tesoreria.ts` (proceso `tsx`) | **NO** | **NO** |

**Consecuencia directa:** una spec que se limitara a los cinco nombres de la ficha dejaria
`registrarMovimientoManual` —un egreso o ingreso de caja que un maestro mete a mano y que entra
en `egresos`, `dinero_en_caja` y `ganancia_ordenex`— sirviendo dinero rancio en silencio. Que es,
palabra por palabra, el modo de fallo que D2 rechazo. Por eso el mecanismo de vigilancia de esta
feature es un **CENSO DEL ARBOL** (R17) y no una lista de rutas: la lista de la ficha ya envejecio
antes de escribirse.

**(0.b) «El cron que escribe fuera de una peticion» no existe donde la ficha lo pone.** El cron de
gastos fijos es un **route handler** (`app/api/cron/generar-gastos-fijos/route.ts:80`), o sea
dentro de un request: `revalidateTag` funciona ahi. Quien SI escribe fuera de todo request es el
**backfill de tesoreria** (`scripts/backfill-caja-tesoreria.ts`), que es el mismo problema que la
128 resolvio encolando un job (`design.md §7.1` de la 128). Ver **Q2**.

> **⚠ CORRECCION FECHADA — 2026-08-10 (M4 del review).** Este documento decia «las ocho metricas
> financieras» en R1, R3, D1 y en `design.md §4bis`. **Son DIEZ** desde la feature 173, que anadio
> `dinero_en_caja` y `ganancia_ordenex`; el propio contrato lo dice
> (`lib/types/analitica-financiera.ts`, `IDS_FINANCIERAS_SERVIDAS`, «Eran OCHO hasta la feature
> 173»). **No se forzo nada al implementar**: todos los tests enumeran desde
> `listarMetricas({ dominio: "financiera" })` y la politica de cache declara las diez. El numero no
> cambia ninguna decision —ni D1, ni D3, ni el alcance— pero un requisito con un numero equivocado
> es un requisito que no se puede verificar contra el arbol, asi que se corrige aqui y en los
> cuatro sitios. **Los OCHO que si son ocho y no se tocan: los PUNTOS DE ESCRITURA** (§0.a), que no
> tienen nada que ver con el numero de metricas.

**(0.c) Aqui NO hace falta codec, y eso no es suerte: hay que vigilarlo.** El valor a cachear es
`ResultadoFinanciero` (`lib/types/analitica-financiera.ts:272`), que es JSON-safe de punta a
punta: todo importe viaja como `string` escala 2, el unico `number` es el CONTEO de cierres
(`FilaConciliacion.cantidad`) y no hay `bigint`, ni `Date`, ni `Map`. Es la diferencia con R9 de
la 128, donde `CuboRollup.segCicloAcum` es `bigint` y `JSON.stringify` **lanza**. Aqui no lanza:
un campo futuro de tipo `Date` **degradaria en silencio** a `string` y la vista seguiria pintando.
De ahi **R3**, que es el guardia que ocupa el sitio del codec.

**(0.d) Los tres ledgers estan cerrados por la puerta de los repositorios.** No hay ni un
`walletMovimiento.create*` fuera de `lib/repositories/`. Eso es lo que hace que el censo de R17
sea posible y barato.

---

## T0 — PUERTA CERRADA (D1–D4)

Las cuatro decisiones que no me correspondian las respondio el **humano el 2026-08-10**, todas con
la recomendacion de esta spec. Estan al final del archivo como **D1–D4**, con su motivo y **con las
alternativas descartadas y su porque** — que se conservan a proposito: son lo que impide que dentro
de tres semanas alguien reabra la decision creyendo que nadie la penso.

**No queda ninguna pregunta abierta.** Los requisitos de abajo estan redactados para las respuestas,
no para las preguntas: **R16** (D4), **R26** y **R27** (D2) y **R28** (D3) nacen o se fijan aqui.

> **Numeracion.** R26–R28 se numeran por **orden de creacion** —nacieron al cerrar T0—, no por
> posicion en el documento. Renumerar habria roto el mapa `R<n> → test` que cada requisito ya cita.

---

## A. Correccion: la cache no puede cambiar el dinero servido

**R1.** Para toda consulta valida de las **diez** metricas financieras del catalogo, el resultado
servido **desde cache** DEBE ser identico —campo a campo, tipo a tipo— al servido con la cache
deshabilitada.
*Test: `tests/unit/analytics/cache-financiera-equivalencia.test.ts` › «las diez metricas sirven
desde cache exactamente el mismo DTO que sin cache».*
*Mutacion: que el decorador devuelva `JSON.parse` sin comparar la forma → `esAcumulado` o
`sumableCon` se pierden y la igualdad profunda falla → rojo.*

**R2.** MIENTRAS la cache este habilitada, CUANDO llegue una segunda consulta equivalente a una
anterior no invalidada **de una metrica declarada cacheable** (R28), el sistema NO DEBE volver a
consultar ninguno de los cuatro repositorios financieros.
*Test: `tests/unit/analytics/cache-financiera-decorador.test.ts` › «una segunda consulta
equivalente no vuelve a llamar a ningun repositorio financiero».*
*Mutacion: que el decorador delegue siempre → el contador de llamadas del servicio interno pasa de
1 a 2 → rojo. (Sin R2 todos los requisitos de invalidacion serian vacuos: no se puede demostrar
que algo se invalida si nunca se cachea.)*

**R3.** *(el guardia que ocupa el sitio del codec de la 128)* Todo valor que se guarde en cache
DEBE sobrevivir a un viaje `JSON.stringify` → `JSON.parse` **sin cambiar de tipo en ningun campo**.
El sistema NO DEBE guardar valores con `bigint`, `Date`, `Map`, `Set`, `Prisma.Decimal` ni
`undefined` con significado.
*Tests: (1) `tests/unit/analytics/cache-financiera-json.test.ts` › «el DTO de cada una de las ocho
metricas es identico tras el viaje por JSON» —las diez, tambien la no cacheable: si mañana se
declarara cacheable, la prueba ya existe—; (2) guardia que SOBREVIVE al merge,
`tests/unit/analytics/cache-financiera-json.guardia.test.ts` › «ningun campo del contrato
`ResultadoFinanciero` es de un tipo que no sobreviva a JSON», por lectura estatica de
`lib/types/analitica-financiera.ts`.*
*Mutacion: anadir al DTO un campo `corteAt: Date` (o un `Prisma.Decimal` sin `toFixed`) → el
round-trip devuelve un `string` donde habia un `Date` y el test (1) falla; el guardia (2) falla
antes, al leer el tipo. **Sin este requisito, el modo de fallo es mudo:** a diferencia del `bigint`
de la 128, aqui nada lanza — la cifra simplemente cambia de tipo y la pantalla sigue pintando.*

**R4.** El sistema NO DEBE cachear un resultado que no sea `status: "ok"`: ni `dominio_invalido`,
ni ningun error de consulta.
*Test: `tests/unit/analytics/cache-financiera-decorador.test.ts` › «un `dominio_invalido` y un
fallo de repositorio no dejan entrada en cache».*
*Mutacion: cachear el resultado entero → un fallo transitorio de la base se sirve como respuesta
buena durante todo el TTL, y el segundo intento del usuario devuelve el mismo error sin haber
tocado nada → rojo.*

**R5.** *(seguridad, no rendimiento — hereda R6 de la 128)* La clave de cache DEBE incluir el
`metricaId`, el rango **resuelto** (`desdeFecha`/`hastaFecha`, nunca el preset), el **alcance
resuelto** (`alcance.tipo` y su id) y el filtro **ya recortado**, normalizado de forma insensible
al orden de los ids y sensible a su contenido. Ademas DEBE estar en un **espacio de nombres
propio**: ninguna entrada del dominio `financiera` puede colisionar con una del dominio
`operativa`.
*Tests: (1) `tests/unit/analytics/cache-financiera-clave.test.ts` › «dos actores con alcance
distinto y filtro identico no comparten entrada», › «el mismo preset en dos dias distintos no
comparte entrada» y › «[a,b] y [b,a] comparten entrada; [a] y [a,b] no»; (2) › «una clave
financiera y una operativa de la misma metrica y rango no coinciden».*
*Mutacion (a): quitar el alcance de la clave → un `adminSatelite` de la zona Z recibe la entrada
que se cacheo para un `admin` global; con repositorios que devuelven filas distintas por alcance,
el segundo actor ve el dinero del primero → rojo. Es la frontera multi-tenant saltada por la
puerta de la cache. Mutacion (b): quitar el prefijo de dominio → la entrada de un dominio se sirve
como la del otro y el DTO no encaja → rojo.*

**R28.** *(D3)* **`conciliacion_cierres` NO DEBE cachearse nunca.** Y, para que esa exclusion no se
pueda confundir con un olvido, el sistema DEBE mantener una **politica de cache declarada, campo a
campo, para TODAS las metricas del dominio `financiera`**: cada metrica del catalogo DEBE tener una
politica explicita (`cacheable` o una **causa de exclusion de un dominio cerrado**, hoy
`alerta_por_consulta`), y esa declaracion DEBE cuadrar con
`listarMetricas({ dominio: "financiera" })` **en las dos direcciones: por exceso y por defecto**.

*Tests: (1) `tests/unit/analytics/cache-financiera-politica.guardia.test.ts` › «toda metrica
financiera del catalogo tiene politica de cache declarada» y › «toda politica declarada corresponde
a una metrica del catalogo». **Sobrevive al merge.** (2)
`tests/unit/analytics/cache-financiera-conciliacion.test.ts` › «dos consultas identicas de
`conciliacion_cierres` consultan la base las dos veces» y › «el aviso de descuadre se emite en cada
consulta, no una vez por TTL».*

*Mutacion (a) —la que la decision existe para impedir—: declarar `conciliacion_cierres` como
`cacheable` → el test (2) rojo por las dos aserciones: la segunda consulta deja de tocar la base y
el `ErrorLogger` recibe **una** emision donde esperaba dos. Mutacion (b): anadir una metrica
financiera nueva al catalogo sin declarar su politica → guardia (1) rojo por defecto, con un mensaje
que obliga a elegir. Mutacion (c): dejar en la politica una metrica que el catalogo ya no sirve →
guardia (1) rojo por exceso, para que la declaracion no acumule entradas muertas.*

**Por que una politica exhaustiva y no una lista de exclusiones** (esto es lo que responde a
«¿excluir se distingue de olvidar?»): con una lista de exclusiones, una metrica nueva **se cachea
por defecto** y nadie se entera — y si esa metrica fuera, como esta, una cuya razon de ser es la
**alerta**, cachearla la apaga en silencio. Con un allowlist a secas pasa lo simetrico: una metrica
nueva **no se cachea** y tampoco se entera nadie. **Con la politica exhaustiva las dos omisiones son
imposibles**: la ausencia de decision es roja, y la exclusion deliberada es un valor escrito con su
causa. Es el mismo criterio que R6 de la 127 aplicado al despacho de metricas
(`lib/services/AnaliticaFinancieraService.ts:70-75`): el mapa se declara con claves `string` y un
test lo compara contra el catalogo **por exceso y por defecto**, en vez de dejar que el compilador
decida por un `Record` cerrado. Ahi funciono; aqui se reusa el precedente en vez de inventar otro.

**La causa de exclusion es un dominio CERRADO, no texto libre.** `alerta_por_consulta` significa
«esta metrica vale por la senal que emite en cada consulta, no por la cifra». Un texto libre
acabaria diciendo «no procede» y la proxima exclusion no se podria distinguir de esta.

---

## B. Los tags y el momento de invalidar

**R6.** El tag del dominio DEBE derivarse de `tagDeDominio("financiera")` del catalogo
(`lib/analytics/metrics.ts:746-753`, `ANALITICA_TAGS`). NINGUN archivo de esta feature DEBE
contener el literal `"analitica:financiera"`.
*Test: `tests/unit/analytics/cache-tags.guardia.test.ts` (el de la 128, **ampliado**, no
duplicado) › «ningun archivo escribe el literal del tag».*
*Mutacion: escribir el literal en un escritor → guardia rojo. Un tag escrito a mano en dos sitios
es exactamente como la invalidacion deja de coincidir con la lectura, en silencio.*

**R7.** CUANDO cualquier escritura en cualquiera de los tres ledgers se confirme, el sistema DEBE
invalidar el dominio `financiera`, de modo que la siguiente consulta devuelva la cifra que incluye
esa escritura y no la anterior.
*Test: cada escritor tiene el suyo (R9–R15). R7 es el enunciado general del que cuelgan.*
*Mutacion: ver cada escritor.*

**R8.** La invalidacion DEBE ocurrir **despues** de que la transaccion que escribio el ledger haya
confirmado, y NUNCA dentro de ella.
*Test: `tests/unit/analytics/cache-financiera-invalidacion-orden.test.ts` › «la invalidacion no se
observa antes del commit» (doble de transaccion que registra el orden de los eventos).*
*Mutacion: invalidar dentro de la `tx` → entre la invalidacion y el commit cabe una lectura que
repuebla la cache con el estado ANTERIOR y se queda ahi el TTL entero. Nada falla, la cifra se
congela vieja: es el peor modo de fallo de esta feature y por eso tiene requisito propio.*

### Los escritores. **Uno por requisito, y ninguno comparte test.**

> Un escritor sin invalidar sirve dinero rancio en silencio. La forma de cada test es la de cinco
> pasos de la 128 (`design.md §11`), y su asercion es siempre sobre el **dato servido**:
> `consultar → V1` · `mover dinero de verdad por el escritor real` · `consultar → sigue V1` (prueba
> que la cache cachea; sin este paso el resto es vacuo) · `correr el invalidador REAL de
> produccion` · `consultar → V2`.
>
> La mutacion comun a R9–R15 es la misma y no se repite en cada uno: **borrar la llamada de
> invalidacion de ESE escritor** → su quinto paso sigue devolviendo V1 → rojo **solo en su test**.
> Esa es la propiedad que hace imposible cerrar la feature con seis de siete.

**R9.** CUANDO `WalletEgresoService` registre un egreso administrativo o su reverso, el sistema
DEBE invalidar el dominio `financiera`.
*Test: `tests/unit/analytics/cache-financiera-escritor-egreso.test.ts` (cinco pasos, con
`registrarEgreso` y `reversarEgreso`).*

**R10.** CUANDO `WalletService.registrarMovimientoManual` registre un movimiento manual de caja,
el sistema DEBE invalidar el dominio `financiera`.
*Test: `tests/unit/analytics/cache-financiera-escritor-manual.test.ts` (cinco pasos).*
**Este escritor NO estaba en la lista de la ficha** (§0.a): un ingreso o egreso manual entra en
`egresos`, `dinero_en_caja` y `ganancia_ordenex`.

**R11.** CUANDO `LiquidacionService` pague a un mensajero o a una tienda, o anule uno de esos
pagos, el sistema DEBE invalidar el dominio `financiera`. Esto cubre los tres ledgers y, con
ellos, el egreso de caja que emite `CajaPagoTiendaFeedService` dentro de la misma operacion.
*Test: `tests/unit/analytics/cache-financiera-escritor-liquidacion.test.ts` (cinco pasos, con pago
y con anulacion).*

**R12.** CUANDO el cron de gastos fijos genere egresos, el sistema DEBE invalidar el dominio
`financiera`. SI la corrida no genero ningun egreso, ENTONCES no es obligatorio invalidar.
*Test: `tests/unit/analytics/cache-financiera-escritor-gastos-fijos.test.ts` (cinco pasos, contra
`handleGenerarGastosFijos` real) y › «una corrida con cero egresos generados no invalida».*
*Mutacion adicional: invalidar siempre → el segundo test rojo (vaciar la cache financiera cada
madrugada sin haber movido dinero es coste sin motivo).*

**R13.** CUANDO se apruebe una indemnizacion de incidente y esa aprobacion emita el egreso, el
sistema DEBE invalidar el dominio `financiera`. SI el incidente se rechaza o la guardia de estado
no aplica el cambio (`no_aplicado`), ENTONCES no se invalida.
*Test: `tests/unit/analytics/cache-financiera-escritor-indemnizacion.test.ts` (cinco pasos) y ›
«un rechazo y un reintento ya aplicado no invalidan».*

**R14.** CUANDO se apruebe un cierre de dia (`aprobarCierre`), el sistema DEBE invalidar el
dominio `financiera`.
*Test: `tests/unit/analytics/cache-financiera-escritor-cierre-dia.test.ts` (cinco pasos).*

**R15.** CUANDO se apruebe un cierre de bodega (`aprobarCierreBodega`), el sistema DEBE invalidar
el dominio `financiera`.
*Test: `tests/unit/analytics/cache-financiera-escritor-cierre-bodega.test.ts` (cinco pasos).*
*Se separa de R14 a proposito: son dos servicios distintos (`CierresAdminService.ts:421` y
`CierresBodegaAdminService.ts:289`) y un solo test cubriria uno y dejaria el otro suelto.*

**R26.** *(D2 — el octavo escritor)* CUANDO el backfill de tesoreria
(`scripts/backfill-caja-tesoreria.ts`) termine una corrida en modo `aplicar` que **haya insertado**
al menos un movimiento, el sistema DEBE **encolar** la invalidacion del dominio `financiera`. SI la
corrida fue en seco, o inserto cero movimientos, ENTONCES NO DEBE encolar nada.
*Tests: `tests/unit/scripts/backfill-caja-tesoreria-invalidacion.test.ts` › «una corrida que
inserta encola exactamente un job de invalidacion financiera», › «el modo en seco no encola nada» y
› «una corrida que no encuentra pendientes no encola nada».*
*Mutacion (a): no encolar → el doble de `IJobRepository.enqueue` recibe cero llamadas → rojo, y el
test de extremo a extremo de R27 sirve la cifra vieja. Mutacion (b): encolar siempre → el segundo
test rojo. Mutacion (c): llamar a `revalidateTag` desde el script → **lanza** `Invariant: static
generation store missing` fuera de un request (`revalidate.js:104-107`); el fallo ocurriria en la
corrida de mantenimiento, no en el gate, que es donde peor se descubre.*

**R27.** *(D2)* CUANDO el drenador procese un job `analitica_invalidacion_cache`, el sistema DEBE
invalidar **el dominio que el payload declare**. SI el payload no declara dominio, ENTONCES DEBE
invalidar `operativa`, que es el comportamiento que la 128 dejo escrito y que sus jobs ya encolados
esperan.
*Tests: (1) `tests/unit/analytics/cache-financiera-invalidacion-backfill.test.ts` › «tras drenar el
job encolado por el backfill de tesoreria, la consulta financiera cacheada devuelve las cifras
nuevas» (cinco pasos, con el drenado real); (2)
`tests/unit/analytics/cache-invalidacion-backfill.test.ts` (el de la 128, **sin modificar**) sigue
verde.*
*Mutacion (a): leer el dominio del payload sin default → los jobs de la 128 dejan de invalidar la
operativa y el test (2) se pone rojo. **Es la mutacion importante: esta feature amplia un handler
ajeno y la compatibilidad hacia atras es un requisito, no una cortesia.** Mutacion (b): ignorar el
payload y seguir invalidando `operativa` fijo → el test (1) rojo: el backfill de tesoreria vaciaria
la cache equivocada. Mutacion (c): registrar el tipo en `buildRecurrencias` → se re-agendaria un job
puntual y el test de recurrencias de la 128 se pone rojo.*
**No hay migracion:** el valor `analitica_invalidacion_cache` del enum `job_tipo` ya existe (128).

---

## C. El censo: que un escritor NUEVO tampoco se escape

**R16.** *(D4)* SI la invalidacion falla **despues** de que la escritura del ledger ya haya
confirmado, ENTONCES el sistema NO DEBE propagar ese fallo al llamador —la operacion de dinero
devuelve **exito**, porque ocurrio— y DEBE dejar constancia del fallo por el canal de errores, con
el origen y los tags, sin PII y sin ids de dominio.
*Tests: `tests/unit/analytics/cache-financiera-invalidacion-fallo.test.ts` › «una invalidacion que
lanza tras una aprobacion confirmada no convierte la aprobacion en un fallo», › «y deja constancia
con su origen» y › «el dinero escrito sigue escrito».*
*Mutacion (a): propagar el error → el usuario ve que la aprobacion del cierre fallo cuando el dinero
ya se movio, y reintenta sobre una operacion hecha → rojo por el primer test. Mutacion (b):
`try {} catch {}` vacio → rojo por el segundo. **Las dos mutaciones son los dos extremos, y las dos
tienen test: mentir sobre la operacion, y callar sobre la cache.***

**⚠ DESVIACION DECLARADA DE R11 DE LA 128.** Aquel requisito dice, textualmente, que una
invalidacion fallida DEBE hacer fallar al llamador. **Aqui se hace lo contrario, a proposito y con
motivo:** en la 128 el llamador era un **job idempotente con backoff y dead-letter**
(`JobQueueService`), donde fallar es exactamente lo correcto porque el reintento es gratis y no lo
ve nadie. Aqui el llamador es una **Server Action de cara a un maestro**, sobre una escritura de
dinero **ya confirmada**: fallar no reintenta nada, solo miente sobre lo que ocurrio. El daño de no
propagar queda acotado por el TTL (una hora, `ANALITICA_CACHE_TTL_SEGUNDOS`) y **con senal**
(R24). Se escribe aqui, y en la cabecera del modulo de invalidacion, porque **una desviacion no
declarada de un requisito ajeno es una contradiccion silenciosa entre dos specs**: el siguiente que
compare R11 con este codigo tiene que encontrar el motivo, no la sorpresa.
*El unico sitio donde R11 de la 128 sigue aplicando tal cual es R27: ahi el llamador vuelve a ser un
job, y ahi la invalidacion fallida SI debe fallar.*

**R17.** *(el requisito que hace envejecer bien a esta feature)* El sistema DEBE mantener un
**censo del arbol** de los puntos que escriben los tres ledgers, y ese censo DEBE cuadrar
**en las dos direcciones** con un registro declarado de invalidadores:

- **Eje 1 — la puerta:** ningun archivo de `lib/`, `app/` o `scripts/` fuera de
  `lib/repositories/{WalletMovimientoRepository,WalletTiendaMovimientoRepository,PagoMensajeroMovimientoRepository}.ts`
  DEBE escribir en las tres tablas por Prisma directamente.
- **Eje 2 — los llamadores:** todo archivo que llame a `crearMovimientos` de cualquiera de los
  tres repositorios DEBE aparecer en el registro declarado, con el invalidador que le corresponde;
  y toda entrada del registro DEBE corresponder a un llamador que existe.

El registro DEBE cubrir **los ocho** puntos de escritura de §0.a, incluido el backfill de tesoreria
(R26), cuyo invalidador es el job de R27 y no una llamada directa.

*Test: `tests/unit/analytics/ledger-escritores.guardia.test.ts` › «todo escritor de ledger tiene
invalidador declarado», › «no hay escrituras crudas fuera de los tres repositorios» y › «el censo
DISCRIMINA: un escritor nuevo sin registrar pone rojo el guardia» (con un fragmento sintetico).
**Este guardia SOBREVIVE al merge:** censa contenido, no mide el diff contra `dev`.*
*Mutacion (a): anadir un servicio nuevo que llame a `crearMovimientos` sin registrarlo → rojo, con
un mensaje que dice exactamente que hay que hacer. Mutacion (b): borrar una entrada del registro
cuyo escritor sigue vivo → rojo. Mutacion (c): escribir el ledger con `prisma.walletMovimiento.
createMany` desde un servicio → rojo por el eje 1. **Una lista de rutas escrita a mano habria
dejado pasar `registrarMovimientoManual`, que es justo lo que le paso a la ficha (§0.a).***

**R18.** Cada entrada del registro de R17 DEBE nombrar un archivo de test que **existe** y que
contiene un test cuyo nombre declara el escritor cubierto.
*Test: `tests/unit/analytics/ledger-escritores.guardia.test.ts` › «cada escritor registrado nombra
un test que existe».*
*Mutacion: registrar un escritor apuntando a un test que no existe, o borrar el test de un
escritor cubierto → rojo. Sin R18, R17 se satisface escribiendo una linea en un array: el registro
seria una promesa, no una prueba.*

**R19.** El guardia R15 de la 128 (`tests/unit/analytics/cache-financiera.guardia.test.ts`) DEBE
retirarse **en el mismo PR** que introduce la invalidacion, y NO antes: en el arbol final no puede
existir a la vez ese guardia y la cache financiera, ni pueden faltar los dos.
*Tests: (1) `tests/unit/analytics/ledger-escritores.guardia.test.ts` › «el guardia de D2 ya no
existe y su sustituto si», que comprueba por sistema de archivos que
`cache-financiera.guardia.test.ts` NO existe y que este censo SI; (2) la propia suite: mientras el
guardia de D2 siga en el arbol, cachear la financiera lo pone rojo.*
*Mutacion (a): retirar el guardia de D2 sin el censo → el test (1) rojo por el segundo lado, y el
arbol se queda sin ninguna proteccion. Mutacion (b): dejar los dos → el guardia de D2 rojo. **Las
dos mutaciones son exactamente los dos errores posibles de esta feature, y las dos ponen rojo.***

---

## D. Frontera: no romper lo que ya funciona

**R20.** Esta feature NO DEBE cambiar la firma ni el tipo de retorno de
`consultarMetricaFinanciera`, ni ningun tipo de `lib/types/analitica-financiera.ts`. La 132, la
133 y la 134 los consumen.
*Test: `tests/unit/analytics/cache-financiera-frontera.test.ts` › «la Server Action conserva su
aridad y su tipo de retorno».*
*Mutacion: anadir un parametro obligatorio → rojo (y typecheck rojo en los consumidores).*

**R21.** `next/cache` DEBE seguir importandose desde **un solo archivo**
(`lib/cache/next-analitica-cache.ts`). Ningun servicio, repositorio, escritor de ledger, accion ni
handler DEBE importarlo.
*Test: `tests/unit/analytics/cache-aislamiento.guardia.test.ts` (el de la 128, sin modificar) se
mantiene verde.*
*Mutacion: importar `next/cache` en `LiquidacionService` para invalidar «rapido» → guardia rojo. Y
no es higiene: `revalidateTag` lanza `Invariant: static generation store missing` fuera de un
request (`revalidate.js:104-107`) y tumbaria la suite unitaria de la liquidacion, que hoy corre sin
runtime de Next.*

**R22.** El kill-switch existente (`ANALITICA_CACHE_DISABLED`,
`lib/config/analitica-cache.ts:26-48`) DEBE apagar tambien el dominio `financiera`, con el mismo
default ENCENDIDO. MIENTRAS este apagado, TODA consulta financiera DEBE ir a la base y no DEBE
leerse ni escribirse ninguna entrada.
*Test: `tests/unit/analytics/cache-financiera-config.test.ts` › «con la cache deshabilitada, dos
consultas identicas llaman dos veces a los repositorios» y › «sin la variable definida, esta
habilitada».*
*Mutacion: cablear el decorador financiero sin consultar la bandera → el contador se queda en 1 →
rojo, y el kill-switch pasa a ser un placebo justo en el dominio del dinero.*

**R23.** Esta feature NO DEBE introducir una segunda constante de TTL: reusa
`ANALITICA_CACHE_TTL_SEGUNDOS` (`lib/config/analitica-cache.ts:23`). NO DEBE escribirse ninguna
entrada con `revalidate: false`.
*Test: `tests/unit/analytics/cache-config.guardia.test.ts` (el de la 128, ampliado al ambito de
esta feature) › «el TTL vive en una sola constante».*
*Mutacion: declarar `ANALITICA_CACHE_FINANCIERA_TTL` → censo rojo. Dos TTL divergen y nadie se
entera.*

**R24.** Toda invalidacion DEBE dejar registro de **quien la disparo** y de **que tags** invalido,
sin PII y sin ids de dominio. El dominio cerrado `OrigenInvalidacion`
(`lib/interfaces/external/IAnaliticaCache.ts:17`) DEBE ampliarse con los origenes de esta feature,
y NO DEBE convertirse en texto libre.
*Tests: `tests/unit/analytics/cache-financiera-registro.test.ts` › «cada escritor registra su
propio origen» y › «el registro no lleva ids de tienda, mensajero, cierre ni usuario».*
*Mutacion (a): usar un unico origen `"manual"` para los ocho escritores → el primer test rojo, y
el registro deja de servir para saber CUAL invalidador no llego. Mutacion (b): tipar el origen
como `string` → el segundo guardia rojo; un texto libre acaba llevando un id.*

**R25.** Esta feature NO DEBE modificar mas archivos existentes que los declarados en
`design.md §2`. En particular NO DEBE tocar `lib/analytics/metrics.ts`, ni el calculo de
`AnaliticaFinancieraService`, ni la aritmetica de ningun escritor de ledger.
*Test: `tests/unit/analytics/cache-financiera-frontera.guardia.test.ts` › «el diff de la rama
contra `dev` no toca ningun archivo fuera de la lista declarada». **Guardia branch-scoped: caduca
al mergear y se retira en el MISMO PR que lo introduce** (leccion del repo; la 128 hizo lo mismo
con el suyo). Su cabecera lo dice por escrito.*
*Mutacion: cambiar una suma dentro de `AnaliticaFinancieraService` «de paso» → guardia rojo. Esta
feature no mueve un solo numero.*

---

## Fuera de alcance (declarado)

- **Cachear el dominio `operativa`**: ya lo hizo la 128. Aqui no se toca su decorador, ni su
  clave, ni su codec, ni su job.
- **Cambiar la granularidad de tag** (por mes, por fecha): descartada con dato en D3 de la 128
  (128 tags/entrada vs. rangos de 366 dias). Esta feature hereda la decision, no la reabre.
- **Medir el TTL**: sigue siendo el numero provisional y no medido de D4 (128). Esta feature no
  lo cambia (R23).
- **Cachear el borde (`consultarMetricaFinanciera`) o los cuatro repositorios**: descartado en
  `design.md §10` con su motivo.
- **Cualquier cambio de cifras**: R1 es explicito.
- **Cachear `conciliacion_cierres`**: excluida **con politica declarada y guardia** (R28/D3). No es
  un olvido y el censo lo distingue de uno.
- **Una migracion de base**: D2 = (a) reusa el enum que la 128 ya creo. Esta feature no toca el
  esquema.

---

## Decisiones D1–D4 — la puerta T0 se cerro el 2026-08-10

> Las cuatro las respondio el **humano el 2026-08-10**, todas con la recomendacion de esta spec.
> **Las alternativas descartadas se conservan enteras, con su coste**: son lo que impide que dentro
> de tres semanas alguien reabra una de estas decisiones creyendo que nadie la penso. Mismo criterio
> que las D1–D5 de la 128.
>
> **No queda ninguna pregunta abierta.**

### D1 (humano, 2026-08-10) — **(a): invalidacion por TAG DE DOMINIO, un solo `analitica:financiera`.**

Al invalidar se vacia la cache financiera ENTERA: un egreso manual de ₡5.000 tira tambien la
conciliacion del trimestre. Se asume: **invalidar de mas cuesta recomputo, no correccion**, y a
cambio hace **imposible** que la invalidacion se desalinee de la lectura. Es la misma decision que
D3 de la 128 y por el mismo motivo, mas uno propio: el mapa «que escritura afecta a que metrica» no
es evidente ni estable — **un cierre aprobado toca los tres ledgers y seis de las diez metricas**.

**Descartada — (b) por clave o por sub-tag (un tag por ledger tocado).** Menos recomputo. Coste:
obliga a mantener a mano el mapa ledger→metricas y **cuando ese mapa se equivoque no fallara nada**:
servira la cifra vieja de la metrica que se olvido. Es exactamente el modo de fallo que esta feature
existe para eliminar, reintroducido un nivel mas abajo.

Propagado a **R5, R6, R7** y a `design.md §5`.

### D2 (humano, 2026-08-10) — **(a): el backfill de tesoreria REUSA el job `analitica_invalidacion_cache` de la 128, con `dominio` en el payload. Sin migracion.**

`revalidateTag` **lanza** `Invariant: static generation store missing` fuera de un request
(`node_modules/next/dist/server/web/spec-extension/revalidate.js:104-107`) y
`scripts/backfill-caja-tesoreria.ts` es un proceso `tsx`. La 128 resolvio el mismo problema
encolando un job que el cron drena en menos de un minuto (`design.md §7.1` de la 128). El valor de
enum ya existe, asi que **no hay DDL**. Coste asumido: se amplia
`lib/services/jobs/analitica-invalidacion-cache-handler.ts`, que hoy invalida `TAGS_OPERATIVA` fijo e
ignora el payload — archivo de la 128, que entra en la frontera de `design.md §2` **con su
justificacion escrita antes**, y cuya compatibilidad hacia atras es requisito (R27).

**Descartada — (b) un tipo de job nuevo** (`analitica_invalidacion_cache_financiera`): no tocaria
nada de la 128, pero cuesta una migracion `ALTER TYPE` sola en su carpeta con su `down.sql`. Un
valor de enum y una migracion irreversible-en-la-practica para evitar un `??` en un handler de tres
lineas es cambio de esquema por comodidad de frontera.
**Descartada — (c) declararlo fuera de alcance:** durante hasta una hora tras una operacion masiva
sobre la caja, el tablero mentiria **en silencio**. La feature naceria con el mismo agujero que vino
a cerrar, solo que mas pequeño y por escrito.

Propagado a **R26, R27, R17** y a `design.md §2` y `§5.4`.

### D3 (humano, 2026-08-10) — **(a): `conciliacion_cierres` NUNCA se cachea.**

`AnaliticaFinancieraService.deConciliacion` emite por el `ErrorLogger` cuando `|diferencia|` supera
el umbral (`AnaliticaFinancieraService.ts:666-672`, R24 de la 127). Cacheada, ese aviso pasaria de
sonar **una vez por consulta** a **una vez por TTL**, y un aviso que suena menos es un aviso que
alguien deja de ver. **El valor de esa metrica para el negocio es la alerta, no la cifra**; ademas
es la unica que no publica importes por cubo y la de menor volumen de consulta: cachearla ahorra
poco y apaga la senal.

**Descartada — (b) cachearla y aceptar la frecuencia reducida:** convierte una alerta de dinero en
una funcion del TTL, que es un numero provisional y no medido (D4 de la 128).
**Descartada — (c) cachear el DTO y re-emitir el aviso desde el valor cacheado:** mantiene la
frecuencia, pero mueve la emision del sitio donde se calcula el descuadre al sitio donde se lee la
cache — dos archivos distintos, y la condicion de emision podria divergir del calculo sin que nada
fallara.

**La exclusion NO se implementa como una lista de exclusiones**, precisamente para que no se pueda
confundir con un olvido: R28 exige una **politica exhaustiva por metrica**, cuadrada contra el
catalogo por exceso y por defecto. Ahi esta escrito el razonamiento completo.

Propagado a **R28**, y a **R2** (que pasa a hablar de «metrica declarada cacheable»).

### D4 (humano, 2026-08-10) — **(a): un fallo de invalidacion posterior al commit NO se propaga: se registra y la operacion devuelve exito.**

La escritura del ledger **ya confirmo**. Propagar el error le diria a un maestro que la aprobacion
del cierre fallo cuando el dinero ya se movio, y provocaria reintentos manuales sobre una operacion
hecha. El daño de no propagar queda acotado por el TTL (una hora) y **con senal** (R16/R24).

**⚠ Es una desviacion consciente de R11 de la 128**, y esta declarada como tal en R16 y en la
cabecera del modulo de invalidacion. El motivo: alli el llamador era un **job idempotente con
backoff y dead-letter**, donde fallar es lo correcto porque el reintento es gratis; aqui es una
**Server Action de cara al usuario** sobre dinero ya confirmado. **Donde el llamador vuelve a ser un
job —R27— R11 sigue aplicando tal cual.**

**Descartada — (b) no propagar + encolar un job de reintento de invalidacion:** cerraria tambien la
ventana de una hora y la maquinaria ya existe (D2). Se descarta **por ahora** porque anade un job
por cada escritura de dinero —el volumen mas alto del sistema— para cubrir un fallo que no se ha
observado nunca; si el registro de R24 llegara a mostrar invalidaciones fallidas en produccion, esta
es la salida documentada.
**Descartada — (c) propagar, como R11 de la 128:** coherente en el papel, pero convierte un fallo de
cache en un fallo aparente de una operacion de dinero ya confirmada. Es mentir sobre lo que ocurrio.

Propagado a **R16** y al comportamiento esperado en los tests de los siete escritores en request.
