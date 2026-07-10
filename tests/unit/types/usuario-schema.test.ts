import { describe, it, expect } from "vitest";
import {
  actualizarUsuarioSchema,
  cambiarEstadoUsuarioSchema,
  crearUsuarioSchema,
  listarUsuariosSchema,
} from "@/lib/types/usuario";
import { usuariosConfig } from "@/lib/config/usuarios";

const baseCrear = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "0991234567",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-1",
};

describe("crearUsuarioSchema — union discriminada por passwordMode", () => {
  it("modo manual rechaza password que no cumple strongPasswordSchema (R6/R31)", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "manual",
      password: "debil", // sin mayuscula/digito/simbolo y corta
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fields = r.error.issues.map((i) => i.path.join("."));
      expect(fields).toContain("password");
    }
  });

  it("modo manual acepta password fuerte (R31)", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "manual",
      password: "Abcdef1!",
    });
    expect(r.success).toBe(true);
  });

  it("modo generate no requiere password (R30/R32)", () => {
    const r = crearUsuarioSchema.safeParse({ ...baseCrear, passwordMode: "generate" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("password");
  });

  it("rechaza email con formato invalido (R6)", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      email: "no-es-email",
      passwordMode: "generate",
    });
    expect(r.success).toBe(false);
  });

  it("strict: rechaza campos desconocidos", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "generate",
      hackeado: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("actualizarUsuarioSchema", () => {
  it("acepta solo campos editables", () => {
    const r = actualizarUsuarioSchema.safeParse({ nombre: "Nuevo", rolId: "rol-2" });
    expect(r.success).toBe(true);
  });

  it("rechaza email/cedula/password (R16)", () => {
    for (const campo of [{ email: "x@y.com" }, { cedula: "123" }, { password: "Abcdef1!" }]) {
      const r = actualizarUsuarioSchema.safeParse(campo);
      expect(r.success).toBe(false);
    }
  });
});

describe("cambiarEstadoUsuarioSchema", () => {
  it("solo acepta activo|inactivo (R23)", () => {
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "activo" }).success).toBe(true);
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "inactivo" }).success).toBe(true);
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "bloqueado" }).success).toBe(false);
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "pendiente" }).success).toBe(false);
  });
});

describe("listarUsuariosSchema", () => {
  it("acota pageSize a MAX (R13)", () => {
    const r = listarUsuariosSchema.parse({ pageSize: 100000 });
    expect(r.pageSize).toBe(usuariosConfig.MAX_PAGE_SIZE);
  });

  it("aplica defaults de page/sortBy/sortDir (R15)", () => {
    const r = listarUsuariosSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.sortBy).toBe("createdAt");
    expect(r.sortDir).toBe("desc");
  });

  it("rechaza sortBy fuera de la lista blanca (R15)", () => {
    expect(listarUsuariosSchema.safeParse({ sortBy: "passwordHash" }).success).toBe(false);
  });
});
