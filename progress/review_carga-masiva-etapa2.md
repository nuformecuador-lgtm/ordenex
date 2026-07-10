# review_carga-masiva-etapa2.md — feature 16 (FULLSTACK)

Reviewer: verificacion contra specs/carga-masiva-etapa2 (requirements/design/tasks),
progress/impl_carga-masiva-etapa2.md, docs, CHECKPOINTS.md. Branch feature/16-carga-masiva-etapa2.
Los cambios de la feature estan en el working tree (sin commitear); los commits del branch
son features previas (14/15/11) ya revisadas.

## Veredicto: APROBADO (0 bloqueantes)

---

## Checklist CHECKPOINTS.md

- [x] requirements.md con EARS numerados R1..R34 + Decisiones cerradas.
- [x] design.md con alternativas descartadas y su porque (estatus=en_preparacion y shadcn add select).
- [x] tasks.md con todas las tasks [x] y mapa R->test.
- [x] Cada R1..R34 mapea a un test concreto que ejerce el comportamiento (tabla abajo).
- [x] progress/impl contiene el mapa R->test.
- [x] pnpm run typecheck verde (0 errores).
- [x] pnpm run lint verde (0 errores).
- [x] pnpm test verde: 67 files / 572 tests.
- [x] Sin tabla/migracion nueva (R20): git status no muestra nada bajo db/.
- [x] Ningun secreto hardcodeado; multi-pais N/A.
- [x] Patron de capas: Server Action -> Service -> Repository. Interfaces en lib/interfaces/.
- [x] Mutaciones via Server Actions; lista de mensajeros por Server Action.

## Decisiones humanas CERRADAS — verificadas

1. POST-COMMIT (dec.1): los cambios (working tree) NO tocan route.ts de carga-masiva,
   BulkOrdenService, lib/parsers ni BulkUpload. Verificado por git status --porcelain. OK.
2. listarMensajeros estado=activo (R3): where rol.value=mensajero + estado=activo; test
   asserta where.estado y excluye inactivo. OK.
3. Autorizacion (R5/R11/R17): listar -> adminTienda/maestro/admin; resumen y asignar ->
   SOLO adminTienda (tienda=actor). Tests unauthenticated y forbidden. OK.
4. Lote por num_remision resultado=creada (R7): frontend deriva numRemisiones de filas
   resultado=creada (extractNumRemisionesCreadas); no filtra por estatus. OK.
5. Todo-o-nada (R14): countOrdenesDeTienda vs distinct(ordenIds); count<total -> forbidden
   sin persistir. updateMany agrupado por mensajeroId distinto (R15). Lista vacia = no-op (R18). OK.
6. Select sobre @base-ui/react/select (R32): components/ui/select.tsx compone primitivas reales
   de Base UI; rol combobox/listbox/option, teclado testeado. No Radix/shadcn. OK.
7. Sin migracion (R20): git status no muestra nada bajo db/. OK.
8. UI 2do paso del modal (R21): step upload->resumen; creadas>0 monta OrdenesCargaResumen;
   creadas=0 conserva feature 14; reset al cerrar. OK.

## Refactor toActionError (T3.1)

Extraido a lib/actions/_shared/to-action-error.ts IDENTICO al original (switch exhaustivo de
6 AppErrorCode, INTERNAL re-lanza, VALIDATION_ERROR mapea fieldErrors). ordenes.ts solo elimina
la copia local e importa el helper; sin cambio de comportamiento. Suite ordenes-action verde
sin debilitar asserts. OK.

## Tests modificados (solo amplian mocks)

auth-service, orden-service y bulk-orden-service test: +metodos nuevos de las interfaces
(listMensajeros / findResumenByNumRemisiones / asignarMensajeroSugerido / countOrdenesDeTienda),
exigidos por TS. Ningun assert previo eliminado/debilitado. OK.

## Tabla de trazabilidad R1..R34 -> test

| R | Test que lo ejerce |
|---|--------------------|
| R1 | user-repository.mensajeros + asignacion-mensajero-service (listar ok) |
| R2 | user-repository.mensajeros (where/select/orderBy) |
| R3 | user-repository.mensajeros (where.estado=activo, excluye inactivo) |
| R4 | mensajeros-action (noActor -> unauthenticated, 3 acciones) |
| R5 | asignacion-mensajero-service (roles autz ok; resto forbidden) |
| R6 | orden-repository.asignacion + asignacion-mensajero-service (resumen ok) |
| R7 | asignacion-mensajero-service + OrdenesCargaResumen + Button (extrae creada) |
| R8 | orden-repository.asignacion (where tiendaId+deletedAt:null) |
| R9 | orden-repository.asignacion (no expone deletedAt/passwordHash) |
| R10 | orden-repository.asignacion (unicidad num_remision) |
| R11 | asignacion-mensajero-service (resumen: solo adminTienda) |
| R12 | asignacion-mensajero-service (forma general via R15) |
| R13 | asignacion-mensajero-service (mensajeroId invalido -> validation_error) + mensajeros-action |
| R14 | asignacion-mensajero-service (count<distinct -> forbidden, sin persistir) |
| R15 | asignacion-mensajero-service (2 grupos -> 2 llamadas, args exactos, suma counts) |
| R16 | orden-repository.asignacion (updateMany where + count) |
| R17 | mensajeros-action (sin sesion/rol no autz -> unauthenticated/forbidden) |
| R18 | asignacion-mensajero-service (asignaciones vacio -> ok/0) + mensajeros-action |
| R19 | mensajeros-action (input invalido -> validation_error; toActionError) |
| R20 | revision de diff: nada bajo db/ |
| R21 | OrdenesCargaMasivaButton (creadas>0 monta / =0 intacto / reset al cerrar) |
| R22 | OrdenesCargaResumen (DataTable, fila por orden) |
| R23 | OrdenesCargaResumen (num_remision visible, rowKey=id) |
| R24 | OrdenesCargaResumen (select global) |
| R25 | OrdenesCargaResumen (global aplica a TODAS las filas) |
| R26 | OrdenesCargaResumen (override cambia solo su fila) |
| R27 | OrdenesCargaResumen (valor inicial = mensajeroSugeridoId) |
| R28 | OrdenesCargaResumen (confirmar -> asignar + toast.success) |
| R29 | OrdenesCargaResumen (status!=ok/excepcion -> toast.error) |
| R30 | OrdenesCargaResumen (boton disabled durante envio; anti doble-submit) |
| R31 | OrdenesCargaResumen (mensajeros por Server Action; disabled+alert+toast si falla) |
| R32 | Select.test (combobox accesible, abre lista, mouse+teclado, onValueChange) |
| R33 | OrdenesCargaResumen (mutate con matcher ordenes:list -> true) |
| R34 | revision de diff: no toca DataTable/Modal/useToast/BulkUpload |

## Calidad backend

- TypeScript strict verde; sin any injustificado (unico cast en toActionError sobre
  shape.details.fieldErrors, acotado a la frontera ya validada). Sin catch vacios.
- resumen y ResumenCargaOrdenDTO no exponen deletedAt/passwordHash/sesion (R9).
- Reutiliza withErrorHandler + toActionError + resolveActorFromSession (R19).
- Capas separadas; interfaces en lib/interfaces/.

## Verificacion ejecutable (corrida por el reviewer)

- pnpm run typecheck: 0 errores.
- pnpm run lint: 0 errores.
- pnpm run test: Test Files 67 passed (67), Tests 572 passed (572).
- todas las migraciones tienen down.sql; .env presente; init OK.
- Baseline dev 61/506 -> 67/572 (+6 files, +66 tests). Nada existente se rompio.

## Hallazgos

- menor — El boton Confirmar asignacion vive dentro de OrdenesCargaResumen en lugar de
  conectarse al onConfirm del Modal. No es incumplimiento: R30 se cumple con submitting/
  submittingRef y hay test. Mantiene el Modal como contenedor puro (paridad feature 14).
- menor — onDone se invoca tras exito pero el Button no lo conecta: el modal permanece
  abierto tras confirmar (paridad deliberada con feature 14, documentada). Sin impacto.
- menor — El test de R3 asserta where.estado=activo sobre Prisma mockeado (unit sin DB real);
  enfoque correcto para un mock y cubre RESUELTO-1. Sin accion.

Ningun hallazgo bloqueante.
