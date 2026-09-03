import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

// Pedido humano (2026-08-19) — la TRANSACCIÓN de la corrección del desglose, ahí donde de
// verdad vive: en el WHERE de cada escritura.
//
// Este archivo existe por la misma lección que `satelite-paginado-where.test.ts`: los tests de
// servicio usan un DOBLE del repositorio, así que prueban que el servicio pase el alcance
// correcto, jamás que ese alcance se traduzca en una guardia. Y aquí la guardia ES la feature:
// entre la lectura que autoriza y la escritura que reparte el dinero cabe una aprobación de
// otro admin, y sin el `updateMany` guardado esa corrección se aplicaría sobre un cierre ya
// liquidado sin que nada fallara.

const ALCANCE_TOTAL: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const ALCANCE_SATELITE: Alcance = { destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" };
const GESTION = "g-1";
const CIERRE = "c-1";

/** Las gestiones que el recálculo lee del cierre: dos entregas y una devolución. */
const GESTIONES_DEL_CIERRE = [
  {
    resultado: "entregada",
    pagos: [
      { metodo: "efectivo", monto: new Prisma.Decimal("6000") },
      { metodo: "SINPE", monto: new Prisma.Decimal("4000") },
    ],
  },
  {
    resultado: "entregada",
    pagos: [{ metodo: "transferencia", monto: new Prisma.Decimal("2500.50") }],
  },
  // Una devolución no aporta a ningún balde (R8/R25): si aportara, el total del cierre
  // crecería con dinero que nadie cobró.
  { resultado: "devuelta", pagos: [] },
];

function clienteFalso(
  opciones: {
    selloCount?: number;
    existe?: number;
    cierreCount?: number;
  } = {},
) {
  const { selloCount = 1, existe = 1, cierreCount = 1 } = opciones;
  const llamadas: { modelo: string; metodo: string; args: Record<string, unknown> }[] = [];
  const registrar = (modelo: string, metodo: string) => (args: Record<string, unknown>) => {
    llamadas.push({ modelo, metodo, args });
    return args;
  };

  const tx = {
    gestionOrden: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrden", "updateMany")(args);
        return { count: selloCount };
      }),
      count: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrden", "count")(args);
        return existe;
      }),
      findUnique: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrden", "findUnique")(args);
        // FICHA 362: el segundo `findUnique` pide la guia de la orden para la etiqueta congelada.
        return { cierreId: CIERRE, orden: { numGuia: 100234, numRemision: "REM-1" } };
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrden", "findMany")(args);
        return GESTIONES_DEL_CIERRE;
      }),
    },
    gestionOrdenPago: {
      deleteMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrdenPago", "deleteMany")(args);
        return { count: 1 };
      }),
      createMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrdenPago", "createMany")(args);
        return { count: 1 };
      }),
    },
    cierreDia: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("cierreDia", "updateMany")(args);
        return { count: cierreCount };
      }),
    },
    // FICHA 362: el registro de `cierre_dia_pagos_editados`, en la MISMA tx que la correccion.
    // Entra al registrador de llamadas para que el orden siga siendo afirmable.
    historialAccion: {
      createMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("historialAccion", "createMany")(args);
        return { count: 1 };
      }),
    },
    usuario: {
      findUnique: vi.fn(async () => ({
        nombre: "Admin",
        primerApellido: "Uno",
        rol: { value: "admin" },
      })),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaClient;

  // Los SIETE colaboradores de wallet/liquidación del constructor van vacíos A PROPÓSITO: la
  // corrección del desglose no mueve la wallet ni paga a nadie —solo re-reparte lo ya cobrado—,
  // así que si algún día los tocara, estos casos reventarían en vez de pasar en silencio.
  const sinUsar = {} as never;
  const repo = new CierresAdminRepository(
    prisma,
    sinUsar,
    sinUsar,
    sinUsar,
    sinUsar,
    sinUsar,
    sinUsar,
    sinUsar,
  );
  return { repo, tx, llamadas };
}

const LINEAS = [
  { metodo: "efectivo" as const, monto: "6000" },
  { metodo: "SINPE" as const, monto: "4000" },
];

async function corregir(
  repo: CierresAdminRepository,
  alcance: Alcance = ALCANCE_TOTAL,
) {
  return repo.actualizarPagosGestion({
    gestionId: GESTION,
    alcance,
    editadoPor: "adm",
    lineas: LINEAS,
  });
}

describe("CierresAdminRepository.actualizarPagosGestion — las guardias", () => {
  it("sella el rastro con el estado del cierre, el alcance y la gestión en el WHERE", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    const where = tx.gestionOrden.updateMany.mock.calls[0]![0]!.where as Record<
      string,
      unknown
    >;
    expect(where.id).toBe(GESTION);
    // Una gestión ANULADA no se corrige, y solo una ENTREGA tiene desglose.
    expect(where.anuladaAt).toBeNull();
    expect(where.resultado).toBe("entregada");
    // El estado y el alcance van DENTRO de la relación con el cierre: es donde viven.
    expect(where.cierre).toEqual({
      is: { estado: { in: ["solicitado", "vencido"] }, destinoTipo: "bodega_central" },
    });

    // Y el rastro es lo que se escribe: quién y cuándo.
    const data = tx.gestionOrden.updateMany.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.pagosEditadosPor).toBe("adm");
    expect(data.pagosEditadosAt).toBeInstanceOf(Date);
  });

  it("el alcance del adminSatelite acota por SU zona", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo, ALCANCE_SATELITE);

    const where = tx.gestionOrden.updateMany.mock.calls[0]![0]!.where as Record<
      string,
      unknown
    >;
    expect(where.cierre).toEqual({
      is: {
        estado: { in: ["solicitado", "vencido"] },
        destinoTipo: "bodega_satelite",
        destinoZonaId: "z-sat",
      },
    });
  });

  it("si el sello no aplica NO se toca ni una línea ni el cierre", async () => {
    // `count: 0` = el cierre dejó de estar abierto (o la gestión dejó de ser corregible) entre
    // la lectura y la escritura. Es la carrera que esta guardia existe para perder.
    const { repo, tx } = clienteFalso({ selloCount: 0 });
    const r = await corregir(repo);

    expect(r.status).toBe("conflict");
    expect(tx.gestionOrdenPago.deleteMany).not.toHaveBeenCalled();
    expect(tx.gestionOrdenPago.createMany).not.toHaveBeenCalled();
    expect(tx.cierreDia.updateMany).not.toHaveBeenCalled();
  });

  it("una gestión que no existe se distingue de una que ya no es corregible", async () => {
    const { repo } = clienteFalso({ selloCount: 0, existe: 0 });
    expect((await corregir(repo)).status).toBe("fuera_de_alcance");
  });
});

describe("CierresAdminRepository.actualizarPagosGestion — lo que escribe", () => {
  it("sustituye el desglose ENTERO: borra y vuelve a insertar", async () => {
    const { repo, tx, llamadas } = clienteFalso();
    await corregir(repo);

    expect(tx.gestionOrdenPago.deleteMany).toHaveBeenCalledWith({
      where: { gestionId: GESTION },
    });
    const data = tx.gestionOrdenPago.createMany.mock.calls[0]![0]!.data as {
      gestionId: string;
      metodo: string;
      monto: Prisma.Decimal;
    }[];
    expect(data.map((l) => l.metodo)).toEqual(["efectivo", "SINPE"]);
    // Money-safe: el STRING se convierte a Decimal AL ESCRIBIR, nunca antes y nunca a `number`.
    expect(data.every((l) => l.monto instanceof Prisma.Decimal)).toBe(true);
    expect(data[0]!.monto.toFixed(2)).toBe("6000.00");

    // El borrado va ANTES del insert: al revés, el `@@unique(gestion_id, metodo)` reventaría
    // sobre el método que se conserva.
    const orden = llamadas.map((l) => `${l.modelo}.${l.metodo}`);
    expect(orden.indexOf("gestionOrdenPago.deleteMany")).toBeLessThan(
      orden.indexOf("gestionOrdenPago.createMany"),
    );
  });

  it("recalcula los totales del cierre sobre SUS gestiones, con el mismo reparto por método", async () => {
    const { repo, tx } = clienteFalso();
    const r = await corregir(repo);

    // El conjunto del recálculo: las gestiones de ESE cierre, sin las anuladas.
    expect(tx.gestionOrden.findMany.mock.calls[0]![0]!.where).toEqual({
      cierreId: CIERRE,
      anuladaAt: null,
    });

    // 6.000 efectivo + 4.000 SINPE + 2.500,50 transferencia; la devolución no aporta.
    const data = tx.cierreDia.updateMany.mock.calls[0]![0]!.data as Record<
      string,
      Prisma.Decimal
    >;
    expect(data.totalEfectivo.toFixed(2)).toBe("6000.00");
    expect(data.totalSimpe.toFixed(2)).toBe("4000.00");
    expect(data.totalTransferencia.toFixed(2)).toBe("2500.50");
    expect(data.totalGeneral.toFixed(2)).toBe("12500.50");

    expect(r.status).toBe("updated");
    if (r.status === "updated") expect(r.totales.general).toBe("12500.50");
  });

  it("el snapshot se escribe con la MISMA guardia de estado y alcance", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    expect(tx.cierreDia.updateMany.mock.calls[0]![0]!.where).toEqual({
      id: CIERRE,
      estado: { in: ["solicitado", "vencido"] },
      destinoTipo: "bodega_central",
    });
  });

  it("si el snapshot no se actualiza, la transacción entera se revierte", async () => {
    // Sin esto, las líneas quedarían corregidas y los totales del cierre diciendo otra cosa:
    // exactamente la divergencia que esta feature no puede permitir.
    const { repo } = clienteFalso({ cierreCount: 0 });
    await expect(corregir(repo)).rejects.toThrow();
  });

  it("todo ocurre en UNA transacción", async () => {
    const { repo } = clienteFalso();
    const prismaMock = vi.mocked(
      (repo as unknown as { prisma: { $transaction: ReturnType<typeof vi.fn> } }).prisma
        .$transaction,
    );
    await corregir(repo);
    expect(prismaMock).toHaveBeenCalledTimes(1);
  });
});
