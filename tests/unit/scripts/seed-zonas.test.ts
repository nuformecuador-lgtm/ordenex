import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import {
  parseGeografiaRows,
  parseZonaHintRows,
  seedZonasCompleto,
  seedZonas,
} from "@/scripts/seed-zonas";

type GeoZonaPrisma = Pick<PrismaClient, "provincia" | "canton" | "distrito" | "zona">;

// --- Fake Prisma con estado en memoria (para idempotencia y cruce reales) ---
interface Row {
  id: string;
  [k: string]: unknown;
}
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}
function makeFakePrisma() {
  const state: Record<"provincia" | "canton" | "distrito" | "zona", Row[]> = {
    provincia: [],
    canton: [],
    distrito: [],
    zona: [],
  };
  let seq = 0;
  const nid = (p: string) => `${p}${++seq}`;

  function table(name: "provincia" | "canton" | "distrito") {
    return {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return state[name].find((r) => matches(r, where)) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: nid(name[0]), ...data };
        state[name].push(row);
        return row;
      }),
    };
  }

  const prisma = {
    provincia: table("provincia"),
    canton: table("canton"),
    distrito: {
      ...table("distrito"),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.distrito.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    zona: {
      upsert: vi.fn(
        async ({ where, create }: { where: { nombre: string }; create: Record<string, unknown> }) => {
          let row = state.zona.find((r) => r.nombre === where.nombre);
          if (!row) {
            // defaults de la DB: pagos 0 y es_gam false
            row = { id: nid("z"), pagoEntrega: 0, pagoRechazo: 0, esGam: false, ...create };
            state.zona.push(row);
          }
          // update: {} -> no sobrescribe nada (R39)
          return row;
        },
      ),
    },
  };
  return { prisma: prisma as unknown as GeoZonaPrisma, state };
}

// --- Fixtures XLSX sinteticos (uno por fuente) ---
function geoWorksheet(rows: string[][]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Geo");
  ws.addRow(["Provincia", "Cantón", "Distrito"]);
  for (const r of rows) ws.addRow(r);
  return ws;
}
function zonaWorksheet(rows: string[][]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Jerarquía (revisar)");
  ws.addRow(["Provincia", "Cantón", "Distrito", "Estado", "Zona", "Corrección/Nota"]);
  for (const r of rows) ws.addRow(r);
  return ws;
}

const GEO_ROWS = [
  ["San José", "Central", "Carmen"],
  ["San José", "Central", "Merced"],
  ["Limón", "Central", "Limón"],
  ["", "Central", "Z"], // geo incompleta -> omitida
];
const ZONA_ROWS = [
  ["San José", "Central", "Carmen", "ok", "GAM", ""],
  ["San José", "Central", "Merced", "ok", "Gam", ""], // dedup con GAM
  ["Limón", "Central", "Limón", "ok", "", ""], // zona vacia -> NULL
  ["Alajuela", "Otro", "Sinmatch", "ok", "ZONA SUR", ""], // terna sin correspondencia
  ["", "", "", "ok", "GAM", ""], // fila incompleta -> omitida
];

describe("parsers XLSX (R34/R35)", () => {
  it("parseGeografiaRows lee provincia/canton/distrito con cabeceras acentuadas", () => {
    const rows = parseGeografiaRows(geoWorksheet(GEO_ROWS));
    expect(rows).toContainEqual({ provincia: "San José", canton: "Central", distrito: "Carmen" });
  });

  it("parseZonaHintRows lee la columna Zona e ignora metadatos", () => {
    const rows = parseZonaHintRows(zonaWorksheet(ZONA_ROWS));
    expect(rows[0]).toEqual({ provincia: "San José", canton: "Central", distrito: "Carmen", zona: "GAM" });
  });
});

describe("seedZonas — dedup y defaults (R35/R37)", () => {
  it("GAM + Gam producen UNA sola zona con pagos 0 y es_gam=false", async () => {
    const { prisma, state } = makeFakePrisma();
    const hints = parseZonaHintRows(zonaWorksheet(ZONA_ROWS));
    const zonaByKey = await seedZonas(prisma, hints);

    // GAM (dedup) + Zona Sur = 2 zonas
    expect(state.zona).toHaveLength(2);
    const gam = state.zona.find((z) => z.nombre === "GAM");
    expect(gam).toBeDefined();
    expect(gam?.pagoEntrega).toBe(0);
    expect(gam?.esGam).toBe(false); // R37: nunca marca GAM
    expect(zonaByKey.get("gam")).toBe(gam?.id);
  });
});

describe("seedZonasCompleto — cruce y resumen (R34/R36/R38)", () => {
  it("puebla geografia, cruza por terna y arma el resumen", async () => {
    const { prisma, state } = makeFakePrisma();
    const geoRows = parseGeografiaRows(geoWorksheet(GEO_ROWS));
    const hints = parseZonaHintRows(zonaWorksheet(ZONA_ROWS));

    const summary = await seedZonasCompleto(prisma, geoRows, hints);

    // R34: 3 distritos poblados (Carmen, Merced, Limón); la fila geo incompleta se omite
    expect(summary.distritosPoblados).toBe(3);
    expect(summary.zonasCreadas).toBe(2);
    // R36: Carmen y Merced quedan con zona; Limón (zona vacia) sin zona
    expect(summary.distritosConZona).toBe(2);
    expect(summary.distritosSinZona).toBe(1);
    // R38: la terna Alajuela/Otro/Sinmatch no casa; una fila de hint incompleta
    expect(summary.ternasSinCorrespondencia).toBe(1);
    expect(summary.filasOmitidas).toBe(2);

    const carmen = state.distrito.find((d) => d.nombre === "Carmen");
    const gam = state.zona.find((z) => z.nombre === "GAM");
    expect(carmen?.zonaId).toBe(gam?.id); // R36: asignado
    const limon = state.distrito.find((d) => d.nombre === "Limón");
    expect(limon?.zonaId).toBeUndefined(); // R36: sin zona -> NULL (no seteado)

    // R37: ninguna zona sembrada con es_gam=true
    expect(state.zona.every((z) => z.esGam === false)).toBe(true);
  });
});

describe("idempotencia (R39)", () => {
  it("dos corridas no duplican y conservan ids; no pisan pagos/es_gam editados", async () => {
    const { prisma, state } = makeFakePrisma();
    const geoRows = parseGeografiaRows(geoWorksheet(GEO_ROWS));
    const hints = parseZonaHintRows(zonaWorksheet(ZONA_ROWS));

    await seedZonasCompleto(prisma, geoRows, hints);
    const provIds = state.provincia.map((p) => p.id);
    const zonaIds = state.zona.map((z) => z.id);

    // el maestro edita pagos y marca GAM entre corridas
    const gam = state.zona.find((z) => z.nombre === "GAM")!;
    gam.pagoEntrega = 999;
    gam.esGam = true;

    await seedZonasCompleto(prisma, geoRows, hints);

    // sin duplicados, mismos ids
    expect(state.provincia.map((p) => p.id)).toEqual(provIds);
    expect(state.zona.map((z) => z.id)).toEqual(zonaIds);
    expect(state.distrito).toHaveLength(3);
    // no se pisan pagos/es_gam editados
    expect(gam.pagoEntrega).toBe(999);
    expect(gam.esGam).toBe(true);
  });
});
