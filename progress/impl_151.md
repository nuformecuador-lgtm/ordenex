# Bitácora de implementación — Feature 151 · Descarga del dataset completo desde el DataTable

- **Rama / worktree:** `feature/151-descarga-datatable` en `C:\Users\Cristian\Documents\trabajo\arc\ordenex-151`
- **Base:** `origin/dev` @ `613561b`
- **Spec:** `specs/151-descarga-datatable/` (gate F1.4 aprobado por el humano el 2026-07-29)
- **Tasks:** T1–T14 completadas (marcadas `[x]` en `tasks.md`)

## Decisiones del gate respetadas

- **P1** — Tope `N = 5000`, configurable por `DESCARGA_MAX_FILAS`. Al superarlo NO se genera archivo: error accionable con total y tope. Nunca truncado silencioso.
- **P2** — La Server Action devuelve el DTO completo del listado (`OrdenListItemDTO`), sin proyección server-side.
- **P3** — Ratificado: no viaja binario y NO se abrió route handler interno. El servidor devuelve filas por Server Action; el binario se arma en el navegador.
- **P4** — El control de descarga va encima de la tabla, dentro de `components/shared/DataTable.tsx`.
- **P5** — Sin permiso nuevo: el acotamiento por rol/zona lo impone el mismo service que lista.

## Archivos creados

| Ruta | Qué es |
| --- | --- |
| `lib/types/descarga.ts` | Contrato de la descarga (`DescargaTipo`, `DescargaCelda`, `DescargaColumna`, `DescargaFila`, `DescargaConfig`, `DescargaArchivo`). Sin React, sin dominio. |
| `lib/config/descarga.ts` | `descargaConfig.MAX_FILAS` = `DESCARGA_MAX_FILAS` ?? 5000 (patrón `readPositiveInt` de `lib/config/ordenes.ts`). Único literal `5000` del repo. |
| `lib/utils/descarga-dataset.ts` | Despachador delgado `construirDescarga(config, fecha?)`: default `xlsx`, delega en `buildXlsxRows` / `buildCsvRows`, devuelve `{contenido, mime, nombreArchivo}`. Sin DOM ni React. |
| `components/shared/DescargarDatasetButton.tsx` | Control genérico sin dominio: guard de reentrada, loading/disabled, toast accionable, import dinámico del despachador, `descargarBlob`. |
| `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts` | `COLUMNAS_DESCARGA_ORDENES` (15 columnas enumeradas a mano) y `filaDescargaOrden` (valores crudos). Módulo puro. |
| `tests/unit/config/descarga-config.test.ts` | 3 tests |
| `tests/unit/utils/descarga-dataset.test.ts` | 9 tests |
| `tests/unit/services/orden-service-descarga.test.ts` | 10 tests |
| `tests/unit/actions/ordenes-descarga-action.test.ts` | 5 tests |
| `tests/unit/components/ordenes-descarga-columnas.test.ts` | 4 tests |
| `tests/unit/components/datatable-descarga-contrato.test.ts` | 2 tests |
| `tests/components/DescargarDataset.test.tsx` | 10 tests |
| `tests/components/OrdenesDescarga.test.tsx` | 7 tests |
| `tests/integration/descarga-dataset-roundtrip.test.ts` | 2 tests |

## Archivos modificados

| Ruta | Cambio |
| --- | --- |
| `lib/utils/csv-template.ts` | `buildCsvRows(columns, rows)` como HERMANO de `buildCsvTemplate`, reusando `escapeCsvValue` / `toCsvRow` / `ROW_DELIMITER`. `buildCsvTemplate` intacto. |
| `lib/services/OrdenService.ts` | T5: `where` de `listar` extraído a `construirWhere(input, actor)` conservando el orden de escritura (escalar, whitelist, rango temporal, acotamiento por rol AL FINAL). T6: `listarCompleto` con `skip: 0`, `take: MAX_FILAS + 1`, guard de tope antes de tocar historial y el mismo merge de `intentosEntrega`. |
| `lib/interfaces/services/IOrdenService.ts` | `ListarOrdenesCompletoServiceResult` + `listarCompleto`. |
| `lib/types/orden.ts` | `listarOrdenesCompletoSchema = listarOrdenesSchema.omit({page, pageSize})`, `ListarOrdenesCompletoInput`, `ListarOrdenesCompletoResult`. |
| `lib/actions/ordenes.ts` | `listarOrdenesCompleto(input, deps)` calcado de `listarOrdenes`. |
| `components/shared/DataTable.tsx` | Prop opt-in `descarga?: DataTableDescarga` + tipos `DescargaFilasResult` / `DataTableDescarga`. Sin la prop: cero cambios de render. |
| `app/(app)/ordenes/_components/OrdenesModule.tsx` | Prop opt-in `permitirDescarga?: boolean` (default `false`) que construye la config `descarga` cerrando sobre el `filter` vigente. |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | Pasa `permitirDescarga` a `OrdenesModule`. |
| `tests/integration/actions/ordenes-action.test.ts` | Única edición forzada: su `fakeService()` construye un `IOrdenService` completo; se añadió la entrada `listarCompleto` al doble. Ninguna aserción cambió. |
| `specs/151-descarga-datatable/tasks.md` | T1–T14 marcadas `[x]`. |

**Sin migración Prisma, sin cambios de RLS, sin modelo de datos nuevo** (design §2): el dataset completo es el mismo conjunto de filas que el actor ya podía leer paginado.

## Invariantes de diseño verificados

1. El generador es una función común ciega al dominio: `lib/utils/descarga-dataset.ts` solo importa `lib/types/descarga`, `lib/utils/csv-template` y `lib/utils/xlsx-template`. Se reusaron `buildXlsxRows`, `XLSX_MIME` y `descargarBlob` sin reescribirlos.
2. El acceso sin paginación pasa por `OrdenService`, que comparte literalmente `construirWhere` con `listar`: mismo acotamiento por rol escrito al final. No se añadió ningún método al repositorio.
3. `DataTable` recibe una FUNCIÓN (`obtenerFilas`), nunca una url ni filtros. `datatable-descarga-contrato.test.ts` lo custodia estáticamente.
4. Las columnas de export se declaran aparte, con valor crudo; no se reusa `Column<T>`.
5. Alcance cerrado: capacidad + primer consumidor. El rollout a las ~30 tablas restantes queda en la feature 145.

## Verificación ejecutada (medida en este worktree, 2026-07-29)

| Comando | Baseline (`613561b`) | Resultado |
| --- | --- | --- |
| `pnpm run typecheck` | 0 errores | **0 errores** |
| `pnpm run lint` | 0 errores / 10 warnings preexistentes | **0 errores / 10 warnings** (mismos) |
| `pnpm run test` | 569 archivos / 6218 tests / 0 fallos | **578 archivos / 6275 tests / 0 fallos** |
| `./init.sh` | — | **`== init OK ==`** (lint, test, down.sql de migraciones, `.env`) |

Delta exacto: **+9 archivos de test, +57 tests**, que es justo la suma de los tests nuevos declarados arriba (52 en archivos nuevos + 5 añadidos a `csv-template.test.ts`). Cero fallos, cero regresiones. El flake conocido de `tests/unit/guards/no-embalaje.test.ts` no se manifestó.

## Trazabilidad R -> test (R1–R38, sin huecos)

| R | Archivo :: test |
| --- | --- |
| R1 | `tests/unit/utils/descarga-dataset.test.ts` :: genera xlsx cuando no se declara tipo de archivo |
| R2 | `tests/unit/utils/descarga-dataset.test.ts` :: genera xlsx cuando no se declara tipo de archivo |
| R3 | `tests/unit/utils/descarga-dataset.test.ts` :: produce un libro de una hoja con cabecera y una fila por elemento, en orden — `tests/integration/descarga-dataset-roundtrip.test.ts` :: el xlsx generado a partir de filas del listado se relee con las mismas cabeceras y el mismo número de filas |
| R4 | `tests/unit/utils/descarga-dataset.test.ts` :: produce texto csv con cabecera y una línea por elemento cuando el tipo es csv — `tests/unit/utils/csv-template.test.ts` :: emite una línea de cabecera y una línea por fila, en el orden recibido / escapa comas, comillas y saltos de línea dentro de una celda — `tests/integration/descarga-dataset-roundtrip.test.ts` :: el csv generado se reparsea a las mismas celdas |
| R5 | `tests/unit/utils/descarga-dataset.test.ts` :: emite solo las columnas declaradas y en su orden, ignorando claves extra — `tests/unit/utils/csv-template.test.ts` :: ignora las claves de la fila que no están declaradas como columna |
| R6 | `tests/unit/utils/descarga-dataset.test.ts` :: deja vacía la celda de una columna que la fila no aporta — `tests/unit/utils/csv-template.test.ts` :: deja la celda vacía cuando la fila no aporta la clave |
| R7 | `tests/unit/utils/descarga-dataset.test.ts` :: devuelve el MIME y la extensión correspondientes al tipo |
| R8 | `tests/unit/utils/descarga-dataset.test.ts` :: usa el título como nombre de hoja y como base del nombre de archivo |
| R9 | `tests/unit/utils/descarga-dataset.test.ts` :: lanza si no hay columnas declaradas — `tests/unit/utils/csv-template.test.ts` :: lanza si la lista de columnas está vacía |
| R10 | `tests/unit/utils/descarga-dataset.test.ts` :: se ejecuta sin DOM: el módulo no referencia document ni window |
| R11 | `tests/unit/services/orden-service-descarga.test.ts` :: devuelve todas las filas del dataset sin recorte por pagina (R11) — `tests/unit/actions/ordenes-descarga-action.test.ts` :: entrega los items del servicio cuando todo va bien (R11) |
| R12 | `tests/unit/services/orden-service-descarga.test.ts` :: acota el dataset del adminTienda a sus propias ordenes (R12) / acota el dataset del mensajero a las ordenes que tiene asignadas (R12) |
| R13 | `tests/unit/actions/ordenes-descarga-action.test.ts` :: devuelve unauthenticated y ninguna fila cuando no hay sesion (R13) |
| R14 | `tests/unit/services/orden-service-descarga.test.ts` :: devuelve forbidden y ninguna fila cuando el rol no es conocido (R14) — `tests/unit/actions/ordenes-descarga-action.test.ts` :: propaga forbidden sin filas (R14) |
| R15 | `tests/unit/actions/ordenes-descarga-action.test.ts` :: devuelve validation_error y ninguna fila cuando llega una clave de filtro fuera de la lista blanca (R15) |
| R16 | `tests/unit/services/orden-service-descarga.test.ts` :: el filtro de tienda no amplia el alcance del adminTienda (R16) |
| R17 | `tests/unit/services/orden-service-descarga.test.ts` :: pide al repositorio el mismo criterio de orden que el listado paginado (R17) |
| R18 | `tests/unit/services/orden-service-descarga.test.ts` :: excluye las ordenes borradas igual que el listado (R18) |
| R19 | `tests/unit/config/descarga-config.test.ts` :: usa 5000 cuando no hay variable de entorno / toma el valor de DESCARGA_MAX_FILAS cuando es un entero positivo / ignora un valor no numerico o no positivo y cae al default |
| R20 | `tests/unit/services/orden-service-descarga.test.ts` :: devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R20) — `tests/unit/actions/ordenes-descarga-action.test.ts` :: propaga limite_excedido con total y limite tal como lo devuelve el servicio (R20) — `tests/components/OrdenesDescarga.test.tsx` :: muestra el error de tope, con total y límite, y no descarga archivo |
| R21 | `tests/unit/services/orden-service-descarga.test.ts` :: no devuelve un dataset truncado: o entrega todas las filas o el error de tope (R21) — `tests/integration/descarga-dataset-roundtrip.test.ts` :: el xlsx generado ... el mismo número de filas |
| R22 | `tests/unit/services/orden-service-descarga.test.ts` :: nunca pide al repositorio mas de N+1 filas (R22) |
| R23 | `tests/components/DescargarDataset.test.tsx` :: no descarga archivo y avisa cuando el dataset viene vacío |
| R24 | `tests/components/DescargarDataset.test.tsx` :: sin la prop descarga la tabla no renderiza control de descarga / con la prop descarga renderiza el control con su nombre accesible — `tests/components/OrdenesDescarga.test.tsx` :: un consumidor sin permitirDescarga no muestra el control |
| R25 | `tests/components/DescargarDataset.test.tsx` :: al pulsar llama a obtenerFilas y entrega el archivo generado |
| R26 | `tests/components/DescargarDataset.test.tsx` :: mientras la descarga está en curso el control queda deshabilitado y en carga, y un segundo click no dispara una segunda obtención |
| R27 | `tests/components/DescargarDataset.test.tsx` :: muestra el mensaje accionable y no descarga archivo cuando obtenerFilas devuelve error |
| R28 | `tests/components/DescargarDataset.test.tsx` :: descarga en xlsx sin pedir elección cuando no se declaran formatos / ofrece elegir entre los formatos declarados cuando hay más de uno |
| R29 | `tests/unit/components/datatable-descarga-contrato.test.ts` :: DataTable no importa acciones, tipos de dominio ni utilidades de filtros / la configuración de descarga solo expone título, columnas, obtenerFilas y formatos |
| R30 | `tests/components/DescargarDataset.test.tsx` :: con la prop descarga renderiza el control con su nombre accesible |
| R31 | `tests/components/DescargarDataset.test.tsx` :: la descarga no cambia la página, la selección ni las filas visibles |
| R32 | `tests/components/DescargarDataset.test.tsx` :: el archivo se entrega por el mecanismo de descarga del navegador, sin ninguna subida ni almacenamiento |
| R33 | `tests/components/OrdenesDescarga.test.tsx` :: el listado de órdenes ofrece la descarga del dataset completo |
| R34 | `tests/components/OrdenesDescarga.test.tsx` :: el archivo contiene una fila por orden del dataset completo, no solo la página visible |
| R35 | `tests/unit/components/ordenes-descarga-columnas.test.ts` :: proyecta cada orden a valores crudos: texto, número o celda vacía / no emite ningún ReactNode ni objeto en las celdas / resuelve zona, tienda, geografía y estado a su nombre legible, no a su id / no expone identificadores internos ni banderas de borrado |
| R36 | `tests/components/OrdenesDescarga.test.tsx` :: la descarga envía los filtros vigentes en el momento de descargar |
| R37 | `tests/components/OrdenesDescarga.test.tsx` :: el nombre del archivo identifica el listado y la fecha |
| R38 | `tests/components/OrdenesDescarga.test.tsx` :: el listado paginado sigue pidiendo página y tamaño de página como antes cuando no se descarga (+ `tests/components/OrdenesPage.test.tsx` y `tests/unit/components/ordenes-listado-filtros.test.tsx` verdes SIN edición) |

## Notas para el reviewer

1. **`estatus-label.ts` arrastra React transitivamente.** `ORDER_STATUS_LABELS` se reexporta desde `EstatusBadge.tsx`, así que `ordenes-descarga-columnas.ts` importa React de forma transitiva (no DOM). Los tests corren en entorno node sin problema. Mover `ORDER_STATUS_LABELS` a un módulo sin JSX quedaría fuera del alcance de la 151.
2. **Nombre de hoja sin sanitizar.** El título se pasa tal cual como nombre de hoja (design §3). Excel limita a 31 caracteres y prohíbe algunos símbolos; con "Órdenes" no hay problema, pero el rollout de la 145 deberá decidir la sanitización. No se inventó aquí porque el spec no la pide.
3. **Menú de formatos con marcado propio.** `components/ui/` no tiene primitiva de menú (el kit es Base UI, sin `dropdown-menu` copiado), así que el selector de formatos se resolvió con marcado accesible propio (role menu / menuitem, cierre por selección, Escape y click fuera), sin añadir componentes ni dependencias.
4. **Superficies sin descarga.** `OrdenesListado` activa `permitirDescarga`; el fallback de `page.tsx` para adminSatélite/mensajero monta `OrdenesModule` directo y queda en el default `false`. Es lo que pide design §7 ("para que el dashboard del adminTienda y el resto de superficies no cambien"). Si R33 debiera alcanzar también esas superficies, es una decisión de producto, no un defecto de implementación.
5. **`fechaCalendarioCR` en vez de un corte de `toISOString()`** para la fecha de creación del export, para evitar el off-by-one tras las 18:00 CR.

## Veredicto

Implementación completa: T1–T14, R1–R38 con test real, typecheck en 0, suite en verde sin regresiones e `init.sh` OK. Queda a decisión del reviewer.
