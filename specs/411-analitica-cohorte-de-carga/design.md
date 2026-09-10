# Ficha 411 — Diseño

> El CÓMO. Los requisitos viven en `requirements.md`; el desglose, en `tasks.md`.
> Todo símbolo citado aquí fue **leído en el archivo real**, no en el índice del MCP.
> Zona **`fullstack`**: backend primero, frontend después.

---

## 0 — ⚠ EL ERROR QUE ESTA FICHA EXISTE PARA NO COMETER

**Léelo antes que nada. Es el primer párrafo a propósito.**

En este repo ya hay una consulta casi idéntica a la de esta ficha: `CicloVidaRepository`, que mide
de `orden.created_at` a la última transición terminal. Copiarla es lo natural, y **su ventana está
en el sitio contrario**:

| | dónde cae la ventana | qué pregunta contesta |
| --- | --- | --- |
| `CicloVidaRepository` (existe) | sobre la **transición terminal** (`condicionDeVentanaTerminal`) | «de lo que CERRÓ esta semana, cuánto tardó» |
| **Esta ficha** | sobre **`orden.created_at`** | «de lo que se CARGÓ esta semana, qué pasó con ello» |

Aquel archivo lo deja escrito: *«la VENTANA cae sobre la transición TERMINAL, no sobre la creación
de la orden. Una orden creada en enero y cerrada en agosto cuenta en agosto»*. Una cohorte es
exactamente lo contrario: esa orden cuenta en **enero**, que es cuando entró el lote.

**Por qué esto es peligroso y no sólo incorrecto:** poner la ventana sobre el cierre **no rompe
nada visible**. No hay excepción, no hay fila de más, no hay tipo que no compile. La tabla sale con
días plausibles, cohortes plausibles y porcentajes plausibles — **y equivocados**: estaría
contestando «qué cerró esta semana» con el rótulo «qué se cargó esta semana», y sólo cuadraría en
los lotes que cierran el mismo día. Nadie lo va a ver mirando la pantalla.

Lo mismo, un piso más abajo: **`startOfDayCR` como cota contra `orden.created_at`** desplaza el día
seis horas (ventana real 18:00–18:00 CR). Tampoco se ve a ojo: los conteos siguen siendo enteros
razonables, sólo que unos cuantos están en la cohorte de al lado.

Las dos trampas tienen su caso dedicado (`tasks.md` T4.4 y T4.1) y **los dos exigen VER el rojo**:
correr el test con la condición mala puesta, mirar el fallo y pegar la salida en la bitácora. No
basta con afirmar que se comprobó — un test que también pasaría con el código malo no prueba nada.

---

## 0.1 — Resumen de las decisiones, para leer en treinta segundos

| Decisión | Qué se eligió | Por qué |
| --- | --- | --- |
| Ancla de la cohorte | día calendario CR de `orden.created_at` | «de las que cargué el lunes»; un día puede tener varias cargas (P4) |
| Ventana | **sobre la carga, nunca sobre el cierre** | §0 |
| Cotas | `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, vía `resolverRango` | `created_at` es `timestamp`: `startOfDayCR` desplaza el día 6 h |
| Día CR en SQL | el desfase DERIVADO que ya existe (`DIA_CR`), como parámetro | en este SQL no entra ninguna zona horaria |
| Desenlaces | la lista terminal que YA existe + cubo `viva` | una sola lista de terminales en el producto (P1) |
| `devuelta` | **sigue viva** | «devolución anclada» ≠ lote cerrado (§3.1) |
| Cierre de una orden | ÚLTIMA transición terminal (`DISTINCT ON … DESC, id DESC`) | criterio idéntico al del ciclo de vida ya escrito |
| Tiempos | `segundosAcum` + `n` por cubo; el promedio lo deriva el servicio | convención de `acumularCiclosCerrados` y `CicloVidaDTO` |
| Rango | **obligatorio**; sin él no se toca la base | sin techo, la tabla deja de ser herramienta (P3) |
| Alcance | `prepararConteoEntregas` + `condicionesSinFecha` (alcance PRIMERO) | no se abre una octava puerta a la frontera multi-tenant |
| `adminSatelite` | **ve la sección**, con su alcance por zona | no se inventa una excepción de permisos (P2) |
| Faceta mensajero | NO recorta (igual que la serie de cargadas) | una orden no la carga un mensajero |
| Orden de salida | **descendente**: la cohorte más reciente primero | es lo que se viene a mirar (P6) |
| Superficie | sección propia `Detalle · Cohorte de carga` en `/analitica` | hermana de Productos, misma barra, se puede ocultar sola |
| Descarga | **no** en esta ficha | alcance mínimo (P5) |
| Migración | **ninguna** | los dos índices que hacen falta ya existen |
| Gate | **COMPLETO** (`./init.sh`) | no por migración: por `lib/types/**` (§9.2) |

---

## 1 — Modelo de datos

### 1.1 Tablas: ninguna nueva, ninguna alterada

La cohorte se lee de tres tablas que ya existen:

- `orden` — `created_at` (`timestamp`), `deleted_at`, `zona_id`, `tienda_id`, `provincia_id`,
  `canton_id`, `distrito_id`.
- `orden_historial_estado` — `orden_id`, `estatus_destino_id`, `created_at` (append-only,
  fila inmutable).
- `order_status` — catálogo, para traducir `estatus_destino_id` → `value`.

**No hay migración, no hay columna generada, no hay tabla de rollup.** Y por tanto tampoco hay RLS
nueva que declarar: las tres ya tienen RLS habilitada sin policies (patrón del repo: Prisma se
conecta con credenciales de servicio), así que **la frontera multi-tenant real es el `WHERE`** — §4.

### 1.2 Índices: los dos que hacen falta ya están

| Consulta | Índice | Dónde está declarado |
| --- | --- | --- |
| ventana de carga sobre `orden.created_at` | `@@index([createdAt])` | `db/schema.prisma:787` |
| última transición terminal POR ORDEN | `@@index([ordenId, createdAt])` | `db/schema.prisma:2222` |

El segundo es exactamente la forma del `DISTINCT ON (orden_id) … ORDER BY orden_id, created_at DESC`
— la misma razón por la que la 126 no pidió índice para esa tabla.

⚠ **Esto se MIDE, no se supone** (T6.1): un `EXPLAIN` con `enable_seqscan = off` sobre la consulta
REAL, con su caso discriminante. **Si el plan pide un índice nuevo, R37 obliga a migración con
`down.sql`** — y el gate ya era el completo por otra razón (§9.2), así que el coste marginal es el
`down.sql` y su test.

### 1.3 Columna generada `fecha_cr date`: descartada (§8, A3)

---

## 2 — La consulta

Un solo `$queryRaw` por lectura (R38). Cliente Prisma MÍNIMO: `Pick<PrismaClient, "$queryRaw">` —
`$queryRawUnsafe` no está y no puede estar, que es el patrón de los cuatro repositorios vecinos.

```sql
WITH cohorte AS (
  SELECT o."id"         AS orden_id,
         o."created_at" AS cargada_at,
         <DIA_CR>       AS dia          -- to_char((created_at - $desfase * interval '1 second')::date, 'YYYY-MM-DD')
  FROM "orden" o
  WHERE <condicionesSinFecha(consulta)>          -- alcance PRIMERO, soft delete, 5 facetas
    AND o."created_at" >= $desde                 -- SIEMPRE: el rango es obligatorio (R5)
    AND o."created_at" <  $hasta
),
cierre AS (
  SELECT DISTINCT ON (h."orden_id")
         h."orden_id"   AS orden_id,
         h."created_at" AS cerrado_at,
         s."value"      AS desenlace
  FROM "orden_historial_estado" h
  JOIN "cohorte" c      ON c.orden_id = h."orden_id"
  JOIN "order_status" s ON s."id" = h."estatus_destino_id"
  WHERE s."value" IN ($terminales)
  ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC
)
SELECT c.dia                                   AS dia,
       COALESCE(x.desenlace, 'viva')           AS desenlace,
       COUNT(*)::int                           AS n,
       SUM(EXTRACT(EPOCH FROM (x.cerrado_at - c.cargada_at))::bigint)::bigint AS seg
FROM cohorte c
LEFT JOIN cierre x ON x.orden_id = c.orden_id
GROUP BY 1, 2
ORDER BY 1 DESC, 2 ASC
```

Lo que cada pieza compra, y por qué no se escribe de otra manera:

- **`cohorte` primero, y el historial JOINeado CONTRA ella.** No se deduplica el historial entero
  para tirar casi todo: el `cierre` sólo visita las órdenes ya recortadas, y por eso el
  `(orden_id, created_at)` es aplicable. Es el mismo argumento del `LEFT JOIN LATERAL` de
  `ConteoPorStatusRepository`, con la forma que aquí sirve mejor.
- **`DISTINCT ON … ORDER BY orden_id, created_at DESC, id DESC`** — la ÚLTIMA terminal (R9), no la
  primera: una orden puede entrar a terminal, deshacerse y volver a entrar. El desempate por `id` no
  es defensivo: sin él, dos filas con el mismo `created_at` harían el resultado no determinista.
- **`LEFT JOIN` + `COALESCE(…, 'viva')`** — el cubo `viva` sale del propio `LEFT`, no de una segunda
  consulta ni de una resta en memoria. Por construcción los cubos **suman** las cargadas (R11).
- **`SUM(...)` sin `COALESCE`** — para el grupo `viva` todos los sumandos son `NULL`, así que
  `SUM` devuelve `NULL`: el numerador queda **ausente y no cero** (R16) sin escribir un `CASE`.
- **`ORDER BY 1 DESC` es contrato** (R6): la cohorte más reciente primero. Como la clave es
  `YYYY-MM-DD`, el orden lexicográfico ES el cronológico. **Diverge a propósito de la serie hermana**
  (`ConteoCargadasPorDiaDTO`, ascendente): aquélla pinta un eje temporal, donde el tiempo va hacia la
  derecha; ésta es una tabla que se lee de arriba abajo y se abre para ver «cómo va lo de esta
  semana». No se homogeneízan, y el orden se decide **en un solo sitio**: aquí. La pantalla NO
  reordena — una serie con dos criterios de orden acaba pintándose distinto según quién la toque al
  final.

### 2.1 `$terminales`: la lista que YA existe, no una segunda

`TERMINALES` **ya está rendido a SQL dos veces** en el repo, y las dos veces igual:
`Prisma.join([...ESTADOS_TERMINALES])` — en `AnaliticaOperativaVivaRepository:48` y en
`CicloVidaRepository:63`. **Las dos son privadas de su módulo** (comprobado en el archivo real: no
llevan `export`).

Esta ficha **no escribe una tercera lista**: rinde la MISMA constante de dominio con la MISMA línea.
No se importa la de la 126 porque cruzar hacia ese módulo mete este repositorio en el censo que
vigila `operativa-frontera.guardia` / `operativa-fuente.guardia`, que existe para acotar quién toca
la vertical operativa — y pagar un guardia por ahorrar una línea derivada es mal negocio. Lo que
garantiza que no hay divergencia posible **no es el copiar-pegar sino el censo T2.4**: el
repositorio de esta ficha **no puede contener** los literales `"entregada"`, `"devuelta_a_tienda"`
ni `"incidente"`, y **sí** tiene que importar `ESTADOS_TERMINALES`. Un cuarto terminal entra solo en
las tres.

### 2.2 Lo que NO lleva esta consulta, y es deliberado

- **Ningún `AT TIME ZONE`, `date_trunc(..., zone)` ni `interval '6 hours'`.** Regla heredada de la
  180 y no negociable: la única definición del día CR vive en `lib/utils/fecha-cr.ts` y cruza la
  frontera **como dato**. `<DIA_CR>` es el fragmento que ya vive en `ConteoCargadasPorDiaRepository`
  (hoy privado): hay que **exportarlo**, no copiarlo.
- **Ninguna ventana sobre `cierre.created_at`** (R12). Ver §0. Es EL error de esta ficha.
- **Ningún `EXISTS` sobre `gestion_orden`** (R24): la faceta mensajero no recorta esta lectura, igual
  que no recorta la serie de cargadas. Consecuencia declarada: con un mensajero seleccionado, esta
  sección NO se recorta y las otras sí — la pantalla lo dice en vez de rechazar la consulta, que
  dejaría la sección rota en cuanto alguien toque el selector.
- **Ningún `estatus_al_corte`.** Aquí no hay desagregación por estatus, así que ese CTE —que recorre
  el historial entero de cada orden— sobra. Omitirlo es correcto, no una simplificación.

---

## 3 — Los cubos

### 3.1 Por qué una orden `devuelta` sigue VIVA — el caso que más se malinterpreta

Medido en este repo el **2026-09-10**: una orden `devuelta` volvió a bodega, **se liberó sola a las
24 h**, salió otra vez a reparto y **se devolvió de nuevo cinco días después**. Eso es lo que dice el
mapa de transiciones: `devuelta` tiene OCHO salidas declaradas
(`lib/types/order-status-transiciones.ts:330-355`) — liberación por plazo, recuperación manual,
reprogramación de la tienda, rechazo… El paquete sigue en circulación.

Consecuencias, y hay que decirlas las tres juntas:

1. `devuelta` **no** está en la lista terminal, así que esa orden cuenta en `viva` (R10). Igual
   `rechazada`, `devolucion_por_confirmar` y `sin_gestionar`.
2. Una cohorte reciente enseñará **muchas vivas y pocas devueltas**, porque el camino
   `rechazada → por_devolver → … → devuelta_a_tienda` tarda días. **Eso no es un bug: es el lote.**
3. Por eso el cubo **`Vivas` es obligatorio en pantalla** (R32). Sin él la tabla diría «12 entregadas
   de 40» y callaría que 25 siguen en la calle: mentiría por omisión, que es la única forma en que
   una tabla de conteos puede mentir.

### 3.2 Los cuatro cubos son exhaustivos y excluyentes

`entregada` · `devuelta_a_tienda` · `incidente` · `viva`. Suman exactamente las cargadas del día
(R11), y esa igualdad se prueba **contra la otra implementación** (T4.7), no contra sí misma.

---

## 4 — Alcance: se REUSA entero, no se reescribe

`prepararConteoEntregas(raw, actor, now)` (`lib/analytics/entregas-conteo.ts:365`) hace los cuatro
pasos en orden —parsear → resolver rango → resolver alcance → intersecar— y devuelve el tipo OPACO
`ConsultaConteoEntregas`. Esta ficha **no escribe ni un resolutor de alcance ni un esquema de filtro
nuevos**: sería la octava puerta a la misma frontera. Y por tanto (P2) **el `adminSatelite` ve la
sección con alcance de zona**, exactamente como en el resto de la analítica: aquí no se declara
ninguna excepción de permisos propia de esta tabla.

En el repositorio, el recorte entra por `condicionesSinFecha(consulta)`
(`ConteoCargadasPorDiaRepository:128`), que ya pone **el alcance como PRIMERA condición** y reusa
`condicionDeAlcance` de `ConteoPorStatusRepository`. Las columnas del recorte son las canónicas
(`o.zona_id`, `o.tienda_id`, `o.mensajero_asignado_id`) y aquí no se elige ninguna otra.

**Lo que hay que probar igual y contra Postgres real:** que el `WHERE` que se emite recorta de verdad
(T4.6). Los tests con dobles no ven el SQL, y en este repo una mutación del `WHERE` los pasa en
verde — medido cuatro veces.

### 4.1 El orden del borde, con el rango obligatorio dentro

```
parsear (zod)  →  ¿alcance?  →  ¿hay rango?  →  consultar
   ↓ falla         ↓ deniega     ↓ no hay
validation_error  forbidden /   sin_rango
                  unauthenticated
```

La **denegación precede a la invitación** (R5): un `mensajero` no recibe «elige un periodo», recibe
`forbidden`. Y una entrada malformada no llega a preguntar por el alcance, para que no sirva de
sonda de permisos. `sin_rango` **no toca la base ni la caché**.

---

## 5 — Contratos de entrada y salida

### 5.1 Entrada

La MISMA que las otras siete lecturas: el filtro sin validar tal cual lo manda el cliente, que
`conteoEntregasFiltroSchema` valida (`.strict()`, seis facetas, rango opcional en el esquema, tope
`RANGO_TOPE_DIAS = 366`). **Ningún parámetro propio de esta ficha.** Que la barra mueva las ocho
lecturas a la vez es la razón de que compartan filtro.

⚠ El rango es opcional **en el esquema** —que es compartido y no se toca— y **obligatorio para esta
lectura** (R5). Por eso el rechazo no es un `validation_error` (el filtro es válido: las otras siete
lecturas lo aceptan) sino un estado propio, `sin_rango`, que la pantalla traduce a una invitación.
Mezclarlo con «filtro inválido» diría que el usuario se equivocó cuando lo que pasa es que aún no ha
elegido.

### 5.2 Salida (`lib/types/cohorte-carga.ts`)

```ts
/** Los cubos posibles: los terminales del dominio + las que no cerraron. DERIVADO, no reescrito. */
export type CohorteDesenlace = (typeof ESTADOS_TERMINALES)[number] | "viva";

export interface CohorteCubo {
  readonly desenlace: CohorteDesenlace;
  /** Órdenes de la cohorte en este cubo. DENOMINADOR. */
  readonly n: number;
  /** Suma de segundos creación → cierre. NUMERADOR CRUDO. `null` en `viva`: no hay reloj. */
  readonly segundosAcum: number | null;
  /** `segundosAcum / n`, o `null`. Viaja JUNTO al numerador, nunca en su lugar. */
  readonly promedioSegundos: number | null;
}

export interface CohorteDeDia {
  /** Fecha calendario de Costa Rica, `YYYY-MM-DD`. Cadena, nunca `Date`. */
  readonly fecha: string;
  /** Órdenes cargadas ese día. Es EXACTAMENTE la suma de los `n` de `cubos` (R11). */
  readonly cargadas: number;
  /** Un elemento por cubo CON al menos una orden. */
  readonly cubos: readonly CohorteCubo[];
}

export interface CohorteCargaDTO {
  /** Una fila por día CON órdenes, de la MÁS RECIENTE a la más antigua (R6). */
  readonly porDia: readonly CohorteDeDia[];
  /** Universo del recorte: suma de `cargadas`. Derivado de las mismas filas (R30). */
  readonly total: number;
  /** El mismo reparto, agregado sobre todos los días. También derivado. */
  readonly totalPorDesenlace: readonly CohorteCubo[];
  /** ISO-8601 UTC en que estas cifras se leyeron DE LA BASE (R27). */
  readonly lastSync: string;
}

export type ResultadoCohorteCarga =
  | { readonly status: "ok"; readonly datos: CohorteCargaDTO }
  | { readonly status: "sin_rango" }          // R5/R26: falta elegir periodo. NO es un error del usuario
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
```

Tres decisiones de forma, ninguna cosmética:

1. **`fecha` es una cadena `YYYY-MM-DD`.** Un `date` vuelve del driver como `Date` de JavaScript y a
   partir de ahí cada consumidor decide en qué huso lo lee — que es exactamente cómo se reintroduce
   el off-by-one de seis horas.
2. **`segundosAcum: number | null` y no `0`.** Cero segundos es una afirmación («cerró al
   instante»); `null` dice «no hay reloj que parar». La misma distinción que hace `CicloVidaDTO`.
3. **Los cubos con `n = 0` NO viajan**, igual que los días sin órdenes: un hueco significa cero. La
   pantalla, que sí conoce los cuatro cubos, los rellena para dibujar sus columnas.

### 5.3 Lo que el repositorio devuelve (crudo)

`readonly { fecha: string; desenlace: CohorteDesenlace; n: number; segundosAcum: number | null }[]`
— **jamás el promedio**. El promedio lo deriva el servicio, exactamente como `CicloVidaService`
sobre `CicloCrudo`.

---

## 6 — Caché e invalidación

- Misma caché que las siete hermanas: `crearConteoEntregasCacheDeNext()`, TTL 15 min, mismo
  kill-switch.
- Clave: `claveDeCohorteCarga(consulta) = claveConPrefijo(TAG_COHORTE_CARGA, consulta)` — el cuerpo
  común (rango RESUELTO, alcance, seis facetas) más un **prefijo propio** (R28). Sin prefijo, las
  ocho lecturas comparten `ConsultaConteoEntregas` entera y producirían **la misma clave con valores
  de forma distinta**: quien pidiera la cohorte recibiría el anillo de desenlaces.
- Como el rango es obligatorio, los componentes `d=` / `h=` de la clave **nunca valen el centinela
  `*`** en esta lectura. `sin_rango` sale antes de mirar la caché.
- `lastSync` se sella **DENTRO del productor** (R27). Sellarlo fuera escribiría la hora del render en
  cada acierto de caché, y la pantalla juraría que la cifra es de este segundo llevando hasta un
  cuarto de hora de retraso.
- La faceta `mensajero_id` **sigue entrando en la clave** aunque no recorte: es redundante y se
  acepta, exactamente como en la serie hermana. Sacarla obligaría a una clave propia, y una clave que
  ignora un componente del filtro es la clase de atajo que un día sirve datos de un recorte en otro.
- `TAGS_ANALITICA` pasa de 7 a 8 verticales (R29). Su test afirma la lista **a mano** y la CUENTA por
  separado; hay que tocar las dos aserciones a conciencia.

---

## 7 — La superficie

### 7.1 Dónde

Sección **propia**, `SeccionFiltrable` con título `Detalle - Cohorte de carga`, hermana de
`Detalle - Productos` y **dentro de `FiltroEntregasProvider`** — si colgara de fuera no sería
descendiente de quien filtra y la barra no la movería (R31).

**Por qué no dentro de «Detalle · Movimiento de las ordenes»:** aquella sección reparte las órdenes
por su **fecha efectiva** (última gestión vigente, o la creación si nunca se gestionó); ésta las
reparte por su **fecha de carga** y las sigue fuera de la ventana. Son dos universos sobre el mismo
recorte, y meterlas bajo el mismo título haría leer sus totales como si tuvieran que cuadrar. Es el
mismo argumento —y con las mismas palabras— que ya lleva escrito `CargadasPorDiaBarras`.

**Por qué no un slot del shell:** las regiones «Filtros», «Tablero operativo» y «Tablero financiero»
de `AnaliticaShell` están COMENTADAS; hoy sólo se pinta `destacado`. Un panel colgado de ahí no se
vería y parecería un fallo de datos.

### 7.2 Qué se pinta

Una tabla, una fila por cohorte, **la más reciente arriba** (R6):

| Fecha de carga | Cargadas | Entregadas | Devueltas | Incidentes | Vivas | Días hasta entregar |
| --- | --- | --- | --- | --- | --- | --- |

- **`Vivas` es columna, no nota al pie** (R32). Ver §3.1.
- **`Días hasta entregar`** escribe el promedio del cubo `entregada` **con su denominador al lado**,
  con `contarOrdenes(n, ORDENES_CERRADAS)` y `rotuloConBase` — el módulo único de base de KPI. Sin
  ese `n` el promedio de una cohorte joven («1,2 días») es una cifra sobre las tres fáciles que ya
  cerraron.
- **El resumen de la sección** escribe el universo con `contarOrdenes(total, ORDENES)`: misma forma y
  mismo formateador que el resto de la fila de KPIs, en vez de un `${}` propio.
- **Si se escribe un porcentaje**, su denominador son las **cargadas**, no las cerradas (R33): sobre
  cerradas, una cohorte de hoy con una sola entrega sale al 100 %.
- **Sin rango** (R39): la sección se pinta con una invitación —«elige un periodo para ver las
  cohortes»— y **no** consulta. Ni tabla vacía, ni ceros, ni esqueleto cargando eternamente. Es el
  único estado de la pantalla que no es ni dato ni error.
- **La advertencia del filtro de mensajero** (R24) va en la descripción de la sección, junto al
  título, no escondida en un tooltip.
- Estados de error: los cuatro textos ya existentes (`TEXTO_PROHIBIDO`, `TEXTO_SESION_NO_VALIDA`,
  `TITULO_FILTRO_INVALIDO`, `TEXTO_ERROR_PANEL`), nunca degradados al vacío (R34).
- Datos por **una** Server Action + SWR, con la clave `[CLAVE_TABLERO, "cohorte-carga",
  filtroSerializado]` (R35).

### 7.3 Lo que la superficie NO trae

**Ni descarga (P5, decidido)**, ni desglose por tienda/zona dentro de la cohorte, ni gráfica. Una
tabla contesta la pregunta; un apilado de cuatro cubos por día no, y el dato útil —los días— no cabe
en él. Si al verla en pantalla hace falta exportarla, se pide entonces: sería superficie nueva con
su censo de columnas sensibles y su guardia de cobertura.

---

## 8 — Alternativas descartadas

**A1 — Ampliar la serie que ya existe (`CargadasPorDiaBarras`) a barras apiladas por desenlace.**
Es la opción barata: mismo ancla, mismo día CR, mismo sitio en la pantalla, cero superficie nueva.
**Descartada** porque cambia el significado de un gráfico que ya está en producción y que hoy
responde «cuántas entraron»: quien lo mira desde hace un mes leería otra cosa sin avisarle. Y porque
el dato útil de una cohorte es el **tiempo** (días hasta el desenlace), que en un apilado acabaría en
un tooltip, que es donde mueren los datos. La serie se queda intacta.

**A2 — Reusar el universo B2 de la 124 (`cubosDelDiaEnCurso` / el rollup `analytics_daily`).**
Ya existe, ya está probado, ya tiene job diario, y con `ordenesCreadas` por cubo parece que da la
cohorte gratis. **Descartada, y es la alternativa que más había que descartar bien:** el rollup
atribuye cada medida al **día del evento**, no al día de carga de la orden. Las entregas del viernes
de un lote del lunes viven en el cubo del **viernes**, y desde el cubo del lunes no hay forma de
saber cuáles eran de ese lote — la información no está agregada, está **perdida** en el agregado.
Reconstruirla exigiría una dimensión nueva (`fecha_carga`) en `analytics_daily`: migración, backfill
del histórico, un guardia de drift más y multiplicar la cardinalidad del cubo por los días de cola.
Todo eso para una pregunta que la tabla viva contesta hoy con una consulta y sin índice nuevo.

**A3 — Columna generada `orden.fecha_cr date` (+ índice) para agrupar sin expresión.**
Haría el `GROUP BY` trivialmente indexable. **Descartada** por el mismo motivo que ya dejó escrito
`ConteoCargadasPorDiaRepository`: una columna generada no es declarable en el datamodel de Prisma sin
que el cliente la meta en los `INSERT` y **rompa toda escritura de `orden`**. Además introduce una
segunda representación del día CR en la base, que es la puerta por la que vuelve el off-by-one.

**A4 — Anclar la cohorte en `orden.carga_id` (el lote REAL de la carga masiva).**
Existe y tiene índice (`@@index([cargaId])`, feature 141). **Descartada** por dos razones, y la
primera es del humano: *un día puede tener varias cargas y él las piensa juntas* — la pregunta fue
literal, «de las que cargué el lunes». La segunda es de cobertura: `carga_id` sólo existe en la carga
masiva; las órdenes creadas por API key o a mano no lo tienen y **quedarían fuera de toda cohorte**,
y una analítica que calla parte de su universo es peor que no tenerla.
**Anotado como refinamiento posible y FUERA de esta ficha:** «cómo salió ESTE archivo» es otra
pregunta, con otro universo y otra pantalla (el detalle de una carga). No se deja preparado, no se
declara y no se parametriza aquí.

**A5 — Clasificar el desenlace por la última gestión vigente (`COALESCE(u.resultado, s.value)`), como
el anillo de la sección.** Sería consistente con la tarjeta de al lado. **Descartada** porque la
gestión no es un desenlace del lote: una orden `reprogramada` tiene gestión y sigue viva, y una
`devuelta` gestionada el martes puede no haber vuelto a la tienda (§3.1). Además la gestión no da
instante de cierre comparable con `created_at` para el reloj (R18). El desenlace de una cohorte es el
estado en el que la orden **paró**, y eso es una transición, no una gestión.

**A6 — Aceptar la barra «sin filtrar» y volcar toda la historia agrupada por día de carga.**
Sería lo consistente con las otras siete lecturas (decisión del 2026-08-18: «sin filtro de fecha
significa TODO»). **Descartada (P3):** una tabla con una fila por cada día que alguna vez tuvo carga
**crece sin techo** y deja de ser una herramienta — nadie lee 400 filas para saber cómo va la semana.
El coste de la inconsistencia se paga con un estado propio bien nombrado (`sin_rango`) que **invita**
en vez de fallar, no con un `validation_error` que acusa al usuario de un error que no cometió.

---

## 9 — Coste, rendimiento y gate

### 9.1 Lo que cuesta la consulta

Un recorrido por la ventana de `orden` (índice `createdAt`) más, por cada orden de la cohorte, una
búsqueda por índice en `orden_historial_estado`. Es **lineal en el número de órdenes del recorte**,
y el recorte está ahora **acotado por construcción**: el rango es obligatorio y el esquema
compartido lo topa en `RANGO_TOPE_DIAS = 366`. El peor caso es un año de órdenes y ≤ 366 filas de
salida; el caso normal, una semana o un mes.

Con el estado actual de producción —vaciada a propósito el 2026-08-25, arranque comercial— eso son
cientos de órdenes y decenas de filas. **La cifra que importa es la medida, no ésta:** T0.2 la mide
en solo lectura contra producción y la escribe en la bitácora **antes** de implementar.

### 9.2 El gate de esta ficha es el COMPLETO, y no por una migración

`./init.sh --rapido` **se niega solo** cuando el diff toca `lib/types/**` (`docs/verification.md`).
El DTO de esta lectura vive en `lib/types/cohorte-carga.ts`, igual que los de sus siete hermanas
(`lib/types/conteo-cargadas.ts`, `lib/types/conteo-ciclo-vida.ts`, …). Hay dos salidas y sólo una es
honesta:

- mover el DTO fuera de `lib/types/` para esquivar el gate → rompe la convención de la vertical y
  deja el octavo DTO en otro sitio que los siete anteriores, **para que el gate mienta**;
- **aceptar el gate completo.** Es lo que se hace.

Dicho con todas las letras para que nadie lo descubra al final: **esta ficha cuesta una corrida
completa de la suite (~4 min) en cada verificación**, no los ~58 s del rápido. Y con `DATABASE_URL`
resoluble: sin ella, los ~147 archivos de `tests/integration/db` se SALTAN y la evidencia de §2
—que es casi toda— no se ejecuta.

### 9.3 Lo que este diseño NO compra

- No hay rollup: la cifra se recalcula cada 15 minutos por combinación de filtro y alcance.
- Una cohorte reciente **no está madura** y su promedio de días está sesgado hacia abajo: sólo entran
  las que ya cerraron. No se corrige (sería inventar), se **enseña**: la columna `Vivas` es
  exactamente la medida de esa inmadurez, y el `n` del promedio viaja siempre.

---

## 10 — Riesgos de test, escritos antes de escribir un test

| Riesgo | Cómo se cierra |
| --- | --- |
| **La ventana sobre el CIERRE en vez de sobre la CARGA (§0).** No rompe nada visible: da una cohorte con números plausibles y equivocados | Caso dedicado T4.4 (orden cargada dentro, cerrada después del `hasta`) **y hay que VER EL ROJO**: correr el caso con `condicionDeVentanaTerminal` copiada y pegar la salida del fallo en la bitácora |
| **`startOfDayCR` como cota.** Seis horas de desplazamiento, invisibles a ojo | Caso dedicado T4.1 (23:50 y 00:10 CR) **y hay que VER EL ROJO** con `startOfDayCR` puesto, con su salida pegada |
| **Los dobles no ven el SQL.** Una mutación del `WHERE` pasa en verde: medido cuatro veces en este repo | Todo lo de §2 se prueba contra **Postgres real** (`tests/integration/db/`), dentro de `enTransaccionRevertida` y con `serializarEscriturasReales` |
| **Test verde sin datos.** Una ventana de cohorte vacía reporta `passed` sin comprobar nada | Cada caso de integración **asevera primero que su fixture produjo filas** (`expect(filas.length).toBeGreaterThan(0)`) antes de afirmar nada. Un caso sin ese aserto no se acepta |
| **Aserción contra su propia fuente.** Comparar los cubos contra `ESTADOS_TERMINALES`, que la consulta también importa, siempre estaría verde | Los cuatro cubos se afirman con un **literal escrito a mano** (`["entregada","devuelta_a_tienda","incidente","viva"]`) —es el contrato— **y** el censo T2.4 comprueba que el repositorio **no contiene** esos literales |
| **Divergencia con la serie hermana** (cuarta escritura del mismo `where`) | Test de equivalencia contra Postgres real: `SUM(n)` por día == `contarCargadasPorDia` del MISMO filtro, día a día |
| **`sin_rango` degradado a cero.** El estado nuevo es fácil de tratar como «no hay datos» | Casos en la acción (no toca base ni caché, y la denegación va antes) y en el componente (invita, no pinta tabla) |
