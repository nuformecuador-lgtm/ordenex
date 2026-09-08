import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient, RolValue } from "@prisma/client";

import { UserRepository } from "@/lib/repositories/UserRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 379 / T5 (R17/R22) — **LOS CUATRO CORTES VAN EN EL `WHERE`**, medidos contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El recuento decide si el aviso aparece: si dice «queda alguien» cuando no queda nadie, el maestro
// deja una zona sin Admin satelite sin enterarse — que es el agujero entero de la ficha. Y los
// cuatro cortes (zona, estado activo, rol, y excluir al propio evaluado) viven en un `WHERE`, asi
// que un doble de Prisma no ve ninguno: le da igual lo que diga el filtro.
//
// Cada caso siembra su propio universo en una zona DESECHABLE creada por el test, para que el
// numero no dependa de lo que ya haya en la base compartida.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const SUFIJO = `379-cnt-${Date.now().toString(36)}`;

describeSiHayBase("379/T5 · `contarAdminSatelitesActivos` corta en el WHERE (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sembrarZona(tx: TxDeTest, marca: string): Promise<string> {
    const fila = await tx.zona.create({
      data: { nombre: `Zona ${SUFIJO}-${marca}`, cobroVehiculo: false, esCentral: false },
      select: { id: true },
    });
    return fila.id;
  }

  async function rolPorValor(tx: TxDeTest, value: RolValue): Promise<string> {
    const fila = await tx.rol.findFirst({ where: { value }, select: { id: true } });
    if (!fila) {
      throw new Error(
        `hay DATABASE_URL pero el catalogo de roles no tiene "${value}": corre ` +
          "`pnpm run db:seed` antes de esta suite.",
      );
    }
    return fila.id;
  }

  async function sembrarUsuario(
    tx: TxDeTest,
    marca: string,
    datos: { rolId: string; zonaId: string | null; estado: "activo" | "inactivo" },
  ): Promise<string> {
    const plantilla = await tx.usuario.findFirst({ select: { tipoIdentificacionId: true } });
    if (!plantilla) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `usuario` esta vacia: sin el catalogo de tipos de " +
          "identificacion no se puede sembrar. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    const fila = await tx.usuario.create({
      data: {
        nombre: `Test${marca}`,
        primerApellido: "Efimero",
        email: `${SUFIJO}-${marca}@example.test`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `${SUFIJO}-${marca}`,
        estado: datos.estado,
        tipoIdentificacionId: plantilla.tipoIdentificacionId,
        rolId: datos.rolId,
        zonaId: datos.zonaId,
      },
      select: { id: true },
    });
    return fila.id;
  }

  it("⭑ R17: no se cuenta a si mismo, ni a inactivos, ni a otras zonas, ni a otros roles", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [rolSat, rolMsg] = await Promise.all([
        rolPorValor(tx, "adminSatelite"),
        rolPorValor(tx, "mensajero"),
      ]);
      const zonaId = await sembrarZona(tx, "sola");
      const otraZonaId = await sembrarZona(tx, "vecina");

      // El usuario que se esta evaluando: adminSatelite activo de la zona.
      const evaluadoId = await sembrarUsuario(tx, "eval", {
        rolId: rolSat,
        zonaId,
        estado: "activo",
      });
      // Los cuatro que NO deben contar, uno por corte:
      await sembrarUsuario(tx, "inact", { rolId: rolSat, zonaId, estado: "inactivo" });
      await sembrarUsuario(tx, "otrazona", {
        rolId: rolSat,
        zonaId: otraZonaId,
        estado: "activo",
      });
      await sembrarUsuario(tx, "otrorol", { rolId: rolMsg, zonaId, estado: "activo" });
      await sembrarUsuario(tx, "sinzona", { rolId: rolSat, zonaId: null, estado: "activo" });

      const repo = new UserRepository(tx as unknown as PrismaClient);
      const sinNadie = await repo.contarAdminSatelitesActivos(zonaId, evaluadoId);

      // Control positivo: con un segundo adminSatelite activo EN la zona, el mismo recuento
      // sube a 1. Sin este caso, un `count` que siempre devuelva 0 pasaria el test entero.
      const companeroId = await sembrarUsuario(tx, "compa", {
        rolId: rolSat,
        zonaId,
        estado: "activo",
      });
      const conCompanero = await repo.contarAdminSatelitesActivos(zonaId, evaluadoId);
      // Y visto desde el companero, el evaluado SI cuenta: la exclusion es del argumento, no de
      // una fila marcada.
      const desdeElCompanero = await repo.contarAdminSatelitesActivos(zonaId, companeroId);

      return { sinNadie, conCompanero, desdeElCompanero };
    });

    // ⭑ El numero que dispara el aviso: el evaluado es el ULTIMO, aunque haya cuatro filas mas
    //   que se le parecen.
    expect(r.sinNadie, "algo de lo excluido se colo en el recuento").toBe(0);
    expect(r.conCompanero).toBe(1);
    expect(r.desdeElCompanero).toBe(1);
  });

  it("R22: devuelve un numero, no filas ni ningun dato de persona", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const rolSat = await rolPorValor(tx, "adminSatelite");
      const zonaId = await sembrarZona(tx, "pii");
      const unoId = await sembrarUsuario(tx, "pii-a", {
        rolId: rolSat,
        zonaId,
        estado: "activo",
      });
      await sembrarUsuario(tx, "pii-b", { rolId: rolSat, zonaId, estado: "activo" });

      const repo = new UserRepository(tx as unknown as PrismaClient);
      return repo.contarAdminSatelitesActivos(zonaId, unoId);
    });

    expect(typeof r).toBe("number");
    expect(r).toBe(1);
  });
});
