# Ficha 393 — Diseño

> El CÓMO. Los requisitos están en `requirements.md`; el desglose y las mutaciones, en `tasks.md`.
> Todos los anclajes de archivo/línea se leyeron **en disco** el 2026-09-07.

---

## 1 — El modelo de datos: **NO hace falta migración**, y por qué

**Veredicto: cero migraciones. Cero columnas. Cero RLS nueva. Cero `down.sql`.**

Las dos cascadas se componen de cinco magnitudes. Tres son snapshot que ya existen; dos se derivan
de un snapshot inmutable que ya se lee en el mismo camino.

| Magnitud | De dónde sale hoy | ¿Existe? |
| --- | --- | --- |
| Lo recaudado | `cierre_bodega.total_general` / `cierre_dia.total_general` | **sí**, snapshot |
| Pago a mensajeros | `cierre_bodega.total_pago_mensajero` / `cierre_dia.total_pago_mensajero` | **sí**, snapshot |
| Pago a la bodega satélite | `cierre_bodega.total_ingreso_bodega_rechazos` / idem por día | **sí**, snapshot |
| Flete + IVA · Comisión + IVA · Flete por rechazo + IVA | `totalesIngresoOrdenex(gestiones)` sobre el desglose que **ya se carga** en `verCierreBodegaDetalle` | **sí**, derivado |
| Para la tienda · Neto de Ordenex · Queda tras los pagos | restas de lo anterior | **se derivan** |

`cierre_detail` (`db/schema.prisma:2229-2290`) congela las **entradas** de la fórmula y es
`INMUTABLE` por diseño (`// SIN updated_at / deleted_at: fila INMUTABLE (R10)`), así que derivar de
él es reproducible: no es «recalcular con datos de hoy», es leer el mismo snapshot con la misma
función (`derivarIngresoOrden`) que produjo los importes originales.

**Lo único que se añade a un contrato es un STRING derivado por fila del listado**
(`CierreBodegaResumen.quedaTrasPagos`) y **tres STRING derivados en el detalle**
(`paraLaTienda` ya existe como `pagoTienda`; se añaden `netoOrdenex` y `quedaTrasPagos`). Ninguno
se persiste.

> Si al implementar se concluye que hace falta una migración: **PARAR y avisar al leader**. La
> ficha lo dice y este diseño lo confirma con los anclajes de arriba.

---

## 2 — La aritmética: dónde se hace cada resta

**Regla dura (R12/R13/R14):** *ninguna* resta ocurre en el navegador. Las cinco funciones puras
viven en `lib/utils/ingreso-ordenex.ts`, junto a sus dos hermanas que ya están ahí, y toda la
aritmética es `Prisma.Decimal` con salida `toFixed(2)`.

### 2.1 — Lo que ya existe y NO se toca

```
lib/utils/ingreso-ordenex.ts:352-358   pagoTiendaOrdenex(general, fleteConIva, comisionConIva)
lib/utils/ingreso-ordenex.ts:334-336   gananciaOrdenex(ingresoTotal, pagoMensajero)
lib/utils/ingreso-ordenex.ts:282-320   totalesIngresoOrdenex(gestiones)
```

`pagoTiendaOrdenex` **es** «Para la tienda». No se reescribe, no se renombra la función (la usa
también el detalle del cierre de mensajero, `CierresAdminService.ts:601-700`): lo que cambia es
**cómo se rotula y dónde se coloca** el número que ya devuelve.

### 2.2 — Lo que se añade (dos funciones puras, en el mismo archivo)

```ts
// Neto de Ordenex: lo facturado menos lo que Ordenex paga —a los mensajeros y a la bodega
// satélite—. NO es `gananciaOrdenex`: aquella no resta la bodega, y por eso el humano vio dos
// números que sólo coinciden cuando la bodega es 0.
netoOrdenex(ingresoTotal: string, pagoMensajero: string, pagoBodega: string): string

// Lo que queda en la bodega tras sus dos pagos. Es la cascada B entera.
quedaTrasPagos(general: string, pagoMensajero: string, pagoBodega: string): string
```

Ambas: `new Prisma.Decimal(a).minus(b).minus(c).toFixed(2)`. Nada más. Y **no** se implementan como
`gananciaOrdenex(...) - pagoBodega` encadenado en el servicio: se declaran enteras para que la
identidad de R8/R9 viva en un solo sitio auditable.

### 2.3 — Quién las llama

| Superficie | Quién deriva | Archivo |
| --- | --- | --- |
| Detalle agregado (maestro) | `CierresBodegaAdminService.verCierreBodegaDetalle` | `lib/services/CierresBodegaAdminService.ts:262-333` |
| Detalle por `cierre_dia` | idem, dentro del `map` de `found.cierresDia` | `:283-314` |
| Tarjeta y su archivo (las 4 lecturas) | `toBodegaResumenRow` | `lib/repositories/CierreBodegaRepository.ts:78-94` |

**Por qué `quedaTrasPagos` se deriva en el mapper del repositorio y no en cada servicio.**
`toBodegaResumenRow` está exportado y lo reusan `CierreBodegaRepository` (satélite) y
`CierresBodegaAdminRepository` (maestro) para **cuatro** lecturas: cola de pendientes, histórico,
solicitados de la zona y los conjuntos completos de descarga. Derivar ahí es **una** resta por fila,
sin consulta extra, y garantiza por construcción que las cuatro lecturas —y sus cuatro archivos—
digan lo mismo. Derivarlo en cada servicio son cuatro copias y la primera divergencia asegurada.

El mapper ya hace `.toFixed(2)` sobre `Decimal`: es la frontera del dinero, no lógica de negocio
nueva. La resta la hace la función pura de `lib/utils/`, no el repositorio.

---

## 3 — La cascada A, y la línea puente que la hace cerrar

Este es el corazón técnico. `derivarIngresoOrden` (`:145-187`) emite:

- de una **`entregada`**: `flete`, `iva_flete`, y —si `cobraComision`— `comision_cod`, `iva_comision_cod`;
- de una **`rechazada`**: `flete_devolucion`, `iva_flete_devolucion`;
- de `devuelta` / `reprogramada` / `incidente`: **nada**.

Por tanto, con los nombres de `TotalesIngresoOrdenex`:

```
total  =  fleteConIva  +  comisionConIva  +  fleteDevolucionConIva
          └────────── deducible ─────────┘    └── NO deducible ──┘
```

Y `pagoTiendaOrdenex` resta **sólo el deducible**, con su motivo escrito en el docstring: un rechazo
no recauda COD, así que ese dinero **nunca entró** en `total_general` y no hay de dónde restarlo.

**Consecuencia:** en un cierre con rechazos, `recaudado − ingreso bruto ≠ para la tienda`. Si la
cascada empezara por el bruto, la pantalla enseñaría una resta que no da — exactamente lo que la
ficha prohíbe. La cascada A se parte en dos mitades unidas por una línea puente:

```
DE QUIÉN ES EL DINERO

  Total general                                        ₡126.089
  − Flete + IVA                                        −₡ 23.xxx
  − Comisión COD + IVA                                 −₡  3.xxx
  ─────────────────────────────────────────────────────────────
  = PARA LA TIENDA                                     ₡ 98.954,17     ← destacado

  Cobrado sobre lo recaudado                           ₡ 27.134,83
  + Flete por rechazo + IVA  (no sale de lo recaudado) +₡      0
  ─────────────────────────────────────────────────────────────
  = Lo que Ordenex facturó                             ₡ 27.134,83
  − Pago a mensajeros                                  −₡ 14.000
  − Pago a la bodega satélite                          −₡      0
  ─────────────────────────────────────────────────────────────
  = NETO DE ORDENEX                                    ₡ 13.134,83     ← destacado
```

`Cobrado sobre lo recaudado` **no es un dato nuevo**: es la suma de las dos líneas de arriba, y se
deriva server-side (`fleteConIva + comisionConIva`) para que la línea puente no obligue al
navegador a sumar. Se pinta **siempre**, también con `fleteDevolucionConIva = "0.00"` (R10): un cero
explícito dice «aquí no hubo rechazos»; su ausencia dejaría al lector deduciéndolo de un hueco, que
es el defecto que la ficha 338 midió con «Tarifa aplicada».

## 4 — La cascada B

```
QUÉ SALE DE LA BODEGA

  Total general                                        ₡126.089
  − Pago a mensajeros                                  −₡ 14.000
  − Pago a la bodega satélite                          −₡      0
  ─────────────────────────────────────────────────────────────
  = QUEDA TRAS LOS PAGOS                               ₡112.089        ← destacado
```

**Nota obligatoria bajo el resultado (R26):** *«No es efectivo en caja: parte de lo recaudado entró
por SINPE o transferencia.»* El desglose por método está a la izquierda en la tarjeta y arriba en el
detalle, así que quien quiera saber cuánto era efectivo lo tiene a la vista.

**Nota obligatoria en la línea de la bodega (R27):** *«Lo que se le reconoce a la bodega satélite
por los rechazos. No es un movimiento de caja registrado.»* Respaldo: `FUENTE_CAJA`
(`lib/utils/aporte-por-orden.ts:55-76`) es un `Record` **total** de las categorías del libro y **no
tiene ninguna** del ingreso de bodega; y `specs/56-.../requirements.md:56-57` lo declara.

---

## 5 — Rótulos (constantes nuevas, i18n-ready)

Van en `app/(app)/cierres-admin/_components/cierre-labels.ts` (módulo PURO, sin React — es donde ya
viven las etiquetas que necesitan también los archivos de descarga) y se re-exportan desde
`cierre-detalle-shared.tsx`, siguiendo el patrón que ese archivo ya declara en su cabecera (`:82-88`).

| Constante | Texto | Nota |
| --- | --- | --- |
| `CASCADA_DUENO_TITULO` | «De quién es el dinero» | rótulo + nombre accesible de la región A |
| `CASCADA_CAJA_TITULO` | «Qué sale de la bodega» | rótulo + nombre accesible de la región B |
| `PARA_LA_TIENDA_LABEL` | «Para la tienda» | sustituye a `PAGO_TIENDA_LABEL` **sólo en las superficies de bodega** |
| `NETO_ORDENEX_LABEL` | «Neto de Ordenex» | |
| `COBRADO_SOBRE_RECAUDADO_LABEL` | «Cobrado sobre lo recaudado» | la línea puente |
| `FACTURADO_ORDENEX_LABEL` | «Lo que Ordenex facturó» | mismo número que el actual «Ingreso bruto» |
| `PAGO_BODEGA_SATELITE_LABEL` | «Pago a la bodega satélite» | **D3**: sólo en superficies de bodega |
| `QUEDA_TRAS_PAGOS_LABEL` | «Queda tras los pagos» | **D2** |
| `QUEDA_TRAS_PAGOS_NOTA` | «No es efectivo en caja: …» | R26 |
| `PAGO_BODEGA_SATELITE_NOTA` | «Lo que se le reconoce… no es un movimiento de caja registrado.» | R27 |
| `FLETE_RECHAZO_NO_DEDUCIBLE_NOTA` | «Se le factura a la tienda, pero no sale de lo recaudado: un rechazo no cobra contra entrega.» | R10 |

**Los que se REUSAN tal cual** (R23/R24/D5): `FLETE_CON_IVA_LABEL`, `COMISION_CON_IVA_LABEL`,
`FLETE_DEV_CON_IVA_LABEL` («Flete por rechazo + IVA», ficha 338), `PAGO_MENSAJERO_LABEL`,
`RESUMEN_TOTAL_LABEL` («Total», primera línea en la tarjeta) y el `labelGeneral` de `TotalesPanel`
(«Total general», primera línea en el detalle).

**Los que NO se tocan** (R21/R30): `INGRESO_BODEGA_RECHAZOS_LABEL`, `GANANCIA_LABEL`,
`GANANCIA_NOTA`, `INGRESO_BRUTO_LABEL`, `PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA`,
`RESUMEN_AJUSTES_TITULO` — siguen vivos porque los usan las superficies del cierre de **mensajero**
y `CierreFacturaDetalle`.

---

## 6 — Contratos de entrada/salida

### 6.1 — `CierreBodegaResumen` (`lib/interfaces/services/ICierreBodegaService.ts:22-36`)

```ts
export interface CierreBodegaResumen {
  …                                  // sin cambios
  /**
   * DERIVADO (STRING money-safe escala 2): `totales.general − totalPagoMensajero −
   * totalIngresoBodegaRechazos`. Es la cascada B entera, resuelta en el servidor porque la
   * tarjeta no hace aritmética (R13/R20). Puede ser NEGATIVO.
   */
  quedaTrasPagos: string;
}
```

**Campo REQUERIDO, no opcional**, y a propósito: hacerlo opcional deja que una superficie nueva
nazca sin él y el compilador calle — que es exactamente el modo de fallo que
`cierre-detalle-superficies.guardia.test.ts` (ficha 264) existe para tapar. El typecheck enrojecerá
en los literales de los dobles de test; ese rojo es la señal.

`CierreBodegaResumenLite` (el `cierre_dia` consolidable) **NO cambia**: R21 lo prohíbe.

### 6.2 — `CierreBodegaDetalleCierre` y el resultado del detalle
(`ICierreBodegaService.ts:51-67` y `ICierresBodegaAdminService`)

Se añaden, en el agregado **y** en cada `cierre_dia`:

```ts
  cobradoSobreRecaudado: string;  // fleteConIva + comisionConIva (la línea puente, R7)
  netoOrdenex: string;            // facturado − pagoMensajero − pagoBodega (R8)
  quedaTrasPagos: string;         // general − pagoMensajero − pagoBodega (R9)
```

`pagoTienda` (= «Para la tienda») y `ganancia` **se conservan tal cual**: `ganancia` la sigue
leyendo el detalle del cierre de **mensajero** a través del mismo tipo, y quitarla sería tocar R30.
En la superficie de bodega **no se pinta** (queda absorbida por `netoOrdenex`, que es la que el
humano describió).

### 6.3 — Descarga (R22 / Q5)

`app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas.ts:53-144` — los cuatro
listados ganan **una** columna al final de las que ya tienen, sin reordenar ninguna:
`{ clave: "quedaTrasPagos", encabezado: QUEDA_TRAS_PAGOS_LABEL }`. La proyección lee el campo del
DTO; no hace ninguna operación.

⚠️ Esto toca `columnas-asercion-de-orden.guardia` y `cobertura-tablas.guardia`: sus aserciones de
orden de columnas hay que **ampliarlas**, y esa ampliación se hace por escrito y con motivo (ver
`tasks.md § G`). El listado del `cierre_dia` consolidable **no** gana columna (R21).

---

## 7 — Las dos superficies, archivo por archivo

### 7.1 — La tarjeta: `cierre-factura.tsx`

`HojaResumen` (`:596-784`) la comparten **cuatro** superficies (`:501`, `:800`, `:848`, `:890`), así
que **no se le cambia ni un rótulo**. Se le añade **una prop opcional**:

```ts
  /**
   * La cascada «qué sale de la bodega», ya derivada. Presente SÓLO en el comprobante de un cierre
   * de bodega: sustituye a la columna «Ajustes» de esa superficie y deja las otras tres
   * exactamente como estaban (R19/R21). Ausente ⇒ se pinta «Ajustes» como hoy.
   */
  cascadaCaja?: { quedaTrasPagos: string };
```

En el bloque `open` (`:722-781`), la columna del medio pasa a ser:

- `cascadaCaja === undefined` → **byte a byte lo de hoy**: `<section aria-label={RESUMEN_AJUSTES_TITULO}>` con sus dos `LineaMonto`.
- `cascadaCaja !== undefined` → `<section aria-label={CASCADA_CAJA_TITULO}>` con cuatro líneas:
  `RESUMEN_TOTAL_LABEL` / `PAGO_MENSAJERO_LABEL` (restando) / `PAGO_BODEGA_SATELITE_LABEL`
  (restando) / `QUEDA_TRAS_PAGOS_LABEL` destacado, más `QUEDA_TRAS_PAGOS_NOTA`.

Sólo `CierreBodegaFacturaResumen` (`:800-833`) pasa la prop, desde `cierre.quedaTrasPagos`.
La rejilla sigue siendo `md:grid-cols-[1.2fr_1fr_1fr]`: son tres columnas antes y después.

⚠️ **`tests/unit/guards/factura-contraste.guardia.test.ts`** mantiene el inventario CERRADO de pares
(tinta, fondo) de las dos hojas y se pone roja ante una utilidad de color nueva. La cascada **no
estrena color**: reusa `LineaMonto`, `TituloColumna` y el patrón `font-medium text-foreground` que
ya están censados. Si hiciera falta un tono para el negativo, se usa `esMontoNegativo` +
`text-danger-strong`, que **ya está censado** en `cierre-detalle-shared.tsx:604-608`.

### 7.2 — El detalle: `CierresBodegaAdminModule.tsx:520-640`

Orden nuevo del modal, **agregado**:

1. `TotalesPanel` «Totales del cierre de bodega» — **sin cambios** (R29).
2. **`CascadaDinero` A** — «De quién es el dinero» (§3).
3. **`CascadaDinero` B** — «Qué sale de la bodega» (§4).
4. `TotalesIngresoPanel` «Ingreso de Ordenex» — **sin cambios**: es el desglose por concepto de la
   línea «Lo que Ordenex facturó», y su `INGRESO_TOTAL_LABEL` ya dice «Total Ordenex».
5. Motivo de rechazo, si lo hay — sin cambios.
6. Una sección por `cierre_dia`, cada una con **sus dos cascadas** con los mismos rótulos.
7. Botonera — sin cambios.

**Se retiran de esta superficie** (R34/D4) las cinco tarjetas sueltas de `:537-569` y `:602-630`:
`MontoDerivadoCard` «Ingreso bruto», `PagoMensajeroTotal`, `MontoDerivadoCard` «Ganancia»,
`IngresoBodegaRechazosTotal` y `MontoDerivadoCard` «Pago a tienda». Los **componentes no se borran**
—los usa `CierresAdminModule`—; se deja de montarlos aquí.

> ⚠️ Lección medida de este árbol («el test que vive dentro de lo que borras»): antes de tocar esta
> sección hay que censar qué tests localizan esos `aria-label` (`"Ganancia del cierre de bodega"`,
> `"Pago a tienda del cierre de bodega"`, `"Ingreso bruto del cierre de bodega"`…). Está como tarea
> bloqueante **T0.4**.

### 7.3 — El componente nuevo: `CascadaDinero`

Vive **junto a la pantalla** que lo usa (`app/(app)/cierres-admin/_components/CascadaDinero.tsx`),
no en `components/shared/`: `docs/architecture.md § Regla: sin sobre-ingeniería` — se promueve
cuando **dos** features lo necesiten con la misma API.

```ts
interface LineaCascada {
  label: string;
  monto: string;          // STRING ya derivado; el componente NO calcula
  signo: "suma" | "resta" | "neutro";
  destacado?: boolean;
  nota?: string;
}
interface CascadaDineroProps {
  titulo: string;
  ariaLabel: string;
  lineas: readonly LineaCascada[];
}
```

Sin lógica de dominio: el servicio decide qué líneas hay y en qué orden. El componente pinta el
signo, el destacado y las notas. `money()` es lo único que toca los importes.

---

## 8 — Alternativas descartadas

**A1 — Poner las dos cascadas también en la tarjeta, derivando el ingreso de Ordenex en el
listado. DESCARTADA.**
El ingreso de Ordenex **no está guardado**: `cierre_detail` congela las entradas de la fórmula, no
los conceptos (`schema.prisma:2234-2264`). Derivarlo para una tarjeta exige leer **todas** las
`cierre_detail` de **todos** los `cierre_dia` de **todos** los cierres de la página y pasarlas por
`derivarIngresoOrden`. Y el mismo DTO (`CierreBodegaResumen`) alimenta cuatro caminos de **descarga
sin cota de filas** (`findColaCompleta`, `findHistoricoCompleto` y sus dos hermanos del satélite:
`CierresBodegaAdminService.ts:204-226` declara la excepción a R29 de la 170 — «la cola entra entera
antes de medirse»). Sería una consulta pesada en una ruta caliente, que es un anti-patrón que el
reviewer rechaza. **Coste medido del descarte:** «Para la tienda» y «Neto de Ordenex» sólo se ven
abriendo el detalle. Está escrito como **Q1**.

**A2 — Dos columnas de snapshot nuevas en `cierre_bodega` y `cierre_dia`
(`total_flete_con_iva`, `total_comision_con_iva`). DESCARTADA.**
Resolvería A1 sin coste de consulta, pero: (a) es una **migración money-critical con backfill**, y
el backfill tendría que re-derivar `derivarIngresoOrden` sobre todo el histórico de `cierre_detail`
—la misma cuenta, una vez— para dejar **una segunda fuente de verdad para siempre**, con su propio
riesgo de divergencia (el repo ya tiene un servicio dedicado a vigilar exactamente esa clase de
descuadre: `ConciliacionCierresAnaliticaRepository`); (b) la ficha dice explícitamente que los datos
ya existen y que si el implementador concluye lo contrario, **pare**; (c) la base local es
compartida entre worktrees y una migración pone rojo el gate de las otras fichas vivas. **Si Q1 sale
«sí», ésta es la vía**, y entonces esta ficha se re-especifica.

**A3 — Una Server Action nueva y estrecha por tarjeta (`resumenCascadasCierreBodega(id)`), cargada
al desplegar. DESCARTADA para esta ficha.**
Es la vía correcta si Q1 sale «sí» y no se quiere migración: coste acotado a **un** cierre, sin
firmar URLs de evidencia y sin DTOs por gestión (a diferencia de reusar `verCierreBodegaDetalle`,
que firma en lote todas las evidencias, `CierresBodegaAdminService.ts:271-279`). Se descarta ahora
porque exige **dos** acotamientos de alcance distintos —el maestro por rol, el satélite por su
`zonaId` resuelto server-side— y el precio de equivocarse ahí no es un test rojo: es el dinero de
la bodega vecina (`ICierreBodegaService.ts:155-164` lo escribe con esas palabras).

**A4 — Sacar el ingreso de Ordenex del LIBRO DE CAJA en vez de derivarlo. DESCARTADA.**
Al aprobar un cierre se emiten movimientos por concepto (`ingreso_flete`, `ingreso_comision_cod`…,
`FUENTE_CAJA` en `lib/utils/aporte-por-orden.ts:55-76`), agregables con un `groupBy` barato. Pero:
(a) sólo existen para cierres **aprobados** —la cola de pendientes es justo donde se decide—; (b)
introduce una **segunda fuente** para la misma cifra, y comparar snapshot contra libro es
literalmente lo que hace el detector de descuadres de este repo. Un número que a veces sale del
snapshot y a veces del libro es una contradicción esperando el primer descuadre.

**A5 — Renombrar «Ajustes» en `HojaResumen` para las cuatro superficies. DESCARTADA.**
El rótulo es igual de falso en el comprobante del mensajero, pero ahí la columna contiene
«Ganancia» (`audiencia="mensajero"`, `:739`) y el nombre correcto para **esa** audiencia es otra
decisión, del tipo que el humano firmó una vez en la 338. Esta ficha es del cierre de bodega:
arregla lo evidenciado y deja el resto escrito como **Q4**.

**A6 — Empezar la cascada A por el «Ingreso bruto». DESCARTADA por incorrecta.**
`recaudado − bruto ≠ para la tienda` en cuanto hay un rechazo (§3). Es exactamente «una pantalla que
enseña una resta que no da», que es peor que la de hoy.

---

## 9 — ¿Los números cuadran al consolidar varios días?

**Sí, exactamente, y por construcción — razonado sobre el código, NO medido todavía.**

La demostración tiene tres patas, todas leídas en disco:

1. **Los tres snapshots agregados son la suma exacta de los de sus días.** `solicitarCierreBodega`
   los calcula con `sumTotales` / `sumPagoMensajero` / `sumIngresoBodega`
   (`lib/services/CierreBodegaService.ts:42-80`, llamadas en `:442-446`) sobre **el mismo conjunto
   de `cierre_dia` que se vincula en la misma transacción** (`crearCierreBodega`,
   `lib/repositories/CierreBodegaRepository.ts:298-300`). Aritmética `Prisma.Decimal`, sin redondeo
   intermedio.
2. **Nadie los mueve después.** `resolverCierreBodega` es «un único UPDATE guardado por estado; NO
   toca `cierre_dia` ni otra tabla» (`CierresBodegaAdminRepository.ts:188-189,426-474`). Y la
   corrección del desglose de pagos, que **sí** reescribe `total_general` de un `cierre_dia`
   (`CierresAdminRepository.ts:1402-1411`), está guardada por `estado IN ESTADOS_ABIERTOS` — y un
   consolidable es `aprobado` por definición del listado.
3. **Las sumas de conceptos no pierden céntimos.** Cada `ingresoOrdenex.*` por gestión ya es escala
   2; `totalesIngresoOrdenex` suma con `Decimal` y `toFixed(2)` al final. Sumar por días y luego
   sumar los días da lo mismo que sumar todas las gestiones de una vez: no hay redondeo intermedio
   que se pueda acumular.

Por tanto, para las tres cifras nuevas:

```
paraLaTienda(agregado)     = Σ_d paraLaTienda(d)
netoOrdenex(agregado)      = Σ_d netoOrdenex(d)
quedaTrasPagos(agregado)   = Σ_d quedaTrasPagos(d)
```

⚠️ **Esto es una imposibilidad razonada, y en este árbol una imposibilidad razonada ya se ha
desmentido midiendo.** Por eso `tasks.md` lo convierte en:
- **T0.3**, una consulta de solo lectura contra la base real que mide las tres identidades del
  snapshot sobre **todos** los cierres de bodega existentes, **antes** de escribir código; y
- **B5**, un test que las afirma con céntimos (no con cifras redondas, que cerrarían igual sin el
  arreglo).

**Si la medición desmiente alguna identidad**, el diseño NO cambia —cada cascada se deriva de su
propio nivel (R15/R17)— pero hay que abrir ficha aparte por el descuadre del snapshot, y decirlo:
**no se maquilla en pantalla**.

---

## 10 — Permisos, RLS y alcance

Nada nuevo. Ni tabla, ni política, ni endpoint. Los cuatro caminos de lectura siguen siendo los que
ya existen, con los acotamientos que ya tienen:

- maestro → `esAccesoTotal(actor.rol)` antes de tocar el repositorio
  (`CierresBodegaAdminService.ts:216,249,266`);
- adminSatelite → `findUsuarioZonaId(actor.usuarioId)`, **jamás** desde la petición
  (`CierreBodegaService.ts:152`; el porqué está escrito en `ICierreBodegaService.ts:155-164`).

El único dato que cruza de más es `quedaTrasPagos`, y es una resta de tres números que **la misma
fila ya lleva**: no expone nada que su lector no viera.

Para las cascadas del detalle no hay superficie nueva: `verCierreBodegaDetalle` sólo la consume el
maestro.

---

## 11 — Verificación y gate

El diff toca `lib/interfaces/` (no `lib/types/`) pero **sí** archivos cuyo nombre lleva `cierre`,
`ingreso`, `pago` y `factura`. Según `docs/verification.md § Cuándo --rapido se niega`, esos nombres
de dinero **niegan el modo rápido**: el gate de esta ficha es **`./init.sh` completo**, escrito
antes de empezar para que no sea una sorpresa al final.

Sin `DATABASE_URL` resoluble se saltan ~77 archivos de test contra Postgres y el gate termina verde
sin haber tocado la capa de datos: hay que **contar los `skipped`** y citar la línea
«DATABASE_URL resuelta», no sólo el `INIT_EXIT`.
