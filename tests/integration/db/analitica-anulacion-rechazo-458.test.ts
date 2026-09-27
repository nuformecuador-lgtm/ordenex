import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ConciliacionCierresAnaliticaRepository } from "@/lib/repositories/ConciliacionCierresAnaliticaRepository";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { RecaudoAnaliticaRepository } from "@/lib/repositories/RecaudoAnaliticaRepository";
import { AnaliticaFinancieraService } from "@/lib/services/AnaliticaFinancieraService";
import type { ImporteAnalitico } from "@/lib/types/analitica-financiera";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";
import {
  cargarCatalogo459,
  enTransaccionRevertida459,
  menos,
  montarServicios459,
  sembrarEscenario459,
} from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B — revision B2 (decision del leader, 2026-09-26): la ANULACION del cobro por rechazo
// DESCUENTA en /analitica. Contra Postgres, con el servicio REAL de la analitica financiera sobre
// los repositorios REALES y el cobro del escenario 459 (tienda A: flete 1 000,00 + IVA 130,00),
// anulado por el servicio real (`RechazoTiendaCobroService.anular`).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que se mide (las tres metricas en la misma ventana, que contiene la aprobacion y la anulacion):
//   · «Ingreso por flete» e «Ingreso por IVA» vuelven, en NETO, a su valor ANTES del cobro: tras la
//     anulacion valen lo mismo que antes menos 1 000,00 y 130,00 (literales escritos a mano).
//   · El BRUTO sube (volumen movido: el cobro y su reverso son dos movimientos), como en `egresos`.
//   · «Ganancia de Ordenex» baja 1 130,00 = lo que bajan flete + IVA: la ganancia cuadra.
//
// Sin la B2 (el reverso fuera de la definicion) el neto de flete e IVA no se movia y la ganancia
// si: la mutacion de la bitacora quita el reverso del catalogo y este test cae.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** La ventana: contiene la aprobacion (2026-09-24, reloj del escenario) y la anulacion (abajo). */
const VENTANA = { rango: "personalizado" as const, desde: "2026-01-01", hasta: "2026-12-31" };
/** Reloj de la anulacion, dentro de la ventana y despues de la aprobacion. */
const AHORA_ANULACION = new Date("2026-09-25T18:00:00.000Z");

interface Cifra {
  bruto: string;
  neto: string;
}

interface Lectura {
  flete: Cifra;
  iva: Cifra;
  ganancia: Cifra;
}

interface Medida {
  trasCobro: Lectura;
  trasAnulacion: Lectura;
  respuesta: string;
  lineasDelCobro: string[];
}

function cifra(importe: ImporteAnalitico, contexto: string): Cifra {
  if (importe.forma !== "bruto_y_neto") {
    throw new Error(`${contexto}: se esperaba forma "bruto_y_neto" y llego "${importe.forma}"`);
  }
  return { bruto: importe.bruto, neto: importe.neto };
}

describeSiHayBase("⭑ 458-B/B2 — la anulacion del cobro por rechazo descuenta en /analitica (Postgres real)", () => {
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
      medida = await enTransaccionRevertida459(prisma, async (tx) => medir(tx, cat));
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function medir(tx: TxDeTest, cat: Awaited<ReturnType<typeof cargarCatalogo459>>): Promise<Medida> {
    const s = montarServicios459(tx);
    const esc = await sembrarEscenario459(tx, cat);
    const actor: Actor = esc.maestro;
    const analitica = new AnaliticaFinancieraService(
      new IngresosAnaliticaRepository(s.cliente),
      new RecaudoAnaliticaRepository(s.cliente),
      new CuentasPorPagarAnaliticaRepository(s.cliente),
      new ConciliacionCierresAnaliticaRepository(s.cliente),
      { logError: () => {} },
    );
    const leerMetrica = async (id: string): Promise<Cifra> => {
      const r = await consultarMetricaFinanciera(id, VENTANA, {
        service: analitica,
        getActor: async () => actor,
        logger: { logError: () => {} },
      });
      if (r.status !== "ok" || r.datos.tipo !== "vistas") {
        throw new Error(`${id}: la analitica no respondio vistas: ${JSON.stringify(r)}`);
      }
      return cifra(r.datos.vistas[0].total, id);
    };
    const leer = async (): Promise<Lectura> => ({
      flete: await leerMetrica("ingreso_flete"),
      iva: await leerMetrica("ingreso_iva"),
      ganancia: await leerMetrica("ganancia_ordenex"),
    });

    const cobro = await tx.rechazoTiendaCobro.findFirstOrThrow({
      where: { tiendaId: esc.tiendaA, estado: "aprobado" },
      select: { id: true, gestionId: true },
    });
    const lineasDelCobro = (
      await tx.walletMovimiento.findMany({
        where: { origenTipo: "gestion_orden", origenId: cobro.gestionId },
        select: { categoria: true, monto: true },
      })
    )
      .map((f) => `${f.categoria}|${f.monto.toFixed(2)}`)
      .sort();

    const trasCobro = await leer();
    const r = await s.rechazoCobro.anular(
      { cobroId: cobro.id, motivo: "Se cobró por un rechazo que no fue" },
      actor,
      AHORA_ANULACION,
    );
    const trasAnulacion = await leer();
    return { trasCobro, trasAnulacion, respuesta: r.status, lineasDelCobro };
  }

  it("el cobro de la tienda A es el de 1 000,00 + 130,00 y la anulacion responde ok", () => {
    expect(m().lineasDelCobro).toEqual([
      "ingreso_flete_devolucion|1000.00",
      "ingreso_iva_flete_devolucion|130.00",
    ]);
    expect(m().respuesta).toBe("ok");
  });

  it("«Ingreso por flete»: el neto vuelve al de ANTES del cobro (−1 000,00) y el bruto sube 1 000,00", () => {
    const { trasCobro, trasAnulacion } = m();
    const antesDelCobro = menos(trasCobro.flete.neto, "1000.00");
    expect(trasAnulacion.flete.neto).toBe(antesDelCobro);
    expect(menos(trasAnulacion.flete.bruto, trasCobro.flete.bruto)).toBe("1000.00");
  });

  it("«Ingreso por IVA»: el neto vuelve al de ANTES del cobro (−130,00) y el bruto sube 130,00", () => {
    const { trasCobro, trasAnulacion } = m();
    const antesDelCobro = menos(trasCobro.iva.neto, "130.00");
    expect(trasAnulacion.iva.neto).toBe(antesDelCobro);
    expect(menos(trasAnulacion.iva.bruto, trasCobro.iva.bruto)).toBe("130.00");
  });

  it("la ganancia cuadra: baja 1 130,00, exactamente lo que bajan flete + IVA", () => {
    const { trasCobro, trasAnulacion } = m();
    const bajaGanancia = menos(trasCobro.ganancia.neto, trasAnulacion.ganancia.neto);
    expect(bajaGanancia).toBe("1130.00");
    const bajaFlete = menos(trasCobro.flete.neto, trasAnulacion.flete.neto);
    const bajaIva = menos(trasCobro.iva.neto, trasAnulacion.iva.neto);
    expect(menos(bajaGanancia, bajaFlete)).toBe(bajaIva);
  });
});
