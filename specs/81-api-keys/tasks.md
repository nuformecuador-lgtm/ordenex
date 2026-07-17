# Feature 81 — API keys — tasks.md

> **Gate F1.4 primero.** T01 bloquea todo lo demas: D1 (rol) y D4 (email/cedula)
> cambian el schema y la migracion. No empezar por T02 sin respuesta.
> `[P]` = paralelizable con las tasks de su mismo bloque.

## Bloque 0 — Gate

- [x] **T01** — Registrar en este archivo la resolucion humana de D1-D8 de
  `requirements.md` (rol, quien genera, formato, email/cedula, estado, cardinalidad,
  hasheo, unicidad del identificador).
  **Hecho:** cada D<n> tiene "aprobado" u override escrito aqui. Bloquea T02-T14.

## Bloque 1 — Datos (depende de T01)

- [x] **T02** — `db/schema.prisma`: añadir `apiKey` a `enum RolValue` **[D1]**,
  `model ApiKey` y las dos back-relations en `Usuario`.
  **Hecho:** `pnpm prisma validate` pasa y `pnpm run typecheck` ve `ApiKey` en el
  cliente generado.
- [x] **T03** (dep. T02) — `pnpm run db:migrate:create` → editar
  `db/migrations/<ts>_api_keys/migration.sql` con los 5 pasos de `design.md` §2
  (ADD VALUE, seed en `rol`, CREATE TABLE, indices, `ENABLE ROW LEVEL SECURITY`).
  **Hecho:** el SQL incluye `ENABLE ROW LEVEL SECURITY` (R23) y `UNIQUE(key_hash)` (R25).
- [x] **T04** (dep. T03) — Escribir `down.sql` a mano: DROP TABLE + DELETE del rol +
  recreacion del enum sin `apiKey` (Postgres no tiene DROP VALUE). Reusar el
  precedente del repo si existe.
  **Hecho:** `pnpm run db:migrate` y luego `pnpm run db:rollback` corren limpios,
  y un segundo `db:migrate` vuelve a aplicar sin error (R24).

## Bloque 2 — Utilidades puras (dep. T01; entre si, paralelas)

- [x] **T05 [P]** — `lib/utils/api-key-generator.ts`: `generateApiKey()` con
  `randomBytes(32).toString("base64url")` y prefijo `ordx_` **[D3]**.
  **Hecho:** test unitario: prefijo correcto, longitud esperada, 1000 llamadas sin
  colision (R14/R15/R17/R22).
- [x] **T06 [P]** — `lib/utils/api-key-hash.ts`: `hashApiKey(plain)` SHA-256 hex **[D7]**.
  **Hecho:** test: determinista, 64 chars hex, distinto para entradas distintas (R16).
- [x] **T07 [P]** — `lib/utils/api-key-identity.ts`: `slugify`, `emailSintetico`,
  `cedulaSintetica` **[D4]**.
  **Hecho:** tests de tabla: acentos, mayusculas, simbolos, espacios; entrada solo
  simbolos → `""` (alimenta R6).

## Bloque 3 — Capas (dep. Bloque 1 + 2)

- [x] **T08** — `lib/types/api-key.ts`: `generarApiKeySchema` (min 3 / max 60 tras
  trim) + `GenerarApiKeyResult` + `ApiKeyPublico`.
  **Hecho:** `ApiKeyPublico` no tiene `keyHash` (R19) y typecheck pasa.
- [x] **T09 [P]** (dep. T08) — Interfaces `lib/interfaces/services/IApiKeyService.ts`
  y `lib/interfaces/repositories/IApiKeyRepository.ts`.
  **Hecho:** existen en su carpeta por categoria (`CHECKPOINTS.md` §Patron de capas).
- [x] **T10** (dep. T09) — `lib/repositories/ApiKeyRepository.ts`: `createConUsuario()`
  con `prisma.$transaction` (R13); lookup de `rol.value='apiKey'` y
  `tipoIdentificacion.value='cedula'` (sin ids hardcodeados); P2002 →
  `UsuarioDuplicadoError` via `textoConstraintP2002`.
  **Hecho:** sin logica de negocio ni validacion de permisos dentro; el select de
  retorno no proyecta `keyHash`.
- [x] **T11** (dep. T10) — `lib/services/ApiKeyService.ts`: autorizacion **[D2]**,
  slug vacio → `validation_error`, `generateStrongPassword` + `hashPassword`,
  `generateApiKey` + `hashApiKey`, transaccion, retorno con `plainKey`.
  **Hecho:** no importa nada de `next/headers` ni de Prisma (R: service sin HTTP/DB).
- [x] **T12** (dep. T11) — `lib/actions/api-keys.ts` (`'use server'`):
  `resolveActorFromSession()` → `UnauthenticatedError` si null; `generarApiKeySchema.parse`;
  `withErrorHandler` + `toActionError`, patron `lib/actions/usuarios.ts:59-71`.
  Con `deps` inyectables para test.
  **Hecho:** sin queries Prisma ni logica de negocio en la action.

## Bloque 4 — Tests (dep. Bloque 3). Mapa R<n> → test

Cada fila es obligatoria; el reviewer rechaza si falta una (`CHECKPOINTS.md` §Trazabilidad).

- [x] **T13** — `tests/unit/services/api-key-service.test.ts`:
  | R | test |
  | --- | --- |
  | R1 | `rechaza con unauthenticated cuando no hay sesion` (en T14) |
  | R2 | `rechaza con forbidden cuando el actor no es maestro y no crea filas` |
  | R3/R4 | `rechaza identificador de menos de 3 y de mas de 60 caracteres` |
  | R5 | `deriva el slug normalizando acentos y simbolos` |
  | R6 | `rechaza con validation_error cuando el slug queda vacio` |
  | R7 | `crea un usuario nuevo con el nombre derivado del identificador` |
  | R8 | `persiste solo el hash bcrypt de una contrasena aleatoria distinta cada vez` |
  | R9 | `el resultado no contiene la contrasena en claro` |
  | R10 | `deriva email y cedula al espacio reservado de api keys` |
  | R11 | `devuelve conflict cuando el email o la cedula derivados ya existen` |
  | R12 | `asigna el rol y el estado acordados en D1/D5` |
  | R13 | `no persiste la key si falla la creacion del usuario (y viceversa)` |
  | R14/R15 | `genera un secreto de 256 bits con el prefijo ordx_` |
  | R16 | `persiste el hash de la key y nunca el secreto en claro` |
  | R17 | `persiste un key_prefix no secreto` |
  | R18 | `devuelve el secreto en claro exactamente una vez` |
  | R19 | `el repositorio no expone ninguna lectura del secreto` |
  | R20 | `no loguea el secreto ni el hash` (espia sobre `console`) |
  | R21 | `registra usuario_id, created_by_id y created_at` |
  | R22 | `dos generaciones con el mismo identificador dan secretos distintos` |
  **Hecho:** todos verdes con repos mockeados, sin DB.
- [x] **T14 [P]** — `tests/unit/actions/api-keys.test.ts`: **R1**
  (`devuelve unauthenticated cuando no hay cookie de sesion`) y propagacion de
  `validation_error` desde zod (R4).
  **Hecho:** verde con `deps` inyectados.
- [x] **T15 [P]** — `tests/integration/api-key-migration.test.ts` (o verificacion
  documentada si el repo no tiene DB de test): **R23** (`api_key` tiene
  `relrowsecurity = true`), **R24** (rollback), **R25** (`UNIQUE(key_hash)` rechaza
  el duplicado).
  **Hecho:** los tres asserts pasan contra la DB de test.

> **E2E:** `CHECKPOINTS.md` exige E2E si la feature toca auth. Esta feature **crea**
> credenciales pero no las consume ni cambia `middleware.ts` ni `AuthService`, y no
> hay UI (fuera de alcance). **Propuesta:** el E2E se cubre en 81a, donde el flujo
> de auth existe de verdad. **Confirmar en el gate junto a D1-D8.**

## Bloque 5 — Cierre (dep. Bloque 4)

- [x] **T16** — bitacora con el mapa `R<n> → test` de T13-T15.
  **Hecho:** escrita en `progress/impl_81-api-keys.md` (nombre pedido por el leader,
  no `impl_81.md`). Las 25 R tienen al menos un test nombrado.
- [x] **T17** (dep. T16) — `pnpm run typecheck`, `pnpm run lint`, `pnpm test`.
  **Hecho:** typecheck 0 errores; lint 0 errores / 140 warnings (= baseline);
  suite sin regresiones vs. baseline medido. Salida real en la bitacora.
  **Nota:** `./init.sh` NO se corrio (bookkeeping de `feature_list.json`/estado, que
  es del leader; este worktree aislado no lo posee). Se reporta, no se simula.
- [ ] **T18** (dep. T17) — Registrar en `feature_list.json` las features hermanas
  81a (consumo) y 81b (gestion) **solo si el humano lo pide**; entrada en
  `progress/history.md`.
  **NO HECHA — a proposito.** La condicion ("solo si el humano lo pide") no se
  cumplio: el humano no pidio registrar 81a/81b en esta tanda. El bookkeeping de
  `feature_list.json`/`history.md` y el paso de 81 a `done` son del leader.
