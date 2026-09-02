import fs from "fs";
import path from "path";

import { describe, it, expect, vi, afterEach } from "vitest";

import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { reintentosConfig } from "@/lib/config/reintentos";
import type { ICierresAdminRepository } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * FEATURE 276 (T9) — EL UMBRAL VIAJA INYECTADO DESDE EL SERVICIO. R7, R21.
 *
 * ⚠️ QUE PRUEBA ESTE ARCHIVO Y QUE NO. Prueba EL CABLEADO: que `CierresAdminService.aprobarCierre`
 * resuelva el umbral de `reintentosConfig` y lo meta en `liberacionSinGestionar`, y que el
 * repositorio no tenga que leer configuracion (R7). Lo que hace la transaccion con ese numero
 * —partir las barridas en dos destinos, crear la gestion sintetica, escribir el historial— se mide
 * contra Postgres real en `tests/integration/db/cierre-sin-gestion-tope-sql-real.test.ts`, porque
 * aqui el repositorio es un doble y no ejecuta ni una linea de ese bloque.
 */

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

const ESTATUS_IDS: Record<string, string | null> = {
  sin_gestionar: "s-sin-gestionar",
  en_bodega_central: "s-en-bodega",
  en_bodega_satelite: "s-en-bodega-sat",
  rechazada: "s-rechazada",
  por_devolver: "s-por-devolver",
  por_devolver_a_tienda: "s-por-devolver-a-tienda",
  devolucion_por_confirmar: "s-devolucion-por-confirmar",
  devuelta: "s-devuelta",
};

function fakeRepo(): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    findGestionesRetornablesDelCierre: vi.fn(async () => []),
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [], mensajerosFiltro: [] })),
    findGestionEditableEnCierre: vi.fn(async () => null),
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
  };
}

function newService(
  Servicio: typeof CierresAdminService = CierresAdminService,
  estatusIds: Record<string, string | null> = ESTATUS_IDS,
) {
  const repo = fakeRepo();
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-cartago"),
    findEstatusIdByValue: vi.fn(async (v: string) => estatusIds[v] ?? null),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  const service = new Servicio(repo, zonaRepo, ordenRepo, signedUrls, {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  },
  // Feature 293 (T2.3): lectura de premios; "0.00" por id -> lo pagable no cambia.
  {
    sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
  });
  return { service, repo, ordenRepo };
}

/** La config que el servicio le paso al repositorio en la ultima llamada. */
function configDeLaUltimaAprobacion(repo: ICierresAdminRepository) {
  const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return arg.liberacionSinGestionar as
    | { umbralIntentos?: number; rechazadaEstatusId?: string }
    | undefined;
}

describe("276/T9 · R7 — el umbral lo resuelve el SERVICIO, no el repositorio", () => {
  it("al aprobar, la config de la liberacion lleva el umbral y el destino del rechazo", async () => {
    const { service, repo } = newService();

    await service.aprobarCierre("c1", MAESTRO);

    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Igualdad de OBJETO COMPLETO: si alguien anadiera un campo a la config sin decidirlo, cae.
    expect(arg.liberacionSinGestionar).toEqual({
      sinGestionarEstatusId: "s-sin-gestionar",
      enBodegaEstatusId: "s-en-bodega",
      enBodegaSateliteEstatusId: "s-en-bodega-sat",
      centralZonaId: "z-central",
      rechazadaEstatusId: "s-rechazada",
      umbralIntentos: reintentosConfig.MIN_INTENTOS_ENTREGA,
    });
  });

  it("el repositorio NO importa la configuracion de reintentos: el numero llega de fuera", () => {
    // R7 dicho de la forma que se puede comprobar: el fichero del repositorio no nombra
    // `reintentosConfig` ni `MIN_INTENTOS_ENTREGA`. Si alguien "simplificara" leyendo la config
    // ahi, habria DOS fuentes del mismo umbral y podrian divergir (una del servicio, otra del
    // repo). Molde: el aserto de fuente de `tests/unit/components/intentos-entrega.test.tsx`.
    const fuente = fuenteDelRepositorio();
    expect(fuente).not.toContain("reintentosConfig");
    expect(fuente).not.toContain("MIN_INTENTOS_ENTREGA");
    expect(fuente).not.toContain("@/lib/config/reintentos");
    // Y el umbral tampoco esta escrito a mano: no hay ningun `umbralIntentos = 3`.
    expect(fuente).not.toMatch(/umbralIntentos\s*=\s*\d/);
  });

  it("al RECHAZAR el cierre no se pasa ninguna config de liberacion (R27)", async () => {
    const { service, repo } = newService();

    await service.rechazarCierre("c1", "no cuadra la caja", MAESTRO);

    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.nuevoEstado).toBe("rechazado");
    // Sin config, el bloque entero —las dos ramas— no existe para un rechazo.
    expect(arg.liberacionSinGestionar).toBeUndefined();
  });
});

describe("276/T9 · el bloque falla CERRADO cuando el catalogo no resuelve", () => {
  it("sin `rechazada` en el catalogo, la config NO se cablea (y con ella se cae la rama vieja)", async () => {
    // Es fallo cerrado deliberado y hay que leerlo entero: sin destino de rechazo, el bloque de
    // liberacion NO se cablea, asi que tampoco se libera a bodega. La alternativa —cablearlo sin
    // destino de rechazo— mandaria a bodega, EN SILENCIO, ordenes que ya agotaron sus intentos:
    // exactamente lo que esta ficha existe para impedir.
    const { service, repo } = newService(CierresAdminService, {
      ...ESTATUS_IDS,
      rechazada: null,
    });

    await service.aprobarCierre("c1", MAESTRO);

    expect(configDeLaUltimaAprobacion(repo)).toBeUndefined();
  });

  it("sin `sin_gestionar` tampoco se cablea (el comportamiento de siempre, sin cambios)", async () => {
    const { service, repo } = newService(CierresAdminService, {
      ...ESTATUS_IDS,
      sin_gestionar: null,
    });

    await service.aprobarCierre("c1", MAESTRO);

    expect(configDeLaUltimaAprobacion(repo)).toBeUndefined();
  });
});

describe("276/T9 · R7 — con `REINTENTOS_MIN_INTENTOS = 5` viaja un 5", () => {
  const ANTES = process.env.REINTENTOS_MIN_INTENTOS;

  afterEach(() => {
    if (ANTES === undefined) delete process.env.REINTENTOS_MIN_INTENTOS;
    else process.env.REINTENTOS_MIN_INTENTOS = ANTES;
    vi.resetModules();
  });

  it("el numero que llega al repositorio sale de la configuracion, no de un `3` a mano", async () => {
    process.env.REINTENTOS_MIN_INTENTOS = "5";
    vi.resetModules();
    const { CierresAdminService: Fresco } = await import("@/lib/services/CierresAdminService");
    const { service, repo } = newService(Fresco as typeof CierresAdminService);

    await service.aprobarCierre("c1", MAESTRO);

    expect(configDeLaUltimaAprobacion(repo)?.umbralIntentos).toBe(5);
  });
});

/** El texto del repositorio, leido del disco. Se aisla para no repetir la ruta en dos casos. */
function fuenteDelRepositorio(): string {
  return fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "lib", "repositories", "CierresAdminRepository.ts"),
    "utf8",
  );
}
