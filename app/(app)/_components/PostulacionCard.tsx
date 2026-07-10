"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PostulacionPendienteDTO } from "@/lib/types/aprobacion-postulacion";

import { DOCUMENTO_ORDEN, labelDocumento } from "./postulacion-documento-labels";

export interface PostulacionCardProps {
  /** Datos de la postulacion pendiente proyectada por el backend (feature 22). */
  postulacion: PostulacionPendienteDTO;
  /** Intencion de aprobar esta postulacion (el panel abre la confirmacion). */
  onAprobar: (postulacion: PostulacionPendienteDTO) => void;
  /** Intencion de rechazar esta postulacion (el panel abre la confirmacion). */
  onRechazar: (postulacion: PostulacionPendienteDTO) => void;
  /** Deshabilita las acciones (p. ej. mientras corre otra decision). */
  disabled?: boolean;
}

/** Marcador de campo nulo/vacio, sin romper el render (R7). */
const GUION = "—";

function valorOGuion(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : GUION;
}

function nombreCompleto(p: PostulacionPendienteDTO): string {
  return [p.nombre, p.primerApellido, p.segundoApellido]
    .filter((part): part is string => !!part && part.trim() !== "")
    .join(" ");
}

/** Fila etiqueta/valor de datos del mensajero. */
function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
}

/**
 * Tarjeta presentacional de UNA postulacion pendiente (feature 23, R7/R8/R13).
 * No obtiene datos propios: recibe la DTO y callbacks. Muestra los datos del
 * mensajero (nulos como guion), los 5 documentos como enlaces "Ver" en pestana
 * nueva y las acciones Aprobar/Rechazar. Ordena los documentos por tipo fijo.
 */
export function PostulacionCard({
  postulacion,
  onAprobar,
  onRechazar,
  disabled = false,
}: PostulacionCardProps) {
  const documentosOrdenados = [...postulacion.documentos].sort(
    (a, b) =>
      DOCUMENTO_ORDEN.indexOf(a.tipo) - DOCUMENTO_ORDEN.indexOf(b.tipo),
  );

  const nombre = nombreCompleto(postulacion);

  return (
    <Card
      aria-label={`Postulación de ${nombre}`}
      data-testid={`postulacion-${postulacion.usuarioId}`}
    >
      <CardHeader>
        <CardTitle>{nombre}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Dato label="Email" value={valorOGuion(postulacion.email)} />
          <Dato label="Teléfono" value={valorOGuion(postulacion.telefono)} />
          <Dato
            label="Tipo de identificación"
            value={valorOGuion(postulacion.tipoIdentificacion)}
          />
          <Dato label="Nº de documento" value={valorOGuion(postulacion.cedula)} />
          <Dato label="Vehículo" value={valorOGuion(postulacion.vehiculo)} />
          <Dato label="Placa" value={valorOGuion(postulacion.placa)} />
        </dl>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Documentos
          </span>
          <ul className="flex flex-wrap gap-2">
            {documentosOrdenados.map((doc) => (
              <li key={doc.tipo}>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-primary underline-offset-4 transition-colors hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Ver {labelDocumento(doc.tipo)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <div className="flex flex-wrap justify-end gap-2 px-(--card-spacing)">
        <Button
          type="button"
          variant="destructive"
          disabled={disabled}
          onClick={() => onRechazar(postulacion)}
        >
          Rechazar
        </Button>
        <Button
          type="button"
          variant="default"
          disabled={disabled}
          onClick={() => onAprobar(postulacion)}
        >
          Aprobar
        </Button>
      </div>
    </Card>
  );
}
