# Feature 205 — Tareas

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas marcadas del
mismo bloque. Cada tarea declara **archivos exactos**, **requisitos** que cubre, **criterio de
hecho** y **dependencias**.

**Gate por tanda:** `./init.sh --rapido`. **Gate final y antes del PR:** `./init.sh` completo,
sin excepción (`docs/verification.md`). Ocho tandas; ninguna deja el árbol a medias.

---

## Tanda 0 — El cálculo, puro y sin base de datos

### T0.1 — Módulo puro del reparto
- **Crea**: `lib/utils/reparto-liquidacion-mensajero.ts`
- **Exporta**: `CierreImputable`, `Imputacion`, `Reparto`, `ordenarCierresFifo`,
  `repartirEntreCierres` (design §2.1).
- **Cubre**: R8, R10, R11, R12, R13, R16, R17.
- **Hecho**: sin imports de `next/*`, de repositorios ni de `new Date()`; solo
  `Prisma.Decimal`; cero `Number(`/`parseFloat(`/`parseInt(`; todo `toFixed(2)`; el comparador
  incluye el desempate por `cierreId` asc; el nombre del archivo contiene `liquidacion` (lo
  exige la auto-captura del censo, design §11).
- **Depende de**: —

### T0.2 — Tests del módulo puro `[P con T0.3]`
- **Crea**: `tests/unit/utils/reparto-liquidacion-mensajero.test.ts`
- **Cubre**: R8, R10, R11, R12, R13, R17.
- **Hecho**: importe menor que el primer pendiente ⇒ una sola imputación parcial; importe que
  cruza tres cierres ⇒ dos completas + una parcial y **solo la última** es parcial; `Σ montos`
  igual al importe al céntimo (caso con `0.01` y con decimales que rompen un `float`); cierres
  con pendiente `0.00` no aparecen; dos cierres con el mismo `solicitadoAt` salen siempre en el
  mismo orden; importe mayor que el imputable ⇒ `sobrante > 0` y `totalImputado = imputable`.
  El archivo **no** importa Prisma para construir datos de entrada (entra STRING, sale STRING).
- **Depende de**: T0.1

### T0.3 — Censo money-safe ampliado `[P con T0.2]`
- **Edita**: `tests/unit/guards/liquidacion-money-safe.test.ts` (`ARCHIVOS_DE_LA_FEATURE`)
- **Cubre**: R16, R50.
- **Hecho**: se añade `lib/utils/reparto-liquidacion-mensajero.ts`; **antes** de añadirlo se
  ve el test FALLAR por auto-captura (la cláusula de `:139-146`), y se deja constancia en el
  progreso: es la prueba de que el mecanismo vigila y no de que la lista se completó a mano.
- **Depende de**: T0.1

---

## Tanda 1 — Persistencia del acto

### T1.1 — Modelos Prisma
- **Edita**: `db/schema.prisma` (modelo `LiquidacionReparto`; `repartoId` nullable + relación
  en `LiquidacionPago`).
- **Cubre**: R29, R49.
- **Hecho**: `pnpm db:generate` limpio; `@map` en `snake_case`; `clave_idempotencia` `@unique`;
  FKs `onDelete: Restrict`; **sin** `updatedAt`/`deletedAt`; índice
  `(mensajeroId, createdAt)`; `LiquidacionPago` no pierde ni renombra nada.
- **Depende de**: —

### T1.2 — Migración UP
- **Crea**: `db/migrations/<ts>_liquidacion_reparto/migration.sql`
- **Cubre**: R29, R49.
- **Hecho**: generada con `pnpm run db:migrate:create` (no a mano ni editada después de
  aplicarse); crea la tabla con su `CHECK (monto_total > 0)`, sus dos FK, el `UNIQUE` y el
  índice; añade `liquidacion_pago.reparto_id` **nullable** con su FK e índice;
  `ALTER TABLE liquidacion_reparto ENABLE ROW LEVEL SECURITY`; **ninguna** sentencia altera,
  renombra o borra objetos preexistentes; **no** se crea ningún enum (los `down.sql` previos no
  se tocan).
- **Depende de**: T1.1

### T1.3 — Migración DOWN
- **Crea**: `db/migrations/<ts>_liquidacion_reparto/down.sql`
- **Cubre**: R49.
- **Hecho**: `ALTER TABLE liquidacion_pago DROP COLUMN IF EXISTS reparto_id` y luego
  `DROP TABLE IF EXISTS liquidacion_reparto` (orden inverso al UP);
  `pnpm run db:migrate` seguido de `pnpm run db:rollback` deja el esquema idéntico al previo
  (comparado, no supuesto).
- **Depende de**: T1.2

### T1.4 — Test de esquema y migración
- **Crea**: `tests/integration/db/liquidacion-reparto-migration.test.ts`
- **Cubre**: R29, R49.
- **Hecho**: columnas y tipos; el `UNIQUE` de `clave_idempotencia` **rechaza** el duplicado; el
  `CHECK` rechaza `monto_total = 0`; borrar el usuario con repartos falla; `reparto_id` admite
  `NULL`; `pg_class.relrowsecurity` es `true`. El test **crea sus propios datos**: nada de
  `if (!fila) return;` que reporte verde sin comprobar nada.
- **Depende de**: T1.3

---

## Tanda 2 — Repositorios

### T2.1 — Repositorio del reparto
- **Crea**: `lib/interfaces/repositories/ILiquidacionRepartoRepository.ts`,
  `lib/repositories/LiquidacionRepartoRepository.ts`
- **Cubre**: R28, R29.
- **Hecho**: `crear(tx, input)` traduce el choque del `UNIQUE` en
  `{ status: "clave_repetida" }` **sin lanzar** (misma forma que `CrearLiquidacionPagoResult`);
  `obtenerPorClave(clave)` con el cliente propio (la relectura ocurre fuera de la transacción);
  cliente Prisma acotado con `Pick<PrismaClient, …>`; cero lógica de negocio; montos STRING de
  entrada y salida.
- **Depende de**: T1.1

### T2.2 — Ampliación del repositorio del pago
- **Edita**: `lib/interfaces/repositories/ILiquidacionPagoRepository.ts`,
  `lib/repositories/LiquidacionPagoRepository.ts`
- **Cubre**: R5, R6, R8, R18, R28.
- **Hecho**: `listarCierresImputables(mensajeroId, tx?)` devuelve `id`, `mensajeroId`,
  `estado`, `totalPagoMensajero`, `totalEfectivo` y `solicitadoAt` de los cierres `aprobado`
  del mensajero, ordenados `solicitado_at ASC, id ASC` (el orden de verdad lo fija T0.1; aquí
  es eficiencia); `listarPorReparto(repartoId)`; `CrearLiquidacionPagoInput` gana
  `repartoId: string | null` y el camino existente pasa `null`. **Ningún** método nuevo escribe
  en `cierre_dia`.
- **Depende de**: T1.1

### T2.3 — Tests de repositorios `[P con T2.4]`
- **Crea**: `tests/unit/repositories/liquidacion-reparto-repository.test.ts`
- **Edita**: el test existente del repositorio del pago (el que cubra `crear`).
- **Cubre**: R5, R8, R28, R29.
- **Hecho**: P2002 de la clave ⇒ `clave_repetida` sin propagar; el `where` de
  `listarCierresImputables` filtra por `mensajeroId` **y** `estado: "aprobado"` y el `orderBy`
  es `[solicitadoAt asc, id asc]`; `crear` emite `reparto_id` cuando se le pasa y `null`
  cuando no. Se comprueba el **WHERE**, no solo el resultado del doble.
- **Depende de**: T2.1, T2.2

### T2.4 — Cierre resuelto en el desglose `[P con T2.3]`
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

### T3.1 — Escritor único y previsualización
- **Edita**: `lib/services/LiquidacionService.ts`,
  `lib/interfaces/services/ILiquidacionService.ts`
- **Cubre**: R1, R5, R6, R7, R15, R32, R35, R36, R37, R38, R51.
- **Hecho**: el cuerpo que escribe documento + movimiento sale a un privado
  `escribirPagoDeCierre(tx, …)` y `registrarPagoMensajero` lo usa **sin cambiar su
  comportamiento** (`tests/unit/services/liquidacion-service.test.ts` verde **sin tocar un solo
  assert**); `previsualizarRepartoMensajero(input, actor)` deriva el conjunto imputable, el
  `imputable`, la `cuentaPorPagar`, los `excluidos` y —si viene monto— las imputaciones, usando
  T0.1; **no abre transacción, no toma bloqueos y no invoca ningún método de escritura**.
- **Depende de**: T0.1, T2.2

### T3.2 — Aplicación del reparto
- **Edita**: `lib/services/LiquidacionService.ts`,
  `lib/interfaces/services/ILiquidacionService.ts`
- **Cubre**: R1, R4, R14, R18, R19, R20, R21, R22, R23, R24, R25, R26, R28, R29.
- **Hecho**: `registrarRepartoMensajero` con el orden de design §2.1 — rol → transacción →
  fila del reparto (choque ⇒ señal interna, relectura **fuera**) → bloqueo por cierre en el
  orden del reparto → relectura de pendientes bajo bloqueo → recálculo → escritura por
  imputación con el privado de T3.1; devuelve el reparto **aplicado**; una excepción en
  cualquier punto revierte todo.
- **Depende de**: T2.1, T3.1

### T3.3 — Tests del servicio
- **Crea**: `tests/unit/services/liquidacion-reparto-service.test.ts`
- **Cubre**: R1, R5, R6, R7, R14, R15, R18, R19, R20, R23, R24, R25, R26, R28, R30, R35, R51.
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

### T3.4 — Guardia de bloqueos y de alcance
- **Crea**: `tests/unit/guards/liquidacion-reparto-bloqueos.guardia.test.ts`
- **Cubre**: R21, R22, R26, R52.
- **Hecho**: el reparto toma `{ tipo: "cierre" }` para **cada** cierre que toca y ninguno de
  otro grano; el orden de adquisición coincide fila a fila con el de las imputaciones; los
  bloqueos se toman **antes** de la primera lectura de pendientes; `LiquidacionService` no
  nombra `cierreDia.update`/`create`/`delete`; no existe ningún método que edite o borre un
  reparto. El nombre del archivo casa con el patrón `guard` que `test:guardias` selecciona.
- **Depende de**: T3.2

---

## Tanda 4 — Borde

### T4.1 — Tipos y schemas
- **Crea**: `lib/types/liquidacion-reparto.ts`
- **Cubre**: R9, R27, R46, R47, R48.
- **Hecho**: los dos schemas de design §7.1 con `.strict()`; reusa `montoLiquidacionSchema`,
  `fechaPagoSchema` y `exigirReferenciaEnPagoElectronico` de `lib/types/liquidacion.ts` (no se
  reescriben); los DTO emiten `cierreId` y **ningún** identificador de persona; todos los
  importes son `string`.
- **Depende de**: T0.1

### T4.2 — Server Actions
- **Edita**: `lib/actions/liquidacion.ts`
- **Cubre**: R2, R9, R47.
- **Hecho**: `previsualizarRepartoMensajeroAction` y `registrarRepartoMensajeroAction` con el
  molde de las cinco existentes (actor → `UnauthenticatedError` **antes** del servicio →
  `schema.parse` → servicio bajo `withErrorHandler`); `deps` inyectables; el cableado del
  servicio suma el repositorio del reparto y **nada más** (la caja sigue sin tocarse en la rama
  del mensajero).
- **Depende de**: T3.2, T4.1

### T4.3 — Tests del borde
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

### T5.1 — Hueco de previsualización en el diálogo compartido
- **Edita**: `components/shared/liquidacion/RegistrarPagoDialog.tsx`
- **Cubre**: R27, R31, R34.
- **Hecho**: prop **aditiva y opcional** `renderPrevisualizacion?: (monto: string) => ReactNode`
  pintada bajo el campo de monto; sin ella, el diálogo se comporta **exactamente** como hoy
  (`tests/components/RegistrarPagoDialog.test.tsx` verde sin tocar asserts); el archivo sigue
  sin `Number(`, sin `parseFloat` y sin biblioteca de decimales.
- **Depende de**: —

### T5.2 — Previsualización y acciones `[P con T5.3]`
- **Crea**: `app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx`,
  `app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx`
- **Edita**: `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts`
- **Cubre**: R3, R32, R33, R36, R37, R38, R44.
- **Hecho**: la previsualización se pide al servidor con espera (`DEBOUNCE_MS_DEFAULT`) y se
  pinta como **lista descriptiva** (ni `<DataTable>` ni `<table>`, design §8); marca la
  imputación parcial y su resto; lista los excluidos con su estado; avisa cuando
  `imputable < cuentaPorPagar` y cuando el importe excede; el botón se deshabilita con
  `imputable === "0.00"`; cero aritmética en cliente; el texto no usa siglas contables.
- **Depende de**: T4.2, T5.1

### T5.3 — Montaje en el desglose `[P con T5.2]`
- **Edita**: `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx`
- **Cubre**: R3.
- **Hecho**: `PagoMensajeroAcciones` se monta en la cabecera del desglose (espejo de
  `PagoTiendaAcciones`); tras registrar se invalidan **solo** las claves SWR de ESE mensajero;
  la tabla, los filtros y la descarga existentes no cambian de comportamiento.
- **Depende de**: T5.2

### T5.4 — Censo money-safe de los archivos de cliente
- **Edita**: `tests/unit/guards/liquidacion-money-safe.test.ts`
- **Cubre**: R16, R50.
- **Hecho**: los tres archivos de cliente nuevos/editados entran en el censo y pasan las cuatro
  aserciones (sin `Number(`, sin `toFixed(`, sin `@prisma/client` ni `decimal.js`, sin
  `new Decimal`).
- **Depende de**: T5.3

### T5.5 — Tests de componentes
- **Crea**: `tests/components/RepartoPrevisualizacion.test.tsx`,
  `tests/components/PagoMensajeroAcciones.test.tsx`
- **Cubre**: R3, R32, R33, R34, R36, R37, R38.
- **Hecho**: con una respuesta de servidor fija, la pantalla pinta esos importes **tal cual**
  (se cambia un importe de la respuesta y cambia el pintado, prueba de que no se recalcula);
  la parcial aparece marcada con su resto; los excluidos aparecen con su estado; el aviso de
  deuda no imputable aparece solo cuando corresponde; sin nada imputable el control queda
  deshabilitado con su explicación.
- **Depende de**: T5.3

---

## Tanda 6 — El cierre, direccionable

### T6.1 — Enlace profundo en `/cierres-admin`
- **Edita**: `app/(app)/cierres-admin/_components/CierresAdminModule.tsx`
  (y `app/(app)/cierres-admin/page.tsx` **solo** si hace falta el límite de `Suspense`)
- **Cubre**: R39, R40, R41, R42, R45.
- **Hecho**: `?cierre=<uuid>` abre el detalle al montar llamando al `abrirDetalle` que ya
  existe (no se duplica la lectura); se abre **una** vez por navegación; al cerrar, el
  parámetro se retira de la URL; un id inexistente o fuera de alcance cae en el camino
  `no_encontrada` que ya está escrito; el resto del módulo no cambia (sus tests siguen verdes
  sin tocar asserts).
- **Depende de**: —

### T6.2 — Enlaces por fila
- **Edita**: `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx`,
  `app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx`
- **Cubre**: R43, R44.
- **Hecho**: la fila con `cierreId` no nulo lleva un enlace a `/cierres-admin?cierre=<id>` con
  nombre accesible propio; la fila sin cierre **no** lleva enlace (ni deshabilitado ni roto);
  cada cierre de la previsualización y del resultado lleva el mismo enlace.
- **Depende de**: T2.4, T6.1, T5.2

### T6.3 — Tests del enlace
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

### T7.1 — Mapa de trazabilidad y evidencia
- **Crea**: `progress/impl_205-pago-mensajero-desde-wallet.md`
- **Cubre**: los 52 requisitos.
- **Hecho**: tabla `R<n> → test` completa (design §12) con la **salida real** de los tests
  pegada; ningún `R` sin test; se anota además la contraprueba de T0.3 (el censo visto en rojo
  antes de ampliarlo).
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
