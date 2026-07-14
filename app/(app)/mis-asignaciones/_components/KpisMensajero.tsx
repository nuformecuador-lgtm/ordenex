import { Truck, PackageCheck, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { PriceLabel } from "@/components/shared/PriceLabel";
import type { MisAsignacionesKpis } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 61 — fila de KPIs del portal del mensajero, sobre la lista de sus
// asignaciones. Los 3 indicadores vienen ya calculados server-side (autoritativos):
// `pendientes` = órdenes en reparto (en camino), `entregadas` = entregadas del
// mensajero, `porCobrar` = COD por recaudar de las órdenes en reparto. Componente
// de presentación puro (server-compatible), sin lógica ni fetch.

export interface KpisMensajeroProps {
  kpis: MisAsignacionesKpis;
}

interface Tile {
  label: string;
  icon: typeof Truck;
  render: (kpis: MisAsignacionesKpis) => React.ReactNode;
}

const TILES: Tile[] = [
  {
    label: "Pendientes",
    icon: Truck,
    render: (k) => <span className="tabular-nums">{k.pendientes}</span>,
  },
  {
    label: "Entregadas",
    icon: PackageCheck,
    render: (k) => <span className="tabular-nums">{k.entregadas}</span>,
  },
  {
    label: "Por cobrar",
    icon: Wallet,
    render: (k) => <PriceLabel value={k.porCobrar} />,
  },
];

export function KpisMensajero({ kpis }: Readonly<KpisMensajeroProps>) {
  return (
    <section
      aria-label="Indicadores de mis asignaciones"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {TILES.map((tile) => {
        const Icon = tile.icon;
        return (
          <Card key={tile.label}>
            <CardContent className="flex items-center gap-3 py-4">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy/10 text-navy"
              >
                <Icon className="size-5" />
              </span>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-muted-foreground">
                  {tile.label}
                </span>
                <span className="text-2xl font-semibold text-navy">
                  {tile.render(kpis)}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
