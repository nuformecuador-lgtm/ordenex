import Link from "next/link";

import type { WalletOrigenTipo } from "@/lib/types/wallet";

import { ORIGEN_ENLACE_VISIBLE, textoDeOrigen, type FilaConOrigenLegible } from "./origen-movimiento";

// Ficha 458-A (TA.2 pantalla, R5–R8) — la celda «Origen» de los libros de la wallet: el origen con
// su entidad y, si el rol que mira tiene acceso a esa pantalla, un enlace a ella (R7). Sin acceso, el
// servidor manda `enlace: null` y aqui solo queda el texto (R8). El identificador va SOLO en `href`.

export interface OrigenMovimientoProps {
  fila: FilaConOrigenLegible;
  /** El diccionario de origenes de ESTA superficie (caja, tienda o mensajero). */
  rotulos: Readonly<Record<WalletOrigenTipo, string>>;
}

export function OrigenMovimiento({ fila, rotulos }: Readonly<OrigenMovimientoProps>) {
  const texto = textoDeOrigen(fila, rotulos);
  const enlace = fila.origen?.enlace ?? null;
  if (enlace === null) return <>{texto}</>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{texto}</span>
      <Link
        href={enlace.href}
        aria-label={enlace.etiqueta}
        className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
      >
        {ORIGEN_ENLACE_VISIBLE}
      </Link>
    </span>
  );
}
