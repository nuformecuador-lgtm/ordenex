# Feature 163 — Carrusel de las órdenes en reparto · design

## 0. Decisiones del humano (2026-07-30, tres mensajes sucesivos)

- **D1** — Carrusel de **shadcn**, de 3 en 3 **según el ancho, usando breakpoints**, con
  etiqueta debajo del tipo `orden 5 de 5` o `1-3 de 5`. Los elementos son las cards de
  **en reparto** del mensajero.
- **D2** — **Solo aplica en la vista mosaico.** La vista detalle se queda como está.
- **D3** — El carrusel debe ser un **componente shared**.

## 1. Estado previo

`MisAsignacionesModule` pintaba las órdenes de "En reparto" en un `<ul>` con
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` cuando la vista era mosaico, y en una columna
cuando era detalle (`VistaCardsToggle`, rama ux). No había ninguna dependencia de carrusel en
el repo.

## 2. Piezas

### 2.1 `components/ui/carousel.tsx` — primitiva shadcn (nueva dependencia)

Carousel oficial de shadcn/ui sobre **`embla-carousel-react`** (dependencia nueva), adaptado
al repo: usa el `Button` local y `cn` de `@/lib/utils`.

**Dos desviaciones respecto al código original, ambas forzadas y documentadas en el archivo:**

1. **`canScrollPrev` / `canScrollNext` con `useSyncExternalStore`, no con `useState` + efecto.**
   El original siembra los dos estados llamando `onSelect(api)` de forma síncrona dentro de un
   efecto, y en este repo `react-hooks/set-state-in-effect` es **error** de lint, no aviso.
   La versión adaptada los lee de embla como fuente externa; de paso queda correcta ya en el
   primer render, sin depender de que embla emita un evento. La instantánea es una **cadena**
   (`"1,0"`) porque debe ser estable entre llamadas (R16).
2. **Las flechas van debajo, no flotando a los lados.** El original las posiciona fuera del
   contenedor (`-left-12` / `-right-12`), donde se salen del viewport en móvil — que es justo
   donde el mensajero usa esto (R18).

### 2.2 `components/shared/CarruselCards.tsx` — el compuesto (D3)

Genérico y sin dominio (R19): recibe `items`, `getKey`, `renderItem` y un `ariaLabel`. Aporta
lo que la primitiva no trae:

- `BASIS_1_2_3 = "basis-full sm:basis-1/2 lg:basis-1/3"` como `itemClassName` por defecto
  (R5), sustituible por prop (R20). Son **los mismos cortes que la grilla anterior**, así que
  adoptarlo no cambia la densidad de la vista.
- `opts: { align: "start", slidesToScroll: "auto", containScroll: "trimSnaps" }` → avance por
  página (R6). Es lo que hace legible la etiqueta: sin ello los rangos avanzarían de uno en
  uno.
- La etiqueta debajo, entre las flechas, con `aria-live="polite"` (R8, R14).
- `items` vacío → no renderiza nada (R4): el mensaje de vacío es del consumidor, que ya lo
  tenía.

**Indices en vista**: `useSyncExternalStore` sobre los eventos `select` / `reInit` /
`slidesInView` de embla. Misma razón que en §2.1 (la regla de lint) más una propia: el
servidor no tiene anchos que medir. La instantánea vuelve a ser una cadena porque
`slidesInView()` devuelve un array nuevo en cada llamada y React exige estabilidad.

### 2.3 `components/shared/carrusel-rango.ts` — la aritmética, aparte

`rangoVisible(indices, total)` y `etiquetaRango(indices, total, {singular, plural})`
(R9–R13). Vive fuera del componente **a propósito**: es la única regla con aritmética de la
feature y así se ejercita sin montar embla. Sin ello no habría forma honesta de probar los
rangos (ver §4).

## 3. Enganche en el módulo

En `MisAsignacionesModule`, la rama de mosaico pasa a `<CarruselCards>` y la de detalle
conserva su `<ul>` (R1, R2). Se extrajo **`renderCardEnReparto(orden, vista)`** para que las
dos ramas rendericen exactamente la misma card con las mismas props —parada/ruta, "gestionar
más tarde", bloqueo, gate de selección— y el conmutador solo cambie el envoltorio y el
componente de presentación (R21). Antes ese bloque estaba duplicado dentro del `map`.

## 4. Límite de la verificación (declarado, no disimulado)

**jsdom no mide anchos**, así que embla nunca reporta qué diapositivas están en vista y el
rango cae siempre a su valor por defecto (R13). Consecuencia honesta: el test de componente
verifica **cableado** (todas las tarjetas montadas, región y diapositivas accesibles,
controles, etiqueta presente con el total real) y **los rangos se prueban en la aritmética
pura**, sin layout. Fingir lo contrario exigiría falsear `getBoundingClientRect` de medio DOM
y probaría el falseo, no el componente.

Además **jsdom no trae `IntersectionObserver`** y embla lo **exige** (`SlidesInView`): sin él,
montar el carrusel **lanza**. Se añadió un stub a `tests/setup/jest-dom.ts`, junto a los de
`matchMedia` y `ResizeObserver`. Medido, no supuesto: el stub no empeora nada — en
`Modal.test.tsx` + `MarcarLuegoToggle.test.tsx` se pasa de **3 fallos a 1**.

## 5. Alternativas descartadas

- **Grilla con paginación propia** (botones que cortan el array). Más código y peor en móvil:
  se pierde el arrastre táctil, que es el gesto natural del mensajero en la calle.
- **`scroll-snap` de CSS a pelo**, sin dependencia. Sale barato hasta que hay que saber qué
  hay en vista para la etiqueta y si se puede avanzar: eso exige `IntersectionObserver` y
  cálculo de posiciones a mano. Es reimplementar embla peor. Además el humano pidió el de
  shadcn.
- **Carrusel co-ubicado en `mis-asignaciones/_components`**, siguiendo la regla
  anti-sobre-ingeniería de `architecture.md` (un solo consumidor). Descartado por **D3**: el
  humano lo pidió shared explícitamente.
- **Aplicarlo también a "Por recoger"** para uniformar. No se pidió y esa sección tiene otra
  semántica (sin selección ni ruta).
