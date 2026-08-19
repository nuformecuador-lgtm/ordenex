import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  Alcance,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 158 (T1.12, R19/R20/R21/R25/R36) — las GUARDIAS de la captura de indemnizaciones al
// aprobar un cierre. Dobles del repo (sin DB): lo que se afirma es que un envio con cobertura
// incorrecta NO llega al repo, y que el envio correcto pasa los montos TAL CUAL.

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const G1 = "g-incidente-1";
const G2 = "g-incidente-2";

/**
 * Una gestion `incidente` del cierre, tal como la devuelve el repo.
 *
 * Fix «tope de negocio» (2026-08-04): la lectura pasó de `string[]` a llevar tambien el valor de
 * la orden. Esta suite —que mide COBERTURA, no importe— lo deja en `null` a proposito: `null`
 * significa «el tope de negocio no aplica», asi que estos casos siguen midiendo exactamente lo
 * que median. El tope tiene sus propias suites
 * (`indemnizacion-tope-negocio-{cierre,incidente}.test.ts`).
 */
function inc(gestionId: string) {
  return { gestionId, ordenMontoCobrar: null };
}

function fakeRepo(overrides: Partial<ICierresAdminRepository> = {}): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => []),
    // Feature 170 (T I.1): el historico paginado. Doble no-op: esta suite no lo ejercita.
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    // Feature 184 (T D.1): los dos CONJUNTOS de la descarga. Dobles no-op: esta suite no los
    // ejercita (viven en `cierres-admin-completo.test.ts`).
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    // Feature 230 (T2.1): el doble implementa la interfaz ENTERA. Estos casos no ejercitan la
    // descarga detallada; devolver el conjunto vacio deja el camino de la 38 intacto.
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [] })),
    // Pedido humano (2026-08-19): la correccion del desglose. Dobles no-op: esta suite no la
    // ejercita (vive en `cierres-admin-corregir-pagos.test.ts`).
    findGestionEditableEnCierre: vi.fn(async () => null),
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
    ...overrides,
  };
}

function newService(repo: ICierresAdminRepository, zonaDelSatelite: string | null = "z-sat") {
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => zonaDelSatelite),
    findEstatusIdByValue: vi.fn(async () => "os-x"),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  // Feature 172 (T C.2): el pendiente del cierre recien aprobado. Esta suite no lo mide (vive
  // en `cierres-admin-pendiente.test.ts`): sin cierre releible, el servicio devuelve "0.00".
  return new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls, {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  });
}

function resolverCall(repo: ICierresAdminRepository) {
  return (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

describe("R36 — un cierre SIN incidentes se aprueba exactamente como hoy", () => {
  it("sin incidentes y sin montos -> ok, con la lista vacia hacia el repo", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).aprobarCierre("c1", MAESTRO);

    expect(r).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00", // feature 172/T C.2
    });
    expect(repo.resolverCierre).toHaveBeenCalledTimes(1);
    expect(resolverCall(repo).indemnizaciones).toEqual([]);
  });

  it("el tercer parametro es OPCIONAL: llamar como la 38 sigue funcionando", async () => {
    const repo = fakeRepo();
    // Firma de la 38, sin tocar: `aprobarCierre(cierreId, actor)`.
    const r = await newService(repo).aprobarCierre("c1", MAESTRO);
    expect(r.status).toBe("ok");
  });
});

describe("R19/R20 — falta el monto de alguna gestion `incidente`", () => {
  it("cierre con UN incidente y lista VACIA -> validation_error, sin tocar el repo", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1)]) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, []);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors[G1]).toBeDefined();
    // El cierre queda `solicitado` y NO se emite ningun movimiento: el repo ni se invoca.
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("cierre con DOS incidentes y solo UN monto -> error en la gestion que falta", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1), inc(G2)]) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "100.00" },
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(Object.keys(r.fieldErrors)).toEqual([G2]);
    expect(r.fieldErrors[G2][0]).toMatch(/falta el monto/i);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

describe("R21 — sobra un monto, o no corresponde a este cierre", () => {
  it("un `gestionId` que no es incidente de este cierre -> validation_error por esa entrada", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1)]) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "100.00" },
      { gestionId: "g-de-otro-cierre", monto: "999999.00" },
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors["g-de-otro-cierre"][0]).toMatch(/no corresponde/i);
    expect(r.fieldErrors[G1]).toBeUndefined(); // el que si corresponde no se marca
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("montos para un cierre SIN incidentes -> validation_error (no se cuela dinero)", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => []) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "50000.00" },
    ]);

    expect(r.status).toBe("validation_error");
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("R21: DOS montos para la MISMA gestion -> validation_error (sin esto, el ultimo ganaria)", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1)]) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "100.00" },
      { gestionId: G1, monto: "999999.00" },
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors[G1][0]).toMatch(/dos montos/i);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("acumula TODOS los errores en la MISMA respuesta (falta uno y sobra otro)", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1), inc(G2)]) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "100.00" },
      { gestionId: "g-ajena", monto: "1.00" },
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(Object.keys(r.fieldErrors).sort()).toEqual([G2, "g-ajena"].sort());
  });
});

describe("R19/R22 — con cobertura EXACTA la aprobacion procede", () => {
  it("un monto por cada incidente -> ok, y los montos llegan TAL CUAL al repo", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1), inc(G2)]) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "12500.75" },
      { gestionId: G2, monto: "300.25" },
    ]);

    expect(r).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00", // feature 172/T C.2
    });
    const call = resolverCall(repo);
    expect(call.nuevoEstado).toBe("aprobado");
    // R24: STRING de extremo a extremo — el service NO convierte a number ni redondea.
    expect(call.indemnizaciones).toEqual([
      { gestionId: G1, monto: "12500.75" },
      { gestionId: G2, monto: "300.25" },
    ]);
  });

  it("el orden de los montos no importa (se compara por CONJUNTO, no por posicion)", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1), inc(G2)]) });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G2, monto: "2.00" },
      { gestionId: G1, monto: "1.00" },
    ]);

    expect(r.status).toBe("ok");
  });
});

describe("R25 — alcance: la lectura de incidentes va acotada, y no revela nada", () => {
  it("la consulta de incidentes lleva el ALCANCE del actor (no se filtra en memoria)", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => []) });
    await newService(repo).aprobarCierre("c1", ADMIN_SATELITE);

    const alcance = (
      repo.findGestionesIncidenteDelCierre as ReturnType<typeof vi.fn>
    ).mock.calls[0][1] as Alcance;
    expect(alcance).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" });
  });

  it("un rol no autorizado -> forbidden ANTES de consultar nada del cierre", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).aprobarCierre("c1", MENSAJERO, [
      { gestionId: G1, monto: "1.00" },
    ]);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findGestionesIncidenteDelCierre).not.toHaveBeenCalled();
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("un adminSatelite SIN zona -> no_encontrada, sin consultar el cierre ni resolverlo", async () => {
    const repo = fakeRepo();
    const r = await newService(repo, null).aprobarCierre("c1", ADMIN_SATELITE, [
      { gestionId: G1, monto: "1.00" },
    ]);

    expect(r).toEqual({ status: "no_encontrada" });
    expect(repo.findGestionesIncidenteDelCierre).not.toHaveBeenCalled();
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("un cierre FUERA de alcance no expone incidentes: el repo devuelve [] y la guardia lo trata como 'sin incidentes'", async () => {
    // R25: no se distingue "no existe" de "de otra bodega/zona". Con lista vacia y sin montos
    // la aprobacion sigue, y es el `resolverCierre` guardado por alcance el que devuelve
    // `fuera_de_alcance` -> `no_encontrada`, sin filtrar ningun dato del cierre.
    const repo = fakeRepo({
      findGestionesIncidenteDelCierre: vi.fn(async () => []),
      resolverCierre: vi.fn(async () => "fuera_de_alcance" as const),
    });

    const r = await newService(repo).aprobarCierre("c-ajeno", MAESTRO);

    expect(r).toEqual({ status: "no_encontrada" });
  });

  it("los mensajes de error NO llevan PII (ni mensajero, ni destinatario, ni montos)", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1)]) });
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, []);
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    const texto = Object.values(r.fieldErrors).flat().join(" ");
    expect(texto).not.toMatch(/m1|adm|c1|\d+\.\d{2}/);
  });
});

describe("R23 — el RECHAZO no captura montos", () => {
  it("rechazarCierre no consulta incidentes ni pasa `indemnizaciones` al repo", async () => {
    const repo = fakeRepo({ findGestionesIncidenteDelCierre: vi.fn(async () => [inc(G1)]) });

    const r = await newService(repo).rechazarCierre("c1", "no cuadra", MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.findGestionesIncidenteDelCierre).not.toHaveBeenCalled();
    expect(resolverCall(repo).indemnizaciones).toBeUndefined();
  });
});
