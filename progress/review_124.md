# Revision — Feature 124 (Analitica: job de agregacion diaria)

> Reviewer. Rama `feature/124-analitica-job-agregacion-diaria`, worktree aislado
> `ordenex-wt-124`, diff `origin/dev...b4df65fd`. Fecha: 2026-08-01.
> **Veredicto final: BLOQUEADO** — 2 bloqueantes, los dos de EVIDENCIA (no de codigo),
> 8 menores. **Ni una linea de produccion necesita cambiar.**
>
> Todo lo de abajo esta medido en este worktree. Base local `ordenex:5432`, verificada con
> `current_database()` / `inet_server_port()` en cada paso. Produccion no se toco ni para leer.
> El checkout principal (`arc/ordenex`, rama `ux`) no se toco en absoluto.

---

## 0. Estado verificado por el reviewer, no citado

| medicion | comando | resultado |
|---|---|---|
| typecheck | init.sh paso 5 | **0 errores** |
| lint | init.sh paso 5 | **0 errores, 18 warnings** — delta 0 |
| suite | init.sh paso 5 | **732 archivos, 8967 tests**, 2 failed / 8965 passed |
| regla max-2-por-zona | manual (jq no esta instalado, el paso 3 se salta con warning) | backend: [124], fullstack: [170] — **respetada** |
| down.sql en toda migracion | manual (init.sh aborta antes del paso 6) | **ninguna falta** |
| analytics_daily al empezar / al terminar | SELECT count(*) | **0 / 0** |

Los dos rojos:

1. `tests/components/descarga/WalletPropsDescarga.test.tsx` — timeout de 20 s con ~23 s.
   **Heredado de dev**, ya nombrado en el baseline de `impl_124.md` seccion 0.
2. `tests/unit/components/filter-component.test.tsx` — **flake por saturacion**: corrido
   aislado por el reviewer, **39/39 verdes**. No cuenta.

El total de archivos se comparo contra 732 antes de creerse el conteo: no hubo unhandled
errors de workers. **Delta 0 confirmado.** init.sh termina rojo solo por el rojo heredado.

---

## 1. Bloqueantes

### B1 — `progress/impl_124.md` NO tiene mapa de trazabilidad. R44 lo exige por escrito y no existe.

La bitacora salta de la seccion 6 a la 4.4 y de ahi a la 8. **No hay seccion 7.** Lo que falta
es exactamente lo que dos tareas del propio spec encargaban:

- **T7.1** (`tasks.md:198`): mapa R-n a test de las **49**, con la particion honesta
  medido / nominal.
- **T7.2** (`tasks.md:201`): la tabla de la deuda de la 123 con encabezado literal
  **11 medidos, 1 texto**, nombrando por cada uno de los once el test de esta feature que lo
  mide.

Y R44 no es un requisito de proceso: su clausula de aceptacion es literal
(`requirements.md:460`): *el mapa de trazabilidad de progress/impl_124.md debe nombrar, por
cada uno de los once, el test de esta feature que lo mide*. Sin ese mapa, **R44 es el unico de
los 49 sin verificacion**.

**Matiz que juega a favor del implementer, y hay que decirlo:** la SUSTANCIA de R44 esta hecha.
El reviewer comprobo uno a uno los once y **la cuenta 11 + 1 es correcta** (seccion 3). Lo que
falta es el artefacto. El arreglo es clerical y no toca codigo — pero es el artefacto del que
depende que la 125 y la 126 sepan que se mide y que no, y la regla 4 del arnes es explicita.

**Archivo:** `progress/impl_124.md`, seccion 7 ausente (entre las lineas 306 y 307).

### B2 — `tasks.md`: 43 de 46 tareas siguen sin marcar.

`specs/124-analitica-job-agregacion-diaria/tasks.md` tiene **3 marcadas** (T0.1, T0.2, T0.3,
las tres del spec) y **43 sin marcar**, incluidas T1-T6 completas, T8.2 (round-trip **hecho** y
documentado en `progress/roundtrip_124_job_tipo.md`) y T8.3 (medicion de volumen **hecha**).

El trabajo esta hecho y probado: lo que falta es el registro. Es el punto 2 del checklist del
reviewer y no se puede dar por bueno con un "se ve en la bitacora": la tabla de tareas es el
sitio donde el leader lee el estado, y hoy dice que la feature no empezo.

**Archivo:** `specs/124-analitica-job-agregacion-diaria/tasks.md:34-240`.

---

## 2. Mutaciones REEJECUTADAS por el reviewer

No se creyo la tabla de `impl_124.md` seccion 4. Se eligieron **17 sondas** por donde mas
barato seria mentir: la reconciliacion, los dos guardias re-alcanzados, la idempotencia contra
Postgres y la cota del corte. Cada una: sonda aplicada, test corrido, resultado observado,
reversion verificada con md5sum y con `git status --porcelain` vacio.

| # | sonda | esperado | observado |
|---|---|---|---|
| 1 | ordenesCreadas x2 en Q1 (doble conteo) | rojo por reconciliacion | **ROJO**, 23 casos de integracion; ReconciliacionError ... escrito 2, esperado 1 |
| 2 | ordenesEstadoStock x2 + **corrida manual REAL** sobre 2026-07-31 | aborta y NO escribe | **ABORTA DE VERDAD**: ReconciliacionError ... escrito 88, esperado 44; y count(*) = 0 despues. La transaccion revierte contra Postgres, no lo parece |
| 3 | h.created_at < corte pasa a <= | rojo | **ROJO** x3 (guard de texto + los dos casos de datos: pareja de medianoche y transicion del corte) |
| 4 | ON CONFLICT reducido a 4 columnas | rojo | **ROJO** (23 casos; Postgres 42P10) |
| 5 | se elimina el barrido de rancias | rojo | **ROJO**: R29 + **R49(b)** + **R49(c)** |
| 6 | prisma.analyticsDaily.findMany en un archivo cualquiera de lib/ | rojo | **ROJO** x3 (nombrar / acceder / **leer**) |
| 7 | prisma.analyticsDaily.upsert fuera del allowlist | rojo | **ROJO** x3 (incluye "no hay un SEGUNDO escritor") |
| 8 | reduce real sobre ordenesEstadoStock con desde/hasta en lib/ | rojo | **ROJO** (tripwire R43) |
| 9 | ruta **inventada** en el allowlist | rojo | **ROJO**: Rutas: lib/services/EsteArchivoNoExisteRev124.ts |
| 10 | se **retira del allowlist** una ruta real (la del encolado) | rojo? | **VERDE** — ver M-1 |
| 11 | lectura del rollup DENTRO de un modulo allowlisteado que **no** es el repositorio | rojo | **ROJO** x3. El allowlist **no** da derecho de acceso: la restriccion aguanta |
| 12 | migracion de sonda con CREATE INDEX sobre la tabla, **sin** declararla | rojo | **ROJO**: Faltan en el datamodel: analytics_daily_sonda_rev124_idx |
| 13 | la misma migracion **declarada** en schema.prisma | verde | **VERDE** el guardia de drift (el defecto de la 123 queda arreglado). Pero el ARCHIVO sale rojo por otra asercion — ver M-2 |
| 14 | extractor de objetos vaciado | rojo por "no mide nada" | **ROJO**: la extraccion no encontro ningun objeto ... el guardia no mide nada |
| 15 | UPDATE "orden" dentro del repositorio | rojo | **ROJO** x2 (R4, con las trece tablas nombradas) |
| 16 | se quita el desempate por id DESC del estatus congelado | rojo | **ROJO** por el caso de datos. El guard de TEXTO no lo vio — ver M-3 |
| 17 | handler fuera de buildHandlers | rojo | **ROJO** x4 en 3 archivos (R36) |

**16 de 17 se comportaron exactamente como `impl_124.md` describe.** La numero 10 es una
variante propia del reviewer, no una de las del implementer, y salio verde: es M-1.

Ademas, **idempotencia (R28) contra Postgres real y no por argumento**: dos corridas manuales
seguidas sobre 2026-07-31, con huella md5 de las 22 filas incluyendo created_at:

    1.a corrida: filasEscritas=22 filasRetiradas=0   huella 180764d9...  n=22
    2.a corrida: filasEscritas=22 filasRetiradas=0   huella 180764d9...  n=22   <- IDENTICA

**La tabla se dejo como se encontro:** las 22 filas se borraron y count(*) volvio a **0**,
comprobado.

---

## 3. Trazabilidad, con la particion honesta

**49/49 mapeados a un test concreto — pero no todos con la misma tinta.** Criterio aplicado:
un requisito sobre COMPORTAMIENTO medido solo grepeando el fuente esta cubierto por proxy; un
requisito sobre EL CODIGO medido con un escaneo del arbol esta medido con el instrumento
correcto (el escaneo es la observacion).

| grupo | n |
|---|---|
| **A. Medidos por asercion que discrimina sobre comportamiento EJECUTADO** (Postgres real, dobles en memoria o funcion pura corrida) | **36** |
| **B. Propiedades DEL CODIGO medidas por escaneo del arbol, verificado que discrimina** | **8** |
| **C. Solo regex sobre el texto de un artefacto, siendo el requisito de comportamiento** | **4** |
| **D. Sin verificacion** | **1** |

**Grupo A (36):** R1, R5, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20,
R22, R23, R24, R25, R27, R28, R29, R30, R32, R33, R34, R35, R36, R37, R38, R39, R45, R46,
R47(a), R49.

**Grupo B (8):** R3, R4, R6, R26, R40, R41, R42, R43. Seis de los ocho los muto el reviewer
(sondas 6, 7, 8, 9, 12, 14, 15) y todos dispararon. R4 es el mas debil del grupo: es una
propiedad de RUNTIME (el job no escribe en el dominio) medida por analisis estatico; ningun
test corre el job y comprueba que ninguna tabla de dominio cambio. El analizador cubre SQL
crudo y query builder, asi que la brecha es estrecha, pero existe.

**Grupo C — los que solo mide una regex, nombrados uno por uno (4):**

1. **R2** (no altera el grano ni el conjunto de medidas). Su unico juez es
   `tests/unit/analytics/analytics-daily-contrato.test.ts` mas
   `analytics-daily-migration.test.ts`, los dos regex sobre migration.sql / schema.prisma.
   Es aceptable: la 124 no toca DDL de la tabla. Se declara igual.
2. **R21** (no calcula tasas, promedios ni porcentajes). Solo `rollup-service.test.ts:998`, un
   not.toMatch sobre el fuente. Respaldo indirecto: la reconciliacion exige enteros.
3. **R31** (MIENTRAS dos corridas se solapen). La mitad de "no duplicar filas" la mide R27/R28
   con datos reales; la mitad del **solapamiento no la mide nada**: no hay ni un caso con dos
   corridas concurrentes, y la afirmacion de design.md seccion 5 de que el barrido no puede
   borrar las filas de la corrida rival es prosa razonada, no medicion.
4. **R48** (ninguna consulta sin acotacion). Sostenido por toMatch / not.toMatch sobre el
   fuente del repositorio. Respaldo parcial y real: los casos "D-1 y D+1 intactas" y "entregada
   hace tres dias no esta en el stock".

**Grupo D (1): R44** — ver B1.

### La cuenta heredada de la 123: 11 medidos + R15 texto es CORRECTA

Comprobada, no copiada. Cada uno con el caso de datos reales que ahora lo mide:

| 123 | que pedia | test de la 124 que lo mide con datos |
|---|---|---|
| R11 | mensajero_id NULL = sin asignar, nunca "todos" | la orden sin mensajero escribe el cubo con mensajero_id NULL |
| R12 | causa_devolucion nullable = sin causa tipificada | la causa solo se informa en las filas de devuelta, y sin causa queda NULL |
| R13 | ninguna fila de totalizacion | reconciliacion R33/R34 — **verificada abortando de verdad** (sonda 2) |
| R24 | primer_intento_ok <= entregas | primer intento vs entrega tras una devolucion previa, mas el CHECK real |
| R28 | stock al corte, NO aditivo por fecha | la entregada hace TRES dias no esta en el stock de hoy; la que cerro hoy SI |
| R31 | zona/tienda de la ORDEN | la orden de la zona A gestionada por un mensajero de la zona B |
| R32 | mensajero segun familia de medida | la orden desasignada despues de gestionar produce DOS filas |
| R33 | estatus_id al corte | la transicion del corte NO entra, mas dos cambios de estatus el mismo dia |
| R34 | ciclo en la fecha del evento terminal | creada hace CINCO dias y entregada hoy |
| R35 | inmutabilidad hacia atras | la corrida de D no crea ni modifica filas de D-1 ni de D+1 (con la rebaja fijada en R49) |
| R36 | tolerar la fila huerfana | el estatus HUERFANO no descarta la orden ni hace fallar la corrida |

Y **R15 declarado texto es la clasificacion correcta**: que el apply falle si el motor no
soporta NULLS NOT DISTINCT es una propiedad del despliegue, no falsable desde un job.

Verificado ademas contra la base que el caso de R45 (R36 de la 123) no es imaginario:
order_status tiene la fila en_fulfillment con **37 referencias** en orden_historial_estado y 0
en orden.

---

## 4. Los cuatro juicios que el leader pidio

### 4.1 Desviacion 3.1 (ON CONFLICT ON CONSTRAINT) — el implementer tiene razon, y el spec debe corregirse

Comprobado contra la base local:

    pg_indexes    -> analytics_daily_grano_key  UNIQUE (fecha, zona_id, tienda_id,
                     mensajero_id, estatus_id, causa_devolucion) NULLS NOT DISTINCT
    pg_constraint -> ciclo_coherente, medidas_no_negativas, pio_lte_entregas, pkey, 4 fkey
                     (NINGUNA fila para analytics_daily_grano_key)

design.md seccion 5 es **inejecutable tal como esta escrito**: un indice suelto no tiene fila
en pg_constraint. La inferencia por lista de columnas **resuelve al mismo indice** —es el unico
unique sobre esas seis columnas; el otro unique de la tabla es el pkey sobre id— y arrastra su
NULLS NOT DISTINCT, que es lo que R28 necesita. Verificado por las dos vias: los cubos con
mensajero_id y causa_devolucion nulos no se duplican en la 2.a corrida real, y **reducir la
lista pone la escritura roja** (sonda 4). **Correcto. design.md seccion 5 debe corregirse**
(accion del leader; el implementer hizo bien en no editar el spec desde la implementacion, y en
dejar la desviacion escrita en el codigo).

### 4.2 Exclusion silenciosa 3.2 — cierto, caracterizado, y con un flanco que hay que nombrar

Medido: ordenes vivas sin ninguna fila de historial = **0** sobre 58 ordenes. El conjunto **es**
vacio hoy, y el choke point appendCambioEstado (feature 49) es la razon estructural. Esta
caracterizado por test ("la orden SIN ninguna transicion anterior al corte queda FUERA del
rollup").

El flanco, que se acepta pero se nombra: **Q6 aplica el mismo EXISTS**, asi que si ese conjunto
dejara de ser vacio, la reconciliacion —la unica red que caza el resto de fallos silenciosos—
**coincidiria con el error** y no diria nada. La exclusion es doblemente silenciosa. Menor
(M-5), con follow-up propuesto para la 125.

### 4.3 El agujero del censo — deuda declarada aceptada, no bloqueante

Verificado: la allowlist indexa por path.basename (lineas 146 y 233) y la exencion es por
archivo, no por token. Las dos cosas son **preexistentes**: el mecanismo es de la 135/153/155 y
la entrada de la 124 es la **12.a**. Se acepta porque (a) la entrada esta justificada con hechos
medidos contra la base, no supuestos; (b) el implementer **redujo** el alcance en vez de
ampliarlo — reescribio el comentario de `_semilla-rollup.ts` para no necesitar una segunda
entrada, y su sonda A2 demuestra que ese archivo sigue vigilado; (c) arreglar el mecanismo toca
las once entradas ajenas. **Corresponde una ficha propia**, no un rechazo a esta feature.

### 4.4 Las dos contradicciones declaradas — SI estan escritas, pero NO donde la 125/126/128 las leeran

Estan, y bien, en tres sitios de esta feature: requirements.md seccion T0 (D1, D2, D7),
design.md seccion 13 (dirigida nominalmente a 125/126/128/135) y el status_note de la ficha 124,
que las nombra literalmente "DOS CONTRADICCIONES DECLARADAS, no resueltas". Eso no es un rincon:
la seccion 13 es el sitio canonico del repo para esto (patron de la 135, seccion 6.1).

**Pero el destinatario no las va a ver.** Los status_note de las fichas que las heredan siguen
como estaban: la **125** habla solo de la 135; la **126** habla solo de la 135; la **128** tiene
status_note null. Quien abra la 128 para disenar la cache no encontrara ni una palabra de que la
invalidacion del pasado ya no es inexistente. T7.3 solo encargaba **proponerlos al leader**, asi
que el implementer cumplio; **la propagacion es accion pendiente del leader** (M-4).

---

## 5. Menores

- **M-1 — Cinco de las diez entradas del allowlist de frontera son inertes.**
  AnaliticaRollupService.ts, los dos de jobs/ y los dos de scripts/ **no nombran** la tabla, asi
  que retirarlos del allowlist no pone nada rojo (sonda 10): son permisos dormidos. El riesgo
  real esta contenido —la sonda 11 demuestra que estar en la lista **no** da derecho de acceso:
  solo el repositorio puede— y la asercion de existencia impide que la lista describa un arbol
  imaginario. Se reporta por precision, no como defecto.
- **M-2 — El drift quedo arreglado, pero el archivo sigue caducando por otra asercion.**
  Con una migracion legitima **declarada** (sonda 13) el guardia de drift sale verde —el defecto
  que R40 vino a arreglar—, pero `analytics-daily-migration.test.ts:218` conserva de la 123 un
  toEqual con los **tres** @@index literales, y sale rojo sin que exista drift. Es asercion
  ajena y mide otra cosa (que los tres indices de recorte llevan map:), pero deja la promesa de
  "hacerlo en frio para que no vuelva a caducar" a medio cumplir. La sonda T5.1(a) del
  implementer corrio **solo el caso de drift** (1 passed), no el archivo: por eso no lo vio.
- **M-3 — Dos guards de texto no discriminan por sitio.** FUENTE_REPO se comprueba con toMatch
  sobre el archivo entero: quitar el desempate por id DESC del estatus congelado deja la
  asercion verde porque la MISMA cadena existe en la CTE ultimo_terminal (sonda 16). Lo atrapo
  el caso de datos, que es lo que importa — pero el guard de texto vale menos de lo que su
  nombre promete. Mismo patron en el bloque R7/R48.
- **M-4 — Los avisos de la seccion 13 no llegaron a los status_note de 125/126/128.** Ver 4.4.
  Accion del leader.
- **M-5 — La exclusion silenciosa se le esconde tambien a la reconciliacion.** Ver 4.2.
  Propuesta para la 125: que el resumen incluya el conteo de ordenes excluidas por no tener
  historial, para que deje de ser silenciosa.
- **M-6 — R31 sin caso de solapamiento.** Ver seccion 3, grupo C.
- **M-7 — TIMEOUT_TX_ROLLUP_MS (desviacion 3.3) esta bien justificada** (el default de 5 s de
  Prisma reventaria con volumen) y correctamente separada de la cifra de volumen, con su propio
  caso que exige que no coincidan. Se anota solo porque es una constante que el spec no previo y
  que la 125 tendra que dimensionar con la medicion real.
- **M-8 — La medicion de volumen (~20 filas, ~1 s) es de la base local**, que no tiene el
  volumen de produccion. El implementer lo dice; se subraya para que la 125 no la tome como base
  de un umbral.

---

## 6. Calidad, seguridad y capas

- **RLS:** no aplica. La migracion **no crea ninguna tabla**: es un ALTER TYPE ... ADD VALUE
  aditivo, solo en su carpeta (55P04), con su down.sql y round-trip verificado.
- **Secretos y PII:** ninguno. La salida observable son cuatro conteos; el handler tiene su caso
  que exige que la linea registrada no lleve ids, destinatarios ni telefonos, y que serialice
  (un BigInt crudo la hace lanzar).
- **Capas:** limpias y verificadas por guard. El servicio **no** habla Prisma; el repositorio
  **no** decide nada; el handler es delgado. Un unico archivo del arbol accede a la tabla, y la
  sonda 11 demuestra que la restriccion no es declarativa.
- **Sin hardcode de contexto:** ningun literal de coordenada en el escritor (guard con su propia
  sonda de discriminacion); los terminales se importan de ESTADOS_TERMINALES.
- **Escrituras ajenas:** el job es de solo lectura sobre el dominio (sonda 15) y sobre el dinero.
- **Dos hallazgos propios del implementer que merecen constar**, porque endurecen en vez de
  aflojar: el bug de cuerpoDeMetodo ante una firma con Promise de tipo objeto inline —el guardia
  clasificaba mal el cuerpo del metodo, o sea **mentia**— y los cuatro comentarios del escritor
  que escribian el token prohibido dentro de la prosa: se reescribieron las frases en vez de
  abrirle una rendija permanente al guardia. Mismo criterio en el censo. Es la decision correcta
  las tres veces.

---

## 7. Que falta para levantar el bloqueo

1. Escribir **la seccion 7 de `progress/impl_124.md`**: mapa R-n a test de las 49 con la
   particion medido / nominal (la de la seccion 3 de esta acta sirve de punto de partida), y la
   tabla "11 medidos, 1 texto" de la deuda de la 123 nombrando el test de cada uno.
2. Marcar en **tasks.md** las tareas hechas, y dejar sin marcar con su razon escrita las que no
   lo esten.

Nada mas. **No hay que tocar codigo de produccion ni tests.** Fuera del bloqueo, accion del
leader: corregir design.md seccion 5 (desviacion 3.1), propagar los avisos de la seccion 13 a
los status_note de 125/126/128, y abrir ficha por el mecanismo del censo (basename mas exencion
por archivo).

---

## 8. Veredicto

**BLOQUEADO** — por B1 y B2, los dos de evidencia.

Dicho con la misma claridad: **la implementacion es solida y lo esta por medicion, no por
lectura**. La reconciliacion de D5 **aborta de verdad** contra Postgres y deja la fecha sin
escribir; los dos guardias re-alcanzados **se ponen rojos en las dos direcciones** y su
allowlist falla tanto con una ruta inventada como con un modulo que intente colarse; la
idempotencia deja la tabla **identica** en la segunda corrida real; la cota del corte es
estricta y **su caso de datos lo demuestra**, no solo su regex. 16 de las 17 sondas del reviewer
se comportaron como la bitacora describe.

Lo que falta es el papel: el mapa que R44 exige por escrito y las casillas de tasks.md. Es
barato de arreglar y no admite excepcion — el mapa es justo lo que impide que la 125 y la 126
hereden como "medido" algo que no lo esta.
