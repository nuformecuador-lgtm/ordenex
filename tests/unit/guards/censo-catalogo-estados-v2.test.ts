import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 154 (R28) — GUARD de censo de "DECLARADO Y SIN USO". Patron de
// `censo-order-status-rename.test.ts`, pero al reves: alla se censaban values RETIRADOS; aqui
// se censan values RECIEN DECLARADOS que TODAVIA NO deben usarse.
//
// La 154 declaro dos estados (`por_recolectar_en_tienda`, `incidente`) y dos familias de
// historial (`recoleccion_tienda`, `incidente`) que ningun modulo podia producir todavia.
// Mientras siguen sin productor solo pueden aparecer en:
//   - el catalogo (`lib/types/order-status.ts`),
//   - las familias (`lib/types/orden-historial.ts`),
//   - el mapa de transiciones (`lib/types/order-status-transiciones.ts`),
//   - la capa de presentacion del estatus (`EstatusBadge.tsx`),
//   - `db/` (migraciones), `tests/` y `specs/` — que NO se escanean.
//
// FEATURE 155 — DOS LITERALES SE GRADUAN Y SALEN DEL CENSO. El guard funciono como se diseño:
// mientras nadie los producia estuvieron confinados, y ahora salen POR SU FEATURE, no de
// contrabando.
//   - `por_recolectar_en_tienda`: es el estado en que NACE la rama (b) de la bifurcacion de
//     creacion. Lo produce `resolverDestinoCreacion` y lo consumen las tres vias, la politica
//     de eventos publicos y el contrato OpenAPI.
//   - `recoleccion_tienda`: es el flujo del manifiesto de esa rama (`MANIFIESTO_FLUJOS`), y
//     tambien la familia de historial de la arista #43, que producira la 157.
//
// FEATURE 158 (2026-07-30) — EL TERCER Y ULTIMO LITERAL SE GRADUA: `incidente`. La 158 es su
// productor por partida doble: el estado (`gestion_orden.resultado = incidente` ->
// `MisAsignacionesService.gestionar`) y la familia de historial
// (`GestionOrdenRepository.crearGestionYTransicionar` escribe `origen_tipo = incidente`, Q-G).
// Sale del censo POR SU FEATURE, igual que los dos de la 155.
//
// CONSECUENCIA DECLARADA, no disimulada: con esto el CENSO QUEDA VACIO y el caso «ningun
// archivo fuera de la allowlist los nombra» pierde su poder de discriminacion, porque ya no
// queda ningun literal que confinar. Eso NO es un agujero: el invariante que protegia
// («declarado y sin productor») dejo de existir cuando llego el productor, que era justamente
// el final previsto del guard. Lo que el archivo sigue protegiendo —y se refuerza abajo— es la
// GRADUACION: que cada literal siga existiendo en su SEED y que su productor real este donde
// se dice que esta. Si un dia se declarara otro value sin productor, la maquinaria
// (`LITERALES_154` + `ofensores()`) esta intacta y basta con volver a poblar la lista.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
// Deliberadamente SIN `tests`, `db` ni `specs`: R28 los admite como sitios legitimos.
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css", ".json"]);

// Frontera de palabra a proposito: `\bincidente\b` NO marca "coincidentes"/"coincidente", que
// aparecen en nombres de test y en textos de filtros de la UI.
// VACIO desde la 158: los tres literales que la 154 declaro sin productor ya graduaron. La
// maquinaria se conserva (ver la nota de arriba); lo que no queda es a quien censar.
const LITERALES_154: Array<{ label: string; re: RegExp }> = [];

/** Frontera de palabra que uso el censo mientras `incidente` estuvo confinado. */
const RE_INCIDENTE = /\bincidente\b/;

/** Los que la 155 GRADUO: siguen siendo values/familias reales, pero ya tienen productor. */
const GRADUADOS_155 = ["por_recolectar_en_tienda", "recoleccion_tienda"] as const;

/** El que la 158 GRADUO, con el modulo de negocio que lo produce (R6/R8, Q-G). */
const GRADUADO_158 = {
  literal: "incidente",
  productorEstado: "lib/services/MisAsignacionesService.ts",
  productorFamilia: "lib/repositories/GestionOrdenRepository.ts",
} as const;

// Archivos que SI pueden nombrarlos (por ruta relativa POSIX, no por basename: `incidente` es
// una palabra comun y un basename suelto seria una allowlist demasiado ancha).
const ALLOWLIST = new Set([
  "lib/types/order-status.ts", // catalogo
  "lib/types/orden-historial.ts", // familias de origen
  "lib/types/order-status-transiciones.ts", // mapa de transiciones
  "app/(app)/ordenes/_components/EstatusBadge.tsx", // presentacion del estatus
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function ofensores(): string[] {
  const out: string[] = [];
  for (const rel of SCAN_DIRS) {
    const base = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base)) {
      const relativo = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      if (ALLOWLIST.has(relativo)) continue;
      const contenido = fs.readFileSync(file, "utf8");
      const hits = LITERALES_154.filter((v) => v.re.test(contenido)).map((v) => v.label);
      if (hits.length > 0) out.push(`${relativo} -> ${hits.join(", ")}`);
    }
  }
  return out;
}

describe("154/R28 — censo de values/familias declarados SIN productor (CERRADO por la 158)", () => {
  it("ningun archivo de app/, lib/, components/, hooks/, scripts/ ni e2e/ fuera de la allowlist los nombra", () => {
    // Con `LITERALES_154` vacio esto es trivialmente cierto, y se dice sin disimulo en la
    // cabecera del archivo. Se conserva porque la maquinaria (`ofensores()`) es lo que hay que
    // reusar si una feature futura vuelve a declarar un value antes que su productor.
    expect(ofensores()).toEqual([]);
  });

  it("los cuatro archivos de la allowlist siguen declarando el value de la 154", () => {
    // Ya no se afirma sobre `LITERALES_154` (vacio): se afirma sobre el literal que estuvo
    // censado hasta la 158, para que este caso siga midiendo algo real.
    for (const relativo of ALLOWLIST) {
      const contenido = fs.readFileSync(path.join(REPO_ROOT, relativo), "utf8");
      expect(RE_INCIDENTE.test(contenido), `${relativo} ya no nombra incidente`).toBe(true);
    }
  });

  it("el censo de `incidente` era por igualdad EXACTA (no marcaba “coincidentes”)", () => {
    // La expresion se CONSERVA aunque el literal haya graduado: es la que habria que reusar si
    // un dia hubiera que volver a confinarlo, y es la que este archivo usa mas abajo para
    // verificar la graduacion.
    expect(RE_INCIDENTE.test("las coincidentes y excluye distrito nulo")).toBe(false);
    expect(RE_INCIDENTE.test("solo las coincidentes")).toBe(false);
    expect(RE_INCIDENTE.test('estatus = "incidente"')).toBe(true);
    expect(RE_INCIDENTE.test("origenTipo: incidente,")).toBe(true);
  });

  it("158: el censo queda VACIO — ya no queda ningun literal de la 154 sin productor", () => {
    expect(LITERALES_154).toEqual([]);
    // Sale del CENSO, no del sistema: el value y la familia siguen existiendo.
    expect(ORDER_STATUS_SEED).toContain(GRADUADO_158.literal);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(GRADUADO_158.literal);
  });

  it("158: `incidente` SI aparece ya en modulos de negocio (tiene productor real)", () => {
    // Contraparte del caso de la 155, y lo que convierte «el censo esta vacio» en una
    // afirmacion con contenido: no esta vacio porque nadie use el literal, sino porque su
    // productor llego y esta EN ESTOS DOS archivos.
    const conEstado = fs.readFileSync(
      path.join(REPO_ROOT, ...GRADUADO_158.productorEstado.split("/")),
      "utf8",
    );
    expect(conEstado).toMatch(RE_INCIDENTE);
    const conFamilia = fs.readFileSync(
      path.join(REPO_ROOT, ...GRADUADO_158.productorFamilia.split("/")),
      "utf8",
    );
    // Q-G: el append de la transicion escribe la familia `incidente`, no `gestion`.
    expect(conFamilia).toMatch(/origenTipo:[^\n]*"incidente"/);
  });

  it("155: los dos literales graduados siguen existiendo en el catalogo y en las familias", () => {
    // Salen del CENSO, no del sistema. Si alguien los borrara, el guard no lo veria (ya no los
    // busca), asi que se afirma aqui explicitamente.
    expect(ORDER_STATUS_SEED).toContain(GRADUADOS_155[0]);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(GRADUADOS_155[1]);
  });

  it("155: los dos graduados SI aparecen ya en modulos de negocio (tienen productor real)", () => {
    const conEstado = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "services", "destino-creacion.ts"),
      "utf8",
    );
    expect(conEstado).toMatch(/\bpor_recolectar_en_tienda\b/);
    const conFlujo = fs.readFileSync(path.join(REPO_ROOT, "lib", "types", "manifiesto.ts"), "utf8");
    expect(conFlujo).toMatch(/\brecoleccion_tienda\b/);
  });
});
