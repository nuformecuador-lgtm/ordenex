# Feature 180 — desglose por fecha para las series temporales · REVIEW

> Revisor independiente. Worktree `C:/wser`, rama `feature/180-analitica-financiera-serie-temporal`,
> commits `b0003f8f`, `085e01bc`, `762e0a0f`, `e99fae19`, `ed95b6a3` sobre `8fbca024` (spec).
> Arbol limpio al empezar y al terminar. Ni un archivo de produccion editado de forma permanente:
> las mutaciones se sembraron con un script de sustitucion exacta y se revirtieron con la
> sustitucion inversa (nunca `git checkout`), comprobando `git status` limpio despues de cada una.

## Estado: EN CURSO (se escribe incrementalmente)

---

## A. Reverificaciones pedidas expresamente

### A.1 — Mutacion 18 / R2 / ⟨L2⟩ · decision por id suelto — **CONFIRMADA, las dos mitades**

Siembra reproducida por mi cuenta en `lib/services/AnaliticaFinancieraService.ts` (dentro de
`deCaja`): `const conDesglose = consulta.metrica.id === "egresos";`.

```
$ pnpm exec vitest run tests/unit/analytics/financiera-desglose-ids.guardia.test.ts \
                      tests/unit/guards/tablero-financiero.guardia.test.ts

 ❯ financiera-desglose-ids.guardia.test.ts (11 tests | 1 failed)
     × R2 · el censo no encuentra ni un id suelto entre comillas fuera de la declaracion
       + "lib/services/AnaliticaFinancieraService.ts: egresos: === \"egresos\""
   tablero-financiero.guardia.test.ts        24 passed        <-- listasDeIdsAMano LO DEJA PASAR

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 34 passed (35)
```

Las dos mitades que la bitacora afirma son ciertas y **las he medido yo**:
- el guardia propio del R2 (`financiera-desglose-ids.guardia.test.ts`) **muere** con un id suelto;
- `listasDeIdsAMano` de `tablero-financiero.guardia.test.ts` **pasa verde 24/24** con la misma
  siembra, o sea que la deuda heredada de la 183 es real y el R2 **no** podia apoyarse en el.

Veredicto parcial: ⟨L2⟩ **cumplido**. El R2 esta protegido por un guardia que si cubre el caso.
Mutacion restaurada; `git status` limpio.

### A.2 — Mutacion 17 / R16 · `Number(x).toFixed(2)` y el ensanche del detector — **CONFIRMADA**

Siembra reproducida en `lib/repositories/IngresosAnaliticaRepository.ts`:
`(g._sum.monto ?? new Prisma.Decimal(0)).toFixed(2)` → `Number(g._sum.monto ?? 0).toFixed(2)`.

- **Con el detector de la 180** (`\bparseFloat\s*\(|\.\s*toNumber\s*\(|\bNumber\s*\(`): el censo de
  archivos se pone **ROJO** —
  `"lib/repositories/IngresosAnaliticaRepository.ts: convierte dinero a number..."` (linea 117).
- **Revirtiendo yo el detector al pre-180** (quitando `|\bNumber\s*\(`) y dejando la misma mutacion
  de produccion: el censo de la linea 117 pasa **VERDE**. El unico rojo que queda es el caso nuevo
  de autocomprobacion del propio detector, que es el meta-test.

Conclusion medida por mi: la mutacion **sobrevivia** al detector viejo. El ensanche es un
**endurecimiento real**, no una racionalizacion. Ambas mutaciones restauradas; arbol limpio.

### A.3 — Mutacion 10 / R27 · filas `bruto_y_neto` con total `solo_bruto` — **CONFIRMADA**

Siembra reproducida en `deCaja`: las `filas` se construyen con un `importeConNeto(...)` fijo
mientras el `total` sigue saliendo de `construirImporte` (que respeta `forma`).

```
$ pnpm exec tsc --noEmit     -> LIMPIO (el compilador NO la atrapa, como ⟨L1⟩.3 advertia)

$ pnpm exec vitest run tests/unit/services/analitica-financiera-serie.test.ts \
                      tests/unit/analytics/financiera-forma-importe.guardia.test.ts
 Test Files  2 failed (2)
      Tests  4 failed | 34 passed (38)
   incl. analitica-financiera-serie.test.ts:741
     expect(vista.filas.map((f) => f.importe.forma)).toEqual(Array(cubos).fill("solo_bruto"))
       -> recibido ["bruto_y_neto", x5]
```

La union discriminada no protege (typecheck verde) y **la atrapa el test**, en dos archivos
distintos y por cuatro casos. R27 esta cubierto de verdad. Mutacion restaurada; arbol limpio.

---

## B. Los guardias, asercion por asercion (¿se ensancho por un lado y se aflojo por otro?)

Revisado `git diff 8fbca024..HEAD` de **todos** los archivos de guardia tocados. Resultado: **NO
se retiro ni se debilito ni una asercion**. Detalle:

**`financiera-repositorios.guardia.test.ts`**
- `derivaEnElRepositorio`: el detector de derivacion (`\.sub\(` etc.) **intacto**; el de `number`
  ENSANCHADO (`|\bNumber\s*\(`); el de `try/catch` y el de `"0.00"` **intactos**; la lista de
  archivos censados **la misma**. Verificado en A.2 que el ensanche es real.
- `toHaveLength(8)` → `toHaveLength(11)`: es la actualizacion que H5/R31 exigen, y el ancla sigue
  siendo una igualdad exacta (no un `>=`).
- Dos casos **anadidos**: el que mata `Number(x).toFixed(2)` y el contrapeso que exige que
  `new Prisma.Decimal(...)` NO se marque. Y un caso mas —`trocear(...).length > 0`— que impide que
  los dos casos de propagacion nuevos pasen por la via «con `cubos: []` no se consulta».

**`financiera-fuente.guardia.test.ts`** — solo alta de `lib/analytics/cubo-temporal.ts` en
`ARCHIVOS_DECLARADOS` (13 → 14). La igualdad exacta declarados-vs-existentes se conserva **y**
gana una asercion nueva `toHaveLength(14)`. Queda **mas** fuerte.

**`modulo-puro.guardia.test.ts`** — alta de `cubo-temporal` en `CARGADORES` (9 → 10). Ni una
asercion retirada; `ARISTAS_PERMITIDAS` intacto.

**`analitica-financiera-service.test.ts`** — el censo de reloj/azar (`Date.now(`, `Math.random(`,
`new Date()`) **gana** `lib/analytics/cubo-temporal.ts` en su lista y el detector no se toca. El
unico numero que baja de exigencia aparente es `consultasHechas() toBe(1)` → `toBe(2)`, que es
consecuencia forzosa de las dos consultas y sigue siendo igualdad exacta, con la asercion
**anadida** `sumarPorCuboYCategoria toHaveBeenCalledTimes(1)`.

**`analitica-financiera-derivacion.test.ts`** — los espias de `derivarBalance` /
`derivarCuentaPorPagar` pasan de una llamada esperada a dos (cubo + total), siempre con
**igualdad exacta de argumentos**. El caso «a `derivarBalance` no se la llama en las tres
homogeneas» sigue exigiendo `[]`, y ahora dice mas que antes (una fila construida con el otro
constructor apareceria ahi). Nada retirado.

**`alcance-obligatorio.guardia.test.ts` y `financiera-trazabilidad.guardia.test.ts`**: **no se
tocaron** y no hacia falta. El primero descubre por lectura de directorio y su rama
`(queryRaw|executeRaw)[\s\S]{0,400}\btabla\b` **si ve** las dos consultas crudas nuevas; los dos
archivos reciben `ConsultaAnalitica` y no la forjan, asi que pasan por la via legitima. R22/R23
quedan cubiertos sin ampliar nada.

**`cache-financiera.guardia.test.ts`**: sin tocar, verde. Y **medido por mi**, mas fuerte que el
guardia: `git diff 8fbca024..HEAD -- lib/ app/ components/ | grep cacheTag|revalidateTag|unstable_cache`
sale **vacio**. R30 cumplido por el diff, no solo por el estado.

---

## C. Verificacion ejecutable (corrida por mi, no citada)

```
$ ./init.sh --rapido
  test:cambiados   Test Files  93 passed | 3 skipped (96)   Tests 1087 passed | 24 skipped
  test:guardias    Test Files  64 passed (64)               Tests  860 passed
  ✓ todas las migraciones tienen down.sql
  == init OK ==

$ pnpm exec vitest run tests/unit/analytics tests/unit/services tests/unit/guards \
      tests/components/TableroFinanciero.test.tsx tests/components/AnaliticaPage.test.tsx
 Test Files  275 passed (275)
      Tests  3984 passed (3984)

$ pnpm exec tsc --noEmit
 (sin salida — limpio)

$ DATABASE_URL=<inline, leida del .env del checkout principal> \
  pnpm exec vitest run tests/integration/repositories/financiera-cubo-temporal.integration.test.ts
 Test Files  1 passed (1)      Tests  7 passed (7)
```

El test de integracion **contra Postgres real** cubre lo que ningun doble puede: que
`width_bucket(anyelement, anyarray)` existe, que el huso de la sesion NO es UTC (que es lo que
hace peligroso `::timestamptz`), la frontera de dia CR a un milisegundo de las 06:00Z **en los
dos libros**, el arrastre de tres meses antes y los indices 0/1 del primer cubo semanal recortado.
Q6 y R11/R14 estan **medidos**, no supuestos.

---

## D. Trazabilidad R1..R32 — comprobada leyendo los tests, no el mapa

He abierto los archivos citados y leido los nombres y los cuerpos de los casos. El mapa de
`progress/impl_180.md` es **fiel**: los 32 requisitos citan tests que existen, estan **nombrados
por el comportamiento** y **no son cascarones**. Lo que me convence de que no son vacuos, mas alla
de las tres mutaciones que reproduje, es un patron que aparece en casi todos los bloques: cada
afirmacion lleva su **contra-caso discriminador** escrito al lado. Ejemplos que verifique:

- `R8 · y el cubo que SI tuvo movimiento no vale cero: el caso de arriba discrimina`
- `R9 · y con el libro entero vacio si valen cero: el caso de arriba no pasa por construccion`
- `R12 · el detector discrimina: perder un cubo rompe la igualdad`
- `R13 · el bruto acumulado NO es el del ultimo cubo, asi que el caso de arriba muerde`
- `R22 · el detector discrimina: el troceo de OTRO rango no coincide`
- `R24 · y el material sembrado SI llevaba el uuid: el barrido no es vacio`
- `R25 · y sin romper nada la misma consulta responde: el caso de arriba discrimina`

Dos requisitos que mire con lupa porque son los que mas facil se fingen:

- **R12** no es un caso, es una propiedad: libro generado de 400 movimientos, **tres** rangos
  (incluido uno de 181 dias, o sea grano `semana`), comparacion `Prisma.Decimal.eq` y no
  `Number(a) === Number(b)`, con precondiciones que impiden que pase por vacio.
- **R15** compara contra **totales escritos a mano** y, a proposito, el material `*PorCubo` del
  fixture trae numeros **distintos** del agregado: si alguien derivara el total de los cubos, los
  esperados cambiarian. Es exactamente lo que hace que las «dos consultas» de §E.1 valgan algo.
- **R20** lee de verdad las dos fuentes (`TOPE_PUNTOS_SERIE` de `lib/analytics/types.ts` y
  `MAX_PUNTOS_SERIE` de `components/private/analytics/topes.ts`), con un contrapeso que impide que
  la igualdad pase por `undefined === undefined`.

---

## E. Las seis decisiones de la puerta

| | Decision | ¿Respetada? | Como lo comprobe |
|---|---|---|---|
| **Q1** | las SIETE (seis de caja + `cuenta_por_pagar_mensajero`); `cod_recaudado` y `cuenta_por_pagar_tienda` fuera | **SI** | `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` es una constante de siete ids `satisfies readonly MetricaFinancieraId[]`; la mutacion 19 («anadir `cod_recaudado`») la mata el guardia propio; `financiera-granularidad.test.ts` R3 compara las DOS vistas de `cod_recaudado`, la de `cuenta_por_pagar_tienda` y `conciliacion_cierres` contra el DTO escrito de la 127 y ademas afirma que **no cambian con el rango**. |
| **Q2** | sin reloj; el cubo en curso NO se marca parcial | **SI** | El censo de `analitica-financiera-service.test.ts` (`Date.now(`, `Math.random(`, `new Date()`) **gana** `lib/analytics/cubo-temporal.ts`. Lei el modulo: sus dos `new Date(...)` llevan argumento explicito derivado de `fecha-cr`. `granularidadDe`/`trocear` no aceptan `now` y hay un test que lo afirma. El DTO no gano ningun campo de parcialidad. |
| **Q3** | la granularidad la decide el servidor; tope = mismo numero que `MAX_PUNTOS_SERIE` | **SI** | `cubo-temporal-tope.guardia.test.ts` **importa las dos fuentes** y las compara, con contrapeso anti-`undefined` y con un censo de que `cubo-temporal.ts` no importa de `components/` ni escribe el 62 a mano. R19 parametrico sobre 1..366 dias y sobre todos los dias de inicio. |
| **Q4** | solo backend | **SI** | El diff de produccion toca **solo `lib/`**. Lo que aparece de `app/`/`components/` en el diff son **fixtures de test** obligados por el campo requerido. Ningun panel de lineas. |
| **Q5** | cerrada por hecho consumado (la «182» es la **183**, ya `done`) | **SI** | La bitacora §7.1-7.2 lo trata como hecho y trabaja contra el codigo real (union discriminada, `egresos` conserva neto). Lo confirma A.3: los esperados de R27 son `solo_bruto` para `ingreso_flete` y `bruto_y_neto` para `egresos`. |
| **Q6** | SQL crudo acotado y parametrizado; corregir la prosa «ni un `$queryRaw`» | **SI** | `Prisma.sql` + `Prisma.join`, un parametro por limite, cero interpolacion, cliente tipado `Pick<..., "$queryRaw">` (sin `$queryRawUnsafe`). Cero `AT TIME ZONE` / `date_trunc` / `interval '6 hours'` en las dos consultas. Prosa de cabecera de `IngresosAnaliticaRepository` **corregida en este PR**, declarando que cambia, por que y con que cuatro limites; la de `CuentasPorPagarAnaliticaRepository` tambien, aunque no prometia lo mismo. Y el cast `::timestamp` (no `::timestamptz`) esta **medido contra Postgres real** en el test de integracion, que ademas afirma que el huso de la sesion NO es UTC — que es lo unico que hace la comprobacion significativa. |

**Invariantes de seguridad heredados:** R22 (guardia `alcance-obligatorio`, ver §B), R23 (solo
`wallet_movimiento` y `pago_mensajero_movimiento`, ambas de `TablaDinero`), R24 (los tres metodos
nuevos ni aceptan ni emiten id de persona; hay un barrido de uuid sembrado con su contra-caso, y
un test de que un rol prohibido no llega a invocar ninguno de los tres). **Cumplidos.**

### E.1 · Juicio sobre «dos consultas y no una»

**Es la decision correcta.** Derivar el total sumando los cubos habria convertido R12
(«Σ filas == total») en una tautologia: la invariante solo dice algo mientras los dos numeros
lleguen por caminos distintos, y ademas R15 («el total sigue siendo el que la 127 publica») se
cumple aqui **por construccion** —el total sale literalmente de la misma llamada de siempre— en
vez de por un test que podria envejecer. El fixture de R15 lo refuerza a proposito: el material
`*PorCubo` trae numeros distintos del agregado, de modo que el atajo se detectaria.

No abre una via de incoherencia **logica**: las dos consultas usan la misma ventana
`[rango.desde, rango.hasta)` y las mismas categorias del catalogo, y los cubos cubren el rango
exactamente y sin solape (probado en `cubo-temporal.test.ts`). Ver el `menor 3` para el unico
matiz real, que es de concurrencia y no de diseno.

### E.2 · Juicio sobre los tres limites que el implementer declara

- **§6.1 — la mutacion de la clave de cubo no matable por comportamiento: ACEPTADO.** Verifique el
  argumento y es correcto: todo `desde` de un cubo es `inicioDelDiaCREnUtc(f)` = `fT06:00:00.000Z`,
  y las 06:00Z caen en la misma fecha leidas en UTC y en CR, asi que no existe entrada que
  distinga `toISOString().slice(0,10)` de `fechaCalendarioCR(...)`. Ademas el guardia que si la
  mata —`ranges-reuso.guardia.test.ts`— **no es una lista declarada de archivos**: lee el
  directorio `lib/analytics` entero, asi que cubre `cubo-temporal.ts` solo y seguira cubriendo
  cualquier archivo futuro. Es la clase de limite correcta: declarada, argumentada y con red.
- **§9 — R30 con cobertura debil: NEUTRALIZADO por verificacion externa.** El guardia mide estado,
  cierto; pero el diff de produccion no contiene ni una ocurrencia de `cacheTag`, `revalidateTag`
  ni `unstable_cache` (comprobado por mi, §B). Eso es exactamente lo que el guardia no puede
  decir, y lo digo yo.
- **§9 — R31 con cobertura debil: NEUTRALIZADO por la revision asercion por asercion** de §B, que
  es precisamente lo que el implementer decia no poder demostrar. Nada relajado.

---

## F. Checklist de `CHECKPOINTS.md`

| Punto | Estado |
|---|---|
| `requirements.md` con EARS numerados | **OK** — R1..R32, puerta humana cerrada en §5 con ⟨L1⟩/⟨L2⟩ |
| `design.md` con alternativas descartadas y su porque | **OK** — §5.2, **seis** alternativas |
| `tasks.md` con todas las tasks marcadas `[x]` | **NO** — el archivo no usa checkboxes (ver `menor 1`) |
| Cada `R<n>` mapea a un test concreto | **OK** — comprobado leyendo los tests, §D |
| `progress/impl_180.md` con el mapa `R<n> → test` | **OK**, y ademas vigilado por un guardia propio |
| `pnpm run typecheck` sin errores | **OK** (corrido por mi) |
| `pnpm run lint` sin errores | **OK** — 0 errores, 48 warnings (44 preexistentes + 4 de parametros de doble) |
| `pnpm test` pasa | **OK** en lo relacionado (275 archivos / 3984 tests) + `./init.sh --rapido` verde. El `./init.sh` completo lo corre el humano antes del PR |
| E2E si toca flujo critico | **N/A** — es lectura de analitica, no muta dinero |
| RLS en tablas nuevas | **N/A** — ninguna tabla nueva, ninguna migracion, ningun cambio de esquema |
| Migraciones reversibles con `down.sql` | **N/A** — ninguna migracion. El check de `init.sh` pasa igual |
| Ningun secreto hardcodeado | **OK** — ninguna variable de entorno nueva; ningun `.env` creado |
| Webhooks con firma e idempotencia | **N/A** — no hay webhook |
| Controller sin queries ni logica | **OK** — el borde no cambio |
| Service sin HTTP | **OK** — `AnaliticaFinancieraService` no ve `Request`/`Response`/`headers` |
| Repository solo consultas, sin logica de negocio | **OK** — la derivacion con signo sigue en el servicio via `derivar*`; guardia de texto verde |
| Interfaces en `lib/interfaces/` | **OK** — `AgregadoCuboCategoriaCaja` y `AgregadoCuboTipo` viven con sus interfaces |
| Paginas protegidas validan permisos en servidor | **N/A** — no se toco `app/` |
| Sin hardcode de pais/moneda/cuenta | **OK** — la moneda sale de `monedaConfig`; el dia CR, de `lib/utils/fecha-cr.ts` |
| `./init.sh` en verde | **PARCIAL** — `--rapido` verde por mi; el completo lo corre el humano |
| `progress/review_180.md` con veredicto | **OK** — este archivo |
| Entrada en `progress/history.md` | **PENDIENTE** — bookkeeping del leader al cerrar |

---

## G. Hallazgos

### BLOQUEANTES

**Ninguno.**

### Menores

1. **`menor` — `tasks.md` sin `[x]`.** El archivo usa el formato `**T0.1 — ...** / **Hecho:** ...`
   y **no tiene ni una casilla**, asi que el checkpoint «todas las tasks estan marcadas `[x]`» no
   se puede satisfacer. No es culpa del implementer (el formato lo fijo el spec_author), pero la
   convencion del repo es la contraria: 127 tiene 38 `[x]`, 173 tiene 39 y 183 tiene 19. Es
   bookkeeping, no sustancia —verifique las tareas contra su criterio de «Hecho» una a una y estan
   cumplidas—, pero **conviene cerrarlo antes de pasar la ficha a `done`**.
2. **`menor` — `progress/decision_180.md` no existe.** T0.1 y T0.2 lo exigen por nombre. La puerta
   se cerro de otra forma —§5 de `requirements.md`, con tabla de decisiones fechada y los bloques
   ⟨L1⟩/⟨L2⟩ del leader—, que es sustancialmente equivalente y esta **mejor** documentada. Lo
   anoto para que el rastro no dependa de recordar donde quedo escrito. T0.2 quedo sin objeto: la
   183 ya habia aterrizado.
3. **`menor` — las dos consultas no van en la misma transaccion.** `deCaja`, `deTesoreria` y
   `deCuentaDeMensajeros` lanzan sus dos (o tres) lecturas con `Promise.all`, sin snapshot comun.
   Una escritura en el ledger que caiga **entre** las dos lecturas dejaria el `total` y la Σ de las
   filas discrepando en ese movimiento: la invariante R12 es cierta en los tests y **no esta
   garantizada en runtime**. Es transitorio (la siguiente carga cuadra), afecta a un punto de una
   grafica y el remedio —derivar el total de los cubos— cuesta convertir R12 en tautologia, que es
   peor. **No pido cambiarlo**; pido que quede dicho, porque hoy no lo esta ni en la bitacora ni en
   el codigo. Si algun dia molesta, el arreglo barato es un `$transaction` de solo lectura.
4. **`menor` — el `bruto` de `cuenta_por_pagar_mensajero` pasa de «Σ de todos los tipos» a
   `devengo + pago`.** Hoy es **exactamente** la misma cifra: comprobe que
   `enum PagoMensajeroMovimientoTipo` tiene dos valores y solo dos (`db/schema.prisma:1184-1189`),
   y R15 lo fija con un total escrito a mano. Pero el acoplamiento cambio de forma: si el enum
   ganara un tercer tipo, antes habria entrado en el bruto y ahora quedaria fuera **en silencio**.
   Es el mismo riesgo que el propio repositorio documenta —y decide no correr— para el filtro de
   categoria. Merece una linea de comentario, no un cambio.
5. **`menor` (informativo) — los 3 rojos de `tests/integration/db/analytics-daily-migration.test.ts`
   no son de esta feature.** No los conte. Corri por mi cuenta el test de integracion **de la 180**
   con la `DATABASE_URL` inline y da 7/7 verde. La feature no toca `db/schema.prisma` ni anade
   migraciones, asi que no tiene por donde afectar a ese guardia de drift.

---

## H. Que verifique yo y que acepte de la bitacora

**Verificado por mi, ejecutando:**
- las tres mutaciones que se me pidieron (18/R2+⟨L2⟩, 17/R16, 10/R27), sembradas y revertidas por
  sustitucion exacta, con `git status` limpio despues de cada una;
- que el typecheck **no** atrapa la mutacion de R27 (o sea que el test es la unica red);
- el `git diff` de **todos** los guardias tocados, asercion por asercion;
- `./init.sh --rapido`, `tsc --noEmit`, `pnpm run lint`, las suites de `analytics`/`services`/
  `guards`/componentes (275 archivos, 3984 tests) y el test de integracion contra Postgres real;
- que el diff de produccion no contiene `cacheTag`/`revalidateTag`/`unstable_cache` (R30);
- que `ranges-reuso.guardia.test.ts` escanea el **directorio** `lib/analytics` (no una lista), lo
  que sostiene la red de §6.1;
- que `alcance-obligatorio.guardia.test.ts` **si ve** el SQL crudo nuevo por su rama
  `(queryRaw|executeRaw)[\s\S]{0,400}\btabla\b`, y por eso no habia que tocarlo (R22);
- que `PagoMensajeroMovimientoTipo` tiene exactamente dos valores (base del `menor 4`);
- que las siete metricas del conjunto son las de Q1 y que las tres de fuera tienen regresion
  estructural escrita a mano;
- que R20 lee **las dos** fuentes de verdad;
- que el mapa R1..R32 cita tests que existen, nombrados por comportamiento, con contra-caso
  discriminador en los bloques criticos.

**Aceptado de la bitacora sin reejecutar:** las mutaciones 1-9, 11-16 y 19 (reverifique **tres**:
la 10, la 17 y la 18, y las tres se comportaron como dice; las demas las juzgo por lectura del test
que las mata, que en todos los casos existe, esta nombrado por el comportamiento y lleva su
contra-caso discriminador). Y el conteo exacto de la suite
completa (1 archivo rojo / 942), que el humano vuelve a medir con `./init.sh` antes del PR.

---

## VEREDICTO: **APROBADO-CON-NOTAS**

Sin bloqueantes. Las tres afirmaciones que se me pidio falsar **resistieron la falsacion**, y las
dos que el implementer declaraba como cobertura debil (R30, R31) quedan cerradas por verificacion
externa mia, no por su palabra. Los cinco hallazgos son `menor`: dos de bookkeeping (`tasks.md`
sin `[x]`, `decision_180.md` ausente), dos de documentacion de un riesgo real pero acotado (la
falta de transaccion comun, el acoplamiento al enum de tipos) y uno informativo.

**Antes de pasar la ficha a `done`:** marcar las tasks (`menor 1`), correr `./init.sh` completo en
un checkout con `.env`, y anadir la entrada a `progress/history.md`. Nada de eso vuelve al
implementer con codigo que arreglar.
