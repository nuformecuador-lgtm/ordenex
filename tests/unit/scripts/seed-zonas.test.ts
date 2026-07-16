import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import {
  parseGeografiaRows,
  parseZonaHintRows,
  seedZonasCompleto,
  seedZonas,
} from "@/scripts/seed-zonas";

// Feature 69/R28: el cruce escribe la N:M `zona_distrito` (feature 24), no `distrito.zona_id`
// (columna dropeada por `20260713000000_drop_distrito_zona_id`).
type GeoZonaPrisma = Pick<
  PrismaClient,
  "provincia" | "canton" | "distrito" | "zona" | "zonaDistrito"
>;

// --- Fake Prisma con estado en memoria (para idempotencia y cruce reales) ---
interface Row {
  id: string;
  [k: string]: unknown;
}
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}
function makeFakePrisma() {
  const state: Record<"provincia" | "canton" | "distrito" | "zona" | "zonaDistrito", Row[]> = {
    provincia: [],
    canton: [],
    distrito: [],
    zona: [],
    zonaDistrito: [], // feature 69/R28: la N:M donde vive la zona del distrito (feature 24)
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
    distrito: table("distrito"),
    // Feature 69/R28: doble de la tabla puente con la semantica REAL del constraint
    // `@@unique([zonaId, distritoId])`: el upsert del par no puede duplicar (R39).
    zonaDistrito: {
      upsert: vi.fn(
        async ({
          where,
        }: {
          where: { zonaId_distritoId: { zonaId: string; distritoId: string } };
        }) => {
          const { zonaId, distritoId } = where.zonaId_distritoId;
          let row = state.zonaDistrito.find(
            (r) => r.zonaId === zonaId && r.distritoId === distritoId,
          );
          if (!row) {
            row = { id: nid("zd"), zonaId, distritoId };
            state.zonaDistrito.push(row);
          }
          return row; // update: {} -> no sobrescribe nada
        },
      ),
    },
    zona: {
      upsert: vi.fn(
        async ({ where, create }: { where: { nombre: string }; create: Record<string, unknown> }) => {
          let row = state.zona.find((r) => r.nombre === where.nombre);
          if (!row) {
            // feature 54: default de la DB es_central false (los pagos se movieron a tarifa_zona_mensajero)
            row = { id: nid("z"), esCentral: false, ...create };
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
  it("GAM + Gam producen UNA sola zona con es_central=false", async () => {
    const { prisma, state } = makeFakePrisma();
    const hints = parseZonaHintRows(zonaWorksheet(ZONA_ROWS));
    const zonaByKey = await seedZonas(prisma, hints);

    // GAM (dedup) + Zona Sur = 2 zonas
    expect(state.zona).toHaveLength(2);
    const gam = state.zona.find((z) => z.nombre === "GAM");
    expect(gam).toBeDefined();
    expect(gam?.esCentral).toBe(false); // R37: nunca marca la zona central
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

    // R36 + feature 69/R28: la asignacion vive en `zona_distrito` (feature 24), NO en
    // `distrito.zona_id` (columna dropeada por `20260713000000_drop_distrito_zona_id`).
    const carmen = state.distrito.find((d) => d.nombre === "Carmen");
    const gam = state.zona.find((z) => z.nombre === "GAM");
    expect(state.zonaDistrito).toContainEqual(
      expect.objectContaining({ zonaId: gam?.id, distritoId: carmen?.id }),
    ); // R36: asignado
    const limon = state.distrito.find((d) => d.nombre === "Limón");
    expect(state.zonaDistrito.some((zd) => zd.distritoId === limon?.id)).toBe(false); // R36: zona vacia -> sin relacion

    // R37: ninguna zona sembrada con es_central=true
    expect(state.zona.every((z) => z.esCentral === false)).toBe(true);
  });
});

describe("idempotencia (R39)", () => {
  it("dos corridas no duplican y conservan ids; no pisan es_central editado", async () => {
    const { prisma, state } = makeFakePrisma();
    const geoRows = parseGeografiaRows(geoWorksheet(GEO_ROWS));
    const hints = parseZonaHintRows(zonaWorksheet(ZONA_ROWS));

    await seedZonasCompleto(prisma, geoRows, hints);
    const provIds = state.provincia.map((p) => p.id);
    const zonaIds = state.zona.map((z) => z.id);
    const zdIds = state.zonaDistrito.map((zd) => zd.id); // feature 69/R28

    // el maestro marca la zona central entre corridas
    const gam = state.zona.find((z) => z.nombre === "GAM")!;
    gam.esCentral = true;

    await seedZonasCompleto(prisma, geoRows, hints);

    // sin duplicados, mismos ids
    expect(state.provincia.map((p) => p.id)).toEqual(provIds);
    expect(state.zona.map((z) => z.id)).toEqual(zonaIds);
    expect(state.distrito).toHaveLength(3);
    // Feature 69/R28: el upsert sobre `zona_distrito` es idempotente — re-correr el seed NO
    // duplica el par (zona, distrito) ni cambia sus ids.
    expect(state.zonaDistrito.map((zd) => zd.id)).toEqual(zdIds);
    expect(state.zonaDistrito).toHaveLength(2); // Carmen y Merced (Limón no tiene zona)
    // no se pisa es_central editado (update: {} en el upsert)
    expect(gam.esCentral).toBe(true);
  });
});
