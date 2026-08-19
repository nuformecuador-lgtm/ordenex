// Registra los matchers de @testing-library/jest-dom (toBeInTheDocument, toHaveAttribute, etc.)
// para los tests de componente, que corren en "jsdom".
import { vi } from "vitest";

// El import va CONDICIONADO al entorno, y no por elegancia: era gratis en correccion y caro en
// tiempo. `@testing-library/jest-dom/vitest` arrastra los matchers de DOM y se cargaba en los
// 804 archivos, pero **617 corren en entorno `node`** (backend) y ninguno los usa: alli era un
// no-op que igualmente habia que importar, resolver y evaluar en cada worker.
//
// Medido el 2026-08-03 sobre `tests/unit/services` (130 archivos, 2.270 tests, todos node):
//
//     CON el import incondicional:  14,35 s  (setup 51,19 s de CPU acumulada)
//     SIN el import:                10,94 s  (setup 0 ms)   <- mismos 2.270 en verde
//
// O sea: el ARRANQUE costaba 5x mas que ejecutar los tests. Con `await import` dinamico el
// coste se paga solo en los 187 archivos que declaran `// @vitest-environment jsdom`, que son
// los unicos que tienen `window` y los unicos que usan los matchers.
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
}

// Feature 92 (seguimiento) — silencia la traza `optimizer***:` durante la suite. Va AQUI y
// no dentro de `lib/logging/optimizer-log.ts` porque una guardia del repo
// (`notificacion-notificadores-reales.test.ts`) prohibe que un modulo de `lib/` o `app/`
// cambie de comportamiento al detectar el entorno de test. Este archivo SI es codigo de
// test, asi que puede saberlo. Sin esto, la traza escupiria coordenadas y cuerpos HTTP en
// cada corrida del gate.
process.env.RUTA_DEBUG_LOG = "0";

// `react-countup` anima el valor DESDE 0 (`start={0}` explícito en `KpiValorAnimado`), asi
// que en el primer render un KPI vale "0" y solo llega a su valor real cuando la animacion
// termina, ~1.2 s despues por requestAnimationFrame. Un test que lea el KPI justo tras
// renderizar lee el cero — no porque el dato este mal, sino porque la cuenta no ha subido.
// El doble renderiza el valor FINAL ya formateado: lo que los tests verifican es que el KPI
// muestre su cifra, no que la anime. Va en el setup y no en cada archivo porque los KPIs
// aparecen en varias pantallas (portal del mensajero, cierres) y el tropiezo es el mismo.
vi.mock("react-countup", () => ({
  default: ({
    end,
    formattingFn,
  }: {
    end: number;
    formattingFn?: (n: number) => string;
  }) => (formattingFn ? formattingFn(end) : String(end)),
}));

// Polyfills para componentes que dependen de APIs del navegador ausentes en
// jsdom (p. ej. el Sidebar de shadcn usa `matchMedia` vía use-mobile, y el
// Sheet/Tooltip de base-ui pueden observar el layout). Se aplican solo en el
// entorno jsdom; en el entorno "node" (backend) `window` no existe y es no-op.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }

  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }

  // jsdom no implementa `IntersectionObserver`, y embla-carousel lo exige para saber que
  // diapositivas estan en vista (`SlidesInView`): sin el, montar el carrusel LANZA. El stub
  // no notifica nada, asi que `slidesInView()` queda vacio y el compuesto
  // (`components/shared/CarruselCards.tsx`) cae a su rango por defecto -- documentado en
  // `carrusel-rango.ts`. El calculo del rango se prueba sin layout, en su propio test.
  if (!("IntersectionObserver" in window)) {
    class IntersectionObserverStub {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: number[] = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    (
      window as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    (
      globalThis as unknown as {
        IntersectionObserver: typeof IntersectionObserverStub;
      }
    ).IntersectionObserver = IntersectionObserverStub;
  }

  // jsdom no implementa `URL.createObjectURL`/`revokeObjectURL` (los usa el panel del mensajero
  // para previsualizar las fotos de evidencia, feature 119). Se stubbean con URLs UNICAS para no
  // colisionar `key`s de lista y para que las llamadas no revienten. Tests que necesiten espiar
  // estas llamadas (p. ej. BulkUpload) las redefinen con `Object.defineProperty(configurable)`.
  if (typeof URL.createObjectURL !== "function") {
    let objectUrlSeq = 0;
    URL.createObjectURL = () => `blob:mock/${objectUrlSeq++}`;
  }
  if (typeof URL.revokeObjectURL !== "function") {
    URL.revokeObjectURL = () => {};
  }
}
