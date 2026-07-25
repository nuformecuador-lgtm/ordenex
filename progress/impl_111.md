# impl_111 — Cierre `vencido`: bloqueo total + resolución (BACKEND)

> Bitácora del backend_dev. Feature 111. Tasks `[B]` de `specs/111-cierre-vencido-modelo/tasks.md`.
> Sin migración (R19): el enum `vencido`, el índice `(mensajero_id, estado)` y `resuelto_por/at`
> ya existen (migración de la 41). `git status` de `db/migrations/` sin cambios.

## Estado: código aplicado; tests + verificación en curso

## Archivos tocados (código)

- `lib/interfaces/repositories/ICierreDiaRepository.ts` — + `existeCierreVencido`,
  `transicionarVencidoASolicitado` (A1/A2).
- `lib/repositories/CierreDiaRepository.ts` — impl de ambos + `ESTADO_VENCIDO`. `transicionar…`
  es `updateMany` guardado por estado (`WHERE mensajero_id=X AND estado='vencido'`), SOLO cambia
  `estado`; `count===1` (A1/A2, R6/R7/R8/R21).
- `lib/interfaces/services/ICierreDiaService.ts` — `SolicitarCierreServiceResult.ok` + `via`
  (`creado`/`vencido_solicitado`) y campos de creación opcionales; `ListarCierreDiaServiceResult.ok`
  + `tieneVencido?` (B1/B2).
- `lib/services/CierreDiaService.ts` — (B1) rama `vencido→solicitado` en `solicitarCierre` (antes
  del flujo de creación, EXENTA de la precondición de pendientes, R6/R9/R10/R11; `via:"creado"` en
  la creación); (B2) `tieneVencido` derivado de `cierresPasados`; (B5) guarda de bloqueo EXPLÍCITA
  en `deshacerGestion` con `findMensajerosBloqueados` (Pick ampliado); `MSG_BLOQUEADO` sin PII.
- `lib/services/MisAsignacionesService.ts` — (B3/B4) `ordenRepo` Pick + `findMensajerosBloqueados`;
  helper `estaBloqueado`; guarda al inicio de `gestionar` (antes de cargar/subir → R3 sin efectos
  parciales), `recogerAsignaciones` y `escogerParaGestion`; `MSG_BLOQUEADO` sin PII.
- `lib/actions/cierre-dia.ts` / `lib/actions/mis-asignaciones.ts` — `buildService()` ya inyecta
  `new OrdenRepository(prisma)` (implementa `findMensajerosBloqueados`): sin cambio de cableado.
- `lib/repositories/CierresAdminRepository.ts` — (B6) `ESTADOS_RESOLUBLES = ["solicitado"]` (saca
  `vencido`, R15); (A3) `forzarSolicitudVencido(cierreId, alcance)` `updateMany WHERE id=X AND
  estado='vencido' AND <alcance>` SET estado='solicitado', money-safe, `count===0`→conflict/
  fuera_de_alcance.
- `lib/interfaces/repositories/ICierresAdminRepository.ts` — + `forzarSolicitudVencido`.
- `lib/interfaces/services/ICierresAdminService.ts` — + `ForzarSolicitudVencidoServiceResult` + método.
- `lib/services/CierresAdminService.ts` — (B7) `forzarSolicitudVencido(cierreId, actor)`
  (resolveAlcance + repo + map; forbidden/no_encontrada/conflict/ok).
- `lib/types/cierres-admin.ts` — `forzarSolicitudVencidoSchema` + `ForzarSolicitudVencidoResult`.
- `lib/actions/cierres-admin.ts` — Server Action `forzarSolicitudVencido` (`'use server'`).

## Archivos de test tocados/nuevos

- `tests/unit/repositories/cierre-dia-repository.test.ts` — + `existeCierreVencido`,
  `transicionarVencidoASolicitado` (R6/R7/R8/R21); `buildPrisma.cierreDia` + `updateMany`.
- `tests/unit/services/cierre-dia-service.test.ts` — `fakeRepo` + 2 métodos; `newService.ordenRepo`
  + `findMensajerosBloqueados` (opción `bloqueados`); + bloques rama vencido (R6/R7/R9/R10/R11),
  `tieneVencido` (R13-datos), deshacer bloqueado (R5/R20).
- `tests/unit/services/mis-asignaciones-service.test.ts` — `fakeOrdenRepo(bloqueados)` +
  `findMensajerosBloqueados`; 3 ordenRepos inline; + bloque bloqueo total (R1/R2/R3/R4/R20).
- `tests/unit/services/mis-asignaciones-causa-devolucion.test.ts` — ordenRepo Pick ampliado.
- `tests/unit/repositories/cierres-admin-repository.test.ts` — asserts `estado:{in:["solicitado"]}`
  (R15); test 41/R19 reescrito a 111/R15; + `forzarSolicitudVencido` (R16/R17/R21).
- `tests/unit/services/cierres-admin-service.test.ts` — `fakeRepo` + `forzarSolicitudVencido`;
  + bloque válvula (R16/R17/R18).
- `tests/integration/actions/cierre-dia-action.test.ts` — `inMemoryRepo` + 2 métodos; `realService`
  ordenRepo + `findMensajerosBloqueados`.
- `tests/integration/actions/cierres-admin-action.test.ts` — `fakeService` + método; + action tests
  válvula (R16).

## Mapa R → test (backend)

| R | Test |
| --- | --- |
| R1 | cierre-dia-service `Feature 111 · bloqueo total`… no aplica; **mis-asignaciones-service** "R1/R3: gestionar bloqueado -> conflict…" |
| R2 | mis-asignaciones-service "R2: rechazado/aprobado NO bloquean…" + espía `findMensajerosBloqueados`; orden-repository.bloqueo "R12/R16: estado IN (solicitado, vencido)…" |
| R3 | mis-asignaciones-service "R1/R3: … NO sube evidencia, NO transiciona, NO crea gestion_orden" |
| R4 | mis-asignaciones-service "R4: recoger bloqueado…" / "R4: escoger bloqueado…" |
| R5 | cierre-dia-service "R5: mensajero BLOQUEADO … sin leer ni anular"; "R5: NO bloqueado -> procede" |
| R6 | cierre-dia-repository "R6: existeCierreVencido…"; cierre-dia-service "R6: con un vencido -> transiciona… NO crea" |
| R7 | cierre-dia-repository "R7: … count=1 -> true" / "R7: count=0 … -> false"; cierre-dia-service "R7: … 0 filas -> conflict" |
| R8 | cierre-dia-repository "R8/R21: … NO toca snapshot ni resuelto_por/at ni solicitado_at" |
| R9 | cierre-dia-service "R9 (anti-deadlock): vencido + órdenes pendientes -> transiciona igual" |
| R10 | cierre-dia-service "R6: … NO crea un cierre nuevo" (crearCierre not called) |
| R11 | cierre-dia-service "R11: SIN vencido -> flujo de creación de la 37 SIN cambios" |
| R13 (datos) | cierre-dia-service "R13: tieneVencido=true/false…" |
| R15 | cierres-admin-repository "feature 111/R15 (Q1-B): resolución NORMAL guarda SOLO `solicitado`" |
| R16 | cierres-admin-repository "R16: … WHERE guarda estado='vencido'+alcance…" (+conflict/fuera_de_alcance); cierres-admin-service "R16: maestro destraba…" / "R16: adminSatelite acotado…"; cierres-admin-action "R16: delega…" |
| R17 | cierres-admin-repository "R16/R21/R17: la válvula NO … registra auditoría (resuelto_por/at)"; cierres-admin-repository R14 (resolverCierre setea resueltoPor/at) |
| R18 | cierres-admin-service "R18: la válvula deja el cierre en `solicitado` (sigue bloqueante)…"; orden-repository.bloqueo (solicitado bloquea, aprobado no) |
| R19 | `prisma validate` OK + `git status db/migrations/` sin cambios |
| R20 | cierre-dia-service "R20: motivo … SIN PII"; mis-asignaciones-service "R20: … sin ids del actor/orden/cierre" |
| R21 | cierre-dia-repository "R8/R21…"; cierres-admin-repository "R16/R21/R17…"; forzar "NO alimenta wallets ni $transaction" |

## Verificación

- **typecheck:** VERDE en todos los archivos de la feature 111 (`grep` de mis archivos = 0
  errores). Los 43 errores restantes son de `plantillas/webhooks/jobs` (PlantillaEstado,
  webhookSuscripcion, JobTipo `webhook_estado`) por **cliente Prisma stale** local (nota de
  memoria "CI = solo build Vercel"): esos modelos SÍ están en `db/schema.prisma` pero no en el
  cliente generado. No toqué ninguno de esos archivos.
- **lint:** 0 errores, 144 warnings (baseline del repo; ninguno nuevo mío).
- **tests:** mis 9 archivos → 311/311 verdes (aislado). Suite completa: 4342 passed, 1 failed =
  `tests/integration/db/zonas-migration.test.ts` (su allow-list no incluye la migración nueva
  `20260722130000_plantilla_mensaje` de la feature 107). PREEXISTENTE y ajeno: la feature 111 NO
  agrega migración (R19). Los flakies conocidos (HomePage/HomePageRol/OrdenesModuleReuse/
  CierreDiaPage) no aparecieron en esta corrida.

## Veredicto

Backend de la feature 111 (bloqueo total + `vencido→solicitado` + válvula de escape) implementado
y probado; typecheck/lint verdes en el alcance de la feature; único fallo de suite es preexistente
y ajeno (migración de la 107). Listo para frontend_dev (C/D) y reviewer.

---

## Frontend (frontend_dev; cerrado y verificado por el leader tras 3 cortes de API)

**Archivos tocados:**
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` + `page.tsx` — aviso de BLOQUEO TOTAL con `bloqueado` (R12) + CTA "Solicitar aprobación del cierre vencido" independiente de `puedesSolicitar` (R13).
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` + `page.tsx` — aviso de bloqueo total (R12) + controles de gestionar/recoger/escoger deshabilitados/guardados con `bloqueado` (R14).
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` — acción DIFERENCIADA "destrabar / forzar solicitud del cierre vencido" (con confirmación) sobre los `vencido` del alcance, que llama a `forzarSolicitudVencido` (R16, UI).

**Tests de componente:** `CierreDiaModule.test.tsx`, `MisAsignacionesModule.test.tsx`, `MisAsignacionesPage.test.tsx`, `CierresAdminModule.test.tsx`, `CierresAdminPage.test.tsx`.

| R | Test |
| --- | --- |
| R12 | CierreDiaModule / MisAsignacionesModule — aviso de bloqueo total con `bloqueado` |
| R13 | CierreDiaModule — CTA solicitar vencido con `tieneVencido`, indep. de `puedesSolicitar` |
| R14 | MisAsignacionesModule — controles deshabilitados/guardados con `bloqueado` |
| R16 (UI) | CierresAdminModule / CierresAdminPage — acción "destrabar" llama `forzarSolicitudVencido` |

**Verificación (leader):** typecheck 0 errores (tras `prisma generate`); lint 0 errores (144 warnings baseline, ninguno nuevo); tests de componente 5 archivos / **119 verdes**.
