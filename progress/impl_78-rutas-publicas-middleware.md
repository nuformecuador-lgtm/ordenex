# impl — Feature 78: rutas públicas alcanzables (middleware)

Fecha: 2026-07-16 · Rama: `feature/78-rutas-publicas-middleware` · Worktree:
`C:\Users\Cristian\Documents\trabajo\arc\ordenex-f78` · Base: `origin/dev` `a0957ec`.

## Archivos tocados

Producción (diff mínimo, exactamente lo autorizado):

- `middleware.ts` — **2 entradas** nuevas en `PUBLIC_ROUTES` (`/recuperar-contrasena`,
  `/postulacion`) + comentario que explica la lista y por qué `/paquete` NO está.
  **No se tocó** el guard (`:11-16`), el matcher (`:22`) ni `pathname.startsWith(r)`
  (decisión (b) del humano: se conserva el match por prefijo tal cual).
- `lib/actions/password-reset.ts` — **solo comentario** (R7). Verificado: 20 líneas
  añadidas, **0 líneas añadidas que no sean comentario**. Cero cambio de comportamiento.

Tests:

- `tests/unit/auth/middleware.test.ts` — **nuevo**, primer test de `middleware.ts` del repo.

Infra local (no versionado): se copió `.env` desde el repo principal (el worktree no lo
traía por estar gitignored) y se corrió `pnpm db:generate`; sin eso, `pnpm typecheck`
daba 40+ errores falsos de `@prisma/client`. `.env` sigue ignorado, no entra al commit.

**NO se tocó** (prohibiciones explícitas, verificadas en el diff): `OtpChallengeIssuer.ts`
(ni el `console.log:39` ni los comentarios `:27-30`), `EmailProvider.ts:3-9`, la lógica de
reset, el OTP y la UI. `/paquete` **no** se añadió a `PUBLIC_ROUTES`.

## T1 — Sonda de `NextRequest` (bloqueaba T2)

**Resultado: camino 1 (node directo).** No hizo falta ningún fallback.

`NextRequest` instancia sin problema en el entorno `node` (default de
`vitest.config.ts:10`) con Node v22.13.1 / Next 16.2.10, sin mock de `next/server` y sin
`// @vitest-environment jsdom`. Verificado por sonda desechable (2 tests, ambos verdes,
luego borrada):

- `new NextRequest(new URL("/login", "https://app.test"))` → `request.nextUrl.pathname === "/login"`.
- `cookies.get("session")` → `undefined` si no está; tras `cookies.set("session","abc123")`
  → `.value === "abc123"`.

Por tanto **no** se usó jsdom (fallback 1) ni el doble mínimo (fallback 2, el peor). Los
tests construyen el `NextRequest` real e importan el middleware real vía `@/middleware`.

## Baseline MEDIDO en el worktree (T0) vs final (T6)

Medido, no citado de la bitácora.

| | Baseline (`a0957ec`, antes de tocar nada) | Final (`340ea95`) |
|---|---|---|
| `pnpm typecheck` | **0 errores** (tras `db:generate`) | **0 errores** |
| `pnpm lint` | **0 errores**, 140 warnings (exit 0) | **0 errores**, 140 warnings (exit 0) |
| `pnpm test` | **5 failed / 3081 passed (3086)**, 4 files | **2 failed / 3091 passed (3093)**, 2 files |

Total de tests 3086 → **3093 (+7)**: exactamente los 7 casos nuevos de middleware, los 7
en verde. **Cero regresiones.** Lint y typecheck idénticos al baseline.

### Los fallos remanentes son flakes ajenos (comprobado, no supuesto)

El conteo de fallos **sigue a la carga de la máquina, no al diff**. Tres corridas de la
suite completa en la misma rama final:

- 126s → 2 failed · 191s (baseline, sin mis cambios) → 5 failed · 270s → 11 failed.

Todos `Error: Test timed out in 5000ms` (patrón conocido 72/73/76), y el **conjunto de
archivos que falla cambia entre corridas**. `tests/unit/auth/middleware.test.ts` **nunca**
aparece entre los fallos.

Verificación en aislado, uno por archivo (11 candidatos): 8 de 11 pasan. Los 3 que aún
fallaban se midieron **contra un checkout limpio de `origin/dev` `a0957ec`** (HEAD
detached en el mismo worktree, como el reviewer de la 77):

| Archivo | Base `a0957ec` aislado | Rama f78 aislado | Veredicto |
|---|---|---|---|
| `tests/components/CierreDiaPage.test.tsx` | **1 failed** / 3 passed | 1 failed / 3 passed | **Preexistente en `dev`**, idéntico |
| `tests/components/HomePageRol.test.tsx` | 4 passed (3/3 corridas) | 4 passed (3/3 corridas) | Flake de carga |
| `tests/components/HomePage.test.tsx` | 1 passed (3/3 corridas) | **1 failed en 1 de 8 corridas**, 7 verdes | Flake de carga |

`HomePage.test.tsx` es no determinista (falló 1 de 8 corridas en la rama, siempre por
timeout, luego 5/5 verdes seguidas). Además **no puede** verse afectado por este cambio:
solo importa `@/app/(app)/page`, no menciona `middleware` ni `password-reset`
(`grep` = 0), `middleware.ts` no está en su grafo de imports, y el diff de
`password-reset.ts` es solo comentario (0 líneas de código). No es regresión.

**No se borró ni aflojó ningún test** (patrón #70/#75).

## T2 → T3: el test se vio FALLAR contra el bug (no se invirtió el orden)

Con `middleware.ts` sin arreglar, `pnpm test tests/unit/auth/middleware.test.ts`:

```
 Tests  2 failed | 5 passed (7)

 FAIL > deja pasar /recuperar-contrasena sin cookie de sesion
 AssertionError: expected 'https://app.test/login?redirect=%2Fre…' to be null
 + Received: "https://app.test/login?redirect=%2Frecuperar-contrasena"

 FAIL > deja pasar /postulacion sin cookie de sesion
 AssertionError: expected 'https://app.test/login?redirect=%2Fpo…' to be null
 + Received: "https://app.test/login?redirect=%2Fpostulacion"
```

Exactamente los casos 1 y 2 (la reproducción del bug); los casos 3–7 ya pasaban. Tras el
cambio de `PUBLIC_ROUTES`:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**El caso 7 (`/paquete`) siguió verde SIN añadir `/paquete` a la lista**: el diff de
`middleware.ts` (12 insertions) añade solo `/recuperar-contrasena` y `/postulacion`. El
alcance no se violó.

## Mapa R → test

| R | Test | Estado |
|---|------|--------|
| R1 | `deja pasar /recuperar-contrasena sin cookie de sesion` | verde (rojo antes del fix) |
| R2 | `deja pasar /postulacion sin cookie de sesion` | verde (rojo antes del fix) |
| R3 | `deja pasar /login sin cookie de sesion` + `deja pasar /api/health sin cookie de sesion` | verde |
| R4 | `redirige a /login con ?redirect= cuando una ruta privada no trae cookie` | verde |
| R5 | `deja pasar una ruta privada cuando trae cookie de sesion` | verde |
| R6 | `caracterizacion: hoy /paquete/[numGuia] redirige a /login sin cookie (pendiente feature 79)` | verde (fija el estado ACTUAL, no el deseado) |
| R7 | **Documental**, sin assert: `TODO(feature 80)` en `lib/actions/password-reset.ts` donde se instancia `StubEmailProvider`. Lo verifica el reviewer por inspección. | pendiente reviewer |

Todos en `tests/unit/auth/middleware.test.ts`. Los tests **no** afirman nada sobre el
match por prefijo (puede endurecerse luego, decisión (b)) ni sobre la validez de la
cookie (el middleware solo mira su presencia).

### R7 — contenido verificado contra el código, no supuesto

- No hay proveedor real: `package.json` no tiene Resend/SendGrid/SES/nodemailer (grep = 0).
- `StubEmailProvider` (`EmailProvider.ts:11-15`) solo hace `console.info` de metadata.
- La entrega del OTP depende hoy del `console.log("Codigo OTP generado:", code)` de
  `OtpChallengeIssuer.ts:39` (se conserva a propósito, decisión (c)).
- `lib/interfaces/external/IEmailProvider.ts` ya está lista para la implementación real.
- Los comentarios de `EmailProvider.ts:3-9` y `OtpChallengeIssuer.ts:27-30` quedan
  desactualizados **a propósito** hasta la feature 80; el `TODO:` los señala por nombre.

## T5 — Verificación manual en sesión anónima (`next dev`, puerto 3001, sin cookie)

El bug era de runtime; ningún unit test lo sustituye.

| Comprobación | Resultado |
|---|---|
| `/recuperar-contrasena` sin cookie | **200**, sin redirect. Renderiza `Recuperar contraseña` + `<input id="reset-email" type="email">` |
| `/postulacion` sin cookie | **200**, sin redirect. Renderiza `Postulación de mensajero` + inputs (`nombre`, `primer_apellido`, …) |
| `/ordenes` sin cookie (no-regresión) | **307** → `http://localhost:3001/login?redirect=%2Fordenes` |
| `/paquete/ABC123` sin cookie (caracterización) | **307** → `/login?redirect=%2Fpaquete%2FABC123` (sigue cerrada, feature 79) |
| `/recuperar-contrasena` con cookie **inválida** | **200** (middleware deja pasar; el guard de la página no halla sesión y muestra el form) |

Ambas páginas **cargan**: el bug está corregido en runtime.

### Limitación honesta de T5

La cuarta comprobación pedida —`/recuperar-contrasena` **con sesión válida** sigue
redirigiendo a `/`— **no se ejercitó end-to-end**: requiere una sesión válida en DB y el
script de sonda no pudo resolver `DATABASE_URL` fuera del cargador de env de Next
(`SASL: client password must be a string`). No se forzó por no escribir en una DB real.

No obstante, ese guard es **demostrablemente inalterado** por este diff: vive en
`app/recuperar-contrasena/page.tsx:14-22` (no tocado) y una request **con** cookie recibía
`NextResponse.next()` del middleware **antes** (rama de cookie presente, `:18`) y lo recibe
**ahora** (rama pública, `:9`). En ambos casos la página se ejecuta igual y su propio guard
decide. Se deja anotado en vez de declararlo verificado.

## Commits

- `ab1de83` — `test(78): tests de middleware sobre rutas publicas y guard de sesion` (rojo)
- `84faa87` — `fix(78): suma recuperar-contrasena y postulacion a PUBLIC_ROUTES` (verde)
- `340ea95` — `chore(78): documenta el estado real del proveedor de correo (feature 80)`

## Veredicto

Bug corregido con el diff mínimo autorizado (`middleware.ts` 2 entradas +
`password-reset.ts` solo comentario), cubierto por los 7 primeros tests de `middleware.ts`
del repo —vistos fallar antes del fix— y confirmado en runtime; cero regresiones
(typecheck y lint idénticos al baseline, los fallos remanentes son flakes de carga o
preexistentes en `dev`, medidos contra checkout limpio).
