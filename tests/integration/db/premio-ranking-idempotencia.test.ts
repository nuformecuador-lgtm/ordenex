import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, RolValue, type PrismaClient } from "@prisma/client";
import { CierreDelDiaRepository } from "@/lib/repositories/CierreDelDiaRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { CajaPremioRankingFeedService } from "@/lib/services/CajaPremioRankingFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { PremioRankingDevengoService } from "@/lib/services/PremioRankingDevengoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { PremioTx } from "@/lib/interfaces/services/IPremioRankingDevengoService";
import type { LiquidacionTx } from "@/lib/interfaces/services/ILiquidacionService";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 293 (T4.4, design §3.3/§3.4/§5) — LA GUARDA DE LA BASE Y EL CICLO COMPLETO, CONTRA
 * POSTGRES DE VERDAD.
 *
 * POR QUE [PG] Y NO DOBLES. Todo lo que se afirma aqui es de la forma «la BASE impide esto» o
 * «este numero sale de filas que existen»:
 *   - R17 es un indice unico PARCIAL y COMPUESTO
 *     (`(mensajero_id, premio_dia) WHERE categoria = 'premio_ranking'`): un doble en memoria lo
 *     emula con un `Set` y se queda verde aunque el predicado del indice real fuera otro.
 *   - R20 depende de que el unico de la CAJA sea `(origen_tipo, origen_id, categoria)` **sin
 *     mensajero**, que es un hecho del DDL y de ningun otro sitio.
 *   - R24/R27/R33 solo significan algo si el pendiente se deriva de filas reales.
 * En este repo ya se midio CUATRO veces que una mutacion de un `WHERE` sobrevive en verde por
 * arriba. Por eso las mediciones que deciden viven aqui.
 *
 * SIN BASE ALCANZABLE SE SALTA (`describe.skip`), NO pasa en verde: un `return` silencioso dentro
 * del caso se leeria como `passed` sin haber comprobado nada, y este repo ya se comio ese verde.
 * CON base pero SIN catalogo, falla RUIDOSAMENTE en el `beforeAll`.
 *
 * TODO SE SIEMBRA: usuarios, snapshot, filas del podio, cierre y gestiones. No se usa ni una fila
 * preexistente de datos (si el catalogo —rol, tipo de identificacion, zona, estatus— que las FK
 * exigen). Y todo ocurre dentro de una transaccion que SIEMPRE se revierte.
 *
 * LA TRANSACCION DEL SERVICIO SE MODELA CON SAVEPOINTS. El servicio abre su propia transaccion, y
 * dentro de la transaccion revertida del test eso no se puede anidar: un `SAVEPOINT` +
 * `ROLLBACK TO SAVEPOINT` da la MISMA atomicidad, con el motor de verdad. Sin eso, el caso «si la
 * caja falla no queda la fila del libro» no se podria medir.
 *
 * Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MAESTRO: Actor = { usuarioId: "", rol: RolValue.maestro }; // `usuarioId` se rellena al sembrar

/** Fecha calendario CR del podio, en la convencion `@db.Date` (medianoche UTC). */
const DIA = "2026-08-26";
const DIA_ANTERIOR = "2026-08-25";
const fechaComoDate = (f: string) => new Date(`${f}T00:00:00.000Z`);
/** Instante DENTRO de la ventana CR de ese dia: `[06:00Z, 06:00Z+24h)`. */
const dentroDelDia = (f: string) => new Date(`${f}T15:00:00.000Z`);
/** La MISMA ventana que usa el cron al congelar (`ventanaDelDia`), escrita aqui a proposito. */
const ventanaDe = (f: string) => ({
  desde: new Date(`${f}T06:00:00.000Z`),
  hasta: new Date(new Date(`${f}T06:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
});

describeSiHayBase("293/T4.4 — el premio del ranking, contra Postgres", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let catalogo: { tipoIdentificacionId: string; rolId: string };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se pueden sembrar las " +
          "gestiones que atan el dia al cierre. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    fks = encontradas;
    const u = await prisma.usuario.findFirst({ select: { tipoIdentificacionId: true, rolId: true } });
    if (u === null) throw new Error("hay DATABASE_URL pero no hay ningun usuario: falta el catalogo.");
    catalogo = u;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

  /**
   * El escenario COMPLETO, sembrado desde cero dentro de `tx`: dos usuarios (el mensajero y el
   * maestro que registra), el snapshot de un dia con sus tres filas de podio, un cierre APROBADO
   * y una gestion vigente de ese dia que lo ata al dia.
   */
  async function sembrar(
    tx: Tx,
    opciones: {
      /** Estado del cierre. `aprobado` salvo que el caso pida otra cosa (R12). */
      estadoCierre?: "aprobado" | "solicitado" | "rechazado" | "vencido";
      /** `P` del cierre (`total_pago_mensajero`, snapshot de la 39). */
      pagoMensajero?: string;
      /** `E` del cierre (`total_efectivo`, snapshot de la 37). */
      efectivo?: string;
      /** Dias de podio a congelar. Por defecto solo `DIA`. */
      dias?: string[];
      /** Si `true`, ademas siembra una gestion del dia ANTERIOR en el MISMO cierre (R19). */
      gestionDelDiaAnterior?: boolean;
      /**
       * Feature 297 — entregas CONGELADAS del primer puesto, que es la fila que casi todos los
       * casos registran. Por defecto 18 de 21: un premio registrable.
       *
       * Se pone en `0` para reproducir el 26/08 (Andres, 0 de 21, primero por orden alfabetico):
       * ese premio quedo congelado y desde la 297 el registro lo rechaza.
       */
      entregadasDelPrimero?: number;
    } = {},
  ) {
    await serializarEscriturasReales(tx);
    const sufijo = randomUUID();

    const crearUsuario = async (etiqueta: string) =>
      (
        await tx.usuario.create({
          data: {
            nombre: `293-${etiqueta}`,
            email: `293-${etiqueta}-${sufijo}@example.test`,
            telefono: "88880000",
            passwordHash: "x",
            cedula: `293-${etiqueta}-${sufijo}`,
            tipoIdentificacionId: catalogo.tipoIdentificacionId,
            rolId: catalogo.rolId,
          },
          select: { id: true },
        })
      ).id;

    const mensajeroId = await crearUsuario("mensajero");
    const maestroId = await crearUsuario("maestro");

    const cierre = await tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: opciones.estadoCierre ?? "aprobado",
        destinoTipo: "bodega_central",
        destinoZonaId: fks.zonaId,
        totalPagoMensajero: new Prisma.Decimal(opciones.pagoMensajero ?? "0.00"),
        totalEfectivo: new Prisma.Decimal(opciones.efectivo ?? "0.00"),
        solicitadoAt: new Date(`${DIA}T23:00:00.000Z`),
      },
      select: { id: true, totalPagoMensajero: true, totalEfectivo: true },
    });

    const crearGestionDelDia = async (dia: string) => {
      const orden = await tx.orden.create({
        data: {
          numRemision: `R-293-${sufijo}-${dia}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: fks.estatusId,
          tiendaId: fks.tiendaId,
          zonaId: fks.zonaId,
          provinciaId: fks.provinciaId,
          cantonId: fks.cantonId,
        },
        select: { id: true },
      });
      await tx.gestionOrden.create({
        data: {
          ordenId: orden.id,
          mensajeroId,
          resultado: "entregada",
          cierreId: cierre.id,
          createdAt: dentroDelDia(dia), // lo que ATA el dia al cierre (design §4.2)
        },
      });
    };

    await crearGestionDelDia(DIA);
    if (opciones.gestionDelDiaAnterior) await crearGestionDelDia(DIA_ANTERIOR);

    /** Congela un dia con TRES posiciones de podio: la 1 y la 3 con premio, la 2 sin el. */
    const congelar = async (dia: string) => {
      const snapshot = await tx.rankingSnapshotDia.create({
        data: { fecha: fechaComoDate(dia), minAsignadasPodio: 1, filas: 3 },
        select: { id: true },
      });
      const otros = [await crearUsuario(`podio2-${dia}`), await crearUsuario(`podio3-${dia}`)];
      const filas = await Promise.all(
        [
          { puesto: 1, posicion: 1, mensajeroId, premio: "5000.00", desc: "Bono por buen rendimiento" },
          { puesto: 2, posicion: 2, mensajeroId: otros[0]!, premio: null, desc: null },
          { puesto: 3, posicion: 3, mensajeroId: otros[1]!, premio: "2000.00", desc: "Tercer puesto" },
        ].map((f) =>
          tx.rankingSnapshotFila.create({
            data: {
              snapshotId: snapshot.id,
              puesto: f.puesto,
              posicion: f.posicion,
              mensajeroId: f.mensajeroId,
              mensajeroNombre: `Congelado ${f.puesto}`,
              // R5 / feature 297: el primer puesto es el que se registra, asi que por defecto
              // trae entregas (18 de 21). El `0 / 21` del 26/08 se pide explicitamente.
              entregadas: f.puesto === 1 ? (opciones.entregadasDelPrimero ?? 18) : 10,
              asignadas: 21,
              premioMonto: f.premio === null ? null : new Prisma.Decimal(f.premio),
              premioDescripcion: f.desc,
            },
            select: { id: true, mensajeroId: true, posicion: true },
          }),
        ),
      );
      return filas;
    };

    const podios: Record<string, Awaited<ReturnType<typeof congelar>>> = {};
    for (const dia of opciones.dias ?? [DIA]) podios[dia] = await congelar(dia);

    return { mensajeroId, maestroId, cierre, podios, actor: { usuarioId: maestroId, rol: MAESTRO.rol } };
  }

  /**
   * El servicio REAL con sus repositorios REALES atados a `tx`, y una transaccion modelada con
   * SAVEPOINT: misma atomicidad, mismo motor.
   */
  function servicioDelPremio(tx: Tx) {
    let n = 0;
    const cliente = tx as unknown as PrismaClient;
    return new PremioRankingDevengoService(
      new RankingSnapshotRepository(cliente),
      new CierreDelDiaRepository(cliente),
      new PagoMensajeroMovimientoRepository(cliente),
      new CajaPremioRankingFeedService(new WalletMovimientoRepository(cliente)),
      async (fn) => {
        const punto = `sp_premio_${(n += 1)}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
        try {
          const r = await fn(tx as unknown as PremioTx);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
          return r;
        } catch (e) {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
          throw e;
        }
      },
    );
  }

  /** Cuenta las filas del libro de un mensajero por categoria. */
  async function contarLibro(tx: Tx, mensajeroId: string) {
    const filas = await tx.pagoMensajeroMovimiento.findMany({
      where: { mensajeroId },
      select: { categoria: true, monto: true, tipo: true, origenTipo: true, origenId: true, premioDia: true },
    });
    return filas;
  }

  /** Cuenta las filas de CAJA con origen en las filas del podio sembradas. */
  async function cajaDelPremio(tx: Tx, filaIds: string[]) {
    return tx.walletMovimiento.findMany({
      where: { origenTipo: "ranking_snapshot_fila", origenId: { in: filaIds } },
      select: { tipo: true, categoria: true, monto: true, origenId: true },
      orderBy: [{ origenId: "asc" }, { categoria: "asc" }],
    });
  }

  // ── Caso 1 y 3 — R17/R18: la guarda de la base ─────────────────────────────────────────────

  it("R17/R18: registrar DOS VECES la misma fila deja UNA fila en el libro y UNA en la caja", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const servicio = servicioDelPremio(tx);
      const filaId = s.podios[DIA]![0]!.id;

      const primero = await servicio.registrarPremio({ filaId }, s.actor);
      const segundo = await servicio.registrarPremio({ filaId }, s.actor);

      return {
        primero,
        segundo,
        libro: await contarLibro(tx, s.mensajeroId),
        caja: await cajaDelPremio(tx, [filaId]),
      };
    });

    expect(medido.primero).toMatchObject({ status: "ok", monto: "5000.00" });
    // R18: «ya registrado», SIN error y SIN segunda fila.
    expect(medido.segundo).toEqual({ status: "ya_registrado" });
    expect(medido.libro).toHaveLength(1);
    expect(medido.libro[0]).toMatchObject({
      categoria: "premio_ranking",
      tipo: "devengo",
      origenTipo: "cierre_dia",
    });
    expect(medido.libro[0]!.monto.toFixed(2)).toBe("5000.00");
    expect(medido.caja).toHaveLength(1);
    expect(medido.caja[0]).toMatchObject({ tipo: "egreso", categoria: "egreso_pago_mensajero" });
  });

  // ── Caso 2 — R17: quien lo impide es LA BASE, no el servicio ───────────────────────────────

  it("R17: un segundo premio del mismo (mensajero, dia) por OTRA via lo rechaza LA BASE (23505)", async () => {
    // Se salta el servicio entero y se inserta a mano, con OTRO cierre y OTRA descripcion: lo
    // unico que coincide es `(mensajero_id, premio_dia)`. Si la guarda viviera en un `if` del
    // servicio, esta fila entraria.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const servicio = servicioDelPremio(tx);
      await servicio.registrarPremio({ filaId: s.podios[DIA]![0]!.id }, s.actor);

      const otroCierre = await tx.cierreDia.create({
        data: {
          mensajeroId: s.mensajeroId,
          estado: "aprobado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
        },
        select: { id: true },
      });

      await tx.$executeRawUnsafe("SAVEPOINT sp_directo");
      let rechazo: { sqlstate?: string; prisma?: string; mensaje: string } | null = null;
      try {
        await tx.pagoMensajeroMovimiento.create({
          data: {
            mensajeroId: s.mensajeroId,
            tipo: "devengo",
            categoria: "premio_ranking",
            monto: new Prisma.Decimal("1.00"),
            origenTipo: "cierre_dia",
            origenId: otroCierre.id,
            premioDia: fechaComoDate(DIA),
            descripcion: "por otra via",
          },
        });
      } catch (e) {
        const causa = (e as { cause?: { code?: string } }).cause;
        rechazo = {
          sqlstate: causa?.code,
          prisma: (e as { code?: string }).code,
          mensaje: e instanceof Error ? e.message : String(e),
        };
      }
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_directo");

      return { rechazo, libro: await contarLibro(tx, s.mensajeroId) };
    });

    expect(medido.rechazo).not.toBeNull();
    // MEDIDO: bajo el driver adapter de Prisma 7, la violacion de unicidad llega como `P2002` y
    // el SQLSTATE crudo NO se expone. El codigo es el LITERAL esperado, no «alguno de estos»: un
    // rechazo por otra causa —una FK, un CHECK— no valdria como evidencia de R17.
    expect(medido.rechazo?.prisma).toBe("P2002");
    expect(medido.libro).toHaveLength(1); // sigue habiendo UNA sola
  });

  // ── Caso 4 — R19: la unicidad es por (mensajero, dia), NUNCA por cierre ────────────────────

  it("R19: DOS dias de podio distintos imputados al MISMO cierre se registran los DOS", async () => {
    // Es la medicion que descarta la alternativa B de `design.md §11`: `cierre_dia` no tiene
    // ningun indice unico, asi que un cierre puede arrastrar dos dias de trabajo. Con la unicidad
    // apoyada en la clave de origen, el premio del segundo dia volveria como «ya registrado» —un
    // fallo mudo sobre dinero—.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx, { dias: [DIA, DIA_ANTERIOR], gestionDelDiaAnterior: true });
      const servicio = servicioDelPremio(tx);

      const hoy = await servicio.registrarPremio({ filaId: s.podios[DIA]![0]!.id }, s.actor);
      const ayer = await servicio.registrarPremio(
        { filaId: s.podios[DIA_ANTERIOR]![0]!.id },
        s.actor,
      );

      return { hoy, ayer, libro: await contarLibro(tx, s.mensajeroId), cierreId: s.cierre.id };
    });

    expect(medido.hoy).toMatchObject({ status: "ok", cierreId: medido.cierreId });
    expect(medido.ayer).toMatchObject({ status: "ok", cierreId: medido.cierreId });
    const premios = medido.libro.filter((f) => f.categoria === "premio_ranking");
    expect(premios).toHaveLength(2);
    // Los dos cuelgan del MISMO cierre y solo los distingue `premio_dia`.
    expect(new Set(premios.map((p) => p.origenId))).toEqual(new Set([medido.cierreId]));
    expect(
      premios.map((p) => (p.premioDia as Date).toISOString().slice(0, 10)).sort(),
    ).toEqual([DIA_ANTERIOR, DIA]);
  });

  // ── Caso 5 — R20: tres egresos distintos, y ninguno choca con el del feed ──────────────────

  it("R20: las posiciones con premio del mismo dia dan egresos DISTINTOS, sin chocar con el del cierre", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const servicio = servicioDelPremio(tx);
      const libroRepo = new PagoMensajeroMovimientoRepository(tx as unknown as PrismaClient);
      const cajaRepo = new WalletMovimientoRepository(tx as unknown as PrismaClient);

      // EL FEED DEL CIERRE, tal cual lo escribe la aprobacion: su egreso ocupa la clave
      // `(cierre_dia, cierreId, egreso_pago_mensajero)`. Es la clave que la alternativa C habria
      // reusado para el premio.
      await cajaRepo.crearMovimientos(tx as never, [
        {
          tipo: "egreso",
          categoria: "egreso_pago_mensajero",
          monto: "0.00",
          origenTipo: "cierre_dia",
          origenId: s.cierre.id,
        },
      ]);

      // Las DOS filas del podio con premio, cada una del mensajero que le toca. La del medio no
      // tiene premio y no se registra (R7).
      const conPremio = s.podios[DIA]!.filter((f) => f.posicion !== 2);
      // La posicion 3 es de OTRO mensajero: hay que atarle su propio cierre del dia.
      const otroMensajero = conPremio[1]!.mensajeroId;
      const cierreDelOtro = await tx.cierreDia.create({
        data: {
          mensajeroId: otroMensajero,
          estado: "aprobado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
        },
        select: { id: true },
      });
      const ordenOtro = await tx.orden.create({
        data: {
          numRemision: `R-293-otro-${randomUUID()}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: fks.estatusId,
          tiendaId: fks.tiendaId,
          zonaId: fks.zonaId,
          provinciaId: fks.provinciaId,
          cantonId: fks.cantonId,
        },
        select: { id: true },
      });
      await tx.gestionOrden.create({
        data: {
          ordenId: ordenOtro.id,
          mensajeroId: otroMensajero,
          resultado: "entregada",
          cierreId: cierreDelOtro.id,
          createdAt: dentroDelDia(DIA),
        },
      });

      const resultados = [];
      for (const fila of conPremio) {
        resultados.push(await servicio.registrarPremio({ filaId: fila.id }, s.actor));
      }
      void libroRepo;

      return {
        resultados,
        cajaDelPremio: await cajaDelPremio(tx, conPremio.map((f) => f.id)),
        cajaDelCierre: await tx.walletMovimiento.findMany({
          where: { origenTipo: "cierre_dia", origenId: s.cierre.id },
          select: { categoria: true, monto: true },
        }),
      };
    });

    expect(medido.resultados.map((r) => r.status)).toEqual(["ok", "ok"]);
    // DOS egresos distintos, uno por fila del podio: cada premio tiene su propia clave.
    expect(medido.cajaDelPremio).toHaveLength(2);
    expect(new Set(medido.cajaDelPremio.map((m) => m.origenId)).size).toBe(2);
    expect(medido.cajaDelPremio.map((m) => m.monto.toFixed(2)).sort()).toEqual([
      "2000.00",
      "5000.00",
    ]);
    // Y el egreso que el feed del cierre ya habia escrito sigue INTACTO y solo: el premio no lo
    // piso ni cayo en su `DO NOTHING` (alternativa C, descartada por medicion).
    expect(medido.cajaDelCierre).toHaveLength(1);
    expect(medido.cajaDelCierre[0]!.monto.toFixed(2)).toBe("0.00");
  });

  // ── Caso 6 — R20: si la caja falla, no queda la fila del libro ─────────────────────────────

  it("R20: si la escritura de la caja revienta, NO queda la fila del libro", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      let n = 0;
      const cliente = tx as unknown as PrismaClient;
      const servicio = new PremioRankingDevengoService(
        new RankingSnapshotRepository(cliente),
        new CierreDelDiaRepository(cliente),
        new PagoMensajeroMovimientoRepository(cliente),
        {
          // La caja falla DESPUES de que el devengo se haya escrito: es el unico momento en que
          // la atomicidad puede fallar de verdad.
          emitirEgresoPremio: async () => {
            throw new Error("boom: la caja dijo que no");
          },
          reversarEgresoPremio: async () => 1,
        },
        async (fn) => {
          const punto = `sp_boom_${(n += 1)}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
          try {
            const r = await fn(tx as unknown as PremioTx);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
            return r;
          } catch (e) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
            throw e;
          }
        },
      );

      let exploto = false;
      try {
        await servicio.registrarPremio({ filaId: s.podios[DIA]![0]!.id }, s.actor);
      } catch {
        exploto = true;
      }
      return {
        exploto,
        libro: await contarLibro(tx, s.mensajeroId),
        caja: await cajaDelPremio(tx, [s.podios[DIA]![0]!.id]),
      };
    });

    expect(medido.exploto).toBe(true);
    expect(medido.libro).toHaveLength(0); // el ROLLBACK del motor se llevo el devengo
    expect(medido.caja).toHaveLength(0);
  });

  // ── Caso 7 — R24/R27: lo pagable del cierre, sobre datos reales ────────────────────────────

  it("R24/R27: un cierre SALDADO con premio vuelve a tener pendiente, y vuelve a ser imputable", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      // Cierre con P = E = 0,00: el escenario REAL de produccion hoy (los 4 cierres aprobados
      // tienen `total_pago_mensajero = 0.00`), y por eso todos salen «saldados».
      const s = await sembrar(tx, { pagoMensajero: "0.00", efectivo: "0.00" });
      const cliente = tx as unknown as PrismaClient;
      const libroRepo = new PagoMensajeroMovimientoRepository(cliente);
      const liquidacionRepo = new LiquidacionPagoRepository(cliente);
      const servicio = servicioDelPremio(tx);

      const pendienteDe = async () => {
        const premios = await libroRepo.sumarPremiosVivosPorCierre([s.cierre.id]);
        const pagados = await liquidacionRepo.sumarVigentesPorCierre([s.cierre.id]);
        return derivarPendienteCierre({
          pagoDebido: s.cierre.totalPagoMensajero.toFixed(2),
          efectivo: s.cierre.totalEfectivo.toFixed(2),
          premiosVivos: premios[s.cierre.id] ?? "0.00",
          pagadoVigente: pagados[s.cierre.id] ?? "0.00",
        });
      };

      // El servicio REAL de la liquidacion, con sus repositorios reales: es el que ejercita
      // `imputablesDe`, el consumidor de `design.md §6/3`.
      const liquidacion = new LiquidacionService(
        liquidacionRepo,
        new WalletTiendaMovimientoRepository(cliente),
        libroRepo,
        async (fn) => fn(tx as unknown as LiquidacionTx),
        new CajaPagoTiendaFeedService(new WalletMovimientoRepository(cliente)),
        new LiquidacionRepartoRepository(cliente),
      );
      const imputablesDe = async () => {
        const r = await liquidacion.previsualizarRepartoMensajero(
          { mensajeroId: s.mensajeroId },
          s.actor,
        );
        if (r.status !== "ok") throw new Error(`esperaba ok, llego ${r.status}`);
        return r.previsualizacion;
      };

      const antes = { pendiente: await pendienteDe(), previa: await imputablesDe() };
      await servicio.registrarPremio({ filaId: s.podios[DIA]![0]!.id }, s.actor);
      const despues = { pendiente: await pendienteDe(), previa: await imputablesDe() };

      // R13: el snapshot del cierre NO se toca, ni al registrar.
      const cierreRelefdo = await tx.cierreDia.findUnique({
        where: { id: s.cierre.id },
        select: { totalPagoMensajero: true, totalEfectivo: true },
      });

      return { antes, despues, cierreRelefdo, cierreId: s.cierre.id };
    });

    expect(medido.antes.pendiente).toBe("0.00");
    expect(medido.antes.previa.imputable).toBe("0.00");
    expect(medido.antes.previa.recorte.enVentana).toBe(0);

    expect(medido.despues.pendiente).toBe("5000.00");
    expect(medido.despues.previa.imputable).toBe("5000.00");
    expect(medido.despues.previa.recorte.enVentana).toBe(1);

    // R13: el snapshot sigue diciendo lo que dijo el dia en que se aprobo.
    expect(medido.cierreRelefdo?.totalPagoMensajero.toFixed(2)).toBe("0.00");
    expect(medido.cierreRelefdo?.totalEfectivo.toFixed(2)).toBe("0.00");
  });

  // ── R24: el WHERE de `sumarPremiosVivosPorCierre`, medido con SEÑUELOS ─────────────────────

  it("R24: la Σ de premios vivos esta acotada por ORIGEN, no solo por el id", () => {
    // Este caso existe por una medicion: quitar `origenTipo` del WHERE de
    // `sumarPremiosVivosPorCierre` deja el test unitario ROJO y el resto de este archivo VERDE,
    // porque en un escenario normal ningun `origen_id` de otro tipo coincide con un cierre. La
    // unica forma de medir la propiedad es SEMBRAR esa coincidencia a proposito.
    //
    // Los dos señuelos son filas legitimas del libro que NO pertenecen a ese cierre:
    //   1. un `premio_ranking` de OTRO mensajero con `origen_tipo = 'pago_mensajero'` y un
    //      `origen_id` que resulta ser el id del cierre;
    //   2. un `ajuste_pago` CON `premio_dia` en las mismas condiciones.
    // Sin `origenTipo` en el WHERE, el primero SUMARIA y el segundo RESTARIA de lo pagable de un
    // cierre al que no pertenecen.
    return enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx, { pagoMensajero: "0.00", efectivo: "0.00" });
      const repo = new PagoMensajeroMovimientoRepository(tx as unknown as PrismaClient);
      const servicio = servicioDelPremio(tx);

      await servicio.registrarPremio({ filaId: s.podios[DIA]![0]!.id }, s.actor);

      const otro = s.podios[DIA]![2]!.mensajeroId;
      await tx.pagoMensajeroMovimiento.createMany({
        data: [
          {
            mensajeroId: otro,
            tipo: "devengo",
            categoria: "premio_ranking",
            monto: new Prisma.Decimal("777.00"),
            origenTipo: "pago_mensajero", // NO es `cierre_dia`
            origenId: s.cierre.id, // …pero su id COINCIDE con el del cierre
            premioDia: fechaComoDate(DIA),
          },
          {
            mensajeroId: otro,
            tipo: "pago",
            categoria: "ajuste_pago",
            monto: new Prisma.Decimal("333.00"),
            origenTipo: "pago_mensajero",
            origenId: s.cierre.id,
            premioDia: fechaComoDate(DIA),
          },
        ],
      });

      const sumas = await repo.sumarPremiosVivosPorCierre([s.cierre.id]);
      // Los señuelos EXISTEN (control de no-vacuidad) y aun asi no mueven la cifra.
      const sembrados = await tx.pagoMensajeroMovimiento.count({
        where: { origenTipo: "pago_mensajero", origenId: s.cierre.id },
      });
      expect(sembrados).toBe(2);
      expect(sumas[s.cierre.id]).toBe("5000.00");
    });
  });

  // ── Caso 8 — R29/R31/R33: la anulacion ─────────────────────────────────────────────────────

  it("R29/R31/R33: anular deja neto CERO, baja lo pagable y el segundo intento es `ya_anulado`", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx, { pagoMensajero: "0.00", efectivo: "0.00" });
      const cliente = tx as unknown as PrismaClient;
      const libroRepo = new PagoMensajeroMovimientoRepository(cliente);
      const servicio = servicioDelPremio(tx);
      const filaId = s.podios[DIA]![0]!.id;

      const pendiente = async () =>
        derivarPendienteCierre({
          pagoDebido: "0.00",
          efectivo: "0.00",
          premiosVivos: (await libroRepo.sumarPremiosVivosPorCierre([s.cierre.id]))[s.cierre.id]!,
          pagadoVigente: "0.00",
        });

      await servicio.registrarPremio({ filaId }, s.actor);
      const conPremio = await pendiente();
      const primera = await servicio.anularPremio({ filaId, motivo: "Se pago por fuera" }, s.actor);
      const trasAnular = await pendiente();
      const segunda = await servicio.anularPremio({ filaId, motivo: "otra vez" }, s.actor);

      const cierreRelefdo = await tx.cierreDia.findUnique({
        where: { id: s.cierre.id },
        select: { totalPagoMensajero: true },
      });

      return {
        conPremio,
        trasAnular,
        primera,
        segunda,
        libro: await contarLibro(tx, s.mensajeroId),
        caja: await cajaDelPremio(tx, [filaId]),
        cierreRelefdo,
      };
    });

    expect(medido.conPremio).toBe("5000.00");
    expect(medido.primera).toEqual({ status: "ok" });
    // R33: lo pagable baja EXACTAMENTE el importe del premio y el cierre vuelve a estar saldado.
    expect(medido.trasAnular).toBe("0.00");
    // R31: la segunda anulacion responde y NO escribe.
    expect(medido.segunda).toEqual({ status: "ya_anulado" });

    // R21/R29: las filas originales siguen ahi; la correccion es un movimiento NUEVO.
    expect(medido.libro).toHaveLength(2);
    const premio = medido.libro.find((f) => f.categoria === "premio_ranking")!;
    const compensacion = medido.libro.find((f) => f.categoria === "ajuste_pago")!;
    expect(premio.monto.toFixed(2)).toBe("5000.00");
    expect(compensacion.monto.toFixed(2)).toBe("5000.00"); // efecto neto CERO
    expect(compensacion.tipo).toBe("pago");
    expect(compensacion.origenId).toBe(premio.origenId); // el MISMO cierre (R33)
    expect((compensacion.premioDia as Date).toISOString().slice(0, 10)).toBe(DIA);

    // La caja: egreso + su reverso, con la MISMA clave de origen y distinta categoria.
    expect(medido.caja).toHaveLength(2);
    expect(medido.caja.map((m) => m.categoria).sort()).toEqual([
      "egreso_pago_mensajero",
      "ingreso_ajuste",
    ]);
    expect(new Set(medido.caja.map((m) => m.origenId)).size).toBe(1);

    // R13: tampoco al anular se toca el snapshot del cierre.
    expect(medido.cierreRelefdo?.totalPagoMensajero.toFixed(2)).toBe("0.00");
  });

  // ── Caso 9 — R32: anulado NO se puede volver a registrar ───────────────────────────────────

  it("R32: tras anular, registrar de nuevo la misma fila no crea nada y responde `anulado`", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const servicio = servicioDelPremio(tx);
      const filaId = s.podios[DIA]![0]!.id;

      await servicio.registrarPremio({ filaId }, s.actor);
      await servicio.anularPremio({ filaId, motivo: "x" }, s.actor);
      const reintento = await servicio.registrarPremio({ filaId }, s.actor);

      return { reintento, libro: await contarLibro(tx, s.mensajeroId), caja: await cajaDelPremio(tx, [filaId]) };
    });

    // Q2 (cerrada por el leader): anular CONSUME el cupo (mensajero, dia). Y se dice con texto,
    // no con la ausencia del control: `anulado`, no `ya_registrado`.
    expect(medido.reintento).toEqual({ status: "anulado" });
    expect(medido.libro).toHaveLength(2); // el premio y su compensacion, nada mas
    expect(medido.caja).toHaveLength(2);
  });

  // ── Caso 10 — no-regresion: el `origen_uq` retocado no aflojo la idempotencia del feed ─────

  it("NO-REGRESION: la doble aprobacion del mismo cierre sigue dando UN solo set de movimientos", async () => {
    // El paso 6 de la migracion saca `premio_ranking` y `ajuste_pago` del predicado del unico de
    // origen. Las categorias que el FEED escribe —`pago_devengado` y `pago_efectivo`— siguen
    // dentro, y aqui se mide contra el motor que su idempotencia esta intacta.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx, { pagoMensajero: "15000.00", efectivo: "9000.00" });
      const repo = new PagoMensajeroMovimientoRepository(tx as unknown as PrismaClient);
      const feed = [
        {
          mensajeroId: s.mensajeroId,
          tipo: "devengo" as const,
          categoria: "pago_devengado" as const,
          monto: "15000.00",
          origenTipo: "cierre_dia" as const,
          origenId: s.cierre.id,
        },
        {
          mensajeroId: s.mensajeroId,
          tipo: "pago" as const,
          categoria: "pago_efectivo" as const,
          monto: "9000.00",
          origenTipo: "cierre_dia" as const,
          origenId: s.cierre.id,
        },
      ];

      const primera = await repo.crearMovimientos(tx as never, feed);
      const segunda = await repo.crearMovimientos(tx as never, feed);

      return { primera, segunda, libro: await contarLibro(tx, s.mensajeroId) };
    });

    expect(medido.primera).toBe(2);
    expect(medido.segunda).toBe(0); // ON CONFLICT DO NOTHING, sin error
    expect(medido.libro).toHaveLength(2);
  });

  // ── R11/R12: las dos causas que bloquean el registro, con datos reales ─────────────────────

  it("R11: un dia con podio pero SIN cierre no admite registro, y lo dice por su nombre", async () => {
    // Q1, cerrada por el leader: crear un cierre sintetico para colgar un premio seria inventar
    // un acto que no ocurrio.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      // El cierre existe, pero su gestion es de OTRO dia: no ata el dia del podio.
      const s = await sembrar(tx, { dias: [DIA_ANTERIOR] });
      const servicio = servicioDelPremio(tx);
      const r = await servicio.registrarPremio(
        { filaId: s.podios[DIA_ANTERIOR]![0]!.id },
        s.actor,
      );
      return { r, libro: await contarLibro(tx, s.mensajeroId) };
    });

    expect(medido.r).toEqual({ status: "sin_cierre" });
    expect(medido.libro).toHaveLength(0);
  });

  it("R12: con el cierre del dia NO aprobado, se rechaza nombrando el estado", async () => {
    for (const estado of ["solicitado", "rechazado", "vencido"] as const) {
      const medido = await enTransaccionRevertida(prisma, async (tx) => {
        const s = await sembrar(tx, { estadoCierre: estado });
        const servicio = servicioDelPremio(tx);
        const r = await servicio.registrarPremio({ filaId: s.podios[DIA]![0]!.id }, s.actor);
        return { r, libro: await contarLibro(tx, s.mensajeroId) };
      });

      expect(medido.r).toEqual({ status: "cierre_no_aprobado", estado });
      expect(medido.libro).toHaveLength(0);
    }
  });

  // ── R4/R5/R7/R9: la lectura del podio, sobre datos reales ──────────────────────────────────

  it("R4/R5/R7/R9: el panel lee el podio congelado y los estados derivados", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const servicio = servicioDelPremio(tx);

      const antes = await servicio.listarPremiosDelDia({ fecha: DIA }, s.actor);
      await servicio.registrarPremio({ filaId: s.podios[DIA]![0]!.id }, s.actor);
      const despues = await servicio.listarPremiosDelDia({ fecha: DIA }, s.actor);
      const sinPodio = await servicio.listarPremiosDelDia({ fecha: "2026-01-01" }, s.actor);

      return { antes, despues, sinPodio };
    });

    if (medido.antes.status !== "ok" || medido.despues.status !== "ok") {
      throw new Error("esperaba ok");
    }
    expect(medido.antes.hayPodio).toBe(true);
    expect(medido.antes.filas).toHaveLength(3);
    // R5: los dos conteos congelados viajan tal cual, sin recalcularse ni redondearse.
    expect(medido.antes.filas[0]).toMatchObject({
      posicion: 1,
      entregadas: 18,
      asignadas: 21,
      premioMonto: "5000.00",
      estado: "no_registrado",
    });
    // R7: la posicion 2 no tiene premio y no se ofrece registrar.
    expect(medido.antes.filas[1]).toMatchObject({ posicion: 2, premioMonto: null, estado: "sin_premio" });
    // La 3 tiene premio pero su mensajero no tiene cierre de ese dia (R11).
    expect(medido.antes.filas[2]).toMatchObject({ posicion: 3, estado: "sin_cierre" });
    // R9: tras registrar, el estado se DERIVA de las filas del libro.
    expect(medido.despues.filas[0]!.estado).toBe("registrado");
    // R6: una fecha sin snapshot lo dice por su nombre.
    if (medido.sinPodio.status !== "ok") throw new Error("esperaba ok");
    expect(medido.sinPodio).toMatchObject({ hayPodio: false, filas: [] });
  });

  // ── Feature 297: el dia YA CONGELADO con cero entregas ─────────────────────────────────────

  it("297: el `0 / 21` del 26/08 se SIGUE leyendo con su premio, y su registro se niega", async () => {
    // El caso real: Andres, primero por orden alfabetico, 0 de 21, con 5.000 congelados. El
    // snapshot es historia y NO se reescribe, asi que la fila sigue ahi con su monto; lo unico
    // que impide que ese dinero salga es la guarda del registro, y aqui se mide contra Postgres
    // con los repositorios reales.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx, { entregadasDelPrimero: 0 });
      const servicio = servicioDelPremio(tx);
      const filaId = s.podios[DIA]![0]!.id;

      const antes = await servicio.listarPremiosDelDia({ fecha: DIA }, s.actor);
      const registro = await servicio.registrarPremio({ filaId }, s.actor);
      const despues = await servicio.listarPremiosDelDia({ fecha: DIA }, s.actor);

      return {
        antes,
        registro,
        despues,
        libro: await contarLibro(tx, s.mensajeroId),
        caja: await cajaDelPremio(tx, [filaId]),
      };
    });

    if (medido.antes.status !== "ok" || medido.despues.status !== "ok") {
      throw new Error("esperaba ok");
    }
    // R5: el `0 / 21` viaja tal cual, sin ocultarse ni sustituirse, y con su premio congelado.
    expect(medido.antes.filas[0]).toMatchObject({
      posicion: 1,
      entregadas: 0,
      asignadas: 21,
      premioMonto: "5000.00",
    });
    // El rechazo tiene NOMBRE propio: la pantalla dice por que, no «no se pudo».
    expect(medido.registro).toEqual({ status: "sin_entregas" });
    // Y no queda ni un asiento en NINGUNO de los dos libros de dinero.
    expect(medido.libro).toHaveLength(0);
    expect(medido.caja).toHaveLength(0);
    // La fila sigue exactamente como estaba: el registro no la marco de ninguna forma.
    expect(medido.despues.filas[0]).toMatchObject({
      entregadas: 0,
      premioMonto: "5000.00",
      estado: "no_registrado",
    });
  });

  // ── §4: la resolucion dia -> cierre, medida contra el motor ────────────────────────────────

  it("§4.4: con DOS cierres del mismo dia gana SIEMPRE el mas antiguo por `solicitado_at`", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      // Un SEGUNDO cierre del mismo mensajero, con una gestion del MISMO dia y solicitado DESPUES.
      const segundo = await tx.cierreDia.create({
        data: {
          mensajeroId: s.mensajeroId,
          estado: "aprobado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
          solicitadoAt: new Date(`${DIA}T23:59:00.000Z`), // MAS TARDE que el primero
        },
        select: { id: true },
      });
      const orden = await tx.orden.create({
        data: {
          numRemision: `R-293-dup-${randomUUID()}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: fks.estatusId,
          tiendaId: fks.tiendaId,
          zonaId: fks.zonaId,
          provinciaId: fks.provinciaId,
          cantonId: fks.cantonId,
        },
        select: { id: true },
      });
      await tx.gestionOrden.create({
        data: {
          ordenId: orden.id,
          mensajeroId: s.mensajeroId,
          resultado: "entregada",
          cierreId: segundo.id,
          createdAt: dentroDelDia(DIA),
        },
      });

      const repo = new CierreDelDiaRepository(tx as unknown as PrismaClient);
      const resoluciones = [];
      for (let i = 0; i < 3; i += 1) {
        resoluciones.push(await repo.resolverCierreDelDia(s.mensajeroId, ventanaDe(DIA)));
      }
      return { resoluciones, esperado: s.cierre.id, segundo: segundo.id };
    });

    // Determinista y estable: tres lecturas, el mismo cierre, y es el mas antiguo (Q5).
    expect(medido.resoluciones.map((r) => r?.cierreId)).toEqual([
      medido.esperado,
      medido.esperado,
      medido.esperado,
    ]);
    expect(medido.resoluciones[0]?.cierreId).not.toBe(medido.segundo);
  });

  it("§4.2: una gestion ANULADA o de OTRO dia no arrastra su cierre", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const sufijo = randomUUID();
      const mensajeroId = (
        await tx.usuario.create({
          data: {
            nombre: "293-anulada",
            email: `293-anulada-${sufijo}@example.test`,
            telefono: "88880000",
            passwordHash: "x",
            cedula: `293-anulada-${sufijo}`,
            tipoIdentificacionId: catalogo.tipoIdentificacionId,
            rolId: catalogo.rolId,
          },
          select: { id: true },
        })
      ).id;
      const cierre = await tx.cierreDia.create({
        data: {
          mensajeroId,
          estado: "aprobado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
        },
        select: { id: true },
      });
      const gestion = async (createdAt: Date, anulada: boolean) => {
        const orden = await tx.orden.create({
          data: {
            numRemision: `R-293-g-${randomUUID()}`,
            destinatario: "Dest",
            telefonoDest: "88880000",
            producto: "Prod",
            estatusId: fks.estatusId,
            tiendaId: fks.tiendaId,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
          },
          select: { id: true },
        });
        await tx.gestionOrden.create({
          data: {
            ordenId: orden.id,
            mensajeroId,
            resultado: "entregada",
            cierreId: cierre.id,
            createdAt,
            ...(anulada ? { anuladaAt: new Date(`${DIA}T20:00:00.000Z`) } : {}),
          },
        });
      };
      // Una ANULADA del dia y una VIGENTE de otro dia: ninguna deberia atar el dia del podio.
      await gestion(dentroDelDia(DIA), true);
      await gestion(dentroDelDia(DIA_ANTERIOR), false);

      const repo = new CierreDelDiaRepository(tx as unknown as PrismaClient);
      const soloEsas = await repo.resolverCierreDelDia(mensajeroId, ventanaDe(DIA));
      // CONTROL DE NO-VACUIDAD: con una gestion VIGENTE del dia, el MISMO cierre SI aparece. Sin
      // esto, un `where` roto que no devolviera nunca nada pasaria el caso de arriba en verde.
      await gestion(dentroDelDia(DIA), false);
      const conVigente = await repo.resolverCierreDelDia(mensajeroId, ventanaDe(DIA));
      return { soloEsas, conVigente, cierreId: cierre.id };
    });

    expect(medido.soloEsas).toBeNull();
    expect(medido.conVigente?.cierreId).toBe(medido.cierreId);
  });
});

/**
 * FEATURE 293 (T2.5) — EL COMPOSITION ROOT DE `CierresAdminService`, MEDIDO.
 *
 * No basta con que `lib/actions/cierres-admin.ts` IMPORTE el repositorio: hay que comprobar que
 * alguien lo PASA. Medido en este repo: 2 de 7 notificadores quedaron muertos con la suite verde
 * porque nadie comprobaba el cableado.
 *
 * Se mide espiando el PROTOTIPO del repositorio real y llamando a la action **sin `deps.service`**,
 * de modo que `buildService()` corre de verdad. Si el 6.º argumento fuera un stub —o el
 * repositorio de otra clase—, el espia no se dispararia. Lo que el compilador ya garantiza (que
 * ALGO de esa forma se pasa) no es lo que este caso mide.
 */
describeSiHayBase("293/T2.5 — la action construida DE VERDAD usa el repositorio real", () => {
  it("`listarCierresAdmin` sin `deps.service` llama a `sumarPremiosVivosPorCierre`", async () => {
    const { listarCierresAdmin } = await import("@/lib/actions/cierres-admin");
    const { PagoMensajeroMovimientoRepository: Repo } = await import(
      "@/lib/repositories/PagoMensajeroMovimientoRepository"
    );
    const espia = vi.spyOn(Repo.prototype, "sumarPremiosVivosPorCierre");

    try {
      const r = await listarCierresAdmin({
        getActor: async () => ({ usuarioId: "u-maestro", rol: RolValue.maestro }),
      });

      expect(r.status).toBe("ok");
      // UNA llamada, siempre: tambien con la lista vacia (es lo que hace que el conteo de
      // consultas del listado no dependa de lo que se pinte).
      expect(espia).toHaveBeenCalledTimes(1);
    } finally {
      espia.mockRestore();
    }
  });
});
