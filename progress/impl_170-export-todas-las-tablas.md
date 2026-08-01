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

---

# TANDAS B y C — parte de SERVIDOR (2026-07-31)

> Segunda entrega sobre la misma rama. **No reescribe nada de lo anterior**: T0.\* y la tanda
> A siguen tal cual las dejó el agente previo. Aquí van T B.1, T B.2, T B.3, T C.1, T C.2 y
> T C.3, es decir **la parte de servidor y los contratos de columnas** de las dos tandas.
>
> **T B.4 y T C.4 (el cableado de la UI) NO son de esta entrega.** Los contratos quedan
> listos para que `frontend_dev` solo tenga que pasar la prop `descarga`; el §7 de este
> bloque dice exactamente qué símbolos usar en cada módulo. Por eso el registro del censo
> (`tests/unit/descarga/censo-tablas.ts`) sigue marcando esas 7 tablas como `pendiente`:
> cambiar su estado antes de que monten el control haría fallar la guardia de cobertura, que
> contrasta el estado declarado contra el código instancia a instancia.

## B0. Baseline medido AL EMPEZAR (2026-07-31, tras `git merge origin/dev`)

Medido, no heredado. El worktree venía sin `node_modules` ni `.env`; se instaló con
`pnpm install --frozen-lockfile` y se corrió `prisma generate` con un `DATABASE_URL` de
marcador (generate no conecta), que es lo que evita los ~200 errores falsos de typecheck que
avisaba el agente anterior.

| Puerta | Baseline |
| --- | --- |
| `pnpm run typecheck` | 0 errores |
| `pnpm run lint` | 0 errores / 20 warnings |
| `pnpm test` | 686 archivos (682 passed + 4 skipped) · 8363 tests: 8289 passed / 74 skipped / **0 fallos** |
| `./init.sh` | `== init OK ==` |

Coincide exactamente con el número que traía el encargo. El merge de `origin/dev` dio un
conflicto en `feature_list.json` (la 169 se cerró con `merged_pr: 239` y entraron las fichas
171-173); resuelto conservando ambos lados, **172 features y cero ids duplicados**.

## B1. Qué se entrega, tabla a tabla

**7 `listarCompleto` nuevos** (los 7 que el `design.md §2.1` declaraba; el octavo, el
apartado de órdenes, no necesitaba backend y lo cerró la tanda A):

| # | Tabla | Servicio · método | Alcance por rol | Cómo se acota |
| --- | --- | --- | --- | --- |
| 1 | Usuarios | `UsuarioService.listarCompleto` | solo `maestro` | guard `ALLOWED_ROLES` |
| 2 | Plantillas de mensaje | `PlantillaMensajeService.listarCompleto` | solo `maestro` | guard `ALLOWED_ROLES` |
| 3 | API keys | `ApiKeyService.listarCompleto` | solo `maestro` | guard `ALLOWED_ROLES` |
| 4 | Libro de caja | `WalletService.listarMovimientosCompleto` | acceso total | guard `esAccesoTotal` |
| 5 | Desglose de UN mensajero | `WalletMensajeroService.listarPagosDeMensajeroCompleto` | acceso total | guard `esAccesoTotal`; el `mensajeroId` viene del input |
| 6 | Mis pagos (mensajero) | `WalletMensajeroService.listarMisPagosCompleto` | solo `mensajero` | **dato del actor**: `mensajero_id = actor.usuarioId`, escrito AL FINAL |
| 7 | Mi wallet (tienda) | `WalletTiendaService.listarMisMovimientosCompleto` | solo `adminTienda` | **dato del actor**: `tienda_id = actor.usuarioId`, escrito AL FINAL |

**7 Server Actions** (`listarUsuariosCompleto`, `listarPlantillasCompleto`,
`listarApiKeysCompleto`, `listarMovimientosCompletoAction`,
`listarPagosDeMensajeroCompletoAction`, `listarMisPagosCompletoAction`,
`listarMisMovimientosCompletoAction`), todas calcadas de `listarOrdenesCompleto`.

**7 módulos de columnas de export**, uno por tabla.

## B2. El punto que más se vigiló: el alcance por rol

Dos formas distintas, y no se tratan igual porque no fallan igual.

**(a) Acotadas por ROL (5 de 7).** El conjunto es el mismo para todo el que entra; quien no
entra no ve nada. El guard es literalmente el MISMO objeto/función que usa `listar`
(`ALLOWED_ROLES`, `esAccesoTotal`) — no una copia — y se evalúa ANTES de tocar la base.

Cómo se verificó: un test que recorre TODOS los roles sin acceso y exige `forbidden`, sin
`items`, **y con el doble del repositorio sin invocar** (si el guard estuviera después de la
consulta, el dato ya habría salido de la base aunque no se devolviera). Más su
**CONTRAPRUEBA**: los roles que sí entran reciben filas no vacías. Sin ese segundo lado, un
servicio roto que no devolviera nada a nadie pasaría el primero.

**(b) Acotadas por un DATO DEL ACTOR (2 de 7): «mis pagos» y «mi wallet».** Aquí un fallo no
recorta el archivo: lo llena de dinero ajeno. Tres cierres independientes:

1. El acotamiento se escribe **AL FINAL** del objeto que va al repositorio, después del
   spread de filtros — mismo recurso que `OrdenService.construirWhere` con `adminTienda`.
2. `construirFiltros` lee claves **explícitas**, así que ninguna clave desconocida del input
   llega nunca al repositorio.
3. El schema del borde. En la tienda, `.strict()` convierte un `tiendaId` inyectado en
   `validation_error` sin llegar al servicio. En «mis pagos» **NO** se rechaza el
   `mensajeroId` —el schema del listado lo admite y quitarlo rompería la paridad: la descarga
   rechazaría una petición que el listado acepta—, y quien lo ignora es el servicio.

Cómo se verificó, en tres capas:

- **Fuga en las dos direcciones, con ambos lados NO vacíos.** Dos tiendas (y dos mensajeros)
  con movimientos propios: A recibe exactamente los suyos, B exactamente los suyos, y los
  conjuntos son disjuntos. Un servicio que devolviera vacío no pasaría.
- **Filtro inyectado.** Con `tiendaId`/`mensajeroId` ajenos en el input, el conjunto sigue
  siendo el del actor y el repositorio recibe el id del actor.
- **MUTACIÓN, ejecutada de verdad.** Se sustituyó `tiendaId: actor.usuarioId` por
  `input.tiendaId ?? actor.usuarioId` (y su gemelo en mensajero): falla **exactamente** el
  test de fuga (R15) y ningún otro. Revertido, suite verde otra vez. Es la prueba de que el
  test cazaría la regresión y no está pasando por casualidad.

Y un cuarto caso, propio del desglose de mensajero: **un `mensajero` no puede pedir por esa
vía el desglose de un compañero** (`forbidden`, sin consulta). Es lo único que separa esa
superficie de la propia, y por eso tiene test explícito.

## B3. Paridad con el listado (que el archivo no mienta)

- **Wallet (3 servicios):** se extrajo `construirFiltros(input)` privado —éste SÍ existía
  inline, repetido— y lo comparten el listado paginado, el balance/saldo y la descarga. Los
  filtros no pueden divergir porque son el mismo código. El test lo comprueba dos veces: que
  el CONJUNTO devuelto coincide con el del listado para los mismos filtros, y que el objeto
  que llega al repositorio es idéntico salvo el recorte de página.
- **Configuración (3 servicios):** **no había `construirWhere` que extraer**, y se declara
  como hallazgo. `listar` no arma ningún predicado: el `where` (incluida la exclusión de
  plantillas borradas) vive entero dentro de `repo.list`. La paridad se consigue llamando al
  MISMO método con los MISMOS `sortBy`/`sortDir`: si mañana el repositorio cambia lo que
  excluye, cambian los dos caminos porque son el mismo camino.
- **R19 «excluye borradas»:** real en plantillas (`deletedAt: null`, test con una borrada que
  no sale). En usuarios y API keys **no hay borrado lógico** —un usuario `inactivo` y una key
  `inactiva` SIGUEN listándose—, así que lo que se prueba es la paridad exacta: el conjunto
  completo == la concatenación de las páginas del listado, sin una fila de más ni de menos.

## B4. El tope, sin truncados silenciosos

Los 7 usan el tope ÚNICO de `descargaConfig.MAX_FILAS` (5000, feature 151). No se inventó
ninguno por tabla ni se añadió un helper: se sigue el molde de `OrdenService.listarCompleto`
tal cual, y la garantía la dan los tests **por servicio**, que es la mitigación que el
`design.md §6` eligió.

Por servicio hay tres tests: `limite_excedido` con `total` y `limite` **y sin `items`**;
`take = N + 1` con `skip = 0` (nunca se materializan más de N+1 filas aunque el total sean
50 000); y el de frontera — justo en el tope entrega TODAS las filas, un paso por encima no
entrega NINGUNA. En los ledgers, `page: 1` + `pageSize: N+1` es exactamente `skip 0, take
N+1` en el repositorio (verificado leyendo los tres repos: ninguno recorta el `pageSize`).

## B5. Datos sensibles: lo que se decidió NO exportar

| Tabla | Fuera del archivo, y por qué |
| --- | --- |
| Usuarios | `passwordHash` (ni está en el DTO; la guardia lo revalida sobre la fila), `id`, `createdAt` (el DTO lo trae, la tabla NO lo muestra → R24) |
| Plantillas | `id`, `templateId` (identificador de Meta, interno de la integración), `variables`, `createdAt` |
| API keys | el secreto en claro (no existe en este camino: viaja una vez y no vuelve a leerse), `keyHash`, el secreto de webhook (no vive en la fila: la columna «Webhook» es un botón que lee bajo demanda), `id`, `usuarioId` |
| Los 4 ledgers | `id`, `origenId`, `registradoPor`, `tiendaId`/`mensajeroId` (además son el mismo valor en todo el archivo: identifican al archivo, no a la fila) |

Sale el identificador de NEGOCIO, nunca el interno: `identificador` y `keyPrefix` en API keys
(el prefijo no es secreto por construcción, 81/R17, y es lo que ya se ve en pantalla).

**Money-safe.** El monto de los cuatro ledgers viaja como el STRING que devuelve el servidor,
TAL CUAL: sin `parseFloat`/`Number` y sin el símbolo de colón (que además rompería la celda
como número). El test lo demuestra con `"1000.10"`, que un `Number` intermedio devolvería
como `"1000.1"`: los céntimos.

La guardia `columnas-sensibles` de T0.4 recogió los 7 módulos nuevos por convención de nombre
y pasa sin tocarla, que era la prueba de que la guardia sirve para tablas futuras.

## B6. Piezas compartidas nuevas (y por qué existen)

| Pieza | Por qué |
| --- | --- |
| `ListarCompletoServiceResult<T>` en `lib/types/descarga-listado.ts` | Hermano de servicio del tipo de borde de T0.1: sin `unauthenticated` ni `validation_error` (los decide el borde) pero con `forbidden`, que es de dominio. Existe por el mismo motivo que su hermano: seis servicios lo habrían escrito seis veces, con matices. |
| `lib/utils/fecha-dia-iso.ts` | Los 4 ledgers exponen `fechaMovimiento` como STRING ISO y las 4 tablas lo pintan con `.slice(0,10)`. Además llamar a un MÉTODO sobre un campo revienta la sonda de la guardia T0.4, así que el helper coacciona con `String(...)` y usa una expresión regular: sobrevive a la sonda **y conserva su rastro**, que es lo que permite a la guardia decir de qué campo salió cada celda. |
| `usuario-estado-label.ts`, `plantilla-estado-label.ts`, `api-key-estado-label.ts` | Las etiquetas de estado vivían dentro de los `*-columns.tsx`, que importan `Badge`/`Button`. PROMOVIDAS sin editar ni un texto para que el módulo de export sea PURO. Misma operación que ya se hizo con `ROL_LABELS`. Que archivo y pantalla lean de aquí es lo que hace cierto R8. |

## B7. Contratos listos para `frontend_dev` (T B.4 y T C.4)

Todo lo que hace falta para cablear cada tabla. El patrón es el del `design.md §5`, en el
render (no en un `useMemo`), para que el closure lea los filtros de ESE render.

| Tabla | Acción | Columnas | Proyección |
| --- | --- | --- | --- |
| Usuarios | `listarUsuariosCompleto` (`lib/actions/usuarios`) | `COLUMNAS_DESCARGA_USUARIOS` | `filaDescargaUsuario` |
| Plantillas de mensaje | `listarPlantillasCompleto` (`lib/actions/plantillas`) | `COLUMNAS_DESCARGA_PLANTILLAS` | `filaDescargaPlantilla` |
| API keys | `listarApiKeysCompleto` (`lib/actions/api-keys`) | `COLUMNAS_DESCARGA_API_KEYS` | `filaDescargaApiKey` |
| Libro de caja | `listarMovimientosCompletoAction` (`lib/actions/wallet`) | `COLUMNAS_DESCARGA_WALLET_CAJA` | `filaDescargaMovimientoCaja` |
| Desglose de un mensajero | `listarPagosDeMensajeroCompletoAction` (`lib/actions/wallet-mensajero`) | `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO` | `filaDescargaDesgloseMensajero` |
| Mis pagos | `listarMisPagosCompletoAction` (`lib/actions/wallet-mensajero`) | `COLUMNAS_DESCARGA_MIS_PAGOS` | `filaDescargaMiPago` |
| Mi wallet (tienda) | `listarMisMovimientosCompletoAction` (`lib/actions/wallet-tienda`) | `COLUMNAS_DESCARGA_MI_WALLET` | `filaDescargaMiWallet` |

Tres avisos para quien cablee:

1. Los `*CompletoSchema` son **`.strict()` y sin `page`/`pageSize`**. Pasar los filtros
   vigentes con `page` dentro devuelve `validation_error`: hay que quitarlos.
2. `DesglosePagosMensajero`, `WalletLedger`, `DesglosePagos` y `DesgloseTiendaLedger`
   reciben sus datos por props y **no deben pasar a fetchear**: si hace falta, se baja un
   callback desde el módulo padre, nunca los filtros a la tabla (`design.md §5`).
3. Al montar el control, cada una de esas 7 tablas pasa de `pendiente` a `con_descarga` en
   `tests/unit/descarga/censo-tablas.ts`, o la guardia de cobertura falla.

## B8. Mapa `R<n> → test` de esta entrega

| R | Test |
| --- | --- |
| R5 | `{usuarios,plantillas,api-keys,wallet-caja,wallet-tienda,wallet-mensajero}-descarga-columnas.test.ts` :: declara sus columnas ENUMERADAS, en el orden de la pantalla |
| R6 | `usuarios-descarga-columnas.test.ts` · `plantillas-…` · `api-keys-…` :: un campo nuevo del DTO no aparece en el archivo hasta declararlo |
| R7 | los 6 archivos de columnas :: emite valores CRUDOS… · en los 4 ledgers, «emite el monto TAL CUAL, sin recalcularlo ni adornarlo» |
| R8 | `usuarios-…` :: emite el rol y el estado como ETIQUETA LEGIBLE · idem en plantillas, API keys y los 4 ledgers («emite tipo y categoría/concepto como ETIQUETA LEGIBLE») |
| R9 | `{usuario,plantilla,api-key}-descarga.test.ts` :: devuelve todas las filas del dataset, sin recorte por página · `wallet-{caja,tienda,mis-pagos,desglose-mensajero}-descarga.test.ts` :: idem |
| R11 | los 7 servicios :: «pide al repositorio el mismo criterio de orden que el listado paginado» / «mantiene el orden más reciente primero, igual que el listado» (+ `usuario-descarga` :: respeta el criterio de orden elegido) |
| R14 | `wallet-tienda-descarga.test.ts` :: el archivo de la tienda A no trae ni una fila de la tienda B, y viceversa · `wallet-mis-pagos-descarga.test.ts` :: idem con dos mensajeros · `wallet-desglose-mensajero-descarga.test.ts` :: el desglose de un mensajero no trae ni una fila de otro **y** un mensajero NO puede pedir por esta vía el desglose de nadie · `wallet-tienda-descarga-action.test.ts` :: un tiendaId inyectado es validation_error y NO llega al servicio · los 4 servicios de dinero :: aplica EXACTAMENTE los mismos filtros que el listado |
| R15 | `wallet-tienda-descarga.test.ts` :: un tiendaId inyectado en el input NO amplía el alcance · `wallet-mis-pagos-descarga.test.ts` :: un mensajeroId inyectado en el input NO amplía el alcance — **ambos verificados por mutación** |
| R16 | `{usuarios,plantillas,api-keys}-descarga-action.test.ts` y `wallet-{caja,tienda,mensajero}-descarga-action.test.ts` :: devuelve unauthenticated y ninguna fila cuando no hay sesión |
| R17 | los 7 servicios :: devuelve forbidden y ninguna fila a todo rol que no sea X (recorriendo TODOS los roles ajenos, con el repositorio sin invocar) + **CONTRAPRUEBA**: el rol autorizado SÍ recibe las filas · y en las 7 actions :: propaga forbidden sin filas |
| R18 | las 7 actions :: devuelve validation_error … con una clave fuera de la lista blanca · y «rechaza también page/pageSize: el modo completo NO pagina» |
| R19 | `plantilla-descarga.test.ts` :: excluye las plantillas borradas igual que el listado · `usuario-descarga.test.ts` y `api-key-descarga.test.ts` :: entrega EXACTAMENTE el mismo conjunto que el listado recorriendo sus páginas |
| R21 | `api-key-descarga.test.ts` :: ninguna fila del dataset completo lleva el hash ni el secreto de la key · `api-keys-descarga-columnas.test.ts` :: NUNCA emite el hash, la clave en claro ni el secreto de webhook |
| R23 | los 6 archivos de columnas :: no expone identificadores internos (+ ninguna celda con forma de uuid) |
| R24 | `usuarios-…` y `plantillas-descarga-columnas.test.ts` :: no emite campos que el listado no muestra en pantalla · los 4 ledgers :: compone el origen igual que la tabla / emite la fecha como día calendario, igual que la tabla |
| R27 | los 7 servicios :: devuelve limite_excedido con total y límite, y sin filas… · las 7 actions :: propaga limite_excedido con total y límite tal como lo devuelve el servicio |
| R28 | los 7 servicios :: no devuelve un dataset truncado: o entrega todas las filas o el error de tope · `plantillas-descarga-columnas.test.ts` :: emite el cuerpo COMPLETO, sin el truncado de pantalla |
| R29 | los 7 servicios :: nunca pide al repositorio más de N+1 filas |
| R32 | `wallet-tienda-descarga.test.ts` :: no ejecuta la consulta del saldo agregado · `wallet-mis-pagos-…` :: no ejecuta la consulta de la cuenta por pagar · `wallet-desglose-mensajero-…` :: no relee el nombre del mensajero ni su cuenta por pagar |

R1, R3, R10, R12, R13 y R33–R39 son de las tandas de CABLEADO (T B.4 / T C.4) y de la G, y no
se tocan aquí: sin el control montado no hay nada que afirmar sobre ellos.

## B9. Archivos de esta entrega

**Creados (18)**

- `app/(app)/configuracion/_components/usuario-estado-label.ts`
- `app/(app)/configuracion/_components/usuarios-descarga-columnas.ts`
- `app/(app)/configuracion/plantillas/_components/plantilla-estado-label.ts`
- `app/(app)/configuracion/plantillas/_components/plantillas-descarga-columnas.ts`
- `app/(app)/configuracion/api/_components/api-key-estado-label.ts`
- `app/(app)/configuracion/api/_components/api-keys-descarga-columnas.ts`
- `app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts`
- `app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas.ts`
- `app/(app)/mi-wallet/_components/mi-wallet-descarga-columnas.ts`
- `app/(app)/mis-pagos/_components/mis-pagos-descarga-columnas.ts`
- `lib/utils/fecha-dia-iso.ts`
- `tests/unit/services/{usuario,plantilla,api-key}-descarga.test.ts`
- `tests/unit/services/wallet-{caja,tienda,mis-pagos,desglose-mensajero}-descarga.test.ts`
- `tests/unit/actions/{usuarios,plantillas,api-keys}-descarga-action.test.ts`
- `tests/unit/actions/wallet-{caja,tienda,mensajero}-descarga-action.test.ts`
- `tests/unit/descarga/{usuarios,plantillas,api-keys}-descarga-columnas.test.ts`
- `tests/unit/descarga/wallet-{caja,tienda,mensajero}-descarga-columnas.test.ts`

**Modificados**

- Tipos: `lib/types/descarga-listado.ts` (+`ListarCompletoServiceResult`),
  `lib/types/{usuario,plantilla-mensaje,api-key,wallet,wallet-tienda,wallet-mensajero}.ts`
  (schemas `*Completo` + resultados de borde).
- Interfaces: `lib/interfaces/services/{IUsuarioService,IPlantillaMensajeService,IApiKeyService,IWalletService,IWalletTiendaService,IWalletMensajeroService}.ts`.
- Servicios: `lib/services/{UsuarioService,PlantillaMensajeService,ApiKeyService,WalletService,WalletTiendaService,WalletMensajeroService}.ts`.
- Actions: `lib/actions/{usuarios,plantillas,api-keys,wallet,wallet-tienda,wallet-mensajero}.ts`.
- UI (solo la promoción de etiquetas, sin cambio de render):
  `app/(app)/configuracion/_components/usuarios-columns.tsx`,
  `app/(app)/configuracion/plantillas/_components/plantillas-columns.tsx`,
  `app/(app)/configuracion/api/_components/api-keys-columns.tsx`.
- Dobles de test existentes (solo arnés, ninguna aserción):
  `tests/unit/actions/{usuarios,api-keys,api-keys-listar,wallet-actions,wallet-tienda-actions,wallet-mensajero-actions}.test.ts`,
  `tests/unit/plantillas/plantillas-actions.test.ts`.
- `specs/170-export-todas-las-tablas/tasks.md` (T B.1-B.3 y T C.1-C.3 marcadas, con lo medido).
- `feature_list.json` (resolución del conflicto del merge).

**Sin modelo de datos.** Cero migraciones, cero `down.sql`, cero cambios de RLS: no hay
superficie de lectura nueva — cada dataset completo es el mismo conjunto de filas que el
actor ya podía leer paginado. Lo confirma `./init.sh` («todas las migraciones tienen
down.sql»).

## B10. Puertas (medición final de esta entrega)

Salida real, no prometida.

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm run lint
✖ 20 problems (0 errors, 20 warnings)
=== lint exit: 0 ===

$ pnpm test
 Test Files  701 passed | 4 skipped (705)
      Tests  8447 passed | 74 skipped (8521)
   Duration  216.99s

$ ./init.sh
✓ lint paso
✓ test paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

| Puerta | Baseline (B0) | Después |
| --- | --- | --- |
| `pnpm run typecheck` | 0 errores | **0 errores** |
| `pnpm run lint` | 0 errores / 20 warnings | **0 errores / 20 warnings** (los mismos 20; los 16 que introdujeron los tests nuevos se eliminaron sustituyendo el destructuring-para-descartar por un helper) |
| `pnpm test` | 686 archivos · 8363 tests: 8289 passed / 74 skipped / 0 fallos | **705 archivos** (701 passed + 4 skipped) · **8521 tests: 8447 passed / 74 skipped / 0 fallos** — +19 archivos, +158 tests, **0 rotos nuevos** |
| `./init.sh` | `== init OK ==` | `== init OK ==` |

## B11. Hallazgos y deuda declarada (no se actuó)

1. **`ListarOrdenesCompletoServiceResult` sigue escrito a mano.** El union genérico de
   servicio (`ListarCompletoServiceResult<T>`) lo usan los 6 servicios nuevos, pero el de
   órdenes —que es de la 151— se dejó como estaba: reexpresarlo es una línea sin cambio de
   comportamiento, pero es de la tanda 0 y ya estaba entregada. Candidato a unificar en la G.
2. **«canal» de plantillas no existe.** Si el humano lo quiere en el archivo, primero hay que
   decidir de dónde sale (hoy la única superficie es WhatsApp y sería un literal constante).
3. **`createdAt` de plantillas fuera por R24.** Si se quiere la fecha en el archivo, la salida
   coherente es añadir la columna a la TABLA primero, no colarla solo en el export.
4. **`descargaConfig.MAX_FILAS` se lee en el servidor**, donde `DESCARGA_MAX_FILAS` sí puede
   estar definida. En el navegador rige el default de 5000 (Next solo expone `NEXT_PUBLIC_*`).
   Si alguien bajara el tope por entorno, servidor y cliente podrían discrepar: el servidor
   sería el estricto, así que falla cerrado y nunca entrega de más. Anotado, no decidido; es
   herencia de la 151, no de esta tanda.

---

# TANDAS B.4, C.4, D y E — la UI de 21 tablas (2026-07-31)

> Tercera entrega sobre la misma rama. **No reescribe nada de lo anterior**: T0.*, la tanda A y
> el servidor de B y C siguen tal cual los dejaron las entregas previas. Aquí van **T B.4,
> T C.4, toda la tanda D y toda la tanda E**: el cableado de UI de **21 tablas**.
>
> Fuera de esta entrega, por encargo: la tanda **F** (ranking) y la **G** (cierre de fase).

## C0. Baseline medido AL EMPEZAR (2026-07-31)

Medido, no heredado. El worktree venía sin `node_modules` ni `.env`: se instaló con
`pnpm install --frozen-lockfile` y se corrió `prisma generate` con un `DATABASE_URL` de marcador
(el generate no conecta), que es lo que evita los ~200 errores falsos de typecheck.

| Puerta | Baseline |
| --- | --- |
| `pnpm run typecheck` | 0 errores |
| `pnpm run lint` | 0 errores / 20 warnings |
| `pnpm test` | **705 archivos** (701 passed + 4 skipped) · **8521 tests**: 8447 passed / 74 skipped / **0 fallos** |
| `./init.sh` | `== init OK ==` |

Coincide exactamente con lo que declaraba el encargo. **La rama ya venía integrada con
`origin/dev`** (lo hizo la entrega anterior): `git merge origin/dev` dijo «Already up to date»,
así que no hubo conflicto que resolver en `feature_list.json`; el de la 169/170 sigue tal cual lo
dejó la fase previa (172 fichas, cero ids duplicados).

> Nota de worktree: la rama `feature/170-export-todas-las-tablas` estaba tomada por otro
> worktree, así que se trabajó en una rama local partiendo del MISMO commit (`6ccc3cbf`) y se
> empuja a la rama de la feature. El contenido es el mismo; solo cambia el nombre local.

## C1. Qué queda descargando, tabla a tabla

**21 tablas nuevas.** Con las 3 de las tandas 0/A, quedan **24 de las 25 dentro de alcance**; la
25.ª es el ranking (tanda F).

| Tanda | Tabla(s) | Familia | Cómo obtiene las filas |
| --- | --- | --- | --- |
| B.4 | Usuarios | A | `listarUsuariosCompleto({})` |
| B.4 | Plantillas de mensaje | A | `listarPlantillasCompleto({})` |
| B.4 | API keys | A | `listarApiKeysCompleto({})` |
| C.4 | Libro de caja | A | `listarMovimientosCompletoAction(filtros)` — callback del módulo |
| C.4 | Mi wallet (tienda) | A | `listarMisMovimientosCompletoAction(filtros)` — callback |
| C.4 | Mis pagos (mensajero) | A | `listarMisPagosCompletoAction(filtros)` — callback |
| C.4 | Desglose de un mensajero | A | `listarPagosDeMensajeroCompletoAction(...)`, en sitio |
| D.1 | Saldos de tiendas | B | `filasLocales(tiendas, ...)` |
| D.2 | Cuentas por pagar | B | `filasLocales(filtrados, ...)` — el array YA filtrado |
| D.3 | Plantillas de gasto fijo | B | `filasLocales(plantillas, ...)` |
| E.1 | Cierres del día: pendientes · histórico | B | `filasLocales(...)` |
| E.2 | Cierres de bodega: pendientes · resueltos | B | ídem |
| E.3 | Consolidación: consolidables · solicitados | B | ídem |
| E.4 | Cierre del día del mensajero: secciones por resultado · histórico | B | ídem |
| E.5 | Gestiones del detalle compartido: secciones por resultado | B | ídem |
| E.6 | Incidentes: pendientes · histórico | B | ídem |

En `tests/unit/descarga/censo-tablas.ts` esas 21 pasaron de `pendiente` a `con_descarga`.
**Queda UNA `pendiente`: el ranking del día (tanda F.1).**

## C2. Familia A: por qué tres ledgers reciben un CALLBACK

Los tres listados de configuración son directos: la config se construye EN EL RENDER y el input
va **vacío**, porque el schema del modo completo es `.strict()` y sin `page`/`pageSize` —
mandarlos devuelve `validation_error` en vez de un archivo — y `sortBy`/`sortDir` caen en el
MISMO default que usa el listado, así que el archivo sale en el orden de pantalla.

Los ledgers son el caso interesante. `WalletLedger`, `DesgloseTiendaLedger` y `DesglosePagos`
**reciben la página por props y no conocen los filtros vigentes**; quien los conoce es su módulo
padre. La salida es la del `design.md §5` —«si eso obliga a bajar un callback desde el módulo
padre, se baja el callback; nunca los filtros a la tabla»—: cada uno gana una prop
`obtenerFilasDescarga`, y **el título y las columnas del archivo los sigue declarando la tabla**,
que es la que sabe qué enseña. Los tres siguen sin importar una sola Server Action de LECTURA, y
hay un test ESTÁTICO que lo comprueba sobre los tres módulos (no un espía, que solo cubriría el
camino que el test recorra).

El cuarto, `DesglosePagosMensajero`, declara su `descarga` en sitio, y no es una excepción al
principio: ese componente **ya fetcheaba** (SWR sobre `listarPagosDeMensajeroAction`) porque ya
conocía su `mensajeroId` y sus filtros — es quien los usa para el listado paginado. Bajarle un
callback habría sido indirección sin dueño nuevo.

Un input de modo completo **no se deriva del de paginación con un `delete`**: cada módulo tiene
su `buildInputCompleto` separado que sencillamente no pone `page`/`pageSize`. Un `delete` que
alguien olvide mantener es exactamente cómo se cuela una clave en un schema `.strict()`.

## C3. Familia B: el array que se exporta, y el tope

Las 14 tablas de Familia B proyectan el MISMO array que la tabla pinta. Dos puntos donde eso
significa algo:

1. **Cuentas por pagar exporta `filtrados`, no `mensajeros`.** Su búsqueda es de cliente;
   descargar el conjunto sin filtrar entregaría filas que el usuario no está viendo, que es la
   otra forma de mentir (la primera es truncar). Hay un test que busca «Beto» y exige que el
   archivo traiga UNA fila.
2. **El tope de 5000 se aplica igual.** `filasLocales` devuelve un error accionable con total y
   tope y **no produce archivo**. Se ejercita de verdad en `WalletPropsDescarga.test.tsx` con
   5001 saldos.

**Dónde NO se re-probó el tope, y por qué:** en la tanda E. Montar 5001 cierres en jsdom hace que
esas pantallas rendericen además 5001 tarjetas de la «vista tipo factura»; el test tarda minutos
(se midió: no terminaba en 5) y no afirma nada que no esté ya afirmado — el tope vive en el
helper compartido, con tests unitarios en T0.2 y de componente en la tanda D. Queda escrito en el
propio archivo de test, no solo aquí.

## C4. Las columnas: lo que NO se exporta

| Tabla | Fuera del archivo, y por qué |
| --- | --- |
| Saldos de tiendas | `tiendaId` (uuid). El identificador de negocio de la fila es el NOMBRE |
| Cuentas por pagar | `mensajeroId` (uuid) |
| Gasto fijo | `id` y **todo el ciclo** (`periodicidadUnidad`, `periodicidadCantidad`, `fechaCobro`, `createdAt`, `updatedAt`): el DTO los trae, la TABLA no los muestra (R24) |
| Cierres (6 tablas) | `cierreId`, `cierreBodegaId`, `cierreDiaId`, `mensajeroId`, `zonaId`, `solicitadoPorId` (uuid) |
| Gestiones (detalle y día) | `gestionId`, `ordenId` y —lo importante— **`evidenciaUrl`** |
| Incidentes | `incidenteId`, `ordenId` y **`evidenciaUrls`** |

**R22 es el riesgo propio de esta tanda.** Estas pantallas son las únicas del rollout cuyo dato de
origen trae **URL FIRMADAS** de evidencia. Un `xlsx` con una dentro, reenviado por correo, es
acceso a la foto sin sesión. En el archivo va **«Tiene evidencia: Sí/No»** y nunca el enlace. Y no
se confía solo en la guardia estática: hay un test que descarga las secciones que TIENEN
evidencia y revisa CADA celda del resultado real contra `http(s)://`, contra rutas de almacén y
contra `token=`.

**Money-safe en las 21.** Todo monto viaja como el STRING que devolvió el servidor, tal cual: sin
`parseFloat`/`Number` (un `Decimal(12,2)` no cabe exacto en un `number`) y sin el símbolo de colón
de `money`, que es presentación y convertiría una celda numérica en texto que la hoja no puede
sumar. Los tests lo comprueban con montos acabados en `.10`, que un `Number` intermedio devolvería
como `.1`: los céntimos.

**Un `null` es celda VACÍA, no un "—".** El guion es presentación; en una hoja se leería como un
valor. Y una `indemnizacion` nula NO es cero: es «todavía no se capturó» (o «no se indemnizó»),
así que la celda queda vacía — un 0 afirmaría un monto que nadie decidió.

## C5. Etiquetas promovidas (y una duplicación que desaparece)

Mismo procedimiento que la tanda B con `usuario-estado-label`: el módulo de columnas debe ser
PURO (design §3), así que el texto que comparten pantalla y archivo se promueve sin editarlo.

| Módulo nuevo (puro) | De dónde salió |
| --- | --- |
| `app/(app)/wallet/tiendas/_components/saldo-tienda-signo-label.ts` | del `SIGNO_BADGE` de `SaldosTiendasTable` (que además lleva la `variant` del badge) |
| `app/(app)/wallet/_components/gasto-fijo-estado-label.ts` | del `Badge` inline de `GastosFijosPlantillasPanel` |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | de `cierre-detalle-shared.tsx`, que importa `Card`/`Badge`/`Modal`/`DataTable` |

El tercero es el que más rinde: `RESULTADO_LABEL`, `METODO_LABEL`, `ESTADO_LABEL` y la tabla del
destino estaban **duplicadas palabra por palabra** en `cierre-detalle-shared` y en
`CierreDiaModule`. Ahora las dos pantallas y los dos módulos de export leen del mismo sitio, y
`cierre-detalle-shared` las **RE-EXPORTA**, así que ninguno de sus consumidores cambia una línea.
Que archivo y pantalla digan lo mismo (R8/R24) pasa a ser cierto por construcción, no por
coincidencia entre dos literales.

Las cuentas por pagar no necesitaron promoción: `wallet-mensajeros-labels.ts` ya era puro, y el
módulo de export lee de ahí sus encabezados y su etiqueta de estado.

## C6. Dos decisiones de a11y que cambian el nombre del archivo

`titulo` es a la vez el nombre de la hoja, la base del nombre de archivo (R12) y parte del nombre
accesible del control (R13). Eso obliga a que sea **único en la pantalla**:

1. **El desglose de un mensajero lleva su nombre** (`Desglose de Ana Mensajera`). La tabla de
   cuentas por pagar admite varias filas expandidas A LA VEZ; tres botones llamados «Descargar
   Desglose por cierre» no dirían de quién es cada archivo.
2. **`DetalleSecciones` gana una prop `contexto`.** El detalle de un cierre de BODEGA monta las
   mismas secciones una vez POR mensajero incluido; sin contexto habría tres «Descargar
   Entregadas» en el mismo modal. Con él, el control se llama `Entregadas · <mensajero>` y el
   archivo sale como `entregadas-<mensajero>-<fecha>.xlsx`.

También por R13, en incidentes los controles NO se llaman como los encabezados de la pantalla
(«Pendientes de decisión» / «Histórico»): un archivo `historico-<fecha>.xlsx` no diría de qué es.
Se llaman «Incidentes pendientes» e «Incidentes resueltos».

**Límite conocido de `titulo` (anotado, no decidido):** `exceljs` TRUNCA a 31 caracteres el nombre
de la hoja (con un `console.warn`) y LANZA si lleva `* ? : \ / [ ]`. Con nombres de persona
largos, el título compuesto puede pasar de 31: el archivo se genera igual y su NOMBRE conserva el
slug completo; solo la pestaña sale recortada. Y si un nombre trajera uno de esos caracteres,
`construirDescarga` lanza y el control avisa con un toast — falla cerrado, sin archivo a medias.
Ver C13.1.

## C7. Una descarga POR SECCIÓN en el detalle del cierre (P2 ratificada)

Decisión del humano, ya cerrada: **no hay un archivo único del cierre**. Cada sección por
resultado tiene su botón y su juego de columnas, porque las secciones no enseñan lo mismo — una
entrega lleva método de pago y comisión; una reprogramación, la fecha nueva; un rechazo, el origen
y el ingreso de bodega; un incidente, la causa y la indemnización. Fundirlas daría una hoja llena
de celdas vacías que nadie sabría leer.

**Son CINCO secciones, no cuatro.** El spec decía «hasta cuatro (entregadas / reprogramadas /
devueltas / rechazadas)» porque se escribió antes de que la 158 añadiera el grupo `incidente`, que
hoy es un resultado más del mismo `ORDEN_RESULTADOS`. Se cablearon las cinco: dejar una fuera
habría sido dejar sin descarga justo la sección con el dinero de la indemnización.

**Y el mensajero exporta MENOS que el admin, a propósito.** `CierreDiaModule` y `DetalleSecciones`
proyectan el MISMO DTO pero declaran módulos de columnas DISTINTOS: la pantalla del mensajero no
muestra el ingreso de Ordenex (flete, comisión, IVA, total) ni el monto de la indemnización — es
dinero que no es suyo (158, design §7.2). Exportar ahí lo que ve el admin sería publicar por el
archivo lo que la pantalla oculta, que es exactamente lo que R24 prohíbe.

## C8. El mapa resultado→columnas vive en el `.tsx`, no en el módulo de columnas

Detalle pequeño con motivo grande: la guardia de datos sensibles (T0.4) solo reconoce, dentro de
un `*-descarga-columnas.ts`, los **arrays de columnas** y las **funciones de proyección**. Un
`Record<CierreResultado, {columnas, fila}>` exportado desde ahí no sería ni una cosa ni la otra:
**se le escaparía a la guardia entera**. Por eso los módulos exportan las cinco declaraciones
sueltas —vigiladas una a una— y el mapa que elige cuál toca vive en el componente.

## C9. Tests existentes tocados: el arnés, y UNA guardia que se siguió a su nuevo sitio

**(a) Arnés, sin tocar una sola aserción.** Tres suites reventaron con «useToast debe usarse
dentro de un ToastProvider» al montar el control. Es el precedente exacto de T A.1 y se trató
igual — envolver el `render`:

| Suite | Qué se cambió |
| --- | --- |
| `tests/components/CuentasPorPagarTable.test.tsx` (44) | los 5 `render` pasan por un helper que envuelve en `ToastProvider` |
| `tests/components/CierreDetalleIncidente.test.tsx` (158) | ídem, 9 `render` |
| `tests/integration/wallet-mensajeros-page.test.tsx` (44) | el helper `renderDesglose` se envuelve |

En producción no cambia nada: `app/(app)/layout.tsx` ya envuelve en `ToastProvider` todo el grupo
`(app)`, que es donde viven las tres pantallas.

**(b) Una guardia de la 158 que apuntaba a un archivo que ya no tiene la etiqueta, y se dice
claro.** `tests/unit/guards/incidente-exhaustividad.test.ts` exigía el literal
`incidente: "Incidentes"` DENTRO de `cierre-detalle-shared.tsx` y de `CierreDiaModule.tsx`. Al
promover `RESULTADO_LABEL` a `cierre-labels.ts` (C5), esas dos copias dejaron de existir y la
guardia se puso roja.

- **No se relajó ni se borró**: se SIGUIÓ la etiqueta a su nuevo sitio. Ahora exige (a) que la
  ÚNICA declaración clasifique `incidente` y (b) que los dos detalles la USEN.
- **Queda más fuerte, no más débil:** antes bastaba con que cada copia tuviera la clave; un tercer
  detalle que la olvidara habría pasado inadvertido. Ahora no hay dónde olvidarla.
- **VERIFICADO POR MUTACIÓN:** quitando `incidente: "Incidentes"` de `cierre-labels.ts` la guardia
  falla («cierre-labels.ts sin etiqueta de incidente») y ningún otro test se mueve. Revertido.

## C10. Mapa `R<n> → test` de esta entrega

| R | Test |
| --- | --- |
| R1 | `ConfiguracionDescarga` :: los tres ofrecen su control con nombre accesible · `WalletDescarga` :: cada ledger ofrece su control… · `WalletPropsDescarga` :: las tres ofrecen su control… · `CierresDescarga` :: cada tabla de cierres ofrece su control… · `IncidentesDescarga` :: las dos tablas ofrecen su control… |
| R3 | `ConfiguracionDescarga` :: los tres listados siguen comportándose igual… · `WalletDescarga` :: los cuatro ledgers siguen comportándose igual… |
| R7 | `WalletPropsDescarga` :: los montos viajan TAL CUAL, sin recalcularlos ni adornarlos · `WalletDescarga` :: el archivo trae el ledger ENTERO (comprueba el monto STRING sin `₡`) |
| R8 | `CierresDescarga` :: estados, causas y destinos salen como etiqueta legible… · `IncidentesDescarga` :: estados y causas salen como etiqueta legible… |
| R9 | `ConfiguracionDescarga` :: el archivo trae TODAS las filas, no solo la página visible · `WalletDescarga` :: el archivo trae el ledger ENTERO, no la página pintada |
| R10 | `WalletDescarga` :: usa los filtros de fecha vigentes y no manda paginación · `WalletPropsDescarga` :: cuentas por pagar exporta solo lo que la búsqueda deja a la vista |
| R11 | `CierresDescarga` :: el archivo trae las filas de SU tabla, en el orden de la pantalla · `IncidentesDescarga` :: cada archivo trae SU tabla entera, en el orden de la pantalla |
| R12 | `ConfiguracionDescarga` :: el nombre del archivo identifica el listado y la fecha · `IncidentesDescarga` :: (`incidentes-pendientes-YYYY-MM-DD.xlsx`) |
| R13 | los cinco archivos :: el nombre accesible de cada control identifica SU tabla |
| R14/R20 | `CierresDescarga` :: el archivo del adminSatelite solo trae los cierres de su zona · `IncidentesDescarga` :: el archivo del adminSatelite solo trae los incidentes de su alcance |
| R18 | `ConfiguracionDescarga` y `WalletDescarga` :: ninguna clave de paginación viaja en el input del modo completo |
| R22 | `CierresDescarga` :: ninguna URL firmada ni ruta de almacenamiento llega al archivo · `IncidentesDescarga` :: ídem |
| R26/R27/R28 | `ConfiguracionDescarga` :: con el tope superado no se produce archivo… · `WalletPropsDescarga` :: por encima del tope rechaza con un error accionable y NO produce archivo |
| R30/R32 | `WalletDescarga` :: los componentes de presentación no pasan a fetchear (estático) · `WalletPropsDescarga` :: ninguna de las tres relee del servidor (estático) · ambos :: la acción del modo completo no se llama hasta que alguien pulsa |
| R37 | `CierresDescarga` :: descargar no cambia la fila expandida ni el modal abierto |
| R2/R4 | `cobertura-tablas.guardia` (T0.5) con 21 tablas más declaradas `con_descarga`: contrasta lo declarado contra el código instancia a instancia, EN LOS DOS SENTIDOS |
| R21/R23/R25 | `columnas-sensibles.guardia` (T0.4) recogió los **10 módulos de columnas nuevos** por convención de nombre, sin tocar la guardia |

## C11. Archivos de esta entrega

**Creados (16)**

- Columnas de export (8): `app/(app)/wallet/tiendas/_components/saldos-tiendas-descarga-columnas.ts`,
  `app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-descarga-columnas.ts`,
  `app/(app)/wallet/_components/gastos-fijos-descarga-columnas.ts`,
  `app/(app)/cierres-admin/_components/cierres-admin-descarga-columnas.ts`,
  `app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas.ts`,
  `app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts`,
  `app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts`,
  `app/(app)/incidentes/_components/incidentes-descarga-columnas.ts`.
- Etiquetas promovidas, puras (3): `app/(app)/cierres-admin/_components/cierre-labels.ts`,
  `app/(app)/wallet/tiendas/_components/saldo-tienda-signo-label.ts`,
  `app/(app)/wallet/_components/gasto-fijo-estado-label.ts`.
- Tests (5): `tests/components/descarga/{ConfiguracionDescarga,WalletDescarga,WalletPropsDescarga,CierresDescarga,IncidentesDescarga}.test.tsx`.

**Modificados**

- UI cableada (19): `UsuariosModule`, `PlantillasModule`, `ApiKeysModule`, `WalletModule`,
  `WalletLedger`, `MiWalletModule`, `DesgloseTiendaLedger`, `MisPagosModule`, `DesglosePagos`,
  `DesglosePagosMensajero`, `SaldosTiendasTable`, `CuentasPorPagarTable`,
  `GastosFijosPlantillasPanel`, `CierresAdminModule`, `CierresBodegaAdminModule`,
  `ConsolidacionBodegaModule`, `cierre-detalle-shared`, `CierreDiaModule`,
  `IncidentesAdminModule`.
- Censo: `tests/unit/descarga/censo-tablas.ts` (21 tablas de `pendiente` a `con_descarga`).
- Tests existentes: los tres del arnés (C9.a) y `tests/unit/guards/incidente-exhaustividad.test.ts`
  (C9.b, guardia seguida a su nuevo sitio y verificada por mutación).
- `specs/170-export-todas-las-tablas/tasks.md` (T B.4, T C.4, T D.*, T E.* marcadas, con lo medido
  y las divergencias declaradas).

**Cero backend.** Ni servicios, ni repositorios, ni acciones, ni migraciones: las cuatro tandas son
de presentación. Las 7 acciones del modo completo que se consumen aquí las entregó la fase previa.

## C12. Puertas (medición final de esta entrega)

Salida real, no prometida.

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm run lint
✖ 20 problems (0 errors, 20 warnings)
=== lint exit: 0 ===

$ pnpm test
 Test Files  706 passed | 4 skipped (710)
      Tests  8473 passed | 74 skipped (8547)
   Duration  218.98s

$ ./init.sh
✓ lint paso
✓ test paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

| Puerta | Baseline (C0) | Después |
| --- | --- | --- |
| `pnpm run typecheck` | 0 errores | **0 errores** |
| `pnpm run lint` | 0 errores / 20 warnings | **0 errores / 20 warnings** (los mismos) |
| `pnpm test` | 705 archivos · 8521 tests: 8447 passed / 74 skipped / 0 fallos | **710 archivos** (706 passed + 4 skipped) · **8547 tests: 8473 passed / 74 skipped / 0 fallos** — +5 archivos, +26 tests, **0 rotos nuevos** |
| `./init.sh` | `== init OK ==` | `== init OK ==` |

## C13. Hallazgos y deuda declarada (no se actuó)

1. **Nombre de hoja > 31 caracteres.** `exceljs` trunca la pestaña (con `console.warn`) cuando el
   título compuesto se pasa; afecta a `Desglose de <mensajero>` y a `<Resultado> · <mensajero>`
   con nombres largos. El archivo se genera correcto y su NOMBRE conserva el slug entero: solo la
   pestaña sale recortada. Si se quiere cerrar del todo, la salida limpia es que
   `DescargarDatasetButton` acepte un nombre de hoja distinto del título —lo que SÍ tocaría el
   contrato de la 151— o que `construirDescarga` recorte con criterio. Candidato a la G.
2. **El histórico de cierres exporta «Rechazado» sin el marcador «Bloqueante hasta
   re-solicitud».** No se pierde información: el marcador se DERIVA del propio estado (todo
   rechazado lo lleva), así que la columna ya lo dice. Anotado por si el humano prefiere el texto
   completo en el archivo.
3. **`DetalleSecciones` hoy solo lo monta `CierresBodegaAdminModule`.** `CierresAdminModule` pasó a
   `CierreFacturaDetalle` (que no usa `DataTable`), así que la descarga por sección solo se ve en
   el detalle de un cierre de BODEGA. La tabla sigue censada y cableada porque el módulo existe y
   se usa; si mañana la vista factura reemplaza también esa, la guardia del censo lo dirá.
4. **La tanda F (ranking) es la ÚNICA `pendiente` del censo.** Al cerrarla, el censo queda sin
   ningún `pendiente` y la fase 1 puede cerrarse (T G.1/T G.2).
