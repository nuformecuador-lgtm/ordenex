import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEnvioRepository } from "@/lib/repositories/WhatsappEnvioRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import type { JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { aislarEnvios, crearEnvio, crearPlantilla } from "./_whatsapp-envios-474";

// Ficha 474 (T6.1, R25) — el mantenimiento re-siembra la cadena de todo envio ENCENDIDO a hora fija
// SIN job programado PENDIENTE. El «sin job» es un `NOT EXISTS … payload->>'envioId'` en SQL: se
// prueba contra Postgres. Tambien el «proximo envio» que muestra la pantalla.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R25 — envios con la cadena rota", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ encendido sin job -> aparece; con job pendiente -> no; apagado/borrado/evento -> no", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await aislarEnvios(tx);
      const p = await crearPlantilla(tx);
      const roto = await crearEnvio(tx, { plantillaId: p.id, activo: true });
      const conJob = await crearEnvio(tx, { plantillaId: p.id, activo: true });
      const conJobHecho = await crearEnvio(tx, { plantillaId: p.id, activo: true });
      const apagado = await crearEnvio(tx, { plantillaId: p.id, activo: false });
      const borrado = await crearEnvio(tx, { plantillaId: p.id, activo: true, borrado: true });
      const pe = await crearPlantilla(tx, { informeClave: "aviso_interno" });
      const evento = await crearEnvio(tx, { plantillaId: pe.id, disparo: "evento", activo: true });

      const cola = new JobRepository(tx as unknown as PrismaClient);
      const jtx = tx as unknown as JobTxClient;
      await cola.enqueue("whatsapp_envio_programado", { envioId: conJob, fechaCr: "2099-01-05", hora: "05:00" }, {}, jtx);
      const hecho = await cola.enqueue("whatsapp_envio_programado", { envioId: conJobHecho, fechaCr: "2099-01-05", hora: "05:00" }, {}, jtx);
      await tx.$executeRawUnsafe(`UPDATE "jobs" SET "estado" = 'done' WHERE "id" = $1`, hecho?.id);

      const repo = new WhatsappEnvioRepository(clienteConTransaccionAnidada(tx));
      const ids = (await repo.encendidosHoraFijaSinJobPendiente()).map((e) => e.id);
      const pendientes = await repo.jobsProgramadosPendientes([conJob, roto]);
      return {
        roto: ids.includes(roto),
        conJob: ids.includes(conJob),
        conJobHecho: ids.includes(conJobHecho),
        apagado: ids.includes(apagado),
        borrado: ids.includes(borrado),
        evento: ids.includes(evento),
        pendientes: pendientes.map((j) => [j.envioId === conJob, j.fechaCr, j.hora]),
      };
    });
    expect(r).toEqual({
      roto: true,
      conJob: false,
      conJobHecho: true, // un job YA HECHO no cuenta: la cadena esta rota
      apagado: false,
      borrado: false,
      evento: false,
      pendientes: [[true, "2099-01-05", "05:00"]],
    });
  });
});
