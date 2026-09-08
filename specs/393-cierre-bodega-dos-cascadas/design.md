# Ficha 393 — Diseño

> El CÓMO. Los requisitos están en `requirements.md`; el desglose y las mutaciones, en `tasks.md`.
> Todos los anclajes de archivo/línea se leyeron **en disco** el 2026-09-07/08.
>
> **Revisión 2 (2026-09-08).** El humano explicó para qué sirve el número de la cascada B. Cambian:
> el rótulo (§5), dónde vive (§7.1), el caso negativo (§12) y la descarga (§6.3). **No cambia** el
> veredicto de migración (§1) ni la línea puente (§3).

---

## 1 — El modelo de datos: **NO hace falta migración**, y por qué

**Veredicto: cero migraciones. Cero columnas. Cero RLS nueva. Cero `down.sql`.**

Las dos cascadas se componen de cinco magnitudes. Tres son snapshot que ya existen; dos se derivan
de un snapshot inmutable que ya se lee en el mismo camino.

| Magnitud | De dónde sale hoy | ¿Existe? |
| --- | --- | --- |
| Lo recaudado | `cierre_bodega.total_general` / `cierre_dia.total_general` | **sí**, snapshot |
| Pago a mensajeros | `cierre_bodega.total_pago_mensajero` / idem por día | **sí**, snapshot |
| Lo que gana la bodega satélite | `cierre_bodega.total_ingreso_bodega_rechazos` / idem por día | **sí**, snapshot |
| Flete + IVA · Comisión + IVA · Flete por rechazo + IVA | `totalesIngresoOrdenex(gestiones)` sobre el desglose que **ya se carga** en `verCierreBodegaDetalle` | **sí**, derivado |
| Para la tienda · Neto de Ordenex · **Para la central** | restas de lo anterior | **se derivan** |

**La cascada B —la que el humano necesita para operar— se compone de las TRES magnitudes que son
snapshot puro.** Por eso puede vivir en la tarjeta sin una consulta más, y por eso esta ficha no
lleva migración pese a que el número no exista hoy en ninguna pantalla.

`cierre_detail` (`db/schema.prisma:2229-2290`) congela las **entradas** de la fórmula y es
`INMUTABLE` por diseño (`// SIN updated_at / deleted_at: fila INMUTABLE (R10)`), así que derivar de
él es reproducible: no es «recalcular con datos de hoy», es leer el mismo snapshot con la misma
función (`derivarIngresoOrden`) que produjo los importes originales.

**Lo único que se añade a un contrato son campos derivados, ninguno persistido:** en la fila del
listado, `paraLaCentral: string` y `efectivoCubreDescuentos: boolean`; en el detalle,
`cobradoSobreRecaudado`, `netoOrdenex` y `paraLaCentral`.

> Si al implementar se concluye que hace falta una migración: **PARAR y avisar al leader**.

---

## 2 — La aritmética: dónde se hace cada resta

**Regla dura (R12/R13/R14):** *ninguna* resta ocurre en el navegador. Las funciones puras viven en
`lib/utils/ingreso-ordenex.ts`, junto a sus dos hermanas que ya están ahí, y toda la aritmética es
`Prisma.Decimal` con salida `toFixed(2)`.

### 2.1 — Lo que ya existe y NO se toca

```
lib/utils/ingreso-ordenex.ts:352-358   pagoTiendaOrdenex(general, fleteConIva, comisionConIva)
lib/utils/ingreso-ordenex.ts:334-336   gananciaOrdenex(ingresoTotal, pagoMensajero)
lib/utils/ingreso-ordenex.ts:282-320   totalesIngresoOrdenex(gestiones)
```

`pagoTiendaOrdenex` **es** «Para la tienda». No se reescribe ni se renombra la función (la usa
también el detalle del cierre de mensajero, `CierresAdminService.ts:601-700`): lo que cambia es
**cómo se rotula y dónde se coloca** el número que ya devuelve.

### 2.2 — Lo que se añade (tres funciones puras, en el mismo archivo)

```ts
// Neto de Ordenex: lo facturado menos lo que Ordenex paga —a los mensajeros y a la bodega
// satélite—. NO es `gananciaOrdenex`: aquella no resta la bodega, y por eso el humano vio dos
// números que sólo coinciden cuando la bodega es 0.
netoOrdenex(ingresoTotal: string, pagoMensajero: string, ganaBodega: string): string

// LO QUE LA SATÉLITE LE ENTREGA A LA CENTRAL. Los dos sustraendos son exactamente los dos
// descuentos que la bodega registra (pedido humano del 2026-09-08). Puede ser NEGATIVO: ver §12.
paraLaCentral(general: string, pagoMensajero: string, ganaBodega: string): string

// ¿Los dos descuentos caben en el EFECTIVO recaudado? Comparación con Prisma.Decimal, sin restar
// ni emitir un importe: devuelve un booleano, porque lo que la pantalla necesita es un AVISO
// (R37), no un número más. Emitir «cuánto falta» sería un cuarto importe que nadie pidió.
efectivoCubreDescuentos(efectivo: string, pagoMensajero: string, ganaBodega: string): boolean
```

Las dos primeras: `new Prisma.Decimal(a).minus(b).minus(c).toFixed(2)`. Nada más. Y **no** se
implementan encadenando `gananciaOrdenex(...)`: se declaran enteras para que la identidad de R8/R9
viva en un solo sitio auditable.

### 2.3 — Quién las llama

| Superficie | Quién deriva | Archivo |
| --- | --- | --- |
| Detalle agregado (maestro) | `CierresBodegaAdminService.verCierreBodegaDetalle` | `lib/services/CierresBodegaAdminService.ts:262-333` |
| Detalle por `cierre_dia` | idem, dentro del `map` de `found.cierresDia` | `:283-314` |
| Tarjeta y su archivo (las 4 lecturas) | `toBodegaResumenRow` | `lib/repositories/CierreBodegaRepository.ts:78-94` |

**Por qué `paraLaCentral` se deriva en el mapper del repositorio y no en cada servicio.**
`toBodegaResumenRow` está exportado y lo reusan `CierreBodegaRepository` (satélite) y
`CierresBodegaAdminRepository` (maestro) para **cuatro** lecturas: cola de pendientes, histórico,
solicitados de la zona y los conjuntos completos de descarga. Derivar ahí es **una** resta por fila,
sin consulta extra, y garantiza por construcción que las cuatro lecturas —y sus tres archivos— digan
lo mismo. Es además lo que hace cumplir **R38** sin escribirlo dos veces: la tarjeta del maestro y la
de la satélite salen del mismo mapper, así que **no pueden** discrepar.

El mapper ya hace `.toFixed(2)` sobre `Decimal`: es la frontera del dinero, no lógica de negocio
nueva. La resta la hace la función pura de `lib/utils/`, no el repositorio.

---

## 3 — La cascada A, y la línea puente que la hace cerrar

`derivarIngresoOrden` (`:145-187`) emite:

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
cascada empezara por el bruto, la pantalla enseñaría una resta que no da. La cascada A se parte en
dos mitades unidas por una línea puente:

```
DE QUIÉN ES EL DINERO                              (sólo en el DETALLE — R39)

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
  − Gana la bodega satélite                            −₡      0
  ─────────────────────────────────────────────────────────────
  = NETO DE ORDENEX                                    ₡ 13.134,83     ← destacado
```

`Cobrado sobre lo recaudado` **no es un dato nuevo**: es la suma de las dos líneas de arriba, y se
deriva server-side (`fleteConIva + comisionConIva`) para que la línea puente no obligue al
navegador a sumar. Se pinta **siempre**, también con `fleteDevolucionConIva = "0.00"` (R10): un cero
explícito dice «aquí no hubo rechazos»; su ausencia dejaría al lector deduciéndolo de un hueco, que
es el defecto que la ficha 338 midió con «Tarifa aplicada».

## 4 — La cascada B: lo que la satélite le entrega a la central

Va en **la tarjeta** (las dos pantallas, R38) **y** en el detalle (R1).

```
LO QUE VA A LA CENTRAL

  Total                                                ₡126.089
  − Pago a mensajeros                                  −₡ 14.000
  − Gana la bodega satélite                            −₡      0
  ─────────────────────────────────────────────────────────────
  = PARA LA CENTRAL                                    ₡112.089        ← destacado
```

**Nota fija bajo el resultado (R26):** *«Lo recaudado menos el pago a los mensajeros y menos lo que
gana la bodega satélite por los rechazos.»* Dice la resta en el idioma de quien la hace; no dice
«no es efectivo en caja» porque eso, cuando toca, lo dice la nota condicional de R37 (§12.2) y una
advertencia permanente que casi nunca aplica se deja de leer.

**Nota fija en la línea de la bodega (R27):** *«Lo que se le reconoce a la bodega satélite por los
rechazos. No es un movimiento de caja registrado.»* Respaldo: `FUENTE_CAJA`
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
| `CASCADA_CENTRAL_TITULO` | «Lo que va a la central» | rótulo + nombre accesible de la región B |
| `PARA_LA_TIENDA_LABEL` | «Para la tienda» | sustituye a `PAGO_TIENDA_LABEL` **sólo en las superficies de bodega** |
| `PARA_LA_CENTRAL_LABEL` | **«Para la central»** | el resultado de la cascada B (D2′) |
| `NETO_ORDENEX_LABEL` | «Neto de Ordenex» | |
| `COBRADO_SOBRE_RECAUDADO_LABEL` | «Cobrado sobre lo recaudado» | la línea puente |
| `FACTURADO_ORDENEX_LABEL` | «Lo que Ordenex facturó» | mismo número que el actual «Ingreso bruto» |
| `GANA_BODEGA_SATELITE_LABEL` | **«Gana la bodega satélite»** | D3′; sólo en superficies de bodega |
| `PARA_LA_CENTRAL_NOTA` | «Lo recaudado menos el pago a los mensajeros y menos lo que gana la bodega satélite por los rechazos.» | R26 |
| `PARA_LA_CENTRAL_NEGATIVO_NOTA` | «Los descuentos superan lo recaudado en este cierre: la satélite no entrega nada y la central pone la diferencia.» | R36 |
| `EFECTIVO_NO_CUBRE_NOTA` | «El efectivo recaudado no cubre los descuentos: parte de lo recaudado entró por SINPE o transferencia.» | R37 |
| `GANA_BODEGA_SATELITE_NOTA` | «Lo que se le reconoce a la bodega satélite por los rechazos. No es un movimiento de caja registrado.» | R27 |
| `FLETE_RECHAZO_NO_DEDUCIBLE_NOTA` | «Se le factura a la tienda, pero no sale de lo recaudado: un rechazo no cobra contra entrega.» | R10 |

**Por qué «Para la central» y no otra cosa** (D2′): dice **a dónde va** el dinero —que es lo que el
humano describió— y **rima con «Para la tienda»**: dos preguntas de la misma familia con dos
rótulos de la misma forma, que es lo que hace que las dos cascadas se lean como una sola historia.
Descartados: **«Entrega a la central»** («entrega/entregada» es el desenlace de una gestión en esta
app, y colisionaría en la misma pantalla que la tabla de entregadas) y **«Queda en caja»** (lo
recaudado incluye SINPE y transferencia).

**Los que se REUSAN tal cual** (R23/R24/D5): `FLETE_CON_IVA_LABEL`, `COMISION_CON_IVA_LABEL`,
`FLETE_DEV_CON_IVA_LABEL` («Flete por rechazo + IVA», ficha 338), `PAGO_MENSAJERO_LABEL`,
`RESUMEN_TOTAL_LABEL` («Total», primera línea en la tarjeta) y el `labelGeneral` de `TotalesPanel`
(«Total general», primera línea en el detalle).

**Los que NO se tocan** (R21/R30): `INGRESO_BODEGA_RECHAZOS_LABEL`, `GANANCIA_LABEL`,
`GANANCIA_NOTA`, `INGRESO_BRUTO_LABEL`, `PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA`,
`RESUMEN_AJUSTES_TITULO`, **`CENTRAL_DEBE_LABEL`/`CENTRAL_DEBE_NOTA`** — este último a propósito
(D6): ya significa otra cosa muy concreta en la consolidación.

---

## 6 — Contratos de entrada/salida

### 6.1 — `CierreBodegaResumen` (`lib/interfaces/services/ICierreBodegaService.ts:22-36`)

```ts
export interface CierreBodegaResumen {
  …                                  // sin cambios
  /**
   * DERIVADO (STRING money-safe escala 2): `totales.general − totalPagoMensajero −
   * totalIngresoBodegaRechazos`. LO QUE LA SATÉLITE LE ENTREGA A LA CENTRAL — el número que el
   * humano pidió el 2026-09-08 y que no existía en ninguna pantalla. Resuelto en el servidor
   * porque la tarjeta no hace aritmética (R13/R20). Puede ser NEGATIVO (§12).
   */
  paraLaCentral: string;
  /**
   * DERIVADO: ¿los dos descuentos caben en el EFECTIVO recaudado? `false` enciende el aviso de
   * R37. Es un booleano y no un importe a propósito: la pantalla necesita un aviso, no un cuarto
   * número que nadie pidió.
   */
  efectivoCubreDescuentos: boolean;
}
```

**Campos REQUERIDOS, no opcionales**, y a propósito: hacerlos opcionales deja que una superficie
nueva nazca sin ellos y el compilador calle — que es exactamente el modo de fallo que
`cierre-detalle-superficies.guardia.test.ts` (ficha 264) existe para tapar. El typecheck enrojecerá
en los literales de los dobles de test; ese rojo es la señal.

`CierreBodegaResumenLite` (el `cierre_dia` consolidable) **NO cambia**: R21 lo prohíbe.

### 6.2 — `CierreBodegaDetalleCierre` y el resultado del detalle
(`ICierreBodegaService.ts:51-67` y `ICierresBodegaAdminService`)

Se añaden, en el agregado **y** en cada `cierre_dia`:

```ts
  cobradoSobreRecaudado: string;  // fleteConIva + comisionConIva (la línea puente, R7)
  netoOrdenex: string;            // facturado − pagoMensajero − ganaBodega (R8)
  paraLaCentral: string;          // general − pagoMensajero − ganaBodega (R9)
  efectivoCubreDescuentos: boolean;
```

`pagoTienda` (= «Para la tienda») y `ganancia` **se conservan tal cual**: `ganancia` la sigue
leyendo el detalle del cierre de **mensajero** a través del mismo tipo, y quitarla sería tocar R30.
En la superficie de bodega **no se pinta** (queda absorbida por `netoOrdenex`).

### 6.3 — Descarga: **sí, y con motivo** (R22 / D7)

Invierte la duda de la revisión 1. Con el uso real encima —la persona usa el número para **cuadrar
con la central**— sacarlo sólo por pantalla es dejarlo justo fuera de donde se cuadra. La doctrina
del árbol ya lo dice: descargar significa «esto que estoy viendo, entero».

`app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas.ts:53-144` — los **tres**
listados de cierre de bodega ganan **una** columna **al final** de las que ya tienen, sin reordenar
ninguna: `{ clave: "paraLaCentral", encabezado: PARA_LA_CENTRAL_LABEL }`. La proyección lee el campo
del DTO; no hace ninguna operación.

- **El listado del `cierre_dia` consolidable NO la gana** (R21): ahí no hay cierre de bodega todavía
  y el número no tiene sujeto.
- **`efectivoCubreDescuentos` NO va al archivo.** Es un aviso de pantalla, no una cifra; una columna
  booleana en una hoja de dinero se acaba sumando.
- **Riesgo residual, declarado:** cambia el encabezado de un archivo que alguien puede estar
  pegando en una hoja. Se mitiga poniéndola **la última** (nadie que lea por posición se rompe) y
  **no se ha medido** a cuántos consumidores afecta — no hay forma de medirlo desde el repo.

⚠️ Esto toca `columnas-asercion-de-orden.guardia` y `cobertura-tablas.guardia`: sus aserciones de
orden hay que **ampliarlas**, y esa ampliación se hace por escrito y con motivo (`tasks.md § G`).

---

## 7 — Las dos superficies, archivo por archivo

### 7.1 — La tarjeta: `cierre-factura.tsx` — **la superficie que de verdad importa**

Es donde vive el número que hace falta para operar, y es **la única** que alcanza el `adminSatelite`
(`ConsolidacionBodegaModule.tsx:442,450` monta `CierresBodegaSolicitadosLista` **sin** `onAbrir`).

`HojaResumen` (`:596-784`) la comparten **cuatro** superficies (`:501`, `:800`, `:848`, `:890`), así
que **no se le cambia ni un rótulo**. Se le añade **una prop opcional**:

```ts
  /**
   * La cascada «lo que va a la central», ya derivada. Presente SÓLO en el comprobante de un cierre
   * de bodega: sustituye a la columna «Ajustes» de esa superficie y deja las otras tres
   * exactamente como estaban (R19/R21). Ausente ⇒ se pinta «Ajustes» como hoy.
   */
  cascadaCentral?: { paraLaCentral: string; efectivoCubreDescuentos: boolean };
```

En el bloque `open` (`:722-781`), la columna del medio pasa a ser:

- `cascadaCentral === undefined` → **byte a byte lo de hoy**: `<section aria-label={RESUMEN_AJUSTES_TITULO}>` con sus dos `LineaMonto`.
- `cascadaCentral !== undefined` → `<section aria-label={CASCADA_CENTRAL_TITULO}>` con cuatro líneas:
  `RESUMEN_TOTAL_LABEL` / `PAGO_MENSAJERO_LABEL` (restando) / `GANA_BODEGA_SATELITE_LABEL`
  (restando) / `PARA_LA_CENTRAL_LABEL` destacado, más `PARA_LA_CENTRAL_NOTA` y, cuando toque, las
  notas condicionales de §12.

Sólo `CierreBodegaFacturaResumen` (`:800-833`) pasa la prop, desde `cierre.paraLaCentral` y
`cierre.efectivoCubreDescuentos`. Como los tres listados de bodega lo montan
(`CierresBodegaSolicitadosLista:136`, `CierresBodegaResueltosLista:141`,
`CierresBodegaAdminModule:460`), **R38 se cumple por construcción**: no hay dos sitios donde
escribirlo distinto.

La rejilla sigue siendo `md:grid-cols-[1.2fr_1fr_1fr]`: son tres columnas antes y después.

⚠️ **`tests/unit/guards/factura-contraste.guardia.test.ts`** mantiene el inventario CERRADO de pares
(tinta, fondo) de las dos hojas y se pone roja ante una utilidad de color nueva. La cascada **no
estrena color**: reusa `LineaMonto`, `TituloColumna` y el patrón `font-medium text-foreground`, ya
censados. Para el negativo se usa `esMontoNegativo` + `text-danger-strong`, que **ya está censado**
en `cierre-detalle-shared.tsx:604-608`.

### 7.2 — El detalle: `CierresBodegaAdminModule.tsx:520-640`

Orden nuevo del modal, **agregado**:

1. `TotalesPanel` «Totales del cierre de bodega» — **sin cambios** (R29).
2. **`CascadaDinero` B** — «Lo que va a la central» (§4). **Va primero**: es el número operativo, y
   el detalle debe empezar por lo mismo con lo que la tarjeta cierra (R23).
3. **`CascadaDinero` A** — «De quién es el dinero» (§3).
4. `TotalesIngresoPanel` «Ingreso de Ordenex» — **sin cambios**: es el desglose por concepto de la
   línea «Lo que Ordenex facturó».
5. Motivo de rechazo, si lo hay — sin cambios.
6. Una sección por `cierre_dia`, cada una con **sus dos cascadas** con los mismos rótulos.
7. Botonera — sin cambios.

**Se retiran de esta superficie** (R34/D4) las cinco tarjetas sueltas de `:537-569` y `:602-630`:
`MontoDerivadoCard` «Ingreso bruto», `PagoMensajeroTotal`, `MontoDerivadoCard` «Ganancia»,
`IngresoBodegaRechazosTotal` y `MontoDerivadoCard` «Pago a tienda». Los **componentes no se borran**
—los usa `CierresAdminModule`—; se deja de montarlos aquí.

> ⚠️ Lección medida de este árbol («el test que vive dentro de lo que borras»): antes de tocar esta
> sección hay que censar qué tests localizan esos `aria-label`. Está como tarea bloqueante **T0.4**.

### 7.3 — El componente nuevo: `CascadaDinero`

Vive **junto a la pantalla** que lo usa (`app/(app)/cierres-admin/_components/CascadaDinero.tsx`),
no en `components/shared/`: `docs/architecture.md § Regla: sin sobre-ingeniería`.

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

Sin lógica de dominio: el servicio decide qué líneas hay, en qué orden y con qué notas. El
componente pinta el signo, el destacado, el tono del negativo y las notas. `money()` es lo único
que toca los importes.

---

## 8 — Alternativas descartadas

**A1 — Poner la cascada A también en la tarjeta. DESCARTADA — y ahora, además, por decisión del
humano (H2).**
Técnicamente: el ingreso de Ordenex **no está guardado** (`schema.prisma:2234-2264`), así que
derivarlo para una tarjeta exige leer **todas** las `cierre_detail` de **todos** los `cierre_dia` de
**todos** los cierres de la página, y el mismo DTO alimenta cuatro caminos de **descarga sin cota de
filas** (`CierresBodegaAdminService.ts:204-226` declara la excepción a R29 de la 170). Sería una
consulta pesada en una ruta caliente. Y de producto: la satélite **no necesita** ver el margen de
Ordenex, necesita ver lo suyo — poner la cascada A en la tarjeta se lo enseñaría, porque la tarjeta
es su única superficie.

**A2 — Dos columnas de snapshot nuevas en `cierre_bodega` y `cierre_dia`. DESCARTADA.**
Resolvería A1 sin coste de consulta, pero: (a) es una **migración money-critical con backfill** que
tendría que re-derivar `derivarIngresoOrden` sobre todo el histórico de `cierre_detail` para dejar
**una segunda fuente de verdad para siempre**; (b) la ficha dice que los datos ya existen y que si
el implementador concluye lo contrario, **pare**; (c) la base local es compartida entre worktrees y
una migración pone rojo el gate de las otras fichas vivas. **Con H2 ya no hay ni siquiera un motivo
de producto para volver aquí.**

**A3 — Una Server Action nueva y estrecha por tarjeta. DESCARTADA.**
Era la vía si la cascada A tuviera que ir en la tarjeta. Con H2 no tiene que ir. Además exigía
**dos** acotamientos de alcance distintos —el maestro por rol, el satélite por su `zonaId` resuelto
server-side— y el precio de equivocarse ahí no es un test rojo: es el dinero de la bodega vecina
(`ICierreBodegaService.ts:155-164` lo escribe con esas palabras).

**A4 — Sacar el ingreso de Ordenex del LIBRO DE CAJA en vez de derivarlo. DESCARTADA.**
Los movimientos por concepto existen (`FUENTE_CAJA`) y se agregarían con un `groupBy` barato, pero:
(a) sólo existen para cierres **aprobados** —y la cola de pendientes es justo donde se decide—; (b)
introduce una **segunda fuente** para la misma cifra, y comparar snapshot contra libro es
literalmente lo que hace el detector de descuadres de este repo.

**A5 — Renombrar «Ajustes» en `HojaResumen` para las cuatro superficies. DESCARTADA.**
El rótulo es igual de falso en el comprobante del mensajero, pero ahí la columna contiene
«Ganancia» (`audiencia="mensajero"`, `:739`) y el nombre correcto para **esa** audiencia es otra
decisión. Esta ficha es del cierre de bodega: arregla lo evidenciado y deja el resto como **Q4**.

**A6 — Empezar la cascada A por el «Ingreso bruto». DESCARTADA por incorrecta.**
`recaudado − bruto ≠ para la tienda` en cuanto hay un rechazo (§3).

**A7 — Recortar «Para la central» a cero cuando sale negativo. DESCARTADA por peligrosa.**
Un cero diría «no hay que entregar nada» y omitiría que **la central tiene que poner** la
diferencia. Es la misma clase de mentira tranquilizadora que la ficha 264 documentó
(«"ninguna" y "no lo sabemos" son cosas distintas»). Se pinta con signo y con su nota (§12.1).

**A8 — Reusar «Central debe» para el caso negativo. DESCARTADA.**
`CENTRAL_DEBE_LABEL` ya significa algo muy concreto y distinto: el pago a mensajeros que **el
efectivo** no alcanzó a cubrir en la pantalla de consolidación, calculado por `repartirEfectivo`
antes de solicitar (`CierreBodegaService.ts:96-127`). Darle un segundo significado en otra pantalla
es exactamente lo que R24 prohíbe.

---

## 9 — ¿Los números cuadran al consolidar varios días?

**Sí, exactamente, y por construcción — razonado sobre el código, y con la medición pendiente
(T0.3).**

La demostración tiene tres patas, todas leídas en disco:

1. **Los tres snapshots agregados son la suma exacta de los de sus días.** `solicitarCierreBodega`
   los calcula con `sumTotales` / `sumPagoMensajero` / `sumIngresoBodega`
   (`lib/services/CierreBodegaService.ts:42-80`, llamadas en `:442-446`) sobre **el mismo conjunto
   de `cierre_dia` que se vincula en la misma transacción** (`crearCierreBodega`,
   `lib/repositories/CierreBodegaRepository.ts:298-300`). Aritmética `Prisma.Decimal`.
2. **Nadie los mueve después.** `resolverCierreBodega` es «un único UPDATE guardado por estado; NO
   toca `cierre_dia` ni otra tabla» (`CierresBodegaAdminRepository.ts:188-189,426-474`). Y la
   corrección del desglose de pagos, que **sí** reescribe `total_general` de un `cierre_dia`
   (`CierresAdminRepository.ts:1402-1411`), está guardada por `estado IN ESTADOS_ABIERTOS` — y un
   consolidable es `aprobado`.
3. **Las sumas de conceptos no pierden céntimos.** Cada `ingresoOrdenex.*` por gestión ya es escala
   2; `totalesIngresoOrdenex` suma con `Decimal` y `toFixed(2)` al final. No hay redondeo intermedio
   que se pueda acumular.

Por tanto: `paraLaTienda(agregado) = Σ_d paraLaTienda(d)`, `netoOrdenex(agregado) = Σ_d netoOrdenex(d)`
y `paraLaCentral(agregado) = Σ_d paraLaCentral(d)`.

⚠️ **Esto es una imposibilidad razonada, y en este árbol una imposibilidad razonada ya se ha
desmentido midiendo.** Por eso `tasks.md § T0.3` trae **la consulta exacta**, para que se corra
antes de escribir código.

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
  (`CierreBodegaService.ts:152`; el porqué está en `ICierreBodegaService.ts:155-164`).

**Lo que la satélite gana ver, y lo que no.** Gana `paraLaCentral` y `efectivoCubreDescuentos`, que
son una resta y una comparación de tres números **que su propia fila ya lleva**: no expone nada
nuevo. **No** gana la cascada A (R39): el margen de Ordenex sigue viviendo sólo en el detalle, que
sólo abre el maestro (`verCierreBodegaDetalle` está tras `esAccesoTotal`).

---

## 11 — Verificación y gate

El diff toca archivos cuyo nombre lleva `cierre`, `ingreso`, `pago` y `factura`. Según
`docs/verification.md § Cuándo --rapido se niega`, esos nombres de dinero **niegan el modo rápido**:
el gate de esta ficha es **`./init.sh` completo**, escrito antes de empezar.

Sin `DATABASE_URL` resoluble se saltan ~77 archivos de test contra Postgres y el gate termina verde
sin haber tocado la capa de datos: hay que **contar los `skipped`** y citar la línea
«DATABASE_URL resuelta», no sólo el `INIT_EXIT`.

---

## 12 — El caso raro: cuando «Para la central» no es un número tranquilo

### 12.1 — Negativo: **sí puede pasar, y no es una hipótesis**

`pagoPorResultado` (`lib/utils/pago-mensajero.ts:13-23`) paga un importe **FIJO** por cada
`entregada` (`tarifa.cobroEntregado`), **independiente de lo que se recaudó**. Y `computeTotales`
(`lib/utils/cierre-totales.ts:77-105`) sólo suma las líneas de pago de las entregadas: una entrega
**sin líneas** —una orden prepagada, con `monto_cobrar` nulo, que en el esquema es un campo
opcional (`schema.prisma:2235`)— aporta **cero** al total y **aun así paga al mensajero**.

Luego un cierre de jornada mayoritariamente prepagada produce
`total_general < total_pago_mensajero` y **«Para la central» sale negativo**. Sale de la estructura
de la fórmula, no de un dato raro.

**Qué se enseña (R36, D6, A7, A8):**

- el rótulo **no cambia** — sigue diciendo «Para la central», una cifra un nombre;
- el importe se pinta **con su signo** y en tono de atención (`esMontoNegativo` +
  `text-danger-strong`, ya censado);
- **y con su nota**: *«Los descuentos superan lo recaudado en este cierre: la satélite no entrega
  nada y la central pone la diferencia.»*

Sin la nota, un `−₡3.400` en una pantalla de dinero es exactamente lo que el coordinador señaló:
peor que no tener el número.

### 12.2 — El caso más frecuente: el efectivo no cubre los descuentos

Distinto del anterior y **más común**: «Para la central» puede ser positivo y aun así la bodega no
tener el efectivo para pagar a los mensajeros, porque parte de lo recaudado entró por SINPE o
transferencia. Que esto ocurre lo declara el propio sistema: `repartirEfectivo` reparte sobre
`totalesAgregados.efectivo` —no sobre `general`— y tiene etiqueta para el resto
(`CENTRAL_DEBE_LABEL`, `cierre-detalle-shared.tsx:264-266`)… **pero sólo antes de solicitar el
cierre**. Después, nadie lo dice.

**Qué se enseña (R37):** cuando `efectivoCubreDescuentos === false`, una nota junto al resultado:
*«El efectivo recaudado no cubre los descuentos: parte de lo recaudado entró por SINPE o
transferencia.»* **Ningún número nuevo** — el desglose por método está en la columna de al lado en
la tarjeta y arriba en el detalle, así que quien quiera el reparto lo tiene a la vista.

**Lo que esta ficha NO hace aquí:** no calcula «Central debe» para un cierre ya creado, no reparte
el efectivo entre pagos individuales y no toca el flujo de aprobación. Es **Q7** de
`requirements.md`.
