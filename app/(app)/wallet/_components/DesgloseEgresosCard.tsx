"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DesgloseEgresosDTO } from "@/lib/types/wallet";

import { money } from "./wallet-labels";

// Feature 45 (T10, R11/R12) — tarjeta del DESGLOSE de egresos administrativos por tipo
// (gasto fijo / gasto variable / sueldo) del CONJUNTO FILTRADO. El módulo recalcula el
// desglose server-side con los MISMOS filtros que el libro y lo pasa por props ya
// serializado; el cliente NUNCA recalcula montos. Money-safe: los cuatro totales llegan
// como STRING y se renderizan TAL CUAL con `money`, sin parseFloat/Number.

/** Filas del desglose: etiqueta i18n-ready + el monto STRING que le corresponde. */
const FILAS: { key: keyof Omit<DesgloseEgresosDTO, "total">; label: string }[] = [
  { key: "gastoFijo", label: "Gastos fijos" },
  { key: "gastoVariable", label: "Gastos variables" },
  { key: "sueldo", label: "Sueldos" },
];

export interface DesgloseEgresosCardProps {
  desglose: DesgloseEgresosDTO;
}

export function DesgloseEgresosCard({ desglose }: DesgloseEgresosCardProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Egresos administrativos</CardTitle>
      </CardHeader>
      <CardContent>
        <dl
          role="group"
          aria-label="Desglose de egresos administrativos"
          className="flex flex-col gap-3"
        >
          {FILAS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium text-destructive">
                {money(desglose[key])}
              </dd>
            </div>
          ))}

          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <dt className="text-sm font-medium">Total de egresos</dt>
            <dd className="text-base font-semibold text-destructive">
              {money(desglose.total)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
