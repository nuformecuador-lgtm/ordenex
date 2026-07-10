# tasks.md — ordenes: carga masiva - etapa 2 (feature 16)

Orden de implementación: **BACKEND primero, FRONTEND después**. `[P]` = paralelizable
con las tareas de su mismo bloque. Cada task incluye su criterio de "hecho". Tests
con Vitest (patrón del repo). Referencias: `tests/unit/services/bulk-orden-service.test.ts`,
`tests/unit/repositories/orden-repository.bulk.test.ts`,
`tests/integration/actions/ordenes-action.test.ts`,
`tests/components/OrdenesCargaMasivaButton.test.tsx`.

---

## Bloque 0 — Tipos y contratos (base)

- [x] **T0.1** Crear `lib/types/asignacion-mensajero.ts`: `MensajeroDTO`,
  `ResumenCargaOrdenDTO`, `resumenCargaSchema`, `asignarMensajeroSchema` (zod).
  **Hecho:** `npm run typecheck` verde; los schemas rechazan input inválido y
  `asignarMensajeroSchema` acepta `asignaciones: []` (R18).

---

## Bloque 1 — Repositorios (depende de T0.1)

- [x] **T1.1 [P]** `IUserRepository` + `UserRepository`: añadir
  `listMensajeros(): Promise<MensajeroDTO[]>` (filtra `rol.value="mensajero"`,
  `estado="activo"` [ABIERTO-1], `select {id,nombre}`, `orderBy nombre`).
  **Hecho:** test `tests/unit/repositories/user-repository.mensajeros.test.ts`:
  devuelve solo id/nombre, excluye no-mensajeros y (por defecto) `estado != activo`.
  → **R1, R2, R3**
- [x] **T1.2 [P]** `IOrdenRepository` + `OrdenRepository`: añadir
  `findResumenByNumRemisiones(nums, tiendaId)` (where `numRemision in`, `tiendaId`,
  `deletedAt:null`; include estatus.value + mensajeroSugerido.nombre; Decimal→number).
  **Hecho:** test en `tests/unit/repositories/orden-repository.asignacion.test.ts`:
  excluye órdenes de otra tienda y borradas; mapea montoCobrar a number|null; no
  expone deletedAt. → **R6, R8, R9, R10**
- [x] **T1.3 [P]** `IOrdenRepository` + `OrdenRepository`: añadir
  `asignarMensajeroSugerido(ordenIds, mensajeroSugeridoId, tiendaId): Promise<number>`
  (`updateMany` where id in + tiendaId + deletedAt:null; devuelve count).
  **Hecho:** mismo archivo de test: actualiza solo órdenes de la tienda y no
  borradas; devuelve el nº de filas afectadas. → **R15, R16**

---

## Bloque 2 — Servicio (depende de Bloque 1)

- [x] **T2.1** Crear `lib/interfaces/services/IAsignacionMensajeroService.ts` con los
  3 métodos y sus resultados discriminados. **Hecho:** typecheck verde.
- [x] **T2.2** Crear `lib/services/AsignacionMensajeroService.ts` (inyecta
  `IUserRepository` + `IOrdenRepository`):
  - `listarMensajeros(actor)`: autoriza {adminTienda, maestro, admin} → ok; otro →
    forbidden. → **R1, R5**
  - `resumenCargaMasiva(input, actor)`: solo adminTienda (tienda propia); otro →
    forbidden. → **R6, R11**
  - `asignarMensajeroSugerido(input, actor)`: adminTienda; valida mensajeros
    (`findMensajerosByIds`), todo-o-nada por tienda, agrupa por mensajero, no-op si
    vacío. → **R12, R13, R14, R15, R17, R18**

  **Hecho:** `tests/unit/services/asignacion-mensajero-service.test.ts` (patrón
  bulk-orden-service, repos mockeados):
  - lista mensajeros para roles autorizados; `forbidden` para mensajero/desconocido (R5).
  - `resumenCargaMasiva`: `forbidden` para no-adminTienda (R11).
  - asignación: `validation_error` si un mensajeroId no es mensajero, sin persistir (R13).
  - asignación: `forbidden` si una orden no es de la tienda, sin persistir (R14).
  - asignación agrupa por mensajero distinto → nº de llamadas a
    `repo.asignarMensajeroSugerido` = nº de mensajeros distintos (R15).
  - `asignaciones: []` → `ok` con `asignadas: 0` sin llamar al repo (R18).

---

## Bloque 3 — Server Actions (depende de Bloque 2)

- [x] **T3.1** Extraer `toActionError` de `lib/actions/ordenes.ts` a
  `lib/actions/_shared/to-action-error.ts` (sin cambiar comportamiento) y actualizar
  el import en `ordenes.ts`. **Hecho:** suite existente de `ordenes-action` sigue
  verde (sin regresión).
- [x] **T3.2** Crear `lib/actions/mensajeros.ts` (`'use server'`): `listarMensajeros`,
  `resumenCargaMasiva`, `asignarMensajeroSugerido` con `withErrorHandler` +
  `resolveActorFromSession` + zod parse + `toActionError`; `deps` inyectable.
  **Hecho:** `tests/integration/actions/mensajeros-action.test.ts`:
  - sin sesión → `unauthenticated` (R4/R17).
  - rol no autorizado → `forbidden` (R5/R11).
  - input inválido (p. ej. `numRemisiones: []`) → `validation_error` (R19).
  - éxito propaga el resultado del servicio (mock) sin filtrar internals.
  → **R4, R17, R19, R20** (revisión: el diff no toca `db/migrations/`).

---

## Bloque 4 — Frontend: Select reutilizable (depende de nada; [P] con Bloque 1-3)

- [x] **T4.1 [P]** Crear `components/ui/select.tsx` sobre `@base-ui/react/select`
  [ABIERTO-7]: props `value`, `onValueChange`, `options`, `placeholder`, `disabled`,
  `aria-label`. **Hecho:** `tests/components/Select.test.tsx`: expone rol/nombre
  accesible, abre lista, selecciona una opción y emite `onValueChange`, operable por
  teclado. → **R32**

---

## Bloque 5 — Frontend: vista de resumen (depende de T3.2, T4.1)

- [x] **T5.1** Crear `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx`:
  recibe `numRemisiones`, carga `resumenCargaMasiva` + `listarMensajeros` (Server
  Actions), render con `DataTable`, select global + select por fila, confirmar →
  `asignarMensajeroSugerido` + toasts + mutate. **Hecho (tests abajo).**
- [x] **T5.2** Extender `OrdenesCargaMasivaButton.tsx`: estado de paso
  `upload→resumen`; en `onSuccess` con `creadas>0` calcula `numRemisiones` de
  `filas` (`resultado==="creada"`) y monta `OrdenesCargaResumen` en el modal; si
  `creadas===0`, comportamiento de feature 14 intacto. **Hecho:** la suite existente
  `OrdenesCargaMasivaButton.test.tsx` sigue verde y se añade un caso: `creadas>0`
  monta el resumen. → **R21**

  **Hecho — `tests/components/OrdenesCargaResumen.test.tsx`** (jsdom, mock de las
  Server Actions de `lib/actions/mensajeros`, `useToast`, SWR `mutate`):
  - render con `DataTable` mostrando `num_remision` visible y una fila por orden;
    rowKey = id (R22, R23).
  - carga de mensajeros vía Server Action mockeada; select deshabilitado/errored si
    falla (R31).
  - select **global** cambia → todas las filas quedan con ese mensajero
    seleccionado (R24, R25).
  - override de una fila cambia solo esa fila (R26).
  - valor inicial de cada fila = `mensajeroSugeridoId` de la orden (R27).
  - confirmar → llama `asignarMensajeroSugerido` con las asignaciones resueltas,
    `toast.success` y `mutate(["ordenes:list", …])` (R28, R33).
  - resultado `!== "ok"` o excepción → `toast.error`, sin éxito (R29).
  - durante el envío el confirmar se bloquea / no permite doble submit (R30).
  - no modifica `DataTable`/`Modal`/`useToast`/`BulkUpload` (revisión de diff) (R34).

---

## Bloque 6 — Verificación final

- [x] **T6.1** `./init.sh` en verde: `npm run typecheck`, `npm run lint`, `npm test`.
  **Hecho:** salida pegada en `progress/impl_carga-masiva-etapa2.md`.
- [x] **T6.2** Completar el mapa `R<n> → test` en `progress/impl_carga-masiva-etapa2.md`.
  **Hecho:** cada R1–R34 con su test; sin requisitos huérfanos.

---

## Mapa R → test (resumen)

| R | Área | Test |
|---|------|------|
| R1 | listar mensajeros | user-repository.mensajeros + asignacion-mensajero-service |
| R2, R3 | repo usuarios | user-repository.mensajeros.test.ts |
| R4, R17 | acción autz | mensajeros-action.test.ts |
| R5 | servicio autz listar | asignacion-mensajero-service.test.ts |
| R6, R8, R9, R10 | resumen repo | orden-repository.asignacion.test.ts |
| R11 | servicio autz resumen | asignacion-mensajero-service.test.ts |
| R12, R13, R14, R15, R18 | servicio asignar | asignacion-mensajero-service.test.ts |
| R16 | repo asignar | orden-repository.asignacion.test.ts |
| R19 | acción errores | mensajeros-action.test.ts |
| R20 | sin migración | revisión de diff (sin `db/migrations/` nuevo) |
| R21 | paso resumen | OrdenesCargaMasivaButton.test.tsx |
| R22, R23 | DataTable resumen | OrdenesCargaResumen.test.tsx |
| R24, R25 | select global | OrdenesCargaResumen.test.tsx |
| R26, R27 | override por fila | OrdenesCargaResumen.test.tsx |
| R28, R33 | confirmar + toast + mutate | OrdenesCargaResumen.test.tsx |
| R29 | fallo asignación | OrdenesCargaResumen.test.tsx |
| R30 | bloqueo envío | OrdenesCargaResumen.test.tsx |
| R31 | carga mensajeros | OrdenesCargaResumen.test.tsx |
| R32 | Select accesible | Select.test.tsx |
| R34 | sin tocar genéricos | revisión de diff |

> Las tareas dependen de resolver los **[ABIERTO-1..7]** de `requirements.md`. Si el
> humano confirma los defaults propuestos, se implementan tal cual; si no, se ajustan
> los tests indicados antes de codificar.
