"use client";

import { DayPicker, type DayPickerProps } from "@daypicker/react";
import { es } from "@daypicker/react/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Rango predefinido ofrecido junto al calendario. Solo valor + texto visible. */
export interface CalendarDefaultRange {
  value: string;
  label: string;
}

export type CalendarProps = DayPickerProps & {
  /**
   * Rangos predefinidos ("Últimos 30 días"...) mostrados como BOTONES al lado del
   * calendario. Vacio o ausente = solo el calendario.
   */
  defaultRanges?: readonly CalendarDefaultRange[];
  /** Rango predefinido activo. Cadena vacia = ninguno. */
  selectedDefaultRange?: string;
  /**
   * Emite el rango predefinido pulsado, o `""` al pulsar el que ya estaba activo
   * (los botones se comportan como un grupo excluyente que se puede vaciar).
   */
  onDefaultRangeSelect?: (value: string) => void;
};

/**
 * Primitiva `Calendar` sobre `@daypicker/react` (DayPicker v10), hermana de `Select`
 * y `Dialog`: envuelve la libreria headless y le pone el lenguaje visual del repo.
 *
 * - Se estiliza SOLO con `classNames` + Tailwind: NO se importa la hoja de estilos de
 *   la libreria, para que los tokens (`primary`, `muted`, `border`) manden y el tema
 *   oscuro funcione sin overrides.
 * - `locale={es}` en la propia primitiva: la app es de Costa Rica y ningun consumidor
 *   deberia tener que recordarlo.
 * - `showOutsideDays={false}`: los dias del mes vecino no son clicables aqui y solo
 *   duplican numeros en pantalla.
 * - `defaultRanges`: los rangos predefinidos viven DENTRO del calendario, como botones
 *   a su lado. Quien los declara decide que significan; el calendario solo los pulsa.
 *
 * El resto del contrato (modo de seleccion, `selected`, `onSelect`, `numberOfMonths`)
 * es el de DayPicker tal cual, sin envolver.
 */
export function Calendar({
  className,
  classNames,
  defaultRanges,
  selectedDefaultRange = "",
  onDefaultRangeSelect,
  ...props
}: CalendarProps) {
  const calendario = (
    <DayPicker
      locale={es}
      showOutsideDays={false}
      className={cn("text-sm", className)}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", chevronClassName)} aria-hidden="true" />
          ) : (
            <ChevronRight className={cn("size-4", chevronClassName)} aria-hidden="true" />
          ),
      }}
      classNames={{
        root: "relative",
        months: "flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-2",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous:
          "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-40",
        button_next:
          "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-40",
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-sm font-medium capitalize",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-8 pb-1 text-[0.7rem] font-normal text-muted-foreground capitalize",
        week: "flex w-full",
        day: "p-0 text-center",
        day_button:
          "size-8 cursor-pointer rounded-md text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
        today: "[&>button]:font-semibold [&>button]:text-brand",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground",
        // Los extremos redondean solo hacia afuera para que la banda del rango se lea continua.
        range_start: "rounded-l-md bg-muted [&>button]:rounded-r-none",
        range_end: "rounded-r-md bg-muted [&>button]:rounded-l-none",
        // `range_middle` convive con `selected`: el `!` gana al fondo `primary` de arriba
        // sin depender del orden en que Tailwind emita las dos reglas.
        range_middle:
          "bg-muted [&>button]:rounded-none [&>button]:bg-transparent! [&>button]:text-foreground!",
        outside: "text-muted-foreground/50",
        disabled: "[&>button]:opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );

  if (!defaultRanges || defaultRanges.length === 0) return calendario;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
      <div
        role="group"
        aria-label="Rangos predefinidos"
        className="flex flex-wrap gap-1 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-r sm:border-border sm:pr-3"
      >
        {defaultRanges.map((rango) => {
          const activo = rango.value === selectedDefaultRange;
          return (
            <Button
              key={rango.value}
              type="button"
              variant={activo ? "default" : "ghost"}
              size="sm"
              aria-pressed={activo}
              className="justify-start"
              // Volver a pulsar el activo lo suelta: es la unica forma de deshacer
              // el predefinido sin tener que elegir dias en el calendario.
              onClick={() => onDefaultRangeSelect?.(activo ? "" : rango.value)}
            >
              {rango.label}
            </Button>
          );
        })}
      </div>
      {calendario}
    </div>
  );
}
