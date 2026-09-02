"use client";

import type { Ref } from "react";
import { QRCodeCanvas } from "qrcode.react";
import Barcode from "react-barcode";

import { formatMonto } from "@/lib/config/moneda";
import {
  geografiaLegible,
  ROTULO_PARA,
  ROTULO_PRODUCTO,
  ROTULO_TIENDA,
  SIN_DIRECCION,
} from "@/lib/pdf/etiquetas-dibujo";
import { buildPaqueteUrl } from "@/lib/utils/paquete-url";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { RESPALDO_FAMILIA_MONTO } from "./etiquetas-fuente-carga";

export interface EtiquetaGuiaProps {
  /** Payload resuelto por el backend (feature 32/R1). */
  etiqueta: EtiquetaGuiaDTO;
  /**
   * Ref al `<canvas>` del QR (qrcode.react lo reenvia al canvas nativo). El modal
   * lo recolecta para rasterizar el QR al PDF (decision F1.4 (c)/(d),
   * `canvas.toDataURL`); en la vista previa no es necesario.
   */
  qrCanvasRef?: Ref<HTMLCanvasElement>;
  /**
   * Feature 282 (T27, R31/R32) — Familia con la que quedo registrada en el
   * navegador la fuente EMBEBIDA EN EL PDF, tal como la devuelve
   * `asegurarFuenteEnPantalla`. Se aplica SOLO al valor del monto, que es
   * exactamente donde el PDF la usa: la paridad es entre lo que se compara.
   *
   * Llega por prop y no se importa aqui a proposito. El artefacto son ~22 KB de
   * base64 tras un `import()` diferido (R13) y este componente no debe poder
   * arrastrarlo al bundle inicial ni por descuido; ademas, asi el identificador
   * que se pinta es el REALMENTE registrado, no una segunda declaracion del
   * nombre que podria derivar del artefacto sin que nadie lo notara.
   *
   * `null`/ausente = la fuente no llego: el importe se pinta con la del sistema
   * y la vista previa no se bloquea por ello (R33).
   */
  familiaMonto?: string | null;
}

/** Tamano en px del canvas del QR: alto para un raster nitido en el PDF. */
const QR_RASTER_SIZE = 512;

/**
 * Feature 32 (T2.1, R9) — Etiqueta de guia presentacional: renderiza TODOS los
 * campos legibles de una orden imprimible + el QR (R7, `qrValue`) y el codigo de
 * barras (R8, `barcodeValue`). No decide que codificar: usa `qrValue`/
 * `barcodeValue` tal cual los resuelve el backend. `montoCobrar` se formatea con
 * la config de moneda (R5, sin hardcodear moneda); null -> "-".
 *
 * Feature 282 (T27, R31) — El valor del monto se pinta con `familiaMonto`, la
 * familia registrada desde los MISMOS bytes que jsPDF embebe en el PDF. Es el
 * unico campo que cambia de tipografia, porque es el unico que el PDF dibuja con
 * la fuente embebida: la paridad se afirma justo donde se compara. Sin esa
 * familia, el importe cae a la del sistema y la etiqueta se sigue viendo (R33).
 *
 * ---------------------------------------------------------------------------
 * Feature 350 (T17, R23) — LA VISTA PREVIA ESPEJA EL PAPEL, O MIENTE.
 *
 * El principio ya estaba escrito en este archivo desde la feature 295 —«la vista
 * previa sirve para decidir si imprimir, asi que tiene que parecerse al papel»—
 * y era exactamente lo que se rompia al rediseñar solo el PDF: el usuario veria
 * dos cosas distintas para el mismo papel y la primera conclusion seria que algo
 * esta roto.
 *
 * Lo que cambia, punto por punto y espejando `lib/pdf/etiquetas-dibujo.ts`:
 *
 *  · **Las cinco bandas, en el orden de R13**: cabecera (guia + fecha + remision
 *    + QR arriba a la derecha), destino, importe, detalle y codigo de barras a
 *    todo el ancho.
 *  · **Se va la rejilla `grid-cols-[auto_1fr]`** del bloque de destino (D2/R16):
 *    en el papel ya no hay columna de rotulos y el valor usa el ancho completo.
 *    El destino se lee como un sobre postal.
 *  · **Jerarquia por TAMAÑO** (D3/R14): destinatario y telefono grandes; el
 *    importe destacado y en su recuadro; producto y tienda en el cuerpo menor.
 *    Los tamaños de pantalla siguen el mismo ORDEN que los cuerpos del PDF
 *    (16 > 13 > 12 > 10 > 9 > 8 pt), que es lo que R23 exige comparar.
 *  · **El QR sube a la cabecera** y el codigo de barras pasa a todo el ancho,
 *    como en el papel.
 *
 * `geografiaLegible`, `SIN_DIRECCION` y los rotulos del detalle se IMPORTAN del
 * modulo compartido en vez de reescribirse aqui: eran una copia byte a byte que
 * podia divergir del papel sin que nadie lo viera, que es el mismo defecto que
 * la feature 282 cerro entre los dos generadores.
 */
export function EtiquetaGuia({
  etiqueta,
  qrCanvasRef,
  familiaMonto,
}: EtiquetaGuiaProps) {
  const {
    numGuia,
    numRemision,
    fechaCreacion,
    destinatario,
    telefonoDest,
    direccion,
    producto,
    montoCobrar,
    tiendaNombre,
    barcodeValue,
  } = etiqueta;

  // El QR codifica la URL pública del paquete (`<origin>/paquete/<numGuia>`), no el
  // código pelado: una cámara externa la abre y la ruta valida sesión y muestra el
  // detalle. El escáner in-app (feature 33) extrae el num_guia del path. CORTE
  // LIMPIO: ya NO se codifica `orden.id` (UUID); las etiquetas impresas con el
  // formato anterior dejan de escanear y se reimprimen.
  const qrUrl = buildPaqueteUrl(numGuia);

  return (
    <article
      aria-label={`Etiqueta de la orden ${numRemision}`}
      data-testid="etiqueta-guia"
      className="flex flex-col gap-1.5 overflow-hidden rounded-md border border-border bg-white p-3 text-xs text-black"
      style={{ width: "100mm", height: "100mm" }}
    >
      {/* Banda 1 — cabecera (feature 353, el diseño aprobado): rotulo de marca,
          debajo el numero GRANDE, debajo la fila de remision y fecha; el QR
          cuadrado a la derecha y alineado arriba. El ORDEN de los datos es el
          mismo que en el papel y R23 lo exige medido, no de palabra. */}
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[9px] uppercase tracking-widest text-neutral-500">
            Ordenex · Guía
          </span>
          <p className="text-3xl font-bold leading-none">{numGuia}</p>
          <div className="mt-1 flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-wide text-neutral-500">
            <span className="flex items-baseline gap-1">
              <span>Rem</span>
              <span className="font-medium normal-case text-black">{numRemision}</span>
            </span>
            {/* Feature 295 — la fecha va EN LA CABECERA, y desde la 353 en la
                fila de DEBAJO del numero, que es donde la dibuja el PDF.

                SE PINTA TAL CUAL LLEGA: `fechaCreacion` ya es la fecha de
                calendario de Costa Rica resuelta en el servidor. Volver a
                derivarla aqui (`new Date(...)` + `toLocale*`) la interpretaria en
                la zona horaria del NAVEGADOR, que no tiene por que ser la de CR, y
                podria mostrar el dia anterior o el siguiente. */}
            <span className="flex items-baseline gap-1">
              <span>Fecha</span>
              <span
                className="font-medium normal-case text-black"
                data-testid="etiqueta-fecha"
              >
                {fechaCreacion}
              </span>
            </span>
          </div>
        </div>
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
      </header>

      {/* La regla horizontal que separa la cabecera del resto (feature 353). */}
      <hr className="border-t border-black" />

      {/* Banda 2 — destino: el rotulo PARA abre el bloque y los cuatro datos van
          SIN columna de rotulos (D2/R16). Se lee como un sobre postal, y el
          valor dispone del ancho completo. */}
      <div className="flex flex-col leading-tight" data-testid="etiqueta-destino">
        <span className="text-[9px] uppercase tracking-widest text-neutral-500">
          {ROTULO_PARA}
        </span>
        <p className="text-base font-bold">{destinatario}</p>
        <p className="text-sm font-bold">{telefonoDest}</p>
        <p className="text-xs">{direccion ?? SIN_DIRECCION}</p>
        <p className="text-[11px] font-bold">{geografiaLegible(etiqueta)}</p>
      </div>

      {/* Banda 3 — importe: en su recuadro y en UNA linea (D3/R15). Es lo que el
          mensajero tiene que cobrar, no una fila mas del monton. */}
      <div
        className="flex items-baseline justify-between gap-2 rounded border border-black px-1.5 py-1"
        data-testid="etiqueta-importe"
      >
        <span className="text-[10px] font-bold uppercase tracking-wide">Cobrar</span>
        <span
          className="text-xl font-bold leading-none"
          data-testid="etiqueta-monto"
          style={
            familiaMonto
              ? { fontFamily: `"${familiaMonto}", ${RESPALDO_FAMILIA_MONTO}` }
              : undefined
          }
        >
          {formatMonto(montoCobrar)}
        </span>
      </div>

      {/* Banda 4 — detalle: rotulo diminuto ENCIMA de su valor, cuerpo menor
          (feature 353). En el papel esta es la disposicion por defecto y solo
          cae a rotulo en linea cuando el texto no deja sitio; la previa muestra
          la de por defecto, que es la que el operador va a ver casi siempre. */}
      <div className="flex flex-col text-[10px] leading-tight">
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-neutral-500">
            {ROTULO_PRODUCTO}
          </span>
          <span>{producto}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-neutral-500">
            {ROTULO_TIENDA}
          </span>
          <span>{tiendaNombre}</span>
        </div>
      </div>

      {/* Banda 5 — codigo de barras a TODO el ancho, como en el papel. */}
      <div
        className="mt-auto min-w-0 overflow-hidden"
        data-testid="etiqueta-barcode"
        data-barcode-value={barcodeValue}
      >
        <Barcode
          value={barcodeValue}
          format="CODE128"
          height={40}
          fontSize={12}
          margin={0}
          width={1}
        />
      </div>
    </article>
  );
}
