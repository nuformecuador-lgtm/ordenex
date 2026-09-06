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
 * FICHA 375 — **RENOMBRAR UN NODO DEL CATALOGO GEOGRAFICO.** Contra Postgres.
 *
 * ⚠️ POR QUE CONTRA POSTGRES Y NO CON DOBLES, medido cuatro veces en este repo: lo que se afirma
 * aqui son propiedades del MOTOR y de la TRANSACCION —que el `update` toca `nombre` y NO
 * `codigo_dta`; que el UNIQUE por padre rechaza el homonimo literal; que si `appendAccion` falla el
 * nombre NO queda persistido—. Un doble no revierte nada y no tiene indices: este archivo pasaria
 * en verde con el `data` del `update` mutado.
 *
 * `clienteConSavepoint` abre un SAVEPOINT REAL (no un paso-a-traves), que es lo que hace honesto el
 * caso del registro caido.
 *
 * NADA de `if (!x) return;`: si el corpus no se puede sembrar, el test REVIENTA con mensaje. Un
 * test que se abstiene reporta `passed` sin haber comprobado nada.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f375r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const PROVINCIA = `Puntarenas ${SUFIJO}`;
const CANTON = `Buenos Aires ${SUFIJO}`;
const DISTRITO = `Cabagra ${SUFIJO}`;
const HERMANO = `Boruca ${SUFIJO}`;

/** Codigos de prueba: fuera del rango real de la DTA para no chocar con el catalogo sembrado. */
const CODIGO_PROVINCIA = `9${SUFIJO}`;
const CODIGO_CANTON = `98${SUFIJO}`;
const CODIGO_DISTRITO = `9801${SUFIJO}`;

interface Sembrado {
  provincia: string;
  canton: string;
  distrito: string;
  hermano: string;
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

describeSiHayBase("375 — renombrar un nodo del catalogo geografico (Postgres real)", () => {
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
          "de nombre y rol de la fila del registro. Corre `pnpm run db:seed:maestro`.",
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
          data: { nombre: PROVINCIA, codigoDta: CODIGO_PROVINCIA },
          select: { id: true },
        })
      ).id;
      const canton = (
        await tx.canton.create({
          data: { nombre: CANTON, provinciaId: provincia, codigoDta: CODIGO_CANTON },
          select: { id: true },
        })
      ).id;
      const distrito = (
        await tx.distrito.create({
          data: { nombre: DISTRITO, cantonId: canton, codigoDta: CODIGO_DISTRITO },
          select: { id: true },
        })
      ).id;
      const hermano = (
        await tx.distrito.create({
          data: { nombre: HERMANO, cantonId: canton },
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
        s: { provincia, canton, distrito, hermano },
        geo: new GeoRepository(clienteConSavepoint(tx)),
        geoRoto: new GeoRepository(clienteConSavepoint(tx, true)),
        tx,
        registro,
      });
    });
  }

  // ===============================================================================================
  // El renombrado escribe el nombre y NADA MAS
  // ===============================================================================================

  describe("375 — el `update` cambia `nombre` y NO toca la clave estable", () => {
    it("el nombre cambia; `codigo_dta`, `activo` y `canton_id` quedan intactos", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        const antes = await tx.distrito.findUniqueOrThrow({
          where: { id: s.distrito },
          select: { nombre: true, codigoDta: true, activo: true, cantonId: true },
        });

        expect(await geo.renombrar("distrito", s.distrito, `Cabagrita ${SUFIJO}`, actorUsuarioId)).toBe(
          "renombrado",
        );

        const despues = await tx.distrito.findUniqueOrThrow({
          where: { id: s.distrito },
          select: { nombre: true, codigoDta: true, activo: true, cantonId: true },
        });
        expect(despues.nombre).toBe(`Cabagrita ${SUFIJO}`);
        expect(despues.nombre).not.toBe(antes.nombre);
        // ⭑ LO QUE SOSTIENE LA FICHA ENTERA: la identidad no se mueve al cambiar la etiqueta.
        expect(despues.codigoDta).toBe(CODIGO_DISTRITO);
        expect(despues.activo).toBe(antes.activo);
        expect(despues.cantonId).toBe(antes.cantonId);
      });
    });

    it("NO toca a ningun hermano", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        await geo.renombrar("distrito", s.distrito, `Cabagrita ${SUFIJO}`, actorUsuarioId);
        const hermano = await tx.distrito.findUniqueOrThrow({
          where: { id: s.hermano },
          select: { nombre: true },
        });
        expect(hermano.nombre).toBe(HERMANO);
      });
    });

    it("funciona igual en canton y en provincia, cada uno con su codigo intacto", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        expect(await geo.renombrar("canton", s.canton, `Osa ${SUFIJO}`, actorUsuarioId)).toBe(
          "renombrado",
        );
        expect(await geo.renombrar("provincia", s.provincia, `Guanacaste ${SUFIJO}`, actorUsuarioId)).toBe(
          "renombrado",
        );

        const canton = await tx.canton.findUniqueOrThrow({
          where: { id: s.canton },
          select: { nombre: true, codigoDta: true },
        });
        const provincia = await tx.provincia.findUniqueOrThrow({
          where: { id: s.provincia },
          select: { nombre: true, codigoDta: true },
        });
        expect(canton.nombre).toBe(`Osa ${SUFIJO}`);
        expect(canton.codigoDta).toBe(CODIGO_CANTON);
        expect(provincia.nombre).toBe(`Guanacaste ${SUFIJO}`);
        expect(provincia.codigoDta).toBe(CODIGO_PROVINCIA);
      });
    });
  });

  // ===============================================================================================
  // Guardar sin cambios sigue funcionando
  // ===============================================================================================

  describe("375 — renombrar a SU PROPIO nombre es `sin_cambio` y no escribe nada", () => {
    it("devuelve `sin_cambio`, no toca la fila y no deja fila de registro", async () => {
      await conCorpus(async ({ s, geo, tx, registro }) => {
        expect(await geo.renombrar("distrito", s.distrito, DISTRITO, actorUsuarioId)).toBe(
          "sin_cambio",
        );
        const fila = await tx.distrito.findUniqueOrThrow({
          where: { id: s.distrito },
          select: { nombre: true },
        });
        expect(fila.nombre).toBe(DISTRITO);
        // «Se pidio» y «se hizo» son cosas distintas: sin cambio real, no hay que auditar.
        expect(await registro(s.distrito)).toEqual([]);
      });
    });

    it("un nodo INEXISTENTE devuelve `no_existe` y no escribe nada", async () => {
      await conCorpus(async ({ geo, registro }) => {
        const fantasma = "00000000-0000-0000-0000-000000000000";
        expect(await geo.renombrar("distrito", fantasma, `X ${SUFIJO}`, actorUsuarioId)).toBe(
          "no_existe",
        );
        expect(await registro(fantasma)).toEqual([]);
      });
    });
  });

  // ===============================================================================================
  // La auditoria: DENTRO de la transaccion, con los dos nombres
  // ===============================================================================================

  describe("375 — el renombrado deja EXACTAMENTE UNA fila con el nombre anterior y el nuevo", () => {
    it("una fila `nodo_geografico_renombrado` sobre la entidad del nivel", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        await geo.renombrar("distrito", s.distrito, `Cabagrita ${SUFIJO}`, actorUsuarioId);
        const filas = await registro(s.distrito);
        expect(filas).toHaveLength(1);
        expect(filas[0].accion).toBe("nodo_geografico_renombrado");
        expect(filas[0].entidad_tipo).toBe("distrito");
        expect(filas[0].entidad_id).toBe(s.distrito);
      });
    });

    it("⭑ `valor_anterior` y `valor_nuevo` llevan los DOS nombres", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        await geo.renombrar("distrito", s.distrito, `Cabagrita ${SUFIJO}`, actorUsuarioId);
        const [fila] = await registro(s.distrito);
        expect(fila.valor_anterior).toBe(DISTRITO);
        expect(fila.valor_nuevo).toBe(`Cabagrita ${SUFIJO}`);
        // Sin ellos la fila diria «renombro un distrito» sin decir de que a que, y no serviria.
        expect(fila.valor_anterior).not.toBe(fila.valor_nuevo);
      });
    });

    it("la etiqueta es la CADENA con el nombre NUEVO, y el actor va congelado", async () => {
      await conCorpus(async ({ s, geo, registro }) => {
        await geo.renombrar("distrito", s.distrito, `Cabagrita ${SUFIJO}`, actorUsuarioId);
        const [fila] = await registro(s.distrito);
        expect(fila.entidad_etiqueta).toBe(`Cabagrita ${SUFIJO} · ${CANTON} · ${PROVINCIA}`);
        expect(fila.actor_usuario_id).toBe(actorUsuarioId);
        expect(fila.actor_nombre).toBe(actorNombreEsperado);
        expect(fila.actor_rol).not.toBeNull();
        expect(fila.monto).toBeNull();
      });
    });

    it("⭑ si `appendAccion` FALLA, el nombre NO queda persistido", async () => {
      await conCorpus(async ({ s, geoRoto, tx }) => {
        await expect(
          geoRoto.renombrar("distrito", s.distrito, `Cabagrita ${SUFIJO}`, actorUsuarioId),
        ).rejects.toBeInstanceOf(RegistroCaido);

        const fila = await tx.distrito.findUniqueOrThrow({
          where: { id: s.distrito },
          select: { nombre: true },
        });
        expect(
          fila.nombre,
          "el `appendAccion` esta FUERA de la transaccion del `update`: un fallo del registro " +
            "deja el nombre cambiado y sin rastro de quien lo cambio",
        ).toBe(DISTRITO);
      });
    });
  });

  // ===============================================================================================
  // La base es la ultima palabra
  // ===============================================================================================

  describe("375 — el UNIQUE por padre rechaza el homonimo literal", () => {
    it("renombrar al nombre EXACTO de un hermano revienta con violacion de unicidad", async () => {
      await conCorpus(async ({ s, geo }) => {
        // El repositorio NO comprueba: deja escapar el error y el borde lo traduce a `conflict`.
        await expect(
          geo.renombrar("distrito", s.distrito, HERMANO, actorUsuarioId),
        ).rejects.toThrow();
      });
    });

    it("el mismo nombre bajo OTRO padre entra sin problema", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        const otroCanton = (
          await tx.canton.create({
            data: { nombre: `Osa ${SUFIJO}`, provinciaId: s.provincia },
            select: { id: true },
          })
        ).id;
        const ajeno = (
          await tx.distrito.create({
            data: { nombre: `Palmar ${SUFIJO}`, cantonId: otroCanton },
            select: { id: true },
          })
        ).id;
        // `Cabagra` y `Palmar` viven en cantones distintos: renombrar uno al otro es legal.
        expect(await geo.renombrar("distrito", ajeno, DISTRITO, actorUsuarioId)).toBe("renombrado");
      });
    });
  });

  // ===============================================================================================
  // `findHermanosDeNodo`: la consulta que alimenta la comprobacion del service
  // ===============================================================================================

  describe("375 — `findHermanosDeNodo` parte del NODO y devuelve el nodo dentro", () => {
    it("devuelve los hermanos del distrito, INCLUIDO el propio", async () => {
      await conCorpus(async ({ s, geo }) => {
        const hermanos = await geo.findHermanosDeNodo("distrito", s.distrito);
        expect(hermanos).not.toBeNull();
        const ids = hermanos!.map((h) => h.id).sort();
        expect(ids).toEqual([s.distrito, s.hermano].sort());
      });
    });

    it("trae tambien los INACTIVOS: un nombre ocupado por un retirado sigue ocupado", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        await tx.distrito.update({ where: { id: s.hermano }, data: { activo: false } });
        const hermanos = await geo.findHermanosDeNodo("distrito", s.distrito);
        expect(hermanos!.map((h) => h.id)).toContain(s.hermano);
      });
    });

    it("`null` cuando el nodo no existe, en los TRES niveles", async () => {
      await conCorpus(async ({ geo }) => {
        const fantasma = "00000000-0000-0000-0000-000000000000";
        expect(await geo.findHermanosDeNodo("distrito", fantasma)).toBeNull();
        expect(await geo.findHermanosDeNodo("canton", fantasma)).toBeNull();
        expect(await geo.findHermanosDeNodo("provincia", fantasma)).toBeNull();
      });
    });

    it("para un canton devuelve los cantones de SU provincia, no los de todas", async () => {
      await conCorpus(async ({ s, geo, tx }) => {
        const otraProvincia = (
          await tx.provincia.create({ data: { nombre: `Limon ${SUFIJO}` }, select: { id: true } })
        ).id;
        const cantonAjeno = (
          await tx.canton.create({
            data: { nombre: `Matina ${SUFIJO}`, provinciaId: otraProvincia },
            select: { id: true },
          })
        ).id;

        const hermanos = await geo.findHermanosDeNodo("canton", s.canton);
        expect(hermanos!.map((h) => h.id)).toContain(s.canton);
        expect(hermanos!.map((h) => h.id)).not.toContain(cantonAjeno);
      });
    });
  });
});
