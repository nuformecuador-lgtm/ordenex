import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";
import { listarMetricas } from "@/lib/analytics/metrics";

// Feature 176 / T5.1 — GUARDIA PERENNE de R13, R16 y R17.
//
// ⚠ ESTE ARCHIVO NO CADUCA. Es un censo ESTRUCTURAL: no mide diffs contra ninguna rama, asi
// que sobrevive al merge y debe seguir verde para siempre. El que caduca es el otro,
// `agregado-frontera.guardia.test.ts`, y vive aparte JUSTAMENTE por esto: retirarlo en el PR
// que mergea la 176 no puede llevarse por delante nada de lo de aqui.
//
// Cada censo lleva su caso DISCRIMINANTE —un fragmento infractor sintetico que el detector
// tiene que cazar—, patron de `operativa-solo-lectura.guardia.test.ts:84-92`. Sin el, un
// detector roto quedaria verde por vacio para siempre y nadie se enteraria.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const SERVICIO = "lib/services/AnaliticaOperativaService.ts";
const INTERFAZ_SERVICIO = "lib/interfaces/services/IAnaliticaOperativaService.ts";
const ACCION = "lib/actions/analitica-operativa.ts";
const INTERFAZ_ROLLUP = "lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts";

function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

function leerCodigo(rel: string): string {
  return soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

/* -------------------------------------------------------------------------- */
/* R13 — ninguna firma del agregado recibe filtro, alcance ni rango sueltos    */
/* -------------------------------------------------------------------------- */

/**
 * Las firmas DECLARADAS del modo agregado: `consultarAgregado`, `consultarAgregadoOperativo`
 * y el objeto de opciones. No es estilo: el aviso de la 122 es literal — «si una firma
 * necesita el filtro suelto, el recorte se esta perdiendo». El recorte viaja ENTERO dentro de
 * `ConsultaAnalitica`, que es opaca y no se puede fabricar.
 */
function firmasDelAgregado(codigo: string): string[] {
  const firmas: string[] = [];
  // `[^()]*` y no `[\s\S]*?`: asi solo casan las DECLARACIONES (cuya lista de parametros no
  // lleva parentesis) y no las LLAMADAS, que si los llevan y arrastrarian medio archivo.
  for (const m of codigo.matchAll(/consultarAgregado[A-Za-z]*\s*\(([^()]*)\)\s*:/g)) {
    firmas.push(m[1]);
  }
  for (const m of codigo.matchAll(/interface\s+OpcionesAgregado\s*\{([\s\S]*?)\}/g)) {
    firmas.push(m[1]);
  }
  return firmas;
}

/** Los tipos que NO pueden aparecer en esas firmas: son los canales de alcance. */
const CANALES_PROHIBIDOS = /AnaliticaFiltroInput|AlcanceDatos|RangoResuelto|ActorAnalitica/;

describe("R13 · el modo agregado no abre un segundo canal de alcance", () => {
  it("ninguna firma del modo agregado recibe filtro, alcance o rango sueltos", () => {
    const firmas = [SERVICIO, INTERFAZ_SERVICIO, ACCION].flatMap((rel) =>
      firmasDelAgregado(leerCodigo(rel)).map((f) => ({ rel, f })),
    );
    // El censo mira firmas de verdad: interfaz, servicio, borde y las opciones.
    expect(firmas.length, "el extractor no encontro ninguna firma del agregado").toBeGreaterThan(3);

    const infractoras = firmas
      .filter(({ f }) => CANALES_PROHIBIDOS.test(f))
      .map(({ rel }) => rel);
    expect(
      infractoras,
      "una firma del modo agregado recibe el recorte por fuera de `ConsultaAnalitica`: " +
        "un servicio que se olvide del alcance debe fallar el BUILD, no los datos. " +
        infractoras.join(", "),
    ).toEqual([]);
  });

  it("el censo DISCRIMINA: caza un filtro colado en la firma y no marca la firma legitima", () => {
    const infractora = `
      consultarAgregado(
        consulta: ConsultaAnalitica,
        filtro: AnaliticaFiltroInput,
      ): Promise<AgregadoOperativo>;
    `;
    const firmasMalas = firmasDelAgregado(soloCodigo(infractora));
    expect(firmasMalas.length).toBeGreaterThan(0);
    expect(firmasMalas.some((f) => CANALES_PROHIBIDOS.test(f))).toBe(true);

    const legitima = `
      consultarAgregado(
        consulta: ConsultaAnalitica,
        opciones?: OpcionesAgregado,
      ): Promise<AgregadoOperativo>;
    `;
    expect(
      firmasDelAgregado(soloCodigo(legitima)).some((f) => CANALES_PROHIBIDOS.test(f)),
    ).toBe(false);
  });

  it("y la consulta se recibe SIEMPRE como `ConsultaAnalitica`, que no se puede fabricar", () => {
    for (const rel of [SERVICIO, INTERFAZ_SERVICIO]) {
      for (const f of firmasDelAgregado(leerCodigo(rel))) {
        if (f.includes("consulta")) expect(f, rel).toMatch(/ConsultaAnalitica/);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R16 — el agregado no declara metricas propias                               */
/* -------------------------------------------------------------------------- */

/** Los ids de metrica que el servicio nombra al elegir los componentes de la razon. */
function metricasNombradasEnComponentes(codigo: string): string[] {
  const desde = codigo.indexOf("function componentesDe");
  if (desde < 0) return [];
  const cuerpo = codigo.slice(desde, codigo.indexOf("\nfunction ", desde + 1));
  return [...cuerpo.matchAll(/case\s+"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

describe("R16 · el modo agregado no declara metricas propias", () => {
  it("el modo agregado no declara metricas propias: todas salen del catalogo", () => {
    const delCatalogo = new Set(listarMetricas().map((m) => m.id));
    const nombradas = metricasNombradasEnComponentes(leerCodigo(SERVICIO));

    // El extractor mira algo: las cinco metricas agregables del catalogo.
    expect(nombradas.length).toBeGreaterThanOrEqual(5);

    const inventadas = nombradas.filter((id) => !delCatalogo.has(id));
    expect(
      inventadas,
      "el servicio nombra ids de metrica que NO estan en `listarMetricas()`. El catalogo es " +
        "de la 127 y esta feature no lo amplia: " + inventadas.join(", "),
    ).toEqual([]);
  });

  it("y el agregado toma su `metricaId` de la consulta, no de una tabla propia", () => {
    expect(leerCodigo(SERVICIO)).toMatch(/metricaId:\s*metrica\.id/);
  });

  it("el censo DISCRIMINA: caza un id inventado en el mismo sitio", () => {
    const infractor = `
      function componentesDe(metricaId, m) {
        switch (metricaId) {
          case "tasa_entrega": return { numerador: m.entregas, denominador: 1 };
          case "tasa_inventada": return { numerador: 0, denominador: 0 };
        }
      }
      function otra() {}
    `;
    const delCatalogo = new Set(listarMetricas().map((m) => m.id));
    const nombradas = metricasNombradasEnComponentes(soloCodigo(infractor));
    expect(nombradas).toContain("tasa_inventada");
    expect(nombradas.filter((id) => !delCatalogo.has(id))).toEqual(["tasa_inventada"]);
  });

  it("y esta feature no escribe en `lib/analytics/metrics.ts`", () => {
    // R16 en su forma mas simple: el catalogo es de la 127 y sus divergencias las corrige la
    // 175. El agregado LEE el catalogo por `consulta.metrica`; no le anade nada.
    for (const rel of [SERVICIO, INTERFAZ_SERVICIO, ACCION, "lib/types/analitica-operativa.ts"]) {
      expect(leerCodigo(rel), `${rel} declara metricas`).not.toMatch(/CATALOGO\s*[:=]/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R17 — cero superficie nueva en el repositorio del rollup                    */
/* -------------------------------------------------------------------------- */

/** Los metodos declarados en el cuerpo de una interfaz TS. */
function metodosDeLaInterfaz(codigo: string, nombre: string): string[] {
  const m = codigo.match(new RegExp(`interface\\s+${nombre}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  if (!m) return [];
  return [...m[1].matchAll(/^\s+([a-zA-Z][A-Za-z0-9_]*)\s*\(/gm)].map((x) => x[1]);
}

describe("R17 · el agregado consume `agregarCubos` y no anade superficie", () => {
  it("el modo agregado consume agregarCubos y no anade metodos al repositorio del rollup", () => {
    const metodos = metodosDeLaInterfaz(leerCodigo(INTERFAZ_ROLLUP), "IAnaliticaOperativaRollupRepository");
    expect(
      metodos.sort(),
      "R26/D4 de la 126: DOS metodos, no catorce. Un metodo nuevo seria una SEGUNDA entrada a " +
        "`analytics_daily` (el guardia R42 de la 124 sostiene que hay un solo lector) y " +
        "perderia la cache de la 128 o exigiria una clave y un codec nuevos.",
    ).toEqual(["agregarCubos", "etiquetasDeEstatus"]);

    // Y el agregado consume ESE metodo: mismos cubos, misma clave de cache que la serie.
    expect(leerCodigo(SERVICIO)).toMatch(/this\.rollup\.agregarCubos\(consulta,\s*granos\)/);
  });

  it("el censo DISCRIMINA: contaria un tercer metodo", () => {
    const infractor = `
      interface IAnaliticaOperativaRollupRepository {
        agregarCubos(c: ConsultaAnalitica): Promise<readonly CuboRollup[]>;
        agregarPeriodo(c: ConsultaAnalitica): Promise<readonly CuboRollup[]>;
        etiquetasDeEstatus(ids: readonly string[]): Promise<Map<string, EtiquetaEstatus>>;
      }
    `;
    expect(
      metodosDeLaInterfaz(soloCodigo(infractor), "IAnaliticaOperativaRollupRepository"),
    ).toContain("agregarPeriodo");
  });

  it("y no se anade superficie de cache: el decorador no conoce el agregado", () => {
    const decorador = leerCodigo("lib/repositories/CachedAnaliticaOperativaRollupRepository.ts");
    expect(decorador).not.toMatch(/consultarAgregado|agregarPeriodo|CuboAgregado/);
  });
});

/* -------------------------------------------------------------------------- */
/* Ninguna ruta de `app/api` consume el agregado                               */
/* -------------------------------------------------------------------------- */

const EXT = new Set([".ts", ".tsx"]);

function archivos(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      salida.push(...archivos(rel));
    } else if (EXT.has(path.extname(e.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

const CONSUMO_DEL_AGREGADO = [/consultarAgregadoOperativo/, /consultarAgregado\b/, /AgregadoOperativo/];

describe("R1 de la 126, extendido · ninguna ruta de app/api consume el agregado", () => {
  it("ninguna ruta de app/api consume el modo agregado", () => {
    const infractores = archivos("app/api")
      .map((rel) => ({ rel, codigo: soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")) }))
      .filter(({ codigo }) => CONSUMO_DEL_AGREGADO.some((p) => p.test(codigo)))
      .map(({ rel }) => rel);
    expect(
      infractores,
      "la analitica operativa —tambien agregada— se sirve por Server Action. Una ruta de " +
        "`app/api` seria una segunda superficie con su propio gating y su propia forma de " +
        "olvidarse de auditar el denegado: " + infractores.join(", "),
    ).toEqual([]);
  });

  it("el censo mira rutas de verdad y DISCRIMINA", () => {
    expect(archivos("app/api").length).toBeGreaterThan(5);
    const handlerInfractor = `
      import { consultarAgregadoOperativo } from "@/lib/actions/analitica-operativa";
      export async function GET() { return Response.json({}); }
    `;
    expect(CONSUMO_DEL_AGREGADO.some((p) => p.test(soloCodigo(handlerInfractor)))).toBe(true);
    const soloProsa = `// quiza algun dia consultarAgregadoOperativo\nexport async function GET() {}`;
    expect(CONSUMO_DEL_AGREGADO.some((p) => p.test(soloCodigo(soloProsa)))).toBe(false);
  });

  it("la Server Action del agregado existe, es async y vive en el archivo de la 126", () => {
    const accion = fs.readFileSync(path.join(REPO_ROOT, ACCION), "utf8");
    expect(accion.startsWith('"use server"')).toBe(true);
    expect(accion).toMatch(/export async function consultarAgregadoOperativo/);
  });
});
