# Ficha 381 — diseño

Todo lo que sigue se apoya en el árbol real leído el 2026-09-07. Las referencias con línea se
comprobaron una a una; el grafo del MCP se usó para localizar, el archivo para confirmar.

---

## §0 — La forma del cambio en una frase

El concepto nuevo NO escribe en la caja por el camino de los otros cuatro: escribe en
`wallet_tienda_movimiento` a través de una **tercera clase de destino** en la unión discriminada que
ya existe, una **Server Action propia** y un **servicio propio de escritura**. La caja de Ordenex
(si Q1 = sí) la toca **un solo puerto**, llamado desde **un solo sitio**.

```
RegistrarMovimientoCajaDialog          (app/(app)/wallet/_components/)
  └─ destino.clase === "cargo_tienda"  → registrarCargoTiendaAction   (lib/actions/wallet-tienda.ts)
        └─ CargoTiendaService.registrarCargo                          (lib/services/)
             ├─ UserRepository.obtenerCuentaTienda        ← R17: existe / rol / estado
             └─ runTransaction:
                  ├─ WalletTiendaMovimientoRepository.crearMovimientos(tx, [cargo])   ← R19/R20
                  ├─ [BLOQUE Q1] ICajaCargoTiendaPort.emitirIngresoDeCargo(tx, …)     ← R31-R34
                  └─ WalletTiendaMovimientoRepository.registrarCargoEnHistorial(tx, …) ← R27-R30
```

Las tres escrituras van dentro de **la misma** `$transaction`, abierta por el servicio (R26). Es
literalmente la forma de `LiquidacionService.registrarPagoTienda`
(`lib/services/LiquidacionService.ts:613-705`): guard de rol → `runTransaction` → ledger de la
tienda → puerto de la caja, más el registro de historial que ficha 362 añadió después.

---

## §1 — Modelo de datos

### §1.1 Lo que NO cambia

**No hay tabla nueva, ni columna nueva, ni RLS nueva.** El cargo es una fila de
`wallet_tienda_movimiento`, que ya tiene RLS habilitada sin policies (solo service role, patrón
`wallet_movimiento`/`cierre_dia`) desde `20260712170000_wallet_tienda_movimiento/migration.sql:74`.
`historial_accion` está en el mismo régimen.

La fila del cargo:

| columna | valor | por qué |
| --- | --- | --- |
| `tipo` | `debito` | el saldo de la tienda BAJA |
| `categoria` | `ajuste_debito` | ya existe en Prisma **y en Postgres** (`…/migration.sql:30`) y ya está en la rama `debito` del CHECK `wallet_tienda_movimiento_tipo_categoria_check` (`20260802120000_liquidacion_pago/migration.sql:135`) |
| `monto` | `Decimal(12,2)` construido desde el STRING | R18 |
| `origen_tipo` | `manual` | el valor ya existe en `wallet_origen_tipo` (`db/schema.prisma:1557`) |
| `origen_id` | `NULL` | R20; y con ello el cargo queda FUERA del índice único parcial → limitación N1 |
| `descripcion` | lo tecleado, recortado | R15 |
| `registrado_por` | `actor.usuarioId` | R19 |
| `fecha_movimiento` | omitida (default de la columna) o medianoche del día elegido | R21 |
| `id` | **generado por el servicio** | hace falta para R27 (entidad del historial) y para R33 |

`id` generado en el servicio con `randomUUID()` es el patrón de la ficha 334 en el libro de la caja
(`WalletService.registrarMovimientoManual`, `lib/services/WalletService.ts:242`), y el motivo es el
mismo: `createMany` sobre Postgres no devuelve los ids generados. Esto obliga a **añadir `id?:
string` a `CrearMovimientoTiendaInput`** (`lib/interfaces/repositories/IWalletTiendaMovimiento
Repository.ts:19`) y a propagarla en el `map` del repositorio con el mismo `...(m.id !== undefined ?
{ id: m.id } : {})` que ya usa `WalletMovimientoRepository.crearMovimientos:105`. Aditivo: los cinco
escritores actuales siguen cayendo en el `@default(uuid())`.

### §1.2 La ÚNICA migración, y es por el historial (no por el asiento)

**El asiento no necesita migración.** Lo comprobado: `ajuste_debito` está en el `CREATE TYPE` de
2026-07-12 y el CHECK de 2026-08-02 ya lo admite con `tipo = 'debito'`. Un `INSERT` del cargo pasa
hoy tal cual.

**El rastro sí.** `historial_accion_tipo` no tiene un tipo para esto y `historial_accion_entidad`
**no contiene `wallet_tienda_movimiento`** (`lib/types/historial-accion.ts:198-219`; el enum nació
con 17 valores y hoy tiene 20 tras la ficha 374).

`db/migrations/<ts>_historial_accion_cargo_tienda/migration.sql` — aditiva, sin tablas ni índices:

```sql
ALTER TYPE "historial_accion_tipo"    ADD VALUE IF NOT EXISTS 'cargo_tienda_registrado';
ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'wallet_tienda_movimiento';
```

**Dos entidades y no una:** `historial_accion_entidad` mapea 1:1 con tablas en sus 20 valores, y
`wallet_tienda_movimiento` es una tabla. Apuntar el rastro al `usuario` de la tienda ahorraría este
valor, pero dejaría la fila del historial sin poder señalar **qué asiento** se escribió, que es
exactamente lo que el índice `[entidad_tipo, entidad_id]` sirve.

`down.sql` — **recrea-con-lista, no dropea**. Comprobado cuál es la forma del down de estos dos
enums: el único que los dropea entero es `20260902120000_historial_accion`, que también los crea
entero; todos los posteriores recrean con lista. Plantilla exacta:
`20260907130000_historial_accion_zona_central_cambiada/down.sql` (para `historial_accion_tipo`) y
`20260906120100_historial_accion_nodo_geografico/down.sql` (para los dos a la vez).

- **La lista de `historial_accion_tipo`** = los **48** del `CREATE TYPE` de
  `20260907130000_historial_accion_zona_central_cambiada/down.sql` **MÁS** `'zona_central_cambiada'`,
  que es justo el valor que aquella migración añadió y que su propio down no podía listar. `ADD
  VALUE` sin `BEFORE`/`AFTER` apende, así que ése es el `enumsortorder` real. **49 en total.**
- **La lista de `historial_accion_entidad`** = los **17** del `CREATE TYPE` original de
  `20260902120000_historial_accion` **MÁS** `'provincia'`, `'canton'`, `'distrito'` (ficha 374, la
  única ampliación desde entonces). **20 en total.**
- Precondición ruidosa, escrita en el propio `down.sql`: ninguna fila con
  `accion = 'cargo_tienda_registrado'` ni con `entidad_tipo = 'wallet_tienda_movimiento'`. Si la
  hubiera, el `USING` del `ALTER COLUMN` falla y el rollback ABORTA. Es lo correcto: borrar el
  rastro de quién le cargó dinero a una tienda no es seguro.

**NINGÚN `down.sql` anterior se toca.** Son fotos históricas punto-en-el-tiempo (regla ya escrita en
`20260827120000_premio_ranking_devengo/down.sql:23-30`).

`db/schema.prisma`: los dos enums de historial ganan su valor con el comentario de la ficha, en el
mismo estilo que las fichas 374/375/376.

---

## §2 — Contrato de entrada (borde tipado)

`lib/types/wallet-tienda.ts` gana el schema. **Reutiliza, no reescribe**, las piezas que ya existen
en `lib/types/wallet.ts`: `montoPositivoSchema` (`:374`, valida el monto como STRING y lo compara
con `Prisma.Decimal`, nunca con `Number`) y `fechaMovimientoSchema` (`:431`, que delega en
`problemaDeFechaMovimiento` y por eso emite **el mismo texto** que ven los otros cuatro conceptos,
R16).

```ts
export const registrarCargoTiendaSchema = z
  .object({
    tiendaId: z.string().uuid(),
    monto: montoPositivoSchema,                       // STRING, > 0, ≤ 2 decimales (R14/R18)
    descripcion: z.string().trim().min(1, "La descripcion es obligatoria."),  // R15
    fecha: fechaMovimientoSchema.optional(),          // R16/R21
  })
  .strict();                                          // una clave colada no llega al servicio
```

`.strict()` es la barrera que `WalletTiendaService` ya declara para sus lecturas: ninguna clave
inventada puede ampliar el alcance.

**Salida** (`RegistrarCargoTiendaServiceResult`), money-safe (montos STRING):

```ts
| { status: "ok"; cargo: WalletTiendaMovimientoDTO; saldo: string }
| { status: "validation_error"; fieldErrors: Record<string, string[]> }
| { status: "forbidden" }
```

`saldo` es el saldo de la tienda DESPUÉS del cargo, derivado con `derivarSaldoTienda` —el mismo
helper que usa `LiquidacionService.restanteTrasAnular:1177-1179`—, para que el toast diga un número
real y no uno recalculado en el navegador. Puede venir negativo y se pinta entero: el precedente
está escrito en `PagoTiendaAcciones.tsx:70-77`.

---

## §3 — Rutas y superficie

**Ninguna ruta nueva.** Mutación interna ⇒ **Server Action**, nunca `fetch` a `/api`
(`docs/architecture.md`). Se añade a `lib/actions/wallet-tienda.ts`, que ya construye
`WalletTiendaService` con `WalletTiendaMovimientoRepository` y ya tiene el molde
`withErrorHandler` + `resolveActorFromSession` + `UnauthenticatedError` (R13).

```ts
export async function registrarCargoTiendaAction(
  input: unknown,
  deps: CargoTiendaActionDeps = {},
): Promise<RegistrarCargoTiendaActionResult>
```

El catálogo de tiendas del selector (R5) **no estrena nada**: `listarAdminTiendas`
(`lib/actions/usuarios-por-rol.ts:43`) ya devuelve `id`/`nombre` de las cuentas `adminTienda`
`activo` ordenadas por nombre, y ya autoriza a `maestro`/`admin`. Precedente de consumo idéntico:
`GenerarApiKeyForm.cargarTiendasDestino:49-56`.

**Diferencia deliberada con ese precedente (R6):** allí la tienda es OPCIONAL y el catálogo «se
degrada en silencio». Aquí es OBLIGATORIA, así que degradar en silencio dejaría un concepto que no se
puede usar y no dice por qué. El diálogo muestra el aviso y deshabilita el registro **solo para este
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

El problema es `categoria`: está tipada como categoría **de la caja**, y la del cargo
(`ajuste_debito`) es del ledger **de la tienda**. Y `nombreEnElLibro()` la resuelve con
`CATEGORIA_LABEL[concepto.categoria]`, que es el diccionario de la caja.

**Decisión:** la categoría **se muda dentro de `destino`**, donde cada clase la declara con su propio
tipo, y `nombreEnElLibro` pasa a resolverse por `destino.clase`.

```ts
export type DestinoConcepto =
  | { clase: "egreso_administrativo"; tipoEgreso: TipoEgresoManual; categoria: WalletMovimientoCategoria }
  | { clase: "ajuste_manual";         tipo: WalletMovimientoTipo;   categoria: WalletMovimientoCategoria }
  | { clase: "cargo_tienda";          categoria: WalletTiendaMovimientoCategoria };
```

Por qué así y no ensanchando `categoria` a la unión de las dos: con una `categoria` ancha,
`nombreEnElLibro` tendría que adivinar en qué diccionario buscar, y un concepto de caja con una
categoría de tienda **compilaría**. Con la categoría dentro del destino, la propiedad que la ficha
334 dejó escrita —«un concepto nuevo que olvidara declarar su destino no compila»— se extiende a
«…ni puede declarar una categoría del libro equivocado».

`nombreEnElLibro(concepto)` devuelve `CATEGORIA_TIENDA_LABEL[…]` para la clase `cargo_tienda` y
`CATEGORIA_LABEL[…]` para las otras dos (R4). `CATEGORIA_TIENDA_LABEL` se importa de
`app/(app)/mi-wallet/_components/mi-wallet-labels.ts`; el cruce entre módulos de rutas ya está
establecido — `wallet/tiendas/_components/desglose-tienda-labels.ts:20-27` re-exporta ese mismo
diccionario, y la razón escrita es que «es el mismo ledger y dos mapas paralelos divergirían».

El módulo sigue siendo **PURO**: sin React y sin leer ningún reloj.

---

## §5 — El servicio: `CargoTiendaService`

`lib/services/CargoTiendaService.ts` + `lib/interfaces/services/ICargoTiendaService.ts`.

**Por qué un servicio nuevo y no un método en `WalletTiendaService`.** Ese servicio es de LECTURA
—listados, saldos, desglose, cierres—, se construye hoy con un solo repositorio, y lo instancian
siete acciones y una decena de tests. Meterle una escritura le añadiría el repositorio de usuarios,
el puerto de la caja y el runner de transacciones al constructor, tocando a todos sus llamadores por
una razón que no es suya. `LiquidacionService` es el precedente contrario y explícito: las
escrituras de dinero viven en su propio servicio.

Constructor, con el criterio de inyección que `LiquidacionService.ts:241-256` dejó escrito —**sin
valores por defecto para lo que no puede degradar en silencio**—:

```ts
constructor(
  private readonly tiendaRepo: IWalletTiendaMovimientoRepository,
  private readonly usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
  private readonly runTransaction: CargoTiendaTxRunner,
  // [BLOQUE Q1] private readonly caja: ICajaCargoTiendaPort,
) {}
```

`registrarCargo(input, actor)`, y **el orden es parte del requisito**:

1. **Rol PRIMERO** (R12): `esAccesoTotal(actor.rol)` → `forbidden` **antes de tocar la base**. Mismo
   predicado y mismo motivo que `WalletService.registrarMovimientoManual:233` y que
   `LiquidacionService.registrarPagoTienda:617`: un `forbidden` evaluado después del `SELECT` ya
   habría leído el dinero para tirarlo. No se inventa permiso (decisión 2).
2. **Escala 2 fijada UNA vez** (R18): `new Prisma.Decimal(input.monto).toDecimalPlaces(2,
   ROUND_HALF_UP)` → `montoStr = .toFixed(2)`. Ese MISMO string va al asiento de la tienda, al
   ingreso de la caja y a la fila del historial. Ni un `Number()` en el camino. Es la lección medida
   de la feature 204 (14 de 66 órdenes con un céntimo de desviación al multiplicar en el navegador).
3. **La tienda, validada en el servidor** (R17): existe / `rol.value === "adminTienda"` /
   `estado === "activo"` → si no, `validation_error` con `fieldErrors.tiendaId`. Es literalmente el
   patrón de `ApiKeyService` (`lib/services/ApiKeyService.ts:44-58`, con sus tres mensajes
   separados: inexistente / rol / inactiva). Va **fuera** de la transacción: es una lectura de
   catálogo y no puede quedar obsoleta entre la comprobación y la escritura de forma que importe
   —lo peor que pasa es que la tienda se desactive un instante después, y eso no invalida un cargo
   ya decidido—.
4. **`id = randomUUID()`** (§1.1).
5. **`runTransaction`** con las tres escrituras (R26). El orden interno: ledger de la tienda →
   caja → historial. Es el de `LiquidacionService.registrarPagoTienda:662-688`, y el motivo escrito
   allí vale igual aquí: «que el libro de la tienda siga siendo el primero en cuadrar».
6. **Saldo de vuelta**, derivado con `derivarSaldoTienda` sobre `agregarSaldoPorTienda` (§2).

No hay candado de fila (`bloquearBeneficiario`). El pago a tienda lo necesita porque compara el
monto contra un disponible; **un cargo no compara nada contra nada** —no hay tope, la tienda puede
quedar en negativo, y el saldo se deriva—. Tomar un candado que no protege ninguna invariante sería
serializar escrituras por ceremonia.

---

## §6 — BLOQUE Q1: el espejo en la caja de Ordenex

> **Punto único de cambio.** Todo lo que depende de la respuesta a Q1 está en esta sección y en
> R31–R35. Si la respuesta es «no», se borran: el archivo del puerto, el archivo de su
> implementación, **una línea** del constructor de `CargoTiendaService`, **una llamada** dentro de su
> transacción, **una línea** del composition root de `lib/actions/wallet-tienda.ts`, y —si se eligió
> Q1.a con enlace— la mitad de la migración. Nada más de la ficha cambia.

### §6.1 El puerto

`lib/interfaces/services/ICajaCargoTiendaPort.ts`, calcado de `ICajaPagoTiendaFeedService`:

```ts
emitirIngresoDeCargo(tx: CajaTxClient, cargo: {
  cargoId: string; monto: string; descripcion: string;
  registradoPor: string; fechaMovimiento?: Date;
}): Promise<number>;
```

Implementación `lib/services/CajaCargoTiendaService.ts` → `WalletMovimientoRepository.crear
Movimientos(tx, [...])` con `tipo: "ingreso"`, `categoria: "ingreso_ajuste"`.

**Por qué `ingreso_ajuste` y no un concepto nuevo (R32).** `ingreso_ajuste` está declarado de
naturaleza **`propio`** —está en `WALLET_INGRESO_PROPIO_SEED` (`lib/types/wallet.ts:122-125`), las
siete categorías que componen la ganancia de Ordenex—, y eso es exactamente lo que un cargo a una
tienda ES: ingreso de la casa. Es el caso contrario al de la ficha 173, donde el reverso de un pago
NO podía ser `ingreso_ajuste` porque «convertiría una correccion administrativa en ₡X de ganancia
inventada» (`CajaPagoTiendaFeedService.ts:55-60`): allí el dinero era de terceros, aquí es propio.
Sin categoría nueva ⇒ sin migración de `wallet_movimiento_categoria`, y `ComposicionGananciaCard` y
la analítica financiera lo recogen sin tocar una línea.

**El puerto va SIN valor por defecto en el constructor.** Motivo escrito en
`LiquidacionService.ts:246-252` y confirmado por la cicatriz del *composition root que no inyecta*:
un puerto que degrada en silencio deja cargos sin su ingreso, con la suite en verde.

### §6.2 El enlace (Q1.a — pendiente de firma)

**Propuesta:** `origen_tipo = 'wallet_tienda_movimiento'`, `origen_id = <id del cargo>`.

- Respeta la convención del repo: `origen_tipo` **nombra la tabla** de `origen_id` (`cierre_dia`,
  `pago_tienda`, `orden_incidente`, `ranking_snapshot_fila`).
- Da **R35 gratis**: el índice único parcial `wallet_movimiento_origen_categoria_uq (origen_tipo,
  origen_id, categoria) WHERE origen_id IS NOT NULL` hace que dos cargos distintos (dos uuid) sean
  dos ingresos, y que un reintento del MISMO cargo no duplique.
- **Cuesta una migración más.** `ALTER TYPE "wallet_origen_tipo" ADD VALUE …` en el mismo
  `migration.sql`, y un `down.sql` que además recree `wallet_origen_tipo` recasteando **tres**
  tablas (`wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento`) y soltando y
  recreando **seis** índices. No es invención: está escrito, probado y copiable línea a línea en
  `20260827120000_premio_ranking_devengo/down.sql:45-107`, con el aviso de por qué olvidar una tabla
  aborta el rollback a mitad.

**Alternativa barata:** `origen_tipo = 'manual'`, `origen_id = NULL`, como el ajuste manual de caja
de hoy. Cero migración. **Descartada por el diseño, pendiente de que el humano la confirme o la
tumbe:** en la caja nadie podría distinguir un cargo a tienda de un ajuste manual cualquiera, no
habría forma de cuadrar «Σ cargos manuales a tiendas» contra «Σ ingresos por cargo», y R35 se
quedaría sin red.

**Tercera vía, descartada sin preguntar:** `origen_tipo = 'manual'` con `origen_id` no nulo apuntando
al cargo. Da el enlace sin migración, pero rompe la convención (el `origen_tipo` dejaría de nombrar
la tabla de `origen_id`) y contradice el comentario del esquema —«`manual` = ajuste del maestro
(origen_id NULL)», `db/schema.prisma:1552`—. Ahorrar una migración a cambio de que un enum mienta no
es un ahorro en un repo cuya disciplina es justamente ésa.

---

## §7 — El rastro en `historial_accion`

**Decisión: SÍ deja rastro, y no basta con `registrado_por`.**

El criterio no lo inventa esta ficha: la ficha 362 lo dejó escrito en
`WalletMovimientoRepository.crearMovimientoRegistrado:122-135` — «se registra la DECISIÓN, no sus
asientos». Los asientos automáticos (los ~34 que emite aprobar un cierre) NO se registran; los tres
que nacen de una decisión humana sobre el dinero de la casa SÍ. Un cargo manual a una tienda es
exactamente ese género: alguien decide, a mano, que una tienda debe más dinero. La columna
`registrado_por` dice **quién**, pero vive en un ledger que la pantalla de historial no lee, no se
puede filtrar por «lo que movió dinero» y no aparece junto a las otras 48 acciones auditadas.

**Cómo, con la forma que la guardia acepta.** `tests/unit/guards/
historial-accion-escrituras-cubiertas.guardia.test.ts` exige, por cada tipo del catálogo, un
productor real en un CENSO cerrado y una de dos formas de atomicidad. Se usa **`recibe_tx`**, que es
la fuerte —«la atomicidad es del TIPO, no de la disciplina»—:

`WalletTiendaMovimientoRepository.registrarCargoEnHistorial(tx, { cargoId, tiendaId, monto,
actorUsuarioId })` recibe la transacción como primer parámetro, lee el nombre de la tienda **dentro**
de ella para congelar la etiqueta, y llama a `appendAccion`. Es la forma exacta de
`RankingSnapshotRepository.registrarAccionSobreFila` (censo, forma `recibe_tx`, mutación
`tx.rankingSnapshotFila.findUnique(`); aquí la mutación que la guardia comprueba será
`tx.usuario.findUnique(`.

La fila:

| campo | valor |
| --- | --- |
| `accion` | `cargo_tienda_registrado` |
| `entidadTipo` | `wallet_tienda_movimiento` |
| `entidadId` | el id del cargo |
| `entidadEtiqueta` | `etiquetaDeEntidad("wallet_tienda_movimiento", { tiendaNombre })` |
| `monto` | `new Prisma.Decimal(montoStr)` — STRING → Decimal, sin `Number()` (R18) |
| actor | `resolverActorCongelado(tx, actorUsuarioId)` |

`lib/types/historial-accion-etiquetas.ts` gana la clave `wallet_tienda_movimiento: { tiendaNombre:
string | null }` y su resolvedor `(f) => unir(f?.tiendaNombre)`. **El nombre de la tienda cabe bajo
R5 de la 362** (nada de PII ni texto libre por transacción): es una etiqueta de catálogo, del mismo
género que `liquidacion_pago: { beneficiarioNombre }`, que ya se usa **para tiendas**. Lo que NO
entra es la `descripcion` del cargo: es texto libre tecleado por una persona (R30) — el mismo
razonamiento por el que `wallet_movimiento` se etiqueta por su categoría y no por su descripción
(`historial-accion-etiquetas.ts:89-93`).

`CATEGORIA_POR_ACCION.cargo_tienda_registrado = "mueve_dinero"` (R28) y
`ACCION_LABELS.cargo_tienda_registrado = "Cargó un costo a una tienda"`. Los dos `Record` son
exhaustivos por tipo: olvidar uno no compila.

---

## §8 — La pantalla

`RegistrarMovimientoCajaDialog.tsx`:

- **Un campo condicional**, no un diálogo nuevo (R2/R3). `concepto.destino.clase === "cargo_tienda"`
  monta un `Select` de tienda; en los otros cuatro conceptos no se monta ni se envía nada (R3 es
  testeable justamente porque el payload de los otros cuatro no debe ganar ni una clave).
- **El enrutado sigue siendo por clase**, con una tercera rama en `registrar()`. Un `if` sobre el id
  del concepto sería lo que la ficha 334 prohibió por escrito.
- **`reset()`** limpia también la tienda elegida (el diálogo arranca en el primer concepto, que no es
  el cargo).
- **R4:** el texto «Se registra en el libro como «…»» pasa a nombrar además **de qué libro** habla —
  el de la tienda, y (bloque Q1) el de la caja—. El título estático «Registrar movimiento en la
  caja» deja de ser cierto para este concepto y se ajusta.
- **R8** ya está resuelto y no se reimplementa: `components/shared/Modal.tsx` bloquea el segundo
  envío con `pendingRef` antes de que React re-renderice (su propio R17). Aquí solo se comprueba.
- **R9:** `onRegistrado?.()` + `router.refresh()`, exactamente como los cuatro conceptos actuales.
- **R6:** si `listarAdminTiendas` no devuelve `ok`, el selector queda vacío y **el registro del
  cargo** deshabilitado con un mensaje; los otros cuatro conceptos siguen registrándose.

`WalletModule.tsx` no cambia: sigue montando el mismo diálogo con el mismo `onRegistrado`.

**Nada que tocar aguas abajo** (R24/R25/R34): `desglose-tienda.ts:45` ya manda `ajuste_debito` a
`cargos`, `CATEGORIA_TIENDA_LABEL:86` ya lo etiqueta, `ORIGEN_TIENDA_LABEL:93` ya traduce `manual`
como «Manual», `CATEGORIA_TIENDA_OPTIONS` ya lo ofrece como filtro (se puebla desde el SEED) y
`aporte-por-orden.ts:104` ya lo declara `sin_reparto` con motivo `no_nace_de_un_cierre`, así que
abrir su detalle responde bien en vez de buscar un cierre inexistente. Ésta es la mitad barata de la
ficha, y es barata porque la 43 dejó el hueco hecho.

---

## §9 — Alternativas descartadas

### §9-A — Un botón «cobrar» en `/wallet/tiendas`, junto al de pagar

**Es la superficie más natural** y la más barata: `PagoTiendaAcciones.tsx` ya vive dentro del
desglose de UNA tienda, así que la tienda no habría que preguntarla —viene del contexto— y R5, R6,
R7 y R17 desaparecerían casi enteros. Además el refresco dirigido (`claveDesgloseTienda` +
`clavePagosDeTienda`) ya está resuelto ahí.

**Descartada porque no es lo que se pidió.** El encargo nombra el botón: «desde el botón de registrar
movimiento». Elegir la otra superficie por comodidad de implementación sería entregar otra cosa.
Queda anotada como la evolución obvia si el humano la prefiere: el servicio, la action y el schema de
esta ficha valdrían **tal cual**, y solo cambiaría quién los llama.

### §9-B — Unificar el backend de los cinco conceptos en una sola Server Action

Descartada, y no por gusto: el propio `wallet-conceptos-manuales.ts:18-21` dejó escrito por qué no se
hizo con los cuatro actuales — `origen_tipo` decide qué es reversable, y fusionarlos «volvería
reversables los ajustes, un cambio en dinero que nadie pidió». Con el quinto el argumento es aún más
fuerte: escribe en **otra tabla**.

### §9-C — Emitir el IVA del cargo como un movimiento aparte

Descartada (decisión 3 de `requirements.md`, R23). Los seis débitos automáticos llevan sus tres IVA
como movimientos separados porque **se derivan de una tarifa** con un porcentaje configurado
(`resolverFlete`/`derivarIngresoOrden`). Un cargo manual no tiene tarifa detrás: es un importe que
alguien decide, y ese importe es el que se cobra. Inventarle un IVA obligaría a elegir una tasa que
nadie declaró.

### §9-D — Reusar el tipo de historial `wallet_movimiento_manual_registrado`

Descartada. Ahorraría la migración entera, pero su etiqueta dice «Registró un movimiento manual de
**caja**» (`lib/types/historial-accion.ts:306`) y su productor censado es
`WalletMovimientoRepository.crearMovimientoRegistrado`. Reusarlo pondría en el historial una frase
falsa y rompería la guardia del censo, que exige que el tipo lo escriba el método declarado.

### §9-E — No dejar rastro y confiar en `registrado_por`

Descartada (§7). El coste de auditar de más es este `ALTER TYPE`; el de no auditar y necesitarlo
después es **irrecuperable**, porque el pasado no se reconstruye. Es el mismo razonamiento, palabra
por palabra, con el que la ficha 374 justificó su ampliación del catálogo.

---

## §10 — Verificación: dónde vive cada cosa

- **Los tests de servicio usan dobles y no ven el SQL.** Lo que viva en un `WHERE`, en un CHECK o en
  una transacción se prueba contra Postgres real en `tests/integration/db/` — lección medida cuatro
  veces en este repo. Aquí eso son: que el `INSERT` del cargo pase el CHECK `tipo`/`categoria`, que
  el cargo baje el saldo derivado, que el fallo de cualquiera de las tres escrituras no deje
  ninguna (R26), y que la migración de los enums y su `down.sql` sean exactos.
- **La migración se prueba con su test de migración**, reconstruyendo el estado previo ejecutando las
  migraciones REALES anteriores y comparando valor a valor y en orden: es lo que hace
  `tests/integration/db/historial-accion-zona-central-migration.test.ts` y por qué su `down.sql`
  puede decir «no se fía de esta frase».
- **El gate.** Este diff toca `db/schema.prisma`, `lib/types/` y una migración: `./init.sh --rapido`
  **se niega solo** y manda al completo. No es un aviso, es un `fail` (`CLAUDE.md`, regla 5).
- **Base local compartida:** aplicar esta migración en la base local pone rojo el gate de otras
  ramas que aún no la tienen. Coordinar antes de `prisma migrate deploy`.
