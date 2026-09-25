# impl_462 — Aviso a primera hora: reprogramadas de hoy que esperan la aprobación de un cierre (BACKEND)

> Bitácora del `backend_dev`, 2026-09-25. Rama `feature/462-backend` (nace de `origin/dev` @ `39ad33c4`,
> el commit del spec). Base de pruebas: clon `ordenex_462` (`CREATE DATABASE … TEMPLATE ordenex`), con el
> `.env` del worktree apuntando a él. `pnpm install` propio (sin junction) y `prisma generate`.
> Alcance: Fase 0 + Fase 1 + Fase 2 de `specs/462-aviso-reprogramadas-esperan-cierre/tasks.md`. La Fase 3
> (pantallas) es del `frontend_dev`.

## Cambios del leader que prevalecen sobre el spec (aplicados)

1. **`down.sql` DINÁMICO**, no recrea el tipo con lista fija: lee `pg_enum` y quita SOLO los dos valores
   de la ficha (misma función que el P12 de la 459, sufijo `_462`; el test la compara byte a byte
   normalizando el sufijo). Los once `down.sql` previos de estos enums NO se tocan.
2. **Hora de emisión y roles del push como CONSTANTES** en `lib/config/reprogramadas-retenidas.ts`
   (`HORA_EMISION_CR = 07:00`, `ROLES_PUSH = ["admin","adminSatelite"]`). `push-elegibles.ts` lee la lista
   de ahí; un test deriva la expresión cron de la hora y la compara con `vercel.json` (`0 13 * * *`).

## Fase 0 — Pre-vuelo (T0.1–T0.3), confirmado en el archivo real (no en el grafo)

| Símbolo | Archivo:línea |
|---|---|
| `puedeLiberarse` (export function) | `lib/services/LiberacionReprogramadaService.ts:53` |
| `findOrdenesLiberables` / `buscarLiberables` | `lib/repositories/LiberacionReprogramadaRepository.ts:63` / `:106` |
| `OrdenLiberableRow` | `lib/interfaces/repositories/ILiberacionReprogramadaRepository.ts:14` |
| `sqlUltimaGestionPendienteLateral` | `lib/repositories/gestion-pendiente.ts:151` |
| `derivarJornada` | `lib/utils/jornada-cierre.ts:78` |
| `resolverDestinoCierre` | `lib/utils/bodega-responsable.ts:16` |
| `hrefDetalleCierre` / `RUTA_CIERRES_ADMIN` | `app/(app)/cierres-admin/_components/cierre-enlace.ts:32` / `:24` |
| `ESTADO_LABEL` | `app/(app)/cierres-admin/_components/cierre-labels.ts:81` |
| `NOMBRE_ESTADO.reprogramado` («Reprogramado») | `lib/types/order-status.ts:136` |
| `ESTADOS_COLA_CIERRE_DIA` | `lib/utils/colas-cierre.ts:32` |
| `emitirYContar` | `lib/services/AvisosDiariosService.ts` (privado; hoy `:265` tras la ampliación) |
| `AMBITO_REPRESADAS_POR_ROL` | `lib/services/VigenciaAvisoAgregadoService.ts:53` |
| `ORIGEN_TIPOS_VISITA_REAL` = `['gestion','gestion_tienda_ayuda']` | `lib/types/orden-historial.ts:325` |

- **T0.2** `<ts>` = `20260925130000` (la más nueva de `origin/dev` al abrir la rama:
  `20260925120300_reclasificar_cobros_459`). No colisiona.
- **T0.3** `cierre-labels.ts` ES PURO: importa tipos, `causa-devolucion-options.ts` (que solo importa
  `lib/types/causa-devolucion`), `lib/types/*`. Sin `react`, sin `next/*`, sin `@/lib/db`. La Fase 3 puede
  importar `ESTADO_LABEL` desde el Server Component sin extraer nada.
- Desvío del design anotado: el design decía que el reloj de `CierresAdminService` «ya es inyectable»; NO lo
  era (solo aparecía en un comentario). Se añadió `now: () => Date` como ÚLTIMO parámetro con default.
- Desvío del design anotado: `push-web-handler.ts` (el drenador del push) construye su PROPIA
  `VigenciaAvisoAgregadoService`; el design no lo listaba. Se le pasa también el servicio de retenidas
  (R23: el cuerpo del push lleva la cifra) y la guardia de composition roots lo afirma.

## Archivos

**Nuevos (backend):** `lib/config/reprogramadas-retenidas.ts`,
`lib/interfaces/repositories/IReprogramadaRetenidaRepository.ts`,
`lib/interfaces/services/IReprogramadasRetenidasService.ts` (+ `recortarPorAmbito`, `mismoAmbito`),
`lib/repositories/ReprogramadaRetenidaRepository.ts`, `lib/services/ReprogramadasRetenidasService.ts`,
`lib/services/reprogramadas-retenidas-composicion.ts` (`buildReprogramadasRetenidasService`, el ÚNICO
ensamblaje que usan los cinco composition roots), `lib/actions/reprogramadas-retenidas.ts`
(`@sin-superficie` hasta T3.5), `scripts/medir-462-retenidas.sql`,
`db/migrations/20260925130000_notificacion_evento_reprogramadas_esperan_cierre/{migration,down}.sql`,
`tests/fixtures/retenidas-doble.ts`.

**Modificados:** `db/schema.prisma` (+2 valores), `lib/types/notificacion.ts` (+2 tipos espejo),
`lib/repositories/gestion-pendiente.ts` (LATERAL proyecta `gestion_id`, `cierre_id`,
`fecha_reprogramacion`; WHERE intacto), `ILiberacionReprogramadaRepository.ts` +
`LiberacionReprogramadaRepository.ts` (`mensajeroAsignadoId`, select aditivo),
`lib/notificaciones/{catalogo-avisos,push-elegibles,emitir,notificadores}.ts`,
`lib/interfaces/services/{IAvisosDiariosService,IVigenciaAvisoAgregado,ICierresAdminService}.ts`,
`lib/services/{AvisosDiariosService,VigenciaAvisoAgregadoService,CierresAdminService}.ts`,
`lib/services/jobs/push-web-handler.ts`, `lib/actions/{notificaciones,cierres-admin}.ts`,
`app/api/cron/avisos-diarios/route.ts`.

**Tests nuevos:** `tests/unit/services/reprogramadas-retenidas-service.test.ts`,
`tests/unit/services/cierres-admin-retenidas.test.ts`, `tests/unit/actions/reprogramadas-retenidas.test.ts`,
`tests/unit/notificaciones/emitir-reprogramadas-esperan-cierre.test.ts`,
`tests/unit/notificaciones/reprogramadas-retenidas-config.test.ts`,
`tests/unit/guards/reprogramadas-retenidas-solo-lectura.guardia.test.ts`,
`tests/integration/db/462/reprogramadas-retenidas-sql-real.test.ts`,
`tests/integration/db/462/aviso-reprogramadas-dedupe.test.ts`,
`tests/integration/db/462/notificacion-evento-reprogramadas-migration.test.ts`.

**Tests extendidos (nota fechada):** `catalogo-avisos` (3→4 agregados, título literal), `push-elegibles`
(11→12 elegibles, roles), `avisos-diarios-route` (3 campos), `avisos-diarios-service` (3.er argumento
requerido; casos R9/R10/R12/R18), `vigencia-aviso-agregado` (4.ª rama), `notificacion-service` (R14/R15),
`notificacion-notificadores-reales` (cron, campana, push, cierres-admin), `gestion-pendiente-sql-real`
(las 3 columnas nuevas), 5 fixtures de `OrdenLiberableRow`, y las 23 suites que instancian
`CierresAdminService` (pasan `sinRetenidas()`; el escenario de la 454 monta el conteo real).

## Migración up → down → up, probada en el clon

- `prisma migrate deploy`: 18 eventos / 15 entidades, los nuevos AL FINAL.
- `pnpm run db:rollback` (el `down.sql` dinámico): 17 / 14, `notificacion_dedupe_key` y `push_envio_dia_cupo`
  con su definición exacta, fila de `_prisma_migrations` borrada.
- `prisma migrate deploy` otra vez: 18 / 15. El test de integración ejercita además: abortar con una fila
  del evento nuevo (sin borrar nada), conservar un valor ajeno posterior en una copia del tipo, e idempotencia.

## Mapa R → test (backend; la Fase 3 completa R27 UI, R32-R35, R39, R56)

| R | Test |
|---|---|
| R1, R2, R43, R47 | `462/reprogramadas-retenidas-sql-real.test.ts` (A: cierre sol/ven/rec/sin cierre/ayer; NO: aprobado, escritorio, futura, borrada, bodega, anulada, dos vivas. B: sin cierre/sol/rec/ayer; NO: aprobado, sin pendiente, `entregado`, futura, anulada, legada, dos pendientes, borrada, no en `en_reparto`. R47: sin cierre → con cierre) |
| R3 | mismo archivo: `porForma.reprogramado === corrida.esperandoCierre` del reloj REAL sobre la misma base |
| R4 | `gestion-pendiente-unica-fuente.guardia` verde + aserto de las 3 columnas en `454/gestion-pendiente-sql-real.test.ts` |
| R5, R6 | `reprogramadas-retenidas-service.test.ts` + sql-real (atribución, ámbito por destino / zona de la orden) |
| R7 | `reprogramadas-retenidas-service.test.ts` (contar/contarPorCierre/recortar del mismo resumen) + sql-real («R7») |
| R8 | `reprogramadas-retenidas-solo-lectura.guardia.test.ts` (+ `Pick` del cliente Prisma) |
| R9, R10, R12, R18 | `avisos-diarios-service.test.ts` (462) + `462/aviso-reprogramadas-dedupe.test.ts` |
| R11 | `aviso-reprogramadas-dedupe.test.ts` (misma corrida → 0 filas nuevas; días distintos → filas distintas) |
| R13, R17 | `catalogo-avisos.test.ts` (título singular/plural a mano) + `emitir-reprogramadas-esperan-cierre.test.ts` (detalle a mano, sin dígitos ni PII) |
| R14, R15 | `vigencia-aviso-agregado.test.ts` (lanza sin zona / rol ajeno / dep ausente) + `notificacion-service.test.ts` (fila oculta con 0, reaparece, visible sin número al fallar) |
| R16 | `catalogo-avisos.test.ts` (atajo `/cierres-admin`, sin parámetro, tres roles) + `atajo-aviso-ruta-visible.guardia` verde |
| R19 | `notificacion-notificadores-reales.test.ts` (cron pasa notificador + conteo; campana; push; cierres-admin) |
| R20 | `reprogramadas-retenidas-solo-lectura.guardia.test.ts` (reloj, 315, 371 y el repo de liberación no nombran el evento) |
| R21, R24 | `push-elegibles.test.ts` (admin+adminSatelite, no maestro) + `reprogramadas-retenidas-config.test.ts` (hora ↔ `vercel.json`) |
| R22, R23, R25 | canal 410 sin cambios (`notificacion-repo-con-push.test.ts`, `push-web-service.test.ts` verdes) + composition root del push afirmado |
| R26, R51 | `cierres-admin-retenidas.test.ts` (UNA llamada por página con los ids de la página; también con `[]`) |
| R27, R28 | `cierres-admin-retenidas.test.ts` (0 en el que no retiene y en el `aprobado`; `rechazado` puede retener) |
| R29, R31 | suites existentes de cierres-admin verdes (23) + `cierres-admin-descarga-columnas` guardia verde |
| R30 | `cierres-admin-retenidas.test.ts` (alcance satélite / central intacto; sin zona → sin consultas) |
| R36, R37, R38, R44 | `tests/unit/actions/reprogramadas-retenidas.test.ts` (forbidden adminTienda/mensajero/adminSatelite; unauthenticated; recorte central; `startOfDayCR` en el servidor) |
| R40, R41, R42 | sql-real (aprobado aún en `reprogramado` → 0 y el reloj lo libera; vencido y rechazado cuentan) |
| R45, R46 | sql-real (corregir a hoy → cuenta; corregir a mañana → deja de contar) |
| R48, R49 | suites de 276/315/371/454 verdes + guardia de solo lectura + `feeds-no-leen-estatus` |
| R50 | `avisos-diarios-service.test.ts` (represadas intactas con retenidas), `aviso-agregado-repository.test.ts` intacto |
| R52 | `avisos-diarios-route.test.ts` (claves sin ids, campo a campo) + `emitir-…` (sin dígitos/uuid) |
| R53 | `462/notificacion-evento-reprogramadas-migration.test.ts` + up→down→up en el clon |
| R54 | sql-real: precondición anti-vacuidad (`formaA >= 7`, `formaB >= 6`, `total >= 13`) |
| R55 | sql-real: `SUM(retenidas)` del script = `resumen.total`; forma_a/forma_b y fila a fila por cierre |

## Mutaciones del design §8.2 — cada una en ROJO con su test y revertida (arnés de un solo uso, restaura por copia)

| # | Mutación | Test rojo |
|---|---|---|
| 1 | quitar `fecha_reprogramacion <= hoy` en B | sql-real «NO retiene: fecha de MAÑANA» (+3) |
| 2 | Forma A sin `!puedeLiberarse` | sql-real «R3 = esperandoCierre», unit «NO la del cierre aprobado» (+4) |
| 3 | quitar `resultado = 'reprogramado'` en B | sql-real «pendiente con resultado entregado» (+3). **Primera corrida SOBREVIVIÓ**: el caso b5 tenía `fecha NULL` y el filtro de fecha la tapaba; se endureció con fecha de hoy y volvió a medirse en rojo |
| 4 | contar `en_reparto` sin gestión pendiente | sql-real «`en_reparto` SIN gestion pendiente» (+4) |
| 5a | LATERAL toma la pendiente más ANTIGUA | sql-real «dos pendientes: SOLO la más reciente» (+1) |
| 5b | correlación compartida (Forma A) `asc` | sql-real «dos gestiones vivas: SOLO la vigente» (+1) |
| 6 | recorte central incluye el satélite | unit service «contar central no incluye satélite», sql-real, acción R44 (5 rojos) |
| 7 | quitar el ámbito del `entidad_id` | dedupe «2 filas centrales + 1 por zona» (+4) |
| 8 | borrar el argumento del notificador real (import intacto) | notificadores-reales «PASA el TERCER notificador» + guardia derivada |
| 9 | vigencia devuelve 0 sin zona | vigencia «adminSatelite SIN zona util: LANZA» |
| 10 | contar borradas en B | sql-real «orden BORRADA» (+3) |
| 11 | `update` en el repositorio | guardia solo-lectura |
| 12 | marca por fila | `cierres-admin-retenidas` «UNA vez, con los 3 ids» (+3) |
| 13 | quitar `esAccesoTotal` en la acción | acción «adminTienda -> forbidden» (+2) |
| 14 | título «Reprogramadas» sin `NOMBRE_ESTADO` | catálogo «nombra el resultado por su nombre VISIBLE» |

## Salidas reales

- `pnpm exec tsc --noEmit` → `TSC_EXIT=0` (tras T2.10).
- `pnpm exec eslint <archivos de la ficha>` → 0 errores, 0 avisos (el único aviso se corrigió).
- Unitarios y guardias de la ficha: 19 archivos / 359 tests verdes (cierres-admin + marca + acción + roots);
  12 archivos / 262 (notificaciones/vigencia/avisos); 6 guardias / 80.
- Integración contra `ordenex_462`: `462/*` 3 archivos (25 + 6 + 10 tests) + `454/gestion-pendiente-sql-real`
  (10) + 7 suites que montan `CierresAdminService` con base real (52), todas verdes.
- Gate completo `./init.sh` → `progress/gate_462_backend.log` (ver sección siguiente).

## Gate completo (`./init.sh`, contra `ordenex_462`, sin `tail`, `INIT_EXIT` dentro del log)

Las tres corridas: typecheck ✓, lint ✓ (avisos previos ajenos), **0 `skipped` en `tests/integration/db`**
(los 26 saltados son de `AnaliticaPage`/`AnaliticaShell`, previos), los 9 archivos de la ficha verdes.

| Corrida | Log | Resultado | Qué pasó |
|---|---|---|---|
| #1 | `progress/gate_462_backend_1.log` | `INIT_EXIT=1`, 9 archivos rojos nuevos (16 tests) | 8 eran **por diseño** (design §8.4): inventarios LITERALES de los enums / migraciones en 253, 262, 271, 333, 403, `notificacion-productores-wiring`, `no-migration-102` y `orden-traspaso-migration`; se les añadieron los dos valores / la carpeta con nota fechada (commit `123a5e32`). El noveno, `nombres-estado-retirados.guardia` (455), es un **hallazgo real**: ver BLOQUEO 1. |
| #2 | `progress/gate_462_backend_2.log` | `INIT_EXIT=1`, 2 archivos rojos nuevos | `tarifa-status-retirado.guard` y `catalogo-postgres-acota-esquema.guardia`: **timeout de 20 s** en barridos del árbol (`git ls-files`), bajo saturación. Los dos estaban VERDES en #1 (2,3 s cada uno) y pasan AISLADOS (15 tests, 1,6 s). Flake de saturación (memoria «Gate rojo: cuatro modos de flake»), NO deuda: no se añaden al baseline. |
| #3 | `progress/gate_462_backend.log` | **`INIT_EXIT=0`** — `== init OK ==` | `✓ typecheck paso`, `✓ lint paso`, `Test Files 2210 passed (2210)`, `Tests 31265 passed | 26 skipped (31291)` (los 26, Analítica), `✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2210 ejecutado(s))`, los 3 de `db/462` ✓, 0 `skipped` en `integration/db`. Aviso previo ajeno: «migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado, 20260814140000_ruta_parada_tramo, 20260814160000_ruta_tramo_vivo_at». Duración 816 s. |

Lectura de las tres corridas juntas: el árbol de la ficha (commit `123a5e32`) pasa el gate completo; los dos
rojos de la corrida #2 fueron flakes de saturación reproducidos VERDES aislados y en las corridas #1 y #3.

## BLOQUEOS / decisiones que se elevan al leader

1. **Conflicto 462 ↔ 455 (nombres retirados).** La guardia `nombres-estado-retirados.guardia` (455/R41, brazo
   PLURAL) marca «reprogramadas» —plural femenino del estado viejo— como texto visible. Aparece en el literal
   NORMATIVO de 462/R17 (`TEXTO_REPROGRAMADAS_ESPERAN_CIERRE`: «…marcados «Retiene reprogramadas de hoy»…») y
   aparecerá en los literales de la Fase 3: R27 («Retiene N reprogramadas de hoy»), R32/R34 («Hay N reprogramadas
   de hoy…»). El título del aviso NO choca porque usa `NOMBRE_ESTADO.reprogramado` («Reprogramado para hoy: …»).
   Lo hecho: el mensaje de error interno del servicio se reformuló sin la palabra; el literal R17 se dejó tal
   cual y se declaró una **EXCEPCIÓN con texto y motivo** en la guardia (`EXCEPCIONES["lib/notificaciones/emitir.ts"]`),
   visible en el diff, que la propia guardia obliga a retirar si el texto cambia. **Decisión pendiente del
   leader/humano:** mantener los literales aprobados de la 462 (y ampliar la excepción a los archivos de la
   Fase 3) o reformularlos con el nombre vigente (p. ej. «Retiene N órdenes con Reprogramado para hoy»). El
   `frontend_dev` NO debe empezar T3.1/T3.4 sin esa decisión.
2. **Desvío del design (anotado, no bloqueante):** el reloj de `CierresAdminService` no era inyectable; se añadió
   `now` como último parámetro con default. Y `push-web-handler.ts` construye su propia vigencia: se le pasa
   también el servicio de retenidas (R23) y la guardia de composition roots lo afirma.
3. **Fuera de mi alcance, para el leader:** el recorrido por rol (R56/T4.1), el cron a mano con VAPID (T4.2) y la
   medición de la campana (T4.3) exigen la Fase 3 y un dev server; la medida de la población legada en producción
   (T5.1) exige el MCP de Supabase.

## Veredicto

Backend de la 462 implementado según el spec con los dos cambios del leader (down dinámico; hora y roles del
push como constantes), 15 mutaciones en rojo y revertidas, migración probada up→down→up en el clon, 0
`skipped` en integración; queda abierto el conflicto de literales con la 455 (BLOQUEO 1) antes de la Fase 3.
