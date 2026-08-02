# Feature 123 — analítica: migración del rollup diario `analytics_daily` · design

> **Entrega:** una migración (`db/migrations/<ts>_analytics_daily/migration.sql` + `down.sql`), un
> modelo Prisma en `db/schema.prisma` y tres archivos de test. **Nada más.** Ni servicio, ni
> repositorio, ni job, ni ruta, ni Server Action.
>
> **Dependencia:** feature 135, mergeada en `origin/dev`. Su contrato vive en
> `lib/analytics/types.ts` y `lib/analytics/metrics.ts`, y su spec en
> `specs/135-analitica-catalogo-kpis-rangos/`. Todo lo que este documento afirma sobre el catálogo
> está verificado contra esos dos archivos, no supuesto.
>
> **Puerta T0 CERRADA el 2026-07-30.** Las ocho decisiones del humano (D1–D8) están en
> `requirements.md > Decisiones del humano (2026-07-30)` y **mandan sobre cualquier redacción de
> este archivo**. Nada aquí sigue pendiente de una Q.

## 1. Frontera de la feature

| Hace | No hace | Quién lo hace |
|---|---|---|
| DDL de `analytics_daily` (tabla, CHECKs, índices, FKs, comentarios, RLS) | Poblar la tabla | 124 (job diario) |
| Modelo Prisma `AnalyticsDaily` | Recomputar fechas pasadas | 125 (backfill) |
| `down.sql` + round-trip real ejecutado | Consultar el rollup, recortar por rol, cachear | 122 / 126 / 128 |

La tabla **nace vacía** y así se queda hasta que la 124 exista (R44). Es deliberado: separa el
riesgo de esquema (reversible, verificable con DDL) del riesgo de agregación (semántico, verificable
con datos).

## 2. Dónde la ficha contradice al catálogo, y quién manda

La ficha de `feature_list.json` es **anterior** a la 135. Manda el catálogo, salvo donde el catálogo
no se pronuncia. Tres divergencias, todas verificadas leyendo `lib/analytics/metrics.ts`:

### 2.1 El grano: `DIMENSIONES` tiene 7, la ficha propone 5, el rollup necesita 6

`DIMENSIONES` (`lib/analytics/types.ts`) es
`fecha · zona · tienda · mensajero · estatus · metodo_pago · causa_devolucion`.

Pero **no toda dimensión del catálogo pertenece al rollup**: solo las que declara alguna métrica con
`fuente.tipo === "rollup"` (⇔ `clase: "snapshot"`, invariante R5 de la 135). Unión de los `granos`
de las 14 métricas snapshot:

| dimensión | ¿la declara alguna métrica snapshot? | ¿va al rollup? |
|---|---|---|
| `fecha` | todas | **sí** |
| `zona` | todas las operativas | **sí** |
| `tienda` | `ordenes_creadas`, embudo, 4 de gestión, 3 tasas, `motivos_devolucion`, `tiempo_ciclo` | **sí** |
| `mensajero` | embudo, 5 de gestión, `sin_gestionar`, 3 tasas, `primer_intento_ok` | **sí** |
| `estatus` | `ordenes_por_estado` (snapshot) y `aging_por_estado` (**live**) | **sí**, por el embudo |
| `causa_devolucion` | `motivos_devolucion` (snapshot, `producida`) | **sí** |
| `metodo_pago` | solo `cod_recaudado` → `financiera`, `clase: "live"`, fuente `snapshot_cierre` + ledger | **NO** |

**Veredicto:** el grano de la ficha **no coincide** con el catálogo: le **falta `causa_devolucion`**.
Sin esa columna, `motivos_devolucion` —métrica `producida` cuya `fuente` es literalmente
`{ tipo: "rollup" }`— no tendría de dónde salir, y el rollup nacería inservible para ella.
`metodo_pago` se queda fuera con razón: su única consumidora no lee el rollup.

Manda el catálogo, pero **filtrado por `clase`**, no `DIMENSIONES` en bruto (R2, R3). El guard de
R45 congela esa derivación para que no vuelva a depender de que alguien la recuerde.

### 2.2 `MetricaClase` decide qué se materializa y qué no

Verificado en `metrics.ts`, no supuesto:

- `clase: "live"` → **9 métricas**: las 8 financieras (`cod_recaudado`, `ingreso_flete`,
  `ingreso_comision_cod`, `ingreso_iva`, `egresos`, `cuenta_por_pagar_tienda`,
  `cuenta_por_pagar_mensajero`, `conciliacion_cierres`) y la operativa `aging_por_estado`. Ninguna
  cita `analytics_daily`: su `fuente` es `ledger`, `snapshot_cierre` o `tabla_viva`.
- `clase: "snapshot"` → las 14 operativas restantes, **todas** con
  `fuente: { tipo: "rollup", tablas: ["analytics_daily"] }`.

La equivalencia `snapshot ⇔ fuente rollup` es el invariante R5 de la 135 y está testeada allí, así
que la 123 puede apoyarse en `clase` como discriminador sin re-verificarlo por fila.

**Consecuencia normativa (R4):** `analytics_daily` **no materializa nada `live`**. En particular no
hay columnas de dinero —lo que también dice la ficha—, ni columna de *aging*, ni la dimensión
`metodo_pago`. El dinero nunca se recalcula desde órdenes (consigna de la 127) y meterlo en el
rollup sería exactamente eso.

### 2.3 `sonSumables` y las medidas: la ficha se queda corta en tres sitios

`sonSumables()` existe porque **dos medidas de `unidadDeConteo` distinta no se suman** (una orden
reprogramada y luego entregada aporta dos gestiones). Su corolario para un rollup es más duro: **lo
que no es aditivo no se materializa**. Un porcentaje o un promedio guardado en una fila diaria se
convierte en basura en cuanto alguien lo suma o lo promedia entre filas: es el modo de fallo clásico
de estas tablas, y es silencioso.

De ahí que la ficha lleve `seg_ciclo_acum` y `n`. Bien visto, pero incompleto:

| problema de la ficha | decisión (con su D) |
|---|---|
| `ordenes` es ambiguo: el catálogo tiene **dos** métricas de órdenes con semánticas distintas (`ordenes_creadas` y `ordenes_por_estado`). | **D2**: dos columnas, pero no por «partir» nada — `ordenes_creadas` sobrevive **porque el catálogo la declara como métrica propia** (R27), y el embudo se llama `ordenes_estado_stock` (R28). Ver §3.3. |
| falta `incidentes`, cuarto término de `DENOMINADOR_GESTIONES` (`entregas + devoluciones + rechazos + incidentes`). Sin ella las tres tasas dan de más. | **D3**: se materializa aunque la métrica sea `declarada` (R18). |
| `n` a secas: un denominador único no puede servir a medidas con denominadores distintos. | **`seg_ciclo_n`**, atado a su numerador (R20), con `CHECK` de coherencia (R22). |
| `primer_intento_ok` es `unidad: "porcentaje"` en el catálogo. Guardar el porcentaje sería el bug exacto que `sonSumables` señala. | **D1**: columna de **conteo entero** (R23), denominador = `entregas` del mismo grano, sin columna extra. El riesgo comprado se cubre en §3.5. |

## 3. Modelo de datos

### 3.1 Tabla `analytics_daily` — 19 columnas

| columna | tipo | nulo | qué es |
|---|---|---|---|
| `id` | `TEXT` (uuid) | no | PK sustituta (patrón del repo) |
| `fecha` | `DATE` | no | fecha calendario **CR** del día agregado |
| `zona_id` | `TEXT` → `zona.id` | no | zona **de la orden** (D9 de la 135) |
| `tienda_id` | `TEXT` → `usuario.id` | no | tienda **de la orden** (en este esquema la tienda *es* un `usuario`) |
| `mensajero_id` | `TEXT` → `usuario.id` | **sí** | `NULL` = cubo `sin_asignar` (D5 de la 135) |
| `estatus_id` | `TEXT` → `order_status.id` | no | estado de la orden **en el corte del día** |
| `causa_devolucion` | `gestion_causa_devolucion` | **sí** | `NULL` = sin causa tipificada |
| `ordenes_creadas` | `INTEGER` | no, `DEFAULT 0` | **flujo**: órdenes nacidas ese día |
| `ordenes_estado_stock` | `INTEGER` | no, `DEFAULT 0` | **stock** al corte: órdenes en ese estatus. **No sumar por `fecha`** |
| `entregas` | `INTEGER` | no, `DEFAULT 0` | gestiones vigentes `entregada` |
| `devoluciones` | `INTEGER` | no, `DEFAULT 0` | gestiones vigentes `devuelta` |
| `rechazos` | `INTEGER` | no, `DEFAULT 0` | gestiones vigentes `rechazada` |
| `reprogramaciones` | `INTEGER` | no, `DEFAULT 0` | gestiones vigentes `reprogramada` |
| `incidentes` | `INTEGER` | no, `DEFAULT 0` | gestiones vigentes `incidente` (4.º término del denominador) |
| `primer_intento_ok` | `INTEGER` | no, `DEFAULT 0` | numerador ⊆ `entregas` de la MISMA fila |
| `seg_ciclo_acum` | `BIGINT` | no, `DEFAULT 0` | numerador: segundos de ciclo acumulados |
| `seg_ciclo_n` | `INTEGER` | no, `DEFAULT 0` | denominador: órdenes que cerraron ciclo |
| `created_at` | `TIMESTAMP(3)` | no, `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `TIMESTAMP(3)` | no | `@updatedAt`: rastro de la última recomputación |

**Por qué `BIGINT` en `seg_ciclo_acum` (R21), con el número delante.** `INTEGER` topa en
2 147 483 647. Una orden con 30 días de ciclo aporta 2 592 000 s; ~828 de esas en una sola celda
desbordan. No es un escenario de laboratorio: el backfill de la 125 recorre años. `BIGINT` cuesta
4 bytes por fila y elimina la clase entera de fallo. **Aviso a la 124/126:** Prisma mapea `BigInt`
al `BigInt` de JS, que `JSON.stringify` no serializa; el promedio (`acum / n`) cabe holgadamente en
`number`, así que la conversión se hace **después** de dividir.

**Dinero:** ninguno (R5). Si algún día entrara, `DECIMAL(12,2)`, nunca float: la feature 158 ya midió
contra Postgres que `9999999999.99` cabe y `10000000000.00` desborda.

### 3.2 Semántica de las coordenadas (contrato hacia la 124)

No es implementación del job: es lo que hace que las columnas signifiquen algo. Va también en
`COMMENT ON COLUMN` (R30) para que viaje con el esquema y no solo con este documento.

- **Hechos de orden** (`ordenes_creadas`, `ordenes_estado_stock`, `seg_ciclo_*`): coordenadas
  tomadas de la orden — `orden.zona_id`, `orden.tienda_id`, `orden.mensajero_asignado_id` (nullable
  ⇒ cubo sin asignar), estatus al corte. `causa_devolucion = NULL`.
- **Hechos de gestión** (`entregas`, `devoluciones`, `rechazos`, `reprogramaciones`, `incidentes`,
  `primer_intento_ok`): zona y tienda **de la orden** (D9/R34 de la 135: jamás la zona del
  mensajero); mensajero = `gestion_orden.mensajero_id`, que es `NOT NULL` en el esquema y por tanto
  **nunca** produce el cubo sin asignar; estatus de la orden al corte; `causa_devolucion` solo en
  las devoluciones.

Corolario útil y no obvio: **el cubo `sin_asignar` solo puede aparecer en las medidas de orden**.
Coincide con D5 de la 135, que habla literalmente de «órdenes con `mensajero_asignado_id IS NULL`».

### 3.3 `ordenes_estado_stock`: impedir la suma por fecha **por diseño** (D2)

El embudo es un **stock**: «cuántas órdenes había en cada estado al cerrar el día». Sumarlo entre
fechas cuenta la misma orden una vez por día que estuvo viva. Es la bomba de relojería clásica de
estas tablas, porque el resultado es un número plausible y nadie lo detecta. Tres capas, ninguna de
ellas «una convención»:

1. **El nombre lo grita en el punto de uso (R28).** La columna es `ordenes_estado_stock`, no
   `ordenes`. Quien escriba `SUM(ordenes_estado_stock)` en un rango de fechas está escribiendo la
   palabra «stock» con sus propios dedos. Es la única de las tres capas que actúa **mientras se
   escribe el código**, no después.
2. **La base lo dice (R30).** `COMMENT ON COLUMN "analytics_daily"."ordenes_estado_stock"` contiene
   literalmente la frase de no sumar por fecha. Es visible desde cualquier cliente SQL, sobrevive al
   `\d+`, y es verificable por `pg_description` (el round-trip lo comprueba).
3. **El guard lo caza (R29).** Test que rastrea `lib/` y `app/` buscando agregaciones de esa columna
   (`SUM(`, `_sum`, `sum:`) que no estén acotadas a una fecha única, y falla. Hoy pasa en vacío
   —nadie consume la tabla (R44)—, y ahí está su valor: es un **tripwire armado antes de que llegue
   el consumidor**, la 126. Para que no sea una aserción vacía, T5.3 lo verifica por **mutación**
   con una cadena de prueba.

**Alternativa evaluada y descartada: sacar el stock a una tabla aparte** (`analytics_daily_estado`),
que sería la contención más fuerte de todas —físicamente imposible sumarla junto a los flujos en un
mismo `SELECT`— y además tendría un grano más corto (5 columnas: el embudo no usa
`causa_devolucion`). Se descarta por una razón dura del contrato de la 135, no por comodidad:
`TablaRollup` es el tipo literal **cerrado** `"analytics_daily"`, y las 14 métricas snapshot
declaran `fuente: { tipo: "rollup", tablas: ["analytics_daily"] }`. Una segunda tabla de rollup
**obligaría a modificar el contrato de la 135**, es decir, la dependencia de esta feature y de las
otras diez del clado. El coste no lo paga la 123: lo paga el lote entero. Queda anotado como la
evolución natural **si** la 126 demuestra que las tres capas no bastan.

### 3.4 `sin_gestionar` no se materializa (D3), y dónde se deriva

La métrica `sin_gestionar` (`estadoProduccion: "declarada"`, `granos: [fecha, zona, mensajero]`) se
obtiene del embudo, sin columna propia:

```
SUM(ordenes_estado_stock)  -- para una fecha única, R28/R29
  WHERE estatus_id = (SELECT id FROM order_status WHERE value = 'sin_gestionar')
  GROUP BY fecha, zona_id, mensajero_id
```

Razón para no darle columna: **sería dato duplicado que puede contradecir a su origen**. Con
columna propia habría dos números para el mismo hecho —la columna y la fila del embudo con ese
`estatus_id`— y ninguna forma de saber cuál miente cuando difieran. El mismo argumento aplicaría a
cualquier futura medida que sea «el embudo filtrado por un estado».

### 3.5 `primer_intento_ok` sin denominador propio: el riesgo comprado y su contención (D1)

El catálogo declara `primer_intento_ok` como `unidad: "porcentaje"` pero con
`criterio: "intentos_vigentes_historial"` y **sin `razon`**: no hay denominador declarado. D1 lo fija
en `entregas` **del mismo grano** y prohíbe la columna `primer_intento_n`.

**El riesgo que eso compra**, dicho con todas las letras: si el numerador contara un universo que el
denominador no cubre —por ejemplo, entregas de una gestión anulada, o entregas atribuidas a otra
fecha, o al cubo `sin_asignar` cuando la entrega sí tenía mensajero— la tasa podría **pasar del
100 %**, y un tablero que muestra «112 % de entregas al primer intento» destruye la confianza en
todo el resto de la pantalla.

**La contención (R24 + R25).** El universo queda definido: todo lo contado en `primer_intento_ok` es
una gestión vigente de resultado `entregada` con **las mismas seis coordenadas** de la fila, luego
contada también en `entregas`. Y eso se impone con un `CHECK` de la base:

```sql
CHECK ("primer_intento_ok" <= "entregas")
```

Dos propiedades que lo hacen la contención correcta y no un parche:

- **Es estructural, no una prueba.** Un job de la 124 mal escrito no puede persistir la fila mala:
  la transacción falla. No hay ventana en la que el dato inconsistente exista.
- **Sobrevive a la agregación.** Si `pio ≤ ent` fila a fila, entonces `Σpio ≤ Σent` sobre cualquier
  subconjunto de filas. La 126 puede agregar por la dimensión que quiera y el cociente **no puede**
  superar 1. Un test sobre datos de ejemplo no daría esa garantía; una desigualdad sí.

Se añaden dos `CHECK` más por el mismo criterio —invariantes estructurales, no reglas de negocio—:
`seg_ciclo_n = 0 ⇒ seg_ciclo_acum = 0` (R22, para que nunca exista un promedio sobre denominador
vacío) y no negatividad de las diez medidas (R26). Precedente del repo para meter `CHECK`
estructurales en la migración: `notificacion_destinatario_xor` y
`notificacion_lectura_marca_presente` (feature 146). Lo que **no** va a `CHECK` son obligaciones de
negocio: esas viven en zod y en el service, como en `cierre_dia`/`orden_incidente`.

## 4. La decisión peligrosa: nulabilidad del grano

Esta sección existe porque es donde este tipo de tabla se rompe en silencio.

### 4.1 El fallo que hay que evitar

En Postgres, un índice `UNIQUE` con semántica por defecto **no considera iguales dos `NULL`**. Un
`UNIQUE (fecha, zona_id, tienda_id, mensajero_id, estatus_id, causa_devolucion)` ingenuo dejaría
convivir *n* filas del mismo día con `mensajero_id IS NULL`, el `ON CONFLICT` del upsert de la 124
no encontraría nada con que colisionar, insertaría una fila nueva en cada pasada y **el rollup se
duplicaría sin un solo error**. La 135 lo dejó anotado como riesgo heredado
(`specs/135-.../design.md §6.1` y §8) y explícitamente **no eligió** por la 123. Aquí se elige.

### 4.2 Qué columnas pueden faltar, y por qué

| columna | ¿puede faltar? | por qué |
|---|---|---|
| `fecha` | no | toda métrica declara el grano `fecha` (R10 de la 135) |
| `zona_id` | no | `orden.zona_id` es `NOT NULL` en el esquema |
| `tienda_id` | no | `orden.tienda_id` es `NOT NULL` en el esquema |
| `estatus_id` | no | `orden.estatus_id` es `NOT NULL` en el esquema |
| `mensajero_id` | **sí** | D5 de la 135: las órdenes sin asignar **no se descartan**, van a su cubo |
| `causa_devolucion` | **sí** | `gestion_orden.causa_devolucion` es nullable (una `devuelta` anterior a la feature 73 no la tiene) y las filas que no son de devolución no tienen causa |

Solo **dos** columnas del grano son nullables, y en ambas el `NULL` tiene **significado de dominio**,
no es un marcador de ausencia:

- `mensajero_id IS NULL` ⇒ **sin asignar** (nunca «todos los mensajeros»).
- `causa_devolucion IS NULL` ⇒ **sin causa tipificada** (se lee siempre junto a `devoluciones`; en
  una fila con `devoluciones = 0` la columna es irrelevante y no se agrupa por ella).

### 4.3 La elección: `NULL` + `NULLS NOT DISTINCT`, no centinela

```sql
CREATE UNIQUE INDEX "analytics_daily_grano_key"
  ON "analytics_daily" ("fecha","zona_id","tienda_id","mensajero_id","estatus_id","causa_devolucion")
  NULLS NOT DISTINCT;
```

`NULLS NOT DISTINCT` (Postgres 15+) hace que dos `NULL` **sí** colisionen: la unicidad del grano
vuelve a ser real y el `ON CONFLICT` de la 124 tiene dónde agarrarse. **No es una novedad en este
repo**: se aplica ya en `20260711190000_tarifa_zona_mensajero_zona_vehiculo_unique` y en
`20260727120000_notificacion` (`notificacion_dedupe_key`), esta última precisamente porque una
columna del par es siempre `NULL` por un CHECK XOR. Y por **D6** consta que ambas figuran
**APLICADAS** en `localhost:5432/ordenex`: el motor local lo admite, verificado por el hecho, no por
la versión declarada. Para producción queda como riesgo de despliegue (§10).

**Alternativa descartada — centinela `'sin_asignar'` en `mensajero_id`.** Es la opción (ii) que la
135 dejó abierta. Descartada por una razón dura: `mensajero_id` tiene FK a `usuario`, así que un
centinela obliga a **sembrar una fila falsa de usuario** llamada «sin asignar» —un usuario fantasma
que aparecería en listados, buscadores, asignaciones y reportes de todo el sistema para resolver un
problema de índice de una sola tabla— o bien a **renunciar a la FK**. Además, el catálogo ya declara
`MENSAJERO_SIN_ASIGNAR = "sin_asignar"` como valor de **presentación**: el mapeo `NULL →
"sin_asignar"` lo hace la 126 al pintar, y así el dato persistido no depende de un literal de UI.

**Alternativa descartada — índices únicos parciales por combinación de nulidad.** Es la opción (i)
de la 135. Con dos columnas nullables serían 4 índices; cualquier dimensión nullable futura duplica
el número. Cuatro índices que mantener coherentes a mano, y `ON CONFLICT` no puede inferir entre
varios: la 124 tendría que elegir el índice según la forma de la fila. `NULLS NOT DISTINCT` consigue
lo mismo con un índice y cero ramas. (Es la única salida si D6 se desmintiera en producción.)

### 4.4 Corolario: nada de filas de totalización (R13)

La otra manera de meter `NULL` en el grano es usarlo como «todas» (`GROUPING SETS`). Se descarta
frontalmente: colisionaría de lleno con el `NULL` de *sin asignar* —la misma marca significando dos
cosas opuestas en la misma columna— y cualquier consulta que olvidara excluir las filas de subtotal
duplicaría los conteos. Se guarda **solo el grano fino**; la agregación por dimensiones es un
`GROUP BY` de la 126, que además ya sabe qué dimensiones puede agregar porque el catálogo se lo dice
(`metrica.granos`).

## 5. Índices: cada uno con su consulta

`analytics_daily` no tiene rutas de escritura calientes (una pasada diaria de la 124). Las lecturas
las define la 126 sobre el filtro validado de `lib/analytics/filters.ts`, que solo admite
`rango` + listas de `zona_id` / `tienda_id` / `mensajero_id`. Por tanto **toda** consulta es
«rango de `fecha` + 0..3 igualdades de dimensión + `GROUP BY`».

| índice | consulta concreta que lo justifica | por qué ese orden de columnas |
|---|---|---|
| `analytics_daily_grano_key` UNIQUE (`fecha`, `zona_id`, `tienda_id`, `mensajero_id`, `estatus_id`, `causa_devolucion`) NULLS NOT DISTINCT | (a) upsert idempotente de la 124/125; (b) barrido de `maestro`/`admin`, que ven **todas** las filas y solo filtran por rango | `fecha` primero: es el **único predicado presente en el 100 %** de las consultas, y como prefijo del único sirve el barrido por rango sin índice adicional |
| `analytics_daily_tienda_fecha_idx` (`tienda_id`, `fecha`) | recorte de la 122 para `adminTienda`: `WHERE tienda_id = ? AND fecha BETWEEN ? AND ?`, en cada render de su tablero | igualdad antes que rango: regla de un índice compuesto B-tree; al revés la igualdad no permite *seek* |
| `analytics_daily_mensajero_fecha_idx` (`mensajero_id`, `fecha`) | recorte para el rol `mensajero` (solo sus filas) y el tablero por mensajero | ídem; además cubre eficientemente el cubo `sin_asignar` (`IS NULL` es *seekable* en B-tree) |
| `analytics_daily_zona_fecha_idx` (`zona_id`, `fecha`) | recorte para `adminSatelite`, acotado por zona **de la orden** (D9 de la 135) | ídem |

**Descartados a propósito (R40):** índices sobre `estatus_id` y sobre `causa_devolucion`. Ninguna
consulta los filtra por sí solos: son columnas de `GROUP BY` dentro de un conjunto ya recortado por
fecha y dimensión. Un índice ahí sería peso de escritura y de vacío sin lector. Tampoco se crea
índice suelto sobre `fecha`: es prefijo del único.

Los tres índices de recorte se corresponden **uno a uno** con los tres roles `acotado` del catálogo
(`adminSatelite`, `adminTienda`, `mensajero`); los dos roles `total` (`maestro`, `admin`) los sirve
el prefijo del único. No sobra ninguno.

## 6. Inmutabilidad hacia atrás (D4), y su única grieta

**El invariante (R35).** Todo hecho se atribuye a la fecha en que ocurre: la orden creada, al día de
su creación; la gestión, al día en que se registró; el tiempo de ciclo, **al día del evento
terminal** (D4), no al de creación. Como ningún hecho se atribuye hacia atrás, **el job de la 124
solo escribe el día que agrega y nunca reescribe días pasados**. El único escritor autorizado a
tocar fechas pasadas es el backfill de la 125, invocado a propósito sobre un rango explícito.

**Lo que esto regala, y conviene que quede escrito:**

- **A la 128 (caché):** la invalidación de un día pasado **no existe**. Lo calculado una vez sigue
  valiendo; basta con invalidar el día en curso. Es una simplificación grande y gratuita.
- **A la 126:** un rango histórico cerrado es cacheable indefinidamente.
- **A la 124:** el job es un `INSERT ... ON CONFLICT` acotado a **una** fecha; ni ventana móvil de
  recomputación ni «reprocesar los últimos N días».

**La grieta, declarada y no escondida.** Una gestión puede **anularse** después
(`gestion_orden.anulada_at`, feature 67). Si una gestión del día D se anula el día D+3, las medidas
de gestión del día D dejan de coincidir con las tablas vivas, y el invariante dice que el job **no**
las corrige. Consecuencias y postura:

1. Es un desvío **acotado y direccional**: el rollup queda por **exceso** en las medidas de gestión
   del día afectado (contó una gestión que luego se anuló).
2. La corrección **existe y es deliberada**: recomputar ese rango con la 125. Que sea manual no es
   un olvido: es lo que hace que el rollup sea auditable —nadie cambia el pasado sin dejar rastro—.
3. **Aviso dirigido a la 124 y a la 125**: si el volumen de anulaciones resultara alto, la respuesta
   correcta **no** es aflojar R35 en el job diario, sino programar la 125 sobre una ventana
   explícita. La diferencia es que la segunda es visible y la primera vuelve el rollup no
   reproducible.

## 7. Alternativas descartadas

1. **Grano tal cual la ficha (5 columnas, sin `causa_devolucion`).** Descartada: dejaría
   `motivos_devolucion` —métrica `producida`, `fuente: rollup`— sin fuente, obligando a la 126 a
   leerla intradía de `gestion_orden` y a contradecir su propio `clase: "snapshot"` (invariante R5
   de la 135). El coste de la alternativa elegida es cardinalidad; el de esta, un contrato roto el
   primer día.

2. **Incluir `metodo_pago` «ya que está en `DIMENSIONES`».** Descartada: su única consumidora,
   `cod_recaudado`, es `financiera` + `live` sobre `cierre_dia` + `wallet_tienda_movimiento`.
   Materializarla obligaría a que el rollup tocara el camino del dinero, que es justo lo que R6 de
   la 135 prohíbe por tipos. Sería además una columna permanentemente `NULL`.

3. **Tabla estrecha tipo EAV: `(fecha, dims..., metrica_id, valor)`.** Descartada: pierde el tipo por
   medida (`BIGINT` de segundos y conteos en la misma columna), impide `COMMENT ON COLUMN` y los
   `CHECK` por medida —es decir, mataría las contenciones de §3.5—, multiplica las filas por el
   número de medidas y obliga a un pivot en **cada** consulta de la 126. El argumento de
   flexibilidad es débil aquí: el catálogo de la 135 es TS congelado, así que añadir un KPI **ya es**
   un cambio de código revisado.

4. **Guardar las tasas ya calculadas (`tasa_entrega REAL`, `tiempo_ciclo_prom REAL`).** Descartada:
   es el modo de fallo que `sonSumables` existe para señalar. Un porcentaje diario no se puede sumar
   ni promediar entre filas sin ponderar; en cuanto la 126 agregue dos días, dos zonas o dos
   mensajeros, el número es incorrecto y **no hay error que lo delate**. Se guardan numerador y
   denominador (R17, R20, R23) y la división se hace al final, una sola vez.

5. **Una sola columna `ordenes` (como dice la ficha).** Descartada: fundiría un flujo
   (`ordenes_creadas`, métrica propia del catálogo) con un stock (`ordenes_estado_stock`). Sumar la
   columna por rango daría un número sin significado y la confusión sería indetectable a ojo.

6. **Sacar el stock a una segunda tabla de rollup.** Descartada en §3.3: `TablaRollup` es un literal
   **cerrado** en el contrato de la 135 y las 14 métricas snapshot apuntan a `analytics_daily`; una
   segunda tabla obligaría a modificar la dependencia y a las otras diez features del clado.

7. **Filas de totalización con `NULL` = «todas» (`GROUPING SETS` materializados).** Descartada en
   §4.4: colisiona con el `NULL` de *sin asignar* y produce doble conteo silencioso.

8. **Centinela `'sin_asignar'` / índices únicos parciales por combinación de nulidad.** Descartadas
   en §4.3 (usuario fantasma con FK / explosión combinatoria de índices).

9. **Particionar `analytics_daily` por rango de `fecha`.** Descartada **por ahora**: por **D5** no
   hay dato de volumen ni de retención, particionar complica el `ON CONFLICT` y el `down.sql`, y una
   tabla que crece en decenas de miles de filas al año no lo necesita. Evolución barata: al ser una
   tabla **derivada y reconstruible** por la 125, migrar a particionada más tarde no arriesga datos
   irrecuperables.

10. **`INTEGER` para `seg_ciclo_acum`.** Descartada con el cálculo de §3.1: ~828 órdenes de 30 días
    en una celda desbordan. El desbordamiento en Postgres es un error en tiempo de ejecución dentro
    del job nocturno: un fallo diferido y a oscuras.

11. **Dejar la no-aditividad de `ordenes_estado_stock` en un comentario del spec.** Descartada por
    **D2**: un párrafo de spec no se ejecuta ni aparece en el autocompletado. Se sustituye por las
    tres capas de §3.3.

12. **Aceptar R43 (round-trip) como deuda declarada.** Descartada por **D7**: hay Postgres local
    (`localhost:5432/ordenex`) y la deuda no tiene justificación. Se ejecuta.

## 8. Reversibilidad: `down.sql` y round-trip real

`down.sql` es un `DROP TABLE IF EXISTS "analytics_daily";`, que arrastra PK, índices, FKs, CHECKs,
comentarios y RLS. No toca **nada** preexistente porque la migración es puramente aditiva (R41): no
se crea ningún enum nuevo (`gestion_causa_devolucion` ya existe desde
`20260715160000_gestion_orden_causa_devolucion`), así que el DOWN no retira tipos y el orden de
sentencias es trivial.

**Se verifica ejecutándolo (R43), no leyéndolo.** Método y formato:
`progress/roundtrip_155_migracion.md`. Destino: **Postgres local `localhost:5432/ordenex`**,
confirmado antes con `prisma migrate status` (solo lectura, imprime el host sin exponer la
credencial). Secuencia: `prisma migrate deploy` → `pnpm db:rollback` → `prisma migrate deploy`,
midiendo en cada paso la existencia de la tabla, el conjunto de índices (`pg_indexes`), las FKs, los
CHECKs, el flag `relrowsecurity`, los comentarios (`pg_description`) y la fila de
`_prisma_migrations`.

> **Corrección de una premisa equivocada (D7).** La cabecera de
> `tests/integration/db/notificacion-migration.test.ts` afirma que «el `.env` de este repo apunta a
> una base COMPARTIDA con produccion». **Eso no describe este checkout**: `.env` apunta a
> `localhost:5432/ordenex`. Los tests estáticos por regex siguen teniendo valor (no exigen base),
> pero **no** son la única verificación disponible, y por eso R43 no es negociable.

**Tres deudas conocidas del arnés, todas verificadas, que condicionan la ejecución:**

1. **Drift de la base local (D7).** Tiene 2 migraciones sin aplicar y 1 aplicada que no está en el
   árbol local, porque el checkout está en `ux`. Sin sanear eso, el round-trip mide otra cosa. Va
   como task previa **T8.0**, con `prisma migrate status` antes y después.
2. **`scripts/db-rollback.ts` elige por NOMBRE de carpeta** (`readdirSync` + `sort`), no por la
   última aplicada. Correrlo **dos veces revierte la misma migración dos veces**. En el round-trip
   se corre **una sola vez** por ciclo y se comprueba el efecto en `_prisma_migrations` antes de
   reaplicar.
3. **El orden de los `down.sql` importa y ningún gate lo impone.** Si entretanto se mergea una
   migración con timestamp posterior, `pnpm db:rollback` revertirá **esa** y no la de la 123. Por
   eso T8.2 verifica, inmediatamente antes del DOWN, que la carpeta de la 123 sigue siendo la última
   por nombre.

## 9. Verificación

| capa | qué cubre | archivo |
|---|---|---|
| unit (guard de contrato) | R2, R3, R4, R16, R17, R18, R19, R27, R45 | `tests/unit/analytics/analytics-daily-contrato.test.ts` |
| integración estática (regex sobre `.sql` + `schema.prisma`) | R1, R5–R15, R20–R28, R30–R33, R36–R42 | `tests/integration/db/analytics-daily-migration.test.ts` |
| guards de frontera y de suma | R29, R44 | `tests/integration/db/analytics-daily-guards.test.ts` |
| round-trip ejecutado | R43 (y confirmación empírica de R14, R22, R25, R26, R30, R38, R39, R41) | `progress/roundtrip_123_analytics_daily.md` |

**E2E: no aplica**, y se declara con su razón. `CHECKPOINTS.md` lo exige para features que tocan
flujos críticos *en ejecución*; esta entrega DDL no tiene ningún camino de usuario que recorrer.
Rige además la decisión humana del 2026-07-30 («no más e2e, pruebas básicas nada más»). El riesgo
concreto que un E2E cubriría —que el esquema no se aplique o no se pueda revertir— lo cubre el
round-trip real de §8, más fuerte que cualquier Playwright para este caso.

## 10. Riesgos y follow-ups

- **Cardinalidad.** Al añadir `estatus_id` y `causa_devolucion` al grano, cada día genera del orden
  de «cubos (zona × tienda × mensajero × estatus) con actividad». Está acotado por el número de
  órdenes vivas del día, pero **no está medido** (D5). Mitigación disponible y barata: la tabla es
  reconstruible por la 125.
- **FOLLOW-UP (D5) — retención y purga.** Fuera de alcance de la 123 por decisión del humano. Queda
  pendiente de abrir un ticket que decida cuántos días se conservan; de esa respuesta depende si
  algún día conviene particionar por `fecha` (alternativa 9 de §7). Mientras no exista, la tabla
  crece sin poda y nadie ha medido a qué ritmo.
- **RIESGO DE DESPLIEGUE (D6) — `NULLS NOT DISTINCT` en producción.** Verificado en local por hecho
  (las dos migraciones que ya lo usan están APLICADAS ahí). Para producción **no está confirmado**:
  hay que comprobar la versión del Postgres antes de aplicar. Si fuera < 15, la migración fallaría
  en el `apply` (R15, falla cerrado) y la única salida sin usuario fantasma sería el juego de
  índices parciales de §4.3. Es riesgo de despliegue, no de diseño.
- **La grieta de la anulación (§6).** Declarada, direccional (exceso) y con corrección deliberada
  vía 125. El riesgo real es que alguien la «arregle» aflojando R35 en el job diario.
- **`ordenes_estado_stock` sumado por fecha.** Tres capas de contención (§3.3), ninguna infalible
  por separado; la primera —el nombre— es la que actúa mientras se escribe el código.
- **Deriva del catálogo.** Si la 135 añade una métrica snapshot con un grano nuevo, el rollup queda
  corto. El guard de R45 lo convierte en un test rojo en vez de en un tablero vacío.
