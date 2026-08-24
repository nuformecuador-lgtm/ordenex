# Bitacora de implementacion — Feature 274 (cascada de resolucion de tarifa por zona + tienda)

Rama: `feature/274-cascada-tarifa-zona-tienda` (base `origin/dev`, 273 ya mergeada).
Spec: `specs/274-cascada-tarifa-zona-tienda/` (requirements R1–R40, design, tasks T0–T10).

## T0 — Baseline medido ANTES de tocar nada (2026-08-24)

`pnpm exec prisma migrate status` -> "Database schema is up to date!" (148 migraciones, sin
pendientes). `tarifas.status` y el tipo `estado_tarifa` EXISTEN en la base local: punto de
partida correcto para T2.

`pnpm test` (suite completa, sin ningun cambio en el arbol):

```
 Test Files  2 failed | 1347 passed (1349)
      Tests  2 failed | 18348 passed | 26 skipped (18376)
   Duration  554.21s
```

Los 2 rojos son **ajenos y flaky por saturacion** (`Test timed out in 20000ms`, el patron
conocido de esta suite; cambian de archivo entre corridas):

- `tests/components/DetalleMensajeroPanel.test.tsx > ... con el TECLADO`
- `tests/integration/wallet-tiendas-desglose.test.tsx > R45 ...`

Ese es el denominador contra el que se mide el delta de T2bis y el cierre de T9.

### Nota de entorno (drift local, no bloqueante)

La base local conserva la columna `tarifas.deleted_at` aunque
`20260824140000_tarifa_zona_is_default` la dropea y `migrate status` da todo aplicado. Es drift
de la base de desarrollo, anterior a esta feature; no afecta a T2.3, que corre contra un
**esquema desechable** aplicando el SQL de disco.

---

## T1 — La regla, en un modulo puro `lib/utils/cascada-tarifa.ts` (hecha)

Archivos: `lib/utils/cascada-tarifa.ts` (nuevo), `tests/unit/utils/cascada-tarifa.test.ts` (nuevo,
26 tests verdes). Sin imports de `@prisma/client` (afirmado por un test que lee el fuente).

**Desvio del design §2.1 que hubo que hacer para que compile.** El contrato publicado escribe
`tiendaId?: string | { in: string[] }` (sin `null`) y a la vez exige la rama 3
`{ tiendaId: null, zonaId: { in: zonas } }`: eso no tipa. La firma real de `whereCascada` amplia
el tipo a `tiendaId?: string | { in: string[] } | null`. Sigue siendo estructuralmente compatible
con `Prisma.TarifaWhereInput` (`tienda_id` es nullable desde la 273). El resto del contrato es
literal.

## T2bis — Renombrado PURO del resolver (hecha, R17)

`TarifaVigentePorTiendaRepository` -> `TarifaVigenteRepository` y
`ITarifaVigentePorTiendaRepository` -> `ITarifaVigenteRepository`, con `git mv` de los tres
archivos (los dos de produccion y `tests/unit/repositories/tarifa-vigente-repository.test.ts`) y
32 importadores actualizados. Doce de produccion, no diez: el spec no listaba
`lib/utils/cierre-detalle.ts` ni `lib/services/WalletFeedService.ts`, que importan el tipo
`TarifaVigente`; ni sus dos tests.

**Criterio duro de T2bis.3, cumplido:** `git diff -M` sobre `lib app tests`, filtrado por las
lineas que no contienen el identificador viejo ni el nuevo, sale **vacio**. Siguen en pie el
bloque `TODO:` de la deuda (g), los `orderBy createdAt desc`, los `where` y `status`, y los tres
metodos con sus nombres viejos: todo eso es T3.

**Delta de tests contra el baseline: 0 rojos.**

```
 Test Files  1350 passed (1350)
      Tests  18376 passed | 26 skipped (18402)
   Duration  525.04s
```

1350 = 1349 del baseline + el archivo nuevo de T1. 18376 = 18348 + los 26 de T1 + los 2 que en el
baseline habian caido por timeout: queda confirmado que los 2 rojos del baseline eran flakes de
saturacion y no deuda de `dev`.

### Una cita del nombre viejo que NO se toco, a proposito

`db/migrations/20260715140000_cierre_detail/migration.sql:135` nombra
`TarifaVigentePorTiendaRepository` en un comentario. Es una migracion **ya aplicada**: Prisma
guarda el checksum del archivo en `_prisma_migrations` y editarla —aunque sea un comentario— hace
fallar `prisma migrate deploy` con "migration was modified after it was applied" en toda base que
ya la tenga (y `pnpm build` encadena migrate-deploy). Por eso el guardia de T3.4 recorre
`lib/`, `app/` y `tests/`, no `db/migrations/`.

## T2 — Migracion `20260825120000_drop_tarifa_status` (hecha, R9/R10)

Archivos: `db/migrations/20260825120000_drop_tarifa_status/migration.sql` y `down.sql` (nuevos),
`db/schema.prisma` (fuera el campo `status` y el `enum EstadoTarifa`),
`tests/integration/db/drop-tarifa-status-migration.test.ts` (nuevo, 14 tests verdes, ninguno
saltado — `HAY_BASE_DE_DATOS` true).

UP: `ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "status";` + `DROP TYPE IF EXISTS "estado_tarifa";`
DOWN: recrea el tipo (`DO $$ ... EXCEPTION WHEN duplicate_object`) y la columna
`NOT NULL DEFAULT 'activo'`, con el comentario que **declara la perdida de dato**: restaura la
columna, no los valores; toda fila vuelve como `activo`. Aceptable porque `status` nunca entro en
el WHERE del camino de liquidacion (esa era literalmente la deuda (g)) y porque la feature 70
midio CERO tarifas `inactivo` en produccion.

El test no se conforma con regex: aplica el SQL **de disco** sentencia a sentencia en un esquema
desechable contra Postgres real. Tras el UP, insertar sin `status` funciona **e insertar con
`status` es rechazado**, `information_schema.columns` no lista la columna (con contraprueba de que
la consulta si ve la tabla, para que un esquema mal nombrado no de un verde falso) y `pg_type` no
lista el enum. Tras el DOWN, el enum vuelve con sus dos labels en orden, la columna vuelve
`NOT NULL DEFAULT 'activo'` con `udt_name = estado_tarifa`, y un test dedicado **asevera la
perdida de dato** (la fila sembrada `inactivo` vuelve `activo`).

Efecto colateral necesario: `db/schema.prisma:164` (`PlantillaEstado`) citaba «patron
EstadoTarifa/RolValue»; se dejo en «patron RolValue». Era una referencia a un enum que deja de
existir y ademas pondria rojo el diente (a) del guardia de T3.4.

La migracion **se aplico a la base local** con `pnpm exec prisma migrate deploy` (149 migraciones,
sin reset). Nunca `db:migrate`.

## T3 — Contrato y resolver (hecha, R1–R8, R17, R37)

`lib/interfaces/repositories/ITarifaVigenteRepository.ts` pasa de 3 metodos a **2**:

```ts
resolveTarifa(tiendaId: string, zonaId: string | null): Promise<TarifaVigente | null>;
resolveTarifas(pares: readonly ParTarifa[], tx?: TarifaTxClient): Promise<Map<string, TarifaVigenteResuelta | null>>;
```

Fuera `resolveTarifaPorTienda`, `resolveTarifaCotizablePorTienda` (R37: al morir `status` ya no hay
nada que separe cotizacion de liquidacion) y `resolveTarifasPorTiendas`. `TarifaVigente` y
`TarifaVigenteResuelta` **no cambian**: la aritmetica de `ingreso-ordenex.ts` no se toca (R24). El
`tx` pasa a segundo y opcional.

`lib/repositories/TarifaVigenteRepository.ts` se reescribe sobre `whereCascada` + `elegirPorCascada`.
El `where` emitido para `[{t1,z1},{t2,z2}]`, sin `orderBy`:

```ts
{ OR: [
  { tiendaId: { in: ["t1","t2"] }, zonaId: { in: ["z1","z2"] } }, // nivel 1
  { tiendaId: { in: ["t1","t2"] }, zonaId: null },                // nivel 2
  { tiendaId: null,                zonaId: { in: ["z1","z2"] } }, // nivel 3
] }
```

Para un par sin zona (R6) queda **una sola rama** (la 2). `resolveTarifas([])` devuelve el Map
vacio **sin tocar la base** (`{ OR: [] }` en Prisma no filtra: traeria la tabla entera). El
singular emite el mismo `where` con un par y proyecta con un `soloFormula` campo a campo, para que
`tarifaId`/`fulfillment` no se filtren al camino no-snapshot.

Se borro el bloque `TODO:` de la deuda (g) y el docstring de `resolveTarifaCotizablePorTienda`; en
su lugar hay un parrafo «DEUDA (g): PAGADA por esta feature» que explica como.

### Caducidades retiradas en T3, con su justificacion

Declaradas una a una en la cabecera de `tests/unit/repositories/tarifa-vigente-repository.test.ts`:

1. `describe("R30 — marcador TODO: de la deuda (g)…")` y sus 4 tests estructurales sobre el texto
   del fuente (exigian que el `TODO:` siguiera presente y mencionara `status`, `PR #64`,
   `feature 69`). **La deuda se paga en esta feature**: un guardia que exige que la deuda siga
   *documentada* no puede sobrevivir a su *pago*. Lo sustituye comportamiento, no comentario.
2. Los tests que fijaban la **AUSENCIA** de `zonaId` en el `where`: eran el contrato textual de la
   regla vieja («por tienda, NO por zona»). Los sustituye el assert de **PRESENCIA** de `zonaId` en
   las tres ramas.
3. Todo test del filtro `status: "activo"` (el `describe` entero de la tarifa cotizable y los tres
   que fijaban la ausencia de `status`): la columna ya no existe (R37).
4. Los tests de «la MAS RECIENTE» / `orderBy: { createdAt: "desc" }`: fijaban el desempate por
   `createdAt` que el UNIQUE `(zona_id, tienda_id) NULLS NOT DISTINCT` vuelve innecesario (R5).
   Los sustituyen el test de orden invertido (replicado tambien por el repo, no solo en T1.2) y un
   assert de **ausencia de la clave `orderBy`** en la llamada.

## T4 — Tipos, repositorio y service de tarifa (hecha, R11–R16)

`lib/types/tarifa.ts` (fuera `estadoTarifaSchema`, el `.extend({ status })`, `TarifaDTO.status` y el
import de `EstadoTarifa`), `lib/interfaces/repositories/ITarifaRepository.ts` y
`lib/repositories/TarifaRepository.ts` (fuera `UpdateTarifaData.status`, `status: row.status`,
`out.status` y **`inactivarPorTienda` entero**), `lib/services/TarifaService.ts`
(`TARIFA_SIN_ALCANCE` + las dos guardas). `lib/actions/tarifas.ts` **no hizo falta tocarlo**: sus
`status` son el discriminante de `ActionResult`, no la columna.

`actualizarTarifaSchema` queda `crearTarifaSchema.partial().strict()`: mandar `status` es
`validation_error` **sin escribir validacion nueva** (el issue de zod es `unrecognized_keys`, y un
test lo afirma — asi se distingue de un enum invalido).

**Hueco aceptado y declarado** (design §2.2, decision del humano 2026-08-24): al retirar
`inactivarPorTienda` el caso «la tienda deja de ser `adminTienda`» queda sin cobertura, **como ya
estaba de hecho** porque nadie llamaba a ese metodo. No se abre ficha. Queda el comentario en el
sitio del metodo para que nadie lo reintroduzca sin pensar.

Los tests muerden, comprobado por mutacion temporal: quitando las dos guardas de `TarifaService`
caen 4 tests; reintroduciendo `inactivarPorTienda`, `UpdateTarifaData.status` y `TarifaDTO.status`
caen 3 mas.

## T6.0 — `lib/services/mensajes-tarifa.ts` (hecha, R38)

`MSG_FILA_SIN_TARIFA` y `MSG_CARGA_SIN_TARIFA`, un unico dueno de cada cadena publicada (mismo
argumento que `mensajes-cotizacion.ts`: duplicar el literal lo convierte en dos cadenas que
divergen a la primera errata). `MSG_COTIZACION_SIN_TARIFA` no se toco.

Decision tomada sobre una discrepancia entre el prompt y el spec: el literal de
`MSG_CARGA_SIN_TARIFA` lleva **tilde** («no se pueden crear órdenes»), como lo escribe
`design.md` §3.5. Es la convencion del repo: comentarios sin tilde, **cadenas de usuario con
tilde** (precedente en `mensajes-correccion-dia-reparto.ts`).

## T5 — Cierre de dia (hecha, R21–R24, R7, R39)

`lib/repositories/CierreDiaRepository.ts`: `resolveTarifasPorTiendas(tx, tiendaIds)` ->
`resolveTarifas(pares, tx)`, indexado con `clavePar({ tiendaId, zonaId })`. Sigue dentro de la
`$transaction`, sigue siendo **una** sola llamada, `SNAPSHOT_SELECT` y `tarifaColumnas` intactos.
`lib/actions/cierre-dia.ts`: solo el comentario (la inyeccion no cambia).
`app/api/cron/corte-diario/route.ts`: **sin cambios**, la inyeccion ya era correcta.
Huerfanos reparados: `tests/unit/repositories/gestion-desde-ayuda-cierre.test.ts` y
`tests/unit/services/rol-admin-satelite-authz.test.ts` (solo sus stubs de la interfaz).

Decision de diseno que hace que los tests prueben algo: el doble del resolver ya **no** es un
diccionario por tienda, sino filas de `tarifas` con sus dos dimensiones nullables, elegidas con
`elegirPorCascada` —la misma funcion pura del repo real—. Un `crearCierre` que olvidara pasar la
zona resolveria nivel 2 y R22 se pondria rojo; con el doble viejo eso era indetectable.

| R | test |
| --- | --- |
| R22 | unit «congela la fila de NIVEL 1 aunque exista una de nivel 2 mas reciente» y «dos ordenes de la MISMA tienda en zonas distintas congelan tarifas DISTINTAS»; integracion, con el resolver **sin mockear**, hace la de nivel 2 la mas nueva (`2026-08-01` vs `2026-07-01`) y aun asi gana `ta-z1`, y el dinero liquidado sale de esa fila |
| R7 (cierre) | unit «N ordenes de M pares distintos => UNA sola llamada al resolver batch (sin N+1)»: 4 ordenes / 3 pares, `resolveTarifas` 1 vez, `resolveTarifa` 0. **Es el test que antes decia «una tienda con varias ordenes se resuelve UNA vez»: actualizado, no borrado.** Integracion: cuenta la `tarifa.findMany` real y comprueba las 3 ramas del `where` |
| R23/R39 | unit «par SIN tarifa => las 9 columnas NULL y el cierre se crea igual» y «una orden sin tarifa NO impide que las demas congelen la suya»; integracion idem |
| R24 | unit «la lista EXACTA de columnas escritas» + integracion «las MISMAS columnas que en dev»: `toEqual` sobre las listas de 26 columnas, no una descripcion. `ingreso-ordenex.ts` no se toco |

7 archivos, `Test Files 7 passed / Tests 223 passed`, ninguno saltado (comprobado con
`--reporter=verbose` que `corte-diario-segundo-cierre-sql-real` corre sus 4 tests contra Postgres
real y no cae en el `describe.skip`).

## T6 — Carga via API: cascada + 409 (hecha, R25–R31, R38)

`lib/services/BulkOrdenService.ts`: fuera `tarifaLote`; `zonaPorRemision` + `indicePorRemision`;
**una** `resolveTarifas` con los pares distintos de `toCreate`; particion `conTarifa`/`sinTarifa`;
`ConflictError(MSG_CARGA_SIN_TARIFA)` **antes de tocar la base**; degradacion de la fila sin tarifa
a `{ resultado: "error", errores: { tarifa: [MSG_FILA_SIN_TARIFA] } }`;
`createManyOrdenesConGuia(conTarifa, …)`; `costoEnvioDeTarifa` por fila creada. `cargarMasiva`
(via sesion) intacta (R39).

**`app/api/ordenes/api-key/carga/route.ts` NO se toco** y **T6.2 (`carga-masiva/chunk/route.ts`)
resulto un no-op**: ni el constructor del service ni el de `TarifaVigenteRepository` cambian de
firma, asi que no habia nada que inyectar distinto. El `409` sale por
`ConflictError -> withErrorHandler -> appErrorToResponse`, verificado **ejecutando el borde real**
en el test de integracion nuevo (`res.status === 409`, cuerpo
`{ status: "error", code: "CONFLICT", message: MSG_CARGA_SIN_TARIFA }`), no razonandolo.

| R | test |
| --- | --- |
| R25 | «dos ordenes del MISMO lote en zonas distintas con tarifas distintas cobran distinto» (`3.92` vs `11.20`, con `not.toBe` entre si) |
| R26 | `toHaveBeenCalledTimes(1)` y el argumento deduplicado |
| R27 | unit e integracion, `200` |
| R28 | **assert sobre `mock.calls[0][0]`**: `createManyOrdenesConGuia` recibe UNA sola fila |
| R29 | `409` + spies en cero (ni `carga`, ni notificacion, ni ordenes), unit e integracion |
| R30 | lote entero con distritos inexistentes -> `200` y `resolveTarifas` **no llamado** |
| R31 | `JSON.stringify(summary)` no contiene ningun `costoEnvio: "0.00"`; el cuerpo del `409` no lleva importes |
| R38 | `toEqual({ tarifa: [MSG_FILA_SIN_TARIFA] })` contra la **constante importada** |
| summary | lote de 4 (creada/degradada/duplicada/geo): `total === rows.length` y `creadas + duplicadas + conError === total` |

Se **invirtio** el test 98/R8/D1 que fijaba el `"0.00"`: era exactamente el contrato que esta
feature deroga. `Test Files 4 passed / Tests 127 passed`, ninguno saltado.

## T6.4 + T7.4 — Contrato publicado (hecha, R31 y la mitad de contrato de R38)

`lib/api/openapi-spec.ts` y su espejo `docs/api/api-key-openapi.yaml`, mas
`tests/unit/api/openapi-carga-409-sin-tarifa.test.ts` (nuevo). Ningun test de contrato existente
necesito cambio.

- `/carga`: fuera la afirmacion del `"0.00"`; dos parrafos nuevos (la fila sin tarifa vuelve en
  `error` con clave `tarifa` y **no se crea**; el `409` de lote, **con la distincion de R30**
  escrita explicitamente para que no de un diagnostico falso). El `409` va **inline y no
  `$ref: Conflict`**: un `$ref` no admite `example`, y el criterio exigia que el ejemplo fuera la
  constante. Ejemplo nuevo de `200`: `filaSinTarifa`.
- `/cotizacion`: el parrafo que describia el `409` como «la tienda no tiene tarifa vigente» **y**
  declaraba la asimetria con `/carga` se borro entero: las dos mitades dejaron de ser ciertas. Al
  parrafo de `totales` se le anadio el **segundo motivo de exclusion** y el coste declarado.
- Descripciones de schema que tambien mentian: `CargaOrden.costoEnvio`, y `errores` de las dos
  APIs, que no documentaban la clave `tarifa`.

Trampa evitada y dejada escrita en el test: el `not.toContain("0.00")` se aplica **solo al bloque
`description`** del yaml, no al path entero, porque el `requestBody` de `/carga` trae
`monto_cobrar: "40.00"` y seria un falso rojo permanente.

`tests/unit/api/`: `Test Files 11 passed / Tests 185 passed` (los 4 de paridad `.ts` <-> `.yaml`
preexistentes entre ellos).

**Riesgo declarado:** el `.yaml` **no se valida como YAML en ninguna parte** (no hay parser de YAML
en el arbol); los tests de paridad lo tratan como texto plano por sangria. Un error de indentacion
en ese archivo hoy no lo detecta ningun gate.

## T8 — Listado de ordenes (T8.1–T8.3, R18–R20; T8.4 y T8.5 mas abajo)

`lib/repositories/OrdenRepository.ts` con la opcion (ii) del design §4.1: el include de `tienda`
queda en `id, nombre, email, telefono`; `resolverTarifasDePagina(rows)` deduplica pares con
`clavePar` y hace **una** `prisma.tarifa.findMany({ where: whereCascada(pares), select })` +
`elegirPorCascada`; `toListItemDTO(row, tarifa)`; `findListItemsByIds` usa el mismo resolver.
Tambien `lib/types/orden.ts` (solo comentarios) y cuatro fixtures/tests, dos de ellos huerfanos que
`tasks.md` no nombraba (`tests/fixtures/orden-detalle-dia.ts`,
`tests/integration/_semilla-tablero-dia.ts`).

Consultas por pagina, **medidas** con el doble de Prisma para N=1 y N=50 con las 50 filas en 2
zonas: `orden.findMany` x1 + `tarifa.findMany` x1 (mas el `orden.count` que ya existia), y el
`where` de tarifas llega con los pares **deduplicados**, no con 50 entradas. Pagina vacia y
`findListItemsByIds([])`: **cero** consultas de tarifas.

| R | test |
| --- | --- |
| R18 | «dos ordenes de la MISMA tienda en zonas distintas muestran importes distintos» (`1130.00` vs `2260.00`, y la generica de nivel 2 no gana) + «la cascada es la del modulo puro — where y select exactos» |
| R19 | «una pagina de 1 o 50 filas hace 2 consultas de datos, no N+1» |
| R20 | «una orden sin tarifa sale con `tarifa: null` y `"0.00"`, sin romper la pagina» + «una pagina VACIA no consulta tarifas» |
| — | describe propio para `findListItemsByIds`: misma cascada, una sola query adicional, mismo `null` / `"0.00"` |

`Test Files 2 passed / Tests 74 passed`, mas 16 archivos consumidores de los fixtures huerfanos
(8 unit + 8 de integracion contra Postgres): 113 + 63 tests verdes.

## T7 — Cotizacion por API key (T7.1–T7.3 hechas, R32–R38)

`lib/services/CotizacionOrdenService.ts`: `CotizacionTarifaRepository` pasa a
`Pick<ITarifaVigenteRepository, "resolveTarifas">`; orden invertido (geo -> pares -> **una**
resolucion -> escenarios por fila); criterio de lote §3.6 aplicado: `C` vacio -> ni se consulta el
repo y sale `ok` con totales en cero (**no** `sin_tarifa`); alguna de `C` resuelve -> las que no se
degradan con `errores: { tarifa: [...] }` y **sin** clave `costos`; ninguna de `C` resuelve ->
`{ status: "sin_tarifa" }` comprobado **antes** de calcular ningun importe (`derivarIngresoOrden`
ni se llama). `status: "sin_tarifa"` conservado con su significado estrechado, en comentario.

**`app/api/ordenes/api-key/cotizacion/route.ts` no aparece en el diff de T7** (criterio de T7.2):
lo unico que esa ruta cambia en toda la feature son las dos lineas de import/inyeccion del
renombrado de T2bis.

`tests/unit/services/cotizacion-orden-service.test.ts`: **41 passed**, con R32 (dos zonas, ambas
**no-centrales** para que la diferencia no venga de la columna GAM), R33, R34 (ausencia de la clave
`costos`, `conError 1`, `filasSumadas 1`, `filasExcluidas 1`, totales == la fila cotizada), R35
(el espia de `derivarIngresoOrden` no invocado), R36 (`resolveTarifas` no llamado), R37 (**doble
Proxy que estalla ante cualquier metodo que no sea `resolveTarifas`**: assert de ejecucion, no
grep) y R38 contra la constante importada. Se reescribio el test de la 255 que afirmaba lo
contrario, con el motivo de la inversion al lado.

## T7.3 — el bloque HTTP de la cotizacion (CERRADA 2026-08-24)

El `describe` de R32/R33/R34/R36 a nivel HTTP quedo escrito y sin pegar durante el incidente del
stash. Se **releyo contra el codigo actual antes de pegarlo** (no a ciegas): el harness que
necesita —`depsReales({ tarifa: { z1, z3 } })` con `TarifaPorZona`, `filaOk`, `filaSinCobertura`,
`TARIFA_Z3`, el distrito `d3` no-central en `z3`, `monedaConfig` y `MSG_FILA_SIN_TARIFA`— sigue
existiendo tal cual en el archivo, asi que no hubo que adaptar nada. Va como **seccion 7** al
final de `tests/integration/cotizacion-api-key.test.ts`.

`Test Files 1 passed / Tests 24 passed`; comprobado con `--reporter=verbose` que los **4** tests
nuevos corren de verdad (R32, R33, R34 lote mixto y R36 lote entero sin cobertura -> 200).

### Hallazgo colateral que vale para otras guardias

`FUENTE_SERVICE` de `CotizacionOrdenService.ts` **no contiene los imports**: la cabecera dice
"sin next/*" y ese `/*` abre un bloque que el quitador de comentarios se traga hasta el primer
cierre de comentario, ya dentro del cuerpo. Cualquier guardia estructural sobre imports de ese
archivo pasa en verde sin mirar nada — incluida la que ya existia sobre imports de `next/`.

---

## INCIDENTE (2026-08-24, 16:08) — otra sesion stasheo la rama entera y cambio de rama

A las **16:08:25**, con cinco subagentes trabajando, otra sesion ejecuto sobre este checkout un
`git stash push -u -m "wip-274-cascada-tarifa-antes-de-80-correo"` seguido de un checkout a
`feature/80-notificaciones-email-otp`. El `git reflog` lo confirma: `821a6afe HEAD@{0}: checkout:
moving from feature/274-cascada-tarifa-zona-tienda to feature/80-notificaciones-email-otp`.

**No se perdio nada.** Todo el trabajo de la 274 esta integro en `stash@{0}`: 55 archivos
trackeados + 22 untracked (tercer padre `417f28f9`), incluidos `lib/utils/cascada-tarifa.ts`,
`lib/services/mensajes-tarifa.ts`, la migracion `20260825120000_drop_tarifa_status/` completa y
esta bitacora.

### Que paso despues, y que se hizo

El subagente de T8 seguia vivo y, para poder trabajar, restauro desde el stash 7 archivos **dentro
del arbol de la rama 80** (leyendo del stash, sin modificarlo). Eso dejo codigo de la 274 en el
checkout de una rama ajena y ademas **habria hecho chocar el `git stash pop`** posterior.

Contencion aplicada por el implementer, en este orden:

1. Respaldo integro de los 7 archivos y del diff completo en
   `.../scratchpad/rescate-274/t8-post-stash/` (incluido `_diff-t8-vs-HEAD80.patch`, 746 lineas,
   aplicable sobre `821a6afe`, que es **la misma base** de `feature/274`).
2. `git restore` de los 6 trackeados y borrado del untracked, **solo esos 7**, sin tocar nada de la
   feature 80 ni el stash.
3. Verificacion de que la recuperacion vuelve a ser limpia:
   `git stash show -p stash@{0} | git apply --check -` **pasa sin conflicto**.

No se cambio de rama, no se commiteo, no se toco el stash ni se hizo `pop`: eso lo arbitra el
leader, porque la otra sesion esta viva en `feature/80`.

### Como se recupera

`git switch feature/274-cascada-tarifa-zona-tienda`, luego `git stash pop stash@{0}`, y despues
**volver a aplicar el trabajo post-stash de T8**, que es lo unico que el stash NO tiene: el parche
`_diff-t8-vs-HEAD80.patch` del respaldo, o directamente los 7 archivos de
`rescate-274/t8-post-stash/`, que son la version final y verde de T8.

---

## T3.4 — Guardia `tests/guards/tarifa-status-retirado.guard.test.ts` (hecha, R13/R17)

Archivo nuevo, **8 tests verdes**, dos dientes, branch-agnostica (recorre el arbol, no un diff:
no caduca al mergear).

- **Diente (a), R13:** censa `lib/`, `app/` y `db/schema.prisma` buscando
  `/estado_?tarifa|\btarifas?\.status\b/i` — con esa grafia unica caen `EstadoTarifa`,
  `estadoTarifaSchema` y `estado_tarifa`.
- **Diente (b), R17:** censa `lib/`, `app/` y `tests/` buscando `TarifaVigentePorTienda`.

**Tres decisiones de diseno, cada una con su motivo:**

1. **`db/migrations/` NO se recorre.** Ya estaba razonado arriba (checksum en `_prisma_migrations`;
   editar `20260715140000_cierre_detail/migration.sql:135` rompe `migrate deploy`, y `pnpm build`
   lo encadena). El porque esta escrito **dentro del test**, y ademas hay un test dedicado que lo
   fija: comprueba que la cita historica **sigue ahi intacta** y que el censo esta vacio aun asi.
   Si alguien "arregla" esa cita, ese test le explica lo que acaba de romper.
2. **Se censa CODIGO, no texto: las lineas de comentario pueden nombrarlos.** Hay cuatro citas
   vivas (`lib/types/tarifa.ts:57-58`, `ITarifaRepository.ts:76`, `TarifaRepository.ts:171`) que
   son parrafos que **documentan la retirada**, puestos donde vivia el codigo borrado. Prohibir la
   cadena tambien en comentarios haria que la guardia se satisficiera **borrando la explicacion**
   —el memorandum del repo sobre criterios tipo grep—. Se censa la linea cuyo contenido efectivo
   no empieza por `//`, `*` o `/*`. Con esa regla el censo sale vacio **sin una sola excepcion en
   lista blanca**.
3. **No se usa un quitador de comentarios**, y no es pereza: en esta misma feature se midio que el
   quitador ingenuo se traga desde un `/*` que aparece dentro de un comentario de linea hasta el
   primer cierre de bloque, dejando fuera del censo tramos de codigo REAL (le paso a
   `FUENTE_SERVICE` de `CotizacionOrdenService`). Una guardia que no ve el codigo pasa en verde
   sin mirar nada.

**Se excluye UN archivo del censo: el propio guardia** (vive bajo `tests/` y contiene los
identificadores a proposito, en los patrones y en las autocomprobaciones). Sin esa linea la unica
forma de ponerlo verde seria borrar las autocomprobaciones, que es lo que lo hace valer algo.

**Muerde, comprobado por mutacion** (sonda `lib/__tmp_guard_probe.ts` con
`ITarifaVigentePorTiendaRepository` y `EstadoTarifa`, borrada despues): **3 de 8 tests en rojo**,
uno por cada diente mas el censo. Ademas hay dos contrapruebas permanentes: que el censo alcanza
>100 archivos y ficheros conocidos por nombre, y que los dos archivos del **nombre nuevo** existen
(sin eso, borrar el resolver entero dejaria el diente (b) en verde).

## T8.4 — Convergencia listado/liquidacion (hecha, R8/R21)

`tests/unit/repositories/convergencia-tarifa-listado-cierre.test.ts` (nuevo, **6 tests verdes**).
Es la contraprueba directa del drift: `dev` resolvia el listado con
`tarifasTienda { where: { status: "activo" }, take: 1 }` (regla propia, sin zona, sin orden) y la
liquidacion con `resolveTarifaPorTienda` + `orderBy createdAt desc`. Con la misma base, una fila
mostrada y otra facturada.

**Como se prueba de verdad y no por construccion:** los dos caminos —`OrdenRepository.list` y
`CierreDiaRepository.crearCierre`— corren contra el **MISMO array de filas** y el **MISMO doble de
`prisma.tarifa.findMany`**, y el cierre usa el **`TarifaVigenteRepository` REAL**, no el doble de
su suite (que devuelve lo que se le pida y por tanto no detectaria un cierre con regla propia). El
doble devuelve la **tabla entera sin filtrar**: la seleccion tiene que salir de `elegirPorCascada`
en memoria, sin apoyarse en que el `WHERE` ya hubiera descartado las candidatas ajenas. Ademas el
`prisma` de fuera de la tx tiene un `tarifa.findMany` que **estalla**, para que la unica via viable
sea el cliente de la transaccion.

Cuatro escenarios, y el primero es el caso historico de divergencia: **una tarifa generica de la
tienda (`2026-08-01`) mas reciente que la de la zona (`2026-07-01`)** — la que ganaba con el
`orderBy` viejo. Los otros tres barren nivel 2, nivel 3 y el hueco. En cada uno se comparan el
**`tarifa_id`** y el **importe de origen** (`valorFlete` del DTO frente a `tarifa_valor_flete`
congelado). Un quinto test compara los dos `where` emitidos: `toEqual` entre ellos y contra las
tres ramas literales, asi una condicion propia (`status`, `deletedAt`, un `take`) se detecta
**antes** de que llegue a divergir la fila. Y una autocomprobacion afirma que el montaje
**distingue** filas (con otra tabla, otra fila elegida), para que un montaje que siempre devolviera
`null` no diera cuatro verdes vacios.

**Muerde, comprobado por mutacion**: cambiando `zonaId: row.zonaId` por `zonaId: null` en
`resolverTarifasDePagina` (el listado vuelve a resolver "por tienda") caen **5 de 6**. Fuente
restaurada byte a byte y reverificada.

## T8.5 — La asimetria declarada (hecha, R39)

`tests/integration/asimetria-sin-tarifa.test.ts` (nuevo, **6 tests verdes**). Las **cuatro**
afirmaciones en un solo archivo, con una cabecera que empieza por «⚠️ SI ESTE ARCHIVO SE TE PONE
ROJO, LEE ESTO ANTES DE ARREGLARLO» y explica los dos motivos (quien no controla el dato no puede
quedar bloqueado; un `"0.00"` servido como precio a un integrador es una mentira sobre dinero),
remitiendo a requirements §«Tres superficies, dos comportamientos».

**El MISMO estado de `tarifas`, y es literal:** un unico array `TABLA_TARIFAS` y un unico doble de
`prisma.tarifa.findMany` alimentan las cuatro superficies, todas resolviendo con el
**`TarifaVigenteRepository` REAL**. Los dos bordes de API se ejercitan por su **route handler real**
(`handleCargaApi`, `handleCotizacionApi`), no por el service: el `409` sale de
`ConflictError -> withErrorHandler -> appErrorToResponse`, que es codigo que nadie escribio para
esta feature y por tanto hay que ejecutarlo.

La tabla **no esta vacia**: tiene una fila de otra tienda en la misma zona y una de otra zona de la
misma tienda. Asi la cascada tiene candidatas delante y tiene que **rechazarlas** por nivel, en vez
de que el vacio haga el trabajo.

| superficie | respuesta ante el MISMO hueco |
| --- | --- |
| listado | `tarifa: null`, `fleteConIva` y `comisionConIva` en `"0.00"`, sin error |
| cierre de dia | `cierreId` creado y **las 9** columnas de tarifa en NULL (el resto de la fila si se congela) |
| carga por API key | `409` `{ code: "CONFLICT", message: MSG_CARGA_SIN_TARIFA }`, cero escrituras, ningun importe en el cuerpo |
| cotizacion por API key | `409` `{ code: "CONFLICT", message: MSG_COTIZACION_SIN_TARIFA }`, sin importes |

Un quinto test las afirma **de una sola vez**, en un solo `toEqual` sobre las cuatro respuestas,
para que la asimetria se lea junta y no como cuatro casos sueltos que alguien pueda "armonizar" de
uno en uno.

**CONTRAPRUEBA (sexto test), y es la que hace que el resto signifique algo:** anadiendo UNA fila de
nivel 1 del par a la misma tabla, las cuatro pasan a responder bien (`ta-del-par` en listado y
cierre, `200` en los dos bordes). Sin ella, una geografia mal montada o un actor mal formado darian
`"0.00"` y dos `409` por motivos que no tienen nada que ver con la tarifa, y el archivo estaria
verde por la razon equivocada.

## R40 — Alcance declarado (hecha; era el hueco sin task)

`requirements.md` pide R40 en la tabla de trazabilidad pero **`tasks.md` nunca le asigno task**, asi
que nadie lo escribio. Se cierra con `tests/unit/utils/alcance-dinero-sin-especiales.test.ts`
(nuevo, **9 tests verdes**). **No estaba cubierto por ningun otro test**: se comprobo antes de
escribirlo (ningun archivo del arbol afirmaba nada sobre esas dos columnas).

Las dos columnas **existen** (`db/schema.prisma:466` `zona_especial`, `:1169` `tarifa_especial`) y
las dos suenan a que deberian afectar al precio. R40 declara que no lo hacen y que esta feature
—que es justo la que reescribe **que fila** de `tarifas` se elige— no las conecta «ya que estamos».

El test **no es un grep**, porque un grep aqui daria un falso rojo: el listado **si** lee
`tarifaEspecial`, dentro de `TarifaDTO`, porque la pantalla de configuracion de tarifas la muestra
y la edita. Leerla para MOSTRARLA no es leerla para COBRAR. Asi que la afirmacion central es de
**ejecucion**:

- `derivarIngresoOrden`, `costoEnvioDeTarifa` y `costosListadoOrden` dan resultado **identico** con
  una tarifa contaminada con `tarifaEspecial: "999999.00"`, `zonaEspecial: true` y `esEspecial: true`
  (`toEqual` contra el limpio, mas los importes concretos para que no sea `{}` contra `{}`).
- El **listado completo**, con `tarifa_especial` en `null` y en `999999.00`: lo que cambia es
  `relaciones.tienda.tarifa.tarifaEspecial` (`null` -> `999999`) y lo que **no** cambia es
  `fleteConIva` / `comisionConIva`. Ese es el assert de R40 en el unico sitio donde la columna si
  se lee.
- `resolveTarifas`: el `select` emitido son 11 claves exactas, **ninguna** casa `/especial/i`, y la
  fila resuelta tampoco propaga la columna aunque el doble la haya colado.
- El TIPO: `TarifaVigente` tiene 7 claves y ninguna es especial — mientras no la tenga, la formula
  **no puede** leerla ni queriendo.
- Estructural, como complemento (cubre las funciones de agregacion que no se invocan): siete
  modulos del camino del dinero, ninguno nombra `zonaEspecial`/`zona_especial`, y el test **falla
  si un modulo de la lista se renombra** en vez de saltarselo en silencio. Con un test previo que
  afirma que las columnas SI estan en el schema, para que el censo no mire un sitio vacio.

---

## Verificacion del tramo de cierre (2026-08-24)

```
pnpm typecheck   ->  tsc --noEmit, SIN salida (verde)
pnpm lint        ->  100 problems (0 errors, 100 warnings) — las 100 son `_var` no usada en
                     tests preexistentes, ajenas: NINGUNA cae en un archivo de esta feature
```

Los cuatro archivos nuevos + el modificado + los siete relacionados de la feature, juntos:

```
 Test Files  12 passed (12)
      Tests  332 passed (332)
```

(`tarifa-status-retirado.guard`, `convergencia-tarifa-listado-cierre`, `asimetria-sin-tarifa`,
`alcance-dinero-sin-especiales`, `cotizacion-api-key`, `orden-repository`, `cierre-dia-repository`,
`tarifa-vigente-repository`, `cotizacion-orden-service`, `bulk-orden-service.carga-api`,
`carga-api-key-sin-tarifa`, `cascada-tarifa`.) El gate completo lo corre el leader.

---

## Estado por tarea

| Task | Estado |
| --- | --- |
| T0.1 baseline | hecha |
| T1 modulo puro + tests | hecha |
| T2 migracion + schema + test | hecha (migracion **aplicada** a la base local) |
| T2bis renombrado puro | hecha, delta de tests **0** |
| T3.1–T3.3 contrato y resolver | hecha |
| T3.4 guardia `tarifa-status-retirado` | hecha (8 tests, muerde por mutacion) |
| T4 tipos, repo y service de tarifa | hecha |
| T5 cierre de dia | hecha |
| T6.0 mensajes | hecha |
| T6.1–T6.3 carga via API | hecha (T6.2 = no-op justificado) |
| T6.4 contrato de `/carga` | hecha |
| T7.1–T7.2 cotizacion | hecha |
| T7.3 integracion de cotizacion | hecha (bloque HTTP pegado y verificado contra el codigo actual) |
| T7.4 contrato de `/cotizacion` | hecha |
| T8.1–T8.3 listado | hecha |
| T8.4 test de convergencia (R8/R21) | hecha (6 tests, muerde por mutacion) |
| T8.5 test de la asimetria (R39) | hecha (6 tests, con contraprueba) |
| T9.1 mapa R -> test | **completo** (abajo, los 40, sin huecos) |
| R40 (sin task en `tasks.md`) | hecha: `alcance-dinero-sin-especiales.test.ts` |
| T9.2 `./init.sh` completo | **NO corrido** (es del leader; ademas el arbol esta hoy en otra rama) |
| T9.3 `feature_list.json` | del leader |
| T10 aviso a integradores | **pendiente, accion humana**; bloquea el despliegue a `prod`, no el merge |

## Mapa `R<n> -> test` (T9.1)

| R | test |
| --- | --- |
| R1 | `tests/unit/utils/cascada-tarifa.test.ts` (un caso por nivel 1/2/3) + `tests/unit/repositories/tarifa-vigente-repository.test.ts` (los tres niveles por el repo) |
| R2 | `cascada-tarifa.test.ts`: ninguno aplica; la fila global entre las candidatas y el par sigue en `null`; la global tampoco aplica a un par sin zona |
| R3 | `cascada-tarifa.test.ts` (recencia = posicion en el array, al final y al principio) + `cierre-detail-congelado.test.ts` con fechas reales |
| R4 | `cascada-tarifa.test.ts`: tienda sin fila propia cobra la de zona, y deja de aplicar en cuanto tiene su nivel 2 |
| R5 | `cascada-tarifa.test.ts` (orden invertido, comparado entrada por entrada) + assert de **ausencia de la clave `orderBy`** en `tarifa-vigente-repository.test.ts` |
| R6 | `cascada-tarifa.test.ts` (solo nivel 2) + el `where` de una sola rama en `tarifa-vigente-repository.test.ts` |
| R7 | `tarifa-vigente-repository.test.ts` (una `findMany` para N pares, `where` literal de tres ramas); `cierre-dia-repository.test.ts` (4 ordenes / 3 pares -> 1 llamada); `bulk-orden-service.carga-api.test.ts` (1 por lote); `cotizacion-orden-service.test.ts` (1 por peticion); `orden-repository.test.ts` (1 por pagina) |
| R8 | `tests/unit/repositories/convergencia-tarifa-listado-cierre.test.ts`: los DOS caminos (`OrdenRepository.list` y `CierreDiaRepository.crearCierre` con el resolver **real**) corren sobre el MISMO array de filas y el MISMO doble de `prisma.tarifa.findMany`, y se compara el **`tarifa_id`** en 4 escenarios (el primero, el del drift: generica mas reciente frente a la de zona) + un test que compara los dos `where` emitidos. Muerde por mutacion (5/6 rojos al volver a resolver "por tienda") |
| R9 | `tests/integration/db/drop-tarifa-status-migration.test.ts`: tras el UP, insertar sin la columna funciona y con ella es rechazado; `information_schema` no la lista y `pg_type` no lista el enum |
| R10 | mismo archivo: tras el DOWN el enum vuelve con sus dos labels, la columna vuelve NOT NULL con su default, y un test **asevera la perdida de dato** |
| R11 | `tests/unit/types/tarifa-schemas.test.ts` (el issue es `unrecognized_keys`, no un enum invalido) + `tests/integration/actions/tarifas-action.test.ts` (3 casos, spy en cero) |
| R12 | `tarifa-service.test.ts` (ausencia de clave en crear/obtener/listar), `tarifas-action.test.ts` (`Object.keys`), `tarifa-repository.test.ts` (proyeccion), `tarifa-schemas.test.ts` (el TIPO, con `keyof TarifaDTO`), y `orden-repository.test.ts` para la tarifa anidada del listado |
| R13 | `tarifa-repository.test.ts`: prototipo sin el metodo + cuerpo de la interfaz con comentarios quitados + `UpdateTarifaData` sin la clave |
| R14 | `tarifa-service.test.ts`: crear sin tienda y sin zona -> `validation_error` y **CERO** llamadas al repo (tres spies en cero) |
| R15 | `tarifa-service.test.ts`: `{ zonaId: null }` sobre una fila sin tienda, y el simetrico; `update` no se llama |
| R16 | `tarifa-service.test.ts`, cuatro casos (tienda sin zona, zona sin tienda, y los dos `null` sobre filas que conservan la otra dimension) |
| R17 | `tests/guards/tarifa-status-retirado.guard.test.ts`, **diente (b)**: censa `lib/`, `app/` y `tests/` y falla si reaparece `TarifaVigentePorTienda` fuera de un comentario; mas el test de que los dos archivos del nombre NUEVO existen (si no, borrar el resolver dejaria el diente verde). `db/migrations/` fuera del censo, con el porque escrito y un test que fija que la cita historica sigue intacta. Muerde por mutacion |
| R18 | `orden-repository.test.ts`: dos ordenes de la misma tienda en zonas distintas dan importes distintos, + `where` y `select` exactos |
| R19 | `orden-repository.test.ts`: una pagina de 1 o 50 filas hace 2 consultas de datos, no N+1 |
| R20 | `orden-repository.test.ts`: orden sin tarifa -> `tarifa: null` y cero, sin romper la pagina; pagina vacia no consulta tarifas |
| R21 | el mismo `convergencia-tarifa-listado-cierre.test.ts`: ademas del `tarifa_id`, compara el **importe de origen** (el `valorFlete` que muestra el listado frente al `tarifa_valor_flete` que congela el cierre) en los 4 escenarios, y una autocomprobacion afirma que el montaje DISTINGUE filas |
| R22 | `cierre-dia-repository.test.ts` + `tests/integration/db/cierre-detail-congelado.test.ts` (nivel 1 gana con la de nivel 2 mas reciente, resolver **sin mockear**) |
| R23 | los mismos dos archivos: 9 columnas en NULL y cierre creado |
| R24 | los mismos dos: `toEqual` sobre la lista de 26 columnas de `dev` |
| R25 | `bulk-orden-service.carga-api.test.ts`: dos zonas, `3.92` frente a `11.20` |
| R26 | `bulk-orden-service.carga-api.test.ts`: una llamada, argumento deduplicado |
| R27 | `bulk-orden-service.carga-api.test.ts` + `tests/integration/carga-api-key-sin-tarifa.test.ts` |
| R28 | los mismos: assert sobre el ARGUMENTO de `createManyOrdenesConGuia` (una sola fila) |
| R29 | los mismos: `409` y spies en cero (ni ordenes, ni fila de carga, ni notificacion) |
| R30 | los mismos: lote sin cobertura -> `200` y el repo de tarifas **no consultado** |
| R31 | `bulk-orden-service.carga-api.test.ts` (ningun cero emitido en el summary) + `tests/unit/api/openapi-carga-409-sin-tarifa.test.ts` (el contrato declara el `409`, el ejemplo es **la constante**, la descripcion ya no lo promete) |
| R32 | `cotizacion-orden-service.test.ts`: dos zonas **no-centrales**, importes distintos, una sola consulta |
| R33 | `cotizacion-orden-service.test.ts`: todas cotizadas, `conError` y `filasExcluidas` en cero |
| R34 | `cotizacion-orden-service.test.ts`: **ausencia de la clave `costos`**, `conError 1`, `filasSumadas 1`, `filasExcluidas 1`, totales iguales a los de la fila cotizada |
| R35 | `cotizacion-orden-service.test.ts` (el espia de la aritmetica no se invoca) + el shape del `409` en `tests/integration/cotizacion-api-key.test.ts`, comparado contra el error construido, no re-descrito |
| R36 | `cotizacion-orden-service.test.ts`: `resolveTarifas` no llamado, totales en cero |
| R37 | `cotizacion-orden-service.test.ts`: doble **Proxy** que estalla ante cualquier metodo que no sea `resolveTarifas` (assert de ejecucion, no grep) |
| R38 | `bulk-orden-service.carga-api.test.ts` y `cotizacion-orden-service.test.ts`, ambos contra la constante **importada**; mitad de contrato en `openapi-carga-409-sin-tarifa.test.ts` (las cuatro descripciones: dos APIs por dos artefactos) |
| R39 | `tests/integration/asimetria-sin-tarifa.test.ts`: **las cuatro superficies con el MISMO array `TABLA_TARIFAS` y el MISMO doble de `tarifa.findMany`**, resolviendo con el `TarifaVigenteRepository` real; los dos bordes por su **route handler real**. Listado `"0.00"` + `tarifa: null`, cierre creado con **las 9** columnas en NULL, carga `409` sin escrituras, cotizacion `409` sin importes; un test las afirma de una sola vez en un `toEqual`, y una **contraprueba** anade la fila del par y las cuatro pasan a responder bien |
| R40 | `tests/unit/utils/alcance-dinero-sin-especiales.test.ts` (9 tests). Assert de **ejecucion**, no grep: `derivarIngresoOrden`, `costoEnvioDeTarifa` y `costosListadoOrden` dan resultado identico con una tarifa contaminada (`tarifaEspecial: "999999.00"`, `zonaEspecial`, `esEspecial`); el **listado completo** con `tarifa_especial` `null` vs `999999` cambia el campo mostrado y NO el dinero; el `select` de `resolveTarifas` (11 claves) y la fila resuelta no traen ninguna clave `/especial/i`; `TarifaVigente` tiene 7 claves; y un censo estructural sobre 7 modulos del camino del dinero para `zona_especial`, con un test previo de que la columna SI existe en el schema |

**Sin huecos: los 40 requisitos tienen test.** Los cinco que faltaban (R8, R17, R21, R39 y R40) se
cerraron el 2026-08-24 con T3.4, T7.3, T8.4, T8.5 y el test de alcance de R40 —el unico requisito
que `tasks.md` nunca asigno a ninguna task—. **Ninguno toco codigo de produccion**: cuatro archivos
de test nuevos y un bloque `describe` anadido a `tests/integration/cotizacion-api-key.test.ts`.

Queda del leader: T9.2 (`./init.sh` completo), T9.3 (`feature_list.json`) y T10 (aviso a
integradores, accion humana que bloquea el despliegue a `prod`, no el merge).

---

## T9.2 — `./init.sh` COMPLETO, salida real (2026-08-24, worktree `C:\w274`)

El modo rápido se niega solo en esta feature: el diff toca `db/migrations/`, `db/schema.prisma`
y `lib/types/`. Corrido el completo:

```
== Arnes SDD :: init (modo: completo) ==
✓ node v22.13.1
✓ dependencias presentes
✓ typecheck paso
✓ lint paso
 Test Files  1357 passed (1357)
      Tests  18492 passed | 26 skipped (18518)
✓ test paso
✓ .env presente
== init OK ==
EXIT=0
```

Delta contra el baseline de `dev` (1349 archivos / 18.376 tests): **+8 archivos y +142 tests**,
todos de esta feature. Cero rojos, ni siquiera los 2–4 flakes por saturación que suele tirar la
suite completa.

⚠️ Una advertencia del entorno que no es de esta feature pero se descubrió aquí: el chequeo de
`feature_list.json` de `init.sh` **sólo corre si `jq` está instalado**, y en esta máquina no lo
está. Es decir, el gate pasa en verde **sin haber validado el JSON ni la regla de máximo 2
features `in_progress` por zona**. En CI o en una máquina con `jq` ese chequeo sí corre. Vale
una ficha propia: un gate que se salta un chequeo en silencio es peor que no tenerlo.
