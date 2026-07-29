"use client";

import { useId, useState } from "react";
import type { DateRange } from "@daypicker/react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";

import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Atajo ofrecido dentro del control (R9). Trae el RANGO que representa: el atajo no
 * es un valor propio que viaje a la salida, es un ajuste rapido del rango.
 */
export interface DateRangeShortcut {
  value: string;
  label: string;
  /** Extremos del rango, en `YYYY-MM-DD`. Los calcula quien declara el atajo. */
  desde: string;
  hasta: string;
}

export interface DateRangeFilterProps {
  /** Nombre accesible del control (R29). */
  label: string;
  /** Atajos ofrecidos DENTRO del mismo filtro (R9). Vacio = solo desde/hasta. */
  shortcuts?: DateRangeShortcut[];
  /**
   * Emite la terna POSICIONAL `[atajo, desde, hasta]` (R19), con cadena vacia en las
   * posiciones no fijadas y SIN compactar nunca. `["","",""]` = sin seleccion.
   * Las fechas viajan como `YYYY-MM-DD` (fecha de calendario, no instante).
   *
   * La PRIMERA posicion se conserva por contrato pero este control ya no la llena:
   * los atajos se resuelven aqui a su rango, asi que lo que sale son siempre fechas.
   */
  onChange: (value: [string, string, string]) => void;
  /**
   * Contador de "limpiar todo" del orquestador: cuando cambia, el control vacia su
   * estado interno SIN emitir (el orquestador ya emite la salida vacia una sola vez).
   */
  resetSignal?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Mes inicial del calendario. Por defecto, el mes del extremo ya elegido o el actual. */
  defaultMonth?: Date;
}

/** `YYYY-MM-DD` -> fecha LOCAL a medianoche (nunca `new Date(iso)`, que la lee como UTC). */
function aFecha(iso: string): Date | undefined {
  if (iso === "") return undefined;
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

/** Fecha local -> `YYYY-MM-DD` leyendo los campos locales (no `toISOString`, que va a UTC). */
function aIso(fecha: Date | undefined): string {
  if (!fecha) return "";
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

const FORMATO_CORTO = new Intl.DateTimeFormat("es-CR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function enTexto(iso: string): string {
  const fecha = aFecha(iso);
  return fecha ? FORMATO_CORTO.format(fecha) : "";
}

/**
 * Texto del disparador: si el rango coincide con un atajo se muestra su etiqueta
 * ("Últimos 7 días" se lee mejor que las dos fechas), y si no se resume el rango,
 * cubriendo tambien los abiertos por un extremo (R11).
 */
function resumen(
  atajo: string,
  desde: string,
  hasta: string,
  shortcuts: DateRangeShortcut[],
  placeholder: string,
): string {
  if (atajo !== "") {
    return shortcuts.find((s) => s.value === atajo)?.label ?? atajo;
  }
  if (desde !== "" && hasta !== "") return `${enTexto(desde)} – ${enTexto(hasta)}`;
  if (desde !== "") return `Desde el ${enTexto(desde)}`;
  if (hasta !== "") return `Hasta el ${enTexto(hasta)}`;
  return placeholder;
}

/**
 * Filtro de RANGO DE FECHAS con atajos, en UN SOLO control (design.md §A.5).
 *
 * - Los dos extremos se eligen en un CALENDARIO (`Calendar` sobre `@daypicker/react`
 *   en `mode="range"`) desplegado en un popover, en vez de dos `<input type="date">`.
 *   Un solo gesto fija el rango completo y se ve la continuidad de los dias elegidos.
 *   El primer clic deja un rango de UN dia (`desde === hasta`), el segundo lo extiende
 *   y volver a pulsar ese unico dia lo deselecciona (comportamiento de DayPicker).
 * - Los atajos viven DENTRO del filtro (R9), no en un filtro aparte: bajan al calendario
 *   como `defaultRanges` y se pulsan como BOTONES al lado de los meses, en el mismo
 *   popover. No hay un segundo control (antes eran un `Select` aparte).
 * - Atajo y rango son MUTUAMENTE EXCLUYENTES (R10): elegir un atajo vacia las dos
 *   fechas y tocar el calendario vacia el atajo, de modo que la combinacion no llega
 *   a existir ni a emitirse.
 * - R12 (rango invertido) pasa a ser IMPOSIBLE por construccion: el modo rango ordena
 *   siempre los extremos, asi que ya no hay estado de error que mostrar. La guarda en
 *   `emitir` se conserva como red de seguridad del contrato de salida.
 * - Los rangos ABIERTOS por un extremo (R11) se mantienen: cada extremo se puede
 *   vaciar por separado desde el pie del calendario.
 * - No interpreta las fechas mas alla de comparar su orden: no las convierte a
 *   instantes ni aplica husos (eso es server-side).
 */
export function DateRangeFilter({
  label,
  shortcuts = [],
  onChange,
  resetSignal = 0,
  disabled = false,
  placeholder = "Cualquier fecha",
  className,
  defaultMonth,
}: DateRangeFilterProps) {
  const idBase = useId();
  const idEtiquetaRango = `${idBase}-rango-label`;

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  // Limpieza externa ("Limpiar todo"): se ajusta el estado DURANTE el render, sin
  // efecto ni emision propia (patron "ajustar estado durante el render").
  const [signalPrevio, setSignalPrevio] = useState(resetSignal);
  if (resetSignal !== signalPrevio) {
    setSignalPrevio(resetSignal);
    setDesde("");
    setHasta("");
  }

  const haySeleccion = desde !== "" || hasta !== "";
  const seleccionado: DateRange | undefined = !haySeleccion
    ? undefined
    : { from: aFecha(desde), to: aFecha(hasta) };

  // El atajo activo se DEDUCE del rango vigente: no hay un segundo estado que pueda
  // desincronizarse con el calendario, y elegir dias a mano lo apaga solo.
  const atajo =
    shortcuts.find((s) => s.desde === desde && s.hasta === hasta)?.value ?? "";

  function emitir(a: string, d: string, h: string) {
    if (d !== "" && h !== "" && d > h) return; // R12: la combinacion invalida no se emite
    onChange([a, d, h]);
  }

  function fijarRango(d: string, h: string) {
    setDesde(d);
    setHasta(h);
    emitir("", d, h);
  }

  /** El atajo NO es un valor de salida: pinta su rango en el calendario y emite fechas. */
  function elegirAtajo(v: string) {
    const elegido = shortcuts.find((s) => s.value === v);
    // `""` = se volvio a pulsar el atajo activo, que suelta el rango que habia puesto.
    if (!elegido) {
      fijarRango("", "");
      return;
    }
    fijarRango(elegido.desde, elegido.hasta);
  }

  function seleccionarEnCalendario(rango: DateRange | undefined, dia: Date) {
    // Rango abierto por abajo (solo `hasta`): DayPicker no sabe extender un rango sin
    // inicio y devuelve `undefined`; aqui el dia clicado se toma como el otro extremo
    // y los dos se ordenan, que es lo que el gesto significa.
    if (desde === "" && hasta !== "" && rango === undefined) {
      const clic = aIso(dia);
      fijarRango(clic <= hasta ? clic : hasta, clic <= hasta ? hasta : clic);
      return;
    }
    fijarRango(aIso(rango?.from), aIso(rango?.to));
  }

  function limpiar() {
    setDesde("");
    setHasta("");
    onChange(["", "", ""]); // R21: vacia las TRES posiciones y emite
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-end gap-2", className)}
    >
      <div className="relative flex flex-col gap-1.5">
        <Label id={idEtiquetaRango}>{label}</Label>
        <Popover.Root>
          <Popover.Trigger
            aria-labelledby={idEtiquetaRango}
            disabled={disabled}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "w-56 justify-between font-normal",
              !haySeleccion && "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-4 opacity-60" aria-hidden="true" />
            <span className="flex-1 truncate text-left">
              {resumen(atajo, desde, hasta, shortcuts, placeholder)}
            </span>
            {/* Con seleccion, el hueco de la derecha lo ocupa la X que limpia; sin
                ella, la flecha que anuncia el desplegable. */}
            {haySeleccion ? (
              <span className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
            )}
          </Popover.Trigger>

          {/* La X NO puede vivir dentro del disparador (un boton no anida otro): va
              superpuesta sobre su borde derecho, dentro del mismo control. */}
          {haySeleccion ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={`Limpiar ${label}`}
              className="absolute right-1 bottom-1 hover:bg-transparent hover:text-foreground"
              onClick={limpiar}
            >
              <X className="size-4 opacity-60" aria-hidden />
            </Button>
          ) : null}
          <Popover.Portal>
            <Popover.Positioner sideOffset={4} className="z-50">
              <Popover.Popup className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  defaultMonth={defaultMonth ?? aFecha(desde) ?? aFecha(hasta)}
                  selected={seleccionado}
                  onSelect={seleccionarEnCalendario}
                  defaultRanges={shortcuts}
                  selectedDefaultRange={atajo}
                  onDefaultRangeSelect={elegirAtajo}
                />
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                  <ExtremoElegido
                    titulo="Desde"
                    valor={desde}
                    onLimpiar={() => fijarRango("", hasta)}
                  />
                  <ExtremoElegido
                    titulo="Hasta"
                    valor={hasta}
                    onLimpiar={() => fijarRango(desde, "")}
                  />
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

/**
 * Un extremo ya elegido, con su propia limpieza. Es lo que mantiene vivos los rangos
 * ABIERTOS (R11) ahora que el calendario, por si solo, solo sabe producir rangos con
 * los dos extremos.
 */
function ExtremoElegido({
  titulo,
  valor,
  onLimpiar,
}: {
  titulo: "Desde" | "Hasta";
  valor: string;
  onLimpiar: () => void;
}) {
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>{titulo}:</span>
      <span className="font-medium text-foreground">
        {valor === "" ? "—" : enTexto(valor)}
      </span>
      {valor !== "" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Quitar ${titulo.toLowerCase()}`}
          onClick={onLimpiar}
        >
          <X className="size-3" aria-hidden />
        </Button>
      ) : null}
    </p>
  );
}
