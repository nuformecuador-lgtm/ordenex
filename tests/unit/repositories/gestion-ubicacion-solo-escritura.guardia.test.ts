import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Feature 193 (T C.5, R7) — GUARDIA: la ubicacion de la gestion nace de SOLO ESCRITURA.
//
// Decision humana del 2026-08-10: en este ciclo el dato se guarda y NO se expone al cliente.
// Sin una guardia, «solo escritura» es una intencion escrita en un comentario que la primera
// pantalla que necesite «ver donde estuvo el mensajero» se salta sin que nada falle.
//
// Y no es una preferencia de estilo: son coordenadas de una persona. La postura del repo para
// geolocalizacion propia (ruta_optimizada, geocode_cache) es RLS habilitada sin policies, solo
// service role. Que una consulta las PROYECTE es el primer paso para que acaben en un DTO, de
// ahi en una respuesta y de ahi en el navegador — y ese camino no se recorre por accidente,
// se decide.
//
// Mismo idioma que `contadores-cabecera.guardia.test.ts`: registro explicito contrastado
// contra el arbol en los DOS sentidos (ni menciones sin registrar, ni registros que sobren).

const RAIZ = path.resolve(__dirname, "../../..");

/** Los tres nombres de la feature, en camelCase (Prisma) y snake_case (SQL). */
const NOMBRES = [
  "ubicacionLat",
  "ubicacionLng",
  "ubicacionAusencia",
  "ubicacion_lat",
  "ubicacion_lng",
  "ubicacion_ausencia",
];

/**
 * Donde SI puede aparecer, con el motivo. Cualquier archivo fuera de esta lista que nombre
 * una de las columnas es un hallazgo: o es una lectura (y hay que decidirla, no colarla), o
 * es un sitio nuevo de escritura que merece revisarse.
 */
const PERMITIDOS: Record<string, string> = {
  "db/schema.prisma": "declaracion del modelo",
  "lib/interfaces/repositories/IGestionOrdenRepository.ts":
    "contrato de ESCRITURA (GestionOrdenData)",
  "lib/repositories/GestionOrdenRepository.ts": "el INSERT",
  "lib/services/MisAsignacionesService.ts": "arma el payload de escritura",
  "lib/interfaces/services/IMisAsignacionesService.ts": "contrato de entrada",
  "lib/actions/mis-asignaciones.ts": "lee el FormData del borde",
  "lib/types/gestion-orden.ts": "schema zod del borde",
  // `lib/utils/capturar-ubicacion.ts` NO figura, y no es un olvido: el helper del navegador
  // habla de `lat`/`lng` a secas y no nombra ninguna columna. La primera version de este
  // registro lo incluia y el propio test lo detecto como entrada muerta.
  "app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx":
    "el formulario que las envia",
};

/** Arboles que se recorren. `tests/` queda fuera: un test PUEDE nombrarlas. */
const ARBOLES = ["lib", "app", "components"];

function* archivos(dir: string): Generator<string> {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      yield* archivos(completo);
    } else if (/\.(ts|tsx|prisma)$/.test(e.name)) {
      yield completo;
    }
  }
}

function relativo(absoluto: string): string {
  return path.relative(RAIZ, absoluto).split(path.sep).join("/");
}

const mencionan = new Set<string>();
for (const arbol of [...ARBOLES, "db"]) {
  for (const archivo of archivos(path.join(RAIZ, arbol))) {
    const contenido = readFileSync(archivo, "utf8");
    if (NOMBRES.some((n) => contenido.includes(n))) mencionan.add(relativo(archivo));
  }
}

describe("Feature 193 (R7) — la ubicacion de la gestion es de SOLO ESCRITURA", () => {
  it("ningun archivo fuera del registro nombra las columnas", () => {
    const intrusos = [...mencionan].filter((r) => !(r in PERMITIDOS)).sort();
    expect(
      intrusos,
      `Estos archivos nombran la ubicacion de la gestion y no estan en el registro.\n` +
        `Si es una LECTURA nueva: R7 dice que en este ciclo el dato no se expone —abrilo como\n` +
        `decision, no como cambio de paso—. Si es una escritura legitima, anadilo arriba con su motivo.`,
    ).toEqual([]);
  });

  it("el registro no tiene entradas muertas", () => {
    // Un registro que sobrevive al archivo que describia deja de proteger nada y empieza a
    // mentir sobre el estado del arbol.
    const muertas = Object.keys(PERMITIDOS)
      .filter((r) => !mencionan.has(r))
      .sort();
    expect(muertas).toEqual([]);
  });

  it("ningun repositorio de LECTURA las proyecta en un select", () => {
    // La escritura vive en `GestionOrdenRepository.crearGestionYTransicionar`. Cualquier
    // `select` que las nombre en OTRO repositorio seria una lectura.
    const repos = [...archivos(path.join(RAIZ, "lib", "repositories"))]
      .map(relativo)
      .filter((r) => r !== "lib/repositories/GestionOrdenRepository.ts");

    const conLectura = repos.filter((r) => {
      const contenido = readFileSync(path.join(RAIZ, r), "utf8");
      return NOMBRES.some((n) => contenido.includes(n));
    });

    expect(conLectura).toEqual([]);
  });
});
