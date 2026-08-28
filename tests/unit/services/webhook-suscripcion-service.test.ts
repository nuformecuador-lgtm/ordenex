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
  actualizarUrl: ReturnType<typeof vi.fn>;
  actualizarSecreto: ReturnType<typeof vi.fn>;
  desactivar: ReturnType<typeof vi.fn>;
} {
  const filas = new Map<string, { url: string; secret: string; activa: boolean }>();
  const upsert = vi.fn(async (data: WebhookSuscripcionUpsertData) => {
    filas.set(data.ownerUsuarioId, { url: data.url, secret: data.secret, activa: true });
  });
  const actualizarUrl = vi.fn(async (owner: string, url: string) => {
    const f = filas.get(owner);
    if (f) {
      f.url = url;
      f.activa = true; // reactiva, conserva el secreto
    }
  });
  const actualizarSecreto = vi.fn(async (owner: string, secret: string) => {
    const f = filas.get(owner);
    if (f) f.secret = secret; // conserva url/activa
  });
  const desactivar = vi.fn(async (owner: string) => {
    const f = filas.get(owner);
    if (f) f.activa = false;
  });
  const repo: IWebhookSuscripcionRepository = {
    upsertByOwner: upsert,
    actualizarUrlByOwner: actualizarUrl,
    actualizarSecretoByOwner: actualizarSecreto,
    desactivarByOwner: desactivar,
    async findActivaByOwner(owner): Promise<WebhookSuscripcionActiva | null> {
      const f = filas.get(owner);
      return f && f.activa ? { url: f.url, secret: f.secret } : null;
    },
    async findByOwner(owner): Promise<WebhookSuscripcionVista | null> {
      const f = filas.get(owner);
      return f ? { url: f.url, activa: f.activa } : null;
    },
    async resolverOwnerWebhook(owner: string) {
      return owner;
    },
  };
  return { repo, filas, upsert, actualizarUrl, actualizarSecreto, desactivar };
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

describe("R33/R7/R32 — ALTA persiste cifrado y retorna el secreto una vez (creada)", () => {
  it("el alta retorna el secreto en claro (status creada), persiste su CIPHERTEXT y no lo expone al consultar", async () => {
    const { repo, filas, upsert } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);

    const r = await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    expect(r).toEqual({ status: "creada", secret: "ordx_whsec_secreto-fijo" });

    // R32: lo persistido es el ciphertext producido por `cifrar`, nunca el secreto tal cual.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(filas.get("o1")!.secret).toBe("ENC(ordx_whsec_secreto-fijo)");
    expect(filas.get("o1")!.secret).not.toBe("ordx_whsec_secreto-fijo");

    // R7: la consulta de display NO trae el secreto.
    const vista = await service.obtener("o1");
    expect(vista).toEqual({ url: "https://a.example.com", activa: true });
    expect(JSON.stringify(vista)).not.toContain("ENC(");
  });

  it("R6: re-registrar el mismo owner no crea una segunda fila", async () => {
    const { repo, filas } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);
    await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    await service.registrar({ ownerUsuarioId: "o1", url: "https://b.example.com" });
    expect(filas.size).toBe(1);
    expect(filas.get("o1")!.url).toBe("https://b.example.com");
  });
});

describe("R33 (gate P4) — editar la URL NO rota el secreto", () => {
  it("editar un owner existente actualiza la URL, conserva el secreto y NO devuelve secreto (actualizada)", async () => {
    const { repo, filas, upsert, actualizarUrl } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);

    const alta = await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    expect(alta.status).toBe("creada");
    const secretoTrasAlta = filas.get("o1")!.secret;

    const edicion = await service.registrar({ ownerUsuarioId: "o1", url: "https://b.example.com" });
    expect(edicion).toEqual({ status: "actualizada" }); // sin secreto en el result
    expect("secret" in edicion).toBe(false);

    // La edición fue por actualizarUrlByOwner, NO por upsert (que reescribiría el secreto).
    expect(upsert).toHaveBeenCalledTimes(1); // solo el alta
    expect(actualizarUrl).toHaveBeenCalledWith("o1", "https://b.example.com");
    // Secreto intacto y URL nueva.
    expect(filas.get("o1")!.secret).toBe(secretoTrasAlta);
    expect(filas.get("o1")!.url).toBe("https://b.example.com");
  });

  it("editar una suscripción dada de baja la reactiva conservando el secreto", async () => {
    const { repo, filas } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);
    await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    const secretoTrasAlta = filas.get("o1")!.secret;
    await service.desactivar("o1");

    const r = await service.registrar({ ownerUsuarioId: "o1", url: "https://c.example.com" });
    expect(r).toEqual({ status: "actualizada" });
    expect(filas.get("o1")!.activa).toBe(true);
    expect(filas.get("o1")!.secret).toBe(secretoTrasAlta);
  });
});

describe("R34 (gate P4) — rotación explícita del secreto", () => {
  it("rotar genera un secreto NUEVO distinto, lo persiste cifrado y lo devuelve una vez", async () => {
    let n = 0;
    const generarVariable = () => `ordx_whsec_secreto-${++n}`;
    const { repo, filas, actualizarSecreto } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarVariable);

    const alta = await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    expect(alta.status).toBe("creada");
    const secretoTrasAlta = filas.get("o1")!.secret;

    const rot = await service.rotarSecreto("o1");
    expect(rot.status).toBe("ok");
    if (rot.status !== "ok") throw new Error("esperaba ok");
    // El nuevo secreto en claro es distinto del generado en el alta.
    expect(rot.secret).toBe("ordx_whsec_secreto-2");
    expect((alta as { secret: string }).secret).toBe("ordx_whsec_secreto-1");
    expect(rot.secret).not.toBe((alta as { secret: string }).secret);

    // Persistió el ciphertext del NUEVO secreto (invalidó el anterior).
    expect(actualizarSecreto).toHaveBeenCalledWith("o1", "ENC(ordx_whsec_secreto-2)");
    expect(filas.get("o1")!.secret).toBe("ENC(ordx_whsec_secreto-2)");
    expect(filas.get("o1")!.secret).not.toBe(secretoTrasAlta);
    // La URL no cambia al rotar.
    expect(filas.get("o1")!.url).toBe("https://a.example.com");
  });

  it("rotar sin suscripción devuelve not_found y no persiste nada", async () => {
    const { repo, actualizarSecreto } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);
    const r = await service.rotarSecreto("owner-sin-suscripcion");
    expect(r).toEqual({ status: "not_found" });
    expect(actualizarSecreto).not.toHaveBeenCalled();
  });

  it("R7: la vista de consulta tras rotar sigue sin exponer el secreto", async () => {
    const { repo } = buildRepo();
    const service = new WebhookSuscripcionService(repo, cifrarFake, generarFake);
    await service.registrar({ ownerUsuarioId: "o1", url: "https://a.example.com" });
    await service.rotarSecreto("o1");
    const vista = await service.obtener("o1");
    expect(JSON.stringify(vista)).not.toContain("ENC(");
    expect(JSON.stringify(vista)).not.toContain("ordx_whsec_");
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
