import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { descargaConfig } from "@/lib/config/descarga";
import type {
  Alcance,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";

// Feature 230 — Tanda 2 (T2.2, R13-R16/R18/R20/R21/R22/R37/R38) — el CONJUNTO de gestiones del
// que sale la hoja fundida de «Cierres del día».
//
// El repositorio doble NO es un stub que devuelve lo que se le diga: aplica DE VERDAD el alcance
// que recibe y los recortes que recibe, sobre un almacén con gestiones de la bodega central y de
// dos zonas satélite, de tres mensajeros. Es lo único que hace honestos los casos de R14 y R37:
// si el servicio pasara un alcance distinto —o ninguno—, las filas cambiarían. Con un stub, un
// servicio que ignorase el alcance pasaría todos los casos.
//
// Lo que esta suite NO puede ver es la traducción de ese alcance a SQL: el doble no emite
// consultas. Eso vive en `tests/unit/repositories/cierres-admin-gestiones-where.test.ts`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const SATELITE_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SATELITE_SIN_ZONA: Actor = { usuarioId: "u-sat-sin", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-sin": null, // R20: tiene acceso al módulo; lo que no tiene es alcance
};

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
];

/** Una gestión del almacén, con lo que hace falta para decidir si el alcance la alcanza. */
interface GestionAlmacen {
  numRemision: string;
  mensajeroId: string;
  destinoTipo: "bodega_central" | "bodega_satelite";
  destinoZonaId: string;
  dia: string; // YYYY-MM-DD del `solicitadoAt` del cierre
}

const ALMACEN: GestionAlmacen[] = [
  { numRemision: "GAM-1", mensajeroId: "m-gam", destinoTipo: "bodega_central", destinoZonaId: "z-central", dia: "2026-02-10" },
  { numRemision: "GAM-2", mensajeroId: "m-gam", destinoTipo: "bodega_central", destinoZonaId: "z-central", dia: "2026-02-20" },
  { numRemision: "A-1", mensajeroId: "m-a", destinoTipo: "bodega_satelite", destinoZonaId: "z-a", dia: "2026-02-10" },
  { numRemision: "A-2", mensajeroId: "m-a", destinoTipo: "bodega_satelite", destinoZonaId: "z-a", dia: "2026-02-20" },
  { numRemision: "B-1", mensajeroId: "m-b", destinoTipo: "bodega_satelite", destinoZonaId: "z-b", dia: "2026-02-10" },
];

function dto(g: GestionAlmacen): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: g.mensajeroId,
    cierreSolicitadoAt: `${g.dia}T12:00:00.000Z`,
    numGuia: null,
    numRemision: g.numRemision,
    destinatario: "Bea",
    direccion: null,
    zonaNombre: "Zona",
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

/**
 * Repositorio doble HONESTO: aplica el alcance recibido y los recortes recibidos, exactamente
 * como los aplicaría el WHERE real. Cuenta sus llamadas para poder afirmar «sin tocar el repo».
 */
function fakeRepo(almacen: GestionAlmacen[] = ALMACEN) {
  const findGestionesPorAlcanceCompleto = vi.fn(
    async (alcance: Alcance, filtros: FiltrosDescargaGestiones) => {
      const elegidos = new Set(filtros.mensajeroIds);
      return almacen
        .filter((g) => g.destinoTipo === alcance.destinoTipo)
        .filter((g) => alcance.destinoZonaId === null || g.destinoZonaId === alcance.destinoZonaId)
        .filter((g) => elegidos.has(g.mensajeroId))
        .filter((g) => filtros.desde === undefined || g.dia >= filtros.desde)
        .filter((g) => filtros.hasta === undefined || g.dia <= filtros.hasta)
        .map(dto);
    },
  );
  return {
    findCierresByAlcance: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    findGestionesPorAlcanceCompleto,
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
  } as unknown as ICierresAdminRepository & {
    findGestionesPorAlcanceCompleto: typeof findGestionesPorAlcanceCompleto;
  };
}

/** El firmador se pasa como espía: R22 se mide contando invocaciones, no leyendo el código. */
function newService(repo: ReturnType<typeof fakeRepo>) {
  const createSignedUrls = vi.fn(async () => []);
  const service = new CierresAdminService(
    repo,
    { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository,
    {
      findUsuarioZonaId: vi.fn(async (id: string) => ZONA_POR_USUARIO[id] ?? null),
      findEstatusIdByValue: vi.fn(async () => null),
    } as unknown as IOrdenRepository,
    { createSignedUrls } as unknown as ISignedUrlProvider,
    {
      sumarVigentesPorCierre: vi.fn(async () => new Map()),
      obtenerCierreParaPago: vi.fn(async () => null),
    } as never,
    // Feature 293 (T2.3): lectura de premios; este caso no los ejercita.
    { sumarPremiosVivosPorCierre: vi.fn(async () => ({})) },
  );
  return { service, createSignedUrls };
}

const TODOS = { mensajeroIds: ["m-gam", "m-a", "m-b"] };

async function remisiones(actor: Actor, filtros: FiltrosDescargaGestiones, repo = fakeRepo()) {
  const r = await newService(repo).service.listarGestionesCierresAdminCompleto(actor, filtros);
  return r.status === "ok" ? r.items.map((i) => i.numRemision) : r.status;
}

describe("conjunto de gestiones de «Cierres del día» (feature 230, T2.2)", () => {
  it("el maestro recibe las gestiones de su alcance: los cierres con destino bodega central", async () => {
    // Es la GAM, y no hace falta ningún `if` que la nombre (R27): entra sola por el
    // `destinoTipo` que el alcance ya fija.
    expect(await remisiones(MAESTRO, TODOS)).toEqual(["GAM-1", "GAM-2"]);
  });

  it("el satélite no recibe gestiones de cierres fuera de su zona destino (R14)", async () => {
    // Ni las de la zona vecina (B-1) ni las de la central (GAM-*), aunque las haya pedido.
    expect(await remisiones(SATELITE_A, TODOS)).toEqual(["A-1", "A-2"]);
  });

  it("el alcance no se lee de la entrada: pedir mensajeros ajenos no amplía nada (R15)", async () => {
    const repo = fakeRepo();
    await remisiones(SATELITE_A, TODOS, repo);

    // La prueba directa: el alcance que llega al repositorio es el del ACTOR, y el `filtros` que
    // llega NO contiene ninguna clave de alcance que pudiera sobreescribirlo.
    const [alcance, filtros] = repo.findGestionesPorAlcanceCompleto.mock.calls[0]!;
    expect(alcance).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: "z-a" });
    expect(Object.keys(filtros).sort()).toEqual(["mensajeroIds"]);
  });

  it("pedir un mensajero fuera de alcance devuelve cero filas, no filas ajenas (R37)", async () => {
    expect(await remisiones(SATELITE_A, { mensajeroIds: ["m-b"] })).toEqual([]);
  });

  it("«fuera de alcance» y «sin cierres en el rango» son el MISMO desenlace (R38)", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    const ajeno = await service.listarGestionesCierresAdminCompleto(SATELITE_A, {
      mensajeroIds: ["m-b"], // existe, pero es de otra zona
    });
    const sinCierres = await service.listarGestionesCierresAdminCompleto(SATELITE_A, {
      mensajeroIds: ["m-a"],
      desde: "2030-01-01",
      hasta: "2030-01-31",
    });

    // Indistinguibles a propósito: distinguirlos filtraría información sobre el alcance ajeno.
    expect(ajeno).toEqual(sinCierres);
    expect(ajeno).toEqual({ status: "ok", items: [], total: 0 });
  });

  it("el rango de fechas recorta DENTRO del alcance, nunca fuera (R31/R33)", async () => {
    expect(await remisiones(SATELITE_A, { mensajeroIds: ["m-a", "m-b"], hasta: "2026-02-15" })).toEqual([
      "A-1",
    ]);
  });

  it.each(ROLES_SIN_ACCESO)(
    "un rol no admin recibe forbidden antes de tocar el repositorio (R18): $rol",
    async (actor) => {
      const repo = fakeRepo();
      const { service } = newService(repo);

      const r = await service.listarGestionesCierresAdminCompleto(actor, TODOS);

      expect(r).toEqual({ status: "forbidden" });
      expect(repo.findGestionesPorAlcanceCompleto).not.toHaveBeenCalled();
    },
  );

  it("un adminSatelite sin zona recibe conjunto vacío sin consultar la base, y NO forbidden (R20)", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    const r = await service.listarGestionesCierresAdminCompleto(SATELITE_SIN_ZONA, TODOS);

    // La distinción importa: `forbidden` diría «no puedes entrar aquí», y sí puede — lo que no
    // tiene es zona asignada. El mensaje que ve es el de «sin datos», como todo el módulo.
    expect(r).toEqual({ status: "ok", items: [], total: 0 });
    expect(repo.findGestionesPorAlcanceCompleto).not.toHaveBeenCalled();
  });

  it("superar el tope de descargaConfig devuelve limite_excedido con conteos y sin filas (R21)", async () => {
    const exceso = descargaConfig.MAX_FILAS + 1;
    const almacen: GestionAlmacen[] = Array.from({ length: exceso }, (_, i) => ({
      numRemision: `GAM-${i}`,
      mensajeroId: "m-gam",
      destinoTipo: "bodega_central" as const,
      destinoZonaId: "z-central",
      dia: "2026-02-10",
    }));

    const r = await newService(fakeRepo(almacen)).service.listarGestionesCierresAdminCompleto(
      MAESTRO,
      { mensajeroIds: ["m-gam"] },
    );

    // Error ACCIONABLE con los conteos, jamás un archivo truncado en silencio.
    expect(r).toEqual({ status: "limite_excedido", total: exceso, limite: descargaConfig.MAX_FILAS });
    expect(r).not.toHaveProperty("items");
  });

  it("justo EN el tope todavía devuelve el conjunto entero (el límite no se pasa por uno)", async () => {
    const almacen: GestionAlmacen[] = Array.from({ length: descargaConfig.MAX_FILAS }, (_, i) => ({
      numRemision: `GAM-${i}`,
      mensajeroId: "m-gam",
      destinoTipo: "bodega_central" as const,
      destinoZonaId: "z-central",
      dia: "2026-02-10",
    }));

    const r = await newService(fakeRepo(almacen)).service.listarGestionesCierresAdminCompleto(
      MAESTRO,
      { mensajeroIds: ["m-gam"] },
    );

    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.total).toBe(descargaConfig.MAX_FILAS);
  });

  it("no se firma ninguna URL de evidencia al producir el conjunto (R22)", async () => {
    const { service, createSignedUrls } = newService(fakeRepo());

    const r = await service.listarGestionesCierresAdminCompleto(MAESTRO, TODOS);

    expect(r.status).toBe("ok");
    // Cero invocaciones al firmador. No es una optimización: una URL firmada dentro de un archivo
    // que se reenvía por correo es acceso a la foto sin sesión.
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("el ADMIN de acceso total ve lo mismo que el maestro (el guard es el rol, no el usuario)", async () => {
    expect(await remisiones(ADMIN, TODOS)).toEqual(["GAM-1", "GAM-2"]);
  });
});
