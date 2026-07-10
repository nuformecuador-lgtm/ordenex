# requirements.md — ordenes: carga masiva - etapa 2 (feature 16)

> Tras una carga masiva (feature 15) que **YA creó** las órdenes en estatus
> `en_preparacion`, esta feature muestra un **resumen** de las órdenes recién
> creadas (columna por columna) y permite **asignar/actualizar** su
> `mensajero_sugerido_id`. Es **fullstack** (backend primero, frontend después).
>
> Zona: fullstack · Complejidad: medium · depends_on: 15.
>
> **Restricciones NO negociables (decisión humana 2026-07-10):**
> 1. **POST-COMMIT.** NO cambia el flujo de las features 14/15. Las órdenes ya
>    existen (`en_preparacion`); aquí solo se muestran y se les asigna mensajero
>    sobre registros YA persistidos. No es un preview pre-creación.
> 2. **Asignación AMBOS:** un `select` GLOBAL "aplicar a todos" + override por fila.
>    El `select` se puebla con usuarios `role = mensajero`.
>
> **Anclas reales del repo (no se inventan APIs):**
> - `mensajero_sugerido_id` / relación `mensajeroSugerido` YA existen en
>   `model Orden` (feature 15). **No hay migración nueva.**
> - `IUserRepository`/`UserRepository` hoy: `findById/findByEmail/findByEmailWithHash/create`.
>   **NO** hay listado por rol → se añade uno.
> - `IOrdenRepository`/`OrdenRepository` ya tiene `findMensajerosByIds` (subconjunto
>   de ids con rol `mensajero`), `list` (filtra por `tiendaId`/`estatusId`),
>   `update`/`updateMany` scoping por `deletedAt`. `OrdenDTO`/`toDTO` **NO** exponen
>   hoy `mensajeroSugeridoId`/`direccion`/`montoCobrar`.
> - `OrdenService`: matriz de roles (`maestro`/`admin`/`adminTienda`/`mensajero`),
>   `adminTienda` acotado a su propia tienda (`tiendaId = actor.usuarioId`).
> - `BulkOrdenService.cargarMasiva`: SOLO `adminTienda`, tienda propia.
> - Server Actions patrón `withErrorHandler` + `toActionError` (feature 10),
>   `resolveActorFromSession` (Actor = `{ usuarioId, rol }`).
> - Frontend: `DataTable` (columnas `{ id, value, render }`), `Modal`
>   (async, `closeOnConfirm`), `useToast`, SWR key `["ordenes:list", …]`.
>   `OrdenesCargaMasivaButton` (feature 14) ya recibe el `BulkSummary`
>   (`{ total, creadas, duplicadas, conError, filas[] }`) en `onSuccess`.
> - `components/ui/` hoy: alert, button, card, input, label. **NO hay `Select`.**

## Alcance

- **Backend:** (a) listar mensajeros para el select; (b) obtener el resumen de las
  órdenes del lote recién cargado (de la tienda del actor); (c) asignar
  `mensajero_sugerido_id` a una o varias órdenes (global + override), con
  autorización por rol y validación de mensajero/tienda. Reutiliza el manejador de
  errores (feature 10). Sin migraciones.
- **Frontend:** vista de resumen columna por columna (`DataTable`) con `num_remision`
  visible, `select` global + `select` por fila, confirmación que llama la(s) Server
  Action(s) de asignación, y toasts (feature 11).

**Fuera de alcance:** cambiar el parseo/creación de la carga (feature 15), el
componente `BulkUpload`, tocar el CRUD de órdenes salvo lo estrictamente necesario
para exponer/actualizar `mensajero_sugerido_id`, y el flujo de bodega/aceptación
(feature 17).

---

## Requisitos — BACKEND (EARS)

### Listar mensajeros (para el select)

- **R1** — El sistema DEBE exponer una operación `listarMensajeros` que devuelva la
  lista de usuarios con rol `mensajero`, cada elemento como `{ id, nombre }` y
  **nada más** (sin email, teléfono, cédula ni `password_hash`).
- **R2** — El repositorio de usuarios DEBE ofrecer un método nuevo (p. ej.
  `listMensajeros()`) que consulte usuarios cuyo `rol.value === "mensajero"`
  proyectando únicamente `id` y `nombre`, ordenados por `nombre`.
- **R3** — **[ABIERTO-1]** ¿Filtrar por `estado`? El enum `EstadoUsuario` es
  `pendiente|activo|inactivo|bloqueado`. **Propuesta por defecto:** devolver solo
  mensajeros con `estado = activo` (un mensajero no habilitado no debería poder
  sugerirse). Verificable con un test que excluya un mensajero `inactivo`.
- **R4** — MIENTRAS el actor no esté autenticado, `listarMensajeros` DEBE devolver
  `unauthenticated`.
- **R5** — SI el rol del actor no está autorizado, ENTONCES `listarMensajeros` DEBE
  devolver `forbidden`. **[ABIERTO-2]** ¿Quién puede listar? **Propuesta por
  defecto:** `adminTienda` (dueño del lote) + `maestro` + `admin`; `mensajero` y
  roles desconocidos → `forbidden`.

### Resumen del lote recién cargado

- **R6** — El sistema DEBE exponer una operación `resumenCargaMasiva` que, dado un
  conjunto de `num_remision`, devuelva por cada orden existente **y perteneciente a
  la tienda del actor** los datos ingresados: `numGuia`, `numRemision`,
  `destinatario`, `telefonoDest`, `producto`, `montoCobrar`, `direccion`,
  `estatusValue` y `mensajeroSugeridoId` (más `mensajeroSugeridoNombre` si existe).
- **R7** — **[ABIERTO-3]** ¿Cómo se identifica "el lote recién cargado"?
  **Propuesta por defecto:** el frontend obtiene los `num_remision` con
  `resultado === "creada"` del `BulkSummary.filas` de la feature 15 y los pasa a
  `resumenCargaMasiva`. Esto identifica el lote con precisión (no mezcla lotes
  anteriores). *Alternativa descartada:* filtrar `listarOrdenes` por
  `estatusId = en_preparacion`, que incluiría órdenes de cargas previas aún sin
  procesar. Ver `design.md`.
- **R8** — El resumen DEBE limitarse a órdenes **no borradas** (`deletedAt IS NULL`)
  y de la tienda del actor; órdenes de otra tienda, inexistentes o borradas NO
  DEBEN aparecer.
- **R9** — El resumen NO DEBE exponer campos internos/sensibles (`deletedAt`,
  `passwordHash`, ids de sesión). **[ABIERTO-4]** ¿Mostrar provincia/cantón/distrito
  por **nombre**? Requiere joins de catálogo. **Propuesta por defecto:** NO
  incluirlos en esta etapa (el foco es identificación + mensajero); se muestran los
  campos ya disponibles en la orden. Marcar como mejora futura.
- **R10** — El resumen DEBE preservar la unicidad de `num_remision`: dado un input de
  remisiones distintas, el resultado NO DEBE contener dos filas con el mismo
  `num_remision` (consecuencia de la unicidad garantizada por feature 15).
- **R11** — `resumenCargaMasiva` DEBE devolver `unauthenticated` sin sesión y
  `forbidden` para roles no autorizados. **Propuesta por defecto:** SOLO
  `adminTienda` (sobre su propia tienda), coherente con `BulkOrdenService`.

### Asignar mensajero sugerido (global + override)

- **R12** — El sistema DEBE exponer una operación `asignarMensajeroSugerido` que
  reciba una lista de asignaciones `{ ordenId, mensajeroId }` y actualice el campo
  `mensajero_sugerido_id` de cada orden indicada al mensajero indicado. Esta forma
  cubre AMBOS casos: "aplicar a todos" (mismo `mensajeroId` en todas las
  asignaciones) y override por fila (distintos `mensajeroId`).
- **R13** — SI algún `mensajeroId` no corresponde a un usuario con rol `mensajero`,
  ENTONCES `asignarMensajeroSugerido` DEBE devolver `validation_error` (con
  `fieldErrors` en la clave del mensajero) y NO DEBE persistir ninguna asignación.
- **R14** — SI alguna orden de la lista no pertenece a la tienda del actor, no existe
  o está borrada, ENTONCES el sistema NO DEBE modificarla. **[ABIERTO-5]** ¿todo-o-
  nada o parcial? **Propuesta por defecto:** **todo-o-nada**: si cualquier
  `ordenId` no es de la tienda del actor, devuelve `forbidden` sin aplicar cambios;
  ids inexistentes/borrados simplemente no afectan filas (count refleja lo aplicado).
- **R15** — La asignación DEBE persistirse **por lote**: una actualización por cada
  `mensajeroId` distinto (`updateMany`), no una consulta por orden.
- **R16** — El repositorio DEBE actualizar `mensajero_sugerido_id` solo en órdenes
  no borradas y de la `tiendaId` indicada, devolviendo el número de filas afectadas.
- **R17** — `asignarMensajeroSugerido` DEBE devolver `unauthenticated` sin sesión y
  `forbidden` para roles no autorizados (mismos roles que R11: `adminTienda`).
- **R18** — Una asignación con lista vacía DEBE ser un no-op válido (devuelve `ok`
  con 0 filas afectadas), sin error.

### Contrato y consistencia

- **R19** — Todos los errores de estas operaciones DEBEN normalizarse con el
  manejador global (feature 10) vía `withErrorHandler` y traducirse al `ActionError`
  tipado (`validation_error | unauthenticated | forbidden | not_found | conflict`),
  reutilizando el patrón `toActionError` de `lib/actions/ordenes.ts`.
- **R20** — El sistema NO DEBE introducir migración ni columna nueva: DEBE reutilizar
  `orden.mensajero_sugerido_id` y la relación `mensajeroSugerido` existentes
  (feature 15). Verificable por revisión: el diff no añade nada bajo `db/migrations/`.

---

## Requisitos — FRONTEND (EARS)

- **R21** — CUANDO una carga masiva finalice con `creadas > 0`, el sistema DEBE
  presentar una vista de **resumen** de las órdenes creadas del lote, columna por
  columna. **[ABIERTO-6]** ¿Dónde vive? **Propuesta por defecto:** como **segundo
  paso dentro del mismo modal** de la feature 14 (`OrdenesCargaMasivaButton`): al
  recibir `onSuccess`, el modal cambia de la vista de subida a la vista de resumen +
  asignación. *Alternativa:* panel/sección nueva bajo la tabla en `/ordenes`. Ver
  `design.md`.
- **R22** — El resumen DEBE renderizarse con `DataTable` (`components/shared/DataTable.tsx`),
  mostrando al menos las columnas: `num_remision`, `destinatario`, `telefono`,
  `producto`, `estatus` y la columna de **mensajero** (select por fila). `monto` y
  `direccion` son opcionales de presentación.
- **R23** — El resumen DEBE mostrar `num_remision` como columna identificadora
  visible; la `rowKey` del `DataTable` DEBE ser el `id` de la orden (no el índice).
- **R24** — El sistema DEBE mostrar un `select` **GLOBAL** "aplicar a todos" poblado
  con la lista de mensajeros obtenida de `listarMensajeros`.
- **R25** — CUANDO el usuario elija un mensajero en el select global, el sistema DEBE
  aplicar ese mensajero como valor seleccionado a **TODAS** las filas del resumen.
- **R26** — El sistema DEBE mostrar un `select` de mensajero **por fila** (override)
  con la misma lista; CUANDO el usuario cambie el de una fila, DEBE sobrescribir
  solo esa fila, sin afectar las demás ni volver a tocar el global.
- **R27** — El select de cada fila DEBE **pre-seleccionar** el `mensajeroSugeridoId`
  de la orden si vino en la carga (valor inicial por fila).
- **R28** — CUANDO el usuario confirme la asignación, el sistema DEBE invocar
  `asignarMensajeroSugerido` con las asignaciones resueltas (global + overrides) y,
  al éxito, mostrar un toast `success` (feature 11).
- **R29** — SI la asignación falla (o el resultado no es `ok`), ENTONCES el sistema
  DEBE mostrar un toast `error` y NO DEBE indicar éxito.
- **R30** — MIENTRAS la asignación esté en curso, el control de confirmación DEBE
  bloquearse / mostrar progreso (reutilizando el flujo async del `Modal` o estado
  local equivalente), evitando doble envío.
- **R31** — La lista de mensajeros DEBE cargarse mediante **Server Action** (no
  `fetch` a una ruta API interna), manejando estados de carga y error (p. ej. select
  deshabilitado mientras carga; toast/aviso si falla).
- **R32** — El `select` DEBE ser accesible: rol/nombre accesible y operable por
  teclado. **[ABIERTO-7]** ¿Qué componente? `components/ui/` no tiene `Select`.
  **Propuesta por defecto:** crear `components/ui/select.tsx` sobre
  `@base-ui/react/select`, coherente con el precedente de `Modal`/`Toast`
  (construidos sobre `@base-ui/react`) y evitando arrastrar Radix vía
  `npx shadcn add select`. *Alternativa:* `npx shadcn add select`. Ver `design.md`.
- **R33** — Tras una asignación con éxito, el sistema DEBE refrescar la lista de
  órdenes revalidando las claves SWR `["ordenes:list", …]` (`mutate`), para reflejar
  el mensajero asignado.
- **R34** — El resumen DEBE lograrse sin modificar `DataTable`, `Modal`, `useToast`
  ni `BulkUpload`: todo el código nuevo de UI vive en
  `app/(app)/ordenes/_components/` y, si aplica, en un `components/ui/select.tsx`
  reutilizable.

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md`. Backend: unit de servicio y
de repositorios (Vitest, mockeando Prisma/`IOrdenRepository`/`IUserRepository`,
patrón `tests/unit/services/bulk-orden-service.test.ts`) + integración de la Server
Action. Frontend: test de componente (`@testing-library/react` + `userEvent`,
`// @vitest-environment jsdom`, patrón `tests/components/OrdenesCargaMasivaButton.test.tsx`).

---

## Decisiones cerradas (humano, 2026-07-10)

- **[RESUELTO-1]** `listarMensajeros` filtra por `estado = activo` (excluye
  pendiente/inactivo/bloqueado). Fija R3.
- **[RESUELTO-2]** Autorización: `listarMensajeros` → `adminTienda` + `maestro` +
  `admin` (R5); `resumenCargaMasiva` y `asignarMensajeroSugerido` → SOLO `adminTienda`
  sobre su propia tienda (R11, R17), coherente con `BulkOrdenService`.
- **[RESUELTO-3]** El "lote recién cargado" se identifica por los `num_remision` con
  `resultado === "creada"` del `BulkSummary` (feature 15) que el frontend pasa a
  `resumenCargaMasiva` (R7). No se filtra por `estatus = en_preparacion` (mezclaría lotes).
- **[RESUELTO-4]** El resumen NO incluye provincia/cantón/distrito por nombre en esta
  etapa (R9); mejora futura.
- **[RESUELTO-5]** Asignación **todo-o-nada**: si algún `ordenId` no es de la tienda del
  actor → `forbidden` sin aplicar cambios (R14).
- **[RESUELTO-6]** El resumen vive como **segundo paso dentro del mismo modal** de la
  feature 14 (`OrdenesCargaMasivaButton`): al recibir `onSuccess`, el modal cambia de la
  vista de subida a la de resumen + asignación (R21).
- **[RESUELTO-7]** El `Select` se crea en `components/ui/select.tsx` sobre
  **`@base-ui/react/select`** (coherente con `Modal`/`Toast`, sin arrastrar Radix) (R32).
