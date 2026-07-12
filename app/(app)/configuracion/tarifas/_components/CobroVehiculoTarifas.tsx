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
export function CobroVehiculoTarifas({
  vehiculos,
}: {
  vehiculos: VehiculoDTO[];
}) {
  const sinVehiculos = vehiculos.length === 0;

  const [cobroVehiculo, setCobroVehiculo] = useState(false);
  // Monto único (cobroVehiculo=false).
  const [montoDefault, setMontoDefault] = useState<Monto>(montoVacio);
  // Monto por vehículo (cobroVehiculo=true): vehiculoId -> Monto.
  const [montosPorVehiculo, setMontosPorVehiculo] = useState<
    Record<string, Monto>
  >({});

  function setMontoVehiculo(id: string, next: Monto) {
    setMontosPorVehiculo((prev) => ({ ...prev, [id]: next }));
  }

  // Datos de tarifa listos para consumir (y para inspeccionar en consola).
  const tarifaData = useMemo(() => {
    if (cobroVehiculo) {
      return {
        cobroVehiculo: true as const,
        tarifas: vehiculos.map((v) => {
          const m = montosPorVehiculo[v.id] ?? montoVacio();
          return {
            vehiculoId: v.id,
            vehiculo: v.name,
            cobroEntregado: m.entregado,
            cobroRechazado: m.noEntregado,
          };
        }),
      };
    }
    return {
      cobroVehiculo: false as const,
      tarifa: {
        cobroEntregado: montoDefault.entregado,
        cobroRechazado: montoDefault.noEntregado,
      },
    };
  }, [cobroVehiculo, vehiculos, montosPorVehiculo, montoDefault]);

  useEffect(() => {
    console.log("[Tarifas] Cobro/monto:", tarifaData);
  }, [tarifaData]);

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
