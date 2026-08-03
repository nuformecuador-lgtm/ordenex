# 175 — Revision (reviewer)

> Rama `feature/175-analitica-correccion-catalogo`, worktree `C:/w175`, HEAD `c9d6f3da`,
> nacida de `origin/dev` @ `e4bbbe4a`. Revisados los commits `2db9fc1d..c9d6f3da`.
> **Todo lo que sigue lo midio el reviewer sobre disco.** La bitacora del implementer se uso
> como mapa a contrastar, nunca como evidencia. No se movio HEAD.

## Veredicto

**APROBADO-CON-NOTAS.** 0 bloqueantes, 5 menores.

- **14/14 requisitos** con test nombrado, existente y **no vacuo** (verificado matando cada uno).
- **Mutaciones propias: 21 lanzadas, 21 discriminaron, 0 supervivientes** (+1 control no-op verde).
- **«Ninguna cifra cambia»: CONFIRMADO** por lectura del diff de produccion y por censo propio de
  consumidores, no por la bitacora.

## Checklist (CHECKPOINTS.md)

| Punto | Estado |
| --- | --- |
| `specs/175/requirements.md` con EARS numerados R1..R14 | OK |
| `specs/175/design.md` con alternativas descartadas y su porque | OK (seccion 7, cinco alternativas) |
| `specs/175/tasks.md` con todas las tasks marcadas | **Parcial**: T6.4 sin marcar, y es del leader (gate `./init.sh` + aviso a la 131). Correcto que el implementer no la marque |
| Cada `R<n>` mapea a test concreto | OK, verificado uno a uno por mutacion |
| `progress/impl_175-...md` contiene el mapa `R<n> -> test` | OK (seccion 3), y su seccion 7 declara siete desviaciones, incluida la mas discutible |
| `pnpm typecheck` | OK: `tsc --noEmit`, 0 errores, exit 0 |
| `pnpm lint` | OK: 0 errores, 44 warnings, **ninguno en archivos de esta feature** (todos parametros sin usar en tests ajenos). La cifra «27» del encargo era vieja; 44 es lo medido en esta rama |
| Tests | Corridos por el reviewer, ver seccion siguiente |
| Tabla nueva con RLS | N/A: **no hay migracion ni tabla ni columna**; `db/schema.prisma` no aparece en el diff |
| Migraciones versionadas/reversibles | N/A: ninguna |
| Secretos hardcodeados | Ninguno. No se creo `.env` en el worktree |
| Webhooks (firma/idempotencia) | N/A: no hay endpoint |
| Capas separadas | OK: la feature no cruza ninguna frontera. Toca `lib/analytics/metrics.ts` y `lib/analytics/types.ts` (modulo puro) y **solo comentarios** en un `_components/` y en `lib/types/`. Servicio y repositorios sin tocar |
| Permisos / server actions | N/A |
| Sin hardcode de pais, moneda ni cuenta | OK |
| `./init.sh` verde | **Pendiente del leader** (T6.4), por encargo explicito |
| `progress/history.md` con entrada de la 175 | **Falta**: bookkeeping del leader |

## Verificacion ejecutable (corrida por el reviewer)

| Corrida | Resultado |
| --- | --- |
| `vitest run tests/unit/analytics tests/unit/guards tests/integration/db/analytics-daily-guards.test.ts` | **85 archivos / 955 tests, todos verdes** |
| `vitest run tests/unit/services/analitica-operativa-service.test.ts tests/unit/analytics tests/unit/services/analitica-financiera-service.test.ts` | **84 archivos / 941 tests, todos verdes** |
| Barrido dirigido: **todos** los tests que leen ficheros (`readFileSync`/`readdirSync`) y citan `lib/analytics`, `analytics_daily`, `metrics` u `order_status`, o sea la clase de guard de **censo de arbol**, la unica que el grafo de imports NO selecciona y la que mordio dos veces en la seccion 5 de la bitacora | **52 archivos / 678 tests, todos verdes** |
| `pnpm typecheck` | 0 errores |
| `pnpm lint` | 0 errores, 44 warnings, ninguno de la feature |
| `metrics.test.ts` aislado x3 (estabilidad del caso sintetico de R4) | 42/42 verde las tres veces |

No se corrio la suite entera ni `./init.sh`: el gate completo lo corre el leader por encargo.
Ver la seccion del hueco declarado para por que la evidencia basta igualmente en esta feature.

## Trazabilidad R1..R14, verificada por mutacion propia

Cada mutacion se aplico sobre disco por el reviewer, se midio, y se restauro por copia de
respaldo (**nunca** con `git checkout`). Varias no son las que declara el implementer: son formas
distintas de la misma idea, elegidas para buscar supervivientes.

| # | Mutacion propia | Fichero | R | Resultado |
| --- | --- | --- | --- | --- |
| M1 | `incidentes` a "declarada" | `metrics.ts` | R1 | **ROJO** |
| M2 | `sin_gestionar` a "declarada" | `metrics.ts` | R3 | **ROJO** |
| M3 | `entregas` a "declarada" (termino de razon, **no nombrado** por la guardia) | `metrics.ts` | R2 | **ROJO** |
| M4 | borrar `universo` del embudo | `metrics.ts` | R5 | **ROJO** |
| M5 | borrar `derivadaDe` | `metrics.ts` | R9 | **ROJO** |
| M6 | reintroducir «19 values» en la descripcion | `metrics.ts` | R7 | **ROJO** |
| M6b | reintroducir «20 values» (la trampa de «solo actualiza el numero») | `metrics.ts` | R7 | **ROJO** |
| M7 | acotar `estados` del embudo a dos no terminales | `metrics.ts` | R8 | **ROJO** |
| M8 | `sin_gestionar` a clase "live" | `metrics.ts` | R12 | **ROJO** |
| M8b | `sin_gestionar` a fuente tabla_viva sobre la tabla `orden` | `metrics.ts` | R12 | **ROJO**, y cae ademas `operativa-fuente.guardia`, el guard ajeno, sin haber sido tocado |
| M14 | quitar la frase «el rollup NO conserva el archivo historico...» | `metrics.ts` | R6 | **ROJO** |
| M14b | dejar la frase pero **quitar los cuatro ids** de las medidas de flujo | `metrics.ts` | R6 | **ROJO** |
| M15 | «sin gestionar HOY, NO acumuladas» a «sin gestionar acumuladas» | `metrics.ts` | R10 | **ROJO** |
| M9 | anadir la columna `sin_gestionar` al modelo `AnalyticsDaily` | `db/schema.prisma` | R11 | **ROJO** (3 casos) |
| M10 | borrar la linea del filtro en `listarMetricas` | `metrics.ts` | R4 | **ROJO**: cae el caso de particion **y** el sintetico |
| M11 | `metricasDelTablero()` filtra por `estadoProduccion === "producida"` | `catalogo-paneles.ts` | T5.1/R13 | **ROJO** (4 casos) |
| M12 | borrar la cita `progress/decision_175.md` del comentario de `incidentes` | `metrics.ts` | R14 | **ROJO** |
| M13 | `reprogramaciones` a "declarada" **sin registrar decision** | `metrics.ts` | R14 (forma fuerte) | **ROJO** |
| M13b | `cod_recaudado` a "declarada" **sin registrar decision** (dominio financiero) | `metrics.ts` | R14 (forma fuerte) | **ROJO** |
| M16 | lectura de `m.estadoProduccion` dentro de `AnaliticaOperativaService.ts` | servicio | R13 | **ROJO** |
| M16b | aparicion del identificador `universo` en un componente del tablero | `agregacion.ts` | R13 | **ROJO** |

**21 lanzadas, 21 discriminaron, 0 supervivientes.** Se corrio ademas un control no-op para
comprobar que el arnes de mutacion reporta verde cuando no hay cambio: verde.

### Anti-vacuidad, comprobada y no leida

Los dos guards nuevos no pasan por conjunto vacio: `catalogo-produccion` exige mas de 10 columnas
parseadas del esquema, al menos 4 metricas con columna, al menos 1 razon con 4 terminos, al menos
5 entradas de `MEDIDA_DE_METRICA`, mas de 300 archivos censados con presencia de `app/`, `lib/` y
`components/` y ausencia de `node_modules`, y **autocomprueba su propio detector** con seis formas
de lectura; `catalogo-universo` autoverifica el regex de R7 contra 5 positivos y 2 negativos de
prosa legitima y exige que el parseo del modelo `AnalyticsDaily` encuentre columnas reales. Todos
esos asserts se ejecutan de verdad en las corridas verdes de arriba.

## El requisito central: «ninguna cifra cambia». CONFIRMADO

Verificado por el reviewer, no aceptado de la bitacora:

1. **Superficie de produccion: 3 archivos mas un comentario.** El diff `e4bbbe4a..HEAD` sobre
   produccion da `lib/analytics/metrics.ts`, `lib/analytics/types.ts`,
   `app/(app)/analitica/_components/operativo/catalogo-paneles.ts` y
   `lib/types/analitica-operativa.ts`. Leidos linea a linea: en `catalogo-paneles.ts` **todo** el
   cambio vive en comentarios y en un bloque JSDoc (cero lineas de codigo); en
   `analitica-operativa.ts`, solo el JSDoc de `NOTA_SIN_GESTIONAR`. En `types.ts`, dos campos
   **opcionales**. En `metrics.ts`, dos `estadoProduccion`, dos `descripcion` y dos campos nuevos
   dentro de `definicion`.
2. **Nadie en produccion lee los tres campos.** Censo propio de `app/` + `lib/` + `components/`:
   los unicos consumidores del catalogo son `lib/analytics/alcance.ts` (lee `metrica.alcance`),
   `lib/analytics/consulta.ts` (pasa el objeto entero) y, de `definicion`, **solo**
   `IngresosAnaliticaRepository.ts:51` y `RecaudoAnaliticaRepository.ts:58`, que leen
   `definicion.categorias`: campo **no tocado**, y de metricas **financieras**, que esta feature no
   roza. `definicion.estados` de las operativas no se consume en runtime en ningun sitio. Y R13 lo
   fija: mis mutaciones M16 y M16b lo ponen rojo.
3. **Los tests de la 126 y de la 127 no se tocaron.** El diff sobre `tests/` da exactamente 5
   archivos: 2 nuevos de la 175 y 3 modificados, y ninguno es suyo. Corridos **sin modificacion**:
   verdes (`analitica-operativa-service`, `operativa-*`, `analytics-daily-contrato`,
   `analitica-financiera-service`).
4. **No hay migracion ni cambio de esquema.**

**No existe camino por el que estas ediciones muevan un numero servido. Ninguna cifra cambia.**

## R4 y la desviacion mas discutible (seccion 7.5), juzgada

El caso sintetico **extiende temporalmente el array exportado `METRICAS`** (cast que retira el
`readonly`), empuja dos entradas de mentira, y lo restaura en `finally` con `splice`, mas un
assert posterior de que el catalogo quedo como estaba. Juicio: **aceptable; menor, no bloqueante.**

Lo comprobado, no lo leido:

- **Restaura siempre.** El `finally` cubre el fallo de cualquier assert del `try`. Lo verifique de
  hecho: con M10 aplicada el caso muere **dentro** del `try` y el resto del archivo no arrastra
  contaminacion (los otros 41 casos dan su resultado propio).
- **No hay efecto entre casos.** Restauracion sincrona dentro de un test sincrono;
  `metrics.test.ts` aislado 3 veces seguidas: 42/42 verde las tres.
- **Aguanta la ejecucion en paralelo.** El paralelismo de vitest es **por archivo** con aislamiento
  por defecto (`vitest.config.ts` no lo desactiva ni cambia el pool), asi que cada archivo tiene su
  propio registro de modulos y ningun otro fichero ve el array mutado. Dentro del archivo no hay
  `it.concurrent` ni `describe.concurrent`, y la ejecucion concurrente no esta activada.
- **La alternativa descartada tiene motivo suficiente**: cambiar la firma publica de
  `listarMetricas` para inyectar catalogo seria API nueva creada solo para el test.

Deuda que queda (menor 1): durante la ventana de mutacion el indice interno que usa `getMetrica`
queda **desincronizado** del array, y el patron se rompe en silencio el dia que alguien anada
`it.concurrent` a ese archivo o congele el catalogo. Basta una linea de aviso en el propio caso.

## T5.1, el guard de la 131 reexpresado: SIGUE MORDIENDO

Comprobado aplicando la mutacion yo mismo, no leyendo el caso. Introduje en `catalogo-paneles.ts`
el filtro exacto que R21 existe para impedir: `metricasDelTablero()` quedandose solo con los
paneles cuyas metricas esten todas en estado "producida" segun `getMetrica`.

Resultado: **4 casos rojos**, y entre ellos, lo que importa, el caso **reexpresado**
«la lista de paneles no cambia si el catalogo marca TODO declarada». Es decir: el caso nuevo
**mata la mutacion por si mismo**, no se apoya en que otro la mate. Y lo hace **sin afirmar ningun
valor** de `estadoProduccion` del catalogo real: monta el catalogo enmascarado con `vi.doMock`
(todo "declarada") y exige lista identica, con autocomprobacion previa de que el mock se aplico
(si no, el caso seria un adorno).

**Es mas fuerte que el original, no mas debil**: el original moria solo porque afirmaba el valor
concreto, el valor que precisamente D11 corrige, asi que hoy seria un guard imposible de mantener;
el reexpresado mata la mutacion **y** su variante derivada por `listarMetricas`, y ademas la
mutacion cae de rebote por R13. La reexpresion respeta el espiritu de R21.

## R14 y D11: el test verifica de verdad, no la mera existencia del fichero

`progress/decision_175.md` existe, esta **fechado** (2026-08-03), esta cerrado y ratifica Q1 y Q2
con motivo objetivo. El caso de R14 **no** se limita a comprobar que el archivo existe:

1. **Deriva** los pares (metrica, fichero de decision) recorriendo `progress/decision_*.md` y
   buscando lineas que nombren a la vez "declarada" y "producida", sin lista escrita a mano, asi
   que cubre tambien D8 y `egresos` de la 127 (sanidad: al menos 3 cambios y al menos 2 ficheros).
2. Exige que la decision lleve **fecha**.
3. Exige que la **entrada del catalogo cite el fichero** desde su propio comentario.
4. Exige que la **fecha citada en el catalogo sea una de las del fichero**, no una inventada.
5. Exige que el estado que hoy tiene la metrica sea el que la decision ratifico.

Verificado: borrar la cita pone rojo (M12). Y las dos formas fuertes de la mutacion, cambiar un
`estadoProduccion` **sin** decision registrada, tambien mueren (M13 operativa, M13b financiera).
Ver el menor 2 sobre el matiz de **por que** mueren.

## Guards ajenos: INTACTOS, verificado

El diff `e4bbbe4a..HEAD` sobre `tests/integration/db/analytics-daily-guards.test.ts`,
`tests/unit/guards/**`, `tests/unit/analytics/operativa-fuente.guardia.test.ts` y
`tests/unit/analytics/financiera-produccion.guardia.test.ts` devuelve **0 archivos**.

Las dos regresiones propias de la seccion 5 se corrigieron como dice la bitacora: **reescribiendo
el texto propio**, no relajando la regla ajena ni anadiendose a una allowlist.

- El literal `analytics_daily` salio de la `descripcion` de `sin_gestionar` y quedo «el rollup
  diario». `analytics-daily-guards.test.ts` corre **verde y sin editar**.
- El value retirado de `order_status` salio de un comentario del guard nuevo, sin tocar la
  allowlist. `censo-order-status-rename.test.ts` corre **verde y sin editar**.
- Bonus verificado: `operativa-fuente.guardia.test.ts`, que el `requirements.md` proponia editar,
  **no se toco** y **sigue mordiendo**: mi M8b lo pone rojo.

Los 3 archivos de test modificados lo fueron con justificacion:
`definiciones-catalogo.guardia.test.ts` (**solo titulos y cabecera, cero assertions**, verificado
en el diff), `metrics.test.ts` (el caso rojo por diseno, reexpresado sin relajar) y
`tablero-catalogo-paneles.test.ts` (Q4 y D11, reexpresado y mas fuerte).

## Las otras seis desviaciones: ninguna es un requisito incumplido disfrazado

| # | Desviacion | Juicio |
| --- | --- | --- |
| 1 | `catalogo-universo.guardia.test.ts` tiene 15 casos, no 7 | **Justificada y a favor.** Los extra son sanidad anti-vacuidad y **reglas generales** («toda derivada cita un id existente y no encadena», «no tiene columna propia», «comparte clase y fuente con su base») en vez de asserts ad hoc sobre `sin_gestionar`. Cubren la regla, no el sintoma |
| 2 | R11 gano un caso de texto | **Justificada.** Nace de la regresion 1: la nocion «no tiene medida propia en el rollup» quedaba sin guardar por texto tras evitar el literal `analytics_daily`. Cierra un agujero real |
| 3 | R3 se ata al servicio de la 126 parseando `MEDIDA_DE_METRICA` en crudo | **Justificada y mas fuerte** que lo propuesto: ata el estado a su causa en vez de fijar el valor, y no importa el servicio, respetando el modulo puro |
| 4 | R12 vive entero en el fichero nuevo; no se toco `operativa-fuente.guardia.test.ts` | **Justificada y preferible.** El `requirements.md` lo sugeria, `tasks.md T4.3` lo puso en el fichero nuevo y el implementer siguio las tasks. El guard ajeno queda intacto **y sigue mordiendo** (M8b). R12 queda cubierto por partida doble. **No es requisito incumplido** |
| 5 | Caso sintetico que muta `METRICAS` | Ver seccion propia: aceptable, **menor 1** |
| 6 | T5.1 partido en dos casos | **Justificada.** Verificado que el segundo mata la mutacion por si mismo |
| 7 | Commits de T3 y T4 fundidos en `a995aef8`, cuyo mensaje solo nombra T3 | **Menor 4.** Cosmetico y declarado; no reescribir historia fue lo correcto |

## El hueco declarado: sin baseline de la suite en `dev`

El implementer declara que **no** midio el baseline en `origin/dev` (el primer intento corrio sin
`node_modules`) y que su «sin regresion» se apoya en aislado mas grafo de imports. **Declararlo en
vez de fingirlo es lo correcto**, y es justo el fallo que la memoria del repo documenta: un
baseline afirmado sin medir es peor que uno ausente.

**Juicio: la evidencia basta para esta feature concreta.** No es un hueco material aqui, por
motivos especificos y no por indulgencia general:

1. La superficie de produccion son **tres archivos**, uno solo comentarios, y **ninguna linea
   cambia una decision de runtime** (verificado por censo de consumidores). Para que hubiera
   regresion a distancia haria falta un acoplamiento en runtime que el censo de R13 descarta y que
   mis mutaciones M16 y M16b demuestran vigilado.
2. La unica clase de fallo que el grafo de imports **no** ve, el censo de arbol, que es justo la
   que mordio dos veces, la cubri con un **barrido dirigido propio**: todos los tests del repo que
   leen ficheros y citan `lib/analytics`, `analytics_daily`, `metrics` u `order_status`.
   **52 archivos / 678 tests, verdes.** Eso ataca el hueco por donde de verdad duele.
3. Las corridas del implementer no bajan de **884 archivos** en ninguna de las dos pasadas y no
   hubo bloque de errores de workers: la suite arranco entera y no reporta de menos. Sus 2 rojos
   son componentes ajenos (`CuentasPorPagarTable`, `ControlDescargaTransversal`), verdes en aislado
   y fuera del grafo de la feature: el patron conocido de flake por saturacion.

**Condicion**: el gate completo del leader (`./init.sh`) sigue siendo obligatorio antes del PR
(T6.4). Si ahi apareciera un rojo en `lib/analytics/**` o en un guard de censo, se reabre.

## Hallazgos

### BLOQUEANTES

Ninguno.

### Menores

1. **menor — el caso sintetico de R4 muta el array exportado `METRICAS`.** Hoy es seguro
   (restaura en `finally`, aislamiento por archivo, sin `it.concurrent`, verificado 3 veces), pero
   deja el indice interno de `getMetrica` desincronizado durante la ventana y se rompe en silencio
   si alguien anade `it.concurrent` a ese archivo o congela el catalogo. Basta una linea de aviso
   en el propio caso.
2. **menor — R14 solo verifica los cambios que ya tienen fichero de decision.** La guardia deriva
   los pares (metrica, decision) **de `progress/`**: un `estadoProduccion` cambiado **sin ningun**
   fichero de decision no produce par y R14 no lo ve. En la practica muere igual (lo comprobe: M13
   cae por la regla de R3, «la 126 la sirve», y M13b por `financiera-produccion.guardia`), pero esa
   cobertura es **incidental**, de otros guards, no de R14. El requisito se cumple; el matiz merece
   quedar escrito en el caso para que nadie lo de por mas ancho de lo que es.
3. **menor — bookkeeping del leader pendiente**: `tasks.md T6.4` sin marcar (correcto: es suya),
   falta la entrada de la 175 en `progress/history.md`, y `feature_list.json` sigue en
   `in_progress`. CHECKPOINTS lo exige para pasar a `done`.
4. **menor — commits de T3 y T4 fundidos** en `a995aef8`, cuyo mensaje solo nombra T3
   (desviacion 7.7). Cosmetico y declarado.
5. **menor (aviso, no defecto) — coordinacion con la 131 antes de mergear.** Esta feature edita
   `tests/unit/analytics/tablero-catalogo-paneles.test.ts`, fichero de la 131. D11 y Q4 lo
   autorizan expresamente y el reviewer confirma que la reexpresion **respeta y refuerza** R21,
   pero el aviso a esa sesion sigue vigente (T6.4).

## Nota de higiene

Las 21 mutaciones se aplicaron por copia de respaldo y se revirtieron restaurando la copia. No se
ejecuto `git checkout`, `switch`, `reset` ni ningun comando que mueva HEAD. `git status` del
worktree queda vacio salvo este fichero de revision. No se creo `.env`. No se tocaron
`C:/Users/Cristian/Documents/trabajo/arc/ordenex`, `C:/w131` ni `C:/w132`.
