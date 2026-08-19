import { describe, it, expect } from "vitest";

import { actualizarPagosGestionSchema } from "@/lib/types/cierres-admin";

// Pedido humano (2026-08-19) — el BORDE de la corrección del desglose de pago. Lo que se afirma
// aquí es lo que muere ANTES de tocar la base; el cuadre contra `monto_recibido` no está aquí a
// propósito (el borde no sabe cuánto declaró el mensajero: eso lo comprueba el servicio, contra
// la base, y tiene su propia suite).

const UUID = "3f1c7c2e-9a1a-4f0e-9d4a-2b6a1c9e5d33";

function parse(input: unknown) {
  return actualizarPagosGestionSchema.safeParse(input);
}

describe("actualizarPagosGestionSchema", () => {
  it("acepta un desglose de varias líneas con montos STRING", () => {
    const r = parse({
      gestionId: UUID,
      lineas: [
        { metodo: "efectivo", monto: "6000" },
        { metodo: "SINPE", monto: "4000.50" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("el TOTAL no es una clave del contrato: mandarlo es `validation_error`", () => {
    // `.strict()`. Es la barrera que impide que la pantalla decida cuánto se recaudó: el total
    // sale de la base, no de la petición. Sin esto, una clave `montoRecibido` viajaría hasta un
    // servicio que hoy la ignora y mañana podría no ignorarla.
    const r = parse({
      gestionId: UUID,
      montoRecibido: "999999",
      lineas: [{ metodo: "efectivo", monto: "10000" }],
    });
    expect(r.success).toBe(false);
  });

  it("un método REPETIDO no pasa: espejo del `@@unique(gestion_id, metodo)`", () => {
    // Dos transferencias se registran como UNA línea con el monto ya sumado. Sin esta regla, el
    // `createMany` reventaría dentro de la transacción con un error de clave única.
    const r = parse({
      gestionId: UUID,
      lineas: [
        { metodo: "SINPE", monto: "1000" },
        { metodo: "SINPE", monto: "2000" },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["lineas"]);
    }
  });

  it("cero líneas no es una corrección: una entrega que cobró tiene que decir cómo", () => {
    expect(parse({ gestionId: UUID, lineas: [] }).success).toBe(false);
  });

  it("rechaza los montos que no son dinero: 0, negativo, tres decimales y coma", () => {
    for (const monto of ["0", "-100", "10.005", "1000,50", "", "mil"]) {
      const r = parse({ gestionId: UUID, lineas: [{ metodo: "efectivo", monto }] });
      expect(r.success, `monto ${JSON.stringify(monto)}`).toBe(false);
    }
  });

  it("rechaza un método fuera del catálogo", () => {
    const r = parse({ gestionId: UUID, lineas: [{ metodo: "cripto", monto: "1000" }] });
    expect(r.success).toBe(false);
  });

  it("exige un `gestionId` con forma de uuid", () => {
    const r = parse({ gestionId: "g-1", lineas: [{ metodo: "efectivo", monto: "1000" }] });
    expect(r.success).toBe(false);
  });
});
