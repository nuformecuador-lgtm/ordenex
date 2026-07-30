# Feature 158 — Design

> Requisitos: `specs/158-incidente-indemnizacion/requirements.md`
> Base asumida: features **153** y **154** aplicadas.
> Todo lo que sigue está verificado contra el código de la rama; las referencias van con
> `archivo:línea` para que el reviewer pueda auditarlas.

## 0. Puerta F1.4 — CERRADA el 2026-07-30. Las diez decisiones, con su razón

> Esto está **en el spec** a propósito. La lección «CORRECCIÓN 1» de `progress/current.md` (2026-07-29)
> dice, literalmente, que «gate aprobado» en la bitácora no es lo mismo que las preguntas del spec
> respondidas por escrito, y que **al cerrar una fase 1 las respuestas se escriben EN el spec**. Cada
> decisión lleva la razón del humano y, cuando revierte o contradice algo ya mergeado, lo dice.

### 0.1 Q-A — ¿Quién reporta? **LOS DOS**

Razón textual del humano: **«los dos ya que los dos manipulan paquetes»**.

- **Mensajero:** al gestionar, como QUINTO resultado de gestión, desde `en_reparto`. Es la arista **#44
  que la 154 YA declaró** (`lib/types/order-status-transiciones.ts:143`, `via: "gestion"`,
  `rol: "mensajero"`, marcada «SIN PRODUCTOR hasta la 158»). Es el camino que este spec ya cubría.
- **Admin/maestro:** desde **bodega + tránsitos internos**. Conjunto EXACTO y CERRADO de cinco estados:
  `en_bodega_central`, `en_bodega_satelite`, `en_ruta_bodega_central`, `en_ruta_bodega_satelite`,
  `por_recoger`. Son **5 aristas NUEVAS** hacia `incidente` que hay que declarar en el mapa de la
  guardia central (feature 140). Su `via`/`rol` está justificado contra las aristas vecinas en **§12.3**;
  el efecto sobre el invariante de conectividad y sobre `ESTADOS_TERMINALES` / los tests de la 154 está
  en **§12.4** y **§14**.

### 0.2 Q-B — Alcance del reporte: **causa tipada + evidencia OBLIGATORIA SIEMPRE**

- Enum nuevo de lista **CERRADA de 3 valores, sin «Otro»**, calcado del patrón de la feature 73
  (`lib/types/causa-devolucion.ts`: SEED + `satisfies` + `_EnsureExhaustive` + opciones de UI en archivo
  aparte). El `motivo` en texto libre queda **obligatorio siempre**, APARTE de la causa.
- **La evidencia es 1..N OBLIGATORIA en las TRES causas**, incluidas `perdido` y `robado`.
- **Consecuencia aceptada, declarada y no re-litigada.** Se le planteó al humano la objeción exacta
  («en perdido/robado no hay paquete que fotografiar; bloquea al mensajero en la calle») y eligió esta
  opción de todas formas. Lo que se le pide fotografiar al actor cuando **no hay paquete** es lo que sí
  tiene delante: el vehículo o el compartimento vacío, la guía/etiqueta, el lugar del hecho, o la
  denuncia. El spec no finge que haya un paquete. El coste queda escrito para que quien lo sufra sepa
  que fue elegido: sin batería o sin señal, no se puede reportar un robo.

### 0.3 Q-B (idioma) — **ESPAÑOL**: `danado`, `perdido`, `robado`

Ni `peridido` ni el inglés. Esto **rompe deliberadamente la coherencia con `causa_devolucion`**, que
está en INGLÉS (`not_found`, `wrong_number`, `wrong_address`) por decisión consciente del humano en la
feature 73 —el propio `db/schema.prisma:572-577` avisa: «decision CONSCIENTE del humano aceptada en la
gate (F1.4-g), NO es deuda tecnica ni un descuido — no abrir tickets de "consistencia" por esto»—, a
favor de la coherencia con los enums a los que este ACOMPAÑA: `gestion_resultado` y `order_status`,
ambos en español. **Queda escrito como decisión con su razón para que nadie lo «arregle» después.**
El mismo aviso se replica en el comentario del enum nuevo.

### 0.4 Q-C — El monto del camino del mensajero vive en **`gestion_orden.indemnizacion`** `DECIMAL(12,2)`

Es la recomendación del propio §3.3, no objetada. **`cierre_detail` queda descartado por EVIDENCIA, no
por preferencia** (snapshot inmutable escrito sólo al SOLICITAR, con guard estructural que prohíbe
cualquier escritura posterior). Ver §3.3 y §9.1.

### 0.5 Q-D — **SÍ se puede deshacer un `incidente`**, en ventana controlada

Razón textual: **«como es una app usada por seres humanos y nosotros solemos cometer errores, lo ideal
es que cada acción se pueda deshacer, obviamente dentro de un ambiente controlado»**.

⚠️ **Esto REVIERTE PARCIALMENTE una decisión de la 154 ya mergeada, y se dice sin disimulo.** Hoy
`incidente: []` (`lib/types/order-status-transiciones.ts:206`) y el comentario de `ESTADOS_TERMINALES`
(`:239-241`) dice que `incidente`, «a diferencia de `entregada` NO conserva ninguna salida (decisión
del humano del 2026-07-29)». La 158 declara salidas. **Reversión explícita y fechada: 2026-07-30.**

Lo que **NO** se revierte: `incidente` sigue en `ESTADOS_TERMINALES`. Es compatible, y el propio código
lo dice: `ESTADOS_TERMINALES` **exime** de tener salida pero **no la prohíbe** (`:236-237`, «el test
exime, no prohibe»), y `entregada` es el precedente exacto — terminal Y con su arista #31 de deshacer.
Tampoco se reabre el estado `indemnizada` que el gate de la 154 descartó: no existe, no se declara.

Red de seguridad que se aprovecha: `ESTADOS_ESPERADOS` es un `Record<GestionResultado, …>` exhaustivo
(`lib/services/CierreDiaService.ts:78`), así que añadir `incidente` al enum **rompe el build** ahí hasta
declararlo. El problema técnico duro del deshacer (destino hardcodeado + reposición de asignación) se
resuelve en **§13**, que es su sección propia.

### 0.6 Q-E — El crédito a la tienda queda **FUERA DE ALCANCE**, con follow-up explícito

**Follow-up a registrar (lo hace el leader, no el spec_author):** «**crédito de indemnización en el
ledger por tienda**» (feature 43). El porqué de escribirlo: el egreso sale de la caja de Ordenex, pero
si el dinero indemniza a la tienda y su ledger no recibe el crédito, el saldo por tienda no reflejará lo
que se le debe y alguien lo cuadrará a mano. Aplica a **los dos** caminos de esta feature.

### 0.7 Q-F — **NO se reescriben los `down.sql` previos**

`20260713140000_wallet_egreso_gasto_fijo_variable/down.sql` es su estado **punto-en-el-tiempo** y su
test asserta exactamente 12 valores (`tests/integration/db/wallet-egreso-migration.test.ts:73`);
reescribirlo obligaría a falsear la historia y su test. Lo que SÍ exige la regla del lote: **correr
`tests/integration/db` COMPLETO** en la fase backend y actualizar cualquier test previo que cruce la
lista de un `down` contra el SEED vigente. Verificado, además, que **ningún `down.sql` previo RECREA
`wallet_origen_tipo`**: el único que lo toca es `20260712160000_wallet_movimiento/down.sql:11`, que hace
`DROP TYPE IF EXISTS`. Así que el valor nuevo de R37 no obliga a tocar ningún down previo tampoco.

### 0.8 Q-G — El append escribe **`origen_tipo = incidente`**

Y se alinea el metadato `via` de la arista #44. La 154 dejó la familia `incidente` del enum de historial
**«declarada SIN PRODUCTOR hasta la 158»** (`lib/types/orden-historial.ts:35`, `db/schema.prisma:1133`),
así que la 158 es quien debe producirla. El metadato `via` **no participa de la decisión de legalidad**
(`lib/types/order-status-transiciones.ts:26-35`), así que el cambio es cosmético, pero debe quedar
coherente — y **rompe tests que hoy afirman lo contrario**: ver §14.

Verificado que el cambio es inocuo donde importa: el derivador de intentos de entrega (67/160) filtra por
`estatus_destino_id ∈ {devuelta, reprogramada}` (`lib/repositories/OrdenHistorialRepository.ts:79-110`),
y `incidente` no es ninguno de los dos, así que una fila de familia `incidente` **no entra en el conteo
de intentos** y no adelanta el escalado del cron SLA ni ningún cobro. Tampoco hace falta añadir
`incidente` a `ORIGEN_TIPOS_CON_GESTION`: ese conjunto sólo se usa para desambiguar filas **sin** enlace
a gestión (`:100-106`), y la fila del incidente del mensajero nace **con** `gestion_orden_id` poblado.

### 0.9 Aprobación del camino del admin — se reusa el **PATRÓN**, no la tabla

Razón textual: **«la idea es que sea aprobado, y para esto podemos usar los cierres ya existentes, verás
que tenemos ya dos tablas en cierres, podemos usar el mismo modelo»**. Se reusa:

- el enum **`CierreEstado`** (`solicitado → aprobado/rechazado`, `db/schema.prisma:664-671`);
- las **dos colas** «Pendientes de decisión» + «Histórico»
  (`app/(app)/cierres-admin/_components/CierresAdminModule.tsx:270,291`);
- **motivo obligatorio SÓLO al rechazar** (`CierresAdminService.rechazarCierre:242-270`).

Es la **TERCERA** aplicación del mismo patrón: la feature **40** (`CierresBodegaAdminService`) ya fue la
segunda y su propio encabezado se declara «espejo de CierresAdminService (38)»
(`lib/services/CierresBodegaAdminService.ts:32-38`). Se usa como **precedente de forma**.

**NO se cuelgan los incidentes de `cierre_bodega`** — verificado, no supuesto: agrupa `CierreDia[]`, es
por `zonaId`, sólo satélite, y **no tiene ningún detalle por orden** (`db/schema.prisma:732-760`; su
única relación de contenido es `cierresDia CierreDia[]`). Colgar ahí un incidente por orden obligaría a
inventarle un grano que la tabla no tiene. **No se encontró ninguna razón fuerte para lo contrario.**

**El egreso se dispara AL APROBAR**, igual que hoy se dispara al aprobar el cierre del día. Y requisito
de negocio que el humano hizo explícito: **quien reporta no aprueba** (doble control del dinero, R51).
Dónde vive el estado de aprobación —tabla propia vs. columna en `gestion_orden`— y **la evidencia de
código que decide la elección** están en **§12.1**.

### 0.10 Consecuencia global: **dos puntos de entrada al egreso**

Al terminar, la feature tiene **DOS** productores de `egreso_indemnizacion`: la aprobación del cierre
del día (camino del mensajero, `origen_tipo = cierre_dia`) y la aprobación del incidente (camino del
admin, `origen_tipo` nuevo). Eso **reescribe R29** («un solo emisor» → «exactamente dos, y ningún
tercero») y obliga a que la idempotencia cubra los dos: ver **§12.5**.

## 1. Alcance

**Entra — camino del MENSAJERO (§2-§8, R1-R36):**

1. `incidente` como quinto resultado de la gestión del mensajero (enum `gestion_resultado`).
2. `egreso_indemnizacion` como categoría de la caja principal (enum `wallet_movimiento_categoria`).
3. Persistencia del monto capturado por el admin y emisión del egreso **dentro de la transacción de
   aprobación del cierre** ya existente.
4. Superficie visible: opción en el panel del mensajero, grupo propio en los dos detalles de cierre,
   captura al aprobar, concepto y desglose en la wallet.
5. Causa tipada (3 valores en español) + evidencia 1..N obligatoria siempre (Q-B).
6. Deshacer el incidente del mensajero (Q-D), con la arista `incidente → en_reparto`.

**Entra — camino del ADMIN (§12-§13, R37-R64), ALCANCE NUEVO del 2026-07-30:**

7. Reporte del incidente por `maestro`/`admin`/`adminSatelite` desde **5** estados de bodega y tránsito
   interno, con **5 aristas nuevas** hacia `incidente`.
8. Entidad propia del incidente con su **aprobación** (patrón `CierreEstado`), su cola de decisión y su
   histórico, y **quien reporta no aprueba**.
9. **Segundo** productor de `egreso_indemnizacion`, con su propio `origen_tipo` e idempotencia.
10. Reversión del incidente del admin **al estado de origen**, con las **5 aristas inversas**.

**No entra (y se dice explícitamente):**

- El value `incidente` de `order_status` y la arista `en_reparto → incidente`: los declara la **154**.
- Ledger por tienda (feature 43) y pago al mensajero (feature 44): esta feature **no** los toca (Q-E,
  §0.6) — el follow-up queda escrito.
- Notificaciones (146): **no se emite ninguna** por el incidente. Q-J lo deja como pregunta abierta con
  recomendación, no como olvido.
- Ranking (76): sin cambios, y R38/R63 lo blindan con test.
- **No se toca `mensajero_asignado_id`** al reportar desde `por_recoger` (Q-K).

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

### Alternativas descartadas del camino del ADMIN (nuevas, 2026-07-30)

**9.7 El incidente del admin como una fila de `gestion_orden`** (reusando causa, motivo, evidencias
1..N, `indemnizacion` y el enlace `orden_historial_estado.gestion_orden_id`). **Descartada por
evidencia de código, y es la alternativa más tentadora**, así que la evidencia va completa:

`gestion_orden.mensajero_id` es `NOT NULL` con relación `GestionMensajero` (`db/schema.prisma:595,619`),
así que el admin tendría que escribirse ahí. Y entonces
`CorteDiarioRepository.findMensajerosConActividadSinCierre` (`:40-44`) hace exactamente esto:

```ts
const pendientes = await this.prisma.gestionOrden.findMany({
  where: { cierreId: null, anuladaAt: null },   // sin filtro de rol, sin filtro de resultado
  distinct: ["mensajeroId"],
  select: { mensajeroId: true, mensajero: { select: { zonaId: true } } },
});
```

El corte diario trataría al **ADMIN** como «mensajero con actividad del día sin cerrar» y le crearía un
`cierre_dia` en estado `vencido`, que es **BLOQUEANTE** (41/109/111). Y el admin **no puede resolverlo**:
`CierreDiaService` está acotado por rol al mensajero (`ROL_AUTORIZADO = "mensajero"`, `:37`, aplicado en
`listarCierreDia:152`, `solicitarCierre:239` y `deshacerGestion:349`). El único camino que le quedaría es
la válvula de escape del propio admin, que sólo lo pasa a `solicitado`. **Es un bug severo, verificable
y money-adjacent**, no una preferencia de estilo. Precedente que apunta en la misma dirección: la feature
100 se encontró con «necesito una fila de gestión y no tengo mensajero» y eligió **abortar la
transacción** antes que inventar un actor (`GestionOrdenRepository.reprogramarDesdeDevuelta:405-412`).

Coste de la alternativa elegida (§12.1), declarado: **dos tablas nuevas**, una columna de monto por
camino y una segunda tabla de evidencias. Se acepta.

**9.8 Columnas de aprobación (`estado`/`resuelto_por`/`resuelto_at`/`motivo_rechazo`) sobre
`gestion_orden`.** Descartada aun suponiendo resuelto lo de 9.7: pondría un flujo de aprobación en una
tabla donde **cuatro de los cinco resultados no lo tienen** (su aprobación es la del cierre), añadiendo
4 columnas nullable «por rama» a una tabla que ya tiene 8, y crearía **dos fuentes de verdad** para «¿se
aprobó este dinero?» (`cierre_dia.estado` vs. `gestion_orden.estado`). El repo ya resolvió este dilema
dos veces con **tabla propia por nivel de aprobación** (`cierre_dia` en la 37/38 y `cierre_bodega` en la
40), no con columnas apiladas.

**9.9 Reusar `gestion_orden_evidencia` haciendo `gestion_id` nullable + `incidente_id`.** Descartada:
rompe el `NOT NULL` y el `@@unique([gestionId, indice])` que son el invariante de la feature 119
(`db/schema.prisma:645-657`), y convierte una FK simple en un enlace polimórfico que ningún otro sitio
del repo usa. La tabla espejo (`orden_incidente_evidencia`) es más barata y es el idioma del repo (la 40
es un espejo de la 38). Descartado también guardar las rutas como array escalar: pierde `content_type` e
`indice`, y no hay ningún precedente de arrays de Postgres para esto.

**9.10 Un valor de familia nuevo en `orden_historial_origen_tipo` para la reversión del admin** (p. ej.
`deshacer_incidente`). Descartada por **coste medido**: `orden_historial_origen_tipo` tiene **10
`down.sql` que lo RECREAN**, y sus tests cruzan la lista del down contra el SEED «descontando los
añadidos en o después de» — p. ej.
`tests/integration/db/orden-historial-origen-recepcion-bodega-central-migration.test.ts:88-97`. Un valor
nuevo obliga a editar ~9 archivos de test de otras features. Se reusa la familia **`incidente`** que la
154 ya creó para esto, en las dos direcciones; la dirección es inequívoca por `estatus_destino_id`
(destino `incidente` = reporte; destino ∈ orígenes = reversión). Ver §12.3.

**9.11 Normalizar el destino de la reversión a un estado de bodega** (2 aristas inversas en vez de 5),
como hace la feature 149 con `por_recoger` (D3': deriva del historial y normaliza a bodega,
`lib/types/order-status-transiciones.ts:119-133`). **Descartada por instrucción explícita del humano**:
el destino del deshacer tiene que ser **el estado de origen**. Es la opción más barata en aristas (y por
eso se declara), pero mandaría a bodega un paquete que estaba en tránsito, que no es «deshacer».

**9.12 Reusar `WalletOrigenTipo.gestion_orden`** (valor reservado y sin uso, `lib/types/wallet.ts:57`)
para el egreso del admin, con `origen_id = <id del incidente>`. Descartada: no habría colisión de
idempotencia, pero el `origen_id` **mentiría** — el índice `(origen_tipo, origen_id)`
(`db/schema.prisma:913`) existe para responder «movimientos de este origen», y devolvería basura. Se
añade un valor propio, que además no obliga a tocar ningún `down.sql` previo (§0.7).

**9.13 Emitir el egreso del admin en el momento del reporte.** Descartada por la misma razón que 9.4 y
por el requisito de negocio explícito: **quien reporta no aprueba**. Sin aprobación no hay monto, y sin
monto no hay egreso.

## 10. Preguntas abiertas

> ### ✅ Q-A a Q-G están CERRADAS (puerta F1.4, 2026-07-30)
>
> Las respuestas, con la razón del humano y su evidencia, están en **§0**. Lo que sigue en §10 es el
> **texto original de cada pregunta, conservado a propósito** para que se pueda auditar qué se preguntó,
> qué se recomendó y qué se decidió: en tres de las siete (Q-A, Q-B evidencia, Q-D) el humano decidió
> **distinto** de la recomendación, y borrar el planteamiento borraría ese rastro.
>
> | Q | Recomendación del spec | **Decisión del humano** | ¿Coincide? |
> |---|---|---|---|
> | Q-A | sólo el mensajero | **los dos** (mensajero + admin desde 5 estados) | ❌ ampliada |
> | Q-B causa | sí, 3 valores cerrados | **sí, 3 valores cerrados** | ✅ |
> | Q-B evidencia | obligatoria sólo en `danado` | **obligatoria SIEMPRE, las 3 causas** | ❌ endurecida |
> | Q-B idioma | español | **español** | ✅ |
> | Q-C | `gestion_orden.indemnizacion` | **`gestion_orden.indemnizacion`** | ✅ |
> | Q-D | sí, se deshace | **sí, se deshace** (+ reversión de la 154, §0.5) | ✅ |
> | Q-E | fuera de alcance + follow-up | **fuera de alcance + follow-up** | ✅ |
> | Q-F | no reescribir los down previos | **no reescribirlos** | ✅ |
> | Q-G | `origen_tipo = incidente` | **`origen_tipo = incidente`** | ✅ |
>
> **Las preguntas que quedan REALMENTE abiertas son Q-H a Q-L**, al final de esta sección.

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

---

### 🔴 Preguntas que quedan ABIERTAS tras cerrar la puerta (nuevas del 2026-07-30)

> Las levanta este spec al diseñar el camino del admin. **Ninguna bloquea el backend del camino del
> mensajero.** Q-H y Q-I bloquean el frontend del camino del admin (T2.7/T2.8).

#### Q-H — ¿Desde dónde reporta el admin, y en qué pantalla? · **bloquea T2.7**

**Recomendación: un modal por orden en el módulo de órdenes**, abierto desde la acción de fila.
Precedentes exactos, que son las dos acciones administrativas por orden CON MOTIVO que ya viven ahí:
`app/(app)/ordenes/_components/RecuperarABodegaModal.tsx` (feature 100) y
`.../DeshacerAsignacionModal.tsx` (feature 149). Un incidente **no puede ser acción de lote**: pide
causa, motivo y fotos por orden. Alternativa no elegida: colgarlo de `recepcion-satelite`, que sólo
cubriría dos de los cinco orígenes.

#### Q-I — ¿La cola de aprobación es página nueva o una sección dentro de «Cierres»? · **bloquea T2.8**

**Recomendación: página propia** (`/incidentes`), espejo de `cierres-admin`, porque un incidente no es un
cierre y mezclarlos obligaría a que la pantalla de cierres cargue una entidad ajena. Precedente:
`cierres-bodega-admin` es página propia para el espejo de la 38. **Coste declarado:** entrada nueva en
`lib/auth/menu-visibility.ts` con su visibilidad por rol (maestro/admin y adminSatelite).

#### Q-J — ¿El mensajero asignado se entera de que su orden pasó a `incidente`?

Si un admin reporta un incidente sobre una orden en `por_recoger` **ya asignada**, esa orden desaparece
de «Mis asignaciones» sin aviso. Existe infraestructura de notificaciones (146). **Recomendación: fuera
de alcance de la 158 + follow-up explícito.** Se dice en voz alta porque es el tipo de hueco que se
descubre en producción con una llamada del mensajero.

#### Q-K — ¿Qué pasa con `mensajero_asignado_id` al reportar desde `por_recoger`?

**Recomendación: NO tocarla.** Así la reversión de R60 es trivialmente correcta (no hay nada que
reponer) y no hace falta guardar la asignación previa. Consecuencia declarada: la orden queda en
`incidente` con un mensajero asignado colgando, que es inocuo (el estado ya no la hace elegible para
nada: `findMisAsignaciones` filtra por estados y `incidente` no está entre ellos). Alternativa: limpiarla
como hace la liberación de `sin_gestionar` (`CierresAdminRepository:471-479`) — pero eso obliga a
persistir la asignación previa para poder revertir, y no lo pidió nadie.

#### Q-L — ¿Una entrega o dos? · **decisión del humano**

El diseño **propone** un corte en dos entregas, con la línea trazada y el análisis de qué queda roto en
el intermedio (**nada funcional**), en **§15**. Es una recomendación, no una decisión del spec_author.

## 11. Trazabilidad prevista (R → artefacto)

| R | Dónde se verifica |
| --- | --- |
| R1-R5 | test de migración estático nuevo (`tests/integration/db/incidente-indemnizacion-migration.test.ts`) + `tests/integration/db` completo |
| R6-R8, R11-R12 | `tests/unit/services/mis-asignaciones-*.test.ts` + `tests/integration/actions/*gestionar*` |
| R9-R10 | tests del schema de borde (`lib/types/gestion-orden.ts`) + test de la lista cerrada de `lib/types/causa-incidente.ts` (los 3 valores, en español, sin «Otro») |
| R13 | `tests/unit/domain/order-status-transiciones.*` (REESCRITOS, §14) + choke point (`registrar-cambio-estado`) |
| R14-R15 | `tests/unit/services/cierre-dia-service*.test.ts` (deshacer) |
| R16-R18 | `cierre-dia` (solicitar) + tests de componente de los dos detalles |
| R19-R25 | `tests/unit/services/cierres-admin-service.test.ts` + `tests/integration/actions/cierres-admin-action.test.ts` |
| R26-R28, R30 | `tests/unit/services/wallet-indemnizacion-feed-service.test.ts` + `tests/integration/db/wallet-idempotencia.test.ts` (extensión) |
| R29 | guard estructural REESCRITO: **exactamente dos** emisores de `egreso_indemnizacion` en `lib/`, nombrados; un tercero pone el test rojo (patrón `tests/unit/repositories/cierre-detail-inmutable.test.ts`) |
| R31-R34 | `tests/components/*` (wallet, CierresAdminModule, MisAsignacionesModule) |
| R35-R36 | suite existente en verde, sin modificar sus expectativas |
| **R37** | test de migración del camino del admin: `wallet_origen_tipo` con el valor nuevo + los 6 previos; test del SEED (`lib/types/wallet.ts`) y del doble candado |
| **R38** | `tests/unit/repositories/corte-diario-*.test.ts`: reportar un incidente de admin **no** hace que el corte devuelva a su autor · `tests/unit/repositories/ranking-*.test.ts`: no lo cuenta · `cierre-dia` (solicitar): no lo vincula |
| **R39** | test de migración (columnas, `NOT NULL`, FKs, RLS) + unit del repo nuevo (persiste los 10 campos) |
| **R40** | test estático del `down.sql` del camino del admin (recrea el enum sin el valor nuevo, `DROP TABLE` de las dos tablas, precondición documentada) + round-trip contra Postgres local |
| **R41-R44** | `tests/unit/services/incidente-admin-service.test.ts` (transición atómica desde los 5 estados; rastro con familia `incidente`; nace `solicitado`; cero movimientos) + `tests/integration/actions/incidente-admin-action.test.ts` |
| **R45-R46** | tests del schema de borde nuevo (causa cerrada, motivo no vacío, 1..N evidencias) + test de que la evidencia se sirve SÓLO firmada |
| **R47** | unit del service (rechazo del 2.º reporte) **y** test de integración del índice único parcial en base (dos inserts concurrentes → uno falla) |
| **R48** | unit del service: `adminSatelite` de otra zona → `no_encontrada`/`forbidden` sin filtrar datos; rol no autorizado → `forbidden` |
| **R49** | `tests/components/incidentes-admin-module.test.tsx`: dos colas, acotadas por alcance |
| **R50, R55** | test de borde del monto (vacío, 0, negativo, 3 decimales, coma → `validation_error`) + unit money-safe (STRING/Decimal, sin `parseFloat`) |
| **R51** | unit del service: autor == resolutor → `conflict`, sin efectos (**el test del doble control del dinero**) |
| **R52-R53** | unit del repo con doble de `tx`: aprueba → 1 movimiento con `tipo/categoria/origen_tipo/origen_id` exactos; fallo en cualquier paso → rollback total; reintento → sin segundo movimiento (índice único parcial) |
| **R54** | unit del service: rechazo exige motivo, no persiste monto, no emite movimiento y devuelve la orden a su origen |
| **R56** | test de invariante: tras un incidente `aprobado` la orden no admite otro reporte (R47) ni puede volver a `en_reparto`, y la wallet tiene **un** `egreso_indemnizacion` por orden |
| **R57-R58** | unit del service de reversión: destino = origen leído del historial; historial sin origen o origen fuera del conjunto cerrado → `conflict` sin mover nada |
| **R59** | unit: `solicitado` → revertible; `aprobado` → rechazado con mensaje propio |
| **R60** | unit: tras revertir un incidente de admin, `mensajero_asignado_id` y `asignado_at` quedan **byte-idénticos** a antes del reporte |
| **R61-R62** | `tests/unit/domain/order-status-transiciones.connectividad.test.ts` y `.guardia.test.ts` REESCRITOS + `tests/fixtures/inventario-transiciones-140.ts` actualizado (§14) |
| **R63** | los mismos de R38 + test del detalle de cierre (el grupo `incidente` sólo trae gestiones del mensajero) |
| **R64** | suite existente en verde + test que verifica que los dos egresos coexisten con orígenes distintos |

---

# 12. Camino del ADMIN — diseño (alcance nuevo, 2026-07-30)

## 12.1 Dónde vive el estado de aprobación: **tabla propia `orden_incidente`**

La pregunta que el humano pidió justificar «con evidencia del código, no por gusto» es: **columna en
`gestion_orden` vs. tabla propia**. Gana **tabla propia**, y la evidencia decisiva está en §9.7: una fila
de `gestion_orden` con el admin en `mensajero_id` hace que **el corte diario le cree un cierre `vencido`
bloqueante al admin**, que él no puede resolver porque el módulo de cierre está acotado por rol al
mensajero. No es un argumento estético; es un bug reproducible.

Se reusa **el patrón de los cierres, no su tabla** (§0.9). Es la tercera aplicación: 37/38 → `cierre_dia`,
40 → `cierre_bodega`, 158 → `orden_incidente`.

```prisma
// Feature 158 (R38/R39): incidente reportado por un ADMIN sobre una orden que NO esta en manos de
// un mensajero (bodega o transito interno). NO es una `gestion_orden`: ver design §9.7 — una fila de
// gestion con el admin en `mensajero_id` hace que el CORTE DIARIO le cree un cierre `vencido`
// bloqueante (CorteDiarioRepository:40-44 no filtra rol ni resultado) que el admin no puede resolver.
// Reusa el enum CierreEstado (37) como tercera aplicacion del patron de aprobacion (38/40).
// Indice unico PARCIAL (orden_id) WHERE estado <> 'rechazado' + RLS habilitada sin policies van a
// mano en el SQL de la migracion (Prisma no los expresa), patron cierre_bodega (schema:730-731).
model OrdenIncidente {
  id            String                 @id @default(uuid())
  ordenId       String                 @map("orden_id")
  causa         GestionCausaIncidente                        // MISMO enum que el camino del mensajero
  motivo        String                                       // R45: obligatorio SIEMPRE (Q-B)
  estado        CierreEstado           @default(solicitado)   // reuso 37 (F1.4-b de la 40)
  indemnizacion Decimal?               @db.Decimal(12, 2)     // R50: NULL hasta aprobar
  reportadoPor  String                 @map("reportado_por")  // FK usuario (autor; R51)
  resueltoPor   String?                @map("resuelto_por")   // FK usuario (aprobador; R52)
  resueltoAt    DateTime?              @map("resuelto_at")
  motivoRechazo String?                @map("motivo_rechazo") // R54: obligatorio SOLO al rechazar
  createdAt     DateTime               @default(now()) @map("created_at")
  updatedAt     DateTime               @updatedAt @map("updated_at")

  orden              Orden                     @relation(fields: [ordenId], references: [id])
  reportadoPorUsuario Usuario                  @relation("IncidenteReportadoPor", fields: [reportadoPor], references: [id])
  resueltoPorUsuario Usuario?                  @relation("IncidenteResueltoPor", fields: [resueltoPor], references: [id])
  evidencias         OrdenIncidenteEvidencia[]

  @@index([ordenId])
  @@index([estado])          // cola de pendientes (patron cierre_dia/cierre_bodega)
  @@index([reportadoPor])
  @@index([resueltoPor])
  @@map("orden_incidente")
}

// Espejo EXACTO de GestionOrdenEvidencia (119). Tabla propia y no FK nullable: ver design §9.9.
model OrdenIncidenteEvidencia {
  id          String   @id @default(uuid())
  incidenteId String   @map("incidente_id")
  storagePath String   @map("storage_path") // path bucket PRIVADO, NO URL
  contentType String   @map("content_type")
  indice      Int                            // 0-based; 0 = portada
  createdAt   DateTime @default(now()) @map("created_at")

  incidente OrdenIncidente @relation(fields: [incidenteId], references: [id], onDelete: Cascade)

  @@unique([incidenteId, indice])
  @@index([incidenteId])
  @@map("orden_incidente_evidencia")
}
```

**Por qué `estado` reusa `CierreEstado` y no un enum nuevo:** exactamente el mismo razonamiento con el que
la 40 lo reusó para `cierre_bodega` (decisión F1.4-b de esa feature, `db/schema.prisma:726-736`). El valor
`vencido` **no aplica** aquí — igual que no aplica en `cierre_bodega`, cuyo service sólo parte
`solicitado` vs. resto (`CierresBodegaAdminService:56`). Un enum nuevo costaría migración + SEED + doble
candado + tests, para expresar lo mismo.

**El índice único parcial es la mitad de R47.** `CREATE UNIQUE INDEX orden_incidente_orden_vivo_uq ON
"orden_incidente" ("orden_id") WHERE "estado" <> 'rechazado';` — a lo sumo UN incidente vivo por orden, y
tantos rechazados como haga falta. Precedente literal: el índice único parcial `(zona_id) WHERE
estado='solicitado'` de `cierre_bodega`. La comprobación previa en el service es la otra mitad (mensaje
accionable); el índice es el que no se puede saltar en una carrera.

**RLS:** las dos tablas nuevas nacen con RLS habilitada **sin policies** (sólo service role), patrón
`gestion_orden` / `cierre_dia` / `wallet_movimiento`. Va a mano en el SQL de la migración.

## 12.2 Migración del camino del admin

Carpeta propia `db/migrations/<ts>_orden_incidente/`, **posterior** a la del camino del mensajero.

`migration.sql` (UP), aditivo:

1. `ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'orden_incidente';` (R37)
2. `CREATE TABLE "orden_incidente"` + FKs + los 4 índices + el índice único parcial + `ENABLE ROW LEVEL
   SECURITY`.
3. `CREATE TABLE "orden_incidente_evidencia"` + FK `ON DELETE CASCADE` + unique + índice + RLS.

`down.sql` (DOWN), espejo exacto (R40):

1. `DROP TABLE "orden_incidente_evidencia";` → `DROP TABLE "orden_incidente";`
2. Recrear `wallet_origen_tipo` con los **6** valores previos + `ALTER COLUMN … TYPE … USING
   (…::text::…)` sobre las **TRES** tablas que usan el tipo — verificado: `wallet_movimiento`
   (`20260712160000_wallet_movimiento/migration.sql:46`), `wallet_tienda_movimiento` (`…170000:40`) y
   `pago_mensajero_movimiento` (`…180000:36`). **Olvidar una de las tres deja el `DROP TYPE … _old`
   colgando y el down falla.**
3. **Precondición documentada en el archivo:** 0 filas con `origen_tipo = 'orden_incidente'` en las tres
   tablas. Si las hay, el `USING` falla ruidosamente y el rollback aborta — correcto: revertir con
   indemnizaciones emitidas no es seguro.

**Ningún `down.sql` previo recrea `wallet_origen_tipo`** (§0.7): no se reescribe ninguno.

## 12.3 Las 11 aristas nuevas del mapa (feature 140) — con su `via`/`rol` justificado

`via` es el nombre de la **familia/acción productora**, no del actor (todo el mapa lo hace así). Se usa la
familia **`incidente`**, que la 154 dio de alta precisamente para esto y que hoy está «declarada SIN
PRODUCTOR hasta la 158» (`lib/types/orden-historial.ts:35`). No se añade ninguna familia nueva: §9.10 mide
el coste (≈9 archivos de test de otras features).

`rol` se calca de las aristas **vecinas del mismo origen**, no se inventa:

| # | Arista | `via` | `rol` | Vecinas que lo justifican |
| --- | --- | --- | --- | --- |
| #48 | `en_bodega_central → incidente` | `incidente` | `maestro/admin` | #7 `ruteo_satelite` y #8 `asignacion_bodega`, las dos `maestro/admin` (`:104-105`) |
| #49 | `en_bodega_satelite → incidente` | `incidente` | `maestro/admin/adminSatelite (de la zona)` | #9 `asignacion_satelite` es `adminSatelite` (`:116`); la forma compuesta es literal de #47 (`:131`) |
| #50 | `en_ruta_bodega_central → incidente` | `incidente` | `maestro/admin` | #37 `recepcion_bodega_central`, `maestro/admin` (`:93`) |
| #51 | `en_ruta_bodega_satelite → incidente` | `incidente` | `maestro/admin/adminSatelite (de la zona)` | #10 es `adminSatelite` (`:110`) y #45 `deshacer_asignacion` es `maestro/admin` (`:113`) |
| #52 | `por_recoger → incidente` | `incidente` | `maestro/admin/adminSatelite (de la zona)` | #47 usa EXACTAMENTE ese string (`:128-132`) |
| #53 | `incidente → en_reparto` | `deshacer_gestion` | `mensajero` | #31-#36: **todas** las reversiones de gestión son `deshacer_gestion`/`mensajero` (`:149,154,164,167`) |
| #54 | `incidente → en_bodega_central` | `incidente` | `maestro/admin` | inversa de #48 |
| #55 | `incidente → en_bodega_satelite` | `incidente` | `maestro/admin/adminSatelite (de la zona)` | inversa de #49 |
| #56 | `incidente → en_ruta_bodega_central` | `incidente` | `maestro/admin` | inversa de #50 |
| #57 | `incidente → en_ruta_bodega_satelite` | `incidente` | `maestro/admin/adminSatelite (de la zona)` | inversa de #51 |
| #58 | `incidente → por_recoger` | `incidente` | `maestro/admin/adminSatelite (de la zona)` | inversa de #52 |

**Por qué #53 va con `deshacer_gestion` y las otras cinco con `incidente`:** #53 deshace **una gestión**
(literalmente: `anularGestionYDevolverAGestion` ya escribe `origen_tipo: "deshacer_gestion"`,
`CierreDiaRepository:633`), mientras que #54-#58 revierten un **reporte de incidente**, que no es una
gestión. Que la familia `incidente` sirva a las dos direcciones no crea ambigüedad: la dirección se lee de
`estatus_destino_id` (destino `incidente` = reporte; destino ∈ los 5 orígenes = reversión). Precedente de
un mismo par declarado dos veces con familias distintas: #19/#23 y #20/#24 (`:157,162`).

**Además, la 158 cambia el `via` de #44** de `gestion` a `incidente` (Q-G). No altera la legalidad
(`:26-35`) pero **rompe tests**: §14.

## 12.4 Efecto sobre los invariantes de la 154 (verificado, no supuesto)

- **`ESTADOS_TERMINALES`: sin cambios.** `incidente` sigue dentro. Es legal tener salidas: `:236-237`
  dice «el test exime, no prohibe» y `entregada` es terminal con la #31. Lo que cambia es el **comentario**
  de `:239-241`, que hoy afirma que `incidente` «NO conserva ninguna salida»: hay que reescribirlo dejando
  la reversión fechada (2026-07-30) y sin borrar la decisión previa de la 154.
- **`ESTADOS_CREACION` / `ESTADOS_VESTIGIALES`: sin cambios.** `incidente` no nace ni es vestigial.
- **Invariante de conectividad: sigue verde y además mejora.** `incidente` ya tenía entrada (#44) y ahora
  tiene 5 más y 6 salidas; los 5 estados de origen ya tenían entrada y salida propias, y **ninguna arista
  se retira**, así que ningún estado puede quedarse sin salida por este cambio. Los dos primeros tests de
  `connectividad.test.ts` (callejón sin salida / inalcanzable) **pasan sin tocarlos**; el que rompe es el
  específico `154/R16` que asserta `salidas === 0` (§14).
- **Recuento del inventario:** las 11 aristas son 11 pares **NUEVOS** (ninguna repite un par ya
  declarado), así que `aristasFlujo` 41 → **52** y `paresUnicos` 39 → **50**. Los 2 duplicados históricos
  (#19/#23, #20/#24) siguen siendo los únicos: 52 − 50 = 2. ✔
- **`ESTADOS_ESPERADOS` (`CierreDiaService:78`)** gana `incidente: ["incidente"]`. El build rompe hasta
  declararlo, y eso es la red de seguridad: se apoya en ella (§0.5).

## 12.5 Servicio, aprobación y egreso del camino del admin

Capas, según `docs/architecture.md` (Controller → Service → Repository, con interfaces en
`lib/interfaces/`):

- **`lib/types/incidente.ts`** — schemas zod de borde: `reportarIncidenteSchema` (ordenId, causa del enum
  cerrado, motivo no vacío, `evidencias` 1..N reusando `evidenciasSchema` de `lib/types/gestion-orden.ts`),
  `aprobarIncidenteSchema` (`{ incidenteId, monto }` con `montoPositivoSchema` de `lib/types/wallet.ts:130`
  — STRING, 2 decimales, > 0), `rechazarIncidenteSchema` (`{ incidenteId, motivo }`).
- **`lib/actions/incidentes.ts`** — Server Actions (mutación interna, no route handler), con el mismo
  `withErrorHandler` y el mismo mapeo `ZodError → validation_error` que `lib/actions/cierres-admin.ts`.
  Es también el **composition root** que inyecta repos, `SignedUrlProvider`, storage y el feed nuevo.
- **`lib/services/IncidenteAdminService.ts`** — espejo de forma de `CierresAdminService`:
  - `resolveAlcance(actor)`: `esAccesoTotal(rol)` → sin restricción de zona; `adminSatelite` → su
    `findUsuarioZonaId`, y el filtro por **zona de la ORDEN** vive en el WHERE del repo, nunca en memoria
    (R48, patrón `CierresAdminService:77-90`).
  - `reportar(input, actor)`: guardias en orden (rol → alcance → orden existente y no borrada → estado ∈
    los 5 → sin incidente vivo), **subida secuencial y compensada** de las N evidencias ANTES de la
    transacción (calcado de `MisAsignacionesService:340-372`: acumula `uploaded` y hace `storage.remove`
    ante cualquier fallo, para que R42 «sin objetos en el bucket» sea cierto), y una única llamada al repo.
  - `aprobar(input, actor)`: alcance → **R51: `incidente.reportadoPor === actor.usuarioId` → `conflict`**
    → repo.
  - `rechazar(input, actor)`: alcance → R51 → motivo no vacío (defensa además del borde, patrón
    `CierresAdminService:252-255`) → repo.
  - `retractar(incidenteId, actor)`: sólo el autor, sólo `solicitado`; misma escritura que el rechazo pero
    sin motivo de aprobador. Es la «ventana controlada» de Q-D para este camino.
- **`lib/repositories/IncidenteAdminRepository.ts`** — sólo Prisma. Tres escrituras, todas en
  `$transaction` y todas **guardadas en el WHERE** (patrón `resolverCierre`):

```
reportar(...)                       // R41: todo-o-nada
  1) tx.orden.updateMany({ where: { id, estatusId: <uno de los 5>, deletedAt: null },
                           data: { estatusId: incidenteId } })   // count 0 -> throw -> rollback
  2) tx.ordenIncidente.create({ estado: 'solicitado', ... })     // unique parcial -> R47
  3) tx.ordenIncidenteEvidencia.createMany(...)                  // 1..N (R46)
  4) appendCambioEstado(tx, [{ estatusOrigenId, estatusDestinoId, actorUsuarioId,
                               origenTipo: 'incidente' }])       // R44 + guardia de la 140

resolver({ incidenteId, alcance, nuevoEstado, resueltoPor, monto | motivoRechazo })
  1) tx.ordenIncidente.updateMany({ where: { id, estado: 'solicitado', ...alcanceGuard },
                                    data: { estado, resueltoPor, resueltoAt, ... } })
     count !== 1 -> conflict (ya resuelto / fuera de alcance), SIN efectos
  2) si nuevoEstado === 'aprobado':
       a) UPDATE indemnizacion = new Prisma.Decimal(monto)       // R52, money-safe
       b) feed.construirEgresoIndemnizacionIncidente(incidenteId, tx)  // LEE lo que (a) escribio
       c) walletMovimientoRepo.crearMovimientos(tx, egreso)      // skipDuplicates -> R53
  3) si nuevoEstado === 'rechazado': revertir la orden a su origen (§13) en la MISMA tx  // R54
```

**El feed lee de la base lo que la misma `tx` acaba de escribir**, no recibe el monto por parámetro. Es la
misma filosofía de §6.3 y la lección de la 69: el libro no puede divergir de lo persistido.

Movimiento emitido (R52):

```ts
{ tipo: "egreso", categoria: "egreso_indemnizacion", monto: "<indemnizacion>",
  origenTipo: "orden_incidente", origenId: incidenteId, descripcion: null, registradoPor: null }
```

`registradoPor` va `null` como en todos los automáticos; la autoría humana queda en
`orden_incidente.resuelto_por`/`resuelto_at` (mismo criterio que 38/R14).

**Idempotencia de los DOS caminos (R29/R53/R56).** El índice único parcial de la 42 es
`(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`
(`db/migrations/20260712160000_wallet_movimiento/migration.sql:71`). Con él:

- camino del mensajero → **1** fila por `(cierre_dia, cierreId, egreso_indemnizacion)`;
- camino del admin → **1** fila por `(orden_incidente, incidenteId, egreso_indemnizacion)`.

Y no se puede pagar dos veces la MISMA orden porque los dos caminos son mutuamente excluyentes por el
grafo: el reporte del mensajero exige `en_reparto` y el del admin exige uno de los 5 estados; una vez en
`incidente`, R47 + el índice parcial impiden un segundo reporte vivo, y `incidente` no tiene ninguna
salida hacia el flujo (sólo reversión, que **no paga**). El caso «rechazado → vuelve al origen → se
reporta otra vez → se aprueba» paga **una** vez, porque el rechazado nunca persistió monto. Esto se fija
con test (R56), no se deja como razonamiento.

`tests/integration/db/wallet-idempotencia.test.ts` se **extiende a los dos orígenes**: hoy sólo conoce el
del cierre.

## 12.6 Frontend del camino del admin

- **Reporte (Q-H):** `app/(app)/ordenes/_components/ReportarIncidenteModal.tsx`, abierto desde la acción
  de fila del listado, visible sólo si el estado de la orden está en los 5 y el rol lo permite. Calcado de
  `RecuperarABodegaModal` (100) y `DeshacerAsignacionModal` (149). Contenido: causa en radios (opciones de
  UI en `causa-incidente-options.ts`, hermano de `causa-devolucion-options.ts`), `motivo` obligatorio,
  y el selector de 1..N fotos con el MISMO componente y los mismos límites que el panel del mensajero.
  Validación en cliente con el mismo schema que el servidor revalida.
- **Cola de aprobación (Q-I):** `app/(app)/incidentes/` con `IncidentesAdminModule.tsx`, espejo de
  `CierresAdminModule`: **dos** `DataTable` («Pendientes de decisión» + «Histórico»), modal de detalle con
  causa, motivo, evidencias firmadas y datos de la orden, y las dos acciones. **Aprobar** abre un
  sub-modal con el `Input` de monto (deshabilitado el confirmar mientras el monto no sea válido, mismo
  criterio `montoValido` que el servidor); **Rechazar** abre el sub-modal de motivo obligatorio, calcado
  literal de `CierresAdminModule:471-513`. La fila de un incidente **propio** muestra la acción
  deshabilitada con el motivo («no podés aprobar un incidente que reportaste vos»), y el servidor lo
  vuelve a rechazar (R51: cliente y servidor, no sólo cliente).
- **Menú:** entrada nueva en `lib/auth/menu-visibility.ts` para maestro/admin/adminSatelite.
- **Wallet:** sin cambios adicionales — la categoría, su etiqueta y su fila del desglose ya entran por
  §7.4; los movimientos del camino del admin caen en la misma categoría y se suman solos.

# 13. El problema del destino del deshacer: dónde SÍ es un bug y dónde no

Se pidió resolverlo, y la respuesta honesta tiene dos mitades.

## 13.1 Para el camino del MENSAJERO el hardcode NO es incorrecto

`CierreDiaService.deshacerGestion` fija el destino a `en_reparto` (`const ESTADO_EN_REPARTO`, `:65`, usado
en `:388`) y repone la asignación al **autor** de la gestión (`:399`, `mensajeroId`). Para una gestión
`incidente` eso es **exacto**, no una casualidad: una gestión sólo puede nacer desde `en_reparto` —lo
garantiza la guardia `cargarOrdenGestionable` de `MisAsignacionesService`, invocada en `gestionar:304`
antes de cualquier escritura— y su autor es siempre un mensajero, porque el service está acotado por rol
(`:349`) y el `updateMany` del repo exige `mensajeroId` en el WHERE (`CierreDiaRepository:598`). Así que
para `incidente`: destino = origen = `en_reparto` ✔, y la reposición de asignación es correcta ✔.

**Por eso `deshacerGestion` NO se toca más allá de `ESTADOS_ESPERADOS.incidente = ["incidente"]`.** Tocar
el destino de un método money-critical con 8 guardias, para los cuatro resultados existentes, sin ganancia
de comportamiento, es riesgo gratis.

> **Inexactitud PREEXISTENTE que se declara y NO se arregla aquí:** las gestiones **sintéticas** de las
> features 99 (`escalado_devuelta_sla`, `rechazada`) y 100 (`reprogramacion_tienda`, `reprogramada`) nacen
> desde `devuelta`, no desde `en_reparto`; si alguien deshiciera una de ellas, hoy la orden iría a
> `en_reparto` y se asignaría al mensajero atribuido. Está en `dev` desde la 99/100, **no lo introduce ni
> lo empeora la 158**, y arreglarlo es una feature propia. Se escribe para que no parezca un descubrimiento
> de esta feature ni un olvido.

## 13.2 Para el camino del ADMIN el destino SÍ tiene que derivarse — y el lector ya existe

El incidente del admin **no viaja por `deshacerGestion`** (no es una gestión, §9.7), así que necesita su
propia reversión, y ahí el destino sí es variable: cinco orígenes posibles. Se investigó de dónde leerlo:

**Candidato A (el natural) — la fila previa de `orden_historial_estado`. VERIFICADO Y ELEGIDO.** No hay
que inventar la lectura: **ya está implementada, mergeada y en uso por la feature 149**:

```ts
// lib/repositories/OrdenHistorialRepository.ts:212-230 — findOrigenesReversion
SELECT DISTINCT ON (h."orden_id") h."orden_id", os."value"
FROM "orden_historial_estado" h
JOIN (VALUES <(ordenId, estatusActualId)…>) AS f(orden_id, estatus_destino_id)
  ON f.orden_id = h."orden_id" AND f.estatus_destino_id = h."estatus_destino_id"
LEFT JOIN "order_status" os ON os."id" = h."estatus_origen_id"
ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC
```

Devuelve el `value` del estado de origen de la **última** transición que entró al estado actual, o `null`
si ese origen era `NULL` (creación) — y el service de la 149 **rechaza** en ese caso
(`IOrdenHistorialRepository.ts:148-150`, comentario de `OrdenHistorialRepository:24-25`). Se reusa tal
cual, con `estatusActualId = <id de incidente>`.

Por qué es **fiable**, comprobado y no supuesto:

1. La fila la escribe el **choke point único** `appendCambioEstado` en la MISMA transacción que el cambio
   de estado (`registrar-cambio-estado.ts:173-207`); si la transacción revierte, se va con ella. No hay
   ninguna ruta de escritura de `orden.estatus_id` que no pase por ahí (`:147-151`).
2. La fila es **INMUTABLE**: `OrdenHistorialEstado` no tiene `updated_at` ni `deleted_at`
   (`db/schema.prisma:1156`), y el propio modelo dice que una corrección es una fila nueva.
3. El `DISTINCT ON … ORDER BY created_at DESC, id DESC` resuelve la **ambigüedad real** que existe: una
   misma gestión puede aparecer enlazada en más de una fila de historial (la 99 enlaza su gestión
   sintética), y el desempate por `id` cubre el empate de `created_at`.
4. La consulta va por `orden_id`, que **está indexado** (`@@index([ordenId, createdAt])` y
   `@@index([ordenId, estatusDestinoId])`, `:1169-1170`). **No existe índice por `gestion_orden_id`**, así
   que una lectura «por gestión» sería un scan: otra razón para usar este lector y no escribir otro.

**Guardia obligatoria (R58):** el `value` devuelto se valida contra el **conjunto CERRADO** de los 5
orígenes declarados. Si es `null`, o no pertenece al conjunto, o el catálogo no lo resuelve a un id
(`findEstatusIdByValue`), la reversión se rechaza con `conflict` y **no se mueve nada**. Sin esa guardia,
un historial raro podría mandar la orden a cualquier parte; con ella, el peor caso es «no se puede
deshacer», que es seguro. Mismo criterio de fallo cerrado que la guardia de la 140.

**Candidato B (descartado) — columna `estado_origen_id` en `orden_incidente`.** Sería O(1) por PK y
totalmente inmune a arqueología. **Se descarta porque duplica un dato que el historial inmutable ya tiene
y cuyo lector ya existe, probado y en producción**: dos fuentes de verdad para el mismo hecho es
exactamente el tipo de deuda que este repo paga caro (la 69 lo documenta). Queda declarado como el plan B
inmediato si en implementación se descubriera que el lector de la 149 no sirve para este caso: sería una
columna, un `NOT NULL`, y se escribe en la misma `tx` del reporte.

**Reposición de asignación (R60):** la reversión del admin **no toca** `mensajero_asignado_id` ni
`asignado_at`, porque el reporte tampoco los tocó (Q-K). El requisito «la reposición NO debe ocurrir
cuando el autor no es mensajero» se cumple por construcción y se fija con un test que compara el par de
columnas antes del reporte y después de revertir.

**Familia y rastro:** la reversión appendea por el choke point con `origen_tipo = incidente`, origen
`incidente`, destino el estado derivado, actor el que revierte (autor si es retracto, aprobador si es
rechazo). La guardia de la 140 valida el par contra #54-#58, así que si alguien olvida declarar una arista
el rechazo es ruidoso.

# 14. Tests YA EXISTENTES que esta feature ROMPE y tiene que reescribir

> Esto no es una lista de precaución: son fallos **garantizados**. Están aquí para que la fase backend no
> los descubra uno a uno y para que el reviewer verifique que se **reescribieron con intención** y no se
> relajaron. Ninguno se borra: se invierte su afirmación y se documenta la razón (patrón con el que la 156
> trató los tests de la 154, `progress/current.md`).

| Archivo:línea | Qué afirma hoy | Por qué rompe | Qué debe afirmar |
| --- | --- | --- | --- |
| `tests/unit/domain/order-status-transiciones.connectividad.test.ts:87-93` | `TRANSICIONES.incidente` es `[]` y `salidas === 0` | Q-D declara 6 salidas | terminal, alcanzable, y **sus únicas salidas son las 6 de reversión** (enumeradas) |
| `…connectividad.test.ts:147` | `ORDER_STATUS_SEED.length === 19` | no cambia | sin cambios (la 158 **no** toca el catálogo de estados) |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts:209-216` | «`incidente` no tiene NINGUNA salida legal»: itera todo el catálogo esperando `throw` | ídem | las 6 salidas son legales y **todo el resto del catálogo sigue siendo ilegal** desde `incidente` |
| `…guardia.test.ts:364-380` | usa `["incidente","en_reparto"]` como ejemplo de par **ILEGAL** | pasa a ser #53 | sustituir por un par que siga siendo ilegal (p. ej. `incidente → entregada`) |
| `…guardia.test.ts:266-272` + `tests/fixtures/inventario-transiciones-140.ts:149-153` | `aristasFlujo: 41`, `paresUnicos: 39` | +11 aristas, +11 pares | **52 / 50**, con las 11 filas nuevas transcritas a mano en el fixture |
| `…guardia.test.ts:384-389` + `fixtures…:109` | `"en_reparto->incidente (gestion)"` | Q-G cambia el `via` a `incidente` | `"en_reparto->incidente (incidente)"` |
| `…guardia.test.ts:36-42` («el mapa declara exactamente las aristas del inventario») | compara mapa vs. fixture incluyendo `via` | los dos cambios anteriores | pasa solo al actualizar el fixture; **es el test que garantiza que no se olvide ninguna** |
| `tests/unit/repositories/orden-historial-cobertura.test.ts:210-213,259-265` | `FAMILIAS_SIN_PRODUCTOR` es `["recoleccion_tienda","incidente"]` | la 158 **es** el productor de `incidente` | `["recoleccion_tienda"]`, y `incidente` **movida** a `PUNTOS_DE_ESCRITURA` con sus símbolos reales. El propio archivo lo ordena en `:207-209` |
| `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` | consume `RECUENTO_INVENTARIO` | recuento nuevo | pasa al actualizar el fixture (verificar) |
| `tests/integration/db/wallet-idempotencia.test.ts` | idempotencia del egreso por cierre | segundo origen | cubrir **los dos** orígenes (R29/R53) |

Además, **no** rompe (verificado, y conviene saberlo para no tocarlo de más):

- `tests/unit/types/criterio-intento-entrega.test.ts:32-43` deriva su recuento de
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length`, y la 158 **no añade familias** → sigue verde.
- `tests/integration/db/wallet-egreso-migration.test.ts:66-74` afirma 12 valores sobre el down del 45 y
  **no cruza contra el SEED** → sigue verde con la categoría nueva (§3.5 / Q-F).
- Los dos primeros tests de conectividad (callejón sin salida / inalcanzable): la 158 es puramente
  aditiva en aristas.

# 15. Riesgo de tamaño y propuesta de corte en DOS entregas

## 15.1 El riesgo, dicho sin adornos

La feature está estimada **`high`** y esta ampliación **la empuja por encima de esa estimación**. Medido en
superficie declarada: pasa de **36 a 64 requisitos**, de **1 a 2 migraciones**, de 0 a **2 tablas nuevas**,
de 1 a **2 productores de dinero**, suma **11 aristas** al mapa de la guardia central, **1 página nueva**
con su entrada de menú, **2 modales nuevos**, y obliga a reescribir **≥10 tests de otras features** (§14).
Es, cómodamente, el tamaño de dos features del lote 153-160.

El precedente que hace esto relevante está en `progress/current.md`: el **tren 154+155+156** tuvo que
subir junto porque los cortes se hicieron por conveniencia y no por «qué queda funcionando en el
intermedio», y hubo que documentarlo dos veces con dos CORRECCIONES.

## 15.2 El corte propuesto — y por qué NO deja nada roto en el intermedio

**Entrega 1 — «incidente del mensajero» (R1-R36, con las reescrituras de Q-B/Q-D/Q-G):**
enum `gestion_causa_incidente`, `gestion_resultado + incidente`,
`wallet_movimiento_categoria + egreso_indemnizacion`, `gestion_orden.indemnizacion` y
`gestion_orden.causa_incidente`; arista **#53** (`incidente → en_reparto`) + el `via` de #44;
`ESTADOS_ESPERADOS.incidente`; captura del monto al aprobar el cierre y el egreso con
`origen_tipo = cierre_dia`; panel del mensajero, los dos detalles de cierre, sub-modal de captura y la
wallet. **Una migración.**

**Entrega 2 — «incidente del admin» (R37-R64):** `wallet_origen_tipo + orden_incidente`, las dos tablas
nuevas, las **10** aristas restantes (#48-#52 y #54-#58), el service/repo/actions del camino del admin, el
modal de reporte y la página de la cola. **Una migración, puramente aditiva sobre la 1.**

**Qué queda roto en el intermedio: NADA funcional.** Comprobado contra los invariantes que hicieron
obligatorio el tren 154+155+156:

- **Ninguna arista sin productor.** La #53 la produce el deshacer, que entra en la entrega 1. Las 5
  entradas del admin y sus 5 inversas **no se declaran** hasta la entrega 2, que es la que trae su
  productor. Es exactamente la lección de la 154 aplicada al revés: no declarar antes de producir.
- **Ninguna familia sin productor.** `incidente` sale de `FAMILIAS_SIN_PRODUCTOR` en la entrega 1, porque
  el append del mensajero ya la emite (Q-G).
- **Ningún estado sin salida ni inalcanzable.** Ambas entregas son aditivas en aristas.
- **Ningún dinero a medias.** La entrega 1 es un ciclo económico completo y cerrado: reportar → cerrar →
  aprobar → un egreso → deshacer si fue un error. La entrega 2 añade un segundo ciclo independiente.
- **El único efecto visible del intermedio** es que el admin no puede reportar incidentes desde bodega,
  que es **exactamente el estado de hoy**. No hay ventana de rotura, ni pantalla que ofrezca algo que
  falle, ni orden que quede atrapada.
- **Riesgo residual del corte:** el `down.sql` de la entrega 1 no se toca en la 2 (Q-F), y el valor nuevo
  de `wallet_origen_tipo` no obliga a reescribir ningún down previo (§0.7). Y hay que recordar que
  `catalogoCache` **nunca se invalida** (aviso de la 154 en `progress/current.md`): el orden
  migrar-antes-de-desplegar importa en las dos entregas, aunque la 158 no haga crecer `order_status`.

**Coste del corte, para que la comparación sea honesta:** dos PRs, dos rondas de review, y los tests del
mapa (§14) se tocan **dos veces** (una por entrega). Si el humano prefiere una sola entrega, el diseño
funciona igual: la única diferencia es que se declaran las 11 aristas de golpe.

**Recomendación: cortar.** **La decisión es del humano.**
