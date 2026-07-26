# Sesión activa

> Estado vivo de lo que se está trabajando **ahora**. El leader lo mantiene al día.
> Al cerrar una feature se limpia de aquí y se resume en `history.md`.
>
> **Dónde está el historial completo:** los PRs de GitHub, `progress/impl_*.md` / `review_*.md`
> por feature, y la narrativa de decisiones dentro de cada entrada de `feature_list.json`.
> La bitácora extensa que vivía en este archivo se puede recuperar con
> `git show <rev>:progress/current.md`.

> _Reconciliado 2026-07-21._ Se vació la tabla "Features en curso" (las 16 que figuraban estaban
> **todas mergeadas**) y se podaron ~700 líneas de notas de cierre y evaluaciones archivadas. El
> historial completo de features cerradas quedó al día en `history.md` (backfill de las 24 que
> faltaban: 61, 64, 65, 69, 72, 73, 75–78, 81–84, 86–89, 91, 93–97).

## Features en curso

### Lote 137–140 (flujo de estados) — ✅ **COMPLETO, 4/4 MERGEADAS a `dev`** (2026-07-25)

> Detalle de las 4 en `history.md`. PRs #157 (137) · #159 (138) · #160 (139) · #161 (140).
> **✅ DESPLEGADO A PROD 2026-07-25 (PR #163 `dev → prod`).** Deployment `ordenex-qzzgvlmhq` **Ready**;
> build verde en 29 s; runtime sin errores (cron `/api/cron/procesar-jobs` cada minuto, 200).
> **Migraciones APLICADAS** en la base de producción: el build corrió `prisma migrate deploy` y reportó
> `No pending migrations to apply` sobre **86 migraciones** = las 86 del repo (incluidas las 4 del lote).
> Deuda de migraciones **saldada**; también aplicadas y verificadas en la DB local.
>
> ⚠️ **Hallazgo operativo del deploy (importante para el futuro):** los **previews de Vercel usan la
> MISMA base de Supabase que producción**. Como el `build` es `prisma generate && prisma migrate deploy
> && next build`, **el build de un preview migra la base de producción**. Por eso las migraciones ya
> estaban aplicadas antes del merge a `prod`. Consecuencia: la ventana de riesgo de una migración
> no-aditiva empieza **al abrir el PR**, no al mergear — con el rename de la 137 esa ventana estuvo
> abierta desde el preview del PR #157. Para renames/destructivas futuras: patrón expand-contract o
> mergear inmediatamente tras abrir el PR.
>
> Cierre de deuda en `chore/cierre-lote-137-140`: T4.1 de la 139 saldada (test de integración del
> recorrido completo), los 2 `down.sql` que faltaban en el repo (deuda ajena de WhatsApp) escritos y
> respaldados por tests → `./init.sh` ya no avisa `migraciones sin down.sql`.

<details>
<summary>Bitácora del lote (histórico de la sesión)</summary>

#### Estado durante la sesión — 137/138/139 mergeadas; 140 en implementación

> Renumerado desde **135–138** por colisión de IDs: `dev` (merge de #155 `flow`) reclamó
> **135 = analítica-KPIs** y **136 = etiquetas-PDF**. El lote se desplazó al bloque libre 137–140.

**137 rename nomenclatura (PR #157) · 138 recepción central (PR #159) · 139 devolución de rechazadas
(PR #160) — las tres `done` y mergeadas.** Detalle de cada una en `history.md`. La 139 se reconcilió a
`done` el 2026-07-25 (figuraba `in_progress` con su PR ya mergeado).

**140 — guardia central de transiciones de `order_status` (backend, high) — EN IMPLEMENTACIÓN.**
Rama `feature/140-flujo-estados-guardia-central` desde `origin/dev`. Cierra la deuda de fondo del lote:
hoy NO existe máquina de estados central — cada service declara sus orígenes/destinos y la única guardia
real es el `WHERE estatus_id = <origen>` de cada UPDATE. El choke point `appendCambioEstado` (feature 49,
~18 call-sites) registra historial + encola webhook pero **no valida legalidad**. La 140 centraliza el
mapa (`lib/types/order-status-transiciones.ts`) y lo valida ahí.

- **Gate F1.4 APROBADO (2026-07-25), 4 decisiones:** (Q3) TODO pasa por la guardia, **sin override
  `ANY→ANY`** ni para maestro/admin — rescatar una orden atascada exigirá declarar la arista y desplegar;
  (activación) **estricta desde el día 1**, sin shadow/flag/env; (Q5) se valida también la creación
  `null→X` contra `ESTADOS_CREACION = {en_preparacion, en_fulfillment, en_ruta_bodega_central}`;
  (Q6) `throw` tipado `TransicionIlegalError` sin PII, firma intacta para los ~18 call-sites.
- **Q1/Q2/Q4 se cerraron CONTRA CÓDIGO al aterrizar 138/139** (ya no eran preguntas): terminales
  `entregada`/`devuelta_a_tienda`; `en_ruta_bodega_central` dejó de ser vestigial (entrada por `carga_api`,
  salida por la recepción central de la 138) → **allowlist vestigial VACÍA**; y el catálogo pasó a **18
  values** (la 139 sumó 3, no 1: `por_devolver`, `devolviendo_a_bodega_central`, `por_devolver_a_tienda`).
- **Spec reconciliado (`spec_author`):** estaba escrito con la numeración vieja (se titulaba "138";
  135/136/137 = hoy 137/138/139) y con `TODO(136)/TODO(137)` sin resolver. Inventario re-derivado del
  código: **41 aristas de flujo → 39 pares únicos + 3 de creación**, 22/22 familias `origen_tipo`,
  conectividad 18/18 sin callejones ni cuellos de botella. **La 139 RETIRÓ `rechazada →
  devolviendo_a_tienda`** (su R9): declararla reabriría un camino cerrado a propósito.
- **Reviewer RECHAZÓ la 1.ª entrega (`progress/review_140.md`), 2 bloqueantes.** Inventario R8
  CONFIRMADO correcto y R1–R17 trazados, pero **BLOQ-1: la guardia falla ABIERTA** — `esOrderStatusValue`
  descarta las filas de `order_status` cuyo `value` no esté en el `ORDER_STATUS_SEED` del build y esa
  transición pasa **sin validar** (drift DB↔build, justo donde la guardia hace falta); agravante: de 26
  suites que mockean el `tx` la guardia queda **OFF** en los ~25 archivos que modelan los call-sites
  reales, y un test consagraba el fail-open como contrato. **BLOQ-2:** `tasks.md` con las 11 tareas sin
  marcar. En corrección por `backend_dev` (fail-CLOSED + inyectar catálogo explícito en las suites, sin
  relajar la guardia para que pasen).
- **Sin migraciones, sin `down.sql`, sin RLS, sin endpoints nuevos** (es dominio puro + choke point).
- **Cierre:** re-review APROBADO 0 bloqueantes tras el fix a fallo cerrado, verificado por mutación.
  PR #161 mergeado a `dev`.

</details>

**Reconciliación de estado stale (pre-merge):** 107/108/110/120 estaban `in_progress` pese a estar
mergeadas a `dev` (PRs #135/#136/#140/#149) → reconciliadas a `done`.

**Ubicación compartida en el chat de WhatsApp — feature 121 → ✅ CERRADA 2026-07-25 (`done`).**
Reviewer APROBADO 0 bloqueantes; código y migración ya en `dev` y desplegados. Resumen en `history.md`.
El bloque de abajo se conserva como bitácora de la sesión en que se hizo.

<details>
<summary>Bitácora de la 121 (histórico)</summary>

Pedido del humano: "en el webhook que consume las respuestas de
WhatsApp agregar soporte para ubicación (mensajes `type=location`); almacenar la ubicación enviada;
y en el front un icono en el chat que al dar click despliegue, en modal/popup dentro de la misma
ventana, un minimapa con la ubicación actual del repartidor y el punto compartido por el usuario".
Fullstack, high, `depends_on: 120`.
- **Decisiones cerradas pre-spec (AskUserQuestion):** D1 = la posición del repartidor es el **GPS del
  navegador EN VIVO** (`useUbicacionActual`, feature 93), con degradación (solo punto del cliente +
  aviso) si se deniega/expira; no hay rastreo server-side. D2 = v1 **solo visualizar** (no adoptar la
  ubicación como coordenadas de entrega de la orden).
- **Reúso clave:** borde tipado del webhook `lib/types/whatsapp-webhook.ts` (`metaMessageSchema` +
  `parseWebhookEventos`, hoy `type=location`→`otro` sin coords), `ChatWhatsappService.ingerirEventos`
  + insert idempotente por `wa_message_id` (dedupe R8 de la 120), stack Leaflet+react-leaflet+OSM de la
  feature 97 (`RutaMapa`/`RutaMapaInner`/`ruta-mapa-tipos`, patrón anti-SSR `next/dynamic({ssr:false})`),
  `Dialog` de shadcn, `useUbicacionActual` (93).
- **Cambio de esquema:** enum `ChatMensajeTipo` += `ubicacion` + columnas `latitud`/`longitud` nullable
  en `chat_mensaje` (migración + `down.sql`, patrón `ALTER TYPE ADD VALUE` como `cancelacion_api` de la
  106).
- **Gate F1.4 APROBADO** con P1=solo lat/lng, P2=pin + texto "Ubicación compartida" en `text-xs`,
  P3=GPS al abrir el modal (lazy).
- **IMPLEMENTADA + reviewer APROBADO 0 bloqueantes** (orquestación directa `backend_dev` →
  `frontend_dev` → `reviewer`, model opus, sobre el árbol `flow`). Backend: enum
  `ChatMensajeTipo.ubicacion` + columnas `latitud/longitud` (migración up/down
  `20260724_chat_mensaje_ubicacion`), normalización `type=location` en `whatsapp-webhook.ts`,
  propagación service/repo/DTO/vista. Frontend: burbuja con `MapPin`, **`components/ui/dialog.tsx`
  nuevo** (sobre `@base-ui/react`, modelado en `sheet.tsx`), `UbicacionMapa/UbicacionMapaInner`
  (Leaflet+OSM anti-SSR, patrón feature 97), GPS lazy vía `useUbicacionActual` con degradación no
  bloqueante. **16/16 R con test, 156/156 verdes, typecheck 0 en archivos 121.** Detalle en
  `progress/impl_121_backend.md`, `impl_121_frontend.md`, `review_121.md`.
- **Deuda menor:** la migración se validó solo por forma estática (falta `apply`/`db:rollback` real);
  G2 quedó como dos archivos `impl_121_*` en vez de un `impl_121.md`.
- ~~**PENDIENTE (leader) — aterrizaje diferido**~~ → **RESUELTO.** Dependía de que la feature 120 (chat)
  saliera de `flow` a `dev`; ya ocurrió, y con ella aterrizó la 121. La migración
  `20260724120000_chat_mensaje_ubicacion` está **aplicada en producción** (verificado 2026-07-25).

</details>


**Etiquetas PDF en la carga por API — feature 136 (2026-07-23; renumerada de 112 en el merge dev→flow por colisión con `112-webhook-payload-data`) → EN ESPECIFICACIÓN.** Pedido del
humano: "generar las etiquetas de las órdenes cuando se realice la carga masiva, un único PDF
almacenado en el storage de Supabase" + "retorna la url donde están los PDF del bucket en la
respuesta de la carga". Backend, `medium`, `depends_on: 88` (done).
- **Decisiones ya cerradas con el humano** (antes del spec, vía AskUserQuestion): (a) momento = la
  **carga vía API** (`cargarViaApi`, que ya asigna `num_guia` en el acto; la carga masiva por sesión
  NO numera, no aplica); (b) generación **server-side**; (c) **un PDF consolidado por lote**;
  (d) devolver la **URL firmada** en la respuesta del endpoint.
- **Reúso clave:** `EtiquetaGuiaService.generarEtiquetas` (arma los `EtiquetaGuiaDTO`),
  `SupabaseFileStorage`/`SupabaseSignedUrlProvider` (`lib/storage/`), `buildPaqueteUrl`. Layout de
  etiqueta 100×100 mm de `app/(app)/ordenes/_components/etiquetas-pdf.ts` (cliente, feature 32).
- **Deps nuevas ya instaladas** durante la exploración: `qrcode` + `bwip-js` (pure-JS server-side; el
  generador de cliente `jspdf`+`jsbarcode`+`qrcode.react` depende del DOM/canvas y no corre en Node).
- **Fase 1 en curso:** feature 136 en `feature_list.json`; `spec_author` (`model: opus`)
  lanzado para `specs/136-etiquetas-pdf-carga-api/` (requirements EARS + design + tasks).
- **Próximo:** al terminar el spec → `spec_ready` + **PARAR en la puerta humana F1.4**. Rama/impl se
  difieren a Fase 2 en worktree aislado desde `origin/dev` (el `flow` actual arrastra WIP ajeno).
- **⚠️ Tarea humana al desplegar:** crear el bucket **privado** `etiquetas-guia` en Supabase.

**Chat mensajero↔cliente vía WhatsApp — feature 109 (2026-07-23) → EN ESPECIFICACIÓN.** Pedido del
humano: "chat que tiene acceso el mensajero, que usa la implementación de WhatsApp como intermediario
y que a través del webhook registra las respuestas del cliente". Fullstack, high, `depends_on: null`.
- **Fase 1 en curso:** feature registrada en `feature_list.json` (id 109, `pending`); `spec_author`
  lanzado (`model: opus`) para `specs/109-chat-mensajero-whatsapp/` (requirements EARS + design + tasks).
- **Infra WhatsApp ya existente (WIP en `flow`, reutilizable):** `lib/clients/whatsapp-cloud.ts`
  (`WhatsappCloudClient.enviarTexto`/`enviarPlantilla`, saliente), `lib/config/whatsapp.ts`
  (credenciales por env), plantillas sincronizadas a Meta (feature 107), `EnviarPlantillaWhatsappButton`
  en `mis-asignaciones`. **NO existe** webhook de ENTRADA ni tablas de chat → es el núcleo nuevo.
- **Alcance nuevo:** webhook `app/api/webhooks/whatsapp/route.ts` (GET handshake + POST firmado
  X-Hub-Signature-256), tablas conversación/mensaje (migración + RLS por asignación), UI de hilo en
  `mis-asignaciones` respetando la ventana de 24 h de WhatsApp (texto libre dentro, plantilla fuera).
- **Próximo:** al terminar el spec → `spec_ready` + **PARAR en la puerta humana F1.4** (revisar los 3
  archivos y resolver las decisiones abiertas). Rama/impl se difieren a Fase 2 en worktree aislado
  desde `origin/dev` (el `flow` actual arrastra WIP ajeno de WhatsApp).

**Plantillas de mensajes — feature 107 (2026-07-22) → PR #135, falta merge humano.** Subitem
"Plantillas" en Configuración (rol maestro, `/configuracion/plantillas`): CRUD completo (crear/editar/
eliminar) + editor que inserta campos variables `{{clave}}` + preview + estado
(activo/inactivo/pending/refused). Fullstack, sin dependencias (se saltó el id 106 por colisión con
`specs/106-api-lectura-ordenes/` de sesión paralela; ver también worktree `ordenex-wt-106`).

- **Gate humano APROBADO** con 4 decisiones: (D1) nace `pending`; (D2) el front SOLO desactiva
  (destino `inactivo`, `z.literal("inactivo")`) — ACTIVAR `pending→activo` NO existe aún; `refused`
  reservado sin productor; (D3) SOFT DELETE con `deletedAt`; (D4) catálogo de variables ABIERTO/
  data-driven, `variables text[]` derivadas del cuerpo.
- **Flujo:** spec_author (31 req EARS) → backend_dev (T1–T7) → frontend_dev (T8–T11 + eliminar) →
  reviewer. Orquestación directa, `model: opus`. Implementado en worktree aislado **`ordenex-wt-107`**
  desde `origin/dev` (rama `feature/107-plantillas-mensajes`), 14 commits.
- **Reviewer APROBADO** (`progress/review_107.md`, viaja en la rama): 31/31 R con test tras cerrar el
  único bloqueante (R3, test de autorización de la página). typecheck/lint verdes; **82 tests de la
  feature verdes** (9 archivos).
- **PR #135 → dev** (spec + review + alta 107 en feature_list viajan en la misma rama). Falta merge
  humano. ⚠️ Al desplegar: correr la migración `20260722130000_plantilla_mensaje`.
- Deuda menor diferida: `progress/impl_107.md` no se escribió (M1 del review); tasks.md sin marcas `[x]`.

_Ninguna del lote mensajero en curso._

**Lote mensajero 113–119 — COMPLETO (7/7 mergeadas a `dev`, 2026-07-23).** Detalle en `history.md`.
113 card detalle+foco (PR #147) · 114 buscador (#150) · 115 marcar-luego (#146) · 116 notas privadas
(#152) · 117 filtro cantón/distrito (#153) · 118 SINPE (#145) · 119 evidencias 1..N (#148). Nació como
112–118 y se **renumeró a 113–119** (colisión del ID 112 con `webhook-payload`). Migraciones nuevas:
115 `orden_mensajero_meta`, 119 `gestion_orden_evidencia`; rename del enum SINPE (118). Se saldó de paso
un error de lint ajeno de la 120-chat con el PR #151. Despliegue: `prisma migrate deploy`.

**Renumeración del backlog de analítica (2026-07-23, reajustada en el merge dev→flow 2026-07-24).** La
cadena de analítica (puro registro, sin specs/ramas/código) usaba `120`, que colisionaba con
`120 = chat-whatsapp`; se desplazó +1 → 121–134. Al mergear `dev` en `flow` el `121` volvió a colisionar,
ahora con `121 = ubicación-chat-whatsapp` (feature real, con spec + código en disco). Se movió el
**catálogo de KPIs a `135`** (era 121), y sus dependientes (`122`, `123`) apuntan ahora a `135`; el resto
de la cadena (122–134) queda intacto. Estado final: `120` = chat-whatsapp, `121` = ubicación,
`122–134` + `135` = analítica.

_Cierres previos mergeados a `dev`:_ **109** (PR #141), **110** (PR #140), **111** (PR #139), **102** (PR #131).


**Flujo de API key — verificación + huecos (2026-07-21).** A pedido del humano se verificó el flujo
de carga por API key (features 81/82/88, `done`): valida la key por hash SHA-256, carga por endpoint
expuesto (`POST /api/ordenes/api-key/carga`), genera `num_guia` y devuelve errores por fila. Dos
huecos → tres features nuevas. **Gate F1.4 APROBADO por el humano.**

> ⚠️ **Colisión de IDs por sesiones paralelas.** Se registraron primero como 98/99/100, pero durante
> la sesión otras sesiones commitearon a `origin/dev` las features **98–102**. Se **renumeraron a
> 103/104/105**. Las **ramas de código conservan su slug original** (`feature/98-api-carga-valor-pagar`,
> `feature/99-webhooks-cambios-estado`) porque ya estaban pusheadas y el classifier bloquea el borrado
> de ramas remotas. Los specs se movieron a `specs/103-*` y `specs/104-*`.

| # | Feature | Rama | Zona | Estado |
|---|---------|------|------|--------|
| 103 | api - `costoEnvio` (flete+IVA) en la carga por API | `feature/98-api-carga-valor-pagar` | backend | reviewer **APROBADO** · **PR #125** → dev (falta merge humano) |
| 104 | webhooks de cambios de estado (API key) | `feature/99-webhooks-cambios-estado` | backend | reviewer **OK** · **PR #127** → dev (falta merge humano) |
| 105 | webhooks - UI de registro (Config > API) | `feature/105-webhooks-ui-registro` | frontend | pending (bloqueada por 104; spec sin autoría) |

**Feature 106 — API de lectura/detalle/cancelación de órdenes por API key (2026-07-22).** Ciclo SDD
completo, backend, high, `depends_on: 88`. Exposición a integradores por API key: GET listado scopeado
al dueño de la key (`tienda_id = actor.usuarioId`, forzado en el repo), GET detalle por `num_guia` con
evidencias de entrega/rechazo firmadas (signed URL 5 min, sin PII), y **PUT** cancelar (solo desde
`en_bodega`/`en_ruta_bodega_principal` → `devuelta_origen`, si no 409) vía `appendCambioEstado`
(bitácora + webhook 104). Gate F1.4 aprobado por el humano; única migración = `ADD VALUE
'cancelacion_api'` en el enum `orden_historial_origen_tipo`. Implementada en worktree aislado
(`ordenex-wt-106`, `backend_dev` model opus): typecheck verde, lint 0, 55 tests nuevos + 68 ripple
verdes. Reviewer **APROBADO 0 bloqueantes**. Rama `feature/106-api-lectura-ordenes` sincronizada con
`dev`, pusheada, **PR #132 → dev (falta merge humano)**. Todo el registro (feature_list 106 + spec +
`impl_106` + `review_106`) viaja commiteado en el propio PR #132 (self-contained). **⚠️ Al desplegar:
correr `db:migrate` (agrega el valor de enum; no se aplicó pre-merge porque el `.env` apunta a DB
compartida).**

**Bookkeeping en PR #124** (`chore/registro-features-webhooks-103-105`): feature_list 103/104/105 +
specs/103 + specs/104 + `review_103` + `review_104`. Los tres PRs (#124, #125, #127) → `dev`, merge humano.

**Decisiones del gate F1.4 (cerradas por el humano):** F103 → `costoEnvio` = flete+IVA, `"0.00"` si la
tienda no tiene tarifa, campo `costoEnvio`. F104 → registro por **UI en Config>API** (Server Action,
rol maestro; nace 105), secreto **cifrado AES-256-GCM** (`WEBHOOK_SECRET_ENC_KEY` en env), emite **solo
órdenes cargadas por API key**, **5 reintentos**, persiste el error de entrega vía `jobs.last_error`.

- **F103:** `feature/98-api-carga-valor-pagar` @ `ae651b7`, pusheada; typecheck 0, suite 3935/3935.
  `impl_98.md` vive en esa rama. Pendiente: PR hacia `dev`.
- **F104:** en implementación en worktree aislado (`backend_dev`, `model: opus`). Al mergear:
  **configurar `WEBHOOK_SECRET_ENC_KEY` en Vercel** o los webhooks no pueden firmar.

> Este registro (feature_list 103/104/105 + specs/103 + specs/104 + esta bitácora) viaja en
> `chore/registro-features-webhooks-103-105` → PR a `dev` (sin commits directos a `dev`).

El último trabajo previo mergeado fue la **feature 97** (optimización de ruta — frontend): PR #110 a
`dev`, prod PR #117.

## Backlog pendiente

Las 7 features `pending`. El detalle completo (alcance, decisiones del gate F1.4, hallazgos)
vive en su entrada de `feature_list.json`. Las 6 con dependencia la tienen `done`, así que
**todas están desbloqueadas**.

| # | Feature | Zona | Depende de |
|---|---------|------|-----------|
| 66 | qr - detalle (detalle de la orden con switch por rol) | — | — |
| 70 | regla de selección de tarifa vigente (filtrar `tarifas.status`) | backend | 69 ✅ |
| 71 | listado del maestro: bloquear checkbox de órdenes con cierre sin resolver | fullstack | 69 ✅ |
| 74 | explotar la causa de devolución (mostrarla y agruparla) | fullstack | 73 ✅ |
| 79 | decidir si `/paquete/[numGuia]` es pública y desbloquearla | backend | 78 ✅ |
| 80 | proveedor de correo real + sacar el OTP de los logs | backend | 78 ✅ |
| 85 | wallet - periodicidad de gastos fijos (frontend) | frontend | 84 ✅ |

> **66** se reclasificó de `in_progress` → `pending` el 2026-07-21: nunca se empezó (sin rama,
> sin spec, sin commit; solo existe el escáner de la feature 65 que navega a la ruta del QR).

## Deudas de arnés vivas

- **No hay regla `no-console` en el lint** (verificado 2026-07-21) → **17 llamadas `console.*` en
  producción** (`app/` + `lib/`, sin tests). Por ahí se coló el `console.log('xyz')` del PR #75.
  El de `OtpChallengeIssuer` es un **secreto en logs** → lo cubre la feature 80. Algunas pueden
  ser logging de error legítimo: revisar una por una + instalar `no-console` con allowlist.
- **✅ RESUELTO (2026-07-22, `chore/fix-init-sh-rule4`):** la suite flaky que volvía `./init.sh` no
  determinista se salda subiendo `testTimeout`/`hookTimeout` de vitest de 5000ms (default) a
  **20000ms** en `vitest.config.ts`. Los timeouts por contención bajo carga (`HomePage`,
  `HomePageRol`, `OrdenesModuleReuse`, `CierreDiaPage`, que pasaban en aislado) desaparecieron;
  `./init.sh` corre la suite verde de forma determinista (verificado 4075/4075). Un test
  genuinamente colgado sigue fallando a los 20s.
- **`zonas-migration.test.ts` usa una denylist de migraciones apendida a mano** → se pone rojo con
  cada migración nueva (ya rompió ≥3 veces). Patrón frágil: un test que lista archivos del repo en
  vez de leer código.
- **Fakes de repositorio a mano y duplicados** (`IUserRepository` triplicado, `IOrdenRepository`
  con ~30 métodos listados a mano) → cada método nuevo del contrato rompe N archivos de test. Un
  builder en `tests/helpers/` lo mataría de raíz.
- **✅ RESUELTO (2026-07-22, `chore/fix-init-sh-rule4`):** regla 4 de `init.sh` corregida — resuelve
  la carpeta de spec por `spec_path` explícito o glob `specs/<id>-*` (antes usaba `.name`, que no
  matchea el slug), y solo la exige a features **en vuelo** (`spec_ready`/`in_progress`), no a las
  `done` tempranas (1–16) sin spec. Regla 3 subida a **máx 2 `in_progress` por zona** (decisión del
  humano), consistente con CLAUDE.md regla 1 y AGENTS.md. `init.sh` verde de punta a punta. Nota:
  ambas reglas siguen dependiendo de `jq`; si falta, se saltan sin fallar (degradación aceptada).
- **No hay harness de E2E** (seed + login por rol). Los `e2e/*.spec.ts` están escritos pero usan
  emails placeholder → no se ejecutan. Candidato a feature propia.
- **`app/(app)/ordenes/_components/ordenes-columns.tsx` es un imán de drift** (ya lo revirtieron 2
  veces) → mirarlo con lupa en todo PR que lo toque.

## Tareas humanas pendientes

> **✅ VERIFICADO CONTRA SUPABASE PROD el 2026-07-25** (proyecto `ordenex-db` / `scfnwxqbsgkzwsdntdvd`,
> vía MCP). Ya no hay que suponer: se consultó `storage.buckets` directamente.

- ~~**Bucket `gestion-evidencias`**~~ → **EXISTE**, privado, creado 2026-07-15. Nada que hacer.
- ~~**Bucket `mensajero-docs`**~~ → **EXISTE**, privado, creado 2026-07-15. Nada que hacer.
- ⚠️ **Bucket `etiquetas-guia` (privado) — NO EXISTE. ÚNICO BLOQUEO DE INFRA VIVO.** Lo necesita la
  feature 136 (`ETIQUETAS_BUCKET`, default `etiquetas-guia` en `lib/config/etiquetas.ts`). Es la tarea
  T0.1 del spec de la 136, la única sin marcar.
  **Impacto matizado (corregido por el review de la 136):** el endpoint trata la etiqueta como
  best-effort — `try/catch` (`route.ts:152-158`) que NO revierte la carga, responde **200** con las
  órdenes y su `num_guia` y expone el fallo como `etiquetasPdf: { error }`. Eso **cubre las excepciones
  JS** (bucket ausente incluido), así que en lotes normales los integradores reciben sus órdenes bien,
  sólo sin PDF.
  ⚠️ **PERO NO cubre OOM/timeout** (BLOQ-1 del review): el PDF no tiene cota (hasta `MAX_CHUNK_ROWS`
  = 5000, ~279 KB y ~13 ms por etiqueta → ~1.4 GB / ~65 s) y el fallo ocurre **después** del commit de
  las órdenes. Un OOM no es excepción JS → 500/504 en vez de 200 y el integrador **pierde los
  `num_guia`** (al reintentar salen `duplicada`). En corrección; ver `progress/review_136.md`.
  Crear desde el dashboard de Supabase (Storage → New bucket → nombre `etiquetas-guia`, **Private**),
  o por SQL:
  `INSERT INTO storage.buckets (id, name, public) VALUES ('etiquetas-guia','etiquetas-guia',false) ON CONFLICT (id) DO NOTHING;`
  (los buckets existentes solo se crearon; el service role bypassa RLS, así que no hacen falta policies).
- **Proveedor de correo real** — hoy `StubEmailProvider` solo hace `console.info`; **ningún email
  sale** y el OTP se lee de los logs del servidor. Lo salda la feature 80 (`pending`).

**Estado del catálogo en PROD (verificado el 2026-07-25):** migraciones del lote 4/4 aplicadas,
0 nombres viejos residuales, 6/6 nombres nuevos, `orden_historial_origen_tipo` con 22 values.
`order_status` tiene **19 filas**: las 18 del código + `pendiente`, huérfano (**0 órdenes en prod y 0 en
local**, sembrado por `20260714140000_order_status_pendiente` y nunca añadido a `ORDER_STATUS_SEED`).
Inofensivo hoy; con la guardia de la 140 cualquier transición que lo tocara se rechaza explícitamente.
Limpiarlo requiere una migración propia — decisión de datos, no urgente.

## Notas de proceso (vigentes)

- Todos los subagentes corren con `model: opus` (decisión del humano 2026-07-09), ignorando la
  gradación por complexity.
- **Workaround del bug opus-4.8[1m]:** orquestar directo (`spec_author` → `backend_dev`/
  `frontend_dev` → `reviewer`) en vez del `implementer` monolítico, pasando `model: opus`
  explícito; el `implementer` muere en el 1er intento.
- Ramas desde `origin/dev`, PRs hacia `dev`; el bookkeeping (cierres, reconciliaciones) viaja en
  una rama `chore/` + PR, **sin commits directos a `dev`**. Cuando `flow` tiene WIP ajeno, se
  trabaja en worktree aislado desde `origin/dev` para evitar el drift de sesiones paralelas.
