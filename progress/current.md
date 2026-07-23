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

### Feature 109 — orden sin gestionar: `en_reparto` que pasa de día → cierre vencido + reasignación prioritaria (Fase 1)
- **Rama:** `feature/109-sin-gestionar-cierre-vencido` (desde `origin/dev` @ `a5acc07`, que ya incluye **110** PR #140 y **111** PR #139). Zona `fullstack`, complexity `high`. `depends_on: 111` ✅ (merged).
- **Estado:** `in_progress` (Fase 2) — **gate F1.4 + re-gate CERRADOS**, spec final **R1–R31** revisada por el leader (consistente, sin decisiones abiertas). **Modelo final del cierre (GLOBAL):** solo `aprobado` es terminal; `solicitado`/`vencido`/`rechazado` son abiertos=BLOQUEANTES; rechazar deja `rechazado` (conserva nombre+`motivo`+auditoría) pero **BLOQUEA** y es **RE-SOLICITABLE** (`rechazado → solicitado`, espejo del `vencido`). Bloqueo = `{solicitado,vencido,rechazado}` (`ESTADOS_CIERRE_BLOQUEANTES`+`findMensajerosBloqueados`+SQL anti-TOCTOU+exclusión del corte). `sin_gestionar` libera SOLO al APROBAR. Sin migración de enum `CierreEstado`. LOCKED: Q1/Q3/Q4/Q5/Q6/Q7. **109 EXPANDE el flujo de rechazo de 38/111 (system-wide): hoy rechazar es terminal y desbloquea; con esto bloquea + re-solicita.** Ripple de tests 38/111/41 documentado en `tasks.md`. **F2.1: `backend_dev` (model opus) lanzado** para las tasks `[B]` (Bloques 0–3.bis + 5); luego `frontend_dev` (Bloque 4) y `reviewer`. Spec: `specs/109-sin-gestionar-cierre-vencido/`.
- **Nota de sesión:** el `spec_author` se cortó por error de API 3 veces durante la 3.ª revisión; el leader verificó los 3 archivos en disco (completos/consistentes) y tomó el review directamente en vez de re-resumir.
- **Fase 2 — IMPLEMENTACIÓN COMPLETA + REVIEW APROBADO.** `backend_dev` se cortó por API ~8 veces, `frontend_dev` 1, `reviewer` 4; el leader remató backend, cierre de review y verificación (los subagentes se caían mid-response; el bucle principal no). Backend: corte extendido, liberación al aprobar, `rechazado` bloqueante + `rechazado→solicitado` (modelo global 38/111). Frontend (Bloque 4): R25 etiqueta, R31 CTA re-solicitar + rótulo `/cierres-admin`, R26 guard. **typecheck 0, lint 0 err/143 warn, suite 4522/4522.** `reviewer` **APROBADO** (0 bloqueantes; 1 menor RESUELTO = mapa R→test impreciso; 1 follow-up no bloqueante = aserción explícita R13 money-neutral). Bitácoras `progress/impl_109.md` + `progress/review_109.md`. **TODO SIN COMMITEAR aún (rama fresca desde origin/dev). Siguiente (F2.3–F2.4): commit + sync con `dev` + PR — esperando OK del humano para acciones outward-facing.**
- **Alcance (de la descripción):** al corte diario (41) TODA orden aún en `en_reparto` → nuevo estatus `sin_gestionar` + cierre `vencido` que bloquea al mensajero (reusa 41/111). `en_espera_aceptacion` NO aplica. `sin_gestionar` no cuenta como intento y es money-neutral. Órdenes de un cierre sin aprobar quedan CONGELADAS. Al aprobar el vencido (38), se liberan a bodega por zona (`en_bodega`/`en_bodega_satelite`, sin mensajero) con `prioridad=true` (101/110) para reasignar ESE día. Transiciones vía `appendCambioEstado` (49). Migración aditiva: nuevo valor del enum `estatus` + `down.sql`.
- **Zona/paralelismo:** fullstack `in_progress` tras registrar 109 = {107, 109} = 2 (dentro del máx). 107 (plantillas) no comparte archivos con 109; conflicto formal a validar contra `specs/109/tasks.md` en el gate.

### Feature 111 — cierre vencido: bloqueo total + resolución por el mensajero (Fase 1)
- **Rama:** `feature/111-cierre-vencido-modelo` (desde `origin/dev`). Zona `fullstack`, complexity `high`. `depends_on: 41` ✅.
- **Renumeración:** era "108" en el borrador; se renumeró por colisión con la sesión paralela (106/107/108 = API lectura / plantillas / webhook). Cadena registrada: **109** sin_gestionar (depende de 111) · **110** prioridad unificada · **111** este.
- **Estado:** `in_progress` (Fase 2) — spec + impl (backend_dev → frontend_dev) + review COMPLETOS. Reviewer pidió CAMBIOS (único bloqueante: E2E); resuelto por el leader (E2E `cierre-vencido-modelo.spec.ts` nuevo + `reglas-bloqueos-cierre.spec.ts` actualizado al modelo nuevo; tasks marcadas). Mergeado `origin/dev` (conflicto solo en feature_list, resuelto); post-merge typecheck 0, lint 0, **suite 4480/4481** (1 ajena: `zonas-migration.test.ts`, deuda de allow-list). **PR #139 → dev abierto; esperando merge humano (F2.5).** (Feature 102 reconciliada a `done`: #131/#133 mergeados.)
- **Nota de sesión:** el API se cortó ~4 veces con los subagentes (spec_author, backend_dev, frontend_dev); cada uno se retomó desde el transcript o el leader terminó el trozo final. Sin impacto en el resultado.
- **Gate F1.4:** Q1 = el **mensajero solicita su `vencido`** primero (admin aprueba solo `solicitado`; `vencido` fuera de resolubles normales) **+ válvula de escape**: el admin puede destrabar un `vencido` abandonado en nombre del mensajero (auditable). Q2 = bloqueo **total** sobre guías, incluido **deshacer gestión** (guarda explícita). Q3 = también bloquea **recoger/escoger**.
- **Alcance:** el bloqueo del mensajero pasa a impedir **gestionar y recibir**; el mensajero puede **solicitar su propio `vencido`** (`vencido→solicitado`); invariante: nunca `vencido`+`solicitado` a la vez. Revisa 41/37/38.

### Feature 102 — ingreso de bodega por rechazos SLA visible en cierres + aviso (Fase 2)
- **Rama:** `feature/102-rechazos-sla-visible` (desde `origin/dev`). Zona `fullstack`, complexity `medium`. `depends_on: 99` ✅.
- **Estado:** `in_progress` (Fase 2) — spec + impl (backend_dev → frontend_dev) + review COMPLETOS. Reviewer **APROBADO** (18/18 R con test que pasa; sin migración; money-safe; gate cumplido). Merge de `origin/dev` (features 98/103/104/105) resuelto; post-merge typecheck OK, lint 0 err, **suite 4120/4120**. **PR #131 → dev abierto; esperando merge humano (F2.5).** Al mergear: pasar a `done`, append a `history.md`, limpiar de aquí (F2.6). Sin migración → no requiere `prisma migrate deploy` local.
- **Gate F1.4 (mecanismo + Q1–Q4, todo default):** aviso = **VISIBILIDAD DERIVADA**. Q1 monto tienda = `ingreso_bodega_rechazo` (snapshot 56); Q2 anclado al snapshot (`null`="pendiente de cierre"); Q3 superficie tienda = sección dentro de `/novedades`; Q4 subtotal SLA solo en el **detalle** del cierre. Sin migración, sin mover dinero, sin infra de notificaciones; desglose por join `origen_tipo='escalado_devuelta_sla'`.
- **Artefactos:** `specs/102-rechazos-sla-visible/`, `progress/impl_102.md`, `progress/review_102.md`.

_Contexto:_ lo último mergeado en `dev` antes de 102 fue **feature 101** (PR #129) y **feature 100** (PR #128); durante esta sesión `origin/dev` avanzó con la **feature 98** (`costoEnvio` carga API, PR #125) y el bookkeeping de 103/104/105. La app está en prod (PR #117).

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
