import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

interface VolverAlInicioLinkProps {
  /**
   * Texto visible del enlace, que ES su nombre accesible. Se recibe como
   * `children` (con un valor por defecto compartido) para que la traducción
   * futura entre por props y no haya que tocar el componente.
   */
  children?: ReactNode;
  /** Ajustes de posición del contenedor que lo monta. */
  className?: string;
}

/**
 * Salida a la landing (`/`) desde las pantallas públicas con formulario
 * (login y postulación). Único componente para los dos usos: son idénticos y
 * duplicarlos garantiza que diverjan.
 *
 * Tres decisiones que NO son de estilo:
 *
 * 1. **Es un `<Link href="/">`, no un `history.back()`.** A `/login` se llega
 *    también por redirección (`/login?redirect=/algo`), y "atrás" devolvería a
 *    la página privada que expulsó al visitante —que lo volvería a expulsar— o
 *    a ninguna parte si la pestaña es nueva. El destino es la landing, siempre.
 * 2. **Lleva texto, no solo la flecha.** En una pantalla sin cabecera, una
 *    flecha suelta no dice a dónde lleva. La flecha es `aria-hidden`: el nombre
 *    accesible sale del texto.
 * 3. **Vive en el panel del formulario, no en el de marca.** El panel de marca
 *    es `hidden ... md:flex`: puesto ahí, en móvil —donde es la ÚNICA salida—
 *    no existiría.
 *
 * Presentación pura y server-compatible: un `<Link>` no necesita cliente, así
 * que las dos páginas siguen siendo Server Components.
 *
 * Color por tokens (`muted-foreground` / `accent`), porque el panel que lo
 * monta es `bg-background` y gira con el tema (DESIGN.md, feature 208).
 * `min-h-11` deja un área táctil cómoda en móvil.
 */
export function VolverAlInicioLink({
  children = "Volver al inicio",
  className,
}: Readonly<VolverAlInicioLinkProps>) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </Link>
  );
}
