# Review Feature 112 — Webhook: clave del payload `orden` → `data`

**Veredicto: APROBADO** — 0 bloqueantes.

## Checklist

- [x] Trazabilidad R1–R6: cada requisito mapea a un test real que lo verifica.
- [x] Cambio correcto y acotado en `WebhookEstadoService.ts`: cuerpo usa `data:` con `{ numGuia, numRemision, estado }`.
- [x] Sobre inalterado: `evento` ("orden.estado_actualizado"), `eventoId`, `ocurridoAt` sin cambios.
- [x] Firma HMAC (`cabecerasFirma` sobre `${timestamp}.${cuerpo}`) NO tocada.
- [x] Payload de ENTRADA del job (`{ ordenId, estatusDestinoId, ocurridoAt }`) sin cambios.
- [x] Sin residuos de `orden` como envoltura en el service ni en el test de contrato.
- [x] `pnpm typecheck`: verde (0 errores).
- [x] `pnpm lint`: 0 errores (143 warnings preexistentes, ninguno de F112).
- [x] Tests webhook: 15/15 passed (unit service + integración jobs).
- [x] Doc OpenAPI del webhook: confirmada fuera de alcance (0 coincidencias de "webhook" en openapi-spec.ts / api-key-openapi.yaml).

## Trazabilidad R → test

| Req | Test | Verificado |
|-----|------|-----------|
| R1  | webhook-estado-service.test.ts L94, L96: `body.data` definido y `body.orden` undefined | OK |
| R2  | L94: `expect(body.data).toEqual({ numGuia: 12345, numRemision, estado: "en_reparto" })` | OK |
| R3  | L97 `body.evento`; L146-154 (R23) cuerpo completo determinista incluye `eventoId`/`ocurridoAt` | OK |
| R4  | L97: `expect(body.evento).toBe("orden.estado_actualizado")` | OK |
| R5  | L100-101: `X-Ordenex-Signature` = `sha256=firmarWebhook(SECRETO, ts, cuerpo)` sobre el cuerpo nuevo con `data` | OK |
| R6  | L146-154: reejecutar produce mismo `eventoId` y mismo cuerpo serializado | OK |

## Hallazgos

- **menor** — `tests/unit/clients/webhook-sender.test.ts:9` mantiene un fixture `CUERPO = JSON.stringify({ eventoId: ..., orden: { numGuia: 999 } })` con la clave vieja `orden`. NO es bloqueante: el WebhookSender es transporte opaco a la forma del cuerpo (feature 99); el test solo verifica round-trip del string (`init.body === CUERPO`), nunca parsea ni assertea `.orden`. No verifica el contrato de F112. Recomendación cosmética: alinear el fixture a `data` para no inducir a error al lector. Fuera del alcance estricto de las tasks de F112.

## Salidas de verificación

- typecheck: `tsc --noEmit` sin salida de error → verde.
- lint: `0 errors, 143 warnings` (todos preexistentes, ninguno introducido por F112).
- tests: `Test Files 2 passed (2) · Tests 15 passed (15)` en 2.46s.

## Notas de scope confirmadas

- Firma HMAC: intacta (líneas 96-98 del service).
- Payload de entrada del job: `payloadSchema` sin cambios (líneas 21-25).
- Grep de sanidad `orden:{`, `body.orden`, `.orden` en el service: 0 coincidencias.
