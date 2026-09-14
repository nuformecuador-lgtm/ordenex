import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Feature 426 — una ruta de API con la sesion vencida responde 401 JSON, no HTML.
 *
 * QUE VINO A CERRAR ESTE ARCHIVO, medido contra produccion el 2026-09-14:
 * `POST /api/ordenes/carga-masiva/chunk` sin sesion valida respondia **307 a /login**. Como el
 * 307 CONSERVA EL METODO, el cliente repetia el POST contra la pagina de login y recibia su HTML
 * con **200**; desde fuera es indistinguible de "el servidor se cayo", y asi lo reporto el
 * integrador. Los dos handlers afectados YA tenian su 401 escrito y nunca corria: el guard
 * respondia antes.
 *
 * Molde del archivo vecino (`middleware.test.ts`): middleware REAL, y se mockea SOLO
 * `isSessionActive`, que es la frontera con la DB. Reimplementar la logica aqui no verificaria
 * nada.
 *
 * Contrato que fija este archivo: R1 (401), R2 (json + code), R3 (ni 3xx ni Location),
 * R4 (la cookie muerta se sigue borrando), R5 (los cinco metodos), R7 (que cuenta como /api).
 */

const isSessionActive = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session-guard", () => ({ isSessionActive }));

const { middleware } = await import("@/middleware");

const BASE_URL = "https://app.test";

/** Las DOS unicas rutas de `app/api/**` que hoy pasan por el guard de sesion. */
const RUTA_CHUNK = "/api/ordenes/carga-masiva/chunk";
const RUTA_MEDIA = "/api/chat/media/11111111-2222-4333-8444-555555555555";

function buildRequest(pathname: string, method = "GET", session?: string): NextRequest {
  const request = new NextRequest(new URL(pathname, BASE_URL), { method });
  if (session) request.cookies.set("session", session);
  return request;
}

beforeEach(() => {
  isSessionActive.mockReset();
  isSessionActive.mockResolvedValue(false);
});

describe("middleware — 401 en rutas de API sin sesion (R1)", () => {
  it("POST /api/ordenes/carga-masiva/chunk sin cookie responde 401", async () => {
    const res = await middleware(buildRequest(RUTA_CHUNK, "POST"));

    expect(res.status).toBe(401);
  });

  it("GET /api/chat/media/<uuid> sin cookie responde 401", async () => {
    const res = await middleware(buildRequest(RUTA_MEDIA, "GET"));

    expect(res.status).toBe(401);
  });

  it("una ruta de API que todavia no existe tambien responde 401 (secure by default)", async () => {
    // La ruta numero 25 no esta escrita: el desenlace por defecto de `/api/*` debe ser el 401,
    // no el 307, sin que nadie tenga que acordarse de nada.
    const res = await middleware(buildRequest("/api/lo-que-sea/futuro", "POST"));

    expect(res.status).toBe(401);
  });

  it("el path `/api` exacto tambien es una ruta de API (R7)", async () => {
    const res = await middleware(buildRequest("/api", "GET"));

    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware — la forma del cuerpo del 401 (R2)", () => {
  it("el 401 llega con content-type application/json y un cuerpo con code UNAUTHORIZED", async () => {
    const res = await middleware(buildRequest(RUTA_CHUNK, "POST"));

    expect(res.headers.get("content-type")).toMatch(/^application\/json/);

    // `res.json()` no lanza: es exactamente lo que hoy revienta en el cliente de la carga
    // masiva con «Unexpected token '<'», porque lo que llegaba era la pagina de login.
    const cuerpo = (await res.json()) as Record<string, unknown>;
    expect(cuerpo.status).toBe("error");
    expect(cuerpo.code).toBe("UNAUTHORIZED");
    // El TEXTO no se compara contra `MSG.UNAUTHORIZED`: seria compararlo contra su propia
    // fuente y estaria verde pasara lo que pasara. El contrato que se fija es el `code`; del
    // mensaje solo se exige que exista y diga algo.
    expect(typeof cuerpo.message).toBe("string");
    expect((cuerpo.message as string).trim().length).toBeGreaterThan(0);
  });

  it("el cuerpo del 401 de la media tiene la misma forma que el de la carga (un solo contrato)", async () => {
    const res = await middleware(buildRequest(RUTA_MEDIA, "GET"));

    const cuerpo = (await res.json()) as Record<string, unknown>;
    expect(cuerpo.status).toBe("error");
    expect(cuerpo.code).toBe("UNAUTHORIZED");
  });
});

describe("middleware — el rechazo de una ruta de API no redirige (R3)", () => {
  it.each([RUTA_CHUNK, RUTA_MEDIA])(
    "%s no trae Location ni un status 3xx",
    async (ruta) => {
      const res = await middleware(buildRequest(ruta, "POST"));

      // Sin esta asercion, un 302 con cuerpo JSON pasaria R1 y R2 y el defecto seguiria vivo:
      // el cliente volveria a seguir el redirect hasta el HTML del login.
      expect(res.headers.get("location")).toBeNull();
      const esRedireccion = res.status >= 300 && res.status < 400;
      expect(esRedireccion, `el status ${res.status} es una redireccion`).toBe(false);
      expect(res.status).toBe(401);
    },
  );
});

describe("middleware — la cookie muerta se sigue borrando (R4)", () => {
  it("borra la cookie de sesion que fallo la validacion al responder 401", async () => {
    isSessionActive.mockResolvedValue(false);

    const res = await middleware(buildRequest(RUTA_CHUNK, "POST", "cookie-inventada"));

    expect(res.status).toBe(401);
    expect(res.cookies.get("session")?.value).toBe("");
    // Y se valido de verdad contra la DB: el 401 no es "no traia cookie", es "la cookie no vale".
    expect(isSessionActive).toHaveBeenCalledWith("cookie-inventada");
  });

  it("con sesion valida la ruta de API pasa (el 401 no se come al autenticado)", async () => {
    isSessionActive.mockResolvedValue(true);

    const res = await middleware(buildRequest(RUTA_CHUNK, "POST", "sesion-valida"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware — el desenlace no depende del metodo (R5)", () => {
  // El 307 conservaba el metodo: ESE es el mecanismo exacto por el que el integrador acabo
  // posteando su carga contra la pagina de login. Los cinco metodos, mismo desenlace.
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])(
    "responde 401 sea cual sea el metodo (%s)",
    async (metodo) => {
      const res = await middleware(buildRequest(RUTA_CHUNK, metodo));

      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
    },
  );
});

describe("middleware — que cuenta como ruta de API (R7)", () => {
  it("/apitos no es una ruta de API: sigue redirigiendo (307) a /login", async () => {
    // Control de la regla del primer segmento. Con `startsWith("/api")` a secas este caso
    // recibiria un 401 JSON y una PAGINA privada dejaria de mandar a su formulario de login.
    const res = await middleware(buildRequest("/apitos"));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
  });

  it("/api-docs es una PAGINA publica: sigue pasando con 200, nunca un 401 de API", async () => {
    // `/api-docs` (Swagger UI) vive en `PUBLIC_ROUTES` y ni siquiera llega al punto de rechazo;
    // se comprueba aqui porque su nombre invita a confundirla con `/api/docs`, que si es ruta
    // de API (el spec JSON) y tambien es publica.
    const res = await middleware(buildRequest("/api-docs"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it("una pagina privada cualquiera sin sesion conserva su 307 a /login?redirect= (R6)", async () => {
    const res = await middleware(buildRequest("/ordenes"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login?redirect=%2Fordenes");
  });

  it("/paquete/* sin sesion conserva su 307 a / (R6)", async () => {
    const res = await middleware(buildRequest("/paquete/ABC123"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/");
  });
});
