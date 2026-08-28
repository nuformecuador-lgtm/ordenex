import { describe, it, expect } from "vitest";
import {
  chatContactosSchema,
  parsearContactosGuardados,
} from "@/lib/types/chat-contactos";

// Feature 311 — B1.T (R7/R14). `contactos_json` es el UNICO dato de la feature que vive como
// JSON. El invariante que estos tests protegen es que ese JSON se valida con zod en las DOS
// direcciones y que un JSON historico o corrupto degrada a "sin contactos" en vez de reventar
// el listado del hilo entero.

const CONTACTO_VALIDO = {
  nombre: "Ana Perez",
  telefonos: [{ valor: "+506 8888-1111", tipo: "CELL" }],
  correos: [{ valor: "ana@example.com", tipo: null }],
  direcciones: ["Calle 1, San Jose"],
  organizacion: "Acme",
  urls: ["https://acme.test"],
};

describe("chatContactosSchema (R7)", () => {
  it("acepta la forma normalizada con sus telefonos y correos", () => {
    const res = chatContactosSchema.safeParse([CONTACTO_VALIDO]);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data[0].telefonos[0].valor).toBe("+506 8888-1111");
      expect(res.data[0].correos[0].valor).toBe("ana@example.com");
    }
  });

  it("rechaza una lista VACIA: un mensaje de contactos sin contactos no existe (R8)", () => {
    expect(chatContactosSchema.safeParse([]).success).toBe(false);
  });

  it("un payload corrupto devuelve success:false SIN lanzar", () => {
    // `safeParse`, no `parse`: la fila corrupta no puede propagar una excepcion al hilo.
    expect(() => chatContactosSchema.safeParse({ nombre: "suelto" })).not.toThrow();
    expect(chatContactosSchema.safeParse({ nombre: "suelto" }).success).toBe(false);
    expect(chatContactosSchema.safeParse([{ nombre: 42 }]).success).toBe(false);
  });
});

describe("parsearContactosGuardados (R14)", () => {
  it("devuelve la lista tipada cuando el JSON guardado es valido", () => {
    expect(parsearContactosGuardados([CONTACTO_VALIDO])).toEqual([CONTACTO_VALIDO]);
  });

  it("null/undefined -> null (columna nullable, mensaje sin contactos)", () => {
    expect(parsearContactosGuardados(null)).toBeNull();
    expect(parsearContactosGuardados(undefined)).toBeNull();
  });

  it("un JSON corrupto o de otra forma -> null, sin lanzar", () => {
    expect(parsearContactosGuardados({ viejo: "formato" })).toBeNull();
    expect(parsearContactosGuardados("[]")).toBeNull();
    expect(parsearContactosGuardados([])).toBeNull();
    expect(() => parsearContactosGuardados([{ nombre: null }])).not.toThrow();
  });
});
