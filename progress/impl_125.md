# Bitacora de implementacion — Feature 125 (backfill historico de analitica)

> Rama `feature/125-analitica-backfill-historico`, worktree `C:/w125`, sobre `origin/dev`
> @ `5314a2a8` (que ya incluye la 124, PR #260). Zona: backend.

## T1.1 — Baseline MEDIDO en esta rama y en esta sesion (2026-08-02)

No se cita ningun baseline ajeno: los de bitacora caducan con cualquier PR ajeno.

1. `pnpm db:generate` desde el schema limpio (el cliente generado sobrevive al cambio de rama y
   mete tipos fantasma en el typecheck): `✔ Generated Prisma Client (v7.8.0) ... in 636ms`.
2. `pnpm test` completo, sobre el arbol SIN tocar (commit `e657f666`):

```
 Test Files  1 failed | 777 passed (778)
      Tests  1 failed | 9431 passed (9432)
   Duration  250.16s
```

Sin «unhandled errors» de workers: la corrida NO esta degradada (778 archivos es el total con el
que se compara al cierre).

**El unico rojo es un flake ajeno por saturacion, comprobado en aislado:**

```
 FAIL tests/components/CuentasPorPagarTable.test.tsx
      > filtra la lista por nombre de mensajero sin tocar montos
      TestingLibraryElementError: Unable to find an element with the text: Ana Mensajera

$ pnpm vitest run tests/components/CuentasPorPagarTable.test.tsx
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**Baseline que manda: 778 archivos / 9432 tests / 1 rojo (flake ajeno, verde en aislado).**

---

## T1 — Planificador puro del rango (R6-R10, R20)

- **Creado** `lib/analytics/backfill-rango.ts`: `HORIZONTE_HISTORIAL_CR = "2026-07-13"` con su
  procedencia (la migracion `20260713120000_orden_historial_estado`, aditiva y sin backfill),
  `esNoComparable` y `planificarBackfill({ desde, hasta, ahora })`.
  Solo importa `@/lib/utils/fecha-cr`; sin `process.env`, sin `console`, sin aritmetica de zona
  horaria propia (el «ayer CR» del mensaje de rechazo sale de `ultimosNDiasCalendarioCR`).
- **Creado** `tests/unit/analytics/backfill-rango.test.ts` (16 casos).
- Guardia de pureza (135/R1) reejecutado con el archivo nuevo dentro del censo: verde.

```
$ pnpm vitest run tests/unit/analytics/backfill-rango.test.ts tests/unit/analytics/modulo-puro.guardia.test.ts
 Test Files  2 passed (2)
      Tests  45 passed (45)
```

---

## T2 — Servicio iterador (R3, R11-R18, R21-R23, R25, R31)

- **Creado** `lib/interfaces/services/IAnaliticaBackfillService.ts` (contrato: `OpcionesBackfill`,
  `ClasificacionFecha`, `LineaFecha`, `FallaFecha`, `ResumenBackfill`, puerto `SalidaProgreso`).
- **Creado** `lib/services/AnaliticaBackfillService.ts`. Sin Prisma, sin `console`, sin `process`:
  reloj, pausa y salida se inyectan por constructor.
- **Modificado** `lib/config/analitica-rollup.ts`: `+FALLOS_CONSECUTIVOS_QUE_ABORTAN = 3`. Es el
  unico archivo de la 124 que la 125 toca, y solo SUMA (R33). El nombre esquiva a proposito el
  patron `(UMBRAL|LIMITE|MAX)…(FILAS|VOLUMEN|CUBOS)` que vigila R47(d) de la 124: no es una cifra
  de volumen.
- **Creado** `tests/unit/services/analitica-backfill-service.test.ts` (27 casos).

Tres decisiones que no estaban forzadas por la spec y que van con su porque:

1. **El servicio recibe el plan YA validado, no el rango.** El CLI necesita el plan ANTES de
   confirmar (el eco de R27 dice cuantas fechas y cuantas no comparables), asi que planificar dos
   veces seria arriesgarse a que el eco y el recorrido no coincidan.
2. **`fechasFallidas` es la unica lista que el resumen acumula**, y lleva nombres, no detalle. R31
   exige que toda fecha fallida aparezca en el resumen; R15 prohibe acumular el DETALLE de mas de
   una fecha. Las lineas por fecha salen por el puerto segun se producen.
3. **Una fecha que el reporte previo no cubre se clasifica `cambiada`, no `estable`.** El CLI ya
   rechaza antes ese reporte (R24), asi que este caso solo se alcanza por programa; llamarlo
   estable seria un falso verde por la puerta de atras.

## T3 — CLI y reporte de corrida (R1, R2, R6, R7, R19, R24, R26-R30)

- **Creado** `scripts/backfill-analitica.ts`: zod en el borde (argumentos y reporte previo), eco,
  confirmacion literal, reporte JSON, codigos 0/1/2, auto-ejecucion solo como entrypoint.
- **Creado** `tests/unit/scripts/backfill-analitica-cli.test.ts` (36 casos).

Todo el mundo exterior del script esta inyectado (`EntornoCli`): argv, entorno, reloj, salida,
lectura/escritura de archivos, constructor del agregador y pausa. Por eso los 36 casos corren sin
base, sin disco y sin proceso hijo, y casi todos afirman **cero llamadas al agregador**, que es lo
unico que demuestra que una guarda corta antes de tocar la base.

Cambio que hizo falta y no estaba previsto: `main()` ya no envuelve `process.loadEnvFile()` en un
`try/catch`. Un `.env` presente pero ilegible tiene que ser ruidoso, y un `catch` vacio —aunque
lleve un comentario dentro— es exactamente lo que el guardia de R31 prohibe. Ahora es
`if (fs.existsSync(".env")) process.loadEnvFile()`.

## T4 — Guardia estructural (R2, R4, R5, R8, R20, R29, R31, R32, R33)

- **Creado** `tests/unit/analytics/backfill-guards.test.ts` (19 casos), con autocomprobacion por
  fixtures (uno legitimo, dos infractores) y ocho casos mas que ejercitan cada regla por separado.
- El censo NO es una lista fija que pueda quedarse atras: un caso comprueba que **todo** archivo
  del arbol que importe un modulo de la 125 esta en la lista censada.
- **T4.2 — los tres guardias heredados, reejecutados SIN editarlos, verdes:**

```
$ pnpm vitest run tests/unit/analytics/backfill-guards.test.ts \
    tests/unit/analytics/alcance-obligatorio.guardia.test.ts \
    tests/unit/analytics/rollup-guards.test.ts tests/unit/analytics/modulo-puro.guardia.test.ts
 Test Files  4 passed (4)
      Tests  78 passed (78)

$ pnpm vitest run tests/integration/db/analytics-daily-guards.test.ts tests/integration/db/analytics-daily-job.test.ts
 Test Files  2 passed (2)
      Tests  53 passed (53)
```

Un ajuste sobre lo escrito en la spec: el caso de R5 no puede buscar la palabra «backfill» en
`db/schema.prisma`, porque ya aparece cuatro veces en prosa (la 101, la 123 y dos comentarios de
columna). Lo que se censa es la DECLARACION: `model|enum \w*Backfill` y `@@map("…backfill…")`.

## T5 — Integracion contra Postgres local (R12, L1)

- **Creado** `tests/integration/db/analytics-daily-backfill.test.ts` (6 casos), reutilizando tal
  cual el arnes de la 124 (`_semilla-rollup.ts`: transaccion revertida + fechas de 2001).

**L1 queda DEMOSTRADA, no afirmada.** Una orden con gestion de entrega pero sin ni una fila de
`orden_historial_estado` anterior al corte no entra en ningun cubo: la corrida termina con exito,
escribe CERO filas y `analytics_daily` se queda vacia para esa fecha. El caso gemelo —la MISMA
orden, con una sola transicion— si produce filas, que es lo que convierte el cero anterior en una
medida y no en un test que pasa por vacio.

```
$ pnpm vitest run tests/integration/db/analytics-daily-backfill.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## T7 — Corrida real medida y runbook (R35)

Toda la evidencia esta en **`progress/backfill_125.md`** y el reporte en
`progress/backfill_125_reporte.json`. Resumen:

- Base saneada antes de medir: `prisma migrate status` → «Database schema is up to date!», **sin
  drift**; 105 migraciones.
- Rango medido: **2026-07-10 .. 2026-08-01** (23 fechas, 3 bajo horizonte) contra
  `localhost:5432/ordenex`.
- Ensayo sin `--confirmar`: eco completo y **cero invocaciones** del agregador.
- Corrida real: 23 procesadas, 0 fallidas, **278 filas escritas**, 0 retiradas, 698 ms. Pico de
  una fecha: **24 filas** (2026-07-27). Codigo 0.
- `--verificar --contra` a continuacion: **20 estables + 3 no comparables, 0 cambiadas, 0
  fallidas**, `filasRetiradas = 0` en las 23 fechas. Codigo 0.
- **L1 confirmada tambien con datos reales**: las tres fechas bajo horizonte dan 0 filas, y en esta
  base no hay ni una transicion de historial anterior al 2026-07-17.
- La corrida dejo 278 filas en el `analytics_daily` LOCAL (la tabla estaba vacia). Es el efecto
  buscado de T7.3, no un residuo de test: los tests de integracion corren todos en transacciones
  revertidas.

## T6 / R34 — PARADO, requiere decision humana

**No se ha tocado `UMBRAL_AVISO_FILAS_CORRIDA`, y esto es deliberado.**

R34 pide sustituirlo por «una cifra con procedencia documentada» en cuanto exista la medicion de
R35. La medicion existe y esta arriba, pero **mide el universo equivocado para esa constante**: el
rango medido tiene 58 ordenes en total y su pico es de 24 filas en una fecha. El umbral gobierna
el aviso de volumen de la corrida en PRODUCCION, que sigue sin medir. Convertir 24 en un umbral de
produccion exige multiplicarlo por un factor inventado, que es exactamente lo que D5 prohibe
(«medir primero, fijar el tope despues»).

Ademas, cumplir R34 **obliga a editar aserciones de un guardia ajeno**, no solo su allowlist:

- `tests/unit/analytics/rollup-guards.test.ts` › caso **(a)** exige que el comentario de la
  constante diga «PROVISIONAL» **y** «NO MEDIDA». R34 pide que deje de decir «no medida», asi que
  cambiar el valor sin tocar ese caso lo pone rojo.
- El allowlist `AJENAS_A_R47` (dos entradas de `20_000` usadas como timeout) queda MUERTO en
  cuanto el valor cambie, y el propio guardia tiene un caso que lo detecta. R33 SI autoriza tocar
  ese allowlist; el caso (a) es otra cosa.

Tocar (a) para poner en verde un numero que no esta medido seria las dos cosas que no se hacen:
relajar un guardia y rellenar un dato desconocido. **Queda como decision del leader**, con las tres
salidas posibles escritas: (i) medir contra produccion y entonces sustituir; (ii) declarar R34
fuera del alcance de esta entrega y llevarlo a una ficha propia; (iii) aceptar una cifra
extrapolada, diciendo en el comentario que es una extrapolacion y no una medida —lo que exige
reescribir el caso (a) del guardia para que exija «extrapolada» en vez de «no medida»—.

**Consecuencia para la trazabilidad: R34 es el unico de los 35 requisitos que hoy NO tiene test en
verde que lo mida.**

---

## Mutaciones (romper la implementacion a proposito)

Cada mutacion se aplico sobre el codigo real, se corrio la suite indicada y se restauro el archivo
desde una copia. **Las 15 murieron.** Un test que sigue verde con el codigo roto no mide nada.

| # | Mutacion | Tests que cayeron |
|---|---|---|
| M1 | `esNoComparable` usa `<=` en vez de `<` (el dia del horizonte pasa a no comparable) | 6 |
| M2 | el planificador admite el dia CR en curso (`hasta > hoy` en vez de `>=`) | 4 |
| M3 | la pausa se aplica tambien despues de la ultima fecha | 1 |
| M4 | `estable` deja de exigir `filasRetiradas === 0` | 1 |
| M5 | una fecha fallida deja de forzar codigo distinto de 0 | 6 |
| M6 | desaparece el corte por fallos consecutivos | 1 |
| M7 | el fallo de una fecha aborta el rango entero (`break` en vez de `continue`) | 3 |
| M8 | la confirmacion deja de compararse con el rango del eco | 1 |
| M9 | `--verificar` deja de exigir que el reporte cubra el rango | 1 |
| M10 | por defecto se imprime el mensaje CRUDO del error (con la clave del cubo dentro) | 2 |
| M11 | `destinoLegible` devuelve la URL cruda (con usuario y contrasena) | 2 |
| M12 | el guardia estructural deja de vigilar la tabla de analitica | 1 |
| M13 | el recorrido va de atras hacia adelante | 5 |
| M14 | dos llamadas SIMULTANEAS por fecha (paralelismo) | 9 |
| M15 | el reporte solo escribe la primera fecha | 1 |

## Mapa `R<n>` → test

Todos ejecutados y verdes salvo donde se dice. Archivos:
`P` = `tests/unit/analytics/backfill-rango.test.ts` ·
`S` = `tests/unit/services/analitica-backfill-service.test.ts` ·
`C` = `tests/unit/scripts/backfill-analitica-cli.test.ts` ·
`G` = `tests/unit/analytics/backfill-guards.test.ts` ·
`I` = `tests/integration/db/analytics-daily-backfill.test.ts`

| R | Test que lo mide | Estado |
|---|---|---|
| R1 | `C` › «importar el modulo no imprime, no sale del proceso y no toca la base» + «la auto-ejecucion esta guardada por la comparacion con process.argv[1]» | verde |
| R2 | `G` › «ni el backfill declara superficie, ni nadie con superficie lo importa» | verde |
| R3 | `S` › «recorre un rango de cinco fechas sin tocar base, red ni consola» + «el modulo del servicio no importa Prisma ni la capa de base de datos» | verde |
| R4 | `G` › «ninguno consulta la base ni nombra la tabla del rollup en codigo» + «las filas salen del agregador de la 124 y de ningun otro sitio» | verde |
| R5 | `G` › «no hay migracion de la 125 ni rastro suyo en el schema» + «ninguno de los archivos menciona ninguna de las cinco tablas de dinero» | verde |
| R6 | `C` › «el eco anuncia tres fechas y, sin confirmar, sale 0 sin invocar al agregador» + «con confirmacion recorre las tres fechas en orden» | verde |
| R7 | `C` › los siete casos de «codigo distinto de 0, motivo impreso y cero llamadas» + «la ausencia de rango NO se interpreta como toda la base» | verde |
| R8 | `P` › «el plan sale de fecha-cr: el borde del dia CR decide la fecha de hoy, no el reloj UTC» + `G` › «el rango es de calendario y no sale de los presets» | verde |
| R9 | `P` › «produce N fechas ascendentes y sin repetidos…» + «cruza fin de mes, fin de ano y bisiesto…» | verde |
| R10 | `P` › los cuatro casos de «rechaza el rango que TERMINA hoy CR / EMPIEZA manana CR / ENTERO / admite ayer CR» + `C` › «el dia CR en curso se rechaza aunque la confirmacion sea correcta» | verde |
| R11 | `S` › «llama exactamente una vez por fecha del plan y en orden» + «no llama con ninguna fecha fuera del rango» + `I` › «un rango de tres dias produce tres lineas, ascendentes y sin repetidos» | verde |
| R12 | `I` › «un rango de tres dias sembrados se recomputa entero y queda estable» | verde |
| R13 | `S` › «sigue con las fechas siguientes y las procesa» + «NO reintenta la fecha fallida dentro de la misma pasada» | verde |
| R14 | `S` › «corta a los N fallos seguidos y no llama al agregador ni una vez mas» + «los fallos NO consecutivos no cortan» | verde |
| R15 | `S` › «nunca hay dos llamadas al agregador en vuelo a la vez» + «el resumen de una corrida de 40 fechas no contiene el detalle de ninguna» | verde |
| R16 | `S` › «espera la pausa pedida ENTRE fechas consecutivas, no despues de la ultima» + «con el valor por defecto no espera ni una vez» | verde |
| R17 | `S` › «la linea trae los cinco campos y los valores son los del ResumenCorrida de la 124» | verde |
| R18 | `S` › «los siete campos de R18 estan y cuadran entre si» + «una sola fecha fallida entre cuatro buenas fuerza el codigo distinto de 0» | verde |
| R19 | `C` › «el JSON trae cabecera + una entrada por fecha con los cinco campos» + «el reporte no lleva ni un identificador ni ninguna coordenada del rollup» | verde |
| R20 | `P` › «el plan separa las fechas bajo horizonte sin sacarlas del recorrido» + `G` › «la constante vive en un solo archivo y su procedencia existe de verdad» | verde |
| R21 | `S` › «la fecha bajo horizonte se invoca igual que las demas» + «no altera, simula ni rellena ninguna medida» + `I` › «la MISMA orden, con una sola transicion anterior al corte, ya produce filas» | verde |
| R22 | `S` › «los dos ceros se distinguen por la clasificacion y por el conteo del resumen» | verde |
| R23 | `S` › «compara cada fecha contra SU entrada del reporte, no contra un total» + «la verificacion vuelve a invocar el agregador: recomputa, y por eso ESCRIBE» | verde |
| R24 | `C` › «sin --contra aborta antes de invocar el agregador» + «con --contra apuntando a un archivo que no existe…» + «con un reporte que NO cubre todo el rango…» + «con un reporte que no es JSON…» | verde |
| R25 | `S` › «produce las CUATRO categorias en una sola pasada» + «estable exige las DOS condiciones» + «una pasada con TODO estable o no comparable sale con codigo 0» | verde |
| R26 | `C` › «lo dice antes de la primera invocacion y no se anuncia como solo lectura» | verde |
| R27 | `C` › «las seis cosas estan en el eco, y estan antes de la primera invocacion» + «destinoLegible reconstruye host:puerto/base y no devuelve nada de la credencial» | verde |
| R28 | `C` › «sin --confirmar imprime el plan, sale 0 y no invoca nada» + «con el rango reintroducido DISTINTO aborta…» + «solo el rango reintroducido LITERALMENTE deja pasar» | verde |
| R29 | `G` › «ninguno lleva una URL ni una credencial escrita» + `C` › «ni en el eco, ni en el progreso, ni en el resumen, ni en el reporte, ni en los errores» | verde |
| R30 | `C` › «por defecto NO aparece la clave del cubo…» + «imprime la etapa cuando el error la trae» + «con --verboso si aparece el error completo» + «--verboso no se activa por la omision de ningun otro argumento» | verde |
| R31 | `S` › «la falla lleva fecha, modo, nombre del error y etapa…» + «no continua en silencio…» + `G` › «todo catch hace algo» | verde |
| R32 | `G` › «el fixture legitimo no produce ni una infraccion» + «el infractor que consulta la tabla del rollup…» + «el infractor que expone superficie…» + «las demas reglas tambien discriminan, una por una» | verde |
| R33 | `G` › «ningun modulo del escritor nombra en codigo a la 125» + «el unico archivo de la 124 que la 125 amplia es el de configuracion, y solo suma» | verde |
| R34 | — | **NO cubierto. Parado a proposito: ver «T6 / R34» arriba.** |
| R35 | `I` › «un rango de tres dias sembrados se recomputa entero y queda estable» + la corrida real de `progress/backfill_125.md` (23 fechas, 278 filas, verificacion 20 estables / 0 cambiadas) | verde |

**34 de 35 con test nombrado en verde. R34 parado, con la razon escrita.**

---

## Cierre (T8) — medido el 2026-08-02, en esta rama

```
$ pnpm typecheck
(sin salida: limpio)

$ pnpm lint
✖ 27 problems (0 errors, 27 warnings)     ← identico al baseline; ninguna advertencia
                                             de los archivos de la 125

$ pnpm test
 Test Files  783 passed (783)
      Tests  9535 passed (9535)
   Duration  280.18s
```

| | Baseline (`e657f666`) | Final | Delta |
|---|---:|---:|---:|
| Archivos de test | 778 | 783 | **+5** (los cinco de la feature) |
| Tests | 9432 | 9535 | **+103** |
| Rojos | 1 (flake ajeno, verde en aislado) | **0** | **−1** |
| Errores de lint | 0 | 0 | 0 |

La corrida final **no esta degradada**: 783 archivos (778 del baseline + los 5 nuevos), sin
«unhandled errors» de workers. El flake ajeno de `CuentasPorPagarTable` no reprodujo esta vez, que
es exactamente lo que se espera de un flake por saturacion.

**Veredicto: la feature esta implementada y medida; 34 de 35 requisitos con test nombrado en
verde, y el que falta (R34) esta parado a proposito porque cerrarlo exige una decision humana y un
dato que esta medicion no da.**
