# Ficha 396 — Diseño

> El QUÉ está en `requirements.md`; el desglose ejecutable en `tasks.md`.
> **Revisión 3 (2026-09-08):** ajustado a las ocho firmas y a las dos mediciones ya hechas. Todo lo
> que este documento afirma del código se releyó **en el archivo real** el 2026-09-08, **después**
> del merge de la mitad de servidor de la ficha 395 (PR #753).

## 0. La decisión de fondo

**No se toca ni una fórmula de dinero, ni una fila del ledger, ni el esquema.** Los totales
agregados siguen saliendo de donde salen hoy y valiendo lo mismo (R18). Lo único que esta ficha
añade es **la partición de esos totales por tienda** y **el texto que dice que son una partición**.

**Sin migración (R25).** La columna que hace falta —`cierre_detail.tienda_id`— existe desde la
feature 69 (`db/schema.prisma:2250`), está poblada y congelada. Lo que falta es **leerla**.

## 1. Lo que la ficha 395 ya dejó, y que este diseño REUSA en vez de reinventar

Releído en `lib/services/CierresAdminService.ts:681-751` y
`lib/interfaces/services/ICierresAdminService.ts:350-403`:

| Lo que dejó la 395 | Qué significa para esta ficha |
|---|---|
| **`ganaLaTienda` (`ingreso-ordenex.ts:390`) — NUEVA** | `total_general − ingresoTotal`. **Q7 firma que SE DESGLOSA por tienda**, junto a `pagoTienda`. La función ya existe: se aplica al subconjunto y no hay que escribir aritmética nueva |
| `cobradoSobreRecaudado` (`:409`) | La línea puente. **No entra en el desglose** (R5: tres cifras, no cuatro). Si algún día entrara, se aplica al subconjunto igual |
| `netoOrdenex` (`:430`) | Es de **Ordenex**, no de una tienda. No se toca ni se reparte |
| `fleteRechazoYaCobradoATienda` (booleano, `CierresAdminService.ts:723`) | Dice en qué **tiempo verbal** se habla del cargo del flete por rechazo. Es del cierre entero: no se reparte |
| `CascadaDinero` montada en los detalles | El componente de presentación **ya está**, y no hace ni una operación aritmética (`CascadaDinero.tsx:12-18`) |

**Consecuencia práctica:** de las piezas que esta ficha necesita, **todas las de aritmética ya
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

**Una sola función para las tres superficies.** Es lo que hace cierto R22 sin depender de que nadie
se acuerde.

### 4.1 Firma propuesta

```ts
/** Una tienda de un cierre, con SUS TRES cifras. Todas STRING escala 2 (money-safe). */
export interface ParteDeTienda {
  tiendaId: string;
  tiendaNombre: string;
  /** Lo recaudado atribuido a esta tienda. Mismo criterio que el `total_general` (R13). */
  recaudado: string;
  /** Lo que se le paga a ESTA tienda de este dinero. Puede ser NEGATIVO. */
  pagoTienda: string;
  /**
   * Lo que ESTA tienda gana en total: lo recaudado menos TODO lo que Ordenex le factura,
   * incluido el flete por rechazo. NO es `pagoTienda` — la diferencia entre las dos es
   * exactamente el flete por rechazo + IVA de esta tienda. Puede ser NEGATIVO.
   */
  ganaLaTienda: string;
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

**TRES cifras, y ni una más (R5).** `fleteConIva` y `comisionConIva` por tienda se calculan
**dentro** —hacen falta para derivar `pagoTienda`— pero **no se emiten**: el contrato no ofrece lo
que la pantalla no debe enseñar. La tercera cifra entró por firma del humano el 2026-09-08 (Q7);
la cuarta necesitará otra firma.

### 4.2 Qué hace por dentro — y qué NO hace

**No inventa ni una fórmula.** Particiona por `tiendaId` y, sobre **cada subconjunto**, llama a las
funciones que ya producen esos números para el conjunto entero:

| Cifra por tienda | Función existente aplicada al subconjunto |
|---|---|
| `recaudado` | `computeTotales(subconjunto).general` — `lib/utils/cierre-totales.ts:77` |
| (interno) `fleteConIva`, `comisionConIva`, `total` | `totalesIngresoOrdenex(subconjunto)` — `ingreso-ordenex.ts:282` |
| `pagoTienda` | `pagoTiendaOrdenex(recaudado, fleteConIva, comisionConIva)` — `:352` |
| `ganaLaTienda` | `ganaLaTienda(recaudado, total)` — `:390` |

Es **exactamente** lo que `lib/utils/dinero-por-producto.ts:200-273` ya hace para partir el mismo
importe por producto. No es un patrón nuevo: es el que el repo ya eligió una vez.

### 4.3 El orden (R8, Q6)

**Por `pagoTienda` descendente** —de las tres cifras, la del rótulo que da nombre a la ficha—.
Desempate declarado y en un solo sitio: `tiendaNombre` ascendente por unidades de código (`sort()`
**sin** `localeCompare` — determinismo antes que corrección tipográfica, la regla que el repo ya usa
en `dinero-por-producto.ts:98-104`), y `tiendaId` como último desempate.

**El orden lo fija el SERVIDOR.** La pantalla pinta en el orden que recibe (R8 testeable en un
sitio, no en tres).

### 4.4 Por qué las tres identidades son ciertas por construcción

1. La partición por `tiendaId` es **exhaustiva y disjunta**: cada gestión tiene exactamente una fila
   `cierre_detail` (grano `(cierre_id, orden_id)`) con exactamente un `tienda_id`. Si faltara, la
   lectura **ya revienta hoy** (`CierresAdminRepository.ts:1280`) — no hay rama «sin tienda».
2. `computeTotales` y `totalesIngresoOrdenex` son **sumas puras sobre gestiones**: sumar por partes
   y luego sumar las partes da lo mismo.
3. Las tres derivaciones son **restas lineales**:
   - R10 · `Σ(gᵢ − fᵢ − cᵢ) = Σgᵢ − Σfᵢ − Σcᵢ` → Σ `pagoTienda` = agregado.
   - R11 · `Σ(gᵢ − tᵢ) = Σgᵢ − Σtᵢ` → Σ `ganaLaTienda` = agregado.
   - R12 · `Σgᵢ = g` → Σ `recaudado` = `total general`.
4. No hay deriva de redondeo: todos los sumandos ya vienen a escala 2 (`round2`/`aplicarPorcentaje`
   en `derivarIngresoOrden`), y sumar decimales de escala 2 da escala 2. Argumento ya escrito en
   `dinero-por-producto.ts:19-22`.

**Y hay una CUARTA identidad, ésta POR TIENDA, que ata las dos cifras nuevas entre sí:**

```
pagoTienda(t) − ganaLaTienda(t)  ===  flete por rechazo + IVA de esa tienda
```

Sale de restar las dos definiciones (`(g−f−c) − (g−total)` = `total−f−c` = `fleteDevolucionConIva`).
Es la que hace imposible que alguien derive una de las dos con el subconjunto equivocado sin que se
note: si la partición de una y otra no coincidieran, esta resta dejaría de dar. **Va como test.**

**Aun así las cuatro llevan test propio.** «Por construcción» es un razonamiento, y en este repo ya
se midió que un razonamiento sobre el código puede ser desmentido por Postgres.

⚠️ **El punto frágil es el (2):** si algún día `computeTotales` dejara de ser una suma pura sobre
gestiones (un tope, un `min()` a nivel de cierre), R12 dejaría de ser cierta en silencio. El test de
identidad es lo que lo caza.

### 4.5 La tienda que no recaudó nada (R9)

Una tienda puede aparecer en un cierre **sólo con rechazos**: no recaudó, pero se le factura el
flete por rechazo. Sus tres cifras salen así: `recaudado` = `0.00`, `pagoTienda` = `0.00`,
`ganaLaTienda` = **negativo**.

**Se incluye en el desglose y cuenta para el umbral de R1/R2.** No es un caso raro que haya que
esconder: es justo el caso donde el desglose informa de algo que el agregado tapaba — y es también
donde la cuarta identidad de §4.4 se ve a simple vista. **Va como test.**

## 5. Contrato de salida

### 5.1 Detalle del cierre del mensajero

`CierreDetalleAdminServiceResult` (`ICierresAdminService.ts:331-…`) gana **un campo**, junto a
`pagoTienda` y `ganaLaTienda`, que **no los sustituye**:

```ts
/**
 * Ficha 396 — de quién es cada parte de `pagoTienda` y de `ganaLaTienda` (Q7, firmada por el
 * humano el 2026-09-08).
 * Se emite SIEMPRE, también con UNA sola tienda (un elemento, cuyas cifras son iguales a las
 * agregadas). El UMBRAL de Q5 —enseñarlo sólo con dos o más— es de PRESENTACIÓN y vive en la
 * pantalla: un contrato que a veces trae la lista y a veces no obliga a cada consumidor a
 * distinguir dos formas del mismo dato, que es el error que la 264 ya documentó con
 * `ordenesSinGestion` / `sinGestionRegistrado`.
 * INVARIANTES (R10/R11): la suma de `partesPorTienda[].pagoTienda` es exactamente `pagoTienda`,
 * y la de `.ganaLaTienda` es exactamente `ganaLaTienda`.
 */
partesPorTienda: ParteDeTienda[];
```

### 5.2 Detalle del cierre de bodega — los DOS niveles

`CierreBodegaDetalleServiceResult` (`ICierresBodegaAdminService.ts`) gana el **mismo** campo **dos
veces**, en los dos sitios donde hoy ya hay un `pagoTienda`:

- en **cada** `CierreBodegaDetalleCierre` (nivel por mensajero, junto a su `pagoTienda` de
  `CierresBodegaAdminService.ts:312`);
- en el **agregado** de la bodega (junto al `pagoTienda` de `:352`), con **una sola fila por
  tienda** (Q8: sin cruce tienda × mensajero).

**Y la llamada tiene ya la forma exacta.** `CierresBodegaAdminService` hace hoy, literalmente:

```ts
const totalesIngreso = totalesIngresoOrdenex(cd.gestiones);                                  // :298  nivel mensajero
const totalesIngreso = totalesIngresoOrdenex(found.cierresDia.flatMap(cd => cd.gestiones));  // :346  agregado
```

El desglose se añade **con el mismo argumento en el mismo sitio**: `partesPorTienda(cd.gestiones)` y
`partesPorTienda(found.cierresDia.flatMap(cd => cd.gestiones))`. **Cero mecánica nueva en el
servicio de bodega**, y Q8 se cumple por construcción: agrupar por `tiendaId` sobre el `flatMap`
**es** una fila por tienda.

⚠️ **El nivel de bodega no tiene `ganaLaTienda` agregado.** El DTO de bodega
(`ICierresBodegaAdminService.ts:77-92`) trae `pagoTienda`, `cobradoSobreRecaudado` y `netoOrdenex`,
pero la 395 puso `ganaLaTienda` **sólo en el detalle del mensajero**. Para que R11 sea comprobable
en bodega hace falta **emitir también el agregado** en los dos niveles — es una línea por nivel con
la función que ya existe, y **es lo que impide que el desglose sume hacia un total que no está en
pantalla**. Va como tarea explícita (`tasks.md § D1`).

## 6. ⚠️ El riesgo de R21 en el nivel agregado de bodega — medido, no eliminado

En el nivel **agregado**, el `pagoTienda` de hoy se deriva del **snapshot agregado**
`cierre_bodega.total_general` (`:352-356`), mientras que el desglose por tienda **sólo puede salir
de las gestiones** (o sea, de la suma de los `cierre_dia`).

**MEDIDO el 2026-09-08 contra producción: CERO cierres donde difieran** (14 de 14 cuadran), igual
que midió la ficha 393. **Pero sigue siendo una MEDICIÓN, no una regla**, y así lo dejó escrito ella
(`CierresBodegaAdminService.ts:358-363`).

**Consecuencia honesta:** **R10/R11 en el nivel agregado son ciertas si y sólo si el snapshot
agregado es la suma de sus días.** Si un día dejara de serlo, la suma de las partes no daría el
agregado — y **eso es un descuadre real que la pantalla debe enseñar** (R21), no un fallo del
desglose que haya que corregir forzando el minuendo.

Por eso:
- **NO** se cambia el agregado para que use la suma de gestiones: violaría R18 y contradiría la
  decisión explícita de la 393.
- La **consulta de comprobación se queda a mano** en `tasks.md § T0.5`, para volver a correrla el
  día que alguien dude.

## 7. Rutas, endpoints y permisos

**Ninguna ruta nueva. Ningún endpoint nuevo. Ninguna Server Action nueva.** El desglose viaja por
los dos caminos que ya sirven los detalles, tras las mismas puertas:

- `CierresAdminService.verCierreDetalle`: `resolveAlcance` → `forbidden` / `sinZona` →
  `findCierreByIdEnAlcance` con el alcance **en el WHERE** (`:613-622`).
- `CierresBodegaAdminService.verCierreBodegaDetalle`: `esAccesoTotal(actor.rol)` → `forbidden`
  (`:270`).

R24 se cumple **por ausencia de código**: no hay un tercer camino que proteger.

**R23 (sin exposición nueva):** el nombre de la tienda de cada orden **ya se muestra hoy** en cada
fila de los dos detalles (`tiendaNombre` en el DTO, columna «Tienda» en las tablas por resultado).
El desglose lo **agrega**; no descubre nada.

## 8. Presentación

### 8.1 Las tres superficies y su umbral

| # | Superficie | Dónde | Umbral (R2/Q5) |
|---|---|---|---|
| 1 | Detalle del cierre del mensajero | `cierre-factura.tsx` (`CierreFacturaDetalle`), dentro del corte `esMensajero` de `:1810` | ≥2 tiendas del cierre |
| 2 | Bodega, nivel por mensajero | `CierresBodegaAdminModule.tsx:728-751` | ≥2 tiendas **de ese mensajero** |
| 3 | Bodega, nivel agregado | `CierresBodegaAdminModule.tsx:666-690` | ≥2 tiendas en toda la bodega |

⚠️ **La superficie 1 la montan DOS pantallas**: `CierresAdminModule.tsx:1150` (admin) y
`CierreDiaModule.tsx` (mensajero). La tarjeta ya está cortada para el mensajero por
`esMensajero || pagoTienda === undefined` (`:1810`). **El desglose entra DENTRO de ese mismo
corte** (R26).

⚠️ **El umbral de la superficie 2 es por mensajero, no por bodega.** Un cierre de bodega con dos
tiendas repartidas entre dos mensajeros que llevaron una cada uno **no enseña desglose en ningún
nivel de mensajero** y **sí** en el agregado. Es lo correcto y hay que testearlo.

### 8.2 Con qué se pinta

**Con `CascadaDinero`, que la 393 y la 395 ya dejaron montado en las tres superficies.** Una cascada
por tienda, con `titulo` = nombre de la tienda, `ariaLabel` **propio y distinto** (el componente ya
lo exige: `CascadaDinero.tsx:68`) y **tres líneas**:

| Línea | Cifra | `signo` |
|---|---|---|
| Lo recaudado de esta tienda | `recaudado` | `neutro` (es el minuendo, no se suma a nada) |
| Lo que se le paga | `pagoTienda` | `destacado` |
| Lo que gana en total | `ganaLaTienda` | `destacado` |

**Ni un componente nuevo, ni una copia** (R22). `CascadaDinero` no hace ni una operación aritmética
y lee el signo del TEXTO: encaja con R14 sin adaptaciones, y pinta un negativo con su signo y en
tono de atención — que es justo lo que necesita el caso de §4.5.

### 8.3 Los rótulos (R3)

Constantes nuevas **exportadas**, en **`app/(app)/cierres-admin/_components/cierre-labels.ts`** —y
**no** en `cierre-detalle-shared.tsx`—. El motivo está escrito en ese mismo archivo (`:128-138`):
las constantes que necesitan **las dos pantallas** viven en el módulo PURO, para que ninguna
arrastre `Card`/`Badge`/`DataTable`. Con Q4 dentro, estos rótulos los necesitan `cierre-factura.tsx`
**y** `CierresBodegaAdminModule.tsx`.

⚠️ **Los dos rótulos de la tercera cifra tienen que distinguirse del de la segunda**, porque el
fallo que la 395 vino a arreglar es exactamente que se confundan. Se reusan los que la 395 haya
dejado para el agregado; **si no dejó ninguno, se crean con su nota**, y la nota dice la diferencia
en una frase (el flete por rechazo se cobra aparte, contra la wallet).

`PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA` y `PARA_LA_TIENDA_LABEL` **no se tocan**: R18 exige que los
agregados sigan diciendo lo mismo. Lo nuevo se **añade**.

## 9. Alternativas descartadas

### 9.1 Repartir TAMBIÉN el pago al mensajero y el ingreso de bodega — DESCARTADA (Q2)

**Exige inventar un criterio que nadie ha firmado**: ¿por número de órdenes? ¿por importe recaudado?
¿por entregas? Un número repartido con un criterio inventado es peor que un número agregado y
rotulado: el primero miente con precisión, el segundo sólo calla. **Decisión del leader**, no
corregida por el humano.

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

Se descarta porque **el dinero viaja como STRING de punta a punta y nunca como `float`**: sumar en
el navegador es exactamente el defecto que la feature 204 midió (14 de 66 órdenes con un céntimo de
diferencia, `ingreso-ordenex.ts:214-238`) y lo que R13 de la 393 prohíbe.

### 9.5 Emitir en el contrato más cifras de las que se enseñan — DESCARTADA

Dejaría el contrato listo por si un día se piden `fleteConIva`/`comisionConIva` por tienda. Se
descarta porque **un contrato que ofrece lo que no se debe enseñar acaba enseñándose**: bastaría con
que alguien las pintara «ya que están». R5 se comprueba también en el contrato, no sólo en el DOM
— y es la razón por la que la tercera cifra necesitó una firma y no un `git push`.

### 9.6 Matriz tienda × mensajero en el agregado de bodega — DESCARTADA POR EL HUMANO (Q8)

Enseñaría, por cada tienda del agregado, cuánto puso cada mensajero. El humano la descartó con dos
razones que el spec suscribe: **el detalle por mensajero ya existe un nivel más abajo**, y con los
cardinales medidos (máx. 2 tiendas × 2 mensajeros) el cruce añadiría **como mucho cuatro celdas** a
un modal que ya monta dos cascadas por nivel.

### 9.7 Poner la función en un archivo propio (`lib/utils/cierre-por-tienda.ts`) — CONSIDERADA

Es lo que hizo la ficha 347 con la partición por producto (`dinero-por-producto.ts`), y evita que
`ingreso-ordenex.ts` importe `cierre-totales.ts`. **Se prefiere `ingreso-ordenex.ts`** porque es
donde vive la identidad que se está particionando. **Verificado que el import no crea ciclo:**
`cierre-totales.ts` importa `pago-mensajero`, `ingreso-bodega` y tipos de interfaces — **no importa
`ingreso-ordenex`**. Si al implementar apareciera un ciclo, se cae a esta alternativa y se anota en
`progress/`.

### 9.8 Hacer la bodega en una ficha aparte — DESCARTADA POR EL HUMANO (Q4)

Era la recomendación del leader. Ver `requirements.md § El rastro de Q4`.

## 10. Cómo el diseño evita las trampas ya medidas en este repo

| Trampa | Cómo la evita |
|---|---|
| **El dinero como `float`** | Toda la aritmética con `Prisma.Decimal` en el servidor; el navegador sólo formatea. `CascadaDinero` no tiene ni un `Number(` (`:12-18`) |
| **Aserción contra su propia fuente** | Los tests afirman contra **literales escritos a mano** (importes y rótulos), nunca contra la función que los genera |
| **Los tests de servicio usan dobles y no ven el SQL** | R6 se prueba en `tests/integration/db` contra Postgres real, con control positivo. Precedente: `cierre-sin-gestion-sql-real.test.ts` existe por esto mismo (`CierresAdminRepository.ts:1254-1256`) |
| **Test de integración verde sin datos** | Prohibido el `if (!filas) return;`. El test **siembra** su cierre de dos tiendas y **afirma el cardinal** antes que los importes |
| **Un total agrupado que se desglosa** | R10, R11 y R12 son tests propios, **más** la cuarta identidad por tienda de §4.4. Y llevan **mutación** |
| **El composition root que no inyecta** | La misma función se llama desde **tres** sitios: hay un test que comprueba que **los tres** la pasan, no sólo que la importan |
| **Literal: contrato o polizón** | Los importes de los tests son el CONTRATO (los escribe el spec, no la función). Cambiarlos por la salida de `partesPorTienda` dejaría el test siempre verde |

## 11. Complejidad y forma de la ficha

**Sigue siendo `alta`**, y Q8 —que la habría hecho crecer— **no cambia eso**: lo que Q8 evitó fue un
salto a matriz, no la superficie que ya tenía. Lo que sostiene la `alta` es:

- **2 servicios** (`CierresAdminService`, `CierresBodegaAdminService`) y **2 contratos**.
- **3 superficies de pantalla** en **2 módulos**, con **tres umbrales distintos** (§8.1).
- **1 DTO compartido ensanchado**, con **~20 archivos de test** de arrastre mecánico.
- **Cuatro identidades** que fijar con test, una de ellas condicionada a una medición (§6).
- **Una asimetría del DTO de bodega** que hay que cerrar (§5.2: le falta el `ganaLaTienda`
  agregado).
- Tests en **tres familias**: unit del derivador, integración SQL real, componentes ×3 superficies.

Lo que Q7 añadió es **una cifra y una identidad**, no una tanda: la función ya existe y se aplica al
mismo subconjunto. Lo que Q7 sí obliga es a **rotular bien la diferencia** entre las dos cifras
(§8.3), porque confundirlas es el fallo que la 395 vino a arreglar.

Se recomienda lanzarla en **5 tandas** (`tasks.md`), con la de bodega **detrás** de la del
mensajero: la misma secuencia que el leader recomendaba entre fichas, aplicada ahora **dentro** de
la ficha.

## 12. Lo que este diseño NO hace, dicho para que no se cuele

- No emite, borra ni corrige ningún movimiento de wallet.
- No cambia `pagoTiendaOrdenex`, `ganaLaTienda`, `cobradoSobreRecaudado`, `netoOrdenex`,
  `totalesIngresoOrdenex`, `computeTotales` ni `derivarIngresoOrden`.
- No reparte `netoOrdenex`, `cobradoSobreRecaudado` ni `fleteRechazoYaCobradoATienda`: son del
  cierre, no de una tienda.
- No cruza tienda × mensajero en el agregado de bodega (Q8).
- No mete el flete por rechazo dentro del cierre (ver `requirements.md § Consecuencia`).
- No toca las descargas (R27, Q3) ni la tarjeta del listado que ve la satélite.
- No añade migración, ni tabla, ni columna, ni RLS.
