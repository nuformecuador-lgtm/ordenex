# Feature 99 — Tasks

Rama `feature/99-webhooks-cambios-estado` desde `origin/dev` limpio, en **worktree
aislado** (no checkout sobre `flow`: WIP ajeno + drift de sesiones paralelas).

`[P]` = paralelizable con las tareas de su mismo bloque.
Criterio global: `./init.sh` en verde y suite de tests pasando antes de cerrar.

> **Gate F1.4 CERRADO (aprobado 2026-07-21).** D1–D5 resueltas (`requirements.md`
> §"Resolución del gate F1.4"): canal = **Server Action** en la UI (D1), secreto **cifrado
> en reposo** (D2), emisión **solo para órdenes de owner rol `apiKey`** (D3), **F100** nace
> (D4), `maxIntentos = 5` (D5). Requisito nuevo **R31** (persistir desenlace de entrega vía
> `jobs`). **Ningún task queda bloqueado**: T0–T18 son ejecutables de principio a fin.
>
> **Antes de tocar `registrar-cambio-estado.ts`** (el choke point de la feature 49), leer
> `design.md` §6 y §6.1: se emite ahí, con `tx` widen + emisor inyectable, sin tocar los 13
> call-sites.

---

## Bloque 0 — Preparación

### [ ] T0 · Worktree y baseline
Crear worktree aislado desde `origin/dev`; verificar presente la infraestructura de la 90
(`lib/config/jobs.ts`, `lib/services/JobQueueService.ts`, `procesar-jobs/route.ts`,
`IJobRepository.enqueue(..., tx)`) y el choke point de la 49
(`lib/repositories/registrar-cambio-estado.ts`).
**Hecho:** `pnpm install --force` + `pnpm db:generate` OK; baseline de tests/typecheck
**medido** (no citado de `progress/current.md`, que caduca).
**Depende de:** —

---

## Bloque 1 — Esquema y migraciones

### [ ] T1 · Schema Prisma
Añadir `model WebhookSuscripcion` (§1.1) y el valor `webhook_estado` al enum `JobTipo`
(§1.2). Añadir la relación inversa en `Usuario`.
**Hecho:** `pnpm db:generate` sin errores; `Prisma.WebhookSuscripcionCreateInput` expone
los campos.
**Depende de:** T0

### [ ] T2 · Migración A — enum `job_tipo` (va SOLA)
`db/migrations/<ts>_job_tipo_webhook_estado/` con `migration.sql`
(`ALTER TYPE … ADD VALUE IF NOT EXISTS 'webhook_estado'`) y `down.sql` que **recrea el
tipo** (Postgres no tiene `DROP VALUE`), borrando antes las filas `jobs` de ese tipo.
Seguir el precedente `20260720120000_job_tipo_optimizacion_ruta` (incluido el comentario
del `55P04`).
**Cubre:** R3.
**Hecho:** `pnpm db:migrate` aplica; `pnpm db:rollback` revierte sin residuos; ambos
re-ejecutables.
**Depende de:** T1

### [ ] T3 · Migración B — tabla `webhook_suscripcion`
`db/migrations/<ts>_webhook_suscripcion/` con el SQL de §1.1: tabla, `UNIQUE
(owner_usuario_id)`, `ENABLE ROW LEVEL SECURITY` sin policies; su `down.sql`
(`DROP TABLE`).
**Cubre:** R1, R2.
**Hecho:** migración aplica y revierte; RLS habilitada y **cero policies** verificado en DB.
**Depende de:** T2 (orden de timestamps)

### [ ] T4 · Tests de migración y rollback
`tests/integration/db/webhook-suscripcion-migracion.test.ts` y `…-rollback.test.ts`.
**Cubre:** R1, R2, R3, R4.
**Hecho:** los 4 requisitos con test verde.
**Depende de:** T3

---

## Bloque 2 — Piezas puras (paralelizables entre sí)

### [ ] T5 · [P] Config `lib/config/webhook.ts`
Clon de `lib/config/geocode.ts`: ausente/`""` → defaults/`null`, nunca lanza. Campos:
`WEBHOOK_TIMEOUT_MS`, `WEBHOOK_REPLAY_WINDOW_S`, `WEBHOOK_SECRET_ENC_KEY` (null si ausente).
Añadir las tres env comentadas en `.env.example` §`# Integraciones (según feature)`.
**Cubre:** R28.
**Hecho:** `tests/unit/config/webhook-config.test.ts` verde, incluido "clave de cifrado
ausente → null sin lanzar".
**Depende de:** T0

### [ ] T6 · [P] Firma `lib/crypto/webhook-firma.ts`
`firmarWebhook(secret, timestampUnix, cuerpo)` HMAC-SHA256 hex sobre `${timestamp}.${cuerpo}`
(§3, D2). Cabeceras `X-Ordenex-Signature`/`X-Ordenex-Timestamp`, ventana
`WEBHOOK_REPLAY_WINDOW_S`.
**Cubre:** R18.
**Hecho:** `tests/unit/crypto/webhook-firma.test.ts` verde: firma determinista, cambia si
cambia cuerpo o timestamp; el secreto nunca aparece en la salida.
**Depende de:** T0

### [ ] T6b · [P] Cifrado del secreto `lib/crypto/webhook-secret-cipher.ts`
`cifrarSecreto`/`descifrarSecreto` AES-256-GCM, formato `v1:<iv>:<tag>:<ct>` (§3.1, D2/R32).
`descifrarSecreto(null, …)` lanza `WebhookSecretKeyError` **recuperable** sin filtrar el
secreto.
**Cubre:** R32.
**Hecho:** `tests/unit/crypto/webhook-secret-cipher.test.ts` verde: round-trip
`descifrar(cifrar(s)) === s`; authTag corrupto lanza; clave ausente → error recuperable que
NO contiene `s`.
**Depende de:** T0

### [ ] T7 · [P] Cliente `lib/clients/webhook-sender.ts` + `IWebhookSender`
Crear `lib/interfaces/external/IWebhookSender.ts` con `WebhookOutcome` (§4). `fetchImpl?`
inyectable + `AbortController` con `WEBHOOK_TIMEOUT_MS`. Traduce HTTP a dominio, no decide
política. El detalle de error nunca incluye URL ni cuerpo.
**Cubre:** habilita R17, R19, R20; parte de R29.
**Hecho:** `tests/unit/clients/webhook-sender.test.ts` cubre 2xx, no-2xx, timeout y fallo
de red **sin red**; un test asegura que ningún mensaje de error contiene la URL ni el cuerpo.
**Depende de:** T5

---

## Bloque 3 — Persistencia

### [ ] T8 · Repositorio de suscripciones
`IWebhookSuscripcionRepository` + `WebhookSuscripcionRepository` (patrón `ApiKeyRepository`):
`upsertByOwner`, `findActivaByOwner`, `desactivarByOwner`. Además el helper de resolución
por lote de §5 (órdenes con owner suscrito activo **y rol `apiKey`**, guard de D3) para el
choke point. Solo queries.
**Cubre:** R6 (persistencia); habilita R12, R21, R24, R25.
**Hecho:** typecheck OK; tests de integración de upsert/lectura/desactivación verdes,
incluido "un segundo registro del mismo owner actualiza, no duplica" y "la resolución por
lote excluye órdenes de un owner que no es rol apiKey"
(`tests/integration/repositories/webhook-suscripcion-repository.test.ts`).
**Depende de:** T4

---

## Bloque 4 — Servicio y controller de registro (D1 = Server Action)

### [x] T9 · `WebhookSuscripcionService`
Validación de URL https en el borde (R5); **alta vs edición** (R33): alta genera+cifra el
secreto y lo devuelve una vez (`creada`), edición solo actualiza la URL conservando el
secreto (`actualizada`, sin secreto); **rotación explícita** `rotarSecreto` (R34); baja
(R8); lectura `obtener` sin secreto (R7/R35); autorización/aislamiento por owner (R9). Sin
controller.
**Cubre:** R5, R6, R7, R8, R9, R32 (persistencia cifrada), R33, R34, R35.
**Hecho:** `tests/unit/services/webhook-suscripcion-service.test.ts` verde: URL no-https
rechazada sin persistir; **alta** retorna secreto una vez y persiste cifrado; **editar
conserva el secreto y no lo devuelve** (incluida reactivación de una baja); **rotar** genera
un secreto NUEVO distinto y `not_found` si no hay suscripción; la vista nunca expone el
secreto; un actor no opera la suscripción de otro owner.
**Depende de:** T8, T6b

### [x] T10 · Controller de registro/rotación/lectura — Server Actions (D1)
`lib/actions/webhooks.ts` (`'use server'`), autorizadas al rol `maestro` (patrón feature 82,
`design.md` §9): `registrarWebhook` (alta `creada` con secreto una vez / edición
`actualizada` sin secreto, R33; guard owner rol `apiKey`, D3), `rotarSecretoWebhook`
(R34: `ok`/`not_found`/`config_error`), `obtenerWebhook` (R35/D2: `{url, activa}|null`, sin
secreto) y `desactivarWebhook`. **NO** endpoint por API key. La UI (feature 105) se coordina
aparte (ya registrada, D4).
**Cubre:** superficie de R9 (autorización por rol maestro), R33, R34, R35.
**Hecho:** `tests/unit/actions/webhooks-action.test.ts` verde: un no-maestro es rechazado en
las cuatro acciones; el alta recibe el secreto una vez (`creada`) y la edición no (`actualizada`);
rotar devuelve el secreto nuevo (`ok`), `not_found` sin suscripción y `config_error` sin
clave; obtener devuelve la vista sin secreto (o `null`).
**Depende de:** T9

---

## Bloque 5 — Entrega (handler)

### [ ] T11 · `lib/services/jobs/webhook-estado-handler.ts` (+ service)
Implementa `JobHandler`. DI por interfaces. Flujo de §7: valida payload (R30), orden
inexistente/borrada → completa (R22), sin suscripción activa → completa (R21), destino
SIEMPRE por `orden.tiendaId` (R24), **descifra el secreto** (T6b; clave ausente → lanza
recuperable, R32), cuerpo de entrega con `num_guia`/`num_remision`/estado en texto/instante
(D3) + `eventoId` (R23), firma (T6), entrega (T7): 2xx → complete (R19), transitorio → lanza
un `Error` con el `detalle` para que aterrice en `jobs.last_error` (R20/R31). Logs agregados
sin secreto/URL/PII (R29).
**Cubre:** R17, R19, R20, R21, R22, R23, R24, R29, R30, R31, R32 (descifrado).
**Hecho:** `tests/unit/services/webhook-estado-service.test.ts` verde con un caso por
desenlace (2xx, 5xx, timeout, red, sin suscripción, orden borrada, payload inválido, clave
de cifrado ausente → error recuperable), reejecución idempotente (mismo `eventoId`/cuerpo),
aislamiento (evento de un owner nunca va al callback de otro), el `detalle` del fallo se
propaga para `last_error` (R31), y un espía del logger que verifica ausencia de
secreto/URL/destinatario.
**Depende de:** T6, T6b, T7, T8

### [ ] T12 · Registro en el drenador
En `app/api/cron/procesar-jobs/route.ts`, `handlers.set("webhook_estado", …)` dentro de
`buildHandlers()`. **No tocar** `buildRecurrencias()` ni `vercel.json`.
**Cubre:** R26.
**Hecho:** `tests/integration/api/procesar-jobs-webhook-estado.test.ts` verifica que el
handler se resuelve y que el job **no** se re-agenda; los tests existentes de `procesar-jobs`
siguen verdes.
**Depende de:** T11

---

## Bloque 6 — Emisión (outbox en el choke point)

### [ ] T13 · Helper de emisión `lib/services/jobs/webhook-estado-encolado.ts`
`dedupeKeyWebhookEstado(ordenId, estatusDestinoId, ocurridoAtISO)` + `EVENTOS_PUBLICOS`
(`lib/types/webhook-eventos.ts`, lista FIJADA de D3) + el emisor que: filtra por
`EVENTOS_PUBLICOS` (R15), resuelve órdenes con owner suscrito activo **y rol `apiKey`** (§5,
R12/D3), y encola `webhook_estado` con payload mínimo (R13) y `MAX_INTENTOS_WEBHOOK = 5`
(R27/D5).

⚠️ **Clave normativa:** `webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAt-ISO>`. El
componente de INSTANTE es **obligatorio**: sin él, una orden que reingresa a un estado por
reintento (feature 47) chocaría con la fila `done` anterior y el `ON CONFLICT DO NOTHING`
descartaría el evento **en silencio** (`design.md` §6, mismo hallazgo que la 91 R13). Copiar
ese comentario al código.
**Cubre:** R13, R14, R15, R27.
**Hecho:** `tests/unit/services/webhook-estado-encolado.test.ts` verde: payload sin secreto;
dos transiciones distintas (incl. repetición del mismo estado) → claves distintas; un estado
fuera de `EVENTOS_PUBLICOS` no encola; `maxIntentos` = 5.
**Depende de:** T5, T8

### [ ] T14 · Enganche en `appendCambioEstado`
Widen `tx` + emisor inyectable con default (§6.1), invocado tras el `createMany` del
historial, en la MISMA tx. NO tocar los 13 call-sites (la firma se preserva con el 3.er
parámetro opcional).
**Cubre:** R10, R11, R12, R16, R25.
**Hecho:** `tests/integration/repositories/orden-webhook-enqueue.test.ts` verde: transición
de orden con owner suscrito deja job pendiente; tx revertida no deja job; orden sin owner
suscrito no encola; transiciones por dos mecanismos (creación y gestión) encolan igual; con
dos owners suscritos cada job se resuelve a su propio callback. Los tests existentes de
`OrdenRepository`/`GestionOrdenRepository`/historial siguen verdes (regresión del choke point).
**Depende de:** T13

---

## Bloque 7 — Cierre

### [ ] T15 · [P] Seguimientos documentados
Anotar en `progress/impl_99.md` los seguimientos de `design.md` §11 (purga de `jobs`,
endurecimiento SSRF, reintentos por cliente, panel de entregas / tabla de entregas por-orden,
N endpoints por owner, rotación de `WEBHOOK_SECRET_ENC_KEY`). Nota: **F100** (UI de registro)
ya está registrada como feature hermana (D4) — coordinar, no re-registrar.
**Hecho:** los seguimientos escritos con su condición de desbloqueo.
**Depende de:** T14

### [ ] T16 · [P] Mapa de trazabilidad
`progress/impl_99.md` con la tabla `R<n>` → test concreto (archivo + nombre) para los **32**
requisitos.
**Hecho:** los 32 mapeados; ninguno sin test (el reviewer rechaza si falta alguno).
**Depende de:** T14

### [ ] T17 · Verificación final
`./init.sh` en verde, suite completa, typecheck limpio y `pnpm db:rollback` de las dos
migraciones probado en orden inverso.
**Hecho:** todo verde y baseline comparado contra el medido en T0.
**Depende de:** T15, T16

---

## Grafo de dependencias

```
T0
├─→ T1 → T2 → T3 → T4 ────────────────→ T8 ─┬─→ T9 → T10
├─→ T5 [P] ───────────────┬──────────────┐  │
├─→ T6 [P] ───────────────┤              │  │
├─→ T6b [P] ──────────────┼──→ T9        │  │
└─→ T7 [P] ───────────────┼──────────────┴──┴─→ T11 → T12
                          │
        T5 + T8 ─────────────→ T13 → T14 ─┬─→ T15 [P] ─┐
                                          └─→ T16 [P] ─┴─→ T17
```

**Ruta crítica:** T0 → T1 → T2 → T3 → T4 → T8 → T13 → T14 → T16/T15 → T17.
**Frente paralelo temprano:** T5, T6, T6b y T7 no dependen de la DB.

Sin gates pendientes: el F1.4 se cerró el 2026-07-21. T0–T17 son ejecutables de principio a
fin con las decisiones fijadas.
