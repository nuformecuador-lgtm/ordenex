import { describe, it, expect } from "vitest";

import { aprobarCierreSchema, confirmacionFisicaSchema } from "@/lib/types/cierres-admin";

// Feature 238 (T2.1, R7/R12/R15/R16) — el BORDE de la confirmacion fisica.
//
// Aqui vive la validacion de FORMA (uuid, entero positivo) y NADA MAS. La COBERTURA —que lo
// confirmado sea exactamente el conjunto de gestiones que vuelven a bodega— la valida el SERVICE,
// que es el unico que sabe que gestiones tiene ese cierre y dentro de que alcance. Mismo reparto
// que la 158 (design §10-F).

const CIERRE = "11111111-1111-4111-8111-111111111111";
const GESTION = "22222222-2222-4222-8222-222222222222";
const OTRA = "33333333-3333-4333-8333-333333333333";

describe("238/R15/R16 — el contrato de siempre sigue siendo valido tal cual", () => {
  it("R15/R16: sin `confirmacionFisica` -> valido, con la lista por defecto VACIA", () => {
    const r = aprobarCierreSchema.safeParse({ cierreId: CIERRE });
    expect(r.success).toBe(true);
    // R15: «no vino el campo» se convierte en «confirmacion vacia», que es lo que el servicio
    // rechaza si el cierre tiene retornables. El default NO abre un agujero: lo cierra en un
    // sitio donde la ausencia se podria haber leido como «no aplica».
    if (r.success) expect(r.data.confirmacionFisica).toEqual([]);
  });

  it("R16: con `confirmacionFisica: []` explicito -> valido (cierre sin nada que devolver)", () => {
    const r = aprobarCierreSchema.safeParse({ cierreId: CIERRE, confirmacionFisica: [] });
    expect(r.success).toBe(true);
  });

  it("el payload de la 158 (solo `indemnizaciones`) sigue pasando sin tocarlo", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [{ gestionId: GESTION, monto: "100.00" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.indemnizaciones).toHaveLength(1);
      expect(r.data.confirmacionFisica).toEqual([]);
    }
  });
});

describe("238/R7/R12 — una confirmacion valida", () => {
  it("acepta gestionId uuid + numGuia entero positivo, y los conserva", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      confirmacionFisica: [{ gestionId: GESTION, numGuia: 9001 }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.confirmacionFisica).toEqual([{ gestionId: GESTION, numGuia: 9001 }]);
      // La guia viaja como NUMBER: es `orden.num_guia`, un `Int`, no dinero.
      expect(typeof r.data.confirmacionFisica[0].numGuia).toBe("number");
    }
  });

  it("acepta varias entradas (una por paquete que vuelve; el techo medido son 14)", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      confirmacionFisica: [
        { gestionId: GESTION, numGuia: 1 },
        { gestionId: OTRA, numGuia: 2 },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.confirmacionFisica).toHaveLength(2);
  });

  it("una lista de 14 entradas pasa el borde (el techo real de un cierre)", () => {
    const catorce = Array.from({ length: 14 }, (_, i) => ({
      gestionId: `4444444${i.toString(16)}-4444-4444-8444-444444444444`,
      numGuia: 1000 + i,
    }));
    const r = aprobarCierreSchema.safeParse({ cierreId: CIERRE, confirmacionFisica: catorce });
    expect(r.success).toBe(true);
  });
});

describe("238 — lo que el borde RECHAZA por su forma", () => {
  it("un `gestionId` que no es uuid", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      confirmacionFisica: [{ gestionId: "no-es-uuid", numGuia: 9001 }],
    });
    expect(r.success).toBe(false);
  });

  it("una guia con decimales (un escaner no lee `12.5`)", () => {
    expect(confirmacionFisicaSchema.safeParse({ gestionId: GESTION, numGuia: 12.5 }).success).toBe(
      false,
    );
  });

  it("una guia cero o negativa", () => {
    expect(confirmacionFisicaSchema.safeParse({ gestionId: GESTION, numGuia: 0 }).success).toBe(
      false,
    );
    expect(confirmacionFisicaSchema.safeParse({ gestionId: GESTION, numGuia: -7 }).success).toBe(
      false,
    );
  });

  it("una guia como STRING no se coacciona a number", () => {
    // Si el borde coaccionara, `"9001"` pasaria y la comparacion del servicio con `orden.num_guia`
    // (un `Int`) se haria entre tipos distintos. El borde es el sitio donde eso se para.
    expect(
      confirmacionFisicaSchema.safeParse({ gestionId: GESTION, numGuia: "9001" }).success,
    ).toBe(false);
  });

  it("una entrada sin `numGuia`: R12 no se puede verificar sin ella", () => {
    expect(confirmacionFisicaSchema.safeParse({ gestionId: GESTION }).success).toBe(false);
  });

  it("`confirmacionFisica` que no es una lista", () => {
    expect(
      aprobarCierreSchema.safeParse({ cierreId: CIERRE, confirmacionFisica: { gestionId: GESTION } })
        .success,
    ).toBe(false);
  });
});
