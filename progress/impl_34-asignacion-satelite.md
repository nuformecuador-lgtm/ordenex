# impl - Feature 34 - Bodega satelite: asignacion a mensajeros de su zona

> Fase 2 (tras F1.4 APROBADA 2026-07-11). Fullstack, un ciclo. Backend -> frontend.
> Servicio PARALELO (a), rename honesto (b), extension de recepcion-satelite (c),
> lote con UN mensajero (d), errores tipados (e), E2E escrito diferido (f).
> SIN estados nuevos, SIN migracion, SIN num_guia nuevo.

## Resultado de verificacion

`./init.sh` -> **VERDE** (`== init OK ==`).

- `pnpm run typecheck` -> **0 errores** (incluye `e2e/` - el E2E typecheckea).
- `pnpm run lint` -> **0 errores** (135 warnings pre-existentes, todos en `.claude/skills/impeccable/scripts/*.mjs`, ajenos a la feature).
- `pnpm test` -> **1519 tests / 178 archivos, todos verdes** (48.8s).
- Migraciones: `todas las migraciones tienen down.sql` (esta feature NO anade migracion - design 1).

```
 Test Files  178 passed (178)
      Tests  1519 passed (1519)
```

### No-regresion del maestro (critico tras el rename b)
Las suites de la 17/30 siguen **VERDES** tras renombrar `findMensajerosGam`->`findMensajerosByZona`
y `findMensajeroIdsValidosGam`->`findMensajeroIdsValidosByZona`:
`tests/unit/services/guia-asignacion-service.test.ts` (incluye `asignarDesdeBodega`),
`tests/integration/actions/ordenes-guia-action.test.ts`,
`tests/unit/repositories/orden-repository.guia.test.ts`.
`asignarDesdeBodega` conserva comportamiento identico (solo cambio el identificador del metodo de repo).

## Archivos creados

Backend:
- `lib/interfaces/services/IAsignacionSateliteService.ts` - contrato + `AsignarSateliteInput` / `AsignarSateliteServiceResult`.
- `lib/services/AsignacionSateliteService.ts` - service paralelo (7 guardias, design 2.2).
- `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts` - `asignarSateliteLote`.
- `tests/unit/services/asignacion-satelite-service.test.ts` - R3/R7/R8/R9/R10/R11/R12/R13/R14.
- `tests/integration/actions/asignacion-satelite-action.test.ts` - R1/R2/R5/R6/R15/R19.

Frontend + E2E:
- `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` - modal de lote con UN mensajero.
- `app/(app)/recepcion-satelite/_components/asignacion-satelite-error-messages.ts` - mensajes de motivos tipados.
- `tests/components/AsignarSateliteModal.test.tsx`.
- `e2e/asignacion-satelite.spec.ts` - E2E escrito, ejecucion diferida (EXECUTION NOTE), selectores reales, typecheckea.

## Archivos modificados

Backend:
- `lib/interfaces/repositories/IOrdenRepository.ts` - rename (b) + firma `asignarSateliteLote`.
- `lib/repositories/OrdenRepository.ts` - rename (b) + impl `asignarSateliteLote` (updateMany guardado por estatusId+zonaId+deletedAt null, no toca numGuia).
- `lib/services/GuiaAsignacionService.ts` - 2 llamadas al nombre nuevo (rename b).
- `lib/actions/ordenes-guia.ts` - buildOrdenRepo, ListarMensajerosDeps, loader al nombre nuevo (rename b).
- `lib/actions/recepcion-satelite.ts` - `asignarDesdeSatelite` (T5) + `listarMensajerosSatelite` (T6), con deps inyectables; reusa toRecepcionSateliteActionError.
- `lib/types/recepcion-satelite.ts` - `asignarSateliteSchema` (zod), AsignarSateliteResult, ListarMensajerosSateliteResult.
- Tests actualizados por el rename mecanico: tests/unit/services/{guia-asignacion-service,orden-service,bulk-orden-service,asignacion-mensajero-service,rol-admin-satelite-authz,etiqueta-guia-service}.test.ts, tests/unit/repositories/orden-repository.guia.test.ts, tests/integration/actions/ordenes-guia-action.test.ts.

Frontend:
- `app/(app)/recepcion-satelite/page.tsx` - pre-fetch `listarMensajerosSatelite()` + prop mensajeros (degradacion suave a []); mantiene notFound server-side.
- `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` - "Recibidas" seleccionable (checkbox por fila) + boton "Asignar" (deshabilitado sin seleccion); onSuccess limpia seleccion + router.refresh(); "Por recibir" intacta.
- `components/shared/Modal.tsx` - prop opcional aditiva confirmDisabled (default false) para R6.
- `tests/components/RecepcionSateliteModule.test.tsx`, `tests/components/RecepcionSatelitePage.test.tsx` - extendidos.

## Trazabilidad R1-R20 -> test

| Req | Cubierto | Test concreto |
| --- | --- | --- |
| R1  | si | asignacion-satelite-action.test.ts (sin sesion -> unauthenticated, asignar y listar); asignacion-satelite-service.test.ts (rol -> forbidden); page mantiene notFound (RecepcionSatelitePage.test.tsx) |
| R2  | si | asignacion-satelite-action.test.ts (zona server-side por usuarioId: findUsuarioZonaId + findMensajerosByZona) |
| R3  | si | asignacion-satelite-service.test.ts (sin zona -> sin_zona) |
| R4  | si | tests/components/RecepcionSateliteModule.test.tsx (Recibidas permite seleccionar y habilita Asignar) |
| R5  | si | asignacion-satelite-action.test.ts (R2/R5); orden-repository.asignacion-satelite.test.ts (filtro por zona) |
| R6  | si | tests/components/AsignarSateliteModal.test.tsx (zona sin mensajeros -> vacio accionable + Asignar deshabilitado); action loader sin zona -> [] |
| R7  | si | asignacion-satelite-service.test.ts (lote OK -> en_espera_aceptacion); AsignarSateliteModal.test.tsx (exito -> toast + onSuccess) |
| R8  | si | asignacion-satelite-service.test.ts (R7/R8); orden-repository.asignacion-satelite.test.ts (data NO contiene numGuia) |
| R9  | si | asignacion-satelite-service.test.ts (mensajero de otra zona/no-mensajero -> validation_error mensajero_invalido); AsignarSateliteModal.test.tsx (confirmar sin mensajero -> error) |
| R10 | si | asignacion-satelite-service.test.ts (R10/R11, R10/R12, inexistente/borrada -> no_encontrada; todo-o-nada, no escribe) |
| R11 | si | asignacion-satelite-service.test.ts (R10/R11: zona_ajena) |
| R12 | si | asignacion-satelite-service.test.ts (R10/R12: estado_invalido) |
| R13 | si | asignacion-satelite-service.test.ts (rol != adminSatelite -> forbidden antes de tocar datos) |
| R14 | si | orden-repository.asignacion-satelite.test.ts (WHERE guardado por estado+zona; count refleja transicionadas) + asignacion-satelite-service.test.ts (carrera write count incompleto -> conflict) |
| R15 | si | asignacion-satelite-action.test.ts (Server Action; zod valida ordenIds/mensajeroId; unauthenticated en el borde) |
| R16 | si | Suites 17/30 verdes tras el rename (guia-asignacion-service, ordenes-guia-action, orden-repository.guia); typecheck global verde |
| R17 | si | Type/no-regresion: en_espera_aceptacion (mismo destino del maestro) sin cambios; suites 36 intactas; typecheck verde. La 34 no toca la 36 |
| R18 | si | e2e/asignacion-satelite.spec.ts (recibida -> seleccionar -> asignar mensajero de la zona -> en_espera_aceptacion). Escrito, ejecucion diferida, typecheckea |
| R19 | si | asignacion-satelite-action.test.ts (entradas validadas con zod; resultados tipados; sin filtrar internals) |
| R20 | si | Esta tabla (revision del reviewer) |

## Verificacion manual declarada
- R18 (E2E): escrito y typecheckea, NO ejecutado bajo pnpm test. Ejecucion diferida hasta entorno con DB + seed (adminSatelite con zona + ordenes en_bodega_satelite de esa zona + mensajero de la zona), mismo patron que e2e/recepcion-satelite.spec.ts.
- Flujo fisico/hardware: no aplica a esta feature (no hay escaner en la asignacion).

## Deudas / hallazgos
- Se anadio prop aditiva confirmDisabled al Modal compartido (default false, sin regresion) para deshabilitar el confirmar desde el consumidor (R6). Cambio transversal menor.
- Motivo de carrera (R14): las ordenes que no transicionan por carrera reportan el literal "conflict" como motivo en el detalle; las guardias previas usan no_encontrada / zona_ajena / estado_invalido.
- Sin migracion ni down.sql (design 1): el reviewer NO debe exigirla para esta feature.
