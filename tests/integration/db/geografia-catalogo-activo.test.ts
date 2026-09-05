import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { GeoRepository } from "@/lib/repositories/GeoRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ConteosPublicosRepository } from "@/lib/repositories/ConteosPublicosRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 374 — **HAY UN CATALOGO, NO DOS: LAS LECTURAS PROYECTAN LA DISPONIBILIDAD, NO RECORTAN.**
 * Todo medido contra Postgres.
 *
 * ⚠️ POR QUE CONTRA POSTGRES Y NO CON DOBLES. Lo que esta ficha decide ES un `WHERE` —cual lo lleva
 * y cual no—, y en este repo esta medido cuatro veces que una mutacion del `WHERE` pasa en verde
 * con dobles: el doble responde lo mismo se filtre como se filtre.
 *
 * LAS DOS MITADES, y la primera es la que un arreglo mal hecho rompe:
 *
 *   1. `list*Lite`, el arbol y las dos lecturas geograficas de `OrdenRepository` DEVUELVEN los
 *      nodos retirados, con su disponibilidad al lado (R26/R28/R31). Ocultarlos dejaria
 *      INFILTRABLES las ordenes historicas de un distrito retirado: en geografia nadie teclea un
 *      uuid, asi que el desplegable es la UNICA via;
 *   2. los conteos publicos de la landing SI recortan (R34), porque son una promesa comercial.
 *
 * Y dos hechos mas del motor: un distrito ACTIVO bajo un canton INACTIVO existe, sale y se marca
 * como no disponible (R10); y la zona del arbol es la UTILIZABLE, con el colapso 1/0/>1 (R27).
 *
 * SIN `DATABASE_URL` se SALTA. CON base pero sin los catalogos que necesita, REVIENTA CON MENSAJE:
 * un `if (!x) return;` reporta `passed` sin haber comprobado nada.
 *
 * Todo corre dentro de una transaccion que SIEMPRE se revierte, y `serializarEscriturasReales` es
 * la primera sentencia porque se escribe en `public."provincia"`, `public."canton"`,
 * `public."distrito"` y `public."zona"`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: los nombres son UNIQUE por padre desde esta misma ficha. */
const SUFIJO = `f374${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

interface Sembrado {
  provinciaOk: string;
  provinciaOff: string;
  cantonOk: string;
  cantonOff: string;
  /** Activo bajo canton activo, con UNA zona: disponible y con zona utilizable. */
  distritoOk: string;
  /** INACTIVO por su cuenta, bajo canton activo. */
  distritoOff: string;
  /** ACTIVO bajo el canton INACTIVO: el estado de R10. */
  distritoHeredado: string;
  /** Activo, con CERO zonas. */
  distritoSinZona: string;
  /** Activo, con DOS zonas: ambiguo, NO tiene zona utilizable. */
  distritoDosZonas: string;
  /** Canton activo bajo la provincia INACTIVA. */
  cantonBajoProvinciaOff: string;
  zonaA: string;
  zonaB: string;
  zonaANombre: string;
}

interface Contexto {
  s: Sembrado;
  geo: GeoRepository;
  ordenes: OrdenRepository;
  conteos: ConteosPublicosRepository;
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
}

describeSiHayBase("374 — el catalogo geografico proyecta la disponibilidad (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  async function conCorpus<T>(fn: (ctx: Contexto) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const zonaANombre = `Zona A ${SUFIJO}`;
      const zonaA = (await tx.zona.create({ data: { nombre: zonaANombre }, select: { id: true } }))
        .id;
      const zonaB = (
        await tx.zona.create({ data: { nombre: `Zona B ${SUFIJO}` }, select: { id: true } })
      ).id;

      const provinciaOk = (
        await tx.provincia.create({ data: { nombre: `Prov OK ${SUFIJO}` }, select: { id: true } })
      ).id;
      const provinciaOff = (
        await tx.provincia.create({
          data: { nombre: `Prov OFF ${SUFIJO}`, activo: false },
          select: { id: true },
        })
      ).id;

      const cantonOk = (
        await tx.canton.create({
          data: { nombre: `Canton OK ${SUFIJO}`, provinciaId: provinciaOk },
          select: { id: true },
        })
      ).id;
      const cantonOff = (
        await tx.canton.create({
          data: { nombre: `Canton OFF ${SUFIJO}`, provinciaId: provinciaOk, activo: false },
          select: { id: true },
        })
      ).id;
      // Canton ACTIVO bajo la provincia INACTIVA: heredado en el segundo nivel.
      const cantonBajoProvinciaOff = (
        await tx.canton.create({
          data: { nombre: `Canton bajo prov off ${SUFIJO}`, provinciaId: provinciaOff },
          select: { id: true },
        })
      ).id;

      const crearDistrito = async (
        nombre: string,
        cantonId: string,
        activo: boolean,
        zonas: string[],
      ): Promise<string> => {
        const fila = await tx.distrito.create({
          data: { nombre: `${nombre} ${SUFIJO}`, cantonId, activo },
          select: { id: true },
        });
        for (const zonaId of zonas) {
          await tx.zonaDistrito.create({ data: { zonaId, distritoId: fila.id } });
        }
        return fila.id;
      };

      const distritoOk = await crearDistrito("Dist OK", cantonOk, true, [zonaA]);
      const distritoOff = await crearDistrito("Dist OFF", cantonOk, false, [zonaA]);
      const distritoHeredado = await crearDistrito("Dist heredado", cantonOff, true, [zonaA]);
      const distritoSinZona = await crearDistrito("Dist sin zona", cantonOk, true, []);
      const distritoDosZonas = await crearDistrito("Dist dos zonas", cantonOk, true, [
        zonaA,
        zonaB,
      ]);

      return fn({
        s: {
          provinciaOk,
          provinciaOff,
          cantonOk,
          cantonOff,
          cantonBajoProvinciaOff,
          distritoOk,
          distritoOff,
          distritoHeredado,
          distritoSinZona,
          distritoDosZonas,
          zonaA,
          zonaB,
          zonaANombre,
        },
        geo: new GeoRepository(tx as unknown as PrismaClient),
        ordenes: new OrdenRepository(tx as unknown as PrismaClient),
        conteos: new ConteosPublicosRepository({
          distrito: tx.distrito,
          orden: tx.orden,
          // `contar()` agrupa sus tres cuentas en una transaccion de solo lectura. Dentro de la tx
          // del test no se puede abrir otra, y no hace falta: el snapshot ya es el de esta tx.
          $transaction: (async (ops: Promise<number>[]) => Promise.all(ops)) as never,
        } as unknown as ConstructorParameters<typeof ConteosPublicosRepository>[0]),
        tx,
      });
    });
  }

  // ===============================================================================================
  // Anti-vacuidad: el corpus llego a la base
  // ===============================================================================================

  it("el corpus se sembro: 2 provincias, 3 cantones y 5 distritos de prueba", async () => {
    await conCorpus(async ({ s, tx }) => {
      const [fila] = await tx.$queryRawUnsafe<Array<{ p: number; c: number; d: number }>>(
        `SELECT (SELECT COUNT(*)::int FROM "provincia" WHERE "nombre" LIKE $1) AS p,
                (SELECT COUNT(*)::int FROM "canton"    WHERE "nombre" LIKE $1) AS c,
                (SELECT COUNT(*)::int FROM "distrito"  WHERE "nombre" LIKE $1) AS d`,
        `%${SUFIJO}`,
      );
      expect(fila).toEqual({ p: 2, c: 3, d: 5 });
      expect(s.distritoOk).not.toBe(s.distritoOff);
    });
  });

  // ===============================================================================================
  // R28 / R6 — `list*Lite` devuelve TODO, con `disponible` al lado
  // ===============================================================================================

  describe("374/R28 — las lecturas planas NO recortan: devuelven el nodo retirado", () => {
    it("`listProvinciasLite` trae la provincia retirada con `disponible: false`", async () => {
      await conCorpus(async ({ s, geo }) => {
        const filas = await geo.listProvinciasLite();
        const ok = filas.find((f) => f.id === s.provinciaOk);
        const off = filas.find((f) => f.id === s.provinciaOff);
        expect(ok, "la provincia activa no salio").toBeDefined();
        expect(off, "la provincia RETIRADA no salio: la lectura la esta recortando").toBeDefined();
        expect(ok?.disponible).toBe(true);
        expect(off?.disponible).toBe(false);
      });
    });

    it("`listCantonesLite` trae el canton retirado Y el heredado, los dos no disponibles", async () => {
      await conCorpus(async ({ s, geo }) => {
        const filas = await geo.listCantonesLite();
        const porId = new Map(filas.map((f) => [f.id, f]));
        expect(porId.get(s.cantonOk)?.disponible).toBe(true);
        // Flag propio en `false`.
        expect(porId.get(s.cantonOff), "el canton retirado no salio").toBeDefined();
        expect(porId.get(s.cantonOff)?.disponible).toBe(false);
        // Flag propio en `true`, pero su PROVINCIA esta retirada.
        expect(porId.get(s.cantonBajoProvinciaOff), "el canton heredado no salio").toBeDefined();
        expect(porId.get(s.cantonBajoProvinciaOff)?.disponible).toBe(false);
      });
    });

    it("`listDistritosLite` trae los cinco, con la disponibilidad EFECTIVA de cada uno", async () => {
      await conCorpus(async ({ s, geo }) => {
        const porId = new Map((await geo.listDistritosLite()).map((f) => [f.id, f]));
        expect(porId.get(s.distritoOk)?.disponible).toBe(true);
        expect(porId.get(s.distritoOff)?.disponible).toBe(false);
        // R10: activo bajo canton inactivo. Sale, y NO esta disponible.
        expect(porId.get(s.distritoHeredado), "el distrito heredado no salio").toBeDefined();
        expect(porId.get(s.distritoHeredado)?.disponible).toBe(false);
        expect(porId.get(s.distritoSinZona)?.disponible).toBe(true);
        expect(porId.get(s.distritoDosZonas)?.disponible).toBe(true);
      });
    });

    it("⭑ MUTACION VIGILADA: los tres `list*Lite` devuelven EXACTAMENTE lo que hay en la tabla", async () => {
      // Es el caso que se pone rojo si alguien mete `where: { activo: true }` en un `list*Lite`.
      // Se compara contra el conteo CRUDO de la tabla, no contra el propio metodo.
      await conCorpus(async ({ geo, tx }) => {
        const [crudo] = await tx.$queryRawUnsafe<Array<{ p: number; c: number; d: number }>>(
          `SELECT (SELECT COUNT(*)::int FROM "provincia") AS p,
                  (SELECT COUNT(*)::int FROM "canton")    AS c,
                  (SELECT COUNT(*)::int FROM "distrito")  AS d`,
        );
        expect((await geo.listProvinciasLite()).length).toBe(crudo.p);
        expect((await geo.listCantonesLite()).length).toBe(crudo.c);
        expect((await geo.listDistritosLite()).length).toBe(crudo.d);
        // Anti-vacuidad: la base tiene el catalogo del pais, no cuatro filas.
        expect(crudo.d).toBeGreaterThan(400);
      });
    });
  });

  describe("374/R6 — con todo el catalogo activo, se devuelve lo mismo que antes de la marca", () => {
    it("los ids de `list*Lite` son los de un `findMany` SIN `where`", async () => {
      await conCorpus(async ({ geo, tx }) => {
        const provincias = await tx.provincia.findMany({ select: { id: true } });
        const cantones = await tx.canton.findMany({ select: { id: true } });
        const distritos = await tx.distrito.findMany({ select: { id: true } });

        const ids = (filas: { id: string }[]) => filas.map((f) => f.id).sort();
        expect(ids(await geo.listProvinciasLite())).toEqual(ids(provincias));
        expect(ids(await geo.listCantonesLite())).toEqual(ids(cantones));
        expect(ids(await geo.listDistritosLite())).toEqual(ids(distritos));
      });
    });
  });

  // ===============================================================================================
  // R26 / R10 / R27 — el arbol
  // ===============================================================================================

  describe("374/R26 — el arbol trae TODOS los nodos, con el flag PROPIO de cada nivel", () => {
    it("la provincia retirada esta, y su `activo` es `false`", async () => {
      await conCorpus(async ({ s, geo }) => {
        const arbol = await geo.listArbol();
        const off = arbol.find((p) => p.id === s.provinciaOff);
        expect(off, "la provincia retirada no esta en el arbol: no habria como reactivarla").toBeDefined();
        expect(off?.activo).toBe(false);
      });
    });

    it("⭑ R10: el distrito ACTIVO bajo el canton INACTIVO esta, con su flag propio en `true`", async () => {
      await conCorpus(async ({ s, geo }) => {
        const arbol = await geo.listArbol();
        const prov = arbol.find((p) => p.id === s.provinciaOk);
        const canton = prov?.cantones.find((c) => c.id === s.cantonOff);
        const distrito = canton?.distritos.find((d) => d.id === s.distritoHeredado);

        expect(canton, "el canton retirado no esta en el arbol").toBeDefined();
        expect(distrito, "el distrito heredado no esta en el arbol").toBeDefined();
        // El estado que R10 declara REPRESENTABLE: el distrito esta bien; su canton se retiro.
        expect(canton?.activo).toBe(false);
        expect(distrito?.activo).toBe(true);
      });
    });

    it("NINGUNA consulta «corrige» el estado del distrito heredado en la base", async () => {
      // La cascada NO se materializa: si alguien metiera un `updateMany` de limpieza, el flag
      // propio del hijo cambiaria y esto se pondria rojo.
      await conCorpus(async ({ s, geo, tx }) => {
        await geo.listArbol();
        await geo.listDistritosLite();
        const fila = await tx.distrito.findUnique({
          where: { id: s.distritoHeredado },
          select: { activo: true },
        });
        expect(fila?.activo).toBe(true);
      });
    });
  });

  describe("374/R27 — la zona del arbol es la UTILIZABLE, con el colapso 1/0/>1", () => {
    it("con UNA zona, el distrito la muestra", async () => {
      await conCorpus(async ({ s, geo }) => {
        const arbol = await geo.listArbol();
        const d = arbol
          .find((p) => p.id === s.provinciaOk)
          ?.cantones.find((c) => c.id === s.cantonOk)
          ?.distritos.find((x) => x.id === s.distritoOk);
        expect(d?.zonaId).toBe(s.zonaA);
        expect(d?.zonaNombre).toBe(s.zonaANombre);
      });
    });

    it("con CERO zonas, `null`", async () => {
      await conCorpus(async ({ s, geo }) => {
        const arbol = await geo.listArbol();
        const d = arbol
          .find((p) => p.id === s.provinciaOk)
          ?.cantones.find((c) => c.id === s.cantonOk)
          ?.distritos.find((x) => x.id === s.distritoSinZona);
        expect(d, "el distrito sin zona no esta en el arbol").toBeDefined();
        expect(d?.zonaId).toBeNull();
        expect(d?.zonaNombre).toBeNull();
      });
    });

    it("⭑ con DOS zonas, `null` TAMBIEN: no devuelve la primera", async () => {
      // Es la mentira que la ficha corrige. Con `take: 1`, este distrito mostraba «(zona: X)»
      // aunque la carga masiva lo rechaza por ambiguo. La marca «sin zona» de la pantalla nueva
      // heredaria esa mentira.
      await conCorpus(async ({ s, geo, tx }) => {
        // Anti-vacuidad: el distrito tiene DE VERDAD dos filas en la puente.
        const filas = await tx.zonaDistrito.count({ where: { distritoId: s.distritoDosZonas } });
        expect(filas).toBe(2);

        const arbol = await geo.listArbol();
        const d = arbol
          .find((p) => p.id === s.provinciaOk)
          ?.cantones.find((c) => c.id === s.cantonOk)
          ?.distritos.find((x) => x.id === s.distritoDosZonas);
        expect(d, "el distrito de dos zonas no esta en el arbol").toBeDefined();
        expect(d?.zonaId).toBeNull();
        expect(d?.zonaNombre).toBeNull();
      });
    });
  });

  // ===============================================================================================
  // R31 — las dos lecturas de `OrdenRepository` PROYECTAN, no recortan
  // ===============================================================================================

  describe("374/R31 — `findDistritosByCantonIds` y `findDistritoParaCorreccion` no recortan", () => {
    it("`findDistritosByCantonIds` devuelve el distrito RETIRADO, con `disponible: false`", async () => {
      await conCorpus(async ({ s, ordenes }) => {
        const filas = await ordenes.findDistritosByCantonIds([s.cantonOk]);
        const porId = new Map(filas.map((f) => [f.id, f]));
        expect(porId.get(s.distritoOff), "el distrito retirado NO salio: hay un `where` de mas").toBeDefined();
        expect(porId.get(s.distritoOff)?.disponible).toBe(false);
        expect(porId.get(s.distritoOk)?.disponible).toBe(true);
      });
    });

    it("⭑ MUTACION VIGILADA: devuelve TODOS los distritos del canton, retirados incluidos", async () => {
      await conCorpus(async ({ s, ordenes, tx }) => {
        const crudo = await tx.distrito.count({ where: { cantonId: s.cantonOk } });
        const filas = await ordenes.findDistritosByCantonIds([s.cantonOk]);
        expect(filas).toHaveLength(crudo);
        expect(crudo).toBe(4); // OK, OFF, sin zona, dos zonas
      });
    });

    it("el distrito heredado (activo bajo canton inactivo) sale por su canton y NO esta disponible", async () => {
      await conCorpus(async ({ s, ordenes }) => {
        const filas = await ordenes.findDistritosByCantonIds([s.cantonOff]);
        expect(filas).toHaveLength(1);
        expect(filas[0].id).toBe(s.distritoHeredado);
        expect(filas[0].disponible).toBe(false);
      });
    });

    it("`findDistritoParaCorreccion` devuelve el retirado con su disponibilidad, no `null`", async () => {
      await conCorpus(async ({ s, ordenes }) => {
        const fila = await ordenes.findDistritoParaCorreccion(s.distritoOff);
        expect(fila, "un distrito retirado se devolvio como INEXISTENTE: son cosas distintas").not.toBeNull();
        expect(fila?.disponible).toBe(false);
        expect(fila?.cantonId).toBe(s.cantonOk);
        expect(fila?.provinciaId).toBe(s.provinciaOk);

        const vivo = await ordenes.findDistritoParaCorreccion(s.distritoOk);
        expect(vivo?.disponible).toBe(true);
      });
    });

    it("`findAllProvincias` y `findCantonesByProvinciaIds` proyectan igual", async () => {
      await conCorpus(async ({ s, ordenes }) => {
        const provincias = new Map((await ordenes.findAllProvincias()).map((f) => [f.id, f]));
        expect(provincias.get(s.provinciaOff), "la provincia retirada no salio").toBeDefined();
        expect(provincias.get(s.provinciaOff)?.disponible).toBe(false);
        expect(provincias.get(s.provinciaOk)?.disponible).toBe(true);

        const cantones = new Map(
          (await ordenes.findCantonesByProvinciaIds([s.provinciaOk, s.provinciaOff])).map((f) => [
            f.id,
            f,
          ]),
        );
        expect(cantones.get(s.cantonOff)?.disponible).toBe(false);
        expect(cantones.get(s.cantonBajoProvinciaOff)?.disponible).toBe(false);
        expect(cantones.get(s.cantonOk)?.disponible).toBe(true);
      });
    });
  });

  // ===============================================================================================
  // R34 — los conteos publicos SI recortan
  // ===============================================================================================

  describe("374/R34 — la landing solo cuenta distritos DISPONIBLES", () => {
    it("un distrito con zona deja de contar en cuanto se retira (con contraprueba ANTES)", async () => {
      await conCorpus(async ({ s, conteos, tx }) => {
        // CONTRAPRUEBA PRIMERO: con el distrito activo y con zona, cuenta.
        const antes = (await conteos.contar()).distritosConCobertura;
        expect(antes).toBeGreaterThan(0);

        await tx.distrito.update({ where: { id: s.distritoOk }, data: { activo: false } });
        const despues = (await conteos.contar()).distritosConCobertura;

        expect(despues).toBe(antes - 1);
      });
    });

    it("un distrito activo bajo un CANTON retirado tampoco cuenta", async () => {
      await conCorpus(async ({ s, conteos, tx }) => {
        // `distritoHeredado` tiene zona y flag propio `true`, pero su canton esta retirado: no
        // deberia estar contando desde el principio. Se comprueba reactivando el canton.
        const conCantonRetirado = (await conteos.contar()).distritosConCobertura;
        await tx.canton.update({ where: { id: s.cantonOff }, data: { activo: true } });
        const conCantonVivo = (await conteos.contar()).distritosConCobertura;
        expect(conCantonVivo).toBe(conCantonRetirado + 1);
      });
    });

    it("un distrito SIN zona no cuenta aunque este disponible: el `some` sigue ahi", async () => {
      // La condicion vieja no se perdio al añadir la nueva.
      await conCorpus(async ({ s, conteos, tx }) => {
        const antes = (await conteos.contar()).distritosConCobertura;
        await tx.distrito.update({ where: { id: s.distritoSinZona }, data: { activo: false } });
        expect((await conteos.contar()).distritosConCobertura).toBe(antes);
      });
    });
  });
});
