# Feature 112 — Tasks

Feature backend pura, complejidad baja. Sin migración, sin cambios de rutas.

## Checklist

- [ ] **T1 — Actualizar el test unitario al contrato `data` (TDD, primero rojo).**
  En `tests/unit/services/webhook-estado-service.test.ts` línea 94, cambiar el
  assert `expect(body.orden).toEqual(...)` por `expect(body.data).toEqual(...)`
  con los mismos valores `{ numGuia: 12345, numRemision: NUM_REMISION, estado:
  "en_reparto" }`. Añadir un assert explícito de que `body.orden` es `undefined`
  para blindar el breaking change.
  *Hecho cuando:* el test falla (rojo) contra el código actual por la clave
  vieja, demostrando que cubre R1/R2.
  Depende de: —

- [ ] **T2 — Cambiar la clave `orden` → `data` en el servicio.**
  En `lib/services/WebhookEstadoService.ts` líneas 85-94, renombrar la clave
  `orden:` del objeto de `JSON.stringify` a `data:`. No tocar nada más del sobre
  ni del contenido interno.
  *Hecho cuando:* T1 pasa a verde y el resto de la suite de
  `webhook-estado-service.test.ts` sigue verde (R3/R4/R5/R6 intactos).
  Depende de: T1.

- [ ] **T3 [P] — Verificar el test de integración sin cambios de contrato.**
  Correr `tests/integration/api/procesar-jobs-webhook-estado.test.ts` y confirmar
  que sigue verde sin editarlo (no assertea la forma del cuerpo de salida).
  *Hecho cuando:* el test pasa sin modificaciones.
  Depende de: T2. Paralelizable con T4.

- [ ] **T4 [P] — Grep de residuos de la clave vieja.**
  `grep -rn "orden:" lib/services/WebhookEstadoService.ts` y grep de `body.orden`
  / `.orden` en `tests/` filtrado por webhook: no debe quedar ninguna referencia
  a la clave vieja en el contrato de salida.
  *Hecho cuando:* 0 coincidencias de la clave `orden` como envoltura del payload.
  Depende de: T2. Paralelizable con T3.

- [ ] **T5 — Verificación final.**
  Correr `./init.sh` y la suite de tests completa; typecheck en verde.
  *Hecho cuando:* `init.sh` verde y toda la suite pasa.
  Depende de: T2, T3, T4.

## Mapa R → test (trazabilidad)

| Req | Verificado por                                                                 |
|-----|--------------------------------------------------------------------------------|
| R1  | `webhook-estado-service.test.ts` › "hace POST ... con el cuerpo del evento" — assert `body.data` definido y `body.orden` undefined (T1) |
| R2  | `webhook-estado-service.test.ts` › mismo test — `expect(body.data).toEqual({ numGuia, numRemision, estado })` (T1) |
| R3  | `webhook-estado-service.test.ts` › mismo test — `body.evento` / `body.eventoId` inalterados; `ocurridoAt` presente |
| R4  | `webhook-estado-service.test.ts` › mismo test — `expect(body.evento).toBe("orden.estado_actualizado")` |
| R5  | `webhook-estado-service.test.ts` › mismo test — assert de `X-Ordenex-Signature` = `sha256=firmarWebhook(SECRETO, ts, cuerpo)` sobre el cuerpo nuevo |
| R6  | `webhook-estado-service.test.ts` › "reejecutar el job produce el mismo eventoId y el mismo cuerpo" |
