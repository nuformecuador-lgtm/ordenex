# impl 179 — analitica: cache financiera + invalidacion por ledger · TANDAS T1 y T2

> Worktree `C:/w179`, rama `feature/179-analitica-cache-financiera`. **Sin commit**: el arbol
> queda con los cambios para que el leader los agrupe por tanda logica.
>
> Alcance de esta bitacora: **T1 (T1.1–T1.5) y T2 (T2.1–T2.5)**. T3 (los ocho escritores), T4 (el
> censo), T5 (la retirada del guardia de D2 de la 128 y el guardia de frontera) y T6 (cierre) **no
> entran** y se dicen abajo, en «lo que queda sin hacer».

---

## 1. Archivos

### Nuevos (todos declarados en `design.md §2`)

| archivo | task | que es |
|---|---|---|
| `lib/analytics/cache-clave-financiera.ts` | T1.2 | `claveFinanciera(consulta)`: **compone** `claveDeConsulta(c, [])` (128, no editado) con prefijo de dominio. Puro. |
| `lib/analytics/cache-politica-financiera.ts` | T1.5 | D3/R28: politica **exhaustiva por metrica**, causa de exclusion de dominio cerrado. Modulo de datos, puro. |
| `lib/analytics/invalidacion-financiera.ts` | T1.4 | `invalidarAnaliticaFinanciera(cache, origen, logger?)`. Su cabecera **declara por escrito la desviacion de R11 de la 128** (D4). |
| `lib/analytics/escritores-ledger.ts` | T4.1 (adelantada por encargo) | El registro declarado de los **ocho** puntos de escritura. Ver el aviso de §5. |
| `lib/services/CachedAnaliticaFinancieraService.ts` | T2.1 | El decorador de lectura + `decorarFinancieraConCache`. |
| `tests/unit/analytics/cache-financiera-clave.test.ts` | T1.2 | R5. |
| `tests/unit/analytics/cache-financiera-politica.guardia.test.ts` | T1.5 | R28 estatico. **Sobrevive al merge.** |
| `tests/unit/analytics/cache-financiera-decorador.test.ts` | T2.1 | R2, R4, paso 0 de R28. |
| `tests/unit/analytics/cache-financiera-equivalencia.test.ts` | T2.2 | R1, metrica a metrica desde el catalogo. |
| `tests/unit/analytics/cache-financiera-json.test.ts` | T2.3 | R3, round-trip real. |
| `tests/unit/analytics/cache-financiera-json.guardia.test.ts` | T2.3 | R3 estatico. **Sobrevive al merge.** |
| `tests/unit/analytics/cache-financiera-conciliacion.test.ts` | T2.5 | R28 sobre el COMPORTAMIENTO. |
| `tests/unit/analytics/cache-financiera-config.test.ts` | T2.1 | R22. |
| `tests/unit/analytics/cache-financiera-frontera.test.ts` | T2.4 | R20. |

### Existentes modificados (los cuatro estan en la lista de `design.md §2`)

| archivo | que se cambio |
|---|---|
| `lib/analytics/cache-tags.ts` | + `TAG_FINANCIERA` / `TAGS_FINANCIERA`, derivados de `tagDeDominio("financiera")`. Cero literales. |
| `lib/interfaces/external/IAnaliticaCache.ts` | `OrigenInvalidacion` pasa de 3 a 11 valores: **uno por escritor**, union literal cerrada, con el motivo escrito. |
| `lib/actions/analitica-financiera.ts` | **Solo `construirServicio`**: envuelve con `decorarFinancieraConCache(..., crearAnaliticaCacheDeNext())`. `consultarMetricaFinanciera` intacta. |
| `tests/unit/analytics/cache-config.guardia.test.ts` | R23: el ambito del censo del TTL gana `lib/services/CachedAnaliticaFinancieraService.ts` (el ARCHIVO, no el directorio: ver §6). |

**Nada mas se toco.** Ni `lib/analytics/metrics.ts`, ni `AnaliticaFinancieraService.ts`, ni los
cuatro repositorios financieros, ni `cache-clave.ts`, ni el esquema de Prisma.

---

## 2. Mapa `R<n> → test` de ESTA tanda

Construido leyendo el caso, no contando menciones de `R\d+` en titulos.

| R | test (archivo › caso) | que afirma de verdad |
|---|---|---|
| **R1** | `cache-financiera-equivalencia.test.ts` › un caso **por cada metrica del catalogo** (10, enumeradas con `listarMetricas`) | el DTO en MISS y el DTO en HIT son `toEqual` al del servicio desnudo |
| **R2** | `cache-financiera-decorador.test.ts` › «la segunda consulta se sirve entera desde cache» | `consultasHechas()` no sube en la segunda; y › «dos consultas DISTINTAS» comprueba que el contador no esta muerto |
| **R3** | `cache-financiera-json.test.ts` › un caso por metrica | `toStrictEqual` tras el round-trip **+** recorrido de hojas: ninguna es `Date`/`bigint`/`Map`/`Set` |
| **R3** | `cache-financiera-json.guardia.test.ts` › 6 patrones prohibidos + «tampoco hay campos OPCIONALES» | lectura estatica de `lib/types/analitica-financiera.ts` |
| **R4** | `cache-financiera-decorador.test.ts` › «un `dominio_invalido` no se cachea…» y › «un fallo de repositorio se propaga tal cual y no deja entrada» | `tamano()===0`, `claves===[]` y el interno vuelve a ser preguntado la segunda vez |
| **R5** | `cache-financiera-clave.test.ts` › 4 bloques (alcance, rango resuelto, filtro normalizado, espacio de nombres) | ver el hallazgo de §4 sobre el caso del alcance |
| **R6** | `cache-tags.guardia.test.ts` (de la 128, **sin tocar**) › «solo el catalogo… contienen las cadenas» | ya censaba los DOS literales; los archivos nuevos consumen `tagDeDominio` |
| **R20** | `cache-financiera-frontera.test.ts` › «sigue recibiendo dos parametros», › «devuelve la misma union», › «los otros tres estados», › «`construirServicio` envuelve» | aridad, tipo de retorno, los cuatro estados del borde, y que el cableado EXISTE |
| **R22** | `cache-financiera-config.test.ts` › «dos consultas identicas llaman dos veces», › «NO se lee ni se escribe una sola entrada», › «devuelve el servicio DESNUDO» | kill-switch, no placebo |
| **R23** | `cache-config.guardia.test.ts` (128, ampliado) › «ningun archivo del ambito escribe el numero» | no hay segunda constante de TTL |
| **R28** | `cache-financiera-politica.guardia.test.ts` › por DEFECTO / por EXCESO / «es la UNICA excluida» / «el default de la funcion es CERRADO» | el cuadre con el catalogo en las dos direcciones |
| **R28** | `cache-financiera-conciliacion.test.ts` › «consultan la base las dos veces» y › «el aviso se emite en CADA consulta» | la exclusion medida sobre el COMPORTAMIENTO, con el contador de emisiones del `ErrorLogger` |

**Requisitos cuyo CODIGO entra aqui pero cuyo TEST es de T3, dicho sin disimular:** R7, R16, R21 y
R24. `invalidacion-financiera.ts` y los once origenes existen y compilan, pero no los llama nadie
todavia: sus tests (`cache-financiera-invalidacion-fallo.test.ts`, `cache-financiera-registro.test.ts`)
son T3.10. **Hasta entonces esos requisitos NO estan cubiertos**, y contarlos seria contar una
promesa. (R21 si esta vigilado por el guardia de aislamiento de la 128, que sigue verde: ningun
archivo nuevo importa `next/cache`.)

---

## 3. Mutaciones aplicadas, con su veredicto

**Aplicadas de verdad** sobre el arbol, corridas, y revertidas (`git status` limpio despues de cada
una). «Rojo» = el test nombrado falla. Los conteos son los que imprimio vitest.

| # | mutacion | test que muere | veredicto medido |
|---|---|---|---|
| 1 | el decorador cachea el resultado ENTERO (`envolver<ResultadoConsultaFinanciera>`) | `decorador` | **rojo**: 1 fallo — «un `dominio_invalido` no se cachea, y el segundo intento vuelve a preguntar» |
| 2 | quitar el paso 0 (`if (!esMetricaFinancieraCacheable(...))`) | `conciliacion` + `decorador` | **rojo**: 3 fallos — las DOS aserciones de la conciliacion (la base deja de consultarse la segunda vez; el logger emite 1 donde esperaba 3) y «`conciliacion_cierres` no escribe ninguna entrada» |
| 3 | declarar `conciliacion_cierres` como `cacheable: true` | `conciliacion` + `politica.guardia` | **rojo**: 4 fallos, incluidas las dos aserciones de comportamiento |
| 4 | borrar una entrada de `POLITICA_CACHE_FINANCIERA` (metrica nueva sin declarar) | `politica.guardia` | **rojo**: 3 fallos — «por DEFECTO», el caso anti-vacio y «es la UNICA excluida» |
| 5 | anadir a la politica una metrica que el catalogo no sirve | `politica.guardia` | **rojo**: 2 fallos — «por EXCESO» y el caso anti-vacio |
| 6 | `claveFinanciera` sin el prefijo de dominio | `clave` | **rojo**: 2 fallos — los dos casos de espacio de nombres |
| 7 | `claveDeConsulta` sin el componente de alcance (128, mutada temporalmente) | `clave` + `cache-alcance` (128) | **rojo**: 2 fallos — «dos actores con alcance distinto y filtro identico no comparten entrada» aqui, y «el segundo actor NO recibe las filas del primero» alli |
| 8 | `decorarFinancieraConCache` sin consultar la bandera | `config` | **rojo**: 4 de 5 casos |
| 10 | anadir `corteAt: Date` a `CabeceraFinanciera` | `json.guardia` | **rojo**: 1 fallo — «no aparece \bDate\b en el codigo del contrato» |
| 11 | quitar `decorarFinancieraConCache` de `construirServicio` | `frontera` | **rojo**: 1 fallo — «`construirServicio` envuelve el servicio con la cache» |
| 12 | declarar `ANALITICA_CACHE_FINANCIERA_TTL = 3600` en el decorador | `cache-config.guardia` (128, ampliado) | **rojo**: 1 fallo — «ningun archivo del ambito escribe el numero». Era el motivo de ampliar el ambito |

**Tres cosas que las mutaciones ensenaron y que no se ven en la tabla:**

- **M10 solo mata al guardia ESTATICO, no al round-trip.** Anadir `corteAt: Date` al TIPO no cambia
  el DTO que el servicio produce en runtime, asi que `cache-financiera-json.test.ts` sigue verde
  hasta que alguien **puebla** el campo. **Eso no debilita R3: lo justifica.** Es exactamente por lo
  que hacen falta las dos mitades, y es la unica de las dos que falla el dia en que se escribe el
  tipo, en vez del dia en que se llena.
- **M7 mata un solo caso, y es el que hay que tener.** Los casos «dos zonas distintas» sobreviven
  porque la 122 recorta el FILTRO por zona y el filtro ya distingue las claves. La unica forma
  honesta de medir el alcance es con **filtros identicos y alcances distintos**, que es como esta
  escrito el caso.
- **M2 no mata el caso de `dominio_invalido`.** Con el paso 0 quitado, ese resultado sigue sin
  cachearse: lo para el mecanismo de R4. Las dos capas son independientes a proposito, y la
  mutacion lo demuestra en vez de suponerlo.

**Mutacion que NO se aplico:** «el decorador reconstruye el DTO a mano y pierde `sumableCon`». No es
un cambio de una linea sobre este codigo —el decorador devuelve el objeto tal cual—, asi que
simularla habria sido escribir una implementacion distinta para poder matarla. El caso de
`equivalencia` la cubriria (compara con igualdad profunda las 10 metricas, incluida `cod_recaudado`
con sus dos vistas), pero **eso es una afirmacion mia, no una medicion**, y se dice asi.

**Mutacion que NO tiene test y hay que saberlo:** «cachear un `status` que no sea `ok` **que venga
del servicio real**». Hoy `AnaliticaFinancieraService` solo produce `dominio_invalido` para metricas
de otro dominio, y esas ni siquiera llegan al envoltorio (las para el paso 0 de R28). El caso de R4
se ejercita con un servicio interno doble que devuelve `dominio_invalido` para una metrica
declarada cacheable: es una situacion **imposible hoy** y deliberadamente construida, porque lo que
R4 protege es una invariante del decorador y no una del catalogo. Dicho aqui para que nadie lo lea
como un test que describe produccion.

---

## 4. Lo que el spec dice y el arbol desmiente (medido en `C:/w179`)

**(a) No son ocho metricas financieras: son DIEZ.** `requirements.md` y `design.md` dicen «las ocho»
en R1, R3, D1 y §4bis. El catalogo sirve **diez** desde la feature 173, que anadio `dinero_en_caja` y
`ganancia_ordenex` — y el propio contrato lo dice (`lib/types/analitica-financiera.ts:298-321`,
`IDS_FINANCIERAS_SERVIDAS`, con su comentario «Eran OCHO hasta la feature 173»). **No se ha forzado
nada**: todos los tests enumeran desde `listarMetricas({ dominio: "financiera" })` y la politica
declara las diez. **El spec deberia corregir «ocho» → «diez» en R1, R3 y §4bis**; el numero no
cambia ninguna decision, solo deja de mentir.

**(b) La mutacion de R5 no es alcanzable hoy con una metrica financiera.** R5 la describe asi: «un
`adminSatelite` de la zona Z recibe la entrada que se cacheo para un `admin` global». Las diez
metricas financieras declaran `ALCANCE_FINANCIERA` (`lib/analytics/metrics.ts:65-71`), que es
`total` para `maestro` y `admin` y **`prohibido` para `adminSatelite`, `adminTienda` y
`mensajero`**: los dos unicos roles que llegan resuelven ambos a `{ tipo: "global" }`. Un caso
escrito solo con metricas financieras seria **verde por vacio**. Lo que hace el test —y esta escrito
en su cabecera— es probar la propiedad de la FUNCION `claveFinanciera`, que acepta cualquier
`ConsultaAnalitica`, ejercitandola con las metricas cuyo alcance SI varia. R5 sigue valiendo como
defensa en profundidad, pero **no es hoy una frontera multi-tenant viva en el dominio financiero**, y
la spec lo redacta como si lo fuera.

**(c) `design.md §5.1` da a `invalidarAnaliticaFinanciera` dos parametros; aqui tiene tres.** El
tercero es `logger: ErrorLogger = defaultLogger`, opcional. Motivo: R16/D4 exige que un fallo de
invalidacion **no propague y deje constancia**, y sin un sumidero inyectable esa constancia solo se
podria comprobar espiando la consola. Es la misma solucion que la 128 tomo con
`conRegistroDeInvalidacion`. Ningun llamador tiene que pasarlo.

**(d) El registro de escritores (T4.1) se adelanto a esta tanda por encargo, y eso choca con su
propio criterio de «hecho».** `tasks.md` T4.1 dice: «NO hecho: una entrada sin test, o una entrada
pendiente. El registro es una prueba, no una lista de intenciones». Ahora mismo **ninguno de los
diez archivos de test que el registro nombra existe** (son T3). El archivo lo declara en su cabecera
en vez de disimularlo, y **no se ha escrito el guardia `ledger-escritores.guardia.test.ts`**: un
guardia parcial que solo cuadrara una direccion es exactamente el «NO hecho» de T4.2. Las ocho
entradas SI estan verificadas contra el arbol (censo de `crearMovimientos` corrido hoy: coinciden
exactamente con `requirements.md §0.a`).

---

## 5. Estado del guardia de D2 de la 128 — **ROJO A PROPOSITO**

`tests/unit/analytics/cache-financiera.guardia.test.ts` **falla, con 2 casos rojos**, desde que
existe `CachedAnaliticaFinancieraService.ts` (nombra `AnaliticaFinancieraService` y llama a
`.envolver(`) y desde que `lib/actions/analitica-financiera.ts` cablea la cache.

**Es lo correcto y lo que `tasks.md` predice** (nota tras T2.5 y `design.md §7`): se retira en
**T5.1**, y solo cuando las ocho tasks de escritor y el censo esten verdes. **Retirarlo ahora para
«dejar la tanda en verde» es literalmente el error que esta feature existe para no cometer.**

Los demas guardias de la 128 siguen verdes y sin tocar: `cache-tags.guardia`,
`cache-aislamiento.guardia`, `cache-invalidacion-backfill`, `cache-invalidacion-job`,
`cache-registro`, `cache-config.guardia` (este ultimo, ampliado).

---

## 6. Decisiones de implementacion que conviene conocer

1. **Como se cumple R4 sin centinelas.** `envolver` guarda TODO lo que el productor devuelva, asi
   que un `null` o un objeto centinela se cachearian igual que una cifra buena. Lo unico que impide
   la escritura es **lanzar** — y esa es la semantica de `unstable_cache`, que no guarda promesas
   rechazadas (la cache falsa de la 128 la replica). Por eso hay una clase privada
   `ResultadoNoCacheable` que envuelve el resultado no-`ok`, sale por el `catch` y se devuelve tal
   cual. Un fallo real de repositorio sube sin tocarse.
2. **El default de la politica es cerrado hacia el lado seguro** (`esMetricaFinancieraCacheable`
   devuelve `false` sin decision escrita) porque las dos direcciones del error no cuestan lo mismo:
   cachear una metrica que nadie declaro puede apagar una alerta de dinero en silencio; no cachearla
   solo cuesta recomputo. La ausencia de decision no se queda muda: la pone roja el guardia.
3. **El censo del TTL se amplio con un ARCHIVO, no con `lib/services`.** El directorio entero
   arrastraria decenas de servicios ajenos y bastaria un `3600` legitimo en cualquiera de ellos para
   que el guardia naciera rojo y se desarmara — la leccion que ese mismo archivo ya tiene escrita
   para `lib/`. Se toco `archivos()` para que acepte una ruta de archivo.
4. **Los tests financieros reusan `tests/unit/services/_dobles-analitica-financiera.ts`** (dobles de
   la 127) en vez de crear otro juego: una segunda familia de dobles del mismo servicio es una
   segunda idea de lo que el servicio devuelve.

---

## 7. Salida real del gate

Corrido en `C:/w179` hoy. **No se corrio la suite completa** (la corre el leader).

```
$ pnpm typecheck
> tsc --noEmit
(sin salida — verde)

$ pnpm lint
✖ 53 problems (0 errors, 53 warnings)
  (0 errores; las 53 son `no-unused-vars` de parametros con `_`, preexistentes.
   La unica de un archivo nuevo: cache-financiera-decorador.test.ts:75 `_c`, mismo patron del repo)

$ pnpm exec vitest run <los 9 tests nuevos + los 3 guardias de la 128 que siguen verdes>
 Test Files  12 passed (12)
      Tests  85 passed (85)
  (tags.guardia, config.guardia y aislamiento.guardia de la 128 incluidos)

$ pnpm exec vitest run <los 7 tests de cache de la 128>
 Test Files  1 failed | 6 passed (7)
      Tests  2 failed | 24 passed (26)
  → el unico rojo es `cache-financiera.guardia.test.ts` (D2 de la 128). ESPERADO: §5.

$ pnpm exec vitest related --run <los 8 archivos de lib/ tocados o nuevos>
 Test Files  3 failed | 49 passed (52)
      Tests  3 failed | 599 passed (602)
  → los 3 rojos son timeouts de jsdom en tests/components/ (FiltrosOperativos,
    TableroOperativo, TableroOperativoLatencia). Comprobados EN AISLADO:
      pnpm exec vitest run tests/components/FiltrosOperativos.test.tsx tests/components/TableroOperativoLatencia.test.tsx
        Test Files  2 passed (2) · Tests 28 passed (28)
      pnpm exec vitest run tests/components/TableroOperativo.test.tsx
        Test Files  1 passed (1) · Tests 50 passed (50)
    → flakes por saturacion, no regresiones. Ninguno importa nada de esta feature.
```

---

## 8. Lo que queda sin hacer (y no es opcional)

- **T3.1–T3.9** — los ocho escritores. Sin ellos la cache financiera esta **cacheando dinero sin un
  solo invalidador**: hoy el arbol sirve cifras que solo caducan por TTL (una hora). **Esta tanda no
  es mergeable sola**, y no por ceremonia: es el estado exacto que D2 de la 128 rechazo.
- **T3.10** — R16 y R24 (el registro de origen y el fallo que no propaga). El codigo esta; los tests
  no.
- **T4.1 (cierre) / T4.2** — el guardia del censo. El registro existe pero no lo hace cumplir nadie.
- **T5.1** — retirar `cache-financiera.guardia.test.ts`. **Depende de T3.1–T3.10 y T4.2 verdes.**
- **T5.2 / T5.3** — el guardia branch-scoped de frontera de archivos (R25) y su retirada.
- **T6** — mapa completo y `./init.sh` entero con delta 0 contra la medicion de T0.2.

## 9. Lo que me chirria

- **La feature esta, ahora mismo, en su peor estado posible**: cachea dinero y no lo invalida nadie.
  Es un estado intermedio legitimo dentro de un PR, pero **no puede sobrevivir a un push a `dev`**.
  Si por lo que sea T3 no entra, lo correcto es revertir T2.4 (el cableado del composition root):
  con eso el decorador queda escrito y probado pero **desconectado**, y el guardia de D2 vuelve a
  verde. Es la unica forma segura de aterrizar solo T1+T2.
- **`design.md §2` no lista `lib/services/IncidenteAdminService.ts` entre los archivos con ruta
  completa** pero si lo nombra en la tabla («158/184»). No afecta a esta tanda; conviene fijarlo
  antes de T3.5 para que el guardia de frontera de T5.2 no lo marque.
- **El registro de escritores adelantado** (§4.d) es la unica pieza de esta entrega que hoy es una
  declaracion sin prueba. Preferiria que el leader la commiteara junto con T4, no con T1.
