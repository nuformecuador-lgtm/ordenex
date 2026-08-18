import { describe, it, expect, vi } from "vitest";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import { descargaConfig } from "@/lib/config/descarga";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";

// Feature 230 — Tanda 7 (T7.2, R13/R21/R22/R24/R25/R26) — el CONJUNTO de gestiones del que sale
// la hoja fundida de «Cierres de bodega».
//
// El acotamiento de esta pantalla NO es rol + zona, es ACCESO TOTAL, y por eso el guard es
// `esAccesoTotal` y no hay `sinZona` que resolver. Lo que se mide es que el guard corre ANTES
// del repositorio (R25): un `forbidden` que llegara DESPUÉS de la consulta ya habría leído el
// dinero de todas las bodegas antes de decidir que no debía.
//
// Este listado y el de «cierres del día» cubren conjuntos DISJUNTOS (design §2.6): aquí están
// las gestiones de las bodegas SATÉLITE ya consolidadas, allí las de la GAM. Por eso los dos
// bordes existen, y por eso ninguno de los dos puede sustituir al otro.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

const ROLES_SIN_ACCESO_TOTAL: Actor[] = [
  { usuarioId: "s1", rol: "adminSatelite" }, // el que más importa: entra al módulo vecino, no a éste
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
];

const FILTROS: FiltrosDescargaGestiones = { mensajeroIds: ["m-1"] };

function dto(numRemision: string): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana",
    cierreSolicitadoAt: "2026-02-10T12:00:00.000Z",
    numGuia: null,
    numRemision,
    destinatario: "Bea",
    direccion: null,
    zonaNombre: "Satélite",
    provinciaNombre: "Provincia",
    cantonNombre: "Cantón",
    distritoNombre: null,
    producto: "Caja",
    tiendaNombre: "Tienda",
    resultado: "entregada",
    montoRecibido: "100.00",
    pagos: [{ metodo: "efectivo", monto: "100.00" }],
    motivo: null,
    fechaReprogramacion: null,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    pagoMensajero: "10.00",
    ingresoBodegaRechazo: null,
    ingresoOrdenex: null,
  };
}

function fakeRepo(filas: CierreGestionDescargaDTO[] = [dto("SAT-1"), dto("SAT-2")]) {
  const findGestionesDeCierresBodegaCompleto = vi.fn(async () => filas);
  return {
    findCierresBodega: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreBodegaConDetalle: vi.fn(async () => null),
    findGestionesDeCierresBodegaCompleto,
    resolverCierreBodega: vi.fn(async () => "updated" as const),
  } as unknown as ICierresBodegaAdminRepository & {
    findGestionesDeCierresBodegaCompleto: typeof findGestionesDeCierresBodegaCompleto;
  };
}

function newService(repo: ReturnType<typeof fakeRepo>) {
  const createSignedUrls = vi.fn(async () => []);
  const service = new CierresBodegaAdminService(
    repo,
    { createSignedUrls } as unknown as ISignedUrlProvider,
  );
  return { service, createSignedUrls };
}

describe("conjunto de gestiones de «Cierres de bodega» (feature 230, T7.2)", () => {
  it("devuelve las gestiones que el repositorio acota a lo ya consolidado (R24)", async () => {
    const repo = fakeRepo();

    const r = await newService(repo).service.listarGestionesCierresBodegaCompleto(MAESTRO, FILTROS);

    expect(r).toEqual({
      status: "ok",
      items: [dto("SAT-1"), dto("SAT-2")],
      total: 2,
    });
  });

  it("pasa los recortes del diálogo TAL CUAL, sin añadir ni quitar claves (R15/R36)", async () => {
    const repo = fakeRepo();

    await newService(repo).service.listarGestionesCierresBodegaCompleto(MAESTRO, {
      mensajeroIds: ["m-1", "m-2"],
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });

    expect(repo.findGestionesDeCierresBodegaCompleto).toHaveBeenCalledWith({
      mensajeroIds: ["m-1", "m-2"],
      desde: "2026-02-01",
      hasta: "2026-02-28",
    });
  });

  it.each(ROLES_SIN_ACCESO_TOTAL)(
    "un rol sin acceso total recibe forbidden antes de tocar el repositorio (R25): $rol",
    async (actor) => {
      const repo = fakeRepo();

      const r = await newService(repo).service.listarGestionesCierresBodegaCompleto(actor, FILTROS);

      expect(r).toEqual({ status: "forbidden" });
      expect(repo.findGestionesDeCierresBodegaCompleto).not.toHaveBeenCalled();
    },
  );

  it("el ADMIN de acceso total sí entra (el guard es `esAccesoTotal`, no el literal «maestro»)", async () => {
    const r = await newService(fakeRepo()).service.listarGestionesCierresBodegaCompleto(
      ADMIN,
      FILTROS,
    );
    expect(r.status).toBe("ok");
  });

  it("superar el tope devuelve limite_excedido con conteos y sin filas (R21)", async () => {
    const exceso = descargaConfig.MAX_FILAS + 1;
    const filas = Array.from({ length: exceso }, (_, i) => dto(`SAT-${i}`));

    const r = await newService(fakeRepo(filas)).service.listarGestionesCierresBodegaCompleto(
      MAESTRO,
      FILTROS,
    );

    expect(r).toEqual({
      status: "limite_excedido",
      total: exceso,
      limite: descargaConfig.MAX_FILAS,
    });
    expect(r).not.toHaveProperty("items");
  });

  it("un conjunto vacío es `ok` con cero filas, no un error (R38)", async () => {
    const r = await newService(fakeRepo([])).service.listarGestionesCierresBodegaCompleto(
      MAESTRO,
      FILTROS,
    );
    expect(r).toEqual({ status: "ok", items: [], total: 0 });
  });

  it("no se firma ninguna URL de evidencia al producir el conjunto (R22)", async () => {
    const { service, createSignedUrls } = newService(fakeRepo());

    await service.listarGestionesCierresBodegaCompleto(MAESTRO, FILTROS);

    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("ninguna fila del conjunto lleva campos de evidencia ni identificadores internos (R41/R42)", async () => {
    const r = await newService(fakeRepo()).service.listarGestionesCierresBodegaCompleto(
      MAESTRO,
      FILTROS,
    );

    expect(r.status).toBe("ok");
    const serializado = JSON.stringify(r.status === "ok" ? r.items : []).toLowerCase();
    expect(serializado).not.toContain("evidencia");
    for (const clave of ["gestionid", "ordenid", "cierreid", "mensajeroid"]) {
      expect(serializado).not.toContain(clave);
    }
  });
});
