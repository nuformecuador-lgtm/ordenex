# Feature 126 — analítica: servicios operativos · bitácora de implementación

> Rama `feature/126-analitica-operativa-servicios`, worktree `C:/w126`, sobre `33279871`
> (spec + puerta T0 cerrada el 2026-08-02). Backend puro: repositorios, servicio, Server
> Action, una migración de índices y su `down.sql`. Sin UI (la cablea la 131).

---

## 1. Archivos creados y modificados

### Creados (propiedad de la 126, `design.md §1`)

| Archivo | Qué es |
|---|---|
| `lib/types/analitica-operativa.ts` | Contrato de salida: `ResultadoOperativo`, `SerieOperativa`, `PuntoSerie`, `Cobertura`, `PENUMBRA`, `NOTA_SIN_GESTIONAR` |
| `lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts` | `CuboRollup`, `EtiquetaEstatus`, `DIMENSION_AGREGADA` |
| `lib/interfaces/repositories/IAnaliticaOperativaVivaRepository.ts` | `AgingPorEstadoFila`, `EntregaVigenteOperativa`, `CubosDelDiaEnCurso` |
| `lib/interfaces/services/IAnaliticaOperativaService.ts` | Firma canónica + `AnaliticaOperativaError` y `ETAPAS_OPERATIVAS` |
| `lib/repositories/AnaliticaOperativaRollupRepository.ts` | **El único lector de `analytics_daily`** del árbol |
| `lib/repositories/AnaliticaOperativaVivaRepository.ts` | `aging_por_estado` + cubos del día en curso (D6/D13) |
| `lib/services/AnaliticaOperativaService.ts` | Proyección, tasas, ciclo, embudo, cobertura, seudonimización |
| `lib/analytics/oraculo-mensajero.ts` | `sondeaIdentidadDeMensajero` — helper único de R24/R36 |
| `lib/actions/analitica-operativa.ts` | El borde (`'use server'`) |
| `db/migrations/20260803090000_gestion_orden_idx_created_at/{migration,down}.sql` | Índice de la ruta caliente intradía |

### Modificados (terceros, autorizados por `design.md §1`)

| Archivo | Cambio | Autorizado por |
|---|---|---|
| `lib/analytics/alcance-columnas.ts` | **D3**: `whereRollup` tipado `Prisma.AnalyticsDailyWhereInput` y clave `mensajeroAsignadoId` → `mensajeroId` | `design.md §1` y `§D3` |
| `db/schema.prisma` | `@@index([createdAt], map: "gestion_orden_created_at_idx")` en `GestionOrden` | R25 |
| `tests/unit/analytics/alcance-adaptadores.test.ts` | Barrido acotado + aserción positiva de `whereRollup` (ver §5) | D3 |
| `tests/integration/db/analytics-daily-guards.test.ts` | Re-alcance de R42 (R27) | `design.md §D11` |
| `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` | Censo del **forjador** (R28) | `design.md §D11` |
| `tests/unit/analytics/alcance-bordes.guardia.test.ts` | Censo de bordes **reales** (R29) | `design.md §D11` |
| `tests/unit/analytics/backfill-guards.test.ts` | **NO estaba previsto en el spec** — ver §6, punto 1 | — |

### Tests creados

`tests/unit/analytics/_fake-operativa.ts` (dobles compartidos, no es suite) y:
`analitica-operativa-action.test.ts`, `analitica-operativa-service.test.ts`,
`operativa-aislamiento.test.ts`, `operativa-cobertura.test.ts`,
`operativa-contrato-catalogo.test.ts`, `operativa-contrato-salida.test.ts`,
`operativa-embudo.test.ts`, `operativa-errores.test.ts`,
`operativa-estatus-huerfano.test.ts`, `operativa-frontera.guardia.test.ts`,
`operativa-frontera-127.guardia.test.ts`, `operativa-fuente.guardia.test.ts`,
`operativa-intradia.test.ts`, `operativa-motivos-devolucion.test.ts`,
`operativa-oraculo.test.ts`, `operativa-seudonimizacion.test.ts`,
`operativa-sin-asignar.test.ts`, `operativa-sin-gestionar.test.ts`,
`operativa-solo-lectura.guardia.test.ts`, `operativa-sumabilidad.guardia.test.ts`,
`operativa-tasas.test.ts`, `operativa-tiempo-ciclo.test.ts`;
`tests/integration/db/analitica-operativa-indices.test.ts` y
`tests/integration/db/analitica-operativa-equivalencia.test.ts`.

---

## 2. Mapa `R1..R36 → test nombrado`

| R | Test NOMBRADO |
|---|---|
| R1 | `operativa-frontera.guardia.test.ts` > «ninguna ruta de app/api consulta analitica operativa» |
| R2 | `operativa-solo-lectura.guardia.test.ts` > «ningun modulo de la 126 muta el rollup ni el dominio» |
| R3 | `operativa-frontera-127.guardia.test.ts` > «el diff de la 126 no toca archivos de la 127» · `operativa-frontera.guardia.test.ts` > «no existe `lib/actions/analitica.ts`…» |
| R4 | `alcance-obligatorio.guardia.test.ts` > «ningun archivo de lib/{repositories,services,actions} consulta analitica sin el tipo opaco» (+ typecheck: cambiar la firma no compila) |
| R5 | `analitica-operativa-action.test.ts` > «un denegado deja rastro en el logger antes de responder 403» |
| R6 | `analitica-operativa-action.test.ts` > «una entrada invalida no toca la base ni una vez» |
| R7 | `operativa-seudonimizacion.test.ts` > «ningun uuid de mensajero sobrevive a JSON.stringify de la respuesta» |
| R8 | `operativa-sin-asignar.test.ts` > «el cubo sin asignar sobrevive a la proyeccion y a la seudonimizacion» |
| R9 | `operativa-contrato-catalogo.test.ts` > «la unidad de conteo de cada serie sale del catalogo» |
| R10 | `operativa-tasas.test.ts` > «la tasa de entrega divide entre gestiones, no entre ordenes» y > «denominador cero devuelve null» |
| R11 | `operativa-sumabilidad.guardia.test.ts` > «ninguna composicion del servicio suma metricas no sumables» |
| R12 | `operativa-embudo.test.ts` > «el embudo de un rango de tres dias devuelve tres puntos, no uno sumado» + tripwire R43 en `analytics-daily-guards.test.ts` |
| R13 | `operativa-estatus-huerfano.test.ts` > «un estatus fuera del seed no rompe el embudo y conserva su etiqueta» |
| R14 | `operativa-tiempo-ciclo.test.ts` > «el promedio de ciclo suma numerador y denominador antes de dividir» y > «la respuesta no contiene BigInt» |
| R15 | `operativa-motivos-devolucion.test.ts` > «las devoluciones sin causa tipificada aparecen en su propio cubo» |
| R16 | `operativa-fuente.guardia.test.ts` > «una metrica snapshot con rango cerrado no toca las tablas vivas» |
| R17 | `operativa-fuente.guardia.test.ts` > «la unica metrica live no lee el rollup» |
| R18 | `operativa-intradia.test.ts` > «el punto del dia en curso viene marcado como parcial y con su instante de corte» |
| R19 | `operativa-cobertura.test.ts` > «un rango que cruza el horizonte del historial declara sus fechas no comparables» y > «el horizonte se importa de la 125 y no se reescribe» |
| R20 | `operativa-cobertura.test.ts` > «el sistema no inventa filas para la penumbra» |
| R21 | `alcance-adaptadores.test.ts` > «whereRollup nombra la columna del rollup, no la de orden» (+ typecheck) |
| R22 | `operativa-aislamiento.test.ts` > «un mensajero no ve el cubo sin asignar» |
| R23 | `operativa-aislamiento.test.ts` > «la zona del recorte es la de la orden, no la del mensajero que la gestiono» |
| R24 | `operativa-oraculo.test.ts` > «un adminTienda no puede sondear por mensajero_id» y > «un adminTienda sigue viendo la desagregacion seudonima por mensajero» |
| R25 | `analitica-operativa-indices.test.ts` > «la consulta intradia de gestiones usa indice», > «`down.sql` existe y revierte EXACTAMENTE lo que hace el up» y > «el indice esta DECLARADO en `db/schema.prisma`…» |
| R26 | `analitica-operativa-service.test.ts` > «un tablero de cinco metricas hace una sola consulta al rollup» |
| R27 | `analytics-daily-guards.test.ts` > «un solo archivo puede LEER la tabla: el lector declarado de la 126» |
| R28 | `alcance-obligatorio.guardia.test.ts` > «ningun archivo de lib/{repositories,services,actions} consulta analitica sin el tipo opaco» — **es el que muere** ante un forjador real en el arbol. «un cast a ConsultaAnalitica no cuenta como recibirla» es su autocomprobacion sobre fixture sintetico y NO muere con una mutacion del arbol: no sirve de ancla |
| R29 | `alcance-bordes.guardia.test.ts` > «todo borde real de analitica audita antes de responder 403» |
| R30 | `operativa-contrato-salida.test.ts` > «la respuesta es JSON-serializable sin excepciones» |
| R31 | `analitica-operativa-service.test.ts` > «dos llamadas con el mismo reloj inyectado dan el mismo resultado» y `operativa-solo-lectura.guardia.test.ts` > «el servicio no construye fechas por su cuenta» |
| R32 | `operativa-errores.test.ts` > «el error nombra la etapa y la metrica y no filtra identificadores» |
| R33 | `analitica-operativa-equivalencia.test.ts` > «el intradia de una fecha cerrada reproduce exactamente las filas del rollup» |
| R34 | `operativa-contrato-salida.test.ts` > «el TIPO la declara sin `?`: declararla opcional deja de compilar el fixture» — **es el que muere**. «cobertura es obligatoria en toda respuesta ok» sigue VERDE con `cobertura?: Cobertura` (asercion de runtime: el campo se sigue emitiendo), asi que no sirve de ancla |
| R35 | `operativa-sin-gestionar.test.ts` > «sin_gestionar se deriva del embudo y no se suma entre fechas» y > «la serie declara la semantica HOY (universo B2)» |
| R36 | `operativa-oraculo.test.ts` > «el predicado del oraculo se exporta una sola vez» |

> **Sobre R28 y R34 — anclaje verificado, no supuesto.** El reviewer detectó que estas dos filas
> nombraban un caso que **no muere**. Comprobado ejecutando la mutación y leyendo qué caso cae:
> con `cobertura?: Cobertura` cae «el TIPO la declara sin `?`…», y con un
> `as unknown as ConsultaAnalitica` en el repositorio cae «ningun archivo de
> lib/{repositories,services,actions} consulta analitica sin el tipo opaco» (bajo el `describe`
> «R18 · censo real sobre repositorios, servicios y acciones»). Las filas apuntan ya a esos.
> Un mapa que apunta a un caso que no muere es **cobertura aparente**: es el patrón de anclaje
> silencioso que costó caro en la 125.

---

## 3. D3 — corrección de `whereRollup`, con la precisión que corresponde

**Qué era.** `lib/analytics/alcance-columnas.ts` devolvía `{ mensajeroAsignadoId }` para recortar
`analytics_daily`, cuya columna se llama `mensajeroId` (`db/schema.prisma`, índice
`analytics_daily_mensajero_fecha_idx`). El retorno estaba tipado `Record<string, string>`, así que
el compilador no podía verlo. Cuando la 122 escribió la función, la tabla **no existía**.

**No era un bug vivo: era LATENTE.** No hay ningún consumidor de `whereRollup` en producción
todavía — la 126 es el primero. Ninguna consulta se ejecutó nunca con la clave equivocada.

**No es un hallazgo nuevo del todo.** `progress/impl_124.md:689` ya lo recoge como «veredicto sobre
`whereRollup` (CONFIRMADO, no tocado)». La 124 lo vio y decidió no arreglarlo.

**Lo que aporta D3** es que, con el tipo real (`Prisma.AnalyticsDailyWhereInput`), la clave
equivocada **deja de compilar**: la corrección ya no depende de que nadie la revierta. Corregirlo
«por dentro» dejando el tipo laxo habría arreglado el síntoma y dejado intacto el mecanismo que lo
produjo (alternativa 5 descartada en `design.md §7`).

---

## 4. Las tres divergencias del catálogo heredadas por la **ficha 175**

T0-Q3 = (C): la 126 **no toca** `lib/analytics/metrics.ts` (R3). Quedan vivas mientras tanto:

1. **`lib/analytics/metrics.ts:220` — `incidentes` declara `estadoProduccion: "declarada"`** pero
   **sí** tiene columna en el rollup (`db/schema.prisma`, `AnalyticsDaily.incidentes`) y la 126 está
   **obligada** a leerla: es el cuarto término de `DENOMINADOR_GESTIONES` de las tres tasas.
   **Riesgo transitorio dimensionado:** la **133** decide qué paneles pinta con `estadoProduccion`;
   hasta que aterrice la 175 puede **ocultar el panel de `incidentes`** creyéndolo sin productor,
   cuando la 126 lo sirve con datos reales. No es cosmético: es un KPI que desaparece del tablero
   sin que nada falle.
2. **`lib/analytics/metrics.ts:115-128` — `ordenes_por_estado` declara
   `definicion.estados = ORDER_STATUS_SEED`** (19 valores, terminales incluidos) mientras la columna
   real contiene el **universo B2** de la 124
   (`specs/124-analitica-job-agregacion-diaria/design.md §4.3`). La 126 es quien la sirve a la UI, así
   que la divergencia se vuelve **visible al usuario final** aquí.
3. **`lib/analytics/metrics.ts:232-247` — `sin_gestionar` no tiene columna en el rollup**
   (`db/schema.prisma`: las 10 medidas de `AnalyticsDaily` no la incluyen) y la 126 la deriva del
   embudo con semántica «HOY» (D14/R35). El catálogo no lo dice; debería. Su `estadoProduccion`
   también queda desactualizado: la 126 la sirve.

---

## 5. Decisiones propias tomadas durante la implementación

> **Cinco de estas decisiones son DESVIACIONES respecto de `design.md`**, y conviene tenerlas
> juntas porque son lo que un reviewer necesita contrastar contra el spec aprobado:
>
> | # | Desviación | Respecto de | Nota en el código |
> |---|---|---|---|
> | 3 | `EtiquetaEstatus.label` = el `value` de la tabla | `design.md §5.1` | `IAnaliticaOperativaRollupRepository.ts:81` |
> | 4 | `cubosDelDiaEnCurso` recibe la `VentanaDia`, no sólo `corteAt` | `design.md §5.1` | `IAnaliticaOperativaVivaRepository.ts:79` |
> | 5 | La seudonimización vive en el servicio, no en el borde | `design.md §5.3` | `AnaliticaOperativaService.ts:474` |
> | 5.bis | `cubosDelDiaEnCurso` devuelve un objeto, no `CuboRollup[]` | `design.md §5.1` | `IAnaliticaOperativaVivaRepository.ts:48-68` |
> | 5.ter | `agingPorEstado` recibe además `corteAt` | `design.md §5.1` | **sin nota en el código** |
>
> Las 5.bis y 5.ter faltaban en la primera versión de esta bitácora: estaban declaradas en el
> código (salvo la nota de la 5.ter) pero no en la lista, que decía tres. Las señaló el reviewer.

1. **El guardia de `alcance-adaptadores` se ACOTA, no se relaja.** El caso «ningún fragmento de
   ninguna tabla nombra `mensajeroId` fuera de la relación orden» barría los tres adaptadores, pero
   su `describe` protege `gestion_orden`. Su intención real es impedir recortar `gestion_orden` por
   su `mensajero_id` propio; barría `whereRollup` de paso, codificando la creencia —hoy falsa— de que
   ninguna tabla tiene columna propia con ese nombre. **`analytics_daily` sí la tiene**
   (`db/schema.prisma`, `mensajero_id`). El barrido se acota a las dos tablas de dominio con la
   **misma exigencia de antes**, la excepción queda escrita en el propio test con su ruta y su
   columna, y `whereRollup` gana la contrapartida positiva (debe nombrar `mensajeroId`, nunca
   `mensajeroAsignadoId`, en los cuatro alcances).
2. **`DIMENSION_AGREGADA`** — coordenada que no estaba en el grano pedido. No se reutiliza `null`
   porque en `mensajeroId` el `null` ya significa «sin asignar» (R8) y fundir los dos hechos haría
   indistinguibles el cubo sin asignar y el cubo agregado.
3. **`EtiquetaEstatus.label` = el `value` de la tabla.** `design.md §5.1` dibujaba `{ value; label }`
   como si las dos columnas existieran: verificado, `order_status` tiene `id` y `value` y nada más
   (`db/schema.prisma:377-394`), y no hay mapa de etiquetas en `lib/`. La «etiqueta que le da la
   tabla» (R13) **es** su `value`. `label` se conserva en el contrato para que la 131 tenga dónde
   enchufar una traducción sin cambiar la firma.
4. **`cubosDelDiaEnCurso` recibe la `VentanaDia` completa, no sólo `corteAt`.** R33 lo hace
   inevitable: para una fecha ya cerrada el corte es exactamente la medianoche CR del día siguiente,
   así que derivar `desde` con `fechaCalendarioCR(corteAt)` daría el día equivocado y la equivalencia
   se probaría sobre otro día.
5. **La seudonimización vive en el SERVICIO, no en la Server Action** (`design.md §5.3` la ponía en
   el paso 4 del borde; el motivo está en `lib/services/AnaliticaOperativaService.ts:474`). Es
   estrictamente más fuerte: el id real no cruza la frontera servicio→borde, así que ningún borde
   futuro (la 134) puede olvidarla.
5.bis **`cubosDelDiaEnCurso` devuelve un OBJETO `CubosDelDiaEnCurso`, no `CuboRollup[]`**
   (`design.md §5.1` dibujaba `Promise<CuboRollup[]>`; motivo en
   `lib/interfaces/repositories/IAnaliticaOperativaVivaRepository.ts:48-68`). El repositorio no
   puede resolver `primer_intento_ok` sin reimplementar el criterio de «intento», que es el punto
   ÚNICO de la feature 160 y que la 124 también resuelve en su SERVICIO y no en su repositorio.
   Copiarlo aquí sería una TERCERA implementación de una definición, justo lo que D13 se
   compromete a contener. Por eso devuelve los cubos con `primerIntentoOk: 0` **más** las entregas
   vigentes, y el servicio las cruza.
5.ter **`agingPorEstado` recibe `(consulta, corteAt)` y no sólo `(consulta)`**
   (`design.md §5.1` dibujaba `agingPorEstado(consulta)`;
   `lib/interfaces/repositories/IAnaliticaOperativaVivaRepository.ts:73`). El aging mide segundos
   **hasta un instante**, y ese instante tiene que ser el reloj INYECTADO: si el repositorio lo
   tomara por su cuenta con `new Date()`, R31 dejaría de sostenerse (dos llamadas con el mismo
   `now` darían resultados distintos) y el guardia de determinismo no lo vería, porque sólo vigila
   el servicio. **Ésta es la única de las cinco que NO lleva su nota en el código**: las otras
   cuatro sí. Queda anotada aquí y es candidata a un docblock de una línea en ese archivo.
6. **Las 10 medidas del `groupBy` viven en una constante, no en un `_sum: { … }` inline.** El
   tripwire R43 marca `ordenes_estado_stock` dentro de una expresión de agregación con marcas de
   rango cerca. La garantía real es estructural y más fuerte que su heurística: **`fecha` va siempre
   en el `by`**, así que cada fila es de UNA fecha y la columna nunca se suma entre fechas. Quien
   verifica R12 de verdad es `operativa-embudo.test.ts`, con su mutación.
7. **El `where` del rollup se compone con `AND`, no con spread.** Con spread, dos piezas que nombren
   la misma columna se pisan y el recorte del alcance podría quedar sustituido por el filtro del
   cliente. Hoy sería inocuo porque la 122 ya los intersecó, pero apoyarse en eso es apoyarse en una
   feature ajena para sostener la frontera multi-tenant.
8. **El guardia de frontera con la 127 mide el diff contra el commit del spec (`33279871`), no contra
   `dev`.** Medido en este worktree: la ref local `dev` está a decenas de merges de distancia y
   `git diff $(merge-base HEAD dev)...HEAD` devuelve cientos de archivos de otras features ya
   mergeadas —`lib/analytics/metrics.ts` entre ellos, que lo escribió la 135—, con lo que el guardia
   acusaría a la 126 de tocar un archivo que no ha tocado.
9. **El value retirado de `order_status` no se escribe en ningún archivo nuevo.** El censo de la 153
   (`tests/unit/guards/censo-order-status-rename.test.ts`) lo prohíbe fuera de su allowlist y su
   propio comentario descarta esquivarlo por concatenación. Los comentarios lo describen sin
   nombrarlo y el test de R13 usa un value sintético que **afirma** no estar en `ORDER_STATUS_SEED`.
   (El primer intento sí lo escribió y el censo lo cazó: se cambió el código, no el guardia.)

10. **`completarPrimerIntentoEnCubos` concatena las coordenadas SIN separador — asunción de
    longitud fija, declarada y NO implícita.** `lib/services/AnaliticaOperativaService.ts:567` y
    `:574` construyen la clave con `[zonaId, tiendaId, mensajeroId, estatusId].join("")`, mientras
    que `agregarAlGrano` (`:514-515`) sí usa el separador ``. La asimetría es real y la
    señaló el reviewer como teórica.
    **Lo que la sostiene hoy:** en producción las cuatro coordenadas son uuids de longitud fija
    (36 caracteres), así que la concatenación es inambigua y ningún test la rompe.
    **Lo que NO la sostiene:** los propios fixtures de esta feature usan ids cortos y de longitud
    variable (`"z1"`, `"t1"`, `"m1"`, `"e-entregada"` en `_fake-operativa.ts:63-66`), de modo que
    una colisión —`z1`+`t1m`+`1` frente a `z1t`+`1`+`m1`— es **construible en un test**, aunque
    hoy ninguno la construya. O sea: la asunción es cierta en producción y frágil como contrato.
    **Por qué no se corrige en este commit:** esta ronda está acotada por el coordinador a la
    bitácora. La corrección es de una línea (usar el mismo `` en las dos, que además
    alinea las dos funciones) **más un test que fabrique la colisión con ids cortos** y muera sin
    el separador. Queda ofrecida para antes del merge o como ficha de seguimiento; lo que no
    queda es implícita.

### T13.1 — retirada del guardia branch-scoped, decidida en este PR

`operativa-frontera-127.guardia.test.ts` **se retira en el merge de la 126**. Al mergear pasaría a
juzgar toda rama posterior, y la primera feature que legítimamente toque `lib/analytics/metrics.ts`
—empezando por la **ficha 175**, que existe justo para eso— se lo encontraría rojo sin haber hecho
nada malo. Lo que **no** se retira es la parte que no depende del diff (que no exista
`lib/actions/analitica.ts`): esa es permanente y vive en `operativa-frontera.guardia.test.ts`.

### Aviso dirigido a la **131** y la **133** (D9/R34, repetido aquí por T8.3)

El bloque `cobertura` y el marcador `parcial: true` **se pintan**. La distinción entre «cero» y «no
se sabe» sólo existe cuando llega al píxel: si el tablero muestra los ceros del rollup sin la nota de
cobertura, un rango que cruza el 2026-07-13 se lee como una caída de la operación que nunca ocurrió.
Mismo trato para el día en curso, que debe distinguirse visualmente de un día cerrado. Además, las
etiquetas `Mensajero 1..N` **no son estables entre consultas** (por diseño, para impedir la
correlación): la UI no debe prometerlo.

---

## 6. Puntos en que me aparté de lo previsto (para revisión humana)

1. **`tests/unit/analytics/backfill-guards.test.ts` (feature 125) — tocado, y no estaba previsto.**
   Su caso «el censo cubre todo lo que importa los módulos de la 125» marcaba como infractor a
   cualquier archivo fuera de `ARCHIVOS_125` que importara `@/lib/analytics/backfill-rango`.
   **R19 de la 126 OBLIGA a importar precisamente eso** (`esNoComparable` /
   `HORIZONTE_HISTORIAL_CR`) y su mutación (b) prohíbe declarar una segunda constante de horizonte:
   no había forma de satisfacer R19 sin que ese guardia se pusiera rojo, y añadir el servicio de la
   126 a `ARCHIVOS_125` lo habría sometido a las reglas estructurales de la 125 (que prohíben nombrar
   las medidas del rollup). Se añadió una lista `CONSUMIDORES_EXTERNOS` con **una** entrada, más dos
   casos nuevos que la sostienen: uno prohíbe que un consumidor externo importe el **servicio** o el
   **script** del backfill (sólo el planificador puro), y otro exige que la entrada exista y siga
   importando la 125. **`design.md §1` no listaba este archivo entre los de terceros que la 126
   toca.**

2. **Ninguna otra desviación sobre la 122/124/125.** De la 122 se tocaron sólo D3 y los tres guardias
   que `design.md §1` autoriza. De la 124, sólo `analytics-daily-guards.test.ts` (R27). Código de
   producción de la 124 y de la 125: **cero cambios**.

---

## 7. Riesgo de `design.md §8` — estado

**T7 (índices) NO se cayó del alcance**: la migración existe, está aplicada, declarada en
`db/schema.prisma` y verificada con `EXPLAIN`. El intradía sigue siendo viable y **no hace falta
volver al humano** por este punto.

---

## 8. Mutaciones aplicadas y muertas

**40 mutaciones aplicadas, 40 muertas.** Cada una se aplicó sobre el árbol, se corrió el test
NOMBRADO que el spec designa, se comprobó el rojo y se revirtió. Guion en el scratchpad de la
sesión (`mut126.py` / `mut126b.py`); resultados:

| R | Mutación aplicada | Test que murió |
|---|---|---|
| R1 | `app/api/__mut126/route.ts` importa `AnaliticaOperativaService` | `operativa-frontera.guardia.test.ts` |
| R2 | `analyticsDaily.upsert(...)` en el repositorio lector | `operativa-solo-lectura.guardia.test.ts` |
| R3 | tocar una línea de `lib/analytics/metrics.ts` | `operativa-frontera-127.guardia.test.ts` |
| R4 | firma del repositorio a `(filtro, alcance, granos)` | **typecheck** |
| R5 | borrar `logger.logError(describirDenegado(...))` | `analitica-operativa-action.test.ts` |
| R6 | consultar el servicio antes de mirar el `validation_error` | `analitica-operativa-action.test.ts` |
| R7 | no seudonimizar la dimensión mensajero | `operativa-seudonimizacion.test.ts` |
| R8 | filtrar las filas con `mensajeroId === null` al proyectar | `operativa-sin-asignar.test.ts` |
| R9 | `unidadDeConteo: "orden"` a mano en `entregas` | `operativa-contrato-catalogo.test.ts` |
| R10 | dividir entre `ordenesCreadas` | `operativa-tasas.test.ts` |
| R11 | serie «total gestionado» = `entregas + ordenesCreadas` | `operativa-sumabilidad.guardia.test.ts` |
| R12 | quitar la fecha de la clave de agrupación (sumar el rango) | `operativa-embudo.test.ts` |
| R13 | `throw` ante un estatus sin etiqueta | `operativa-estatus-huerfano.test.ts` |
| R14a | denominador 0 devuelve `0` en vez de `null` | `operativa-tiempo-ciclo.test.ts` |
| R14b | devolver `segCicloAcum` (BigInt) tal cual | `operativa-tiempo-ciclo.test.ts` |
| R15 | descartar el cubo `causaDevolucion === null` | `operativa-motivos-devolucion.test.ts` |
| R16 | servir `entregas` por el camino vivo | `operativa-fuente.guardia.test.ts` |
| R17 | servir `aging_por_estado` desde el rollup | `operativa-fuente.guardia.test.ts` |
| R18 | el punto del día en curso sin `parcial`/`corteAt` | `operativa-intradia.test.ts` |
| R19a | devolver los ceros sin fechas no comparables | `operativa-cobertura.test.ts` |
| R19b | escribir `"2026-07-13"` como literal propio | `operativa-cobertura.test.ts` |
| R20 | sustituir la constante de penumbra por un «ajuste estimado» | `operativa-cobertura.test.ts` |
| R21 | revertir la clave a `mensajeroAsignadoId` | `alcance-adaptadores.test.ts` (y no compila sin el cast) |
| R22 | `OR mensajeroId IS NULL` en el recorte | `operativa-aislamiento.test.ts` |
| R23 | recortar por `mensajero.zonaId` (zona del usuario) | `operativa-aislamiento.test.ts` |
| R24a | aceptar el filtro `mensajero_id` y devolver el conteo | `operativa-oraculo.test.ts` |
| R24b | responder `forbidden` **y** retirar la desagregación seudónima | `operativa-oraculo.test.ts` |
| R25 | borrar el `@@index` de `db/schema.prisma` | `analitica-operativa-indices.test.ts` |
| R26 | dos llamadas al repositorio por consulta | `analitica-operativa-service.test.ts` |
| R27 | `analyticsDaily.findMany` en el servicio | `analytics-daily-guards.test.ts` |
| R28 | `{ filtro, alcance } as unknown as ConsultaAnalitica` en el repositorio | `alcance-obligatorio.guardia.test.ts` > «ningun archivo de lib/{repositories,services,actions} consulta analitica sin el tipo opaco» |
| R29 | quitar el logger de la Server Action | `alcance-bordes.guardia.test.ts` |
| R30 | devolver `segCicloAcum` desde Prisma en el valor del punto | `operativa-contrato-salida.test.ts` |
| R31 | `new Date()` dentro del servicio | `operativa-solo-lectura.guardia.test.ts` |
| R32 | incluir el mensaje del error crudo (con ids y teléfono) | `operativa-errores.test.ts` |
| R33 | quitar `anulada_at IS NULL` de las gestiones del intradía | `analitica-operativa-equivalencia.test.ts` |
| R34 | declarar `cobertura?: Cobertura` | `operativa-contrato-salida.test.ts` > «el TIPO la declara sin `?`…» |
| R35a | borrar la declaración de semántica de la respuesta | `operativa-sin-gestionar.test.ts` |
| R35b | servirla sin filtrar por el estatus (suma del embudo) | `operativa-sin-gestionar.test.ts` |
| R36 | copiar el predicado dentro de la Server Action | `operativa-oraculo.test.ts` |

**Dos hallazgos de la campaña**, los dos corregidos:

- **R3 sobrevivió en el primer intento.** El guardia usaba `git diff <base>...HEAD`, que compara
  COMMIT contra COMMIT e ignora el árbol de trabajo: un archivo de la 127 editado y aún sin
  commitear pasaba invisible, justo en el momento en que el aviso sería más útil. Se cambió a
  `git diff <base>` y la mutación muere.
- **R36 «sobrevivió»** en el primer intento por un fallo del guion de mutación (reemplazo
  idéntico), no del test. Reaplicada de verdad —copiar el predicado dentro de la acción—, muere.

Además, **dos bugs propios los cazaron sus tests durante el desarrollo**, no la campaña:
los días cerrados del rollup viajaban marcados `parcial: true` (`operativa-intradia.test.ts`), y
el `where` del rollup se componía por spread, de modo que el filtro del cliente podía **pisar** el
recorte del alcance (`operativa-aislamiento.test.ts`).

---

## 9. Verificación

### Baseline

**Medido por mí en esta rama el 2026-08-03**, no heredado. Aviso honesto: la corrida de baseline
arrancó cuando ya estaban en el árbol los contratos y la corrección D3 (primer commit), así que
**no es un baseline limpio de `33279871`**; se declara tal cual.

- `pnpm test` → **802 archivos, 10018 tests, 6 archivos / 7 tests en rojo**, más **2 «unhandled
  errors»** de workers que no arrancaron (`MisAsignacionesModule.test.tsx`,
  `CierresAdminModule.test.tsx`) — corrida DEGRADADA, en el sentido de la memoria del proyecto.
- Uno de esos 7 rojos era **mío y real**: `censo-order-status-rename.test.ts` marcó mis dos
  archivos nuevos por escribir el value retirado de `order_status`. Se corrigió **mi código**,
  no el guardia.

### Final (2026-08-03, sobre `cdf29898`)

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: limpio)

$ pnpm lint
✖ 27 problems (0 errors, 27 warnings)

$ pnpm test
 Test Files  828 passed (828)
      Tests  10281 passed (10281)
   Duration  272.05s
```

### Delta

| | Baseline (degradada) | Final |
|---|---|---|
| Archivos | 802 | **828** |
| Tests | 10018 | **10281** |
| Rojos | 6 archivos / 7 tests | **0** |
| «Unhandled errors» de workers | 2 | **0** |

Lectura honesta del delta, siguiendo el aviso del proyecto de **comparar ARCHIVOS y no tests**:
la corrida final tiene **26 archivos más** que la de baseline. Veinticuatro son los de esta
feature; los dos restantes son precisamente `MisAsignacionesModule.test.tsx` y
`CierresAdminModule.test.tsx`, cuyos workers **no arrancaron** en la corrida de baseline y sí en
la final. Es decir: la baseline estaba **degradada** y reportaba de menos, y los 7 rojos que
mostraba eran (a) uno mío y real, corregido cambiando mi código —el censo de la 153—, y (b) el
resto, saturación que no reproduce. **Delta de rojos: 0.**

`pnpm lint`: 27 warnings, 0 errores. **Ninguno de los 27 está en un archivo de la 126**
(comprobado filtrando por `analitica-operativa`, `operativa-`, `_fake-operativa` y `oraculo`:
cero coincidencias). Todos son `no-unused-vars` preexistentes en tests ajenos.

```
$ ./init.sh
✓ typecheck paso
✓ lint paso
 Test Files  828 passed (828)
      Tests  10281 passed (10281)
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

### T7.2 — el `down.sql`, y cómo el hueco acabó cerrándose por accidente

**Estado final: la reversibilidad SÍ está demostrada por ejecución.** Lo cuento entero porque el
cómo importa.

**Primero fue un hueco de verdad.** El `down.sql` estaba verificado **por texto** (contiene
`DROP INDEX IF EXISTS "gestion_orden_created_at_idx"`) y **por unicidad de sentencia** (el test
cuenta las sentencias del `up` y del `down`: una cada uno), pero `pnpm run db:rollback` **no se
había ejecutado**, porque el script revierte *la última migración del directorio* y además borra
su registro de `_prisma_migrations`, y el historial local está desalineado con el remoto
(`prisma migrate status` reporta una migración aplicada que no está en disco y otra en disco sin
aplicar). `docs/verification.md` pide revertir en un entorno de prueba, y eso no se había hecho.

**Cómo se ejecutó.** Al escribir el mensaje del commit de estas correcciones, los acentos graves
del texto —`` `pnpm run db:rollback` `` citado en prosa— fueron interpretados por el shell como
**sustitución de comando** y el script **se ejecutó de verdad** contra la base de desarrollo.
Fue un accidente mío, no una verificación planificada.

**Qué hizo, comprobado después:** completó con éxito
(`Rollback completado: 20260803090000_gestion_orden_idx_created_at`), dejó
`gestion_orden` **sin** `gestion_orden_created_at_idx` y **con sus otros seis índices intactos**,
y borró la fila correspondiente de `_prisma_migrations`. Es decir: el `down.sql` revierte
**exactamente** lo que crea el `up`, ni una estructura más — que es justo lo que el contrato del
repo le pide y lo que la verificación por texto sólo podía suponer.

**Cómo quedó el entorno:** restaurado. Se reaplicó `migration.sql` con `prisma db execute` y se
devolvió el registro con `prisma migrate resolve --applied`. Verificado: el índice existe otra
vez, la fila de `_prisma_migrations` está marcada como aplicada, y
`analitica-operativa-indices.test.ts` vuelve a pasar sus 6 casos.

**Lo que sigue sin estar demostrado**, para no vender de más: la ejecución fue contra la base de
**desarrollo local**, no contra un entorno de prueba limpio, y el ciclo `down` → `up` se cerró a
mano. La reversibilidad del índice está demostrada; la salud del historial local de migraciones
sigue siendo la de antes, desalineada con el remoto.

**No se corrió `pnpm build`**: encadena `migrate deploy` contra una base real
(memoria del proyecto y nota de T13.3).

---

## 10. Veredicto

**Los 36 requisitos quedan cubiertos con test nombrado y las 40 mutaciones del spec mueren; la
suite completa queda verde (828 archivos / 10281 tests) sin degradación y con delta 0 de rojos,
y el riesgo de `design.md §8` no se materializó: T7 está entregado y el intradía sigue siendo
viable. El `down.sql` de T7.2 quedó verificado por texto, por unicidad de sentencia **y por
ejecución real** —el rollback se disparó por accidente contra la base local, revirtió
exactamente su índice y nada más, y el entorno se restauró y se comprobó (§9)—; lo que sigue sin
demostrarse es el ciclo en un entorno de prueba limpio, y el historial local de migraciones sigue
desalineado con el remoto, como estaba.**
