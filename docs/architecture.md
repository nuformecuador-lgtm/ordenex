# docs/architecture.md — Que significa "buen trabajo" aqui

Referencia de arquitectura. El reviewer usa esto para decidir si una implementacion
esta bien hecha, no solo si "funciona".

## Stack
- **Frontend/servidor:** Next.js (App Router) + TypeScript en modo strict.
- **Estilos:** Tailwind CSS v4.
- **Componentes:** shadcn/ui (Radix UI base). Primero revisar si existe en shadcn/ui
  antes de crear uno propio. `npx shadcn add <component>`.
- **Datos:** Supabase (Postgres), con Row Level Security en toda tabla sensible.
- **ORM:** Prisma con migraciones versionadas up/down.
- **Validacion:** zod en el borde de toda entrada externa.
- **Data fetching cliente:** SWR para queries publicas/no sensibles.
- **Mutaciones internas:** Server Actions (`'use server'`) para crear/editar/eliminar
  dentro del mismo proyecto. No usar `fetch` a rutas API internas para mutaciones.
- **API externa/webhooks:** Route handlers en `app/api/` con zod + firma/idempotencia.
- **Deploy:** Vercel. Secretos en variables de entorno, nunca en repo.
- **Integraciones tipicas:** Meta Ads API, WhatsApp Cloud API.

## Principios
1. **Separacion de capas.** Controller, Service, Repository con interfaces. La logica
   de negocio vive en servicios testeables, separada de HTTP y de la DB.
2. **Borde tipado.** Toda entrada externa (request, webhook, respuesta de API) se
   valida y se tipa en el borde con zod. Nada de `any` cruzando la frontera.
3. **Idempotencia en webhooks.** Un mismo evento entrante no debe producir efectos
   duplicados. Validar firma/token siempre.
4. **Sin hardcode de contexto.** Pais, moneda, cuenta y credenciales se resuelven
   por configuracion, nunca incrustados en el codigo.
5. **Migraciones versionadas y reversibles.** Toda migracion Prisma tiene su
   `migration.sql` (UP) y `down.sql` (DOWN). Ver `scripts/db-rollback.ts`.

## Patron de capas: Controller → Service → Repository

```
app/api/orders/route.ts              ← Controller (capa HTTP)
  ↓ llama a (via interfaz)
lib/services/OrderService.ts         ← Service (logica de negocio)
  ↓ llama a (via interfaz)
lib/repositories/OrderRepo.ts        ← Repository (acceso a datos, Prisma)
  ↓
Supabase (Postgres)
```

### Controller (route handler o Server Action)
- **Route handler** (`app/api/<feature>/route.ts`): recibe Request, parsea/valida con
  zod, llama al service, devuelve `NextResponse`. No contiene logica de negocio ni
  queries de DB.
- **Server Action** (`lib/actions/<feature>.ts`): `'use server'`, recibe datos,
  lee cookies para permisos, instancia el service, ejecuta, devuelve resultado.
  Para mutaciones internas, NO crear ruta API y fetchearla desde el cliente.

### Service (`lib/services/`)
- Logica de negocio pura. Sin dependencia de HTTP (Request/Response/headers) ni
  de DB directamente. Recibe repositorios y clientes externos por constructor
  (inyeccion de dependencias via interfaces).
- Testeable sin DB ni HTTP.

### Repository (`lib/repositories/`)
- Acceso a datos. Solo Prisma queries. Sin logica de negocio ni validacion de
  permisos (eso va en el service o controller). Implementa `IRepository`.

### Interfaces (`lib/interfaces/`)
- Un archivo por interfaz. Centralizadas y separadas por categoria:
  `interfaces/services/`, `interfaces/repositories/`, `interfaces/external/`.
- Permiten mockear en tests y cambiar implementaciones sin tocar servicios.

## Estructura de carpetas

```
app/                            # Rutas y paginas (App Router)
  api/                          # Route handlers (controladores)
  (marketing)/                  # Paginas publicas
  (dashboard)/                  # Paginas autenticadas
lib/
  interfaces/                   # Contratos centralizados
    services/                   # IService.ts
    repositories/               # IRepository.ts
    external/                   # IEmailProvider.ts, IMetaAdsClient.ts...
  services/                     # Logica de negocio
  repositories/                 # Acceso a datos (Prisma)
  actions/                      # Server Actions ('use server')
  supabase/                     # Cliente y helpers de Supabase
  types/                        # Tipos de dominio + schemas zod
  utils/                        # Helpers puros (sin side effects)
components/
  ui/                           # Primitivas shadcn/ui (Button, Input, Card...)
  shared/                       # Compuestos reutilizables (DataTable, FormField...)
  private/                      # Componentes con datos sensibles (datos via props)
hooks/                          # React hooks reutilizables
providers/                      # Context providers
db/
  schema.prisma                 # Esquema de Prisma
  migrations/                   # Migraciones versionadas, cada una con:
    20250101000000_init/
      migration.sql             # UP
      down.sql                  # DOWN (OBLIGATORIO)
tests/
  unit/                         # Services y repositories (mockeando DB)
  integration/                  # Controllers + DB de test
e2e/                            # Playwright (flujos criticos)
scripts/
  db-rollback.ts                # Script de rollback (aplica down.sql)
```

## Permisos y autenticacion
- Las paginas (Server Components) validan permisos via `cookies()` de `next/headers`.
- `middleware.ts` intercepta rutas protegidas, verifica existencia de cookie de sesion.
- Componentes `private/` reciben datos por props desde el Server Component padre.
- Datos publicos: el cliente fetchea con SWR desde el navegador.
- Datos privados (balances, PII): pre-fetch en Server Component, stream al cliente.

## Server Actions vs Route Handlers
| Caso | Usar |
| --- | --- |
| Mutacion desde un componente propio | Server Action (`lib/actions/`) |
| Webhook externo (Shopify, Meta) | Route Handler (`app/api/`) |
| API publica para terceros | Route Handler (`app/api/`) |
| Cron interno | Route Handler (`app/api/`) |

## Migraciones up/down
Cada migracion de Prisma tiene estructura:
```
db/migrations/<timestamp>_<nombre>/
  migration.sql    ← UP: generado por `pnpm run db:migrate:create`
  down.sql         ← DOWN: manual, revierte migration.sql
```

Proceso:
1. `pnpm run db:migrate:create` → solo crea migration.sql, no aplica.
2. Escribir `down.sql` manualmente (revertir exactamente lo que migration.sql hace).
3. `pnpm run db:migrate` → aplica la migracion.
4. `pnpm run db:rollback` → ejecuta `scripts/db-rollback.ts` (aplica down.sql de la ultima y resuelve).

## Componentes
- `components/ui/`: primitivas de shadcn/ui. **Nunca crees un componente si ya existe en shadcn/ui.**
  Agregas con: `npx shadcn add <component>`.
- `components/shared/`: compuestos construidos con primitivas ui/. Reutilizables entre features.
- `components/private/`: contienen datos sensibles. El padre (Server Component) valida permisos y
  pasa datos por props. No fetchean datos por si mismos.

### Regla: sin sobre-ingenieria
Si un componente se usa en UN SOLO lugar y no tiene logica reutilizable, vive junto
a la pagina que lo usa. Solo se promueve a `shared/` cuando al menos DOS features
lo necesitan con la misma API.

## Anti-patrones que el reviewer rechaza
- Logica de negocio dentro de componentes o handlers de ruta.
- Queries sin indice en rutas calientes o crons frecuentes.
- Tablas nuevas sin RLS.
- Un webhook sin validacion de firma o sin idempotencia.
- Cualquier `console.log` de secretos o PII.
- Migracion nueva sin `down.sql`.
- Server component fetcheando datos publicos del cliente (usa SWR en el cliente).
- Componente privado haciendo fetch de datos sensibles (recibe por props).
