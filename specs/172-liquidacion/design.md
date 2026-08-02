# Feature 172 — Liquidación: pagar cuentas por pagar de mensajeros y saldos de tiendas · design

> Decisiones técnicas antes de escribir código. Todo lo que aquí se afirma del estado actual
> está verificado contra el árbol (archivo y línea) y listado en
> `requirements.md § Estado del arte`. **Money-critical:** `Prisma.Decimal` en todo cálculo,
> STRING `toFixed(2)` en la frontera, cero `parseFloat`/`Number(` sobre montos.
> Patrón de capas Controller → Service → Repository con interfaces (`docs/architecture.md`).
>
> **Puerta cerrada el 2026-08-01.** Este diseño incorpora las ocho respuestas: rechazar el
> exceso **con candado de serialización** (P1, §4.2), sin tocar la caja (P2, §8), solo
> `maestro`/`admin` (P3, §5), **anulación DENTRO del alcance** (P4, §6), `/mi-wallet` con
> «pagado» separado (P5, §9.3), referencia obligatoria en pagos electrónicos (P6), comprobante
> solo texto (P7) y sin CHECK en la caja (P8, §2.3).

---

## 1. Principio rector: el pago es un DOCUMENTO; el saldo lo sigue derivando el libro

Los dos libros (`wallet_tienda_movimiento`, `pago_mensajero_movimiento`) son append-only y el
saldo se **deriva** de ellos. Esta feature no cambia eso. Lo que añade es la pieza que hoy no
existe: **el pago como documento propio** —monto, método, referencia, nota, fecha real, actor,
instante de registro— del que *nace* exactamente un movimiento en el libro del beneficiario. Y,
desde la respuesta a P4, **la anulación es otro documento** del que nace el movimiento inverso.

De ahí salen las cuatro decisiones estructurales:

1. **Tabla `liquidacion_pago`** para el documento del pago, y **`liquidacion_anulacion`** para el
   de la anulación. Ninguna columna nueva en los libros (§10.B), y **ninguna fila mutable**.
2. **El movimiento del libro apunta al documento**, usando los `origen_tipo` que la 42 dejó
   reservados: `pago_mensajero` y `pago_tienda`, con `origen_id = <id del pago>`. Así el índice
   único parcial que ya existe en los dos libros da idempotencia **sin migración de índice**,
   **sin bloquear pagos parciales** y —regalo— **también para el contraasiento** (§4, §6.2).
3. **Aprobar y pagar son dos escrituras distintas**, no una transacción compartida (§7).
4. **Todo lo que consume saldo se serializa en la base** (§4.2), porque P1 = rechazar el exceso.

---

## 2. Modelo de datos

### 2.1 `liquidacion_pago` (modelo Prisma `LiquidacionPago`)

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
  // SIN updatedAt / deletedAt: fila INMUTABLE, igual que los libros. La anulacion NO la toca.

  anulacion   LiquidacionAnulacion?  // 0 o 1 (R75)
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
`beneficiario_id` genérico daría **menos** integridad referencial y un enum nuevo que mantener.
Con dos FK reales + un `CHECK` XOR, la base garantiza que hay exactamente un beneficiario.
Precedente exacto en el repo: `notificacion` usa
`CHECK (("destinatario_rol" IS NULL) <> ("destinatario_usuario_id" IS NULL))`
(`db/migrations/20260727120000_notificacion/migration.sql:53`).

**`metodo` reutiliza `metodo_pago_value`** (`efectivo | SINPE | transferencia`,
`db/schema.prisma:628-634`): exactamente los tres que pidió el humano. No se crea ningún enum, así
que **no hay que tocar ningún `down.sql` previo** (la trampa de «enum nuevo ⇒ actualizar los
down.sql anteriores» no aplica: no se añade ningún **valor** a un enum existente). Es también el
motivo de fondo de N1 (§6.4).

**`registrado_por` es NOT NULL** —a diferencia de los libros, donde es nullable porque el feed
del cierre escribe sin actor—: un pago siempre lo registra alguien, y esa es media trazabilidad
(R7). Su FK va `ON DELETE RESTRICT`.

**`fecha_pago` es `@db.Date`**, con la convención del repo para fechas calendario
(`fecha_reprogramacion`, features 36/46): medianoche UTC del día. `created_at` es el instante de
registro. Los dos existen siempre y pueden diferir (R9).

### 2.2 `liquidacion_anulacion` (modelo Prisma `LiquidacionAnulacion`) — `[P4]`

```prisma
model LiquidacionAnulacion {
  id         String   @id @default(uuid())
  pagoId     String   @unique @map("pago_id")   // UNIQUE = un pago se anula UNA vez (R75)
  motivo     String                              // no vacio (R72)
  anuladoPor String   @map("anulado_por")        // FK -> usuario (actor)
  createdAt  DateTime @default(now()) @map("created_at") // instante de la anulacion (R73)
  // SIN updatedAt / deletedAt: tambien INMUTABLE. No se anula una anulacion (R82).

  pago     LiquidacionPago @relation(fields: [pagoId], references: [id])
  anulador Usuario         @relation("LiquidacionAnulacionActor", fields: [anuladoPor], references: [id])

  @@map("liquidacion_anulacion")
}
```

**Tabla aparte, no columnas en el pago.** Es la decisión central de P4 y sostiene todo lo demás:
el pago sigue siendo una fila **inmutable** (R41, R74: se muestra íntegro después de anulado) y
la anulación tiene su propio actor, instante y motivo, igual que el pago tiene los suyos. El
`@unique` de `pago_id` es la restricción **de datos** que exige R75: un segundo intento de anular
choca contra el índice, no contra un `if`.

**El estado «anulado» se DERIVA**, no se almacena: un pago está anulado ⇔ existe su fila en
`liquidacion_anulacion`. No hay ningún flag que pueda quedar desincronizado con el contraasiento.

### 2.3 Restricciones

De la tabla del pago:

```sql
-- exactamente un beneficiario
CONSTRAINT liquidacion_pago_beneficiario_check
  CHECK (("mensajero_id" IS NULL) <> ("tienda_id" IS NULL)),
-- el cierre acompaña al mensajero y solo a el (decisiones 2 y 4 del humano)
CONSTRAINT liquidacion_pago_cierre_check
  CHECK (("mensajero_id" IS NULL) = ("cierre_id" IS NULL)),
-- dinero positivo (el signo lo da la categoria del movimiento, como en los libros)
CONSTRAINT liquidacion_pago_monto_check CHECK ("monto" > 0)
```

RLS en **las dos** tablas nuevas: `ENABLE ROW LEVEL SECURITY` **sin políticas**, patrón «solo
service role» de `wallet_movimiento` / `wallet_tienda_movimiento` / `pago_mensajero_movimiento` /
`cierre_dia` (R63).

**El CHECK `categoria` ↔ `tipo` de los dos libros (condición heredada del review de la 171).** Va
en **esta** migración, no como follow-up: la 172 es el **segundo escritor** de los dos libros y
ahí es donde el invariante deja de tener un solo guardián
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

Cuatro propiedades deliberadas:

- **Falla cerrado (R60).** Es una disyunción de listas cerradas, no una negación: un valor nuevo
  del enum que nadie clasifique **no casa ninguna rama** y el INSERT se rechaza. Ruidoso a
  propósito: mejor que la feature que añada el concepto tenga que tocar el CHECK, a que su
  primera fila caiga en la cubeta equivocada y descuadre un saldo.
- **Cubre el hueco exacto del review:** una fila `pago_tienda` + `credito` haría que la tabla de
  saldos y el desglose de la 171 mostraran cifras distintas para la misma tienda.
- **Deja pasar el contraasiento de la anulación**: `ajuste_credito` está en la rama `credito` y
  `ajuste_devengo` en la rama `devengo`, que es justo el signo que necesita §6.2. El CHECK y la
  anulación se diseñaron juntos.
- **Valida los datos existentes al aplicarse.** `ADD CONSTRAINT ... CHECK` sin `NOT VALID`
  recorre la tabla; si hubiera una fila incoherente en producción, **la migración falla y el
  despliegue se cae** (y en Vercel el build **migra antes de compilar**, así que sería un
  despliegue bloqueado). De ahí R61 y la task **T A.0**: verificar antes, con el MCP de Supabase,
  en **producción y preview**, que no hay ninguna fila que lo incumpla. Con el volumen medido (35
  movimientos de caja, 6 cierres) el recorrido es instantáneo y no hace falta `NOT VALID` +
  `VALIDATE`.

`[P8]`: **la caja principal no recibe este CHECK** (R62). Tiene el mismo hueco y cuatro
escritores, pero la 172 no la escribe; añadirle una restricción que valida filas existentes sería
importar riesgo de despliegue sin contrapartida. Queda anotado para la 173.

### 2.4 Ampliación mínima de los contratos de escritura de los libros

Los dos `Crear*Input` **no exponen `fechaMovimiento`** hoy
(`IPagoMensajeroMovimientoRepository.ts:19-28`, `IWalletTiendaMovimientoRepository.ts:19-28`),
aunque la columna existe con `DEFAULT CURRENT_TIMESTAMP`. Se añade como campo **opcional**
(`fechaMovimiento?: Date`) y las implementaciones lo pasan solo si viene: el feed del cierre
sigue sin pasarlo y su comportamiento no cambia ni un byte.

**Trampa de fechas, resuelta y declarada.** El movimiento del pago se fecha con la **medianoche
UTC del día de `fecha_pago`** (`${YYYY-MM-DD}T00:00:00.000Z`), no con `inicioDelDiaCREnUtc`
(06:00Z). Motivo: los filtros de rango de los dos desgloses usan `z.coerce.date()` sobre
`YYYY-MM-DD`, que produce medianoche UTC, y comparan `fecha_movimiento >= desde` / `<= hasta`.
Con 06:00Z, un pago quedaría **fuera de su propio día** al filtrar por `hasta`. Con medianoche UTC
entra por los dos lados. Consecuencia cosmética aceptada: un pago registrado hoy ordena antes que
los movimientos del cierre de hoy (00:00 < 14:32) dentro del mismo día.

El **contraasiento** se fecha con la medianoche UTC del **día de la anulación** (R77), no con la
del pago: misma convención, fecha distinta y deliberada (§6.3).

### 2.5 Migración

`db/migrations/<timestamp>_liquidacion_pago/`

- **`migration.sql` (UP):** `CREATE TABLE liquidacion_pago` (3 CHECK, `UNIQUE` de
  `clave_idempotencia`, 3 índices, 4 FK) + `CREATE TABLE liquidacion_anulacion` (`UNIQUE` de
  `pago_id`, 2 FK); `ENABLE ROW LEVEL SECURITY` en las dos; y los **2 `ADD CONSTRAINT ... CHECK`**
  de §2.3. **Ningún `CREATE TYPE`.**
- **`down.sql` (DOWN):** `DROP TABLE liquidacion_anulacion` → `DROP TABLE liquidacion_pago` (ese
  orden, por la FK) + `ALTER TABLE ... DROP CONSTRAINT` de los dos CHECK de los libros. No toca
  enums (no creó ninguno). Reversible (R64).
- **Una sola migración para toda la feature** (incluida la tabla de anulación, que no se usa
  hasta la Tanda F): dos migraciones para una feature multiplican los estados intermedios de las
  bases sin ganar nada.
- **Aditiva (R64):** ni una fila existente se reescribe; los libros solo ganan una restricción.

---

## 3. Capas y archivos

### 3.1 Backend

| Archivo | Qué |
| --- | --- |
| `lib/types/liquidacion.ts` | DTOs + schemas zod del borde. Montos STRING. `satisfies` contra los enums Prisma. |
| `lib/utils/pendiente-cierre.ts` | `derivarPendienteCierre(P, E, pagadoVigente)` **pura** → STRING. Reusa `calcularSplitPago` (fuente única de `min(P,E)`, feature 44). |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` | `bloquearBeneficiario(tx, ...)`, `crear(tx, input)`, `obtenerPorClave`, `obtenerPorId`, `anular(tx, ...)`, `sumarVigentesPorCierre(ids)`, `sumarVigentesPorTienda(id)`, `listarPorCierre`, `listarPorTienda`. |
| `lib/repositories/LiquidacionPagoRepository.ts` | Implementación (solo Prisma, incluido el `SELECT … FOR UPDATE` de §4.2). |
| `lib/interfaces/services/ILiquidacionService.ts` | `registrarPagoMensajero`, `registrarPagoTienda`, `anularPago`, `listarPagosDeCierre`, `listarPagosDeTienda`. |
| `lib/services/LiquidacionService.ts` | Guardia de rol, validaciones de dominio, derivación del disponible, composición del movimiento y orquestación de la transacción. |
| `lib/actions/liquidacion.ts` | 5 Server Actions (`'use server'`), molde de `lib/actions/wallet-egresos.ts`. |

**Un solo servicio para los tres actos** (pagar a mensajero, pagar a tienda, anular), no tres. El
80 % es idéntico —permisos, candado, validación, idempotencia, atomicidad— y lo que difiere son
tres funciones pequeñas: *contra qué se compara el monto*, *en qué libro se escribe* y *con qué
signo*. Tres servicios serían tres copias del camino money-critical.

### 3.2 Contratos I/O (frontera Server Action → cliente)

```ts
export type MetodoLiquidacion = "efectivo" | "SINPE" | "transferencia"; // METODO_PAGO_SEED

export type RegistrarPagoMensajeroInput = {
  claveIdempotencia: string;   // uuid generado por el cliente al ABRIR el formulario (§4.1)
  cierreId: string;            // uuid; el pago va SIEMPRE atado a un cierre aprobado (R21)
  monto: string;               // STRING 2 dec, > 0 (montoPositivoSchema + tope de columna)
  metodo: MetodoLiquidacion;
  referencia?: string;         // OBLIGATORIA si metodo != efectivo  [P6]
  nota?: string;               // <= LIQUIDACION_NOTA_MAX
  fechaPago: string;           // "YYYY-MM-DD", no futura en hora de Costa Rica
};

export type RegistrarPagoTiendaInput = Omit<RegistrarPagoMensajeroInput, "cierreId"> & {
  tiendaId: string;            // NO lleva cierre: contra saldo acumulado (decision 4)
};

export type AnularPagoInput = {
  pagoId: string;              // uuid
  motivo: string;              // no vacio (R72)
};                             // NO lleva monto: se lee server-side (R70)

export type AnulacionDTO = {
  motivo: string;
  anuladoPorNombre: string;    // NOMBRE, no id (R56)
  anuladoAt: string;           // ISO
};

export type PagoRegistradoDTO = {
  id: string;
  monto: string;               // STRING 2 dec
  metodo: MetodoLiquidacion;
  referencia: string | null;
  nota: string | null;
  fechaPago: string;           // "YYYY-MM-DD"
  registradoPorNombre: string;
  registradoAt: string;        // ISO — instante de registro
  anulacion: AnulacionDTO | null;   // null = vigente (R74)
};

export type RegistrarPagoResult =
  | { status: "ok"; pago: PagoRegistradoDTO; restante: string }
  | { status: "ya_registrado"; pago: PagoRegistradoDTO; restante: string } // idempotencia (R43/R47)
  | { status: "excede"; disponible: string }                               // [P1] R25/R31
  | { status: "sin_saldo" }                                                // R32
  | { status: "cierre_no_aprobado" }                                       // R20
  | { status: "no_encontrado" } | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type AnularPagoResult =
  | { status: "ok"; pago: PagoRegistradoDTO; restante: string }            // R71/R79
  | { status: "ya_anulado"; pago: PagoRegistradoDTO }                      // R75
  | { status: "no_encontrado" } | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
```

Ningún `number` cruza la frontera (R14). Los DTO **no** emiten `mensajeroId`, `tiendaId`,
`cierreId`, `registradoPor`, `anuladoPor` ni la clave de idempotencia: son identificadores
internos y la guardia de columnas de descarga los rechaza (R56). El `id` del pago sí viaja —es lo
que la pantalla necesita para pedir su anulación— pero **no aparece en ninguna columna visible ni
descargable**.

### 3.3 El acto de registrar, paso a paso

```
registrarPagoTienda(input, actor):
  1. esAccesoTotal(actor.rol) ? seguir : forbidden                 // R1/R2/R6, ANTES de tocar datos
  2. zod ya validó forma, monto, fecha no futura y referencia      // R8-R15 (borde)
  3. $transaction:
       a. repo.bloquearBeneficiario(tx, tiendaId)                   // R83/R85 — ANTES de leer
       b. saldo = derivarSaldoTienda(repo.agregarSaldoPorTienda(tiendaId))
       c. saldo <= 0            -> sin_saldo                        // R32
          monto  >  saldo       -> excede { disponible: saldo }     // R31  [P1]
       d. pago = liquidacionRepo.crear(tx, {...})                   // UNIQUE clave -> conflicto
          si conflicto          -> ya_registrado (relee por clave)  // R43/R47
       e. walletTiendaMovimientoRepo.crearMovimientos(tx, [{
            tiendaId, tipo:"debito", categoria:"pago_tienda", monto,
            origenTipo:"pago_tienda", origenId: pago.id,
            descripcion: descripcionDePago(metodo, referencia),
            registradoPor: actor.usuarioId,
            fechaMovimiento: medianocheUtcDe(fechaPago) }])          // R36/R37/R38
  4. devuelve ok + restante                                          // R39 atómico
```

`registrarPagoMensajero` es el mismo esqueleto cambiando (a) por el bloqueo del **cierre**
(§4.2), (b)/(c) por el pendiente del cierre (§5) y (e) por
`{ tipo:"pago", categoria:"liquidacion", origenTipo:"pago_mensajero" }`, más una guardia previa:
el cierre debe existir y estar **`aprobado`** (R20), leído dentro de la misma transacción.

`descripcionDePago(metodo, referencia)` es una función pura que compone `"SINPE · 1234567"`. Es
**denormalización deliberada**: sin ella la línea del libro diría solo «Pago al mensajero» y para
saber cómo se pagó habría que abrir otra lista. El dato canónico sigue siendo el de
`liquidacion_pago`. Un test fija que la descripción **no** lleva la nota (texto libre, puede ser
largo y personal) ni ningún id.

---

## 4. Idempotencia, doble pago y carrera

### 4.1 La clave: `clave_idempotencia` con `UNIQUE`

El cliente genera un **uuid al ABRIR el formulario** y lo manda con la solicitud. La columna es
`UNIQUE`, así que:

- **Doble submit / doble clic / reintento tras timeout** → la segunda inserción viola el UNIQUE →
  el servicio relee el pago por esa clave y devuelve `ya_registrado` con el **mismo**
  `PagoRegistradoDTO`. Cero filas nuevas, cero saldo saldado dos veces (R43/R47).
- **Dos pagos legítimos idénticos** (dos veces ₡5 000 en efectivo el mismo día) → dos aperturas
  del formulario, dos claves, dos pagos (R45). Una clave natural
  `(beneficiario, monto, método, fecha)` habría bloqueado el segundo: descartada (§10.C).
- La clave **no cambia entre reintentos del mismo pago** y **se renueva** tras un registro
  exitoso. Es requisito del cliente y se testea en el componente.
- **Un pago anulado no libera su clave** (R78/R79): volver a registrarlo es una solicitud nueva,
  con clave nueva, y la referencia y la fecha real sí se pueden repetir (no son únicas).

La protección es **de datos** (R44): no hay `SELECT` previo que decida si insertar. El
`origen_id = pago.id` en el movimiento hereda además la idempotencia del índice único parcial que
ya existe en los dos libros: aunque alguien llamara dos veces al repositorio con el mismo pago,
`skipDuplicates` lo convierte en no-op.

### 4.2 El candado: serializar lo que compite por el mismo dinero `[P1]`

Con P1 = **rechazar el exceso**, la comprobación «monto ≤ disponible» solo vale si nadie puede
leer el mismo disponible a la vez. Con `READ COMMITTED` (el default de Prisma), dos transacciones
simultáneas leerían el mismo saldo, las dos pasarían y entre las dos se pagaría de más. Por eso
**el candado no es un detalle de implementación: es la mitad de la respuesta a P1** (R83–R85).

**Dónde se toma, y por qué el grano difiere:**

| Operación | Fila bloqueada | Por qué esa y no otra |
| --- | --- | --- |
| Pago a mensajero | `cierre_dia` del cierre | Lo que se consume es **el pendiente de UN cierre**. Bloquear el cierre es el grano exacto: dos pagos a cierres distintos del mismo mensajero no se estorban, y no se toca `usuario`, que es fila caliente (sesiones, perfil) |
| Pago a tienda | `usuario` de la tienda | Lo que se consume es **el saldo de la tienda entera**; no hay unidad más fina que bloquear |
| Anulación | la **misma** fila que bloquearía su pago | Para que una anulación y un registro simultáneos no lean el mismo disponible (R84) |

```sql
-- dentro de la $transaction, ANTES de leer el disponible
SELECT id FROM cierre_dia WHERE id = $1 FOR UPDATE;   -- pago/anulación a mensajero
SELECT id FROM usuario    WHERE id = $1 FOR UPDATE;   -- pago/anulación a tienda
```

**Un solo candado por operación (R85):** no hay dos recursos que ordenar, así que no existe orden
de adquisición capaz de producir interbloqueo. Se libera al cerrar la transacción, que hace tres
sentencias. Precedente de guardia anti-TOCTOU con SQL crudo en el repo: feature 41/R23
(`lib/repositories/OrdenRepository.ts:132`).

**Cómo se verifica sin Postgres** (los tests del repo no levantan base):

1. **Orden de llamadas:** un doble del repositorio registra la secuencia y el test afirma que
   `bloquearBeneficiario` ocurre **antes** de la lectura del disponible. Un candado tomado
   después no sirve de nada, y ese es el error que este test caza.
2. **Carrera simulada:** el store en memoria implementa la semántica del bloqueo (la segunda
   transacción espera). Se ejecutan dos pagos de ₡60 000 contra un disponible de ₡100 000: uno
   entra, el otro recibe `excede`. **Prueba por mutación obligatoria:** quitando el candado del
   store, el test debe fallar; si no falla, no prueba nada.

Si algún día el humano cambiara P1 a *permitir el exceso*, este candado sobra y se retira: sin
tope no hay carrera que perder. Queda escrito para que se sepa qué se cae con esa decisión.

---

## 5. El pendiente de un cierre, derivado

```
pendienteDelCierre = calcularSplitPago(P, E).pendiente − Σ liquidacion_pago.monto VIGENTES del cierre
                     └────────── feature 44, ya congelado ─────────┘   └──── una agregación ────┘
```

`P` y `E` son columnas del propio `cierre_dia` (`total_pago_mensajero`, `total_efectivo`), así que
**no hace falta tocar el libro** para saber cuánto falta: una lectura del cierre (que la pantalla
ya hace) más un `groupBy` por `cierre_id` sobre la tabla nueva, indexado.

**«Vigentes» quiere decir `LEFT JOIN liquidacion_anulacion … WHERE anulacion IS NULL`** (R80): un
pago anulado deja de descontar, que es exactamente lo que hace que el monto vuelva a estar
adeudado (R79) sin ningún recálculo especial. Lo mismo aplica a `sumarVigentesPorTienda`.

Dos consecuencias:

- **Listado de cierres (R26):** una sola llamada `sumarVigentesPorCierre(ids de la página)` añade
  el pendiente a las filas ya paginadas. `CierreAdminResumen` gana
  `pendientePagoMensajero: string | null` (`null` = el cierre no está aprobado, R28); lo rellena
  el servicio, no el repositorio, y `toResumen` sigue sin recomputar dinero.
- **Invariante testeable:** `Σ pagos vigentes de un cierre` = `Σ movimientos liquidacion − Σ
  contraasientos` de esos pagos. Es la contraprueba de que documento y libro no divergen, y se
  testea con montos reales y con un pago anulado en medio.

**El filtro por cierre del desglose del mensajero (R52).** Hoy filtra
`origen_tipo='cierre_dia' AND origen_id=<cierre>` (`PagoMensajeroMovimientoRepository.ts:42-55`),
así que el movimiento de una liquidación —cuyo origen es el **pago**— quedaría fuera de su propio
cierre. Se corrige en dos pasos dentro del repositorio: leer los ids de pago de ese cierre (0–3
filas, índice `cierre_id`) y construir `OR [ {cierre_dia, cierreId}, {pago_mensajero, origenId IN
pagos} ]`. Ese `OR` trae **también los contraasientos**, porque comparten `origen_id` con su pago.
Sin esto, filtrar por cierre escondería justamente lo que el humano quiere ver.

---

## 6. Anulación de un pago `[P4]`

### 6.1 Qué es y qué no es

**Anular es añadir un contraasiento**, jamás borrar ni editar (R69, R65, R41). El pago sigue en la
tabla, sigue en el libro y sigue en la lista de comprobantes, ahora marcado, con su motivo, su
actor y su instante (R74). El patrón es el que la 45 ya estableció para la caja
(`WalletEgresoService.reversarEgreso`, `lib/services/WalletEgresoService.ts:75-106`): monto leído
**server-side** (R70), movimiento inverso enlazado al original, idempotencia por constraint.

### 6.2 El contraasiento, categoría por categoría

| Pago original | Contraasiento | Efecto en el saldo |
| --- | --- | --- |
| mensajero: `tipo=pago`, `categoria=liquidacion` | `tipo=devengo`, `categoria=ajuste_devengo` | la cuenta por pagar vuelve a subir el mismo monto |
| tienda: `tipo=debito`, `categoria=pago_tienda` | `tipo=credito`, `categoria=ajuste_credito` | el saldo a favor vuelve a subir el mismo monto |

Las dos categorías **ya existen** y estaban reservadas justo para esto («corrección compensatoria
inmutable», comentario del enum en `db/schema.prisma:1115-1117` y `:1176-1178`), así que **no hace
falta ningún valor de enum nuevo** y no se toca ningún `down.sql` previo. Las dos casan con el
CHECK de §2.3 por construcción.

El contraasiento va con `origen_tipo` = el mismo del pago (`pago_mensajero` / `pago_tienda`) y
`origen_id = pago.id`. **Idempotencia gratis:** el índice único parcial de cada libro es
`(origen_tipo, origen_id, <beneficiario>, categoria)`; el pago ocupa la clave con `categoria =
liquidacion|pago_tienda` y el contraasiento otra distinta con `categoria = ajuste_*`. Los dos
caben, y ninguno puede duplicarse. La `UNIQUE(pago_id)` de `liquidacion_anulacion` es la segunda
barrera, la que devuelve `ya_anulado` (R75) en vez de un no-op silencioso.

### 6.3 Fechas, referencia y volver a pagar

- **La fecha real y la referencia del pago anulado no se tocan** (R78). El pago ocurrió el día que
  ocurrió; lo que se corrige es su efecto, no la historia.
- **El contraasiento se fecha el día de la anulación** (R77), no el del pago. Es el precedente de
  `reversarEgreso`, que inserta con la fecha por defecto (hoy) y no reabre fechas pasadas.
  Consecuencia declarada: entre el pago y su anulación, un informe por rango de fechas verá el
  pago aplicado. Es la semántica contable habitual, y la alternativa —fechar el contraasiento en
  el pasado— reescribiría saldos históricos ya mirados.
- **Volver a pagar** (R79): se registra un pago nuevo, con **clave de idempotencia nueva**, y
  puede llevar la misma referencia y la misma fecha real (ninguna de las dos es única). Es
  exactamente el flujo «me equivoqué en el monto»: anular + registrar el correcto.
- **No se anula parcialmente** (R76) ni se anula una anulación (R82): las dos cosas caen del
  modelo, no de un `if`.

### 6.4 Lo que la anulación NO arregla, y está declarado (N1)

Como el contraasiento usa `ajuste_*`, la cabecera del desglose —que clasifica por **categoría**
(`CUBETA_POR_CATEGORIA`, 171)— seguirá contando el pago anulado dentro de «pagado a la tienda» y
sumará su reverso dentro de «a favor». **El saldo queda exacto; los importes brutos quedan
inflados.** Netearlos exigiría dos valores de enum nuevos (con la cascada de `down.sql` que este
repo tiene documentada como cicatriz) o reescribir la derivación de la 171. Es la pregunta abierta
**N1** de `requirements.md`, con default «no se netea» y la limitación declarada en pantalla.

---

## 7. Alcance por rol, explícito `[P3]`

| Rol | Registrar pago a mensajero | Registrar pago a tienda | Anular | Ver comprobantes |
| --- | --- | --- | --- | --- |
| `maestro` | **sí** | **sí** | **sí** | sí |
| `admin` | **sí** | **sí** | **sí** | sí |
| `adminSatelite` | **no** | **no** | **no** | no (su detalle de cierre no muestra la sección) |
| `adminTienda` | no | **no**, ni para su propia tienda (R2) | no | solo lo suyo, en `/mi-wallet` |
| `mensajero` | no | no | no | solo lo suyo, en `/mis-pagos` |
| sin sesión | no (R3) | no (R3) | no | no |

**El `adminSatelite` aprueba, pero no paga.** Respuesta literal del humano: *aprobar un cierre y
mover dinero no son la misma responsabilidad*. En consecuencia, cuando un `adminSatelite` aprueba
un cierre de su zona, el flujo es **exactamente el de hoy**: se aprueba, el mensajero queda
libre, no aparece ninguna oferta de pago y la deuda queda abierta y visible para quien tiene la
caja. **Contraprueba obligatoria** en los tests (precedente 171/R28): `adminTienda` pidiendo **su
propio** `tiendaId` recibe `forbidden`; `adminSatelite` aprueba sin oferta **y** sus llamadas
directas a registrar y a anular reciben `forbidden`. Sin contraprueba, un guard mal escrito pasa
desapercibido.

---

## 8. Enganche con la aprobación del cierre: dos pasos de verdad

**Decisión: el pago NO viaja dentro de la transacción de aprobación.** Es la traducción técnica de
la decisión 3 del humano, y no es un detalle:

- Si compartieran transacción, **un fallo al registrar el pago haría rollback de la aprobación**
  (así funciona hoy el bloque de `resolverCierre`, `CierresAdminRepository.ts:510-714`). El cierre
  volvería a `solicitado`, que es estado **bloqueante** (`OrdenRepository.ts:136-140`): el
  mensajero se quedaría sin poder trabajar al día siguiente por un problema administrativo ajeno a
  él. Es exactamente lo que el humano descartó.
- Con dos escrituras: se aprueba (el mensajero queda libre) y el pago se registra después. Si
  falla, el resultado es «cierre aprobado, deuda abierta y visible» — el estado que el humano
  pidió.

```
[Aprobar] ─► (si hay incidentes) sub-modal de indemnizaciones ─► aprobarCierre()
                                                                   │ ok + pendientePagoMensajero
                                                                   ▼
                                        pendiente > 0 y actor puede pagar ?
                                          │ sí                        │ no  (incluye adminSatelite)
                                          ▼                           ▼
                            sub-modal «Registrar el pago»          cerrar (como hoy)
                            [Registrar]        [Ahora no]
                                 │                   │
                       registrarPagoMensajero    cierre aprobado con deuda visible (R26)
```

`AprobarCierreServiceResult.ok` gana `pendientePagoMensajero: string`, calculado en el servidor
(R14: la UI no hace aritmética con dinero). Es aditivo: el resto del contrato de la 38/158 no
cambia. **«Ahora no» no es un estado**: no se persiste nada y el pendiente se vuelve a derivar
cada vez que alguien mira el cierre.

Segundo camino (R19): el detalle de un cierre **ya aprobado** —al que se llega con el botón «Ver»
del histórico, `CierresAdminModule.tsx:606-648`— muestra la sección «Pago al mensajero» con el
pendiente, la lista de comprobantes (con sus anulados) y el botón de registrar.

---

## 9. Efecto en la caja principal: lo que hace la 172 y lo que le deja a la 173 `[P2]`

| Flujo | Caja principal hoy | Qué hace la 172 |
| --- | --- | --- |
| Aprobar cierre | `egreso_pago_mensajero = P` (el **costo total** del pago al mensajero) | nada: ya está |
| Liquidar a un mensajero | — | **nada**. El costo ya se cargó al aprobar; volver a emitir sería doble conteo. El propio código lo declara: `WalletMensajeroFeedService.ts:19-21` |
| COD recaudado | **no entra** en la caja (es crédito de la tienda, no ingreso de Ordenex) | nada |
| Pagar a una tienda | — | **nada**. Emitir `egreso_pago_tienda` restaría de la caja un dinero que nunca entró: el balance —que hoy se lee como ganancia— se hundiría |
| **Anular** cualquier pago | — | **nada** (R40): si no se emitió egreso al pagar, no hay nada que revertir |

**Lo que la 172 le deja preparado a la 173** (sin invadirla): el pago a la tienda ya es una fila
con id propio, así que el día que la caja pase a tesorería, la 173 emite
`{ tipo:"egreso", categoria:"egreso_pago_tienda", origenTipo:"pago_tienda", origenId:<pago.id> }`
y la idempotencia se la da **gratis** el índice único parcial `(origen_tipo, origen_id,
categoria)` que la 42 ya tiene; y para la anulación tendrá el mismo ancla con `ingreso_ajuste`.
Ni una decisión de la 173 queda tomada aquí.

---

## 10. Frontend

### 10.1 Tienda — `/wallet/tiendas`

La 171 dejó los dos enganches montados y sin usar:

- `SaldosTiendasTable.tsx:176-178` pasa `acciones={<RegistrarPagoTiendaBoton .../>}` a
  `DesgloseMovimientosTienda` (prop ya existente, `:253-266`). Es **la única línea** que se toca
  de ese archivo.
- Tras registrar o anular, `mutate(claveDesgloseTienda(tiendaId))` (`:79-102`) refresca **solo**
  esa tienda: ni la página, ni los desgloses de las demás (R33).

Componentes compartidos en `components/shared/liquidacion/` —**porque los usan dos features de
pantalla distintas** (`wallet/tiendas` y `cierres-admin`), que es el umbral que
`docs/architecture.md` fija para promover—: `RegistrarPagoDialog.tsx`, `PagosRegistradosTabla.tsx`
(con la marca de anulado y el control de anular) y `AnularPagoDialog.tsx` (motivo obligatorio,
molde del sub-modal de rechazo de cierre, que ya exige motivo).

### 10.2 Mensajero — `/cierres-admin`

Sub-modal de pago tras aprobar (§8) + sección «Pago al mensajero» en el detalle de un cierre
aprobado + marca de «pendiente de liquidar» en la fila del listado (R26). La marca sale de
`pendientePagoMensajero` y no se calcula en el cliente.

### 10.3 Los beneficiarios

- **Mensajero (`/mis-pagos`)**: no se toca. Su libro ya se lista entero y el movimiento
  `liquidacion` aparece con su etiqueta, que ya existe
  (`app/(app)/mis-pagos/_components/mis-pagos-labels.ts`). R54 se **verifica**, no se implementa.
- **Tienda (`/mi-wallet`)** `[P5]`: la cabecera pasa de dos importes a los **tres** de la 171 (a
  favor / cargos / pagado) reutilizando `derivarDesgloseTienda` y `CUBETA_POR_CATEGORIA`
  (`lib/utils/desglose-tienda.ts`) **por importación, no por copia**. Sin esto, la tienda ve su
  pago sumado dentro de «Débitos», indistinguible de un cargo.

### 10.4 Censo de tablas (R57)

`PagosRegistradosTabla` es una instancia de `<DataTable>` montada en **dos** sitios ⇒ 1 archivo, 2
instancias en el censo. Descarga: **Familia B** (`filasLocales`), porque la lista llega completa y
sin paginar (son pocos comprobantes por cierre/tienda). Los totales duros del censo **se leen en
el momento de implementar y se suman**, no se copian de este documento: ya han cambiado dos veces
(25/30/25/31 → 24/29/24/30 → +1 por la 171).

---

## 11. Alternativas descartadas

**A) Registrar el pago DENTRO de la transacción de aprobación del cierre.** *Descartada.* Es la
lectura literal de «se pregunta al aprobar» y sería más simple: una sola escritura, atomicidad
gratis. Pero acopla el desbloqueo del mensajero al éxito de un trámite administrativo: un fallo
del pago revierte la aprobación y el cierre vuelve a `solicitado`, que **bloquea**
(`OrdenRepository.ts:136-140`). Es la consecuencia en cadena que el humano descartó al decidir que
son dos pasos.

**B) Sin tabla nueva: columnas `metodo`/`referencia`/`nota`/`fecha_pago` en los dos libros.**
*Descartada.* Evita una tabla, pero: (i) añade 4 columnas nulas al 99 % de las filas de dos tablas
append-only que escribe un feed automático; (ii) duplica el mismo bloque de columnas en dos
sitios; (iii) deja sin **entidad pago**: el `origen_id` del movimiento tendría que apuntar a algo
que no existe, y la clave de idempotencia acabaría siendo una columna suelta del libro; y (iv) la
173 no tendría a qué enganchar el egreso de caja.

**C) Idempotencia por clave natural `(beneficiario, monto, método, fecha_pago)`.** *Descartada.*
No necesita que el cliente genere nada, pero **bloquea pagos legítimos repetidos**: dos entregas
de ₡5 000 en efectivo el mismo día al mismo mensajero son dos pagos, y el segundo desaparecería en
silencio — el peor fallo posible en dinero, porque el saldo quedaría alto y nadie vería el error.

**D) Un ciclo de corte por tienda («cierre de tienda») al que atar el pago.** *Descartada por el
humano* (decisión 4) y confirmada aquí: sería una entidad nueva con su propio estado, su
aprobación y su pantalla. Es una feature en sí misma.

**E) Emitir `egreso_pago_tienda` en la caja principal al pagar a la tienda.** *Descartada* (§9,
`[P2]`). Es lo que pedía el borrador de la 43
(`specs/43-wallet-por-tienda/requirements.md:240-244`), escrito antes de que el humano decidiera
el cambio de la caja a tesorería. Hoy el COD **no entra** en la caja, así que su salida la dejaría
estructuralmente negativa. Se descarta **por orden de ejecución**, no por desacuerdo: es la 173.

**F) Un servicio por tipo de beneficiario.** *Descartada.* Simetría aparente, duplicación real del
camino money-critical (permisos, candado, idempotencia, atomicidad).

**G) Añadir `cierre_id` a `pago_mensajero_movimiento` para que el filtro por cierre sea directo.**
*Descartada.* Resolvería R52 sin el `OR` de dos pasos, pero exige **backfillear** filas de un libro
declarado inmutable y añade una segunda forma de decir de dónde viene un movimiento.

**H) `[P4]` Anular marcando el pago (`anulado_at`/`anulado_por` en `liquidacion_pago`) en vez de
tabla propia.** *Descartada.* Es menos SQL, pero convierte el documento en fila **mutable**, lo
que contradice R41 y el estándar que 42/43/44 fijaron para todo lo que toca dinero; y deja el
estado «anulado» en dos sitios (la marca y el contraasiento) que pueden desincronizarse. Con tabla
aparte, el estado se **deriva** de la existencia de una fila y no hay nada que sincronizar.

**I) `[P4]` Anular borrando la fila del pago y su movimiento.** *Descartada de plano.* Es
exactamente lo que el ledger append-only existe para impedir: destruiría la evidencia de que el
pago se registró y de que alguien se equivocó, que es lo que hace útil una anulación.

**J) `[P4]` Permitir editar el monto de un pago mal tecleado.** *Descartada* (R65). Una edición no
deja rastro de la cifra anterior y obliga a recalcular saldos en sitio. «Anular + registrar de
nuevo» produce el mismo estado final con historia completa.

**K) `[P1]` Serializar con `isolationLevel: "Serializable"` en vez de un bloqueo de fila.**
*Descartada.* Postgres abortaría una de las dos transacciones con un error de serialización, que
llega como fallo genérico y obligaría a implementar reintentos en el borde de una operación de
dinero. El bloqueo de fila es local, determinista, no necesita reintento y ya tiene precedente en
el repo (feature 41/R23).

**L) `[P1]` Bloqueo consultivo (`pg_advisory_xact_lock`) sobre el hash del beneficiario.**
*Descartada.* Los hashes colisionan (dos beneficiarios distintos podrían compartir candado, y eso
degrada en silencio) y no hay ninguna relación con la fila real. `FOR UPDATE` sobre la fila exacta
dice lo que hace.

---

## 12. Archivos que toca

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `db/migrations/<ts>_liquidacion_pago/{migration.sql,down.sql}` | 2 tablas + los 2 CHECK heredados |
| `lib/types/liquidacion.ts` | DTOs + schemas zod |
| `lib/utils/pendiente-cierre.ts` | Derivación pura del pendiente |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` · `lib/repositories/LiquidacionPagoRepository.ts` | Acceso a datos (incluido el `FOR UPDATE`) |
| `lib/interfaces/services/ILiquidacionService.ts` · `lib/services/LiquidacionService.ts` | Lógica |
| `lib/actions/liquidacion.ts` | 5 Server Actions |
| `components/shared/liquidacion/RegistrarPagoDialog.tsx` · `AnularPagoDialog.tsx` · `PagosRegistradosTabla.tsx` · `liquidacion-labels.ts` · `pagos-registrados-descarga-columnas.ts` | UI compartida |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `db/schema.prisma` | `LiquidacionPago` + `LiquidacionAnulacion` + lados inversos en `Usuario` y `CierreDia` |
| `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` · `IWalletTiendaMovimientoRepository.ts` + sus repos | `fechaMovimiento?` opcional; filtro por cierre con `OR` (solo el del mensajero) |
| `lib/interfaces/services/ICierresAdminService.ts` · `lib/services/CierresAdminService.ts` | `pendientePagoMensajero` en el resumen y en el resultado de aprobar |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` (+ `cierre-detalle-shared`/`cierre-factura` si procede) | Sub-modal de pago, sección del cierre aprobado, columna de pendiente |
| `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx` | Pasa `acciones` (una línea) |
| `app/(app)/mi-wallet/**` | `[P5]` cabecera de tres importes reutilizando `derivarDesgloseTienda` |
| `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` | Censo + totales |

**Que NO se tocan:** `lib/services/WalletMensajeroFeedService.ts`, `WalletTiendaFeedService`,
`lib/utils/saldo-tienda.ts`, `lib/utils/cuenta-por-pagar.ts`, `lib/actions/wallet.ts`,
`lib/analytics/**` y ninguna migración anterior.

---

## 13. Verificación: por qué NO hay E2E

`CHECKPOINTS.md` pide un E2E para «flujos críticos (auth, **pagos**, recaudo…)». **Se declara
inaplicable por decisión del humano** («no más e2e, pruebas básicas nada más»): el repo tiene
`e2e/*.spec.ts` pero sin harness ejecutable, y los specs recientes registran esa suite como *NOT
EXECUTED*. El riesgo que un E2E cubriría —que la cadena entera funcione, no solo las piezas— se
cubre por dos vías ejecutables:

1. **Tests de integración de la cadena de servidor completa** (acción → servicio → repositorios
   dobles con la semántica real de los constraints **y del bloqueo**): registrar baja el saldo, el
   segundo envío con la misma clave no lo vuelve a bajar, anular lo devuelve al valor exacto de
   antes, y dos operaciones simultáneas no se pasan del disponible. Molde:
   `tests/integration/db/wallet-idempotencia.test.ts`.
2. **Tests de componente sobre las dos pantallas** con las Server Actions mockeadas: el sub-modal
   aparece tras aprobar, «Ahora no» deja el cierre aprobado, el botón se deshabilita con monto
   inválido, anular pide motivo y tras registrar se refresca **solo** esa tienda.

El round-trip real de la migración (up → down → up) y el rechazo real de una fila incoherente
quedan como verificación **manual** del implementer, documentada en
`progress/impl_172-liquidacion.md`, exactamente como hicieron la 43 y la 44.

---

## 14. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | El `ADD CONSTRAINT ... CHECK` **falla al aplicarse** si alguna fila de producción es incoherente, y en Vercel el build migra antes de compilar ⇒ despliegue bloqueado | **T A.0**: verificar con el MCP de Supabase, en **producción y preview**, que no hay filas que lo incumplan, ANTES de escribir la migración (R61) |
| 2 | Doble clic ⇒ doble pago | Clave de idempotencia con `UNIQUE` + relectura por clave (§4.1), con prueba por mutación |
| 3 | Dos operaciones simultáneas superan lo debido | Bloqueo de fila tomado antes de leer el disponible (§4.2), con test de ORDEN y carrera simulada `[P1]` |
| 4 | El documento y el libro divergen | Misma transacción (R39) + test de invariante, con un pago anulado en medio |
| 5 | Filtrar el desglose del mensajero por cierre esconde el pago o su anulación | El `OR` de §5, con test de las dos mitades (R52) |
| 6 | El pago se fecha con el día equivocado y desaparece de su propio rango | Medianoche UTC de `fecha_pago` (§2.4) + test de los dos bordes del filtro |
| 7 | La sección de pago aparece a un `adminSatelite` | Gate en el servicio (`forbidden`) **y** en la pantalla (R4/R6), con contraprueba en los dos |
| 8 | **La anulación deja los importes brutos inflados** | Declarado como **N1** con default; el saldo, que es lo que decide cuánto se paga, siempre es exacto |
| 9 | Se anula un pago de hace meses y cambia un saldo ya comunicado | Declarado como **N2**; la trazabilidad (quién, cuándo, por qué) lo hace visible |
| 10 | Colisión con la 170 fase 2: sus tandas tocan `wallet/tiendas` y `cierres-admin` | Verificar qué tandas siguen en vuelo; esta feature toca **una línea** de `SaldosTiendasTable` y añade campos a `CierreAdminResumen`: el conflicto es textual, no arquitectónico. Decisión del leader (T0.9) |

**Defecto preexistente observado, fuera de alcance:** el filtro `hasta` de los desgloses compara
contra la medianoche UTC del día indicado, así que hoy **ya** excluye casi todo el último día para
los movimientos alimentados por el cierre (que llevan hora real). No se corrige aquí —sería
cambiar el comportamiento de dos pantallas que esta feature no debe tocar—, pero queda escrito para
que no se atribuya a la 172 cuando alguien lo note.
