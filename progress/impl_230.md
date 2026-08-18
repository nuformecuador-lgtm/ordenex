# Feature 230 — bitácora de implementación · BACKEND (tandas 1, 2 y 7 backend)

> Agente: `backend_dev`. Worktree `C:/w230`, rama
> `feature/230-descarga-cierres-general-y-detallada`, nacida de `origin/dev` en `9b627059` y
> **rebasada sobre `origin/ux` por decisión del humano del 2026-08-18** (merge, no rebase: una
> sola pasada de conflictos). El motivo está en H1.
>
> **Alcance entregado:** tanda 1 completa (T1.1, T1.2, T1.3), tanda 2 completa (T2.1, T2.2,
> T2.3) y la parte BACKEND de la tanda 7 (T7.1, T7.2, T7.3).
> **Fuera de alcance, no tocado:** tandas 3, 4, 5, 6, T7.4 y T7.5 (declaración de columnas,
> diálogo, montajes de UI y las guardias transversales que dependen de ellos).

---

## 1. Hallazgos — dónde el código contradijo a la spec

Los tres primeros son de aterrizaje: `design.md` se escribió mirando el árbol de la rama `ux`,
y esta feature nace de `dev`. Ninguno bloquea, pero el reviewer los tiene que ver.

### H1 — RESUELTO: `lib/types/filtros-cierres.ts` no existía en `dev`, y la feature se rebasó sobre `ux`

**El hallazgo original:** `design.md §3.1` situaba el schema nuevo «en el mismo módulo y desde
las mismas primitivas», y en `origin/dev@9b627059` ese módulo **no existía**. Tampoco
`filtrosWhere`, `findCatalogoFiltros` ni `obtenerCatalogoFiltrosCierres`. Todo eso es el commit
`4c9a888e`, que vive solo en `origin/ux`. Para no bloquearme escribí un módulo propio con las
primitivas copiadas por valor de `lib/types/orden.ts`.

**Decisión del humano (2026-08-18):** la 230 se rebasa sobre `ux`, no sobre `dev` — porque
además `ux` trae `2fd98ea1`, que reescribe los listados de cierres donde va el botón nuevo.
Montar sobre `dev` habría sido construir sobre pantallas que van a desaparecer. El leader hizo
`git merge origin/ux` y yo resolví los nueve conflictos.

**Cómo quedó `lib/types/filtros-cierres.ts`:** **gana el módulo de `ux`, entero.** Mi copia era
un andamio y su motivo desapareció; la borré. Encima de ese módulo re-injerté lo único que era
de la 230 —`filtrosDescargaGestionesSchema` y `FiltrosDescargaGestiones`— construido con SUS
primitivas reales, no con las mías:

| Lo que yo tenía | Lo que quedó |
| --- | --- |
| `z.array(z.string().min(1)).nonempty()` propio | `listaDeIdsRequerida`, extraída de `listaDeIds` de `ux` (uuid + `MAX_IDS_POR_FILTRO` + `nonempty`) |
| `fechaCalendario` con regex propia | la de `ux`, que valida con `esFechaCalendarioValida` |
| `MENSAJE_RANGO_DESCARGA_GESTIONES` propio | el `MENSAJE_RANGO` del módulo, uno solo para los cinco listados y esta descarga |
| refine de rango propio | `rangoCoherente` del módulo |

`listaDeIds` de `ux` traía `.optional()` incorporado, y esta descarga lo necesita OBLIGATORIO
(R39). En vez de declarar una lista paralela, partí la suya en dos —`listaDeIdsRequerida` y
`listaDeIds = listaDeIdsRequerida.optional()`—: sin duplicar el tope, el `uuid` ni el
`nonempty`, y sin cambiar el comportamiento de ningún filtro existente. La guardia
`filtros-cierres-alcance.guardia.test.ts` sigue verde.

**Efecto colateral que hay que saber:** los ids de esta descarga ahora son **UUID**, porque es
la regla del módulo. Mis tests usaban `"m-1"`; se adaptaron.

**Un intento que reverti, y merece estar escrito:** primero exporté `MENSAJE_RANGO` para que el
test comparase contra la constante. No funciona: **zod v4 MUTA el objeto de params que recibe
`.refine`** y le renombra `message` a `error`, así que `MENSAJE_RANGO.message` es `undefined`
después de importarlo. Deshice el export —una constante que zod reescribe no debe salir del
módulo— y el test afirma ahora algo más fuerte y sin literales: que el mensaje del rango
invertido de esta descarga es **el mismo** que el de `filtrosCierresSchema`.

### H1.b — `filtrosWhere` ya existía: borré mi `recortesDescargaGestionesWhere`

Con `ux` dentro, `CierresAdminRepository` tiene `filtrosWhere(filtros)`, que traduce fechas,
zonas y mensajeros a condiciones y que `historicoWhere`/`colaWhere` componen con `AND`. Mi
helper hacía la misma traducción de fechas y de `mensajeroId`. **Borrado.** Los dos caminos de
la 230 usan ahora `filtrosWhere` (exportada para que el repositorio de bodega la lea), y el
`where` pasa de claves hermanas a `{ ...alcanceWhere(alcance), AND: filtrosWhere(filtros) }`.

No es sólo quitar una copia: es la forma **correcta**. Como claves hermanas, un `mensajeroId` de
recorte podría SUSTITUIR al criterio del alcance en vez de sumarse; dentro de `AND` se exigen
los dos. Es exactamente lo que la guardia `filtros-cierres-alcance` vigila para los listados, y
ahora la descarga detallada compone igual. El `design.md §3.1` decía que
`FiltrosDescargaGestiones` es un subconjunto estructural de `FiltrosCierres` y que `filtrosWhere`
se reusa sin tocarlo: **con `ux` dentro, el design vuelve a ser cierto**.

### H1.c — R29 queda DESBLOQUEADO

`obtenerCatalogoFiltrosCierres` (`lib/actions/cierres-admin.ts`), `findCatalogoFiltros`
(`CierresAdminRepository`), `CierresAdminService.obtenerCatalogoFiltros` y
`CatalogoFiltrosCierresDTO` existen ya en esta rama, con el catálogo acotado al alcance del
actor y con `CATALOGO_FILTROS_CIERRES_VACIO` para el `adminSatelite` sin zona. La tanda 4 tiene
de dónde poblar el diálogo sin consulta nueva y sin caso especial para la GAM, tal como el
`design.md §7` describía. **Mi borde no cambia por esto**: el catálogo es del diálogo, no de la
lectura de gestiones.

### H2 — `lib/actions/cierres-bodega-admin.ts` no existe

`design.md §3.2` y T7.3 lo nombran. En esta rama las Server Actions del lado maestro de los
cierres de bodega viven en **`lib/actions/cierre-bodega.ts`**, junto a las del `adminSatelite`,
con su `buildCierresBodegaAdminService` y su `toCierreBodegaActionError` ya cableados. Puse la
acción ahí: un módulo nuevo obligaba a duplicar el builder y el traductor de errores.

### H3 — RESUELTO por el merge: los listados sí reciben filtros

El design citaba `listarPendientesCierresAdminCompleto({ filtros })`; en `dev` la firma era
`(actor)` a secas. Con `ux` dentro, la firma real es `(actor, filtros?: FiltrosCierres)` y la
cita del design vuelve a ser exacta. Nada que hacer.

### H4 — el grano de `cierre_detail` obliga a una clave de join que el design no menciona

`design.md §2.7` describe las dos consultas «unidas por `ordenId`», calcando
`findCierreByIdEnAlcance`. Eso **es correcto para UN cierre y falso al cruzar cierres**: el
grano de `cierre_detail` es `@@unique([cierreId, ordenId])` y su propio comentario dice que el
índice por `ordenId` existe para «trazar en qué cierres apareció una orden». Emparejando sólo
por orden, dos gestiones de la misma orden en dos cierres distintos cogerían el mismo snapshot
—y con él, los mismos montos—: una de las dos filas sería falsa, en un camino money-critical.

**Qué hice:** la proyección lleva `cierreId` (clave del join, **no** una celda: R42 sigue
cumpliéndose sobre el DTO) y el emparejamiento es por `${cierreId}:${ordenId}`. Hay un caso
dedicado que lo mata (`empareja el snapshot por (cierre, orden) y no sólo por orden`).

### H5 — desviación deliberada: `filtros` es OBLIGATORIO, no opcional

`design.md §2.4` escribe `filtros?: FiltrosDescargaGestiones` y a la vez declara
`mensajeroIds: listaDeIds` **sin** `.optional()`. Las dos cosas no pueden ser ciertas: con
`filtros` ausente no hay `mensajeroIds`, y «sin mensajeros» tendría que significar «todos», que
es exactamente lo que R39 y D5 niegan. Implementé `filtros` **obligatorio** y su `mensajeroIds`
no vacío, y el borde no lleva `input: unknown = {}` por el mismo motivo.

**RATIFICADO por el humano el 2026-08-18:** `mensajeroIds` queda obligatorio y no vacío. «Sin
mensajeros» no es «todos», es error (R39). No se reabre.

### H6 — `toIngresoOrdenex` pedía la fila entera de la gestión y sólo usa `resultado`

Para reusarla desde la proyección de descarga (que no lee `evidenciaStoragePath`) le estreché
el parámetro a `Pick<GestionAdminRow, "resultado">`. Cero cambio de comportamiento; evita
duplicar la derivación del ingreso, que es money-critical.

### H7 — la guardia `superficie-de-uso` mordió, y es correcto que mordiera

Las dos Server Actions nuevas nacen sin UI (las tandas 4/5/7.4 son de otro agente y aterrizan
después), así que `tests/unit/guards/superficie-de-uso.guardia.test.ts` las marcó huérfanas.
Anoté las dos con `@sin-superficie` diciendo que es **temporal y de esta misma feature**. La
segunda mitad de esa guardia («ninguna anotación sobrevive a su motivo») pone rojo el día que
se cableen, así que **el agente de UI tiene que borrar las dos anotaciones en el commit del
montaje**. No es deuda escondida: es deuda con alarma.

### H8 — cinco dobles de test ajenos tuvieron que crecer

Ampliar `ICierresAdminRepository` e `ICierresBodegaAdminRepository` rompió el typecheck de seis
suites que implementan la interfaz entera a mano. Añadí el método nuevo devolviendo `[]` en
cada una, con una línea de comentario. No cambié ni una aserción. Es el coste normal de
ampliar un contrato, no un hallazgo, pero queda dicho para que el reviewer no lo lea como
manipulación de tests ajenos.

---

## 2. Archivos

### Nuevos

| Archivo | Qué |
| --- | --- |
| ~~`lib/types/filtros-cierres.ts`~~ | Dejó de ser nuevo: gana el módulo de `ux` y sobre él se re-injertó `filtrosDescargaGestionesSchema` + `FiltrosDescargaGestiones` (T1.2, ver H1) |
| `tests/unit/types/filtros-descarga-gestiones-schema.test.ts` | Lista blanca, rango, lista vacía (T1.2) |
| `tests/unit/components/cierre-resultado-fila-label.test.ts` | Los cinco singulares y la no-derivación del plural (T1.3) |
| `tests/unit/repositories/cierres-admin-gestiones-where.test.ts` | WHERE, orden y proyección del camino A (T2.1) |
| `tests/unit/repositories/cierres-bodega-gestiones-where.test.ts` | WHERE, orden y proyección del camino B (T7.1) |
| `tests/unit/repositories/cierres-gestiones-descarga-dto.test.ts` | El DTO que cruza la frontera: sin evidencia, sin uuid, money-safe, join por (cierre, orden), error duro y paridad de los dos caminos |
| `tests/unit/services/CierresAdminService.gestiones-completo.test.ts` | Alcance, tope, firmador, desenlaces (T2.2) |
| `tests/unit/services/CierresBodegaAdminService.gestiones-completo.test.ts` | Guard de acceso total, tope, firmador (T7.2) |
| `tests/unit/actions/cierres-gestiones-descarga-action.test.ts` | Los DOS bordes con la misma tabla de casos (T2.3 + T7.3) |

### Modificados

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/services/ICierresAdminService.ts` | `CierreGestionDescargaDTO`, `ListarGestionesDescargaServiceResult`, `listarGestionesCierresAdminCompleto` |
| `lib/interfaces/services/ICierresBodegaAdminService.ts` | `listarGestionesCierresBodegaCompleto` (importa el DTO, no lo redeclara) |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | `findGestionesPorAlcanceCompleto` |
| `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts` | `findGestionesDeCierresBodegaCompleto` |
| `lib/repositories/CierresAdminRepository.ts` | `GESTION_DESCARGA_SELECT`, `DETALLE_DESCARGA_SELECT`, `toGestionDescargaDTO`, `componerGestionesDescarga`, `ORDEN_GESTIONES_DESCARGA` y el método; `filtrosWhere` pasa a exportarse (H1.b); `toIngresoOrdenex` estrecha su parámetro (H6) |
| `lib/repositories/CierresBodegaAdminRepository.ts` | El método de bodega, reusando las piezas anteriores + `filtrosWhere` sin declarar nada propio (R26) |
| `lib/services/CierresAdminService.ts` | `listarGestionesCierresAdminCompleto` |
| `lib/services/CierresBodegaAdminService.ts` | `listarGestionesCierresBodegaCompleto` |
| `lib/types/filtros-cierres.ts` | `listaDeIdsRequerida` extraída de `listaDeIds`, y el schema de la 230 sobre las primitivas de `ux` (H1) |
| `lib/types/cierres-admin.ts` | `ListarGestionesCierresAdminCompletoResult` |
| `lib/types/cierre-bodega.ts` | `ListarGestionesCierresBodegaCompletoResult` |
| `lib/actions/cierres-admin.ts` | Server Action del camino A |
| `lib/actions/cierre-bodega.ts` | Server Action del camino B (ver H2) |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | `RESULTADO_FILA_LABEL` (módulo puro de etiquetas; NO es UI) |
| 6 suites ajenas | El método nuevo en su doble del repositorio (ver H8) |

**Sin migración, sin tabla nueva, sin RLS nueva, sin ruta `app/api/`, sin tocar
`db/schema.prisma` ni `middleware.ts`** — la feature no escribe.

---

## 3. Mapa `R<n>` → test (sólo los requisitos de MI alcance)

Los `R<n>` de UI (R1, R4-R10, R12, R23, R26-R35, R39, R40, R43-R52 en su mitad de columnas)
los cierran las tandas 3-7.4; abajo van los que este entregable hace verificables.

| R | Test |
| --- | --- |
| R11 | `cierres-admin-gestiones-where.test.ts` › `ordena por fecha de solicitud del cierre y luego por la gestión` + `cierres-bodega-gestiones-where.test.ts` › `usa el MISMO orden que el camino de cierres del día` |
| R13 | `cierres-gestiones-descarga-action.test.ts` › `con sesión y entrada válida, delega en el servicio y devuelve su conjunto` (los dos bordes) |
| R14 | `CierresAdminService.gestiones-completo.test.ts` › `el satélite no recibe gestiones de cierres fuera de su zona destino` + `cierres-admin-gestiones-where.test.ts` › `pone el alcance del satélite DENTRO de la relación cierre` |
| R15 | `CierresAdminService.gestiones-completo.test.ts` › `el alcance no se lee de la entrada: pedir mensajeros ajenos no amplía nada` + `CierresBodegaAdminService.gestiones-completo.test.ts` › `pasa los recortes del diálogo TAL CUAL` |
| R16 | `CierresAdminService.gestiones-completo.test.ts` (el alcance sale de `resolveAlcance`, no de un criterio propio: lo miden los casos de maestro/satélite/satélite-sin-zona) |
| R17 | `cierres-gestiones-descarga-action.test.ts` › `devuelve unauthenticated sin parsear la entrada y sin filas` |
| R18 | `CierresAdminService.gestiones-completo.test.ts` › `un rol no admin recibe forbidden antes de tocar el repositorio` |
| R19 | `filtros-descarga-gestiones-schema.test.ts` › `una clave fuera de la lista blanca produce validation_error…` + `cierres-gestiones-descarga-action.test.ts` › idem en los dos bordes |
| R20 | `CierresAdminService.gestiones-completo.test.ts` › `un adminSatelite sin zona recibe conjunto vacío sin consultar la base, y NO forbidden` |
| R21 | `CierresAdminService.gestiones-completo.test.ts` › `superar el tope de descargaConfig…` + `…justo EN el tope…` + `CierresBodegaAdminService.gestiones-completo.test.ts` › `superar el tope…` |
| R22 | `CierresAdminService.gestiones-completo.test.ts` › `no se firma ninguna URL de evidencia…` + su gemelo de bodega + `cierres-admin-gestiones-where.test.ts` › `la proyección NO lee evidencia_storage_path` |
| R24 | `cierres-bodega-gestiones-where.test.ts` › `sólo devuelve gestiones de cierres del día consolidados en un cierre de bodega` |
| R25 | `CierresBodegaAdminService.gestiones-completo.test.ts` › `un rol sin acceso total recibe forbidden antes de tocar el repositorio` |
| R26 (mitad de datos) | `cierres-gestiones-descarga-dto.test.ts` › `los DOS caminos producen la MISMA fila para la misma gestión` + `cierres-bodega-gestiones-where.test.ts` › `usa la MISMA proyección, sin evidencia` |
| R27 (mitad de datos) | `cierres-gestiones-descarga-dto.test.ts` › `una gestión de un cierre con destino bodega central sale por el camino A sin trato especial` + `CierresAdminService.gestiones-completo.test.ts` › `el maestro recibe las gestiones de su alcance: los cierres con destino bodega central` |
| R31 | `filtros-descarga-gestiones-schema.test.ts` › `cada borde del rango es independiente del otro` + `cierres-admin-gestiones-where.test.ts` › `el rango de fechas recorta por la fecha de solicitud del CIERRE, con `hasta` inclusivo` |
| R32 | `filtros-descarga-gestiones-schema.test.ts` › `un rango invertido produce validation_error` + `cierres-gestiones-descarga-action.test.ts` › `un rango invertido produce validation_error sin tocar el servicio` |
| R33 (mitad de servidor) | `CierresAdminService.gestiones-completo.test.ts` › `el rango de fechas recorta DENTRO del alcance, nunca fuera` |
| R36 (mitad de servidor) | `cierres-gestiones-descarga-action.test.ts` › `con sesión y entrada válida, delega…` (una sola llamada, un solo borde) |
| R37 | `CierresAdminService.gestiones-completo.test.ts` › `pedir un mensajero fuera de alcance devuelve cero filas, no filas ajenas` + `cierres-admin-gestiones-where.test.ts` › `un mensajero de otra zona NO se convierte en un OR` |
| R38 | `CierresAdminService.gestiones-completo.test.ts` › `«fuera de alcance» y «sin cierres en el rango» son el MISMO desenlace` |
| R39 (mitad de servidor) | `filtros-descarga-gestiones-schema.test.ts` › `una lista vacía de mensajeros se rechaza…` + `cierres-gestiones-descarga-action.test.ts` › `confirmar sin ningún mensajero muere en el borde` |
| R41 | `cierres-gestiones-descarga-dto.test.ts` › `no emite NINGÚN campo de evidencia, ni siquiera derivado` + `cierres-admin-gestiones-where.test.ts` › `la proyección es la del detalle menos la evidencia…` |
| R42 | `cierres-gestiones-descarga-dto.test.ts` › `no emite ningún identificador interno de registro` + `CierresBodegaAdminService.gestiones-completo.test.ts` › `ninguna fila… identificadores internos` |
| R43 | `cierres-gestiones-descarga-dto.test.ts` › `los montos salen como el STRING del snapshot, escala 2, sin símbolo ni separador` |
| R45 (mitad de etiquetas) | `cierre-resultado-fila-label.test.ts` › `ninguna etiqueta es el value del enum` |
| R46 | `cierres-gestiones-descarga-dto.test.ts` › `un dato nulo llega nulo, nunca como el marcador de pantalla` |
| R47 | `cierres-gestiones-descarga-dto.test.ts` › `una indemnización sin capturar llega null y NUNCA cero` |

---

## 4. Verificación ejecutada

Sin `./init.sh` y sin la suite completa (los corre el leader). Todo desde `C:/w230`, **después
de resolver el merge con `origin/ux`** y de un `pnpm db:generate` (el cliente Prisma quedó
obsoleto respecto del schema que trae `ux`: `RutaOptimizadaRepository` daba 11 errores de tipos
fantasma que no eran de código).

```
$ pnpm typecheck
> tsc --noEmit
(sin salida → 0 errores)

$ pnpm lint
✖ 75 problems (0 errors, 75 warnings)
```

Los 75 son `@typescript-eslint/no-unused-vars` preexistentes de toda la suite (parámetros
`_args`, `_actor`, …). Cuatro son míos, en los dos `*-gestiones-where.test.ts`, y son el MISMO
patrón `_args?: Consulta` que ya usan `historicos-paginados-where.test.ts` y
`colas-paginadas-where.test.ts`. **0 errores nuevos.**

```
$ pnpm exec vitest run <mis 8 archivos de test>
 Test Files  8 passed (8)
      Tests  93 passed (93)

$ pnpm exec vitest run tests/unit/services tests/unit/repositories tests/unit/actions tests/unit/types
 Test Files  355 passed (355)
      Tests  5412 passed (5412)

$ pnpm exec vitest run tests/unit/guards tests/unit/descarga
 Test Files  79 passed (79)
      Tests  927 passed (927)

$ pnpm exec vitest run tests/components/descarga
 Test Files  17 passed (17)
      Tests  142 passed (142)

$ pnpm exec vitest related --run <los 11 fuentes tocados>
 Test Files  4 failed | 90 passed (94)
      Tests  38 failed | ...
```

**Los 38 rojos NO son míos y no los diagnostiqué**, por instrucción expresa. Están todos en
cuatro archivos de `ordenes`, ninguno de cierres:

```
tests/unit/components/ordenes-listado-buscador.test.tsx   (8 tests | 3 failed)
tests/unit/components/ordenes-listado.test.tsx            (18 tests | 13 failed)
tests/unit/components/ordenes-listado-filtros.test.tsx    (17 tests | 16 failed)
tests/components/OrdenesPageFiltros.test.tsx              (8 tests | 6 failed)
```

Son los que la rama `ux` ya arrastraba (38 rojos en `ordenes-listado`, medidos el 2026-08-16);
llegan con el merge, no con este trabajo. Los toco `vitest related` sólo porque comparten el
grafo de `lib/types/*`, no porque este entregable los roce.

## 5. Lo que queda abierto para quien siga

1. ~~R29 no tiene de dónde salir~~ — **DESBLOQUEADO** por el merge con `ux` (H1.c). El catálogo
   existe (`obtenerCatalogoFiltrosCierres` → `findCatalogoFiltros`), acotado al alcance y con su
   caso vacío para el `adminSatelite` sin zona. La tanda 4 puede poblar el diálogo sin abrir una
   consulta nueva.
2. **Las dos anotaciones `@sin-superficie` se retiran al cablear la UI** (H7). No es opcional:
   la guardia se pone roja si sobreviven a su motivo.
3. **38 rojos ajenos heredados de `ux`** en `ordenes-listado`/`OrdenesPageFiltros`, anotados
   arriba sin diagnosticar.
4. **T7.5(b)** («ningún `if` sobre `esCentral` en el código nuevo») es un grep del subárbol y
   pertenece a la tanda 7 de UI. Por mi parte lo puedo afirmar de palabra —no hay ni una
   mención a `esCentral` en el código que escribí, salvo la lectura del snapshot que ya
   existía— pero el test que lo mide no es mío.
