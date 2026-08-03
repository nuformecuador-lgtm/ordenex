"use client";

import * as React from "react";
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Primitiva `carousel` de shadcn/ui (sobre embla-carousel-react), adaptada a este repo:
// usa el `Button` local (variantes `outline` / `size="icon"`) y `cn` de `@/lib/utils`.
// Como toda primitiva de `ui/`, NO sabe de dominio: el compuesto con la etiqueta
// "1-3 de N" vive en `components/shared/CarruselCards.tsx`.

type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugin = UseCarouselParameters[1];

export type { CarouselApi };

export interface CarouselProps {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: CarouselApi) => void;
}

interface CarouselContextProps extends CarouselProps {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: CarouselApi;
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
}

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

/**
 * Si se puede retroceder / avanzar, leido de embla como fuente EXTERNA.
 *
 * ADAPTACION respecto al carousel original de shadcn: alli esto son dos `useState` que un
 * efecto siembra llamando `onSelect(api)` de forma sincrona. En este repo la regla
 * `react-hooks/set-state-in-effect` es ERROR (ver `pnpm lint`), asi que se usa la API que
 * React ofrece para leer fuentes externas. Sale mas correcto de paso: el valor es bueno ya en
 * el primer render, sin depender de que embla emita un evento.
 *
 * La instantanea es una CADENA ("1,0") porque debe ser estable entre llamadas: devolver un
 * objeto nuevo cada vez haria que React reintentara el render sin parar.
 */
function useDesplazamiento(api: CarouselApi): {
  canScrollPrev: boolean;
  canScrollNext: boolean;
} {
  const suscribir = React.useCallback(
    (alCambiar: () => void) => {
      if (!api) return () => {};
      api.on("reInit", alCambiar);
      api.on("select", alCambiar);
      return () => {
        api.off("reInit", alCambiar);
        api.off("select", alCambiar);
      };
    },
    [api],
  );

  const instantanea = React.useCallback(() => {
    if (!api) return "0,0";
    return `${api.canScrollPrev() ? 1 : 0},${api.canScrollNext() ? 1 : 0}`;
  }, [api]);

  const clave = React.useSyncExternalStore(suscribir, instantanea, () => "0,0");
  const [prev, next] = clave.split(",");

  return { canScrollPrev: prev === "1", canScrollNext: next === "1" };
}

function useCarousel() {
  const context = React.useContext(CarouselContext);
  if (!context) {
    throw new Error("useCarousel debe usarse dentro de un <Carousel />");
  }
  return context;
}

function Carousel({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    { ...opts, axis: orientation === "horizontal" ? "x" : "y" },
    plugins,
  );
  const { canScrollPrev, canScrollNext } = useDesplazamiento(api);

  const scrollPrev = React.useCallback(() => api?.scrollPrev(), [api]);
  const scrollNext = React.useCallback(() => api?.scrollNext(), [api]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext],
  );

  React.useEffect(() => {
    if (!api || !setApi) return;
    setApi(api);
  }, [api, setApi]);

  return (
    <CarouselContext.Provider
      value={{
        carouselRef,
        api,
        opts,
        orientation:
          orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
      }}
    >
      <div
        onKeyDownCapture={handleKeyDown}
        className={cn("relative", className)}
        role="region"
        aria-roledescription="carousel"
        data-slot="carousel"
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

function CarouselContent({ className, ...props }: React.ComponentProps<"div">) {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div
      ref={carouselRef}
      // `p-px`: el viewport recorta a ras de su caja, así que el borde/ring de la
      // tarjeta (p. ej. la seleccionada, `ring-1 ring-brand`) se comía contra los
      // cuatro lados. Un píxel de aire lo deja verse entero sin mover el layout.
      className="overflow-hidden p-px"
      data-slot="carousel-content"
    >
      <div
        className={cn(
          "flex",
          orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CarouselItem({ className, ...props }: React.ComponentProps<"div">) {
  const { orientation } = useCarousel();

  return (
    <div
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className,
      )}
      {...props}
    />
  );
}

function CarouselPrevious({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      data-slot="carousel-previous"
      variant={variant}
      size={size}
      className={cn(
        "absolute size-8 rounded-full",
        orientation === "horizontal"
          ? "top-1/2 -left-12 -translate-y-1/2"
          : "-top-12 left-1/2 -translate-x-1/2 rotate-90",
        className,
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ArrowLeft aria-hidden="true" />
      <span className="sr-only">Anterior</span>
    </Button>
  );
}

function CarouselNext({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      data-slot="carousel-next"
      variant={variant}
      size={size}
      className={cn(
        "absolute size-8 rounded-full",
        orientation === "horizontal"
          ? "top-1/2 -right-12 -translate-y-1/2"
          : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
        className,
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ArrowRight aria-hidden="true" />
      <span className="sr-only">Siguiente</span>
    </Button>
  );
}

export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  useCarousel,
};
