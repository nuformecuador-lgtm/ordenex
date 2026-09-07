# Ficha 381 — diseño

Todo lo que sigue se apoya en el árbol real leído el 2026-09-07. Las referencias con línea se
comprobaron una a una; el grafo del MCP se usó para localizar, el archivo para confirmar.

> **Este documento describe lo que se va a construir.** El primer borrador (que proponía un ingreso
> espejo en la caja de Ordenex, un puerto `ICajaCargoTiendaPort` y reusar `ajuste_debito`) quedó
> derogado por las decisiones D1, D2, D3 y D4 del humano del 2026-09-07. **El commit `486d5dee` de
> la rama es un `wip` que construía ese puerto: no es referencia de nada.**

---

## §0 — La forma del cambio en una frase

Un cobro es **una fila** en `wallet_tienda_movimiento`, de una categoría propia, escrita desde una
tercera clase de destino del diálogo. **No toca la caja de Ordenex** (D1). El descuento del
disponible y el saldo en negativo **ya están construidos** y esta ficha solo los fija con tests.

```
RegistrarMovimientoCajaDialog          (app/(app)/wallet/_components/)
  └─ destino.clase === "cobro_tienda"  → registrarCobroTiendaAction   (lib/actions/wallet-tienda.ts)
        └─ CobroTiendaService.registrarCobro                          (lib/services/)
             ├─ UserRepository.obtenerCuentaTienda        ← R17: existe / rol / estado
             └─ runTransaction:
                  ├─ WalletTiendaMovimientoRepository.crearMovimientos(tx, [cobro])    ← R19/R20
                  └─ WalletTiendaMovimientoRepository.registrarCobroEnHistorial(tx, …) ← R40-R43
```

Dos escrituras, una transacción (R25). **Ninguna tercera**: nada en `wallet_movimiento` (R24). Es la
forma de `LiquidacionService.registrarPagoTienda` (`lib/services/LiquidacionService.ts:613-705`)
**menos** su llamada al puerto de la caja.

---

## §1 — Modelo de datos

### §1.1 Lo que NO cambia

**No hay tabla nueva, ni columna nueva, ni RLS nueva.** `wallet_tienda_movimiento` ya tiene RLS
habilitada sin policies (solo service role, patrón `wallet_movimiento`/`cierre_dia`) desde
`20260712170000_wallet_tienda_movimiento/migration.sql:74`. `historial_accion` está en el mismo
régimen.

La fila del cobro:

| columna | valor | por qué |
| --- | --- | --- |
| `tipo` | `debito` | el saldo de la tienda BAJA (R26) |
| `categoria` | `cobro_manual` | **valor nuevo**, §1.2 |
| `monto` | `Decimal(12,2)` construido desde el STRING | R18 |
| `origen_tipo` | `manual` | el valor ya existe en `wallet_origen_tipo` (`db/schema.prisma:1557`) |
| `origen_id` | `NULL` | R20; y con ello el cobro queda FUERA del índice único parcial → C2 |
| `descripcion` | lo tecleado, recortado | R15 |
| `registrado_por` | `actor.usuarioId` | R19 |
| `fecha_movimiento` | omitida (default de la columna) o medianoche del día elegido | R21 |
| `id` | **generado por el servicio** | hace falta para R40 (entidad del historial) |

`id` generado con `randomUUID()` en el servicio es el patrón de la ficha 334 en el libro de la caja
(`WalletService.registrarMovimientoManual`, `lib/services/WalletService.ts:242`): `createMany` sobre
Postgres no devuelve los ids generados. Obliga a **añadir `id?: string` a
`CrearMovimientoTiendaInput`** (`lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts:19`)
y a propagarla en el `map` del repositorio con el mismo
`...(m.id !== undefined ? { id: m.id } : {})` que ya usa `WalletMovimientoRepository:105`. Aditivo:
los escritores actuales siguen cayendo en el `@default(uuid())`.

### §1.2 LA DECISIÓN CENTRAL: categoría propia, no `ajuste_debito`

**D2 exige distinguir un cobro de una corrección. La distinción se hace con el enum, no con el
texto.**

Reusar `ajuste_debito` es gratis en migración y **falla en lo que D2 pide**: un cobro y una
corrección compensatoria quedarían indistinguibles en la fila, y lo único que los separaría sería la
`descripcion` — texto libre tecleado por una persona, exactamente aquello sobre lo que este repo se
niega a apoyar lógica de dinero (por eso el historial etiqueta un movimiento de caja por su
categoría y no por su descripción, `historial-accion-etiquetas.ts:89-93`). Consecuencias concretas
de conflacionar: no se podría filtrar «enséñame los cobros» ni en `/mi-wallet` ni en
`/wallet/tiendas` (R35), la descarga diría lo mismo para dos cosas distintas (R39), y la métrica
`cuenta_por_pagar_tienda` sumaría ambas bajo un nombre que ya no describe su contenido.

Y la asimetría que lo cierra: **`ajuste_debito` tiene CERO productores hoy** (`ajuste_credito` sí se
emite, desde `LiquidacionService.ts:1234`). Añadir el valor cuesta una migración **ahora** y nada
después. Conflacionarlos es **irreversible en los datos**: filas ya escritas bajo un mismo valor no
se pueden separar más tarde sin adivinar.

**Se añade `cobro_manual`** a `WalletTiendaMovimientoCategoria`. `ajuste_debito` se queda **intacto y
sin productores**, reservado a su propósito original —«corrección compensatoria inmutable», como lo
describe el esquema— y disponible el día que se abra la ficha del abono manual (que D3 deja fuera).

Nombre: `cobro_manual` y no `cobro_tienda` porque **toda** la tabla es de tiendas; lo que distingue a
esta categoría de `flete`/`comision_cod`/los tres IVA es que la decide una persona, no una tarifa.
Sujeto a Q1.

### §1.3 Las DOS migraciones, y por qué son dos

**Postgres prohíbe USAR un valor de enum en la misma transacción que lo añade (55P04)**, y Prisma
corre cada migración en su propia transacción. El CHECK
`wallet_tienda_movimiento_tipo_categoria_check` **nombra** los valores admitidos por rama
(`20260802120000_liquidacion_pago/migration.sql:131-136`), así que recrearlo con `cobro_manual`
dentro es *usar* el valor. Van separadas. El precedente está escrito:
`20260906120100_historial_accion_nodo_geografico/migration.sql:24-26` se separó por esta misma razón.

**Migración 1 — `<ts>_wallet_tienda_categoria_cobro_manual`**

```sql
ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'cobro_manual';
```

`down.sql`: Postgres no tiene `DROP VALUE`, así que **recrea el tipo con la lista previa** (los 10
valores del `CREATE TYPE` de `20260712170000_wallet_tienda_movimiento/migration.sql:20-31`, tal
cual: ninguna migración lo había ampliado desde entonces — **ésta es su primera ampliación**) y
recastea la columna. Coreografía obligatoria, copiada de
`20260827120000_premio_ranking_devengo/down.sql:35-51,90-107`, que hizo exactamente esto con
`pago_mensajero_movimiento_categoria`:

1. soltar **primero** todo lo que NOMBRA el tipo o depende de la columna: el CHECK
   `wallet_tienda_movimiento_tipo_categoria_check`, el índice
   `wallet_tienda_movimiento_tienda_id_categoria_idx` y el único parcial
   `wallet_tienda_movimiento_origen_uq` (que lleva `categoria` en su clave);
2. `RENAME TO …_old` → `CREATE TYPE` con los 10 → `ALTER COLUMN … USING (…::text::…)` →
   `DROP TYPE …_old`;
3. recrear los dos índices con **el mismo nombre y la misma forma** (el parcial con su
   `WHERE "origen_id" IS NOT NULL`) y el CHECK con **su lista original**.

Precondición ruidosa, escrita en el archivo: ninguna fila con `categoria = 'cobro_manual'`. Si la
hubiera, el `USING` falla y el rollback ABORTA. Es lo correcto: un cobro es dinero que una tienda
debe, y no se borra en silencio.

**Migración 2 — `<ts>_wallet_tienda_check_cobro_manual` + historial**

```sql
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito'))
  OR
  ("tipo" = 'debito'  AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual'))
);
ALTER TYPE "historial_accion_tipo"    ADD VALUE IF NOT EXISTS 'cobro_tienda_registrado';
ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'wallet_tienda_movimiento';
```

El CHECK **no se extiende solo**: un valor nuevo del enum queda RECHAZADO por la base hasta que la
lista lo nombre. Eso es una red, no un estorbo — la 172 la escribió a propósito para que «elegir otro
par no dé un saldo raro, sino un INSERT rechazado» (`LiquidacionService.ts:1190-1193`).

Los dos valores del historial van aquí y no en la migración 1 sólo por agrupar; no hay dependencia
entre ellos. **Dos entidades y no una:** `historial_accion_entidad` mapea 1:1 con tablas en sus 20
valores, y `wallet_tienda_movimiento` es una tabla; apuntar el rastro al `usuario` de la tienda
dejaría la fila sin poder señalar **qué asiento** se escribió, que es para lo que sirve el índice
`[entidad_tipo, entidad_id]`.

`down.sql` de la migración 2:

- devuelve el CHECK a **su lista original** (la de `20260802120000_liquidacion_pago:131-136`, sin
  `cobro_manual`) — y va **primero**, porque nombra un valor del enum que la migración 1 retira
  después en un rollback (los downs corren del más NUEVO al más VIEJO);
- recrea `historial_accion_tipo` con **49** valores = los 48 del `CREATE TYPE` de
  `20260907130000_historial_accion_zona_central_cambiada/down.sql` **MÁS**
  `'zona_central_cambiada'`, que es el valor que aquella migración añadió y que su propio down no
  podía listar (`ADD VALUE` sin `BEFORE`/`AFTER` apende, así que ése es el `enumsortorder` real);
- recrea `historial_accion_entidad` con **20** valores = los 17 del `CREATE TYPE` original de
  `20260902120000_historial_accion` MÁS `'provincia'`, `'canton'`, `'distrito'` (ficha 374);
- misma precondición ruidosa para las dos columnas de `historial_accion`.

**Comprobado cuál es la forma del down de cada enum tocado, no supuesto:** los dos de historial
**recrean-con-lista** (el único que los dropea entero es `20260902120000_historial_accion`, que
también los crea entero); `wallet_tienda_movimiento_categoria` sólo aparece en la migración que lo
crea y en su `down.sql`, que hace `DROP TYPE` porque también dropea la tabla — así que un valor nuevo
no le afecta. **NINGÚN `down.sql` anterior se toca:** son fotos históricas punto-en-el-tiempo (regla
escrita en `20260827120000_premio_ranking_devengo/down.sql:23-30`).

### §1.4 El abanico del valor nuevo (todo forzado por el compilador, salvo uno)

| Sitio | Qué gana | ¿Lo obliga el build? |
| --- | --- | --- |
| `db/schema.prisma` → `WalletTiendaMovimientoCategoria` | el valor | — |
| `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED` (`lib/types/wallet-tienda.ts:31`) | el valor | **sí**: `_EnsureCategoriaExhaustive` rompe si falta |
| `CUBETA_POR_CATEGORIA` (`lib/utils/desglose-tienda.ts:34`) | `"cargos"` (R36) | **sí**, `Record` total sin `default` |
| `FUENTE_TIENDA` (`lib/utils/aporte-por-orden.ts:94`) | `{ tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" }` | **sí**, `Record` total |
| `CATEGORIA_TIENDA_LABEL` (`mi-wallet-labels.ts:76`) | «Cobro de Ordenex» (R33/R34) | **sí**, `Record` total |
| `CATEGORIA_TIENDA_OPTIONS` (`mi-wallet-labels.ts:102`) | la opción de filtro (R35) | se deriva del SEED: **sale sola** |
| las dos tablas del libro y las dos descargas | el rótulo (R34/R39) | leen `CATEGORIA_TIENDA_LABEL`: **salen solas** |
| `RecaudoAnaliticaRepository:43` | entra en `CATEGORIAS_DE_TIENDA` | se deriva del SEED: **sale sola** |
| `metrics.ts` → `cuenta_por_pagar_tienda.definicion.categorias` (`:746-757`) | el valor | **NO**: está tipado `readonly string[]`. **Va a mano.** |

⚠️ **La última tiene trampa.** `tests/unit/analytics/catalogo-produccion.guardia.test.ts` deriva
«sujetos» de los documentos de `progress/`: si un archivo de `progress/` menciona entre comillas
invertidas ese campo de esa métrica, la entrada del catálogo queda obligada a **citar ese documento
con su fecha**. La guardia **no** escanea `specs/`, así que este archivo es inocuo; el informe de
implementación no lo será. Ver `tasks.md` T C.3.

---

## §2 — Contrato de entrada (borde tipado)

`lib/types/wallet-tienda.ts` gana el schema. **Reutiliza, no reescribe**, lo que ya existe en
`lib/types/wallet.ts`: `montoPositivoSchema` (`:374`, valida el monto como STRING y lo compara con
`Prisma.Decimal`, nunca con `Number`) y `fechaMovimientoSchema` (`:431`, que delega en
`problemaDeFechaMovimiento` y por eso emite **el mismo texto** que ven los otros cuatro conceptos,
R16).

```ts
export const registrarCobroTiendaSchema = z
  .object({
    tiendaId: z.string().uuid(),
    monto: montoPositivoSchema,                       // STRING, > 0, ≤ 2 decimales (R14/R18)
    descripcion: z.string().trim().min(1, "La descripcion es obligatoria."),  // R15
    fecha: fechaMovimientoSchema.optional(),          // R16/R21
  })
  .strict();                                          // una clave colada no llega al servicio
```

**Salida** (`RegistrarCobroTiendaServiceResult`), money-safe (montos STRING):

```ts
| { status: "ok"; cobro: WalletTiendaMovimientoDTO; saldo: SaldoTiendaDTO }
| { status: "validation_error"; fieldErrors: Record<string, string[]> }
| { status: "forbidden" }
```

`saldo` es el de la tienda DESPUÉS del cobro, derivado con `derivarSaldoTienda` —el mismo helper que
usa `LiquidacionService.restanteTrasAnular:1177-1179`—, y **viaja con su `signo`**: así el toast
puede decir «el saldo de X quedó en −₡15.000,00» sin que el navegador compare nada. Puede ser
negativo y se pinta entero; el precedente literal está en `PagoTiendaAcciones.tsx:70-77`. **No hay
rama `sin_saldo` ni `excede`** (R27): un cobro no se compara contra ningún disponible.

---

## §3 — Rutas y superficie

**Ninguna ruta nueva.** Mutación interna ⇒ **Server Action**, nunca `fetch` a `/api`
(`docs/architecture.md`). Se añade a `lib/actions/wallet-tienda.ts`, que ya tiene el molde
`withErrorHandler` + `resolveActorFromSession` + `UnauthenticatedError` (R13) y ya construye el
repositorio del ledger.

El catálogo de tiendas del selector (R5) **no estrena nada**: `listarAdminTiendas`
(`lib/actions/usuarios-por-rol.ts:43`) ya devuelve `id`/`nombre` de las cuentas `adminTienda`
`activo` ordenadas por nombre, y ya autoriza a `maestro`/`admin`. Precedente de consumo idéntico:
`GenerarApiKeyForm.cargarTiendasDestino:49-56`.

**Diferencia deliberada con ese precedente (R6):** allí la tienda es OPCIONAL y el catálogo «se
degrada en silencio». Aquí es OBLIGATORIA, así que degradar en silencio dejaría un concepto que no se
puede usar y no dice por qué. El diálogo muestra el aviso y deshabilita el registro **sólo para este
concepto**.

---

## §4 — El catálogo de conceptos: cómo entra el quinto sin romper la unión discriminada

`wallet-conceptos-manuales.ts` declara hoy:

```ts
export type DestinoConcepto =
  | { readonly clase: "egreso_administrativo"; readonly tipoEgreso: TipoEgresoManual }
  | { readonly clase: "ajuste_manual"; readonly tipo: WalletMovimientoTipo };

export interface ConceptoManual {
  readonly categoria: WalletMovimientoCategoria;   // ← categoría de la CAJA
  …
}
```

El problema es `categoria`: está tipada como categoría **de la caja**, y la del cobro
(`cobro_manual`) es del ledger **de la tienda**. Y `nombreEnElLibro()` la resuelve con
`CATEGORIA_LABEL[concepto.categoria]`, el diccionario de la caja.

**Decisión:** la categoría **se muda dentro de `destino`**, donde cada clase la declara con su propio
tipo, y `nombreEnElLibro` pasa a resolverse por `destino.clase`.

```ts
export type DestinoConcepto =
  | { clase: "egreso_administrativo"; tipoEgreso: TipoEgresoManual; categoria: WalletMovimientoCategoria }
  | { clase: "ajuste_manual";         tipo: WalletMovimientoTipo;   categoria: WalletMovimientoCategoria }
  | { clase: "cobro_tienda";          categoria: WalletTiendaMovimientoCategoria };
```

Por qué así y no ensanchando `categoria` a la unión de las dos: con una `categoria` ancha,
`nombreEnElLibro` tendría que adivinar en qué diccionario buscar, y un concepto de caja con una
categoría de tienda **compilaría**. Con la categoría dentro del destino, la propiedad que la ficha
334 dejó escrita —«un concepto nuevo que olvidara declarar su destino no compila»— se extiende a
«…ni puede declarar una categoría del libro equivocado».

`nombreEnElLibro(concepto)` devuelve `CATEGORIA_TIENDA_LABEL[…]` para la clase `cobro_tienda` y
`CATEGORIA_LABEL[…]` para las otras dos (R4). `CATEGORIA_TIENDA_LABEL` se importa de
`app/(app)/mi-wallet/_components/mi-wallet-labels.ts`; el cruce entre módulos de rutas ya está
establecido — `wallet/tiendas/_components/desglose-tienda-labels.ts:20-27` re-exporta ese mismo
diccionario, y la razón escrita es que «es el mismo ledger y dos mapas paralelos divergirían».

El módulo sigue siendo **PURO**: sin React y sin leer ningún reloj.

---

## §5 — El servicio: `CobroTiendaService`

`lib/services/CobroTiendaService.ts` + `lib/interfaces/services/ICobroTiendaService.ts`.

**Por qué un servicio nuevo y no un método en `WalletTiendaService`.** Ese servicio es de LECTURA
—listados, saldos, desglose, cierres—, se construye con un solo repositorio, y lo instancian siete
acciones y una decena de tests. Meterle una escritura le añadiría el repositorio de usuarios y el
runner de transacciones al constructor, tocando a todos sus llamadores por una razón que no es suya.
`LiquidacionService` es el precedente contrario y explícito: las escrituras de dinero viven en su
propio servicio.

```ts
constructor(
  private readonly tiendaRepo: IWalletTiendaMovimientoRepository,
  private readonly usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
  private readonly runTransaction: CobroTiendaTxRunner,
) {}
```

`registrarCobro(input, actor)`, y **el orden es parte del requisito**:

1. **Rol PRIMERO** (R12): `esAccesoTotal(actor.rol)` → `forbidden` **antes de tocar la base**. Mismo
   predicado y mismo motivo que `WalletService.registrarMovimientoManual:233` y que
   `LiquidacionService.registrarPagoTienda:617`: un `forbidden` evaluado después del `SELECT` ya
   habría leído el dinero para tirarlo.
2. **Escala 2 fijada UNA vez** (R18): `new Prisma.Decimal(input.monto).toDecimalPlaces(2,
   ROUND_HALF_UP)` → `montoStr = .toFixed(2)`. Ese MISMO string va al asiento y a la fila del
   historial. Ni un `Number()` en el camino. Es la lección medida de la feature 204 (14 de 66
   órdenes con un céntimo de desviación al multiplicar en el navegador).
3. **La tienda, validada en el servidor** (R17): existe / `rol.value === "adminTienda"` /
   `estado === "activo"` → si no, `validation_error` con `fieldErrors.tiendaId`. Es el patrón de
   `ApiKeyService` (`lib/services/ApiKeyService.ts:44-58`, con sus tres mensajes separados:
   inexistente / rol / inactiva). Va **fuera** de la transacción: es una lectura de catálogo, y lo
   peor que puede pasar es que la tienda se desactive un instante después, lo cual no invalida un
   cobro ya decidido.
4. **`id = randomUUID()`** (§1.1).
5. **`runTransaction`** con las dos escrituras (R25).
6. **Saldo de vuelta**, derivado con `derivarSaldoTienda` sobre `agregarSaldoPorTienda` (§2).

**Sin candado de fila y sin comprobación de disponible, y es deliberado (R27).** El pago a tienda
toma `bloquearBeneficiario` porque compara el monto contra un disponible y dos transacciones
simultáneas pagarían de más. **Un cobro no compara nada contra nada**: no hay tope, el saldo puede
quedar negativo por decisión firmada (D3), y el saldo se deriva de la suma del ledger, que es
correcta con cualquier orden de inserción. Tomar un candado que no protege ninguna invariante sería
serializar escrituras por ceremonia.

---

## §6 — Lo que NO se construye: el desquite y el negativo

D3 dice que el desquite es automático. **Lo es, y ya está en el árbol**, así que aquí no se escribe
lógica nueva — se escriben **tests** (R26–R31).

- `derivarDesgloseTienda` (`lib/utils/desglose-tienda.ts:66-94`) suma cada categoría en su cubeta con
  `Prisma.Decimal` y cierra `saldo = aFavor − cargos − pagado`, con `signo` derivado en el
  **servidor**. Con `CUBETA_POR_CATEGORIA.cobro_manual = "cargos"`, un cobro baja el saldo por
  construcción: **R26 sale de la tabla de §1.4, no de código nuevo.**
- `derivarSaldoTienda` (`lib/utils/saldo-tienda.ts`) declara por escrito que el saldo «PUEDE ser
  negativo».
- **Las dos pantallas ya lo pintan** con los mismos tres colores y el mismo badge: el admin en
  `SaldosTiendasTable.tsx:36-50` (`text-danger-strong` + `Badge variant="destructive"` + «En
  contra»), la tienda en `SaldoTiendaCard.tsx:31-45` (idéntico). Los dos renderizan el STRING **tal
  cual** con `money`, que no convierte a número, así que el `-` viene del servidor. R28, R29 y R30
  son **comprobaciones**, no construcción.
- **«Cobrarse solo cuando se le deba»** también existe: `PagoTiendaAcciones.tsx:130` calcula
  `hayQuePagar = signo === "positivo"`, deshabilita el botón y dice «Esta tienda no tiene saldo a
  favor: no hay nada que pagar». R31 lo fija con un test.

**Por qué se escriben requisitos para algo que ya funciona.** Porque hoy el saldo negativo sólo podía
venir de fletes de devolución y nadie lo mira; desde esta ficha lo produce una decisión humana y se
va a ver a menudo (C3). Un comportamiento sin test es un comportamiento que la próxima ficha puede
romper en silencio — y en este repo eso ya pasó lo bastante como para no darlo por bueno leyendo el
código.

**Lo único que SÍ cambia de pantalla en esta sección** es la aclaración del importe de cargos de
`/mi-wallet` (R37): `DESGLOSE_MI_WALLET_LABEL.cargosHint` dice hoy «Fletes, comisión e IVA»
(`mi-wallet-labels.ts:45`) y con esta ficha esa enumeración deja de ser completa.

---

## §7 — El rastro en `historial_accion`

**Decisión: SÍ deja rastro, y no basta con `registrado_por`.**

El criterio no lo inventa esta ficha: la ficha 362 lo dejó escrito en
`WalletMovimientoRepository.crearMovimientoRegistrado:122-135` — «se registra la DECISIÓN, no sus
asientos». Los ~34 asientos automáticos de aprobar un cierre NO se registran; los tres que nacen de
una decisión humana sobre dinero SÍ. Un cobro manual a una tienda es exactamente ese género. La
columna `registrado_por` dice **quién**, pero vive en un ledger que la pantalla de historial no lee,
no se puede filtrar por «lo que movió dinero» y no aparece junto a las otras 48 acciones auditadas.

**Cómo, con la forma que la guardia acepta.**
`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` exige, por cada tipo del
catálogo, un productor real en un CENSO cerrado y una de dos formas de atomicidad. Se usa
**`recibe_tx`**, la fuerte —«la atomicidad es del TIPO, no de la disciplina»—:

`WalletTiendaMovimientoRepository.registrarCobroEnHistorial(tx, { cobroId, tiendaId, monto,
actorUsuarioId })` recibe la transacción como primer parámetro, lee el nombre de la tienda **dentro**
de ella para congelar la etiqueta, y llama a `appendAccion`. Es la forma exacta de
`RankingSnapshotRepository.registrarAccionSobreFila` (censo, forma `recibe_tx`, mutación
`tx.rankingSnapshotFila.findUnique(`); aquí la mutación que la guardia comprueba será
`tx.usuario.findUnique(`.

La fila:

| campo | valor |
| --- | --- |
| `accion` | `cobro_tienda_registrado` |
| `entidadTipo` | `wallet_tienda_movimiento` |
| `entidadId` | el id del cobro |
| `entidadEtiqueta` | `etiquetaDeEntidad("wallet_tienda_movimiento", { tiendaNombre })` |
| `monto` | `new Prisma.Decimal(montoStr)` — STRING → Decimal, sin `Number()` (R18) |
| actor | `resolverActorCongelado(tx, actorUsuarioId)` |

`lib/types/historial-accion-etiquetas.ts` gana la clave
`wallet_tienda_movimiento: { tiendaNombre: string | null }` y su resolvedor `(f) =>
unir(f?.tiendaNombre)`. **El nombre de la tienda cabe bajo R5 de la 362** (nada de PII ni texto libre
por transacción): es una etiqueta de catálogo, del mismo género que
`liquidacion_pago: { beneficiarioNombre }`, que ya se usa **para tiendas**. Lo que NO entra es la
`descripcion` del cobro: texto libre tecleado por una persona (R43).

`CATEGORIA_POR_ACCION.cobro_tienda_registrado = "mueve_dinero"` (R41) y
`ACCION_LABELS.cobro_tienda_registrado = "Cobró un costo a una tienda"`. Los dos `Record` son
exhaustivos por tipo: olvidar uno no compila.

---

## §8 — La pantalla

`RegistrarMovimientoCajaDialog.tsx`:

- **Un campo condicional**, no un diálogo nuevo (R2/R3). `concepto.destino.clase === "cobro_tienda"`
  monta un `Select` de tienda; en los otros cuatro conceptos no se monta ni se envía nada — R3 es
  testeable justamente porque el payload de los otros cuatro no debe ganar ni una clave.
- **El enrutado sigue siendo por clase**, con una tercera rama en `registrar()`. Un `if` sobre el id
  del concepto sería lo que la ficha 334 prohibió por escrito.
- **`reset()`** limpia también la tienda elegida.
- **R4:** el texto «Se registra en el libro como «…»» pasa a nombrar **de qué libro** habla — el de
  la tienda. El título estático «Registrar movimiento en la caja» deja de ser cierto para este
  concepto y se ajusta.
- **R8** ya está resuelto y no se reimplementa: `components/shared/Modal.tsx` bloquea el segundo
  envío con `pendingRef` antes de que React re-renderice (su propio R17). Aquí sólo se comprueba.
- **R9:** `onRegistrado?.()` + `router.refresh()`, exactamente como los cuatro conceptos actuales.
- **R6:** si `listarAdminTiendas` no devuelve `ok`, el selector queda vacío y el registro **del
  cobro** deshabilitado con un mensaje; los otros cuatro siguen registrándose.

`/mi-wallet` y `/wallet/tiendas`: **una sola línea de texto cambia** (R37, el `cargosHint`). Todo lo
demás sale gratis del valor de enum (§1.4): el rótulo en las dos tablas del libro, la opción de
filtro en los dos selectores y el nombre en las dos descargas. Ésta es la mitad barata de la ficha, y
es barata porque la 43 y la 171 dejaron el hueco hecho.

`WalletModule.tsx` no cambia: sigue montando el mismo diálogo con el mismo `onRegistrado`.

---

## §9 — Alternativas descartadas

### §9-A — Un botón «cobrar» en `/wallet/tiendas`, junto al de pagar

**Es la superficie más natural** y la más barata: `PagoTiendaAcciones.tsx` ya vive dentro del
desglose de UNA tienda, así que la tienda no habría que preguntarla —viene del contexto— y R5, R6,
R7 y R17 desaparecerían casi enteros. Además el refresco dirigido (`claveDesgloseTienda` +
`clavePagosDeTienda`) ya está resuelto ahí.

**Descartada porque no es lo que se pidió.** El encargo nombra el botón: «desde el botón de registrar
movimiento». Queda anotada como la evolución obvia si el humano la prefiere: el servicio, la action y
el schema valdrían **tal cual**, y sólo cambiaría quién los llama.

### §9-B — Reusar `ajuste_debito` en vez de añadir `cobro_manual`

Descartada por D2 y por la asimetría de coste. Argumento completo en §1.2: la distinción quedaría en
un campo de texto libre, se perderían R35, R39 y la limpieza de la métrica
`cuenta_por_pagar_tienda`, y **conflacionar filas es irreversible** mientras que añadir el valor
cuesta dos migraciones hoy y nada después.

### §9-C — Escribir además un ingreso espejo en la caja de Ordenex

**Era la recomendación del leader en el primer borrador y el humano la descartó (D1):** «más que
marcar como ingreso es quitar del dinero disponible de esa tienda». El argumento a favor era la
simetría con los seis débitos automáticos, que sí son espejo 1:1 de seis ingresos de caja
(`db/schema.prisma:1617-1618`). El humano decidió que un cobro manual no es eso. Consecuencia
aceptada y escrita: **los dos libros divergen a propósito** — la tienda debe más y la caja no
reconoce ese ingreso hasta que el dinero entre de verdad. Con ella desaparecen el puerto
`ICajaCargoTiendaPort`, su implementación, y la ampliación de `wallet_origen_tipo` que el enlace
habría exigido (una migración con recast de tres tablas y seis índices). **R24 convierte esta
decisión en un requisito comprobable**, en vez de dejarla como una ausencia que nadie vigila.

### §9-D — Un abono (crédito) manual en el mismo diálogo

Descartada por D3: «con respecto al abono no lo pongas, pues esto sí es automático». Sería el
concepto simétrico y costaría poco encima de esta ficha (el mismo servicio con `tipo: credito` y
`ajuste_credito`). No se construye. Su ausencia tiene una consecuencia real y declarada en C1.

### §9-E — Unificar el backend de los cinco conceptos en una sola Server Action

Descartada, y no por gusto: `wallet-conceptos-manuales.ts:18-21` dejó escrito por qué no se hizo con
los cuatro actuales — `origen_tipo` decide qué es reversable, y fusionarlos «volvería reversables los
ajustes, un cambio en dinero que nadie pidió». Con el quinto el argumento es más fuerte: escribe en
**otra tabla**.

### §9-F — Emitir el IVA del cobro como un movimiento aparte

Descartada (R23). Los seis débitos automáticos llevan sus tres IVA como movimientos separados porque
**se derivan de una tarifa** con un porcentaje configurado. Un cobro manual no tiene tarifa detrás: es
un importe que alguien decide, y ese importe es el que se cobra. Inventarle un IVA obligaría a elegir
una tasa que nadie declaró.

### §9-G — Reusar el tipo de historial `wallet_movimiento_manual_registrado`

Descartada. Ahorraría los dos valores de historial, pero su etiqueta dice «Registró un movimiento
manual de **caja**» (`lib/types/historial-accion.ts:306`) y su productor censado es
`WalletMovimientoRepository.crearMovimientoRegistrado`. Reusarlo pondría en el historial una frase
falsa y rompería la guardia del censo, que exige que el tipo lo escriba el método declarado.

---

## §10 — Verificación: dónde vive cada cosa

- **Los tests de servicio usan dobles y no ven el SQL.** Lo que viva en un `WHERE`, en un CHECK o en
  una transacción se prueba contra Postgres real en `tests/integration/db/` — lección medida cuatro
  veces en este repo. Aquí eso son: que el `INSERT` del cobro **pase** el CHECK recreado, que un
  `credito` con `cobro_manual` lo **rechace** la base, que el cobro baje el saldo derivado, que el
  fallo de la segunda escritura no deje la primera (R25), y que las dos migraciones y sus `down.sql`
  sean exactos.
- **La migración se prueba con su test de migración**, reconstruyendo el estado previo ejecutando las
  migraciones REALES anteriores y comparando valor a valor y en orden: es lo que hace
  `tests/integration/db/historial-accion-zona-central-migration.test.ts` y por qué su `down.sql`
  puede decir «no se fía de esta frase». Aquí hay que comprobar **también** la lista del CHECK, no
  sólo la del enum.
- **El gate.** Este diff toca `db/schema.prisma`, `lib/types/` y dos migraciones: `./init.sh
  --rapido` **se niega solo** y manda al completo. No es un aviso, es un `fail` (`CLAUDE.md`,
  regla 5).
- **Base local compartida:** aplicar estas migraciones en la base local pone rojo el gate de otras
  ramas que aún no las tienen. Coordinar antes de `prisma migrate deploy`.
