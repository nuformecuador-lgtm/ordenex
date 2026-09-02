import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";

import { getHojaEtiqueta, HOJAS_ETIQUETA } from "@/lib/config/etiquetas-hoja";
import { drawEtiqueta, ROTULO_GUIA, ROTULO_PARA } from "@/lib/pdf/etiquetas-dibujo";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import { registrarFuente } from "@/lib/pdf/etiquetas-fuente-registro";
import { crearLayout } from "@/lib/pdf/etiquetas-layout";
import { PT_A_MM } from "@/lib/pdf/etiquetas-maqueta";

import { CASO_EVIDENCIA, CASO_PEOR_MEDIDO, CORPUS_282 } from "../../fixtures/etiquetas-282";
import { cajaDeTexto, leerEtiqueta, verificarEtiqueta } from "./etiquetas-verificacion";

// Feature 353 — EL DISEÑO APROBADO, MEDIDO EN MILIMETROS SOBRE EL PDF.
//
// Por que existe este archivo, y es la leccion de la ficha: la 350 aprobo un
// spec ESCRITO, implemento la maqueta y NADIE COMPARO NUNCA EL PDF RESULTANTE
// CON EL DISEÑO. La disposicion derivo —numero de guia al 73 % del tamaño
// aprobado, sin regla, sin rotulo de marca, la fecha en la fila de arriba— y la
// suite entera siguio verde, porque ninguna asercion hablaba de disposicion.
//
// Aqui las cajas se declaran como NUMEROS LITERALES para la celda base de
// 100 x 100, que es la unica hoja con dimensiones fijas del catalogo y la que el
// generador del lote usa siempre (R20). Literales y no derivados de la maqueta:
// derivarlos de las mismas constantes que producen el dibujo seria comparar la
// funcion consigo misma —siempre verde, sin afirmar nada— que es exactamente el
// error que dejo pasar esta deriva.

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function dibujar(hojaId: string, dto: Parameters<typeof drawEtiqueta>[2]) {
  const hoja = getHojaEtiqueta(hojaId);
  const doc = new jsPDF({ unit: "mm", format: [hoja.anchoMm, hoja.altoMm] });
  registrarFuente(doc, fuenteEtiqueta);
  const layout = crearLayout(hoja);
  drawEtiqueta(doc, layout, dto, { qr: PNG_1X1, barcode: PNG_1X1 }, fuenteEtiqueta);
  const bytes = new Uint8Array(Buffer.from(doc.output("arraybuffer")));
  return { doc, bytes, layout, hoja };
}

describe("Feature 353 — las cajas del diseño en la celda base, en milimetros", () => {
  // Los cuatro numeros que el humano pidio para poder comparar contra su diseño
  // sin creerse a nadie. Medidos el 2026-09-02 sobre el PDF del caso de
  // evidencia en 100 x 100 (area util x[6, 94], y[6, 94]).
  const ESPERADO = {
    /** Caja de tinta del numero de guia: 30 pt de alto de caja, pegado al margen. */
    guia: { x0: 6.0, y0: 8.82, altoMm: 10.58 },
    /** El QR: cuadrado de 26 mm en la esquina SUPERIOR DERECHA del area util. */
    qr: { x0: 68.0, y0: 6.0, x1: 94.0, y1: 32.0 },
    /** El barcode: 88 x 16 mm pegado al borde INFERIOR, a todo el ancho util. */
    barcode: { x0: 6.0, y0: 78.0, x1: 94.0, y1: 94.0 },
    /** La regla horizontal, en el hueco entre cabecera y destino. */
    regla: { yMm: 33.0, x0: 6.0, x1: 94.0, grosorMm: 0.4 },
    /** Donde arranca el bloque de destino: linea base del rotulo `PARA`. */
    paraBaseline: 36.82,
    /** Linea base del destinatario, el primer dato del bloque. */
    destinatarioBaseline: 41.0,
  } as const;

  const medido = () => {
    const { doc, bytes, hoja } = dibujar("100x100", CASO_EVIDENCIA.dto);
    return leerEtiqueta(doc, bytes, 0, hoja.altoMm, fuenteEtiqueta);
  };

  it("el numero de guia: 30 pt, 10,58 mm de caja, pegado al margen izquierdo", () => {
    const leida = medido();
    const guia = leida.textos.find((t) => t.texto === "19887906")!;
    expect(guia, "no se encontro el numero de guia en el PDF").toBeDefined();
    expect(guia.pt).toBe(30);
    expect(guia.xMm).toBeCloseTo(ESPERADO.guia.x0, 2);
    expect(guia.yMm).toBeCloseTo(19.41, 2);
    // El alto de CAJA es lo que se compara contra el diseño: 10,58 mm sobre un
    // lienzo de 100. A los 22 pt de la 350 medía 7,76 y por eso «se veia
    // distinto». Se mide como 1 em, que es lo que `cajaDeTexto` llama alto.
    const caja = cajaDeTexto(guia);
    expect(guia.pt * PT_A_MM).toBeCloseTo(ESPERADO.guia.altoMm, 2);
    expect(caja.y0).toBeCloseTo(ESPERADO.guia.y0, 2);
  });

  it("el QR: cuadrado de 26 mm en la esquina superior DERECHA del area util", () => {
    const leida = medido();
    const qr = leida.imagenes.find((i) => Math.abs(i.x1 - i.x0 - (i.y1 - i.y0)) < 0.01)!;
    expect(qr, "no se encontro el QR").toBeDefined();
    expect(qr.x0).toBeCloseTo(ESPERADO.qr.x0, 2);
    expect(qr.y0).toBeCloseTo(ESPERADO.qr.y0, 2);
    expect(qr.x1).toBeCloseTo(ESPERADO.qr.x1, 2);
    expect(qr.y1).toBeCloseTo(ESPERADO.qr.y1, 2);
    // Y el barcode NO esta a su lado: en el diseño abajo va SOLO el codigo de
    // barras. Esta es la asercion que muere si alguien devuelve el QR abajo.
    const barcode = leida.imagenes.find((i) => i !== qr)!;
    expect(
      qr.y1,
      "el QR no esta en la cabecera: comparte banda con el codigo de barras",
    ).toBeLessThan(barcode.y0);
    expect(qr.y0).toBeLessThan(barcode.y0 - 40);
  });

  it("el codigo de barras: 88 x 16 mm, a ancho completo y pegado abajo", () => {
    const leida = medido();
    const qr = leida.imagenes.find((i) => Math.abs(i.x1 - i.x0 - (i.y1 - i.y0)) < 0.01)!;
    const barcode = leida.imagenes.find((i) => i !== qr)!;
    expect(barcode.x0).toBeCloseTo(ESPERADO.barcode.x0, 2);
    expect(barcode.y0).toBeCloseTo(ESPERADO.barcode.y0, 2);
    expect(barcode.x1).toBeCloseTo(ESPERADO.barcode.x1, 2);
    expect(barcode.y1).toBeCloseTo(ESPERADO.barcode.y1, 2);
    expect(barcode.x1 - barcode.x0).toBeCloseTo(88, 2);
  });

  it("la regla horizontal: a todo el ancho util, entre la cabecera y el destino", () => {
    const leida = medido();
    expect(leida.reglas).toHaveLength(1);
    const regla = leida.reglas[0];
    expect(regla.yMm).toBeCloseTo(ESPERADO.regla.yMm, 2);
    expect(regla.x0).toBeCloseTo(ESPERADO.regla.x0, 2);
    expect(regla.x1).toBeCloseTo(ESPERADO.regla.x1, 2);
    expect(regla.grosorMm).toBeCloseTo(ESPERADO.regla.grosorMm, 3);
  });

  it("el bloque de destino arranca en 36,82 mm, con `PARA` abriendo", () => {
    const leida = medido();
    const para = leida.textos.find((t) => t.texto === ROTULO_PARA)!;
    expect(para, "falta el rotulo PARA").toBeDefined();
    expect(para.yMm).toBeCloseTo(ESPERADO.paraBaseline, 2);
    expect(para.xMm).toBeCloseTo(6.0, 2);
    const destinatario = leida.textos.find(
      (t) => t.texto === CASO_EVIDENCIA.esperado.destinatario,
    )!;
    expect(destinatario.yMm).toBeCloseTo(ESPERADO.destinatarioBaseline, 2);
  });

  it("la cabecera, de arriba abajo: marca, numero, fila REM + FECHA", () => {
    const leida = medido();
    const y = (texto: string) => {
      const t = leida.textos.find((x) => x.texto === texto);
      expect(t, `falta «${texto}» en el PDF`).toBeDefined();
      return t!.yMm;
    };
    expect(y(ROTULO_GUIA)).toBeCloseTo(8.82, 2);
    expect(y("19887906")).toBeCloseTo(19.41, 2);
    expect(y("REM")).toBeCloseTo(29.99, 2);
    expect(y("FECHA")).toBeCloseTo(29.99, 2);
    expect(y("2026-08-25")).toBeCloseTo(29.99, 2);
    // Estrictamente creciente: la marca arriba, el numero en medio, la fila
    // abajo. Si alguien devolviera la fecha a la fila de encima, esto cae.
    expect(y(ROTULO_GUIA)).toBeLessThan(y("19887906"));
    expect(y("19887906")).toBeLessThan(y("REM"));
  });
});

describe("Feature 353 — los rotulos apilados y su degradacion declarada", () => {
  // La tabla LITERAL de que casos salen con los rotulos apilados —el diseño— y
  // cuales caen a la disposicion de la 350. Se escribe a mano: es la frontera
  // que el humano tiene que poder leer sin ejecutar nada, y la unica forma de
  // que un cambio de la maqueta que la mueva salga rojo con los dos numeros.
  //
  // La lectura de la tabla: SOLO el peor caso medido de produccion (direccion de
  // 286 caracteres + producto de 138) y la palabra imposible pierden los rotulos
  // apilados, y SOLO en la celda de 100 x 100. En las otras tres hojas y con
  // todos los demas datos, la etiqueta sale exactamente como el diseño.
  const EN_LINEA: Array<[string, string]> = [
    ["peor-caso-medido", "100x100"],
    ["palabra-imposible", "100x100"],
  ];

  for (const caso of CORPUS_282) {
    for (const hoja of HOJAS_ETIQUETA) {
      const esperadoEnLinea = EN_LINEA.some(([c, h]) => c === caso.id && h === hoja.id);
      it(`«${caso.id}» en ${hoja.id}: rotulos ${esperadoEnLinea ? "EN LINEA" : "APILADOS"}`, () => {
        const { doc, bytes, layout } = dibujar(hoja.id, caso.dto);
        const r = verificarEtiqueta(
          doc,
          bytes,
          0,
          layout,
          fuenteEtiqueta,
          caso,
          `diseño/${caso.id}/${hoja.id}`,
        );
        expect(
          r.apilados,
          esperadoEnLinea
            ? `«${caso.id}» en ${hoja.id} salio APILADO y la tabla dice que no cabe: la capacidad ha cambiado, actualiza la tabla y di por que`
            : `«${caso.id}» en ${hoja.id} perdio los rotulos apilados del diseño: la maqueta se ha quedado sin sitio`,
        ).toBe(!esperadoEnLinea);
      });
    }
  }

  it("la degradacion NO es gratuita: el peor caso NO cabria con los rotulos apilados", () => {
    // El control positivo de la decision. Se mide el hueco que queda para el
    // bloque de destino en 100 x 100 con el peor caso y se comprueba que las
    // tres lineas de rotulo del diseño no caben en el. Sin esto, «cae a en
    // linea» podria estar disparandose por un bug y nadie lo sabria.
    const { doc, bytes, hoja } = dibujar("100x100", CASO_PEOR_MEDIDO.dto);
    const leida = leerEtiqueta(doc, bytes, 0, hoja.altoMm, fuenteEtiqueta);

    // Todo el texto del bloque de destino y del detalle esta YA en el suelo de
    // legibilidad o a un paso de el: no hay de donde sacar 3 lineas.
    const enElSuelo = leida.textos.filter((t) => t.pt <= 7.25 + 1e-9);
    expect(
      enElSuelo.length,
      "el peor caso ya no esta apretado: la premisa de la degradacion ha cambiado",
    ).toBeGreaterThanOrEqual(7);

    // Y el hueco libre entre la ultima linea del detalle y el codigo de barras
    // es menor que UNA linea de rotulo (8 pt x 1,26 = 3,56 mm), no ya que tres.
    const barcode = leida.imagenes.reduce((a, b) => (a.y0 > b.y0 ? a : b));
    const ultimoTexto = leida.textos.reduce((a, b) => (a.yMm > b.yMm ? a : b));
    expect(barcode.y0 - cajaDeTexto(ultimoTexto).y1).toBeLessThan(3.56);
  });
});
