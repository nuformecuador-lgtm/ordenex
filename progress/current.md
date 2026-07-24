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

### Lote 135–138 (flujo de estados) — 135 implementada, reviewer APROBADO, PR a `dev` (pendiente merge humano)

**135 — rename nomenclatura `order_status` (fullstack, opción A del gate) — code-complete + verde.**
Backend `e044e05` + frontend `36d12bd` en `feature/135-order-status-rename-nomenclatura`.
`./init.sh` **verde** (484 archivos / 4815 tests); guards R13 (censo) y `no-embalaje` verdes.
Reviewer **APROBADO-CON-NOTAS**, 0 bloqueantes, trazabilidad R1–R13 completa
(`progress/review_135-...md`). **PR #157 → `dev`** (falta merge humano). Se reinició de cero desde el spec del
gate (se descartó una WIP pre-gate que usaba `en_tienda`/etiquetas abreviadas; el worktree
suelto `agent-a2b3…` quedó como directorio huérfano en disco por ruta-larga de Windows).
- **Deuda post-merge (Nota-3 del reviewer):** correr `prisma migrate deploy` + verificar
  `down.sql` con `db:rollback` contra la DB real (el entorno no tenía `.env`/DB; R2/R3/R4
  quedaron trazados por test estático + round-trip en-memoria). Migración
  `db/migrations/20260724120000_order_status_rename_nomenclatura/`.
- **Deuda menor de UI (opcional):** títulos de sección estáticos ("En bodega", etc.) siguen
  con su texto propio; R8 rige el badge (`ORDER_STATUS_LABELS`), no los headings de región.
- **136/137/138** siguen `spec_ready`, bloqueadas por la cadena hasta que la 135 mergee.

**Reconciliación de estado stale (commit `2f460e3`):** 107/108/110/120 estaban `in_progress`
pero ya mergeadas a `dev` (PRs #135/#136/#140/#149) → reconciliadas a `done`. Con esto solo la
135 queda `in_progress` (arregla el gate "máx 2 in_progress por zona" que rompía `init.sh`).

_Ninguna del lote mensajero en curso._

**Lote mensajero 113–119 — COMPLETO (7/7 mergeadas a `dev`, 2026-07-23).** Detalle en `history.md`.
113 card detalle+foco (PR #147) · 114 buscador (#150) · 115 marcar-luego (#146) · 116 notas privadas
(#152) · 117 filtro cantón/distrito (#153) · 118 SINPE (#145) · 119 evidencias 1..N (#148). Nació como
112–118 y se **renumeró a 113–119** (colisión del ID 112 con `webhook-payload`). Migraciones nuevas:
115 `orden_mensajero_meta`, 119 `gestion_orden_evidencia`; rename del enum SINPE (118). Se saldó de paso
un error de lint ajeno de la 120-chat con el PR #151. Despliegue: `prisma migrate deploy`.

**Renumeración del backlog de analítica (2026-07-23).** La cadena de analítica registrada en la rama de
registro usaba `120`, que **colisionaba** con `120 = chat-whatsapp` (ya en `dev` con código). Se
**desplazó +1 → 121–134** (dependencias internas reajustadas); es **puro registro** (sin specs, ramas ni
código), así que renumerar es inocuo. El `120` queda para `chat-whatsapp`.

_Cierres previos mergeados a `dev`:_ **109** (PR #141), **110** (PR #140), **111** (PR #139), **102** (PR #131).

---

### Features 103/104/105 — webhooks + costoEnvio API (registro de sesión paralela, mergeado a dev)
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
