# Feature 92 — Optimización de ruta del mensajero · tasks

Rama `feature/92-optimizacion-ruta-mensajero` desde `origin/dev` **limpio** (worktree aislado; NO
checkout sobre `flow`: hay WIP ajeno sin commitear y drift de sesiones paralelas).

`[P]` = paralelizable con las tareas de su mismo bloque. Cada task cierra con un commit propio
(`docs/conventions.md`): `feat(92): ...` / `test(92): ...` / `chore(92): ...`.

**Orden de bloques:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7.
Bloques 2 y 3 pueden correr en paralelo entre sí (backend_dev / backend_dev) una vez cerrado el 1.
El bloque 5 (frontend) depende del 4.

---

## Estado de la entrega (actualizado 2026-07-20, commit `172a835` + bookkeeping)

La feature se **partió en backend + frontend**. Este `tasks.md` cubre las dos mitades, así que
**no todas las tasks se cierran en esta rama**:

| Estado | Tasks | Significado |
| --- | --- | --- |
| `[x]` **HECHAS** | T0–T16, T20, T21, T22 | 20 tasks entregadas en `feature/92-optimizacion-ruta-mensajero` |
| `[~]` **DIFERIDAS a la feature 93** | T17, T18, T19 | 3 tasks de FRONTEND. **No están olvidadas ni hechas**: son el alcance de la 93 |
| ⚠️ **con excepción anotada** | T22 | marcada `[x]` con una excepción **medida** por deuda ajena; ver su nota |

Las 3 diferidas cubren R25 (captura GPS en el navegador), R29, R30, R31 y R32 — exactamente los
requisitos que el briefing del backend excluyó. La bitácora `progress/impl_92.md` las lista con
el mismo criterio.

---

## Bloque 0 — Preparación

### [x] T0 · Worktree y baseline
Crear worktree aislado desde `origin/dev`, `pnpm install --force` si el árbol de `node_modules` está
roto, `pnpm db:generate` desde el schema limpio y **medir** typecheck + tests **antes** de tocar nada.
**Depende de:** —
**Hecho:** `pnpm typecheck`, `pnpm lint` y `pnpm test` corridos y sus resultados anotados en
`progress/impl_92.md` como baseline con fecha. No se cita ningún baseline heredado.

---

## Bloque 1 — Datos (bloquea a todo lo demás)

### [x] T1 · Migración del enum `job_tipo`
`db/migrations/<ts>_job_tipo_optimizacion_ruta/` con
`ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'optimizacion_ruta';` y **ninguna** sentencia que
consuma el valor (55P04). `down.sql` documentando que Postgres no soporta quitar un valor de enum
(precedente: revisar el `down.sql` de `20260719120000_job_tipo_geocodificacion` y replicar su
criterio exacto, no inventar otro).
**Depende de:** T0 · **Cubre:** R40
**Hecho:** `pnpm db:migrate` aplica; el valor aparece en `pg_enum`; el enum del schema Prisma incluye
`optimizacion_ruta`.

### [x] T2 · Migración de `ruta_optimizada` + `ruta_optimizada_parada`
Tablas, enum `ruta_estado`, los tres índices (`mensajero_id` único, `(ruta_id, orden_id)` único,
`(ruta_id, secuencia)` único, `orden_id`), FKs con `ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY`
sin policies en ambas. `down.sql` que revierta exactamente (design §1.1). Modelos en
`db/schema.prisma`.
**Depende de:** T1 · **Cubre:** R26, R39
**Hecho:** `pnpm db:migrate` aplica y `pnpm db:rollback` revierte sin residuos;
`tests/integration/db/ruta-optimizada-migracion.test.ts` y `...-rollback.test.ts` en verde.

---

## Bloque 2 — Cola y gate de asignabilidad

### [x] T3 · `findByDedupeKeys` en la cola
Añadir el método a `lib/interfaces/repositories/IJobRepository.ts` y a
`lib/repositories/JobRepository.ts` (`WHERE dedupe_key IN (...)`, `keys` vacío → `[]` sin consulta).
Comentario de cabecera explicando por qué **no** es búsqueda por prefijo (design §0.2).
**Depende de:** T0 · **Cubre:** R4
**Hecho:** `tests/integration/repositories/job-find-by-dedupe-keys.test.ts` verifica: match exacto,
lote mixto, lista vacía y clave inexistente. `pnpm typecheck` limpio (la interfaz la implementan
también los dobles de los tests de 90/91: se actualizan).

### [x] T4 · Servicio de asignabilidad por coordenadas
`lib/services/AsignabilidadCoordenadasService.ts` + su interfaz. Árbol de decisión exacto del design
§7, en este orden: coordenadas → `geocode_status` determinista → clave exacta reconstruida con
`hashDireccion` → `estado='failed'` → `pending|processing` → encolado puntual.
⚠️ **Normativo:** "intentos agotados" ⇔ `estado === 'failed'`. **NO** usar `intentos >= maxIntentos`
(design §0.3: el claim incrementa `intentos` antes de ejecutar). Copiar ese razonamiento al código.
**Depende de:** T3 · **Cubre:** R1–R7
**Hecho:** `tests/unit/services/asignabilidad-coordenadas.test.ts` cubre los **seis** estados de R1,
más el caso "dirección corregida: job `failed` del hash viejo NO bloquea".

### [x] T5 · Enganchar el gate en los tres writers `[P]`
`GuiaAsignacionService.generarGuia` (solo la rama GAM con mensajero no nulo),
`GuiaAsignacionService.asignarDesdeBodega` y `AsignacionSateliteService.asignar`. Traducir el mapa
del gate a los `DetalleConflicto` ya existentes, **antes** de persistir, abortando todo el lote.
**Depende de:** T4 · **Cubre:** R8
**Hecho:** `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` y
`tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` verifican `conflict` sin efectos;
los tests existentes de esos tres services siguen en verde (con órdenes que ya traen coordenadas).

---

## Bloque 3 — Proveedor (paralelo al bloque 2)

### [x] T6 · Config de Route Optimization `[P]`
`lib/config/route-optimization.ts`, clon estructural de `lib/config/geocode.ts`: **nunca lanza**,
lee `process.env` en cada llamada, secretos → `string | null`, enteros con `readPositiveInt`.
**Depende de:** T0 · **Cubre:** R10
**Hecho:** `tests/unit/config/route-optimization-config.test.ts` verifica ausente/vacío → `null`,
enteros inválidos → default y que ninguna combinación lanza.

### [x] T7 · Token OAuth2 de service account `[P]`
`lib/auth/google-sa-token.ts`: JWT RS256 firmado con `node:crypto`, intercambio en
`oauth2.googleapis.com/token`, caché en memoria hasta `exp - 60 s`. `fetch` y reloj inyectables.
Sin dependencia nueva (**no** se añade `google-auth-library`).
**Depende de:** T6 · **Cubre:** R11, R12 (parte de credencial)
**Hecho:** `tests/unit/auth/google-sa-token.test.ts` firma con un par RSA generado en el test,
verifica claims (`iss`/`scope`/`aud`/`exp`), reutilización de token vigente, renovación al vencer y
`RutaNoConfiguradoError` con credencial incompleta **sin** llamar a `fetch`.

### [x] T8 · Cliente `optimizeTours`
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

### [x] T9 · Repositorio de ruta optimizada
`lib/repositories/RutaOptimizadaRepository.ts` + interfaz: `findByMensajero`,
`upsertOrigen`, `reemplazarSecuencia` (en `$transaction`: DELETE + createMany + UPDATE cabecera),
`marcarDesactualizada`.
**Depende de:** T2 · **Cubre:** R23, R26
**Hecho:** `tests/integration/repositories/ruta-optimizada-repo.test.ts` verifica reemplazo completo,
que los índices únicos rechazan secuencia duplicada y que el origen se persiste con su fuente.

### [x] T10 · Helper de encolado (debounce + inmediato)
`lib/services/jobs/optimizacion-ruta-encolado.ts` con `dedupeKeyDebounce` y `dedupeKeyInmediato`.
⚠️ **Normativo:** dos **espacios de claves disjuntos** (`:debounce:` / `:inmediato:`). Si se
unificaran, el disparo de la gestión sería tragado en silencio por un debounce en vuelo. Y la clave
del debounce DEBE llevar la ventana temporal: sin ella queda ocupada para siempre por la fila `done`
(trampa F1.4-Q4 de la 91). Copiar el bloque de design §4.1/§4.2 al comentario de cabecera.
**Depende de:** T1 · **Cubre:** R17, R18, R19
**Hecho:** `tests/unit/services/optimizacion-ruta-encolado.test.ts` verifica: misma ventana → misma
clave; ventana siguiente → clave distinta; inmediato y debounce **nunca** colisionan.

### [x] T11 · Servicio de optimización
`lib/services/OptimizacionRutaService.ts` con la secuencia de 7 pasos del design §5, incluidas las
guardas de coste (R20 obsolescencia, R35 ≤1 parada, R36 huella, R38 tope) y la resolución del origen
con sus tres escalones (§5.1). Ante fallo: **no** tocar paradas, marcar `desactualizada`, lanzar.
**Depende de:** T8, T9 · **Cubre:** R12, R20, R24, R25, R27, R34, R35, R36, R37, R38
**Hecho:** `tests/unit/services/optimizacion-ruta-service.test.ts` +
`tests/unit/services/optimizacion-ruta-origen.test.ts` con dobles: cada guarda tiene un test que
asserta **cero llamadas** al cliente, y el test de fallo asserta que la secuencia previa sigue intacta.

### [x] T12 · Handler y registro en el drenador
`lib/services/jobs/optimizacion-ruta-handler.ts` (adaptador + fábrica de deps) y
`handlers.set("optimizacion_ruta", ...)` en `buildHandlers()` de
`app/api/cron/procesar-jobs/route.ts`. **No** tocar `buildRecurrencias()`.
**Depende de:** T11 · **Cubre:** R21
**Hecho:** `tests/unit/api/procesar-jobs-registro.test.ts` verifica que el tipo está en `buildHandlers`
y **ausente** de `buildRecurrencias`; un test asserta que un fallo de este handler no impide drenar
los demás jobs del lote.

### [x] T13 · Outbox en los dos writers del mensajero
Inyectar `jobRepo` en `GestionOrdenRepository` (patrón `OrdenRepository` de la 91) y encolar dentro de
las transacciones ya existentes: `recogerLote` → debounce; `crearGestionYTransicionar` → inmediato con
`eventoId` = id de la gestión recién creada.
**Depende de:** T10, T12 · **Cubre:** R16, R19
**Hecho:** `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts` verifica: un job por
recogida; dos recogidas en la misma ventana → **una** fila; gestión → fila inmediata aunque haya un
debounce en vuelo; rollback de la tx → **ninguna** fila de job.

---

## Bloque 5 — Lectura y UI (depende del 4)

### [x] T14 · Orden de las cards en el service
`MisAsignacionesService.listarMisAsignaciones` ordena `porGestionar` por secuencia asc y deja al final
las órdenes sin posición en su orden actual. `MiAsignacionDTO` gana `secuenciaRuta`; el resultado gana
el bloque `ruta`. **No** se toca el `orderBy` del repositorio ni el orden de "Por recoger".
**Depende de:** T9 · **Cubre:** R28, R29
**Hecho:** `tests/unit/services/mis-asignaciones-orden-ruta.test.ts` cubre: todas con posición; mezcla
con y sin posición; ninguna con posición (orden idéntico al actual); KPIs sin alterar.

### [x] T15 · Server Action de sincronización manual
`lib/actions/ruta-mensajero.ts` → `sincronizarRuta`. Guarda de rol, zod en el borde para la ubicación,
ejecución **síncrona** del servicio, `withErrorHandler` (patrón `mis-asignaciones.ts`).
**Depende de:** T11 · **Cubre:** R22, R31 (servidor), R32, R33, R34
**Hecho:** `tests/unit/actions/sincronizar-ruta.test.ts` cubre `forbidden` para 3 roles distintos,
lat/lng fuera de rango → `validation_error`, y sin ubicación → ejecuta igual.

### [x] T16 · Ubicación opcional en las actions existentes `[P]`
`recogerAsignaciones` y `gestionar` aceptan `ubicacion` **opcional** en su schema zod y la propagan
para que se persista como origen.
**Depende de:** T15 · **Cubre:** R22, R23
**Hecho:** `tests/unit/actions/mis-asignaciones-ubicacion.test.ts` verifica que la ausencia del campo
no rompe ninguna llamada existente; los tests actuales de esas dos actions siguen en verde sin cambios.

### [~] T17 · Hook de geolocalización `[P]`
`hooks/useUbicacionActual.ts`: `getCurrentPosition` con timeout, estado `{ coords, denegado }`, nunca
lanza al render.
**Depende de:** T0 · **Cubre:** R25 (cliente)
**Hecho:** test con `navigator.geolocation` mockeado: permiso concedido, denegado y timeout — en los
tres casos el hook resuelve sin excepción.

> ⚠️ **DIFERIDA A LA FEATURE 93 — no está hecha y no está olvidada.** Es frontend puro y
> quedó fuera del briefing del backend a propósito. El contrato que la alimenta SÍ está
> entregado y congelado en esta rama (ver `progress/impl_92.md` §7).
> Verificado por el revisor: **`hooks/useUbicacionActual.ts` no existe** en esta rama.


### [~] T18 · Módulo del mensajero: botón, aviso y orden
`MisAsignacionesModule.tsx`: botón "Sincronizar ruta" (solo mensajero), aviso de ruta desactualizada /
paradas sin optimizar, badge de posición en la card, `router.refresh()` tras sincronizar. Revisar
primero si el botón/badge existe en shadcn/ui antes de crear nada.
**Depende de:** T14, T15, T17 · **Cubre:** R25, R29, R30, R31, R32
**Hecho:** `tests/components/MisAsignacionesModule.test.tsx` (existente, se amplía) verifica: cards en
el orden de la secuencia; aviso visible con ruta desactualizada; `router.refresh()` llamado tras
sincronizar; "Por recoger" intacto; con geolocalización denegada la sincronización se dispara igual.

> ⚠️ **DIFERIDA A LA FEATURE 93 — no está hecha y no está olvidada.** Es frontend puro y
> quedó fuera del briefing del backend a propósito. El contrato que la alimenta SÍ está
> entregado y congelado en esta rama (ver `progress/impl_92.md` §7).
> Lo entregado aquí es la MITAD SERVIDOR: `porGestionar` sale ya ordenado del service (R28), el
> bloque `ruta` alimenta el aviso (R30) y `sincronizarRuta` existe con su guarda de rol (R31/R33).
> `MisAsignacionesModule.test.tsx` solo se tocó para ampliar dobles, **no** se añadió UI.


### [~] T19 · Toast del gate en las UIs de asignación
`GenerarGuiaModal`, `AsignarBodegaModal` y `AsignarSateliteModal`: "Dirección no encontrada" para
`direccion_no_geocodificable` / `geocodificacion_agotada`; mensaje distinto de "validándose" para los
otros tres motivos.
**Depende de:** T5 · **Cubre:** R9
**Hecho:** los tests de esos componentes verifican los **dos** textos distintos según el motivo.

> ⚠️ **DIFERIDA A LA FEATURE 93 — no está hecha y no está olvidada.** Es frontend puro y
> quedó fuera del briefing del backend a propósito. El contrato que la alimenta SÍ está
> entregado y congelado en esta rama (ver `progress/impl_92.md` §7).
> El backend ya emite el `motivo` que estos toasts consumen: los 5 estados no-asignables viajan
> en `conflict.detalle` desde los tres writers (R8), con test en
> `guia-asignacion-gate-coordenadas.test.ts` y `asignacion-satelite-gate-coordenadas.test.ts`.


---

## Bloque 6 — Documentación y entorno

### [x] T20 · Variables de entorno y despliegue `[P]`
Documentar las 8 variables del design §2 donde el repo documente las demás (`.env.example` /
`docs/`). Anotar explícitamente que `GOOGLE_MAPS_API_KEY` **no** sirve para este producto y que hace
falta habilitar el SKU de Route Optimization en GCP.
**Depende de:** T6 · **Cubre:** soporte de R10
**Hecho:** ningún secreto en el repo; las 8 variables listadas con su default; nota del SKU escrita.

### [x] T21 · Mapa de trazabilidad
`progress/impl_92.md` con el mapa `R<n> → test` completo (R1..R40), la lista de archivos tocados y
los seguimientos anotados del design §11.
**Depende de:** T1–T20 · **Cubre:** trazabilidad (CHECKPOINTS)
**Hecho:** los 40 requisitos tienen al menos un test **existente y en verde**; ninguno queda huérfano.

---

## Bloque 7 — Verificación final

### [x] T22 · Suite completa y gate de calidad
**Depende de:** T21
**Hecho:** `./init.sh` en verde; `pnpm typecheck`, `pnpm lint` y `pnpm test` sin errores y **sin
regresión** contra el baseline de T0; `pnpm db:migrate` + `pnpm db:rollback` + `pnpm db:migrate`
completan; `console.log` de depuración eliminados de los archivos tocados (ojo: `lib/actions/
mis-asignaciones.ts` **ya trae** dos `console.log("xyz AAA*")` en `dev` — reportar al leader, **no**
arrastrarlos a esta rama sin decisión, no son de esta feature).

> ### ⚠️ EXCEPCIÓN MEDIDA — `pnpm test` NO termina en verde, y la causa es AJENA
>
> Marcada `[x]` porque todo lo que esta feature controla se cumple, **pero el criterio literal
> "`pnpm test` sin errores" NO se cumple hoy**. Se documenta en vez de darlo por verde en
> silencio.
>
> **Lo que SÍ se cumple y está medido (2026-07-20, tras `pnpm install --force`):**
> - `pnpm typecheck` → **0 errores** (baseline: 0).
> - `pnpm lint` → **0 errores** / 143 warnings, **idéntico al baseline** medido con `git stash -u`.
> - Tests de la feature aislados → **18 archivos, 219 tests, 219 verdes**.
> - **CERO regresiones, demostradas test a test.** El revisor aisló la unión de rojos con el
>   reporter JSON en HEAD y en un worktree limpio de `5244cf3`: **36 fallos en ambos**, y la
>   diferencia de conjuntos es **vacía en los dos sentidos**.
> - Round-trip de migraciones UP → DOWN → RE-UP contra Postgres 16 desechable en docker, con
>   **0 residuos**; 55P04 confirmado empíricamente
>   (`ERROR: unsafe use of new value "optimizacion_ruta" of enum type job_tipo`).
> - `console.log` de depuración en los archivos que ESTA feature creó: **ninguno**.
>
> **El rojo VIVO y determinista es UNO, y es deuda de la feature 90:**
> `tests/integration/actions/generar-gastos-fijos-route.test.ts:109` afirma que `vercel.json`
> define `/api/cron/liberar-reprogramadas`. La **propia feature 90** sustituyó esa ruta por
> `/api/cron/procesar-jobs` en el commit `57c53ea` (verificado con `git log -- vercel.json`), y
> nunca actualizó el test. Arreglarlo aquí sería arrastrar deuda ajena a esta rama.
>
> **`CierreDiaPage.test.tsx` YA NO es un rojo preexistente: PASA.** Se re-midió aislado y el
> archivo entero está verde. La bitácora lo arrastraba desde la feature 81; queda corregido.
>
> **El resto de rojos de la suite completa son FLAKES DE CARGA, no deterministas.** El revisor
> midió **12, 12 y 18** archivos rojos en tres corridas completas: todos son tests de componente
> (`testing-library` con `findBy*`/`waitFor`, sensibles a timing). Por eso "N rojos antes vs N
> después" es una métrica inútil, y por eso la comparación válida es la de conjuntos por nombre,
> que da diferencia vacía. **La estabilización de la suite merece feature propia** (seguimiento
> abierto al leader, junto con la deuda de la 90).
>
> **`./init.sh` queda formalmente incumplido por lo mismo**, y por la misma causa ajena.

---

## Resumen de dependencias

Leyenda de los checkboxes: `[x]` entregada en esta rama · `[~]` **diferida a la feature 93**
(frontend, ni hecha ni olvidada). No queda ninguna task en `[ ]`.

```
T0 ─┬─ T1 ─┬─ T2 ── T9 ─┬─ T11 ─┬─ T12 ── T13
    │      └─ T10 ──────┘       ├─ T15 ─┬─ T16
    ├─ T3 ── T4 ── T5 ── T19    │       └─ T18
    ├─ T6 ─┬─ T7 ── T8 ─────────┘  T14 ─┘
    │      └─ T20                  T17 ─┘
    └─ T17
                        todo ── T21 ── T22
```
