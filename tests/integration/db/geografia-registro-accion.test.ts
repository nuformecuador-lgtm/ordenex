import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { GeoRepository } from "@/lib/repositories/GeoRepository";

import {
  HAY_BASE_DE_DATOS,
  RegistroCaido,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 374 (R51–R55) — **EL RASTRO DE RETIRAR Y DEVOLVER UN NODO DEL CATALOGO GEOGRAFICO.**
 * Contra Postgres.
 *
 * POR QUE SE AUDITA. El precedente de vehiculos audita `vehiculo_borrado` y no `vehiculo_creado`;
 * lo que decide no es el nombre de la operacion sino su PAPEL: en esta pantalla, desactivar ocupa
 * el lugar que el borrado ocupa en las demas. Y la asimetria del coste lo cierra: auditar de mas
 * cuesta un `ALTER TYPE`; no auditar y necesitarlo despues es IRRECUPERABLE — el efecto de retirar
 * un distrito aparece semanas mas tarde, cuando las cargas de una tienda empiezan a rechazarse, y
 * sin la fila no hay nada que diga quien lo decidio.
 *
 * ⚠️ POR QUE CONTRA POSTGRES Y NO CON DOBLES. R55 —«si el registro falla, el flag no persiste»— es
 * una propiedad de la TRANSACCION, y un doble no revierte nada. Se usa `clienteConSavepoint`, que
 * abre un savepoint REAL y hace `ROLLBACK TO` al fallar, que es lo que Postgres hace con una
 * transaccion abortada. Con el paso-a-traves (`clienteConTransaccionAnidada`) este archivo pasaria
 * en verde por accidente.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f374r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Los nombres del corpus son los del ejemplo del spec: la etiqueta es un literal comprobable. */
const PROVINCIA = "Puntarenas";
const CANTON = "Buenos Aires";
const DISTRITO = "Cabagra";

interface Sembrado {
  provincia: string;
  canton: string;
  distrito: string;
}

interface FilaRegistro {
  accion: string;
  entidad_tipo: string;
  entidad_id: string;
  entidad_etiqueta: string;
  actor_usuario_id: string | null;
  actor_nombre: string | null;
  actor_rol: string | null;
  monto: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
}

describeSiHayBase("374 — el registro de acciones del catalogo geografico (Postgres real)", () => {
  let prisma: PrismaClient;
  let actorUsuarioId: string;
  let actorNombreEsperado: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const usuario = await prisma.usuario.findFirst({
      select: { id: true, nombre: true, primerApellido: true },
    });
    if (!usuario) {
      throw new Error(
        "hay DATABASE_URL pero `usuario` esta vacia: sin actor no se puede comprobar el congelado " +
          "de nombre y rol, que es la mitad de R54. Corre `pnpm run db:seed:maestro`.",
      );
    }
    actorUsuarioId = usuario.id;
    actorNombreEsperado = [usuario.nombre, usuario.primerApellido]
      .filter((p) => p != null && p !== "")
      .join(" ");
  });

  async function conCorpus<T>(
    fn: (ctx: {
      s: Sembrado;
      geo: GeoRepository;
      geoRoto: GeoRepository;
      tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
      registro: (entidadId: string) => Promise<FilaRegistro[]>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const provincia = (
        await tx.provincia.create({
          data: { nombre: `${PROVINCIA} ${SUFIJO}` },
          select: { id: true },
        })
      ).id;
      const canton = (
        await tx.canton.create({
          data: { nombre: `${CANTON} ${SUFIJO}`, provinciaId: provincia },
          select: { id: true },
        })
      ).id;
      const distrito = (
        await tx.distrito.create({
          data: { nombre: `${DISTRITO} ${SUFIJO}`, cantonId: canton },
          select: { id: true },
        })
      ).id;

      const registro = async (entidadId: string): Promise<FilaRegistro[]> =>
        tx.$queryRawUnsafe<FilaRegistro[]>(
          `SELECT "accion"::text AS accion, "entidad_tipo"::text AS entidad_tipo, "entidad_id",
                  "entidad_etiqueta", "actor_usuario_id", "actor_nombre", "actor_rol"::text AS actor_rol,
                  "monto"::text AS monto, "valor_anterior", "valor_nuevo"
             FROM "historial_accion"
            WHERE "entidad_id" = $1
            ORDER BY "created_at"`,
          entidadId,
        );

      return fn({
        s: { provincia, canton, distrito },
        geo: new GeoRepository(clienteConSavepoint(tx)),
        geoRoto: new GeoRepository(clienteConSavepoint(tx, true)),
        tx,
        registro,
      });
    });
  }

  // ===============================================================================================
  // R51 — desactivar escribe EXACTAMENTE UNA fila
  // ===============================================================================================

  describe("374/R51 — desactivar un distrito escribe EXACTAMENTE UNA fila", () => {
    it("una fila, con la accion y la entidad del nivel", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        expect(await geo.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId)).toBe(
          "cambiado",
        );
        const filas = await registro(s.distrito);
        expect(filas).toHaveLength(1);
        expect(filas[0].accion).toBe("nodo_geografico_desactivado");
        expect(filas[0].entidad_tipo).toBe("distrito");
        expect(filas[0].entidad_id).toBe(s.distrito);
      });
    });

    it("⭑ R54: la etiqueta es la CADENA de ascendientes", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        await geo.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId);
        const [fila] = await registro(s.distrito);
        // Literal (con el sufijo de la corrida): es lo que se lee en `/historico/acciones`.
        expect(fila.entidad_etiqueta).toBe(
          `${DISTRITO} ${SUFIJO} · ${CANTON} ${SUFIJO} · ${PROVINCIA} ${SUFIJO}`,
        );
      });
    });

    it("R54: el actor va CONGELADO y NO hay ni un dato de destinatario", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        await geo.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId);
        const [fila] = await registro(s.distrito);
        expect(fila.actor_usuario_id).toBe(actorUsuarioId);
        expect(fila.actor_nombre).toBe(actorNombreEsperado);
        expect(fila.actor_rol).not.toBeNull();
        // `valor_anterior`/`valor_nuevo` en NULL: el PAR de tipos ya dice la transicion.
        expect(fila.valor_anterior).toBeNull();
        expect(fila.valor_nuevo).toBeNull();
        expect(fila.monto).toBeNull();
      });
    });

    it("un canton y una provincia se registran en SU entidad, con SU cadena", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        await geo.cambiarActivacion("canton", s.canton, false, actorUsuarioId);
        const [filaCanton] = await registro(s.canton);
        expect(filaCanton.entidad_tipo).toBe("canton");
        expect(filaCanton.entidad_etiqueta).toBe(`${CANTON} ${SUFIJO} · ${PROVINCIA} ${SUFIJO}`);

        await geo.cambiarActivacion("provincia", s.provincia, false, actorUsuarioId);
        const [filaProv] = await registro(s.provincia);
        expect(filaProv.entidad_tipo).toBe("provincia");
        expect(filaProv.entidad_etiqueta).toBe(`${PROVINCIA} ${SUFIJO}`);
      });
    });
  });

  // ===============================================================================================
  // R52 — reactivar escribe la OTRA accion
  // ===============================================================================================

  describe("374/R52 — reactivar escribe `nodo_geografico_activado`, un valor DISTINTO", () => {
    it("las dos operaciones dejan dos filas, cada una con su tipo", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        await geo.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId);
        await geo.cambiarActivacion("distrito", s.distrito, true, actorUsuarioId);
        const filas = await registro(s.distrito);
        expect(filas).toHaveLength(2);
        expect(filas.map((f) => f.accion)).toEqual([
          "nodo_geografico_desactivado",
          "nodo_geografico_activado",
        ]);
        // Saber cual de las dos ocurrio NO depende de ningun campo adicional.
        expect(filas[0].accion).not.toBe(filas[1].accion);
        expect(filas.every((f) => f.valor_nuevo === null)).toBe(true);
      });
    });
  });

  // ===============================================================================================
  // R53 — lo que NO se registra
  // ===============================================================================================

  describe("374/R53 — el alta no deja rastro, y pedir lo ya hecho tampoco", () => {
    it("un alta NO escribe ninguna fila de registro", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        const id = await geo.crear("distrito", `Nuevo ${SUFIJO}`, s.canton);
        expect(await registro(id)).toEqual([]);
      });
    });

    it("⭑ pedir desactivar lo YA inactivo no escribe ni el `update` ni la fila", async () => {
      await conCorpus(async ({ s, geo, tx, registro }) => {
        await geo.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId);
        expect(await registro(s.distrito)).toHaveLength(1);

        // Segunda peticion, mismo estado.
        expect(await geo.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId)).toBe(
          "sin_cambio",
        );

        // Ni una fila mas, y la fila del distrito sigue igual.
        expect(await registro(s.distrito)).toHaveLength(1);
        const fila = await tx.distrito.findUnique({
          where: { id: s.distrito },
          select: { activo: true },
        });
        expect(fila?.activo).toBe(false);
      });
    });

    it("pedir activar lo ya activo tampoco escribe nada", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        expect(await geo.cambiarActivacion("distrito", s.distrito, true, actorUsuarioId)).toBe(
          "sin_cambio",
        );
        expect(await registro(s.distrito)).toEqual([]);
      });
    });

    it("un nodo INEXISTENTE no escribe fila ni cambia nada", async () => {
      await conCorpus(async ({ geo, registro }) => {
        const fantasma = "00000000-0000-0000-0000-000000000000";
        expect(await geo.cambiarActivacion("distrito", fantasma, false, actorUsuarioId)).toBe(
          "no_existe",
        );
        expect(await registro(fantasma)).toEqual([]);
      });
    });
  });

  // ===============================================================================================
  // R55 — si el registro falla, el flag NO persiste
  // ===============================================================================================

  describe("374/R55 — si `appendAccion` falla, el cambio del flag se deshace", () => {
    it("⭑ el flag sigue como estaba, y no queda fila de registro", async () => {
      await conCorpus(async ({ s, geo, geoRoto, tx, registro }) => {
        const antes = await tx.distrito.findUnique({
          where: { id: s.distrito },
          select: { activo: true },
        });
        expect(antes?.activo).toBe(true); // anti-vacuidad

        await expect(
          geoRoto.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId),
        ).rejects.toBeInstanceOf(RegistroCaido);

        const despues = await tx.distrito.findUnique({
          where: { id: s.distrito },
          select: { activo: true },
        });
        expect(despues?.activo, "el flag quedo cambiado con el registro caido").toBe(true);
        expect(await registro(s.distrito)).toEqual([]);

        // CONTRAPRUEBA: con el registro SANO, el mismo cambio SI persiste. Sin esto, lo de arriba
        // podria estar verde porque el camino nunca escribe.
        expect(await geo.cambiarActivacion("distrito", s.distrito, false, actorUsuarioId)).toBe(
          "cambiado",
        );
        const final = await tx.distrito.findUnique({
          where: { id: s.distrito },
          select: { activo: true },
        });
        expect(final?.activo).toBe(false);
        expect(await registro(s.distrito)).toHaveLength(1);
      });
    });
  });
});
