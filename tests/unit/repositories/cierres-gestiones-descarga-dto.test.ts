import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";

// Feature 230 — Tandas 2 y 7 (T2.1/T7.1, R22/R26/R27/R41/R42/R43/R44/R46/R47) — el DTO que el
// servidor emite para la hoja fundida.
//
// La declaración de columnas y la proyección a celdas son de otra tanda. Lo que se mide aquí es
// lo que el BORDE DE DATOS entrega, y son cuatro invariantes que no se cumplen «porque la
// columna no existe» sino porque el dato no sale del repositorio:
//
//   - **nada de evidencia** (R22/R41): ni la URL, ni el `storage_path`, ni un booleano derivado.
//     Se afirma sobre el DTO SERIALIZADO, que es lo que cruza la frontera;
//   - **ningún identificador interno** (R42): ni `gestionId`, ni `ordenId`, ni `cierreId`, ni
//     `mensajeroId`, ni `destinoZonaId`. El identificador de negocio de la fila es `numRemision`;
//   - **money-safe** (R43/R44): todo monto es el STRING del snapshot, escala 2, sin símbolo ni
//     separador. Ningún `number` en un campo de dinero;
//   - **`null` es `null`** (R46/R47): una indemnización sin capturar NO vale cero.
//
// Y una quinta, que es la mitigación exigida por el riesgo 4 del design: los DOS caminos
// producen la MISMA fila para la misma gestión (R26). Aquí se comprueba a grano de DTO, que es
// donde puede divergir sin que ninguna pantalla lo diga.

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const FILTROS: FiltrosDescargaGestiones = { mensajeroIds: ["m-1"] };

const dec = (v: string) => new Prisma.Decimal(v);

/** Una gestión `entregada` con recaudo desglosado, tal como la proyecta `GESTION_DESCARGA_SELECT`. */
function gestionEntregada(over: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    ordenId: "o-1",
    cierreId: "c-1",
    resultado: "entregada",
    montoRecibido: dec("15000.50"),
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    pagoMensajero: dec("1200.00"),
    ingresoBodegaRechazo: null,
    causaIncidente: null,
    // R47: sin capturar. `null`, jamás "0.00".
    indemnizacion: null,
    pagos: [{ metodo: "efectivo", monto: dec("15000.50") }],
    historialEstados: [],
    cierre: { solicitadoAt: new Date("2026-02-10T18:30:00.000Z"), mensajero: { nombre: "Ana" } },
    ...over,
  };
}

/** El snapshot congelado de esa orden, con su tarifa completa. */
function detalle(over: Record<string, unknown> = {}) {
  return {
    ordenId: "o-1",
    cierreId: "c-1",
    numGuia: 4021,
    numRemision: "REM-4021",
    destinatario: "Bea",
    direccion: "Calle 3",
    producto: "Caja",
    tiendaNombre: "Tienda A",
    zonaNombre: "Central",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    // R46: un dato nulo llega nulo, no como el guion de pantalla.
    distritoNombre: null,
    montoCobrar: dec("15000.50"),
    cobraComision: true,
    esCentral: true,
    tarifaId: "t-1",
    tarifaValorFlete: dec("2000.00"),
    tarifaValorFleteGam: dec("1800.00"),
    tarifaValorFleteDevuelto: dec("900.00"),
    tarifaValorFleteDevueltoGam: dec("800.00"),
    tarifaComisionCod: dec("3.00"),
    tarifaIvaFlete: dec("13.00"),
    tarifaIvaComisionCod: dec("13.00"),
    ...over,
  };
}

function prismaFalso(gestiones: unknown[], detalles: unknown[]) {
  return {
    gestionOrden: { findMany: vi.fn(async () => gestiones) },
    cierreDetail: { findMany: vi.fn(async () => detalles) },
  };
}

function repoAdmin(prisma: ReturnType<typeof prismaFalso>) {
  return new CierresAdminRepository(
    prisma as unknown as PrismaClient,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const repoBodega = (prisma: ReturnType<typeof prismaFalso>) =>
  new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

async function filaAdmin(gestiones: unknown[], detalles: unknown[]) {
  const filas = await repoAdmin(prismaFalso(gestiones, detalles)).findGestionesPorAlcanceCompleto(
    ALCANCE,
    FILTROS,
  );
  return filas[0]!;
}

describe("DTO de la hoja fundida (feature 230, T2.1/T7.1)", () => {
  it("lleva el mensajero y la fecha del cierre al que pertenece la gestión (R8/R11)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.mensajeroNombre).toBe("Ana");
    expect(fila.cierreSolicitadoAt).toBe("2026-02-10T18:30:00.000Z");
  });

  it("no emite NINGÚN campo de evidencia, ni siquiera derivado (R22/R41)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(JSON.stringify(fila).toLowerCase()).not.toContain("evidencia");
    expect(fila).not.toHaveProperty("evidenciaUrl");
    expect(fila).not.toHaveProperty("evidenciaStoragePath");
    expect(fila).not.toHaveProperty("tieneEvidencia");
  });

  it("no emite ningún identificador interno de registro (R42)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    for (const clave of ["gestionId", "ordenId", "cierreId", "mensajeroId", "destinoZonaId"]) {
      expect(fila).not.toHaveProperty(clave);
    }
    // El identificador de negocio de la fila SÍ está: sin él, las filas no se pueden auditar.
    expect(fila.numRemision).toBe("REM-4021");
  });

  it("los montos salen como el STRING del snapshot, escala 2, sin símbolo ni separador (R43)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.montoRecibido).toBe("15000.50");
    expect(fila.pagoMensajero).toBe("1200.00");
    expect(fila.pagos).toEqual([{ metodo: "efectivo", monto: "15000.50" }]);
    expect(fila.ingresoOrdenex?.montoCobrar).toBe("15000.50");

    // Ni un `number` en un campo de dinero: es lo que distingue «money-safe» de «hoy coincide».
    for (const v of [fila.montoRecibido, fila.pagoMensajero, fila.ingresoOrdenex?.total]) {
      expect(typeof v).toBe("string");
      expect(v).not.toMatch(/[₡$,]/);
    }
  });

  it("una indemnización sin capturar llega null y NUNCA cero (R47)", async () => {
    const fila = await filaAdmin(
      [gestionEntregada({ resultado: "incidente", causaIncidente: "perdida" })],
      [detalle()],
    );

    expect(fila.indemnizacion).toBeNull();
    expect(fila.indemnizacion).not.toBe("0.00");
  });

  it("un dato nulo llega nulo, nunca como el marcador de pantalla (R46)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.distritoNombre).toBeNull();
    expect(fila.motivo).toBeNull();
    expect(fila.fechaReprogramacion).toBeNull();
    expect(JSON.stringify(fila)).not.toContain("—");
  });

  it("empareja el snapshot por (cierre, orden) y no sólo por orden", async () => {
    // La MISMA orden en DOS cierres distintos: es lo que el índice único de `cierre_detail`
    // permite y lo que su propio comentario anuncia («trazar en qué cierres apareció una orden»).
    // Emparejando sólo por `orden_id`, las dos filas cogerían el mismo snapshot —y con él, los
    // mismos montos— y una de las dos sería falsa.
    const filas = await repoAdmin(
      prismaFalso(
        [
          gestionEntregada({ id: "g-1", cierreId: "c-1" }),
          gestionEntregada({ id: "g-2", cierreId: "c-2" }),
        ],
        [
          detalle({ cierreId: "c-1", numRemision: "REM-A", montoCobrar: dec("100.00") }),
          detalle({ cierreId: "c-2", numRemision: "REM-B", montoCobrar: dec("200.00") }),
        ],
      ),
    ).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);

    expect(filas.map((f) => f.numRemision)).toEqual(["REM-A", "REM-B"]);
    expect(filas.map((f) => f.ingresoOrdenex?.montoCobrar)).toEqual(["100.00", "200.00"]);
  });

  it("una gestión sin su fila congelada revienta duro, sin fallback a datos vivos", async () => {
    // Riesgo ACEPTADO y documentado (design §10.2): un cierre corrupto tumba la descarga entera.
    // Se conserva a propósito — un fallback mostraría valores de HOY disfrazados de congelados,
    // que es el camino de lectura que la feature 69 vino a matar.
    await expect(filaAdmin([gestionEntregada()], [])).rejects.toBeInstanceOf(
      CierreDetalleFaltanteError,
    );
  });

  it("los DOS caminos producen la MISMA fila para la misma gestión (R26)", async () => {
    const gestiones = [gestionEntregada()];
    const detalles = [detalle()];

    const porCierresDelDia = await repoAdmin(
      prismaFalso(gestiones, detalles),
    ).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);
    const porBodega = await repoBodega(
      prismaFalso(gestiones, detalles),
    ).findGestionesDeCierresBodegaCompleto(FILTROS);

    expect(porBodega).toEqual(porCierresDelDia);
  });

  it("una gestión de un cierre con destino bodega central sale por el camino A sin trato especial (R27)", async () => {
    // «GAM» es la zona `esCentral`, y sus cierres entran por el `destinoTipo` que el alcance ya
    // fija. Con `esCentral: true` en el snapshot, la fila sale por el camino de cierres del día
    // exactamente igual que cualquier otra: ni un `if` que la nombre.
    const fila = await filaAdmin([gestionEntregada()], [detalle({ esCentral: true })]);

    expect(fila.numRemision).toBe("REM-4021");
    expect(fila.ingresoOrdenex?.esCentral).toBe(true);
  });
});
