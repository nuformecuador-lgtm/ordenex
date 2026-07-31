# Feature 135 — analítica: catálogo de KPIs + rangos temporales · design

> Contrato fundacional del lote de analítica. Todo lo que sigue es **declarativo y puro**:
> tipos, datos congelados y funciones sin efectos. Cero DB, cero HTTP, cero React.
>
> **Estado: puerta T0 CERRADA el 2026-07-30.** Las 10 decisiones del humano están en
> `requirements.md > Decisiones del humano (2026-07-30)` (D1–D10) y **mandan sobre cualquier
> redacción anterior de este archivo**. Nada aquí sigue "pendiente de Q".

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

// --- añadidos por las decisiones del 2026-07-30 ---
export type UnidadDeConteo = "gestion" | "orden" | "moneda" | "tiempo";   // D10 / R36
export type EstadoProduccion = "producida" | "declarada";                // D8  / R33
export const MENSAJERO_SIN_ASIGNAR = "sin_asignar" as const;             // D5  / R30
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
  /** numerador/denominador cuando la unidad es porcentaje; el denominador puede ser una suma. */
  readonly razon?: {
    readonly numerador: MetricaId;
    readonly denominador: readonly MetricaId[];   // D10: suma de gestiones, no "órdenes"
  };
  /** lo que NO cuenta; obligatorio citar `anulada_at` en las métricas por gestión (D10/R35). */
  readonly excluye?: readonly string[];
  /** D5/R30 — qué hace con `mensajero_asignado_id IS NULL` toda métrica con grano `mensajero`. */
  readonly sinAsignar?: "incluir";
  /** D9/R34 — qué zona atribuye toda métrica con grano `zona`. Solo hay un valor legal. */
  readonly atribucionZona?: "orden";
}

export interface Metrica {
  readonly id: string;             // snake_case, único, estable (R4)
  readonly etiqueta: string;       // texto de UI (130/134)
  readonly descripcion: string;    // una frase; qué cuenta y qué NO cuenta
  readonly dominio: MetricaDominio;
  readonly clase: MetricaClase;    // snapshot <=> fuente rollup (R5)
  readonly unidad: MetricaUnidad;
  readonly unidadDeConteo: UnidadDeConteo;         // D10 / R36: gestión vs orden, EVIDENTE
  readonly estadoProduccion: EstadoProduccion;     // D8  / R33: puede no tener productor aún
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
export function listarMetricas(f?: {
  dominio?: MetricaDominio;
  rol?: RolAnalitica;
  estadoProduccion?: EstadoProduccion;   // D8 / R33
}): readonly Metrica[];
export function sonSumables(a: MetricaId, b: MetricaId): boolean;  // D10 / R36
export const ANALITICA_TAGS: Readonly<Record<MetricaDominio, string>>; // "analitica:operativa" | "analitica:financiera"
export function tagDeDominio(d: MetricaDominio): string;       // consumido por la 128
```

`listarMetricas({ rol })` devuelve las métricas cuyo alcance para ese rol **no** es `prohibido`.
Sigue sin ser autorización (R24): es un filtro de **presentación** para la 133; el recorte de
filas lo hace la 122 y el gating de la ruta la 129.

### 3.3 Catálogo v1 — **CONTRATO** (aprobado íntegro el 2026-07-30, D1 «todas»)

> Esto ya **no es una propuesta**. D1 aprobó la lista entera: **15 ids operativos + 8 ids
> financieros = 23 métricas**. Añadir o quitar una exige una decisión humana nueva y fechada.
> Estados verificados contra `ORDER_STATUS_SEED` (19 valores; `en_fulfillment` NO aparece porque
> la 155 lo retiró).

**Operativas** (`dominio: "operativa"`) — alcance: `maestro`/`admin` = `total`; `adminSatelite`,
`adminTienda` y `mensajero` = `acotado` (la 122 pone el `WHERE`), salvo donde se indique.

| id | unidad | unidadDeConteo | clase | granos | definición (estados/criterio verificados) |
|---|---|---|---|---|---|
| `ordenes_creadas` | conteo | **orden** | snapshot | fecha, zona, tienda | órdenes creadas en el rango (`ESTADOS_CREACION`: `en_preparacion`, `por_recolectar_en_tienda`) |
| `ordenes_por_estado` | conteo | **orden** | snapshot | fecha, zona, tienda, mensajero, estatus | embudo: conteo de ÓRDENES por cada uno de los 19 `value` vigentes |
| `entregas` | conteo | **gestion** | snapshot | fecha, zona, tienda, mensajero | gestiones **vigentes** con resultado `entregada` (`anulada_at IS NULL`) |
| `devoluciones` | conteo | **gestion** | snapshot | fecha, zona, tienda, mensajero | gestiones vigentes con resultado `devuelta` |
| `rechazos` | conteo | **gestion** | snapshot | fecha, zona, tienda, mensajero | gestiones vigentes con resultado `rechazada` |
| `reprogramaciones` | conteo | **gestion** | snapshot | fecha, zona, tienda, mensajero | gestiones vigentes con resultado `reprogramada` |
| `incidentes` | conteo | **gestion** | snapshot | fecha, zona, tienda, mensajero | gestiones vigentes con resultado `incidente` (features 154/158) |
| `sin_gestionar` | conteo | **orden** | snapshot | fecha, zona, mensajero | órdenes congeladas por el corte diario (estado `sin_gestionar`) |
| `tasa_entrega` | porcentaje | **gestion** | snapshot | fecha, zona, tienda, mensajero | `entregas / (entregas+devoluciones+rechazos+incidentes)` — tasa **sobre gestiones** |
| `tasa_devolucion` | porcentaje | **gestion** | snapshot | ídem | mismo denominador de gestiones |
| `tasa_rechazo` | porcentaje | **gestion** | snapshot | ídem | mismo denominador de gestiones |
| `primer_intento_ok` | porcentaje | **gestion** | snapshot | fecha, zona, mensajero | entregas con 0 intentos previos (`criterio: "intentos_vigentes_historial"`, feature 160) |
| `motivos_devolucion` | conteo | **gestion** | snapshot | fecha, zona, tienda, causa_devolucion | `gestion_orden.causa_devolucion` (**3** valores: `not_found`, `wrong_number`, `wrong_address` — corregido el 2026-07-30, decía 5), gestiones vigentes |
| `tiempo_ciclo` | segundos | **tiempo** | snapshot | fecha, zona, tienda | creación → estado terminal (`ESTADOS_TERMINALES`) |
| `aging_por_estado` | segundos | **tiempo** | live | fecha, zona, tienda, estatus | antigüedad en el estado actual (intradía, `orden` + `orden_historial_estado`) |

**Financieras** (`dominio: "financiera"`, fuente ledger/cierre **exclusivamente**, 8 ids) —
alcance **cerrado por D7**: `maestro` = `total`, `admin` = `total`, `adminSatelite` =
`adminTienda` = `mensajero` = **`prohibido`**. `unidadDeConteo: "moneda"` en todas salvo donde
se indique.

| id | unidad | fuente | definición |
|---|---|---|---|
| `cod_recaudado` | moneda | `snapshot_cierre` (`cierre_dia.total_general`) + `wallet_tienda_movimiento` (`cod_recaudado`) | recaudo por método: `total_efectivo` / `total_simpe` / `total_transferencia` (`MetodoPagoValue = efectivo\|SINPE\|transferencia`) |
| `ingreso_flete` | moneda | `wallet_movimiento` | categorías `ingreso_flete`, `ingreso_flete_devolucion` |
| `ingreso_comision_cod` | moneda | `wallet_movimiento` | categoría `ingreso_comision_cod` |
| `ingreso_iva` | moneda | `wallet_movimiento` | categorías `ingreso_iva_*` |
| `egresos` | moneda | `wallet_movimiento` | categorías `egreso_*` (incluye `egreso_indemnizacion`, feature 158) |
| `cuenta_por_pagar_tienda` | moneda | `wallet_tienda_movimiento` | `SUM(credito) - SUM(debito)` |
| `cuenta_por_pagar_mensajero` | moneda | `pago_mensajero_movimiento` | `SUM(devengo) - SUM(pago)` |
| `conciliacion_cierres` | conteo | `cierre_dia` + `cierre_bodega` | cierres por estado (`solicitado\|aprobado\|rechazado\|vencido`) y sus totales snapshot (`unidadDeConteo: "moneda"`, la unidad de UI es conteo + moneda) |

**`estadoProduccion` (D8/R33).** El catálogo puede declarar métricas sin productor todavía. La
asignación concreta `producida` / `declarada` por métrica la fija el implementer en T3.1 según
lo que la 126 y la 127 tengan comprometido en `feature_list.json`, y la deja escrita en
`progress/impl_135.md`; una métrica `declarada` **no es deuda** de esas dos features (D8).

**Frontera de sumabilidad (D10/R36).** `unidadDeConteo` está en la tabla a propósito y es un
campo de la métrica, no un comentario: `entregas + devoluciones + rechazos + incidentes` **no
suma órdenes** (una orden reprogramada y luego entregada aporta dos gestiones), y por eso
`sonSumables("entregas", "ordenes_creadas") === false`.

**Cubo `sin_asignar` (D5/R30).** Toda métrica con grano `mensajero` (`ordenes_por_estado`,
`entregas`, `devoluciones`, `rechazos`, `reprogramaciones`, `incidentes`, `sin_gestionar`, las
tres tasas y `primer_intento_ok`) declara `definicion.sinAsignar: "incluir"`: las órdenes con
`mensajero_asignado_id IS NULL` van al cubo `MENSAJERO_SIN_ASIGNAR`, no se descartan.

**Atribución de zona (D9/R34).** Toda métrica con grano `zona` declara
`definicion.atribucionZona: "orden"` → `orden.zona_id` congelado, nunca `usuario.zona_id` del
mensajero.

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

**D6 (2026-07-30) cerró esto:** el día operativo de analítica es el **día natural de Costa Rica
00:00–24:00**, y se abre **ticket aparte** para sanear `RankingService`. **Divergencia aceptada
y declarada:** hasta que ese ticket se resuelva, analítica y ranking reportan cifras distintas
para "hoy". No es un defecto: está decidido (R31).

### 4.2 API

```ts
// D4: los tres presets Y el rango arbitrario. Dominio cerrado de 4 valores.
export type RangoPreset = "dia" | "semana" | "mes" | "personalizado";
export const RANGO_PRESETS = ["dia", "semana", "mes", "personalizado"] as const;
export const RANGO_TOPE_DIAS = 366;   // D4, recomendación no objetada

export interface RangoResuelto {
  readonly preset: RangoPreset;
  readonly desde: Date;        // instante UTC, INCLUSIVO   (…T06:00:00.000Z)
  readonly hasta: Date;        // instante UTC, EXCLUSIVO   (…T06:00:00.000Z)
  readonly desdeFecha: string; // "YYYY-MM-DD" calendario CR, inclusivo
  readonly hastaFecha: string; // "YYYY-MM-DD" calendario CR, INCLUSIVO para el consumidor
}

export type EntradaRango =
  | { readonly preset: "dia" | "semana" | "mes" }
  | { readonly preset: "personalizado"; readonly desde: string; readonly hasta: string };

export function resolverRango(entrada: EntradaRango, now?: Date): RangoResuelto;
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

### 4.3 Semántica de cada preset — **dos convenciones conviviendo A PROPÓSITO**

Cerrado por D2, D3 y D4 el 2026-07-30. Esta tabla es el punto de la feature que más
probablemente alguien intente "homogeneizar" creyendo que corrige una inconsistencia. **No lo
es.** Está escrito aquí para que ese cambio requiera una decisión humana nueva, no un refactor.

| preset | anclaje | `desdeFecha` | `hastaFecha` | decisión |
|---|---|---|---|---|
| `dia` | día CR de `now` | fecha CR de `now` | fecha CR de `now` | R15 (ya existente) |
| `semana` | **borde de CALENDARIO**: lunes | lunes de la semana CR de `now` | fecha CR de `now` | **D2** (lunes) + supuesto "en curso" |
| `mes` | **ventana MÓVIL**: 30 días | fecha CR de `now` − 29 días | fecha CR de `now` | **D3** («últimos 30»), NO mes calendario |
| `personalizado` | ninguno: lo fija el cliente | `desde` (`YYYY-MM-DD`) | `hasta` (`YYYY-MM-DD`) | **D4**, tope `RANGO_TOPE_DIAS = 366` |

- **La tensión, dicha con todas las letras:** `semana` **sí** tiene borde de calendario (empieza
  lunes, D2) mientras `mes` **no** lo tiene (es móvil de 30 días, D3). Son **dos convenciones
  distintas conviviendo a propósito**, y cuál se aplica a cada preset está escrito aquí y en
  `requirements.md > D3`. Consecuencia visible y aceptada: `semana` dura entre 1 y 7 días según
  el día en que se consulte, mientras `mes` dura **siempre** 30.
- **⚠ Supuesto del spec_author, NO decisión del humano:** los tres presets son el **período EN
  CURSO hasta ahora** (`hasta = inicioDelDiaSiguienteCREnUtc(fecha CR de now)`), no el último
  período completo. La segunda mitad de Q3 no se respondió. Si el humano lo contradice, cambian
  R15/R27/R28 y sus tests, y nada más del contrato.
- **Tope de 366 días (D4):** es la **recomendación no objetada** del spec_author, no una cifra
  pronunciada por el humano. Vive en una constante única (`RANGO_TOPE_DIAS`) para que ajustarla
  sea un one-liner con su test, no una cacería de literales.
- Los invariantes de R16 (frontera de día CR, duración entera en días, determinismo,
  independencia del `TZ`) valen para **los cuatro**; el invariante «la ventana contiene a `now`»
  solo se exige a los tres presets: un `personalizado` puede ser íntegramente pasado.

## 5. Contrato: filtros (zod)

```ts
const idList = z.array(z.string().min(1)).nonempty();   // patrón feature 144/R32

const fechaCalendario = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);   // ancho fijo (R22)

export const analiticaFiltroSchema = z
  .object({
    rango: z.enum(RANGO_PRESETS),          // dia|semana|mes|personalizado, obligatorio (R20)
    desde: fechaCalendario.optional(),     // D4/R29: solo con rango "personalizado"
    hasta: fechaCalendario.optional(),
    zona_id: idList.optional(),
    tienda_id: idList.optional(),
    mensajero_id: idList.optional(),
  })
  .strict()                                // rechaza claves desconocidas (R19/R24)
  // D4/R29 — los tres refine del rango arbitrario:
  .refine(v => v.rango !== "personalizado" || (v.desde && v.hasta), { path: ["desde"] })
  .refine(v => v.rango === "personalizado" || (!v.desde && !v.hasta), { path: ["desde"] })
  .refine(v => !v.desde || !v.hasta || v.desde <= v.hasta, { path: ["hasta"] })
  .refine(v => diasInclusive(v.desde, v.hasta) <= RANGO_TOPE_DIAS, { path: ["hasta"] });

export type AnaliticaFiltroInput = z.infer<typeof analiticaFiltroSchema>;
export function parseAnaliticaFiltro(raw: unknown):
  | { status: "ok"; filtro: AnaliticaFiltroInput }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
```

- **Listas no vacías, nunca escalares.** Copia deliberada de `ordenFilterSchema`
  (`lib/types/orden.ts:98-134`): una lista vacía significaría "ningún valor" y degradaría a
  "sin filtro" si el repositorio la descartara → falla cerrado.
- **El cliente nunca manda instantes** (R22): manda un preset o dos **fechas calendario**
  `YYYY-MM-DD` con regex de ancho fijo; los bordes UTC los calcula `resolverRango` server-side.
  Nunca ISO con hora, offset ni epoch. Espejo del patrón de la 144.
- **`desde`/`hasta` y preset son excluyentes** (D4/R29): mandar `desde` con `rango: "dia"` es un
  `validation_error`, no un silencio. El tope de 366 días se comprueba sobre fechas calendario
  (ambos extremos incluidos), no sobre instantes.
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
| 129–133 UI | `etiqueta`, `unidad`, `unidadDeConteo`, `granos`, `alcance` (qué panel ve cada rol) |
| 134 export CSV | `id` (columna), `etiqueta` (encabezado), `unidad` (formato) |

### 6.1 Lo que heredan de las decisiones del 2026-07-30 (avisos dirigidos)

- **→ 123 (`analytics_daily`), de D5.** El cubo `sin_asignar` obliga a que **`mensajero_id` sea
  NULLABLE en el grano del rollup**. Postgres no considera iguales dos `NULL` en un índice
  único, así que la 123 **debe elegir explícitamente** entre: (i) **índice único parcial** por
  cada combinación de nulidad (`WHERE mensajero_id IS NULL` / `IS NOT NULL`), o (ii) **valor
  centinela** no nulo `'sin_asignar'` en la columna del grano. La 135 no elige por ella, pero no
  lo esconde: si la 123 pone un `UNIQUE` ingenuo sobre el grano, el upsert diario duplicará
  filas de mensajero no asignado. También hereda de D9 que la columna de zona es
  `orden.zona_id` congelada, y del hecho de inventario 3 que puede aparecer la fila huérfana
  `en_fulfillment` en un `GROUP BY estatus_id`.
- **→ 126 (operativa), de D10.** Las cinco métricas de gestión cuentan **gestiones vigentes**
  (`anulada_at IS NULL`), no órdenes; `ordenes_creadas` y `ordenes_por_estado` cuentan órdenes.
  **No son sumables entre sí** y `sonSumables()` existe para impedirlo. Las tres tasas tienen
  denominador **de gestiones**: la 126 no debe "corregirlas" dividiendo entre órdenes.
- **→ 127 (financiera), de D7.** Sigue calculando la cuenta por pagar de tienda y el devengado
  de mensajero —el cálculo no cambia—, pero **ninguna de esas cifras se expone a `adminTienda`,
  `adminSatelite` ni `mensajero`**: solo a `maestro` y `admin`. No hay vista financiera recortada
  por tienda o por mensajero que construir.
- **→ 132 (tablero financiero), de D7.** El tablero es **de dos roles**: exactamente los que
  `esAccesoTotal(rol)` acepta. No diseñes un tablero financiero "para tienda".
- **→ 133 (recortes por rol), de D7.** `listarMetricas({ rol })` ya devuelve **cero** métricas
  financieras para `adminTienda`, `adminSatelite` y `mensajero`: el recorte de presentación es
  consultar esa función, no reimplementar reglas. Ojo: para esos tres roles el dominio financiera
  no es "vacío por falta de datos", es **prohibido**, y la UI debe no ofrecer la pestaña, no
  mostrarla vacía.
- **→ 122 (alcance por rol), de D7 y D9.** El criterio de "acceso total" es `esAccesoTotal(rol)`
  (`lib/auth/acceso-total.ts`), que la 135 **no duplica**: `maestro ≈ admin` sigue en pie. El
  recorte por zona del `adminSatelite` se aplica sobre `orden.zona_id`, nunca sobre la zona del
  mensajero (D9).
- **→ 124 / 125 (job y backfill), de D3 y D6.** El día que recomputan es el **día natural CR**
  (D6). Ojo con D3: `mes` es una ventana móvil de 30 días, así que un recomputo "del mes" no es
  un rango de calendario; el backfill debe iterar **fechas calendario CR**, no presets.

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

6. **Declarar DOS familias de métricas, una por gestión y otra por orden (`entregas` y
   `entregas_por_orden`).** Era la recomendación del spec_author en Q10; **la descartó el humano
   en D10**: una sola convención, **por gestión**. Motivo aceptado: dos familias duplican 5
   métricas, obligan a la 123 a materializar dos medidas por fila y garantizan que algún tablero
   mezcle las dos. El precio, asumido y escrito, es que las cuatro métricas de resultado **no
   suman órdenes** y las tasas son sobre gestiones; se mitiga con `unidadDeConteo` + `sonSumables`
   (R36) en vez de con una segunda familia.

7. **`mes` como mes CALENDARIO (`periodoMensualCR`, feature 45).** Descartada por **D3**
   («últimos 30»). Habría dado comparabilidad entre meses y encaje directo con `periodoMensualCR`,
   pero el primer día del mes el tablero mostraría una barra de un solo día. La ventana móvil de
   30 días siempre compara contra 30 días. El coste asumido es la convivencia de dos convenciones
   (`semana` con borde de calendario, `mes` móvil), documentada en §4.3 para que no se
   "homogenice" por error.

8. **Excluir del todo las órdenes sin mensajero del grano `mensajero`** (opciones (b)/(c) de Q5).
   Descartada por **D5**: excluirlas haría que la suma por mensajero no cuadrara con el total y
   que el trabajo pendiente de asignar fuera invisible justo en el tablero que existe para
   verlo. El coste asumido es el `NULL` en el grano del rollup y el índice único que la 123
   tendrá que resolver (§6.1).

9. **Replicar en analítica la ventana 18:00–18:00 CR del `RankingService`** para que las dos
   pantallas cuadren desde el día uno. Descartada por **D6**: sería propagar el bug a un módulo
   nuevo y a un rollup persistido (que luego habría que backfillear). Se acepta a cambio una
   divergencia temporal y visible entre analítica y ranking hasta que el ticket de saneamiento
   se cierre.

10. **Declarar el alcance por rol como un simple `roles: RolAnalitica[]` (lista de quién ve
   qué).** Descartada: perdería la distinción entre "ve todo" y "ve lo suyo", que es
   precisamente lo que la 133 necesita para pintar el panel correcto y lo que hace explícito que
   `adminTienda` **sí** ve `tasa_entrega`, pero solo la de su tienda. La `Record` exhaustiva
   además obliga por tipos a pronunciarse sobre los 5 roles en cada métrica nueva (R7), en vez
   de olvidarse de uno en silencio.

## 8. Riesgos

- ~~**Q1 sin responder = catálogo especulativo.**~~ **Cerrado por D1 (2026-07-30): «todas».**
  §3.3 es contrato; el riesgo residual es que el conteo citado en la respuesta («13 y 6») no
  coincida con la tabla (15 ids + 8 ids) — reconciliado en `requirements.md > D1` a favor de
  «ENTERO», sin recortar nada.
- **Supuesto vivo: "período en curso" (D3, segunda mitad no respondida).** Si el humano quería
  "último período completo", los tres presets cambian de borde. Impacto acotado: R15/R27/R28 y
  sus tests; el resto del contrato no se mueve.
- **Divergencia analítica ↔ ranking (D6), aceptada.** Mientras el ticket de `RankingService` no
  se cierre, "hoy" vale cosas distintas en dos pantallas. Riesgo de que se reporte como bug: se
  mitiga dejándolo escrito en el módulo, en el spec y en `progress/impl_135.md`.
- **Índice único del rollup con `mensajero_id` NULL (D5).** Riesgo heredado por la 123; ver
  §6.1. Si se ignora, produce filas duplicadas en el upsert diario.
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
