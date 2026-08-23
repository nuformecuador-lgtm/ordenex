import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";

// Feature 126 / T12.3 — R1. La analitica operativa entra por Server Action y por NINGUNA otra
// puerta.
//
// `docs/architecture.md`: las mutaciones y lecturas internas del mismo proyecto van por Server
// Action; los route handlers existen para lo que necesita CORS o API publica —webhooks e
// integraciones—. Una ruta bajo `app/api/` para analitica seria una segunda superficie con su
// propio gating, su propio parseo y su propia forma de olvidarse de auditar el denegado.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
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

function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

/** Las formas de consultar analitica operativa desde donde no toca. */
const CONSULTA_OPERATIVA = [
  /AnaliticaOperativaService/,
  /AnaliticaOperativaRollupRepository/,
  /AnaliticaOperativaVivaRepository/,
  /consultarAnaliticaOperativa/,
];

/**
 * El censo, aislado para que el caso REAL (sobre el arbol) y las AUTOCOMPROBACIONES SINTETICAS
 * (sobre archivos inventados que nunca se escriben en disco) recorran EXACTAMENTE el mismo
 * codigo. Sin esto, el caso negativo probaria los regex sueltos y no el guardia.
 */
function infractoresDeConsulta(
  entradas: readonly { readonly rel: string; readonly fuente: string }[],
): string[] {
  return entradas
    .filter(({ fuente }) => CONSULTA_OPERATIVA.some((p) => p.test(soloCodigo(fuente))))
    .map(({ rel }) => rel);
}

/** Los archivos reales de `app/api`, leidos del disco. */
function entradasDeAppApi(): { rel: string; fuente: string }[] {
  return archivos("app/api").map((rel) => ({
    rel,
    fuente: fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"),
  }));
}

describe("R1 · ninguna ruta de app/api consulta analitica operativa", () => {
  it("ninguna ruta de app/api consulta analitica operativa", () => {
    // 2026-08-23 · FEATURE 267 — ESTA PROHIBICION NO SE TOCA, y es deliberado que no se toque.
    // La 267 publica `GET /api/ordenes/api-key/analitica`, asi que se estrecho el guardia
    // HERMANO (`tablero-operativo-frontera.guardia.test.ts`, el que prohibia que un archivo de
    // `app/api` se LLAMARA analitica) a una allowlist nominal de un camino. Este de aqui sigue
    // valiendo para TODOS los archivos de `app/api`, INCLUIDO el handler nuevo: ese handler
    // delega en `lib/api/analitica-integrador.ts` y no nombra ni el servicio ni el repositorio,
    // asi que este caso sigue verde DE VERDAD y no por una excepcion. Si alguien "simplifica"
    // el handler cableando el servicio en el route, esto se pone rojo, y debe.
    const infractores = infractoresDeConsulta(entradasDeAppApi());
    expect(
      infractores,
      "la analitica operativa se sirve por Server Action (`lib/actions/analitica-operativa.ts`). " +
        "Una ruta de `app/api` seria una segunda superficie con su propio gating y su propia " +
        "forma de olvidarse de auditar el denegado. Archivos: " +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("el censo mira rutas de verdad (si no, seria verde por vacio)", () => {
    // `app/api` existe y tiene handlers: el guardia esta mirando algo.
    expect(archivos("app/api").length).toBeGreaterThan(5);
  });

  it("el censo DISCRIMINA: detectaria un handler que importara el servicio", () => {
    const handlerInfractor = `
      import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
      export async function GET() { return Response.json({}); }
    `;
    expect(CONSULTA_OPERATIVA.some((p) => p.test(soloCodigo(handlerInfractor)))).toBe(true);
    // Y no marca un handler que solo lo MENCIONA en prosa.
    const soloProsa = `// pendiente: quiza el AnaliticaOperativaService\nexport async function GET() {}`;
    expect(CONSULTA_OPERATIVA.some((p) => p.test(soloCodigo(soloProsa)))).toBe(false);
  });

  it("267/R42 · ni siquiera el handler AUTORIZADO por el guardia hermano podria importar el servicio", () => {
    // AUTOCOMPROBACION SINTETICA. Nada se escribe en el arbol: se pasa por el MISMO censo del
    // caso real una version inventada del handler de la 267 —el unico camino de `app/api` con
    // `analitica` en su nombre— que SI cablea el servicio y el repositorio.
    //
    // Es el caso que distingue «estrechar» de «relajar»: la 267 obtuvo permiso para que exista
    // un route handler LLAMADO analitica, no para que un route handler consulte la analitica
    // por su cuenta. Si esto se pusiera verde, la excepcion nominal del guardia hermano se
    // habria convertido en una puerta.
    const versionInfractora = [
      { rel: "app/api/ordenes/api-key/analitica/route.ts", fuente: `
        import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
        export async function GET() { return Response.json({}); }
      ` },
      { rel: "app/api/reportes/analitica/route.ts", fuente: `
        import { AnaliticaOperativaRollupRepository } from "@/lib/repositories/AnaliticaOperativaRollupRepository";
        export async function GET() { return Response.json({}); }
      ` },
      { rel: "app/api/interno/kpis/route.ts", fuente: `
        import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
        export async function GET() { return Response.json({}); }
      ` },
    ];
    expect(infractoresDeConsulta(versionInfractora)).toEqual(versionInfractora.map((v) => v.rel));

    // Y el handler REAL de la 267, leido del disco, no cae: delega en el borde de `lib/api/`.
    const real = "app/api/ordenes/api-key/analitica/route.ts";
    expect(fs.existsSync(path.join(REPO_ROOT, real))).toBe(true);
    expect(
      infractoresDeConsulta([
        { rel: real, fuente: fs.readFileSync(path.join(REPO_ROOT, real), "utf8") },
      ]),
    ).toEqual([]);
  });

  it("la Server Action existe y declara `use server`", () => {
    const accion = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "actions", "analitica-operativa.ts"),
      "utf8",
    );
    expect(accion.startsWith('"use server"')).toBe(true);
  });
});

describe("R3 · el nombre generico `lib/actions/analitica.ts` esta prohibido", () => {
  it("no existe `lib/actions/analitica.ts`: es de las dos features y por tanto de ninguna", () => {
    // La regla 1 del arnes permite dos features backend a la vez SOLO si no hay conflicto de
    // archivos. La 126 y la 127 escribirian las dos en ese nombre.
    expect(fs.existsSync(path.join(REPO_ROOT, "lib", "actions", "analitica.ts"))).toBe(false);
  });

  it("y la accion de la 126 vive en su nombre propio", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, "lib", "actions", "analitica-operativa.ts")),
    ).toBe(true);
  });
});

/* ============================================================================================ */
/* 2026-08-23 · FEATURE 267 (R42) — UN BORDE POR CANAL, Y NI UNO MAS                             */
/* ============================================================================================ */
//
// Este bloque es ADITIVO: no relaja nada de lo de arriba. Se anade junto al estrechamiento del
// guardia hermano para que la propiedad que de verdad importa quede escrita como aserto y no
// como confianza.
//
// La 122 dejo UN punto de entrada a la analitica (`prepararConsultaAnalitica`), y la razon es
// que ahi dentro se resuelve el actor, se interseca el filtro con el alcance y se decide la
// politica de identidad, en ese orden. Un segundo borde que repitiera esos pasos a mano es
// exactamente la forma en que se pierde uno: el que se olvida de auditar el denegado.
//
// Hasta la 267 el punto de entrada tenia dos llamadores, los dos del canal de SESION. Ahora hay
// un tercero, el del canal por API key. Lo que este bloque congela es que sean ESOS y que
// exactamente UNO —el del canal publico— pase `"api_key"`: si manana aparece un cuarto, o si un
// llamador de sesion empieza a pasar `"api_key"`, esto se pone rojo. Es el aserto que impide que
// abrir el canal por API key acabe abriendo tambien el de cookie.

/** Los bordes de analitica del arbol, con el canal por el que entran. */
const BORDES_POR_CANAL = {
  /** Canal de SESION (cookie). Llama con la aridad de siempre: `canal` toma su default. */
  sesion: ["lib/actions/analitica-operativa.ts", "lib/actions/analitica-financiera.ts"],
  /** Canal PUBLICO por API key (267). El unico que pasa el quinto argumento explicito. */
  apiKey: ["lib/api/analitica-integrador.ts"],
} as const;

/** Recorre `lib/**` y devuelve los archivos cuyo CODIGO (sin comentarios) invoca el punto de entrada. */
function llamadoresDelPuntoDeEntrada(): string[] {
  return archivos("lib")
    .filter((rel) => rel !== "lib/analytics/consulta.ts") // el propio punto de entrada
    .filter((rel) => /\bprepararConsultaAnalitica\s*\(/.test(codigoDe(rel)))
    .sort();
}

function codigoDe(rel: string): string {
  return soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

describe("267/R42 · existe exactamente UN borde de analitica por canal", () => {
  it("los llamadores del punto de entrada son los declarados, y ninguno mas", () => {
    const esperados = [...BORDES_POR_CANAL.sesion, ...BORDES_POR_CANAL.apiKey].sort();
    expect(llamadoresDelPuntoDeEntrada()).toEqual(esperados);
  });

  it("solo el borde del canal publico pasa `\"api_key\"`; los de sesion usan el default", () => {
    for (const rel of BORDES_POR_CANAL.apiKey) {
      expect(codigoDe(rel)).toMatch(/["']api_key["']/);
    }
    for (const rel of BORDES_POR_CANAL.sesion) {
      // Si un borde de sesion pasara `"api_key"`, un actor con cookie entraria por la puerta
      // del integrador: exactamente lo que 267/R6 prohibe.
      expect(codigoDe(rel)).not.toMatch(/["']api_key["']/);
    }
  });

  it("y los dos bordes AUDITAN el denegado por el mismo camino", () => {
    // `describirDenegado` + una llamada explicita al logger. La trampa esta documentada en
    // `lib/analytics/auditoria.ts` y en `design.md §4.4` de la 267: `normalizeError` solo llama
    // al logger en la rama del error DESCONOCIDO, asi que lanzar `ForbiddenError` y confiar en
    // `withErrorHandler` produce un 403 MUDO. Un borde sin estas dos piezas no audita nada.
    for (const rel of ["lib/actions/analitica-operativa.ts", ...BORDES_POR_CANAL.apiKey]) {
      const codigo = codigoDe(rel);
      expect(codigo, `${rel} no describe el denegado`).toMatch(/\bdescribirDenegado\b/);
      expect(codigo, `${rel} no llama al logger`).toMatch(/\blogError\b/);
    }
  });

  it("el censo mira `lib/**` de verdad (si no, seria verde por vacio)", () => {
    expect(archivos("lib").length).toBeGreaterThan(100);
    expect(llamadoresDelPuntoDeEntrada().length).toBeGreaterThan(0);
  });
});
