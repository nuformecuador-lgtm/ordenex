# Tasks — Feature 159: quitar la sugerencia de mensajeros de la carga masiva

> Zona `fullstack`: **backend → frontend**, en la **misma rama** y sin merge intermedio.
> ⚠️ La fase 1 deja el **typecheck global en rojo a propósito** (`design.md §8`): su
> criterio de "hecho" es su propia suite en verde, no el typecheck del repo entero.
> `[P]` = paralelizable con las demás `[P]` de su mismo bloque.

---

## Fase 0 — Puertas y censo (antes de tocar nada)

- [ ] **T0 — Cerrar Q1 (contrato público) en la puerta F1.4.**
  Decisión humana entre las opciones (a)/(b)/(c)/(d) de `design.md §4`; el spec
  recomienda **(b)**.
  *Hecho:* la decisión queda escrita en `progress/impl_159.md` con su fecha y autor.
  *Bloquea:* T14.
  *Nota:* Q2, Q3 y Q5 también deberían responderse aquí; si el humano no las toca, se
  aplica la recomendación del spec (Q2 → el resumen sobrevive; Q3 → no se borra
  `OrdenesCargaResumenPaso`; Q5 → se acepta la pérdida, declarada en el `down.sql`).

- [ ] **T1 [P] — Censo de arranque.**
  Grep de `mensajero_sugerido_id|mensajeroSugerido|MensajeroSugerido|asignarMensajeroSugerido|ESTADOS_MENSAJERO_SUGERIDO`
  sobre `app/`, `lib/`, `components/`, `hooks/`, `db/`, `docs/` y `tests/`.
  *Hecho:* la lista archivo:línea queda en `progress/impl_159.md` y **confirma o corrige**
  la tabla de `design.md §0`. Si aparece un archivo no listado, se añade allí antes de
  seguir.

- [ ] **T2 [P] — Verificar el estado de `GenerarGuiaModal.tsx` tras las features 153/154/156.**
  *Hecho:* en `progress/impl_159.md` queda el grep de `sugerid` sobre ese archivo y su
  test, con el veredicto: "ya limpio" (T23 se cerrará sin diff) o la lista exacta de lo
  que queda por retirar.

---

## Fase 1 — Backend

### Datos

- [ ] **T3 — `db/schema.prisma`: retirar las 4 declaraciones.**
  `Orden.mensajeroSugeridoId` (:466), `Orden.mensajeroSugerido` (:493),
  `@@index([mensajeroSugeridoId])` (:507), `Usuario.ordenesMensajeria` (:113).
  *Depende de:* T1. *Cubre:* R4.
  *Hecho:* `prisma validate` pasa, `prisma format` no produce diff y `prisma generate`
  regenera el cliente **sin** el campo (confirmado por un error de typecheck en los
  consumidores, no por inspección visual).

- [ ] **T4 — Migración de retiro.**
  Crear `db/migrations/<ts>_drop_orden_mensajero_sugerido/` con `migration.sql` (FK →
  índice → columna) y `down.sql` (orden inverso + **advertencia en cabecera** de que
  restituye estructura y no valores). SQL exacto en `design.md §1.2`.
  *Depende de:* T3. *Cubre:* R1, R2, R3.
  *Hecho:* `pnpm run db:migrate` aplica sin error sobre una base con órdenes que tienen
  `mensajero_sugerido_id` no nulo, y `\d orden` ya no muestra columna, índice ni FK.

- [ ] **T5 — Probar el rollback en entorno de prueba.**
  `pnpm run db:rollback` y volver a aplicar.
  *Depende de:* T4. *Cubre:* R2.
  *Hecho:* tras el rollback la columna, el índice y la FK vuelven con los mismos nombres
  y con `ON DELETE SET NULL ON UPDATE CASCADE`; re-aplicar la migración vuelve a
  dejarlos fuera. Salida real pegada en `progress/impl_159.md`.

- [ ] **T6 [P] — Test de la migración.**
  `tests/integration/db/drop-mensajero-sugerido-migration.test.ts`, modelado sobre los
  demás `*-migration.test.ts` de `tests/integration/db/`.
  *Depende de:* T4. *Cubre:* R1, R2, R3.
  *Hecho:* el test pasa y falla si se altera el orden de las sentencias en cualquiera de
  los dos archivos. `tests/integration/db/carga-masiva-schema.test.ts` **sigue verde sin
  tocarlo** (`design.md §0.3`).

### Servicios, repositorio y tipos

- [ ] **T7 — `lib/types/carga-masiva.ts`: borrar el campo del schema de fila.**
  Quitar `mensajero_sugerido_id` (:96-101). **No** convertir el `z.object` en `.strict()`.
  *Depende de:* T1. *Cubre:* R5, R6, R8.
  *Hecho:* `filaCargaSchema` no declara la clave y
  `tests/integration/carga-masiva-errores-roundtrip.test.ts` sigue verde.

- [ ] **T8 — `lib/services/BulkOrdenService.ts`: retirar `resolveMensajero` y su cableado.**
  `MensajeroResult` (:214-216), `resolveMensajero` (:218-228),
  `PreloadedContext.mensajerosValidos` (:235), el cálculo de `mensajeroIds` y la llamada
  a `findMensajerosByIds` en `precargar` (:564-566, :582-585 → `await` simple), la rama
  en `procesarFila` (:505-518) y `createData.mensajeroSugeridoId` (:554).
  *Depende de:* T7. *Cubre:* R5, R6, R7, R8.
  *Hecho:* 0 ocurrencias de `mensajero` en el archivo; los tests unit del service pasan
  **con el caso nuevo** "una fila con `mensajero_sugerido_id` arbitrario se crea igual y
  el repo de mensajeros no se consulta".

- [ ] **T9 — Repositorio de órdenes: retirar los 3 métodos huérfanos y el campo.**
  En `lib/interfaces/repositories/IOrdenRepository.ts` y
  `lib/repositories/OrdenRepository.ts`: `asignarMensajeroSugerido`,
  `countOrdenesDeTienda`, `findMensajerosByIds`, `CreateOrdenData.mensajeroSugeridoId`
  (:28), el `include`/mapeo del listado (:236, :324-325, :343), los `create` (:579,
  :1037) y la referencia cruzada del doc-comment de `findMensajeroIdsValidos` (:540).
  **`findResumenByNumRemisiones` se conserva**, sin los 2 campos de sugerido.
  *Depende de:* T3, T8. *Cubre:* R8, R20.
  *Hecho:* 0 ocurrencias en ambos archivos; `findMensajeroIdsValidos` y `findAllMensajeros`
  siguen existiendo intactos.

- [ ] **T10 — Tipos: renombrar y reubicar.**
  `lib/types/asignacion-mensajero.ts` → `lib/types/carga-masiva-resumen.ts` (sin
  `asignarMensajeroSchema`, sin `AsignarMensajeroInput`, `ResumenCargaOrdenDTO` sin los 2
  campos de sugerido). Crear `lib/types/mensajero.ts` con `MensajeroDTO` y reapuntar sus
  importadores (`IUserRepository`, `UserRepository`, `RankingService`).
  *Depende de:* T9. *Cubre:* R20.
  *Hecho:* `lib/types/asignacion-mensajero.ts` no existe; `RankingService` sigue
  compilando y su test sigue verde.

- [ ] **T11 — Servicio e interfaz: renombrar y podar.**
  `AsignacionMensajeroService` → `ResumenCargaMasivaService` (solo `resumenCargaMasiva`);
  `IAsignacionMensajeroService` → `IResumenCargaMasivaService`. Borrar `listarMensajeros`,
  `asignarMensajeroSugerido` y los tipos de resultado de ambos.
  *Depende de:* T10. *Cubre:* R19, R20.
  *Hecho:* los archivos con el nombre viejo no existen; el servicio nuevo expone **un
  solo** método público.

- [ ] **T12 — Server Action: `lib/actions/mensajeros.ts` → `lib/actions/carga-masiva-resumen.ts`.**
  Conserva solo `resumenCargaMasiva` con su `deps` inyectable.
  *Depende de:* T11. *Cubre:* R19.
  *Hecho:* 0 exports de `listarMensajeros` y `asignarMensajeroSugerido` en `lib/actions/`;
  `lib/actions/mensajeros.ts` no existe.

- [ ] **T13 — `lib/types/orden.ts`: podar el DTO del listado.**
  `OrdenListItemDTO.mensajeroSugeridoId` (:152), `OrdenListItemRelaciones.mensajeroSugerido`
  (:208) y los comentarios :138-143.
  *Depende de:* T9. *Cubre:* R16, R18.
  *Hecho:* 0 ocurrencias en el archivo. (A partir de aquí la UI **no compila** hasta la
  fase 2; es lo esperado.)

- [ ] **T14 [P] — OpenAPI conforme a la decisión de Q1.**
  `lib/api/openapi-spec.ts:479-482` (fuente de verdad) y `docs/api/api-key-openapi.yaml:507-509`
  (espejo). Con la recomendación (b): `deprecated: true` + descripción "aceptado e
  ignorado por el servidor".
  *Depende de:* T0. *Cubre:* R10, R11.
  *Hecho:* un test compara la propiedad en ambos artefactos y pasa; el yaml y el objeto
  TS dicen lo mismo.

- [ ] **T15 [P] — Comentarios que citan símbolos que dejan de existir.**
  `lib/interfaces/services/IAsignabilidadCoordenadasService.ts:6-9` (cita
  `asignarMensajeroSugerido`) y `lib/interfaces/services/IUsuariosPorRolService.ts:6`
  (cita `IAsignacionMensajeroService`). **Solo comentarios: el gate NO se retira.**
  *Depende de:* T11. *Cubre:* R21.
  *Hecho:* ningún comentario del repo cita un símbolo inexistente; los tests del gate de
  asignabilidad y de los dos caminos de asignación siguen verdes **sin tocarlos**.

- [ ] **T16 — Adaptar los tests de backend.**
  Según la tabla de `design.md §7`: renombrar y podar
  `asignacion-mensajero-service.test.ts` → `resumen-carga-masiva-service.test.ts` y
  `mensajeros-action.test.ts` → `carga-masiva-resumen-action.test.ts`; podar
  `orden-repository.asignacion.test.ts`, `orden-repository.bulk.test.ts`,
  `orden-repository.test.ts`, `bulk-orden-service.test.ts`,
  `bulk-orden-service.carga-api.test.ts`; ajuste mecánico de fixtures en
  `orden-geocode-enqueue`, `orden-historial-cobertura`, `etiqueta-guia-service`,
  `guia-asignacion-service`, `orden-service`, `rol-admin-satelite-authz`. Añadir el caso
  de R9 (mismo `RowResult` con y sin la clave, vía API key).
  *Depende de:* T7–T14. *Cubre:* R5, R6, R7, R9, R22(d)(g).
  *Hecho:* ningún `describe` queda vacío, ningún test borrado se llevó un assert de otra
  feature, y `pnpm test tests/unit tests/integration` pasa.

**Cierre de fase 1:** los tests de `tests/unit/` y `tests/integration/` pasan. El
typecheck global sigue en rojo por la UI; se documenta y se continúa.

---

## Fase 2 — Frontend

- [ ] **T17 — `carga-masiva-chunks.ts`: borrar `aplicarMensajero`.**
  La función (:46-54), `ProcesarChunksOpts.mensajeroSugeridoId` (:59) y el `map` de :88.
  *Depende de:* fase 1. *Cubre:* R13, R18, R22(a)(b)(c).
  *Hecho:* `procesarEnChunks` envía `lote.map((f) => f.row)`; los 3 tests de chunking,
  dedup, remapeo y `ChunkRequestError` siguen verdes tras quitarles la opción.

- [ ] **T18 [P] — `OrdenesCargaUpload.tsx`: quitar `mensajeroSugeridoId: ""` del dry-run (:131).**
  *Depende de:* T17. *Cubre:* R18.
  *Hecho:* la llamada del dry-run ya no pasa la opción y el test de subida sigue verde.

- [ ] **T19 — `OrdenesCargaResumen.tsx`: dejarlo en solo lectura.**
  Retirar lo listado en `design.md §5.1`, incluido el `Math.random` de `seleccionInicial`,
  el botón "Sugerir asignación", el `mutate` de SWR y la prop `onDone`.
  *Depende de:* T12. *Cubre:* R12, R13, R14.
  *Hecho:* el componente no importa nada de mensajeros, la tabla no tiene columna de
  mensajero y no hay ningún `<Select>` ni `<Button>` de acción en el render.

- [ ] **T20 — `OrdenesCargaMasivaButton.tsx`: el 3er paso pasa a ser "Resultado".**
  `Step` `"asignacion"` → `"resultado"`, etiqueta e `PASO_DESCRIPCION`, `setStep` (:192)
  y el render (:250-255) sin `onDone`.
  *Depende de:* T19. *Cubre:* R15.
  *Hecho:* el indicador de pasos no menciona "mensajero" en ninguna de sus 3 etiquetas ni
  descripciones, y el modal sigue cerrándose con su botón "Cerrar".

- [ ] **T21 [P] — `OrdenesCargaResumenPaso.tsx`: quitar la prop `onDone`.**
  Solo si Q3 se resuelve como "no se borra" (recomendación del spec).
  *Depende de:* T19. *Cubre:* R12.
  *Hecho:* compila y `OrdenesCargaResumenPaso.test.tsx` + `ManifiestoFlujos.test.tsx`
  pasan — R22(f).

- [ ] **T22 [P] — `ordenes-columns.tsx`: una sola columna "Mensajero".**
  Borrar `mensajeroSugeridoColumn` (:184-189) y `ordenesColumnsMensajeroSugerido`
  (:197-200); la columna `mensajero` queda en el asignado con fallback a `SIN_DATO`.
  *Depende de:* T13. *Cubre:* R16, R17, R18.
  *Hecho:* el archivo no exporta la variante y un test cubre las dos ramas (con y sin
  mensajero asignado).

- [ ] **T23 — `OrdenesListado.tsx`: borrar `ESTADOS_MENSAJERO_SUGERIDO`.**
  El `Set` (:69-71), el import (:23) y su rama del `if` (:353-358), que colapsa al
  ternario de `reprogramada`.
  *Depende de:* T22. *Cubre:* R16, R18.
  *Hecho:* filtrar por un único estado ya no cambia el juego de columnas salvo en
  `reprogramada`; los tests de listado pasan.

- [ ] **T24 — `GenerarGuiaModal.tsx`: cerrar lo que la 156 haya dejado.**
  Según el veredicto de T2: `seleccionInicial` (:39-46), `conSugerido`/`sinSugerido`
  (:130-131) y los bloques "Con/Sin mensajero sugerido" (:249-270).
  *Depende de:* T2, T13. *Cubre:* R13, R18, R22(e).
  *Hecho:* 0 ocurrencias de `sugerid` en el archivo. Si la 156 ya lo dejó limpio, la task
  se cierra **"sin diff" con la evidencia de grep pegada**, nunca por suposición.

- [ ] **T25 — Adaptar los tests de componentes.**
  `OrdenesCargaResumen.test.tsx`, `CargaMasivaChunks.test.ts`, `GenerarGuiaModal.test.tsx`
  y el ajuste mecánico de `OrdenesApartado`, `OrdenesListadoBloqueoCierre`,
  `OrdenesListadoEtiquetasChain`, `OrdenesRevisionMaestro` (`design.md §7`).
  *Depende de:* T17–T24. *Cubre:* R12, R13, R14, R22(a)(b)(c)(e)(f).
  *Hecho:* `pnpm test tests/components` pasa; ningún archivo perdió un assert ajeno a la
  sugerencia.

---

## Fase 3 — Cierre

- [ ] **T26 — Guard de no-reintroducción.**
  `tests/unit/guards/sin-mensajero-sugerido.test.ts`, modelado sobre
  `tests/unit/guards/no-embalaje.test.ts` (copiar su `IGNORED_DIRS`, incluido `.claude`).
  Ámbito: `app/`, `lib/`, `components/`, `hooks/`, `db/schema.prisma`. Whitelist mínima:
  los 2 artefactos de OpenAPI si Q1 → opción (b).
  *Depende de:* T25. *Cubre:* R14, R18.
  *Hecho:* pasa; y se demuestra que **falla** reintroduciendo a mano una línea con
  `mensajeroSugeridoId` (evidencia pegada en `progress/impl_159.md`, línea revertida
  después).

- [ ] **T27 — Verificación completa.**
  `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `./init.sh`.
  *Depende de:* T26. *Cubre:* todos.
  *Hecho:* los cuatro en verde, con la salida real pegada en `progress/impl_159.md`.
  Este es el primer punto del trabajo en que el typecheck global debe estar verde.

- [ ] **T28 — Mapa de trazabilidad `R<n> → test`.**
  Los 22 requisitos, cada uno con el archivo y el nombre del test que lo cubre.
  *Depende de:* T27.
  *Hecho:* `progress/impl_159.md` contiene la tabla completa, sin ningún `R<n>` sin test.
