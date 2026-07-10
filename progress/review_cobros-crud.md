# Review — feature `cobros-crud` (id 18)

Reviewer del arnés SDD. Rama `feature/18-cobros-crud`. NO se editó código.

## Veredicto: APROBADO

0 hallazgos bloqueantes. Feature lista para pasar a `done`.

## Verificación ejecutable (corrida por el reviewer)

`./init.sh` → verde:

```
-> pnpm run typecheck   (sin errores)
-> pnpm run lint        (sin errores)
-> pnpm run test
 Test Files  73 passed (73)
      Tests  660 passed (660)
   Duration  19.97s
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Baseline en `dev`: 67 archivos / 572 tests. Ahora: **73 / 660** (+6 archivos /
+88 tests nuevos, todos de `cobros`). No bajó del baseline; nada existente se
rompió. Conteo de `it(` en los 6 archivos nuevos = 88 (coincide con la bitácora).

## Decisiones humanas cerradas (D1–D5) — verificadas

- **Tipos de columna (D2/D3):** en `db/schema.prisma` (modelo `Cobro`) y
  `db/migrations/20260710120000_cobros/migration.sql`:
  - Montos `DECIMAL(12,2)`: `valor_flete`, `valor_flete_devuelto`,
    `valor_flete_gam`, `valor_flete_devuelto_gam`, `fulfillment`. OK.
  - Porcentajes `DECIMAL(5,2)`: `comision_cod`, `iva_flete`, `iva_comision_cod`.
    OK (ninguno quedó 12,2 ni fracción 5,4).
  - `nombre TEXT NOT NULL`; `id` uuid TEXT PK; `created_at`/`updated_at` NOT NULL;
    `deleted_at TIMESTAMP(3)` nullable. OK. `@map` snake_case con GAM→gam. OK.
  - Las 9 columnas (nombre + 8 numéricas) NOT NULL; sin índice único en `nombre`
    (coherente con design.md); sin FKs. OK.
- **Validación zod (D5):** `crearCobroSchema` exige `nombre.min(1)` + 8 numéricas;
  montos `nonnegative`; 3 porcentajes `min(0).max(100)`; `.strict()`.
  `actualizarCobroSchema = partial().strict()`. Tests rechazan negativos,
  porcentaje >100 y `nombre` ausente/vacío. OK.
- **Autorización (D4):** `WRITE_ROLES={maestro}`, `READ_ROLES={maestro,admin}` en
  `CobroService`; sin sesión → `unauthenticated` (antes de tocar el service);
  `adminTienda`/`mensajero` y rol no reconocido → `forbidden`. Tests por cada
  caso, en service y en action. OK.
- **Migración (R6):** `migration.sql` + `down.sql` (`DROP TABLE IF EXISTS
  "cobro";`, no toca otras tablas); `ENABLE ROW LEVEL SECURITY` sin policies;
  init.sh valida presencia de down.sql. OK.
- **Contrato (R26/R27):** result types discriminados; `toDTO` serializa Decimal→
  number y NO expone `deleted_at`; borrado lógico excluye de find/list;
  listado `{items,page,pageSize,total}` con cap `MAX_PAGE_SIZE`. OK.

## Checklist CHECKPOINTS.md

- [x] requirements.md EARS numerado (R1..R27) + D1–D5.
- [x] design.md con alternativas descartadas (4) y su porqué.
- [x] tasks.md: T001–T012 todas `[x]`.
- [x] Cada R<n> mapea a >=1 test concreto (tabla abajo). impl tiene el mapa.
- [x] typecheck / lint / test verdes.
- [x] E2E: no aplica — feature backend pura (config de tarifas), sin UI ni flujo
      runtime de auth/pagos/ingesta/webhooks. No dispara la puerta E2E.
- [x] RLS activado en tabla nueva `cobro`.
- [x] Migración reversible: down.sql presente. `db:rollback` real DIFERIDO (sin
      Postgres en el entorno) — deuda esperada, mismo patrón que features 6/15.
- [x] Sin secretos hardcodeados; cotas de página vía env (`lib/config/cobros.ts`).
- [x] Webhooks: N/A.
- [x] Capas: Action (borde) → Service (autorización/dominio) → Repository (solo
      Prisma) → tipos/zod. Service no conoce HTTP; Repository sin lógica de
      negocio; interfaces en `lib/interfaces/`. Reutiliza `withErrorHandler`,
      `toActionError`, `resolveActorFromSession` sin reimplementar.
- [x] Multi-país: N/A, sin hardcode.
- [x] init.sh verde.

## Patrón por capas / calidad

- TypeScript strict, sin `any` injustificado (solo casts de test `as unknown as
  PrismaClient`, aceptable). Sin `catch` vacíos.
- Adaptador local `toCobroActionError` angosta el superset `ActionError` de
  `to-action-error.ts` (que incluye `conflict`) al `ActionError` de cobros sin
  `conflict`: re-lanza si apareciera `conflict` (nunca ocurre en el dominio).
  Plomería de tipos correcta, no reimplementa el manejador común. OK.
- Diff acotado: `db/schema.prisma`, migración, `lib/**` (cobro*), tests, spec y
  progress. `feature_list.json` (feat 18 → in_progress, y cambios preexistentes
  de feat 16/17 ya en el working tree) es estado del arnés, no código de otras
  features. No se tocó UI/app/ ni el CRUD de `orden`. OK.

## Trazabilidad R1..R27 → test

| R | Test que lo ejerce |
|---|---|
| R1 | cobros-rls.test.ts::migracion de cobro: columnas, tipos y NOT NULL |
| R2 | cobros-rls.test.ts::5 columnas de monto DECIMAL(12,2) + cobro-schemas::rechaza monto negativo + cobro-repository::create convierte a Decimal |
| R3 | cobros-rls.test.ts::3 columnas de porcentaje DECIMAL(5,2) + cobro-schemas::rechaza porcentaje >100 / negativo / acepta 100 |
| R4 | schema.prisma @map + cobros-rls.test.ts (valor_flete_gam / valor_flete_devuelto_gam) |
| R5 | cobro-schemas::rechaza nombre vacio/ausente, numerica ausente, negativo, porcentaje fuera de rango |
| R6 | cobros-rls.test.ts::down.sql revierte solo la tabla cobro |
| R7 | cobros-rls.test.ts::RLS habilitado en cobro (anon real DIFERIDO, patrón ordenes) |
| R8 | cobros-action.test.ts::R8 sin sesion -> unauthenticated (las 5 acciones) |
| R9 | cobro-service.test.ts (matriz) + cobros-action.test.ts::id en fieldErrors |
| R10 | cobro-service.test.ts::maestro crea/obtiene/lista/actualiza/borra |
| R11 | cobro-service.test.ts::admin forbidden en escritura, ok en lectura + action |
| R12 | cobro-service.test.ts::adminTienda/mensajero forbidden + action |
| R13 | cobro-service.test.ts::rol no reconocido -> forbidden (5 ops) |
| R14 | cobro-schemas.test.ts::acepta input valido + action no llama service si invalido |
| R15 | cobro-schemas + cobros-action::validation_error con fieldErrors |
| R16 | cobro-service::crear valido devuelve DTO + cobros-action::ok con CobroDTO |
| R17 | cobro-service::obtener inexistente/borrado -> not_found + action |
| R18 | cobros-config + cobro-schemas::listar cap + cobro-repository::list skip/take + service + action |
| R19 | cobro-repository::findById/list filtran deletedAt null + service + action |
| R20 | cobro-schemas::actualizar todos opcionales strict |
| R21 | cobro-service::actualizar not_found + cobro-repository::update null + action |
| R22 | cobro-service::aplica solo campos presentes, no toca id/created_at |
| R23 | cobro-schemas::actualizar rechaza negativo/porcentaje/nombre + action strict |
| R24 | cobro-repository::softDelete + cobro-service::borrar + action |
| R25 | cobro-service::borrar inexistente/ya borrado -> not_found + repository false |
| R26 | cobros-action::Object.keys exacto + INTERNAL re-lanza |
| R27 | cobro-repository::create/list Decimal->number sin deletedAt + cobro-schemas DTO + action |

Todos los R tienen test que ejerce el comportamiento (ninguno vacío/falso).

## Hallazgos

- (menor) `db:rollback` real contra Postgres y test RLS con key `anon` quedan
  DIFERIDOS por ausencia de DB en el entorno. Es la deuda esperada y documentada
  (patrón features 6/15), cubierta estáticamente por cobros-rls.test.ts. No
  bloquea.

Sin hallazgos bloqueantes.
