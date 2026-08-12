# 208 — Pago múltiple por entrega (backend) — Diseño

## 0. Alcance y forma de la costura

Esta ficha crea el MODELO y el CÁLCULO. La captura (panel) y la presentación (módulos de cierre,
descargas) son la **209**. Entre el merge de una y otra hay una ventana en la que el panel viejo
sigue mandando un método ESCALAR, y además lo valida **en el cliente con el MISMO
`gestionarSchema`** (`GestionarOrdenPanel.tsx:334-344` hace `safeParse` con el schema del borde).
Por eso el contrato nuevo es **aditivo**: acepta las dos formas y normaliza (R12), y el DTO de
salida gana el desglose **sin perder** `metodoPago` (R31).

Dos consecuencias que condicionan todo lo demás:

1. `lib/types/gestion-orden.ts` **no puede importar `@prisma/client`** (hoy no lo hace, verificado):
   viaja al bundle del navegador. La validación de la suma en el borde se hace en **céntimos
   enteros** dentro de un util PURO; la aritmética `Prisma.Decimal` empieza donde ya empieza hoy:
   en el servicio y el repositorio (R18/R20/R30).
2. Nada de lo que esta ficha toca puede cambiar la FORMA de `cierre_dia.total_*` (R32): solo cambia
   cómo se llenan.

---

## 1. Modelo de datos

### 1.1 Tabla nueva `gestion_orden_pago`

```prisma
// Feature 208 (R1-R4): DESGLOSE del recaudo al cliente de UNA entrega. 0..N lineas
// (metodo, monto). `gestion_orden.monto_recibido` SOBREVIVE como TOTAL snapshot
// (money-critical, patron 39/56); la invariante SUM(monto) = monto_recibido vive en el
// BORDE (zod + revalidacion Decimal en el service), SIN CHECK en la base (patron 36/F1.4-b).
model GestionOrdenPago {
  id        String          @id @default(uuid())
  gestionId String          @map("gestion_id")
  metodo    MetodoPagoValue                       // enum NATIVO conservado, NO tabla-catalogo
  monto     Decimal         @db.Decimal(12, 2)    // misma escala que monto_recibido
  createdAt DateTime        @default(now()) @map("created_at")

  gestion GestionOrden @relation(fields: [gestionId], references: [id], onDelete: Cascade)

  @@unique([gestionId, metodo]) // D2: un metodo, como mucho una vez, con su monto ya sumado
  @@index([gestionId])
  @@map("gestion_orden_pago")
}
```

`GestionOrden` gana el lado inverso `pagos GestionOrdenPago[]`.

Sin columna `referencia` [D3]. Sin `orden`/`indice`: el orden de lectura lo fija el enum (R22),
no una columna que alguien tendría que mantener coherente.

### 1.2 Migración `db/migrations/<ts>_gestion_orden_pago/`

`migration.sql` (UP), en este orden:

1. `CREATE TABLE "gestion_orden_pago"` con `id/gestion_id/metodo/monto/created_at`, todas
   `NOT NULL`, PK en `id`.
2. `CREATE UNIQUE INDEX "gestion_orden_pago_gestion_id_metodo_key" ON (…)` (R2) +
   `CREATE INDEX "gestion_orden_pago_gestion_id_idx"` (R1).
3. FK `gestion_id → gestion_orden(id) ON DELETE CASCADE ON UPDATE CASCADE`.
4. `ALTER TABLE "gestion_orden_pago" ENABLE ROW LEVEL SECURITY;` **sin ninguna `CREATE POLICY`**
   (R4, patrón `gestion_orden` / `gestion_orden_evidencia`).
5. Backfill (R6/R7):

```sql
INSERT INTO "gestion_orden_pago" ("id","gestion_id","metodo","monto","created_at")
SELECT gen_random_uuid(), "id", "metodo_pago", "monto_recibido", "created_at"
FROM "gestion_orden"
WHERE "monto_recibido" IS NOT NULL
  AND "monto_recibido" > 0
  AND "metodo_pago" IS NOT NULL;
```

`down.sql`: `DROP TABLE IF EXISTS "gestion_orden_pago";` y **nada más** (R9). No toca
`gestion_orden`, así que revertir no pierde el recaudo histórico: el par escalar sigue intacto. Lo
que sí se pierde al revertir son los desgloses MIXTOS creados después de la migración — es el
reverso exacto de la feature, y se documenta en el propio `down.sql`.

**Por qué `> 0` y `metodo_pago IS NOT NULL` en el `WHERE`.** `metodo` es `NOT NULL`: una entrega
histórica con monto y sin método (el caso que hoy cae en el `default: break` de `computeTotales`,
que NO suma) no tiene fila que escribir. Y una entrega SIN COBRO histórica (`monto_recibido = 0`
con `metodo_pago = 'efectivo'`, que es lo que fuerza hoy el panel) debe quedar en CERO líneas para
coincidir con la semántica nueva (R14) — sumar `0.00` a un balde no cambia ningún total, así que la
paridad de R27 se conserva exactamente.

**Lo que la migración NO hace (R8):** no toca `cierre_dia`, `cierre_bodega`, `cierre_maestro` ni
`cierre_detail`, y no recalcula ningún snapshot. Los cierres ya cerrados se calcularon con un único
método por gestión, así que su reparto por método ya era correcto.

---

## 2. Contrato de entrada (borde zod) — `lib/types/gestion-orden.ts`

La rama `entregada` de `gestionarUnionSchema` (`:215-225`) pasa de:

```ts
montoRecibido: z.number().nonnegative("monto invalido"),
metodoPago: z.enum(METODO_PAGO_SEED),
```

a:

```ts
montoRecibido: z.number().nonnegative("monto invalido"),
// FORMA A (legacy, R12): la que manda el panel hasta que aterrice la 209.
metodoPago: z.enum(METODO_PAGO_SEED).optional(),
// FORMA B (R11): el desglose. Monto por linea ESTRICTAMENTE positivo.
pagos: z.array(z.object({
  metodo: z.enum(METODO_PAGO_SEED),
  monto: z.number().positive("monto invalido"),
})).optional(),
```

más un `superRefine` sobre la rama con **cinco** reglas, cada una con su error de campo:

| # | Condición | Resultado | R |
| --- | --- | --- | --- |
| 1 | `metodoPago` y `pagos` presentes a la vez | error en `pagos` | R13 |
| 2 | `pagos` con métodos repetidos | error en `pagos` (espejo del `@@unique`) | R11 |
| 3 | `montoRecibido > 0` y ninguna forma presente (o `pagos: []`) | error en `metodoPago` («método requerido») | R15 |
| 4 | `montoRecibido === 0` y `pagos` no vacío | error en `pagos` | R14 |
| 5 | `pagos` presente y `SUM(monto) ≠ montoRecibido` | error en `pagos` («el desglose debe sumar el monto recibido») | R11 |

La regla 5 usa un util PURO nuevo, `lib/utils/pagos-recaudo.ts`:

```ts
export const aCentimos = (v: number): number => Math.round(v * 100);
export function sumaCuadra(pagos: { monto: number }[], total: number): boolean { … }
```

Céntimos enteros, sin `parseFloat` y sin sumar floats (R30). No importa `@prisma/client` para que
el schema siga siendo importable desde el panel cliente (§0).

**Normalización (R12/R14).** El mismo util expone la función que convierte CUALQUIERA de las dos
formas en la lista canónica que viaja hacia adentro:

```ts
export function normalizarPagos(
  input: { montoRecibido: number; metodoPago?: MetodoPago; pagos?: LineaPago[] },
): LineaPago[];
```

- `pagos` presente → se devuelve tal cual (ya validada).
- solo `metodoPago` y `montoRecibido > 0` → `[{ metodo: metodoPago, monto: montoRecibido }]`.
- `montoRecibido === 0` → `[]`, **sea cual sea** la forma recibida. Éste es el caso «orden SIN
  cobro» que hoy el panel disfraza de `efectivo` (`GestionarOrdenPanel.tsx:331`): con desglose son
  CERO filas, no una fila de efectivo/0 (R14).

`normalizarPagos` es un helper puro y testeable, NO una rama escondida dentro de la Server Action:
es exactamente el punto que la 209 borrará cuando cierre la puerta de compatibilidad.

### 2.1 El resto del camino de escritura

| Archivo | Cambio |
| --- | --- |
| `lib/actions/mis-asignaciones.ts:194-234` (`rawFromFormData`) | lee el desglose del `FormData` como campos repetidos `pagoMetodo` / `pagoMonto` (mismo patrón `getAll` que las evidencias de la 119) y los empareja por índice en `raw.pagos`; **si no viene ninguno, no crea la clave** → el FormData viejo (solo `metodoPago`) sigue parseando igual |
| `lib/actions/mis-asignaciones.ts:246-255` (`toGestionarInput`) | la rama `entregada` emite `pagos: normalizarPagos(data)` y conserva `metodoPago` para la columna deprecada |
| `lib/interfaces/services/IMisAsignacionesService.ts:215-225` (`GestionarInput`) | la variante `entregada` gana `pagos: LineaPago[]` (obligatorio, ya normalizado); `metodoPago` pasa a `MetodoPago \| null` |
| `lib/services/MisAsignacionesService.ts:346-363` | junto a la comprobación existente `montoRecibido == montoCobrar` (Decimal), añade la **revalidación de la suma en `Prisma.Decimal`** (R18): `pagos.reduce(plus).equals(new Prisma.Decimal(montoRecibido))`; si no cuadra → `validation_error` en `pagos` |
| `lib/services/MisAsignacionesService.ts:557-565` (`buildGestionData`) | la rama `entregada` propaga `pagos` y calcula `metodoPago` de compatibilidad: 1 línea → esa; 0 o ≥2 → `null` (R19) |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts:85-88` (`GestionOrdenData`) | gana `pagos?: { metodo: MetodoPagoValue; monto: number }[]` (viaja DENTRO del mismo objeto: `crearGestionYTransicionar` NO cambia de firma y la atomicidad ya provista se conserva, patrón 73/158/193) |
| `lib/repositories/GestionOrdenRepository.ts:374-425` | tras el `create` de la gestión y **dentro de la misma `$transaction`**, `tx.gestionOrdenPago.createMany({ data: pagos.map(p => ({ gestionId, metodo: p.metodo, monto: new Prisma.Decimal(p.monto) })) })`, exactamente donde ya se insertan las evidencias 1..N (R17/R20). Lista vacía → no inserta nada |

---

## 3. Lectura: fila de dominio y proyecciones

### 3.1 Tipo

`lib/interfaces/repositories/ICierreDiaRepository.ts:20-67` (`CierreGestionPendienteRow`) gana:

```ts
/** Feature 208 (R21/R22): desglose del recaudo, money-safe STRING, en orden de enum. */
pagos: { metodo: MetodoPagoValue; monto: string }[];
```

**Obligatorio, no opcional, y sin fallback al par escalar.** El coste es real (≈15 archivos de
fixtures lo tienen que construir) y se paga a propósito: ver §5, alternativa descartada B.
`metodoPago` se CONSERVA en la fila mientras la 209 no lo retire (R31).

### 3.2 Proyecciones (dos definiciones cubren los tres caminos)

- `CierreDiaRepository.WITH_DETALLE` (`:110-142`) → `+ pagos: { select: { metodo: true, monto: true }, orderBy: { metodo: "asc" } }`, y `toPendienteRow` (`:153`) mapea con el mismo `decimalToString` que ya usa (escala 2 fija).
- `CierresAdminRepository.GESTION_ADMIN_SELECT` (`:107-125`) → lo mismo, y `toPendienteRowDesdeSnapshot` (`:219`) mapea igual.
- `CierresBodegaAdminRepository` **no necesita cambio**: reusa `GESTION_ADMIN_SELECT` +
  `toPendienteRowDesdeSnapshot` (`:264`, `:280`). Verificado, no re-descubrir.

`orderBy: { metodo: "asc" }` sobre un enum nativo de Postgres ordena por **orden de declaración**
(`efectivo`, `SINPE`, `transferencia`), que es justo el orden determinista que pide R22 y que la
209 necesita para concatenar la celda de las descargas [D4] de forma estable.

**Guardia (R23).** `tests/unit/guards/pagos-proyeccion.guardia.test.ts`: recorre los archivos que
construyen un `CierreGestionPendienteRow` y afirma que cada proyección Prisma que los alimenta pide
`pagos`. Sin fallback, una proyección que lo olvide daría totales CERO en silencio; la guardia lo
convierte en rojo. No la selecciona ningún grafo de imports, por eso es una guardia y no un test
normal (`docs/verification.md`).

### 3.3 DTO de servicio

`ICierreDiaService.CierreGestionDTO` (`:34-35`) gana `pagos: { metodo, monto }[]` y **conserva**
`metodoPago` (R31); `CierreDiaService:595-603` lo propaga desde la fila. Esto es lo que la 209
consume para pintar el desglose y para las dos descargas [D4].

---

## 4. El cálculo — `lib/utils/cierre-totales.ts`

`computeTotales` (`:53-81`) deja de mirar `g.metodoPago` y `g.montoRecibido` y pasa a iterar
`g.pagos`:

```ts
for (const g of gestiones) {
  if (g.resultado !== "entregada") continue;          // R25
  for (const p of g.pagos) {                          // R24 — [] no aporta nada (R26)
    const monto = new Prisma.Decimal(p.monto);
    switch (p.metodo) {
      case "efectivo":      efectivo = efectivo.plus(monto); break;
      case "SINPE":         simpe = simpe.plus(monto); break;
      case "transferencia": transferencia = transferencia.plus(monto); break;
    }
  }
}
const general = efectivo.plus(simpe).plus(transferencia);
```

`derivarPagos` y `derivarIngresoBodega` (mismo archivo) **no se tocan**: no miran el recaudo.

**Lo que cambia de verdad, y por qué son tests de mutación y no de humo.** `cierre_dia.total_efectivo`
es la `E` del `min(P, E)` del pago al mensajero (feature 44,
`ILiquidacionPagoRepository.ts:96,106`). La fórmula no cambia; **el valor de E sí**. Con el modelo
viejo, una entrega de ₡8.000 cobrada 5.000 en efectivo + 3.000 por transferencia metía los 8.000
enteros en `E`. Un desglose mal sumado no da un número feo en pantalla: le paga de menos o de más a
una persona. La batería exigida (`tests/unit/utils/cierre-totales-pagos.test.ts` +
`cierre-dia-service-totales-mixtos.test.ts`):

1. **Mixta:** 5.000 efectivo + 3.000 transferencia → `efectivo = "5000.00"`, `transferencia =
   "3000.00"`, `general = "8000.00"`. Con el código viejo este test es ROJO en `efectivo`.
2. **Mutación de método:** mover una línea de `efectivo` a `SINPE` cambia EXACTAMENTE dos baldes y
   deja `general` intacto.
3. **Mutación de monto:** ±0.01 en una línea mueve su balde y el general en ±0.01, y ningún otro.
4. **Mutación de resultado:** la misma gestión como `reprogramada` aporta `0.00` en los cuatro (R25).
5. **Borrado de línea:** quitar una línea baja el balde y el general en su monto exacto (nada
   «compensa» desde `monto_recibido`).
6. **Invariante (R28):** sobre un conjunto generado, `general === efectivo+simpe+transferencia` y
   `general === Σ monto_recibido` de las entregadas con líneas.
7. **Paridad (R27):** el mismo conjunto expresado a la vieja (1 línea backfilleada por gestión) da
   los mismos cuatro strings que producía la versión escalar.
8. **Decimal:** `33.33 × 3` repartidos en dos métodos → `"99.99"` exacto; nada de `99.99000000001`.
9. **E del `min(P,E)`:** con un cierre mixto, `crearCierre` recibe `totalEfectivo = "5000.00"`, y el
   pendiente del mensajero se calcula sobre ESA E.

**Guardia de aritmética (R30):** `tests/unit/guards/pagos-aritmetica-decimal.guardia.test.ts` afirma
que `cierre-totales.ts`, `pagos-recaudo.ts` y el tramo nuevo del repositorio no contienen
`parseFloat(`, `Number(` ni `.toFixed()` sobre montos fuera del serializador money-safe. Precedente:
la revisión de la 39 ya usó este criterio.

---

## 5. Alternativas descartadas

### A. Columna `JSONB pagos` en `gestion_orden` en vez de tabla hija — DESCARTADA

Un `jsonb` habría evitado la migración de tabla, el backfill y los ≈15 fixtures. Se descarta por
cuatro razones, en orden de peso:

1. **No hay `@@unique([gestion_id, metodo])` posible.** [D2] es una decisión de la puerta humana, y
   en `jsonb` solo se puede sostener con un trigger o confiando en el borde. La duplicación de un
   método es exactamente el error que produce un total inflado.
2. **Ni tipo ni escala.** El monto viajaría como `number` de JSON, es decir, coma flotante, en un
   camino money-critical donde la regla del repo es `Decimal(12,2)` de punta a punta (R20/R30).
   Postgres no valida un `jsonb` contra el enum `metodo_pago_value`.
3. **Se pierde el agregado en SQL.** Cualquier consulta futura por método (un `GROUP BY metodo`) se
   vuelve `jsonb_array_elements`; con tabla hija es un índice.
4. **Precedente del repo.** `gestion_orden_evidencia` (119) resolvió el MISMO problema —un campo
   singular que pasa a ser 1..N— con tabla hija, unique compuesto, FK CASCADE y RLS sin policies.
   Repetir el patrón cuesta menos que justificar una segunda forma de hacer lo mismo.

### B. `pagos` OPCIONAL en la fila de dominio, con fallback al par escalar cuando venga vacío — DESCARTADA

Habría ahorrado tocar los ≈15 archivos de fixtures y habría hecho la migración indolora para
cualquier proyección que se olvidara del campo. Se descarta porque crea **dos verdades sobre el
mismo dinero**: un repositorio que olvide seleccionar `pagos` seguiría dando totales «plausibles»
por el camino viejo, y el bug —un cierre mixto contabilizado entero en efectivo, o sea, la `E` del
pago al mensajero inflada— sería invisible hasta que alguien cobrara de más. Con el campo
obligatorio y sin fallback, ese olvido da CERO, que es escandaloso e inmediato, y además hay una
guardia (§3.2) que lo caza antes de llegar a producción. Preferimos un fallo ruidoso a un descuadre
silencioso en un camino money-critical.

### C. Agregar los totales con un `GROUP BY metodo` en SQL en vez de iterar filas en TS — DESCARTADA

Sería una consulta y no un bucle. Se descarta porque `computeTotales` recibe hoy el MISMO array
(`CierreGestionPendienteRow[]`) que `derivarPagos` y `derivarIngresoBodega`, y lo consumen tres
caminos con repositorios distintos (vivo, admin, bodega): un agregado en SQL obligaría a una segunda
consulta por camino y a mantener dos definiciones de «lo que suma», justo lo que
`CajaCodFeedService:18` declara como razón para no bajar a las gestiones.

### D. Segunda pareja de columnas (`monto_recibido_2`, `metodo_pago_2`) — DESCARTADA

Tres métodos → tres parejas, seis columnas nullable, y el `switch` multiplicado. No escala, no
expresa el unique y hace ilegible cualquier consulta. Mencionada solo para dejar constancia de que
se consideró y por qué no.

---

## 6. Fronteras verificadas que NO se tocan (R33)

| Archivo | Por qué es inmune |
| --- | --- |
| `CajaCodFeedService` (`:18`, R12) | lee el LEDGER, no las gestiones, por diseño explícito |
| `WalletTiendaFeedService` (`:75`) | su select es `{ordenId, resultado, montoRecibido}`: solo el total, nunca el método |
| `RecaudoAnaliticaRepository` / `AnaliticaFinancieraService` (`:17-22`) | leen los tres `cierre_dia.total_*`; bajar a `gestion_orden` les está PROHIBIDO y hay guardias que lo atornillan |
| `AnaliticaOperativaRollupRepository` | `metodo_pago` no existe en el rollup |
| `descripcion-pago.ts`, todo `LiquidacionPago` (172) | otro dominio [D1] |
| `cierre_dia.total_*`, `cierre_bodega.total_*` | tres columnas, misma forma; solo cambia cómo se llenan (R32) |

La guardia `censo-simpe.test.ts` no estorba: escanea el literal viejo en mayúsculas y el valor
actual del enum es el correcto.

> *Corrección del 2026-08-12 (revisión de la 208).* Esta tabla decía `cierre_maestro`, que NO existe
> en `db/schema.prisma`: el segundo modelo con los tres `total_*` es `CierreBodega` (feature 40).
> Solo cambia el nombre. La guardia de frontera cierra el censo recorriendo TODOS los `model` y
> exigiendo exactamente `["CierreBodega", "CierreDia"]`, así que R32 quedaba cubierto igual.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Un repo nuevo olvida `pagos` → totales 0 | guardia de proyección (§3.2) + campo obligatorio sin fallback |
| El panel viejo deja de funcionar entre los dos merges | R12 + tests explícitos de la forma escalar, en el schema que el panel usa TAMBIÉN en cliente |
| «Sin cobro» crea una línea `efectivo`/0 | R14: `normalizarPagos` fuerza `[]` con `montoRecibido = 0`, y el backfill excluye `monto_recibido = 0` |
| Descuadre en la `E` del `min(P,E)` | batería de mutación §4 (casos 1-9), no tests de humo |
| Float colándose en el borde | util puro en céntimos + revalidación `Prisma.Decimal` en el service + guardia de aritmética |
| ≈15 fixtures rotos por el campo obligatorio | task dedicada (T9) con helper de fixture; es coste aceptado, no accidente |
