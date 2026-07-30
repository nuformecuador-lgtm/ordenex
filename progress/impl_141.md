# impl_141 — Tabla `carga` + `carga_id`/`download_url` en `orden`

> Rama `feature/141-tabla-cargas-orden` (worktree `ordenex-wt-141`), desde `origin/dev` @ 1cfb2ed.
> Alcance backend puro: **cero `.tsx` en el diff** (`git diff --name-only 1cfb2ed | grep -c '\.tsx$'` → `0`).
> NO se ejecutó ninguna escritura contra la base (`db:migrate` / `db:rollback` / `migrate deploy`
> NO se corrieron: el `.env` apunta a una DB compartida). Sí `pnpm db:generate`.
>
> **Segunda pasada:** el spec se actualizó (`c4e4db4`) con tres cambios del humano — id del lote
> generado por el SERVIDOR, columna `name` única por usuario y `download_type` con escritura de
> `download_url`. El rango vigente es **R1–R55**; este documento sustituye el mapa R1–R30 anterior.

## Commits

### Primera pasada (diseño previo)
| Hash | Qué |
| --- | --- |
| `e7ea97f` | Migración `20260727120000_carga_orden_carga_id` (UP+DOWN), `schema.prisma`, denylist |
| `358efec` | Repositorio: `LoteContexto`, `CargaLoteAjenoError`, `ensureCargaEnTx`, `carga_id` en la misma tx |
| `daaa1c1` | Service, borde HTTP (chunk route) y cliente de chunks |
| `287368d` | Tests R1–R30 |
| `8616ffe` | `tasks.md` `[x]` + notas |
| `0bd6ed3` | `progress/impl_141.md` |

### Segunda pasada (delta del humano, R1–R55)
| Hash | Qué |
| --- | --- |
| `ecd84fc` | Id del lote server-side + `carga.name` único por usuario + `download_type` con escritura de `download_url` |
| `4dafdc9` | Tests del delta (R1–R55) |
| _este_ | `tasks.md` `[x]` + bitácora actualizada |

## Delta de archivos (segunda pasada)

**Creados**
- `lib/interfaces/services/IEtiquetasDescargaService.ts` — `DownloadType`, `EtiquetasDescargaResultado`
- `lib/services/EtiquetasDescargaService.ts` — orquesta "generar según modo + persistir la URL"
- `tests/unit/services/etiquetas-descarga-service.test.ts`

**Modificados**
- `db/migrations/20260727120000_carga_orden_carga_id/migration.sql` — **en sitio** (gate F1.4-10):
  `"name" TEXT` + `CREATE UNIQUE INDEX "carga_usuario_carga_name_key" ON "carga"("usuario_carga","name")`
- `db/migrations/.../down.sql` — comentario: el `DROP TABLE` arrastra el índice compuesto
- `db/schema.prisma` — `Carga.name String?` + `@@unique([usuarioCarga, name])`
- `lib/interfaces/repositories/IOrdenRepository.ts` — `LoteContexto.name`, `CargaNombreDuplicadoError`,
  `setCargaDownloadUrl`, `setOrdenesDownloadUrl`; JSDoc del token opaco
- `lib/repositories/carga-lote.ts` — **reescrito**: dos ramas excluyentes (crear con `randomUUID()`
  server-side / reutilizar en solo lectura), traducción de `P2002`
- `lib/repositories/OrdenRepository.ts` — `name` propagado al ensure; `setCargaDownloadUrl` /
  `setOrdenesDownloadUrl`
- `lib/services/BulkOrdenService.ts` — `options.name` en ambas vías; `cargarViaApi(rows, actor, options?)`
- `lib/interfaces/services/IBulkOrdenService.ts`, `lib/types/carga-masiva.ts` — contratos y JSDoc
- `lib/interfaces/services/IEtiquetasLotePdfService.ts` + `lib/services/EtiquetasLotePdfService.ts` —
  `EtiquetaOrdenPdfResultado` y `generarYAlmacenarPorOrden` (modo `individual`, mismo tope)
- `app/api/ordenes/carga-masiva/chunk/route.ts` — `name` en el schema; 403 y **409**
- `app/api/ordenes/api-key/carga/route.ts` — `name` + `download_type` en el schema, 409,
  `EtiquetasDescargaService`, `downloadType` y `ordenes[].downloadUrl` en la respuesta
- `app/(app)/ordenes/_components/carga-masiva-chunks.ts` — ya NO genera UUID: guarda el token que
  devuelve el primer chunk y lo reenvía; `name` opcional
- Tests: `tests/fixtures/carga-lote.ts` (delegate con `create`/`findUnique`/`update` + P2002),
  `carga-lote.test.ts`, `orden-repository.carga-lote.test.ts`, `bulk-orden-service.carga-lote.test.ts`,
  `etiquetas-lote-pdf-service.test.ts`, `carga-migration.test.ts`, ambas rutas,
  `carga-api-etiquetas.test.ts`, `CargaMasivaChunks.test.ts`, y los fakes de `IOrdenRepository`

## Mapa `R<n> → test`

| R | Test (archivo · caso) |
| --- | --- |
| R1 | `tests/integration/db/carga-migration.test.ts` · "R1: crea la tabla en SINGULAR…" + "el modelo Carga mapea a la tabla `carga`…" |
| R2 | idem · "R2: usuario_carga es NOT NULL con FK a usuario(id) ON DELETE RESTRICT" + "R2: Usuario expone el lado inverso (cargasRealizadas)" |
| R3 | idem · "R3: NO define batch_url, ni status, ni un enum nuevo…" + "R3: el modelo Carga NO declara status ni batchUrl" |
| R4 | idem · "R4: agrega carga_id TEXT NULLABLE con indice y FK … ON DELETE RESTRICT" + "R4/R5: el modelo Orden declara cargaId/downloadUrl nullable…" |
| R5 | idem · "R5: agrega download_url TEXT NULLABLE a `orden`" |
| R6 | idem · "R6: download_url es TEXT NULLABLE (nace sin valor)" |
| R7 | idem · "R7: total_files es INTEGER NOT NULL…" · `tests/unit/services/bulk-orden-service.carga-lote.test.ts` · "R29: total_files = total de la SESION…" |
| R8 | `carga-migration.test.ts` · "R8: `name` es TEXT NULLABLE…" + "R8/R9: el modelo Carga declara `name String?`…" |
| R9 | idem · "R9: crea el indice UNICO COMPUESTO (usuario_carga, name)…" + la aserción de `@@unique` en el schema · `tests/unit/repositories/carga-lote.test.ts` · "R24: el MISMO usuario repitiendo nombre…" |
| R10 | `carga-migration.test.ts` · "R9: … no uno global sobre name" (los NULL conviven por diseño) · `carga-lote.test.ts` · "R10: varios lotes SIN nombre del mismo usuario conviven" |
| R11 | `carga-migration.test.ts` · "R11: sin backfill — ningun UPDATE ni INSERT sobre las ordenes existentes" (+ columna nullable en R4) |
| R12 | idem · "R12: habilita RLS en `carga` y NO define ninguna policy" |
| R13 | idem · describe "DOWN — revierte exactamente (R13)" (4 casos, incl. el orden y el arrastre del índice) |
| R14 | idem · "R14: no toca num_guia…" · `tests/unit/repositories/orden-repository.carga-lote.test.ts` · "R14/R40: la fila insertada no lleva num_guia ni download_url" |
| R15 | `tests/unit/repositories/carga-lote.test.ts` · "con `id: null` crea la fila con un UUID propio…" y "R15: dos creaciones seguidas producen ids DISTINTOS" · `orden-repository.carga-lote.test.ts` · "R15/R36: … carga_id GENERADO POR EL SERVIDOR" y "R15/R19: un token INEXISTENTE no crea ninguna fila con ese id" · `tests/components/CargaMasivaChunks.test.ts` · "R15/R16: el PRIMER chunk NO envia cargaId" |
| R16 | `bulk-orden-service.carga-lote.test.ts` · "R15/R16: sin token entrante se pide la CREACION al repo (cargaId null)" · `CargaMasivaChunks.test.ts` · "R15/R16: el PRIMER chunk NO envia cargaId" · `carga-lote.test.ts` · describe "CREACION" |
| R17 | `carga-lote.test.ts` · "R17: con un token propio devuelve el mismo id SIN insertar nada" · `orden-repository.carga-lote.test.ts` · "R17: con un token propio REUTILIZA la fila…" · `CargaMasivaChunks.test.ts` · "R17/R26: los chunks 2..N reenvian EXACTAMENTE el token…" · chunk route · "R17/R29: cargaId UUID y totalFiles se propagan al service" |
| R18 | `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts` · "R18: cargaId que no es UUID -> 422…" |
| R19 | idem · "R19: token de lote DESCONOCIDO o de otro usuario -> 403" · `carga-lote.test.ts` · "token DESCONOCIDO…" y "token de OTRO usuario…" · `orden-repository.carga-lote.test.ts` · dos casos · `bulk-orden-service.carga-lote.test.ts` · "R19: tampoco captura el error de lote ajeno" |
| R20 | chunk route · "R20: `name` opcional se propaga al service" y "R20: `name` vacio o demasiado largo -> 422" · api-key route · "R20/R21: `name` opcional se propaga al service (con trim)" y su 422 · service · describe "nombre del lote" |
| R21 | `carga-lote.test.ts` · "R21: persiste el `name` recibido al crear el lote" · `orden-repository.carga-lote.test.ts` · "R21: el `name` del lote llega al INSERT de `carga`" · service · "R20/R21: … propaga el `name`" (ambas vías) |
| R22 | `carga-lote.test.ts` · "R22: sin `name` la fila nace con NULL" · service · "R22: sin `name`… name null" (ambas vías) · chunk route · "R22: sin `name` el service lo recibe como undefined" · `CargaMasivaChunks.test.ts` · "R22: sin nombre, el cuerpo no lleva `name`" |
| R23 | `carga-lote.test.ts` · "R23/R29: al reutilizar NO se reescriben `name` ni `total_files`" · service · "R23: el `name` viaja en todos los chunks, pero el 2.º ya reutiliza el lote por token" |
| R24 | `carga-lote.test.ts` · "R24: el MISMO usuario repitiendo nombre -> CargaNombreDuplicadoError…" y "traduce el P2002…" · `orden-repository.carga-lote.test.ts` · "R24: un `name` ya usado por el actor aborta la insercion" · chunk route · "R24: nombre repetido -> 409 con el nombre" · api-key route · "R24: nombre repetido -> 409…" |
| R25 | `carga-lote.test.ts` · "R25: OTRO usuario con el mismo nombre SI puede crear su lote" |
| R26 | `carga-lote.test.ts` · "R26: N chunks de la misma sesion comparten UNA sola fila" · `CargaMasivaChunks.test.ts` · "R17/R26: los chunks 2..N reenvian…" y "los chunks se envian EN SERIE" |
| R27 | service · "R27: dry-run no persiste nada y el summary trae cargaId null" · `CargaMasivaChunks.test.ts` · "R27: el dry-run NO envia cargaId, name ni totalFiles" |
| R28 | service · "R28: … TODAS duplicadas…" y "R28: … TODAS las filas en error…" · `orden-repository.carga-lote.test.ts` · "un batch cuyas filas YA existen no toca `carga` ni inserta" |
| R29 | service · "R29: total_files = total de la SESION…" y "R29: sin total declarado, cae al tamaño del chunk" · `carga-lote.test.ts` · "R23/R29: al reutilizar NO se reescriben…" · `CargaMasivaChunks.test.ts` · "R29: todos los chunks declaran el total de la SESION" |
| R30 | service · "R30/R31/R32: un lote por peticion…" · `orden-repository.carga-lote.test.ts` · "R30: dos batches internos comparten UN solo lote" |
| R31 | service · "R30/R31/R32: … del usuario de la key …" · repo · el lote creado lleva `usuarioCarga: "key-user-1"` |
| R32 | service · "R30/R31/R32: … total = filas del payload" y "R32: total_files cuenta TAMBIEN las duplicadas y con error" · repo · "R30: … totalFiles: 2 con batchSize 1" |
| R33 | service · "R33: sin ninguna orden creada no se llama al repo y cargaId es null" · repo · "R33/R35: un lote 100% duplicado no crea fila en `carga`" |
| R34 | `orden-repository.carga-lote.test.ts` · "R34: el lote se resuelve DENTRO del mismo $transaction y ANTES del insert" + "R34: si el insert falla, el error se propaga" |
| R35 | idem · "un batch cuyas filas YA existen no toca `carga` ni inserta", "un batch mixto … SI crea el lote", "R33/R35: … 100% duplicado" |
| R36 | idem · "R15/R36: todas las filas del createMany llevan el carga_id…" + "R30: … ambas ordenes cuelgan del MISMO lote" (las duplicadas no entran al INSERT) |
| R37 | idem · "`create` no envia carga_id ni download_url y no toca `carga`" |
| R38 | service · "R38: el summary devuelve el cargaId resuelto por el repo" · chunk route · "R38: la respuesta incluye el cargaId del summary" y "R38: dry-run devuelve cargaId null" |
| R39 | api-key route · "R39: el cargaId viaja en la respuesta…" y "R39: sin ordenes creadas, cargaId es null…" · service · "R39: el summary devuelve el cargaId y conserva el resto de campos" |
| R40 | service · describe "R40 — la via sesion no escribe download_url…" · `carga-lote.test.ts` · "R40: la fila nace SIN download_url" · repo · "R14/R40: la fila insertada no lleva num_guia ni download_url" |
| R41 | service · "R41: un rol distinto de adminTienda…" y "R41: un rol distinto de apiKey…" · chunk route · "R41: la autorizacion no cambia…" · api-key route (401/403 heredados de la 136) |
| R42 | api-key route · "R42/R55: `individual` se propaga al orquestador…" |
| R43 | idem · "R43/R55: sin download_type se aplica `consolidate` y se hace eco del modo" |
| R44 | idem · "R44: un valor fuera del enum -> 422 sin crear ordenes ni tocar Storage" |
| R45 | idem · "R45: el modo no se persiste — el service no recibe download_type" (+ ninguna columna: `carga-migration.test.ts` R3 sobre el SQL ejecutable) |
| R46 | chunk route · "R46: `download_type` NO es parametro de esta via: se ignora y no llega al service" |
| R47 | `tests/unit/services/etiquetas-descarga-service.test.ts` · "R47: genera UN PDF y persiste su URL en carga.download_url" · `orden-repository.carga-lote.test.ts` · "R47: setCargaDownloadUrl actualiza SOLO `download_url`…" · api-key route · "R47/R53: consolidate -> etiquetasPdf con url y TODOS los ordenes[].downloadUrl en null" |
| R48 | `etiquetas-descarga-service.test.ts` · "R48: genera UN PDF por orden y persiste cada URL en SU orden" · `tests/unit/services/etiquetas-lote-pdf-service.test.ts` · "R48: N etiquetas -> N build/upload/firma…" · repo · "R48: setOrdenesDownloadUrl escribe la URL de cada orden en UNA transaccion" + "lista vacia -> no-op" · api-key route · "R48/R54: individual -> cada orden lleva SU downloadUrl…" |
| R49 | `etiquetas-lote-pdf-service.test.ts` · "R49: una orden sin etiqueta imprimible NO aparece en el resultado" · `etiquetas-descarga-service.test.ts` · "R49: la orden sin etiqueta imprimible no recibe URL" · api-key route · "R49/R54: … queda con downloadUrl null" |
| R50 | `etiquetas-descarga-service.test.ts` · "R50: `ordenIds` vacio en modo %s -> no toca Storage ni DB" (ambos modos) · `etiquetas-lote-pdf-service.test.ts` · "R50: cero etiquetas imprimibles -> [] sin tocar Storage" · api-key route · "R39: sin ordenes creadas…" (no se llama al orquestador) |
| R51 | api-key route · "R51: un fallo de generacion en modo individual -> 200, etiquetasPdf { error } y URLs null" · `carga-api-etiquetas.test.ts` · "etiquetasPdf trae { error } y responde 200 cuando el service lanza" · `etiquetas-descarga-service.test.ts` · "R51: un fallo … se PROPAGA" y "R51: un fallo al PERSISTIR tambien se propaga" |
| R52 | `etiquetas-lote-pdf-service.test.ts` · "R52: por encima del tope lanza ANTES de construir o subir nada" + "justo EN el tope si genera" · `carga-api-etiquetas.test.ts` · "lote por encima del tope: 200 con los num_guia intactos…" y "tope de etiquetas en modo individual (R52)" |
| R53 | `carga-api-etiquetas.test.ts` (suite heredada de la 136, intacta sobre `consolidate`) · api-key route · "R47/R53: consolidate -> etiquetasPdf con url…" |
| R54 | api-key route · "R48/R54: individual -> cada orden lleva SU downloadUrl y etiquetasPdf es null" + "R49/R54: … downloadUrl null" |
| R55 | api-key route · "R43/R55: sin download_type … se hace eco del modo" y "R42/R55: `individual` … eco del modo" |

## Verificación (salida real)

Baseline del worktree tras la primera pasada (medido antes del delta):

```
$ pnpm typecheck        → sin errores
$ pnpm lint             → ✖ 144 problems (0 errors, 144 warnings)
$ pnpm test             → Test Files  519 passed (519) · Tests  5275 passed (5275)
```

Tras el delta (segunda pasada):

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm lint
✖ 144 problems (0 errors, 144 warnings)
(mismo recuento que el baseline: el delta no añade errores ni warnings)

$ pnpm test
 Test Files  520 passed (520)
      Tests  5340 passed (5340)
   Duration  206.79s

$ git diff --name-only 1cfb2ed | grep -c '\.tsx$'
0
```

Delta acumulado sobre `origin/dev`: +5 archivos de test, +131 tests, 0 fallos. Nada quedó rojo
por `origin/dev`.

## Desviaciones respecto del spec

1. **T2/T17 · ubicación del test estático de migración.** `tests/integration/db/carga-migration.test.ts`
   (no `tests/unit/db/`): no existe `tests/unit/db/` y las ~50 pruebas de migración del repo viven ahí.
2. **T28 · inyección del endpoint.** `CargaApiDeps.etiquetasService` (feature 136) se sustituyó por
   `descargaService: IEtiquetasDescargaService`. El diseño lo implica (el borde no puede llamar al
   repositorio) pero no lo dice explícitamente; los tests heredados de la 136 se adaptaron a la nueva
   dependencia conservando TODAS sus aserciones sobre `consolidate`.
3. **Guard `hayFilasPorInsertar`** (añadido en la primera pasada al diseño §4.1): se conserva. El
   diseño dice "se invoca solo cuando el batch tiene ≥1 orden que insertar", pero `skipDuplicates`
   puede saltar todas las filas; la comprobación contra el snapshot `before` (ya leído dentro de la
   tx) es lo que hace cierta esa frase y sostiene R28/R35.
4. **Traducción del 409 en el borde, no vía `lib/errors/normalize.ts`.** Ambos route handlers
   traducen explícitamente a `ConflictError(err.message)` para que el mensaje NOMBRE el duplicado
   (R24); el registro genérico `DOMAIN_ERROR_CODE` habría devuelto un mensaje sin el nombre.

No hubo choques con `origin/dev` (137–140): el rename de `order_status`, la guardia central de
transiciones y las etiquetas PDF de la 136 siguen intactas; el lote se resuelve ANTES del
`createMany`, así que la guardia de la 140 corre exactamente donde corría.

## Deuda / puntos abiertos

- **TTL de las URLs firmadas persistidas (design §6.6).** `carga.download_url` y
  `orden.download_url` guardan una URL **con expiración** (`ETIQUETAS_SIGNED_URL_TTL_SECONDS`,
  default 1 h, techo 24 h): pasado el TTL el enlace almacenado devuelve 403 de Storage. Se asume a
  propósito (el consumidor real es la respuesta inmediata del endpoint y hoy no hay ningún lector).
  La solución correcta —persistir el `path`, que `EtiquetasLotePdfResultado` ya devuelve, y
  re-firmar bajo demanda desde un endpoint autenticado— exige una columna (`download_path`) y una
  ruta que este alcance no autoriza. Palanca operativa mientras tanto: subir el TTL hasta 24 h.
- **Sin reintento de los `download_url` en NULL.** Un fallo best-effort deja las columnas en NULL
  (estado consistente y reintentable), pero no hay job que las rellene: el reintento hoy sería
  manual. Una feature posterior puede encolar un job `etiquetas_pdf` por lote.
- **Round-trip real de la migración pendiente.** No se ejecutaron `pnpm db:migrate` ni
  `pnpm db:rollback` (DB compartida). La cobertura es estática; el up→down→up contra Postgres lo
  debe hacer el reviewer. `prisma migrate diff` tampoco se corrió (requiere shadow DB).
- **Carrera residual en R35.** Si entre el `SELECT before` y el `createMany` (misma tx) otra
  transacción inserta TODAS las remisiones del batch, el lote quedaría creado sin órdenes propias.
  Ventana estrecha; compensarlo con un `DELETE` se descartó porque con FK RESTRICT podría fallar por
  órdenes de otro chunk concurrente y abortar un batch sano.
- **Coste del modo `individual`:** N PDFs + N uploads + N firmas bajo el MISMO tope que el
  consolidado (`MAX_ETIQUETAS_POR_PDF`, default 300) y el `maxDuration = 60` de la ruta. Si en
  producción se observa presión, la palanca es un tope propio (alternativa O, hoy descartada).
- **Sin UI ni listado por lote** (gate F1.4-5): `carga_id`, `name` y las URLs se persisten y se
  devuelven; nadie las pinta todavía.

---

## Reintegración contra `dev` (2026-07-29) — merge del lote 153–160

La rama estaba **188 commits por detrás de `dev`**. `git merge origin/dev` dio **19 archivos en
conflicto**; ninguno semántico: la 141 es ortogonal al flujo de estados (aporta el modelo `Carga`,
`orden.carga_id` / `orden.download_url` y el cableado de `cargaId`, y no toca estados, fulfillment
ni transiciones), así que los choques fueron **textuales** — las dos features editaron las mismas
funciones.

**Regla aplicada en todo archivo compartido:** `dev` es AUTORITATIVO en la lógica de estados y de
creación; la 141 solo vuelve a enhebrar `cargaId` sobre esa base. Nunca al revés.

### Lo que se preservó de `dev`

- **155** — `resolverDestinoCreacion(...)` sobre el flag `fulfillment` de la tienda dueña en las dos
  vías; la bifurcación de `cargarMasiva` entre `createManyOrdenesConGuia` (rama b) y
  `createManyOrdenes` (rama a); `opciones.conGuia`; el bloque `manifiesto` de la respuesta de la
  API key; la desaparición de `ESTATUS_INICIAL_API`; el retiro del value `en_fulfillment`.
- **153/154/156** — `en_reparto`, catálogo v2 y `generarGuia` con destino único.
- **144/146/159** — índices de filtros y relaciones de `Notificacion` en `schema.prisma`; el aviso
  `carga_masiva_terminada` con su `loteId` propio; el retiro de `mensajero_sugerido_id` y de los
  métodos de `IOrdenRepository` que se fueron con él.

### Resolución de los 7 archivos de código

| archivo | resolución |
|---|---|
| `lib/services/BulkOrdenService.ts` | base `dev`; el `LoteContexto` se extrae a una variable ÚNICA que alimenta las DOS ramas de la 155 (el lote es del canal de carga, no del destino físico); `cargarViaApi` pasa `lote` (4.º) y `{ conGuia }` (5.º) y el `cargaId` viaja en el summary |
| `lib/repositories/OrdenRepository.ts` | `createManyOrdenesConGuia(data, batchSize, historial, lote, opciones?)`: `lote` requerido antes de `opciones`; se conservan el `conGuia` y el encolado de geocodificación de la 155 y se devuelve `{ creadas, cargaId }`; se aceptó la eliminación del bloque de la feature 16 que la 159 borró |
| `lib/interfaces/repositories/IOrdenRepository.ts` | unión: `LoteContexto`, los 2 errores de dominio y `setCargaDownloadUrl`/`setOrdenesDownloadUrl` sobre las firmas de `dev` (`CreateOrdenOpciones` incluido) |
| `lib/interfaces/services/IBulkOrdenService.ts` | unión de docs; `cargaId` en `CargaViaApiSummary`, `destino` de la 155 intacto |
| `app/api/ordenes/api-key/carga/route.ts` | `descargaService` (141) **y** `manifiestoService` (155) en `CargaApiDeps`; schema con `name` + `download_type`; la respuesta suma `downloadType`, `ordenes[].downloadUrl` y conserva `etiquetasPdf` **y** `manifiesto` |
| `app/(app)/ordenes/_components/carga-masiva-chunks.ts` | filas sin `aplicarMensajero` (159) + el cuerpo con `cargaId`/`name`/`totalFiles` (141) |
| `db/schema.prisma` | unión pura: relaciones de `Notificacion` + `cargasRealizadas`; índices de la 144 + `@@index([cargaId])` |

`db/migrations/20260727120000_carga_orden_carga_id/` quedó **intacta** (verificado con
`git diff`). Su timestamp la deja ANTES de las migraciones 0728/0729 de `dev`: `migrate deploy`
la aplicará fuera de orden de fecha, sin conflicto (solo crea `carga` y dos columnas de `orden`).

### Tests

- `feature_list.json`: se conservó la ficha de `dev` (que ya nombra el PR #168) y las 18 fichas
  142–160; convención `merged_pr` intacta.
- `specs/141-*`: `dev` traía un snapshot **viejo** (R1–R30) del propio spec de la 141; se tomó la
  versión de la rama (R1–R55), que es la vigente.
- `tests/integration/db/zonas-migration.test.ts`: denylist resuelta por **UNIÓN**.
- `tests/integration/api/ordenes-api-key-carga.route.test.ts` y `carga-api-etiquetas.test.ts`: se
  conservaron **ambos** bloques de casos (141 y 155); los dobles de la 141 inyectan además
  `manifiestoService` y `destino`.
- `tests/unit/services/bulk-orden-service.carga-lote.test.ts`: las filas de la vía sesión pasan a
  `direccion_destinatario` (142) y las de la vía API conservan las columnas separadas (142/R38);
  los casos que afirman el contexto del lote se ejecutan **sobre las dos ramas** de la 155
  (`describe.each`) preguntando por la ruta usada, no por un método fijo.
- `tests/unit/repositories/orden-repository.carga-lote.test.ts`: el estado de creación pasa de
  `en_ruta_bodega_central` (que la 155 retiró de `ESTADOS_CREACION`) a `por_recolectar_en_tienda`.
- `tests/unit/repositories/orden-repository.creacion-bifurcada.test.ts` (de `dev`): el fake de
  Prisma gana el delegate `carga` y las llamadas el 4.º parámetro.
- Se aceptó el borrado de `tests/unit/services/asignacion-mensajero-service.test.ts` (la 159 borró
  el service entero).

### Verificación real tras el merge

```
pnpm db:generate  -> Generated Prisma Client (v7.8.0)
pnpm typecheck    -> 0 errores
pnpm lint         -> 10 problems (0 errors, 10 warnings)   [las 10 preexistentes en dev]
pnpm test         -> Test Files 587 passed (587) | Tests 6523 passed (6523)
./init.sh         -> == init OK ==
```

### AVISO PARA EL REVIEWER

El informe `progress/review_141.md` (APROBADO-CON-NOTAS, 2026-07-27) se emitió contra una base que
desde entonces cambió en **188 commits**, incluida la reescritura de `BulkOrdenService`,
`OrdenRepository` y el borde de la API key — los mismos módulos que esta feature toca. **Esta
reintegración NO revalida ese review.** Hace falta un re-review del merge antes de mergear el PR
#168.
