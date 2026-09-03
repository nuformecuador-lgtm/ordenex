import { describe, it, expect, vi, beforeEach } from "vitest";
import { AprobacionPostulacionService } from "@/lib/services/AprobacionPostulacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IAprobacionPostulacionRepository,
  PostulacionRow,
} from "@/lib/interfaces/repositories/IAprobacionPostulacionRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import { aprobacionPostulacionesConfig } from "@/lib/config/aprobacion-postulaciones";

// Feature 22 — unit del service con fakes de repo y signed-url-provider.
// Cubre R2, R3, R5, R6-R19.

const TTL = aprobacionPostulacionesConfig.SIGNED_URL_TTL_SECONDS;

function buildRow(overrides: Partial<PostulacionRow> = {}): PostulacionRow {
  return {
    usuarioId: "usr-1",
    nombre: "Ana",
    primerApellido: "Perez",
    segundoApellido: "Gomez",
    email: "ana@example.com",
    telefono: "0991234567",
    tipoIdentificacion: "cedula",
    cedula: "1710034065",
    vehiculo: "moto",
    placa: "ABC123",
    documentos: [
      { id: "d1", usuarioId: "usr-1", tipo: "cedula_anverso", storagePath: "usr-1/cedula_anverso.jpg", contentType: "image/jpeg" },
      { id: "d2", usuarioId: "usr-1", tipo: "cedula_reverso", storagePath: "usr-1/cedula_reverso.jpg", contentType: "image/jpeg" },
      { id: "d3", usuarioId: "usr-1", tipo: "propiedad_anverso", storagePath: "usr-1/propiedad_anverso.jpg", contentType: "image/jpeg" },
      { id: "d4", usuarioId: "usr-1", tipo: "propiedad_reverso", storagePath: "usr-1/propiedad_reverso.jpg", contentType: "image/jpeg" },
      { id: "d5", usuarioId: "usr-1", tipo: "foto_rostro", storagePath: "usr-1/foto_rostro.jpg", contentType: "image/jpeg" },
    ],
    ...overrides,
  };
}

function buildRepo(overrides: Partial<IAprobacionPostulacionRepository> = {}): IAprobacionPostulacionRepository {
  return {
    listPendientes: vi.fn().mockResolvedValue({ items: [buildRow()], total: 1 }),
    findMensajeroById: vi.fn().mockResolvedValue({ id: "usr-1", estado: "pendiente" }),
    actualizarEstadoSiPendiente: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

function buildSignedUrls(overrides: Partial<ISignedUrlProvider> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn().mockResolvedValue("https://signed/one"),
    createSignedUrls: vi.fn().mockImplementation(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
    ...overrides,
  };
}

const ROLES_OK: Actor["rol"][] = ["maestro", "admin"];
const ROLES_KO: Actor["rol"][] = ["mensajero", "adminTienda", "adminSatelite"];

function actor(rol: Actor["rol"]): Actor {
  return { usuarioId: "actor-1", rol };
}

describe("AprobacionPostulacionService", () => {
  beforeEach(() => vi.clearAllMocks());

  // ---- Autorizacion (R2/R3/R5) ----
  describe("R2: maestro y admin autorizados en las 3 operaciones", () => {
    for (const rol of ROLES_OK) {
      it(`${rol} puede listar/aprobar/rechazar`, async () => {
        const repo = buildRepo();
        const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
        expect((await svc.listarPendientes({ page: 1, pageSize: 20 }, actor(rol))).status).toBe("ok");
        expect((await svc.aprobar("usr-1", actor(rol))).status).toBe("ok");
        expect((await svc.rechazar("usr-1", actor(rol))).status).toBe("ok");
      });
    }
  });

  describe("R3/R5: roles no autorizados -> forbidden sin tocar repo/signedUrl", () => {
    for (const rol of ROLES_KO) {
      it(`${rol} recibe forbidden en las 3 operaciones`, async () => {
        const repo = buildRepo();
        const signed = buildSignedUrls();
        const svc = new AprobacionPostulacionService(repo, signed);

        expect((await svc.listarPendientes({ page: 1, pageSize: 20 }, actor(rol))).status).toBe("forbidden");
        expect((await svc.aprobar("usr-1", actor(rol))).status).toBe("forbidden");
        expect((await svc.rechazar("usr-1", actor(rol))).status).toBe("forbidden");

        // R5: guard antes de la capa de datos / Storage.
        expect(repo.listPendientes).not.toHaveBeenCalled();
        expect(repo.actualizarEstadoSiPendiente).not.toHaveBeenCalled();
        expect(repo.findMensajeroById).not.toHaveBeenCalled();
        expect(signed.createSignedUrls).not.toHaveBeenCalled();
      });
    }
  });

  // ---- Listado (R6-R11) ----
  it("R6: devuelve las postulaciones pendientes que entrega el repo", async () => {
    const repo = buildRepo({
      listPendientes: vi.fn().mockResolvedValue({ items: [buildRow({ usuarioId: "usr-9" })], total: 1 }),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.listarPendientes({ page: 1, pageSize: 20 }, actor("admin"));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items[0]?.usuarioId).toBe("usr-9");
  });

  it("R7: el DTO incluye identidad y contacto completos", async () => {
    const repo = buildRepo();
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.listarPendientes({ page: 1, pageSize: 20 }, actor("maestro"));
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items[0]).toMatchObject({
        nombre: "Ana",
        primerApellido: "Perez",
        segundoApellido: "Gomez",
        email: "ana@example.com",
        telefono: "0991234567",
        tipoIdentificacion: "cedula",
        cedula: "1710034065",
        vehiculo: "moto",
        placa: "ABC123",
      });
    }
  });

  it("R8: cada item trae 5 documentos con URL firmada", async () => {
    const repo = buildRepo();
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.listarPendientes({ page: 1, pageSize: 20 }, actor("admin"));
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      const docs = r.items[0]!.documentos;
      expect(docs).toHaveLength(5);
      for (const d of docs) expect(d.url).toMatch(/^https:\/\/signed\//);
    }
  });

  it("R9: firma con SIGNED_URL_TTL_SECONDS y lo expone en el DTO", async () => {
    const repo = buildRepo();
    const signed = buildSignedUrls();
    const svc = new AprobacionPostulacionService(repo, signed);
    const r = await svc.listarPendientes({ page: 1, pageSize: 20 }, actor("admin"));
    expect(signed.createSignedUrls).toHaveBeenCalledWith(expect.any(Array), TTL);
    if (r.status === "ok") expect(r.items[0]!.documentos[0]!.expiresInSeconds).toBe(TTL);
  });

  it("R10: traduce page/pageSize a skip/take y devuelve el total del repo", async () => {
    const repo = buildRepo({
      listPendientes: vi.fn().mockResolvedValue({ items: [], total: 42 }),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.listarPendientes({ page: 3, pageSize: 20 }, actor("admin"));
    expect(repo.listPendientes).toHaveBeenCalledWith({ skip: 40, take: 20 });
    if (r.status === "ok") {
      expect(r.total).toBe(42);
      expect(r.page).toBe(3);
      expect(r.pageSize).toBe(20);
    }
  });

  it("R11: sin pendientes devuelve lista vacia con total 0 y status ok", async () => {
    const repo = buildRepo({
      listPendientes: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.listarPendientes({ page: 1, pageSize: 20 }, actor("admin"));
    expect(r).toEqual({ status: "ok", items: [], page: 1, pageSize: 20, total: 0 });
  });

  // ---- Aprobar (R12-R15) ----
  it("R12/R15: aprobar pendiente cambia estado a activo via update condicional", async () => {
    const repo = buildRepo();
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.aprobar("usr-1", actor("maestro"));
    expect(r).toEqual({ status: "ok", usuarioId: "usr-1", estado: "activo" });
    expect(repo.actualizarEstadoSiPendiente).toHaveBeenCalledWith("usr-1", "activo", expect.any(String));
    // R15: no se reconsulta ni se toca otro dato en el camino feliz.
    expect(repo.findMensajeroById).not.toHaveBeenCalled();
  });

  it("R13: aprobar id que no es mensajero -> not_found, sin cambio", async () => {
    const repo = buildRepo({
      actualizarEstadoSiPendiente: vi.fn().mockResolvedValue(0),
      findMensajeroById: vi.fn().mockResolvedValue(null),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.aprobar("usr-x", actor("admin"));
    expect(r.status).toBe("not_found");
  });

  it("R14: aprobar mensajero no pendiente -> conflict, sin cambio", async () => {
    const repo = buildRepo({
      actualizarEstadoSiPendiente: vi.fn().mockResolvedValue(0),
      findMensajeroById: vi.fn().mockResolvedValue({ id: "usr-1", estado: "activo" }),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.aprobar("usr-1", actor("admin"));
    expect(r.status).toBe("conflict");
  });

  // ---- Rechazar (R16-R19) ----
  it("R16/R19: rechazar pendiente cambia estado a inactivo (no borra)", async () => {
    const repo = buildRepo();
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    const r = await svc.rechazar("usr-1", actor("maestro"));
    expect(r).toEqual({ status: "ok", usuarioId: "usr-1", estado: "inactivo" });
    expect(repo.actualizarEstadoSiPendiente).toHaveBeenCalledWith("usr-1", "inactivo", expect.any(String));
    // R19: el repo no expone delete; el service solo cambia estado.
    expect(repo).not.toHaveProperty("delete");
  });

  it("R17: rechazar id inexistente/no mensajero -> not_found", async () => {
    const repo = buildRepo({
      actualizarEstadoSiPendiente: vi.fn().mockResolvedValue(0),
      findMensajeroById: vi.fn().mockResolvedValue(null),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    expect((await svc.rechazar("usr-x", actor("admin"))).status).toBe("not_found");
  });

  it("R18: rechazar mensajero no pendiente -> conflict", async () => {
    const repo = buildRepo({
      actualizarEstadoSiPendiente: vi.fn().mockResolvedValue(0),
      findMensajeroById: vi.fn().mockResolvedValue({ id: "usr-1", estado: "inactivo" }),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    expect((await svc.rechazar("usr-1", actor("admin"))).status).toBe("conflict");
  });

  it("R14/R18 (carrera): count 0 aunque exista pendiente -> conflict, no doble efecto", async () => {
    // Segundo aprobador: el updateMany ya no afecta filas (otro gano la carrera).
    const repo = buildRepo({
      actualizarEstadoSiPendiente: vi.fn().mockResolvedValue(0),
      findMensajeroById: vi.fn().mockResolvedValue({ id: "usr-1", estado: "activo" }),
    });
    const svc = new AprobacionPostulacionService(repo, buildSignedUrls());
    expect((await svc.aprobar("usr-1", actor("admin"))).status).toBe("conflict");
  });
});
