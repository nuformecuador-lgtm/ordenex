# review_141 — Tabla `carga` + `carga_id`/`download_url` en `orden` (R1–R55)

> Worktree `ordenex-wt-141`, rama `feature/141-tabla-cargas-orden` (base `origin/dev` @ 1cfb2ed).
> Revision del ESTADO ACTUAL COMPLETO (no solo el delta). Commits: 3c0cd4c, e7ea97f, 358efec,
> daaa1c1, 287368d, 8616ffe, 0bd6ed3, ef214aa (review previo), c4e4db4 (spec R1-R55),
> ecd84fc, 4dafdc9, 0466d62.
> El reviewer NO edito codigo. Verificacion ejecutada por el reviewer en el propio worktree.
> Este informe SUSTITUYE al del alcance anterior (R1-R30).

## Veredicto

**APROBADO-CON-NOTAS** — 0 bloqueantes, 11 notas menores.

## Checklist (CHECKPOINTS.md)

### Especificacion
- [x] requirements.md con R1-R55 EARS numerados y D1-D11 (incluida la derogacion explicita de
      "download_url siempre NULL").
- [x] design.md con 15 alternativas descartadas (A-O) y su porque.
- [x] tasks.md: 31 tasks marcadas [x], 0 sin marcar.

### Trazabilidad
- [x] Los 55 requisitos mapean a un test que EXISTE y ejercita el requisito (tabla abajo).
- [x] progress/impl_141.md contiene el mapa R -> test, actualizado al rango R1-R55.

### Calidad de codigo
- [x] pnpm typecheck — exit 0, sin salida.
- [x] pnpm lint — 144 problems (0 errors, 144 warnings) = baseline declarado.
- [x] pnpm test — 520 archivos / 5340 tests verdes en la corrida de ./init.sh.
- [x] ./init.sh — "== init OK ==".
- [~] E2E: no se anade spec de Playwright (nota menor 8).

### Datos y seguridad
- [x] `carga` con ENABLE ROW LEVEL SECURITY y sin policies (patron del repo).
- [x] migration.sql + down.sql coherentes y reversibles por lectura (detalle abajo).
- [x] Sin secretos hardcodeados; bucket, TTL y tope siguen viniendo de `lib/config/etiquetas.ts`
      (env con default), sin hardcode de contexto.
- [x] No aplica webhooks.

### Patron de capas
- [x] Los dos route handlers solo validan (zod), traducen errores de dominio (403/409/422) y
      componen la respuesta; NO hablan con el repositorio: la escritura de `download_url` pasa
      por `EtiquetasDescargaService` (dependencia inyectable `deps.descargaService`).
- [x] Services sin HTTP. Repository solo Prisma. Interfaces en lib/interfaces/.

### Permisos / multi-pais
- [x] R41: sesion sigue exigiendo `adminTienda`; API key sigue exigiendo `apiKey` + auth de key.
- [x] Sin hardcode de pais, moneda ni contexto.

### Pendiente del leader (no del implementer)
- [ ] feature_list.json sigue en `in_progress` y su `description` quedo desactualizada (afirma
      "download_url queda NULL (nadie la escribe todavia)", ya derogado). Ver nota menor 9.
- [ ] Entrada en progress/history.md.

## Verificacion de los puntos que exigio el humano

| Punto | Estado | Evidencia leida |
| --- | --- | --- |
| `carga.id` INTERNO, server-side | OK | `ensureCargaEnTx` tiene DOS ramas excluyentes: `id === null` -> `crearCarga` con `randomUUID()`; `id !== null` -> `reutilizarCarga`, que SOLO hace `findUnique` y jamas inserta. No existe ninguna ruta que inserte una fila con un id entrante |
| El cliente no puede imponer un id inventado | OK | un token con formato UUID pero inexistente cae en `reutilizarCarga` -> `fila === null` -> `CargaLoteAjenoError` -> 403 (mismo error que el lote ajeno: no revela si existe) |
| Guard 403 de lote ajeno | OK | `fila.usuarioCarga !== usuarioCargaId` -> `CargaLoteAjenoError`; el borde lo traduce a `ForbiddenError` |
| Token del 1.er chunk propagado a los N siguientes | OK | `procesarEnChunks`: el 1.er chunk va sin `cargaId`, guarda `summary.cargaId` y lo reenvia; los chunks se envian EN SERIE (test explicito del invariante). Si un chunk no crea lote (`cargaId` null) el siguiente vuelve a ir sin token |
| Sin lotes extra ni duplicados | OK | reutilizar nunca crea; el guard `hayFilasPorInsertar` evita crear lote por un batch 100% duplicado; en la via API los batches internos reutilizan el id del primero |
| `UNIQUE(usuario_carga, name)` REAL en la migracion | OK | `CREATE UNIQUE INDEX "carga_usuario_carga_name_key" ON "carga"("usuario_carga", "name")` en `migration.sql` (no solo `@@unique` en Prisma) |
| NULLs multiples permitidos | OK | indice sin `NULLS NOT DISTINCT` y sin `WHERE` parcial -> semantica estandar de Postgres (NULL != NULL). El test niega ademas un unico global sobre `name` |
| 409 sin lote ni ordenes a medias | OK | el `create` que viola el indice ocurre DENTRO del `$transaction` del batch -> revierte; ademas el lote solo se crea en el PRIMER batch que inserta, asi que no puede haber batches previos ya commiteados. Test: "R24: un `name` ya usado por el actor aborta la insercion (nada persistido)" |
| Ambos modos escriben en `etiquetas-guia` | OK | un unico `bucket = etiquetasConfig.ETIQUETAS_BUCKET` (default `etiquetas-guia`) alimenta `SupabaseFileStorage` y `SupabaseSignedUrlProvider`; `generarYAlmacenar` y `generarYAlmacenarPorOrden` usan el MISMO `this.storage`/`this.signedUrls` |
| Ningun bucket nuevo en el diff | OK | el diff no introduce ningun nombre de bucket ni ninguna env nueva de Storage |
| Paths aislados por dueno | OK | ambos modos construyen `${actor.usuarioId}/${randomUUID()}.pdf`; test especifico del aislamiento y unicidad en los dos metodos |
| `download_type` no se persiste | OK | no hay columna; el service no lo recibe (test asserta que `cargarViaApi` recibe solo `{ name }`) |
| CERO `.tsx` en el diff | OK | `git diff --name-only origin/dev...HEAD \| grep -c '\.tsx$'` = **0** |

## Migracion — lectura comparada UP/DOWN (editada EN SITIO, sin correctiva)

UP `20260727120000_carga_orden_carga_id/migration.sql`: crea `carga` (id PK TEXT,
fecha_carga DEFAULT CURRENT_TIMESTAMP, usuario_carga NOT NULL con FK RESTRICT a `usuario`,
**name TEXT nullable**, download_url TEXT nullable, total_files INTEGER NOT NULL DEFAULT 0,
created_at, updated_at), el **indice unico compuesto** `carga_usuario_carga_name_key`, los dos
indices de consulta (`carga_usuario_carga_idx`, `carga_fecha_carga_idx`) y RLS; despues
`ALTER TABLE orden ADD COLUMN carga_id TEXT` + `download_url TEXT`, `orden_carga_id_idx` y
`orden_carga_id_fkey ... ON DELETE RESTRICT`. 100% aditiva: sin UPDATE, sin INSERT, sin backfill
(R11) y sin mencionar `num_guia` (R14).

DOWN: `orden_carga_id_fkey` -> `orden_carga_id_idx` -> `download_url` -> `carga_id` ->
`DROP TABLE IF EXISTS "carga"`. El `DROP TABLE` arrastra PK, los tres indices (incluido el unico
compuesto), la FK a `usuario` y la RLS: no queda ningun objeto del UP sin revertir, y el test
asserta que el conjunto de columnas dropeadas es exactamente `carga_id` + `download_url`.
**Reversible por lectura: coherente.** Denylist de `zonas-migration.test.ts` al dia
(`!d.endsWith("_carga_orden_carga_id")`). Timestamp posterior a la ultima migracion de `dev`
(20260724150000_...).

Round-trip real up->down->up NO ejecutado (DB compartida): ver nota menor 2.

## Trazabilidad R1-R55 -> test (verificada una por una)

Abreviaturas: `mig` = tests/integration/db/carga-migration.test.ts · `helper` =
tests/unit/repositories/carga-lote.test.ts · `repo` =
tests/unit/repositories/orden-repository.carga-lote.test.ts · `svc` =
tests/unit/services/bulk-orden-service.carga-lote.test.ts · `chunkRoute` =
tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts · `apiRoute` =
tests/integration/api/ordenes-api-key-carga.route.test.ts · `descarga` =
tests/unit/services/etiquetas-descarga-service.test.ts · `pdf` =
tests/unit/services/etiquetas-lote-pdf-service.test.ts · `cliente` =
tests/components/CargaMasivaChunks.test.ts · `etiq136` =
tests/integration/carga-api-etiquetas.test.ts

| R | Test | Verificado |
| --- | --- | --- |
| R1 | mig "R1: crea la tabla en SINGULAR..." + "el modelo Carga mapea a la tabla carga" | Si |
| R2 | mig "R2: usuario_carga es NOT NULL con FK... RESTRICT" + "Usuario expone cargasRealizadas" | Si |
| R3 | mig "R3: NO define batch_url, ni status, ni enum" (SQL sin comentarios) + "el modelo Carga NO declara status ni batchUrl" | Si — negativo real |
| R4 | mig "R4: agrega carga_id TEXT NULLABLE con indice y FK RESTRICT" (niega ademas NOT NULL) | Si |
| R5 | mig "R5: agrega download_url TEXT NULLABLE a orden" | Si |
| R6 | mig "R6: download_url es TEXT NULLABLE" | Si |
| R7 | mig "R7: total_files es INTEGER NOT NULL" · svc "R29: total_files = total de la SESION" | Si |
| R8 | mig "R8: name es TEXT NULLABLE" + "R8/R9: el modelo declara name String?" | Si |
| R9 | mig "R9: crea el indice UNICO COMPUESTO (usuario_carga, name), no uno global" · helper "R24: el MISMO usuario repitiendo nombre -> CargaNombreDuplicadoError" | Si — el fixture reproduce el indice compuesto real (P2002) |
| R10 | mig (niega unico global y unico parcial) · helper "R10: varios lotes SIN nombre del mismo usuario conviven" | Si |
| R11 | mig "R11: sin backfill — ningun UPDATE ni INSERT" | Si |
| R12 | mig "R12: habilita RLS y NO define ninguna policy" | Si |
| R13 | mig describe "DOWN — revierte exactamente (R13)" (5 casos, incl. orden inverso y arrastre del indice unico) | Si |
| R14 | mig "R14: no toca num_guia" · repo "R14/R40: la fila insertada no lleva num_guia ni download_url" | Si |
| R15 | helper "con id: null crea la fila con un UUID propio" + "R15: dos creaciones seguidas producen ids DISTINTOS" · repo "R15/R36: carga_id GENERADO POR EL SERVIDOR" y "R15/R19: un token INEXISTENTE no crea ninguna fila con ese id" · cliente "R15/R16: el PRIMER chunk NO envia cargaId" | Si — cubierto por los dos lados |
| R16 | svc "R15/R16: sin token entrante se pide la CREACION al repo (cargaId null)" · chunkRoute "R15/R16: el primer chunk sin cargaId llega al service con cargaId undefined" · helper describe CREACION | Si |
| R17 | helper "R17: con un token propio devuelve el mismo id SIN insertar nada" · repo "R17: REUTILIZA la fila" · cliente "R17/R26: los chunks 2..N reenvian EXACTAMENTE el token" · chunkRoute "R17/R29" | Si |
| R18 | chunkRoute "R18: cargaId que no es UUID -> 422 sin tocar el service" | Si |
| R19 | chunkRoute "R19: token DESCONOCIDO o de otro usuario -> 403" · helper 2 casos · repo 2 casos (asserta que orden.createMany NO se llamo) · svc "R19: tampoco captura el error de lote ajeno" | Si |
| R20 | chunkRoute "R20: name opcional se propaga" y "name vacio o largo -> 422" · apiRoute idem (con trim) · svc describe "nombre del lote" · cliente "R20: el nombre viaja en todos los chunks" | Si |
| R21 | helper "R21: persiste el name recibido al crear" · repo "R21: el name llega al INSERT de carga" · svc (ambas vias) | Si |
| R22 | helper "R22: sin name la fila nace con NULL" · svc (ambas vias) · chunkRoute · cliente "R22: sin nombre, el cuerpo no lleva name" | Si |
| R23 | helper "R23/R29: al reutilizar NO se reescriben name ni total_files" (asserta que update no se llamo) · svc "R23: el name viaja en todos los chunks, pero el 2.o ya reutiliza por token" | Si |
| R24 | helper "R24: ... con el nombre" + "traduce el P2002" · repo "R24: aborta la insercion (nada persistido)" · chunkRoute "R24: nombre repetido -> 409 con el nombre" · apiRoute idem | Si |
| R25 | helper "R25: OTRO usuario con el mismo nombre SI puede crear su lote" | Si |
| R26 | helper "R26: N chunks de la misma sesion comparten UNA sola fila" · cliente "R17/R26..." y "los chunks se envian EN SERIE" | Si |
| R27 | svc "R27: dry-run no persiste nada" · cliente "R27: el dry-run NO envia cargaId, name ni totalFiles" | Si |
| R28 | svc dos casos (todas duplicadas / todas en error) · repo "un batch cuyas filas YA existen no toca carga ni inserta" | Si |
| R29 | svc "R29: total de la SESION" y "sin total declarado..." · helper "no se reescribe" · cliente "R29: todos los chunks declaran el total de la SESION" ([5,5,5]) | Si (ver nota menor 4) |
| R30 | svc "R30/R31/R32: un lote por peticion" · repo "R30: dos batches internos comparten UN solo lote" (batchSize 1 -> 2 tx, 1 fila) | Si |
| R31 | svc "... del usuario de la key" · repo (la fila creada lleva usuarioCarga key-user-1) | Si |
| R32 | svc "R32: total_files cuenta TAMBIEN duplicadas y con error" · repo (totalFiles 2 con batchSize 1) | Si |
| R33 | svc "R33: sin ninguna orden creada no se llama al repo" · repo "R33/R35: un lote 100% duplicado no crea fila" | Si |
| R34 | repo "R34: el lote se resuelve DENTRO del mismo $transaction y ANTES del insert" (traza de orden) + "si el insert falla, el error se propaga" | Si (ver nota menor 10) |
| R35 | repo tres casos del guard hayFilasPorInsertar | Si (ver nota menor 5) |
| R36 | repo "R15/R36: todas las filas del createMany llevan el carga_id" + "ambas ordenes cuelgan del MISMO lote" | Si — las duplicadas no entran al INSERT |
| R37 | repo "create no envia carga_id ni download_url y no toca carga" | Si |
| R38 | svc "R38: el summary devuelve el cargaId" · chunkRoute "R38: la respuesta incluye el cargaId" y "dry-run devuelve cargaId null" | Si |
| R39 | apiRoute "R39: el cargaId viaja en la respuesta" (asserta ordenes/filas/etiquetasPdf) y "sin ordenes creadas, cargaId null" · svc "R39..." | Si — contrato de la 136 preservado |
| R40 | svc describe "R40 — la via sesion no escribe download_url" · helper "R40: la fila nace SIN download_url" · repo "R14/R40..." | Si |
| R41 | svc dos casos de rol · chunkRoute "R41: la autorizacion no cambia" · apiRoute (401/403 heredados) | Si |
| R42 | apiRoute "R42/R55: individual se propaga al orquestador" | Si |
| R43 | apiRoute "R43/R55: sin download_type se aplica consolidate" | Si |
| R44 | apiRoute "R44: un valor fuera del enum -> 422 sin crear ordenes ni tocar Storage" (asserta que ni el service ni el orquestador se llamaron) | Si |
| R45 | apiRoute "R45: el modo no se persiste — el service no recibe download_type" (toEqual({ name: undefined })) + mig R3 sobre el SQL | Si |
| R46 | chunkRoute "R46: download_type NO es parametro de esta via: se ignora y no llega al service" | Si |
| R47 | descarga "R47: genera UN PDF y persiste su URL en carga.download_url" (asserta ademas que NO se escribe ningun orden.download_url) · repo "R47: setCargaDownloadUrl actualiza SOLO download_url" · apiRoute "R47/R53" | Si |
| R48 | descarga "R48: genera UN PDF por orden y persiste cada URL en SU orden" · pdf "R48: N etiquetas -> N build/upload/firma" · repo "R48: setOrdenesDownloadUrl en UNA transaccion" + "lista vacia -> no-op" · apiRoute "R48/R54" | Si |
| R49 | pdf "R49: una orden sin etiqueta imprimible NO aparece en el resultado" · descarga "R49: la orden sin etiqueta no recibe URL" · apiRoute "R49/R54" (conserva su num_guia) | Si |
| R50 | descarga "R50: ordenIds vacio en modo %s -> no toca Storage ni DB" (ambos modos) · pdf "R50: cero etiquetas imprimibles -> [] sin tocar Storage" · apiRoute (el orquestador no se llama sin ordenes) | Si |
| R51 | apiRoute "R51: un fallo en modo individual -> 200, etiquetasPdf { error } y URLs null" (num_guia intactos) · etiq136 "etiquetasPdf trae { error } y responde 200" · descarga "R51: un fallo de generacion se PROPAGA" y "un fallo al PERSISTIR tambien se propaga" | Si |
| R52 | pdf "R52: por encima del tope lanza ANTES de construir o subir nada" + "justo EN el tope si genera" · etiq136 "tope de etiquetas en modo individual (R52)" (0 llamadas al orquestador, num_guia intactos, downloadUrl null) | Si |
| R53 | etiq136 (suite heredada de la 136, intacta sobre consolidate) · apiRoute "R47/R53: etiquetasPdf con url y TODOS los ordenes[].downloadUrl en null" | Si |
| R54 | apiRoute "R48/R54" + "R49/R54" | Si |
| R55 | apiRoute "R43/R55" y "R42/R55" (eco de downloadType en ambos casos) | Si |

Ningun test citado esta vacio ni es tautologico. Los negativos de migracion se evaluan sobre el
SQL SIN comentarios (la prosa que menciona batch_url/status no los enmascara), el doble en
memoria del delegate carga reproduce la semantica del indice unico compuesto (P2002 real de
Prisma) y las pruebas de borde afirman ademas lo que NO se llamo (service, Storage, repo).

## Hallazgos

### BLOQUEANTES

Ninguno.

### Menores

1. **menor — TTL de las URLs firmadas persistidas (deuda declarada; ACEPTABLE hoy, con fecha
   de caducidad).** `carga.download_url` / `orden.download_url` guardan una URL firmada con TTL
   (`ETIQUETAS_SIGNED_URL_TTL_SECONDS`, default 1 h, techo 24 h): pasado ese plazo el valor
   almacenado devuelve 403 de Storage. No es bloqueante porque R47/R48 solo exigen persistir "su
   URL", el consumidor real es la respuesta inmediata del endpoint y HOY no existe ningun lector
   de esas columnas. Deja de ser aceptable en cuanto alguien las lea (UI, listado por lote,
   integrador que las consulte despues): antes de eso hay que aplicar la alternativa N del
   design (persistir el `path` —que `EtiquetasLotePdfResultado` ya devuelve— y re-firmar bajo
   demanda). Recomendacion: anotarlo como feature siguiente ANTES de exponer la columna.

2. **menor — round-trip real de la migracion pendiente.** No se ejecutaron `pnpm db:migrate` ni
   `pnpm db:rollback` (DB compartida) ni por el implementer ni por el reviewer. La cobertura es
   estatica (regex sobre migration.sql / down.sql / schema.prisma) y la lectura comparada UP/DOWN
   es coherente. Debe correrse up->down->up contra una DB desechable antes del deploy;
   `prisma migrate diff` (no-drift) tampoco se ejecuto (requiere shadow DB). Riesgo bajo: la
   migracion es aditiva y su DOWN se reduce a 4 DROP + 1 DROP TABLE.

3. **menor — la suite completa es sensible a la carga de la maquina.** En dos corridas mias bajo
   carga (375 s y 432 s) fallaron 3 y 2 tests de `tests/integration/recuperar-contrasena-form.test.tsx`
   y `tests/components/LoginForm.test.tsx` por timeout de `findByText`. AMBOS archivos son ajenos
   a esta feature (el diff no toca ningun `.tsx` ni ningun modulo que esos formularios importen),
   pasan aislados (33/33 en 18 s) y la corrida de `./init.sh` termino en **520/520 archivos y
   5340/5340 tests**. Flakiness de entorno, NO regresion de esta rama.

4. **menor — fallback de `totalFiles` en la via sesion.** `options.totalFiles ?? rows.length`
   degrada al tamano del CHUNK si un cliente no lo declara. El cliente del repo siempre lo envia
   y el borde lo valida, pero para un llamador externo contradice la letra de R29. Alternativa
   mas estricta: exigir `totalFiles` cuando la peticion crea el lote.

5. **menor — carrera residual de R35 (documentada).** Si entre el `SELECT before` y el
   `createMany` (misma tx) otra transaccion inserta TODAS las remisiones del batch, quedaria una
   fila de `carga` sin ordenes propias. Ventana estrecha; compensar con DELETE se descarto por la
   FK RESTRICT. Aceptable.

6. **menor — el guard de propiedad (R19) no corre en un chunk 100% duplicado.** Si el batch no
   tiene nada que insertar, `ensureCargaEnTx` ni se invoca, asi que un token ajeno en esa
   peticion responde 200 en vez de 403. No viola R19 en sustancia (no se crea ni modifica nada),
   pero el codigo de respuesta no discrimina el intento.

7. **menor — objetos huerfanos en Storage ante fallo parcial del modo `individual`.** Si el
   upload N falla despues de subir N-1 PDFs, se propaga el error, ninguna URL se persiste
   (columnas NULL, estado consistente y reintentable) pero los PDFs ya subidos quedan en el
   bucket sin referencia. Sin recolector ni job de reintento (deuda declarada). Impacto: coste de
   almacenamiento; los objetos siguen en el bucket privado con path aislado por dueno.

8. **menor — sin E2E.** CHECKPOINTS pide E2E para flujos criticos (ingesta de ordenes). No se
   anade ninguno; el repo tampoco tiene E2E previo de carga masiva y esta feature no cambia UI
   (cero `.tsx`). Coherente con el precedente 49/88/136/138.

9. **menor — bookkeeping desactualizado.** `feature_list.json` sigue en `in_progress` (normal
   hasta el merge) pero su `description` describe el alcance VIEJO: "download_url queda NULL
   (nadie la escribe todavia); sin UI ni filtro por lote" — la primera mitad ya no es cierta
   (D11 la derogo) y no menciona `name` ni `download_type`. Conviene actualizarla al cerrar.

10. **menor — el test de rollback de R34 no observa el rollback real.** `$transaction` esta
    mockeado, asi que "si el insert falla, el error se propaga" verifica propagacion, no
    atomicidad. La atomicidad queda respaldada estructuralmente (el ensure vive dentro del
    callback de `$transaction`, probado por la traza de orden) y por la semantica de Prisma.

11. **menor — coste del modo `individual`.** N renders + N uploads + N firmas bajo el MISMO tope
    que el consolidado (`MAX_ETIQUETAS_POR_PDF`, default 300) y el `maxDuration = 60` de la ruta.
    El tope corta ANTES de empezar (R52), asi que no hay riesgo de OOM/timeout no capturable,
    pero 300 uploads secuenciales pueden acercarse al presupuesto de la function. Palanca ya
    identificada en el design (alternativa O: tope propio para `individual`).

## Salida real de verificacion (reviewer, worktree ordenex-wt-141)

```
$ pnpm typecheck
> tsc --noEmit
(exit 0, sin salida)

$ pnpm lint
144 problems (0 errors, 144 warnings)
0 errors and 1 warning potentially fixable with the --fix option.
(exit 0)

$ ./init.sh
✓ node v22.13.1 · ✓ dependencias presentes
✓ typecheck paso
✓ lint paso
 Test Files  520 passed (520)
      Tests  5340 passed (5340)
✓ test paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==

$ npx vitest run <15 archivos de la feature 141>
 Test Files  15 passed (15)
      Tests  274 passed (274)

$ git diff --name-only origin/dev...HEAD | grep -c '\.tsx$'
0
```

Los numeros declarados en `progress/impl_141.md` (typecheck limpio, 144 warnings / 0 errores,
520 archivos y 5340 tests) quedan **CONFIRMADOS con salida real**. Las dos corridas intermedias
con fallos (2 archivos `.tsx` de auth, ajenos al diff) fueron flakiness por carga de la maquina:
esos archivos pasan aislados y la corrida de `init.sh` salio limpia. Nada rojo atribuible a esta
rama ni heredado de `origin/dev`.
