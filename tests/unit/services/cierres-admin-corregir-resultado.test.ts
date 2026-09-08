import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  GestionEditableDelCierre,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// 💰 FICHA 398 (T3.2) — LAS CINCO GUARDIAS de la CORRECCION EN SITIO del resultado de una gestion
// (`entregada -> rechazada`) desde el detalle de un cierre abierto. Dobles del repositorio, sin
// base: lo que se afirma es QUE NO LLEGA A ESCRIBIRSE, y cada caso comprueba CERO llamadas al
// repositorio.
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PUEDE PROBAR, y por eso existe el otro: los dobles NO VEN EL SQL.
// Que filas se tocan, cuales no, y si el `WHERE` guarda de verdad, lo mide
// `tests/integration/db/correccion-resultado-gestion.int.test.ts` contra Postgres real. Medido
// cuatro veces en este repo: una mutacion del `WHERE` pasa en verde por aqui arriba.
//
// Por que cada rechazo esta aqui y no es ruido: los cinco son las cinco formas de sacar dinero de
// un cierre sin derecho a hacerlo. La correccion BORRA un cobro del cierre, pone el pago de esa
// gestion a cero y le atribuye a la bodega un ingreso por rechazo: colarla desde un rol que no
// debe, sobre un cierre ya liquidado, sobre una bodega ajena o sobre una gestion que no era una
// entrega no produce un numero feo — mueve plata.

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "adm-2", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const ADMIN_TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };

const GESTION = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const MOTIVO = "el cliente rechazo el paquete";

/** La gestion corregible por defecto: una entrega de 10.000 dentro de un cierre `solicitado`. */
function editable(overrides: Partial<GestionEditableDelCierre> = {}): GestionEditableDelCierre {
  return {
    gestionId: GESTION,
    cierreId: "c-1",
    cierreEstado: "solicitado",
    resultado: "entregada",
    montoRecibido: "10000.00",
    pagos: [{ metodo: "efectivo", monto: "10000.00" }],
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<ICierresAdminRepository> = {}): ICierresAdminRepository {
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
    findGestionEditableEnCierre: vi.fn(async () => editable()),
    // La correccion del DESGLOSE: doble mudo, esta suite no la ejercita.
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
    corregirResultadoGestionEnCierre: vi.fn(async () => ({
      status: "updated" as const,
      totales: {
        efectivo: "0.00",
        simpe: "0.00",
        transferencia: "0.00",
        general: "0.00",
      },
    })),
    ...overrides,
  };
}

/** El catalogo de estados, espiable: los dos ids que la correccion resuelve antes de escribir. */
function fakeOrdenRepo(estatusPorValue: (v: string) => string | null = () => "os-x") {
  return {
    findUsuarioZonaId: vi.fn(async () => "z-sat"),
    findEstatusIdByValue: vi.fn(async (value: string) => estatusPorValue(value)),
  } as unknown as IOrdenRepository;
}

function newService(repo: ICierresAdminRepository, ordenRepo = fakeOrdenRepo()) {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  return new CierresAdminService(
    repo,
    zonaRepo,
    ordenRepo,
    signedUrls,
    {
      sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, "0.00"])),
      ),
      obtenerCierreParaPago: vi.fn(async () => null),
    },
    {
      sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, "0.00"])),
      ),
    },
  );
}

// ---------------------------------------------------------------------------------------------
// R1 — quien corrige
// ---------------------------------------------------------------------------------------------

describe("398/R1 — solo el maestro y el admin corrigen un resultado", () => {
  it("maestro y admin corrigen, y lo que llega al repo es el motivo RECORTADO y el actor", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const repo = fakeRepo();
      const r = await newService(repo).corregirResultadoGestion(
        { gestionId: GESTION, motivo: `  ${MOTIVO}  ` },
        actor,
      );
      expect(r.status, actor.rol).toBe("ok");
      expect(repo.corregirResultadoGestionEnCierre).toHaveBeenCalledTimes(1);
      const escritura = vi.mocked(repo.corregirResultadoGestionEnCierre).mock.calls[0]![0];
      expect(escritura.gestionId).toBe(GESTION);
      expect(escritura.motivo).toBe(MOTIVO); // recortado por el servicio
      expect(escritura.corregidoPor).toBe(actor.usuarioId); // el rastro
      // Los DOS ids del catalogo bajan resueltos: la capa de datos no lee catalogos.
      expect(escritura.estatusEntregadaId).toBe("os-x");
      expect(escritura.estatusRechazadaId).toBe("os-x");
    }
  });

  it.each([
    ["adminSatelite", ADMIN_SATELITE],
    ["mensajero", MENSAJERO],
    ["adminTienda", ADMIN_TIENDA],
  ])("R1: %s recibe `forbidden` y el repositorio NO se toca", async (_nombre, actor) => {
    const repo = fakeRepo();
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      actor,
    );
    expect(r).toEqual({ status: "forbidden" });
    // CERO llamadas: ni la lectura previa, y menos la escritura.
    expect(repo.findGestionEditableEnCierre).not.toHaveBeenCalled();
    expect(repo.corregirResultadoGestionEnCierre).not.toHaveBeenCalled();
  });

  it("R1: el `adminSatelite` NO corrige aunque tenga alcance para VER ese cierre", async () => {
    // Es la unica de las tres que sorprende, y por eso se afirma sola: `resolveAlcance` le da
    // alcance sobre su bodega, asi que sin el guard de ROL —que va ANTES y no se apoya en el
    // alcance— esta correccion le quedaria abierta.
    const repo = fakeRepo();
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      ADMIN_SATELITE,
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.corregirResultadoGestionEnCierre).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// R2 — que se corrige, y que no se distingue
// ---------------------------------------------------------------------------------------------

describe("398/R2 — inexistente, anulada o fuera de alcance son el MISMO desenlace", () => {
  it("la lectura previa devuelve `null` -> `no_encontrada`, sin escribir", async () => {
    const repo = fakeRepo({ findGestionEditableEnCierre: vi.fn(async () => null) });
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      MAESTRO,
    );
    expect(r).toEqual({ status: "no_encontrada" });
    expect(repo.corregirResultadoGestionEnCierre).not.toHaveBeenCalled();
  });

  it("un `fuera_de_alcance` del repositorio tambien sale como `no_encontrada`", async () => {
    // La escritura SI se intenta (la lectura previa dejo pasar), y el repositorio decide que no es
    // suya. El servicio NO lo distingue de «no existe»: distinguirlo revelaria cierres ajenos.
    const repo = fakeRepo({
      corregirResultadoGestionEnCierre: vi.fn(async () => ({
        status: "fuera_de_alcance" as const,
      })),
    });
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      MAESTRO,
    );
    expect(r).toEqual({ status: "no_encontrada" });
  });
});

// ---------------------------------------------------------------------------------------------
// R3 / R12 — el estado del cierre
// ---------------------------------------------------------------------------------------------

describe("398/R3 — solo un cierre ABIERTO se corrige", () => {
  it.each(["aprobado", "rechazado"] as const)(
    "un cierre `%s` es `conflict` y el repositorio NO se toca",
    async (estado) => {
      const repo = fakeRepo({
        findGestionEditableEnCierre: vi.fn(async () => editable({ cierreEstado: estado })),
      });
      const r = await newService(repo).corregirResultadoGestion(
        { gestionId: GESTION, motivo: MOTIVO },
        MAESTRO,
      );
      expect(r, estado).toEqual({ status: "conflict" });
      expect(repo.corregirResultadoGestionEnCierre, estado).not.toHaveBeenCalled();
    },
  );

  it.each(["solicitado", "vencido"] as const)(
    "un cierre `%s` SI se corrige (contrapunto: si todo diera conflict, los dos de arriba no dirian nada)",
    async (estado) => {
      const repo = fakeRepo({
        findGestionEditableEnCierre: vi.fn(async () => editable({ cierreEstado: estado })),
      });
      const r = await newService(repo).corregirResultadoGestion(
        { gestionId: GESTION, motivo: MOTIVO },
        MAESTRO,
      );
      expect(r.status, estado).toBe("ok");
      expect(repo.corregirResultadoGestionEnCierre, estado).toHaveBeenCalledTimes(1);
    },
  );

  it("R12: un `conflict` del repositorio (carrera) se propaga como `conflict`", async () => {
    const repo = fakeRepo({
      corregirResultadoGestionEnCierre: vi.fn(async () => ({ status: "conflict" as const })),
    });
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      MAESTRO,
    );
    expect(r).toEqual({ status: "conflict" });
  });
});

// ---------------------------------------------------------------------------------------------
// R4 — que resultado se corrige
// ---------------------------------------------------------------------------------------------

describe("398/R4 — solo una `entregada` se corrige a rechazo", () => {
  it.each(["rechazada", "reprogramada", "devuelta", "incidente"] as const)(
    "una gestion `%s` es `validation_error` y el repositorio NO se toca",
    async (resultado) => {
      const repo = fakeRepo({
        findGestionEditableEnCierre: vi.fn(async () => editable({ resultado })),
      });
      const r = await newService(repo).corregirResultadoGestion(
        { gestionId: GESTION, motivo: MOTIVO },
        MAESTRO,
      );
      expect(r.status, resultado).toBe("validation_error");
      expect(r, resultado).toMatchObject({ fieldErrors: { resultado: [expect.any(String)] } });
      expect(repo.corregirResultadoGestionEnCierre, resultado).not.toHaveBeenCalled();
    },
  );

  it("una entrega SIN cobro TAMBIEN se corrige: lo que se arregla es si hubo entrega", async () => {
    // Diferencia deliberada con la correccion del DESGLOSE, que exige `monto_recibido > 0`: alli
    // lo que se reparte es un cobro y sin cobro no hay nada que repartir. Aqui lo que se corrige
    // es el RESULTADO, y una entrega sin cobro mal declarada sigue pagandole al mensajero un
    // `cobroEntregado` que no gano y sigue contando como entrega en el conteo de intentos.
    const repo = fakeRepo({
      findGestionEditableEnCierre: vi.fn(async () =>
        editable({ montoRecibido: null, pagos: [] }),
      ),
    });
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(repo.corregirResultadoGestionEnCierre).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------
// R5 — el motivo
// ---------------------------------------------------------------------------------------------

describe("398/R5 — el motivo es obligatorio y no puede quedar vacio al recortarlo", () => {
  it.each(["", "   ", "\t\n "])(
    "el motivo %j es `validation_error` y el repositorio NO se toca",
    async (motivo) => {
      const repo = fakeRepo();
      const r = await newService(repo).corregirResultadoGestion(
        { gestionId: GESTION, motivo },
        MAESTRO,
      );
      expect(r.status).toBe("validation_error");
      expect(r).toMatchObject({ fieldErrors: { motivo: [expect.any(String)] } });
      expect(repo.corregirResultadoGestionEnCierre).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// El catalogo: fallo CERRADO
// ---------------------------------------------------------------------------------------------

describe("398 — si el catalogo de estados no resuelve, NO se escribe nada", () => {
  it.each([
    ["falta `entregada`", (v: string) => (v === "entregada" ? null : "os-r")],
    ["falta `rechazada`", (v: string) => (v === "rechazada" ? null : "os-e")],
  ])("%s -> `conflict` sin tocar el repositorio", async (_nombre, resolver) => {
    // FALLO CERRADO: «no se pudo resolver» se trata como «no», y no como «sigue adelante sin
    // mover la orden». Escribir la gestion sin transicionar la orden dejaria una gestion
    // `rechazada` con su orden todavia en `entregada`, que es peor que no haber corregido.
    const repo = fakeRepo();
    const r = await newService(repo, fakeOrdenRepo(resolver)).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      MAESTRO,
    );
    expect(r).toEqual({ status: "conflict" });
    expect(repo.corregirResultadoGestionEnCierre).not.toHaveBeenCalled();
  });

  it("los dos ids se piden por su `value` del catalogo, no por un literal escrito a mano", async () => {
    const ordenRepo = fakeOrdenRepo();
    await newService(fakeRepo(), ordenRepo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      MAESTRO,
    );
    const pedidos = vi.mocked(ordenRepo.findEstatusIdByValue).mock.calls.map((c) => c[0]);
    expect([...pedidos].sort()).toEqual(["entregada", "rechazada"]);
  });
});

// ---------------------------------------------------------------------------------------------
// El orden de las guardias: la mas reveladora, la ultima
// ---------------------------------------------------------------------------------------------

describe("398 — el ORDEN de las guardias: rol antes que alcance, alcance antes que estado", () => {
  it("un mensajero sobre un cierre APROBADO recibe `forbidden`, no `conflict`", async () => {
    // Si el estado se comprobara antes que el rol, la respuesta diria «ese cierre ya se aprobo» a
    // alguien que no tiene por que saber que ese cierre existe.
    const repo = fakeRepo({
      findGestionEditableEnCierre: vi.fn(async () => editable({ cierreEstado: "aprobado" })),
    });
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: MOTIVO },
      MENSAJERO,
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("un maestro sobre una gestion inexistente recibe `no_encontrada`, no `validation_error` del motivo", async () => {
    // El alcance va ANTES que el motivo: un motivo vacio sobre una gestion ajena no debe revelar
    // que la gestion existe... y sobre una inexistente tampoco debe adelantar el error de forma.
    const repo = fakeRepo({ findGestionEditableEnCierre: vi.fn(async () => null) });
    const r = await newService(repo).corregirResultadoGestion(
      { gestionId: GESTION, motivo: "   " },
      MAESTRO,
    );
    expect(r).toEqual({ status: "no_encontrada" });
  });
});
