# Feature 246 — Diseño

> Leer antes: `requirements.md` (R1-R35, D1-D9). Este documento decide **cómo**; los números que
> faltan se miden en **T0** con las consultas de §9.

---

## 0. El cambio, en una línea de causa y efecto

Una orden gana un **día de reparto**. De ahí salen **dos** consecuencias:

1. **El corte** deja de barrer —y de generar `vencido` por— las órdenes cuyo día de reparto **aún no
   ha llegado** (§5).
2. **El ranking** deja de contar «asignadas hoy» por `asignado_at` y pasa a contarlas por día de
   reparto (§6.bis). Esto entra por la firma de **D7**, tomada el 2026-08-20 **en contra de la
   recomendación de este spec**, y es lo que mete el **podio y `premio_ranking`** dentro del alcance.

Nada más cambia: ni un estado, ni un importe, ni un total de cierre, ni un movimiento de wallet.

---

## 1. Lo que hoy hace el corte, leído en el código

Tres piezas, en este orden. Quien toque esta ficha tiene que conocer las tres.

| Pieza | Archivo | Qué hace hoy |
| --- | --- | --- |
| **Reloj** | `vercel.json` | `/api/cron/corte-diario`, `0 6 * * *` UTC = **00:00 hora de pared de Costa Rica**. |
| **Selección** | `CorteDiarioRepository.findMensajerosConActividadSinCierre` | UNIÓN de (a) mensajeros con `gestion_orden.cierre_id IS NULL AND anulada_at IS NULL` y (b) mensajeros con ≥1 `orden` viva cuyo estatus esté en `ESTADOS_A_BARRER = ["en_reparto","ayuda_tienda"]`. Se **restan** los que ya tienen un cierre abierto (`solicitado`/`vencido`/`rechazado`). |
| **Escritura** | `CierreDiaRepository.crearCierre`, bloque `corteSinGestionar` | En la MISMA transacción que crea el `cierre_dia`, recorre **una vez por origen** (`en_reparto`, luego `ayuda_tienda`), hace `updateMany` guardado por `estatusId: origenEstatusId` y registra el cambio por el choke point (`origen_tipo='corte_sin_gestionar'`). Si no vincula gestiones **ni** transiciona órdenes, la transacción se revierte y `crearCierre` devuelve `null`. |

**Dos hechos que el diseño usa constantemente:**

1. **Asignar deja la orden en `por_recoger`**, y `por_recoger` **no está** en `ESTADOS_A_BARRER`. El
   barrido sólo alcanza a lo que el mensajero ya **recogió** (`en_reparto`) o sobre lo que **pidió
   ayuda** (`ayuda_tienda`). La medición **M2** dimensiona esa población.
2. **La selección y la escritura son la misma verdad vista dos veces.** El propio
   `CorteDiarioRepository` lo dice con todas las letras en su comentario de `ESTADOS_A_BARRER`, y la
   guardia `tests/unit/guards/carga-del-mensajero.guardia.test.ts` existe porque esa divergencia ya
   costó una regresión en la 235. **R16 es exactamente eso, aplicado a la condición de fecha.**

---

## 2. Modelo de datos

### 2.1 La columna

```prisma
// model Orden (db/schema.prisma)
fechaReparto DateTime? @map("fecha_reparto") @db.Date
```

- **`@db.Date`, no `timestamp`.** Es una fecha **calendario**, no un instante. Es la convención ya
  establecida del repo para esto: `gestion_orden.fecha_reprogramacion`, `pago.fecha_pago`,
  `gasto_fijo_plantilla.fecha_cobro`, `analytics_daily.fecha`. Un `timestamp` invitaría a comparar
  contra `now()` y a reintroducir el desfase de seis horas del que avisa `lib/analytics/ranges.ts`.
- **Nullable y sin default** (R19): las filas anteriores quedan en `NULL` y el corte las barre igual
  que hoy. **Cero backfill.**
- **EL ÍNDICE — la decisión cambió DOS veces, y las tres versiones se dejan escritas.**

  Se conserva la evolución entera, no sólo la conclusión, porque el error intermedio es
  instructivo: **v2 no fue «una decisión distinta», fue una respuesta correcta a una pregunta
  mal formulada**, y eso es más fácil de repetir que de detectar.

  ---

  **v1 — «SIN ÍNDICE».** *(antes de la puerta humana del 2026-08-20)*

  Al **corte** el índice le sobra: el barrido filtra por `mensajero_asignado_id` (que ya tiene
  `@@index`) y la fecha es un filtro **residual** sobre las órdenes de **un** mensajero; la
  selección filtra por `estatus_id` (indexado) sobre la población en `en_reparto`, que a medianoche
  es pequeña. Y un índice que nadie usa **se paga en cada escritura de la tabla más caliente** —
  razonamiento literal de `20260819170000_gestion_orden_confirmacion_fisica`.

  Con D7 sin firmar, esto era **correcto**.

  ---

  **v2 — «CON ÍNDICE `orden_fecha_reparto_idx`, de UNA columna».** *(tras firmar D7)*

  D7 mete el denominador del ranking dentro de la ficha, y ése **sí** filtra por `fecha_reparto`:
  `contarAsignadasPorMensajero` es un `groupBy` **sin igualdad por mensajero**, y lo ejecuta cada
  carga de `/ranking` —que abre el maestro **y cada mensajero**— más el cron del snapshot. Sin
  índice: recorrido completo de una tabla que sólo crece, que es lo que R44 prohíbe.

  De **una sola** columna y no `(mensajero_asignado_id, fecha_reparto)`, porque la consulta **agrupa
  por** mensajero pero **no filtra** por él, así que un compuesto con el mensajero delante no la
  serviría.

  **Ese razonamiento era correcto en todo menos en su premisa**, y la premisa no se había medido.

  ---

  **v3 — «AMPLIAR EL COMPUESTO QUE YA EXISTE A TRES COLUMNAS».** *(medido, 2026-08-20, y es la que
  se aplica)*

  **La premisa que faltaba.** El `EXPLAIN` de producción (**M8**) mostró que la consulta del
  denominador **hoy no hace ningún recorrido completo**: se sirve con un **`Index Only Scan`** sobre
  `(mensajero_asignado_id, asignado_at)`, un índice **que ya existe** desde la 76.

  ```
  GroupAggregate
    ->  Index Only Scan using orden_mensajero_asignado_id_asignado_at_idx on orden o
          Index Cond: (mensajero_asignado_id IS NOT NULL
                       AND asignado_at >= … AND asignado_at < …)
  ```

  Es el mejor plan posible: **no toca el heap**.

  **Con eso delante, la pregunta de v2 estaba mal formulada.** No era «¿hace falta un índice
  nuevo?». Era:

  > **¿El `OR` sobre `fecha_reparto` rompe el `Index Only Scan` que hoy sirve esta consulta?**

  El riesgo no era quedarse sin índice: era que **el índice que ya funcionaba dejara de cubrir la
  consulta**, porque `fecha_reparto` no está dentro de él. Y un plan óptimo puede degradarse a uno
  peor sin que falte nada.

  **Los cuatro planes, medidos** (base local, `enable_seqscan = off` para forzar la **forma** del
  plan; ver «por qué no por coste» abajo):

  | Índices presentes | Plan de la consulta con el `OR` | ¿Toca el heap? |
  | --- | --- | --- |
  | compuesto `(msj, asignado_at)` **+ `orden_fecha_reparto_idx`** *(v2)* | `BitmapOr` → **`Bitmap Heap Scan`** | **SÍ** |
  | sólo el compuesto `(msj, asignado_at)` | **`Index Scan`** por `msj IS NOT NULL` + Filter | **SÍ** |
  | compuesto **ampliado** `(msj, asignado_at, fecha_reparto)` *(v3)* | **`Index Only Scan`** + Filter | **NO** |
  | ampliado + `(fecha_reparto, msj)` | idéntico al anterior — el segundo índice **no se usa** | **NO** |

  **La conclusión que invierte v2:** `orden_fecha_reparto_idx` **no arregla el problema, lo
  empeora**. Es lo bastante atractivo para que el planificador elija un `BitmapOr` de dos escaneos
  de índice, y **un `BitmapOr` no es un `Index Only Scan`**: el `Bitmap Heap Scan` que lo remata
  vuelve al heap. Sin ese índice, el plan al menos se queda en un `Index Scan`.

  **Lo que sí lo arregla:** que `fecha_reparto` sea la **tercera columna clave** del compuesto que
  ya existe. Entonces todas las columnas de la consulta viven en el índice y el plan vuelve a ser
  `Index Only Scan`.

  **Por qué se AMPLÍA en vez de añadir:**
  - **el número de índices de `orden` no sube.** Se sustituye uno por su versión de tres columnas,
    así que el coste de escritura sube por **4 bytes de ancho de entrada**, no por un índice más.
    Es estrictamente más barato que v2, que sumaba uno entero;
  - **el prefijo se conserva.** `(a, b, c)` sirve a quien consultaba `(a, b)`:
    `TableroDiaRepository.cteIdsDelDia` y el denominador de la 76 siguen con **el mismo `Index
    Cond`**, verificado con `EXPLAIN`, no supuesto. *(El orden de las columnas es el requisito:
    `(fecha_reparto, msj, asignado_at)` **no** serviría ese prefijo.)*

  **LO QUE NINGÚN ÍNDICE ARREGLA, Y SE DECLARA COMO COSTE DE D7.** Con el `OR`, el `Index Cond` se
  reduce a `mensajero_asignado_id IS NOT NULL` y **se pierde el acotado por rango de
  `asignado_at`**: un btree **no puede** expresar una disyunción entre **dos** columnas como un
  rango. El plan sigue sin tocar el heap, pero pasa de leer **la porción de un día** a leer **el
  índice entero** (toda la población de órdenes asignadas, que sólo crece).

  ```
  ->  Index Only Scan using orden_mensajero_asignado_at_fecha_reparto_idx on orden o
        Index Cond: (mensajero_asignado_id IS NOT NULL)          ← se perdió el rango
        Filter: ((fecha_reparto = …) OR ((fecha_reparto IS NULL) AND (asignado_at >= …) AND …))
  ```

  **Esto es un coste de D7, no un defecto de la implementación**, y no se esconde: es el precio de
  contar el denominador por dos criterios a la vez.

  **La forma que lo recuperaría, medida y nombrada como seguimiento:** partir el `OR` en **dos
  consultas** y sumar los dos mapas en el repositorio. Con el mismo índice ampliado, **las dos
  ramas recuperan su `Index Cond` estrecho**:

  ```
  rama (a)  Index Cond: (mensajero_asignado_id IS NOT NULL AND fecha_reparto = D)
  rama (b)  Index Cond: (mensajero_asignado_id IS NOT NULL
                         AND asignado_at >= … AND asignado_at < … AND fecha_reparto IS NULL)
  ```

  La (b) es **exactamente la forma de hoy** con la comprobación del `NULL` empujada **dentro** del
  `Index Cond`. Y la disyunción disjunta se vuelve **más** fácil de probar, no menos: dos consultas
  disjuntas cuyos conteos se suman.

  **No se hace en esta ficha**, y el motivo es de proceso, no técnico: reestructuraría la consulta
  que decide el podio **justo después de firmarla**, y con ella los casos y las mutaciones (T7.4,
  T7.5) que la protegen. Se registra aquí para que sea **decisión y no descubrimiento**.

  **⏳ POR QUÉ ESTO ESTÁ MEDIDO POR FORMA Y NO POR COSTE, Y HAY QUE RE-MEDIRLO.** **Ninguna de las
  dos bases tiene volumen para decidir por el plan**: producción tiene **141 órdenes vivas** y la
  local **67**. A esa escala el planificador hace `Seq Scan` **con índice y sin él**, y hace bien.
  Todo lo de arriba se midió con `enable_seqscan = off`, que fuerza al planificador a enseñar **qué
  plan indexado es capaz de construir** — que es exactamente la pregunta de esta sección— pero **no
  dice nada de qué elegirá cuando la tabla crezca**. **Re-medir con volumen antes de confiar en
  cualquiera de estos planes.**
- **Sin `CHECK`.** «Sólo hoy o mañana» es una regla del **borde** (zod) y del servicio; expresarla en
  la base exigiría comparar contra `now()` dentro de una restricción, que es una segunda definición
  del día — prohibido por §3.
- **Tablas nuevas: ninguna. Enums nuevos: ninguno. RLS: no se toca.** `orden` ya tiene su régimen; una
  columna aditiva no abre superficie.

### 2.2 La migración

`db/migrations/<ts>_orden_fecha_reparto/migration.sql`, con `<ts>` posterior al último aplicado (hoy
`20260819170000`, y **conviene comprobarlo contra `origin/dev` en el momento**: hay dos fichas en
vuelo que también añaden migraciones).

```sql
ALTER TABLE "orden" ADD COLUMN "fecha_reparto" DATE;

-- El indice NO se añade: se AMPLIA el que ya existe (§2.1 v3). Se crea primero y se borra
-- despues, para que nunca haya una ventana en la que el prefijo se quede sin indice que lo sirva.
CREATE INDEX "orden_mensajero_asignado_at_fecha_reparto_idx"
  ON "orden" ("mensajero_asignado_id", "asignado_at", "fecha_reparto");

DROP INDEX IF EXISTS "orden_mensajero_asignado_id_asignado_at_idx";
```

⚠️ **Esto NO es lo que esta sección decía antes de M8.** Decía
`CREATE INDEX "orden_fecha_reparto_idx" ON "orden" ("fecha_reparto")`, condicionado a que el
`EXPLAIN` lo justificara. El `EXPLAIN` **lo desmintió**: ese índice suelto no preserva el `Index
Only Scan` que la consulta ya tenía —lo degrada a `Bitmap Heap Scan`—. El razonamiento entero, con
sus tres versiones y los cuatro planes medidos, está en **§2.1**.

El `migration.sql` lleva su razonamiento **entero** arriba, al nivel de la 238: qué es, por qué una
columna y no una tabla lateral (D1), por qué una fecha y no una marca (D2), qué significa `NULL` (una
sola cosa, R20), por qué sin índice, por qué sin `CHECK`, y que es **aditiva** (no renombra, no
reordena, no borra, no toca filas, no toca índices, no toca RLS).

### 2.3 El `down.sql`, pensado

```sql
-- Se REPONE el indice de dos columnas ANTES de soltar nada: el `up` lo SUSTITUYO, no lo sumo, asi
-- que un `down` que solo soltara la columna dejaria la base SIN el, y con el se iria el
-- `Index Only Scan` del que dependen el denominador del ranking y `TableroDiaRepository`. Eso no
-- seria «devolver la base al estado anterior»: seria dejarla PEOR.
CREATE INDEX IF NOT EXISTS "orden_mensajero_asignado_id_asignado_at_idx"
  ON "orden" ("mensajero_asignado_id", "asignado_at");

DROP INDEX IF EXISTS "orden_mensajero_asignado_at_fecha_reparto_idx";

ALTER TABLE "orden" DROP COLUMN IF EXISTS "fecha_reparto";
```

- **Pérdida de dato declarada:** se pierden todas las reservas vigentes.
- **Consecuencia operativa que hay que escribir en el propio `down.sql`:** revertir esta migración
  **devuelve al corte su comportamiento anterior**, y por tanto **la primera corrida posterior barrerá
  las órdenes que estaban reservadas para mañana**. No es una reversión inocua como la de la 238 (que
  sólo perdía un rastro de auditoría). Quien haga rollback tiene que saberlo.
- **Segunda consecuencia, desde D7:** el denominador del ranking vuelve a `asignado_at` (§6.bis), así
  que **el ranking del día del rollback cambia de números**. Los snapshots ya congelados **no** se
  ven afectados (son inmutables, R42) — sólo el día en curso.
- **R21 se cumple** porque el código anterior a esta feature **nunca leyó** esta columna: la base
  revertida es exactamente la que ese código espera.
- `IF EXISTS` para que el rollback sea idempotente.

### 2.4 El enum de historial: **no se toca**

El barrido sigue registrándose con `origen_tipo='corte_sin_gestionar'`. Reservar para mañana **no es
una transición de estado** (R31) y por tanto **no escribe historial**. Consecuencia deliberada: la
memoria del repo sobre «enum nuevo y los `down.sql` previos» **no aplica aquí**, porque esta ficha no
añade ningún valor a ningún enum. Que quede escrito para que nadie vaya a buscar qué actualizar.

---

## 3. La definición del día: una sola, y viaja como parámetro

Se reusa `lib/utils/fecha-cr.ts`. **No se escribe una segunda definición del día** (R17).

| Necesidad | Helper | Por qué ése |
| --- | --- | --- |
| «Hoy» como fecha calendario CR, para comparar contra una columna `@db.Date` | `startOfDayCR(now)` | Devuelve la **medianoche UTC de la fecha calendario de CR**, que es exactamente la convención con la que Postgres almacena y Prisma lee un `DATE`. Es la convención de la 46 para `fecha_reprogramacion`. |
| «Mañana» | `startOfDayCR(now)` + 24 h, o `new Date(\`${mananaCalendarioCR(now)}T00:00:00.000Z\`)` | CR no tiene horario de verano: +24 h **es** +1 día. |
| Etiquetas legibles para la UI | `fechaCalendarioCR(now)` / `mananaCalendarioCR(now)` | Ya existen y ya están probadas (`tests/unit/utils/fecha-cr-calendario.test.ts`). |

⚠️ **La trampa del repo, dicha aquí para que nadie la pise:** `inicioDelDiaCREnUtc(fecha)` (que
devuelve `${fecha}T06:00:00.000Z`) es para comparar contra columnas **`timestamp`**, como
`asignado_at` o `gestion_orden.created_at`. **No sirve** para `fecha_reparto`, que es `DATE`. Usar el
helper equivocado desplaza el día seis horas y devuelve el defecto por otra puerta —es el mismo
error que cerró la ficha 166 y que `lib/utils/fecha-cr.ts` documenta en su propio cuerpo.

**Cero zonas horarias en el SQL.** Ni `AT TIME ZONE`, ni `America/Costa_Rica`, ni `interval '6
hours'`. La frontera se calcula en TypeScript y **entra como parámetro**, igual que en
`FinanzasDiarioRepository` y `ConteoCargadasPorDiaRepository`.

---

## 4. Contratos I/O — la elección

### 4.1 El borde (zod)

Un solo tipo compartido, para que las dos superficies no puedan divergir:

```ts
// lib/types/dia-reparto.ts  (NUEVO)
export const DIA_REPARTO = ["hoy", "manana"] as const;
export type DiaReparto = (typeof DIA_REPARTO)[number];
export const diaRepartoSchema = z.enum(DIA_REPARTO);
```

Y en cada schema de asignación:

```ts
// lib/types/orden-guia.ts
export const asignarBodegaSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1),
  mensajeroId: z.string().min(1),
  dia: diaRepartoSchema.default("hoy"),          // R3/R4
});

// lib/types/recepcion-satelite.ts
export const asignarSateliteSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  mensajeroId: z.string().uuid(),
  dia: diaRepartoSchema.default("hoy"),          // R3/R4
});
```

- **`.default("hoy")` y no obligatorio** (R4): una petición sin el campo se comporta **exactamente**
  como hoy. Falla **seguro**. El precio es que un frontend que se olvide de mandarlo no rompe nada y
  nadie se entera; por eso T4 exige un test de componente que afirme que el modal **manda** la
  opción elegida (mismo patrón que la 238/T4.1).
- **NO se acepta una fecha** (R6). El cliente manda un token; la fecha la pone el servidor.

### 4.2 El servicio

`GuiaAsignacionService.asignarDesdeBodega` y `AsignacionSateliteService.asignar` reciben el token y
lo **resuelven una sola vez** a una fecha, en el servidor:

```ts
// lib/utils/dia-reparto.ts (NUEVO) — función pura, testeable sin reloj real
export function resolverFechaReparto(dia: DiaReparto, now: Date = new Date()): Date {
  return dia === "hoy" ? startOfDayCR(now) : new Date(startOfDayCR(now).getTime() + UN_DIA_MS);
}
```

La fecha resuelta viaja al repositorio como **parámetro**, nunca se recalcula ahí abajo. Un único
sitio que sabe traducir hoy/mañana a fecha ⇒ un único sitio donde ese criterio puede equivocarse.

### 4.3 Los repositorios: la fecha entra en la escritura que ya existe

| Sitio | Hoy | Con la ficha |
| --- | --- | --- |
| `OrdenRepository.asignarBodegaLote` | `data: { mensajeroAsignadoId, estatusId, asignadoAt: new Date(), prioridad: false }` | `+ fechaReparto` (R7) |
| `OrdenRepository.asignarSateliteLote` (UPDATE crudo) | `SET mensajero_asignado_id, asignado_at = NOW(), estatus_id, prioridad = false` | `+ "fecha_reparto" = $n` (R7) |
| `CierreDiaRepository` — deshacer gestión (re-estampa `asignado_at`) | `data: { estatusId, mensajeroAsignadoId, asignadoAt: new Date() }` | `+ fechaReparto: startOfDayCR()` (R8) |
| `OrdenRepository.deshacerAsignacionLote` | `SET mensajero_asignado_id = NULL, asignado_at = NULL` | `+ "fecha_reparto" = NULL` (R9) |
| `CierresAdminRepository` (liberar al aprobar), `DevolucionSlaRepository`, `LiberacionReprogramadaRepository`, `OrdenRepository` (retorno a bodega satélite) | `asignadoAt: null` junto a `mensajeroAsignadoId: null` | `+ fechaReparto: null` (R9) |

**La invariante, dicha como una sola regla (R10):** *`fecha_reparto` se escribe siempre en la misma
escritura que `asignado_at`, y se limpia siempre en la misma escritura que lo limpia.* Es una regla
que un **censo** puede vigilar (T6), no una lista que haya que recordar.

### 4.4 El escape de D6, si M1 lo pide

Si la medición muestra masa de asignaciones entre las 23:00 y la 01:00 CR, el token viaja acompañado
de la fecha base que el modal estaba mostrando:

```ts
dia: diaRepartoSchema.default("hoy"),
fechaBase: z.string().optional(),   // "YYYY-MM-DD" que el cliente tenía a la vista
```

y el servicio devuelve `validation_error` si `fechaBase !== fechaCalendarioCR(now)`. **No se
implementa por defecto**: es maquinaria para una ventana de minutos al día y con un fallo benigno
(una noche de más de protección, nunca una orden perdida).

---

## 5. El corte: los dos predicados gemelos

**La regla, escrita con precisión, porque es donde es fácil dejar órdenes que no se barren nunca:**

> Sea `diaCerrado` la fecha calendario de Costa Rica de la **jornada que la corrida está cerrando**,
> calculada **una vez** al arrancar el corte (§5.1).
> Una orden está **protegida** si `fecha_reparto IS NOT NULL AND fecha_reparto > diaCerrado`.
> Todo lo demás —`fecha_reparto IS NULL` o `fecha_reparto <= diaCerrado`— se barre **exactamente**
> como hoy.

El único punto delicado es **qué día es `diaCerrado`**, y es el siguiente apartado. No es «el día de
hoy»: escribir eso barre justo lo que la ficha protege.

### 5.1 El ancla: el día que el corte CIERRA, no el que inaugura

**El ancla ingenua no sirve, y conviene ver por qué antes de escribirla.** El corte arranca a las
00:00 CR del día `D+1`, así que `startOfDayCR(now) = D+1`. Una orden que bodega reservó anoche «para
mañana» tiene `fecha_reparto = D+1`. Con el predicado «protegida si `fecha_reparto > startOfDayCR
(now)`», `D+1 > D+1` es **falso** y la orden **se barre**: justo lo que la ficha viene a impedir.
Cambiar el operador a `>=` la salvaría esa noche, pero deja el predicado dependiendo del **instante
exacto** en que Vercel dispara el cron — ver «robustez frente a un cron que se adelanta», más abajo.
El error está en el **ancla**, no en el operador.

**El ancla correcta es el día que el corte cierra:**

> `diaCerrado = startOfDayCR(now) - 1 día`
> Una orden está **protegida** si `fecha_reparto IS NOT NULL AND fecha_reparto > diaCerrado`.

En la corrida normal —00:00 CR del día `D+1`— eso da `diaCerrado = D`:

| Día de reparto | ¿protegida (`> D`)? | Resultado |
| --- | --- | --- |
| `NULL` | no | se barre (R19) |
| `D` o anterior | no | se barre (R12) |
| `D+1` (reservada anoche para hoy) | **sí** | **protegida** (R11) — sobrevive esta noche |
| `D+1`, en la corrida siguiente (`diaCerrado = D+1`) | no | **se barre** (R13) — la protección caducó sola |

**Exactamente una noche de protección, y caduca sin que nadie escriba nada.** Como el máximo
reservable es «mañana» (D2), **ninguna orden puede quedar protegida dos veces**.

**Robustez frente a un cron que se adelanta.** Si Vercel dispara a las 23:5x CR del día `D`,
`startOfDayCR` da `D` y `diaCerrado = D-1`: se barre todo lo de `D-1` y hacia atrás, y lo de `D`
sobrevive una corrida más. Se **retrasa** un barrido; no se **pierde** ninguno, porque la corrida
siguiente lo alcanza. Anclarlo en `now` sin restar el día tendría el defecto inverso, que sí pierde
la protección. **Esta elección se prueba con reloj inyectado, no con el reloj real** (T2).

### 5.2 Los dos sitios, con el mismo predicado

```ts
// (a) SELECCIÓN — CorteDiarioRepository.findMensajerosConActividadSinCierre(diaCerrado)
const enReparto = await this.prisma.orden.findMany({
  where: {
    deletedAt: null,
    estatus: { value: { in: ESTADOS_A_BARRER } },
    mensajeroAsignadoId: { not: null },
    OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaCerrado } }],   // ← R11/R16
  },
  distinct: ["mensajeroAsignadoId"],
  select: { mensajeroAsignadoId: true, mensajeroAsignado: { select: { zonaId: true } } },
});

// (b) ESCRITURA — CierreDiaRepository.crearCierre, dentro de corteSinGestionar
const pendientes = await tx.orden.findMany({
  where: {
    mensajeroAsignadoId: mensajeroId,
    estatusId: origenEstatusId,
    deletedAt: null,
    OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaCerrado } }],   // ← el MISMO
  },
  select: { id: true },
});
// ...y el mismo OR se repite en el `where` del updateMany guardado, que es quien de verdad escribe.
```

- La rama **(a) por gestiones sin cerrar no se toca** (R18). Un mensajero que trabajó y no pidió
  cierre sigue recibiendo su `vencido`: eso es dinero suyo sin cuadrar, y no tiene nada que ver con
  las órdenes de mañana.
- `diaCerrado` **viaja como parámetro** desde `CorteDiarioService.ejecutarCorte`, que lo calcula
  **una vez** por corrida. Si se calculara en cada repositorio, dos consultas de la misma corrida
  podrían caer a distinto lado de la medianoche.
- **Si sólo se arreglara (b)**: la selección metería en el bucle a mensajeros cuyas únicas órdenes
  están protegidas; `crearCierre` no vincularía gestiones ni transicionaría nada, la guarda «algo
  pasó» revertiría y devolvería `null`. El resultado **sería correcto por accidente** (no se crea el
  `vencido`) pero se pagaría una transacción por mensajero y, sobre todo, las dos listas volverían a
  decir cosas distintas — la forma exacta del fallo de la 235. **R16 exige las dos**, con guardia.

### 5.3 Lo que esta ficha **no** arregla del corte, y hay que decir en voz alta

Un mensajero con órdenes protegidas **y** con gestiones sin cerrar **sigue recibiendo su `vencido`**
(R15), y desde la 241 ese `vencido` lo bloquea para gestionar al día siguiente — ahora **con los
paquetes de mañana en la mano**. Antes de esta ficha ese mensajero acababa bloqueado **y sin
paquetes** (se los barrían). **La ficha hace que la regla de la 241 muerda más fuerte en ese caso**,
y eso es una consecuencia consciente, no un descuido: la salida es la que ya existe, resolver el
cierre. Blindar también ese caso sería dejar que un mensajero evite su cierre indefinidamente sólo
con recibir asignaciones nuevas.

---

## 6. Lo que ve el mensajero

`MisAsignacionesService.listarMisAsignaciones` ya parte sus filas en **tres** grupos en el
**servidor**, por `estatusValue`, y su propio comentario dice por qué no se hace con un `useMemo` del
cliente (feature 235/R18). Esta ficha **no añade un cuarto grupo**: añade un dato por fila.

```ts
// lib/types/mis-asignaciones.ts — MiAsignacionDTO
esParaManana: boolean;   // derivado EN EL SERVIDOR: fechaReparto > startOfDayCR(now)
```

- **`boolean` derivado, no la fecha cruda** (R26): el cliente no vuelve a decidir qué día es hoy. Es
  el mismo criterio con el que el repo saca `estatusValue` en vez de dejar que el navegador
  interprete.
- La card lo pinta con **palabras** —«Para mañana»— dentro del grupo que ya le corresponde (R22).
  Sin badge de color como único portador del mensaje: el repo ya tiene una guardia de contraste y
  una lección escrita sobre medir color en el navegador.
- **No se oculta nada y no se bloquea nada** (R23/R24, decisión D5). Al llegar el día, `esParaManana`
  pasa a `false` **por el mero paso del tiempo** (R25): no hay nada que apagar, que es la misma
  propiedad que hace segura a la columna (D2).

---

## 6.bis El denominador del ranking *(D7, firmada el 2026-08-20 EN CONTRA de la recomendación)*

> Sección **añadida después de la puerta humana**. La recomendación de este spec era no tocar el
> ranking aquí; el humano firmó lo contrario con el coste delante. El registro de esa decisión está
> en `requirements.md` §D7 y §«PUERTA HUMANA PASADA». Aquí sólo está el **cómo**.

### 6.bis.1 Qué mide hoy, exactamente

| Pieza | Archivo | Hoy |
| --- | --- | --- |
| Numerador | `RankingRepository.contarEntregadasPorMensajero` | `gestion_orden` con `resultado='entregada'`, `anulada_at IS NULL`, `created_at` en `[desde, hasta)` del día CR. |
| **Denominador** | `RankingRepository.contarAsignadasPorMensajero` | `orden` con `mensajero_asignado_id IS NOT NULL` y **`asignado_at` en `[desde, hasta)`**. |
| Ventana | `RankingService` (vivo) y `lib/ranking/snapshot-dia.ts` (congelado) | `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` — cotas contra columnas `timestamp`. |
| Podio y premio | `lib/ranking/orden-ranking.ts` + `premio_ranking` | Módulo **puro** compartido por el vivo y el snapshot. **No se toca** (R45). |
| Congelado | `ranking_snapshot_dia` / `ranking_snapshot_fila` | Inmutables. El cron corre a las 02:00 CR y congela **el día anterior**. |

### 6.bis.2 El cambio, y las DOS convenciones de fecha que chocan aquí

El denominador pasa a contar **por día de reparto**. Y aquí aparece la trampa del repo en su forma
más peligrosa, porque **las dos convenciones de fecha conviven en la misma consulta**:

- `fecha_reparto` es `DATE` ⇒ se compara contra **medianoche UTC de la fecha CR** (`startOfDayCR` /
  `fechaComoDate`).
- `asignado_at` es `timestamp` ⇒ se compara contra **`...T06:00:00.000Z`**
  (`inicioDelDiaCREnUtc`), que es lo que ya hacen el vivo y el snapshot.

Mezclarlas desplaza el día seis horas, y este repo **ya cerró esa ficha una vez** (la 166: una
entrega de las 19:00 CR contaba para el día siguiente). `snapshot-dia.ts` lleva un ⛔ explícito
prohibiendo importar `startOfDayCR`. **Esa prohibición sigue en pie para las cotas del numerador**;
lo que esta ficha añade es un segundo parámetro, con **su propia** convención, para el denominador.

```ts
// IRankingRepository — la firma cambia, y el cambio es la señal
contarAsignadasPorMensajero(
  desde: Date,        // timestamp: cota del respaldo por `asignado_at` (convención 144/166)
  hasta: Date,
  diaReparto: Date,   // DATE: medianoche UTC de la fecha CR (convención 46) ← NUEVO
): Promise<ConteoPorMensajero[]>;
```

Los tres los calcula **el llamador** (`RankingService` para el vivo, `snapshot-dia.ts` para el
congelado) y **no** se derivan uno del otro dentro del repositorio: derivar `diaReparto` restando
seis horas a `desde` sería exactamente la segunda definición del día que §3 prohíbe.

### 6.bis.3 La consulta, y por qué es un `OR` y no un `COALESCE`

```ts
const rows = await this.prisma.orden.groupBy({
  by: ["mensajeroAsignadoId"],
  where: {
    mensajeroAsignadoId: { not: null },
    OR: [
      // R36: la orden reservada para ESE día
      { fechaReparto: diaReparto },
      // R37/R43: respaldo para las órdenes sin día de reparto — las anteriores al despliegue
      { fechaReparto: null, asignadoAt: { gte: desde, lt: hasta } },
    ],
  },
  _count: { _all: true },
});
```

**Por qué un `OR` de dos predicados y no `COALESCE(fecha_reparto, dia(asignado_at)) = X`:** el
`COALESCE` mezcla las dos convenciones dentro de una expresión, **no es indexable** por ningún índice
existente ni por el nuevo, y obligaría a meter `- interval '6 hours'` en el SQL — la segunda
definición del día que §3 prohíbe.

⚠️ **Aquí esta sección decía algo que M8 desmintió, y se corrige en vez de dejarlo envejecer.**
Decía que el `OR` tiene «las dos ramas indexables por separado (la primera por
`orden_fecha_reparto_idx`, la segunda por el índice que ya existe) y Postgres las combina con un
`BitmapOr`». **Eso es literalmente cierto y operativamente peor de lo que suena:** un `BitmapOr`
**no es un `Index Only Scan`** —lo remata un `Bitmap Heap Scan`, que vuelve al heap— y la consulta
ya tenía un `Index Only Scan` que perder. **El plan bueno no sale de indexar cada rama por su lado,
sale de que las tres columnas vivan en el MISMO índice** (§2.1 v3): entonces el `OR` se evalúa como
`Filter` sobre la tupla del índice y no se toca el heap.

**Lo que el `OR` sí cuesta, y ningún índice quita:** el `Index Cond` se reduce a
`mensajero_asignado_id IS NOT NULL` — un btree no expresa una disyunción entre dos columnas como un
rango—, así que se recorre el índice entero en vez de la porción de un día. **Está declarado como
coste de D7 en §2.1**, junto con la forma que lo recuperaría (partir el `OR` en dos consultas), su
`EXPLAIN` y el motivo por el que no se hace en esta ficha.

**Por qué la segunda rama lleva `fechaReparto: null` y no sólo el rango:** sin ese `null`, una orden
asignada hoy para mañana entraría **por las dos ramas** —en el denominador de hoy por `asignado_at` y
en el de mañana por `fecha_reparto`— y quedaría **contada dos veces en días distintos**. La cláusula
`null` hace las dos ramas **disjuntas por construcción**, que es lo que garantiza que cada orden
aporte exactamente 1 a exactamente un día. Es la aserción que más barato se rompe y la que un test
tiene que vigilar.

### 6.bis.4 El día del despliegue (R43) — el punto de dinero

Es el momento en que esta parte de la ficha puede hacer daño, y es **un solo día**:

- Las órdenes asignadas **antes** del despliegue tienen `fecha_reparto = NULL` para siempre (no hay
  backfill, y no lo habrá: §10-I).
- Si el denominador contase **sólo** `fecha_reparto = X`, esas órdenes **desaparecerían del
  denominador**. Con el numerador intacto, **todos los porcentajes subirían de golpe**, el umbral de
  podio (`RANKING_MIN_ASIGNADAS`) dejaría fuera a quien no tuviera órdenes nuevas, y **el podio de ese
  día sería falso para todos a la vez** — con su premio.
- La segunda rama del `OR` lo cierra: esas órdenes siguen contando **por donde contaban antes**. El
  día del despliegue el denominador es **exactamente el de siempre** para las viejas y el nuevo para
  las nuevas.
- El respaldo **envejece solo**: pasados unos días no queda ninguna orden viva sin `fecha_reparto`.
  **No se retira igualmente**, porque es también la respuesta correcta para cualquier orden que llegue
  a tener mensajero por una vía que no estampe la columna.

### 6.bis.5 Quién gana y quién pierde

| Quién | Efecto | Por qué |
| --- | --- | --- |
| **Gana** el mensajero al que la bodega asigna de noche para el día siguiente | Su porcentaje de **hoy** deja de bajar por órdenes que no podía entregar hoy | Es el defecto que D7 corrige. Hoy esas órdenes engordan el denominador del día que acaba sin poder aportar numerador. |
| **Pierde** el mensajero que **entrega hoy** una orden reservada para mañana | Sube hoy (numerador sin denominador) y **baja mañana** (denominador sin numerador) | R40. Neto ≈ 0 en dos días, pero **el podio es diario**, así que puede mover un premio de un día a otro. Sólo ocurre si él elige entregar antes de tiempo (D5 se lo permite). |
| **Nadie** retroactivamente | Los rankings congelados no cambian | R42: `ranking_snapshot_*` son inmutables. El cambio es prospectivo **por construcción**, no por una fecha de corte que alguien tenga que recordar. |
| **Todos, un solo día**, si se implementa mal | Podio falso el día del despliegue | §6.bis.4. Es el motivo por el que la segunda rama del `OR` no es opcional. |

**Cuánto de esto es dinero:** `premio_ranking` guarda tres montos con su rótulo y **no emite ningún
movimiento de wallet** —no existe categoría para premios en `WalletMovimientoCategoria`—. Es decir:
el sistema **no mueve** ese dinero, pero **decide a quién se le paga**. **M6** da el importe mensual
en juego y **M7** dice en cuántos días el podio habría cambiado; hasta tener los dos, cualquier
afirmación sobre «cuánto cuesta» sería inventada.

### 6.bis.6 El snapshot: por qué el criterio nuevo no lo rompe

`RankingSnapshotService` reusa **los mismos tres repositorios** que el vivo y el **mismo** módulo puro
de orden/podio. Por eso R41 se cumple casi por construcción: cambiar `contarAsignadasPorMensajero`
cambia los dos a la vez. Sólo hay que darle el tercer parámetro, y sale de
`fechaComoDate(fechaObjetivo(now))` — que **ya existe** en `snapshot-dia.ts` y ya devuelve la
convención `DATE` correcta. No hay helper nuevo que escribir.

**R46 (el denominador está cerrado antes de congelarse) se cumple por el alcance de la ficha, no por
suerte:** `fecha_reparto = X` sólo puede escribirse eligiendo «hoy» el día `X` o «mañana» el día
`X-1`. Las dos cosas ocurren **antes** de las 02:00 CR del día `X+1`, que es cuando el cron congela
`X`. **Con una fecha futura arbitraria esto dejaría de ser cierto** —alguien podría asignar para un
día ya congelado— y haría falta un requisito nuevo. Es un argumento más a favor del alcance estrecho.

### 6.bis.7 El tablero del día (D10, ABIERTA)

`TableroDiaRepository.cteIdsDelDia` cuenta «asignadas hoy» con el mismo `asignado_at`, y su cabecera
avisa de que esa columna «es el denominador del ranking diario». Si D10 se firma que **sí**, el `OR`
de §6.bis.3 se replica en ese CTE —es SQL crudo parametrizado, así que la fecha entra como parámetro
más, sin zona horaria— y las dos pantallas vuelven a cuadrar. Si se firma que **no**, hay que decirlo
en la cabecera del tablero: dos cifras distintas de «asignadas hoy» sin una nota que lo explique se
leen como un error de la app.

---

## 7. La pantalla de quien asigna

Dos modales, un componente compartido:

| Superficie | Archivo | Acción |
| --- | --- | --- |
| Bodega central | `app/(app)/ordenes/_components/AsignarBodegaModal.tsx` | `asignarDesdeBodega` |
| Bodega satélite | `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` | `asignarDesdeSatelite` |

- Un **selector de dos opciones** (radio group de `components/ui/`, **no** un componente propio:
  `docs/architecture.md` exige mirar shadcn/ui antes de crear nada), con **«Hoy» preseleccionado**
  (R27).
- Las etiquetas llevan el día **resuelto en el servidor** y pasado por props desde el Server
  Component de la página (R29). Nunca `new Date()` en el cliente: un portátil con la hora corrida
  etiquetaría mal la opción.
- El resultado confirma con texto para qué día quedó el lote (R28), sin siglas ni jerga — misma regla
  que el repo aplicó al retirar «SLA» del frontend.
- **Sobre-ingeniería, no:** el selector se usa en **dos** sitios con la misma API, así que sí se
  promueve a `components/shared/`. Es el umbral que `docs/architecture.md` fija (dos features), no
  una excepción.

---

## 8. Rojos esperados, y rojos que son regresión

**Rojos ESPERADOS** (hay que re-apuntar la aserción, no el código):

1. **Typecheck en todos los dobles de `findMensajerosConActividadSinCierre`** cuando gane el
   parámetro `diaCerrado`. Es la señal buscada: si el parámetro fuera opcional, olvidar cablearlo
   dejaría el corte con un criterio silencioso. **Obligatorio, no opcional.**
2. **Typecheck en `CorteSinGestionarInput`** al ganar `diaCerrado`. Mismo motivo: la 235 ya usó esta
   técnica para que un olvido de cableado rompa el build en vez de dejar órdenes sin barrer.
3. `tests/unit/repositories/corte-diario-repository.test.ts` y
   `tests/unit/services/corte-diario-seleccion.test.ts`: sus dobles y sus `where` esperados cambian
   de forma.
4. `tests/unit/repositories/cierre-dia-repository.test.ts`: el `where` del pre-`SELECT` y del
   `updateMany` del barrido gana el `OR`.
5. `tests/unit/services/guia-asignacion-service.test.ts`,
   `tests/unit/services/asignacion-satelite-service.test.ts`,
   `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts`: el `data`/`SET` de la
   asignación gana un campo.

**Rojos ESPERADOS que aparecen SÓLO por D7** (antes de la firma estaban en la lista de regresión):

6. **Typecheck en todo doble de `IRankingRepository`** al ganar `contarAsignadasPorMensajero` su
   tercer parámetro. Obligatorio, no opcional: un parámetro con default dejaría el vivo y el snapshot
   contando distinto sin que nadie se entere, que es justo lo que R41 prohíbe.
7. `tests/unit/repositories/ranking-repository.test.ts` — el `where` del `groupBy` pasa de un rango a
   un `OR` de dos ramas.
8. `tests/unit/services/ranking-service.test.ts` y
   `tests/unit/services/ranking-snapshot-service.test.ts` — los dobles del repo reciben un argumento
   más y hay que afirmar **qué** valor reciben (es la mitad de R41).
9. `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` — vigila que las cotas del día del ranking
   sean las de la convención 144/166. **Sigue siendo cierto para el numerador y para la rama de
   respaldo**, pero ahora hay una tercera fecha con **otra** convención. La guardia hay que
   **enseñarle a leer las dos**, no relajarla: si acaba aceptando cualquier fecha, deja de proteger
   del off-by-one de la 166.
10. `tests/unit/repositories/tablero-dia-sql.test.ts` — **sólo si D10 se firma que sí.** Si D10 se
    firma que no, este archivo vuelve a la lista de regresión.

**Rojos que son REGRESIÓN** (si aparecen, alguien tocó lo que esta ficha no toca):

- `tests/unit/guards/carga-del-mensajero.guardia.test.ts` — las listas de estatus **no cambian** en
  esta ficha. Un rojo ahí significa que alguien movió `ESTADOS_A_BARRER` o `ESTADOS_REPARTO_PENDIENTE`.
- `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` — R33: esta ficha **no** cambia
  quién escribe `asignado_at`, sólo **acompaña** cada escritura y **lee** la columna. Un rojo aquí es
  una escritura nueva sobre `asignado_at`, que nadie pidió.
- Cualquier test de `lib/ranking/orden-ranking.ts` (orden, podio, redondeo) — R45: el criterio de
  ordenación y de podio **no se toca**. Un rojo ahí es la ficha metiéndose donde no debe.
- `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts` — el cron y su idempotencia no cambian.
- Cualquier guardia money-safe o de dinero: R30 dice que aquí no se mueve un céntimo.

---

## 9. Consultas de verificación (T0, producción, **solo lectura**, vía MCP)

> Estas consultas hacen aritmética de zona horaria **a propósito**: son una **medición puntual**, no
> código del repo. Si alguna de estas ideas llegara a producción, entraría por `lib/utils/fecha-cr.ts`
> y como parámetro, nunca como `interval '6 hours'` incrustado.

**M1 — ¿A qué hora se asigna de verdad?** (el número que dice si el problema es diario o excepcional)

```sql
SELECT EXTRACT(HOUR FROM (asignado_at - INTERVAL '6 hours')) AS hora_cr,
       COUNT(*) AS ordenes
FROM orden
WHERE asignado_at IS NOT NULL
  AND asignado_at >= NOW() - INTERVAL '30 days'
  AND deleted_at IS NULL
GROUP BY 1 ORDER BY 1;
```

**Autocomprobación obligatoria:** `SELECT COUNT(*) FROM orden WHERE asignado_at IS NOT NULL AND
asignado_at >= NOW() - INTERVAL '30 days'` tiene que cuadrar con la suma de la columna `ordenes`. Un
cero repartido en 24 filas es «no hay datos», no «no se asigna de noche».

**M2 — La población real del defecto:** órdenes barridas por el corte que se habían asignado en las
6 h anteriores a esa corrida.

```sql
SELECT date_trunc('day', h.created_at - INTERVAL '6 hours') AS noche_cr,
       COUNT(*) AS barridas_recien_asignadas
FROM orden_historial_estado h
JOIN orden o ON o.id = h.orden_id
WHERE h.origen_tipo = 'corte_sin_gestionar'
  AND h.created_at >= NOW() - INTERVAL '30 days'
  AND o.asignado_at IS NOT NULL
  AND o.asignado_at BETWEEN h.created_at - INTERVAL '6 hours' AND h.created_at
GROUP BY 1 ORDER BY 1;
```

Con su denominador al lado: `SELECT COUNT(*) FROM orden_historial_estado WHERE origen_tipo =
'corte_sin_gestionar' AND created_at >= NOW() - INTERVAL '30 days'`.

**M3 — ¿Se carga la furgoneta de noche?** (decide D5)

```sql
SELECT EXTRACT(HOUR FROM (h.created_at - INTERVAL '6 hours')) AS hora_cr,
       COUNT(*) AS recogidas
FROM orden_historial_estado h
JOIN order_status d ON d.id = h.estatus_destino_id
WHERE h.origen_tipo = 'recoleccion'
  AND d.value = 'en_reparto'
  AND h.created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1;
```

**M4 — ¿Cuántos bloqueos de la 241 son culpa de esto?**

```sql
SELECT date_trunc('day', c.created_at - INTERVAL '6 hours') AS noche_cr,
       COUNT(DISTINCT c.id) AS vencidos,
       COUNT(DISTINCT c.mensajero_id) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM orden o
           WHERE o.mensajero_asignado_id = c.mensajero_id
             AND o.asignado_at BETWEEN c.created_at - INTERVAL '6 hours' AND c.created_at
         )
       ) AS con_asignacion_reciente
FROM cierre_dia c
WHERE c.estado = 'vencido'
  AND c.created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1;
```

**M5 — ¿Cuánto se movería el denominador?** ⚠️ **PROXY**: la columna no existe todavía, así que se
aproxima con «asignadas a partir de las 18:00 CR que **no** se desenlazaron ese mismo día» — que es
lo que bodega marcaría «mañana» si el selector existiera. **Es una hipótesis sobre una conducta
humana que aún no ocurre**, y hay que pegarla con esa etiqueta.

```sql
WITH asignadas AS (
  SELECT o.id,
         (o.asignado_at - INTERVAL '6 hours')::date            AS dia_asignacion_cr,
         EXTRACT(HOUR FROM (o.asignado_at - INTERVAL '6 hours')) AS hora_cr
  FROM orden o
  WHERE o.asignado_at >= NOW() - INTERVAL '30 days'
    AND o.mensajero_asignado_id IS NOT NULL
),
desenlace AS (
  SELECT g.orden_id, MIN((g.created_at - INTERVAL '6 hours')::date) AS dia_gestion_cr
  FROM gestion_orden g
  WHERE g.anulada_at IS NULL AND g.created_at >= NOW() - INTERVAL '31 days'
  GROUP BY 1
)
SELECT a.dia_asignacion_cr,
       COUNT(*)                                        AS denominador_actual,
       COUNT(*) FILTER (WHERE a.hora_cr >= 18)         AS asignadas_tarde,
       COUNT(*) FILTER (
         WHERE a.hora_cr >= 18
           AND (d.dia_gestion_cr IS NULL OR d.dia_gestion_cr > a.dia_asignacion_cr)
       )                                               AS se_moverian_a_manana
FROM asignadas a
LEFT JOIN desenlace d ON d.orden_id = a.id
GROUP BY 1 ORDER BY 1;
```

**Cómo se lee:** `se_moverian_a_manana / denominador_actual` es la fracción del denominador que
cambia de día. **Autocomprobación:** `denominador_actual` sumado tiene que cuadrar con
`SELECT COUNT(*) FROM orden WHERE asignado_at >= NOW() - INTERVAL '30 days' AND mensajero_asignado_id
IS NOT NULL`.

**M6 — ¿Cuánto dinero mueve `premio_ranking`?**

```sql
SELECT posicion, monto, descripcion FROM premio_ranking ORDER BY posicion;

SELECT COUNT(*)                                             AS dias_congelados,
       COUNT(*) FILTER (WHERE f.podios > 0)                 AS dias_con_podio,
       SUM(f.premio_total)                                  AS premio_repartido_30d
FROM ranking_snapshot_dia s
LEFT JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE x.posicion IS NOT NULL) AS podios,
         COALESCE(SUM(x.premio_monto), 0)               AS premio_total
  FROM ranking_snapshot_fila x
  WHERE x.snapshot_id = s.id
) f ON TRUE
WHERE s.fecha >= CURRENT_DATE - 30;
```

`premio_repartido_30d` es **el importe que esta decisión pone en juego al mes**. Si sale `0` o `NULL`,
comprobar antes de concluir que «no hay dinero»: puede ser que los montos de `premio_ranking` estén
sin configurar, que es distinto de que el premio no exista.

**M7 — ¿Cambia el podio?** El número que decide si D7 es cosmético o caro. Sustituir `:min_asignadas`
por el valor real de `RANKING_MIN_ASIGNADAS` (default **1**).

```sql
WITH entregadas AS (
  SELECT (g.created_at - INTERVAL '6 hours')::date AS d, g.mensajero_id, COUNT(*) AS n
  FROM gestion_orden g
  WHERE g.resultado = 'entregada' AND g.anulada_at IS NULL
    AND g.created_at >= NOW() - INTERVAL '31 days'
  GROUP BY 1, 2
),
asig_actual AS (
  SELECT (o.asignado_at - INTERVAL '6 hours')::date AS d,
         o.mensajero_asignado_id AS mensajero_id, COUNT(*) AS n
  FROM orden o
  WHERE o.asignado_at >= NOW() - INTERVAL '31 days' AND o.mensajero_asignado_id IS NOT NULL
  GROUP BY 1, 2
),
asig_proxy AS (   -- lo asignado a partir de las 18:00 CR cuenta al dia siguiente
  SELECT CASE WHEN EXTRACT(HOUR FROM (o.asignado_at - INTERVAL '6 hours')) >= 18
              THEN (o.asignado_at - INTERVAL '6 hours')::date + 1
              ELSE (o.asignado_at - INTERVAL '6 hours')::date END AS d,
         o.mensajero_asignado_id AS mensajero_id, COUNT(*) AS n
  FROM orden o
  WHERE o.asignado_at >= NOW() - INTERVAL '31 days' AND o.mensajero_asignado_id IS NOT NULL
  GROUP BY 1, 2
),
top_actual AS (
  SELECT a.d, ARRAY_AGG(a.mensajero_id ORDER BY (e.n::numeric / a.n) DESC, e.n DESC, a.mensajero_id)
                FILTER (WHERE TRUE) AS podio
  FROM asig_actual a JOIN entregadas e ON e.d = a.d AND e.mensajero_id = a.mensajero_id
  WHERE a.n >= :min_asignadas
  GROUP BY a.d
),
top_proxy AS (
  SELECT a.d, ARRAY_AGG(a.mensajero_id ORDER BY (e.n::numeric / a.n) DESC, e.n DESC, a.mensajero_id)
                FILTER (WHERE TRUE) AS podio
  FROM asig_proxy a JOIN entregadas e ON e.d = a.d AND e.mensajero_id = a.mensajero_id
  WHERE a.n >= :min_asignadas
  GROUP BY a.d
)
SELECT ta.d,
       ta.podio[1:3] AS podio_actual,
       tp.podio[1:3] AS podio_proxy,
       (ta.podio[1:3] IS DISTINCT FROM tp.podio[1:3]) AS cambia
FROM top_actual ta JOIN top_proxy tp ON tp.d = ta.d
ORDER BY ta.d;
```

⚠️ **Esta consulta reimplementa a mano el criterio de orden que en el código vive en
`lib/ranking/orden-ranking.ts`.** Es aceptable para **medir** —no para decidir en producción—, pero
al pegar el resultado hay que decirlo: si el comparador real desempata distinto, el recuento de días
que cambian puede diferir en los empates. **Autocomprobación:** contar cuántos días salen y comprobar
que coincide con `SELECT COUNT(*) FROM ranking_snapshot_dia WHERE fecha >= CURRENT_DATE - 30`.

**M8 — ¿Hace falta el índice?** `EXPLAIN` **sin `ANALYZE`** (no ejecuta, no escribe):

```sql
EXPLAIN
SELECT o.mensajero_asignado_id, COUNT(*)
FROM orden o
WHERE o.mensajero_asignado_id IS NOT NULL
  AND o.asignado_at >= '2026-08-19T06:00:00Z' AND o.asignado_at < '2026-08-20T06:00:00Z'
GROUP BY 1;
```

Y, sobre una base **con la migración ya aplicada** (local o preview, no producción), el mismo
`EXPLAIN` de la consulta del `OR` de §6.bis.3. **Si el planificador no usa
`orden_fecha_reparto_idx`, el índice no se crea.**

---

## 10. Alternativas descartadas

### A · Una **marca booleana** `orden.para_manana`
Más barata de escribir y de leer. **Descartada porque no caduca sola.** Al día siguiente sigue
diciendo «para mañana», así que el corte la protegería otra vez y **la orden no se barre nunca**.
Para evitarlo habría que apagarla en el corte, y probablemente también al deshacer una gestión, al
liberar por plazo y al reasignar: **una marca con N sitios de limpieza y ninguno que rompa el build
cuando se olvida uno**. Es literalmente el defecto que la **235** pagó —la bandera de ayuda que nadie
apagaba y que dejó una fuga permanente en `/novedades`— y que se cerró retirando la columna.
`db/schema.prisma` conserva el epitafio en el `model Orden`.

### B · Una **tabla lateral** `orden_reparto_programado(orden_id PK, fecha)`
No toca la tabla más caliente y sólo tiene filas para lo diferido (población pequeña). **Descartada
por dos motivos concretos:** (1) el corte pasaría de **dos** consultas que deben decir lo mismo a
**tres** (selección, pre-`SELECT` y `updateMany`), cada una con su `JOIN`/`NOT EXISTS` — y la guardia
que hoy vigila las dos listas nació precisamente porque dos ya eran demasiadas; (2) la fila lateral
necesita **borrarse** en cada reasignación, liberación por plazo, deshacer-asignación y barrido: el
mismo defecto de A, con una tabla en vez de una columna. El ahorro real es el ancho de una columna
`DATE` (4 bytes) en una tabla que ya tiene cinco `Decimal`, un `text` generado y un índice GIN.

### C · **Inferir el día por la hora de la asignación** (p. ej. después de las 18:00 CR ⇒ mañana)
Cero columnas, cero UI. **Descartada porque nadie eligió esa regla y nadie la ve.** Una entrega
urgente asignada a las 19:00 quedaría diferida en silencio, y la única forma de forzar «hoy» sería
esperar a mañana. Además convierte un umbral arbitrario en una regla de negocio invisible, que es lo
contrario de lo que la ficha pide: **que bodega elija**.

### D · Un **estado de orden nuevo** (`programada_para_manana`)
El corte ya filtra por estatus, así que «sacarla de la lista» parece un cambio de una línea.
**Descartada porque los estados son el vocabulario del flujo**: un estado paralelo a `por_recoger`
bifurca *todas* las listas, los mapeos de la UI, los webhooks de cambio de estado, la tabla exhaustiva
de transiciones (140) y las siete listas que la guardia de carga del mensajero vigila. Se paga en
todo el sistema para expresar un dato de **una** orden.

### E · **Mover el reloj del corte** (correrlo a las 04:00 CR en vez de a medianoche)
Es el arreglo de una línea en `vercel.json`. **Descartada porque no arregla nada**: sólo desplaza la
frontera. Quien asigne a las 04:30 tendría el mismo problema, y a cambio el `vencido` de quien de
verdad no cerró su día llegaría cuatro horas tarde. Además no distingue **quién** quiso qué, que es
justo lo que la ficha pide.

### F · Alinear el numerador con el día de reparto *(alternativa de D7)*
Si el denominador cuenta por día de reparto, lo simétrico sería contar la **entrega** en el día de
reparto de su orden, y así numerador y denominador de una misma orden caerían siempre en el mismo día
(desaparecería la asimetría de R40). **Descartada por un bloqueo duro: el snapshot es inmutable y se
congela a las 02:00 CR del día siguiente.** Con el numerador anclado al día de reparto, una entrega
tardía —una orden reservada para `D` entregada el `D+2`— tendría que sumarse al numerador de `D`, que
**ya está congelado** y no se puede reescribir sin romper la inmutabilidad de `ranking_snapshot_*` y
la idempotencia del cron (la unicidad de `fecha` **es** esa idempotencia). El numerador **tiene** que
estar anclado a algo que no reciba escrituras tardías, y `gestion_orden.created_at` lo está.

### G · Rellenar `fecha_reparto` hacia atrás *(backfill)*
Poner a las órdenes existentes la fecha CR de su `asignado_at` dejaría una columna sin nulos y una
consulta de una sola rama. **Descartada por dos motivos:** (1) es un `UPDATE` masivo sobre la tabla
más caliente del sistema para inventar un dato que **nadie eligió** —esas órdenes nunca tuvieron día
de reparto, y escribirlo sería afirmar que sí—; (2) no hace falta: la segunda rama del `OR`
(§6.bis.3) da **exactamente** el mismo resultado sin tocar una fila, y envejece sola. El repo ya tomó
esta misma decisión en la 238 («el histórico NO se backfillea: no hay confirmación cierta que
inventar»).

### H · Un **índice de expresión** para el denominador
`CREATE INDEX ON orden ((COALESCE(fecha_reparto, (asignado_at - interval '6 hours')::date)))`
permitiría escribir el denominador como un `COALESCE` de una sola rama y seguir indexado.
**Descartada porque incrusta las seis horas de Costa Rica en el esquema**: sería una segunda
definición del día operativo, en el peor sitio posible —un índice, donde nadie la busca y de donde
nadie la actualiza—. §3 lo prohíbe y `lib/analytics/ranges.ts` documenta el off-by-one al que lleva.
El `OR` de dos ramas indexables consigue lo mismo sin esa concesión.

### I · Que el corte **no cree `vencido`** a nadie que tenga órdenes reservadas
Parece proteger mejor al mensajero (§5.3). **Descartada porque abre una puerta de escape al cierre**:
bastaría con recibir una asignación nueva cada tarde para no tener que cuadrar caja nunca. La regla
que se mantiene es la sana: el `vencido` nace de **tu** jornada sin cerrar, no de lo que te asignaron
para mañana.

---

## 11. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | **Orden de despliegue.** Si el selector llega **antes** que el corte que lo respeta, las órdenes reservadas se barren igual y la feature se lee como rota. | El corte (T2) es **inerte** con todas las filas en `NULL`: puede y **debe** desplegarse primero o en el mismo PR. Escrito en `tasks.md` como punto de despliegue. |
| 2 | **Un `vencido` con paquetes en la mano** (§5.3): la regla de la 241 muerde más fuerte. | Consciente y documentada. No se blinda (alternativa F). Debe entrar en el aviso operativo a bodega. |
| 3 | **Helper de fecha equivocado** (`inicioDelDiaCREnUtc` en vez de `startOfDayCR`): desplaza el día seis horas y devuelve el defecto por otra puerta. | §3 lo nombra; los tests de T2 usan **reloj inyectado** con casos a ambos lados de la medianoche CR y de las 06:00 UTC. |
| 4 | **Los dos predicados divergen** — el fallo de la 235, repetido. | R16 + guardia de censo dedicada (T6), que se autocomprueba poniéndose roja al desalinear uno de los dos. |
| 5 | **La suite de servicio no ve el `WHERE`.** Este repo ya midió cuatro veces que una mutación del `WHERE` pasa en verde por los tests de servicio (usan dobles). | Los casos que **de verdad** protegen R11/R12 viven en el **repositorio**, con dobles que honran el `where`, y hay una mutación obligatoria (T6) con salida real pegada. |
| 6 | **Una orden protegida para siempre.** | Imposible por construcción: el máximo reservable es un día (D2) y el ancla del corte avanza sola (§5.1). Hay un caso de test que corre **dos** cortes consecutivos y afirma que la segunda corrida sí la barre (R13). |
| 7 | **El podio del día del despliegue sale falso** si el denominador contase sólo `fecha_reparto = X`: las órdenes anteriores desaparecen, todos los porcentajes suben y el premio se lo lleva quien no debe. **Es el peligro de dinero de esta ficha.** | La segunda rama del `OR` (§6.bis.3, R37/R43) y un test que la ejercita con una mezcla de órdenes con y sin fecha. **Mutación obligatoria**: quitar esa rama tiene que poner rojo un caso, con salida real. |
| 8 | **Doble conteo entre las dos ramas del `OR`**: sin la cláusula `fechaReparto: null`, una orden asignada hoy para mañana entra en los denominadores de **los dos** días. | Las ramas son disjuntas por construcción; hay un caso testigo dedicado y su mutación. |
| 9 | **Mezclar las dos convenciones de fecha** en la misma consulta del ranking (`DATE` a medianoche UTC vs `timestamp` a las 06:00Z): desplaza el día seis horas — el defecto que cerró la 166. | §6.bis.2 lo nombra; los tres valores los calcula el **llamador** y ninguno se deriva del otro; `ranking-ventana-dia.guardia.test.ts` se **amplía**, no se relaja. |
| 10 | **El riesgo era el contrario del que esta tabla decía.** Decía «un índice de más… por una consulta que quizá ya estaba haciendo un recorrido completo». **M8 lo desmintió**: la consulta **no** hacía un recorrido completo —tenía un `Index Only Scan`— y el riesgo real era **perderlo** al añadir el `OR`. | Medido (§2.1 v3): se **amplía** el compuesto que ya existe en vez de crear uno suelto (el suelto degradaba a `Bitmap Heap Scan`). El número de índices no sube. Lo que no se puede recuperar —el acotado por rango— **se declara como coste de D7**, no se esconde. ⏳ **Re-medir con volumen**: ni producción (141 órdenes) ni local (67) deciden por coste. |
| 11 | **La ficha se lleva por delante el ranking sin que nadie lo espere.** D7 se firmó en contra de la recomendación; quien lea el título de la ficha dentro de seis meses no adivinará que aquí se movió el podio. | El registro está en `requirements.md` §D7 y §«PUERTA HUMANA PASADA», con la recomendación original íntegra, y en la `status_note` de la ficha. |
| 12 | **M5 y M7 son PROXIES** y es fácil pegarlos como si fueran el efecto real. | Van etiquetados en los dos archivos y con autocomprobación; M7 además **reimplementa a mano** el comparador que en el código vive en un módulo puro, y eso se dice al pegar el resultado. |

---

## 12. Documentación que esta ficha deja al día

- El comentario de `ESTADOS_A_BARRER` en `CorteDiarioRepository`, que hoy describe la selección como
  «quiénes entran en el bucle» por estatus: pasa a describir **estatus + día**.
- El comentario del bloque `corteSinGestionar` en `CierreDiaRepository.crearCierre`.
- La cabecera de `lib/utils/fecha-cr.ts`, con el tercer consumidor de `startOfDayCR`.
- **La cabecera de `RankingRepository`**, que hoy describe el denominador como «órdenes asignadas
  HOY(CR) por mensajero actualmente asignado»: pasa a describir las **dos ramas** y por qué son
  disjuntas.
- **El comentario de `TableroDiaRepository`** que dice que `asignado_at` «es el denominador del
  ranking diario»: **deja de ser cierto** con D7 firmada. Se corrige diga lo que diga D10 — si el
  tablero no sigue al ranking, ese comentario tiene que explicar por qué las dos cifras difieren.
- **El ⛔ de `lib/ranking/snapshot-dia.ts`** que prohíbe importar `startOfDayCR`: sigue vigente para
  las cotas del numerador, pero ahora convive con una fecha `DATE` que **sí** usa esa convención. El
  comentario tiene que distinguir las dos o invitará a borrarlo.
- `progress/impl_246.md`: mediciones **M1-M8** con su autocomprobación y con la etiqueta de PROXY en
  M5/M7, salidas reales de las mutaciones y el recorrido de «ver la app».
