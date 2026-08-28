"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/shared/FormField";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

import {
  AVISO_MONTO_CERO,
  PAGO_MENSAJERO_ZONA_TEXTO,
  seGuardaComoCero,
} from "./tarifas-labels";

/**
 * Un par de montos por tarifa. `noEntregado` es el nombre del CAMPO del formulario y se queda
 * como está —lo lee `cobroRechazado` aguas abajo—; lo que cambió (feature 303) es lo que se
 * LEE en pantalla: sólo un resultado `rechazada` paga ese monto.
 */
interface Monto {
  entregado: string;
  noEntregado: string;
}

const montoVacio = (): Monto => ({ entregado: "", noEntregado: "" });

/**
 * Bloque reusable: título + los 2 inputs de monto.
 *
 * Feature 303 — pasa a `FormField` por DOS motivos, ninguno de negocio: el `Label` suelto no
 * estaba asociado a su `Input` (sin `htmlFor`/`id`, un lector de pantalla no leía nada), y el
 * aviso del cero necesita colgar del campo por `aria-describedby`. `idPrefix` mantiene los
 * ids únicos cuando hay un bloque por vehículo.
 */
function MontoBlock({
  idPrefix,
  label,
  value,
  onChange,
}: Readonly<{
  idPrefix: string;
  label: string;
  value: Monto;
  onChange: (next: Monto) => void;
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          id={`${idPrefix}-entregado`}
          label={PAGO_MENSAJERO_ZONA_TEXTO.entregado}
          labelClassName="text-xs text-muted-foreground"
          hint={
            seGuardaComoCero(value.entregado) ? AVISO_MONTO_CERO.pago : undefined
          }
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            value={value.entregado}
            placeholder="0.00"
            onChange={(e) => onChange({ ...value, entregado: e.target.value })}
          />
        </FormField>
        <FormField
          id={`${idPrefix}-no-entregado`}
          label={PAGO_MENSAJERO_ZONA_TEXTO.rechazado}
          labelClassName="text-xs text-muted-foreground"
          hint={
            seGuardaComoCero(value.noEntregado)
              ? AVISO_MONTO_CERO.pago
              : undefined
          }
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            value={value.noEntregado}
            placeholder="0.00"
            onChange={(e) => onChange({ ...value, noEntregado: e.target.value })}
          />
        </FormField>
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

  // Feature 303 — el título dice DE QUIÉN es el dinero. «Monto» a secas no se distinguía de
  // las tarifas que se le COBRAN a la tienda, que viven en la misma pantalla y son el dinero
  // contrario.
  const label = cobroVehiculo
    ? PAGO_MENSAJERO_ZONA_TEXTO.tituloPorVehiculo
    : PAGO_MENSAJERO_ZONA_TEXTO.titulo;

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
              idPrefix={`cobro-vehiculo-${v.id}`}
              label={v.name}
              value={montosPorVehiculo[v.id] ?? montoVacio()}
              onChange={(next) => setMontoVehiculo(v.id, next)}
            />
          ))}
        </div>
      ) : (
        <MontoBlock
          idPrefix="cobro-zona"
          label={label}
          value={montoDefault}
          onChange={setMontoDefault}
        />
      )}
    </section>
  );
}
