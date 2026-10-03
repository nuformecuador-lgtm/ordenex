// Ficha 470 (T4.6, design §2.1/§4.2) — GUARDIA R24: cada descarga de Familia A obtiene su conjunto por
// `descargarDatos("<clave>", …)` (la preparación de R5/R6); ninguna pantalla llama directamente a su
// acción de descarga para producir el archivo.
//
// Por qué una guardia: una pantalla que vuelva a llamar a `listarXCompleto(…)` directo FUNCIONA con
// conjuntos pequeños y falla solo en producción con uno grande (la respuesta de la acción pasa de 4,5 MB
// y Vercel la corta). Ningún test de pantalla lo ve: es exactamente un fallo mudo.
//
// El mapa clave → símbolo se LEE del propio registro (`lib/actions/_shared/registro-descargas.ts`): la
// clave no siempre es el nombre del símbolo (`listarPlantillasGastoFijoCompleto` →
// `listarPlantillasCompletoAction`), y así una entrada nueva queda vigilada sin tocar esta guardia.
//
// Dos direcciones:
//  1. ningún archivo de `app/` o `components/` usa el símbolo de una acción registrada (llamada o
//     referencia; sin contar imports ni comentarios), salvo las excepciones con motivo;
//  2. cada clave del registro aparece en algún `descargarDatos("<clave>"` de `app/` o `components/`.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");
const REGISTRO = path.join(RAIZ, "lib/actions/_shared/registro-descargas.ts");

/** Usos directos PERMITIDOS: la misma acción usada para PINTAR una pantalla, no para descargar. */
const EXCEPCIONES: ReadonlyArray<{ archivo: string; simbolo: string; motivo: string }> = [
  {
    archivo: "app/(app)/novedades/_components/NovedadesModule.tsx",
    simbolo: "listarAyudaTiendaCompletoAction",
    motivo: "`recursos.listarCompleto` pinta la pestaña de ayuda (useNovedadesFiltro); la descarga va por `descargarCompleto`",
  },
  {
    archivo: "app/(app)/novedades/_components/NovedadesModule.tsx",
    simbolo: "listarNovedadesCompletoAction",
    motivo: "`recursos.listarCompleto` pinta la pestaña de devoluciones (useNovedadesFiltro); la descarga va por `descargarCompleto`",
  },
  {
    archivo: "app/(app)/analitica/_components/finanzas/cargar-kpis.ts",
    simbolo: "listarSaldosTiendasCompletoAction",
    motivo: "KPIs de analítica (suma de saldos de tiendas), no una descarga",
  },
  {
    archivo: "app/(app)/analitica/_components/finanzas/cargar-kpis.ts",
    simbolo: "listarCuentasPorPagarCompletoAction",
    motivo: "KPIs de analítica (cuentas por pagar a mensajeros), no una descarga",
  },
];

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.(tsx?|jsx?|mts)$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/** Comentarios fuera (conservando saltos de línea) e imports fuera: solo queda código que USA. */
export function codigoDeUso(fuente: string): string {
  return fuente
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_todo, previo: string) => previo)
    .replace(/^[ \t]*import\b[\s\S]*?from\s*["'][^"']+["'];?/gm, (bloque) => bloque.replace(/[^\n]/g, " "));
}

/**
 * Cuántas veces el código (sin imports, comentarios ni literales de texto) usa `simbolo` como
 * identificador completo. Los literales fuera: en `descargarDatos("listarOrdenesCompleto", …)` la clave
 * coincide con el nombre del símbolo y NO es un uso de la acción.
 */
export function usosDe(fuente: string, simbolo: string): number {
  const sinLiterales = codigoDeUso(fuente).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  return sinLiterales.match(new RegExp(`(?<![\\w$])${simbolo}(?![\\w$])`, "g"))?.length ?? 0;
}

/** Clave → símbolo, leído de las entradas `clave: (input…) => simbolo(` del registro. */
export function mapaDelRegistro(fuente: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const entrada = /^\s*([A-Za-z0-9_$]+):\s*\([^)]*\)\s*=>\s*([A-Za-z0-9_$]+)\(/gm;
  for (const m of fuente.matchAll(entrada)) mapa.set(m[1], m[2]);
  return mapa;
}

const MAPA = mapaDelRegistro(readFileSync(REGISTRO, "utf8"));
const FUENTES = [...listarFuentes(path.join(RAIZ, "app")), ...listarFuentes(path.join(RAIZ, "components"))].map(
  (archivo) => ({ ruta: rutaRelativa(archivo), texto: readFileSync(archivo, "utf8") }),
);

describe("descargas por registro · auto-prueba del detector", () => {
  it("detecta una llamada directa y una referencia", () => {
    expect(usosDe("const r = await listarOrdenesCompleto({});", "listarOrdenesCompleto")).toBe(1);
    expect(usosDe("<X accion={listarGestionesCierresAdminCompleto} />", "listarGestionesCierresAdminCompleto")).toBe(1);
  });

  it("no cuenta imports (de una o varias líneas), comentarios ni prefijos de otro símbolo", () => {
    const limpio = [
      'import { listarOrdenesCompleto } from "@/lib/actions/ordenes";',
      "import {",
      "  libroCajaKardex,",
      '} from "x";',
      "// listarOrdenesCompleto( en un comentario",
      "/* libroCajaKardex( en un bloque */",
      'const r = descargarDatos("listarOrdenesCompleto", {});',
      "libroCajaKardexConDetalle(x);",
    ].join("\n");
    expect(usosDe(limpio, "listarOrdenesCompleto")).toBe(0);
    expect(usosDe(limpio, "libroCajaKardex")).toBe(0);
    expect(usosDe(limpio, "libroCajaKardexConDetalle")).toBe(1);
  });

  it("la clave dentro del literal de `descargarDatos` no es un uso; la llamada directa en la misma línea sí", () => {
    expect(usosDe('descargarDatos("listarOrdenesCompleto", { filter });', "listarOrdenesCompleto")).toBe(0);
    expect(usosDe('descargarDatos("x", {}); listarOrdenesCompleto({});', "listarOrdenesCompleto")).toBe(1);
  });

  it("lee el mapa del registro con las claves que NO son el nombre del símbolo", () => {
    expect(MAPA.get("listarPlantillasGastoFijoCompleto")).toBe("listarPlantillasCompletoAction");
    expect(MAPA.get("libroCajaKardexConDetalle")).toBe("libroCajaKardexConDetalleAction");
    expect(MAPA.get("listarCoberturaDistritos")).toBe("listarCoberturaDistritos");
    expect(MAPA.get("listarOrdenesCompleto")).toBe("listarOrdenesCompleto");
  });

  it("el registro tiene las 33 descargas y el árbol leído no está vacío", () => {
    expect(MAPA.size).toBe(33);
    expect(FUENTES.length, "no se leyó casi nada de app/ y components/").toBeGreaterThan(500);
    expect(FUENTES.some((f) => f.ruta === "app/(app)/ordenes/_components/OrdenesModule.tsx")).toBe(true);
  });

  it("cada excepción nombra un archivo existente y un símbolo del registro, con motivo", () => {
    const simbolos = new Set(MAPA.values());
    for (const e of EXCEPCIONES) {
      expect(FUENTES.some((f) => f.ruta === e.archivo), e.archivo).toBe(true);
      expect(simbolos.has(e.simbolo), e.simbolo).toBe(true);
      expect(e.motivo.length).toBeGreaterThan(20);
    }
  });
});

describe("descargas por registro · R24", () => {
  it("ninguna pantalla usa directamente la acción de una descarga registrada (salvo las excepciones)", () => {
    const violaciones: string[] = [];
    for (const [clave, simbolo] of MAPA) {
      for (const f of FUENTES) {
        const n = usosDe(f.texto, simbolo);
        if (n === 0) continue;
        const exc = EXCEPCIONES.find((e) => e.archivo === f.ruta && e.simbolo === simbolo);
        // La excepción cubre UN uso: un segundo uso en el mismo archivo es otra cosa y se reporta.
        if (exc !== undefined && n === 1) continue;
        violaciones.push(`${f.ruta}: ${simbolo} ×${n} — usa descargarDatos("${clave}", …)`);
      }
    }
    expect(violaciones).toEqual([]);
  });

  it("cada clave del registro se descarga por `descargarDatos(\"<clave>\"` en alguna pantalla", () => {
    const sinUso: string[] = [];
    for (const clave of MAPA.keys()) {
      const patron = new RegExp(`descargarDatos\\(\\s*["']${clave}["']`);
      if (!FUENTES.some((f) => patron.test(codigoDeUso(f.texto)))) sinUso.push(clave);
    }
    expect(sinUso).toEqual([]);
  });

  it("las excepciones siguen vigentes (si el uso desapareció, se retira la excepción)", () => {
    const caducadas = EXCEPCIONES.filter((e) => {
      const f = FUENTES.find((x) => x.ruta === e.archivo);
      return f === undefined || usosDe(f.texto, e.simbolo) === 0;
    }).map((e) => `${e.archivo}: ${e.simbolo}`);
    expect(caducadas).toEqual([]);
  });
});
