# Feature 38 — Admin: "Cierres del día (aprobar/rechazar)" · tasks.md

Zone: `fullstack` · complexity: `high` · depends_on: 37 (`done`) · branch: `feature/38-cierres-admin`

> Plan T0..Tn ordenado. `[P]` = paralelizable con las tareas de su bloque. Cada task cita los
> `R` que cubre y su criterio de "hecho". **No se implementa hasta cerrar la puerta F1.4**
> (`requirements.md > Preguntas abiertas`). Si F1.4-e = "sin auditoría", se OMITEN T1/T2 y las
> columnas `resuelto_*`/`motivo_rechazo` de los contratos.

## T0 — Baseline verde
- **Hecho:** `./init.sh` en verde sobre `feature/38-cierres-admin` (creada desde `origin/dev`),
  `pnpm run typecheck` y suite de tests actual pasan antes de tocar nada.

## Bloque A — Modelo de datos (solo si F1.4-e = auditoría)

### T1 — Migración aditiva `cierre_dia` (audit + motivo) · R14, R17
- Añadir a `model CierreDia` (`db/schema.prisma`): `resueltoPor String? @map("resuelto_por")`,
  `resueltoAt DateTime? @map("resuelto_at")`, `motivoRechazo String? @map("motivo_rechazo")`,
  relación `resueltoPorUsuario Usuario? @relation("CierreResueltoPor", ...)`, lado opuesto en
  `Usuario` (`cierresResueltos`), `@@index([resueltoPor])`.
- Crear migración con `pnpm run db:migrate:create`; escribir `migration.sql` (UP) y `down.sql`
  (DOWN) manualmente según design §1.2 (FK `ON DELETE SET NULL`, sin tocar RLS).
- **Hecho:** `prisma validate` verde; `pnpm run db:migrate` aplica; `pnpm run db:rollback`
  revierte limpio (round-trip up→down→up); RLS de `cierre_dia` sigue habilitada.

### T2 — Test de migración (round-trip + RLS) · R17 · [P] tras T1
- **Hecho:** test de integración de migración verde (up/down y RLS habilitada en `cierre_dia`).

## Bloque B — Contratos e interfaces

### T3 — Tipos y contratos de la 38 · R2–R14 · [P]
- `lib/interfaces/services/ICierresAdminService.ts`: `CierreAdminResumen`,
  `ListarCierresAdminServiceResult`, `CierreDetalleAdminServiceResult`, `Aprobar/RechazarResult`,
  `ICierresAdminService`. **Reusar** `CierreDetalleGestion`/`CierreTotales`/`CierreResultado` de
  la 37 (no redefinir).
- `lib/interfaces/repositories/ICierresAdminRepository.ts`: `CierreAdminResumenRow`, `Alcance`,
  `findCierresByAlcance`, `findCierreByIdEnAlcance`, `resolverCierre`.
- `lib/types/cierres-admin.ts`: schemas zod del borde (`{ cierreId: uuid }`,
  `{ cierreId: uuid, motivo: string ≥ 1 }`) + `*Result` con `unauthenticated`.
- **Hecho:** `pnpm run typecheck` verde; los contratos compilan y reusan los DTO de la 37.

## Bloque C — Repositorio (Prisma)

### T4 — `CierresAdminRepository.findCierresByAlcance` · R2, R4, R5, R8, R9
- WHERE `destino_tipo` (+ `destino_zona_id` si adminSatelite), join `usuario`/`zona` para
  nombres, `orderBy solicitadoAt desc`, totales snapshot → string. Usa índice
  `[destinoTipo, destinoZonaId]`.
- **Hecho:** unit/integración: dado un set multi-zona/tipo, devuelve solo el alcance pedido con
  totales string.

### T5 — `findCierreByIdEnAlcance` (cierre + gestiones) · R6, R7, R9, R13 · [P] con T4
- Cierre SOLO si casa el alcance en el WHERE (guardia R13); gestiones con `WITH_DETALLE`
  (reuso 37) WHERE `cierre_id = X`. `montoRecibido`/totales como string.
- **Hecho:** integración: cierre en alcance → detalle con gestiones; cierre fuera de alcance → `null`.

### T6 — `resolverCierre` (transición guardada) · R10, R11, R12, R13, R14, R15
- `updateMany WHERE id = X AND estado = 'solicitado' AND <alcance>`, `data` = estado +
  `resueltoPor` + `resueltoAt` + `motivoRechazo`. `count===1`→`updated`; si 0, distinguir
  `conflict` (en alcance) de `fuera_de_alcance`. NO toca `gestion_orden` ni otras tablas (R15).
- **Hecho:** integración: aprobar/rechazar solicitado → `updated` + estado + audit; doble
  resolución → `conflict`; fuera de alcance → `fuera_de_alcance`; `gestion_orden.cierre_id` intacto.

## Bloque D — Servicio

### T7 — `CierresAdminService` + `resolveAlcance` · R1, R2, R3 (depende de T3)
- DI por constructor (`ICierresAdminRepository`, `IZonaRepository`, `IOrdenRepository`,
  `ISignedUrlProvider`). `resolveAlcance(actor)`: maestro→central; adminSatelite→satelite+zona
  (o `sinZona` si `findUsuarioZonaId` = null); otro rol → forbidden.
- **Hecho:** unit (dobles): cada rol resuelve su alcance; adminSatelite sin zona → `sinZona`;
  rol inválido → `forbidden`.

### T8 — `listarCierresAdmin` · R2, R3, R4, R5, R8, R9 (depende de T4, T7)
- Parte `pendientes` (solicitado) / `historico` (aprobado/rechazado); totales snapshot string.
- **Hecho:** unit: pendientes vs histórico correctos por alcance; sinZona → vacío.

### T9 — `verCierreDetalle` (con evidencias firmadas) · R6, R7, R9, R13, R16 (depende de T5, T7)
- Firma en lote `evidenciaStoragePath` (doble `ISignedUrlProvider`); agrupa por resultado
  (mapper reuso 37). Fuera de alcance → `no_encontrada`. Solo lectura (R16).
- **Hecho:** unit: detalle agrupado con URL firmada (no path); id ajeno → `no_encontrada`; no muta.

### T10 — `aprobarCierre` / `rechazarCierre` · R10, R11, R12, R13, R14, R15 (depende de T6, T7)
- Aprobar: transición → `ok`/`conflict`/`no_encontrada`/`forbidden`. Rechazar: exige `motivo`
  (→ `validation_error` si vacío), persiste `motivoRechazo`. Mapea el resultado del repo.
- **Hecho:** unit: aprobar solicitado → ok; rechazo sin motivo → validation_error; con motivo →
  ok+motivo; ya resuelto → conflict; fuera de alcance → no_encontrada.

## Bloque E — Acción (Server Actions)

### T11 — `lib/actions/cierres-admin.ts` · R1, R11, R13 (depende de T8–T10)
- `'use server'`; `listarCierresAdmin`/`verCierreDetalle`/`aprobarCierre`/`rechazarCierre` con
  `resolveActorFromSession` + `withErrorHandler` + zod (mutaciones) + deps inyectables; borde
  resuelve `unauthenticated`. Patrón `lib/actions/cierre-dia.ts`.
- **Hecho:** integración: sin sesión → `unauthenticated`; rol válido → delega en service;
  motivo inválido → `validation_error`.

## Bloque F — UI

### T12 — Página `app/(app)/cierres-admin/page.tsx` · R1, R3 (depende de T11)
- Server Component: `resolveActorFromSession`; `rol ∉ {maestro, adminSatelite}` → `notFound()`.
  Pre-fetch `listarCierresAdmin`; pasa datos por props; render vacío + aviso si `sinZona`.
- **Hecho:** integración: rol no admin → notFound; admin → módulo con datos; adminSatelite sin
  zona → estado vacío accionable.

### T13 — `_components/CierresAdminModule.tsx` + detalle · R4–R8, R10, R11 · [P] tras T12
- Secciones Pendientes/Histórico (DataTable), Modal/Sheet de detalle (reuso render 37), visor de
  evidencia firmada, panel de totales, botones Aprobar/Rechazar (Rechazar exige motivo). Montos
  string sin `parseFloat`. Toast + refresco; maneja conflict/no_encontrada/forbidden.
- **Hecho:** el módulo lista, abre detalle, aprueba y rechaza (con motivo) contra las actions.

### T14 — Sidebar item "Cierres del día" (maestro/adminSatelite) · R1 · [P] tras T12
- **Hecho:** el item aparece para ambos roles; la defensa real sigue siendo el `notFound` (T12).

## Bloque G — E2E y cierre (si F1.4-f = sí)

### T15 — E2E Playwright del flujo · trazabilidad E2E (depende de T13)
- admin ve cierre `solicitado` → abre detalle (totales+evidencia) → aprueba/rechaza → pasa a
  histórico. Escrito, ejecución diferida (patrón del repo, features 33/34/36/37).
- **Hecho:** spec E2E escrita y enlazada en `progress/impl_38-cierres-admin.md`.

### T16 — Trazabilidad + verificación final · todos los R
- Completar `progress/impl_38-cierres-admin.md` con el mapa `R1..R17` → test concreto (cada R al
  menos un test; storage mockeado).
- **Hecho:** `./init.sh` verde; `pnpm run typecheck`, `lint` y toda la suite de tests pasan;
  `prisma validate` verde; migración con `down.sql` reversible (si T1). Sin `R` sin test.
