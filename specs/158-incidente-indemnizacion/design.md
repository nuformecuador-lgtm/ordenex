# Feature 158 — Design

> Requisitos: `specs/158-incidente-indemnizacion/requirements.md`
> Base asumida: features **153** y **154** aplicadas.
> Todo lo que sigue está verificado contra el código de la rama; las referencias van con
> `archivo:línea` para que el reviewer pueda auditarlas.

## 1. Alcance

**Entra:**

1. `incidente` como quinto resultado de la gestión del mensajero (enum `gestion_resultado`).
2. `egreso_indemnizacion` como categoría de la caja principal (enum `wallet_movimiento_categoria`).
3. Persistencia del monto capturado por el admin y emisión del egreso **dentro de la transacción de
   aprobación del cierre** ya existente.
4. Superficie visible: opción en el panel del mensajero, grupo propio en los dos detalles de cierre,
   captura al aprobar, concepto y desglose en la wallet.

**No entra (y se dice explícitamente):**

- La arista `en_reparto → incidente` y el value `incidente` de `order_status`: los declara la **154**.
- Ledger por tienda (feature 43) y pago al mensajero (feature 44): esta feature **no** los toca (ver
  Q-E).
- Notificaciones (146) y ranking (76): sin cambios.

## 2. Recorrido del dinero (una sola vez, en un solo sitio)

```
mensajero                       admin (aprobar cierre)                    caja 42
─────────                       ──────────────────────                    ───────
gestionar(resultado=incidente)
  └─ gestion_orden(resultado=incidente)                                    (nada)
     orden -> incidente  (TERMINAL)
solicitarCierre()
  └─ gestion.cierre_id = cierre    (snapshot congelado, sin dinero nuevo)  (nada)
                                aprobarCierre(cierreId, indemnizaciones[])
                                  └─ MISMA TX de CierresAdminRepository.resolverCierre:
                                     1) UPDATE gestion_orden.indemnizacion (guardado)
                                     2) feeds 42/43/44 existentes  ────────► ingresos + egresos
                                     3) feed indemnización (lee 1) ────────► 1 egreso por cierre
```

El punto clave del diseño: **el productor de dinero sigue siendo uno solo**,
`CierresAdminRepository.resolverCierre` (`lib/repositories/CierresAdminRepository.ts:404-429`), que
hoy ya orquesta en la misma `tx` los movimientos de la 42, el ledger de la 43 y el libro + egreso de
la 44. La indemnización se engancha ahí, como un feed más.

## 3. Modelo de datos

### 3.1 Enum `gestion_resultado` (Postgres nativo) — `+ incidente`

`db/schema.prisma:551`. Hoy: `entregada | reprogramada | devuelta | rechazada`.

```prisma
enum GestionResultado {
  entregada
  reprogramada
  devuelta
  rechazada
  incidente // feature 158: paquete danado/perdido/robado. TERMINAL, se indemniza.

  @@map("gestion_resultado")
}
```

El valor **debe coincidir literalmente** con el `value` de `order_status` que la 154 da de alta:
`MisAsignacionesService.gestionar` resuelve el estado destino con
`findEstatusIdByValue(input.resultado)` (`lib/services/MisAsignacionesService.ts:318`), es decir, el
mapeo resultado → estado es 1:1 por nombre. Si divergen, la gestión falla con
"catálogo de estados incompleto".

### 3.2 Enum `wallet_movimiento_categoria` — `+ egreso_indemnizacion`

`db/schema.prisma:844` (14 valores hoy). Se añade `egreso_indemnizacion` y se declara en
`WALLET_MOVIMIENTO_CATEGORIA_SEED` (`lib/types/wallet.ts:27-53`), que tiene el doble candado
(`satisfies` + `_EnsureCategoriaExhaustive`) que rompe el build si SEED y enum divergen (R3).

### 3.3 Dónde se persiste el monto: **`gestion_orden.indemnizacion`** (NO `cierre_detail`)

```prisma
model GestionOrden {
  ...
  // Feature 158: monto de la indemnizacion CAPTURADO POR EL ADMIN al aprobar el cierre.
  // NULL = gestion no-`incidente`, o `incidente` cuyo cierre aun no se aprobo.
  indemnizacion Decimal? @map("indemnizacion") @db.Decimal(12, 2)
}
```

**Por qué aquí:**

- El **grano** es exactamente el correcto: un incidente = una gestión. `gestion_orden` ya guarda dos
  montos snapshot con este mismo patrón —`pago_mensajero` (39) e `ingreso_bodega_rechazo` (56),
  `db/schema.prisma:600-601`— y ya se ESCRIBE después de creada la fila (`cierre_id`, `anulada_at`).
- Deja el monto colgando de la gestión que lo justifica (con su causa, su motivo y sus evidencias),
  no de un agregado.

**Por qué NO `cierre_detail`, que es lo que la ficha sugería** (verificado, no asumido):

- `cierre_detail` es un **snapshot INMUTABLE** que se escribe **una sola vez, al SOLICITAR** el
  cierre, dentro de `CierreDiaRepository.crearCierre` (`lib/repositories/CierreDiaRepository.ts:467`).
  El monto de la 158 se captura **al APROBAR**, que es un momento posterior.
- Hay un guard estructural que lo prohíbe explícitamente:
  `tests/unit/repositories/cierre-detail-inmutable.test.ts` falla si cualquier módulo de `lib/` emite
  `cierreDetail.update/updateMany/delete/deleteMany/upsert`, y también si aparece un segundo punto de
  escritura además del `createMany` de `CierreDiaRepository`.
- El modelo no tiene `updated_at` ni `deleted_at` justamente porque no hay camino de escritura
  posterior al INSERT (`db/schema.prisma:1218`), y el mismo test lo verifica.

Usar `cierre_detail` significaría reabrir, en silencio, el bug money-critical que la feature 69 vino a
cerrar. Se descarta (ver también §9.1).

### 3.4 Migración

Carpeta única `db/migrations/<timestamp>_incidente_indemnizacion/`.

`migration.sql` (UP) — aditiva, sin uso de los valores nuevos en la misma migración (requisito de
`ALTER TYPE … ADD VALUE`, patrón de `20260713140000_wallet_egreso_gasto_fijo_variable/migration.sql`):

```sql
ALTER TYPE "gestion_resultado" ADD VALUE IF NOT EXISTS 'incidente';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_indemnizacion';
ALTER TABLE "gestion_orden" ADD COLUMN "indemnizacion" DECIMAL(12,2);
```

`down.sql` (DOWN) — obligatorio (`docs/architecture.md`), espejo exacto:

1. `ALTER TABLE "gestion_orden" DROP COLUMN "indemnizacion";`
2. Recrear `wallet_movimiento_categoria` con los **14** valores previos, soltando y recreando antes/
   después los DOS índices que referencian `categoria` (`wallet_movimiento_tipo_categoria_idx` y el
   único parcial `wallet_movimiento_origen_categoria_uq … WHERE "origen_id" IS NOT NULL`), calcado de
   `20260713140000_wallet_egreso_gasto_fijo_variable/down.sql`.
3. Recrear `gestion_resultado` con los **4** valores previos + `ALTER TABLE "gestion_orden" ALTER
   COLUMN "resultado" TYPE … USING (…::text::…)`. La columna no tiene `DEFAULT` y **ningún índice**
   la referencia (`db/schema.prisma:617-624`: los índices son de `orden_id`, `mensajero_id`,
   `cierre_id`, `anulada_por` + el parcial de la 67), así que no hay índices que soltar.

**Precondición del down** (documentada en el archivo, como el resto del repo): ninguna fila con
`gestion_orden.resultado = 'incidente'` ni `wallet_movimiento.categoria = 'egreso_indemnizacion'`. Si
la hay, el `USING` falla ruidosamente y el rollback aborta — comportamiento CORRECTO: revertir con
indemnizaciones ya emitidas no es seguro.

**RLS:** ninguna tabla nueva. `gestion_orden` y `wallet_movimiento` ya tienen RLS habilitada sin
policies (solo service role); la migración **no toca** RLS ni policies, y el test estático lo afirma.

### 3.5 `down.sql` previos que recrean estos tipos (regla del lote)

Verificado por inspección de `db/migrations/**`:

| Enum | down.sql previos que lo RECREAN |
| --- | --- |
| `wallet_movimiento_categoria` | **1**: `20260713140000_wallet_egreso_gasto_fijo_variable/down.sql` (lista 12 valores, estado pre-45). El de `20260712160000_wallet_movimiento` hace `DROP TYPE`, no recrea. |
| `gestion_resultado` | **0**: el único down que lo toca es `20260711150000_gestion_orden_estados_metodo_pago/down.sql:8`, y hace `DROP TYPE IF EXISTS`. |

Convención observada en el repo (cadena de `orden_historial_origen_tipo`, 7 migraciones): cada
`down.sql` lista el estado **anterior a sí mismo** y NO se reescribe cuando llega un value posterior;
lo que sí se actualiza son los **tests** de esas migraciones, que cruzan la lista del down contra el
SEED vigente descontando "los añadidos en o después de" — ver
`tests/integration/db/orden-historial-origen-recepcion-bodega-central-migration.test.ts:83-90`.

Aplicado a esta feature: el único test de migración de enum de wallet
(`tests/integration/db/wallet-egreso-migration.test.ts:66-74`) afirma sobre el down del 45
`toHaveLength(12)` y `not.toContain(egreso_gasto_fijo|variable)` — **no** cruza contra el SEED, así
que **no se rompe** al añadir un valor nuevo. Ver Q-F: la recomendación es NO reescribir ese
`down.sql` (rompería su test y falsearía su punto en el tiempo), y en su lugar dejar el
comentario/cruce explícito en el test nuevo de esta migración. **La fase backend debe correr
`tests/integration/db` completo** para confirmarlo antes de cerrar.

## 4. Backend — reporte del incidente (gestión)

Camino existente, sin service nuevo (Q-A recomendada = el mensajero reporta):

- **Borde (zod)** `lib/types/gestion-orden.ts:121` — `gestionarUnionSchema` gana una quinta variante
  discriminada por `resultado: "incidente"`, con `causaIncidente` (enum cerrado), `motivo`
  (obligatorio, igual que en `devuelta`) y `evidencias` según Q-B. Al ser `discriminatedUnion`, los
  campos nuevos **no existen** en las otras cuatro ramas: un cliente no los puede colar (mismo
  blindaje que la feature 73/R10).
- **Server Action** `lib/actions/mis-asignaciones.ts` — `gestionar(FormData)`: lee el campo nuevo,
  sin cambiar la forma del resultado (`GestionarResult`).
- **Service** `lib/services/MisAsignacionesService.ts` — `gestionar()` funciona **sin cambios de
  flujo**: la guardia de origen (`en_reparto`), el bloqueo 1-a-1, la subida compensada de evidencias
  y la transacción `crearGestionYTransicionar` ya son genéricas. Sólo hay que:
  - añadir el `case "incidente"` a `buildGestionData` (switch exhaustivo, `:474`);
  - incluir `incidente` en la lista de resultados que suben evidencia (`:333-337`) si Q-B lo exige.
  - `montoRecibido`/`metodoPago` NO aplican (no hay recaudo).
- **Historial**: la transición la escribe el choke point `appendCambioEstado`
  (`lib/repositories/registrar-cambio-estado.ts`), que valida el par `(en_reparto, incidente)` contra
  `TRANSICIONES`. La 154 declara esa arista, así que no hay nada que declarar aquí… salvo la familia:
  ver **Q-G**.
- **Deshacer** (`CierreDiaService.deshacerGestion`): `ESTADOS_ESPERADOS`
  (`lib/services/CierreDiaService.ts:78`) es un `Record<GestionResultado, readonly string[]>` — el
  build ROMPE hasta clasificar `incidente`. Se añade `incidente: ["incidente"]` y la arista
  `incidente → en_reparto` vía `deshacer_gestion` en `TRANSICIONES` (Q-D).

**Funciones puras de dinero: cero cambios necesarios, y es intencional.**
`pagoPorResultado` (`lib/utils/pago-mensajero.ts:18`) devuelve `"0.00"` para todo lo que no sea
`entregada`; `ingresoBodegaPorResultado` (`lib/utils/ingreso-bodega.ts:23`) para todo lo que no sea
`rechazada`; `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts:96`) devuelve `{}` para cualquier
otro resultado. Un `incidente` no paga al mensajero, no factura flete ni IVA y no genera ingreso de
bodega (R17). Esto **se testea explícitamente** en lugar de darse por hecho: es un comportamiento
que hoy depende de un `return` por defecto y una feature futura podría cambiarlo sin darse cuenta.

## 5. Backend — cierre del día

`CierreDiaRepository.crearCierre` vincula **todas** las gestiones vigentes sin cierre del mensajero
(`lib/repositories/CierreDiaRepository.ts:392`), así que las `incidente` entran solas (R16), reciben
`pago_mensajero = 0.00` / `ingreso_bodega_rechazo = 0.00` por los mapas ya calculados, y su orden
recibe su fila de `cierre_detail` por el dedupe por `ordenId` (`:452-467`). **Sin cambios de
repositorio.**

Lo que sí cambia por tipos (red de seguridad, §8): `CierreGrupos = Record<CierreResultado, …>`
(`lib/interfaces/services/ICierreDiaService.ts:147`) pasa a tener 5 claves, y con él los mapas de
presentación de los dos detalles.

## 6. Backend — aprobación, captura y egreso

### 6.1 Contrato de entrada (Server Action)

`lib/types/cierres-admin.ts:20` — hoy `aprobarCierreSchema = cierreIdSchema`. Pasa a:

```ts
export const indemnizacionSchema = z.object({
  gestionId: z.string().uuid(),
  monto: montoPositivoSchema, // reuso de lib/types/wallet.ts:130 (STRING, 2 dec, > 0)
});

export const aprobarCierreSchema = z.object({
  cierreId: z.string().uuid(),
  // Feature 158: una entrada por gestion `incidente` del cierre. Lista vacia/ausente = cierre
  // sin incidentes (retrocompatible con el contrato de la 38).
  indemnizaciones: z.array(indemnizacionSchema).default([]),
});
```

Money-safe (R24): el monto viaja **STRING** de extremo a extremo y se convierte a `Prisma.Decimal`
sólo al escribir, exactamente como `montoPositivoSchema` ya hace en la wallet (45). Nunca `number`,
nunca `parseFloat`.

`lib/actions/cierres-admin.ts:128` — `aprobarCierre(input)` sigue siendo Server Action (mutación
interna; `docs/architecture.md`), con el mismo `withErrorHandler` y el mismo mapeo
ZodError → `validation_error`.

### 6.2 Guardias en el service

`CierresAdminService.aprobarCierre` (`lib/services/CierresAdminService.ts:185`) añade, **antes** de
llamar al repo y después de resolver el alcance (R25):

1. Lee las gestiones `incidente` del cierre (dentro del alcance ya resuelto).
2. **Cobertura exacta**: el conjunto de `gestionId` recibidos debe ser IGUAL al conjunto de gestiones
   `incidente` del cierre. Falta alguna → `validation_error` con `fieldErrors` por gestión (R19/R20);
   sobra alguna, o no es `incidente`, o es de otro cierre → `validation_error` (R21).
3. Cierre sin incidentes + lista vacía → camino de hoy, intacto (R36).

Resultado de dominio: se reutiliza `AprobarCierreServiceResult` añadiéndole `validation_error`
(el tipo de la action ya lo contempla, `lib/types/cierres-admin.ts:45`).

### 6.3 Escritura y emisión, en la MISMA transacción

`ResolverCierreInput` (`lib/interfaces/repositories/ICierresAdminRepository.ts:65`) gana un campo
opcional, siguiendo el patrón EXACTO de `liberacionSinGestionar` (109) y `devolucionRechazadas` (139):

```ts
  // Feature 158: presente SOLO al aprobar. Montos capturados por el admin, uno por gestion
  // `incidente` del cierre. Ausente/vacio = el cierre no tiene incidentes.
  indemnizaciones?: ReadonlyArray<{ gestionId: string; monto: string }>;
```

Dentro de la `tx` de `resolverCierre`, **sólo en la rama `aprobado`** y después de que el
`updateMany` guardado haya aplicado (`res.count === 1`):

1. `tx.gestionOrden.updateMany({ where: { id, cierreId, resultado: "incidente" }, data: {
   indemnizacion: new Prisma.Decimal(monto) } })` por cada monto. El `where` lleva `cierreId` y
   `resultado` como **guardia** (no como filtro cosmético): una gestión ajena no se puede tarifar.
   Si algún `count` es 0 → `throw` → rollback de TODO (R21/R22).
2. `WalletIndemnizacionFeedService.construirEgresoIndemnizacion(cierreId, tx)` — service nuevo,
   hermano de `WalletFeedService` / `WalletMensajeroFeedService`: **lee de la base lo que el paso 1
   acaba de escribir** (`SUM(indemnizacion)` de las gestiones `incidente` del cierre) y devuelve 0 o
   1 `CrearMovimientoInput`. No recibe montos por parámetro: así el libro no puede divergir de lo
   persistido (misma filosofía que la 69).
3. `walletMovimientoRepo.crearMovimientos(tx, egreso)` — el repo de la 42 ya existente
   (`lib/repositories/WalletMovimientoRepository.ts:58`), con `skipDuplicates` → **idempotencia por
   el índice único parcial** `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`
   (`db/migrations/20260712160000_wallet_movimiento/migration.sql:71`). Aprobar dos veces no duplica
   el egreso (R28).

Movimiento emitido (R26):

```ts
{ tipo: "egreso", categoria: "egreso_indemnizacion", monto: "<SUMA>",
  origenTipo: "cierre_dia", origenId: cierreId, descripcion: null, registradoPor: null }
```

`registradoPor` va `null` como en todos los movimientos automáticos; la autoría humana ya queda en
`cierre_dia.resuelto_por` / `resuelto_at` (38/R14). Si la SUMA es 0 (sin incidentes) **no se emite
fila** (R27), igual que el feed de ingresos omite conceptos en 0.00 y el de la 44 omite `P = 0`.

### 6.4 Rechazo

`rechazarCierre` no recibe montos y no toca `gestion_orden.indemnizacion` (R23). El cierre rechazado
es re-solicitable (109/R28): cuando se apruebe, se capturará entonces.

## 7. Frontend

### 7.1 Panel del mensajero — `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx`

- `type Resultado` (`:50`) y `RESULTADO_BOTONES` (`:63`) ganan `incidente`, con etiqueta
  **"Reportar incidente"**, icono propio (`PackageX`/`ShieldAlert` de lucide) y tratamiento visual de
  excepción (destructivo/outline), separado de los cuatro botones de desenlace normal: no es "cómo
  terminó la entrega", es "el paquete no existe o no sirve".
- Rama nueva en `buildRaw()` (`:227`) y `buildFormData()` (`:261`): causa + motivo + evidencias según
  Q-B. `CausaField` (`:618`) se reutiliza **como patrón** con su propio catálogo de opciones
  (`causa-incidente-options.ts`, hermano de `causa-devolucion-options.ts`), radios móvil-first.
- El gate de guía (`VerificarGuiaGate`, `:436`) **se mantiene** para `incidente` (R12). Nota de
  usabilidad verificada: el gate admite teclear el `num_guia`, que el propio panel muestra en
  pantalla (`:375`), así que un paquete perdido o robado no deja al mensajero atascado.
- Validación en cliente con el mismo `gestionarSchema` (R33), como hoy.

### 7.2 Detalles de cierre

- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`: `RESULTADO_LABEL` (`:30`),
  `RESULTADO_VACIO` (`:37`) y `ORDEN_RESULTADOS` (`:176`) ganan `incidente` → "Incidentes" /
  "No hay incidentes."; `columnasPara` (`:742`) devuelve para `incidente` las columnas comunes +
  causa + motivo + evidencias + **monto de indemnización** (`—` mientras el cierre no esté aprobado).
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` (vista del mensajero): mismo grupo nuevo,
  sin montos de dinero (el mensajero no ve la indemnización: no es plata suya).

### 7.3 Captura al aprobar — `app/(app)/cierres-admin/_components/CierresAdminModule.tsx`

Sub-modal **espejo del de rechazo** (`:471`, motivo obligatorio), que es el precedente exacto de
"aprobar/rechazar con un dato extra":

- El botón **Aprobar** (`:461`) abre el sub-modal **sólo si el detalle tiene incidentes**; si no,
  aprueba directo como hoy (R36).
- Una fila por incidente: guía + destinatario + causa + `Input` de monto.
- `confirmarAprobacion` (`:187`) manda `{ cierreId, indemnizaciones }`. El botón de confirmar queda
  deshabilitado mientras falte o sea inválido algún monto (R34), validando en cliente con
  `montoValido` (`app/(app)/wallet/_components/wallet-labels.ts:107`) — mismo criterio que el
  servidor, sin `parseFloat`.
- Los `validation_error` del servidor se pintan por fila (patrón `motivoError`).

### 7.4 Wallet

- `wallet-labels.ts:31` `CATEGORIA_LABEL` gana `egreso_indemnizacion: "Indemnización por incidente"`
  (el `Record` completo rompe el build si falta, R31). El filtro por categoría se puebla desde el
  SEED, así que aparece solo.
- Desglose (R32): `DesgloseEgresosDTO` (`lib/types/wallet.ts:117`) y `DesgloseEgresosAgregado`
  (`lib/interfaces/repositories/IWalletMovimientoRepository.ts:58`) ganan `indemnizacion`;
  `agregarPorCategoria` (`lib/repositories/WalletMovimientoRepository.ts:114`) suma la categoría
  nueva; `WalletEgresoService.verDesgloseEgresos` (`lib/services/WalletEgresoService.ts:116-126`) la
  incluye en el `total`; `DesgloseEgresosCard.tsx:15` gana la fila "Indemnizaciones".
  El título de la tarjeta pasa a **"Egresos"** o similar: "administrativos" dejaría de ser cierto
  (la indemnización es operativa, no administrativa) — cambio de copy, sin cambio de datos.
- `esEgresoAdministrativo` (`wallet-labels.ts:113`) exige `origen_tipo = "gasto"`; la indemnización
  es `cierre_dia`, así que **no** ofrece reversa (R30) sin tocar nada. Se testea para fijarlo.

## 8. Redes de seguridad que rompen el build (no relajarlas)

Añadir un valor a `GestionResultado` rompe la compilación en todos los `Record<GestionResultado, …>`
hasta clasificarlo. Es el mecanismo que garantiza que no queda ningún sitio sin decidir:

| Lugar | Archivo |
| --- | --- |
| `ESTADOS_ESPERADOS` del deshacer | `lib/services/CierreDiaService.ts:78` |
| `CierreGrupos` (5 claves) | `lib/interfaces/services/ICierreDiaService.ts:147` |
| `RESULTADO_LABEL` / `RESULTADO_VACIO` | `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:30,37` |
| `buildGestionData` (switch exhaustivo) | `lib/services/MisAsignacionesService.ts:474` |
| `CATEGORIA_LABEL` (wallet) | `app/(app)/wallet/_components/wallet-labels.ts:31` |
| SEED de categorías (doble candado) | `lib/types/wallet.ts:27-53` |

Prohibido "resolverlo" con `default:`, `?? ""` o un cast: la exhaustividad ES el diseño.

## 9. Alternativas descartadas

**9.1 Persistir el monto en `cierre_detail`** (era la hipótesis de la ficha). Descartada por
evidencia: la tabla es un snapshot inmutable escrito sólo al SOLICITAR el cierre, sin `updated_at`, y
un test estructural (`tests/unit/repositories/cierre-detail-inmutable.test.ts`) prohíbe cualquier
escritura fuera del `createMany` de `CierreDiaRepository`. Escribir ahí al APROBAR obligaría a
derogar ese guard y reabriría el vector money-critical que cerró la feature 69. Detalle en §3.3.

**9.2 Un movimiento de wallet por incidente, con `origen_tipo = gestion_orden`** (valor ya reservado y
sin uso, `lib/types/wallet.ts:57`; sería idempotente por `origen_id = gestionId`). Descartada: todo el
dinero de un cierre se lee hoy por `origen_id = cierreId`, y partirlo en dos orígenes obligaría a las
conciliaciones y a la vista del libro a unir dos criterios para responder "cuánto costó este cierre".
La trazabilidad por orden no se pierde: vive en `gestion_orden.indemnizacion`. Se agrega por cierre,
igual que `egreso_pago_mensajero = P` (44/R17).

**9.3 Que el monto viaje por parámetro hasta el feed y de ahí al movimiento.** Descartada: el feed lee
de la base lo recién escrito dentro de la misma `tx` (§6.3). Si el movimiento se construyera con el
número del request y la escritura de `gestion_orden` fallara parcialmente, el libro y el detalle
dirían cosas distintas sobre la misma plata. Es la misma lección de la 69: el cierre no pregunta al
mundo vivo, recuerda lo que quedó escrito.

**9.4 Emitir el egreso en el momento del reporte del mensajero** (al gestionar). Descartada por
decisión del humano y porque violaría el principio de un único productor: el mensajero no puede
originar un egreso sin aprobación, y en ese instante todavía no existe monto.

**9.5 Crear una tabla nueva `cierre_indemnizacion`.** Descartada por sobre-ingeniería: sería 1:1 con
la gestión (misma cardinalidad, misma vida), duplicaría FKs y RLS y no aporta ningún dato que la
gestión no tenga. Se reconsideraría sólo si un día hiciera falta historial de re-tarifación.

**9.6 Reutilizar `egreso_ajuste` con una descripción de texto.** Descartada: el desglose y los
filtros de la wallet quedan ciegos (no se puede sumar "indemnizaciones" sin parsear texto), y el
humano pidió el concepto **visible**. Un `ALTER TYPE ADD VALUE` es aditivo y barato.

## 10. Preguntas abiertas

> Cada una lleva **recomendación** y qué cambia si el humano decide lo contrario. Ninguna bloquea el
> arranque del backend salvo donde se indica.

### Q-A — ¿Quién reporta el incidente: el mensajero al gestionar, o sólo un admin?

**Recomendación: el mensajero, como quinto resultado de la gestión.**

- Es lo que la 154 ya declaró: la arista `en_reparto → incidente` viene con `via: "gestion", rol:
  "mensajero"`. Un camino sólo-admin necesitaría **otra** arista (desde otros orígenes) y una pantalla
  nueva.
- Es el único que tiene la información: la orden está en reparto, en sus manos.
- No abre riesgo de fraude: el mensajero **no produce dinero**. Sólo marca el hecho; el precio y la
  aprobación son del admin (§6.2). El control económico queda intacto.
- Coste si se decide sólo-admin: se cae toda la sección B de requisitos (R6-R12), no hace falta tocar
  `gestion_resultado`… pero entonces `incidente` deja de ser un resultado de gestión y hay que
  decidir cómo se relaciona con el cierre y con el mensajero responsable. Es una feature distinta.

### Q-B — ¿Motivo tipado y evidencia fotográfica?

**Recomendación: sí a la causa tipada; evidencia obligatoria sólo cuando aplique.**

- **Causa tipada**: enum nuevo `gestion_causa_incidente` con lista CERRADA de 3 valores
  (dañado / perdido / robado), calcado del patrón de la feature 73 (`lib/types/causa-devolucion.ts`:
  SEED + `satisfies` + `_EnsureExhaustive` + opciones de UI en un archivo aparte). Sin "Otro". Es
  información de negocio real: robado y dañado no se gestionan igual aguas abajo.
- **Idioma de los valores**: la 73 los puso en INGLÉS por decisión consciente del humano, pero su
  enum hermano `gestion_resultado` y `order_status` están en español. **Recomiendo español**
  (`danado`, `perdido`, `robado`) por coherencia con el enum al que acompaña — pero es exactamente el
  tipo de detalle que el humano ya decidió una vez al revés: **confirmar en la puerta**.
- **Evidencia**: reusar `GestionOrdenEvidencia` 1..N (feature 119) sin tocar el modelo.
  **Obligatoria (1..N) si la causa es `danado`** — hay paquete que fotografiar y es la prueba del
  daño; **opcional (0..N) en `perdido`/`robado`** — no hay paquete, y exigir una foto obligaría al
  mensajero a inventarla (o a bloquearse en la calle). El `motivo` en texto libre queda **obligatorio
  siempre**, como en `devuelta` (73/R7).
- Coste si se decide "sin causa ni evidencia": se caen R9/R10 y el enum nuevo; el resto del diseño no
  cambia.

### Q-C — ¿Dónde se persiste el monto capturado?

**Recomendación: columna nueva `gestion_orden.indemnizacion` (§3.3). `cierre_detail` está
descartado por evidencia, no por preferencia** (snapshot inmutable escrito al solicitar, con guard
estructural). La ficha lo daba por "lo natural"; se verificó y no lo es.

### Q-D — ¿Se puede deshacer un `incidente`?

**Recomendación: sí, con la misma ventana que el resto (mientras `cierre_id IS NULL`).**

- Precedente exacto: `entregada` también es TERMINAL y conserva su arista de deshacer (#31,
  `lib/types/order-status-transiciones.ts:93-96`).
- En esa ventana no ha pasado nada económico (el monto se captura al aprobar), y un toque en falso en
  la calle dejaría la orden muerta para siempre.
- Requiere declarar `incidente → en_reparto` vía `deshacer_gestion` (rol mensajero). La 154 no la
  menciona: **hay que añadirla en esta feature o pedir que la 154 la incluya** — coordinar en la
  puerta. Si se decide que NO se deshace, `ESTADOS_ESPERADOS.incidente = []` y el deshacer debe
  devolver un conflicto con mensaje propio ("un incidente no se puede deshacer"), no el genérico
  "la orden se movió".

### Q-E — ¿La indemnización acredita también a la tienda (ledger de la feature 43)?

**Recomendación: fuera de alcance de la 158.** La decisión del humano dice, literalmente, "genera un
egreso en la wallet" (caja principal). Pero conviene decirlo en voz alta: si el dinero indemniza a la
tienda y su ledger no recibe el crédito, el saldo por tienda no reflejará lo que se le debe y alguien
lo cuadrará a mano. Propuesta: follow-up explícito ("crédito de indemnización en el ledger por
tienda") en vez de improvisarlo aquí.

### Q-F — ¿Se reescriben los `down.sql` previos que recrean `wallet_movimiento_categoria`?

**Recomendación: no reescribirlos; sí cubrirlos con test.** El único candidato es
`20260713140000_wallet_egreso_gasto_fijo_variable/down.sql`, cuya lista de 12 valores es su estado
**punto-en-el-tiempo** (misma convención que las 7 migraciones de `orden_historial_origen_tipo`), y su
test afirma exactamente 12 (`tests/integration/db/wallet-egreso-migration.test.ts:73`): reescribirlo
obliga a reescribir el test y a falsear la historia. Lo que sí exige la regla del lote es **correr
`tests/integration/db` completo** en la fase backend y actualizar cualquier test previo que cruce la
lista de un down contra el SEED vigente. Confirmar en la puerta.

### Q-G — Familia de historial de la transición

La 154 añade `incidente` al enum `orden_historial_origen_tipo`, pero declara la arista con
`via: "gestion"`. Si el append usa `gestion`, la familia `incidente` nace **sin productor**.
**Recomendación: usar `origen_tipo = incidente` en el append de esta transición** (hace el incidente
auditable como familia propia, que es para lo que la 154 la dio de alta) y alinear el metadato `via`
de la arista — el metadato no participa de la decisión de legalidad
(`lib/types/order-status-transiciones.ts:26-35`), así que el cambio es cosmético pero debe ser
coherente. Confirmar contra el spec de la 154 antes de implementar.

## 11. Trazabilidad prevista (R → artefacto)

| R | Dónde se verifica |
| --- | --- |
| R1-R5 | test de migración estático nuevo (`tests/integration/db/incidente-indemnizacion-migration.test.ts`) + `tests/integration/db` completo |
| R6-R8, R11-R12 | `tests/unit/services/mis-asignaciones-*.test.ts` + `tests/integration/actions/*gestionar*` |
| R9-R10 | tests del schema de borde (`lib/types/gestion-orden.ts`) |
| R13 | test de `TRANSICIONES` / choke point (`registrar-cambio-estado`) |
| R14-R15 | `tests/unit/services/cierre-dia-service*.test.ts` (deshacer) |
| R16-R18 | `cierre-dia` (solicitar) + tests de componente de los dos detalles |
| R19-R25 | `tests/unit/services/cierres-admin-service.test.ts` + `tests/integration/actions/cierres-admin-action.test.ts` |
| R26-R30 | `tests/unit/services/wallet-indemnizacion-feed-service.test.ts` + `tests/integration/db/wallet-idempotencia.test.ts` (extensión) |
| R31-R34 | `tests/components/*` (wallet, CierresAdminModule, MisAsignacionesModule) |
| R35-R36 | suite existente en verde, sin modificar sus expectativas |
