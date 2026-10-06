import { describe, it, expect, vi } from "vitest";
import { estadoAppMeta } from "@/lib/actions/plantillas";

// Ficha 474 (T5.3, R48) — la accion que la pantalla de plantillas consulta al activar «Lleva
// documento adjunto». Solo maestro; nunca devuelve el ID ni el token.

const MAESTRO = { usuarioId: "m", rol: "maestro" as const };

describe("474/R48 — estadoAppMeta", () => {
  it("identificada: no devuelve el id", async () => {
    const out = await estadoAppMeta({
      getActor: async () => MAESTRO,
      resolutorAppId: { resolver: async () => ({ ok: true, appId: "123456", origen: "meta" }) },
    });
    expect(out).toEqual({ status: "ok", estado: "identificada" });
    expect(JSON.stringify(out)).not.toContain("123456");
  });

  it("no identificada: mensaje claro con el codigo", async () => {
    const out = await estadoAppMeta({
      getActor: async () => MAESTRO,
      resolutorAppId: { resolver: async () => ({ ok: false, motivo: "http", codigo: 190 }) },
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok" || out.estado !== "no_identificada") throw new Error();
    expect(out.mensaje).toContain("código 190");
  });

  it("R1: admin -> forbidden sin consultar a Meta", async () => {
    const resolver = vi.fn();
    const out = await estadoAppMeta({ getActor: async () => ({ usuarioId: "a", rol: "admin" }), resolutorAppId: { resolver } });
    expect(out).toEqual({ status: "forbidden" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("sin sesion -> unauthenticated", async () => {
    const out = await estadoAppMeta({ getActor: async () => null, resolutorAppId: { resolver: vi.fn() } });
    expect(out).toEqual({ status: "unauthenticated" });
  });
});
