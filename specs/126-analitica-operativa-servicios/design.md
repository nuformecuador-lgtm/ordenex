# Feature 126 — analítica: servicios operativos · design

> Backend puro: repositorios + servicios + Server Actions. Sin UI (la cablea la 131), sin
> tablas nuevas, sin dinero (eso es la 127).
>
> **Puerta T0 CERRADA el 2026-08-02.** Las cinco respuestas están en
> `requirements.md > Decisiones del humano (2026-08-02)` y **mandan sobre cualquier redacción
> anterior de este archivo**. D6, D9 y D12 dejan de ser condicionales; **D13 y D14** nacen de
> esas respuestas. No queda ningún ⚠.

## 1. Frontera de archivos con la 127 — vinculante

La regla 1 del arnés (`CLAUDE.md`) permite dos features `in_progress` en la zona `backend`
**solo si no hay conflicto de archivos**. La 126 y la 127 están vivas a la vez, así que este
reparto es parte del contrato de la feature y no una guía de estilo.

| Dueña | Archivos |
|---|---|
| **126** | `lib/actions/analitica-operativa.ts`, `lib/services/AnaliticaOperativaService.ts`, `lib/repositories/AnaliticaOperativaRollupRepository.ts`, `lib/repositories/AnaliticaOperativaVivaRepository.ts`, `lib/interfaces/services/IAnaliticaOperativaService.ts`, `lib/interfaces/repositories/IAnaliticaOperativa*.ts`, `lib/types/analitica-operativa.ts`, sus tests `tests/**/operativa-*` y `analitica-operativa-*` |
| **127** | `lib/analytics/metrics.ts`, `lib/services/AnaliticaFinancieraService.ts`, `lib/repositories/ConciliacionCierresAnaliticaRepository.ts`, `lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository.ts`, `tests/unit/analytics/_fake-prisma-dinero.ts`, guardias `financiera-*` |
| **prohibido a las dos** | `lib/actions/analitica.ts` — nombre genérico: las dos escribirían en él |

**Archivos de terceros que la 126 sí toca, y por qué no chocan con la 127** (verificado: la
127 no los necesita, ninguna métrica financiera lee el rollup ni tiene alcance `acotado`):

- `lib/analytics/alcance-columnas.ts` (feature 122, mergeada) — corrección de `whereRollup`,
  D3.
- `tests/integration/db/analytics-daily-guards.test.ts` (123/124) — re-alcance del guardia R42,
  D11.
- `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` y
  `tests/unit/analytics/alcance-bordes.guardia.test.ts` (122) — deudas (a) y (b), D11.

**Choque declarado y RESUELTO por T0-Q3 (2026-08-02):** la 126 **necesitaría** editar
`lib/analytics/metrics.ts` (archivo de la 127) por tres motivos concretos —`estadoProduccion`
de `incidentes`, la divergencia B2 de `ordenes_por_estado` y la semántica de `sin_gestionar`
(D14)—. El humano decidió **(C)**: ficha propia de corrección del catálogo = **feature 175**,
después de que aterricen la 126 y la 127. La 126 **no escribe una línea** en ese archivo (R3);
las tres divergencias quedan declaradas en §9 y se repiten en `progress/impl_126.md`.

## 2. Lo que la 126 hace y lo que no

| Hace | No hace | Quién lo hace |
|---|---|---|
| Leer `analytics_daily` y proyectar las 14 métricas operativas `snapshot` | Escribir el rollup | 124 (job) / 125 (backfill) |
| Servir `aging_por_estado` desde tablas vivas | Definir métricas nuevas | 135 (catálogo) |
| Aplicar el borde auditar→403→seudonimizar | Resolver el alcance | 122 (`prepararConsultaAnalitica`) |
| Devolver un contrato serializable a la UI | Pintar, cachear, exportar | 131/133, 128, 134 |

## 3. Decisiones

### D1 — Dos repositorios, no uno

`AnaliticaOperativaRollupRepository` (lee `analytics_daily`) y
`AnaliticaOperativaVivaRepository` (lee `orden` + `orden_historial_estado`). Motivo: son dos
fuentes con dos contratos de guardia distintos —la primera está bajo el tripwire R42 de la 124,
la segunda bajo el censo R18 de la 122— y mezclarlas en un archivo obliga a que cada guardia
razone sobre medio archivo. Además `clase: "snapshot" ⇔ fuente rollup` es un invariante del
catálogo (R5 de la 135): un repositorio por clase lo hace estructural.

### D2 — El servicio recibe `ConsultaAnalitica` y **solo** eso

Firma canónica: `consultar(consulta: ConsultaAnalitica): Promise<ResultadoOperativo>`. Ninguna
firma acepta `AnaliticaFiltroInput` ni `AlcanceDatos` sueltos (aviso dirigido de la 122: «si
una firma necesita el filtro suelto, el recorte se está perdiendo»). El servicio **no** conoce
`cookies()`, `NextResponse` ni Prisma; recibe los dos repositorios y el reloj por constructor.

### D3 — Se corrige `whereRollup` y se le pone tipo real

`lib/analytics/alcance-columnas.ts:75-86` devuelve hoy `{ mensajeroAsignadoId }` para recortar
`analytics_daily`, cuya columna se llama `mensajeroId` (`db/schema.prisma:1863`). Como el
retorno está tipado `Record<string, string>`, el compilador no lo ve. Cuando la 122 lo escribió
la tabla **no existía**, y su propio comentario lo dice; ahora existe:

```ts
export function whereRollup(alcance: AlcanceDatos): Prisma.AnalyticsDailyWhereInput {
  switch (alcance.tipo) {
    case "global":    return {};
    case "zona":      return { zonaId: alcance.zonaId };
    case "tienda":    return { tiendaId: alcance.tiendaId };
    case "mensajero": return { mensajeroId: alcance.mensajeroId };
  }
}
```

Con el tipo real, la clave equivocada **deja de compilar**: la corrección no depende de que
nadie la revierta. Es el único cambio que la 126 hace en un archivo de la 122 fuera de los
guardias.

### D4 — Una agregación por grano, no una por métrica (R26)

Las 13 métricas de rollup del mismo grano se sirven con **un** `groupBy` sobre
`analytics_daily` que trae las 10 medidas; el servicio proyecta cada métrica desde ese
resultado. Las tres tasas y `primer_intento_ok` son **razones derivadas en el servicio** a
partir de medidas de la misma fila agregada: no viajan como columnas propias y no se
promedian.

### D5 — Agregación: sumar antes de dividir, siempre

- Tasas: `Σ numerador / Σ DENOMINADOR_GESTIONES` sobre los cubos del recorte. Denominador
  0 ⇒ `null` (R10). Nunca media de tasas por fila.
- `tiempo_ciclo`: `Σ seg_ciclo_acum / Σ seg_ciclo_n`, con `seg_ciclo_acum` convertido de
  `BigInt` a `number` **solo después** de la división (la respuesta no puede llevar `BigInt`:
  `JSON.stringify` lanza, ver `IAnaliticaRollupService.ts:8-11`).
- `ordenes_estado_stock`: **no se suma jamás** entre fechas (R12). Se devuelve como serie por
  fecha. Aunque bajo B2 se comporte de hecho como un flujo para los tres estatus terminales
  (`specs/124-.../design.md §4.3`), esa coincidencia **no se explota**.

### D6 — Intradía en vivo, marcado `parcial` *(T0-Q1 = B, 2026-08-02)*

El día en curso no está en el rollup **por construcción** (el job de la 124 corre a las 00:30 CR
sobre el día que cerró). El punto del día abierto se calcula en vivo con la ventana
`[inicioDelDiaCREnUtc(hoy), ahora)` —cotas de `lib/utils/fecha-cr.ts`, nunca `startOfDayCR`— y
viaja con `parcial: true` + `corteAt`. El resto del rango sigue viniendo del rollup: en una
misma serie conviven puntos cerrados y **un** punto parcial, y la diferencia es visible en el
dato, no en una nota (R18).

### D7 — La ventana de tiempo sale de la 135, no se recalcula

`consulta.rango` ya trae `desde`/`hasta` (instantes UTC, semiabiertos) y
`desdeFecha`/`hastaFecha` (fechas calendario CR, inclusivas). El rollup se consulta con las
**fechas** (`analytics_daily.fecha` es `@db.Date`); las tablas vivas con los **instantes**. La
126 **no** importa `startOfDayCR` ni hace aritmética horaria propia: repetiría la ventana
18:00–18:00 de `RankingService` (trampa documentada, D6 de la 135).

### D8 — El estatus se resuelve contra la tabla, no contra el seed

El embudo agrupa por `estatus_id` y resuelve etiqueta y `value` con un `JOIN`/lookup a
`order_status`. **No** se usa un `Record<OrderStatusValue, string>` hardcodeado: la fila
huérfana `en_fulfillment` sobrevive en la tabla, 37 filas de `orden_historial_estado` la
referencian y el rollup congela el estatus **desde el historial**, así que ese id **sale en un
`GROUP BY` real** (hecho confirmado contra la base por la 124). Un mapa cerrado sobre
`ORDER_STATUS_SEED` produciría `undefined` o un `throw` en producción y no en los tests.

### D9 — Cobertura declarada en la respuesta *(T0-Q2 = B, 2026-08-02)*

La respuesta lleva:

```ts
readonly cobertura: {
  readonly fechasNoComparables: readonly string[];  // esNoComparable() de la 125
  readonly penumbra: "ordenes_vivas_al_horizonte_sin_transicion_posterior";
};
```

Se **reusa** `HORIZONTE_HISTORIAL_CR` y `esNoComparable` de `lib/analytics/backfill-rango.ts`
(feature 125, ya mergeada). La 126 no declara una segunda constante de horizonte: sería la
clásica cifra duplicada que un día diverge.

El campo es **obligatorio**, no opcional (R34): un `cobertura?` permitiría a la 131/133
ignorarlo por omisión y la decisión de Q2 no compraría nada.

**Aviso dirigido → 131 (tablero operativo) y 133 (recortes por rol):** este bloque **se pinta**.
La distinción entre «cero» y «no se sabe» solo existe cuando llega al píxel; si el tablero
muestra los ceros del rollup sin la nota de cobertura, un rango que cruza el 2026-07-13 se lee
como una caída de la operación que nunca ocurrió. Mismo trato para el punto `parcial: true` de
D6: el día en curso se distingue visualmente de un día cerrado.

### D10 — Seudonimización: `null` → `MENSAJERO_SIN_ASIGNAR` **antes** de seudonimizar

`seudonimizarMensajeros<T extends { mensajeroId: string }>` (122) exige `string`, y el rollup
da `string | null`. La proyección normaliza `null → MENSAJERO_SIN_ASIGNAR`
(`lib/analytics/types.ts`) y **luego** seudonimiza; `etiquetaDe` ya conserva ese literal tal
cual (no es una persona). El orden importa: normalizar después dejaría un `null` serializado en
el payload.

Aviso heredado que la 126 propaga a la 131/133: las etiquetas `Mensajero 1..N` **no son
estables entre consultas** (por diseño, para impedir la correlación). La UI no debe prometerlo.

### D11 — Los guardias se re-alcanzan; no se aflojan

| Guardia | Estado hoy | Qué hace la 126 |
|---|---|---|
| R42 (124) «nadie LEE `analytics_daily`» | prohíbe toda lectura salvo la reconciliación del job | abre **un** archivo: `AnaliticaOperativaRollupRepository.ts`; el resto del árbol sigue rojo |
| R18 (122) censo `ConsultaAnalitica` | `test(/\bConsultaAnalitica\b/)`: un `as ConsultaAnalitica` pasa | añade el censo del **forjador** (`as` / `as unknown as`) |
| `alcance-bordes.guardia.test.ts` (122) | solo bordes sintéticos | añade el censo de `app/` y `lib/actions/` |

Aflojar un guardia (borrar el caso, permitir un directorio entero) es motivo de rechazo del
reviewer: la prohibición de R42 «es tuya de levantar, con su mutación, no de aflojar de paso».

**Cuánto se abre exactamente el guardia R42, y por qué esa cantidad.** Hoy
`tests/integration/db/analytics-daily-guards.test.ts` sostiene tres prohibiciones distintas:
(a) **nombrar** la tabla, (b) **acceder** a ella, (c) **leerla**. La 126 abre **solo (c) y solo
para un archivo**:

| Prohibición | Antes (124) | Después (126) |
|---|---|---|
| nombrar `analytics_daily` | módulos declarados del escritor + `types.ts`/`metrics.ts` | **+ 1**: `AnaliticaOperativaRollupRepository.ts` |
| acceder a la tabla | solo `AnaliticaRollupRepository` | **+ 1**: el mismo archivo |
| **leer** la tabla | nadie, salvo la reconciliación y el barrido de rancias del propio job, en métodos con **nombre fijo** | **+ 1 archivo**, y dentro de él **solo** los dos métodos de `IAnaliticaOperativaRollupRepository` (`agregarCubos`, `etiquetasDeEstatus`), también por nombre |
| **escribir** la tabla | solo el escritor de la 124 | **sin cambios**: la 126 sigue siendo rojo si escribe (R2) |

La apertura es **por archivo y por nombre de método**, no por directorio ni por patrón: leer el
rollup desde el servicio, desde la acción o desde un componente sigue poniendo el guardia rojo,
y esa es la mutación de R27. D13 no amplía esta apertura: el intradía lee `orden` /
`gestion_orden` / `orden_historial_estado`, no el rollup.

### D12 — Cierre del oráculo por `mensajero_id` *(T0-Q5 = A, 2026-08-02)*

Con `politicaIdentidad === "seudonima"`, un filtro que nombre `mensajero_id` se responde
`forbidden` + auditoría. Se implementa en el borde de la 126 —**no** en
`lib/analytics/consulta.ts`, que es de la 122 y ya está mergeado— y vive en un **helper
exportado único** (R36):

```ts
// lib/actions/analitica-operativa.ts (o un módulo hermano de bordes)
export function sondeaIdentidadDeMensajero(
  filtro: AnaliticaFiltroInput,
  politica: PoliticaIdentidad,
): boolean;
```

La **134** (export CSV) consume este mismo predicado; duplicarlo allí sería reabrir el oráculo
por la puerta del CSV. Lo que el `adminTienda` pierde es el **filtro** por mensajero; conserva
íntegra la desagregación seudónima que D5 de la 122 le concedió (R24, mutación (b)).

### D13 — El intradía declara consultas propias; NO reusa el repositorio de la 124

**Decidido leyendo el código, no por preferencia.** `AnaliticaRollupRepository` expone sus seis
consultas como plantillas `$queryRaw` cerradas sobre `VentanaDia`
(`lib/repositories/AnaliticaRollupRepository.ts:153,178,212,254,287,331`): **no hay costura por
donde inyectar un `where`**. «Reusarlo» significaría, literalmente, agregar la operación
completa de la compañía y filtrar el resultado en memoria por las coordenadas devueltas.

Consecuencias medidas de esa vía, y por eso descartada:

- un request de un `adminTienda` con una sola tienda dispararía el `GROUP BY` de **todas** las
  zonas, tiendas y mensajeros del día, más `listarEntregasVigentes` + `contarIntentosEnLote`
  (feature 160) sobre **todas** las entregas del día, para tirar casi todo;
- el coste no depende del tamaño del inquilino sino del de la compañía, así que crece con el
  negocio en la ruta más caliente del tablero;
- y el recorte quedaría en el servicio, en memoria, justo lo que R18 de la 122 existe para
  impedir (el `where` es la frontera multi-tenant; filtrar después es una capa más de la que
  fiarse).

**Lo que se hace:** `AnaliticaOperativaVivaRepository` declara consultas propias que reciben
`ConsultaAnalitica` y empujan el alcance al `WHERE` (índice de D4/§4).

**Alternativa descartada** (la de arriba): reuso de `IAnaliticaRollupRepository` con recorte en
memoria. Ganaba «cero divergencia de definiciones» y perdía el recorte en la base.

**Precio asumido y su contención:** hay **dos** implementaciones de las mismas definiciones (la
del job y la intradía). Se contiene con **R33**, un test de equivalencia sobre una fecha ya
cerrada: el camino intradía con `corteAt` = corte de ese día debe reproducir **cubo a cubo y
medida a medida** las filas que el job escribió. Sin ese test la decisión no sería aceptable.

### D14 — `sin_gestionar` se deriva del embudo, y su semántica se dice *(T0-Q4 = A, 2026-08-02)*

`sin_gestionar` está en el catálogo como `snapshot`/`rollup` (`lib/analytics/metrics.ts:232-247`)
pero **`analytics_daily` no tiene esa columna** (`db/schema.prisma:1867-1876`). Se sirve
proyectando `ordenes_estado_stock` sobre el estatus `sin_gestionar`. Sin migración, sin tocar el
job de la 124, sin re-backfill.

**La semántica se declara en el contrato, con todas las letras (R35):** es **«sin gestionar
HOY»** —universo **B2** de la 124: órdenes vivas en ese estado al corte, más las que llegaron a
terminal ese día— y **no** «sin gestionar acumuladas». Nada en el nombre de la métrica impide la
lectura acumulada, y son dos números muy distintos. Como es una proyección del stock, **no se
suma entre fechas** (R12).

**Frontera:** esta declaración debería estar **también** en el catálogo, y el catálogo es de la
127 → queda anotada para la **ficha 175** (§9), no se escribe aquí.

## 4. Modelo de datos

**Ninguna tabla nueva. Ninguna columna nueva. Ninguna política RLS nueva** — `analytics_daily`
ya tiene RLS habilitada sin policies (solo service-role, patrón `gestion_orden`), y la 126 lee
con el mismo cliente de servicio.

**Único cambio de esquema** (T0-Q1 = B, R25 — en alcance firme): índices para la ruta caliente
intradía.

| Índice | Tabla | Por qué |
|---|---|---|
| `(created_at)` o `(created_at, anulada_at)` | `gestion_orden` | **verificado:** hoy solo hay `ordenId`, `mensajeroId`, `cierreId`, `anuladaPor` (`db/schema.prisma:736-739`). El job nocturno tolera el escaneo; una ruta por-request no |
| — | `orden_historial_estado` | **no hace falta**: `@@index([ordenId, createdAt])` (`:1423`) ya cubre el `DISTINCT ON (orden_id) … ORDER BY created_at DESC` del aging |
| — | `orden` | **no hace falta**: hay índices por `zonaId`, `tiendaId`, `estatusId`, `mensajeroAsignadoId`, `createdAt` (`:555-566`) |

Migración con `migration.sql` **y** `down.sql` (obligatorio, `docs/architecture.md §Migraciones`),
verificada con `pnpm run db:rollback`.

## 5. Contratos

### 5.1 Interfaces (`lib/interfaces/`)

```ts
// IAnaliticaOperativaRollupRepository.ts
export interface CuboRollup {
  readonly fecha: string;              // YYYY-MM-DD calendario CR
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string | null; // NULL = cubo sin asignar (D10)
  readonly estatusId: string;
  readonly causaDevolucion: GestionCausaDevolucion | null;
  readonly ordenesCreadas: number;
  readonly ordenesEstadoStock: number;
  readonly entregas: number;
  readonly devoluciones: number;
  readonly rechazos: number;
  readonly reprogramaciones: number;
  readonly incidentes: number;
  readonly primerIntentoOk: number;
  readonly segCicloAcum: bigint;
  readonly segCicloN: number;
}

export interface IAnaliticaOperativaRollupRepository {
  /** UNA agregación para todas las métricas del grano pedido (D4). */
  agregarCubos(consulta: ConsultaAnalitica, granos: readonly DimensionAnalitica[]): Promise<CuboRollup[]>;
  /** Etiquetas de los estatus que aparecieron, resueltas contra `order_status` (D8). */
  etiquetasDeEstatus(ids: readonly string[]): Promise<ReadonlyMap<string, { value: string; label: string }>>;
}
```

```ts
// IAnaliticaOperativaVivaRepository.ts
export interface IAnaliticaOperativaVivaRepository {
  /** `aging_por_estado`: antigüedad en el estado ACTUAL de las órdenes vivas. */
  agingPorEstado(consulta: ConsultaAnalitica): Promise<AgingPorEstadoFila[]>;
  /**
   * Cubos del día en curso (D6/D13): MISMAS definiciones que la 124, consultas PROPIAS con el
   * alcance empujado al `WHERE`. Obligatorio, no opcional: la equivalencia con el rollup se
   * verifica en R33.
   */
  cubosDelDiaEnCurso(consulta: ConsultaAnalitica, corteAt: Date): Promise<CuboRollup[]>;
}
```

### 5.2 Salida (`lib/types/analitica-operativa.ts`)

```ts
export type ResultadoOperativo =
  | { status: "ok"; datos: SerieOperativa }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }        // sin motivo hacia el cliente (el motivo va al log, R5)
  | { status: "unauthenticated" };

export interface SerieOperativa {
  readonly metricaId: string;
  readonly unidad: MetricaUnidad;
  readonly unidadDeConteo: UnidadDeConteo;   // del catálogo, nunca a mano (R9)
  readonly rango: RangoResuelto;
  readonly puntos: readonly PuntoSerie[];
  readonly cobertura: Cobertura;             // D9 — OBLIGATORIO (R34), nunca `cobertura?`
  /** D14/R35: sólo en `sin_gestionar`. Texto fijo, no comentario de código. */
  readonly nota?: "sin_gestionar_es_del_dia_universo_b2";
}

export interface PuntoSerie {
  readonly fecha: string;                     // YYYY-MM-DD CR
  readonly dimension?: string;                // estatus / causa / mensajero (ya seudonimizado)
  readonly valor: number | null;              // null = indefinido (denominador 0), NUNCA 0
  readonly parcial?: true;                    // día en curso (D6)
  readonly corteAt?: string;                  // ISO, solo si parcial
}
```

`valor: null` frente a `0` es deliberado y es la misma distinción que Q2 pide para el rango:
«no se sabe» y «cero» no pueden ser el mismo píxel.

### 5.3 Server Actions (`lib/actions/analitica-operativa.ts`)

`'use server'`. Una acción por familia de consulta, todas con la misma forma:

1. `resolveActorFromSession()` (`lib/auth/resolve-actor.ts`) → `ActorAnalitica`
   (`usuarioId`, `rol`, `zonaId`).
2. `prepararConsultaAnalitica(raw, actor, metricaId, now)`.
3. `forbidden` → `logger.logError(describirDenegado({...}))` **y luego** devolver
   `{status:"forbidden"}` (R5, trampa de `normalizeError` documentada).
4. `ok` → servicio → proyección → seudonimización si procede (R7) → resultado.

No hay ruta `app/api/` para nada de esto (R1, `docs/architecture.md`: mutaciones y lecturas
internas van por Server Actions).

## 6. Verificación

- **Unit** (`tests/unit/**`): servicio con repositorios mockeados (tasas, ciclo, sumabilidad,
  seudonimización, sin_asignar, estatus huérfano, determinismo, errores).
- **Integración** (`tests/integration/**`): la Server Action completa (auditoría→403,
  validación sin tocar la base), el `EXPLAIN` de la consulta intradía (R25) y la
  **equivalencia intradía↔rollup** sobre una fecha cerrada (R33).
- **Guardias**: frontera 127, solo-lectura, fuente por clase de métrica, sumabilidad, más los
  tres re-alcanzados de D11.
- **E2E**: no aplica. La 126 no toca auth, pagos, recaudo, ingesta ni webhooks
  (`CHECKPOINTS.md`); el flujo de pantalla lo cubre la 131.
- Cierre con `./init.sh` en verde.

## 7. Alternativas descartadas

1. **Un solo `lib/actions/analitica.ts` compartido con la 127.** Descartada por la regla 1 del
   arnés: las dos features son backend y están vivas a la vez; un archivo compartido garantiza
   conflicto de merge en el punto más caliente de las dos. Nombres separados por dominio.

2. **Vistas materializadas de Postgres en vez de proyectar en el servicio.** Descartada: cada
   recorte por rol produciría una vista distinta o una vista sin recorte que habría que filtrar
   igual; y una vista materializada añade un segundo calendario de refresco al que ya tiene el
   job de la 124, con dos fuentes de "cuándo se actualizó esto". El rollup **ya es** la
   materialización de este sistema.

3. **Recalcular las métricas operativas desde `orden`/`gestion_orden` en cada request e ignorar
   el rollup.** Descartada: es exactamente lo que las features 123–125 existen para evitar
   (`GROUP BY` por request sobre tablas que crecen sin techo), y produciría una **segunda
   verdad** que divergiría de la del job en cuanto una definición cambiara en un solo sitio.

4. **Servir las tasas como columnas materializadas en el rollup.** Descartada: una tasa no es
   aditiva. Materializarla obligaría a promediar promedios al agregar cubos, que es el error
   que D5 prohíbe explícitamente. Numerador y denominador viajan; la división es lo último.

5. **Corregir `whereRollup` "por dentro" dejando el tipo `Record<string,string>`.** Descartada:
   arregla el síntoma y deja el mecanismo que lo produjo. El defecto existió porque el tipo laxo
   impedía al compilador ver el nombre equivocado; con `Prisma.AnalyticsDailyWhereInput` la
   regresión **no compila** (D3).

6. **Dos familias de métricas (por gestión y por orden) para que las cuatro de resultado sumen
   órdenes.** Descartada aguas arriba por **D10 de la 135**: una sola convención, por gestión.
   La 126 no la reabre; su papel es no "corregir" las tasas dividiendo entre órdenes.

7. **Tolerar `en_fulfillment` filtrándolo del embudo.** Descartada: ocultarlo haría que la suma
   del embudo no cuadrase con el total del rollup sin ninguna señal, que es peor que mostrar un
   estatus retirado con 0–37 filas de historia. Se muestra con su etiqueta real (D8).

8. **Poner la métrica `sin_gestionar` a producir con una columna nueva en `analytics_daily`.**
   Descartada **por frontera** y confirmado por **T0-Q4 = A**: exigía migración + cambio en el
   job de la 124 + re-backfill de toda la historia con la 125, tres features ajenas. Se deriva
   del embudo (D14) y el precio —hereda la semántica B2, «hoy» y no «acumuladas»— se paga
   escribiéndolo en el contrato (R35), no escondiéndolo.

10. **Reusar `IAnaliticaRollupRepository` para el intradía, recortando en memoria.** Descartada
    en **D13** tras leer el repositorio: sus seis consultas son plantillas `$queryRaw` cerradas
    sobre `VentanaDia`, sin costura para un `where`. Ganaba «una sola implementación de las
    definiciones» y perdía el recorte **en la base**, que es la frontera multi-tenant. Se paga
    la duplicación y se contiene con el test de equivalencia R33.

11. **Cerrar el oráculo de identidad parcheando `recortarFiltro` de la 122.** Descartada por
    **T0-Q5 = A**: es feature ajena ya mergeada; requiere PR y dueño distintos y bloquearía a
    la 126. Se cierra en el borde propio, en un helper único que la 134 consume (D12/R36). El
    coste asumido es que el arreglo es **por consumidor**: si mañana aparece un tercer
    consumidor de analítica, tiene que consumir el helper o reabre el agujero.

9. **Cachear con `cacheTag` desde ya.** Descartada: es literalmente la feature **128**, que
   depende de esta. Adelantarla aquí significaría inventar los tags y luego rehacerlos.

## 8. Riesgos declarados

- **Doble implementación de las definiciones operativas (D13).** El job de la 124 y el camino
  intradía calculan lo mismo por caminos distintos. *Dimensionado:* una definición que cambie
  en un solo sitio produce «los números de hoy no cuadran con los de ayer», que es un bug de
  confianza, no de cálculo. *Contención:* R33 (equivalencia sobre una fecha cerrada) es
  **obligatorio**, no opcional; si ese test no existe, la decisión D13 no se sostiene.
- **Coste del intradía en la ruta caliente.** Aunque D13 descarta el recorte en memoria, el
  camino intradía sigue haciendo un `GROUP BY` por request sobre `gestion_orden` acotado por
  ventana y alcance. *Dimensionado:* aceptable **porque** el índice de R25 existe y el recorte
  va en el `WHERE`; sin cualquiera de las dos cosas, el coste vuelve a ser proporcional a la
  compañía y no al inquilino. Es exactamente el escenario que el humano me pidió no enterrar en
  una nota al pie: **si R25 se cae del alcance, el intradía deja de ser viable y hay que volver
  a la opción A de Q1**, no seguir adelante.
- **Sin cifra de volumen medida.** El repo no tiene ninguna (`UMBRAL_AVISO_FILAS_CORRIDA` sigue
  declarado *provisional y no medido*, y la 125 no lo sustituyó: R34 de la 125 se retiró a la
  ficha 174). La 126 **no inventa una**: la caché es la 128 y las mediciones, la 174.
- **Guardia de frontera con la 127 (R3) es branch-scoped**: mide el diff contra `dev` y caduca
  al mergear (memoria del proyecto). Su retirada se decide en el propio PR, no después (T13).
- **La penumbra no caduca**: el histórico anterior al 2026-07-13 nunca será completo. Cualquier
  comparación interanual futura arrastra este agujero (R20 lo declara; nadie lo rellena).

## 9. Divergencias del catálogo heredadas a la ficha 175

> **CERRADAS por la 175 el 2026-08-03.** Las tres se corrigieron en
> `lib/analytics/metrics.ts` y quedaron con guardia anti-regresión:
> 1 → `incidentes.estadoProduccion = "producida"` (decisión humana fechada ⟨D11⟩,
> `progress/decision_175.md`), vigilada por `tests/unit/analytics/catalogo-produccion.guardia.test.ts`;
> 2 → `ordenes_por_estado.definicion.universo = "b2_vivas_mas_cierres_del_dia"` y descripción
> reescrita, vigiladas por `tests/unit/analytics/catalogo-universo.guardia.test.ts`;
> 3 → `sin_gestionar` gana `derivadaDe: "ordenes_por_estado"` + `universo`, pasa a `"producida"`
> (⟨D11⟩) y su descripción dice «HOY», vigilado por las dos guardias.
> El riesgo dimensionado hacia la **133** (ocultar un KPI vivo) queda **neutralizado** para estas
> dos métricas. La lección se mantiene: `estadoProduccion` dice si hay productor, **no** si el panel
> se pinta.

T0-Q3 = (C): la 126 **no toca** `lib/analytics/metrics.ts`. Estas tres quedan vivas mientras
tanto, y se repiten en `progress/impl_126.md`:

1. **`incidentes` dice `estadoProduccion: "declarada"`** (`lib/analytics/metrics.ts:220`) pero
   tiene columna en el rollup (`db/schema.prisma:1873`) y la 126 está **obligada** a leerla: es
   el cuarto término de `DENOMINADOR_GESTIONES` de las tres tasas.
   **Riesgo transitorio dimensionado:** la **133** decide qué paneles pinta a partir de
   `estadoProduccion`; hasta que aterrice la 175 puede **ocultar el panel de `incidentes`**
   creyéndolo sin productor, cuando la 126 lo sirve con datos reales. No es cosmético: es un KPI
   que desaparece del tablero sin que nada falle.
2. **`ordenes_por_estado` declara `definicion.estados = ORDER_STATUS_SEED`** (19 valores,
   terminales incluidos) mientras la columna real contiene el universo **B2**
   (`specs/124-analitica-job-agregacion-diaria/design.md §4.3`). La 126 es quien la sirve a la
   UI, así que la divergencia se vuelve **visible al usuario final** aquí.
3. **`sin_gestionar` no tiene columna en el rollup** y la 126 la deriva del embudo con semántica
   «hoy» (D14/R35). El catálogo no lo dice; debería.
