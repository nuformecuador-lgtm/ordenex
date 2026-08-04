# 176 — analitica: modo agregado de tasas y tiempos · design

> **Puerta T0 CERRADA.** Las seis decisiones (`D1`–`D6`) estan tomadas por el humano y viven en
> `requirements.md §4`. Este diseno ya no propone opciones: implementa lo decidido. Donde antes
> habia una recomendacion condicionada, ahora hay una alternativa **descartada** con su motivo.

## 1. Frontera: los archivos que esta feature toca

Lista **cerrada**. El guardia de R18 la hace cumplir.

### 1.1 Modifica

| Archivo | Que se le hace |
|---|---|
| `lib/types/analitica-operativa.ts` | **Anade** `CuboAgregado`, `AgregadoOperativo`, `ResultadoAgregado`, `GranoAgregado`. **No toca** `PuntoSerie`, `SerieOperativa`, `Cobertura`, `ResultadoOperativo` |
| `lib/interfaces/services/IAnaliticaOperativaService.ts` | **Anade** `consultarAgregado(...)` a la interfaz. No cambia la firma de `consultar` |
| `lib/services/AnaliticaOperativaService.ts` | **Anade** `consultarAgregado` y sus privados. No cambia el comportamiento de `consultar` |
| `lib/actions/analitica-operativa.ts` | **Anade** la Server Action `consultarAgregadoOperativo`, con los MISMOS cuatro pasos. No cambia `consultarAnaliticaOperativa` |

### 1.2 Crea

`tests/unit/analytics/agregado-contrato.test.ts`, `agregado-tasas.test.ts`,
`agregado-tiempo-ciclo.test.ts`, `agregado-coherencia.test.ts`, `agregado-cobertura.test.ts`,
`agregado-dia-en-curso.test.ts`, `agregado-aging.test.ts`, `agregado-metricas-admitidas.test.ts`,
`agregado-identidad.test.ts`, `agregado-action.test.ts`,
`agregado-alcance.guardia.test.ts` (**perenne**), `agregado-frontera.guardia.test.ts` (**caduca**),
`specs/176-analitica-modo-agregado-tasas/**`, `progress/impl_176.md`.

### 1.3 NO toca — y por que importa

- **`lib/analytics/metrics.ts`** — es de la 127 y sus divergencias las corrige la **175**, que se
  esta implementando en paralelo. La ficha de la 176 dice ademas «no anade metricas al catalogo».
  El agregado **lee** el catalogo a traves de `consulta.metrica` y no escribe en el.
  *Divergencia observada y NO corregida desde aqui, declarada para la 175:* `incidentes`
  (`lib/analytics/metrics.ts:220`) y `sin_gestionar` (`:242`) estan marcadas
  `estadoProduccion: "declarada"` pese a tener columna en `analytics_daily` y ser servidas por la
  126. No afecta a esta feature (ninguna de las dos es `porcentaje` ni `segundos`).
- **`lib/analytics/consulta.ts`, `alcance.ts`, `filters.ts`, `ranges.ts`, `identidad.ts`** — se
  **reusan**, no se tocan. `ConsultaAnalitica` es opaca (marca `unique symbol` no exportada) y esta
  feature no fabrica ninguna: la recibe de `prepararConsultaAnalitica`.
- **`lib/repositories/*` e `lib/interfaces/repositories/*`** — cero metodos nuevos (R17).
- **`lib/cache/**`, `CachedAnaliticaOperativaRollupRepository.ts`** — cero cambios (§4).
- **`db/schema.prisma`, `db/migrations/**`** — **cero migraciones**. No hay tabla nueva, luego no
  hay RLS nueva ni `down.sql` que escribir; los checkpoints de datos aplican por vacio.
- **`app/**`** — el cableado del tablero es de otra ficha, por **D5**: la redacta
  `requirements.md §5` y la da de alta el humano.

## 2. Modelo de datos

**Ninguno nuevo.** Todo sale de `analytics_daily` (`db/schema.prisma:1876-1916`) y de las tablas
vivas, por los repositorios que ya existen. Las diez medidas del rollup son **aditivas por
diseno** (comentario `:1871`: «solo componentes ADITIVOS (R17). Ninguna tasa, promedio ni
porcentaje guardado»), que es justamente lo que hace posible esta feature sin migrar nada.

Nota de precision: `segCicloAcum` es `BigInt` en base y viaja `bigint` hasta el servicio. La
conversion a `number` ocurre **una vez, al construir el cubo de salida**, igual que hoy en
`valorDe` (`AnaliticaOperativaService.ts:407`). El rango util de `number` (2^53 segundos ≈ 2,8·10^8
anos) esta muchisimos ordenes de magnitud por encima de cualquier suma real de segundos de ciclo de
un ano de operacion; se declara aqui en vez de dejarlo implicito.

## 3. Contrato de salida

En `lib/types/analitica-operativa.ts`, **junto** a los tipos de la 126 y sin tocarlos.

```ts
/** Cubo temporal del modo agregado: los componentes ANTES de dividir. */
export interface CuboAgregado {
  /** Ancla del cubo, `YYYY-MM-DD` CR: `desdeFecha` del rango si grano `periodo`, lunes ISO si `semana`. */
  readonly fecha: string;
  /** Extremos inclusivos del cubo, `YYYY-MM-DD` CR. Con grano `periodo` son los del rango. */
  readonly desdeFecha: string;
  readonly hastaFecha: string;
  /** Dimension del desglose, YA seudonimizada si la politica lo exige (R15). */
  readonly dimension?: string;
  /** R1/R5 — SIEMPRE `number`, nunca `bigint`, nunca ausente. */
  readonly numerador: number;
  readonly denominador: number;
  /** R4 — `numerador / denominador`, o `null` si `denominador === 0`. Nunca `0` por «no se sabe». */
  readonly valor: number | null;
  /** R10 — el cubo contiene el dia en curso. */
  readonly parcial?: true;
  /** ISO del corte usado. Solo con `parcial: true`. */
  readonly corteAt?: string;
}

export type GranoAgregado = "periodo" | "semana";

export interface AgregadoOperativo {
  readonly metricaId: string;
  readonly unidad: MetricaUnidad;      // "porcentaje" | "segundos" (R12)
  readonly unidadDeConteo: UnidadDeConteo;
  readonly grano: GranoAgregado;
  readonly rango: RangoResuelto;
  readonly cubos: readonly CuboAgregado[];
  /** R9 — OBLIGATORIO. Nunca `cobertura?`. Mismo tipo y mismo calculo que la 126. */
  readonly cobertura: Cobertura;
}

export type ResultadoAgregado =
  | { readonly status: "ok"; readonly datos: AgregadoOperativo }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | { readonly status: "forbidden" }
  | { readonly status: "unauthenticated" };
```

**Por que `numerador`/`denominador` y no `{acum, n}` o `{ok, total}`:** un solo par de nombres para
las cinco metricas evita que el consumidor tenga que ramificar por metrica para leer el payload —
que es exactamente el acoplamiento que la 131 no puede permitirse (importar `metrics.ts` desde un
modulo de cliente esta prohibido, `specs/131-.../requirements.md §6.1`). El **significado** de cada
par lo declara `unidad`: `porcentaje` -> gestiones; `segundos` -> segundos y ordenes.

## 4. Contrato del borde y de servicio

```ts
// lib/interfaces/services/IAnaliticaOperativaService.ts
export interface OpcionesAgregado {
  readonly grano?: GranoAgregado;              // default "periodo"
  readonly desagregacion?: DimensionAnalitica; // misma semantica que en `consultar`
}
consultarAgregado(consulta: ConsultaAnalitica, opciones?: OpcionesAgregado): Promise<AgregadoOperativo>;
```

```ts
// lib/actions/analitica-operativa.ts
export async function consultarAgregadoOperativo(
  entrada: EntradaOperativa & { readonly grano?: GranoAgregado },
  deps: AnaliticaOperativaDeps = {},
): Promise<ResultadoAgregado>;
```

**R13/R14 — el borde no se reescribe, se recorre igual.** Los mismos cuatro pasos del
`consultarAnaliticaOperativa` actual (`lib/actions/analitica-operativa.ts:31-36`): actor →
`prepararConsultaAnalitica` → `forbidden` con `logger.logError(describirDenegado(...))` **antes** de
responder → servicio. Se reusa el `denegar()` privado ya existente, de modo que **no aparece una
segunda forma de responder 403 que alguien pueda olvidar auditar** (motivo escrito en `:135-142`).
La comprobacion del oraculo (`sondeaIdentidadDeMensajero`, `:126-128`) se aplica igual, con el
mismo helper: duplicarlo reabriria el agujero por la puerta del agregado, que es literalmente lo
que `specs/126` advirtio para el CSV de la 134.

**Cache (R17).** La accion cablea `construirServicio(now)` **tal cual esta**. El agregado consume
`rollup.agregarCubos(consulta, granos)` —el mismo metodo que decora la 128
(`CachedAnaliticaOperativaRollupRepository.ts:57-66`)— con los **mismos** `granos`, asi que:
- entra en la cache **sin superficie nueva** y con la **misma clave** (`claveDeConsulta`), de modo
  que serie y agregado de la misma consulta comparten cubos (esto es tambien lo que hace
  estructuralmente cierto R8);
- **no hace falta tocar el codec**: el `bigint` sigue muriendo dentro del decorador y el agregado
  lo recibe ya rehidratado;
- el **dia en curso sigue fuera de la cache por construccion**, porque llega del repositorio vivo,
  que nadie decora (`CachedAnaliticaOperativaRollupRepository.ts:6-7,12-14`).

## 5. Algoritmo

Se anade un unico paso por encima de lo que ya hace `serieDeRollup`. La 126 hoy:

```
cubos (rollup) + cubos (intradia)  ->  agrupar por (fecha, dimension)  ->  DIVIDIR  ->  PuntoSerie
```

El modo agregado:

```
cubos (rollup) + cubos (intradia)  ->  agrupar por (cuboTemporal, dimension)  ->  DIVIDIR  ->  CuboAgregado
                                                    ^ periodo entero, o lunes ISO
```

Es la **misma** regla del comentario `AnaliticaOperativaService.ts:38-40` («sumar antes de dividir,
siempre») aplicada un nivel mas arriba: aquel parrafo describe la suma de los cubos **dentro de un
dia**; aqui la clave de agrupacion deja de llevar `cubo.fecha` y pasa a llevar el cubo temporal. No
se contradice: se extiende, y se anotara con esa palabra en el propio archivo.

Pasos concretos:

1. **Rechazo temprano (R12).** Si `consulta.metrica.unidad` no es `"porcentaje"` ni `"segundos"`,
   el servicio no consulta nada y la accion responde `validation_error` con
   `{ metricaId: ["el modo agregado solo aplica a metricas de porcentaje o segundos"] }`.
2. **`aging_por_estado` (R11).** Camino propio: `viva.agingPorEstado(consulta, corteAt)`, se funden
   TODAS las filas en un cubo unico (`numerador = Σ segEnEstadoAcum`, `denominador = Σ ordenes`),
   `fecha = desdeFecha = hastaFecha = fechaCalendarioCR(corteAt)`, `parcial: true`, `corteAt`.
   Si se pidio `desagregacion: "estatus"`, un cubo por estatus con la misma aritmetica.
3. **Resto (R2/R3/R6/R7).** Cubos del rollup + cubos intradia (reusando `cubosIntradia`, con su
   completado de `primer_intento_ok`), acumulados en la struct `Medidas` existente por clave
   `(cuboTemporal, dimension)`. Se emite `numerador`/`denominador` segun la metrica y se divide una
   vez con la misma funcion `razon()`.
4. **Parcialidad (R10).** Un cubo hereda `parcial: true` y el `corteAt` **mayor** si al menos uno de
   sus dias componentes venia del camino intradia.
5. **Identidad (R15).** Si `desagregacion === "mensajero"`, se pasa por `seudonimizarMensajeros`
   **antes** de devolver, igual que `seudonimizarPuntos` (`:481-488`).
6. **Cobertura (R9).** Se reusa el privado `cobertura(consulta)` sin modificarlo.

**Denominador por metrica** (una sola tabla, sin formula nueva; los cuatro terminos son los mismos
de `DENOMINADOR_GESTIONES`, `AnaliticaOperativaService.ts:77-82`):

| metrica | numerador | denominador |
|---|---|---|
| `tasa_entrega` | `Σ entregas` | `Σ (entregas+devoluciones+rechazos+incidentes)` |
| `tasa_devolucion` | `Σ devoluciones` | idem |
| `tasa_rechazo` | `Σ rechazos` | idem |
| `primer_intento_ok` | `Σ primerIntentoOk` | `Σ entregas` |
| `tiempo_ciclo` | `Number(Σ segCicloAcum)` | `Σ segCicloN` |
| `aging_por_estado` | `Number(Σ segEnEstadoAcum)` | `Σ ordenes` (al corte) |

**Grano `semana` (D6/R19).** El lunes ISO se calcula en el servicio a partir de la fecha calendario
CR, con la **misma convencion** que el preset `semana` de `lib/analytics/ranges.ts`, y eso se
**afirma con un test** (`agregado-semana.test.ts`), no se confia a la buena voluntad: dos
definiciones de «lunes» en el mismo repo se desincronizan solas y nada avisa.

## 6. Duplicaciones declaradas (deuda con nombre, no accidentes)

1. **`lunesDeLaSemana`** existe en `app/(app)/analitica/_components/operativo/agregacion.ts:80-88`
   (131, cliente). Esta feature no puede importarlo (`lib/` no depende de `app/`) ni moverlo (es
   subarbol de otra feature). Queda **una segunda implementacion**, contenida por el test de
   convencion del §5 (R19). **Se salda en la ficha de D5**: cuando la 131 consuma cubos semanales
   del servidor, **borra** su copia para `porcentaje`/`segundos`. Es deuda **con fecha de
   vencimiento y con dueno**, no una duplicacion que se queda: un calculo duplicado en dos capas se
   desincroniza solo, y el unico que lo evita mientras dure es ese test.
2. **La formula de las tasas** vive ya en `valorDe`. El agregado NO la reimplementa: extrae los
   componentes con las mismas constantes del mismo archivo. R8 es el test que lo ata.

## 7. Alternativas descartadas

- **(A) Campo `agregado?` dentro de `SerieOperativa`** (una sola llamada sirve serie y total).
  **Descartada por D1**: obliga a calcular el agregado en toda consulta —incluida la que solo
  quiere la serie— y cambia el payload que **131 y 132 ya consumen en produccion**, con lo que el
  riesgo de esta feature deja de estar acotado a codigo nuevo. Ademas hace imposible el guardia de
  R18 en su forma fuerte («`PuntoSerie` y `SerieOperativa` no cambian»).
- **(A') Un parametro de modo dentro de `ConsultaAnalitica`.** **Descartada por D1**: obligaria a
  tocar `lib/analytics/consulta.ts`, que es el punto de entrada **blindado** de la 122 —el unico
  sitio por el que pasa el alcance, con su marca `unique symbol` no exportada— y que no es de esta
  feature. Un modo de lectura no tiene por que entrar en el objeto que garantiza el recorte.
- **(B) Un metodo nuevo en el repositorio del rollup** (`agregarPeriodo`) con `GROUP BY` sin
  `fecha`. **Descartada**: (i) el ahorro es nulo, porque el `GROUP BY` que ya existe devuelve los
  componentes y la suma final es aritmetica de decenas de filas en memoria; (ii) seria una
  **segunda entrada a `analytics_daily`**, y el guardia R42 de la 124
  (`tests/integration/db/analytics-daily-guards.test.ts`) sostiene que hay **un solo lector**;
  (iii) **perderia la cache de la 128** o exigiria una clave y un codec nuevos, con el `bigint`
  otra vez expuesto a `JSON.stringify`; (iv) al no llevar `fecha` en el `GROUP BY`, el mismo metodo
  usado por error con `ordenes_estado_stock` sumaria un STOCK entre fechas, que es el fallo
  silencioso que `db/schema.prisma:1886` y R12 de la 126 existen para impedir.
- **(C) Materializar las tasas en `analytics_daily`.** **Descartada de raiz**: el comentario del
  modelo (`:1871`) prohibe guardar tasas o promedios, y una tasa materializada por dia **es** la
  media de medias, solo que persistida.
- **(D) Recomponer la tasa en la UI desde las metricas de conteo.** Es la opcion que la 131 ya
  evaluo y descarto (`specs/131-.../requirements.md §6.1`): duplica una formula de negocio en
  cliente, obliga a importar el catalogo en un modulo de cliente (prohibido) y **para
  `tiempo_ciclo` es imposible**, porque sus componentes no son metricas.

## 8. Los dos guardias, y cual caduca

Van en **archivos distintos a proposito**: si el caduco se retira, no puede llevarse por delante lo
perenne (leccion registrada en la 128, donde hubo que mudar un guardia de archivo por eso).

### 8.1 `tests/unit/analytics/agregado-alcance.guardia.test.ts` — **PERENNE**

Censo estructural, no mide diffs. Sobrevive al merge y debe seguir verde para siempre:
- ninguna firma del modo agregado recibe `AnaliticaFiltroInput`, `AlcanceDatos` ni el rango suelto
  (R13);
- el modo agregado no declara ids de metrica propios: todo id que emite esta en `listarMetricas()`
  (R16);
- `IAnaliticaOperativaRollupRepository` sigue teniendo exactamente **dos** metodos (R17);
- ninguna ruta de `app/api` consume el agregado (misma regla que
  `operativa-frontera.guardia.test.ts`);
- cada assert lleva su caso **discriminante** (un fragmento infractor sintetico que el detector
  debe cazar), para que un detector roto no quede verde por vacio — patron de
  `operativa-solo-lectura.guardia.test.ts:84-92`.

### 8.2 `tests/unit/analytics/agregado-frontera.guardia.test.ts` — **CADUCA EN EL MERGE**

Cabecera obligatoria del archivo, literal:

> **ESTE GUARDIA CADUCA AL MERGEAR A `dev`.** Mide el diff de la rama actual contra `origin/dev` y
> comprueba que no toca ningun archivo fuera de la lista de `design.md §1`. En cuanto la 176 este
> en `dev`, ese diff deja de ser «lo que hizo la 176» y pasa a ser «lo que hace cualquier rama
> posterior»: a partir de ahi el guardia juzga trabajo ajeno y hay que **retirarlo en el PR que lo
> mergea**. Lo que debe sobrevivir es el censo estructural, y por eso vive en
> `agregado-alcance.guardia.test.ts` y **no aqui**: retirar este archivo no puede llevarse por
> delante aquello.

Si el diff no se puede calcular (sin `origin/dev` local), el test **se salta declarandolo**, nunca
pasa en silencio.

## 9. Verificacion

- `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest related --run <archivos>` los ejecuta el
  `backend_dev`; `./init.sh --rapido` por tanda y `./init.sh` completo antes del PR los ejecuta el
  leader (`AGENTS.md > Regla del gate`).
- **Sin E2E**: esta feature no toca UI ni flujo critico de auth/pagos/recaudo/ingesta/webhooks
  (`CHECKPOINTS.md`). El consumidor visual llega con la ficha de Q5, que si debera traerlo.
- **Sin migraciones**, luego sin `down.sql` y sin `pnpm run db:rollback` (§1.3).
