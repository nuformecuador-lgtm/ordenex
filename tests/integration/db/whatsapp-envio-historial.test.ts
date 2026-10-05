import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 (T6.2, R42/R43) — el historial: mas reciente primero, filtrable por envio, con conteo
// de entregas por estado y el TELEFONO ENMASCARADO (el completo no sale de la capa de datos).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R42 — historial", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ orden, filtro, conteos y telefono enmascarado", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const u1 = await crearUsuario(tx, modelo, "admin", { nombre: "474 Ana" });
      const u2 = await crearUsuario(tx, modelo, "maestro", { nombre: "474 Beto" });
      const p = await crearPlantilla(tx);
      const envio = await crearEnvio(tx, { plantillaId: p.id, nombre: `474 hist ${p.id}` });
      const otro = await crearEnvio(tx, { plantillaId: p.id });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const vieja = await repo.insertarProgramada({ envioId: envio, fechaCr: "2099-06-01", instanteProgramado: new Date("2099-06-01T11:00:00Z") });
      const nueva = await repo.insertarProgramada({ envioId: envio, fechaCr: "2099-06-02", instanteProgramado: new Date("2099-06-02T11:00:00Z") });
      await repo.insertarProgramada({ envioId: otro, fechaCr: "2099-06-02", instanteProgramado: new Date("2099-06-02T11:00:00Z") });
      // El orden lo da created_at: se fija explicito para no depender del reloj.
      await tx.$executeRawUnsafe(`UPDATE "whatsapp_envio_ejecucion" SET "created_at" = '2099-06-01T11:00:00Z' WHERE "id" = $1`, vieja.id);
      await tx.$executeRawUnsafe(`UPDATE "whatsapp_envio_ejecucion" SET "created_at" = '2099-06-02T11:00:00Z' WHERE "id" = $1`, nueva.id);
      await repo.insertarEntregas(nueva.id, [
        { usuarioId: u1.id, destinatarioNombre: u1.nombre, telefono: "50688881234", estado: "pendiente", motivo: null },
        { usuarioId: u2.id, destinatarioNombre: u2.nombre, telefono: "123", estado: "telefono_invalido", motivo: "Teléfono inválido" },
      ]);
      const [e1] = await repo.entregasPendientes(nueva.id);
      await repo.reclamarEntrega(e1.id);
      await repo.resolverEntrega(e1.id, { estado: "aceptada", waMessageId: `wamid.h.${e1.id}`, ahora: new Date() });

      const h = await repo.historial({ envioId: envio, page: 1, pageSize: 10 });
      const det = await repo.detalle(nueva.id);
      return {
        total: h.total,
        ids: h.items.map((i) => i.id),
        esperado: [nueva.id, vieja.id],
        conteos: h.items[0].conteos,
        nombreEnvio: h.items[0].envioNombre === `474 hist ${p.id}`,
        entregas: det?.entregas.map((e) => [e.destinatarioNombre, e.telefonoEnmascarado, e.estado]),
        json: JSON.stringify(det),
      };
    });
    expect(r.total).toBe(2); // el otro envio queda fuera del filtro
    expect(r.ids).toEqual(r.esperado); // mas reciente primero
    expect(r.conteos).toEqual({ aceptada: 1, telefono_invalido: 1 });
    expect(r.nombreEnvio).toBe(true);
    expect(r.entregas).toEqual([
      ["474 Ana", "•••• 1234", "aceptada"],
      ["474 Beto", "••••", "telefono_invalido"],
    ]);
    expect(r.json).not.toContain("50688881234"); // R42/R45: nunca el telefono completo
  });

  it("R43: pdfDe y paginacion", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx);
      const envio = await crearEnvio(tx, { plantillaId: p.id });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const a = await repo.insertarProgramada({ envioId: envio, fechaCr: "2099-07-01", instanteProgramado: new Date("2099-07-01T11:00:00Z") });
      await repo.insertarProgramada({ envioId: envio, fechaCr: "2099-07-02", instanteProgramado: new Date("2099-07-02T11:00:00Z") });
      await repo.fijarContenido(a.id, {
        valores: { fecha: "x" },
        plantillaId: p.id,
        plantillaNombre: p.nombre,
        parametros: {},
        pdf: { ruta: `${envio}/${a.id}.pdf`, nombre: "prueba.pdf", bytes: 10, caducaAt: new Date("2099-08-01T00:00:00Z") },
      });
      const pagina = await repo.historial({ envioId: envio, page: 2, pageSize: 1 });
      return { pdf: await repo.pdfDe(a.id), pagina: pagina.items.length, total: pagina.total };
    });
    expect(r.pdf).toEqual({ ruta: expect.stringMatching(/\.pdf$/), purgado: false });
    expect(r).toMatchObject({ pagina: 1, total: 2 });
  });
});
