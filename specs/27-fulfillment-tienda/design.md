# Feature 27 — Fulfillment de tienda + estado inicial condicional · design.md

Zone: fullstack · complexity: high · depends_on: 25 (y 28)

Cruza tres módulos ya existentes (`done`): modelo `Usuario` (features 1/21/25), UI de
gestión de usuarios (feature 25) y carga masiva (features 15/16). No hay tablas nuevas
ni estados nuevos; solo una columna nueva y una ramificación de lógica.

---

## 1. Modelo de datos

### 1.1 Campo `fulfillment` en `Usuario`

`db/schema.prisma`, modelo `Usuario`, agregar:

```prisma
fulfillment Boolean @default(false) // feature 27: tienda con fulfillment (rol adminTienda); default false
```

Decisiones:
- **Tipo:** `Boolean NOT NULL DEFAULT false`. Un booleano no nulo evita la tri-valencia
  (`true`/`false`/`null`) y hace que R17/R22 (rama por defecto) sean el estado natural
  para todos los usuarios preexistentes tras la migración.
- **Alcance:** columna genérica en `Usuario` (cualquier fila la tiene, default `false`),
  pero el backend fuerza que solo `adminTienda` pueda quedar en `true` (Decisión P1,
  R4a; ver §2.3).
- **RLS:** no aplica tabla nueva. `Usuario` ya está bajo el modelo de acceso existente
  (gestión restringida a `maestro`, feature 25; la carga masiva solo lee el flag de la
  propia tienda del actor). No se agrega política nueva en esta feature.

### 1.2 Migración + down.sql (R2)

Estructura (patrón `docs/architecture.md`, migraciones up/down):

```
db/migrations/<timestamp>_usuario_fulfillment/
  migration.sql   # UP
  down.sql        # DOWN (obligatorio)
```

- `migration.sql` (UP):
  ```sql
  ALTER TABLE "usuario" ADD COLUMN "fulfillment" BOOLEAN NOT NULL DEFAULT false;
  ```
- `down.sql` (DOWN):
  ```sql
  ALTER TABLE "usuario" DROP COLUMN "fulfillment";
  ```

Proceso del repo: `db:migrate:create` (genera migration.sql) → escribir `down.sql`
manual → `db:migrate` → verificar `db:rollback` (aplica `down.sql`). El `DEFAULT false`
cubre a todos los usuarios existentes sin backfill adicional.

---

## 2. Backend de usuarios (feature 25)

Toca cuatro capas ya existentes. Cambios mínimos, aditivos y opcionales para no
romper llamadas actuales.

### 2.1 Tipos / schemas — `lib/types/usuario.ts`
- `baseCrearFields`: agregar `fulfillment: z.boolean().optional()` (default lo pone el
  service/DB en `false`). Al vivir en `baseCrearFields`, entra en ambas ramas de la
  unión discriminada `crearUsuarioSchema` (manual/generate), conservando `.strict()`.
- `actualizarUsuarioSchema`: agregar `fulfillment: z.boolean()` al objeto `.partial().strict()`
  (R13). Sigue rechazando `email`/`cedula`/`password` por `.strict()`.

### 2.2 Repositorio — `lib/interfaces/repositories/IUserRepository.ts` + implementación
- `UsuarioPublico`: agregar `fulfillment: boolean` (R14). Nunca incluye `passwordHash`.
- `CreateUsuarioInput`: agregar `fulfillment?: boolean` (default `false` en el mapeo a
  Prisma si viene `undefined`).
- `UpdateUsuarioData`: agregar `fulfillment?: boolean`.
- Las proyecciones/`select` de `create`, `findById`, `update`, `setEstado` incluyen la
  nueva columna. El listado (`UsuarioListItem`) NO necesita el flag (no se pide en tabla).

### 2.3 Service — `lib/services/UsuarioService.ts`
- **Invariante de rol (R4a, Decisión P1):** el flag efectivo se calcula en el service,
  NO se confía en la UI. Para resolver el rol del usuario a partir de `rolId` (UUID), el
  service consulta el `value` del rol (vía repo: `listRoles()` ya expone `{ id, value }`,
  o un lookup puntual). Regla: `fulfillmentEfectivo = (rolValue === "adminTienda") ? (input.fulfillment ?? false) : false`.
  Un `true` recibido para cualquier otro rol se ignora y se persiste `false`.
- `crear`: propagar `fulfillmentEfectivo` al `repo.create(...)`.
- `actualizar` (`buildUpdateData`): recalcular `fulfillmentEfectivo` con el rol resultante
  (el `rolId` editado si viene, o el actual del usuario); incluirlo en `UpdateUsuarioData`
  cuando aplique. Si el rol cambia de `adminTienda` a otro, forzar `false`.
- Sin cambios de autorización (sigue `ALLOWED_ROLES = {maestro}`).

### 2.4 UI — `app/(app)/configuracion/_components/UsuarioForm.tsx`
- `FormState`: agregar `fulfillment: boolean` (init `usuario?.fulfillment ?? false`).
- Resolver el `rolValue` seleccionado a partir de `form.rolId` usando el catálogo
  `roles` (cada `RolItem` es `{ id, value }`): `esAdminTienda = roles.find(r => r.id === form.rolId)?.value === "adminTienda"`.
- Renderizar el interruptor solo cuando `esAdminTienda` (R5/R6, Decisión P3). Usar el componente
  `Switch` de shadcn/ui (`components/ui/switch`; si no existe, `npx shadcn add switch`),
  con `Label` "Esta tienda tiene fulfillment".
- En `validate()`: incluir `fulfillment: form.fulfillment` en el candidato SOLO si
  `esAdminTienda` (si no, se omite → R6). Modo editar: incluirlo en el objeto de
  `actualizarUsuarioSchema`.
- Prefill en editar (R11): `initialState` toma `usuario.fulfillment`.

`UsuariosModule.tsx` no necesita cambios estructurales (pasa `usuario` al form).

---

## 3. Carga masiva: estado inicial condicional (feature 15)

### 3.1 Identidad de la tienda que carga (R15)
`BulkOrdenService.cargarMasiva` YA fija `const tiendaId = actor.usuarioId;`
(la tienda que carga = el `adminTienda` autenticado, resuelto por
`resolveActorFromSession`). Ese mismo `usuarioId` es la clave para leer el flag
`fulfillment`. No hay campo de "tienda" en el archivo ni en el request: la tienda es el
actor. Decisión P2 (cerrada): la identidad de la tienda que carga es SIEMPRE el
`adminTienda` autenticado; no se soporta carga "en nombre de" otra tienda.

### 3.2 Resolución del estado inicial (R16–R20)
Hoy `precargar()` hace:
```ts
this.repo.findEstatusIdByValue(ordenesConfig.DEFAULT_ESTATUS_VALUE) // siempre "en_preparacion"
```
y el estatus reportado por fila creada usa `ordenesConfig.DEFAULT_ESTATUS_VALUE`
(líneas ~209, ~281 de `BulkOrdenService.ts`).

Cambio:
1. Nuevo método en `IOrdenRepository` (+ impl `OrdenRepository`):
   ```ts
   /** feature 27: lee usuario.fulfillment de la tienda que carga (R15/R16/R17). */
   findUsuarioFulfillment(usuarioId: string): Promise<boolean>;
   ```
   (query `usuario.findUnique({ where:{id}, select:{ fulfillment:true } })`, default
   `false` si no resuelve, coherente con R3).
2. Nueva constante de config en `lib/config/ordenes.ts`:
   `FULFILLMENT_ESTATUS_VALUE` (env `ORDENES_FULFILLMENT_ESTATUS_VALUE`, default
   `"en_fulfillment"`), hermana de `DEFAULT_ESTATUS_VALUE` ("en_preparacion"). Mantiene
   la regla "sin hardcode de contexto" del repo.
3. En `cargarMasiva`, tras conocer `tiendaId`, resolver:
   ```ts
   const fulfillment = await this.repo.findUsuarioFulfillment(tiendaId);
   const estatusInicialValue = fulfillment
     ? ordenesConfig.FULFILLMENT_ESTATUS_VALUE   // "en_fulfillment"
     : ordenesConfig.DEFAULT_ESTATUS_VALUE;      // "en_preparacion"
   ```
   Se pasa `estatusInicialValue` a `precargar()` para el `findEstatusIdByValue`, y se
   usa ese mismo valor en:
   - el reporte de fila creada (`estatus: estatusInicialValue`),
   - `seen.set(numRemision, estatusInicialValue)`,
   sustituyendo los usos directos de `ordenesConfig.DEFAULT_ESTATUS_VALUE`.
4. Guarda defensiva (R20): si `findEstatusIdByValue(estatusInicialValue)` devuelve
   `null`, se conserva la rama actual (`ctx.estatusId === null` → 0 creadas, error de
   estatus por fila). Se generaliza el mensaje para que valga para cualquiera de los dos
   valores.

**Una sola resolución por lote (R18):** `findUsuarioFulfillment` se llama una vez en
`cargarMasiva` (no por fila); `estatusInicialValue` se calcula una vez y se propaga.

### 3.3 Route handler
`app/api/ordenes/carga-masiva/route.ts` NO cambia: el actor ya se resuelve ahí y se
pasa al service; toda la lógica condicional vive en el service (capa correcta).

---

## 4. Impacto en tests existentes (no-regresión)
- `tests/unit/services/bulk-orden-service.test.ts`: los mocks de `IOrdenRepository`
  deben implementar `findUsuarioFulfillment` (retornar `false` por defecto para
  preservar los casos existentes de `en_preparacion`). Nuevos casos para R16/R17/R18/R19.
- `tests/unit/config/ordenes-config.test.ts`: caso para `FULFILLMENT_ESTATUS_VALUE`.
- `tests/unit/actions/usuarios.test.ts`, `usuario-service.test.ts`: casos de `fulfillment`
  en crear/editar; mocks de repo con el nuevo campo.
- `tests/integration/api/ordenes-carga-masiva.route.test.ts`: caso de no-regresión R22.

---

## 5. Alternativa descartada

**Alternativa A — Propagar `fulfillment` dentro del `Actor`.**
Extender `resolveActorFromSession` para que el `Actor` (`{ usuarioId, rol }`) incluya
`fulfillment`, leyéndolo junto al rol (ya hace `include: { rol: true }`), y que
`BulkOrdenService` lo consuma directo sin un método de repo nuevo.

Por qué se descarta:
- `Actor` es un tipo COMPARTIDO por `IOrdenService`, `ICobroService`, `IVehiculoService`,
  etc. Agregarle `fulfillment` acopla un detalle de una sola feature a todo el borde de
  autenticación y a servicios que no lo necesitan.
- Rompería/tocaría todos los sitios que construyen un `Actor` en tests (superficie de
  cambio mucho mayor) por un dato que solo usa la carga masiva.
- La lectura del flag es responsabilidad de datos → pertenece al Repository (separación
  de capas, `docs/architecture.md`), no al resolver de sesión.

La opción elegida (método `findUsuarioFulfillment` en `IOrdenRepository`) mantiene el
cambio localizado, testeable con mock y alineado al patrón Controller→Service→Repository.

**Alternativa B — Guardar `fulfillment` en la tabla `orden` por lote.** Descartada:
el flag es una propiedad de la TIENDA, no de la orden; duplicarlo en `orden` crea
inconsistencia si la tienda cambia su modalidad. La orden solo necesita nacer con el
estado ya resuelto.

---

## Decisiones del humano (2026-07-10)

Las tres preguntas de la puerta de aprobación quedaron cerradas. No hay pendientes.

- **P1 → Restringido por rol en backend.** La columna `fulfillment` existe genérica en
  `Usuario` (default `false`), pero el service fuerza la invariante R4a: solo un usuario
  con rol `adminTienda` puede quedar en `true`; para cualquier otro rol se persiste
  `false` aunque llegue `true`. Implementación en §2.3 (`fulfillmentEfectivo`).

- **P2 → `adminTienda` autenticado.** "La tienda que realiza la carga" es siempre el
  `adminTienda` autenticado (`actor.usuarioId`), y de ese usuario se lee `fulfillment`.
  No se soporta carga "en nombre de" otra tienda. Reflejado en §3.1 y R15.

- **P3 → Solo si rol = `adminTienda`.** El switch se renderiza en `UsuarioForm`
  únicamente cuando el rol seleccionado es `adminTienda` (§2.4, R5/R6).
