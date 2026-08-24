# Feature 223 — Diseño

Decisiones técnicas de «el flujo de impresión de la factura del cierre». Cubre R1-R33 de
`requirements.md`.

> **Versión 2 — 2026-08-14, después de la puerta humana.** Las siete preguntas están cerradas
> (D1-D7) y **plegadas al articulado**. El cambio profundo respecto de la v1 es **D5**: la
> hoja compacta pasa a ser imprimible como documento propio, y eso obliga a inventar el
> mecanismo del **§3** —candidata + elegida— y a renombrar la clase, porque la de la v1
> (`solo-esto-al-imprimir`) afirmaba algo que con esta decisión es falso: hay N candidatas.

> **La 217 puso el color; ésta pone el formato.** No se rehace nada de la 217 ni de la 221:
> este bloque **convive** con los suyos y su sitio dentro de `app/globals.css` es parte del
> diseño, no cosmética (§2.1).

---

## 0. Qué NO aplica de la plantilla, y por qué

`docs/specs.md` pide modelo de datos, endpoints, contratos I/O e integraciones. Aquí **no hay
ninguno de los cuatro**, y se declara en vez de omitirse:

| Sección | Estado |
| --- | --- |
| Tablas, RLS, migraciones | **No aplica.** Esta feature no lee ni escribe un solo dato; `db/` no se toca. |
| Rutas / endpoints | **No aplica.** Ninguna ruta, ningún route handler, ninguna Server Action. |
| Contratos de entrada/salida | **No cambian.** `CierreFacturaDetalleProps` (`:719`), `CierreFacturaResumenProps` (`:385`) y `CierreFacturaCabecera` (`:685`) quedan idénticos. |
| Integraciones externas | **Ninguna.** |

Lo que sí hay: **una regla de medio**, **una clase de candidatura**, **una lista cerrada de
piezas que no se parten**, y **un parser de CSS que pasa a ser compartido**.

### Archivos que se tocan (inventario CERRADO)

| Archivo | Qué le pasa | Requisitos |
| --- | --- | --- |
| `tests/fixtures/css-reglas.ts` **(nuevo)** | `reglasDe` / `selectoresDe` / `declaracionesDe`, extraídos de la guardia del tema | R32 |
| `tests/unit/guards/tema-encendido.guardia.test.ts` | Consume el fixture; **anclajes NO posicionales**; **REEXPRESA** el caso «nada de `@page`» | R24, R28, R32 |
| `tests/unit/guards/impresion-sin-dark.guardia.test.ts` | Su caso `:184` deja de anclar por posición | R24 |
| `app/globals.css` | **Bloque `@media print` nuevo** (después del de la 217, antes de `.dark`) + reescribir la prosa de `:281-287` | R1-R3, R6-R8, R10-R21, R23-R26, R28 |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | Marca de candidatura en las **dos** hojas (en la compacta, **condicionada a `open`**); `break-inside-avoid` en la lista cerrada; prosa de `:111-117`; límite del KPI | R5, R19, R20, R28, R29 |
| `tests/unit/guards/impresion-flujo.guardia.test.ts` **(nueva)** | Censo del CSS + censo del `.tsx` + censo de los dos módulos | R1-R3, R5-R8, R10-R21, R23-R26 |
| `tests/components/CierreFacturaPapel.test.tsx` | Candidatura en jsdom (incluida la **compacta al desplegarse**), `break-inside-avoid`, forma del DOM que la regla supone, `role="dialog"` | R5, R6, R9, R19 |
| `progress/impl_223.md` **(nuevo)** | Mapa R→test, bitácora de mutaciones **con su variante inocua**, evidencia manual fechada | R31, R33 |

**No se tocan:** `components/shared/Modal.tsx`, `components/ui/card.tsx`,
`CierresAdminModule.tsx`, `CierreDiaModule.tsx`. Que el arreglo **no** aterrice en ninguno de
los cuatro es una propiedad del diseño (§4.2), no una casualidad — y es la respuesta a C1: se
atacan **las capas**, no el `:822`.

---

## 1. La forma del cambio, en una frase

Hoy la hoja es **un trozo de una página** que se imprime entera y recortada. Después, la hoja
**es la página**: se marca como candidata cuando está completa, el contexto decide cuál de
las candidatas es el documento, todo lo demás desaparece, la cadena de ancestros deja de
recortarla y `@page` dice con cuánto margen cae en el papel. No hay JavaScript, no hay botón,
no hay estado nuevo: la única entrada sigue siendo `Ctrl+P` (D1).

---

## 2. Dónde vive el bloque, y cómo se llama la clase

### 2.1 El sitio: **después** del bloque de la 217 y **antes** de `.dark`

```
:root, .tema-claro { … }                                  (:194)
@media print { .papel-al-imprimir { …tokens claros… } }    ← 217 (:295)
@media print { …EL FLUJO… }                                ← 223 (NUEVO)
.dark, body:has(> .dark) { … }                             (:352)
```

1. **Antes de `.dark`**, como el de la 217, por la trampa del lector de tokens
   (`tests/fixtures/contraste.ts:93-126`). El bloque nuevo **no declara tokens** (R25), así que
   hoy no podría envenenar nada; se coloca ahí igual porque el día que alguien declare uno la
   segunda defensa ya está puesta.
2. **Después del de la 217**, para no mover un ancla mientras se cambia el archivo. Pero eso
   **ya no es la defensa** (C3): la defensa es que **los anclajes dejen de ser posicionales**
   (R24, §8). Con anclajes por contenido, el orden entre los dos bloques deja de poder mentir;
   se conserva igualmente porque un diff pequeño es más fácil de revisar que uno que reordena.

Y se clava el invariante (R24): **exactamente dos** `@media print` en el archivo, los **dos**
antes de `.dark`. Un tercero, o uno detrás, es rojo.

### 2.2 La clase: `hoja-imprimible`, y por qué cambió de nombre

**Decisión: una clase propia, `hoja-imprimible`, que marca una hoja como CANDIDATA.** Va en el
`<Card>` de `HojaFactura` (`:306-310`) **siempre**, y en el de `HojaResumen` (`:496-500`)
**sólo cuando su desglose está desplegado** (§3.1).

- **No se reusa `.papel-al-imprimir`** (R23): significa otra cosa —«aquí dentro los tokens son
  los claros»—, vale para las dos hojas **siempre**, y hay una guardia que exige **exactamente
  una** regla con ese selector y compara sus declaraciones `toEqual` con `.tema-claro`
  (`tema-encendido.guardia.test.ts:100-104,213-220`). Añadirle disposición la pondría roja sin
  que nada estuviera mal.
- **El nombre de la v1 (`solo-esto-al-imprimir`) se cae con la D5.** Era correcto cuando había
  una sola raíz de impresión; con la hoja compacta dentro hay **N candidatas** y «sólo esto»
  sería falso. `hoja-imprimible` dice exactamente lo que la clase significa ahora: *esta hoja
  puede ir al papel*. Cuál de ellas va **no lo dice la clase, lo dice el contexto** (§3.2).
- Descartados: `hoja-al-imprimir` (se confunde con `papel-al-imprimir` de un vistazo — el
  motivo por el que la 217 descartó `tema-claro-impreso`), `raiz-de-impresion` (jerga de árbol,
  y además ya no es una sola).

---

## 3. La hoja elegida — el mecanismo de la D5

> Aquí se contesta lo que la puerta exigió: **qué distingue la hoja que el usuario quiere de
> las otras N que están en el DOM**, y **qué pasa con cero y con más de una**.

### 3.1 CANDIDATA — la marca, y por qué la compacta la lleva condicionada (R5)

El desglose de la hoja compacta —métodos, ajustes y fechas— se monta con `{open ? … : null}`
(`cierre-factura.tsx:580-622`). **Plegada, esa hoja no es un documento: le faltan tres
bloques.** Así que la marca es condicional:

```tsx
// HojaResumen
<Card className={cn("papel-al-imprimir …", open && "hoja-imprimible")} …>
```

Esto no es un truco para poder seleccionar una: es **la misma regla que R22** —«lo que no está
en el DOM no se imprime»— aplicada a la compacta. Una hoja plegada no puede ser un comprobante
porque le falta la mitad de los datos, y por eso no compite.

Y de rebote resuelve la designación **sin inventar un gesto nuevo**: desplegar el desglose ya
es el acto por el que alguien dice «esta me interesa», y ya existía.

### 3.2 ELEGIDA — manda el contexto: el diálogo gana (R6)

Dos niveles, evaluados en orden:

| | Cuándo | Quién es el documento |
| --- | --- | --- |
| **Nivel 1** | Hay una candidata **dentro de un diálogo** (`[role="dialog"]`) | **Sólo esa.** Todo lo de fuera —incluidas las N candidatas de la página— desaparece. |
| **Nivel 2** | No hay ninguna candidata dentro de un diálogo | **Todas** las candidatas del documento, cada una en su página (§3.4). |

**Por qué el diálogo y no otra cosa:** un diálogo modal es, por definición, lo único con lo que
el usuario está interactuando; el resto de la página está detrás de un backdrop y fuera del
foco. **No hay que pedirle al usuario que designe nada: ya lo hizo al abrirlo.** Y es lo que
disuelve la objeción que sostenía la exclusión de la v1: imprimir el detalle **no** puede
arrastrar las N hojas de detrás, porque el nivel 1 las poda por su ancestro.

**El anclaje es `[role="dialog"]`, y se verifica** (R9): lo usan ya los tests existentes para
localizar el popup (`OrdenesListadoEtiquetasChain.test.tsx:187-189`) y `Modal.tsx:249` le añade
`aria-modal="true"`. Un caso propio lo congela: si Base UI dejara de exponerlo, el nivel 1
dejaría de aplicar **en silencio** y volveríamos a imprimir las N.

### 3.3 Los dos casos que rompen, contestados

| Caso | Qué pasa | Por qué es la respuesta correcta |
| --- | --- | --- |
| **CERO candidatas** (lista del admin sin nada desplegado y sin modal) | **No se oculta nada**: la página imprime como hoy (R7, R2) | Es el mismo `:has()` de guarda que impide que cualquier página del portal salga en blanco. La ausencia de documento no puede convertirse en un documento vacío. |
| **VARIAS candidatas, sin diálogo** (el admin despliega tres compactas) | **Se imprimen las tres**, cada una empezando en página nueva (R8) | Desplegar es un acto deliberado y repetido; desplegar tres es pedir tres comprobantes. Cualquier desempate («la primera», «la última») sería arbitrario e invisible. |
| **VARIAS candidatas, con diálogo** | Gana la del diálogo; las demás desaparecen (R6 nivel 1) | Es la objeción original de la v1, resuelta. |
| **VARIAS candidatas DENTRO de un diálogo** | **No ocurre hoy**, y queda congelado: cada `Modal` que monta una hoja monta exactamente una (R9) | Si algún día ocurriera, el nivel 1 no sabría cuál elegir. Mejor rojo que una elección silenciosa. |

### 3.4 El CSS

```css
@media print {
  @page { size: portrait; margin: 12mm; }

  /* (B) LA CADENA que lleva a una candidata deja de recortar, de flotar y de acolchar.
         Va ANTES de (A) a propósito: si un elemento cayera en las dos, manda ocultar. */
  body:has(.hoja-imprimible),
  body:has(.hoja-imprimible) *:has(.hoja-imprimible) {
    display: block;
    position: static;
    inset: auto;
    transform: none;
    overflow: visible;
    max-height: none;
    height: auto;
    width: auto;
    max-width: none !important;   /* ÚNICO !important — §4.4 */
    margin: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
    background: none;
  }

  /* (A) NADA que no lleve a la ELEGIDA llega al papel. */

  /* A.1 — NIVEL 1, fuera del diálogo: se poda todo lo que no lleva al diálogo. */
  body:has([role="dialog"] .hoja-imprimible) > *:not(:has([role="dialog"] .hoja-imprimible)),
  body:has([role="dialog"] .hoja-imprimible)
    *:has([role="dialog"] .hoja-imprimible) > *:not(:has([role="dialog"] .hoja-imprimible)),

  /* A.2 — NIVEL 1, dentro del diálogo: se poda todo lo que no lleva a la hoja. */
  body:has([role="dialog"] .hoja-imprimible)
    :is([role="dialog"], [role="dialog"] *):has(.hoja-imprimible)
    > *:not(:has(.hoja-imprimible)):not(.hoja-imprimible),

  /* A.3 — NIVEL 2: sin candidata en un diálogo, cada candidata es un documento. */
  body:not(:has([role="dialog"] .hoja-imprimible)):has(.hoja-imprimible)
    > *:not(:has(.hoja-imprimible)):not(.hoja-imprimible),
  body:not(:has([role="dialog"] .hoja-imprimible)):has(.hoja-imprimible)
    *:has(.hoja-imprimible) > *:not(:has(.hoja-imprimible)):not(.hoja-imprimible) {
    display: none;
  }

  /* (C) La hoja: su propio recorte fuera (las DOS `<Card>` traen `overflow-hidden`). */
  .hoja-imprimible { overflow: visible; box-shadow: none; }

  /* (D) Una hoja por página (R8). Las compactas son hermanas en la rejilla del admin,
         y sólo llevan la marca las desplegadas, así que `~` cuenta candidatas. */
  .hoja-imprimible ~ .hoja-imprimible { break-before: page; }
}
```

**Tres propiedades de esta escritura, y las tres son deliberadas:**

1. **Dentro de todos los `:not()` sólo hay selectores SIMPLES** (`:has(…)`, que es una
   pseudo-clase, o una clase). Nada de `:not(.a[b])` ni de `:not(a b)`: hay motores que
   soportan `:has()` y no soportan `:not()` con compuestos o complejos. Se escribe para el
   suelo, no para el techo.
2. **(B) va antes que (A)** (R14). El único elemento que puede caer en las dos reglas es un
   ancestro que contiene candidatas **pero no la elegida** —el envoltorio de la app cuando el
   documento está en un diálogo—. Ahí tiene que ganar `display: none`. Gana por dos vías: por
   **especificidad** (A.1 pesa (0,4,1) frente a (0,2,1) de B) y por **orden**. Se escribe
   apoyándose en las dos, y el censo lo comprueba (§6.2).
3. **Degradación**: si un motor no soportara `:has()`, ninguna regla engancha y el resultado es
   **el de hoy** (se imprime todo, recortado). Feo, pero nunca una página en blanco. Esa
   asimetría es la que hace aceptable la apuesta — y `:has()` **ya es una dependencia viva del
   repo**: sin `body:has(> .dark)` (`globals.css:353`) el tema deja una franja clara.

### 3.5 Alternativas de elección que se descartaron

**a) Marcar todas las compactas siempre y aceptar que se impriman las N.** Es la lectura
perezosa de la D5. Descartada: quien pulsa `Ctrl+P` en la lista del histórico querría imprimir
**la lista**, y se llevaría 40 comprobantes. Un cambio de comportamiento caro (papel) y
silencioso.

**b) Elegir por `inert` / `aria-hidden` del contenido de detrás del modal.** Semánticamente es
lo más limpio —«lo que el diálogo declara inerte no es lo que el usuario mira»—, pero **depende
de un detalle interno de `@base-ui/react` que no se pudo verificar** (`node_modules` no era
legible) y **degrada en silencio**: el día que la librería cambie de técnica, volveríamos a
imprimir las N sin que nada se pusiera rojo. `[role="dialog"]` es contrato público, lo usan ya
los tests, y R9 lo congela.

**c) Elegir por `:focus-within` o por el último clic.** El foco al pulsar `Ctrl+P` es un estado
invisible y no intencional; imprimir dependería de dónde quedó el cursor. Es la clase de regla
que nadie puede explicar cuando falla.

**d) Un atributo `data-hoja-desplegada` en vez de la clase condicional.** Equivalente en
comportamiento. Descartada por poco: estrena una convención `data-*` de presentación que este
repo no usa, y la clase condicional se censa con el mismo mecanismo que ya vigila
`papel-al-imprimir`. *(Si algún día hubiera dos disclosures dentro de la compacta, esta
decisión hay que releerla: hoy hay una sola, y el censo lo congela — §6.3.)*

**e) Un botón «Imprimir esta hoja» en cada compacta.** Resuelve la designación de forma
explícita y **reabre la D8/D1**. Descartada por la puerta, dos veces.

---

## 4. El recorte y el modal

### 4.1 Lista blanca, no lista negra — y su modo de fallo, declarado

| | Cómo falla |
| --- | --- |
| **Lista negra** (enumerar lo que se esconde: sidebar, header, modal, backdrop…) | **Se queda corta con cada pieza nueva.** Un componente añadido mañana se imprime y nadie se entera hasta que mira un papel. Fallo **silencioso y creciente**. |
| **Lista blanca** (esconder todo menos la elegida y su cadena) | **Puede tragarse algo que sí debía salir.** Fallo **inmediato y visible**: falta algo que estaba. |

**Se elige la lista blanca (R3)**: el fallo de la negra crece solo; el de la blanca se ve la
primera vez que alguien imprime. Es además el patrón que este repo ya eligió dos veces
(inventarios CERRADOS de la 217). Y la negra **ni siquiera se puede escribir bien aquí**: la
hoja del detalle vive en un `Dialog.Portal` (H4), así que «lo que hay fuera» incluye lo que
monten otros portales en el futuro.

**La contramedida al modo de fallo de la blanca es R4**: lo que deja de imprimirse va
enumerado **en el código**, con su ancla.

| Pieza que deja de salir | Ancla | ¿Correcto que no salga? |
| --- | --- | --- |
| Título, descripción y botones del diálogo | `Modal.tsx:263-272`, `:278-308` | Sí: son controles, no documento. |
| Fondo oscuro del diálogo | `Modal.tsx:244-247` | Sí — y con «gráficos de fondo» activado hoy imprimiría un rectángulo negro sobre todo. |
| Sección de pago al mensajero | `CierresAdminModule.tsx:844` | Sí: acción del admin, no parte del comprobante. |
| Botonera Aprobar / Rechazar | `CierresAdminModule.tsx:859` | Sí: ídem. |
| Nota «solo lectura» del mensajero | `CierreDiaModule.tsx:747` | Sí, y es la más discutible: es texto de la pantalla, no del comprobante. Queda declarada por eso. |
| Barra lateral y cabecera del portal | `(app)/layout.tsx:47,64` | Sí. |
| **Las N hojas compactas de detrás, al imprimir el detalle** | `CierresAdminModule.tsx:747-794` | Sí — es exactamente lo que el nivel 1 de R6 viene a garantizar. |

### 4.2 Qué neutraliza cada declaración de (B) — y por qué no hay que tocar cuatro archivos

| Declaración | A quién le quita qué |
| --- | --- |
| `overflow: visible` | `div.overflow-auto` de `Modal.tsx:275`, `div.max-h-[70vh].overflow-y-auto` de `CierresAdminModule.tsx:822`, y cualquier `overflow-hidden` de un ancestro |
| `max-height` / `height` | `max-h-[calc(100dvh-2rem)]` del popup (`Modal.tsx:258`) y `max-h-[70vh]` del módulo |
| `position: static` + `inset: auto` | `fixed top-1/2 left-1/2` del popup: un elemento fijo no fluye por las páginas |
| `transform: none` | `-translate-x-1/2 -translate-y-1/2` del popup (que además crea bloque contenedor) |
| `width` / `max-width` | `w-[calc(100%-2rem)]` (clase) y `maxWidth: "75%"` (**estilo en línea**, §4.4) |
| `padding` / `border` / `box-shadow` / `background` | `p-6 border rounded-lg shadow-lg bg-background` del popup: adornos de pantalla que en papel son ruido |
| `display: block` | saca de la ruta de fragmentación tres contenedores flex; seguro **porque R1 lo hace seguro**: tras (A) cada ancestro tiene exactamente **un** hijo visible |

**Respuesta a C1:** ninguna declaración nombra un contenedor. La ruta del admin tiene un
recortador más que la del mensajero y la regla no se entera: recorre la cadena, sea cual sea.
Un parche `print:overflow-visible` sobre `CierresAdminModule.tsx:822` —la lectura literal del
encargo— **no habría arreglado ninguna de las dos**, porque el recorte sobrevive en
`Modal.tsx:275`, en el `max-h` + `fixed` del popup y en el `overflow-hidden` del `Card`.

### 4.3 Por qué no `visibility: hidden`

Conserva la caja: el resultado son páginas en blanco delante de la hoja. Y la variante
«`visibility` + `position: absolute` sobre la hoja» saca del flujo justo lo que hay que
paginar.

### 4.4 Los estilos en línea, y el único `!important` (R13)

`Modal.tsx:253-256` escribe `style={{ minWidth: "300px", maxWidth: size }}`, y el detalle del
admin usa el `size` por defecto, `"75%"` (`Modal.tsx:108`). Un estilo en línea sólo se vence
con `!important`: sin él la hoja saldría al 75 % del ancho de la página. Por eso
`max-width: none !important`, y **sólo ése**: el resto gana por la cascada de capas (H8) y un
`!important` de más es un martillo que rompe futuras excepciones legítimas. `min-width: 300px`
se deja: a 12 mm de margen el ancho útil es ~186 mm ≈ 700 px, así que no muerde.

> **MEDICIÓN PENDIENTE, y es la única incógnita técnica del diseño.** Los diálogos suelen
> bloquear el scroll escribiendo `overflow: hidden` **en línea** sobre `<html>` o `<body>`. Si
> `@base-ui/react` lo hace, `overflow: visible` de (B) **pierde** y la hoja vuelve a salir
> recortada — un fallo que el censo del CSS **no vería**, porque la declaración estaría
> escrita. Se mide en jsdom con el modal abierto (T4) leyendo `document.body.style` y
> `document.documentElement.style`; si aparece, `overflow` entra en la lista de `!important` de
> R13 con su motivo, y la lista queda congelada por la guardia. No se añade «por si acaso»: se
> mide y se declara.

---

## 5. `@page`

```css
@page {
  size: portrait;   /* D2: sin nombre de papel */
  margin: 12mm;     /* D3 */
}
```

### 5.1 Dentro de `@media print`, y no suelto

(a) Todo el flujo queda en **un** bloque que una sola guardia lee; (b)
`quitarBloquesDeImpresion()` (`tests/fixtures/contraste.ts:127`) borra las at-rules que nombran
`print` antes de leer los tokens: dentro del bloque, el `@page` desaparece del lector; suelto,
sobreviviría. Hoy es inocuo (no declara tokens), pero el sitio correcto es el que **sigue**
siendo correcto cuando alguien añada algo.

### 5.2 Tamaño: **sin nombre de papel** *(D2)*

- **El repo no dice qué papel usa la oficina.** Lo único parecido es
  `lib/config/etiquetas-hoja.ts`, que ofrece A4 y Carta pero cuyo default es `100×100 mm`
  térmico: es el catálogo de **etiquetas**. Elegir aquí sería inventarlo.
- **Forzar un papel que no es el cargado tiene precio**: el navegador reescala y el texto sale
  más pequeño de lo diseñado. La puerta lo cerró así: **se respeta lo que el usuario tenga
  configurado**.
- **La orientación sí se declara**, y no es adorno: el comprobante es un documento alto. Si el
  diálogo hubiera quedado en apaisado por el trabajo anterior, saldrían más saltos de página y
  un ancho absurdo. Si un motor no soportara `size: portrait`, la orientación la sigue poniendo
  el diálogo, **que viene en vertical por defecto**: el fallo es inocuo. Qué motores lo soportan
  **no está medido en este repo** y no se afirma (R33).

### 5.3 Margen: **12 mm** *(D3)*, y de dónde sale el número

1. **Suelo físico:** las impresoras de oficina tienen un borde no imprimible del orden de
   3-5 mm. Por debajo se pierde texto, y quien lo escribe no lo ve porque su impresora es otra.
2. **Techo útil:** con 12 mm por lado quedan **186 mm** de ancho en A4 (210−24) y **191,9 mm**
   en Carta (215,9−24). Se diseña contra **el más estrecho de los dos**, así que el mismo
   margen sirve para los dos papeles sin tener que decidir cuál es (§5.2). El interior de la
   hoja es fluido (rejillas `1.4fr 1fr 1fr`) y se adapta al ancho que le den.
3. **No se duplica el aire:** la hoja ya trae su `p-5` (20 px ≈ 5,3 mm, `:312`).
4. **Vive en un solo sitio** (D3): cambiarlo mañana es **una línea**, y la guardia congela el
   valor nuevo.

### 5.4 Lo que `@page` **no** controla, escrito junto a la regla (R17)

- El **encabezado y el pie del navegador** (URL, fecha, «1/3»): los pone el diálogo y **no hay
  CSS que los quite**.
- La **escala** y la opción **«gráficos de fondo»**: del usuario. La segunda tiene un precio ya
  medido en otra ficha (`impresion-sin-dark.guardia.test.ts:381-397`).
- El **papel real**: manda el usuario (D2).

---

## 6. Paginación y verificación

### 6.1 Lo que se puede garantizar

- **Que la hoja se reparta y no se recorte (R18).** Es (B)+(C): con `overflow: visible` en la
  cadena y en la hoja ya no queda ningún contenedor de scroll en la ruta. *(La especificación
  de fragmentación trata a los contenedores de scroll como piezas indivisibles; eso, y no otra
  cosa, es lo que hoy convierte al `Card` con `overflow-hidden` y al modal con
  `overflow-y-auto` en el recorte de la ficha.)*
- **Que ciertas piezas no se partan (R19)**, con `break-inside: avoid` en una **lista CERRADA**:

| # | Pieza | Ancla | Por qué |
| --- | --- | --- | --- |
| 1 | Fila de una orden (`FilaGestion`) | `:913` | **La importante.** Se repite N veces y decide dónde caen los cortes; partida, deja la guía en una página y el monto en otra. |
| 2 | Bloque de renglones de liquidación | `BloqueRenglones` | Un renglón `concepto ….. monto` partido es ilegible. |
| 3 | Rejilla de KPI | `:249` | Bloque corto y cerrado. |
| 4 | Cabecera de la hoja | bloque marca/folio/estado | Es la identidad del comprobante. |
| 5 | Franja del pie | `:1317` | Corta y con el total: no debe quedar huérfana. |

  **Se estampa como utilidad (`break-inside-avoid`) y no como regla del bloque.**
  `break-inside` es inerte fuera de medios paginados, así que en pantalla no hace nada; a
  cambio queda **junto a la pieza que protege** y el test de jsdom puede afirmarlo sobre el
  elemento renderizado. *(Descartada: `data-corte` + regla en el bloque — §7-G.)*

- **Que no se aplique donde no cabe (R20).** Ni las hojas, ni la sección de órdenes (`:1272`),
  ni el panel de la pestaña (`:1287`), ni la cadena.
- **Una hoja por página cuando hay varias elegidas (R8)**, con `~` entre candidatas (§3.4-D).

### 6.2 Lo que NO se puede garantizar, y va escrito

| Qué | Por qué |
| --- | --- |
| **Cabeceras de columna repetidas por página** | La lista **no es una tabla** (H2): `:1288` es una rejilla de `<span>` hermana de las filas. `display: table-header-group` exigiría marcado de tabla y **desincronizaría las columnas** (cada fila es su propia rejilla). **R21.** |
| **Que se impriman las filas plegadas y las pestañas no visitadas** | No están en el DOM (H3). **R22 / D4.** |
| **Dónde cae cada corte y cuántas páginas salen** | Depende del motor, del papel, de la escala y de la fuente. |
| **Que un contenedor flex fragmente bien** | La ruta hasta la hoja pasa a bloque (R14), pero el **interior** de la hoja conserva su flex/grid y no se rediseña. Cómo fragmenta cada motor un flex **no está medido aquí**. |
| **Viudas y huérfanas** | `orphans`/`widows` sólo actúan sobre líneas y su soporte es desigual. |

### 6.3 El instrumento: un solo parser de reglas, compartido (R32)

`reglasDe` + `selectoresDe` + `declaracionesDe` (`tema-encendido.guardia.test.ts:34-95`) ya
devuelven, por regla, **sus selectores, sus ancestros (`@media`, `@layer`…) y sus
declaraciones**: exactamente lo que esta ficha necesita. Se extraen a
`tests/fixtures/css-reglas.ts` —patrón de `sin-comentarios.ts` (209) y `contraste.ts` (217)— y
la guardia del tema pasa a consumirlo **sin que ninguno de sus casos cambie de nombre ni de
aserción**. El fixture lee con `codigoSinComentarios` (R30): aquí el riesgo de censar prosa es
máximo, porque `globals.css:281-287` nombra hoy `@page`, `márgenes` y `overflow-y-auto` en una
sola frase.

### 6.4 Censo del CSS — `tests/unit/guards/impresion-flujo.guardia.test.ts`

| Aserción | Requisito |
| --- | --- |
| Existe **exactamente una** `@page`, con `margin: 12mm` y `size` con orientación **y sin nombre de papel**, y sus ancestros contienen `@media print` | R15, R16 |
| **Toda** regla de ocultamiento lleva, en **todos** sus selectores, una guarda `:has(…hoja-imprimible)` a nivel de `body` | **R2, R7** |
| Existe la rama de **nivel 1** anclada en `[role="dialog"] .hoja-imprimible` **y** la de **nivel 2** anclada en `:not(:has([role="dialog"] .hoja-imprimible))` | **R6** |
| Ningún `:not()` del bloque contiene un selector compuesto o complejo | §3.4-1 |
| Ningún selector del bloque nombra un componente del portal (`sidebar`, `header`, `modal`, `backdrop`, `toast`) | R3 |
| La regla de la cadena declara **las 13** propiedades de la lista cerrada | R10, R14 |
| La regla que declara `display: none` aparece **después** de la que declara `display: block` | **R14** |
| El bloque tiene **exactamente** los `!important` de la lista declarada (hoy `max-width`; §4.4 puede añadir `overflow`) | R13 |
| Existe la regla `~` entre candidatas con `break-before: page` | R8 |
| El bloque **no declara ninguna** propiedad `--…` | R25 |
| Los ancestros del bloque son `@media print` y **ningún `@layer`** | R26 |
| En el archivo hay **exactamente dos** `@media print` y los **dos** van antes de `.dark` | R24 |
| La regla `.papel-al-imprimir` sigue siendo **una sola** y `toEqual` a `.tema-claro` *(casos de la 217, verdes sin tocarse)* | R23 |
| Junto al bloque hay un comentario que declara lo que `@page` no controla y el límite de las cabeceras repetidas | R17, R21 |

### 6.5 Censo del `.tsx` — misma guardia

Con `codigoSinComentarios` (R30), sobre `cierre-factura.tsx`:

| Aserción | Requisito |
| --- | --- |
| `hoja-imprimible` aparece **exactamente dos veces**: una en el `<Card>` de `HojaFactura` **sin condición**, otra en el de `HojaResumen` **dentro de una condición sobre `open`** | **R5** |
| Dentro de `HojaResumen` hay **exactamente un** `aria-expanded` *(congela el supuesto de §3.5-d: hoy su único disclosure es el suyo)* | R5 |
| Las **2** apariciones de `papel-al-imprimir` siguen ahí, una por `<Card>` *(caso de la 217, verde sin tocarse)* | R23 |
| `break-inside-avoid` aparece **exactamente N veces**, y cada una en una de las **5** piezas de §6.1 | R19 |
| **Cero** `break-inside-avoid` en la apertura de los dos `<Card>`, en la sección de órdenes (`:1272`) y en el panel de la pestaña (`:1287`) | R20 |
| Siguen en **cero** `window.print` y el rótulo `Imprimir` *(casos de la 217, verdes sin tocarse)* | R27 |
| La prosa `:111-117` ya **no** afirma que no hay `@page` ni ocultamiento; y junto a `KpiFactura` está escrito el límite de la cifra animada | R28, R29 |

Y sobre los dos módulos y el `Modal` (R12): `CierresAdminModule.tsx` conserva `max-h-[70vh]` y
`overflow-y-auto`; `Modal.tsx` conserva `overflow-auto`; **ninguno de los tres** estrena
utilidades `print:`.

### 6.6 jsdom — lo que sí puede probar, y lo que no

jsdom no compone estilos, no resuelve `@media print` ni `:has()` y no pagina. Pero **sí puede
probar dos cosas que ningún censo de texto alcanza**, y las dos son el corazón de la D5:

1. **Que la candidatura se comporta.** Renderizar la hoja compacta plegada → **no** lleva
   `hoja-imprimible`; desplegarla con el toggle → **sí** la lleva. Es la regla R5 ejecutándose
   de verdad, no una cadena en un archivo.
2. **Que el DOM tiene la forma que la regla supone.** Con el modal del detalle abierto y una
   compacta desplegada detrás: (a) el popup expone `role="dialog"` (R9); (b) dentro del diálogo
   hay **exactamente una** candidata (R9); (c) hay ≥1 candidata **fuera** del diálogo; (d) la
   de dentro **no** es descendiente de la de fuera. Si (b) o (d) dejaran de cumplirse, la regla
   de elección habría dejado de significar lo que dice.

Y lo que **no** prueba, dicho en el propio archivo (R33): **no prueba que la regla elija bien**
—eso lo decide un motor de impresión, y aquí no hay ninguno—; prueba que **el DOM es el que la
regla supone** y que la marca aparece cuando debe.

Las hojas se localizan por `role="region"` + `aria-label`, **nunca por la clase que se
comprueba**, salvo cuando la clase **es** el sujeto (la cuenta de candidatas), donde se dice.

### 6.7 Mutaciones obligatorias — cada una con su VARIANTE INOCUA (R31)

La columna de la derecha es la aportación de esta ficha al método: **la 217 descubrió que un
bloque colocado donde no sirve puede pasar por bueno**. **Las dos columnas deben ponerse
rojas.**

| # | Mutación | Variante INOCUA (también debe ser roja) | Guardia |
| --- | --- | --- | --- |
| 1 | Borrar el bloque entero | Dejarlo, pero **fuera de `@media print`** | §6.4 (ancestros) |
| 2 | Quitar la guarda `:has()` de una regla de ocultamiento | Dejarla **sólo en el primero** de sus selectores | §6.4 (**el caso que evita la página en blanco**) |
| 3 | **Borrar el `:not(:has([role="dialog"] …))` del nivel 2** → se imprimirían las N de detrás | **Sustituirlo por `:not(:has(.hoja-imprimible))`**, que hace que el nivel 2 no aplique nunca: la regla existe, está escrita y **elige la hoja equivocada** | §6.4 (**R6**) |
| 4 | Borrar la rama de nivel 1 | Anclarla en `[role="alertdialog"]`, que no existe en este repo | §6.4 (R6) |
| 5 | Quitar la condición `open &&` de la marca de la compacta | Marcarla con `open === false` | §6.5 + §6.6 (R5) |
| 6 | Quitar `overflow: visible` de la cadena | Escribirlo **en el comentario** de encima | §6.4 + R30 |
| 7 | Quitar `position: static` | Ponerlo en la regla de la hoja (C) en vez de en la cadena (B), donde no sirve | §6.4 |
| 8 | Borrar el `@page` | Escribir `@page` **dentro de un comentario** | §6.4 + R30 |
| 9 | Poner `margin: 0` | Poner `margin: 1px` | §6.4 (R16) |
| 10 | Poner `size: A4 portrait` | Poner `size: 21cm 29.7cm` | §6.4 (R15) |
| 11 | Anidar el bloque en `@layer utilities` | Anidarlo en `@layer` a secas | §6.4 (R26) |
| 12 | Declarar `--foo: #fff` dentro del bloque | Declararlo dentro del `@page` | §6.4 (R25) |
| 13 | Mover el bloque **delante** del de la 217 | Añadir un **tercer** `@media print` vacío al final del archivo | §6.4 (R24) |
| 14 | Poner la regla (A) **antes** de la (B) | Igualar sus especificidades dejando (A) después | §6.4 (R14) |
| 15 | Quitar la marca de `HojaFactura` | Estamparla en un `<div>` interior en vez de en el `<Card>` | §6.5 + §6.6 (R5) |
| 16 | Quitar `break-inside-avoid` de la fila | Ponerlo **también** en la sección de órdenes | §6.5 (R19, R20) |
| 17 | Quitar el `!important` de `max-width` | Añadir `!important` a **todas** las declaraciones | §6.4 (R13) |
| 18 | «Arreglar» el recorte borrando `overflow-y-auto` de `CierresAdminModule.tsx:822` | Borrar el `overflow-auto` de `Modal.tsx:275` | §6.5 (R12) |
| 19 | Montar dos hojas dentro del mismo `Modal` | Quitar el `role="dialog"` del popup | §6.6 (R9) |

Cada resultado se anota en `progress/impl_223.md`. **Una guardia que nadie vio morder no es
evidencia**, y una que sólo muerde la mutación obvia tampoco.

### 6.8 Lo que NO queda verificado por el gate, dicho por delante *(D7 — R33)*

- **El papel.** Ninguna pieza del gate imprime. Lo verificado es que la regla existe, dónde
  vive, qué declara, qué no declara y qué forma tiene el DOM. Es **estructural**.
- **Que la regla de elección elija bien** en un motor real: se sostiene sobre `:has()`,
  `[role="dialog"]` y la cascada, y ninguna de las tres se evalúa en el gate.
- **Que `@page`, `size: portrait` y la fragmentación se comporten** como aquí se razona en
  cada motor.
- **Dónde caen los cortes** y cuántas páginas salen.
- **La fragmentación del interior flex de la hoja** (§6.2).
- **La cifra del KPI** en el instante de imprimir (R29).

**El complemento, y es lo único que se promete (D7):** **UNA** comprobación **manual y
fechada** en al menos un motor real, con su alcance escrito y su salida en
`progress/impl_223.md`, **declarada fuera del gate**. Es el precedente exacto de la 221, que
comprobó a mano y una vez cómo compila Tailwind su variant
(`impresion-sin-dark.guardia.test.ts:25-26`). **No se promete ningún E2E**: `@playwright/test`
está instalado y hay 19 `e2e/*.spec.ts`, pero **el gate no los corre** (`init.sh`,
`docs/verification.md`).

---

## 7. Alternativas descartadas (del resto del diseño)

**A. Parchear el `overflow-y-auto` de `CierresAdminModule.tsx:822` con utilidades `print:`.**
Es la lectura literal del encargo y **no arregla ninguna de las dos rutas** (C1/H1). Además
habría que repetirlo en cada modal que algún día monte la hoja.

**B. Quitar el `max-h`/`overflow` del modal.** Arregla el papel rompiendo la pantalla. Lo
prohíbe R12 y lo caza la mutación 18.

**C. Lista negra.** §4.1: falla hacia el silencio y aquí ni siquiera se puede escribir bien.

**D. `visibility: hidden` (+ `position: absolute`).** §4.3.

**E. Una vista de impresión propia (`/cierres/<id>/imprimir`).** La solución «de libro».
Descartada **en esta ficha**, no para siempre: (1) es una ruta nueva con permisos, carga de
datos y superficie de tests propia —deja de ser presentación—; (2) obliga a un botón, lo que
reabre la D1 por la puerta de atrás; (3) duplica el comprobante en dos sitios. Si algún día se
quiere PDF de servidor, es por ahí, y esta ficha será su primera pieza igual que la 217 fue la
de ésta.

**F. `window.print()` con `onbeforeprint` desplegando filas y pestañas.** Resolvería la D4 de
verdad. Descartada: reabre una decisión humana tomada (D1), el estado de impresión por JS es
frágil —Safari y «guardar como PDF» no siempre disparan los dos eventos, `217/design.md §5-E`—
y mete estado en un componente presentacional.

**G. `break-inside: avoid` desde el bloque, con un atributo `data-corte`.** Concentra el flujo
en un sitio, pero estrena una convención que este repo no usa, deja la protección lejos de la
pieza que protege, y jsdom no podría afirmarla sobre el elemento.

**H. Una hoja de estilos aparte (`app/print.css`).** Misma razón que la 217 en su §5-F: la
mecánica vive entera en `globals.css` y **las guardias leen ese archivo**.

**I. Hacer que TODA la app imprima bien.** Excede el encargo, exige decidir el papel de quince
rutas y medirlas. Su precio conocido ya está declarado
(`impresion-sin-dark.guardia.test.ts:381-397`). Ficha propia.

---

## 8. Guardias y tests existentes que se mueven

| Archivo | Qué le pasa | Por qué |
| --- | --- | --- |
| `tema-encendido.guardia.test.ts:34-95` | El parser sale a `tests/fixtures/css-reglas.ts`; el archivo lo **consume** | R32. Ningún caso cambia de nombre ni de aserción. |
| `tema-encendido.guardia.test.ts:185,264,352` | **REEXPRESADOS: el ancla deja de ser posicional** (C3, R24) | Hoy localizan el bloque de la 217 como «el primer `@media print`». Pasan a localizarlo **por su contenido** —la regla que declara los tokens de `.papel-al-imprimir`—, de modo que añadir un bloque delante no pueda moverlos en silencio. |
| `tema-encendido.guardia.test.ts:331-339` | **REEXPRESADO** (C2, R28) | Dice «nada de `@page`… el formato de impresión es otra ficha, no ésta». **Ésta es esa ficha.** Se reescribe para seguir defendiendo lo que sigue siendo cierto: que el formato no se mezcla con el bloque de tokens de la 217 y que no aparece en un tercer sitio. **No se borra ni se relaja.** |
| `tema-encendido.guardia.test.ts:205,213,222` | **Sin cambios, y verdes** | R23: el bloque nuevo no reusa `.papel-al-imprimir`. |
| `impresion-sin-dark.guardia.test.ts:184` | **REEXPRESADO** (R24) | Compara posiciones de «cualquier at-rule con `print`» y «la regla `@media print` de la 217». Con tres at-rules que nombran `print`, su punto se refuerza — pero debe localizar el bloque de la 217 **por contenido**, no por ser el primero. |
| `factura-contraste.guardia.test.ts:251-273` | **Sin cambios, y verdes** | Las dos hojas siguen llevando `papel-al-imprimir`, y siguen sin botón ni `window.print` (D1, R27). |
| `CierreFacturaPapel.test.tsx:135-151` | **Sin cambios**; se le añaden casos | R23. |
| Inventario de pares de la 217 | **Sin cambios esperados** | Esta ficha no toca una sola utilidad de color. Si alguna se moviera, ese inventario se pondría rojo, y sería correcto. |

---

## 9. Riesgos y límites declarados

1. **El fallo más caro es la página en blanco.** Si una regla de ocultamiento perdiera su
   `:has()` de guarda, **cualquier** página del portal se imprimiría vacía y ninguna pantalla
   lo mostraría. Mutación propia y obligatoria (§6.7 #2).
2. **El segundo más caro es elegir la hoja equivocada** (D5): imprimir el detalle y llevarse
   además las N compactas. Mutación propia con su variante inocua (§6.7 #3).
3. **El scroll lock en línea (§4.4) es la única incógnita técnica**, y falla en verde: la
   declaración estaría escrita y perdería igual. Por eso se **mide** antes de escribir la lista
   de `!important`.
4. **La verificación no toca papel** (R33). El verde de esta feature significa «la regla dice
   lo que decidimos que dijera», no «la factura sale bien».
5. **Lo que no está en el DOM no sale** (D4/R22): el comprobante impreso muestra una pestaña y
   las filas plegadas.
6. **El KPI animado puede imprimir una cifra intermedia** (D6/R29): declarado junto a la pieza.
7. **`CierreBodegaFacturaResumen` no se monta hoy en `app/`** (H9): comparte `HojaResumen`, así
   que hereda la candidatura condicional el día que alguien lo monte — y eso es lo correcto.

---

## 10. Lo que sale a ficha aparte

| Qué | Por qué se separó | Dónde queda escrito |
| --- | --- | --- |
| **Vista de impresión propia / PDF de servidor** | Es una ruta con permisos, datos y tests propios; deja de ser presentación | §7-E |
| **Comprobante completo en papel** (las 5 pestañas y las filas desplegadas) | Exige cambiar qué se monta y probablemente disparar algo al imprimir; es decisión de producto | D4, R22 |
| **Que el resto del portal imprima bien** | Quince rutas sin medir; su precio conocido ya está declarado | §7-I |
| **La cifra exacta del KPI al imprimir** | Toca el DOM de la hoja, que el inventario cerrado de la 217 vigila | D6, R29 |
| **Harness de impresión en el gate** (Playwright + `page.pdf()`) | El gate no corre e2e; montarlo tiene coste propio | D7, §6.8 |
