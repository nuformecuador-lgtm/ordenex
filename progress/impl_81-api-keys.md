# Bitacora — Feature 81 "api keys" (backend puro)

Rama `feature/81-api-keys`, worktree `ordenex-f81` (aislado, desde `origin/dev` `a0957ec`).
Spec: `specs/81-api-keys/` — D1..D8 aprobadas por el humano en el gate F1.4, **cero
overrides**. Implementadas tal cual, sin re-abrir ninguna.

## Alcance respetado

**DENTRO:** generar la key, crear el usuario dedicado, persistir el hash, devolver la
key en claro una sola vez.
**FUERA (no se toco, por pedido explicito):** consumo de la key en peticiones
(middleware/header) y UI de gestion. `middleware.ts` y `AuthService.login` **no se
tocaron**: el cierre del login es "de facto" (contrasena aleatoria e ignota, D4); el
rechazo duro es la feature **81a**.

## Baseline MEDIDO (no citado de `current.md`)

Medido en este worktree con el WIP **stasheado** (`git stash -u`) y el cliente Prisma
regenerado desde el schema limpio. Ojo: sin ese `pnpm db:generate` el baseline sale
contaminado (el cliente generado por la tanda previa ya traia `apiKey` en `RolValue` y
`rol-label.ts` fallaba con TS2741 en un arbol por lo demas limpio).

| Medida | Baseline (limpio) | Final (con la feature) |
| --- | --- | --- |
| `pnpm typecheck` | 0 errores | **0 errores** |
| `pnpm lint` | 0 errores / 140 warnings | **0 errores / 140 warnings** (identico) |
| `pnpm test` | **19 failed / 3067 passed** (3086), 12 files | **1 failed / 3181 passed** (3182), 1 file |

### Los fallos preexistentes son flakes de carga (verificado, no supuesto)

El conjunto de fallos **varia entre corridas del mismo arbol limpio**: la corrida 1 del
baseline fallaba `tests/unit/guards/no-embalaje.test.ts` con `Test timed out in 5000ms`
y la corrida 2 no. Son tests de UI (`tests/components/`, `tests/integration/`), ninguno
de mi capa. La corrida final deja **1 solo fallo**, `CierreDiaPage.test.tsx > R1: el rol
mensajero ve el modulo...`, que **esta en la lista del baseline**.

No todos son puro timeout: en aislado, `HomePageMaestro.test.tsx > R1: rol admin...`
falla con `TestingLibraryElementError: Found multiple elements with the role "heading"
and name "Panel maestro"`. Preexistente y fuera de mi alcance igualmente; lo dejo
anotado sin tocarlo.

**Regresiones introducidas: 0.**

## Dos regresiones REALES que si cause, detectadas y arregladas (sin aflojar nada)

El 6.º valor del enum rompio 4 tests que fallaban **en aislado** (⇒ no eran flakes):

1. `tests/unit/scripts/seed-catalogos.test.ts` (3 tests) — contaba 5 roles. `ROLES_SEED
   = Object.values(RolValue)` ⇒ el seed crea 6. Actualizado a 6 **manteniendo la
   exactitud** (sigue afirmando conteo exacto y grafia exacta, y que `rol_permiso`
   queda intacto — que es justamente la evidencia del fallo seguro de D1).
2. `tests/integration/db/zonas-migration.test.ts` (1 test) — exige que toda migracion
   posterior a la de zonas se registre en su allowlist ("apendida despues"), convencion
   ya establecida en el repo. Registradas las dos mias. Un unico `!d.endsWith("_api_key")`
   cubre las dos carpetas (`_rol_api_key` tambien termina en `_api_key`).

Ninguna se "puso verde" borrando ni relajando asserts.

## Round-trip de migracion: **REAL**, no estatico

Contra Postgres 16 real: contenedor docker efimero `ordenex-f81-pg` (puerto 55481), base
**desechable `f81_rt`** creada y destruida para esto. **Nunca la DB compartida**: `.env`
apunta a `localhost:5432` y NO se toco; el `DATABASE_URL` se paso por variable de entorno
solo al comando.

`prisma migrate deploy` (UP) → `down.sql` de ambas en orden inverso (DOWN) → `deploy` de
nuevo (UP). Salida real verificada con `psql`:

```
# tras el UP
RLS=true                      <- R23
POLICIES=0                    <- R23 (solo service role)
IDX=api_key_pkey / api_key_key_hash_key / api_key_usuario_id_key / api_key_created_by_id_idx
ENUM=maestro,admin,mensajero,Admin Tienda,adminSatelite,apiKey
ROL=apiKey
ROL_PERMISO_APIKEY=0          <- D1: fallo seguro CONFIRMADO en vivo

# tras el DOWN
TABLE_EXISTS=0
ENUM_AFTER_DOWN=maestro,admin,mensajero,Admin Tienda,adminSatelite   <- tipo recreado sin apiKey
ROL_APIKEY_ROWS=0
ORPHAN_TYPES=0                <- sin rol_value_old huerfano

# segundo UP: "All migrations have been successfully applied."
# R25 en vivo:
ERROR: duplicate key value violates unique constraint "api_key_key_hash_key"
DETAIL: Key (key_hash)=(HASHDUP) already exists.
```

**Correccion de una afirmacion heredada:** el comentario de
`tests/integration/db/api-key-migration.test.ts` ya afirmaba un round-trip real "con
evidencia en `progress/impl_81-api-keys.md`" — y ese archivo **no existia**. Era una
afirmacion sin respaldo. No la herede: rehice el round-trip yo y reescribi el comentario
para que cite evidencia que ahora si existe (esta arriba). El test en si es **ESTATICO**
(regex sobre el SQL); la suite de vitest no levanta Postgres, y esta etiquetado como tal.

**Nota D1 (por que DOS migraciones y no una):** Postgres prohibe usar un valor de enum en
la misma transaccion que lo creo (55P04). `ALTER TYPE ... ADD VALUE` va en
`20260716140000_rol_api_key` y el `INSERT` que lo usa en `20260716150000_api_key`. Es el
precedente que el repo ya tenia (`_rol_admin_satelite` / `_seed_roles_catalogo`). El
round-trip real confirma que funciona; fusionarlas reventaria en deploy.

## Archivos

**Creados**
- `db/migrations/20260716140000_rol_api_key/{migration.sql,down.sql}`
- `db/migrations/20260716150000_api_key/{migration.sql,down.sql}`
- `lib/types/api-key.ts`
- `lib/interfaces/services/IApiKeyService.ts`, `lib/interfaces/repositories/IApiKeyRepository.ts`
- `lib/repositories/ApiKeyRepository.ts`, `lib/services/ApiKeyService.ts`, `lib/actions/api-keys.ts`
- `lib/utils/api-key-generator.ts`, `lib/utils/api-key-hash.ts`, `lib/utils/api-key-identity.ts`
- Tests: `tests/unit/utils/api-key-{generator,hash,identity}.test.ts`,
  `tests/unit/services/api-key-service.test.ts`, `tests/unit/actions/api-keys.test.ts`,
  `tests/unit/repositories/api-key-repository.test.ts`,
  `tests/integration/db/api-key-migration.test.ts`

**Modificados**
- `db/schema.prisma` — `apiKey` en `RolValue`, `model ApiKey`, 2 back-relations en `Usuario`
- `lib/auth/rol-label.ts` — label del rol nuevo (el `Record<RolValue,string>` es exhaustivo)
- `tests/unit/types/roles.test.ts`, `tests/unit/scripts/seed-catalogos.test.ts`,
  `tests/integration/db/zonas-migration.test.ts` — 5 → 6 roles / allowlist de migracion
- `specs/81-api-keys/tasks.md` — T01-T17 `[x]`; **T18 queda `[ ]` a proposito**

## Decisiones clave implementadas

- **D7 (el que mas se presta a confusion):** la **key** va con **SHA-256**
  (`lib/utils/api-key-hash.ts`, permite el lookup `WHERE key_hash = $1` de 81a). La
  **contrasena** del usuario dedicado va con **bcrypt** (`hashPassword`). No se
  confundieron; el fichero documenta por que.
- **D1:** rol `apiKey` sembrado **sin filas en `rol_permiso`** (verificado en vivo: 0).
- **D2:** solo `maestro`. El test de `forbidden` **deriva los roles del enum** en vez de
  listarlos a mano: si mañana alguien añade un rol, el test lo cubre solo.
- **D4:** `apikey+<slug>@apikey.invalid` (RFC 2606) / `APIKEY-<slug>`, `telefono=""`,
  lookup de `tipoIdentificacion.value='cedula'`. Derivados en el service, **nunca
  suministrables desde el borde** (si no, un maestro podria apuntar una key a un email real).
- **D5:** `activo`. **D6:** `UNIQUE(usuario_id)`. **D8:** sin UNIQUE en `identificador`.

## Higiene

- **0 `console.*`** en el codigo de produccion de la feature (verificado por grep). Ni el
  secreto ni su hash se loguean (R20). `plainKey`/`passwordPlain` no salen de
  `ApiKeyService`/`lib/types`.
- Reusados en vez de duplicados: `hashPassword`/`generateStrongPassword`,
  `textoConstraintP2002`, `UsuarioDuplicadoError`/`CatalogoInvalidoError`,
  `withErrorHandler`/`toActionError`, `resolveActorFromSession`.
- Capas respetadas: la action no conoce Prisma; el service no conoce `next/headers`; el
  repo no tiene logica de negocio. `PUBLIC_SELECT` nunca proyecta `keyHash` (R19).

## Mapa R<n> → test

| R | Test |
| --- | --- |
| R1 | `api-keys.test.ts` › `R1: devuelve unauthenticated cuando no hay cookie de sesion, sin tocar el service` |
| R2 | `api-key-service.test.ts` › `R2: rechaza con forbidden cuando el actor no es maestro y no crea filas`; `api-keys.test.ts` › `R2: propaga el forbidden del service` |
| R3 | `api-keys.test.ts` › `R3: acepta el limite inferior (3) y el superior (60)` / `R3: recorta los espacios antes de validar y de pasar al service` |
| R4 | `api-keys.test.ts` › `R4: %s -> validation_error en 'identificador', sin tocar el service` (it.each: <3, vacio, solo espacios, >60, falta campo, tipo incorrecto) + `R4: %s -> validation_error (detalle en la raiz)` |
| R5 | `api-key-identity.test.ts` (tabla: acentos/mayusculas/simbolos/espacios); `api-key-service.test.ts` › `R5` (slug derivado) |
| R6 | `api-key-service.test.ts` › `R6: rechaza con validation_error cuando el slug queda vacio` |
| R7 | `api-key-service.test.ts` › `R7` (nombre derivado del identificador); `api-key-repository.test.ts` |
| R8 | `api-key-service.test.ts` › `R8` (hash bcrypt de contrasena aleatoria, distinta cada vez; `verifyPassword`) |
| R9 | `api-key-service.test.ts` › `R9` (el resultado no contiene la contrasena en claro) |
| R10 | `api-key-service.test.ts` › `R10`; `api-key-identity.test.ts` (email/cedula sinteticos) |
| R11 | `api-key-service.test.ts` › `R11` (conflict email/cedula); `api-keys.test.ts` › `R11: propaga el conflict del service con su campo`; `api-key-repository.test.ts` (P2002 → `UsuarioDuplicadoError`) |
| R12 | `api-key-repository.test.ts` › `R12` (rol `apiKey` + `estado='activo'`) |
| R13 | `api-key-repository.test.ts` › `R13` (usuario+key en `$transaction`; si falla uno no persiste el otro) |
| R14 | `api-key-generator.test.ts` › `R14` (256 bits; 1000 llamadas sin colision) |
| R15 | `api-key-generator.test.ts` › `R15` (prefijo `ordx_`) |
| R16 | `api-key-hash.test.ts` › `R16` (SHA-256 determinista, 64 hex); `api-key-service.test.ts` › `R16` (persiste el hash, nunca el claro) |
| R17 | `api-key-generator.test.ts` › `R17` (`key_prefix` de 12 chars, no secreto) |
| R18 | `api-key-service.test.ts` › `R18`; `api-keys.test.ts` › `R18: propaga el secreto en claro del service tal cual, una sola vez` |
| R19 | `api-key-repository.test.ts` › `R19` (`PUBLIC_SELECT` sin `keyHash`); `api-keys.test.ts` › `expect(r.apiKey).not.toHaveProperty("keyHash")` |
| R20 | `api-key-service.test.ts` › `R20` (espia sobre `console`: no loguea secreto ni hash) |
| R21 | `api-key-service.test.ts` / `api-key-repository.test.ts` › `R21` (`usuario_id`, `created_by_id`, `created_at`) |
| R22 | `api-key-service.test.ts` › `R22` (dos generaciones con el mismo identificador → secretos distintos) |
| R23 | `api-key-migration.test.ts` › `R23` (`ENABLE ROW LEVEL SECURITY`, sin policies) + **verificado en vivo** (`relrowsecurity=true`, `POLICIES=0`) |
| R24 | `api-key-migration.test.ts` › `R24` (down.sql revierte; enum recreado) + **round-trip real UP→DOWN→UP** |
| R25 | `api-key-migration.test.ts` › `R25` (`UNIQUE(key_hash)`) + **verificado en vivo** (INSERT duplicado rechazado) |

Feature-tests: **106 passed / 106** (8 archivos).

## Pendiente para el leader (no lo hago yo)

- `./init.sh` y el bookkeeping (`feature_list.json` → `done`, `progress/history.md`).
- **T18:** registrar 81a/81b **solo si el humano lo pide**. No lo pidio ⇒ no se hizo.

## Veredicto

Feature 81 implementada completa dentro del alcance acotado, D1-D8 tal cual, round-trip
de migracion REAL contra Postgres 16, 25/25 requisitos trazados a test, 0 regresiones
sobre baseline medido.
