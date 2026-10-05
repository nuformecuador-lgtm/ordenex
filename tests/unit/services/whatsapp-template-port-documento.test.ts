import { describe, expect, it, vi } from "vitest";
import { WhatsappTemplatePort } from "@/lib/services/whatsapp/WhatsappTemplatePort";
import type { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import type { WhatsappConfig } from "@/lib/config/whatsapp";
import { ProveedorHandleDocumentoEjemplo } from "@/lib/services/whatsapp/documento-ejemplo-plantilla";

// Ficha 474 (T5.1, R4/R5) — el puerto crea el template de una plantilla de informe con los
// ejemplos de SU informe y, si lleva documento, con la cabecera DOCUMENT y el handle del ejemplo.

const CONFIG: WhatsappConfig = {
  token: "t",
  numeroId: "n",
  wabaId: "w",
  apiVersion: "v21.0",
  templateCategoria: "UTILITY",
  templateIdioma: "es",
};

function cliente() {
  const crear = vi.fn(async () => ({ id: "tpl-1", status: "PENDING" }));
  const actualizar = vi.fn(async () => {});
  return { crear, actualizar, client: { crear, actualizar } as unknown as WhatsappPlantillasClient };
}

describe("474/R5 — WhatsappTemplatePort con documento", () => {
  it("plantilla de informe con documento: HEADER DOCUMENT + ejemplos del informe", async () => {
    const c = cliente();
    const documento = { obtenerHandle: vi.fn(async () => "4::H") };
    const port = new WhatsappTemplatePort(c.client, CONFIG, documento);
    await port.crearTemplate({
      nombre: "prueba",
      cuerpo: "Hola {{destinatario_nombre}}, {{fecha}}",
      variables: ["destinatario_nombre", "fecha"],
      informeClave: "prueba_envio",
      llevaDocumento: true,
    });
    const components = (c.crear.mock.calls[0] as unknown as [{ components: unknown[] }])[0].components;
    expect(components).toEqual([
      { type: "HEADER", format: "DOCUMENT", example: { header_handle: ["4::H"] } },
      { type: "BODY", text: "Hola {{1}}, {{2}}", example: { body_text: [["Daniel", "05/10/2026"]] } },
    ]);
  });

  it("plantilla de ORDEN: componentes de siempre y sin pedir handle", async () => {
    const c = cliente();
    const documento = { obtenerHandle: vi.fn() };
    const port = new WhatsappTemplatePort(c.client, CONFIG, documento);
    await port.actualizarTemplate("tpl", { nombre: "n", cuerpo: "Hola {{destinatario}}", variables: ["destinatario"] });
    expect(c.actualizar).toHaveBeenCalledWith("tpl", {
      components: [{ type: "BODY", text: "Hola {{1}}", example: { body_text: [["María Rodríguez"]] } }],
    });
    expect(documento.obtenerHandle).not.toHaveBeenCalled();
  });

  it("con documento y SIN proveedor: lanza (nunca crea el template sin la cabecera)", async () => {
    const c = cliente();
    const port = new WhatsappTemplatePort(c.client, CONFIG);
    await expect(
      port.crearTemplate({ nombre: "n", cuerpo: "x", variables: [], informeClave: "prueba_envio", llevaDocumento: true }),
    ).rejects.toThrow(/sin proveedor/);
    expect(c.crear).not.toHaveBeenCalled();
  });
});

describe("474/R5/R48 — ProveedorHandleDocumentoEjemplo", () => {
  it("resuelve la app y sube el PDF de ejemplo bajo ESE appId", async () => {
    const subir = vi.fn(async () => ({ status: "ok" as const, handle: "4::X" }));
    const p = new ProveedorHandleDocumentoEjemplo(
      { resolver: async () => ({ ok: true, appId: "777", origen: "meta" }) },
      { subir },
    );
    expect(await p.obtenerHandle()).toBe("4::X");
    const arg = (subir.mock.calls[0] as unknown as [{ appId: string; bytes: Uint8Array; mime: string }])[0];
    expect(arg.appId).toBe("777");
    expect(arg.mime).toBe("application/pdf");
    expect(new TextDecoder().decode(arg.bytes.slice(0, 4))).toBe("%PDF");
  });

  it("app no resuelta -> lanza con el codigo, sin subir", async () => {
    const subir = vi.fn();
    const p = new ProveedorHandleDocumentoEjemplo(
      { resolver: async () => ({ ok: false, motivo: "http", codigo: 190 }) },
      { subir },
    );
    await expect(p.obtenerHandle()).rejects.toThrow(/código 190/);
    expect(subir).not.toHaveBeenCalled();
  });

  it("subida rechazada -> lanza con el detalle", async () => {
    const p = new ProveedorHandleDocumentoEjemplo(
      { resolver: async () => ({ ok: true, appId: "1", origen: "env" }) },
      { subir: async () => ({ status: "rechazado", detalle: "HTTP 400 (Meta 100)", codigoMeta: 100 }) },
    );
    await expect(p.obtenerHandle()).rejects.toThrow(/Meta 100/);
  });
});
