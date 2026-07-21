"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

// Un par de montos (entregado / no entregado) por tarifa.
interface Monto {
  entregado: string;
  noEntregado: string;
}

const montoVacio = (): Monto => ({ entregado: "", noEntregado: "" });

/** Bloque reusable: label opcional + los 2 inputs de monto. */
function MontoBlock({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: Monto;
  onChange: (next: Monto) => void;
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Entregado</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={value.entregado}
            placeholder="0.00"
            onChange={(e) => onChange({ ...value, entregado: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">No entregado</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={value.noEntregado}
            placeholder="0.00"
            onChange={(e) => onChange({ ...value, noEntregado: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Configuración de cobro de la zona. Por defecto `cobroVehiculo=false`: un único
 * bloque de "Monto". Al activar el toggle (sólo posible si hay vehículos en la
 * DB), la etiqueta cambia y se lista un bloque de monto por cada vehículo.
 */
/**
 * Valor normalizado (números) con la forma de `tarifas` que consume el esquema
 * de crear zona: cobroVehiculo + filas de tarifa_zona_mensajero.
 */
export interface CobroVehiculoValue {
  cobroVehiculo: boolean;
  tarifas: {
    cobroEntregado: number;
    cobroRechazado: number;
    vehiculoId?: string;
  }[];
}

export function CobroVehiculoTarifas({
  vehiculos,
  onChange,
  initial,
}: {
  vehiculos: VehiculoDTO[];
  /** Reporta al formulario contenedor el valor normalizado en cada cambio. */
  onChange?: (value: CobroVehiculoValue) => void;
  /** Valores pre-cargados (edición de zona). Se leen al montar. */
  initial?: CobroVehiculoValue;
}) {
  const sinVehiculos = vehiculos.length === 0;

  const [cobroVehiculo, setCobroVehiculo] = useState(
    initial?.cobroVehiculo ?? false,
  );
  // Monto único (cobroVehiculo=false).
  const [montoDefault, setMontoDefault] = useState<Monto>(() => {
    if (initial && !initial.cobroVehiculo && initial.tarifas[0]) {
      return {
        entregado: String(initial.tarifas[0].cobroEntregado),
        noEntregado: String(initial.tarifas[0].cobroRechazado),
      };
    }
    return montoVacio();
  });
  // Monto por vehículo (cobroVehiculo=true): vehiculoId -> Monto.
  const [montosPorVehiculo, setMontosPorVehiculo] = useState<
    Record<string, Monto>
  >(() => {
    const r: Record<string, Monto> = {};
    if (initial?.cobroVehiculo) {
      for (const t of initial.tarifas) {
        if (t.vehiculoId) {
          r[t.vehiculoId] = {
            entregado: String(t.cobroEntregado),
            noEntregado: String(t.cobroRechazado),
          };
        }
      }
    }
    return r;
  });

  function setMontoVehiculo(id: string, next: Monto) {
    setMontosPorVehiculo((prev) => ({ ...prev, [id]: next }));
  }

  // Valor normalizado (números) con la forma de `tarifas` de crear zona.
  const payload = useMemo<CobroVehiculoValue>(() => {
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    if (cobroVehiculo) {
      return {
        cobroVehiculo: true,
        tarifas: vehiculos.map((v) => {
          const m = montosPorVehiculo[v.id] ?? montoVacio();
          return {
            cobroEntregado: num(m.entregado),
            cobroRechazado: num(m.noEntregado),
            vehiculoId: v.id,
          };
        }),
      };
    }
    // cobroVehiculo=false: una sola tarifa "por defecto", sin vehiculoId.
    return {
      cobroVehiculo: false,
      tarifas: [
        {
          cobroEntregado: num(montoDefault.entregado),
          cobroRechazado: num(montoDefault.noEntregado),
        },
      ],
    };
  }, [cobroVehiculo, vehiculos, montosPorVehiculo, montoDefault]);

  useEffect(() => {
    onChange?.(payload);
    console.log("[Tarifas] Cobro/monto:", payload);
  }, [payload]);

  const label = cobroVehiculo ? "Monto por vehículo" : "Monto";

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <div className="flex items-center gap-2">
        <Checkbox
          id="cobroVehiculo"
          checked={cobroVehiculo}
          disabled={sinVehiculos}
          onCheckedChange={(next) => setCobroVehiculo(next === true)}
          aria-label="Cobro por vehículo"
        />
        <Label
          htmlFor="cobroVehiculo"
          className={sinVehiculos ? "text-muted-foreground" : undefined}
        >
          ¿Cobro por vehículo?
        </Label>
        {sinVehiculos ? (
          <span className="text-xs text-muted-foreground">
            (sin vehículos en la base de datos)
          </span>
        ) : null}
      </div>

      {cobroVehiculo ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium">{label}</p>
          {vehiculos.map((v) => (
            <MontoBlock
              key={v.id}
              label={v.name}
              value={montosPorVehiculo[v.id] ?? montoVacio()}
              onChange={(next) => setMontoVehiculo(v.id, next)}
            />
          ))}
        </div>
      ) : (
        <MontoBlock
          label={label}
          value={montoDefault}
          onChange={setMontoDefault}
        />
      )}
    </section>
  );
}
