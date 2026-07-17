# Review — Feature 81 "api keys"

Worktree `ordenex-f81`, rama `feature/81-api-keys`, commit de impl **`c0e37d6`** (29 archivos),
nacida de `origin/dev` `a0957ec`. Revisado contra `specs/81-api-keys/`, `docs/` y `CHECKPOINTS.md`.

**Todo lo de abajo se reprodujo. No se cito nada de la bitacora sin medirlo.**

## Checklist

### Especificacion
- [x] `requirements.md` con R1-R25 EARS numerados. Gate F1.4 resuelta: D1-D8 aprobadas con la recomendacion, cero overrides.
- [x] `design.md` con alternativas descartadas y su porque (seccion 5: bcrypt para key_hash; y "no crear usuario").
- [x] `tasks.md`: T01-T17 marcadas. **T18 sin marcar a proposito** (su condicion era "solo si el humano lo pide"; no lo pidio). No es hallazgo.

### Trazabilidad R1-R25 (corrida por mi, no leida)
- [x] Las 25 R mapean a un test **real** que prueba lo que su nombre dice. Auditados uno a uno; ninguno vacio ni tautologico.
- [x] Corrida de los 8 archivos de la feature + los 3 tests preexistentes tocados: **131 passed / 131**, 10 files, 3.32s.
- [x] `progress/impl_81-api-keys.md` contiene el mapa R-a-test.

Muestreo de calidad real de los tests (no solo su nombre):
- **R2** deriva los no-maestros de `Object.values(RolValue)` en vez de listarlos: un rol nuevo queda cubierto solo. Ademas assert de `not.toHaveBeenCalled()` sobre el repo (no crea filas).
- **R8** exige prefijo bcrypt, 60 chars, y hash distinto entre generaciones.
- **R13** (repo) cubre las 3 ramas: ambos INSERT dentro de una unica transaccion, fallo de la key escala, fallo del usuario nunca intenta la key.
- **R20** espia los 6 metodos de `console` y ademas afirma que el service **no loguea NADA** en el camino feliz.
- **R19** afirma que el repo solo expone `createConUsuario` y que `PUBLIC_SELECT` no proyecta `keyHash`.

### Alcance (acotado por el humano a "solo generar y asignar")
- [x] **Cero fuga de 81a/81b.** `git diff a0957ec c0e37d6 -- lib/services/AuthService.ts middleware.ts` sale **vacio**: intactos.
- [x] grep de `apiKey` en `AuthService.ts` / `middleware.ts` / `resolve-actor.ts`: **ninguna referencia**. El rechazo duro en login **no** se colo (correcto: es 81a).
- [x] Ningun `.tsx`, ningun `app/`: sin UI de gestion (81b).
- [x] La migracion no crea `revoked_at` / `expires_at` / `last_used_at`, y hay un test que lo blinda.

### D1 — fallo seguro (verificado EN VIVO, no por lectura)
Round-trip propio en DB desechable **`f81_rev`** que yo cree y destrui, en el contenedor efimero
`ordenex-f81-pg` (puerto 55481). **Nunca la DB compartida** del `.env` (localhost:5432): el
`DATABASE_URL` se paso solo por variable de entorno al comando.

Tras el UP:

    RLS=true                 <- R23
    POLICIES=0               <- R23 (solo service role)
    IDX=api_key_pkey / api_key_key_hash_key / api_key_usuario_id_key / api_key_created_by_id_idx
    ENUM=maestro,admin,mensajero,Admin Tienda,adminSatelite,apiKey
    ROL_APIKEY_ROWS=1
    ROL_PERMISO_APIKEY=0     <- D1 fallo seguro

- [x] El rol `apiKey` nace **sin ninguna fila en `rol_permiso`**. Comprobado ademas por grep: ni las dos migraciones ni `scripts/seed-catalogos.ts` conceden permiso alguno a `apiKey`.
- [x] El `down.sql` **recrea el tipo** (RENAME TO rol_value_old, CREATE TYPE, ALTER COLUMN TYPE, DROP TYPE). No usa DROP VALUE (que Postgres no soporta).

Tras el DOWN (ambos `down.sql` en orden inverso):

    TABLE_EXISTS=0
    ENUM_AFTER_DOWN=maestro,admin,mensajero,Admin Tienda,adminSatelite   <- 5 originales
    ROL_APIKEY_ROWS=0
    ORPHAN_TYPES=0           <- sin rol_value_old huerfano
    USUARIO_ROL_COL_TYPE_OK=1

Segundo UP: "All migrations have been successfully applied." mas `RLS=true`, `POLICIES=0`,
`ROL_PERMISO_APIKEY=0`. **Round-trip UP-DOWN-UP reproducido: la bitacora es honesta.**

- [x] **R25 en vivo:** el INSERT duplicado se rechaza de verdad: `duplicate key value violates unique constraint "api_key_key_hash_key"`, `DETAIL: Key (key_hash)=(HASHDUP) already exists.`
- [x] La separacion en DOS migraciones (ADD VALUE aparte del INSERT que lo usa) es correcta y necesaria: Postgres 55P04. El test la blinda contra una futura "simplificacion".

### D7 — los dos hasheos NO se cruzaron
- [x] La **key** con **SHA-256** (`lib/utils/api-key-hash.ts`, createHash sha256 digest hex), lo unico que se persiste en `key_hash`.
- [x] La **contrasena** del usuario dedicado con **bcrypt** via `hashPassword` (`ApiKeyService.ts:40`), reusando `lib/utils/password.ts`.
- [x] El test de R8 exige el prefijo bcrypt y el de R16 exige 64 chars hex y que `keyHash === hashApiKey(plainKey)`. Imposible que se confundan sin romper tests.

### D4 — cierre "de facto", no por construccion
- [x] email `apikey+<slug>@apikey.invalid` (RFC 2606), cedula `APIKEY-<slug>`, telefono vacio, `tipoIdentificacionId` por lookup de value 'cedula' (sin valor nuevo de catalogo).
- [x] Derivados **en el service**; el contrato de entrada solo acepta `identificador` (test R12: lo capturado no tiene `rolId` ni `estado`, y sus claves son exactamente las 8 esperadas). Un maestro no puede apuntar una key a un email real.
- [x] El rechazo duro en `AuthService.login` **NO esta** (correcto: es 81a).

### Calidad de codigo (medido por mi en este worktree)
- [x] `pnpm run typecheck` -> **0 errores**.
- [x] `pnpm run lint` -> **0 errores / 140 warnings** (igual al baseline reportado).
- [x] `pnpm test` -> **1 failed / 3181 passed** (3182), 328 files. El unico fallo es `tests/components/CierreDiaPage.test.tsx` (ver menor #1).
- [x] **Ningun `console.*`** en el codigo de produccion de la feature (grep sobre los 8 modulos mas `rol-label.ts`): NONE. No hay secreto que se pueda colar por ahi.
- [x] Sin secretos hardcodeados. Sin hardcode de pais/moneda/contexto: rol y tipo de identificacion se resuelven por **lookup por value**, nunca por id.

### Datos y seguridad
- [x] R23: `api_key` con RLS habilitada y **0 policies** (patron premio_ranking), confirmado en vivo.
- [x] R24: migraciones aditivas (no DROP TABLE, no altera `usuario`) y con `down.sql` que revierte exactamente. Round-trip real.
- [x] R25: UNIQUE(key_hash), confirmado en vivo.
- [ ] Webhooks: N/A (la feature no introduce ninguno).

### Patron de capas
- [x] Action (`lib/actions/api-keys.ts`): solo sesion, zod y llamada al service. Sin Prisma, sin logica de negocio.
- [x] Service (`lib/services/ApiKeyService.ts`): sin `next/headers`, sin Prisma. Autorizacion D2: solo `maestro`.
- [x] Repository (`lib/repositories/ApiKeyRepository.ts`): solo queries, sin logica de negocio ni permisos.
- [x] Interfaces en `lib/interfaces/services/` y `lib/interfaces/repositories/`, separadas por categoria.
- [x] Mutacion interna via Server Action, no route handler.
- [x] Reuso en vez de duplicacion: `hashPassword`, `generateStrongPassword`, `textoConstraintP2002`, `UsuarioDuplicadoError`, `CatalogoInvalidoError`, `withErrorHandler`, `toActionError`, `resolveActorFromSession`.

### Auditoria con lupa del diff de tests preexistentes (el incidente del PR #75)
**Veredicto: son actualizaciones de un conteo correcto, NO relajaciones.** Ninguna asercion se aflojo,
ningun test se borro, ningun expect se convirtio en algo mas debil.

- `tests/unit/scripts/seed-catalogos.test.ts`: 5 a 6. Sigue afirmando **conteo exacto** (`toBe(6)`, no `toBeGreaterThan`), **grafia exacta** (`toEqual` de la lista completa ordenada, no `arrayContaining`), idempotencia con id estable, y `upsert` llamado **exactamente** 6 veces con `rolPermiso` intacto — que es justamente la evidencia del fallo seguro de D1. El conteo real es consecuencia forzosa de `ROLES_SEED = Object.values(RolValue)`.
- `tests/unit/types/roles.test.ts`: 5 a 6 con `toHaveLength(6)` exacto y la lista completa por `toEqual`. **Ademas AÑADE** un test nuevo (apiKey SIN @map) que blinda la migracion. El diff **endurece**, no afloja.
- `tests/integration/db/zonas-migration.test.ts`: una sola linea de allowlist, misma convencion ya usada por las features 69/73/76. El invariante (comparacion de timestamps) queda igual. El `endsWith` cubre las dos carpetas a proposito y esta comentado.

### Verificacion final
- [ ] `./init.sh` **NO termina en verde** (ver menor #1). Falla en `pnpm run test` por fallos **preexistentes y ajenos** a esta feature.
- [x] `progress/review_81-api-keys.md` existe (este archivo).
- [ ] Entrada en `progress/history.md` y `feature_list.json`: bookkeeping del **leader** (ver menor #2).

---

## Hallazgos

### menor #1 — `./init.sh` en rojo por tests de UI preexistentes y flaky (ajenos a la feature)
`./init.sh` corre typecheck (verde), lint (verde) y test (**rojo**), y aborta.
Los fallos **no los causa la feature 81**, y lo verifique:
- Corrida A (`pnpm test`): 1 failed, `tests/components/CierreDiaPage.test.tsx`.
- Corrida B (dentro de `./init.sh`): **2 failed, conjunto distinto**: `CierreDiaPage.test.tsx` mas `tests/integration/recuperar-contrasena-form.test.tsx`. El conjunto **varia entre corridas del mismo arbol**, o sea flakes de carga, confirmado empiricamente.
- `CierreDiaPage.test.tsx` no referencia `apiKey` por ningun lado y **no esta entre los 29 archivos del commit**. Falla tambien en aislado (getByRole "region" name "Entregadas"), asi que ademas es un fallo preexistente real, no solo timeout.
- El delta es netamente **positivo**: baseline reportado 19 failed / 3067 passed, medido ahora **1 failed / 3181 passed**. **Regresiones introducidas por la feature 81: 0.**

No lo hago bloqueante porque no es atribuible a este commit ni esta en su alcance, pero
**CHECKPOINTS.md exige `./init.sh` en verde para pasar a `done`**: el leader no deberia cerrar 81
como `done` sin sanear esos tests de UI (hay varias features in_progress en el board que los tocan).

### menor #2 — la feature 81 no existe en `feature_list.json`
`feature_list.json` tiene 77 features y **ninguna** es 81 / "api keys" (verificado con node).
Es bookkeeping del **leader** (el implementer lo declaro explicitamente fuera de su alcance, con razon),
pero conviene anotarlo: mientras 81 no este registrada, `./init.sh` no puede validar su zone contra la
regla "una feature por zona a la vez". Nota lateral: `jq` no esta instalado, asi que ese chequeo de
`init.sh` se degrada a un warn y hoy **no se ejecuta** en esta maquina de todos modos.

### menor #3 — la atomicidad real de R13 no se prueba contra Postgres
El test de R13 mockea la transaccion como un simple callback, que **no** hace rollback de verdad: lo que
se verifica es el contrato (una unica llamada a `$transaction`, ambos create sobre el cliente `tx`, la
excepcion escala). La atomicidad efectiva la aporta Prisma, no el test. Es la limitacion estandar del
repo (vitest no levanta Postgres) y el codigo usa `$transaction` correctamente, asi que no es
bloqueante; lo dejo anotado por si 81a añade una prueba de integracion contra DB real.

### menor #4 — el E2E quedo diferido a 81a sin confirmacion explicita del humano
CHECKPOINTS.md pide E2E (Playwright) si la feature toca auth. `tasks.md` propone diferirlo a 81a y dice
"Confirmar en el gate junto a D1-D8", pero el bloque del gate solo resuelve D1-D8: no menciona el E2E.
En la practica **no hay nada que un E2E pueda manejar** (sin UI, sin consumo de la key; la unica
superficie es una Server Action ya cubierta por tests de la action), asi que el diferimiento es
tecnicamente correcto. Lo dejo como pendiente de confirmacion formal del humano, no como bloqueante.

### Nota positiva (no es hallazgo)
El implementer detecto y corrigio una afirmacion heredada falsa: el comentario de
`api-key-migration.test.ts` citaba evidencia en un archivo que no existia. Rehizo el round-trip y
etiqueto el test como **ESTATICO** (regex sobre el SQL). **La etiqueta es honesta**: lo lei entero y, en
efecto, solo lee `migration.sql` / `down.sql` con `fs.readFileSync` y regex; no toca Postgres. Ademas
filtra los comentarios antes de las aserciones de ausencia, para no darse falsos positivos con su propia
prosa. Es el tipo de rigor que se pide aqui.

---

## Bloqueantes

**Ninguno.** 0 bloqueantes.

## Veredicto

**OK** — Feature 81 aprobada. 25/25 requisitos trazados a tests reales que prueban lo que dicen;
alcance respetado sin fugas de 81a/81b; D1 (fallo seguro, ROL_PERMISO_APIKEY=0), D4 y D7 (SHA-256 vs
bcrypt sin cruzarse) implementadas tal cual; round-trip de migracion UP-DOWN-UP **reproducido por mi**
en DB desechable; 0 console.* en produccion; ningun test borrado ni aflojado (el diff de los tests
preexistentes endurece, no relaja); 0 regresiones (1 failed / 3181 passed frente a 19 failed / 3067
passed de baseline).

4 menores, todos para el **leader**, ninguno atribuible al codigo de esta feature. El unico que bloquea
el paso a `done` segun CHECKPOINTS.md es el menor #1 (`./init.sh` en rojo por tests de UI preexistentes
y flaky), que es deuda ajena y precede a este commit.
