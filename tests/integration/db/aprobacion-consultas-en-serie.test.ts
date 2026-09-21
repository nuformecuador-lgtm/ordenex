import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import type { WalletFeedTxClient } from "@/lib/interfaces/services/IWalletFeedService";
import type { WalletTiendaFeedTxClient } from "@/lib/interfaces/services/IWalletTiendaFeedService";

import { HAY_BASE_DE_DATOS, enTransaccionRevertida } from "./_postgres-real";
import {
  crearPrismaContado,
  resumenDeLaSonda,
  type PrismaContado,
} from "./_consultas-en-vuelo";

/**
 * FICHA 450 — R1 y R2, MEDIDOS CONTRA POSTGRES REAL.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST UNITARIO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Lo que se afirma aqui —«sobre la conexion de la transaccion de aprobacion no hay nunca dos
 * consultas a la vez»— es una propiedad de la CONEXION, y los dobles no tienen conexion. Los
 * `buildTx` de las dos suites unitarias de feed resuelven al instante: para ellos secuencial y
 * concurrente son indistinguibles, y por eso el defecto llevaba meses en verde.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * EL ORDEN DE LOS BLOQUES NO ES CASUAL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   0. CONTROL POSITIVO DE LA SONDA — dos consultas a la vez sobre UNA conexion sacada del pool
 *      a mano, sin Prisma de por medio. Tiene que dar 2. Si diera 1, el contador no cuenta y
 *      todo lo demas de este archivo seria un verde vacio (el modo de fallo del arnes que
 *      reporto 9/9 supervivientes sin ejecutar un test). Va PRIMERO a proposito: nada se mide
 *      con un instrumento que no se ha comprobado.
 *   1. R1 — la aprobacion: los dos feeds REALES con el `tx` REAL.
 *   2. R2 — control negativo: los puntos de concurrencia de `/cierre-dia` y
 *      `/api/cron/corte-diario`, que van sobre el cliente AGRUPADO (una conexion por consulta).
 *
 * ⚠️ ESTE `1` YA ERA `1` ANTES DEL ARREGLO, Y HAY QUE LEERLO SABIENDOLO. La medicion previa
 * (T1.1, 2026-09-21, sobre el arbol con el `Promise.all` todavia puesto) dio exactamente los
 * mismos numeros: 1 consulta simultanea, 0 solapes, 0 avisos. Prisma 7.8 serializa por su cuenta
 * las peticiones de una transaccion interactiva, asi que el patron que la ficha retira no llegaba
 * a la conexion como dos consultas a la vez. O sea que **este archivo NO es la prueba de que el
 * arreglo funcione**: es la prueba de que la conexion de la aprobacion esta limpia, y la linea
 * base contra la que se detectara el dia que Prisma deje de serializar (o el dia que `pg@9.0`
 * convierta el aviso en error). Quien busque el rojo→verde del arreglo lo tiene en los bloques
 * «FICHA 450/R3» de las dos suites de feed, que miden la FORMA con un doble vigilado.
 *
 * ⚠️ EL AVISO DE `pg` ES SECUNDARIO Y DE UN SOLO DISPARO. `util.deprecate` lo emite una vez por
 * PROCESO, y solo salta si la cola de la conexion YA tenia algo al encolar: hace falta una
 * TERCERA consulta (design §2.2). O sea que su ausencia NO prueba nada y su presencia solo
 * confirma. La asercion que decide es el contador.
 *
 * ⚠️ NO SE SIEMBRAN DATOS. Se mide el comportamiento de la conexion, y un `findMany` con un
 * `cierreId` inexistente emite exactamente la misma consulta. Ademas la base local es COMPARTIDA
 * entre worktrees: todo lo que aqui se ejecuta o es de solo lectura o va dentro de una
 * transaccion que se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Un cierre que no existe: basta para que las dos `SELECT` salgan igual. */
const CIERRE_INEXISTENTE = "00000000-0000-4000-8000-000000000450";

describeSiHayBase("FICHA 450 · una consulta a la vez sobre la conexion de la transaccion", () => {
  let contado: PrismaContado;

  beforeAll(async () => {
    contado = crearPrismaContado();
    // Calienta el adaptador: el pool se construye perezosamente en la primera consulta, y el
    // control positivo necesita pedirle una conexion.
    await contado.prisma.$queryRawUnsafe("SELECT 1");
    contado.sonda.limpiar();
  });

  afterAll(async () => {
    await contado?.cerrar();
  });

  describe("control positivo de la sonda (sin esto, lo demas no vale)", () => {
    it("cuenta 2 consultas en vuelo cuando de verdad las hay sobre la misma conexion", async () => {
      contado.sonda.bloque = "control-positivo";
      contado.sonda.limpiar();

      const conexion = await contado.conexionDirecta();
      try {
        // `pg_sleep` deja la primera en vuelo el tiempo suficiente para que la segunda entre.
        // Son DOS, no tres: con tres saltaria el aviso de `pg` y se gastaria el unico disparo
        // que tiene el proceso, dejando sin oportunidad a los bloques de R1/R2.
        await Promise.all([
          conexion.query("SELECT pg_sleep(0.05)"),
          conexion.query("SELECT 450 AS ficha"),
        ]);
      } finally {
        conexion.release();
      }

      console.log(resumenDeLaSonda("control positivo de la sonda", contado.sonda));
      expect(contado.sonda.maximoEnVuelo()).toBe(2);
      expect(contado.sonda.solapes.length).toBeGreaterThanOrEqual(1);
      expect(contado.sonda.cuantasConteniendo("pg_sleep")).toBe(1);
    });

    it("no marca solape cuando las mismas dos consultas salen en serie", async () => {
      contado.sonda.bloque = "control-positivo-negado";
      contado.sonda.limpiar();

      const conexion = await contado.conexionDirecta();
      try {
        await conexion.query("SELECT pg_sleep(0.05)");
        await conexion.query("SELECT 450 AS ficha");
      } finally {
        conexion.release();
      }

      console.log(resumenDeLaSonda("control positivo negado (en serie)", contado.sonda));
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
    });
  });

  describe("R1 · aprobacion del cierre: los dos feeds con el `tx` real", () => {
    it("el feed de INGRESO no pone dos consultas en vuelo sobre la conexion de la tx", async () => {
      contado.sonda.bloque = "R1-feed-ingreso";
      contado.sonda.limpiar();

      const movimientos = await enTransaccionRevertida(contado.prisma, async (tx) => {
        const feed = new WalletFeedService();
        return feed.construirMovimientosDeIngreso(
          CIERRE_INEXISTENTE,
          tx as unknown as WalletFeedTxClient,
        );
      });

      console.log(resumenDeLaSonda("R1 · feed de ingreso (42)", contado.sonda));

      // ANTI-VACIO: sin esto, un feed que no consultara nada saldria verde. Las DOS `SELECT`
      // tienen que haberse emitido de verdad, y por la MISMA conexion (la de la tx).
      expect(contado.sonda.cuantasConteniendo("cierre_detail")).toBe(1);
      expect(contado.sonda.cuantasConteniendo("gestion_orden")).toBe(1);
      const conexionDelDetalle = contado.sonda.consultas.find((c) =>
        c.sql.includes("cierre_detail"),
      )?.conexion;
      const conexionDeLasGestiones = contado.sonda.consultas.find((c) =>
        c.sql.includes("gestion_orden"),
      )?.conexion;
      expect(conexionDelDetalle).toBe(conexionDeLasGestiones);

      // R1: ni un solape sobre esa conexion.
      expect(contado.sonda.maximoEnVueloDeLaConexionDe("cierre_detail")).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
      // Sin gestiones no hay movimientos: el negocio ya lo cubren las suites unitarias (R5).
      expect(movimientos).toEqual([]);
    });

    it("el feed del LEDGER POR TIENDA tampoco", async () => {
      contado.sonda.bloque = "R1-feed-tienda";
      contado.sonda.limpiar();

      const movimientos = await enTransaccionRevertida(contado.prisma, async (tx) => {
        const feed = new WalletTiendaFeedService();
        return feed.construirMovimientosPorTienda(
          CIERRE_INEXISTENTE,
          tx as unknown as WalletTiendaFeedTxClient,
        );
      });

      console.log(resumenDeLaSonda("R1 · feed del ledger por tienda (43)", contado.sonda));

      expect(contado.sonda.cuantasConteniendo("cierre_detail")).toBe(1);
      expect(contado.sonda.cuantasConteniendo("gestion_orden")).toBe(1);
      expect(contado.sonda.maximoEnVueloDeLaConexionDe("cierre_detail")).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
      expect(movimientos).toEqual([]);
    });

    it("los DOS feeds seguidos en la MISMA tx, como en `resolverCierre`", async () => {
      contado.sonda.bloque = "R1-los-dos-feeds";
      contado.sonda.limpiar();

      const secuela = await enTransaccionRevertida(contado.prisma, async (tx) => {
        await new WalletFeedService().construirMovimientosDeIngreso(
          CIERRE_INEXISTENTE,
          tx as unknown as WalletFeedTxClient,
        );
        await new WalletTiendaFeedService().construirMovimientosPorTienda(
          CIERRE_INEXISTENTE,
          tx as unknown as WalletTiendaFeedTxClient,
        );
        // SONDA DE SECUELA (design §3.1.5): si la transaccion hubiera quedado abortada por una
        // consulta encolada sobre una tx muerta, esto reventaria con 25P02.
        const [{ viva }] = await tx.$queryRawUnsafe<{ viva: number }[]>("SELECT 450 AS viva");
        return viva;
      });

      console.log(resumenDeLaSonda("R1 · los dos feeds en la misma tx", contado.sonda));

      // 4 lecturas de los feeds + la sonda de secuela, TODAS por la misma conexion.
      expect(contado.sonda.cuantasConteniendo("cierre_detail")).toBe(2);
      expect(contado.sonda.cuantasConteniendo("gestion_orden")).toBe(2);
      expect(contado.sonda.conexionesUsadas()).toBe(1);
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
      expect(secuela).toBe(450);
    });

    it("no se emitio el aviso de `pg` en el camino de aprobacion", () => {
      // Asercion SECUNDARIA (design §2.2): con dos consultas la cola nunca llega a tener algo
      // al encolar, asi que la ausencia del aviso NO era la prueba del arreglo — el contador si.
      const deLaAprobacion = contado.sonda.avisos.filter((a) => a.bloque.startsWith("R1-"));
      console.log(
        `[450] avisos de pg atribuidos a la aprobacion: ${deLaAprobacion.length} ` +
          `(total del proceso: ${contado.sonda.avisos.length})`,
      );
      expect(deLaAprobacion).toEqual([]);
    });
  });

  describe("R2 · control negativo: los caminos donde el aviso se OBSERVA", () => {
    it("`CierreDiaRepository.findCierresByMensajeroPaginado` reparte sus 2 consultas en 2 conexiones", async () => {
      contado.sonda.bloque = "R2-cierre-dia";
      contado.sonda.limpiar();

      const repo = new CierreDiaRepository(
        contado.prisma,
        new TarifaVigenteRepository(contado.prisma),
      );
      // Un mensajero que no existe: las DOS consultas salen igual (no dependen de que haya
      // datos), que es justo por lo que el design eligio este metodo y no otro.
      const pagina = await repo.findCierresByMensajeroPaginado(CIERRE_INEXISTENTE, {
        skip: 0,
        take: 20,
      });

      console.log(resumenDeLaSonda("R2 · CierreDiaRepository:1226", contado.sonda));

      // ANTI-VACIO: las dos consultas del `Promise.all` de verdad salieron.
      expect(contado.sonda.consultas.length).toBeGreaterThanOrEqual(2);
      expect(contado.sonda.cuantasConteniendo("cierre_dia")).toBeGreaterThanOrEqual(2);
      // R2: van por el cliente AGRUPADO -> conexiones distintas -> ningun solape. Esto es lo
      // que separa «la ruta donde el mensaje se LEE» de «la ruta que lo PRODUCE».
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
      expect(pagina).toEqual({ items: [], total: 0 });
    });

    it("el trio de `findEstatusIdByValue` de `CorteDiarioService:164` tampoco solapa", async () => {
      contado.sonda.bloque = "R2-corte-diario";
      contado.sonda.limpiar();

      const repo = new OrdenRepository(contado.prisma);
      // Las TRES lecturas tal y como las lanza el corte diario (lectura pura del catalogo).
      const ids = await Promise.all([
        repo.findEstatusIdByValue("en_reparto"),
        repo.findEstatusIdByValue("ayuda_tienda"),
        repo.findEstatusIdByValue("sin_gestionar"),
      ]);

      console.log(resumenDeLaSonda("R2 · CorteDiarioService:164", contado.sonda));

      // ANTI-VACIO, Y UNA SORPRESA MEDIDA (2026-09-21): las TRES llamadas producen UNA sola
      // consulta. `findEstatusIdByValue` usa `findUnique`, y Prisma agrupa los `findUnique` que
      // caen en el mismo tick en un unico `SELECT … WHERE value IN (…)`. O sea que este punto de
      // concurrencia no llega siquiera a ser concurrencia: no hay dos consultas que repartir.
      // Se afirma el numero medido, no el esperado — si Prisma dejara de agrupar, esto se pone
      // rojo y hay que volver a medir.
      expect(contado.sonda.cuantasConteniendo("order_status")).toBe(1);
      expect(ids.length).toBe(3);
      expect(contado.sonda.maximoEnVuelo()).toBe(1);
      expect(contado.sonda.solapes).toEqual([]);
    });

    it("no se emitio el aviso de `pg` en los caminos observados", () => {
      const delControl = contado.sonda.avisos.filter((a) => a.bloque.startsWith("R2-"));
      console.log(
        `[450] avisos de pg atribuidos al control negativo: ${delControl.length} ` +
          `(total del proceso: ${contado.sonda.avisos.length})`,
      );
      expect(delControl).toEqual([]);
    });
  });
});
