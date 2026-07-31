# Feature 170 — descarga a Excel en todas las tablas · bitácora de implementación

> Alcance de ESTA entrega: **FASE 1, Tanda 0 (T0.1–T0.5) y Tanda A (T A.1, T A.2)**.
> Las tandas B–G y toda la FASE 2 (paginación) son de otros encargos y NO se tocaron.
> Rama: `feature/170-export-todas-las-tablas`, partiendo de `origin/dev` con la 169 ya
> mergeada (PR #239).

## 0. Punto de partida

La rama del spec (`origin/feature/170-…` @ `dfe68673`) se integró con `origin/dev`
(@ `75ba1f83`, que ya trae la 169). **Un conflicto**, en `feature_list.json`, resuelto
conservando los dos lados:

- ficha **169** (de `dev`) y ficha **170** (de la rama del spec) conviven como fichas
  separadas; sin ids duplicados (169 fichas, 0 duplicados, JSON válido).
- ficha **145**: `depends_on` se queda en **169** (la decisión más reciente, de `dev`) y su
  `status_note` funde las dos: la que explica el cambio de dependencia y la que declara que
  el export salió de esa ficha a la 170.

### Baseline MEDIDO antes de tocar nada (worktree ya integrado)

| Puerta | Resultado |
| --- | --- |
| `pnpm run typecheck` | **0 errores** |
| `pnpm run lint` | **0 errores**, 20 warnings (todos `no-unused-vars` con prefijo `_`, preexistentes) |
| `pnpm test` | **677 archivos** (673 passed + 4 skipped) · **8339 tests**: 8265 passed, 74 skipped, **0 fallos** |

> Nota de entorno: el worktree no tiene `.env`, así que `prisma generate` se corrió con un
> `DATABASE_URL` de marcador (el generate no conecta). Sin eso, `typecheck` sale con ~200
> errores falsos por cliente Prisma ausente.

## 1. Archivos

### Nuevos

| Archivo | Qué es |
| --- | --- |
| `lib/types/descarga-listado.ts` | `ListarCompletoResult<T>` — el union del modo «dataset completo», generalizado (T0.1). |
| `components/shared/descarga-resultado.ts` | `filasDesdeResultado` (Familia A), `filasLocales` (Familia B), `mensajeLimite`, `SUFIJO_REINTENTO` (T0.2). |
| `app/(app)/recepcion-satelite/_components/satelite-descarga-columnas.ts` | Columnas + proyección de export de la bodega satélite (T A.2). |
| `tests/unit/components/descarga-resultado.test.ts` | 9 tests de los adaptadores (T0.2). |
| `tests/unit/descarga/columnas-sensibles.guardia.test.ts` | Guardia de datos sensibles (T0.4). |
| `tests/unit/descarga/censo-tablas.ts` | Registro del censo: 31 tablas (30 `<DataTable>` + 1 `<table>` cruda) (T0.5). |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | Guardia de cobertura del censo (T0.5). |
| `tests/components/descarga/OrdenesApartadoDescarga.test.tsx` | 5 tests del apartado por estado (T A.1). |
| `tests/components/descarga/SateliteDescarga.test.tsx` | 4 tests de la bodega satélite (T A.2). |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `lib/types/orden.ts` | `ListarOrdenesCompletoResult` pasa a ser `ListarCompletoResult<OrdenListItemDTO>`. **La forma pública no cambia**: mismo union, mismos nombres de campo (T0.1). |
| `app/(app)/ordenes/_components/OrdenesModule.tsx` | El bloque inline de traducción del resultado se sustituye por `filasDesdeResultado`; `mensajeLimite`/`SUFIJO_REINTENTO` salen de aquí (T0.3). |
| `app/(app)/ordenes/_components/OrdenesApartado.tsx` | Prop `descarga` con `listarOrdenesCompleto({ estatusId })` (T A.1). |
| `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` | Prop `descarga` con `filasLocales` sobre el array ya filtrado (T A.2). |
| `tests/components/OrdenesApartado.test.tsx` | **Solo el arnés**: el `render` se envuelve en `ToastProvider`. Ver §2.7. |
| `specs/170-export-todas-las-tablas/tasks.md` | `[x]` en T0.1–T0.5, T A.1, T A.2 + lo medido. |
| `feature_list.json` | Ficha 170 → `in_progress`; conflicto del merge resuelto. |

**Cero backend.** Ni servicios, ni repositorios, ni acciones, ni migraciones: la Tanda A no
estrena una sola línea de servidor, tal como declara el design (§8, tanda A: «backend
cero»). El apartado reusa `listarOrdenesCompleto` porque su schema ya admite `estatusId`;
la bodega satélite no lee nada (Familia B).

## 2. Decisiones tomadas al implementar

1. **Los textos se promovieron sin editarse.** `mensajeLimite` y `SUFIJO_REINTENTO` viajaron
   palabra por palabra desde `OrdenesModule`. Un test los fija literalmente, así que
   reescribirlos «de paso» ahora falla en un sitio y no en 25 pantallas.
2. **`filasLocales` es `async` aunque no espere nada.** `obtenerFilas` devuelve una promesa
   (contrato de la 151, que no se toca); así el cableado de Familia B es la misma línea que
   el de Familia A.
3. **El tope de Familia B sale de `descargaConfig.MAX_FILAS`, no de un literal.** En el
   navegador `DESCARGA_MAX_FILAS` no está definido (Next solo expone `NEXT_PUBLIC_*`), así
   que rige el default de 5000; leerlo de la config evita un segundo número que mantener.
4. **El apartado no ofrece el control mientras no tenga `estatusId`.** Sin él, la acción
   iría con filtro vacío y traería TODAS las órdenes, no las del apartado (R10). Hay un
   test para eso.
5. **El Estado del archivo de la bodega satélite va sin el sufijo « de \<zona\>»** que la
   tabla compone: la zona ya viaja en su columna, y repetirla convierte un dato en dos. La
   etiqueta sigue siendo legible (R8).
6. **`tests/components/OrdenesApartado.test.tsx` (feature 49) necesitó `ToastProvider`.**
   Es el único test existente que hubo que tocar, y hay que decirlo claro:
   - **Qué pasó:** montar el control de descarga (T A.1) hace que el apartado use
     `useToast`; ese archivo renderizaba el componente sin proveedor y los 6 tests
     reventaron con «useToast debe usarse dentro de un ToastProvider».
   - **Por qué NO es un defecto de producción:** `app/(app)/layout.tsx` envuelve en
     `ToastProvider` todas las pantallas del grupo `(app)`, que es donde vive el apartado.
     El precedente es idéntico: `OrdenesDescarga.test.tsx` (151) ya envuelve por lo mismo.
   - **Qué se cambió:** SOLO el `render` del helper `renderApartado`. Ni una aserción de la
     feature 49; los 6 tests siguen verdes tal cual estaban escritos.
   - **Qué NO se tocó:** `tests/components/OrdenesDescarga.test.tsx` sigue intacto
     (`git status` limpio) y verde tras el refactor T0.3, que era la condición de esa task.
7. **La guardia del censo admite un estado `pendiente`** con la tanda que cablea cada tabla.
   Es TRANSITORIO: al cerrar la fase 1 no puede quedar ninguno. La alternativa (exigir las
   25 ya) dejaría la suite roja durante todo el rollout, que es justo lo que las tandas
   evitan.

## 3. Las dos guardias: evidencia de que fallan cuando deben

Una guardia que nunca se ha visto en rojo no es una guardia. Las tres fugas se
introdujeron a mano, se midió el fallo y **se revirtieron** (`git status` limpio en esos
archivos).

### T0.4 — datos sensibles (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`)

| Fuga introducida | Resultado |
| --- | --- |
| Columna `{ clave: "passwordHash", encabezado: "Hash de contraseña" }` en `COLUMNAS_DESCARGA_ORDENES` | ✗ `ninguna declaración de columnas contiene claves de credencial, token o secreto` — «`app/(app)/ordenes/_components/ordenes-descarga-columnas.ts :: COLUMNAS_DESCARGA_ORDENES :: passwordHash`» |
| Celda `interno: orden.id` en `filaDescargaOrden` | ✗ `ninguna fila de export emite un identificador interno con forma de uuid` — «`… :: filaDescargaOrden :: interno lee id`». La SONDA dice qué campo se leyó, sin fixture. |
| Celda con URL firmada de Storage (`https://…/storage/v1/evidencias/f.jpg?token=abc`) | ✗ `ninguna fila de export emite una ruta de almacenamiento ni una URL firmada` |

Cómo cubre «TODAS las declaraciones del árbol» (R25), sin lista fija:
`import.meta.glob` descubre los `*-descarga-columnas.ts`; un escaneo del sistema de
archivos comprueba que lo cargado == lo que hay en disco; y un tercer barrido exige que
**ningún** archivo de `app/`, `components/` o `lib/` declare `DescargaColumna[]` fuera de
esa convención de nombre (si no, bastaría con nombrar el módulo de otra forma para
esquivar la guardia).

### T0.5 — cobertura del censo (`tests/unit/descarga/cobertura-tablas.guardia.test.ts`)

| Fuga introducida | Resultado |
| --- | --- |
| Componente nuevo `TablaDemoGuardia.tsx` con un `<DataTable>` sin registrar | ✗ `toda tabla del árbol o declara descarga o figura como exclusión justificada` — «hay tablas sin registrar en tests/unit/descarga/censo-tablas.ts: `["app/(app)/ranking/_components/TablaDemoGuardia.tsx #1"]`» |
| (medido de paso, antes de cablear la Tanda A) tabla declarada `con_descarga` que no la monta | ✗ el mismo test: «`OrdenesApartado.tsx #1 (Apartado de órdenes por estado): estado declarado "con_descarga"`» |

La guardia parsea la etiqueta `<DataTable …>` **instancia a instancia** (respetando
genéricos `<DataTable<Foo>`, llaves anidadas y cadenas), no por archivo: por eso un módulo
con dos tablas de las que solo una declara descarga se juzga por separado. Y contrasta en
los dos sentidos: sobra en el registro lo que ya no existe en el árbol.

## 4. Censo verificado contra el código (no de memoria)

25 archivos · **30 instancias** de `<DataTable>` + 1 `<table>` cruda (premios del podio) =
**31 tablas**, idéntico al `design.md §1`. De ellas:

- **con descarga hoy: 3** — órdenes (151), apartado por estado (T A.1), bodega satélite (T A.2).
- **pendientes: 22**, cada una con su tanda declarada en `censo-tablas.ts`.
- **fuera: 6** (5 `<DataTable>` + el podio), cada una con su motivo del Anexo II.

## 5. Trazabilidad R → test (solo lo cubierto por esta entrega)

| R | Test |
| --- | --- |
| R1 | `tests/components/descarga/OrdenesApartadoDescarga.test.tsx` :: ofrece la descarga del dataset completo del apartado · `SateliteDescarga.test.tsx` :: ofrece la descarga de las órdenes de la bodega |
| R2 | `tests/unit/descarga/cobertura-tablas.guardia.test.ts` :: las tablas declaradas fuera de alcance no montan control de descarga |
| R3 | `OrdenesApartadoDescarga.test.tsx` :: el listado paginado sigue comportándose igual |
| R4 | `cobertura-tablas.guardia.test.ts` :: toda tabla del árbol o declara descarga o figura como exclusión justificada |
| R9 | `OrdenesApartadoDescarga.test.tsx` :: el archivo contiene una fila por orden del apartado, no solo la página visible |
| R10 | `OrdenesApartadoDescarga.test.tsx` :: envía el estado del apartado como filtro vigente · `SateliteDescarga.test.tsx` :: respeta los filtros de estado, cantón y distrito aplicados |
| R11 | `tests/unit/components/descarga-resultado.test.ts` :: traduce el resultado ok a filas proyectadas, en el mismo orden (+ el equivalente de `filasLocales`) |
| R14 | `SateliteDescarga.test.tsx` :: solo contiene órdenes de la zona del actor |
| R20 | `SateliteDescarga.test.tsx` :: solo contiene órdenes de la zona del actor (acotamiento verificado en ESTA tabla, no en el mecanismo) |
| R21 | `columnas-sensibles.guardia.test.ts` :: ninguna declaración de columnas contiene claves de credencial, token o secreto |
| R22 | `columnas-sensibles.guardia.test.ts` :: ninguna fila de export emite una ruta de almacenamiento ni una URL firmada |
| R23 | `columnas-sensibles.guardia.test.ts` :: ninguna fila de export emite un identificador interno con forma de uuid |
| R25 | `columnas-sensibles.guardia.test.ts` :: la guardia cubre TODAS las declaraciones del árbol, no una lista fija |
| R26 | `descarga-resultado.test.ts` :: filasLocales rechaza y no produce archivo cuando el array supera el tope |
| R27 | `descarga-resultado.test.ts` :: traduce limite_excedido a un error accionable con total y tope, sin filas |
| R28 | `descarga-resultado.test.ts` :: filasLocales no trunca: o devuelve todas las filas o el error |
| R30 | `SateliteDescarga.test.tsx` :: no ejecuta ninguna lectura adicional al servidor |
| R31 | `descarga-resultado.test.ts` :: devuelve el resultado vacío tal cual para que el control avise sin archivo (en las dos familias) |
| R32 | `SateliteDescarga.test.tsx` :: no ejecuta ninguna lectura adicional al servidor · `OrdenesApartadoDescarga.test.tsx` :: el listado paginado sigue comportándose igual |
| R36 | `descarga-resultado.test.ts` :: traduce cualquier error de acción a un mensaje accionable sin datos personales |

R5–R8, R12, R13, R15–R19, R24, R29, R33–R35, R37–R39 quedan para las tandas B–G, como
declara la tabla de trazabilidad del `tasks.md`. (R7/R24 se ejercitan de paso en
`SateliteDescarga.test.tsx`, pero su cobertura formal es de la tanda B.)

## 6. Puertas (medición final)

| Puerta | Baseline | Después |
| --- | --- | --- |
| `pnpm run typecheck` | 0 errores | **0 errores** |
| `pnpm run lint` | 0 errores / 20 warnings | **0 errores / 20 warnings** (los mismos) |
| `pnpm test` | 681 archivos (677 passed + 4 skipped) · 8339 tests: 8265 passed / 74 skipped / **0 fallos** | **686 archivos** (682 passed + 4 skipped) · **8363 tests: 8289 passed / 74 skipped / 0 fallos** — +5 archivos y +24 tests, **0 rotos nuevos** |
| `./init.sh` | `== init OK ==` | `== init OK ==` |

## 7. Hallazgo para el leader (no se actuó)

`OrdenesApartado` solo lo monta `OrdenesRevisionMaestro`, y **ese módulo no lo monta
ninguna página**: el propio `OrdenesListado.tsx:373` lo llama «la vista legacy». Es el mismo
patrón por el que el Anexo II dejó fuera el módulo de zonas (P4). No se cambió el alcance
—el Anexo I lo lista como tabla #2 dentro de alcance y el cableado costó una prop—, pero si
el humano quiere ser coherente con la exclusión de zonas, esta tabla es candidata a salir.
Queda anotado, no decidido.
