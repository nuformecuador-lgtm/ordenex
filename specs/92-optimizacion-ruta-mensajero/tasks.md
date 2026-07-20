# Feature 92 — Optimización de ruta del mensajero · tasks

Rama `feature/92-optimizacion-ruta-mensajero` desde `origin/dev` **limpio** (worktree aislado; NO
checkout sobre `flow`: hay WIP ajeno sin commitear y drift de sesiones paralelas).

`[P]` = paralelizable con las tareas de su mismo bloque. Cada task cierra con un commit propio
(`docs/conventions.md`): `feat(92): ...` / `test(92): ...` / `chore(92): ...`.

**Orden de bloques:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7.
Bloques 2 y 3 pueden correr en paralelo entre sí (backend_dev / backend_dev) una vez cerrado el 1.
El bloque 5 (frontend) depende del 4.

---

## Bloque 0 — Preparación

### [ ] T0 · Worktree y baseline
Crear worktree aislado desde `origin/dev`, `pnpm install --force` si el árbol de `node_modules` está
roto, `pnpm db:generate` desde el schema limpio y **medir** typecheck + tests **antes** de tocar nada.
**Depende de:** —
**Hecho:** `pnpm typecheck`, `pnpm lint` y `pnpm test` corridos y sus resultados anotados en
`progress/impl_92.md` como baseline con fecha. No se cita ningún baseline heredado.

---

## Bloque 1 — Datos (bloquea a todo lo demás)

### [ ] T1 · Migración del enum `job_tipo`
`db/migrations/<ts>_job_tipo_optimizacion_ruta/` con
`ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'optimizacion_ruta';` y **ninguna** sentencia que
consuma el valor (55P04). `down.sql` documentando que Postgres no soporta quitar un valor de enum
(precedente: revisar el `down.sql` de `20260719120000_job_tipo_geocodificacion` y replicar su
criterio exacto, no inventar otro).
**Depende de:** T0 · **Cubre:** R40
**Hecho:** `pnpm db:migrate` aplica; el valor aparece en `pg_enum`; el enum del schema Prisma incluye
`optimizacion_ruta`.

### [ ] T2 · Migración de `ruta_optimizada` + `ruta_optimizada_parada`
Tablas, enum `ruta_estado`, los tres índices (`mensajero_id` único, `(ruta_id, orden_id)` único,
`(ruta_id, secuencia)` único, `orden_id`), FKs con `ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY`
sin policies en ambas. `down.sql` que revierta exactamente (design §1.1). Modelos en
`db/schema.prisma`.
**Depende de:** T1 · **Cubre:** R26, R39
**Hecho:** `pnpm db:migrate` aplica y `pnpm db:rollback` revierte sin residuos;
`tests/integration/db/ruta-optimizada-migracion.test.ts` y `...-rollback.test.ts` en verde.

---

## Bloque 2 — Cola y gate de asignabilidad

### [ ] T3 · `findByDedupeKeys` en la cola
Añadir el método a `lib/interfaces/repositories/IJobRepository.ts` y a
`lib/repositories/JobRepository.ts` (`WHERE dedupe_key IN (...)`, `keys` vacío → `[]` sin consulta).
Comentario de cabecera explicando por qué **no** es búsqueda por prefijo (design §0.2).
**Depende de:** T0 · **Cubre:** R4
**Hecho:** `tests/integration/repositories/job-find-by-dedupe-keys.test.ts` verifica: match exacto,
lote mixto, lista vacía y clave inexistente. `pnpm typecheck` limpio (la interfaz la implementan
también los dobles de los tests de 90/91: se actualizan).

### [ ] T4 · Servicio de asignabilidad por coordenadas
`lib/services/AsignabilidadCoordenadasService.ts` + su interfaz. Árbol de decisión exacto del design
§7, en este orden: coordenadas → `geocode_status` determinista → clave exacta reconstruida con
`hashDireccion` → `estado='failed'` → `pending|processing` → encolado puntual.
⚠️ **Normativo:** "intentos agotados" ⇔ `estado === 'failed'`. **NO** usar `intentos >= maxIntentos`
(design §0.3: el claim incrementa `intentos` antes de ejecutar). Copiar ese razonamiento al código.
**Depende de:** T3 · **Cubre:** R1–R7
**Hecho:** `tests/unit/services/asignabilidad-coordenadas.test.ts` cubre los **seis** estados de R1,
más el caso "dirección corregida: job `failed` del hash viejo NO bloquea".

### [ ] T5 · Enganchar el gate en los tres writers `[P]`
`GuiaAsignacionService.generarGuia` (solo la rama GAM con mensajero no nulo),
`GuiaAsignacionService.asignarDesdeBodega` y `AsignacionSateliteService.asignar`. Traducir el mapa
del gate a los `DetalleConflicto` ya existentes, **antes** de persistir, abortando todo el lote.
**Depende de:** T4 · **Cubre:** R8
**Hecho:** `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` y
`tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` verifican `conflict` sin efectos;
los tests existentes de esos tres services siguen en verde (con órdenes que ya traen coordenadas).

---

## Bloque 3 — Proveedor (paralelo al bloque 2)

### [ ] T6 · Config de Route Optimization `[P]`
`lib/config/route-optimization.ts`, clon estructural de `lib/config/geocode.ts`: **nunca lanza**,
lee `process.env` en cada llamada, secretos → `string | null`, enteros con `readPositiveInt`.
**Depende de:** T0 · **Cubre:** R10
**Hecho:** `tests/unit/config/route-optimization-config.test.ts` verifica ausente/vacío → `null`,
enteros inválidos → default y que ninguna combinación lanza.

### [ ] T7 · Token OAuth2 de service account `[P]`
`lib/auth/google-sa-token.ts`: JWT RS256 firmado con `node:crypto`, intercambio en
`oauth2.googleapis.com/token`, caché en memoria hasta `exp - 60 s`. `fetch` y reloj inyectables.
Sin dependencia nueva (**no** se añade `google-auth-library`).
**Depende de:** T6 · **Cubre:** R11, R12 (parte de credencial)
**Hecho:** `tests/unit/auth/google-sa-token.test.ts` firma con un par RSA generado en el test,
verifica claims (`iss`/`scope`/`aud`/`exp`), reutilización de token vigente, renovación al vencer y
`RutaNoConfiguradoError` con credencial incompleta **sin** llamar a `fetch`.

### [ ] T8 · Cliente `optimizeTours`
`lib/interfaces/external/IRouteOptimizationClient.ts` + `lib/clients/google-route-optimization.ts`.
**Primero** verificar los nombres reales de los campos del request/response contra la documentación
del proveedor (no están en el repo). Zod en el borde sin `passthrough`. Traducción de desenlaces
(`ok` / `transitorio` / `config_invalida`). Ningún mensaje cita token, URL ni coordenadas.
**Depende de:** T7 · **Cubre:** R13, R14, R15
**Hecho:** `tests/unit/clients/google-route-optimization.test.ts` cubre, con `fetch` mockeado y sin
red: respuesta válida, forma inválida, 401/403, 5xx, 429, timeout y ausencia de token; un test
asserta que ningún mensaje de error contiene el token ni coordenadas.

---

## Bloque 4 — Servicio de optimización y encolado

### [ ] T9 · Repositorio de ruta optimizada
`lib/repositories/RutaOptimizadaRepository.ts` + interfaz: `findByMensajero`,
`upsertOrigen`, `reemplazarSecuencia` (en `$transaction`: DELETE + createMany + UPDATE cabecera),
`marcarDesactualizada`.
**Depende de:** T2 · **Cubre:** R23, R26
**Hecho:** `tests/integration/repositories/ruta-optimizada-repo.test.ts` verifica reemplazo completo,
que los índices únicos rechazan secuencia duplicada y que el origen se persiste con su fuente.

### [ ] T10 · Helper de encolado (debounce + inmediato)
`lib/services/jobs/optimizacion-ruta-encolado.ts` con `dedupeKeyDebounce` y `dedupeKeyInmediato`.
⚠️ **Normativo:** dos **espacios de claves disjuntos** (`:debounce:` / `:inmediato:`). Si se
unificaran, el disparo de la gestión sería tragado en silencio por un debounce en vuelo. Y la clave
del debounce DEBE llevar la ventana temporal: sin ella queda ocupada para siempre por la fila `done`
(trampa F1.4-Q4 de la 91). Copiar el bloque de design §4.1/§4.2 al comentario de cabecera.
**Depende de:** T1 · **Cubre:** R17, R18, R19
**Hecho:** `tests/unit/services/optimizacion-ruta-encolado.test.ts` verifica: misma ventana → misma
clave; ventana siguiente → clave distinta; inmediato y debounce **nunca** colisionan.

### [ ] T11 · Servicio de optimización
`lib/services/OptimizacionRutaService.ts` con la secuencia de 7 pasos del design §5, incluidas las
guardas de coste (R20 obsolescencia, R35 ≤1 parada, R36 huella, R38 tope) y la resolución del origen
con sus tres escalones (§5.1). Ante fallo: **no** tocar paradas, marcar `desactualizada`, lanzar.
**Depende de:** T8, T9 · **Cubre:** R12, R20, R24, R25, R27, R34, R35, R36, R37, R38
**Hecho:** `tests/unit/services/optimizacion-ruta-service.test.ts` +
`tests/unit/services/optimizacion-ruta-origen.test.ts` con dobles: cada guarda tiene un test que
asserta **cero llamadas** al cliente, y el test de fallo asserta que la secuencia previa sigue intacta.

### [ ] T12 · Handler y registro en el drenador
`lib/services/jobs/optimizacion-ruta-handler.ts` (adaptador + fábrica de deps) y
`handlers.set("optimizacion_ruta", ...)` en `buildHandlers()` de
`app/api/cron/procesar-jobs/route.ts`. **No** tocar `buildRecurrencias()`.
**Depende de:** T11 · **Cubre:** R21
**Hecho:** `tests/unit/api/procesar-jobs-registro.test.ts` verifica que el tipo está en `buildHandlers`
y **ausente** de `buildRecurrencias`; un test asserta que un fallo de este handler no impide drenar
los demás jobs del lote.

### [ ] T13 · Outbox en los dos writers del mensajero
Inyectar `jobRepo` en `GestionOrdenRepository` (patrón `OrdenRepository` de la 91) y encolar dentro de
las transacciones ya existentes: `recogerLote` → debounce; `crearGestionYTransicionar` → inmediato con
`eventoId` = id de la gestión recién creada.
**Depende de:** T10, T12 · **Cubre:** R16, R19
**Hecho:** `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts` verifica: un job por
recogida; dos recogidas en la misma ventana → **una** fila; gestión → fila inmediata aunque haya un
debounce en vuelo; rollback de la tx → **ninguna** fila de job.

---

## Bloque 5 — Lectura y UI (depende del 4)

### [ ] T14 · Orden de las cards en el service
`MisAsignacionesService.listarMisAsignaciones` ordena `porGestionar` por secuencia asc y deja al final
las órdenes sin posición en su orden actual. `MiAsignacionDTO` gana `secuenciaRuta`; el resultado gana
el bloque `ruta`. **No** se toca el `orderBy` del repositorio ni el orden de "Por recoger".
**Depende de:** T9 · **Cubre:** R28, R29
**Hecho:** `tests/unit/services/mis-asignaciones-orden-ruta.test.ts` cubre: todas con posición; mezcla
con y sin posición; ninguna con posición (orden idéntico al actual); KPIs sin alterar.

### [ ] T15 · Server Action de sincronización manual
`lib/actions/ruta-mensajero.ts` → `sincronizarRuta`. Guarda de rol, zod en el borde para la ubicación,
ejecución **síncrona** del servicio, `withErrorHandler` (patrón `mis-asignaciones.ts`).
**Depende de:** T11 · **Cubre:** R22, R31 (servidor), R32, R33, R34
**Hecho:** `tests/unit/actions/sincronizar-ruta.test.ts` cubre `forbidden` para 3 roles distintos,
lat/lng fuera de rango → `validation_error`, y sin ubicación → ejecuta igual.

### [ ] T16 · Ubicación opcional en las actions existentes `[P]`
`recogerAsignaciones` y `gestionar` aceptan `ubicacion` **opcional** en su schema zod y la propagan
para que se persista como origen.
**Depende de:** T15 · **Cubre:** R22, R23
**Hecho:** `tests/unit/actions/mis-asignaciones-ubicacion.test.ts` verifica que la ausencia del campo
no rompe ninguna llamada existente; los tests actuales de esas dos actions siguen en verde sin cambios.

### [ ] T17 · Hook de geolocalización `[P]`
`hooks/useUbicacionActual.ts`: `getCurrentPosition` con timeout, estado `{ coords, denegado }`, nunca
lanza al render.
**Depende de:** T0 · **Cubre:** R25 (cliente)
**Hecho:** test con `navigator.geolocation` mockeado: permiso concedido, denegado y timeout — en los
tres casos el hook resuelve sin excepción.

### [ ] T18 · Módulo del mensajero: botón, aviso y orden
`MisAsignacionesModule.tsx`: botón "Sincronizar ruta" (solo mensajero), aviso de ruta desactualizada /
paradas sin optimizar, badge de posición en la card, `router.refresh()` tras sincronizar. Revisar
primero si el botón/badge existe en shadcn/ui antes de crear nada.
**Depende de:** T14, T15, T17 · **Cubre:** R25, R29, R30, R31, R32
**Hecho:** `tests/components/MisAsignacionesModule.test.tsx` (existente, se amplía) verifica: cards en
el orden de la secuencia; aviso visible con ruta desactualizada; `router.refresh()` llamado tras
sincronizar; "Por recoger" intacto; con geolocalización denegada la sincronización se dispara igual.

### [ ] T19 · Toast del gate en las UIs de asignación
`GenerarGuiaModal`, `AsignarBodegaModal` y `AsignarSateliteModal`: "Dirección no encontrada" para
`direccion_no_geocodificable` / `geocodificacion_agotada`; mensaje distinto de "validándose" para los
otros tres motivos.
**Depende de:** T5 · **Cubre:** R9
**Hecho:** los tests de esos componentes verifican los **dos** textos distintos según el motivo.

---

## Bloque 6 — Documentación y entorno

### [ ] T20 · Variables de entorno y despliegue `[P]`
Documentar las 8 variables del design §2 donde el repo documente las demás (`.env.example` /
`docs/`). Anotar explícitamente que `GOOGLE_MAPS_API_KEY` **no** sirve para este producto y que hace
falta habilitar el SKU de Route Optimization en GCP.
**Depende de:** T6 · **Cubre:** soporte de R10
**Hecho:** ningún secreto en el repo; las 8 variables listadas con su default; nota del SKU escrita.

### [ ] T21 · Mapa de trazabilidad
`progress/impl_92.md` con el mapa `R<n> → test` completo (R1..R40), la lista de archivos tocados y
los seguimientos anotados del design §11.
**Depende de:** T1–T20 · **Cubre:** trazabilidad (CHECKPOINTS)
**Hecho:** los 40 requisitos tienen al menos un test **existente y en verde**; ninguno queda huérfano.

---

## Bloque 7 — Verificación final

### [ ] T22 · Suite completa y gate de calidad
**Depende de:** T21
**Hecho:** `./init.sh` en verde; `pnpm typecheck`, `pnpm lint` y `pnpm test` sin errores y **sin
regresión** contra el baseline de T0; `pnpm db:migrate` + `pnpm db:rollback` + `pnpm db:migrate`
completan; `console.log` de depuración eliminados de los archivos tocados (ojo: `lib/actions/
mis-asignaciones.ts` **ya trae** dos `console.log("xyz AAA*")` en `dev` — reportar al leader, **no**
arrastrarlos a esta rama sin decisión, no son de esta feature).

---

## Resumen de dependencias

```
T0 ─┬─ T1 ─┬─ T2 ── T9 ─┬─ T11 ─┬─ T12 ── T13
    │      └─ T10 ──────┘       ├─ T15 ─┬─ T16
    ├─ T3 ── T4 ── T5 ── T19    │       └─ T18
    ├─ T6 ─┬─ T7 ── T8 ─────────┘  T14 ─┘
    │      └─ T20                  T17 ─┘
    └─ T17
                        todo ── T21 ── T22
```
