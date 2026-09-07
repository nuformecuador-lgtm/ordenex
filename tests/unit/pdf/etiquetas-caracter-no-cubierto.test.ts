import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";

import { getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import { drawEtiqueta } from "@/lib/pdf/etiquetas-dibujo";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import {
  ErrorCaracterNoImprimible,
  registrarFuente,
  type FuenteEmbebida,
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

function dibujar(etiqueta: EtiquetaGuiaDTO, fuente: FuenteEmbebida = fuenteEtiqueta): void {
  const hoja = getHojaEtiqueta("100x100");
  const doc = new jsPDF({ unit: "mm", format: [hoja.anchoMm, hoja.altoMm] });
  // Se registran SIEMPRE los bytes reales: lo que un caso puede estrechar es la
  // COBERTURA declarada, no el programa de fuente que jsPDF parsea.
  registrarFuente(doc, fuenteEtiqueta);
  drawEtiqueta(doc, crearLayout(hoja), etiqueta, { qr: PNG_1X1, barcode: PNG_1X1 }, fuente);
}

function errorAlDibujar(
  etiqueta: EtiquetaGuiaDTO,
  fuente: FuenteEmbebida = fuenteEtiqueta,
): unknown {
  try {
    dibujar(etiqueta, fuente);
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

/**
 * Feature 382 (R1) — LA LINEA DEL DINERO, CLAVADA.
 *
 * `drawEtiqueta` llama a `exigirCobertura` en dos sitios y el otro —«texto de la
 * etiqueta»— ya estaba cubierto arriba. Este, el del IMPORTE, no lo estaba:
 * medido por el reviewer el 2026-09-07, colar un `0` como guia en esa llamada
 * dejaba 268 tests verdes en 13 archivos. Es la unica de las dos llamadas que
 * toca el monto a cobrar, y es justo donde nacio la feature 282.
 *
 * Como se dispara sin inventar nada: el texto del importe sale de `formatMonto`,
 * asi que siempre trae el SIMBOLO DE MONEDA configurado, y el colon (U+20A1) no
 * esta en cp1252 — es el unico caracter que el subconjunto añade a mano. Aqui se
 * declara una cobertura estrecha (solo ASCII) sobre los MISMOS bytes de fuente,
 * que es exactamente el escenario que R28 vigila: un despliegue cuyo simbolo de
 * moneda no esta en el subconjunto embebido. Nada de mocks ni de reescribir la
 * configuracion global.
 */
describe("Feature 382 — el caracter no imprimible del IMPORTE tambien dice la guia", () => {
  /**
   * Los bytes reales con la cobertura DECLARADA estrechada a ASCII imprimible.
   * `cubreCodePoint` lee esta declaracion y solo esta.
   */
  const SOLO_ASCII: FuenteEmbebida = {
    ...fuenteEtiqueta,
    cobertura: [[0x20, 0x7e]],
  };

  it("el simbolo de moneda fuera del subconjunto lanza desde el campo del IMPORTE", () => {
    const etiqueta = dto({ montoCobrar: 18000, destinatario: NOMBRE_NORMAL });
    const capturado = errorAlDibujar(etiqueta, SOLO_ASCII);

    expect(capturado).toBeInstanceOf(ErrorCaracterNoImprimible);
    const error = capturado as ErrorCaracterNoImprimible;
    // `campo` es lo que demuestra DE QUE LLAMADA salio: si saliera de la otra
    // diria «texto de la etiqueta» y este test no estaria vigilando nada.
    expect(error.campo).toBe("Monto a cobrar");
    // Y lo que la mutacion del reviewer rompia: la guia REAL de la orden.
    expect(error.numGuia).toBe(GUIA_AFECTADA);
    // El caracter culpable, como LITERAL: es el simbolo de moneda con el que la
    // etiqueta imprime hoy, no lo que devuelva el formateador (compararlo contra
    // `formatMonto` estaria verde con cualquier simbolo, tambien con uno roto).
    expect(error.caracter).toBe("₡");
    expect(error.codePoint).toBe(0x20a1);
  });

  it("y la guia que viaja cambia con la orden: no es una constante del archivo", () => {
    // Con un solo caso, `numGuia` podria estar clavado a un literal y seguir
    // verde. Dos ordenes distintas obligan a que salga del DTO.
    const guias = [GUIA_AFECTADA, 19887906];
    const vistas = guias.map((numGuia) => {
      const error = errorAlDibujar(dto({ numGuia }), SOLO_ASCII) as ErrorCaracterNoImprimible;
      return error.numGuia;
    });
    expect(vistas).toEqual(guias);
  });

  it("control positivo: con la cobertura REAL, ese mismo importe se dibuja sin lanzar", () => {
    // Prueba que lo que lanza es la cobertura estrecha y no el importe en si:
    // sin esto, los dos de arriba podrian estar verdes por cualquier otro motivo.
    expect(() => dibujar(dto({ montoCobrar: 18000 }))).not.toThrow();
  });
});
