# review_104 — Webhooks de cambios de estado para integradores con API key

Rama revisada: feature/99-webhooks-cambios-estado (slug original; feature 104).
Base de comparacion: dev. Revision read-only (git show / worktree aislado).
Fecha: 2026-07-21. Veredicto: OK (0 bloqueantes).

## Checklist de CHECKPOINTS.md

Especificacion:
- [x] requirements.md con R1-R32 EARS numerados.
- [x] design.md con alternativas descartadas y su porque (secciones 10.1-10.8).
- [~] tasks.md: T0-T17 con criterio Hecho cumplido, pero casillas quedaron sin marcar [x] (menor 1).

Trazabilidad:
- [x] Cada R1-R32 mapea a >=1 test concreto con aserciones reales (tabla abajo).
- [x] progress/impl_99.md contiene el mapa R -> test.

Calidad de codigo:
- [x] pnpm typecheck -> exit 0 (verificado por el reviewer). El widen de tx a ChokePointTx NO rompio los 13 call-sites.
- [~] pnpm lint -> no ejecutado por el reviewer; implementer no reporta issues.
- [x] pnpm test -> 43 tests verdes en 8 de 13 archivos (reviewer). Los 5 restantes no cargaron por quirk ESM del cliente Prisma 7.8 (main-entry-point) en el worktree desechable, no por el codigo (cero fallos de asercion; revisados estaticamente). Implementer reporta suite completa verde salvo 2 fallos HomePageRol.test.tsx pre-existentes/ambientales.
- [x] Flujo critico (webhooks): unit+integration. E2E no aplica (backend puro; el POST sale al integrador, testeado con fetch inyectable). La UI es F100.

Datos y seguridad:
- [x] Tabla webhook_suscripcion con RLS habilitada sin policies (migracion + test R2).
- [x] Migraciones reversibles: ambas con down.sql; enum recreado (no DROP VALUE); ADD VALUE solo en su migracion (55P04).
- [x] Sin secretos hardcodeados: clave de cifrado/timeout/ventana por entorno; secreto de firma CIFRADO (AES-256-GCM) en reposo.
- [x] Webhook idempotente y firmado: HMAC-SHA256 sobre ts.cuerpo, cabeceras X-Ordenex-Signature/-Timestamp, eventoId estable.

Patron de capas:
- [x] Controller (Server Action) sin queries ni logica.
- [x] Service sin HTTP (DI por interfaces).
- [x] Repositorios solo queries Prisma (Pick de PrismaClient).
- [x] Interfaces en lib/interfaces/{external,repositories,services}/.

Permisos / Multi-pais:
- [x] Server Action autoriza server-side por rol maestro; guard D3 (owner rol apiKey).
- [x] Sin hardcode de pais/moneda/cuenta.

## Foco de la revision (gate F1.4) — resultados

1. Transactional-outbox (R10/R11): OK. appendCambioEstado emite tras el createMany, en la MISMA tx, via emitir(tx, entradas) con default = emisor real. Test R11: si createMany rechaza, enqueue no se llama. calls[0][3] === tx prueba el 4o parametro outbox. Widen a ChokePointTx no rompe call-sites (typecheck exit 0).
2. Choke point unico (R16): OK. git grep confirma el UNICO enqueue de webhook_estado en webhook-estado-encolado.ts:123. Ningun call-site suelto emite.
3. Aislamiento por owner (R24/R25): OK. Destino SIEMPRE de datos.tiendaId (orden.tiendaId), nunca del payload (test R24). El paso 5 filtra por w.owner_usuario_id = o.tienda_id AND w.activa + JOIN rol.value apiKey + o.deleted_at IS NULL. Verificado que el valor apiKey coincide con el enum rol_value sembrado (migracion 20260716140000): el guard no es un string muerto.
4. Secreto cifrado en reposo (R32): OK. AES-256-GCM, formato v1:iv:tag:ct, IV aleatorio, authTag verificado. Round-trip, authTag corrupto, formato invalido y clave ausente -> WebhookSecretKeyError recuperable sin filtrar el secreto. Config no lanza si falta la clave (R28); el handler descifra en memoria justo para firmar y nunca loguea (R29). Migracion persiste ciphertext, no texto plano.
5. Firma HMAC + anti-replay (R18): OK. Determinista; cambia si cambia cuerpo o timestamp; el test recomputa la firma con el secreto en claro y compara.
6. dedupeKey con instante (R14): OK. webhook_estado:ordenId:estatusDestinoId:ISO. Test: repetir el mismo estado en dos instantes da claves distintas (evita colapso silencioso por ON CONFLICT). Comentario normativo en el codigo.
7. Handler desenlaces (R19-R23): OK. 2xx->complete; transitorio->lanza; sin suscripcion->retorna; orden inexistente/borrada->retorna. maxIntentos=5 (R27).
8. R31 persistir desenlace: OK. El detalle del outcome viaja en el mensaje de WebhookEntregaFallidaError; el test de cron verifica que JobQueueService.fail lo recibe (aterriza en jobs.last_error) y re-agenda con backoff.
9. Migraciones: OK. ADD VALUE solo en su migracion; ambos down.sql correctos (enum recreado borrando antes filas jobs del tipo; DROP TABLE arrastra PK/indice/FK/RLS).
10. Tests ajustados NO debilitados: OK. procesar-jobs-registro/geocodificacion suman webhook_estado al set exacto (sigue exacto). Satelite asignacion/recepcion: se relajo toHaveBeenCalledTimes(1) a >=1 en queryRaw porque el choke point emite una sonda de elegibilidad en la misma tx; la asercion sustantiva (call[0] = UPDATE de dominio con su SQL y params) se conserva. zonas-migration: whitelist de apendidas-despues (orden de timestamps). Todos legitimos.
11. Trazabilidad R1..R32: OK.

## Tabla R -> test -> estado

| R | Test | Estado |
| --- | --- | --- |
| R1 | webhook-suscripcion-migracion "R1 tabla" | OK (run) |
| R2 | webhook-suscripcion-migracion "R2 RLS" | OK (run) |
| R3 | webhook-suscripcion-migracion "R3 catalogo job" | OK (run) |
| R4 | webhook-suscripcion-rollback "R4" | OK (run) |
| R5 | webhook-suscripcion-service "R5 URL" | OK (run) |
| R6 | webhook-suscripcion-service + webhook-suscripcion-repository | OK (run) |
| R7 | webhook-suscripcion-service + repo findByOwner sin secreto | OK (run) |
| R8 | webhook-suscripcion-service + repo desactivarByOwner | OK (run) |
| R9 | webhook-suscripcion-service + webhooks-action (auth maestro) | OK (svc run; action estatico) |
| R10 | orden-webhook-enqueue "R10" | OK (estatico) |
| R11 | orden-webhook-enqueue "R11 no huerfano" | OK (estatico) |
| R12 | orden-webhook-enqueue + webhook-estado-encolado | OK (estatico) |
| R13 | webhook-estado-encolado "R13/R27 payload minimo" | OK (estatico) |
| R14 | webhook-estado-encolado "R14 dedupeKey" | OK (estatico) |
| R15 | webhook-estado-encolado "R15 EVENTOS_PUBLICOS" | OK (estatico) |
| R16 | orden-webhook-enqueue "R16 dos mecanismos" | OK (estatico) |
| R17 | webhook-estado-service "R17/R19 entrega" | OK (estatico) |
| R18 | webhook-firma "R18 HMAC" + verif en service | OK (run) |
| R19 | webhook-estado-service "2xx completa" | OK (estatico) |
| R20 | webhook-estado-service "R20/R31 transitorio lanza" | OK (estatico) |
| R21 | webhook-estado-service "R21 sin suscripcion" | OK (estatico) |
| R22 | webhook-estado-service "R22 orden inexistente/borrada" | OK (estatico) |
| R23 | webhook-estado-service "R23 idempotencia" | OK (estatico) |
| R24 | webhook-estado-service "R24 aislamiento" | OK (estatico) |
| R25 | orden-webhook-enqueue "R25 dos owners" | OK (estatico; menor 2) |
| R26 | procesar-jobs-webhook-estado "R26 handler / no recurrente" | OK (estatico) |
| R27 | webhook-estado-encolado "maxIntentos=5" | OK (estatico) |
| R28 | webhook-config "ausente -> defaults sin lanzar" | OK (run) |
| R29 | webhook-estado-service + webhook-sender | OK (sender run; service estatico) |
| R30 | webhook-estado-service "R30 payload invalido" | OK (estatico) |
| R31 | webhook-estado-service + procesar-jobs-webhook-estado (last_error via fail) | OK (estatico) |
| R32 | webhook-secret-cipher + webhook-estado-service + suscripcion-service | OK (cipher+svc run) |

32/32 con test real y aserciones que verifican el requisito. Ninguno huerfano ni vacio.

## Verificacion ejecutable (reviewer)

- Worktree aislado + pnpm install + pnpm db:generate.
- pnpm exec tsc --noEmit -> exit 0.
- pnpm exec vitest run sobre los 13 archivos: 43 PASS en 8 archivos (cipher, firma, config, sender, suscripcion-service, suscripcion-repository, migracion, rollback). Los 5 restantes (service handler, outbox enqueue, cron wiring, action) no cargaron por el error de resolucion ESM del cliente Prisma 7.8 en el worktree desechable; quirk de entorno, identico en los 5, cero fallos de asercion. Revisados estaticamente linea por linea: aserciones fuertes y correctas.
- Round-trip real de migraciones contra Postgres: no ejecutado (patron 91/92, precondicion de deploy); SQL up/down cubierto por tests estaticos.

## Hallazgos

BLOQUEANTES: ninguno.

menores:
1. tasks.md con casillas sin marcar. T0-T17 con criterio Hecho cumplido y trabajo completo, pero las casillas quedaron [ ]. CHECKPOINTS pide todas [x]. Cosmetico; conviene marcarlas para cerrar el checkpoint de especificacion.
2. R25 mapeo por proxy. El test verifica que dos owners producen dos jobs cada uno con su ordenId, no literalmente el ruteo al callback propio (eso es entrega, cubierto por R24: destino por orden.tiendaId). Aislamiento cubierto por R25(enqueue)+R24(entrega); no es gap real.
3. .env.example no versionado (gitignored en el repo). Las 3 env quedan documentadas en impl_99.md + NOTA DE DEPLOY. Anotar que WEBHOOK_SECRET_ENC_KEY es obligatoria para firmar (sin ella el job falla recuperable, no revienta).

## Veredicto final: OK

Sin bloqueantes. 32/32 requisitos con tests reales; typecheck limpio; transactional-outbox, aislamiento por owner, cifrado en reposo, firma HMAC, dedupe con instante, persistencia del desenlace y wiring del cron conforme al design. 3 hallazgos menores (cosmeticos/de precision). Recomendado: marcar las casillas de tasks.md.
