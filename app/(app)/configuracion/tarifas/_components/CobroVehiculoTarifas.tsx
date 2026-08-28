"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/shared/FormField";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

import {
  AVISO_MONTO_CERO,
  PAGO_ZONA_TEXTO,
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
 * La ayuda de un monto: SIEMPRE quién lo cobra, y además el aviso si se va a guardar en cero.
 *
 * Las dos frases van en `<span>` separados dentro del mismo `<p>` de `FormField`, que es el
 * que cuelga del campo por `aria-describedby`: quien usa un lector de pantalla oye primero de
 * quién es el dinero y después, si toca, que está sin configurar.
 */
function AyudaMonto({
  destino,
  enCero,
}: Readonly<{ destino: string; enCero: boolean }>) {
  return (
    <>
      <span>{destino}</span>
      {enCero ? (
        <>
          {" "}
          <span className="font-medium">{AVISO_MONTO_CERO.pago}</span>
        </>
      ) : null}
    </>
  );
}

/**
 * Bloque reusable: los 2 inputs de monto, con un título encima sólo si se le da uno.
 *
 * Feature 303 — pasa a `FormField` por DOS motivos, ninguno de negocio: el `Label` suelto no
 * estaba asociado a su `Input` (sin `htmlFor`/`id`, un lector de pantalla no leía nada), y la
 * ayuda de cada monto necesita colgar del campo por `aria-describedby`. `idPrefix` mantiene
 * los ids únicos cuando hay un bloque por vehículo.
 *
 * Feature 310 — `label` pasa a OPCIONAL: con un solo bloque, el título de la sección ya lo
 * nombra y repetirlo aquí eran dos títulos casi iguales seguidos. Con cobro por vehículo
 * sigue habiendo uno por bloque, y ahí es imprescindible: dice de qué vehículo son los montos.
 */
function MontoBlock({
  idPrefix,
  label,
  value,
  onChange,
}: Readonly<{
  idPrefix: string;
  label?: string;
  value: Monto;
  onChange: (next: Monto) => void;
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <p className="text-sm font-medium">{label}</p> : null}
      {/* Feature 310 — `rowAligned`: la ayuda de la izquierda ocupa un renglón y la de la
          derecha dos, así que sin alinear por fila los dos `Input` quedaban a distinta
          altura; el aviso del cero, que aparece en uno y no en el otro, lo agravaba. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          id={`${idPrefix}-entregado`}
          label={PAGO_ZONA_TEXTO.entregado}
          labelClassName="text-xs text-muted-foreground"
          rowAligned
          hint={
            <AyudaMonto
              destino={PAGO_ZONA_TEXTO.entregadoDestino}
              enCero={seGuardaComoCero(value.entregado)}
            />
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
          label={PAGO_ZONA_TEXTO.rechazado}
          labelClassName="text-xs text-muted-foreground"
          rowAligned
          hint={
            <AyudaMonto
              destino={PAGO_ZONA_TEXTO.rechazadoDestino}
              enCero={seGuardaComoCero(value.noEntregado)}
            />
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

  // Feature 310 — este bloque YA NO se titula. Lo hacía para no llamarse «Monto» a secas
  // (feature 303), pero quien lo envuelve —la sección «Pagos por zona» de `CrearZonaForm`—
  // ya lo nombra justo encima, y quedaban dos títulos casi iguales seguidos. Lo que el título
  // aportaba no se pierde: la ayuda de la sección dice a quién va cada dinero y la de cada
  // campo lo repite en su sitio. Con cobro por vehículo, cada bloque sigue titulado con el
  // NOMBRE DEL VEHÍCULO, que es lo único que ahí no se puede deducir.
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
          value={montoDefault}
          onChange={setMontoDefault}
        />
      )}
    </section>
  );
}
