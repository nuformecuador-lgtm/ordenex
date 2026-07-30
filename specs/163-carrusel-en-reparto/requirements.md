# Feature 163 — Carrusel de las órdenes en reparto (vista mosaico) · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto (ver `tasks.md`).
>
> Alcance cerrado por el humano en tres mensajes sucesivos (D1–D3, ver `design.md §0`):
> carrusel de shadcn de 3 en 3 por breakpoints con etiqueta de posición debajo; **solo** en
> la vista mosaico; y el carrusel es un **componente shared**.

## Glosario

- **Carrusel**: contenedor desplazable horizontalmente que muestra una parte de sus
  elementos a la vez y permite avanzar y retroceder.
- **Página**: el conjunto de elementos visibles a la vez con el ancho actual.
- **Etiqueta de posición**: texto que indica qué elementos se están viendo sobre el total.
- **Vista mosaico / vista detalle**: las dos presentaciones de "En reparto" que ofrece el
  conmutador existente (`VistaCardsToggle`).

---

## A. Dónde aplica

**R1** — MIENTRAS la vista de "En reparto" sea **mosaico**, el sistema DEBE presentar las
órdenes en un carrusel.

**R2** — MIENTRAS la vista sea **detalle**, el sistema DEBE conservar la lista de una fila
por orden, sin carrusel.

**R3** — El carrusel NO DEBE alterar el conjunto ni el orden de las órdenes que recibe: sigue
mandando el orden de ruta y los filtros ya aplicados.

**R4** — SI no hay órdenes en reparto, ENTONCES el sistema DEBE mostrar el mensaje de vacío
existente y NO DEBE renderizar carrusel alguno.

## B. Cuántas se ven

**R5** — El sistema DEBE mostrar **3** órdenes a la vez en pantallas anchas, **2** en
intermedias y **1** en angostas, usando los puntos de corte del repo (`sm`, `lg`) —los mismos
que tenía la grilla que sustituye, para no cambiar la densidad de la vista.

**R6** — CUANDO el usuario avance o retroceda, el sistema DEBE moverse una **página** entera
—tantas órdenes como quepan en el ancho actual— y no de una en una.

**R7** — El sistema DEBE mantener montadas TODAS las órdenes, también las que quedan fuera de
la vista: desplazarse no DEBE re-montarlas.

## C. Etiqueta de posición

**R8** — El sistema DEBE mostrar, DEBAJO del carrusel, una etiqueta con la posición visible
sobre el total.

**R9** — CUANDO solo haya una orden visible, la etiqueta DEBE leerse en singular con su
posición: `Orden 5 de 5`.

**R10** — CUANDO haya varias visibles, la etiqueta DEBE leerse como rango en plural:
`Órdenes 1-3 de 5`.

**R11** — CUANDO la última página sea parcial, la etiqueta DEBE reflejar el rango REAL
(`Órdenes 4-5 de 5`), no un tamaño de página fijo.

**R12** — El sistema DEBE descartar posiciones fuera del total en lugar de propagarlas a la
etiqueta.

**R13** — MIENTRAS no haya información de visibilidad —antes del primer trazado, o en un
entorno que no mide anchos— la etiqueta DEBE caer a la PRIMERA posición y NO DEBE inventar un
rango.

**R14** — CUANDO cambie la página visible, el sistema DEBE anunciar la etiqueta nueva sin
mover el foco del control que el usuario acaba de pulsar.

## D. Controles y accesibilidad

**R15** — El sistema DEBE ofrecer controles de anterior y siguiente con nombre accesible.

**R16** — MIENTRAS no se pueda avanzar (o retroceder) en esa dirección, el control
correspondiente DEBE estar deshabilitado.

**R17** — El carrusel DEBE exponerse como una región con nombre accesible, y cada elemento
como una diapositiva.

**R18** — Los controles DEBEN quedar dentro del ancho del contenedor, de modo que sean
alcanzables en pantallas angostas.

## E. Reutilización

**R19** — El carrusel DEBE ser un componente **compartido**, sin conocimiento del dominio de
órdenes: recibe los elementos y cómo pintarlos.

**R20** — El componente compartido DEBE permitir sustituir cuántos elementos caben por punto
de corte sin modificarlo.

**R21** — Las tarjetas mostradas en el carrusel DEBEN ser las MISMAS que muestra la vista
detalle, con las mismas señales y el mismo gate de selección: cambiar de vista no DEBE
cambiar lo que la tarjeta ofrece.

---

## Fuera de alcance

Carrusel en "Por recoger" (sigue en grilla), reproducción automática, indicadores de punto,
carrusel vertical, y persistencia de la página visible entre recargas.
