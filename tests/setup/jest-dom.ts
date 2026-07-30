// Registra los matchers de @testing-library/jest-dom (toBeInTheDocument,
// toHaveAttribute, etc.) para todos los archivos de test. Es un no-op
// inocuo en los tests que corren en entorno "node" (backend), y necesario
// para los tests de componente que corren en "jsdom".
import "@testing-library/jest-dom/vitest";

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
