import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 (T6.2, R23) — COMO MUCHO UN mensaje por (dia CR, destinatario, envio), TAMBIEN con
// ejecuciones CONCURRENTES. La concurrencia de verdad exige dos conexiones y filas COMMITEADAS (una
// transaccion revertida no la ve otra conexion): este archivo siembra commiteando con nombres
// unicos y lo BORRA en `afterAll`. Las pruebas («Probar ahora») NO consumen el cupo del dia.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R23 — idempotencia de la ejecucion programada", () => {
  let a: PrismaClient;
  let b: PrismaClient;
  const sembrado: { envioId?: string; plantillaId?: string; usuarios: string[] } = { usuarios: [] };

  beforeAll(async () => {
    a = crearPrismaDeTest();
    b = crearPrismaDeTest();
    // Siembra COMMITEADA (la ven las dos conexiones).
    await a.$transaction(async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const u1 = await crearUsuario(tx, modelo, "admin");
      const u2 = await crearUsuario(tx, modelo, "maestro");
      const p = await crearPlantilla(tx);
      sembrado.usuarios = [u1.id, u2.id];
      sembrado.plantillaId = p.id;
      sembrado.envioId = await crearEnvio(tx, { plantillaId: p.id, nombre: `474 R23 ${randomUUID()}`, usuarioIds: [u1.id, u2.id] });
    });
  });

  afterAll(async () => {
    await a.$executeRawUnsafe(`DELETE FROM "whatsapp_envio_ejecucion" WHERE "envio_id" = $1`, sembrado.envioId);
    await a.$executeRawUnsafe(`DELETE FROM "whatsapp_envio" WHERE "id" = $1`, sembrado.envioId);
    await a.$executeRawUnsafe(`DELETE FROM "plantilla_mensaje" WHERE "id" = $1`, sembrado.plantillaId);
    await a.$executeRawUnsafe(`DELETE FROM "usuario" WHERE "id" = ANY($1::text[])`, sembrado.usuarios);
    await a.$disconnect();
    await b.$disconnect();
  });

  it("⭑ dos ejecuciones CONCURRENTES del mismo dia -> 1 ejecucion y 1 entrega por usuario", async () => {
    const envioId = sembrado.envioId as string;
    const ra = new WhatsappEjecucionRepository(a);
    const rb = new WhatsappEjecucionRepository(b);
    const instante = new Date("2099-03-02T11:00:00.000Z");
    const [x, y] = await Promise.all([
      ra.insertarProgramada({ envioId, fechaCr: "2099-03-02", instanteProgramado: instante }),
      rb.insertarProgramada({ envioId, fechaCr: "2099-03-02", instanteProgramado: instante }),
    ]);
    expect(x.id).toBe(y.id); // LA MISMA fila
    expect([x.creada, y.creada].filter(Boolean)).toHaveLength(1);

    const entregas = sembrado.usuarios.map((usuarioId) => ({
      usuarioId,
      destinatarioNombre: "n",
      telefono: "50688887777",
      estado: "pendiente" as const,
      motivo: null,
    }));
    await Promise.all([ra.insertarEntregas(x.id, entregas), rb.insertarEntregas(y.id, entregas)]);
    const n = await a.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "whatsapp_envio_entrega" WHERE "ejecucion_id" = $1`,
      x.id,
    );
    expect(n[0].n).toBe(2);
    const ejecuciones = await a.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "whatsapp_envio_ejecucion" WHERE "envio_id" = $1 AND "origen" = 'programado' AND "fecha_cr" = '2099-03-02'`,
      envioId,
    );
    expect(ejecuciones[0].n).toBe(1);
  });

  it("otro dia CR es otra ejecucion", async () => {
    const r = new WhatsappEjecucionRepository(a);
    const envioId = sembrado.envioId as string;
    const d1 = await r.insertarProgramada({ envioId, fechaCr: "2099-03-03", instanteProgramado: new Date("2099-03-03T11:00:00Z") });
    const d2 = await r.insertarProgramada({ envioId, fechaCr: "2099-03-04", instanteProgramado: new Date("2099-03-04T11:00:00Z") });
    expect(d1.id).not.toBe(d2.id);
  });

  it("R23: las PRUEBAS no tienen unico ni consumen el cupo del dia", async () => {
    const r = await enTransaccionRevertida(a, async (tx) => {
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const envioId = sembrado.envioId as string;
      const p1 = await repo.insertarPrueba({ envioId, solicitadaPor: sembrado.usuarios[1] });
      const p2 = await repo.insertarPrueba({ envioId, solicitadaPor: sembrado.usuarios[1] });
      const prog = await repo.insertarProgramada({ envioId, fechaCr: "2099-03-09", instanteProgramado: new Date("2099-03-09T11:00:00Z") });
      return { distintas: p1 !== p2, progCreada: prog.creada };
    });
    expect(r).toEqual({ distintas: true, progCreada: true });
  });

  it("R24: una omitida ocupa el dia (no se reenvia esa ocurrencia)", async () => {
    const r = await enTransaccionRevertida(a, async (tx) => {
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const envioId = sembrado.envioId as string;
      const om = await repo.insertarProgramada({
        envioId,
        fechaCr: "2099-03-10",
        instanteProgramado: new Date("2099-03-10T11:00:00Z"),
        estado: "omitida",
        motivo: "tarde",
      });
      const otra = await repo.insertarProgramada({ envioId, fechaCr: "2099-03-10", instanteProgramado: new Date("2099-03-10T11:00:00Z") });
      const fila = await repo.obtener(om.id);
      return { mismo: om.id === otra.id, creada: otra.creada, estado: fila?.estado };
    });
    expect(r).toEqual({ mismo: true, creada: false, estado: "omitida" });
  });
});
