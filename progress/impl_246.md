# Feature 246 — bitácora de implementación (BACKEND)

> **Alcance de esta bitácora: sólo las tandas de BACKEND** — T1, T2, T3, T5.1, T6, T7.1-T7.5 y la
> parte de T8.1 que toca código de servidor. **T4 (los dos modales), T5.2 y T5.3 (la card del
> mensajero) NO están hechas**: van en el mismo PR, con el subagente de frontend, y lo que les
> dejo preparado está en «Lo que queda para la pantalla».
>
> **Sin commit.** El árbol queda mutado y sin tocar git (ni `checkout`, ni `stash`, ni `commit`).

---

## ⚠️ LO PRIMERO, PORQUE CONDICIONA TODO LO DEMÁS

### 1 · El árbol está compartido con la ficha 240, y se nota

Mientras yo trabajaba, otro agente implementaba la **240** en el **mismo árbol**. Sus cambios y los
míos conviven ahora mismo en `git status`. Dos consecuencias que hay que leer antes que los números:

- **Comparto DOS archivos con ella**, y el spec decía que no habría solape:
  `lib/repositories/CierreDiaRepository.ts` y `lib/interfaces/repositories/ICierreDiaRepository.ts`
  (más el test `tests/unit/repositories/cierre-dia-repository.test.ts`). Tocamos **métodos
  distintos** —ellos la familia «gestión de la tienda» y el origen del historial, yo
  `corteSinGestionar` y el `data` de `anularGestionYDevolverAGestion`— y hoy conviven sin
  contradecirse, pero **quien reparta los commits por rutas tiene que saberlo**.
- **Mis medidas están tomadas sobre un árbol que otro agente mutaba en paralelo.** Eso vale para
  esta tanda, pero **no vale como gate**: `./init.sh` completo hay que correrlo con el árbol
  quieto, cuando las dos fichas hayan terminado.

**Rojos ajenos que aparecieron y se fueron mientras yo trabajaba** (los dejo escritos porque
explican corridas intermedias de esta bitácora, no porque queden abiertos):

| Rojo | De quién | Estado al cerrar |
| --- | --- | --- |
| `superficie-de-uso.guardia.test.ts` — «`lib/actions/resolver-novedad.ts:162 rechazarNovedad` sin superficie» | **240** | ya en verde |
| `novedad-acciones-catalogo.test.ts` — «grupo devolucion: falta `habilitar`» | **240** | ya en verde |

**Lo que SÍ queda abierto y no es mío: OCHO archivos de la 240 están en CRLF** y en este repo eso
rompe las guardias que censan código (ver el punto 2). Son
`app/(app)/novedades/_components/{NovedadAcciones,NovedadesModule,RechazarNovedadModal}.tsx`,
`app/(app)/novedades/_components/novedad-acciones-catalogo.ts`,
`tests/components/{NovedadAcciones,NovedadesModule}.test.tsx`,
`tests/unit/services/cierre-dia-service.test.ts` y
`tests/unit/types/novedad-acciones-catalogo.test.ts`. **No los toco: no son míos.** Que lo sepa
quien reparta los commits — hoy no rompen nada, pero es una bomba de relojería para la siguiente
guardia que cense esos archivos.

### 2 · Un fallo mío, encontrado y corregido: CRLF

Escribí muchos archivos con Python y, en Windows, eso convirtió **42 archivos de LF a CRLF**.
No es cosmético: en este repo, **las guardias que censan código quitan comentarios con
`(^|[^:])//.*$`**, y `.` en JavaScript **no casa `\r`**, así que con CRLF **ningún comentario de
línea se quita** y las guardias empiezan a acusar a la prosa. Lo cazó
`nota-privada-retirada.guardia.test.ts` acusando tres comentarios históricos que llevaban meses ahí.

**Corregido**: los **41 archivos míos** están de vuelta en LF, **comprobado byte a byte** al
cerrar (`b"
" in open(f,"rb").read()` sobre todo `git diff --name-only HEAD` + los no
rastreados: cero). Los que siguen en CRLF son los OCHO de la 240 listados arriba, y **no los toco**.

**Lección para la próxima**: escribir siempre en binario (`open(p, "wb")`), nunca en modo texto.

### 3 · Las mediciones de T0 — ya tomadas, y una invirtió una decisión mía

**Las tomó el leader** (yo no tengo MCP) y están en `progress/medicion_246_t0.md`. Lo que cambian:

| # | Resultado | Efecto en el trabajo |
| --- | --- | --- |
| **M5** ⚠️ PROXY | **2 de 26** asignadas después de las 18:00 CR | Orden de magnitud pequeño. **No es una medida de conducta operativa**: producción se usa hoy como entorno de pruebas, así que mide **cómo se ha probado la app**, no cómo se opera. |
| **M6** | `premio_ranking` pos. 1 = **₡5.000**; **pos. 2 y 3 en `NULL`, sin configurar**. **₡10.000 repartidos en toda la historia** (2 podios) | **No hay urgencia de dinero detrás de D7.** Y el matiz que el spec ya avisaba: `NULL` **no es «no hay premio», es «no está configurado»** — si mañana se configuran, el importe se multiplica. |
| **M7** ⚠️ PROXY | — | Con M6 al lado: **el riesgo del día del despliegue (el podio falso) es más caro que el importe en juego**. Es el argumento que hace que la mutación **T7.4 no se pueda saltar nunca**. |
| **M8** | **Invirtió la decisión del índice** | Sección propia más abajo. |

**M1, M2, M3 ya estaban** en `progress/medicion_246.md`. **M4 sigue sin aparecer** en ninguno de los
dos archivos.

**T0.5 queda cerrada** con esos tres números; **T0.6 (M8) también**, con la salvedad de volumen que
se explica abajo.

### 4 · D10 — FIRMADA el 2026-08-20: el tablero **NO** sigue al ranking

`TableroDiaRepository` **no cambia de criterio** y **T6.7 queda `N/A`**. La firma va **en contra de
la recomendación del diseño**, y el porqué quedó escrito en `requirements.md` §D10 y en la sección
«PUERTA HUMANA PASADA»: las dos pantallas **no miden lo mismo**. El tablero responde «¿qué carga le
eché **hoy** a este mensajero?» —una pregunta de **operación**, y para ésa `asignado_at` es el dato
correcto—; el ranking responde «¿de qué día es esta orden a efectos de su porcentaje?». Alinearlos
le habría quitado al tablero su propia respuesta.

**Lo que la firma sí obliga, y está hecho:** corregir su comentario de cabecera, que afirmaba que
`asignado_at` «es el denominador del ranking diario». **Con D7 eso dejó de ser cierto se firme D10
como se firme.** El comentario nuevo dice qué mide cada cifra, que **pueden diferir el mismo día**
desde el despliegue, y que es deliberado — porque dos cifras distintas sin explicación se leen como
un error de la app.

**D11 ya está firmada** (solo hacia adelante, no se recalcula): implementado tal cual — ni una línea
que reescriba `ranking_snapshot_*`.

---

## El timestamp de la migración

```
db/migrations/20260820180000_orden_fecha_reparto/
```

**Cómo se eligió** (T0.3): la última en `origin/dev` era `20260820120000_orden_historial_origen_gestion_tienda_ayuda`.
La **240 ya tenía una en el árbol** y **la movió mientras yo trabajaba**: de `20260820160000` a
`20260820190000_orden_historial_origen_rechazo_tienda`. La mía, `...180000`, queda **entre las dos y
sin colisión** en ninguno de los dos momentos.

⚠️ **Efecto colateral de ese renombrado, para quien migre en local**: mi base local tiene registrado
en `_prisma_migrations` el nombre viejo (`20260820160000_...`), cuya carpeta ya no existe. Es drift
de la 240, no mío, pero se va a ver.

⚠️ **`pnpm run db:rollback` revierte la ÚLTIMA carpeta por orden alfabético**, que ahora es la de la
240. Para revertir la mía hay que aplicar su `down.sql` a mano.

---

## El índice — la decisión se INVIRTIÓ con el `EXPLAIN` de producción

> ⚠️ **Lo que este apartado decía en la primera versión de esta bitácora era una respuesta correcta
> a una pregunta mal formulada.** Se deja la corrección entera y no sólo la conclusión, porque el
> error intermedio es más fácil de repetir que de detectar. El razonamiento con sus **tres**
> versiones vive en `design.md` §2.1; aquí van **los números**.

### La premisa que faltaba

El `EXPLAIN` de producción (M8, corrido por el leader) mostró que la consulta del denominador
**hoy no hace ningún recorrido completo**:

```
GroupAggregate
  ->  Index Only Scan using orden_mensajero_asignado_id_asignado_at_idx on orden o
        Index Cond: (mensajero_asignado_id IS NOT NULL
                     AND asignado_at >= … AND asignado_at < …)
```

**`Index Only Scan`. No toca el heap.** Y ese índice **ya existía** desde la 76.

Con eso delante, la pregunta no era «¿hace falta un índice nuevo?» sino **«¿el `OR` sobre
`fecha_reparto` rompe el `Index Only Scan` que la consulta ya tenía?»**. El riesgo no era quedarse
sin índice: era **perder uno que funcionaba**, porque `fecha_reparto` no está dentro de él.

### Los cuatro planes, medidos

Base local, `enable_seqscan = off` para forzar la **forma** del plan (ver abajo por qué no por
coste). Cada escenario creó y destruyó sus índices, y el estado se restauró y se verificó contra
`pg_indexes`.

```
================ 1 — compuesto (msj, asignado_at) + orden_fecha_reparto_idx  [lo que yo había hecho]
GroupAggregate
  ->  Sort
        ->  Bitmap Heap Scan on orden o                          ← ⚠️ VUELVE AL HEAP
              Recheck Cond: ((fecha_reparto = '2026-08-20') OR (fecha_reparto IS NULL))
              ->  BitmapOr
                    ->  Bitmap Index Scan on orden_fecha_reparto_idx
                    ->  Bitmap Index Scan on orden_fecha_reparto_idx

================ 2 — sólo el compuesto de dos columnas
GroupAggregate
  ->  Index Scan using orden_mensajero_asignado_id_idx on orden o  ← ⚠️ TAMBIÉN toca el heap
        Index Cond: (mensajero_asignado_id IS NOT NULL)
        Filter: ((fecha_reparto = …) OR ((fecha_reparto IS NULL) AND (asignado_at >= …) AND …))

================ 3 — compuesto AMPLIADO (msj, asignado_at, fecha_reparto)   [lo que se aplica]
GroupAggregate
  ->  Index Only Scan using tmp_msj_asig_fecha on orden o          ← ✅ NO toca el heap
        Index Cond: (mensajero_asignado_id IS NOT NULL)
        Filter: ((fecha_reparto = …) OR ((fecha_reparto IS NULL) AND (asignado_at >= …) AND …))

  ...y la consulta de HOY sigue servida por el mismo índice, con el Index Cond IDÉNTICO:
GroupAggregate
  ->  Index Only Scan using tmp_msj_asig_fecha on orden o
        Index Cond: ((mensajero_asignado_id IS NOT NULL)
                     AND (asignado_at >= …) AND (asignado_at < …))   ← el PREFIJO se conserva

================ 4 — ampliado + un índice (fecha_reparto, msj)
GroupAggregate
  ->  Index Only Scan using tmp_msj_asig_fecha on orden o    ← el segundo índice NO se usa
```

### Lo que los números dicen, y lo que decidí con ellos

1. **`orden_fecha_reparto_idx` no arreglaba el problema: lo empeoraba.** Es lo bastante atractivo
   para que el planificador elija un `BitmapOr`, y **un `BitmapOr` no es un `Index Only Scan`**: el
   `Bitmap Heap Scan` que lo remata vuelve al heap. Sin ese índice (escenario 2) el plan al menos se
   queda en un `Index Scan`. **El índice que yo había creado era el peor de los tres.**
2. **La cobertura SÍ se puede recuperar** (escenario 3): basta con que `fecha_reparto` sea la
   **tercera columna clave** del compuesto que ya existe. Entonces todas las columnas de la consulta
   viven en el índice y el plan vuelve a `Index Only Scan`. **La degradación no es inevitable.**
3. **El prefijo se conserva** — medido, no supuesto: `TableroDiaRepository.cteIdsDelDia` y el
   denominador de la 76 siguen con **el mismo `Index Cond`**. *(El orden importa:
   `(fecha_reparto, msj, asignado_at)` **no** serviría ese prefijo. Hay un caso de test que fija el
   orden de las tres columnas justo por eso.)*
4. **Un índice por `fecha_reparto` a secas no aporta nada** ni siquiera junto al ampliado
   (escenario 4): el planificador no lo mira.

**Decisión: se AMPLÍA el índice existente y NO se crea ninguno nuevo.**

```sql
CREATE INDEX "orden_mensajero_asignado_at_fecha_reparto_idx"
  ON "orden" ("mensajero_asignado_id", "asignado_at", "fecha_reparto");
DROP INDEX IF EXISTS "orden_mensajero_asignado_id_asignado_at_idx";
```

**El número de índices de `orden` no sube.** Se sustituye uno por su versión de tres columnas: el
coste de escritura en la tabla más caliente sube por **4 bytes de ancho de entrada**, no por un
índice entero más. Es **estrictamente más barato** que lo que yo había hecho.

### Lo que ningún índice arregla — coste de D7, declarado y no escondido

Con el `OR`, el `Index Cond` se reduce a `mensajero_asignado_id IS NOT NULL` y **se pierde el
acotado por rango de `asignado_at`**: un btree **no puede** expresar una disyunción entre **dos**
columnas como un rango. El plan sigue sin tocar el heap, pero pasa de leer **la porción de un día** a
leer **el índice entero** — la población de órdenes asignadas, que sólo crece.

**Eso es el precio de contar el denominador por dos criterios a la vez, no un defecto de la
implementación.** Y tiene una salida, **medida**: partir el `OR` en **dos consultas** y sumar los
mapas. Con el mismo índice ampliado, las dos ramas recuperan su `Index Cond` estrecho:

```
rama (a)  Index Only Scan · Index Cond: (mensajero_asignado_id IS NOT NULL
                                         AND fecha_reparto = '2026-08-20')
rama (b)  Index Only Scan · Index Cond: (mensajero_asignado_id IS NOT NULL
                                         AND asignado_at >= … AND asignado_at < …
                                         AND fecha_reparto IS NULL)
```

La (b) es **exactamente la forma de hoy** con el `IS NULL` empujado **dentro** del `Index Cond`. Y
la disjunción se volvería **más** fácil de probar, no menos: dos consultas disjuntas que se suman.

**No lo hago en esta ficha**, y el motivo es de proceso, no técnico: reestructuraría la consulta que
decide el podio **justo después de firmarla**, y con ella los casos y las mutaciones (T7.4, T7.5)
que la protegen. Queda **nombrado en `design.md` §2.1** para que sea decisión y no descubrimiento.

### ⏳ Por qué esto está medido por FORMA y no por coste

**Ninguna de las dos bases tiene volumen para decidir por el plan**: producción tiene **141 órdenes
vivas** y la local **67**. A esa escala el planificador hace `Seq Scan` **con índice y sin él**, y
hace bien. Todo lo de arriba se midió con `enable_seqscan = off`, que fuerza al planificador a
enseñar **qué plan indexado es capaz de construir** —que es exactamente la pregunta— pero **no dice
nada de qué elegirá cuando la tabla crezca**.

**Re-medir con volumen antes de confiar en cualquiera de estos planes.** Está escrito también en el
`migration.sql` y en `design.md` §2.1, para que no se pierda en una bitácora.

### El round-trip, rehecho contra la nueva versión

Revertí a mano la versión vieja (su `down.sql` ya no existía en disco), volví a aplicar y corrí el
ciclo entero **con los ficheros tal cual**, vía `prisma db execute`:

```
### UP (aplicado por prisma migrate deploy)
  columna fecha_reparto: {"data_type":"date","is_nullable":"YES","column_default":null}
  idx: orden_mensajero_asignado_at_fecha_reparto_idx => USING btree (mensajero_asignado_id, asignado_at, fecha_reparto)
  idx: orden_mensajero_asignado_id_idx               => USING btree (mensajero_asignado_id)
  R19: 67 filas, 0 con fecha_reparto no nula          ← CERO backfill

### DOWN
  columna fecha_reparto: AUSENTE
  idx: orden_mensajero_asignado_id_asignado_at_idx => USING btree (mensajero_asignado_id, asignado_at)   ← REPUESTO
  idx: orden_mensajero_asignado_id_idx             => USING btree (mensajero_asignado_id)

### DOWN OTRA VEZ (idempotencia)
  (idéntico: no falla y no cambia nada)

### UP re-aplicado
  columna fecha_reparto: {"data_type":"date","is_nullable":"YES","column_default":null}
  idx: orden_mensajero_asignado_at_fecha_reparto_idx => USING btree (mensajero_asignado_id, asignado_at, fecha_reparto)
  R19: 67 filas, 0 con fecha_reparto no nula
```

**El `down` repone el índice de dos columnas**, y eso es la mitad que un descuido se salta: el `up`
**sustituyó** el compuesto de la 76, así que un `down` que sólo soltara la columna dejaría la base
**sin ese índice** — y con él se iría el `Index Only Scan` del que dependen el denominador **y**
`TableroDiaRepository`. Eso no sería «devolver la base al estado anterior»: sería dejarla **peor**.
Hay un caso de test que lo afirma, y otro que exige que la reposición vaya **antes** de los `DROP`.

**Producción no se ha tocado.** Ni una sentencia.

### Una guardia de dinero paró el cambio de índice, y tenía razón

Al ampliar el índice, `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` se puso
**roja**:

```
 × la feature no añade ninguna migracion que toque la columna (R37/R59)
 Test Files  1 failed | 1026 passed (1027)
      Tests  1 failed | 13515 passed (13516)
```

Esa guardia mantiene una **lista blanca de qué migraciones pueden tocar `asignado_at` en SQL vivo**,
y lo dice sin rodeos: *«esto es una lista blanca de QUIEN PUEDE TOCAR el denominador del pago al
mensajero. Una entrada de más es permiso concedido a quien nunca lo pidió»*. Mi migración nombra la
columna en un `CREATE INDEX` y en un `DROP INDEX`, así que entra en el censo.

**Lo cómodo habría sido enseñarle que «un `CREATE INDEX` no toca la columna». No lo hice, y no por
escrúpulo:**

- **sería falso en el sentido que importa.** Quien puede reindexar puede **reordenar**, y reordenar
  las columnas de ese índice le quita el plan a `TableroDiaRepository` sin romper nada más — es
  justo el fallo silencioso contra el que la guardia existe;
- **contradiría su propio precedente.** La entrada original de esa lista
  (`20260716120000_orden_asignado_at`) está ahí precisamente por su `ADD COLUMN` **+ `CREATE
  INDEX`**. Para esta lista, **indexar es tocar**. Relajarla sería cambiarle la regla a la guardia
  para que me dejara pasar.

**Lo que hice: declarar el permiso y ACOTARLO, de modo que la guardia queda más estricta que antes.**

1. Las dos entradas de la 246 entran en la lista blanca, **con el porqué escrito ahí mismo** — que
   es lo que su cabecera pedía («si aparece una tercera, hay que mirarla a mano»).
2. Y entra un **caso nuevo** que hace que ese permiso **no sea un cheque en blanco**: exige, sentencia
   a sentencia, que en esas dos entradas `asignado_at` aparezca **únicamente** dentro de un
   `CREATE INDEX` o un `DROP INDEX`. Un `UPDATE` sobre la columna cae por ahí **antes** de que la
   lista blanca parezca haberlo autorizado.

**Y lo comprobé rompiéndolo**, porque una guardia que no se ha visto en rojo no es evidencia:

| Mutación | sha antes | sha mutado | sha después |
| --- | --- | --- | --- |
| Añadir `UPDATE "orden" SET "asignado_at" = NOW()` al `migration.sql` | `312f02ab964a7721` | `1b5723b32d0a00e8` | `312f02ab964a7721` |

```
 × 246: el permiso nuevo es SOLO para indexar — ni una escritura sobre la columna
AssertionError: 20260820180000_orden_fecha_reparto/migration.sql toca `asignado_at` fuera de un indice:
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

**R33 sigue intacto**: esta ficha **lee** `asignado_at` y la **acompaña**; no cambia quién la
escribe ni cuándo. Indexar no es escribir — pero sí es un permiso, y por eso se pide en voz alta.

### Y una nota de higiene que apareció por el camino

`specs/246-asignacion-por-dia/requirements.md` estaba en el árbol con **CRLF**, contra la regla que
el propio repo se dio (`.gitattributes`: `* text=auto eol=lf`, «se materializa LF en el working
tree»). Git no lo delata porque normaliza al commitear, pero es exactamente cómo vuelve el problema
de finales mixtos que ese archivo describe. Lo he normalizado al editarlo. **`progress/medicion_246.md`
sigue igual y no lo toco** — no es mío.

---

## Qué construí, por tanda

### T1 — la columna y el vocabulario *(inerte)*

- **T1.1** `db/migrations/20260820180000_orden_fecha_reparto/{migration.sql,down.sql}` +
  `db/schema.prisma` (`fechaReparto DateTime? @map("fecha_reparto") @db.Date`, y el compuesto
  `(mensajeroAsignadoId, asignadoAt)` **ampliado** a `(…, fechaReparto)` — ver la sección del
  índice: **no se crea ninguno nuevo**).
  El `migration.sql` lleva su razonamiento entero arriba (D1, D2, D3, por qué `DATE`, por qué sin
  backfill, por qué sin `CHECK`, y **las tres versiones de la decisión del índice**). El `down.sql`
  declara **las dos consecuencias operativas** de revertir —el corte vuelve a barrer lo reservado
  **y** el denominador vuelve a `asignado_at`— y **repone el índice de dos columnas**, que es la
  mitad que un descuido se salta.
- **T1.2** `lib/types/dia-reparto.ts` **(NUEVO)** — `DIA_REPARTO`, `DiaReparto`, `diaRepartoSchema`.
  Un solo enum para las dos superficies (D4).
- **T1.3** `lib/utils/dia-reparto.ts` **(NUEVO)** — `resolverFechaReparto(dia, now)` sobre
  `startOfDayCR`, con reloj inyectable. **Y una pieza que el diseño no tenía**:
  `fechaRepartoComoTexto(fecha)`, ver «Desviaciones».

### T2 — el corte *(inerte con la columna en `NULL`)*

- **T2.1** `CorteDiarioService.ejecutarCorte(now = new Date())` y
  **`diaQueElCorteCierra(now) = startOfDayCR(now) − 1 día`**, exportada y con el porqué del ancla
  escrito entero: por qué la ingenua barre justo lo que la ficha protege, y por qué se retrasa —
  nunca se pierde— un barrido si el cron se adelanta.
- **T2.2** `ICorteDiarioRepository.findMensajerosConActividadSinCierre(diaCerrado)` — **parámetro
  obligatorio**. El `where` de la rama (b) gana
  `OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaCerrado } }]`.
- **T2.3** `CorteSinGestionarInput` gana **`diaCerrado`** (obligatorio, dentro del input y no como
  argumento suelto, para que sea *literalmente* el mismo valor que filtró la selección). El mismo
  `OR` va en el **pre-`SELECT`** y en el **`where` del `updateMany`**.

### T3 — la asignación escribe el día

- **T3.1** `asignarBodegaSchema` y `asignarSateliteSchema` ganan `dia: diaRepartoSchema.default("hoy")`.
  Las dos Server Actions lo pasan **tal cual**.
- **T3.2** `GuiaAsignacionService.asignarDesdeBodega(input, actor, now?)` y
  `AsignacionSateliteService.asignar(input, actor, now?)` llaman a `resolverFechaReparto` **una vez**
  y pasan la fecha ya resuelta.
- **T3.3** `OrdenRepository.asignarBodegaLote(..., fechaReparto)` (en el mismo `data` que
  `asignadoAt`) y `asignarSateliteLote(..., fechaReparto)` (en el mismo `SET`, **parametrizado**).
- **T3.4** `CierreDiaRepository.anularGestionYDevolverAGestion` estampa `fechaReparto: startOfDayCR()`
  junto a `asignadoAt` (R8).
- **T3.5** Limpieza en **SEIS** sitios, no cinco (ver «Desviaciones»): `OrdenRepository`
  (`deshacerAsignacionLote` y `rutearBodegaSateliteLote`), `CierresAdminRepository`,
  `DevolucionSlaRepository`, `LiberacionReprogramadaRepository` y **`RecuperacionBodegaRepository`**.
- **T3.6** `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` **(NUEVO)** —
  censo del árbol con autocomprobación. **Encontró un séptimo sitio que el spec no listaba**
  (`generarGuiaLote`); ver «Desviaciones».
- **T3.7** `MiAsignacionRow.fechaReparto` en la proyección que ya existía (`WITH_ASIGNACION`), sin
  consulta nueva.

### T5.1 — lo que ve el mensajero *(la parte de servidor)*

`MisAsignacionesService.listarMisAsignaciones(actor, now?)` deriva **`esParaManana`** con
`startOfDayCR(now)`, calculado **una vez por listado**. Sin cuarto grupo, sin ocultar nada, sin
bloquear nada. La **fecha cruda no viaja al DTO**: el navegador no vuelve a decidir qué día es hoy.

### T6 — el denominador del ranking *(D7)*

- **T6.1** `IRankingRepository.contarAsignadasPorMensajero(desde, hasta, diaReparto)` — tercer
  parámetro **obligatorio, sin default**.
- **T6.2** La consulta con el `OR` de **dos ramas disjuntas**, y la cabecera de `RankingRepository`
  reescrita entera (las dos ramas, por qué la segunda lleva `fechaReparto: null`, por qué no es un
  `COALESCE`, y por qué el respaldo no se retira aunque envejezca).
- **T6.3** `RankingService` calcula el tercer valor con **`fechaComoDate(hoyCR)`** —el **mismo**
  helper que el snapshot— y `RankingSnapshotService` con `fechaComoDate(fecha)`, que además es
  *literalmente el mismo valor* que congela en la cabecera. Ver «Desviaciones» sobre por qué
  `fechaComoDate` y no `startOfDayCR`.
- **T6.4** El caso del día del despliegue vive en `ranking-repository.test.ts`, que es donde está el
  `WHERE`.
- **T6.5** `lib/ranking/orden-ranking.ts`, `premio_ranking` y el cron del snapshot: **ni una línea
  modificada**. Comprobado en `git status`.
- **T6.6** `ranking-ventana-dia.guardia.test.ts` **ampliada, no relajada**: los literales prohibidos
  siguen intactos y se le añade un bloque que exige que las dos convenciones no se crucen.
- **T6.7** **`N/A` mientras D10 no se firme**, con el comentario del tablero corregido (arriba).

### T8.1 — comentarios al día

`ESTADOS_A_BARRER` en `CorteDiarioRepository` · el bloque `corteSinGestionar` de
`CierreDiaRepository` · la cabecera de `startOfDayCR` en `lib/utils/fecha-cr.ts` (con sus
consumidores) · la cabecera de `RankingRepository` · el comentario del **tablero** · el **⛔ de
`lib/ranking/snapshot-dia.ts`**, que ahora distingue «no uses `startOfDayCR` como cota de un
`timestamp`» de «este archivo produce medianoches UTC a propósito».

---

## Desviaciones del diseño, y por qué

### 1 · `fechaRepartoComoTexto` — una pieza que el diseño no tenía *(y hacía falta)*

`asignarSateliteLote` escribe con **SQL crudo**. Ahí Prisma **no sabe** que la columna destino es
`DATE`: el driver `pg` serializa un `Date` de JS como `timestamptz` con el **offset local del
proceso Node**, y Postgres lo convierte a `date` usando el **`TimeZone` de la sesión**. Con la
sesión en UTC sale el día correcto; **con la sesión en `America/Costa_Rica` sale el anterior**.

Es decir: pasar el `Date` tal cual habría dejado el día de reparto **a merced de la configuración
del servidor de base de datos**. Se pasa un texto `YYYY-MM-DD` con un `::date` **explícito**: no
interviene ninguna zona horaria y `'2026-08-21'::date` es el 21 en cualquier sesión. El `SET` **no**
lleva `NOW()::date` ni `AT TIME ZONE`, y hay aserciones que lo vigilan.

### 2 · Los sitios de limpieza son SEIS, no cinco — y hay un SÉPTIMO estampado

`tasks.md` (T3.5) listaba cinco. El árbol tiene **seis**: faltaba
**`RecuperacionBodegaRepository.recuperarABodega`**.

Y la **guardia de T3.6 encontró un séptimo sitio que ninguna lista mencionaba**:
`OrdenRepository.generarGuiaLote`, que estampa `asignadoAt` condicionalmente cuando la decisión
lleva mensajero. Tras la 156 esa rama está **muerta en la práctica** (generar guía ya no decide
mensajero), pero **el día va igualmente**, por dos motivos: la invariante R10 es «las dos columnas
se escriben juntas», y una excepción «porque hoy no pasa» es justo la clase de excepción que un día
deja de serlo. **Esto es exactamente para lo que se pidió la guardia**, y es la mejor evidencia de
que hacía falta un censo y no una lista.

### 3 · `fechaComoDate` en vez de `startOfDayCR` en `RankingService`

El diseño (T6.3) decía «`RankingService` calcula el tercer valor con `startOfDayCR`». **No lo hago**,
y el resultado es **el mismo valor** por otra puerta:

- `ranking-ventana-dia.guardia.test.ts` **prohíbe el literal `startOfDayCR`** en `RankingService.ts`
  desde la 166. Escribirlo habría obligado a **relajar** esa guardia; T6.6 pide justo lo contrario.
- `fechaComoDate(hoyCR)` es **literalmente la misma función** que usa el snapshot congelado, así que
  **R41 se cumple por construcción**: el vivo y el congelado no pueden divergir en la convención de
  esta fecha ni queriendo.

### 4 · Una mutación de más que el spec no pedía, y por qué la añadí

T7.2 (quitar el `OR` del `updateMany`) **sólo tumba aserciones de FORMA**, porque el pre-`SELECT`
—que sigue teniendo el `OR`— ya deja fuera la orden reservada y el `updateMany` nunca la ve. Eso es
correcto pero flojo, así que corrí **la mutación complementaria (T7.2b)**: quitar el `OR` del
pre-`SELECT` dejándolo en el `updateMany`. **Ésa sí tumba un caso de comportamiento**: el historial
registra una transición de la orden reservada **que nunca ocurrió**. Las dos están abajo.

---

## Tabla de mutaciones — con salida REAL y sha256 (16 primeros)

Cada una: sha antes → mutar → `vitest` → **rojo citado** → revertir → **sha de vuelta al original**.
Ninguna se reporta sin haber ejecutado su suite.

| # | Qué se muta | sha antes | sha mutado | sha después | Veredicto |
| --- | --- | --- | --- | --- | --- |
| **T7.1** | `diaQueElCorteCierra` → el ancla ingenua `startOfDayCR(now)` | `3c22ea5d150eec66` | `42c3cd374cdfd307` | `3c22ea5d150eec66` | **9 rojos** |
| **T7.1b** | El `OR` sale del `where` de la **selección** del corte | `58d449113d707278` | `4d11f0ccb2667cbe` | `58d449113d707278` | **7 rojos** |
| **T7.2** | El `OR` sale del **`updateMany`** (se queda en el pre-`SELECT`) | `aad9649014a8f147` | `a96d1f55070064da` | `aad9649014a8f147` | **2 rojos** (repo) · **servicio VERDE** |
| **T7.2b** | El `OR` sale del **pre-`SELECT`** (se queda en el `updateMany`) | `aad9649014a8f147` | `47d0dcb74df8b4a4` | `aad9649014a8f147` | **3 rojos**, uno de comportamiento |
| **T7.3** | Se cae `fechaReparto: null` en **uno** de los seis sitios | `fb03146e4bed5a08` | `7a59ac944fe60a7d` | `fb03146e4bed5a08` | **3 rojos** (el sitio **y** la guardia) |
| **T7.4** | **La rama de respaldo del ranking desaparece** (R37/R43) | `fd8a11c7ce15ce7b` | `915261634e7a1b1b` | `fd8a11c7ce15ce7b` | **3 rojos** · **servicios VERDES** |
| **T7.5** | Se cae `fechaReparto: null` de la rama de respaldo (ramas no disjuntas) | `fd8a11c7ce15ce7b` | `339e1b07ae8ab2cb` | `fd8a11c7ce15ce7b` | **3 rojos**, con el doble conteo medido |
| **T7.6** | `resolverFechaReparto` usa `inicioDelDiaCREnUtc` (riesgo 3) | `ef534453d189525e` | `2e4bf88a41201093` | `ef534453d189525e` | **14 rojos** |
| **T7.7** | `esParaManana` con `>=` en vez de `>` | `a59c12bf469c4e1b` | `89e77a80cf48ddf0` | `a59c12bf469c4e1b` | **2 rojos** |
| **T7.8** | Un `UPDATE` sobre `asignado_at` dentro del `migration.sql` *(la guardia de dinero)* | `312f02ab964a7721` | `1b5723b32d0a00e8` | `312f02ab964a7721` | **1 rojo** |

### Los rojos, citados

**T7.1 — el ancla del corte** (`corte-diario-seleccion.test.ts` + `corte-diario-service.test.ts`):

```
 × EL CASO DE LA FICHA: la 1.ª corrida la respeta, la 2.ª la barre
 × ninguna orden puede quedar protegida DOS noches: el maximo reservable es un dia (D2)
 × R14: sus UNICAS señales son ordenes protegidas -> NO se le crea cierre `vencido`
 × R15: con una protegida Y otra no protegida, SI entra — y el barrido va guardado por dia
 × la proteccion alcanza a `ayuda_tienda` igual que a `en_reparto` (235 intacta)
 × EL ANCLA: corriendo a las 00:00 CR del 21, el dia que se cierra es el 20 — no el 21
 × si el cron se ADELANTA a las 23:5x CR del 20, cierra el 19: retrasa un barrido, no lo pierde
 × cada corrida avanza su ancla un dia: la proteccion caduca sola (R13)
AssertionError: expected { mensajerosEvaluados: 1, …(2) } to deeply equal { mensajerosEvaluados: +0, …(2) }
AssertionError: expected '2026-08-21T00:00:00.000Z' to be '2026-08-20T00:00:00.000Z'
 Test Files  2 failed (2)
      Tests  9 failed | 17 passed (26)
```

**T7.1b — el `OR` de la selección**:

```
 × R14: sus UNICAS ordenes son de mañana -> NO entra en el corte (no recibe `vencido`)
 × la proteccion alcanza tambien a `ayuda_tienda`, no solo a `en_reparto` (235 intacta)
 × R11/R16: el `where` lleva el `OR` con EL MISMO valor de `diaCerrado` que recibio
 × EL CASO DE LA FICHA: la 1.ª corrida la respeta, la 2.ª la barre
AssertionError: expected [ { mensajeroId: 'm-manana', …(1) } ] to deeply equal []
AssertionError: expected undefined to deeply equal [ { fechaReparto: null }, …(1) ]
 Test Files  2 failed (2)
      Tests  7 failed | 24 passed (31)
```

**T7.2 — el `WHERE` del barrido. Y AQUÍ ESTÁ LA MEDIDA QUE EL REPO PEDÍA:**

```
--- repositorio (donde vive el WHERE) ---
 × R4/R22: transiciona en_reparto -> sin_gestionar GUARDADO por estatus_id=en_reparto; conserva mensajero
 × 235/R26: barre las de `en_reparto` Y las de `ayuda_tienda` en la MISMA transaccion
AssertionError: expected { id: { in: [ 'o1', 'o2' ] }, …(2) } to deeply equal { id: { in: [ 'o1', 'o2' ] }, …(3) }
 Test Files  1 failed (1)
      Tests  2 failed | 85 passed (87)

--- servicio (dobles: NO ve el WHERE) ---
 Test Files  2 passed (2)
      Tests  26 passed (26)          ← VERDE con el WHERE mutado
```

**Quinta medición del mismo hecho en este repo**: la suite de servicio **no ve el `WHERE`**.

**T7.2b — el `OR` del pre-`SELECT`** (el complementario, y el que sí muerde el comportamiento):

```
 × R4/R22: transiciona en_reparto -> sin_gestionar GUARDADO por estatus_id=en_reparto; conserva mensajero
 × 235/R26: barre las de `en_reparto` Y las de `ayuda_tienda` en la MISMA transaccion
 × R11: el historial NO registra la reservada — no hubo transicion que registrar
AssertionError: expected [ 'o-hoy', 'o-manana' ] to deeply equal [ 'o-hoy' ]
 Test Files  1 failed (1)
      Tests  3 failed | 84 passed (87)
```

Se lee así: **el historial registraría una transición de la orden reservada que nunca ocurrió**.

**T7.3 — la limpieza** (un sitio, y la guardia de censo):

```
 × TODA escritura que fija o limpia `asignado_at` toca también `fecha_reparto`
 × una escritura que limpia `asignado_at` limpia el día a NULL, no lo deja con valor
 × R15/R18/R19: UPDATE guardado por estatus=devuelta -> destino, limpia mensajero + asignadoAt, append actor NULL
AssertionError: Estas escrituras tocan `asignado_at` y NO tocan `fecha_reparto`:
AssertionError: lib/repositories/DevolucionSlaRepository.ts limpia `asignado_at` pero no pone `fecha_reparto` a NULL: expected false to be true
 Test Files  2 failed (2)
      Tests  3 failed | 18 passed (21)
```

**T7.4 — LA MÁS CARA. La rama de respaldo del ranking (el podio del día del despliegue):**

```
--- repositorio ---
 × R37/R43: una orden SIN dia de reparto cuenta por `asignado_at` — el respaldo
 × R43: MEZCLA del dia del despliegue — sin salto artificial en el denominador
 × el `where` tiene la forma de DOS ramas y ninguna condicion de fecha suelta
AssertionError: expected [] to deeply equal [ { mensajeroId: 'm1', total: 1 } ]
AssertionError: expected [ { mensajeroId: 'm1', total: 2 } ] to deeply equal [ { mensajeroId: 'm1', total: 5 } ]
 Test Files  1 failed (1)
      Tests  3 failed | 9 passed (12)

--- servicios del ranking (vivo + snapshot) ---
 Test Files  2 passed (2)
      Tests  65 passed (65)          ← VERDES con el denominador roto
```

**`total: 2` donde debían ser `5`.** Ése es el salto: el denominador cae, los porcentajes suben
todos a la vez y **el podio de ese día es falso para todos**. Y los servicios no se enteran.

**T7.5 — las ramas disjuntas** (el doble conteo):

```
 × R38: asignada HOY para MAÑANA — no cuenta hoy
 × RAMAS DISJUNTAS: ninguna orden se cuenta DOS veces en dos dias distintos
 × el `where` tiene la forma de DOS ramas y ninguna condicion de fecha suelta
AssertionError: expected [ { mensajeroId: 'm1', total: 1 } ] to deeply equal []
AssertionError: expected 2 to be 1
 Test Files  1 failed (1)
      Tests  3 failed | 9 passed (12)
```

**`expected 2 to be 1`**: la misma orden aportando a **dos** días.

**T7.6 — el helper de fecha equivocado** (riesgo 3, la trampa de la 166):

```
 × 23:59 CR del 20 (05:59Z del 21): «hoy» es el 20
 × 18:00 CR del 20 (00:00Z del 21): sigue siendo el 20, no el 21
 × NO usa `inicioDelDiaCREnUtc`: la fecha resuelta NO lleva las 06:00 dentro
 × no usa `inicioDelDiaCREnUtc` en el CODIGO (nombrarla en el comentario es obligatorio)
 × R5: `dia: "manana"` -> la fecha CR del dia SIGUIENTE, no un booleano
AssertionError: expected '2026-08-20T06:00:00.000Z' to be '2026-08-20T00:00:00.000Z'
 Tests  14 failed
```

**T7.7 — `esParaManana` con `>=`**:

```
 × R26: la de HOY y la SIN FECHA llegan con `esParaManana: false`
 × R25: al pasar el dia, LA MISMA FILA pasa a `false` sin ninguna escritura
AssertionError: expected true to be false
 Test Files  1 failed (1)
      Tests  2 failed | 74 passed (76)
```

---

## Mapa `R<n> → test` — **cada archivo comprobado, ejecutado por nombre**

> ⚠️ En cinco fichas seguidas este mapa citó tests que no existían. Aquí **todos los archivos se
> han ejecutado por nombre y se ha comprobado que corren casos**. `(NUEVO)` = lo trae esta ficha.
> Las filas marcadas **[FRONTEND]** están **pendientes**: son de T4/T5.2/T5.3 y NO las he escrito.

| Req | Test | Estado |
| --- | --- | --- |
| R1 | `tests/components/AsignarBodegaModal.test.tsx` | **[FRONTEND] pendiente** |
| R2 | `tests/components/AsignarSateliteModal.test.tsx` | **[FRONTEND] pendiente** |
| R3 | `tests/unit/services/guia-asignacion-service.test.ts` — «R3: UNA asignacion, UN dia de reparto — el lote entero recibe la misma fecha» · `asignacion-satelite-service.test.ts` — «R3: el lote entero recibe LA MISMA fecha, en una sola llamada» | ✅ |
| R4 | `tests/unit/types/dia-reparto-schema.test.ts` **(NUEVO)** — «R4 — una peticion SIN el campo se comporta como «hoy», y no falla» (los dos schemas) · `tests/integration/actions/ordenes-guia-action.test.ts` — «asignarDesdeBodega» · `tests/integration/actions/asignacion-satelite-action.test.ts` — «R7: happy path delega…» | ✅ |
| R5 | `tests/unit/utils/dia-reparto.test.ts` **(NUEVO)** — los dos `describe` de fronteras (00:00 CR y medianoche UTC) | ✅ |
| R6 | `dia-reparto-schema.test.ts` **(NUEVO)** — «R6: una FECHA no es un valor aceptable» · `guia-asignacion-service.test.ts` — «R6: la fecha la pone el SERVIDOR — el input no tiene por donde colar una» | ✅ |
| R7 | `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts` — el `SET` lleva `"fecha_reparto" = …::date` y el valor viaja parametrizado · `orden-repository.guia.test.ts` — el `data` de `asignarBodegaLote`, igualdad EXACTA · `guia-asignacion-service.test.ts` — «R7: la fecha va en la MISMA llamada que fija el mensajero» | ✅ |
| R8 | `tests/unit/repositories/cierre-dia-repository.test.ts` — «246/R8 — deshacer gestion re-estampa asignacion Y dia de reparto» (2 casos) | ✅ |
| R9 | `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts` — el `SET` lleva `"fecha_reparto" = NULL` · `devolucion-sla-repository.test.ts` · `liberacion-reprogramada-repository.test.ts` · `recuperacion-bodega-repository.test.ts` · `orden-repository.guia.test.ts` (ruteo a satélite) | ✅ |
| R10 | `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` **(NUEVO)** — censo del árbol, 4 casos + 5 de autocomprobación | ✅ |
| R11 | `tests/unit/repositories/cierre-dia-repository.test.ts` — «R11: la orden reservada para MAÑANA no se barre…» · `corte-diario-repository.test.ts` — «R14: sus UNICAS ordenes son de mañana…» (**mutaciones T7.1b/T7.2/T7.2b**) | ✅ |
| R12 | `cierre-dia-repository.test.ts` — «R12: la de AYER y la SIN FECHA se barren exactamente como antes» y «R12: la reservada para HOY … SI se barre» | ✅ |
| R13 | `tests/unit/services/corte-diario-seleccion.test.ts` — «EL CASO DE LA FICHA: la 1.ª corrida la respeta, la 2.ª la barre» y «ninguna orden puede quedar protegida DOS noches» (**mutación T7.1**) | ✅ |
| R14 | `corte-diario-repository.test.ts` — «R14: sus UNICAS ordenes son de mañana -> NO entra en el corte» · `corte-diario-seleccion.test.ts` — «R14: sus UNICAS señales son ordenes protegidas -> NO se le crea cierre `vencido`» | ✅ |
| R15 | `corte-diario-seleccion.test.ts` — «R15: con una protegida Y otra no protegida, SI entra…» · `cierre-dia-repository.test.ts` — «R15: MEZCLA — se barren solo las NO protegidas y la reservada queda intacta» | ✅ |
| R16 | `tests/unit/services/corte-diario-service.test.ts` — «el MISMO `diaCerrado` llega a la seleccion y a `crearCierre`» + el `toEqual` exacto de `corteSinGestionar` + typecheck (parámetro obligatorio en las dos capas) | ✅ |
| R17 | `tests/unit/utils/dia-reparto.test.ts` **(NUEVO)** — «R17 — la fuente no introduce una segunda definicion del dia» · `corte-diario-service.test.ts` — «R17: el ancla es la convencion `@db.Date`…» · la guardia de T3.6 (`R17: ninguna escritura … hace aritmética de zona horaria en el SQL`) | ✅ |
| R18 | `corte-diario-repository.test.ts` — «R18: la rama de GESTIONES SIN CERRAR no cambia…» · `tests/integration/actions/corte-diario-route.test.ts` **verde sin tocar** | ✅ |
| R19 | `tests/integration/db/orden-fecha-reparto-migration.test.ts` **(NUEVO)** — «R19: NULLABLE y SIN DEFAULT» y «R19: sin backfill» · `corte-diario-repository.test.ts` — «R19/R20: sus ordenes NO tienen dia de reparto -> SI entra» · **y la comprobación contra la base local: 67 filas, 0 con fecha** | ✅ |
| R20 | `cierre-dia-repository.test.ts` — «R20: `NULL` significa UNA cosa — el predicado no pregunta «¿es de hoy?»» | ✅ |
| R21 | `orden-fecha-reparto-migration.test.ts` **(NUEVO)** — el `describe` del `down.sql` (4 casos, incluido «declara POR ESCRITO las dos consecuencias operativas») · **round-trip real up→down→up arriba** | ✅ |
| R22 | `tests/components/RecogerModule.test.tsx` / `RepartoModule.test.tsx` | **[FRONTEND] pendiente** |
| R23 | `tests/unit/services/mis-asignaciones-service.test.ts` — «R23: la reservada NO se oculta — aparece en su grupo de siempre» | ✅ |
| R24 | `mis-asignaciones-service.test.ts` — «R24: la reserva NO cambia nada de lo que el mensajero puede hacer» (la mitad de servidor; la de la Server Action es **[FRONTEND]**) | ✅ parcial |
| R25 | `mis-asignaciones-service.test.ts` — «R25: al pasar el dia, LA MISMA FILA pasa a `false` sin ninguna escritura» (**mutación T7.7**) | ✅ |
| R26 | `mis-asignaciones-service.test.ts` — «R26: el DTO no lleva la fecha cruda» y «R26/R17: a las 23:59 CR el dia sigue siendo el 20» | ✅ |
| R27 | `tests/components/SelectorDiaReparto.test.tsx` | **[FRONTEND] pendiente** |
| R28 | `tests/components/AsignarBodegaModal.test.tsx` | **[FRONTEND] pendiente** |
| R29 | `tests/components/SelectorDiaReparto.test.tsx` | **[FRONTEND] pendiente** |
| R30 | Todas las guardias money-safe **verdes sin tocar**. **Su verde es coherencia, no evidencia**: ninguna ejercita la columna nueva, porque la columna no toca dinero — y ésa es exactamente la afirmación | ✅ |
| R31 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` y `tests/unit/guards/censo-catalogo-estados-v2.test.ts` verdes sin que yo los tocara. ⚠️ **La 240 SÍ los toca** (abre una arista): su verde no es evidencia de nada mío | ✅ (ver nota) |
| R32 | `tests/unit/services/webhook-estado-encolado.test.ts` y `tests/integration/repositories/orden-webhook-enqueue.test.ts` verdes sin tocar | ✅ |
| R33 | `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` — **la guardia SÍ se tocó, y para hacerla más estricta**: la ficha entra en su lista blanca (indexa la columna) y a cambio se le añade el caso «246: el permiso nuevo es SOLO para indexar», con su autocomprobación y su mutación (**T7.8**). Esta ficha sigue sin escribir `asignado_at` | ✅ |
| R34 | `tests/unit/guards/recoleccion-no-contamina.test.ts` verde sin tocar | ✅ |
| R35 | `tests/unit/repositories/gestion-orden-repository.test.ts` — «246/R35: pide `fechaReparto` en el select y la emite CRUDA» y «una orden sin reserva emite `null`» | ✅ |
| R36 | `tests/unit/repositories/ranking-repository.test.ts` — «R36: una orden RESERVADA para ese dia cuenta en su denominador» | ✅ |
| R37 | ídem — «R37/R43: una orden SIN dia de reparto cuenta por `asignado_at` — el respaldo» (**mutación T7.4**) | ✅ |
| R38 | ídem — «R38: asignada HOY para MAÑANA — no cuenta hoy» y «…y SI cuenta mañana» | ✅ |
| R39 | ídem — «246/R39: el numerador sigue anclado a `gestion_orden.created_at`» · `ranking-service.test.ts` — «R39: el NUMERADOR sigue recibiendo DOS argumentos» | ✅ |
| R40 | `tests/unit/services/ranking-service.test.ts` — «246/R40 — la asimetria declarada: entregar hoy algo reservado para mañana» | ✅ |
| R41 | `ranking-service.test.ts` — «246/R41 — el vivo pasa el dia de reparto con la convencion `@db.Date`» (5 casos) · `ranking-snapshot-service.test.ts` — «R41: los dos pasan TRES argumentos, y el tercero tiene la MISMA convencion» y «R41: en este caso miran EL MISMO dia» | ✅ |
| R42 | `ranking-snapshot-service.test.ts` — «R42: una re-corrida sobre una fecha ya congelada NO reescribe nada» | ✅ |
| R43 | `ranking-repository.test.ts` — «R43: MEZCLA del dia del despliegue — sin salto artificial en el denominador» (**mutación T7.4**) | ✅ |
| R44 | **M8, no un test**: los cuatro `EXPLAIN` están arriba. **Un test no puede afirmar un plan de ejecución**, y fingir que sí sería una aserción contra su propia fuente. Lo que **sí** se atornilla con tests es la FORMA del índice —tres columnas, en ese orden, sustituyendo y no sumando— en `orden-fecha-reparto-migration.test.ts` (4 casos), porque el orden de las columnas **es** el requisito: `(fecha_reparto, msj, asignado_at)` no serviría el prefijo del que depende `TableroDiaRepository` | ✅ (⏳ re-medir con volumen) |
| R45 | Los tests de `lib/ranking/orden-ranking.ts` y `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` verdes **sin una línea modificada** | ✅ |
| R46 | `ranking-snapshot-service.test.ts` — «R46: el dia congelado es el MISMO que filtro el denominador» y «R46: no hay escritura posible que mueva el denominador de un dia ya congelado» | ✅ |

---

## Lo que dejo para la pantalla (T4, T5.2, T5.3)

**El backend ya lo acepta todo; la pantalla sólo tiene que mandarlo y pintarlo.**

- **El contrato de entrada** ya existe: las dos Server Actions aceptan
  `dia: "hoy" | "manana"` (`lib/types/dia-reparto.ts`). **Sin el campo, se comporta como «hoy»** —
  y eso es una trampa conocida y declarada: un modal que se olvide de mandarlo **no rompe nada y
  nadie se entera**. Por eso T4.2/T4.3 exigen un caso que afirme que **el modal manda la opción
  elegida**, no sólo que el selector cambie de estado.
- **Las etiquetas del día NO se calculan en el navegador** (R29). El servidor ya sabe hacerlo:
  `fechaCalendarioCR(now)` y `mananaCalendarioCR(now)` en `lib/utils/fecha-cr.ts`. Tienen que bajar
  **por props desde el Server Component de la página**.
- **La card del mensajero** ya recibe `esParaManana: boolean` en `MiAsignacionDTO`, **ya resuelto en
  el servidor**. Sólo hay que pintarlo **con palabras** («Para mañana»), no sólo con color: el repo
  tiene guardia de contraste y una lección escrita sobre medir color en el navegador.
- **La fecha cruda NO viaja al cliente**, a propósito. Si la pantalla necesitara la fecha, hay que
  decidirlo — no añadirla de tapadillo.
- **El selector va en `components/shared/`** porque se usa en dos sitios, y **sobre la primitiva de
  `components/ui/`** (`npx shadcn add radio-group` si falta), nunca un componente propio.
- **Recorrido de T7.7 («ver la app»): no lo he hecho.** Es de frontend y necesita las dos pantallas.

---

## Decisiones que quedan abiertas, para que sean decisión y no descubrimiento

- **D10** — ¿el tablero del día sigue al ranking? **ABIERTA.** Recomendación del diseño: sí. Hoy no
  lo sigue, y el comentario del tablero ya lo dice.
- **D8** — cambiar el día de una orden ya asignada sin deshacer la asignación. **Fuera de alcance.**
  Hoy hacen falta dos gestos (deshacer + reasignar). Hueco operativo real y barato de cerrar después.
- **D9** — ver el día de reparto en el listado general de órdenes. **Fuera de alcance**, y es la
  **primera candidata a seguimiento**: sin ella, bodega no puede responder «¿qué dejé asignado para
  mañana?» sin abrir orden por orden.
- **D6** — el formulario a caballo de la medianoche. **Diseñado y NO implementado**, con M1 detrás:
  la asignación más tardía de los últimos 30 días es a las **20:00**, no hay masa entre las 23:00 y
  la 01:00. Si eso cambia, el escape está escrito en `design.md` §4.4.
- **Ninguna ficha nueva registrada.** Borrador antes de registrar, y mirando `origin/dev` para no
  colisionar ids.

---

## Salidas reales del gate

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

(sin salida = cero errores)
```

### `pnpm run lint`

```
✖ 97 problems (0 errors, 97 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**Cero errores.** Los 97 warnings son `@typescript-eslint/no-unused-vars` sobre parámetros `_algo`
de dobles de test, **preexistentes** y repartidos por todo el árbol; ninguno está en un archivo mío.

### `pnpm exec vitest run tests/unit tests/integration`

```
 Test Files  1027 passed (1027)
      Tests  13518 passed (13518)
   Duration  154.47s (transform 34.40s, setup 41.69s, import 400.30s, tests 227.39s, environment 126.51s)
```

**Cero rojos.** Incluye las guardias completas (`pnpm exec vitest run guard`: 124 archivos, 1833
casos) y los `tests/integration/db/**`, que hablan con el Postgres local.

⚠️ **Este número está medido sobre un árbol que la 240 mutaba en paralelo.** Sirve como cierre de
MI tanda; **no vale como gate de PR**. `./init.sh` completo hay que correrlo **con el árbol quieto**,
cuando las dos fichas hayan terminado — es literalmente la lección que este repo ya tiene escrita
(«el gate lee el árbol mutado por el subagente y su veredicto no vale»).

---

## Dos rojos que aparecieron en la corrida completa y que NO había visto antes

Los dejo escritos porque los dos son de la clase «lo que la corrida dirigida no ve», que es
exactamente por lo que la suite entera existe.

**1 · `tests/integration/repositories/deshacer-asignacion.trazabilidad-carga.test.ts` (2 rojos).**

```
Error: base en memoria: asignacion SET no soportada -> -- Feature 246 (T3.5
```

Ese test interpreta el `UPDATE` crudo de `deshacerAsignacionLote` con **una base en memoria que
parsea el `SET` asignación por asignación**, y yo había metido un comentario `--` **dentro** de la
cláusula. **Corregido subiendo el comentario fuera del template**, y dejando escrito en el propio
código por qué va arriba — para que el siguiente no lo vuelva a meter dentro. No es estética: es
que ahí dentro hay un parser.

**2 · `tests/unit/repositories/orden-repository.guia.test.ts` — `generarGuiaLote` con mensajero.**

```
-       "asignadoAt": Any<Date>,
+       "asignadoAt": 2026-08-20T17:04:34.137Z,
        "estatusId": "os-por_recoger",
+       "fechaReparto": 2026-08-20T00:00:00.000Z,
        "mensajeroAsignadoId": "m1",
```

Es **la rama que la guardia de T3.6 me obligó a arreglar**, y resulta que **sí tenía un test que la
ejercitaba** — así que la rama no estaba tan muerta como el comentario de la 156 sugiere. Aserción
actualizada con `fechaReparto: expect.any(Date)` y el porqué al lado. **Que este rojo apareciera es
la mejor prueba de que la guardia no sobraba.**

---

## ¿Quedó completo el mapa `R<n> → test`? — respuesta directa

**De los 46 requisitos: 39 cubiertos con test ejecutado, 1 cubierto por medición (R44), 6 pendientes
del frontend.** No hay ningún requisito sin dueño. El detalle:

**Los 6 huecos, todos de las tandas de pantalla que no me tocaban** (T4 y T5.2-T5.3):

| Req | Qué falta | Archivo que lo cubrirá |
| --- | --- | --- |
| R1 | «manda `manana` cuando se elige» | `tests/components/AsignarBodegaModal.test.tsx` |
| R2 | ídem, espejo satélite | `tests/components/AsignarSateliteModal.test.tsx` |
| R22 | la card lee el **texto** «Para mañana» | `RecogerModule.test.tsx` · `RepartoModule.test.tsx` |
| R27 | «Hoy» preseleccionado | `SelectorDiaReparto.test.tsx` **(NUEVO)** |
| R28 | confirma para qué día quedó el lote | `AsignarBodegaModal.test.tsx` |
| R29 | las etiquetas llegan por props, no del reloj del navegador | `SelectorDiaReparto.test.tsx` **(NUEVO)** |

**Un requisito cubierto a medias, y lo digo en vez de pintarlo verde:** **R24** («no se le impide
recoger ni gestionar»). La mitad de servidor está probada —la card llega completa y con su estado
intacto—; la mitad que falta es el caso de componente que afirma que **la Server Action de recoger
sí se llama** sobre una orden reservada. Es de T5.3.

**Un requisito que a propósito NO tiene test, y por qué:** **R44**. Lo cubre **M8**, no una
aserción. **Un test no puede afirmar un plan de ejecución**, y escribir uno que lo fingiera sería
una aserción contra su propia fuente. Lo que sí está atornillado con tests es la **forma** del
índice —tres columnas, en ese orden, sustituyendo y no sumando—, porque el orden **es** el
requisito: `(fecha_reparto, msj, asignado_at)` no serviría el prefijo del que depende
`TableroDiaRepository`.

**Dos avisos sobre cómo leer los verdes de este mapa**, para que nadie los cobre por más de lo que
valen:

- **R30** (money-safe) y **R31/R32/R34**: su verde es **coherencia, no evidencia**. Ninguna de esas
  guardias ejercita la columna nueva — porque la columna no toca dinero, no crea estados y no emite
  webhooks. **Ésa es exactamente la afirmación**, no un descuido.
- **R31** en concreto: sus dos guardias están **también** tocadas por la 240, que sí abre una arista.
  Su verde no es evidencia de nada mío.

**Todos los archivos citados en el mapa se ejecutaron por nombre y se comprobó que corren casos.**
`vitest` no falla con un filtro que no casa nada: lo ignora en silencio, y en cinco fichas seguidas
este mapa mintió por eso.

---

## Veredicto

**Backend de la 246 terminado y verde**: la columna con su migración reversible y su round-trip
real, el corte anclado al día que CIERRA, la asignación escribiendo el día en las dos superficies,
la invariante vigilada por un censo que ya encontró un sitio que el spec no listaba, el
`esParaManana` del portal, y el denominador del ranking con sus dos ramas disjuntas y su rama de
respaldo probada por la mutación más cara de la ficha.

**No está terminada la ficha**: faltan **T4 y T5.2-T5.3 (frontend)** y el recorrido de T7.7. **T0
está cerrada** (M5/M6/M7/M8 tomadas por el leader; **M4 nunca apareció**) y **D10 y D11 están
firmadas**.

**Lo único que queda vivo del backend es una re-medición, no una tarea**: los planes de ejecución
están medidos por FORMA, no por coste, porque ninguna de las dos bases tiene volumen. ⏳ **Re-medir
con volumen antes de confiar en ellos** — está escrito en el `migration.sql`, en `design.md` §2.1 y
aquí, para que no dependa de que alguien lea la bitácora.
