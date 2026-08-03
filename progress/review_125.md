# Review — Feature 125 (analitica: backfill historico de `analytics_daily`)

> Revisado el 2026-08-02 en el worktree `C:/w125`, rama `feature/125-analitica-backfill-historico`,
> 5 commits sobre `e657f666`. Todo hecho de inventario de este informe esta verificado leyendo el
> arbol de `C:/w125`; no se cita ninguna otra sesion ni bitacora ajena.

**VEREDICTO: RECHAZADO** — un solo bloqueante: **R34 sin test**. Todo lo demas esta en verde y es
solido. El bloqueante **no se arregla con codigo**: exige una decision del leader sobre la spec
(ver seccion 6). En cuanto R34 salga de esta spec (o se cierre con dato), el veredicto pasa a OK
sin tocar una linea de implementacion.

---

## 1. Verificacion ejecutable (medida por mi, en esta rama)

`./init.sh` corrio entero. Nota metodologica: la **primera** corrida se solapo con mis mutaciones y
salio contaminada (5 archivos rojos), asi que **la repeti sobre el arbol limpio**. Manda la segunda.

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | limpio, sin salida |
| `pnpm lint` | 27 problems (0 errors, 27 warnings), ninguna de un archivo de la 125 |
| `pnpm test` (arbol limpio) | **Test Files 783 passed (783) / Tests 9535 passed (9535) / 0 rojos** |
| Integracion contra Postgres | `tests/integration/db/analytics-daily-backfill.test.ts` **6/6 verdes y NO saltados** (comprobado con reporter verbose) |

- **783 archivos** coincide exactamente con lo declarado por el implementer (778 baseline + 5 de la
  feature). La corrida **no esta degradada**: no hay "unhandled errors" de workers y el total de
  archivos es el esperado.
- El flake ajeno `tests/components/CuentasPorPagarTable.test.tsx` no reprodujo.

## 2. Frontera con la 124

`git diff e657f666 --stat` = **13 archivos, 3420 insertions, 0 deletions**. De los archivos de la
124, **el unico tocado es `lib/config/analitica-rollup.ts`**, y su diff **solo suma**
`FALLOS_CONSECUTIVOS_QUE_ABORTAN = 3` con su comentario de procedencia: ni una linea retirada ni
modificada. `AnaliticaRollupService.ts`, `AnaliticaRollupRepository.ts`, sus interfaces,
`lib/analytics/rollup-dia.ts` y los jobs **no aparecen en el diff**.

La 125 **consume** el contrato y no lo reimplementa: `AnaliticaBackfillService` tiene **una sola**
llamada `this.rollup.agregarFecha(fecha)`, y el guardia lo afirma en positivo, no solo por ausencia
("hay mas de una llamada al agregador en el iterador" exige toBe(1)). El guardia estructural
prohibe ademas que los 4 archivos de la feature nombren `analytics_daily`, consulten la base o
mencionen ninguna de las diez medidas del rollup. Los tres guardias heredados (`rollup-guards`,
`alcance-obligatorio.guardia`, `analytics-daily-guards`) siguen **verdes sin haber sido editados**
(no aparecen en el diff).

## 3. Trazabilidad R1-R35

**34/35 con test nombrado, ejecutado y verde. R34 sin test.**

Verifique que los nombres de la tabla de `progress/impl_125.md` existen de verdad en los cinco
archivos de test (listado de describe/it contrastado uno a uno). No hay test vacio ni test que pase
por ausencia sin contracara: cada guardia estructural trae su autocomprobacion por fixtures (uno
legitimo + dos infractores + ocho reglas discriminadas una a una), y los positivos estan afirmados
(agregarFecha se llama; el plan sale de fecha-cr; el destino sale de env.DATABASE_URL).

## 4. Disciplina de mutacion — 8 aplicadas, 8 muertas

Cada mutacion se aplico al codigo real, se corrio la suite y se revirtio. Ninguna sobrevivio.
P = backfill-rango.test.ts, S = analitica-backfill-service.test.ts, C = backfill-analitica-cli.test.ts.

| # | Mutacion | Test NOMBRADO que se puso rojo | Rojos |
|---|---|---|---|
| M1 | planificador del rango: el bucle pasa de `f <= hasta` a `f < hasta` (pierde el ultimo dia) | P "produce N fechas ascendentes y sin repetidos ... inclusivo en ambos extremos" | 6 |
| M2 | prohibicion del dia en curso: `hasta >= hoy` pasa a `hasta > hoy` | P "rechaza el rango que TERMINA hoy CR..." + C "el dia CR en curso se rechaza aunque la confirmacion sea correcta" | 4 |
| M3 | orden cronologico: el plan devuelve las fechas invertidas | P "cruza fin de mes, fin de ano y bisiesto..." + S "la fecha bajo horizonte se invoca igual que las demas" | 6 |
| M4 | todo-o-nada por fecha: `continue` pasa a `break` (una fecha fallida aborta el rango entero) | S "sigue con las fechas siguientes y las procesa" + los dos casos de R14 | 3 |
| M5 | codigo de salida: `codigoSalida` fijo a 0 pese a fechas fallidas o cambiadas | S "una sola fecha fallida entre cuatro buenas fuerza el codigo distinto de 0" + C "una fecha fallida aparece por su nombre en el resumen y el codigo es 2" | 8 |
| M6 | no-concurrencia por fecha: dos llamadas simultaneas a `agregarFecha(fecha)` | S "nunca hay dos llamadas al agregador en vuelo a la vez" + S "llama exactamente una vez por fecha del plan y en orden" | 8 |
| M7 | PII en el eco: `destinoLegible` devuelve la DATABASE_URL cruda | C "destinoLegible reconstruye host:puerto/base y no devuelve nada de la credencial" + C "ni en el eco, ni en el progreso, ni en el resumen, ni en el reporte, ni en los errores" | 2 |
| M8 | PII en el reporte: cada entrada gana un zonaId uuid | C "el reporte no lleva ni un identificador ni ninguna coordenada del rollup" | 2 |

Los siete contratos que se pidieron mutar quedan cubiertos (M1 planificador, M2 dia en curso, M4
todo-o-nada por fecha, M5 codigo de salida, M3 orden cronologico, M6 no-concurrencia, M7 PII en el
eco). M8 se anadio por cuenta propia sobre el reporte de R19.

## 5. L1 — la ventana ciega, verificada por los dos lados

**El cero NO es un test hueco.** En `tests/integration/db/analytics-daily-backfill.test.ts`:

- "una orden SIN historial anterior al corte no entra en NINGUN cubo, aunque tenga entrega ese dia":
  la orden se siembra con **todo** lo que un dia normal tendria (creacion, mensajero, gestion
  entregada) **menos** una fila de `orden_historial_estado`. Se afirma: fallidas 0, filasEscritas 0,
  `leerFilas(...)` igual a lista vacia, y clasificacion `no_comparable`. **La corrida termina con
  exito**, tal y como declara L1.
- El **gemelo**: "la MISMA orden, con una sola transicion anterior al corte, ya produce filas" -
  filasEscritas mayor que 0 y la tabla con filas. Es lo que convierte el cero anterior en una medida:
  si el arnes no sembrara bien, este tambien saldria a cero.
- Y hay un tercer contrapeso ("un dia sin nada sembrado...") que descarta que la base de desarrollo
  se cuele en la transaccion de test.

Ademas L1 esta confirmada con datos reales en `progress/backfill_125.md`: no hay ni una fila de
`orden_historial_estado` anterior al 2026-07-17 en la base local, y las tres fechas bajo horizonte
dieron 0 filas con codigo de salida 0.

## 6. R34 — arbitraje

**El argumento del implementer SE SOSTIENE, y ademas se queda corto.** Lo verifique leyendo
`tests/unit/analytics/rollup-guards.test.ts` y `lib/config/analitica-rollup.ts`:

- **Pata (b), confirmada.** El caso (a) del guardia (lineas 710-738) aplana la prosa anterior a la
  declaracion y le exige **dos** cosas: que diga "provisional" **y** que diga que NO esta medida.
  R34 pide precisamente que el comentario deje de decir "no medida". Eso es una **asercion**, no un
  allowlist, y **R33 solo autoriza tocar el allowlist `AJENAS_A_R47`**. Es decir: **R34 y R33 son
  mutuamente incompatibles tal y como estan escritos.**
- **Hallazgo que el implementer no menciono y que refuerza su posicion:** hay un **tercer** sitio
  atado a la cifra, `tests/unit/analytics/rollup-service.test.ts` linea 1047, que teclea el literal
  20_000 junto a la constante importada. Cambiar el valor tambien lo pone rojo, y ese archivo
  tampoco esta autorizado por R33.
- **Pata (a), confirmada.** `UMBRAL_AVISO_FILAS_CORRIDA` gobierna un aviso **por corrida de UNA
  fecha** (`AnaliticaRollupService.ts` linea 258: filasEscritas comparado contra el umbral). La
  corrida real midio **pico de 24 filas en una fecha** sobre **58 ordenes** en local. Convertir 24
  en un umbral de produccion exige un multiplicador inventado; D5 lo prohibe ("medir primero, fijar
  el tope despues") y la propia ficha de la 125 en `feature_list.json` se lo repite con esas
  palabras: "fijalos con medicion, no adivinando".

**Recomiendo la salida (ii): partir R34 en ficha propia.** Razones:

- La (i), medir contra produccion y sustituir, **no es ejecutable dentro de esta feature**: D8 y L5
  exigen que un humano exporte a mano la DATABASE_URL de produccion, y ese dato no existe aqui.
  Convertirlo en criterio de cierre deja la 125 bloqueada por algo ajeno a su alcance.
- La (iii), cifra declarada explicitamente extrapolacion, es la peor de las tres: obliga igualmente
  a reescribir aserciones de guardias de la 124 para acomodar un numero que **sigue sin estar
  medido**. Paga el coste de tocar el guardia sin comprar la certeza.
- La ficha nueva debe autorizar **explicitamente** editar (1) el caso (a) de `rollup-guards.test.ts`,
  (2) el allowlist `AJENAS_A_R47` y (3) el literal de `rollup-service.test.ts` linea 1047. Sin esa
  autorizacion nace con la misma contradiccion que hoy tiene la 125.

## 7. CHECKPOINTS.md, punto por punto

| Punto | Estado |
|---|---|
| requirements.md con requisitos EARS numerados | OK, 35 requisitos |
| design.md con alternativa descartada y su porque | OK, seccion 10 "Alternativas descartadas" y otra en la seccion 5 |
| tasks.md con todas las tasks marcadas | **FALLA. T6.1 y T6.2 (R34) no ejecutadas.** El archivo no usa casillas sino criterios "Hecho:"; los de T6 no se cumplen |
| Cada Rn mapea a un test concreto | **FALLA. R34 sin test** (34/35) |
| progress/impl_125.md con el mapa R a test | OK, completo y honesto: declara R34 abierto en vez de disfrazarlo |
| pnpm typecheck sin errores | OK |
| pnpm lint sin errores | OK, 0 errores y 27 warnings, delta 0 |
| pnpm test pasa | OK, 783/783 archivos y 9535/9535 tests |
| E2E si toca flujo critico | N/A justificado: script de operador sin camino de UI; el riesgo lo cubren el modo verificar (R23-R26) y la corrida real medida (R35) |
| RLS en tabla nueva | N/A: cero tablas nuevas y cero migraciones, y el guardia lo censa |
| Migraciones versionadas y reversibles | N/A: no hay migracion |
| Ningun secreto hardcodeado | OK: guardia de URL de conexion mas el caso "ninguna salida contiene el usuario ni la contrasena"; la mutacion M7 confirma que ese test esta vivo |
| Webhooks con firma e idempotencia | N/A: no hay webhook |
| Controller sin queries ni logica de negocio | OK: el CLI solo valida, ecoa, construye dependencias y delega |
| Service sin HTTP | OK: AnaliticaBackfillService no conoce HTTP, console, process ni Prisma |
| Repository solo queries | N/A: la 125 no anade repositorio |
| Interfaces en lib/interfaces/ | OK: lib/interfaces/services/IAnaliticaBackfillService.ts |
| Permisos y Server Actions | N/A: sin superficie, y el guardia R2 lo censa en los dos sentidos |
| Nada de pais, moneda ni cuenta hardcodeado | OK |
| ./init.sh termina en verde | OK, medido sobre arbol limpio |
| progress/review_125.md con veredicto OK | **FALLA: este informe es RECHAZADO** |
| Entrada en progress/history.md | **FALTA** (bookkeeping del leader, menor) |

## 8. Hallazgos

- **BLOQUEANTE - R34 sin test que lo mida.** `UMBRAL_AVISO_FILAS_CORRIDA` sigue valiendo 20000 y
  declarada "provisional y no medida". Con ello **T6.1 y T6.2 de tasks.md quedan sin ejecutar**.
  *Que falta para cumplirlo:* una decision de spec del leader, no codigo. Recomendacion: la salida
  (ii) de la seccion 6, sacar R34 y T6 de la 125 a una ficha propia que autorice explicitamente
  tocar el caso (a) de rollup-guards.test.ts, el allowlist AJENAS_A_R47 y el literal de
  rollup-service.test.ts linea 1047. **No devuelvo trabajo de codigo al implementer:** parar aqui
  fue lo correcto; forzarlo habria significado inventar una cifra y relajar un guardia ajeno, que es
  exactamente lo que este arnes prohibe.

- **menor - R33 y R34 se contradicen dentro de la misma spec.** R34 obliga a algo que R33 prohibe
  (seccion 6). Es un defecto del requirements.md, no de la implementacion; hay que resolverlo al
  mover R34 de ficha.

- **menor - tercer punto de anclaje de la cifra, no documentado.**
  `tests/unit/analytics/rollup-service.test.ts` linea 1047 teclea el literal 20_000. Ni la spec ni
  la bitacora lo nombran, y caduca igual que el allowlist en cuanto el umbral cambie.

- **menor - la ficha de la 125 en feature_list.json sigue desactualizada.** status "in_progress",
  y una description que habla de "toda la data existente" y de "Depende de 123" pese a
  depends_on [123, 124]. La propia spec lo declara y dice que lo corrige el leader; sigue sin
  corregirse.

- **menor - falta la entrada en progress/history.md.** Bookkeeping del leader.

- **menor (observacion, no defecto) - el modo --verificar exige tambien --confirmar.** El runbook
  (backfill_125.md, paso 4) lo refleja, y es coherente con R26 y R28 porque verificar **escribe**.
  Se anota solo para que nadie lo lea manana como un olvido.

## 9. Lo que esta bien y conviene no perder

- El planificador es **puro de verdad**: solo importa `@/lib/utils/fecha-cr`, sin process.env, sin
  console y sin una sola hora de desplazamiento escrita a mano. El "ayer CR" del mensaje de rechazo
  sale de `ultimosNDiasCalendarioCR`, no de restar 24 h.
- El CLI inyecta **todo** el mundo exterior (argv, env, reloj, salida, lectura y escritura de
  archivos, constructor del agregador y pausa). Por eso 36 casos corren sin base, sin disco y sin
  proceso hijo, y casi todos afirman **cero llamadas al agregador**, que es lo unico que demuestra
  que una guarda corta antes de tocar la base.
- El cambio no previsto de quitar el try/catch alrededor de `process.loadEnvFile()` es correcto: un
  .env presente pero ilegible tiene que ser ruidoso, y un catch vacio con un comentario dentro es
  justo lo que el guardia de R31 prohibe.
- La clasificacion de una fecha que el reporte previo no cubre como `cambiada` (y no `estable`)
  cierra un falso verde por la puerta de atras.

## 10. Estado del arbol al terminar

`git status --short` en C:/w125: **sin salida salvo este propio informe. Arbol de codigo limpio.**
Las 8 mutaciones se revirtieron una a una y se comprobo la limpieza despues de cada reversion. No
ejecute ningun comando git destructivo, no toque ningun otro checkout y no edite codigo de la
feature 124.
