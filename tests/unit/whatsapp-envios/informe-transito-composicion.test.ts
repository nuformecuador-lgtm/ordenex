import { describe, it, expect, vi, beforeEach } from "vitest";

// Ficha 475 (design §9, M13) — COMPOSITION ROOT: el informe que el CATALOGO registra (no uno
// construido en el test) lee a traves del repositorio REAL sobre el cliente Prisma compartido.
// Leccion «composition root que no inyecta»: se comprueba que alguien lo PASA, no que se importa.
// Sin base: el cliente Prisma se sustituye por un espia de `$queryRaw` que responde segun el SQL.
// La version contra Postgres es `tests/integration/db/informe-transito-catalogo-real.test.ts`.

const llamadas: string[] = [];

vi.mock("@/lib/db/prisma-client", async (original) => {
  const real = await original<typeof import("@/lib/db/prisma-client")>();
  const ahora = Date.parse("2026-10-05T11:00:00.000Z");
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray | { strings?: string[] }) => {
      const sql = Array.isArray(strings) ? strings.join("?") : JSON.stringify(strings);
      llamadas.push(sql);
      if (sql.includes('FROM "zona"')) return [{ id: "z1", nombre: "GAM", es_central: true }];
      if (sql.includes("COUNT(*)")) return [{ n: 0 }];
      return [
        {
          orden_id: "o1",
          num_remision: "R-1",
          num_guia: 1,
          estado: "en_reparto",
          zona_id: "z1",
          destinatario: "Cliente",
          canton: "San José",
          distrito: null,
          monto_cobrar: "1000.00",
          hito_at: new Date(ahora - 9 * 86_400_000),
          ultima_at: null,
        },
      ];
    },
  };
  return { ...real, getPrismaClient: () => prisma };
});

describe("475/M13 — el catalogo registra el informe con el repositorio real", () => {
  beforeEach(() => {
    llamadas.length = 0;
  });

  it("generar del informe del catalogo pasa por el cliente Prisma: 3 consultas y la orden sembrada", async () => {
    const { INFORMES_WHATSAPP } = await import("@/lib/whatsapp-envios/informes/catalogo");
    const { PARAMETROS_POR_DEFECTO } = await import("@/lib/whatsapp-envios/informes/transito/parametros");
    const informe = INFORMES_WHATSAPP.get("transito")!;
    const r = await informe.generar({
      parametros: PARAMETROS_POR_DEFECTO,
      ahora: new Date("2026-10-05T11:00:00.000Z"),
      conDocumento: false,
    });
    expect(llamadas.length).toBe(3);
    expect(r.tipo).toBe("contenido");
    if (r.tipo === "contenido") expect(r.valores.total_en_alerta).toBe("1");
  });
});
