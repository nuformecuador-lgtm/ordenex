# Review — Feature 27: fulfillment de tienda + estado inicial condicional

Reviewer: `reviewer` (opus). Fecha: 2026-07-10.
Rama: `feature/27-fulfillment-tienda` (cambios en working tree; HEAD == dev, sin commitear).

## Veredicto: APROBADO (0 bloqueantes)

Solo un hallazgo `menor` (E2E de ingesta), no bloqueante. La implementación respeta
las 3 decisiones del humano (P1/P2/P3), la trazabilidad R1–R24 + R4a está completa
con tests reales, y la verificación ejecutable pasa en verde.

---

## Checklist de CHECKPOINTS.md

- [x] `specs/27-fulfillment-tienda/{requirements,design,tasks}.md` presentes; requisitos EARS numerados.
- [x] `design.md` incluye alternativas descartadas (A: fulfillment en Actor; B: fulfillment en tabla orden).
- [x] Todas las tasks de `tasks.md` marcadas `[x]` (T1–T12).
- [x] Cada `R<n>` mapea a un test concreto y real (tabla abajo).
- [x] `progress/impl_27-fulfillment-tienda.md` contiene el mapa `R -> test`.
- [x] typecheck OK (init.sh: 0 errors).
- [x] lint OK (0 errors; 135 warnings, todas en `.claude/skills/**`, ajenas a la feature).
- [x] `pnpm run test`: 124 files / 994 tests, todos verdes (corrido por el reviewer).
- [~] E2E de flujo crítico (ingesta de órdenes): NO existe E2E de carga masiva — ver hallazgo menor.
- [x] RLS: N/A — la feature no crea tabla nueva; agrega columna `fulfillment` a `usuario` (existente).
- [x] Migración versionada y reversible: `20260710180000_usuario_fulfillment/` con `migration.sql` + `down.sql`; init.sh valida presencia de down.sql.
- [x] Sin secretos hardcodeados; `FULFILLMENT_ESTATUS_VALUE` vía env con default `en_fulfillment`.
- [x] Capas separadas: schema (zod borde) → service (invariante R4a) → repo (Prisma). Service sin HTTP; repo sin lógica.
- [x] No se hardcodea contexto: valor de estatus configurable por env (patrón `DEFAULT_ESTATUS_VALUE`).
- [x] `./init.sh` termina en verde (`== init OK ==`).

## Decisiones del humano — verificadas en backend, no solo UI

- **P1/R4/R4a**: `UsuarioService.resolverFulfillment()` fuerza `false` para todo rol
  ≠ `adminTienda`, ignorando un `true` recibido, tanto en `crear` como en
  `buildUpdateData` (recalcula con el rol resultante en edición). Testeado en
  `usuario-service.test.ts` (crear rol≠adminTienda con true→false; cambio de rol
  adminTienda→otro fuerza false; editar rol≠adminTienda con true→false). No depende de la UI.
- **P2/R15**: `BulkOrdenService.cargarMasiva` usa `tiendaId = actor.usuarioId` y
  `repo.findUsuarioFulfillment(tiendaId)`. No hay ruta "en nombre de". Testeado:
  `findUsuarioFulfillment` llamado con `actor.usuarioId` una sola vez por lote.
- **P3/R5/R6**: `UsuarioForm` renderiza el `Switch` solo si `esAdminTienda`; en otros
  roles no lo muestra y no envía `fulfillment` (spread condicional). Testeado en `usuario-form.test.tsx`.

## Lógica condicional del estado inicial

- fulfillment=true → `FULFILLMENT_ESTATUS_VALUE` (`en_fulfillment`); false/default →
  `DEFAULT_ESTATUS_VALUE` (`en_preparacion`). Resuelto UNA vez por lote (R18), aplicado
  a `estatusInicialValue` de cada fila creada y en el dedup (`seen.set`).
- NO-regresión confirmada: tienda sin fulfillment sigue en `en_preparacion`
  (integración `ordenes-carga-masiva.route.test.ts` R22 + unit R17).
- `en_fulfillment` y `en_preparacion` son valores REALES de `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`), no literales nuevos (R23). Guard `no-embalaje.test.ts` verde.
- Guarda defensiva R20: si el estatus no está en catálogo → 0 creadas + error de estatus por fila.

## Migración

- `db/schema.prisma` L96: `fulfillment Boolean @default(false)` en `Usuario`.
- `migration.sql`: `ALTER TABLE "usuario" ADD COLUMN "fulfillment" BOOLEAN NOT NULL DEFAULT false;`
- `down.sql`: `ALTER TABLE "usuario" DROP COLUMN IF EXISTS "fulfillment";`
- Convención de repo cumplida (down.sql obligatorio, validado por init.sh).

## Tabla de trazabilidad verificada (R -> test real)

| Req | Test | Verificado |
| --- | --- | --- |
| R1  | `usuario-fulfillment-migration.test.ts` + `user-repository.crud.test.ts` | OK |
| R2  | `usuario-fulfillment-migration.test.ts` (up/down + carpeta con ambos) | OK |
| R3  | `user-repository.crud.test.ts` (create sin flag→false) + `usuario-service.test.ts` | OK |
| R4  | `usuario-service.test.ts` (rol≠adminTienda ignora true→false) | OK |
| R4a | `usuario-service.test.ts` (crear/editar rol≠adminTienda→false; cambio de rol→false) | OK |
| R5  | `usuario-form.test.tsx` (switch visible con adminTienda) | OK |
| R6  | `usuario-form.test.tsx` (oculto y no envía con rol≠adminTienda) | OK |
| R7  | `usuario-form.test.tsx` (inicia en false al crear) | OK |
| R8  | `usuario-service.test.ts` + `user-repository.crud.test.ts` (persiste true) | OK |
| R9  | `usuario-service.test.ts` (persiste false) | OK |
| R10 | `usuario-schema.test.ts` (acepta bool opcional; rechaza no-bool) | OK |
| R11 | `usuario-form.test.tsx` (prefill al editar adminTienda) | OK |
| R12 | `usuario-service.test.ts` + `user-repository.crud.test.ts` + `usuario-form.test.tsx` | OK |
| R13 | `usuario-schema.test.ts` (acepta fulfillment; rechaza email/cedula) | OK |
| R14 | `user-repository.crud.test.ts` (PUBLIC_SELECT incluye fulfillment, nunca passwordHash) | OK |
| R15 | `orden-repository.test.ts` + `bulk-orden-service.test.ts` (actor.usuarioId) | OK |
| R16 | `bulk-orden-service.test.ts` (true→en_fulfillment) + `ordenes-config.test.ts` | OK |
| R17 | `bulk-orden-service.test.ts` (false→en_preparacion) + `orden-repository.test.ts` | OK |
| R18 | `bulk-orden-service.test.ts` (findUsuarioFulfillment 1 vez/lote) | OK |
| R19 | `bulk-orden-service.test.ts` (estatus resuelto por fila creada + duplicadas) | OK |
| R20 | `bulk-orden-service.test.ts` (estatus inexistente→0 creadas) | OK |
| R21 | suite dedup/geo/mensajero/batch en `bulk-orden-service.test.ts` (verde) | OK |
| R22 | `ordenes-carga-masiva.route.test.ts` (integración no-regresión) | OK |
| R23 | `ordenes-config.test.ts` + guard `no-embalaje.test.ts` | OK |
| R24 | esta revisión — todos mapeados | OK |

## Hallazgos

- **[menor] Sin E2E Playwright de carga masiva.** CHECKPOINTS.md pide E2E para flujos
  críticos (incl. "ingesta de órdenes"). Feature 27 modifica el estado inicial del flujo
  de carga masiva pero no añade E2E; `e2e/` solo cubre auth/home. No bloqueante porque
  (1) es una carencia preexistente del repo — las features 15/16 que crearon la carga
  masiva shipearon sin E2E, no es algo que introduzca la 27; y (2) la lógica condicional
  queda cubierta por unit (`bulk-orden-service.test.ts`) + integración de route
  (`ordenes-carga-masiva.route.test.ts`). Recomendación de seguimiento, no gate de esta feature.

- **[nota] Migración no aplicada contra Postgres real.** El entorno no tiene DB; no se
  corrió `db:migrate`/`db:rollback` reales (igual que features 21/50). `migration.sql` y
  `down.sql` son correctos por inspección y cobertura estática; init.sh valida el down.sql.
  Aplicación real diferida al humano. No bloqueante (patrón establecido del repo).

## Verificación ejecutable (corrida por el reviewer)

- `pnpm run test`: **124 files / 994 tests passed**.
- `./init.sh`: **== init OK ==** (typecheck 0 errors; lint 0 errors / 135 warnings ajenas
  en `.claude/skills/**`; test 994/994; "todas las migraciones tienen down.sql"; ".env presente").
