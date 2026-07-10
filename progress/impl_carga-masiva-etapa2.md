# impl_carga-masiva-etapa2.md — feature 16 (FULLSTACK, backend + frontend)

Rama: `feature/16-carga-masiva-etapa2`. Alcance: capa completa (backend R1-R20 +
frontend R21-R34) segun `specs/carga-masiva-etapa2/{requirements,design,tasks}.md`.
NO se crearon migraciones (R20); NO se tocaron `DataTable`/`Modal`/`useToast`/
`BulkUpload` (R34). Orden de implementacion: backend primero, frontend despues.

Verificacion final consolidada (implementer): `./init.sh` == init OK,
**67 files / 572 tests, todo verde** (baseline dev: 61/506). Detalle abajo.

---

## PARTE 1 — BACKEND (backend_dev, R1-R20)

## Archivos creados

- `lib/types/asignacion-mensajero.ts` — `MensajeroDTO`, `ResumenCargaOrdenDTO`,
  `resumenCargaSchema` (usa `cargaMasivaConfig.MAX_ROWS`), `asignarMensajeroSchema`
  (asignaciones `[]` permitido).
- `lib/interfaces/services/IAsignacionMensajeroService.ts` — contrato de los 3
  metodos + resultados discriminados.
- `lib/services/AsignacionMensajeroService.ts` — implementacion (inyecta
  `IUserRepository` + `IOrdenRepository`).
- `lib/actions/_shared/to-action-error.ts` — `toActionError` extraido de
  `lib/actions/ordenes.ts` (T3.1), mismo comportamiento.
- `lib/actions/mensajeros.ts` — Server Actions `listarMensajeros`,
  `resumenCargaMasiva`, `asignarMensajeroSugerido` (patron `withErrorHandler` +
  `resolveActorFromSession` + zod + `toActionError`, `deps` inyectable).
- `tests/unit/repositories/user-repository.mensajeros.test.ts`
- `tests/unit/repositories/orden-repository.asignacion.test.ts`
- `tests/unit/services/asignacion-mensajero-service.test.ts`
- `tests/integration/actions/mensajeros-action.test.ts`

## Archivos editados

- `lib/interfaces/repositories/IUserRepository.ts` — `+ listMensajeros()`.
- `lib/repositories/UserRepository.ts` — implementa `listMensajeros`
  (`where: { rol: { value: "mensajero" }, estado: "activo" }`,
  `select: { id, nombre }`, `orderBy: { nombre: "asc" }`).
- `lib/interfaces/repositories/IOrdenRepository.ts` — `+
  findResumenByNumRemisiones`, `+ asignarMensajeroSugerido`, `+
  countOrdenesDeTienda`.
- `lib/repositories/OrdenRepository.ts` — implementa los 3 metodos anteriores
  (scoping `tiendaId` + `deletedAt: null`; `montoCobrar` Decimal -> number|null;
  `updateMany`/`count` con guardas de arreglo vacio sin tocar Prisma).
- `lib/actions/ordenes.ts` — reemplaza el `toActionError` local por el import
  del helper compartido; sin cambio de comportamiento (T3.1).
- `tests/unit/services/auth-service.test.ts`,
  `tests/unit/services/orden-service.test.ts`,
  `tests/unit/services/bulk-orden-service.test.ts` — se añadieron los mocks de
  los metodos nuevos de `IUserRepository`/`IOrdenRepository` a los `buildRepo`/
  `buildMocks` existentes (exigidos por TS al ampliar las interfaces); sin
  cambiar ningun assert existente.

## Mapa R → test (backend, R1–R20)

| R | Test |
|---|------|
| R1 | `tests/unit/repositories/user-repository.mensajeros.test.ts` (proyeccion id/nombre) + `tests/unit/services/asignacion-mensajero-service.test.ts` (listarMensajeros ok) |
| R2 | `tests/unit/repositories/user-repository.mensajeros.test.ts` (where/select/orderBy) |
| R3 | `tests/unit/repositories/user-repository.mensajeros.test.ts` (where.estado="activo") |
| R4 | `tests/integration/actions/mensajeros-action.test.ts` (sin sesion -> unauthenticated, listarMensajeros) |
| R5 | `tests/unit/services/asignacion-mensajero-service.test.ts` (roles autorizados vs forbidden en listarMensajeros) |
| R6 | `tests/unit/repositories/orden-repository.asignacion.test.ts` (findResumenByNumRemisiones) + `tests/unit/services/asignacion-mensajero-service.test.ts` (resumenCargaMasiva ok) |
| R7 | Decision cerrada; ejercitada por `resumenCargaMasiva({numRemisiones})` en `asignacion-mensajero-service.test.ts` y `mensajeros-action.test.ts` (input explicito, no filtra por estatus) |
| R8 | `tests/unit/repositories/orden-repository.asignacion.test.ts` (where tiendaId+deletedAt:null) |
| R9 | `tests/unit/repositories/orden-repository.asignacion.test.ts` (no expone deletedAt/passwordHash) |
| R10 | `tests/unit/repositories/orden-repository.asignacion.test.ts` (unicidad num_remision) |
| R11 | `tests/unit/services/asignacion-mensajero-service.test.ts` (resumenCargaMasiva: solo adminTienda) |
| R12 | `tests/unit/services/asignacion-mensajero-service.test.ts` (agrupacion R15, cubre la forma general) |
| R13 | `tests/unit/services/asignacion-mensajero-service.test.ts` (mensajeroId invalido -> validation_error, sin persistir) + `mensajeros-action.test.ts` (propagacion) |
| R14 | `tests/unit/services/asignacion-mensajero-service.test.ts` (todo-o-nada: count<distinct -> forbidden, sin persistir) |
| R15 | `tests/unit/services/asignacion-mensajero-service.test.ts` (agrupa por mensajeroId distinto, N llamadas = N grupos, suma counts) |
| R16 | `tests/unit/repositories/orden-repository.asignacion.test.ts` (asignarMensajeroSugerido: where + count) |
| R17 | `tests/integration/actions/mensajeros-action.test.ts` (sin sesion / rol no autorizado -> forbidden, asignarMensajeroSugerido) |
| R18 | `tests/unit/services/asignacion-mensajero-service.test.ts` (asignaciones:[] -> ok asignadas:0, repos no llamados) + `mensajeros-action.test.ts` |
| R19 | `tests/integration/actions/mensajeros-action.test.ts` (input invalido -> validation_error; forbidden/unauthenticated propagados via `toActionError`) |
| R20 | Revision de diff: `git status --porcelain` sin nada bajo `db/migrations/` (ver seccion "Verificacion de alcance") |

## Verificacion

### `pnpm run typecheck`
```
> ordenex@0.1.0 typecheck
> tsc --noEmit
(sin salida — 0 errores)
```

### `pnpm run lint`
```
> ordenex@0.1.0 lint
> eslint
(sin salida — 0 errores)
```

### `pnpm test`
```
> ordenex@0.1.0 test
> vitest run

 Test Files  65 passed (65)
      Tests  549 passed (549)
```

Baseline previo: 61 files / 506 tests. Subio a 65 files / 549 tests (4 archivos
nuevos, 43 tests nuevos), 0 rojos.

### Verificacion de alcance (R20 y restricciones)
```
$ git status --porcelain
 M feature_list.json                                  <- preexistente, no tocado por mi
 M lib/actions/ordenes.ts
 M lib/interfaces/repositories/IOrdenRepository.ts
 M lib/interfaces/repositories/IUserRepository.ts
 M lib/repositories/OrdenRepository.ts
 M lib/repositories/UserRepository.ts
 M tests/unit/services/auth-service.test.ts
 M tests/unit/services/bulk-orden-service.test.ts
 M tests/unit/services/orden-service.test.ts
?? lib/actions/_shared/
?? lib/actions/mensajeros.ts
?? lib/interfaces/services/IAsignacionMensajeroService.ts
?? lib/services/AsignacionMensajeroService.ts
?? lib/types/asignacion-mensajero.ts
?? tests/integration/actions/mensajeros-action.test.ts
?? tests/unit/repositories/orden-repository.asignacion.test.ts
?? tests/unit/repositories/user-repository.mensajeros.test.ts
?? tests/unit/services/asignacion-mensajero-service.test.ts
```
Nada bajo `db/migrations/`; nada bajo `app/`, `components/`. `feature_list.json`
aparece modificado en el working tree desde antes de esta sesion (features 24/25
agregadas por otra sesion), no fue tocado por esta tarea.

## Decisiones/deuda

- **Todo-o-nada (R14):** se implementa en `AsignacionMensajeroService.asignarMensajeroSugerido`
  contando cuantas de las `ordenId` distintas solicitadas pertenecen a la tienda
  del actor (`countOrdenesDeTienda`) y comparando contra el total de distintas
  solicitadas; si no coincide, `forbidden` sin llamar a `asignarMensajeroSugerido`
  del repo (ids ajenos, inexistentes o borrados bajan el count de igual manera,
  tal como fija la decision humana [RESUELTO-5]).
- **Constante MAX real:** `resumenCargaSchema.numRemisiones` usa
  `cargaMasivaConfig.MAX_ROWS` (de `lib/config/carga-masiva.ts`, default 5000,
  overridable por `CARGA_MASIVA_MAX_ROWS`), la misma que acota el archivo de la
  carga masiva original (feature 15), coherente con "el lote no puede ser mayor
  que lo que la carga permitio subir".
- **Relacion mensajeroSugerido:** `db/schema.prisma` define
  `mensajeroSugerido Usuario? @relation("OrdenMensajeroSugerido", fields:
  [mensajeroSugeridoId], references: [id])` sobre `model Orden`; usada tal cual
  en `OrdenRepository.findResumenByNumRemisiones` (`include`/`select` anidado
  `mensajeroSugerido: { select: { nombre: true } }`), sin migracion nueva.
- **`toActionError` compartido:** se extrajo a `lib/actions/_shared/to-action-error.ts`
  reutilizando el tipo generico `ActionError` de `lib/types/orden.ts` (no es
  especifico de orden pese al nombre del archivo); `lib/actions/mensajeros.ts` lo
  importa igual que `lib/actions/ordenes.ts`. La suite `ordenes-action.test.ts`
  sigue verde sin modificaciones.
- **Deuda:** ninguna abierta dentro del alcance backend asignado. El frontend
  (Bloques 4-6 de `tasks.md`) queda fuera de este encargo, tal como se indico.

> Nota: el conteo 65/549 corresponde al hito intermedio tras el backend. El total
> final tras frontend es 67/572 (ver Parte 3).

---

## PARTE 2 — FRONTEND (frontend_dev, R21-R34)

### Archivos creados
- `components/ui/select.tsx` — primitiva `Select` sobre `@base-ui/react/select`
  (`Root`/`Trigger`/`Value`/`Icon`/`Portal`/`Positioner`/`Popup`/`List`/`Item`/
  `ItemText`/`ItemIndicator`). Props: `value`, `onValueChange`, `options`,
  `placeholder`, `disabled`, `aria-label`. Trigger con rol `combobox`, lista
  `listbox`, items `option`; teclado accesible (R32).
- `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx` — vista de resumen +
  asignacion (paso 2 del modal). Carga `resumenCargaMasiva` + `listarMensajeros`
  via Server Actions; `DataTable` con `num_remision` visible y `rowKey=id`;
  select global "aplicar a todos" + select por fila (override, pre-selecciona
  `mensajeroSugeridoId`); confirmar async con bloqueo -> `asignarMensajeroSugerido`
  + toast + `mutate(["ordenes:list", …])`.
- `tests/components/Select.test.tsx`
- `tests/components/OrdenesCargaResumen.test.tsx`

### Archivos editados
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` — estado de paso
  `"upload"|"resumen"`; `extractNumRemisionesCreadas` lee `result.data.filas`
  (`resultado==="creada"`); con `creadas>0` monta `OrdenesCargaResumen` en el
  mismo `Modal`; con `creadas===0` conserva feature 14; resetea paso al cerrar.
- `tests/components/OrdenesCargaMasivaButton.test.tsx` — mock de
  `OrdenesCargaResumen` + 3 casos nuevos (R21).

### Mapa R → test (frontend, R21-R34)
| R | Test |
|---|------|
| R21 | `tests/components/OrdenesCargaMasivaButton.test.tsx` (paso resumen: creadas>0 monta resumen / creadas===0 intacto) |
| R22, R23 | `tests/components/OrdenesCargaResumen.test.tsx` (DataTable, num_remision visible, rowKey=id) |
| R24, R25 | `OrdenesCargaResumen.test.tsx` (select global aplica a todas las filas) |
| R26 | `OrdenesCargaResumen.test.tsx` (override cambia solo su fila) |
| R27 | `OrdenesCargaResumen.test.tsx` (valor inicial = mensajeroSugeridoId) |
| R28, R33 | `OrdenesCargaResumen.test.tsx` (confirmar -> asignarMensajeroSugerido + toast.success + mutate ordenes:list) |
| R29 | `OrdenesCargaResumen.test.tsx` (status!=="ok"/excepcion -> toast.error, sin exito) |
| R30 | `OrdenesCargaResumen.test.tsx` (bloqueo durante envio, no doble submit) |
| R31 | `OrdenesCargaResumen.test.tsx` (mensajeros via Server Action; deshabilitado/aviso si falla) |
| R32 | `tests/components/Select.test.tsx` (accesible, abre lista, selecciona, teclado) |
| R34 | Revision de diff: no se tocaron DataTable/Modal/useToast/BulkUpload |

### Decisiones/deuda frontend
- API `@base-ui/react/select`: `value` controlado como `string`, traducido a
  `null` internamente para "sin seleccion" (`Root` no acepta `""`); `items={options}`
  en `Root` para que `Value` resuelva el label. Confirmado leyendo los `.d.ts`.
- `numRemisiones` se extrae de `result.data.filas` (`BulkSummary.filas: RowResult[]`
  de `lib/types/carga-masiva.ts`), guard defensivo sin `any`.
- El boton "Confirmar asignacion" vive DENTRO de `OrdenesCargaResumen` (no en el
  footer del `Modal`), manteniendo el `Modal` como contenedor puro igual que
  feature 14; R30 con `submitting` + `submittingRef`.
- Tras confirmar con exito el modal permanece abierto (paridad con feature 14:
  no cierra automaticamente); `onDone` queda disponible sin conectar.
- Columnas opcionales `Monto` y `Direccion` anadidas (R22 las marca opcionales).

---

## PARTE 3 — Verificacion final (implementer, arnes completo)

### `./init.sh`
```
✓ node v24.13.0
✓ dependencias presentes
-> pnpm run typecheck        (tsc --noEmit, 0 errores)
-> pnpm run lint             (eslint, 0 errores)
-> pnpm run test
 Test Files  67 passed (67)
      Tests  572 passed (572)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

- Baseline dev (14/15 incluidos): 61 files / 506 tests.
- Tras backend: 65 files / 549 tests.
- Total final (backend + frontend): **67 files / 572 tests**, 0 rojos.

### Verificacion de alcance
- **R20 (sin migracion):** `git status --porcelain db/` vacio — nada bajo
  `db/migrations/` ni cambios en `db/schema.prisma`.
- **R34 (sin tocar genericos):** el diff no incluye `components/shared/DataTable.tsx`,
  `components/shared/Modal.tsx`, `hooks/useToast.ts`, `components/shared/BulkUpload.tsx`.
- Diff acotado a `lib/**` (repos/servicios/acciones/interfaces/tipos),
  `app/(app)/ordenes/**`, `components/ui/select.tsx`, tests y spec/progress.
- `feature_list.json` aparece modificado en el working tree pero es preexistente a
  esta sesion (features 24/25 de otra sesion); no fue tocado por esta tarea.

## Veredicto

Feature 16 (carga masiva - etapa 2) implementada completa segun spec: backend
(R1-R20) + frontend (R21-R34), cada requisito con su test, `./init.sh` en verde
(67 files / 572 tests) sin migraciones ni tocar componentes genericos — pendiente
de revision por el reviewer, no autoaprobado.
