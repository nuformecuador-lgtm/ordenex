# 176 — analitica: modo agregado de tasas y tiempos · requirements

> Zona: `backend` · complexity: `medium` · `depends_on: [126]` · branch `feature/176-analitica-modo-agregado-tasas`
> Origen: decision **D3** de la 131 (`specs/131-analitica-tablero-operativo/requirements.md §6`, fila D3 y §6.1).

## 0. El problema, en una frase

El servicio de la 126 **divide por dia**. `AnaliticaOperativaService.proyectar` agrupa por
`(fecha, dimension)` —clave literal `` `${cubo.fecha}${clave}` ``,
`lib/services/AnaliticaOperativaService.ts:325`— y aplica la formula dentro de cada grupo
(`valorDe`, `:390-415`). Sumar despues esos cocientes es **media de medias**, que pondera igual
un dia de 1 gestion y un dia de 1.000.

### Hechos verificados en este arbol (no citados de nadie)

1. **El comentario que hay que extender, no contradecir.**
   `lib/services/AnaliticaOperativaService.ts:38-40`:
   > «D5 — SUMAR ANTES DE DIVIDIR, SIEMPRE. Las tasas suman numerador y denominador sobre los
   > cubos del recorte y dividen AL FINAL; `tiempo_ciclo` suma `seg_ciclo_acum` y `seg_ciclo_n` y
   > divide al final. Nunca media de medias, nunca una tasa materializada.»

   Es **cierto dentro de un dia** (suma los cubos de zona/tienda/mensajero de esa fecha) y **no
   dice nada del cruce entre dias**, porque el grano de salida de la 126 es el punto diario. Esta
   feature no lo revoca: aplica la misma regla **un nivel mas arriba**.

2. **`seg_ciclo_acum` / `seg_ciclo_n` NO se exponen. Confirmado.** El contrato de salida es
   `PuntoSerie { fecha, dimension?, valor, parcial?, corteAt? }`
   (`lib/types/analitica-operativa.ts:80-91`): solo el cociente. Los acumuladores existen en
   `CuboRollup` (`lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts:64-65`) y
   **mueren en el servicio**. Por eso «que el cliente sume» es literalmente imposible para
   `tiempo_ciclo`: no hay nada que sumar del otro lado del contrato.

3. **El rollup tiene los componentes y no tiene la tasa.** `AnalyticsDaily`
   (`db/schema.prisma:1876-1916`) declara `ordenesCreadas`, `ordenesEstadoStock`, `entregas`,
   `devoluciones`, `rechazos`, `reprogramaciones`, `incidentes`, `primerIntentoOk`,
   `segCicloAcum BigInt`, `segCicloN Int`. **Ninguna tasa, ningun promedio** (comentario `:1871`)
   y **no existe columna `sin_gestionar`** (se deriva del embudo,
   `AnaliticaOperativaService.soloSinGestionar`, `:353-362`).

4. **La ficha es inexacta para `aging_por_estado`, y hay que decirlo.** La 131 solo entra en
   `modo: "rango_excedido"` si `fechasDistintas(crudos) > 62`
   (`app/(app)/analitica/_components/operativo/agregacion.ts:310,313`). El aging es
   `clase: "live"` (`lib/analytics/metrics.ts:375`) y su serie tiene **una sola fecha**, la del
   corte (`AnaliticaOperativaService.serieViva:225`). Es decir: el aging **siempre pinta serie**;
   lo que **nunca** tiene es cifra total, porque `total` se anula para toda unidad distinta de
   `conteo` en **cualquier** rango (`agregacion.ts:371` y su comentario `:369-370`). Lo que esta
   feature le devuelve al aging no es un rango largo: es su KPI.

5. **Denominador cero: el precedente existe y dice `null`, no `0`.** `razon()`
   (`AnaliticaOperativaService.ts:148-151`) y el contrato
   (`lib/types/analitica-operativa.ts:85`, «`null` = indefinido (denominador 0). NUNCA `0` para
   decir "no se sabe"»). Esta feature **no lo cambia**: lo hace mas informativo exponiendo el
   denominador junto al valor.

6. **La cache de la 128 cuelga de `agregarCubos`**
   (`lib/repositories/CachedAnaliticaOperativaRollupRepository.ts:57-66`), con codec de `bigint`
   porque `JSON.stringify(BigInt)` **lanza** (`lib/cache/cache-codec.ts:12-20`). El repositorio
   vivo **no se decora, por construccion** (`:6-7,12-14`).

---

## 1. Alcance

**Entra:** un modo de lectura AGREGADO por cubo temporal (`periodo` = todo el rango; `semana` =
lunes ISO) que devuelve **numerador y denominador** por cubo, para las metricas cuya
`unidad` es `porcentaje` o `segundos`: `tasa_entrega`, `tasa_devolucion`, `tasa_rechazo`,
`primer_intento_ok`, `tiempo_ciclo` y `aging_por_estado`.

**No entra:** metricas nuevas en el catalogo; cambios en `lib/analytics/metrics.ts`; migraciones;
columnas nuevas; el cableado del tablero (131); ninguna ruta de `app/api`.

---

## 2. Requisitos (EARS)

### La correccion aritmetica

- **R1** — El sistema DEBE exponer una lectura AGREGADA que devuelva, por cada cubo temporal del
  rango, **el numerador y el denominador de la metrica antes de dividir**, ademas del valor ya
  dividido.

- **R2** — CUANDO se consulte en modo agregado una metrica de `unidad: "porcentaje"` sobre un
  rango de varios dias, el sistema DEBE sumar **todos** los numeradores y **todos** los
  denominadores de los dias del cubo y dividir **una sola vez**, y NO DEBE promediar los valores
  diarios. *(Requisito central. Su prueba usa dias de volumen DESIGUAL: con volumenes iguales las
  dos formas coinciden y el test no probaria nada.)*

- **R3** — CUANDO se consulte `tiempo_ciclo` en modo agregado, el sistema DEBE devolver como
  numerador la suma de `seg_ciclo_acum` y como denominador la suma de `seg_ciclo_n` de los dias
  del cubo, y el valor DEBE ser el cociente de esas dos sumas.

- **R4** — SI el denominador agregado de un cubo es `0`, ENTONCES el sistema DEBE devolver
  `valor: null` y DEBE devolver `numerador: 0` y `denominador: 0` como numeros presentes; NO DEBE
  devolver `0`, `NaN` ni omitir el cubo.

  *(**D2** — esto no solo respeta el precedente de la 126: lo **mejora**. Hoy el consumidor recibe
  un `null` (`razon()`, `AnaliticaOperativaService.ts:148-151`; contrato en
  `lib/types/analitica-operativa.ts:85`) y **no puede distinguir «el denominador fue cero» de «no
  hay dato»**: son el mismo pixel. Con el denominador a la vista si se distinguen —
  `denominador === 0` significa «no hubo gestiones en el periodo», que es una afirmacion sobre la
  operacion y no una ausencia de informacion—. `valor: 0` sigue prohibido: una tasa de cero es un
  dato real, y falso.)*

- **R5** — El sistema NO DEBE emitir ningun `bigint` en la respuesta del modo agregado:
  `numerador` y `denominador` DEBEN ser `number`, y la respuesta completa DEBE sobrevivir a
  `JSON.stringify`.

- **R6** — El sistema DEBE calcular el denominador de `tasa_entrega`, `tasa_devolucion` y
  `tasa_rechazo` como la suma de `entregas + devoluciones + rechazos + incidentes` (gestiones), y
  NO DEBE usar `ordenes_creadas` como denominador.

- **R7** — El sistema DEBE calcular el denominador de `primer_intento_ok` como la suma de
  `entregas` del cubo.

- **R8** — CUANDO el rango agregado abarque **exactamente un dia cerrado** y la misma consulta se
  sirva por el modo serie de la 126, el valor agregado DEBE ser igual al valor del punto diario de
  esa serie.

  *(**EL ANCLA.** Prohibe que el agregado invente una formula paralela. Y es **estructuralmente
  cierto, no una coincidencia que haya que vigilar**: los dos caminos piden los cubos al MISMO
  metodo (`IAnaliticaOperativaRollupRepository.agregarCubos`) con los MISMOS `granos`, luego con la
  MISMA clave de cache (`claveDeConsulta`, `CachedAnaliticaOperativaRollupRepository.ts:57-66`).
  Sobre un dia, los dos parten de las mismas filas y solo pueden diferir en la aritmetica — que es
  exactamente lo unico que el test mide. Sin ese anclaje, un agregado que **derivase de la serie**
  en vez de partir de los componentes pasaria desapercibido hasta el primer rango largo.)*

### Honestidad de la respuesta

- **R9** — El sistema DEBE incluir en toda respuesta agregada `ok` el bloque `cobertura` con las
  mismas semanticas que la 126 (`fechasNoComparables` + `penumbra`), declarado **sin `?`**.

- **R10** — CUANDO un cubo agregado incluya el dia en curso, el sistema DEBE marcarlo
  `parcial: true` y DEBE devolver el `corteAt` usado. MIENTRAS un cubo contenga solo dias
  cerrados, el sistema NO DEBE marcarlo parcial.

  *(**D4** — el dia en curso **entra**. Los tres presets no personalizados incluyen hoy
  (`lib/analytics/ranges.ts`; declarado en `specs/131-.../requirements.md §5.4`), asi que
  excluirlo produciria, **en la vista por defecto**, un agregado que ignora en silencio el dia que
  el usuario esta mirando. Es la misma regla de D2 de la 131: se pinta, y se anuncia parcial.)*

- **R11** — CUANDO se consulte `aging_por_estado` en modo agregado, el sistema DEBE devolver un
  **unico cubo al corte** —no una serie temporal—, con numerador = suma de `segEnEstadoAcum`,
  denominador = suma de `ordenes`, y marcado `parcial: true` con su `corteAt`.

  *(**D3, y el porque completo, para que quien lea esto no vea una excepcion sin motivo.**
  `aging_por_estado` es la unica metrica `clase: "live"` del catalogo (`lib/analytics/metrics.ts:375`)
  y su serie tiene **una sola fecha**, la del corte (`AnaliticaOperativaService.ts:225`).
  Consecuencia verificada, y distinta de lo que sugeria la ficha de esta feature: el aging
  **nunca** estuvo en `modo: "rango_excedido"`, porque la 131 entra ahi solo si
  `fechasDistintas(crudos) > 62` (`app/(app)/analitica/_components/operativo/agregacion.ts:310,313`)
  y aqui ese numero es 1. **El aging siempre pinta serie.** Lo que no tiene —y no ha tenido nunca,
  en NINGUN rango, ni corto ni largo— es **cifra total**, porque el total se anula para toda unidad
  distinta de `conteo` (`agregacion.ts:371`, con su comentario `:369-370`). No le faltaba el rango
  largo: le falta su KPI **siempre**, y eso es lo que este requisito le devuelve.
  Por eso su forma es propia: un stock instantaneo no se agrega sobre el TIEMPO —«el aging medio de
  agosto» no significa nada—, se agrega sobre la **DIMENSION**, fundiendo los estatus al corte.
  Meterlo en el mismo cubeteo temporal que las tasas seria darle una respuesta con forma correcta y
  significado inventado.)*

- **R12** — SI la metrica pedida tiene `unidad: "conteo"`, ENTONCES el sistema DEBE responder
  `validation_error` y NO DEBE devolver un agregado. *(El modo agregado existe para lo que no es
  sumable. Servir aqui `ordenes_por_estado` sumaria un STOCK entre fechas, que R12 de la 126 y
  `db/schema.prisma:1886` prohiben expresamente.)*

### Permisos e identidad — el modo agregado no es una puerta trasera

- **R13** — El sistema DEBE resolver la consulta agregada por el **mismo** punto de entrada
  `prepararConsultaAnalitica` que la 126, y NO DEBE aceptar filtro, rango ni alcance por ningun
  otro canal.

- **R14** — CUANDO la preparacion deniegue, el sistema DEBE responder `forbidden` sin datos y sin
  motivo, y DEBE registrar el denegado en el log de auditoria **antes** de responder; CUANDO el
  filtro sea invalido, DEBE responder `validation_error` sin tocar la base.

- **R15** — MIENTRAS la politica de identidad sea `seudonima`, el sistema DEBE seudonimizar la
  dimension `mensajero` de los cubos agregados con el mismo helper que la 126, y NO DEBE emitir
  ids reales de mensajero. Ademas DEBE denegar, por el mismo camino de R14, un filtro que nombre
  `mensajero_id` bajo politica seudonima (el oraculo de R24/R36 de la 126).

### Frontera

- **R16** — El sistema NO DEBE anadir, renombrar ni modificar ninguna metrica de
  `lib/analytics/metrics.ts`, y ningun archivo nuevo de esta feature DEBE escribir en ese archivo.

- **R17** — El modo agregado DEBE obtener sus cubos del **mismo** metodo de repositorio que la
  126 (`IAnaliticaOperativaRollupRepository.agregarCubos`) y NO DEBE anadir metodos al
  repositorio ni superficie de cache nueva. *(Consecuencia deliberada: hereda la cache de la 128
  y su codec de `bigint` sin tocar `lib/cache/**`, y el dia en curso sigue fuera de la cache por
  construccion.)*

- **R18** — Los archivos que esta feature modifica DEBEN ser exactamente los declarados en
  `design.md §1`, y ninguno mas.

### Granos temporales

- **R19** — El sistema DEBE ofrecer **dos** granos de cubo: `periodo` (un unico cubo para todo el
  rango) y `semana` (un cubo por semana ISO, anclada en su lunes), y la frontera de semana DEBE
  coincidir con la del preset `semana` de `lib/analytics/ranges.ts`.

  *(**D6** — los dos, no solo `periodo`. Es la misma funcion de cubeteo con distinta clave, y sin
  el grano `semana` la 131 tendria que seguir agregando por semana en cliente **justo para las
  metricas que no puede agregar**. Con cubos semanales servidos, la 131 puede **borrar** su
  `lunesDeLaSemana` (`app/(app)/analitica/_components/operativo/agregacion.ts:80-88`) para
  `porcentaje` y `segundos`, en vez de mantener dos calendarios: un calculo duplicado en dos capas
  **se desincroniza solo**, y nada avisa. La exigencia de que la frontera coincida con el preset
  `semana` es lo que impide que el repo tenga dos definiciones de «lunes».)*

---

## 3. Trazabilidad `R<n>` -> test -> **mutacion**

Un requisito no vale por tener un test verde: vale porque **la mutacion escrita aqui pone rojo el
test NOMBRADO**. El implementer aplica cada mutacion, comprueba el rojo, la revierte y lo anota en
`progress/impl_176.md`.

| R | Test (archivo › nombre) | Mutacion que debe ponerlo ROJO |
|---|---|---|
| R1 | `tests/unit/analytics/agregado-contrato.test.ts` › «cada cubo agregado trae numerador y denominador ademas del valor» | Borrar `numerador`/`denominador` del objeto devuelto y dejar solo `valor` |
| **R2** | `tests/unit/analytics/agregado-tasas.test.ts` › «con dias de volumen desigual la tasa del periodo suma antes de dividir y no promedia los dias» | En el agregador, sustituir la suma de componentes por `puntos.reduce((a,p)=>a+(p.valor??0),0)/puntos.length` (la media de los valores diarios) |
| R3 | `tests/unit/analytics/agregado-tiempo-ciclo.test.ts` › «el tiempo de ciclo del periodo es Σ acum / Σ n a traves de DIAS distintos» | Igual que R2, aplicada a `tiempo_ciclo`: promediar los `valor` diarios en vez de sumar `segCicloAcum`/`segCicloN` |
| R4 | `tests/unit/analytics/agregado-tasas.test.ts` › «denominador cero devuelve valor null con numerador y denominador en 0, no una tasa de 0» | Cambiar el retorno de denominador cero a `valor: 0` |
| R5 | `tests/unit/analytics/agregado-contrato.test.ts` › «la respuesta agregada sobrevive a JSON.stringify y no lleva bigint» | Devolver `numerador: m.segCicloAcum` (el `bigint` crudo) sin convertir |
| R6 | `tests/unit/analytics/agregado-tasas.test.ts` › «el denominador de las tres tasas es gestiones, no ordenes creadas» | Cambiar el denominador de las tasas a `m.ordenesCreadas` |
| R7 | `tests/unit/analytics/agregado-tasas.test.ts` › «el denominador de primer_intento_ok es entregas» | Cambiar el denominador de `primer_intento_ok` al denominador de gestiones |
| R8 | `tests/unit/analytics/agregado-coherencia.test.ts` › «sobre un unico dia cerrado el agregado coincide con el punto de la serie de la 126» | Cambiar el orden de las operaciones del agregado a dividir-y-sumar (basta invertirlo para una sola metrica) |
| R9 | `tests/unit/analytics/agregado-cobertura.test.ts` › «la respuesta agregada declara cobertura con las fechas no comparables del rango» | Declarar `cobertura?` opcional y no emitirla en el agregado |
| R10 | `tests/unit/analytics/agregado-dia-en-curso.test.ts` › «el cubo que contiene el dia en curso viaja parcial con su corteAt, y el que solo tiene dias cerrados no» | No propagar `parcial`/`corteAt` al cubo agregado |
| R11 | `tests/unit/analytics/agregado-aging.test.ts` › «aging_por_estado agrega la dimension al corte en un unico cubo parcial» | Devolver el aging como un cubo por estatus sin fundir, o quitarle la marca `parcial` |
| R12 | `tests/unit/analytics/agregado-metricas-admitidas.test.ts` › «una metrica de conteo se rechaza con validation_error y no se agrega» | Quitar la comprobacion de `unidad` y servir `ordenes_por_estado` |
| R13 | `tests/unit/analytics/agregado-alcance.guardia.test.ts` › «ninguna firma del modo agregado recibe filtro, alcance o rango sueltos» | Anadir un parametro `filtro: AnaliticaFiltroInput` a la firma del agregado |
| R14 | `tests/unit/analytics/agregado-action.test.ts` › «un denegado se audita antes de responder forbidden y viaja sin datos ni motivo» | Devolver `{ status: "forbidden" }` sin llamar a `logger.logError` |
| R15 | `tests/unit/analytics/agregado-identidad.test.ts` › «bajo politica seudonima los cubos por mensajero no llevan ids reales y el filtro por mensajero se deniega» | Devolver los cubos sin pasar por `seudonimizarMensajeros`; y por separado, saltarse `sondeaIdentidadDeMensajero` |
| R16 | `tests/unit/analytics/agregado-alcance.guardia.test.ts` › «el modo agregado no declara metricas propias: todas salen del catalogo» | Declarar en el servicio un id de metrica que no exista en `listarMetricas()` |
| R17 | `tests/unit/analytics/agregado-alcance.guardia.test.ts` › «el modo agregado consume agregarCubos y no anade metodos al repositorio del rollup» | Anadir un metodo `agregarPeriodo` a `IAnaliticaOperativaRollupRepository` y llamarlo desde el servicio |
| R18 | `tests/unit/analytics/agregado-frontera.guardia.test.ts` › «el diff contra origin/dev no toca ningun archivo fuera de la lista declarada» | Tocar `lib/analytics/metrics.ts` (o cualquier archivo fuera de la lista) |
| R19 | `tests/unit/analytics/agregado-semana.test.ts` › «el grano semana ancla en el mismo lunes que el preset `semana` de `ranges.ts`» | Anclar la semana en domingo (o desplazar el lunes un dia) |

---

## 4. Decisiones de la puerta T0 — **CERRADA**

Las seis preguntas abiertas fueron respondidas por el humano. Quedan aqui como decisiones
numeradas `D<n>`, con su alternativa descartada y su motivo, para que quien lea esto despues
encuentre el porque y no una excepcion sin explicacion. **Ninguna esta abierta.**

| # | Pregunta | Decision | Motivo | Donde vive |
|---|---|---|---|---|
| **D1** | Forma del contrato | **(A)** metodo nuevo `consultarAgregado(...)` en `IAnaliticaOperativaService` + **Server Action propia** | Deja **intactos** `PuntoSerie` y `SerieOperativa`, que **131 y 132 ya consumen en produccion**, y **no toca `lib/analytics/consulta.ts`** — el punto blindado de la 122 por donde pasa el alcance. *Descartadas: (B) campo `agregado?` en la serie —cambia el payload de dos consumidores vivos y obliga a calcular el agregado incluso cuando solo se quiere la serie—; (C) parametro en `ConsultaAnalitica` —toca el punto de entrada de otra feature—* | `design.md §3, §4, §7` |
| **D2** | Denominador cero | **(A)** `valor: null` con **numerador y denominador a la vista** | **Mejora** el precedente de la 126: hoy un `null` no distingue «denominador cero» de «no hay dato»; con el denominador delante si se distingue. *Descartadas: (C) `valor: 0` —una tasa de cero es un dato real y falso—; (B) omitir el cubo —rompe la continuidad del eje—* | **R4** |
| **D3** | `aging_por_estado` | **(A)** entra, como **cubo unico al corte**, agregando sobre la **dimension** y no sobre el tiempo | Es un **stock instantaneo**. Y el hallazgo que lo motiva: el aging **nunca** estuvo en `rango_excedido` (`agregacion.ts:310,313` + `metrics.ts:375`: una sola fecha) — lo que le falta **no es el rango largo, es el KPI total, en TODO rango** (`agregacion.ts:371`). *Descartada: (B) dejarlo fuera —seria dejar sin cerrar el unico hueco que ya estaba abierto siempre—* | **R11** |
| **D4** | Dia en curso | **(A)** entra, y su cubo se anuncia **`parcial` con su `corteAt`** | Los tres presets no personalizados incluyen hoy, asi que excluirlo daria **por defecto** un agregado que ignora en silencio el dia que el usuario esta mirando. Misma regla que D2 de la 131 | **R10** |
| **D5** | ¿Se cablea la 131 aqui? | **(A) NO.** El contrato se entrega aqui; el cableado va en **ficha `frontend` propia** (§5) | La 176 es `zone: backend`; cablear obligaria a escribir en `app/(app)/analitica/_components/operativo/**` —subarbol de la 131— y **romperia su propio guardia de frontera** (R18) | **R18**, `design.md §1.3` |
| **D6** | Granos | **(A) los dos**: `periodo` y `semana`, con la **misma** funcion de cubeteo | Permite a la 131 **borrar** su `lunesDeLaSemana` para `porcentaje`/`segundos` en vez de mantener dos calendarios: **un calculo duplicado en dos capas se desincroniza solo**, y nada avisa | **R19**, `design.md §6.1` |

### 4.1 Dos cosas blindadas por decision explicita del humano

1. **La doble asercion del test aritmetico es obligatoria.** El caso de R2 afirma el valor correcto
   (`0,10`) **y niega** el de la media de medias (`0,5455`). Sin la segunda, una implementacion que
   devolviera cualquier otra cosa parecida pasaria. Y **T4.2 usa dias DISTINTOS**: es innegociable,
   porque `operativa-tiempo-ciclo.test.ts:22-29` usa dos **zonas del mismo dia** —caso que la 126
   ya resuelve bien— y quien copie ese test creera haber probado algo sin haberlo probado.
2. **R8 es estructural, no una coincidencia.** Escrito en el propio requisito: ambos caminos leen
   los mismos cubos por la misma clave, luego solo pueden diferir en la aritmetica. Es lo que
   impide que el agregado derive de la serie y nadie lo note.

## 5. Ficha que sale de D5 (**la da de alta el humano**; esta spec NO toca `feature_list.json`)

- **name:** `analitica: cablear el modo agregado al tablero operativo`
- **description:** «Frontend. Cablea el modo agregado de la 176 (`consultarAgregadoOperativo`) a
  los paneles de `porcentaje` y `segundos` del tablero operativo, cerrando el hueco declarado por
  **R27 de la 131**: por encima del techo de 62 puntos esos paneles pasan a pintar la serie por
  cubos **semanales** servidos por el backend, y **todos** los paneles de esas dos unidades pasan a
  mostrar su cifra total —incluido `aging_por_estado`, que hoy no la tiene en **ningun** rango—.
  El total se toma del cubo `periodo`; ni media de medias ni formula recompuesta en la UI. Al
  consumir cubos semanales del servidor, retira `lunesDeLaSemana` de
  `app/(app)/analitica/_components/operativo/agregacion.ts` para `porcentaje` y `segundos`, de modo
  que no queden dos definiciones de semana. Reescribe R27 de la 131, que deja de ser un hueco.»
- **zone:** `frontend` · **sdd:** `true` · **complexity:** `medium`
- **depends_on:** `176`
- **status_note:** «El hueco que cierra esta escrito en `specs/131-.../requirements.md §6.1`. Ojo
  con `aging_por_estado`: no es un caso de rango largo (nunca entro en `rango_excedido`), es un
  panel sin KPI en todo rango — ver D3 de `specs/176-.../requirements.md §4`.»
