import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T7 (R8/R9/R11/R12/R13/R14) — MARCAR Y REVERTIR, CONTRA POSTGRES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LO QUE SOLO SE PUEDE MEDIR AQUI, y por eso este archivo existe ademas de los unitarios:
//   · que la escritura PASA el `CHECK` de coherencia (un doble no tiene constraints);
//   · que las guardas por estado del `WHERE` seleccionan de verdad (`count !== 1` -> `conflict`);
//   · que la fila de `historial_accion` QUEDA ESCRITA, con su `monto`, en el mismo acto (R13);
//   · que al revertir, el monto del historial es EL QUE SE BORRA — el unico sitio donde sobrevive;
//   · que NO se escribe en ningun libro de dinero (R14).
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PUEDE CAZAR, Y ESTA MEDIDO EN ESTE REPO: si alguien cambiara
// `appendAccion(tx, …)` por `appendAccion(this.prisma, …)`, ESTOS CASOS SEGUIRIAN VERDES — aqui
// `this.prisma` ES el cliente de la transaccion del test, asi que la fila se escribiria igual. Lo
// unico que lo caza es la guardia estatica del censo
// (`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`), que exige forma
// `abre_tx` y el `appendAccion` DENTRO del callback. Se dice aqui para que nadie concluya que este
// archivo cubre la atomicidad del rastro: no la cubre.
//
// AISLAMIENTO: transaccion SIEMPRE revertida + sufijo propio. Sin base alcanzable se SALTA.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const SUFIJO = `431-marca-${Date.now().toString(36)}`;

describeSiHayBase("431/T7 — la marca de conciliacion (Postgres real)", () => {
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

  async function algunUsuarioId(tx: TxDeTest): Promise<string> {
    const fila = await tx.usuario.findFirst({ select: { id: true } });
    if (!fila) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `usuario` esta vacia: sin FK no se puede sembrar un " +
          "cierre_bodega. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    return fila.id;
  }

  async function sembrarConsolidacion(
    tx: TxDeTest,
    zonaId: string,
    usuarioId: string,
    efectivo: string,
  ): Promise<string> {
    const fila = await tx.cierreBodega.create({
      data: {
        zonaId,
        solicitadoPor: usuarioId,
        estado: "solicitado",
        totalEfectivo: new Prisma.Decimal(efectivo),
        totalGeneral: new Prisma.Decimal(efectivo),
      },
      select: { id: true },
    });
    return fila.id;
  }

  it("⭑ R8/R9: marcar escribe LOS CUATRO datos, el espejo, y pasa el CHECK", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "marcar");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");

      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      const res = await repo.marcarConciliado({
        id,
        montoRecibido: "485.00",
        nota: "faltaron 15.000, entran el lunes",
        actorUsuarioId: usuarioId,
      });

      const fila = await tx.cierreBodega.findUnique({
        where: { id },
        select: {
          estado: true,
          conciliadoAt: true,
          conciliadoPor: true,
          montoRecibido: true,
          conciliadoNota: true,
          resueltoAt: true,
          resueltoPor: true,
        },
      });
      return { res, fila, usuarioId };
    });

    expect(r.res).toBe("updated");
    // D2: `aprobado` se LEE «Recibido». El enum NO se toca (D3).
    expect(r.fila?.estado).toBe("aprobado");
    // R8: los cuatro datos, en el mismo acto.
    expect(r.fila?.conciliadoAt).not.toBeNull();
    expect(r.fila?.conciliadoPor).toBe(r.usuarioId);
    expect(r.fila?.montoRecibido?.toFixed(2)).toBe("485.00");
    expect(r.fila?.conciliadoNota).toBe("faltaron 15.000, entran el lunes");
    // ⭑ EL ESPEJO. Sin el, `ConciliacionCierresAnaliticaRepository.contarCierresPorEstado` —que
    // selecciona los aprobados POR `resuelto_at`— dejaria de ver los cierres de bodega y NADA se
    // pondria rojo.
    expect(r.fila?.resueltoAt).not.toBeNull();
    expect(r.fila?.resueltoPor).toBe(r.usuarioId);
  });

  it("⭑ R13: marcar deja UNA fila de historial, con su monto y su entidad", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "rastro");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");

      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      await repo.marcarConciliado({
        id,
        montoRecibido: "485.00",
        nota: "una nota que NO debe viajar al historial",
        actorUsuarioId: usuarioId,
      });

      return tx.historialAccion.findMany({
        where: { entidadId: id },
        select: {
          accion: true,
          entidadTipo: true,
          monto: true,
          actorUsuarioId: true,
          entidadEtiqueta: true,
          valorAnterior: true,
          valorNuevo: true,
        },
      });
    });

    expect(r).toHaveLength(1);
    expect(r[0].accion).toBe("cierre_bodega_conciliado");
    expect(r[0].entidadTipo).toBe("cierre_bodega");
    // El monto RECIBIDO, no el consolidado: es lo que la persona afirma haber contado.
    expect(r[0].monto?.toFixed(2)).toBe("485.00");
    expect(r[0].entidadEtiqueta).toContain(`Zona ${SUFIJO}-rastro`);
    // La NOTA no entra (R5 de la 362: texto libre tecleado por una persona).
    expect(r[0].valorAnterior).toBeNull();
    expect(r[0].valorNuevo).toBeNull();
  });

  it("⭑ R11: marcar DOS VECES -> la segunda es `conflict` y NO reescribe nada", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "doble");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");

      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      const primera = await repo.marcarConciliado({
        id,
        montoRecibido: "485.00",
        nota: null,
        actorUsuarioId: usuarioId,
      });
      const segunda = await repo.marcarConciliado({
        id,
        montoRecibido: "1.00", // un monto distinto: si entrara, se veria
        nota: "colado",
        actorUsuarioId: usuarioId,
      });

      const fila = await tx.cierreBodega.findUnique({
        where: { id },
        select: { montoRecibido: true, conciliadoNota: true },
      });
      const filas = await tx.historialAccion.count({ where: { entidadId: id } });
      return { primera, segunda, fila, filas };
    });

    expect(r.primera).toBe("updated");
    expect(r.segunda).toBe("conflict");
    // La guarda del `WHERE` mordio: el monto sigue siendo el de la primera marca.
    expect(r.fila?.montoRecibido?.toFixed(2)).toBe("485.00");
    expect(r.fila?.conciliadoNota).toBeNull();
    // Y una segunda marca que no ocurrio NO deja rastro de que ocurrio.
    expect(r.filas).toBe(1);
  });

  it("marcar algo que NO existe -> `fuera_de_alcance`, sin rastro", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      const res = await repo.marcarConciliado({
        id: `no-existe-${SUFIJO}`,
        montoRecibido: "1.00",
        nota: null,
        actorUsuarioId: usuarioId,
      });
      const filas = await tx.historialAccion.count({
        where: { entidadId: `no-existe-${SUFIJO}` },
      });
      return { res, filas };
    });

    expect(r.res).toBe("fuera_de_alcance");
    expect(r.filas).toBe(0);
  });

  it("⭑ R12: revertir VACIA las cuatro columnas y el espejo, y vuelve a `solicitado`", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "revertir");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");

      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      await repo.marcarConciliado({
        id,
        montoRecibido: "485.00",
        nota: "algo",
        actorUsuarioId: usuarioId,
      });
      const res = await repo.revertirConciliacion({ id, actorUsuarioId: usuarioId });

      const fila = await tx.cierreBodega.findUnique({
        where: { id },
        select: {
          estado: true,
          conciliadoAt: true,
          conciliadoPor: true,
          montoRecibido: true,
          conciliadoNota: true,
          resueltoAt: true,
          resueltoPor: true,
        },
      });
      return { res, fila };
    });

    expect(r.res).toBe("updated");
    expect(r.fila?.estado).toBe("solicitado"); // «Pendiente de conciliar»
    expect(r.fila?.conciliadoAt).toBeNull();
    expect(r.fila?.conciliadoPor).toBeNull();
    expect(r.fila?.montoRecibido).toBeNull();
    expect(r.fila?.conciliadoNota).toBeNull();
    // El espejo se va con la marca. CONSECUENCIA DECLARADA: la analitica financiera deja de contar
    // este cierre en su periodo. Es lo correcto —no se recibio— y esta escrito para que no
    // sorprenda.
    expect(r.fila?.resueltoAt).toBeNull();
    expect(r.fila?.resueltoPor).toBeNull();
  });

  it("⭑ R13: la fila de la REVERSION lleva EL MONTO QUE SE BORRA", async () => {
    // Es el unico sitio donde sobrevive: `cierre_bodega.monto_recibido` acaba de quedar en NULL.
    // Sin este monto, el rastro diria «alguien deshizo algo» en vez de «alguien deshizo un recibido
    // de ₡485,00».
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "monto-borrado");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");

      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      await repo.marcarConciliado({
        id,
        montoRecibido: "485.00",
        nota: null,
        actorUsuarioId: usuarioId,
      });
      await repo.revertirConciliacion({ id, actorUsuarioId: usuarioId });

      return tx.historialAccion.findMany({
        where: { entidadId: id },
        orderBy: { createdAt: "asc" },
        select: { accion: true, monto: true },
      });
    });

    expect(r).toHaveLength(2);
    expect(r.map((f) => f.accion)).toEqual([
      "cierre_bodega_conciliado",
      "cierre_bodega_conciliacion_revertida",
    ]);
    expect(r[1].monto?.toFixed(2)).toBe("485.00");
  });

  it("revertir algo que NO estaba marcado -> `conflict`, sin rastro y sin tocar la fila", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "sin-marca");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");

      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      const res = await repo.revertirConciliacion({ id, actorUsuarioId: usuarioId });
      const fila = await tx.cierreBodega.findUnique({
        where: { id },
        select: { estado: true },
      });
      const filas = await tx.historialAccion.count({ where: { entidadId: id } });
      return { res, fila, filas };
    });

    expect(r.res).toBe("conflict");
    expect(r.fila?.estado).toBe("solicitado");
    expect(r.filas).toBe(0);
  });

  it("⭑ R14: marcar y revertir NO escriben en NINGUN libro de dinero", async () => {
    // La marca es SEGUIMIENTO, no contabilidad. Es lo que hace que revertirla sea seguro, y es un
    // limite declarado de la ficha. Se cuentan las filas de los TRES libros antes y despues.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "sin-libro");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");

      const contar = async () => ({
        caja: await tx.walletMovimiento.count(),
        tienda: await tx.walletTiendaMovimiento.count(),
        mensajero: await tx.pagoMensajeroMovimiento.count(),
      });

      const antes = await contar();
      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);
      await repo.marcarConciliado({
        id,
        montoRecibido: "485.00",
        nota: null,
        actorUsuarioId: usuarioId,
      });
      const trasMarcar = await contar();
      await repo.revertirConciliacion({ id, actorUsuarioId: usuarioId });
      const trasRevertir = await contar();
      return { antes, trasMarcar, trasRevertir };
    });

    expect(r.trasMarcar).toEqual(r.antes);
    expect(r.trasRevertir).toEqual(r.antes);
  });

  it("marcar -> revertir -> marcar otra vez: la marca es REVERSIBLE de verdad (D6)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "ciclo");
      const id = await sembrarConsolidacion(tx, zonaId, usuarioId, "500.00");
      const repo = new CierresBodegaAdminRepository(tx as unknown as PrismaClient);

      const a = await repo.marcarConciliado({
        id,
        montoRecibido: "485.00",
        nota: null,
        actorUsuarioId: usuarioId,
      });
      const b = await repo.revertirConciliacion({ id, actorUsuarioId: usuarioId });
      const c = await repo.marcarConciliado({
        id,
        montoRecibido: "500.00",
        nota: "llego el resto",
        actorUsuarioId: usuarioId,
      });
      const fila = await tx.cierreBodega.findUnique({
        where: { id },
        select: { estado: true, montoRecibido: true },
      });
      const rastro = await tx.historialAccion.count({ where: { entidadId: id } });
      return { a, b, c, fila, rastro };
    });

    expect([r.a, r.b, r.c]).toEqual(["updated", "updated", "updated"]);
    expect(r.fila?.estado).toBe("aprobado");
    expect(r.fila?.montoRecibido?.toFixed(2)).toBe("500.00");
    // TRES filas de historial: el rastro sobrevive al borrado de las columnas. Las columnas dicen
    // el estado de HOY; el historial dice la HISTORIA.
    expect(r.rastro).toBe(3);
  });
});
