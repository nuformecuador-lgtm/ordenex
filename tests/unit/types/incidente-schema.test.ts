import { describe, it, expect } from "vitest";
import {
  aprobarIncidenteSchema,
  rechazarIncidenteSchema,
  reportarIncidenteSchema,
  retractarIncidenteSchema,
} from "@/lib/types/incidente";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { gestionConfig } from "@/lib/config/gestion";

// Feature 158 (T1.25, R45/R46/R50/R55) — BORDE del camino del ADMIN. Lo que aqui se prueba es
// lo que un cliente NO consigue colar: una causa fuera de la lista cerrada, un motivo vacio, un
// reporte sin foto, un monto que no es dinero valido.

const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
const INCIDENTE_ID = "22222222-2222-4222-8222-222222222222";

/** File-like valido segun `validarEvidencia` (imagen permitida, tamano > 0 y bajo el tope). */
function foto(type = "image/jpeg", size = 1024) {
  return { type, size };
}

function reporteValido(over: Record<string, unknown> = {}) {
  return {
    ordenId: ORDEN_ID,
    causa: "danado",
    motivo: "caja aplastada en la estiba",
    evidencias: [foto()],
    ...over,
  };
}

/** El mismo reporte SIN uno de sus campos (para probar la ausencia, no el valor vacio). */
function reporteSin(campo: string, over: Record<string, unknown> = {}) {
  const raw: Record<string, unknown> = reporteValido(over);
  delete raw[campo];
  return raw;
}

describe("R45 — la causa es la MISMA lista CERRADA de 3 valores del camino del mensajero", () => {
  it.each([...CAUSA_INCIDENTE_SEED])("acepta la causa `%s`", (causa) => {
    const r = reportarIncidenteSchema.safeParse(reporteValido({ causa }));
    expect(r.success).toBe(true);
  });

  it.each([
    ["fuera de la lista", "otro"],
    ["en ingles (la 73 los tiene asi; esta NO)", "damaged"],
    ["vacia", ""],
    ["con mayusculas", "Danado"],
  ])("rechaza una causa %s con error en el campo `causa`", (_caso, causa) => {
    const r = reportarIncidenteSchema.safeParse(reporteValido({ causa }));
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("causa");
  });

  it("rechaza el reporte SIN causa", () => {
    const sinCausa = reporteSin("causa");
    const r = reportarIncidenteSchema.safeParse(sinCausa);
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("causa");
  });

  it("R45 = R9: el borde del admin y el del mensajero comparten EXACTAMENTE el mismo SEED", () => {
    // Si alguien duplicara la lista aqui, este caso no lo veria; lo que fija es que el conjunto
    // ACEPTADO por este borde sea exactamente el SEED, ni uno mas ni uno menos.
    const aceptadas = ["danado", "perdido", "robado", "otro", "damaged", "lost"].filter(
      (c) => reportarIncidenteSchema.safeParse(reporteValido({ causa: c })).success,
    );
    expect(aceptadas).toEqual([...CAUSA_INCIDENTE_SEED]);
  });
});

describe("R45 — el motivo libre es OBLIGATORIO y APARTE de la causa", () => {
  it.each([
    ["vacio", ""],
    ["solo espacios", "   "],
  ])("rechaza un motivo %s", (_caso, motivo) => {
    const r = reportarIncidenteSchema.safeParse(reporteValido({ motivo }));
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("motivo");
  });

  it("rechaza el reporte SIN motivo (la causa NO lo sustituye)", () => {
    const sinMotivo = reporteSin("motivo");
    const r = reportarIncidenteSchema.safeParse(sinMotivo);
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("motivo");
  });

  it("el motivo se recorta pero NO se decora con la causa (campos aparte)", () => {
    const r = reportarIncidenteSchema.parse(reporteValido({ motivo: "  se mojo la caja  " }));
    expect(r.motivo).toBe("se mojo la caja");
    expect(r.motivo).not.toContain("danado");
  });
});

describe("R46 (Q-B) — la evidencia es OBLIGATORIA 1..N en las TRES causas", () => {
  it.each([...CAUSA_INCIDENTE_SEED])(
    "con causa `%s`, una lista VACIA de fotos se rechaza (perdido/robado NO estan exentos)",
    (causa) => {
      const r = reportarIncidenteSchema.safeParse(reporteValido({ causa, evidencias: [] }));
      expect(r.success).toBe(false);
      expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("evidencias");
    },
  );

  it.each([...CAUSA_INCIDENTE_SEED])("con causa `%s`, el envio SIN el campo se rechaza", (causa) => {
    const sinFotos = reporteSin("evidencias", { causa });
    const r = reportarIncidenteSchema.safeParse(sinFotos);
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("evidencias");
  });

  it("R46 = R10: acepta hasta el tope configurado y rechaza uno mas", () => {
    const tope = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;
    const enTope = Array.from({ length: tope }, () => foto());
    expect(reportarIncidenteSchema.safeParse(reporteValido({ evidencias: enTope })).success).toBe(
      true,
    );
    const pasado = [...enTope, foto()];
    expect(reportarIncidenteSchema.safeParse(reporteValido({ evidencias: pasado })).success).toBe(
      false,
    );
  });

  it("R46: un archivo con MIME no permitido invalida el envio COMPLETO", () => {
    const r = reportarIncidenteSchema.safeParse(
      reporteValido({ evidencias: [foto(), foto("application/pdf")] }),
    );
    expect(r.success).toBe(false);
  });

  it("R46: un archivo vacio o por encima del tope de bytes invalida el envio", () => {
    expect(
      reportarIncidenteSchema.safeParse(reporteValido({ evidencias: [foto("image/png", 0)] }))
        .success,
    ).toBe(false);
    expect(
      reportarIncidenteSchema.safeParse(
        reporteValido({ evidencias: [foto("image/png", gestionConfig.MAX_FILE_BYTES + 1)] }),
      ).success,
    ).toBe(false);
  });
});

describe("R41 — la orden se identifica por uuid", () => {
  it("rechaza un ordenId que no es uuid", () => {
    const r = reportarIncidenteSchema.safeParse(reporteValido({ ordenId: "no-es-uuid" }));
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("ordenId");
  });

  it("R50/R51: el reporte NO admite monto — quien reporta no tarifa", () => {
    // El campo no existe en el schema: aunque el cliente lo mande, no cruza al service.
    const r = reportarIncidenteSchema.parse(reporteValido({ monto: "100.00" }));
    expect(r).not.toHaveProperty("monto");
    expect(r).not.toHaveProperty("indemnizacion");
  });
});

describe("R50/R55 — el monto de la aprobacion es dinero valido y viaja STRING", () => {
  const ok = (monto: unknown) =>
    aprobarIncidenteSchema.safeParse({ incidenteId: INCIDENTE_ID, monto });

  it("acepta un monto STRING positivo con hasta 2 decimales, TAL CUAL", () => {
    const r = aprobarIncidenteSchema.parse({ incidenteId: INCIDENTE_ID, monto: "12345.67" });
    expect(r.monto).toBe("12345.67");
    expect(typeof r.monto).toBe("string");
  });

  it.each([
    ["vacio", ""],
    ["cero", "0"],
    ["cero con decimales", "0.00"],
    ["negativo", "-10.00"],
    ["tres decimales", "10.001"],
    ["con coma decimal", "10,50"],
    ["con separador de miles", "1,000.00"],
    ["texto", "mil colones"],
    ["notacion cientifica", "1e3"],
    ["con simbolo", "₡100.00"],
    ["espacios internos", "10 00"],
  ])("rechaza un monto %s", (_caso, monto) => {
    const r = ok(monto);
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("monto");
  });

  it("R55: un monto NUMBER se rechaza (money-safe: nunca coma flotante)", () => {
    expect(ok(12345.67).success).toBe(false);
  });

  it("R50: exige el monto (no hay default silencioso)", () => {
    expect(aprobarIncidenteSchema.safeParse({ incidenteId: INCIDENTE_ID }).success).toBe(false);
  });

  it("m5 reusado: acepta el tope EXACTO y rechaza un centimo mas", () => {
    // `orden_incidente.indemnizacion` es DECIMAL(12,2), la MISMA precision que
    // `gestion_orden.indemnizacion`: por eso el tope se reusa en vez de re-derivarse.
    expect(ok(INDEMNIZACION_MONTO_MAX).success).toBe(true);
    expect(INDEMNIZACION_MONTO_MAX).toBe("9999999999.99");
    expect(ok("10000000000.00").success).toBe(false);
    expect(ok("99999999999.99").success).toBe(false);
  });

  it("el mensaje del tope NO aparece en un valor que ni siquiera es numerico", () => {
    // Zod v4 corre el refine aunque el regex ya haya fallado; decirle «no puede superar
    // 9999999999.99» a quien escribio «mil colones» seria un mensaje enganoso.
    const r = ok("mil colones");
    expect(r.success).toBe(false);
    const mensajes = r.error!.flatten().fieldErrors.monto ?? [];
    expect(mensajes.join(" ")).not.toContain("superar");
  });
});

describe("R54/R59 — motivo de rechazo obligatorio; el retracto no lo lleva", () => {
  it("acepta un rechazo con motivo y lo recorta", () => {
    const r = rechazarIncidenteSchema.parse({ incidenteId: INCIDENTE_ID, motivo: "  no aplica  " });
    expect(r.motivo).toBe("no aplica");
  });

  it.each([
    ["vacio", ""],
    ["solo espacios", "   "],
  ])("rechaza el rechazo con motivo %s", (_caso, motivo) => {
    const r = rechazarIncidenteSchema.safeParse({ incidenteId: INCIDENTE_ID, motivo });
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("motivo");
  });

  it("rechaza el rechazo SIN motivo", () => {
    expect(rechazarIncidenteSchema.safeParse({ incidenteId: INCIDENTE_ID }).success).toBe(false);
  });

  it("R59: el RETRACTO no pide motivo (no hay aprobador que justifique nada)", () => {
    const r = retractarIncidenteSchema.parse({ incidenteId: INCIDENTE_ID });
    expect(r).toEqual({ incidenteId: INCIDENTE_ID });
    expect(r).not.toHaveProperty("motivo");
  });

  it("los tres verbos exigen un incidenteId uuid", () => {
    for (const schema of [
      aprobarIncidenteSchema,
      rechazarIncidenteSchema,
      retractarIncidenteSchema,
    ]) {
      const r = schema.safeParse({ incidenteId: "abc", monto: "1.00", motivo: "x" });
      expect(r.success).toBe(false);
      expect(Object.keys(r.error!.flatten().fieldErrors)).toContain("incidenteId");
    }
  });
});
