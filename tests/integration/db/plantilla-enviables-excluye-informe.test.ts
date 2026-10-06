import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearPlantilla } from "./_whatsapp-envios-474";

// Ficha 474 (T5.2, R8/R12) — los TRES lectores de plantillas que usan el chat, el wa.me y la
// bienvenida EXCLUYEN las plantillas de informe; el lector del motor solo devuelve la de SU informe.
// El filtro vive en el WHERE: por eso contra Postgres (memoria «probar el WHERE donde vive»).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R8 — lectores de plantillas", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sembrar<T>(fn: (repo: PlantillaMensajeRepository, orden: string, informe: string) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const orden = await crearPlantilla(tx, { informeClave: null });
      const informe = await crearPlantilla(tx, { informeClave: "prueba_envio", llevaDocumento: true });
      return fn(new PlantillaMensajeRepository(tx as unknown as PrismaClient), orden.id, informe.id);
    });
  }

  it("listarEnviables: la de orden SI, la de informe NO", async () => {
    const ids = await sembrar(async (repo, orden, informe) => {
      const l = (await repo.listarEnviables()).map((p) => p.id);
      return { tieneOrden: l.includes(orden), tieneInforme: l.includes(informe) };
    });
    expect(ids).toEqual({ tieneOrden: true, tieneInforme: false });
  });

  it("findEnviableById: la de informe es null (chat y bienvenida no la resuelven)", async () => {
    const r = await sembrar(async (repo, orden, informe) => ({
      orden: (await repo.findEnviableById(orden))?.id ?? null,
      informe: await repo.findEnviableById(informe),
      ordenId: orden,
    }));
    expect(r.orden).toBe(r.ordenId);
    expect(r.informe).toBeNull();
  });

  it("listarUsablesParaTexto (wa.me): la de informe NO, con y sin las de tienda", async () => {
    const r = await sembrar(async (repo, orden, informe) => {
      const a = (await repo.listarUsablesParaTexto({ incluirDeTienda: false })).map((p) => p.id);
      const b = (await repo.listarUsablesParaTexto({ incluirDeTienda: true })).map((p) => p.id);
      return { a: [a.includes(orden), a.includes(informe)], b: [b.includes(orden), b.includes(informe)] };
    });
    expect(r).toEqual({ a: [true, false], b: [true, false] });
  });

  it("R12: findEnviableDeInformeById devuelve la del informe con su marca de documento", async () => {
    const r = await sembrar(async (repo, orden, informe) => ({
      propio: await repo.findEnviableDeInformeById(informe, "prueba_envio"),
      otroInforme: await repo.findEnviableDeInformeById(informe, "aviso_interno"),
      deOrden: await repo.findEnviableDeInformeById(orden, "prueba_envio"),
    }));
    expect(r.propio).toMatchObject({ informeClave: "prueba_envio", llevaDocumento: true, templateId: "tpl-474" });
    expect(r.otroInforme).toBeNull();
    expect(r.deOrden).toBeNull();
  });

  it("R12: una de informe inactiva o sin template no es enviable para el motor", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new PlantillaMensajeRepository(tx as unknown as PrismaClient);
      const inactiva = await crearPlantilla(tx, { estado: "inactivo" });
      const sinTemplate = await crearPlantilla(tx, { templateId: null });
      return [
        await repo.findEnviableDeInformeById(inactiva.id, "prueba_envio"),
        await repo.findEnviableDeInformeById(sinTemplate.id, "prueba_envio"),
      ];
    });
    expect(r).toEqual([null, null]);
  });
});
