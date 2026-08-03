# Review — Feature 177 (API: consulta de orden por guia o remision + PDF por orden y por carga)

**Reviewer.** Rama `feature/177-api-consulta-orden-pdf`, diff `origin/dev...HEAD` (3 commits propios,
45 archivos, +5764/-25). Spec: `specs/177-api-consulta-orden-pdf/` (45 R, 23 T).
Bitacora: `progress/impl_177.md`.

## Veredicto

**APROBADO — OK.** Cero hallazgos bloqueantes. 45/45 requisitos verificados abriendo el test citado
y comprobando que MIDE lo que dice medir (no se acepto la tabla de la bitacora como prueba).

---

## Checklist de CHECKPOINTS.md

### Especificacion
- [x] `requirements.md` con requisitos EARS numerados R1-R45.
- [x] `design.md` con alternativas descartadas y su porque (seccion 3: A reusar `download_url`,
      B parsear la URL firmada, C probe a Storage, D devolver la URL persistida, E ampliar el
      endpoint de la 106; mas las descartadas en la puerta F1.4).
- [~] `tasks.md`: T1-T22 en `[x]`; **T23 sigue en `[ ]`** (el gate completo es del leader por regla
      de sesion, y el leader ya lo corrio). Bookkeeping pendiente, no defecto de implementacion.

### Trazabilidad
- [x] Cada R1-R45 mapea a al menos un test concreto **que lo verifica de verdad** (detalle abajo).
- [x] `progress/impl_177.md` contiene el mapa `R<n> -> test` completo y las 27 mutaciones.

### Calidad de codigo
- [x] `pnpm typecheck` — 0 errores (corrido por mi).
- [x] `pnpm lint` — **0 errores**, 41 warnings (27 preexistentes + 14 nuevos por `_param` en dobles
      `vi.fn`). Desviacion declarada; el umbral de `init.sh` es "sin errores".
- [x] Tests — corridos por mi: los 13 archivos de la feature (163 tests, verdes) y los 9 de
      contrato/no-regresion del canal api-key (96 tests, verdes). No corri la suite entera: el
      leader la corrio (855 archivos / 10682 tests, unico rojo `ControlDescargaTransversal`, flake
      de jsdom conocido y ajeno a la feature).
- [x] E2E: no aplica. Backend puro sobre canal por API key, sin UI; la ingesta de ordenes no se
      toca — los tres endpoints son de LECTURA y de generacion de PDF.

### Datos y seguridad
- [x] **Sin tablas nuevas** => no hay RLS nueva que exigir. `orden` y `carga` conservan su politica.
- [x] Migracion `db/migrations/20260803120000_download_storage_path/` con `migration.sql`
      (2 `ADD COLUMN` nullable) y `down.sql` (2 `DROP COLUMN` en orden inverso). **Ninguna sentencia
      menciona `download_url`** (solo aparece en comentarios). Aditiva, sin backfill, sin indice.
- [x] Sin secretos hardcodeados. El TTL sale de `ETIQUETAS_API_SIGNED_URL_TTL_SECONDS`
      (default 300, clamp [1, 86400]), documentado en `.env.example`.
- [x] Sin webhooks nuevos.

### Patron de capas
- [x] Los tres controllers solo hacen HTTP + zod + delegacion; ninguna query Prisma en `app/`
      (los `new OrdenRepository(...)` son composition root, patron ya vigente en
      `app/api/ordenes/api-key/[numGuia]/route.ts`).
- [x] `ApiOrdenResolucionService` y `ApiPdfEtiquetaService` no conocen Request/Response/headers.
- [x] Los 5 metodos nuevos de `OrdenRepository` son queries puras.
- [x] Interfaces nuevas en `lib/interfaces/services/` y firmas nuevas en
      `lib/interfaces/repositories/IOrdenRepository.ts`.

### Permisos / multi-pais
- [x] Canal por API key: el owner sale SIEMPRE de `actor.usuarioId`; no hay paginas ni Server Actions.
- [x] Sin hardcode de pais, moneda ni cuenta. TTL, bucket y tope por PDF van por configuracion.

### Verificacion final
- [x] `pnpm typecheck` + `pnpm lint` + tests relevantes verdes (corridos por mi). El gate completo
      `./init.sh` lo corrio el leader.
- [x] `progress/review_177.md` (este archivo), veredicto OK.
- [ ] Entrada en `progress/history.md` — **pendiente del leader** al aterrizar el PR.

---

## Verificacion de los siete puntos pedidos

### 1. Trazabilidad R->test, los 45 abiertos uno a uno

Verifique el test citado para cada R y que su asercion discrimine. Muestras de lo comprobado:

- **R7/R10/R12** (`orden-repository.api-consulta-pdf`): se afirma el ARGUMENTO que llega a Prisma
  (where.tiendaId, where.deletedAt: null, where.OR con valores primitivos y sin
  contains/startsWith/mode/search). No es un test de "devuelve algo".
- **R8**: dos niveles — el repo NO emite condicion sobre numGuia cuando llega null (el where
  serializado no contiene "numGuia"), y el service manda numGuia: null para "007", "0", "-3",
  "1.5", "1e3", "0x10", "+7", "12abc" y "2147483648", con control positivo en el limite exacto de
  int4 (2147483647 SI es candidato).
- **R16/R17**: `findDetalleByOrdenIdForOwner` y `findDetalleByNumGuiaForOwner` comparten proyeccion
  y el test afirma que el select de una es igual al de la otra, y que el DTO resultante coincide.
- **R18**: barrido de cadenas prohibidas sobre el JSON de la respuesta 200 (storagePath,
  storage_path, buckets, el id interno "orden-A", tiendaId, usuarioId, store-1, mensajero).
- **R22/R23**: el firmador devuelve una URL DISTINTA en cada llamada y el test afirma que la de la
  segunda no es la de la primera; en el service, la signedUrl que devuelve el generador es
  literalmente "https://caducada.invalid/..." y se afirma que NO aparece en el resultado.
- **R26/R35**: no se confia en un mock del repo — `api-pdf-etiqueta-columna-intacta` monta un Proxy
  de Prisma que intercepta TODOS los modelos y metodos, APLICA los updates sobre la fila-fixture y
  afirma la lista COMPLETA de claves escritas (solo downloadStoragePath), el estado final de
  downloadUrl/estatusId/numGuia/cargaId/name/totalFiles, y cero filas en ordenHistorialEstado.
  Es la pieza mas fuerte del paquete.
- **R34**: se usa el `EtiquetasLotePdfService` REAL con build y upload espiados en 0 llamadas —
  prueba que el corte por tope ocurre ANTES de construir, no solo que devuelve 409.
- **R5**: el hash se calcula con el `hashApiKey` de produccion (no una derivacion supuesta) y se
  busca la key y su hash en cuerpo crudo, headers y los 5 canales de console.*; el caso 500 ademas
  afirma que el logger fue invocado, asi que el test no pasa por vacio.
- **R40**: los 3 pathnames nuevos + **control negativo** (/api/ordenes/orden/ABC-123 sigue
  redirigiendo 307 a /login), sin el cual el bloque pasaria con un middleware permisivo.
- **R44**: se enumeran los 7 verbos HTTP exportados por el modulo y se afirma exactamente ["POST"],
  no solo que GET sea undefined.

Las 27 mutaciones de la bitacora son consistentes con lo que lei en los tests (la #8, precedencia
invertida, solo puede caer si el test discriminante afirma el id; la #18 solo puede caer si el guard
compara contra un literal congelado).

### 2. R14, el discriminante — los tres tests verificados uno a uno

- **Service** (`api-orden-resolucion-service`): fixture A con numGuia=100234 / numRemision="REM-A"
  y B con numGuia=null / numRemision="100234"; afirma que el id devuelto es "A", que NO es "B" y que
  via es "num_guia". **Y un segundo test invierte el orden de las filas del repo ([B, A])** para
  demostrar que la precedencia no es "la primera fila". Discrimina.
- **Consulta e2e** (`ordenes-api-key-orden-consulta.route`): usa el service REAL sobre repo fake,
  filas [ORDEN_B, ORDEN_A], y afirma json.numRemision === "REM-A" y !== "100234", mas
  detallePorOrdenId llamado con "orden-A" y NO con "orden-B". Afirma la identidad, no la presencia
  de respuesta.
- **Generate e2e** (`ordenes-api-key-orden-generate.route`): con [ORDEN_B, ORDEN_A] afirma porOrden
  llamado con "orden-A" y **generarYAlmacenarPorOrden llamado con ["orden-A"]** — el testigo es el
  ordenId que llega al generador, exactamente lo pedido.

Los tres son distintos entre si y ninguno se conforma con "hay 200".

### 3. Testigo de existencia = download_storage_path, nunca download_url

- `ApiPdfEtiquetaService.ts` menciona download_url **solo en dos comentarios**; no hay una sola
  lectura ni escritura de esa columna en el service.
- `findDownloadStoragePathByOrdenForOwner` proyecta unicamente downloadStoragePath y el test afirma
  que esa es la UNICA clave del select: download_url no entra en la proyeccion.
- `findCargaConOrdenesForOwner` proyecta downloadStoragePath + los ids de ordenes; nada de
  downloadUrl.
- Las dos ramas de decision son "pathPersistido !== null" y "carga.downloadStoragePath !== null".
  No existe ninguna rama que consulte download_url.
- `/generate` **no la escribe ni la altera**: los dos update llevan un data de una sola clave, y el
  test de columna-intacta lo confirma sobre el ESTADO FINAL de la fila (la downloadUrl heredada
  sigue igual tras generar).
- La migracion no la menciona en ninguna sentencia.

### 4. Aislamiento por owner en los tres endpoints

- **Consulta**: resolver -> findByGuiaORemisionForOwner(..., actor.usuarioId) con tiendaId +
  deletedAt en el WHERE; luego detallePorOrdenId -> findDetalleByOrdenIdForOwner, tambien
  owner-forzado. Doble reja.
- **Generate orden**: misma resolucion + porOrden, que lee findDownloadStoragePathByOrdenForOwner y,
  si es null, desambigua con findDetalleByOrdenIdForOwner **antes** de tocar el generador. El test
  de aislamiento afirma generarYAlmacenarPorOrden en **0** invocaciones y createSignedUrl en **0**
  para un id ajeno. IEtiquetasLotePdfService nunca recibe un id que no haya pasado por el WHERE del
  owner.
- **Generate carga**: findCargaConOrdenesForOwner exige usuario_carga = ownerId en el WHERE (el test
  compara el where completo), y los ordenIds del lote se acotan ademas a tiendaId = ownerId y
  deletedAt: null. Generador en 0 invocaciones para carga ajena.
- **"Ajena" indistinguible de "inexistente"**: comprobado a nivel de BYTES en los dos endpoints
  auditables — consulta (el texto de las dos respuestas es identico) y carga (idem, mas la
  afirmacion de que el cuerpo no refleja el uuid consultado).

### 5. No-regresion de las features 88 y 106, con lupa en el refactor del bloque E

- **El guard NO se compara contra la constante de produccion.** `orden-repository.no-regresion-106`
  declara SELECT_DETALLE_106 como **literal congelado dentro del propio test**, con el comentario
  explicito de que importar API_ORDEN_DETALLE_SELECT seria tautologico. Verificado leyendo el
  archivo: no hay import de esa constante. La asercion es igualdad estructural contra el literal,
  mas la comparacion de claves de primer nivel y de gestiones.select. **Es el unico modo en que ese
  guard prueba algo, y esta hecho asi.** La mutacion #18 es coherente con eso.
- El mismo archivo fija aridad 2, existencia en la interfaz (con un chequeo de tipo que romperia el
  typecheck si cambiara la firma), el where exacto de la 106, la existencia fisica de los dos
  archivos de ruta y que exportan solo GET y solo PUT.
- `detallePorOrdenId` es **adicion pura**: detalle(actor, numGuia) conserva firma, cuerpo y
  proyeccion; el refactor solo extrajo el helper privado toDetalleDTO.
  `app/api/ordenes/api-key/[numGuia]/**` no tiene ni una linea de diff.
- Corri los 9 archivos del canal api-key (detalle, cancelar, carga de la 88, listado, seguridad,
  guards de OpenAPI): 96 tests verdes, **sin que ninguno haya sido editado** salvo tres archivos que
  solo ganan stubs en fakes exhaustivos (+1, +1, +6 lineas; ningun assert tocado, verificado en el
  diff).

### 6. Migracion

Aditiva (2 columnas nullable), down.sql presente con las mismas dos sentencias en orden inverso, sin
backfill, sin indice, **cero menciones a download_url fuera de comentarios**. El round-trip
(migrate deploy -> db:rollback -> re-aplicar -> migrate diff --exit-code = 0) esta pegado en la
bitacora; no lo re-ejecute para no escribir en la base compartida. La imposibilidad de usar
`pnpm db:migrate` es **drift preexistente y ajeno** (migracion fantasma
20260728120000_orden_historial_origen_deshacer_asignacion en el registro local): lo confirmo como no
imputable a la 177, y queda como punto abierto para el humano.

### 7. Contrato publico

- openApiSpec.paths pasa de 4 a **7 claves**, en el orden esperado; el .yaml declara los mismos 7
  paths **en el mismo orden** y trae los tres operationId nuevos (detalleOrdenPorIdentificador,
  generarPdfOrden, generarPdfCarga).
- CargaResponse.cargaId se declara type ["string","null"] con format uuid y **NO** entra en required
  — decision correcta y bien fundada: BulkOrdenService devuelve cargaId null cuando no se creo
  ninguna orden. El .yaml lo espeja y el ejemplo publicado muestra el mismo uuid literal en ambos
  artefactos (el test lo cruza).
- PdfGenerateResponse con url / expiraEnSegundos / generado requeridos, en TS y en .yaml.
- Los tres endpoints reutilizan las responses de error existentes por $ref; el detalle nuevo
  reutiliza el schema OrdenDetalle de la 106.
- **Los guards preexistentes siguen verdes SIN haber sido editados**: verificado en el diff
  (openapi-contrato-en-reparto.test.ts y openapi-carga-row-paridad.test.ts no aparecen) y
  corriendolos.

---

## Hallazgos

Ninguno bloqueante.

- **menor** — tasks.md T23 queda en `[ ]`. CHECKPOINTS exige todas las tasks en `[x]`; el gate lo
  corre el leader por regla de sesion, asi que es bookkeeping y no trabajo faltante. Cerrar al
  aterrizar.
- **menor** — Falta la entrada de la 177 en `progress/history.md` (checkpoint de verificacion
  final). Corresponde al leader al mergear.
- **menor** — `pnpm lint` sube de 27 a 41 warnings (0 errores) por parametros `_` en dobles vi.fn.
  Desviacion declarada; mismo patron ya presente en el repo. Aceptable.
- **menor** — `ApiPdfEtiquetaService.porOrden` linea 71:
  `resultados.find((r) => r.ordenId === ordenId) ?? resultados[0]`. El fallback `?? resultados[0]`
  podria persistir en la orden el path de OTRA orden si el generador devolviera un resultado con
  ordenId distinto. Hoy es inalcanzable (la entrada es [ordenId]), pero el fallback no aporta nada
  que no aporte el find y suaviza un invariante. Sugerencia, no exigencia: quitarlo.
- **menor** — Incoherencia cosmetica entre composition roots: el /generate por CARGA instancia
  EtiquetasLotePdfService con SIGNED_URL_TTL_SECONDS (3600) mientras el de ORDEN usa
  API_SIGNED_URL_TTL_SECONDS (300). Sin efecto observable —la URL que devuelve el generador se
  descarta y ApiPdfEtiquetaService re-firma siempre con el TTL de la API, de modo que R23/R24 se
  cumplen en ambos—, pero conviene unificar para que nadie lea 3600 y crea que es el TTL publicado.
- **menor** — La segunda lectura owner-forzada de porOrden (desviacion 1 declarada) es correcta y la
  prefiero al existsOrdenForOwner alternativo: reusa un metodo ya probado y no anade superficie al
  repositorio. Sin accion.
- **menor** — excede_tope en /generate por orden se mapea a 409 sin test propio por inalcanzable
  (desviacion 6). Aceptado: es una rama defensiva de un switch exhaustivo, y R34 queda cubierto por
  la via de carga con el generador real.
- **menor** — Los build*Service() de los tres route handlers (composition root real con Prisma y
  Supabase) no estan cubiertos por tests, igual que el resto del canal api-key. Deuda preexistente
  del repo, no de esta feature.

## Riesgo declarado (a): confirmado, no es hallazgo

La precedencia fija deja inalcanzable por esta ruta la orden cuya num_remision colisiona con la
num_guia de otra orden propia, en silencio. Es la decision (a) del humano, esta documentada en
requirements.md, en design.md y en la bitacora, y **queda fijada por los tres tests discriminantes
de R14**. Lo doy por asumido conscientemente.

## Nota para la feature 178

Sigue vigente y debe entrar en su spec: la purga tiene que poner tambien `download_storage_path` a
NULL al borrar el objeto. Si solo limpia `download_url`, /generate devolvera URLs firmadas de
objetos inexistentes (R37 lee la columna nueva).
