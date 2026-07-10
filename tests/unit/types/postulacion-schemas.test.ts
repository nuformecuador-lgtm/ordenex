import { describe, it, expect } from "vitest";
import {
  postulacionSchema,
  validarArchivo,
  DOCUMENTO_TIPOS,
} from "@/lib/types/postulacion-mensajero";

// Feature 21 / R2, R4, R5, R6, R7, R8, R10, R11 — validacion de borde (zod).

function imagen(size = 1024, type = "image/jpeg") {
  return { type, size };
}

function payloadValido(overrides: Record<string, unknown> = {}) {
  const docs = Object.fromEntries(DOCUMENTO_TIPOS.map((t) => [t, imagen()]));
  return {
    nombre: "Ana",
    primer_apellido: "Perez",
    segundo_apellido: "Gomez",
    email: "ana@example.com",
    telefono: "0991234567",
    tipo_identificacion_id: "tipo-1",
    cedula: "1710034065",
    vehiculo_id: "veh-1",
    placa: "abc123",
    password: "Abcdef1!",
    confirmacion_password: "Abcdef1!",
    ...docs,
    ...overrides,
  };
}

describe("postulacionSchema — payload completo (R2)", () => {
  it("acepta un payload valido con los 5 documentos", () => {
    const parsed = postulacionSchema.safeParse(payloadValido());
    expect(parsed.success).toBe(true);
  });

  it("R2: segundo_apellido es omitible", () => {
    const p = payloadValido();
    delete (p as Record<string, unknown>).segundo_apellido;
    const parsed = postulacionSchema.safeParse(p);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.segundo_apellido).toBeUndefined();
  });
});

describe("postulacionSchema — campos obligatorios (R4)", () => {
  it.each(["nombre", "primer_apellido", "email", "telefono", "cedula", "vehiculo_id", "placa"])(
    "rechaza si falta %s con error en ese campo",
    (campo) => {
      const p = payloadValido();
      delete (p as Record<string, unknown>)[campo];
      const parsed = postulacionSchema.safeParse(p);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const fe = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
        expect(fe[campo]).toBeDefined();
      }
    },
  );
});

describe("postulacionSchema — email (R5)", () => {
  it("rechaza email invalido con error en email", () => {
    const parsed = postulacionSchema.safeParse(payloadValido({ email: "no-es-email" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.email).toBeDefined();
  });
});

describe("postulacionSchema — password (R6, A5)", () => {
  it("rechaza password menor a 8 caracteres", () => {
    const parsed = postulacionSchema.safeParse(
      payloadValido({ password: "Ab1!", confirmacion_password: "Ab1!" }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.password).toBeDefined();
  });

  it("rechaza password de mas de 72 caracteres", () => {
    const larga = "A1!" + "a".repeat(72);
    const parsed = postulacionSchema.safeParse(
      payloadValido({ password: larga, confirmacion_password: larga }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.password).toBeDefined();
  });
});

describe("postulacionSchema — confirmacion (R7)", () => {
  it("rechaza si password y confirmacion no coinciden", () => {
    const parsed = postulacionSchema.safeParse(
      payloadValido({ confirmacion_password: "Otra1234!" }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.confirmacion_password).toBeDefined();
    }
  });
});

describe("postulacionSchema — cedula/telefono numericos (R8)", () => {
  it("rechaza cedula no numerica", () => {
    const parsed = postulacionSchema.safeParse(payloadValido({ cedula: "12ab567" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.cedula).toBeDefined();
  });

  it("rechaza telefono demasiado corto", () => {
    const parsed = postulacionSchema.safeParse(payloadValido({ telefono: "123" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.telefono).toBeDefined();
  });
});

describe("postulacionSchema — documentos (R3, R10)", () => {
  it("R3: rechaza si falta un documento", () => {
    const p = payloadValido();
    delete (p as Record<string, unknown>).foto_rostro;
    const parsed = postulacionSchema.safeParse(p);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.foto_rostro).toBeDefined();
  });

  it("R10: rechaza documento que no es imagen permitida", () => {
    const parsed = postulacionSchema.safeParse(
      payloadValido({ cedula_anverso: imagen(1024, "application/pdf") }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.cedula_anverso).toBeDefined();
  });

  it("R10: rechaza documento que excede el tamano maximo", () => {
    const parsed = postulacionSchema.safeParse(
      payloadValido({ cedula_reverso: imagen(6 * 1024 * 1024) }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.cedula_reverso).toBeDefined();
  });
});

describe("validarArchivo — helper reutilizable (R10)", () => {
  it("acepta jpeg/png/webp dentro del limite", () => {
    expect(validarArchivo({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validarArchivo({ type: "image/png", size: 1000 })).toBeNull();
    expect(validarArchivo({ type: "image/webp", size: 1000 })).toBeNull();
  });

  it("rechaza tipo no permitido, vacio y sobre el limite", () => {
    expect(validarArchivo({ type: "image/gif", size: 1000 })).not.toBeNull();
    expect(validarArchivo({ type: "image/jpeg", size: 0 })).not.toBeNull();
    expect(validarArchivo({ type: "image/jpeg", size: 6 * 1024 * 1024 })).not.toBeNull();
    expect(validarArchivo(null)).not.toBeNull();
  });
});

describe("postulacionSchema — normalizacion de placa (R11)", () => {
  it("rechaza placa vacia", () => {
    const parsed = postulacionSchema.safeParse(payloadValido({ placa: "   " }));
    expect(parsed.success).toBe(false);
  });

  it("normaliza placa a trim + uppercase", () => {
    const parsed = postulacionSchema.safeParse(payloadValido({ placa: "  abc-123 " }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.placa).toBe("ABC-123");
  });
});
