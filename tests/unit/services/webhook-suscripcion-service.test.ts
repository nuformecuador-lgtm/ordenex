import { describe, it, expect, vi } from "vitest";
import { WebhookSuscripcionService } from "@/lib/services/WebhookSuscripcionService";
import type {
  IWebhookSuscripcionRepository,
  WebhookSuscripcionActiva,
  WebhookSuscripcionUpsertData,
  WebhookSuscripcionVista,
} from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";

// Feature 99 (R5/R6/R7/R8/R9/R32) — el servicio de registro es puro. `cifrar` y
// `generarSecreto` se inyectan para verificar el contrato sin claves reales.

function buildRepo(): {
  repo: IWebhookSuscripcionRepository;
  filas: Map<string, { url: string; secret: string; activa: boolean }>;
  upsert: ReturnType<typeof vi.fn>;
  desactivar: ReturnType<typeof vi.fn>;
} {
  const filas = new Map<string, { url: string; secret: string; activa: boolean }>();
  const upsert = vi.fn(async (data: WebhookSuscripcionUpsertData) => {
    filas.set(data.ownerUsuarioId, { url: data.url, secret: data.secret, activa: true });
  });
  const desactivar = vi.fn(async (owner: string) => {
    const f = filas.get(owner);
    if (f) f.activa = false;
  });
  const repo: IWebhookSuscripcionRepository = {
    upsertByOwner: upsert,
    desactivarByOwner: desactivar,
    async findActivaByOwner(owner): Promise<WebhookSuscripcionActiva | null> {
      const f = filas.get(owner);
      return f && f.activa ? { url: f.url, secret: f.secret } : null;
    },
    async findByOwner(owner): Promise<WebhookSuscripcionVista | null> {
      const f = filas.get(owner);
      return f ? { url: f.url, activa: f.activa } : null;
    },
    async ownerEsApiKey() {
      return true;
    },
  };
  return { repo, filas, upsert, desactivar };
}

const cifrarFake = (plano: string) => `ENC(${plano})`;
const generarFake = () => "ordx_whsec_secreto-fijo";

describe("R5 — validacion de URL", () => {
  it("rechaza una URL no https o relativa sin persistir", async () => {
    const { repo, upsert } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);

    for (const url of ["http://a.example.com", "/relativa", "ftp://x", "no-es-url", ""]) {
      const r = await service.registrar({ ownerUsuarioId: "o1", url });
      expect(r.status).toBe("validation_error");
    }
    expect(upsert).not.toHaveBeenCalled(); // nada persistido
  });
});

describe("R6/R7/R32 — registro persiste cifrado y retorna el secreto una vez", () => {
  it("retorna el secreto en claro, persiste su CIPHERTEXT y no lo expone al consultar", async () => {
    const { repo, filas, upsert } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);

    const r = await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    expect(r).toEqual({ status: "ok", secret: "ordx_whsec_secreto-fijo" });

    // R32: lo persistido es el ciphertext producido por `cifrar`, nunca el secreto tal cual.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(filas.get("o1")!.secret).toBe("ENC(ordx_whsec_secreto-fijo)");
    expect(filas.get("o1")!.secret).not.toBe("ordx_whsec_secreto-fijo");

    // R7: la consulta de display NO trae el secreto.
    const vista = await service.obtener("o1");
    expect(vista).toEqual({ url: "https://a.example.com", activa: true });
    expect(JSON.stringify(vista)).not.toContain("ENC(");
  });

  it("R6: re-registrar el mismo owner no crea una segunda fila (upsert)", async () => {
    const { repo, filas } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);
    await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    await service.registrar({ ownerUsuarioId: "o1", url: "https://b.example.com" });
    expect(filas.size).toBe(1);
    expect(filas.get("o1")!.url).toBe("https://b.example.com");
  });
});

describe("R8 — baja", () => {
  it("desactivar la suscripcion la marca inactiva", async () => {
    const { repo, filas } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);
    await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    await service.desactivar("o1");
    expect(filas.get("o1")!.activa).toBe(false);
    expect(await service.obtener("o1")).toEqual({ url: "https://a.example.com", activa: false });
  });
});

describe("R9 — aislamiento por owner", () => {
  it("un actor no puede operar la suscripcion de otro owner (las ops estan keyed por owner)", async () => {
    const { repo, filas, desactivar } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);
    await service.registrar({ ownerUsuarioId: "owner-A", url: "https://a.example.com" });
    await service.registrar({ ownerUsuarioId: "owner-B", url: "https://b.example.com" });

    // Operar sobre A JAMAS toca B.
    await service.desactivar("owner-A");
    expect(desactivar).toHaveBeenCalledWith("owner-A");
    expect(filas.get("owner-A")!.activa).toBe(false);
    expect(filas.get("owner-B")!.activa).toBe(true);
  });
});
