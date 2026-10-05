# 474 — Envíos automáticos por WhatsApp — tasks

> Requisitos: `requirements.md` (R1–R47). Diseño: `design.md` (§ citadas abajo).
> Zona `fullstack`: se secuencia **backend (F0–F9) → frontend (F10)**. `[P]` = paralelizable con las
> demás `[P]` de su misma fase (no comparten archivos). Cada task = un commit `feat(474): …` / `test(474): …`.
> La pantalla de envíos (T10.3) NO empieza sin la maqueta de /design en `design-whatsapp/`.

## F0 — Arranque

- [ ] **T0.1** Partir de `origin/dev` actualizado (`checkout --detach` + `merge-base` con el SHA que dé el
  leader) y leer la lista ACTUAL de `job_tipo` en `db/schema.prisma` (otra ficha pudo añadir valores).
  **Hecho:** SHA anotado en `progress/impl_474.md` y lista de `job_tipo` copiada allí.

## F1 — Base de datos (design §1)

- [ ] **T1.1** Migración `<ts>_job_tipo_whatsapp_envios`: `ADD VALUE IF NOT EXISTS` de
  `whatsapp_envio_programado`, `whatsapp_envio_ejecucion`, `whatsapp_envio_reintento`,
  `whatsapp_envio_mantenimiento`. `down.sql` calcado de `20260923120000_job_tipo_webhook_evento/down.sql`
  con la lista de T0.1 (índice parcial de la 401 incluido). No tocar `down.sql` previos.
  **Hecho:** `prisma migrate deploy` local OK; `pnpm run db:rollback` + re-deploy OK.
  _Depende de T0.1._
- [ ] **T1.2** Migración `<ts+1>_whatsapp_envios`: enums `whatsapp_envio_disparo`, `whatsapp_envio_origen`,
  `whatsapp_ejecucion_estado`, `whatsapp_entrega_estado`; tablas §1.2–§1.5 con CHECKs, FKs, índices
  (incluidos los únicos PARCIALES de idempotencia y el de `wa_message_id`) y RLS habilitada sin policies;
  columnas `informe_clave` y `lleva_documento` en `plantilla_mensaje` con sus dos CHECKs (§1.1).
  `down.sql` que revierte exactamente. **Hecho:** deploy + rollback + deploy limpios.
  _Depende de T1.1._
- [ ] **T1.3** Migración `<ts+2>_seed_whatsapp_envio_mantenimiento`: INSERT del job recurrente con
  `ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING` (§1.6); `down.sql` borra las filas de
  ese tipo. **Hecho:** tras deploy hay exactamente 1 fila pendiente; re-ejecutar el INSERT no añade otra.
  _Depende de T1.1._
- [ ] **T1.4** `db/schema.prisma`: modelos y enums nuevos, valores de `JobTipo`, columnas de
  `PlantillaMensaje`; los únicos parciales como `@@unique`/`@@index` con `map:` al nombre real (precedente
  `analytics_daily`) para que `migrate dev` no proponga borrarlos. **Hecho:** `prisma migrate diff`
  entre migraciones y schema = vacío; `prisma generate` OK; typecheck verde.
  _Depende de T1.2, T1.3._
- [ ] **T1.5** `tests/integration/db/whatsapp-envios-migration.test.ts` (+ CHECKs de plantilla, R3/R6
  estructural; R15 default `activo = false`). **Hecho:** verde; matado con una mutación (quitar un
  predicado de índice parcial ⇒ rojo) anotada en `impl_474.md`. _Depende de T1.4._

## F2 — Reglas puras (design §6, §3, §5.1) — todas `[P]`, dependen de T1.4

- [ ] **T2.1** [P] `lib/whatsapp-envios/proxima-ocurrencia.ts` + test (R20, R22): cruces de día, domingo→lunes,
  hora ya pasada hoy, `desde` exacto en el instante. **Hecho:** test verde.
- [ ] **T2.2** [P] `lib/whatsapp-envios/sanear-valor.ts` + test (R32). **Hecho:** verde.
- [ ] **T2.3** [P] `lib/whatsapp-envios/motivo-meta.ts` + test (R45: código mapeado, no mapeado, `null`;
  nunca devuelve el `detalle` crudo). **Hecho:** verde.
- [ ] **T2.4** [P] `lib/whatsapp-envios/telefono.ts` (`telefonoValido`, `enmascararTelefono`) + test (R29,
  R42). **Hecho:** verde con `""`, 7, 8, 11 dígitos, `+1…`.
- [ ] **T2.5** [P] `construirComponentsTemplate`/`construirComponentsEnvio` con `opts` (§5.1) + test de
  HEADER/header documento y **no regresión con el literal actual** sin `opts` (R5, R33). **Hecho:** verde;
  los tests existentes de `whatsapp-template` intactos.

## F3 — Contrato y catálogo de informes (design §2)

- [ ] **T3.1** `lib/whatsapp-envios/informes/tipos.ts` (contrato §2), `catalogo.ts` (registro),
  `lib/whatsapp-envios/eventos.ts` (catálogo vacío, inyectable) y `catalogoDeVariables(informeClave)`
  (§3) + `unit/whatsapp-envios/catalogo-informes.test.ts` (R46, recorre el catálogo REAL) y
  `catalogo-de-variables.test.ts` (R4). **Hecho:** verde. _Depende de T1.4._
- [ ] **T3.2** Informe `prueba_envio` (§2.1, jspdf) registrado + test (R47: variables CR, PDF no vacío y
  con cabecera `%PDF`, `simularVacio` ⇒ vacío). **Hecho:** verde. _Depende de T3.1._

## F4 — Clientes externos y almacén — `[P]` entre sí

- [ ] **T4.1** [P] `lib/clients/whatsapp-subida-reanudable.ts` (§5.2) + `WHATSAPP_APP_ID` opcional en
  `lib/config/whatsapp.ts` + test con `fetch` inyectado (2 pasos, error de Meta, timeout; el token nunca en
  URL ni en el error). **Hecho:** verde.
- [ ] **T4.2** [P] `lib/storage/SupabaseAlmacenEnviosWhatsapp.ts` + `lib/config/whatsapp-envios.ts` (bucket,
  retención, ventana) + test (R43: `upsert: false`, ruta `<envioId>/<ejecucionId>.pdf`, bucket creado
  privado en el primer uso, `borrar` propaga error). **Hecho:** verde.

## F5 — Plantillas (design §3, §5.1)

- [ ] **T5.1** Schemas zod + `PlantillaMensajeService` (R3, R6, R7, R8 bienvenida, R9, R10 con dependencia
  opcional) + `WhatsappTemplatePort` (ejemplos del informe + handle) + tests. **Hecho:** tests nuevos
  verdes y la suite existente de plantillas sin cambios. _Depende de T2.5, T3.1, T4.1._
- [ ] **T5.2** `PlantillaMensajeRepository`: `listarEnviables`, `listarUsablesParaTexto` y el lector del
  chat excluyen `informe_clave IS NOT NULL`; nuevo `findEnviableDeInformeById` + int
  `plantilla-enviables-excluye-informe.test.ts` (R8). **Hecho:** verde y matado por mutación. _Depende de T1.4._
- [ ] **T5.3** `buildPlantillaService` (`lib/actions/plantillas.ts`) inyecta el lector de envíos de R10 y
  el cliente de T4.1; test estático de que el composition root lo PASA. **Hecho:** verde. _Depende de T5.1, T6.1._

## F6 — Repositorios (design §1, §4) — integración contra Postgres

- [ ] **T6.1** `WhatsappEnvioRepository` (CRUD, destinatarios, `resolverDestinatarios`,
  `nombresEncendidosConPlantilla`, encendidos con evento, encendidos sin job pendiente) + int
  `whatsapp-envio-resolver-destinatarios.test.ts` (R17/R28: rol ∪ usuario, solo `activo`, dedup, excluye
  `adminTienda`/`apiKey`) y `whatsapp-envio-cadena-rota.test.ts` (R25). **Hecho:** verdes, cada uno matado
  por una mutación del WHERE. _Depende de T1.4._
- [ ] **T6.2** `WhatsappEjecucionRepository` (insertar ejecución con `ON CONFLICT DO NOTHING` por origen,
  fijar contenido, entregas con `ON CONFLICT`, reclamo condicional, estados por `wa_message_id` con rango,
  historial enmascarado, última prueba, selección de purga) + int
  `whatsapp-envio-idempotencia-programado.test.ts` (R23, concurrente con `Promise.all`),
  `whatsapp-envio-idempotencia-evento.test.ts` (R27), `whatsapp-envio-entrega-reclamo.test.ts` (R37),
  `whatsapp-envio-entrega-estado-webhook.test.ts` (R38), `whatsapp-envio-historial.test.ts` (R42),
  `whatsapp-envio-prueba-limite.test.ts` (R41), `whatsapp-envio-purga-seleccion.test.ts` (R44).
  **Hecho:** todos verdes con filas sembradas (ningún `if (!x) return`) y matados por mutación.
  _Depende de T1.4. [P] con T6.1._

## F7 — Services (design §4, §5.4)

- [ ] **T7.1** [P] `WhatsappEnvioService` (R1, R11–R21; encender/guardar encola la ocurrencia) +
  `previsualizarDestinatarios` (R17) + tests. **Hecho:** verde. _Depende de T2.1, T2.4, T3.1, T6.1._
- [ ] **T7.2** [P] `EjecucionEnvioService` (§4.3, R28–R37, R39–R41, R45) + tests con dobles (incluido
  `ejecucion-envio-sin-pii.test.ts`). **Hecho:** verde. _Depende de T2.2–T2.5, T3.2, T4.2, T6.2._
- [ ] **T7.3** [P] `DisparadorEnviosWhatsapp` (§4.2, R26/R27) con catálogo de eventos inyectado + test con
  un evento de prueba. **Hecho:** verde. _Depende de T6.2._
- [ ] **T7.4** [P] `EntregaEstadoService` (§5.4, R38) + test. **Hecho:** verde. _Depende de T6.2._

## F8 — Jobs y cableado (design §4.1, §5.4)

- [ ] **T8.1** Handlers `whatsapp-envio-programado`, `-ejecucion`, `-reintento`, `-mantenimiento`
  (+ `RecurrenciaSpec` 03:30 CR del mantenimiento) en `lib/services/jobs/` + tests (R19–R22, R24, R25,
  R36, R44). **Hecho:** verde. _Depende de T7.1, T7.2._
- [ ] **T8.2** Registro en `app/api/cron/procesar-jobs/route.ts` (`buildHandlers` + `buildRecurrencias`
  solo para mantenimiento) + test de registro (R22). **Hecho:** verde. _Depende de T8.1._
- [ ] **T8.3** Webhook: `EntregaEstadoService` tras `ingerirEventos`, inyectable en `WebhookDeps`; test de
  cableado y de que un fallo suyo no cambia el 200 (R38). **Hecho:** verde y los tests existentes del
  webhook sin cambios. _Depende de T7.4. [P] con T8.1._

## F9 — Server actions (design §7)

- [ ] **T9.1** `lib/actions/envios-whatsapp.ts` (todas las de §7, zod en el borde, `forbidden`/no
  autenticado antes de tocar el service) + tests de acción (R1, R39–R41, R43). **Hecho:** verde.
  _Depende de T7.1, T7.2, T4.2._
- [ ] **T9.2** Gate de backend: `./init.sh --rapido` verde (o el completo si lo exige por tocar
  migraciones/`schema.prisma`, que es lo esperado). Revisar `skipped` de `integration/db`, no solo el exit.
  **Hecho:** log en `progress/gate_474_backend.log` con `INIT_EXIT=` dentro. _Depende de F1–F9._

## F10 — Frontend (tras T9.2)

- [ ] **T10.1** [P] Plantillas: tipo «de orden / de informe», switch «Lleva documento adjunto» con sus
  bloqueos (R6/R7), picker y vista previa por catálogo (R4), sin «plantilla de tienda» ni «bienvenida»
  en las de informe (R8), mensajes `no_configurado` (R9) y `en_uso` (R10) + tests de componente.
  **Hecho:** verde.
- [ ] **T10.2** [P] Menú: «Envíos automáticos» al final de «Configuración» + test (R2).
  **Hecho:** verde; `destino-post-login.test.ts` intacto.
- [ ] **T10.3** Página `/configuracion/envios-whatsapp` según la maqueta de `design-whatsapp/`: lista con
  interruptor y próximo envío/aviso (R25), formulario con parámetros por descriptores, disparo y
  destinatarios con avisos (R11–R18), Probar ahora (R39–R41), historial con detalle y PDF (R42–R44) +
  tests de componente. **Hecho:** verde. _Depende de la maqueta y de T9.1._
- [ ] **T10.4** Ver la app (Playwright manual, receta de la memoria): crear plantilla de informe con
  documento, crear envío, ver avisos de teléfono, Probar ahora con WhatsApp no configurado en local
  (error visible en historial, no silencio). **Hecho:** capturas y hallazgos en `progress/impl_474.md`.
  _Depende de T10.1–T10.3._

## F11 — Cierre

- [ ] **T11.1** `progress/impl_474.md`: mapa R1–R47 → test (design §10), mutaciones aplicadas a los
  tests de integración y su resultado. **Hecho:** los 47 R con test que existe en el árbol.
- [ ] **T11.2** Gate completo `./init.sh` (toca migraciones) + `gh pr checks` del build de Vercel antes de
  mergear. **Hecho:** ambos verdes.
- [ ] **T11.3** Nota de release (design §12): `WHATSAPP_APP_ID` por entorno, verificación en producción con
  «Prueba de envío», y recordatorio de que el sistema externo se apaga ANTES de encender envíos aquí.
  **Hecho:** nota en `docs/release.md` o en el PR.
