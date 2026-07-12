# Review — Feature 34: bodega satélite, asignación a mensajeros de su zona

**Veredicto: APROBADO (0 bloqueantes)** · reviewer (model opus) · 2026-07-11 · rama `feature/34-asignacion-satelite` (HEAD `c2ed3f5`)

## Verificación ejecutable (regla #5)
El reviewer corrió `./init.sh`: `== init OK ==`. `pnpm typecheck` 0 errores (incluye `e2e/`); `pnpm lint` 0 errores (135 warnings preexistentes en `.claude/skills/*`, ajenos); `pnpm test` **1519 tests / 178 archivos** verdes. Sin migración nueva (correcto).

## Trazabilidad R1–R20 → test: COMPLETA (asserts reales)
- R7/R8: `asignarSateliteLote` llamado con `(ordenIds, mensajero, zona, destino, origen)`; repo-test afirma `data` sin `numGuia` (no genera guía).
- R10/R11/R12/R14: conflictos con detalle por orden, todos con `asignarSateliteLote` NO llamado (todo-o-nada real).
- R2: server-side — `findUsuarioZonaId` llamado con `actor.usuarioId`, nunca con parámetro de cliente.

## Puntos críticos
1. **RENAME honesto sin regresión del maestro**: `findMensajerosGam→findMensajerosByZona`, `findMensajeroIdsValidosGam→findMensajeroIdsValidosByZona` en `IOrdenRepository`/`OrdenRepository`/`GuiaAsignacionService`/`lib/actions/ordenes-guia.ts`. Grep: **cero** referencias a los nombres viejos en código/tests (solo docs históricos). El maestro sigue pasando `gamZonaId` (comportamiento idéntico); suites 17/30 verdes.
2. **Servicio paralelo**: `AsignacionSateliteService` nuevo e independiente; el contrato de `GuiaAsignacionService` solo cambió el nombre de los métodos de repo que consume.
3. **Alcance por zona server-side + todo-o-nada**: zona vía `findUsuarioZonaId(actor.usuarioId)`. Guardias `forbidden`/`sin_zona`/`mensajero_invalido`/`zona_ajena`/`estado_invalido`/`no_encontrada`. Escritura `asignarSateliteLote` = `updateMany` guardado por `estatusId=origen AND zonaId AND deletedAt IS NULL`; si `count !== ordenIds.length` re-lee y devuelve `conflict` sin efectos parciales.
4. **Autz**: rol `adminSatelite` exclusivo (página `notFound` server-side + `listarMensajerosSatelite` `forbidden` para otros roles + service revalida). No puede tocar órdenes/mensajeros de otra zona.
5. **Transición**: `en_bodega_satelite`→`en_espera_aceptacion` fijando `mensajeroAsignadoId`; sin `num_guia`, sin estados nuevos, sin migración.
6. **UI**: extiende `recepcion-satelite` (no ruta nueva): "Recibidas" → `ListaRecibidas` con checkbox + "Asignar" + `AsignarSateliteModal` (lote con 1 mensajero); mensajeros por props desde Server Component.
7. **E2E**: `e2e/asignacion-satelite.spec.ts` (recibida→asignar→`en_espera_aceptacion`), typecheckea, ejecución diferida (deuda aceptada).
8. **Capas/CHECKPOINTS**: action sin queries; service sin HTTP/Prisma; repo solo Prisma; interfaces en `lib/interfaces/`. Sin RLS nueva (sin tablas nuevas).

## Hallazgos menores (no bloqueantes)
1. `AsignacionSateliteService.ts:125`: en el detalle de carrera (R14) las órdenes no transicionadas usan el literal `"conflict"` como motivo, mientras las guardias de precarga usan `estado_invalido`. Cosmético; el `status` sigue siendo `conflict`. Declarado en la bitácora.
2. Tasks T12/T13 quedaban `[ ]` → marcadas `[x]` al cerrar (contenido cumplido).
