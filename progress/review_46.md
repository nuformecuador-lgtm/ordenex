# Review - Feature 46: reprogramacion (bloqueo y liberacion programada)

Reviewer del arnes SDD. Rama feature/46-reprogramacion-bloqueo-liberacion.
Fecha 2026-07-13. No se edito codigo; los hallazgos MAYORES se tratan como bloqueantes.

## Veredicto

APROBADO - 0 bloqueantes. init.sh verde (230 files / 2056 tests), guardas server-side
reales y testeadas, cron con auth por CRON_SECRET, migracion con down.sql coherente, aviso
derivado sin tabla, R21 confirmado fuera de alcance. Deudas menores (round-trip de migracion
no automatizado en CI; E2E diferido) alineadas con la convencion del repo.

## Resultado de init.sh

- typecheck: limpio.
- lint: 0 errors, 135 warnings PREEXISTENTES en .claude/skills (ajenos a la 46).
- test: Test Files 230 passed (230) / Tests 2056 passed (2056). Coincide con impl_46.md
  (antes 2008 -> despues 2056; +48 tests / +7 files).
- migraciones: todas con down.sql OK; .env presente; init OK.
- Sin regresion: sin tests rojos ni skips nuevos.

## Trazabilidad R -> test (verificada leyendo los asserts, no de palabra)

| R | Test que lo verifica | Estado |
| --- | --- | --- |
| R1  | guia-asignacion-service + asignacion-satelite-service (bloqueo) | OK |
| R2  | guia-asignacion-service: generarGuia y asignarDesdeBodega con reprogramada -> conflict, motivo tipado, 0 escrituras | OK |
| R3  | asignacion-satelite-service: lote con reprogramada -> conflict motivo tipado, asignarSateliteLote no llamado | OK |
| R4  | mis-asignaciones-service: recoger y gestionar sobre reprogramada -> conflict por origen, sin efectos | OK |
| R5  | guia-asignacion + asignacion-satelite: guardas en servicios de dominio, todo-o-nada sin persistir | OK |
| R6  | liberar-reprogramadas-route: sin header / token incorrecto / secreto null -> 401 y spy not called | OK |
| R7  | liberar-reprogramadas-route: token correcto -> 200 con conteos | OK |
| R8  | liberar-reprogramadas-route (lee vercel.json): path del cron + schedule 0 6 asterisco asterisco asterisco; no rompe corte-diario | OK |
| R9  | fecha-cr: fronteras 23:59/00:01 CR, cruce offset -6h (05:59Z vs 06:00Z), normaliza a medianoche UTC | OK |
| R10 | liberacion-reprogramada-repository: where estatus=reprogramada + deletedAt=null + gestion reprogramada mas reciente <= hoy | OK |
| R11 | liberacion-reprogramada-repository: excluye futura y sin fecha vigente | OK |
| R12 | liberacion-reprogramada-service: central->en_bodega, satelite->en_bodega_satelite, central null->fallback satelite | OK |
| R13 | repository (destino + mensajeroAsignadoId=null + liberadaReprogramadaAt) + service (corridaAt unica) | OK |
| R14 | liberacion-reprogramada-service: orden que lanza -> omitidas++ sin abortar corrida | OK |
| R15 | repository (findLiberadasHoy: ventana hoy..hoy+24h + estatus + zona) + BodegaLiberadasHoy.test.tsx | OK |
| R16 | liberacion-reprogramada-action: maestro->central/en_bodega, adminSatelite->su zona/en_bodega_satelite, otro rol->forbidden | OK |
| R17 | repository (UPDATE guardado por estatusId=reprogramada, 0 filas -> false) + service (2a corrida -> liberadas=0) | OK |
| R18 | orden-liberada-reprogramada-migration (up: ADD COLUMN nullable + indice parcial; down: DROP INDEX+COLUMN orden inverso IF EXISTS) + down.sql presente | OK (ver nota migracion) |
| R19 | liberar-reprogramadas-route: cuerpo no contiene el secreto; error controlado no lo filtra; service loguea solo conteos | OK |
| R20 | route delega en service (auth previa a construirlo); guardas en servicios de dominio, no en el borde HTTP | OK |
| R21 | diff de db/schema.prisma: unica columna nueva liberadaReprogramadaAt; NO hay columnas/tablas de intentos/historial | OK |

Los 21 requisitos mapean a un test con asserts reales. Ninguno es test vacio.

## Checklist CHECKPOINTS.md

- Especificacion: requirements (R1-R21 EARS), design (alternativas A1-A5 descartadas con
  justificacion), tasks T1-T18 todas [x]. OK.
- Trazabilidad: cada R -> test; mapa presente en impl_46.md. OK.
- Calidad: typecheck/lint/test verdes; E2E critico e2e/reprogramacion-liberacion.spec.ts
  escrito (diferido, misma convencion que todo e2e del repo). OK.
- Datos/seguridad: sin tabla nueva -> sin RLS nueva (correcto, no aplica); migracion
  versionada con down.sql; sin secretos hardcodeados (CRON_SECRET por env, mismo de la 41);
  job idempotente derivado del estatus, sin tabla de dedupe. OK.
- Capas: controller solo HTTP+auth y delega; service sin HTTP/Prisma (dobles en tests);
  repository solo Prisma; interfaces en lib/interfaces. OK.
- Permisos: la Server Action listarLiberadasHoy resuelve actor/rol/zona SIEMPRE server-side
  (resolveActorFromSession), nunca por parametro de cliente; forbidden para roles no bodega;
  componente private/BodegaLiberadasHoy recibe datos por props. OK.
- Multi-pais: sin hardcode de pais/moneda; offset CR (UTC-6) es propiedad de zona horaria,
  no configuracion de negocio. OK.

## Hallazgos

### Bloqueantes
Ninguno.

### Menores (deuda, no bloquean)
- [menor] Round-trip de migracion no automatizado en CI. El test
  orden-liberada-reprogramada-migration.test.ts es ESTATICO (regex sobre migration.sql /
  down.sql), espejo del test de la feature 42; no ejecuta up/down contra Postgres dentro de
  pnpm test. Revise ambos SQL: el down.sql es el inverso exacto del up (DROP INDEX + DROP
  COLUMN, orden inverso, IF EXISTS) y es coherente. El round-trip real lo verifico el
  implementer manualmente por SQL directo (up->down->re-up). Consistente con la convencion
  del repo; deuda comun, no defecto de la 46.
- [menor] E2E diferido. e2e/reprogramacion-liberacion.spec.ts esta escrito (3 escenarios)
  pero no corre bajo pnpm test (requiere dev server + DB sembrada + CRON_SECRET). Misma
  convencion que todo e2e del repo. El flujo critico esta cubierto por unit/integration.

### Nota registrada (NO bloqueante, ajeno a la 46)
- DRIFT AMBIENTAL en Postgres local. El Postgres local tiene aplicada
  20260712170000_wallet_tienda_movimiento (feature 43), inexistente en esta rama (nacio de
  dev antes del merge de la 43). Por eso prisma migrate status reporta migraciones de la DB
  no encontradas localmente y pnpm run db:migrate/db:rollback no corren limpio. Verificado
  PREEXISTENTE y AJENO a la 46: la migracion de la 46
  (20260713100000_orden_liberada_reprogramada_at) es aditiva, timestamp posterior, y no toca
  artefactos de la 43. Quien resuelva el drift de la 43 aplicara la 46 con migrate deploy sin
  conflicto. No se trata como bloqueante de la 46.

## Conformidad con la spec aprobada (F1.4, todas las recomendaciones)

- (a) Liberacion -> en_bodega/en_bodega_satelite derivado de orden.zonaId + findCentralZonaId
  (reusa resolverDestinoCierre). Confirmado en service + tests. OK.
- (b) Cron NUEVO /api/cron/liberar-reprogramadas, schedule 0 6 diario, mismo CRON_SECRET de
  la 41. Confirmado en route + vercel.json + test. OK.
- (c) Guarda server-side explicita MSG_ORDEN_REPROGRAMADA_BLOQUEADA en 17 (maestro:
  generarGuia + asignarDesdeBodega) y 34 (satelite: asignar), ANTES del check de origen.
  Confirmado. OK.
- (d) Aviso = visibilidad DERIVADA "liberadas hoy" por bodega, sin tabla de notificaciones.
  Confirmado (columna liberada_reprogramada_at + indice parcial). OK.
- (e) Idempotencia derivada: estatus=reprogramada AND deletedAt=null AND fecha<=hoy + UPDATE
  guardado por estatusId=reprogramada + marca liberadaReprogramadaAt. Sin tabla de dedupe.
  Confirmado. OK.
- (f) Contador de intentos (47) e historial (49) FUERA DE ALCANCE: no aparecen en el diff.
  Confirmado. OK.

## Estado del round-trip de migracion

Estructura y coherencia up/down verificadas por lectura + test estatico (verde). Round-trip
ejecutado manualmente por el implementer (up->down->re-up) por SQL directo debido al drift
ambiental descrito. down.sql presente y coherente. R18 satisfecho.
