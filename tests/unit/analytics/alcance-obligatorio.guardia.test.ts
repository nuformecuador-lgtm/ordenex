import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 122 / T4.3 — GUARDIA de R18: NADIE CONSULTA ANALITICA SIN EL TIPO OPACO.
//
// Los tipos cubren el 90%: una firma que pide `ConsultaAnalitica` no se puede llamar con
// un filtro suelto. Lo que los tipos NO cubren es el 10% que mas duele: `$queryRaw`, un
// servicio que reconstruya el filtro a mano, un repositorio que lea `orden` "solo para un
// contador". Este censo mira ese 10%.
//
// ⚠ HOY EL CENSO REAL ESTA VACIO: las features 126 (operativa) y 127 (financiera) todavia
// no existen, asi que no hay ningun consumidor de analitica en `lib/{repositories,services,
// actions}`. Un guardia que solo mirase el repo estaria verde por vacio durante semanas y
// nadie sabria si funciona. Por eso el censo se AUTOCOMPRUEBA con fixtures sinteticos: un
// consumidor legitimo (que debe pasar) y dos infractores (que deben caer), incluido uno con
// `$queryRaw`.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const CAPAS = ["repositories", "services", "actions"];
const DIRS_IGNORADOS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);

/** Las nueve tablas de analitica (`lib/analytics/types.ts`). */
const TABLAS_ANALITICA = [
  "analytics_daily",
  "orden",
  "gestion_orden",
  "orden_historial_estado",
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
];

/** Como se nombra cada tabla desde Prisma (`prisma.gestionOrden`, `prisma.orden`, ...). */
function nombrePrisma(tabla: string): string {
  const [primera, ...resto] = tabla.split("_");
  return primera + resto.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function archivosDeCodigo(raiz: string): string[] {
  if (!fs.existsSync(raiz)) return [];
  const encontrados: string[] = [];
  for (const entrada of fs.readdirSync(raiz, { withFileTypes: true })) {
    const completa = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      if (DIRS_IGNORADOS.has(entrada.name)) continue;
      encontrados.push(...archivosDeCodigo(completa));
    } else if (entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx")) {
      encontrados.push(completa);
    }
  }
  return encontrados;
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/**
 * "Contexto de analitica" = el archivo importa algo de `lib/analytics/`. Es la definicion
 * honesta: un repositorio de ordenes que no toca analitica no tiene por que recibir el
 * tipo opaco, y exigirselo convertiria el guardia en ruido que alguien acabaria apagando.
 */
function esContextoDeAnalitica(codigo: string): boolean {
  return /["'](@\/lib\/analytics\/|\.\.?\/[^"']*analytics\/)/.test(codigo);
}

function consultaTablaDeAnalitica(codigo: string): string | null {
  for (const tabla of TABLAS_ANALITICA) {
    const modelo = nombrePrisma(tabla);
    if (new RegExp(`\\.\\s*${modelo}\\s*\\.\\s*(findMany|findFirst|count|aggregate|groupBy)`).test(codigo)) {
      return tabla;
    }
    if (new RegExp(`(queryRaw|executeRaw)[\\s\\S]{0,400}\\b${tabla}\\b`).test(codigo)) {
      return `${tabla} (SQL crudo)`;
    }
  }
  return null;
}

function recibeConsultaPreparada(codigo: string): boolean {
  return /\bConsultaAnalitica\b/.test(codigo);
}

/**
 * Devuelve el motivo si el archivo consulta analitica sin el tipo opaco. Es la funcion que
 * los tres fixtures ejercitan: si deja de detectar, el guardia entero se queda mudo.
 */
export function violacionDeAlcanceObligatorio(nombre: string, fuente: string): string | null {
  const codigo = soloCodigo(fuente);
  if (!esContextoDeAnalitica(codigo)) return null;
  const tabla = consultaTablaDeAnalitica(codigo);
  if (!tabla) return null;
  if (recibeConsultaPreparada(codigo)) return null;
  return `${nombre}: consulta ${tabla} en contexto de analitica sin recibir ConsultaAnalitica`;
}

const FIXTURE_LEGITIMO = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { whereOrden } from "@/lib/analytics/alcance-columnas";
export class EntregasAnaliticaRepository {
  async contar(consulta: ConsultaAnalitica) {
    return this.prisma.orden.count({ where: { ...whereOrden(consulta.alcance) } });
  }
}
`;

const FIXTURE_INFRACTOR_PRISMA = `
import type { AnaliticaFiltroInput } from "@/lib/analytics/filters";
export class EntregasAnaliticaRepository {
  async contar(filtro: AnaliticaFiltroInput) {
    return this.prisma.orden.count({ where: { zonaId: filtro.zona_id?.[0] } });
  }
}
`;

const FIXTURE_INFRACTOR_RAW = `
import { getMetrica } from "@/lib/analytics/metrics";
export class RollupAnaliticaRepository {
  async serie(desde: Date) {
    void getMetrica("entregas");
    return this.prisma.$queryRaw\`SELECT fecha, SUM(valor) FROM analytics_daily WHERE fecha >= \${desde}\`;
  }
}
`;

describe("R18 · censo real sobre repositorios, servicios y acciones", () => {
  it("ningun archivo de lib/{repositories,services,actions} consulta analitica sin el tipo opaco", () => {
    const infractores = CAPAS.flatMap((capa) => archivosDeCodigo(path.join(REPO_ROOT, "lib", capa)))
      .map((archivo) =>
        violacionDeAlcanceObligatorio(relativa(archivo), fs.readFileSync(archivo, "utf8")),
      )
      .filter((v): v is string => v !== null);

    expect(infractores).toEqual([]);
  });

  it("el censo mira archivos de verdad en las tres capas (no pasa por vacio por ruta mal calculada)", () => {
    for (const capa of CAPAS) {
      const archivos = archivosDeCodigo(path.join(REPO_ROOT, "lib", capa));
      expect(archivos.length, `lib/${capa} sin archivos censados`).toBeGreaterThan(0);
    }
  });
});

describe("R18 · autocomprobacion con fixtures sinteticos (126/127 aun no existen)", () => {
  it("acepta el consumidor legitimo que recibe ConsultaAnalitica", () => {
    expect(violacionDeAlcanceObligatorio("legitimo.ts", FIXTURE_LEGITIMO)).toBeNull();
  });

  it("rechaza el repositorio que consulta orden con el filtro parseado suelto", () => {
    const v = violacionDeAlcanceObligatorio("infractor-prisma.ts", FIXTURE_INFRACTOR_PRISMA);
    expect(v).not.toBeNull();
    expect(v).toContain("orden");
  });

  it("rechaza el repositorio que lee analytics_daily con SQL crudo", () => {
    const v = violacionDeAlcanceObligatorio("infractor-raw.ts", FIXTURE_INFRACTOR_RAW);
    expect(v).not.toBeNull();
    expect(v).toContain("SQL crudo");
  });

  it("no marca un repositorio que consulta orden FUERA del contexto de analitica", () => {
    const ajeno = `
      export class OrdenRepository {
        async listar() { return this.prisma.orden.findMany({ where: { deletedAt: null } }); }
      }
    `;
    expect(violacionDeAlcanceObligatorio("ajeno.ts", ajeno)).toBeNull();
  });

  it("no se deja enganar por una mencion de ConsultaAnalitica en un comentario", () => {
    const disfrazado = FIXTURE_INFRACTOR_PRISMA.replace(
      "export class",
      "// TODO: migrar a ConsultaAnalitica\nexport class",
    );
    expect(violacionDeAlcanceObligatorio("disfrazado.ts", disfrazado)).not.toBeNull();
  });
});
