import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";

import { getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import { drawEtiqueta } from "@/lib/pdf/etiquetas-dibujo";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import {
  ErrorCaracterNoImprimible,
  registrarFuente,
} from "@/lib/pdf/etiquetas-fuente-registro";
import { crearLayout } from "@/lib/pdf/etiquetas-layout";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { CASO_EVIDENCIA } from "../../fixtures/etiquetas-282";

// Feature 382 — EL CASO DE PRODUCCION, DIBUJADO DE VERDAD.
//
// El 2026-09-07 la descarga del lote entero se caia y el modal decia «No se pudo
// preparar la tipografia de la etiqueta. Intentalo de nuevo.». Reintentar no
// podia funcionar: la orden de la guia 11081885 traia el destinatario y la
// direccion escritos con caracteres matematicos DOUBLE-STRUCK (bloque U+1D400,
// los de los generadores de «letras bonitas»; el medido en la orden, U+1D560),
// que no estan en el subconjunto embebido —cp1252 + el colon U+20A1— y no van a
// estar por muchas veces que se pulse el boton.
//
// Lo que aqui se afirma es el TRANSPORTE del dato, que es lo que faltaba: el
// generador ya sabia el caracter y la orden, pero los metia dentro del texto de
// un `Error` pelado y el modal no tenia forma de distinguirlo. Se dibuja con el
// `drawEtiqueta` real y la fuente real; nada mockeado, porque lo que se mide es
// justo lo que la cobertura del subconjunto decide.

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** La guia real de la orden que tumbaba el lote. */
const GUIA_AFECTADA = 11081885;

/**
 * Nombre en double-struck, tal y como llega de un generador de «letras bonitas».
 * Se escribe con los code points en `\u{...}` y NO pegando los glifos, para que
 * siga siendo legible en un editor que no tenga la fuente y para que quede claro
 * que son U+1D5xx y no letras latinas parecidas.
 */
const NOMBRE_DOUBLE_STRUCK = "\u{1D560}\u{1D563}\u{1D557}\u{1D55A}\u{1D563}\u{1D55A}\u{1D560}";
/** El mismo dato escrito con letras normales: lo que el operador tiene que dejar. */
const NOMBRE_NORMAL = "orfirio";

function dto(overrides: Partial<EtiquetaGuiaDTO> = {}): EtiquetaGuiaDTO {
  return {
    ...CASO_EVIDENCIA.dto,
    numGuia: GUIA_AFECTADA,
    ordenId: `ord-${GUIA_AFECTADA}`,
    qrValue: String(GUIA_AFECTADA),
    barcodeValue: String(GUIA_AFECTADA),
    ...overrides,
  };
}

function dibujar(etiqueta: EtiquetaGuiaDTO): void {
  const hoja = getHojaEtiqueta("100x100");
  const doc = new jsPDF({ unit: "mm", format: [hoja.anchoMm, hoja.altoMm] });
  registrarFuente(doc, fuenteEtiqueta);
  drawEtiqueta(
    doc,
    crearLayout(hoja),
    etiqueta,
    { qr: PNG_1X1, barcode: PNG_1X1 },
    fuenteEtiqueta,
  );
}

function errorAlDibujar(etiqueta: EtiquetaGuiaDTO): unknown {
  try {
    dibujar(etiqueta);
  } catch (e) {
    return e;
  }
  throw new Error("drawEtiqueta no lanzo: el caracter se habria impreso roto");
}

describe("Feature 382 — un caracter que la fuente no imprime dice DE QUE ORDEN es", () => {
  it("el caracter double-struck del destinatario lanza con la guia y el caracter encima", () => {
    const capturado = errorAlDibujar(dto({ destinatario: NOMBRE_DOUBLE_STRUCK }));

    expect(capturado).toBeInstanceOf(ErrorCaracterNoImprimible);
    const error = capturado as ErrorCaracterNoImprimible;
    // Lo que la pantalla necesita, y lo que hasta esta ficha se perdia.
    expect(error.numGuia).toBe(GUIA_AFECTADA);
    expect(error.caracter).toBe("\u{1D560}");
    expect(error.codePoint).toBe(0x1d560);
  });

  it("lo mismo si el caracter esta en la DIRECCION y no en el nombre", () => {
    // La orden real los tenia en los dos campos. Si solo se comprobara el
    // destinatario, el segundo campo seguiria cayendo en el mensaje generico.
    const capturado = errorAlDibujar(
      dto({ direccion: `Del super ${NOMBRE_DOUBLE_STRUCK} 200 metros al sur` }),
    );

    expect(capturado).toBeInstanceOf(ErrorCaracterNoImprimible);
    expect((capturado as ErrorCaracterNoImprimible).numGuia).toBe(GUIA_AFECTADA);
  });

  it("la guia que viaja es la de la ORDEN CULPABLE, no la primera del lote", () => {
    // El caso de produccion: una orden entre muchas. Si el error llevara una
    // guia fija —o la del lote— el operador iria a corregir la orden equivocada.
    const capturado = errorAlDibujar(
      dto({ numGuia: 19887906, destinatario: NOMBRE_DOUBLE_STRUCK }),
    );

    expect((capturado as ErrorCaracterNoImprimible).numGuia).toBe(19887906);
  });

  it("control positivo: con el mismo dato en letras normales NO lanza nada", () => {
    // Sin esto, los tres de arriba podrian estar verdes porque el dibujo lanza
    // siempre por cualquier otro motivo.
    expect(() => dibujar(dto({ destinatario: NOMBRE_NORMAL }))).not.toThrow();
  });
});
