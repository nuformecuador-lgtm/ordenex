# 403 — Tasks

Convención de "hecho": el archivo compila (`tsc`), el test listado en cada task está escrito y
en verde, y — donde aplique — el requisito `R<n>` de `requirements.md` queda cubierto (ver la
tabla de trazabilidad). Ningún task se da por completo sin su test. Vocabulario: **pausar**, no
desactivar — `activa` no se toca en ningún task de esta lista.

## Fase 0 — Migraciones (bloquean todo lo demás)

- [ ] **T1.** Migración `db/migrations/20260909120000_webhook_suscripcion_circuito/`: añade
  `fallos_consecutivos` (int, default 0) y `sin_exito_desde` (timestamptz, default `now()`) a
  `webhook_suscripcion` (design §1.1) — **dos columnas, no cuatro**: no hay columna de "pausada"
  (es derivada, §2). Incluye `down.sql` (`DROP COLUMN` de las 2, en orden inverso). Actualiza
  `db/schema.prisma` (modelo `WebhookSuscripcion`) y corre `pnpm run db:migrate` local.
  Depende de: nada. **Hecho cuando:**
  `tests/integration/db/webhook-suscripcion-circuito-migracion.test.ts` (nuevo) verifica las 2
  columnas, sus tipos y sus defaults tras insertar una fila mínima; un test de rollback
  verifica que `db:rollback` las retira sin tocar las columnas existentes. Cubre R1 (parcial,
  solo el modelo de datos).

- [ ] **T2. [P]** Migración `db/migrations/20260909130000_notificacion_evento_webhook_suscripcion/`:
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS` para `webhook_suscripcion_pausada` (en
  `notificacion_evento`) y `webhook_suscripcion_pausa` (en `notificacion_entidad_tipo`), con su
  `down.sql` recreando-con-lista los enums de HOY (design §1.2 — copiar exactamente la lista
  actual de `db/schema.prisma`, sin tocar ningún down anterior). Actualiza
  `lib/types/notificacion.ts` (`NotificacionEvento`, `NotificacionEntidadTipo`) y
  `db/schema.prisma`.
  Depende de: nada (independiente de T1, mismo motivo por el que la 333 las separó). **Hecho
  cuando:** `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts`
  (nuevo, contra Postgres real) inserta una fila `notificacion` con el evento/entidad nuevos y
  verifica que el índice de dedupe (`NULLS NOT DISTINCT`, parcial) y `notificacion_entidad_idx`
  sobreviven tanto al alta como al rollback.

## Fase 1 — El predicado puro y la configuración

- [ ] **T3.** `lib/utils/webhook-suscripcion-pausa.ts` (nuevo): `WebhookPausaConfig` +
  `estaPausada(fallosConsecutivos, sinExitoDesde, ahora, config)` (design §2), función pura sin
  dependencias.
  Depende de: nada. **Hecho cuando:** `tests/unit/utils/webhook-suscripcion-pausa.test.ts`
  (nuevo) cubre: por debajo del piso de fallos → `false`; piso cumplido pero ventana no →
  `false` (R6); ambos cumplidos → `true` (R4); caso límite exacto (`>=` en ambas condiciones).

- [ ] **T4. [P]** `lib/config/webhook.ts`: añade `WEBHOOK_PAUSA_FALLOS_MINIMOS` (default 3),
  `WEBHOOK_PAUSA_VENTANA_MS` (env en minutos, default 30, convertido a ms) y
  `WEBHOOK_PAUSA_INTERVALO_MS` (default 3_600_000) a `WebhookConfig`/`loadWebhookConfig` (design
  §2.3).
  Depende de: nada. **Hecho cuando:** `tests/unit/config/webhook-config.test.ts` (extendido o
  nuevo) prueba default sin env, override por env, y valor inválido → default. Cubre R8.

## Fase 2 — Repositorio

- [ ] **T5.** `lib/interfaces/repositories/IWebhookSuscripcionRepository.ts`: añade
  `registrarEntregaOk`, `incrementarFalloYLeer` (design §2.2) — **no** hay un tercer método de
  "pausar" ni "desactivar"; extiende `WebhookSuscripcionVista` con `pausada`/`sinExitoDesde`
  (design §7). Actualiza cualquier doble/fake de test que implemente esta interfaz.
  Depende de: T1. **Hecho cuando:** el proyecto tipa en verde (`tsc`) y el doble de test queda
  con los 2 métodos nuevos implementados de forma mínima (la lógica real la prueba T6).

- [ ] **T6.** `lib/repositories/WebhookSuscripcionRepository.ts`: implementa los 2 métodos
  nuevos (atómicos vía `update`/`increment` de Prisma); extiende `upsertByOwner`/
  `actualizarUrlByOwner` para resetear las 2 columnas en cada llamada (design §2.2); `findByOwner`
  calcula `pausada` con `estaPausada()` (T3) usando la config vigente (T4) y selecciona
  `sinExitoDesde`.
  Depende de: T3, T4, T5. **Hecho cuando:**
  `tests/integration/repositories/webhook-suscripcion-repository.test.ts` (extendido) cubre:
  éxito resetea (R2), fallo incrementa y devuelve el estado post-incremento (R3), reactivar
  (`upsertByOwner`/`actualizarUrlByOwner`) limpia las 2 columnas (R7), y `findByOwner` refleja
  `pausada: true/false` según el reloj inyectado (R1, R18 a nivel de datos).

## Fase 3 — El circuito en el service y en la cola

- [ ] **T7. [P]** `lib/interfaces/external/IWebhookSender.ts` + `lib/clients/webhook-sender.ts`:
  `WebhookOutcome.transitorio` gana `retryAfterMs?: number`; `entregar` parsea `Retry-After` en
  429 (segundos y fecha HTTP), con `now` inyectable en `WebhookSenderOpts` (design §6).
  Depende de: nada. **Hecho cuando:** `tests/unit/clients/webhook-sender.test.ts` (extendido)
  cubre: 429 + `Retry-After: <segundos>`, 429 + `Retry-After: <fecha HTTP>`, 429 sin cabecera,
  429 con cabecera ilegible (cae a `undefined`, no revienta). Cubre R14, R15.

- [ ] **T8.** `lib/services/WebhookEstadoService.ts`: `WebhookEntregaFallidaError` gana
  `retryAfterMs?: number`; `ejecutar` llama a `registrarEntregaOk` en éxito y a
  `incrementarFalloYLeer` + `estaPausada` en fallo (design §2.1), calcula el `retryAfterMs`
  final (intervalo de pausa si `estaPausada()`, si no el del 429 si lo hubiera), excluye
  explícitamente `WebhookSecretKeyError`/payload inválido del conteo (R3, última frase), y
  llama a `notificarPausa` (T10) cuando corresponda, sin lógica de detección de transición
  (design §4 — la idempotencia la da el `entidadId` por racha, no el service). Constructor gana
  el 7º parámetro `notificarPausa` con default `notificadorNoOp` (T10).
  Depende de: T6, T7, T10 (tipo del notificador). **Hecho cuando:**
  `tests/unit/services/webhook-estado-service.test.ts` (extendido) cubre: R2 (incluye "sale de
  pausa"), R3 (incluida la exclusión de `WebhookSecretKeyError`), R4 (cruza umbral+ventana →
  `retryAfterMs` = intervalo de pausa y se llama al notificador), R6 (fallos insuficientes o
  ventana no cumplida → `retryAfterMs` sin el intervalo de pausa), R5 (nada en el test toca
  `activa`), y que ni el log ni la notificación contienen URL/secreto (R13).

- [ ] **T9.** `lib/services/JobQueueService.ts`: hook genérico `retryAfterMs` (design §6) —
  `drenar` extrae el hint del `err` capturado y lo pasa a `manejarFallo`, que calcula
  `max(backoffGenerico, min(hint, JOBS_BACKOFF_CAP_MS))`.
  Depende de: nada (independiente de T8 en código, pero su test usa `WebhookEntregaFallidaError`
  como ejemplo real, tanto para el caso 429 como para el caso pausa). **Hecho cuando:**
  `tests/unit/services/job-queue-service.test.ts` (extendido) cubre: sin hint → comportamiento
  actual sin cambios; con hint menor que el backoff genérico → se usa el genérico; con hint
  mayor (429 grande o intervalo de pausa de 1h) → se usa el hint acotado a
  `JOBS_BACKOFF_CAP_MS` (R17); 5 fallos 429 seguidos siguen terminando en `failed` (R16).

## Fase 4 — Aviso

- [ ] **T10.** `lib/notificaciones/emitir.ts`: `WebhookSuscripcionPausadaContexto` +
  `emitirWebhookSuscripcionPausada` (design §5), entidad sintética
  `"${ownerUsuarioId}:${sinExitoDesde.toISOString()}"`, destinatario `{tipo:"rol",
  rol:"maestro"}`, `tipo: "warning"`, texto sin URL/secreto y sin la palabra "desactiv" (R9,
  R13).
  Depende de: T2. **Hecho cuando:** test unitario de `emitir.ts` (junto a los de
  `emitirGastoFijoCobroPendiente`/`emitirMensajeroBloqueado`) verifica la forma exacta de la
  fila, que el texto no contiene "desactiv" en ninguna forma, y que dos `sinExitoDesde`
  distintos producen `entidadId` distintos mientras que el mismo `sinExitoDesde` producen el
  mismo (R12).

- [ ] **T11.** `lib/notificaciones/notificadores.ts`:
  `notificarWebhookSuscripcionPausadaCon`/`...Real`, mismo patrón `emitirBestEffort` que los 8
  notificadores existentes (design §5).
  Depende de: T10. **Hecho cuando:** `tests/unit/services/notificacion-notificadores-reales.test.ts`
  (extendido) verifica que el camino `Real` escribe una fila vía `INotificacionRepository.crear`
  (R9, R10), que dos llamadas con el MISMO `sinExitoDesde` producen una sola fila (la segunda
  absorbe el `P2002` sin lanzar — R12, primera frase), y que un repo que lanza NO propaga el
  error (R11).

- [ ] **T12.** `lib/services/jobs/webhook-estado-handler.ts`: `buildWebhookEstadoService` inyecta
  `notificarWebhookSuscripcionPausadaReal` como composition root (design §5).
  Depende de: T8, T11. **Hecho cuando:** el handler de producción queda cableado; test de
  wiring (o extensión del existente de `procesar-jobs/route.ts`) confirma que la construcción
  real no lanza sin `WEBHOOK_SECRET_ENC_KEY`, igual que hoy (no-regresión).

## Fase 5 — Visibilidad en la UI existente

- [ ] **T13.** `lib/interfaces/services/IWebhookSuscripcionService.ts`
  (`WebhookSuscripcionVistaDTO`), `lib/services/WebhookSuscripcionService.ts` (`obtener`),
  `lib/types/webhook.ts` (`ObtenerWebhookActionResult`), `lib/actions/webhooks.ts`
  (`obtenerWebhook`): passthrough de `pausada`/`sinExitoDesde` (design §7).
  Depende de: T6. **Hecho cuando:** `tests/unit/services/webhook-suscripcion-service.test.ts` y
  `tests/unit/actions/webhooks-action.test.ts` (ambos extendidos) verifican que los 2 campos
  llegan intactos hasta el resultado de la Server Action, y que `obtenerWebhook` sigue sin
  exponer el secreto. Cubre R18.

- [ ] **T14.** `app/(app)/configuracion/api/_components/WebhookAccionCell.tsx`: tipo
  `WebhookEstado` gana `pausada`/`sinExitoDesde`; línea adicional (independiente de la rama
  `activa`/`no hay webhook`) cuando `pausada === true` (design §7). Sin botones nuevos: "Guardar
  URL"/"Registrar" ya existente es la vía manual de salida.
  Depende de: T13. **Hecho cuando:** `tests/components/WebhookAccionCell.test.tsx` (extendido)
  verifica que el texto aparece cuando `pausada: true` (y que NO dice "desactiv" en ninguna
  forma), y que tras "Guardar URL" (el flujo ya existente) el aviso desaparece al refrescar sin
  recargar la página (R19).

## Fase 6 — Cierre

- [ ] **T15.** Actualizar `progress/impl_403-webhook-destino-que-falla-siempre.md` con el mapa
  R→test final (el implementer lo escribe al terminar, per `docs/specs.md`).
  Depende de: T1–T14. **Hecho cuando:** cada `R1`–`R19` de `requirements.md` aparece con al
  menos un test real y en verde; ningún requisito queda sin test (gate del reviewer); ninguna
  cadena de texto "desactiv" queda en el código de producción de esta feature (grep de
  guardia manual antes de cerrar).

## Paralelismo

- T1 y T2 son independientes entre sí (migraciones separadas, motivo en design §1.2) — `[P]`.
- T3 y T4 son independientes entre sí y de la fase 0 — `[P]`.
- T7 es independiente de T3/T4/T5/T6 (toca el cliente HTTP, no el repositorio) — `[P]` respecto
  a la fase 2.
- T8 depende de T6 (repo), T7 (sender) y T10 (tipo del notificador, aunque el wiring real es
  T12); puede escribirse con un notificador `notificadorNoOp` mientras T9-T11 avanzan en
  paralelo.
- T10/T11 pueden empezar en paralelo con la fase 3 (solo dependen de T2).
- T13/T14 (fase 5) son la única cadena que toca `app/`; puede ir en paralelo a la fase 4 una vez
  cerrada T6.
