import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 229 — GUARDIA DE INVARIANTES DE RUTA Y DE ESQUEMA (T4.4, cubre R3 y R34).
//
// Las tres afirmaciones del requisito estan escritas de forma DURABLE a proposito:
//
//   · las tres listas del middleware -> se comparan contra LITERALES escritos aqui, asi que
//     cualquier alteracion (una entrada de mas, una de menos, un renombrado) pone la guardia
//     roja, hoy y dentro de veinte features;
//   · «la feature no crea ruta» -> se comprueba que NINGUN `page.tsx` / `route.ts` de `app/**`
//     importa los modulos de la feature. Eso es lo que el requisito quiere decir —que la unica
//     superficie sea un modal servido desde `/`— y se puede seguir midiendo para siempre;
//   · «sin migracion ni cambio de esquema» -> se comprueba que ninguna carpeta de
//     `db/migrations/` corresponde a esta feature POR NOMBRE, y que el esquema no gana ningun
//     objeto de rastreo. La reconciliacion `schema.prisma` <-> migraciones tiene ya su guardia
//     propia en `tests/integration/db/schema-drift-saneamiento.test.ts`; aqui no se duplica.
//
// ⛔ LO QUE ESTA GUARDIA NO HACE, Y ES DELIBERADO: no mira `git diff` contra `origin/dev`.
// Una guardia que mide el diff de una rama CADUCA en cuanto la rama se mergea: a partir de ahi
// juzga el trabajo de cualquier rama posterior y se convierte en un rojo ajeno que nadie sabe de
// quien es. Es una leccion ya pagada en este repo. Ninguna asercion de este archivo depende de
// la rama en la que se ejecute.

const RAIZ = path.resolve(__dirname, "../../..");

/* -------------------------------------------------------------------------- */
/* R3 — las tres listas del middleware, contra literales                        */
/* -------------------------------------------------------------------------- */

const MIDDLEWARE_CRUDO = readFileSync(path.join(RAIZ, "middleware.ts"), "utf8");
const MIDDLEWARE = quitarComentarios(MIDDLEWARE_CRUDO);

/**
 * Las entradas de un `const NOMBRE = [ ... ];` del middleware. Se lee del codigo SIN
 * comentarios: los de `PUBLIC_ROUTES` citan rutas dentro de la propia lista y un barrido crudo
 * las contaria como entradas.
 */
function listaDelMiddleware(nombre: string): string[] {
  const bloque = MIDDLEWARE.match(new RegExp(`const\\s+${nombre}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (bloque === null) throw new Error(`el middleware ya no declara ${nombre}`);
  return [...bloque[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

/** El contenido FIRMADO de cada lista. Cualquier alteracion pone esta guardia roja. */
const LISTAS_ESPERADAS: Record<string, string[]> = {
  // Paginas publicas fuera de `(app)`: login, recuperacion (20), postulacion (21), la
  // documentacion publica de la API (106) y el cotizador de cobertura (248). `/` NO esta aqui,
  // y es la clave de la feature 229: se resuelve por coincidencia EXACTA mas abajo, porque el
  // `startsWith` de esta lista volveria publica la app entera.
  //
  // ⚠ RE-FIRMA DELIBERADA, NO "hacer pasar el test" (feature 248, R38/T6.1). Esta lista ES el
  // contrato: mientras nadie la toque, la guardia caza cualquier ruta publica nueva. La 248
  // añade `/cotizador` a PROPOSITO —pagina publica sin sesion, firma 3 del gate humano del
  // 2026-08-20— y por eso la firma se amplia EN EL MISMO PR, en la posicion real que la entrada
  // ocupa en `middleware.ts` (la comparacion es posicional). Cualquier OTRA alteracion sigue
  // poniendo esta guardia roja, hoy y dentro de veinte features.
  PUBLIC_ROUTES: [
    "/login",
    "/api/health",
    "/recuperar-contrasena",
    "/postulacion",
    "/api-docs",
    "/api/docs",
    "/cotizador", // feature 248 (D3/R1/R38)
  ],
  // Endpoints con autenticacion propia (Bearer o firma HMAC), validada en el handler.
  SELF_AUTH_ROUTES: ["/api/cron", "/api/ordenes/api-key", "/api/webhooks"],
  // Feature 79: `/paquete` es PRIVADA y su rechazo va a `/`, no a `/login`. La 229 no la toca.
  REDIRECT_TO_ROOT: ["/paquete"],
};

describe("R3 — las tres listas del middleware conservan su contenido y no hay página nueva", () => {
  it("CONTROL DE NO-VACUIDAD: `middleware.ts` existe, tiene contenido y declara las tres listas", () => {
    expect(MIDDLEWARE_CRUDO.length).toBeGreaterThan(1000);
    for (const nombre of Object.keys(LISTAS_ESPERADAS)) {
      expect(MIDDLEWARE, `el middleware ya no declara ${nombre}`).toContain(`const ${nombre}`);
    }
  });

  for (const [nombre, esperada] of Object.entries(LISTAS_ESPERADAS)) {
    it(`\`${nombre}\` es EXACTAMENTE la lista firmada`, () => {
      // Comparacion posicional y completa: ni una entrada de mas (la 229 no se cuela como ruta
      // publica) ni una de menos (nadie retira `/paquete` de la lista de la feature 79).
      expect(listaDelMiddleware(nombre)).toEqual(esperada);
    });
  }

  it("`/` sigue resolviendose por coincidencia EXACTA, con sesion a `/dashboard` y sin ella a la landing", () => {
    // Es el mecanismo entero de la feature: la Server Action publica se postea a `/` y pasa el
    // guard sin cookie por ESTA rama. Si alguien la moviera a `PUBLIC_ROUTES` —o la borrara—
    // la feature dejaria de funcionar o abriria la app entera, y las listas de arriba podrian
    // seguir intactas.
    expect(MIDDLEWARE).toMatch(/if\s*\(\s*pathname\s*===\s*"\/"\s*\)/);
    expect(MIDDLEWARE).toContain('new URL("/dashboard", request.url)');
  });

  it("CONTRAPRUEBA: la comparacion caza una entrada añadida a cualquiera de las tres listas", () => {
    // Se fabrica la alteracion en memoria: si la 229 hubiera metido `/rastreo` en la lista
    // publica, esto es lo que habria pasado.
    const mutado = MIDDLEWARE.replace('"/login",', '"/login",\n  "/rastreo",');
    const entradas = [
      ...(mutado.match(/const\s+PUBLIC_ROUTES\s*=\s*\[([\s\S]*?)\]/) ?? ["", ""])[1].matchAll(
        /"([^"]*)"/g,
      ),
    ].map((m) => m[1]);

    expect(entradas).not.toEqual(LISTAS_ESPERADAS.PUBLIC_ROUTES);
    expect(entradas).toContain("/rastreo");
  });
});

/* -------------------------------------------------------------------------- */
/* R3 — la feature no crea ruta: nadie la monta desde `app/**`                  */
/* -------------------------------------------------------------------------- */

/** Los modulos de la feature, por las dos formas de nombrarlos en un import. */
const MODULOS_DE_LA_FEATURE = ["rastreo-publico", "RastreoPublico"];

/** Todos los archivos `.ts`/`.tsx` bajo una carpeta del repo, recursivamente. */
function fuentesDe(carpeta: string): string[] {
  const abs = path.join(RAIZ, carpeta);
  const salida: string[] = [];
  for (const entrada of readdirSync(abs)) {
    const rel = `${carpeta}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...fuentesDe(rel));
    else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) salida.push(rel);
  }
  return salida;
}

const FUENTES_DE_APP = fuentesDe("app");

/** Los puntos de entrada de ruta del App Router: una pagina o un handler HTTP. */
const RUTAS_DE_APP = FUENTES_DE_APP.filter(
  (ruta) => ruta.endsWith("/page.tsx") || ruta.endsWith("/route.ts"),
);

describe("R3 — ninguna RUTA del App Router monta la feature: la superficie es un modal", () => {
  it("CONTROL DE NO-VACUIDAD: el censo encuentra las rutas que se sabe que existen", () => {
    expect(RUTAS_DE_APP.length).toBeGreaterThan(20);
    expect(RUTAS_DE_APP).toContain("app/page.tsx");
    expect(RUTAS_DE_APP).toContain("app/api/docs/openapi/route.ts");
  });

  it("ningun `page.tsx` ni `route.ts` importa los modulos de la feature", () => {
    // Asi es como se mide «sin ruta nueva» de forma DURABLE: no por el diff de una rama, sino
    // por la propiedad que el requisito persigue. Una pagina o un handler que consumiera el
    // rastreo publico —hoy o dentro de tres features— apareceria aqui por su nombre.
    const montadores = RUTAS_DE_APP.filter((ruta) => {
      const fuente = codigoSinComentarios(ruta);
      return MODULOS_DE_LA_FEATURE.some((modulo) => fuente.includes(modulo));
    });
    expect(montadores, "la feature 229 gano una ruta propia").toEqual([]);
  });

  it("no existe ningún SEGMENTO de ruta `rastreo` bajo `app/`", () => {
    // Se miran los SEGMENTOS DE CARPETA, no la ruta entera: en el App Router una ruta nueva es
    // una carpeta (`app/rastreo/page.tsx`), y un componente que se llame `RastreoDialog.tsx`
    // —el modal, que vive en `app/_landing/` y NO es una ruta— no lo es. Confundirlos pondria
    // esta guardia roja contra la implementacion correcta.
    const conSegmentoRastreo = FUENTES_DE_APP.filter((ruta) =>
      ruta
        .split("/")
        .slice(0, -1)
        .some((segmento) => /^\(?rastreo/i.test(segmento)),
    );
    expect(conSegmentoRastreo).toEqual([]);
  });

  it("CONTRAPRUEBA: el censo caza una pagina que montara el rastreo", () => {
    const inventada = 'import { consultarRastreoPublico } from "@/lib/actions/rastreo-publico";';
    expect(MODULOS_DE_LA_FEATURE.some((modulo) => inventada.includes(modulo))).toBe(true);

    const real = codigoSinComentarios("app/page.tsx");
    expect(MODULOS_DE_LA_FEATURE.some((modulo) => real.includes(modulo))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R34 — sin migracion y sin cambio de esquema                                  */
/* -------------------------------------------------------------------------- */

const MIGRACIONES = readdirSync(path.join(RAIZ, "db", "migrations"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const SCHEMA = readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");

describe("R34 — la feature no añade migraciones ni modifica el esquema", () => {
  it("CONTROL DE NO-VACUIDAD: el censo de migraciones no esta vacio", () => {
    expect(MIGRACIONES.length).toBeGreaterThan(100);
  });

  it("ninguna carpeta de `db/migrations/` corresponde a esta feature", () => {
    // Por NOMBRE y por concepto: cualquier intento de darle almacenamiento propio al rastreo
    // publico (token de consulta, tabla de intentos, columna de seguimiento) tendria que
    // llamarse de alguna de estas maneras.
    const conceptos = ["rastreo", "seguimiento", "tracking", "hito_publico", "rastreo_intento"];
    const sospechosas = MIGRACIONES.filter((dir) =>
      conceptos.some((concepto) => dir.toLowerCase().includes(concepto)),
    );
    expect(sospechosas, "la feature 229 añadio una migracion").toEqual([]);
  });

  it("`db/schema.prisma` no gana ningun objeto del rastreo publico", () => {
    // La feature PROYECTA un dato que ya existe (`orden_historial_estado`, feature 49): cero
    // tablas, cero columnas, cero enums. La reconciliacion esquema<->migraciones la vigila
    // `tests/integration/db/schema-drift-saneamiento.test.ts`; esto vigila el ALCANCE.
    const minuscula = SCHEMA.toLowerCase();
    for (const concepto of ["rastreo", "hitopublico", "hito_publico", "seguimiento_publico"]) {
      expect(minuscula, `el esquema nombra ${concepto}`).not.toContain(concepto);
    }
  });

  it("MEDIDO: lo que la feature LEE ya existia, y por eso no necesita migracion", () => {
    // La otra mitad de R34, en positivo: si el dato o el indice no estuvieran, «sin migracion»
    // seria mentira. `num_guia @unique` identifica; `@@index([ordenId, createdAt])` sostiene la
    // linea de tiempo en una sola consulta (R21).
    expect(SCHEMA).toMatch(/numGuia\s+Int\?[^\n]*@unique/);
    expect(SCHEMA).toMatch(/telefonoDest\s+String/);
    expect(SCHEMA).toContain("@@index([ordenId, createdAt])");
  });
});
