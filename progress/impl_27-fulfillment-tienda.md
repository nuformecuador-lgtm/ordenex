# Bitácora de implementación — Feature 27: fulfillment de tienda + estado inicial condicional

Rama: `feature/27-fulfillment-tienda` (desde `origin/dev`, al día).
Fecha: 2026-07-10. Coordinado por `implementer` (backend_dev + frontend_dev, modelo opus).
Estado: implementación completa, suite verde, `./init.sh` OK. Pendiente de revisión por `reviewer`.

Decisiones humanas respetadas: P1 (fulfillment=true solo para rol `adminTienda`, forzado en backend/R4a),
P2 (la tienda que carga es siempre el `adminTienda` autenticado = `actor.usuarioId`/R15),
P3 (switch visible solo si rol seleccionado = `adminTienda`/R5-R6).

---

## Archivos creados/modificados

### Backend — modelo de datos (T1/T2)
- `db/schema.prisma` — campo `fulfillment Boolean @default(false)` en `Usuario`
- `db/migrations/20260710180000_usuario_fulfillment/migration.sql` (UP, nuevo)
- `db/migrations/20260710180000_usuario_fulfillment/down.sql` (DOWN, nuevo — convención obligatoria, validada por `./init.sh`)

### Backend — usuarios (T3/T4/T5)
- `lib/types/usuario.ts`
- `lib/interfaces/repositories/IUserRepository.ts`
- `lib/repositories/UserRepository.ts`
- `lib/services/UsuarioService.ts` (invariante de rol R4a: `fulfillmentEfectivo`)

### Backend — carga masiva (T6/T7/T8)
- `lib/config/ordenes.ts` (`FULFILLMENT_ESTATUS_VALUE`, env `ORDENES_FULFILLMENT_ESTATUS_VALUE`, default `en_fulfillment`)
- `lib/interfaces/repositories/IOrdenRepository.ts` (`findUsuarioFulfillment`)
- `lib/repositories/OrdenRepository.ts`
- `lib/services/BulkOrdenService.ts` (resolución de `estatusInicialValue` una vez por lote)

### Frontend (T9/T10)
- `components/ui/switch.tsx` (nuevo; primitiva sobre `@base-ui/react/switch`, coherente con el resto de `components/ui/`; el repo usa Base UI, no Radix)
- `app/(app)/configuracion/_components/UsuarioForm.tsx` (Switch condicional por `esAdminTienda`)
- `UsuariosModule.tsx`: sin cambios (ya pasa `usuario` al form; verificado)

### Tests creados/modificados (T11 + trazabilidad)
- `tests/integration/db/usuario-fulfillment-migration.test.ts` (nuevo)
- `tests/unit/types/usuario-schema.test.ts`
- `tests/unit/config/ordenes-config.test.ts`
- `tests/unit/repositories/user-repository.crud.test.ts`
- `tests/unit/repositories/orden-repository.test.ts`
- `tests/unit/services/usuario-service.test.ts`
- `tests/unit/services/bulk-orden-service.test.ts`
- `tests/integration/api/ordenes-carga-masiva.route.test.ts`
- `tests/unit/components/usuario-form.test.tsx` (5 tests de fulfillment)
- Mocks actualizados (no-regresión): `tests/unit/actions/usuarios.test.ts`, `tests/unit/services/auth-service.test.ts`,
  `tests/unit/services/postulacion-login-regresion.test.ts`, `tests/unit/services/asignacion-mensajero-service.test.ts`,
  `tests/unit/services/orden-service.test.ts`, `tests/unit/services/rol-admin-satelite-authz.test.ts`,
  `tests/unit/components/usuarios-module.test.tsx`
- Guards de migración ajustados por el nuevo timestamp (patrón append-only del repo):
  `tests/integration/db/vehiculos-migration.test.ts`, `tests/integration/db/postulacion-mensajero-migration.test.ts`,
  `tests/unit/guards/no-embalaje.test.ts`

---

## Mapa de trazabilidad R -> test

| Req | Test que lo cubre |
| --- | --- |
| R1  | `usuario-fulfillment-migration.test.ts` :: "agrega usuario.fulfillment BOOLEAN NOT NULL DEFAULT false" + `user-repository.crud.test.ts` :: "create con fulfillment true lo persiste" |
| R2  | `usuario-fulfillment-migration.test.ts` :: "dropea la columna fulfillment" + "la carpeta contiene tanto migration.sql como down.sql" |
| R3  | `user-repository.crud.test.ts` :: "create sin fulfillment persiste false (R3)" + `usuario-service.test.ts` :: "crear adminTienda sin fulfillment persiste false" |
| R4  | `usuario-service.test.ts` :: "crear rol != adminTienda ignora fulfillment=true recibido -> false" |
| R4a | `usuario-service.test.ts` :: "crear rol != adminTienda ignora...", "editar cambiando rol de adminTienda a otro fuerza fulfillment=false", "editar rol != adminTienda con fulfillment=true recibido -> false" |
| R5  | `usuario-form.test.tsx` :: "muestra el switch de fulfillment al seleccionar rol adminTienda en crear (R5)" |
| R6  | `usuario-form.test.tsx` :: "oculta el switch y no envía fulfillment con rol != adminTienda (R6)" |
| R7  | `usuario-form.test.tsx` :: "el switch inicia en false al elegir adminTienda en crear (R7)" |
| R8  | `usuario-service.test.ts` :: "crear adminTienda con fulfillment=true persiste true" + `user-repository.crud.test.ts` :: "create con fulfillment true lo persiste (R8)" |
| R9  | `usuario-service.test.ts` :: "crear adminTienda con fulfillment=false persiste false" |
| R10 | `usuario-schema.test.ts` :: "R10: acepta fulfillment booleano (opcional)..." + "R10: rechaza fulfillment no booleano" |
| R11 | `usuario-form.test.tsx` :: "prefilla el switch con el valor actual al editar adminTienda (R11)" |
| R12 | `usuario-service.test.ts` :: "editar adminTienda cambia solo fulfillment" + `user-repository.crud.test.ts` :: "update aplica fulfillment como campo editable" + `usuario-form.test.tsx` :: "propaga el nuevo valor del switch al submit en editar (R12)" |
| R13 | `usuario-schema.test.ts` :: "R13: acepta fulfillment booleano y sigue rechazando email/cedula" |
| R14 | `user-repository.crud.test.ts` :: "PUBLIC_SELECT incluye fulfillment y nunca passwordHash" |
| R15 | `orden-repository.test.ts` :: "devuelve el flag fulfillment de la tienda que carga" + `bulk-orden-service.test.ts` :: "R15/R18: lee fulfillment de la tienda del actor UNA vez por lote" |
| R16 | `bulk-orden-service.test.ts` :: "R16: tienda con fulfillment=true -> ordenes en_fulfillment" + `ordenes-config.test.ts` :: "FULFILLMENT_ESTATUS_VALUE" |
| R17 | `bulk-orden-service.test.ts` :: "R17: tienda con fulfillment=false -> ordenes en_preparacion" + `orden-repository.test.ts` :: "devuelve false cuando el flag es false" |
| R18 | `bulk-orden-service.test.ts` :: "R15/R18: ... UNA vez por lote" |
| R19 | `bulk-orden-service.test.ts` :: "R16..." (filas.estatus) + "R19: el estatus resuelto se reporta tambien en duplicadas intra-archivo" |
| R20 | `bulk-orden-service.test.ts` :: "R20: estatus en_fulfillment inexistente -> 0 creadas, error de estatus por fila" |
| R21 | suite existente de dedup/geo/mensajero/batch en `bulk-orden-service.test.ts` (verde, sin cambios de comportamiento) |
| R22 | `ordenes-carga-masiva.route.test.ts` :: "R22 (feature 27): tienda sin fulfillment -> ordenes en_preparacion" |
| R23 | `ordenes-config.test.ts` :: reutiliza `en_fulfillment` sin valor nuevo + guard `no-embalaje.test.ts` |
| R24 | esta tabla — todos los R1..R23 (incl. R4a) mapeados a test concreto |

---

## Salida real de verificación

### pnpm run test (suite completa)
```
 Test Files  124 passed (124)
      Tests  994 passed (994)
   Duration  40.93s
```

### ./init.sh
```
X 135 problems (0 errors, 135 warnings)   # todas las warnings en .claude/skills/** (ajenas, preexistentes)
 Test Files  124 passed (124)
      Tests  994 passed (994)
OK todas las migraciones tienen down.sql
OK .env presente
== init OK ==
```

typecheck (`npx tsc --noEmit`): exit 0, cero errores.
lint: 0 errors (135 warnings, todas en `.claude/skills/**`, ajenas a la feature).

---

## Notas / bloqueos

- **Migración contra Postgres real:** en este entorno no hay DB; no se ejecutaron `db:migrate`/`db:rollback`
  reales. `migration.sql` + `down.sql` quedan correctos y con cobertura estática (mismo patrón que features 21/50).
  `./init.sh` valida la presencia del `down.sql`. La aplicación real queda diferida al humano.
- **Stack del Switch:** primitiva sobre `@base-ui/react/switch` (no Radix), porque todo `components/ui/` usa Base UI.
- Ningún R (R1–R24, incl. R4a) quedó sin test.
