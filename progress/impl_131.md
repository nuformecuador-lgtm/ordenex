# Feature 131 — analítica: tablero operativo · bitácora de implementación

> Rama `feature/131-analitica-tablero-operativo`, worktree `C:/w131`. Base: `5eb9bd76`.
> Zona **frontend**. No se tocó `lib/`, ni `db/`, ni `components/private/analytics/`, ni
> `AnaliticaShell.tsx`.

## T0.2 — `dev` no se movió bajo los pies

`git fetch origin dev` → **`origin/dev` = `a66daa8a`** («Merge pull request #270 from
…/feature/126-analitica-operativa-servicios»). Los dos hechos que había que comprobar:

1. **La 126 sigue en `dev`**: `git cat-file -e origin/dev:lib/actions/analitica-operativa.ts`
   pasa. La Server Action que esta feature consume existe en la base.
2. **La 132 NO ha aterrizado**: `git ls-tree -r --name-only origin/dev -- "app/(app)/analitica"`
   devuelve exactamente dos archivos (`_components/AnaliticaShell.tsx` y `page.tsx`). No hay
   subárbol `financiero`, ni slot `financiero` en el shell. **D5 se cumple: la 131 aterriza
   primero** y no hubo que rebasar nada antes de T6.

## Baseline medido (no heredado)

| | Archivos de test | Tests | Rojos |
|---|---|---|---|
| **Inicio** (`5eb9bd76`, suite completa) | 844 | 10 550 | 1 (flake, ver abajo) |
| **Final** (suite completa) | **851** | **10 625** | **0** |

Delta: **+7 archivos de test, +75 tests, 0 rojos.** Los 7 archivos son exactamente los que
declara `design.md §1.1` más `TableroOperativoLatencia.test.tsx` (T7.2).

El rojo del baseline es `tests/components/descarga/ControlDescargaTransversal.test.tsx`
(«el control de descarga no altera la pantalla»). **Comprobado en aislado: 7/7 verde.** Es
un flake de saturación, no una regresión, y no se cuenta como rojo real. La corrida no
reportó *unhandled errors* de workers, así que no estaba degradada (844 archivos, que es el
total del árbol).

---

## Mapa `R<n>` → test **nombrado** → mutación → resultado

Las 27 mutaciones se aplicaron **de una en una**, verificando en cada caso que el cambio
**aterrizó en disco** antes de correr nada (el ayudante releía el archivo y abortaba si el
contenido no había cambiado — es el fallo que en la 124 se contó como «el test no cubre»).
Todas revertidas después; `git status` limpio al terminar.

| R | Test que lo cubre (caso que MUERE) | Mutación aplicada | Resultado |
|---|---|---|---|
| R1 | `tablero-operativo-frontera.guardia.test.ts` › «el tablero operativo solo consulta por la Server Action de la 126» | `import { AnaliticaOperativaService } …` en `PanelesOperativos.tsx` | **MUERTA** (1 failed) |
| R2 | `TableroOperativo.test.tsx` › «con `forbidden` muestra acceso denegado y no pinta ninguna cifra ni el vacio de metrica» | `forbidden` → `{ tipo: "ok", fuentes: [] }` (caer al `EmptyState`) | **MUERTA** |
| R3 | `TableroOperativo.test.tsx` › «con `validation_error` muestra el mensaje del campo que fallo» | descartar `fieldErrors` (`fieldErrors: {}`) | **MUERTA** |
| R4 | `TableroOperativo.test.tsx` › «con `unauthenticated` avisa de sesion no valida, con texto distinto al de prohibido» | reusar `TEXTO_PROHIBIDO` en la rama de sesión | **MUERTA** |
| R5 | `TableroOperativo.test.tsx` › «con fechas no comparables muestra el aviso de cobertura con su recuento y sus extremos» | condicionar el aviso a `length > 1000` | **MUERTA** |
| R6 | `TableroOperativo.test.tsx` › «el aviso de cobertura declara la penumbra» | borrar `<span>{TEXTO_PENUMBRA}</span>` | **MUERTA** |
| R7 | `operativa-cobertura.test.ts` › «el horizonte se importa de la 125 y no se reescribe» (censo existente, **sin tocarlo**) | escribir la fecha del horizonte como literal en `textos.ts` | **MUERTA** |
| R8 | `TableroOperativo.test.tsx` › «el punto del dia en curso se anuncia como parcial con su hora de corte» | `categoriaDePunto` devuelve siempre `punto.fecha` | **MUERTA** |
| R9 | `tablero-agregacion.test.ts` › «un total que incluye el dia en curso se marca parcial» | `parcial: false` fijo en `totalizarPuntos` | **MUERTA** |
| R10 | `tablero-operativo-frontera.guardia.test.ts` › «el tablero no reimplementa alcance ni identidad» | `import { resolverAlcance } …` en `PanelesOperativos.tsx` | **MUERTA** |
| R11 | `tablero-filtro.test.ts` › «el filtro emitido lo acepta `analiticaFiltroSchema` y no lleva claves extra» | añadir `rol: "maestro"` al objeto emitido | **MUERTA** (3 failed) |
| R12 | `FiltrosOperativos.test.tsx` › «al cambiar de zona se vuelve a consultar con la zona nueva» | sacar `filtroSerializado` de la clave SWR | **MUERTA** |
| R13 | `tablero-filtro.test.ts` › «sin seleccion del usuario el filtro inicial es el declarado» | preset inicial `semana` → `mes` | **MUERTA** |
| R14 | `tablero-filtro.test.ts` › «`desde`/`hasta` viajan si y solo si el preset es personalizado» | emitir siempre `desde`/`hasta` | **MUERTA** |
| R15 | `tablero-agregacion.test.ts` › «mas de 5 categorias se agrupan en otros conservando las 5 mayores» | devolver las series sin agrupar | **MUERTA** |
| R16 | `tablero-agregacion.test.ts` › «mas de 62 puntos se agregan por semana y se anuncia el grano» | `grano` fijo a `"dia"` (puntos crudos) | **MUERTA** |
| R17 | `tablero-agregacion.test.ts` › «una metrica de porcentaje nunca se agrega promediando dias» | `esAgregableTemporal` → `unidad !== "moneda"` (deja pasar `porcentaje`) | **MUERTA** |
| R18 | `tablero-agregacion.test.ts` › «el cubo semanal que contiene el dia en curso hereda `parcial` y el `corteAt` mayor» | no propagar `parcial` al cubo | **MUERTA** |
| R19 | `TableroOperativo.test.tsx` › «un 0,842 de tasa se pinta como 84,2 %» | multiplicar el valor por 100 antes de pasarlo | **MUERTA** |
| R20 | `tablero-agregacion.test.ts` › «`null` se propaga como `null` y no como cero» | `valor ?? 0` | **MUERTA** |
| R21 | `tablero-catalogo-paneles.test.ts` › «el tablero declara panel para `incidentes` y `sin_gestionar` pese a estar marcadas `declarada`» | `.filter(id => getMetrica(id)?.estadoProduccion === "producida")` | **MUERTA** |
| R22 | `FiltrosOperativos.test.tsx` › «si el catalogo de filtros falla, los selectores quedan deshabilitados y los paneles siguen vivos» | propagar la excepción del catálogo (`throw`) | **MUERTA** *(ver §Anclaje)* |
| R23 | `TableroOperativo.test.tsx` › «el boton de actualizar vuelve a consultar todos los paneles con el mismo filtro» | el botón no dispara `mutate` | **MUERTA** |
| R24 | `TableroOperativo.test.tsx` › «un panel que lanza no tumba los demas y su mensaje no filtra ids» | interpolar `error.message` en el aviso del panel | **MUERTA** |
| R25 | `tablero-operativo-frontera.guardia.test.ts` › «el tablero operativo no toca nada financiero y `lib/actions/analitica.ts` no existe» | `import type … from "@/lib/types/analitica-financiera"` | **MUERTA** |
| R26 | `AnaliticaPage.test.tsx` › «el gate de la ruta sigue siendo `maestro`/`admin` y la página sigue sin parámetros» | (a) añadir `adminTienda` a `ROLES_ACCESO_ANALITICA`; (b) dar un parámetro a `AnaliticaPage` | **MUERTA** las dos |
| R27 | `TableroOperativo.test.tsx` › «un panel de tasa por encima del techo no muestra ninguna cifra total, solo el aviso de reducir el rango» | pintar una cifra en el aviso de ese panel | **MUERTA** |

**27 / 27 requisitos cubiertos. 28 mutaciones aplicadas (R26 lleva dos), 28 muertas.**

### Anclaje: R22 **sobrevivió a la primera** y se arregló el CÓDIGO, no el conteo

Merece quedar escrito porque es exactamente el fallo silencioso contra el que existe este
criterio. La primera versión de `FiltrosOperativos.tsx` degradaba con un `try/catch` que
devolvía `null`. **La mutación «propagar la excepción» dejó el test VERDE**: SWR absorbe el
rechazo del *fetcher* en su `error`, `data` se queda `undefined`, y el selector acaba
igual de deshabilitado por los dos caminos. El `try/catch` era **código muerto** y R22
estaba cubierto por accidente.

No se retocó el test para que muriera. Se cambió el código: el *fetcher* devuelve ahora un
resultado explícito `{ disponible: false }` y la barra **dice en pantalla** por qué el
filtro está apagado (`TEXTO_FILTROS_DEGRADADOS`). Con eso «el catálogo dijo que no» y
«todavía no ha contestado» dejan de ser el mismo control muerto y mudo — que además es
mejor producto — y la mutación pasa a matar el caso nombrado. Verificado: **MUERTA**.

---

## T7.2 — la latencia de las N invocaciones (D4). **MEDIDA**

El design la declaraba explícitamente **no medida** y hacía de medirla parte de la entrega.
Archivo: `tests/components/TableroOperativoLatencia.test.tsx`.

- **N = 9 invocaciones** por carga y por cambio de filtro (6 paneles; el panel «Resultado de
  las gestiones» agrupa 4 métricas — ver §Desviaciones).
- **Método**: la Server Action se mockea con una latencia fija `L = 50 ms` y se cronometra el
  **instante de arranque** de cada invocación, no el reloj de pared del test. Se mide así a
  propósito: `userEvent.click` y el sondeo de `waitFor` (50 ms por vuelta) meten un ruido del
  mismo orden que `L` y taparían la señal — la primera versión del caso medía el reloj de
  pared y daba 495 ms de puro andamiaje.
- **Resultado**: **dispersión = 0 ms** entre la primera y la última invocación, tanto en la
  carga inicial como en la revalidación del botón «Actualizar». Las 9 invocaciones
  **arrancan en el mismo tick**: se solapan, no se serializan. Coste de pared ≈ `1 × L`, no
  `9 × L`. Si se serializasen, la dispersión sería ~`(N−1) × L` = 400 ms.
- **Lectura**: la vía de D4 (N llamadas, una por panel, sin Server Action compuesta) **no
  tiene un coste de serialización**, que era el riesgo declarado en `design.md §10.1`. Lo que
  esto **NO** mide: la base de datos, la red, ni si el runtime de Next serializa Server
  Actions en producción — el mock las resuelve en memoria. La cota del test se deja holgada
  (una sola `L`) porque su trabajo es cazar una regresión estructural (un `await` dentro de
  un bucle, un `mutate` secuencial), no medir la máquina de nadie.

---

## `pnpm typecheck`, `pnpm lint` y el build

- **`pnpm typecheck`**: 0 errores.
- **`pnpm lint`**: 0 errores, 27 warnings — **todos preexistentes** (`_args` sin usar en
  tests de repositorios y servicios ajenos). Ninguno cae en archivos de esta feature.
- **`pnpm exec next build --webpack`** (nunca `pnpm build`, que encadena `migrate deploy`
  contra una base real): **`✓ Compiled successfully in 3.2min`**. Esto era el riesgo 2 del
  `design.md §10`: `useSearchParams()` en un componente de cliente puede exigir una frontera
  `<Suspense>`. **No la exige**, porque la página resuelve la sesión por cookies y por tanto
  es dinámica. No hizo falta tocar `page.tsx` para envolver los slots.
- El paso posterior de *type check* del build sí falla, **en `app/api/cron/corte-diario/route.ts`**
  (un `export` que no es un handler de ruta). Es **preexistente y ajeno**: el diff de esta
  rama contra `origin/dev` no toca ni un archivo de `app/api` (comprobado). Se declara aquí
  porque ningún gate del repo corre el build y conviene que no se descubra como «lo rompió
  la 131».

---

## T7.3 — lo que NO se corrigió y lo que se contradijo a propósito

**(a) Divergencia 2 de la ficha 175, visible al usuario final en esta pantalla.**
`ordenes_por_estado` declara en el catálogo los 19 estados del seed mientras la columna del
rollup contiene el universo B2 (`specs/126-…/design.md:475-478`). El panel «Ordenes por
estado» de esta feature es donde eso se ve. **La 131 no lo corrige**: `lib/analytics/metrics.ts`
está fuera de su frontera y la divergencia está aplazada a la **175**. Se declara aquí para
que el donut no se lea como «faltan estados» ni se abra un bug contra este tablero.

**(b) D7 — la expectativa de prefetch de la 129 queda deliberadamente sin cumplir.**
`specs/129-…/design.md:143-145` dice que la 131 añadiría sus `await listar…()` en
`app/(app)/analitica/page.tsx` y bajaría los resultados por props del shell. **No se ha
hecho, y no es un olvido.** Los dos guardias de esa misma ruta lo contradicen:
`AnaliticaPage.test.tsx:102-104` exige `AnaliticaPage.length === 0`, y `:145-157` exige que
la página no importe acciones, servicios ni repositorios. **En este repo el guardia manda
sobre la prosa del diseño**: un test es verificable y una frase de un `design.md` ajeno no.
Los datos los pide el módulo de cliente por Server Action + SWR, que además es el patrón
dominante del repo (`OrdenesModule`). **Los dos tests se conservan intactos**: en
`AnaliticaPage.test.tsx` solo se añadieron *mocks* del nuevo árbol de cliente y un `describe`
nuevo; ninguna aserción de la 129 se tocó ni se relajó. Si algún día se quiere el prefetch,
la conversación empieza por retirar o reescribir esas dos aserciones **en su propio PR**.

*(Efecto colateral que merece una línea: el censo de R24 lee el archivo ENTERO, así que ni
siquiera el comentario de `page.tsx` puede escribir esos tres literales. Se reescribió la
frase; no se tocó el guardia.)*

**(c) R27 — el hueco de tasas y tiempos por encima del techo.**
Por encima de 62 puntos, los paneles de `porcentaje` y `segundos` **no pintan ni serie ni
cifra**: solo el aviso de reducir el rango. No es un panel roto, es la consecuencia aceptada
de **D3**. El «KPI total» que D3 pedía **no es computable hoy** sin romper la propia D3:
promediar los cocientes diarios es la media de medias que el servicio evita a propósito
sumando antes de dividir; recomponer la razón desde los conteos obligaría a importar
`lib/analytics/metrics` en cliente (prohibido por R25); y para `tiempo_ciclo` es
directamente imposible, porque `seg_ciclo_acum`/`seg_ciclo_n` no se exponen como métricas.
Se cierra cuando aterrice la ficha de `requirements.md §7` (*analitica: modo agregado de
tasas y tiempos*). Hasta entonces el hueco **se declara en pantalla en vez de rellenarse**,
que es la misma regla que gobierna la ventana ciega.

---

## Desviaciones respecto al `design.md`, con su motivo

1. **Composición de paneles** (`design.md §6.1`). El design listaba
   `ordenes_creadas` · `ordenes_por_estado` · `entregas+devoluciones+rechazos` ·
   `tasa_entrega` · `motivos_devolucion` · `tiempo_ciclo`. Esa lista **no incluye
   `sin_gestionar`**, y R21/D6 exigen que las dos métricas `declarada` que la 126 sí sirve
   estén presentes. Con seis paneles como techo (D4), la composición final es:
   `ordenes_creadas` · `ordenes_por_estado` · **`entregas+devoluciones+rechazos+incidentes`**
   · **`sin_gestionar`** · `tasa_entrega` · `tiempo_ciclo`; **cae `motivos_devolucion`**.
   `incidentes` entra en el panel de gestiones porque ahí es donde se lee: es el cuarto
   término del denominador de las tres tasas. El propio design declara la composición
   «cosmética y sin efecto sobre ningún requisito salvo R21».

2. **«Otros» conserva `MAX_SERIES − 1` categorías, no 5** (`design.md §6.2`, R15). El texto
   dice «conserva las 5 primeras y suma la cola en otros». Eso da **6** series y
   `aplicarTopeSeries` lanza `SeriesExcedidasError` — que es justo lo que R15 existe para
   evitar, y lo que su propia mutación afirma («devolver las series sin agrupar → el tope de
   la 130 lanza»). Se conservan por tanto las **4** mayores y la cola va al cubo «otros», de
   modo que el resultado son 5 series exactas. Es la única lectura en la que R15 y el tope
   del paquete pueden ser ciertos a la vez. `tablero-agregacion.test.ts` afirma
   explícitamente que `prepararSeries(items)` **no lanza**.

3. **`total` no se calcula nunca para `porcentaje`/`segundos`**, ni siquiera por debajo del
   techo (R27 solo lo prohíbe por encima). Un total de cocientes es una media de medias en
   cualquier rango; la restricción de R27 se aplica como superconjunto en vez de dejar una
   puerta abierta bajo el techo.

4. **`agregacion.ts` no importa `lib/analytics/metrics`** para saber la unidad: la toma de
   `SerieOperativa.unidad`, que la respuesta ya trae. Es lo que permite que el subárbol
   entero cumpla R25 sin excepciones.

**Cuarta divergencia del catálogo (`lib/analytics/metrics.ts`): NO se encontró ninguna.**
Se revisaron las entradas que este tablero consulta (`ordenes_creadas`, `ordenes_por_estado`,
`entregas`, `devoluciones`, `rechazos`, `incidentes`, `sin_gestionar`, `tasa_entrega`,
`tiempo_ciclo`) contra lo que la 126 sirve, y las únicas discrepancias son las **tres ya
declaradas y heredadas a la ficha 175**. No se tocó una línea de ese archivo.

---

## Guardia de frontera — decisión sobre su parte branch-scoped (T4.2)

`tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` tiene **dos bloques**:

- **PERMANENTE** (censa el árbol): R1 (nada de servicio/repositorio/Prisma/`app/api` bajo
  `app/(app)/analitica/`), R10 (nada de alcance ni identidad), R25 (nada financiero ni
  `lib/analytics/metrics` bajo el subárbol operativo, y `lib/actions/analitica.ts` no
  existe), más un **caso de discriminación** que demuestra que el censo caza un archivo
  infractor sintético y **no** marca una mención en prosa ni un `import type` de Prisma. Sin
  ese caso el guardia podría ser verde por vacío.
- **BRANCH-SCOPED** (mide el diff contra `origin/dev`): que la rama no toca
  `AnaliticaShell.tsx`, ni `components/private/analytics/`, ni `lib/**`, ni nada financiero.
  **Lleva escrita en el archivo su cabecera de caducidad**: caduca en el merge, por qué
  (pasa a juzgar cualquier rama posterior y da verdes vacíos o rojos ajenos — la lección de
  `frontera.guardia.test.ts`, retirado por el chore del PR #232, y de la T13.1 de la 126) y
  qué sobrevive (la parte permanente).

**Decisión que el PR debe tomar: RETIRAR el bloque branch-scoped al mergear.** No aporta
nada que la parte permanente no siga afirmando sobre el código final, y a partir del merge
solo puede mentir. Se anota aquí, como en la T13.1 de la 126, para que la retirada sea una
decisión de este PR y no un descubrimiento de la siguiente feature.

## T6.3 — el shell no se tocó

`git diff --name-only origin/dev` no incluye `AnaliticaShell.tsx`, ni
`components/private/analytics/`, ni `lib/`, ni `db/`. Lo único compartido bajo
`app/(app)/analitica/` que aparece en el diff es **`page.tsx`**, y lo comprueba un caso del
propio guardia. El solape con la 132 queda en la línea del `return`: la 132 añade
`financiero={…}` a la misma llamada.

## Archivos

**Nuevos (propiedad exclusiva de la 131):**

```
app/(app)/analitica/_components/operativo/{PanelesOperativos,PanelOperativo,FiltrosOperativos}.tsx
app/(app)/analitica/_components/operativo/{agregacion,catalogo-paneles,filtro-tablero,textos}.ts
tests/unit/analytics/{tablero-agregacion,tablero-filtro,tablero-catalogo-paneles}.test.ts
tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts
tests/components/{TableroOperativo,FiltrosOperativos,TableroOperativoLatencia}.test.tsx
```

**Modificados (compartidos, al mínimo):** `app/(app)/analitica/page.tsx` (dos imports + los
dos slots + el bloque de comentario de D7) y `tests/components/AnaliticaPage.test.tsx`
(mocks del árbol de cliente + un `describe` nuevo; **ninguna aserción de la 129 alterada**).

`TableroOperativoLatencia.test.tsx` es el único archivo fuera de la lista de `design.md §1.1`:
lo pide T7.2, que sin él no tendría dónde vivir.
