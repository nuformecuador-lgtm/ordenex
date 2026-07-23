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

**Chat mensajero↔cliente vía WhatsApp — feature 120 (2026-07-23) → EN IMPLEMENTACIÓN (Fase 2).**
Pedido del humano: "chat que tiene acceso el mensajero, que usa la implementación de WhatsApp como
intermediario y que a través del webhook registra las respuestas del cliente". Fullstack, high,
`depends_on: null`. **RENUMERADA de 109 a 120** (el id 109 ya lo usaba 'orden sin gestionar / cierre
vencido', done en dev; 112–119 reclamados por otras sesiones). Slug conservado.
- **Fase 1 COMPLETA + gate F1.4 APROBADO** (D1–D6 cerradas): D1 envío en línea + reintento encolado;
  D2 fuera de ventana 24 h bloquear texto libre y derivar a plantilla; D3 solo mensajero asignado (v1);
  D4 orden asignada más reciente del número; D5 SWR polling ~10 s; D6 `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  + `WHATSAPP_APP_SECRET`; migración post-merge a mano contra `ordenex-db` (live).
- **Spec:** 25 requisitos EARS (R1–R25) en `specs/120-chat-mensajero-whatsapp/`, cada uno mapeado a test.
- **Base de construcción:** worktree aislado **`ordenex-wt-120`**, rama `feature/120-chat-mensajero-whatsapp`
  desde `flow` (que tras el merge del humano es superconjunto de `dev`, sin riesgo de revertir). Reutiliza
  la integración WhatsApp del commit `eb50730` (cliente `whatsapp-cloud.ts`, config, plantillas,
  `EnviarPlantillaWhatsappButton`) — el envío saliente ya existe; el **núcleo nuevo** es el webhook de
  ENTRADA + tablas de chat + UI de hilo.
- **Alcance nuevo:** webhook `app/api/webhooks/whatsapp/route.ts` (GET handshake `hub.challenge` con
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; POST firma `X-Hub-Signature-256` HMAC con `WHATSAPP_APP_SECRET`,
  dedupe por `wa_message_id`, excluido del auth en `middleware.ts`), tablas conversación/mensaje
  (migración + down.sql + RLS por asignación), Server Action de envío con ventana 24 h, UI de hilo en
  `mis-asignaciones`.
- **IMPLEMENTADA Y REVISADA (2026-07-23):** backend (bloques A–F, H1, commit `794aab9`) + UI (bloque G,
  commit `337dac2`) + renumber/bookkeeping (`07af5a8`). Reviewer **APROBADO 0 bloqueantes**
  (`progress/review_120.md`): **25/25 R con test verde**, **57 tests de la feature verdes**, typecheck
  **delta CERO** vs el baseline ajeno de flow (30 errores preexistentes en `MisAsignacionesModule` roto /
  `middleware.test` async / `fallback-route-optimization`, ver `progress/_baseline_typecheck_120.txt`).
- **⚠️ PENDIENTE DE ATERRIZAJE (decisión humana):** la rama nace de `flow` (base rota que no compila). Un
  PR directo `feature/120 → dev` arrastraría la divergencia de flow **incluyendo código roto** → reventaría
  CI. Los 3 commits de la 120 están AISLADOS y solo dependen de `eb50730` (integración WhatsApp). Camino
  limpio recomendado: rama nueva desde `origin/dev` + cherry-pick `eb50730` + los 3 commits (07af5a8,
  794aab9, 337dac2) → PR verde y mergeable. **⚠️ Al desplegar:** correr las migraciones
  `20260723130000_chat_whatsapp` y `20260723130100_job_tipo_whatsapp_chat_envio`, y configurar
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` en Vercel.

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

## Tareas humanas pendientes (verificar)

> La app ya está en **prod** (PR #117); estos buckets podrían estar creados. Confirmar contra el
> proyecto Supabase antes de darlos por hechos o por pendientes.

- **Bucket Supabase `gestion-evidencias`** (privado) — evidencias de entrega/rechazo del mensajero
  (feature 36). Sin él, la gestión falla al subir la foto.
- **Bucket Supabase `mensajero-docs`** (privado) — documentos de postulación del mensajero (feature 21).
- **Proveedor de correo real** — hoy `StubEmailProvider` solo hace `console.info`; **ningún email
  sale** y el OTP se lee de los logs del servidor. Lo salda la feature 80.

## Notas de proceso (vigentes)

- Todos los subagentes corren con `model: opus` (decisión del humano 2026-07-09), ignorando la
  gradación por complexity.
- **Workaround del bug opus-4.8[1m]:** orquestar directo (`spec_author` → `backend_dev`/
  `frontend_dev` → `reviewer`) en vez del `implementer` monolítico, pasando `model: opus`
  explícito; el `implementer` muere en el 1er intento.
- Ramas desde `origin/dev`, PRs hacia `dev`; el bookkeeping (cierres, reconciliaciones) viaja en
  una rama `chore/` + PR, **sin commits directos a `dev`**. Cuando `flow` tiene WIP ajeno, se
  trabaja en worktree aislado desde `origin/dev` para evitar el drift de sesiones paralelas.
