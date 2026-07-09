import { describe, it, expect } from "vitest";
import {
  HTTP_STATUS_BY_CODE,
  MSG,
  CODE_BY_DOMAIN_STATUS,
  type AppErrorCode,
} from "@/lib/errors/codes";

const ALL_CODES: AppErrorCode[] = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL",
];

describe("codes — AppErrorCode y mapas (R2, R3, R15, R16)", () => {
  it("AppErrorCode incluye los 6 codigos esperados en UPPER_SNAKE (R2)", () => {
    // HTTP_STATUS_BY_CODE y MSG estan tipados sobre AppErrorCode: sus llaves son la
    // fuente de verdad de los codigos existentes.
    expect(Object.keys(HTTP_STATUS_BY_CODE).sort()).toEqual([...ALL_CODES].sort());
    for (const code of ALL_CODES) {
      expect(code).toBe(code.toUpperCase());
    }
  });

  it("los codigos son distintos de los literales de status de dominio (R2)", () => {
    const domainLiterals = ["validation_error", "unauthenticated", "forbidden", "not_found", "conflict"];
    for (const code of ALL_CODES) {
      expect(domainLiterals).not.toContain(code);
    }
  });

  it("cada code mapea a su HTTP de referencia (R3)", () => {
    expect(HTTP_STATUS_BY_CODE.VALIDATION_ERROR).toBe(422);
    expect(HTTP_STATUS_BY_CODE.UNAUTHORIZED).toBe(401);
    expect(HTTP_STATUS_BY_CODE.FORBIDDEN).toBe(403);
    expect(HTTP_STATUS_BY_CODE.NOT_FOUND).toBe(404);
    expect(HTTP_STATUS_BY_CODE.CONFLICT).toBe(409);
    expect(HTTP_STATUS_BY_CODE.INTERNAL).toBe(500);
  });

  it("los mensajes no-INTERNAL son textos fijos en espanol, sin claves i18n (R15)", () => {
    const nonInternal: AppErrorCode[] = [
      "VALIDATION_ERROR",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
    ];
    for (const code of nonInternal) {
      const msg = MSG[code];
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
      // No debe parecer una clave de traduccion (p.ej. "errors.validation.invalid").
      expect(msg).not.toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      // Debe contener espacios (frase legible), no un identificador.
      expect(msg).toContain(" ");
    }
    expect(MSG.VALIDATION_ERROR).toBe("Los datos enviados no son validos.");
  });

  it("CODE_BY_DOMAIN_STATUS mapea los 5 status de dominio a su AppErrorCode (R16)", () => {
    expect(CODE_BY_DOMAIN_STATUS).toEqual({
      validation_error: "VALIDATION_ERROR",
      unauthenticated: "UNAUTHORIZED",
      forbidden: "FORBIDDEN",
      not_found: "NOT_FOUND",
      conflict: "CONFLICT",
    });
    expect(Object.keys(CODE_BY_DOMAIN_STATUS)).toHaveLength(5);
  });
});
