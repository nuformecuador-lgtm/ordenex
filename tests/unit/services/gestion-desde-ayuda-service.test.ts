import { describe, expect, it, vi } from "vitest";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { OrdenParaHilo } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { GestionDesdeAyudaInput } from "@/lib/interfaces/services/IGestionDesdeAyudaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  GestionDesdeAyudaService,
  MENSAJES_GESTION_DESDE_AYUDA,
} from "@/lib/services/GestionDesdeAyudaService";
import { ESTATUS_POR_RESULTADO } from "@/lib/types/gestion-destino";
import { VENTANA_ESCRITURA } from "@/lib/types/ventana-hilo-notas";

// Feature 237 (T5.3, design §6) — LAS OCHO COMPROBACIONES del servicio, una por caso.
//
// Es la ficha mas delicada en dinero de la pila: un `rechazada` debita a la tienda el
// `cobroRechazado` de la 56 (hasta ₡1.000, medido en produccion el 2026-08-20) y suma un intento
// que adelanta el escalado del cron de SLA. Aqui se ataca cada puerta de frente, incluida la que
// existe para que un MENSAJERO no pueda entrar por esta via y saltarse su propio bloqueo (R20).

const TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "mensajero-1", rol: "mensajero" };
const OTRA_TIENDA: Actor = { usuarioId: "tienda-2", rol: "adminTienda" };
const ADMIN: Actor = { usuarioId: "admin-1", rol: "admin" };

function ordenParaHilo(over: Partial<OrdenParaHilo> = {}): OrdenParaHilo {
  return {
    tiendaId: "tienda-1",
    mensajeroAsignadoId: "mensajero-1",
    estatusValue: "ayuda_tienda",
    deletedAt: null,
    ...over,
  };
}

function fakeStorage(overrides: Partial<IFileStorage> = {}): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
    ...overrides,
  };
}

const CATALOGO: Record<string, string> = {
  ayuda_tienda: "os-ayuda",
  reprogramada: "os-reprogramada",
  rechazada: "os-rechazada",
  devolucion_por_confirmar: "os-devolucion-por-confirmar",
};

function montar(
  opts: {
    orden?: OrdenParaHilo | null;
    storage?: IFileStorage;
    crearDevuelve?: string | null;
    crearLanza?: Error;
    catalogo?: Record<string, string>;
  } = {},
) {
  const catalogo = opts.catalogo ?? CATALOGO;
  const notaRepo = {
    findOrdenParaHilo: vi.fn(async () => (opts.orden === undefined ? ordenParaHilo() : opts.orden)),
  };
  const ordenRepo = {
    findEstatusIdByValue: vi.fn(async (v: string) => catalogo[v] ?? null),
  };
  const gestionRepo = {
    crearGestionDesdeAyuda: vi.fn(async () => {
      if (opts.crearLanza) throw opts.crearLanza;
      return opts.crearDevuelve === undefined ? "g-ayuda" : opts.crearDevuelve;
    }),
  };
  const storage = opts.storage ?? fakeStorage();
  const service = new GestionDesdeAyudaService({
    notaRepo,
    ordenRepo,
    gestionRepo,
    storage,
  });
  return { service, notaRepo, ordenRepo, gestionRepo, storage };
}

function foto(n: number) {
  return { contentType: "image/jpeg", bytes: new Uint8Array([n]) };
}

const RECHAZO: GestionDesdeAyudaInput = {
  ordenId: "o1",
  resultado: "rechazada",
  motivo: "el cliente no la quiere",
  evidencias: [foto(0), foto(1)],
};

const REPROGRAMACION: GestionDesdeAyudaInput = {
  ordenId: "o1",
  resultado: "reprogramada",
  fechaReprogramacion: "2027-01-05",
  motivo: "el cliente pidio otro dia",
  evidencias: [foto(0)],
};

/* -------------------------------------------------------------------------- */
/* Camino feliz                                                                 */
/* -------------------------------------------------------------------------- */

describe("gestionar — el camino feliz (R2/R3/R4/R26)", () => {
  it("la tienda dueña resuelve y el repo recibe el mensajero, la tienda y los dos estatus", async () => {
    const { service, gestionRepo } = montar();

    const r = await service.gestionar(RECHAZO, TIENDA);

    expect(r).toEqual({ status: "ok", ordenId: "o1", resultado: "rechazada" });
    const arg = (gestionRepo.crearGestionDesdeAyuda as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      ordenId: "o1",
      estatusAyudaId: "os-ayuda",
      estatusDestinoId: "os-rechazada",
      // 💰 R3: EL MENSAJERO de la orden, leido de la MISMA lectura que autorizo. Es lo que mete la
      // gestion en su cierre.
      mensajeroId: "mensajero-1",
      // R4: la TIENDA que la registro, para el historial.
      actorUsuarioId: "tienda-1",
    });
  });

  it("R26: el destino sale del MAPA UNICO, no de `findEstatusIdByValue(resultado)`", async () => {
    // Hoy los dos resultados de esta via se llaman igual que su estado, asi que la diferencia no se
    // ve en el valor: se ve en el CAMINO. Se afirma que el servicio pidio al catalogo el value que
    // dicta `ESTATUS_POR_RESULTADO`, que es el mapa que la 239 creo al romper esa identidad para
    // `devuelta`. Volver a la coincidencia de nombres reabre el cobro prematuro que aquella cerro.
    const { service, ordenRepo } = montar();
    await service.gestionar(REPROGRAMACION, TIENDA);

    const pedidos = (ordenRepo.findEstatusIdByValue as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(pedidos).toContain(ESTATUS_POR_RESULTADO.reprogramada);
    expect(pedidos).toContain("ayuda_tienda");
    // Y ningun otro: dos lecturas, ni una de mas.
    expect(pedidos).toHaveLength(2);
  });

  it("la fecha de reprogramacion viaja al repo; en un rechazo va NULA", async () => {
    const conFecha = montar();
    await conFecha.service.gestionar(REPROGRAMACION, TIENDA);
    const a = (conFecha.gestionRepo.crearGestionDesdeAyuda as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      gestion: Record<string, unknown>;
    };
    expect(a.gestion.fechaReprogramacion).toBe("2027-01-05");

    const sinFecha = montar();
    await sinFecha.service.gestionar(RECHAZO, TIENDA);
    const b = (sinFecha.gestionRepo.crearGestionDesdeAyuda as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      gestion: Record<string, unknown>;
    };
    expect(b.gestion.fechaReprogramacion).toBeNull();
  });

  it("R15/R17: las N fotos suben ANTES de la transaccion, con indices 0..N-1 en orden", async () => {
    const { service, gestionRepo, storage } = montar();
    await service.gestionar(RECHAZO, TIENDA);

    expect(storage.upload).toHaveBeenCalledTimes(2);
    const arg = (gestionRepo.crearGestionDesdeAyuda as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      gestion: { evidencias: { indice: number; storagePath: string }[] };
    };
    expect(arg.gestion.evidencias.map((e) => e.indice)).toEqual([0, 1]);
    // Prefijo propio: distingue estas fotos de las de una gestion del mensajero sobre la MISMA
    // orden, y dice de que camino vinieron.
    expect(arg.gestion.evidencias[0].storagePath).toMatch(/^o1\/ayuda-rechazada-\d+-0\./);
  });

  it("R18: el servicio NO arma ubicacion — la tienda gestiona desde un escritorio", async () => {
    const { service, gestionRepo } = montar();
    await service.gestionar(RECHAZO, TIENDA);
    const arg = (gestionRepo.crearGestionDesdeAyuda as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      gestion: Record<string, unknown>;
    };
    expect(arg.gestion).not.toHaveProperty("ubicacionLat");
    expect(arg.gestion).not.toHaveProperty("ubicacionLng");
    expect(arg.gestion).not.toHaveProperty("ubicacionAusencia");
  });
});

/* -------------------------------------------------------------------------- */
/* R19/R20/R21/R22 — quien puede, y por donde                                   */
/* -------------------------------------------------------------------------- */

describe("gestionar — la puerta (R19/R20/R21/R22)", () => {
  it("R19: un rol ajeno (admin) ⇒ `forbidden`, sin tocar el repo de gestion", async () => {
    const { service, gestionRepo, storage } = montar();
    const r = await service.gestionar(RECHAZO, ADMIN);
    expect(r).toEqual({ status: "forbidden" });
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  // 💰 R20 — EL BYPASS DE `estaBloqueado`, ATACADO DE FRENTE.
  it("R20: el MENSAJERO ASIGNADO ⇒ `forbidden` — esta via no le da la vuelta a su bloqueo", async () => {
    // `ayuda_tienda` esta en la ventana de escritura de LOS DOS roles (235/R34, para que el hilo no
    // sea mudo), asi que el mensajero PASA `autorizarSobreHilo` y PASA la ventana. Si no se
    // estrechara a `adminTienda`, un mensajero con un cierre `vencido` o `rechazado` —bloqueado por
    // la 111/R1 para gestionar y para cobrar— podria gestionar por esta puerta lateral. Este caso
    // es el candado; sin el, la guarda de la caja tiene una puerta trasera.
    const { service, gestionRepo, storage } = montar();
    const r = await service.gestionar(RECHAZO, MENSAJERO);
    expect(r).toEqual({ status: "forbidden" });
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("R20: y el mensajero PASA la puerta del hilo — el rechazo viene de la regla propia, no de ella", () => {
    // El contraste que hace que el caso de arriba diga algo: si el mensajero ya cayera en
    // `autorizarSobreHilo`, el paso 2 seria decorativo y podria borrarse sin que nada fallara.
    expect(VENTANA_ESCRITURA.mensajero as readonly string[]).toContain("ayuda_tienda");
    expect(VENTANA_ESCRITURA.adminTienda as readonly string[]).toContain("ayuda_tienda");
  });

  it("R22: una tienda AJENA y una orden INEXISTENTE devuelven exactamente lo mismo", async () => {
    // El borde no es un oraculo del estado de una guia: si los dos casos se distinguieran, se
    // podria averiguar si una guia existe probando ids.
    const ajena = await montar().service.gestionar(RECHAZO, OTRA_TIENDA);
    const inexistente = await montar({ orden: null }).service.gestionar(RECHAZO, TIENDA);
    expect(ajena).toEqual({ status: "forbidden" });
    expect(inexistente).toEqual({ status: "forbidden" });
    expect(ajena).toEqual(inexistente);
  });

  it("R22: una orden BORRADA tambien devuelve `forbidden`, sin revelar que existio", async () => {
    const { service } = montar({
      orden: ordenParaHilo({ deletedAt: new Date("2026-08-01") }),
    });
    expect(await service.gestionar(RECHAZO, TIENDA)).toEqual({
      status: "forbidden",
    });
  });

  it("R21: la puerta es la MISMA declaracion que gobierna el hilo, no una segunda tabla", async () => {
    // Se ejerce por su consecuencia observable: con la ventana cerrada para ese estatus, la
    // operacion se rechaza. Aqui se simula un estatus que NO esta en la ventana del adminTienda y
    // que tampoco es el de ayuda: el resultado es un rechazo, no un paso adelante.
    const { service, gestionRepo } = montar({
      orden: ordenParaHilo({ estatusValue: "por_recoger" }),
    });
    const r = await service.gestionar(RECHAZO, TIENDA);
    expect(r.status).not.toBe("ok");
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* R23/R8 — el estado y el mensajero                                            */
/* -------------------------------------------------------------------------- */

describe("gestionar — el estado de la orden y su mensajero (R23/R8)", () => {
  it.each(["en_reparto", "devuelta", "entregada", "sin_gestionar"])(
    "R23: una orden en `%s` ⇒ `conflict`, sin tocar el repo de gestion ni subir nada",
    async (estatusValue) => {
      const { service, gestionRepo, storage } = montar({
        orden: ordenParaHilo({ estatusValue }),
      });
      const r = await service.gestionar(RECHAZO, TIENDA);
      expect(r).toEqual({
        status: "conflict",
        motivo: MENSAJES_GESTION_DESDE_AYUDA.fueraDeAyuda,
      });
      expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
      // Y ni una foto en el bucket: el caso previsible no deja basura.
      expect(storage.upload).not.toHaveBeenCalled();
    },
  );

  it("💰 R8: sin mensajero asignado ⇒ `conflict` y NO se crea gestion", async () => {
    // Sin mensajero no hay a quien atribuirla: la gestion no entraria en ningun cierre, no la
    // cobraria nadie, y la orden habria cambiado de estado a cambio de nada.
    const { service, gestionRepo, storage } = montar({
      orden: ordenParaHilo({ mensajeroAsignadoId: null }),
    });
    const r = await service.gestionar(RECHAZO, TIENDA);
    expect(r).toEqual({
      status: "conflict",
      motivo: MENSAJES_GESTION_DESDE_AYUDA.sinMensajero,
    });
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Fallo cerrado del catalogo                                                   */
/* -------------------------------------------------------------------------- */

describe("gestionar — catalogo incompleto ⇒ fallo CERRADO", () => {
  it.each([
    ["falta el estatus de ayuda", { rechazada: "os-rechazada" }],
    ["falta el destino", { ayuda_tienda: "os-ayuda" }],
    ["falta todo", {}],
  ])("%s ⇒ no se escribe nada y se reporta el catalogo", async (_caso, catalogo) => {
    // Una escritura a medias sobre el estado es peor que un error visible: el estatus quedaria
    // movido sin gestion que lo explique, o al reves.
    const { service, gestionRepo, storage } = montar({ catalogo });
    const r = await service.gestionar(RECHAZO, TIENDA);
    expect(r.status).toBe("validation_error");
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* R16/R25 — la carrera perdida y la compensacion                               */
/* -------------------------------------------------------------------------- */

describe("gestionar — el repo devuelve `null` (R16/R25)", () => {
  it("💰 R25: `conflict` con el texto de la carrera, y NO se afirma que gestiono", async () => {
    const { service } = montar({ crearDevuelve: null });
    const r = await service.gestionar(RECHAZO, TIENDA);
    expect(r).toEqual({
      status: "conflict",
      motivo: MENSAJES_GESTION_DESDE_AYUDA.fueraDeAyuda,
    });
  });

  it("R16: y las fotos ya subidas se COMPENSAN — ni una queda huerfana en el bucket", async () => {
    // Es la mutacion T8.4: si `compensarEvidencias` dejara de borrar, este caso cae. Sin el, cada
    // carrera perdida deja N objetos en un bucket privado apuntando a una gestion que no existe.
    const storage = fakeStorage();
    const { service } = montar({ crearDevuelve: null, storage });

    await service.gestionar(RECHAZO, TIENDA);

    expect(storage.remove).toHaveBeenCalledTimes(1);
    const removidos = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(removidos).toHaveLength(2);
  });

  it("R16: si la TRANSACCION revienta, tambien se compensa y el error se propaga", async () => {
    const storage = fakeStorage();
    const { service } = montar({ crearLanza: new Error("tx caida"), storage });

    await expect(service.gestionar(RECHAZO, TIENDA)).rejects.toThrow("tx caida");

    expect(storage.remove).toHaveBeenCalledTimes(1);
    const removidos = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(removidos).toHaveLength(2);
  });

  it("R15: si falla la SUBIDA #k, se retiran las k-1 y el repo ni se invoca", async () => {
    let n = 0;
    const storage = fakeStorage({
      upload: vi.fn(async (input: { path: string }) => {
        n += 1;
        if (n === 2) throw new Error("storage caido");
        return input.path;
      }),
    });
    const { service, gestionRepo } = montar({ storage });

    await expect(service.gestionar(RECHAZO, TIENDA)).rejects.toThrow("storage caido");

    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
    const removidos = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(removidos).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* R50 — nada de PII en los textos                                              */
/* -------------------------------------------------------------------------- */

describe("R50 — los mensajes son fijos y no llevan datos de nadie", () => {
  it("ninguno interpola motivo, guia, telefono, direccion ni nombre", async () => {
    const textos = Object.values(MENSAJES_GESTION_DESDE_AYUDA);
    for (const t of textos) {
      expect(t).not.toContain(RECHAZO.motivo);
      expect(t).not.toContain("o1");
      expect(t).not.toContain("mensajero-1");
      expect(t).not.toContain("tienda-1");
    }
    // Y el `conflict` que sale del servicio es literalmente uno de ellos, sin añadidos.
    const r = await montar({ crearDevuelve: null }).service.gestionar(RECHAZO, TIENDA);
    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    expect(textos).toContain(r.motivo);
  });
});
