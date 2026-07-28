# Feature 148 — Manifiesto Excel al crear o mover órdenes · tasks

Convenciones: `[P]` = paralelizable con las tareas marcadas igual dentro de la misma fase.
Cada tarea declara **Archivos**, **Hecho cuando** y los **R** que satisface o verifica.
Un commit por tarea (`feat(148): …` / `test(148): …`).

> Precondición del gate F1.4: `design.md §9` respondido. Las tareas T5, T9, T10 y T14
> dependen de esas respuestas (marcadas con ⚠).

---

## Fase 0 — Contratos (sin lógica)

- [ ] **T1 [P]** — Tipos y schemas del manifiesto.
  - Archivos: `lib/types/manifiesto.ts` (N).
  - Contenido: `ManifiestoFlujo`, `ManifiestoFilaDTO` (11 campos en el orden de R2),
    `ManifiestoOmitidaDTO`, `manifiestoSchema` (unión discriminada `ordenIds` /
    `numRemisiones`), `ManifiestoResult`.
  - Hecho cuando: `pnpm typecheck` verde y el tipo `ManifiestoFilaDTO` tiene exactamente 11
    propiedades.
  - R: R2, R30.

- [ ] **T2 [P]** — Contrato del servicio único.
  - Archivos: `lib/interfaces/services/IManifiestoService.ts` (N).
  - Contenido: `armar(input, actor): Promise<ManifiestoServiceResult>`.
  - Hecho cuando: typecheck verde; ninguna dependencia de HTTP ni Prisma en el archivo.
  - R: R1.

- [ ] **T3 [P]** — Contrato de repositorio (aditivo).
  - Archivos: `lib/interfaces/repositories/IOrdenRepository.ts` (M).
  - Contenido: `ManifiestoOrdenRow` + `findManifiestoByIds` + `findManifiestoByRemisiones`
    (documentando `deletedAt: null` y `[]` con entrada vacía).
  - Hecho cuando: typecheck verde; ninguna firma existente modificada.
  - R: R4, R6, R7, R12, R29.

## Fase 1 — Datos

- [ ] **T4** — Implementación de repositorio. *(dep: T3)*
  - Archivos: `lib/repositories/OrdenRepository.ts` (M): `WITH_MANIFIESTO` (patrón
    `WITH_ETIQUETA`, `OrdenRepository.ts:408`) + serializador `Decimal -> number` +
    `mensajeroAsignado.nombre` + `zona.esCentral`.
  - Hecho cuando: los dos métodos devuelven `ManifiestoOrdenRow[]`, excluyen borradas y no
    seleccionan `deletedAt` ni campos internos.
  - R: R4, R6, R7, R11, R12.

- [ ] **T5 ⚠** — Servicio único `ManifiestoService`. *(dep: T1, T2, T3; §9.2–§9.5, §9.8)*
  - Archivos: `lib/services/ManifiestoService.ts` (N).
  - Contenido: `armar()` = leer filas (por ids o por remisiones) → mapear a
    `ManifiestoFilaDTO` aplicando la tabla `origen`/`destino`/`responsable` de `design.md §4`
    → `fecha` con `fechaCalendarioCR()` → omitidas para las no encontradas. Filtro por dueño
    cuando `actor.rol === "apiKey"` (patrón `EtiquetaGuiaService.esVisiblePara`).
  - Hecho cuando: el service no importa Prisma ni `next/headers` y se instancia con dobles.
  - R: R1, R3, R5, R6, R7, R8, R9, R10, R11, R12, R24, R29.

- [ ] **T6** — Server Action de lectura. *(dep: T5)*
  - Archivos: `lib/actions/manifiesto.ts` (N), patrón `lib/actions/etiquetas-guia.ts`.
  - Contenido: `'use server'`, `withErrorHandler`, actor por `resolveActorFromSession`
    (sin sesión → `unauthenticated` ANTES de tocar el service), `manifiestoSchema.parse`,
    `deps` inyectables para test.
  - Hecho cuando: la action no muta nada y devuelve `ManifiestoResult` tipado.
  - R: R24, R28, R30.

## Fase 2 — Generación del archivo (cliente)

- [ ] **T7** — `buildXlsxRows` + `XLSX_MIME` en el generador existente. *(sin deps)*
  - Archivos: `lib/utils/xlsx-template.ts` (M); `components/shared/BulkUpload.tsx` (M: usa
    el `XLSX_MIME` exportado en vez de su constante local `:102`).
  - Reglas: `exceljs` con **import dinámico DENTRO de la función**; cabecera en negrita;
    anchos por contenido; lanza con `columns` vacío.
  - ⚠ Conflicto previsible con la feature 143 (`design.md §5`): si la 143 ya está en `dev`,
    REUSAR su `buildXlsxRows`/`XLSX_MIME` y no duplicar.
  - Hecho cuando: `buildXlsxTemplate` sigue intacto y los tests de `BulkUpload` siguen verdes.
  - R: R13.

- [ ] **T8 [P]** — Módulo puro del manifiesto. *(dep: T1, T7)*
  - Archivos: `lib/utils/manifiesto-xlsx.ts` (N): `COLUMNAS_MANIFIESTO` (11, en orden),
    `buildManifiestoXlsx(filas)`, `manifiestoFileName(flujo, fecha)`.
  - Hecho cuando: sin DOM, sin React; lanza si `filas` está vacío (R17, contrato defensivo).
  - R: R2, R13, R14, R17.

- [ ] **T9 ⚠ [P]** — Helper de descarga + botón compartido. *(dep: T1, T6, T8; §9.7)*
  - Archivos: `components/shared/descargar-blob.ts` (N, Blob + anchor + `revokeObjectURL`,
    patrón `BulkUpload.tsx:209-217`); `components/shared/DescargarManifiestoButton.tsx` (N).
  - Contenido del botón: props `{ flujo, seleccion }`; llama `obtenerManifiesto`, arma y
    descarga; deshabilitado mientras genera; toast de error sin cerrar el flujo; no se
    renderiza si la selección está vacía.
  - Hecho cuando: un solo componente sirve a los 6 puntos de UI.
  - R: R15, R16, R17, R26.

## Fase 3 — Enganche en los 5 flujos *(dep: T9; todas [P] entre sí)*

- [ ] **T10 ⚠ [P]** — Carga masiva. Archivos:
  `app/(app)/ordenes/_components/OrdenesCargaResumenPaso.tsx` (M): botón con
  `numRemisionesNuevas`. Hecho cuando: aparece solo si `nuevasCount > 0`. R: R18, R17.
- [ ] **T11 [P]** — Generar guía + asignar desde bodega. Archivos:
  `app/(app)/ordenes/_components/GenerarGuiaModal.tsx`, `AsignarBodegaModal.tsx` (M): fase
  "resultado" con los `ordenId` del resultado. Hecho cuando: la llamada de negocio y su toast
  quedan idénticos. R: R19, R25, R27.
- [ ] **T12 [P]** — Ruteo a satélite (maestro) y asignación satélite. Archivos:
  `app/(app)/ordenes/_components/RutearSateliteModal.tsx`,
  `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` (M). R: R20, R21, R27.
- [ ] **T13 [P]** — Envío de devolución a central. Archivos:
  `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` (M): acumula los ids
  con `status === "ok"` del loop y ofrece la descarga. R: R22, R25.
- [ ] **T14 ⚠ [P]** — Envío a la tienda. Archivos:
  `app/(app)/ordenes/_components/DevolverATiendaModal.tsx` (M): ids con `status === "ok"`.
  Depende de la respuesta a `design.md §9.1`. R: R23, R25.

## Fase 4 — Tests (mapa de trazabilidad R → test)

- [ ] **T15 [P]** — Unit del servicio único. Archivo:
  `tests/unit/services/manifiesto-service.test.ts` (N).
  | R | Test |
  |---|---|
  | R1 | "arma las filas de los 6 flujos con el mismo servicio" |
  | R3 | "devuelve una fila por orden y en el orden recibido" |
  | R5 | "deja num_guia vacío cuando la orden aún no tiene guía" |
  | R6 | "usa el nombre de la zona, no su id" |
  | R7 | "deja monto vacío cuando la orden no tiene monto de cobro" |
  | R8 | "resuelve origen/destino por flujo según la tabla" (un caso por fila de la tabla) |
  | R9 | "responsable es el mensajero asignado cuando el flujo asigna mensajero" / "es el actor cuando no" |
  | R10 | "fecha es la fecha calendario CR de la operación" |
  | R11 | "no expone ids internos ni campos fuera de las 11 columnas" |
  | R12 | "omite las órdenes inexistentes o borradas y no aborta el lote" |
  | R24 | "no invoca ningún método de escritura del repositorio" |
  | R29 | "con actor apiKey solo incluye órdenes de su tienda" |

- [ ] **T16 [P]** — Unit del repositorio. Archivo:
  `tests/unit/repositories/orden-repository.manifiesto.test.ts` (N).
  | R | Test |
  |---|---|
  | R4 | "proyecta guía, remisión, destinatario, teléfono y dirección de la orden" |
  | R12 | "excluye las órdenes borradas" |
  | R29 | "acota por tienda al buscar por num_remision" |

- [ ] **T17 [P]** — Unit del generador XLSX. Archivo:
  `tests/unit/utils/manifiesto-xlsx.test.ts` (N).
  | R | Test |
  |---|---|
  | R2 | "la cabecera trae las 11 columnas en el orden pedido" |
  | R13 | "produce un binario XLSX recargable con una sola hoja" |
  | R14 | "nombra el archivo manifiesto-<flujo>-<fecha>.xlsx" |
  | R17 | "lanza si no hay filas" |

- [ ] **T18 [P]** — Integración de la Server Action. Archivo:
  `tests/integration/actions/manifiesto-action.test.ts` (N).
  | R | Test |
  |---|---|
  | R28 | "devuelve unauthenticated y no consulta el service sin sesión" |
  | R30 | "devuelve validation_error con selección vacía / flujo desconocido" |
  | R24 | "no ejecuta ninguna mutación" |

- [ ] **T19 [P]** — Componentes: botón compartido. Archivo:
  `tests/components/DescargarManifiestoButton.test.tsx` (N).
  | R | Test |
  |---|---|
  | R15 | "arma el blob en el navegador y dispara la descarga sin llamar a ninguna API de subida" |
  | R16 | "queda deshabilitado mientras genera y no dispara dos veces" |
  | R17 | "no ofrece la descarga con selección vacía" |
  | R26 | "muestra un mensaje accionable si la action falla" |

- [ ] **T20 [P]** — Componentes: los 5 flujos. Archivos:
  `tests/components/ManifiestoFlujos.test.tsx` (N) + ajustes a los tests existentes de los
  modales tocados.
  | R | Test |
  |---|---|
  | R18 | "tras la carga masiva ofrece el manifiesto de las remisiones creadas" |
  | R19 | "tras generar guía / asignar desde bodega ofrece el manifiesto del lote" |
  | R20 | "tras rutear a satélite ofrece el manifiesto del lote" |
  | R21 | "tras asignar desde la bodega satélite ofrece el manifiesto del lote" |
  | R22 | "tras enviar a central ofrece el manifiesto solo de las enviadas con éxito" |
  | R23 | "tras enviar a la tienda ofrece el manifiesto solo de las enviadas con éxito" |
  | R25 | "un fallo de la descarga no re-ejecuta la acción de negocio ni revierte el resultado" |
  | R27 | "la llamada a la acción de negocio conserva su input y su manejo de resultado" |

- [ ] **T21** — Regresión del generador compartido. *(dep: T7)*
  - Archivo: `tests/components/BulkUpload.test.tsx` (M mínimo) + `tests/unit/utils/xlsx-template.test.ts` si existe.
  - Hecho cuando: la descarga de plantilla sigue produciendo el mismo MIME y binario.
  - R: R13 (no regresión).

## Fase 5 — Cierre

- [ ] **T22** — Verificación ejecutable. *(dep: todas)*
  - `./init.sh` verde, `pnpm typecheck`, `pnpm lint`, suite completa sin regresión respecto
    al baseline medido en el momento (no al citado en `progress/current.md`).
  - Mapa R1..R30 → test documentado en `progress/impl_148-manifiesto-excel-lotes.md`.
  - Hecho cuando: los 30 requisitos aparecen en el mapa con al menos un test verde.

---

## Archivos tocados (resumen)

**Nuevos:** `lib/types/manifiesto.ts`, `lib/interfaces/services/IManifiestoService.ts`,
`lib/services/ManifiestoService.ts`, `lib/actions/manifiesto.ts`,
`lib/utils/manifiesto-xlsx.ts`, `components/shared/descargar-blob.ts`,
`components/shared/DescargarManifiestoButton.tsx` + 6 archivos de test.

**Modificados:** `lib/interfaces/repositories/IOrdenRepository.ts`,
`lib/repositories/OrdenRepository.ts`, `lib/utils/xlsx-template.ts` (⚠ conflicto 143),
`components/shared/BulkUpload.tsx`, `OrdenesCargaResumenPaso.tsx`, `GenerarGuiaModal.tsx`,
`AsignarBodegaModal.tsx`, `RutearSateliteModal.tsx`, `AsignarSateliteModal.tsx`,
`RecepcionSateliteModule.tsx`, `DevolverATiendaModal.tsx`.

**NO se tocan:** `BulkOrdenService`, `GuiaAsignacionService`, `AsignacionSateliteService`,
`EnvioDevolucionCentralService`, `DevolucionOrigenService`, `db/schema.prisma`,
`db/migrations/**` (D3: sin migración).
