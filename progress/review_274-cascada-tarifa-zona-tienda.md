# Review — Feature 274 (cascada de resolucion de tarifa por zona + tienda)

Revisor: subagente reviewer. Fecha: 2026-08-24.
Worktree revisado: `C:\w274`, rama `feature/274-cascada-tarifa-zona-tienda`
(base `77f6242a`; **toda la implementacion esta sin commitear en el arbol de trabajo**).

Material leido: `specs/274-cascada-tarifa-zona-tienda/{requirements,design,tasks}.md`,
`progress/impl_274-cascada-tarifa-zona-tienda.md`, `docs/architecture.md`,
`docs/conventions.md`, `docs/verification.md`, `CHECKPOINTS.md`, y el diff completo
(`git diff HEAD` mas los untracked de la feature).

**VEREDICTO: APROBADO CON RESERVAS.** El codigo, la trazabilidad y las decisiones cerradas
con el humano estan bien. Las dos reservas son de **bookkeeping y las ejecuta el leader**,
no el implementer: `tasks.md` sin marcar y `feature_list.json` contaminado con trabajo ajeno.

---

## 1. Verificacion ejecutable hecha por MI, no leida de la bitacora

| que | resultado |
| --- | --- |
| `pnpm typecheck` | verde, sin salida (exit 0) |
| 14 archivos de test de la feature, corridos juntos | **14 passed / 403 tests passed** |
| `tests/integration/db/drop-tarifa-status-migration.test.ts` con `--reporter=verbose` | **14/14 corren de verdad contra Postgres real**, ninguno saltado |

Los 14: `cascada-tarifa`, `alcance-dinero-sin-especiales`,
`convergencia-tarifa-listado-cierre`, `asimetria-sin-tarifa`, `carga-api-key-sin-tarifa`,
`openapi-carga-409-sin-tarifa`, `tarifa-status-retirado.guard`, `tarifa-vigente-repository`,
`tarifa-service`, `cotizacion-orden-service`, `bulk-orden-service.carga-api`,
`orden-repository`, `cierre-dia-repository`, `tarifa-schemas`.

El `./init.sh` COMPLETO lo midio el leader (1357 archivos / 18.492 tests / 0 rojos); no lo
repito, pero ver el hallazgo **B2**: en el arbol de HOY ese gate ya no es reproducible tal cual.

## 2. Trazabilidad R1-R40 — comprobada requisito por requisito

**40 de 40 tienen test que existe, corre y afirma lo que el requisito dice.** No acepte la
tabla de la bitacora: abri los archivos citados y lei los asserts. Los cinco que el prompt
marcaba como sospechosos:

- **R8 y R21** — `tests/unit/repositories/convergencia-tarifa-listado-cierre.test.ts`.
  No es un test por construccion: `OrdenRepository.list` y `CierreDiaRepository.crearCierre`
  corren sobre el MISMO array de filas y el MISMO doble de `prisma.tarifa.findMany`, que
  devuelve la tabla **entera sin filtrar** (la seleccion tiene que salir de `elegirPorCascada`,
  no del WHERE), y el cierre usa el `TarifaVigenteRepository` **real**, construido ademas
  sobre un `prisma` cuyo `tarifa.findMany` **estalla**, para que la unica via sea el cliente de
  la transaccion. Se compara `tarifa_id` **y** el importe de origen (`valorFlete` mostrado
  frente a `tarifa_valor_flete` congelado) en 4 escenarios; el primero es el caso historico de
  divergencia (generica de 2026-08-01 frente a la de zona de 2026-07-01). Un quinto test
  compara los dos `where` emitidos (`toEqual` entre ellos y contra las tres ramas literales) y
  una autocomprobacion afirma que el montaje **distingue** filas. Muerde.
- **R17** — `tests/guards/tarifa-status-retirado.guard.test.ts`. La regla que descarta
  comentarios **no deja el guardia satisfacible borrando la explicacion**: como los comentarios
  ya estan fuera del censo, borrarlos no cambia el resultado; lo unico que lo pone verde es
  quitar el identificador del CODIGO. Ademas hay contrapruebas permanentes: el censo alcanza
  mas de 100 archivos y ficheros conocidos por nombre; los dos archivos del nombre NUEVO tienen
  que existir (sin eso, borrar el resolver entero dejaria el diente verde); y tres
  autocomprobaciones que le pasan lineas sinteticas de reintroduccion y exigen 1 hallazgo cada
  una. La exclusion de `db/migrations/` esta razonada dentro del test y fijada por un test
  propio. Unica exclusion de archivo: el propio guardia, justificada.
- **R39** — `tests/integration/asimetria-sin-tarifa.test.ts`. El MISMO `TABLA_TARIFAS` para las
  cuatro superficies, resolver real, y los dos bordes de API por su **route handler real**
  (`handleCargaApi` / `handleCotizacionApi`), asi que el 409 sale de
  ConflictError -> withErrorHandler -> appErrorToResponse de verdad. La tabla **no esta
  vacia**: la cascada tiene candidatas y tiene que rechazarlas por nivel. Y la contraprueba
  (una fila del par -> las cuatro responden bien) descarta el verde por montaje roto. Muerde.
- **R40** — `tests/unit/utils/alcance-dinero-sin-especiales.test.ts`. Assert de ejecucion, no
  grep: misma salida con tarifa contaminada (`tarifaEspecial: "999999.00"`, `zonaEspecial`), y
  el listado completo con `tarifa_especial` null vs 999999 mueve el campo mostrado y **no**
  el dinero. Correcto que no sea un grep: el listado si lee `tarifaEspecial` para MOSTRARLA.
- **R9/R10** — SQL de disco aplicado sentencia a sentencia en esquema desechable contra
  Postgres real, con contraprueba de que la consulta si ve la tabla, y un test que **asevera
  la perdida de dato** del down (la fila `inactivo` vuelve `activo`). Verificado corriendolo.

Resto, por muestreo con lectura de asserts: R1-R7 (26 tests del modulo puro mas los tres
niveles por el repo, `where` literal, ausencia de la clave `orderBy`), R11-R16 (11 tests en
`tarifa-service.test.ts`, con spies en cero), R18-R20 (`where`/`select` exactos, 2 consultas
para N=1 y N=50, pagina vacia sin consulta), R22-R24 (`toEqual` sobre la lista exacta de
columnas del snapshot), R25-R31 y R32-R38 (assert sobre el ARGUMENTO de
`createManyOrdenesConGuia`, ausencia de la clave `costos`, constantes **importadas**).

## 3. Las decisiones cerradas con el humano — todas respetadas

- **Fila global (NULL, NULL) prohibida en crear Y en actualizar**: `TarifaService.crear:63`
  y `actualizar:137-139` (par **efectivo** sobre la fila existente), con `TARIFA_SIN_ALCANCE`
  que devuelve `validation_error`. La regla entera vive en el service, no medio en zod:
  razonado en el codigo. R16 no se rompe (4 casos verdes de una sola dimension acotada).
- **`tarifas.status` eliminado entero**: columna mas tipo (migracion `20260825120000` con
  `migration.sql` y `down.sql`), `schema.prisma`, `TarifaDTO`, `UpdateTarifaData`,
  `inactivarPorTienda` y `estadoTarifaSchema`. El guardia de dos dientes impide la vuelta.
- **409 solo si NINGUNA fila del lote resuelve**, y filas mixtas por el mecanismo existente:
  `BulkOrdenService:336` (`if (conTarifa.length === 0) throw new ConflictError(...)`) y
  `CotizacionOrdenService` (`if (pendientes.length > 0 && resuelven === 0)`). La fila mixta se
  degrada a `resultado: "error"` con `errores: { tarifa: [MSG_FILA_SIN_TARIFA] }` — el
  `Record<string, string[]>` que ya existia, sin campo ni codigo nuevo, y contra la constante
  unica de `lib/services/mensajes-tarifa.ts`.
- **Resolucion ANTES de persistir**: la particion conTarifa/sinTarifa y el throw ocurren
  antes de `createManyOrdenesConGuia`, y lo que se persiste es `conTarifa`, no `toCreate`.
  Comprobado en el diff, no en el comentario.
- **Listado y cierre siguen en 0.00 / NULL**: `costosListadoOrden(null, ...)` y las 9
  columnas NULL con el cierre creado; `cargarMasiva` (via sesion) no toca el resolver.
- **`orderBy createdAt desc` retirado**: no queda ninguno en el resolver, y hay un assert de
  **ausencia de la clave** `orderBy` en la llamada.

## 4. T2bis (renombrado puro) y las caducidades

- **Renombrado**: no queda ninguna mencion de `TarifaVigentePorTienda` en `lib`, `app` ni
  `tests` (lo afirma el guardia y lo confirme). Revise uno a uno los archivos que solo debian
  cambiar de nombre (`cierre-pagos-lectura`, `cierres-admin-service`, `ingreso-ordenex.test`,
  los cuatro `integration/db` de comentario, `ingreso-ordenex.ts`, `WalletFeedService.ts`,
  `cierre-detalle.ts`, y las cuatro rutas de `app/`): **filtrando las lineas que contienen el
  identificador, el diff sale vacio**. Los unicos stubs que cambian de contenido
  (`bulk-orden-service.test`, `bulk-orden-service.carga-lote.test`) lo hacen por el colapso de
  la interfaz de T3, con su justificacion escrita al lado. No se colo logica en el renombrado.
  Reserva de proceso (menor): `tasks.md` exigia T2bis en **commit propio**; no hay commits en
  la rama, asi que ese criterio ya no es reverificable post-hoc. Lo compenso la revision
  archivo a archivo de arriba.
- **Caducidades**: las 4 retiradas estan declaradas en la cabecera del test del resolver y en
  la bitacora, **y sustituidas**: el marcador TODO de la deuda (g) por comportamiento (la
  migracion que la paga), la AUSENCIA de `zonaId` en el where por la PRESENCIA en las tres
  ramas, el filtro `status` por su inexistencia, y «la MAS RECIENTE» por el test de orden
  invertido mas el assert de ausencia de `orderBy`. Compare el archivo viejo de `origin/dev`
  (20 casos, 4 bloques) con el nuevo (21 casos, 4 bloques): no hay cobertura perdida en
  silencio.

## 5. `docs/conventions.md` y `docs/architecture.md`

- **Money-safe**: en todo el codigo nuevo del camino del dinero no hay un solo `parseFloat` ni
  conversion a `number`; `TarifaVigente` sigue siendo STRING escala 2 (`toFixed(2)`) y
  `TarifaVigenteResuelta` no gano campos. `ingreso-ordenex.ts` **no se toco** (R24/R40). Los
  `number` de `TarifaDTO` son los preexistentes de MOSTRAR, y R40 fija por test que no mueven
  un centimo.
- **Capas**: el service lanza `ConflictError` (error de dominio), no toca Request/Response;
  la traduccion a 409 la hace el borde con el mecanismo que ya existia; las rutas no ganaron
  logica (`carga/route.ts`, `cotizacion/route.ts`, `chunk/route.ts`, `corte-diario/route.ts`
  solo cambian el import del renombrado). Interfaces en `lib/interfaces/` por categoria.
- **Sin secretos ni contexto hardcodeado**: nada de pais/moneda/cuenta en el codigo nuevo; el
  secreto `ordx_...` del test de asimetria es un fixture, no una credencial.
- Observacion (menor, sin accion): el listado hace su **propia** `tarifa.findMany` en vez de
  llamar a `resolveTarifas`, por el tipo de salida (`TarifaDTO` lleva `tarifaEspecial` y
  `number`, que no deben entrar al resolver del dinero). Es la opcion (ii) del design, esta
  documentada en el codigo y la convergencia queda blindada por T8.4, que compara los dos
  `where`. Aceptado.

## 6. Recorrido de `CHECKPOINTS.md`

- [x] `requirements.md` con EARS numerados R1-R40.
- [x] `design.md` con seccion 5 «Alternativas descartadas» y su porque.
- [ ] **`tasks.md` con todas las tasks `[x]`** -> **NO**: todas las casillas siguen en `[ ]`
      (hallazgo **B1**).
- [x] Cada `R<n>` mapea a al menos un test concreto (verificado uno a uno).
- [x] `progress/impl_274-cascada-tarifa-zona-tienda.md` contiene el mapa `R<n> -> test`.
- [x] `pnpm typecheck` verde (corrido por mi).
- [x] `pnpm lint` sin errores (100 warnings preexistentes y ajenos, medidos por el implementer
      y por el leader en el gate completo).
- [x] `pnpm test` verde (gate completo del leader: 18.492 tests, 0 rojos; mas mis 403 de la
      feature).
- [~] E2E Playwright para flujo critico: **no se anade ninguno**, y lo doy por aceptable —
      `init.sh` no corre Playwright en ningun modo y el borde afectado es una API por key, no
      una pantalla. La cobertura equivalente existe y es mas fuerte: dos tests de integracion
      ejecutan los **route handlers reales** (`handleCargaApi`, `handleCotizacionApi`).
      Observacion, no bloqueante.
- [x] RLS: **no hay tabla nueva** (la unica migracion dropea columna y tipo). No aplica.
- [x] Migracion versionada y reversible: `migration.sql` mas `down.sql`, los dos idempotentes y
      con la perdida de dato declarada por escrito y **verificada por test**.
- [x] Ningun secreto hardcodeado.
- [x] Webhooks: no hay webhook nuevo. No aplica.
- [x] Capas (controller / service / repository / interfaces): ver seccion 5.
- [x] Permisos: la matriz rol-operacion de `TarifaService` no se toco; las guardas nuevas van
      **despues** del chequeo de rol.
- [x] Multi-pais: nada de pais/moneda/cuenta hardcodeado.
- [ ] `./init.sh` verde: verde cuando lo corrio el leader, **pero no reproducible en el arbol
      de hoy** (hallazgo **B2**).
- [x] `progress/review_274-cascada-tarifa-zona-tienda.md` existe (este archivo).
- [ ] Entrada en `progress/history.md`: **pendiente** (es del leader, al mergear).

---

## 7. Hallazgos

### B1 — BLOQUEANTE (bookkeeping): `tasks.md` esta entero sin marcar

`specs/274-cascada-tarifa-zona-tienda/tasks.md` tiene **todas** las casillas en `[ ]`, incluidas
T1, T2, T2bis, T3, T4, T5, T6, T7, T8 y T9.1, que la bitacora declara hechas y que yo verifique
hechas. `CHECKPOINTS.md` lo pide explicito para pasar a `done`.

Que falta para cumplirlo: marcar `[x]` lo realmente hecho y **dejar en `[ ]`** lo que sigue
pendiente por decision — T9.2 (gate, del leader), T9.3 (`feature_list.json`), T9.4 (cuerpo del
PR) y **T10 (aviso a integradores)**, que la propia ficha declara bloqueo de **despliegue a
prod**, no del merge. No es codigo: no vuelve al implementer para tocar `lib/`.

### B2 — BLOQUEANTE (estado del arbol, del leader): `feature_list.json` trae trabajo ajeno

`feature_list.json` en este worktree tiene cambios sin commitear que **no son de la 274**: las
features **266** y **267** pasan de `pending` a `in_progress` y ganan `spec_path`. La 274 no
aparece en ese diff (su alta ya venia del commit `77f6242a`).

Dos consecuencias, y la segunda es la que importa:

1. Si el commit de la feature se hace con `git add -A`, esas dos altas ajenas viajan dentro del
   PR de la 274. El memorandum del repo sobre este archivo aplica tal cual.
2. Con 266, 267 y 274 en `in_progress` hay **3 features backend in_progress**, y la regla 1 de
   `CLAUDE.md` es max 2 por zona. El bloque de `init.sh` que lo valida **solo corre si hay
   `jq`**, y en este entorno `jq` no esta instalado, asi que el chequeo se salta en silencio:
   por eso el gate salio verde. En cualquier entorno con `jq` (o en CI), `./init.sh` **falla**
   con «mas de 2 features in_progress en la misma zona».

Que falta para cumplirlo: dejar `feature_list.json` fuera del commit de la 274 (o restaurarlo a
HEAD en este worktree) y resolver el conteo por zona antes de dar el gate por bueno. Es
arbitraje del leader entre sesiones, no trabajo del implementer.

### m1 — menor: T2bis no quedo en un commit propio

`tasks.md` lo exigia («commit propio, sin nada mas dentro») para que el diff del dinero se
leyera sin el ruido del renombrado. No hay ningun commit en la rama: todo el trabajo esta en el
arbol. El criterio duro T2bis.3 lo midio el implementer en su momento y ya no es reverificable
post-hoc; lo compense revisando archivo por archivo (seccion 4). Sin accion, queda anotado.

### m2 — menor: el guardia de T3.4 no censa `tests/` en el diente (a)

El diente (b) si recorre `tests/`; el (a) se queda en `lib/`, `app/` y `db/schema.prisma`. Hoy
da igual (ningun test nombra la columna como codigo y el typecheck no dejaria compilar uno que
lo hiciera), pero un fixture con SQL crudo en un template string se le escaparia. Sin accion.

### m3 — menor, heredado y ya declarado: `docs/api/api-key-openapi.yaml` no se valida como YAML

Ningun gate lo parsea; los tests de paridad lo tratan como texto por sangria. Anterior a esta
feature y declarado por el implementer. No es hallazgo contra la 274.

### No son hallazgos (declarados y comprobados)

- `db/migrations/20260715140000_cierre_detail/migration.sql:135` conserva el nombre viejo en un
  comentario **a proposito**: editar una migracion aplicada rompe su checksum. Verifique que
  hay un test que fija esa decision y explica el porque a quien intente «arreglarla».
- T6.2 y `carga/route.ts` como no-op: confirmado en el diff, ninguna firma de constructor
  cambio, asi que no habia nada que inyectar distinto.
- T10 (aviso a integradores) pendiente: es accion humana y bloquea prod, no el merge.

---

## 8. Veredicto

**APROBADO CON RESERVAS.**

No hay ni un hallazgo bloqueante de codigo, de trazabilidad ni de decisiones: 40/40 requisitos
con test verificado, los tests sospechosos muerden, la asimetria y la convergencia estan
blindadas contra quien venga a «armonizarlas», y las cuatro decisiones del humano estan en el
codigo, no solo en el comentario.

Las dos reservas (**B1** y **B2**) son de bookkeeping y las cierra el leader antes del merge:
marcar `tasks.md` y sacar del commit las altas ajenas de `feature_list.json` (con el conteo de
in_progress por zona resuelto). Con eso hecho, esto es un **OK**.
