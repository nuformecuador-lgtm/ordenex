import { describe, it, expect, vi } from "vitest";
import { RolValue } from "@prisma/client";
import {
  IncidenteAdminService,
  ORIGENES_INCIDENTE_ADMIN,
} from "@/lib/services/IncidenteAdminService";
import {
  MSG_AUTOR_NO_RESUELVE,
  MSG_INCIDENTE_YA_EXISTE,
  MSG_INCIDENTE_YA_RESUELTO,
  MSG_ORDEN_NO_REPORTABLE,
  MSG_SIN_ORIGEN_REVERSIBLE,
  MSG_SOLO_EL_AUTOR_RETRACTA,
} from "@/lib/services/mensajes-incidente-admin";
import type {
  AlcanceIncidente,
  IncidenteAdminRow,
  ReportarIncidenteRepoInput,
  ReportarIncidenteRepoResult,
  ResolverIncidenteRepoInput,
} from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 158 (T1.28/T1.29, camino del ADMIN) — logica de negocio con dobles (sin DB, sin red).
// Cubre R48 (alcance), R49 (dos colas), **R51 (quien reporta no aprueba)**, R46 (evidencias
// firmadas y subida compensada), R54/R57/R58/R59 (reversion derivada del historial) y R60.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: RolValue.maestro };
const ADMIN_2: Actor = { usuarioId: "u-admin2", rol: RolValue.admin };
const SATELITE: Actor = { usuarioId: "u-sat", rol: RolValue.adminSatelite };
const MENSAJERO: Actor = { usuarioId: "u-men", rol: RolValue.mensajero };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: RolValue.adminTienda };

const ORDEN_ID = "o-1";
const INCIDENTE_ID = "inc-1";

function fila(over: Partial<IncidenteAdminRow> = {}): IncidenteAdminRow {
  return {
    incidenteId: INCIDENTE_ID,
    ordenId: ORDEN_ID,
    numGuia: 42,
    numRemision: "R-42",
    destinatario: "Ana",
    zonaId: "z-1",
    zonaNombre: "Centro",
    estatusValue: "incidente",
    causa: "danado",
    motivo: "caja aplastada",
    estado: "solicitado",
    indemnizacion: null,
    reportadoPor: "u-maestro",
    reportadoPorNombre: "Maestro",
    resueltoPor: null,
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-07-30T11:00:00.000Z",
    evidenciaStoragePaths: ["p/0.jpg"],
    ...over,
  };
}

interface DobleOpts {
  filas?: IncidenteAdminRow[];
  porId?: IncidenteAdminRow | null;
  reportar?: ReportarIncidenteRepoResult;
  resolver?: "updated" | "conflict" | "fuera_de_alcance";
  /** `value` del estado de origen que devuelve el historial (`null` = no derivable). */
  origenReversion?: string | null;
  /** zona del `adminSatelite`. */
  zonaUsuario?: string | null;
  /** `null` para simular un catalogo incompleto. */
  estatusIds?: Record<string, string> | null;
}

function build(opts: DobleOpts = {}) {
  const repo = {
    reportar: vi.fn(async (input: ReportarIncidenteRepoInput) => {
      void input;
      return opts.reportar ?? { status: "ok" as const, incidenteId: INCIDENTE_ID };
    }),
    resolver: vi.fn(async (input: ResolverIncidenteRepoInput) => {
      void input;
      return opts.resolver ?? ("updated" as const);
    }),
    findByAlcance: vi.fn(async (alcance: AlcanceIncidente) => {
      void alcance;
      return opts.filas ?? [];
    }),
    findByIdEnAlcance: vi.fn(async (id: string, alcance: AlcanceIncidente) => {
      void id;
      void alcance;
      return opts.porId === undefined ? fila() : opts.porId;
    }),
  };
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => (opts.zonaUsuario === undefined ? "z-1" : opts.zonaUsuario)),
    // `estatusIds` ausente = catalogo completo (`os-<value>`); un mapa PARCIAL = solo esos
    // values resuelven (los demas devuelven null, que es lo que hace la DB con un seed a medias);
    // `null` = catalogo vacio.
    findEstatusIdByValue: vi.fn(async (value: string) =>
      opts.estatusIds === undefined ? `os-${value}` : (opts.estatusIds?.[value] ?? null),
    ),
  };
  const historialRepo = {
    findOrigenesReversion: vi.fn(
      async () =>
        new Map<string, string | null>([
          [
            ORDEN_ID,
            opts.origenReversion === undefined ? "en_bodega_central" : opts.origenReversion,
          ],
        ]),
    ),
  };
  const storage = {
    upload: vi.fn(async ({ path }: { path: string }) => path),
    remove: vi.fn(async (paths: string[]) => {
      void paths;
    }),
  };
  const signedUrls = {
    createSignedUrl: vi.fn(async () => "https://firmada/x"),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://firmada/${p}`])),
    ),
  };
  const service = new IncidenteAdminService(repo, ordenRepo, historialRepo, storage, signedUrls);
  return { service, repo, ordenRepo, historialRepo, storage, signedUrls };
}

const reporte = {
  ordenId: ORDEN_ID,
  causa: "danado" as const,
  motivo: "caja aplastada",
  evidencias: [
    { contentType: "image/jpeg", bytes: new Uint8Array([1]) },
    { contentType: "image/png", bytes: new Uint8Array([2]) },
  ],
};

describe("R48 — alcance por rol y por zona, resuelto SERVER-SIDE", () => {
  it.each([
    ["mensajero", MENSAJERO],
    ["adminTienda", TIENDA],
  ])("un %s no puede listar, ver, reportar ni resolver: forbidden", async (_rol, actor) => {
    const { service, repo } = build();
    expect(await service.listarIncidentes(actor)).toEqual({ status: "forbidden" });
    expect(await service.verIncidente(INCIDENTE_ID, actor)).toEqual({ status: "forbidden" });
    expect(await service.reportar(reporte, actor)).toEqual({ status: "forbidden" });
    expect(await service.aprobar(INCIDENTE_ID, "10.00", actor)).toEqual({ status: "forbidden" });
    expect(await service.rechazar(INCIDENTE_ID, "no", actor)).toEqual({ status: "forbidden" });
    expect(await service.retractar(INCIDENTE_ID, actor)).toEqual({ status: "forbidden" });
    // Y NO se toco el repo en ninguno de los seis: forbidden antes de mirar dato alguno.
    expect(repo.findByAlcance).not.toHaveBeenCalled();
    expect(repo.findByIdEnAlcance).not.toHaveBeenCalled();
    expect(repo.reportar).not.toHaveBeenCalled();
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("acceso total (maestro/admin) NO se acota por zona", async () => {
    const { service, repo, ordenRepo } = build();
    await service.listarIncidentes(MAESTRO);
    expect(repo.findByAlcance).toHaveBeenCalledWith({ zonaId: null });
    // Ni siquiera se consulta la zona del usuario: no aplica.
    expect(ordenRepo.findUsuarioZonaId).not.toHaveBeenCalled();
  });

  it("el `adminSatelite` se acota a SU zona, leida del usuario y nunca del cliente", async () => {
    const { service, repo, ordenRepo } = build({ zonaUsuario: "z-9" });
    await service.listarIncidentes(SATELITE);
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("u-sat");
    expect(repo.findByAlcance).toHaveBeenCalledWith({ zonaId: "z-9" });
  });

  it("un `adminSatelite` SIN zona ve dos colas vacias y no puede reportar ni resolver", async () => {
    const { service, repo } = build({ zonaUsuario: null });
    expect(await service.listarIncidentes(SATELITE)).toEqual({
      status: "ok",
      pendientes: [],
      historico: [],
      sinZona: true,
    });
    expect(await service.verIncidente(INCIDENTE_ID, SATELITE)).toEqual({
      status: "no_encontrada",
    });
    expect(await service.reportar(reporte, SATELITE)).toEqual({ status: "forbidden" });
    expect(await service.aprobar(INCIDENTE_ID, "10.00", SATELITE)).toEqual({
      status: "no_encontrada",
    });
    expect(repo.reportar).not.toHaveBeenCalled();
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("un incidente fuera de alcance -> `no_encontrada`, SIN revelar nada de la orden", async () => {
    const { service } = build({ porId: null });
    const r = await service.verIncidente(INCIDENTE_ID, SATELITE);
    expect(r).toEqual({ status: "no_encontrada" });
    // El resultado no lleva ningun campo del incidente ni de la orden.
    expect(JSON.stringify(r)).not.toContain(ORDEN_ID);
    expect(JSON.stringify(r)).not.toContain("Ana");
  });
});

describe("R49 — dos colas: pendientes de decision e historico", () => {
  it("parte `solicitado` de los resueltos, y firma TODAS las evidencias en UNA llamada", async () => {
    const filas = [
      fila({ incidenteId: "a", estado: "solicitado", evidenciaStoragePaths: ["p/a.jpg"] }),
      fila({ incidenteId: "b", estado: "aprobado", evidenciaStoragePaths: ["p/b.jpg"] }),
      fila({ incidenteId: "c", estado: "rechazado", evidenciaStoragePaths: [] }),
    ];
    const { service, signedUrls } = build({ filas });

    const r = await service.listarIncidentes(MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pendientes.map((i) => i.incidenteId)).toEqual(["a"]);
    expect(r.historico.map((i) => i.incidenteId)).toEqual(["b", "c"]);
    expect(r.sinZona).toBe(false);
    // UNA sola llamada al firmador para todo el lote (no N round-trips).
    expect(signedUrls.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(signedUrls.createSignedUrls.mock.calls[0][0]).toEqual(["p/a.jpg", "p/b.jpg"]);
  });

  it("sin evidencias no se llama al firmador", async () => {
    const { service, signedUrls } = build({
      filas: [fila({ evidenciaStoragePaths: [] })],
    });
    await service.listarIncidentes(MAESTRO);
    expect(signedUrls.createSignedUrls).not.toHaveBeenCalled();
  });
});

describe("R46 — la evidencia sale SOLO firmada, nunca el path crudo", () => {
  it("el DTO trae URLs firmadas y NO el `storage_path`", async () => {
    const { service } = build({
      porId: fila({ evidenciaStoragePaths: ["priv/uno.jpg", "priv/dos.jpg"] }),
    });

    const r = await service.verIncidente(INCIDENTE_ID, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.incidente.evidenciaUrls).toEqual([
      "https://firmada/priv/uno.jpg",
      "https://firmada/priv/dos.jpg",
    ]);
    // El path crudo NO cruza al cliente por ninguna clave del DTO.
    expect(JSON.stringify(r.incidente)).not.toContain('"priv/uno.jpg"');
    expect(r.incidente).not.toHaveProperty("evidenciaStoragePaths");
  });

  it("el id del AUTOR no cruza; en su lugar viaja `esPropio`, calculado en el servidor", async () => {
    const propio = await build({ porId: fila({ reportadoPor: "u-maestro" }) }).service.verIncidente(
      INCIDENTE_ID,
      MAESTRO,
    );
    const ajeno = await build({ porId: fila({ reportadoPor: "u-otro" }) }).service.verIncidente(
      INCIDENTE_ID,
      MAESTRO,
    );
    expect(propio.status === "ok" && propio.incidente.esPropio).toBe(true);
    expect(ajeno.status === "ok" && ajeno.incidente.esPropio).toBe(false);
    expect(propio.status === "ok" && propio.incidente).not.toHaveProperty("reportadoPor");
  });
});

describe("R41-R43/R47 — el reporte", () => {
  it("sube las N evidencias ANTES de la transaccion y las pasa con su indice", async () => {
    const { service, repo, storage } = build();

    const r = await service.reportar(reporte, MAESTRO);

    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID });
    expect(storage.upload).toHaveBeenCalledTimes(2);
    const arg = repo.reportar.mock.calls[0][0];
    expect(arg.evidencias).toHaveLength(2);
    expect(arg.evidencias[0].indice).toBe(0);
    expect(arg.evidencias[1].indice).toBe(1);
    // Los paths llevan el id de la orden y distinguen un incidente de una gestion.
    expect(arg.evidencias[0].storagePath).toContain(ORDEN_ID);
    expect(arg.evidencias[0].storagePath).toContain("incidente-");
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("R41: pasa los CINCO estados de origen y el destino, resueltos del catalogo", async () => {
    const { service, repo } = build();
    await service.reportar(reporte, MAESTRO);
    const arg = repo.reportar.mock.calls[0][0];
    expect(arg.origenEstatusIds).toEqual(ORIGENES_INCIDENTE_ADMIN.map((v) => `os-${v}`));
    expect(arg.incidenteEstatusId).toBe("os-incidente");
    expect(arg.reportadoPor).toBe("u-maestro");
  });

  it("R42: si el repo rechaza la orden, se BORRAN las fotos ya subidas (cero huerfanas)", async () => {
    const { service, storage } = build({ reportar: { status: "no_aplicable" } });

    const r = await service.reportar(reporte, MAESTRO);

    expect(r).toEqual({ status: "conflict", motivo: MSG_ORDEN_NO_REPORTABLE });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove.mock.calls[0][0]).toHaveLength(2);
  });

  it("R47: un segundo reporte vivo -> conflict accionable, y tambien compensa el bucket", async () => {
    const { service, storage } = build({ reportar: { status: "duplicado" } });

    const r = await service.reportar(reporte, MAESTRO);

    expect(r).toEqual({ status: "conflict", motivo: MSG_INCIDENTE_YA_EXISTE });
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it("si la subida #2 falla, se borra la #1 y NO se llama al repo", async () => {
    const { service, repo, storage } = build();
    storage.upload
      .mockImplementationOnce(async ({ path }: { path: string }) => path)
      .mockRejectedValueOnce(new Error("storage caido"));

    await expect(service.reportar(reporte, MAESTRO)).rejects.toThrow("storage caido");

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove.mock.calls[0][0]).toHaveLength(1);
    expect(repo.reportar).not.toHaveBeenCalled();
  });

  it("si la transaccion revienta, se compensan las fotos y el error se propaga", async () => {
    const { service, repo, storage } = build();
    repo.reportar.mockRejectedValueOnce(new Error("caida de DB"));

    await expect(service.reportar(reporte, MAESTRO)).rejects.toThrow("caida de DB");

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove.mock.calls[0][0]).toHaveLength(2);
  });

  it("catalogo incompleto -> validation_error y NI UNA foto subida", async () => {
    const { service, repo, storage } = build({ estatusIds: null });

    const r = await service.reportar(reporte, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.reportar).not.toHaveBeenCalled();
  });
});

describe("R51 — QUIEN REPORTA NO APRUEBA (el doble control del dinero)", () => {
  it("el autor NO puede aprobar su propio incidente: conflict SIN efectos", async () => {
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });

    const r = await service.aprobar(INCIDENTE_ID, "2500.00", MAESTRO);

    expect(r).toEqual({ status: "conflict", motivo: MSG_AUTOR_NO_RESUELVE });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("el autor tampoco puede RECHAZARLO (R51 cubre resolver, no solo aprobar)", async () => {
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });

    const r = await service.rechazar(INCIDENTE_ID, "no procede", MAESTRO);

    expect(r).toEqual({ status: "conflict", motivo: MSG_AUTOR_NO_RESUELVE });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("R51 aplica aunque el actor tenga ACCESO TOTAL: el rol no exime del doble control", async () => {
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });
    expect(await service.aprobar(INCIDENTE_ID, "10.00", MAESTRO)).toMatchObject({
      status: "conflict",
    });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("R51 se comprueba ANTES que el monto: un monto invalido del autor sigue siendo conflict", async () => {
    // Si el orden fuera al reves, el autor sabria por el mensaje que su monto era invalido y
    // podria reintentar hasta acertar, aunque nunca vaya a poder aprobar.
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });
    const r = await service.aprobar(INCIDENTE_ID, "-1", MAESTRO);
    expect(r).toEqual({ status: "conflict", motivo: MSG_AUTOR_NO_RESUELVE });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("OTRO admin SI puede aprobarlo: el monto llega TAL CUAL (STRING) al repo", async () => {
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });

    const r = await service.aprobar(INCIDENTE_ID, "2500.00", ADMIN_2);

    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID, estado: "aprobado" });
    const arg = repo.resolver.mock.calls[0][0];
    expect(arg.monto).toBe("2500.00");
    expect(typeof arg.monto).toBe("string");
    expect(arg.nuevoEstado).toBe("aprobado");
    expect(arg.resueltoPor).toBe("u-admin2");
    expect(arg.motivoRechazo).toBeNull();
    // Aprobar NO revierte la orden: se queda en `incidente`, que es terminal.
    expect(arg.reversion).toBeUndefined();
  });
});

describe("R50/R53/R59 — guardias de la resolucion", () => {
  it("R50: un monto no positivo se rechaza en el service, sin tocar el repo", async () => {
    for (const monto of ["0", "-1", "0.00", "abc", ""]) {
      const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });
      const r = await service.aprobar(INCIDENTE_ID, monto, ADMIN_2);
      expect(r.status, `monto ${monto}`).toBe("validation_error");
      expect(repo.resolver).not.toHaveBeenCalled();
    }
  });

  it("R54: rechazar sin motivo -> validation_error, sin tocar el repo", async () => {
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });
    const r = await service.rechazar(INCIDENTE_ID, "   ", ADMIN_2);
    expect(r.status).toBe("validation_error");
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it.each([
    ["aprobado", "aprobado"],
    ["rechazado", "rechazado"],
  ])("R53/R59: un incidente ya `%s` NO se puede resolver otra vez", async (_e, estado) => {
    const { service, repo } = build({
      porId: fila({ reportadoPor: "u-maestro", estado: estado as "aprobado" }),
    });
    expect(await service.aprobar(INCIDENTE_ID, "10.00", ADMIN_2)).toEqual({
      status: "conflict",
      motivo: MSG_INCIDENTE_YA_RESUELTO,
    });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("R59: un incidente APROBADO no se puede revertir — el dinero ya salio", async () => {
    const { service, repo } = build({
      porId: fila({ reportadoPor: "u-maestro", estado: "aprobado", indemnizacion: "2500.00" }),
    });
    // Ni por rechazo del aprobador...
    expect(await service.rechazar(INCIDENTE_ID, "me equivoque", ADMIN_2)).toEqual({
      status: "conflict",
      motivo: MSG_INCIDENTE_YA_RESUELTO,
    });
    // ...ni por retracto del autor.
    expect(await service.retractar(INCIDENTE_ID, MAESTRO)).toEqual({
      status: "conflict",
      motivo: MSG_INCIDENTE_YA_RESUELTO,
    });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("R59: SOLO el autor retracta; otro admin debe rechazar (con motivo)", async () => {
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });
    expect(await service.retractar(INCIDENTE_ID, ADMIN_2)).toEqual({
      status: "conflict",
      motivo: MSG_SOLO_EL_AUTOR_RETRACTA,
    });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("el conflicto del repo (carrera) se traduce a `conflict` accionable", async () => {
    const { service } = build({ porId: fila({ reportadoPor: "u-maestro" }), resolver: "conflict" });
    expect(await service.aprobar(INCIDENTE_ID, "10.00", ADMIN_2)).toEqual({
      status: "conflict",
      motivo: MSG_INCIDENTE_YA_RESUELTO,
    });
  });

  it("`fuera_de_alcance` del repo se traduce a `no_encontrada`", async () => {
    const { service } = build({
      porId: fila({ reportadoPor: "u-maestro" }),
      resolver: "fuera_de_alcance",
    });
    expect(await service.aprobar(INCIDENTE_ID, "10.00", ADMIN_2)).toEqual({
      status: "no_encontrada",
    });
  });
});

describe("R54/R57/R58 — la reversion DERIVA su destino, no lo hardcodea", () => {
  it.each([...ORIGENES_INCIDENTE_ADMIN])(
    "R57: si el historial dice `%s`, la orden vuelve EXACTAMENTE ahi",
    async (origen) => {
      const { service, repo, historialRepo } = build({
        porId: fila({ reportadoPor: "u-maestro" }),
        origenReversion: origen,
      });

      const r = await service.rechazar(INCIDENTE_ID, "no procede", ADMIN_2);

      expect(r).toEqual({
        status: "ok",
        incidenteId: INCIDENTE_ID,
        estado: "rechazado",
      });
      // El lector de la 149, reusado tal cual, con el estatus ACTUAL de la orden.
      expect(historialRepo.findOrigenesReversion).toHaveBeenCalledWith([
        { ordenId: ORDEN_ID, estatusActualId: "os-incidente" },
      ]);
      const arg = repo.resolver.mock.calls[0][0];
      expect(arg.reversion).toEqual({
        ordenId: ORDEN_ID,
        incidenteEstatusId: "os-incidente",
        destinoEstatusId: `os-${origen}`,
      });
      // R54: sin monto y con el motivo del aprobador.
      expect(arg.monto).toBeNull();
      expect(arg.motivoRechazo).toBe("no procede");
      expect(arg.nuevoEstado).toBe("rechazado");
    },
  );

  it("R58: sin fila de historial (origen null) -> conflict SIN mover nada", async () => {
    const { service, repo } = build({
      porId: fila({ reportadoPor: "u-maestro" }),
      origenReversion: null,
    });

    const r = await service.rechazar(INCIDENTE_ID, "no procede", ADMIN_2);

    expect(r).toEqual({ status: "conflict", motivo: MSG_SIN_ORIGEN_REVERSIBLE });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  // El ultimo caso usa un value RETIRADO del catalogo (el estado de fulfillment que quito la
  // 155), construido por concatenacion como hace el resto del repo para no reintroducir el
  // literal — el historial es INMUTABLE y todavia cita ese value en filas viejas, asi que es un
  // origen que la derivacion puede devolver de verdad.
  const VALUE_RETIRADO_155 = ["en", "fulfillment"].join("_");

  it.each([
    ["en_reparto (es el camino del MENSAJERO, no el del admin)", "en_reparto"],
    ["entregada", "entregada"],
    ["devuelta", "devuelta"],
    ["en_preparacion", "en_preparacion"],
    ["un value RETIRADO del catalogo que el historial aun cita", VALUE_RETIRADO_155],
  ])("R58: un origen fuera del conjunto cerrado (%s) -> conflict, fallo CERRADO", async (_c, origen) => {
    const { service, repo } = build({
      porId: fila({ reportadoPor: "u-maestro" }),
      origenReversion: origen,
    });

    const r = await service.rechazar(INCIDENTE_ID, "no procede", ADMIN_2);

    expect(r).toEqual({ status: "conflict", motivo: MSG_SIN_ORIGEN_REVERSIBLE });
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("R58: si el catalogo no resuelve el origen derivado -> validation_error sin mover nada", async () => {
    const { service, repo } = build({
      porId: fila({ reportadoPor: "u-maestro" }),
      origenReversion: "por_recoger",
      estatusIds: { incidente: "os-incidente" }, // `por_recoger` no resuelve
    });

    const r = await service.rechazar(INCIDENTE_ID, "no procede", ADMIN_2);

    expect(r.status).toBe("validation_error");
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("R59: el RETRACTO del autor usa la MISMA derivacion y NO lleva motivo", async () => {
    const { service, repo } = build({
      porId: fila({ reportadoPor: "u-maestro" }),
      origenReversion: "en_ruta_bodega_satelite",
    });

    const r = await service.retractar(INCIDENTE_ID, MAESTRO);

    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID, estado: "rechazado" });
    const arg = repo.resolver.mock.calls[0][0];
    expect(arg.motivoRechazo).toBeNull();
    expect(arg.resueltoPor).toBe("u-maestro");
    expect(arg.reversion?.destinoEstatusId).toBe("os-en_ruta_bodega_satelite");
    expect(arg.monto).toBeNull();
  });

  it("R60: la reversion NO menciona `mensajeroAsignadoId` ni `asignadoAt` por ninguna parte", async () => {
    // Q-K: el reporte no los toco, asi que no hay nada que reponer. Si alguien empezara a
    // pasarlos por aqui, este caso lo caza antes de que R60 deje de ser cierto por construccion.
    const { service, repo } = build({ porId: fila({ reportadoPor: "u-maestro" }) });
    await service.rechazar(INCIDENTE_ID, "no procede", ADMIN_2);
    const arg = JSON.stringify(repo.resolver.mock.calls[0][0]);
    expect(arg).not.toContain("mensajero");
    expect(arg).not.toContain("asignado");
  });
});
