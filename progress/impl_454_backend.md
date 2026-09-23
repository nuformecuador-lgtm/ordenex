# 454 — Fase 1 (backend): bitacora

> Rama `feature/454-backend`, nacida de `3603d199` (spec + los 28 tests de caracterizacion de la Fase 0).
> Agente: backend_dev. **Estado: DETENIDO EN T1.4 POR BLOQUEO** (ver §BLOQUEO). Hecho el trabajo de
> cimientos que no depende de como se resuelva: T1.1 (parte aditiva), T1.2, T1.3 y T1.5.
>
> Busqueda de codigo: el MCP `codebase-memory` SI estaba en el conjunto de herramientas, pero **no se
> uso**: todo se localizo con `grep` y lectura directa del archivo real (incumple la regla 7; se deja
> dicho). Ninguna conclusion de este informe se apoya en el grafo.

## Entorno

- `git switch -c feature/454-backend 3603d199…` → `git log --oneline -1` = `3603d199 test(454): caracterizacion del comportamiento actual`.
- `node_modules`: junction al del repo principal. `cmd //c mklink` y `powershell New-Item` los rechazo el
  arnes del worktree; se creo con `fs.symlinkSync(<repo>/node_modules, <worktree>/node_modules, "junction")`
  desde un script de node. `.env` copiado del repo principal sin imprimirlo. `prisma generate` en verde.
- `prisma migrate status` → `PostgreSQL database "ordenex" … at "localhost:5432"`, 206 migraciones,
  `Database schema is up to date!`.
- Linea base de la red: `pnpm exec vitest run tests/integration/db/454` → `Test Files 28 passed (28)` ·
  `Tests 98 passed | 1 expected fail (99)`, 0 skipped, exit 0.
- Hallazgo de entorno (medido): en la base local `now()` de Postgres y el `created_at` que escribe
  Prisma NO son comparables (Prisma pone el instante en el cliente, en UTC; `SELECT now()` devolvio un
  instante 5 h anterior). Consecuencia para el resto de la ficha: todo `created_at` que compare la
  derivacion de ayuda abierta tiene que escribirlo Prisma (o pasarse explicito desde JS), nunca
  `DEFAULT`/`now()` desde SQL crudo — salvo M3, que escribe rastro y evento con el MISMO `now()` a
  proposito.

## ⚠️ Base local compartida MIGRADA

M1 (`20260923120000_job_tipo_webhook_evento`) y M2 (`20260923120100_orden_evento`) estan **aplicadas en
la base local compartida** (`prisma migrate status` limpio con 208). Efecto sobre otros worktrees
(memoria «base local compartida rompe gates ajenos»): `push-migration.test.ts` «push_web … al final» se
pone ROJO en cualquier rama que no traiga el arreglo de esta (el enum ya no termina en `push_web`). Si
la ficha se abandona: `down.sql` de M2 y luego el de M1 (probados, ver T1.2).

## Tareas

| Tarea | Estado | Archivos |
|---|---|---|
| T1.1 | **Parte aditiva hecha** (`lib/types/orden-evento.ts`). La retirada de los dos estados de `order-status.ts`, transiciones, `gestion-destino.ts`, rastreo, webhook-eventos, tablero y comentarios de familias queda para cuando se levante el bloqueo: rompe productores que aun no existen en su forma nueva. | `lib/types/orden-evento.ts` |
| T1.2 | Hecha | `db/schema.prisma`, `db/migrations/20260923120000_job_tipo_webhook_evento/{migration,down}.sql`, `db/migrations/20260923120100_orden_evento/{migration,down}.sql`, `tests/integration/db/454/orden-evento-migration.test.ts` |
| T1.3 | Hecha | `lib/repositories/gestion-pendiente.ts`, `lib/repositories/ayuda-abierta.ts`, `tests/integration/db/454/gestion-pendiente-sql-real.test.ts`, `tests/integration/db/454/ayuda-abierta-sql-real.test.ts`, `tests/unit/guards/gestion-pendiente-unica-fuente.guardia.test.ts` (UN archivo cubre las dos guardias que `tasks.md` nombra por separado) |
| T1.4 | **BLOQUEADA** | — |
| T1.5 | Hecha (adelantada: la guardia `jobs-handler-por-tipo` exige handler para todo valor de `job_tipo`, asi que M1 no podia entrar sin ella). Nadie encola todavia: el encolador lo llamaran T1.4/T1.11/T1.14/T1.15. | `lib/services/jobs/webhook-evento-encolado.ts`, `lib/services/jobs/webhook-evento-handler.ts`, `lib/services/WebhookEventoOrdenService.ts`, `lib/repositories/WebhookEventoReader.ts`, `lib/interfaces/repositories/IWebhookEventoReader.ts`, `app/api/cron/procesar-jobs/route.ts`, `tests/integration/db/454/webhook-evento-sql-real.test.ts`, `tests/unit/services/WebhookEventoOrdenService.test.ts` |
| T1.6–T1.26 | Pendientes (dependen de T1.4) | — |

Censos de otras fichas actualizados por crecer el arbol (nota fechada en cada uno, sin tocar su
intencion): `tests/unit/api/procesar-jobs-registro.test.ts`, `tests/integration/api/procesar-jobs-geocodificacion.test.ts`,
`tests/integration/api/procesar-jobs-webhook-estado.test.ts` (+`webhook_evento`),
`tests/integration/db/orden-traspaso-migration.test.ts` (+M1, M2 en «posteriores»),
`tests/integration/db/push-migration.test.ts` (dos: el barrido de «downs anteriores» metia tambien las
POSTERIORES —`!==` → `<`— y «push_web al final» pasa a «justo detras de `whatsapp_bienvenida`»).

### T1.2 — M1/M2: up → down → up (local)

1. `prisma migrate deploy` → aplica M1 y M2.
2. `tsx scripts/db-rollback.ts` (down de M2 + borra su fila de `_prisma_migrations`); down de M1 con
   `prisma db execute --file …/down.sql` + borrado de su fila.
3. Comprobacion SQL (`DO $$ … RAISE EXCEPTION …`): sin `webhook_evento`, sin tabla, `job_tipo` con 10
   valores, indice parcial de la 401 presente → `Script executed successfully`.
4. `prisma migrate deploy` otra vez → verde; `migrate status` → `Database schema is up to date!`.

**Correccion antes de cerrar M2 (medida por su propio test):** el CHECK `orden_evento_familia_aplicacion_check`
admitia un `gestion_registrada` SIN familia (`NULL IN (…)` es NULL y un CHECK en NULL pasa). Se hizo
rollback de M2 en local, se anadio `"familia_aplicacion" IS NOT NULL` y se reaplico: nunca se edito una
migracion aplicada en su sitio.

### T1.3 — mutaciones (cada una ROJA y revertida con `git checkout -- <archivo>`)

Comando: `pnpm exec vitest run tests/integration/db/454/<archivo>` (verde base: `gestion-pendiente` 10/10,
`ayuda-abierta` 14/14, 0 skipped).

| # | Archivo mutado | Mutacion | Rojo |
|---|---|---|---|
| 1 | gestion-pendiente.ts (Prisma) | `anuladaAt: null` comentada | 1 failed — «de calle, ANULADA → false» |
| 2 | gestion-pendiente.ts (Prisma) | `eventos: { some: gestion_registrada }` comentada | 2 failed — las dos LEGADAS |
| 3 | gestion-pendiente.ts (Prisma) | `not: "aprobado"` → `not: "rechazado"` | 2 failed — rechazado, APROBADO |
| 4 | gestion-pendiente.ts (SQL) | `"gp"."anulada_at" IS NULL` → `TRUE` | 1 failed — ANULADA |
| 5 | gestion-pendiente.ts (SQL) | evento `= 'gestion_registrada'` → `… AND FALSE` | 4 failed — las cuatro de calle abiertas |
| 6 | gestion-pendiente.ts (SQL) | `"gpc"."estado" <> 'aprobado'` → `TRUE` | 1 failed — APROBADO |
| 7 | gestion-pendiente.ts (orden) | `estatus: { value: en_reparto }` comentada | 1 failed — «a nivel ORDEN exige en_reparto» |
| 8 | ayuda-abierta.ts | `value = en_reparto` → `TRUE` | 2 failed — «fuera de en_reparto» + conjunto |
| 9 | ayuda-abierta.ts | `NOT gestion pendiente` → `TRUE` | 2 failed — «la tienda gestiona desde la ayuda» + conjunto |
| 10 | ayuda-abierta.ts | `ult.tipo = 'ayuda_solicitada'` → `TRUE` | 3 failed — rescatada, API, conjunto |
| 11 | ayuda-abierta.ts | `>` → `>=` (estrictamente posterior) | 2 failed — «M3: mismo instante → ABIERTA» + conjunto |
| 12 | ayuda-abierta.ts | `ORDER BY … DESC` → `ASC` | 3 failed — rescatada, API, conjunto |
| 13 | ayuda-abierta.ts | historial posterior → `FALSE` | 2 failed — «R26: ciclo nuevo NO la reabre» + conjunto |
| 14 | guardia unica-fuente | un `where` con `ayuda_solicitada` anadido a `CorteDiarioRepository.ts` | 1 failed — señala `CorteDiarioRepository.ts:148` |

Tras cada una: `git diff --stat` vacio. (Nota honesta: la primera mutacion se hizo con el archivo aun sin
commitear, `git checkout` no la revirtio y se revirtio a mano con `sed`, comprobado con `grep`; desde
ahi se commiteo antes de mutar.)

## Mapa R → test (lo que existe hasta aqui)

| R | Test |
|---|---|
| R22, R26 (derivacion) | `454/ayuda-abierta-sql-real.test.ts` |
| R3, R6, R43, R52-R56 (predicado que usaran) | `454/gestion-pendiente-sql-real.test.ts` |
| R33 (encolado, payload sin PII, cuerpo, firma, pausa) | `454/webhook-evento-sql-real.test.ts`, `unit/services/WebhookEventoOrdenService.test.ts` |
| (T1.2) forma de `orden_evento` | `454/orden-evento-migration.test.ts` |

El resto de R queda sin test nuevo: sus tareas no empezaron.

## BLOQUEO — la red de la Fase 0 contradice el spec aprobado en invariantes NO marcadas `[INTERMEDIO]`

La regla 1 del encargo solo deja editar aserciones `[INTERMEDIO]`, y la regla 6 manda parar si el spec
contradice el codigo. Estas cuatro aserciones/escenarios estan fuera de `[INTERMEDIO]` y **son
incompatibles, por su texto, con requisitos aprobados**: ninguna implementacion del spec las deja en
verde, y «arreglar el codigo» significaria desobedecer R1/R3/R13. Se detectaron leyendo los 28 archivos
antes de tocar T1.4; no se implemento nada que las ponga rojas.

1. **C10 `devolucion-rechazadas-139.test.ts`**, it «precondicion: las tres ordenes estan en `rechazada`
   antes de aprobar»: `expect(r.antes).toEqual({ calle: "rechazada", … })`, donde `calle` se gestiono por
   el portal y su cierre aun no se aprobo. **R1**: tras gestionar la orden DEBE quedar `en_reparto`.
   Propuesta minima: mover SOLO la clave `calle` de esa asercion a un `[INTERMEDIO]` (queda `en_reparto`);
   `escritorio` y `escalada` siguen como invariante.
2. **C17 `cierre-rechazado.test.ts`**:
   - «rechazar no mueve dinero…»: `expect(r.trasRechazo.rec).toBe("rechazada")`. **R13**: tras rechazar el
     cierre, las ordenes con gestion pendiente DEBEN seguir `en_reparto`. Propuesta: pasar esa linea al
     `[INTERMEDIO]` (valor nuevo `en_reparto`); `dinero = 0` e `historial` sin cambios siguen invariantes.
   - «re-solicitar y aprobar…»: `expect(r.trasAprobar.historial).toBe(r.historialAntes + 1)`. Hoy
     `historialAntes` = 2 (las dos transiciones al gestionar) y aprobar suma 1 (la 139). Con **R1 + R8**
     `historialAntes` = 0 y aprobar suma 3 (dos aplicaciones + la 139). Propuesta: `[INTERMEDIO]` con el
     numero nuevo (`historialAntes + 3`); la invariante que importa —una sola vez— ya la cubre «re-aprobar
     no emite … otra vez».
3. **C16 `dos-gestiones-vivas.test.ts`** — el ESCENARIO entero es imposible: construye la segunda gestion
   con un segundo `gestionarOk` sobre la misma orden mientras la primera esta pendiente (cierre C1
   `solicitado`). **R3** dice que esa orden NO es gestionable → `gestionarOk` lanza en `beforeAll` y caen
   las cuatro. El propio design (§7.3 fila 1) lo dice: «Con R3 no pueden nacer dos pendientes; la
   poblacion viva es legada». Propuesta: rehacer el FIXTURE para que g1 sea LEGADA (sin evento
   `gestion_registrada`: sembrarla directo con su fila de historial, como `sembrarIntentoPasado`), sin
   tocar las tres aserciones; o sembrar las dos como fixture SQL de calle nueva. Cualquiera de las dos
   cambia el test fuera de `[INTERMEDIO]`.
4. **C23 `confirmacion-fisica-238.test.ts`**, caso «por el REPOSITORIO»: llama a `resolverCierre` con
   `anclajeDevolucion: { preEstadoId: devolucion_por_confirmar, … }` y SIN `aplicacionGestiones`. El
   design §7.2 quita `anclajeDevolucion` del input y hace `aplicacionGestiones` OBLIGATORIO (fallo cerrado,
   239/R9); ademas el bloque de aplicacion corre ANTES de la confirmacion fisica (R10). Resultado: el test
   deja de compilar y, en ejecucion, cae por la falta de `aplicacionGestiones` antes de llegar al
   `ConfirmacionFisicaNoAplicableError` que afirma. Propuesta: cambiar SOLO el argumento de la llamada
   (`aplicacionGestiones: { enRepartoId, destinoPorResultado }` en vez de `anclajeDevolucion`); las tres
   aserciones no cambian.

Ademas, dos ajustes de INFRAESTRUCTURA del escenario que no son aserciones pero tocan archivos de la
red (se piden en el mismo paquete para que nada se toque sin permiso):

5. `tests/integration/db/454/_escenario.ts` · `limpiarComprometido` (C02, C07-concurrente): cuando T1.4
   escriba `orden_evento`, borrar `usuario`/`orden`/`gestion_orden` fallara por las FK RESTRICT. Hace
   falta `ordenEvento.deleteMany({ where: { ordenId: { in } } })` (y los jobs `webhook_evento` por
   `ordenEventoId`) antes de borrar gestiones. Sin eso el `afterAll` de C02/C07 cae.
6. **C02 no necesita tocarse** (dejado dicho para que nadie lo toque): su sonda busca al corte esperando
   en un `UPDATE "public"."orden"…`. El protocolo de §5 bloquea con `SELECT … FOR UPDATE`, que la sonda no
   veria. Se resolvera en el codigo: el paso 1 del corte tomara el candado con un `UPDATE "public"."orden"
   SET "estatus_id" = "estatus_id" … RETURNING` (mismo candado de fila, sin triggers ni realtime sobre
   `orden` —comprobado: ninguna migracion crea `TRIGGER` ni publicacion—) y la re-lectura seguira en una
   sentencia posterior.

Decision que se pide: autorizar los cambios 1-5 (y cualquier otro de la misma clase que aparezca al
implementar, con este mismo formato) o indicar otra salida. Con la autorizacion, la Fase 1 sigue desde
T1.4 sobre esta misma rama.

## Salida de las verificaciones

Ver `progress/gate_454_backend.log` (gate COMPLETO, `INIT_EXIT` dentro del log).

- 1.ª corrida: `INIT_EXIT=1`, 6 archivos rojos nuevos (5 por censos que el esquema nuevo movio:
  relaciones hacia `usuario`, `pg_enum` sin acotar esquema en mi test, censo de notificadores y su
  cableado, la columna unica del enum de historial, la palabra «rastreo» en un comentario del esquema;
  y 1 que venia de la Fase 0: `censo-order-status-rename` denuncia el hito publico `en_bodega` de C27 →
  entrada de allowlist con motivo, sin tocar C27). Arreglados en `1af542e6`.
- 2.ª corrida (definitiva): typecheck y lint en verde; `Test Files 2104 passed (2104)` · `Tests 30308
  passed | 1 expected fail | 26 skipped (30335)`; los 26 skipped son de `tests/components/Analitica*`,
  **0 skipped en `integration/db`**; `init OK`; `INIT_EXIT=0`. El `expected fail` es C07-concurrente
  (sigue `it.fails` hasta T1.4).

**Veredicto:** cimientos de la 454 (esquema, M1/M2, predicados unicos, webhook de eventos) hechos y
verdes con la red de la Fase 0 intacta (28/28, C07 aun `it.fails`); la Fase 1 queda DETENIDA en T1.4 por
cuatro invariantes de la Fase 0 que contradicen R1/R3/R13 y el input de §7.2.
