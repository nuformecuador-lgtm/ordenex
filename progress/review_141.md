# review_141 — Tabla `carga` + `carga_id`/`download_url` en `orden`

> Worktree `ordenex-wt-141`, rama `feature/141-tabla-cargas-orden` (base `origin/dev` @ 1cfb2ed).
> Commits revisados: e7ea97f, 358efec, daaa1c1, 287368d, 8616ffe, 0bd6ed3 (+ 3c0cd4c de spec).
> El reviewer NO edito codigo. Verificacion ejecutada por el reviewer en el propio worktree.

## Veredicto

**APROBADO-CON-NOTAS** — 0 bloqueantes, 8 notas menores.

## Checklist (CHECKPOINTS.md)

### Especificacion
- [x] requirements.md con R1-R30 EARS numerados.
- [x] design.md con 6 alternativas descartadas y su porque (seccion 7: A-F).
- [x] tasks.md con las 15 tasks (T0-T14) marcadas [x] + notas de ejecucion honestas.

### Trazabilidad
- [x] Los 30 requisitos mapean a un test que EXISTE y ejercita el requisito (tabla abajo).
- [x] progress/impl_141.md contiene el mapa R -> test y coincide con el codigo real.

### Calidad de codigo
- [x] pnpm typecheck — 0 errores (exit 0, sin salida).
- [x] pnpm lint — 144 problems (0 errors, 144 warnings) = baseline declarado.
- [x] pnpm test — Test Files 519 passed (519), Tests 5275 passed (5275) en 169.42s.
- [x] ./init.sh — "== init OK ==" (unico warning: no hay .env, ambiental del worktree).
- [~] E2E: no se anade spec de Playwright para ingesta de ordenes (nota menor 6).

### Datos y seguridad
- [x] Tabla nueva `carga` con ENABLE ROW LEVEL SECURITY y sin policies (patron del repo:
      orden_mensajero_meta, plantilla_mensaje, api_key); autorizacion en el service.
- [x] migration.sql + down.sql presentes; el DOWN revierte EXACTAMENTE el UP (por lectura).
- [x] Sin secretos hardcodeados en el diff.
- [x] No aplica webhooks.

### Patron de capas
- [x] Controller (carga-masiva/chunk/route.ts): solo zod + traduccion de CargaLoteAjenoError a
      ForbiddenError; sin queries ni reglas de negocio.
- [x] Service (BulkOrdenService): no conoce HTTP; decide actor, total del lote y cuando no hay lote.
- [x] Repository (OrdenRepository + lib/repositories/carga-lote.ts): solo Prisma dentro de $transaction.
- [x] Interfaces en lib/interfaces/ (LoteContexto y CargaLoteAjenoError junto a NumRemisionDuplicadoError).

### Permisos / multi-pais
- [x] R30 preservado: sesion sigue exigiendo adminTienda, API key sigue exigiendo apiKey.
- [x] Sin hardcode de pais, moneda ni contexto.

### Pendiente del leader (no del implementer)
- [ ] feature_list.json sigue en in_progress (pasa a done tras este review).
- [ ] Entrada en progress/history.md.

## Decisiones cerradas del humano — verificacion punto por punto

| Decision | Estado | Evidencia |
| --- | --- | --- |
| Tabla `carga` en SINGULAR | OK | CREATE TABLE "carga", @@map("carga"); el test asserta que NO existe CREATE TABLE "cargas" |
| Sin batch_url ni status (ni enum nuevo) | OK | ausentes en SQL y en model Carga; test negativo sobre el SQL sin comentarios y sobre el bloque Prisma |
| total_files = total del LOTE (API = objetos del array) | OK | cargarViaApi pasa totalFiles: rows.length (incluye duplicadas y con error) |
| total_files sesion = total declarado, fijado UNA vez, sin acumular | OK | el cliente envia filas.length en los N chunks; ensureCargaEnTx usa createMany(skipDuplicates) = ON CONFLICT DO NOTHING, nunca UPDATE |
| FK orden.carga_id nullable + ON DELETE RESTRICT | OK | ADD COLUMN "carga_id" TEXT (sin NOT NULL) + orden_carga_id_fkey ... ON DELETE RESTRICT; Prisma onDelete: Restrict |
| download_url en ambas tablas, SIEMPRE NULL | OK | nadie la escribe: ensureCargaEnTx no la envia, toCreateManyInput no la envia; tests negativos en repo, helper y service |
| num_guia sin cambios | OK | ni el UP ni el DOWN mencionan num_guia; createManyOrdenesConGuia conserva su SQL de secuencia intacto |
| CERO .tsx en el diff | OK | git diff --name-only origin/dev...HEAD filtrado por .tsx = 0 archivos |
| Alta manual no crea lote | OK | repo.create no envia cargaId/downloadUrl ni toca el delegate carga |

## Migracion — lectura comparada UP/DOWN

UP: crea `carga` (id PK, fecha_carga DEFAULT CURRENT_TIMESTAMP, usuario_carga NOT NULL con FK
RESTRICT a usuario, download_url NULL, total_files INTEGER NOT NULL DEFAULT 0, created_at,
updated_at), 2 indices y RLS; ALTER TABLE orden ADD COLUMN carga_id TEXT + download_url TEXT,
indice orden_carga_id_idx y FK orden_carga_id_fkey RESTRICT. Es 100% aditiva: sin UPDATE, sin
INSERT, sin backfill (R8).

DOWN: suelta en orden inverso orden_carga_id_fkey -> orden_carga_id_idx -> download_url ->
carga_id -> DROP TABLE carga (que arrastra sus dos indices y su FK a usuario). No queda ningun
objeto del UP sin revertir y no toca nada mas (el test asserta que el conjunto de columnas
dropeadas es exactamente carga_id + download_url). Reversible por lectura: coherente.

Denylist de tests/integration/db/zonas-migration.test.ts: actualizada con
!d.endsWith("_carga_orden_carga_id"). Timestamp 20260727120000 posterior a la ultima migracion
de dev (20260724150000_...); convenciones de tipos (TIMESTAMP(3), updated_at sin default)
iguales a las migraciones existentes del repo.

Round-trip real up->down->up contra Postgres NO ejecutado (DB compartida; el encargo prohibe
escribir en ella). Deuda operativa antes del deploy, igual que en la feature 101.

## Trazabilidad R -> test (verificada una por una)

| R | Test citado | Verificado |
| --- | --- | --- |
| R1 | tests/integration/db/carga-migration.test.ts "R1: crea la tabla en SINGULAR..." + bloque Prisma | Si — asserta tabla, columnas y PK reales |
| R2 | idem "R2: usuario_carga es NOT NULL con FK..." + "R2: Usuario expone el lado inverso" | Si |
| R3 | idem "R3: NO define batch_url, ni status, ni enum" + "R3: el modelo Carga NO declara status ni batchUrl" | Si — negativo real, no tautologico |
| R4 | idem "R4: agrega carga_id TEXT NULLABLE con indice y FK RESTRICT" (+ assert de NO NOT NULL) | Si |
| R5 | idem "R5: agrega download_url TEXT NULLABLE a orden" | Si |
| R6 | idem "R6: download_url es TEXT NULLABLE" | Si |
| R7 | idem "R7: total_files es INTEGER NOT NULL" | Si |
| R8 | idem "R8: sin backfill — ningun UPDATE ni INSERT" | Si |
| R9 | idem "R9: habilita RLS y NO define ninguna policy" | Si |
| R10 | idem describe "DOWN — revierte exactamente (R10)" (orden inverso + conjunto exacto de columnas) | Si |
| R11 | idem "R11: no toca num_guia" + orden-repository.carga-lote.test.ts "R11/R29: la fila insertada no lleva num_guia ni download_url" | Si |
| R12 | bulk-orden-service.carga-lote.test.ts "R12/R13..."; carga-lote.test.ts "crea la fila con el id propuesto..."; CargaMasivaChunks.test.ts "R12/R13: los N chunks ... MISMO cargaId" | Si — el test del cliente observa 3 bodies con un unico UUID |
| R13 | carga-lote.test.ts "R13: el segundo chunk con el MISMO id no crea fila nueva" (doble en memoria con semantica ON CONFLICT) | Si |
| R14 | service "R14: dry-run no persiste nada"; cliente "R14: el dry-run NO envia cargaId ni totalFiles" | Si |
| R15 | service "R15: TODAS duplicadas" y "TODAS en error"; repo "un batch cuyas filas YA existen no toca carga ni inserta" | Si |
| R16 | ordenes-carga-masiva-chunk.route.test.ts "R16: cargaId que no es UUID -> 422" + "R16/R18: se propagan al service" | Si (ver nota menor 1: el codigo real es 422, no 400) |
| R17 | route "R17: lote de OTRO usuario -> 403"; carga-lote.test.ts "lanza CargaLoteAjenoError" (asserta ademas que el lote ajeno NO se modifica); repo "R17: aborta la insercion" (createMany no llamado) | Si |
| R18 | service "total de la SESION" y "sin total declarado..."; helper "no acumula" y "no degrada el valor ya escrito"; cliente "todos los chunks declaran el total de la SESION" (5,5,5) | Si |
| R19 | service "R19/R20/R21: un lote por peticion"; repo "R19: dos batches internos comparten UN solo lote" (batchSize 1 -> 2 tx, 1 fila) | Si |
| R20 | service "R19/R20/R21 ... del usuario de la key" (usuarioCargaId key-user-1) | Si |
| R21 | service "R21: total_files cuenta TAMBIEN duplicadas y con error"; repo totalFiles 2 con batchSize 1 | Si |
| R22 | service "R22: sin ninguna orden creada..."; repo "R22/R24: un lote 100% duplicado no crea fila" | Si |
| R23 | repo "R23: el ensure DENTRO del mismo $transaction y ANTES del insert" (traza tx.start / carga.createMany / orden.createMany / tx.end) + "si el insert falla, el error se propaga" | Si (ver nota menor 5) |
| R24 | repo "un batch cuyas filas YA existen...", "un batch mixto SI crea el lote", "R22/R24..." — respaldado por el guard hayFilasPorInsertar | Si (ver nota menor 4) |
| R25 | repo "R25: todas las filas del createMany llevan el MISMO carga_id" + "ambas ordenes cuelgan del MISMO lote" | Si — las duplicadas nunca entran al INSERT, su carga_id no se pisa |
| R26 | repo "create no envia carga_id ni download_url y no toca carga" | Si |
| R27 | service "R27: el summary devuelve el cargaId"; route "la respuesta incluye el cargaId" y "dry-run devuelve cargaId null" | Si |
| R28 | ordenes-api-key-carga.route.test.ts "R28: el cargaId viaja en la respuesta" (asserta tambien etiquetasPdf, ordenes, filas) y "sin ordenes creadas, cargaId es null" | Si — contrato previo preservado |
| R29 | helper "la fila nace SIN download_url"; repo "R11/R29..."; service "R29 — download_url no se escribe por ningun camino" | Si |
| R30 | service "un rol distinto de adminTienda..." y "...de apiKey..."; route "R30: la autorizacion no cambia" | Si |

Ningun test citado esta vacio ni es tautologico; todos fallarian si se quitara la clausula que
verifican (los negativos de la migracion se evaluan sobre el SQL SIN comentarios, asi que la
prosa explicativa no los enmascara).

## Hallazgos

### BLOQUEANTES

Ninguno.

### Menores

1. **menor — R16 dice 400, el endpoint responde 422.** chunkBodySchema rechaza un cargaId
   no-UUID y el manejador generico devuelve 422, como TODA validacion de cuerpo de ese
   endpoint desde antes de esta feature (describe "chunk: validacion del cuerpo -> 422"). El
   comportamiento es el correcto para el repo; lo desalineado es el texto de R16. Sugerencia:
   corregir el requisito a 422 en requirements.md, no el codigo.

2. **menor — round-trip real de la migracion pendiente.** pnpm db:migrate / pnpm db:rollback no
   se ejecutaron (DB compartida) ni por el implementer ni por el reviewer. La cobertura es
   estatica (regex sobre migration.sql / down.sql / schema.prisma). Ejecutar up->down->up
   contra una DB desechable antes del deploy; prisma migrate diff tampoco se corrio (shadow DB).

3. **menor — fallback de totalFiles en la via sesion.** options.totalFiles ?? rows.length
   degrada al tamano del CHUNK si un cliente no declara el total. El cliente del repo siempre
   lo declara, pero el fallback contradice la letra de R18 para un llamador externo.
   Alternativa mas estricta: exigir totalFiles cuando llega cargaId.

4. **menor — carrera residual documentada en R24.** Si entre el SELECT before y el createMany
   (misma tx) otra transaccion inserta TODAS las remisiones del batch, quedaria una fila de
   carga sin ordenes propias. Ventana estrecha e inocua; el implementer la documenta y explica
   por que descarta compensar con DELETE (FK RESTRICT podria abortar un batch sano).

5. **menor — el test de rollback de R23 no observa el rollback real.** $transaction esta
   mockeado, asi que "si el insert falla la tx revierte" solo verifica propagacion del error.
   La atomicidad queda respaldada estructuralmente (el ensure vive dentro del callback de
   $transaction, probado por la traza de orden) y por la semantica de Prisma.

6. **menor — sin E2E.** CHECKPOINTS pide E2E para flujos criticos (ingesta de ordenes). No se
   anade ninguno; el repo tampoco tiene E2E previo de carga masiva y la feature no cambia UI
   (cero .tsx). Coherente con el precedente de 49/88/138, pero queda anotado.

7. **menor — un chunk 100% duplicado con cargaId ajeno responde 200, no 403.** Si el batch no
   tiene nada que insertar, el ensure (y con el la verificacion de propietario) no llega a
   correr. No viola R17 (no se crea ninguna orden ni se modifica el lote ajeno) pero el codigo
   de respuesta no discrimina el intento. Edge inocuo.

8. **menor — reintento manual de la carga en firme genera un lote nuevo.** procesarEnChunks
   crea el UUID por invocacion; si el usuario reintenta "Confirmar" tras un chunk fallido, la
   segunda pasada abre otro lote. No rompe ningun R (cada invocacion es una sesion), pero
   conviene documentarlo para la feature que consuma carga_id.

## Salida real de verificacion (reviewer, worktree ordenex-wt-141)

```
$ pnpm typecheck
> tsc --noEmit
(exit 0, sin salida)

$ pnpm lint
144 problems (0 errors, 144 warnings)
0 errors and 1 warning potentially fixable with the --fix option.
(exit 0)

$ pnpm test
 Test Files  519 passed (519)
      Tests  5275 passed (5275)
   Duration  169.42s

$ ./init.sh
typecheck paso | lint paso | test paso
todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

Los numeros declarados en progress/impl_141.md (typecheck limpio, 144 warnings / 0 errores,
519 archivos y 5275 tests) quedan CONFIRMADOS con salida real. Nada rojo, ni de esta rama ni
heredado de origin/dev.
