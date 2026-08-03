# Feature 124 — analítica: job de agregación diaria · requirements

> **Zona:** backend. **`depends_on`: 123** (`db/migrations/20260731120000_analytics_daily/`,
> `model AnalyticsDaily`), que a su vez hereda de la **135** (`lib/analytics/metrics.ts`,
> `lib/analytics/ranges.ts`, `lib/utils/fecha-cr.ts`).
>
> **Qué entrega:** el **único escritor** de `analytics_daily` para el día natural de Costa Rica.
> La tabla existe y está **vacía** desde la 123 (su R44). Esta feature la puebla.
>
> **Qué NO entrega:** el backfill histórico y toda recomputación de fechas pasadas (**125**), las
> consultas, el recorte por rol y la caché (**122 / 126 / 128**).
>
> **PUERTA T0 CERRADA el 2026-08-01.** Las nueve decisiones **D1–D9** están respondidas y viven en
> la sección siguiente con su respuesta, su porqué y su propagación. **Ya no queda ni un requisito
> «pendiente de D».** Si algún párrafo de `design.md` o de `tasks.md` contradijera esa sección,
> **manda esta sección**.

---

## T0 — PUERTA CERRADA (D1–D9)

> Cuatro las respondió el humano (D1, D2, D3+D8, D7); cinco las cerró el leader (D4, D5, D6, D9, y
> D8 absorbida por D3). Se conservan aquí con su respuesta y su propagación, porque la lección
> escrita en este repo es literal: *«gate aprobado en la bitácora no es lo mismo que las preguntas
> del spec respondidas por escrito»*. Las opciones descartadas y su coste siguen en `design.md`
> (§6, §8, §9, §10, §11): aquí queda lo decidido.

### D1 (humano) — **A2: se congela SOLO `estatus_id`. La reproducibilidad es PARCIAL y se declara.**

`estatus_id` se deriva de `orden_historial_estado`: la última transición con
`created_at < inicioDelDiaSiguienteCREnUtc(D)`. Esa tabla es **append-only e inmutable** (49/R2),
así que esa coordenada es reproducible **para siempre**, y con ella el embudo y el estatus de todas
las filas. `zona_id`, `tienda_id` y `mensajero_id` **NO se congelan**: se leen de la orden en el
momento de la corrida.

**La rebaja, dicha con todas las letras y sin esconderla:** R35 de la 123 vende «inmutabilidad hacia
atrás» y su `design.md §6` le regala a la 128 que «lo calculado una vez sigue valiendo». **Eso solo
es cierto en la dimensión `estatus`.** Una reasignación de mensajero, un cambio de zona o de tienda
posterior al día D hacen que un recomputo de D por la 125 **produzca coordenadas distintas de las
que escribió la 124**. No es un defecto latente: es el comportamiento acordado, y por eso **R49 lo
fija con un test que lo caracteriza** en vez de dejarlo como prosa. Avisos dirigidos a la **125** y
a la **128** en `design.md §13`.

Propagado a **R22, R23, R24, R27, R29, R49**, y al mapa de verificación de R33/R35 de la 123 (R44).

### D2 (humano) — **B2: el embudo son los estados NO terminales, más lo que llegó a terminal ESE día.**

`ordenes_estado_stock` cubre las órdenes cuyo estatus al corte **no** es terminal
(`ESTADOS_TERMINALES` = `entregada`, `devuelta_a_tienda`, `incidente`), **más** las órdenes que
llegaron a un estado terminal **durante el día D**. Se aparta a propósito de la lectura literal del
catálogo (`definicion.estados = ORDER_STATUS_SEED`), que haría que cada día re-fotografiara el
archivo entero de la historia: crecimiento cuadrático de una tabla cuya política de retención sigue
abierta (D5 de la 123).

**Consecuencia que hay que conocer:** para los tres estatus terminales, la columna se comporta como
un flujo del día (la orden aparece exactamente en la fecha en que cerró y desaparece al día
siguiente). **No se debe explotar esa coincidencia**: el histórico de terminales se sirve de las
medidas de flujo (`entregas`, `devoluciones`, `rechazos`, `incidentes`), que **sí** son aditivas, y
el tripwire de R29 de la 123 sigue vigente sobre la columna entera (R43). Aviso dirigido a la **126**
y a la **135** en `design.md §13`.

Propagado a **R11, R12, R43, R48**.

### D3 + D8 (humano) — **(i): solo el día cerrado D−1, una vez, a las 00:30 CR (06:30 UTC). R35 ESTRICTO.**

Una corrida diaria agrega **la fecha que acaba de cerrar**. El tablero de «hoy» **no tiene rollup**:
lo sirve la 126 consultando en vivo, que es justo lo que la distinción `clase: "snapshot"` vs.
consulta viva del catálogo contempla.

**R35 queda confirmado estricto** (esto es D8, absorbida aquí): el job diario **nunca** recomputa
fechas pasadas. Una gestión del día D anulada el D+3 deja el rollup por **exceso** en las medidas de
gestión de D, y el job **no lo corrige**: corregir es siempre un acto **deliberado** de la 125 sobre
un rango explícito. Aflojar esto en el job diario volvería el rollup no reproducible **y además
invisible**; la 125 es visible.

**Margen real contra el corte diario, verificado en `vercel.json`:** `/api/cron/corte-diario` y
`/api/cron/generar-gastos-fijos` corren a las `0 6 * * *` (06:00 UTC = 00:00 CR) y
`/api/cron/procesar-jobs` cada minuto. El rollup queda vencido a las 06:30 UTC y lo reclama el
drenador en el minuto siguiente: **30 minutos de margen contra el ARRANQUE del corte, no contra su
final**, que nadie ha medido. Bajo A2 ese margen **ya no afecta al estatus** —las transiciones
`corte_sin_gestionar` ocurren a las 00:00:00 CR del día D+1, es decir **en el instante exacto del
corte de D**, y la cota estricta `< corte` las deja fuera del cierre de D (R24)—, pero sí afecta a
las tres coordenadas no congeladas: cuanto antes corra, menos deriva acumulan. 00:30 es el punto de
equilibrio entre eso y no pisar al corte.

Propagado a **R5, R24, R35, R36, R39**.

### D4 (leader) — **C1: nuevo `job_tipo` recurrente en `JobQueueService`.**

Patrón `liberar_reprogramadas`: handler delgado + `RecurrenciaSpec` + registro en
`buildHandlers`/`buildRecurrencias` + script de siembra, con **`dedupe_key` por día CR**. C2 (cron
propio) se descarta porque **no tiene reintento**: un fallo transitorio de un minuto costaría el día
entero. C3 (dentro de `CorteDiarioService`) estaba descartada de origen: metería una agregación
analítica dentro de una transacción **money-critical**.

La migración del `ALTER TYPE "job_tipo" ADD VALUE` va **sola** en su carpeta: Postgres no permite
usar un valor de enum en la misma transacción que lo añadió (**55P04**). Precedente documentado en
el repo: los cuatro `job_tipo_*` previos y
`20260729140000_orden_historial_origen_deshacer_asignacion`.

Propagado a **R35, R36, R38, R39**.

### D5 (leader) — **(i): reconciliación DENTRO de la misma transacción.**

Para cada medida, la suma de las filas escritas de la fecha D debe ser **igual** al escalar
calculado por una consulta **independiente**; si no coincide, se aborta. Es lo que convierte R13 de
la 123 de promesa en invariante ejecutable —una fila de totalización repite valores ya presentes y
rompe la igualdad—, y de paso caza el doble conteo por `JOIN`, que es un fallo mucho más probable y
igual de silencioso. El coste (siete escalares por día, dentro de la tx) se acepta.

Propagado a **R33, R34**.

### D6 (leader) — **E1: los dos guardias de la 123 se RE-ALCANZAN, no se retiran.**

1. **Drift:** el conjunto de referencia pasa del **texto de `migration.sql` de la 123** a la **unión
   neta de las migraciones que tocan `analytics_daily`**, descubiertas por contenido.
2. **Frontera (R44 de la 123):** pasa de «nadie la nombra» a «**solo los módulos del escritor la
   escriben, y nadie la lee todavía**».

**Condición innegociable: cada uno con verificación por mutación en las DOS direcciones.** Tiene que
ponerse rojo si aparece drift de verdad, y tiene que ponerse rojo si alguien lee la tabla antes de
la 126. *Un guardia re-alcanzado que ya no se pone rojo por nada es peor que uno retirado, porque
miente.*

Propagado a **R40, R41, R42, R43**.

### D7 (humano) — **Las órdenes con `deleted_at` quedan FUERA de todas las medidas.**

Flujos y stock. Coherente con el resto del sistema (`OrdenRepository.findById` ya las excluye).

**El coste, escrito y no escondido:** el rollup pasa a depender de un campo **mutable hacia atrás**.
Una orden borrada hoy **desaparece del pasado** en cuanto la 125 recompute la fecha en que estuvo
viva, aunque ese día existiera y contara. Esto **agrava la grieta de D1**: a las tres coordenadas no
congeladas se suma una cuarta vía de irreproducibilidad, esta vez sobre el propio **conjunto de
filas** y no solo sobre sus coordenadas. Va en el aviso a la **125** y a la **128**
(`design.md §13`) y tiene su caso de caracterización (R49c).

Propagado a **R10, R11, R13, R49**.

### D8 (humano) — **Absorbida por D3: R35 estricto.** Ver arriba.

### D9 (leader) — **Transacción única por fecha, sin lotes, y sin topes inventados.**

**No se aprueban lotes.** Partir la escritura abriría una ventana con la fecha **a medias** en la
tabla, y R30 vale más que la latencia. No hay dato de volumen en el repo (consecuencia de D5 de la
123) y **no se inventa ninguno**: nada de topes numéricos sacados del aire. En su lugar, el job
**registra siempre** filas escritas, filas retiradas y duración en milisegundos, para que la 125
fije los umbrales con **medición real**. La constante del aviso vive en **un solo sitio**, con un
comentario que dice explícitamente que es **provisional y no está medida**.

Propagado a **R30, R47, R48**.

---

## Glosario mínimo (hereda el de la 123)

- **Ventana del día D**: `[inicioDelDiaCREnUtc(D), inicioDelDiaSiguienteCREnUtc(D))`, es decir
  `[D T06:00:00.000Z, D+1 T06:00:00.000Z)`. Semiabierta.
- **Corte del día D**: el instante `inicioDelDiaSiguienteCREnUtc(D)`, cota superior **estricta**.
- **Cubo**: una combinación concreta de las seis coordenadas del grano.
- **Medida de orden**: `ordenes_creadas`, `ordenes_estado_stock`, `seg_ciclo_acum`, `seg_ciclo_n`.
- **Medida de gestión**: `entregas`, `devoluciones`, `rechazos`, `reprogramaciones`, `incidentes`,
  `primer_intento_ok`.
- **Corrida**: una ejecución del job para **una** fecha.
- **Coordenada congelada**: la que se deriva de una tabla append-only y por tanto se reproduce.
  Tras D1 hay **exactamente una**: `estatus_id`.

---

## Requisitos

> Cada requisito lleva **«Mutación»**: el cambio concreto que lo pone rojo. Un requisito sin
> mutación creíble está mal escrito y no debe entrar en esta lista. Las mutaciones se revisaron
> **después** de cerrar T0: las que D1→A2 o D7→excluir dejaron sin sentido están reescritas.

### Frontera de la feature

**R1.** El sistema DEBE proveer un agregador que, dada **una** fecha calendario de Costa Rica,
escriba en `analytics_daily` las filas de esa fecha derivadas de `orden`, `gestion_orden` y
`orden_historial_estado`.
*Mutación: dejar el agregador sin llamada de escritura → la tabla sigue vacía tras la corrida → rojo.*

**R2.** El sistema NO DEBE alterar el grano ni el conjunto de medidas que fija la 123 (6 columnas de
grano + 10 medidas): esta feature **puebla**, no redefine.
*Mutación: añadir una columna de medida → `analytics-daily-contrato.test.ts` (R45 de la 123) rojo.*

**R3.** El sistema NO DEBE exponer ninguna consulta, Server Action, endpoint ni componente que
**lea** el rollup para presentarlo (eso es 122/126/128). Las únicas lecturas permitidas son las dos
internas del propio job: la reconciliación (R34) y el barrido de filas rancias (R29).
*Mutación: añadir `prisma.analyticsDaily.findMany` en un loader de página → guard de frontera rojo.*

**R4.** El job DEBE ser de **solo lectura** sobre el dominio: NO DEBE escribir, actualizar ni borrar
ninguna fila de `orden`, `gestion_orden`, `orden_historial_estado`, `cierre_dia`, `cierre_detail`
ni de ninguna tabla de dinero.
*Mutación: introducir un `UPDATE` sobre `orden` en el agregador → guard de escritura rojo.*

### El día que recomputa

**R5.** Cada corrida programada DEBE agregar **la fecha calendario CR que acaba de cerrar** (el día
anterior al de la corrida), y sus cotas DEBEN ser exactamente
`[inicioDelDiaCREnUtc(fecha), inicioDelDiaSiguienteCREnUtc(fecha))` de `lib/utils/fecha-cr.ts`.
*Mutación: cambiar la cota inferior por `startOfDayCR` → la orden creada a las 20:00 CR del día
anterior entra en la fecha equivocada → rojo. Segunda mutación: hacer que la corrida de las 00:30 CR
agregue el día en curso → la fecha objetivo del test con reloj congelado deja de ser D−1 → rojo.*

**R6.** El sistema NO DEBE usar la ventana 18:00–18:00 de `RankingService` ni `startOfDayCR` como
cota contra columnas `timestamp`, y NO DEBE reimplementar aritmética de zona horaria propia.
*Mutación: importar `startOfDayCR` en el agregador → guard de importaciones rojo.*

**R7.** CUANDO una orden se crea a las **23:59:59 CR** del día D, el sistema DEBE contarla en
`ordenes_creadas` de la fila de fecha **D**; y CUANDO se crea a las **00:00:00 CR** del día D+1,
en la fila de fecha **D+1**.
*Mutación: usar `<=` en la cota superior o desplazar 6 h → una de las dos órdenes cambia de día → rojo.*

**R8.** El reloj DEBE ser **inyectable** (`now: () => Date`) y la fecha objetivo DEBE poder pasarse
de forma explícita. NO DEBE existir ningún `new Date()` ni `Date.now()` no inyectado en la ruta de
cálculo.
*Mutación: fijar `new Date()` dentro del agregador → el test que congela el reloj deja de controlar
la fecha y falla.*

**R9.** El resultado NO DEBE depender de la variable de entorno `TZ` del proceso.
*Mutación: derivar la fecha con `toLocaleDateString` sin `timeZone` → el test que corre con `TZ`
distinto de UTC produce otra fecha → rojo.*

### Derivación de las medidas

**R10.** `ordenes_creadas` DEBE contar las **órdenes** cuyo instante de creación cae en la ventana
del día y cuyo `deleted_at` es nulo, una sola vez cada una, atribuidas a sus propias coordenadas
(R22–R24).
*Mutación: contar transiciones del historial en vez de órdenes → una orden con dos transiciones el
mismo día se cuenta dos veces → rojo. Segunda mutación: quitar el filtro de `deleted_at` → la orden
borrada del caso de prueba suma → rojo (D7).*

**R11.** `ordenes_estado_stock` DEBE ser el **stock al corte** del día sobre este universo: órdenes
**no borradas** cuyo estatus al corte **no** es terminal, **más** las órdenes que llegaron a un
estado de `ESTADOS_TERMINALES` **durante ese mismo día**. Cada orden del universo aporta
**exactamente 1** a la fila de su estatus al corte, y **0** a cualquier otra.
*Mutación: incluir las órdenes que ya estaban en un terminal desde días anteriores → el stock del
día crece con el archivo histórico y el caso «orden entregada hace tres días» reaparece → rojo (D2).
Segunda mutación: excluir también las que cerraron hoy → el día de su cierre la orden no aparece en
ningún estatus y desaparece del embudo sin dejar rastro → rojo.*

**R12.** CUANDO una orden cambia de estatus **dos veces** dentro del mismo día D, el sistema DEBE
aportar 1 a `ordenes_estado_stock` de la fila del estatus **de cierre** y 0 a los intermedios.
*Mutación: tomar la **primera** transición del día en vez de la última → la orden aparece en el
estatus intermedio → rojo. Mutación de determinismo: quitar el desempate cuando dos transiciones
comparten `created_at` → dos corridas seguidas escriben estatus distintos y la idempotencia de R27
cae → rojo.*

**R13.** Las cinco medidas de gestión (`entregas`, `devoluciones`, `rechazos`, `reprogramaciones`,
`incidentes`) DEBEN contar **gestiones vigentes** (`gestion_orden.anulada_at IS NULL`) **de órdenes
no borradas**, cuyo `created_at` cae en la ventana del día, clasificadas por `resultado`.
*Mutación: quitar el filtro de `anulada_at` → la gestión anulada del caso de prueba suma → rojo.
Segunda mutación: quitar el filtro de `deleted_at` de la orden → la gestión de la orden borrada suma
→ rojo (D7).*

**R14.** SI una gestión del día D fue anulada **antes** de la corrida, ENTONCES el sistema NO DEBE
contarla en ninguna medida de gestión de D.
*Mutación: como R13; el caso de prueba tiene una gestión `entregada` anulada el mismo día.*

**R15.** La coordenada `causa_devolucion` DEBE informarse **solo** en las filas que cuentan
gestiones `devuelta`; en cualquier otra fila DEBE ser `NULL`. Una gestión `devuelta` **sin** causa
tipificada DEBE producir `NULL`, nunca un valor inventado ni un cubo «otro».
*Mutación: propagar la causa a la fila de `entregas` del mismo mensajero → aparecen dos filas donde
debía haber una y la del grano con causa no nula tiene `entregas > 0` → rojo.*

**R16.** El sistema DEBE materializar `incidentes` (cuarto término de `DENOMINADOR_GESTIONES`), y NO
DEBE materializar ninguna medida para `sin_gestionar`, que se deriva del embudo.
*Mutación: dejar `incidentes` siempre en 0 → el caso con una gestión `incidente` da 0 → rojo.*

**R17.** `primer_intento_ok` DEBE contar las gestiones vigentes de resultado `entregada` del día
cuyo **conteo de intentos previos vigentes es 0**, según el criterio **único ya existente en el
repo** (`intentos_vigentes_historial`, `OrdenHistorialService.contarIntentos`, feature 160), y DEBE
atribuirlas a las **mismas seis coordenadas** que su entrega.
*Mutación: reimplementar el criterio contando cualquier transición a `devuelta` (incluidas las de
gestiones anuladas) → la entrega tras una devolución anulada deja de contar como primer intento → rojo.*

**R18.** Para toda fila escrita DEBE cumplirse `primer_intento_ok <= entregas`.
*Mutación: contar en `primer_intento_ok` entregas atribuidas a otro cubo → la base rechaza con
`analytics_daily_pio_lte_entregas` y la transacción falla → rojo (el test comprueba el rechazo real,
con su nombre de constraint capturado del error, no inferido).*

**R19.** Una orden que llega a un **estado terminal** (`entregada`, `devuelta_a_tienda`,
`incidente`) durante el día D DEBE aportar `seg_ciclo_n = 1` y `seg_ciclo_acum =` segundos entre
`orden.created_at` y el instante de esa transición terminal, en la fila de fecha **D**, y **nunca**
en la de su creación. Una misma orden DEBE aportar **como máximo una vez** en la misma fecha.
*Mutación: atribuirlo a la fecha de creación → la orden creada el D−5 y entregada el D suma en la
fila del D−5 → rojo por doble motivo (fila de otra fecha, prohibida por R35). Segunda mutación:
contar las dos transiciones del caso «entra a terminal, se revierte y vuelve el mismo día» → `n = 2`
→ rojo.*

**R20.** El sistema NO DEBE escribir nunca una fila con `seg_ciclo_n = 0` y `seg_ciclo_acum > 0`.
*Mutación: acumular segundos sin incrementar el denominador → la base rechaza con
`analytics_daily_ciclo_coherente` → rojo.*

**R21.** El sistema NO DEBE calcular ni escribir tasas, promedios ni porcentajes: solo los
componentes aditivos de las diez medidas.
*Mutación: escribir `entregas` como fracción → los conteos dejan de ser enteros y la reconciliación
de R34 falla.*

### Coordenadas (los contratos que la 123 dejó solo en comentarios)

**R22.** `zona_id` y `tienda_id` de **toda** fila DEBEN provenir de la **orden** (`orden.zona_id`,
`orden.tienda_id`), incluidas las filas de medidas de gestión. NUNCA de la zona del usuario que
gestionó. Ninguna de las dos se congela (D1→A2): se leen en la corrida, con la consecuencia que fija
**R49b**.
*Mutación: usar `usuario.zona_id` del mensajero → el caso «orden de la zona A gestionada por un
mensajero de la zona B» escribe la zona B → rojo.*

**R23.** `mensajero_id` DEBE ser `orden.mensajero_asignado_id` en las medidas de orden (nullable ⇒
cubo sin asignar) y `gestion_orden.mensajero_id` en las medidas de gestión. Tampoco se congela
(D1→A2); ver **R49b**.
*Mutación: usar la misma fuente para ambas familias → el caso «orden desasignada después de una
gestión» funde dos filas en una → rojo.*

**R24.** `estatus_id` DEBE ser el estado de la orden **en el corte del día**, derivado de
`orden_historial_estado` como la **última** transición con
`created_at < inicioDelDiaSiguienteCREnUtc(fecha)` —cota **estricta**—, con desempate determinista
cuando dos transiciones comparten instante. NO DEBE leerse de `orden.estatus_id`.
*Mutación: leer `orden.estatus_id` en vivo → el caso «la orden se mueve después del corte» escribe
el estatus nuevo → rojo. Segunda mutación, la que discrimina la cota: cambiar `<` por `<=` → la
transición `corte_sin_gestionar` de las 00:00:00 CR del día D+1 (instante exacto del corte de D)
entra en el cierre de D y cambia el embudo → rojo.*

**R25.** CUANDO una orden no tenga mensajero asignado, el sistema DEBE escribir su fila con
`mensajero_id = NULL`, y NUNCA con un valor centinela ni descartando la orden.
*Mutación: filtrar `mensajero_asignado_id IS NOT NULL` → las órdenes sin asignar desaparecen y la
reconciliación de R34 falla; mutación alternativa: escribir el literal `'sin_asignar'` → la FK a
`usuario` rechaza la fila.*

**R26.** Toda coordenada escrita DEBE proceder de un `GROUP BY` sobre datos reales y satisfacer las
cuatro claves foráneas; el módulo escritor NO DEBE contener **ningún literal** de `zona_id`,
`tienda_id`, `mensajero_id` ni `estatus_id`.
*Mutación: introducir un id literal en el escritor → guard estático rojo.*

### Idempotencia, atomicidad y filas rancias

**R27.** CUANDO el job se ejecute **dos veces** sobre la misma fecha sin que cambien los datos de
origen, el estado final de `analytics_daily` DEBE ser el mismo: mismo conjunto de filas, mismas
medidas, mismo `created_at` por fila; solo `updated_at` puede avanzar.
*Mutación: sustituir el upsert por un insert → segunda corrida duplica filas (o revienta con
`analytics_daily_grano_key`) → rojo.*

**R28.** El upsert DEBE resolver el conflicto contra el índice único del grano
(`analytics_daily_grano_key`, `NULLS NOT DISTINCT`), de modo que los cubos con `mensajero_id` o
`causa_devolucion` nulos también deduplique.
*Mutación: hacer el upsert por `(fecha, zona_id, tienda_id, estatus_id)` → las filas del cubo sin
asignar se duplican en la segunda corrida → rojo.*

**R29.** El recomputo de la fecha D DEBE dejar la tabla **como si D se hubiera calculado desde
cero**: SI un cubo que existía en una corrida anterior ya no se produce, ENTONCES su fila DEBE
desaparecer al terminar la corrida.
*Mutación: quedarse solo con el upsert → tras anular la única gestión de un cubo y recomputar, la
fila rancia sobrevive con su valor viejo → rojo. Es el fallo silencioso más probable de esta feature.*

**R30.** La escritura de una fecha DEBE ser **todo-o-nada** en **una sola transacción**, sin lotes
(D9): SI la corrida falla a mitad, ENTONCES `analytics_daily` DEBE quedar exactamente como estaba
antes de empezar.
*Mutación: sacar la escritura de la transacción, o partirla en dos commits, y lanzar un error a
mitad → quedan filas parciales de esa fecha → rojo.*

**R31.** MIENTRAS dos corridas de la misma fecha se solapen, el sistema NO DEBE duplicar filas ni
terminar con una violación de unicidad sin manejar.
*Mutación: eliminar el `ON CONFLICT` → la corrida solapada muere con 23505 → rojo.*

**R32.** El job NO DEBE serializar `seg_ciclo_acum` (`BigInt`) a JSON ni a un log sin convertirlo
previamente.
*Mutación: incluir el `BigInt` crudo en el resumen de la corrida → `JSON.stringify` lanza
`TypeError` → rojo.*

### Contención de R13 de la 123 (pagaré (b), cerrado por D5)

**R33.** El sistema NO DEBE escribir **filas de totalización**: ninguna fila puede usar una zona,
una tienda, un mensajero o un estatus **reales** con el significado de «todos». Toda fila DEBE
corresponder a un grupo realmente presente en los datos de origen.
*Mutación: emitir una fila extra con la primera zona y la suma del día → la reconciliación de R34
la caza y aborta → rojo.*

**R34.** CUANDO, dentro de la misma transacción, la suma de una medida sobre las filas escritas de
la fecha D no coincida con el total escalar de esa medida calculado por una consulta independiente
sobre las tablas vivas, el sistema DEBE **abortar la transacción** y fallar con un error que nombre
la medida y la fecha.
*Mutación: duplicar el conteo de una medida (por ejemplo, un `JOIN` que multiplica filas) → la
reconciliación falla y la fecha no se escribe → rojo. Esta es la aserción que convierte R13 de la
123 en cobertura real.*

### Programación, operación y observabilidad

**R35.** MIENTRAS el job diario esté en operación, cada corrida DEBE escribir filas de **una sola
fecha** y NUNCA DEBE crear ni modificar filas de otra fecha. El único escritor autorizado a
recomputar fechas pasadas sigue siendo el backfill de la 125, invocado deliberadamente sobre un
rango explícito (D3/D8: R35 de la 123 confirmado **estricto**).
*Mutación: ampliar la ventana a dos días → con datos sembrados en D−1, D y D+1, la corrida de D
toca filas de D−1 → rojo (el test compara `updated_at` de las filas vecinas antes y después).*

**R36.** La corrida DEBE ejecutarse como un **job recurrente de `JobQueueService`** (D4) con
`dedupe_key` por día CR, DEBE poder reintentarse tras un fallo sin producir efectos duplicados
(consecuencia de R27 + R30) y su reintento DEBE estar gobernado por el backoff y el dead-letter
existentes, **sin detener la recurrencia**.
*Mutación: registrar el job sin recurrencia → tras un fallo terminal no se re-agenda la siguiente
ocurrencia → rojo en el test de registro. Segunda mutación: usar la fecha de la corrida en vez de la
fecha objetivo como `dedupe_key` → dos siembras del mismo objetivo dejan dos filas en `jobs` → rojo.*

**R37.** El job NO DEBE registrar PII ni secretos. Su salida observable DEBEN ser **conteos
agregados**: fecha agregada, filas escritas, filas retiradas y duración en milisegundos.
*Mutación: loguear un `destinatario`, un `telefono_dest` o una lista de ids → guard de PII en logs rojo.*

**R38.** SI la corrida falla, ENTONCES el error DEBE propagarse con contexto (fecha objetivo y etapa
que falló) y sin filtrar datos de dominio; NO DEBE tragarse con un `catch` vacío.
*Mutación: envolver el agregador en `try {} catch {}` → el test que fuerza un fallo del repositorio
espera excepción y recibe éxito → rojo.*

**R39.** La invocación manual DEBE admitir **solo** la fecha del día en curso y la del día anterior;
SI se pide una fecha más antigua, ENTONCES el sistema DEBE rechazarla remitiendo al backfill de la
125.
*Mutación: aceptar cualquier fecha → el test que pide `hoy − 10 días` obtiene una escritura en vez
de un rechazo → rojo. Este requisito es lo que impide que la 124 se convierta en la 125 por la
puerta de atrás, que es exactamente lo que R35 estricto prohíbe.*

### Deuda de verificación heredada de la 123 (pagarés (a) y (c), cerrados por D6)

**R40.** El guardia de drift datamodel↔migración DEBE comparar el datamodel contra la **unión de las
migraciones que tocan `analytics_daily`** (todas las carpetas de `db/migrations/` cuyo
`migration.sql` opera sobre la tabla, descubiertas **por contenido**, aplicadas en orden de nombre y
descontando lo que una migración posterior elimine o renombre), NO contra el texto de una migración
concreta.
*Mutación doble, y las dos tienen que observarse: (a) añadir una migración legítima que cree un
objeto nuevo sobre la tabla **y** declararlo en `schema.prisma` → el guardia sigue **verde** (con el
conjunto de referencia viejo se pondría rojo sin drift: ese es el defecto que se arregla); (b) la
misma migración **sin** declararlo en el datamodel → **rojo**.*

**R41.** El guardia de drift NO DEBE contener el número de objetos esperados como literal: DEBE
derivarlo del conjunto de referencia, conservando la red anti-vacío (si la extracción no encuentra
objetos, el test falla en vez de pasar por vacío).
*Mutación: vaciar el extractor → el test debe fallar por «no mide nada», no pasar.*

**R42.** El guardia de frontera de la 123 (R44: «la tabla nace sin consumidores») DEBE re-alcanzarse
a «**solo los módulos declarados del escritor la escriben, y nadie la lee todavía**»: cualquier
lectura del rollup fuera de las dos internas del job (R3) y cualquier segundo escritor no declarado
DEBEN ponerlo rojo.
*Mutación en las dos direcciones (D6, condición innegociable): (a) `prisma.analyticsDaily.findMany`
en un archivo cualquiera → **rojo**; (b) `upsert` sobre la tabla en un archivo fuera de la lista →
**rojo**; (c) el escritor legítimo tal cual queda → **verde**. Si (a) o (b) no se observan en rojo,
el guardia miente y el cambio se revierte.*

**R43.** El tripwire de suma de `ordenes_estado_stock` entre fechas (R29 de la 123) DEBE seguir
discriminando y NO DEBE dispararse por el código del escritor, que **escribe** la columna pero no la
suma entre fechas. Sigue vigente sobre la columna **entera**, también para los tres estatus
terminales, pese a que bajo D2 esos se comporten como flujo del día.
*Mutación doble: (a) introducir en `lib/` una agregación real de la columna sobre un rango → rojo;
(b) el escritor legítimo → verde. Si solo se comprueba (b), el guardia está aflojado. Las tres
cadenas malas sintéticas que el archivo ya trae tienen que seguir saliendo rojas.*

**R44.** El sistema DEBE convertir en **aserciones sobre datos agregados reales** **once** de los
doce requisitos de la 123 que hoy solo verifica una regex sobre el texto del SQL: **R11, R12, R13,
R24, R28, R31, R32, R33, R34, R35 y R36**. El duodécimo, **R15 de la 123** (que el `apply` falle si
el motor no soporta `NULLS NOT DISTINCT`), **NO es falsable desde esta feature** —es una propiedad
del despliegue y no del job— y se declara explícitamente como **texto**. Cuenta final que debe
leerse de un vistazo en la bitácora: **11 medidos, 1 texto**.
*Mutación: el mapa de trazabilidad de `progress/impl_124.md` debe nombrar, por cada uno de los once,
el test de esta feature que lo mide; un mapeo a un test de regex sobre SQL se rechaza en revisión.*

### Casos borde y volumen

**R45.** SI en la base existe una orden con un estatus **huérfano** del catálogo (caso documentado
`en_fulfillment`), ENTONCES la corrida DEBE completarse y esa orden DEBE aparecer en su cubo, no
descartarse ni hacer fallar el job.
*Mutación: filtrar por la lista cerrada `ORDER_STATUS_SEED` → la orden huérfana desaparece del
rollup y la reconciliación de R34 falla → rojo.*

**R46.** CUANDO el día objetivo no tenga ninguna orden ni gestión, la corrida DEBE terminar con
éxito escribiendo **cero** filas: NO DEBE fallar ni escribir una fila con todas las medidas a cero.
*Mutación: escribir siempre una fila «vacía» → el test del día sin datos ve 1 fila → rojo.*

**R47.** La corrida DEBE registrar **siempre** filas escritas, filas retiradas y duración en
milisegundos, para que la 125 fije los umbrales con medición real (D9). El umbral de aviso DEBE
vivir en **una sola constante**, con un comentario que declare que es **provisional y no está
medida**; NO DEBE haber ninguna otra cifra de volumen dispersa en el código.
*Mutación: emitir el resumen sin `ms` o sin el conteo de retiradas → el test del resumen falla.
Segunda mutación: duplicar la cifra del umbral en otro archivo → guard de constante única rojo.*

**R48.** Toda consulta del agregador DEBE estar acotada por la ventana del día, por el corte en el
caso del estatus, o por el universo no terminal que fija D2; NINGUNA DEBE recorrer `orden` o
`gestion_orden` sin acotación.
*Mutación: quitar la cota de `created_at` de la consulta de gestiones → las gestiones de otros días
entran en la fila del día objetivo → rojo. Segunda mutación: quitar la cota del universo del stock →
el archivo histórico entero entra y el conteo del día explota → rojo.*

### La reproducibilidad parcial, fijada por test (D1→A2 + D7)

**R49.** El sistema DEBE **caracterizar por test** el alcance exacto de su reproducibilidad, de modo
que cualquier cambio futuro en ella exija una decisión y no pase inadvertido:

- **(a)** CUANDO la fecha D se recompute después de que una orden haya cambiado de estatus, el
  `estatus_id` escrito DEBE ser **el mismo** que en la primera corrida (coordenada congelada).
- **(b)** CUANDO la fecha D se recompute después de una **reasignación de mensajero**, un cambio de
  **zona** o de **tienda**, las coordenadas escritas DEBEN ser las **nuevas**: el recomputo **no
  reproduce** la fila original, y ese comportamiento queda fijado como el acordado, no como un bug
  latente.
- **(c)** CUANDO la fecha D se recompute después de que una orden se haya **borrado**
  (`deleted_at`), sus contribuciones DEBEN desaparecer del pasado (D7).

*Mutación: si alguien congelara `mensajero_id` sin decidirlo, (b) se pone rojo y obliga a reabrir
D1; si alguien dejara de congelar `estatus_id`, (a) se pone rojo; si alguien dejara de excluir las
borradas, (c) se pone rojo. Este test es lo que impide que la rebaja de R35 de la 123 se mueva en
silencio en cualquiera de las dos direcciones.*

---

## Fuera de alcance (declarado)

- **El backfill histórico y cualquier recomputación de fechas pasadas: feature 125** (R35, R39).
- **Las consultas, el recorte por rol y la caché: 122 / 126 / 128.** Esta feature no lee el rollup
  para presentarlo (R3).
- **El tablero de «hoy»**: bajo D3 no tiene rollup; lo sirve la 126 consultando en vivo.
- **Cualquier medida financiera** (las 9 métricas `clase: "live"`): el dinero se lee de ledgers y
  cierres, nunca se recalcula desde órdenes.
- **Retención y purga de `analytics_daily`**: sigue siendo el follow-up abierto de **D5 de la 123**.
  Esta feature lo agrava (empieza a escribir) y aporta la **medición** que le faltaba (R47), pero no
  lo decide.
- **Los umbrales de volumen**: los fija la 125 con los datos que R47 produzca. Aquí no se inventa
  ninguna cifra (D9).
- **El saneamiento de la ventana 18:00–18:00 de `RankingService`**: ficha **166**, ajena.
- **E2E:** no aplica. `CHECKPOINTS.md` lo exige para flujos críticos de usuario en ejecución; este
  job no tiene camino de usuario. El riesgo que cubriría —que el job no escriba lo que dice— se
  cubre por una vía más fuerte: los casos con datos sembrados contra el Postgres **local** y la
  reconciliación de R34.

---

## Preguntas abiertas

**Ninguna.** La puerta T0 se cerró el 2026-08-01 con las nueve decisiones de arriba, todas con
respuesta escrita y propagada. Lo que queda **abierto pero fuera de alcance** está nombrado en la
sección anterior: la retención de la tabla (D5 de la 123) y los umbrales de volumen, que dependen de
la medición que esta feature empieza a producir (R47).
