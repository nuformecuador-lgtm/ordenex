# Ficha 389 — Diseño

> El CÓMO. Los requisitos viven en `requirements.md`; el desglose, en `tasks.md`.
> Zona: **fullstack**. Secuencia obligada: **backend → frontend** (el frontend consume el
> contrato que el backend publica).

---

## 0 — El resumen en cinco líneas

1. El servidor gana **una cifra**: «Para la tienda» restringido a las órdenes liquidadas que solo
   llevaban ese producto. Se calcula **reusando** `cifrasDelGrupo` sobre un subconjunto; **cero
   fórmulas de dinero nuevas**.
2. La descarga común gana **un campo opcional** (`hojaExtra`) que viaja `ProductosTabla` →
   `DataTable` → `DescargarDatasetButton` → `construirDescarga` → `buildXlsxRows`. Ausente ⇒ el
   archivo es el de hoy, hoja única.
3. La segunda hoja se proyecta **desde las MISMAS filas** de la primera. Sin segunda lectura, sin
   segundo `obtenerFilas`, sin posibilidad de que las dos hojas discrepen.
4. Las celdas de dinero se escriben como **fórmula literal** (`<f>1234.56</f>`), nunca como
   `number` de JavaScript: es la única forma de que el importe llegue a Excel **con sus dígitos
   intactos** sin pasar por un `double`.
5. **CSV no cambia nada**: el formato no tiene hojas, y el despachador ignora `hojaExtra` cuando
   el tipo es `csv`.

---

## 1 — Modelo de datos: NINGUNA tabla, NINGUNA migración, NINGUNA RLS nueva

Esta ficha **no toca la base**: no crea tablas, no añade columnas, no escribe migración y no
cambia ninguna política RLS. Todo lo que necesita ya está en Postgres y ya lo lee la 347. El
porcentaje de proveeduría **no se persiste en ningún sitio** — es un dato que solo conoce la
tienda y que vive en la celda de su propio archivo (`requirements.md` § contexto).

Consecuencia de proceso: **no hay `down.sql` que escribir** y `pnpm run db:rollback` no entra en
juego. Si al implementar aparece una migración, el diseño falló.

---

## 2 — Backend: la cifra que el cliente NO puede derivar

### 2.1 Por qué hace falta el servidor

La hoja necesita, por fila, **«Para la tienda» de las órdenes liquidadas que solo llevaban ese
producto**. El payload que llega al navegador (`ConteoProductosDTO`) trae cifras **ya agregadas
sobre todas** las órdenes de la fila. El cliente **no tiene** el grano por orden, así que la
restricción es imposible de aplicar ahí. Es la única parte irreducible de esta ficha.

### 2.2 Dónde se calcula, y por qué ahí

`ConteoProductosService.cifrasDelGrupo(ordenes: readonly OrdenQueAporta[])`.

`OrdenQueAporta.claves` ya son las claves de producto de esa orden **deduplicadas con el MISMO
parser** (`parsearProducto` + `deduplicarPorClave`) que decide las filas de la tabla. Por lo tanto:

```
orden de un único producto  ⟺  orden.claves.length === 1
```

Eso es **R11 por construcción**: no hay un segundo criterio que pueda desalinearse. Si mañana el
parser cambia, cambia el criterio de las filas y el de esta hoja **en el mismo commit**.

El cálculo es **una llamada más a lo que ya existe**, sobre el subconjunto:

```
solas          = ordenes.filter((o) => o.claves.length === 1)
soloEsteProd   = { tienda: cifrasDe(solas).liquidado.tienda,
                   ordenes: cifrasDe(solas).liquidado.ordenes }
```

Se hace **dentro de `cifrasDelGrupo`** y no en `fundirDinero`, por una razón concreta: la fila de
la tabla y la cabecera del panel de detalle (`DetalleDineroProductoPayload.totales`) salen las dos
de esa función. Calculándolo ahí, las dos son consistentes por construcción y no por una
comprobación que alguien tenga que acordarse de hacer.

**Ni una fórmula de dinero nueva** (la R16 de la 347 sigue vigente): la aritmética sigue siendo
`repartoDeOrden` → `derivarIngresoOrden` + `pagoTiendaOrdenex`, con `Prisma.Decimal`.

**El caso vacío ya está resuelto y no hay que escribirlo**: `repartoDeOrden([])` devuelve
`tienda: null`, nunca `"0.00"`. Eso es **R14 gratis**.

### 2.3 El contrato nuevo

`lib/types/conteo-productos.ts`:

```ts
/** FICHA 389 — el dinero de las órdenes que SOLO llevaban este producto. */
export interface DineroSoloEsteProductoDTO {
  /** «Para la tienda» de esas órdenes, ya liquidadas. STRING escala 2. `null` = no hay ninguna. */
  readonly tienda: string | null;
  /** Cuántas órdenes liquidadas de un solo producto la componen. Entero. */
  readonly ordenes: number;
}
```

y `DineroProductoDTO` gana `readonly soloEsteProducto: DineroSoloEsteProductoDTO;` — **campo
requerido, no opcional**. Requerido a propósito: rompe el typecheck de los cinco literales de test
que construyen un `DineroProductoDTO`, y eso es exactamente lo que se quiere (un fallo ruidoso en
vez de un `undefined` silencioso viajando a una celda de Excel).

**Por qué cuelga de `dinero` y no de `FilaProductoDTO`:** `fila.dinero` ya es `null` cuando la
concesión está denegada (R5 de la 347) o cuando el recorte excedió el tope (R76). Colgando la
cifra de ahí, **R6 y R7 de esta ficha son heredadas, no reimplementadas**. Una estructura paralela
sería una segunda puerta por la que el dinero podría escaparse sin permiso.

### 2.4 Lo que la hoja NO le pide al servidor

Los tres conteos del aviso (R19/R20) **no** necesitan campo nuevo. Se derivan de lo que ya viaja,
y esta derivación es exacta:

```
ordenesUnSoloProducto = Σ_filas (fila.ordenes − fila.ordenesAcompanadas)
ordenesMultiproducto  = datos.ordenes − datos.ordenesSinProducto − ordenesUnSoloProducto
```

**Por qué la primera suma NO cuenta de más** —que es el error obvio en esta tabla—: `fila.ordenes`
son las órdenes que contienen ese producto y `fila.ordenesAcompanadas` las que además llevan otro,
así que la resta son las órdenes de esa fila que **solo** llevan ese producto, y cada una de ellas
pertenece a **exactamente una** fila. Es **R21**.

**Y por qué el camino simétrico está prohibido:** `Σ_filas fila.ordenesAcompanadas` **SÍ** cuenta
de más —una orden con tres productos suma en tres filas— y por eso el número de multiproducto se
obtiene por diferencia y no por suma. Va escrito aquí porque es el error que cualquiera escribiría
primero, y no pondría nada rojo.

Son sumas de **enteros**: no rozan la regla money-safe. `dinero-producto-no-sumable.guardia`
persigue `reduce(` seguido de una clave de **importe**, y declara explícitamente que un acumulador
de conteos es legítimo.

---

## 3 — La puerta OPT-IN: cómo entra una segunda hoja sin mover las otras ~26 tablas

### 3.1 El camino, entero

```
ProductosTabla.tsx            declara `hojaExtra` SOLO si conDinero
   ↓ prop `descarga` (DataTableDescarga)
DataTable.tsx                 lo pasa tal cual, sin mirarlo
   ↓
DescargarDatasetButton.tsx    lo reenvía tal cual a construirDescarga
   ↓ DescargaConfig.hojaExtra
lib/utils/descarga-dataset.ts si tipo === "csv" → lo IGNORA; si no, lo pasa
   ↓
lib/utils/xlsx-template.ts    ÚNICO sitio que toca exceljs y escribe fórmulas
```

**Cuatro campos opcionales en cuatro contratos, y ni una línea en las demás tablas.** Ausente el
campo, cada capa se comporta exactamente igual que hoy: es **R1 y R5** por construcción, no por
vigilancia.

### 3.2 Por qué se amplía `DataTableDescarga` — el aviso de su docstring, atendido

`DataTableDescarga` dice: *«Si al cablear una tabla nueva hiciera falta ampliar este contrato, es
señal de que el diseño falló, no permiso para meter dominio aquí»*. Se atiende, no se ignora:

- lo que se añade **no es dominio**. Es una capacidad de **presentación del archivo** —una hoja
  más, con sus columnas y sus fórmulas—, sin producto, sin tienda, sin dinero y sin filtros. La
  tabla sigue siendo genérica sobre `T`;
- hay **precedente exacto y aprobado**: la 314 amplió este mismo contrato con `ambitoColumnas`, y
  por el mismo motivo (una capacidad del archivo que solo unas pocas tablas encienden);
- la alternativa —un botón propio para esta tabla— está descartada en §7.

### 3.3 Los tipos nuevos (`lib/types/descarga.ts`, que sigue SIN dominio)

```ts
/** Devuelve la referencia de celda (p. ej. "D7") de otra columna EN LA MISMA FILA. */
export type RefCelda = (clave: string) => string;

export interface DescargaColumnaHoja extends DescargaColumna {
  /** Celda EDITABLE: se emite VACÍA y el generador no escribe nada en ella. */
  entrada?: boolean;
  /** Fórmula SIN el `=` inicial. Recibe el resolutor de celdas de su propia fila. */
  formula?: (celda: RefCelda) => string;
  /** Importe: la celda se escribe con los dígitos del STRING, sin convertir (§4.3). */
  importe?: boolean;
  /** Formato numérico de Excel (`numFmt`), p. ej. "0%" o "#,##0.00". */
  formato?: string;
  /** Lleva total al pie con `SUM(...)` sobre su propio rango de datos. */
  total?: boolean;
}

export interface DescargaHojaExtra {
  /** Nombre de la hoja. Se sanea con `nombreHoja` igual que el de la principal (R32). */
  nombre: string;
  /** Líneas de texto por encima de la cabecera. Una por fila. */
  aviso: readonly string[];
  columnas: DescargaColumnaHoja[];
}
```

y `DescargaConfig` gana `hojaExtra?: DescargaHojaExtra;`.

**La hoja NO trae filas propias.** Se proyecta sobre las MISMAS `config.filas` de la hoja
principal. Tres consecuencias buenas y ninguna mala:

- **R9 por construcción**: una sola lectura, un solo `obtenerFilas`, un solo `lastSync`. Las dos
  hojas no pueden discrepar aunque alguien registre una gestión entre medias;
- **R33 por construcción**: mismas filas, mismo orden;
- **R8 por construcción**: el selector de columnas filtra `visibles`, que es lo que se pasa como
  `columnas` de la hoja principal; **las filas viajan enteras** (está escrito en
  `DescargarDatasetButton`: *«el filtro va en las columnas y nunca en los datos»*), así que la hoja
  de reparto lee sus claves aunque el usuario haya ocultado esas columnas en la hoja 1.

Corolario que hay que decir en voz alta: **las claves que la hoja 2 lee (`reparto_base`,
`reparto_ordenes`) viajan en la fila sin estar declaradas como columnas de la hoja 1**. Eso es el
comportamiento documentado del generador («cualquier otra clave presente en una fila se IGNORA»),
no un truco. Y solo se emiten con `conDinero`, igual que las nueve de la 347 (R67 de aquella).

---

## 4 — La hoja, celda a celda

### 4.1 Disposición

```
fila 1..k     aviso (una línea por fila, columna A, texto)      ← R18, R19, R22, R23
fila k+1      (vacía)
fila k+2      cabecera, en negrita
fila k+3..n   una por producto, EN EL MISMO ORDEN que la hoja 1 ← R33
fila n+1      totales (SUM)                                     ← A2, ⟨Q4⟩
```

### 4.2 Las siete columnas

| # | Encabezado (propuesta, ⟨Q5⟩) | Qué es | Clave / fórmula |
| --- | --- | --- | --- |
| A | Tienda | dato | `tienda` |
| B | Producto | dato | `producto` |
| C | Órdenes liquidadas con solo este producto | entero | `reparto_ordenes` (R16) |
| D | Para la tienda (solo órdenes de un producto) | **importe** | `reparto_base` (R12, R17) |
| E | % de proveeduría | **ENTRADA, vacía** | — (R24) |
| F | Para proveeduría | fórmula | `IF(E="","",D*E)` (R25, R26, R27) |
| G | Queda para la tienda | fórmula | `IF(E="","",D-F)` (R29) |

- **D no lleva la marca `MARCA_NO_SUMABLE_ARCHIVO`** y no debe llevarla (R17): esa marca dice «es
  el importe de la orden completa», y aquí no lo es. Cada orden de un solo producto pertenece a
  exactamente una fila, así que **esta columna sí se suma** (R15). Es la propiedad que hace honesta
  la hoja entera.
- **G se escribe `D−F` y no `D*(1−E)`** a propósito: así `F+G = D` es cierto **por construcción**
  (R29) aunque Excel redondee la multiplicación, en vez de depender de que dos redondeos
  independientes coincidan.
- **`IF(…="","",…)`** y no una multiplicación pelada: sin porcentaje escrito, la celda queda
  **vacía** en vez de mostrar `0,00` (R27). En este árbol un cero es una afirmación —«a proveeduría
  le toca nada»— y el vacío es «todavía no lo has dicho».
- Las fórmulas se guardan en el `.xlsx` **en inglés y con coma como separador de argumentos**, que
  es como el formato las almacena; Excel las traduce al abrirlas. No hay decisión de idioma que
  tomar.

### 4.3 Money-safe cuando el número acaba en una celda de Excel

**El problema.** `exceljs` tipa la celda por el `typeof` del valor: un `string` acaba como texto
(no suma, no ordena, avisos de «número guardado como texto») y un `number` exige `Number(importe)`
— la conversión que este árbol prohíbe, que **tres guardias vivas** persiguen y que ya costó un
céntimo en 14 de 66 órdenes (feature 204).

**La salida.** La celda de importe se escribe como **fórmula cuyo texto es el literal decimal**:

```ts
cell.value = { formula: fila.reparto_base, result: undefined }; // <f>1234.56</f>
```

Los dígitos viajan **como texto** de Postgres a `Prisma.Decimal`, de ahí al STRING escala 2 del
DTO, de ahí al XML del `.xlsx`, y quien los interpreta es **Excel**, no nosotros. Ni un
`Number(`, ni un `parseFloat(`, ni un `.toFixed(`: **R30 y R31**, y las guardias siguen verdes sin
excepción ni lista negra editada.

**El coste, declarado.** Una celda de fórmula sin resultado cacheado la ven vacía los lectores que
**no** calculan (`openpyxl` con `data_only=True`, `pandas.read_excel`). Es un coste inherente a la
feature —toda la hoja son fórmulas, porque el usuario tiene que escribir el porcentaje—, y **no
afecta a la hoja 1**, que sigue siendo la fuente de datos plana de siempre. Va escrito en el
docstring del módulo.

**Lo que NO se hace, y por qué:** rellenar `result` con el número (obliga a `Number(`), o escribir
el importe como texto (`t="s"`: la columna deja de sumar, deja de ordenar, y en una máquina con
coma decimal la coerción de Excel es un albur).

### 4.4 Las referencias de celda

Se resuelven con `worksheet.getColumn(i).letter` de `exceljs`, **no** con una conversión
índice→letra escrita a mano: la de casa se equivoca en la columna 27 (`AA`), y esta hoja tiene
siete columnas hoy y ninguna garantía de tener siete mañana. El número de fila lo aporta el
generador, que es quien sabe cuántas líneas de aviso escribió (**R28**).

---

## 5 — Rutas, endpoints y contratos I/O

**Ninguna ruta nueva. Ningún endpoint nuevo. Ninguna Server Action nueva.**

- La lectura sigue siendo `consultarConteoProductos` (Server Action ya existente, ya validada con
  zod, ya con su alcance por rol y su caché). Solo cambia **la forma de su respuesta**, y hacia
  arriba: un campo más dentro de `dinero`.
- El archivo se sigue armando **en el navegador** y se entrega con `descargarBlob`: no se sube a
  ningún sitio y no se almacena fuera del equipo del usuario.
- La caché no se toca: la clave (`claveDeConteoProductos`) no gana componentes. La cifra nueva es
  una proyección más del mismo conjunto leído, no una lectura distinta.
- **`exceljs` sigue fuera del bundle inicial**: el import dinámico permanece dentro de
  `buildXlsxRows`, y `descarga-dataset.ts` sigue sin importarlo (su docstring lo declara y hay que
  respetarlo).

### Contrato I/O, resumido

| Frontera | Entra | Sale |
| --- | --- | --- |
| `cifrasDelGrupo` | `OrdenQueAporta[]` | `DineroProductoDTO` **+ `soloEsteProducto`** |
| `filaDescargaAnaliticaProductos(fila, conDinero)` | `FilaProductoDTO` | la fila de hoy **+ `reparto_base: string|null` + `reparto_ordenes: number|null`**, solo con `conDinero` |
| `construirDescarga(config)` | `DescargaConfig` **+ `hojaExtra?`** | `DescargaArchivo` (sin cambios) |
| `buildXlsxRows(cols, rows, hoja, hojaExtra?)` | idem | `ArrayBuffer` |

---

## 6 — Dónde vive cada archivo nuevo, y por qué exactamente ahí

| Archivo | Qué lleva | Por qué ahí |
| --- | --- | --- |
| `app/(app)/analitica/_components/entregas/reparto-proveeduria-descarga-columnas.ts` | `COLUMNAS_DESCARGA_REPARTO_PROVEEDURIA` y `filaRepartoProveeduria(fila)` | El sufijo `-descarga-columnas.ts` es lo que hace que `columnas-sensibles.guardia` lo descubra **por convención** y le ejecute la proyección con su sonda. Declararlo con otro nombre lo dejaría fuera del censo. |
| `app/(app)/analitica/_components/entregas/reparto-proveeduria-aviso.ts` | los tres conteos y las líneas del aviso | **Fuera** de la convención a propósito: `columnas-sensibles.guardia` invoca **toda función exportada** de un módulo `*-descarga-columnas.ts` con una sonda y **lanza** si no devuelve un objeto. Una función que devuelve `string[]` sobreviviría por accidente; una que devuelva `string`, no. Se separa antes de que muerda. |

**Trampas de las guardias, dichas antes de tropezar con ellas** (las cuatro están medidas en el
árbol, no supuestas):

1. `columnas-asercion-de-orden.guardia` censa **toda** `export const COLUMNAS_DESCARGA_*` de
   `app/` + `components/` y exige, en `tests/`, un `expect(LA_CONSTANTE.map(...)).toEqual([...])`
   que la **NOMBRE**. La constante nueva la necesita.
2. `columnas-sensibles.guardia` exige que cada módulo `*-descarga-columnas.ts` declare **al menos
   unas columnas y al menos una proyección**, y prohíbe claves/encabezados con forma de
   identificador interno, credencial o URL. `reparto_base` y `reparto_ordenes` pasan; un
   `reparto_id` no pasaría.
3. `dinero-producto-no-sumable.guardia` barre `analitica-productos-descarga-columnas.ts` buscando
   `Number(`, `parseFloat(`, `parseInt(`, `.toFixed(` y **formas de total sobre claves de
   importe**. El módulo nuevo **debe añadirse a esa lista** (`FUENTES_CON_DINERO`): si no, la hoja
   de reparto sería el único sitio del árbol donde un importe puede convertirse sin que nada se
   ponga rojo.
4. `ambito-columnas.guardia` lee el árbol **como texto**: la 388 dejó escrito que un ternario o un
   acceso por punto le salen sin resolver. Esta ficha **no toca ámbitos**, pero el cableado de
   `ProductosTabla` sí se toca, y `ambitoColumnas,` debe seguir bajando como **propiedad
   abreviada**.

---

## 7 — Alternativas descartadas

### 7.1 Prorratear el importe entre los productos de la orden — **descartada por el humano**

Ordenex **no sabe el precio de cada producto**: la orden lleva un solo `monto_cobrar` y
`orden.producto` es texto libre (`cantidad * nombre`). Repartir exigiría inventar precios, o sea
producir **una cifra con aspecto de dato**. No es deuda ni follow-up: no se puede sin pedirle el
precio a la tienda. (`feature_list.json` §389, decisión del 2026-09-07.)

### 7.2 Filtrar por FILA en vez de por ORDEN (`ordenesAcompanadas === 0`) — **descartada aquí**

Era la salida barata: no toca el servidor, usa `para_la_tienda` tal cual y deja en la hoja solo los
productos cuyas órdenes **todas** iban solas. Se descarta por dos motivos, y el segundo es
decisivo:

1. **No es lo que el humano firmó.** La decisión dice «solo sobre las **órdenes** de un único
   producto». Filtrar por fila es otra cosa: tira el producto **entero** aunque 49 de sus 50
   órdenes fueran solas.
2. **Vacía la hoja justo donde importa.** Con el 32,4 % de órdenes multiproducto medido, basta
   **una** orden acompañada para borrar un producto; los más vendidos son precisamente los que más
   probabilidad tienen de haber ido acompañados alguna vez. La cobertura de «~2 de cada 3» que el
   humano compró es sobre **órdenes**, y solo se consigue filtrando por orden. La medición de la
   347 lo enseña: `BASE C` tenía 19 entregadas y **1** sola — con filtro por fila desaparece; con
   filtro por orden aparece con ₡15.900 y su celda diciendo que la respalda **1** orden.

### 7.3 Un botón de descarga propio para esta tabla — **descartada**

Habría evitado tocar `DataTableDescarga`. Se descarta porque duplica la máquina completa (tope de
5.000 filas, mensajes accionables, guard de carrera, `descargarBlob`, import dinámico de `exceljs`,
nombre de archivo) y porque **el humano pidió una segunda hoja del MISMO archivo**, no un segundo
archivo. Dos botones de descarga en la misma barra es peor UI que un campo opcional en un contrato.

### 7.4 Escribir la hoja con valores ya calculados por Ordenex — **descartada**

Es lo contrario de lo pedido («dejándoles fácil el cálculo»): obligaría a la tienda a decirnos su
porcentaje —que solo ellos saben— y a volver a descargar cada vez que lo cambien. Además nos
metería en el negocio de multiplicar dinero en el navegador, que es exactamente donde la feature
204 perdió un céntimo en 14 de 66 órdenes.

### 7.5 Un tercer formato o una hoja para CSV — **descartada**

CSV **no tiene hojas**: es una tabla plana. Las opciones eran (a) ignorar la hoja, (b) anexar las
filas del reparto al final del CSV, (c) impedir el CSV cuando la hoja está declarada. Se elige
**(a)**: (b) rompe la promesa explícita del humano de no tocar lo que ya se descarga —el archivo
dejaría de tener una sola tabla— y (c) le quita al usuario un formato por una hoja que ni siquiera
podría llevar fórmulas. Además, **hoy es un camino inalcanzable**: `ProductosTabla` no declara
`formatos`, así que su descarga solo ofrece `xlsx` y baja directa sin menú. La regla se define y se
prueba igualmente, para que la tabla nº 27 no descubra el comportamiento por accidente (R3).

---

## 8 — Riesgos, y qué los contiene

| Riesgo | Qué lo contiene |
| --- | --- |
| Que la hoja 2 «mienta» como la 1: repartir dos veces el mismo dinero | R15 con test propio: una orden multiproducto NO aparece en la base de **ninguna** fila; una de un solo producto aparece en **exactamente una** |
| Perder un céntimo al escribir la celda | §4.3 + la guardia de money-safe ampliada al módulo nuevo (§6.3) |
| Que el aviso mienta al contar | R20 (los tres conteos suman el total) y R21, con el caso explícito de la orden con tres productos |
| Romper las otras ~26 tablas | R1/R5: **los tests de descarga existentes no se editan**. Si alguno hay que tocarlo, el diseño falló (`tasks.md` T0.3) |
| Fórmulas desplazadas por las líneas de aviso (off-by-one) | R28 con test que **lee el `.xlsx` de vuelta** y comprueba que la fórmula de la fila 3 apunta a la fila 3 |
| Un `.xlsx` que Excel abra roto | V2: verificación humana abriendo el archivo real. No hay E2E en este repo y no se va a inventar uno aquí |

---

## 9 — El gate

El diff toca **`lib/types/descarga.ts` y `lib/types/conteo-productos.ts`**, y `^lib/types/` está
en `RUTAS_SENSIBLES` de `init.sh`. Por lo tanto **`./init.sh --rapido` se negará** y el gate
obligatorio de esta ficha es **`./init.sh` completo**. No es opinable y no depende de que nadie se
acuerde: lo dice el arnés (`docs/verification.md`, regla 5 de `CLAUDE.md`).
