# 474 — Envíos automáticos por WhatsApp — tasks

> Requisitos: `requirements.md` (R1–R53). Diseño: `design.md` (§ citadas abajo).
> Zona `fullstack`: se secuencia **backend (F0–F9) → frontend (F10)**. `[P]` = paralelizable con las
> demás `[P]` de su misma fase (no comparten archivos). Cada task = un commit `feat(474): …` / `test(474): …`.
> **Enmienda 2026-10-05** (D1–D4 y maquetas aprobadas): tasks nuevas T2.6, T3.3, T4.3, T7.3 (reescrita),
> T8.4, T11.4; cambian T0.1, T1.1, T1.2, T3.1, T4.1, T5.1, T5.3, T6.1, T8.1, T8.2, T9.1, T10.1, T10.3,
> T11.1, T11.3. La pantalla (T10.3) se construye sobre la maqueta APROBADA de `design-whatsapp/`.

## F0 — Arranque

- [ ] **T0.1** Partir de `origin/dev` actualizado (`checkout --detach` + `merge-base` con el SHA que dé el
  leader; el spec se enmendó contra `c53a4cc7`) y leer la lista ACTUAL de `job_tipo` y de
  `NotificacionEvento` en `db/schema.prisma` (otra ficha pudo añadir valores: si hay un evento nuevo,
  §2.2 necesita su entrada antes de compilar).
  **Hecho:** SHA anotado en `progress/impl_474.md` con las dos listas copiadas allí.

## F1 — Base de datos (design §1)

- [ ] **T1.1** Migración `<ts>_job_tipo_whatsapp_envios`: `ADD VALUE IF NOT EXISTS` de
  `whatsapp_envio_programado`, `whatsapp_envio_evento`, `whatsapp_envio_ejecucion`,
  `whatsapp_envio_reintento`, `whatsapp_envio_mantenimiento`. `down.sql` calcado de
  `20260923120000_job_tipo_webhook_evento/down.sql` con la lista de T0.1 (índice parcial de la 401
  incluido). No tocar `down.sql` previos.
  **Hecho:** `prisma migrate deploy` local OK; `pnpm run db:rollback` + re-deploy OK.
  _Depende de T0.1._
- [ ] **T1.2** Migración `<ts+1>_whatsapp_envios`: enums `whatsapp_envio_disparo`, `whatsapp_envio_origen`,
  `whatsapp_ejecucion_estado`, `whatsapp_entrega_estado`; tablas §1.2–§1.5 con CHECKs, FKs, índices
  (incluidos los únicos PARCIALES de idempotencia, el de `wa_message_id` y el parcial por `evento_clave`
  que usa el puente), columnas `evento_datos` y `notificacion_id` (sin FK) en la ejecución, y RLS
  habilitada sin policies; columnas `informe_clave` y `lleva_documento` en `plantilla_mensaje` con sus
  dos CHECKs (§1.1). `down.sql` que revierte exactamente. **Hecho:** deploy + rollback + deploy limpios.
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
- [ ] **T2.6** [P] `lib/whatsapp-envios/eventos.ts` (`EVENTOS_ENVIO_WHATSAPP` `satisfies
  Record<NotificacionEvento, PerfilEventoEnvio>`, §2.2: diez disponibles con nombre, descripción y
  `ejemploTexto` importado de `emitir.ts`; ocho no disponibles con `porQue`) y `filaPuenteable` (§6.6) +
  `unit/whatsapp-envios/eventos-envio.test.ts` y `fila-puenteable.test.ts` (R49, R50: las 18 entradas;
  ningún nombre con «SLA» ni «reprogramadas»). **Hecho:** verde; quitar una entrada del objeto rompe el
  typecheck (anotado en `impl_474.md`).

## F3 — Contrato y catálogo de informes (design §2)

- [ ] **T3.1** `lib/whatsapp-envios/informes/tipos.ts` (contrato §2, con `DatosAviso`, `evento` y
  `eventoDePrueba` en el contexto), `catalogo.ts` (registro) y `catalogoDeVariables(informeClave)` (§3,
  con la común `destinatario_nombre` de §2.4) + `unit/whatsapp-envios/catalogo-informes.test.ts` (R46,
  recorre el catálogo REAL; ningún informe declara `destinatario_nombre`; `eventos` ⊆ disponibles) y
  `catalogo-de-variables.test.ts` (R4, R53). **Hecho:** verde. _Depende de T1.4, T2.6._
- [ ] **T3.2** Informe `prueba_envio` (§2.1, jspdf) registrado + test (R47: variables CR, PDF no vacío y
  con cabecera `%PDF`, `simularVacio` ⇒ vacío). **Hecho:** verde. _Depende de T3.1._
- [ ] **T3.3** [P con T3.2] Informe `aviso_interno` «Aviso de la app» (§2.3) registrado + 
  `unit/whatsapp-envios/informe-aviso-interno.test.ts` (R51: `titulo`, `texto`, `enlace` con atajo /
  sin atajo / sin base URL, `fecha`, `hora` CR; `DatosAviso` sin anexo con `@ts-expect-error`; R52:
  `eventoDePrueba` usa el ejemplo del catálogo; hora fija sin evento ⇒ `vacio`). **Hecho:** verde.
  _Depende de T3.1._

## F4 — Clientes externos y almacén — `[P]` entre sí

- [ ] **T4.3** [P] `lib/clients/whatsapp-app-id.ts` — `ResolutorAppIdMeta` (§5.2.1): anulación por
  `WHATSAPP_APP_ID`, caché de proceso solo del éxito, `GET <GRAPH_BASE>/<apiVersion>/app` con
  `Authorization: Bearer` (misma base y versión que `whatsapp-cloud.ts`), timeout 10 s, `id` numérico +
  `unit/clients/whatsapp-app-id.test.ts` con `fetch` doble: **éxito** (y segunda llamada sin fetch),
  **anulación por env** (cero fetch), **fallo** (400, red, timeout, id no numérico → `ok: false`; no se
  cachea). En ningún caso el token aparece en la URL, en el resultado ni en el log. **Hecho:** verde (R48).
- [ ] **T4.1** [P] `lib/clients/whatsapp-subida-reanudable.ts` (§5.2), que recibe el `appId` ya resuelto
  (no lee env), + test con `fetch` inyectado (2 pasos, error de Meta, timeout; el token nunca en URL ni
  en el error). **Hecho:** verde.
- [ ] **T4.2** [P] `lib/storage/SupabaseAlmacenEnviosWhatsapp.ts` + `lib/config/whatsapp-envios.ts` (bucket,
  retención 30, ventana 60, base URL del `enlace`) + test (R43: `upsert: false`, ruta
  `<envioId>/<ejecucionId>.pdf`, bucket creado privado en el primer uso, `borrar` propaga error).
  **Hecho:** verde.

## F5 — Plantillas (design §3, §5.1)

- [ ] **T5.1** Schemas zod + `PlantillaMensajeService` (R3, R6, R7, R8 bienvenida, R10 con dependencia
  opcional; **R9 enmendado**: resolutor `no_resuelto` / credencial ausente → `documento_no_disponible`
  con el texto de §3 y sin cambiar estado) + `WhatsappTemplatePort` (ejemplos del informe + handle) +
  tests, incluido `plantilla-enviar-aprobacion-sin-app-id.test.ts`. **Hecho:** tests nuevos verdes y la
  suite existente de plantillas sin cambios. _Depende de T2.5, T3.1, T4.1, T4.3._
- [ ] **T5.2** `PlantillaMensajeRepository`: `listarEnviables`, `listarUsablesParaTexto` y el lector del
  chat excluyen `informe_clave IS NOT NULL`; nuevo `findEnviableDeInformeById` + int
  `plantilla-enviables-excluye-informe.test.ts` (R8). **Hecho:** verde y matado por mutación. _Depende de T1.4._
- [ ] **T5.3** `buildPlantillaService` (`lib/actions/plantillas.ts`) inyecta el lector de envíos de R10,
  el `ResolutorAppIdMeta` y el cliente de T4.1; acción `estadoAppMeta` (R48, maestro); test estático de
  que el composition root PASA las tres dependencias (no solo que las importa). **Hecho:** verde.
  _Depende de T5.1, T6.1._

## F6 — Repositorios (design §1, §4) — integración contra Postgres

- [ ] **T6.1** `WhatsappEnvioRepository` (CRUD, destinatarios, `resolverDestinatarios`,
  `nombresEncendidosConPlantilla`, `hayEncendidosConEvento` y `encendidosConEvento` sobre el índice
  parcial, encendidos sin job pendiente) + int `whatsapp-envio-resolver-destinatarios.test.ts`
  (R17/R28: rol ∪ usuario, solo `activo`, dedup, incluye `adminTienda`, excluye `apiKey`) y
  `whatsapp-envio-cadena-rota.test.ts` (R25). **Hecho:** verdes, cada uno matado por una mutación del
  WHERE. _Depende de T1.4._
- [ ] **T6.2** `WhatsappEjecucionRepository` (insertar ejecución con `ON CONFLICT DO NOTHING` por origen,
  incluida la de evento con `evento_datos`/`notificacion_id`, fijar contenido, entregas con
  `ON CONFLICT`, reclamo condicional, estados por `wa_message_id` con rango, historial enmascarado,
  última prueba, selección de purga) + int `whatsapp-envio-idempotencia-programado.test.ts` (R23,
  concurrente con `Promise.all`), `whatsapp-envio-idempotencia-evento.test.ts` (R27),
  `whatsapp-envio-entrega-reclamo.test.ts` (R37), `whatsapp-envio-entrega-estado-webhook.test.ts` (R38),
  `whatsapp-envio-historial.test.ts` (R42), `whatsapp-envio-prueba-limite.test.ts` (R41),
  `whatsapp-envio-purga-seleccion.test.ts` (R44).
  **Hecho:** todos verdes con filas sembradas (ningún `if (!x) return`) y matados por mutación.
  _Depende de T1.4. [P] con T6.1._

## F7 — Services y puente (design §4, §5.4)

- [ ] **T7.1** [P] `WhatsappEnvioService` (R1, R11–R21 con R14 y R16 enmendados; encender/guardar encola
  la ocurrencia) + `previsualizarDestinatarios` (R17) + tests. **Hecho:** verde.
  _Depende de T2.1, T2.4, T2.6, T3.1, T6.1._
- [ ] **T7.2** [P] `EjecucionEnvioService` (§4.3, R28–R37, R39–R41, R45, R52, R53) + tests con dobles
  (incluido `ejecucion-envio-sin-pii.test.ts`). **Hecho:** verde. _Depende de T2.2–T2.5, T3.2, T3.3, T4.2, T6.2._
- [ ] **T7.3** [P] Decorador `conEnviosWhatsapp` (`lib/notificaciones/notificacion-repo-con-envios-whatsapp.ts`,
  §4.2, molde `conPushWeb`): pasos 1–5, `emitirBestEffort("envios_whatsapp_evento", …)`, delegación pura
  del resto de `INotificacionRepository` + `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts`
  (R26 con dobles, R50 completo, R51 payload sin anexo). **Hecho:** verde. _Depende de T2.6, T6.1._
- [ ] **T7.4** [P] `EntregaEstadoService` (§5.4, R38) + test. **Hecho:** verde. _Depende de T6.2._

## F8 — Jobs y cableado (design §4.1, §4.2, §5.4)

- [ ] **T8.1** Handlers `whatsapp-envio-programado`, `-evento`, `-ejecucion`, `-reintento`,
  `-mantenimiento` (+ `RecurrenciaSpec` 03:30 CR del mantenimiento) en `lib/services/jobs/` + tests
  (R19–R22, R24, R25, R27, R36, R44). **Hecho:** verde. _Depende de T7.1, T7.2._
- [ ] **T8.2** Registro en `app/api/cron/procesar-jobs/route.ts` (`buildHandlers` con los cinco +
  `buildRecurrencias` solo para mantenimiento) + test de registro (R22). **Hecho:** verde. _Depende de T8.1._
- [ ] **T8.3** Webhook: `EntregaEstadoService` tras `ingerirEventos`, inyectable en `WebhookDeps`; test de
  cableado y de que un fallo suyo no cambia el 200 (R38). **Hecho:** verde y los tests existentes del
  webhook sin cambios. _Depende de T7.4. [P] con T8.1._
- [ ] **T8.4** Cableado del puente en el composition root: `repoReal()` de `lib/notificaciones/notificadores.ts`
  envuelve con `conEnviosWhatsapp` por fuera de `conPushWeb` (§4.2). Guardia
  `tests/unit/guards/envios-whatsapp-cableado.guardia.test.ts` (estática) y
  **int `tests/integration/db/whatsapp-envio-puente-aviso.test.ts`** (R26): emitir por
  `notificarGeocodificacionCaidaReal` con un envío ENCENDIDO por `geocodificacion_caida` ⇒ exactamente
  UN job `whatsapp_envio_evento`; con el envío APAGADO ⇒ cero; re-emitir la misma jornada ⇒ sigue uno.
  `push-cableado-unico.guardia.test.ts` y los tests de notificadores existentes, intactos.
  **Hecho:** verdes; las dos mutaciones de §10/R26 (quitar el decorador de `repoReal()`; quitar `activo`
  del WHERE) ponen rojo el test de integración, anotado en `impl_474.md`. _Depende de T7.3, T8.1._

## F9 — Server actions (design §7)

- [ ] **T9.1** `lib/actions/envios-whatsapp.ts` (todas las de §7, incluida `listarEventosDisponibles`, zod
  en el borde, `forbidden`/no autenticado antes de tocar el service) + tests de acción (R1, R39–R41,
  R43, R49). **Hecho:** verde. _Depende de T7.1, T7.2, T4.2._
- [ ] **T9.2** Gate de backend: `./init.sh --rapido` verde (o el completo si lo exige por tocar
  migraciones/`schema.prisma`, que es lo esperado). Revisar `skipped` de `integration/db`, no solo el exit.
  **Hecho:** log en `progress/gate_474_backend.log` con `INIT_EXIT=` dentro. _Depende de F1–F9._

## F10 — Frontend (tras T9.2)

- [ ] **T10.1** [P] Plantillas: tipo «de orden / de informe», switch «Lleva documento adjunto» con sus
  bloqueos (R6/R7), picker y vista previa por catálogo con la común `destinatario_nombre` (R4, R53), sin
  «plantilla de tienda» ni «bienvenida» en las de informe (R8), resultados `documento_no_disponible`
  (R9) y `en_uso` (R10), y el aviso de app de Meta no identificada bajo el switch llamando a
  `estadoAppMeta` (R48) + tests de componente (incluido `plantillas-aviso-app-meta.test.tsx`).
  **Hecho:** verde.
- [ ] **T10.2** [P] Menú: «Envíos automáticos» al final de «Configuración» + test (R2).
  **Hecho:** verde; `destino-post-login.test.ts` intacto.
- [ ] **T10.3** Página `/configuracion/envios-whatsapp` construida sobre la **maqueta APROBADA** de
  `design-whatsapp/` (`Main.dc.html`, `Formulario.dc.html`, `Historial.dc.html`, `Vacio.dc.html`,
  `ListaMovil.dc.html`, `FormularioMovil.dc.html`), con la correspondencia de design §7: lista con
  interruptor y próximo envío/aviso (R25); formulario «Qué se manda / A quién / Cuándo» con parámetros
  por descriptores, roles con conteo incluido «Admin de tienda» (R16), avisos de teléfono (R17),
  «Cuando pase algo» con el desplegable de los eventos disponibles y su nombre (R14, R49 — no el texto
  de ejemplo «Al vencer un paquete»); vista previa con «De dónde sale cada dato» (R53); Probar ahora
  (R39–R41, R52); historial con detalle, «Sin novedades» para `vacia` y PDF (R42–R44) + tests de
  componente (incluido `envios-whatsapp-formulario.test.tsx`). **Hecho:** verde, y una captura por
  pantalla de la maqueta comparada lado a lado en `progress/impl_474.md` (memoria «verificar lo que el
  usuario ve»). _Depende de T9.1._
- [ ] **T10.4** Ver la app (Playwright manual, receta de la memoria): crear plantilla de informe con
  documento (con WhatsApp no configurado en local ⇒ debe verse el aviso de R48, no silencio), crear
  envío a hora fija y otro por evento, ver avisos de teléfono, Probar ahora (error visible en historial,
  no silencio). **Hecho:** capturas y hallazgos en `progress/impl_474.md`. _Depende de T10.1–T10.3._

## F11 — Cierre

- [ ] **T11.1** `progress/impl_474.md`: mapa R1–R53 → test (design §10), mutaciones aplicadas a los
  tests de integración y su resultado. **Hecho:** los 53 R con test que existe en el árbol.
- [ ] **T11.2** Gate completo `./init.sh` (toca migraciones) + `gh pr checks` del build de Vercel antes de
  mergear. **Hecho:** ambos verdes.
- [ ] **T11.3** Nota de release (design §12): ninguna variable nueva obligatoria (D2), comprobar
  `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_SITE_URL` en Production, verificación en producción con «Prueba de
  envío» y con un envío por evento, y recordatorio de que el sistema externo se apaga ANTES de encender
  envíos aquí. **Hecho:** nota en `docs/release.md` o en el PR.
- [ ] **T11.4** Recorrido contra la API REAL de Meta (nunca se ha probado desde el repo): en el entorno
  desplegado, abrir Plantillas con «Lleva documento adjunto» y confirmar que `GET /<apiVersion>/app`
  con `WHATSAPP_CLOUD_TOKEN` identifica la app (sin aviso de R48); enviar a aprobación la plantilla de
  «Prueba de envío» con documento (ejercita la subida reanudable con ese ID). Si `/app` falla para el
  tipo de token de producción, anotar el código que muestra la pantalla y aplicar la salida de §5.2.1
  (anulación por `WHATSAPP_APP_ID`), sin tocar la invariante del token en URL.
  **Hecho:** resultado (identificada / código del fallo) y el estado de la plantilla en Meta anotados en
  `progress/impl_474.md`. _Depende de T11.2 y del despliegue._
