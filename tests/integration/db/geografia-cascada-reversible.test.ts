import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { GeoRepository } from "@/lib/repositories/GeoRepository";

import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 374 — **LA CASCADA SE EVALUA Y NO SE MATERIALIZA: POR ESO REACTIVAR ES REVERSIBLE.**
 * Contra Postgres.
 *
 * ⚠️ QUE FALLO CONCRETO CIERRA ESTE ARCHIVO. La alternativa obvia a evaluar la cascada es
 * MATERIALIZARLA: un `updateMany` a los hijos al desactivar el padre. Compila, es mas simple de
 * leer y deja las lecturas con un `WHERE activo = true` plano. Y ROMPE R9 en silencio: al
 * reactivar el canton no hay forma de saber que distritos estaban ya inactivos POR SU CUENTA, asi
 * que la reactivacion enciende territorio que alguien retiro a proposito. Es una perdida de dato
 * que no rompe ningun test… salvo este.
 *
 * COMO SE MIDE. Un canton con TRES distritos, uno de ellos ya inactivo por su cuenta. Se leen los
 * flags fila a fila ANTES, se desactiva el canton, se leen DESPUES, se reactiva y se vuelven a
 * leer. Los tres conjuntos tienen que ser identicos.
 *
 * Y `zona_distrito` se fotografia al principio y al final: desactivar NO toca la puente (R50). La
 * zona se administra en Tarifas y se sigue administrando alli.
 *
 * SIN `DATABASE_URL` se SALTA. Todo va en una transaccion que SIEMPRE se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f374c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

interface Sembrado {
  provincia: string;
  canton: string;
  /** Los tres distritos del canton: `d1` y `d3` activos, `d2` inactivo POR SU CUENTA. */
  d1: string;
  d2: string;
  d3: string;
  zona: string;
}

describeSiHayBase("374 — la cascada es reversible (Postgres real)", () => {
  let prisma: PrismaClient;
  let actorUsuarioId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const usuario = await prisma.usuario.findFirst({ select: { id: true } });
    if (!usuario) {
      throw new Error(
        "hay DATABASE_URL pero `usuario` esta vacia: sin actor no se puede ejercer el registro de " +
          "acciones que acompaña al cambio de flag. Corre `pnpm run db:seed:maestro`.",
      );
    }
    actorUsuarioId = usuario.id;
  });

  async function conCorpus<T>(
    fn: (ctx: {
      s: Sembrado;
      geo: GeoRepository;
      tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
      flags: () => Promise<Record<string, boolean>>;
      filasPuente: () => Promise<string[]>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const zona = (
        await tx.zona.create({ data: { nombre: `Zona ${SUFIJO}` }, select: { id: true } })
      ).id;
      const provincia = (
        await tx.provincia.create({ data: { nombre: `Prov ${SUFIJO}` }, select: { id: true } })
      ).id;
      const canton = (
        await tx.canton.create({
          data: { nombre: `Canton ${SUFIJO}`, provinciaId: provincia },
          select: { id: true },
        })
      ).id;

      const crear = async (nombre: string, activo: boolean): Promise<string> => {
        const fila = await tx.distrito.create({
          data: { nombre: `${nombre} ${SUFIJO}`, cantonId: canton, activo },
          select: { id: true },
        });
        await tx.zonaDistrito.create({ data: { zonaId: zona, distritoId: fila.id } });
        return fila.id;
      };

      const d1 = await crear("D1", true);
      // ⚠️ EL DISTRITO QUE HACE QUE ESTE TEST SIRVA: ya estaba retirado POR SU CUENTA antes de que
      // nadie tocara el canton. Es el que una cascada materializada encenderia al reactivar.
      const d2 = await crear("D2", false);
      const d3 = await crear("D3", true);

      const flags = async (): Promise<Record<string, boolean>> => {
        const filas = await tx.distrito.findMany({
          where: { cantonId: canton },
          select: { id: true, activo: true },
          orderBy: { nombre: "asc" },
        });
        return Object.fromEntries(filas.map((f) => [f.id, f.activo]));
      };

      const filasPuente = async (): Promise<string[]> => {
        const filas = await tx.zonaDistrito.findMany({
          where: { distrito: { cantonId: canton } },
          select: { zonaId: true, distritoId: true },
        });
        return filas.map((f) => `${f.zonaId}::${f.distritoId}`).sort();
      };

      return fn({
        s: { provincia, canton, d1, d2, d3, zona },
        geo: new GeoRepository(clienteConSavepoint(tx)),
        tx,
        flags,
        filasPuente,
      });
    });
  }

  // ===============================================================================================
  // Anti-vacuidad
  // ===============================================================================================

  it("el corpus se sembro: 3 distritos, uno ya inactivo por su cuenta", async () => {
    await conCorpus(async ({ s, flags }) => {
      const previos = await flags();
      expect(Object.keys(previos)).toHaveLength(3);
      expect(previos[s.d1]).toBe(true);
      expect(previos[s.d2]).toBe(false);
      expect(previos[s.d3]).toBe(true);
    });
  });

  // ===============================================================================================
  // R8 — desactivar el padre NO toca a los hijos
  // ===============================================================================================

  describe("374/R8 — desactivar un canton deja los `activo` de sus distritos INTACTOS", () => {
    it("los tres flags son los mismos antes y despues, fila a fila", async () => {
      await conCorpus(async ({ s, geo, flags }) => {
        const antes = await flags();
        expect(await geo.cambiarActivacion("canton", s.canton, false, actorUsuarioId)).toBe(
          "cambiado",
        );
        const despues = await flags();
        expect(despues).toEqual(antes);
      });
    });

    it("el canton SI cambio: la escritura ocurrio de verdad", async () => {
      // Anti-vacuidad del caso anterior: si el `update` no hubiera hecho nada, «los hijos no
      // cambian» estaria verde por vacio.
      await conCorpus(async ({ s, geo, tx }) => {
        await geo.cambiarActivacion("canton", s.canton, false, actorUsuarioId);
        const fila = await tx.canton.findUnique({
          where: { id: s.canton },
          select: { activo: true },
        });
        expect(fila?.activo).toBe(false);
      });
    });

    it("desactivar la PROVINCIA tampoco toca a cantones ni a distritos", async () => {
      await conCorpus(async ({ s, geo, tx, flags }) => {
        const antesDistritos = await flags();
        const antesCanton = await tx.canton.findUnique({
          where: { id: s.canton },
          select: { activo: true },
        });

        await geo.cambiarActivacion("provincia", s.provincia, false, actorUsuarioId);

        expect(await flags()).toEqual(antesDistritos);
        expect(
          await tx.canton.findUnique({ where: { id: s.canton }, select: { activo: true } }),
        ).toEqual(antesCanton);
      });
    });
  });

  // ===============================================================================================
  // R9 — reactivar devuelve EXACTAMENTE los flags previos
  // ===============================================================================================

  describe("374/R9 — reactivar el canton devuelve los flags PREVIOS, distrito a distrito", () => {
    it("⭑ el distrito que ya estaba retirado POR SU CUENTA sigue retirado", async () => {
      await conCorpus(async ({ s, geo, flags }) => {
        const antes = await flags();

        await geo.cambiarActivacion("canton", s.canton, false, actorUsuarioId);
        await geo.cambiarActivacion("canton", s.canton, true, actorUsuarioId);

        const despues = await flags();
        expect(despues).toEqual(antes);
        // Dicho aparte porque ES la afirmacion: una cascada materializada lo habria ENCENDIDO.
        expect(despues[s.d2]).toBe(false);
        expect(despues[s.d1]).toBe(true);
        expect(despues[s.d3]).toBe(true);
      });
    });

    it("el canton vuelve a estar activo", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        await geo.cambiarActivacion("canton", s.canton, false, actorUsuarioId);
        await geo.cambiarActivacion("canton", s.canton, true, actorUsuarioId);
        const fila = await tx.canton.findUnique({
          where: { id: s.canton },
          select: { activo: true },
        });
        expect(fila?.activo).toBe(true);
      });
    });
  });

  // ===============================================================================================
  // R20 — los tres niveles, en las dos direcciones
  // ===============================================================================================

  describe("374/R20 — desactivar y reactivar funciona en los TRES niveles", () => {
    it("provincia, canton y distrito, ida y vuelta", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        const niveles = [
          ["provincia", s.provincia, () => tx.provincia.findUnique({ where: { id: s.provincia }, select: { activo: true } })],
          ["canton", s.canton, () => tx.canton.findUnique({ where: { id: s.canton }, select: { activo: true } })],
          ["distrito", s.d1, () => tx.distrito.findUnique({ where: { id: s.d1 }, select: { activo: true } })],
        ] as const;

        for (const [nivel, id, leer] of niveles) {
          expect(await geo.cambiarActivacion(nivel, id, false, actorUsuarioId)).toBe("cambiado");
          expect((await leer())?.activo, `${nivel} no se desactivo`).toBe(false);
          expect(await geo.cambiarActivacion(nivel, id, true, actorUsuarioId)).toBe("cambiado");
          expect((await leer())?.activo, `${nivel} no se reactivo`).toBe(true);
        }
      });
    });

    it("un id inexistente devuelve `no_existe` en los tres niveles, sin escribir", async () => {
      await conCorpus(async ({ geo, flags }) => {
        const antes = await flags();
        for (const nivel of ["provincia", "canton", "distrito"] as const) {
          expect(
            await geo.cambiarActivacion(nivel, "00000000-0000-0000-0000-000000000000", false, actorUsuarioId),
          ).toBe("no_existe");
        }
        expect(await flags()).toEqual(antes);
      });
    });
  });

  // ===============================================================================================
  // R50 — `zona_distrito` no se toca
  // ===============================================================================================

  describe("374/R50 — ni el alta ni la activacion escriben en `zona_distrito`", () => {
    it("tras un alta, una desactivacion y una reactivacion, la puente tiene las MISMAS filas", async () => {
      await conCorpus(async ({ s, geo, filasPuente }) => {
        const antes = await filasPuente();
        expect(antes).toHaveLength(3); // anti-vacuidad: la puente tiene datos

        await geo.crear("distrito", `D4 ${SUFIJO}`, s.canton);
        await geo.cambiarActivacion("canton", s.canton, false, actorUsuarioId);
        await geo.cambiarActivacion("canton", s.canton, true, actorUsuarioId);
        await geo.cambiarActivacion("distrito", s.d1, false, actorUsuarioId);

        expect(await filasPuente()).toEqual(antes);
      });
    });

    it("el alta creo el distrito de verdad: la comprobacion de arriba no esta vacia", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        const id = await geo.crear("distrito", `D5 ${SUFIJO}`, s.canton);
        const fila = await tx.distrito.findUnique({
          where: { id },
          select: { nombre: true, activo: true },
        });
        expect(fila?.nombre).toBe(`D5 ${SUFIJO}`);
        // El distrito nuevo nace SIN zona: la zona se administra en Tarifas (R50).
        expect(await tx.zonaDistrito.count({ where: { distritoId: id } })).toBe(0);
      });
    });
  });
});
