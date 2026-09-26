import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { listarMovimientosAction, verResumenCajaAction } from "@/lib/actions/wallet";
import { quienesDelLibroCajaAction } from "@/lib/actions/wallet-filtros";
import { AjusteCajaAnulacionRepository } from "@/lib/repositories/AjusteCajaAnulacionRepository";
import { FiltrosWalletRepository } from "@/lib/repositories/FiltrosWalletRepository";
import { LibroCajaAutoriaRepository } from "@/lib/repositories/LibroCajaAutoriaRepository";
import { OrigenLegibleRepository } from "@/lib/repositories/OrigenLegibleRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { AjusteCajaService } from "@/lib/services/AjusteCajaService";
import { FiltrosWalletService } from "@/lib/services/FiltrosWalletService";
import { LibroCajaAutoriaService } from "@/lib/services/LibroCajaAutoriaService";
import { OrigenLegibleService } from "@/lib/services/OrigenLegibleService";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { CajaResumenDTO } from "@/lib/types/wallet";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-E — REVISIÓN (B1 y M2), contra Postgres, sobre el escenario de la fase 0 de la 459.
//
// B1 (R58 «quién lo registró y CUÁNDO»): la autoría de una fila trae el instante en que se REGISTRÓ
// (`created_at`) en día y hora de Costa Rica, distinto de la fecha del movimiento. Los valores
// esperados son LITERALES (el contrato), no la función que los calcula.
//
// M2 (R59): con «A quién» por nombre libre, un sueldo y una corrección anulados cuentan con su
// contra-asiento — el libro trae las cuatro filas, las tarjetas dan un efecto neto de 0,00, el selector
// cuenta las cuatro y la columna «A quién» del contra-asiento dice el mismo nombre. Antes el reverso
// quedaba fuera y las tarjetas decían −₡100.000.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Nombre único: la base de pruebas es una copia de otra y puede traer anotaciones «Pedro». */
const PEDRO = "Pedro Revisión 458-E M2";

interface Medida {
  registradoEl: AutoriaDeFilaDTO["registradoEl"] | undefined;
  fechaMovimientoDelSueldo: string;
  sueldoId: string;
  correccionId: string;
  reversoSueldoId: string;
  reversoCorreccionId: string;
  libroIds: string[];
  libroTotal: number;
  resumen: CajaResumenDTO;
  opcion: { nombre: string; movimientos: number } | undefined;
  autoriaReversos: (string | null)[];
}

describeSiHayBase("458-E revisión B1/M2 — instante de registro; «A quién» con anulados (Postgres real)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const esc = await sembrarEscenario459(tx, cat);
        const actor = esc.maestro;

        // ── Un sueldo a Pedro con fecha del 1, TECLEADO el 26 a las 21:30 de Costa Rica ────────
        // (03:30Z del 27: el día UTC ya cambió, el de Costa Rica no).
        const sueldo = await tx.walletMovimiento.create({
          data: {
            tipo: "egreso",
            categoria: "egreso_sueldo",
            monto: new Prisma.Decimal("100000.00"),
            origenTipo: "gasto",
            origenId: null,
            descripcion: "458-E M2: sueldo",
            registradoPor: actor.usuarioId,
            fechaMovimiento: new Date("2026-09-01T18:00:00.000Z"),
            createdAt: new Date("2026-09-27T03:30:00.000Z"),
          },
          select: { id: true, fechaMovimiento: true },
        });
        await tx.walletAnotacion.create({ data: { movimientoId: sueldo.id, contraparteNombre: PEDRO } });
        // Una corrección que sacó dinero, anotada con el mismo nombre con espacios en los bordes.
        const correccion = await tx.walletMovimiento.create({
          data: {
            tipo: "egreso",
            categoria: "egreso_ajuste",
            monto: new Prisma.Decimal("250.00"),
            origenTipo: "manual",
            origenId: null,
            descripcion: "458-E M2: correccion",
            registradoPor: actor.usuarioId,
            fechaMovimiento: new Date("2026-09-02T18:00:00.000Z"),
          },
          select: { id: true },
        });
        await tx.walletAnotacion.create({ data: { movimientoId: correccion.id, contraparteNombre: `  ${PEDRO} ` } });

        // ── Las dos se ANULAN por sus caminos reales (con constancia y contra-asiento) ─────────
        const a1 = await s.egresoAnulacion.anular({ movimientoId: sueldo.id, motivo: "Sueldo duplicado 458-E" }, actor);
        if (a1.status !== "ok") throw new Error(`anular sueldo: ${JSON.stringify(a1)}`);
        const ajustes = new AjusteCajaService(
          new WalletMovimientoRepository(s.cliente),
          new AjusteCajaAnulacionRepository(s.cliente),
          (fn) => s.cliente.$transaction((t) => fn(t as never)),
        );
        const a2 = await ajustes.anular({ movimientoId: correccion.id, motivo: "Correccion equivocada 458-E" }, actor);
        if (a2.status !== "ok") throw new Error(`anular correccion: ${JSON.stringify(a2)}`);
        // Los contra-asientos, por lo que el camino ESCRIBIÓ (no por la función que se prueba).
        const reversoSueldo = await tx.walletMovimiento.findFirstOrThrow({
          where: { origenTipo: "gasto", origenId: sueldo.id, categoria: "ingreso_ajuste" },
          select: { id: true },
        });
        const reversoCorreccion = await tx.walletMovimiento.findFirstOrThrow({
          where: { origenTipo: "manual", origenId: correccion.id },
          select: { id: true },
        });

        // ── B1: la autoría del sueldo ─────────────────────────────────────────────────────────
        const autoriaSrv = new LibroCajaAutoriaService(new LibroCajaAutoriaRepository(s.cliente));
        const autoria = await autoriaSrv.resolver(
          { movimientoIds: [sueldo.id, reversoSueldo.id, reversoCorreccion.id] },
          actor,
        );
        if (autoria.status !== "ok") throw new Error(`autoria: ${autoria.status}`);
        const porId = new Map(autoria.filas.map((f) => [f.movimientoId, f]));

        // ── M2: el libro, las tarjetas y el selector filtrados por «Pedro» ────────────────────
        const origenes = new OrigenLegibleService(new OrigenLegibleRepository(s.cliente));
        const deps = { getActor: async () => actor, service: s.wallet, origenes };
        const aQuien = { nombre: PEDRO.toLowerCase() };
        const libro = await listarMovimientosAction({ aQuien, page: 1, pageSize: 100 }, deps);
        if (libro.status !== "ok") throw new Error(`libro: ${JSON.stringify(libro)}`);
        const res = await verResumenCajaAction({ aQuien }, deps);
        if (res.status !== "ok") throw new Error(`resumen: ${JSON.stringify(res)}`);
        const filtros = new FiltrosWalletService(new FiltrosWalletRepository(s.cliente));
        const quienes = await quienesDelLibroCajaAction(
          { busqueda: "revision 458-e m2" },
          { getActor: async () => actor, service: filtros },
        );
        if (quienes.status !== "ok") throw new Error(`quienes: ${JSON.stringify(quienes)}`);
        const opcion = quienes.opciones.find((o) => o.clase === "nombre");

        return {
          registradoEl: porId.get(sueldo.id)?.registradoEl,
          fechaMovimientoDelSueldo: sueldo.fechaMovimiento.toISOString(),
          sueldoId: sueldo.id,
          correccionId: correccion.id,
          reversoSueldoId: reversoSueldo.id,
          reversoCorreccionId: reversoCorreccion.id,
          libroIds: libro.data.movimientos.map((x) => x.id),
          libroTotal: libro.data.total,
          resumen: res.resumen,
          opcion: opcion === undefined ? undefined : { nombre: opcion.nombre, movimientos: opcion.movimientos },
          autoriaReversos: [reversoSueldo.id, reversoCorreccion.id].map((id) => porId.get(id)?.aQuien.nombre ?? null),
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("B1 (R58): la autoría dice CUÁNDO se registró la fila — día y hora de Costa Rica del created_at", () => {
    expect(m().registradoEl).toEqual({ fecha: "2026-09-26", hora: "21:30" });
  });

  it("B1 (R58): ese instante NO es la fecha del movimiento (el sueldo es del 1)", () => {
    expect(m().fechaMovimientoDelSueldo).toBe("2026-09-01T18:00:00.000Z");
    expect(m().registradoEl?.fecha).not.toBe("2026-09-01");
  });

  it("M2: con «A quién = Pedro» el libro trae cada anulado CON su contra-asiento", () => {
    const x = m();
    expect(x.libroTotal).toBe(4);
    expect([...x.libroIds].sort()).toEqual(
      [x.sueldoId, x.correccionId, x.reversoSueldoId, x.reversoCorreccionId].sort(),
    );
  });

  it("M2: las tarjetas de «Pedro» dan un efecto neto de 0,00 (antes: −₡100.250,00)", () => {
    const r = m().resumen;
    expect(r.entradas).toBe("100250.00");
    expect(r.salidas).toBe("100250.00");
    expect(r.enCaja).toBe("0.00");
    expect(r.ganancia).toBe("0.00");
  });

  it("M2: el selector cuenta las cuatro filas de «Pedro» (el mismo conjunto que el filtro)", () => {
    expect(m().opcion).toEqual({ nombre: PEDRO, movimientos: 4 });
  });

  it("M2: la columna «A quién» del contra-asiento dice el nombre de su original", () => {
    expect(m().autoriaReversos).toEqual([PEDRO, `  ${PEDRO} `]);
  });
});
