import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";

// Forma NATIVA del P2002 (motor sin adapter): el campo violado viene en meta.target.
function p2002Nativo(target: string[] | string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: { target },
  });
}

// Forma ADAPTER del P2002 (@prisma/adapter-pg / PrismaPg): meta.target === undefined;
// el nombre real de la constraint vive en driverAdapterError.cause.originalMessage.
function p2002Adapter(constraint: string, modelName = "Usuario") {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: {
      modelName,
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `llave duplicada viola restriccion de unicidad «${constraint}»`,
          kind: "UniqueConstraintViolation",
        },
      },
    },
  });
}

describe("esP2002", () => {
  it("true para PrismaClientKnownRequestError con code P2002", () => {
    expect(esP2002(p2002Nativo(["email"]))).toBe(true);
    expect(esP2002(p2002Adapter("usuario_email_key"))).toBe(true);
  });

  it("false para otros codigos de error de Prisma", () => {
    const p2003 = new Prisma.PrismaClientKnownRequestError("fk", {
      code: "P2003",
      clientVersion: "7.8.0",
    });
    expect(esP2002(p2003)).toBe(false);
  });

  it("false para errores que no son de Prisma", () => {
    expect(esP2002(new Error("boom"))).toBe(false);
    expect(esP2002(null)).toBe(false);
    expect(esP2002({ code: "P2002" })).toBe(false);
  });
});

describe("textoConstraintP2002", () => {
  it("forma nativa: array target -> texto en minusculas con las columnas", () => {
    expect(textoConstraintP2002(p2002Nativo(["email"]))).toBe("email");
    expect(textoConstraintP2002(p2002Nativo(["zona_es_central_unico"]))).toContain(
      "zona_es_central_unico",
    );
  });

  it("forma nativa: string target tambien se soporta", () => {
    expect(textoConstraintP2002(p2002Nativo("Cedula"))).toBe("cedula");
  });

  it("forma adapter: extrae el nombre de la constraint del originalMessage", () => {
    const texto = textoConstraintP2002(p2002Adapter("usuario_email_key"));
    expect(texto).not.toBeNull();
    expect(texto).toContain("usuario_email_key");
    expect(texto).toContain("email");
  });

  it("forma adapter: cedula y es_central quedan buscables por substring", () => {
    expect(textoConstraintP2002(p2002Adapter("usuario_cedula_key"))).toContain("cedula");
    expect(textoConstraintP2002(p2002Adapter("zona_es_central_unico", "Zona"))).toContain(
      "es_central",
    );
  });

  it("devuelve null si no es P2002", () => {
    expect(textoConstraintP2002(new Error("x"))).toBeNull();
    const p2003 = new Prisma.PrismaClientKnownRequestError("fk", {
      code: "P2003",
      clientVersion: "7.8.0",
    });
    expect(textoConstraintP2002(p2003)).toBeNull();
  });

  it("devuelve null si el P2002 no aporta ninguna pista (sin target ni adapter)", () => {
    const sinPista = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.8.0",
      meta: {},
    });
    expect(textoConstraintP2002(sinPista)).toBeNull();
  });

  it("no rompe si driverAdapterError tiene forma inesperada (acceso defensivo)", () => {
    const raro = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.8.0",
      meta: { driverAdapterError: { cause: null } },
    });
    expect(textoConstraintP2002(raro)).toBeNull();
  });
});
