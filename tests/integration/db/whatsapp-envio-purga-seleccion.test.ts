import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla } from "./_whatsapp-envios-474";

// Ficha 474 (T6.2, R44) — la purga es POR BASE: ejecuciones con PDF, caducado y aun no purgado.
// Las demas (sin PDF, vigentes, ya purgadas) no se tocan. Tras marcar, el historial dice caducado.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R44 — seleccion de la purga", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ solo caducadas con PDF y sin purgar; marcar las saca de la siguiente seleccion", async () => {
    const AHORA = new Date("2099-12-31T00:00:00.000Z");
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx);
      const envio = await crearEnvio(tx, { plantillaId: p.id });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const crear = async (dia: string, pdf: { caduca: string } | null) => {
        const e = await repo.insertarProgramada({ envioId: envio, fechaCr: dia, instanteProgramado: new Date(`${dia}T11:00:00Z`) });
        await repo.fijarContenido(e.id, {
          valores: { fecha: dia },
          plantillaId: p.id,
          plantillaNombre: p.nombre,
          parametros: {},
          pdf: pdf === null ? null : { ruta: `${envio}/${e.id}.pdf`, nombre: "x.pdf", bytes: 1, caducaAt: new Date(pdf.caduca) },
        });
        return e.id;
      };
      const caducada = await crear("2099-10-01", { caduca: "2099-11-01T00:00:00Z" });
      const vigente = await crear("2099-10-02", { caduca: "2100-01-15T00:00:00Z" });
      const sinPdf = await crear("2099-10-03", null);
      const yaPurgada = await crear("2099-10-04", { caduca: "2099-11-02T00:00:00Z" });
      await repo.marcarPurgadas([yaPurgada], AHORA);

      const sel = (await repo.seleccionarPurga(AHORA, 500)).map((s) => s.id);
      const nuestras = [caducada, vigente, sinPdf, yaPurgada].filter((id) => sel.includes(id));
      await repo.marcarPurgadas([caducada], AHORA);
      const tras = (await repo.seleccionarPurga(AHORA, 500)).filter((s) => s.id === caducada);
      const h = await repo.historial({ envioId: envio, page: 1, pageSize: 10 });
      return { nuestras, esperado: [caducada], tras: tras.length, caducadoEnHistorial: h.items.find((i) => i.id === caducada)?.pdf };
    });
    expect(r.nuestras).toEqual(r.esperado);
    expect(r.tras).toBe(0);
    expect(r.caducadoEnHistorial).toEqual({ nombre: "x.pdf", caducado: true });
  });
});
