"use client";

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { etiquetaRango } from "@/components/shared/carrusel-rango";

// Compuesto REUTILIZABLE (pedido humano: el carrusel es un componente shared) sobre la
// primitiva `ui/carousel`. Aporta lo que la primitiva no trae:
//   - Cuantas tarjetas caben POR BREAKPOINT, via clases de `basis` (por defecto 1 / 2 / 3).
//   - La etiqueta de posicion debajo: "Orden 5 de 5" o "Órdenes 1-3 de 5".
//   - Avance de PAGINA: `slidesToScroll: "auto"` mueve tantas como quepan, no de una en una.
// No sabe de dominio: recibe `items` y un `renderItem`.

/**
 * Cuantas tarjetas se ven segun el ancho. Coincide con la grilla que este carrusel
 * sustituye (1 en movil, 2 desde `sm`, 3 desde `lg`), asi que la vista no cambia de
 * densidad al adoptarlo.
 */
export const BASIS_1_2_3 = "basis-full sm:basis-1/2 lg:basis-1/3";

/**
 * Indices en vista, leidos de embla como fuente EXTERNA.
 *
 * `useSyncExternalStore` y no `useState` + efecto por dos razones: la regla
 * `react-hooks/set-state-in-effect` es ERROR en este repo, y el servidor no tiene anchos que
 * medir. La instantanea es una CADENA ("0,1,2") porque `slidesInView()` devuelve un array
 * nuevo en cada llamada y React exige una instantanea estable.
 */
function useIndicesEnVista(api: CarouselApi | undefined): number[] {
  const suscribir = useCallback(
    (alCambiar: () => void) => {
      if (!api) return () => {};
      api.on("select", alCambiar);
      api.on("reInit", alCambiar);
      api.on("slidesInView", alCambiar);
      return () => {
        api.off("select", alCambiar);
        api.off("reInit", alCambiar);
        api.off("slidesInView", alCambiar);
      };
    },
    [api],
  );

  const instantanea = useCallback(() => {
    if (!api) return "";
    const enVista = api.slidesInView();
    if (enVista.length > 0) return enVista.join(",");
    // Sin medidas (jsdom, o antes del primer layout) al menos se sabe cual esta seleccionada.
    return String(api.selectedScrollSnap());
  }, [api]);

  const clave = useSyncExternalStore(suscribir, instantanea, () => "");

  return useMemo(
    () => (clave === "" ? [] : clave.split(",").map(Number)),
    [clave],
  );
}

export interface CarruselCardsProps<T> {
  items: T[];
  /** Clave estable de cada elemento. */
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Nombre accesible de la region del carrusel. */
  ariaLabel: string;
  /** Clases de ancho por breakpoint de cada tarjeta. Por defecto 1 / 2 / 3. */
  itemClassName?: string;
  /** Nombre del elemento para la etiqueta ("Orden" / "Órdenes"). */
  singular?: string;
  plural?: string;
  className?: string;
}

export function CarruselCards<T>({
  items,
  getKey,
  renderItem,
  ariaLabel,
  itemClassName = BASIS_1_2_3,
  singular,
  plural,
  className,
}: CarruselCardsProps<T>) {
  const [api, setApi] = useState<CarouselApi>();
  const indicesEnVista = useIndicesEnVista(api);
  const etiqueta = etiquetaRango(indicesEnVista, items.length, {
    singular,
    plural,
  });

  if (items.length === 0) return null;

  return (
    <Carousel
      setApi={setApi}
      aria-label={ariaLabel}
      className={className}
      opts={{
        // `align: "start"` + `slidesToScroll: "auto"` = avance por PAGINA: mueve tantas como
        // quepan en el ancho actual, que es lo que hace legible la etiqueta ("1-3", "4-5").
        align: "start",
        slidesToScroll: "auto",
        containScroll: "trimSnaps",
        // La etiqueta sale de `slidesInView()`, y embla considera "en vista" una tarjeta con
        // que asome UN pixel (`inViewThreshold` por defecto: 0). Con eso la tarjeta siguiente,
        // apenas insinuada en el borde, entraba en la cuenta y la etiqueta decia "1-4" cuando
        // en pantalla habia 3.
        //
        // El arreglo inicial (0.99) se pasaba de frenada y perdia la PRIMERA: el carril usa
        // `-ml-4` con `pl-4` en cada `CarouselItem` (patron de shadcn), asi que la caja de la
        // tarjeta 1 empieza 16px a la izquierda del area visible y nunca llega al 99%; la
        // etiqueta decia "2-3 de 5" con tres tarjetas enteras en pantalla. Con 0.75 una
        // tarjeta completa cuenta (le sobra margen para ese padding y para el redondeo
        // sub-pixel) y una que solo asoma por el borde sigue sin contar.
        inViewThreshold: 0.75,
      }}
    >
      <CarouselContent>
        {items.map((item) => (
          <CarouselItem key={getKey(item)} className={itemClassName}>
            {renderItem(item)}
          </CarouselItem>
        ))}
      </CarouselContent>

      {/* Controles y etiqueta DEBAJO, en la misma fila: las flechas por defecto de shadcn
          van fuera del contenedor (`-left-12`) y ahi se salen del viewport en movil, que es
          justo donde el mensajero usa esto. */}
      <div className="mt-3 flex items-center justify-center gap-3">
        {/* `top-auto left-auto right-auto` no son decorativos: `tailwind-merge` NO considera
            que `static` anule un `-left-12`, así que sin neutralizar el offset por su misma
            familia la clase muerta se queda pegada al elemento. */}
        <CarouselPrevious className="static top-auto left-auto right-auto translate-y-0" />
        {/* `aria-live`: al pasar de pagina el lector anuncia la posicion nueva sin mover el
            foco, que sigue en la flecha pulsada. */}
        <p
          aria-live="polite"
          className="min-w-32 text-center text-sm text-muted-foreground tabular-nums"
        >
          {etiqueta}
        </p>
        <CarouselNext className="static top-auto left-auto right-auto translate-y-0" />
      </div>
    </Carousel>
  );
}
