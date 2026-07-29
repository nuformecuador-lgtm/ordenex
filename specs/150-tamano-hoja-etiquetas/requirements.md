# Feature 150 — Tamaño de hoja seleccionable en las etiquetas

> Requisitos en notación EARS. Cada `R<n>` es testeable y se mapea a un test
> concreto en `tasks.md` (§ Trazabilidad). Sin detalles de implementación: esos
> viven en `design.md`.

## Contexto (dado, no se reabre)

Hoy la etiqueta de guía es una página cuadrada de 100 × 100 mm fija en los dos
generadores: el de cliente `app/(app)/ordenes/_components/etiquetas-pdf.ts`
(feature 32, decisión F1.4 (c)) y el consolidado server-side
`lib/pdf/etiquetas-pdf-lote.ts` (feature 136, R2).

Decisiones cerradas con el humano ANTES de este spec (vinculantes):

- **D1** — Una etiqueta por página, **escalada**. Sin mosaico / N-up / grilla.
- **D2** — El tamaño se elige **en cada descarga**, con default 100 × 100 mm.
  Sin persistencia de ningún tipo.
- **D3** — **Alcance: solo el generador de cliente.** El generador server-side de
  la feature 136 queda en 100 × 100 mm y fuera de alcance. La feature no tiene
  backend, ni migración, ni `down.sql`, ni RLS.

## Requisitos

### Catálogo de tamaños de hoja

- **R1** — El sistema DEBE ofrecer un catálogo de exactamente cuatro tamaños de
  hoja, expuestos siempre en este orden: (1) 100 × 100 mm, (2) 4 × 6 pulgadas,
  (3) A4, (4) Carta.

- **R2** — El catálogo DEBE declarar para cada tamaño estas dimensiones exactas
  en milímetros (ancho × alto):

  | Identificador | Etiqueta visible | Ancho (mm) | Alto (mm) |
  |---|---|---|---|
  | `100x100` | `100 × 100 mm` | 100 | 100 |
  | `4x6in` | `4 × 6 pulgadas` | 101.6 | 152.4 |
  | `a4` | `A4` | 210 | 297 |
  | `carta` | `Carta` | 215.9 | 279.4 |

- **R3** — El módulo que expone el catálogo DEBE ser importable desde un
  componente de cliente sin efectos secundarios: no DEBE leer variables de
  entorno ni ejecutar lógica al importarse.

- **R4** — El catálogo DEBE declarar `100x100` como tamaño por defecto.

- **R5** — SI se solicita al catálogo un identificador que no pertenece a él,
  ENTONCES el sistema DEBE resolverlo al tamaño por defecto en vez de producir un
  PDF sin tamaño definido.

### Selector en el flujo de descarga

- **R6** — CUANDO se abre el modal "Imprimir etiquetas" y hay al menos una
  etiqueta imprimible, el sistema DEBE mostrar un control de selección rotulado
  «Tamaño de hoja» con las cuatro opciones del catálogo, en el orden de R1 y con
  las etiquetas visibles de R2.

- **R7** — CUANDO se abre el modal, el tamaño seleccionado DEBE ser el del
  catálogo por defecto (100 × 100 mm), sin importar qué se eligió en aperturas
  anteriores.

- **R8** — CUANDO el usuario elige un tamaño en el selector, el sistema DEBE
  mostrar en el texto descriptivo del modal la etiqueta visible y las dimensiones
  en milímetros del tamaño seleccionado.

- **R9** — CUANDO el usuario confirma la descarga, el sistema DEBE generar el PDF
  con el tamaño seleccionado en ese momento en el selector.

- **R10** — El sistema NUNCA DEBE persistir el tamaño elegido: no lo DEBE
  escribir en almacenamiento del navegador, ni enviarlo al servidor para
  guardarlo, ni asociarlo a un usuario o tienda.

- **R11** — MIENTRAS no exista ninguna etiqueta imprimible en el modal, el
  sistema NO DEBE mostrar el selector de tamaño ni ofrecer la descarga.

### Generación del PDF (generador de cliente)

- **R12** — El sistema DEBE producir un PDF con **exactamente una etiqueta por
  página** y tantas páginas como etiquetas imprimibles, para cualquier tamaño del
  catálogo. NUNCA DEBE colocar más de una etiqueta en la misma página.

- **R13** — El PDF generado DEBE declarar todas sus páginas con el tamaño exacto
  del catálogo seleccionado (ancho × alto en mm de R2, convertidos a puntos).

- **R14** — El sistema DEBE escalar la maqueta de la etiqueta de forma **uniforme
  en ambos ejes**, con un único factor derivado del lado menor de la hoja
  respecto del lienzo base de 100 mm; NUNCA DEBE aplicar factores distintos por
  eje ni deformar la relación de aspecto del QR ni del código de barras.

- **R15** — SI la hoja seleccionada no es cuadrada, ENTONCES el sistema DEBE
  dibujar la etiqueta como un bloque cuadrado escalado al lado menor de la hoja,
  **centrado en ambos ejes**, dejando en blanco las bandas sobrantes del lado
  mayor; NUNCA DEBE estirar la etiqueta hasta el lado mayor ni recortar
  contenido.

- **R16** — El sistema DEBE escalar con el mismo factor de R14 todos los
  elementos de la maqueta: margen interior, ancho de contenido, tamaños de
  tipografía, interlineado, lado del QR, alto y ancho del código de barras y las
  separaciones entre bloques.

- **R17** — Para cualquier tamaño del catálogo, todo el contenido dibujado DEBE
  quedar dentro del bloque cuadrado útil de la página; ningún elemento DEBE
  invadir el margen exterior ni salirse de la página.

- **R18** — CUANDO el tamaño seleccionado amplía la maqueta (factor de escala
  mayor que 1), el sistema DEBE rasterizar el código de barras con una densidad
  proporcional a ese factor, de modo que su resolución efectiva en píxeles por
  milímetro no sea menor que la del tamaño 100 × 100 mm.

- **R19** — CUANDO se descarga el PDF, el nombre del archivo DEBE incluir el
  identificador del tamaño elegido (`etiquetas-guia-<identificador>.pdf`), de
  modo que dos descargas con tamaños distintos no produzcan el mismo nombre.

- **R20** — Cada etiqueta DEBE mostrar de forma legible, en cualquier tamaño del
  catálogo, los mismos datos que hoy: número de guía, número de remisión,
  destinatario, teléfono, dirección, ubicación geográfica, producto, monto a
  cobrar y tienda.

### No regresión del generador server-side (blindaje de D3)

- **R21** — El generador server-side del PDF consolidado del lote DEBE seguir
  produciendo páginas de 100 × 100 mm y DEBE conservar su firma pública sin
  parámetro de tamaño.

## Preguntas abiertas

Ninguna. Las tres ambigüedades de la ficha (layout en hoja grande, momento de la
elección y alcance de los dos generadores) están cerradas por D1, D2 y D3. Las
decisiones que este spec resuelve por su cuenta —ubicación del catálogo, factor
de escala, centrado, sufijo en el nombre de archivo y densidad del raster del
código de barras— están argumentadas en `design.md` y quedan sujetas a la puerta
humana F1.4; `design.md` §9 declara explícitamente que no hay decisiones
abiertas pendientes.
