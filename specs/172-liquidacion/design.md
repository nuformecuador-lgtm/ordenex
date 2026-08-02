# Feature 172 — Liquidación: pagar cuentas por pagar de mensajeros y saldos de tiendas · design

> Decisiones técnicas antes de escribir código. Todo lo que aquí se afirma del estado actual
> está verificado contra el árbol (archivo y línea) y listado en
> `requirements.md § Estado del arte`. **Money-critical:** `Prisma.Decimal` en todo cálculo,
> STRING `toFixed(2)` en la frontera, cero `parseFloat`/`Number(` sobre montos.
> Patrón de capas Controller → Service → Repository con interfaces (`docs/architecture.md`).

---

## 1. Principio rector: el pago es un DOCUMENTO; el saldo lo sigue derivando el libro

Los dos libros (`wallet_tienda_movimiento`, `pago_mensajero_movimiento`) son append-only y el
saldo se **deriva** de ellos. Esta feature no cambia eso. Lo que añade es la pieza que hoy no
existe: **el pago como documento propio** —monto, método, referencia, nota, fecha real, actor,
instante de registro— del que *nace* exactamente un movimiento en el libro del beneficiario.

De ahí salen las tres decisiones estructurales:

1. **Tabla nueva `liquidacion_pago`** para el documento. No columnas nuevas en los libros (§10.B).
2. **El movimiento del libro apunta al pago**, usando los `origen_tipo` que la 42 dejó
   reservados: `pago_mensajero` y `pago_tienda`, con `origen_id = <id del pago>`. Así el índice
   único parcial que ya existe en los dos libros da idempotencia **sin migración de índice** y
   **sin bloquear pagos parciales** (§4).
3. **Aprobar y pagar son dos escrituras distintas**, no una transacción compartida (§7).

---

## 2. Modelo de datos

### 2.1 Tabla `liquidacion_pago` (modelo Prisma `LiquidacionPago`)

```prisma
model LiquidacionPago {
  id                 String          @id @default(uuid())
  claveIdempotencia  String          @unique @map("clave_idempotencia") // §4.1
  mensajeroId        String?         @map("mensajero_id")  // FK -> usuario (rol mensajero)
  tiendaId           String?         @map("tienda_id")     // FK -> usuario (rol adminTienda)
  cierreId           String?         @map("cierre_id")     // FK -> cierre_dia; NOT NULL sii es a mensajero
  monto              Decimal         @db.Decimal(12, 2)    // > 0
  metodo             MetodoPagoValue                        // enum EXISTENTE (feature 36)
  referencia         String?
  nota               String?
  fechaPago          DateTime        @map("fecha_pago") @db.Date // fecha REAL del pago
  registradoPor      String          @map("registrado_por") // FK -> usuario (actor); NOT NULL
  createdAt          DateTime        @default(now()) @map("created_at") // instante de REGISTRO
  // SIN updatedAt / deletedAt: fila INMUTABLE, igual que los libros.

  mensajero   Usuario?  @relation("LiquidacionPagoMensajero", fields: [mensajeroId], references: [id])
  tienda      Usuario?  @relation("LiquidacionPagoTienda",    fields: [tiendaId],    references: [id])
  cierre      CierreDia? @relation(fields: [cierreId], references: [id])
  registrador Usuario   @relation("LiquidacionPagoRegistrador", fields: [registradoPor], references: [id])

  @@index([mensajeroId, fechaPago])
  @@index([tiendaId, fechaPago])
  @@index([cierreId])                  // pendiente por cierre (§5) y lista de pagos del cierre
  @@map("liquidacion_pago")
}
```

**Por qué dos columnas nullables y no un discriminador.** `mensajero_id` y `tienda_id` apuntan
las dos a `usuario` (igual que `wallet_tienda_movimiento.tienda_id` y
`pago_mensajero_movimiento.mensajero_id`), así que un enum `beneficiario_tipo` + un
`beneficiario_id` genérico daría **menos** integridad referencial y un enum nuevo a mantener. Con
dos FK reales + un `CHECK` XOR, la base garantiza que hay exactamente un beneficiario. El
precedente exacto está en el repo: `notificacion` usa
`CHECK (("destinatario_rol" IS NULL) <> ("destinatario_usuario_id" IS NULL))`
(`db/migrations/20260727120000_notificacion/migration.sql:53`).

**`metodo` reutiliza `metodo_pago_value`** (`efectivo | SINPE | transferencia`,
`db/schema.prisma:628-634`): son exactamente los tres que pidió el humano. No se crea enum, no
se toca ningún `down.sql` previo (la trampa de «enum nuevo ⇒ actualizar los down.sql anteriores»
no aplica porque no se añade ningún **valor** a un enum existente).

**`registrado_por` es NOT NULL** —a diferencia de los libros, donde es nullable porque el feed
del cierre escribe sin actor—: un pago siempre lo registra alguien, y esa es media trazabilidad.
Su FK va `ON DELETE RESTRICT`: borrar al usuario que registró pagos dejaría el comprobante
huérfano.

**`fecha_pago` es `@db.Date`**, con la convención del repo para fechas calendario
(`fecha_reprogramacion`, feature 36/46): se almacena como medianoche UTC del día. `created_at` es
el instante de registro. Los dos existen siempre y pueden diferir (R8).

### 2.2 Restricciones de la tabla nueva

```sql
-- exactamente un beneficiario
CONSTRAINT liquidacion_pago_beneficiario_check
  CHECK (("mensajero_id" IS NULL) <> ("tienda_id" IS NULL)),
-- el cierre acompaña al mensajero y solo a el (decision 2 y 4 del humano)
CONSTRAINT liquidacion_pago_cierre_check
  CHECK (("mensajero_id" IS NULL) = ("cierre_id" IS NULL)),
-- dinero positivo (el signo lo da la categoria del movimiento, como en los libros)
CONSTRAINT liquidacion_pago_monto_check CHECK ("monto" > 0)
```

`clave_idempotencia` va con `UNIQUE` (índice propio) — es la barrera del doble pago (§4).

RLS: `ALTER TABLE "liquidacion_pago" ENABLE ROW LEVEL SECURITY;` **sin políticas**, patrón «solo
service role» de `wallet_movimiento` / `wallet_tienda_movimiento` / `pago_mensajero_movimiento` /
`cierre_dia` (R60).

### 2.3 El CHECK `categoria` ↔ `tipo` de los dos libros (condición heredada)

Va en **esta** migración, no como follow-up: la 172 es el **segundo escritor** de los dos libros
y ahí es donde el invariante deja de tener un solo guardián
(`progress/review_171-desglose-por-tienda.md:270-275`).

```sql
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito'))
  OR
  ("tipo" = 'debito'  AND "categoria" IN ('flete','flete_devolucion','comision_cod',
     'iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito'))
);

ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'devengo' AND "categoria" IN ('pago_devengado','ajuste_devengo'))
  OR
  ("tipo" = 'pago'    AND "categoria" IN ('pago_efectivo','liquidacion','ajuste_pago'))
);
```

Tres propiedades deliberadas:

- **Falla cerrado (R58).** La forma es una disyunción de listas cerradas, no una negación: un
  valor nuevo del enum que nadie clasifique **no casa ninguna rama** y el INSERT es rechazado.
  Es ruidoso a propósito: preferimos que la feature que añada el concepto tenga que tocar el
  CHECK a que su primera fila caiga en la cubeta equivocada y descuadre un saldo.
- **Cubre el hueco exacto que describe el review**: una fila `pago_tienda` + `credito` haría que
  la tabla de saldos y el desglose de la 171 mostraran cifras distintas para la misma tienda.
- **Valida los datos existentes al aplicarse.** `ADD CONSTRAINT ... CHECK` sin `NOT VALID`
  recorre la tabla; si hubiera una fila incoherente en producción, **la migración falla y el
  despliegue se cae** (y en Vercel el build migra antes de compilar, así que sería un despliegue
  bloqueado). De ahí R59 y la task T A.0: **verificar antes** contra cada base con el MCP de
  Supabase que no hay ninguna fila que la incumpla. Con el volumen medido (35 movimientos de
  caja, 6 cierres) el recorrido es instantáneo y no hace falta `NOT VALID` + `VALIDATE`.

### 2.4 Ampliación mínima de los contratos de escritura de los libros

Los dos `Crear*Input` **no exponen `fechaMovimiento`** hoy
(`IPagoMensajeroMovimientoRepository.ts:19-28`, `IWalletTiendaMovimientoRepository.ts:19-28`),
aunque la columna existe con `DEFAULT CURRENT_TIMESTAMP`. Se añade como campo **opcional**
(`fechaMovimiento?: Date`) y las implementaciones lo pasan solo si viene: el feed del cierre
sigue sin pasarlo y su comportamiento no cambia ni un byte.

**Trampa de fechas, resuelta y declarada.** El movimiento del pago se fecha con la **medianoche
UTC del día de `fecha_pago`** (`${YYYY-MM-DD}T00:00:00.000Z`), no con
`inicioDelDiaCREnUtc` (06:00Z). Motivo: los filtros de rango de los dos desgloses usan
`z.coerce.date()` sobre `YYYY-MM-DD`, que produce medianoche UTC, y comparan
`fecha_movimiento >= desde` / `<= hasta`. Con 06:00Z, un pago quedaría **fuera** de su propio día
al filtrar por `hasta`. Con medianoche UTC entra por los dos lados. Consecuencia cosmética
aceptada: un pago registrado hoy ordena antes que los movimientos del cierre de hoy (00:00 <
14:32) dentro del mismo día.

### 2.5 Migración

`db/migrations/<timestamp>_liquidacion_pago/`

- **`migration.sql` (UP):** `CREATE TABLE liquidacion_pago` con sus 3 CHECK, la FK a `cierre_dia`
  y las 3 FK a `usuario`; `CREATE UNIQUE INDEX` de `clave_idempotencia`; los 3 índices; `ENABLE
  ROW LEVEL SECURITY`; y los **2 `ADD CONSTRAINT ... CHECK`** de §2.3. No crea ningún tipo nuevo.
- **`down.sql` (DOWN):** `DROP TABLE liquidacion_pago` (arrastra sus CHECK, índices y FK) +
  `ALTER TABLE ... DROP CONSTRAINT` de los dos CHECK de los libros. No toca enums (no creó
  ninguno). Reversible (R61).
- **Aditiva (R61):** ni una fila existente se reescribe; los libros solo ganan una restricción.

---

## 3. Capas y archivos

### 3.1 Backend

| Archivo | Qué |
| --- | --- |
| `lib/types/liquidacion.ts` | DTOs + schemas zod del borde. Montos STRING. `satisfies` contra los enums Prisma. |
| `lib/utils/pendiente-cierre.ts` | `derivarPendienteCierre(P, E, pagado)` **pura** → STRING. Reusa `calcularSplitPago` (fuente única de `min(P,E)`, feature 44) y le resta lo ya pagado. |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` | `crear(tx, input)`, `sumarPorCierre(cierreIds)`, `sumarPorTienda(tiendaId)`, `listarPorCierre(cierreId)`, `listarPorTienda(tiendaId)`, `obtenerPorClave(clave)`. |
| `lib/repositories/LiquidacionPagoRepository.ts` | Implementación (solo Prisma). |
| `lib/interfaces/services/ILiquidacionService.ts` | `registrarPagoMensajero(input, actor)`, `registrarPagoTienda(input, actor)`, `listarPagosDeCierre(cierreId, actor)`, `listarPagosDeTienda(tiendaId, actor)`. |
| `lib/services/LiquidacionService.ts` | Toda la lógica: guardia de rol, validaciones de dominio, derivación del pendiente/saldo, composición del movimiento y orquestación de la transacción. |
| `lib/actions/liquidacion.ts` | 4 Server Actions (`'use server'`), molde de `lib/actions/wallet-egresos.ts`. |

**Un solo servicio para los dos pagos**, no dos. El 80 % es idéntico (permisos, validación del
documento, idempotencia, atomicidad) y lo que difiere son dos funciones: *contra qué se compara
el monto* y *en qué libro se escribe*. Dos servicios serían dos copias del camino money-critical.

### 3.2 Contratos I/O (frontera Server Action → cliente)

```ts
export type MetodoLiquidacion = "efectivo" | "SINPE" | "transferencia"; // METODO_PAGO_SEED

export type RegistrarPagoMensajeroInput = {
  claveIdempotencia: string;   // uuid generado por el cliente al ABRIR el formulario (§4.1)
  cierreId: string;            // uuid; el pago va SIEMPRE atado a un cierre aprobado (R19)
  monto: string;               // STRING 2 dec, > 0 (montoPositivoSchema + tope de columna)
  metodo: MetodoLiquidacion;
  referencia?: string;         // obligatoria si metodo != efectivo  [P6]
  nota?: string;               // <= LIQUIDACION_NOTA_MAX
  fechaPago: string;           // "YYYY-MM-DD", no futura en hora de Costa Rica
};

export type RegistrarPagoTiendaInput = Omit<RegistrarPagoMensajeroInput, "cierreId"> & {
  tiendaId: string;            // NO lleva cierre: contra saldo acumulado (decision 4)
};

export type PagoRegistradoDTO = {
  id: string;
  monto: string;               // STRING 2 dec
  metodo: MetodoLiquidacion;
  referencia: string | null;
  nota: string | null;
  fechaPago: string;           // "YYYY-MM-DD"
  registradoPorNombre: string; // NOMBRE, no id (R54)
  registradoAt: string;        // ISO — instante de registro
};

export type RegistrarPagoResult =
  | { status: "ok"; pago: PagoRegistradoDTO; restante: string }        // restante = lo que queda debiendo
  | { status: "ya_registrado"; pago: PagoRegistradoDTO; restante: string } // idempotencia (R41/R45)
  | { status: "excede"; disponible: string }                            // [P1]
  | { status: "sin_saldo" }                                             // nada que pagar (R30)
  | { status: "cierre_no_aprobado" }                                    // R18
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
```

Ningún `number` cruza la frontera. `PagoRegistradoDTO` **no** emite `mensajeroId`, `tiendaId`,
`cierreId`, `registradoPor` ni la clave de idempotencia: son identificadores internos y la
guardia de columnas de descarga los rechaza (R54).

### 3.3 El acto de registrar, paso a paso

```
registrarPagoTienda(input, actor):
  1. esAccesoTotal(actor.rol) ? seguir : forbidden                 // R1/R2, ANTES de tocar datos
  2. zod ya validó forma, monto, fecha no futura y referencia      // R7-R12 (borde)
  3. $transaction:
       a. bloqueo de serialización del beneficiario                // R44, solo si P1 = rechazar
       b. saldo = derivarSaldoTienda(repo.agregarSaldoPorTienda(tiendaId))
       c. saldo <= 0            -> sin_saldo                        // R30
          monto  >  saldo       -> excede { disponible: saldo }     // R29
       d. pago = liquidacionRepo.crear(tx, {...})                   // UNIQUE clave -> conflicto
          si conflicto          -> ya_registrado (relee por clave)  // R41/R45
       e. walletTiendaMovimientoRepo.crearMovimientos(tx, [{
            tiendaId, tipo:"debito", categoria:"pago_tienda", monto,
            origenTipo:"pago_tienda", origenId: pago.id,
            descripcion: descripcionDePago(metodo, referencia),
            registradoPor: actor.usuarioId,
            fechaMovimiento: medianocheUtcDe(fechaPago) }])          // R34/R35/R36
  4. devuelve ok + restante                                          // R37 atómico
```

`registrarPagoMensajero` es el mismo esqueleto cambiando (b)/(c) por el pendiente del cierre
(§5) y (e) por `{ tipo:"pago", categoria:"liquidacion", origenTipo:"pago_mensajero" }`, más una
guardia previa: el cierre debe existir y estar **`aprobado`** (R18), leído dentro de la misma
transacción.

`descripcionDePago(metodo, referencia)` es una función pura que compone `"SINPE · 1234567"`. Es
**denormalización deliberada**: sin ella la línea del libro diría solo «Pago al mensajero» y para
saber cómo se pagó habría que abrir otra lista. El dato canónico sigue siendo el de
`liquidacion_pago`; el del libro es una copia de lectura. Un test fija que la descripción **no**
lleva la nota (texto libre, puede ser largo y personal) ni ningún id.

---

## 4. Idempotencia y doble pago (R41–R46)

### 4.1 La clave: `clave_idempotencia` con `UNIQUE`

El cliente genera un **uuid al ABRIR el formulario** de pago y lo manda con la solicitud. La
columna es `UNIQUE`, así que:

- **Doble submit / doble clic / reintento tras timeout** → la segunda inserción viola el UNIQUE
  → el servicio relee el pago por esa clave y devuelve `ya_registrado` con el **mismo**
  `PagoRegistradoDTO`. Cero filas nuevas, cero saldo saldado dos veces (R41/R45).
- **Dos pagos legítimos idénticos** (dos veces ₡5 000 en efectivo el mismo día) → dos aperturas
  del formulario, dos claves, dos pagos (R43). Una clave natural
  `(beneficiario, monto, método, fecha)` habría bloqueado el segundo: descartada (§10.C).
- La clave **no cambia entre reintentos del mismo pago** y **se renueva** tras un registro
  exitoso. Es un requisito del cliente y se testea en el componente.

La protección es **de datos** (R42): no hay `SELECT` previo que decida si insertar. El
`origen_id = pago.id` en el movimiento hereda además la idempotencia del índice único parcial
que ya existe en los dos libros: aunque alguien llamara dos veces al repositorio con el mismo
pago, `skipDuplicates` lo convierte en no-op.

### 4.2 Concurrencia: dos pagos a la vez del mismo beneficiario

Solo importa si P1 = *rechazar el exceso*. Con `READ COMMITTED` (el default de Prisma), dos
transacciones simultáneas leerían el mismo saldo, las dos pasarían la comprobación y entre las
dos se pagaría de más. Se serializa por beneficiario dentro de la transacción, antes de leer el
saldo:

```sql
SELECT id FROM usuario WHERE id = $1 FOR UPDATE
```

Un candado por beneficiario, tomado siempre en el mismo punto y liberado al cerrar la
transacción: no hay dos recursos que ordenar, así que no hay interbloqueo posible. Precedente de
guardia anti-TOCTOU con SQL crudo en el repo: feature 41/R23
(`lib/repositories/OrdenRepository.ts:132`). Se testea con un doble que simula la carrera.

Si el humano elige *permitir el exceso* (P1-b), este candado **sobra** y se retira: sin
comprobación de tope no hay carrera que perder.

---

## 5. El pendiente de un cierre, derivado

```
pendienteDelCierre = calcularSplitPago(P, E).pendiente − Σ liquidacion_pago.monto WHERE cierre_id = X
                     └────────── feature 44, ya congelado ─────────┘   └──── una agregación ────┘
```

`P` y `E` son columnas del propio `cierre_dia` (`total_pago_mensajero`, `total_efectivo`), así
que **no hace falta tocar el libro** para saber cuánto falta: una lectura del cierre (que la
pantalla ya hace) más un `groupBy` por `cierre_id` sobre la tabla nueva, indexado.

Dos consecuencias:

- **Listado de cierres (R24):** una sola llamada `sumarPorCierre(ids de la página)` añade el
  pendiente a las filas ya paginadas. `CierreAdminResumen` gana
  `pendientePagoMensajero: string | null` (`null` = el cierre no está aprobado, R26); lo rellena
  el servicio, no el repositorio, y `toResumen` sigue sin recomputar dinero.
- **Invariante testeable:** `Σ liquidacion_pago.monto de un cierre` debe ser igual a
  `Σ movimientos liquidacion` cuyo `origen_id` sea uno de esos pagos. Es la contraprueba de que
  el documento y el libro no divergen, y se testea con montos reales.

**El filtro por cierre del desglose del mensajero (R50).** Hoy filtra
`origen_tipo='cierre_dia' AND origen_id=<cierre>`
(`PagoMensajeroMovimientoRepository.ts:42-55`), así que el movimiento de una liquidación —cuyo
origen es el **pago**— quedaría fuera de su propio cierre. Se corrige en dos pasos dentro del
repositorio: leer los ids de pago de ese cierre (0–3 filas, índice `cierre_id`) y construir
`OR [ {cierre_dia, cierreId}, {pago_mensajero, origenId IN pagos} ]`. Sin esto, filtrar por
cierre escondería justamente lo que el humano quiere ver.

---

## 6. Alcance por rol, explícito

| Rol | Registrar pago a mensajero | Registrar pago a tienda | Ver los pagos registrados |
| --- | --- | --- | --- |
| `maestro` | **sí** | **sí** | sí |
| `admin` | **sí** `[P3]` | **sí** `[P3]` | sí |
| `adminSatelite` | **no** `[P3]` | **no** | no (su detalle de cierre no muestra la sección) |
| `adminTienda` | no | **no**, ni siquiera para su propia tienda (R2) | solo lo suyo, en `/mi-wallet` |
| `mensajero` | no | no | solo lo suyo, en `/mis-pagos` |
| sin sesión | no (R3) | no (R3) | no |

**Contraprueba obligatoria** en los tests (precedente 171/R28): `adminTienda` pidiendo **su
propio** `tiendaId` recibe `forbidden`, no datos; `adminSatelite` aprobando un cierre de su zona
recibe la aprobación **sin** oferta de pago y su intento directo contra la acción recibe
`forbidden`. Sin la contraprueba, un guard mal escrito pasa desapercibido.

---

## 7. Enganche con la aprobación del cierre: dos pasos de verdad

**Decisión: el pago NO viaja dentro de la transacción de aprobación.** Es la traducción técnica
de la decisión 3 del humano, y no es un detalle:

- Si compartieran transacción, **un fallo al registrar el pago haría rollback de la aprobación**
  (así funciona hoy el bloque de `resolverCierre`, `CierresAdminRepository.ts:510-714`). El
  cierre volvería a `solicitado`, que es estado **bloqueante**
  (`OrdenRepository.ts:136-140`): el mensajero se quedaría sin poder trabajar al día siguiente
  por un problema administrativo ajeno a él. Es exactamente lo que el humano descartó.
- Con dos escrituras: se aprueba (el mensajero queda libre), y el pago se registra después. Si
  falla, el resultado es «cierre aprobado, deuda abierta y visible» — el estado que el humano
  pidió.

Flujo de pantalla (`CierresAdminModule`), calcado del sub-modal de la 158:

```
[Aprobar] ─► (si hay incidentes) sub-modal de indemnizaciones ─► aprobarCierre()
                                                                   │ ok + pendientePagoMensajero
                                                                   ▼
                                        pendiente > 0 y actor puede pagar ?
                                          │ sí                        │ no
                                          ▼                           ▼
                            sub-modal «Registrar el pago»          cerrar (como hoy)
                            [Registrar]        [Ahora no]
                                 │                   │
                       registrarPagoMensajero    cierre aprobado con deuda visible (R24)
```

`AprobarCierreServiceResult.ok` gana `pendientePagoMensajero: string`, calculado en el servidor
(R13: la UI no hace aritmética con dinero). Es aditivo: el resto del contrato de la 38/158 no
cambia. **«Ahora no» no es un estado**: no se persiste nada, y el pendiente se vuelve a derivar
cada vez que alguien mira el cierre.

Segundo camino (R17): el detalle de un cierre **ya aprobado** —al que se llega con el botón «Ver»
del histórico, `CierresAdminModule.tsx:606-648`— muestra la sección «Pago al mensajero» con el
pendiente, la lista de pagos registrados y el botón de registrar. Es el mismo sub-modal.

---

## 8. Efecto en la caja principal: lo que hace la 172 y lo que le deja a la 173

| Flujo | Caja principal hoy | Qué hace la 172 |
| --- | --- | --- |
| Aprobar cierre | `egreso_pago_mensajero = P` (el **costo total** del pago al mensajero) | nada: ya está |
| Liquidar a un mensajero | — | **nada**. El costo ya se cargó al aprobar; volver a emitir sería doble conteo. El propio código lo declara: `WalletMensajeroFeedService.ts:19-21` |
| COD recaudado | **no entra** en la caja (es crédito de la tienda, no ingreso de Ordenex) | nada |
| Pagar a una tienda | — | **nada** `[P2]`. Emitir `egreso_pago_tienda` restaría de la caja un dinero que nunca entró: el balance —que hoy se lee como ganancia— se hundiría por una feature que solo debía registrar un pago |

**Lo que la 172 le deja preparado a la 173** (sin invadirla): el pago a la tienda ya es una fila
con id propio, así que el día que la caja pase a tesorería, la 173 emite
`{ tipo:"egreso", categoria:"egreso_pago_tienda", origenTipo:"pago_tienda", origenId:<pago.id> }`
y la idempotencia se la da **gratis** el índice único parcial `(origen_tipo, origen_id,
categoria)` que la 42 ya tiene. Ni una decisión de la 173 queda tomada aquí.

---

## 9. Frontend

### 9.1 Tienda — `/wallet/tiendas`

La 171 dejó los dos enganches montados y sin usar:

- `SaldosTiendasTable.tsx:176-178` pasa `acciones={<RegistrarPagoTiendaBoton .../>}` a
  `DesgloseMovimientosTienda` (prop ya existente, `:253-266`). Es **la única línea** que se toca
  de ese archivo.
- Tras registrar, `mutate(claveDesgloseTienda(tiendaId))` (`:79-102`) refresca **solo** esa
  tienda: ni la página, ni los desgloses de las demás (R31).

Componentes nuevos, junto a la página que los usa (regla «sin sobre-ingeniería»):
`RegistrarPagoDialog.tsx` (el formulario, compartido por los dos flujos vía props) y
`PagosRegistradosTabla.tsx` (la lista de comprobantes, compartida). Se colocan en
`components/shared/liquidacion/` **porque los usan dos features de pantalla distintas**
(`wallet/tiendas` y `cierres-admin`), que es exactamente el umbral que `docs/architecture.md`
fija para promover.

### 9.2 Mensajero — `/cierres-admin`

Sub-modal de pago tras aprobar + sección «Pago al mensajero» en el detalle de un cierre aprobado
+ marca de «pendiente de liquidar» en la fila del listado (R24). La marca es una columna con el
monto pendiente y un `Badge`; sale de `pendientePagoMensajero` y no se calcula en el cliente.

### 9.3 Los beneficiarios

- **Mensajero (`/mis-pagos`)**: no se toca. Su libro ya se lista entero y el movimiento
  `liquidacion` aparece con su etiqueta, que ya existe
  (`app/(app)/mis-pagos/_components/mis-pagos-labels.ts`). R52 se verifica, no se implementa.
- **Tienda (`/mi-wallet`)**: `[P5]` la cabecera pasa de dos importes a los **tres** de la 171
  (a favor / cargos / pagado) reutilizando `derivarDesgloseTienda` y `CUBETA_POR_CATEGORIA`
  (`lib/utils/desglose-tienda.ts`) **por importación, no por copia**. Sin esto, la tienda ve su
  pago sumado dentro de «Débitos», indistinguible de un cargo.

### 9.4 Censo de tablas (R55)

`PagosRegistradosTabla` es una instancia de `<DataTable>` montada en **dos** sitios ⇒ 1 archivo,
2 instancias en el censo. Descarga: **Familia B** (`filasLocales`), porque la lista llega
completa y sin paginar (son pocos comprobantes por cierre/tienda). Los totales duros del censo
**se leen en el momento de implementar y se suman**, no se copian de este documento: ya han
cambiado dos veces (25/30/25/31 → 24/29/24/30 → +1 por la 171).

---

## 10. Alternativas descartadas

**A) Registrar el pago DENTRO de la transacción de aprobación del cierre.** *Descartada.* Es la
lectura literal de «se pregunta al aprobar», y sería más simple: una sola escritura, atomicidad
gratis. Pero acopla el desbloqueo del mensajero al éxito de un trámite administrativo: un fallo
del pago revierte la aprobación y el cierre vuelve a `solicitado`, que **bloquea** al mensajero
(`OrdenRepository.ts:136-140`). Es exactamente la consecuencia en cadena que el humano descartó
al decidir que son dos pasos. Coste de descartarla: hay que sostener la coherencia con dos
escrituras, y se sostiene sola porque el pendiente se **deriva** (no hay estado que quede a
medias: o hay pago o no lo hay).

**B) Sin tabla nueva: columnas `metodo`/`referencia`/`nota`/`fecha_pago` en los dos libros.**
*Descartada.* Evita una tabla, pero: (i) añade 4 columnas nulas al 99 % de las filas de dos
tablas append-only que escribe un feed automático; (ii) obliga a duplicar el mismo bloque de
columnas en dos sitios, con dos migraciones de forma distinta; (iii) deja sin **entidad pago**:
el `origen_id` del movimiento tendría que apuntar a algo que no existe, así que la clave de
idempotencia acabaría siendo una columna suelta del libro; y (iv) la 173 no tendría a qué
enganchar el egreso de caja. Se paga una tabla y se gana un documento con id.

**C) Idempotencia por clave natural `(beneficiario, monto, método, fecha_pago)`.** *Descartada.*
No necesita que el cliente genere nada, pero **bloquea pagos legítimos repetidos**: dos entregas
de ₡5 000 en efectivo el mismo día al mismo mensajero son dos pagos, y el segundo desaparecería
en silencio — el peor fallo posible en dinero, porque el saldo quedaría alto y nadie vería el
error. La clave explícita distingue «la misma solicitud otra vez» de «otra solicitud igual».

**D) Un ciclo de corte por tienda («cierre de tienda») al que atar el pago.** *Descartada por el
humano* (decisión 4) y confirmada aquí: el saldo de una tienda se acumula de muchos cierres de
muchos mensajeros, así que el corte sería una entidad nueva con su propio estado, su aprobación y
su pantalla. Es una feature en sí misma; el saldo acumulado ya es un contra-qué-pagar correcto.

**E) Emitir `egreso_pago_tienda` en la caja principal al pagar a la tienda.** *Descartada* (§8,
`[P2]`). Es lo que pedía el borrador de la 43 (`specs/43-wallet-por-tienda/requirements.md:240-244`),
escrito antes de que el humano decidiera el cambio de la caja a tesorería. Hoy el COD **no entra**
en la caja, así que su salida la dejaría estructuralmente negativa y el número que hoy se lee
como ganancia dejaría de significar nada — sin que la 173 haya podido separar «saldo de caja» de
«ganancia», que es su trabajo. Se descarta **por orden de ejecución**, no por desacuerdo.

**F) Un servicio por tipo de beneficiario (`LiquidacionMensajeroService` /
`LiquidacionTiendaService`).** *Descartada.* Simetría aparente, duplicación real: permisos,
idempotencia, atomicidad, validación del documento y composición del movimiento son idénticos.
Lo único distinto son dos funciones pequeñas (contra qué se compara, en qué libro se escribe),
que entran como estrategia dentro del mismo servicio.

**G) Añadir `cierre_id` a `pago_mensajero_movimiento` para que el filtro por cierre sea directo.**
*Descartada.* Resolvería R50 sin el `OR` de dos pasos, pero exige **backfillear** filas de un
libro declarado inmutable (`UPDATE ... SET cierre_id = origen_id`), y añade una segunda forma de
decir de dónde viene un movimiento, conviviendo con `origen_tipo/origen_id`. El `OR` cuesta una
consulta de 0–3 filas por filtrado, y solo cuando se filtra por cierre.

---

## 11. Archivos que toca

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `db/migrations/<ts>_liquidacion_pago/{migration.sql,down.sql}` | Tabla + los 2 CHECK heredados |
| `lib/types/liquidacion.ts` | DTOs + schemas zod |
| `lib/utils/pendiente-cierre.ts` | Derivación pura del pendiente |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` · `lib/repositories/LiquidacionPagoRepository.ts` | Acceso a datos |
| `lib/interfaces/services/ILiquidacionService.ts` · `lib/services/LiquidacionService.ts` | Lógica |
| `lib/actions/liquidacion.ts` | 4 Server Actions |
| `components/shared/liquidacion/RegistrarPagoDialog.tsx` · `PagosRegistradosTabla.tsx` · `liquidacion-labels.ts` · `pagos-registrados-descarga-columnas.ts` | UI compartida |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `db/schema.prisma` | Modelo `LiquidacionPago` + lados inversos en `Usuario` y `CierreDia` |
| `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` · `IWalletTiendaMovimientoRepository.ts` + sus repos | `fechaMovimiento?` opcional en el input; filtro por cierre con `OR` (solo el del mensajero) |
| `lib/interfaces/services/ICierresAdminService.ts` · `lib/services/CierresAdminService.ts` | `pendientePagoMensajero` en el resumen y en el resultado de aprobar |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` (+ `cierre-detalle-shared`/`cierre-factura` si procede) | Sub-modal de pago, sección del cierre aprobado, columna de pendiente |
| `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx` | Pasa `acciones` (una línea) |
| `app/(app)/mi-wallet/**` | `[P5]` cabecera de tres importes reutilizando `derivarDesgloseTienda` |
| `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` | Censo + totales |

**Que NO se tocan:** `lib/services/WalletMensajeroFeedService.ts`, `WalletTiendaFeedService`,
`lib/utils/saldo-tienda.ts`, `lib/utils/cuenta-por-pagar.ts`, `lib/actions/wallet.ts`,
`lib/analytics/**` y ninguna migración anterior.

---

## 12. Verificación: por qué NO hay E2E

`CHECKPOINTS.md` pide un E2E para «flujos críticos (auth, **pagos**, recaudo…)». **Se declara
inaplicable por decisión del humano** («no más e2e, pruebas básicas nada más»): el repo tiene
`e2e/*.spec.ts` pero sin harness ejecutable, y los specs recientes registran esa suite como
*NOT EXECUTED*. El riesgo que un E2E cubriría —que la cadena entera funcione, no solo las
piezas— se cubre por otras dos vías, ambas ejecutables:

1. **Test de integración de la cadena de servidor completa** (acción → servicio → repositorios
   dobles con la semántica real de los constraints): registrar un pago baja el saldo, el segundo
   envío con la misma clave no lo vuelve a bajar, y el movimiento queda enlazado al pago. Molde:
   `tests/integration/db/wallet-idempotencia.test.ts`, que ya simula el índice único parcial.
2. **Tests de componente sobre las dos pantallas** con las Server Actions mockeadas: que el
   sub-modal aparece tras aprobar, que «Ahora no» deja el cierre aprobado, que el botón queda
   deshabilitado con monto inválido y que tras registrar se refresca **solo** esa tienda.

El round-trip real de la migración (up → down → up) contra Postgres queda como verificación
manual del implementer, documentada en `progress/impl_172-liquidacion.md`, exactamente como
hicieron la 43 y la 44.

---

## 13. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | El `ADD CONSTRAINT ... CHECK` **falla al aplicarse** si alguna fila de producción es incoherente, y en Vercel el build migra antes de compilar ⇒ despliegue bloqueado | T A.0: verificar con el MCP de Supabase, en **cada** base, que no hay filas que lo incumplan, antes de mergear (R59) |
| 2 | Doble clic ⇒ doble pago | Clave de idempotencia con `UNIQUE` + relectura por clave (§4.1). Test que ejecuta la misma solicitud dos veces |
| 3 | Dos pagos simultáneos superan lo debido | Candado por beneficiario dentro de la transacción (§4.2), solo si P1 = rechazar |
| 4 | El documento (`liquidacion_pago`) y el libro divergen | Se escriben en la misma transacción (R37) + test de invariante `Σ pagos == Σ movimientos de esos pagos` |
| 5 | Filtrar el desglose del mensajero por cierre esconde el pago de ese cierre | El `OR` de §5, con test específico (R50) |
| 6 | El pago se fecha con el día equivocado y desaparece de su propio rango | Medianoche UTC de `fecha_pago` (§2.4) + test de los dos bordes del filtro |
| 7 | La sección de pago aparece a un `adminSatelite` que no puede pagar | El gate está en el servicio (`forbidden`) **y** en la pantalla (R4), con contraprueba en los dos |
| 8 | Un pago mal tecleado no se puede corregir | Declarado y elevado a puerta: `[P4]` |
| 9 | Colisión con la 170 fase 2: sus tandas tocan `wallet/tiendas` y `cierres-admin` | Verificar antes de arrancar qué tandas de la 170 siguen en vuelo; esta feature toca **una línea** de `SaldosTiendasTable` y añade campos a `CierreAdminResumen`, así que el conflicto es textual, no arquitectónico. Decisión del leader (T0.9) |

**Defecto preexistente observado, fuera de alcance:** el filtro `hasta` de los desgloses compara
contra la medianoche UTC del día indicado, así que hoy **ya** excluye casi todo el último día
para los movimientos alimentados por el cierre (que llevan hora real). No se corrige aquí —sería
cambiar el comportamiento de dos pantallas que esta feature no debe tocar—, pero queda escrito
para que no se atribuya a la 172 cuando alguien lo note.
