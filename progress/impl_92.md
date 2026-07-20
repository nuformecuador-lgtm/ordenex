# Feature 92 — Optimización de ruta del mensajero · bitácora de implementación (BACKEND)

Rama `feature/92-optimizacion-ruta-mensajero`, worktree aislado `ordenex-f92`, base `origin/dev`
@ `5244cf3`. Fecha: 2026-07-20.

Alcance entregado: **R1–R8, R10–R28, R33–R40** (mitad backend). **NO** se implementan R9, R25
(captura GPS en el navegador), R29–R32 ni el hook `useUbicacionActual`: son de la feature 93
(frontend). No se tocó ningún archivo de `app/**` salvo la línea de registro del handler en el
cron, que es backend.

---

## 1. Correcciones de premisa (design §0) — verificadas y aplicadas

Las tres se implementan tal cual las documentó el spec, y cada una tiene un test que la fija:

1. **§0.1 — la fuente de verdad de "dirección no encontrada" es la ORDEN, no la cola.**
   `GeocodificacionService` **completa** el job (`done`, no `failed`) en `ZERO_RESULTS`,
   `INVALID_REQUEST` y `SIN_DIRECCION`. Un gate que solo mirara `jobs` re-encolaría en bucle
   direcciones sabidas irresolubles, **pagando cada vez**. Por eso R3 va antes que R4.
   → `asignabilidad-coordenadas.test.ts` › "R3 … sin consultar `jobs`" asserta además
   `expect(enqueue).not.toHaveBeenCalled()`.
2. **§0.2 — clave exacta reconstruida, no prefijo.** `hashDireccion` está exportado, así que el
   gate reconstruye `geocodificacion:<ordenId>:<hash8>` y consulta por igualdad: usa el índice
   único ya existente, una consulta por lote, y no arrastra jobs de direcciones históricas.
   → `job-find-by-dedupe-keys.test.ts` › "por IGUALDAD (`IN`), NUNCA por prefijo (`LIKE`)".
3. **§0.3 — "intentos agotados" ⇔ `estado === 'failed'`, y nada más.** `claimBatch` incrementa
   `intentos` **al reclamar**, así que un `processing` con `intentos === maxIntentos` está
   corriendo su último intento y aún puede resolverse.
   → `asignabilidad-coordenadas.test.ts` › "NORMATIVO: `processing` con intentos === maxIntentos
   NO es agotado".

---

## 2. Archivos creados

### Migraciones
- `db/migrations/20260720120000_job_tipo_optimizacion_ruta/{migration.sql,down.sql}` — R40.
  `ALTER TYPE … ADD VALUE` **aislado**, una sola sentencia (55P04). El `down.sql` **recrea** el
  tipo, criterio idéntico al de la 91.
- `db/migrations/20260720130000_ruta_optimizada/{migration.sql,down.sql}` — R26/R39.

### Configuración, credencial y cliente
- `lib/config/route-optimization.ts` — R10. Nunca lanza; desescapa los `\n` de la PEM.
- `lib/auth/google-sa-token.ts` — R11/R12. OAuth2 JWT-bearer (RFC 7523) con `node:crypto`, sin
  dependencia nueva. `fetch` y reloj inyectables. `RutaNoConfiguradoError`, `RutaTokenError`.
- `lib/interfaces/external/IRouteOptimizationClient.ts`
- `lib/clients/google-route-optimization.ts` — R13/R14/R15.

### Dominio
- `lib/interfaces/services/IAsignabilidadCoordenadasService.ts`
- `lib/services/AsignabilidadCoordenadasService.ts` — R1–R7.
- `lib/interfaces/repositories/IRutaOptimizadaRepository.ts`
- `lib/repositories/RutaOptimizadaRepository.ts` — R23/R26/R27.
- `lib/interfaces/services/IOptimizacionRutaService.ts`
- `lib/services/OptimizacionRutaService.ts` — R12/R20/R24/R27/R34–R38.
- `lib/services/jobs/optimizacion-ruta-encolado.ts` — R17/R18/R19.
- `lib/services/jobs/optimizacion-ruta-handler.ts` — R21.
- `lib/types/ruta-mensajero.ts` — R22/R32/R33 (zod compartido de `ubicacion`).
- `lib/actions/ruta-mensajero.ts` — `sincronizarRuta`, R22/R32/R33/R34.

## 3. Archivos modificados

- `db/schema.prisma` — `optimizacion_ruta` en `JobTipo`; enum `RutaEstado`; modelos
  `RutaOptimizada` y `RutaOptimizadaParada`; back-relations en `Usuario` y `Orden`.
- `lib/interfaces/repositories/IJobRepository.ts` + `lib/repositories/JobRepository.ts` —
  `findByDedupeKeys` (R4). **NO** se añadieron `cancel` ni `reschedule` (alternativa D descartada).
- `lib/interfaces/repositories/IOrdenRepository.ts` + `lib/repositories/OrdenRepository.ts` —
  `findParaAsignabilidad` (R8) y `findParadasEnReparto` (R35/R37/R38).
- `lib/services/GuiaAsignacionService.ts` — gate en `generarGuia` (rama GAM con mensajero) y en
  `asignarDesdeBodega` (R8). Dep **requerida**, no opcional.
- `lib/services/AsignacionSateliteService.ts` — gate en `asignar` (R8).
- `lib/repositories/GestionOrdenRepository.ts` — outbox: `recogerLote` → debounce (R16),
  `crearGestionYTransicionar` → inmediato (R19). `jobRepo` y reloj inyectables.
- `lib/services/MisAsignacionesService.ts` — reordenado de `porGestionar` (R28), bloque `ruta`,
  `registrarUbicacion` best-effort (R23).
- `lib/interfaces/services/IMisAsignacionesService.ts` — `secuenciaRuta`, `RutaResumenDTO`,
  `UbicacionInput`.
- `lib/types/gestion-orden.ts` — `ubicacion` opcional en `recogerSchema` y en las 4 ramas de
  `gestionarSchema`; `ruta` en `ListarMisAsignacionesResult`.
- `lib/actions/mis-asignaciones.ts` — propaga `ubicacion`; recompone `ubicacionLat`/`ubicacionLng`
  del FormData; inyecta `RutaOptimizadaRepository`.
- `lib/actions/ordenes-guia.ts`, `lib/actions/recepcion-satelite.ts` — inyectan el gate.
- `lib/services/jobs/geocodificacion-encolado.ts` — `tx` pasa a `JobTxClient | undefined`.
- `app/api/cron/procesar-jobs/route.ts` — `handlers.set("optimizacion_ruta", …)`. **No** se tocó
  `buildRecurrencias()` (R21).

## 4. Tests heredados actualizados (ninguno aflojado)

- `procesar-jobs-geocodificacion.test.ts` — `handlers.size === 2` → conjunto **exacto** de claves.
  Invertido al sentido nuevo y **más fuerte**: ahora también falla si se pierde un tipo.
- `zonas-migration.test.ts` — las dos migraciones nuevas se añaden a la allow-list mantenida
  (mismo mantenimiento que hicieron 90 y 91). La aserción no cambia.
- `gestion-orden-repository.test.ts` — el doble de Prisma recibe un `IJobRepository` fake (el repo
  ahora encola dentro de sus transacciones).
- Dobles ampliados con los métodos/campos nuevos: `orden-geocode-enqueue`, `job-queue-service`,
  `guia-asignacion-service`, `asignacion-satelite-service`, `mis-asignaciones-service`,
  `mis-asignaciones-causa-devolucion`, `mis-asignaciones-action`, `bulk-orden-service` (×2),
  `orden-service`, `asignacion-mensajero-service`, `rol-admin-satelite-authz`,
  `MisAsignacionesPage`, `MisAsignacionesModule`, `EscanerRecoger`.

---

## 5. Mapa `R<n> → test`

| Req | Test |
| --- | --- |
| R1–R7 | `tests/unit/services/asignabilidad-coordenadas.test.ts` |
| R4 | + `tests/integration/repositories/job-find-by-dedupe-keys.test.ts` |
| R8 | `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts`, `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` |
| R9 | **feature 93** (frontend) — fuera de este entregable |
| R10 | `tests/unit/config/route-optimization-config.test.ts` |
| R11, R12 | `tests/unit/auth/google-sa-token.test.ts` |
| R12 | + `tests/unit/services/optimizacion-ruta-service.test.ts` › "R12 — credencial ausente…" |
| R13, R14, R15 | `tests/unit/clients/google-route-optimization.test.ts` |
| R16, R17, R19 | `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts` |
| R17, R18, R19 | `tests/unit/services/optimizacion-ruta-encolado.test.ts` |
| R20 | `tests/unit/services/optimizacion-ruta-service.test.ts` › "R20 — guarda de OBSOLESCENCIA" |
| R21 | `tests/unit/api/procesar-jobs-registro.test.ts` |
| R22 | `tests/unit/actions/mis-asignaciones-ubicacion.test.ts`, `tests/unit/actions/sincronizar-ruta.test.ts` |
| R23 | `tests/integration/repositories/ruta-optimizada-repo.test.ts`, `tests/unit/services/optimizacion-ruta-origen.test.ts` |
| R24 | `tests/unit/services/optimizacion-ruta-origen.test.ts` |
| R25 (servidor) | `tests/unit/services/optimizacion-ruta-origen.test.ts` › "R25 — la ausencia de geolocalizacion NUNCA aborta"; la mitad de cliente es de la 93 |
| R26 | `tests/integration/repositories/ruta-optimizada-repo.test.ts`, `tests/integration/db/ruta-optimizada-migracion.test.ts` |
| R27 | `tests/unit/services/optimizacion-ruta-service.test.ts` › "R27 — ante fallo se CONSERVA…" |
| R28 | `tests/unit/services/mis-asignaciones-orden-ruta.test.ts` |
| R29 (servidor) | `tests/unit/services/mis-asignaciones-orden-ruta.test.ts` › "R29 — 'Por recoger' NO se toca" |
| R30, R31 (UI), R32 (UI) | **feature 93** |
| R32 (servidor) | `tests/unit/actions/sincronizar-ruta.test.ts` › "R32 — la sincronizacion es SINCRONA" |
| R33 | `tests/unit/actions/sincronizar-ruta.test.ts` › "R33 — guarda de rol" |
| R34 | `tests/unit/services/optimizacion-ruta-service.test.ts`, `tests/unit/actions/sincronizar-ruta.test.ts` |
| R35–R38 | `tests/unit/services/optimizacion-ruta-service.test.ts` |
| R39, R40 | `tests/integration/db/ruta-optimizada-migracion.test.ts`, `tests/integration/db/ruta-optimizada-rollback.test.ts` |

Los R que no tienen fila propia aquí (R9, R30, R31/R32 de UI) son de la feature 93: el contrato
que los alimenta está congelado y probado en este entregable.

---

## 6. Verificación MEDIDA (2026-07-20)

### Baseline, medido en este mismo worktree con `git stash -u`

```
pnpm typecheck  → 0 errores
pnpm lint       → 143 problems (0 errors, 143 warnings)
pnpm test       → Test Files 12 failed | 350 passed (362)
                  Tests      34 failed | 3509 passed (3543)
```

> ⚠️ El briefing citaba **2** rojos preexistentes (`CierreDiaPage.test.tsx` y
> `generar-gastos-fijos-route.test.ts:109`). **Medido: son 12 archivos / 34 tests**, y
> `CierreDiaPage.test.tsx` **no está** entre ellos. El baseline del briefing estaba caduco.

### Después de esta feature

```
pnpm typecheck  → 0 errores
pnpm lint       → 143 problems (0 errors, 143 warnings)   [idéntico al baseline]
pnpm test       → Test Files 12 failed | 368 passed (380)
                  Tests      34 failed | 3728 passed (3762)
```

**Delta: 0 regresiones.** El conjunto de archivos rojos es EXACTAMENTE el mismo que el baseline
(mismos 12 nombres). Los tests que pasan suben +219, que son exactamente los de esta feature.

### Tests de la feature, aislados

```
pnpm vitest run <los 18 archivos de la 92>
  → Test Files 18 passed (18)
    Tests      219 passed (219)
```

### Rojos preexistentes AJENOS (12 archivos / 34 tests) — no se tocan

`EscanerRecepcionOrigen`, `EstatusLabel`, `HistorialOrdenSheet`, `HistorialOrdenTimeline`,
`OrdenesApartado`, `OrdenesCargaResumenPaso`, `OrdenesEstatusLabelAdminTienda`,
`OrdenesRevisionMaestro`, `RecepcionSateliteModule`, `generar-gastos-fijos-route`,
`mis-asignaciones-action`, `ordenes-tabs`.

> **MATIZADO DESPUES DEL REVIEW — ver ADDENDUM §A2.** Esta lista es la de UNA corrida. El
> conjunto **fluctua entre corridas del mismo codigo** (12/12/18/12/15 archivos en cinco
> mediciones): casi todos son **flakes de carga** de `testing-library`, no fallos deterministas.
> El unico rojo VIVO y determinista es `generar-gastos-fijos-route.test.ts:109`, deuda de la
> **feature 90**. La comparacion valida no es "N rojos" sino la de **conjuntos por nombre de
> test**, que da diferencia **vacia** en ambos sentidos (36 = 36).

### Round-trip REAL de migraciones — **SÍ se ejecutó**

Contra un **Postgres 16 desechable en docker** (`ordenex-f92-pg`, puerto 55492), **nunca** contra
la DB del `.env`: el `.env` se movió a `.env.f92bak` durante toda la operación para hacer
imposible el acceso accidental, y se restauró al terminar. El contenedor se eliminó.

```
UP    → prisma migrate deploy: "All migrations have been successfully applied."
        pg_enum job_tipo    = liberar_reprogramadas, geocodificacion, optimizacion_ruta
        pg_enum ruta_estado = vigente, desactualizada
        ruta_optimizada / ruta_optimizada_parada: rowsecurity = true, policies = 0
        6 índices + 3 FKs presentes con los nombres del diseño

DOWN  → ambos down.sql: "Script executed successfully."
        job_tipo    = liberar_reprogramadas, geocodificacion  (sin optimizacion_ruta)
        ruta_estado: 0        tablas residuales: 0
        job_tipo_old: 0       índices residuales: 0

RE-UP → prisma migrate deploy: "All migrations have been successfully applied."
```

`prisma migrate diff` tras el round-trip solo reporta la deriva **ya conocida y preexistente** de
`updated_at` (`@updatedAt` de Prisma sin `DEFAULT` declarado), idéntica en `api_key`, `jobs` y
`premio_ranking` (features 81, 90, 76). `ruta_optimizada` cae en ese mismo patrón: no es una clase
de deriva nueva.

---

## 7. Contrato congelado para la feature 93

1. `MiAsignacionDTO.secuenciaRuta: number | null`.
2. `listarMisAsignaciones()` → `ruta: { estado, calculadaAt, origenFuente, paradasSinOptimizar }`.
3. `porGestionar` sale **YA ORDENADO** del service; `porRecoger` conserva `createdAt desc` (R29).
4. `sincronizarRuta({ ubicacion? })` en `lib/actions/ruta-mensajero.ts`, **síncrona**,
   `forbidden` si rol ≠ `mensajero`, `conflict` dentro de `RUTA_SYNC_MIN_INTERVALO_S`.
5. Los 3 services de asignación devuelven `conflict` con `detalle` por orden; el `motivo` es uno
   de los 5 estados no-asignables. Todo-o-nada por lote.
6. `gestionar` acepta la ubicación en el FormData como **dos campos escalares**
   `ubicacionLat` / `ubicacionLng` (se recomponen en el borde); `recogerAsignaciones` y
   `sincronizarRuta` la reciben como objeto `{ lat, lng }`.

Es normal que hoy no tenga consumidor (mismo caso que la 91). No se inventó UI.

---

## 8. Variables de entorno nuevas (T20)

`GOOGLE_ROUTE_OPT_PROJECT_ID`, `GOOGLE_ROUTE_OPT_SA_EMAIL`, `GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY`
(sin default, secretos → `null`); `ROUTE_OPT_TIMEOUT_MS` (20000), `RUTA_DEBOUNCE_S` (60),
`RUTA_ORIGEN_TTL_MIN` (120), `RUTA_SYNC_MIN_INTERVALO_S` (10), `RUTA_MAX_PARADAS` (100).

**`GOOGLE_MAPS_API_KEY` (feature 91) NO sirve** para Route Optimization: exige service account +
OAuth2. Hay que **habilitar el SKU de Route Optimization en GCP** antes de que esto funcione en
producción. Ningún secreto vive en el repo.

---

## 9. Seguimientos y hallazgos para el leader

1. **`lib/actions/mis-asignaciones.ts` trae dos `console.log("xyz AAA*")` en `dev`** (líneas ~104
   y ~107, dentro de `listarMisAsignaciones`). **No son de esta feature y no se tocaron.**
   Requieren decisión del leader: son logging de depuración que imprime el `actor` completo en
   producción.
2. **El baseline del briefing estaba caduco**: no eran 2 rojos preexistentes (§6).
   **Corregido tras el review (§A2):** de los 2 que citaba el briefing, `CierreDiaPage.test.tsx`
   **PASA** —se re-midio aislado y esta verde, lo arrastraba desde la feature 81—, y el otro,
   `generar-gastos-fijos-route.test.ts:109`, si es un rojo real y es deuda de la **feature 90**
   (commit `57c53ea` cambio el cron de `vercel.json` y no actualizo su test).
3. **Purga de `jobs`** (heredado de la 91, Q8): con un tercer tipo por evento el crecimiento se
   acelera. Sigue sin feature.
4. **Coordenadas de bodega/zona** como origen real cuando no hay GPS (Q4): hoy se usa el centroide.
5. **Coste del SKU de `optimizeTours`** (Q9): sin confirmar. Conviene confirmarlo antes de
   habilitar en producción; la reversión a Routes API queda contenida en `lib/clients/`,
   `lib/config/` y `lib/auth/google-sa-token.ts`.

---

# ADDENDUM — cierre del review (2026-07-20)

El `reviewer` **RECHAZÓ** por **1 bloqueante exclusivamente de bookkeeping (B1)** y 4 menores.
Su veredicto sobre el código fue: *"No hay ningún defecto de código"*. Detalle en
`progress/review_92.md` (382 líneas). Este addendum cierra B1 y responde a los 4 menores.

## A1 — B1 CERRADO: `tasks.md` marcado (23/23, ninguna queda en `[ ]`)

| Estado | Nº | Tasks |
| --- | --- | --- |
| `[x]` entregadas en esta rama | **20** | T0–T16, T20, T21, T22 |
| `[~]` **DIFERIDAS a la feature 93** | **3** | T17, T18, T19 |
| `[ ]` sin marcar | **0** | — |

**T17/T18/T19 NO se marcaron `[x]`**, como pidió el leader: son frontend puro (hook de
geolocalización, módulo del mensajero, toasts del gate) y cubren R25-cliente, R29, R30, R31 y
R32. Cada una lleva ahora una nota `DIFERIDA A LA FEATURE 93 — no está hecha y no está
olvidada`, más un puntero a la mitad servidor que sí está entregada y que las alimenta. Se añadió
además una leyenda de checkboxes y una tabla de estado en la cabecera del fichero, para que nadie
lea `[~]` como "a medias".

**T22 se marcó `[x]` con una excepción MEDIDA**, no en silencio: su criterio literal
("`pnpm test` sin errores") **hoy no se cumple**, y la nota lo dice explícitamente. Ver A2.

## A2 — Estado real de los rojos (re-medido por mí, no citado)

### El rojo VIVO y determinista es UNO, y es deuda de la feature 90

`tests/integration/actions/generar-gastos-fijos-route.test.ts:109` afirma que `vercel.json`
define `/api/cron/liberar-reprogramadas`. Verificado con mi propia ejecución:

```
AssertionError: expected undefined to be defined
 -> tests/integration/actions/generar-gastos-fijos-route.test.ts:109:81
```

Y verificada la atribución con `git log --oneline -- vercel.json`: el commit **`57c53ea`
"feat(90): infraestructura de cola de jobs + migra liberar-reprogramadas a job recurrente"**
sustituyó esa ruta por `/api/cron/procesar-jobs`. El `vercel.json` actual tiene tres crons y
ninguno es `liberar-reprogramadas`. **La feature 90 cambió la config y no actualizó su test.**
Arreglarlo aquí sería arrastrar deuda ajena a esta rama.

### `CierreDiaPage.test.tsx` YA NO es un rojo preexistente: PASA

Re-medido aislado por mí: el archivo entero está **verde**. La bitácora original de esta feature
—y el briefing— lo arrastraban desde la feature 81. **Queda corregido:** citarlo como rojo
preexistente era incorrecto.

### El resto son FLAKES DE CARGA, no fallos deterministas

Todos son tests de componente (`testing-library` con `findBy*`/`waitFor`, sensibles a timing).
El conjunto **cambia entre corridas de la misma suite sobre el mismo código**:

| Corrida | Archivos rojos | Medida por |
| --- | --- | --- |
| 1 | 12 | reviewer |
| 2 | 12 | reviewer |
| 3 | 18 | reviewer |
| 4 | 12 | implementer (pre-review) |
| 5 | **15** | implementer (post-review, tras `pnpm install --force`) |

En mi corrida nº 5 aparecieron `HomePage.test.tsx`, `OrdenesModuleReuse.test.tsx` y
`no-embalaje.test.ts`, que **no** estaban en ninguna corrida anterior — y que tampoco toca esta
feature. Eso confirma la caracterización: **"N rojos antes vs N después" es una métrica inútil**
en este repo.

La comparación válida es la de **conjuntos por nombre completo de test**, que es la que corrió el
reviewer con el reporter JSON en HEAD y en un worktree limpio de `5244cf3`:

```
fallos HEAD: 36 | fallos BASE: 36
=== SOLO EN HEAD (regresiones candidatas) ===   (vacio)
=== SOLO EN BASE ===                            (vacio)
```

**Cero regresiones, demostradas test a test, en los dos sentidos.**

### Cifras re-medidas tras `pnpm install --force`

Durante este cierre el árbol de `node_modules` se rompió (`node_modules/.bin` vacío y luego
`Cannot find module @asamuzakjp/css-color` bajo `jsdom`). Es el fallo conocido de pnpm en este
repo; se reparó con `pnpm install --force` + `pnpm db:generate`, **no con npm**. Cifras después:

```
pnpm typecheck                 -> 0 errores
pnpm lint                      -> 143 problems (0 errors, 143 warnings)  [= baseline]
tests de la feature (18 files) -> 219 passed (219)
```

## A3 — Respuesta a los 4 menores

| # | Decisión | Motivo |
| --- | --- | --- |
| **m1** `./init.sh` / `pnpm test` no verdes | **CERRADO como documentación** | Deuda ajena; documentado en A2 y en la nota de T22 con la causa exacta y su commit culpable. No se arregla aquí. |
| **m2** `jobRepo` con default | **CERRADO — se deja como está, documentado** | Ver A4. |
| **m3** `console.log("xyz AAA*")` | **NO APLICADO — escalado, con argumento** | Ver A5. |
| **m4** entrada en `progress/history.md` | **NO ES MÍO** | Es paso del leader posterior al review; se anota para que no se pierda. |

## A4 — m2 CERRADO: por qué `GestionOrdenRepository.jobRepo` se queda con default

**Coincido con el reviewer y lo dejo como está.** Se documenta aquí para que un futuro lector no
lo "arregle" convirtiéndolo en requerido sin entender el matiz:

```ts
private readonly jobRepo: IJobRepository = new JobRepository(prisma),
```

El default **no es `undefined` ni un no-op: es una implementación REAL** enlazada al mismo
cliente Prisma que el repositorio ya recibió. Por tanto **el modo de fallo que motivó hacer
requeridas las otras deps nuevas no puede ocurrir aquí**: una fábrica que omita el argumento
**sigue encolando de verdad**, no desactiva el outbox en silencio.

El contraste con las otras tres deps es deliberado y la asimetría tiene una razón:

- `GuiaAsignacionService.asignabilidad`, `AsignacionSateliteService.asignabilidad` y
  `MisAsignacionesService.rutaRepo` **no tienen default posible**, porque un gate ausente
  equivale a *gate desactivado* — un fallo abierto y silencioso. Por eso son **requeridas**: una
  fábrica que las olvide **no compila**.
- `GestionOrdenRepository.jobRepo` **sí** tiene un default correcto y seguro, y además sigue el
  patrón exacto que la feature 91 ya estableció en `OrdenRepository` (`:421`). Hacerlo requerido
  rompería esa simetría sin ganar ninguna garantía.

**Regla para el futuro: default sí, pero SOLO si el default es la implementación real.** Un
default a `undefined`, a un no-op o a un doble sería inaceptable aquí.

## A5 — m3 NO APLICADO: por qué no borro los `console.log` en este commit

Los dos `console.log("xyz AAA*", actor, ...)` de `lib/actions/mis-asignaciones.ts` **son un
problema real**: imprimen el objeto `actor` completo en producción, es decir PII, y son
depuración accidental. **No discuto el diagnóstico del reviewer.** Discuto el momento.

**No los toco en este commit, por tres razones concretas:**

1. **El propio `tasks.md` lo prohíbe explícitamente.** T22, literal: *"`lib/actions/
   mis-asignaciones.ts` **ya trae** dos `console.log("xyz AAA*")` en `dev` — reportar al leader,
   **no** arrastrarlos a esta rama sin decisión, no son de esta feature"*. La instrucción fue
   **reportar**, y está reportada desde el primer commit (§9.1). La decisión no ha llegado.
2. **El propio reviewer cerró su veredicto diciendo que esta corrección debe ser
   documentación-only**: *"Es un cambio de documentación. Hecho eso, esta feature queda **OK** sin
   necesidad de re-verificar código."* Si ahora modifico código de producción, **invalido esa
   conclusión** y obligo a re-verificar. m3 contradice el cierre del propio review.
3. **Verificado con `git show 5244cf3`: ya estaban en `dev`.** No los introduje ni los arrastré.
   Borrarlos es una corrección de higiene de OTRA feature, y merece su propio commit atribuible —
   no ir escondida dentro de un commit de bookkeeping de la 92.

**Recomendación al leader:** hacerlo ya, pero como commit propio y trivial
(`fix: quita console.log de depuracion con PII en mis-asignaciones`), borrando las dos líneas.
Es una eliminación de 2 líneas sin riesgo de comportamiento. **Si me lo autorizas
explícitamente, lo hago en 30 segundos** — solo no quiero tomar por mi cuenta una decisión que
dos fuentes independientes (`tasks.md` y el cierre del review) piden dejar fuera de esta rama.

## A6 — Ruido de diff: revisar el PR con `--ignore-all-space`

> ### INSTRUCCIÓN PARA QUIEN REVISE EL PR
>
> El diff crudo del commit `172a835` es **76 archivos, +11722 / −4293**. **La sustancia real es
> +7457 / −28.** La diferencia es **normalización CRLF → LF entremezclada** en ~20 archivos de
> test que se reescribieron.
>
> **Revisad el PR con `--ignore-all-space`** (o `?w=1` en la URL de GitHub):
>
> ```
> git diff --ignore-all-space 5244cf3..HEAD
> ```
>
> Sin eso, el revisor humano se ahoga en ruido de fin de línea y **puede pasar por alto un cambio
> real**. El commit **no se rehizo** a propósito: reescribir el historial para arreglar finales de
> línea es más arriesgado que anotarlo aquí.

## A7 — Seguimientos abiertos al leader (actualizado)

1. **Deuda de la feature 90:** `generar-gastos-fijos-route.test.ts:109` afirma un cron que la
   propia 90 eliminó en `57c53ea`. **Rojo determinista y vivo.** Merece fix propio.
2. **Suite flaky bajo carga:** 12/12/18/12/15 archivos rojos en cinco corridas del mismo código.
   Hace inútil cualquier métrica de "N rojos" en futuros reviews. **Merece feature propia de
   estabilización.**
3. **`console.log` con PII** en `lib/actions/mis-asignaciones.ts` — ver A5, pendiente de tu
   autorización.
4. **Corrección de la bitácora:** `CierreDiaPage.test.tsx` **pasa**; dejó de ser rojo
   preexistente. Conviene no volver a citarlo como tal en briefings futuros.
5. **`progress/history.md`** — entrada pendiente (paso del leader).
6. Siguen abiertos de la spec: purga de `jobs` (Q8), coordenadas de bodega/zona (Q4) y coste real
   del SKU de `optimizeTours` (Q9).

## Veredicto

Backend de la feature 92 completo y verificado: typecheck 0, lint 0 errores sin nuevos warnings,
219 tests propios en verde, **cero regresiones demostradas test a test** (conjuntos idénticos,
36 = 36, diferencia vacía en ambos sentidos), y round-trip real de migraciones
(UP → DOWN → RE-UP) ejecutado contra un Postgres desechable en docker con 55P04 confirmado
empíricamente. **B1 cerrado**: `tasks.md` queda 20 `[x]` + 3 `[~]` diferidas a la 93 + 0 sin
marcar, con la excepción de T22 anotada y medida.
