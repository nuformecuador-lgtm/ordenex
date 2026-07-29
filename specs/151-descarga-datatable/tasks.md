# Feature 151 — Descarga del dataset completo desde el DataTable · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas del
> mismo bloque. Cada task declara dependencias, criterio de HECHO y los `R<n>` que cubre.
> **Ninguna task arranca antes de la aprobación humana del spec (`spec_ready` → aprobado).**
>
> Cobertura obligatoria: R1–R38, todos mapeados a un test concreto (ver §Trazabilidad).

---

## Bloque 0 — Base tipada y configuración

### [x] T1 [P] — Tipos de la descarga
- Crear `lib/types/descarga.ts` con `DescargaTipo`, `DescargaCelda`, `DescargaColumna`,
  `DescargaFila`, `DescargaConfig`, `DescargaArchivo` (contrato de `design.md §3`).
- Sin dependencias de dominio, de React ni de Prisma.
- **Depende de:** —
- **Hecho:** `pnpm typecheck` verde; el módulo no importa nada de `lib/services`,
  `lib/actions`, `app/` ni `react`.

### [x] T2 [P] — Config del tope de filas
- Crear `lib/config/descarga.ts` con `MAX_FILAS` leído de `DESCARGA_MAX_FILAS`
  (default **5000**), patrón `readPositiveInt` de `lib/config/ordenes.ts`.
- Test: `tests/unit/config/descarga-config.test.ts`
  - «usa 5000 cuando no hay variable de entorno»
  - «toma el valor de DESCARGA_MAX_FILAS cuando es un entero positivo»
  - «ignora un valor no numérico o no positivo y cae al default»
- **Depende de:** —
- **Cubre:** R19
- **Hecho:** los 3 tests verdes; ningún literal `5000` fuera de este módulo.

---

## Bloque 1 — Función común de descarga (cliente, pura)

### [x] T3 — `buildCsvRows` en el módulo CSV existente
- Añadir `buildCsvRows(columns, rows)` a `lib/utils/csv-template.ts` reutilizando
  `escapeCsvValue`, `toCsvRow` y `ROW_DELIMITER` ya presentes. No tocar
  `buildCsvTemplate`.
- Test: ampliar `tests/unit/utils/csv-template.test.ts`
  - «emite una línea de cabecera y una línea por fila, en el orden recibido» (R4)
  - «escapa comas, comillas y saltos de línea dentro de una celda» (R4)
  - «ignora las claves de la fila que no están declaradas como columna» (R5)
  - «deja la celda vacía cuando la fila no aporta la clave» (R6)
  - «lanza si la lista de columnas está vacía» (R9)
- **Depende de:** T1
- **Cubre:** R4 (parcial R5, R6, R9 para la vía csv)
- **Hecho:** tests verdes y los tests previos de `buildCsvTemplate` intactos.

### [x] T4 — Despachador `construirDescarga`
- Crear `lib/utils/descarga-dataset.ts` con `construirDescarga(config, fecha?)` según
  `design.md §3`: default `xlsx`, delega en `buildXlsxRows` o `buildCsvRows`, devuelve
  `{ contenido, mime, nombreArchivo }`. Sin DOM ni React.
- Test: `tests/unit/utils/descarga-dataset.test.ts`
  - «genera xlsx cuando no se declara tipo de archivo» (R1, R2)
  - «produce un libro de una hoja con cabecera y una fila por elemento, en orden» (R3)
  - «produce texto csv con cabecera y una línea por elemento cuando el tipo es csv» (R4)
  - «emite solo las columnas declaradas y en su orden, ignorando claves extra» (R5)
  - «deja vacía la celda de una columna que la fila no aporta» (R6)
  - «devuelve el MIME y la extensión correspondientes al tipo» (R7)
  - «usa el título como nombre de hoja y como base del nombre de archivo» (R8)
  - «lanza si no hay columnas declaradas» (R9)
  - «se ejecuta sin DOM: el módulo no referencia document ni window» (R10)
- **Depende de:** T1, T3
- **Cubre:** R1, R2, R3, R5, R6, R7, R8, R9, R10
- **Hecho:** los 9 tests verdes; el módulo no importa `exceljs` de forma estática (el
  import dinámico sigue viviendo dentro de `buildXlsxRows`).

---

## Bloque 2 — Backend: dataset completo (puede ir en paralelo al Bloque 1)

### [x] T5 — Extraer `construirWhere` de `OrdenService.listar` (refactor sin cambio funcional)
- Mover el armado del `where` de `OrdenService.listar` (hoy inline, `OrdenService.ts:224-267`)
  a un método privado `construirWhere(input, actor)`; `listar` pasa a usarlo. Conservar el
  ORDEN de escritura: escalar heredado → filtros de la whitelist → rango temporal →
  acotamiento por rol AL FINAL.
- Test: `tests/unit/services/orden-service-filtros.test.ts` **sin modificar** debe seguir
  verde (es la red de seguridad del refactor).
- **Depende de:** —
- **Cubre:** — (habilitante de R12/R16/R17)
- **Hecho:** suite de filtros verde sin editar ni un test.

### [x] T6 — `listarCompleto` en el servicio y su interfaz
- Ampliar `lib/interfaces/services/IOrdenService.ts` con
  `ListarOrdenesCompletoServiceResult` y `listarCompleto(input, actor)`.
- Implementar en `lib/services/OrdenService.ts` según `design.md §4.1`: `construirWhere`,
  `repo.list({ where, sortBy, sortDir, skip: 0, take: MAX_FILAS + 1 })`, guard de tope,
  merge de `intentosEntrega` con `contarIntentosEnLote`.
- Test: `tests/unit/services/orden-service-descarga.test.ts`
  - «devuelve todas las filas del dataset sin recorte por página» (R11)
  - «acota el dataset del adminTienda a sus propias órdenes» (R12)
  - «acota el dataset del mensajero a las órdenes que tiene asignadas» (R12)
  - «devuelve forbidden y ninguna fila cuando el rol no es conocido» (R14)
  - «el filtro de tienda no amplía el alcance del adminTienda» (R16)
  - «pide al repositorio el mismo criterio de orden que el listado paginado» (R17)
  - «excluye las órdenes borradas igual que el listado» (R18)
  - «devuelve limite_excedido con total y límite, y sin filas, cuando el total supera el
    tope» (R20)
  - «nunca pide al repositorio más de N+1 filas» (R22)
  - «no devuelve un dataset truncado: o entrega todas las filas o el error de tope» (R21)
- **Depende de:** T2, T5
- **Cubre:** R11, R12, R14, R16, R17, R18, R20, R21, R22
- **Hecho:** los 10 tests verdes; el servicio no llama a `repo` fuera de `repo.list`.

### [x] T7 — Schema y Server Action del dataset completo
- `lib/types/orden.ts`: `listarOrdenesCompletoSchema` (= `listarOrdenesSchema` sin
  `page`/`pageSize`), `ListarOrdenesCompletoInput`, `ListarOrdenesCompletoResult`.
- `lib/actions/ordenes.ts`: `listarOrdenesCompleto(input, deps)` calcado de
  `listarOrdenes` (`withErrorHandler` → actor → `UnauthenticatedError` → `parse` →
  service → `toActionError`).
- Test: `tests/unit/actions/ordenes-descarga-action.test.ts`
  - «devuelve unauthenticated y ninguna fila cuando no hay sesión» (R13)
  - «devuelve validation_error y ninguna fila cuando llega una clave de filtro fuera de la
    lista blanca» (R15)
  - «propaga limite_excedido con total y límite tal como lo devuelve el servicio» (R20)
  - «propaga forbidden sin filas» (R14)
  - «entrega los items del servicio cuando todo va bien» (R11)
- **Depende de:** T6
- **Cubre:** R13, R15 (+ refuerzo R11, R14, R20)
- **Hecho:** los 5 tests verdes; ninguna fila viaja junto a un error.

---

## Bloque 3 — Enganche en el `DataTable`

### [x] T8 — Prop `descarga` + `DescargarDatasetButton`
- Crear `components/shared/DescargarDatasetButton.tsx` (cliente, sin dominio) con el flujo
  de `design.md §5`, y añadir la prop opt-in `descarga?: DataTableDescarga` a
  `components/shared/DataTable.tsx`.
- Test: `tests/components/DescargarDataset.test.tsx`
  - «sin la prop descarga la tabla no renderiza control de descarga» (R24)
  - «con la prop descarga renderiza el control con su nombre accesible» (R24, R30)
  - «al pulsar llama a obtenerFilas y entrega el archivo generado» (R25)
  - «mientras la descarga está en curso el control queda deshabilitado y en carga, y un
    segundo click no dispara una segunda obtención» (R26)
  - «muestra el mensaje accionable y no descarga archivo cuando obtenerFilas devuelve
    error» (R27)
  - «no descarga archivo y avisa cuando el dataset viene vacío» (R23)
  - «descarga en xlsx sin pedir elección cuando no se declaran formatos» (R28)
  - «ofrece elegir entre los formatos declarados cuando hay más de uno» (R28)
  - «la descarga no cambia la página, la selección ni las filas visibles» (R31)
  - «el archivo se entrega por el mecanismo de descarga del navegador, sin ninguna subida
    ni almacenamiento» (R32)
- **Depende de:** T1, T4
- **Cubre:** R23, R24, R25, R26, R27, R28, R30, R31, R32
- **Hecho:** los 10 tests verdes; `descargarBlob` mockeado y verificado en las
  aserciones de entrega.

### [x] T9 [P] — Guardia de «tabla sin dominio»
- Test: `tests/unit/components/datatable-descarga-contrato.test.ts`
  - «DataTable no importa acciones, tipos de dominio ni utilidades de filtros» (R29)
  - «la configuración de descarga solo expone título, columnas, obtenerFilas y formatos»
    (R29)
- **Depende de:** T8
- **Cubre:** R29
- **Hecho:** ambos tests verdes (lectura estática del módulo + comprobación de tipo).

---

## Bloque 4 — Primer consumidor: listado de órdenes

### [x] T10 — Columnas de export de órdenes
- Crear `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts` con
  `COLUMNAS_DESCARGA_ORDENES` y `filaDescargaOrden(orden)` (`design.md §7`). Módulo puro.
- Test: `tests/unit/components/ordenes-descarga-columnas.test.ts`
  - «proyecta cada orden a valores crudos: texto, número o celda vacía» (R35)
  - «no emite ningún ReactNode ni objeto en las celdas» (R35)
  - «resuelve zona, tienda, geografía y estado a su nombre legible, no a su id» (R35)
  - «no expone identificadores internos ni banderas de borrado» (R35)
- **Depende de:** T1
- **Cubre:** R35
- **Hecho:** los 4 tests verdes.

### [x] T11 — Cableado en `OrdenesModule` / `OrdenesListado`
- `OrdenesModule`: prop opt-in `permitirDescarga?: boolean` (default `false`) que construye
  la config `descarga` cerrando sobre su `filter` y llamando a `listarOrdenesCompleto`.
- `OrdenesListado`: pasa `permitirDescarga`.
- Test: `tests/components/OrdenesDescarga.test.tsx`
  - «el listado de órdenes ofrece la descarga del dataset completo» (R33)
  - «el archivo contiene una fila por orden del dataset completo, no solo la página
    visible» (R34)
  - «la descarga envía los filtros vigentes en el momento de descargar» (R36)
  - «el nombre del archivo identifica el listado y la fecha» (R37)
  - «muestra el error de tope, con total y límite, y no descarga archivo» (R20)
  - «un consumidor sin permitirDescarga no muestra el control» (R24)
- **Depende de:** T7, T8, T10
- **Cubre:** R33, R34, R36, R37 (+ refuerzo R20, R24)
- **Hecho:** los 6 tests verdes.

### [x] T12 — No regresión del listado paginado
- Test: `tests/components/OrdenesPage.test.tsx` y
  `tests/unit/components/ordenes-listado-filtros.test.tsx` **sin modificar** deben seguir
  verdes; añadir en `tests/components/OrdenesDescarga.test.tsx`:
  - «el listado paginado sigue pidiendo página y tamaño de página como antes cuando no se
    descarga» (R38)
- **Depende de:** T11
- **Cubre:** R38
- **Hecho:** suites previas verdes sin edición + el test nuevo verde.

---

## Bloque 5 — Cierre

### [x] T13 — Round-trip de integración
- Test: `tests/integration/descarga-dataset-roundtrip.test.ts`
  - «el xlsx generado a partir de filas del listado se relee con las mismas cabeceras y el
    mismo número de filas» (R3, R21)
  - «el csv generado se reparsea a las mismas celdas» (R4)
- **Depende de:** T4, T10
- **Cubre:** refuerzo R3, R4, R21
- **Hecho:** ambos tests verdes.

### [x] T14 — Verificación final y bitácora
- `./init.sh` verde, `pnpm typecheck` sin deltas nuevos, suite completa sin regresiones
  respecto al baseline medido AL INICIO de la implementación (no un baseline citado de
  otra sesión).
- Escribir `progress/impl_151.md` con la tabla `R<n> → archivo::nombre del test`.
- **Depende de:** T1–T13
- **Cubre:** trazabilidad (`docs/specs.md`)
- **Hecho:** `init.sh` verde, tabla completa sin huecos R1–R38.

---

## Trazabilidad R → task/test

| R | Task | Test |
| --- | --- | --- |
| R1 | T4 | `descarga-dataset.test.ts` :: genera xlsx cuando no se declara tipo |
| R2 | T4 | `descarga-dataset.test.ts` :: genera xlsx cuando no se declara tipo |
| R3 | T4, T13 | `descarga-dataset.test.ts` :: libro de una hoja / `descarga-dataset-roundtrip.test.ts` |
| R4 | T3, T4, T13 | `csv-template.test.ts` + `descarga-dataset.test.ts` :: tipo csv |
| R5 | T3, T4 | `descarga-dataset.test.ts` :: solo las columnas declaradas |
| R6 | T3, T4 | `descarga-dataset.test.ts` :: celda vacía |
| R7 | T4 | `descarga-dataset.test.ts` :: MIME y extensión |
| R8 | T4 | `descarga-dataset.test.ts` :: título como hoja y nombre |
| R9 | T3, T4 | `descarga-dataset.test.ts` :: lanza sin columnas |
| R10 | T4 | `descarga-dataset.test.ts` :: sin DOM |
| R11 | T6, T7 | `orden-service-descarga.test.ts` :: sin recorte por página |
| R12 | T6 | `orden-service-descarga.test.ts` :: adminTienda / mensajero |
| R13 | T7 | `ordenes-descarga-action.test.ts` :: unauthenticated sin filas |
| R14 | T6, T7 | `orden-service-descarga.test.ts` :: forbidden sin filas |
| R15 | T7 | `ordenes-descarga-action.test.ts` :: clave fuera de la lista blanca |
| R16 | T6 | `orden-service-descarga.test.ts` :: el filtro no amplía el alcance |
| R17 | T6 | `orden-service-descarga.test.ts` :: mismo criterio de orden |
| R18 | T6 | `orden-service-descarga.test.ts` :: excluye borradas |
| R19 | T2 | `descarga-config.test.ts` :: default 5000 / override / valor inválido |
| R20 | T6, T7, T11 | `orden-service-descarga.test.ts` :: limite_excedido |
| R21 | T6, T13 | `orden-service-descarga.test.ts` :: sin truncado silencioso |
| R22 | T6 | `orden-service-descarga.test.ts` :: nunca más de N+1 filas |
| R23 | T8 | `DescargarDataset.test.tsx` :: dataset vacío |
| R24 | T8, T11 | `DescargarDataset.test.tsx` :: sin prop no hay control |
| R25 | T8 | `DescargarDataset.test.tsx` :: llama a obtenerFilas y entrega |
| R26 | T8 | `DescargarDataset.test.tsx` :: estado de carga y sin reentrada |
| R27 | T8 | `DescargarDataset.test.tsx` :: error accionable sin archivo |
| R28 | T8 | `DescargarDataset.test.tsx` :: formatos |
| R29 | T9 | `datatable-descarga-contrato.test.ts` |
| R30 | T8 | `DescargarDataset.test.tsx` :: nombre accesible |
| R31 | T8 | `DescargarDataset.test.tsx` :: no altera página/selección/datos |
| R32 | T8 | `DescargarDataset.test.tsx` :: sin subida ni almacenamiento |
| R33 | T11 | `OrdenesDescarga.test.tsx` :: ofrece la descarga |
| R34 | T11 | `OrdenesDescarga.test.tsx` :: una fila por orden del dataset completo |
| R35 | T10 | `ordenes-descarga-columnas.test.ts` :: valores crudos |
| R36 | T11 | `OrdenesDescarga.test.tsx` :: filtros vigentes |
| R37 | T11 | `OrdenesDescarga.test.tsx` :: nombre del archivo |
| R38 | T12 | `OrdenesDescarga.test.tsx` :: listado paginado sin regresión |

## Orden de ejecución sugerido

```
T1, T2, T5           (paralelos)
  ├─ T3 → T4         (bloque cliente)
  ├─ T6 → T7         (bloque backend)
  └─ T10             (columnas de export)
T4 + T1  → T8 → T9
T7 + T8 + T10 → T11 → T12
T4 + T10 → T13
todo    → T14
```
