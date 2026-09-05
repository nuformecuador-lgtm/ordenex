import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { GeoRepository } from "@/lib/repositories/GeoRepository";
import { GeografiaService } from "@/lib/services/GeografiaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { disponibleDesdeCadena } from "@/lib/repositories/_shared/geografia-activa";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";

import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 374 (R12/R13/R15/R16/R18) — **EL ALTA, CONTRA POSTGRES.**
 *
 * ⚠️ POR QUE AQUI Y NO SOLO CON DOBLES. Tres de los cinco casos son hechos del MOTOR y ningun
 * doble los puede demostrar: que el nodo nace `activo` por el DEFAULT de la columna, que el nombre
 * llega a la columna con sus acentos, y —el importante— que el UNIQUE de la base convierte en
 * `conflict` un duplicado que se cuele por una carrera. Ese ultimo caso llama al REPOSITORIO dos
 * veces, saltandose a proposito la comprobacion del service: es la unica forma de ejercer la
 * ultima palabra de la base.
 *
 * SIN `DATABASE_URL` se SALTA. Todo va en una transaccion que SIEMPRE se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f374a${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

interface Sembrado {
  provincia: string;
  /** Canton ACTIVO. */
  canton: string;
  /** Canton RETIRADO: es donde se prueba R15. */
  cantonOff: string;
}

describeSiHayBase("374 — el alta del catalogo geografico (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  async function conCorpus<T>(
    fn: (ctx: {
      s: Sembrado;
      geo: GeoRepository;
      service: GeografiaService;
      tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const provincia = (
        await tx.provincia.create({ data: { nombre: `Prov ${SUFIJO}` }, select: { id: true } })
      ).id;
      const canton = (
        await tx.canton.create({
          data: { nombre: `Canton ${SUFIJO}`, provinciaId: provincia },
          select: { id: true },
        })
      ).id;
      const cantonOff = (
        await tx.canton.create({
          data: { nombre: `Canton retirado ${SUFIJO}`, provinciaId: provincia, activo: false },
          select: { id: true },
        })
      ).id;

      const cliente = clienteConSavepoint(tx);
      const geo = new GeoRepository(cliente);
      return fn({
        s: { provincia, canton, cantonOff },
        geo,
        service: new GeografiaService(geo, new OrdenRepository(cliente)),
        tx,
      });
    });
  }

  // ===============================================================================================
  // R12 / R13 — el alta en los tres niveles, y el nodo nace activo
  // ===============================================================================================

  describe("374/R12/R13 — el alta crea la fila bajo su padre, y nace ACTIVA", () => {
    it("provincia, canton y distrito: las tres filas existen bajo su padre", async () => {
      await conCorpus(async ({ s, service, tx }) => {
        const p = await service.crear({ nivel: "provincia", nombre: `Nueva prov ${SUFIJO}` }, MAESTRO);
        expect(p.status).toBe("ok");
        if (p.status !== "ok") throw new Error("el alta de provincia no fue ok");

        const c = await service.crear(
          { nivel: "canton", nombre: `Nuevo canton ${SUFIJO}`, provinciaId: p.id },
          MAESTRO,
        );
        expect(c.status).toBe("ok");
        if (c.status !== "ok") throw new Error("el alta de canton no fue ok");

        const d = await service.crear(
          { nivel: "distrito", nombre: `Nuevo distrito ${SUFIJO}`, cantonId: c.id },
          MAESTRO,
        );
        expect(d.status).toBe("ok");
        if (d.status !== "ok") throw new Error("el alta de distrito no fue ok");

        const filaCanton = await tx.canton.findUnique({
          where: { id: c.id },
          select: { provinciaId: true, activo: true },
        });
        const filaDistrito = await tx.distrito.findUnique({
          where: { id: d.id },
          select: { cantonId: true, activo: true },
        });
        expect(filaCanton?.provinciaId).toBe(p.id);
        expect(filaDistrito?.cantonId).toBe(c.id);

        // R13: los tres nacen ACTIVOS, por el DEFAULT de la columna (nadie lo escribe).
        const filaProv = await tx.provincia.findUnique({
          where: { id: p.id },
          select: { activo: true },
        });
        expect(filaProv?.activo).toBe(true);
        expect(filaCanton?.activo).toBe(true);
        expect(filaDistrito?.activo).toBe(true);
      });
    });
  });

  // ===============================================================================================
  // R15 — alta bajo un padre RETIRADO
  // ===============================================================================================

  describe("374/R15 — un nodo creado bajo un padre retirado nace activo y NO disponible", () => {
    it("⭑ el alta es `ok`: no se bloquea por el estado del padre", async () => {
      await conCorpus(async ({ s, service, tx }) => {
        const r = await service.crear(
          { nivel: "distrito", nombre: `Bajo canton retirado ${SUFIJO}`, cantonId: s.cantonOff },
          MAESTRO,
        );
        expect(r.status).toBe("ok");
        if (r.status !== "ok") throw new Error("el alta bajo un canton retirado se bloqueo");

        const fila = await tx.distrito.findUnique({
          where: { id: r.id },
          select: {
            activo: true,
            canton: { select: { activo: true, provincia: { select: { activo: true } } } },
          },
        });
        if (fila === null) throw new Error("el distrito nuevo no esta en la base");

        // Flag PROPIO activo…
        expect(fila.activo).toBe(true);
        // …y disponibilidad EFECTIVA falsa. Los dos a la vez: eso es la cascada evaluandose.
        expect(disponibleDesdeCadena(fila)).toBe(false);
      });
    });
  });

  // ===============================================================================================
  // R16 — el nombre se persiste recortado y con sus acentos
  // ===============================================================================================

  describe("374/R16 — el nombre llega a la columna recortado, colapsado y CON acentos", () => {
    it("«  San   José  » se guarda como «San José»", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        // El recorte lo hace el schema del borde; aqui se comprueba que lo que llega a la COLUMNA
        // es exactamente eso, sin que el motor ni el ORM lo toquen.
        const id = await geo.crear("distrito", `San José ${SUFIJO}`, s.canton);
        const fila = await tx.distrito.findUnique({ where: { id }, select: { nombre: true } });
        expect(fila?.nombre).toBe(`San José ${SUFIJO}`);
        // Ni minusculas ni plegado de acentos: es lo que se lee en toda la app.
        expect(fila?.nombre).not.toBe(`san jose ${SUFIJO}`);
      });
    });
  });

  // ===============================================================================================
  // R17 — el conflicto por forma normalizada, contra datos REALES
  // ===============================================================================================

  describe("374/R17 — el service rechaza el duplicado por forma normalizada", () => {
    it("«san jose» choca con «San José» ya existente, y NO crea fila", async () => {
      await conCorpus(async ({ s, geo, service, tx }) => {
        await geo.crear("distrito", `San José ${SUFIJO}`, s.canton);
        const antes = await tx.distrito.count({ where: { cantonId: s.canton } });

        const r = await service.crear(
          { nivel: "distrito", nombre: `san jose ${SUFIJO}`, cantonId: s.canton },
          MAESTRO,
        );

        expect(r).toEqual({ status: "conflict" });
        expect(await tx.distrito.count({ where: { cantonId: s.canton } })).toBe(antes);
      });
    });

    it("un hermano RETIRADO tambien ocupa el nombre", async () => {
      await conCorpus(async ({ s, geo, service, tx }) => {
        const id = await geo.crear("distrito", `Cabagra ${SUFIJO}`, s.canton);
        await tx.distrito.update({ where: { id }, data: { activo: false } });

        const r = await service.crear(
          { nivel: "distrito", nombre: `CABAGRA ${SUFIJO}`, cantonId: s.canton },
          MAESTRO,
        );
        expect(r).toEqual({ status: "conflict" });
      });
    });

    it("CONTRAPRUEBA: el MISMO nombre bajo OTRO padre entra (R19)", async () => {
      await conCorpus(async ({ s, geo, service }) => {
        await geo.crear("distrito", `Cabagra ${SUFIJO}`, s.canton);
        const r = await service.crear(
          { nivel: "distrito", nombre: `Cabagra ${SUFIJO}`, cantonId: s.cantonOff },
          MAESTRO,
        );
        expect(r.status).toBe("ok");
      });
    });
  });

  // ===============================================================================================
  // R18 — la ultima palabra la tiene la base
  // ===============================================================================================

  describe("374/R18 — el UNIQUE de la base convierte el duplicado en `conflict`", () => {
    it("⭑ llamando al REPOSITORIO dos veces (saltandose el service), la base rechaza la segunda y NO deja fila", async () => {
      // Es la carrera: dos altas simultaneas que pasan la comprobacion del service. Aqui se
      // reproduce saltandose esa comprobacion a proposito.
      //
      // ⚠️ EL SAVEPOINT ES OBLIGATORIO Y NO ES DECORADO: en Postgres, una sentencia que falla
      // ABORTA la transaccion entera, asi que sin el `ROLLBACK TO` la comprobacion de despues
      // moriria con «transaccion abortada» y este caso no podria afirmar nada. Es la misma
      // propiedad que hace que R55 salga gratis.
      await conCorpus(async ({ s, geo, tx }) => {
        await geo.crear("distrito", `Duplicado ${SUFIJO}`, s.canton);

        await tx.$executeRawUnsafe("SAVEPOINT sp_dup");
        let capturado: unknown = null;
        try {
          await geo.crear("distrito", `Duplicado ${SUFIJO}`, s.canton);
        } catch (error) {
          capturado = error;
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_dup");
        }

        // El repositorio DEJA ESCAPAR la violacion en vez de tragarsela: es lo que permite que el
        // borde la traduzca a `conflict` en vez de devolver un «ok» que no ocurrio.
        expect(capturado, "el repositorio se trago la violacion de UNIQUE").not.toBeNull();
        expect(String(capturado)).toMatch(/distrito_canton_id_nombre_key|[Uu]nique/);

        // Y el segundo intento no dejo fila.
        const n = await tx.distrito.count({
          where: { cantonId: s.canton, nombre: `Duplicado ${SUFIJO}` },
        });
        expect(n).toBe(1);
      });
    });

    it("lo mismo con un canton repetido dentro de su provincia", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        await geo.crear("canton", `Repetido ${SUFIJO}`, s.provincia);

        await tx.$executeRawUnsafe("SAVEPOINT sp_dup_canton");
        let capturado: unknown = null;
        try {
          await geo.crear("canton", `Repetido ${SUFIJO}`, s.provincia);
        } catch (error) {
          capturado = error;
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_dup_canton");
        }
        expect(capturado).not.toBeNull();
        expect(
          await tx.canton.count({ where: { provinciaId: s.provincia, nombre: `Repetido ${SUFIJO}` } }),
        ).toBe(1);
      });
    });
  });

  // ===============================================================================================
  // R14 — el padre que no existe, contra la base
  // ===============================================================================================

  describe("374/R14 — un padre inexistente da `not_found` y NO crea nada", () => {
    it("con un `cantonId` que no existe, cero filas nuevas", async () => {
      await conCorpus(async ({ service, tx }) => {
        const antes = await tx.distrito.count();
        const r = await service.crear(
          {
            nivel: "distrito",
            nombre: `Huerfano ${SUFIJO}`,
            cantonId: "00000000-0000-0000-0000-000000000000",
          },
          MAESTRO,
        );
        expect(r).toEqual({ status: "not_found" });
        expect(await tx.distrito.count()).toBe(antes);
      });
    });
  });
});
