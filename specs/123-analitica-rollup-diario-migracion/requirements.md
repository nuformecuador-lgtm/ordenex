# Feature 123 — analítica: migración del rollup diario `analytics_daily` · requirements

> **Zona:** backend. **`depends_on`: 135** (`specs/135-analitica-catalogo-kpis-rangos/`,
> `lib/analytics/types.ts`, `lib/analytics/metrics.ts`). El texto de la ficha dice «Depende de
> 120»: es basura de una renumeración del clado de analítica; manda `depends_on`.
>
> **Frontera dura:** SOLO el DDL. Se entrega `migration.sql` + `down.sql` + el modelo Prisma.
> **El job que puebla la tabla es la 124** y el backfill la **125**. Esta feature no escribe una
> sola fila.
>
> **PUERTA T0 CERRADA el 2026-07-30.** Las ocho preguntas abiertas están respondidas por el humano
> y sus respuestas viven en **§ Decisiones del humano (2026-07-30)**, al final de este archivo, y
> propagadas a los requisitos que tocan. Nada aquí sigue «pendiente de Q»: si algún párrafo de
> `design.md` o de `tasks.md` contradijera esas decisiones, **manda esta sección**.
>
> **La ficha es ANTERIOR a la 135.** Donde se contradigan, manda el catálogo real
> (`lib/analytics/metrics.ts`); la reconciliación está en `design.md §2`.

## Glosario mínimo

- **Grano**: la tupla de columnas dimensionales que identifica una fila del rollup.
- **Medida**: columna numérica agregada de una fila.
- **Métrica snapshot**: entrada de `METRICAS` con `clase: "snapshot"`. Por el invariante R5 de la
  135, equivale a `fuente.tipo === "rollup"`.
- **Métrica live**: entrada con `clase: "live"`; su fuente son tablas vivas, ledgers o cierres.
- **Corte del día**: el instante que cierra el día natural de Costa Rica (D6 de la 135).
- **Flujo**: medida que cuenta hechos ocurridos ESE día. Aditiva en todas las dimensiones,
  incluida `fecha`.
- **Stock**: medida que fotografía un estado AL corte de ese día. Aditiva en todas las dimensiones
  **salvo `fecha`**.

---

## Requisitos

### Existencia y forma de la tabla

**R1.** El sistema DEBE crear, mediante una migración Prisma versionada bajo `db/migrations/`, la
tabla `analytics_daily` con su modelo Prisma correspondiente en `db/schema.prisma`.

**R2.** El grano de `analytics_daily` DEBE ser exactamente
`(fecha, zona_id, tienda_id, mensajero_id, estatus_id, causa_devolucion)`, que es la **unión de
los `granos` declarados por las métricas `clase: "snapshot"`** del catálogo de
`lib/analytics/metrics.ts`.

**R3.** El sistema NO DEBE incluir ninguna columna para la dimensión `metodo_pago` de
`DIMENSIONES`, porque la única métrica que la declara (`cod_recaudado`) es `clase: "live"` con
fuente `snapshot_cierre`/`ledger`.

**R4.** El sistema NO DEBE materializar ninguna medida perteneciente a una métrica `clase: "live"`
del catálogo (las 8 financieras y `aging_por_estado`).

**R5.** `analytics_daily` NO DEBE tener columnas monetarias. DONDE en el futuro se añadiera una
medida monetaria a esta tabla, esa columna DEBE ser `DECIMAL(12,2)` y NUNCA un tipo de coma
flotante.

**R6.** La columna `fecha` DEBE ser de tipo `DATE` (`@db.Date` en Prisma), `NOT NULL`, y DEBE
representar la **fecha calendario de Costa Rica** del día agregado, nunca un instante.

**R7.** `analytics_daily` DEBE tener una clave primaria sustituta `id` de tipo `TEXT` con valor
`uuid` generado por Prisma, siguiendo el patrón del resto del esquema.

**R8.** `analytics_daily` DEBE tener `created_at` (por defecto al instante de inserción) y
`updated_at` (`@updatedAt`), para que el upsert de la 124 y el backfill de la 125 dejen rastro de
la última recomputación.

**R9.** Todos los nombres de tabla y columna DEBEN ser `snake_case`, mapeados con `@@map`/`@map`
(`docs/conventions.md`). El nombre de la tabla DEBE ser literalmente `analytics_daily`, único valor
del tipo `TablaRollup` del contrato de la 135.

### Nulabilidad y unicidad del grano

**R10.** Las columnas `zona_id`, `tienda_id` y `estatus_id` DEBEN ser `NOT NULL`.

**R11.** La columna `mensajero_id` DEBE ser nullable, y `NULL` DEBE significar **exactamente**
«orden sin mensajero asignado» (cubo `MENSAJERO_SIN_ASIGNAR`, D5/R30 de la 135). `NULL` en esa
columna NUNCA DEBE significar «todos los mensajeros» ni «dimensión no aplica».

**R12.** La columna `causa_devolucion` DEBE ser nullable y de tipo enum
`gestion_causa_devolucion`, y `NULL` DEBE significar «la fila no tiene causa de devolución
tipificada».

**R13.** El sistema NO DEBE almacenar filas de totalización («todas las zonas», «todos los
mensajeros»): toda fila DEBE estar al grano fino de R2, y la agregación por dimensiones DEBE quedar
para la consulta del consumidor (feature 126).

**R14.** `analytics_daily` DEBE tener un índice ÚNICO sobre las seis columnas del grano de R2
declarado con `NULLS NOT DISTINCT`, de modo que dos filas que difieran solo por tener `NULL` en
`mensajero_id` o en `causa_devolucion` sean rechazadas por la base.

**R15.** SI el motor de la base de destino no soportara `NULLS NOT DISTINCT` (Postgres < 15),
ENTONCES la migración DEBE fallar en el `apply` en vez de crear un índice único que no deduplique.

### Medidas: solo componentes aditivos

**R16.** Las medidas de `analytics_daily` DEBEN ser exactamente estas diez columnas, todas
`NOT NULL DEFAULT 0`:
`ordenes_creadas`, `ordenes_estado_stock`, `entregas`, `devoluciones`, `rechazos`,
`reprogramaciones`, `incidentes`, `primer_intento_ok`, `seg_ciclo_acum`, `seg_ciclo_n`.

**R17.** `analytics_daily` NO DEBE contener ninguna columna que almacene un **porcentaje, una
tasa, un promedio o cualquier otro valor no aditivo ya calculado**. Las tres tasas del catálogo
(`tasa_entrega`, `tasa_devolucion`, `tasa_rechazo`), `primer_intento_ok` como porcentaje y
`tiempo_ciclo` como promedio DEBEN derivarse en la consulta a partir de las columnas de R16.

**R18.** El sistema DEBE materializar la medida `incidentes` aunque la métrica `incidentes` esté
declarada `estadoProduccion: "declarada"`, porque es el **cuarto término del denominador** de las
tres tasas `producida` del catálogo (`DENOMINADOR_GESTIONES`); sin ella las tres tasas serían
incorrectas por exceso.

**R19.** El sistema NO DEBE materializar una medida para la métrica `sin_gestionar`: es derivable
del embudo (`ordenes_estado_stock` de las filas cuyo `estatus_id` es el del value `sin_gestionar`
en el catálogo `order_status`). Una columna propia sería **dato duplicado que puede contradecir a
su origen**.

**R20.** El tiempo de ciclo DEBE almacenarse como el par numerador/denominador `seg_ciclo_acum`
(suma de segundos) y `seg_ciclo_n` (número de órdenes que aportaron a esa suma), y NUNCA como un
promedio.

**R21.** `seg_ciclo_acum` DEBE ser de tipo `BIGINT`, no `INTEGER`.

**R22.** SI `seg_ciclo_n` vale 0, ENTONCES `seg_ciclo_acum` DEBE valer 0, y la base DEBE
garantizarlo con un `CHECK`: nunca puede existir una fila con segundos acumulados y denominador
vacío.

**R23.** `primer_intento_ok` DEBE ser una medida **de conteo entero** (numerador) y NUNCA un
porcentaje ni una razón.

**R24.** El universo de `primer_intento_ok` DEBE ser un **subconjunto del de `entregas` de la misma
fila**: toda gestión contada en `primer_intento_ok` DEBE ser una gestión vigente de resultado
`entregada` con las mismas seis coordenadas de grano, contada también en `entregas`.

**R25.** La base DEBE impedir con un `CHECK` que `primer_intento_ok` supere a `entregas` en la
misma fila, de modo que la tasa derivada `primer_intento_ok / entregas` no pueda superar 1 en
ninguna agregación de filas.

**R26.** Todas las medidas de R16 DEBEN ser no negativas, garantizado por `CHECK` en la base.

**R27.** La medida `ordenes_creadas` DEBE ser un **flujo** (órdenes nacidas ese día), aditiva
también a lo largo de `fecha`. Existe porque el catálogo declara `ordenes_creadas` como métrica
propia e independiente (`clase: "snapshot"`, `fuente: rollup`, `granos: [fecha, zona, tienda]`,
`definicion.estados = ESTADOS_CREACION`), no como partición de otra medida.

**R28.** La medida del embudo DEBE llamarse `ordenes_estado_stock` y DEBE ser un **stock al corte
del día**: aditiva a lo largo de las dimensiones del grano, **NO aditiva a lo largo de `fecha`**.
El sufijo `_stock` es normativo: el nombre de la columna DEBE anunciar su no-aditividad temporal en
el punto de uso.

**R29.** El sistema DEBE impedir por diseño, y no por convención, que `ordenes_estado_stock` se
sume entre fechas. CUANDO cualquier archivo bajo `lib/` o `app/` agregue esa columna
(`SUM(`, `_sum`, `sum:`) sin acotar la consulta a una fecha única, el guard automático DEBE ponerse
en rojo.

**R30.** La migración DEBE dejar escrita en la propia base, mediante `COMMENT ON COLUMN`, la
semántica de las cuatro medidas delicadas (`ordenes_estado_stock` —incluida la frase de no sumar
por fecha—, `seg_ciclo_acum`, `seg_ciclo_n`, `primer_intento_ok`) y de las cinco columnas de grano
cuya semántica es contrato hacia la 124 (`zona_id`, `tienda_id`, `mensajero_id`, `estatus_id`,
`causa_devolucion`).

### Semántica de las coordenadas (contrato hacia la 124/125/126)

**R31.** Las coordenadas `zona_id` y `tienda_id` de toda fila DEBEN provenir de la **orden**
(`orden.zona_id`, `orden.tienda_id`), nunca de la zona del usuario que gestionó (D9/R34 de la 135).

**R32.** La coordenada `mensajero_id` DEBE ser, para las medidas derivadas de órdenes,
`orden.mensajero_asignado_id` (nullable ⇒ cubo sin asignar), y para las medidas derivadas de
gestiones, `gestion_orden.mensajero_id` (que es `NOT NULL` en el esquema y por tanto nunca produce
el cubo sin asignar).

**R33.** La coordenada `estatus_id` DEBE ser el estado de la orden **en el corte del día** de la
fila.

**R34.** Una orden DEBE aportar a `seg_ciclo_acum` y `seg_ciclo_n` en la **fecha de su evento
terminal** (el día en que llega a un estado terminal: `entregada`, `devuelta_a_tienda`,
`incidente`), nunca en la de su creación.

**R35.** El rollup DEBE ser **inmutable hacia atrás**: MIENTRAS el job diario de la 124 esté en
operación, solo DEBE escribir filas de la fecha que está agregando, y NUNCA DEBE reescribir filas
de fechas anteriores. El único escritor autorizado a recomputar fechas pasadas es el backfill de la
125, invocado deliberadamente sobre un rango explícito.

**R36.** SI en la base existe una fila huérfana del catálogo `order_status` (caso documentado
`en_fulfillment`), ENTONCES el esquema de `analytics_daily` DEBE tolerarla: la FK a `order_status`
NO DEBE impedir que aparezca como valor de `estatus_id`.

### Integridad referencial, seguridad y reversibilidad

**R37.** Las columnas `zona_id`, `tienda_id`, `mensajero_id` y `estatus_id` DEBEN tener clave
foránea con `ON DELETE RESTRICT ON UPDATE CASCADE`, apuntando respectivamente a `zona`, `usuario`,
`usuario` y `order_status`.

**R38.** `analytics_daily` DEBE tener Row Level Security **habilitada y sin policies** (acceso solo
por service role), patrón `orden` / `gestion_orden` / `notificacion`.

**R39.** `analytics_daily` DEBE tener exactamente estos cuatro índices, y ningún otro: el único del
grano (R14) y tres índices `(dimensión, fecha)` — `(tienda_id, fecha)`, `(mensajero_id, fecha)` y
`(zona_id, fecha)` — cada uno justificado por un recorte de rol concreto de la feature 122.

**R40.** El sistema NO DEBE crear índice alguno sobre `estatus_id` ni sobre `causa_devolucion` por
separado: son columnas de `GROUP BY` dentro de un rango ya acotado, no predicados de filtrado.

**R41.** La migración DEBE ser **puramente aditiva**: no DEBE alterar, renombrar ni eliminar
ninguna tabla, columna, enum, índice ni constraint preexistente, y NO DEBE mover datos (ni un
`INSERT`, ni un `UPDATE`, ni un `DELETE` de filas de negocio).

**R42.** La migración DEBE incluir un `down.sql` que revierta **exactamente** lo que hace
`migration.sql`, dejando el esquema en el estado previo (tabla, índices, FKs, CHECKs, comentarios y
RLS desaparecen; nada preexistente se toca).

**R43.** CUANDO se ejecute la secuencia UP → DOWN → UP contra el Postgres local
(`localhost:5432/ordenex`), el esquema resultante DEBE ser idéntico al de la primera aplicación y
el estado intermedio idéntico al de partida; la evidencia **medida** DEBE quedar registrada en
`progress/roundtrip_123_analytics_daily.md`. Este requisito **no se acepta como deuda declarada**.

**R44.** MIENTRAS esta feature esté en curso, `analytics_daily` DEBE quedar **vacía**: la feature no
DEBE incluir job, cron, servicio, repositorio, Server Action ni ruta que la lea o la escriba (eso es
la 124, la 125 y la 126).

**R45.** El sistema DEBE mantener un guard automático que, recorriendo `METRICAS` de
`lib/analytics/metrics.ts`, verifique que (a) toda dimensión declarada en los `granos` de una
métrica con `fuente.tipo === "rollup"` tiene columna en `analytics_daily`, y (b) ninguna dimensión
exclusiva de métricas `clase: "live"` la tiene. CUANDO alguien añada una métrica snapshot con un
grano nuevo, ese guard DEBE ponerse en rojo.

---

## Fuera de alcance (declarado)

- El job de agregación y su idempotencia: **feature 124**.
- El backfill histórico y toda recomputación de fechas pasadas: **feature 125** (R35).
- Las consultas, el recorte por rol y la caché: **features 122, 126, 128**.
- Cualquier columna de dinero: la analítica financiera lee ledgers y cierres directamente (R6 de la
  135).
- **Retención y política de purga de `analytics_daily`** (D5): fuera de alcance por decisión del
  humano. Follow-up escrito en `design.md §10`.
- **E2E:** no aplica. `CHECKPOINTS.md` exige E2E solo para features que tocan flujos críticos en
  ejecución (auth, pagos, recaudo, ingesta, webhooks); esta feature entrega DDL sin ningún camino
  de ejecución de usuario, y además rige la decisión humana del 2026-07-30 («no más e2e, pruebas
  básicas nada más»). El riesgo que un E2E cubriría —que la migración rompa al aplicarse— se cubre
  por una vía concreta y más fuerte: el round-trip real de R43.

---

## Decisiones del humano (2026-07-30) — puerta T0 CERRADA

> Las ocho preguntas abiertas de la versión anterior de este archivo están **respondidas**. Se
> conservan aquí con su respuesta y su propagación, porque la lección escrita en
> `progress/current.md` de este repo es literal: *«gate aprobado en la bitácora no es lo mismo que
> las preguntas del spec respondidas por escrito»*.

**D1 (Q1) — el denominador de `primer_intento_ok` es `entregas` del mismo grano. NO se añade
`primer_intento_n`.**
Propagado a **R23, R24, R25**. El precio que se compra al no tener denominador propio queda
declarado y cubierto: si numerador y denominador no contaran el mismo universo, la tasa podría
pasar de 100 %. Por eso R24 define el universo —todo lo contado en `primer_intento_ok` es una
gestión vigente `entregada` con **las mismas seis coordenadas**, luego contada también en
`entregas`— y R25 lo convierte en un `CHECK` de la base, no en un comentario. La contención es
estructural y **sobrevive a la agregación**: si `pio ≤ ent` fila a fila, entonces `Σpio ≤ Σent` en
cualquier subconjunto de filas, así que la tasa no puede superar 1 en ningún corte de la 126.

**D2 (Q2) — `ordenes_por_estado` es un STOCK al corte, no sumable por fecha. La partición
flujo/stock NO fue la decisión: `ordenes_creadas` sobrevive solo porque el catálogo la exige.**
Comprobado en `lib/analytics/metrics.ts`: `ordenes_creadas` **existe** como métrica propia e
independiente (id `ordenes_creadas`, `clase: "snapshot"`, `fuente: rollup`, `granos: [fecha, zona,
tienda]`, `definicion.estados = ESTADOS_CREACION`), distinta de `ordenes_por_estado`. Se queda por
esa razón y solo por esa (**R27**). La medida del embudo pasa a llamarse **`ordenes_estado_stock`**
(**R28**) y su no-aditividad temporal se impide en **tres capas** (**R28, R29, R30**), no por
convención: nombre que lo grita en el punto de uso, `COMMENT ON COLUMN` en la base y guard
automático que se pone en rojo si alguien la suma entre fechas. El mecanismo, y por qué no se sacó
a una tabla aparte, en `design.md §3.3`.

**D3 (Q3) — solo `incidentes` se materializa; `sin_gestionar` no.**
Propagado a **R18** y **R19**. `incidentes` entra porque es el cuarto término de
`DENOMINADOR_GESTIONES` y sin ella las tres tasas `producida` dan de más. `sin_gestionar` no entra
porque es derivable del embudo y **una columna propia sería dato duplicado que puede contradecir a
su origen**: dos números para el mismo hecho y ninguna forma de saber cuál miente. Dónde se deriva:
R19 y `design.md §3.4`.

**D4 (Q4) — el tiempo de ciclo se atribuye a la fecha del EVENTO TERMINAL.**
Propagado a **R34**, y su consecuencia buena elevada a invariante en **R35**: como ningún hecho se
atribuye a una fecha anterior a aquella en que ocurre, **el rollup es inmutable hacia atrás**. El
job de la 124 solo escribe el día que agrega y jamás reescribe días pasados; el único escritor de
fechas pasadas es el backfill de la 125, sobre un rango explícito. Consecuencia derivada que se
regala a la **128**: la invalidación de caché de un día pasado **no existe** — lo que se calculó una
vez sigue valiendo, y basta con invalidar el día en curso. La única tensión conocida con este
invariante (una gestión anulada días después cambiaría el pasado) está declarada, con su
mitigación, en `design.md §6`.

**D5 (Q5) — retención y volumen: FUERA DE ALCANCE, con follow-up escrito.**
Ni la política de retención ni el volumen esperado están en el repo, y esta feature no los inventa.
Consecuencia práctica: no se particiona por `fecha` (alternativa 8 de `design.md §7`), decisión
barata de revertir porque la tabla es **derivada y reconstruible** por la 125. Follow-up en
`design.md §10`.

**D6 (Q6) — `NULLS NOT DISTINCT` verificado en local; abierto solo para producción.**
La evidencia no es la versión declarada del servidor sino algo más directo: las **dos migraciones
del repo que ya usan `NULLS NOT DISTINCT`**
(`20260711190000_tarifa_zona_mensajero_zona_vehiculo_unique` y `20260727120000_notificacion`)
figuran como **APLICADAS** en `localhost:5432/ordenex`. Si el motor no lo admitiera, no lo estarían.
**R14/R15 quedan firmes en diseño.** Lo que sigue abierto es un **riesgo de despliegue**, no de
diseño: confirmar la versión del Postgres de producción antes de aplicar allí. Anotado en
`design.md §10`.

**D7 (Q7) — SÍ hay Postgres local: `.env` apunta a `localhost:5432/ordenex`, que NO es la base de
producción.**
Esto **corrige una premisa equivocada** de la versión anterior de este spec, que había dado por
buena la cabecera de `tests/integration/db/notificacion-migration.test.ts` («el `.env` de este repo
apunta a una base COMPARTIDA con produccion»). Esa afirmación **no describe este checkout**.
Consecuencia: **R43 es ejecutable y no se acepta como deuda declarada**. Aviso operativo: esa base
local tiene **drift** —2 migraciones sin aplicar y 1 aplicada que no está en el árbol local, porque
el checkout está en `ux`—, así que el round-trip exige sanearla antes (task **T8.0** de
`tasks.md`); sin ese saneo, `pnpm db:rollback` revertiría la migración equivocada.

**D8 (Q8) — resuelta:** la carpeta del spec se renombró a
`specs/123-analitica-rollup-diario-migracion/`, que es el `spec_path` de la ficha. El desajuste lo
causó una instrucción imprecisa del leader, no el contenido del spec. `feature_list.json` lo lleva
el leader; esta feature no lo toca.
