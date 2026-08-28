"use client";

import { useState } from "react";
import { Check, Copy, UserRound } from "lucide-react";

import type { ChatContactoNormalizado } from "@/lib/types/chat-contactos";

// Feature 299 (R31, D5) — tarjeta de un `contacts` compartido por el cliente.
//
// CADA dato se puede copiar por separado: el mensajero suele necesitar EL TELEFONO, no la
// tarjeta entera. La confirmacion es un `role="status"` (region viva que el lector de pantalla
// anuncia) MAS el cambio de icono: NO depende de ninguna animacion, porque en las maquinas del
// equipo `prefers-reduced-motion: reduce` esta activo y una confirmacion animada seria
// invisible.
//
// PII: el contenido de un contacto es dato personal de un TERCERO. Se pinta (es justo lo que
// pide D5) pero NO se loguea en ninguna rama, ni siquiera cuando el copiado falla (R35).

/** Milisegundos que dura el "Copiado" antes de volver al estado normal. */
const CONFIRMACION_MS = 2000;

interface DatoCopiable {
  /** Etiqueta accesible del dato ("teléfono", "correo"…). */
  clase: string;
  /** Sub-etiqueta que puso el cliente ("CELL", "WORK"…), o `null`. */
  etiqueta: string | null;
  valor: string;
}

function datosDelContacto(contacto: ChatContactoNormalizado): DatoCopiable[] {
  return [
    ...contacto.telefonos.map((t) => ({
      clase: "teléfono",
      etiqueta: t.tipo,
      valor: t.valor,
    })),
    ...contacto.correos.map((c) => ({
      clase: "correo",
      etiqueta: c.tipo,
      valor: c.valor,
    })),
    ...contacto.direcciones.map((d) => ({
      clase: "dirección",
      etiqueta: null,
      valor: d,
    })),
    ...contacto.urls.map((u) => ({ clase: "enlace", etiqueta: null, valor: u })),
  ];
}

export interface TarjetaContactoProps {
  contactos: readonly ChatContactoNormalizado[];
}

export function TarjetaContacto({ contactos }: Readonly<TarjetaContactoProps>) {
  // Mensaje de la region viva. Vacio = nada que anunciar; el nodo existe desde el primer
  // render para que el lector de pantalla ya lo este observando cuando cambie.
  const [confirmacion, setConfirmacion] = useState("");

  async function copiar(dato: DatoCopiable): Promise<void> {
    try {
      await navigator.clipboard.writeText(dato.valor);
      setConfirmacion(`Copiado: ${dato.clase}`);
    } catch {
      // Sin permiso de portapapeles (o navegador sin API). Se dice, no se loguea (R35).
      setConfirmacion(`No se pudo copiar el ${dato.clase}`);
    }
    window.setTimeout(() => setConfirmacion(""), CONFIRMACION_MS);
  }

  return (
    <div className="flex flex-col gap-2">
      {contactos.map((contacto, indice) => (
        <div key={`${contacto.nombre}-${indice}`} className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <UserRound className="size-4 shrink-0" aria-hidden="true" />
            {contacto.nombre}
          </p>
          {contacto.organizacion === null ? null : (
            <p className="text-[11px] text-muted-foreground">{contacto.organizacion}</p>
          )}
          <ul className="flex flex-col gap-1">
            {datosDelContacto(contacto).map((dato) => (
              <li
                key={`${dato.clase}-${dato.valor}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="min-w-0 flex-1 break-all">
                  {dato.etiqueta === null ? null : (
                    <span className="mr-1 text-[10px] uppercase text-muted-foreground">
                      {dato.etiqueta}
                    </span>
                  )}
                  {dato.valor}
                </span>
                <button
                  type="button"
                  onClick={() => void copiar(dato)}
                  aria-label={`Copiar ${dato.clase} ${dato.valor}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {confirmacion === `Copiado: ${dato.clase}` ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* R31: confirmacion PERCEPTIBLE sin animacion. La region existe siempre. */}
      <span role="status" className="text-[11px] text-muted-foreground">
        {confirmacion}
      </span>
    </div>
  );
}
