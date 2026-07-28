# Feature 146 — Campana de notificaciones funcional · tasks.md

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas del mismo
bloque que ya tienen sus dependencias resueltas.

**Estado de la puerta:** F1.4 **aprobada**. Las 9 decisiones están cerradas en `design.md` §10.
No queda nada por consultar antes de implementar.

**Separación de zonas (no negociable):**
`backend_dev` toca `db/`, `lib/`, `tests/unit`, `tests/integration`. **No** toca `.tsx`.
`frontend_dev` toca `components/`, `hooks/`, `app/**/_components/*.tsx`, `tests/components`.
**No** toca `db/`, `lib/repositories/`, `lib/services/`.
La frontera contractual es `lib/types/notificacion.ts` (DTO) + las firmas de
`lib/actions/notificaciones.ts`: se escriben en A1 y B9/B10 y se congelan ahí.

---

## Bloque A — Contrato y tipos (backend, bloquea a todo lo demás)

- [x] **A1 — Tipos de dominio y schemas zod.**
      `lib/types/notificacion.ts`: `NotificationType`, `NotificacionEvento`,
      `NotificacionEntidadTipo`, `NotificacionDTO`, resultados de las 5 acciones,
      `notificacionIdSchema` y `cargaTerminadaSchema` (`creadas`/`total`/`loteId`, R36).
      *Hecho:* `pnpm typecheck` verde; el DTO tiene `id`, `notification_type`, `description`,
      `anexo?`, `read`, `createdAt` (design §3.1).
      *Depende de:* —

- [x] **A2 — Config.** `lib/config/notificaciones.ts` con `PAGE_SIZE = 50`,
      `REFRESH_INTERVAL_MS = 60_000`, `VENTANA_DIAS = 30` (F1.4-8, F1.4-6).
      *Hecho:* sin literales mágicos en services ni componentes.
      *Depende de:* — · `[P]` con A1

- [x] **A3 — `Actor` gana `zonaId`.** *(NUEVA — la trae el alcance por zona, F1.4-1)*
      Ampliar `resolveActorFromSession` y el tipo `Actor` con `zonaId: string | null`
      (`usuario.zona_id`, ya en el `include`).
      *Hecho:* cambio aditivo; `pnpm typecheck` verde sin tocar ningún consumidor existente;
      test de `resolve-actor` que verifica el campo.
      *Depende de:* —

---

## Bloque B — Backend (zona `backend_dev`)

- [x] **B1 — Migración `20260727120000_notificacion`.**
      `migration.sql` con los 3 enums, `notificacion` (incluidas **`tienda_id` y `zona_id`**
      con sus FK `ON DELETE CASCADE`), `notificacion_lectura`, `CHECK` XOR de destinatario,
      `CHECK` de marca presente, los 5 índices parciales + el índice de dedupe
      `NULLS NOT DISTINCT`, y `ENABLE ROW LEVEL SECURITY` en ambas tablas (design §1).
      *Hecho:* la migración aplica limpia sobre una base al día.
      *Depende de:* —

- [x] **B2 — `down.sql`.** Revierte exactamente B1 (tablas en orden inverso + `DROP TYPE`).
      *Hecho:* `pnpm db:rollback` deja el esquema idéntico al previo (`prisma migrate diff`
      vacío contra el estado anterior).
      *Depende de:* B1

- [x] **B3 — Modelos en `db/schema.prisma`.** `Notificacion` (con `tiendaId`/`zonaId`),
      `NotificacionLectura` y los 3 enums, `@@map`/`@map` en `snake_case`, relaciones inversas
      en `Usuario` (dos: destinatario y tienda) y `Zona`.
      *Hecho:* `pnpm db:generate` sin drift (`prisma migrate diff` schema↔migraciones vacío).
      *Depende de:* B1

- [x] **B4 — Denylist del invariante de migraciones.** Añadir `!d.endsWith("_notificacion")` a
      `tests/integration/db/zonas-migration.test.ts`.
      *Hecho:* `zonas-migration.test.ts` en verde. **Única** edición permitida a un test
      existente en esta feature.
      *Depende de:* B1

- [x] **B5 — Test de migración (R1–R11).** `tests/integration/db/notificacion-migration.test.ts`
      al estilo `zonas-migration` / `chat-*-migration`: regex sobre `migration.sql` y
      `down.sql`. Cubre columnas, **las dos columnas de alcance y sus FK `ON DELETE CASCADE`**,
      `CHECK` XOR, `CHECK` de marca, los índices parciales, el índice de dedupe con
      `NULLS NOT DISTINCT`, RLS habilitada en ambas tablas, y que el UP no toca tablas
      preexistentes.
      *Hecho:* R1, R2, R4, R5, R7, R8, R9, R10, R11 mapeados.
      *Depende de:* B1, B2 · `[P]` con B3/B4

- [x] **B6 — Repository + predicado de visibilidad.** *(CRECIÓ con F1.4-1)*
      `INotificacionRepository` + `NotificacionRepository`: `crear` (acepta `tx`),
      `existeNoLeidaPara` (dedupe, §1.4), `listarParaUsuario`, `marcarLeida` (upsert),
      `marcarTodasLeidas` (`ON CONFLICT DO NOTHING`), `descartar`, `findVisibleParaActor`, y
      **`predicadoVisibilidad(actor)`** como fuente única de R13–R17 (design §1.5). Sólo
      Prisma, sin lógica de negocio.
      *Hecho:* el predicado existe en UN solo lugar y las cinco consultas lo reutilizan
      (`grep` no encuentra un segundo filtro de alcance).
      *Depende de:* A1, A3, B3

- [x] **B7 — Tests del alcance (R13–R17).** *(NUEVA — la trae F1.4-1)*
      `tests/unit/repositories/notificacion-visibilidad.test.ts`: alcance NULL visible a todo
      el rol (R13); `tienda_id` con valor visible sólo a esa tienda (R14); **caso negativo**:
      un `adminTienda` NO ve el rechazo de otra tienda (R15); `zona_id` con valor visible sólo
      a esa zona y **no** a otra (R16); rol distinto nunca ve (R17); actor sin zona no ve las
      acotadas por zona.
      *Hecho:* R13, R14, R15, R16, R17 mapeados uno a uno, con nombres de comportamiento.
      *Depende de:* B6

- [x] **B8 — Service.** `INotificacionService` + `NotificacionService`: aplica el predicado,
      la ventana de 30 días y el límite de 50, deriva `read` y `noLeidas`, devuelve
      `forbidden`/`not_found` de dominio. Repositorio inyectado por constructor.
      *Hecho:* testeable sin DB (repo mockeado).
      *Depende de:* B6

- [x] **B9 — Tests unitarios del service (R3, R28–R33, R35, R37).**
      `tests/unit/services/notificacion-service.test.ts`: exclusión de descartadas, ventana de
      30 días y límite 50 (R29), orden, conteo de no leídas (R30), `forbidden` sobre
      notificación no visible (R35), idempotencia (R37), aislamiento entre dos usuarios del
      mismo rol (R3).
      *Hecho:* R3, R28, R29, R30, R31, R32, R33, R35, R37 mapeados.
      *Depende de:* B8

- [x] **B10 — Server Actions.** `lib/actions/notificaciones.ts`: las 4 del design §3.2–§3.5 +
      `notificarCargaMasivaTerminada` (§3.6), con `resolveActorFromSession` +
      `withErrorHandler` + `toActionError` y `deps` inyectables.
      *Hecho:* firmas idénticas a las del design; ninguna ruta API nueva (R38).
      *Depende de:* B8

- [x] **B11 — Tests de integración de las acciones (R34, R36, R38, R39).**
      `tests/integration/actions/notificaciones-action.test.ts` con actor y service falsos: sin
      sesión → `unauthenticated` sin tocar el service (R34); id/contadores inválidos →
      `validation_error` (R36); las acciones son Server Actions, no rutas (R38);
      `notificarCargaMasivaTerminada` **siempre** usa `actor.usuarioId` como destinatario y una
      segunda invocación con el mismo `loteId` no crea otra notificación (R39).
      *Hecho:* R34, R36, R38, R39 mapeados.
      *Depende de:* B10

- [x] **B12 — Emisor central + dedupe.** `lib/notificaciones/emitir.ts`: una función por evento
      (`emitirOrdenRechazada`, `emitirCargaMasivaTerminada`, `emitirPostulacionPendiente`,
      `emitirCierreDiaPorAprobar`), tipo `NotificacionEmisor`, textos de §4.6 y guardia de
      dedupe (§1.4) con captura de la violación de unicidad como no-op.
      *Hecho:* ninguna cadena de descripción aparece fuera de este archivo; test de dedupe que
      cubre R27 (segunda emisión con una no leída ⇒ no crea fila).
      *Depende de:* B6

- [x] **B13 — Productor: orden rechazada (R18–R21).** *(CRECIÓ: 4 filas con alcance)*
      Enganchar en `appendCambioEstado` como **quinto parámetro inyectable con default real**,
      filtrando `destino === "rechazada" && origenTipo === "gestion"`; emisión **transaccional**
      (F1.4-3). Emite 4 filas: `maestro`, `admin`, `adminTienda` con `tienda_id =
      orden.tienda_id`, `adminSatelite` con `zona_id` = zona de la orden (si no se resuelve la
      zona, se omite esa fila y se emiten las otras tres).
      *Hecho:* la firma sigue compatible con los ~18 call-sites (ninguno se edita); tests en
      `tests/unit/repositories/` para: emisión con `gestion` y las 4 filas con su alcance
      (R18), **no** emisión con `escalado_devuelta_sla` (R19), rollback ⇒ sin notificación
      (R20), fallo de emisión ⇒ sin cambio de estado (R21).
      *Depende de:* B12

- [x] **B14 — Productor: postulación pendiente (R23, R25).** `[P]` con B13/B15/B16
      `PostulacionMensajeroService.postular`, rama de éxito, best-effort. Dos filas
      (`maestro`, `admin`) sin alcance.
      *Hecho:* test que verifica las dos filas y que un emisor que lanza **no** cambia el
      resultado `{ status: "ok" }` de la postulación (R25).
      *Depende de:* B12

- [x] **B15 — Productor: cierre de día por aprobar (R24, R25).** `[P]` con B13/B14/B16
      Los **tres** caminos de éxito de `CierreDiaService.solicitarCierre`, best-effort. Tres
      filas: `maestro`, `admin` y `adminSatelite` con `zona_id` = zona destino del cierre.
      *Hecho:* test de los tres caminos (`crearCierre`, `vencido→solicitado`,
      `rechazado→solicitado`), del alcance por zona, del emisor que lanza, y de la dedupe en la
      re-solicitud (R27).
      *Depende de:* B12

- [x] **B16 — Productor: carga masiva terminada (R22, R25).** `[P]` con B13/B14/B15
      `BulkOrdenService.cargarViaApi`: emisión server-side al final, best-effort, destinatario
      = usuario ejecutor. (La vía UI ya está cubierta por la acción de B10/B11.)
      *Hecho:* test de la vía API y del emisor que lanza.
      *Depende de:* B12, B10

- [x] **B17 — Guardia de alcance (R26).** Test que verifica que la feature no introduce cron:
      `vercel.json` sin entradas nuevas, `JobTipo` sin valores nuevos, sin route handler nuevo
      bajo `app/api/`.
      *Hecho:* R26 mapeado a un test explícito (D2).
      *Depende de:* B16 · `[P]` con B11

---

## Bloque C — Frontend (zona `frontend_dev`)

Arranca en cuanto A1 y B10 están mergeados (contrato congelado). No toca `db/`, `lib/services/`
ni `lib/repositories/`.

- [x] **C1 — Hook `hooks/useNotificaciones.ts`.** SWR sobre `listarNotificaciones` con
      `refreshInterval` de `notificacionesConfig`, `revalidateOnFocus`, `keepPreviousData` y
      `mutate` expuesto.
      *Hecho:* el fetcher lanza si `status !== "ok"` (patrón feature 22).
      *Depende de:* A1, A2, B10

- [x] **C2 — `NotificationsBell` conectada (R40–R50).** Eliminar `EXAMPLE_NOTIFICATIONS` y el
      estado local de datos; consumir `useNotificaciones`; `onOpenChange` → `mutate()` (R47);
      "marcar todas" y "X" invocan las acciones con actualización optimista; `notifications?`
      pasa a `fallbackData`; **conservar `NotificationItem` como alias público de
      `NotificacionDTO`** (R50). **Sin cambios en el JSX de la lista.**
      *Hecho:* `grep EXAMPLE_NOTIFICATIONS` vacío; `PageHeader.tsx` **no se modifica**;
      `NotificationItem` sigue exportado.
      *Depende de:* C1

- [x] **C3 — Tests de componente (R40–R50).** `tests/components/NotificationsBell.test.tsx`:
      sin datos quemados, badge con el conteo, `+99` sobre 99, sin badge con 0, estado vacío,
      "marcar todas" deshabilitado sin no leídas y su invocación, descartar retira el elemento,
      revalidación al abrir, degradación limpia ante error/`unauthenticated`, icono por tipo,
      y un test de tipos/compilación que fija `NotificationItem` como alias.
      *Hecho:* R40–R50 mapeados uno a uno.
      *Depende de:* C2

- [x] **C4 — Cierre de la carga masiva de UI (R39).** `[P]` con C3
      En `OrdenesCargaMasivaButton.tsx` (único punto con `dryRun:false`; `OrdenesCargaUpload.tsx`
      sólo hace dry-run): generar un `loteId` (uuid) al iniciar la carga y, al
      terminar `procesarEnChunks` (no en `dryRun`), invocar `notificarCargaMasivaTerminada`
      **una sola vez** con `{ creadas, total, loteId }`; ignorar el fallo (no bloquea el
      resumen).
      *Hecho:* test de componente: una única invocación al final, ninguna en `dryRun`, y el
      mismo `loteId` en un reintento.
      *Depende de:* B10, C1

---

## Bloque D — Cierre

- [ ] **D1 — Mapa de trazabilidad.** `progress/impl_146.md` con la tabla `R1..R50 → test`.
      *Hecho:* los 50 requisitos tienen al menos un test nombrado; ninguno sin cubrir
      (`docs/specs.md` §Trazabilidad).
      *Depende de:* B17, C4

- [ ] **D2 — Verificación ejecutable.** `./init.sh` en verde + suite completa + `pnpm typecheck`
      + `pnpm lint`, con delta 0 respecto al baseline **medido en el momento** (no el citado en
      `progress/current.md`).
      *Hecho:* salida pegada en `progress/impl_146.md`.
      *Depende de:* D1

- [ ] **D3 — Commits.** Un commit por task lógica (`feat(146): ...`, `test(146): ...`), no un
      mega-commit final (`docs/conventions.md`).
      *Hecho:* el historial de la rama refleja el desglose de este archivo.
      *Depende de:* D2
</content>
</invoke>
