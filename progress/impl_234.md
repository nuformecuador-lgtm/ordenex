> **RENUMERADA A 234 el 2026-08-19.** Nacio como «feature 230» en la rama `ux`, pero `dev`
> ya tenia una 230 distinta («el dinero se pinta sin centimos») con su propio directorio de
> spec y sus commits. Se renumera esta conservando el slug, que es el precedente del repo.
> El PR #391 y los commits de la rama siguen diciendo 230: es historia, no se reescribe.

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

---
---

# Feature 230 — bitácora de implementación · FRONTEND (tandas 3, 4, 5, 6, T7.4, T7.5)

> Agente: `frontend_dev`. Mismo worktree `C:/w230`, misma rama, sobre `54fccc4b` (la rama nace de
> `ux`, no de `dev`: los listados de cierres son ya la tira de comprobantes de `2fd98ea1`).
>
> **Alcance entregado:** tanda 3 completa (T3.1–T3.6), tanda 4 completa (T4.1, T4.2), tanda 5
> (T5.1), tanda 6 completa (T6.1, T6.2, T6.3), T7.4 y T7.5, y T8.2 (esta bitácora).
> **Fuera de alcance, no tocado:** backend entero (servicios, repositorios, Server Actions,
> schema) y T8.1 (el gate `./init.sh`, que corre el leader).

## 6. Hallazgos de la capa de presentación

### H9 — el `design.md` describe una UI que `ux` ya había reescrito (y aun así encajó)

`design.md §7` sitúa el control «junto al general que ya monta `descargaColaCierres`
(`CierresAdminModule.tsx:192-202`)». Esa cita es de la rama vieja: con `ux` dentro, los seis
listados de cierres pasaron de `DataTable` a `ListaComprobantes` y **el control de descarga ya no
vive dentro de la tabla**, sino en la fila de las pestañas, alineado con el `SegmentedToggle`
(pedido humano del 2026-08-16). Se montó **donde el control general vive HOY**: envolviendo los
dos en un `div` de la misma fila. La INTENCIÓN del requisito —«un control más, junto al general,
visible en las dos pestañas» (R1/R23)— se cumple igual; lo que no se hizo fue resucitar la tabla
muerta para que la cita del design fuese literal.

**Consecuencia menor y deliberada:** el general se monta condicionado a la pestaña activa (cada
pestaña tiene su archivo); el detallado **no**, porque su conjunto no depende de la pestaña —lo
redacta su diálogo (D11)—. Por eso hay un solo control detallado por pantalla y no uno por panel.

### H10 — el diálogo no «llama» al `DescargarDatasetButton`: lo CONTIENE

`design.md §7` dice «confirmar llama a `DescargarDatasetButton` con `obtenerFilas: …`». Un botón
no se puede llamar. Lo que se hizo es lo que esa frase quería decir: el `DescargarDatasetButton`
es el **botón de confirmar del diálogo**, montado en su cuerpo (`Modal` con `hideConfirm`), con su
`obtenerFilas` cerrado sobre la selección vigente. Se gana exactamente lo que el design buscaba:
el binario, el tope, el «sin datos» y la traducción de `limite_excedido` / `forbidden` /
`unauthenticated` salen del MISMO sitio que en las otras 25 descargas, y **D12/R38 sale gratis**
—«sin cierres» y «fuera de alcance» llegan los dos como `{ ok, items: [] }` y no hay rama que los
distinga—.

**Lo que esto obliga, y está resuelto:** el control no admite `disabled` externo, así que los dos
cortes de R39/R32 («ningún mensajero» y «rango invertido») se hacen DENTRO de `obtenerFilas`,
devolviendo el mismo contrato de error. No se llama al servidor y no se produce archivo; el
rango invertido además se dice a la vista (`role="alert"`), no solo por toast.

**El diálogo NO se cierra solo al descargar.** El binario se arma en el navegador dentro de ese
control: desmontarlo a mitad del vuelo sería cortar la generación del archivo que el usuario acaba
de pedir. Se cierra cuando el usuario cierra.

### H11 — las dos anotaciones `@sin-superficie` de la 230: RETIRADAS en el mismo commit

H7 dejó el encargo y se cumple aquí. Se retiraron **exactamente dos**:
`listarGestionesCierresAdminCompleto` (`lib/actions/cierres-admin.ts`) y
`listarGestionesCierresBodegaCompleto` (`lib/actions/cierre-bodega.ts`), en el commit que monta los
dos controles. `tests/unit/guards/superficie-de-uso.guardia.test.ts` sigue verde (18/18).

**Aviso para el reviewer:** en el primer barrido se borró de más —la anotación de
`listarCierresBodegaAdmin`, que es de las features 170/184 y NO de ésta— y se restauró en el acto.
El `git diff` de `lib/actions/` es de **4 líneas, todas de borrado**, y son las dos anotaciones de
la 230 con su línea de separación.

### H12 — DOS clases de test ajeno hubo que tocarlas, y las dos son hallazgo (T6.2)

T6.2 pide que los tests existentes pasen **sin modificarse**, y dice que si alguno hubo que
tocarlo es un hallazgo. Hubo dos clases, y ninguna toca una aserción:

1. **Diez suites de componente tuvieron que ampliar su doble** (`vi.mock` con factoría explícita de
   `@/lib/actions/cierres-admin` / `@/lib/actions/cierre-bodega`). Es la mitad de UI del H8 del
   backend: una factoría enumera los exports, así que **importar una acción más desde el módulo
   rompe el doble** con «No "listarGestionesCierresAdminCompleto" export is defined on the mock».
   Se añadió `listarGestionesCierresAdminCompleto: vi.fn()` (y su gemela de bodega) con una línea
   de comentario. Cero aserciones tocadas. Afectados: `CierresAdminDeepLink`, `CierresAdminFiltros`,
   `CierresAdminIndemnizacion`, `CierresAdminModule`, `CierresAdminPage`, `CierresAdminPagoMensajero`,
   `descarga/CierresDescarga`, `paginacion/BajoRiesgoPaginacion`, `paginacion/ColasPaginacion`,
   `paginacion/paginacion-transversal`.

2. **`CierresAdminFiltros.test.tsx` › «(3) el filtro se lleva a la descarga»** localizaba el control
   con `getByRole("button", { name: /Descargar/ })`. Desde R1 la fila tiene **DOS** controles de
   descarga, así que la regex encuentra dos y el caso ya no podía decir cuál pulsaba. Se cambió por
   el **nombre accesible exacto del general**. Lo que el caso afirma no cambia —el GENERAL sí se
   lleva el filtro de la pantalla—; lo que cambia es que ahora lo dice sin ambigüedad. **Es
   exactamente el riesgo que R51 nombra**: dos controles en la misma pantalla necesitan nombres
   accesibles distintos, y un test que los busca por prefijo deja de servir el día que nace el
   segundo.

`cierres-admin-descarga-columnas.test.ts`, `cierres-bodega-descarga-columnas.test.ts` y
`cierre-gestiones-descarga-columnas.test.ts` **no se tocaron** (R2/R3): las cinco declaraciones por
sección y las dos generales siguen byte a byte, y `TIENE_EVIDENCIA_*` + `tieneEvidencia` siguen
exportados y en uso.

### H13 — la fundida calcula SIEMPRE las dieciséis celdas específicas, y hay un `??` que parece de más

`filaDescargaGestionFundida` deriva las 16 celdas específicas para cualquier resultado y luego
apaga las que no aplican. No es derroche: (a) la derivación de cada celda vive en un sitio
—`montoCobrar` está en los cinco resultados, `motivo` en cuatro—; y (b) **la guardia de datos
sensibles ejecuta la proyección con una SONDA**, y una rama que no se recorre es una lectura que la
guardia no vigila. Por lo mismo hay un `ESPECIFICAS_POR_RESULTADO[g.resultado] ?? CLAVES_ESPECIFICAS`
que en producción nunca cae: bajo la sonda, `resultado` no es ninguno de los cinco, y sin ese
respaldo la guardia vería dieciséis nulos en vez de dieciséis lecturas. Está documentado en el
módulo para que nadie lo «limpie» sin saber qué apaga.

### H14 — el `aria-label` de cada casilla se retiró: duplicaba el nombre accesible

Primera versión: `Checkbox` con `aria-label` + su `Label` asociado. Con las dos cosas,
`getByLabelText("Ana Mensajera")` encontraba DOS elementos. La casilla ya toma su nombre del
`Label` (base-ui pone el `aria-labelledby`), así que el `aria-label` sobraba y se quitó: el nombre
accesible sigue siendo el del mensajero y los tests lo localizan por
`getByRole("checkbox", { name })`, que es lo que hace un lector de pantalla.

---

## 7. Archivos (frontend)

### Nuevos

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts` | **T3.1.** `COLUMNAS_DESCARGA_GESTIONES_FUNDIDA` (26) + `filaDescargaGestionFundida`. PURO, sin columna de evidencia |
| `app/(app)/cierres-admin/_components/DescargarGestionesDialog.tsx` | **T4.1.** El diálogo (mensajeros + rango propio) y su control. Recibe la Server Action por prop: UNO para las dos pantallas |
| `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts` | **T3.2/T3.3/T3.4.** Orden y censo literal de las 26, proyección por resultado, invariantes de celda y la ausencia de evidencia |
| `tests/unit/descarga/cierre-gestiones-cabecera.guardia.test.ts` | **T3.6.** Guardia de prosa (R52), con sus dos canarios sintéticos |
| `tests/components/descarga/DescargarGestionesDialog.test.tsx` | **T4.1/T4.2.** Diálogo aislado: R28-R32, R34, R35, R39 |
| `tests/components/descarga/CierresAdminDescargaDetallada.test.tsx` | **T5.1.** El montaje en cierres del día: R1, R4, R6, R33, R38, R51 |
| `tests/components/descarga/CierresBodegaDescargaDetallada.test.tsx` | **T7.4.** El montaje en cierres de bodega: R23 + mitad de UI de R24/R26 |
| `tests/unit/guards/cierres-descarga-detallada-frontera.guardia.test.ts` | **T6.1.** Frontera (R16), sin ruta `app/api/`, pureza del módulo (R49), DTO sin evidencia (R41), sin `esCentral` (R27) |
| `tests/unit/descarga/cierres-descarga-detallada-puerta.test.ts` | **T6.1.** Puerta única (R13) y recorte del MISMO borde sin consulta paralela (R36) |
| `tests/unit/descarga/cierres-descarga-detallada-money.guardia.test.ts` | Money-safe de la fundida (R43/R44) |
| `tests/unit/descarga/cierres-gestiones-paridad.test.ts` | **T7.5.** Paridad de los dos caminos (R26) y GAM sin trato especial (R27) |

### Modificados

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts` | **T3.5. SOLO la cabecera** (R52). Ni una línea de código: el `git diff` es comentario |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | **T5.1.** Monta el diálogo junto al general, en las dos pestañas (ver H9) |
| `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx` | **T7.4.** Idem, con la acción de bodega |
| `lib/actions/cierres-admin.ts` · `lib/actions/cierre-bodega.ts` | **SOLO** la retirada de las dos anotaciones `@sin-superficie` de la 230 (H11). Cero cambios de código |
| 10 suites de componente ajenas | El export nuevo en su doble del módulo de acciones (H12.1) |
| `tests/components/CierresAdminFiltros.test.tsx` | El selector del control general, ahora exacto (H12.2) |

**Sin backend tocado**: ni servicios, ni repositorios, ni el cuerpo de las Server Actions, ni
`lib/types/`, ni schema, ni migraciones, ni `middleware.ts`, ni `app/api/`.

---

## 8. Mapa `R<n>` → test (los requisitos que cierra el FRONTEND)

Los que cerró el backend están en §3 y no se repiten salvo cuando esta capa añade su mitad.

| R | Test |
| --- | --- |
| R1 | `CierresAdminDescargaDetallada.test.tsx` › `la pantalla ofrece un control de descarga detallada además del general (R1)` |
| R2 | `CierresDescarga.test.tsx` (sin cambio de aserciones; ver H12.1) + `cierres-admin-descarga-columnas.test.ts` + `cierres-bodega-descarga-columnas.test.ts` (intactos) + `CierresBodegaDescargaDetallada.test.tsx` › `los cuatro controles de descarga que ya existían siguen en su sitio` |
| R3 | `cierre-gestiones-descarga-columnas.test.ts` (intacto) + `cierres-gestiones-fundida-descarga-columnas.test.ts` › `las constantes de la marca de evidencia siguen exportadas y sin cambios (R3)` |
| R4 | `CierresAdminDescargaDetallada.test.tsx` › `descargar no cambia la página, ni los filtros, ni el detalle abierto (R4)` |
| R5 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `emite una fila por gestión y ninguna fila agregada (R5/D2)` |
| R6 | `CierresAdminDescargaDetallada.test.tsx` › `produce un solo archivo de una sola hoja para un conjunto con los cinco resultados (R6)` |
| R7 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `toda fila lleva la columna Resultado con la etiqueta singular de su resultado (R7)` |
| R8 | idem › `toda fila lleva el nombre del mensajero dueño del cierre (R8)` |
| R9 | idem › `las 26 columnas salen en el orden declarado sea cual sea el resultado (R9)` + `declara las 26 columnas en el orden decidido (design §6)` |
| R10 | idem › `una columna que no aplica al resultado deja la celda vacía y no se omite (R10)` + los cinco casos por resultado |
| R12 | idem › `la fundida no declara ni estado del cierre ni destino (R12)` |
| R13 | `cierres-descarga-detallada-puerta.test.ts` › `las filas salen de la Server Action de esa pantalla y de ninguna otra fuente (R13)` |
| R16 | `cierres-descarga-detallada-frontera.guardia.test.ts` › `el borde de descarga no importa servicio, repositorio ni Prisma (R16)` + `ninguna ruta de app/api sirve esta descarga` |
| R23 | `CierresBodegaDescargaDetallada.test.tsx` › `el listado de cierres de bodega ofrece el control de descarga detallada (R23)` |
| R24 (mitad de UI) | idem › `descargar aquí llama al borde de BODEGA y no al de cierres del día (R24/R26)` |
| R26 | `cierres-gestiones-paridad.test.ts` › `los dos caminos proyectan la misma fila desde la misma declaración de columnas` + `CierresBodegaDescargaDetallada.test.tsx` (mismas 26 columnas y misma hoja desde la otra pantalla) |
| R27 | `cierres-gestiones-paridad.test.ts` › `una gestión con destino bodega central sale por el camino de cierres del día (R27)` + `cierres-descarga-detallada-frontera.guardia.test.ts` › `el código nuevo no ramifica por esCentral (R27)` |
| R28 | `DescargarGestionesDialog.test.tsx` › `pulsar el control abre el diálogo y no descarga nada todavía (R28)` |
| R29 | idem › `el diálogo solo ofrece mensajeros del catálogo del alcance (R29)` |
| R30 | idem › `permite seleccionar varios mensajeros a la vez (R30)` |
| R31 | idem › `ofrece un rango de fechas opcional que viaja al borde (R31)` + `el rango es opcional de verdad: sin fechas no viaja ninguna clave de fecha (R31)` |
| R32 (mitad de cliente) | idem › `un rango invertido no produce archivo (R32)` |
| R33 | `CierresAdminDescargaDetallada.test.tsx` › `el archivo solo contiene gestiones de los mensajeros y el rango confirmados (R33)` |
| R34 | `DescargarGestionesDialog.test.tsx` › `el objeto enviado al borde contiene solo lo elegido en el diálogo (R34)` |
| R35 | idem › `el control detallado no lee ni modifica ningún filtro de la pantalla (R35)` |
| R36 | `cierres-descarga-detallada-puerta.test.ts` › `lo elegido viaja como filtro del mismo borde, sin consulta paralela (R36)` |
| R38 (mitad de UI) | `CierresAdminDescargaDetallada.test.tsx` › `un mensajero sin cierres y uno fuera de alcance producen el mismo mensaje (R38)` |
| R39 (mitad de cliente) | `DescargarGestionesDialog.test.tsx` › `cancelar o confirmar sin selección no produce archivo ni llama al borde (R39)` |
| R40 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `la fundida no declara ninguna columna de evidencia y ninguna celda la lee (R40)` |
| R41 (mitad de UI) | idem › `el DTO que alimenta la fila no declara campo de evidencia alguno (R41)` + `cierres-descarga-detallada-frontera.guardia.test.ts` › `el DTO de descarga no declara ningún campo de evidencia (R41)` + `columnas-sensibles.guardia.test.ts` (la fundida entra en su censo) |
| R42 | `columnas-sensibles.guardia.test.ts` › `ninguna fila de export emite un identificador interno con forma de uuid` (la fundida ya está dentro) |
| R43 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `los montos salen como el string del snapshot, sin símbolo ni separador (R43/R44)` + `cierres-descarga-detallada-money.guardia.test.ts` › `tampoco emite el símbolo de la moneda ni separadores de miles (R43)` |
| R44 | `cierres-descarga-detallada-money.guardia.test.ts` › `el módulo de la fundida no contiene parseFloat, Number ni aritmética sobre montos (R44)` |
| R45 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `resultado, método, causa y origen salen como etiqueta legible (R45)` + `cierre-resultado-fila-label.test.ts` (backend, T1.3) |
| R46 | idem › `un dato nulo deja la celda vacía y nunca el guion de pantalla (R46)` |
| R47 | idem › `una indemnización sin capturar deja la celda vacía y nunca cero (R47)` |
| R48 | `columnas-sensibles.guardia.test.ts` › `la guardia cubre TODAS las declaraciones del árbol, no una lista fija` (la fundida aparece por convención de nombre) |
| R49 | `cierres-descarga-detallada-frontera.guardia.test.ts` › `el módulo de columnas de la fundida es puro: no importa React ni toca el DOM (R49)` |
| R50 | `columnas-asercion-de-orden.guardia.test.ts` › `ninguna constante COLUMNAS_DESCARGA_* se queda sin aserción de orden` (la fundida deja de estar «desnuda» gracias a T3.2) |
| R51 | `CierresAdminDescargaDetallada.test.tsx` › `los controles de la pantalla tienen nombres accesibles distintos y el archivo se llama distinto (R51)` |
| R52 | `cierre-gestiones-cabecera.guardia.test.ts` › `la cabecera ya no afirma que no existe un archivo único y conserva la razón de la P2` |

**R14, R15, R17-R22, R25, R37 y la mitad de servidor de R38** los cierra el backend (§3). **T6.3**
no añadió tests nuevos: los cuatro casos que pedía (maestro, satélite con zona, satélite sin zona y
un `mensajeroIds` de otra zona) ya existen y pasan en
`CierresAdminService.gestiones-completo.test.ts`; esta capa añade la mitad observable desde la
pantalla (R38, arriba). Escribir un quinto doble del servicio desde un test de componente habría
medido el doble, no el alcance.

---

## 9. Verificación ejecutada (frontend)

Sin `./init.sh` y sin la suite completa, por instrucción: los corre el leader. Todo desde `C:/w230`.

```
$ pnpm typecheck
> tsc --noEmit
(sin salida → 0 errores)

$ pnpm lint
✖ 76 problems (0 errors, 76 warnings)
```

75 warnings eran el baseline del backend; **el 76 es mío**: `'_recorte' is defined but never used`
en `DescargarGestionesDialog.test.tsx`. Es deliberado y es el patrón del repo: el doble de la
Server Action declara su parámetro —aunque no lo use— para que `mock.calls[0][0]` esté TIPADO, que
es sobre lo que se afirma R34. Un espía sin firma lo deja en `never` y la aserción no comprobaría
nada. **0 errores nuevos.**

```
$ pnpm exec vitest run tests/unit/descarga tests/unit/guards tests/components/descarga
 Test Files  104 passed (104)
      Tests  1117 passed (1117)

$ pnpm exec vitest related --run <los 7 fuentes tocados: el diálogo, las columnas, los dos
                                 módulos de pantalla, la cabecera de la 170 y las dos acciones>
 Test Files  33 passed (33)
      Tests  480 passed (480)

$ pnpm exec vitest run <las 6 suites de CierresAdmin* + tests/components/paginacion>
 Test Files  12 passed (12)
      Tests  173 passed (173)
```

**Cero rojos, y ninguno de los 38 ajenos de `ordenes-listado` aparece en estas selecciones**: el
grafo de esta capa no los toca.

---

## 10. Lo que queda abierto para quien siga

1. **T8.1 (el gate) no está marcado**: `./init.sh` completo lo corre el leader antes del PR, con el
   baseline de 38 rojos ajenos de `ux` medido.
2. **Los 38 rojos ajenos** (`ordenes-listado-buscador`, `ordenes-listado`, `ordenes-listado-filtros`,
   `OrdenesPageFiltros`) siguen ahí y siguen sin diagnosticar. No los toca nada de esta capa.
3. **El diálogo no ofrece «seleccionar todos» ni buscador de mensajeros.** Con un catálogo largo la
   lista se hace incómoda; no se añadió porque ningún requisito lo pide y porque «todos» es
   justamente la lectura que D5/R39 niegan por defecto. Si el humano lo quiere, es una decisión de
   producto, no un olvido.
4. **`ConsolidacionBodegaModule` (adminSatelite) sigue sin control detallado**, tal como
   `design.md §7` decidió explícitamente. El `adminSatelite` tiene su descarga detallada por el
   botón de `cierres-admin`, donde su alcance es su zona.
