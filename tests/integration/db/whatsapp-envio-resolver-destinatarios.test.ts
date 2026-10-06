import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEnvioRepository } from "@/lib/repositories/WhatsappEnvioRepository";
import { ROLES_DESTINATARIO } from "@/lib/types/envios-whatsapp";
import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { crearEnvio, crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 (T6.1, R17/R28) — A QUIEN le llega: union (roles ∪ usuarios), SOLO `activo`, SOLO roles
// permitidos (incluido `adminTienda`, nunca `apiKey`), deduplicado por usuario. Vive en un WHERE:
// contra Postgres (memoria «probar el WHERE donde vive»). Los conjuntos se comparan RESTRINGIDOS a
// los usuarios sembrados: la base tiene otros usuarios reales de esos roles.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R28 — resolverDestinatarios", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ rol ∪ usuario, solo activos, dedup, adminTienda SI y apiKey NO", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const adminSat = await crearUsuario(tx, modelo, "adminSatelite", { nombre: "474 A sat" });
      const adminSatInactivo = await crearUsuario(tx, modelo, "adminSatelite", { estado: "inactivo" });
      const tienda = await crearUsuario(tx, modelo, "adminTienda", { nombre: "474 B tienda" });
      const mensajero = await crearUsuario(tx, modelo, "mensajero", { nombre: "474 C mensajero" });
      const mensajeroInactivo = await crearUsuario(tx, modelo, "mensajero", { estado: "bloqueado" });
      const api = await crearUsuario(tx, modelo, "apiKey");
      const p = await crearPlantilla(tx);
      // Roles: adminSatelite. Usuarios: el adminSat (DUPLICADO por rol), la tienda, el mensajero
      // inactivo, el apiKey.
      const envioId = await crearEnvio(tx, {
        plantillaId: p.id,
        roles: ["adminSatelite"],
        usuarioIds: [adminSat.id, tienda.id, mensajeroInactivo.id, api.id],
      });
      const repo = new WhatsappEnvioRepository(clienteConTransaccionAnidada(tx));
      const sembrados = new Set([adminSat.id, adminSatInactivo.id, tienda.id, mensajero.id, mensajeroInactivo.id, api.id]);
      const resueltos = (await repo.resolverDestinatarios(envioId, ROLES_DESTINATARIO)).filter((d) => sembrados.has(d.usuarioId));
      return {
        ids: resueltos.map((d) => d.usuarioId),
        esperado: [adminSat.id, tienda.id],
        roles: resueltos.map((d) => d.rol),
      };
    });
    expect(r.ids).toEqual(r.esperado); // orden por nombre: «474 A sat» < «474 B tienda»
    expect(r.roles).toEqual(["adminSatelite", "adminTienda"]);
  });

  it("R28: el rol elegido trae a TODOS sus usuarios activos", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const m1 = await crearUsuario(tx, modelo, "mensajero");
      const m2 = await crearUsuario(tx, modelo, "mensajero");
      const repo = new WhatsappEnvioRepository(clienteConTransaccionAnidada(tx));
      const ids = (await repo.resolverDestinatariosDe({ roles: ["mensajero"], usuarioIds: [] }, ROLES_DESTINATARIO)).map(
        (d) => d.usuarioId,
      );
      return { tiene1: ids.includes(m1.id), tiene2: ids.includes(m2.id), sinDuplicados: new Set(ids).size === ids.length };
    });
    expect(r).toEqual({ tiene1: true, tiene2: true, sinDuplicados: true });
  });

  it("un rol NO permitido no se resuelve aunque se pida", async () => {
    const ids = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const api = await crearUsuario(tx, modelo, "apiKey");
      const repo = new WhatsappEnvioRepository(clienteConTransaccionAnidada(tx));
      return (await repo.resolverDestinatariosDe({ roles: ["apiKey"], usuarioIds: [api.id] }, ROLES_DESTINATARIO)).map(
        (d) => d.usuarioId,
      );
    });
    expect(ids).toEqual([]);
  });

  it("sin seleccion: vacio sin consultar", async () => {
    const repo = new WhatsappEnvioRepository(prisma);
    expect(await repo.resolverDestinatariosDe({ roles: [], usuarioIds: [] }, ROLES_DESTINATARIO)).toEqual([]);
  });
});
