# impl 167 — apartado propio de recolección para el mensajero · FASE 1 (backend)

> Rama `feature/167-apartado-recoleccion-mensajero` (worktree `lote-135`), sobre `origin/dev`
> `eec55585`. Ejecutor: `backend_dev`. Alcance de esta entrada: **Fase 0 (T0.2, T0.3) y Fase 1
> completa (T1.1 – T1.10)**. La Fase 2 (frontend) la ejecuta `frontend_dev` después.

---

## T0.1 — Puerta de aprobación humana (hecho previo, se registra aquí)

**El humano APROBÓ el spec el 2026-07-31.** Las cinco preguntas abiertas de `requirements.md`
quedaron resueltas así (decisiones CERRADAS, no se reabren):

| # | Pregunta abierta | Decisión del humano (2026-07-31) |
| --- | --- | --- |
| 1 | ¿Buscador en el apartado nuevo? | **NO.** Sin buscador: la acción es escanear, la lista es referencia. |
| 2 | Tope y profundidad de «Recolectadas hoy» | **Solo el día en curso, tope 100**, con aviso de recorte. Sin "ver más" ni histórico de días anteriores. |
| 3 | Órdenes borradas en «Recolectadas hoy» | **Excluidas** (R29). |
| 4 | Etiqueta del ítem de menú | **«Recolección»** (fase 2). |
| 5 | Dirección de la tienda | Sigue **abierta** desde la 157; esta feature no la cambia. |

Decisión adicional de la puerta, que condiciona el contrato: **se retira el pre-chequeo local de
guías ajenas; el servidor es la autoridad** (R12). Es fase 2, pero la fase 1 no introduce ninguna
dependencia que lo impida (la action de confirmación no cambia).

---

## T0.2 — Censo de arranque

`grep -rn "porRecolectar|RecoleccionTiendaPanel|useRecolectarPorGuia|recolectando"` sobre `app/`,
`lib/`, `components/`, `hooks/`, `tests/` (41 archivos con al menos una coincidencia).

### Confirma `design.md §2.3` (lo que se retira)

| Artefacto declarado en §2.3 | Verificado en el árbol |
| --- | --- |
| `MisAsignacionesModule.tsx` import + bloque montado | `:28`, `:423-433` (fase 2) |
| `MisAsignacionesModuleProps.porRecolectar` | `:69` (declarada `?:` — opcional), uso en `:108`, `:430` (fase 2) |
| `ListarMisAsignacionesServiceResult.porRecolectar` | `IMisAsignacionesService.ts:144-149` ✔ |
| `ListarMisAsignacionesResult.porRecolectar` | `lib/types/gestion-orden.ts:209-210` ✔ |
| `ORIGEN_RECOLECCION` + tercer bucket | `MisAsignacionesService.ts:42,139-143,163-189,216-224` ✔ |
| `mis-asignaciones/page.tsx` | `:46` (fase 2) |

### Confirma `design.md §9` (tests desplazados), con **DOS correcciones**

1. **El test del borde de la 157 NO está en `tests/unit/actions/`.** `tasks.md` T1.7 lo situaba en
   `tests/unit/actions/recoleccion-tienda-action.test.ts`; el archivo real es
   **`tests/integration/actions/recoleccion-tienda-action.test.ts`** (creado por la 157/T1.13). Los
   casos nuevos de `listarRecoleccion` se añadieron **ahí**, en vez de crear un segundo archivo en
   otra carpeta para el mismo módulo de acciones.
2. **`tests/unit/domain/order-status-transiciones.guardia.test.ts` (11 coincidencias),
   `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` (4),
   `tests/fixtures/inventario-transiciones-140.ts` (4), `lib/types/order-status*.ts`,
   `GuiaAsignacionService.ts`, `EstatusBadge.tsx`, `QuitarRecoleccionModal.tsx`,
   `OrdenesRevisionMaestro.tsx`** citan `recolectando` como **estado del catálogo** (features
   154/157), no como el bucket de Entregas. **No entran en esta feature** y no se tocaron; se
   listan para que no se confundan con hallazgos pendientes.

### Fuera de scope confirmado

`tests/unit/guards/recoleccion-no-contamina.test.ts` (1 coincidencia) — sigue **sin tocar** y en
verde (evidencia abajo).

---

## T0.3 — Punto de partida: **NO estaba en verde**. Tres rojos previos, ninguno de esta feature

`./init.sh` sobre la rama recién creada (idéntica a `origin/dev` salvo `feature_list.json`,
`progress/current.md` y los specs nuevos):

```
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=3)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
...
R:\...\app\(app)\ordenes\_components\OrdenesModule.tsx
  340:34  error    Compilation Skipped: Existing memoization could not be preserved
  345:7   error    Compilation Skipped: Existing memoization could not be preserved
  345:21  error    Compilation Skipped: Existing memoization could not be preserved
✖ 26 problems (3 errors, 23 warnings)
✗ 'pnpm run lint' fallo
```

### Rojo previo 1 — `lint`: 3 errores en `OrdenesModule.tsx:340,345`

**Deuda de `dev` sin dueño.** Archivo byte-idéntico a `origin/dev`. NO se arregla y NO se cuenta
como de esta feature. `init.sh` corta aquí, así que **nunca llega a `pnpm test`**: los números de la
suite hay que sacarlos aparte.

### Rojos previos 2 y 3 — `pnpm test` (baseline, ANTES de tocar nada)

```
 Test Files  2 failed | 659 passed (661)
      Tests  2 failed | 7952 passed (7954)
```

| Archivo | Por qué falla | Prueba de que es previo |
| --- | --- | --- |
| `tests/unit/analytics/frontera.guardia.test.ts` | Guardia PINNEADO a la feature 135 que mide el **diff de la rama actual** contra `origin/dev` y exige que contenga `lib/analytics/`. Falla en **cualquier** rama que no sea la de la 135 — incluida `dev` limpia, donde el diff sale vacío. | `git diff --stat origin/dev -- <archivo>` **vacío**. Ya rojo en el baseline (1 caso). El propio `progress/impl_135.md:399` lo registra rojo. |
| `tests/unit/guards/no-embalaje.test.ts` | Encuentra la palabra en `specs/135-analitica-catalogo-kpis-rangos/tasks.md:187` (un spec que cita el NOMBRE DE ARCHIVO del guard). | `git show origin/dev:specs/135-.../tasks.md \| sed -n '187p'` devuelve la línea: **está en `origin/dev`**. |

**Consecuencia declarada:** el criterio de cierre de fase 1 (`pnpm test tests/unit tests/integration`
en verde) **no puede cumplirse literalmente** mientras estos dos archivos sigan en el árbol. Abajo
se dan los números con y sin ellos, y la prueba de que la fase 1 no aporta ni un rojo nuevo.

---

## Archivos creados / modificados (fase 1)

### Creados

| Ruta | Qué es |
| --- | --- |
| `db/migrations/20260731140000_orden_historial_idx_actor_origen_created/migration.sql` | UP: el índice de R32 |
| `db/migrations/20260731140000_orden_historial_idx_actor_origen_created/down.sql` | DOWN: `DROP INDEX IF EXISTS` idempotente |
| `tests/integration/db/orden-historial-actor-origen-index-migration.test.ts` | Cobertura estática UP/DOWN/schema (13 casos) |
| `tests/unit/repositories/orden-historial-recolecciones-actor.test.ts` | Unit del repo con doble de Prisma (11 casos) |
| `progress/impl_167-apartado-recoleccion-mensajero.md` | esta bitácora |

### Modificados

| Ruta | Qué cambió |
| --- | --- |
| `db/schema.prisma` | `OrdenHistorialEstado` gana `@@index([actorUsuarioId, origenTipo, createdAt], map: "orden_historial_actor_origen_created_idx")` |
| `lib/types/recoleccion-tienda.ts` | + `RecoleccionOrdenDTO`, `RecolectadaHoyDTO`, `ListarRecoleccionResult` |
| `lib/interfaces/services/IRecoleccionTiendaService.ts` | + `ListarRecoleccionServiceResult` y la firma `listarRecoleccion(actor)` |
| `lib/interfaces/repositories/IOrdenHistorialRepository.ts` | + `RecoleccionHistorialRow` y `findRecoleccionesDeActor(...)` |
| `lib/repositories/OrdenHistorialRepository.ts` | + `findRecoleccionesDeActor` (query Prisma pura) |
| `lib/services/RecoleccionTiendaService.ts` | + `listarRecoleccion`, `TOPE_RECOLECTADAS_HOY = 100`, 2 repos y reloj en el constructor |
| `lib/actions/recoleccion-tienda.ts` | + Server Action `listarRecoleccion` + su traductor de borde; `buildService()` cablea los 3 repos |
| `lib/services/MisAsignacionesService.ts` | − `ORIGEN_RECOLECCION`, − tercer bucket, − campo del return. La lectura queda `["por_recoger","en_reparto"]` |
| `lib/interfaces/services/IMisAsignacionesService.ts` | − `porRecolectar` del resultado |
| `lib/types/gestion-orden.ts` | − `porRecolectar` de `ListarMisAsignacionesResult` |
| `tests/unit/services/recoleccion-tienda-service.test.ts` | + bloque `listarRecoleccion` (22 casos). Los 13 de la 157 **intactos**; solo cambió el cableado de `makeRepo` |
| `tests/integration/actions/recoleccion-tienda-action.test.ts` | + 4 casos del borde de la lectura; los 11 de la 157 intactos |
| `tests/unit/services/mis-asignaciones-service.test.ts` | − `describe` "tercer grupo por recolectar" (7 casos); + `describe` "corte limpio de la recolección" (4 casos); las 2 aserciones de la lista de estados endurecidas a `["por_recoger","en_reparto"]` |
| `tests/unit/actions/mis-asignaciones-{action,causa-devolucion,evidencias}.test.ts` | fixtures sin `porRecolectar` (cambio mecánico; ningún assert cambia) |
| `tests/unit/guards/no-embalaje.test.ts` | + 1 línea de whitelist (ver "Desviaciones", D3) |
| `specs/167-apartado-recoleccion-mensajero/tasks.md` | T0.1–T0.3 y T1.1–T1.10 marcadas `[x]` |

**No se tocó** (fase 2 o fuera de alcance): `app/**`, `components/**`, `tests/components/**`,
`tests/unit/guards/recoleccion-no-contamina.test.ts`, `tests/unit/analytics/frontera.guardia.test.ts`.

---

## T1.1 / T1.2 — Migración: aplicación y rollback REALES contra la base local

`prisma validate` → OK. `prisma format` → sin diff adicional (el `git diff` de `schema.prisma` se
mantiene en 10 inserciones antes y después).

**Nombre del índice:** el explícito, no el truncado por defecto de Prisma
(`orden_historial_estado_actor_usuario_id_origen_tipo_created_at_idx` mide 66 caracteres y Postgres
corta en 63).

### UP

```
Applying migration `20260731140000_orden_historial_idx_actor_origen_created`
All migrations have been successfully applied.

  orden_historial_actor_origen_created_idx
      CREATE INDEX orden_historial_actor_origen_created_idx ON public.orden_historial_estado USING btree (actor_usuario_id, origen_tipo, created_at)
  orden_historial_estado_orden_id_created_at_idx
  orden_historial_estado_orden_id_estatus_destino_id_idx
  orden_historial_estado_pkey
```

### DOWN (`pnpm run db:rollback`)

```
Aplicando rollback: 20260731140000_orden_historial_idx_actor_origen_created
Script executed successfully.
Script executed successfully.
Rollback completado: 20260731140000_orden_historial_idx_actor_origen_created

=== indices tras el DOWN ===
  orden_historial_estado_orden_id_created_at_idx
  orden_historial_estado_orden_id_estatus_destino_id_idx
  orden_historial_estado_pkey
```

El índice **desapareció**, y los dos previos siguen intactos.

### Re-UP

```
All migrations have been successfully applied.

=== indices tras re-aplicar el UP ===
  orden_historial_actor_origen_created_idx
      CREATE INDEX orden_historial_actor_origen_created_idx ON public.orden_historial_estado USING btree (actor_usuario_id, origen_tipo, created_at)
  ...
```

> **Nota operativa:** `prisma db execute` no imprime resultados de `SELECT`, así que la inspección
> de `pg_indexes` se hizo con un script `tsx` temporal (`scripts/tmp-check-idx.ts`), **borrado** al
> terminar. No queda en el árbol.

### Hallazgo colateral: DRIFT PREEXISTENTE en la base local

`pnpm run db:migrate:create` generó, **además** del `CREATE INDEX`, diez sentencias ajenas a esta
feature: `DROP DEFAULT` de `updated_at` en `api_key`, `jobs`, `premio_ranking`, `ruta_optimizada` y
`webhook_suscripcion`; `DROP DEFAULT` de `plantilla_mensaje.variables`; drop+add de
`cierre_detail_tarifa_id_fkey`; y dos `RENAME INDEX` (`chat_mensaje_error_codigo_idx`,
`notificacion_entidad_idx`). **Se retiraron a mano**: esta migración hace UNA cosa. El drift es
anterior a esta rama, sigue vivo y **se declara como pregunta abierta (P2)**. Un caso del test de la
migración impide que vuelva a colarse en un regenerado futuro.

`down.sql` escrito **a mano** e idempotente. **No hay valor de enum nuevo**, así que NO hubo que
tocar ningún `down.sql` previo (la trampa que dejó escrita la 154 aplica solo a los `ADD VALUE`).

---

## T1.3 — Verificación por mutación del test de la migración

Requisito de T1.3: "falla si se cambia el nombre del índice o el orden de las columnas en cualquiera
de los dos archivos". Cinco mutaciones, cada una revertida después:

| Mutación | Resultado |
| --- | --- |
| M1 · renombra el índice en `migration.sql` | `Tests 1 failed \| 12 passed (13)` |
| M2 · invierte columnas en `migration.sql` | `Tests 1 failed \| 12 passed (13)` |
| M3 · renombra el índice en `down.sql` | `Tests 1 failed \| 12 passed (13)` |
| M4 · invierte columnas en el `@@index` de `schema.prisma` | `Tests 1 failed \| 12 passed (13)` |
| M5 · quita el `map:` explícito del schema | `Tests 1 failed \| 12 passed (13)` |
| **restaurado** | `Tests 13 passed (13)` |

---

## Mapa `R<n> → test` (los 39 requisitos)

Los `R<n>` de **fase 2** se marcan como tales: los cubre `frontend_dev` y esta entrada no los
reclama. Los de fase 1 llevan archivo y **nombre del caso**.

### Cubiertos por la FASE 1 (esta entrada)

| R | Test |
| --- | --- |
| **R6** | `tests/integration/actions/recoleccion-tienda-action.test.ts` → "R6: pasa el actor de SESION al service (nunca un usuarioId de parametro)" · "R6: devuelve el payload del service TAL CUAL (las dos listas y el flag de recorte)" · "sin sesion -> unauthenticated, sin construir ni llamar al service" · "passthrough del `forbidden` del service" |
| **R8** (parte servidor) | `tests/unit/services/recoleccion-tienda-service.test.ts` → "R8: sin nada asignado devuelve la lista VACIA (no un error ni un ausente)" |
| **R16** | `tests/unit/services/recoleccion-tienda-service.test.ts`, bloques de la 157 (R29–R34) **con sus 13 casos intactos y verdes**: la transición, las guardias de rol/propiedad/estado/bloqueo, la idempotencia, la carrera y el `origenTipo: "recoleccion_tienda"` del historial |
| **R18** | `…/recoleccion-tienda-service.test.ts` → "R18/R38: el DTO lleva SOLO lo pertinente a una recoleccion" (`toEqual` exacto: sin `montoCobrar`) |
| **R20** (parte contrato) | `…/recoleccion-tienda-service.test.ts` → "R20: sin telefono de tienda el campo es `null`, nunca `undefined`" |
| **R21** | `…/recoleccion-tienda-service.test.ts` → "R21: pide EXACTAMENTE el estado `recolectando` del PROPIO actor" · "R21: la lectura va acotada al actor, asi que otro mensajero no ve estas ordenes" · "maestro/adminTienda -> forbidden, sin leer NADA" |
| **R24** | `…/recoleccion-tienda-service.test.ts` → "R25: la lista se pide al repo de HISTORIAL, no al de asignaciones por estado" · "R28/R38: cada item lleva guia, remision, tienda e instante — y nada mas" |
| **R25** | `…/recoleccion-tienda-service.test.ts` → "R25/R26: una orden YA recibida en la bodega central sigue figurando" + `tests/unit/repositories/orden-historial-recolecciones-actor.test.ts` → "acota por actor, por la familia `recoleccion_tienda` y por la ventana [desde, hasta)" |
| **R26** | `orden-historial-recolecciones-actor.test.ts` → "R26: NO filtra por `estatusDestinoId` — el estado ACTUAL de la orden es irrelevante" + `recoleccion-tienda-service.test.ts` → "R25/R26: una orden YA recibida en la bodega central sigue figurando" |
| **R27** | `recoleccion-tienda-service.test.ts`, bloque "la ventana de HOY es el dia natural de Costa Rica (R27)": "a media mañana de CR la ventana es [06:00Z de hoy, 06:00Z de mañana)" · **"BORDE 23:59 CR"** · **"BORDE 00:00 CR"** · "las 19:00 hora CR pertenecen al dia que el mensajero llama HOY" · "sin reloj inyectado usa el del sistema" |
| **R28** (parte servidor) | `orden-historial-recolecciones-actor.test.ts` → "R28: pide `createdAt desc` (mas reciente primero)" · "no reordena en el cliente" + `recoleccion-tienda-service.test.ts` → "R28: llega ordenada de la MAS RECIENTE a la mas antigua y el service no la reordena" |
| **R29** | `orden-historial-recolecciones-actor.test.ts` → "R29: excluye las ordenes borradas en el WHERE, no en el cliente" + `recoleccion-tienda-service.test.ts` → "R29: no trae la de OTRO actor, ni la de AYER, ni la BORRADA, ni la de otra familia" |
| **R31** (parte servidor) | `recoleccion-tienda-service.test.ts`, bloque "tope de presentacion (R31)": "el tope es 100 y se pide UNA MAS…" · "justo en el tope: devuelve las 100 y NO marca recorte" · "por encima del tope: recorta a las 100 MAS RECIENTES y marca el recorte" · "por debajo del tope no marca recorte" + `orden-historial-recolecciones-actor.test.ts` → "R31: el `take` es EXACTAMENTE el limite recibido" |
| **R32** | `tests/integration/db/orden-historial-actor-origen-index-migration.test.ts` (13 casos: nombre explícito, orden de columnas, una sola sentencia, DOWN idempotente, schema↔SQL sin divergencia) — **verificado por mutación**, tabla arriba |
| **R34** | `tests/unit/services/mis-asignaciones-service.test.ts` → "R34: pide EXACTAMENTE `[\"por_recoger\", \"en_reparto\"]`, ni un estado mas" · "R34: el resultado NO declara ningun grupo de recoleccion" · "R34: aunque el repo devolviera una orden en `recolectando`, no cae en NINGUN grupo" |
| **R36** | `tests/unit/services/mis-asignaciones-service.test.ts` → "R36: los KPIs y las paradas derivan SOLO de `en_reparto` (el COD de una recoleccion no cuenta)" |
| **R37, R39** | `tests/unit/guards/recoleccion-no-contamina.test.ts` — **sin tocar** (`git diff origin/dev` vacío) y **verde**. **Qué prueba EXACTAMENTE** (corregido tras el review, m2): que `ESTADOS_PENDIENTES` de `CierreDiaService` **no contenga `por_recolectar_en_tienda`**, el estado de la 157 — **no** vigila `recolectando`, que es el estado sobre el que se construye la 167. Que la 167 tampoco contamine el cierre es un hecho comprobado A MANO por el reviewer (`CierreDiaService.ts:41` es la lista CERRADA `["por_recoger","en_reparto"]`, y ni `CorteDiarioService` ni `RankingService` mencionan la recolección), **no un test**. Queda declarado como **deuda heredada de la 157**: ningún test vigila que `recolectando` no entre al cierre del día ni al ranking. La 167 no la crea ni la agrava —no toca ninguno de esos módulos (diff vacío)—, pero tampoco la salda: cerrarla es ampliar el guard de la 157, fuera del alcance de esta feature |
| **R38** | `recoleccion-tienda-service.test.ts` → "R38: NO transporta cobro ni ruta al navegador, aunque la fila los traiga" (censo de 9 claves prohibidas) + `orden-historial-recolecciones-actor.test.ts` → "R38: la proyeccion no pide monto, coordenadas ni el estado de la orden" |

### Pendientes de la FASE 2 (`frontend_dev`) — **CERRADOS**, ver el mapa completo en T3.2

| R | Test previsto (`tasks.md` fase 2) | Estado |
| --- | --- | --- |
| R1, R2, R3 | `tests/components/RecoleccionPage.test.tsx` (T2.3) | ✔ hecho |
| R4, R5 | `tests/unit/auth/menu-visibility.test.ts` + `tests/components/Sidebar.test.tsx` (T2.2) | ✔ hecho |
| R7, R8 (UI), R9 | `tests/components/RecoleccionModule.test.tsx` (T2.5/T2.7) | ✔ hecho |
| R10, R11, R12, R13 | `tests/components/RecoleccionModule.test.tsx` (T2.4/T2.7) | ✔ hecho |
| R14, R15 | `tests/components/RecoleccionModule.test.tsx` (T2.7) | ✔ hecho |
| R17, R19, R20 (UI), R22, R23 | `tests/components/RecoleccionModule.test.tsx` (T2.7) | ✔ hecho |
| R28 (UI), R30, R31 (UI) | `tests/components/RecoleccionModule.test.tsx` + `RecolectadasHoyLista` (T2.6/T2.7) | ✔ hecho |
| R33, R35 | `tests/components/MisAsignacionesModule.test.tsx` + `tests/unit/guards/entregas-sin-recoleccion.test.ts` (T2.9/T2.10) | ✔ hecho |

**Ningún `R<n>` queda sin test previsto.** Los 18 de fase 1 están cubiertos y ejecutados; los 21 de
fase 2 quedaron cubiertos y ejecutados en la entrada de abajo (T3.2, mapa con nombre de caso).

---

## Salida real de los comandos

### `pnpm run typecheck` — **EN ROJO A PROPÓSITO** (declarado en la cabecera de `tasks.md`)

```
> tsc --noEmit

app/(app)/mis-asignaciones/page.tsx(46,31): error TS2551: Property 'porRecolectar' does not exist on type '{ status: "ok"; porRecoger: MiAsignacionDTO[]; porGestionar: MiAsignacionDTO[]; ordenEnGestionId: string | null; kpis: MisAsignacionesKpis; ruta: RutaResumenDTO; }'. Did you mean 'porRecoger'?
tests/components/MisAsignacionesPage.test.tsx(65,5): error TS2561: Object literal may only specify known properties, but 'porRecolectar' does not exist in type '{ ... }'. Did you mean to write 'porRecoger'?
tests/components/MisAsignacionesPage.test.tsx(103,7): error TS2561: Object literal may only specify known properties, but 'porRecolectar' does not exist in type '{ ... }'. Did you mean to write 'porRecoger'?
```

Los **tres** son exactamente los puntos que la fase 2 tiene asignados: `page.tsx:46` → **T2.8**,
`MisAsignacionesPage.test.tsx` → **T2.9**. Ni uno más. El primer punto en que el typecheck global
debe estar verde es **T3.1**.

### `pnpm run lint` — igual que el baseline, ni un problema nuevo

```
  340:34  error    Compilation Skipped: Existing memoization could not be preserved
  345:7   error    Compilation Skipped: Existing memoization could not be preserved
  345:21  error    Compilation Skipped: Existing memoization could not be preserved
✖ 26 problems (3 errors, 23 warnings)
```

**Idéntico al baseline** (26 problemas, 3 errores, 23 warnings). Los 3 errores son la deuda previa de
`OrdenesModule.tsx`. Durante el trabajo apareció un warning nuevo (`'_omitido' is assigned a value
but never used`) en un test propio: **corregido**, de ahí que el conteo vuelva a 23.

### `pnpm test tests/unit tests/integration` — criterio de cierre de la fase 1

```
 Test Files  2 failed | 534 passed (536)
      Tests  6 failed | 6531 passed (6537)
   Duration  83.97s
```

Los **6 rojos** están en **2 archivos**, los mismos dos del baseline (T0.3), **ambos byte-idénticos a
`origin/dev`**:

| Archivo | Casos rojos | Veredicto |
| --- | --- | --- |
| `tests/unit/analytics/frontera.guardia.test.ts` | 5 | **Deuda de `dev`.** Guardia pinneado a la 135 que mide el diff de la rama actual y exige `lib/analytics/`. Rojo en el baseline (1 caso) y rojo en `dev` limpia. Al tocar `db/migrations/`, `lib/services/`, `lib/repositories/` y `lib/actions/` —lo que la fase 1 tiene que tocar por diseño— pasa de 1 a 5. **No es un hallazgo sobre esta feature: es el guard midiendo la rama equivocada.** |
| `tests/unit/guards/no-embalaje.test.ts` | 1 | **Deuda de `dev`.** Único hallazgo restante: `specs/135-analitica-catalogo-kpis-rangos/tasks.md:187`, presente en `origin/dev`. |

**Prueba de que la fase 1 no aporta ni un rojo nuevo** — la misma suite excluyendo esos dos archivos:

```
$ pnpm exec vitest run tests/unit tests/integration \
    --exclude "tests/unit/analytics/frontera.guardia.test.ts" \
    --exclude "tests/unit/guards/no-embalaje.test.ts"

 Test Files  534 passed (534)
      Tests  6527 passed (6527)
   Duration  84.54s
```

**534/534 archivos y 6527/6527 casos en verde.**

Y la prueba de que `no-embalaje` ya no encuentra nada de la 167 — con el alta de la 167 puesta, el
único hallazgo es el de la 135; si además se diera de alta ese (lo que **no** se entrega, es deuda
ajena), el guard queda verde:

```
=== A) con SOLO el alta de la 167 (estado que se entrega) ===
specs/135-analitica-catalogo-kpis-rangos/tasks.md:187: ...
      Tests  1 failed (1)

=== B) si ademas se diera de alta el hallazgo de dev (specs/135) ===
      Tests  1 passed (1)
(revertido: la linea de la 135 NO se entrega)
```

### Archivos tocados, ejecutados juntos

```
$ pnpm exec vitest run \
    tests/unit/services/recoleccion-tienda-service.test.ts \
    tests/unit/repositories/orden-historial-recolecciones-actor.test.ts \
    tests/integration/db/orden-historial-actor-origen-index-migration.test.ts \
    tests/integration/actions/recoleccion-tienda-action.test.ts \
    tests/unit/services/mis-asignaciones-service.test.ts \
    tests/unit/actions/mis-asignaciones-action.test.ts \
    tests/unit/actions/mis-asignaciones-causa-devolucion.test.ts \
    tests/unit/actions/mis-asignaciones-evidencias.test.ts \
    tests/unit/guards/recoleccion-no-contamina.test.ts \
    tests/unit/repositories/orden-historial-repository.test.ts \
    tests/unit/repositories/orden-historial-cobertura.test.ts

 Test Files  11 passed (11)
      Tests  218 passed (218)
```

Por archivo: `recoleccion-tienda-service` **35** (13 de la 157 + 22 nuevos) ·
`orden-historial-recolecciones-actor` **11** · `orden-historial-actor-origen-index-migration` **13** ·
`recoleccion-tienda-action` **15** (11 + 4) · `mis-asignaciones-service` **60**.

---

## Desviaciones respecto de `tasks.md` / `design.md` (declaradas, no ocultas)

**D1 — El test del borde va en `tests/integration/actions/`, no en `tests/unit/actions/`.**
T1.7 nombraba `tests/unit/actions/recoleccion-tienda-action.test.ts`; ese archivo **no existe**. El
borde de la 157 vive en `tests/integration/actions/recoleccion-tienda-action.test.ts`. Los 4 casos
nuevos se añadieron ahí en vez de partir en dos el borde de un mismo módulo. Corrección del censo
T0.2, punto 1.

**D2 — Los dos repos nuevos del constructor del service son REQUERIDOS, así que `makeRepo` del test
de la 157 cambió.** `design.md §5.2` sólo da valor por defecto al reloj. Hacerlos opcionales dejaría
que el wiring se los olvidara y que «Recolectadas hoy» desapareciera en silencio (el argumento
explícito de la 160 en `MisAsignacionesService`). Consecuencia: la **factoría** `makeRepo` del test de
la 157 pasa a inyectar dos dobles vacíos. **Los 13 casos de la 157 no se tocaron** —ni una aserción—
y siguen verdes; lo verifica el `git diff` del archivo, donde el único cambio fuera del bloque nuevo
es el cableado del constructor.

**D3 — `tests/unit/guards/no-embalaje.test.ts` gana UNA línea de whitelist.**
No estaba en el plan. `specs/167-.../design.md:386` cita el **nombre de archivo** de ese guard como
molde del guard de la fase 2, y el guard busca la palabra línea a línea sin distinguir su propio
nombre del valor prohibido. La whitelist del propio guard documenta este caso exacto y ya tiene tres
altas idénticas (155 y 159, líneas 72-80). Alta **por archivo**, no por carpeta. Efecto: la feature
167 aporta **cero** hallazgos nuevos al guard. No se dio de alta el hallazgo de la 135: es deuda
ajena y no me corresponde saldarla.

**D4 — El `migration.sql` generado por Prisma se editó a mano** para quitar 10 sentencias de drift
preexistente ajenas a la feature (detalle en T1.1). El archivo entregado es SQL escrito a mano, como
varias migraciones ya existentes del repo.

**D5 — Quedan 2 apariciones de `recolect` en `MisAsignacionesService.ts`, ambas en COMENTARIOS.**
T1.8 pedía "0 ocurrencias". Las dos son documentación de la **ausencia**: una explica por qué el
estado `recolectando` deliberadamente NO se lee (es el requisito R34 escrito al lado del código que
lo cumple) y la otra declara la deuda de `tiendaTelefono` (P1, abajo). **0 ocurrencias en código
ejecutable.** El guard de no-reintroducción de la fase 2 (T2.10) ignora comentarios por diseño, así
que esto no lo afecta.

---

## Preguntas abiertas (no se rellenan con supuestos)

**P1 — `MiAsignacionDTO.tiendaTelefono` queda sin consumidor tras el corte limpio.**
Ese campo entró con la 157 (R15) exclusivamente para el panel de recolección dentro de Entregas.
Cuando la fase 2 retire `RecoleccionTiendaPanel` de `MisAsignacionesModule`, **ningún** consumidor
de Entregas lo leerá (verificado: los únicos usos en `app/` están en ese panel). `design.md §2.3`
**no lo lista** entre las retiradas, así que **no se retiró**. Ojo: el campo homónimo de
`MiAsignacionRow` **sí sigue siendo necesario** — de ahí lo lee `listarRecoleccion` para su DTO.
*¿Se retira `tiendaTelefono` del DTO de Entregas (toca fixtures de varios tests de Entregas) o se
conserva?* Queda declarado en el propio código.

**P2 — Drift preexistente entre `db/schema.prisma` y la base local.**
`prisma migrate dev --create-only` propuso 10 sentencias ajenas a esta feature (T1.1). Significa que
`schema.prisma` y las bases divergen en esos 10 puntos, y que **cualquier** `migrate dev` futuro los
volverá a arrastrar a la migración de turno. No es de esta feature y no se tocó. *¿Se abre un ticket
de saneamiento de drift?*

**P3 — `tests/unit/analytics/frontera.guardia.test.ts` bloquea a toda rama que no sea la de la 135.**
Es un guard de alcance pinneado a una feature ya cerrada que mide el diff de **la rama actual**. Hoy
está rojo en `dev` limpia y produce 5 falsos positivos en esta rama. No se tocó (es de otra feature).
*¿Se acota al branch de la 135, se congela contra su commit de merge, o se retira?*

**P4 — Dirección de la tienda (heredada de la 157).** Sigue abierta; esta feature no la cambia.

---

## Veredicto

**Fase 1 (backend) COMPLETA y verificada:** el índice de R32 aplica y revierte contra Postgres real,
la lectura del apartado vive en su service con su ventana de día CR probada en los bordes, el corte
limpio de Entregas está hecho en servicio y contratos, y `tests/unit` + `tests/integration` quedan en
**534/534 archivos y 6527/6527 casos verdes** una vez descontados los dos guards que ya estaban rojos
en `origin/dev` — a los que esta feature no añade ni un hallazgo nuevo; el typecheck global queda en
rojo en los 3 puntos exactos que la fase 2 tiene asignados, tal como el spec lo declaró de antemano.

---
---

# impl 167 · FASE 2 (frontend) + cierre técnico (T3.1–T3.4)

> Misma rama `feature/167-apartado-recoleccion-mensajero` (worktree `lote-135`), sobre la fase 1 de
> arriba. Ejecutor: `frontend_dev`. Alcance: **T2.1 – T2.11** y **T3.1, T3.2, T3.3, T3.4**.
> **T3.5 NO entra aquí** (estado y bitácora final: los cierra el leader tras el reviewer).

## Decisiones del humano en la puerta que gobiernan esta fase (2026-07-31, CERRADAS)

1. El escáner se monta **SIEMPRE**, con lista vacía incluida (R7/R8). Única excepción: bloqueo por
   cierre (R9).
2. Se **retira** el pre-chequeo local de guías ajenas (`design.md §7.2`): el servidor es la autoridad
   (R12). Se conserva el corte de código mal formado en cliente (R11).
3. **Sin buscador** en el apartado nuevo.
4. «Recolectadas hoy»: **solo el día en curso, tope 100**, con aviso de recorte.
5. Etiqueta **«Recolección»**, justo debajo de «Entregas».
6. Órdenes borradas **excluidas** de «Recolectadas hoy».

Las seis están implementadas y cada una tiene su test; ninguna se reabrió.

---

## Archivos creados / modificados (fase 2)

### Creados

| Ruta | Qué es |
| --- | --- |
| `app/(app)/recoleccion/page.tsx` | Server Component de la ruta nueva: rol server-side + `listarRecoleccion()` + `estadoBloqueoMensajero()` + datos por props |
| `app/(app)/recoleccion/_components/RecolectadasHoyLista.tsx` | Lista «Recolectadas hoy» (presentación pura, no reordena ni recorta) |
| `lib/constants/bloqueo-mensajero.ts` | `BLOQUEO_AVISO` compartido por los DOS portales del mensajero (`design.md §7.1`, punto 3) |
| `tests/components/RecoleccionPage.test.tsx` | Borde de la página (9 casos) |
| `tests/unit/guards/entregas-sin-recoleccion.test.ts` | Guard de no-reintroducción (12 casos) |

### Movidos (`git mv`, con adaptación)

| Antes | Ahora |
| --- | --- |
| `app/(app)/mis-asignaciones/_components/RecoleccionTiendaPanel.tsx` | `app/(app)/recoleccion/_components/RecoleccionModule.tsx` |
| `app/(app)/mis-asignaciones/_components/useRecolectarPorGuia.ts` | `app/(app)/recoleccion/_components/useRecolectarPorGuia.ts` |
| `tests/components/RecoleccionTiendaPanel.test.tsx` | `tests/components/RecoleccionModule.test.tsx` |

### Modificados

| Ruta | Qué cambió |
| --- | --- |
| `lib/auth/menu-visibility.ts` | + `IconKey` `"store"` (con el porqué, molde de `shieldAlert`/`chartColumn`) y + ítem «Recolección» → `/recoleccion`, `roles: ["mensajero"]`, justo tras «Entregas» |
| `app/(app)/_components/Sidebar.tsx` | + `store: Store` en `ICON_BY_KEY` (+ import de lucide) |
| `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` | − import del panel, − prop `porRecolectar`, − bloque montado; `BLOQUEO_AVISO` pasa a importarse de `lib/constants/` |
| `app/(app)/mis-asignaciones/page.tsx` | − `porRecolectar={result.porRecolectar}` |
| `lib/interfaces/services/IMisAsignacionesService.ts` | Solo COMENTARIO: se declara en el propio código la deuda P1 de `tiendaTelefono` (el campo NO se retira) |
| `tests/components/MisAsignacionesModule.test.tsx` | − `describe` de la 157 (4 casos), − `porRecolectar` de `renderModule`; + `describe` "Entregas no monta ninguna superficie de recolección" (2 casos) |
| `tests/components/MisAsignacionesPage.test.tsx` | fixtures sin `porRecolectar` (mecánico; ningún assert cambia) |
| `tests/unit/auth/menu-visibility.test.ts` | lista exacta del mensajero + `describe` nuevo de la 167 (6 casos) |
| `tests/components/Sidebar.test.tsx` | `TODAS_LAS_CLAVES` + `"store"`; + caso de icono PROPIO (clase `lucide-store`) |
| `specs/167-.../tasks.md` | T2.1–T2.11 y T3.1–T3.4 marcadas `[x]` |

**No se tocó:** `tests/unit/guards/recoleccion-no-contamina.test.ts` (T2.11, evidencia abajo),
`tests/unit/analytics/frontera.guardia.test.ts`, `tests/unit/guards/no-embalaje.test.ts` (el alta que
la 167 necesitaba ya la dio la fase 1), `CierreDiaModule.tsx`, `GestionarOrdenPanel`, el modo foco,
el buscador y el filtro cantón/distrito de Entregas.

---

## T2.1 / T2.2 — Navegación

`IconKey` gana `"store"`. Es una unión CERRADA y `ICON_BY_KEY` está tipado
`Record<IconKey, SidebarIcon>`: añadir la clave sin darle icono rompe el typecheck (la garantía que
dejaron montada la 129 y la 158). Se usa `Store` de lucide, el MISMO icono que ya encabezaba el
bloque de escaneo de la recolección, así que el lenguaje visual del mensajero no cambia; y **no** se
comparte con «Entregas» (`truck`), que es justo la confusión que R5 existe para impedir.

```
$ pnpm exec vitest run tests/unit/auth/menu-visibility.test.ts tests/components/Sidebar.test.tsx
 Test Files  2 passed (2)
      Tests  44 passed (44)
```

---

## T2.3 — Página `/recoleccion`

Calcada de `mis-asignaciones/page.tsx`: `resolveActorFromSession` → `notFound()` si el rol no es
`mensajero` **antes** de leer nada, `listarRecoleccion()`, `estadoBloqueoMensajero()` y los datos al
módulo POR PROPS. `middleware.ts` no se tocó: es deny-by-default, así que `/recoleccion` queda
protegida sin añadir nada.

`tests/components/RecoleccionPage.test.tsx` (**9 casos**) cubre además dos bordes que el spec no
nombraba pero que la página decide: `listarRecoleccion` → `unauthenticated` también da `notFound`, y
si la derivación del bloqueo DEGRADA (`status: "unauthenticated"`) **no** se bloquea al mensajero
—mismo criterio que `/mis-asignaciones`, y el backend de la 157/R31 sigue siendo la defensa real—.

---

## T2.4 — El hook, sin pre-chequeo local (R12)

`useRecolectarPorGuia` pierde su parámetro: ya no recibe ninguna lista. El rechazo local de guías
ajenas (`:42-48`) desaparece entero. Lo que se conserva intacto es el mapa de toasts por resultado
(R13) y el corte de código mal formado (R11), que lo hace el llamador antes de entrar al hook.

Probado por los dos lados en `RecoleccionModule.test.tsx`:
"R12: una guía que NO está en la lista cargada SÍ llega al servidor" (la action recibe `9999` y el
toast sale del `no_encontrada` del servidor) y "R7: con lista vacía el escaneo SÍ se puede confirmar
(el escáner no es decorativo)".

---

## T2.5 / T2.6 — `RecoleccionModule` y `RecolectadasHoyLista`

Los cuatro cambios de `design.md §7.1`, ni uno más: fuera el `return null` de la lista vacía, estado
vacío explícito, aviso de bloqueo propio con el texto compartido, y `RecolectadasHoyLista` debajo de
los grupos. Se conservan sin cambios `agruparPorTienda`, `textoConteo`, el contacto de la tienda, la
confirmación persistente de la última guía (`ultima`, R15) y la ausencia total de controles de
gestión (R22).

La hora de «Recolectadas hoy» se formatea con `Intl.DateTimeFormat("es-CR", { timeStyle: "short",
timeZone: "America/Costa_Rica" })` (molde de `HistorialOrdenTimeline`): **fija a la zona de CR**, la
misma convención con la que el servidor decidió qué es "hoy" (R27), así que la hora que el mensajero
lee y el día al que pertenece la fila no pueden contradecirse — y el test no depende de la zona
horaria de la máquina que lo corre.

---

## T2.7 — Tests del apartado nuevo (`RecoleccionModule.test.tsx`, 26 casos)

**Ningún assert de la 157 se perdió sin sustituto.** Trazabilidad caso a caso:

| Caso de la 157 | Qué pasó |
| --- | --- |
| R14 agrupa por tienda | conservado (ahora "R17: agrupa por tienda…") |
| R15 llama a la TIENDA | conservado (ahora "R19: …") |
| R15 sin teléfono no pinta botones | conservado (ahora "R20: …") |
| R16 NO ofrece controles de gestión | conservado (ahora "R22: …") |
| R17 la vía manual confirma y avisa al padre | conservado (ahora "R10: …y revalida el apartado"); el `onRecolectada` se comprueba como `router.refresh()` (ver D6) |
| R20 un código que no son dígitos no llega a la action | conservado (ahora "R11: …vía manual") |
| R23 idempotencia (`ya_recolectada` informa, no es error) | conservado (ahora "R13: …") |
| R24 bloqueado: lista visible, sin forma de mover nada | conservado y AMPLIADO (ahora "R9: sin bloque de captura y CON aviso" + "R23: las dos listas en solo-lectura") |
| **"sin nada que recolectar el apartado no se muestra"** | **INVALIDADO por R7** → sustituido por "R7/R8: con la lista VACÍA el escáner sigue montado y el vacío se explica" |
| **"R21: una guía que NO es suya se rechaza en cliente"** | **INVALIDADO por R12** → sustituido por "R12: una guía que NO está en la lista cargada SÍ llega al servidor" |

Casos NUEVOS: vía cámara (R10) y QR mal formado por cámara (R11) —con `QrScanner` sustituido por un
disparador del mismo `onDecoded`, porque jsdom no abre la cámara y la librería ya tiene su propio
test—; `estado_invalido` y `conflict` con su mensaje propio (R13); la confirmación persistente
(R15); el contrato del DTO sin cobro ni ruta (R18/R38); y los seis de «Recolectadas hoy» (R24, R28,
R30, R31 en sus dos ramas, y la guía sin número).

---

## T2.8 / T2.9 — Corte limpio en la UI de Entregas

`grep -in "recolect"` sobre `MisAsignacionesModule.tsx` y `mis-asignaciones/page.tsx`: **0
ocurrencias** (ni en código ni en comentarios; el comentario que documenta la ausencia usa la palabra
acentuada «recolección», que no contiene esa subcadena).

En `tests/components/MisAsignacionesModule.test.tsx` el `describe` de la 157 (4 casos) se sustituye
por uno de DOS casos: "R33: ni región, ni escáner, ni aviso, ni conteo, ni enlace al apartado nuevo"
—que además comprueba que ningún enlace apunta a `/recoleccion`— y "R33: tampoco con el mensajero
BLOQUEADO", que es donde un aviso podría colarse. Los ≈2.400 casos de gestión, foco, buscador y
filtro quedaron **intactos** (R35): 91 casos verdes en ese archivo, sin tocar ninguno.

Por qué DOS casos y no cuatro: R11 ("los tres apartados coexisten") deja de ser cierto POR DISEÑO, y
R39/R40/R25 (no entra al mapa, ni al filtro, ni al modo foco) ya no pueden probarse aquí porque no
hay nada que pueda entrar. Su cobertura real **migró al backend y es más fuerte**:
`mis-asignaciones-service.test.ts` exige la lista EXACTA `["por_recoger","en_reparto"]` (R34) — lo
que no se lee no puede contaminar nada.

---

## T2.10 — El guard nuevo FALLA si se reintroduce el panel (evidencia real)

`tests/unit/guards/entregas-sin-recoleccion.test.ts`, molde de `recoleccion-no-contamina.test.ts`.
Ámbito: los tres archivos de Entregas. Prohibidos: `RecoleccionTiendaPanel`, `porRecolectar`,
`recolectando`. Tres mutaciones, cada una revertida después:

```
=== M1: reintroducir el import del panel en MisAsignacionesModule ===
  x app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx no menciona
    `RecoleccionTiendaPanel` en codigo ejecutable
      Tests  1 failed | 11 passed (12)

=== M2: la pagina vuelve a nombrar porRecolectar ===
  x app/(app)/mis-asignaciones/page.tsx no menciona `porRecolectar` en codigo ejecutable
      Tests  1 failed | 11 passed (12)

=== M3: el service vuelve a leer el estado recolectando ===
  x lib/services/MisAsignacionesService.ts no menciona `recolectando` en codigo ejecutable
  x la lectura de Entregas pide EXACTAMENTE los dos estados de su propio flujo (R34)
      Tests  2 failed | 10 passed (12)

=== restaurado ===
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Dos decisiones sobre el molde, declaradas:

1. **`sinComentarios` se amplía a los bloques de comentario multilínea.** El de la 157 solo filtra
   líneas `//`. El corte limpio dejó escrito EN COMENTARIO por qué la recolección ya no está aquí, y
   esa explicación es justo lo que no debe borrarse para que el guard pase.
2. **Dos casos de existencia.** Uno comprueba que los tres archivos vigilados existen (un guard que
   lee un archivo inexistente pasaría en verde sin proteger nada). El otro comprueba que el apartado
   nuevo SIGUE existiendo: que Entregas no lo monte no puede significar que se perdiera, o el guard
   pasaría a tapar la regresión que la feature vino a arreglar.

---

## T2.11 — `recoleccion-no-contamina.test.ts` sigue verde SIN tocarlo

```
$ git diff -- tests/unit/guards/recoleccion-no-contamina.test.ts
[vacio]
$ git diff origin/dev -- tests/unit/guards/recoleccion-no-contamina.test.ts
[vacio]
$ pnpm exec vitest run tests/unit/guards/recoleccion-no-contamina.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Diff **vacío** contra el índice y contra `origin/dev`, y el archivo en verde. Nada de esta fase tocó
el cierre del día ni el ranking (R37/R39).

---

## T3.1 — Verificación completa

### `pnpm run typecheck` — **VERDE** (los 3 rojos declarados de la fase 1, cerrados)

```
> tsc --noEmit
(sin salida)
```

Los tres puntos que la fase 1 dejó en rojo a propósito eran exactamente los de esta fase:
`mis-asignaciones/page.tsx:46` (T2.8) y `MisAsignacionesPage.test.tsx:65,103` (T2.9). Cerrados los
tres. Por el camino aparecieron —y se cerraron— 5 errores más en
`tests/components/MisAsignacionesModule.test.tsx` (la prop `porRecolectar` de `renderModule` y de 4
fixtures del `describe` retirado), que la fase 1 no podía ver porque `tsc` se detiene en el primer
error de cada expresión.

### `pnpm run lint` — 25 problemas: los 3 errores de siempre y NI UN problema nuevo

```
app\(app)\ordenes\_components\OrdenesModule.tsx
  340:34  error    Compilation Skipped: Existing memoization could not be preserved
  345:7   error    Compilation Skipped: Existing memoization could not be preserved
  345:21  error    Compilation Skipped: Existing memoization could not be preserved
x 25 problems (3 errors, 22 warnings)
```

**Deuda de `dev` sin dueño** (archivo byte-idéntico a `origin/dev`); no se arregla y no se cuenta
como de esta feature. El baseline de la fase 1 eran 26 problemas (3 errores, 23 warnings): hay UN
warning MENOS, no uno más. El que desapareció está identificado: `'within' is defined but never
used` en el viejo `RecoleccionTiendaPanel.test.tsx` — el archivo reescrito sí usa `within`.
Verificado además que los **8 archivos nuevos/movidos de esta fase dan 0 problemas** de eslint.

### `pnpm test` — la suite completa

```
 Test Files  2 failed | 663 passed (665)
      Tests  7 failed | 8035 passed (8042)
   Duration  180.82s
```

Los 7 rojos están en los **2 archivos ajenos de siempre**, ambos byte-idénticos a `origin/dev`:

| Archivo | Casos rojos | Antes (fase 1) | Veredicto |
| --- | --- | --- | --- |
| `tests/unit/analytics/frontera.guardia.test.ts` | 6 | 5 | Guard PINNEADO a la 135 que mide el diff de **la rama actual** y exige que viva en `lib/analytics/`. El caso que se suma es literalmente **"no anade rutas, paginas ni componentes en app o components"** — es decir, el guard prohíbe justo lo que R1 de esta feature ORDENA hacer. Medido: con la fase 2 fuera del árbol (stash), el mismo guard falla 5 casos; con ella, 6. No es un hallazgo sobre esta feature: es el guard midiendo la rama equivocada (P3). |
| `tests/unit/guards/no-embalaje.test.ts` | 1 | 1 | **Idéntico.** Único hallazgo: `specs/135-analitica-catalogo-kpis-rangos/tasks.md:187`, presente en `origin/dev`. La fase 2 no aporta ni uno. |

**Prueba de que la fase 2 no aporta ni un rojo propio** — la misma suite excluyendo esos dos:

```
$ pnpm exec vitest run \
    --exclude "tests/unit/analytics/frontera.guardia.test.ts" \
    --exclude "tests/unit/guards/no-embalaje.test.ts"

 Test Files  663 passed (663)
      Tests  8032 passed (8032)
   Duration  181.72s
```

**663/663 archivos y 8032/8032 casos en verde.**

Archivos de esta fase, ejecutados juntos: `RecoleccionModule` **26** · `RecoleccionPage` **9** ·
`MisAsignacionesModule` **91** · `MisAsignacionesPage` **5** · `Sidebar` **18** ·
`menu-visibility` **26** · `entregas-sin-recoleccion` **12** · `recoleccion-no-contamina` **5**
= `Test Files 8 passed (8)` / `Tests 192 passed (192)`.

### `./init.sh` — verde hasta `lint`, donde corta por la deuda ajena

```
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=3)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso            <- la fase 1 lo dejaba en rojo; aquí ya pasa
-> pnpm run lint
...
x 25 problems (3 errors, 22 warnings)
x 'pnpm run lint' fallo
```

`init.sh` corta en `lint` y **nunca llega a `test`**: por eso los números de la suite se sacan
aparte, como ya hizo la fase 1.

---

## T3.2 — Mapa `R<n> → test` de la FASE 2 (los 21 restantes)

Los 18 de la fase 1 están arriba, con archivo y nombre de caso. Aquí van los de esta fase.

| R | Test (archivo → nombre del caso) |
| --- | --- |
| **R1** | `tests/components/RecoleccionPage.test.tsx` → "R1/R2: el mensajero ve la página con su título propio y el apartado montado" + `tests/unit/guards/entregas-sin-recoleccion.test.ts` → "el apartado de recoleccion SIGUE existiendo en su pagina propia (R1)" |
| **R2** | `RecoleccionPage.test.tsx` → "R1/R2: el mensajero ve la página con su título propio y el apartado montado" |
| **R3** | `RecoleccionPage.test.tsx` → "R3: cualquier rol distinto de mensajero NO ve la página (notFound) ni sus datos" (5 roles) · "R3: sin sesión válida tampoco (notFound), sin consultar nada" · "R3: si la lectura responde forbidden, tampoco renderiza el apartado" · "R3: si la lectura responde unauthenticated, tampoco" |
| **R4** | `tests/unit/auth/menu-visibility.test.ts` → "R4: existe exactamente UN ítem con href '/recoleccion'…" · "R4: lo ve el mensajero" · "R4: NINGÚN otro rol lo ve, ni un actor ausente" · "mensajero ve Entregas + Recolección + Ranking + Cierre del día + Perfil…" (lista EXACTA) · "decisión del humano (2026-07-31): va justo debajo de 'Entregas'" + `tests/components/Sidebar.test.tsx` → "R4/R5: el enlace a /recoleccion existe y su icono es PROPIO (no el de Entregas)" |
| **R5** | `menu-visibility.test.ts` → "R5: su iconKey es 'store' y ningún otro ítem de SIDEBAR_ITEMS usa esa clave" (+ contraste explícito con `entregas.iconKey`) + `Sidebar.test.tsx` → "R4/R5: …su icono es PROPIO" (clase `lucide-store`, contra Entregas y contra TODOS los demás ítems) + garantía TIPADA: `TODAS_LAS_CLAVES … satisfies readonly IconKey[]` y `Record<IconKey, SidebarIcon>` |
| **R6** | `RecoleccionPage.test.tsx` → "R6/R7: los datos del payload llegan al módulo POR PROPS (y el escáner va montado)" (`listarRecoleccion` llamada UNA vez desde la página; el módulo no fetchea) + el borde de la action, cubierto por la fase 1 |
| **R7** | `tests/components/RecoleccionModule.test.tsx` → "R7/R8: con la lista VACÍA el escáner sigue montado y el vacío se explica" · "R7: con lista vacía el escaneo SÍ se puede confirmar (el escáner no es decorativo)" · "R7: con órdenes asignadas el escáner sigue igual de montado" + `RecoleccionPage.test.tsx` → "R7/R8: con NADA asignado la página sigue montando el escáner y explica el vacío" |
| **R8** | `RecoleccionModule.test.tsx` → "R7/R8: …el vacío se explica" · "R8/R9: bloqueado y sin nada asignado, el vacío se explica igual (sin escáner)" + `RecoleccionPage.test.tsx` → "R7/R8: …explica el vacío" |
| **R9** | `RecoleccionModule.test.tsx` → "R9: sin bloque de captura y CON un aviso que dice el motivo y qué hacer" (comprueba el motivo Y el "Ve a «Cierre del día»") + `RecoleccionPage.test.tsx` → "R9: el bloqueo por cierre pendiente lo deriva el SERVIDOR y apaga el escáner" · "R9: si la derivación del bloqueo degrada, NO se bloquea al mensajero" |
| **R10** | `RecoleccionModule.test.tsx` → "R10: la vía manual confirma la guía y revalida el apartado" · "R10: la vía CÁMARA confirma exactamente igual (mismo action, mismo resultado)" |
| **R11** | `RecoleccionModule.test.tsx` → "R11: un código que no son dígitos no llega a la action (vía manual)" · "R11: un QR que no es la URL del paquete tampoco llega a la action (vía cámara)" |
| **R12** | `RecoleccionModule.test.tsx` → "R12: una guía que NO está en la lista cargada SÍ llega al servidor" |
| **R13** | `RecoleccionModule.test.tsx`, **los 8 resultados con su mensaje aseverado** (corregido tras el review, m1): "R10: la vía manual confirma la guía…" (`ok`) · "R12: …" (`no_encontrada`) · "R13: escanear dos veces la misma etiqueta informa, no dice que sea un error" (`ya_recolectada`) · "R13: un estado inválido dice EN QUÉ estado está, no un error genérico" · "R13: un conflicto (bloqueo o carrera) traslada el MOTIVO que da el servidor" · **"R13: `forbidden` dice que no tiene permiso, no un error genérico"** · **"R13: `unauthenticated` manda a iniciar sesión de nuevo (no dice que la guía esté mal)"** · **"R13: `validation_error` del SERVIDOR también dice que el código es inválido"**. **Ya NO se imputa a `tests/integration/actions/recoleccion-tienda-action.test.ts`**: ese archivo verifica el *status* que devuelve la action, no el *mensaje* que lee el mensajero, que es lo que R13 exige |
| **R14** | `RecoleccionModule.test.tsx` → "R10: …y revalida el apartado" (`router.refresh()` tras una confirmación efectiva) · "R13: escanear dos veces…" (también revalida: idempotente) · y el contraste: "R12: …" comprueba que **NO** revalida cuando no hubo transición |
| **R15** | `RecoleccionModule.test.tsx` → "R15: la confirmación de la última guía PERMANECE tras el toast" |
| **R17** | `RecoleccionModule.test.tsx` → "R17: agrupa por tienda, con una tarjeta por orden" |
| **R18** | `RecoleccionModule.test.tsx` → "R18: no muestra monto a cobrar — el DTO ni siquiera lo transporta (R38)" (censo EXACTO de las 7 claves del DTO) + `recoleccion-tienda-service.test.ts` (fase 1) |
| **R19** | `RecoleccionModule.test.tsx` → "R19: llama a la TIENDA, no al destinatario" |
| **R20** | `RecoleccionModule.test.tsx` → "R20: una tienda sin teléfono no pinta botones de contacto muertos" (+ el contrato `null`, fase 1) |
| **R22** | `RecoleccionModule.test.tsx` → "R22: NO ofrece ningún control de gestión (ni cobro, ni evidencia, ni resultados)" |
| **R23** | `RecoleccionModule.test.tsx` → "R23: bloqueado, las dos listas se siguen viendo en solo-lectura" |
| **R24** (UI) | `RecoleccionModule.test.tsx` → "R24/R28: muestra guía, remisión, tienda y hora de cada recolección del día" · "R24: una guía sin número se muestra igual, sin romper la fila" + `RecoleccionPage.test.tsx` → "R6/R7: los datos del payload llegan al módulo POR PROPS" |
| **R28** (UI) | `RecoleccionModule.test.tsx` → "R24/R28: muestra guía, remisión, tienda y hora…" · "R28: respeta el orden recibido (más reciente primero) sin reordenar" |
| **R30** | `RecoleccionModule.test.tsx` → "R30: sin recolecciones hoy lo DICE, en lugar de omitir la lista" |
| **R31** (UI) | `RecoleccionModule.test.tsx` → "R31: con la lista recortada avisa de que no está todo, **con el TOPE REAL**" (el número del aviso se deriva de `TOPE_RECOLECTADAS_HOY`, no de un literal) · "R31: sin recorte NO aparece el aviso (no se alarma de gratis)" |
| **R33** | `tests/components/MisAsignacionesModule.test.tsx` → "R33: ni región, ni escáner, ni aviso, ni conteo, ni enlace al apartado nuevo" · "R33: tampoco con el mensajero BLOQUEADO (donde el aviso podría colarse)" + `tests/unit/guards/entregas-sin-recoleccion.test.ts` (9 censos de fuente, **verificado por mutación**) |
| **R35** | `MisAsignacionesModule.test.tsx` — los 91 casos de gestión, modo foco, buscador y filtro **verdes sin tocar ninguno** + `MisAsignacionesPage.test.tsx` (5 casos, solo fixtures) |

**Los 39 requisitos quedan mapeados a un test concreto con nombre.** Ninguno sin cubrir.

---

## T3.3 — E2E: checkpoint **INAPLICABLE**, declarado

**No hay harness de Playwright ejecutable en este repo.** No existe `playwright.config.*`, no hay
script `e2e` en `package.json` y los specs anteriores registran el checkpoint como `NOT EXECUTED`.
No se inventa un E2E ni se simula una corrida.

**Cómo queda cubierto el riesgo, entonces:** los caminos que un E2E habría recorrido están cubiertos
por debajo y por encima. Por debajo, con tests reales: el borde de la página con el rol mockeado
(`RecoleccionPage.test.tsx`), el módulo con `userEvent` sobre el DOM real de jsdom —incluido el
camino de cámara— y el guard estático del corte limpio. Por encima, con la lista de verificación
humana de T3.4, que es la que de verdad puede comprobar lo único que ningún test de este repo
alcanza: que el QR de una etiqueta impresa se decodifique con la cámara de un móvil real.

---

## T3.4 — Lista de verificación humana en pantalla

Con un usuario **mensajero** real, en este orden:

1. **El ítem está.** Iniciar sesión y mirar el menú lateral: debe aparecer **«Recolección»**, justo
   debajo de «Entregas», con un icono de tienda distinto del camión. Ningún otro rol debe verlo
   (probar con el maestro: el ítem no está, y entrar a mano a `/recoleccion` da 404).
2. **El escáner está aunque no haya nada.** Entrar a «Recolección» **sin ninguna recolección
   asignada**: debe verse la caja de escaneo con su cámara y su campo de número, y un texto que
   explique que no hay órdenes asignadas ahora mismo. *(Este es el bug que originó la feature: antes
   la pantalla estaba muda.)*
3. **Escanear funciona.** Con una recolección asignada, escanear el QR de su etiqueta con la cámara
   del móvil: la orden desaparece de «Por recolectar» y aparece en «Recolectadas hoy» con su hora.
   Escanearla otra vez debe decir que ya estaba recolectada, sin parecer un error.
4. **Sobrevive a la bodega central.** Que la bodega central reciba ese paquete (feature 138) y volver
   a `/recoleccion`: la orden **sigue** en «Recolectadas hoy». *(Es la razón de leer del historial y
   no del estado.)*
5. **Bloqueado por cierre.** Con un cierre pendiente (`solicitado`/`vencido`): **no** hay caja de
   escaneo, **sí** hay un aviso rojo que dice por qué y remite a «Cierre del día», y las dos listas
   siguen visibles en solo-lectura.
6. **Entregas quedó limpio.** Abrir «Entregas»: no debe aparecer ninguna mención de la recolección —
   ni lista, ni escáner, ni aviso, ni conteo, ni enlace—, y el flujo de gestión (escoger orden, modo
   foco, buscador, filtro de cantón) debe funcionar igual que antes.

---

## Desviaciones de la FASE 2 respecto de `tasks.md` / `design.md` (declaradas, no ocultas)

**D6 — `RecoleccionModule` ya NO recibe `onRecolectada` por props: revalida él mismo con
`router.refresh()`.** El panel de la 157 recibía el callback porque lo montaba otro componente de
cliente (`MisAsignacionesModule`). Ahora lo monta la PÁGINA, que es un Server Component y no puede
pasar funciones por el borde RSC. `design.md §5.5` ya lo dibuja así (`onRecolectada -> router.refresh()`
colgando del módulo). Consecuencia en los tests: donde la 157 aseveraba
`expect(onRecolectada).toHaveBeenCalled()`, ahora se asevera `expect(refreshMock).toHaveBeenCalled()`
sobre `useRouter().refresh` mockeado — misma garantía, un nivel más abajo.

**D7 — `useRecolectarPorGuia` se queda SIN parámetro, en vez de recibir `RecoleccionOrdenDTO[]`.**
T2.4 daba las dos opciones ("su firma pasa a `RecoleccionOrdenDTO[]` o a ninguna lista"). Retirado el
pre-chequeo (R12), la lista no tiene ningún uso dentro del hook: dejarla sería un parámetro muerto
que invita a que alguien vuelva a filtrar con él.

**D8 — `BLOQUEO_AVISO` se extrae a `lib/constants/bloqueo-mensajero.ts` y lo importan los DOS
módulos.** `design.md §7.1` daba a elegir entre extraer o duplicar y decidía extraer; se cumple. NO
se tocó `CierreDiaModule.tsx`, que tiene su propia variante del texto SIN el "Ve a «Cierre del día»":
allí el mensajero ya está en esa pantalla y remitirlo a donde está sería ruido. Los dos textos no son
el mismo y no deben unificarse a ciegas (ver P5).

**D9 — El guard nuevo amplía `sinComentarios` a los comentarios multilínea y añade 2 casos de
existencia** (detalle y porqué en T2.10). El molde de la 157 solo filtraba líneas `//`.

**D10 — Se añadió un comentario a `lib/interfaces/services/IMisAsignacionesService.ts`** (solo
documentación, sin cambio de tipo) para declarar EN EL PROPIO CÓDIGO la deuda P1 de `tiendaTelefono`.
El campo NO se retira, por decisión del leader (2026-07-31): `design.md §2.3` no lo lista entre las
retiradas y hacerlo tocaría fixtures de varios tests de Entregas, ampliando el alcance sin que nadie
lo pidiera. **Se deja marcado para el reviewer.**

**D11 — `tests/components/MisAsignacionesModule.test.tsx` sustituye 4 casos por 2, no por 1.**
`design.md §9` decía "se sustituye por UN caso nuevo". Se entregan dos: el segundo cubre el escenario
BLOQUEADO, que es el único sitio donde un aviso de recolección podría colarse de vuelta sin que el
primero lo notara.

---

## Preguntas abiertas NUEVAS de la fase 2

**P5 — El texto de bloqueo de `CierreDiaModule` sigue siendo una tercera variante.** Hoy hay dos
literales distintos del mismo aviso: el compartido (Entregas + Recolección, con CTA) y el de
`CierreDiaModule` (sin CTA, deliberadamente). Es correcto hoy, pero nada impide que uno de los dos
derive del otro sin que nadie se entere. *¿Se unifica en `lib/constants/bloqueo-mensajero.ts` como
dos constantes hermanas —una con CTA y otra sin él— o se deja como está?* No se tocó:
`CierreDiaModule` está fuera del alcance de esta feature.

**P6 — El apartado nuevo no tiene acceso cruzado a «Por recoger».** El mensajero que está en la
tienda y quiere ver su reparto tiene que volver por el menú. Es lo que la decisión 2 del humano
(corte limpio) pide, y funciona; se anota por si el uso real pide un atajo. *No se implementa nada.*

**P3 (ya abierta en la fase 1) se agrava.** `frontera.guardia.test.ts` suma un caso rojo con esta
fase — "no anade rutas, paginas ni componentes en app o components" —, que es literalmente lo que R1
ordena hacer. Mientras ese guard mida el diff de la rama ACTUAL contra `dev`, **toda** feature que
toque `app/` nacerá roja. Sigue sin decisión: *¿se acota al branch de la 135, se congela contra su
commit de merge, o se retira?*

---

## Veredicto de la FASE 2

**Fase 2 (frontend) y cierre técnico COMPLETOS.** El mensajero tiene un apartado propio con ruta e
ítem de menú suyos, el escáner montado SIEMPRE —también con la lista vacía, que era el bug—, «Por
recolectar» agrupada por tienda sin un solo dato de cobro, «Recolectadas hoy» leída del historial con
su tope y su aviso de recorte, y un aviso de bloqueo que dice su causa y qué hacer. Entregas quedó
sin ni un rastro de recolección, con un guard que lo mantiene así y **verificado por mutación**.
`typecheck` VERDE (los 3 rojos que la fase 1 dejó declarados, cerrados), `lint` sin ni un problema
nuevo (25 vs 26 del baseline) y la suite en **663/663 archivos y 8032/8032 casos verdes** una vez
descontados los dos guards que ya estaban rojos en `origin/dev`. `no-embalaje` sigue con **el mismo
único hallazgo ajeno**; `frontera.guardia` suma un caso por prohibir exactamente lo que R1 exige, y
queda declarado como P3, no como deuda de esta feature. **T3.5 no se ejecutó: es del leader.**

---
---

# Cierre de menores del review (m1, m2, m3, m5)

> Misma rama y worktree. Ejecutor: `frontend_dev`, después del review
> (`progress/review_167-apartado-recoleccion-mensajero.md`, APROBADO CON NOTAS, 0 bloqueantes).
> Alcance ESTRICTO: los cuatro menores de abajo. **m4** (`MiAsignacionDTO.tiendaTelefono`) NO se
> toca: es decisión del humano y sigue pendiente. **m6** (T3.5) es del leader.

## m3 — el guard nuevo vigilaba un nombre muerto

`tests/unit/guards/entregas-sin-recoleccion.test.ts`: `PROHIBIDOS` pasa de
`RecoleccionTiendaPanel` (nombre que ya no existe en el árbol) a **`RecoleccionModule`**, el real.
Era un tercio del guard protegiendo contra algo imposible.

**Evidencia por mutación** (la mutación es una línea: `import { RecoleccionModule } from
"@/app/(app)/recoleccion/_components/RecoleccionModule";` en `MisAsignacionesModule.tsx`, **sin
nombrar ninguna prop** — exactamente el hueco que demostró el reviewer):

```
1) guard SIN cambiar, árbol limpio            -> Tests  12 passed (12)
2) guard SIN cambiar + MUTACIÓN puesta        -> Tests  12 passed (12)   <- EL HUECO
3) guard CORREGIDO + la misma mutación        -> Tests  1 failed | 11 passed (12)
     x app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx
       no menciona `RecoleccionModule` en codigo ejecutable
4) mutación REVERTIDA (guard corregido)       -> Tests  12 passed (12)
```

Revertida y comprobada: `grep -c "RecoleccionModule"` sobre `MisAsignacionesModule.tsx` = **0**, y
`grep -in "recolect"` sobre ese archivo sigue en **0 ocurrencias**.

## m5 — el tope 100 ya no está duplicado

`TOPE_RECOLECTADAS_HOY` se muda a **`lib/constants/recoleccion-tienda.ts`** (módulo puro: sin
Prisma, sin repos, sin `zod`). Lo importan el service —que lo aplica— y `RecolectadasHoyLista`
—que lo NOMBRA en el aviso—, así que el aviso ya no puede mentir:
`` const RECORTADA = `Se muestran las ${TOPE_RECOLECTADAS_HOY} más recientes de hoy.` ``.

Se eligió el módulo de constantes, y **no** llevar el número por props en el payload, por dos
razones: un componente de cliente no puede importar del service sin arrastrarlo al bundle y cruzar
el borde RSC, y añadir un campo al DTO habría tocado contrato, action y página para transportar
una constante de presentación que no depende de los datos. Precedente en el propio repo:
`lib/constants/bloqueo-mensajero.ts`.

Tests: el de UI deriva el patrón de la constante (`avisoRecorte`) en vez de aseverar el literal, y
el del service importa la constante de su casa nueva. **Comprobado que la derivación no es
decorativa**, con el tope mutado a 42:

```
tope=42, UI derivando          -> Tests  29 passed (29)   (el aviso dice 42, el test también)
tope=42, UI con el 100 a mano  -> Tests  1 failed | 28 passed (29)
   x R31: con la lista recortada avisa de que no está todo, con el TOPE REAL
restaurado (tope=100)          -> verde
```

## m1 — R13 pasa de 5 a 8 resultados aseverados

Tres casos nuevos en `tests/components/RecoleccionModule.test.tsx`, cada uno sobre el **mensaje que
lee el mensajero**, no sobre el status:

| Caso | Mensaje aseverado |
| --- | --- |
| "R13: `forbidden` dice que no tiene permiso, no un error genérico" | `No tienes permiso para recolectar órdenes.` |
| "R13: `unauthenticated` manda a iniciar sesión de nuevo (no dice que la guía esté mal)" | `Tu sesión expiró. Inicia sesión de nuevo.` |
| "R13: `validation_error` del SERVIDOR también dice que el código es inválido" | `Código inválido.` (y **la action SÍ fue llamada**: distingue este camino del corte local de R11) |

Los tres comprueban además que **no** se revalida (`router.refresh()` no se llama) y el de
`forbidden` que no queda confirmación en pantalla. La fila **R13** de la tabla de trazabilidad
(T3.2) queda corregida: ya no imputa nada a `tests/integration/actions/recoleccion-tienda-action.test.ts`,
que verifica el *status* de la action y no el *texto* del toast.

## m2 — la tabla decía más de lo que el guard prueba

`tests/unit/guards/recoleccion-no-contamina.test.ts` **NO se tocó** (T2.11): `git diff` contra el
índice **y** contra `origin/dev` **vacío**, comprobado otra vez al cerrar. Lo corregido es la fila
**R37/R39** del mapa de la fase 1, que ahora dice exactamente qué vigila ese guard
(`por_recolectar_en_tienda` fuera de `ESTADOS_PENDIENTES`, el estado de la 157) y deja declarado que
**ningún test vigila `recolectando` en el cierre del día ni en el ranking**: es deuda heredada de la
157, comprobada a mano por el reviewer (`CierreDiaService.ts:41`, lista cerrada
`["por_recoger","en_reparto"]`), que la 167 no crea, no agrava —diff vacío en esos módulos— y no
salda, porque cerrarla es ampliar el guard de otra feature.

## Archivos de este cierre

| Ruta | Qué cambió |
| --- | --- |
| `lib/constants/recoleccion-tienda.ts` | **NUEVO** — casa única de `TOPE_RECOLECTADAS_HOY` (m5) |
| `lib/services/RecoleccionTiendaService.ts` | importa el tope en vez de definirlo (m5) |
| `app/(app)/recoleccion/_components/RecolectadasHoyLista.tsx` | el aviso de recorte deriva el número de la constante (m5) |
| `tests/unit/guards/entregas-sin-recoleccion.test.ts` | `PROHIBIDOS`: `RecoleccionTiendaPanel` → `RecoleccionModule` (m3) |
| `tests/components/RecoleccionModule.test.tsx` | +3 casos de R13 (m1) y el aviso de recorte derivado (m5) |
| `tests/unit/services/recoleccion-tienda-service.test.ts` | importa el tope de `lib/constants/` (m5); ninguna aserción cambia |
| `progress/impl_167-…md` | filas R13, R31 (UI) y R37/R39 de trazabilidad corregidas (m1, m2) + esta sección |

**No se tocó:** `tests/unit/guards/recoleccion-no-contamina.test.ts`, `MiAsignacionDTO.tiendaTelefono`
(m4, del humano), `OrdenesModule.tsx` (deuda de `dev`), `frontera.guardia.test.ts` ni
`no-embalaje.test.ts`.

## Verificación tras el cierre

| Comando | Resultado | vs. el review |
| --- | --- | --- |
| `pnpm run typecheck` | **sin salida (verde)** | igual |
| `pnpm run lint` | `25 problems (3 errors, 22 warnings)` — los 3 errores siguen siendo los de `OrdenesModule.tsx` | **idéntico**, ni un problema nuevo |
| `pnpm test` (completa) | `Test Files 2 failed / 663 passed (665)` · `Tests 7 failed / 8038 passed (8045)` | +3 casos (los de m1); **los mismos 7 rojos ajenos** |
| Misma suite excluyendo los 2 guards ajenos | `Test Files 663 passed (663)` · `Tests 8035 passed (8035)` | 8032 → **8035**, todo verde |
| Los 2 guards ajenos, corridos aparte | `Tests 7 failed \| 3 passed (10)` — 6 de `frontera.guardia`, 1 de `no-embalaje` | **exactamente igual**: `frontera.guardia` con `git diff origin/dev` vacío y `no-embalaje` con su única línea de whitelist de la fase 1 (D3) y su único hallazgo en `specs/135` |

Los 7 rojos de la suite completa son, uno a uno, los mismos 7 de esos dos archivos: este cierre no
aporta ni un rojo nuevo ni toca ninguno de los dos.
