import { describe, it, expect, vi } from "vitest";
import { ApiOrdenEliminacionService } from "@/lib/services/ApiOrdenEliminacionService";
import type { EliminacionApiRepo } from "@/lib/services/ApiOrdenEliminacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenParaEliminacionApi } from "@/lib/interfaces/repositories/IOrdenRepository";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ESTADOS_ELIMINABLES } from "@/lib/types/order-status-eliminables";

// FICHA 320 — la LOGICA del borrado por API key: quien puede, en que estado y con que se responde.
//
// Lo que este archivo SI puede afirmar: que el owner que llega al repositorio es el del ACTOR (y
// no un parametro de la peticion), que el estado decide segun la lista compartida y que en cuanto
// algo no cuadra NO se llama a la escritura. Lo que NO puede: que el `where` del repositorio
// filtre de verdad —eso son dobles, no SQL— y por eso existen ademas
// `tests/unit/repositories/orden-repository.eliminar-api.test.ts` (la forma del `where`) y
// `tests/integration/db/eliminar-orden-api-frontera-tienda.test.ts` (Postgres de verdad).

const ACTOR: Actor = { usuarioId: "tienda-propia", rol: "apiKey" };
const ORDEN_ID = "ord-1";

function ordenEn(estatusValue: string): OrdenParaEliminacionApi {
  return { id: ORDEN_ID, numGuia: 100234, numRemision: "REM-0001", estatusValue };
}

function repoDoble(
  orden: OrdenParaEliminacionApi | null,
  eliminadas = 1,
): EliminacionApiRepo & {
  findParaEliminacionApi: ReturnType<typeof vi.fn>;
  softDeleteViaApi: ReturnType<typeof vi.fn>;
} {
  return {
    findParaEliminacionApi: vi.fn().mockResolvedValue(orden),
    softDeleteViaApi: vi.fn().mockResolvedValue(eliminadas),
  };
}

describe("ApiOrdenEliminacionService — la orden propia y eliminable (R1)", () => {
  it("R1: borra y devuelve la identidad mas el estado que TENIA", async () => {
    const repo = repoDoble(ordenEn("en_bodega_central"));
    const res = await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID);

    expect(res).toEqual({
      status: "ok",
      data: { numGuia: 100234, numRemision: "REM-0001", estado: "en_bodega_central" },
    });
  });

  it("R6: una orden SIN guia (fulfillment) se borra igual y responde `numGuia: null`", async () => {
    // EL CASO QUE MOTIVA LA FICHA: con fulfillment la orden nace en `en_preparacion` y todavia no
    // tiene guia. Si el endpoint se hubiera identificado por `num_guia`, aqui no habria nada que
    // borrar.
    const repo = repoDoble({
      id: ORDEN_ID,
      numGuia: null,
      numRemision: "REM-0002",
      estatusValue: "en_preparacion",
    });
    const res = await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID);

    expect(res).toEqual({
      status: "ok",
      data: { numGuia: null, numRemision: "REM-0002", estado: "en_preparacion" },
    });
  });
});

describe("ApiOrdenEliminacionService — la frontera multi-tenant (R3)", () => {
  it("R3: el owner que llega al repositorio es SIEMPRE `actor.usuarioId`, en las DOS sentencias", async () => {
    const repo = repoDoble(ordenEn("recolectando"));
    await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID);

    expect(repo.findParaEliminacionApi).toHaveBeenCalledWith(ORDEN_ID, "tienda-propia");
    expect(repo.softDeleteViaApi).toHaveBeenCalledWith({
      ordenId: ORDEN_ID,
      ownerId: "tienda-propia",
      estadosPermitidos: ESTADOS_ELIMINABLES,
      // FICHA 362 (R3): la cuenta dedicada de la key. Su rol `apiKey` queda congelado en la fila.
      actorUsuarioId: "tienda-propia",
    });
  });

  it("R3: una orden de OTRA tienda -> `not_found` y NO se escribe nada", async () => {
    // El repositorio devuelve `null` porque su `where` exige `tiendaId = ownerId`. Lo que se
    // afirma aqui es lo que el service hace con ese `null`: cortar ANTES de escribir, y responder
    // "no encontrada" —no "no autorizado"—, que es lo que impide deducir que la orden existe.
    const repo = repoDoble(null);
    const res = await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID);

    expect(res).toEqual({ status: "not_found" });
    expect(repo.softDeleteViaApi).not.toHaveBeenCalled();
  });

  it("R3: el actor NO puede colar otro owner: el service no acepta ninguno", async () => {
    // Aserto ESTRUCTURAL, no de comportamiento: `eliminar` recibe (actor, ordenId) y nada mas. Si
    // alguien anadiera un `ownerId` opcional a la firma, esto cae y hay que justificarlo.
    expect(ApiOrdenEliminacionService.prototype.eliminar).toHaveLength(2);
  });
});

describe("ApiOrdenEliminacionService — el criterio de estado, compartido con la app (R4/R5)", () => {
  it.each([...ESTADOS_ELIMINABLES])("R4: %s SI se puede borrar", async (estado) => {
    const repo = repoDoble(ordenEn(estado));
    const res = await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID);
    expect(res.status).toBe("ok");
    expect(repo.softDeleteViaApi).toHaveBeenCalledTimes(1);
  });

  const NO_ELIMINABLES = ORDER_STATUS_SEED.filter(
    (v) => !(ESTADOS_ELIMINABLES as readonly string[]).includes(v),
  );

  it("el catalogo se reparte 4 / 18: la lista de INCLUSION no cubre casi nada", () => {
    // CONTROL DE NO-VACUIDAD del `it.each` de abajo: si el reparto cambiara sin querer (por
    // ejemplo porque alguien amplia la lista), este numero lo dice antes que ningun otro test.
    expect(ESTADOS_ELIMINABLES).toHaveLength(4);
    expect(NO_ELIMINABLES).toHaveLength(ORDER_STATUS_SEED.length - 4);
  });

  it.each(NO_ELIMINABLES)("R4: %s NO se puede borrar -> conflict, sin escribir", async (estado) => {
    const repo = repoDoble(ordenEn(estado));
    const res = await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID);

    expect(res).toEqual({ status: "conflict" });
    // ⭑ Lo importante no es el codigo, es que NO se llamo a la escritura.
    expect(repo.softDeleteViaApi).not.toHaveBeenCalled();
  });

  it("R5: `en_ruta_bodega_central` NO, aunque `en_bodega_central` SI (la frontera exacta de la 319)", async () => {
    // El par que mas se presta a confusion, escrito a mano para que se lea. Si alguien "amplia un
    // poquito" la lista, este caso lo dice por su nombre.
    const enRuta = repoDoble(ordenEn("en_ruta_bodega_central"));
    expect((await new ApiOrdenEliminacionService(enRuta).eliminar(ACTOR, ORDEN_ID)).status).toBe(
      "conflict",
    );
    const enBodega = repoDoble(ordenEn("en_bodega_central"));
    expect((await new ApiOrdenEliminacionService(enBodega).eliminar(ACTOR, ORDEN_ID)).status).toBe(
      "ok",
    );
  });

  it("R5: un estado desconocido (no del catalogo) tambien falla CERRADO", async () => {
    const repo = repoDoble(ordenEn("estado_que_no_existe"));
    expect((await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID)).status).toBe(
      "conflict",
    );
  });
});

describe("ApiOrdenEliminacionService — carreras (R8)", () => {
  it("si el UPDATE no toca ninguna fila (otra sesion se adelanto) -> `not_found`", async () => {
    const repo = repoDoble(ordenEn("en_bodega_central"), 0);
    const res = await new ApiOrdenEliminacionService(repo).eliminar(ACTOR, ORDEN_ID);
    expect(res).toEqual({ status: "not_found" });
  });
});
