import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

// 💰 FICHA 398 — LA TRANSACCION DE LA CORRECCION EN SITIO, ahí donde de verdad vive: en el WHERE
// de cada escritura y en el ORDEN de los pasos.
//
// POR QUE EXISTE SI YA HAY UN TEST CONTRA POSTGRES. Porque hay guardias que Postgres no puede
// enseñar desde una sola conexion: la del PASO 5 (`estado IN (abiertos)` al escribir el snapshot)
// solo se ejercita si el cierre cambia de estado ENTRE el sello y el snapshot, y dentro de una
// misma transaccion eso no puede pasar. MEDIDO el 2026-09-08: quitar esa condicion no ponia rojo
// ningun test de integracion. Aqui se afirma sobre la FORMA del `where`, que es lo unico que la
// puede sostener. Es el mismo motivo y el mismo patron que
// `cierres-admin-corregir-pagos-where.test.ts`.
//
// Los dos archivos son complementarios y ninguno sustituye al otro: aquel prueba QUE FILAS SE
// TOCAN contra la base; este, QUE CONDICION LLEVA CADA ESCRITURA.

const ALCANCE_TOTAL: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const ALCANCE_SATELITE: Alcance = { destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" };
const GESTION = "g-1";
const CIERRE = "c-1";
const ORDEN = "o-1";
const ESTATUS_ENTREGADA = "os-entregada";
const ESTATUS_RECHAZADA = "os-rechazada";
const MOTIVO = "el cliente lo rechazo";

/** Las gestiones que el recalculo lee del cierre, con sus snapshots YA congelados. */
const GESTIONES_DEL_CIERRE = [
  {
    resultado: "rechazada",
    pagoMensajero: new Prisma.Decimal("0.00"),
    ingresoBodegaRechazo: new Prisma.Decimal("1000.00"),
    pagos: [],
  },
  {
    resultado: "entregada",
    // ⚠️ Congelado con OTRA tarifa. Si el recalculo re-derivara con la viva, este numero cambiaria.
    pagoMensajero: new Prisma.Decimal("900.00"),
    ingresoBodegaRechazo: new Prisma.Decimal("0.00"),
    pagos: [
      { metodo: "efectivo", monto: new Prisma.Decimal("6000") },
      { metodo: "SINPE", monto: new Prisma.Decimal("4000") },
    ],
  },
];

function clienteFalso(
  opciones: { selloCount?: number; existe?: number; cierreCount?: number; ordenCount?: number } = {},
) {
  const { selloCount = 1, existe = 1, cierreCount = 1, ordenCount = 1 } = opciones;
  const llamadas: { modelo: string; metodo: string; args: Record<string, unknown> }[] = [];
  const registrar = (modelo: string, metodo: string) => (args: Record<string, unknown>) => {
    llamadas.push({ modelo, metodo, args });
  };

  const tx = {
    gestionOrden: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrden", "findFirst")(args);
        return {
          cierreId: CIERRE,
          orden: { id: ORDEN, numGuia: 100234, numRemision: "REM-1" },
          cierre: { destinoZonaId: "z-1", mensajero: { vehiculoId: "v-1" } },
        };
      }),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrden", "updateMany")(args);
        return { count: selloCount };
      }),
      count: vi.fn(async (args: Record<string, unknown>) => {
        registrar("gestionOrden", "count")(args);
        return existe;
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
    },
    tarifaZonaMensajero: {
      findUnique: vi.fn(async (args: Record<string, unknown>) => {
        registrar("tarifaZonaMensajero", "findUnique")(args);
        return {
          cobroEntregado: new Prisma.Decimal("1500"),
          cobroRechazado: new Prisma.Decimal("1000"),
        };
      }),
      findFirst: vi.fn(async () => null),
    },
    orden: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("orden", "updateMany")(args);
        return { count: ordenCount };
      }),
    },
    cierreDia: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("cierreDia", "updateMany")(args);
        return { count: cierreCount };
      }),
    },
    // El choke point del historial de estados valida contra el catalogo con `$queryRaw` y
    // despues escribe. Se sirven las DOS filas que necesita.
    $queryRaw: vi.fn(async () => [
      { id: ESTATUS_ENTREGADA, value: "entregada" },
      { id: ESTATUS_RECHAZADA, value: "rechazada" },
    ]),
    $executeRaw: vi.fn(async () => 0),
    $queryRawUnsafe: vi.fn(async () => []),
    $executeRawUnsafe: vi.fn(async () => 0),
    ordenHistorialEstado: {
      createMany: vi.fn(async (args: Record<string, unknown>) => {
        registrar("ordenHistorialEstado", "createMany")(args);
        return { count: 1 };
      }),
    },
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
    // El emisor de webhooks y el de notificaciones del choke point leen estos delegados; con la
    // familia de esta ficha no emiten nada, y los stubs estan para que no revienten si lo hicieran.
    webhookSuscripcion: { findMany: vi.fn(async () => []) },
    notificacion: { createMany: vi.fn(async () => ({ count: 0 })) },
    job: { createMany: vi.fn(async () => ({ count: 0 })) },
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaClient;

  // Los SIETE colaboradores de wallet/liquidacion van vacios A PROPOSITO: la correccion NO mueve
  // la wallet ni paga a nadie, asi que si algun dia los tocara estos casos reventarian en vez de
  // pasar en silencio.
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

async function corregir(repo: CierresAdminRepository, alcance: Alcance = ALCANCE_TOTAL) {
  return repo.corregirResultadoGestionEnCierre({
    gestionId: GESTION,
    alcance,
    motivo: MOTIVO,
    corregidoPor: "adm",
    estatusEntregadaId: ESTATUS_ENTREGADA,
    estatusRechazadaId: ESTATUS_RECHAZADA,
  });
}

const whereDe = (mock: { mock: { calls: unknown[][] } }, i = 0) =>
  (mock.mock.calls[i]![0] as { where: Record<string, unknown> }).where;
const dataDe = (mock: { mock: { calls: unknown[][] } }, i = 0) =>
  (mock.mock.calls[i]![0] as { data: Record<string, unknown> }).data;

describe("💰 398 — el SELLO es la unica guardia que decide", () => {
  it("el `WHERE` del sello lleva las CUATRO condiciones, y el alcance dentro del cierre", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    const where = whereDe(tx.gestionOrden.updateMany);
    expect(where.id).toBe(GESTION);
    expect(where.anuladaAt).toBeNull(); // una gestion ANULADA no se corrige
    expect(where.resultado).toBe("entregada"); // ⭑ solo una ENTREGA se corrige a rechazo
    expect(where.cierre).toEqual({
      is: { estado: { in: ["solicitado", "vencido"] }, destinoTipo: "bodega_central" },
    });
  });

  it("⭑ la LECTURA PREVIA no repite ninguna de esas condiciones: solo el alcance", async () => {
    // Es lo que hace que el `WHERE` del sello sea vigilable. Si la lectura filtrara por
    // `resultado` o por estado, decidiria ella y una mutacion del sello no cambiaria nada.
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    const where = whereDe(tx.gestionOrden.findFirst);
    expect(where.id).toBe(GESTION);
    expect(where.resultado).toBeUndefined();
    expect(where.anuladaAt).toBeUndefined();
    expect(where.cierre).toEqual({ is: { destinoTipo: "bodega_central" } });
  });

  it("el alcance del adminSatelite acota por SU zona, en el sello y en el snapshot", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo, ALCANCE_SATELITE);

    expect(whereDe(tx.gestionOrden.updateMany).cierre).toEqual({
      is: {
        estado: { in: ["solicitado", "vencido"] },
        destinoTipo: "bodega_satelite",
        destinoZonaId: "z-sat",
      },
    });
    expect(whereDe(tx.cierreDia.updateMany)).toEqual({
      id: CIERRE,
      estado: { in: ["solicitado", "vencido"] },
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-sat",
    });
  });

  it("💰 el `WHERE` del SNAPSHOT lleva el estado y el alcance, no solo el id", async () => {
    // ⚠️ ES LA GUARDIA QUE POSTGRES NO PUEDE ENSEÑAR desde una sola conexion (ver la cabecera).
    // Sin ella, una aprobacion concurrente entre el sello y esta escritura dejaria el snapshot de
    // un cierre YA LIQUIDADO reescrito.
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    expect(whereDe(tx.cierreDia.updateMany)).toEqual({
      id: CIERRE,
      estado: { in: ["solicitado", "vencido"] },
      destinoTipo: "bodega_central",
    });
  });

  it("💰 el `WHERE` de la ORDEN lleva su estatus de ORIGEN y el soft-delete", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    expect(whereDe(tx.orden.updateMany)).toEqual({
      id: ORDEN,
      estatusId: ESTATUS_ENTREGADA,
      deletedAt: null,
    });
    expect(dataDe(tx.orden.updateMany)).toEqual({ estatusId: ESTATUS_RECHAZADA });
  });

  it("si el sello no aplica, NO se toca nada mas: ni lineas, ni orden, ni snapshot, ni rastro", async () => {
    const { repo, tx } = clienteFalso({ selloCount: 0 });
    const r = await corregir(repo);

    expect(r.status).toBe("conflict");
    expect(tx.gestionOrdenPago.deleteMany).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.cierreDia.updateMany).not.toHaveBeenCalled();
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("una gestion que no existe se distingue de una que ya no es corregible", async () => {
    const { repo } = clienteFalso({ selloCount: 0, existe: 0 });
    expect((await corregir(repo)).status).toBe("fuera_de_alcance");
  });

  it("si la ORDEN no transiciona, LANZA (y la transaccion revierte)", async () => {
    const { repo } = clienteFalso({ ordenCount: 0 });
    await expect(corregir(repo)).rejects.toThrow(/orden no transicionada/);
  });

  it("si el SNAPSHOT no se actualiza, LANZA (y la transaccion revierte)", async () => {
    const { repo } = clienteFalso({ cierreCount: 0 });
    await expect(corregir(repo)).rejects.toThrow(/cierre no actualizado/);
  });
});

describe("💰 398 — lo que la correccion escribe, y con que aritmetica", () => {
  it("la gestion queda rechazada, sin cobro, con pago 0.00 e ingreso por tarifa", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    const data = dataDe(tx.gestionOrden.updateMany);
    expect(data.resultado).toBe("rechazada");
    expect(data.motivo).toBe(MOTIVO);
    expect(data.montoRecibido).toBeNull();
    expect(data.metodoPago).toBeNull();
    // Money-safe: `Decimal`, nunca `number`.
    expect(data.pagoMensajero).toBeInstanceOf(Prisma.Decimal);
    expect((data.pagoMensajero as Prisma.Decimal).toFixed(2)).toBe("0.00");
    expect((data.ingresoBodegaRechazo as Prisma.Decimal).toFixed(2)).toBe("1000.00");
  });

  it("la tarifa se resuelve con la zona CONGELADA del cierre y el vehiculo del mensajero", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    expect(tx.tarifaZonaMensajero.findUnique).toHaveBeenCalledWith({
      where: { zonaId_vehiculoId: { zonaId: "z-1", vehiculoId: "v-1" } },
      select: { cobroEntregado: true, cobroRechazado: true },
    });
  });

  it("el desglose del cobro que no hubo se BORRA entero", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);
    expect(tx.gestionOrdenPago.deleteMany).toHaveBeenCalledWith({ where: { gestionId: GESTION } });
  });

  it("💰 los SEIS totales: los cuatro con `computeTotales`, los dos por gestion SUMANDO snapshots", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    // El conjunto del recalculo: las gestiones de ESE cierre, sin las anuladas.
    expect(whereDe(tx.gestionOrden.findMany)).toEqual({ cierreId: CIERRE, anuladaAt: null });

    const data = dataDe(tx.cierreDia.updateMany);
    const dec = (k: string) => (data[k] as Prisma.Decimal).toFixed(2);
    expect(dec("totalEfectivo")).toBe("6000.00");
    expect(dec("totalSimpe")).toBe("4000.00");
    expect(dec("totalTransferencia")).toBe("0.00");
    expect(dec("totalGeneral")).toBe("10000.00");
    // ⭑ 0.00 + 900.00 = 900.00, LA SUMA DE LOS SNAPSHOTS. Si esto re-derivara con la tarifa viva
    // (1.500 por entrega) daria 1500.00 y le habria movido el pago a una gestion ajena.
    expect(dec("totalPagoMensajero")).toBe("900.00");
    expect(dec("totalIngresoBodegaRechazos")).toBe("1000.00");
    // Money-safe: los seis son `Decimal`.
    for (const clave of Object.keys(data)) {
      expect(data[clave], clave).toBeInstanceOf(Prisma.Decimal);
    }
  });

  it("el historial de estados se escribe por el choke point, con la familia propia", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    const filas = (tx.ordenHistorialEstado.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    }).data;
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      ordenId: ORDEN,
      estatusOrigenId: ESTATUS_ENTREGADA,
      estatusDestinoId: ESTATUS_RECHAZADA,
      origenTipo: "correccion_resultado_gestion",
      actorUsuarioId: "adm",
      gestionOrdenId: GESTION,
      motivo: MOTIVO,
    });
  });

  it("el rastro lleva el total NUEVO, el par de resultados y NUNCA el motivo", async () => {
    const { repo, tx } = clienteFalso();
    await corregir(repo);

    const filas = (tx.historialAccion.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    }).data;
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      accion: "cierre_dia_gestion_corregida",
      entidadTipo: "gestion_orden",
      entidadId: GESTION,
      valorAnterior: "entregada",
      valorNuevo: "rechazada",
      actorNombre: "Admin Uno",
      actorRol: "admin",
    });
    expect((filas[0]!.monto as Prisma.Decimal).toFixed(2)).toBe("10000.00");
    // 362/R5: el texto libre NO entra en esta tabla.
    expect(JSON.stringify(filas[0])).not.toContain(MOTIVO);
  });

  it("EL ORDEN de los pasos: sello -> lineas -> orden -> historial -> snapshot -> rastro", async () => {
    const { repo, llamadas } = clienteFalso();
    await corregir(repo);

    const orden = llamadas.map((l) => `${l.modelo}.${l.metodo}`);
    const pos = (clave: string) => orden.indexOf(clave);
    expect(pos("gestionOrden.updateMany")).toBeGreaterThanOrEqual(0);
    expect(pos("gestionOrden.updateMany")).toBeLessThan(pos("gestionOrdenPago.deleteMany"));
    expect(pos("gestionOrdenPago.deleteMany")).toBeLessThan(pos("orden.updateMany"));
    expect(pos("orden.updateMany")).toBeLessThan(pos("ordenHistorialEstado.createMany"));
    expect(pos("ordenHistorialEstado.createMany")).toBeLessThan(pos("cierreDia.updateMany"));
    // El rastro va EL ULTIMO: si algo de arriba no se aplico, no llega a escribirse.
    expect(pos("cierreDia.updateMany")).toBeLessThan(pos("historialAccion.createMany"));
  });
});
