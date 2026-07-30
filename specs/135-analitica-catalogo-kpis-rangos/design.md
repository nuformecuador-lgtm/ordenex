# Feature 135 — analítica: catálogo de KPIs + rangos temporales · design

> Contrato fundacional del lote de analítica. Todo lo que sigue es **declarativo y puro**:
> tipos, datos congelados y funciones sin efectos. Cero DB, cero HTTP, cero React.

## 1. Modelo de datos

**Ninguno.** Esta feature NO crea tablas, columnas, índices, migraciones ni políticas RLS, y
por tanto no lleva `migration.sql` ni `down.sql`. Lo único que hace respecto de datos es
**declarar** los nombres de tabla que cada métrica podrá leer, para que la 123 (migración de
`analytics_daily`), la 126 y la 127 no negocien esa frontera cada una por su cuenta:

| Origen declarado | Tablas | Quién lo consume |
|---|---|---|
| `rollup` | `analytics_daily` (la crea la **123**) | 126 (operativa histórica), 128 (invalidación) |
| `tabla_viva` | `orden`, `gestion_orden`, `orden_historial_estado` | 126 (intradía) |
| `ledger` | `wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento` | 127 |
| `snapshot_cierre` | `cierre_dia`, `cierre_bodega` | 127 |

La regla dura (requirements R6) es que una métrica `financiera` **solo** puede citar `ledger` y
`snapshot_cierre`. Es la traducción a tipos de la consigna de la 127: *el dinero nunca se
recalcula desde órdenes*. Como la comprobación es estructural, el día que alguien intente
declarar "COD recaudado" leyendo `orden.monto_cobrar`, el test cae antes que producción.

## 2. Ubicación y archivos

```
lib/analytics/
  types.ts     # tipos y dominios cerrados compartidos (sin datos)
  metrics.ts   # EL catálogo + lookup + tags de caché por dominio
  ranges.ts    # presets -> ventana [desde, hasta) en hora de Costa Rica
  filters.ts   # esquema zod de filtros + mapeo de errores a fieldErrors
```

La ficha nombra dos archivos (`metrics.ts`, `ranges.ts`) más "esquema zod de filtros". Se
separan `types.ts` y `filters.ts` porque `filters.ts` es el **único** que importa `zod` y
`ranges.ts` es el único que importa `@/lib/utils/fecha-cr`: mantenerlos aparte deja el grafo de
dependencias trivial y permite que un guard de pureza (R1) razone por archivo. `types.ts` evita
el ciclo `metrics ↔ filters` (ambos necesitan `DimensionAnalitica` y `RangoPreset`).

Nombres en `kebab-case`/`camelCase` según `docs/conventions.md`; `metrics.ts` y `ranges.ts`
conservan los nombres literales de la ficha aunque el resto del repo escriba en español, porque
son los que citan las 13 features consumidoras.

## 3. Contrato: el catálogo de métricas

### 3.1 Dominios cerrados (`types.ts`)

```ts
export type MetricaDominio = "operativa" | "financiera";
export type MetricaClase = "live" | "snapshot";
export type MetricaUnidad = "conteo" | "porcentaje" | "moneda" | "segundos";
export type DimensionAnalitica =
  | "fecha" | "zona" | "tienda" | "mensajero"
  | "estatus" | "metodo_pago" | "causa_devolucion";
export type RolAnalitica = "maestro" | "admin" | "adminSatelite" | "adminTienda" | "mensajero";
export type AlcanceMetrica = "total" | "acotado" | "prohibido";
```

- `RolAnalitica` es un **subconjunto explícito** de `RolValue` (`db/schema.prisma:35-44`) que
  deja fuera `apiKey`: esa cuenta es un integrador sin sesión de UI, no un lector de tableros.
  Se declara como unión literal propia (no `Exclude<RolValue,"apiKey">`) para que `lib/analytics`
  no arrastre `@prisma/client` en runtime (R1); un test de consistencia afirma que los 5
  literales existen en `RolValue`, así que un rename futuro en el esquema rompe aquí.
- `AlcanceMetrica` distingue **`total`** (el rol ve todas las filas) de **`acotado`** (el rol la
  ve, pero recortada por el `WHERE` que resuelve la 122) y **`prohibido`** (la métrica no se le
  ofrece ni con recorte). Es la mínima información que la 133 (recortes de presentación por rol)
  necesita para decidir qué panel pintar sin volver a preguntar por permisos.
- `MetricaUnidad` existe para la 130 (formato de gráfica) y la 134 (encabezado y formato de la
  columna CSV). La moneda **no** se hardcodea aquí: se resuelve por `lib/config/moneda.ts`
  (`docs/architecture.md`, principio 4).

### 3.2 Forma de una métrica

```ts
export interface FuenteRollup   { tipo: "rollup";          tablas: readonly ["analytics_daily"] }
export interface FuenteViva     { tipo: "tabla_viva";      tablas: readonly TablaViva[] }
export interface FuenteLedger   { tipo: "ledger";          tablas: readonly TablaLedger[] }
export interface FuenteCierre   { tipo: "snapshot_cierre"; tablas: readonly TablaCierre[] }
export type FuenteMetrica = FuenteRollup | FuenteViva | FuenteLedger | FuenteCierre;

export interface DefinicionMetrica {
  /** `value` de order_status que la determinan; DEBEN existir en ORDER_STATUS_SEED (R8). */
  readonly estados?: readonly OrderStatusValue[];
  /** categorías de enum del esquema (gestion_resultado, metodo_pago, wallet_*_categoria...). */
  readonly categorias?: readonly string[];
  /** criterio derivado ya existente en el repo, si aplica (p. ej. intentos de la feature 160). */
  readonly criterio?: "intentos_vigentes_historial";
  /** numerador/denominador cuando la unidad es porcentaje. */
  readonly razon?: { readonly numerador: MetricaId; readonly denominador: MetricaId };
}

export interface Metrica {
  readonly id: string;             // snake_case, único, estable (R4)
  readonly etiqueta: string;       // texto de UI (130/134)
  readonly descripcion: string;    // una frase; qué cuenta y qué NO cuenta
  readonly dominio: MetricaDominio;
  readonly clase: MetricaClase;    // snapshot <=> fuente rollup (R5)
  readonly unidad: MetricaUnidad;
  readonly granos: readonly DimensionAnalitica[];   // incluye siempre "fecha" (R10)
  readonly fuente: FuenteMetrica;
  readonly alcance: Readonly<Record<RolAnalitica, AlcanceMetrica>>;  // los 5, exhaustivo (R7)
  readonly definicion: DefinicionMetrica;
}
```

Exports del módulo:

```ts
export const METRICAS: readonly Metrica[];                    // congelado, fuente única (R2)
export type MetricaId = (typeof METRICAS)[number]["id"];      // ids como unión literal
export function getMetrica(id: string): Metrica | undefined;  // total, no lanza (R4)
export function listarMetricas(f?: { dominio?: MetricaDominio; rol?: RolAnalitica }): readonly Metrica[];
export const ANALITICA_TAGS: Readonly<Record<MetricaDominio, string>>; // "analitica:operativa" | "analitica:financiera"
export function tagDeDominio(d: MetricaDominio): string;       // consumido por la 128
```

`listarMetricas({ rol })` devuelve las métricas cuyo alcance para ese rol **no** es `prohibido`.
Sigue sin ser autorización (R24): es un filtro de **presentación** para la 133; el recorte de
filas lo hace la 122 y el gating de la ruta la 129.

### 3.3 Catálogo v1 PROPUESTO — **pendiente de Q1, no implementar sin aprobación**

Derivado literalmente de las descripciones de la 126 y la 127 en `feature_list.json`. Los
estados citados están verificados contra `ORDER_STATUS_SEED` (19 valores; `en_fulfillment` NO
aparece porque la 155 lo retiró).

**Operativas** (`dominio: "operativa"`)

| id | unidad | clase | granos | definición (estados/criterio verificados) |
|---|---|---|---|---|
| `ordenes_creadas` | conteo | snapshot | fecha, zona, tienda | órdenes creadas en el rango (`ESTADOS_CREACION`: `en_preparacion`, `por_recolectar_en_tienda`) |
| `ordenes_por_estado` | conteo | snapshot | fecha, zona, tienda, mensajero, estatus | embudo: conteo por cada uno de los 19 `value` vigentes |
| `entregas` | conteo | snapshot | fecha, zona, tienda, mensajero | transiciones a `entregada` |
| `devoluciones` | conteo | snapshot | fecha, zona, tienda, mensajero | transiciones a `devuelta` |
| `rechazos` | conteo | snapshot | fecha, zona, tienda, mensajero | transiciones a `rechazada` |
| `reprogramaciones` | conteo | snapshot | fecha, zona, tienda, mensajero | transiciones a `reprogramada` vía familia `gestion` |
| `incidentes` | conteo | snapshot | fecha, zona, tienda, mensajero | transiciones a `incidente` (features 154/158) |
| `sin_gestionar` | conteo | snapshot | fecha, zona, mensajero | órdenes congeladas por el corte diario (`sin_gestionar`) |
| `tasa_entrega` | porcentaje | snapshot | fecha, zona, tienda, mensajero | `entregas / (entregas+devoluciones+rechazos+incidentes)` |
| `tasa_devolucion` / `tasa_rechazo` | porcentaje | snapshot | ídem | mismo denominador |
| `primer_intento_ok` | porcentaje | snapshot | fecha, zona, mensajero | entregas con 0 intentos previos (criterio `intentos_vigentes_historial`, feature 160) |
| `motivos_devolucion` | conteo | snapshot | fecha, zona, tienda, causa_devolucion | `gestion_orden.causa_devolucion` (5 valores, feature 73), gestiones **vigentes** |
| `tiempo_ciclo` | segundos | snapshot | fecha, zona, tienda | creación → estado terminal (`ESTADOS_TERMINALES`) |
| `aging_por_estado` | segundos | live | fecha, zona, tienda, estatus | antigüedad en el estado actual (intradía, `orden` + `orden_historial_estado`) |

**Financieras** (`dominio: "financiera"`, fuente ledger/cierre **exclusivamente**)

| id | unidad | fuente | definición |
|---|---|---|---|
| `cod_recaudado` | moneda | `snapshot_cierre` (`cierre_dia.total_general`) + `wallet_tienda_movimiento` (`cod_recaudado`) | recaudo por método: `total_efectivo` / `total_simpe` / `total_transferencia` (`MetodoPagoValue = efectivo|SINPE|transferencia`) |
| `ingreso_flete` / `ingreso_comision_cod` / `ingreso_iva` | moneda | `wallet_movimiento` | categorías `ingreso_flete`, `ingreso_flete_devolucion`, `ingreso_comision_cod`, `ingreso_iva_*` |
| `egresos` | moneda | `wallet_movimiento` | categorías `egreso_*` (incluye `egreso_indemnizacion`, feature 158) |
| `cuenta_por_pagar_tienda` | moneda | `wallet_tienda_movimiento` | `SUM(credito) - SUM(debito)` |
| `cuenta_por_pagar_mensajero` | moneda | `pago_mensajero_movimiento` | `SUM(devengo) - SUM(pago)` |
| `conciliacion_cierres` | conteo/moneda | `cierre_dia` + `cierre_bodega` | cierres por estado (`solicitado|aprobado|rechazado|vencido`) y sus totales snapshot |

La columna `alcance` de estas filas queda **en blanco a propósito**: depende de Q7.

## 4. Contrato: rangos temporales

### 4.1 Reutilización (no reimplementación)

`ranges.ts` **importa** de `lib/utils/fecha-cr.ts` y no calcula ningún offset propio:

```ts
import { fechaCalendarioCR, inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
```

Ese archivo **es reutilizable tal cual: no hace falta extracción**. Documenta que
`America/Costa_Rica` es UTC-6 fijo (sin horario de verano) y ya expone las dos convenciones del
repo. Corrección de la premisa de la ficha: la lógica de fecha que hay que reusar **no está en
el corte diario** — `CorteDiarioService` no maneja fechas en absoluto, trabaja por "gestiones
sin cierre" (`lib/services/CorteDiarioService.ts:51-125`). Lo que sí existe, y es lo que se
reusa, es `fecha-cr.ts`.

**Trampa conocida y evitada:** `startOfDayCR()` devuelve la medianoche **UTC** de la fecha CR
(convención `@db.Date` de la feature 46) y está 6 h por debajo del inicio real del día en CR.
Usarla como cota contra columnas `timestamp` produce una ventana 18:00–18:00 CR — exactamente
lo que hoy hace `RankingService.ts:60-61`. Analítica usa `inicioDelDiaCREnUtc` (feature 144).
Ver **Q6**: la divergencia con el ranking necesita decisión humana.

### 4.2 API

```ts
export type RangoPreset = "dia" | "semana" | "mes";   // (+ "personalizado" solo si se aprueba Q4)

export interface RangoResuelto {
  readonly preset: RangoPreset;
  readonly desde: Date;        // instante UTC, INCLUSIVO   (…T06:00:00.000Z)
  readonly hasta: Date;        // instante UTC, EXCLUSIVO   (…T06:00:00.000Z)
  readonly desdeFecha: string; // "YYYY-MM-DD" calendario CR, inclusivo
  readonly hastaFecha: string; // "YYYY-MM-DD" calendario CR, INCLUSIVO para el consumidor
}

export function resolverRango(preset: RangoPreset, now?: Date): RangoResuelto;
```

- **Semiabierto `[desde, hasta)`** por coherencia con lo que ya hace el repo (`RankingService`,
  `inicioDelDiaSiguienteCREnUtc`): evita el clásico off-by-one de perder el último día.
- `hastaFecha` es **inclusiva** porque es la fecha que se pinta en la UI y la que consulta el
  rollup (`analytics_daily.fecha` es una fecha calendario, no un instante). El par
  (instantes semiabiertos para tablas vivas, fechas inclusivas para el rollup) es justo lo que
  126 necesita para servir intradía e histórico con el mismo objeto.
- `now` inyectable con default `new Date()` (R17); ningún `Date.now()` escondido.

Ejemplo canónico (R15), `now = 2026-07-15T02:00:00Z` (20:00 del 14 en CR):
`desde = 2026-07-14T06:00:00.000Z`, `hasta = 2026-07-15T06:00:00.000Z`,
`desdeFecha = hastaFecha = "2026-07-14"`.

Los bordes de `semana` y `mes` quedan **abiertos** hasta Q2/Q3; los invariantes que sí se
implementan y testean ya (R16) valen para cualquier respuesta: frontera de día CR, duración
entera en días, `desde <= now < hasta`, determinismo e independencia del `TZ` del proceso.

## 5. Contrato: filtros (zod)

```ts
const idList = z.array(z.string().min(1)).nonempty();   // patrón feature 144/R32

export const analiticaFiltroSchema = z
  .object({
    rango: z.enum(RANGO_PRESETS),          // obligatorio (R20)
    zona_id: idList.optional(),
    tienda_id: idList.optional(),
    mensajero_id: idList.optional(),
  })
  .strict();                               // rechaza claves desconocidas (R19/R24)

export type AnaliticaFiltroInput = z.infer<typeof analiticaFiltroSchema>;
export function parseAnaliticaFiltro(raw: unknown):
  | { status: "ok"; filtro: AnaliticaFiltroInput }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
```

- **Listas no vacías, nunca escalares.** Copia deliberada de `ordenFilterSchema`
  (`lib/types/orden.ts:98-134`): una lista vacía significaría "ningún valor" y degradaría a
  "sin filtro" si el repositorio la descartara → falla cerrado.
- **El cliente nunca manda instantes** (R22): manda un preset; los bordes los calcula
  `resolverRango` server-side. Si Q4 se aprueba, la extensión será `desde`/`hasta` como
  `YYYY-MM-DD` (regex de ancho fijo) más un `.refine` de rango no invertido y otro de tope de
  ventana, todo espejo del patrón de la 144 — nunca ISO con hora ni offsets.
- **El filtro no lleva rol ni sesión** (R24). `.strict()` hace que `{ rol: "maestro" }` sea un
  error de validación, no un vector de escalada. La 122 aplica su `WHERE` **encima** del filtro
  ya validado; el orden es: parsear → resolver alcance → consultar.
- `parseAnaliticaFiltro` devuelve un resultado **discriminado** (no lanza) y sus `fieldErrors`
  encajan con `ActionError.validation_error` que ya consumen las Server Actions del repo.

## 6. Contratos hacia las features consumidoras

| Feature | Qué toma de aquí |
|---|---|
| 122 alcance por rol | `RolAnalitica`, `AlcanceMetrica`; decide el `WHERE` a partir de `metrica.alcance[rol]` |
| 123 `analytics_daily` | las medidas de las métricas `clase: "snapshot"` y sus `granos` (columnas del grano) |
| 124 job diario | `resolverRango("dia", now)` para acotar el día a recomputar |
| 125 backfill | `RangoResuelto` por día iterando fechas calendario CR |
| 126 operativa | `METRICAS` de dominio operativa; `clase` decide rollup vs intradía |
| 127 financiera | `METRICAS` financieras; `fuente` le prohíbe por tipos leer `orden` |
| 128 caché | `tagDeDominio(dominio)` |
| 129–133 UI | `etiqueta`, `unidad`, `granos`, `alcance` (qué panel ve cada rol) |
| 134 export CSV | `id` (columna), `etiqueta` (encabezado), `unidad` (formato) |

## 7. Alternativas descartadas

1. **Catálogo en base de datos (tabla `analytics_metric`), como `order_status`.**
   Descartada: el catálogo de estados vive en DB porque `orden.estatus_id` es una **FK** y la
   fila tiene identidad persistente; una métrica no la tiene — nadie referencia un KPI por id
   desde una fila. Meterlo en DB costaría migración + seed + RLS + una consulta por render,
   perdería la unión literal de TypeScript (`MetricaId`) que da autocompletado y errores en
   compilación a las 13 features consumidoras, y convertiría "agregar un KPI" en un deploy de
   datos. Se queda en TS congelado (`as const`), patrón `ORDER_STATUS_SEED` / `ROLES_SEED`.

2. **Reimplementar los rangos con `Intl.DateTimeFormat`/`Temporal` y `timeZone:
   "America/Costa_Rica"`.** Descartada: sería más "correcto" en general, pero el repo ya decidió
   —y documentó— que CR es **UTC-6 fijo sin horario de verano**, y `fecha-cr.ts` implementa esa
   aritmética con casos límite ya cubiertos por tests. Convivir dos aritméticas de fecha es
   exactamente el bug que produce que dos pantallas reporten cifras distintas para "hoy".
   Además `Temporal` no está disponible en el runtime de destino sin polyfill. Se reusa
   `fecha-cr.ts` (R14) y, si algún día CR adopta DST, se cambia **un** archivo.

3. **Extraer la lógica de día del corte diario a un módulo compartido.** Descartada por un
   motivo empírico: **no hay tal lógica que extraer**. `CorteDiarioService` no mira fechas
   (`:51-125`). Extraer algo inexistente habría significado *inventar* un "día operativo" nuevo
   y meterlo en el camino money-critical del corte. Lo que sí queda es la pregunta Q6.

4. **Reutilizar/extender `ordenFilterSchema` para analítica.** Descartada: ese schema arrastra
   `status_id`, geografía (`provincia_id`/`canton_id`/`distrito_id`), `reasignables` y los
   presets `7d/15d/30d/90d`, ninguno de los cuales pertenece al contrato de analítica; y
   ampliarlo para servir a los dos consumidores obligaría a aflojar sus `refine`, que hoy
   protegen el listado de órdenes. Se copia el **patrón** (listas no vacías, `.strict()`, fechas
   calendario), no el objeto.

5. **Un solo archivo `lib/analytics/index.ts` con todo.** Descartada: mezclaría el único
   importador de `zod` con el único importador de `fecha-cr`, y dejaría el guard de pureza (R1)
   sin capacidad de señalar qué parte del contrato se contaminó.

6. **Declarar el alcance por rol como un simple `roles: RolAnalitica[]` (lista de quién ve
   qué).** Descartada: perdería la distinción entre "ve todo" y "ve lo suyo", que es
   precisamente lo que la 133 necesita para pintar el panel correcto y lo que hace explícito que
   `adminTienda` **sí** ve `tasa_entrega`, pero solo la de su tienda. La `Record` exhaustiva
   además obliga por tipos a pronunciarse sobre los 5 roles en cada métrica nueva (R7), en vez
   de olvidarse de uno en silencio.

## 8. Riesgos

- **Q1 sin responder = catálogo especulativo.** Si se implementa la propuesta §3.3 y luego el
  humano recorta, la 126/127 arrancan con métricas muertas. Por eso T0 es puerta dura.
- **El catálogo es el cuello de botella de 13 features.** Un cambio de forma después de la 126
  obliga a tocar todo el lote; por eso los invariantes (R5–R10) se testean como guards, no como
  buenas intenciones.
- **`en_fulfillment` huérfano en la DB.** Cualquier consulta que haga `GROUP BY estatus_id`
  contra la tabla real puede devolver esa fila en bases con historial. El catálogo no la cita
  (R8), pero la **123/126** deben tolerarla en el rollup. Queda anotado aquí para ellas.

## 9. Verificación

Solo tests unitarios (`tests/unit/analytics/**`): no hay DB, HTTP ni UI que ejercitar, así que
no aplica integración ni E2E. Además de los tests de comportamiento, tres **guards**:
pureza del módulo (R1/R2), reutilización de `fecha-cr` (R14) y consistencia de los vocabularios
citados contra `ORDER_STATUS_SEED` y los enums del esquema (R8/R9). Cierre con `./init.sh`.
