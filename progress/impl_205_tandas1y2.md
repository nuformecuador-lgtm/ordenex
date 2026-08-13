# Feature 205 — Bitácora de implementación, TANDAS 1 y 2

Rama `feature/205-pago-mensajero-desde-wallet`. Alcance: **T1.1 → T1.4** (persistencia) y
**T2.1 → T2.4** (repositorios). La tanda 3 (el servicio) **no se empezó**.
Contrato: `specs/205-pago-mensajero-desde-wallet/{requirements,design,tasks}.md`.
Continúa `progress/impl_205_tanda0.md` (cálculo puro y config del tope, ya en verde).

---

## Contra qué base apunta el entorno

```
$ pnpm exec prisma migrate status
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
114 migrations found ... Database schema is up to date!     ← ANTES de crear la migración
```

Es la base **local de desarrollo**. Tras crear los dos archivos:

```
115 migrations found in prisma/migrations
Following migration have not yet been applied:
20260811140000_liquidacion_reparto
```

**La migración NO se aplicó a ninguna base**, ni local ni remota. Aplicarla es una decisión
humana, posterior y deliberada. El test de T1.4 la ejercita de verdad sin aplicarla (ver abajo).

---

## Archivos creados / modificados

| Archivo | Tarea | Qué |
| --- | --- | --- |
| `db/schema.prisma` | T1.1 | **editado** — modelo `LiquidacionReparto`, `LiquidacionPago.repartoId` + índice + relación, dos inversas en `Usuario` |
| `db/migrations/20260811140000_liquidacion_reparto/migration.sql` | T1.2 | **creado** — UP |
| `db/migrations/20260811140000_liquidacion_reparto/down.sql` | T1.3 | **creado** — DOWN |
| `tests/integration/db/liquidacion-reparto-migration.test.ts` | T1.4 | **creado** — 23 casos (15 estáticos + 8 contra Postgres real) |
| `lib/interfaces/repositories/ILiquidacionRepartoRepository.ts` | T2.1 | **creado** — contrato del acto |
| `lib/repositories/LiquidacionRepartoRepository.ts` | T2.1 | **creado** — dos métodos, ninguno más |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` | T2.2 | **editado** — `CierreImputableDTO`, `listarCierresImputables`, `listarPorReparto`, `CrearLiquidacionPagoInput.repartoId` |
| `lib/repositories/LiquidacionPagoRepository.ts` | T2.2 | **editado** — las dos lecturas nuevas + `reparto_id` en el `create` |
| `lib/services/LiquidacionService.ts` | T2.2 | **editado** — 2 líneas: los dos caminos existentes pasan `repartoId: null` |
| `lib/types/wallet-mensajero.ts` | T2.4 | **editado** — `PagoMensajeroMovimientoDTO.cierreId` |
| `lib/repositories/PagoMensajeroMovimientoRepository.ts` | T2.4 | **editado** — deriva el cierre con UNA consulta por página |
| `tests/unit/repositories/liquidacion-reparto-repository.test.ts` | T2.3 | **creado** — 15 casos |
| `tests/unit/repositories/liquidacion-pago-repository.test.ts` | T2.3 | **editado** — 11 columnas + 12 casos nuevos |
| `tests/unit/repositories/desglose-mensajero-cierre-derivado.test.ts` | T2.4 | **creado** — 8 casos |
| `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts` | T2.4 | **editado** — un caso de la 172 dejó de ser cierto (ver «Cambio de comportamiento») |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | T2.1 | **editado** — censo +2, visto en ROJO antes |
| 9 archivos de test ajenos | T2.2/T2.4 | **editados** — fixtures del DTO y dobles del repositorio (mecánico, ver abajo) |

Los 9 mecánicos: `tests/components/descarga/WalletDescarga.test.tsx`,
`tests/integration/mis-pagos-page.test.tsx`, `tests/integration/wallet-mensajeros-page.test.tsx`,
`tests/unit/actions/wallet-mensajero-descarga-action.test.ts`,
`tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts`,
`tests/unit/services/{caja-cadena-pago-anulacion,liquidacion-anulacion,liquidacion-service}.test.ts`,
`tests/unit/services/{wallet-desglose-mensajero-descarga,wallet-mis-pagos-descarga,wallet-mensajero-service}.test.ts`.
Ni un `assert` cambiado en ninguno: solo el campo nuevo del DTO en los fixtures y los dos métodos
nuevos en los dobles del repositorio. **Los tres archivos de la 172 siguen verdes sin tocar un
solo assert** (R51).

**Nada de UI, nada de servicios de la 205, nada de tanda 3.**

---

## LA TRAMPA: `liquidacion_pago` no gana ninguna restricción única

`LiquidacionPagoRepository.esChoqueDeClave` (`:80-95`) lee un **P2002 sin pista** como choque de
`clave_idempotencia` y lo justifica por escrito con que «`liquidacion_pago` solo tiene dos
restricciones únicas». Bajo el driver adapter de Prisma 7 el `meta.target` llega **vacío**, así
que el choque de un único NUEVO llegaría sin pista → se leería como clave repetida → el servicio
relee por la clave, no la encuentra y responde `no_encontrado` a un pago legítimo.

**Confirmado que sigue siendo cierto al terminar**, por tres vías independientes:

1. **Barrido de TODO `db/migrations`** (script en archivo, con autocomprobación previa — `node -e`
   se come una capa de escapado en este repo):
   ```
   AUTOCOMPROBACION OK: caza las 2 formas de unico y no caza la comentada.

   UNICOS sobre liquidacion_pago en TODO db/migrations:
     - 20260802120000_liquidacion_pago: UNIQUE INDEX liquidacion_pago_clave_idempotencia_key ("clave_idempotencia")

   @unique del modelo LiquidacionPago: [ 'claveIdempotencia' ]
   @@unique del modelo LiquidacionPago: (ninguno)
   ```
   El único de la 172 y ni uno más. La 205 no añade ninguno.
2. **Estático, en el test** (`liquidacion-reparto-migration.test.ts`): la lista de
   `CREATE UNIQUE INDEX` del UP tiene **una** entrada y es de `liquidacion_reparto`; no hay
   `ADD CONSTRAINT ... UNIQUE`; el modelo no gana `@unique` ni `@@unique`.
3. **En el motor** (bloque B): se mide el conjunto de índices únicos de `liquidacion_pago`
   **antes y después** de correr el `migration.sql` real y se exige que sea **idéntico**
   (`{clave_idempotencia, id}`). Y la contracara por comportamiento: **dos pagos del mismo
   reparto conviven** — si `reparto_id` fuera único, el segundo INSERT chocaría.

Queda escrito en los tres sitios donde alguien lo leería antes de romperlo: el docstring del
modelo en `schema.prisma`, la cabecera de `migration.sql` y el propio `esChoqueDeClave`, que ahora
declara su premisa como **viva** y apunta al test que la sostiene.

---

## T1.2 — Cómo se generó el DDL (y por qué no con `db:migrate:create`)

`pnpm run db:migrate:create` es `prisma migrate dev --create-only`, que **aplica las migraciones
pendientes antes** de crear el archivo. Se usó:

```
$ pnpm exec prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script
```

Salida **verbatim** en `migration.sql` (3 `ALTER`/`CREATE`, 3 índices, 3 FK), sin drift ni ruido.
A mano se añadieron las dos cosas que Prisma no expresa y que el design exige: el
`CHECK (monto_total > 0)` y el `ENABLE ROW LEVEL SECURITY`. Es el mismo reparto de trabajo que la
migración de la 172. No se creó **ningún** enum, así que ningún `down.sql` previo se toca.

`down.sql` en orden inverso y por un motivo ejecutable, no cosmético: primero
`liquidacion_pago DROP COLUMN reparto_id` (que se lleva la FK y el índice), después
`DROP TABLE liquidacion_reparto`. Al revés, la FK viva haría fallar el `DROP TABLE`. Sin
`CASCADE`: si algún día hubiera una dependencia no prevista, lo correcto es que el rollback FALLE.

---

## T1.4 — El test corre la migración REAL, sin aplicarla

Molde de `ranking-snapshot-migration.test.ts` (feature 196), con una vuelta de tuerca propia.

- **Bloque A (15 casos, sin Postgres):** forma del DDL — columnas, tipos, el `UNIQUE`, el `CHECK`
  sin `NOT VALID`, las 3 FK `RESTRICT`, el índice `(mensajero_id, created_at DESC)`, RLS sin
  policies, aditividad (ni `DROP`, ni `RENAME`, ni `ALTER COLUMN`, ni DML) y el orden del DOWN.
- **Bloque B (8 casos, Postgres real):** dentro de una transacción que **siempre se revierte**,
  crea un esquema temporal, **clona `liquidacion_pago` con `INCLUDING ALL`** y ejecuta ahí el
  `migration.sql` real, sentencia a sentencia.

**Por qué el clon.** El UP hace `ALTER TABLE "liquidacion_pago" ADD COLUMN`. Con el `search_path`
apuntando primero al esquema temporal, esa sentencia cae en el clon y no en la tabla real: el test
no toma un `ACCESS EXCLUSIVE` sobre una tabla de dinero ni depende de que la transacción revierta
para no dejar rastro. Y como `INCLUDING ALL` copia índices y restricciones, el clon es exactamente
lo que hace medible el criterio duro (mismos únicos antes y después).

**Por qué no puede quedar verde por vacío** (la cicatriz del `if (!fks) return;`): no consulta
datos preexistentes y no tiene una sola guarda de abstención. Crea su usuario, su reparto y sus
filas, y **cada aserción es sobre el mensaje de error de una sentencia que debía fallar** o sobre
un conjunto medido. Si faltara una restricción, la sentencia pasaría y el caso se pondría rojo por
«no falló lo que tenía que fallar». Lo único que lo salta es la ausencia de `DATABASE_URL`, y
entonces vitest lo marca **skipped**, nunca passed. Además hay dos **controles**: una clave
distinta para el mismo mensajero **sí** entra (si el único estuviera sobre `mensajero_id`, el caso
del duplicado también pasaría y nadie lo notaría), y dos pagos del mismo reparto **sí** conviven.

`down.sql` se ejecuta de verdad al final del bloque y se compara la lista de columnas de
`liquidacion_pago` contra la de antes: **idéntica**, no «parecida».

---

## T2.1 / T2.2 / T2.4 — Decisiones que el spec no fijaba

- **El DTO del reparto lleva `mensajeroId` y `registradoPor`**, no el nombre del registrador. El
  repositorio no hace el `include` del nombre porque el DTO de frontera (R48) se compone en el
  servicio; el `mensajeroId` sí hace falta para que la respuesta idempotente compruebe que el
  reparto releído es el del mensajero que se pide.
- **`obtenerPorClave` no admite `tx`**, y está escrito por qué: en Postgres el choque de la clave
  deja la transacción abortada, así que la relectura ocurre necesariamente fuera. Un parámetro
  opcional invitaría a usarlo donde no puede funcionar.
- **`CrearLiquidacionPagoInput.repartoId` es OBLIGATORIO** aunque la columna sea nullable. Es lo
  que obliga a todo camino de escritura a declarar a qué grupo pertenece lo que escribe; con un
  campo opcional, un escritor futuro podría olvidarse y el reparto quedaría irreconstruible (R28).
  Hay un test que exige que la clave **se emita** con `null`, no que se omita.
- **`CierreImputableDTO` no emite `resuelto_at`.** No emitirla es lo que impide que alguien la use
  por descuido y convierta la latencia administrativa en la prioridad de cobro (Q1, design §2.4).

### Cambio de comportamiento en un test de la 172 (T2.4)

`pago-mensajero-filtro-cierre.test.ts` afirmaba «sin `cierreId` **NO** se consulta
`liquidacion_pago`». Dejó de ser cierto **a propósito**: R43 obliga a derivar el cierre de cada
fila, y las filas cuyo origen es un PAGO solo saben su cierre mirando el documento (design §7.3).
El caso no se borró: se **afiló** a lo que sigue siendo verdad y es lo que protegía —el FILTRO no
cuesta nada cuando no se filtra— y se le añadieron dos casos nuevos: con filtro son **dos**
consultas (filtro + derivación) y sin filas de pago la derivación **no consulta nada**. El
mini-motor del doble pasó a honrar el `select`, para que no mienta sobre cuál de los dos caminos
pide qué.

---

## El censo money-safe, visto en ROJO antes de ampliarlo

Los dos archivos nuevos de `lib/**` casan `/[Ll]iquidacion/`, así que la cláusula de auto-captura
tenía que tumbar el barrido al crearlos. Se comprobó **antes** de tocar el censo:

```
 FAIL  tests/unit/guards/liquidacion-money-safe.test.ts > ... > el censo de archivos de la
       feature existe entero y cubre sus propios árboles
AssertionError: expected [ …(2) ] to deeply equal []

- []
+ [
+   "lib/interfaces/repositories/ILiquidacionRepartoRepository.ts",
+   "lib/repositories/LiquidacionRepartoRepository.ts",
+ ]

 ❯ tests/unit/guards/liquidacion-money-safe.test.ts:157:56
```

Ése es el mensaje que se da por bueno: falla el test del **censo**, en la línea de la cláusula de
auto-captura, y **nombra los dos archivos**. Tras censarlos: `Tests 7 passed (7)`.

---

## Mutaciones — el veredicto

Runner en scratchpad: aplica la mutación, corre la suite, cuenta rojos y **restaura siempre**,
verificando el hash del archivo tras restaurar. **22 mutaciones, 22 muertas.**

> **El runner mintió en la primera vuelta, y esa es la parte que hay que leer.** La primera
> corrida reportó **9 SOBREVIVEN de 9**. No era cierto: usaba `--reporter=basic`, que en vitest 4
> **no existe** y hace petar el arranque, así que no se corrió un solo test. La segunda corrida
> reportó otra vez 9/9 supervivientes por un motivo distinto: la regex `/Tests\s+(.+)/` cazaba
> primero la línea `⎯⎯⎯ Failed Tests 3 ⎯⎯⎯` y leía «3 ⎯⎯⎯» como resumen, con cero rojos. Es
> exactamente la trampa que la memoria del repo documenta. El runner lleva ahora **dos
> autocomprobaciones obligatorias**: aborta si la línea base no es legible, y descarta como
> «salida ilegible» (no como «muerta») cualquier corrida mutada que no produzca un
> `N passed|failed`.

### T1.4 — la migración (9/9)

| # | Mutación | Veredicto |
| --- | --- | --- |
| a | el `UNIQUE` de `clave_idempotencia` pasa a índice normal | **muerta** — 3 en rojo |
| b | `reparto_id` apunta a `usuario(id)` en vez de a `liquidacion_reparto(id)` | **muerta** — 1 en rojo |
| c | **LA TRAMPA**: se le cuela un `UNIQUE` a `liquidacion_pago(reparto_id)` | **muerta** — 3 en rojo |
| d | el `CHECK (monto_total > 0)` se cae | **muerta** — 2 en rojo |
| e | la FK del mensajero pasa a `ON DELETE CASCADE` | **muerta** — 2 en rojo |
| f | la RLS no se habilita | **muerta** — 2 en rojo |
| g | `reparto_id` nace `NOT NULL` | **muerta** — 1 en rojo |
| h | el `down.sql` suelta la TABLA antes que la COLUMNA | **muerta** — 1 en rojo |
| i | el índice de auditoría pierde el `DESC` | **muerta** — 1 en rojo |

### T2.3 — los repositorios (13/13)

| # | Mutación | Veredicto |
| --- | --- | --- |
| j | el reparto **se relee por mensajero**: devuelve el reparto de otro acto | **muerta** — 4 en rojo |
| k | el choque de clave se PROPAGA en vez de salir como resultado | **muerta** — 4 en rojo |
| l | el P2002 sin pista deja de leerse como choque (rompe el driver adapter) | **muerta** — 1 en rojo |
| m | el reparto se escribe con el cliente propio en vez de con el `tx` | **muerta** — 1 en rojo |
| n | `listarCierresImputables` pierde el filtro `estado: aprobado` | **muerta** — 1 en rojo |
| o | `listarCierresImputables` pierde el acotado por mensajero | **muerta** — 1 en rojo |
| p | el `orderBy` pasa a `resueltoAt` (la fecha administrativa) | **muerta** — 1 en rojo |
| q | `listarCierresImputables` gana un `take` (el tope acotaría la LECTURA) | **muerta** — 1 en rojo |
| r | `listarPorReparto` filtra por cierre en vez de por reparto | **muerta** — 2 en rojo |
| s | el pago deja de emitir `reparto_id` | **muerta** — 3 en rojo |
| t | la derivación copia el `origen_id` del PAGO como si fuera el cierre | **muerta** — 4 en rojo |
| u | la derivación hace UNA consulta POR FILA en vez de una por página | **muerta** — 3 en rojo |
| v | el origen `manual` (con `origen_id` NULL) se inventa un cierre | **muerta** — 1 en rojo |

Las tres que el encargo pedía por su nombre son **a**, **b** y **j**, y las tres caen.

---

## Mapa `R<n> → test` (lo que estas dos tandas cubren)

| Requisito | Test |
| --- | --- |
| R5 | `liquidacion-pago-repository.test.ts` («EL WHERE: filtra por mensajero Y por estado `aprobado`») |
| R6 | `liquidacion-pago-repository.test.ts` («el PENDIENTE no sale de aquí»: el DTO no lo lleva) |
| R8 | `liquidacion-pago-repository.test.ts` («EL ORDEN: `solicitadoAt` asc + `id` asc, y NUNCA `resueltoAt`») |
| R24 (parcial) | ídem — el `where` acota por mensajero |
| R26 | `liquidacion-pago-repository.test.ts` («listarlos no ESCRIBE nada en el cierre») |
| R28 | `liquidacion-reparto-repository.test.ts` (relectura por clave) + `liquidacion-pago-repository.test.ts` (`listarPorReparto`, `reparto_id` emitido) + `liquidacion-reparto-migration.test.ts` (FK y RESTRICT reales) |
| R29 | `liquidacion-reparto-migration.test.ts` (el `UNIQUE` **rechaza** el duplicado en Postgres) + `liquidacion-reparto-repository.test.ts` (`clave_repetida` sin lanzar; cero TOCTOU) |
| R43 | `desglose-mensajero-cierre-derivado.test.ts` (las 3 ramas de §7.3, una consulta por página, la descarga sin el campo) |
| R49 | `liquidacion-reparto-migration.test.ts` (aditiva, RLS, `down.sql` real deja el esquema idéntico) |
| R51 | `liquidacion-service.test.ts` verde **sin tocar un assert** + el caso «emite `null` cuando no nace de ningún reparto» |
| R52 | `liquidacion-reparto-repository.test.ts` (no existe escritura que no sea el INSERT, medido también estructuralmente) |
| R53 (parcial) | `liquidacion-pago-repository.test.ts` («SIN `take`: el tope acota la ESCRITURA, no la lectura») |

R14/R15/R17/R18–R25/R30/R32–R38/R44–R48/R54–R58 son de las tandas 3+ y no se tocan aquí.

---

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run` (los 5 archivos de estas tandas) | `Test Files 5 passed (5) · Tests 104 passed (104)` |
| `pnpm exec vitest run tests/unit/guards tests/integration/db` | `Test Files 125 passed (125) · Tests 1541 passed (1541)` |
| `pnpm exec tsc --noEmit` | `exit=0`, sin salida |
| `pnpm exec vitest run tests/unit` (extra) | `Test Files 704 passed (704) · Tests 8922 passed (8922)` |
| `pnpm exec vitest run tests/integration tests/components` (extra) | `420 + 173 archivos passed` · `5442 + 2218 tests passed` |
| `pnpm run lint` (extra) | `0 errors, 58 warnings` |

Las 58 warnings: 57 preexistentes (baseline de la tanda 0) + **1 nueva**, un `'_args' is defined
but never used` en `desglose-mensajero-cierre-derivado.test.ts:52`. Es el parámetro tipado del
doble que hace legible `mock.calls[0][0]`, y es **literalmente la misma warning** que ya tiene
`historicos-paginados-where.test.ts:42`, el archivo del que este hereda el patrón. Se deja por
consistencia con el molde establecido.

El gate de tanda (`./init.sh --rapido`) y el completo los corre el leader: son suyos, no míos.

---

## Veredicto

Tandas 1 y 2 cerradas: el acto de repartir existe como fila con su barrera de datos, la migración
es aditiva y reversible **y está sin aplicar**, los dos repositorios entregan lo que la tanda 3
necesita —incluido el `WHERE` probado donde vive—, el desglose ya sabe a qué cierre pertenece cada
fila, y `liquidacion_pago` **no ganó ninguna restricción única**, comprobado por barrido, por
estático y en el motor.

---

## Addendum — el bloque B del test de migración era una bomba diferida (arreglo)

**Síntoma.** `tests/integration/db/liquidacion-reparto-migration.test.ts` pasaba **solo mientras
la migración de la 205 no estuviera aplicada**. Al aplicarla en local, el `beforeAll` del bloque B
moría con `42701 · ya existe la columna «reparto_id» en la relación «liquidacion_pago»` y vitest
reportaba `15 passed | 8 skipped`. Se habría puesto rojo para **todo el mundo** el día del
despliegue, con un síntoma que no apunta a su causa.

**Causa.** El bloque clona `liquidacion_pago` en un esquema temporal con
`LIKE public."liquidacion_pago" INCLUDING ALL` y ejecuta ahí el `migration.sql` REAL. El clon es
una **foto de `public`**: con la migración aplicada, la foto ya trae `reparto_id`, y el
`ALTER TABLE … ADD COLUMN` del UP choca contra el propio clon. El DDL es correcto; lo que fallaba
era cómo el test lo ejercía.

**Arreglo** (solo `tests/integration/db/liquidacion-reparto-migration.test.ts`; el ayudante
compartido `_postgres-real.ts` **no se tocó**):

1. **Normalización incondicional del clon.** Antes de medir nada, al clon se le aplica el
   `down.sql` REAL. Lleve la foto la columna o no, la línea base es siempre el estado ANTERIOR a
   la migración y el UP se ejerce **entero** en los dos casos. Nada se detecta ni se salta: el
   `down.sql` es `IF EXISTS` por contrato y el bloque A ya fija su contenido exacto por igualdad
   de lista, así que si alguien lo cambia, lo primero que se pone rojo es el bloque A.
2. **`search_path` por DDL** (nuevo helper local `aplicarDdl(tx, ddl, esquemas)`, sustituye al
   `SET LOCAL` único del principio). El UP corre con `[esquema, public]` porque sus FK apuntan a
   la tabla `usuario` REAL; el DOWN corre con `[esquema]` **sin `public`**, porque en la
   normalización el esquema temporal todavía no tiene `liquidacion_reparto` y su
   `DROP TABLE IF EXISTS` habría resuelto contra la tabla real. El `DELETE FROM liquidacion_pago`
   previo al down final va ahora **cualificado**: es la única sentencia destructiva de datos del
   bloque y no se deja al arbitrio del `search_path`.
3. **La invariante, medida** — test nuevo «la LINEA BASE es el estado ANTERIOR a la migracion,
   este o no aplicada en `public`»: `columnasDelPagoAntes === columnasDelPagoEnPublic − reparto_id`.
   Tiene contenido en los DOS estados de la base: con la migración aplicada solo se cumple porque
   la normalización quitó la columna; sin aplicar, afirma que la normalización no se llevó por
   delante ninguna otra columna.
4. **Guarda que FALLA con el motivo escrito** (no que se salta): si tras normalizar el clon
   siguiera teniendo `reparto_id`, `medir` lanza un error que dice exactamente eso, en vez de
   dejar que el UP muera dos líneas después con el críptico `42701`.

**Los dos mutantes** (aplicados, medidos y revertidos):

| Mutación | Resultado |
| --- | --- |
| La normalización se pasa de largo (`DROP COLUMN "nota"` de más) | `1 failed` · `23 passed` — cae **solo** el test nuevo: `expected [ 'cierre_id', …(10) ] to deeply equal [ 'cierre_id', …(11) ]` |
| La normalización se queda corta (inerte, `SELECT 1`) | `15 passed` · `9 skipped` con el mensaje escrito: «El clon de `liquidacion_pago` sigue teniendo `reparto_id` DESPUES de normalizarlo…» |

**Prueba en LOS DOS ESTADOS de la base** (mismo fichero de test, sin tocar nada entre corridas):

| Estado de `public` | Comprobación | Resultado |
| --- | --- | --- |
| **Migración APLICADA** (`migrate status`: *up to date*) | `pnpm exec vitest run tests/…/liquidacion-reparto-migration.test.ts` | `24 passed (24)` · **0 skipped** |
| **Migración SIN APLICAR** (`pnpm run db:rollback`; `migrate status`: *have not yet been applied*; verificado en la base: `reparto_id` NO existe, `liquidacion_reparto` NO existe, sin fila en `_prisma_migrations`) | ídem | `24 passed (24)` · **0 skipped** |
| SIN APLICAR | `pnpm exec vitest run tests/integration/db` | `100 passed (100) · 1268 passed (1268)` |
| APLICADA (estado final, tras `prisma migrate deploy`) | `pnpm exec vitest run tests/integration/db` | `100 passed (100) · 1268 passed (1268)` · **0 skipped** |

**Los 8 «skipped» no eran una guarda de entorno.** Eran los 8 tests del bloque B: cuando el
`beforeAll` de una suite revienta, vitest lista sus tests como SKIPPED y el fichero como FAILED.
Es decir, el «8 skipped» era el **síntoma del mismo defecto**, no un motivo legítimo aparte. Con el
hook sano el fichero corre sus 24 tests y salta **cero**, y la corrida completa de
`tests/integration/db` (1268 tests) también reporta **0 skipped**. Queda escrito en la cabecera del
fichero para que el próximo que lea una corrida en rojo no lo confunda con una guarda.

**Estado final de la base:** `prisma migrate status` → `115 migrations found` ·
**`Database schema is up to date!`** (la migración quedó APLICADA, como estaba al empezar).

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/integration/db` | `Test Files 100 passed (100) · Tests 1268 passed (1268)` |
| `pnpm exec tsc --noEmit` | `exit=0`, sin salida |
| `pnpm run lint` | `0 errors, 58 warnings` — las 58 preexistentes; **ninguna** en el fichero tocado |

**Veredicto:** el bloque B ya no depende del estado de la base — se prueba corriendo verde con la
migración aplicada y sin aplicar, y las dos mutaciones lo ponen rojo.
