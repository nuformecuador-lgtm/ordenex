# Feature 124 — analítica: job de agregación diaria · design

> **Entrega:** un repositorio de agregación, un servicio de composición, un handler de job con su
> recurrencia, el enganche en el registro del drenador, un script de invocación manual acotada, la
> migración del nuevo `job_tipo`, y el re-alcance de **tres guardias** que la 123 dejó apuntando a
> esta feature. Nada de UI, nada de lectura del rollup para presentarlo.
>
> **PUERTA T0 CERRADA el 2026-08-01** con D1→A2, D2→B2, D3+D8→(i) 00:30 CR y R35 estricto, D4→C1,
> D5→(i), D6→E1, D7→excluir borradas, D9→transacción única sin lotes ni topes inventados. Este
> documento ya está escrito **sobre esas decisiones**, no sobre sus alternativas; las alternativas y
> su coste quedan en §11. Si algo aquí contradijera `requirements.md > T0`, **manda T0**.

## 1. Frontera

| Hace | No hace | Quién lo hace |
|---|---|---|
| Poblar `analytics_daily` para **una** fecha CR (la que acaba de cerrar) | Recomputar fechas pasadas | 125 (backfill) |
| Upsert idempotente + retirada de filas rancias | Consultar el rollup, recortar por rol, cachear | 122 / 126 / 128 |
| Reconciliar lo escrito contra las tablas vivas (R33/R34) | Servir el día en curso | 126, en vivo (D3) |
| Convertir en medidos **11 de los 12** R nominales de la 123 | Decidir la retención de la tabla | follow-up de D5 de la 123 |
| Producir la **medición** de volumen que hoy no existe (R47) | Fijar umbrales de volumen | 125, con esos datos (D9) |

La tabla lleva vacía desde la 123 (su R44, verificado con `SELECT count(*) = 0`). Esta feature es
**el primer escritor**, y por eso hereda el trabajo de desarmar —con cuidado— los guardias que la
123 armó justamente para que nadie escribiera antes de tiempo (§9).

## 2. Arquitectura y archivos

Capas del repo (`docs/architecture.md`): la lógica de composición **no** vive en SQL disperso ni en
el handler; el handler es delgado, el repositorio consulta y el servicio compone y decide.

```
app/api/cron/procesar-jobs/route.ts          (modificado: registra el tipo nuevo)
  ↓
lib/services/jobs/analitica-rollup-diario-handler.ts   handler delgado + RecurrenciaSpec
  ↓
lib/services/AnaliticaRollupService.ts        compone cubos, reconcilia, decide (SIN Prisma)
  ↓
lib/repositories/AnaliticaRollupRepository.ts consultas de agregación + escritura transaccional
  ↓
Postgres
```

| archivo | qué es | nuevo/mod |
|---|---|---|
| `lib/interfaces/repositories/IAnaliticaRollupRepository.ts` | contrato de las 6 consultas + `escribirFecha` | nuevo |
| `lib/interfaces/services/IAnaliticaRollupService.ts` | `agregarFecha(fecha: string): Promise<ResumenCorrida>` | nuevo |
| `lib/repositories/AnaliticaRollupRepository.ts` | Prisma; una consulta por familia de medida | nuevo |
| `lib/services/AnaliticaRollupService.ts` | merge de cubos, invariantes, reconciliación (R33/R34) | nuevo |
| `lib/services/jobs/analitica-rollup-diario-encolado.ts` | `dedupeKey` por día CR + siembra | nuevo |
| `lib/services/jobs/analitica-rollup-diario-handler.ts` | handler + `recurrenciaAnaliticaRollup` | nuevo |
| `lib/analytics/rollup-dia.ts` | fecha objetivo (D−1) a partir de `now`; pura | nuevo |
| `lib/config/analitica-rollup.ts` | **la única** constante de aviso de volumen, marcada provisional (R47) | nuevo |
| `app/api/cron/procesar-jobs/route.ts` | `buildHandlers` + `buildRecurrencias` | mod |
| `db/migrations/<ts>_job_tipo_analitica_rollup_diario/` | `ALTER TYPE "job_tipo" ADD VALUE` + `down.sql` | nuevo |
| `db/schema.prisma` | valor nuevo en `enum JobTipo` | mod |
| `scripts/seed-jobs-analitica-rollup-diario.ts` | siembra de la primera ocurrencia | nuevo |
| `tests/integration/db/analytics-daily-migration.test.ts` | conjunto de referencia = unión (R40/R41) | **mod, ajeno** |
| `tests/integration/db/analytics-daily-guards.test.ts` | frontera re-alcanzada + tripwire (R42/R43) | **mod, ajeno** |

**Por qué el servicio no habla Prisma.** El bug caro de esta feature no es una consulta lenta: es un
cubo mal fundido, una coordenada tomada del sitio equivocado o una fila rancia que sobrevive. Todo
eso vive en el **merge**, y el merge se testea con tablas en memoria, sin base, en milisegundos y
con casos borde que en SQL costarían un seed entero.

**Por qué las consultas no se funden en un `SELECT` gigante.** Las seis familias tienen granos y
universos distintos (órdenes vs. gestiones, ventana vs. corte). Un solo `SELECT` con `FULL OUTER
JOIN` entre ellas es el camino directo al doble conteo, que además es **silencioso**. Se consulta
por familia, se funde en memoria y se reconcilia (R34) contra escalares independientes.

## 3. El día CR y sus cotas

Se reutiliza `lib/utils/fecha-cr.ts` sin reimplementar nada (R6):

```ts
const desde = inicioDelDiaCREnUtc(fecha);            // `${fecha}T06:00:00.000Z`
const hasta = inicioDelDiaSiguienteCREnUtc(fecha);   // +24 h, EXCLUSIVO  == el CORTE
```

- **Semiabierto `[desde, hasta)`**, igual que `RangoResuelto` de la 135. La orden de las 23:59:59 CR
  cae dentro; la de las 00:00:00 CR del día siguiente, fuera (R7).
- **La cota del corte es ESTRICTA (`< hasta`)** y eso tiene una consecuencia observable, no
  cosmética: las transiciones `corte_sin_gestionar` que el corte diario escribe a las 00:00:00 CR
  del día D+1 caen **exactamente** en `hasta` y por tanto **no** entran en el estado de cierre de D
  (R24). Cambiar `<` por `<=` mueve el embudo de un día entero: tiene mutación propia.
- **`startOfDayCR` está prohibido aquí** y el guard lo comprueba: devuelve la medianoche **UTC** de
  la fecha CR, 6 h por debajo del inicio real del día, y usarlo contra columnas `timestamp` produce
  la ventana 18:00–18:00 que hoy tiene `RankingService` (ficha 166). Es la trampa documentada del
  repo y esta feature no la repite.
- `analytics_daily.fecha` es `@db.Date`. Prisma escribe un `DateTime`; se construye con
  `new Date(`${fecha}T00:00:00.000Z`)`, la convención `@db.Date` del repo (feature 46), **no** con
  `desde`, que lleva las 06:00 dentro. Confundir las dos convenciones es el off-by-one clásico y
  tiene su propio caso de prueba.
- La fecha objetivo sale de `lib/analytics/rollup-dia.ts`: función pura `fechaObjetivo(now)` que
  devuelve **`fechaCalendarioCR(now − 1 día)`** (D3: se agrega el día que acaba de cerrar). Ninguna
  otra parte del código deriva la fecha.

## 4. Derivación de cada medida

Notación: `V` = ventana `[desde, hasta)`; `C` = corte (`hasta`). Todas las consultas excluyen
`orden.deleted_at IS NOT NULL` (**D7**). Las seis consultas del repositorio:

| # | medida(s) | universo | agrupación | fuente de coordenadas |
|---|---|---|---|---|
| Q1 | `ordenes_creadas` | `orden.created_at ∈ V`, no borrada | zona, tienda, mensajero, estatus-al-corte | orden (estatus congelado) |
| Q2 | `ordenes_estado_stock` | **D2-B2**: estatus al corte no terminal, **más** las que llegaron a terminal en `V` | ídem | orden (estatus congelado) |
| Q3 | `entregas`, `devoluciones`, `rechazos`, `reprogramaciones`, `incidentes` | `gestion_orden.created_at ∈ V AND anulada_at IS NULL`, orden no borrada | zona/tienda **de la orden**, mensajero **de la gestión**, estatus-al-corte, causa solo en `devuelta` | mixto |
| Q4 | `primer_intento_ok` | subconjunto de Q3 con `resultado = 'entregada'` y **0 intentos previos vigentes** | idénticas a su entrega en Q3 | mixto |
| Q5 | `seg_ciclo_acum`, `seg_ciclo_n` | órdenes cuya transición a `ESTADOS_TERMINALES` cae en `V` | orden | orden |
| Q6 | escalares de reconciliación (R34) | uno por medida | ninguna (7 escalares) | — |

### 4.1 El estatus congelado (D1→A2), que es transversal a Q1, Q2 y Q3

```sql
SELECT DISTINCT ON (h.orden_id) h.orden_id, h.estatus_destino_id
FROM orden_historial_estado h
WHERE h.created_at < $corte          -- ESTRICTO, ver §3
ORDER BY h.orden_id, h.created_at DESC, h.id DESC
```

- `orden_historial_estado` es **append-only e inmutable** (49/R2): esta coordenada se reproduce
  siempre, hoy y dentro de un año. Es la única que lo hace (§6).
- **El desempate por `id` es obligatorio, no defensivo:** dos transiciones con el mismo `created_at`
  (un `INSERT` en lote) harían el `DISTINCT ON` no determinista y el job dejaría de ser idempotente
  **sin que nada fallara**. Tiene mutación en R12.
- Coste: una pasada más sobre una tabla que crece con cada transición del sistema. Se acota por
  `created_at < corte` y por el conjunto de órdenes del universo, y se mide en la primera corrida
  real (R47).

### 4.2 `ordenes_creadas` (Q1) — flujo

Se cuenta **la orden**, no su transición de creación: una orden con dos filas de historial el mismo
día se contaría dos veces por esa vía. Fuente: `orden.created_at`. El catálogo declara
`definicion.estados = ESTADOS_CREACION`, que describe **en qué estado nace** una orden
(`en_preparacion`, `por_recolectar_en_tienda`), no un filtro de la medida: filtrar por él dejaría
fuera cualquier orden que ya se hubiera movido antes de medianoche, que es la mayoría. Se cuenta la
creación, y el `estatus_id` de la fila es el **de cierre**, como en el resto (R24).

### 4.3 `ordenes_estado_stock` (Q2) — stock al corte, universo B2

Exactamente **una** contribución por orden (R11/R12): el estatus de la orden en `C`, sobre el
universo que fijó **D2-B2**:

```
universo = { orden no borrada : estatusAlCorte(orden) ∉ ESTADOS_TERMINALES }
         ∪ { orden no borrada : ∃ transición a un terminal con created_at ∈ V }
```

Los dos conjuntos son disjuntos salvo por el caso «llegó a terminal y se revirtió el mismo día», que
la unión resuelve sola (la orden aparece una vez, en su estatus de cierre). La segunda rama existe
para que **el día en que una orden cierra no desaparezca del embudo sin dejar rastro**.

**Lo que esto le hace a la columna, y que la 126 tiene que saber:** para los tres estatus terminales
`ordenes_estado_stock` se comporta como un **flujo del día** —la orden aparece en la fecha en que
cerró y desaparece al día siguiente—. Es tentador sumarla por fecha para esos tres y saldría
«bien». **No se hace**: el histórico de terminales se sirve de `entregas` / `devoluciones` /
`rechazos` / `incidentes`, que son flujos de verdad, y el tripwire de R29 de la 123 sigue vigente
sobre la columna entera (R43). Aviso dirigido en §13.

### 4.4 Las cinco de gestión (Q3)

`gestion_orden` filtrada por ventana, `anulada_at IS NULL` y orden no borrada (R13/R14, D7; D10 de
la 135: cuentan **gestiones vigentes**, no órdenes; una orden puede aportar varias). `JOIN orden`
para zona y tienda —**nunca** `usuario.zona_id` del mensajero (R22, D9 de la 135)— y
`gestion_orden.mensajero_id`, que es `NOT NULL`, para el mensajero: por construcción **el cubo
`sin_asignar` no puede aparecer en las medidas de gestión**, y hay un caso de prueba que lo fija.

`causa_devolucion` se informa **solo** en las filas de `devuelta` (R15). Consecuencia visible del
grano de 6 columnas: un mensajero que el mismo día entrega y devuelve produce **dos** filas, una con
`causa_devolucion IS NULL` (donde vive `entregas`) y otra con la causa (donde viven las
`devoluciones`). Es correcto y es lo que `motivos_devolucion` necesita.

### 4.5 `primer_intento_ok` (Q4)

**No se reimplementa el criterio.** La 135 remite explícitamente a `intentos_vigentes_historial`
(feature 160, `OrdenHistorialService.contarIntentos` /
`OrdenHistorialRepository.contarIntentosVigentesEnLote`), que ya excluye las transiciones causadas
por gestiones anuladas. El job:

1. toma los `orden_id` de las entregas vigentes del día (subconjunto de Q3);
2. llama a `contarIntentosEnLote(ids)` — **una** consulta para todo el lote, no N+1;
3. cuenta como `primer_intento_ok` las entregas cuyo conteo es 0, **con las mismas coordenadas** que
   su fila de `entregas`.

De ahí sale `primer_intento_ok ≤ entregas` **por construcción**, y el `CHECK` de la base es la red
que impide persistir una fila mala si alguien rompe esa construcción (R18).

**Reproducibilidad, con la misma honestidad que D1:** `contarIntentos` cuenta intentos *hasta
ahora*, no *hasta el corte*. Una devolución posterior no cambia el pasado, pero **una anulación
posterior sí puede convertir en «primer intento» una entrega que no lo era**. Es la misma familia
que la rebaja de D1 y va en el aviso a la 125/128 (§13).

### 4.6 Tiempo de ciclo (Q5)

Numerador y denominador, jamás el promedio (R19/R21). Aporta la orden cuya transición a un estado de
`ESTADOS_TERMINALES` cae en `V`:

```
seg = EXTRACT(EPOCH FROM (h.created_at - o.created_at))::bigint
```

- **Atribución a la fecha del evento terminal** (D4 de la 123), no a la de creación.
- **Una sola contribución por orden y fecha**: si una orden entra a terminal, se revierte y vuelve a
  entrar el mismo día (posible con las reversiones de incidente #54–#58), se toma la **última**
  transición terminal del día. Si vuelve a terminal en otra fecha, aporta otra vez **en esa otra
  fecha**: es un hecho nuevo, y la suma de `seg_ciclo_n` deja de ser «órdenes distintas» para ser
  «cierres de ciclo». Queda escrito aquí porque no es obvio.
- `BIGINT` en el numerador. Prisma lo mapea a `BigInt` de JS: **no se serializa a JSON** (R32) y la
  división para obtener el promedio la hace la 126, después de sumar.

### 4.7 Los escalares de reconciliación (Q6)

Siete conteos escalares del día, calculados **sin** agrupar y por un camino distinto del de Q1–Q5.
Son el material de R34 (§7). Copiar la consulta de Q1–Q5 y quitarle el `GROUP BY` **no** vale: la
reconciliación dejaría de ser independiente y solo comprobaría que el mismo error da el mismo
resultado dos veces.

## 5. Escritura: idempotencia, filas rancias y atomicidad

**Una transacción por fecha, sin lotes** (R30, D9). Dentro, en este orden:

1. `marcaCorrida = now()` del servidor.
2. **Upsert** de cada cubo con `ON CONFLICT ON CONSTRAINT "analytics_daily_grano_key" DO UPDATE`
   (R28). El único lleva `NULLS NOT DISTINCT`, así que los cubos con `mensajero_id` o
   `causa_devolucion` nulos **sí** colisionan y se actualizan en vez de duplicarse. Producción corre
   **Postgres 17.6** (confirmado al cerrar la 123), así que la cláusula está disponible.
3. **Retirada de rancias (R29):** `DELETE FROM analytics_daily WHERE fecha = $fecha AND updated_at <
   $marcaCorrida`. Es lo que hace que un recomputo sea *desde cero* y no *acumulativo*.
4. **Reconciliación (R34)**, aún dentro de la transacción. Si falla, `ROLLBACK`.

**Alternativa evaluada y descartada: `DELETE` de la fecha + `INSERT` masivo.** Es más simple y
también idempotente, pero destruye `created_at` en cada corrida —el rastro de cuándo se calculó por
primera vez la fila, que la 123 puso a propósito (su R8)— y convierte cada recomputo en una
reescritura completa de la fecha, con su coste de WAL y de bloat. El upsert + barrido por
`updated_at` conserva la semántica de las dos columnas de rastro.

**Concurrencia (R31).** Dos corridas de la misma fecha solapadas son posibles (drenador cada minuto
+ reintento). El `dedupe_key` de la cola las evita en el caso normal; el `ON CONFLICT` las hace
inofensivas en el anormal. El paso 3 no puede borrar filas de la corrida rival: compara contra **su
propia** marca y las de la rival tienen `updated_at` posterior. El caso patológico de relojes
distintos no existe: `now()` es del servidor de Postgres, no del proceso Node.

**Sin lotes, a propósito (D9).** Partir la escritura abriría una ventana con la fecha a medias en la
tabla; R30 vale más que la latencia. El tamaño de la transacción se **mide** (R47) en vez de
suponerse, y con ese dato la 125 decidirá si algún día hace falta otra cosa.

## 6. Coordenadas: qué se congela y qué no (D1→A2)

| coordenada | ¿congelada? | fuente | ¿reproducible en un recomputo de la 125? |
|---|---|---|---|
| `estatus_id` | **sí** | `orden_historial_estado`, última transición `< corte` | **Sí, siempre** |
| `zona_id` | no | `orden.zona_id` en la corrida | **No** si la orden cambia de zona |
| `tienda_id` | no | `orden.tienda_id` en la corrida | **No** si cambia de tienda |
| `mensajero_id` (medidas de orden) | no | `orden.mensajero_asignado_id` en la corrida | **No** ante una reasignación |
| `mensajero_id` (medidas de gestión) | de hecho sí | `gestion_orden.mensajero_id`, que no se reescribe | Sí, salvo anulación |
| pertenencia al conjunto | no | `orden.deleted_at` (D7) | **No**: un borrado posterior retira la orden del pasado |

**La rebaja, escrita donde duele.** R35 de la 123 y su `design.md §6` prometen inmutabilidad hacia
atrás y le regalan a la 128 que «lo calculado una vez sigue valiendo». Tras A2 **eso vale para el
estatus y no para las otras tres coordenadas ni para la pertenencia al conjunto**. No se deja como
prosa: **R49 la fija con un test de caracterización** en las tres direcciones (a: estatus estable;
b: zona/tienda/mensajero cambian; c: la borrada desaparece), de modo que si alguien congela o
descongela algo sin decidirlo, el test se pone rojo y obliga a reabrir D1. Avisos en §13.

**Precedente del repo, para que la asimetría no parezca arbitraria:** `cierre_detail` (feature 69)
guarda `zona_id`, `tienda_id` y `es_central` como **columnas congeladas** precisamente porque son
mutables y guardar solo el FK dejaría abierto el vector de re-etiquetar cierres viejos. Allí se pagó
ese coste porque hay **dinero**. Aquí no lo hay y la tabla es derivada y reconstruible, así que la
decisión es la contraria — pero es una **decisión tomada**, no un descuido heredado.

## 7. La contención de R13 (pagaré (b), D5→(i))

**Capa 1 — estática (R26).** El módulo escritor no contiene literales de coordenada. Barato, y caza
el `zona_id: "TODAS"` escrito a mano. No caza lo importante.

**Capa 2 — reconciliación en la transacción (R34).** Para cada medida *m*:

```
SUM(m) sobre las filas escritas de la fecha D   ==   total escalar de m para D (Q6)
```

Por qué funciona contra el subtotal: una fila de totalización, por definición, **repite** valores ya
presentes en las filas finas, así que la suma del rollup supera al escalar y la transacción cae. Por
qué vale más que eso: la misma aserción caza el **doble conteo por `JOIN`**, la orden contada en dos
cubos y la gestión duplicada — fallos mucho más probables que alguien escribiendo un subtotal a
propósito, y que sin esto serían silenciosos.

Lo que **no** cubre: un subtotal que *sustituya* a las filas finas en vez de sumarse a ellas (la suma
cuadraría). Se declara. La capa 1, más el hecho de que cada fila salga de un `GROUP BY` real, lo
hacen inalcanzable sin escribir código deliberadamente retorcido.

## 8. Enganche (D4→C1) y horario (D3)

Patrón `liberar_reprogramadas`, calcado:

```ts
export const DEDUPE_PREFIX = "analitica_rollup_diario";
export function dedupeKeyRollup(fecha: string) { return `${DEDUPE_PREFIX}:${fecha}`; }
export const recurrenciaAnaliticaRollup: RecurrenciaSpec = { siguiente(now) { ... } };
```

- **Recurrencia:** próxima corrida = **00:30 CR (06:30 UTC)** del día siguiente, estrictamente
  posterior a `now`. **`dedupeKey` = la fecha que se va a agregar** (el día que cierra), no la fecha
  de la corrida: así dos siembras del mismo objetivo colisionan y el `enqueue` con
  `ON CONFLICT DO NOTHING` no duplica (R36).
- **Margen real, verificado en `vercel.json`:** `corte-diario` y `generar-gastos-fijos` arrancan a
  las `0 6 * * *`; `procesar-jobs` corre `* * * * *`. El rollup vence a las 06:30 UTC y se reclama
  en el minuto siguiente: **30 minutos contra el ARRANQUE del corte**, no contra su final, que nadie
  ha medido. Bajo A2 ese margen **ya no decide el estatus** —las transiciones `corte_sin_gestionar`
  llevan `created_at` = 00:00:00 CR del día siguiente, es decir el corte exacto, y la cota estricta
  las deja fuera (§3)—, pero sí afecta a las tres coordenadas no congeladas: **cuanto antes corra,
  menos deriva acumulan**. 00:30 es el equilibrio entre eso y no pisar al corte. Si algún día se
  midiera que el corte dura más de 30 minutos, lo que hay que revisar no es el estatus sino esa
  deriva.
- **Migración del enum:** `ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS
  'analitica_rollup_diario';` **va sola** en su carpeta (55P04), criterio ya escrito en
  `20260723120000_job_tipo_whatsapp_template_sync` y en
  `20260729140000_orden_historial_origen_deshacer_asignacion`. `down.sql`: Postgres no sabe quitar
  un valor de enum; se replica el patrón documentado de los cuatro `job_tipo_*` previos, no se
  inventa uno nuevo.
- **Nombre de la carpeta:** `scripts/db-rollback.ts` elige por **nombre de carpeta** ordenado, así
  que el timestamp debe dejarla como última; se verifica reproduciendo el criterio del script, no
  con `ls | tail`.
- **Invocación manual (R39):** script con la misma guarda de host que usó la 123 (aborta si el
  destino no es `localhost:5432/ordenex`) y **tope de antigüedad**: hoy o ayer. Cualquier fecha más
  vieja se rechaza remitiendo a la 125. Eso es lo que impide que esta feature se convierta en el
  backfill por la puerta de atrás — y es la contrapartida operativa de R35 estricto (D3/D8).

## 9. Los tres guardias heredados (D6→E1)

### 9.1 Drift datamodel↔migración (R40/R41) — pagaré (c)

Hoy `analytics-daily-migration.test.ts` compara el DDL derivado del datamodel
(`prisma migrate diff --from-empty --to-schema`) contra **el texto de `migration.sql` de la 123**, y
fija `expect(enLaMigracion.length).toBe(9)`.

**Por qué se cambia ahora y no cuando duela:** el día en que una migración legítima toque
`analytics_daily`, el test se pone **rojo sin que exista drift**, y la salida rápida a ese rojo es
editar un `migration.sql` **ya aplicado**, que rompe el checksum de `_prisma_migrations` en todos los
entornos donde corrió. Es un desastre disfrazado de arreglo de una línea. Bajo las decisiones
cerradas esta feature **no** añade DDL sobre la tabla (A2 no lo necesita), así que el cambio se hace
**en frío**, que es la única vez que se puede hacer bien.

**El cambio:** el conjunto de referencia pasa a ser la **unión, en orden de nombre de carpeta**, de
todas las migraciones cuyo `migration.sql` opera sobre `analytics_daily`, aplicando el efecto neto:

```
referencia = ⋃ (objetos creados por Mi)  −  (objetos eliminados o renombrados por Mj, j > i)
```

- Descubrimiento **por contenido**, no por lista a mano: una lista a mano vuelve a caducar en la
  siguiente feature.
- Se reconocen `CREATE [UNIQUE] INDEX`, `CONSTRAINT ... PRIMARY KEY|FOREIGN KEY`, y también
  `DROP INDEX`, `DROP CONSTRAINT` y `ALTER INDEX ... RENAME TO`: el punto es el efecto **neto**.
- El `toBe(9)` se sustituye por una red anti-vacío no numérica: **si el conjunto de referencia sale
  vacío, el test falla** por «el guardia no mide nada» (R41).
- Se conserva lo que ya estaba bien: los CHECK excluidos a propósito con su test que fija la
  exclusión, y **fallar con motivo escrito** si el CLI de Prisma no está, nunca saltarse.

**Mutación doble obligatoria (T5.1):** con una migración de prueba que crea un índice sobre la
tabla, (a) **declarada** en `schema.prisma` → **verde** (con el conjunto viejo sería rojo: ese es el
defecto que se arregla); (b) **no declarada** → **rojo**. Sin observar (b) el guardia está aflojado
y el cambio se revierte.

### 9.2 Frontera R44 (R42) — el guardia que caduca al mergear

`analytics-daily-guards.test.ts` afirma que ningún archivo de código nombra `analytics_daily` /
`analyticsDaily`, con dos excepciones del catálogo de la 135. Este job lo pone rojo el primer día,
**por hacer su trabajo**. Es el mismo mecanismo que ya explotó con `frontera.guardia.test.ts` de la
135 y que la 123 tuvo que escalar al leader.

Re-alcance (D6-E1), que **endurece** en vez de aflojar:

| antes | después |
|---|---|
| nadie nombra la tabla, salvo `types.ts` / `metrics.ts` | solo los **módulos declarados del escritor** (lista explícita en el test) la nombran, más las dos excepciones del catálogo |
| ningún acceso de ninguna clase | **ninguna LECTURA** desde ningún archivo: `findMany`, `findFirst`, `groupBy`, `aggregate`, `count`, `SELECT ... FROM analytics_daily` siguen prohibidos en todo el árbol, salvo las **dos** lecturas nombradas del propio job (reconciliación y barrido de rancias), en métodos con nombre fijo |
| — | **ningún segundo escritor**: cualquier archivo fuera de la lista que haga `upsert`/`createMany`/`delete` sobre la tabla → rojo |

Así el tripwire sigue armado para la 126, que es a quien de verdad iba dirigido. **Mutación en las
dos direcciones (T5.2):** lectura ajena → rojo; escritor ajeno → rojo; escritor legítimo → verde.

### 9.3 Tripwire de suma del stock (R43)

`ordenes_estado_stock` no debe sumarse entre fechas — **tampoco** para los tres estatus terminales,
donde D2-B2 la vuelve *de hecho* un flujo (§4.3): esa coincidencia no se explota.

El analizador actual marca la ventana de ±400 caracteres alrededor de la columna si contiene una
agregación (`SUM(`, `_sum`, `sum:`, `groupBy`, `aggregate`) y **no** está clavada a una fecha única.
El escritor de esta feature **va a caer ahí sin cometer ninguna infracción**: nombra
`ordenesEstadoStock`, usa `groupBy` (sobre `orden`, no sobre el rollup) y tiene `desde`/`hasta` en
la misma ventana de texto. Un falso positivo aquí es peor que inútil: la reacción natural sería
renombrar variables o meter una excepción, y las dos desarman el guardia para el consumidor real.

**Cambio:** exigir que la columna esté **dentro** de la expresión agregada —`SUM(ordenes_estado_stock)`,
`_sum: { ordenesEstadoStock`, o una reducción explícita sobre ella— y no que meramente comparta
ventana con un `groupBy` cualquiera. Las seis cadenas sintéticas que el archivo ya trae son el juez:
**las tres malas siguen rojas y las tres buenas verdes**, más dos casos nuevos: escritor legítimo
→ verde, agregación real sobre un rango dentro de un `groupBy` → rojo. Si alguna de las tres malas
dejara de detectarse, el cambio está mal y no se acepta.

## 10. Volumen (D9)

Cardinalidad por día ≈ cubos `(zona × tienda × mensajero × estatus × causa)` con actividad, más el
universo B2 del stock. Nadie lo ha medido, y **el diseño no lo supone: lo mide y lo reporta** (R47).
Cada corrida deja filas escritas, filas retiradas y duración en milisegundos; el umbral de aviso vive
en **una sola constante** (`lib/config/analitica-rollup.ts`) con un comentario que dice, sin
eufemismos, que es **provisional y no está medida**. Los umbrales de verdad los fijará la 125 con
estos datos.

B2 acota el crecimiento a «trabajo en curso + cierres del día», que es lo que evita que la tabla
crezca de forma cuadrática con el archivo histórico. Aun así **la retención sigue sin decidirse**
(D5 de la 123) y esta feature la vuelve urgente por el simple hecho de empezar a escribir.

## 11. Alternativas descartadas

1. **No congelar nada y rebajar R35 entero (D1-A1).** Dejaba el rollup no auditable: dos corridas
   legítimas del mismo día darían cifras distintas **en todas** las coordenadas y sin forma de saber
   cuál era la buena. A2 salva la dimensión que más se mueve y que además es reproducible gratis
   —el historial ya existe y es inmutable— y declara el resto (R49).
2. **Congelar las cuatro en una tabla de snapshot por orden y día (D1-A3).** Reproducibilidad total
   hacia adelante, a cambio de una fila por orden viva y por día, con la retención sin decidir; y
   sin arreglar el pasado, que seguiría siendo irreproducible para la 125.
3. **Embudo literal del catálogo, todas las órdenes de la historia (D2-B1).** Cada día
   re-fotografiaría el archivo entero: crecimiento cuadrático de una tabla sin política de purga.
   B2 conserva el significado operativo del embudo y se declara a la 126/135 (§13).
4. **Colgar el rollup de `CorteDiarioService` (D4-C3).** Metería una agregación analítica dentro de
   la transacción del cierre, que es **money-critical**: un fallo del rollup abortaría cierres del
   día. Además el corte no maneja fechas: trabaja por «gestiones sin cierre».
5. **Un cron propio en `vercel.json` (D4-C2).** Otro disparador y otro secreto para no ganar nada:
   sin reintento, un fallo transitorio de un minuto cuesta el día entero.
6. **Recalcular «los últimos N días» en cada corrida** para absorber las anulaciones tardías.
   Derogaría R35 **en silencio** y quitaría a la 128 la simplificación de que el pasado no se
   invalida. La respuesta correcta es programar la **125** sobre un rango explícito: visible y
   auditable (D3/D8).
7. **Escribir por lotes (D9).** Abriría una ventana con la fecha a medias en la tabla. R30 vale más
   que la latencia; y el coste real todavía no está medido, así que optimizarlo ahora sería adivinar.
8. **Inventar un tope de filas por día.** Un número sin medición se convierte en una alarma que
   nadie cree o en un fallo que nadie entiende. Se mide primero (R47) y se decide después.
9. **Un solo `SELECT` con `FULL OUTER JOIN` entre órdenes y gestiones.** Ahorra viajes y compra el
   doble conteo entre universos de cardinalidad distinta, con resultado plausible.
10. **Materializar `sin_gestionar` como medida propia.** Prohibido por R19 de la 123: dato duplicado
    que puede contradecir a su origen.
11. **Reimplementar «primer intento» con un `COUNT` propio.** Sería la segunda definición de intento
    del repo, cuando la 160 existe para que solo haya una (la misma que decide reintento-vs-escalado,
    que mueve dinero).
12. **Guardar el promedio de ciclo en vez del par numerador/denominador.** El modo de fallo que
    `sonSumables()` existe para señalar.
13. **`createMany({ skipDuplicates: true })`.** Parece idempotente y no lo es: no actualiza el cubo
    cuyas medidas cambiaron. Es la versión perezosa del bug de R29.
14. **Dejar el tripwire como está y meter el escritor en una lista de exenciones.** Una exención por
    archivo se copia en el siguiente PR y a los tres meses el guardia solo vigila a quien no sabe
    que la lista existe. Se arregla el analizador (§9.3).

## 12. Verificación

| capa | qué cubre | archivo previsto |
|---|---|---|
| unit — composición de cubos | R10–R21, R22–R26, R33 | `tests/unit/analytics/rollup-service.test.ts` (tablas en memoria, sin DB) |
| unit — fecha objetivo y cotas | R5–R9 | `tests/unit/analytics/rollup-dia.test.ts` |
| unit — handler y recurrencia | R35, R36, R38 | `tests/unit/services/analitica-rollup-handler.test.ts` |
| unit — registro en el drenador | R36 | ampliación de `tests/unit/api/procesar-jobs-registro.test.ts` |
| integración con Postgres **local** | R1, R18, R20, R27–R31, R34, R45, R46, R49 | `tests/integration/db/analytics-daily-job.test.ts` |
| guardias re-alcanzados | R40–R43, R3, R4, R26, R37, R47 | los dos archivos de la 123, modificados |
| migración del enum | R36 | `tests/integration/db/job-tipo-analitica-rollup-migration.test.ts` |

**Casos de datos que la suite de integración tiene que sembrar** (cada uno con su mutación en
`requirements.md`): día sin órdenes; orden sin mensajero; orden con dos cambios de estatus el mismo
día; **dos transiciones con el mismo `created_at`** (determinismo del desempate); **la transición
del corte a las 00:00:00 CR del día siguiente**, que NO debe entrar (cota estricta); la pareja de
medianoche (23:59:59 CR y 00:00:00 CR); gestión anulada; **orden borrada** (D7); devolución sin
causa; orden de la zona A gestionada por mensajero de la zona B; orden desasignada después de
gestionar; entrega al primer intento y entrega tras una devolución; orden creada hace cinco días y
entregada hoy; orden que entra a terminal, se revierte y vuelve el mismo día; **orden entregada hace
tres días, que NO debe aparecer en el stock de hoy** (D2-B2); estatus huérfano; re-ejecución; cubo
que desaparece entre corridas; corrida que falla a mitad; fechas vecinas D−1 y D+1 intactas; y los
tres casos de caracterización de **R49**.

**E2E: no aplica**, con su razón: no hay camino de usuario. El riesgo se cubre con datos reales
contra `localhost:5432/ordenex` y con la reconciliación, más fuerte que cualquier Playwright para un
job. **Producción no se toca ni para leer**, en ningún paso, ni siquiera para medir volumen.

## 13. Avisos dirigidos (lo que otras features heredan de estas decisiones)

> Esta sección es el equivalente de `specs/135-.../design.md §6.1` y es **la que la 126, la 125 y la
> 128 tienen que leer**. Se propone además al leader como `status_note` de cada ficha.

- **→ 125 (backfill), de D1→A2 y D7.** El backfill reproduce **solo `estatus_id`**. Recomputar el
  día D después de una reasignación de mensajero, un cambio de zona o de tienda **produce
  coordenadas distintas de las que escribió la 124**, y recomputarlo después de un borrado
  (`deleted_at`) **retira contribuciones que ese día existieron**. Es el comportamiento acordado, no
  un defecto: está fijado por `R49` de la 124. Consecuencia operativa: **un backfill sobre un rango
  ya agregado no es una operación neutra**; hay que invocarlo sabiendo que reescribe coordenadas.
  El mismo matiz afecta a `primer_intento_ok`, cuyo criterio se evalúa *ahora* y no *al corte* (§4.5).
- **→ 128 (caché), de D1→A2 y D7.** El regalo de la 123 —«la invalidación de un día pasado no
  existe»— **queda rebajado**: sigue siendo cierto **mientras nadie recompute** y es estructuralmente
  cierto solo en la dimensión `estatus`. Si la 125 recomputa un rango, la caché de ese rango **hay
  que invalidarla**, y no por el día en curso sino por el rango recomputado. Diseñar la caché
  suponiendo lo contrario es un bug esperando a la primera corrección de datos.
- **→ 126 (operativa), de D2→B2.** `ordenes_por_estado` se lee ahora como **«órdenes VIVAS por
  estado», más las que cerraron ese día**: el rollup ya no contiene el archivo histórico de
  terminales. El histórico de terminales se sirve de las medidas de **flujo** (`entregas`,
  `devoluciones`, `rechazos`, `incidentes`), que sí son aditivas. Para los tres estatus terminales
  la columna parece sumable por fecha: **no se suma** (R43 sigue vigente sobre la columna entera).
  Y de D3: **el día en curso no tiene rollup**; lo sirve la 126 en vivo.
- **→ 135 (catálogo), de D2→B2.** La 124 se aparta de la lectura literal de
  `ordenes_por_estado.definicion.estados = ORDER_STATUS_SEED`. O el catálogo acota esa definición, o
  queda declarada la divergencia. Es una discrepancia **de contrato**, no de implementación, y por
  eso se avisa en vez de resolverse aquí.
- **→ 122 (alcance por rol).** Sin cambios: el recorte por zona sigue aplicándose sobre
  `orden.zona_id` (D9 de la 135), que es exactamente lo que el rollup escribe (R22).

## 14. Riesgos y follow-ups

- **La reproducibilidad parcial (D1→A2 + D7)** es el riesgo principal vivo. No se esconde: está en
  §6, en R49 y en los avisos de §13. El peligro real es que alguien lea R35 de la 123 sin leer esto.
- **`primer_intento_ok` no es reproducible al 100 %** (§4.5): misma familia.
- **La grieta de la anulación** (declarada por la 123) sigue viva y direccional (exceso). Corrección
  deliberada vía 125; **no se afloja R35** (D3/D8).
- **Retención y purga**: follow-up abierto de D5 de la 123, que esta feature **vuelve urgente**
  porque empieza a escribir. B2 acota el ritmo; no lo elimina.
- **El margen de 30 minutos contra el corte** está medido contra su **arranque**, no contra su
  final, que nadie ha cronometrado. Bajo A2 no afecta al estatus, solo a la deriva de las
  coordenadas no congeladas.
- **El guardia de drift conserva dos puntos ciegos** que esta feature no cierra y que se repiten
  aquí para que no se pierdan: compara **solo nombres** (un cambio de tipo, nulabilidad o default no
  lo ve) y **no mira la base real** (un índice borrado a mano allí sigue siendo invisible).
- **`./init.sh` viene rojo de `dev`** por deuda de lint heredada. El criterio de esta feature es
  **delta 0** medido en la rama, no verde absoluto, y el baseline se mide antes de tocar nada —nunca
  se cita el de la bitácora, que caduca con cualquier PR ajeno.
