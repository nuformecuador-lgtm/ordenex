# Feature 27 — Fulfillment de tienda + estado inicial condicional · requirements.md

Zone: fullstack · complexity: high · depends_on: 25 (y 28) · branch: feature/27-fulfillment-tienda

> Estado: `spec_ready`. Las 3 decisiones de la puerta de aprobación quedaron cerradas
> por el humano (2026-07-10); ver "Decisiones del humano (2026-07-10)" al final. No
> quedan preguntas abiertas.

Notación EARS. Cada requisito es testeable y mapeable a un test concreto (columna
"Test" en la tabla de trazabilidad). El "actor" se resuelve vía
`resolveActorFromSession` → `{ usuarioId, rol }` (patrón features 6/15/25). "Rol
autorizado" para la gestión de usuarios es `maestro` (feature 25, Decisión 1).

Contexto de código real (no inventar):
- Modelo `Usuario` en `db/schema.prisma` (hoy sin campo `fulfillment`).
- UI de creación/edición: `app/(app)/configuracion/_components/UsuarioForm.tsx`
  (+ `UsuariosModule.tsx`), schemas en `lib/types/usuario.ts`, service
  `lib/services/UsuarioService.ts`, repo `lib/interfaces/repositories/IUserRepository.ts`.
- Carga masiva: `lib/services/BulkOrdenService.ts` (`cargarMasiva`), config
  `lib/config/ordenes.ts` (`ORDENES_DEFAULT_ESTATUS_VALUE` → `DEFAULT_ESTATUS_VALUE`),
  route `app/api/ordenes/carga-masiva/route.ts`, repo `IOrdenRepository`.
- Catálogo de estados: `lib/types/order-status.ts` (contiene `en_fulfillment` y
  `en_preparacion`; el rename `embalaje → en_fulfillment` es la feature 28, ya `done`).
- El estado inicial de la tienda "que carga" es el actor `adminTienda`:
  `BulkOrdenService` ya fija `const tiendaId = actor.usuarioId;`.

---

## Modelo de datos: campo `fulfillment` en `Usuario`

- **R1** — El sistema DEBE disponer de un campo booleano `fulfillment` en el modelo
  `Usuario` (columna `fulfillment` en la tabla `usuario`), con valor por defecto
  `false`, no nulo.
- **R2** — El sistema DEBE introducir el campo `fulfillment` mediante una migración
  Prisma versionada que incluya OBLIGATORIAMENTE su `down.sql` (convención del repo,
  `docs/architecture.md`). El `up` agrega la columna con default `false`; el `down`
  la elimina, dejando el esquema exactamente como antes de la migración.
- **R3** — CUANDO se crea un usuario sin especificar `fulfillment`, el sistema DEBE
  persistirlo con `fulfillment = false` (no `null`).
- **R4** — El sistema DEBE tratar `fulfillment` como un dato aplicable únicamente al
  rol `adminTienda`. La columna existe genérica en `Usuario` (default `false`), pero el
  backend fuerza la invariante de R4a (Decisión P1).
- **R4a** — CUANDO se crea o edita un usuario cuyo rol NO es `adminTienda`, el sistema
  DEBE forzar `fulfillment = false` en el backend, ignorando cualquier valor `true`
  recibido, sin depender de que la UI lo omita. Solo un usuario con rol `adminTienda`
  puede quedar con `fulfillment = true`.

## Switch en la creación de usuario

- **R5** — CUANDO un actor autorizado abre el formulario de creación de usuario y el
  rol seleccionado es `adminTienda`, el sistema DEBE mostrar un interruptor
  "esta tienda tiene fulfillment" (sí/no) que representa el campo `fulfillment`.
- **R6** — MIENTRAS el rol seleccionado en el formulario de creación NO sea
  `adminTienda`, el sistema DEBE ocultar el interruptor de fulfillment y NO enviar el
  campo `fulfillment` (o enviarlo como `false`), sin bloquear la creación del usuario
  (Decisión P3: el switch se muestra únicamente para `adminTienda`).
- **R7** — El interruptor de fulfillment DEBE iniciar en "no" (`false`) por defecto al
  abrir el formulario de creación.
- **R8** — CUANDO un actor autorizado crea un usuario con rol `adminTienda` y el
  interruptor en "sí", el sistema DEBE persistir `fulfillment = true` en ese usuario.
- **R9** — CUANDO un actor autorizado crea un usuario con rol `adminTienda` y el
  interruptor en "no", el sistema DEBE persistir `fulfillment = false`.
- **R10** — El sistema DEBE validar el campo `fulfillment` en el borde (zod) como
  booleano opcional; SI se envía un valor no booleano, ENTONCES DEBE responder
  `validation_error` sin crear el usuario.

## Switch en la edición de usuario

- **R11** — CUANDO un actor autorizado abre el formulario de edición de un usuario con
  rol `adminTienda`, el sistema DEBE mostrar el interruptor de fulfillment con el valor
  actual del campo `fulfillment` de ese usuario (prefill).
- **R12** — CUANDO un actor autorizado edita un usuario `adminTienda` y cambia el
  interruptor, el sistema DEBE persistir el nuevo valor de `fulfillment` sin alterar
  los demás campos no editados.
- **R13** — El sistema DEBE incluir `fulfillment` entre los campos editables del schema
  de actualización (junto a `nombre`, `telefono`, `rolId`, `tipoIdentificacionId`) y
  NUNCA permitir por esta vía editar `email`, `cedula` ni `passwordHash` (regla feature 25).
- **R14** — CUANDO se obtiene un usuario en su forma pública (`UsuarioPublico`), el
  sistema DEBE incluir el campo `fulfillment` para que la UI pueda hacer el prefill,
  y NUNCA incluir `passwordHash`.

## Estado inicial condicional en la carga masiva

- **R15** — CUANDO una tienda (`adminTienda` autenticado) realiza una carga masiva de
  órdenes, el sistema DEBE identificar la tienda que carga SIEMPRE como el actor
  autenticado (`actor.usuarioId`, la misma identidad que ya se usa como `tiendaId` de
  cada orden) y leer el flag `fulfillment` de ese usuario. El sistema NO DEBE soportar
  carga "en nombre de" otra tienda (Decisión P2).
- **R16** — SI la tienda que realiza la carga tiene `fulfillment = true`, ENTONCES el
  sistema DEBE crear cada orden nueva del lote con estado inicial `en_fulfillment`.
- **R17** — SI la tienda que realiza la carga tiene `fulfillment = false` (o el campo
  es su default), ENTONCES el sistema DEBE crear cada orden nueva del lote con estado
  inicial `en_preparacion` (comportamiento actual, no-regresión).
- **R18** — El sistema DEBE resolver el estado inicial UNA sola vez por lote (no por
  fila) a partir del `fulfillment` de la tienda, y aplicar el mismo estado a todas las
  órdenes creadas en ese lote.
- **R19** — El estado inicial resuelto (R16/R17) DEBE ser el que se reporte como
  `estatus` de cada fila `creada` en el `BulkSummary`, en lugar del valor global fijo
  actual (`DEFAULT_ESTATUS_VALUE`).
- **R20** — El sistema DEBE resolver el `estatusId` del estado inicial contra el
  catálogo `order_status` por su `value` (`en_fulfillment` o `en_preparacion`); SI el
  valor requerido no existe en el catálogo (seed pendiente), ENTONCES DEBE aplicar la
  misma guarda defensiva actual (ninguna fila se crea; se reporta error de estatus por
  fila), sin crear órdenes con estado inválido.
- **R21** — El cambio del estado inicial condicional NO DEBE alterar el resto del flujo
  de carga masiva (deduplicación intra-archivo y contra DB, resolución geográfica,
  resolución de mensajero sugerido, batching): esos comportamientos se conservan
  idénticos (no-regresión de la feature 15/16).

## No-regresión y trazabilidad

- **R22** — El sistema DEBE mantener el comportamiento previo para tiendas sin
  fulfillment: una carga masiva de una tienda con `fulfillment = false` produce órdenes
  en `en_preparacion`, exactamente como antes de esta feature.
- **R23** — El sistema NO DEBE introducir un nuevo valor de estado: reutiliza
  `en_fulfillment` (feature 28) y `en_preparacion` (feature 15) ya presentes en
  `ORDER_STATUS_SEED`.
- **R24** — Cada requisito (`R1`–`R23`, incluido `R4a`) DEBE quedar mapeado a al menos
  un test (tabla de trazabilidad de abajo; el `implementer` la completa con rutas de
  test concretas en `progress/impl_27-fulfillment-tienda.md`).

---

## Tabla de trazabilidad (requisito → test previsto)

| Req | Test previsto (nivel) |
| --- | --- |
| R1  | unit/integration: `Usuario` acepta y persiste `fulfillment` boolean |
| R2  | script/CI: aplicar migración up y `down.sql` (db:rollback) deja el esquema estable |
| R3  | unit repo: `create` sin `fulfillment` → persiste `false` |
| R4  | unit: usuario no-`adminTienda` con `fulfillment=false`, sin efectos |
| R4a | unit service: crear/editar rol ≠ `adminTienda` con `true` recibido → persiste `false` |
| R5  | component `UsuarioForm`: rol `adminTienda` seleccionado → switch visible |
| R6  | component `UsuarioForm`: rol ≠ `adminTienda` → switch oculto, no envía `fulfillment` |
| R7  | component: switch inicia en `false` en modo crear |
| R8  | unit service/repo: crear `adminTienda` con `fulfillment=true` persiste `true` |
| R9  | unit service/repo: crear `adminTienda` con switch "no" persiste `false` |
| R10 | unit schema: `crearUsuarioSchema` rechaza `fulfillment` no booleano |
| R11 | component: modo editar `adminTienda` prefilla el switch con el valor actual |
| R12 | unit service/repo: editar cambia solo `fulfillment` |
| R13 | unit schema: `actualizarUsuarioSchema` acepta `fulfillment`, rechaza email/cedula |
| R14 | unit repo: `UsuarioPublico` incluye `fulfillment`, no `passwordHash` |
| R15 | unit `BulkOrdenService`: usa `actor.usuarioId` como tienda que carga |
| R16 | unit `BulkOrdenService`: tienda `fulfillment=true` → órdenes en `en_fulfillment` |
| R17 | unit `BulkOrdenService`: tienda `fulfillment=false` → órdenes en `en_preparacion` |
| R18 | unit `BulkOrdenService`: una sola resolución de estatus por lote |
| R19 | unit `BulkOrdenService`: `BulkSummary` reporta el estatus resuelto por fila creada |
| R20 | unit `BulkOrdenService`: estatus inexistente → guarda defensiva (0 creadas) |
| R21 | unit/integration: dedup/geo/mensajero/batch sin cambios (tests feature 15/16 verdes) |
| R22 | integration route: carga de tienda sin fulfillment → `en_preparacion` (no-regresión) |
| R23 | unit: `ORDER_STATUS_SEED` sin valores nuevos; ambos estados ya presentes |
| R24 | revisión: todos los R con test asociado (reviewer) |

---

## Decisiones del humano (2026-07-10)

Cerradas en la puerta de aprobación. Ya no quedan preguntas abiertas.

- **P1 → Restringido por rol en backend.** `fulfillment` solo puede ser `true` para
  usuarios con rol `adminTienda`. La columna existe genérica en `Usuario` (default
  `false`), pero el backend fuerza `fulfillment = false` para cualquier otro rol,
  ignorando un `true` recibido. → Requisito **R4/R4a**.
- **P2 → `adminTienda` autenticado.** "La tienda que realiza la carga" es siempre el
  usuario `adminTienda` autenticado (`actor.usuarioId`, como hoy en `BulkOrdenService`);
  el flag `fulfillment` se lee de ese usuario. No se modela carga "en nombre de" otra
  tienda. → Requisito **R15**.
- **P3 → Solo si rol = `adminTienda`.** El interruptor "esta tienda tiene fulfillment"
  se muestra en el formulario de usuario únicamente cuando el rol seleccionado es
  `adminTienda`; para otros roles se oculta. → Requisitos **R5/R6**.
