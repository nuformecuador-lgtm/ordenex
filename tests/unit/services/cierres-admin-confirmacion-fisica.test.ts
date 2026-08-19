import { describe, it, expect, vi } from "vitest";

import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  GestionRetornableDelCierre,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 238 (T2.2/T2.3/T2.4, R7-R16) — LA COBERTURA EXACTA DE LOS PAQUETES QUE VUELVEN.
//
// Dobles del repo (sin DB): lo que se afirma es que un envio con cobertura incorrecta NO LLEGA AL
// REPO —es decir, no abre la transaccion que mueve el dinero, aprueba el cierre y ancla las
// devoluciones (R14)— y que el envio correcto pasa la lista tal cual.
//
// EN TODOS LOS ROJOS se comprueba que `repo.resolverCierre` no se llamo. Esa es la mitad del
// requisito que se olvida: un error devuelto DESPUES de haber tocado el repo dejaria el cierre
// aprobado y el mensaje de error en pantalla.

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };

const G_DEV = "g-devuelta-1";
const G_REC = "g-rechazada-1";
const G_REP = "g-reprogramada-1";
const G_INC = "g-incidente-1";

const GUIA: Record<string, number> = {
  [G_DEV]: 9001,
  [G_REC]: 9002,
  [G_REP]: 9003,
};

/** Una gestion del conjunto esperado, tal como la devuelve el repo. */
function ret(
  gestionId: string,
  resultado: GestionRetornableDelCierre["resultado"] = "devuelta",
  numGuia: number | null = GUIA[gestionId] ?? 9999,
): GestionRetornableDelCierre {
  return { gestionId, numGuia, resultado };
}

/** Lo que la pantalla mandaria por esa gestion si bodega escaneara su guia correcta. */
function ok(gestionId: string, numGuia: number = GUIA[gestionId] ?? 9999) {
  return { gestionId, numGuia };
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
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [] })),
    ...overrides,
  };
}

function newService(repo: ICierresAdminRepository) {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-sat"),
    findEstatusIdByValue: vi.fn(async () => "os-x"),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
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

/** Los `fieldErrors` de un resultado que TIENE que ser `validation_error`. */
function erroresDe(r: { status: string } & Record<string, unknown>): Record<string, string[]> {
  if (r.status !== "validation_error") {
    throw new Error(`esperaba validation_error y llego ${r.status}`);
  }
  return r.fieldErrors as Record<string, string[]>;
}

describe("238/R7/R8 — un cierre CON retornables no se aprueba sin confirmarlos", () => {
  it("confirmacion VACIA con tres paquetes que vuelven: rechaza y NO toca el repo", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [
        ret(G_DEV, "devuelta"),
        ret(G_REC, "rechazada"),
        ret(G_REP, "reprogramada"),
      ]),
    });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [], []);

    const errores = erroresDe(r);
    // R9: un error POR GESTION, no un mensaje global. Es lo que permite a la pantalla decir QUE
    // guias faltan en vez de bloquear en silencio.
    expect(Object.keys(errores).sort()).toEqual([G_DEV, G_REC, G_REP].sort());
    // R8/R14: el cierre queda `solicitado`, sin movimiento de dinero, sin transicion de orden y
    // sin escritura de confirmacion — porque el repo NI SE INVOCA.
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("R15: SIN el cuarto argumento se trata como lista vacia y se aplica R8 igual", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV)]),
    });

    // Llamada con la firma de la 158, sin el parametro nuevo: es lo que haria un cliente viejo.
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, []);

    expect(erroresDe(r)[G_DEV]).toEqual(["Falta confirmar la recepción de este paquete."]);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("R9: con DOS paquetes y UNO confirmado, el error va en el que FALTA", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV), ret(G_REC, "rechazada")]),
    });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [], [ok(G_DEV)]);

    const errores = erroresDe(r);
    expect(Object.keys(errores)).toEqual([G_REC]);
    expect(errores[G_REC][0]).toMatch(/falta confirmar/i);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

describe("238/R10 — sobra una entrada, o viene dos veces", () => {
  it("una gestion AJENA al conjunto esperado: error en ESA entrada", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV)]),
    });

    const r = await newService(repo).aprobarCierre(
      "c1",
      MAESTRO,
      [],
      [ok(G_DEV), { gestionId: "g-de-otro-cierre", numGuia: 7777 }],
    );

    const errores = erroresDe(r);
    expect(Object.keys(errores)).toEqual(["g-de-otro-cierre"]);
    expect(errores["g-de-otro-cierre"]).toEqual([
      "Esta gestión no pertenece a lo que vuelve en este cierre.",
    ]);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("la MISMA gestion confirmada dos veces: error de duplicada", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV), ret(G_REC, "rechazada")]),
    });

    // Sin esta guarda, dos entradas cubririan una sola gestion y el conteo cuadraria con un
    // paquete MENOS delante — que es exactamente el fallo que la feature viene a impedir.
    const r = await newService(repo).aprobarCierre(
      "c1",
      MAESTRO,
      [],
      [ok(G_DEV), ok(G_DEV), ok(G_REC)],
    );

    const errores = erroresDe(r);
    expect(errores[G_DEV]).toEqual(["Este paquete se confirmó dos veces."]);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

describe("238/R11 — un INCIDENTE enviado tiene su propio mensaje", () => {
  it("distinto del de gestion ajena, y nombrando que el paquete no vuelve", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV)]),
      // El incidente pertenece a ESTE cierre; simplemente no vuelve a bodega.
      findGestionesIncidenteDelCierre: vi.fn(async () => [
        { gestionId: G_INC, ordenMontoCobrar: null },
      ]),
    });

    const r = await newService(repo).aprobarCierre(
      "c1",
      MAESTRO,
      [],
      [ok(G_DEV), { gestionId: G_INC, numGuia: 9004 }],
    );

    const errores = erroresDe(r);
    expect(errores[G_INC]).toEqual([
      "Los incidentes no se confirman: el paquete no vuelve a bodega.",
    ]);
    // La diferencia con R10 no es cosmetica: «no pertenece» invita a buscar el paquete, y el
    // paquete de un incidente no esta en ninguna parte (se perdio, se robo o se dano).
    expect(errores[G_INC]).not.toEqual([
      "Esta gestión no pertenece a lo que vuelve en este cierre.",
    ]);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("R3: un incidente del cierre NO entra en el conjunto esperado ni bloquea por si solo", async () => {
    const repo = fakeRepo({
      // El cierre tiene UN retornable y UN incidente. Confirmar solo el retornable BASTA.
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV)]),
      findGestionesIncidenteDelCierre: vi.fn(async () => [
        { gestionId: G_INC, ordenMontoCobrar: null },
      ]),
    });

    const r = await newService(repo).aprobarCierre(
      "c1",
      MAESTRO,
      // El monto del incidente, que la 158 sigue exigiendo aparte.
      [{ gestionId: G_INC, monto: "1000.00" }],
      [ok(G_DEV)],
    );

    expect(r.status).toBe("ok");
    expect(repo.resolverCierre).toHaveBeenCalledTimes(1);
  });
});

describe("238/R12/R13 — la guia leida", () => {
  it("R12: una guia que NO es la de ese paquete rechaza la aprobacion", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV, "devuelta", 9001)]),
    });

    // Bodega escaneo un paquete que no es este: el conteo cuadraria igual, y por eso hace falta
    // comprobar la guia y no solo el id.
    const r = await newService(repo).aprobarCierre(
      "c1",
      MAESTRO,
      [],
      [{ gestionId: G_DEV, numGuia: 8888 }],
    );

    expect(erroresDe(r)[G_DEV]).toEqual(["La guía leída no es la de este paquete."]);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("R13: una gestion que vuelve SIN numero de guia bloquea con su mensaje propio", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV, "devuelta", null)]),
    });

    const r = await newService(repo).aprobarCierre(
      "c1",
      MAESTRO,
      [],
      [{ gestionId: G_DEV, numGuia: 9001 }],
    );

    const errores = erroresDe(r);
    expect(errores[G_DEV]).toEqual([
      "Este paquete no tiene número de guía y no se puede confirmar. Avisá a un administrador.",
    ]);
    // R13: NO se omite del conjunto esperado. Omitirla la aprobaria sin que nadie la tuviera
    // delante, que es la falla silenciosa que este mensaje evita.
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

describe("238/R7/R17 — el camino feliz", () => {
  it("confirmadas TODAS y con su guia correcta: aprueba y pasa SOLO los ids al repo", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [
        ret(G_DEV, "devuelta"),
        ret(G_REC, "rechazada"),
        ret(G_REP, "reprogramada"),
      ]),
    });

    const r = await newService(repo).aprobarCierre(
      "c1",
      MAESTRO,
      [],
      [ok(G_REC), ok(G_DEV), ok(G_REP)], // el ORDEN de llegada no importa
    );

    expect(r.status).toBe("ok");
    // Al repo viajan SOLO los ids: la guia ya se contrasto aqui y el repo no la persiste.
    expect(resolverCall(repo).confirmacionFisica).toEqual([
      { gestionId: G_REC },
      { gestionId: G_DEV },
      { gestionId: G_REP },
    ]);
  });
});

describe("238/R16 — un cierre SIN nada que devolver se aprueba como siempre", () => {
  // Medido contra produccion (T0.1): 3 de cada 12 cierres. NO es un `else` de cortesia, es un
  // camino de igual rango que se recorre una de cada cuatro veces.
  it("sin retornables y sin confirmacion: `ok`, y al repo va la lista VACIA", async () => {
    const repo = fakeRepo();

    const r = await newService(repo).aprobarCierre("c1", MAESTRO);

    expect(r).toEqual({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00",
    });
    expect(resolverCall(repo).confirmacionFisica).toEqual([]);
  });

  it("sin retornables, el servicio NO pide nada mas: una lectura y ni una consulta extra", async () => {
    const repo = fakeRepo();

    await newService(repo).aprobarCierre("c1", MAESTRO);

    // Se consulta el conjunto esperado UNA vez (hay que saber que esta vacio) y no se consultan
    // los incidentes por cuenta de esta feature: esa lectura es de la 158 y sigue siendo suya.
    expect(repo.findGestionesRetornablesDelCierre).toHaveBeenCalledTimes(1);
    expect(repo.findGestionesRetornablesDelCierre).toHaveBeenCalledWith("c1", {
      destinoTipo: "bodega_central",
      destinoZonaId: null,
    });
  });

  it("sin retornables PERO con una confirmacion enviada: se rechaza (no se ignora)", async () => {
    const repo = fakeRepo();

    // Una lista que sobra entera. Ignorarla en silencio dejaria pasar un cliente que cree estar
    // confirmando algo que este cierre no tiene.
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [], [ok(G_DEV)]);

    expect(erroresDe(r)[G_DEV]).toEqual([
      "Esta gestión no pertenece a lo que vuelve en este cierre.",
    ]);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

describe("238/T2.4 — las claves de error de las DOS coberturas no se pisan", () => {
  // No es hipotetico: medido en produccion, los 2 incidentes vivos conviven con retornables en
  // sus mismos cierres. Es EL caso, no un borde.
  it("un cierre con incidentes Y retornables produce claves DISJUNTAS", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV), ret(G_REC, "rechazada")]),
      findGestionesIncidenteDelCierre: vi.fn(async () => [
        { gestionId: G_INC, ordenMontoCobrar: null },
      ]),
    });

    // Falta confirmar `G_REC` y falta el monto de `G_INC`: los dos frentes rotos a la vez.
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [], [ok(G_DEV)]);

    const errores = erroresDe(r);
    // La confirmacion se valida ANTES (R37/§3.2), asi que este envio muere en la primera guardia
    // y el error que llega es el suyo, sobre SU gestion.
    expect(Object.keys(errores)).toEqual([G_REC]);
    expect(errores[G_REC][0]).toMatch(/falta confirmar/i);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("las dos guardias nombran gestiones de conjuntos DISJUNTOS por construccion", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV), ret(G_REC, "rechazada")]),
      findGestionesIncidenteDelCierre: vi.fn(async () => [
        { gestionId: G_INC, ordenMontoCobrar: null },
      ]),
    });
    const service = newService(repo);

    // (1) Confirmacion completa + monto AUSENTE -> el error es el de la 158, sobre el incidente.
    const soloMontos = await service.aprobarCierre("c1", MAESTRO, [], [ok(G_DEV), ok(G_REC)]);
    const erroresMontos = erroresDe(soloMontos);
    // (2) Confirmacion incompleta + monto presente -> el error es el de la 238, sobre su gestion.
    const soloConfirmacion = await service.aprobarCierre(
      "c1",
      MAESTRO,
      [{ gestionId: G_INC, monto: "1000.00" }],
      [ok(G_DEV)],
    );
    const erroresConfirmacion = erroresDe(soloConfirmacion);

    expect(Object.keys(erroresMontos)).toEqual([G_INC]);
    expect(Object.keys(erroresConfirmacion)).toEqual([G_REC]);
    // Interseccion vacia: ninguna clave aparece en los dos. Se AFIRMA en vez de confiar en el
    // razonamiento «un incidente no vuelve, luego no puede estar en los dos conjuntos».
    const enComun = Object.keys(erroresMontos).filter((k) => k in erroresConfirmacion);
    expect(enComun).toEqual([]);
  });
});

describe("238/R14 — la cobertura se comprueba ANTES que la de los montos", () => {
  it("con las DOS rotas, el que responde es el de la confirmacion fisica", async () => {
    const repo = fakeRepo({
      findGestionesRetornablesDelCierre: vi.fn(async () => [ret(G_DEV)]),
      findGestionesIncidenteDelCierre: vi.fn(async () => [
        { gestionId: G_INC, ordenMontoCobrar: null },
      ]),
    });

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [], []);

    // Si falta un paquete no tiene sentido validar montos que se van a descartar — misma razon
    // por la que la pantalla pone el escaneo antes de la captura de dinero (R37).
    expect(Object.keys(erroresDe(r))).toEqual([G_DEV]);
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});
