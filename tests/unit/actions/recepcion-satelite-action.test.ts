import { describe, it, expect, vi } from "vitest";
import {
  listarRecepcionSatelite,
  listarOrdenesBodegaPaginado,
  listarOrdenesBodegaCompleto,
  listarIdsVigentesBodega,
  recibirPorQr,
  recibirLote,
} from "@/lib/actions/recepcion-satelite";
import type { IRecepcionSateliteService } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { recepcionSateliteConfig } from "@/lib/config/recepcion-satelite";

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };

function buildService(overrides: Partial<IRecepcionSateliteService> = {}): IRecepcionSateliteService {
  return {
    listar: vi.fn(async () => ({
      status: "ok" as const,
      porRecibir: [],
      recibidas: [],
      porDevolver: [],
      enTransitoACentral: [], // Feature 139/R21: grupo informativo `devolviendo_a_bodega_central`
      devueltas: [], // Feature 100/T4.1: grupo `devuelta` por recuperar a bodega
      asignadas: [], // Feature 149/T6.3: grupo `por_recoger` de la zona (deshacer asignacion)
      zonaNombre: "Limon",
      sinZona: false,
    })),
    recibir: vi.fn(async () => ({
      status: "ok" as const,
      ordenId: "o1",
      estado: "en_bodega_satelite" as const,
    })),
    recibirLote: vi.fn(async () => ({ status: "ok" as const, recibidas: 0 })),
    // Feature 170 (T K.1/T K.2): la pagina del listado de la bodega y el catalogo de sus
    // filtros. Este archivo no los ejercita (viven en `satelite-catalogos.test.ts` y en el
    // test de servicio); se declaran porque la interfaz los exige.
    listarOrdenesBodegaPaginado: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    })),
    obtenerCatalogoFiltros: vi.fn(async () => ({
      status: "ok" as const,
      catalogo: { cantones: [], distritos: [] },
    })),
    // Feature 184 (T A.3): el conjunto de la descarga y la vigencia de la seleccion.
    listarOrdenesBodegaCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    listarIdsVigentesBodega: vi.fn(async () => ({ status: "ok" as const, ids: [] })),
    ...overrides,
  };
}

/** Un uuid valido y distinto por indice: `ids` los exige con formato (feature 184, T A.3). */
function uuid(i: number): string {
  return `3f1c7c2e-9a1a-4f0e-9d4a-${String(i).padStart(12, "0")}`;
}

const noActor = async () => null;
const actorAdmin = async () => ADMIN;

// --- unauthenticated en el borde (R3) ---

describe("R3: unauthenticated antes de tocar el service", () => {
  it("listar sin actor -> unauthenticated", async () => {
    const service = buildService();
    const r = await listarRecepcionSatelite({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("recibir sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.recibir).not.toHaveBeenCalled();
  });
});

// --- listar delega (R3/R4) ---

describe("listar delega en el service", () => {
  it("adminSatelite -> ok con las listas del service", async () => {
    const service = buildService();
    const r = await listarRecepcionSatelite({ service, getActor: actorAdmin });
    expect(r.status).toBe("ok");
    expect(service.listar).toHaveBeenCalledWith(ADMIN);
  });

  it("forbidden del service pasa como resultado de dominio", async () => {
    const service = buildService({ listar: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarRecepcionSatelite({ service, getActor: actorAdmin });
    expect(r.status).toBe("forbidden");
  });
});

// --- recibir: zod de borde (R16) + delegacion (R10) ---

describe("recibirPorQr — validacion de borde (R16) y delegacion (R10)", () => {
  it("R16: numGuia como texto (no numero) -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirPorQr({ numGuia: "10" }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: numGuia no entero positivo (0 / negativo / decimal) -> validation_error, sin service", async () => {
    const service = buildService();
    for (const numGuia of [0, -1, 1.5]) {
      const r = await recibirPorQr({ numGuia }, { service, getActor: actorAdmin });
      expect(r.status).toBe("validation_error");
    }
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: input sin numGuia (forma invalida, QR ilegible) -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await recibirPorQr({}, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: UUID escaneado (etiqueta antigua) -> validation_error, sin service (corte limpio)", async () => {
    const service = buildService();
    const r = await recibirPorQr(
      { numGuia: "3f1c7c2e-9a1a-4f0e-9d4a-2b6a1c9e5d33" },
      { service, getActor: actorAdmin },
    );
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R10: num_guia valido delega en el service con el numGuia y el actor", async () => {
    const service = buildService();
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin });
    expect(r.status).toBe("ok");
    expect(service.recibir).toHaveBeenCalledWith(10, ADMIN);
  });

  it("resultados de dominio del service pasan tal cual (zona_ajena)", async () => {
    const service = buildService({ recibir: vi.fn(async () => ({ status: "zona_ajena" as const })) });
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin });
    expect(r.status).toBe("zona_ajena");
  });

  it("ya_recibida del service pasa tal cual (idempotente, R14)", async () => {
    const service = buildService({ recibir: vi.fn(async () => ({ status: "ya_recibida" as const })) });
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin });
    expect(r.status).toBe("ya_recibida");
  });
});

// --- recibirLote: borde (unauthenticated + zod) + delegacion (feature 63) ---

describe("recibirLote — borde y delegacion (feature 63)", () => {
  it("sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirLote({ ordenIds: ["o1"] }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.recibirLote).not.toHaveBeenCalled();
  });

  it("lote vacio (min 1) -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirLote({ ordenIds: [] }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibirLote).not.toHaveBeenCalled();
  });

  it("id vacio en el lote -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirLote({ ordenIds: ["o1", ""] }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibirLote).not.toHaveBeenCalled();
  });

  it("lote valido delega en el service con ordenIds y actor", async () => {
    const service = buildService({
      recibirLote: vi.fn(async () => ({ status: "ok" as const, recibidas: 2 })),
    });
    const r = await recibirLote({ ordenIds: ["o1", "o2"] }, { service, getActor: actorAdmin });
    expect(r).toEqual({ status: "ok", recibidas: 2 });
    expect(service.recibirLote).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] }, ADMIN);
  });

  it("resultados de dominio del service pasan tal cual (forbidden / sin_zona)", async () => {
    for (const dominio of ["forbidden", "sin_zona"] as const) {
      const service = buildService({ recibirLote: vi.fn(async () => ({ status: dominio })) });
      const r = await recibirLote({ ordenIds: ["o1"] }, { service, getActor: actorAdmin });
      expect(r.status).toBe(dominio);
    }
  });
});

// --- listarOrdenesBodegaPaginado: la lista blanca del borde (feature 170, T K.1/R44) ---

describe("listarOrdenesBodegaPaginado — el borde (feature 170, T K.1)", () => {
  it("sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await listarOrdenesBodegaPaginado({}, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarOrdenesBodegaPaginado).not.toHaveBeenCalled();
  });

  it("input vacio vale: es lo que pide la pagina 1, con los defaults del dominio (R40)", async () => {
    const service = buildService();
    const r = await listarOrdenesBodegaPaginado({}, { service, getActor: actorAdmin });
    expect(r.status).toBe("ok");
    expect(service.listarOrdenesBodegaPaginado).toHaveBeenCalledWith(
      { page: 1, pageSize: 25 }, // recepcionSateliteConfig.DEFAULT_PAGE_SIZE
      ADMIN,
    );
  });

  it("una clave de ALCANCE colada muere en el borde, sin llegar al service (R44)", async () => {
    // El `.strict()` no es estetica: `zonaId` es justo la clave que convertiria este listado
    // en una ventana a la bodega del vecino si algun dia el service dejara de ignorarla.
    for (const colada of [{ zonaId: "z-b" }, { usuarioId: "u-sat-b" }, { mensajeroId: "m-1" }]) {
      const service = buildService();
      const r = await listarOrdenesBodegaPaginado(colada, { service, getActor: actorAdmin });
      expect(r.status, JSON.stringify(colada)).toBe("validation_error");
      expect(service.listarOrdenesBodegaPaginado).not.toHaveBeenCalled();
    }
  });

  it("un estado fuera de los cinco del listado muere en el borde (R44)", async () => {
    const service = buildService();
    const r = await listarOrdenesBodegaPaginado(
      { estados: ["entregada"] },
      { service, getActor: actorAdmin },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarOrdenesBodegaPaginado).not.toHaveBeenCalled();
  });

  it("los tres filtros validos llegan al service tal cual (R45)", async () => {
    const service = buildService();
    await listarOrdenesBodegaPaginado(
      {
        page: 2,
        pageSize: 10,
        estados: ["devuelta", "por_recoger"],
        cantones: ["Escazú"],
        distritos: ["San Rafael", "San Antonio"],
      },
      { service, getActor: actorAdmin },
    );
    expect(service.listarOrdenesBodegaPaginado).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 10,
        estados: ["devuelta", "por_recoger"],
        cantones: ["Escazú"],
        distritos: ["San Rafael", "San Antonio"],
      },
      ADMIN,
    );
  });

  it("un pageSize desmedido se RECORTA al maximo, no se rechaza (R40)", async () => {
    const service = buildService();
    const r = await listarOrdenesBodegaPaginado(
      { pageSize: 100000 },
      { service, getActor: actorAdmin },
    );
    expect(r.status).toBe("ok");
    expect(service.listarOrdenesBodegaPaginado).toHaveBeenCalledWith(
      { page: 1, pageSize: 100 }, // recepcionSateliteConfig.MAX_PAGE_SIZE
      ADMIN,
    );
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R44)", async () => {
    const service = buildService({
      listarOrdenesBodegaPaginado: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await listarOrdenesBodegaPaginado({}, { service, getActor: actorAdmin });
    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
    expect(r).not.toHaveProperty("total");
  });
});

// --- listarOrdenesBodegaCompleto: la lista blanca DERIVADA (feature 184, T A.3/R17) ---

describe("listarOrdenesBodegaCompleto — el borde del conjunto (feature 184, T A.3)", () => {
  it("sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await listarOrdenesBodegaCompleto({}, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarOrdenesBodegaCompleto).not.toHaveBeenCalled();
  });

  it("input vacío vale: el conjunto sin filtros, y sin page ni pageSize", async () => {
    const service = buildService();
    const r = await listarOrdenesBodegaCompleto({}, { service, getActor: actorAdmin });
    expect(r.status).toBe("ok");
    // La lista blanca es la de la pagina MENOS el recorte: al servicio no le llega ni un
    // `page` con default. Si llegara, el «conjunto» seria una pagina.
    expect(service.listarOrdenesBodegaCompleto).toHaveBeenCalledWith({}, ADMIN);
  });

  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    // Las dos familias: las de ALCANCE —que convertirian el archivo en una ventana a la bodega
    // del vecino— y las de RECORTE, que lo convertirian en una pagina. `page`/`pageSize` valen
    // en la pantalla y NO valen aqui: eso es exactamente lo que «derivada» significa.
    for (const colada of [
      { zonaId: "z-b" },
      { usuarioId: "u-sat-b" },
      { page: 2 },
      { pageSize: 25 },
      { busqueda: "x" },
    ]) {
      const service = buildService();
      const r = await listarOrdenesBodegaCompleto(colada, { service, getActor: actorAdmin });
      expect(r.status, JSON.stringify(colada)).toBe("validation_error");
      expect(service.listarOrdenesBodegaCompleto).not.toHaveBeenCalled();
    }
  });

  it("un estado fuera de los cinco del listado muere en el borde", async () => {
    const service = buildService();
    const r = await listarOrdenesBodegaCompleto(
      { estados: ["entregada"] },
      { service, getActor: actorAdmin },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarOrdenesBodegaCompleto).not.toHaveBeenCalled();
  });

  it("los tres filtros vigentes llegan al service tal cual (R3)", async () => {
    const service = buildService();
    await listarOrdenesBodegaCompleto(
      {
        estados: ["devuelta", "por_recoger"],
        cantones: ["Escazú"],
        distritos: ["San Rafael", "San Antonio"],
      },
      { service, getActor: actorAdmin },
    );
    expect(service.listarOrdenesBodegaCompleto).toHaveBeenCalledWith(
      {
        estados: ["devuelta", "por_recoger"],
        cantones: ["Escazú"],
        distritos: ["San Rafael", "San Antonio"],
      },
      ADMIN,
    );
  });

  it("limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)", async () => {
    const service = buildService({
      listarOrdenesBodegaCompleto: vi.fn(async () => ({
        status: "limite_excedido" as const,
        total: 5001,
        limite: 5000,
      })),
    });
    const r = await listarOrdenesBodegaCompleto({}, { service, getActor: actorAdmin });
    expect(r).toEqual({ status: "limite_excedido", total: 5001, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("forbidden del service pasa tal cual, sin filas ni total", async () => {
    const service = buildService({
      listarOrdenesBodegaCompleto: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await listarOrdenesBodegaCompleto({}, { service, getActor: actorAdmin });
    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });
});

// --- listarIdsVigentesBodega: la cota de ids y la lista blanca (feature 184, T A.3) ---

describe("listarIdsVigentesBodega — el borde de la vigencia (feature 184, T A.3)", () => {
  it("sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await listarIdsVigentesBodega({ ids: [uuid(1)] }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarIdsVigentesBodega).not.toHaveBeenCalled();
  });

  it("los ids y los filtros vigentes llegan al service tal cual (R19)", async () => {
    const service = buildService({
      listarIdsVigentesBodega: vi.fn(async () => ({
        status: "ok" as const,
        ids: [uuid(1)],
      })),
    });
    const r = await listarIdsVigentesBodega(
      { ids: [uuid(1), uuid(2)], estados: ["devuelta"], cantones: ["Escazú"] },
      { service, getActor: actorAdmin },
    );
    expect(r).toEqual({ status: "ok", ids: [uuid(1)] });
    expect(service.listarIdsVigentesBodega).toHaveBeenCalledWith(
      { ids: [uuid(1), uuid(2)], estados: ["devuelta"], cantones: ["Escazú"] },
      ADMIN,
    );
  });

  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    for (const colada of [
      { ids: [uuid(1)], zonaId: "z-b" },
      { ids: [uuid(1)], page: 1 },
      { ids: [uuid(1)], pageSize: 25 },
      { ids: [uuid(1)], usuarioId: "u-sat-b" },
    ]) {
      const service = buildService();
      const r = await listarIdsVigentesBodega(colada, { service, getActor: actorAdmin });
      expect(r.status, JSON.stringify(colada)).toBe("validation_error");
      expect(service.listarIdsVigentesBodega).not.toHaveBeenCalled();
    }
  });

  it("ids ausente, vacío o con un valor que no es uuid muere en el borde", async () => {
    // `orden.id` es uuid: un id con otra forma no puede ser vigente, y dejarlo pasar lo
    // convertiria en un parametro libre del `IN`.
    for (const malo of [{}, { ids: [] }, { ids: ["o-1"] }, { ids: [uuid(1), "no-uuid"] }]) {
      const service = buildService();
      const r = await listarIdsVigentesBodega(malo, { service, getActor: actorAdmin });
      expect(r.status, JSON.stringify(malo)).toBe("validation_error");
      expect(service.listarIdsVigentesBodega).not.toHaveBeenCalled();
    }
  });

  it("la cota de identificadores se aplica en el BORDE exacto (Q2)", async () => {
    const cota = recepcionSateliteConfig.MAX_IDS_VIGENCIA;
    const enLaCota = Array.from({ length: cota }, (_, i) => uuid(i));

    // Con la cota EXACTA pasa: la frontera es «más de», no «casi».
    const ok = buildService();
    expect((await listarIdsVigentesBodega({ ids: enLaCota }, { service: ok, getActor: actorAdmin })).status).toBe("ok");
    expect(ok.listarIdsVigentesBodega).toHaveBeenCalledTimes(1);

    // Con uno más, `validation_error` y el service NI SE TOCA: la lista acaba en un `IN` de
    // SQL y la propone el cliente. La selección no se altera (R22: el cliente no poda).
    const excedido = buildService();
    const r = await listarIdsVigentesBodega(
      { ids: [...enLaCota, uuid(cota)] },
      { service: excedido, getActor: actorAdmin },
    );
    expect(r.status).toBe("validation_error");
    expect(excedido.listarIdsVigentesBodega).not.toHaveBeenCalled();
  });

  it("forbidden del service pasa tal cual y no revela ningún id (R21)", async () => {
    const service = buildService({
      listarIdsVigentesBodega: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await listarIdsVigentesBodega({ ids: [uuid(1)] }, { service, getActor: actorAdmin });
    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("ids");
  });
});

// --- errores EXCEPCIONALES pasan por withErrorHandler ---

describe("withErrorHandler envuelve los cuerpos de las actions", () => {
  it("un error EXCEPCIONAL del service NO se propaga crudo", async () => {
    const service = buildService({
      recibir: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin })).rejects.toThrow(
      /AppErrorCode inesperado/,
    );
    await expect(recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin })).rejects.not.toThrow(
      /^db down$/,
    );
  });
});
