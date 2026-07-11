# Feature 27 — Fulfillment de tienda + estado inicial condicional · tasks.md

Orden: **backend primero, luego frontend**. `[P]` = paralelizable con tareas del mismo
bloque. Cada task tiene criterio de "hecho". Un commit por task lógica
(`feat(27-fulfillment): ...`).

> Pre-requisito: la puerta de aprobación humana (P1/P2/P3 de `design.md`) debe estar
> cerrada antes de escribir código.

---

## Bloque A — Modelo de datos (backend)

- [x] **T1** — Agregar `fulfillment Boolean @default(false)` al modelo `Usuario` en
  `db/schema.prisma`.
  - Hecho: `prisma validate`/`prisma format` pasa; el campo aparece en el schema.
  - Requisitos: R1, R3.

- [x] **T2** — Crear la migración con `db:migrate:create` y escribir su `down.sql`
  manual en `db/migrations/<timestamp>_usuario_fulfillment/`.
  - `migration.sql`: `ALTER TABLE "usuario" ADD COLUMN "fulfillment" BOOLEAN NOT NULL DEFAULT false;`
  - `down.sql`: `ALTER TABLE "usuario" DROP COLUMN "fulfillment";`
  - Hecho: `db:migrate` aplica sin error; `db:rollback` revierte con el `down.sql`;
    re-aplicar deja el esquema estable.
  - Requisitos: R2. Depende de T1.

---

## Bloque B — Backend de usuarios (feature 25)

- [x] **T3 [P]** — `lib/types/usuario.ts`: agregar `fulfillment: z.boolean().optional()`
  a `baseCrearFields` (entra en ambas ramas de `crearUsuarioSchema`) y
  `fulfillment: z.boolean()` a `actualizarUsuarioSchema`.
  - Hecho: unit test valida que crear/actualizar aceptan `fulfillment` booleano y
    rechazan no-booleano; `.strict()` sigue rechazando email/cedula/password.
  - Requisitos: R10, R13. Depende de T1.

- [x] **T4 [P]** — `lib/interfaces/repositories/IUserRepository.ts`: agregar
  `fulfillment: boolean` a `UsuarioPublico`, `fulfillment?: boolean` a
  `CreateUsuarioInput` y `UpdateUsuarioData`; e implementar en `UserRepository`
  (selects incluyen la columna; `create` mapea `?? false`).
  - Hecho: unit repo — `create` sin flag persiste `false`, con `true` persiste `true`;
    `UsuarioPublico` expone `fulfillment` y nunca `passwordHash`.
  - Requisitos: R3, R8, R9, R14. Depende de T1.

- [x] **T5** — `lib/services/UsuarioService.ts`: calcular `fulfillmentEfectivo` según el
  rol (`rolValue === "adminTienda" ? (input.fulfillment ?? false) : false`, invariante
  R4a) y propagarlo en `crear` y en `buildUpdateData` (recalculando con el rol resultante
  en edición).
  - Hecho: unit service — crear `adminTienda` con `true`/`false` persiste correcto;
    crear/editar rol ≠ `adminTienda` con `true` recibido → persiste `false`; editar
    cambia solo `fulfillment`.
  - Requisitos: R4a, R8, R9, R12. Depende de T3, T4.

---

## Bloque C — Carga masiva condicional (feature 15)

- [x] **T6 [P]** — `lib/config/ordenes.ts`: agregar `FULFILLMENT_ESTATUS_VALUE`
  (env `ORDENES_FULFILLMENT_ESTATUS_VALUE`, default `"en_fulfillment"`).
  - Hecho: unit config lee default y override por env.
  - Requisitos: R16, R23. Depende de nada (independiente de T1).

- [x] **T7 [P]** — `IOrdenRepository` + `OrdenRepository`: agregar
  `findUsuarioFulfillment(usuarioId: string): Promise<boolean>` (default `false` si no
  resuelve).
  - Hecho: unit repo — devuelve el flag de la tienda; `false` si no existe.
  - Requisitos: R15, R16, R17. Depende de T1.

- [x] **T8** — `lib/services/BulkOrdenService.ts`: resolver `estatusInicialValue` una
  vez por lote a partir de `findUsuarioFulfillment(tiendaId)`; pasarlo a `precargar()`
  para `findEstatusIdByValue`; reemplazar los usos de `DEFAULT_ESTATUS_VALUE` en el
  reporte de fila creada y en `seen.set(...)`; generalizar la guarda defensiva.
  - Hecho: unit `BulkOrdenService` —
    - tienda `fulfillment=true` → órdenes en `en_fulfillment` (R16);
    - tienda `fulfillment=false` → órdenes en `en_preparacion` (R17);
    - una sola llamada a `findUsuarioFulfillment` por lote (R18);
    - `BulkSummary` reporta el estatus resuelto por fila creada (R19);
    - estatus inexistente → 0 creadas con error de estatus (R20);
    - dedup/geo/mensajero/batch sin cambios (R21).
  - Requisitos: R15–R21. Depende de T6, T7.

---

## Bloque D — Frontend (UI de usuarios)

- [x] **T9** — `components/ui/switch`: asegurar la primitiva shadcn/ui
  (`npx shadcn add switch` si no existe).
  - Hecho: el componente `Switch` está disponible e importable.
  - Requisitos: soporte de R5. Independiente.

- [x] **T10** — `app/(app)/configuracion/_components/UsuarioForm.tsx`:
  - agregar `fulfillment: boolean` a `FormState` (init `usuario?.fulfillment ?? false`);
  - derivar `esAdminTienda` desde `form.rolId` vía el catálogo `roles` (`RolItem.value`);
  - renderizar el `Switch` "Esta tienda tiene fulfillment" solo si `esAdminTienda`;
  - incluir `fulfillment` en el candidato de `validate()` solo si `esAdminTienda` (crear)
    y en el objeto de actualización (editar); prefill en editar.
  - Hecho: component tests —
    - rol `adminTienda` → switch visible e inicia en `false` (R5, R7);
    - rol ≠ `adminTienda` → switch oculto y no envía `fulfillment` (R6);
    - editar `adminTienda` prefilla el valor actual (R11).
  - Requisitos: R5, R6, R7, R11, R12. Depende de T5, T9.

---

## Bloque E — No-regresión y cierre

- [x] **T11** — Actualizar mocks/tests existentes que implementan `IOrdenRepository`
  (`tests/unit/services/bulk-orden-service.test.ts`) e `IUserRepository`
  (`tests/unit/services/usuario-service.test.ts`, `tests/unit/actions/usuarios.test.ts`)
  con los nuevos métodos/campos; test de no-regresión en
  `tests/integration/api/ordenes-carga-masiva.route.test.ts`.
  - Hecho: suite completa verde; carga de tienda sin fulfillment sigue en `en_preparacion`.
  - Requisitos: R21, R22. Depende de T8, T10.

- [x] **T12** — Completar la tabla de trazabilidad `R1..R24 → test` en
  `progress/impl_27-fulfillment-tienda.md` y correr `./init.sh` + suite.
  - Hecho: `./init.sh` verde; todos los `R` mapeados a un test concreto (R24).
  - Requisitos: R24. Depende de todo lo anterior.

---

### Grafo de dependencias (resumen)
```
T1 ──► T2
T1 ──► T3, T4, T7        (B/C en paralelo)
T3, T4 ──► T5
T6, T7 ──► T8
T5, T9 ──► T10
T8, T10 ──► T11 ──► T12
```
