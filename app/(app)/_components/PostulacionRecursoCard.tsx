"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  PostulacionRecursoDTO,
  RecursoTipo,
} from "@/lib/types/postulacion-recurso";

// Feature 253 (T7.1, R29) — la tarjeta de UNA postulacion de vehiculo o bodega.
//
// Presentacional pura, molde de `PostulacionCard` (feature 23): no obtiene datos propios, recibe
// la DTO y un callback. No sabe de SWR, ni de Server Actions, ni de paginacion.

/**
 * D1 FIRMADA — las dos clases van MEZCLADAS en una sola lista, con la etiqueta del tipo bien
 * visible en cada tarjeta. Dos bloques separados duplicarian paginacion y estado vacio para
 * repartir un volumen que se espera de unidades.
 */
const ETIQUETA_POR_TIPO: Record<RecursoTipo, string> = {
  vehiculo: "Vehículo",
  bodega: "Bodega",
};

/**
 * Formateo FIJO a la zona de Costa Rica, igual que `HiloNotasOrden` y `HistorialOrdenTimeline`:
 * la hora que se lee en el panel no debe depender de la zona del dispositivo que renderiza.
 */
const FECHA_HORA = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** ISO-8601 -> texto legible. Una fecha ilegible no rompe la tarjeta: cae a la raya. */
function formatFechaHora(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "—" : FECHA_HORA.format(new Date(ms));
}

/** Fila etiqueta/valor. `break-words` porque un correo largo no puede desbordar la tarjeta. */
function Dato({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
}

export interface PostulacionRecursoCardProps {
  /** La postulacion proyectada por el backend. */
  readonly postulacion: PostulacionRecursoDTO;
  /**
   * Intencion de marcarla atendida (el panel abre la confirmacion). Se omite en la pestana de
   * atendidas: alli no hay nada que hacer sobre la fila.
   */
  readonly onAtender?: (postulacion: PostulacionRecursoDTO) => void;
  /** Deshabilita la accion (p. ej. mientras corre otra). */
  readonly disabled?: boolean;
}

/**
 * R29 — la tarjeta muestra los SEIS datos que el administrador necesita para levantar el
 * telefono: tipo, nombre, telefono, correo, **el mensaje completo** y la fecha en que llego.
 *
 * ⚠️ EL MENSAJE NO SE RECORTA. Es lo unico que describe el vehiculo o la bodega —el `tipo` solo
 * dice por que tarjeta entro la persona (P5)— y un `line-clamp` obligaria a abrir un detalle que
 * no existe. Va topado en origen a 1.000 caracteres (D3), asi que cabe.
 */
export function PostulacionRecursoCard({
  postulacion,
  onAtender,
  disabled = false,
}: PostulacionRecursoCardProps) {
  const etiquetaTipo = ETIQUETA_POR_TIPO[postulacion.tipo];

  return (
    <Card
      aria-label={`Postulación de ${etiquetaTipo.toLowerCase()} de ${postulacion.nombre}`}
      data-testid={`postulacion-recurso-${postulacion.id}`}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{etiquetaTipo}</Badge>
          <span>{postulacion.nombre}</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Dato label="Teléfono" value={postulacion.telefono} />
          <Dato label="Correo" value={postulacion.correo} />
        </dl>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            Lo que nos contó
          </span>
          <p className="text-sm break-words whitespace-pre-wrap">
            {postulacion.mensaje}
          </p>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">Llegó</span>
          <time dateTime={postulacion.createdAt} className="text-sm">
            {formatFechaHora(postulacion.createdAt)}
          </time>
        </div>

        {/*
          R31/R33 — la pestana de atendidas existe para que un clic equivocado no deje una
          postulacion inalcanzable, asi que dice QUIEN la atendio y CUANDO: sin esas dos cosas,
          "atendida" no responde a la unica pregunta que se hace al mirar aqui.
        */}
        {postulacion.atendidaAt ? (
          <p className="text-sm text-muted-foreground">
            Atendida por {postulacion.atendidaPor ?? "—"} el{" "}
            <time dateTime={postulacion.atendidaAt}>
              {formatFechaHora(postulacion.atendidaAt)}
            </time>
          </p>
        ) : null}
      </CardContent>

      {onAtender ? (
        <div className="flex flex-wrap justify-end gap-2 px-(--card-spacing)">
          <Button
            type="button"
            variant="default"
            disabled={disabled}
            onClick={() => onAtender(postulacion)}
          >
            Marcar como atendida
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
