# Ficha 396 — Diseño

> El QUÉ está en `requirements.md`; el desglose ejecutable en `tasks.md`.
> Todo lo que este documento afirma del código se leyó **en el archivo real** el 2026-09-08.

## 0. La decisión de fondo

**No se toca ni una fórmula de dinero, ni una fila del ledger, ni el esquema.** El total agregado
sigue saliendo exactamente de donde sale hoy y valiendo exactamente lo mismo (R17). Lo único que
esta ficha añade es **la partición de ese total por tienda** y **el texto que dice que es una
partición**.

**Sin migración (R20).** La columna que hace falta —`cierre_detail.tienda_id`— existe desde la
feature 69 (`db/schema.prisma:2250`) y está poblada y congelada. Lo que falta es **leerla**.

## 1. Mapa medido: por dónde viaja hoy el número

```
cierre_detail (tienda_id ✅ congelado, tienda_nombre ✅ congelado)
   │
   │  CierresAdminRepository.DETALLE_ADMIN_SELECT      (:164-194)
   │     proyecta tiendaNombre   ✅
   │     proyecta tiendaId       ❌  ← EL ÚNICO HUECO
   ▼
findCierreByIdEnAlcance (:1214-1284)
   empareja gestión ↔ fila congelada por ordenId; si falta, ERROR DURO (:1280)
   ▼
toPendienteRowDesdeSnapshot (:373-427)  →  CierreGestionPendienteRow { tiendaNombre, pagos,
                                            resultado, ingresoOrdenex, … }
   ▼
CierresAdminService.verCierreDetalle (:609-708)
   totalesIngreso = totalesIngresoOrdenex(found.gestiones)          (:661)
   pagoTienda     = pagoTiendaOrdenex(resumen.totales.general,      (:672-676)
                                      totalesIngreso.fleteConIva,
                                      totalesIngreso.comisionConIva)   ← UN SOLO NÚMERO
   ▼
CierreFacturaDetalle (cierre-factura.tsx:1810-1818)  →  TarjetaTotal «Pago a tienda»
```

`resumen.totales.general` es el snapshot `cierre_dia.total_general`, y ese snapshot lo produce
`computeTotales` (`lib/utils/cierre-totales.ts:77-105`) sumando **las líneas de pago (`g.pagos`) de
las gestiones `entregada`**, y sólo de ésas.

## 2. Modelo de datos

**Cero cambios.** Ni tabla nueva, ni columna nueva, ni RLS nueva, ni migración, ni `down.sql`.
`cierre_detail` ya es inmutable, ya tiene RLS habilitada sin políticas (sólo service role) y ya
congela `tienda_id`/`tienda_nombre` por fila.

**Único cambio de acceso a datos:** `DETALLE_ADMIN_SELECT` gana `tiendaId: true`. Es una columna más
en un `select` que ya lee 25; el índice de la ruta caliente (`@@unique([cierreId, ordenId])`) no
cambia.

## 3. Por dónde sube el `tiendaId` hasta el service

`CierreGestionPendienteRow` (`lib/interfaces/repositories/ICierreDiaRepository.ts:48-…`) **gana
`tiendaId: string`**, al lado del `tiendaNombre` que ya lleva (`:73`).

Los **tres** mappers que producen ese DTO ya tienen el dato a mano:

| Mapper | De dónde sale el `tiendaId` | Por qué es el correcto ahí |
|---|---|---|
| `CierresAdminRepository.toPendienteRowDesdeSnapshot` (:373) | `d.tiendaId` del snapshot | El cierre existe: manda lo congelado (R6) |
| `CierresBodegaAdminRepository` (reusa el mismo mapper, :323) | idem | idem |
| `CierreDiaRepository.toPendienteRow` (:247-289) | `row.orden.tiendaId` (viva) | Es la vista **EN VIVO** del mensajero: el cierre **todavía no existe**, así que no hay snapshot que leer. Es el mismo criterio con el que esa función ya toma `row.orden.tienda.nombre` (:267) |

**Campo requerido, no opcional.** Un `tiendaId?: string` deja pasar el olvido en silencio; uno
requerido lo caza el compilador en modo strict. Coste medido: **20 archivos de tests tipan
`CierreGestionPendienteRow`** y existe una fixture central (`tests/fixtures/cierre-pagos.ts`) que
absorbe buena parte.

## 4. La derivación nueva: una función, un sitio, con su docstring

Vive en **`lib/utils/ingreso-ordenex.ts`**, que es donde ya viven `pagoTiendaOrdenex`,
`cobradoSobreRecaudado`, `netoOrdenex` y `paraLaCentral`, cada una con el docstring que explica por
qué está ahí y no duplicada en cada servicio. **Una identidad, un sitio.**

### 4.1 Firma propuesta

```ts
/** Una tienda del cierre, con su parte. Todo importe es STRING escala 2 (money-safe). */
export interface ParteDeTienda {
  tiendaId: string;
  tiendaNombre: string;
  /** Lo recaudado atribuido a esta tienda. Mismo criterio que `total_general` (R12). */
  recaudado: string;
  /** Lo que Ordenex le cobró sobre lo recaudado: flete + IVA. */
  fleteConIva: string;
  /** Lo que Ordenex le cobró sobre lo recaudado: comisión COD + IVA. */
  comisionConIva: string;
  /** Lo que se le paga a ESTA tienda. Puede ser NEGATIVO, igual que el agregado. */
  pagoTienda: string;
}

export function partesPorTienda(
  gestiones: ReadonlyArray<{
    tiendaId: string;
    tiendaNombre: string;
    resultado: GestionResultado;
    pagos: ReadonlyArray<{ metodo: MetodoPagoValue; monto: string }>;
    ingresoOrdenex?: IngresoOrdenexDTO | null;
  }>,
): ParteDeTienda[];
```

### 4.2 Qué hace por dentro — y qué NO hace

**No inventa ni una fórmula.** Particiona las gestiones por `tiendaId` y, sobre **cada
subconjunto**, llama a las funciones que ya producen esos números para el cierre entero:

| Cifra por tienda | Función existente aplicada al subconjunto |
|---|---|
| `recaudado` | `computeTotales(subconjunto).general` — `lib/utils/cierre-totales.ts:77` |
| `fleteConIva`, `comisionConIva` | `totalesIngresoOrdenex(subconjunto)` — `ingreso-ordenex.ts:282` |
| `pagoTienda` | `pagoTiendaOrdenex(recaudado, fleteConIva, comisionConIva)` — `:352` |

Esto es **exactamente** lo que `lib/utils/dinero-por-producto.ts:200-273` ya hace para partir el
mismo importe por producto, con la misma invariante escrita en su cabecera. No es un patrón nuevo:
es el que el repo ya eligió una vez.

### 4.3 Por qué R10 y R11 son ciertas por construcción, no por suerte

1. La partición de gestiones por `tiendaId` es **exhaustiva y disjunta**: cada gestión del cierre
   tiene exactamente una fila `cierre_detail` (grano `(cierre_id, orden_id)`) y esa fila tiene
   exactamente un `tienda_id`. Si faltara, la lectura **ya revienta hoy** con
   `CierreDetalleFaltanteError` (`CierresAdminRepository.ts:1280`) — no hay rama «sin tienda».
2. `computeTotales` y `totalesIngresoOrdenex` son **sumas puras sobre las gestiones**: sumar por
   partes y luego sumar las partes da lo mismo que sumar de una vez.
3. `pagoTiendaOrdenex` es una **resta lineal**: `Σ(gᵢ − fᵢ − cᵢ) = Σgᵢ − Σfᵢ − Σcᵢ`.
4. No hay deriva de redondeo: **todos los sumandos ya vienen a escala 2** (`round2`/
   `aplicarPorcentaje` en `derivarIngresoOrden`), y sumar decimales de escala 2 da escala 2. Es el
   argumento ya escrito en `dinero-por-producto.ts:19-22`.

**Aun así R10 y R11 llevan test propio** (`tasks.md § Trazabilidad`): «por construcción» es un
razonamiento, y en este repo ya se midió que un razonamiento sobre el código puede ser desmentido
por Postgres.

⚠️ **El punto frágil es el 2, y hay que vigilarlo:** si algún día `computeTotales` dejara de ser una
suma pura sobre gestiones (p. ej. un tope o un `min()` a nivel de cierre), R11 dejaría de ser cierta
en silencio. El test de identidad es lo que lo caza.

## 5. Contrato de salida del service

`CierreDetalleAdminServiceResult` (`lib/interfaces/services/ICierresAdminService.ts:331-368`) gana
**un campo**, junto a `pagoTienda`, que **no lo sustituye**:

```ts
/**
 * Ficha 396 — de quién es cada parte del `pagoTienda` de arriba.
 * Se emite SIEMPRE, también con UNA sola tienda (donde tiene un elemento y su `pagoTienda`
 * es igual al agregado). Emitirlo sólo con dos o más obligaría a cada consumidor a
 * distinguir dos formas del mismo dato — el error que la 264 ya documentó con
 * `ordenesSinGestion` / `sinGestionRegistrado`.
 * INVARIANTE (R10): la suma de `partes[].pagoTienda` es exactamente `pagoTienda`.
 */
partesPorTienda: ParteDeTienda[];
```

**El contrato NO depende de Q1.** El servidor emite siempre las cuatro cifras por tienda; lo que
Q1 decide es **cuántas de ellas pinta la pantalla**. Así la respuesta del humano cambia la UI y una
línea de la tabla de trazabilidad, no el diseño.

**Orden del array (R8):** determinista y declarado en un solo sitio. Pendiente de Q6 — se propone
por defecto **`tiendaNombre` ascendente por unidades de código (`sort()` sin `localeCompare`)**,
que es la regla de determinismo que el repo ya usa (`dinero-por-producto.ts:98-104`), con
`tiendaId` como desempate.

## 6. Rutas, endpoints y permisos

**Ninguna ruta nueva. Ningún endpoint nuevo. Ninguna Server Action nueva.** El desglose viaja por
el mismo `verCierreDetalle` que ya sirve el detalle, tras la misma puerta:
`resolveAlcance` → `forbidden` / `sinZona` → `findCierreByIdEnAlcance` con el alcance **en el
WHERE** (`CierresAdminService.ts:613-622`). R19 se cumple **por ausencia de código**: no hay un
segundo camino que proteger.

**R18 (no hay exposición nueva):** el nombre de la tienda de cada orden **ya se muestra hoy** en
cada fila del detalle (`tiendaNombre` en el DTO, columna «Tienda» en las tablas por resultado). El
desglose lo **agrega**; no descubre nada.

## 7. Presentación

### 7.1 Dónde

`CierreFacturaDetalle` (`app/(app)/cierres-admin/_components/cierre-factura.tsx:1728-…`), que es
donde vive hoy la tarjeta «Pago a tienda» (`:1810-1818`).

⚠️ **Ese componente lo montan DOS pantallas**: `CierresAdminModule.tsx:1150` (admin) y
`CierreDiaModule.tsx` (mensajero). La tarjeta ya está cortada para el mensajero por
`esMensajero || pagoTienda === undefined` (`:1810`). **El desglose entra DENTRO de ese mismo corte**
(R21): un mensajero no puede ver ni el agregado ni sus partes.

### 7.2 Con qué se pinta

**Con lo que la 395 deje montado, no con algo nuevo.** La 395 (en curso) monta `CascadaDinero`
(`_components/CascadaDinero.tsx`) en el detalle del mensajero, con las líneas puente, neto y lo que
la tienda gana. Este diseño **se apoya en eso**:

- Si Q1 = **A o D**: basta la tarjeta actual + el rótulo/marca de R1-R4. Sin componente nuevo.
- Si Q1 = **B o C**: una `CascadaDinero` **por tienda**, con `titulo` = nombre de la tienda y
  `ariaLabel` propio y distinto por tienda (el componente ya lo exige: `CascadaDinero.tsx:68`).
  **Ni un componente nuevo, ni una copia**: si divergieran, la misma plata se leería distinta según
  por qué pantalla se entra — que es la lección literal de la 393 y de la 395.

`CascadaDinero` **no hace ni una operación aritmética** (`:12-18`) y lee el signo del TEXTO. Encaja
con R13 sin adaptaciones.

### 7.3 Los rótulos

Constantes nuevas **exportadas** (R4) en
`app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`, junto a `PAGO_TIENDA_LABEL`
(`:324`) y `PAGO_TIENDA_NOTA` (`:334`).

**En `cierre-detalle-shared.tsx` y no en `cierre-labels.ts`**: `cierre-labels.ts` existe para el
texto que **también** necesita la descarga sin arrastrar `Card`/`Badge`/`DataTable` (está escrito en
su `:128-138`). Esta ficha **no toca la descarga** (R22), así que no hay segundo consumidor y el
texto se queda donde vive su tarjeta.

`PAGO_TIENDA_LABEL` y `PAGO_TIENDA_NOTA` **no se tocan**: R17 exige que el agregado siga diciendo lo
mismo. Lo nuevo se **añade**.

Textos concretos: **pendientes de Q1/Q3/Q5**, porque el rótulo depende de qué se enseñe. Lo único
firme es que **no puede quedarse un «Pago a tienda» en singular sin marca cuando hay dos** (R3).

## 8. Alternativas descartadas

### 8.1 Repartir TAMBIÉN el pago al mensajero y el ingreso de bodega — DESCARTADA

Sería el desglose «completo». Se descarta porque **exige inventar un criterio de reparto que nadie
ha firmado**: ¿por número de órdenes? ¿por importe recaudado? ¿por entregas? Las tres son
defendibles y ninguna está decidida. Un número reparteado con un criterio inventado es peor que un
número agregado y rotulado: el primero miente con precisión, el segundo sólo calla. Queda como Q2,
no como diseño.

### 8.2 Agrupar por `tiendaNombre` para no tocar el `select` — DESCARTADA

Ahorra la columna del punto 2 y el ensanchado del DTO (§3). Se descarta por dos razones:
**(a)** dos tiendas distintas pueden llamarse igual y quedarían fundidas en una sola parte, con el
dinero de una atribuido a la otra en pantalla; **(b)** el repo ya pagó esta lección: `tienda_id` se
congela en `cierre_detail`, en `rechazo_tienda_cobro` y en `analytics_daily` precisamente porque el
**identificador** es la clave estable y el nombre es descriptivo (`schema.prisma:2062-2065`).
Agrupar por el descriptivo es exactamente lo contrario.

### 8.3 Partir el cierre en un cierre por tienda — DESCARTADA

Resolvería el problema de raíz. Se descarta porque **cambia el modelo por un defecto de
presentación**, y rompe cosas que dependen de que el cierre sea del mensajero: el pago al mensajero
es del cierre entero, el `min(P, E)` de la feature 44 se calcula sobre el efectivo del cierre, y la
liquidación (`liquidacion_pago.cierre_id`) apunta a un cierre por mensajero. Es la clase de
propuesta que ya se descartó dos veces en este repo: **arreglar lo evidenciado, no rediseñar.**

### 8.4 Calcularlo en el navegador sumando las filas de las tablas — DESCARTADA

Las tablas por resultado ya tienen todas las cifras por fila y su `tiendaNombre`. Se descarta porque
**el dinero viaja como STRING de punta a punta y nunca como `float`**: sumar en el navegador es
exactamente el defecto que la feature 204 midió (14 de 66 órdenes con un céntimo de diferencia,
`ingreso-ordenex.ts:214-238`) y lo que R13 de la 393 prohíbe. La suma se hace donde el tipo es
exacto.

### 8.5 Poner la función nueva en un archivo propio (`lib/utils/cierre-por-tienda.ts`) — CONSIDERADA

Es lo que hizo la ficha 347 con la partición por producto (`dinero-por-producto.ts`), y evita que
`ingreso-ordenex.ts` importe `cierre-totales.ts`. **Se prefiere `ingreso-ordenex.ts`** porque es
donde vive la identidad que se está particionando y porque es lo que el pedido dice con esas
palabras. **Verificado que el import no crea ciclo**: `cierre-totales.ts` importa `pago-mensajero`,
`ingreso-bodega` y tipos de interfaces — **no importa `ingreso-ordenex`**. Si al implementar
apareciera un ciclo, se cae a esta alternativa y se anota en `progress/`.

## 9. Cómo el diseño evita las trampas ya medidas en este repo

| Trampa | Cómo la evita este diseño |
|---|---|
| **El dinero como `float`** | Toda la aritmética con `Prisma.Decimal` en el servidor; el navegador sólo formatea. `CascadaDinero` no tiene ni un `Number(` (`:12-18`) |
| **Aserción contra su propia fuente** | Los tests del desglose afirman contra **literales escritos a mano** (importes y rótulos), nunca contra la función que los genera. Ver `tasks.md § Trazabilidad` |
| **Los tests de servicio usan dobles y no ven el SQL** | El requisito de **qué filas se agrupan** (R6) se prueba en `tests/integration/db` contra Postgres real, con control positivo. Precedente en el propio repo: `cierre-sin-gestion-sql-real.test.ts` existe por esto mismo (`CierresAdminRepository.ts:1254-1256`) |
| **Test de integración verde sin datos** | Prohibido el `if (!filas) return;`. El test **siembra** su cierre de dos tiendas y **afirma el cardinal** antes de afirmar los importes |
| **Un total agrupado que se desglosa** | R10 y R11 son tests propios, no un comentario. Y llevan **mutación**: cambiar la clave de agrupación o el criterio del recaudo tiene que ponerlos rojos |

## 10. Riesgos

1. **Choque de archivos con la ficha 395** (`CierresAdminService.ts`, `cierre-factura.tsx`,
   `CierresAdminModule.tsx`). **Esta ficha va DETRÁS, nunca a la vez.** Ver `tasks.md § T0`.
2. **Ensanchar `CierreGestionPendienteRow`** toca 20 archivos de test (§3). Es mecánico y lo caza el
   compilador, pero hincha el diff; hay que medirlo con `pnpm typecheck` antes de comprometerse.
3. **Q1 sin firmar bloquea la tanda de UI**, no la de servidor: §5 deja el contrato cerrado sin esa
   respuesta.
4. **La base local puede no tener un cierre de dos tiendas.** El test de integración **siembra el
   suyo**; no se apoya en datos que estén.

## 11. Lo que este diseño NO hace, dicho para que no se cuele

- No emite, borra ni corrige ningún movimiento de wallet.
- No cambia `pagoTiendaOrdenex`, `totalesIngresoOrdenex`, `computeTotales` ni `derivarIngresoOrden`.
- No mete el flete por rechazo dentro del cierre (ver `requirements.md § Consecuencia`).
- No toca las descargas (R22) ni el cierre de bodega (Q4).
- No añade migración, ni tabla, ni columna, ni RLS.
