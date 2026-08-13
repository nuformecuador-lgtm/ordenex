import { Card, CardContent } from "@/components/ui/card";
import type { MisAsignacionesKpis } from "@/lib/interfaces/services/IMisAsignacionesService";

import { KpiValorAnimado } from "./KpiValorAnimado";

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
  /** Icono en `public/icons/`. Se sirve con <img>: next/image falla aquí. */
  icon: string;
  render: (kpis: MisAsignacionesKpis) => React.ReactNode;
}

const TILES: Tile[] = [
  {
    label: "Pendientes",
    icon: "/icons/icono_envios.png",
    render: (k) => <KpiValorAnimado value={k.pendientes} />,
  },
  {
    label: "Entregadas",
    icon: "/icons/icono_entregadas.png",
    render: (k) => <KpiValorAnimado value={k.entregadas} />,
  },
  {
    label: "Por cobrar",
    icon: "/icons/icono_wallet.png",
    render: (k) => <KpiValorAnimado value={k.porCobrar} moneda />,
  },
  {
    label: "Total a cobrar",
    icon: "/icons/icono_transacciones.png",
    render: (k) => <KpiValorAnimado value={k.totalACobrar} moneda />,
  },
];

export function KpisMensajero({ kpis }: Readonly<KpisMensajeroProps>) {
  return (
    <section
      aria-label="Indicadores de mis asignaciones"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      {TILES.map((tile) => (
        <Card
          key={tile.label}
          // Sombra permanente + degradado morado claro → blanco al pasar el
          // cursor. background-image no interpola, así que el degradado vive
          // siempre en un ::before y lo que se anima es su opacidad.
          className="relative overflow-hidden shadow-xl transition-shadow duration-300 hover:shadow-lg before:pointer-events-none before:absolute before:inset-0 before:bg-linear-to-br before:from-purple-200 before:to-white before:opacity-0 before:transition-opacity before:duration-300 before:content-[''] hover:before:opacity-100"
        >
          <CardContent className="relative flex items-center gap-3 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              aria-hidden="true"
              src={tile.icon}
              alt=""
              width={56}
              height={56}
              className="size-14 shrink-0 object-contain"
            />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted-foreground">
                {tile.label}
              </span>
              {/* Feature 208: era `text-navy` fijo. Estos KPIs son DINERO ("Por
                  cobrar", "Total a cobrar") sobre una `Card`, que sí gira con el
                  tema: en oscuro la cifra medía 1.06:1, o sea no se veía. */}
              <span className="text-2xl font-semibold text-foreground">
                {tile.render(kpis)}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
