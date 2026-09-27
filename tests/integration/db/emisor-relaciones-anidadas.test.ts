import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ConteosPublicosRepository } from "@/lib/repositories/ConteosPublicosRepository";
import {
  SNAPSHOT_SELECT,
  leerDescriptivosDeOrdenes,
} from "@/lib/repositories/CierreDiaRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";
import { crearPrismaContado, resumenDeLaSonda, type PrismaContado } from "./_consultas-en-vuelo";

/**
 * FICHA 450 — EL EMISOR: COMO SE CAZO (T2) Y LA PRUEBA DE QUE SE ARREGLO (T2.7).
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
 * EL ANTES Y EL DESPUES, LOS DOS MEDIDOS AQUI
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El bloque «EL ANTES» conserva el `select` LITERAL que la ficha retiro —las cinco relaciones
 * hermanas, copiadas tal cual— y mide lo que hacia: **5 consultas en vuelo sobre una conexion, 4
 * solapes y el aviso de `pg`**. No se borra al arreglarlo: es la unica forma de que el numero
 * viejo siga siendo comprobable y de que se vea que el arreglo arreglo algo.
 *
 * El bloque «EL DESPUES» ejercita el **codigo REAL** —`SNAPSHOT_SELECT` y
 * `leerDescriptivosDeOrdenes`, importados de `CierreDiaRepository`, no copiados— y mide **1 en
 * vuelo, 0 solapes**. Se importan a proposito: una asercion contra una copia del codigo se queda
 * verde para siempre aunque el original cambie.
 *
 * Y el tercer bloque compara lo que los dos caminos CONGELAN. Es codigo de dinero: que la lectura
 * sea mas lenta o mas rapida da igual si los valores no son EXACTAMENTE los mismos.
 *
 * ⚠️ EL AVISO ES DE UN SOLO DISPARO POR PROCESO (`util.deprecate`). Por eso este archivo es propio:
 * vitest aisla por archivo, asi que aqui la captura llega virgen.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/**
 * El `select` del snapshot TAL Y COMO ERA ANTES de la ficha 450, copiado literalmente. Se
 * conserva —y se marca como historico— para poder seguir midiendo lo que hacia. El de HOY se
 * importa del repositorio, unas lineas mas arriba.
 */
const SNAPSHOT_SELECT_DE_ANTES = {
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
      data: { ordenId: orden.id, mensajeroId, resultado: "entregado" },
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

  describe("EL ANTES · pasos 4 y 5: la expansion de relaciones, que SI reproduce", () => {
    it("el mismo `select` sobre el cliente AGRUPADO reparte entre conexiones y no solapa", async () => {
      contado.sonda.bloque = "paso4-pool";
      contado.sonda.limpiar();

      // Sin filas no hay expansion; por eso se mide con el dato sembrado en el caso de abajo y
      // aqui se usa el universo entero acotado a 1 fila, que si existe (lo garantiza `fksDeOrden`).
      const filas = await contado.prisma.gestionOrden.findMany({
        take: 1,
        select: SNAPSHOT_SELECT_DE_ANTES,
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

    it("EL EMISOR (lo que HABIA): el select de antes, dentro de una tx, pone 5 en vuelo y dispara el aviso", async () => {
      contado.sonda.bloque = "emisor";
      contado.sonda.limpiar();

      const filas = await enTransaccionRevertida(contado.prisma, async (tx) => {
        const gestionId = await sembrarGestion(tx);
        contado.sonda.limpiar(); // la siembra no es lo que se mide
        return tx.gestionOrden.findMany({ where: { id: gestionId }, select: SNAPSHOT_SELECT_DE_ANTES });
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

  describe("EL DESPUES · el codigo REAL, importado del repositorio", () => {
    it("`SNAPSHOT_SELECT` + `leerDescriptivosDeOrdenes` ponen 1 consulta en vuelo, y ninguna se solapa", async () => {
      contado.sonda.bloque = "despues";
      contado.sonda.limpiar();

      const medido = await enTransaccionRevertida(contado.prisma, async (tx) => {
        const gestionId = await sembrarGestion(tx);
        contado.sonda.limpiar(); // la siembra no es lo que se mide
        const filas = await tx.gestionOrden.findMany({
          where: { id: gestionId },
          select: SNAPSHOT_SELECT,
        });
        const descriptivos = await leerDescriptivosDeOrdenes(filas, tx);
        return { filas, descriptivos };
      });

      console.log(resumenDeLaSonda("DESPUES · snapshot secuenciado dentro de la tx", contado.sonda));

      // ANTI-VACIO, y no es decorativo: si `filas` viniera vacio, `leerDescriptivosDeOrdenes`
      // pediria cinco `in` vacios y el contador seguiria diciendo 1 sin haber medido nada.
      expect(medido.filas).toHaveLength(1);
      expect(medido.descriptivos.zonas.size).toBe(1);
      expect(medido.descriptivos.tiendas.size).toBe(1);
      expect(medido.descriptivos.provincias.size).toBe(1);
      expect(medido.descriptivos.cantones.size).toBe(1);
      // Y las SEIS consultas salieron por la MISMA conexion: la de la transaccion.
      expect(contado.sonda.conexionesUsadas()).toBe(1);
      expect(contado.sonda.cuantasConteniendo("gestion_orden")).toBe(1);
      expect(contado.sonda.cuantasConteniendo("FROM \"public\".\"zona\"")).toBe(1);
      expect(contado.sonda.cuantasConteniendo("FROM \"public\".\"provincia\"")).toBe(1);

      // ═══ EL NUMERO QUE CAMBIA: 5 -> 1 ═══
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
    });

    it("R5/R7: los DOS caminos congelan EXACTAMENTE los mismos valores", async () => {
      // Es codigo de dinero: que la lectura sea mas lenta o mas rapida da igual si lo congelado
      // no es identico. Se lee la MISMA fila por los dos caminos, en la misma transaccion, y se
      // comparan los siete valores que `cierre_detail` guarda de la geografia y la tienda.
      contado.sonda.bloque = "equivalencia";

      const { viejo, nuevo } = await enTransaccionRevertida(contado.prisma, async (tx) => {
        const gestionId = await sembrarGestion(tx);

        const [antes] = await tx.gestionOrden.findMany({
          where: { id: gestionId },
          select: SNAPSHOT_SELECT_DE_ANTES,
        });
        const [fila] = await tx.gestionOrden.findMany({
          where: { id: gestionId },
          select: SNAPSHOT_SELECT,
        });
        const d = await leerDescriptivosDeOrdenes([fila], tx);

        return {
          viejo: {
            esCentral: antes.orden.zona.esCentral,
            zonaNombre: antes.orden.zona.nombre,
            tiendaNombre: antes.orden.tienda.nombre,
            provinciaNombre: antes.orden.provincia.nombre,
            cantonNombre: antes.orden.canton.nombre,
            distritoNombre: antes.orden.distrito?.nombre ?? null,
            esZonaEspecial: antes.orden.distrito?.zonaEspecial === true,
          },
          nuevo: {
            esCentral: d.zonas.get(fila.orden.zonaId)!.esCentral,
            zonaNombre: d.zonas.get(fila.orden.zonaId)!.nombre,
            tiendaNombre: d.tiendas.get(fila.orden.tiendaId)!.nombre,
            provinciaNombre: d.provincias.get(fila.orden.provinciaId)!.nombre,
            cantonNombre: d.cantones.get(fila.orden.cantonId)!.nombre,
            distritoNombre:
              fila.orden.distritoId === null
                ? null
                : d.distritos.get(fila.orden.distritoId)!.nombre,
            esZonaEspecial:
              (fila.orden.distritoId === null
                ? null
                : d.distritos.get(fila.orden.distritoId)!.zonaEspecial) === true,
          },
        };
      });

      // ANTI-VACIO: los nombres son de una fila real de la base, no cadenas vacias.
      expect(viejo.zonaNombre.length).toBeGreaterThan(0);
      expect(viejo.tiendaNombre.length).toBeGreaterThan(0);
      expect(nuevo).toEqual(viejo);
    });
  });
});
