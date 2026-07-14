"use client";

import type { Ref } from "react";
import { QRCodeCanvas } from "qrcode.react";
import Barcode from "react-barcode";

import { formatMonto } from "@/lib/config/moneda";
import { buildPaqueteUrl } from "@/lib/utils/paquete-url";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

export interface EtiquetaGuiaProps {
  /** Payload resuelto por el backend (feature 32/R1). */
  etiqueta: EtiquetaGuiaDTO;
  /**
   * Ref al `<canvas>` del QR (qrcode.react lo reenvia al canvas nativo). El modal
   * lo recolecta para rasterizar el QR al PDF (decision F1.4 (c)/(d),
   * `canvas.toDataURL`); en la vista previa no es necesario.
   */
  qrCanvasRef?: Ref<HTMLCanvasElement>;
}

/** Marcador cuando la geografia no tiene distrito (R4: `distritoNombre` null). */
const SIN_DATO = "—"; // em dash

/** Tamano en px del canvas del QR: alto para un raster nitido en el PDF. */
const QR_RASTER_SIZE = 512;

/** Une los tramos de geografia disponibles; omite el distrito si es null (R4). */
function geografiaLegible(etiqueta: EtiquetaGuiaDTO): string {
  return [
    etiqueta.zonaNombre,
    etiqueta.provinciaNombre,
    etiqueta.cantonNombre,
    etiqueta.distritoNombre,
  ]
    .filter((parte): parte is string => Boolean(parte))
    .join(" / ");
}

/**
 * Feature 32 (T2.1, R9) — Etiqueta de guia presentacional: renderiza TODOS los
 * campos legibles de una orden imprimible + el QR (R7, `qrValue`) y el codigo de
 * barras (R8, `barcodeValue`). No decide que codificar: usa `qrValue`/
 * `barcodeValue` tal cual los resuelve el backend. `montoCobrar` se formatea con
 * la config de moneda (R5, sin hardcodear moneda); null -> "-". El contenedor se
 * marca a 100x100 mm para la vista previa, pero el PDF (jspdf) es la fuente de
 * verdad del tamano exacto (decision F1.4 (c)).
 */
export function EtiquetaGuia({ etiqueta, qrCanvasRef }: EtiquetaGuiaProps) {
  const {
    ordenId,
    numGuia,
    numRemision,
    destinatario,
    telefonoDest,
    direccion,
    producto,
    montoCobrar,
    tiendaNombre,
    barcodeValue,
  } = etiqueta;

  // El QR codifica la URL pública del paquete (`<origin>/paquete/<ordenId>`), no el
  // id pelado: una cámara externa la abre y la ruta valida sesión y muestra el
  // detalle. El escáner in-app (feature 33) extrae el ordenId del path.
  const qrUrl = buildPaqueteUrl(ordenId);

  return (
    <article
      aria-label={`Etiqueta de la orden ${numRemision}`}
      data-testid="etiqueta-guia"
      className="flex flex-col gap-2 overflow-hidden rounded-md border border-border bg-white p-3 text-xs text-black"
      style={{ width: "100mm", height: "100mm" }}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">
            Guía
          </p>
          <p className="text-lg font-bold leading-tight">{numGuia}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">
            Remisión
          </p>
          <p className="font-medium">{numRemision}</p>
        </div>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 leading-tight">
        <dt className="font-semibold">Destinatario</dt>
        <dd>{destinatario}</dd>

        <dt className="font-semibold">Teléfono</dt>
        <dd>{telefonoDest}</dd>

        <dt className="font-semibold">Dirección</dt>
        <dd>{direccion ?? SIN_DATO}</dd>

        <dt className="font-semibold">Ubicación</dt>
        <dd>{geografiaLegible(etiqueta)}</dd>

        <dt className="font-semibold">Producto</dt>
        <dd>{producto}</dd>

        <dt className="font-semibold">Monto a cobrar</dt>
        <dd>{formatMonto(montoCobrar)}</dd>

        <dt className="font-semibold">Tienda</dt>
        <dd>{tiendaNombre}</dd>
      </dl>

      <div className="mt-auto flex items-end justify-between gap-2">
        <QRCodeCanvas
          value={qrUrl}
          size={QR_RASTER_SIZE}
          marginSize={2}
          ref={qrCanvasRef}
          title={`Código QR de la orden ${numRemision}`}
          data-testid="etiqueta-qr"
          data-qr-value={qrUrl}
          style={{ width: "26mm", height: "26mm" }}
        />
        <div
          className="min-w-0 flex-1 overflow-hidden"
          data-testid="etiqueta-barcode"
          data-barcode-value={barcodeValue}
        >
          <Barcode
            value={barcodeValue}
            format="CODE128"
            height={40}
            fontSize={12}
            margin={0}
          />
        </div>
      </div>
    </article>
  );
}
