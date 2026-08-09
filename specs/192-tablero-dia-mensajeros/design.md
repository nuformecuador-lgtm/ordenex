# Feature 192 — Diseño técnico

Tablero del día: una **tarjeta por mensajero** con las órdenes asignadas hoy y en qué
terminó cada una — incluido lo que **aún no arrancó**. Refresco cada 30 s. Al pulsar una
tarjeta se abre el **detalle** con las órdenes que hay detrás.

> **Revisión del 2026-08-08** (segunda puerta): el humano respondió las cinco preguntas
> abiertas. Tres respuestas ampliaron el alcance y este documento las incorpora:
> §2.1 (segundo eje `orden.estatus_id` y desglose de "sin resultado"), §7 (tarjetas en
> vez de filas de tabla), §7.3 (drill-down) y §7.4 (ítem de menú "Monitoreo").

Referencias de código verificadas que este diseño respeta:
`lib/analytics/alcance.ts:196-206`, `lib/utils/fecha-cr.ts:98-119`,
`lib/analytics/rollup-dia.ts:14-17`, `db/schema.prisma:495-496,565,650-658,486`,
`lib/auth/resolve-actor.ts:15-34`.

---

## 1. Modelo de datos

**No hay migración. No hay tabla nueva. No hay columna nueva. No hay índice nuevo.**
Todo sale de lo que ya existe:

| Dato | Origen |
| --- | --- |
| Mensajero de la fila | `orden.mensajero_asignado_id` (`db/schema.prisma:495`) |
| Pertenencia al día | `orden.asignado_at` (`db/schema.prisma:496`) |
| Recorte por zona | `orden.zona_id` — NOT NULL (`db/schema.prisma:486`) |
| Resultado | `gestion_orden.resultado` :: enum `gestion_resultado`, 5 valores (`db/schema.prisma:650-658`) |
| Estatus actual (2.º eje) | `orden.estatus_id` → `order_status.value` (`lib/types/order-status.ts`, 19 values sembrados) |
| Vigencia de la gestión | `gestion_orden.anulada_at IS NULL` |
| Momento de la gestión | `gestion_orden.created_at` |
| Nombre del mensajero | `usuario.nombre`, `usuario.primer_apellido` |

El índice que sostiene la consulta ya existe y nació exactamente para esto:
`@@index([mensajeroAsignadoId, asignadoAt])` (`db/schema.prisma:565`, "denominador del
ranking diario").

**RLS.** No se crea ninguna tabla, así que no hay policy que escribir; y no la habría
aunque se creara: Prisma se conecta con credenciales de servicio y en `db/migrations/` no
hay ni una policy. Consecuencia asumida y documentada: **el recorte por rol del §3 es la
única separación entre inquilinos de esta pantalla**, por eso lleva requisitos EARS
propios (R1–R11) y guardias, y por eso se aplica en el `WHERE` y no en memoria (R10).

---

## 1.bis El segundo eje: desglose de "sin resultado" (R21, R43–R46)

El humano pidió ver **"el estado de sus órdenes (incluyendo sin recoger)"**: distinguir al
mensajero que **no ha arrancado** del que **está en la calle**. Ambos casos son hoy "orden
asignada sin gestión vigente en el día", así que el desglose no puede salir de
`gestion_resultado`: hace falta leer `orden.estatus_id`.

**El mapa (asunción del spec_author, R43 — el humano puede vetarlo en la puerta):**

```ts
// lib/types/tablero-dia.ts — mapa TOTAL sobre el catálogo, no un `switch` con default
export const BUCKET_POR_ESTATUS = {
  por_recoger:   "sinRecoger",   // tiene guía y mensajero, espera que el mensajero la acepte
  recolectando:  "sinRecoger",   // feature 157: alguien va en camino a la tienda
  en_reparto:    "enReparto",    // feature 36: FUE recogida por el mensajero
  // …los 16 values restantes: "otros"
} as const satisfies Partial<Record<OrderStatusValue, BucketSinResultado>>;
```

Tres reglas que lo sostienen:

1. **`por_recolectar_en_tienda` → `otros`, no `sinRecoger`** (R44). En ese estatus *nadie
   va todavía*: desde la ampliación de la 157 la asignación es una **transición** a
   `recolectando` (`GuiaAsignacionService.ts:68-70,482`), y "quitar mensajero" la devuelve
   a `por_recolectar_en_tienda` **dejándola sin mensajero**
   (`GuiaAsignacionService.ts:495-496`), con lo que sale del tablero por R18. Verla en
   `sinRecoger` sería contar como "trabajo parado de este mensajero" algo que no es de
   nadie.
2. **`otros` se pinta, no se esconde** (R45). Ahí caen `sin_gestionar`,
   `en_bodega_satelite`, los terminales de una gestión anulada, etc. Es el bucket que
   delata que el mapa se quedó corto; absorberlos en `sinRecoger` haría que un cambio de
   flujo pasara desapercibido.
3. **El catálogo se mueve** (R46): siete cambios documentados en el encabezado de
   `order-status.ts` (renames de la 135 y la 153, apéndices de la 139/154, retiro de la
   155). Por eso el mapa se declara `satisfies` sobre `OrderStatusValue` y hay un test que
   comprueba que **todo** value del catálogo tiene bucket asignado: un value nuevo o
   renombrado deja el build o el test rojo, no reclasifica en silencio.

> **Resuelto en la tercera vuelta (2026-08-08): opción C.** `asignarRecoleccionLote`
> (feature 157) **no estampa `asignado_at` a propósito**
> (`lib/repositories/OrdenRepository.ts:1820-1823`, R38 de aquella feature: es el
> denominador del ranking y estamparlo bajaría el porcentaje del mensajero). En vez de
> tocar esa columna, el tablero añade un **segundo camino** a "asignada hoy" que lee el
> historial. Ver §1.ter. `recolectando` pasa así a ser alcanzable y el mapa de arriba lo
> clasifica bien.

## 1.ter "Asignada hoy" tiene DOS caminos (R57–R61, R64, R65)

Decisión humana del 2026-08-08 (**opción C**), tras descartar A (no ver las recolecciones)
y B (estampar `asignado_at`, §9 alternativa 14).

| Camino | Criterio | Fuente |
| --- | --- | --- |
| Reparto | `orden.asignado_at ∈ [desde, hasta)` | `orden` (índice `(mensajero_asignado_id, asignado_at)`) |
| Recolección | existe fila en `orden_historial_estado` con `origen_tipo = 'asignacion_recoleccion'` y `created_at ∈ [desde, hasta)` | historial de la 157 |

Hechos verificados que lo sostienen:

- El productor existe y es único: la 157 escribe esa fila **en la misma transacción** que
  la transición `por_recolectar_en_tienda → recolectando`
  (`IOrdenRepository.ts:1100-1105`, enum en `db/schema.prisma:1410`, arista declarada en
  `lib/types/order-status-transiciones.ts:118`). No hay un segundo productor de ese
  `origen_tipo`, así que el criterio no puede pescar otra cosa.
- El mensajero de la fila sale de `orden.mensajero_asignado_id` **también** en este camino
  (R60): la 157 lo escribe en la misma tx. El `actor_usuario_id` del historial es el
  maestro que **decide**, no quien reparte; usarlo pondría las órdenes en la tarjeta del
  maestro.
- **Sin doble conteo** (R58): la unión se hace por `orden_id` (`UNION` de conjuntos de
  ids, no `UNION ALL`, §5), así que una orden alcanzable por los dos caminos aporta 1. Si
  se usara `UNION ALL` la identidad de R25 se rompería en silencio y los totales
  superarían las asignadas — el mismo error que la rama A que el humano ya descartó.

> ⛔ **`asignado_at` no se toca. Nunca** (R59). Ni se estampa al asignar recolecciones, ni
> se backfillea, ni se "unifica" en una migración de limpieza. Es el denominador del
> ranking (feature 76/R38, ficha 166): moverlo mueve el porcentaje del mensajero y con él
> su pago y su premio. Esta feature es **sólo lectura** sobre esa columna, y hay un guardia
> que lo atornilla (§8, R59) para que un futuro "ya que estamos" salga rojo.

## 2. Capas

```
app/(app)/monitoreo/page.tsx                    Server Component: gate de rol + shell
  └─ _components/TableroDiaModule.tsx           Client: useSWR(refreshInterval 30_000)
        ├─ _components/MensajeroCard.tsx        tarjeta clicable (R28/R47)
        └─ _components/DetalleMensajeroPanel.tsx  drill-down (R47–R52)
              │
              ├─ lib/actions/tablero-dia.ts     Server Action: leerTableroDia()
              │     └─ lib/services/TableroDiaService.ts      alcance + ventana + totales
              │           ├─ lib/cache/…-tablero-dia-cache.ts  caché ~15 s (§5.quater)
              │           └─ lib/repositories/TableroDiaRepository.ts   1 consulta agregada
              └─ lib/actions/tablero-dia.ts     Server Action: leerDetalleMensajeroDia()
                    └─ TableroDiaService.detalle()
                          └─ TableroDiaRepository.listarOrdenesDelDia()  (paginada)
```

Interfaces (una por archivo, `docs/architecture.md`):
- `lib/interfaces/services/ITableroDiaService.ts`
- `lib/interfaces/repositories/ITableroDiaRepository.ts`
- `lib/interfaces/external/ITableroDiaCache.ts` (§5.quater)

La ruta es `/monitoreo` (no `/tablero-dia`): el ítem de menú se llama "Monitoreo" (§7.4) y
una ruta que no se llama como su ítem envejece mal.

Módulo puro auxiliar: `lib/utils/ventana-dia-cr.ts` (ver §4).

---

## 3. Alcance por rol (frontera de seguridad)

### 3.1 Se CONSUME `resolverAlcance`, no se reimplementa (R8)

El servicio llama a `resolverAlcance(actor, METRICA_ALCANCE_TABLERO)` de
`lib/analytics/alcance.ts`. La dirección de la dependencia es **servicio → analytics**,
que es la permitida: el guardia `tests/unit/analytics/modulo-puro.guardia.test.ts`
prohíbe que `lib/analytics/` importe `repositories`/`services`, no al revés. **Esta
feature no modifica ni un archivo de `lib/analytics/`.**

### 3.2 El `metricaId` que se pasa

`resolverAlcance` exige un `metricaId` del catálogo (`lib/analytics/metrics.ts`); un id
desconocido devuelve `denegado("metrica_desconocida")`. Se usa el id existente
**`"ordenes_por_estado"`**, y se declara en un único sitio:

```ts
// lib/services/TableroDiaService.ts
/** Métrica del catálogo cuyo alcance gobierna este tablero. NO se añade una métrica nueva. */
export const METRICA_ALCANCE_TABLERO = "ordenes_por_estado";
```

Por qué esa y no otra: es la única métrica operativa que cuenta **órdenes**
(`unidadDeConteo: "orden"`) con grano `mensajero` y `zona`, atribuyendo por
`orden.zona_id` (`definicion.atribucionZona: "orden"`) — exactamente la semántica del
tablero. Su `alcance` es `ALCANCE_OPERATIVA`: `maestro`/`admin` → `total`,
`adminSatelite` → `acotado`.

Guardia: un test comprueba que `METRICA_ALCANCE_TABLERO` existe en `METRICAS` con
`unidadDeConteo === "orden"` y grano `mensajero`. Sin él, renombrar la métrica dejaría el
tablero denegado para todo el mundo (falla cerrada, pero silenciosa: la pantalla muere).

### 3.3 Traducción alcance → filtro, con lista blanca

```
resolverAlcance ─┬─ { estado:"denegado", motivo }        → denegado(motivo)
                 ├─ { tipo:"global" }                    → filtro { zonaId: null }   (R4)
                 ├─ { tipo:"zona", zonaId }              → filtro { zonaId }         (R5)
                 └─ { tipo:"tienda" } | { tipo:"mensajero" } → denegado("rol_no_autorizado") (R3/R9)
```

Es un `switch` **exhaustivo sin `default`** sobre el union `AlcanceDatos`: un sexto tipo
de alcance no compila en vez de colarse por una rama permisiva. `adminTienda` y
`mensajero` obtienen `ok` de `resolverAlcance` (tienda / mensajero), y esta lista blanca
es la que los deja fuera del tablero (decisión humana R1). El `adminSatelite` sin zona ni
siquiera llega aquí: `resolverAlcance` ya devuelve `denegado("sin_zona_asignada")`
(`alcance.ts:204`), y el borde lo traduce a denegado (R7).

`zonaId: null` **sólo** puede nacer de la rama `global`. No hay ningún camino en que un
fallo de datos produzca `null` y con él una consulta sin filtro: el tipo del filtro es
`{ tipo: "global" } | { tipo: "zona"; zonaId: string }`, no un `string | null` suelto.

### 3.3.bis El detalle atraviesa la frontera OTRA VEZ (R40–R42)

`TableroDiaService.detalle(actor, now, mensajeroId, pagina)` **repite el mismo camino**:
`resolverAlcance` → lista blanca → filtro. No recibe el filtro ya resuelto desde el
cliente, no confía en que la tarjeta viniera recortada y no acepta un `zonaId` del
navegador. El `mensajeroId` es **entrada externa**: se valida con zod (uuid) en la Server
Action, y el `WHERE` de la consulta lleva **a la vez** el `mensajero_asignado_id` pedido,
la ventana del día y el recorte por `orden.zona_id` (R41). Un `adminSatelite` que pida el
detalle de un mensajero de otra zona obtiene **cero órdenes**, no un error que confirme
que ese mensajero existe (R42).

Esto es explícitamente redundante con el tablero, y la redundancia es el punto: dos
puertas a las mismas filas son dos sitios donde hay que aplicar la frontera. Un detalle
que se fiara del conteo ya recortado sería un `IDOR` de manual.

### 3.4 Contrato de denegación

`lib/actions/tablero-dia.ts` no puede devolver un 403 HTTP (es una Server Action), así
que devuelve un resultado discriminado y **nunca** filas:

```ts
type MotivoTableroDia = MotivoDenegacion | "rol_no_autorizado"; // import type, sin runtime
type ResultadoTableroDia =
  | { estado: "ok"; tablero: TableroDia }
  | { estado: "denegado"; motivo: MotivoTableroDia };
```

El motivo es un literal de un dominio cerrado: nunca lleva ids ajenos, nombres ni PII.
La pantalla, además, se cierra en el servidor con `notFound()` para los roles fuera de
R1, mismo patrón que `app/(app)/analitica/page.tsx:82-84` (R11).

---

## 4. La ventana del día (R12–R17)

Módulo nuevo, **puro** y con reloj inyectado: `lib/utils/ventana-dia-cr.ts`.

```ts
export interface VentanaDiaCR { readonly fecha: string; readonly desde: Date; readonly hasta: Date; }

export function ventanaDelDiaEnCursoCR(now: Date): VentanaDiaCR {
  const fecha = fechaCalendarioCR(now);                 // "YYYY-MM-DD" en hora CR
  return { fecha, desde: inicioDelDiaCREnUtc(fecha), hasta: inicioDelDiaSiguienteCREnUtc(fecha) };
}
```

Se apoya **sólo** en `lib/utils/fecha-cr.ts` (`fechaCalendarioCR`,
`inicioDelDiaCREnUtc`, `inicioDelDiaSiguienteCREnUtc`): `[fecha T06:00:00Z,
fecha+1 T06:00:00Z)`, semiabierto, sin reimplementar ni una hora de desplazamiento.

⛔ **`startOfDayCR` no se importa aquí ni en ningún módulo de la feature.** Devuelve la
medianoche **UTC** de la fecha calendario CR — seis horas antes del comienzo real del día
en Costa Rica — y contra columnas `timestamp` produce la ventana 18:00–18:00 que hoy
arrastra `RankingService` (ficha 166; trampa documentada en `rollup-dia.ts:14-17`). Si la
ventana se equivoca, los contadores no cuadran con lo que ve el maestro y parece un bug
de la pantalla. Se blinda con un guardia de imports (§8, R17).

`now` es **parámetro obligatorio**, sin default `new Date()`: un default deja que un test
crea que controla el reloj cuando no lo hace (misma regla que `rollup-dia.ts:59`). El
único `new Date()` de la feature vive en la Server Action, que es el borde.

**No se reutiliza `lib/analytics/rollup-dia.ts`** ni su `ventanaDelDia`: ese módulo es el
escritor del rollup de **cierre** de día (fecha objetivo D−1, corte estricto, caché), y
esto es el día **en curso** sobre tablas vivas (R38). Acoplarse a él para ahorrar seis
líneas ataría el tablero en vivo al calendario del job nocturno.

---

## 5. La consulta (R36–R39)

Una sola llamada `$queryRaw` en `lib/repositories/TableroDiaRepository.ts`, con el
cliente Prisma estrechado a `Pick<PrismaClient, "$queryRaw">` (patrón de
`AnaliticaOperativaVivaRepository.ts:45`).

```sql
WITH ids_reparto AS (                       -- camino 1 (R18)
  SELECT o.id FROM orden o
  WHERE o.mensajero_asignado_id IS NOT NULL
    AND o.asignado_at >= $desde AND o.asignado_at < $hasta
),
ids_recoleccion AS (                        -- camino 2 (R57)
  SELECT DISTINCT h.orden_id AS id
  FROM orden_historial_estado h
  WHERE h.origen_tipo = 'asignacion_recoleccion'
    AND h.created_at >= $desde AND h.created_at < $hasta
),
ids_del_dia AS (                            -- UNION (de conjuntos), NO UNION ALL (R58)
  SELECT id FROM ids_reparto
  UNION
  SELECT id FROM ids_recoleccion
),
asignadas AS (
  SELECT o.id AS orden_id, o.mensajero_asignado_id AS mensajero_id, s.value AS estatus
  FROM ids_del_dia d
  JOIN orden o        ON o.id = d.id
  JOIN order_status s ON s.id = o.estatus_id
  WHERE o.mensajero_asignado_id IS NOT NULL   -- también filtra el camino 2 (R60)
    -- fragmento presente SOLO cuando el alcance es zona:
    AND o.zona_id = $zonaId
),
resultado_final AS (
  SELECT DISTINCT ON (g.orden_id) g.orden_id, g.resultado
  FROM gestion_orden g
  JOIN asignadas a ON a.orden_id = g.orden_id
  WHERE g.anulada_at IS NULL
    AND g.created_at >= $desde
    AND g.created_at <  $hasta
  ORDER BY g.orden_id, g.created_at DESC, g.id DESC
)
SELECT
  a.mensajero_id,
  u.nombre,
  u.primer_apellido,
  COUNT(*)                                                        AS asignadas,
  COUNT(*) FILTER (WHERE r.resultado = 'entregada')               AS entregadas,
  COUNT(*) FILTER (WHERE r.resultado = 'reprogramada')            AS reprogramadas,
  COUNT(*) FILTER (WHERE r.resultado = 'devuelta')                AS devueltas,
  COUNT(*) FILTER (WHERE r.resultado = 'rechazada')               AS rechazadas,
  COUNT(*) FILTER (WHERE r.resultado = 'incidente')               AS incidentes,
  -- segundo eje (R21/R43): sólo para las que NO tienen resultado del día
  COUNT(*) FILTER (WHERE r.resultado IS NULL
                     AND a.estatus IN ('por_recoger','recolectando'))  AS sin_recoger,
  COUNT(*) FILTER (WHERE r.resultado IS NULL
                     AND a.estatus = 'en_reparto')                     AS en_reparto,
  COUNT(*) FILTER (WHERE r.resultado IS NULL
                     AND a.estatus NOT IN ('por_recoger','recolectando','en_reparto')) AS otros
FROM asignadas a
JOIN usuario u ON u.id = a.mensajero_id
LEFT JOIN resultado_final r ON r.orden_id = a.orden_id
GROUP BY a.mensajero_id, u.nombre, u.primer_apellido
ORDER BY asignadas DESC, u.nombre ASC, a.mensajero_id ASC;
```

Notas que el implementer **no** puede saltarse:

1. **`DISTINCT ON` es lo que compra la rama B.** Colapsa las N gestiones del día de una
   orden a una sola fila (la última), de modo que cada orden aporta exactamente 1 (R20) y
   la identidad de R25 se cumple **por construcción**: los seis `FILTER` son particiones
   disjuntas y exhaustivas del mismo `COUNT(*)`. Contar `gestion_orden` directamente (lo
   que descartó el humano) rompería la identidad porque `GestionOrden` no tiene
   `@@unique(ordenId)`.
2. **Desempate `g.id DESC`.** Dos gestiones con el mismo `created_at` (mismo milisegundo)
   harían el resultado no determinista; el desempate por `id` lo fija.
3. **Los buckets salen de `r.resultado IS NULL` + `a.estatus`**, no de una resta en JS: si
   el enum `gestion_resultado` ganara un sexto valor, ese valor caería en `otros` en
   silencio. Por eso R27 se cubre además con un guardia de exhaustividad en TypeScript
   (§8). Las tres ramas del segundo eje son **disjuntas y exhaustivas** por construcción
   (`IN` / `=` / `NOT IN` sobre el mismo predicado), que es lo que hace cierta la
   identidad de R25 sin comprobarla a posteriori.
3.bis **Las listas de estatus NO se escriben a mano en el SQL.** Se derivan de
   `BUCKET_POR_ESTATUS` (§1.bis) y viajan como **parámetros** (`= ANY($…)`). Escribirlas
   dos veces —una en TypeScript y otra en la cadena SQL— es exactamente la lista paralela
   que R46 persigue. El fragmento de arriba las muestra literales sólo por legibilidad.
4. **El fragmento de zona se compone con `Prisma.sql`/`Prisma.empty`**, con el `zonaId`
   como **parámetro**. Nunca por interpolación de cadena.
5. **`COUNT` devuelve `bigint`.** El repositorio convierte a `number` en el mapeo de
   filas: un `BigInt` no es serializable al cruzar la frontera RSC y reventaría la
   Server Action.
6. **Cardinalidad**: la consulta devuelve una fila por mensajero (R39). El único `findMany`
   admisible en la feature es la consulta **paginada** del detalle (§5.bis); el guardia de
   §8 lo acota a ese único método.
7. El predicado `mensajero_asignado_id IS NOT NULL AND asignado_at ∈ [desde, hasta)`
   es exactamente el prefijo del índice `(mensajero_asignado_id, asignado_at)` (R37).
8. **`UNION`, nunca `UNION ALL`** (R58). Es la línea de la que depende que los números
   cuadren: una orden que entra por los dos caminos aparecería dos veces con `UNION ALL`,
   inflando `asignadas` y rompiendo la identidad de R25. Hay un test dedicado con una
   orden alcanzable por ambos.
9. **El recorte multi-tenant se aplica UNA vez, en `asignadas`**, después de la unión, no
   dentro de cada CTE: los dos caminos producen ids, y el `WHERE o.zona_id = $zonaId`
   sobre la orden real es lo que decide. Así no hay forma de que un camino se olvide del
   filtro (R10). `ids_recoleccion` no filtra por zona a propósito — no puede: no conoce la
   orden todavía— y por eso el `JOIN orden` posterior es obligatorio, nunca opcional.
10. **El historial NO aporta el mensajero** (R60): `ids_recoleccion` selecciona sólo
    `orden_id`, jamás `actor_usuario_id`. Si alguien lo "optimiza" agrupando por el actor
    del historial, las órdenes acaban en la tarjeta del maestro que asignó.
11. **Sólo lectura sobre `orden.asignado_at`** (R59): esta consulta —y toda la feature—
    únicamente la lee en un `WHERE`. No hay `UPDATE` de esa columna en ninguna capa.

---

## 5.ter Riesgo medido: el camino 2 NO tiene índice (R37, R65)

**El hecho, verificado.** `orden_historial_estado` tiene exactamente tres índices
(`db/schema.prisma:1445-1456`):

| Índice | ¿Sirve para `origen_tipo = 'asignacion_recoleccion' AND created_at ∈ [día)`? |
| --- | --- |
| `(orden_id, created_at)` | **No.** Empieza por `orden_id` y la consulta no filtra por orden. |
| `(orden_id, estatus_destino_id)` | **No.** Mismo motivo. |
| `(actor_usuario_id, origen_tipo, created_at)` (feature 167) | **No.** Empieza por `actor_usuario_id`; el tablero no puede fijar el actor (asigna cualquier maestro/admin). |

**La consulta concreta que queda sin cubrir** es `ids_recoleccion` del §5:

```sql
SELECT DISTINCT h.orden_id
FROM orden_historial_estado h
WHERE h.origen_tipo = 'asignacion_recoleccion'
  AND h.created_at >= $desde AND h.created_at < $hasta;
```

**El coste.** Recorrido secuencial de una tabla **append-only que crece con cada
transición de estado del sistema** (24 tipos de origen), disparado cada 30 s por cada
usuario con el tablero abierto. Hoy es barato; su curva es el problema, y empeora
exactamente cuando el negocio crece. No se descubre en una demo: se descubre en producción
con la tabla ya grande.

### La decisión, y qué se compró y qué se pagó

**DECIDIDO (humano, 2026-08-08, cuarta vuelta): opción 2 — SIN índice nuevo. R37 se
conserva intacto: esta feature no crea índices.** El recorrido secuencial se acepta y se
mitiga con una caché de servidor de ~15 s (§5.quater, R66–R73).

Sin adornos, para quien lea esto en seis meses:

- **Lo que se compró:** cero migraciones y cero superficie nueva en el esquema. La feature
  entra sin tocar la base.
- **Lo que se pagó:** `ids_recoleccion` queda como **recorrido secuencial sobre una tabla
  append-only**. La caché **acota la frecuencia del escaneo, no su costo**: cada escaneo
  cuesta exactamente lo mismo que costaría sin caché, y ese costo crece con el historial.
  Lo que la caché evita es que ese escaneo se repita por cada usuario y por cada tick de
  30 s; no lo abarata ni una fila.
- **El precedente que se decidió no seguir:** la feature 167 tuvo la consulta gemela —el
  mismo `origen_tipo` + `created_at` sobre esta misma tabla— y la resolvió **con un
  índice**, razonando por escrito que "sin este índice sería un seq scan sobre una tabla
  append-only que crece con CADA transición del sistema, en una pantalla que el mensajero
  abre decenas de veces al día" (`db/schema.prisma:1447-1456`). Aquí se eligió lo
  contrario, a sabiendas.
- **La señal para revisarlo:** si el tablero se vuelve lento o el historial crece de forma
  visible, la respuesta correcta ya está escrita y medida —el índice parcial de abajo—, y
  reabrirla es una ficha nueva de una tarde, no una investigación.

Índice que **NO** se crea en esta feature, dejado escrito para esa ficha futura:

```sql
-- UP (si algún día se autoriza)
CREATE INDEX orden_historial_asignacion_recoleccion_created_idx
  ON orden_historial_estado (created_at)
  WHERE origen_tipo = 'asignacion_recoleccion';
-- DOWN
DROP INDEX orden_historial_asignacion_recoleccion_created_idx;
```

(62 caracteres de nombre: por debajo del límite de 63 de Postgres, la trampa que documenta
el índice de la 167.)

Descartadas por incorrectas, no por caras:

- **Acotar el camino 2 a las órdenes en estatus `recolectando`** (que sí tiene índice,
  `db/schema.prisma:562`). Perdería toda orden que se recolectó y ya avanzó a
  `en_ruta_bodega_central` ese mismo día: desaparecería de `asignadas` a mitad de jornada
  y con ella el trabajo hecho, rompiendo la identidad de R25 justo cuando el mensajero
  cumple.
- **Buscar en el historial por `actor_usuario_id`** para usar el índice de la 167. El
  actor es el maestro que asigna, no el mensajero: no hay valor que fijar.

## 5.quater La caché de servidor (R66–R73)

> Es la pieza más delicada de esta feature. No porque sea difícil, sino porque su modo de
> fallo es silencioso: una caché mal claveada **no rompe**, responde rápido y con los datos
> de otro inquilino.

### La clave: el ALCANCE, no el usuario (R67, R68, R70)

```ts
// lib/services/TableroDiaService.ts
function claveDeTablero(alcance: AlcanceDatos, fechaCR: string): string {
  // Componentes unidos por el separador `US` (U+001F), el mismo criterio de
  // `cache-clave.ts:44`: no puede aparecer dentro de un uuid ni de una fecha, así que dos
  // claves distintas no pueden colapsar en una por concatenación ambigua.
  return ["tablero-dia", "v1", `a=${claveDeAlcance(alcance)}`, `d=${fechaCR}`].join("");
}
```

Tres componentes y ninguno es decorativo:

1. **`claveDeAlcance(alcance)`** — se **reutiliza** de `lib/analytics/cache-clave.ts:85`
   (módulo puro; consumirlo desde un servicio es la dirección permitida). Es un `switch`
   exhaustivo sobre las cuatro variantes de `AlcanceDatos` y **el id va siempre**:
   `zona:z1` y `zona:z2` no pueden compartir entrada. No se reescribe aquí porque una
   segunda codificación del alcance que divergiera en silencio es exactamente la fuga que
   se quiere evitar; y el razonamiento ya está escrito en aquel archivo (R6 de la 128:
   *"una clave que no distingue el alcance NO da una cifra equivocada: filtra datos entre
   roles"*). El nuestro es el mismo problema.
2. **`fechaCR`** — la fecha calendario CR del día consultado (R70). Sin ella, la entrada
   producida a las 23:59:55 CR seguiría sirviéndose después de medianoche y el tablero
   mostraría el día anterior justo cuando el operador empieza el nuevo.
3. **Prefijo `tablero-dia` + versión `v1`** — espacio de nombres propio. Ninguna entrada
   de esta feature puede colisionar con las de la caché de analítica (R38), y el `v1`
   permite invalidar en frío cambiando el literal si el **contenido** del valor cambia de
   forma (que no es lo mismo que invalidar por evento, prohibido por R71).

**Por qué el alcance y no el `usuarioId`** (R68): dos satélites de la misma zona ven
exactamente las mismas filas, así que deben compartir entrada — si la clave llevara el
usuario, con N usuarios habría N escaneos y la caché no serviría para nada. Y dos actores
de zonas distintas jamás comparten, porque el alcance es distinto. El rol tampoco entra:
`admin` y `maestro` resuelven ambos a `global` y ven lo mismo; meter el rol partiría la
entrada sin ganar seguridad.

### El orden de las operaciones (R69) — no negociable

```
1. resolveActorFromSession()            ← identidad
2. resolverAlcance(actor, METRICA…)     ← autorización  ⟵ SIEMPRE, en cada petición
3. lista blanca global|zona             ← autorización
4. claveDeTablero(alcance, fechaCR)     ← recién ahora existe una clave
5. cache.envolver(clave, producir)      ← optimización
```

La caché vive **por debajo** de la autorización y nunca por encima. Un actor denegado
(R2/R3/R7/R9) sale en el paso 2 o 3 y no llega a mirar la caché, exista o no una entrada
caliente. Dicho de otra forma: **la clave se deriva del resultado de autorizar**, así que
no hay forma de construir una clave sin haber autorizado antes.

### El puerto y los adaptadores

```ts
// lib/interfaces/external/ITableroDiaCache.ts
export interface ITableroDiaCache {
  envolver<T>(clave: string, producir: () => Promise<T>): Promise<T>;
}
```

- Producción: `lib/cache/next-tablero-dia-cache.ts`, dos líneas sobre
  `unstable_cache(producir, [clave], { revalidate: TTL })`. **Único** archivo de la feature
  que importa `next/cache`, con guardia (§8): `unstable_cache` lanza `Invariant:
  incrementalCache missing` fuera de un request de Next, así que un import mal colocado
  tumbaría la suite unitaria del servicio — la lección ya pagada por la 128
  (`lib/cache/next-analitica-cache.ts:1-20`).
- Tests y cualquier ejecución sin runtime de Next: caché nula (pasa por `producir`) y una
  caché **en memoria con reloj inyectado** para ejercitar acierto y expiración sin dormir
  el test (R72).
- TTL en `lib/config/tablero-dia-cache.ts` (≈15 s, la mitad del refresco de 30 s: colapsa
  las peticiones simultáneas de N usuarios en una sola producción).

**Sin `invalidar`, a propósito** (R71). El puerto **no tiene** operación de invalidación:
lo que no existe no se puede colgar de una escritura de órdenes. Expiración por tiempo y
nada más — es lo que hace el comportamiento auditable y el test determinista. Si algún día
esto se ve tentado de invalidación por evento, la señal correcta no es añadirla: es que el
índice era la respuesta y hay que reabrir §5.ter.

### Qué se cachea y qué no (R73)

| | ¿Cachea? | Por qué |
| --- | --- | --- |
| Conteos del tablero | **Sí** | Es lo que se pide cada 30 s por usuario y lo que dispara el escaneo del camino 2. |
| Detalle de un mensajero | **No** | Se pide por clic, no en bucle; y su consulta va por índice (`mensajero_asignado_id`), así que no hay escaneo que amortiguar. Cachearlo multiplicaría las claves —una por mensajero **y** por alcance— y con ellas la superficie del riesgo de R67, a cambio de nada. |

### La antigüedad del dato (R34)

`TableroDia.generadoAt` se estampa **dentro** de `producir`, es decir en el momento en que
los conteos se leen de la base, y viaja **dentro** del valor cacheado. Al servirse un
acierto de caché, `generadoAt` es el de la producción original, no el de la petición.

Esto importa más de lo que parece: con caché de 15 s sobre un refresco de 30 s, **el peor
caso que ve el usuario es ~45 s de retraso**. Si `generadoAt` se estampara al responder, la
pantalla anunciaría "actualizado hace 0 s" sobre un dato de 45 s — y esa mentira es
precisamente la que hace que un operador tome una decisión con un número viejo creyéndolo
fresco. El componente muestra la antigüedad calculada contra `generadoAt` (R34).

## 5.bis La consulta del detalle (R47–R51, R55, R56)

Segundo método del repositorio, **bajo demanda** (no se ejecuta al cargar el tablero,
R56): `listarOrdenesDelDia(ventana, filtroAlcance, mensajeroId, pagina)`.

```sql
SELECT o.id, o.num_guia, s.value AS estatus, o.asignado_at,
       o.nombre_cliente, o.direccion, r.resultado AS resultado_del_dia
FROM orden o
JOIN order_status s ON s.id = o.estatus_id
LEFT JOIN LATERAL (
  SELECT g.resultado FROM gestion_orden g
  WHERE g.orden_id = o.id AND g.anulada_at IS NULL
    AND g.created_at >= $desde AND g.created_at < $hasta
  ORDER BY g.created_at DESC, g.id DESC LIMIT 1
) r ON TRUE
WHERE o.mensajero_asignado_id = $mensajeroId
  AND o.id IN (SELECT id FROM ids_del_dia)   -- MISMOS dos caminos que el tablero (R57/R58)
  AND o.zona_id = $zonaId          -- SOLO cuando el alcance es zona (R41)
ORDER BY o.asignado_at DESC, o.id
LIMIT $limit OFFSET $offset;
```

- El `LATERAL … LIMIT 1` es la versión por-orden del `DISTINCT ON` del tablero: **la misma
  definición de "resultado del día"**, para que el detalle no pueda contradecir a la
  tarjeta (R51). Se documenta en el código que las dos consultas comparten definición y
  que tocar una obliga a tocar la otra; el test de R51 las compara sobre el mismo dataset.
- **Los CTE `ids_reparto`/`ids_recoleccion`/`ids_del_dia` del §5 se reutilizan aquí
  literalmente** (mismo fragmento `Prisma.sql` compartido, declarado una sola vez). Si el
  detalle usara sólo `asignado_at`, un mensajero con recolecciones vería una tarjeta que
  dice 8 y un detalle con 5 — y el test de R51 lo pondría rojo, que es justo su función.
- El campo exacto de cliente/dirección se toma **del listado de órdenes existente** para no
  inventar un formato nuevo (ver §7.3); el implementer confirma los nombres reales de
  columna contra `ordenes-columns.tsx` antes de escribirlo.
- Paginación con `LIMIT/OFFSET` como el listado (R55). Nunca `findMany` sin límite.

## 6. Contratos de E/S

```ts
// lib/types/tablero-dia.ts (tipos de dominio + schema zod de salida si aplica)
export type BucketSinResultado = "sinRecoger" | "enReparto" | "otros";

export interface FilaTableroDia {
  readonly mensajeroId: string;
  readonly mensajeroNombre: string;   // "Juan Pérez" (nombre + primer apellido)
  readonly asignadas: number;
  readonly entregadas: number;
  readonly reprogramadas: number;
  readonly devueltas: number;
  readonly rechazadas: number;
  readonly incidentes: number;
  readonly sinRecoger: number;        // R21/R43
  readonly enReparto: number;         // R21/R43
  readonly otros: number;             // R45
}

export interface TableroDia {
  readonly fecha: string;             // "YYYY-MM-DD" calendario CR (R34)
  /**
   * R34 — instante en que los conteos se LEYERON de la base. Se estampa dentro de
   * `producir`, viaja dentro del valor cacheado y NO se re-estampa al servir un acierto
   * de caché: si dijera la hora de la respuesta, la pantalla anunciaría como fresco un
   * dato de hasta ~45 s (§5.quater).
   */
  readonly generadoAt: string;        // ISO-8601 UTC
  readonly alcance: "global" | "zona";
  readonly filas: readonly FilaTableroDia[];
  readonly totales: Omit<FilaTableroDia, "mensajeroId" | "mensajeroNombre">;
}
```

```ts
export interface OrdenDetalleDia {
  readonly ordenId: string;
  readonly numGuia: string | null;
  readonly estatus: string;                       // value crudo; la etiqueta la pone la UI
  readonly resultadoDelDia: GestionResultado | null;
  readonly cliente: string;
  readonly destino: string;
  readonly asignadoAt: string;                    // ISO
}

export interface DetalleMensajeroDia {
  readonly mensajeroId: string;
  readonly fecha: string;
  readonly ordenes: readonly OrdenDetalleDia[];
  readonly total: number;                         // para cuadrar con `asignadas` (R51)
  readonly pagina: number;
  readonly pageSize: number;
}
```

Server Actions (§3.4):
- `leerTableroDia(): Promise<ResultadoTableroDia>` — **sin parámetros**: el actor sale de
  la cookie de sesión y el día del reloj del servidor. No acepta ni un `zonaId` ni una
  fecha del cliente, y eso es deliberado: un parámetro de zona sería una segunda puerta al
  recorte multi-tenant.
- `leerDetalleMensajeroDia(input): Promise<ResultadoDetalleDia>` — **sí** tiene entrada
  externa (`{ mensajeroId: string; pagina?: number }`) y por tanto **sí** se valida con
  zod en el borde (uuid + entero positivo acotado), `docs/architecture.md` § "Borde
  tipado". El día y la zona los sigue poniendo el servidor.

`totales` los calcula el **servicio** sumando las filas (función pura, testeable sin DB),
no la base: así los totales son por construcción la suma de lo que se pinta (R30).

---

## 7. Frontend

### 7.1 Ruta y datos

- `app/(app)/monitoreo/page.tsx` — Server Component. Resuelve el actor con
  `resolveActorFromSession()`, y si el rol no está en `{admin, maestro, adminSatelite}`
  llama a `notFound()` (R11). No fetchea datos.
- `_components/TableroDiaModule.tsx` — Client Component:
  ```ts
  const { data, error } = useSWR("tablero-dia", leerTableroDia, {
    refreshInterval: 30_000,          // R31, decisión humana
    keepPreviousData: true,           // R32
  });
  ```
  Patrón dominante del repo para lectura + refresco (`IncidentesAdminModule.tsx:203-206`,
  y lo que `app/(app)/analitica/page.tsx:41-49` documenta como la puerta correcta:
  Server Action + SWR, no `fetch` a una ruta API interna).

### 7.2 Tarjetas, no filas de tabla (R28–R30, decisión humana del 2026-08-08)

- `MensajeroCard.tsx` sobre la primitiva `components/ui/card` (shadcn; **no** se crea
  primitiva nueva). Cabecera: nombre + `asignadas`. Cuerpo: los siete contadores
  restantes como chips etiquetados, con `sinRecoger` y `enReparto` **visualmente
  separados** de los cinco resultados — son "todavía no terminó", no un desenlace.
- La tarjeta entera es el control clicable: `<button>` envolviendo el contenido (o `Card`
  con `role="button"` + `tabIndex`), **accesible por teclado**. Un `onClick` sobre un
  `div` no es un botón.
- Rejilla responsive; el **orden de la rejilla es el de R29** y no depende del ancho.
- Bloque de totales (R30) arriba, con el mismo desglose, para leer el día de un vistazo.
- Estados: skeleton de carga, vacío explícito (R33), aviso de fallo de refresco que
  **conserva** las tarjetas anteriores (R32), fecha CR + "actualizado hace N s" (R34).

### 7.3 Detalle: panel, y qué se reutiliza de verdad del listado de órdenes

**Decisión humana confirmada el 2026-08-08: panel lateral (`components/ui/sheet`) con la
selección reflejada en la URL** (`/monitoreo?mensajero=<id>`), leída con `useSearchParams`,
elegido por ser enlazable y compartible (R50). Frente a la ruta propia descartada
(`/monitoreo/<mensajeroId>`):

- Se conserva el estado del tablero: los datos ya cargados y el ciclo de SWR no se
  desmontan al abrir el detalle (R50), y al cerrar no hay recarga.
- El enlace **sigue siendo compartible** —que era el argumento a favor de la ruta—, porque
  el estado vive en el query param, no en un `useState`.
- No duplica una pantalla de listado ni obliga a un segundo gate de rol en otra página.

**Y el param no es una autorización** (R62/R63): un enlace compartido puede abrirse con
otra sesión. El panel pide el detalle a la Server Action **siempre**, y los tres casos
malos —id inexistente, mensajero de otra zona, mensajero sin órdenes hoy— producen la
**misma** respuesta vacía y el **mismo** aviso genérico. Distinguirlos ("ese mensajero no
es de tu zona") confirmaría la existencia de un usuario ajeno, que es la fuga que R41–R42
persiguen.

Lo que se **reutiliza** del listado de órdenes (verificado, no supuesto):

| Pieza | Reutilizable | Nota |
| --- | --- | --- |
| `_components/EstatusBadge.tsx` | **Sí** | Componente autónomo (`value: string` + `zonaNombre?`), degrada a chip neutro con value crudo si el catálogo se mueve. Cubre R48 tal cual. |
| `_components/estatus-label.ts` (`estatusLabel`) | **Sí** | Envuelve `ORDER_STATUS_LABELS` con fallback `—`. Útil para textos fuera del chip. |
| `ORDER_STATUS_LABELS` | **Sí** (vía las dos anteriores) | No se copia el mapa: se importa. |
| `_components/OrdenesListado.tsx` | **No** | Es un contenedor de 11 props de negocio (acciones por lote, carga masiva, escáner QR, catálogos de filtros, historial…) acoplado a `/ordenes`. Montarlo aquí arrastraría acciones que el tablero no debe ofrecer y filtros que no aplican. |
| `_components/ordenes-columns.tsx` + `OrdenesModule` | **No, pero sí como molde** | El detalle es una lista de 6 campos sin selección, sin acciones y sin filtros; se copia el **layout** (columnas, tipografía, paginación) usando las mismas primitivas `ui/table`, no el módulo. |

Es decir: se reutiliza el **vocabulario visual del estatus** (que es donde una segunda
declaración haría daño de verdad, R48) y no el **contenedor** (que traería acoplamiento).
Si el implementer descubre que alguna de estas piezas sí se puede extraer limpiamente,
que lo haga en su propio commit y lo diga; no es requisito.

### 7.4 Menú "Monitoreo" (R53, R54)

Ítem nuevo en `lib/auth/menu-visibility.ts`:

```ts
{ label: "Monitoreo", href: "/monitoreo", iconKey: "gauge",
  roles: ["admin", "maestro", "adminSatelite"], destinoInicial: false }
```

- `iconKey` **propio** añadido a la unión `IconKey` (criterio ya escrito en
  `menu-visibility.ts:26-40`: compartir icono invita a leer la sección como parte de
  otra) y mapeado en el `Sidebar` cliente.
- **`destinoInicial: false` no es decorativo** (R35/R54). El aterrizaje post-login se
  deriva del PRIMER ítem visible del menú (`app/(app)/dashboard/page.tsx:34`,
  `primerDestino`). Hoy el `adminSatelite` no ve "Inicio" (`roles: ["maestro","admin"]`)
  ni "Órdenes", así que su primer ítem elegible es `/recepcion-satelite`; si "Monitoreo"
  se coloca por delante **sin** la marca, ese rol pasaría a aterrizar aquí en silencio —
  exactamente el incidente que documenta `menu-visibility.ts:63-82` con "Analítica".
- Posición sugerida: junto a "Analítica" (ambos son tableros de lectura). Con la marca
  puesta, la posición ya no puede mover el aterrizaje de nadie, y R54 lo fija con un test
  que compara `primerDestino` **rol por rol** antes y después.

---

## 8. Trazabilidad requisito → test

| Req | Test (nombre de archivo previsto) |
| --- | --- |
| R1, R3 | `tests/unit/services/tablero-dia-alcance.test.ts` (tabla por rol) |
| R2 | `tests/unit/actions/tablero-dia-accion.test.ts` (sin sesión → denegado) |
| R4, R5 | `tests/unit/services/tablero-dia-alcance.test.ts` |
| R6 | `tests/integration/tablero-dia-aislamiento.test.ts` (mensajero de zona A con orden de zona B) |
| R7 | `tests/unit/services/tablero-dia-alcance.test.ts` (satélite sin zona → denegado) |
| R8, R17, R36, R38 | `tests/unit/tablero-dia/frontera.guardia.test.ts` (censo del árbol de la feature) |
| R9 | `tests/unit/services/tablero-dia-alcance.test.ts` (alcance tienda/mensajero → denegado) |
| R10 | `tests/unit/repositories/tablero-dia-sql.test.ts` (el `WHERE` lleva el `zona_id`) |
| R11 | `tests/components/TableroDiaPage.test.tsx` (rol no autorizado → `notFound`) |
| R12–R16 | `tests/unit/utils/ventana-dia-cr.test.ts` (reloj congelado en 5 instantes frontera) |
| R18–R23, R25 | `tests/integration/tablero-dia-conteo.test.ts` (con DB: reintentos, anuladas, fuera de ventana) |
| R24, R27 | `tests/unit/tablero-dia/resultados-exhaustivos.test.ts` (los 5 del enum, `satisfies Record<GestionResultado, …>`) |
| R26 | `tests/integration/tablero-dia-conteo.test.ts` (gestión registrada por otro usuario) |
| R28, R29, R30 | `tests/unit/services/tablero-dia-filas.test.ts` + `tests/components/TableroDiaTarjetas.test.tsx` |
| R31, R32, R33 | `tests/components/TableroDiaModule.test.tsx` (R34 se reescribió: ver su fila al final) |
| R35 | `tests/unit/auth/menu-visibility.test.ts` (roles del ítem + `destinoInicial:false`) |
| R37, R39 | `tests/unit/repositories/tablero-dia-sql.test.ts` |
| **R40** | `tests/unit/services/tablero-dia-detalle-alcance.test.ts` (el detalle vuelve a llamar a `resolverAlcance`) |
| **R41** | `tests/integration/tablero-dia-detalle-aislamiento.test.ts` (satélite pide un mensajero con órdenes de otra zona → sólo las suyas) |
| **R42** | `tests/unit/actions/tablero-dia-detalle-accion.test.ts` (uuid inválido / mensajero fuera de alcance → vacío o denegado, sin filtrar existencia) |
| **R43, R45** | `tests/unit/tablero-dia/buckets-estatus.test.ts` (tabla estatus → bucket, incluidos los 16 que caen en `otros`) |
| **R44** | `tests/unit/tablero-dia/buckets-estatus.test.ts` (`por_recolectar_en_tienda` → `otros`) |
| **R46** | `tests/unit/tablero-dia/buckets-estatus.guardia.test.ts` (todo value de `ORDER_STATUS_SEED` tiene bucket; un value nuevo lo pone rojo) |
| **R21, R25** | `tests/integration/tablero-dia-conteo.test.ts` (identidad de ocho sumandos en cada escenario) |
| **R47, R50, R52** | `tests/components/DetalleMensajeroPanel.test.tsx` (abre por click y por teclado, la URL lleva `?mensajero=`, cerrar no recarga el tablero) |
| **R48, R49** | `tests/components/DetalleMensajeroPanel.test.tsx` (usa `EstatusBadge`; censo: no hay un segundo mapa de labels en la feature) |
| **R51** | `tests/integration/tablero-dia-detalle-cuadre.test.ts` (`total` del detalle == `asignadas` de la tarjeta, mismo dataset) |
| **R53, R54** | `tests/unit/auth/menu-visibility.test.ts` (ítem "Monitoreo" + `primerDestino` **rol por rol** sin cambios) |
| **R55, R56** | `tests/unit/repositories/tablero-dia-detalle-sql.test.ts` (LIMIT/OFFSET presentes) + `tests/components/TableroDiaModule.test.tsx` (no se llama al detalle sin click) |
| **R57** | `tests/integration/tablero-dia-recoleccion.test.ts` (orden con `asignado_at` NULL + fila `asignacion_recoleccion` de hoy → cuenta; la de ayer → no) |
| **R58** | `tests/integration/tablero-dia-recoleccion.test.ts` (orden alcanzable por los DOS caminos aporta 1; identidad de R25 intacta) |
| **R59** | `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` (censo del árbol: ningún archivo de la feature escribe `asignadoAt`/`asignado_at`; ninguna migración nueva la toca) |
| **R60** | `tests/integration/tablero-dia-recoleccion.test.ts` (el actor del historial ≠ mensajero asignado → cuenta para el mensajero) |
| **R61** | `tests/integration/tablero-dia-recoleccion.test.ts` (recolección en `recolectando` → `sinRecoger`; recolección ya gestionada → su resultado) |
| **R62, R63** | `tests/components/DetalleMensajeroPanel.test.tsx` + `tests/unit/actions/tablero-dia-detalle-accion.test.ts` (los tres casos —inexistente, fuera de alcance, sin órdenes— dan la MISMA respuesta) |
| **R64, R65** | `tests/unit/repositories/tablero-dia-sql.test.ts` (una sola llamada a `$queryRaw`; el predicado del historial lleva `origen_tipo` **y** el rango de `created_at`) |
| **R66, R72** | `tests/unit/services/tablero-dia-cache.test.ts` (con caché en memoria y reloj inyectado: 2.ª petición dentro del TTL no vuelve a llamar al repositorio; pasado el TTL sí) |
| **R67** | `tests/unit/services/tablero-dia-cache-aislamiento.guardia.test.ts` — **el test de seguridad**: un `maestro` (global) y un `adminSatelite` (zona X), uno tras otro dentro de la ventana, reciben **conjuntos de filas distintos**; y un satélite de zona X y otro de zona Y tampoco comparten. Se comprueba el CONTENIDO devuelto, no sólo el número de llamadas |
| **R68** | `tests/unit/services/tablero-dia-cache.test.ts` (dos usuarios distintos con el mismo alcance → una sola producción; la clave no contiene el `usuarioId` ni el rol) |
| **R69** | `tests/unit/services/tablero-dia-cache-aislamiento.guardia.test.ts` (con entrada caliente de alcance global, un `adminTienda` y un satélite sin zona reciben **denegado**, y la caché no se consulta) |
| **R70** | `tests/unit/services/tablero-dia-cache.test.ts` (reloj cruzando medianoche CR → clave distinta, no se sirve el día anterior) |
| **R71** | `tests/unit/tablero-dia/cache-sin-invalidacion.guardia.test.ts` (censo: el puerto no declara `invalidar`; la feature no importa `revalidateTag`/`revalidatePath` ni se engancha a escrituras) |
| **R73** | `tests/unit/services/tablero-dia-detalle-alcance.test.ts` (el detalle llama al repositorio **siempre**, sin caché de por medio) |
| **R34** | `tests/components/TableroDiaModule.test.tsx` (la antigüedad se calcula contra `generadoAt`) + `tests/unit/services/tablero-dia-cache.test.ts` (un acierto de caché conserva el `generadoAt` original) |

---

## 9. Alternativas descartadas

1. **Contar GESTIONES en vez del resultado final de la orden (rama A).**
   Descartada por decisión humana del 2026-08-08. `GestionOrden` no tiene
   `@@unique(ordenId)`: una orden reintentada acumula varias gestiones, así que
   `entregadas + reprogramadas + … ` puede superar a `asignadas` y la pantalla mostraría
   números que no cuadran. La rama B garantiza la identidad de R25.

2. **Supabase Realtime (`postgres_changes`) en vez de polling.**
   Descartada a propósito (status_note). Realtime entrega eventos de **fila** y esto es
   una **agregación**: habría que re-agregar en cada evento, es decir polling con pasos
   extra. Además la app no usa Supabase Auth (sesión propia por cookie,
   `lib/auth/resolve-actor.ts:16`), no hay ni una policy en `db/migrations/` y
   `createBrowserSupabaseClient` no lo importa nadie hoy. **Puerta abierta si 30 s se
   queda corto:** Broadcast desde el servidor como aviso que invalida el SWR, nunca
   `postgres_changes`.

3. **Reutilizar `lib/analytics/rollup-dia.ts` / `analytics_daily` y su caché.**
   Descartada: es el rollup de **cierre** de día (fecha objetivo D−1, corte estricto), y
   el tablero es el día **en curso** sobre tablas vivas. Reutilizarlo daría una pantalla
   que sólo dice la verdad al día siguiente.

4. **Traer las órdenes del día y agrupar en JavaScript.**
   Descartada por la ficha 191, que es justamente la deuda de materializar conjuntos
   enteros. Con 2.000 órdenes/día se transportan 2.000 filas para pintar 15; y el filtro
   multi-tenant acabaría aplicándose en memoria, que es una capa más de la que fiarse
   (R10).

5. **Añadir una métrica nueva al catálogo `lib/analytics/metrics.ts`.**
   Descartada: el catálogo es de 25 métricas fijadas por decisión humana **fechada**
   (`metrics.ts:1-9`) y hay guardias que cuentan sus etiquetas; añadir una entrada para
   obtener un `metricaId` rompería tests ajenos y metería este tablero en un contrato que
   no es el suyo (fuente `rollup`). Se consume un id existente (§3.2).

6. **Route Handler `GET /api/tablero-dia` + `fetch` desde el cliente.**
   Descartada: el patrón del repo para lectura con refresco es Server Action + SWR
   (`app/(app)/analitica/page.tsx:41-49`, `IncidentesAdminModule.tsx:203-206`), y una
   ruta API añade una superficie pública nueva que hay que autenticar por su cuenta.
   Los route handlers se reservan aquí para webhooks, crons y API para terceros
   (`docs/architecture.md`).

7. **Reimplementar el recorte por zona con un `where` propio "porque son dos líneas".**
   Descartada: sería la segunda tabla de alcance del repo y podría divergir de
   `alcance.ts` sin que nada se pusiera rojo. Peor: la tentación natural es filtrar por
   la zona **del mensajero** (que es la que se tiene a mano al agrupar por mensajero), y
   eso es exactamente el error que `alcance.ts:197-198` prohíbe — la zona de la orden
   está congelada y puede diferir de la del mensajero que la gestionó.

8. **Filtrar el alcance en el componente (esconder filas de otras zonas al pintar).**
   Descartada por principio: un panel que no se pinta no es un dato que no se filtra. El
   recorte va en el `WHERE` (R10).

### Añadidas en la revisión del 2026-08-08

9. **Derivar "sin recoger" del resultado de la gestión en vez del estatus de la orden.**
   Imposible, no sólo indeseable: una orden que nadie ha tocado **no tiene** gestión, así
   que `gestion_resultado` no puede distinguir "no arrancó" de "está en la calle". De ahí
   el segundo eje (§1.bis). El coste asumido es acoplarse a un segundo catálogo que se
   mueve, y por eso R46 exige que se mueva **en rojo**.

10. ~~**Ampliar el criterio de "asignada hoy" para pescar las recolecciones en tienda.**~~
    **Ya no está descartada: es la decisión vigente (opción C, §1.ter).** Se conserva la
    entrada para que se lea la evolución: la duda subió a la puerta humana en vez de
    resolverse por defecto, y el humano eligió ampliar el criterio **por el historial**,
    no por `asignado_at`.

11. **Reutilizar `OrdenesListado` para el detalle** ("como en el listado de órdenes",
    tomado al pie de la letra). Descartada tras leerlo: es un contenedor con 11 props de
    negocio (acciones por lote, carga masiva, escáner QR, recepción en bodega central,
    catálogos de filtros, historial…) atado a `/ordenes`. Traería acciones que el tablero
    no debe ofrecer y un árbol de modales que no aplica. Lo que **sí** se reutiliza es el
    vocabulario visual del estatus (`EstatusBadge`, `estatusLabel`, `ORDER_STATUS_LABELS`),
    que es donde una segunda declaración haría daño de verdad (§7.3, R48).

12. **Ruta propia `/monitoreo/<mensajeroId>` para el detalle.** Descartada frente al panel
    con `?mensajero=<id>`: la ruta desmonta el tablero (se pierde el ciclo de SWR y los
    datos ya cargados, R50) y obliga a un segundo gate de rol en otra página, a cambio de
    un enlace compartible que el query param ya da. **Confirmada por el humano el
    2026-08-08**: el panel es la decisión vigente (R50).

13. **Contar los buckets del segundo eje en JavaScript** a partir de las filas del
    detalle. Descartada por lo mismo que la alternativa 4: obligaría a materializar todas
    las órdenes del día para pintar unos contadores. Los `FILTER` del §5 los resuelven en
    Postgres sin traer una sola orden.

### Añadidas en la tercera vuelta (2026-08-08)

14. **Opción B: estampar `asignado_at` al asignar una recolección** (y así unificar el
    criterio en una sola columna). **Descartada por el humano**, y es la decisión más
    cara de este spec: `asignado_at` es el denominador del ranking diario del mensajero
    (feature 76/R38; la omisión está razonada en `OrdenRepository.ts:1820-1823`: "el
    numerador sólo cuenta entregas, así que estamparlo bajaría el porcentaje"). Una
    recolección no es una entrega, así que estamparla **bajaría el porcentaje del
    mensajero sin darle forma de subirlo** — es decir, tocaría su pago y su premio para
    arreglar una pantalla de lectura. R59 lo convierte en requisito y un guardia lo
    atornilla.

15. **Opción A: aceptar que el tablero no vea las recolecciones en tienda.**
    Descartada por el humano: el pedido original decía "incluyendo sin recoger", y un
    mensajero que va camino de una tienda está trabajando; no verlo es exactamente el
    agujero que la pantalla venía a tapar.

16. **Resolver el segundo camino con una consulta aparte y unir en JavaScript.**
    Descartada (R64): serían dos viajes por refresco y obligaría a materializar los ids
    del día en memoria para deduplicarlos —justo la deuda de la ficha 191—, además de
    abrir la puerta a que la deduplicación se haga mal. El `UNION` de Postgres lo resuelve
    dentro de la misma consulta agregada.

17. **Deduplicar los dos caminos con `UNION ALL` + `DISTINCT` posterior**, o con un
    `LEFT JOIN` al historial. Descartada: el `LEFT JOIN` **multiplica filas** cuando una
    orden tiene varias transiciones de recolección el mismo día (una reasignación de
    recolección las genera), y ahí `asignadas` empieza a contar transiciones en vez de
    órdenes — el mismo error de fondo que la rama A que el humano descartó en la primera
    puerta. `UNION` de conjuntos de ids no tiene esa forma de fallar.

### Añadidas en la cuarta vuelta (2026-08-08) — la caché

18. **Reutilizar el puerto `IAnaliticaCache`** (`lib/interfaces/external/IAnaliticaCache.ts`)
    y su adaptador. Descartada: arrastra `tags` + `invalidar(origen, tags)` +
    `OrigenInvalidacion`, es decir toda la maquinaria de invalidación por evento que R71
    **prohíbe**, y metería las entradas del tablero en el espacio de tags de la analítica,
    que es justo lo que R38 separa. Se declara un puerto propio de **un solo método**. Lo
    que sí se reutiliza es `claveDeAlcance` (§5.quater): la codificación del alcance no se
    escribe dos veces.

19. **Clavear la caché por `usuarioId`** ("más seguro por definición"). Descartada y es
    falso que sea más seguro: con N usuarios habría N escaneos y la caché no cumpliría su
    único propósito, que es acotar la frecuencia del recorrido secuencial. La seguridad la
    da el **alcance** en la clave (R67), no el usuario; dos satélites de la misma zona ven
    exactamente las mismas filas.

20. **Clavear por rol.** Descartada: `admin` y `maestro` resuelven ambos a alcance
    `global` y ven lo mismo, así que el rol partiría la entrada sin añadir aislamiento —
    y sugeriría, falsamente, que el rol es la frontera. La frontera es el alcance resuelto.

21. **Invalidación por evento** (colgar un `revalidateTag` de la escritura de gestiones u
    órdenes para que el tablero se vea "instantáneo"). Descartada por decisión humana
    explícita (R71): haría el comportamiento no auditable y los tests no deterministas, y
    acoplaría rutas de escritura calientes a una pantalla de lectura. El puerto **no tiene**
    método de invalidación, así que no hay dónde engancharla.

22. **Cachear también el detalle.** Descartada (R73): se abre por clic, no en bucle, y su
    consulta va por índice; no hay escaneo que amortiguar. A cambio multiplicaría las
    claves —una por mensajero **y** por alcance— y con ellas la superficie del riesgo de
    R67, que es el riesgo caro de esta feature.

23. **Estampar `generadoAt` al responder** en vez de al producir. Descartada: con caché de
    15 s sobre refresco de 30 s el usuario vería "actualizado hace 0 s" sobre un dato de
    hasta 45 s. Una pantalla que miente sobre su propia frescura es peor que una pantalla
    lenta: la lenta se nota, la que miente no (R34).
