# Impl 112 — webhook: renombrar clave del payload `orden` → `data`

Backend puro, cambio mínimo. Gate APROBADO.

## Archivos tocados
- `lib/services/WebhookEstadoService.ts` — clave `orden:` → `data:` en el objeto de
  `JSON.stringify` (~línea 89). Nada más cambia: `evento`, `eventoId`, `ocurridoAt`,
  el contenido interno (`numGuia`, `numRemision`, `estado`) y el HMAC quedan idénticos.
- `tests/unit/services/webhook-estado-service.test.ts` — assert `body.orden` → `body.data`;
  añadido `expect(body.orden).toBeUndefined()` como blindaje del breaking change (T1).
- `tests/integration/api/procesar-jobs-webhook-estado.test.ts` — SIN cambios: solo
  referencia `ordenId`/`dedupeKey` de ENTRADA, no assertea la forma del cuerpo de salida (T3).

## Mapa R → test
| Req | Test |
|-----|------|
| R1  | `webhook-estado-service.test.ts` › "con suscripcion activa hace POST ... con el cuerpo del evento" — `body.data` definido, `body.orden` undefined |
| R2  | mismo test — `expect(body.data).toEqual({ numGuia, numRemision, estado })` |
| R3  | mismo test — `body.evento` / `body.eventoId` inalterados, `ocurridoAt` presente |
| R4  | mismo test — `expect(body.evento).toBe("orden.estado_actualizado")` |
| R5  | mismo test — `X-Ordenex-Signature` = `sha256=firmarWebhook(SECRETO, ts, cuerpo)` sobre el cuerpo nuevo |
| R6  | `webhook-estado-service.test.ts` › "reejecutar el job produce el mismo eventoId y el mismo cuerpo" |

## Verificación
- `pnpm typecheck`: verde (0 errores). Baseline verde tras `pnpm db:generate` (cliente Prisma stale).
- `pnpm lint`: 0 errores (143 warnings preexistentes, ninguno nuevo).
- `vitest run` (unit + integración webhook): **2 test files, 15 tests, todos verdes** (2.15s).
- Grep `orden:` en `WebhookEstadoService.ts`: 0 coincidencias (clave envoltura eliminada).
- Grep `body.orden` en el test unit: 1 coincidencia = `expect(body.orden).toBeUndefined()` (blindaje, esperado).

## Veredicto
Clave del cuerpo del webhook renombrada `orden` → `data`; typecheck/lint/tests verdes; contrato de firma y de entrada intactos.
