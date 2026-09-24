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
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import { estaEnVentanaDeEscritura } from "@/lib/types/ventana-hilo-notas";

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
    // ⏳ 2026-09-23 (FICHA 454, T1.15): la ayuda deja de ser estatus. La orden sigue `en_reparto`
    // con la ayuda ABIERTA (derivacion `ayuda-abierta.ts`), que es lo que la hace resoluble aqui.
    estatusValue: "en_reparto",
    ayudaAbierta: true,
    deletedAt: null,
    // Feature 261 (B15): `fechaReparto` es OBLIGATORIO en `OrdenParaHilo` (insumo de la puerta
    // A de la via de la tienda). `null` = sin reserva, el caso por defecto.
    fechaReparto: null,
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
  reprogramado: "os-reprogramada",
  devolucion_a_origen_por_rechazo: "os-rechazada",
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
    // FEATURE 276 (T5): la dependencia del tope es OBLIGATORIA. Con el doble a 0 intentos, la
    // puerta del paso 5-ter no se cierra y estos casos siguen midiendo lo que median.
    historial: fakeIntentosEnLote(),
  });
  return { service, notaRepo, ordenRepo, gestionRepo, storage };
}

function foto(n: number) {
  return { contentType: "image/jpeg", bytes: new Uint8Array([n]) };
}

const RECHAZO: GestionDesdeAyudaInput = {
  ordenId: "o1",
  resultado: "devolucion_a_origen_por_rechazo",
  motivo: "el cliente no la quiere",
  evidencias: [foto(0), foto(1)],
};

const REPROGRAMACION: GestionDesdeAyudaInput = {
  ordenId: "o1",
  resultado: "reprogramado",
  fechaReprogramacion: "2027-01-05",
  motivo: "el cliente pidio otro dia",
  evidencias: [foto(0)],
};

/* -------------------------------------------------------------------------- */
/* Camino feliz                                                                 */
/* -------------------------------------------------------------------------- */

describe("gestionar — el camino feliz (R2/R3/R4/R26)", () => {
  it("la tienda dueña resuelve y el repo recibe el mensajero y la tienda (454: sin estatus)", async () => {
    const { service, gestionRepo } = montar();

    const r = await service.gestionar(RECHAZO, TIENDA);

    expect(r).toEqual({ status: "ok", ordenId: "o1", resultado: "devolucion_a_origen_por_rechazo" });
    const arg = (gestionRepo.crearGestionDesdeAyuda as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      ordenId: "o1",
      // 💰 R3: EL MENSAJERO de la orden, leido de la MISMA lectura que autorizo. Es lo que mete la
      // gestion en su cierre.
      mensajeroId: "mensajero-1",
      // R4: la TIENDA que la registro, para el historial.
      actorUsuarioId: "tienda-1",
    });
    // FICHA 454 (R25): ni el estatus de ayuda ni el de destino viajan al repo — no hay transicion.
    expect(arg).not.toHaveProperty("estatusAyudaId");
    expect(arg).not.toHaveProperty("estatusDestinoId");
  });

  // ⏳ 2026-09-23 (FICHA 454, T1.15/R25): este caso afirmaba que el servicio resolvia en el catalogo
  // `ayuda_tienda` y el destino de `ESTATUS_POR_RESULTADO` (dos lecturas). Registrar ya no
  // transiciona: el destino lo aplica la APROBACION del cierre, que es donde ahora se lee el mapa
  // unico (`CierresAdminService`, fallo cerrado de los seis ids). Aqui: CERO lecturas de catalogo.
  it("R26 → 454: el servicio NO resuelve estatus — el destino del mapa unico se aplica al aprobar", async () => {
    const { service, ordenRepo } = montar();
    await service.gestionar(REPROGRAMACION, TIENDA);

    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
    // El mapa unico sigue diciendo lo que la aprobacion aplicara.
    expect(ESTATUS_POR_RESULTADO.reprogramado).toBe("reprogramado");
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
    expect(arg.gestion.evidencias[0].storagePath).toMatch(/^o1\/ayuda-devolucion_a_origen_por_rechazo-\d+-0\./);
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
    // ⏳ 2026-09-23 (FICHA 454, U12): la ayuda abierta abre la ventana de LOS DOS roles sobre una
    // orden `en_reparto` (antes: los dos tenian `ayuda_tienda` en su lista).
    expect(estaEnVentanaDeEscritura("mensajero", "en_reparto", true)).toBe(true);
    expect(estaEnVentanaDeEscritura("adminTienda", "en_reparto", true)).toBe(true);
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
      orden: ordenParaHilo({ estatusValue: "mensajero_recogiendo_en_bodega", ayudaAbierta: false }),
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
  // ⏳ 2026-09-23 (FICHA 454): «fuera de ayuda» deja de ser «estatus distinto de `ayuda_tienda`» y
  // pasa a ser «sin ayuda ABIERTA». `en_reparto` sin ayuda abierta (rescatada, o con una gestion ya
  // pendiente) es el caso nuevo que importa; los otros estatus, sin ayuda abierta por construccion.
  it.each(["en_reparto", "novedad", "entregado", "novedad_interna"])(
    "R23: una orden en `%s` SIN ayuda abierta ⇒ `conflict`, sin tocar el repo de gestion ni subir nada",
    async (estatusValue) => {
      const { service, gestionRepo, storage } = montar({
        orden: ordenParaHilo({ estatusValue, ayudaAbierta: false }),
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

// ⏳ 2026-09-23 (FICHA 454, T1.15): aqui se afirmaba el FALLO CERRADO del catalogo al registrar
// (sin `ayuda_tienda` o sin el destino -> `validation_error`, nada escrito). Registrar ya no escribe
// estatus: no hay escritura a medias posible sobre el estado. El fallo cerrado del catalogo vive
// donde ahora se aplica el estado, en la aprobacion (`cierres-admin-service.test.ts`, «R9: catalogo
// SIN `en_reparto`» y el de `devuelta`).
describe("gestionar — el catalogo ya no interviene al registrar (454)", () => {
  it("con el catalogo VACIO la gestion se registra igual: no hay estatus que resolver", async () => {
    const { service, gestionRepo } = montar({ catalogo: {} });
    const r = await service.gestionar(RECHAZO, TIENDA);
    expect(r).toEqual({ status: "ok", ordenId: "o1", resultado: "devolucion_a_origen_por_rechazo" });
    expect(gestionRepo.crearGestionDesdeAyuda).toHaveBeenCalledTimes(1);
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
