# Ficha 396 — Diseño

> El QUÉ está en `requirements.md`; el desglose ejecutable en `tasks.md`.
> **Revisión 2 (2026-09-08):** ajustado a las seis firmas del humano. Todo lo que este documento
> afirma del código se releyó **en el archivo real** el 2026-09-08, **después** del merge de la
> mitad de servidor de la ficha 395 (PR #753).

## 0. La decisión de fondo

**No se toca ni una fórmula de dinero, ni una fila del ledger, ni el esquema.** Los totales
agregados siguen saliendo de donde salen hoy y valiendo lo mismo (R16). Lo único que esta ficha
añade es **la partición de esos totales por tienda** y **el texto que dice que son una partición**.

**Sin migración (R24).** La columna que hace falta —`cierre_detail.tienda_id`— existe desde la
feature 69 (`db/schema.prisma:2250`), está poblada y congelada. Lo que falta es **leerla**.

## 1. Lo que la ficha 395 ya dejó, y que este diseño REUSA en vez de reinventar

Releído en `lib/services/CierresAdminService.ts:681-751` y
`lib/interfaces/services/ICierresAdminService.ts:350-403`:

| Lo que dejó la 395 | Qué significa para esta ficha |
|---|---|
| `cobradoSobreRecaudado` (`ingreso-ordenex.ts:409`) | **Ya existe la línea puente.** Si algún día Q1 creciera a la cascada entera por tienda, esta función se aplica al subconjunto y no hay que escribir nada |
| `netoOrdenex` (`:430`) | Es de **Ordenex**, no de una tienda. Esta ficha no lo toca ni lo reparte |
| **`ganaLaTienda` (`:390`) — NUEVA** | `total_general − ingresoTotal`. **NO es `pagoTienda`**, y su docstring dice que confundirlas es el fallo que la 395 arregla. Ver Q7 de `requirements.md` |
| `fleteRechazoYaCobradoATienda` (booleano, `CierresAdminService.ts:723`) | Dice en qué **tiempo verbal** se habla del cargo del flete por rechazo. Es del cierre entero, no de una tienda: no se reparte |
| `CascadaDinero` montada en los detalles | El componente de presentación **ya está**, y no hace ni una operación aritmética (`CascadaDinero.tsx:12-18`) |

**Consecuencia práctica:** de las cinco piezas que esta ficha podría haber necesitado, **cuatro ya
existen**. Lo único que falta es la **partición por tienda**.

## 2. Modelo de datos

**Cero cambios.** Ni tabla, ni columna, ni RLS, ni migración, ni `down.sql`. `cierre_detail` ya es
inmutable, ya tiene RLS habilitada sin políticas (sólo service role) y ya congela
`tienda_id`/`tienda_nombre` por fila.

**Único cambio de acceso a datos:** `DETALLE_ADMIN_SELECT`
(`lib/repositories/CierresAdminRepository.ts:164-194`) gana `tiendaId: true`. Una columna más en un
`select` que ya lee 25; el índice de la ruta caliente (`@@unique([cierreId, ordenId])`) no cambia.

**Y esa línea sirve para las TRES superficies:** `CierresBodegaAdminRepository.ts:353-356` usa **ese
mismo `select`** y **ese mismo mapper**. El cierre de bodega sale gratis en la capa de datos.

## 3. Por dónde sube el `tiendaId` hasta los services

`CierreGestionPendienteRow` (`lib/interfaces/repositories/ICierreDiaRepository.ts:48-…`) **gana
`tiendaId: string`**, al lado del `tiendaNombre` que ya lleva (`:73`).

Los mappers que lo producen ya tienen el dato a mano:

| Mapper | De dónde sale | Por qué es el correcto ahí |
|---|---|---|
| `CierresAdminRepository.toPendienteRowDesdeSnapshot` (:373) | `d.tiendaId` del snapshot | El cierre existe: manda lo **congelado** (R6). Lo usan **el detalle del mensajero y los dos niveles de bodega** |
| `CierreDiaRepository.toPendienteRow` (:247-289) | `row.orden.tiendaId` (viva) | Es la vista **EN VIVO** del mensajero: el cierre **todavía no existe**, no hay snapshot que leer. Mismo criterio con el que esa función ya toma `row.orden.tienda.nombre` (:267) |

**Campo requerido, no opcional.** Un `tiendaId?: string` deja pasar el olvido en silencio; uno
requerido lo caza el compilador en strict. Coste medido: **20 archivos de test tipan
`CierreGestionPendienteRow`**, y existe una fixture central (`tests/fixtures/cierre-pagos.ts`) que
absorbe parte.

## 4. La derivación nueva: una función, un sitio, con su docstring

Vive en **`lib/utils/ingreso-ordenex.ts`**, donde ya viven `pagoTiendaOrdenex`, `ganaLaTienda`,
`cobradoSobreRecaudado`, `netoOrdenex` y `paraLaCentral`, cada una con el docstring que explica por
qué está ahí y no duplicada en cada servicio. **Una identidad, un sitio.**

**Una sola función para las tres superficies.** Es lo que hace cierto R21 sin depender de que nadie
se acuerde.

### 4.1 Firma propuesta

```ts
/** Una tienda de un cierre, con SUS DOS cifras. Ambas STRING escala 2 (money-safe). */
export interface ParteDeTienda {
  tiendaId: string;
  tiendaNombre: string;
  /** Lo recaudado atribuido a esta tienda. Mismo criterio que el `total_general` (R11). */
  recaudado: string;
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

**DOS cifras y no cuatro (Q1/R5).** `fleteConIva` y `comisionConIva` por tienda se calculan **dentro**
—hacen falta para derivar `pagoTienda`— pero **no se emiten**: el contrato no ofrece lo que la
pantalla no debe enseñar. Si Q7 o una ficha futura los pidieran, se añaden ahí; hoy, no existen
fuera de la función.

### 4.2 Qué hace por dentro — y qué NO hace

**No inventa ni una fórmula.** Particiona por `tiendaId` y, sobre **cada subconjunto**, llama a las
funciones que ya producen esos números para el conjunto entero:

| Cifra por tienda | Función existente aplicada al subconjunto |
|---|---|
| `recaudado` | `computeTotales(subconjunto).general` — `lib/utils/cierre-totales.ts:77` |
| (interno) `fleteConIva`, `comisionConIva` | `totalesIngresoOrdenex(subconjunto)` — `ingreso-ordenex.ts:282` |
| `pagoTienda` | `pagoTiendaOrdenex(recaudado, fleteConIva, comisionConIva)` — `:352` |

Es **exactamente** lo que `lib/utils/dinero-por-producto.ts:200-273` ya hace para partir el mismo
importe por producto. No es un patrón nuevo: es el que el repo ya eligió una vez.

### 4.3 El orden (R8, Q6)

**Por `pagoTienda` descendente.** Desempate declarado y en un solo sitio: `tiendaNombre` ascendente
por unidades de código (`sort()` **sin** `localeCompare` — determinismo antes que corrección
tipográfica, la regla que el repo ya usa en `dinero-por-producto.ts:98-104`), y `tiendaId` como
último desempate para que la secuencia sea reproducible incluso con nombres idénticos.

**El orden lo fija el SERVIDOR.** La pantalla pinta en el orden que recibe (R8 testeable en un
sitio, no en tres).

### 4.4 Por qué R9 y R10 son ciertas por construcción

1. La partición por `tiendaId` es **exhaustiva y disjunta**: cada gestión tiene exactamente una fila
   `cierre_detail` (grano `(cierre_id, orden_id)`) con exactamente un `tienda_id`. Si faltara, la
   lectura **ya revienta hoy** (`CierresAdminRepository.ts:1280`) — no hay rama «sin tienda».
2. `computeTotales` y `totalesIngresoOrdenex` son **sumas puras sobre gestiones**: sumar por partes
   y luego sumar las partes da lo mismo.
3. `pagoTiendaOrdenex` es una **resta lineal**: `Σ(gᵢ − fᵢ − cᵢ) = Σgᵢ − Σfᵢ − Σcᵢ`.
4. No hay deriva de redondeo: todos los sumandos ya vienen a escala 2 (`round2`/`aplicarPorcentaje`
   en `derivarIngresoOrden`), y sumar decimales de escala 2 da escala 2. Argumento ya escrito en
   `dinero-por-producto.ts:19-22`.

**Aun así R9 y R10 llevan test propio.** «Por construcción» es un razonamiento, y en este repo ya se
midió que un razonamiento sobre el código puede ser desmentido por Postgres.

⚠️ **El punto frágil es el (2):** si algún día `computeTotales` dejara de ser una suma pura sobre
gestiones (un tope, un `min()` a nivel de cierre), R10 dejaría de ser cierta en silencio. El test de
identidad es lo que lo caza.

## 5. Contrato de salida

### 5.1 Detalle del cierre del mensajero

`CierreDetalleAdminServiceResult` (`ICierresAdminService.ts:331-…`) gana **un campo**, junto a
`pagoTienda`, que **no lo sustituye**:

```ts
/**
 * Ficha 396 — de quién es cada parte del `pagoTienda` de arriba.
 * Se emite SIEMPRE, también con UNA sola tienda (un elemento, cuyo `pagoTienda` es igual al
 * agregado). El UMBRAL de Q5 —enseñarlo sólo con dos o más— es de PRESENTACIÓN y vive en la
 * pantalla: un contrato que a veces trae la lista y a veces no obliga a cada consumidor a
 * distinguir dos formas del mismo dato, que es el error que la 264 ya documentó con
 * `ordenesSinGestion` / `sinGestionRegistrado`.
 * INVARIANTE (R9): la suma de `partesPorTienda[].pagoTienda` es exactamente `pagoTienda`.
 */
partesPorTienda: ParteDeTienda[];
```

### 5.2 Detalle del cierre de bodega — los DOS niveles

`CierreBodegaDetalleServiceResult` (`ICierresBodegaAdminService.ts`) gana el **mismo** campo **dos
veces**, en los dos sitios donde hoy ya hay un `pagoTienda`:

- en **cada** `CierreBodegaDetalleCierre` (nivel por mensajero, junto a su `pagoTienda` de
  `CierresBodegaAdminService.ts:312`);
- en el **agregado** de la bodega (junto al `pagoTienda` de `:352`).

**Y la llamada tiene ya la forma exacta.** `CierresBodegaAdminService` hace hoy, literalmente:

```ts
const totalesIngreso = totalesIngresoOrdenex(cd.gestiones);                          // :298  nivel mensajero
const totalesIngreso = totalesIngresoOrdenex(found.cierresDia.flatMap(cd => cd.gestiones)); // :346  agregado
```

El desglose por tienda se añade **con el mismo argumento en el mismo sitio**:
`partesPorTienda(cd.gestiones)` y `partesPorTienda(found.cierresDia.flatMap(cd => cd.gestiones))`.
**Cero mecánica nueva en el servicio de bodega.**

## 6. ⚠️ El riesgo real de R19, y por qué no se maquilla

En el nivel **agregado** de bodega, el `pagoTienda` de hoy se deriva del **snapshot agregado**
`cierre_bodega.total_general` (`:352-356`), mientras que el desglose por tienda **sólo puede salir
de las gestiones** (o sea, de la suma de los `cierre_dia`).

**Las dos vías cuadran hoy** —la ficha 393 lo midió contra producción el 2026-09-08: 14 cierres de
bodega, 14 cuadran, 0 descuadran— **pero eso es una MEDICIÓN, no una regla**, y así lo dejó escrito
(`CierresBodegaAdminService.ts:358-363`).

**Consecuencia honesta:** **R19 es cierta si y sólo si el snapshot agregado es la suma de sus días.**
Si un día dejara de serlo, la suma de las partes no daría el agregado — y **eso es un descuadre real
que la pantalla debe enseñar** (R20), no un fallo del desglose que haya que corregir forzando el
minuendo.

Por eso:
- **NO** se cambia el agregado para que use la suma de gestiones: violaría R16 y contradiría la
  decisión explícita de la 393.
- **SÍ** hay una tarea **bloqueante de medición** antes de implementar (`tasks.md § T0.5`) que
  vuelve a correr esa comprobación contra la base.

## 7. Rutas, endpoints y permisos

**Ninguna ruta nueva. Ningún endpoint nuevo. Ninguna Server Action nueva.** El desglose viaja por
los dos caminos que ya sirven los detalles, tras las mismas puertas:

- `CierresAdminService.verCierreDetalle`: `resolveAlcance` → `forbidden` / `sinZona` →
  `findCierreByIdEnAlcance` con el alcance **en el WHERE** (`:613-622`).
- `CierresBodegaAdminService.verCierreBodegaDetalle`: `esAccesoTotal(actor.rol)` →
  `forbidden` (`:270`).

R23 se cumple **por ausencia de código**: no hay un tercer camino que proteger.

**R22 (sin exposición nueva):** el nombre de la tienda de cada orden **ya se muestra hoy** en cada
fila de los dos detalles (`tiendaNombre` en el DTO, columna «Tienda» en las tablas por resultado).
El desglose lo **agrega**; no descubre nada.

## 8. Presentación

### 8.1 Las tres superficies y su umbral

| # | Superficie | Dónde | Umbral (R2/Q5) |
|---|---|---|---|
| 1 | Detalle del cierre del mensajero | `cierre-factura.tsx` (`CierreFacturaDetalle`), dentro del corte `esMensajero` de `:1810` | ≥2 tiendas del cierre |
| 2 | Bodega, nivel por mensajero | `CierresBodegaAdminModule.tsx:728-751` (junto a las dos cascadas de ese mensajero) | ≥2 tiendas **de ese mensajero** |
| 3 | Bodega, nivel agregado | `CierresBodegaAdminModule.tsx:666-690` | ≥2 tiendas en toda la bodega |

⚠️ **La superficie 1 la montan DOS pantallas**: `CierresAdminModule.tsx:1150` (admin) y
`CierreDiaModule.tsx` (mensajero). La tarjeta ya está cortada para el mensajero por
`esMensajero || pagoTienda === undefined` (`:1810`). **El desglose entra DENTRO de ese mismo
corte** (R25).

⚠️ **El umbral de la superficie 2 es por mensajero, no por bodega.** Un cierre de bodega con dos
tiendas repartidas entre dos mensajeros que llevaron una cada uno **no enseña desglose en ningún
nivel de mensajero** y **sí** en el agregado. Es lo correcto y hay que testearlo.

### 8.2 Con qué se pinta

**Con `CascadaDinero`, que la 393 y la 395 ya dejaron montado en las tres superficies.** Una cascada
por tienda, con `titulo` = nombre de la tienda y `ariaLabel` **propio y distinto** (el componente ya
lo exige: `CascadaDinero.tsx:68`), y **dos líneas**: lo recaudado (`signo: "neutro"`) y lo que se le
paga (`destacado: true`).

**Ni un componente nuevo, ni una copia.** Si divergieran, la misma plata se leería distinta según
por qué pantalla se entra — la lección literal de la 393 y de la 395, y lo que R21 exige.

`CascadaDinero` no hace ni una operación aritmética y lee el signo del TEXTO: encaja con R12 sin
adaptaciones.

### 8.3 Los rótulos (R3)

Constantes nuevas **exportadas**, en **`app/(app)/cierres-admin/_components/cierre-labels.ts`** —y
**no** en `cierre-detalle-shared.tsx`, corrigiendo la revisión 1—. El motivo está escrito en ese
mismo archivo (`:128-138`): las constantes que necesitan **las dos pantallas** viven en el módulo
PURO, para que ninguna arrastre `Card`/`Badge`/`DataTable`. Con Q4 dentro, estos rótulos los
necesitan `cierre-factura.tsx` **y** `CierresBodegaAdminModule.tsx`, que es justo el caso que ese
archivo describe.

`PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA` y `PARA_LA_TIENDA_LABEL` **no se tocan**: R16 exige que los
agregados sigan diciendo lo mismo. Lo nuevo se **añade**.

## 9. Alternativas descartadas

### 9.1 Repartir TAMBIÉN el pago al mensajero y el ingreso de bodega — DESCARTADA (Q2)

Sería el desglose «completo». Se descarta porque **exige inventar un criterio que nadie ha
firmado**: ¿por número de órdenes? ¿por importe recaudado? ¿por entregas? Un número repartido con un
criterio inventado es peor que un número agregado y rotulado: el primero miente con precisión, el
segundo sólo calla. **Decisión del leader**, no corregida por el humano.

### 9.2 Agrupar por `tiendaNombre` para no tocar el `select` — DESCARTADA

Ahorra §2 y §3. Se descarta porque **(a)** dos tiendas distintas pueden llamarse igual y quedarían
fundidas, con el dinero de una atribuido a la otra en pantalla; **(b)** el repo ya pagó esta
lección: `tienda_id` se congela en `cierre_detail`, en `rechazo_tienda_cobro` y en `analytics_daily`
precisamente porque **el identificador es la clave estable y el nombre es descriptivo**
(`schema.prisma:2062-2065`).

### 9.3 Partir el cierre en un cierre por tienda — DESCARTADA

Resolvería el problema de raíz. Se descarta porque **cambia el modelo por un defecto de
presentación** y rompe lo que depende de que el cierre sea del mensajero: el pago al mensajero es
del cierre entero, el `min(P, E)` de la feature 44 se calcula sobre el efectivo del cierre y
`liquidacion_pago.cierre_id` apunta a un cierre por mensajero. Es la clase de propuesta que ya se
descartó dos veces en este repo: **arreglar lo evidenciado, no rediseñar.**

### 9.4 Calcularlo en el navegador sumando las filas de las tablas — DESCARTADA

Las tablas por resultado ya tienen las cifras por fila y su `tiendaNombre`. Se descarta porque **el
dinero viaja como STRING de punta a punta y nunca como `float`**: sumar en el navegador es
exactamente el defecto que la feature 204 midió (14 de 66 órdenes con un céntimo de diferencia,
`ingreso-ordenex.ts:214-238`) y lo que R13 de la 393 prohíbe.

### 9.5 Emitir cuatro cifras por tienda y que la pantalla enseñe dos — DESCARTADA

Dejaría el contrato listo por si Q7 crece. Se descarta porque **un contrato que ofrece lo que no se
debe enseñar acaba enseñándose**: bastaría con que alguien las pintara «ya que están». R5 se
comprueba también en el contrato, no sólo en el DOM.

### 9.6 Poner la función en un archivo propio (`lib/utils/cierre-por-tienda.ts`) — CONSIDERADA

Es lo que hizo la ficha 347 con la partición por producto (`dinero-por-producto.ts`), y evita que
`ingreso-ordenex.ts` importe `cierre-totales.ts`. **Se prefiere `ingreso-ordenex.ts`** porque es
donde vive la identidad que se está particionando y porque es lo que el pedido dice con esas
palabras. **Verificado que el import no crea ciclo:** `cierre-totales.ts` importa `pago-mensajero`,
`ingreso-bodega` y tipos de interfaces — **no importa `ingreso-ordenex`**. Si al implementar
apareciera un ciclo, se cae a esta alternativa y se anota en `progress/`.

### 9.7 Hacer la bodega en una ficha aparte — DESCARTADA POR EL HUMANO

Era la recomendación del leader (probar la forma en una superficie antes de llevarla a tres). El
humano firmó lo contrario. Ver `requirements.md § El rastro de Q4`.

## 10. Cómo el diseño evita las trampas ya medidas en este repo

| Trampa | Cómo la evita |
|---|---|
| **El dinero como `float`** | Toda la aritmética con `Prisma.Decimal` en el servidor; el navegador sólo formatea. `CascadaDinero` no tiene ni un `Number(` (`:12-18`) |
| **Aserción contra su propia fuente** | Los tests afirman contra **literales escritos a mano** (importes y rótulos), nunca contra la función que los genera |
| **Los tests de servicio usan dobles y no ven el SQL** | El requisito de **qué filas se agrupan** (R6) se prueba en `tests/integration/db` contra Postgres real, con control positivo. Precedente: `cierre-sin-gestion-sql-real.test.ts` existe por esto mismo (`CierresAdminRepository.ts:1254-1256`) |
| **Test de integración verde sin datos** | Prohibido el `if (!filas) return;`. El test **siembra** su cierre de dos tiendas y **afirma el cardinal** antes que los importes |
| **Un total agrupado que se desglosa** | R9, R10 y R19 son tests propios, no comentarios. Y llevan **mutación** |
| **El composition root que no inyecta** | La misma función se llama desde **tres** sitios: hay un test que comprueba que **los tres** la pasan, no sólo que la importan |

## 11. Complejidad y forma de la ficha

**Con Q4 dentro, esta ficha ya no es `media`: es `alta`.** No por dificultad conceptual —la
derivación es una partición y ya hay precedente— sino por **superficie**:

- **2 servicios** (`CierresAdminService`, `CierresBodegaAdminService`) y **2 contratos**.
- **3 superficies de pantalla** en **2 módulos**, con **tres umbrales distintos** (§8.1).
- **1 DTO compartido ensanchado**, con **~20 archivos de test** de arrastre mecánico.
- **Una identidad (R19) que depende de una condición medida y no garantizada** (§6).
- Tests en **tres familias**: unit del derivador, integración SQL real, componentes ×3 superficies.

Se recomienda lanzarla en **5 tandas** (`tasks.md`), con la de bodega **detrás** de la del
mensajero: la misma secuencia que el leader recomendaba entre fichas, aplicada ahora **dentro** de
la ficha, que es lo que queda cuando las dos van juntas.

## 12. Lo que este diseño NO hace, dicho para que no se cuele

- No emite, borra ni corrige ningún movimiento de wallet.
- No cambia `pagoTiendaOrdenex`, `ganaLaTienda`, `cobradoSobreRecaudado`, `netoOrdenex`,
  `totalesIngresoOrdenex`, `computeTotales` ni `derivarIngresoOrden`.
- No reparte `netoOrdenex` ni `fleteRechazoYaCobradoATienda`: son del cierre, no de una tienda.
- No mete el flete por rechazo dentro del cierre (ver `requirements.md § Consecuencia`).
- No toca las descargas (R26, Q3) ni la tarjeta del listado que ve la satélite.
- No añade migración, ni tabla, ni columna, ni RLS.
