import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient, WhatsappEntregaEstado } from "@prisma/client";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import type { EstadoWebhookEntrega } from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 (T6.2, R38) — los estados del webhook por `wa_message_id`, SIN retroceder: aceptada 1 <
// enviada 2 < recibida 3 < leida 4; `fallida` solo pisa aceptada/enviada. El rango vive en el UPDATE.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R38 — estados del webhook", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Aplica la secuencia de estados sobre UNA entrega aceptada y devuelve el estado tras cada paso. */
  async function secuencia(pasos: EstadoWebhookEntrega[]): Promise<{ estados: WhatsappEntregaEstado[]; motivo: string | null }> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const u = await crearUsuario(tx, modelo, "admin");
      const p = await crearPlantilla(tx);
      const envioId = await crearEnvio(tx, { plantillaId: p.id });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const ej = await repo.insertarProgramada({ envioId, fechaCr: "2099-05-01", instanteProgramado: new Date("2099-05-01T11:00:00Z") });
      await repo.insertarEntregas(ej.id, [
        { usuarioId: u.id, destinatarioNombre: "n", telefono: "50688887777", estado: "pendiente", motivo: null },
      ]);
      const [e] = await repo.entregasPendientes(ej.id);
      const wamid = `wamid.474.${e.id}`;
      await repo.reclamarEntrega(e.id);
      await repo.resolverEntrega(e.id, { estado: "aceptada", waMessageId: wamid, ahora: new Date() });
      const estados: WhatsappEntregaEstado[] = [];
      for (const paso of pasos) {
        await repo.aplicarEstadoWebhook(wamid, paso, paso === "fallida" ? "motivo fijo" : null);
        estados.push((await repo.obtenerEntrega(e.id))?.estado as WhatsappEntregaEstado);
      }
      return { estados, motivo: (await repo.obtenerEntrega(e.id))?.motivo ?? null };
    });
  }

  it("⭑ avanza en orden y NO retrocede (leida -> recibida -> enviada se queda en leida)", async () => {
    const r = await secuencia(["enviada", "leida", "recibida", "enviada"]);
    expect(r.estados).toEqual(["enviada", "leida", "leida", "leida"]);
  });

  it("fallida pisa enviada, con su motivo", async () => {
    const r = await secuencia(["enviada", "fallida"]);
    expect(r).toEqual({ estados: ["enviada", "fallida"], motivo: "motivo fijo" });
  });

  it("fallida NO pisa una recibida ni una leida", async () => {
    expect((await secuencia(["recibida", "fallida"])).estados).toEqual(["recibida", "recibida"]);
    expect((await secuencia(["leida", "fallida"])).estados).toEqual(["leida", "leida"]);
  });

  it("un wa_message_id ajeno no toca nada", async () => {
    const n = await enTransaccionRevertida(prisma, async (tx) => {
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      return repo.aplicarEstadoWebhook("wamid.no-existe-474", "leida", null);
    });
    expect(n).toBe(0);
  });
});
