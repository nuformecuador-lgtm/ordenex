import { describe, it, expect, vi } from "vitest";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// Feature 49 (T4.1/T4.2) — tests del OrdenHistorialService (sin DB, dobles de repos).
// Cubre R26 (linea de tiempo cronologica), R27 (autorizacion por visibilidad de la orden,
// por rol) y el derivador de intentos.
//
// Feature 213: el derivador dejo de traducir `value -> id` del catalogo (`resolverCriterio`
// desaparece) porque el criterio ya no se expresa con ids de `order_status`, sino con valores
// de los enums `GestionResultado`/`CierreEstado`. El servicio delega DIRECTO en el repo.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "as1", rol: "adminSatelite" };

const ZONA = "z-limon";

function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 10,
    numRemision: "R-1",
    estatusId: "s-reparto",
    destinatario: "Ana",
    telefonoDest: "099",
    tiendaId: "u-tienda",
    zonaId: ZONA,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "caja",
    peso: null,
    notas: null,
    mensajeroAsignadoId: null,
    createdAt: new Date("2026-07-13T09:00:00.000Z"),
    updatedAt: new Date("2026-07-13T09:00:00.000Z"),
    ...overrides,
  };
}

function entrada(overrides: Partial<OrdenHistorialEntradaDTO> = {}): OrdenHistorialEntradaDTO {
  return {
    estatusOrigenValue: null,
    estatusDestinoValue: "en_preparacion",
    origenTipo: "carga_masiva",
    actorNombre: "Tienda X",
    motivo: null,
    createdAt: new Date("2026-07-13T10:00:00.000Z"),
    ...overrides,
  };
}

type OrdenRepoMethods = Pick<
  IOrdenRepository,
  "findById" | "findUsuarioZonaId" | "findEstatusIdByValue"
>;
type HistorialRepoMethods = Pick<
  IOrdenHistorialRepository,
  | "findHistorialByOrden"
  | "existeActuacionDe"
  | "contarIntentosVigentes"
  | "contarIntentosVigentesEnLote"
>;

// El catalogo de estados sigue existiendo para la AUTORIZACION y para otros consumidores; el
// conteo de intentos ya NO lo consulta (feature 213/R9).
const ESTATUS: Record<string, string> = {
  devuelta: "s-devuelta",
  reprogramada: "s-reprogramada",
};

function ordenRepo(overrides: Partial<OrdenRepoMethods> = {}): OrdenRepoMethods {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findUsuarioZonaId: vi.fn(async () => ZONA),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    ...overrides,
  };
}

function historialRepo(overrides: Partial<HistorialRepoMethods> = {}): HistorialRepoMethods {
  return {
    findHistorialByOrden: vi.fn(async () => [entrada()]),
    existeActuacionDe: vi.fn(async () => false),
    contarIntentosVigentes: vi.fn(async () => 0),
    contarIntentosVigentesEnLote: vi.fn(async () => new Map<string, number>()),
    ...overrides,
  };
}

function newService(o: OrdenRepoMethods = ordenRepo(), h: HistorialRepoMethods = historialRepo()) {
  return new OrdenHistorialService(
    o as unknown as IOrdenRepository,
    h as unknown as IOrdenHistorialRepository,
  );
}

// --- obtenerHistorial: autorizacion (R27) + orden cronologico (R26) ---

describe("obtenerHistorial — autorizacion por visibilidad (R27)", () => {
  it("orden inexistente/borrada -> not_found (findById excluye borradas)", async () => {
    const h = historialRepo();
    const r = await newService(ordenRepo({ findById: vi.fn(async () => null) }), h).obtenerHistorial(
      "o1",
      MAESTRO,
    );
    expect(r.status).toBe("not_found");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("rol desconocido -> forbidden, sin tocar datos", async () => {
    const o = ordenRepo();
    const r = await newService(o).obtenerHistorial("o1", {
      usuarioId: "x",
      rol: "desconocido" as Actor["rol"],
    });
    expect(r.status).toBe("forbidden");
    expect(o.findById).not.toHaveBeenCalled();
  });

  it("maestro -> ok con las entradas (cualquier orden)", async () => {
    const r = await newService().obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.entradas).toHaveLength(1);
  });

  // Feature 47 (R15/R17): el ok expone el conteo de intentos DERIVADO y el umbral, con la
  // MISMA autorizacion de la orden (no se añade regla nueva). Aqui hay 2 intentos vigentes.
  it("R15/R17: el ok incluye intentos (derivado) y umbral, tras autorizar la orden", async () => {
    const o = ordenRepo();
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 2) });
    const r = await newService(o, h).obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.intentos).toBe(2); // consume el punto unico del conteo
    expect(r.umbral).toBe(3); // default por ley (reintentosConfig, env no seteado en test)
    // Feature 213/R6: el drawer llama al punto unico con SOLO el id de la orden.
    expect(h.contarIntentosVigentes).toHaveBeenCalledWith("o1");
  });

  it("R15: sin devoluciones -> intentos 0 (no bloquea el ok)", async () => {
    const o = ordenRepo();
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 0) });
    const r = await newService(o, h).obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.intentos).toBe(0);
  });

  // T11b (213/R5/R32) — REESCRITO. El caso viejo afirmaba que anular una gestion hacia BAJAR el
  // numero ("2 devueltas, 1 anulada -> 1"). Con D12 el conteo es MONOTONO CRECIENTE: una gestion
  // con `cierre_id` poblado ya no se puede anular, y contar exige ademas que su cierre este
  // aprobado, asi que toda gestion que llega a contar es ya inmutable. Lo que la anulacion
  // impide es que el numero LLEGUE A SUBIR, no que baje. R5 sobrevive como "una gestion anulada
  // NO CUENTA", nunca como "descuenta".
  it("R5/R32: la gestion anulada NO cuenta (no descuenta): 2 cierres aprobados, 1 gestion anulada -> 1", async () => {
    const o = ordenRepo();
    // El repo excluye la anulada en la LECTURA: nunca llego a aportar su cierre.
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 1) });
    const r = await newService(o, h).obtenerHistorial("o1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.intentos).toBe(1);
    // R6: es EXACTAMENTE el mismo derivador que alimenta el escalado (un solo call-site).
    expect(h.contarIntentosVigentes).toHaveBeenCalledWith("o1");
  });

  // T11b (213/R32) — MONOTONIA observable desde el drawer: dos lecturas de la MISMA orden
  // separadas por un evento (se aprueba el cierre) y el segundo numero es >= el primero. Ningun
  // test de este repo afirma que el conteo pueda decrecer.
  it("R32: dos lecturas del drawer separadas por la aprobacion de un cierre -> el numero no baja", async () => {
    const o = ordenRepo();
    const contar = vi
      .fn<(ordenId: string) => Promise<number>>()
      .mockResolvedValueOnce(1) // antes: 1 cierre aprobado
      .mockResolvedValueOnce(2); // despues: se aprobo otro cierre
    const h = historialRepo({ contarIntentosVigentes: contar });
    const svc = newService(o, h);

    const primera = await svc.obtenerHistorial("o1", MAESTRO);
    const segunda = await svc.obtenerHistorial("o1", MAESTRO);
    if (primera.status !== "ok" || segunda.status !== "ok") throw new Error("esperaba ok");

    expect(segunda.intentos).toBeGreaterThanOrEqual(primera.intentos);
    expect([primera.intentos, segunda.intentos]).toEqual([1, 2]);
  });

  // 213/R10/R20: el drawer refleja el criterio NUEVO. Aqui la orden acumulo resultado contable
  // en 3 cierres APROBADOS: el repo devuelve 3, y ese 3 es el que ve el usuario — el MISMO que
  // compara el cron contra el umbral. La FORMA no cambia (sigue exponiendo `intentos` +
  // `umbral`, R20); lo que cambia es el VALOR.
  it("R10/R20: `intentos` sale del punto unico nuevo y el umbral sigue viajando", async () => {
    const o = ordenRepo();
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 3) });
    const r = await newService(o, h).obtenerHistorial("o1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.intentos).toBe(3);
    expect(r.umbral).toBe(3);
    expect(h.contarIntentosVigentes).toHaveBeenCalledWith("o1");
  });

  // Feature 67/R23: el historial es append-only e INMUTABLE. La correccion del contador es un
  // filtro de LECTURA: la linea de tiempo sigue mostrando TODAS las filas (incluida la de la
  // gestion anulada y la del propio `deshacer_gestion`). La verdad historica se conserva.
  it("67/R23: `findHistorialByOrden` devuelve TODAS las filas (no filtra las de gestiones anuladas)", async () => {
    const eGestion = entrada({
      estatusOrigenValue: "en_reparto",
      estatusDestinoValue: "devuelta",
      origenTipo: "gestion",
      motivo: "cliente ausente",
      createdAt: new Date("2026-07-14T12:00:00.000Z"),
    });
    const eDeshacer = entrada({
      estatusOrigenValue: "en_bodega_central",
      estatusDestinoValue: "en_reparto",
      origenTipo: "deshacer_gestion", // 12.º valor del enum (F1.4-b)
      actorNombre: "Mensajero 1",
      createdAt: new Date("2026-07-14T13:00:00.000Z"),
    });
    const h = historialRepo({ findHistorialByOrden: vi.fn(async () => [eGestion, eDeshacer]) });
    const r = await newService(ordenRepo(), h).obtenerHistorial("o1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    // Las 2 filas siguen ahi: el deshacer NO borro ni modifico el rastro de la gestion.
    expect(r.entradas).toEqual([eGestion, eDeshacer]);
    expect(r.entradas.map((e) => e.origenTipo)).toContain("deshacer_gestion");
    // El service de lectura no muta el historial: no existe API de update/delete que llamar.
    expect(Object.keys(h)).toEqual(
      expect.not.arrayContaining(["actualizarHistorial", "borrarHistorial"]),
    );
  });

  it("admin -> ok con las entradas (cualquier orden)", async () => {
    const r = await newService().obtenerHistorial("o1", ADMIN);
    expect(r.status).toBe("ok");
  });

  it("adminTienda de SU tienda -> ok", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ tiendaId: "u-tienda" })) });
    const r = await newService(o).obtenerHistorial("o1", TIENDA);
    expect(r.status).toBe("ok");
  });

  it("adminTienda con orden AJENA -> not_found (no filtra datos)", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ tiendaId: "otra-tienda" })) });
    const h = historialRepo();
    const r = await newService(o, h).obtenerHistorial("o1", TIENDA);
    expect(r.status).toBe("not_found");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("mensajero ASIGNADO a la orden -> ok (sin consultar el rastro)", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ mensajeroAsignadoId: "m1" })) });
    const h = historialRepo();
    const r = await newService(o, h).obtenerHistorial("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(h.existeActuacionDe).not.toHaveBeenCalled();
  });

  it("mensajero NO asignado pero que ACTUO la orden (estuvo asignada) -> ok", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ mensajeroAsignadoId: null })) });
    const h = historialRepo({ existeActuacionDe: vi.fn(async () => true) });
    const r = await newService(o, h).obtenerHistorial("o1", MENSAJERO);
    expect(r.status).toBe("ok");
    expect(h.existeActuacionDe).toHaveBeenCalledWith("o1", "m1");
  });

  it("mensajero NO asignado y sin rastro -> forbidden, sin listar el historial", async () => {
    const o = ordenRepo({ findById: vi.fn(async () => ordenDTO({ mensajeroAsignadoId: "otro" })) });
    const h = historialRepo({ existeActuacionDe: vi.fn(async () => false) });
    const r = await newService(o, h).obtenerHistorial("o1", MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("adminSatelite con orden de SU zona -> ok", async () => {
    const o = ordenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: ZONA })),
      findUsuarioZonaId: vi.fn(async () => ZONA),
    });
    const r = await newService(o).obtenerHistorial("o1", SATELITE);
    expect(r.status).toBe("ok");
  });

  it("adminSatelite con orden FUERA de su zona -> forbidden", async () => {
    const o = ordenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-otra" })),
      findUsuarioZonaId: vi.fn(async () => ZONA),
    });
    const h = historialRepo();
    const r = await newService(o, h).obtenerHistorial("o1", SATELITE);
    expect(r.status).toBe("forbidden");
    expect(h.findHistorialByOrden).not.toHaveBeenCalled();
  });

  it("adminSatelite sin zona asignada -> forbidden", async () => {
    const o = ordenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: ZONA })),
      findUsuarioZonaId: vi.fn(async () => null),
    });
    const r = await newService(o).obtenerHistorial("o1", SATELITE);
    expect(r.status).toBe("forbidden");
  });

  it("R26: devuelve las entradas ordenadas tal como las provee el repo (cronologico)", async () => {
    const e1 = entrada({ estatusDestinoValue: "en_preparacion", createdAt: new Date("2026-07-13T10:00:00.000Z") });
    const e2 = entrada({
      estatusOrigenValue: "en_reparto",
      estatusDestinoValue: "devuelta",
      origenTipo: "gestion",
      actorNombre: null,
      motivo: "cliente ausente",
      createdAt: new Date("2026-07-13T12:00:00.000Z"),
    });
    const h = historialRepo({ findHistorialByOrden: vi.fn(async () => [e1, e2]) });
    const r = await newService(ordenRepo(), h).obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.entradas).toEqual([e1, e2]);
      expect(h.findHistorialByOrden).toHaveBeenCalledWith("o1");
    }
  });
});

// --- contarIntentos: el punto unico (213/R6/R8/R9) ---

describe("contarIntentos — punto unico del conteo (213/R6/R8/R9)", () => {
  it("N intentos -> N, delegando en el punto unico con SOLO el id de la orden", async () => {
    const o = ordenRepo();
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 3) });
    const n = await newService(o, h).contarIntentos("o1");
    expect(n).toBe(3);
    expect(h.contarIntentosVigentes).toHaveBeenCalledWith("o1");
  });

  it("R8: sin intentos -> 0 explicito", async () => {
    const o = ordenRepo();
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 0) });
    expect(await newService(o, h).contarIntentos("o1")).toBe(0);
  });

  // R9 REEXPRESADO (213) — el conteo YA NO DEPENDE DEL CATALOGO DE ESTADOS. Antes, un seed
  // parcial de `order_status` degradaba el conteo a 0 (o a media rama); ahora el criterio se
  // expresa con valores de los enums de Postgres `GestionResultado`/`CierreEstado`, que NO
  // pueden faltar. La degradacion segura pasa a sostenerse sobre algo mas fuerte, no mas debil.
  //
  // Este caso mata la mutacion "reintroducir una traduccion de catalogo que devuelve null y
  // degrada el conteo a 0": si alguien la volviera a meter, `findEstatusIdByValue` se llamaria
  // y el numero cambiaria con el catalogo vacio.
  it("R9: el conteo NO consulta el catalogo de estados ni una sola vez", async () => {
    const o = ordenRepo();
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 2) });
    const svc = newService(o, h);

    expect(await svc.contarIntentos("o1")).toBe(2);
    await svc.contarIntentosEnLote(["o1", "o2"]);

    expect(o.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("R9: con el catalogo VACIO el numero es el mismo (el criterio no se apoya en el)", async () => {
    const o = ordenRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const h = historialRepo({
      contarIntentosVigentes: vi.fn(async () => 2),
      contarIntentosVigentesEnLote: vi.fn(async () => new Map([["o1", 2]])),
    });
    const svc = newService(o, h);

    expect(await svc.contarIntentos("o1")).toBe(2); // NO degrada a 0
    expect((await svc.contarIntentosEnLote(["o1"])).get("o1")).toBe(2);
    expect(o.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  // El servicio consume el conteo VIGENTE, NUNCA un conteo crudo. Este test guarda la decision:
  // si alguien volviera a un conteo sin filtro, el intento de una gestion deshecha volveria a
  // contar y la orden escalaria sola a `rechazada` (dinero).
  it("R6: consume `contarIntentosVigentes`, y el contrato no expone un conteo sin filtrar", async () => {
    const o = ordenRepo();
    const h = historialRepo({ contarIntentosVigentes: vi.fn(async () => 1) });
    expect(await newService(o, h).contarIntentos("o1")).toBe(1);
    expect(h.contarIntentosVigentes).toHaveBeenCalledTimes(1);
    // El contrato del repo no expone un conteo "por destino" suelto: no hay forma de elegir mal.
    expect("contarPorDestino" in h).toBe(false);
    expect("contarPorDestinoVigentes" in h).toBe(false);
  });
});

// --- contarIntentosEnLote: el gemelo en lote (213/R4/R7/R8) ---

describe("contarIntentosEnLote — conteo por lote (213/R4/R7/R8)", () => {
  it("R7: consulta el repo UNA vez para todo el lote, con los ids tal cual", async () => {
    const o = ordenRepo();
    const h = historialRepo({
      contarIntentosVigentesEnLote: vi.fn(async () => new Map([["o1", 2]])),
    });
    const mapa = await newService(o, h).contarIntentosEnLote(["o1", "o2", "o3"]);

    expect(mapa).toEqual(new Map([["o1", 2]]));
    expect(h.contarIntentosVigentesEnLote).toHaveBeenCalledTimes(1);
    expect(h.contarIntentosVigentesEnLote).toHaveBeenCalledWith(["o1", "o2", "o3"]);
  });

  it("R7: lote vacio -> Map vacio, sin tocar el repo NI el catalogo", async () => {
    const o = ordenRepo();
    const h = historialRepo();
    const mapa = await newService(o, h).contarIntentosEnLote([]);

    expect(mapa.size).toBe(0);
    expect(h.contarIntentosVigentesEnLote).not.toHaveBeenCalled();
    expect(o.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("R8: una orden sin intentos no viene en el Map (el llamador aplica `?? 0`)", async () => {
    const o = ordenRepo();
    const h = historialRepo({
      contarIntentosVigentesEnLote: vi.fn(async () => new Map([["o1", 1]])),
    });
    const mapa = await newService(o, h).contarIntentosEnLote(["o1", "o2"]);
    expect(mapa.has("o2")).toBe(false);
    expect(mapa.get("o2") ?? 0).toBe(0);
  });

  // R4: individual y lote consumen EL MISMO punto unico, con la MISMA firma (solo el id de la
  // orden). Es la garantia de que el numero de una superficie (lote) no puede divergir del
  // numero que gobierna el dinero (individual).
  it("R4: individual y lote comparten el punto unico y dan el mismo numero", async () => {
    const o = ordenRepo();
    const h = historialRepo({
      contarIntentosVigentes: vi.fn(async () => 2),
      contarIntentosVigentesEnLote: vi.fn(async () => new Map([["o1", 2]])),
    });
    const svc = newService(o, h);

    const individual = await svc.contarIntentos("o1");
    const lote = await svc.contarIntentosEnLote(["o1"]);

    const argsIndividual = (h.contarIntentosVigentes as ReturnType<typeof vi.fn>).mock.calls[0];
    const argsLote = (h.contarIntentosVigentesEnLote as ReturnType<typeof vi.fn>).mock.calls[0];
    // Ninguno de los dos recibe un "criterio" aparte que pudiera divergir: solo el/los id(s).
    expect(argsIndividual).toEqual(["o1"]);
    expect(argsLote).toEqual([["o1"]]);
    expect(lote.get("o1")).toBe(individual); // mismo numero para la misma orden
  });
});
