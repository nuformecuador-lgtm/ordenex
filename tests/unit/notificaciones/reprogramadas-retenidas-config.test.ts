import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  cronUtcDeHoraCR,
  reprogramadasRetenidasConfig,
} from "@/lib/config/reprogramadas-retenidas";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// FICHA 462 (decision del leader del 2026-09-25) — LAS DOS PERILLAS DEL AVISO, EN UN SOLO SITIO.
//
// La hora de emision y los roles del push son ajustables por el humano y viven en
// `lib/config/reprogramadas-retenidas.ts`. Lo que aqui se afirma:
//   · el valor de HOY, escrito a mano (07:00 CR; admin + adminSatelite), para que cambiarlo obligue
//     a tocar este test y a leer por que;
//   · que la hora declarada y el cron de `vercel.json` dicen LO MISMO (R24): la constante es la
//     fuente y el cron su copia en UTC; mover una sin la otra pone esto ROJO;
//   · que el modulo es PURO (lo importa `push-elegibles.ts`, que es puro).

const ROOT = path.resolve(__dirname, "..", "..", "..");

describe("462 — la configuracion de hoy, a mano", () => {
  it("la hora de emision es las 07:00 de Costa Rica", () => {
    expect(reprogramadasRetenidasConfig.HORA_EMISION_CR).toEqual({ hora: 7, minuto: 0 });
  });

  it("el push va a `admin` y `adminSatelite`, y a nadie mas", () => {
    expect([...reprogramadasRetenidasConfig.ROLES_PUSH]).toEqual(["admin", "adminSatelite"]);
  });
});

describe("462/R24 — la hora declarada y el cron de `vercel.json` dicen lo mismo", () => {
  it("`cronUtcDeHoraCR` convierte hora de pared CR a UTC (Costa Rica es UTC-6 fijo)", () => {
    expect(cronUtcDeHoraCR({ hora: 7, minuto: 0 })).toBe("0 13 * * *");
    expect(cronUtcDeHoraCR({ hora: 19, minuto: 0 })).toBe("0 1 * * *"); // el de reparto de mañana
    expect(cronUtcDeHoraCR({ hora: 0, minuto: 0 })).toBe("0 6 * * *"); // medianoche CR = los crons vecinos
    expect(cronUtcDeHoraCR({ hora: 6, minuto: 30 })).toBe("30 12 * * *");
  });

  it("⭑ el cron `avisos-diarios` de `vercel.json` es EXACTAMENTE la hora de emision declarada, en UTC", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const entrada = vercel.crons.find((c) => c.path === "/api/cron/avisos-diarios");
    expect(entrada, "falta el cron avisos-diarios en vercel.json").toBeDefined();
    expect(entrada?.schedule).toBe(cronUtcDeHoraCR(reprogramadasRetenidasConfig.HORA_EMISION_CR));
    // Y NO es la hora de pared escrita como si fuera UTC: eso pondria el aviso a la 1:00 CR.
    expect(entrada?.schedule).not.toBe("0 7 * * *");
  });
});

describe("462 — el modulo de configuracion es PURO", () => {
  it("no importa Prisma en runtime, ni React, ni next/*, ni la base, ni un reloj", () => {
    const codigo = codigoSinComentarios("lib/config/reprogramadas-retenidas.ts");
    expect(codigo).not.toMatch(/from\s+["']react["']/);
    expect(codigo).not.toMatch(/from\s+["']next\//);
    expect(codigo).not.toMatch(/@\/lib\/db/);
    expect(codigo).not.toMatch(/new Date\(/);
    // De `@prisma/client` SOLO el tipo del enum de roles, borrado al compilar.
    for (const linea of codigo.split("\n").filter((l) => l.includes("@prisma/client"))) {
      expect(linea).toMatch(/^\s*import\s+type\s/);
    }
  });

  it("y `push-elegibles.ts` lee los roles de aqui, no de una lista propia", () => {
    const codigo = codigoSinComentarios("lib/notificaciones/push-elegibles.ts");
    expect(codigo).toMatch(/reprogramadas_esperan_cierre:\s*\{\s*push:\s*"si",\s*roles:\s*reprogramadasRetenidasConfig\.ROLES_PUSH\s*\}/);
  });
});
