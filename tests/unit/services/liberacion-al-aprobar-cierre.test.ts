import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import {
  liberarAlAprobarCierreCon,
  liberarAlAprobarCierreNoOp,
  type LiberarAlAprobarCierre,
} from "@/lib/services/liberacion-al-aprobar-cierre";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import type {
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { LiberacionResult } from "@/lib/interfaces/services/ILiberacionReprogramadaService";

/**
 * FICHA 315 (defecto de produccion del 2026-08-28) — **APROBAR UN CIERRE LIBERA SUS REPROGRAMADAS
 * VENCIDAS, EN EL ACTO.**
 *
 * EL FALLO, CON LOS HECHOS MEDIDOS. La feature 276 congela una orden reprogramada mientras su
 * gestion todavia pueda sumar un intento: no se libera hasta que su cierre este `aprobado`. Puerta
 * correcta y deliberada. Lo que faltaba era el TIMBRE: nadie volvia a mirar esas ordenes cuando la
 * aprobacion ocurria.
 *
 *   14:10:06 UTC  la corrida `liberar_reprogramadas` libera 25 ordenes; **5 se quedan**, su cierre
 *                 esta `solicitado`.
 *   14:48:29 UTC  el humano **aprueba ese cierre** — 38 minutos despues.
 *      —          las 5 siguen invisibles para el filtro de reasignables. La siguiente corrida
 *                 automatica es a las 00:00 CR: NUEVE HORAS despues.
 *   15:20:03 UTC  se encola una corrida a mano y salen (`liberadas_total` 25 -> 30).
 *
 * QUE MIDE ESTE ARCHIVO Y QUE NO. Aqui todo son DOBLES: no ve una linea de SQL. Mide el CABLEADO
 * —quien dispara, con que id, en que orden y que el fallo no puede tumbar la aprobacion— y el
 * composition root. **El acotado por fecha —la parte que impide soltar una orden del 31/08 el
 * 28/08— NO se puede probar aqui**: vive en un `where`/una correlacion del repositorio, y en este
 * repo esta medido cuatro veces que una mutacion de un `where` sobrevive en verde a una suite de
 * dobles. Eso se prueba contra Postgres, en
 * `tests/integration/db/liberacion-al-aprobar-cierre-real.test.ts`.
 */

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const CIERRE_ID = "c-315-aprobado";

function resumenRow(overrides: Partial<CierreAdminResumenRow> = {}): CierreAdminResumenRow {
  return {
    cierreId: CIERRE_ID,
    mensajeroId: "men-1",
    mensajeroNombre: "Ana Mensajera",
    estado: "aprobado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-08-28T14:00:00.000Z",
    resueltoAt: "2026-08-28T14:48:29.000Z",
    motivoRechazo: null,
    ...overrides,
  };
}

type Traza = string[];

function fakeRepo(
  traza: Traza,
  resolver: "updated" | "conflict" | "fuera_de_alcance" = "updated",
): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => ({
      cierre: resumenRow(),
      gestiones: [],
      sinGestion: [],
      sinGestionRegistrado: true,
    })),
    resolverCierre: vi.fn(async () => {
      traza.push("resolverCierre");
      return resolver;
    }),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    findGestionesRetornablesDelCierre: vi.fn(async () => []),
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [] })),
    findGestionEditableEnCierre: vi.fn(async () => null),
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
  };
}

function newService(
  opts: {
    resolver?: "updated" | "conflict" | "fuera_de_alcance";
    liberar?: LiberarAlAprobarCierre;
    /** `true` = se construye SIN cablear el liberador (default no-op del constructor). */
    sinLiberador?: boolean;
    /** `null` en el catalogo -> la aprobacion NO ocurre (fallo cerrado del anclaje, 239/R9). */
    catalogoIncompleto?: boolean;
  } = {},
) {
  const traza: Traza = [];
  const repo = fakeRepo(traza, opts.resolver ?? "updated");
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const ordenRepo = {
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findUsuarioZonaId: vi.fn(async () => "z-sat"),
    findEstatusIdByValue: vi.fn(async () => (opts.catalogoIncompleto ? null : "os-x")),
    findBloqueoDetalle: vi.fn(async () => ({ bloqueado: false, n: 0, v: 0, masViejo: null })),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  const liquidacionRepo = {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  };
  const premiosRepo = {
    sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
  };
  const liberar =
    opts.liberar ??
    (vi.fn(async () => {
      traza.push("liberar");
    }) as LiberarAlAprobarCierre);

  const service = opts.sinLiberador
    ? new CierresAdminService(
        repo,
        zonaRepo,
        ordenRepo,
        signedUrls,
        liquidacionRepo,
        premiosRepo,
        undefined,
      )
    : new CierresAdminService(
        repo,
        zonaRepo,
        ordenRepo,
        signedUrls,
        liquidacionRepo,
        premiosRepo,
        undefined,
        liberar,
      );
  return { service, repo, liberar, traza };
}

const mockDe = (f: LiberarAlAprobarCierre) => f as unknown as ReturnType<typeof vi.fn>;

describe("315 — aprobar un cierre dispara la liberacion de SUS reprogramadas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("llama al liberador UNA vez y con el id del cierre que se acaba de aprobar", async () => {
    const { service, liberar } = newService();

    const r = await service.aprobarCierre(CIERRE_ID, MAESTRO);

    expect(r).toMatchObject({ status: "ok", cierreId: CIERRE_ID, estado: "aprobado" });
    expect(mockDe(liberar)).toHaveBeenCalledTimes(1);
    // ⭑ EL ID. Un timbre que sonara con otro cierre liberaria ordenes ajenas: peor que no sonar.
    expect(mockDe(liberar)).toHaveBeenCalledWith(CIERRE_ID);
  });

  it("suena DESPUES de que la transaccion de la aprobacion haya confirmado, nunca dentro", async () => {
    // El orden es la evidencia observable de «fuera de la tx»: `resolverCierre` es quien la abre y
    // la cierra, y este servicio no le pasa el liberador. Si algun dia alguien lo metiera dentro,
    // la traza dejaria de tener estas dos entradas en este orden.
    const { service, traza } = newService();

    await service.aprobarCierre(CIERRE_ID, MAESTRO);

    expect(traza).toEqual(["resolverCierre", "liberar"]);
  });

  it("cierre YA resuelto (conflict) -> NO libera nada", async () => {
    const { service, liberar } = newService({ resolver: "conflict" });

    expect(await service.aprobarCierre(CIERRE_ID, MAESTRO)).toEqual({ status: "conflict" });
    expect(mockDe(liberar)).not.toHaveBeenCalled();
  });

  it("cierre fuera de alcance -> NO libera nada", async () => {
    const { service, liberar } = newService({ resolver: "fuera_de_alcance" });

    expect(await service.aprobarCierre(CIERRE_ID, MAESTRO)).toEqual({ status: "no_encontrada" });
    expect(mockDe(liberar)).not.toHaveBeenCalled();
  });

  it("rol sin permiso -> ni se aprueba ni se libera", async () => {
    const { service, liberar, repo } = newService();

    expect(await service.aprobarCierre(CIERRE_ID, MENSAJERO)).toEqual({ status: "forbidden" });
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(liberar)).not.toHaveBeenCalled();
  });

  it("catalogo incompleto (239/R9: la aprobacion NO ocurre) -> tampoco se libera", async () => {
    const { service, liberar, repo } = newService({ catalogoIncompleto: true });

    expect(await service.aprobarCierre(CIERRE_ID, MAESTRO)).toMatchObject({
      status: "validation_error",
    });
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(mockDe(liberar)).not.toHaveBeenCalled();
  });

  it("RECHAZAR un cierre no libera nada: el timbre es de la APROBACION", async () => {
    const { service, liberar } = newService();

    await service.rechazarCierre(CIERRE_ID, "Faltan evidencias.", MAESTRO);

    expect(mockDe(liberar)).not.toHaveBeenCalled();
  });

  it("sin cablear (default no-op) la aprobacion sigue funcionando y no mueve una sola orden", async () => {
    // Es la propiedad que protege a las trece suites que instancian este servicio contra la base
    // local COMPARTIDA: construirlo sin el composition root no puede mover ordenes de verdad.
    const { service } = newService({ sinLiberador: true });

    expect(await service.aprobarCierre(CIERRE_ID, MAESTRO)).toMatchObject({ status: "ok" });
  });
});

describe("315 — el adaptador real: que llama, con que fecha y que hace cuando falla", () => {
  const NOW = new Date("2026-08-28T14:48:29.000Z"); // 08:48 CR del 28

  it("llama a `liberarPorCierreAprobado` con el cierre y con HOY en CR (medianoche UTC)", async () => {
    const liberarPorCierreAprobado = vi.fn<
      (cierreId: string, hoyCR: Date) => Promise<LiberacionResult>
    >(async () => ({ evaluadas: 5, liberadas: 5, omitidas: 0, esperandoCierre: 0 }));

    await liberarAlAprobarCierreCon({ liberarPorCierreAprobado }, () => NOW)(CIERRE_ID);

    expect(liberarPorCierreAprobado).toHaveBeenCalledTimes(1);
    expect(liberarPorCierreAprobado).toHaveBeenCalledWith(CIERRE_ID, startOfDayCR(NOW));
    // Y la fecha es la de CALENDARIO CR a medianoche UTC, no el instante: `fecha_reprogramacion`
    // es `@db.Date`, asi que comparar contra `new Date()` dejaria fuera todo lo de HOY.
    expect((liberarPorCierreAprobado.mock.calls[0][1] as Date).toISOString()).toBe(
      "2026-08-28T00:00:00.000Z",
    );
  });

  it("absorbe el fallo, lo REGISTRA con su causa y no lo propaga", async () => {
    const avisos: string[] = [];
    const liberarPorCierreAprobado = vi.fn(async () => {
      throw new Error("base caida");
    });

    await expect(
      liberarAlAprobarCierreCon({ liberarPorCierreAprobado }, () => NOW, {
        warn: (m) => avisos.push(m),
      })(CIERRE_ID),
    ).resolves.toBeUndefined();

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("base caida"); // la causa, no un «algo fallo»
    expect(avisos[0]).toContain("00:00 CR"); // y dice cual es la red que lo recoge
    // Sin PII: el aviso NO nombra el cierre ni ninguna orden (mismo criterio que R19/R38).
    expect(avisos[0]).not.toContain(CIERRE_ID);
  });

  it("💰 un fallo al liberar NO revierte la aprobacion: sigue devolviendo ok", async () => {
    // LA propiedad que justifica que esto viva FUERA de la transaccion. La aprobacion ya emitio
    // dinero; que una orden no pueda cambiar de estado no puede deshacerla. Se cablea el
    // adaptador REAL —el mismo que usa produccion— con un servicio que revienta.
    const avisos: string[] = [];
    const liberar = liberarAlAprobarCierreCon(
      {
        liberarPorCierreAprobado: vi.fn(async () => {
          throw new Error("timeout");
        }),
      },
      () => NOW,
      { warn: (m) => avisos.push(m) },
    );
    const { service } = newService({ liberar });

    expect(await service.aprobarCierre(CIERRE_ID, MAESTRO)).toMatchObject({
      status: "ok",
      estado: "aprobado",
    });
    expect(avisos).toHaveLength(1); // y no fue en silencio
  });
});

describe("315 — el camino real esta CABLEADO en el composition root, no en el default", () => {
  const ROOT = path.join(__dirname, "..", "..", "..");
  const leer = (...partes: string[]) => fs.readFileSync(path.join(ROOT, ...partes), "utf8");

  /**
   * Se afirma sobre el USO EFECTIVO, sin imports ni comentarios. Medido en este repo (guardia de
   * la 271): con un `toContain` a secas, borrar la linea del cableado deja el test EN VERDE porque
   * el import de arriba sigue conteniendo el nombre.
   */
  function fuenteSinImportsNiComentarios(fuente: string): string {
    const salida: string[] = [];
    let dentroDeImport = false;
    let dentroDeBloque = false;
    for (const linea of fuente.split("\n")) {
      const t = linea.trim();
      if (dentroDeBloque) {
        if (t.includes("*/")) dentroDeBloque = false;
        continue;
      }
      if (t.startsWith("/*")) {
        if (!t.includes("*/")) dentroDeBloque = true;
        continue;
      }
      if (t.startsWith("//") || t.startsWith("*")) continue;
      if (dentroDeImport) {
        if (/from\s+["']/.test(t)) dentroDeImport = false;
        continue;
      }
      if (t.startsWith("import ")) {
        if (!/from\s+["']/.test(t)) dentroDeImport = true;
        continue;
      }
      salida.push(linea);
    }
    return salida.join("\n");
  }

  it("lib/actions/cierres-admin.ts PASA el liberador real al construir el servicio", () => {
    // Sin esta linea el servicio corre con su default NO-OP: aprobar un cierre vuelve a no liberar
    // nada, en produccion, con toda la suite en verde. Es el fallo mudo que la 271 ya se comio con
    // `notificarCierreDiaVencidoReal` (el corte llevaba SIETE argumentos y el notificador era el
    // septimo, asi que nunca se paso).
    const uso = fuenteSinImportsNiComentarios(leer("lib", "actions", "cierres-admin.ts"));
    expect(uso).toContain("liberarAlAprobarCierreCon(buildLiberarReprogramadasService())");
    expect(uso).toMatch(
      /new CierresAdminService\([\s\S]*liberarAlAprobarCierreCon\([\s\S]*\);/,
    );
  });

  it("el DEFAULT del constructor es el no-op, no el adaptador real", () => {
    const fuente = leer("lib", "services", "CierresAdminService.ts");
    expect(fuente).toMatch(/LiberarAlAprobarCierre = liberarAlAprobarCierreNoOp/);
    expect(fuente).not.toMatch(/LiberarAlAprobarCierre = liberarAlAprobarCierreCon/);
  });

  it("el no-op no llama a nadie: es de verdad inerte", async () => {
    await expect(liberarAlAprobarCierreNoOp("c-lo-que-sea")).resolves.toBeUndefined();
  });
});
