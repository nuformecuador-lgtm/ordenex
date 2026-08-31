import { describe, it, expect, vi } from "vitest";
import {
  handleEliminarOrdenApi,
  DELETE,
  type EliminarOrdenApiDeps,
} from "@/app/api/ordenes/api-key/orden/[id]/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  IApiOrdenResolucionService,
  ResolverOrdenResult,
} from "@/lib/interfaces/services/IApiOrdenResolucionService";
import type {
  ApiOrdenEliminacionResult,
  IApiOrdenEliminacionService,
} from "@/lib/interfaces/services/IApiOrdenEliminacionService";

// FICHA 320 — `DELETE /api/ordenes/api-key/orden/{id}`: el BORDE. Traduccion de cada resultado de
// dominio a HTTP, en el orden en que las puertas se cruzan (auth -> zod -> resolucion -> borrado).
//
// EL CASO QUE MAS IMPORTA es el de la orden AJENA: tiene que salir 404, NO 401 ni 403. Un 403
// significa "existe y no es tuya", y con eso una key puede enumerar las ordenes de otras tiendas
// preguntando una por una. Es la mutacion (iii) de la verificacion de esta ficha.

const ACTOR: Actor = { usuarioId: "tienda-propia", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";
const OK_AUTH: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };

function fakeResolucion(result: ResolverOrdenResult): IApiOrdenResolucionService {
  return { resolver: vi.fn().mockResolvedValue(result) };
}

function fakeEliminacion(result: ApiOrdenEliminacionResult): IApiOrdenEliminacionService {
  return { eliminar: vi.fn().mockResolvedValue(result) };
}

const RESUELTA: ResolverOrdenResult = {
  status: "ok",
  orden: { id: "ord-1", numGuia: 100234 },
  via: "num_guia",
};

function deps(
  auth: ApiKeyAuthResult,
  resolucion: IApiOrdenResolucionService,
  eliminacion: IApiOrdenEliminacionService,
): EliminarOrdenApiDeps {
  return {
    autenticar: async () => auth,
    resolucionService: resolucion,
    eliminacionService: eliminacion,
  };
}

function req(bearer?: string, id = "100234"): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(`http://localhost/api/ordenes/api-key/orden/${id}`, {
    method: "DELETE",
    headers,
  });
}

describe("DELETE /api/ordenes/api-key/orden/[id] — auth (R2)", () => {
  it("R2: sin/mal Bearer -> 401 y NO se resuelve ni se borra nada", async () => {
    const resolucion = fakeResolucion({ status: "not_found" });
    const eliminacion = fakeEliminacion({ status: "not_found" });
    const res = await handleEliminarOrdenApi(
      req(),
      "100234",
      deps({ status: "unauthenticated" }, resolucion, eliminacion),
    );

    expect(res.status).toBe(401);
    expect(resolucion.resolver).not.toHaveBeenCalled();
    expect(eliminacion.eliminar).not.toHaveBeenCalled();
  });

  it("R2: key de un usuario no activo -> 403, sin tocar ninguna orden", async () => {
    const resolucion = fakeResolucion({ status: "not_found" });
    const eliminacion = fakeEliminacion({ status: "not_found" });
    const res = await handleEliminarOrdenApi(
      req(SECRETO),
      "100234",
      deps({ status: "forbidden" }, resolucion, eliminacion),
    );

    expect(res.status).toBe(403);
    expect(resolucion.resolver).not.toHaveBeenCalled();
    expect(eliminacion.eliminar).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/ordenes/api-key/orden/[id] — validacion del path (R9)", () => {
  it.each([["", "vacio"], ["   ", "solo espacios"], ["x".repeat(129), "de 129 caracteres"]])(
    "R9: `%s` (%s) -> 422 sin consultar la base",
    async (id) => {
      const resolucion = fakeResolucion({ status: "not_found" });
      const eliminacion = fakeEliminacion({ status: "not_found" });
      const res = await handleEliminarOrdenApi(
        req(SECRETO, "irrelevante"),
        id,
        deps(OK_AUTH, resolucion, eliminacion),
      );

      expect(res.status).toBe(422);
      expect(resolucion.resolver).not.toHaveBeenCalled();
      expect(eliminacion.eliminar).not.toHaveBeenCalled();
    },
  );
});

describe("DELETE /api/ordenes/api-key/orden/[id] — borrado (R1/R3/R4/R8)", () => {
  it("R1: 200 con `{ numGuia, numRemision, estado }`", async () => {
    const eliminacion = fakeEliminacion({
      status: "ok",
      data: { numGuia: 100234, numRemision: "REM-0001", estado: "en_bodega_central" },
    });
    const res = await handleEliminarOrdenApi(
      req(SECRETO),
      "100234",
      deps(OK_AUTH, fakeResolucion(RESUELTA), eliminacion),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      numGuia: 100234,
      numRemision: "REM-0001",
      estado: "en_bodega_central",
    });
  });

  it("R6: el owner del borrado sale del ACTOR, y la orden de la RESOLUCION", async () => {
    const resolucion = fakeResolucion(RESUELTA);
    const eliminacion = fakeEliminacion({
      status: "ok",
      data: { numGuia: null, numRemision: "REM-0002", estado: "en_preparacion" },
    });
    await handleEliminarOrdenApi(
      req(SECRETO, "REM-0002"),
      "REM-0002",
      deps(OK_AUTH, resolucion, eliminacion),
    );

    // El identificador crudo va a la resolucion (guia O remision), ya trimado por el zod.
    expect(resolucion.resolver).toHaveBeenCalledWith(ACTOR, "REM-0002");
    // Y al borrado va el `orden.id` resuelto, con el MISMO actor: el controller no fabrica owners.
    expect(eliminacion.eliminar).toHaveBeenCalledWith(ACTOR, "ord-1");
  });

  it("R3: ⭑ una orden de OTRA tienda -> 404 (NUNCA 401/403), y no filtra que exista", async () => {
    // Cuando la orden es ajena, la resolucion (que fuerza el owner en su `where`) ya no la
    // encuentra: mismo 404 que si no existiera. Responder 403 aqui delataria su existencia.
    const eliminacion = fakeEliminacion({ status: "not_found" });
    const res = await handleEliminarOrdenApi(
      req(SECRETO),
      "100234",
      deps(OK_AUTH, fakeResolucion({ status: "not_found" }), eliminacion),
    );

    expect(res.status).toBe(404);
    expect(eliminacion.eliminar).not.toHaveBeenCalled();
    const cuerpo = (await res.json()) as { code: string; message: string };
    expect(cuerpo.code).toBe("NOT_FOUND");
    // El cuerpo no dice ni la tienda, ni el estado, ni si la orden existe en algun sitio.
    expect(JSON.stringify(cuerpo)).not.toMatch(/tienda|owner|ord-1|estado/i);
  });

  it("R3: y si la ajena se cuela hasta el service (carrera), TAMBIEN 404", async () => {
    // Segunda linea: aunque la resolucion hubiera dicho que si, el service vuelve a exigir el
    // dueño y su `not_found` sale por el mismo sitio.
    const res = await handleEliminarOrdenApi(
      req(SECRETO),
      "100234",
      deps(OK_AUTH, fakeResolucion(RESUELTA), fakeEliminacion({ status: "not_found" })),
    );
    expect(res.status).toBe(404);
  });

  it("R4: estado fuera de la lista -> 409 (igual que `cancelar`)", async () => {
    const res = await handleEliminarOrdenApi(
      req(SECRETO),
      "100234",
      deps(OK_AUTH, fakeResolucion(RESUELTA), fakeEliminacion({ status: "conflict" })),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("CONFLICT");
  });

  it("R8: repetir el DELETE sobre una orden ya borrada -> 404 (no revienta, no la borra dos veces)", async () => {
    const res = await handleEliminarOrdenApi(
      req(SECRETO),
      "100234",
      deps(OK_AUTH, fakeResolucion({ status: "not_found" }), fakeEliminacion({ status: "not_found" })),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/ordenes/api-key/orden/[id] — el export de Next", () => {
  it("el handler `DELETE` existe y desenvuelve `params` (Next 15: son una promesa)", async () => {
    // Sin esto, todo lo de arriba probaria una funcion que ninguna ruta expone.
    expect(typeof DELETE).toBe("function");
    const res = await DELETE(req(), { params: Promise.resolve({ id: "100234" }) });
    // Sin `deps` usa el autenticador real, que sin key valida -> 401. Basta para demostrar que el
    // verbo esta cableado a la logica y que `params` se resuelve.
    expect(res.status).toBe(401);
  });
});
