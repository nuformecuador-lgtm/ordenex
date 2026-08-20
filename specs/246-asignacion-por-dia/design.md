# Feature 246 — Diseño

> Leer antes: `requirements.md` (R1-R35, D1-D9). Este documento decide **cómo**; los números que
> faltan se miden en **T0** con las consultas de §9.

---

## 0. El cambio, en una línea de causa y efecto

Una orden gana un **día de reparto**. El corte deja de barrer —y de generar `vencido` por— las
órdenes cuyo día de reparto **aún no ha llegado**. Nada más cambia: ni un estado, ni un importe, ni
un total de cierre.

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
- **Sin índice**, y no es un olvido: el barrido filtra por `mensajero_asignado_id` (que ya tiene
  `@@index`), y la fecha es un filtro **residual** sobre las órdenes de **un** mensajero. La
  selección filtra por `estatus_id` (indexado) sobre la población en `en_reparto`, que a medianoche
  es pequeña — **cuantificada en M2**. Un índice que nadie usa se paga en cada escritura de la tabla
  más caliente del sistema; ese razonamiento es literal de
  `20260819170000_gestion_orden_confirmacion_fisica/migration.sql`.
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
```

El `migration.sql` lleva su razonamiento **entero** arriba, al nivel de la 238: qué es, por qué una
columna y no una tabla lateral (D1), por qué una fecha y no una marca (D2), qué significa `NULL` (una
sola cosa, R20), por qué sin índice, por qué sin `CHECK`, y que es **aditiva** (no renombra, no
reordena, no borra, no toca filas, no toca índices, no toca RLS).

### 2.3 El `down.sql`, pensado

```sql
ALTER TABLE "orden" DROP COLUMN IF EXISTS "fecha_reparto";
```

- **Pérdida de dato declarada:** se pierden todas las reservas vigentes.
- **Consecuencia operativa que hay que escribir en el propio `down.sql`:** revertir esta migración
  **devuelve al corte su comportamiento anterior**, y por tanto **la primera corrida posterior barrerá
  las órdenes que estaban reservadas para mañana**. No es una reversión inocua como la de la 238 (que
  sólo perdía un rastro de auditoría). Quien haga rollback tiene que saberlo.
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

**Rojos que son REGRESIÓN** (si aparecen, alguien tocó lo que esta ficha no toca):

- `tests/unit/guards/carga-del-mensajero.guardia.test.ts` — las listas de estatus **no cambian** en
  esta ficha. Un rojo ahí significa que alguien movió `ESTADOS_A_BARRER` o `ESTADOS_REPARTO_PENDIENTE`.
- `tests/unit/guards/ranking-ventana-dia.guardia.test.ts`, `tests/unit/services/ranking-service.test.ts`,
  `tests/unit/repositories/tablero-dia-sql.test.ts` — R33: el denominador **sigue** siendo
  `asignado_at`. Un rojo ahí es D7 colándose por la puerta de atrás.
- `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` — esta ficha **no** cambia quién
  escribe `asignado_at`, sólo **acompaña** cada escritura.
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

### F · Que el corte **no cree `vencido`** a nadie que tenga órdenes reservadas
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
| 7 | **El ranking castiga al mensajero** (D7). | No se arregla; se **nombra**, se mide y se deja como ficha aparte. R33 lo congela para que nadie lo mueva de tapadillo. |

---

## 12. Documentación que esta ficha deja al día

- El comentario de `ESTADOS_A_BARRER` en `CorteDiarioRepository`, que hoy describe la selección como
  «quiénes entran en el bucle» por estatus: pasa a describir **estatus + día**.
- El comentario del bloque `corteSinGestionar` en `CierreDiaRepository.crearCierre`.
- La cabecera de `lib/utils/fecha-cr.ts`, con el tercer consumidor de `startOfDayCR`.
- `progress/impl_246.md`: mediciones M1-M4 con su autocomprobación, salidas reales de las mutaciones
  y el recorrido de «ver la app».
