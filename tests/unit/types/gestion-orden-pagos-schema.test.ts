import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodError } from "zod";
import { gestionarSchema } from "@/lib/types/gestion-orden";
import { normalizarPagos } from "@/lib/utils/pagos-recaudo";

// Feature 208 (R11-R16) — el BORDE (zod) del DESGLOSE del recaudo. MISMO schema en cliente
// (el panel hace `safeParse` con el) y en servidor (Server Action): validarlo aqui valida las
// dos defensas. Cada caso invalido afirma el CAMPO del error, no solo que falla: el panel
// pinta el mensaje bajo el control que lo provoco, y un error en el campo equivocado es un
// error invisible.

const UBICACION = { lat: 9.9281, lng: -84.0907 }; // feature 193/R10

function foto() {
  return { type: "image/jpeg", size: 1024 };
}

function entrega(extra: Record<string, unknown>) {
  return {
    ordenId: "o1",
    ubicacion: UBICACION,
    resultado: "entregada",
    evidencias: [foto()],
    ...extra,
  };
}

function camposConError(error: ZodError<unknown>): string[] {
  return Object.keys(error.flatten().fieldErrors);
}

function erroresDe(input: unknown): { campos: string[]; mensajes: string[] } {
  const r = gestionarSchema.safeParse(input);
  if (r.success) throw new Error("se esperaba un fallo de validacion y el parse fue exitoso");
  const fieldErrors = r.error.flatten().fieldErrors as Record<string, string[] | undefined>;
  return {
    campos: camposConError(r.error),
    mensajes: Object.values(fieldErrors).flatMap((m) => m ?? []),
  };
}

describe("R11: el desglose valido entra (regla 5 del superRefine · la suma cuadra)", () => {
  it("dos lineas que suman el monto recibido -> valido, y las lineas se conservan", () => {
    const r = gestionarSchema.safeParse(
      entrega({
        montoRecibido: 8000,
        pagos: [
          { metodo: "efectivo", monto: 5000 },
          { metodo: "transferencia", monto: 3000 },
        ],
      }),
    );
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "entregada") {
      expect(r.data.pagos).toHaveLength(2);
      expect(r.data.metodoPago).toBeUndefined();
    }
  });

  it("regla 5: la suma NO iguala el monto recibido -> error en `pagos`, no en otro campo", () => {
    const { campos, mensajes } = erroresDe(
      entrega({
        montoRecibido: 8000,
        pagos: [
          { metodo: "efectivo", monto: 5000 },
          { metodo: "transferencia", monto: 2999.99 },
        ],
      }),
    );
    expect(campos).toContain("pagos");
    expect(campos).not.toContain("metodoPago");
    expect(mensajes.join(" ")).toMatch(/debe sumar el monto recibido/i);
  });

  it("R30: una suma con decimales que en float NO cuadraria (0.1 + 0.2 = 0.3) SI se acepta", () => {
    const r = gestionarSchema.safeParse(
      entrega({
        montoRecibido: 0.3,
        pagos: [
          { metodo: "efectivo", monto: 0.1 },
          { metodo: "SINPE", monto: 0.2 },
        ],
      }),
    );
    expect(r.success).toBe(true);
  });

  it("una linea con monto NO positivo (0) se rechaza en el propio campo", () => {
    const { campos } = erroresDe(
      entrega({ montoRecibido: 0, pagos: [{ metodo: "efectivo", monto: 0 }] }),
    );
    expect(campos).toContain("pagos");
  });
});

describe("R13 (regla 1): las DOS formas a la vez -> rechaza", () => {
  it("metodoPago escalar + desglose -> error en `pagos`", () => {
    const { campos, mensajes } = erroresDe(
      entrega({
        montoRecibido: 5000,
        metodoPago: "efectivo",
        pagos: [{ metodo: "efectivo", monto: 5000 }],
      }),
    );
    expect(campos).toEqual(["pagos"]);
    expect(mensajes.join(" ")).toMatch(/a la vez/i);
  });
});

describe("R11 (regla 2): metodos repetidos -> rechaza (espejo del @@unique)", () => {
  it("dos lineas del mismo metodo -> error en `pagos` aunque la suma cuadre", () => {
    const { campos, mensajes } = erroresDe(
      entrega({
        montoRecibido: 8000,
        pagos: [
          { metodo: "transferencia", monto: 5000 },
          { metodo: "transferencia", monto: 3000 },
        ],
      }),
    );
    expect(campos).toEqual(["pagos"]);
    expect(mensajes.join(" ")).toMatch(/una sola vez/i);
  });
});

describe("R15 (regla 3): cobro sin ninguna forma -> rechaza en `metodoPago`", () => {
  it("montoRecibido > 0 y ni escalar ni desglose -> error en `metodoPago`", () => {
    const { campos, mensajes } = erroresDe(entrega({ montoRecibido: 100 }));
    expect(campos).toEqual(["metodoPago"]);
    expect(mensajes.join(" ")).toMatch(/metodo de pago requerido/i);
  });

  it("montoRecibido > 0 con desglose VACIO -> error en `metodoPago` (no en `pagos`)", () => {
    const { campos } = erroresDe(entrega({ montoRecibido: 100, pagos: [] }));
    expect(campos).toEqual(["metodoPago"]);
  });
});

describe("R14 (regla 4): entrega SIN cobro", () => {
  it("montoRecibido 0 con desglose no vacio -> error en `pagos`", () => {
    const { campos, mensajes } = erroresDe(
      entrega({ montoRecibido: 0, pagos: [{ metodo: "efectivo", monto: 0.01 }] }),
    );
    expect(campos).toEqual(["pagos"]);
    expect(mensajes.join(" ")).toMatch(/sin cobro/i);
  });

  it("montoRecibido 0 con desglose VACIO -> valido, y normaliza a CERO lineas", () => {
    const input = entrega({ montoRecibido: 0, pagos: [] });
    const r = gestionarSchema.safeParse(input);
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "entregada") {
      expect(normalizarPagos(r.data)).toEqual([]);
    }
  });

  it("montoRecibido 0 con el escalar `efectivo` que hoy fuerza el panel -> valido y CERO lineas", () => {
    const r = gestionarSchema.safeParse(entrega({ montoRecibido: 0, metodoPago: "efectivo" }));
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "entregada") {
      // El panel manda `efectivo` porque su control lo exige; con el modelo nuevo eso NO es
      // una linea de efectivo/0: son CERO lineas (R14).
      expect(normalizarPagos(r.data)).toEqual([]);
    }
  });
});

describe("R12: la forma ESCALAR historica sigue validando (compatibilidad en produccion)", () => {
  it("solo `metodoPago` + monto > 0 -> valido y normaliza a UNA linea con el total", () => {
    const r = gestionarSchema.safeParse(
      entrega({ montoRecibido: 12500, metodoPago: "transferencia" }),
    );
    expect(r.success).toBe(true);
    if (r.success && r.data.resultado === "entregada") {
      expect(r.data.metodoPago).toBe("transferencia");
      expect(normalizarPagos(r.data)).toEqual([{ metodo: "transferencia", monto: 12500 }]);
    }
  });

  it("un metodo fuera del catalogo sigue rechazandose en `metodoPago`", () => {
    const { campos } = erroresDe(entrega({ montoRecibido: 100, metodoPago: "bitcoin" }));
    expect(campos).toContain("metodoPago");
  });
});

describe("R16: ninguna otra rama admite recaudo ni desglose", () => {
  const OTRAS = [
    { resultado: "reprogramada", fechaReprogramacion: "2099-01-01", motivo: "x" },
    { resultado: "devuelta", causaDevolucion: "wrong_address", motivo: "x", evidencias: [foto()] },
    { resultado: "rechazada", motivo: "x", evidencias: [foto()] },
    { resultado: "incidente", causaIncidente: "robado", motivo: "x", evidencias: [foto()] },
  ] as const;

  for (const base of OTRAS) {
    it(`${base.resultado}: un desglose enviado por el cliente NO llega al dato parseado`, () => {
      const r = gestionarSchema.safeParse({
        ordenId: "o1",
        ubicacion: UBICACION,
        ...base,
        montoRecibido: 5000,
        metodoPago: "efectivo",
        pagos: [{ metodo: "efectivo", monto: 5000 }],
      });
      expect(r.success).toBe(true);
      // La `discriminatedUnion` no declara estos campos fuera de `entregada`: quedan fuera del
      // tipo parseado, asi que no hay forma de persistirlos por esta via.
      if (r.success) {
        expect(r.data).not.toHaveProperty("pagos");
        expect(r.data).not.toHaveProperty("metodoPago");
        expect(r.data).not.toHaveProperty("montoRecibido");
      }
    });
  }
});

describe("§0: el schema del borde sigue siendo importable desde el navegador", () => {
  it("`lib/types/gestion-orden.ts` NO importa `@prisma/client` (viaja al bundle del cliente)", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/types/gestion-orden.ts"), "utf8");
    // El panel (`GestionarOrdenPanel.tsx`) valida con ESTE mismo schema en el navegador: un
    // import de `@prisma/client` aqui rompe el bundle del cliente, no el servidor.
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/require\(["']@prisma\/client["']\)/);
  });

  it("el util de la suma tampoco lo importa (lo arrastraria por transitividad)", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/utils/pagos-recaudo.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
  });
});
