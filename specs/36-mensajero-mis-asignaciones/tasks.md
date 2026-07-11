# Feature 36 — Mensajero: "Mis asignaciones" y gestión de órdenes · tasks.md

Zone: `fullstack` · complexity: `high` · depends_on: 17 (`done`), 34 (`pending`) · branch: `feature/36-mensajero-mis-asignaciones`

> **No arrancar hasta cerrar F1.4** (7 decisiones en `requirements.md > Preguntas abiertas`).
> Orden general: backend (modelo → migración → tipos → repo → service → action) → storage →
> frontend → verificación. `[P]` = paralelizable (sin dependencia de archivos con las tareas
> previas no marcadas). Cada task lleva su criterio de "hecho".

## Bloque A — Modelo de datos y migración (backend)

- [ ] **T1** — Añadir a `ORDER_STATUS_SEED` (`lib/types/order-status.ts`) los valores
  `aceptada` y `rechazada` `(prov. F1.4-a,b)`. **Hecho:** el tipo `OrderStatusValue` los incluye;
  `seedOrderStatus` los siembra por upsert. → R1, R3.
- [ ] **T2** — Crear `lib/types/metodo-pago.ts` con `METODO_PAGO_SEED` (`efectivo`, `simpe`,
  `transferencia`) y `MetodoPagoValue` `(prov. F1.4-c)`. **Hecho:** tipo exhaustivo, build rompe
  si se altera. → R5.
- [ ] **T3** — Actualizar `db/schema.prisma`: enum `MetodoPagoValue`, enum `GestionResultado`,
  modelo `GestionOrden` (con FKs, índices, `@@map`), columna `Usuario.ordenEnGestionId` (FK →
  orden, `ON DELETE SET NULL`) y lados inversos en `Orden`/`Usuario`. **Hecho:** `prisma validate`
  pasa. → R6, R19-R21 `(prov. F1.4-d,e)`.
- [ ] **T4** — Crear migración `db/migrations/<ts>_gestion_orden_estados_metodo_pago/migration.sql`
  (UP) y `down.sql` (DOWN) según design §1.5: estados de catálogo (`ALTER TYPE ADD VALUE` +
  `INSERT ON CONFLICT`), enums, tabla `gestion_orden` con **RLS habilitada** + índices + FKs,
  columna puntero. **Hecho:** `db:migrate` aplica y `db:rollback` (down) revierte; down borra
  filas de catálogo solo si no referenciadas. → R2, R3, R7.
- [ ] **T5 [P]** — Añadir labels de `aceptada`/`rechazada` en
  `app/(app)/ordenes/_components/estatus-label.ts` (Record exhaustivo). **Hecho:**
  `estatusLabel('aceptada')` y `('rechazada')` devuelven texto legible; build no rompe. → R4, R33.

## Bloque B — Config y storage de evidencias (backend)

- [ ] **T6 [P]** — Crear `lib/config/gestion.ts` (patrón `postulacion.ts`): `EVIDENCIA_BUCKET`
  (default `gestion-evidencias`, `prov. F1.4-f`), `MAX_FILE_BYTES`, MIME permitidos, TTL de URL
  firmada — todo por env. **Hecho:** valores por defecto y overridable por env; sin hardcode. → R8, R24.
- [ ] **T7 [P]** — Verificar reuso de `IFileStorage`/`SupabaseFileStorage` e
  `ISignedUrlProvider`/`SupabaseSignedUrlProvider` con el bucket de evidencias (constructor acepta
  `bucket`). Script/seed que cree el bucket privado `gestion-evidencias`. **Hecho:** storage
  apunta al bucket nuevo sin duplicar implementación. → R8.

## Bloque C — Repositorio (backend)

- [ ] **T8** — Definir `lib/interfaces/repositories/IGestionOrdenRepository.ts`:
  `findMisAsignaciones`, `getOrdenEnGestion`, `setOrdenEnGestion`, `aceptarLote`,
  `crearGestionYTransicionar`. Extender `IOrdenRepository` si hace falta un proyector de detalle.
  **Hecho:** interfaz compila; métodos documentados (transaccional donde aplica). → R9, R13, R15,
  R19-R21, R23, R26, R28, R30. (dep: T3)
- [ ] **T9** — Implementar `lib/repositories/GestionOrdenRepository.ts` (Prisma): queries filtradas
  por mensajero (R13), `aceptarLote` con guardia origen+propiedad en el WHERE, y
  `crearGestionYTransicionar` bajo `prisma.$transaction` (INSERT gestión + UPDATE estatus + limpiar
  puntero). Sin lógica de negocio. **Hecho:** unit tests de repo verdes (mock Prisma). → R9, R13,
  R15, R23, R26, R28, R30. (dep: T8)

## Bloque D — Servicio (backend)

- [ ] **T10** — Definir `lib/interfaces/services/IMisAsignacionesService.ts` con
  `listarMisAsignaciones`, `aceptarAsignaciones`, `escogerParaGestion`, `gestionar` y sus tipos de
  resultado discriminados (design §3). **Hecho:** interfaz compila. (dep: T8)
- [ ] **T11** — Implementar `lib/services/MisAsignacionesService.ts` (DI:
  `IGestionOrdenRepository`, `IOrdenRepository`, `IFileStorage`, `ISignedUrlProvider`): autz de rol
  (R12), guardias propiedad/origen (R17/R18/R31), aceptar lote (R15/R16), bloqueo 1-a-1 con puntero
  (R19-R21), y `gestionar` con las 4 ramas + atomicidad storage↔DB + limpieza best-effort (R23/R30).
  **Hecho:** unit tests con dobles verdes (sin red/DB). → R12, R15-R32. (dep: T9, T10)
- [ ] **T12** — Validación zod en `lib/types/`: `aceptarSchema` (`{ ordenIds }`),
  `gestionarSchema` **discriminado por `resultado`** con obligatoriedades por rama (entrega:
  monto>0 + método enum + foto; reprogramar: fecha futura + motivo; devolución: motivo; rechazo:
  foto + motivo) y validación MIME/tamaño de foto reusable cliente/servidor. **Hecho:** unit tests
  de schema cubren cada rama válida/ inválida. → R22, R24, R25, R27, R29.

## Bloque E — Server Actions (backend/borde)

- [ ] **T13** — Crear `lib/actions/mis-asignaciones.ts` (`'use server'`): `listarMisAsignaciones`,
  `aceptarAsignaciones`, `escogerParaGestion`, `gestionar` (recibe `FormData`), patrón
  `ordenes-guia.ts` (`resolveActorFromSession`, `withErrorHandler`, traducción de `AppErrorShape`,
  `unauthenticated` en el borde). **Hecho:** unit tests de action (actor ausente →
  `unauthenticated`; rol ≠ mensajero → `forbidden`; zod inválido → `validation_error`). → R12, R22,
  R24, R25, R27, R29. (dep: T11, T12)

## Bloque F — Frontend (mensajero)

- [ ] **T14** — Página `app/(app)/mis-asignaciones/page.tsx` (Server Component): valida rol
  `mensajero` server-side, pre-fetch de asignaciones, pasa datos a `private/` por props. **Hecho:**
  rol ≠ mensajero no ve el módulo; integración GET responde según rol. → R9, R12. (dep: T13)
- [ ] **T15** — `_components/MisAsignacionesModule.tsx` (cliente): dos apartados separados
  "Por aceptar" / "Por gestionar" (DataTable + Paginación) con detalle completo por orden. **Hecho:**
  component test muestra ambos apartados y el detalle. → R10, R11. (dep: T14)
- [ ] **T16** — Apartado "Por aceptar": botón "Aceptar" (lote) como ÚNICA acción (sin "rechazar"),
  Modal async de confirmación → `aceptarAsignaciones`. **Hecho:** component test verifica que solo
  existe "Aceptar" y que dispara la acción. → R14, R16. (dep: T15)
- [ ] **T17** — Apartado "Por gestionar": bloqueo 1-a-1 alimentado por `ordenEnGestionId` del
  backend (las demás deshabilitadas; robusto a recarga), Modal de gestión con 4 resultados y
  campos condicionales (foto/monto/método, fecha/motivo, motivo, foto/motivo), envío `FormData` →
  `gestionar`, Toast de resultado. **Hecho:** component tests: con una activa las demás bloqueadas;
  cada resultado envía los campos correctos; error de dominio se muestra. → R11, R17-R30. (dep: T15)
- [ ] **T18 [P]** — Añadir item "Mis asignaciones" al sidebar
  (`app/(app)/_components/Sidebar.tsx`) visible para `mensajero` (coordinar visibilidad por rol;
  ver Nota de riesgo design §6). **Hecho:** el mensajero ve la entrada; la página igual valida rol.
  → R9.

## Bloque G — Verificación y trazabilidad

- [ ] **T19** — Completar el mapa `R<n> → test` en
  `progress/impl_36-mensajero-mis-asignaciones.md` (todos los R1–R33; storage mockeado). **Hecho:**
  cada requisito con al menos un test citado. → R34.
- [ ] **T20** — `./init.sh` verde + `pnpm typecheck` + `pnpm lint` + `pnpm test` en verde; probar
  `db:migrate` up y `db:rollback` down de T4. **Hecho:** todo verde; migración reversible. →
  CHECKPOINTS.
- [ ] **T21 [P]** — (Flujo crítico: recaudo de dinero) al menos un **E2E** (Playwright) del camino
  feliz mensajero: aceptar → escoger → ENTREGAR con foto+monto+método → orden queda `entregada`.
  **Hecho:** E2E pasa. → CHECKPOINTS (flujos críticos).

## Notas de dependencias

- T1–T7 pueden empezar en paralelo entre bloques A/B; T3 antes de T4; T8 tras T3.
- Backend (A–E) completo antes del frontend (F). T18/T5/T6/T7/T21 marcados `[P]`.
- La feature 34 (`pending`) NO se implementa aquí; "Mis asignaciones" ya cubre satélite por diseño
  (filtra por `mensajero_asignado_id`). Confirmar F1.4-j.
