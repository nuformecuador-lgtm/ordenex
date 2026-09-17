import { describe, it, expect } from "vitest";

import {
  ARRANQUE_NO_LO_SE,
  MARCADOR_CITA_ABRE,
  MARCADOR_CITA_CIERRA,
  instruccionesDelSistema,
  pareceNoLoSe,
} from "@/lib/asistente/instrucciones";

/**
 * ⭑ FICHA 436 · R5 — LA ORDEN DE DECIR «no lo sé», ANCLADA POR SU LITERAL.
 *
 * Se afirma el TEXTO y no «que exista una instrucción», por la misma razón que los rótulos de la
 * 431: un texto que nadie ancla se «mejora» hasta desaparecer, y el día que desaparezca esta orden
 * nadie se va a enterar — el asistente seguirá respondiendo, sólo que inventando, y con la suite
 * en verde. Es exactamente la familia del fallo mudo.
 */

const texto = instruccionesDelSistema();

describe("R5 — no inventar, y decir dónde mirar", () => {
  it("⭑ la orden de responder «No lo sé» está, con ese literal", () => {
    expect(texto).toContain(ARRANQUE_NO_LO_SE);
    expect(texto).toContain("NO INVENTÁS");
    expect(texto).toMatch(/ÚNICA fuente es la documentación/);
  });

  it("⭑ y la orden de SEÑALAR DÓNDE MIRAR, que es la otra mitad del requisito", () => {
    // «No lo sé» a secas deja a la persona igual que estaba. R5 pide las dos cosas.
    expect(texto).toContain("señalás");
    expect(texto).toContain("dónde mirar");
  });

  it("prohíbe rellenar huecos con lo que parezca probable", () => {
    expect(texto).toContain("Nunca completes un hueco");
  });
});

describe("los otros tres límites también están escritos", () => {
  it("no consulta datos (D2)", () => {
    expect(texto).toContain("NO CONSULTÁS DATOS");
    expect(texto).toContain("inventás la cifra");
  });

  it("no ejecuta nada (D3)", () => {
    // El texto es el cinturón; los tirantes son que la petición va SIN `tools` (R4).
    expect(texto).toContain("NO EJECUTÁS NADA");
  });

  it("cita sus documentos, con el formato exacto que la validación de citas espera (D5)", () => {
    expect(texto).toContain("CITÁS TUS DOCUMENTOS");
    expect(texto).toContain(`${MARCADOR_CITA_ABRE}slug${MARCADOR_CITA_CIERRA}`);
  });

  it("⭑ dice explícitamente que lo que no está abajo NO LO SABE", () => {
    // Es la costura entre el acotamiento por rol y el comportamiento: el modelo recibe menos
    // documentos, y además se le dice qué hacer cuando le pregunten por lo que no tiene. Sin esta
    // frase, un modelo con menos contexto tiende a rellenar con lo que «recuerda» de otros sitios.
    expect(texto).toContain("no está abajo, no lo sabés");
  });
});

describe("Q5 — la señal de «no lo sé» se reconoce, y sólo en el arranque", () => {
  it("la reconoce con y sin tilde, en mayúsculas o no, y con adornos de Markdown", () => {
    expect(pareceNoLoSe("No lo sé, eso no está en la documentación.")).toBe(true);
    expect(pareceNoLoSe("no lo se — probá preguntando a la oficina")).toBe(true);
    expect(pareceNoLoSe("  \n**No lo sé**: no tengo ese documento.")).toBe(true);
  });

  it("⭑ NO la reconoce en medio de una respuesta que sí resolvió la duda", () => {
    // Si contara aquí, el contador diría «faltan documentos» justo cuando el documento existió y
    // funcionó — y la única señal de diagnóstico de la pieza pasaría a mentir.
    expect(
      pareceNoLoSe("Para cerrar el día tenés que… si algo no cuadra, decir que no lo sé no ayuda."),
    ).toBe(false);
    expect(pareceNoLoSe("Andá a Mi bodega y tocá Cerrar.")).toBe(false);
    expect(pareceNoLoSe("")).toBe(false);
  });
});
