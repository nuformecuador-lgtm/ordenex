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
2. **El baseline del briefing estaba caduco**: 12 archivos rojos, no 2 (§6).
3. **Purga de `jobs`** (heredado de la 91, Q8): con un tercer tipo por evento el crecimiento se
   acelera. Sigue sin feature.
4. **Coordenadas de bodega/zona** como origen real cuando no hay GPS (Q4): hoy se usa el centroide.
5. **Coste del SKU de `optimizeTours`** (Q9): sin confirmar. Conviene confirmarlo antes de
   habilitar en producción; la reversión a Routes API queda contenida en `lib/clients/`,
   `lib/config/` y `lib/auth/google-sa-token.ts`.

## Veredicto

Backend de la feature 92 completo y verificado: typecheck 0, lint 0 errores sin nuevos warnings,
219 tests propios en verde, cero regresiones contra el baseline medido, y round-trip real de
migraciones (UP → DOWN → RE-UP) ejecutado contra un Postgres desechable en docker.
