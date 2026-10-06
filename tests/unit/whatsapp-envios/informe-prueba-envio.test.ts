import { describe, it, expect } from "vitest";
import { informePruebaEnvio } from "@/lib/whatsapp-envios/informes/prueba-envio";

// Ficha 474 (T3.2, R47) — «Prueba de envío»: fecha y hora CR del momento, PDF de una pagina, y
// «simular vacio» responde vacio.

const AHORA = new Date("2026-10-05T11:00:00.000Z"); // 05:00 CR del lunes 5

describe("474/R47 — informe prueba_envio", () => {
  it("valores fecha y hora en hora de Costa Rica", async () => {
    const r = await informePruebaEnvio.generar({ parametros: { simularVacio: false }, ahora: AHORA, conDocumento: false });
    expect(r).toEqual({ tipo: "contenido", valores: { fecha: "05/10/2026", hora: "05:00" } });
  });

  it("de noche en CR ya es otro dia en UTC: manda el dia CR", async () => {
    const r = await informePruebaEnvio.generar({
      parametros: { simularVacio: false },
      ahora: new Date("2026-10-06T02:30:00.000Z"), // 20:30 CR del 5
      conDocumento: false,
    });
    expect(r.tipo === "contenido" && r.valores).toEqual({ fecha: "05/10/2026", hora: "20:30" });
  });

  it("con documento: PDF no vacio que empieza por %PDF y nombre prueba-<fecha>.pdf", async () => {
    const r = await informePruebaEnvio.generar({ parametros: { simularVacio: false }, ahora: AHORA, conDocumento: true });
    if (r.tipo !== "contenido" || r.documento === undefined) throw new Error("sin documento");
    expect(r.documento.nombreArchivo).toBe("prueba-2026-10-05.pdf");
    expect(r.documento.bytes.length).toBeGreaterThan(500);
    expect(new TextDecoder().decode(r.documento.bytes.slice(0, 4))).toBe("%PDF");
    // una sola pagina
    const texto = new TextDecoder("latin1").decode(r.documento.bytes);
    expect((texto.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });

  it("simularVacio -> vacio con motivo", async () => {
    const r = await informePruebaEnvio.generar({ parametros: { simularVacio: true }, ahora: AHORA, conDocumento: true });
    expect(r.tipo).toBe("vacio");
  });

  it("el schema rechaza parametros desconocidos y precarga el default", () => {
    expect(informePruebaEnvio.parametros.safeParse({ otro: 1 }).success).toBe(false);
    expect(informePruebaEnvio.parametros.parse({})).toEqual({ simularVacio: false });
  });
});
