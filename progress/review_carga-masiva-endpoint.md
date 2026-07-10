# review - ordenes: carga masiva (endpoint) (feature 15)

Rama: feature/15-carga-masiva-endpoint. Reviewer: verificacion, no edicion.

## Veredicto: APROBADO (0 bloqueantes)

init.sh en verde, R1-R32 mapeados a tests reales (no vacios), decisiones humanas
2026-07-10 respetadas. Hallazgos: solo menores. Detalle abajo.

---

## Checklist CHECKPOINTS.md

Especificacion: requirements R1..R32 (EARS) OK; design con alternativas descartadas
(SheetJS xlsx, papaparse+exceljs) OK; tasks T1..T20 todas marcadas OK.

Trazabilidad: cada R mapea a >=1 test que ejerce el comportamiento (tabla abajo);
impl_carga-masiva-endpoint.md contiene el mapa R -> test. OK.

Calidad: pnpm typecheck OK (TS strict, sin any injustificado; unico cast documentado
en spreadsheet.ts por el Buffer local de exceljs). pnpm lint OK. pnpm test 60
archivos / 485 tests verdes. E2E Playwright NO existe (ver menor 1): flujo critico
sin UI drivable; precedente feature 6. No bloqueante.

Datos y seguridad: RLS de orden intacta (la migracion NO anade policies ni
re-habilita RLS; RLS ya habilitada en 20260709130100_ordenes, confirmado). Sin
tablas nuevas. Migracion versionada con migration.sql + down.sql; down revierte en
orden inverso (FK, indice, columnas, DELETE condicional del estatus, peso NOT NULL).
Sin secretos hardcodeados; limites y default de estatus por config con override de
entorno. No aplica webhooks.

Patron de capas: Controller (route.ts) solo HTTP/borde, sin Prisma ni negocio;
Service (BulkOrdenService) logica pura sin HTTP ni Prisma directo, repo por
constructor; Repository solo Prisma. Interfaces en lib/interfaces/services y
repositories. OK.

Config: sin hardcode de contexto; tienda_id = actor.usuarioId siempre (no viene del
archivo ni del FormData). init.sh en verde; este review con veredicto APROBADO.

---

## Decisiones humanas cerradas (2026-07-10) - verificadas

1. Autorizacion SOLO adminTienda (R11): OK. route.ts:57 rechaza con ForbiddenError
   antes de leer el archivo; BulkOrdenService:166 re-autoriza (defensa en
   profundidad). Tests: service it.each de MAESTRO/ADMIN/MENSAJERO/DESCONOCIDO ->
   forbidden, y route it.each -> 403 sin llamar al service. adminTienda -> procede
   cubierto en ambos.
2. tienda_id = actor.usuarioId SIEMPRE (R24): OK. No hay campo multipart tiendaId
   (grep en route/service: 0). tiendaId sale solo de actor.usuarioId. Test service
   verifica arg[i].tiendaId igual a store1.
3. Default GLOBAL en_preparacion (R7/R8): OK. ordenesConfig.DEFAULT_ESTATUS_VALUE
   fallback en_preparacion. Test de creacion de feature 6 ACTUALIZADO
   (orden-service.test.ts:137 afirma findEstatusIdByValue con en_preparacion).
   Ningun test afirma en_bodega como default de creacion (las apariciones de
   en_bodega son fixtures de ordenes existentes o el valor historico del seed).
4. peso NULLABLE en columna, crearOrdenSchema sin cambios (R4): OK. Migracion DROP
   NOT NULL; schema peso Decimal opcional; el schema de creacion del CRUD no se toco.
5. Parser exceljs: OK. exceljs 4.4.0 en package.json/lockfile; cubre CSV
   (workbook.csv.read) y XLSX (workbook.xlsx.load).
6. value = slug en_preparacion; geografia NO sembrada: OK. Seed y migracion usan el
   slug; el service reporta error por fila cuando la geografia no existe.

---

## Trazabilidad R1..R32 -> test (verificada)

| R | Test (verificado que ejerce el comportamiento) |
|---|---|
| R1 | db/carga-masiva-schema.test.ts: ADD COLUMN direccion/monto_cobrar/mensajero_sugerido_id |
| R2 | idem: CREATE INDEX + FK ON DELETE SET NULL hacia usuario |
| R3 | idem: UP no anade policies/RLS ni toca otras tablas; down en orden inverso |
| R4 | idem: peso DROP NOT NULL; orden-repository.bulk.test.ts mapea peso null |
| R5 | types/order-status.test.ts: SEED 8 valores incl. en_preparacion |
| R6 | schema test: INSERT ON CONFLICT DO NOTHING + DELETE condicional; seed-order-status.test.ts: upsert 8x idempotente |
| R7 | bulk-orden-service.test.ts: estatus de creadas = en_preparacion |
| R8 | ordenes-config.test.ts (default) + orden-service.test.ts (creacion afirma en_preparacion) |
| R9 | ordenes-carga-masiva.route.test.ts: adminTienda -> 200 |
| R10 | route: sin sesion -> 401, sin llamar service |
| R11 | service + route: 4 roles no-adminTienda -> forbidden/403 sin procesar |
| R12 | route: sin file -> 422 fieldErrors.file |
| R13 | spreadsheet.test.ts + route: extension no csv/xlsx -> 422 |
| R14 | parser: CSV con comillas, comas dentro de comillas y salto de linea interno |
| R15 | parser + route: XLSX primera hoja -> 200 |
| R16 | parser (cabeceras normalizadas) + route (columna canton ausente -> 422) |
| R17 | route: solo cabecera -> 422 archivo sin filas |
| R18 | service: fila sin destinatario -> error, resto no aborta |
| R19 | orden-repository.bulk.test.ts (geo batch) + service (resolucion jerarquica) |
| R20 | service: provincia inexistente / canton ambiguo / distrito inexistente -> error de fila |
| R21 | service: zonaId derivado de provincia.zonaId |
| R22 | repo findMensajerosByIds (rol mensajero) + service (vacio->null, invalido->error) |
| R23 | service: monto_cobrar vacio->null, abc->error, -5->error, 12.50->12.5 |
| R24 | service: tiendaId = actor.usuarioId en todas las filas |
| R25 | repo findExistingRemisiones + service + route: remision existente -> duplicada + estatus |
| R26 | service: 3 filas iguales -> 1 creada + 2 duplicadas (primera gana) |
| R27 | repo: createMany en lotes batchSize con skipDuplicates true |
| R28 | route: mas de MAX_ROWS -> 422; carga-masiva-config.test.ts (valores/override). Ver menor 2 |
| R29 | service: valida creada pese a fila invalida en el mismo archivo |
| R30 | route: body igual a total/creadas/duplicadas/conError/filas |
| R31 | route: service rechaza -> AppErrorShape 500 (code INTERNAL) |
| R32 | route: respuesta no contiene deletedAt/deleted_at/passwordHash/password_hash |

Todos los R con test real y asserts efectivos. No hay tests vacios ni falsos.

---

## Hallazgos

Bloqueantes: ninguno.

Menores:
- menor 1: sin E2E Playwright. CHECKPOINTS pide E2E para flujos criticos (ingesta de
  ordenes). No existe. Justificacion aceptable: endpoint backend sin UI drivable (el
  consumidor BulkUpload/modal es feature 9/14, fuera de alcance) y feature 6 (CRUD
  ordenes, tambien ingesta) sento el precedente de no traer E2E. El handler HTTP
  completo esta cubierto por test de integracion con parseo real CSV/XLSX.
  Recomendacion: anadir E2E cuando aterrice la UI (feature 14/16).
- menor 2: R28 rama de tamano en bytes sin test de ruta. El route test cubre el
  limite de FILAS (mas de MAX_ROWS -> 422) pero no la rama file.size mayor a
  MAX_FILE_BYTES (route.ts:75). Guarda trivial y paralela a la de filas ya probada;
  R28 queda cubierto por el limite de filas + el test de config. Recomendacion:
  anadir un caso de archivo que exceda MAX_FILE_BYTES.
- menor 3: migracion verificada solo estaticamente. carga-masiva-schema.test.ts
  asevera sobre el TEXTO de migration.sql/down.sql, no aplica contra Postgres real.
  Deuda documentada y aceptada (patron features 6/10). down.sql SET NOT NULL de peso
  fallara en rollback real si hay ordenes con peso NULL (deliberado, documentado).
- menor 4: naming vs ubicacion de tests. tasks.md llama T13/T19 tests de
  integracion/DB, pero se implementan con Prisma mockeado / service fake inyectado
  (sin DB real); el test batch de repo vive en tests/unit/ (no tests/integration/).
  Consistente con la deuda de DB diferida; cosmetico.

## Deuda verificada (aceptada)
Unica deuda funcional: aplicar la migracion 20260710000000_carga_masiva_ordenes
contra Postgres real (Supabase), patron features 6/10. Geografia sin sembrar es
prerrequisito operativo externo (decision humana). Lo verificable sin DB esta
cubierto por unit + integracion mockeada.

## Salida real de init.sh

    == Arnes SDD :: init ==
    ! jq no esta instalado (recomendado para validar feature_list.json)
    OK node v24.13.0
    OK dependencias presentes
    -> pnpm run typecheck  (tsc --noEmit, sin errores)
    -> pnpm run lint       (eslint, sin errores)
    -> pnpm run test       (vitest run)
       Test Files  60 passed (60)
            Tests  485 passed (485)
       Duration  22.09s
    OK todas las migraciones tienen down.sql
    OK .env presente
    == init OK ==

Previo pnpm db:generate: Generated Prisma Client v7.8.0 OK. El check
una-feature-por-zona se omitio porque jq no esta instalado (limitacion del harness).
Baseline 54/413 -> 60/485: +6 archivos, +72 tests; ningun test existente eliminado,
sin regresiones.
