# Feature 205 — Tareas

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas marcadas del
mismo bloque. Cada tarea declara **archivos exactos**, **requisitos** que cubre, **criterio de
hecho** y **dependencias**.

**Gate por tanda:** `./init.sh --rapido`. **Gate final y antes del PR:** `./init.sh` completo,
sin excepción (`docs/verification.md`). Ocho tandas; ninguna deja el árbol a medias.

> **Estado — marcado el 2026-08-12, comprobado contra el árbol y las bitácoras.** `### [x]` = hecha
> y verificada archivo por archivo (no por lo que diga una bitácora). **29 de 31 marcadas.** Las
> dos que quedan sin marcar son de la tanda 7 y **no son mías**: **T7.2** (el gate completo lo
> corre el leader, y además hay que volver a correrlo después de este plegado del spec) y **T7.3**
> (bookkeeping: `spec_path` de la ficha 205 sí queda puesto, pero `progress/current.md` y la
> entrada de `progress/history.md` las escribe el leader). Es el mismo corte que dejó
> `specs/196-snapshot-ranking-diario/tasks.md`, donde T6.2 y T6.3 tampoco llevan marca.

> **Enmienda del 2026-08-11** (respuestas Q1–Q5). Tareas nuevas: **T0.4** (config del tope) y
> **T0.5** (verificación de la referencia repetida, que **bloquea** la tanda 3). Tareas
> ampliadas: T0.1, T0.2, T0.3, T2.2, T3.1, T3.2, T3.3, T3.4, T4.1, T5.2, T5.5 y T7.1.

---

## Tanda 0 — El cálculo, puro y sin base de datos

### [x] T0.1 — Módulo puro del reparto
- **Crea**: `lib/utils/reparto-liquidacion-mensajero.ts`
- **Exporta**: `CierreImputable`, `Imputacion`, `RecorteVentana`, `Reparto`,
  `ordenarCierresFifo`, `repartirEntreCierres` (design §2.1).
- **Cubre**: R8, R10, R11, R12, R13, R16, R17, R54, R57.
- **Hecho**: sin imports de `next/*`, de repositorios ni de `new Date()`; solo
  `Prisma.Decimal`; cero `Number(`/`parseFloat(`/`parseInt(`; todo `toFixed(2)`; el comparador
  ordena por `solicitadoAt` asc con desempate por `cierreId` asc y **no mira ninguna otra
  fecha** (design §2.4); `repartirEntreCierres(importe, cierres, tope)` recibe **todos** los
  imputables y forma la ventana dentro (design §2.5.1), devolviendo `imputable` (ventana),
  `imputableTotal` y `recorte`; el módulo **no lee `process.env`** (el `tope` entra por
  parámetro); el nombre del archivo contiene `liquidacion` (lo exige la auto-captura del censo,
  design §11).
- **Depende de**: —

### [x] T0.2 — Tests del módulo puro `[P con T0.3, T0.4, T0.5]`
- **Crea**: `tests/unit/utils/reparto-liquidacion-mensajero.test.ts`
- **Cubre**: R8, R10, R11, R12, R13, R17, R53 (parcial), R54.
- **Hecho**: importe menor que el primer pendiente ⇒ una sola imputación parcial; importe que
  cruza tres cierres ⇒ dos completas + una parcial y **solo la última** es parcial; `Σ montos`
  igual al importe al céntimo (caso con `0.01` y con decimales que rompen un `float`); cierres
  con pendiente `0.00` no aparecen; dos cierres con el mismo `solicitadoAt` salen siempre en el
  mismo orden; importe mayor que el imputable ⇒ `sobrante > 0` y `totalImputado = imputable`.
  **Antigüedad (Q1)**: un caso donde `resueltoAt` daría el orden inverso y el reparto **no**
  cambia. **Tope (Q2)**: con `tope: 2` y 5 cierres imputables ⇒ solo los 2 más antiguos reciben,
  `recorte = { enVentana: 2, fuera: 3, montoFuera: Σ de los otros 3 }`, `imputable` es el de la
  ventana, `imputableTotal` el de los cinco y **no** hay rechazo; importe mayor que la ventana
  pero menor que el total ⇒ `sobrante > 0` (es el `excede` de R14); `tope` mayor que el número de
  cierres ⇒ `recorte.aplicado` falso y todo igual que antes de la enmienda.
  El archivo **no** importa Prisma para construir datos de entrada (entra STRING, sale STRING).
- **Depende de**: T0.1

### [x] T0.3 — Censo money-safe ampliado `[P con T0.2, T0.4, T0.5]`
- **Edita**: `tests/unit/guards/liquidacion-money-safe.test.ts` (`ARCHIVOS_DE_LA_FEATURE`)
- **Cubre**: R16, R50.
- **Hecho**: se añade `lib/utils/reparto-liquidacion-mensajero.ts`; **antes** de añadirlo se
  ve el test FALLAR por auto-captura (la cláusula de `:139-146`), y se deja constancia en el
  progreso: es la prueba de que el mecanismo vigila y no de que la lista se completó a mano.
  El módulo de config de T0.4 **no** se añade al censo y **no** debe hacer caer la auto-captura:
  su ruta no casa `/[Ll]iquidacion/` a propósito (design §2.5.2 y §11). Si el implementer lo
  nombra con `liquidacion`, este test se pondrá rojo por su `Number.parseInt` — eso no se
  resuelve tocando la guardia, se resuelve con el nombre.
- **Depende de**: T0.1

### [x] T0.4 — Config del tope de imputaciones `[P con T0.2, T0.3, T0.5]`
- **Crea**: `lib/config/reparto-mensajero.ts`, `tests/unit/config/reparto-mensajero-config.test.ts`
- **Cubre**: R53.
- **Hecho**: patrón literal de `lib/config/gasto-fijo.ts` (`readPositiveInt` + `export const`);
  expone `MAX_CIERRES_POR_REPARTO`, por defecto **50**, sobrescribible por
  `REPARTO_MENSAJERO_MAX_CIERRES`; el test comprueba el defecto, la sobreescritura y que un valor
  no positivo o basura cae al defecto (recargando el módulo, no leyendo la constante ya cargada);
  el archivo **no** importa `Prisma`, no nombra ningún monto y su ruta **no** contiene
  `liquidacion` (design §2.5.2); el número no se repite en ningún otro archivo: quien lo necesita
  lo recibe inyectado. **No** se añade a `tests/unit/config/paginacion-dominios.test.ts`: ese
  guard enumera dominios de PAGINACIÓN (importados uno a uno, no barridos del directorio) y este
  no lo es; meterlo ahí obligaría a inventarle un `DEFAULT_PAGE_SIZE` que no existe.
- **Depende de**: —

### [x] T0.5 — VERIFICACIÓN: nadie asume una referencia por pago `[P con T0.2, T0.3, T0.4]`
- **Crea**: nota en `progress/impl_205-pago-mensajero-desde-wallet.md` (sección «T0.5»)
  — **hecha, en `progress/impl_205_tanda0.md > T0.5`** (la bitácora se partió por tandas y el
  nombre único no se llegó a usar; el mapa consolidado vive en `progress/impl_205_mapa.md`).
  Resultado: compuerta **ABIERTA**, nada del árbol asume una referencia única por pago.
- **Toca código**: **NO**. Es una auditoría de lectura; si hay que cambiar algo, no se cambia
  aquí (ver abajo).
- **Cubre**: R58 (pre-requisito de su implementación) — design §5.4.3.
- **Por qué existe**: copiar la referencia crea, por primera vez, **N filas de
  `liquidacion_pago` con la misma `referencia`**. Antes de escribir el reparto hay que saber si
  algo del árbol da eso por imposible.
- **Hecho**: se barre el repo entero —`lib/**`, `app/**`, `components/**`, `db/**`,
  `scripts/**`, `tests/**`— buscando (a) cualquier `UNIQUE`/`@unique` sobre `referencia`,
  (b) `findFirst`/`findUnique`/`where` por `referencia`, (c) consultas o descargas de
  conciliación que emparejen 1 referencia ↔ 1 pago (agrupaciones, `distinct`, joins que asuman
  una fila). El barrido se escribe a un **archivo de script**, no a `node -e` (la memoria del
  repo: `node -e` se come una capa de escapado y el censo miente en verde), y se autocomprueba
  con un caso plantado que SÍ debe cazar. En el progreso quedan los comandos exactos y su salida.
  Punto de partida ya medido al escribir el spec, que **no** cuenta como el barrido:
  `db/schema.prisma:1316` declara `referencia String?` sin `@unique`, y
  `LiquidacionPagoRepository` no tiene ningún `where` por referencia.
- **Si aparece algo que asuma unicidad**: se **para y se reporta** al leader con el hallazgo
  citado (archivo:línea). NO se cambia por cuenta propia: tocar una constraint o una consulta de
  conciliación es decisión de otra persona.
- **Bloquea**: T3.2 (la escritura del reparto).
- **Depende de**: —

---

## Tanda 1 — Persistencia del acto

### [x] T1.1 — Modelos Prisma
- **Edita**: `db/schema.prisma` (modelo `LiquidacionReparto`; `repartoId` nullable + relación
  en `LiquidacionPago`).
- **Cubre**: R29, R49.
- **Hecho**: `pnpm db:generate` limpio; `@map` en `snake_case`; `clave_idempotencia` `@unique`;
  FKs `onDelete: Restrict`; **sin** `updatedAt`/`deletedAt`; índice
  `(mensajeroId, createdAt)`; `LiquidacionPago` no pierde ni renombra nada.
- **Depende de**: —

### [x] T1.2 — Migración UP
- **Crea**: `db/migrations/<ts>_liquidacion_reparto/migration.sql`
- **Cubre**: R29, R49.
- **Hecho**: generada con `pnpm run db:migrate:create` (no a mano ni editada después de
  aplicarse) — **desviación declarada**: se generó con `prisma migrate diff
  --from-config-datasource --to-schema --script` porque `db:migrate:create` aplica las
  migraciones pendientes antes de escribir el archivo; el `CHECK` y el `ENABLE ROW LEVEL
  SECURITY` se añadieron a mano sobre esa salida **antes** de aplicarla, igual que en la 172
  (`progress/impl_205_tandas1y2.md > T1.2`); crea la tabla con su `CHECK (monto_total > 0)`,
  sus dos FK, el `UNIQUE` y el
  índice; añade `liquidacion_pago.reparto_id` **nullable** con su FK e índice;
  `ALTER TABLE liquidacion_reparto ENABLE ROW LEVEL SECURITY`; **ninguna** sentencia altera,
  renombra o borra objetos preexistentes; **no** se crea ningún enum (los `down.sql` previos no
  se tocan).
- **Depende de**: T1.1

### [x] T1.3 — Migración DOWN
- **Crea**: `db/migrations/<ts>_liquidacion_reparto/down.sql`
- **Cubre**: R49.
- **Hecho**: `ALTER TABLE liquidacion_pago DROP COLUMN IF EXISTS reparto_id` y luego
  `DROP TABLE IF EXISTS liquidacion_reparto` (orden inverso al UP);
  `pnpm run db:migrate` seguido de `pnpm run db:rollback` deja el esquema idéntico al previo
  (comparado, no supuesto).
- **Depende de**: T1.2

### [x] T1.4 — Test de esquema y migración
- **Crea**: `tests/integration/db/liquidacion-reparto-migration.test.ts`
- **Cubre**: R29, R49.
- **Hecho**: columnas y tipos; el `UNIQUE` de `clave_idempotencia` **rechaza** el duplicado; el
  `CHECK` rechaza `monto_total = 0`; borrar el usuario con repartos falla; `reparto_id` admite
  `NULL`; `pg_class.relrowsecurity` es `true`. El test **crea sus propios datos**: nada de
  `if (!fila) return;` que reporte verde sin comprobar nada.
- **Depende de**: T1.3

---

## Tanda 2 — Repositorios

### [x] T2.1 — Repositorio del reparto
- **Crea**: `lib/interfaces/repositories/ILiquidacionRepartoRepository.ts`,
  `lib/repositories/LiquidacionRepartoRepository.ts`
- **Cubre**: R28, R29.
- **Hecho**: `crear(tx, input)` traduce el choque del `UNIQUE` en
  `{ status: "clave_repetida" }` **sin lanzar** (misma forma que `CrearLiquidacionPagoResult`);
  `obtenerPorClave(clave)` con el cliente propio (la relectura ocurre fuera de la transacción);
  cliente Prisma acotado con `Pick<PrismaClient, …>`; cero lógica de negocio; montos STRING de
  entrada y salida.
- **Depende de**: T1.1

### [x] T2.2 — Ampliación del repositorio del pago
- **Edita**: `lib/interfaces/repositories/ILiquidacionPagoRepository.ts`,
  `lib/repositories/LiquidacionPagoRepository.ts`
- **Cubre**: R5, R6, R8, R18, R28.
- **Hecho**: `listarCierresImputables(mensajeroId, tx?)` devuelve `id`, `mensajeroId`,
  `estado`, `totalPagoMensajero`, `totalEfectivo` y `solicitadoAt` de los cierres `aprobado`
  del mensajero, ordenados `solicitado_at ASC, id ASC` (el orden de verdad lo fija T0.1; aquí
  es eficiencia) y **sin `take`/`LIMIT`**: el tope acota la escritura, no la lectura, y la
  previsualización necesita todos para R37 y R56 (design §2.5.6); `listarPorReparto(repartoId)`;
  `CrearLiquidacionPagoInput` gana `repartoId: string | null` y el camino existente pasa `null`.
  **Ningún** método nuevo escribe en `cierre_dia`.
- **Depende de**: T1.1

### [x] T2.3 — Tests de repositorios `[P con T2.4]`
- **Crea**: `tests/unit/repositories/liquidacion-reparto-repository.test.ts`
- **Edita**: el test existente del repositorio del pago (el que cubra `crear`).
- **Cubre**: R5, R8, R28, R29.
- **Hecho**: P2002 de la clave ⇒ `clave_repetida` sin propagar; el `where` de
  `listarCierresImputables` filtra por `mensajeroId` **y** `estado: "aprobado"` y el `orderBy`
  es `[solicitadoAt asc, id asc]`; `crear` emite `reparto_id` cuando se le pasa y `null`
  cuando no. Se comprueba el **WHERE**, no solo el resultado del doble.
- **Depende de**: T2.1, T2.2

### [x] T2.4 — Cierre resuelto en el desglose `[P con T2.3]`
- **Edita**: `lib/types/wallet-mensajero.ts` (`PagoMensajeroMovimientoDTO.cierreId`),
  `lib/repositories/PagoMensajeroMovimientoRepository.ts`
- **Cubre**: R43.
- **Hecho**: `cierreId` se **deriva** (design §7.3) con UNA consulta por página para los
  orígenes `pago_mensajero`; `origenTipo === "cierre_dia"` usa el `origenId`; el resto es
  `null`; **cero** cambios de esquema y cero backfill; las columnas de descarga del desglose
  **no** ganan el campo y su aserción de orden sigue idéntica.
- **Depende de**: —

---

## Tanda 3 — El servicio

### [x] T3.1 — Escritor único y previsualización
- **Edita**: `lib/services/LiquidacionService.ts`,
  `lib/interfaces/services/ILiquidacionService.ts`
- **Cubre**: R1, R5, R6, R7, R15, R32, R35, R36, R37, R38, R51, R56, R57.
- **Hecho**: el cuerpo que escribe documento + movimiento sale a un privado
  `escribirPagoDeCierre(tx, …)` y `registrarPagoMensajero` lo usa **sin cambiar su
  comportamiento** (`tests/unit/services/liquidacion-service.test.ts` verde **sin tocar un solo
  assert**); `previsualizarRepartoMensajero(input, actor)` deriva el conjunto imputable, el
  `imputable` **de la ventana**, el `imputableTotal`, el `recorte`, la `cuentaPorPagar`, la
  `deudaNoImputable` (comparación hecha **en el servidor**, el cliente no compara importes), los
  `excluidos` y —si viene monto— las imputaciones, usando T0.1; el `tope` llega **una sola vez**
  por construcción del servicio desde T0.4 y lo comparten previsualizar y aplicar (R57); **no
  abre transacción, no toma bloqueos y no invoca ningún método de escritura**.
- **Añadido aquí, que el spec no había previsto**: ninguna lectura de la tanda 2 podía dar los
  `excluidos` de R36 (`listarCierresImputables` lleva `estado: "aprobado"` en el WHERE), así que
  esta tarea añadió la lectura complementaria al repositorio del pago. Tras la **enmienda de
  `design.md §6.4`** esa lectura es `contarCierresNoAprobadosPorEstado(mensajeroId)`: un
  `groupBy` por estado, acotado por construcción y sin ninguna columna de dinero.
- **Depende de**: T0.1, T0.4, T2.2

### [x] T3.2 — Aplicación del reparto
- **Edita**: `lib/services/LiquidacionService.ts`,
  `lib/interfaces/services/ILiquidacionService.ts`
- **Cubre**: R1, R4, R14, R18, R19, R20, R21, R22, R23, R24, R25, R26, R28, R29, R55, R57, R58.
- **Hecho**: `registrarRepartoMensajero` con el orden de design §2.1 — rol → transacción →
  fila del reparto (choque ⇒ señal interna, relectura **fuera**) → **ventana** con el tope →
  bloqueo por cierre **de la ventana** en el orden del reparto → relectura de pendientes bajo
  bloqueo → recálculo → escritura por imputación con el privado de T3.1; los cierres recortados
  **no** se bloquean ni se tocan (R55); la ventana **no se rellena** si un cierre suyo se cae
  bajo bloqueo, se encoge (design §2.5.5); `excede` informa el disponible **de la ventana**;
  `metodo`, `referencia` y `fechaPago` se copian **idénticos** en las N imputaciones (R58);
  devuelve el reparto **aplicado**; una excepción en cualquier punto revierte todo.
- **Depende de**: T2.1, T3.1, **T0.5** (la verificación de la referencia va antes de escribir)

### [x] T3.3 — Tests del servicio
- **Crea**: `tests/unit/services/liquidacion-reparto-service.test.ts`
- **Cubre**: R1, R5, R6, R7, R14, R15, R18, R19, R20, R23, R24, R25, R26, R28, R30, R35, R51,
  R54, R56, R57, R58.
- **Hecho (enmienda)**: con `tope: 2` inyectado y 5 cierres imputables ⇒ se imputa a los 2 más
  antiguos, se responde `ok` (no rechazo, R54) y el `recorte` sale con `enVentana: 2`, `fuera: 3`
  y `montoFuera` igual a la suma de los tres; importe por encima de la ventana pero por debajo
  del total ⇒ `excede` con el `disponible` **de la ventana**; previsualizar y aplicar en el mismo
  servicio dan la **misma** ventana (R57); las 3 imputaciones de un reparto llevan el mismo
  `metodo`, la misma `referencia` y la misma `fechaPago` (R58).
- **Hecho**: rol ajeno ⇒ `forbidden` **antes** de cualquier lectura; sin cierres imputables ⇒
  `sin_saldo` y cero escrituras; importe > imputable ⇒ `excede` con el `disponible` vigente y
  cero escrituras; tres imputaciones ⇒ tres pagos, cada uno con SU `cierreId`, y tres
  movimientos; runner que lanza en la tercera ⇒ **cero** filas (todo o nada); pendiente que
  cambia entre previsualizar y aplicar ⇒ se aplica el recalculado; cierre que dejó de estar
  `aprobado` ⇒ no recibe nada; clave repetida ⇒ `ya_registrado` con el reparto original y cero
  filas nuevas; previsualizar no llama a ningún método de escritura; **equivalencia**: un
  reparto que cae entero en un cierre escribe exactamente las mismas filas que
  `registrarPagoMensajero` por ese importe.
- **Depende de**: T3.2

### [x] T3.4 — Guardia de bloqueos y de alcance
- **Crea**: `tests/unit/guards/liquidacion-reparto-bloqueos.guardia.test.ts`
- **Cubre**: R21, R22, R26, R52, R55.
- **Hecho**: el reparto toma `{ tipo: "cierre" }` para **cada** cierre que toca y ninguno de
  otro grano; con `tope: 2` y 5 cierres imputables se toman **2** bloqueos y se escriben 2 pagos
  y 2 movimientos —los otros 3 cierres no aparecen en ninguna llamada (R55)—; el orden de
  adquisición coincide fila a fila con el de las imputaciones; los
  bloqueos se toman **antes** de la primera lectura de pendientes; `LiquidacionService` no
  nombra `cierreDia.update`/`create`/`delete`; no existe ningún método que edite o borre un
  reparto. El nombre del archivo casa con el patrón `guard` que `test:guardias` selecciona.
- **Depende de**: T3.2

---

## Tanda 4 — Borde

### [x] T4.1 — Tipos y schemas
- **Crea**: `lib/types/liquidacion-reparto.ts`
- **Cubre**: R9, R27, R46, R47, R48, R56.
- **Hecho**: los dos schemas de design §7.1 con `.strict()`; reusa `montoLiquidacionSchema`,
  `fechaPagoSchema` y `exigirReferenciaEnPagoElectronico` de `lib/types/liquidacion.ts` (no se
  reescriben); los DTO emiten `cierreId` y **ningún** identificador de persona; todos los
  importes son `string`; `PrevisualizacionRepartoDTO` lleva `imputable` (ventana),
  `imputableTotal`, `recorte` y `deudaNoImputable` con la comparación ya resuelta (design §7.2),
  de modo que el cliente no tenga que restar ni comparar nada. El `tope` viaja como `number` — es
  un cardinal, no un monto.
- **Depende de**: T0.1

### [x] T4.2 — Server Actions
- **Edita**: `lib/actions/liquidacion.ts`
- **Cubre**: R2, R9, R47.
- **Hecho**: `previsualizarRepartoMensajeroAction` y `registrarRepartoMensajeroAction` con el
  molde de las cinco existentes (actor → `UnauthenticatedError` **antes** del servicio →
  `schema.parse` → servicio bajo `withErrorHandler`); `deps` inyectables; el cableado del
  servicio suma el repositorio del reparto y **nada más** (la caja sigue sin tocarse en la rama
  del mensajero).
- **Depende de**: T3.2, T4.1

### [x] T4.3 — Tests del borde
- **Crea**: `tests/unit/actions/liquidacion-reparto-actions.test.ts`
- **Edita**: `tests/unit/actions/liquidacion-action.test.ts` (lista de exportaciones: 5 → 7)
- **Cubre**: R2, R9, R46, R47, R52.
- **Hecho**: sin sesión ⇒ rechazo **sin** construir el servicio; `cierreId` colado ⇒
  `validation_error` con la clave `cierreId` y sin llamar al servicio; `monto: 15000` numérico
  ⇒ `validation_error`; referencia obligatoria en SINPE; la lista exacta de exportaciones tiene
  siete nombres y ninguno casa con editar/actualizar/modificar/corregir/desanular.
- **Depende de**: T4.2

---

## Tanda 5 — UI del pago

### [x] T5.1 — Hueco de previsualización en el diálogo compartido
- **Edita**: `components/shared/liquidacion/RegistrarPagoDialog.tsx`
- **Cubre**: R27, R31, R34.
- **Hecho**: prop **aditiva y opcional** `renderPrevisualizacion?: (monto: string) => ReactNode`
  pintada bajo el campo de monto; sin ella, el diálogo se comporta **exactamente** como hoy
  (`tests/components/RegistrarPagoDialog.test.tsx` verde sin tocar asserts); el archivo sigue
  sin `Number(`, sin `parseFloat` y sin biblioteca de decimales.
- **Desviación declarada**: entraron **dos** props aditivas, no una. La segunda,
  `mensajeSinSaldo`, existe porque el texto de `sin_saldo` del diálogo dice literalmente «esta
  **tienda**» y hay un test de la 172 que lo fija palabra por palabra; es un rótulo con el
  valor de siempre por defecto, no una regla. Además el tipo del resultado se ensanchó a
  `RegistrarPagoResult | RegistrarRepartoResult`. Las dos ampliaciones son aditivas y el test
  del diálogo siguió verde sin tocar un assert (`progress/impl_205_tandas5y6.md > 1 y 2`).
- **Depende de**: —

### [x] T5.2 — Previsualización y acciones `[P con T5.3]`
- **Crea**: `app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx`,
  `app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx`
- **Edita**: `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts`
- **Cubre**: R3, R32, R33, R36, R37, R38, R44, R56.
- **Hecho**: la previsualización se pide al servidor con espera (`DEBOUNCE_MS_DEFAULT`) y se
  pinta como **lista descriptiva** (ni `<DataTable>` ni `<table>`, design §8); marca la
  imputación parcial y su resto; pinta el **conteo** de excluidos por estado —cuántos y de qué
  estado, sin nombrar ningún cierre y sin sumar un total en el cliente (enmienda `design.md
  §6.4`; el enunciado anterior decía «lista los excluidos con su estado»)—; pinta **dos avisos
  distintos** (design §8): el del **recorte por tope** con `enVentana`, `fuera` y `montoFuera`
  cuando `recorte.aplicado`, y el de **deuda no imputable** cuando `deudaNoImputable.hay` — nunca
  fundidos en uno; avisa cuando el importe excede; el botón se deshabilita con
  `imputable === "0.00"`; cero aritmética y **cero comparación de importes** en cliente (los
  booleanos vienen del servidor); el texto no usa siglas contables.
- **Depende de**: T4.2, T5.1

### [x] T5.3 — Montaje en el desglose `[P con T5.2]`
- **Edita**: `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx`
- **Cubre**: R3.
- **Hecho**: `PagoMensajeroAcciones` se monta en la cabecera del desglose (espejo de
  `PagoTiendaAcciones`); tras registrar se invalidan **solo** las claves SWR de ESE mensajero;
  la tabla, los filtros y la descarga existentes no cambian de comportamiento.
- **Depende de**: T5.2

### [x] T5.4 — Censo money-safe de los archivos de cliente
- **Edita**: `tests/unit/guards/liquidacion-money-safe.test.ts`
- **Cubre**: R16, R50.
- **Hecho**: los tres archivos de cliente nuevos/editados entran en el censo y pasan las cuatro
  aserciones (sin `Number(`, sin `toFixed(`, sin `@prisma/client` ni `decimal.js`, sin
  `new Decimal`).
- **Depende de**: T5.3

### [x] T5.5 — Tests de componentes
- **Crea**: `tests/components/RepartoPrevisualizacion.test.tsx`,
  `tests/components/PagoMensajeroAcciones.test.tsx`
- **Cubre**: R3, R32, R33, R34, R36, R37, R38, R56.
- **Hecho**: con una respuesta de servidor fija, la pantalla pinta esos importes **tal cual**
  (se cambia un importe de la respuesta y cambia el pintado, prueba de que no se recalcula);
  la parcial aparece marcada con su resto; los excluidos aparecen **contados por estado** (con
  900 rechazados sigue siendo UNA línea, sin ids ni fechas — enmienda `design.md §6.4`); el aviso de
  deuda no imputable aparece solo cuando corresponde; con `recorte.aplicado` aparece el aviso del
  recorte con las tres cifras y **sin** el otro, y con los dos activos aparecen los **dos**
  textos, distinguibles (R56); sin nada imputable el control queda deshabilitado con su
  explicación.
- **Depende de**: T5.3

---

## Tanda 6 — El cierre, direccionable

### [x] T6.1 — Enlace profundo en `/cierres-admin`
- **Edita**: `app/(app)/cierres-admin/_components/CierresAdminModule.tsx`
  (y `app/(app)/cierres-admin/page.tsx` **solo** si hace falta el límite de `Suspense`)
- **Cubre**: R39, R40, R41, R42, R45.
- **Hecho**: `?cierre=<uuid>` abre el detalle al montar llamando al `abrirDetalle` que ya
  existe (no se duplica la lectura); se abre **una** vez por navegación; al cerrar, el
  parámetro se retira de la URL; un id inexistente o fuera de alcance cae en el camino
  `no_encontrada` que ya está escrito; el resto del módulo no cambia (sus tests siguen verdes
  sin tocar asserts).
- **Depende de**: —

### [x] T6.2 — Enlaces por fila
- **Edita**: `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx`,
  `app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx`
- **Cubre**: R43, R44.
- **Hecho**: la fila con `cierreId` no nulo lleva un enlace a `/cierres-admin?cierre=<id>` con
  nombre accesible propio; la fila sin cierre **no** lleva enlace (ni deshabilitado ni roto);
  cada cierre de la previsualización y del resultado lleva el mismo enlace.
- **Depende de**: T2.4, T6.1, T5.2

### [x] T6.3 — Tests del enlace
- **Crea**: `tests/components/CierresAdminDeepLink.test.tsx`
- **Edita**: `tests/components/DesglosePagosMensajero.test.tsx` (o se crea si no existe)
- **Cubre**: R39, R40, R41, R42, R43, R44, R45.
- **Hecho**: con `?cierre=` el detalle se abre y la lectura se pide **por id**, no desde una
  fila; con un cierre que no está en la página visible **también** se abre; id inexistente ⇒
  aviso y ningún dato pintado; cerrar el detalle deja la URL sin el parámetro; fila sin cierre
  ⇒ sin enlace.
- **Depende de**: T6.2

---

## Tanda 7 — Cierre

### [x] T7.1 — Mapa de trazabilidad y evidencia
- **Crea**: `progress/impl_205-pago-mensajero-desde-wallet.md` → **hecho en
  `progress/impl_205_mapa.md`** (2026-08-12). El nombre cambia porque las bitácoras de esta
  feature se partieron por tandas (`impl_205_tanda0`, `impl_205_tandas1y2`, `impl_205_tandas3y4`,
  `impl_205_tandas5y6`) y el archivo consolidado tenía que distinguirse de las cuatro.
- **Cubre**: los 58 requisitos.
- **Hecho**: tabla `R<n> → test` completa (design §12) con la **salida real** de los tests
  pegada; ningún `R` sin test; se anota además la contraprueba de T0.3 (el censo visto en rojo
  antes de ampliarlo) y el resultado del barrido de T0.5 con sus comandos.
- **Depende de**: todas las anteriores.

### T7.2 — Gate completo
- **Cubre**: —
- **Hecho**: `./init.sh` completo en verde medido **en esta rama**, y comparado contra el
  baseline de `origin/dev` medido el mismo día. Un rojo por `Test timed out` se trata con el
  protocolo de la ficha 203 (aislar, comprobar ruta de ejecución real, relanzar) antes de darlo
  por real. El estado verde de un PR **no** cuenta: es un build.
- **Depende de**: T7.1

### T7.3 — Bookkeeping
- **Edita**: `feature_list.json` (id 205 → estado y `spec_path`), `progress/current.md`
- **Hecho**: solo se tocan los campos de la 205; el diff no arrastra altas ajenas; `status_note`
  de 3-6 líneas técnicas (el detalle vive en `progress/`); archivos en LF.
- **Parcial (2026-08-12)**: `spec_path` de la ficha 205 ya apunta a
  `specs/205-pago-mensajero-desde-wallet`. Quedan `progress/current.md`, la entrada de
  `progress/history.md` (`CHECKPOINTS > Verificación final`) y el `status_note`/estado final,
  que los escribe el leader tras T7.2. Por eso la tarea sigue **sin marcar**.
- **Depende de**: T7.2

---

## Dependencias entre tandas (resumen)

```
T0 ─┬─> T1 ──> T2 ──> T3 ──> T4 ──> T5 ──> T7
    └────────────────────────────>  T6 ──┘
```

`T2.4` y `T6.1` no dependen de nada de las tandas 0-1 y pueden adelantarse si conviene abrir
frente; el resto sigue el orden. Las tandas 3 y 5 son las que mueven dinero: no se cierran sin
`./init.sh --rapido` verde y con las guardias incluidas.

**T0.5 es una compuerta, no una tarea más.** No toca código y puede hacerse el primer día, pero
**T3.2 no empieza hasta que esté cerrada**: si el barrido encuentra algo que asuma una referencia
única por pago, la decisión vuelve al humano y el diseño de R58 podría cambiar. Adelantarse a
escribir la escritura del reparto sería construir sobre una respuesta que todavía no se tiene.
