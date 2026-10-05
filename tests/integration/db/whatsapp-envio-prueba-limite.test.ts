import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 (T6.2, R41) — la ventana anti doble clic de «Probar ahora» lee la ULTIMA prueba de ESE
// usuario sobre ESE envio. El WHERE (usuario, envio, origen) se prueba contra Postgres.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R41 — ultima prueba", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ devuelve la ultima prueba del par (usuario, envio) e ignora la de otro usuario, otro envio y las programadas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const yo = await crearUsuario(tx, modelo, "maestro");
      const otro = await crearUsuario(tx, modelo, "maestro");
      const p = await crearPlantilla(tx);
      const envio = await crearEnvio(tx, { plantillaId: p.id });
      const otroEnvio = await crearEnvio(tx, { plantillaId: p.id });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const mia = await repo.insertarPrueba({ envioId: envio, solicitadaPor: yo.id });
      const ajenaUsuario = await repo.insertarPrueba({ envioId: envio, solicitadaPor: otro.id });
      const ajenaEnvio = await repo.insertarPrueba({ envioId: otroEnvio, solicitadaPor: yo.id });
      const prog = await repo.insertarProgramada({ envioId: envio, fechaCr: "2099-09-01", instanteProgramado: new Date("2099-09-01T11:00:00Z") });
      const fijar = (id: string, t: string) =>
        tx.$executeRawUnsafe(`UPDATE "whatsapp_envio_ejecucion" SET "created_at" = $2::timestamp WHERE "id" = $1`, id, t);
      await fijar(mia, "2099-09-01 10:00:00");
      await fijar(ajenaUsuario, "2099-09-01 10:00:20");
      await fijar(ajenaEnvio, "2099-09-01 10:00:25");
      await fijar(prog.id, "2099-09-01 10:00:29");
      const sinPruebas = await repo.ultimaPruebaDe(otro.id, otroEnvio);
      return { ultima: (await repo.ultimaPruebaDe(yo.id, envio))?.toISOString(), sinPruebas };
    });
    expect(r).toEqual({ ultima: "2099-09-01T10:00:00.000Z", sinPruebas: null });
  });
});
