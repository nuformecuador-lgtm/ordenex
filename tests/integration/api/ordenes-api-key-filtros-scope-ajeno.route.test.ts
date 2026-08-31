// Feature 257 (T9) — TEST DE SEGURIDAD, en archivo propio para que se vea al listar la suite.
// Cubre R21 y R22: filtrar por un `num_guia` o un `num_remision` que EXISTE pero pertenece a otra
// tienda debe devolver 200 con pagina vacia, y esa respuesta debe ser INDISTINGUIBLE de la de un
// numero que no existe en ninguna tienda.
//
// Por que existe este archivo, y que error concreto congela:
//   `num_guia` y `num_remision` son UNIQUE GLOBALES en `orden`. Eso convierte el listado en un
//   oraculo de existencia si alguna vez se resuelve el filtro como "busca la fila y luego
//   comprueba el dueno". El anti-patron PROHIBIDO (design.md §4.1) es
//   `findUnique(num_guia)` + comparar `tiendaId` despues: aunque el cuerpo final fuera igual,
//   dejaria un camino de codigo donde la fila ajena vive en memoria y una diferencia de latencia
//   observable (un hit del indice unico frente a un miss) con la que un integrador podria
//   enumerar las guias de la competencia.
//   El diseno aprobado lo cierra por construccion: el `where` lleva `tienda_id = owner` JUNTO al
//   numero, en la misma consulta, asi que NO HAY RAMA DE CODIGO que distinga "ajeno" de
//   "inexistente" — ambos son cero filas y `total = 0`. Por eso el `lecturaService` falso de este
//   archivo modela los dos escenarios con la MISMA pagina vacia: no es un atajo del test, es
//   exactamente lo que hace la implementacion, y el assert que importa es la comparacion directa
//   entre los dos cuerpos.
import { describe, it, expect, vi } from "vitest";
import { handleListadoApi, type ListadoApiDeps } from "@/app/api/ordenes/api-key/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import type { ApiOrdenListadoDTO } from "@/lib/types/api-orden";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";
const AUTH_OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };

// El numero AJENO existe de verdad en la base... pero en `store-2`. El INEXISTENTE no existe en
// ninguna tienda. Para el owner `store-1` los dos producen el mismo conjunto: vacio.
const GUIA_AJENA = 777001; // fila real de store-2
const GUIA_INEXISTENTE = 888002; // no existe en ninguna tienda
const REMISION_AJENA = "REM-AJENA-0001"; // fila real de store-2
const REMISION_INEXISTENTE = "REM-NUNCA-EXISTIO-0001";

function paginaVacia(): ApiOrdenListadoDTO {
  return { items: [], pagination: { limit: 50, offset: 0, total: 0 } };
}

/**
 * Service falso que replica el `where` del repo: `tienda_id = owner` AND el numero pedido. No
 * mira si la fila existe para otro dueno porque el codigo real tampoco lo hace: la consulta ya
 * sale acotada al owner. De ahi que ajeno e inexistente devuelvan lo mismo, siempre.
 */
function fakeService(): IApiOrdenLecturaService {
  return {
    listar: vi.fn().mockResolvedValue(paginaVacia()),
    detallePorOrdenId: vi.fn(), // feature 177: metodo hermano, no usado por este endpoint
  };
}

function deps(service: IApiOrdenLecturaService): ListadoApiDeps {
  return { autenticar: async () => AUTH_OK, lecturaService: service };
}

function req(query = "", bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(`http://localhost/api/ordenes/api-key${query}`, { method: "GET", headers });
}

describe("GET /api/ordenes/api-key — scope ajeno (R21/R22)", () => {
  it("R21: num_guia que existe pero es de OTRA tienda -> 200 con items vacios y total 0", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req(`?num_guia=${GUIA_AJENA}`, SECRETO),
      deps(service),
    );

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(404);
    const json = await res.json();
    expect(json.items).toEqual([]);
    expect(json.pagination.total).toBe(0);

    // El borde no trata distinto un numero ajeno: lo pasa tal cual. La indistinguibilidad se
    // resuelve aguas abajo (el `where` con `tienda_id`), no aqui.
    expect(service.listar).toHaveBeenCalledTimes(1);
    expect(vi.mocked(service.listar).mock.calls[0][1]).toMatchObject({ numGuia: GUIA_AJENA });
    expect(vi.mocked(service.listar).mock.calls[0][0].usuarioId).toBe("store-1");
  });

  it("R21: la respuesta de un num_guia AJENO es identica a la de uno INEXISTENTE", async () => {
    const ajeno = fakeService();
    const resAjeno = await handleListadoApi(req(`?num_guia=${GUIA_AJENA}`, SECRETO), deps(ajeno));
    const bodyAjeno = await resAjeno.json();

    const inexistente = fakeService();
    const resInexistente = await handleListadoApi(
      req(`?num_guia=${GUIA_INEXISTENTE}`, SECRETO),
      deps(inexistente),
    );
    const bodyInexistente = await resInexistente.json();

    // ESTE es el punto del archivo: un solo assert que compara los dos cuerpos enteros. Si alguien
    // reintroduce el anti-patron "busca y luego comprueba dueno", cualquier pista que se filtre
    // (un 404, un mensaje distinto, un total distinto) rompe aqui.
    expect(bodyAjeno).toEqual(bodyInexistente);
    expect(resAjeno.status).toBe(resInexistente.status);
    expect(resAjeno.status).toBe(200);
  });

  it("R22: num_remision que existe pero es de OTRA tienda -> 200 con items vacios y total 0", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req(`?num_remision=${REMISION_AJENA}`, SECRETO),
      deps(service),
    );

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(404);
    const json = await res.json();
    expect(json.items).toEqual([]);
    expect(json.pagination.total).toBe(0);

    expect(service.listar).toHaveBeenCalledTimes(1);
    expect(vi.mocked(service.listar).mock.calls[0][1]).toMatchObject({
      numRemision: REMISION_AJENA,
    });
    expect(vi.mocked(service.listar).mock.calls[0][0].usuarioId).toBe("store-1");
  });

  it("R22: la respuesta de un num_remision AJENO es identica a la de uno INEXISTENTE", async () => {
    const ajeno = fakeService();
    const resAjeno = await handleListadoApi(
      req(`?num_remision=${REMISION_AJENA}`, SECRETO),
      deps(ajeno),
    );
    const bodyAjeno = await resAjeno.json();

    const inexistente = fakeService();
    const resInexistente = await handleListadoApi(
      req(`?num_remision=${REMISION_INEXISTENTE}`, SECRETO),
      deps(inexistente),
    );
    const bodyInexistente = await resInexistente.json();

    expect(bodyAjeno).toEqual(bodyInexistente);
    expect(resAjeno.status).toBe(resInexistente.status);
    expect(resAjeno.status).toBe(200);
  });

  it("R21/R22: combinar guia ajena con remision ajena tampoco filtra nada (200, no 404)", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req(`?num_guia=${GUIA_AJENA}&num_remision=${REMISION_AJENA}`, SECRETO),
      deps(service),
    );

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(404);
    const json = await res.json();
    expect(json).toEqual({ items: [], pagination: { limit: 50, offset: 0, total: 0 } });
  });
});
