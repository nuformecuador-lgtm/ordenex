"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { agruparDocumentos, filtrarDocumentos } from "@/lib/ayuda/documento";
import type { ResumenDocumento } from "@/lib/ayuda/documento";
import { cn } from "@/lib/utils";

/**
 * ⭑ FICHA 433 — el índice del módulo: la columna de la izquierda, con su buscador.
 *
 * ⚠️ RECIBE LOS DOCUMENTOS YA ACOTADOS POR ROL. La página padre (server) resuelve la sesión y
 * le pasa sólo lo que esta persona puede leer, así que un mensajero no encuentra «Wallet ·
 * Caja» escribiendo «wallet» en el buscador: no está en la lista sobre la que se busca. El
 * acotamiento NO es un filtro de presentación que se pueda desactivar desde aquí.
 *
 * Es cliente sólo por el buscador (un `useState` sobre una lista que ya tiene en la mano). No
 * pide datos: filtrar 31 títulos en memoria no merece una ida y vuelta al servidor, y así
 * responde a cada tecla incluso con mala señal — que es la situación del mensajero en la calle.
 *
 * MÓVIL (390px, 18 de los 37 usuarios). En el índice (`/ayuda`) la lista ocupa el ancho
 * entero; dentro de un documento se esconde, porque 31 enlaces por delante del texto obligan
 * a bajar media pantalla antes de empezar a leer. La vuelta al índice la da el enlace del pie
 * del documento. A partir de `lg` las dos columnas conviven y esto no se nota.
 */
export function AyudaIndice({
  documentos,
  className,
}: Readonly<{ documentos: readonly ResumenDocumento[]; className?: string }>) {
  const [consulta, setConsulta] = useState("");
  const pathname = usePathname();
  const idBuscador = useId();

  const grupos = useMemo(
    () => agruparDocumentos(filtrarDocumentos(documentos, consulta)),
    [documentos, consulta],
  );

  const enElIndice = pathname === "/ayuda";
  const totalFiltrado = grupos.reduce((suma, grupo) => suma + grupo.documentos.length, 0);

  return (
    <nav
      // `aria-label` y no un título visible: es una región de navegación, y quien usa lector
      // de pantalla la encuentra por su nombre sin que ocupe sitio en el teléfono.
      aria-label="Índice de la ayuda"
      className={cn(enElIndice ? "block" : "hidden lg:block", className)}
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <label htmlFor={idBuscador} className="sr-only">
            Buscar en la ayuda
          </label>
          <Input
            id={idBuscador}
            type="search"
            value={consulta}
            onChange={(evento) => setConsulta(evento.target.value)}
            placeholder="Buscar…"
            className="pl-9"
          />
        </div>

        {/* El resultado del buscador se ANUNCIA. Sin esto, quien no ve la lista teclea y no
            recibe ninguna señal de que algo cambió — ni de que no quedó nada. */}
        <p aria-live="polite" className="sr-only">
          {consulta === ""
            ? ""
            : `${totalFiltrado} ${totalFiltrado === 1 ? "documento" : "documentos"}`}
        </p>

        {totalFiltrado === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay ningún documento que se llame así. Probá con el nombre de la pantalla.
          </p>
        ) : null}

        {grupos.map((grupo) => (
          <div key={grupo.clave} className="flex flex-col gap-1">
            <h2 className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {grupo.etiqueta}
            </h2>
            <ul className="flex flex-col">
              {grupo.documentos.map((doc) => {
                const href = `/ayuda/${doc.slug}`;
                const activo = pathname === href;
                return (
                  <li key={doc.slug}>
                    <Link
                      href={href}
                      // `aria-current="page"` y no sólo un color: el estado activo tiene que
                      // llegar también a quien no ve el fondo resaltado.
                      aria-current={activo ? "page" : undefined}
                      className={cn(
                        // Anillo de foco OPACO (`DESIGN.md`, pieza nueva). `min-h-11`: objetivo
                        // de toque de 44px para el teléfono, que es donde esto se usa de verdad.
                        "flex min-h-11 items-center rounded-md px-2 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
                        activo
                          ? "bg-primary/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {doc.titulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
