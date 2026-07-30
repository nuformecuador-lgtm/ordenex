"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DesgloseEgresosDTO } from "@/lib/types/wallet";

import { money } from "./wallet-labels";

// Feature 45 (T10, R11/R12) — tarjeta del DESGLOSE de egresos por concepto del CONJUNTO
// FILTRADO. El módulo recalcula el desglose server-side con los MISMOS filtros que el libro y
// lo pasa por props ya serializado; el cliente NUNCA recalcula montos. Money-safe: todos los
// totales llegan como STRING y se renderizan TAL CUAL con `money`, sin parseFloat/Number.
//
// Feature 158 (T2.5, R32) — entra la fila "Indemnizaciones" y CAMBIA EL COPY del título. La
// tarjeta se llamaba "Egresos administrativos", que era exacto mientras sus tres conceptos
// (gasto fijo, gasto variable, sueldo) fueran administrativos. La indemnización por incidente
// NO lo es: es un egreso OPERATIVO, nace de un paquete dañado, perdido o robado. Dejar el
// título viejo con la fila nueva dentro convertiría el rótulo en una mentira, y encima una
// mentira sobre dinero. Por eso el título pasa a "Egresos" y una línea de descripción dice
// exactamente qué entra y qué no: la tarjeta NO es el total de todos los egresos de la caja
// (no incluye los pagos a tiendas ni a mensajeros), y eso antes tampoco se decía.

// --- Textos i18n-ready (separados de la lógica, docs/conventions) ---
const TITULO = "Egresos";
const DESCRIPCION =
  "Gastos, sueldos e indemnizaciones del conjunto filtrado. No incluye los pagos a tiendas ni a mensajeros.";
const GRUPO_ARIA = "Desglose de egresos";
const TOTAL_LABEL = "Total de egresos";

/** Filas del desglose: etiqueta i18n-ready + el monto STRING que le corresponde. */
const FILAS: { key: keyof Omit<DesgloseEgresosDTO, "total">; label: string }[] = [
  { key: "gastoFijo", label: "Gastos fijos" },
  { key: "gastoVariable", label: "Gastos variables" },
  { key: "sueldo", label: "Sueldos" },
  // Feature 158/R32: la indemnizacion entra en el TOTAL desde el backend (T1.16), asi que su
  // fila tiene que estar aqui o el total dejaria de cuadrar con lo que se ve.
  { key: "indemnizacion", label: "Indemnizaciones" },
];

export interface DesgloseEgresosCardProps {
  desglose: DesgloseEgresosDTO;
}

export function DesgloseEgresosCard({ desglose }: DesgloseEgresosCardProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{TITULO}</CardTitle>
        <CardDescription>{DESCRIPCION}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl role="group" aria-label={GRUPO_ARIA} className="flex flex-col gap-3">
          {FILAS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium text-danger-strong">
                {money(desglose[key])}
              </dd>
            </div>
          ))}

          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <dt className="text-sm font-medium">{TOTAL_LABEL}</dt>
            <dd className="text-base font-semibold text-danger-strong">
              {money(desglose.total)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
