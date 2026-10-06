import { describe, expect, it, vi } from "vitest";
import { WhatsappEnvioService, construirPreview } from "@/lib/services/WhatsappEnvioService";
import { MAESTRO, destinatario, enviosRepo } from "./_dobles-envios-474";

// Ficha 474 (T7.1, R17) — la lista resuelta y deduplicada, con un aviso por telefono invalido y uno
// por telefono compartido; los avisos NO impiden guardar y la vista previa NO escribe.

describe("474/R17 — previsualizar destinatarios", () => {
  it("avisos de telefono invalido y compartido, sin el telefono completo", () => {
    const p = construirPreview([
      destinatario({ usuarioId: "a", nombre: "Ana", telefono: "8888-7777" }),
      destinatario({ usuarioId: "b", nombre: "Beto", telefono: "+506 8888 7777" }), // el mismo normalizado
      destinatario({ usuarioId: "c", nombre: "Cris", telefono: "123" }),
      destinatario({ usuarioId: "d", nombre: "Dani", telefono: "88881111" }),
    ]);
    expect(p.total).toBe(4);
    expect(p.destinatarios.map((d) => [d.nombre, d.telefonoValido, d.telefonoCompartido, d.telefonoEnmascarado])).toEqual([
      ["Ana", true, true, "•••• 7777"],
      ["Beto", true, true, "•••• 7777"],
      ["Cris", false, false, "••••"],
      ["Dani", true, false, "•••• 1111"],
    ]);
    expect(p.avisos).toHaveLength(3);
    expect(p.avisos.join("|")).toContain("Cris no tiene un teléfono válido");
    expect(JSON.stringify(p)).not.toContain("88887777");
    expect(p.excedeTope).toBe(false);
  });

  it("> 50 marca excedeTope", () => {
    const p = construirPreview(Array.from({ length: 51 }, (_, i) => destinatario({ usuarioId: `u${i}`, telefono: `8888${String(1000 + i)}` })));
    expect(p).toMatchObject({ excedeTope: true, tope: 50, total: 51 });
  });

  it("el service filtra roles no permitidos y NO escribe", async () => {
    const envios = enviosRepo({ resolverDestinatariosDe: vi.fn(async () => [destinatario()]) });
    const s = new WhatsappEnvioService({
      envios,
      plantillas: { findEnviableDeInformeById: vi.fn() },
      cola: { enqueue: vi.fn() },
      ejecuciones: { ultimaPorEnvio: vi.fn() },
    });
    const r = await s.previsualizarDestinatarios({ roles: ["apiKey", "admin"], usuarioIds: [] }, MAESTRO);
    expect(r.status).toBe("ok");
    expect(envios.resolverDestinatariosDe.mock.calls[0][0]).toEqual({ roles: ["admin"], usuarioIds: [] });
    expect(envios.crear).not.toHaveBeenCalled();
    expect(envios.actualizar).not.toHaveBeenCalled();
  });
});
