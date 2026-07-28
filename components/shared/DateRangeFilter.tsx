"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Opcion de ATAJO ofrecida dentro del control (R9). Solo valor + texto visible. */
export interface DateRangeShortcut {
  value: string;
  label: string;
}

export interface DateRangeFilterProps {
  /** Nombre accesible del control (R29). */
  label: string;
  /** Atajos ofrecidos DENTRO del mismo filtro (R9). Vacio = solo desde/hasta. */
  shortcuts?: DateRangeShortcut[];
  /**
   * Emite la terna POSICIONAL `[atajo, desde, hasta]` (R19), con cadena vacia en las
   * posiciones no fijadas y SIN compactar nunca. `["","",""]` = sin seleccion.
   * NO se emite mientras el rango este invertido (R12).
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
}

/**
 * Filtro de RANGO DE FECHAS con atajos, en UN SOLO control (design.md §A.5).
 *
 * - Dos `<input type="date">` (desde/hasta), patron vigente del repo
 *   (`WalletFiltros`): el navegador ya entrega `YYYY-MM-DD` normalizado y abre su
 *   calendario nativo. **Sin dependencias nuevas.**
 * - Los atajos viven DENTRO del filtro (R9), no en un filtro aparte.
 * - Atajo y rango son MUTUAMENTE EXCLUYENTES (R10): elegir un atajo vacia las dos
 *   fechas y fijar cualquier fecha vacia el atajo, de modo que la combinacion no
 *   llega a existir ni a emitirse.
 * - `min`/`max` cruzados entre los dos inputs impiden la mayoria de los rangos
 *   invertidos en el propio calendario; si aun asi queda invertido, el control se
 *   marca `aria-invalid` y NO emite (R12).
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
}: DateRangeFilterProps) {
  const idBase = useId();
  const idDesde = `${idBase}-desde`;
  const idHasta = `${idBase}-hasta`;
  const idError = `${idBase}-error`;

  const [atajo, setAtajo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  // Limpieza externa ("Limpiar todo"): se ajusta el estado DURANTE el render, sin
  // efecto ni emision propia (patron del listado de ordenes).
  const [signalPrevio, setSignalPrevio] = useState(resetSignal);
  if (resetSignal !== signalPrevio) {
    setSignalPrevio(resetSignal);
    setAtajo("");
    setDesde("");
    setHasta("");
  }

  const invertido = desde !== "" && hasta !== "" && desde > hasta;
  const haySeleccion = atajo !== "" || desde !== "" || hasta !== "";

  function emitir(a: string, d: string, h: string) {
    if (d !== "" && h !== "" && d > h) return; // R12: la combinacion invalida no se emite
    onChange([a, d, h]);
  }

  function elegirAtajo(v: string) {
    setAtajo(v);
    setDesde("");
    setHasta("");
    emitir(v, "", ""); // R10: el atajo vacia el rango
  }

  function cambiarDesde(v: string) {
    setAtajo(""); // R10: fijar una fecha vacia el atajo
    setDesde(v);
    emitir("", v, hasta);
  }

  function cambiarHasta(v: string) {
    setAtajo("");
    setHasta(v);
    emitir("", desde, v);
  }

  function limpiar() {
    setAtajo("");
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
      {shortcuts.length > 0 ? (
        <div className="flex min-w-44 flex-col gap-1.5">
          <Label htmlFor={`${idBase}-atajo`}>{label}</Label>
          <Select
            id={`${idBase}-atajo`}
            aria-label={label}
            value={atajo}
            onValueChange={elegirAtajo}
            options={shortcuts}
            placeholder={placeholder}
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idDesde}>Desde</Label>
        <Input
          id={idDesde}
          type="date"
          className="w-40"
          value={desde}
          max={hasta || undefined}
          disabled={disabled}
          aria-invalid={invertido || undefined}
          aria-describedby={invertido ? idError : undefined}
          onChange={(e) => cambiarDesde(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idHasta}>Hasta</Label>
        <Input
          id={idHasta}
          type="date"
          className="w-40"
          value={hasta}
          min={desde || undefined}
          disabled={disabled}
          aria-invalid={invertido || undefined}
          aria-describedby={invertido ? idError : undefined}
          onChange={(e) => cambiarHasta(e.target.value)}
        />
      </div>

      {haySeleccion ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={limpiar}
        >
          <X className="h-4 w-4" aria-hidden />
          Limpiar
        </Button>
      ) : null}

      {invertido ? (
        <p id={idError} role="alert" className="w-full text-sm text-destructive">
          La fecha inicial no puede ser posterior a la final.
        </p>
      ) : null}
    </div>
  );
}
