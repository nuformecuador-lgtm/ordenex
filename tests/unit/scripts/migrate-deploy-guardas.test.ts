import { describe, it, expect } from "vitest";
import {
  decidirMigracion,
  validarUrlMigraciones,
} from "@/scripts/migrate-deploy-guardas";

// Guardas del paso de migraciones del build. Cubren los dos fallos reales del
// 2026-07-27: el preview migrando la base de produccion, y `migrate deploy`
// colgado contra el pooler transaccional sin mensaje de error.

const SESION = "postgresql://u:p@aws-1-us-east-2.pooler.supabase.com:5432/postgres";
const TRANSACCIONAL = "postgresql://u:p@aws-1-us-east-2.pooler.supabase.com:6543/postgres";

describe("decidirMigracion", () => {
  it("migra en el deploy de produccion", () => {
    expect(decidirMigracion("production", undefined)).toEqual({ aplicar: true });
  });

  it("NO migra en preview sin el flag: la base podria ser la de produccion", () => {
    const decision = decidirMigracion("preview", undefined);
    expect(decision.aplicar).toBe(false);
    expect(decision.aplicar === false && decision.motivo).toContain(
      "MIGRATE_ON_PREVIEW",
    );
  });

  it("SI migra en preview con MIGRATE_ON_PREVIEW=true (base de pruebas propia)", () => {
    expect(decidirMigracion("preview", "true")).toEqual({ aplicar: true });
  });

  it("el flag solo cuenta con el valor exacto 'true'", () => {
    for (const valor of ["TRUE", "1", "si", "", " true "]) {
      expect(decidirMigracion("preview", valor).aplicar).toBe(false);
    }
  });

  it("el flag NO habilita migrar fuera de preview", () => {
    expect(decidirMigracion("development", "true").aplicar).toBe(false);
    expect(decidirMigracion(undefined, "true").aplicar).toBe(false);
  });

  it("NO migra en development", () => {
    expect(decidirMigracion("development", undefined).aplicar).toBe(false);
  });

  it("NO migra en un build local (sin VERCEL_ENV)", () => {
    for (const valor of [undefined, ""]) {
      const decision = decidirMigracion(valor, undefined);
      expect(decision.aplicar).toBe(false);
      expect(decision.aplicar === false && decision.motivo).toContain("db:migrate");
    }
  });

  it("NO migra ante un entorno desconocido (por defecto, no toca la base)", () => {
    expect(decidirMigracion("staging", undefined).aplicar).toBe(false);
  });
});

describe("validarUrlMigraciones", () => {
  it("prefiere DIRECT_URL sobre DATABASE_URL, igual que prisma.config.ts", () => {
    expect(
      validarUrlMigraciones({ DIRECT_URL: SESION, DATABASE_URL: TRANSACCIONAL }),
    ).toEqual({ status: "ok", variable: "DIRECT_URL" });
  });

  it("cae a DATABASE_URL cuando DIRECT_URL no esta (o esta vacia)", () => {
    expect(validarUrlMigraciones({ DATABASE_URL: SESION })).toEqual({
      status: "ok",
      variable: "DATABASE_URL",
    });
    expect(
      validarUrlMigraciones({ DIRECT_URL: "   ", DATABASE_URL: SESION }),
    ).toEqual({ status: "ok", variable: "DATABASE_URL" });
  });

  it("detecta el pooler transaccional por puerto :6543", () => {
    expect(validarUrlMigraciones({ DIRECT_URL: TRANSACCIONAL })).toEqual({
      status: "pooler_transaccional",
      variable: "DIRECT_URL",
    });
  });

  it("detecta el pooler transaccional por pgbouncer=true aunque el puerto sea 5432", () => {
    expect(
      validarUrlMigraciones({ DATABASE_URL: `${SESION}?pgbouncer=true` }),
    ).toEqual({ status: "pooler_transaccional", variable: "DATABASE_URL" });
  });

  it("reporta 'ausente' cuando no hay ninguna URL", () => {
    expect(validarUrlMigraciones({})).toEqual({ status: "ausente" });
  });

  it("no bloquea el build si la URL no es parseable (deja el error real a Prisma)", () => {
    expect(validarUrlMigraciones({ DIRECT_URL: "no-es-una-url" })).toEqual({
      status: "ok",
      variable: "DIRECT_URL",
    });
  });

  it("no confunde un ':6543' dentro de la contrasena con el puerto", () => {
    const passwordTrampa = "postgresql://u:pass6543@host.supabase.com:5432/postgres";
    expect(validarUrlMigraciones({ DIRECT_URL: passwordTrampa })).toEqual({
      status: "ok",
      variable: "DIRECT_URL",
    });
  });
});
