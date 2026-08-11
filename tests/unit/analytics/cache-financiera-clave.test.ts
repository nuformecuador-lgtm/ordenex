import { describe, it, expect } from "vitest";
import { claveDeConsulta } from "@/lib/analytics/cache-clave";
import { claveFinanciera } from "@/lib/analytics/cache-clave-financiera";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import { consultaDe, MAESTRO, SATELITE } from "./_fake-operativa";

// Feature 179 / T1.2 — R5: LA CLAVE.
//
// La consulta NO se forja: se construye por el camino real (`prepararConsultaAnalitica`), como
// en la 128. Asi cada caso ejercita tambien el recorte de la 122 en vez de darlo por hecho.
//
// ⚠ HALLAZGO DEL ARBOL, DECLARADO EN VEZ DE DISIMULADO. La mutacion que R5 describe —«un
// `adminSatelite` de la zona Z recibe la entrada que se cacheo para un `admin` global»— NO es
// alcanzable hoy con una metrica financiera: las diez declaran `ALCANCE_FINANCIERA`
// (`lib/analytics/metrics.ts:65-71`), que es `total` para `maestro` y `admin` y **`prohibido`
// para `adminSatelite`, `adminTienda` y `mensajero`**. Los dos unicos roles que llegan resuelven
// los dos a `{ tipo: "global" }`, asi que un caso escrito solo con metricas financieras seria
// verde POR VACIO y no mataria la mutacion.
//
// Lo que se prueba entonces es la propiedad de la FUNCION, que es de quien es: `claveFinanciera`
// recibe una `ConsultaAnalitica` cualquiera, y se ejercita con las metricas cuyo alcance SI
// varia. R5 sigue siendo defensa en profundidad —el dia que el catalogo conceda una financiera
// `acotado`, la clave ya distingue—, y esa es exactamente la razon por la que la 126 dejo
// escrito que «apoyarse en esa coincidencia es apoyarse en una feature ajena para sostener la
// frontera multi-tenant».

const SIN_GRANO: readonly DimensionAnalitica[] = [];

/** El otro rol con acceso total al dinero. Su alcance resuelto es el mismo `global`. */
const ADMIN: ActorAnalitica = { usuarioId: "u-admin", rol: "admin" };

describe("R5 · el ALCANCE entra en la clave (seguridad, no rendimiento)", () => {
  it("dos actores con alcance distinto y filtro identico no comparten entrada", () => {
    // El `adminSatelite` de z1: la 122 le RECORTA el filtro a `zona_id: ["z1"]`.
    const deSatelite = consultaDe("entregas", SATELITE, { rango: "dia" });
    // El actor global que pide EXPLICITAMENTE esa zona: su filtro queda identico.
    const deMaestro = consultaDe("entregas", MAESTRO, { rango: "dia", zona_id: ["z1"] });

    // La premisa, comprobada y no supuesta: los filtros coinciden campo a campo y los alcances no.
    expect(deSatelite.filtro).toEqual(deMaestro.filtro);
    expect(deSatelite.alcance).not.toEqual(deMaestro.alcance);

    expect(claveFinanciera(deSatelite)).not.toBe(claveFinanciera(deMaestro));
  });

  it("y el id del alcance tambien: dos zonas distintas no comparten entrada", () => {
    const z1: ActorAnalitica = { usuarioId: "u-s1", rol: "adminSatelite", zonaId: "z1" };
    const z2: ActorAnalitica = { usuarioId: "u-s2", rol: "adminSatelite", zonaId: "z2" };
    expect(claveFinanciera(consultaDe("entregas", z1))).not.toBe(
      claveFinanciera(consultaDe("entregas", z2)),
    );
  });

  it("dos actores que resuelven al MISMO alcance si comparten entrada (no se cachea por usuario)", () => {
    // `maestro` y `admin` son los dos `total` en las financieras: la entrada es la misma y debe
    // serlo. Cachear por `usuarioId` multiplicaria las entradas por el numero de maestros sin
    // separar nada, porque el dato servido es identico.
    expect(claveFinanciera(consultaDe("egresos", MAESTRO))).toBe(
      claveFinanciera(consultaDe("egresos", ADMIN)),
    );
  });
});

describe("R5 · el rango RESUELTO, nunca el preset", () => {
  it("el mismo preset en dos dias distintos no comparte entrada", () => {
    const hoy = consultaDe("egresos", MAESTRO, { rango: "dia" }, new Date("2026-08-03T15:00:00.000Z"));
    const ayer = consultaDe("egresos", MAESTRO, { rango: "dia" }, new Date("2026-08-02T15:00:00.000Z"));

    // Los dos son `rango: "dia"`. Si el preset entrara en la clave serian la MISMA entrada, y la
    // consulta de hoy devolveria el dinero de ayer.
    expect(hoy.rango.preset).toBe(ayer.rango.preset);
    expect(claveFinanciera(hoy)).not.toBe(claveFinanciera(ayer));
  });

  it("dos presets que resuelven al mismo rango SI comparten entrada", () => {
    const preset = consultaDe("egresos", MAESTRO, { rango: "dia" });
    const explicito = consultaDe("egresos", MAESTRO, {
      rango: "personalizado",
      desde: preset.rango.desdeFecha,
      hasta: preset.rango.hastaFecha,
    });
    expect(explicito.rango.preset).not.toBe(preset.rango.preset);
    expect(claveFinanciera(explicito)).toBe(claveFinanciera(preset));
  });
});

describe("R5 · el filtro recortado, normalizado: insensible al orden y sensible al contenido", () => {
  const zonas = (ids: string[]) =>
    claveFinanciera(consultaDe("egresos", MAESTRO, { rango: "dia", zona_id: ids }));

  it("[a,b] y [b,a] comparten entrada; [a] y [a,b] no", () => {
    expect(zonas(["z-a", "z-b"])).toBe(zonas(["z-b", "z-a"]));
    expect(zonas(["z-a"])).not.toBe(zonas(["z-a", "z-b"]));
  });

  it("«sin filtrar por la dimension» y «filtrar por una lista» no se funden", () => {
    expect(claveFinanciera(consultaDe("egresos", MAESTRO, { rango: "dia" }))).not.toBe(
      zonas(["z-a"]),
    );
  });

  it("las tres dimensiones del filtro son independientes entre si", () => {
    const enZona = claveFinanciera(consultaDe("egresos", MAESTRO, { rango: "dia", zona_id: ["x"] }));
    const enTienda = claveFinanciera(
      consultaDe("egresos", MAESTRO, { rango: "dia", tienda_id: ["x"] }),
    );
    expect(enZona).not.toBe(enTienda);
  });
});

describe("R5 · la metrica entra en la clave", () => {
  it("dos metricas financieras distintas con el mismo rango y filtro no comparten entrada", () => {
    expect(claveFinanciera(consultaDe("egresos", MAESTRO))).not.toBe(
      claveFinanciera(consultaDe("ingreso_flete", MAESTRO)),
    );
  });
});

describe("R5 · espacio de nombres propio: financiera y operativa no colisionan", () => {
  it("una clave financiera y una operativa de la misma consulta no coinciden", () => {
    // Es la colision REAL que puede darse: el decorador de la 128 escribe con
    // `claveDeConsulta(c, [])` y el de esta feature con `claveFinanciera(c)`. Sin prefijo, la
    // separacion dependeria de que los ids de metrica de los dos dominios sigan siendo
    // distintos — una propiedad del catalogo (feature 135), no de la cache. Y el fallo no seria
    // una cifra rara: seria un `CuboRollup[]` servido donde se espera un `ResultadoFinanciero`.
    const c = consultaDe("entregas", MAESTRO, { rango: "dia" });
    expect(claveFinanciera(c)).not.toBe(claveDeConsulta(c, SIN_GRANO));
  });

  it("y ninguna clave operativa puede empezar como una financiera", () => {
    const operativa = claveDeConsulta(consultaDe("entregas", MAESTRO), SIN_GRANO);
    const financiera = claveFinanciera(consultaDe("egresos", MAESTRO));
    const prefijo = financiera.slice(0, financiera.indexOf("m="));
    expect(prefijo.length).toBeGreaterThan(0);
    expect(operativa.startsWith(prefijo)).toBe(false);
  });
});

describe("la clave es determinista", () => {
  it("dos llamadas con la misma consulta dan la misma cadena", () => {
    const c = consultaDe("egresos", MAESTRO, { rango: "mes" });
    expect(claveFinanciera(c)).toBe(claveFinanciera(c));
  });
});
