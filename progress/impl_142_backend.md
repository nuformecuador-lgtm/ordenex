# Feature 142 — Bloque B (backend). Bitácora de implementación

Rama: `feature/142-plantilla-carga-masiva-v2` (worktree `ordenex-wt-142`, base `origin/dev` @ `97f6e91`).
Alcance ejecutado: **B1–B8** de `specs/142-plantilla-carga-masiva-v2/tasks.md`.
Fuera de alcance (otros subagentes): F1–F4, C1, C2, T1, T2.

## 1. Archivos tocados

| Archivo | Tarea | Cambio |
| --- | --- | --- |
| `lib/utils/direccion-destinatario.ts` | B1 | **NUEVO**. Parser puro: `FORMATO_DIRECCION_DESTINATARIO`, `DireccionDestinatarioPartes`, `ParseDireccionResult`, `parseDireccionDestinatario`. Sin imports de Prisma / `next/*` / Supabase / `process.env` |
| `tests/unit/utils/direccion-destinatario.test.ts` | B2 | **NUEVO**. 31 casos, uno o más por R11–R28 |
| `lib/types/carga-masiva.ts` | B3 | `REQUIRED_HEADERS` → `[num_remision, destinatario, telefono, direccion_destinatario]`; `filaCargaSchema` pierde `provincia`/`canton`/`distrito`/`direccion` y gana `direccion_destinatario` (trim, default `""`) |
| `tests/unit/types/carga-masiva.test.ts` | B3 | **NUEVO**. 10 casos de cabecera + schema |
| `lib/services/BulkOrdenService.ts` | B4 | `GeoInput`, `GeoInputExtractor`, `geoInputDesdeDireccionUnificada`, `geoInputDesdeColumnasSeparadas`; `resolveFila` recibe el extractor; `cargarMasiva` inyecta el unificado y `cargarViaApi` el separado; `createData.direccion` sale de `geoInput.direccion` |
| `tests/unit/services/bulk-orden-service.test.ts` | B5 | Fixtures migradas a `direccion_destinatario` (helper `dir()`); casos nuevos de R9/R26/R27/R29/R30/R31/R32/R37/R39 |
| `tests/unit/services/bulk-orden-service.carga-api.test.ts` | B6 | **Solo añadido** un `describe` con 2 casos de no-regresión de R38. El resto del archivo intacto |
| `specs/142-plantilla-carga-masiva-v2/tasks.md` | — | B1–B8 marcadas `[x]` |
| `progress/impl_142_backend.md` | — | este archivo |

**Sin cambios (verificados con `git diff` vacío)**: `resolveGeo` (dentro de
`BulkOrdenService.ts`, ni firma ni mensajes ni comportamiento),
`app/api/ordenes/carga-masiva/chunk/route.ts`, `app/api/ordenes/api-key/carga/route.ts`
(B7), `db/schema.prisma` y `db/migrations/` — sin carpeta de migración nueva (B8, R40).

## 2. Decisión estructural aplicada (design.md §4)

`filaCargaSchema` y `resolveFila` los comparten `cargarMasiva` (UI) y `cargarViaApi`
(feature 88, contrato **público**). Por eso el parseo de `direccion_destinatario`
**no** entró en `filaCargaSchema` ni en `resolveGeo`, sino en un extractor de
geografía inyectado por vía:

- vía UI → `geoInputDesdeDireccionUnificada` (usa el parser);
- vía API key → `geoInputDesdeColumnasSeparadas` (lee `provincia`/`canton`/`distrito`/`direccion`
  con el mismo `trim()` que antes hacía el schema; contrato 88 sin cambios).

`resolveGeo` sigue recibiendo los mismos 3 nombres. `tests/unit/services/bulk-orden-service.carga-api.test.ts`
pasa **sin que se modificara ninguno de sus casos previos** (guard de R38).

## 3. Mapa `R<n>` → test (requisitos cubiertos por el bloque B)

| R | Archivo de test | Nombre del caso |
| --- | --- | --- |
| R6 | `tests/unit/types/carga-masiva.test.ts` | `R6: exige exactamente num_remision, destinatario, telefono y direccion_destinatario` / `R6/R5: ya no exige columnas geograficas separadas` |
| R7 | `tests/unit/types/carga-masiva.test.ts` | `R7: cabecera sin direccion_destinatario -> se reporta como obligatoria ausente` |
| R8 (parte backend) | `tests/unit/types/carga-masiva.test.ts` | `R8/R9: la plantilla vieja (4 columnas geograficas) falla la cabecera por direccion_destinatario` (el copy del mensaje es F2/F4) |
| R9 | `tests/unit/types/carga-masiva.test.ts` + `tests/unit/services/bulk-orden-service.test.ts` | `R8/R9: la plantilla vieja …` · `R9: las columnas viejas presentes en el archivo se ignoran (no hay modo compatibilidad)` · `R9/R39: la columna direccion vieja NO se usa como direccion literal` |
| R10 | `tests/unit/types/carga-masiva.test.ts` | `R10: columnas extra desconocidas ademas de las obligatorias no producen error de cabecera` |
| R11 | `tests/unit/utils/direccion-destinatario.test.ts` | `R11: solo los TRES primeros '/' son separadores; el resto queda en la direccion` |
| R12 | idem | `R12: el pais se descarta sin validarlo y no aparece en el resultado` · `R12: pais vacio, con texto arbitrario o con numeros -> mismo resultado` |
| R13 | idem | `R13: %s -> error de formato citando el formato esperado` (3 casos: sin `/`, uno, dos) |
| R14 | idem | `R14: con exactamente tres '/' produce provincia, canton, distrito y direccion` |
| R15 | idem | `R15: conserva los '/' posteriores al tercero y los espacios internos sin colapsar` |
| R16 | idem | `R16: una direccion que termina en '/' conserva ese '/' final` |
| R17 | idem | `R17: recorta extremos de provincia, canton, distrito y direccion; deja los internos` · `R17: los espacios internos de cada segmento se conservan` |
| R18 | idem | `R18: el distrito sale del primer parentesis y el canton de lo que lo precede` · `R18: un ')' dentro del distrito no confunde: cierra en el primer ')' posterior` |
| R19 | idem + `bulk-orden-service.test.ts` | `R19: sin parentesis de distrito -> error indicando que falta el distrito` · `R19: sin parentesis de distrito -> error de fila en direccion_destinatario (la zona se deriva del distrito)` |
| R20 | `direccion-destinatario.test.ts` | `R20: %s -> error de campo` (parentesis vacio / con solo espacios) |
| R21 | idem | `R21: parentesis abierto y no cerrado -> error de campo` |
| R22 | idem | `R22: texto no vacio despues del ')' -> error de campo` · `R22: solo espacios despues del ')' -> se ignoran sin error` |
| R23 | idem | `R23: %s -> error de campo` (provincia vacia / con solo espacios) |
| R24 | idem | `R24: %s -> error de campo` (canton vacio / con solo espacios) |
| R25 | idem | `R25: %s -> error de obligatoriedad citando el formato esperado` (vacio / solo espacios / tabuladores) |
| R26 | idem + `bulk-orden-service.test.ts` | `R26: direccion literal vacia tras recortar espacios -> se acepta con direccion ''` · `R26/R37: direccion literal vacia -> la fila se crea y persiste direccion null` |
| R27 | idem + `bulk-orden-service.test.ts` | `R27: entrega los nombres tal cual, con acentos y mayusculas del archivo` · `R27: no colapsa espacios repetidos internos …` · `R27/R33: acentos y mayusculas en la columna unica resuelven la misma geografia` |
| R28 | `direccion-destinatario.test.ts` | `R28: nunca lanza para ninguna entrada string` · `R28: es determinista — la misma entrada produce el mismo resultado` |
| R29 | `bulk-orden-service.test.ts` | `R29: fila imparseable -> resultado error con la clave direccion_destinatario y mensaje accionable` · `R29: %s -> error de fila bajo direccion_destinatario, sin crear la orden` (8 casos) |
| R30 | idem | `R30/R32: un lote mixto crea las validas y cuenta las imparseables en conError` |
| R31 | idem | `R31: dryRun y carga en firme clasifican igual las filas imparseables` · `R31: el mismo archivo troceado en dos lotes clasifica igual que en uno solo` |
| R32 | idem | `R30/R32: un lote mixto crea las validas y cuenta las imparseables en conError` |
| R33 | idem | `deriva zonaId desde el distrito resuelto` · `R27/R33: acentos y mayusculas …` |
| R34 | idem | `provincia inexistente -> error de fila con fieldError geografico` |
| R35 | idem | `canton ambiguo dentro de la provincia -> error de fila` · `canton no encontrado dentro de la provincia -> error de fila` |
| R36 | idem | `distrito sin zona asignada -> error de fila` · `distrito provisto pero inexistente en el canton -> error de fila` |
| R37 | idem | `R37: la direccion literal se persiste en el campo direccion de la orden` · `R26/R37: … persiste direccion null` |
| R38 | `bulk-orden-service.carga-api.test.ts` | `R38: fila con provincia/canton/distrito separados y SIN direccion_destinatario se crea igual` · `R38: una columna direccion_destinatario presente en el payload API es ignorada …` + los 21 casos previos del archivo, intactos |
| R39 | `carga-masiva.test.ts` + `bulk-orden-service.test.ts` | `R39: conserva la semantica de num_remision/destinatario/telefono/producto/monto_cobrar/notas` · `R39: la columna peso del archivo no se persiste (peso null)` |
| R40 | verificación B7/B8 | `git diff` vacío en ambos `route.ts`, `db/schema.prisma` y `db/migrations/`; `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts` y `ordenes-api-key-carga.route.test.ts` pasan sin tocarse |

R1–R5 (forma de la plantilla) son del bloque F/C: no los cubre este bloque.

## 4. Baseline vs. final (números reales)

Medidos en el worktree, tras `pnpm db:generate` (con `DATABASE_URL` dummy: el
worktree no tiene `.env`; `prisma generate` no accede a la DB).

| Métrica | Baseline (antes de tocar código) | Final (bloque B cerrado) |
| --- | --- | --- |
| `pnpm typecheck` | **0 errores** | **1 error** — `tests/integration/carga-masiva-plantilla-roundtrip.test.ts(69,19)`: `Property 'distrito' does not exist …` |
| `pnpm lint` | 0 errores, 144 warnings | **0 errores, 144 warnings** (delta 0) |
| `pnpm test` — archivos | 1 failed / 514 passed (515) | **2 failed / 515 passed (517)** |
| `pnpm test` — tests | 1 failed / 5208 passed (5209) | **7 failed / 5263 passed (5270)** |

### Detalle de los fallos finales (7)

| Archivo | Tests | Tarea que lo cierra |
| --- | --- | --- |
| `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` | 4 | **C1** (fuera de mi alcance) |
| `tests/components/OrdenesCargaUpload.test.tsx` | 3 (`HEADERS_OK` aún sin `direccion_destinatario`) | **F4** (fuera de mi alcance) |

El único error de typecheck es en el mismo archivo de C1 (línea 69:
`filaCargaSchema.parse(rows[0]).distrito`, campo que B3 elimina del schema).

Ambos archivos están inventariados en `design.md §6` como **"rompe → reescribir"**
y asignados explícitamente a C1 y F4. El bloque B no puede dejarlos verdes sin
invadir esas tareas. **Delta atribuible al bloque B en sus propios archivos: 0
fallos** (los 7 fallos están en archivos que el diseño asigna a otros bloques).

Nota sobre el baseline: el fallo del baseline
(`tests/components/LoginForm.test.tsx > … verifyChallenge`, 1 test) **pasó** en la
corrida final. Es un test flaky por `waitFor`/timers, preexistente y ajeno a esta
feature; no lo toqué.

### Suites relevantes en verde (corridas aisladas)

- `tests/unit/utils/direccion-destinatario.test.ts` → 31/31.
- `tests/unit/types/carga-masiva.test.ts` → 10/10.
- `tests/unit/services/bulk-orden-service.test.ts` → 54/54.
- `tests/unit/services/bulk-orden-service.carga-api.test.ts` → 23/23 (21 previos + 2 nuevos).
- `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts` + `ordenes-api-key-carga.route.test.ts` → pasan sin cambios.

## 5. Deuda y desviaciones

1. **Bloqueantes para T1**: C1 (round-trip) y F4 (`OrdenesCargaUpload`) deben
   cerrarse para que typecheck y la suite vuelvan al verde del baseline. Nada más
   del bloque B queda pendiente.
2. **Rama muerta parcial en `resolveGeo`**: la validación `raw.distrito.trim() === ""`
   ("distrito requerido: la zona de la orden se deriva del distrito") ya no es
   alcanzable desde la vía sesión (el parser rechaza antes, R19/R20). Sigue viva
   para la vía API key, así que **no se tocó** (`resolveGeo` con diff vacío, R38).
   El test antiguo "sin distrito → error de fila" se reescribió como el caso R19
   de la vía sesión.
3. **`peso`**: sigue fuera de alcance por decisión del humano; el service persiste
   `peso: null` y hay un test que lo fija (R39).
4. **Ejemplo canónico de la plantilla**: no se sustituyó ni se evaluó aquí; su
   guard contra el seed es C2.
5. **Sin migración, sin RLS, sin endpoints nuevos** (R40), confirmado en B7/B8.
