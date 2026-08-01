# Feature 171 — Desglose del dinero por tienda en la wallet · bitácora de implementación

> **Fase BACKEND (T1.1–T1.6) — COMPLETA.** El frontend (T2) y el censo de la 170 (T2.6) los
> hace `frontend_dev` después, sobre esta misma rama.
> Rama: `feature/171-desglose-por-tienda` (mergeada con `origin/dev` sin conflictos).

---

## T0 — Verificación previa

### T0.2 — Preguntas abiertas: se aplicaron los **defaults** del spec

El humano no respondió en la puerta F1.4. Se aplican los defaults que `requirements.md`
declara, y se deja constancia expresa de que se aplicaron:

| # | Pregunta | Default aplicado |
| --- | --- | --- |
| P1 | Textos de los cuatro importes | «A favor de la tienda / Cargos de Ordenex / Pagado a la tienda / Saldo a favor» |
| P2 | ¿La cabecera de `/mi-wallet` adopta los cuatro importes? | **NO** se toca en esta feature (R31) |
| P3 | Tiendas sin movimientos | No aparecen en la tabla; se acepta el comportamiento actual |
| P4 | ¿Columna con el nombre de la tienda en el archivo? | **NO**; el nombre va en el título |
| P6 | ¿Los ajustes manuales llevan cifra propia? | **NO**; se pliegan en «a favor» y «cargos» |

P5 (conflicto de calendario con la 170) es decisión del leader, no del spec.

### T0.3 — Línea base **medida** al empezar (no heredada)

Medida en este worktree sobre `feature/171` ya mergeada con `origin/dev`:

```
pnpm test        Test Files  707 passed | 4 skipped (711)
                      Tests  8463 passed | 74 skipped (8537)
pnpm run typecheck   verde (0 errores)
pnpm run lint        ✖ 18 problems (0 errors, 18 warnings)
```

Es −3 archivos / −34 tests respecto de los 714/8571 previos: el borrado de la vista legacy de
órdenes ya había entrado en `dev`. **Cero fallos de partida.**

**Los cuatro totales de las guardias de la 170 NO son los que dice el design.** El design §7.4
los da como 25/30/25/31 → 26/31/26/32, pero ese número es anterior al borrado de la vista
legacy. Los vigentes hoy, leídos del código:

| Constante | Valor REAL hoy | Con la tabla de la 171 (lo que tendrá que poner T2.6) |
| --- | --- | --- |
| `TOTAL_ARCHIVOS_CON_DATATABLE` | **24** | 25 |
| `TOTAL_INSTANCIAS_DATATABLE` | **29** | 30 |
| `con_descarga` (aserción de fase 1) | **24** | 25 |
| `totalCensado` | **30** | 31 |
| `fuera` | **6** | 6 (no cambia) |

`pnpm vitest run tests/unit/descarga` → 8 archivos / 57 tests, en verde. Son los que T2.6
tendrá que ver **fallar** antes de actualizarlos.

---

## Archivos creados / modificados (solo backend)

### Nuevos (código)

| Archivo | Qué |
| --- | --- |
| `lib/utils/desglose-tienda.ts` | `CUBETA_POR_CATEGORIA` (Record exhaustivo) + `derivarDesgloseTienda` (puro, `Prisma.Decimal`) |

### Nuevos (tests)

| Archivo | Tests |
| --- | --- |
| `tests/unit/utils/desglose-tienda.test.ts` | 20 |
| `tests/unit/types/wallet-tienda-desglose-schema.test.ts` | 12 |
| `tests/unit/services/wallet-tienda-desglose.test.ts` | 30 |
| `tests/unit/actions/wallet-tienda-desglose-action.test.ts` | 16 |

### Modificados (código)

| Archivo | Qué |
| --- | --- |
| `lib/types/wallet-tienda.ts` | `DesgloseTiendaDTO`, `ListarMovimientosDeTiendaResult`, `ListarMovimientosDeTiendaCompletoResult` y los dos schemas. Nada existente tocado |
| `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` | `DesgloseTiendaAgregadoRow` + `agregarDesglosePorTienda` |
| `lib/repositories/WalletTiendaMovimientoRepository.ts` | Implementación: un `groupBy(["tipo","categoria"])` |
| `lib/interfaces/services/IWalletTiendaService.ts` | Dos resultados + dos métodos |
| `lib/services/WalletTiendaService.ts` | `listarMovimientosDeTienda` + `listarMovimientosDeTiendaCompleto` |
| `lib/actions/wallet-tienda.ts` | `listarMovimientosDeTiendaAction` + `listarMovimientosDeTiendaCompletoAction` |

### Modificados (tests existentes) — **ninguna aserción tocada**

Siete dobles dejaron de implementar la interfaz completa al añadirle un método. Se les añadió
el miembro que faltaba y **nada más**: el diff de estos archivos no borra ni cambia ni una
aserción (comprobado con `git diff -U0`).

`tests/unit/services/wallet-tienda-service.test.ts`,
`tests/unit/actions/wallet-tienda-actions.test.ts`,
`tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` (aquí sí, +6 tests
nuevos del método nuevo), `tests/unit/repositories/cierres-admin-repository.test.ts`,
`tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts`,
`tests/unit/repositories/cierres-admin-indemnizacion.test.ts`,
`tests/integration/db/cierre-detail-congelado.test.ts`,
`tests/integration/db/wallet-idempotencia.test.ts`.

### Sin migración (R48)

`git diff --stat db/` está **vacío** y `git status --porcelain db/` no reporta nada: ni
`schema.prisma`, ni carpeta de migración, ni `down.sql`. La lectura se resuelve con los índices
`(tiendaId, fechaMovimiento)`, `(tiendaId, categoria)` y `(origenTipo, origenId)` que la 43 ya
dejó puestos.

---

## Contratos que quedan listos para `frontend_dev`

Todo lo que sigue está implementado y probado; el frontend no tiene que adivinar nada.

### Server Actions (`lib/actions/wallet-tienda.ts`)

```ts
listarMovimientosDeTiendaAction(input: unknown, deps?: WalletTiendaDeps)
  : Promise<ListarMovimientosDeTiendaActionResult>

listarMovimientosDeTiendaCompletoAction(input: unknown, deps?: WalletTiendaDeps)
  : Promise<ListarMovimientosDeTiendaCompletoResult>
```

### Entrada del paginado — `listarMovimientosDeTiendaSchema`

| Clave | Tipo | Obligatoria | Nota |
| --- | --- | --- | --- |
| `tiendaId` | `string` no vacío | **SÍ** | Sin ella: `validation_error`, sin tocar la base |
| `page` | `number ≥ 1` | no | default `1` |
| `pageSize` | `number` 1..100 | no | default `20` |
| `cierreId` | `string` no vacío | no | filtra `origenTipo=cierre_dia` + `origenId` |
| `categoria` | enum de `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED` | no | **incluye `pago_tienda`** (R44) |
| `desde` / `hasta` | fecha coercible | no | sobre `fechaMovimiento` |

### Entrada de la descarga — `listarMovimientosDeTiendaCompletoSchema`

Los **mismos** filtros y el mismo `tiendaId` obligatorio, **sin** `page`/`pageSize`, y
`.strict()`: mandar `page`, `pageSize` o cualquier clave extra devuelve `validation_error`.

### Salida del paginado

```ts
{ status: "ok"; data: ListarMovimientosDeTiendaResult }
| { status: "forbidden" }
| { status: "unauthenticated" }
| { status: "validation_error"; fieldErrors: Record<string, string[]> }
```

```ts
type ListarMovimientosDeTiendaResult = {
  tiendaId: string;
  movimientos: WalletTiendaMovimientoDTO[];  // ya ordenados: más reciente primero
  total: number;                             // del CONJUNTO FILTRADO, no de la página
  page: number;
  pageSize: number;
  desglose: DesgloseTiendaDTO;               // del CONJUNTO FILTRADO (R12)
};

type DesgloseTiendaDTO = {
  aFavor: string;   // "10000.00"  ← importe 1 de la cabecera
  cargos: string;   // "1000.00"   ← importe 2
  pagado: string;   // "0.00"      ← importe 3 (hoy siempre 0.00; ver §«la 172»)
  saldo: string;    // "9000.00" | "-452.00"  ← importe 4 = aFavor − cargos − pagado
  signo: "positivo" | "negativo" | "cero";
};
```

**Money-safe:** los cuatro importes y `movimientos[].monto` son **STRING** con dos decimales,
ya con signo. Se pintan **tal cual**: nada de `Number()`, `parseFloat` ni `toFixed` en el
navegador (R14/R23). El `signo` ya viene calculado del servidor; la etiqueta de estado se lee
del mapa que ya usa la tabla de saldos (R13).

**NO devuelve `tiendaNombre`** (R35): el nombre baja por props desde
`SaldoTiendaResumenDTO.tiendaNombre` de la fila que se despliega.

### Salida de la descarga

`ListarCompletoResult<WalletTiendaMovimientoDTO>` — el mismo union que la 170 ya usa en los
otros cuatro ledgers, así que `filasDesdeResultado` de
`components/shared/descarga-resultado.ts` lo adapta sin nada nuevo.

### Repositorio y derivación (por si el frontend necesita el tipo)

```ts
// lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts
agregarDesglosePorTienda(tiendaId: string, filtros: SaldoTiendaFiltros)
  : Promise<DesgloseTiendaAgregadoRow[]>   // { tipo, categoria, total: string }[]

// lib/utils/desglose-tienda.ts
export const CUBETA_POR_CATEGORIA: Record<WalletTiendaMovimientoCategoria, CubetaDesglose>;
export function derivarDesgloseTienda(rows: DesgloseTiendaAgregadoRow[]): DesgloseTiendaDTO;
```

---

## Cómo se verificó el acotamiento por rol

Es lo que más se jugaba la feature, así que se probó de cuatro formas independientes.

1. **Contraprueba de acceso (para que el test no pase por vacío).** `maestro` y `admin` reciben
   **filas concretas** (`["A-cod","A-flete"]`), `total: 2` y una cabecera **no nula**
   (`aFavor "10000.00"`, `cargos "1000.00"`, `saldo "9000.00"`). Un guard que devolviera
   `forbidden` a todo el mundo haría caer este test.
2. **Denegación con cero consultas.** `adminTienda`, `adminSatelite`, `mensajero`, `apiKey` y un
   rol inventado reciben `{ status: "forbidden" }`, la respuesta **no tiene `data`**, y
   `listarPorTienda` y `agregarDesglosePorTienda` registran **cero** llamadas.
3. **El guard va ANTES de la base, demostrado en negativo.** Hay un doble
   (`repoQueExplota`) cuyos métodos **lanzan** con el mensaje «el guard de rol NO se evaluó
   antes de la base». Se comprobó moviendo el guard **detrás** del `Promise.all`: la suite pasó
   de 30 verdes a **3 rojos**, uno de ellos con ese error exacto. Con el guard en su sitio, los
   30 vuelven a verde. Es el patrón que dejó la 170: si el guard estuviera después, el dato ya
   habría salido de la base aunque la respuesta fuera un error.
4. **Contraprueba de R28.** `adminTienda` con `usuarioId === "tienda-A"` pidiendo
   `tiendaId: "tienda-A"` —su **propia** tienda— recibe `forbidden`, no datos. Es el caso que
   un guard escrito como `input.tiendaId === actor.usuarioId` dejaría pasar. Y a continuación
   se comprueba que **no se le quita nada**: su `listarMisMovimientos` le sigue devolviendo sus
   dos movimientos.

Además, el acotamiento **por tienda** (que el maestro no vea la tienda equivocada) se prueba en
las dos direcciones y **con las dos no vacías**: A ve `["A-cod","A-flete"]`, B ve
`["B-cod","B-flete"]`, y los conjuntos no se tocan. Con claves extra coladas
(`todasLasTiendas: true`, `tienda_id: "tienda-B"`) el repositorio sigue recibiendo
`tiendaId: "tienda-A"` y ninguna de las claves extra.

**Las tres barreras contra la fuga**, cada una probada por separado:
`.strict()` en el borde (test de la action) · `construirFiltros` leyendo claves explícitas
(test del servicio) · `tiendaId` escrito **al final** del objeto que va al repositorio.

---

## «Pagado a la tienda»: preparado para la 172, y probado

Hoy vale siempre `"0.00"` porque **ningún código emite `pago_tienda`**. Está implementado
leyendo la **categoría real del ledger**, no devolviendo un cero fijo:

- El repositorio hace `groupBy(["tipo","categoria"])` con un `where` que **no excluye ninguna
  categoría** (solo `tiendaId` + filtros). Si un `pago_tienda` existiera, saldría.
- `CUBETA_POR_CATEGORIA` manda `pago_tienda → "pagado"`, y es la **única** categoría de esa
  cubeta.
- `derivarDesgloseTienda` suma esa cubeta aparte y resta: `saldo = aFavor − cargos − pagado`.

**Cuatro pruebas con un movimiento de pago sembrado a mano**, en tres niveles:

| Nivel | Test | Qué demuestra |
| --- | --- | --- |
| Derivación pura | `desglose-tienda.test.ts` → «(c) CON un movimiento `pago_tienda` sembrado a mano…» | El mismo conjunto **con** y **sin** el pago: `pagado` pasa de `"0.00"` a `"4000.00"`, `cargos` **no cambia** (`"1000.00"` en ambos) y el saldo baja de `9000.00` a `5000.00` |
| Repositorio | `wallet-tienda-movimiento-repository.test.ts` → «R43: una fila `pago_tienda` del ledger llega TAL CUAL» | La fila se propaga sin filtrarse ni reclasificarse, y el `where` no excluye categorías |
| Cadena completa de servidor | `wallet-tienda-desglose.test.ts` → «la cifra sale de la categoría REAL del ledger, atravesando el repositorio de verdad (no un cero fijo)» | `WalletTiendaService` → `WalletTiendaMovimientoRepository` → Prisma, falseando **solo** el cliente Prisma. La cabecera sale `{aFavor:"10000.00", cargos:"1000.00", pagado:"4000.00", saldo:"5000.00"}`. Si el servicio devolviera un `"0.00"` fijo, este test caería |
| Servicio (in-memory) | `wallet-tienda-desglose.test.ts` → «con un movimiento `pago_tienda` sembrado A MANO, la cabecera lo refleja sin tocar una línea» | El pago aparece además en la lista de movimientos con su categoría real |

**Conclusión: el día que la 172 inserte el primer `pago_tienda`, esta pantalla lo refleja sin
tocar una línea de este código.**

---

## Coste constante por tienda (R34/R35) — verificado

- **2 llamadas al repositorio por apertura**, ni una más: `listarPorTienda` (página + total) y
  `agregarDesglosePorTienda` (cabecera), en `Promise.all`. Probado con `pageSize` **20** y
  **100**, y con **1** tienda y **50** tiendas en el ledger: siempre 2.
- **Ninguna consulta del nombre de la tienda** (R35): ni `listarSaldosTodasTiendas` ni
  `agregarSaldoPorTienda` ni `usuario.findMany` se llaman, y la respuesta no lleva
  `tiendaNombre`.
- **Paginar o filtrar vuelve a consultar SOLO esa tienda** (R36): tres lecturas seguidas dan 3
  + 3 llamadas, todas con `tiendaId: "tienda-A"`.
- **El modo descarga NO agrega la cabecera**: una consulta menos por descarga.
- En sentencias SQL: `findMany` + `count` + `groupBy` = **3 por apertura**, constantes. El
  requisito se expresa en llamadas al repositorio porque es lo determinista con un doble.

**El diseño aguanta abrir varias filas sin multiplicar consultas**, y no hay nada que
devolverle al spec por este lado: el coste por fila abierta es fijo y el coste de las filas
**cerradas** es cero, porque el `useSWR` vivirá dentro del componente desplegado (eso lo cablea
T2.3, y su prueba —R32/R33— es del test de pantalla).

---

## Trazabilidad `R<n> → test` (alcance backend)

### Cubiertos por esta fase

| R | Test |
| --- | --- |
| R8 | `tests/unit/utils/desglose-tienda.test.ts` → «R8: la cubeta CONCUERDA con el tipo…», «R8: las 6 categorías de débito del feed del cierre son CARGOS…», «R8: acumula VARIAS filas en la misma cubeta» |
| R9 | idem → «R9: TODA categoría del catálogo tiene cubeta declarada, y el mapa no tiene ninguna de más» (+ el `Record` exhaustivo rompe el typecheck) |
| R10 | idem → «R10: saldo = aFavor − cargos − pagado» en positivo / negativo / cero |
| R11 | `tests/unit/services/wallet-tienda-desglose.test.ts` → «R11: SIN filtros, el saldo del desglose es idéntico al que deriva la tabla de saldos»; `desglose-tienda.test.ts` → «R11: mismo saldo y mismo signo que la tabla de saldos» (4 conjuntos) |
| R12 | `wallet-tienda-desglose.test.ts` → «R12: CON filtros, los cuatro importes reflejan el conjunto filtrado…» y «R12: la cabecera se agrega con los MISMOS filtros que el listado» |
| R16 | `wallet-tienda-desglose.test.ts` → «R16: los movimientos llegan del más reciente al más antiguo» |
| R17 | idem → «R17: pagina en el servidor y devuelve el total del conjunto filtrado, no el de la página» |
| R18 | `tests/unit/types/wallet-tienda-desglose-schema.test.ts` → «R18/R22: hereda los tres filtros del listado»; `wallet-tienda-desglose.test.ts` → «R12: la cabecera se agrega con los MISMOS filtros» |
| R22 | `wallet-tienda-desglose.test.ts` → «R22: una sola respuesta con movimientos, total, página, tamaño y los cuatro importes»; `wallet-tienda-desglose-action.test.ts` → «R22: con sesión y entrada válida…» |
| R23 | `desglose-tienda.test.ts` → «R23: los cuatro importes son STRING con DOS decimales» + los dos de money-safe; `wallet-tienda-desglose.test.ts` → «R23: los cuatro importes y los montos viajan como STRING»; `…-action.test.ts` → «R23: los importes llegan al cliente como STRING» |
| R24 | `wallet-tienda-desglose.test.ts` → «R24: el repositorio recibe EXACTAMENTE el tiendaId de la entrada…», «R24: cada tienda ve LO SUYO, en las dos direcciones y ninguna vacía», «R24: el archivo de la tienda A no trae ni una fila de la B»; `wallet-tienda-movimiento-repository.test.ts` → «R24: agrupa por (tipo, categoría) con `tiendaId` SIEMPRE en el WHERE» y «R24: los filtros… en el MISMO WHERE»; `…-schema.test.ts` → «R24: `.strict()` rechaza cualquier clave extra»; `…-action.test.ts` → «R24: una clave extra que pretenda ampliar el alcance → validation_error en el BORDE» |
| R25 | `…-action.test.ts` → «R25: `tiendaId` ausente…», «R25: `tiendaId` vacío…», «R25: entrada que ni siquiera es un objeto…» (las tres con CERO llamadas al servicio); `…-schema.test.ts` → «R25: sin `tiendaId` → error…» |
| R26 | `wallet-tienda-desglose.test.ts` → «CONTRAPRUEBA R26: maestro y admin reciben FILAS e IMPORTES» |
| R27 | idem → «R27: todo rol sin acceso total recibe forbidden… CERO llamadas al repositorio» y «R27: con un repositorio que EXPLOTA al ser llamado, el forbidden sale igual» |
| R28 | idem → «CONTRAPRUEBA R28: adminTienda pidiendo SU PROPIA tienda recibe forbidden, no datos» (+ «R28: y su superficie propia le sigue funcionando») |
| R29 | `…-action.test.ts` → «R29: sin sesión → unauthenticated… CERO llamadas al servicio» (×2 acciones) y «R29: la falta de sesión se resuelve ANTES de validar» |
| R31 | `wallet-tienda-service.test.ts`, `wallet-tienda-descarga.test.ts`, `wallet-tienda-actions.test.ts`, `wallet-tienda-descarga-action.test.ts` — **55 tests en verde sin editar ni una aserción** |
| R34 | `wallet-tienda-desglose.test.ts` → «R34: EXACTAMENTE 2 llamadas al repositorio… con pageSize 20 y 100», «R34: el coste NO crece con el número de tiendas (1 vs 50)», «R34: el modo completo NO agrega la cabecera»; `…-repository.test.ts` → «R34: UNA sola sentencia» |
| R35 | `wallet-tienda-desglose.test.ts` → «R35: NO se consulta el nombre de la tienda, y la respuesta no lo lleva»; `…-repository.test.ts` → «R34: UNA sola sentencia…» (afirma `usuario.findMany` no llamado) |
| R36 | `wallet-tienda-desglose.test.ts` → «R36: cambiar de página o filtrar vuelve a consultar SOLO esa tienda» |
| R37 | `wallet-tienda-desglose.test.ts` → «R37: devuelve TODAS las filas del conjunto filtrado, sin recorte por página»; `…-action.test.ts` → «R37: `page` colada en el modo completo → validation_error» y «R37: … el input que va al servicio NO lleva paginación» |
| R39 | `wallet-tienda-desglose.test.ts` → «R39/R40: limite_excedido lleva total y límite, y NINGUNA fila» y «R39: nunca pide al repositorio más de N+1 filas» |
| R40 | idem + «R40: o entrega TODAS las filas o el error de tope»; `…-action.test.ts` → «R40: NINGUNA rama de error viaja acompañada de filas» (recorre las 4 formas de fallo) |
| R43 | `desglose-tienda.test.ts` (3 tests del bloque «el hueco que cierra la 172») + `…-repository.test.ts` → «R43: una fila `pago_tienda` del ledger llega TAL CUAL» + `wallet-tienda-desglose.test.ts` (3 tests, uno con la cadena de servidor completa) |
| R44 | `…-schema.test.ts` → «R44: `pago_tienda` es un valor ACEPTADO del filtro por concepto» |
| R47 | El backend **no añade ninguna escritura**: las dos Server Actions nuevas son de lectura y no existe ningún método de pago. `git diff` del backend no toca `crearMovimientos` ni el feed |
| R48 | `git diff --stat db/` **vacío** y `git status --porcelain db/` sin salida: sin migración, sin `schema.prisma`, sin `down.sql` |
| R49 | Solo lectura sobre `wallet_tienda_movimiento`: el método nuevo del repositorio es un `groupBy`. `wallet-tienda-feed-service.test.ts` y `wallet-tienda-idempotencia` en verde sin tocar |

### Pendientes de `frontend_dev` (T2)

R1, R2, R3, R4, R5, R6, R7, R13, R14, R15, R19, R20, R21, R30, R32, R33, R38, R41, R42, R45,
R46. (R6/R30 los cubre T2.8 con `tests/integration/wallet-tiendas-page.test.tsx`, que **no
existe hoy**.)

---

## Puertas — salida real

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 18 problems (0 errors, 18 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
(los mismos 18 warnings preexistentes de la línea base; 0 errores)

$ pnpm test
 Test Files  711 passed | 4 skipped (715)
      Tests  8547 passed | 74 skipped (8621)

$ ./init.sh
✓ lint paso
✓ test paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

**Balance frente a la línea base:** 711 → 715 archivos (**+4**), 8537 → 8621 tests (**+84**),
**0 fallos**, 0 errores de lint, typecheck verde. Ningún rojo nuevo.

Nota de entorno: este worktree no traía `node_modules` ni `.env`. Se hizo `pnpm install
--frozen-lockfile` y `prisma generate` con un `DATABASE_URL` de marcador antes del typecheck,
como pide el procedimiento. El aviso `! no hay .env` de `init.sh` es esperado y no es un fallo.

---

## T3.4 — Nota para la **172** (lo que se encuentra hecho)

1. **La pantalla desde la que el humano decidió pagar tendrá la tienda identificada**:
   `tiendaId` en el contrato y `tiendaNombre` por props, con su saldo vigente ya derivado.
2. **La cifra «Pagado a la tienda» ya existe y ya suma `pago_tienda`.** Hoy `"0.00"`; el día
   que la 172 inserte el primer movimiento, la cabecera lo refleja **sin tocar una línea**.
   Demostrado con los tests de R43 listados arriba, incluido uno que atraviesa la cadena
   completa de servidor.
3. **El filtro por concepto ya incluye `pago_tienda`**, porque el schema se puebla del SEED del
   enum y no de una lista escrita a mano (`…-schema.test.ts`, «R44»).
4. **La lectura no hay que tocarla.** Para refrescar tras registrar un pago basta con volver a
   llamar a `listarMovimientosDeTiendaAction` con el mismo `tiendaId`.

Nombres exactos que la 172 va a necesitar (los dos del frontend los fija T2.3, aún **no**
implementados):

| Cosa | Nombre exacto | Dónde | Estado |
| --- | --- | --- | --- |
| Lectura paginada | `listarMovimientosDeTiendaAction` | `lib/actions/wallet-tienda.ts` | **hecho** |
| Lectura completa (descarga) | `listarMovimientosDeTiendaCompletoAction` | idem | **hecho** |
| Método de servicio | `WalletTiendaService.listarMovimientosDeTienda` | `lib/services/WalletTiendaService.ts` | **hecho** |
| Agregado del ledger | `IWalletTiendaMovimientoRepository.agregarDesglosePorTienda` | interfaz + repo | **hecho** |
| Cubeta de categorías | `CUBETA_POR_CATEGORIA` / `derivarDesgloseTienda` | `lib/utils/desglose-tienda.ts` | **hecho** |
| Punto de extensión de acciones | prop `acciones?: ReactNode` | `DesgloseMovimientosTienda.tsx` | **pendiente T2.3** |
| Clave de revalidación dirigida | `claveDesgloseTienda(tiendaId, page, filtros)` | idem | **pendiente T2.3** |

La 172 **no** encontrará ninguna escritura hecha (R47): esta feature no emite `pago_tienda`, no
tiene formulario de pago ni campos de método/referencia/fecha.

---

## Límites declarados (no se inventó nada)

1. **`categoria` ↔ `tipo` no está atado por un CHECK en la base.** `derivarDesgloseTienda`
   clasifica por `categoria`; una fila con `categoria = cod_recaudado` y `tipo = debito`
   diferiría de `derivarSaldoTienda`. **No se inventa la restricción**: sería una migración
   fuera del pedido, sobre una tabla append-only con datos en producción, y R48 prohíbe
   migración. Está escrito en el código y el test de R11 compara ambas derivaciones sobre el
   mismo conjunto para que la divergencia, si apareciera, salga por ahí.
2. **Los cuatro totales del censo que da el design (25/30/25/31) están obsoletos.** Los reales
   son 24/29/24/30 (ver T0.3). T2.6 debe usar los reales, no los del design.
3. **No hay base de datos alcanzable en este worktree** (`init.sh`: «no hay .env»). Como la
   feature no lleva migración, no hacía falta ningún test contra Postgres real; los tests de
   `tests/integration/db/**` que dependen de una base siguen saltándose como en la línea base.
4. **R32/R33 no se pueden probar en backend**: son sobre cuántas veces el cliente llama a la
   action, y eso lo prueba el test de pantalla (T2.7).
