import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { SaldosSatelitesRepository } from "@/lib/repositories/SaldosSatelitesRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 473 / T2 (R1-R4, R6, R7, R12, R13) — CORREGIR LA RECEPCION, CONTRA POSTGRES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO EXISTE ADEMAS DEL UNITARIO: el defecto de la ficha vivia en el `WHERE`
// (`marcarConciliado` exige `solicitado` + `conciliado_at IS NULL`, y una «incompleta» es
// `aprobado` + `conciliado_at` no nulo). Los dobles no ven el SQL; aqui el `WHERE` selecciona de
// verdad, el `CHECK` `cierre_bodega_conciliacion_coherente` muerde y la fila de historial queda.
//
// MUTACIONES MEDIDAS (anotadas en `progress/impl_473.md`): (1) `estado: ESTADO_APROBADO` →
// `ESTADO_SOLICITADO` y (2) quitar `estado` y `conciliadoAt` del `WHERE` ponen ROJO este archivo.
// La tercera (quitar el compare-and-swap del monto) la caza el unitario de R8: aqui no se pueden
// intercalar dos transacciones de forma fiable.
//
// LO QUE NO CAZA: `appendAccion(this.prisma, …)` en vez de `tx` (aqui `this.prisma` ES la
// transaccion del test). Eso lo caza la guardia del censo (entrada `corregirConciliacion`).
//
// AISLAMIENTO: transaccion SIEMPRE revertida + sufijo propio. Sin base alcanzable se SALTA.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const SUFIJO = `473-corregir-${Date.now().toString(36)}`;

/** El caso real de la ficha (FGAM Zona Sur, 2026-10-01): declarado 200.800, marcado por 177.800. */
const DECLARADO = "200800.00";
const MARCADO = "177800.00";
/** Un instante VIEJO para la marca original: asi R2 ve moverse `conciliado_at` sin depender de ms. */
const MARCA_VIEJA = new Date("2026-01-01T12:00:00.000Z");

describeSiHayBase("473/T2 — corregir la recepcion de una satelite (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sembrarZona(tx: TxDeTest, marca: string): Promise<string> {
    const fila = await tx.zona.create({
      data: {
        nombre: `Zona ${SUFIJO}-${marca}`,
        sinpeNumero: "80000000",
        sinpeNombre: "Titular de Prueba",
        cobroVehiculo: false,
        esCentral: false,
      },
      select: { id: true },
    });
    return fila.id;
  }

  /** Dos usuarios DISTINTOS: quien marco y quien corrige. Sin dos, R2 no se puede afirmar. */
  async function dosUsuarios(tx: TxDeTest): Promise<[string, string]> {
    const filas = await tx.usuario.findMany({ select: { id: true }, take: 2, orderBy: { id: "asc" } });
    if (filas.length < 2) {
      throw new Error(
        "hay DATABASE_URL pero `usuario` tiene menos de 2 filas: R2 necesita a quien marco y a " +
          "quien corrige. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    return [filas[0].id, filas[1].id];
  }

  async function sembrarConsolidacion(
    tx: TxDeTest,
    zonaId: string,
    usuarioId: string,
    estado: "solicitado" | "rechazado" = "solicitado",
  ): Promise<string> {
    const fila = await tx.cierreBodega.create({
      data: {
        zonaId,
        solicitadoPor: usuarioId,
        estado,
        totalEfectivo: new Prisma.Decimal(DECLARADO),
        totalGeneral: new Prisma.Decimal(DECLARADO),
        ...(estado === "rechazado" ? { resueltoAt: MARCA_VIEJA, resueltoPor: usuarioId } : {}),
      },
      select: { id: true },
    });
    return fila.id;
  }

  /**
   * Una «Recibido incompleto» por el CAMINO VIVO (`marcarConciliado`, respeta el `CHECK`), con la
   * marca envejecida a `MARCA_VIEJA` para que R2 se lea sin depender de milisegundos.
   */
  async function sembrarIncompleta(
    tx: TxDeTest,
    marca: string,
    marcador: string,
  ): Promise<{ id: string; zonaId: string; repo: CierresBodegaAdminRepository }> {
    const zonaId = await sembrarZona(tx, marca);
    const id = await sembrarConsolidacion(tx, zonaId, marcador);
    const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
    const r = await repo.marcarConciliado({
      id,
      montoRecibido: MARCADO,
      nota: "faltaron 23.000",
      actorUsuarioId: marcador,
    });
    if (r !== "updated") throw new Error(`la siembra no pudo marcar: ${r}`);
    await tx.cierreBodega.update({
      where: { id },
      data: { conciliadoAt: MARCA_VIEJA, resueltoAt: MARCA_VIEJA },
    });
    return { id, zonaId, repo };
  }

  const SELECT_MARCA = {
    estado: true,
    conciliadoAt: true,
    conciliadoPor: true,
    montoRecibido: true,
    conciliadoNota: true,
    resueltoAt: true,
    resueltoPor: true,
  } as const;

  it("⭑ R1: corregir una incompleta cambia el monto y la deja conciliada (aprobado, conciliado_at no nulo)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [marcador, corrector] = await dosUsuarios(tx);
      const { id, repo } = await sembrarIncompleta(tx, "r1", marcador);

      const res = await repo.corregirConciliacion({
        id,
        montoRecibido: DECLARADO,
        nota: null,
        actorUsuarioId: corrector,
      });
      const fila = await tx.cierreBodega.findUnique({ where: { id }, select: SELECT_MARCA });
      return { res, fila };
    });

    expect(r.res).toBe("updated");
    expect(r.fila?.estado).toBe("aprobado");
    expect(r.fila?.conciliadoAt).not.toBeNull();
    expect(r.fila?.montoRecibido?.toFixed(2)).toBe(DECLARADO);
  });

  it("⭑ R2: la corrección reescribe conciliado_por/conciliado_at y el espejo resuelto_*", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [marcador, corrector] = await dosUsuarios(tx);
      const { id, repo } = await sembrarIncompleta(tx, "r2", marcador);

      const antes = new Date();
      await repo.corregirConciliacion({
        id,
        montoRecibido: "190000.00",
        nota: null,
        actorUsuarioId: corrector,
      });
      const fila = await tx.cierreBodega.findUnique({ where: { id }, select: SELECT_MARCA });
      return { fila, corrector, antes };
    });

    expect(r.fila?.conciliadoPor).toBe(r.corrector);
    expect(r.fila?.resueltoPor).toBe(r.corrector);
    // La marca original estaba en 2026-01-01: la correccion la trae al momento de corregir.
    expect(r.fila?.conciliadoAt?.getTime()).toBeGreaterThan(MARCA_VIEJA.getTime());
    expect(r.fila?.conciliadoAt?.getTime()).toBeGreaterThanOrEqual(r.antes.getTime() - 1000);
    expect(r.fila?.resueltoAt?.getTime()).toBe(r.fila?.conciliadoAt?.getTime());
  });

  it("R3: la nota se sustituye; sin nota queda NULL", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [marcador, corrector] = await dosUsuarios(tx);
      const { id, repo } = await sembrarIncompleta(tx, "r3", marcador);

      await repo.corregirConciliacion({
        id,
        montoRecibido: "190000.00",
        nota: "llego el resto el lunes",
        actorUsuarioId: corrector,
      });
      const conNota = await tx.cierreBodega.findUnique({
        where: { id },
        select: { conciliadoNota: true },
      });
      await repo.corregirConciliacion({
        id,
        montoRecibido: DECLARADO,
        nota: null,
        actorUsuarioId: corrector,
      });
      const sinNota = await tx.cierreBodega.findUnique({
        where: { id },
        select: { conciliadoNota: true },
      });
      return { conNota, sinNota };
    });

    expect(r.conNota?.conciliadoNota).toBe("llego el resto el lunes");
    expect(r.sinNota?.conciliadoNota).toBeNull();
  });

  it("⭑ R4: deja exactamente UNA fila cierre_bodega_conciliado con monto nuevo, valor_anterior y valor_nuevo, sin la nota", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [marcador, corrector] = await dosUsuarios(tx);
      const { id, repo } = await sembrarIncompleta(tx, "r4", marcador);
      const antes = await tx.historialAccion.count({ where: { entidadId: id } });

      await repo.corregirConciliacion({
        id,
        montoRecibido: DECLARADO,
        nota: "una nota que NO debe viajar al historial",
        actorUsuarioId: corrector,
      });
      const nuevas = await tx.historialAccion.findMany({
        where: { entidadId: id, valorAnterior: { not: null } },
      });
      const despues = await tx.historialAccion.count({ where: { entidadId: id } });
      return { antes, despues, nuevas, corrector };
    });

    expect(r.despues - r.antes).toBe(1);
    expect(r.nuevas).toHaveLength(1);
    const fila = r.nuevas[0];
    expect(fila.accion).toBe("cierre_bodega_conciliado");
    expect(fila.entidadTipo).toBe("cierre_bodega");
    expect(fila.monto?.toFixed(2)).toBe(DECLARADO);
    expect(fila.valorAnterior).toBe(MARCADO);
    expect(fila.valorNuevo).toBe(DECLARADO);
    expect(fila.actorUsuarioId).toBe(r.corrector);
    expect(fila.entidadEtiqueta).toContain(`Zona ${SUFIJO}-r4`);
    expect(JSON.stringify(fila)).not.toContain("una nota que NO debe viajar");
  });

  // Las etiquetas son el ESTADO de `cierre_bodega` (pendiente de conciliar = `solicitado`). No se
  // usa el adjetivo en femenino: la guardia `censo-order-status-rename` lo censa como codigo viejo.
  it.each([["pendiente", "solicitado"] as const, ["en-rechazo", "rechazado"] as const])(
    "⭑ R6: sobre una consolidacion %s (estado %s) responde conflict y no escribe nada",
    async (marca, estado) => {
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const [marcador, corrector] = await dosUsuarios(tx);
        const zonaId = await sembrarZona(tx, `r6-${marca}`);
        const id = await sembrarConsolidacion(tx, zonaId, marcador, estado);
        const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);

        const filaAntes = await tx.cierreBodega.findUnique({ where: { id }, select: SELECT_MARCA });
        const historialAntes = await tx.historialAccion.count({ where: { entidadId: id } });
        const res = await repo.corregirConciliacion({
          id,
          montoRecibido: DECLARADO,
          nota: "colada",
          actorUsuarioId: corrector,
        });
        const filaDespues = await tx.cierreBodega.findUnique({
          where: { id },
          select: SELECT_MARCA,
        });
        const historialDespues = await tx.historialAccion.count({ where: { entidadId: id } });
        return { res, filaAntes, filaDespues, historialAntes, historialDespues };
      });

      expect(r.res).toBe("conflict");
      expect(r.filaDespues).toEqual(r.filaAntes);
      expect(r.filaDespues?.estado).toBe(estado);
      expect(r.filaDespues?.montoRecibido).toBeNull();
      expect(r.historialDespues).toBe(r.historialAntes);
    },
  );

  it("R7: sobre un id inexistente responde fuera_de_alcance, sin rastro", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [, corrector] = await dosUsuarios(tx);
      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      const idFalso = `no-existe-${SUFIJO}`;
      const res = await repo.corregirConciliacion({
        id: idFalso,
        montoRecibido: "1.00",
        nota: null,
        actorUsuarioId: corrector,
      });
      const filas = await tx.historialAccion.count({ where: { entidadId: idFalso } });
      return { res, filas };
    });

    expect(r.res).toBe("fuera_de_alcance");
    expect(r.filas).toBe(0);
  });

  it("⭑ R12: corregir no escribe en wallet_movimiento, wallet_tienda_movimiento ni pago_mensajero_movimiento", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      // REPEATABLE READ (antes de cualquier otra sentencia): los conteos son de TABLA ENTERA y otro
      // archivo de test puede commitear un movimiento en paralelo. Medido en el gate de esta ficha:
      // el caso hermano de `marca-conciliacion.int.test.ts` (READ COMMITTED) vio `tienda` 27→28 sin
      // que la marca escribiera nada. Con una foto fija, solo cuenta lo que escribe ESTA transaccion.
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await serializarEscriturasReales(tx);
      const [marcador, corrector] = await dosUsuarios(tx);
      const { id, repo } = await sembrarIncompleta(tx, "r12", marcador);

      const contar = async () => ({
        caja: await tx.walletMovimiento.count(),
        tienda: await tx.walletTiendaMovimiento.count(),
        mensajero: await tx.pagoMensajeroMovimiento.count(),
      });
      const antes = await contar();
      const res = await repo.corregirConciliacion({
        id,
        montoRecibido: DECLARADO,
        nota: null,
        actorUsuarioId: corrector,
      });
      const despues = await contar();
      return { res, antes, despues };
    });

    expect(r.res).toBe("updated");
    expect(r.despues).toEqual(r.antes);
  });

  it("⭑ R13: corregida a lo declarado: SaldosSatelitesRepository devuelve faltaPorRecibir 0.00 y conciliado", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [marcador, corrector] = await dosUsuarios(tx);
      const { id, zonaId, repo } = await sembrarIncompleta(tx, "r13-ok", marcador);
      const lector = new SaldosSatelitesRepository(tx as unknown as PrismaClient);

      const antes = (await lector.findConsolidacionesCompleto(zonaId)).find(
        (c) => c.cierreBodegaId === id,
      );
      await repo.corregirConciliacion({
        id,
        montoRecibido: DECLARADO,
        nota: null,
        actorUsuarioId: corrector,
      });
      const despues = (await lector.findConsolidacionesCompleto(zonaId)).find(
        (c) => c.cierreBodegaId === id,
      );
      return { antes, despues };
    });

    // Control: ANTES era «Recibido incompleto» (faltaban 23.000).
    expect(r.antes?.faltaPorRecibir).toBe("23000.00");
    expect(r.despues?.conciliado).toBe(true);
    expect(r.despues?.montoRecibido).toBe(DECLARADO);
    expect(r.despues?.faltaPorRecibir).toBe("0.00");
  });

  it("R13: corregida por debajo: faltante recalculado y sigue conciliada", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [marcador, corrector] = await dosUsuarios(tx);
      const { id, zonaId, repo } = await sembrarIncompleta(tx, "r13-bajo", marcador);
      const lector = new SaldosSatelitesRepository(tx as unknown as PrismaClient);

      await repo.corregirConciliacion({
        id,
        montoRecibido: "195800.00",
        nota: null,
        actorUsuarioId: corrector,
      });
      return (await lector.findConsolidacionesCompleto(zonaId)).find(
        (c) => c.cierreBodegaId === id,
      );
    });

    expect(r?.conciliado).toBe(true);
    expect(r?.montoRecibido).toBe("195800.00");
    expect(r?.faltaPorRecibir).toBe("5000.00");
  });
});
