# Feature 81 — API keys — design.md

> Este diseno asume las recomendaciones D1-D8 de `requirements.md`. Si el humano
> hace override en el gate F1.4, los puntos marcados **[D<n>]** cambian.

## 1. Vista general

```
lib/actions/api-keys.ts            ← Controller (Server Action, 'use server')
  ↓ zod + resolveActorFromSession()
lib/services/ApiKeyService.ts      ← Service (genera secreto, deriva usuario, autoriza)
  ↓ IApiKeyRepository
lib/repositories/ApiKeyRepository.ts  ← Repository (Prisma, transaccion usuario+key)
  ↓
Supabase (Postgres): usuario + api_key
```

Mutacion interna disparada desde un componente propio ⇒ **Server Action**, no route
handler (`docs/architecture.md` §"Server Actions vs Route Handlers"). No se crea
`app/api/api-keys/`: eso pertenece a 81a (consumo por terceros).

## 2. Modelo de datos

### Tabla nueva `api_key`

| columna | tipo | nota |
| --- | --- | --- |
| `id` | TEXT PK | uuid, `@default(uuid())` como el resto del schema |
| `identificador` | TEXT NOT NULL | el input crudo (recortado), para mostrar. No unico **[D8]** |
| `slug` | TEXT NOT NULL | normalizado; base del email/cedula sinteticos |
| `key_prefix` | TEXT NOT NULL | `ordx_` + 7 chars. No secreto **[D3]** |
| `key_hash` | TEXT NOT NULL UNIQUE | SHA-256 hex del secreto completo **[D7]** (R16/R25) |
| `usuario_id` | TEXT NOT NULL UNIQUE | FK → `usuario.id`, ON DELETE RESTRICT. UNIQUE = 1:1 **[D6]** |
| `created_by_id` | TEXT NOT NULL | FK → `usuario.id`, ON DELETE RESTRICT (R21) |
| `created_at` | TIMESTAMP(3) NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMP(3) NOT NULL | `@updatedAt` |

Sin `revoked_at`, `expires_at` ni `last_used_at`: **fuera de alcance** (81b). Se
añaden aditivamente cuando el humano los pida; ninguna decision de aqui lo impide.

Indices: PK; `UNIQUE(key_hash)` (R25, y es el lookup de 81a);
`UNIQUE(usuario_id)` **[D6]**; `INDEX(created_by_id)` (listado futuro por creador).

### Prisma (`db/schema.prisma`)

```prisma
model ApiKey {
  id            String   @id @default(uuid())
  identificador String
  slug          String
  keyPrefix     String   @map("key_prefix")
  keyHash       String   @unique @map("key_hash")
  usuarioId     String   @unique @map("usuario_id")
  createdById   String   @map("created_by_id")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  usuario   Usuario @relation("ApiKeyUsuario", fields: [usuarioId], references: [id])
  createdBy Usuario @relation("ApiKeyCreadaPor", fields: [createdById], references: [id])

  @@index([createdById])
  @@map("api_key")
}
```
`Usuario` gana dos back-relations: `apiKey ApiKey? @relation("ApiKeyUsuario")` y
`apiKeysCreadas ApiKey[] @relation("ApiKeyCreadaPor")`.

### Enum `RolValue` **[D1]**

```prisma
enum RolValue {
  maestro
  admin
  mensajero
  adminTienda   @map("Admin Tienda")
  adminSatelite
  apiKey        // feature 81: cuenta dedicada a una API key; SIN permisos asignados
}
```

### Migracion `db/migrations/<ts>_api_keys/`

`migration.sql` (aditiva, R24), en este orden:
1. `ALTER TYPE "rol_value" ADD VALUE 'apiKey';` **[D1]**
2. `INSERT INTO "rol" (id, value) VALUES (md5(random()::text || clock_timestamp()::text), 'apiKey') ON CONFLICT DO NOTHING;`
   (patron de `20260710130000_rol_admin_satelite` y `20260711000000_seed_roles_catalogo`;
   `md5(...)` para no depender de extensiones, como `20260716130000_premio_ranking`).
3. `CREATE TABLE "api_key" (...)` + FKs `ON DELETE RESTRICT`.
4. `CREATE UNIQUE INDEX "api_key_key_hash_key"`, `"api_key_usuario_id_key"`,
   `CREATE INDEX "api_key_created_by_id_idx"`.
5. `ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;` (R23) — **sin policies**,
   solo service role, patron `premio_ranking` / `wallet_movimiento`
   (`db/migrations/20260716130000_premio_ranking/migration.sql:37`). La
   autorizacion de negocio vive en el service (R2).

`down.sql` (R24):
1. `DROP TABLE IF EXISTS "api_key";` (arrastra indices, FKs y RLS).
2. `DELETE FROM "rol" WHERE value = 'apiKey';`
3. El valor de enum: Postgres **no** soporta `DROP VALUE`. El `down.sql` recrea el
   tipo (`ALTER TYPE rol_value RENAME TO rol_value_old` → `CREATE TYPE rol_value AS ENUM (...)`
   sin `apiKey` → `ALTER TABLE rol ALTER COLUMN value TYPE rol_value USING value::text::rol_value`
   → `DROP TYPE rol_value_old`). Falla ruidosamente si quedan filas con `apiKey`,
   que es el comportamiento correcto: primero se borran las keys.
   **Nota para el implementer:** verificar contra
   `20260715120000_order_status_recibido_origen` si el repo ya tiene un precedente
   de este patron y reusarlo tal cual.

## 3. Contratos I/O

`lib/types/api-key.ts`:

```ts
export const generarApiKeySchema = z.object({
  identificador: z.string().trim().min(3).max(60),   // R3
});
export type GenerarApiKeyInput = z.infer<typeof generarApiKeySchema>;

export type GenerarApiKeyResult =
  | { status: "ok"; apiKey: ApiKeyPublico; plainKey: string }   // R18: unica vez
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R4/R6
  | { status: "conflict"; campo: "email" | "cedula" }           // R11
  | { status: "forbidden" }                                     // R2
  | { status: "unauthenticated" };                              // R1

export interface ApiKeyPublico {          // NUNCA incluye keyHash ni plainKey (R19)
  id: string; identificador: string; keyPrefix: string;
  usuarioId: string; createdAt: Date;
}
```

`plainKey` viaja solo en el retorno de la Server Action y no se persiste ni loguea
(R9/R18/R20). `ApiKeyPublico` es el unico tipo que sale del repositorio (patron
`PUBLIC_SELECT` de `lib/repositories/UserRepository.ts:22-35`, que nunca proyecta
el hash).

Interfaces (`docs/architecture.md` §Interfaces):
- `lib/interfaces/services/IApiKeyService.ts` → `generar(input, actor)`.
- `lib/interfaces/repositories/IApiKeyRepository.ts` → `createConUsuario(data)`.

## 4. Generacion del secreto **[D3]**

`lib/utils/api-key-generator.ts` (helper puro, sin side effects, patron
`lib/utils/password-generator.ts`):

```ts
const API_KEY_PREFIX = "ordx_";
const PREFIX_VISIBLE_CHARS = 12;   // "ordx_" + 7

export function generateApiKey(): { plain: string; prefix: string } {
  const secret = randomBytes(32).toString("base64url");  // 256 bits (R14/R22)
  const plain = `${API_KEY_PREFIX}${secret}`;            // R15
  return { plain, prefix: plain.slice(0, PREFIX_VISIBLE_CHARS) }; // R17
}
```

## 5. Hasheo **[D7]** — y la alternativa descartada

**Elegido:** SHA-256 (`createHash("sha256").update(plain).digest("hex")`) para
`api_key.key_hash`. La contrasena del usuario dedicado **si** usa
`hashPassword()` (bcrypt cost 10, `lib/utils/password.ts:3-7`), manteniendo la
alineacion con el login que pidio el humano donde esa alineacion importa.

**Descartada: bcrypt tambien para `key_hash`** (era la lectura literal de "alinear
con el hasheo bcrypt del login"). Por que no:

1. **No aporta lo que bcrypt aporta.** El KDF lento protege secretos de *baja*
   entropia contra diccionario. Una key de 256 bits uniformes no tiene diccionario:
   ni con SHA-256 ni con bcrypt es atacable por fuerza bruta offline.
2. **Rompe el lookup.** bcrypt sala cada hash ⇒ el mismo secreto produce hashes
   distintos ⇒ no existe `WHERE key_hash = $1`. Verificar una key en 81a exigiria
   `bcrypt.compare` contra **cada fila** de `api_key`: O(n) hashes lentos por
   request. Con SHA-256 es un unico hit al indice UNIQUE. Esto choca de frente con
   "queries sin indice en rutas calientes" (`docs/architecture.md` §Anti-patrones).
3. **Coste por request.** cost 10 ≈ 50-100 ms de CPU **por peticion autenticada**
   cuando llegue 81a. Inaceptable para una API.
4. **Truncamiento.** bcrypt ignora los bytes mas alla de 72
   (`lib/types/password-policy.ts:12-13`); nuestra key son 48 chars, cabe hoy, pero
   es una trampa si el formato crece.

El precio de SHA-256 (sin sal ⇒ vulnerable a rainbow tables) **no aplica**: no hay
rainbow table posible para 2^256 valores aleatorios.

**Segunda alternativa descartada — no crear usuario, sino una tabla `api_key`
suelta con permisos propios:** mas limpia conceptualmente (una key no es una
persona), pero el humano pidio explicitamente "generar y asignar a un usuario" y
todo el RBAC del repo cuelga de `usuario.rol_id` (`resolve-actor.ts:24-30`,
`rol_permiso`). Un sujeto de autorizacion paralelo obligaria a duplicar la
resolucion de permisos en 81a. Se descarta por pedido explicito y por coste.

## 6. Derivacion del usuario sintetico **[D4]**

`lib/utils/api-key-identity.ts` (puro):

```ts
slugify(identificador)  // R5: NFD → sin diacriticos → lower → [^a-z0-9]+ → "-" → trim "-"
emailSintetico(slug)    // `apikey+${slug}@apikey.invalid`   (RFC 2606, no enrutable)
cedulaSintetica(slug)   // `APIKEY-${slug}`
```

`ApiKeyService.generar()`:
1. `if (!actor) → unauthenticated` (R1) — lo hace la action.
2. `if (actor.rol !== "maestro") → forbidden` (R2) **[D2]**, mismo patron que
   `UsuarioService.ALLOWED_ROLES` (`lib/services/UsuarioService.ts:31`).
3. `slug = slugify(input.identificador)`; vacio → `validation_error` (R6).
4. `plain = generateStrongPassword()` (R8) → `passwordHash = await hashPassword(plain)`;
   `plain` no se retorna ni se loguea (R9) y sale de scope.
5. `{ plain: plainKey, prefix } = generateApiKey()`; `keyHash = sha256(plainKey)`.
6. `repo.createConUsuario({...})` en **una transaccion** (R13).
7. → `{ status: "ok", apiKey, plainKey }` (R18).

`ApiKeyRepository.createConUsuario()` usa `prisma.$transaction` (R13): resuelve
`rol.value = 'apiKey'` **[D1]** y `tipoIdentificacion.value = 'cedula'` **[D4]**
por lookup (nunca ids hardcodeados — `docs/architecture.md` §"Sin hardcode de
contexto"), crea el `usuario` (`estado: "activo"` **[D5]**, `telefono: ""`,
`zonaId: null`, `fulfillment: false`) y la `api_key`. Mapea P2002 a
`UsuarioDuplicadoError("email" | "cedula")` reutilizando `textoConstraintP2002`
(`lib/repositories/_shared/prisma-unique.ts`, ya usado en
`UserRepository.ts:229-236`) → el service lo traduce a `conflict` (R11).

**Por que no reusar `UsuarioService.crear()`:** su contrato
(`CrearUsuarioInput`) exige `email`, `cedula`, `telefono` y
`tipoIdentificacionId` desde el borde y valida con `crearUsuarioSchema`, mientras
que aqui esos valores son **derivados** y no deben ser suministrables por el
cliente (si lo fueran, un maestro podria apuntar una key a un email real). Ademas
`crear()` no puede participar de la transaccion que exige R13. **Si se reusa**
`UserRepository`/`hashPassword`/`generateStrongPassword`: la duplicacion evitada
esta en la capa correcta.

## 7. Seguridad

- RLS activo sin policies ⇒ solo service role (R23).
- El secreto en claro existe solo en memoria del server durante la request y en el
  valor de retorno de la Server Action (R18/R20). Ningun `console.log` lo toca.
  **Nota:** `lib/services/OtpChallengeIssuer.ts:39` loguea el OTP en claro — es un
  anti-patron existente que **no** se replica aqui y que no se arregla en esta
  feature (fuera de alcance).
- El usuario sintetico no puede entrar por `/login` de facto (contrasena aleatoria
  descartada). El cierre por construccion es 81a — ver D4.
