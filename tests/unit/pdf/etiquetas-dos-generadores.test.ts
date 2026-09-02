// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Feature 282 (T19, R22) — ANTI-DIVERGENCIA, ASERTADA.
//
// Esta es la primera de las tres capas que impiden que los dos generadores
// vuelvan a separarse, y la mas fuerte: para el MISMO DTO y la hoja de
// 100 x 100 mm se extraen los `x y Td` y el texto de los DOS documentos y se
// exige que coincidan. Si alguien mueve una linea base en un generador y no en
// el otro, esto sale rojo aunque los tests propios de cada uno sigan verdes.
//
// El hecho que lo motiva esta medido, no supuesto: la cabecera del generador del
// servidor declaraba ser «espejo EXACTO» del de cliente y ya no lo era —la
// feature 150 escalo el de cliente y el otro conservo `8`, `22` y `10` escritos
// a mano—. Un espejo mantenido a mano diverge; este test no.

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAklEQVR4AewaftIAAAFbSURBVMXBUYrbQBQAwW4x979yJwP7QAivIzsfqhKImyo2lYp3VO44eNjiR8U7KqNCZatQ2SrOKt5ROXjY4kLlrOIulYorlbOKsfiCSsWmMio+dfCwxZdURsWmUvGJxUXFp1S2ilcqfnPwsMUPlU9UbCoVm0rFUPmXVfENla1C5arijoOHLZWt4kqlYlM5q7iqUHmnYqgIxC8q7lAZFUNlq1DZKlTGwcME4q+Kd1ReqVDZKobKbyqGQFxUvKKyVahsFWcqo2JTqdhUKsbBwwTipEJlVGwqZxVXKmcVVyqjYlVcVVxVDJX/UTEOHrZU7qq4q+KVCpWtYvGj4h2VUaGyVaiMiqGyVahsFWcHD1tcqJxVXKlUbCqjYqgMlaEyVA6+UDEqhsqoGBWj4uzgYYsvqWwVo2KoDJWhUjEWFxWfUKkYKqNiU6nYVM4OHrb4oXKXSsWmMlReqXhF5Q9xIO89ads5LwAAAABJRU5ErkJggg==";
const PNG_1X1_DATA_URL = `data:image/png;base64,${PNG_1X1_BASE64}`;

vi.mock("jsbarcode", () => ({ default: () => undefined }));
vi.mock("qrcode", () => ({
  default: { toDataURL: async () => PNG_1X1_DATA_URL },
}));
vi.mock("bwip-js/node", () => ({
  default: { toBuffer: async () => Buffer.from(PNG_1X1_BASE64, "base64") },
}));

import { buildEtiquetasPdf } from "@/app/(app)/ordenes/_components/etiquetas-pdf";
import { buildEtiquetasLotePdf } from "@/lib/pdf/etiquetas-pdf-lote";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import { getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";

import { CORPUS_282 } from "../../fixtures/etiquetas-282";
import {
  fuentesDePagina,
  imagenesDePagina,
  rectangulosDePagina,
  trazosDePagina,
  textoLegible,
  textosDePagina,
} from "./pdf-inspector";

interface Linea {
  x: string;
  y: string;
  tamano: number;
  texto: string;
}

/**
 * Las lineas dibujadas de una pagina: posicion, cuerpo y TEXTO LEGIBLE.
 *
 * El texto se decodifica en vez de compararse en crudo a proposito: los dos
 * documentos codifican distinto (el del servidor va con `compress: true` y el
 * monto viaja en hexadecimal Identity-H en los dos), y lo que R22 exige es que
 * el LECTOR vea lo mismo, no que los bytes sean iguales.
 *
 * Las coordenadas se comparan como cadena redondeada a 4 decimales: mas
 * precision seria comparar ruido de coma flotante, y menos dejaria pasar un
 * desplazamiento visible.
 */
function lineasDe(bytes: Uint8Array, indice = 0): Linea[] {
  const fuentes = fuentesDePagina(bytes, indice);
  return textosDePagina(bytes, indice).map((t) => ({
    x: t.x.toFixed(4),
    y: t.y.toFixed(4),
    tamano: t.tamano,
    texto: textoLegible(t, fuentes.get(t.fuenteRes)),
  }));
}

/**
 * Feature 350 (T14) — LOS RECTANGULOS, que es el agujero que faltaba.
 *
 * Hasta ahora este test comparaba `Td` + cuerpo + texto. El recuadro del importe
 * (R15) es un `re` seguido de `S`: **un generador podria dibujarlo y el otro no,
 * y esto seguiria verde**. Es el agujero exacto que señala `design.md` §7.1 y la
 * razon de que el inspector aprendiera a leer rectangulos.
 *
 * Se comparan tambien las IMAGENES (QR y codigo de barras): sus rectangulos son
 * geometria compartida aunque el raster lo produzca cada runtime con su libreria.
 *
 * Feature 353 — y los TRAZOS, por el mismo motivo un operador mas abajo: la
 * regla horizontal bajo la cabecera es `m` + `l` + `S`, que no es un `re`. Si
 * uno de los dos generadores dejara de dibujarla, sin esto nadie se enteraria.
 * Se compara ademas el GROSOR: el diseño distingue «borde grueso» del recuadro
 * de la linea fina de la regla, y dos trazos con las mismas coordenadas y
 * distinto grosor se ven distintos en el papel.
 */
function figurasDe(bytes: Uint8Array, indice = 0) {
  return {
    rectangulos: rectangulosDePagina(bytes, indice).map((r) => ({
      x: r.x.toFixed(4),
      y: r.y.toFixed(4),
      w: r.w.toFixed(4),
      h: r.h.toFixed(4),
      operador: r.operador,
      grosor: r.grosor.toFixed(4),
    })),
    trazos: trazosDePagina(bytes, indice).map((t) => ({
      x1: t.x1.toFixed(4),
      y1: t.y1.toFixed(4),
      x2: t.x2.toFixed(4),
      y2: t.y2.toFixed(4),
      grosor: t.grosor.toFixed(4),
    })),
    imagenes: imagenesDePagina(bytes, indice).map((i) => ({
      x: i.x.toFixed(4),
      y: i.y.toFixed(4),
      w: i.w.toFixed(4),
      h: i.h.toFixed(4),
    })),
  };
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    PNG_1X1_DATA_URL,
  );
});

describe("R22 — los dos generadores producen la MISMA etiqueta en 100 x 100", () => {
  for (const caso of CORPUS_282) {
    it(`caso «${caso.id}»: mismas lineas base y mismo texto`, async () => {
      const cliente = new Uint8Array(
        buildEtiquetasPdf(
          [caso.dto],
          new Map([[caso.dto.ordenId, document.createElement("canvas")]]),
          getHojaEtiqueta("100x100"),
          fuenteEtiqueta,
        ).output("arraybuffer"),
      );
      const servidor = await buildEtiquetasLotePdf([caso.dto]);

      const delCliente = lineasDe(cliente);
      const delServidor = lineasDe(servidor);

      // Sanidad: si el parseo devolviese poco, la igualdad seria trivial.
      expect(delCliente.length).toBeGreaterThanOrEqual(16);
      expect(delServidor).toEqual(delCliente);

      // Feature 350 (T14): y los RECTANGULOS. Sin esto, el recuadro del importe
      // podria existir en un generador y no en el otro con el test en verde.
      const figurasCliente = figurasDe(cliente);
      const figurasServidor = figurasDe(servidor);
      // Sanidad, otra vez: la igualdad de dos listas vacias no afirma nada.
      expect(
        figurasCliente.rectangulos,
        "no se leyo el recuadro del importe en el PDF de cliente",
      ).toHaveLength(1);
      expect(figurasCliente.imagenes, "faltan el QR y el barcode").toHaveLength(2);
      expect(
        figurasCliente.trazos,
        "no se leyo la regla horizontal en el PDF de cliente",
      ).toHaveLength(1);
      expect(figurasServidor).toEqual(figurasCliente);
    });
  }

  it("y la fuente embebida es LA MISMA en los dos (mismo /BaseFont)", async () => {
    const dto = CORPUS_282[0].dto;
    const cliente = new Uint8Array(
      buildEtiquetasPdf(
        [dto],
        new Map(),
        getHojaEtiqueta("100x100"),
        fuenteEtiqueta,
      ).output("arraybuffer"),
    );
    const servidor = await buildEtiquetasLotePdf([dto]);

    const embebida = (bytes: Uint8Array) =>
      [...fuentesDePagina(bytes).values()].find((f) => f.subtype === "Type0");

    const a = embebida(cliente);
    const b = embebida(servidor);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.baseFont).toBe(b!.baseFont);
    expect(a!.baseFont).toBe(fuenteEtiqueta.nombre);
    expect(a!.encoding).toBe(b!.encoding);
    // Un solo artefacto, no dos: el programa embebido pesa lo mismo.
    expect(a!.fontFile2!.byteLength).toBe(b!.fontFile2!.byteLength);
  });
});
