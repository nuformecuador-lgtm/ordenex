# Feature 350 — Rediseño de la etiqueta de guía en PDF · design

> El QUÉ está en `requirements.md`. Aquí va el CÓMO: geometría, contratos,
> migración de los dos generadores, y cómo se demuestra «nada recortado» sin
> abrir un PDF a ojo.

## 0. Alcance en una tabla

| Archivo | Qué le pasa |
|---|---|
| `lib/pdf/etiquetas-maqueta.ts` | **(M)** deja de ser un lienzo cuadrado; pasa a bandas + cuerpos + cuerpo mínimo |
| `lib/pdf/etiquetas-layout.ts` | **(M)** deja de escalar por `s`; resuelve la **celda** y la escala tipográfica |
| `lib/pdf/etiquetas-ajuste.ts` | **(M)** gana el ajuste por cuerpo y el partido de palabras; pierde el uso de la elipsis |
| `lib/pdf/etiquetas-dibujo.ts` | **(M)** dibuja las cinco bandas y el recuadro; muere `drawCampos` |
| `lib/config/etiquetas-hoja.ts` | **(M)** cada hoja declara su **rejilla** de celdas (hoy 1 × 1) |
| `app/(app)/ordenes/_components/etiquetas-pdf.ts` | **(m)** sólo cambia si se firma **Q1** (paginación por celda) |
| `lib/pdf/etiquetas-pdf-lote.ts` | **(=)** no cambia ni una línea: sigue con `crearLayoutBase()` |
| `app/(app)/ordenes/_components/EtiquetaGuia.tsx` | **(M)** si se firma **Q5** (vista previa) |
| `tests/unit/pdf/pdf-inspector.ts` | **(M)** gana lectura de **rectángulos** |
| `tests/fixtures/etiquetas-282.ts` | **(M)** gana el peor caso medido y el caso adversarial |

Sin migración, sin tablas, sin endpoints (§10).

## 1. El diagnóstico, confirmado en el archivo real

`lib/pdf/etiquetas-layout.ts:71-97`:

```ts
const lado = Math.min(hoja.anchoMm, hoja.altoMm);
const s = lado / LIENZO_BASE_MM;
// ... fontRotulo: MAQUETA_BASE.fontRotulo * s, fontValor: ... * s, fontGuia: ... * s
x: (v) => offX + s * v,
```

Todo —coordenadas **y** tipografía— sale del mismo `s`. Por eso las cuatro hojas
tienen la misma capacidad: el ancho de columna crece igual que el cuerpo, así que
`splitTextToSize` parte en el mismo número de líneas y el cupo vertical
`lineasDisponibles` (que se calcula en el lienzo base) devuelve **10 en las
cuatro**, tal como afirma hoy `tests/unit/pdf/etiquetas-maqueta.test.ts:94-99`.
Ese test es el certificado del defecto: dice, con orgullo, que da igual la hoja.

Y `lib/pdf/etiquetas-dibujo.ts:95-102` es la columna de rótulos:

```ts
const anchoRotulo = Math.max(...campos.map((c) => doc.getTextWidth(c.label.toUpperCase()))) + …;
const anchoValor = layout.contentWidth - anchoRotulo;
```

`anchoRotulo` lo fija «MONTO A COBRAR» —el rótulo más ancho— y se descuenta en
**todas** las líneas, también en las de la dirección.

## 2. Idea del rediseño en una frase

> La celda deja de ser un lienzo escalado y pasa a ser un **presupuesto de
> milímetros repartido entre cinco bandas**; el texto no se recorta para caber:
> **el cuerpo tipográfico baja hasta un suelo declarado**, y si con ese suelo no
> cabe, la etiqueta **no se emite** (fallo visible), nunca se emite mutilada.

## 3. Hoja → celda → layout (y aquí es donde vive Q1)

`lib/config/etiquetas-hoja.ts` gana dos campos:

```ts
export interface HojaEtiqueta {
  id: HojaEtiquetaId;
  label: string;
  anchoMm: number;
  altoMm: number;
  /** Rejilla de etiquetas por hoja. 1 × 1 = una etiqueta por página. */
  columnas: number;
  filas: number;
}
```

```ts
export const HOJAS_ETIQUETA = [
  { id: "100x100", …, anchoMm: 100,   altoMm: 100,   columnas: 1, filas: 1 },
  { id: "4x6in",   …, anchoMm: 101.6, altoMm: 152.4, columnas: 1, filas: 1 },
  { id: "a4",      …, anchoMm: 210,   altoMm: 297,   columnas: 1, filas: 1 },  // Q1: → 2 × 2
  { id: "carta",   …, anchoMm: 215.9, altoMm: 279.4, columnas: 1, filas: 1 },  // Q1: → 2 × 2
];
```

`celdaDeHoja(hoja, indice)` devuelve `{ x0, y0, ancho, alto }` repartiendo la
hoja en la rejilla. Con 1 × 1 devuelve la hoja entera y **nada del motor de
dibujo se entera**.

**Por qué así, y no con un `if (hoja.id === "a4") { … }`:** Q1 está abierta. Con
la rejilla como *dato*, firmarla es cambiar `columnas: 2, filas: 2` en dos filas
de una tabla; los tests de geometría, el ajuste y el dibujo no se tocan. Lo único
que Q1 añadiría de código es la **paginación** en el generador de cliente
(`indice % (columnas·filas)` decide celda; `addPage` cuando toca) y —si el humano
las quiere— las guías de corte. Está aislado en un solo bucle.

> Nota de precisión sobre Q1: con 2 × 2 en A4 la celda de 99 × 143 mm es **más
> angosta** que la celda base de 100 mm. Como el ancho es lo que gobierna los
> caracteres por línea (§5), «4-up» **no** aumenta la capacidad por línea; da
> alto (143 vs 100) y ahorra papel. El argumento fuerte de Q1 es el papel, no la
> capacidad — conviene que quien firme lo sepa.

### 3.1 El layout nuevo (contrato)

```ts
export interface EtiquetaLayout {
  hoja: HojaEtiqueta;
  /** Rectángulo de papel de ESTA etiqueta, en mm de página. */
  celda: { x0: number; y0: number; ancho: number; alto: number };
  margen: number;
  anchoUtil: number;   // celda.ancho - 2·margen
  altoUtil: number;    // celda.alto  - 2·margen
  /** Escala TIPOGRÁFICA. Sale del ANCHO, no del lado menor. Ver §5.1. */
  k: number;
  /** Suelo de legibilidad, en pt de PÁGINA. NO se escala. */
  cuerpoMinimoPt: number;
  qrMm: number;
  barcodeMm: number;
  barcodeRaster: { width: number; height: number; fontSize: number };
  /** mm relativos al ÁREA ÚTIL → mm de página. Sin factor de escala geométrico. */
  x: (v: number) => number;
  y: (v: number) => number;
}
```

`crearLayout(hoja, indiceCelda = 0)`; `crearLayoutBase()` sigue siendo
`crearLayout(getHojaEtiqueta("100x100"))` y sigue dando `k = 1`, celda = hoja,
márgenes idénticos. **El default no es una regresión visual** — el mismo criterio
con el que la 150 justificó `s = 1`.

## 4. La maqueta: cinco bandas

De arriba abajo, dentro del área útil (R13):

```
┌──────────────────────────────────────────────┐
│ GUÍA                         FECHA  REMISIÓN │  ┐
│ 19887906                          ┌────────┐ │  │ 1. CABECERA   (fija)
│                                   │   QR   │ │  │    alto = max(qr, pila textual)
│                                   └────────┘ │  ┘
│                                              │
│ José Andrés Peña Rodríguez                   │  ┐
│ 8888 7777                                    │  │ 2. DESTINO    (flexible)
│ Del súper La Central 200 m al sur, casa      │  │    absorbe el sobrante
│ color verde con portón negro                 │  │    SIN columna de rótulos
│ GAM / San José / Mora / Colón                │  ┘
│                                              │
│ ┌──────────────────────────────────────────┐ │  ┐ 3. IMPORTE    (fija)
│ │ COBRAR                          ₡18.000  │ │  ┘    recuadro, UNA línea
│ └──────────────────────────────────────────┘ │
│                                              │
│ Producto: Vitrina de cerámica única          │  ┐ 4. DETALLE    (flexible, mín.)
│ Tienda: Tienda Ríos                          │  ┘    cuerpo menor
│                                              │
│ ▌▌▍▌▍▍▌▌▍▌▌▍▌▍▌▌▍▌▌▍▌▍▍▌▌▍▌▌▍▌▍▌▌▍▌▌▍▌▍▍▌▌▍ │  ┐ 5. CÓDIGO DE BARRAS (fija)
│                  19887906                    │  ┘    a TODO el ancho útil
└──────────────────────────────────────────────┘
```

### 4.1 Cabecera

El número de guía a la izquierda, grande; **FECHA** y **REMISIÓN** en la fila de
rótulos, donde la feature 295 los dejó (`etiquetas-dibujo.ts:215-236`); el **QR
arriba a la derecha**. La separación entre la línea base de la guía y lo que
venga debajo sigue siendo **≥ 1 em del cuerpo de la guía**: la regla derivada de
la 282 (`camposYInicio`) se conserva **porque su justificación no ha cambiado**
—las métricas de tinta de las fuentes estándar no están en el repo, así que un em
sigue siendo la única cota honesta—.

**Efecto colateral favorable, y no es menor:** al subir el QR, el código de
barras pasa de `88 − 26 − 4 = 58 mm` de ancho a los **88 mm completos**. Más
módulos por milímetro para la pistola, gratis.

### 4.2 Rótulos: quién los conserva y quién no

| Banda | Rótulos |
|---|---|
| Cabecera | sí: `GUÍA`, `FECHA`, `REMISIÓN` (los de hoy) |
| **Destino** | **ninguno** (D2). Se lee como un sobre postal |
| Importe | sí, uno, **dentro del recuadro y en la misma línea** que el importe |
| Detalle | sí, **en línea y sin columna alineada**: el valor arranca justo detrás del rótulo, no en una columna común |

La distinción de la última fila es toda la diferencia: hoy el problema no es que
existan rótulos, es que **se alinean en una columna** cuyo ancho lo fija el más
largo y se descuenta en todas las líneas. Un rótulo en línea cuesta su propio
ancho una vez, en su propia línea.

*(Decisión del autor del spec, revisable en la puerta: producto y tienda son los
dos datos cuyo significado no se adivina sin rótulo —«Caja x2» podría ser
cualquier cosa—, mientras que un nombre, un teléfono y una dirección seguidos se
leen solos.)*

### 4.3 Cuerpos base propuestos (celda base, en pt)

Derivados de los que hoy se imprimen, no inventados de cero:

| Elemento | Hoy | Propuesto | Por qué |
|---|---|---|---|
| Número de guía | 22 | **22** | no se toca (282/R27) |
| Rótulos de cabecera | 8 | **8** | no se tocan |
| Remisión | 10 | **10** | no se toca |
| Destinatario | 9 | **13** | D3: jerarquía por tamaño |
| Teléfono | 9 | **12** | D3 |
| Dirección | 9 | **10** | gana ancho por D2 |
| Ubicación | 9 | **9** | igual |
| Importe | 9 | **16** | D3: es lo que hay que cobrar |
| Producto / Tienda | 9 | **8** | «cuerpo menor» de D3 |
| **Interlineado** | 4 mm a 9 pt | **× 1,26 del cuerpo** | es exactamente el de hoy (4 / (9 · 25,4/72) = 1,26): se conserva la densidad ya impresa en vez de estrenar un número |

Los cuerpos del destino y del detalle son **el punto de partida** del ajuste
(§5), no valores fijos: bajan cuando hace falta y suben cuando sobra sitio.

## 5. El ajuste: cómo se garantiza «nada recortado» de forma comprobable

### 5.1 Dos escalas distintas, y esta separación es el corazón del rediseño

| | Cómo escala | Por qué |
|---|---|---|
| **Geometría** (bandas, altos) | con el **área real** de la celda | el alto extra se vuelve **líneas** (R10) |
| **Tipografía** | con `k = anchoUtil / anchoUtilBase` | conservar `k` proporcional al **ancho** mantiene constantes los **caracteres por línea**; así todo el alto adicional es capacidad neta (R11) |
| **Suelo de legibilidad** | **no escala** | la legibilidad es física: 6 pt en A4 son 6 pt de tinta |

Con `k = anchoUtil/anchoUtilBase` resulta `k = 1` en `100x100`, `1,018` en
`4x6in`, `2,25` en `a4` y `2,32` en `carta`. Y **el QR y el barcode nunca
encogen**: `qrMm = 26 · max(1, k)`, `barcodeMm = 16 · max(1, k)` (R12); el
`max(1, …)` existe por Q1, donde una celda de 99 mm daría `k = 0,99`.

### 5.2 El suelo, con su número y su porqué

`CUERPO_MINIMO_PT = 6.0`, **absoluto en puntos de página**.

Lo honesto por delante: **el repo no tiene ninguna fuente sobre legibilidad en
papel**. Lo único medido es que hoy se imprimen y se leen rótulos a **8 pt** en
la celda base. 6,0 pt son 2 pt por debajo de esa única evidencia, y con ese suelo
el peor caso cabe según §5.5. Es una elección del autor del spec: **Q2 pide
firma**.

| Candidato | Car./línea a 88 mm (est.) | Líneas para 286 car. | Coste |
|---|---|---|---|
| 7,0 pt | ~71 | 5 | más legible; ~2,7 mm más de alto en el peor caso |
| **6,0 pt** | ~83 | **4** | la propuesta |
| 5,0 pt | ~100 | 3 | por debajo de lo que un lector con prisa distingue en térmica |

Que baje del suelo es **imposible por construcción, no por convención**: el
ajuste devuelve `cabe: false` y el llamador aplica R7. No hay rama que dibuje por
debajo de `cuerpoMinimoPt`.

### 5.3 El algoritmo (puro, en `lib/pdf/etiquetas-ajuste.ts`)

```ts
export interface AjusteBloque {
  cuerpoPt: number;         // el cuerpo elegido; >= cuerpoMinPt SIEMPRE
  lineas: string[][];       // una entrada por dato del bloque
  altoMm: number;
  cabe: boolean;            // false => R7, nunca recorte
}

export function ajustarBloque(
  datos: { texto: string; factorCuerpo: number }[],  // factorCuerpo: 1 = cuerpo del bloque
  anchoMm: number,
  altoMm: number,
  cuerpoMaxPt: number,
  cuerpoMinPt: number,
  medir: (texto: string, pt: number) => number,      // ancho de tinta en mm
): AjusteBloque
```

Búsqueda **descendente** desde `cuerpoMaxPt` en pasos de 0,25 pt hasta
`cuerpoMinPt`; se devuelve el primero que cabe. Lineal y no binaria **a
propósito**: el corte de palabras no es monótono de forma garantizada (bajar el
cuerpo puede, en un caso patológico, reordenar el reparto de palabras y añadir
una línea), y una binaria sobre una función no monótona devuelve un resultado
plausible y equivocado. Son ≤ 56 iteraciones por bloque; el coste se mide (T12).

`partirEnLineas(texto, anchoMm, pt, medir)` envuelve a `splitTextToSize` y
**además** parte por carácter cualquier línea que siga excediendo el ancho (R3).

> ⚠️ **No verificado en esta sesión:** que `splitTextToSize` de jsPDF deje
> desbordar una palabra más ancha que el cupo. Es el comportamiento habitual de
> los envolvedores por palabras, pero **no lo he medido aquí**. T1 lo mide: si
> resultara que sí la parte, `partirEnLineas` se reduce a una aserción de
> seguridad en vez de a lógica nueva. En ningún caso se asume.

### 5.4 Reparto entre bandas cuando no alcanza (orden de sacrificio)

1. La banda **detalle** baja su cuerpo hasta el suelo. *(Producto y tienda son lo
   menos crítico de D3.)*
2. La banda **destino** baja su cuerpo hasta el suelo.
3. Si aún no cabe → `ErrorEtiquetaNoCabe` (R7).

**Ninguna banda pierde líneas en ningún paso.** El número de líneas lo dicta el
texto; lo que se ajusta es el cuerpo. Eso es lo que hace que R2 (reconstrucción
exacta) sea cierto por construcción y no por vigilancia.

Cuando **sobra** sitio (4x6in, A4, Carta), destino y detalle suben hasta
`cuerpoBase · k` y el remanente se reparte como aire entre las bandas, para que
el contenido llegue a los márgenes (R9).

### 5.5 El presupuesto del peor caso — ESTIMACIÓN, no medida

Aritmética preliminar para `100x100` (área útil 88 × 88 mm), con un ancho medio
de carácter de 0,5 em. **Marcado como estimación a propósito: T2 lo mide con
`doc.getTextWidth` real antes de fijar una sola constante.**

| Banda | Alto (mm) |
|---|---|
| Cabecera (la manda el QR) | 26,0 |
| Importe (16 pt + padding) | 8,6 |
| Detalle a 6 pt: producto 138 car. → 2 líneas + tienda 1 | 8,0 |
| Código de barras | 16,0 |
| 4 separaciones × 2 mm | 8,0 |
| **Fijo** | **66,6** |
| **Queda para el destino** | **21,4** |

El destino en el peor caso, todo a 8 pt salvo dirección/ubicación a 6 pt:
destinatario 3,56 + teléfono 3,56 + dirección (286 car. → 4 líneas × 2,67) 10,7
+ ubicación 2,67 = **20,5 mm**. Entra con **0,9 mm** de holgura.

**Cabe, y por poco.** Por eso T2 es una tarea de medición con puerta y no un
trámite. **Palancas declaradas, en este orden**, si la medida real no entra:

1. Margen de 6 → **5 mm** (+2 mm de alto y +2 de ancho útil). *Riesgo: menos
   tolerancia al desalineado del medio térmico.*
2. El rótulo del importe comparte línea con el importe (ya está así en §4.2);
   si se hubiera puesto encima, quitarlo devuelve ~3 mm.
3. Padding del recuadro de 1,5 → 1,0 mm (+1 mm).
4. Cuerpo del importe 16 → 14 pt (+0,7 mm).
5. **Se para y se pregunta (Q2/Q3).** No se recorta, y no se elige mitigación en
   silencio.

## 6. Cómo se prueba la geometría sin abrir un PDF a ojo

El repo ya tiene la herramienta y no hace falta ninguna dependencia nueva:
`tests/unit/pdf/pdf-inspector.ts` devuelve, por cada texto dibujado, su
`x`, `y`, su **cuerpo** y su **texto decodificado con el `/ToUnicode` que declara
el propio documento**. Es el mismo camino que sigue un lector de PDF real. Sobre
eso se montan **seis aserciones**, y ninguna es «no lanza»:

| # | Aserción | Cubre |
|---|---|---|
| **V1** | **Reconstrucción**: las líneas de cada dato, concatenadas y con los espacios normalizados, son **exactamente** el valor esperado del corpus | R1, R2, R5 |
| **V2** | **Contención horizontal**: `x + getTextWidth(texto)` con la fuente y el cuerpo del propio `Tf` ≤ borde derecho del área útil | R3 |
| **V3** | **Contención vertical y bandas disjuntas**: cada línea base cae dentro de su banda; los intervalos de las cinco bandas no se solapan; nada entra en la banda de códigos ni sale de la celda | R4, R13 |
| **V4** | **Suelo**: todo `Tf` de la página tiene `tamano ≥ CUERPO_MINIMO_PT` | R6 |
| **V5** | **Jerarquía**: `tamano(destinatario) > tamano(producto)` y `> tamano(tienda)`; el importe va en un rectángulo que lo contiene | R14, R15 |
| **V6** | **Sin marcas**: ningún texto contiene `...` ni `…` | R1 |

**V1 es la que de verdad muerde.** «No hay tres puntos» es una aserción débil:
sobreviviría a un corte sin marca, o a cambiar la marca. Comparar la
concatenación contra el valor **entero** cierra las tres puertas a la vez.

**Contra qué se compara — y esto importa, porque es el error clásico:** el valor
esperado se declara **como literal en el fixture del corpus**, no se obtiene
llamando a la función que genera el texto. Para la ubicación eso significa
escribir `"GAM / San José / Mora / Colón"` a mano en el caso, y **no**
`geografiaLegible(dto)`: comparar un texto contra la función que lo produce está
siempre verde y no afirma nada.

**Ampliación necesaria del inspector:** `rectangulosDePagina(bytes, indice)`, que
lee los operadores `x y w h re` seguidos de `S`/`f`/`B`. Sin ella, V5 no puede
afirmar el recuadro y —peor— el test de paridad entre generadores se quedaría
ciego justo en lo nuevo (§7).

### 6.1 El corpus crece

`tests/fixtures/etiquetas-282.ts` (que pasa a llamarse el corpus de la etiqueta,
sin renombrar el archivo para no arrastrar 4 suites) gana:

| Caso | Qué es | Real |
|---|---|---|
| `peor-caso-medido` | dirección de **286** car. y producto de **138** | **longitudes reales**, texto sintético |
| `palabra-sin-espacios` | una palabra de 60 car. sin un solo espacio en la dirección | forma adversarial de R3 |
| `minimos` | todos los campos en su forma más corta | control: el ajuste **sube** el cuerpo, no lo deja en el suelo |

Sobre `peor-caso-medido`: las cadenas reales son PII y no constan. Se declara
explícitamente en el fixture —igual que hace hoy con las «formas»— que **la
longitud es real y el texto no**. Y por eso `palabra-sin-espacios` existe: la
longitud no determina el ancho, la forma sí.

### 6.2 La capacidad declarada (R8)

Un test recorre, para cada hoja, direcciones de longitud creciente y anota dos
números: el último que entra sin bajar del cuerpo base, y el último que entra
antes de disparar R7. Los dos quedan **escritos como constante esperada** en el
test y en `progress/impl_350.md`. Si un cambio futuro los baja, sale rojo con el
número viejo y el nuevo en el mensaje.

Es lo que convierte Q3 en una decisión informada en vez de en una apuesta: se
sabrá si el peor caso medido (286) queda holgado o al filo.

## 7. Los dos generadores: qué cambia en cada uno y cómo no vuelven a divergir

**Lo primero, lo que NO cambia:** la firma de `drawEtiqueta(doc, layout,
etiqueta, raster, fuente)` se conserva. Todo el rediseño ocurre dentro del módulo
compartido, así que:

| Generador | Diff |
|---|---|
| **Servidor** (`lib/pdf/etiquetas-pdf-lote.ts`) | **cero líneas**. Sigue con `crearLayoutBase()` y su firma de un parámetro (R20) |
| **Cliente** (`app/(app)/…/etiquetas-pdf.ts`) | **cero líneas** hoy; **sólo si se firma Q1** gana el bucle de celda/página |

Que el diff del servidor sea cero **no es suerte**: es el rendimiento de la
inversión que hizo la 282 al extraer la maqueta. La cabecera de
`etiquetas-maqueta.ts` explica que un espejo mantenido a mano ya divergió una
vez; aquí se cobra.

### 7.1 Las tres capas anti-divergencia, y el agujero que hay que tapar

Las tres siguen: el test de paridad, la guardia de constantes, y el compilador.
Pero **el test de paridad tiene un agujero nuevo**: hoy
`etiquetas-dos-generadores.test.ts` compara sólo `x y Td` + cuerpo + texto. El
recuadro del importe es un `re`/`S`: **un generador podría dibujarlo y el otro
no, y el test seguiría verde**. Por eso §6 exige `rectangulosDePagina` y por eso
el test de paridad debe comparar **también los rectángulos**.

La guardia `etiquetas-maqueta-unica.guardia.test.ts` amplía su lista de
constantes prohibidas con las nuevas (`CUERPO_MINIMO_PT`, `BANDAS`, `MARGEN_MM`,
`INTERLINEADO`, `CUERPO_*`) y conserva su control positivo: la maqueta compartida
**sí** las declara, o la prohibición sería vacía.

## 8. Fuente embebida y cobertura (R21)

La cobertura es de **code points**, no de cuerpos: cambiar tamaños tipográficos
**no la afecta en absoluto**. Lo que sí la afecta es **texto nuevo dibujado con
la fuente embebida**. Hoy sólo lo es el valor del importe
(`etiquetas-dibujo.ts:169`, `exigirCobertura(fuente, monto, "Monto a cobrar")`).

Con el recuadro, la decisión y su consecuencia:

- El **importe** sigue con la fuente embebida (necesita `₡`) → `exigirCobertura`
  **se mantiene tal cual**.
- El **rótulo del recuadro** se dibuja con la fuente estándar, como el resto de
  rótulos → no toca la cobertura.
- **Regla general que se codifica**: cualquier texto que se dibuje con
  `FuenteEmbebida` pasa por `exigirCobertura` **antes** de escribir un byte. Si
  el implementer añade uno y lo olvida, un test lo caza: se afirma que el conjunto
  de textos dibujados con `/Subtype /Type0` en el PDF coincide con el conjunto de
  textos que pasaron por `exigirCobertura`.

El artefacto (`assets/fuentes/LiberationSans-etiqueta-subset.ttf`, 16.944 B,
219 code points, `/FontFile2` ≤ 12 KB por documento) **no se toca**: ni peso, ni
procedencia, ni licencia, ni el script que lo regenera.

## 9. Dinero (R22)

El importe llega como `montoCobrar: number | null` **por contrato de la feature
32** y se formatea con `formatMonto`, que entra al camino money-safe con
`toFixed(2)` y trabaja sobre STRING. El rediseño:

- **no** convierte, no re-parsea, no reconstruye el importe;
- **no** lo parte en líneas: R15 exige una sola línea, y el ajuste trata el
  importe como una unidad indivisible (si no cabe a lo ancho, baja el cuerpo del
  recuadro; nunca lo envuelve);
- **no** mide el ancho contando dígitos: usa `getTextWidth` con la fuente
  embebida activa.

Las tres guardias de dinero vivas del repo siguen aplicando sin cambios.

## 10. Modelo de datos, endpoints, integraciones

**Ninguno.** Sin tabla, sin columna, sin migración, sin `down.sql`, **sin RLS**.
La etiqueta es un READ derivado (`EtiquetaGuiaDTO`, feature 32) y esta ficha sólo
cambia cómo se dibuja. No hay Server Action nueva, no hay route handler nuevo, no
hay validación zod de borde nueva (la única entrada es la elección de hoja del
propio usuario, ya acotada por tipos y saneada por `getHojaEtiqueta`). Se escribe
aquí explícitamente para que el reviewer no lo lea como un olvido — mismo
criterio que `specs/150/design.md` §6.

## 11. Aserciones existentes que MUEREN, y qué las sustituye

Esto no es «relajar tests». Es sustituir el certificado de una decisión derogada
por el de la que la reemplaza, con al menos la misma fuerza. La tabla es para el
reviewer:

| Aserción que muere | Dónde | Qué la sustituye | ¿Más o menos fuerte? |
|---|---|---|---|
| «el factor sale del lado MENOR» | `etiquetas-layout.test.ts:17-52` | `k` sale del **ancho** (§5.1) + R11 (monotonía de capacidad) | **más**: R11 afirma capacidad, no aritmética |
| «bloque cuadrado centrado, `offY` = 43,5 en A4» | `:54-93` | R9: la franja sin usar ≤ margen | **más**: aquello *certificaba* los 87 mm en blanco |
| «todas las constantes escalan con `s`» | `:95-137` | §5.1: dos escalas separadas | equivalente en rigor, distinto en contenido |
| «encaje en la página, offsets ≥ 0» | `:139-175` | **V3**, medido sobre el PDF | **más**: aritmética → tinta |
| «densidad del raster nunca baja» | `:177-190` | se **conserva**, con `k` en vez de `s` | igual |
| «el cupo es 10, el mismo en las cuatro hojas» | `etiquetas-maqueta.test.ts:94-99` | R11 + capacidad declarada (§6.2) | **más**: aquello certificaba el defecto |
| «los siete campos, sus rótulos y su orden, intactos» | `etiquetas-pdf.test.ts:625-648` | R17 (los nueve datos siguen) + R13 (orden nuevo) | distinto por mandato (282/R4 revisado) |
| «una etiqueta por página, nunca mosaico» | `etiquetas-pdf.test.ts:206-233` | **sigue vigente** salvo firma de Q1 | — |

## 12. Alternativas descartadas

1. **Parche mínimo: mantener el factor único y sólo bajar el cuerpo cuando
   desborde.** Es la opción barata y arregla el 6,3 % de recortes. **Descartada:**
   no da ni un carácter de capacidad —los cuatro tamaños seguirían siendo el
   mismo cuadrado— y A4 seguiría tirando 87 mm de papel. El humano pidió
   explícitamente «tener en cuenta todos los tamaños»; esto los deja idénticos.
2. **Página de continuación** cuando no cabe. **Descartada:** rompe «una etiqueta
   = una página», obliga a duplicar QR y código de barras (o a dejar una tira sin
   ellos, que es una etiqueta inútil) y en impresión térmica produce media
   etiqueta suelta que nadie sabe dónde pegar.
3. **Recortar con elipsis pero avisando en la UI.** **Descartada:** es
   exactamente lo que el humano prohibió, y además el aviso llegaría al operador
   que imprime, no a quien recibe el paquete con la dirección incompleta.
4. **Escalar cada eje por su propio factor** (estirar hasta llenar la hoja).
   **Descartada** y ya lo estaba en la 150 §3.1: deforma el QR y los módulos del
   CODE128 hasta que dejan de escanear. La ganancia de área no vale un código
   ilegible.
5. **Fuente condensada** para meter más caracteres por línea. **Descartada:**
   compra ~10 % de ancho a cambio de reabrir entera la sección de fuente de la
   282 —cobertura de 219 code points, peso declarado, `/FontFile2` ≤ 12 KB,
   procedencia, licencia OFL, script de regeneración— y de volver a verificar que
   el `₡` tiene contorno no vacío. Quitar la columna de rótulos da **33 %** y ya
   está firmado.
6. **Tipografía fija en pt para todas las hojas** (sin crecimiento con `k`).
   **Descartada:** daría muchísima capacidad en A4, pero con letra de etiqueta de
   10 cm sobre una hoja de 21 × 29,7 cm — un papel visualmente vacío, que es la
   otra mitad de la queja del humano.
7. **Búsqueda binaria del cuerpo** en vez de descendente. **Descartada:** el
   corte de palabras no es monótono garantizado y una binaria sobre una función
   no monótona devuelve un resultado plausible y equivocado, que es el peor tipo
   de resultado. El coste de la lineal (≤ 56 iteraciones) se mide en T12.
8. **Dos maquetas, una por generador.** **Descartada** por la 282: ya divergió
   una vez y esa divergencia es el motivo por el que existe el módulo compartido.

## 13. Riesgos declarados

| Riesgo | Mitigación |
|---|---|
| El peor caso **no entra** en 100 × 100 con el suelo de 6 pt | T2 lo mide **antes** de fijar constantes; palancas ordenadas en §5.5; si se agotan, se para y se pregunta (Q2/Q3) |
| El ajuste iterativo encarece el lote y rompe el presupuesto de la 282/R24 (`(18 ms + f) × N ≤ 36 000 ms`) | T12 lo mide en los dos modos (consolidado e individual). Mitigación disponible pero **no aplicada de antemano**: arrancar la búsqueda por estimación de área y refinar |
| El rediseño cambia el PDF que reciben los **integradores** por API | **Q4**: medir la audiencia antes de decidir si hay que avisar |
| Se sustituyen ~190 líneas de aserciones vivas de la 150 | §11 lo declara fila a fila con el veredicto de fuerza. Ninguna se borra sin sustituto |
| La vista previa queda mintiendo sobre el papel | **Q5** decide si entra; si no entra, se declara como deuda con fecha |
