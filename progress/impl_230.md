# Feature 230 — bitácora de implementación · BACKEND (tandas 1, 2 y 7 backend)

> Agente: `backend_dev`. Worktree `C:/w230`, rama
> `feature/230-descarga-cierres-general-y-detallada`, nacida de `origin/dev` en `9b627059`.
>
> **Alcance entregado:** tanda 1 completa (T1.1, T1.2, T1.3), tanda 2 completa (T2.1, T2.2,
> T2.3) y la parte BACKEND de la tanda 7 (T7.1, T7.2, T7.3).
> **Fuera de alcance, no tocado:** tandas 3, 4, 5, 6, T7.4 y T7.5 (declaración de columnas,
> diálogo, montajes de UI y las guardias transversales que dependen de ellos).

---

## 1. Hallazgos — dónde el código contradijo a la spec

Los tres primeros son de aterrizaje: `design.md` se escribió mirando el árbol de la rama `ux`,
y esta feature nace de `dev`. Ninguno bloquea, pero el reviewer los tiene que ver.

### H1 — `lib/types/filtros-cierres.ts` NO EXISTÍA en la rama base

`design.md §3.1` sitúa el schema nuevo «en el mismo módulo y desde las mismas primitivas»
(`listaDeIds` `:34-38`, `fechaCalendario` `:30-32`, `rangoCoherente`/`MENSAJE_RANGO` `:62-67`).
En `origin/dev@9b627059` ese archivo **no existe**: los filtros de cierres (commit `4c9a888e`,
«cuatro filtros por alcance en el backend de cierres») viven en `ux`, sin mergear. Tampoco
existen `filtrosWhere`, `findCatalogoFiltros`, `rangoSolicitadoAt` ni
`obtenerCatalogoFiltrosCierres`, que el design cita por `ruta:línea`.

**Qué hice, y por qué no es inventar:** creé `lib/types/filtros-cierres.ts` con el schema y con
las primitivas **copiadas por valor** de `lib/types/orden.ts:102-107` y `:152-156`, que es la
declaración viva de esas mismas primitivas en esta rama (`idList`, `fechaCalendario` y el
`refine` de rango no invertido). Está documentado en la cabecera del módulo. El día que `ux`
mergee, es un conflicto de UN archivo y una decisión de dos líneas: fundirlos o dejarlos.

**Consecuencia sobre R29 (catálogo de mensajeros del diálogo):** el design apoya la lista del
diálogo en `obtenerCatalogoFiltrosCierres` → `findCatalogoFiltros`, que **no existen aquí**.
R29 es de la tanda 4 (UI) y no de mi alcance, pero el agente que la haga se va a encontrar sin
esa lectura. Es un bloqueo real de la tanda 4, no mío.

### H2 — `lib/actions/cierres-bodega-admin.ts` no existe

`design.md §3.2` y T7.3 lo nombran. En esta rama las Server Actions del lado maestro de los
cierres de bodega viven en **`lib/actions/cierre-bodega.ts`**, junto a las del `adminSatelite`,
con su `buildCierresBodegaAdminService` y su `toCierreBodegaActionError` ya cableados. Puse la
acción ahí: un módulo nuevo obligaba a duplicar el builder y el traductor de errores.

### H3 — `listarPendientesCierresAdminCompleto` no recibe filtros en esta rama

El design lo cita como `listarPendientesCierresAdminCompleto({ filtros })`. Aquí la firma es
`(actor)` a secas: los filtros por listado son de `ux`. No afecta a lo entregado (los métodos
nuevos son suyos propios), pero invalida la lectura literal de esa cita.

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
no vacío, y el borde no lleva `input: unknown = {}` por el mismo motivo. Si el humano prefiere
la otra lectura, es un cambio de una línea por capa.

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
| `lib/types/filtros-cierres.ts` | `filtrosDescargaGestionesSchema` + `FiltrosDescargaGestiones` + `MENSAJE_RANGO_DESCARGA_GESTIONES` (T1.2, ver H1) |
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
| `lib/repositories/CierresAdminRepository.ts` | `GESTION_DESCARGA_SELECT`, `DETALLE_DESCARGA_SELECT`, `toGestionDescargaDTO`, `componerGestionesDescarga`, `recortesDescargaGestionesWhere`, `ORDEN_GESTIONES_DESCARGA` y el método; `toIngresoOrdenex` estrecha su parámetro (H6) |
| `lib/repositories/CierresBodegaAdminRepository.ts` | El método de bodega, reusando las SEIS piezas anteriores sin declarar nada propio (R26) |
| `lib/services/CierresAdminService.ts` | `listarGestionesCierresAdminCompleto` |
| `lib/services/CierresBodegaAdminService.ts` | `listarGestionesCierresBodegaCompleto` |
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

Sin `./init.sh` y sin la suite completa (los corre el leader). Todo desde `C:/w230`.

```
$ pnpm typecheck
> ordenex@0.1.0 typecheck C:\w230
> tsc --noEmit
(sin salida → 0 errores)

$ pnpm lint
✖ 73 problems (0 errors, 73 warnings)
```

Los 73 son `@typescript-eslint/no-unused-vars` preexistentes en toda la suite (parámetros
`_args`, `_actor`, …). Cuatro de ellos son míos, en los dos `*-gestiones-where.test.ts`, y son
el MISMO patrón `_args?: Consulta` que ya usan `historicos-paginados-where.test.ts` y
`colas-paginadas-where.test.ts`: el parámetro se declara explícitamente porque es justo lo que
esos casos afirman. **0 errores nuevos.**

```
$ pnpm exec vitest run <mis 8 archivos de test nuevos>
 Test Files  8 passed (8)
      Tests  92 passed (92)

$ pnpm exec vitest related --run lib/repositories/CierresAdminRepository.ts \
    lib/repositories/CierresBodegaAdminRepository.ts lib/services/CierresAdminService.ts \
    lib/services/CierresBodegaAdminService.ts lib/actions/cierres-admin.ts \
    lib/actions/cierre-bodega.ts lib/types/filtros-cierres.ts lib/types/cierres-admin.ts \
    lib/types/cierre-bodega.ts
 Test Files  94 passed (94)
      Tests  1431 passed (1431)

$ pnpm exec vitest related --run "app/(app)/cierres-admin/_components/cierre-labels.ts" \
    lib/interfaces/services/ICierresAdminService.ts \
    lib/interfaces/repositories/ICierresAdminRepository.ts \
    lib/interfaces/services/ICierresBodegaAdminService.ts \
    lib/interfaces/repositories/ICierresBodegaAdminRepository.ts
 Test Files  36 passed (36)
      Tests  571 passed (571)

$ pnpm exec vitest run tests/unit/descarga tests/unit/guards
 Test Files  77 passed (77)
      Tests  913 passed (913)
```

La última corrida es la que destapó H7: en su primera pasada,
`superficie-de-uso.guardia.test.ts` estaba rojo con las dos acciones nuevas. Con la anotación
`@sin-superficie` documentada, verde.

**Cero rojos ajenos observados** en lo que corrí.

---

## 5. Lo que queda abierto para quien siga

1. **R29 no tiene de dónde salir en esta rama** (H1): no existe `obtenerCatalogoFiltrosCierres`
   ni `findCatalogoFiltros`. La tanda 4 la necesita para poblar el diálogo. Decisión del
   humano/leader: portarla desde `ux`, escribirla nueva, o esperar al merge.
2. **Las dos anotaciones `@sin-superficie` se retiran al cablear la UI** (H7). No es opcional:
   la guardia se pone roja si sobreviven a su motivo.
3. **T7.5(b)** («ningún `if` sobre `esCentral` en el código nuevo») es un grep del subárbol y
   pertenece a la tanda 7 de UI. Por mi parte lo puedo afirmar de palabra —no hay ni una
   mención a `esCentral` en el código que escribí, salvo la lectura del snapshot que ya
   existía— pero el test que lo mide no es mío.
