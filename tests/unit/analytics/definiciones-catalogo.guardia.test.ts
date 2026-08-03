import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { METRICAS } from "@/lib/analytics/metrics";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 135 / T3.4 — GUARDA de los vocabularios que cita el catalogo (R8 / R9 / R34).
//
// El catalogo es texto declarativo: nada impide escribir `estados: ["en_camino"]` o
// `categorias: ["sinpe"]` y que compile. Este guard ata cada cita al vocabulario REAL
// del repo, leyendo la fuente de verdad en crudo:
//   - los estados, contra `ORDER_STATUS_SEED` (`lib/types/order-status.ts`);
//   - las categorias, contra los enums de `db/schema.prisma` (no contra el cliente
//     generado, que puede estar desactualizado o sin generar).
//
// CUANTOS VALUES TIENE EL CATALOGO VIGENTE: lo dice `ORDER_STATUS_SEED`, no esta
// cabecera. La cifra se ha movido dos veces (la 154 lo llevo a 20, la **155 RETIRO
// `en_fulfillment`** dejandolo en 19, y la **157 anadio `recolectando`**), asi que aqui
// no se escribe a mano: los casos la derivan del seed. La retirada de `en_fulfillment`
// si deja rastro: su migracion solo borra la fila si nadie la referencia, asi que en una
// base con historial la fila SOBREVIVE huerfana e inalcanzable desde el codigo. Por eso
// hay un caso explicito: un KPI de embudo puede verla en un `GROUP BY estatus_id` real
// (problema de la 123/126), pero el catalogo de la 135 NO puede citarla.
//
// R34: la zona que se atribuye es la CONGELADA en la orden (D9). El censo de la zona
// del usuario en `lib/analytics/**` cierra la puerta a la otra interpretacion.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "db", "schema.prisma");
const DIR_ANALYTICS = path.join(REPO_ROOT, "lib", "analytics");

function leerEnumDelEsquema(nombre: string): string[] {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  const bloque = new RegExp(`enum ${nombre} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!bloque) throw new Error(`No se encontro el enum ${nombre} en db/schema.prisma`);
  return bloque[1]
    .split("\n")
    .map((linea) => linea.replace(/\/\/.*$/, "").trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("@@"))
    .map((linea) => linea.split(/\s+/)[0]);
}

/** Los SIETE vocabularios que R9 autoriza a citar en `definicion.categorias`. */
const ENUMS_AUTORIZADOS = [
  "GestionResultado",
  "GestionCausaDevolucion",
  "GestionCausaIncidente",
  "MetodoPagoValue",
  "WalletMovimientoCategoria",
  "WalletTiendaMovimientoCategoria",
  "PagoMensajeroMovimientoCategoria",
];

function archivosDeAnalytics(): string[] {
  return fs
    .readdirSync(DIR_ANALYTICS)
    .filter((nombre) => nombre.endsWith(".ts"))
    .map((nombre) => path.join(DIR_ANALYTICS, nombre));
}

describe("R8 · los estados citados existen en el catalogo vigente", () => {
  it("el catalogo de order_status tiene veinte values desde la 157 (recolectando)", () => {
    expect(ORDER_STATUS_SEED).toHaveLength(20); // +1: feature 157 (recolectando)
  });

  it("todo estado citado por una metrica pertenece a ORDER_STATUS_SEED", () => {
    for (const metrica of METRICAS) {
      for (const estado of metrica.definicion.estados ?? []) {
        expect(ORDER_STATUS_SEED as readonly string[], `metrica ${metrica.id}`).toContain(estado);
      }
    }
  });

  it("ninguna metrica cita en_fulfillment, retirado por la feature 155", () => {
    expect(ORDER_STATUS_SEED as readonly string[]).not.toContain("en_fulfillment");
    for (const metrica of METRICAS) {
      const estados: readonly string[] = metrica.definicion.estados ?? [];
      expect(estados, `metrica ${metrica.id}`).not.toContain("en_fulfillment");
    }
  });

  it("ningun archivo de lib/analytics nombra en_fulfillment", () => {
    for (const archivo of archivosDeAnalytics()) {
      const contenido = fs.readFileSync(archivo, "utf8");
      expect(contenido.includes("en_fulfillment"), `${path.basename(archivo)}`).toBe(false);
    }
  });

  it("el embudo por estado enumera los veinte values vigentes", () => {
    const embudo = METRICAS.find((m) => m.id === "ordenes_por_estado");
    expect(embudo).toBeDefined();
    expect([...(embudo!.definicion.estados ?? [])]).toEqual([...ORDER_STATUS_SEED]);
  });
});

describe("R9 · las categorias citadas existen en el esquema vigente", () => {
  it("toda categoria citada pertenece a uno de los siete enums autorizados", () => {
    const vocabulario = new Set(ENUMS_AUTORIZADOS.flatMap((nombre) => leerEnumDelEsquema(nombre)));
    for (const metrica of METRICAS) {
      for (const categoria of metrica.definicion.categorias ?? []) {
        expect(
          vocabulario.has(categoria),
          `metrica ${metrica.id}: "${categoria}" no existe en ${ENUMS_AUTORIZADOS.join(", ")}`,
        ).toBe(true);
      }
    }
  });

  it("los enums autorizados siguen existiendo en db/schema.prisma", () => {
    for (const nombre of ENUMS_AUTORIZADOS) {
      expect(leerEnumDelEsquema(nombre).length, `enum ${nombre}`).toBeGreaterThan(0);
    }
  });

  it("no cita metodos de pago inventados: SINPE va en mayusculas", () => {
    const metodos = leerEnumDelEsquema("MetodoPagoValue");
    expect(metodos).toEqual(["efectivo", "SINPE", "transferencia"]);
    const cod = METRICAS.find((m) => m.id === "cod_recaudado");
    expect([...(cod!.definicion.categorias ?? [])]).toContain("SINPE");
    expect([...(cod!.definicion.categorias ?? [])]).not.toContain("simpe");
  });

  it("las causas de devolucion citadas son las tres del enum vigente", () => {
    const causas = leerEnumDelEsquema("GestionCausaDevolucion");
    expect(causas).toEqual(["not_found", "wrong_number", "wrong_address"]);
    const motivos = METRICAS.find((m) => m.id === "motivos_devolucion");
    for (const causa of causas) {
      expect([...(motivos!.definicion.categorias ?? [])]).toContain(causa);
    }
  });
});

describe("R34 · atribucion por la zona congelada de la orden", () => {
  it("atribuye por la zona de la orden en toda metrica con grano zona", () => {
    const conGranoZona = METRICAS.filter((m) => m.granos.includes("zona"));
    expect(conGranoZona.length).toBeGreaterThan(0);
    for (const metrica of conGranoZona) {
      expect(metrica.definicion.atribucionZona, `metrica ${metrica.id}`).toBe("orden");
    }
  });

  it("no declara atribucion de zona en metricas sin grano zona", () => {
    for (const metrica of METRICAS) {
      if (!metrica.granos.includes("zona")) {
        expect(metrica.definicion.atribucionZona, `metrica ${metrica.id}`).toBeUndefined();
      }
    }
  });

  it("ningun archivo de lib/analytics atribuye por la zona del usuario", () => {
    // Censo literal: la otra interpretacion de D9 (la zona del mensajero que gestiono)
    // se escribiria asi. Debe dar cero, tambien en comentarios.
    const patron = /usuario\s*\.\s*zona_?[Ii]d/;
    for (const archivo of archivosDeAnalytics()) {
      const contenido = fs.readFileSync(archivo, "utf8");
      expect(patron.test(contenido), `${path.basename(archivo)} atribuye por la zona del usuario`)
        .toBe(false);
    }
  });
});
