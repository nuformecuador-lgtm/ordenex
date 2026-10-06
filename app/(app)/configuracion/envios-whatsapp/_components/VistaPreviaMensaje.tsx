"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { componerVistaPrevia } from "@/lib/utils/vista-previa-informe";

export interface VistaPreviaMensajeProps {
  /** Cuerpo de la plantilla elegida; `null` = aún no hay plantilla. */
  cuerpo: string | null;
  /** Las variables del informe (ya incluyen la común `destinatario_nombre`, R53). */
  variables: readonly { clave: string; nombre: string; descripcion: string; ejemplo: string }[];
  /** La plantilla lleva cabecera documento: se pinta la tarjeta del PDF encima del texto. */
  conDocumento: boolean;
  /** Nombre de quien lo va a leer en la vista previa (el primer destinatario), si hay. */
  lector: string | null;
}

/**
 * Ficha 474 (R4, R53) — «Vista previa» + «De dónde sale cada dato» de la maqueta aprobada
 * (`Formulario.dc.html`). Los valores son los EJEMPLOS del catálogo del informe; el nombre del
 * destinatario es el del primer destinatario real si lo hay (la maqueta: «Lo que va a leer Daniel
 * Mora»), que es justo lo que R53 dice que cambia por entrega.
 *
 * En el teléfono va plegada (`FormularioMovil.dc.html`, «Ver vista previa del mensaje»); en
 * escritorio siempre abierta, en la columna derecha. Un solo árbol: el plegado es una clase, no
 * una segunda copia del contenido.
 */
export function VistaPreviaMensaje({ cuerpo, variables, conDocumento, lector }: VistaPreviaMensajeProps) {
  const [abierta, setAbierta] = useState(false);
  const contenidoId = useId();
  const primerNombre = lector?.trim().split(/\s+/)[0] ?? null;
  const valores: Record<string, string> = primerNombre ? { destinatario_nombre: primerNombre } : {};
  const previa = cuerpo === null ? null : componerVistaPrevia(cuerpo, variables, valores);

  return (
    <section aria-label="Vista previa del mensaje" className="flex flex-col gap-3">
      <button
        type="button"
        className="flex min-h-11 items-center justify-between rounded-xl border border-border bg-card px-4 text-sm font-medium lg:hidden"
        aria-expanded={abierta}
        aria-controls={contenidoId}
        onClick={() => setAbierta((a) => !a)}
      >
        Ver vista previa del mensaje
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", abierta && "rotate-180")} />
      </button>

      <div id={contenidoId} className={cn("flex-col gap-3", abierta ? "flex" : "hidden lg:flex")}>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Vista previa</Badge>
          {lector ? <span className="text-sm text-muted-foreground">Lo que va a leer {lector}</span> : null}
        </div>

        {previa === null ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Elige una plantilla para ver el mensaje.
          </p>
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="rounded-lg bg-muted p-3 text-sm leading-relaxed">
                {conDocumento ? (
                  <div className="mb-3 flex items-center gap-3 rounded-md border border-border bg-card p-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-8 items-end justify-center rounded bg-danger-soft pb-1 text-[10px] font-bold text-danger-strong"
                    >
                      PDF
                    </span>
                    <span className="text-sm font-medium">Documento PDF del informe</span>
                  </div>
                ) : null}
                <p data-testid="vista-previa-texto" className="whitespace-pre-wrap break-words">
                  {previa.texto}
                </p>
              </div>
            </div>

            {previa.datos.length > 0 ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-2 text-sm font-semibold">De dónde sale cada dato</p>
                <table className="w-full text-xs">
                  <caption className="sr-only">Variables de la plantilla y su valor de ejemplo</caption>
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Posición</th>
                      <th scope="col">Dato</th>
                      <th scope="col">Ejemplo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.datos.map((d) => (
                      <tr key={d.clave}>
                        <td className="py-1 pr-2 font-mono text-muted-foreground">{`{{${d.posicion}}}`}</td>
                        <td className="py-1 pr-2">
                          {d.conocida ? d.nombre : <span className="text-danger-strong">{`{{${d.clave}}}`} no es un dato de este informe</span>}
                        </td>
                        <td className="py-1 text-right">{d.conocida ? d.valor : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  Los valores son de ejemplo. Al enviar se calculan con los datos de ese momento.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
