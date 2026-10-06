import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 (T6.2, R36/R37) — el RECLAMO condicional de una entrega: solo una corrida la pasa a
// `en_curso`; una `en_curso` (resultado desconocido) NO se reclama otra vez, asi que NUNCA se
// reenvia; el desenlace solo se aplica sobre una `en_curso`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R37 — reclamo de la entrega", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function escenario<T>(fn: (repo: WhatsappEjecucionRepository, entregaId: string) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const u = await crearUsuario(tx, modelo, "admin");
      const p = await crearPlantilla(tx);
      const envioId = await crearEnvio(tx, { plantillaId: p.id });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const ej = await repo.insertarProgramada({ envioId, fechaCr: "2099-04-01", instanteProgramado: new Date("2099-04-01T11:00:00Z") });
      await repo.insertarEntregas(ej.id, [
        { usuarioId: u.id, destinatarioNombre: "n", telefono: "50688887777", estado: "pendiente", motivo: null },
      ]);
      const [entrega] = await repo.entregasPendientes(ej.id);
      return fn(repo, entrega.id);
    });
  }

  it("⭑ el primer reclamo gana y el segundo NO (en_curso no se vuelve a enviar)", async () => {
    const r = await escenario(async (repo, id) => {
      const primero = await repo.reclamarEntrega(id);
      const segundo = await repo.reclamarEntrega(id);
      const fila = await repo.obtenerEntrega(id);
      return { primero, segundo, estado: fila?.estado, intentos: fila?.intentos };
    });
    expect(r).toEqual({ primero: true, segundo: false, estado: "en_curso", intentos: 1 });
  });

  it("el desenlace solo aplica sobre una en_curso; aceptada no se reclama ni se pisa", async () => {
    const r = await escenario(async (repo, id) => {
      const sinReclamar = await repo.resolverEntrega(id, { estado: "aceptada", waMessageId: "wamid.x1", ahora: new Date() });
      await repo.reclamarEntrega(id);
      const ok = await repo.resolverEntrega(id, { estado: "aceptada", waMessageId: "wamid.x1", ahora: new Date() });
      const reclamoTrasAceptar = await repo.reclamarEntrega(id);
      const pisar = await repo.resolverEntrega(id, { estado: "fallida", motivo: "x" });
      return { sinReclamar, ok, reclamoTrasAceptar, pisar, estado: (await repo.obtenerEntrega(id))?.estado };
    });
    expect(r).toEqual({ sinReclamar: false, ok: true, reclamoTrasAceptar: false, pisar: false, estado: "aceptada" });
  });

  it("R36: un transitorio la devuelve a pendiente y se puede reclamar de nuevo", async () => {
    const r = await escenario(async (repo, id) => {
      await repo.reclamarEntrega(id);
      await repo.resolverEntrega(id, { estado: "pendiente", motivo: "temporal" });
      const otra = await repo.reclamarEntrega(id);
      return { otra, intentos: (await repo.obtenerEntrega(id))?.intentos };
    });
    expect(r).toEqual({ otra: true, intentos: 2 });
  });

  it("una entrega con telefono invalido no se reclama nunca", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const u = await crearUsuario(tx, modelo, "admin");
      const p = await crearPlantilla(tx);
      const envioId = await crearEnvio(tx, { plantillaId: p.id });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const ej = await repo.insertarPrueba({ envioId, solicitadaPor: u.id });
      await repo.insertarEntregas(ej, [
        { usuarioId: u.id, destinatarioNombre: "n", telefono: "123", estado: "telefono_invalido", motivo: "Teléfono inválido" },
      ]);
      return (await repo.entregasPendientes(ej)).length;
    });
    expect(r).toBe(0);
  });
});
