# Feature 37 — Mensajero: "Cierre del día" · tasks.md

Orden: modelo/migración → tipos/interfaces → repository → service → actions → UI → E2E.
`[P]` = paralelizable con otras `[P]` del mismo bloque. Cada task cita los `R<n>` y su
criterio de "hecho". **No empezar hasta cerrar la puerta F1.4** (ver `requirements.md`).

## Bloque 0 — Preparación
- [x] **T0** Confirmar decisiones F1.4 (a–i) con el humano; anotar los valores elegidos.
  *Hecho:* `progress/current.md` registra las decisiones; si difieren del recomendado, marcar
  los `prov. F1.4-x` afectados en design/requirements.

## Bloque 1 — Modelo de datos y migración (R13–R16, R19, R20)
- [x] **T1** Añadir a `db/schema.prisma`: enums `CierreEstado` y `CierreDestinoTipo`, modelo
  `CierreDia`, FK `cierreId` en `GestionOrden`, y lados inversos en `Usuario`/`Zona`.
  *Hecho:* `prisma validate`/`generate` pasan; tipos disponibles. (dep: T0)
- [x] **T2** `lib/types/cierre.ts`: `CIERRE_ESTADO_SEED` + tipos `CierreEstado`,
  `CierreDestinoTipo` (fuente única de verdad). *Hecho:* import tipa el enum. `[P]` con T1.
- [x] **T3** Crear migración `db/migrations/<ts>_cierre_dia/` con `migration.sql` (UP) y
  `down.sql` (DOWN) según design §1.5 (enums + tabla + RLS + FK `cierre_id`). *Hecho:*
  `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte limpio (R20). (dep: T1)
- [x] **T4** Test de integración de migración (patrón `zonas-migration.test.ts`): RLS
  habilitada en `cierre_dia` (R19) y round-trip up→down→up (R20). *Hecho:* test verde. (dep: T3)

## Bloque 2 — Interfaces y contratos (R2–R9)
- [x] **T5** `lib/interfaces/services/ICierreDiaService.ts` con `listarCierreDia` y
  `solicitarCierre` + DTOs (`CierreDetalleGestion`, `CierreTotales`, resultados discriminados,
  Decimal como string). *Hecho:* compila; DTOs money-safe. (dep: T2) `[P]`
- [x] **T6** `lib/interfaces/repositories/ICierreDiaRepository.ts` (`findGestionesPendientes`,
  `contarOrdenesPendientesGestion`, `existeCierreSolicitado`, `crearCierre`,
  `findCierresByMensajero`). *Hecho:* compila. (dep: T2) `[P]`

## Bloque 3 — Repository (R2, R3, R10, R11, R13, R18)
- [x] **T7** `lib/repositories/CierreDiaRepository.ts` implementa `ICierreDiaRepository`; solo
  Prisma queries; `crearCierre` en `$transaction` con `UPDATE ... WHERE cierre_id IS NULL AND
  mensajero_id = actor`. *Hecho:* sin lógica de negocio; queries filtran por mensajero. (dep: T6, T3)
- [x] **T8** Tests unit del repo con DB de test: `findGestionesPendientes` solo trae
  `cierre_id IS NULL` (R3); `contarOrdenesPendientesGestion` cuenta `en_espera_aceptacion`/
  `en_reparto` (R10); `crearCierre` vincula gestiones + snapshot (R13/R14). *Hecho:* verdes. (dep: T7)

## Bloque 4 — Service (R1–R18)
- [x] **T9** `lib/services/CierreDiaService.ts` implementa `ICierreDiaService`; DI de
  `ICierreDiaRepository`, `IZonaRepository`, `IOrdenRepository`, `ISignedUrlProvider`.
  `listarCierreDia` (agrupar, totales con `Prisma.Decimal`, firmar evidencias, `puedesSolicitar`).
  *Hecho:* pasa unit tests del listado. (dep: T5, T7)
- [x] **T10** `solicitarCierre`: autorización, precondición R10, duplicado R12, vacío R11, ruteo
  por zona R15/R16, snapshot totales R14, transacción R13. *Hecho:* pasa unit tests. (dep: T9)
- [x] **T11** Tests unit del service (mocks de repos + doble `ISignedUrlProvider`/`findCentralZonaId`):
  R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R15, R16, R17. *Hecho:* cada R con su test;
  totales cuadran al centavo (R9). (dep: T10)

## Bloque 5 — Actions (R1, R2, R10–R16)
- [x] **T12** `lib/actions/cierre-dia.ts` (`'use server'`): `listarCierreDia` y
  `solicitarCierre`; resuelve actor, `withErrorHandler`, `UnauthenticatedError` en el borde,
  deps inyectables (patrón `recepcion-satelite.ts`). *Hecho:* devuelven resultados de dominio;
  no fetch a rutas internas. (dep: T10)
- [x] **T13** Tests de integración de actions: `unauthenticated` sin sesión; `forbidden` con rol
  ≠ mensajero (R1); flujo `solicitarCierre` ok crea `solicitado` y vincula (R13/R18). *Hecho:* verdes. (dep: T12)

## Bloque 6 — UI (R1, R3–R7, R10, R11, R18)
- [x] **T14** `app/(app)/cierre-dia/page.tsx` (Server Component): valida rol server-side →
  `notFound()` si no es mensajero (R1); pre-fetch y pasa datos por props. *Hecho:* rol ≠ mensajero
  no ve el módulo. (dep: T12)
- [x] **T15** `app/(app)/cierre-dia/_components/CierreDiaModule.tsx`: secciones por resultado con
  detalle por orden (R4) + evidencia firmada (R5); panel de totales (R7); botón "Solicitar
  cierre" con `puedesSolicitar`/`motivoBloqueo` (R10/R11); Modal async (feature 13) + Toast
  (feature 11); sección cierres pasados (R18). *Hecho:* botón deshabilitado con pendientes;
  solicitar refresca. (dep: T14)
- [x] **T16** `lib/config/cierre.ts` (TTL URL firmada, sin hardcode) + item de sidebar para
  `mensajero`. *Hecho:* config por env; sidebar muestra "Cierre del día". `[P]` con T15.

## Bloque 7 — Flujo crítico y cierre (R7, R13–R15) `prov. F1.4-g`
- [x] **T17** E2E Playwright `e2e/cierre-dia.spec.ts` (si F1.4-g = sí): mensajero gestiona todas →
  ve totales por método → "Solicitar cierre" → aparece `solicitado` con destino correcto.
  *Hecho:* spec escrito (ejecución diferida, patrón `asignacion-satelite.spec.ts`). (dep: T15)
- [x] **T18** Actualizar `progress/impl_37-cierre-dia-mensajero.md` con el mapa `R<n> → test`
  (todos los R cubiertos). *Hecho:* CHECKPOINTS trazabilidad completa. (dep: T11, T13, T17)
- [x] **T19** Verificación final: `./init.sh` verde, `pnpm typecheck`/`lint`/`test` en verde,
  `pnpm run db:rollback` round-trip ok. *Hecho:* todo verde; feature lista para review. (dep: T18)
