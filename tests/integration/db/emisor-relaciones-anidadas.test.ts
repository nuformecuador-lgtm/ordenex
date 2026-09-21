import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ConteosPublicosRepository } from "@/lib/repositories/ConteosPublicosRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";
import { crearPrismaContado, resumenDeLaSonda, type PrismaContado } from "./_consultas-en-vuelo";

/**
 * FICHA 450 — LA CAZA DEL EMISOR (T2), MEDIDA. PASOS 2, 4 Y 5 DEL ITINERARIO (design §3.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * QUE SE BUSCABA Y QUE SE ENCONTRO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Se buscaba un punto del arbol capaz de poner TRES o mas consultas en vuelo sobre una misma
 * conexion —que es lo que hace falta para que `pg` emita
 * `Calling client.query() when the client is already executing a query`, el aviso que produccion
 * lee en `/cierre-dia` y `/api/cron/corte-diario`—.
 *
 * Se encontro, y no es un `Promise.all`: es la EXPANSION DE RELACIONES de Prisma dentro de una
 * transaccion. Una lectura cuyo `select` anida N relaciones no se resuelve con un JOIN: Prisma
 * emite 1 + N consultas y lanza las N hermanas A LA VEZ. Sobre el cliente AGRUPADO cada una coge
 * su propia conexion del pool y no pasa nada; sobre un `tx`, que tiene UNA conexion, se apilan.
 *
 * El sitio: `lib/repositories/CierreDiaRepository.ts`, la lectura del snapshot con
 * `SNAPSHOT_SELECT` (5 relaciones anidadas: zona, tienda, provincia, canton, distrito) dentro del
 * `$transaction` de `crearCierre`. Y cuadra con donde el aviso se lee, porque `crearCierre` es el
 * UNICO punto por el que pasan las dos rutas observadas: `solicitarCierre` (`/cierre-dia`) y
 * `ejecutarCorte` (`/api/cron/corte-diario`). El aviso no nacia en el codigo de la ruta: nacia en
 * la transaccion que las dos comparten.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ESTE ARCHIVO MIDE EL ESTADO DE HOY, NO AFIRMA QUE ESTE BIEN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La secuenciacion del emisor (T2.7) no se aplico en esta tanda: las dos vias posibles chocan con
 * restricciones que la implementacion no puede levantar sola, y estan escritas con su coste en
 * `progress/impl_450.md`. Mientras tanto estas aserciones son una CARACTERIZACION: fijan el numero
 * medido para que el dia que alguien lo arregle —o el dia que Prisma cambie— el test se ponga rojo
 * y obligue a volver aqui. Lo que NO se hace es dejar el hallazgo escrito solo en una bitacora,
 * donde nadie vuelve a leerlo.
 *
 * ⚠️ EL AVISO ES DE UN SOLO DISPARO POR PROCESO (`util.deprecate`). Por eso este archivo es propio:
 * vitest aisla por archivo, asi que aqui la captura llega virgen.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** El `select` del snapshot, copiado de `CierreDiaRepository.ts` (`SNAPSHOT_SELECT`). */
const SNAPSHOT_SELECT = {
  ordenId: true,
  orden: {
    select: {
      montoCobrar: true,
      cobraComision: true,
      zonaId: true,
      tiendaId: true,
      numGuia: true,
      numRemision: true,
      destinatario: true,
      direccion: true,
      producto: true,
      zona: { select: { nombre: true, esCentral: true } },
      tienda: { select: { nombre: true } },
      provincia: { select: { nombre: true } },
      canton: { select: { nombre: true } },
      distrito: { select: { nombre: true, zonaEspecial: true } },
    },
  },
} as const;

describeSiHayBase("FICHA 450 · el emisor de la tercera consulta", () => {
  let contado: PrismaContado;
  let semilla: PrismaClient;
  let fks: Awaited<ReturnType<typeof fksDeOrden>>;
  let mensajeroId: string;

  beforeAll(async () => {
    contado = crearPrismaContado();
    await contado.prisma.$queryRawUnsafe("SELECT 1");
    semilla = crearPrismaDeTest();

    fks = await fksDeOrden(semilla);
    // ⚠️ LANZA, no `return`. Un `if (!fks) return;` reporta `passed` sin comprobar NADA, y este
    // repo ya se comio esa mentira una vez. Sin filas, la expansion de relaciones no ocurre
    // (Prisma no pide las relaciones de cero filas) y el caso central no mediria nada.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar la " +
          "gestion que este test necesita. Corre `pnpm run db:seed` (y `pnpm exec tsx " +
          "scripts/seed-zonas.ts`) antes de esta suite.",
      );
    }
    const mensajero = await semilla.usuario.findFirst({ select: { id: true } });
    if (mensajero === null) throw new Error("la tabla `usuario` esta vacia");
    mensajeroId = mensajero.id;

    contado.sonda.limpiar();
  });

  afterAll(async () => {
    await contado?.cerrar();
    await semilla?.$disconnect();
  });

  /**
   * Siembra UNA orden y UNA gestion vinculadas a un cierre ficticio, dentro de la transaccion que
   * el test revierte. Reusa las FKs de una fila existente: no crea catalogos ni toca nada que
   * sobreviva al rollback (la base local es compartida entre worktrees).
   */
  async function sembrarGestion(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ): Promise<string> {
    await serializarEscriturasReales(tx); // PRIMERA sentencia: evita el deadlock 40P01
    const orden = await tx.orden.create({
      data: {
        estatusId: fks!.estatusId,
        tiendaId: fks!.tiendaId,
        zonaId: fks!.zonaId,
        provinciaId: fks!.provinciaId,
        cantonId: fks!.cantonId,
        numRemision: `450-${randomUUID().slice(0, 8)}`,
        destinatario: "sonda 450",
        telefonoDest: "00000000",
        producto: "sonda 450",
      },
      select: { id: true },
    });
    const gestion = await tx.gestionOrden.create({
      data: { ordenId: orden.id, mensajeroId, resultado: "entregada" },
      select: { id: true },
    });
    return gestion.id;
  }

  describe("paso 2 del itinerario · `$transaction([…])` en forma de ARRAY", () => {
    it("`ConteosPublicosRepository.contar()` (3 consultas) no solapa: 1 en vuelo", async () => {
      contado.sonda.bloque = "paso2-conteos";
      contado.sonda.limpiar();

      const conteos = await new ConteosPublicosRepository(contado.prisma).contar();

      console.log(resumenDeLaSonda("paso 2 · conteos publicos (3 en array)", contado.sonda));

      // ANTI-VACIO: las tres cuentas salieron de verdad, en una sola conexion (BEGIN + 3 + COMMIT).
      expect(contado.sonda.cuantasConteniendo("COUNT(*)")).toBe(3);
      expect(contado.sonda.conexionesUsadas()).toBe(1);
      expect(typeof conteos.distritosConCobertura).toBe("number");

      // El sospechoso principal del design (§3.5, paso 2) NO reproduce: Prisma espera cada
      // consulta del array antes de mandar la siguiente.
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
    });

    it("dos renders de la landing a la vez reparten en dos conexiones, sin solape", async () => {
      contado.sonda.bloque = "paso2-dos-renders";
      contado.sonda.limpiar();

      const repo = new ConteosPublicosRepository(contado.prisma);
      await Promise.all([repo.contar(), repo.contar()]);

      console.log(resumenDeLaSonda("paso 2 · dos `contar()` concurrentes", contado.sonda));
      expect(contado.sonda.conexionesUsadas()).toBe(2);
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
    });
  });

  describe("pasos 4 y 5 · la expansion de relaciones, que SI reproduce", () => {
    it("el mismo `select` sobre el cliente AGRUPADO reparte entre conexiones y no solapa", async () => {
      contado.sonda.bloque = "paso4-pool";
      contado.sonda.limpiar();

      // Sin filas no hay expansion; por eso se mide con el dato sembrado en el caso de abajo y
      // aqui se usa el universo entero acotado a 1 fila, que si existe (lo garantiza `fksDeOrden`).
      const filas = await contado.prisma.gestionOrden.findMany({
        take: 1,
        select: SNAPSHOT_SELECT,
      });

      console.log(resumenDeLaSonda("paso 4 · snapshot sobre el POOL", contado.sonda));

      // ANTI-VACIO: hubo fila, luego hubo expansion de relaciones que medir.
      expect(filas).toHaveLength(1);
      expect(contado.sonda.consultas.length).toBeGreaterThanOrEqual(6);
      // Con `DB_POOL_MAX = 3`, las hermanas se reparten. Ninguna conexion tiene dos a la vez.
      expect(contado.sonda.conexionesUsadas()).toBeGreaterThan(1);
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
    });

    it("EL EMISOR: el mismo `select` DENTRO de una transaccion pone 5 consultas en vuelo y dispara el aviso", async () => {
      contado.sonda.bloque = "emisor";
      contado.sonda.limpiar();

      const filas = await enTransaccionRevertida(contado.prisma, async (tx) => {
        const gestionId = await sembrarGestion(tx);
        contado.sonda.limpiar(); // la siembra no es lo que se mide
        return tx.gestionOrden.findMany({ where: { id: gestionId }, select: SNAPSHOT_SELECT });
      });

      console.log(resumenDeLaSonda("EMISOR · snapshot dentro de la tx", contado.sonda));
      console.log(
        "[450] solapes:",
        contado.sonda.solapes
          .map((s) => `${s.enVuelo} en vuelo`)
          .join(", "),
      );

      // ANTI-VACIO: hubo fila, luego las 5 relaciones se pidieron de verdad.
      expect(filas).toHaveLength(1);
      expect(contado.sonda.conexionesUsadas()).toBe(1);

      // ═══ LO MEDIDO, Y ES EL HALLAZGO DE LA FICHA ═══
      // 1 consulta de `gestion_orden` + 1 de `orden` + 5 de relaciones hermanas, todas por la
      // MISMA conexion. Las 5 hermanas salen a la vez: 5 en vuelo.
      expect(contado.sonda.maximoEnVuelo()).toBe(5);
      expect(contado.sonda.solapes.length).toBeGreaterThanOrEqual(3);

      // Y con 3 o mas en vuelo, `pg` avisa. Esta es la advertencia que produccion lee, capturada
      // en un proceso limpio: la asercion que cierra la atribucion del entregable 2.
      expect(contado.sonda.avisos.length).toBe(1);
      expect(contado.sonda.avisos[0].bloque).toBe("emisor");
    });
  });
});
