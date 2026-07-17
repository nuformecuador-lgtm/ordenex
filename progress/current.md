# Sesión activa

> Estado vivo de lo que se esta trabajando ahora. El leader lo mantiene al dia.
> Al cerrar una feature, se limpia de aca y se resume en history.md.

## Features en curso

| Branch | Zona | Fase | Estado |
|--------|------|------|--------|
| feature/78-rutas-publicas-middleware | backend | **F1 (spec)** | **REGISTRADA `pending` 2026-07-16.** Pedido: *"analiza el back si tiene la logica para recuperacion de contraseña"* → luego *"genera la pagina… usa sdd, crea la feature y avanza"*. **LA PAGINA YA EXISTIA: no habia nada que generar.** La **feature 20 esta `done`** y entregó el flujo OTP propio completo de 3 fases (`app/recuperar-contrasena/page.tsx` + form + 3 Server Actions + `PasswordResetService` con anti-enumeración/rate-limit/bcrypt + ~12 archivos de tests). Se le informó al humano y **el alcance se acotó a lo que SÍ falta**. **OJO STACK:** la auth **NO es Supabase Auth**, es propia sobre Prisma/Postgres con sesión en cookie; Supabase solo es Storage. **EL BUG REAL (1 línea):** `middleware.ts:3` → `PUBLIC_ROUTES = ["/login","/api/health"]` con matcher que cubre todo → **`/recuperar-contrasena` es INALCANZABLE justo para quien no tiene sesión**, y **`/postulacion` también → VIOLA EL R22 DE LA FEATURE 21 YA CERRADA** (su comentario dice literal *"Acceso sin sesion ni cookie (R22)"*): **el único camino de auto-registro del sistema está cerrado**. **NINGÚN TEST LO CAZA: no existe test de `middleware.ts`**; los tests de página montan el componente directo y se saltan el middleware — ese es el hueco por el que se coló. **DECISIONES DEL HUMANO (gate F1.4 adelantada):** (a) alcance = **recuperación + postulación**; **`/paquete` FUERA a propósito** → **feature 79** `pending`. (b) se **conserva `startsWith`** (no se endurece a match exacto). (c) **los `console.log` del OTP SE QUEDAN** — riesgo aceptado **explícitamente**: hoy son el **único modo de completar el flujo**. (d) **sin proveedor de correo**, solo un `TODO:` → **feature 80** `pending`. **Alcance final = 3 cosas:** 2 rutas a `PUBLIC_ROUTES` + **primer test de middleware del repo** + el `TODO:`. **NO se hace checkout** (sesión en `flow` con WIP ajeno); rama desde `origin/dev` en F2.0. **Spec v1 entregada** (`specs/78-rutas-publicas-middleware/`, R1–R7 + 8 tasks). **EL `spec_author` CAZÓ UN ERROR DEL LEADER** (su P1): la descripción de la feature pedía tests donde *"las 4 públicas pasan"* mientras la decisión (a) deja `/paquete` FUERA → incompatible. Era una redacción mía ambigua ("las 4 públicas" = las 4 rutas fuera de `(app)`, no las 4 entradas de `PUBLIC_ROUTES`); **coinciden en número (4) por casualidad**: la lista final es `/login`+`/api/health`+`/recuperar-contrasena`+`/postulacion`, **sin `/paquete`**. `feature_list.json` corregido. **GATE F1.4 RESUELTA por el humano 2026-07-16:** (P2) **SÍ** al **test de caracterización de `/paquete`** — fija que HOY redirige, explicitando que es estado actual pendiente de decisión (79), no el deseado; así **la 79 tiene que invertirlo DELIBERADAMENTE** (test rojo) en vez de que siga bloqueada por olvido. (P3) **NO se tocan los comentarios** de `OtpChallengeIssuer.ts:27-30` / `EmailProvider.ts:3-9` aunque hoy sean **literalmente falsos** ("el código solo viaja por email" / "nunca el código en claro") — *"el log es para uso humano, déjalo por ahora"* → difuridos a la **feature 80**. El **`TODO:` va SOLO en `password-reset.ts`** y debe anotar que esos comentarios quedan desactualizados **a propósito** → el TODO es el único punto que dice la verdad. **2 riesgos del design, conservados:** el `spec_author` **no pudo ejecutar la sonda de `NextRequest`** (sin shell en su rol) → **T2 la ejecuta el implementer ANTES de escribir los casos**, con fallback documentado (node → jsdom → doble mínimo); y **no hay precedente de `NextRequest` en `tests/`** (los tests de ruta usan `Request` estándar, que **no sirve**: el middleware consume `nextUrl` y `cookies`). **SPEC APROBADA por el humano 2026-07-16** (+ confirmó: *"la postulacion se hace desde el home y lo puede hacer cualquiera sin sesion"* → ratifica el R22 de la 21). **IMPL COMPLETA — PR #85 → `dev` ABIERTO (F2.4).** Worktree aislado `ordenex-f78` desde `origin/dev` `a0957ec`. **Diff de producción: 2 archivos** — `middleware.ts` (2 entradas + comentario) y `password-reset.ts` (**20 líneas, TODAS comentario, 0 de código**). **VERIFICADO EN RUNTIME CON CURL, no solo con tests**: `/recuperar-contrasena` y `/postulacion` → **200 con formulario**; `/ordenes` y `/paquete` → **307**. Los **7 tests de middleware se escribieron EN ROJO primero** (`ab1de83`) y se vieron fallar antes del fix (`84faa87`) — importan el middleware REAL. **MEDIDO (no citado):** typecheck **0** (baseline 0), lint **0 err/140 warn** (=baseline), tests **3091 passed / 2 failed**. **La sonda de `NextRequest` (T1) resolvió por el camino 1**: instancia nativa en entorno `node` (Node 22.13.1 / Next 16.2.10), sin jsdom ni doble — no hizo falta el fallback. **HALLAZGO DE SETUP:** el worktree no traía `.env` (gitignored) → el typecheck daba **40+ errores falsos** de `@prisma/client` hasta copiarlo y correr `pnpm db:generate`; **sin eso el baseline habría sido basura**. 🔴 **DRIFT DE SESIÓN PARALELA (6.º caso del patrón), RESUELTO SIN REVERTIR:** mientras esta rama estaba en vuelo, `dev` aterrizó **`43159c8 fix(78): suma /postulacion a PUBLIC_ROUTES y agrega tests de middleware`** — **la MITAD `/postulacion` de ESTA MISMA feature**, hecha por otra sesión, sin `/recuperar-contrasena` (que era el pedido original). Conflicto en `middleware.ts` **resuelto por UNIÓN** (su `/postulacion` + nuestro `/recuperar-contrasena`). Tests **consolidados**: se elimina su `tests/unit/middleware.test.ts` (4 casos) y queda `tests/unit/auth/middleware.test.ts` (7). **OJO — el leader afirmó "superconjunto estricto" y ERA IMPRECISO**: sus tests afirmaban `res.status` (200/307) y los nuestros solo el header `location` → **se absorbieron sus aserciones ANTES de borrar**, así la consolidación es demostrable y no una reversión silenciosa (decisión del humano; el patrón ya golpeó al repo 5 veces). **CLASIFICACIÓN DE FALLOS, MEDIDA Y REPRODUCIBLE:** el conteo **escala con la carga de la suite** — 129s→**2**, 191s→5, 270s→11, 340s→**19** — y el conjunto cambia entre corridas. Los 2 finales: `HomePage` = `Test timed out in 5000ms` (flake), `CierreDiaPage` = **falla IDÉNTICO en `origin/dev` limpio** (preexistente real: `region "Entregadas"` no existe). `middleware.test.ts` **nunca** aparece; `recuperar-contrasena-form.test.tsx` (que **sí importa `password-reset`**) pasa **7/7 en aislado** → se verificó en vez de asumirlo. **GATE F2.2 (reviewer) SALTADA: el humano la canceló y pidió continuar** — queda en el registro. **DEUDA NUEVA (fuera de alcance):** `next dev` avisa que **el convention `middleware` está DEPRECADO en Next 16.2.10** (*"use `proxy` instead"*) → afecta a este archivo. **LIMITACIÓN DECLARADA (no bloqueante):** el caso "`/recuperar-contrasena` **con sesión válida** redirige a `/`" no se ejercitó end-to-end (requiere sesión en DB); argumentado como inalterable por el diff (con cookie el middleware devolvía `next()` antes y después). **PENDIENTE: merge del PR #85 (OK humano).** |
| feature/69-cierre-detail | fullstack (impl = **backend puro**) | F2 (bloque 0 hecho; **T5 → T22 en curso**) | **LA TABLA `cierre_detail` TODAVIA NO EXISTE** (sin modelo en `db/schema.prisma`, sin migracion): el bloque 0 (T1-T4) **NO construye la tabla, DESBLOQUEA el arbol**. Spec COMPLETA + **gate F1.4 APROBADA** 2026-07-15 (decisiones (a)-(g), **1 override**: (g) NO se filtra `tarifas.status`, se conserva el resolver + `TODO:`). `specs/69-cierre-detail/` = **R1-R30 + 23 tasks**. **YA ENTREGADO (medido):** typecheck **2 → 0** y `pnpm build` **ROJO → VERDE** — lo que la 68 nunca logro. **Las 23 tasks son BACKEND** (T18 devuelve el MISMO DTO: la UI no cambia, sin `frontend_dev`). **T5 desbloqueado 2026-07-15 mergeando `feature/72` en esta rama** — NO hacia falta esperar el merge del PR #76: git deduplica cuando la 72 entre a `dev`. Ese wait fue tiempo perdido por el leader. **PENDIENTE: T6 (modelo) → T7 (migracion + backfill + down.sql) → T10 (crearCierre puebla) → T14-T18 (lectores) → T19 (test de la propiedad) → reviewer → PR.** |
| feature/73-causa-devolucion | fullstack | F2.4 (**PR #78 abierto → `dev`**) | **impl COMPLETA (B1–B7) + reviewer APROBADO 0 bloqueantes** (rechazó 1.ª vez por R17 sin test + trazabilidad; ambos cerrados y re-aprobados). Causa tipificada al DEVOLVER (radios: `not_found`/`wrong_number`/`wrong_address`) + motivo libre que sigue obligatorio. Gate F1.4 aprobada por el humano: enum de 3 sin "Otro", columna NULLABLE sin CHECK, **solo rama `devuelta`**, **todas las causas cuentan igual como intento (feature 47 INTACTA)**, columna de **SOLO ESCRITURA a propósito** → mostrarla/agruparla es la **feature 74** (registrada). Migración con `down.sql` + **round-trip real** demostrado (devolución previa sobrevive con causa NULL). Primitiva `radio-group` sobre **`@base-ui/react`** (NO Radix — el spec_author cazó su propio error de `npx shadcn add`). **Worktree AISLADO `ordenex-f73` desde `origin/dev` `ccad206`** (NO sobre `flow`, que tenía WIP ajeno de fecha-cr en los mismos archivos). **Baseline REAL medido (no citado): typecheck 0, lint 0/139 warn, tests 2848✓/1✗** (el 1✗ = flaky `no-embalaje` preexistente). Suite final: **2906✓ / 8✗, TODOS `Test timed out 5000ms` en archivos ajenos** (HomePage*, OrdenesPagination, OrdenesModuleReuse) = flakes de carga preexistentes (mismos de la 72), tests de la 73 verdes en aislado. **PENDIENTE: merge del PR #78 (OK humano).** |
| feature/86-landing-publica | frontend | **F1 (spec)** | **REGISTRADA `pending` 2026-07-17.** Pedido: *"genera una landing page para la ruta /, para usuarios no logueados, con un topbar con trabaja con nosotros que lo lleve directo a postulaciones y ingreso junto con el logo, ingreso lleva al login, lo demas se mantiene, manten los colores que se estan usando, usa sdd y registra la feature"*. **EVALUACIÓN (verificada contra el código):** (1) **NO existe ninguna landing/hero** en el repo (grep `hero|landing|marketing` → 0) → *"lo demas se mantiene"* = "no cambies el resto de la app", NO "conserva la landing previa" (no la hay). (2) **PUNTO DURO — `/` YA ESTÁ OCUPADA:** `app/(app)/page.tsx` resuelve `/` ramificando por rol (adminTienda / maestro-admin / placeholder). Next no admite dos `page.tsx` en la misma ruta → **la landing obliga a mover el dashboard**. **Decisión del humano (gate adelantado):** landing en `app/page.tsx`, dashboard a `app/(app)/inicio/page.tsx`. (3) **2.º PUNTO DURO — middleware con `startsWith`:** la 78 (PR #85, YA MERGEADO) conservó `pathname.startsWith`; meter `/` en `PUBLIC_ROUTES` haría pública TODA la app → la `/` exige **match exacto** aparte de la lista; con cookie `session`, `/` redirige a `/inicio`. (4) **Contenido:** topbar (logo + "Trabaja con nosotros"→`/postulacion` + "Ingreso"→`/login`) + hero mínimo (wordmark + claim + 2 CTA). **NADA de marketing inventado** (regla 6 CLAUDE.md); único copy admitido = `metadata.description` ya existente. (5) **Logo:** extraer el wordmark de texto (`<span className="font-heading …">Ordenex</span>`, hoy duplicado en login/postulacion/recuperar-contrasena) a `components/shared/Logo.tsx`; **no hay asset de imagen** y `next/image` no se usa en el repo. (6) **Colores:** se reusan los tokens de `app/globals.css` (Tailwind v4, `@theme inline`, sin `tailwind.config`): `bg-navy #0b2545`, `bg-brand #f26419`, `brand-soft`, `font-heading`; CTA reusa `buttonVariants` variant `brand-outline`. **IMPACTO MEDIDO de mover el dashboard (grep):** `app/login/page.tsx:21`, `app/recuperar-contrasena/page.tsx:20` (`redirect("/")`) y `LoginForm.tsx:30,35` (`getRedirectTarget` default `/`) → pasan a `/inicio`; **el sidebar NO enlaza a `/`** (`href: "/"` → 0 coincidencias). **Zona frontend** (5/6 archivos UI/routing; el toque a `middleware.ts` es 1 regla de routing público, sin backend → NO se parte en fullstack). Conflicto potencial en `middleware.ts` con la 78: **PR #85 YA MERGEADO** (`263cdd1`), sin conflicto vivo. **⚠️ ERROR DEL LEADER, CORREGIDO:** un `git checkout feature_list.json` (para deshacer un reformateo CRLF propio) descartó el registro sin-commitear de las features **82-85**; se **reconstruyeron verbatim** desde la lectura previa (diff = solo altas, 0 borrados) antes de añadir la 86. **NO se hizo `git checkout -b`**: `flow` tiene WIP ajeno sin commitear (Sidebar, menu-visibility, Modal, TabsGroup, cierres-admin + tests) → rama desde `origin/dev` en F2.0. **SPEC v1 ENTREGADA** (`specs/86-landing-publica/`: R1–R16 todos con test mapeado, 16 tasks T0–T15, 3 preguntas abiertas — dark mode, tagline, ratificar nombre `/inicio`). Feature → **`spec_ready`**. **GATE F1.4 APROBADA por el humano 2026-07-17** + resolvió las 3 preguntas: (1) segmento **`/dashboard`** (NO `/inicio`); (2) **sin dark mode**; (3) **solo el copy existente**. El leader cazó y corrigió un residuo del renombrado en el spec: `%2Finicio`→`%2Fdashboard` (5 sitios × 2 copias) que había escapado al find/replace por estar URL-encoded. **F2 COMPLETA — PR #88 → `dev` ABIERTO.** Worktree aislado `ordenex-f86` desde `origin/dev` `243090a` (`.env` + `pnpm install --force` + `pnpm db:generate`; typecheck baseline 0). Impl por `frontend_dev` (commit `2083c65`, 21 archivos): `app/page.tsx` (landing: topbar + hero, reusa el brand-panel `bg-navy`+radial naranja+`bg-brand` y `buttonVariants` variant `brand-outline`), `components/shared/Logo.tsx` (wordmark extraído), **`git mv app/(app)/page.tsx → app/(app)/dashboard/page.tsx` con cuerpo INTACTO (0 líneas, rename puro)** conservando la ramificación por rol, `middleware.ts` (+12: `/` por **match EXACTO** ANTES de `PUBLIC_ROUTES`, con sesión→307 `/dashboard`, sin sesión→landing; `"/"` NUNCA entra en la lista `startsWith`), y los 3 redirects internos (`login`, `recuperar-contrasena`, `getRedirectTarget` — guarda open-redirect intacta) → `/dashboard`. Tests: `LandingPage`, `Logo`, `getRedirectTarget`, ampliación de `middleware.test.ts`, reapunte de `HomePage*`/`LoginPage`/`recuperar-contrasena-page`. **VERIFICADO (medido): typecheck 0→0, lint 0 err/140 warn, tests de la feature verdes (R1–R16 mapeados a test real).** `reviewer` **APROBADO 0 bloqueantes** (`progress/review_86-landing-publica.md`): trazabilidad R→test corrida en aislado (65 tests/10 archivos), rename sin alterar roles confirmado con `git show`, sin fugas de alcance, sin backend/DB. Único fallo residual de la suite = `CierreDiaPage.test.tsx` **preexistente** (drift PR #82, la 86 toca 0 archivos de cierres — demostrado). Hallazgo menor no bloqueante: R11 (layout `(app)` envuelve `/dashboard`) verificado solo estructuralmente, como el spec acepta. **PENDIENTE: merge del PR #88 (OK humano) → `done` + history.md. NO se hizo checkout sobre `flow` (WIP ajeno); trabajo aislado en worktree.** |
| feature/87-novedades-devueltas | fullstack | **F2.4 (PR #89 abierto → `dev`)** | **Ciclo SDD COMPLETO 2026-07-17: spec_author → gate F1.4 (humano) → backend_dev → frontend_dev → reviewer APROBADO 0 bloqueantes.** Pedido del humano: `/novedades` = lista de órdenes en devolución solo-adminTienda con botones de contacto (llamar/WhatsApp) del card de gestionar pedido; "genera tu propia rama fuera de flow". Worktree AISLADO `ordenex-f87` desde `origin/dev` @ 243090a (NO sobre `flow`). Orquestación DIRECTA del leader (sin `implementer`, bug opus-4.8[1m]; subagentes con `model:opus`). **ALCANCE (gate F1.4 humano):** "en devolución" = estatus `devuelta` (el humano lo describió como las de causa not_found/wrong_number/wrong_address → único estatus con `causa_devolucion`, feature 73; NO `devuelta_origen` ni `rechazada`); identificador `numGuia` (nullable→placeholder); orden más recientes primero; **paginación** 10/pág; causa NULL→"Sin causa registrada"; normalización tel 8díg→506. **SIN MIGRACIÓN** (solo lectura + UI; la causa existe desde la 73). **Backend:** `NovedadesService.listar` (forbidden si rol≠adminTienda) + action + 3 métodos de `OrdenRepository` (count, lista paginada, `findCausasDevueltaVigentes` en **UNA consulta agregada sin N+1**); criterio de vigencia = `anuladaAt IS NULL`+`resultado devuelta` (mismo de la 67, verificado contra código, no supuesto). **Frontend:** page solo-adminTienda (notFound rol + defensa en profundidad) + módulo con Pagination + **REFACTOR**: botones de contacto extraídos a `components/shared/ContactoButtons.tsx` con normalización E.164 CR (+506), `GestionarOrdenPanel` deja de duplicarlos inline y **hereda el fix del bug wa.me sin código de país**. Item sidebar "Novedades" restringido a `[adminTienda]` (mensajero deja de verlo). **REVIEWER rechazó 1.ª vez por 3 bloqueantes SOLO de bookkeeping/trazabilidad** (falta impl_87.md, tasks sin [x], R17 sin test) — código de producción aprobado; los 3 cerrados (commit `482513a`: test R17 en MisAsignacionesModule que ata el panel a ContactoButtons y se rompe si vuelve a inline; tasks [x]; impl_87.md con mapa R1..R22→test) y **re-APROBADO con evidencia** (28/28 aislado, diff acotado a 3 archivos no-producción). **MEDIDO:** typecheck 0, lint 0 err/140 warn, 22/22 requisitos con test. **2 rojos de suite completa AJENOS y medidos por el reviewer:** `HomePage` (flake timeout) y `CierreDiaPage` (deuda preexistente de dev/PR #82; diff de la 87 sobre ese archivo VACÍO). **BOOKKEEPING:** la entrada de `feature_list.json` (id 87) se registró en `flow`, NO viaja en el PR #89. **PENDIENTE: (1) merge del PR #89 (OK humano) → status `done` + history.md; (2) round-trip N/A (sin migración).** |
| feature/72-tests-recibido-origen | fullstack | F2.4 (**PR #76 abierto**) | **DEVUELVE `dev` A VERDE.** Fix ágil (`sdd:false`, patrón 58/#70), rama desde `origin/dev` `14f6548`. 5 commits. **MEDIDO: 18 fallos → 2**, y los 2 restantes **pasan en aislado** (`OrdenesModuleReuse`, `HomePage`: `Test timed out in 5000ms` bajo carga de suite completa) → **flaky preexistentes, NO regresión**. `pnpm lint` 0 errores. `pnpm typecheck` **sigue en 2** (los de la 68 — se arreglan en la rama de la **69**, no acá). **Contenido:** (1) conteos `ORDER_STATUS_SEED` 13→14 + test posicional del 14.º + menú (ítem QR) + `order-status-enum-migration` + denylist de `zonas-migration`; **ningún test borrado ni aflojado** (patrón #70). (2) **RESTAURA las 5 columnas** que el PR #75 borró por drift (revert exacto de `8541498` sobre `ordenes-columns.tsx`, verificado: diff vacío contra el estado pre-drift, conservando `d201f56`) + **elimina el `console.log('xyz')`** que estaba VIVO en `dev`. (3) **arregla el guard `no-embalaje`**: `.claude` a `IGNORED_DIRS` (escaneaba los worktrees del harness y encontraba su propio reflejo) — **verificado con canario**: se metió `embalaje` en `lib/types/order-status.ts`, el guard **falló señalando el archivo**, se quitó y volvió a verde → ignora exactamente lo que debe y **sigue cazando de verdad**. **PENDIENTE: PR a `dev` + merge (OK humano).** **DESBLOQUEA el T5 de la 69.** |

| feature/63-orden-lista-actualizada | fullstack | F2.4 (PR abierto) | **impl COMPLETA (R1–R20) + reviewer APROBADO 0 bloqueantes.** **PR #65 → `dev`** abierto. + Pedido humano: re-agregadas columnas (producto/dirección/zona/**monto a cobrar**/flete+IVA/fulfillment/comisión+IVA) y **adminTienda ahora VE Zona** (oculta solo Tienda). 50 tests propios/afectados verde; ordenes-columns R14-zona (era rojo baseline) ahora pasa. **PENDIENTE: merge del PR #65 (OK humano).** |
| feature/64-pwa-basic | frontend | F2.4 (PR abierto) | **impl COMPLETA (T1–T8) + reviewer APROBADO 0 bloqueantes.** **PR #72 → `dev`** abierto. PWA básica: manifest.json, SW vanilla, meta tags, íconos 192/512, página offline. 7 archivos nuevos, 2 modificados. typecheck 0 errores nuevos, build ok. Lighthouse pendiente manual. **PENDIENTE: merge del PR #72 (OK humano).** |
| feature/65-lestura-de-qr | frontend | F2.4 (PR abierto) | **impl COMPLETA (T1–T7) + reviewer APROBADO 0 bloqueantes.** **PR #73 → `dev`** abierto. Página `/qr` + item menú "QR" para todos los roles. 1 archivo nuevo, 2 modificados. typecheck 0 errores nuevos, lint 0, tests 0 regresiones. **PENDIENTE: merge del PR #73 (OK humano).** |
| feature/76-ranking-mensajeros | fullstack | **F1 (spec)** | **REGISTRADA `pending` 2026-07-16** (pedido del humano). Ranking BÁSICO de mensajeros por % de entregas exitosas + tabla de premios top 3 (inputs abiertos; vacío = sin premio). Página `/ranking` HOY es un STUB (`<PageHeader>`), ítem de menú ya existe (maestro+mensajero). Molde: módulo solo-maestro con agregación (`/wallet`, `/cierres-admin`); premios editables = tabla Prisma (patrón `GastoFijoPlantilla`). **`spec_author` en curso** → escribirá `specs/76-ranking-mensajeros/`. **NO se hizo checkout** (sesión en `flow` con WIP ajeno); rama se crea desde `origin/dev` en F2.0. Spec v1 entregada (R1–R20, T0–T11). **GATE F1.4 RESUELTA por el humano 2026-07-16**: (a/b) ranking **DIARIO** = `entregas exitosas del día / órdenes asignadas del día` (hoy CR, NO histórico); (c) mínimo de muestra configurable **default 1**; (d) premio = solo monto ₡ nullable; (e) maestro edita+ve, **mensajero ve todo solo-lectura** (se queda en menú); (f) % redondeo server 1 decimal. Spec v2 = modelo DIARIO (R1–R22, T0–T12). **DS1 RESUELTA (humano)**: se agrega `orden.asignado_at` (nullable, migración aditiva) estampada en CADA asignación/reasignación de repartidor; denominador = órdenes del mensajero con `asignado_at` de hoy (join orden→mensajero). Choke-point: enumerar TODOS los writers de `mensajero_asignado_id`. Limitación residual documentada (devolución intradía limpia mensajero → leve inflado del %). **SPEC APROBADO por el humano 2026-07-16 → F2.0.** Spec final: R1–R24, 16 tasks (T0a/b/c choke-point de `asignado_at` en 4 writers + 3 paths de limpieza; T1-T7 backend; T8-T10 frontend). Worktree aislado `ordenex-f76` desde `origin/dev` `a014515` (ya incluye la 75 mergeada, PR #79). Orquestación DIRECTA del leader. **BACKEND HECHO** (commit `0388bde`): typecheck 0, lint 0, **tests 2963/2963**; 4/4 writers de `asignado_at` + 3/3 limpiezas instrumentados (verificó líneas reales de dev, difieren del spec); migraciones `orden_asignado_at` + `premio_ranking` (con `descripcion`) validadas ESTÁTICAMENTE (sin Postgres en el entorno → **round-trip real pendiente para el reviewer/humano**). **AMPLIACIÓN**: campo `descripcion` en premios (R25) incluido en backend. **FRONTEND HECHO** (commit `154a385`): typecheck 0, lint 0, tests 2978/2979 (1 flaky ajeno `LoginForm`, verde en aislado). Página `/ranking` + módulo tabla + inputs monto/descripción + menú. HALLAZGO: en `origin/dev` NO existían la página stub ni el ítem de menú `/ranking` (eso vivía solo en `flow`) → se crearon desde cero (maestro+mensajero, R20). **REVIEWER APROBADO** (0 bloqueantes, 2 menores de bookkeeping ya cerrados): typecheck 0, lint 0, `./init.sh` verde 2979/2979, trazabilidad R1–R25+LC1 con tests reales, choke-point confirmado con grep propio (4/4 writers + 3/3 limpiezas), SQL de migraciones correcto a mano. **F2.3 SYNC CON DEV**: `dev` avanzó `a014515→d4b6e48` (**PR #80 mergeó `flow`**, trayendo el stub de ranking + ítem de menú + reglas de cierre en asignación). Conflictos: `ranking/page.tsx` (resuelto=ours, impl completa), `Sidebar`/`menu-visibility`/su test (resuelto=theirs; `dev` ya traía el ítem de menú maestro+mensajero desde `flow`; comentario R20 corregido), y `OrdenRepository` (conflicto de archivo completo: las reglas de cierre en asignación de `flow` chocan con nuestra instrumentación `asignado_at`). **OrdenRepository RESUELTO** (backend_dev: base=dev, delta asignado_at re-aplicado, 4 writers instrumentados, dev NO añadió writers nuevos; typecheck 0, lint 0, backend 494/494). Pero la suite completa tiene **15 fallos REALES de integración FRONTEND** del merge de dev (unión menú Novedades+Ranking, mapa de estatus del seed nuevo, "Devolver a la tienda") — ninguno en OrdenRepository/ranking, reproducen en aislado. Merge cerrado (commit `50270bb`): typecheck 0, lint 0, **tests 3069✓/2 flaky** (HomePage/zona-form, pasan en aislado). 6 grupos de regresiones de integración del merge resueltos sin aflojar tests (label `devuelta_origen`, unión menú Novedades+Ranking, portal adminSatelite, "Devolver a la tienda", evidencia duplicada, columna `ingresoBodegaRechazos`). **PR #81 → `dev` ABIERTO** (F2.4). **PENDIENTE: (1) merge del PR #81 (OK humano) → status `done` + history.md; (2) ROUND-TRIP REAL de las 2 migraciones (`orden_asignado_at`, `premio_ranking`) contra Postgres — validadas solo estáticamente, SQL revisado a mano por el reviewer.** |
| feature/81-api-keys | backend | **F2.4 (PR #86 abierto → `dev`)** | **Ciclo SDD COMPLETO 2026-07-16/17: spec_author → gate F1.4 aprobada → backend_dev → reviewer APROBADO 0 bloqueantes.** Orquestada DIRECTO por el leader (sin `implementer`, bug opus-4.8[1m]). Worktree aislado `ordenex-f81` desde `origin/dev` `a0957ec`. Commits `c0e37d6` (impl, 29 archivos) + review + merge de `dev`. **ALCANCE ACOTADO POR EL HUMANO a "solo generar y asignar"** → consumo de la key (middleware/header) y UI = **81a/81b, SIN registrar aún**. **GATE F1.4: las 8 decisiones D1–D8 aprobadas con la recomendación, CERO overrides** (ver el bloque resuelto al inicio de la sección "Decisiones abiertas" de `specs/81-api-keys/requirements.md`). D1 rol nuevo `apiKey` **sin filas en `rol_permiso`** = fallo seguro; `down.sql` **recrea el tipo** (Postgres no soporta `DROP VALUE`). D4 usuario sintético `apikey+<slug>@apikey.invalid` (RFC 2606) + `cedula APIKEY-<slug>` porque ambos son UNIQUE NOT NULL → **el cierre del login es "DE FACTO" (contraseña random e ignota), NO por construcción**; el rechazo duro en `AuthService.login` es 81a. D7 **la key con SHA-256, NO bcrypt** — el `spec_author` REFUTÓ al leader, que había pedido bcrypt, y tenía razón (key de 256 bits sin diccionario que atacar; bcrypt = ~100 ms/request en 81a y sin lookup por hash); **la contraseña del usuario SÍ sigue en bcrypt**. **VERIFICADO (MEDIDO, no citado):** typecheck 0, lint 0 err/140 warn, **3181✓/5✗** (los 5 ajenos, ver abajo); **round-trip REAL** de la migración contra Postgres por el implementador y **REPETIDO INDEPENDIENTEMENTE por el reviewer** en DB desechable (`RLS=true`/0 policies, `ROL_PERMISO_APIKEY=0`, enum revertido sin tipo huérfano, duplicado rechazado en vivo por `api_key_key_hash_key`); `git diff` sobre `AuthService.ts`/`middleware.ts` **VACÍO** = cero fugas de alcance. **2 regresiones REALES causadas por el 6.º valor del enum** (`seed-catalogos` contaba 5 roles; `zonas-migration` = la allowlist frágil de la deuda (b), que **se volvió a romper como estaba previsto**) **arregladas SIN aflojar**: conteos exactos (`toBe(6)`, no `toBeGreaterThan`), auditado por el reviewer con lupa (riesgo PR #75). **TRAMPA DE BASELINE NUEVA, cazada por el backend_dev:** en árbol limpio el typecheck falla (TS2741 en `rol-label.ts`) **por el cliente Prisma generado**, no por el código → sin `pnpm db:generate` desde el schema limpio, **el baseline sale contaminado**. **T18 quedó `[ ]` a propósito** (su condición era "solo si el humano lo pide"). **PENDIENTE: (1) merge del PR #86 (OK humano) → `done` + history.md; (2) `./init.sh` NO está verde** — pero por el fallo ajeno de `CierreDiaPage` (ver abajo), no por la 81; CHECKPOINTS.md exige init.sh verde para cerrar. |
| feature/82-api-keys-ui | fullstack | **F2.4 (PR #87 abierto → base `feature/81-api-keys`, NO `dev`)** | **Ciclo SDD COMPLETO 2026-07-17: spec_author → gate F1.4 aprobada → backend_dev → frontend_dev → reviewer APROBADO 0 bloqueantes.** Orquestada DIRECTO por el leader. **Es la 81b** (UI de gestión de API keys en `Configuración > API`, solo-maestro). **APILADA sobre `feature/81-api-keys`** (base `1ebc350`) porque el PR #86 de la 81 **no está mergeado a `dev`** → **mergear #86 ANTES del #87**, o rebasear a `dev` después. Worktree `ordenex-f82`. Commits `28dbd2a` (backend listado) + `9890a09` (guardia R19) + `b932d34` (frontend) + review. **ALCANCE: generar + listar** (revocar/expirar = follow-up; consumo de la key = 81a sin registrar). **ANDAMIAJE YA EXISTÍA** (verificado): submenú `API` en `menu-visibility.ts:107` + página placeholder ya autorizada a `maestro` → la feature RELLENA, no crea ruta/menú. **Backend nuevo:** `listarApiKeys` paginada (la 81 solo tenía `generarApiKey`). **Gate F1.4: D1–D7/D9 con la recomendación; D5 (UX del secreto) elegida EXPLÍCITAMENTE por el humano** = modal con checkbox obligatorio "Ya guardé la clave" que habilita el único cierre, Escape/click-fuera deshabilitados (`dismissible={false}`+`hideCancel` del Modal 13). **D8 falsa alarma** (el `spec_author` reportó que la 82 no está en `feature_list.json`; CIERTO desde el worktree porque el archivo vive sin commitear en `flow` → todo subagente lo ve stale; no es hallazgo). **🔴 REESCRITURA DE LA GUARDIA DE R19 DE LA 81** (commit `9890a09`, el punto delicado): el 6.º… no, la 82 añadió `list`/`count` a `IApiKeyRepository` y rompieron `expect(Object.keys(repo)).toEqual(["createConUsuario"])`. El backend_dev **PARÓ en vez de aflojar** y lo trajo; el leader aprobó reescribirla con condición de que quede **más fuerte**. Resultó que la vieja estaba **ROTA** (corría sobre el mock, no el prototipo → `Object.keys`=`[]`) y medía cardinalidad, no irrecuperabilidad. La nueva (`api-key-repository.secreto.test.ts`) recorre el prototipo (robusta a métodos futuros) + afirma sobre el objeto serializado con Prisma fake que honra `select` sobre fila envenenada + control negativo. **EL REVIEWER LO VERIFICÓ POR MUTACIÓN** (inyectó `keyHash:true` en `LIST_SELECT`, el test falló, restauró). **NO es el incidente del PR #75.** **VERIFICADO (MEDIDO):** typecheck 0, lint 0 err/140 warn, **feature 82 = 97/97 tests**; alcance limpio (no toca `AuthService`/`middleware`/`schema.prisma`/migraciones), sin `console.*`, authz server-side en 2 capas. R6 (secreto/hash nunca cruza al cliente) por CONSTRUCCIÓN. **PENDIENTE: (1) merge del PR #86 (la 81) primero; (2) merge del PR #87; (3) `./init.sh` NO verde por el `CierreDiaPage` ajeno, no por la 82.** |
| worktree-bloqueo-checkbox-cierre | fullstack | F2.4 (**PR abierto → `dev`**) | **Feature 77 — fix ágil (`sdd:false`), impl COMPLETA + reviewer APROBADO 0 bloqueantes.** Pedido: *"en la lista de ordenes del maestro debe inhabilitar el checkbox de la columna, cuando la bodega satelite tenga al menos 1 mensajero con cierre abierto"*. **CONTINUABA UN WIP DEL HUMANO QUE RESOLVÍA MAL EL PEDIDO**: flag **GLOBAL** derivado de los `bloqueadosIds` de los mensajeros **GAM** que bloqueaba toda la tab, ignorando la zona de cada orden y sin cubrir las satélite. 🔴 Ese WIP **había reintroducido `console.log("xyz", ...)`** en `OrdenesTabs.tsx` — **el mismo incidente del PR #75** (5.º caso del patrón de drift) → **eliminado**. **DECISIONES DEL HUMANO 2026-07-16**: (a) bloqueo en **AMBAS** bodegas (central + satélite) con umbral **≥1**; (b) la regla del **backend se unifica a ≥1**, lo que **REVIERTE A PROPÓSITO** el relajado de la **feature 41** (`porMensajeros` = "TODOS los mensajeros bloqueados", pedido en su día por el admin_satelite); (c) en la tab `en_bodega` se **ACEPTA** que bloquear la fila también impida "Imprimir etiquetas" (checkbox único compartido por las acciones por lote). **DISEÑO — la central es UNA ZONA MÁS**, así que una sola regla cubre ambos casos: `findZonasConMensajeroBloqueado()` (**1 query agregada + `distinct`, sin N+1**; lee `usuario.zonaId` **vivo**, NO el snapshot `cierre_dia.destino_zona_id`; **reutiliza `ESTADOS_CIERRE_BLOQUEANTES`** = misma fuente de verdad que `findMensajerosBloqueados`, para que **lectura y escritura NO diverjan**) → action `listarZonasBloqueadasPorCierre()` (authz maestro+admin) → la UI bloquea **POR-ORDEN** comparando `orden.zonaId` contra el set. Zona sin mensajeros → NO bloqueada; `zonaId` null → NO bloquea. Convive con el bloqueo previo de `rechazada` (evaluado primero, más específico). Tabs de asignación: `en_fulfillment`/`en_preparacion`/**`en_bodega`** (esta la **omitía el WIP**; su `accionesDe()` sí asigna y rutea). **BUG LATENTE CORREGIDO DE PASO** (hallazgo del reviewer): `mensajerosFetcher` devolvía un **array** mientras `OrdenesRevisionMaestro` devolvía un **objeto** **bajo la misma key SWR `"ordenes:mensajeros"`** → formas incompatibles según quién montara primero. **TESTS NI BORRADOS NI AFLOJADOS**: los de la 41 se **INVIRTIERON** al sentido nuevo; además se **re-aisló** un test de la causa (ii) que con la regla ≥1 ya no probaba lo que su nombre decía (usaba 1 de 2 bloqueados, que ahora bloquea por (i)). **VERIFICADO (MEDIDO, no citado)**: typecheck 0, lint 0 err/140 warn, **suites de la feature 141/141 en aislado**. Los ~16-20 fallos de la suite completa son **AJENOS PREEXISTENTES de `dev`** (`EstatusLabel` + 2 de `menu-visibility` = fallos REALES de otro WIP; resto = flakes de timeout 5000ms bajo carga). **EL REVIEWER NO ACEPTÓ ESA CLASIFICACIÓN A CIEGAS**: `CierresAdminModule.test.tsx` fallaba y ese componente **sí** está tocado, así que **levantó un worktree limpio de `origin/dev` `d4b6e48` y midió** → falla **igual en dev** (contaminación cruzada con `CierreDiaModule.test.tsx`; pasa 20/20 en aislado en **ambas** ramas). **DEUDA MENOR (no bloqueante)**: `ESTADOS_ASIGNACION` está acoplado **por convención** a `accionesDe()` → si una tab gana una acción de asignación, **el bloqueo se pierde EN SILENCIO**; sin guarda. Incluye un cambio NO relacionado del WIP del humano, conservado tal cual: `CierreDiaModule.tsx` oculta las secciones sin registros. **PENDIENTE: merge del PR (OK humano).** |


> **Feature 67 (deshacer gestión: devolver una orden a gestión) CERRADA 2026-07-15**: **impl COMPLETA (R1–R38) + reviewer APROBADO 0 bloqueantes de código.** El RECHAZADO inicial fue SOLO por 2 gates **documentales del leader** (T22/T23 sin marcar + bitácora stale), ya cerrados — precedente 59. Ciclo SDD completo orquestado DIRECTO por el leader (`spec_author` → **F1.4 aprobada, las 9 recomendadas sin overrides** → `backend_dev` → `frontend_dev` → `reviewer`), evitando el `implementer` monolítico (bug opus-4.8[1m]).
> **ALCANCE RECORTADO EN LA EVALUACIÓN, y fue lo más valioso:** el pedido tenía dos mitades y **la primera YA EXISTÍA** (verificado, no supuesto): la gestión nace con `cierre_id=NULL` (36) y `CierreDiaRepository` lista exactamente esas (37/R2-R3), así que las 4 tablas ya se llenaban solas. El humano confirmó que era contexto → la feature fue **solo el deshacer**.
> **Lo difícil no fue el botón, fueron 2 cosas que ningún test existente cubría:** (1) que la gestión anulada quede fuera de los **3 `WHERE`** — `findGestionesPendientes:120`, **`crearCierre:196`** (el `updateMany` donde la wallet la habría cobrado al aprobar) y `CorteDiario:33`; (2) que **el intento anulado deje de contar** para el escalado automático a `rechazada` (47), filtrando **en lectura** sin romper la inmutabilidad del historial (49), y desambiguando por `origen_tipo` porque `gestion_orden_id IS NULL` significa dos cosas distintas ("nunca tuvo gestión" vs "se borró"). Ante la duda, **la huérfana NO cuenta** (contar de menos es inofensivo; contar de más cobra mal).
> **Deshacer NO es "volver al estado anterior":** una gestión `devuelta` deja la orden en `en_bodega*` con `mensajero_asignado_id` LIMPIO (47) → hay que reponer la asignación (R19).
> **F1.4-i implementada:** la FK `orden_historial_estado.gestion_orden_id` volvió de `SET NULL` a **`RESTRICT`**, completa (modelo + SQL). Nació de un **error del spec** que el leader cazó: afirmaba que el DELETE era imposible por una FK `RESTRICT` cuando la `20260714123909` (PR #66, del día anterior) la había dejado en `SET NULL` — verificado contra la base viva. La decisión de anular seguía bien, pero por el diseño append-only, no por una protección inexistente.
> VERDE (medido por el leader, **re-medido independientemente por el reviewer**): **2764 tests / 296 archivos / 0 fallos**, typecheck **2 = baseline exacto**, lint 0 errores, `migrate diff` sin drift, round-trip REAL de las 2 migraciones (el reviewer lo repitió en tx con ROLLBACK). Estado vivo: enum 12, FK `confdeltype='r'`, RLS true/0 policies. Estado `done` + `history.md` + `impl_64`/`review_64`. **PENDIENTE: PR a `dev` + merge (OK humano).**

> **BASURA A LIMPIAR (leader, 2026-07-17):** quedó el directorio `../ordenex-devcheck` (worktree efímero que
> levanté para medir `CierreDiaPage` contra `dev` limpio). Su `git worktree remove` falla: un proceso del
> `pnpm test` que maté mantiene bloqueados archivos bajo `node_modules/.pnpm`. **No está registrado como
> worktree activo**; se borra con `rmdir /s /q` una vez muerto el proceso. No contiene trabajo.

> ### 🔴 `dev` ESTÁ ROJO OTRA VEZ: EL PR #82 CAMBIÓ EL COMPORTAMIENTO SIN ACTUALIZAR SU TEST (7.º caso de drift)
> Descubierto 2026-07-17 por el leader al sincronizar la feature 81 con `dev`. **NO es un flake y NO es de la 81.**
> **QUÉ ES:** `tests/components/CierreDiaPage.test.tsx > R1` falla **EN AISLADO** (medido, no supuesto):
> `Unable to find an accessible element with the role "region" and name "Entregadas"`.
> **CAUSA, trazada con `git log` por archivo:** el **PR #82** (feature 77) mergeó a `dev` un cambio de
> `CierreDiaModule.tsx` que **oculta las secciones sin registros** — un cambio **NO relacionado** con la 77,
> arrastrado del WIP del humano y "conservado tal cual" (así está anotado en la fila de la 77, arriba).
> Pero el test que afirma que esas secciones se renderizan **no se toca desde la feature 41** (`dde6fba`).
> Comportamiento nuevo, test viejo → rojo.
> **DÓNDE ESTÁ EL ARREGLO:** la corrección del test vive **SIN COMMITEAR en la rama `flow`**
> (`tests/components/CierreDiaPage.test.tsx` aparece modificado en el working tree). El WIP del humano tenía
> las dos mitades; **el PR #82 se llevó solo la del código y dejó la del test atrás.**
> **POR QUÉ IMPORTA:** es el mismo patrón que el PR #75, y la razón por la que cuesta verlo es que
> `CierreDiaPage` está sepultado entre los flakes de timeout conocidos (`HomePage`, `HomePageRol`,
> `OrdenesModuleReuse`, que **sí** pasan en aislado). **Clasificarlo como flake sin medir era el error fácil**
> — el reviewer de la 81 casi lo hace (vio conjuntos de fallos distintos entre corridas y lo llamó ajeno/flake);
> lo que lo desmintió fue correrlo **solo**. Un fallo real escondido en un pantano de flakes es exactamente la
> deuda (e) cobrándose: el pantano no es cosmético, **camufla regresiones**.
> **BLOQUEA cerrar la 81 como `done`** (CHECKPOINTS.md exige `./init.sh` verde) aunque la 81 esté limpia.
> Arreglo previsible: commitear el test de `flow`. **NO lo hice**: es WIP del humano y no me consta su intención.

> ### 🔴 EL PR #75 METIÓ UN `console.log` DE DEBUG EN PRODUCCIÓN Y BORRÓ 5 COLUMNAS PEDIDAS POR EL HUMANO
> Descubierto 2026-07-15 (feature 72). **4.º caso documentado del mismo patrón**: PRs que revierten en
> silencio el trabajo de otros (el #40 revirtió la 51 · el #64 revirtió la 49 · la geografía volvió a Ecuador
> 3 veces · ahora el #75 sobre la 63). `ordenes-columns.tsx` es un **imán de drift**: la propia 63 ya tuvo que
> corregirlo (`6b8dd01 fix(63): revertir drift de columnas fuera de alcance`).
> **QUÉ ES:** el commit `8541498` (mensaje: literalmente `qr`) tocó
> `app/(app)/ordenes/_components/ordenes-columns.tsx` **sin ninguna relación con QR**. Es **ANDAMIAJE DE
> DEPURACIÓN COMMITEADO POR ERROR**: alguien depuraba "Flete + IVA", metió el helper inline, dejó
> **`console.log('xyz', tarifa, tarifa.ivaFlete, valueIva)`** y borró las columnas de alrededor para aislar la
> que investigaba. **EL LOG SIGUE VIVO EN `origin/dev`, LÍNEA 109**, corriendo en cada render de cada fila y
> volcando el objeto tarifa a la consola. Nadie deja un log llamado `xyz` a propósito.
> **QUÉ SE PERDIÓ (era PEDIDO EXPLÍCITO del humano en la 63** — el commit anterior en ese archivo es
> `81f2105 feat(63): re-agregar columnas de la lista de ordenes (pedido humano)`**):** las 5 columnas
> **Producto / Dirección / Monto a cobrar / Fulfillment / Comisión + IVA**, los helpers `calcularFleteConIva`
> y `calcularComisionConIva` (espejo de `derivarIngresoOrden`), y el fallback `?? row.zonaNombre` de Zona.
> **LO IMPORTANTE, Y ES UNA LECCIÓN DE PROCESO:** los 5 tests que lo cazaban **estaban rojos y nadie los
> miró**. El `backend_dev` de la 72 **paró** en vez de actualizarlos: bajar la aserción de 18 a 13 columnas
> habría dado VERDE a la desaparición de los montos del listado (el test D1 se llama literalmente *"renderiza
> las 18 columnas… (R18, R19, R24, R26)"*). **Una regresión encubierta bajo un test verde es peor que el
> rojo.** Y el humano preguntó *"¿por qué los borró?"* en vez de aceptar el "fue accidental" del leader — sin
> esa pregunta no se habría encontrado el `console.log`.
> **DEUDA registrada, NO saldada** (decisión del humano): **no hay regla `no-console` en el lint** → por eso
> el debug pasó el gate. Hay **11 `console.log` en 7 archivos de producción** (`GeografiaSelector`,
> `CobroVehiculoTarifas`, `mis-asignaciones/page.tsx`, `OrdenesTabs`, `ordenes-columns`,
> `lib/actions/mis-asignaciones.ts`, `OtpChallengeIssuer`); algunos podrían ser intencionales → revisar uno
> por uno, feature aparte. El `xyz` sí se elimina en la 72.

> ### ⚠️ OJO — el "2764 / 0 fallos" de arriba **CADUCÓ**: `dev` está ROJO también en TESTS (feature 72)
> Ese número era cierto cuando se midió, pero **el PR #75 lo invalidó** y nadie lo actualizó. Descubierto
> 2026-07-15 por el `backend_dev` de la feature 69 al **medir el baseline en un worktree limpio en vez de
> creerle al leader** — que se lo había pasado citando esta bitácora **sin re-medirlo**. Confirmado
> independientemente por el leader sobre una rama limpia de `origin/dev`.
> **MEDIDO en `origin/dev` `14f6548`: Test Files 9 failed | 288 passed (297); Tests 17 failed | 2754 passed
> (2771).** Causa raíz única: el PR #75 aterrizó `recibido_origen` como **14.º** valor de
> `ORDER_STATUS_SEED` sin actualizar los tests que los cuentan (siguen esperando 13). Arrastra 8 archivos +
> `zonas-migration.test.ts` (la denylist frágil, deuda (b): se predijo que se rompería con la próxima
> migración y **se rompió**). → **feature 72** (fix ágil, solo `tests/`) lo devuelve a verde.
> **LECCIÓN DE ARNÉS:** un baseline citado de la bitácora **no es un baseline medido**. `current.md` es
> estado vivo y caduca en cuanto entra un PR ajeno (ver la deuda de sesiones paralelas). Medí antes de
> afirmar; el subagente hizo lo correcto al no creerle al leader.

> ### ⚠️ La feature 68 dejó de ser opcional: **`dev` NO COMPILA** — ✅ RESUELTO por la feature 69 (2026-07-15)
> **Cerrado:** el bloque 0 de la feature 69 (que absorbió la 68) dejó **typecheck 2 → 0** y **`pnpm build`
> ROJO → VERDE**, medido. La decisión de diseño que lo bloqueaba está resuelta: tarifa por TIENDA
> (`orden.tienda_id` → `tarifas.tienda_id`), la zona sigue eligiendo la columna GAM/no-GAM vía
> `zona.esCentral`. `./init.sh` sigue rojo, pero **ya no por typecheck**: ahora cae en `pnpm test` por los
> 17 rojos del PR #75 (feature 72, arriba). Se conserva el registro histórico:
> Descubierto 2026-07-15 al correr `pnpm build` por primera vez en el cierre de la 64, y **confirmado por el reviewer**. `pnpm build` **FALLA** en `lib/repositories/TarifaVigentePorZonaRepository.ts:22` (`'zonaId' does not exist in type 'TarifaWhereInput'`): Next.js corre `tsc` al construir. Cuando el humano aparcó el bug ("aún no llegamos a esa parte del flujo"), ni él ni el leader sabían esto. **No es un bug dormido de runtime: bloquea el despliegue.** Los mismos 2 errores hacen que `./init.sh` (ya honesto, PR #67) corte en typecheck sin llegar a los tests → la verificación de la 64 se hizo con `pnpm test`/`typecheck`/`lint` **directos**, y así se reporta. Sigue necesitando **decisión de diseño del humano**: "tarifa vigente por ZONA" no está definido si la tarifa cuelga de una TIENDA.

> **SANEAMIENTO 2026-07-14/15 (sesión del leader).** `dev` estaba ROJO y nadie lo sabía: **28 tests fallando y 35 errores de typecheck**. Culpable bisectado: **PR #64 "adjustments"** (`2616233`) — `26b6c19` (PR #63) VERDE, `8706032` (PR #64) ROJO. Saldado en 4 PRs, todos mergeados:
> - **#66** — `down.sql` faltante en `20260714123909` (única de 45 sin reversa; round-trip verificado contra Postgres local).
> - **#67** — **el gate de `init.sh` MENTÍA.** `run_if` usaba `A && { B } || C`: si un script fallaba, caía en el `||`, reportaba "script no definido, se omite" y devolvía 0 → `init.sh` daba **"init OK" con la suite roja**. Por ahí se coló el #64. Ahora distingue pnpm-ausente / script-no-definido / **script-falló → rojo + exit 1**.
> - **#68** — 4 bugs REALES que los tests rojos cazaban bien: (1) **`<ZonasModule>` borrado del render de `/configuracion`** → el maestro NO podía administrar zonas; encadena con que `esCentral` solo se marca ahí y sin él `findCentralZonaId()`=null y no se asignan órdenes (la feature 59 quedaba inalcanzable). (2) geografía de ejemplo de vuelta a **Ecuador por 3ª vez** (51 arregló → #40 revirtió → 54 restauró → #64 revirtió); ahora San José/San José/Carmen verificado contra los XLSX reales. (3) `GuiaAsignacionService` había perdido la **guarda de catálogo** (casteaba `as string` sin chequear null). (4) `zonas-migration.test.ts`: el #64 apendió 7 migraciones sin extender su denylist.
> - **#70** (reemplaza al #69, que se mergeó contra la rama base ya consumida) — migra los **tests de tarifas** al modelo `tiendaId`/`status`. Solo `tests/`, cero producción; 77→84 tests, ninguno borrado ni aflojado.
>
> **Resultado: suite 2652/2652 VERDE** (294/294 archivos). typecheck **35 → 2**. **`init.sh` sigue ROJO y con razón**: corta en typecheck por los 2 errores reales de la **feature 68**. Hasta saldarlos no sirve de semáforo de arranque.
>
> **DEUDAS DE ARNÉS NUEVAS (2026-07-15, feature 72):** (e) **SUITE FLAKY → `init.sh` NO DETERMINISTA.**
> `OrdenesModuleReuse`, `HomePage` y `HomePageRol` fallan con `Test timed out in 5000ms` **bajo carga de suite
> completa** y **pasan en aislado** (verificado por el leader y por 2 subagentes; el conteo varía entre
> corridas: 3 en una, 2 en otra, 5 en otra → prueba de que no son determinísticos). **Esto es serio para el
> arnés, no cosmético:** `./init.sh` corre `pnpm test`, así que **el semáforo de arranque puede dar rojo sin
> que nada esté roto** — y eso es exactamente lo que entrena a la gente a ignorarlo, que es como se coló el PR
> #64 (ver #67: "el gate de init.sh MENTÍA"). Un gate que miente por exceso envenena igual que uno que miente
> por defecto. Candidatos: subir el timeout de vitest, aislar esos 3 en su propio proyecto, o `retry` acotado.
> **La feature 69 lo va a chocar de frente en T5**, que exige `./init.sh` VERDE. (f) **`.claude/worktrees/`
> tiene trabajo HUÉRFANO**: `menu-config-submenu` (`b6791c2 feat(menu): submenu en Configuracion; Ordenes sin
> submenu`) **no está en `dev` ni en ninguna rama**. Nadie lo reclamó; se pierde el día que alguien limpie
> worktrees. NO se tocó. (g) **`ordenes-columns.tsx` es un IMÁN DE DRIFT** (2 incidentes ya: `6b8dd01` de la
> propia 63, y ahora el #75) → candidato a que el reviewer lo mire con lupa en todo PR que lo toque.
>
> **DEUDAS DE ARNÉS (no saldadas):** (a) **`jq` ausente + regla 4 rota de origen.** `init.sh` trata la falta de `jq` como `warn`, no `fail`, y las reglas 3 (una feature por zona) y 4 (specs presentes) viven dentro de un `if` dependiente de `jq` → **nunca corrieron** acá. Se instaló `jq` (winget; requiere shell nueva) y eso **arma una mina**: la regla 4 busca `specs/<name>/requirements.md`, pero la convención REAL del repo es **`specs/<id>-<slug>/`** (`24-gestion-zonas`, `63-orden-lista-actualizada`). Solo matchean por casualidad las 6 features de nombre de una palabra (`login`, `modal`, `paginacion`, `notificaciones`, `permissions`, `ordenes`) → con `jq` presente, `init.sh` fallaría listando **53** features. Medido: con la convención real (`<id>-<slug>`) quedarían **18** sin spec de verdad (ids 2,4,5,7,9,10,12,14,15,16,18,19,28,51,52,53,54,61 — las tempranas + los fix-features ágiles de spec inline). Opciones: (i) acotar la regla a features NO `done` (su intención real: "si la empezaste, debe tener su spec"; hoy pasaría), (ii) corregir el patrón a `<id>-<slug>` y saldar los 18 históricos, (iii) añadir un campo `spec_path` explícito por feature. (b) `zonas-migration.test.ts` usa **denylist de migraciones apendidas después** → se pondrá rojo con la próxima migración; patrón frágil, es lo que lo rompió. (c) el fake de `IUserRepository` está triplicado y el de `IOrdenRepository` lista ~30 métodos a mano → cada método nuevo del contrato rompe N archivos; un builder en `tests/helpers/` lo mataría de raíz. (d) `cancelled` no pertenece al vocabulario del arnés: las anuladas llevan `sdd:false` para que la regla 4 no les exija spec; el arreglo limpio es enseñarle el estado a `init.sh`.

> **Feature 63 (Orden lista actualizada) CERRADA 2026-07-14** (PR #65 mergeado). **CIERRE CON MATIZ**, verificado antes de marcar `done`: el reviewer la había **RECHAZADO** por 1 bloqueante — sus commits colaron en `ordenes-columns.tsx` cambios FUERA DE ALCANCE (columna `zona`: 14 vs 13; headers `Estatus`→`Estado`, `Flete`→`Flete + IVA`) que regresaron 3 tests VERDES (OrdenesPage D1/D3, AdminTiendaDashboard R11). El reviewer ofrecía revertir **o** ratificar con tests actualizados: se tomó la segunda — el PR #64 actualizó `OrdenesPage.test.tsx` y `AdminTiendaDashboard.test.tsx`. Verificado hoy: **15/15 verde** afirmando `Estado`/`Flete + IVA`/columna `Zona` (tests actualizados, NO borrados). Núcleo R1–R20 verde (92 tests propios).

> **Features 35, 60 y 62 ANULADAS 2026-07-14** por decisión explícita del humano (el flujo tomó otro rumbo). NO se borran: `status: cancelled` + `status_note` con el motivo, por trazabilidad. Nota de la 62 ("Orden flete") por si vuelve: su `depends_on: 57` (logout) parecía error de dato, y el tema tocaba de lleno la **feature 68** (el flete sale de la tarifa, que el #64 remodeló a por-tienda).

> **Feature 68 REGISTRADA `pending` 2026-07-14 — BUG REAL, APARCADO A PROPÓSITO** por el humano ("aún no llegamos a esa parte del flujo"). `TarifaVigentePorZonaRepository:22` consulta `where: { zonaId }` sobre `tarifa`, columna que el #64 borró. **NO es código muerto**: `cierres-admin.ts:69,74` lo inyecta en `WalletFeedService`/`WalletTiendaFeedService` → **aprobar un cierre reventaría en runtime** (`Unknown argument zonaId`). Verde en tests porque TODOS mockean esa interfaz: la implementación real no tiene cobertura. **NO es fix mecánico** `zonaId`→`tiendaId`: "tarifa vigente por ZONA" deja de estar definido si la tarifa cuelga de una TIENDA → decisión de diseño del humano.

> **Feature 59 (zonas: seleccionar distritos de VARIOS cantones) CERRADA 2026-07-13**: **FRONTEND PURO** (sin backend, migraciones ni cambios de contrato; `crearZona`/`actualizarZona` intactos; `arbolZonas()` SOLO lectura). Ciclo SDD completo (spec_author → **F1.4 aprobada, todas las recomendadas** → frontend_dev → reviewer). `selected` migrado a `Record<string,DistritoSeleccionado>` como **fuente de verdad única** → cambiar de provincia/cantón NO resetea la selección; **resumen agrupado provincia→cantón** (`data-testid="resumen-distritos"`, `role="group"`) con **"Quitar"** por distrito (`aria-label="Quitar <distrito>"`); **sync bidireccional** resumen↔checkbox; contador `distritos-seleccionados` conservado; R10 heredada (distritos de otra zona `disabled`, fuera del conjunto); **pre-marcado multi-cantón en edición** vía SWR `["zonas:arbol",zona.id]` sobre `arbolZonas()` (siembra `selected` para TODOS los cantones/distritos de la zona, merge idempotente); envío intacto `distritoIds=Object.keys(selected)`. Trazabilidad **R1–R12 → test** (mapa en `progress/impl_59-zonas-distritos-multicanton.md`). Reviewer **APROBADO 0 bloqueantes de código** (el RECHAZADO inicial fue SOLO por gates documentales del leader, ya cerrados). Verde REAL: typecheck 0, eslint 0, **`zona-form.test.tsx` 22/22** (+6 casos), suite **2551 passed** (2 flakes ambientales aislados verdes). F1.4-e aprobó `arbolZonas` → **T9-alt = N/A**. Solo cambiaron `ZonaForm.tsx` y su test. Orquestada DIRECTO por el leader (`frontend_dev → reviewer`, bug opus-4.8[1m]). Estado `done` + `history.md` + `impl_59`/`review_59`. **DEUDA menor** (reviewer, no bloqueante): numeración "R" mezclada entre features 55 y 59 en algún docstring/test; sin test del enriquecimiento perezoso de provincia al navegar en edición. **PENDIENTE: PR a `dev` + merge (OK humano).**

> **Feature 45 (wallet: gastos fijos/variables y sueldos) CERRADA 2026-07-13**: **impl COMPLETA (R1–R33) + reviewer APROBADO 0 bloqueantes**. **ÚLTIMO eslabón de la cadena wallet (42→43→44→45).** Money-critical; F1.4 aprobada (c: sueldos texto libre; **b: gastos fijos por CRON mensual** —override de la recomendación manual—; resto recomendadas). Orquestada DIRECTO por el leader (`backend_dev → frontend_dev → reviewer`, evita el implementer monolítico/bug opus-4.8[1m], precedente 56). Verde REAL: typecheck 0, lint 0, **2545/2545 tests**, `init.sh` OK, round-trip de AMBAS migraciones verificado. Egresos = filas `tipo=egreso` en el libro polimórfico `wallet_movimiento` (42): enum +`egreso_gasto_fijo`/`egreso_gasto_variable` (migración `20260713140000` +down). VARIABLES/SUELDOS = registro **manual** (`origen_id` NULL; sueldo=texto libre F1.4-c; rechaza `gasto_fijo` manual). GASTOS FIJOS = tabla nueva **`gasto_fijo_plantilla`** (CRUD sin borrado, RLS sin policies; migración `20260713150000` +down) + **CRON** `/api/cron/generar-gastos-fijos` (auth `CRON_SECRET` antes de efectos, `0 6 1 * *`=día1 00:00 CR, clon 41/46), **idempotente** por `origen_id="<plantillaId>:<YYYY-MM>"` bajo el índice único parcial EXISTENTE (reejecutar mismo mes → 0 filas). Reversa compensatoria append-only idempotente (aplica a egresos del cron). Balance DERIVADO resta, sin doble conteo. UI `/wallet`: dialog egreso manual + panel CRUD plantillas + desglose por tipo + reversa por fila. Cambio compartido auditado sin regresión: blindaje `montoPositivoSchema` (monto vacío→`validation_error`, no 500). Commit + `impl_45.md`/`review_45`. Estado `done` + `history.md`. **DEUDA menor**: E2E diferido; tests migración/DB estáticos/in-memory. **PENDIENTE: PR a `dev` + merge (OK humano).**

> Feature 48 (rechazo: devolución a la tienda de origen) CERRADA 2026-07-13: **impl COMPLETA (R1–R19) + reviewer APROBADO 0 bloqueantes**. **CUARTA y ÚLTIMA de la Fase 2 flujo mensajero → cierra el grupo 46/47/48/49.** Verde: typecheck 0, lint 0, **2405/2405 tests (+44)**, `init.sh` OK, **SIN migración** (`rechazada`/`devuelta_origen` ya sembrados; tienda origen = `orden.tienda_id`). Rama desde el tip de la 47. **Retorno por ACCIÓN MANUAL de la bodega** (`DevolucionOrigenService`): `rechazada → devuelta_origen`, elegible cualquier orden en `rechazada` (ambos caminos: directo 36 + escalado 47), idempotente. Transición **atómica** vía choke point 49 reutilizando #11 (`origen_tipo=ajuste_estado`); cobertura sigue en 11 puntos. Autz rol+zona server-side (bodega responsable); adminTienda solo VE sus devueltas por scope `tienda_id`. UI botón "Devolver a tienda" + apartado devueltas de la tienda. Commit `5467b94` + cierre. Estado `done` + `history.md` + `review_48`. **DEUDA menor**: authz tras la guarda de estado (posible fuga de estado vía `motivo` del conflict, follow-up authz-first); E2E diferido. **PENDIENTE: PR a `dev` + merge (OK humano).**

> **Feature 57 (botón cerrar sesión / logout) CERRADA 2026-07-13**: **impl + reviewer** tras 1 ciclo (RECHAZO por trazabilidad R10/R11 → RESUELTO). Fullstack/low, corrió **EN PARALELO con la 47** (otra sesión) en worktree aislado `../ordenex-f57` desde `dev`. F1.4 APROBADA por el humano: (a) REUTILIZAR el `LogoutButton` existente TAL CUAL en el **`SidebarFooter`** → visible para **TODOS los roles** (el layout `app/(app)/layout.tsx` monta el `Sidebar` sin importar el rol; el footer no depende de `items`). Resuelve el bug operativo: antes el logout solo vivía en la rama genérica de la home y **el rol `tienda` no lo alcanzaba**. (b) SIN modal (un click). HALLAZGO: el **backend de logout YA EXISTÍA** (`logout`→`AuthService.logout`→`SessionRepository.deleteById`, con tests) → puro frontend (mover botón + retirar ad-hoc de la home). Reviewer rechazó por R10/R11 sin test real + R10 exigía feedback de error; RESUELTO con **`toast.error("No se pudo cerrar sesión")`** (decisión del humano) + tests dedicados. R8 (no-back) cubierto por `middleware.ts`; `push` conservado (tal cual). VERDE: typecheck 0, eslint 0, **2333/2333**. Estado `done` + `history.md` + `review_57`. **Un PR `feature/57 → dev`.** PENDIENTE merge (OK humano).
>
> **↳ REUBICADO 2026-07-13 (misma feature 57):** al probar, el humano vio que el **#54 revertido** tenía el logout en el **topbar del `PageHeader`** ("Salir" + campana) y lo prefirió ahí. **Movido del `SidebarFooter` al `PageHeader`** compartido (botón "Salir" + icono `LogOut`, contraste sobre navy; toast de error conservado). `Sidebar` revertido a `origin/dev`. Radio de impacto: `PageHeader` se usa en toda página autenticada → 11 tests stubbean `LogoutButton` para aislar + `PageHeader.test.tsx` (nuevo) prueba el logout real. VERDE: typecheck 0, eslint 0, **2335/2335**. **OJO diagnóstico:** el `dev` LOCAL estaba en `1dd0c0d` (= PR #54 "adjustments" REVERTIDO, wallet 42/43/44 + trazabilidad 49 ROTAS); `origin/dev` está en `b3ed545`. El humano corría el #54 stale. **Feature 60** (recuperar la campana `NotificationsBell` del #54 sobre dev real) registrada (depende de 57, se relaciona con 35).

> Feature 47 (reintentos de entrega y escalado a rechazo) CERRADA 2026-07-13: **impl COMPLETA (R1–R22) + reviewer APROBADO 0 bloqueantes**. Tercera de la **Fase 2 flujo mensajero** (46/47/49 → 48). Verde: typecheck 0, lint 0, **2355/2355 tests (+31)**, `init.sh` OK, **SIN migración** (estatus ya sembrados; contador DERIVADO del historial de la 49). Rama desde `dev` verde **post-revert #55** (el #54 "adjustments" había revertido la 49 + roto wallet 42/43/44). **Cambio central:** `devuelta` deja de ser terminal → **REINTENTABLE**. En `crearGestionYTransicionar`, en la MISMA `$transaction`: `en_reparto→devuelta` + seguimiento `devuelta→rechazada` (si `intentos>=umbral`) o `devuelta→en_bodega/en_bodega_satelite` (reintento, ruteo por zona), cada uno vía `appendCambioEstado` (choke point 49, actor=sistema); atómico (revierte si falla el 2º). Contador DERIVADO (`contarPorDestino`, solo `devuelta` cuenta), umbral configurable `lib/config/reintentos.ts` (default 3). `devuelta_origen` = feature 48. `zonaId` añadido a `findByIdsParaGestion`. UI badge "intento X de N". Commit `68eb8fd` + cierre. Estado `done` + `history.md` + `review_47`. **DEUDA menor**: E2E diferido; TOCTOU teórico mitigado (guardia `en_reparto` + puntero 1-a-1); R12 sin test nominal. **PENDIENTE: PR a `dev` + merge (OK humano).** Última del grupo: **48** (rechazo → devolución a la tienda de origen).

> **Feature 58 (plantilla carga masiva: fila de ejemplo re-subible) CERRADA y MERGEADA a `dev` (PR #56) 2026-07-13** (otro agente; fix ágil `sdd:false`). El bug: el generador XLSX (`lib/utils/xlsx-template.ts`) sufijaba `" *"` la cabecera de campos `required` (`distrito`) → header ≠ clave del parser → «distrito requerido». FIX `headerFor`=`label??key`. Un 500 previo era el cliente Prisma obsoleto (regenerado). Incluye follow-up UI del `Modal` (altura/scroll) + ensanche del paso resumen. Verde 2330/2330. Ver `history.md`.

> **Feature 44 (wallet: pago a mensajeros y cuentas por pagar) CERRADA 2026-07-13**: **impl COMPLETA (R1–R27) + reviewer APROBADO 0 bloqueantes** tras 1 ciclo (rechazo por R18/R22 —desglose por cierre + filtros server-side de la vista del maestro— corregido y re-aprobado). VERDE: `prisma validate` OK, typecheck 0, lint 0, **2191 tests**, `init.sh` OK; migración verificada de forma ESTÁTICA (Postgres local compartido con la 49 en paralelo). Fullstack un ciclo; money-critical; F1.4 aprobada (Qa=SÍ egreso caja 42, Qb append-only+derivado, Qc automático al aprobar, Qd `min(P,E)`, Qe self-view `/mis-pagos` + adminSatélite NO, Qf liquidación=follow-up). Libro append-only `pago_mensajero_movimiento` (RLS sin policies, idempotencia por constraint parcial), feed que **consume los snapshots 39/37** al aprobar el `CierreDia` (`pago_devengado=P`, `pago_efectivo=min(P,efectivo)`, **cuenta por pagar = saldo derivado**), enganche **atómico** en `resolverCierre` tras 42/43 + **egreso `egreso_pago_mensajero=P` en la caja 42** (Qa, cuadrado). Vistas `/wallet/mensajeros` (maestro, desglose por cierre + filtros) y `/mis-pagos` (mensajero). Liquidación (Qf) RESERVADA. Commits `552ea7b` (feat) + merges de sync con `dev` (46 + 49). **PR #53 abierto a `dev`**, re-sincronizado con `dev` (46+49) tras el avance del PR #52. Estado `done` + `history.md` + `review_44`. **PENDIENTE: merge del PR #53 (OK humano).** DESBLOQUEA la 45 (último eslabón wallet).

> Feature 49 (trazabilidad / historial de estados) CERRADA 2026-07-13: **impl COMPLETA (R1–R34) + reviewer APROBADO 0 bloqueantes** (el reviewer reprodujo el grep de cobertura y el round-trip de migración). Segunda de la **Fase 2 flujo mensajero** (grupo 46/47/49), TRANSVERSAL. Verde: typecheck 0, lint 0, **2225/2225 tests (+85)**, `init.sh` OK, round-trip REAL. **CHOKE POINT único** `registrar-cambio-estado.ts` (`OrdenEstadoService`): append inmutable a `orden_historial_estado` en la MISMA `$transaction` que el cambio de estado. **11/11 puntos** de escritura de estado instrumentados (OrdenRepository #1–#6/#11, `asignarSateliteLote` #7 con `$queryRaw...RETURNING` conservando anti-TOCTOU, GestionOrdenRepository #8/#9, LiberacionReprogramadaRepository #10). Contador de intentos **DERIVADO** (la regla 3→rechazo es de la 47). UI drawer "Ver historial" por rol server-side (mensajero vía nuevo `OrdenDTO.mensajeroAsignadoId` opcional). Migración aditiva `20260713120000_orden_historial_estado` (+ RLS + down.sql). Rama nace del tip de la 46. Commit `faeeb2a` + cierre. Estado `done` + `history.md` + `review_49`. **DEUDA menor**: test de cobertura/RLS estáticos; E2E diferido. **PR #52 abierto a `dev`** (sync OK, solo el delta de la 49, mergeable); PENDIENTE merge (OK humano). Siguiente del grupo (NO arrancada, el humano paró): **47** (reintentos/escalado, consume el derivador de intentos de la 49) → 48.

> Feature 46 (reprogramación: bloqueo + liberación programada) CERRADA 2026-07-13: **impl COMPLETA (R1–R21) + reviewer APROBADO 0 bloqueantes**. Primera de la **Fase 2 flujo mensajero** (grupo 46/47/49 elegido por el humano). Fullstack/high, un ciclo, rama desde `origin/dev`. Verde: typecheck 0, lint 0, **2056/2056 tests (+48)**, `init.sh` OK, round-trip de migración por SQL directo. **BLOQUEO server-side real** (`MSG_ORDEN_REPROGRAMADA_BLOQUEADA` en `GuiaAsignacionService`+`AsignacionSateliteService`, antes del check de origen; envío por origen en `MisAsignacionesService`): orden `reprogramada` con `fechaReprogramacion>hoy(CR)` no reasignable/enviable. **LIBERACIÓN**: cron NUEVO `/api/cron/liberar-reprogramadas` (auth `CRON_SECRET`, `0 6` diario=00:00 CR, hora CR UTC−6) → `en_bodega`/`en_bodega_satelite` derivado de zona (`findCentralZonaId`, reúsa 30/33); idempotencia DERIVADA del estatus + `orden.liberada_reprogramada_at`. **AVISO** = visibilidad derivada "liberadas hoy" en ambas bodegas (sin tabla). Migración aditiva `20260713100000_orden_liberada_reprogramada_at` (+ down.sql). R21 (contador/historial) FUERA DE ALCANCE = 47/49. Commit `a9fa3c8` + cierre. Estado `done` + `history.md` + `review_46`. **MERGEADA a `dev` (PR #51)** 2026-07-13. Siguiente del grupo: **49** (trazabilidad, base) → 47 → 48.

> Feature 46 (reprogramación: bloqueo + liberación programada) CERRADA 2026-07-13: **impl COMPLETA (R1–R21) + reviewer APROBADO 0 bloqueantes**. Primera de la **Fase 2 flujo mensajero** (grupo 46/47/49 elegido por el humano). Fullstack/high, un ciclo, rama desde `origin/dev`. Verde: typecheck 0, lint 0, **2056/2056 tests (+48)**, `init.sh` OK, round-trip de migración por SQL directo. **BLOQUEO server-side real** (`MSG_ORDEN_REPROGRAMADA_BLOQUEADA` en `GuiaAsignacionService`+`AsignacionSateliteService`, antes del check de origen; envío por origen en `MisAsignacionesService`): orden `reprogramada` con `fechaReprogramacion>hoy(CR)` no reasignable/enviable. **LIBERACIÓN**: cron NUEVO `/api/cron/liberar-reprogramadas` (auth `CRON_SECRET`, `0 6` diario=00:00 CR, hora CR UTC−6) → `en_bodega`/`en_bodega_satelite` derivado de zona (`findCentralZonaId`, reúsa 30/33); idempotencia DERIVADA del estatus + `orden.liberada_reprogramada_at`. **AVISO** = visibilidad derivada "liberadas hoy" en ambas bodegas (sin tabla). Migración aditiva `20260713100000_orden_liberada_reprogramada_at` (+ down.sql). R21 (contador/historial) FUERA DE ALCANCE = 47/49. Commit `a9fa3c8` + cierre. Estado `done` + `history.md` + `review_46`. **DEUDA menor**: E2E diferido; round-trip por test estático+SQL manual. Con la 43 ya mergeada a `dev` (PR #50), el drift ambiental del Postgres local queda resuelto. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** Siguiente del grupo: **49** (trazabilidad, base) → 47 → 48.

> Feature 43 CERRADA y **MERGEADA a `dev`** (PR #50) 2026-07-13. Ver `history.md`.

> Feature 43 (wallet por tienda: saldo a favor) CERRADA 2026-07-12: **impl COMPLETA (R1–R29) + reviewer APROBADO 0 bloqueantes**. Verde REAL: prisma OK, typecheck 0, lint 0, **2092/2092 tests (+84)**, `init.sh` OK, **round-trip de migración REAL por introspección**, **invariante de cuadre verificado a mano en AMBOS estados del flag**, idempotencia por constraint DB viva, SIN regresión 37/38/39/40/56/41/42. Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Wallet POR TIENDA = complemento del ingreso de Ordenex de la 42: **ledger propio** `wallet_tienda_movimiento` congelado al aprobar (reutiliza `derivarIngresoOrden`), crédito sobre COD recaudado (`montoRecibido`); `devuelta`/`rechazada` → la tienda debe el flete de devolución (saldo negativo) **REVERSIBLE** vía flag `TIENDA_DEBITA_FLETE_DEVOLUCION` (default true); alcance = modelo + visibilidad (`/mi-wallet` adminTienda + `/wallet/tiendas` maestro); pago a la tienda = follow-up. Estado `done` + `history.md` + `review_43`. Commit `6923a7b`. **DESBLOQUEA el pago a tiendas (follow-up).**

> Feature 42 (wallet: caja principal de Ordenex) CERRADA 2026-07-12: **impl COMPLETA (R1–R26) + reviewer APROBADO 0 bloqueantes** tras 1 ciclo (rechazo inicial por falta de E2E → añadido `e2e/wallet.spec.ts`). Verde REAL: prisma OK, typecheck 0, lint 0, **2008/2008 tests (+77)**, `init.sh` OK, **round-trip de migración REAL** contra Postgres local (incl. drop de `orden.cobra_comision` y 3 enums), **idempotencia por constraint DB verificada viva**, SIN regresión 37/38/39/40/56/41. Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Módulo WALLET = caja principal: **libro append-only inmutable** `wallet_movimiento`, **balance DERIVADO** (suma `Decimal`, sin saldo mutable), UI `/wallet` rol maestro + movimiento manual. Ingresos derivados de la tarifa AL APROBAR el `CierreDia` (movimiento=snapshot; enganche idempotente+atómico en `CierresAdminRepository.resolverCierre`), split `entregada`/devolución + **nueva columna `orden.cobra_comision`** (default true; poblarla por-orden = deuda A5); 6 categorías de ingreso; `CierreBodega` no re-cuenta. Estado `done` + `history.md` + `review_42`. Commits `a9769ea`+`f85ee42`+`1f9124b`. **RAÍZ de la cadena de pagos → DESBLOQUEA 43/44/45.** **PENDIENTE: abrir PR a `dev` + merge (OK humano).**

> Feature 41 (reglas y bloqueos de cierre: obligatoriedad, vencidos) CERRADA 2026-07-12: **impl COMPLETA (R1–R24) + reviewer APROBADO 0 bloqueantes** (verde REAL con round-trip de migración real contra Postgres —incl. recreación del uq de la 40—: prisma OK, typecheck 0, lint 0, **1931/1931 tests (+64)**, `init.sh` OK, **SIN regresión 37/38/39/40/56**). Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Corte diario **Vercel Cron** (`/api/cron/corte-diario`+`CRON_SECRET`, `0 6 * * *`=00:00 CR, idempotente) crea fila real `cierre_dia estado='vencido'` (snapshot+gestiones) para quien no cerró; **bloqueo DERIVADO** del mensajero (`solicitado`∨`vencido`) y de la satélite (**regla estricta Q4**: cierres de sus mensajeros ∨ su propio `CierreBodega solicitado`) en las guardas de asignación 17/30/34; `vencido` resoluble por la bodega vía feature 38 extendida. Enum `vencido` añadido (migración aditiva + down). Estado `done` + `history.md` + `review_41`. Commit `dde6fba`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA menor: TOCTOU residual en el lote del maestro (pre-check sin `NOT EXISTS`; el path satélite sí; justificado/no bloqueante) → follow-up; R23 sin test de carrera real; E2E diferido.

> Feature 56 (ingreso de bodega por rechazos, `cobroRechazado`) CERRADA 2026-07-12: **impl COMPLETA (R1–R22+R7b+R23) + reviewer APROBADO 0 bloqueantes** (verde REAL con round-trip de migración real: `prisma validate` OK, typecheck 0, lint 0, **1867 tests** —1 flaky ajeno `LoginForm`, pasa aislado—, `init.sh` OK, migración round-trip OK, **SIN regresión 37/38/39/40**). Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Espejo de la 39 para el otro lado: el `cobroRechazado` de una gestión `rechazada` es INGRESO PARA LA BODEGA (destino del cierre), no pago al mensajero; reusa `TarifaZonaMensajero`/`resolvePagoTarifa` sin modelo nuevo, **SNAPSHOT** al solicitar (migración aditiva `20260712140000_ingreso_bodega_rechazos` en 3 niveles; snapshot inmutable verificado). **Q6 RESOLVIÓ la deuda m1 de la 39**: flag `tarifaFaltante` server-side reemplaza la heurística frontend (sin falsos positivos en entregas de ₡0.00). Estado `done` + `history.md` + `review_56`. **IMPL EN 2 COMMITS** (el `implementer` murió por el bug opus-4.8[1m] tras el backend): backend `6a0153d` + UI `40d99e2` (frontend_dev directo). Cierra el par pago-por-zona (mensajero 39 + bodega 56). **PENDIENTE: abrir PR a `dev` + merge (OK humano).**

> Feature 39 CERRADA y **MERGEADA a `dev`** (PR #46) 2026-07-12. Cadena de cierres 37/38/40/39 completa en `dev`. Ver `history.md`.

> Feature 39 (pago al mensajero por zona en el cierre) CERRADA 2026-07-12: **impl COMPLETA (R1–R23+R7b) + reviewer APROBADO 0 bloqueantes** (verde REAL con round-trip de migración real: `init.sh` OK, typecheck 0, lint 0, **1829/1829 tests**, build OK, **SIN regresión 37/38/40**). Fullstack un ciclo; money-critical; F1.4 aprobada 2026-07-12. Estado `done` + `history.md` + `review_39`. Pago vía `TarifaZonaMensajero` (zona+vehículo del mensajero, fallback tarifa por defecto), **SNAPSHOT** al solicitar (migración aditiva `20260712130000_pago_mensajero_cierre` en 3 niveles; snapshot inmutable verificado), **SOLO `entregada` paga**; `cobroRechazado`→bodega separado a la **feature 56**. Commit `941ea7c`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA menor: aviso tarifa-faltante por heurística frontend (candidato flag server-side).

> Feature 56 (ingreso de bodega por rechazos, `cobroRechazado`) REGISTRADA `pending` 2026-07-12 (`depends_on: 39`): separada de la 39 por decisión del humano — el pago por rechazo va a la bodega, no al mensajero.

> Feature 40 CERRADA y **MERGEADA a `dev`** (PR #45) 2026-07-12. Features 37/55/38 también mergeadas (#42/#43/#44). Ver `history.md`.

> Feature 40 (cierre de bodega satélite → central) CERRADA 2026-07-12: **impl COMPLETA (R1–R25+E2E) + reviewer APROBADO 0 bloqueantes** (verde REAL con verificación en DB VIVA: `init.sh` OK, typecheck 0, lint 0, **1797/1797 tests (+58)**, build pasa, migración round-trip real, RLS `cierre_bodega` sin policies, índice único parcial y FK verificados). Fullstack un ciclo; F1.4 aprobada 2026-07-12 (todas recomendadas). Estado `done` + `history.md` + `review_40`. Segundo nivel de cierre (doble espejo 37/38): tabla nueva `CierreBodega` (agrega `cierre_dia` `aprobado` de la zona, totales snapshot agregados, auditoría, índice único parcial ≤1 `solicitado`/zona) + FK `cierre_bodega_id` en `cierre_dia`. adminSatélite solicita / maestro aprueba-rechaza, en `/cierres-admin` extendido role-aware (regresión 37/38 intacta). Migración `20260712120000_cierre_bodega`. Commit `105689d`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** **DESBLOQUEA 41** (reglas/bloqueos/vencidos).

> Feature 38 CERRADA 2026-07-12 y **MERGEADA a `dev`** (PR #44). Ver `history.md`. Features 37 y 55 también mergeadas (PRs #42/#43).

> Feature 38 (admin: cierres del día, aprobar/rechazar) CERRADA 2026-07-12: **impl COMPLETA (R1–R17+E2E) + reviewer APROBADO 0 bloqueantes** (verde REAL verificado por el reviewer: `prisma validate` OK, `typecheck` 0, `lint` 0, **1739/1739 tests (+116)**, `init.sh` OK, migración round-trip OK). Fullstack un ciclo; F1.4 aprobada 2026-07-12 (todas recomendadas). Estado `done` + `history.md` + `review_38`. Módulo `/cierres-admin` (cola `solicitado` + histórico + detalle completo con evidencias firmadas + aprobar/rechazar de a uno). Migración ADITIVA `20260712110000_cierre_dia_resolucion` (`resuelto_por`/`resuelto_at`/`motivo_rechazo` + `down.sql`). Alcance por rol+zona en el WHERE (maestro→`bodega_central`, adminSatelite→`bodega_satelite`+su zona); rechazo inmutable; concurrencia sin TOCTOU. Commit `0418a1a`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** **DESBLOQUEA 40** (cierre satélite→central) y complementa 39/41.

> Features 37 y 55 CERRADAS y **MERGEADAS a `dev`** 2026-07-12 (PRs #42 y #43). Ver `history.md`.

> Feature 55 (completar ZonaForm: `esCentral` + drift `provincia.zonaId`) CERRADA 2026-07-12: **impl COMPLETA (R1–R14) + reviewer APROBADO 0 bloqueantes** (verde REAL verificado por el reviewer: `prisma validate` valid, `migrate status` up-to-date 0 migraciones nuevas, `typecheck` 0, `lint` 0, **1614/1614 tests (+49)**, `init.sh` OK). Fullstack un ciclo; F1.4 aprobada 2026-07-12 (todo recomendado). Estado `done` + `history.md` + `review_55`. Reconstruyó `ZonaForm` (crear/editar + distritos N:M + `cobroVehiculo` + toggle `esCentral`), reasignación central transaccional (`P2002`→`conflict`), `GeoService`/`GeoActions` para el catálogo geo, drift `provincia.zonaId` reconciliado **solo-schema** (sin migración). **DESBLOQUEA el runtime de `bodega_central` en 30/34/37** (`findCentralZonaId` deja de ser null al marcar zona). **PR #43** abierto a `dev` (en merge). Deuda menor: `conflict` sin payload por-campo; confirmación de reasignación vía checkbox inline (reviewer: menor).

> Feature 37 (mensajero: "Cierre del día") CERRADA 2026-07-12: **impl COMPLETA (R1–R20+E2E) + reviewer APROBADO 0 bloqueantes** (verde REAL verificado por el reviewer: `prisma validate` OK, `typecheck` 0, `lint` 0, **1623/1623 tests (+58)**, `init.sh` OK, rollback round-trip OK). Fullstack un ciclo; F1.4 aprobada 2026-07-11; F2 retomada al reparar `dev` (54). Estado `done` + `history.md` + `review_37`. Módulo `/cierre-dia`: tabla NUEVA `cierre_dia` (+ enums `cierre_estado`/`cierre_destino_tipo`, FK nullable `cierre_id` en `gestion_orden`, RLS) con totales `Decimal` **snapshot** por método (efectivo/SIMPE/transferencia) + general; **Solicitar cierre** crea `solicitado`, vincula gestiones (todo-o-nada), deriva destino por zona vía **`findCentralZonaId()`**; histórico de cierres. Migración `20260712100000_cierre_dia` (con `down.sql`). Commit `59d5b23`. **PR #42 mergeado** a `dev` (`546c5c4`). DEUDA: migración no aplicada contra Postgres real; E2E escrito no ejecutado. Con la 55 mergeada, el runtime `bodega_central` queda operativo. **DESBLOQUEA 38 y base de 39/40/41.**

> Feature 54 (reconciliación del refactor #40 → dev verde + `esCentral`) CERRADA 2026-07-12: **impl COMPLETA + reviewer APROBADO 0 bloqueantes** (verde REAL: `prisma validate` OK, `typecheck` 0, **1565/1565 tests**, `init.sh` OK, `pnpm build` OK). Fix-feature ágil. Repuso `esCentral`/`findCentralZonaId` (17/30 actualizadas), recableó ZonaRepository/TarifaRepository/GeoRepository, arregló schema (`Zona.usuarios`) + migración #40 rota, restauró la feature 51 (el #40 la había revertido a Ecuador), reconció los tests de menú/migración. Se conservó la intención del #40 (tarifas/N:M/menú). Estado `done` + `history.md` + `review_54`. **PENDIENTE: PR a `dev` + merge (OK humano)** → con eso `dev` sano y se retoma la 37. FOLLOW-UP feature 55: completar `ZonaForm` (setear `esCentral`) — sin eso `findCentralZonaId`=null y el maestro no asigna en runtime.

> Feature 34 (asignación desde bodega satélite) CERRADA 2026-07-11: **impl COMPLETA (R1–R20) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh`, 1519 tests). Fullstack un ciclo, SIN migración. Estado `done` + `history.md` + `review_34`. `AsignacionSateliteService` paralelo (guardas rol+zona server-side, 5 errores tipados, lote todo-o-nada) + rename honesto `...Gam`→`...ByZona` (maestro verde) + UI "Asignar" en `recepcion-satelite`. **CIERRA la cadena satelital** (30→32→33→34→36). **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: E2E escrito no ejecutado.

> Feature 52 (fix build /postulacion) CERRADA 2026-07-11: `export const dynamic="force-dynamic"` en `app/postulacion/page.tsx`. `pnpm build` PASA, `init.sh` verde 1493 tests. Ciclo ágil (spec inline, sin reviewer aparte). Estado `done` + `history.md`. **PENDIENTE: PR a `dev` + merge.**

## Pendientes / deudas registradas (el humano pidió dejar constancia — 2026-07-11)

> Bugs y deudas detectadas que NO se pierden. Cada bug de código se registra como feature.

- **Feature 52 (build /postulacion)** — ✅ CERRADA (fix aplicado, `pnpm build` verde). Pendiente solo el PR/merge.
- **TAREA HUMANA — bucket `gestion-evidencias`**: crear el bucket PRIVADO en Supabase Storage (feature 36). Las fotos de evidencia de entrega/rechazo lo necesitan en runtime. Sin esto, la gestión de órdenes del mensajero falla al subir evidencia.
- **DEUDA DE DESPLIEGUE — migraciones**: ✅ **SALDADA 2026-07-11.** `DATABASE_URL` apunta a un **Postgres LOCAL** (`localhost:5432`, db `ordenex`), NO a un Supabase compartido (la nota vieja era incorrecta). Se aplicaron las 12 migraciones pendientes con `prisma migrate deploy` (17/24/27/28/30/33/36 y previas); `prisma migrate status` = "up to date"; `pnpm db:seed` (catálogos) OK. Verificado por leader.
- **DEUDA DE DESPLIEGUE — rollback (T020)**: ✅ **SALDADA 2026-07-11** (feature 53). Se verificó el round-trip
  contra la DB local (`db:rollback` → `migrate status` pendiente → `migrate deploy` reaplica → up to date) y de
  paso se ARREGLÓ `scripts/db-rollback.ts`, que estaba doblemente roto en Prisma 7 (`--schema` en `db execute` +
  `migrate resolve --rolled-back` P3012). Ahora hace `db execute` sin `--schema` y borra el registro de
  `_prisma_migrations` directamente.
- **DEUDA DE DESPLIEGUE — restante (env-dependiente)**: (1) **E2E** (`e2e/*.spec.ts`) escritos pero NO ejecutados — requieren dev server + usuarios sembrados de login por rol + fixtures (los specs usan emails placeholder); ejecutarlos de verdad necesita un HARNESS de seed/login e2e que hoy NO existe (candidato a feature propia). (2) **seed de ZONAS** (`seed-zonas.ts`) pendiente — necesita el **Excel de zonas** que debe proveer el humano. (3) **RLS con key anon** (T004) no ejecutada (config).
- **Posible feature futura — PWA**: convertir la app en PWA (mencionado por el humano en la F1.4 de la 33, para el escaneo móvil del adminSatelite). No creada aún.

> Feature 33 (bodega satélite: mis asignaciones + recepción QR) CERRADA 2026-07-11: **impl COMPLETA (R1–R23) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh` + `pnpm build`, 1493 tests). Fullstack un ciclo. Estado `done` + `history.md` + `review_33`. Módulo `/recepcion-satelite` del adminSatelite ("Por recibir"/"Recibidas"), recepción por escaneo (cámara `html5-qrcode` + lector keyboard-wedge) → estado NUEVO `en_bodega_satelite`; alcance por zona server-side, idempotente. Migración `20260711160000`. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: migración no aplicada, verificación manual de hardware, E2E no ejecutado. **HALLAZGO ajeno (pre-existente):** `pnpm build` falla el prerender de `/postulacion` (feature 21, Prisma en prerender sin `export const dynamic`) → candidato a corrección aparte. Desbloquea 34.

> Feature 36 (mensajero: mis asignaciones y gestión) CERRADA 2026-07-11: **impl COMPLETA (R0–R35) + reviewer APROBADO** tras 1 ciclo de rechazo (bloqueantes de checkpoint: tasks sin marcar + falta E2E de recaudo; el humano decidió AÑADIR el E2E). Fullstack un ciclo. Estado `done` + `history.md` + `progress/review_36-...md`. Máquina de estados: `en_espera_aceptacion` →[Recoger]→ `en_reparto` (NUEVO) → gestión → entregada/reprogramada/devuelta/`rechazada`(NUEVO). Migración `20260711150000` (2 estados + enum `metodo_pago_value` + tabla `gestion_orden`+RLS + puntero `usuario.orden_en_gestion_id`). Módulo `/mis-asignaciones` del mensajero. Verificación: `pnpm test` **1433/1433**, `init.sh` verde. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: crear bucket `gestion-evidencias` (HUMANO), migración no aplicada, E2E no ejecutado. Desbloquea 37 (cierre del día) y base de 46/47/48/49.

> Feature 32 (etiqueta de guía con QR + código de barras) CERRADA 2026-07-11: **impl COMPLETA (R1–R15) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh`, 1314 tests). Fullstack un ciclo, SIN migración (read derivado). Estado `done` + `history.md` + `progress/review_32-...md`. Backend: `EtiquetaGuiaDTO`/`findEtiquetasByIds` (resuelve nombres geografía/tienda + direccion + monto), `EtiquetaGuiaService`, action. Frontend: acción "Imprimir etiquetas" sobre el lote → PDF 100×100mm por orden (jspdf), QR=`orden.id`, barcode=`num_guia`. Deps: qrcode.react, react-barcode, jspdf, jsbarcode. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** DEUDA: verificación manual del binario del PDF + escaneabilidad. Desbloquea 33.

> Feature 30 (asignación por zona GAM / ruteo bodega satélite) CERRADA 2026-07-11: **impl COMPLETA (R1–R22) + reviewer APROBADO 0 bloqueantes** (corrió `init.sh`, 1287 tests verde). Fullstack un ciclo. Estado `done` + `history.md` + `progress/review_30-...md`. Backend: estado `en_ruta_bodega_satelite` (migración+down.sql), guardia R4, filtro mensajeros GAM, ruteo con `num_guia`. Frontend: columna Zona, badge dinámico, apartado + `RutearSateliteModal`, `GenerarGuiaModal` split GAM/no-GAM. F1.4 (6 decisiones recomendadas). **PENDIENTE: abrir PR a `dev` y merge (requiere OK humano, como el #32).** DEUDA: migración no aplicada contra Postgres real. Desbloquea 33/34/39.

> Feature 17 (revisión maestro / generar guía / asignación mensajero) CERRADA 2026-07-11: **PR #32 mergeado** a `origin/dev` (5e06aeb). Fullstack (R0–R32), reviewer APROBADO 0 bloqueantes, migración `num_guia` NULLABLE + secuencia + `mensajero_asignado_id` + estado `en_espera_aceptacion`. Suite 1244 verde tras integrar `dev` (feature 51). Desbloquea 30/32/36. Pendiente humano: aplicar la migración contra Postgres real (deuda de despliegue).

> Feature 23 (dashboard maestro) CERRADA 2026-07-10/11: **PR #28 mergeado** a `origin/dev`. Frontend puro (R1–R19). Feature 27 (fulfillment tienda) CERRADA: **PR #29 mergeado**. Feature 51 (corrección carga masiva CR) CERRADA: **PR #31 mergeado**. Ver `history.md`.

> Feature 22 (aprobación de postulaciones) CERRADA 2026-07-10: **PR #26 mergeado** a `origin/dev` (8eaed55), status `done`, entrada en `history.md`. Backend puro (R1–R21), reviewer APROBADO 0 mayores, sin migraciones. Rechazo→`inactivo`, URLs firmadas TTL 300s. Desbloquea la 23.

> Feature 21 (postulación de mensajero) CERRADA 2026-07-10: **PR #23 mergeado** a `origin/dev` (20db364), status `done`, entrada en `history.md`. Fullstack (R1–R26), reviewer APROBADO (bloqueante R17 resuelto). `primer_apellido` OBLIGATORIO; migración APLICADA y VERIFICADA contra Postgres real. Desbloquea la 22→23. Pendiente humano: crear bucket privado `mensajero-docs` en Supabase Storage.

> Feature 25 (gestión de usuarios) CERRADA 2026-07-10: **PR #24 mergeado** a `origin/dev` (95d5025), status `done`, entrada en `history.md`. Fullstack (R1–R36), otra sesión, reviewer APROBADO 0 bloqueantes.

> Feature 50 (vehiculos) CERRADA 2026-07-10: **PR #21 mergeado** a `origin/dev` (eb6a17d), status `done`, entrada en `history.md`. Backend puro (R1–R15, R12 N/A). Migración+seed **aplicados y verificados contra Postgres real**. Desbloquea la 21→22→23.

> Feature 20 (recuperación de contraseña) CERRADA 2026-07-10: **PR #20 mergeado** a `origin/dev`
> (b1ef459, 19:15Z), status -> `done`, entrada en `history.md`. Fullstack (reusa infra OTP, sin
> tabla nueva); implementada en 2 slices (backend + frontend), reviewer APROBADO en ambos, 0
> bloqueantes, suite 782/782 verde. Desbloquea la #25 (comparte `strongPasswordSchema`).

> Feature 31 (plantilla XLSX) CERRADA 2026-07-10: **PR #19 mergeado**, status -> `done`, entrada
> en `history.md`. Frontend puro (CSV→XLSX, exceljs import dinámico), reviewer APROBADO 0 bloqueantes.

> Feature 29 (enriquecer validación carga masiva) CERRADA 2026-07-10: **PR #17 mergeado** a
> `origin/dev` (7535961), status -> `done`, entrada en `history.md`. Frontend puro (R1–R19),
> reviewer APROBADO 0 bloqueantes, suite 721/721 verde. Corrió en paralelo con la 28 (backend).

> Feature 26 (dashboard/apartado admin de tienda) CERRADA 2026-07-10: **PR #14 mergeado** a
> `origin/dev` (e5a0f5d), status -> `done`, entrada en `history.md`. Frontend puro, corrió en
> paralelo con la 19 (backend). Reviewer APROBADO 0 bloqueantes; suite 689/689 verde. Deuda
> aceptada: sin e2e de login adminTienda (repo sin infra seed/login e2e). Cierre commiteado a
> `dev` (chore/state) — otra sesión trabaja la 28 en paralelo.

> Feature 28 (rename estado embalaje -> en_fulfillment) CERRADA 2026-07-10: **PR #15 mergeado** a
> `origin/dev` (d259e6a), status -> `done`, entrada en `history.md`. Backend puro; enum PG
> `order_status_value` standalone + rename de fila de catálogo, verificado contra Postgres real (R11).
> El cierre (done + history) viaja en la rama `chore/skills-cierre-28` junto con las skills de diseño.
> DEUDA nueva: `scripts/db-rollback.ts` (flag `--schema` roto en Prisma 7) -> feature aparte.


> Feature 18 (cobros crud) CERRADA 2026-07-10: PR #12 mergeado a `origin/dev` (a379d8e),
> status -> `done`, entrada en `history.md`. El cierre de la 18 + registro de la 19 viajan en
> el primer commit de `feature/19-rol-adminsatelite`.
> SKIP de la 17: deps 27/28 no `done`; no arranca hasta que cierren. Otras elegibles: 20, 21,
> 24 (necesita Excel), 25, 26, 28, 29.

> Feature 14 (botón carga masiva en órdenes) CERRADA 2026-07-10: PR #10 mergeado a
> `origin/dev` (bb511f1), status -> `done`, entrada en `history.md`. El cierre de la 14 +
> registro de la 16 viajan en el primer commit de `feature/16-carga-masiva-etapa2`.

> Feature 11 (notificaciones/toast) CERRADA 2026-07-10: PR #8 mergeado a `origin/dev`
> (1169312), status -> `done`, entrada en `history.md`. El cierre de la 11 + registro de
> la 15 viajan en el primer commit de `feature/15-carga-masiva-endpoint` (bookkeeping vía
> PR, sin commits directos a `dev`).
> NOTA: al mergear la 11, la zona frontend quedó libre → la feature 14 (frontend, low,
> depends_on 9 done) está desbloqueada y podría correr en PARALELO con la 15 (backend).

## Evaluaciones

> El leader documenta aca cada evaluacion de zone/complexity/particion.

- `listado del maestro: bloquear checkbox de ordenes con cierre sin resolver` (id 71): **zone=fullstack,
  complexity=medium, depends_on=69.** Evaluada 2026-07-15. Pedida por el humano en el chat ("una vez
  terminado" la 69), no venia del backlog. **PENDING a proposito**: la zona fullstack la ocupa la 69
  (regla 1 del arnes), y el propio humano la puso detras.
  **EL PEDIDO LITERAL ROMPE LAS FEATURES 46 Y 47** -- verificado en codigo, no supuesto. Pidio bloquear el
  checkbox "si la orden esta registrada como parte de un cierre". Pero `crearCierre:195-198` puebla
  `cierre_id` **por MENSAJERO** (`where: {mensajeroId, cierreId: null, anuladaAt: null}`), **sin mirar el
  estado de la orden** -> una gestion `reprogramada`/`devuelta` entra al cierre igual que una `entregada`. Y
  46/47 dependen de que esas ordenes VUELVAN al listado: la 46 las libera por cron a `en_bodega`
  (`LiberacionReprogramadaRepository.liberarOrden:78-104` **NO toca `gestion_orden`**: la gestion sigue viva
  CON su `cierre_id`) y la 47 manda la `devuelta` a `en_bodega` con `limpiaMensajero:true` para el reintento.
  -> bloqueo literal = **checkbox muerto PARA SIEMPRE**: los intentos 2 y 3 del umbral inalcanzables y el cron
  de liberacion de la 46 **funcionalmente ANULADO**. **Raiz: `cierre_id NOT NULL` es PERMANENTE E
  IRREVERSIBLE** (un cierre aprobado nunca lo suelta) -> un bloqueo colgado de ese predicado no se levanta
  jamas.
  **DECISION DEL HUMANO tras exponerle el conflicto (parte de la gate F1.4):** el predicado es **cierre SIN
  RESOLVER** (`solicitado`|`vencido`, reusa `ESTADOS_CIERRE_BLOQUEANTES` de la 41), NO `cierre_id NOT NULL`.
  Bloqueo **TEMPORAL**: al resolverse el cierre la orden vuelve a ser asignable -> 46/47 sobreviven.
  **HALLAZGOS DE LA EXPLORACION:** (1) el checkbox se arma INLINE en `OrdenesApartado.tsx:137-144`, sin
  `disabled`; `ordenes-columns.tsx` no tiene columna de seleccion y `DataTable.tsx` es generico -> **un solo
  punto a tocar**. (2) **NO existe patron de fila deshabilitada con motivo**: hay que crearlo; lo mas parecido
  (`OrdenesRevisionMaestro.tsx:119-122,138-141`) filtra en SILENCIO al abrir el modal -> **mal precedente, no
  copiarlo**. (3) el bloqueo de la 41 es por **MENSAJERO destino, no por orden**, y solo server-side; tiene UI
  para mensajero (R21) y adminSatelite (R22) pero **ninguna para el listado del maestro**. (4) **el precedente
  correcto es la 46**: `mensajes-bloqueo.ts:7-8` (`MSG_ORDEN_REPROGRAMADA_BLOQUEADA`) es la UNICA nocion de
  bloqueo A NIVEL ORDEN que existe. (5) `zonaEsGam` (`lib/types/orden.ts:140-143`) es la **plantilla exacta**
  del campo derivado opcional a anadir al DTO.
  **OJO en la F1.4:** (a) UI-only **NO es una guarda** -> hace falta tambien server-side (patron 46), y por eso
  es fullstack y no frontend; (b) N+1: el listado es paginado, el predicado necesita query en LOTE por pagina
  (patron `findMensajerosBloqueados`, devuelve un Set); (c) hay que guardar `toggleSeleccion`/`seleccionadas`
  (`OrdenesApartado.tsx:120-127,167`): una fila YA seleccionada sigue en el `Set` tras un revalidate de SWR ->
  el bloqueo se saltearia solo; (d) **NO depende de `cierre_detail`**: el predicado sale de
  `gestion_orden.cierre -> cierre_dia.estado`; no inventar una dependencia de datos que no existe.

- `cierre_detail - congelar el detalle y la tarifa del cierre` (id 69): **zone=fullstack, complexity=high,
  branch=feature/69-cierre-detail, depends_on=37 (done, en dev).** Evaluada 2026-07-15. Pedida por el humano
  en el chat (no venia del backlog; se registro al vuelo). Rama a nacer de `origin/dev` (OJO: la sesion
  estaba parada en la rama `qr`, no en dev).
  **EL PEDIDO LITERAL YA ESTABA HECHO, igual que en la 67 — y de nuevo eso fue lo valioso.** Pidio "una tabla
  relacion cierre_detail entre cierre_dia y orden, llenada al solicitar el cierre": esa relacion YA EXISTE
  (`gestion_orden.orden_id` + `gestion_orden.cierre_id`, schema:380) y YA se llena sola en la tx de
  `crearCierre:195`. Verificado en el codigo, no supuesto. Al preguntarle QUE resolvia la tabla que hoy no
  estuviera resuelto, el humano eligio **"congelar el detalle (snapshot)"** -> ese, y no la relacion, es el
  alcance.
  **HALLAZGO CRITICO (money-critical, lo destapo la exploracion del leader, ningun test lo cubre):** los
  totales SI estan congelados (37/R14, 39, 56), pero los **feeds de wallet leen campos VIVOS de `orden`
  DESPUES de que el cierre existe**, dentro de la tx de aprobacion, y escriben a libros **append-only
  inmutables**. `WalletFeedService:26-39` lee `orden.{zonaId, montoCobrar, cobraComision, zona.esCentral}`;
  `WalletTiendaFeedService:59-74` lee ademas `orden.tiendaId` (= A QUIEN se le acredita/debita);
  `WalletFeedService:46` resuelve la **tarifa VIVA**. Y `OrdenRepository.update:442` **no tiene guarda**
  (WHERE = `{id, deletedAt:null}`, no mira gestiones ni cierres). -> Editar `monto_cobrar` o la tarifa entre
  SOLICITAR y APROBAR **descuadra EN SILENCIO** los `total_*` snapshot contra los movimientos de wallet, sin
  error, y solo se corrige a mano con `ajuste_credito`/`ajuste_debito`. `WalletMensajeroFeedService:31-33` es
  el modelo sano: ya consume solo snapshots y por eso es inmune.
  **El soft-delete resulto INOFENSIVO** (contra la intuicion): `WITH_DETALLE` navega `gestionOrden.orden` sin
  filtrar `deletedAt` y la FK es NOT NULL -> la fila sigue mostrandose. **El vector de dano es el UPDATE, no
  el DELETE.**
  **Decisiones del humano (valen como parte de la gate F1.4):** (1) alcance = congelar **todo el grano orden**
  (descriptivos + money-critical), no solo el detalle visual; grano `(cierre_id, orden_id)` porque los campos
  congelados son de la ORDEN y no dependen de cuantas gestiones tenga en el cierre. (2) **INCLUIR la tarifa**
  (override de la recomendacion del leader, que la dejaba aparte): congelar la orden sin congelar la tarifa
  deja el agujero medio tapado.
  **ABSORBE LA FEATURE 68 -> `status: cancelled` + `sdd:false` + `status_note`** (patron de las anuladas 35/60/62;
  NO se borra). Su fix es un subconjunto estricto: la 69 tiene que recablear ese resolver igual.
  **HALLAZGO QUE DESBLOQUEA LA 68, y corrige a la sesion anterior:** `current.md` afirmaba que arreglarla "NO
  es un fix mecanico zonaId->tiendaId" porque "tarifa vigente por ZONA deja de estar definido si la tarifa
  cuelga de una TIENDA". **Demasiado pesimista: se escribio sin cruzar el resolver con el modelo `Tarifa`.** La
  dimension zona NO se perdio -- vive DENTRO de la fila (`valor_flete` vs `valor_flete_gam`,
  `valor_flete_devuelto` vs `valor_flete_devuelto_gam`, schema:522-543) y `WalletFeedService:57` YA lee
  `zona.esCentral` justamente para elegir columna. El humano **CONFIRMO el modelo**: la **tienda** decide QUE
  fila de tarifa aplica (`orden.tienda_id` -> `tarifas.tienda_id`), la **zona** decide QUE COLUMNA se cobra.
  Con eso la 68 deja de estar bloqueada por una decision de diseno. **-> esta feature DEVUELVE `dev` A
  COMPILAR** (`pnpm build` e `init.sh` cortan hoy en `TarifaVigentePorZonaRepository:22`); tambien entra
  `scripts/seed-zonas.ts:257` (`distrito.zonaId`, dropeada por `20260713000000_drop_distrito_zona_id`), el
  otro de los 2 errores de typecheck.
  **VERIFICACION = criterio de aceptacion, NO deuda:** arranca con `pnpm test`/`typecheck`/`lint` DIRECTOS
  (init.sh rojo de base, precedente 64/67) y **DEBE terminar con `./init.sh` y `pnpm build` EN VERDE** y
  typecheck **2 -> 0**. Hueco de test a saldar: la implementacion REAL del resolver de tarifa no tiene
  cobertura (todos los tests la mockean) -- por eso la 68 nunca salio en rojo.
  DECISION DE PROCESO (leader): un ciclo fullstack, NO el `implementer` monolitico (bug opus-4.8[1m]);
  precedente 56/67. **La impl resulto BACKEND PURA -> `spec_author` -> `backend_dev` -> `reviewer`, SIN
  `frontend_dev`** (T18 recompone el detalle admin desde el snapshot devolviendo el MISMO DTO: la UI no
  cambia). El `backend_dev` **murio en el 1er intento por el bug opus-4.8[1m]** (sin tocar nada, arbol
  limpio); relanzado con **`model: opus` explicito** -> workaround que funciona, anotarlo para las proximas.
  **GATE F1.4 APROBADA por el humano 2026-07-15**: (a)-(f) tal como las recomendo el spec, **(g) con
  OVERRIDE**. Spec = **R1-R30 / 23 tasks**, sellado como fuente de verdad de lo aprobado.
  **La (g) nacio DENTRO de la fase 1** (no estaba en la evaluacion): el recableo destapo que el PR #64 anadio
  `tarifas.status` (activo/inactivo) y **el resolver NO lo filtra** -> una tarifa `inactivo` puede liquidar
  dinero. El humano decidio **NO filtrarlo en esta feature** (no mezclar dos cambios de dinero en un PR) y
  dejar un `TODO:` -> **registrada la feature 70** como salida (regla del arnes: el pendiente va al backlog,
  no solo a un comentario; es lo que le paso a la 68 al aparcarse).
  **DOS CORRECCIONES QUE VALE GUARDAR.** (1) **El leader se equivoco y el spec_author lo cazo**: el leader
  sugirio congelar los CONCEPTOS DERIVADOS (flete/IVA/comision) en vez de las ENTRADAS, por analogia con los
  `*_movimiento`. **Falso**: esos conceptos dependen del `resultado` de la GESTION
  (`lib/utils/ingreso-ordenex.ts:62,82`), no de la orden -> exigirian grano gestion, el que se descarto (una
  orden puede tener 2 gestiones vigentes en un cierre). La analogia era aparente: los `*_movimiento` son la
  SALIDA del cierre aprobado, y el hueco esta entre solicitar y aprobar, donde solo las ENTRADAS son estables.
  (2) **El `TODO` de la (g) cambia de objeto**: "migrarlo a snapshot" queda SIN OBJETO porque el snapshot lo
  introduce esta misma feature (R8). Lo pendiente es la **regla de SELECCION** de la fila vigente. Congelar no
  corrige la seleccion: **la vuelve permanente**.
  **HALLAZGO FINO (leader, matiza al spec_author):** la 69 NO empeora el resultado de la deuda (g) -- hoy una
  tarifa inactiva ya se cobra mal y ya queda grabada para siempre en `wallet_movimiento`, append-only. Lo que
  cambia es **CUANDO se cierra la ventana de correccion**: hoy la tarifa se resuelve AL APROBAR (arreglar la
  config antes de aprobar todavia salva el cierre); tras la 69 se resuelve AL SOLICITAR -> la ventana pasa a
  "antes de que el mensajero solicite". Es inherente a congelar. A cambio, `cierre_detail.tarifa_id` hace la
  deuda **auditable por primera vez** (hoy no queda rastro de que fila se uso) -> insumo natural de la 70.

- `deshacer gestion - devolver una orden a gestion` (id 67): **zone=fullstack, complexity=high,
  branch=feature/67-deshacer-gestion, depends_on=37 (done, en dev; la 37 a su vez cuelga de la 36).**
  Evaluada 2026-07-14. Pedida por el humano en el chat (no venia del backlog; se registro al vuelo).
  **ALCANCE RECORTADO POR EVALUACION, y esto es lo importante:** el pedido literal tenia DOS mitades y
  **la primera YA EXISTE** -- verificado en el codigo, no supuesto. El humano confirmo que era contexto,
  no un bug. La gestion nace con `cierre_id = NULL` (feature 36) y `CierreDiaRepository` lista
  exactamente esas (`where: {mensajeroId, cierreId: null}`, feature 37/R2-R3), asi que las 4 tablas del
  modulo (`CierreDiaModule.tsx`: Entregadas/Reprogramadas/Devueltas/Rechazadas) YA se llenan en vivo al
  gestionar; el vinculo formal al `CierreDia` se sella al pulsar "Solicitar cierre" (todo-o-nada). **NO
  se rehace nada de eso.** La feature es SOLO el DESHACER.
  **Decisiones del humano (valen como parte de la gate F1.4):** (1) VENTANA = solo con
  `cierre_id IS NULL`, o sea ANTES de solicitar el cierre -- despues los totales son snapshot, el admin
  los revisa (38) y al aprobar alimentan la wallet (42/43/44); deshacer ahi obligaria a revertir dinero
  asentado. (2) RASTRO = la gestion se ANULA dejando huella (quien, cuando, quien deshizo), NO se
  borra; coherente con el append-only del historial (ADR-004 / feature 49).
  complexity=high (no medium) por el radio: toca la maquina de estados, el choke point de la 49, el
  puntero 1-a-1 de la 36 y TRES derivadores (intentos 47, pago mensajero 39, ingreso bodega 56).
  DECISION DE PROCESO (leader): NO se parte el entry; un ciclo fullstack (backend_dev -> frontend_dev,
  un PR), precedente 16/24/30/41/46. Rama desde `origin/dev` (`7cf2393`, ya con #66/#67/#68/#70).
  **HALLAZGO CRITICO para el spec (lo encontro el leader cruzando el pedido con la arquitectura):** el
  contador de intentos de la feature 47 NO es una columna, se **DERIVA** del historial contando
  transiciones a `devuelta`, y ese historial es **append-only por diseno**. Si se deshace una gestion
  `devuelta` erronea, **el intento SEGUIRIA CONTANDO** y a los 3 la orden escala sola a `rechazada`. El
  spec DEBE resolver como la anulacion excluye ese intento del derivador SIN romper la inmutabilidad
  del historial. Sin eso, la feature deja un bug silencioso en el camino del dinero.
  Preguntas ABIERTAS para F1.4 (el spec_author las formaliza; ver la descripcion de la 64 en
  `feature_list.json` para el detalle a-g): contador de intentos derivado (la de arriba), estado destino
  al deshacer + registro por `appendCambioEstado`, puntero `usuario.orden_en_gestion_id` (que pasa si ya
  hay otra orden en gestion), mecanismo de anulacion (`anulada_at`/`anulada_por` + migracion con
  down.sql?) y su exclusion de los 4 grupos/totales/derivadores 39 y 56, evidencia en el bucket privado
  (se conserva o se borra), quien puede deshacer (solo el propio mensajero? tambien admin?), y el dinero
  (una `entregada` con `montoRecibido` deshecha: el efectivo sigue con el mensajero; confirmar que no
  hay impacto en wallet mientras el cierre no se apruebe).

- `pwa - basic` (id 64): **zone=frontend, complexity=low,
  branch=feature/64-pwa-basic, depends_on=null.** Evaluada 2026-07-15. Seleccionada
  por el humano ("sigue con el flujo y haz la feature de feature_list con id 64").
  **FRONTEND PURO**: PWA basica (instalable + cache de assets estaticos + manifest +
  meta tags + iconos). Sin backend, sin migraciones, sin dependencias nuevas. Enfoque
  MANUAL (sin @serwist/next): riesgo de incompatibilidad con Next.js 16 + Turbopack;
  un service worker de ~50 lineas es suficiente para el nivel basico. Colores del
  manifest extraidos de globals.css: theme_color=#0d2444 (sidebar), background_color=#f7f8fc
  (kraft-canvas), acento=#f26419 (brand). Icono temporal: public/next.svg sobre fondo
  naranja. Archivos esperados: public/manifest.json, public/sw.js, public/icons/icon-{192,512}.png,
  app/layout.tsx (meta tags + SW registration). SIN conflicto con feature 63 (fullstack
  en curso, no toca layout.tsx ni public/). Rama desde origin/dev.

- `Lestura de qr` (id 65): **zone=frontend, complexity=low,
  branch=feature/65-lestura-de-qr, depends_on=null.** Evaluada 2026-07-15. Seleccionada
  por el humano ("continua con la feature id 65"). **FRONTEND PURO**: item de menu "QR"
  visible para TODOS los roles, pagina con lector QR usando la camara del dispositivo,
  lee una ruta del codigo QR y redirige a esa ruta. Sin backend, sin migraciones, sin
  dependencias nuevas. Archivos esperados: componente de lector QR (usando html5-qrcode
  ya presente en el repo via feature 33), pagina /qr, item en el menu (Sidebar).
  SIN conflicto con feature 64 (frontend en curso, toca layout/public/ SW; la 65 toca
  Sidebar/menu + una pagina nueva). Rama desde origin/dev.

- `Orden lista actualizada` (id 63): **zone=fullstack, complexity=medium,
  branch=feature/63-orden-lista-actualizada, depends_on=null** (el humano confirmo que NO depende
  de la 57; el JSON traia 57 por herencia de la tanda 61/62). Evaluada 2026-07-14. Seleccionada por
  el humano ("sigue con la id 63"). **FULLSTACK**: backend — (a) endpoint/action nuevo para traer la
  lista de `order_status` (hoy catalogo TABLA tras `20260714123909`, enum eliminado; catalogo completo
  sembrado por las migraciones sin-commitear `..._order_status_pendiente` + `..._seed_order_status_completo`,
  auto-commiteadas en `0337c4d` al crear la rama); (b) generalizar `listarOrdenes` para aceptar una prop
  `filter: {[campo]: value}` que el backend traduzca a WHERE (caso de uso inmediato: `status_id`). Frontend —
  (c) el componente de lista de ordenes (para TODOS los roles EXCEPTO mensajero) itera por los estados y
  expone una prop `exclude` para omitir estados; (d) `Tabs` de shadcn, un tab por estado, cada tab lista las
  ordenes de ese estado; (e) **lazy loading**: solo la tab ACTIVA dispara la query; las inactivas NO consultan.
  DECISION DE PROCESO (leader): SDD completo (humano eligio el gate F1.4) + NO se parte el entry; un ciclo
  fullstack. Rama nace de `adjustments` (humano eligio: arrastra el WIP + el enum->tabla + el seed del catalogo
  que la 63 necesita). **NOTA baseline:** `adjustments` trae 30 tests rojos PRE-EXISTENTES (drift tarifas
  por-tienda / remodelado de zona vs dev, ver memoria `adjustments-diverge-de-dev`), AJENOS a la 63; no los
  arregla esta feature (candidatos a fix aparte). Preguntas ABIERTAS para F1.4 (el spec_author las formaliza):
  (a) FORMA del endpoint de `order_status` -> Server Action `listarOrderStatus()` (recomendado, patron del repo)
  vs. route handler REST; (b) FIRMA del filtro -> `filter?: Record<string,string>` acotado a una whitelist de
  campos indexables (recomendado, evita inyeccion de columnas arbitrarias) vs. abierto; (c) EXCLUDE por VALUE
  del estado vs. por id; que estados excluir por defecto (p.ej. `pendiente`?); (d) fuente de la lista de tabs ->
  del endpoint de `order_status` menos los `exclude` (recomendado) vs. lista estatica; (e) LAZY: mantener el
  estado/paginacion de cada tab visitada al volver (cache) vs. re-fetch en cada activacion; (f) alcance de "todos
  los roles excepto mensajero" -> maestro/admin/adminTienda/adminSatelite comparten el componente con `exclude`
  distinto por rol vs. uno solo; (g) responsive de los Tabs con ~14 estados (scroll horizontal / overflow).

- `zonas: seleccionar distritos de VARIOS cantones` (id 59): **zone=frontend, complexity=medium,
  branch=feature/59-zonas-distritos-multicanton, depends_on=55 (done, en dev).** Evaluada 2026-07-13.
  Seleccionada por el humano (backlog restante 35/59/60; recomendada por ser contenida y NO pista del otro
  agente). **FRONTEND PURO**: mejora UX de `ZonaForm` (features 24/55). Hoy el maestro navega provincia ->
  UN canton -> marca distritos de ESE canton; la seleccion interna (`selected`) YA se acumula al cambiar de
  canton, PERO la UI solo muestra los distritos del canton actual, asi que los de otros cantones no se ven
  ni se pueden quitar (parece que se pierden; solo hay el contador `data-testid=distritos-seleccionados`).
  Objetivo: (a) agregar distritos de VARIOS cantones (misma o distinta provincia) sin perder los marcados
  al cambiar de canton; (b) resumen/lista VISIBLE de TODOS los seleccionados agrupados por provincia/canton,
  con quitar por item. **Backend INTACTO** (`crearZona`/`actualizarZona` ya reciben el set COMPLETO de
  `distritoIds` N:M `ZonaDistrito`; vigentes R10 -deshabilitar distritos de OTRA zona- y el pre-marcado en
  edicion; acciones geo `listarCantones`/`listarDistritos` ya existen). DECISION DE PROCESO (leader): un
  ciclo frontend puro (no partir; sin backend/migracion), precedente 29/51. Rama desde `origin/dev`
  (a4298d8, incluye la 45 ya mergeada -> sin drift). Preguntas ABIERTAS para F1.4 (el spec_author las
  formaliza): (a) FORMA del resumen de seleccion cruzada -> lista agrupada provincia->canton con boton
  quitar por distrito (RECOMENDADO) vs. chips/tags; (b) el contador `distritos-seleccionados` -> conservarlo
  junto al resumen (RECOMENDADO, no romper el test existente) vs. reemplazarlo; (c) quitar desde el resumen
  desmarca tambien el checkbox si el usuario esta viendo ese canton; (d) R10 (distritos ya en otra zona)
  deshabilitados tambien reflejado en el resumen; (e) alcance responsive/accesibilidad del nuevo bloque.

- `wallet - gastos fijos/variables y sueldos` (id 45): **zone=fullstack, complexity=high,
  branch=feature/45-wallet-gastos-sueldos, depends_on=42 (done, en dev).** Evaluada 2026-07-13.
  Seleccionada por el humano. **ULTIMO eslabon de la cadena wallet (42->43->44->45).** Egresos
  administrativos (gastos fijos, gastos variables, sueldos) que SALEN de la caja principal (42) y se
  reflejan en el libro de movimientos + el BALANCE general. Money-critical (toca la caja). Insumos YA en
  dev (feature 42): libro append-only `wallet_movimiento` (POLIMORFICO, disenado en la Q4 de la 42 como
  tabla UNICA para 43/44/45), balance DERIVADO (suma Decimal), UI `/wallet` rol maestro + movimiento
  manual. DECISION DE PROCESO (leader): NO se parte el entry; un ciclo fullstack (implementer delega
  backend_dev -> frontend_dev, un PR), precedente 42/43/44. **NOTA de coordinacion:** la pista wallet la
  ha llevado el OTRO agente; al arrancar, el arbol estaba limpio y NADIE habia empujado `feature/45`
  (verificado). Rama desde `origin/dev` (f74c68f). Preguntas ABIERTAS para F1.4 (el spec_author las
  formaliza, confirmando contra el esquema real de la 42): (a) MODELO -> los egresos como MOVIMIENTOS en
  `wallet_movimiento` existente (categorias nuevas gasto_fijo/gasto_variable/sueldo, `origen_tipo` nuevo;
  REUSA la tabla polimorfica de la 42, RECOMENDADO) vs. entidad(es) propia(s); (b) GASTOS FIJOS y
  recurrencia -> registro manual por periodo (RECOMENDADO v1) vs. auto-generacion por cron mensual (en
  linea con `corte-diario` de la 41; follow-up); (c) SUELDOS -> ligados a un `Usuario`/trabajador (FK) vs.
  campo libre de nombre (definir si los trabajadores son usuarios del sistema o entidad aparte); (d)
  CATEGORIZACION -> extender el enum de categorias de `wallet_movimiento` de la 42 (RECOMENDADO) vs. enum
  nuevo; (e) UI -> seccion en `/wallet` (rol maestro) crear/listar egresos (form unificado con selector de
  tipo vs. separados); (f) INMUTABILIDAD -> append-only como el resto, correccion via movimiento
  compensatorio (patron de la 43) vs. edicion; (g) BALANCE -> reutiliza el balance derivado de la 42 (el
  egreso resta), confirmar SIN doble conteo ni regresion de 42/43/44.

- `trazabilidad / historial de estados de la orden` (id 49): **zone=fullstack, complexity=high,
  branch=feature/49-trazabilidad-historial-estados, depends_on=36 (done, en dev).** Evaluada 2026-07-13.
  Segunda del grupo "Fase 2 flujo mensajero" (46 -> **49** -> 47 -> 48); es la BASE TRANSVERSAL en la que
  se apoya la 47 (contador de intentos / escalado a rechazo). Fullstack (backend — tabla nueva de historial
  de estados + append en CADA transicion de la maquina de estados 17/30/33/34/36/46 + RLS + migracion;
  frontend — linea de tiempo en el detalle de la orden). complexity=high por ser TRANSVERSAL (instrumenta
  todos los puntos de escritura de estado del sistema). DECISION DE PROCESO (leader): NO se parte el entry;
  un ciclo fullstack (implementer delega backend_dev -> frontend_dev, un PR), precedente 16/24/30/41/46.
  **BASE DE RAMA (desviacion justificada de 'nacer de dev'):** la 49 se branquea desde el TIP de la
  feature/46 (= dev + 43 + 46), NO desde dev pelado, porque la 49 debe instrumentar TAMBIEN la transicion de
  liberacion que introdujo la 46 (`reprogramada -> en_bodega/en_bodega_satelite` via el cron), y la 46 aun no
  esta en dev (esta en PR #51). Consistente con el stacking de la cadena 37->43. Cuando el humano mergee #51,
  el PR de la 49 quedara limpio (git ya vera la 46 en dev). Preguntas ABIERTAS para F1.4 (el spec_author las
  formaliza): (a) DONDE vive el contador de intentos -> DERIVARLO del historial (contar transiciones de
  intento fallido/`devuelta`) sin columna nueva (recomendado; la 47 lo lee y aplica la regla de 3) vs. columna
  materializada en `orden`; (b) MECANISMO de captura -> helper/transicion CENTRALIZADA que toda escritura de
  estado invoca para append atomico al historial (recomendado, en la MISMA tx que el cambio de estado) vs.
  instrumentar cada call-site a mano; (c) FORMA de la tabla -> `orden_historial_estado` (orden_id, estatus_id
  origen/destino, actor/usuario_id, motivo?, created_at) append-only inmutable vs. reusar/extender algo
  existente; (d) BACKFILL de ordenes existentes -> sin backfill retroactivo (el historial arranca desde la
  feature; recomendado) vs. sembrar el estado actual como fila inicial; (e) ALCANCE del contador de intentos
  como concepto de la 49 vs. dejarlo integramente a la 47 (la 49 solo da el historial y la 47 deriva/aplica);
  (f) linea de tiempo -> UI en el detalle de la orden reusando patrones existentes, alcance de quien la ve
  (maestro/adminSatelite/tienda/mensajero) a definir. Insumos YA presentes en la rama: catalogo `order_status`,
  `gestion_orden`, servicios de transicion `GuiaAsignacionService`/`AsignacionSateliteService`/
  `MisAsignacionesService` + el cron `liberar-reprogramadas` (46).

- `reprogramacion: bloqueo y liberacion programada` (id 46): **zone=fullstack, complexity=high,
  branch=feature/46-reprogramacion-bloqueo-liberacion, depends_on=36 (done, en dev).** Evaluada
  2026-07-13. Seleccionada por el humano dentro del grupo "Fase 2 flujo mensajero (46/47/49)"; se
  arranca por la 46 (menor id, INDEPENDIENTE de 47/49). Fullstack (backend — job cron diario de
  liberacion en linea con `/api/cron/corte-diario` de la 41, guardas de bloqueo en las rutas de
  asignacion/envio 17/34, transicion de liberacion; frontend — reflejo "bloqueada hasta <fecha>" +
  aviso de liberacion). Insumos YA en dev: `gestion_orden.fechaReprogramacion` (Date) + `motivo` +
  `GestionResultado.reprogramada` + estado `reprogramada` (feature 36), infra Vercel Cron + `CRON_SECRET`
  (feature 41). DECISION DE PROCESO (leader): NO se parte el entry; por precedente (16/24/27/30/41) se
  corre como UN ciclo fullstack (implementer delega backend_dev -> frontend_dev, un PR). Rama creada
  desde `origin/dev` (f25f4a8, contiene 36/41/42). Orden previsto del grupo: 46 -> 49 (trazabilidad,
  base) -> 47 (reintentos, se apoya en 49) -> 48 (rechazo->tienda, depends 47). Preguntas ABIERTAS
  para F1.4 (el spec_author las formaliza): (a) estado destino de la LIBERACION -> volver a
  `en_bodega`/`en_bodega_satelite` segun la bodega responsable de la orden (recomendado, reusar el
  resolver de zona `findCentralZonaId`) vs. re-`en_espera_aceptacion` con el mismo mensajero; (b)
  DISPARADOR -> endpoint cron nuevo `/api/cron/liberar-reprogramadas` con el mismo schedule `0 6 * * *`
  (00:00 CR) de la 41 (recomendado) vs. plegarlo dentro de `corte-diario`; (c) alcance del BLOQUEO -> la
  orden `reprogramada` con `fechaReprogramacion > hoy` no reasignable/enviable (guarda server-side en
  17/34); (d) mecanismo del AVISO -> visibilidad derivada (seccion/badge "liberadas hoy" en la bodega
  responsable, sin tabla de notificaciones nueva) vs. registro persistente; (e) idempotencia del job
  (reejecucion no doble-libera) por diseno, patron de la 41.

- `paginacion` (id 8): **zone=frontend, complexity=medium, branch=feature/8-paginacion,
  depends_on=null.** Evaluada como frontend puro (compone con DataTable de feature 7;
  el backend `listarOrdenes({page,pageSize})` de feature 6 ya existe, no se toca).
  No es fullstack → sin particion. Rama creada desde `origin/dev` (ya al dia con
  order-list). Decisiones humanas Q1-Q4 (2026-07-09): server-side, selector 10/25/50
  (reset a pag 1), botones primera/ultima, ventana numerica con elipsis + aria-current.
- `componente carga masiva` (id 9): **zone=frontend, complexity=medium.** Componente
  de subida de archivo parametrizable (tipo, ruta API, plantilla). Zona ocupada por
  la 8 → en espera.
- `manejador de errores` (id 10): **zone=backend, complexity=medium,
  branch=feature/10-manejador-errores, depends_on=null.** SELECCIONADA (2026-07-09):
  zona backend libre mientras la 8 (frontend) sigue abierta → corren en paralelo.
  Estructura de error comun + wrapper para Server Actions/endpoints; NO toca UI.
  Worktree creado desde `origin/dev` en `../ordenex-f10`. Fase 1 (spec) en curso.
- `notificaciones` (id 11): **zone=frontend, complexity=low.** Toast de mensajes.
- `notificaciones - fix` (id 12): **zone=backend, complexity=medium, depends_on=10.**
  Reemplaza switch-case de errores por el manejador global (necesita la 10 done).
- `modal` (id 13): **zone=frontend, complexity=medium.** Modal reutilizable con
  soporte async (spinner + bloqueo de confirmacion).
- `ordenes - carga masiva` (id 14): **zone=frontend, complexity=low, depends_on=9.**
  Boton en ordenes que abre modal con el componente de carga masiva.
- `ordenes - carga masiva - etapa 2` (id 16): **zone=fullstack, complexity=medium,
  branch=feature/16-carga-masiva-etapa2, depends_on=15.** Evaluada 2026-07-10 con el
  codigo en mano: es FULLSTACK (backend nuevo — listar usuarios `role=mensajero` como
  `{id,nombre}` para el select y asignar/actualizar `mensajero_sugerido_id`; hoy no hay
  metodo de listado por rol en `UserRepository`; y frontend — resumen columna por columna
  + selects). DECISION DE PROCESO (leader): NO se parte la entrada del feature_list (que el
  humano curo) en dos; como las mitades son ESTRICTAMENTE SECUENCIALES (frontend depende del
  backend, sin paralelismo que ganar) se corre como UN ciclo fullstack (implementer delega
  backend_dev -> frontend_dev, un PR). Si el humano prefiere el split formal, se hace.
  Decisiones humanas (2026-07-10): (1) flujo POST-COMMIT — las ordenes ya las crea la 15 en
  `en_preparacion`; la 16 muestra el resumen y asigna mensajero sobre ordenes YA creadas, NO
  cambia la 15/14. (2) asignacion de mensajero AMBOS: select global "aplicar a todos" +
  override por fila.
- `dashboard/apartado del admin de tienda` (id 26): **zone=frontend, complexity=medium,
  branch=feature/26-dashboard-admin-tienda, depends_on=null.** Evaluada 2026-07-10:
  la descripcion dice "Frontend" y sus insumos estan done — autz por rol (feature 6),
  DataTable + columna tiendaNombre (feature 7), boton/modal de carga masiva (features
  14/16). NO hay backend nuevo: el filtrado de ordenes a la tienda del adminTienda ya lo
  hace la autz de la 6. Zona frontend LIBRE (unica en curso: 19 backend) -> corre en
  paralelo. Seleccionada por el humano ignorando la cadena de la 28 (28->27->17).
  ABIERTO para el spec: que mas muestra el dashboard del adminTienda ademas del modulo de
  ordenes (metricas/accesos) -> el humano decidira en la puerta de aprobacion F1.4.
- `gestion de zonas` (id 24): **zone=fullstack, complexity=high, branch=feature/24-gestion-zonas,
  depends_on=null.** Evaluada 2026-07-10: fullstack (migracion + seed XLSX + backend CRUD + UI en
  configuracion). Por precedente del repo (features 20/21/25 corrieron fullstack SIN partir) se corre
  como UN ciclo fullstack (implementer delega backend_dev->frontend_dev, un PR). Worktree
  `../ordenex-f24` desde `origin/dev`. Seleccionada por el humano (2026-07-10) excluyendo 23 y 27; la
  siguiente por id, la 17, esta bloqueada semanticamente por la 27 (in_progress). Es foundational:
  destraba 30 (asignacion por zona) y 39 (pago por zona). **F1 (spec R1-R28) COMPLETA -> spec_ready.**
  DOS GATES antes de impl: (1) es fullstack -> NO corre en paralelo con la feature 27 (tambien
  fullstack, in_progress en otra sesion); (2) el seed necesita el **Excel de zonas** que el humano debe
  proveer. Preguntas abiertas para F1.4 en `specs/24-gestion-zonas/requirements.md`.
  **F1.4 APROBADA por el humano 2026-07-10** (las 7 propuestas tal cual) -> status `in_progress` (F2.0).
  **IMPL EN ESPERA (no arrancada):** la feature 27 esta implementando AHORA en el checkout principal y
  ya tiene modificados `db/schema.prisma`, `UserRepository`/`IUserRepository`, `OrdenRepository` y la UI
  de configuracion -> arrancar la 24 chocaria en la migracion de `usuario` y los repos (regla #1 no
  negociable). La impl de la 24 arranca cuando la 27 este `done` en `dev`; entonces se sincroniza. El
  seed ademas espera el Excel. Rama `feature/24-gestion-zonas` pusheada con el spec para revision.

- `fulfillment de tienda + estado inicial condicional` (id 27): **zone=fullstack,
  complexity=high, branch=feature/27-fulfillment-tienda, depends_on=25.** Evaluada
  2026-07-10: fullstack (backend — campo booleano `fulfillment` en Usuario +
  migracion/down.sql + logica condicional en `BulkOrdenService`/carga masiva feature 15;
  frontend — switch 'esta tienda tiene fulfillment' en la UI de creacion de usuario de la
  feature 25). Deps 25 y 28 **done**. DECISION DE PROCESO (leader): NO se parte el entry
  del feature_list; las mitades son ESTRICTAMENTE SECUENCIALES (el switch del frontend
  depende del campo backend, sin paralelismo que ganar) -> se corre como UN ciclo
  fullstack (implementer delega backend_dev -> frontend_dev, un PR), mismo criterio que
  las features 16 y 25. Si el humano prefiere el split formal, se hace. Rama creada desde
  `origin/dev` (al dia con 21/25/50/28).

- `asignacion por zona (GAM) y ruteo a bodega satelite` (id 30): **zone=fullstack,
  complexity=high, branch=feature/30-asignacion-zona-ruteo-satelite, depends_on=24.**
  Evaluada 2026-07-11: fullstack (backend — nuevo `order_status` de ruteo a satelite,
  consultas de mensajeros filtradas por zona, transiciones de asignacion; frontend —
  UI del maestro: lista de mensajeros restringida a GAM + accion 'rutear a bodega
  satelite'). Deps 24 (zonas, con `distrito.zona_id` y `Usuario.zona_id`) y 17 (generar
  guia / `mensajero_asignado_id` / `en_espera_aceptacion`) **done**. DECISION DE PROCESO
  (leader): NO se parte el entry; por precedente del repo (16/24/25/27) se corre como UN
  ciclo fullstack (implementer delega backend_dev -> frontend_dev, un PR). Rama creada
  desde `origin/dev` (5e06aeb). Preguntas ABIERTAS para F1.4: (a) identificacion de la
  zona GAM -> flag `es_gam`/`es_central` en `zona` (recomendado) vs. por nombre 'GAM'
  -OJO: la 24 dejo `es_gam` como toggle de UI NO sembrado, hay que reconciliar-; (b)
  estado de ruteo -> UN `en_ruta_bodega_satelite` con nombre de zona derivado de
  `orden.zona_id` (recomendado, precedente `en_ruta_bodega_principal`) vs. estado por zona.

- `etiqueta de guia con QR y codigo de barras` (id 32): **zone=fullstack, complexity=medium,
  branch=feature/32-etiqueta-guia-qr, depends_on=17.** Evaluada 2026-07-11 con el código en mano:
  aunque "renderizar una etiqueta" suena frontend, el `OrdenDTO` (lib/types/orden.ts) NO expone
  `direccion`, `montoCobrar` ni los NOMBRES de provincia/canton/distrito (solo IDs; el listado
  añade `zonaNombre`/`tiendaNombre`). El modelo `Orden` sí tiene esos datos (direccion, montoCobrar,
  relaciones a geografía) → hace falta un READ backend que ensamble el payload completo de la
  etiqueta. Además NO hay librerías de QR ni de código de barras en package.json (deps nuevas). Por
  eso es FULLSTACK, un ciclo (precedente 16/24/25/27/30). Preguntas ABIERTAS para F1.4: (a) qué
  codifica el QR (orden.id UUID estable -recomendado, lo escanea la feature 33- vs num_guia); (b) qué
  codifica el código de barras (num_guia numérico -recomendado- vs num_remision); (c) render de la
  etiqueta (HTML imprimible con CSS print/window.print -recomendado, sin dep de PDF- vs PDF generado);
  (d) qué librerías QR + barcode (deps nuevas, el spec recomienda); (e) disparo (¿auto al 'Generar
  guía' vs acción "imprimir etiqueta" por orden/lote?; ¿una etiqueta por orden o hoja con el lote?).

- `mensajero - mis asignaciones y gestion de ordenes` (id 36): **zone=fullstack, complexity=high,
  branch=feature/36-mensajero-mis-asignaciones, depends_on=17.** Evaluada 2026-07-11: fullstack high,
  un ciclo. Las órdenes llegan al mensajero vía la 17 (`en_espera_aceptacion` + `mensajeroAsignadoId`);
  la 34 (asignación desde satélite) alimentará lo mismo más adelante pero NO bloquea (dep JSON = 17). Requiere
  NUEVO modelo de registro de gestión (evidencias/fotos en Supabase Storage -patrón `MensajeroDocumento`/
  `SupabaseFileStorage`/`ISignedUrlProvider` de la feature 21-, monto recibido, método de pago, motivos, fecha
  de reprogramación), NUEVO enum de método de pago (efectivo/SIMPE/transferencia; hoy NO existe), estado NUEVO
  'aceptada/por entregar', paso de aceptación (solo aceptar, sin rechazar la asignación), y bloqueo de gestión
  1-a-1. Preguntas ABIERTAS para F1.4: (a) nombre exacto del estado 'aceptada/por entregar'; (b) ¿el RESULTADO
  'RECHAZO' es estado NUEVO 'rechazada' o mapea a existente (devuelta/devuelta_origen)?; (c) forma del enum de
  método de pago (¿catálogo tabla como order_status vs enum PG?); (d) forma del modelo de gestión (un registro
  con `resultado` + campos nullable vs tablas separadas); (e) bloqueo 1-a-1 solo UI vs flag backend; (f) bucket
  de evidencias (reusar `mensajero-docs` vs nuevo `gestion-evidencias`); (g) aceptación en lote vs por-orden.

- `bodega satelite - mis asignaciones y recepcion por QR` (id 33): **zone=fullstack, complexity=high,
  branch=feature/33-recepcion-qr-satelite, depends_on=30.** Evaluada 2026-07-11: fullstack (vista del
  `adminSatelite` + transición de estado + escaneo). Se apoya en: `en_ruta_bodega_satelite` (feature 30, órdenes
  ruteadas a satélite), QR=`orden.id` (feature 32), `usuario.zonaId` del adminSatelite (feature 24), rol
  adminSatelite (feature 19). Añade estado NUEVO `en_bodega_satelite` (zona derivada de `orden.zonaId`, mismo
  patrón de la 30). Preguntas ABIERTAS para F1.4: (a) mecanismo de escaneo -> lector físico tipo teclado
  (keyboard-wedge, robusto/barato, recomendado) vs. cámara web (getUserMedia + lib QR) vs. ambos; (b) confirmar
  estado único `en_bodega_satelite` con zona derivada; (c) ¿el adminSatelite solo recibe órdenes de SU zona? (sí:
  rechazar escaneo de orden de otra zona); (d) recepción 1-a-1 por escaneo con feedback por item vs. lote;
  (e) ¿qué hace el escaneo de un QR inválido / orden no en_ruta_bodega_satelite / ya recibida?

## Conflictos pendientes

> Conflictos de merge que el agente no pudo resolver solo. El humano decide.

- ⛔ **`dev` ROTO por el PR #40 "adjustments" (2026-07-11, otra sesión)** — refactor grande mergeado a MEDIAS:
  renombró `cobros`→`tarifas` (ICobroRepository→ITarifaRepository, ICobroService→ITarifaService), remodeló
  `zona`/`distrito` (migraciones `rename_cobro_tarifas`, `zona_distrito_nm`), reescribió `IZonaRepository`/
  `lib/types/zona.ts`, y agregó sidebar/menú nuevo (shadcn). **Rompió el baseline**: `prisma validate` inválido
  (modelo `Zona` sin relación opuesta a `Usuario.zona`) + **86 errores de typecheck** (56 en producción). CAUSA
  concreta: quitó `ZonaDTO.esGam`/`pagoEntrega`/`pagoRechazo` y **eliminó `IZonaRepository.findGamZonaId()`**, PERO
  NO actualizó a sus consumidores → `lib/actions/ordenes-guia.ts` y `lib/services/GuiaAsignacionService.ts`
  (features 17/30/34) siguen llamando `findGamZonaId` y no compilan.
  - **Impacto**: `dev` no compila; NINGUNA feature nueva puede verificarse (init.sh rojo). La identificación de la
    zona GAM (base de 30/34/37) quedó sin mecanismo.
  - **Decisión del humano (2026-07-11)**: PAUSAR la feature 37; la **sesión dueña del refactor** (ramas
    `origin/adjustments`, `origin/worktree-menu-config-submenu`) debe dejar `dev` VERDE — reconciliando el código
    GAM de 17/30/34 con el nuevo modelo de zonas/tarifas (definir cómo se identifica GAM sin `esGam`). El leader NO
    repara el refactor ajeno a ciegas (colisión + decisión de diseño desconocida).
  - **Al retomar**: cuando `dev` compile en verde, la feature 37 arranca F2 con su spec INTACTO (`specs/37-...`,
    F1.4 ya aprobada). Verificar antes: `prisma validate` OK, `pnpm typecheck` 0 errores, `./init.sh` verde.

## Plan de la sesion
- [x] Features 1-29, 31, 50, 51: ciclos SDD completos (ver history.md).
- [x] Feature 17 (revisión maestro / generar guía): done, PR #32 mergeado 2026-07-11.
- [x] Feature 30 (asignación por zona GAM / ruteo satélite): done, PR #33 mergeado.
- [x] Feature 32 (etiqueta guía QR/barcode): done, PR #34 mergeado.
- [x] Feature 36 (mensajero mis asignaciones y gestión): done, PR #35 mergeado.
- [x] Feature 33 (recepción QR bodega satélite): done (impl+reviewer OK); pendiente PR a `dev`.
- [ ] Siguientes elegibles: **34** (asignación desde satélite, depends 33 done → desbloqueada), **37** (cierre del día,
      depends 36 done), **42** (wallet, depends 18 done), 35 (realtime).
- [ ] DEUDA nueva detectada: `/postulacion` (feature 21) rompe `pnpm build` (Prisma en prerender sin `dynamic`) → feature de corrección aparte.

## Notas / decisiones tomadas
- Modelos legacy de AGENTS.md (sonnet-4/opus-4.8) mapeados a sonnet/opus/haiku.
- Decision del humano (2026-07-09): TODOS los agentes con `opus`, ignorando la
  gradacion por complexity (la tabla resuelve a opus en todas las columnas).
- frontend_dev escalado de haiku a sonnet en login(home) por verificacion falsa.
- (2026-07-09) Refactor del proceso: ramas desde `dev`, PRs hacia `dev`,
  evaluacion automatica de `zone`/`complexity`, particion de `fullstack` y
  paralelismo por zonas disjuntas.

## Bloqueos / preguntas abiertas
- DEUDA DE DESPLIEGUE (parcial): ✅ **migraciones APLICADAS 2026-07-11** contra el Postgres
  LOCAL (`localhost:5432`), `prisma migrate deploy` + `db:seed` OK, `migrate status` up to date.
  RESTA (env-dependiente): ejecutar los E2E en verde (requieren harness de seed/login e2e —
  hoy los specs usan emails placeholder; candidato a feature propia), verificar rechazo RLS con
  key anon (T004), rollback de migracion (T020, destructivo), y el seed de ZONAS (necesita el
  Excel del humano). Hasta esos, CHECKPOINTS no llega al 100% pese al estado `done`.
