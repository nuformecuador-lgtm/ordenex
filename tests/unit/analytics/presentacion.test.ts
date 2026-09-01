import { describe, it, expect } from "vitest";
import { recorteDePresentacion, type Faceta } from "@/lib/analytics/presentacion";
import { resolverAlcance, type ActorAnalitica } from "@/lib/analytics/alcance";
import { listarMetricas } from "@/lib/analytics/metrics";
import { ROLES_ANALITICA } from "@/lib/analytics/types";

// Feature 133 / T1.2 — R18: las facetas ofrecidas se DERIVAN del alcance de la 122.
//
// Todo lo que se afirma aqui se afirma POR VALOR: la lista esperada de facetas se
// escribe a mano, rol por rol. Derivarla de `recorteDePresentacion` (la funcion que se
// juzga) convertiria el test en una tautologia que pasaria con cualquier
// implementacion, incluida la que devuelve siempre las tres.
//
// Los valores esperados y su porque (design §3 D5, R14/R15, Q4):
//   maestro / admin   -> alcance global; las TRES.
//   adminTienda       -> alcance tienda; pierde «Tienda» por alcance (R14) y
//                        «Mensajero» por R15 (ese catalogo le sirve nombre real + uuid,
//                        justo lo que la seudonimizacion de la 122 impide) -> ["zona"].
//   adminSatelite     -> alcance zona; pierde «Zona» por alcance, y «Tienda»/«Mensajero»
//                        porque sus catalogos le responden `forbidden`
//                        (`FiltrosOrdenesService.ts:28`, `UsuariosPorRolService.ts:15`)
//                        y R16 prohibe dibujar un control muerto -> [].
//   mensajero         -> alcance mensajero; mismo motivo -> [].

const ZONA_FIXTURE = "11111111-1111-4111-8111-111111111111";

function actor(rol: string, extra: Partial<ActorAnalitica> = {}): ActorAnalitica {
  return { usuarioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", rol, ...extra };
}

interface CasoRol {
  readonly rol: string;
  readonly actor: ActorAnalitica;
  readonly alcance: "global" | "zona" | "tienda" | "mensajero";
  readonly facetas: readonly Faceta[];
}

const CASOS: readonly CasoRol[] = [
  { rol: "maestro", actor: actor("maestro"), alcance: "global", facetas: ["zona", "tienda", "mensajero"] },
  { rol: "admin", actor: actor("admin"), alcance: "global", facetas: ["zona", "tienda", "mensajero"] },
  {
    rol: "adminSatelite",
    actor: actor("adminSatelite", { zonaId: ZONA_FIXTURE }),
    alcance: "zona",
    facetas: [],
  },
  { rol: "adminTienda", actor: actor("adminTienda"), alcance: "tienda", facetas: ["zona"] },
  { rol: "mensajero", actor: actor("mensajero"), alcance: "mensajero", facetas: [] },
];

describe("R18 · recorteDePresentacion deriva las facetas del alcance de la 122", () => {
  it("cubre los CINCO roles lectores de analitica y ninguno mas", () => {
    // Si manana entra un sexto lector, este caso cae y obliga a decidir que ve.
    expect(CASOS.map((c) => c.rol).sort()).toEqual([...ROLES_ANALITICA].sort());
  });

  for (const caso of CASOS) {
    it(`${caso.rol}: alcance "${caso.alcance}" y facetas [${caso.facetas.join(", ")}]`, () => {
      const recorte = recorteDePresentacion(caso.actor);

      expect(recorte.alcance).toBe(caso.alcance);
      expect([...recorte.facetas]).toEqual([...caso.facetas]);
    });

    it(`${caso.rol}: la faceta homonima de su alcance NUNCA se ofrece (R14)`, () => {
      const recorte = recorteDePresentacion(caso.actor);
      expect(recorte.facetas).not.toContain(caso.alcance);
    });
  }

  it("adminTienda no recibe la faceta «mensajero» (R15: ese catalogo trae nombre real + uuid)", () => {
    const recorte = recorteDePresentacion(actor("adminTienda"));
    expect(recorte.facetas).not.toContain("mensajero");
    expect([...recorte.facetas]).toEqual(["zona"]);
  });

  it("solo el alcance global recibe las tres facetas", () => {
    const conLasTres = CASOS.filter((c) => c.facetas.length === 3).map((c) => c.rol);
    expect(conLasTres.sort()).toEqual(["admin", "maestro"]);
  });
});

describe("R18 · lo denegado no ofrece ni una faceta (falla cerrado)", () => {
  it("sin actor: alcance denegado y cero facetas", () => {
    const recorte = recorteDePresentacion(null);
    expect(recorte.alcance).toBe("denegado");
    expect([...recorte.facetas]).toEqual([]);
  });

  it("apiKey: alcance denegado y cero facetas", () => {
    const recorte = recorteDePresentacion(actor("apiKey"));
    expect(recorte.alcance).toBe("denegado");
    expect([...recorte.facetas]).toEqual([]);
  });

  it("adminSatelite SIN zona asignada: denegado, no degrada a global (R13 de la 122)", () => {
    const recorte = recorteDePresentacion(actor("adminSatelite", { zonaId: null }));
    expect(recorte.alcance).toBe("denegado");
    expect(recorte.alcance).not.toBe("global");
    expect([...recorte.facetas]).toEqual([]);
  });

  it("un rol que no existe: denegado y cero facetas", () => {
    const recorte = recorteDePresentacion(actor("rolInventado"));
    expect(recorte.alcance).toBe("denegado");
    expect([...recorte.facetas]).toEqual([]);
  });
});

describe("R18 · el tipo de alcance no depende de QUE metrica operativa se elija", () => {
  const OPERATIVAS = listarMetricas({ dominio: "operativa" });

  it("el catalogo declara metricas operativas: el recorrido no pasa por vacio", () => {
    expect(OPERATIVAS.length).toBeGreaterThan(0);
  });

  for (const caso of CASOS) {
    it(`${caso.rol}: las ${OPERATIVAS.length} operativas resuelven el mismo tipo`, () => {
      const tipos = new Set(
        OPERATIVAS.map((m) => {
          const r = resolverAlcance(caso.actor, m.id);
          return r.estado === "ok" ? r.alcance.tipo : `denegado:${r.motivo}`;
        }),
      );

      expect([...tipos]).toEqual([caso.alcance]);
    });
  }
});

describe("R18 · el retorno son enums y arrays de strings: ni filas, ni ids, ni nombres", () => {
  it("las claves del recorte son exactamente alcance, facetas y productos, y sus valores son strings", () => {
    // FICHA 345: entra `productos`, y entra como ETIQUETA («visible»/«oculta») y no como
    // `boolean`. El motivo esta escrito en `presentacion.ts` y en el guardia de frontera: el
    // contrato de este retorno solo admite etiquetas, y esa exigencia es lo que mantiene fuera
    // cualquier campo de datos.
    for (const caso of [...CASOS.map((c) => c.actor), null]) {
      const recorte = recorteDePresentacion(caso);
      expect(Object.keys(recorte).sort()).toEqual(["alcance", "facetas", "productos"]);
      expect(typeof recorte.alcance).toBe("string");
      expect(Array.isArray(recorte.facetas)).toBe(true);
      expect(["visible", "oculta"]).toContain(recorte.productos);
      for (const f of recorte.facetas) {
        expect(["zona", "tienda", "mensajero"]).toContain(f);
      }
    }
  });

  it("ningun valor del recorte contiene el uuid del actor ni el de su zona", () => {
    const serializado = JSON.stringify(
      CASOS.map((c) => recorteDePresentacion(c.actor)),
    );
    expect(serializado).not.toContain("aaaaaaaa");
    expect(serializado).not.toContain(ZONA_FIXTURE);
  });
});

/* ==========================================================================
 * FICHA 345 (R5) — `productos`: qué actor VE la sección de productos
 * ========================================================================== */

describe("FICHA 345 · el recorte dice si la sección de productos se pinta", () => {
  /**
   * El esperado se escribe A MANO, rol por rol, y NO se deriva de `ALCANCE_PRODUCTOS`: un test
   * que sacara su expectativa de la misma constante que juzga sería una tautología —cambiar la
   * tabla cambiaría el esperado y el caso seguiría verde—. Es el mismo criterio con el que
   * `AnaliticaPage.test.tsx` escribe a mano sus tres listas de roles.
   */
  const ESPERADO: Readonly<Record<string, "visible" | "oculta">> = {
    maestro: "visible",
    admin: "visible",
    adminTienda: "visible",
    adminSatelite: "oculta",
    mensajero: "oculta",
  };

  it("los cinco roles lectores están decididos, ninguno por omisión", () => {
    expect(Object.keys(ESPERADO).sort()).toEqual([...ROLES_ANALITICA].sort());
  });

  for (const caso of CASOS) {
    it(`${caso.rol}: la sección de productos queda "${ESPERADO[caso.rol]}"`, () => {
      expect(recorteDePresentacion(caso.actor).productos).toBe(ESPERADO[caso.rol]);
    });
  }

  it("falla CERRADO: sin sesión, con un rol inventado o con un actor vacío, oculta", () => {
    expect(recorteDePresentacion(null).productos).toBe("oculta");
    expect(recorteDePresentacion(actor("supervisor_inventado")).productos).toBe("oculta");
    expect(recorteDePresentacion(actor("")).productos).toBe("oculta");
    // `apiKey` es un rol REAL del esquema que no es lector de analítica: tampoco entra.
    expect(recorteDePresentacion(actor("apiKey")).productos).toBe("oculta");
  });

  it("no es lo mismo que ver la analítica: hay un rol que entra y NO ve la sección", () => {
    // Sin esta aserción, `productos: "visible"` para todos pasaría los casos de arriba si
    // alguien borrara las dos filas `oculta` de la tabla de esperados.
    const visibles = CASOS.filter((c) => recorteDePresentacion(c.actor).productos === "visible");
    expect(visibles.length).toBeGreaterThan(0);
    expect(visibles.length).toBeLessThan(CASOS.length);
  });
});
