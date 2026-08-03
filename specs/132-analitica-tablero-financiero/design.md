# Feature 132 — analítica: tablero financiero · design

> Feature de **presentación**. No crea tablas, columnas, índices, migraciones ni políticas RLS, y
> por tanto **no lleva `migration.sql` ni `down.sql`**. Todo el dato que pinta ya existe y ya viene
> autorizado por la 122 y agregado por la 127.

## 1. Antes de nada: el desfase de numeración de la ficha

La `description` del registro 132 en `feature_list.json` dice, literalmente:

> «Cablea **126** a las graficas de **129** en la ruta **128**; datos sensibles pre-fetch en Server
> Component y pasados por props (patron private/). Depende de 126.»

**Los tres números están corridos.** Es el mismo desfase que la 129 ya documentó y cerró en su
`design.md` (Q7/D8: «Desfase de numeración confirmado, NO cambio de alcance»). Verificado contra
archivos reales en `dev`:

| La ficha dice | Es en realidad | Evidencia en el árbol | Estado |
|---|---|---|---|
| «los servicios de 126» | **127** — analítica financiera | `lib/services/AnaliticaFinancieraService.ts`, `lib/actions/analitica-financiera.ts` | `done` (PR #269) |
| «las gráficas de 129» | **130** — paquete de gráficas | `components/private/analytics/*` | `done` |
| «la ruta 128» | **129** — ruta + shell | `app/(app)/analitica/page.tsx`, `_components/AnaliticaShell.tsx` | `done` |

Consecuencias que hay que tener presentes al implementar:

- La **126 (servicios operativos) sigue `pending` y NO es dependencia de esta feature.** El campo
  `depends_on: 127` del registro es el correcto; la frase «Depende de 126» de la descripción, no.
- La **131 (tablero operativo, dueña del slot `filtros`) también sigue `pending`**. Esta feature
  llega **antes** que ella al shell, y por eso R26 fija un rango por defecto en vez de esperar
  controles que todavía no existen.
- **No se toca `feature_list.json` desde aquí.** Eso lo hace el leader.

## 2. La restricción que manda: D7 de la 135, citada textualmente

De `specs/135-analitica-catalogo-kpis-rangos/design.md` §6.1, aviso dirigido a esta feature:

> **→ 132 (tablero financiero), de D7.** El tablero es **de dos roles**: exactamente los que
> `esAccesoTotal(rol)` acepta. No diseñes un tablero financiero "para tienda".

Y el aviso hermano, dirigido a la 127, que explica por qué no hay nada que recortar:

> **→ 127 (financiera), de D7.** Sigue calculando la cuenta por pagar de tienda y el devengado de
> mensajero —el cálculo no cambia—, pero **ninguna de esas cifras se expone a `adminTienda`,
> `adminSatelite` ni `mensajero`**: solo a `maestro` y `admin`. No hay vista financiera recortada
> por tienda o por mensajero que construir.

**Quiénes son esos dos roles, verificado en código:** `lib/auth/acceso-total.ts:5` declara
`ROLES_ACCESO_TOTAL = [RolValue.maestro, RolValue.admin]` y `esAccesoTotal` es su `.includes`. El
guard de la 127 lo congela sobre las ocho métricas
(`tests/unit/analytics/financiera-alcance.guardia.test.ts:39-51`): `maestro`/`admin` = `total`, los
otros tres = `prohibido`, sin `acotado` en ninguna.

## 3. Inventario de la superficie que se consume (contratos reales, con archivo y línea)

Nada de esta sección es "lo razonable": es lo que hay escrito en `dev`.

### 3.1 El borde de la 127 — la única puerta

```ts
// lib/actions/analitica-financiera.ts:83-88   ("use server" en :1)
export async function consultarMetricaFinanciera(
  metricaId: string,
  filtroRaw: unknown,
  deps: AnaliticaFinancieraActionDeps = {},
): Promise<RespuestaFinanciera>;
```

- `filtroRaw` entra como `unknown` **a propósito** y lo valida entero `prepararConsultaAnalitica`
  (`:79-81`). El tablero **no pre-parsea** el filtro: validarlo dos veces es como se acaban
  aceptando dos formas de la misma entrada.
- El actor sale de `resolveActorFromSession()` y de ningún otro sitio (`:42-44,89`). El tablero
  **no pasa `deps`**.
- `deps` existe para tests (`:57-63`). Contiene funciones: **jamás cruza la frontera RSC**.

```ts
// lib/types/analitica-financiera.ts:206-210
export type RespuestaFinanciera =
  | { status: "ok"; datos: ResultadoFinanciero }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden"; code: "FORBIDDEN" }        // sin motivo, D9(c)/R42 de la 127
  | { status: "error"; mensaje: string };             // ya saneado: id de métrica + fechas
```

### 3.2 El DTO — unión discriminada por `tipo`

```ts
// lib/types/analitica-financiera.ts:167-191
interface CabeceraFinanciera {
  metricaId: string; etiqueta: string; unidad: MetricaUnidad;
  rango: { desdeFecha: string; hastaFecha: string };
  esAcumulado: boolean;                      // true SOLO en las dos cuentas por pagar (:243-251)
}
type ResultadoFinanciero =
  | (CabeceraFinanciera & { tipo: "vistas";        vistas: readonly VistaFinanciera[] })
  | (CabeceraFinanciera & { tipo: "conciliacion"; conciliacion: ResultadoConciliacion });

interface VistaFinanciera {                  // :83-99
  id: string; grano: DimensionAnalitica; fuente: TablaDinero;
  sumableCon: readonly string[];             // [] = con ninguna
  filas: readonly { cubo: string; importe: ImporteAnalitico }[];
  total: ImporteAnalitico;
}
interface ImporteAnalitico { bruto: string; neto: string; moneda: string }   // :53-60, STRING escala 2
```

`ResultadoConciliacion` (`:124-155`): `porEstado: FilaConciliacion[]`
(`nivel`, `estado`, `cantidad: number`, `totales: Record<"efectivo"|"simpe"|"transferencia"|"general", string>`,
`fechadoPor`) y `cuadre: { cuadra, totalSnapshot, totalLedger, diferencia, cierresDescuadrados[] }`.

### 3.3 Qué produce cada una de las ocho ids (leído en el servicio, no supuesto)

| id | `tipo` | vistas / forma | `filas` | `esAcumulado` | fuente en el servicio |
|---|---|---|---|---|---|
| `ingreso_flete` | vistas | 1 vista, grano `fecha` | **vacías** | false | `:203-221` (`deCaja`) |
| `ingreso_comision_cod` | vistas | ídem | **vacías** | false | ídem |
| `ingreso_iva` | vistas | ídem | **vacías** | false | ídem |
| `egresos` | vistas | ídem | **vacías** | false | ídem |
| `cod_recaudado` | vistas | **DOS** vistas: `cod_recaudado__por_metodo` (grano `metodo_pago`) y `cod_recaudado__por_tienda` (grano `tienda`), ambas `sumableCon: []` | sí, por cubo | false | `:233-277` |
| `cuenta_por_pagar_tienda` | vistas | 1 vista, grano `tienda` | sí, por tienda | **true** | `:284-311` |
| `cuenta_por_pagar_mensajero` | vistas | 1 vista, grano `fecha` | **vacías** (protección: el catálogo no declara grano `mensajero`, `:316-318`) | **true** | `:319-337` |
| `conciliacion_cierres` | conciliacion | conteos por `(nivel, estado)` + cuadre | — | false | `:355-409` |

**Hallazgo que define el tablero:** cinco de las ocho métricas devuelven `filas: []`. No es una
carencia que esta feature deba rellenar; el servicio lo justifica en `:196-201` («inventar una fila
con la fecha de inicio del rango afirmaría que todo el dinero se movió ese día»). **Por eso no hay
gráfica de líneas en este tablero** — ver Q3 de `requirements.md`.

### 3.4 Las props del paquete de la 130 (contrato, no sugerencia)

```ts
// components/private/analytics/tipos.ts
PuntoDato       { categoria: string; valor: number | null }            // :23-31, null = ausente ≠ 0
SerieDato       { id: string; etiqueta: string; puntos: PuntoDato[] }  // :38-42 (el color NO viaja)
EstadoVisual    { cargando?: boolean; error?: string | null }          // :44-49
TextoVacio      { titulo: string; descripcion?: string }               // :58-61
GraficaProps    extends EstadoVisual { titulo, series, unidad, vacio,
                  avisoRecorte?: (mostradas, recibidas) => string, className? }   // :63-76
KpiCardProps    extends EstadoVisual { etiqueta, valor: number|null, unidad,
                  variacion?: VariacionKpi, className? }               // :88-95
ColumnaResumen  { id, etiqueta, unidad }                               // :98-102
FilaResumen     { id, categoria, valores: Record<string, number|null> }// :104-109
TablaResumenProps extends EstadoVisual { titulo, encabezadoCategoria, columnas,
                  filas, totales?: { etiqueta }, vacio, className }    // TablaResumen.tsx:22-37
```

- `KpiCard.tsx` **no** declara `"use client"`; `GraficaBarras/Lineas/Donut` y `TablaResumen`
  **sí** (`:1` de cada uno).
- `formatearValor(valor, unidad)` y `totalizar(...)` son puros (`formato.ts:64-89`) y la moneda sale
  de `lib/config/moneda.ts` (`formato.ts:10`).
- **Topes** (`topes.ts:21-32`): `MAX_SERIES = 5`, `MAX_PUNTOS_SERIE = 62`. Fuera de producción
  **lanzan** `SeriesExcedidasError`/`PuntosExcedidosError` (`:80-105`), y `GraficaDonut` aplica
  `MAX_SERIES` a los **segmentos** (`GraficaDonut.tsx:25-37`). Agrupar la cola en "otros" es
  **trabajo del tablero** y está escrito así en `topes.ts:16-17`.

### 3.5 El punto de extensión de la 129 (se usa tal cual, no se inventa otro)

`AnaliticaShell.tsx:28-36` deja escritos **tres pasos mecánicos y sólo esos**: (1) añadir
`financiero?: ReactNode` a `AnaliticaShellProps`; (2) añadir una
`<section aria-label="Tablero financiero">` debajo de la región operativa, **en la misma pila
vertical** (D5/Q4 de la 129: pila, no pestañas); (3) su placeholder `EmptyState`.

**Desviación declarada en el paso (3).** El propio comentario, dos líneas más abajo, dice: «en un
portal donde el dinero es sensible, una región financiera visible y vacía es peor que no tenerla —
sugiere una cifra que no existe y expone una sección de plata a roles que ni siquiera deberían
saber que existe el panel». Esta feature toma **ese** razonamiento y no el paso (3): si la prop no
llega, la región **no se renderiza** (R7). Es la única forma de que R2 sea cierto sin depender de
que el llamador se acuerde de no pasar la prop. Confirmación pedida en Q4.

## 4. Arquitectura de la feature

```
app/(app)/analitica/
  page.tsx                              (MODIFICADO) Server Component: gate de rol (ya existe)
    └─ si esAccesoTotal(rol): await cargarTableroFinanciero()  ← pre-fetch, R9
       └─ <AnaliticaShell financiero={<TableroFinanciero datos={…} />} />
  _components/
    AnaliticaShell.tsx                  (MODIFICADO) + prop `financiero` + <section>, R6/R7
    financiero/
      cargar.ts                         (NUEVO) SERVIDOR. Orquesta las 8 llamadas al Server Action
      adaptar.ts                        (NUEVO) PURO. DTO -> props de la 130 (sin React, sin I/O)
      TableroFinanciero.tsx             (NUEVO) SERVIDOR. Compone los paneles. Sin "use client"
      PanelConciliacion.tsx             (NUEVO) SERVIDOR. El caso especial `tipo: "conciliacion"`
      rango.ts                          (NUEVO) La ÚNICA constante de rango por defecto (R26)
```

`docs/architecture.md:142-145` («sin sobre-ingeniería»): estas piezas se usan en **un solo sitio**,
así que viven junto a la página y **no** se promueven a `components/shared/` ni a
`components/private/`. Lo que sí es reutilizable ya está en `components/private/analytics/`.

### 4.1 Flujo, en el orden en que ocurre

1. `page.tsx` resuelve el actor y aplica el gate existente (`notFound()` para todo lo que no sea
   `ROLES_ACCESO_ANALITICA`). **No se toca** (R5/R8).
2. Si `esAccesoTotal(actor.rol)`, la página `await cargarTableroFinanciero()`.
3. `cargar.ts` hace `Promise.all` sobre `IDS_FINANCIERAS_SERVIDAS` (R12/R13/R27), pasando el mismo
   filtro `{ rango: RANGO_POR_DEFECTO }` (R26) y **sin `deps`**.
4. Cada respuesta se **normaliza** a un caso de presentación: `ok` → DTO; `forbidden` → panel
   omitido (R4); `error`/`validation_error` → panel en estado de error (R23).
5. `TableroFinanciero.tsx` (servidor) llama a `adaptar.ts` y pasa **objetos planos** a los
   componentes de la 130. Ninguna prop es función (R10).

### 4.2 Por qué el pre-fetch es en el Server Component y no negociable

`docs/architecture.md:111` («datos privados: pre-fetch en Server Component, stream al cliente») y
`:155` («componente privado haciendo fetch de datos sensibles» es anti-patrón que el reviewer
rechaza). Además el guard del paquete ya lo vigila estructuralmente: `fetch(`, `"use server"`,
`next/headers`, `swr`, `@/lib/actions/`, `@/lib/db` y `@prisma/client` están **prohibidos** dentro
de `components/private/analytics/`
(`tests/unit/components/analytics-paquete-guard.test.ts:64-79`).

### 4.3 La frontera RSC: el fallo que ningún gate del repo detecta

La 129 verificó y dejó escrito que `"use client"` en la página **compila los tests y revienta
`next build`**, porque arrastra Prisma al bundle del navegador. Ningún test del repo ejecuta un
build. De ahí R10 y R11, y se cubren con **dos redes distintas**:

- **R10 — guard estático** (barato, corre siempre): censo de los archivos nuevos de servidor
  buscando `"use client"`, y censo de las props que el tablero pasa a los componentes cliente
  buscando la única prop-función del contrato de la 130 (`avisoRecorte`, `tipos.ts:73`). Un Server
  Component que pase una función a un Client Component **falla en render**, no en compilación: por
  eso el tablero **nunca** pasa `avisoRecorte` y en su lugar garantiza por construcción que no hay
  recorte (R20).
- **R11 — `pnpm exec next build`**, ejecutado a mano por el implementer y con la salida pegada en
  `progress/impl_132-analitica-tablero-financiero.md`. **Nunca `pnpm build`**: ese script encadena `migrate deploy` contra una
  base real.

## 5. Inventario de paneles (uno por métrica, R13)

| # | Métrica | Componente de la 130 | Qué pinta |
|---|---|---|---|
| 1 | `ingreso_flete` | `KpiCard` | `neto` como cifra; `bruto` en la línea secundaria (R16) |
| 2 | `ingreso_comision_cod` | `KpiCard` | ídem |
| 3 | `ingreso_iva` | `KpiCard` | ídem |
| 4 | `egresos` | `KpiCard` | ídem |
| 5 | `cod_recaudado` (vista **por método**) | `GraficaDonut` | ≤ 3 segmentos (`efectivo`/`simpe`/`transferencia`), muy por debajo de `MAX_SERIES` |
| 6 | `cod_recaudado` (vista **por tienda**) | `GraficaBarras` (top 5 + cola agrupada) **y** `TablaResumen` con todas las filas | panel propio, **nunca** sumado con el 5 (R17) |
| 7 | `cuenta_por_pagar_tienda` | `TablaResumen` (columnas `bruto` y `neto`) + el `total` del DTO al lado + etiqueta «saldo al corte» (R18) | |
| 8 | `cuenta_por_pagar_mensajero` | `KpiCard` + etiqueta «saldo al corte» (R18) | sin cubos: el catálogo no declara grano `mensajero` |
| 9 | `conciliacion_cierres` | `TablaResumen` (por `nivel`+`estado`, columna `cantidad` con unidad `conteo` y las cuatro de moneda) + bloque de cuadre | aviso visible si `cuadra === false` (R19) |

Son **9 paneles para 8 métricas** porque `cod_recaudado` trae dos vistas que **no suman**
(`sumableCon: []`, `AnaliticaFinancieraService.ts:228-232`): ponerlas en el mismo gráfico contaría
el mismo colón dos veces. Cada panel lleva su título con la `etiqueta` del DTO (que viene del
catálogo, `AnaliticaFinancieraService.ts:174`) y el rango efectivo del propio DTO (R22).

### 5.1 CORRECCIÓN (2026-08-03): la prop `totales` de `TablaResumen` NO se usa

**Este diseño se equivocaba y aquí queda dicho, no borrado.** Los paneles 6, 7 y 9 de la tabla de
arriba pedían la **«fila de totales»** de `TablaResumen`. **Esa instrucción era incorrecta y no debe
seguirse:** pasar la prop `totales` hace que el paquete **calcule** la fila con `totalizar`
(`components/private/analytics/TablaResumen.tsx:44-54`), es decir **una suma derivada en coma
flotante**, y **R14 prohíbe** pintar cualquier cifra que no venga literal del DTO.

No es una objeción teórica: está **medido en las dos direcciones**. El implementer se desvió del
diseño en este punto (desviación D1 de su bitácora) y el reviewer lo verificó con una mutación
propia (M1): **activar la prop `totales` pone rojo un test**. La desviación era correcta; el
defecto era del diseño.

Hay además un segundo motivo, independiente de la letra de R14: esa suma **discreparía del
`total` que el servicio ya calculó en `Prisma.Decimal`** aguas arriba, y entonces la misma tabla
mostraría **dos verdades distintas del mismo dinero**.

**Lo que se hace en su lugar**, y lo que debe hacer todo consumidor futuro (131, 134): pintar el
**`vista.total` del propio DTO** junto a la tabla, con su `bruto` y su `neto` etiquetados. El total
ya viaja en el DTO (`VistaFinanciera.total`, `lib/types/analitica-financiera.ts:98`): no hay que
recalcularlo, sólo leerlo.

> **Aviso a la 131 y a la 134:** si al leer la tabla de §5 os tienta activar `totales`, no lo
> hagáis. Es el error que esta sección corrige.

## 6. Contratos internos

### 6.1 `rango.ts` — la única constante de rango (R26)

```ts
/** Filtro por defecto del tablero financiero mientras la 131 no aporte controles. */
export const FILTRO_FINANCIERO_POR_DEFECTO = { rango: <preset de Q1> } as const;
```

Un objeto, en un archivo, sin lecturas de `searchParams`: cuando la 131 traiga la barra de filtros,
el cambio es sustituir este valor por el filtro del usuario en `cargar.ts` y nada más. El objeto
viaja como `unknown` al Server Action y lo valida el esquema `.strict()` de la 135 — el tablero no
lo pre-parsea.

### 6.2 `cargar.ts` — SERVIDOR

```ts
export type PanelFinanciero =
  | { estado: "ok";        id: string; datos: ResultadoFinanciero }
  | { estado: "error";     id: string; mensaje: string }
  | { estado: "denegado";  id: string };                 // no se renderiza (R4)

export async function cargarTableroFinanciero(): Promise<readonly PanelFinanciero[]>;
```

Recorre `IDS_FINANCIERAS_SERVIDAS` con `Promise.all` (R12). **No hay estado `cargando`**: en un
Server Component el `await` ya terminó cuando se renderiza; la prop `cargando` del paquete existe
para el futuro consumidor cliente (la 131) y aquí se deja en su valor por defecto.

### 6.3 `adaptar.ts` — PURO (sin React, sin I/O, testeable solo)

```ts
/** string escala 2 -> number de PRESENTACIÓN. Nunca al revés y nunca para calcular. */
export function aNumero(importe: string): number | null;              // R15
export function serieDeVista(v: VistaFinanciera, campo: "bruto"|"neto"): SerieDato;
export function filasDeVista(v: VistaFinanciera): readonly FilaResumen[];
export function agruparCola(puntos: readonly PuntoDato[], tope: number,
                            etiquetaOtros: string): readonly PuntoDato[];   // R20/R21
```

Tres decisiones que hay que leer juntas:

1. **`aNumero` es la ÚNICA frontera `string → number` y sólo existe para pintar.** Devuelve `null`
   si el resultado no es finito (R15): un `0` ahí sería indistinguible de «no hubo movimiento»,
   que es exactamente lo que la 127 se negó a devolver (`IAnaliticaFinancieraService.ts:30-33`).
   La aritmética de dinero **ya está hecha** en `Prisma.Decimal` aguas arriba y aquí no se repite
   (R14). Límite conocido y aceptado: `Number` deja de ser exacto por encima de 2^53 (≈ 9·10¹³ en
   unidades de la moneda, es decir ~90 billones); el volumen medido del repo es de decenas de
   movimientos (`lib/config/analitica-financiera.ts:5-7`), así que el límite es inalcanzable, y si
   se alcanzara `aNumero` no miente: el formateo sigue saliendo del mismo número que se pintó.
2. **`bruto` y `neto` viajan los dos** (R16), como manda D1/R37 de la 127
   (`lib/types/analitica-financiera.ts:44-52`: «servir solo el neto escondería el volumen; servir
   solo el bruto mentiría en cuanto hubiera una anulación»). En `KpiCard` el `neto` es la cifra y
   el `bruto` va debajo; en `TablaResumen` son **dos columnas**.
3. **`agruparCola` está aquí y no en el paquete** porque `topes.ts:16-17` lo dice explícitamente
   («no agrupa la cola en "otros" ni re-muestrea: los dos cálculos son del tablero») y porque el
   guard del paquete pondría rojo cualquier `"otros"` escrito dentro de él
   (`analytics-paquete-guard.test.ts:205-212`). Sin esta función, un maestro con seis tiendas
   activas haría que `GraficaBarras` **lance** `SeriesExcedidasError` en desarrollo y en test
   (`topes.ts:82`) y recorte en silencio en producción.

## 7. Alternativas descartadas

1. **Que el tablero llame directamente a `AnaliticaFinancieraService` desde el Server Component**
   (instanciando los cuatro repositorios como hace `construirServicio`,
   `lib/actions/analitica-financiera.ts:65-74`). *Descartada.* Saltarse el Server Action se salta
   `prepararConsultaAnalitica`, que es **el único punto de entrada** de la 122 y donde vive la
   garantía de que el recorte no se puede olvidar (`lib/analytics/consulta.ts:1-23`); se salta
   además la auditoría explícita del denegado (`:98-107`) y la traducción del `dominio_invalido`.
   El ahorro sería una resolución de sesión; el precio, una segunda ruta hacia el dinero sin
   permisos ni rastro.

2. **Pasarle al Server Action `deps: { getActor: () => actor }` para no resolver la sesión dos
   veces** (una en el gate de la página, otra dentro de la acción). *Descartada.* `deps` es el
   punto de inyección **para tests** (`:51-56`) y usarlo desde producción convierte al llamador en
   una segunda autoridad sobre "quién eres" — justo lo que R15 de la 127 prohíbe. Se acepta el
   coste: dos resoluciones de sesión por render, ambas server-side y sin consulta adicional al
   dinero.

3. **Hacer que la región financiera sea un Client Component que fetchee con SWR** (o que llame al
   Server Action desde el navegador para refrescar). *Descartada por tres motivos independientes:*
   la ficha lo prohíbe explícitamente («datos sensibles pre-fetch en Server Component»);
   `docs/architecture.md:110-111` reserva SWR a datos **públicos**; y el guard del paquete lo
   detecta estáticamente (`analytics-paquete-guard.test.ts:64-79`). Además arrastraría el DTO
   financiero al bundle del cliente para roles que no deben ni saber que el panel existe.

4. **Declarar una constante nueva `ROLES_TABLERO_FINANCIERO = ["maestro","admin"]`** para gatear la
   región. *Descartada.* Sería la **tercera** lista de roles con el mismo contenido y significados
   distintos, después del choque que ya obligó a escribir
   `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts` (dos constantes llamadas igual,
   `:6-38`). La visibilidad se deriva de `esAccesoTotal(rol)` —la fuente única que D7 de la 135
   obliga a reutilizar (`lib/analytics/alcance.ts:110-118`)— y la defensa real sigue siendo el
   `forbidden` del borde, que no depende de que la UI acierte.

5. **Filtrar el catálogo con `listarMetricas({ dominio: "financiera" })` desde el tablero.**
   *Descartada, y es una trampa verificada:* el guard de fuente única censa **todo** `app/`,
   `lib/`, `components/` y `scripts/` con la expresión
   `/\bdominio\s*:\s*["'](operativa|financiera)["']/`
   (`tests/unit/analytics/modulo-puro.guardia.test.ts:342,347-358`), y esa llamada **coincide con el
   patrón**: dejaría el guard rojo por escribir un argumento perfectamente legítimo. Se usa
   `IDS_FINANCIERAS_SERVIDAS` (`lib/types/analitica-financiera.ts:225-234`), que además es la lista
   que el guardia de correspondencia de la 127 compara contra el catálogo — o sea que ya está atada
   a él por otro lado (R27).

6. **Pintar una gráfica de líneas de evolución diaria del recaudo.** *Descartada por falta de
   dato, no por gusto:* las métricas de caja devuelven `filas: []`
   (`AnaliticaFinancieraService.ts:203-221`) porque el repositorio agrega la ventana entera. Para
   dibujar la línea habría que pedir a la 127 —feature `done`— un desglose por fecha, o
   reconstruirlo desde otra fuente, que es exactamente el «recalcular el dinero» que su diseño
   prohíbe. Queda como Q3 y, si se quiere, como ficha aparte.

7. **Dejar que el paquete recorte solo cuando haya más de cinco tiendas** (no agrupar, confiar en
   `aplicarTopeSeries`). *Descartada.* Fuera de producción **lanza** (`topes.ts:82`), así que el
   primer test con seis cubos revienta; y en producción recorta mostrando cinco tiendas como si
   fueran todas, con el total desmintiendo la suma de lo pintado. `agruparCola` conserva el total
   (R21), que es la propiedad que hace honesto el gráfico.

8. **Añadir pestañas ("Operativo" / "Financiero") en vez de apilar la región.** *Descartada:* la
   129 lo decidió en su D5/Q4 (pila vertical de regiones con slots nombrados) y el punto de
   extensión está escrito para eso (`AnaliticaShell.tsx:29-32`). Cambiar a pestañas obligaría a
   convertir el shell en cliente (estado de pestaña activa) y a mover la frontera RSC de la página
   entera — el riesgo exacto que R10/R11 vigilan.

9. **Renderizar la región financiera vacía para todos los roles con acceso a `/analitica`.**
   *Descartada por el argumento que la propia 129 escribió* (`AnaliticaShell.tsx:33-36`): una
   sección de plata visible y vacía sugiere una cifra que no existe y anuncia el panel a quien no
   debe saber que existe. De ahí R2 y R7.

10. **Escribir un E2E de Playwright en esta feature.** *Descartada por ahora* (Q5): el gate por rol
    se verifica con tests de página que enumeran los seis `RolValue`, que es el mismo patrón con el
    que la 129 cubrió su gate; el recorrido E2E tiene sentido una vez la 133 fije la forma
    definitiva del tablero por rol, para no escribirlo dos veces.

## 8. Riesgos y guards que esta feature puede poner en rojo

**Ninguno se pone rojo por diseño.** Esta feature no toca ningún archivo vigilado por los guards
vigentes; lo que sigue son las trampas concretas por las que se pondrían rojos **si el implementer
se desvía**, con el archivo y lo que ese guard afirma:

| Guard | Cuándo se pondría rojo | Qué hacer |
|---|---|---|
| `tests/unit/analytics/modulo-puro.guardia.test.ts:347-358` (R2, fuente única) | Si algún archivo nuevo escribe `dominio: "financiera"` — **incluido el argumento de `listarMetricas`** | Usar `IDS_FINANCIERAS_SERVIDAS` (alternativa 5) |
| `modulo-puro.guardia.test.ts:367-377` (R30) | Si algún archivo nuevo escribe el literal `"sin_asignar"` | No aplica: ninguna financiera tiene grano `mensajero` |
| `tests/unit/components/analytics-paquete-guard.test.ts:64-79` | Si se mete `fetch`, SWR, `@/lib/actions/` o Prisma **dentro** de `components/private/analytics/` | El cableado va en `app/(app)/analitica/_components/financiero/`, nunca dentro del paquete |
| `analytics-paquete-guard.test.ts:117-130` | Si se escribe un símbolo de moneda, un ISO o un locale **dentro del paquete** | R25: formatear con `formatearValor`; ojo, el censo **no** cubre `app/`, así que R25 necesita su propio guard nuevo |
| `analytics-paquete-guard.test.ts:216-235` | Si un test nuevo cuyo nombre contenga `analytics-`/`Analytics` consulta nodos de recharts (`querySelector("svg")`, clases `recharts-`) | Afirmar sobre la alternativa textual y los nombres accesibles, no sobre el SVG |
| `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts:43-63` | Si se amplía `ROLES_ACCESO_ANALITICA` hasta igualar `ROLES_ANALITICA` | R5: esta feature no la toca. Ese ensanche es de la 133 |
| `tests/unit/analytics/financiera-alcance.guardia.test.ts:35-64` | Si alguien "abriera" una financiera a `adminTienda` para que el tablero tenga versión de tienda | D7 lo prohíbe: no hay tablero financiero para tienda |
| `tests/unit/analytics/financiera-trazabilidad.guardia.test.ts` | No aplica: vigila `progress/impl_127.md`. Su equivalente para esta feature es R28 sobre `progress/impl_132-analitica-tablero-financiero.md` | — |
| `tests/components/AnaliticaShell.test.tsx` y `AnaliticaPage.test.tsx` | Si las aserciones existentes cuentan regiones o comparan el árbol renderizado por igualdad | Se **amplían**, no se relajan: la región financiera es nueva y sólo para dos roles |

Riesgos no cubiertos por ningún guard, declarados:

- **La frontera RSC.** Ver §4.3. Se cubre con un guard estático nuevo (R10) **más** una ejecución
  manual de `pnpm exec next build` (R11) cuya salida queda en la bitácora. Es el único punto de
  esta feature donde "los tests pasan" no implica "funciona".
- **Legibilidad de los cubos de tienda.** Mientras Q2 no se cierre, la tabla y la barra muestran
  identificadores. Es feo y hay que decirlo en pantalla, no esconderlo.
- **Doble resolución de sesión por render** (alternativa 2), aceptada y sin consulta extra al dinero.
- **La 131 llegará después al mismo archivo** (`AnaliticaShell.tsx`, `page.tsx`). El conflicto es
  previsible y pequeño si esta feature se limita a **añadir** una prop y una `<section>` sin
  reordenar nada de lo existente.

## 9. Verificación

| Qué | Cómo |
|---|---|
| R1–R5, R8 | `tests/components/AnaliticaPage.test.tsx` ampliado: los **seis** `RolValue`, uno a uno |
| R6, R7 | `tests/components/AnaliticaShell.test.tsx` ampliado: con prop y sin prop |
| R9, R12, R13, R23 | Test del cargador con el Server Action mockeado: 8 llamadas, respuestas mixtas |
| R10, R25, R27 | Guard estático nuevo, `tests/unit/guards/tablero-financiero.guardia.test.ts` |
| R11 | `pnpm exec next build` a mano; salida en `progress/impl_132-analitica-tablero-financiero.md`. **Nunca `pnpm build`** |
| R14–R22, R24 | Tests unitarios puros de `adaptar.ts` + tests de render de `TableroFinanciero` |
| R28 | Mapa `R<n> → test` en `progress/impl_132-analitica-tablero-financiero.md` |

Cierre: `./init.sh` completo antes del PR (`docs/verification.md:48-56`).
