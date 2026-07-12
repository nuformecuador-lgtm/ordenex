# Review — Feature 36 · Mensajero: "Mis asignaciones" y gestión de órdenes (RE-REVISIÓN)

Rama: `feature/36-mensajero-mis-asignaciones` · commit revisado: `db748b6`
Ciclo: re-revisión tras RECHAZADO previo (2 bloqueantes + 4 menores). El código base
ya se aprobó en calidad; aquí se verifica SOLO el cierre de hallazgos y ausencia de regresión.

## Checklist
- [x] Especificación (requirements/design/tasks) presente.
- [x] `tasks.md`: T1–T21 todas `[x]`. T19 (mapa R→test), T20 (verde), T21 (E2E) con sustancia.
- [x] Trazabilidad: R0–R35 mapeados a test concreto (bitácora §4 + §7.3). R35 aditivo.
- [x] `./init.sh` verde: 167 files, 1433 tests PASS, typecheck 0 err (incl. e2e/), lint 0 err.
- [x] E2E del flujo crítico de recaudo existe y es coherente.
- [x] RLS en tabla nueva, storage privado, sin secretos, capas separadas (ya aprobado; sin regresión).

## Re-verificación de hallazgos previos

### BLOQUEANTE-1 — tasks.md completo → CERRADO
T19/T20/T21 marcadas `[x]` con sustancia real: mapa R→test completo en la bitácora (§4, incluye
R35 en §7.3); `./init.sh` verde reproducido por el reviewer; E2E creado.

### BLOQUEANTE-2 — E2E del flujo crítico → CERRADO
`e2e/mis-asignaciones.spec.ts` existe. Cubre recaudo: recoger (`en_espera_aceptacion`→`en_reparto`)
→ gestionar → ENTREGADA con foto + `montoRecibido == montoCobrar` (input prefijado) + método de pago
→ modal cierra en éxito; más RECHAZO (foto+motivo) y REPROGRAMAR (fecha futura+motivo). Misma
EXECUTION NOTE de `e2e/auth.spec.ts` (ejecución diferida = deuda aceptada). Selectores reales:
`section aria-label="Por recoger"`/`"En reparto / por gestionar"`, dialogs `Recoger órdenes`/
`Gestionar orden`, comboboxes `Resultado de la gestión`/`Método de pago`, labels `Monto recibido`/
`Foto de evidencia de entrega`/`Foto de evidencia del rechazo`/`Nueva fecha de reprogramación`/
`Motivo`, botón `Guardar gestión`. TYPECHECKEA (init.sh verde incluye e2e/).

### menor-1 — withErrorHandler → CERRADO
`lib/actions/mis-asignaciones.ts`: las 5 actions (listar/recoger/escoger/gestionar/liberarGestion)
envueltas en `withErrorHandler`; `toMisAsignacionesActionError` espeja `toGuiaActionError`. Retornos
de dominio (forbidden/conflict/validation_error/unauthenticated) intactos.

### menor-2 — comparación de monto en Decimal → CERRADO
`MisAsignacionesService.gestionar` rama `entregada`:
`new Prisma.Decimal(input.montoRecibido).equals(new Prisma.Decimal(orden.montoCobrar))`. Regla (h)
y `validation_error` por campo `montoRecibido` preservados.
(Observación no bloqueante: `orden.montoCobrar` llega como `number` desde el repo vía `.toNumber()`,
por lo que el operando se reconstruye a Decimal desde un float; para montos de moneda el round-trip
es exacto. Aceptable — el finding pedía `.equals`, cumplido.)

### menor-3 — liberar puntero al cancelar → CERRADO
- Repo `liberarOrdenEnGestion`: `updateMany where { id: mensajeroId, ordenEnGestionId: ordenId }` →
  solo el puntero PROPIO y solo si apunta a esa orden (concurrencia-seguro).
- Path de ÉXITO: la tx de `crearGestionYTransicionar` limpia el puntero; `handleGestionSuccess` NO
  llama a liberar (evita doble limpieza).
- Cableado: `MisAsignacionesModule` → `onOpenChange(!next) → cancelarGestion → liberarGestion`.
- Tests en 4 capas (repo/service/action/component). R35 aditivo; R0–R34 sin renumerar.

## Verificación ejecutable (reviewer)
`./init.sh` == init OK ==. 167 test files / **1433 tests PASS** (era 1417). Typecheck 0 errores.
Lint 0 errores (135 warnings preexistentes en `.claude/skills/*`). Migraciones con `down.sql`.

## Regresiones
Ninguna. Deudas aceptadas (bucket humano, migración no aplicada, E2E no ejecutado) no son hallazgos.

## Veredicto
**APROBADO** (0 bloqueantes).
