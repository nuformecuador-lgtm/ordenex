import { describe, it, expect, vi, type Mock } from "vitest";
import { GET } from "@/app/api/chat/media/[mensajeId]/route";
import type { ChatMediaRouteDeps } from "@/app/api/chat/media/[mensajeId]/route";
import type { WhatsappMediaOutcome } from "@/lib/clients/whatsapp-media";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ChatMediaAutorizada } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import { ROLES_HISTORICO_CONVERSACIONES } from "@/lib/auth/menu-visibility";

// Feature 318 / T4.2 (R29, R30, R26) — la bifurcacion por rol del proxy de media.
//
// Lo que fija este archivo, en una frase: el lector del histórico (`maestro`/`admin`) obtiene el
// binario de un adjunto que NO es de su orden, y NADIE MAS gana nada — un `adminSatelite`, un
// `adminTienda` o un mensajero ajeno siguen recibiendo 403 SIN que el servidor llegue a llamar a
// la Graph API.
//
// Los dobles distinguen las DOS vias del repositorio a proposito: asi el test no solo mira el
// status, sino CUAL de los dos metodos se llamo. Un ensanche hecho con un booleano dentro de
// `findMediaParaMensajero` (A2, descartada en design §6) no pasaria estos asserts.

const MENSAJE_ID = "11111111-2222-4333-8444-555555555555";

function actor(rol: Actor["rol"], usuarioId = "u-1"): Actor {
  return { usuarioId, rol, zonaId: null };
}

function media(over: Partial<ChatMediaAutorizada> = {}): ChatMediaAutorizada {
  return {
    mediaId: "MEDIA-DE-META-123",
    mediaMime: "image/jpeg",
    mediaNombre: null,
    ordenId: "orden-de-otro-mensajero",
    ...over,
  };
}

function pedir(deps: ChatMediaRouteDeps): Promise<Response> {
  return GET(
    new Request(`https://app.test/api/chat/media/${MENSAJE_ID}`),
    { params: Promise.resolve({ mensajeId: MENSAJE_ID }) },
    deps,
  );
}

type DescargadorEspiado = { descargar: Mock<(mediaId: string) => Promise<WhatsappMediaOutcome>> };

function descargadorOk(): DescargadorEspiado {
  return {
    descargar: vi.fn(async (): Promise<WhatsappMediaOutcome> => ({
      status: "ok",
      cuerpo: new Response("BINARIO").body,
      mime: "image/jpeg",
      tamano: 7,
    })),
  };
}

/**
 * Repositorio doble con las DOS vias separadas y espiadas.
 *
 * - `findMediaParaMensajero` devuelve fila SOLO para el mensajero asignado (`men-duenio`), que
 *   es exactamente lo que hace el WHERE real; para cualquier otro devuelve `null`.
 * - `findMediaParaLectorHistorico` devuelve fila siempre: no lleva scope de sesion (R29).
 */
function repoDoble() {
  return {
    findMediaParaMensajero: vi.fn(
      async (_id: string, mensajeroId: string): Promise<ChatMediaAutorizada | null> =>
        mensajeroId === "men-duenio" ? media() : null,
    ),
    findMediaParaLectorHistorico: vi.fn(
      async (mensajeId: string): Promise<ChatMediaAutorizada | null> =>
        mensajeId === MENSAJE_ID ? media() : null,
    ),
  };
}

describe("318 / R29 — el lector del histórico ve el adjunto de una orden ajena", () => {
  it.each([...ROLES_HISTORICO_CONVERSACIONES])(
    "actor %s que NO es el mensajero de la orden recibe 200 con su Content-Type",
    async (rol) => {
      const descargador = descargadorOk();
      const mensajeRepo = repoDoble();

      const res = await pedir({
        getActor: async () => actor(rol, "lector-historico"),
        mensajeRepo,
        descargador,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(await res.text()).toBe("BINARIO");
      // Se leyo por la via del histórico, y NO por la del mensajero con un scope falseado.
      expect(mensajeRepo.findMediaParaLectorHistorico).toHaveBeenCalledWith(MENSAJE_ID);
      expect(mensajeRepo.findMediaParaMensajero).not.toHaveBeenCalled();
    },
  );

  it("la ruta NO cambia de politica de cache: el binario sigue siendo privado", async () => {
    // El ensanche es de QUIEN puede leer, no de DONDE puede quedarse el binario: sigue siendo
    // PII del cliente y no puede acabar en una CDN compartida.
    const res = await pedir({
      getActor: async () => actor("admin", "lector-historico"),
      mensajeRepo: repoDoble(),
      descargador: descargadorOk(),
    });

    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(res.headers.get("Cache-Control")).not.toContain("public");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("410 cuando Meta ya no tiene el binario, tambien para el lector del histórico (R31)", async () => {
    const res = await pedir({
      getActor: async () => actor("maestro", "lector-historico"),
      mensajeRepo: repoDoble(),
      descargador: { descargar: vi.fn(async () => ({ status: "expirado" }) as WhatsappMediaOutcome) },
    });

    expect(res.status).toBe(410);
  });
});

describe("318 / R30 — el ensanche no abre la puerta a nadie mas", () => {
  it.each([
    ["adminSatelite" as const, "u-satelite"],
    ["adminTienda" as const, "u-tienda"],
    ["mensajero" as const, "men-ajeno"],
  ])("actor %s que no es el mensajero asignado recibe 403 sin llamar a la Graph API", async (rol, id) => {
    const descargador = descargadorOk();
    const mensajeRepo = repoDoble();

    const res = await pedir({ getActor: async () => actor(rol, id), mensajeRepo, descargador });

    expect(res.status).toBe(403);
    // R30 literal: la Graph API no se toca. El 403 se decide con la consulta, no despues de
    // haber bajado el binario.
    expect(descargador.descargar).not.toHaveBeenCalled();
    // Y NO se coló por la via del histórico: su rol no esta en la lista.
    expect(mensajeRepo.findMediaParaLectorHistorico).not.toHaveBeenCalled();
    expect(mensajeRepo.findMediaParaMensajero).toHaveBeenCalledWith(MENSAJE_ID, id);
  });

  it("apiKey tampoco entra por la via del histórico", async () => {
    const descargador = descargadorOk();
    const mensajeRepo = repoDoble();

    const res = await pedir({
      getActor: async () => actor("apiKey", "u-apikey"),
      mensajeRepo,
      descargador,
    });

    expect(res.status).toBe(403);
    expect(descargador.descargar).not.toHaveBeenCalled();
    expect(mensajeRepo.findMediaParaLectorHistorico).not.toHaveBeenCalled();
  });
});

describe("318 / R26 — la autorizacion del mensajero queda intacta", () => {
  it("el mensajero ASIGNADO sigue recibiendo 200 por su via de siempre", async () => {
    const descargador = descargadorOk();
    const mensajeRepo = repoDoble();

    const res = await pedir({
      getActor: async () => actor("mensajero", "men-duenio"),
      mensajeRepo,
      descargador,
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("BINARIO");
    expect(mensajeRepo.findMediaParaMensajero).toHaveBeenCalledWith(MENSAJE_ID, "men-duenio");
    expect(mensajeRepo.findMediaParaLectorHistorico).not.toHaveBeenCalled();
  });

  it("sin sesion sigue siendo 401, sin consultar ninguna de las dos vias", async () => {
    const descargador = descargadorOk();
    const mensajeRepo = repoDoble();

    const res = await pedir({ getActor: async () => null, mensajeRepo, descargador });

    expect(res.status).toBe(401);
    expect(mensajeRepo.findMediaParaMensajero).not.toHaveBeenCalled();
    expect(mensajeRepo.findMediaParaLectorHistorico).not.toHaveBeenCalled();
    expect(descargador.descargar).not.toHaveBeenCalled();
  });

  it("un doble que solo declara la via del mensajero falla CERRADO para el histórico", async () => {
    // Los tests de la 311 inyectan repositorios que no conocen la via nueva y NO se tocan
    // (T4.3). Con esos dobles, el lector del histórico no obtiene un permiso de regalo: se
    // normaliza a "sin fila" y sale 403, nunca 200.
    const descargador = descargadorOk();

    const res = await pedir({
      getActor: async () => actor("admin", "lector-historico"),
      mensajeRepo: { findMediaParaMensajero: vi.fn(async () => media()) },
      descargador,
    });

    expect(res.status).toBe(403);
    expect(descargador.descargar).not.toHaveBeenCalled();
  });
});
