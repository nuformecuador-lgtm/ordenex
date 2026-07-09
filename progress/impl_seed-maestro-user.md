# Impl: seed-maestro-user

Migracion SQL que siembra un usuario `maestro` (data seed via migracion, NO via
`pnpm db:seed`).

## Archivos creados
- `db/migrations/20260709120000_seed_maestro_user/migration.sql` (UP)
- `db/migrations/20260709120000_seed_maestro_user/down.sql` (DOWN)

No se toco UI, ni schema.prisma (el seed no cambia el esquema, solo datos).

## Decisiones
- **Coste bcrypt: 10.** Es el `SALT_ROUNDS` de `lib/utils/password.ts`, funcion
  `hashPassword`. El login existente verifica con `verifyPassword` (mismo modulo,
  `bcrypt.compare`) desde `AuthService.login`, asi que el hash sembrado con coste
  10 y prefijo `$2b$` es verificable por el flujo de login real.
- **Hash embebido en `migration.sql`** en la columna `password_hash`. El texto
  plano NUNCA se almacena en ningun archivo.
- **Prerequisitos de catalogo idempotentes:** los catalogos (`rol`,
  `tipo_identificacion`) se siembran por script (`scripts/seed-catalogos.ts`), no
  por migracion. Como esta migracion podria correr antes, hace
  `INSERT ... ON CONFLICT (value) DO NOTHING` para `rol` value `maestro` y
  `tipo_identificacion` value `cedula`. Ids generados con `gen_random_uuid()::text`
  (Postgres 13+ / Supabase lo proveen en core/pgcrypto).
- **Insert del usuario idempotente** por `ON CONFLICT ("email") DO NOTHING`.
  `tipo_identificacion_id` y `rol_id` resueltos por subconsulta sobre `value`.
  `estado` casteado a `'activo'::estado_usuario`. `created_at`/`updated_at` = `now()`.
- **down.sql** solo hace `DELETE FROM "usuario" WHERE "email"='admin@ordenex.test'`.
  No borra catalogos (podian existir de antes y otros registros dependen de ellos).

### Valores del usuario
- email: `admin@ordenex.test` (exacto)
- password en claro: (exacto, provisto por el spec) — solo como hash bcrypt, len 20
- nombre: `Maestro Ordenex`
- telefono: `0999999999`
- cedula: `1700000001`
- estado: `activo`
- rol: `maestro` / tipo_identificacion: `cedula`

## Verificacion del hash
Generado y verificado con bcryptjs (el paquete ya instalado), coste 10:
```
HASH=$2b$10$...  (prefijo $2b$10$, embebido en migration.sql)
LEN=20
COMPARE=true      <- bcrypt.compareSync(<plain>, hash) === true
```

## Salidas reales
- `pnpm db:generate`: OK — `Generated Prisma Client (v7.8.0)`.
- `pnpm typecheck`: OK — `tsc --noEmit` sin errores.
- `pnpm lint`: OK — `eslint` sin errores.
- `pnpm test`: `Test Files 24 passed (24)`, `Tests 144 passed (144)`.

## Revision de sintaxis SQL (a ojo, contra 20260708212416_login_usuario_rba)
- Identificadores con comillas dobles (`"usuario"`, `"password_hash"`, ...).
- Casts de enum: `'maestro'::rol_value`, `'activo'::estado_usuario` (mismos tipos
  declarados en la migracion de login).
- `tipo_identificacion.value` es TEXT (sin enum), sin cast — correcto.

## Deuda diferida
- No hay Postgres disponible en el entorno; la migracion NO se aplico contra una
  DB real (mismo estado que el resto de features). Queda pendiente aplicar
  `migration.sql` y probar `down.sql` contra Postgres/Supabase real, y confirmar
  que `gen_random_uuid()` esta disponible en la instancia destino.

## Veredicto
VERDE — seed idempotente listo; compareSync=true con bcrypt coste 10; typecheck/
lint/test/db:generate en verde. Aplicacion contra DB real diferida como deuda.
