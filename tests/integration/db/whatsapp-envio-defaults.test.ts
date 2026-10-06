import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEnvioRepository } from "@/lib/repositories/WhatsappEnvioRepository";
import { EnvioNombreDuplicadoError } from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 (R15/R11/R21) — por el repositorio REAL: un envio nace APAGADO; el nombre es unico
// entre los NO borrados; borrar apaga y conserva la fila; la edicion reemplaza destinatarios.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R15 — defaults y ciclo de vida del envio", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function datos(plantillaId: string, nombre: string, usuarioIds: string[] = []) {
    return {
      nombre,
      informeClave: "prueba_envio",
      plantillaId,
      parametros: { simularVacio: false },
      disparo: "hora_fija" as const,
      diasSemana: [1, 3],
      hora: "05:00",
      eventoClave: null,
      destinatarios: { roles: ["maestro" as const], usuarioIds },
      actorId: null,
    };
  }

  it("⭑ R15: crear deja el envio APAGADO", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx);
      const repo = new WhatsappEnvioRepository(clienteConTransaccionAnidada(tx));
      const e = await repo.crear(datos(p.id, `474 defaults ${p.id}`));
      const fila = await tx.$queryRawUnsafe<{ activo: boolean }[]>(`SELECT "activo" FROM "whatsapp_envio" WHERE "id" = $1`, e.id);
      return { dto: e.encendido, base: fila[0].activo, roles: e.destinatarios.roles, plantilla: e.plantillaNombre === p.nombre };
    });
    expect(r).toEqual({ dto: false, base: false, roles: ["maestro"], plantilla: true });
  });

  it("R11: nombre duplicado entre vigentes -> EnvioNombreDuplicadoError; tras borrar, se reutiliza", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx);
      const repo = new WhatsappEnvioRepository(clienteConSavepoint(tx));
      const nombre = `474 dup ${p.id}`;
      const a = await repo.crear(datos(p.id, nombre));
      let duplicado = false;
      // El INSERT que choca aborta la transaccion: se aisla en un SAVEPOINT, como haria Postgres
      // con una sentencia suelta fuera de la transaccion del test.
      await tx.$executeRawUnsafe("SAVEPOINT dup474");
      try {
        await repo.crear(datos(p.id, nombre));
      } catch (e) {
        duplicado = e instanceof EnvioNombreDuplicadoError;
      }
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT dup474");
      const borrado = await repo.borrar(a.id, null);
      const b = await repo.crear(datos(p.id, nombre));
      const viejo = await repo.obtener(a.id, { incluirBorrados: true });
      return { duplicado, borrado, b: b.id !== a.id, viejoApagado: viejo?.encendido === false, viejoBorrado: viejo?.deletedAt !== null };
    });
    expect(r).toEqual({ duplicado: true, borrado: true, b: true, viejoApagado: true, viejoBorrado: true });
  });

  it("R21: borrar un encendido lo APAGA y conserva la fila; obtener vigente ya no lo ve", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx);
      const repo = new WhatsappEnvioRepository(clienteConTransaccionAnidada(tx));
      const e = await repo.crear(datos(p.id, `474 borrar ${p.id}`));
      await repo.cambiarEncendido(e.id, true, null);
      await repo.borrar(e.id, null);
      return {
        vigente: await repo.obtener(e.id),
        conBorrados: (await repo.obtener(e.id, { incluirBorrados: true }))?.encendido,
        segundoBorrado: await repo.borrar(e.id, null),
      };
    });
    expect(r).toEqual({ vigente: null, conBorrados: false, segundoBorrado: false });
  });

  it("editar REEMPLAZA los destinatarios", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const u = await crearUsuario(tx, modelo, "admin");
      const p = await crearPlantilla(tx);
      const repo = new WhatsappEnvioRepository(clienteConTransaccionAnidada(tx));
      const e = await repo.crear(datos(p.id, `474 editar ${p.id}`, [u.id]));
      const editado = await repo.actualizar(e.id, { ...datos(p.id, `474 editar ${p.id}`), destinatarios: { roles: ["admin"], usuarioIds: [] } });
      return editado?.destinatarios;
    });
    expect(r).toEqual({ roles: ["admin"], usuarioIds: [] });
  });
});
