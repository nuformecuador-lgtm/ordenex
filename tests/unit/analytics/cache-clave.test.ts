import { describe, it, expect } from "vitest";
import { claveDeConsulta } from "@/lib/analytics/cache-clave";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import { consultaDe, MAESTRO } from "./_fake-operativa";
import type { DimensionAnalitica } from "@/lib/analytics/types";

// Feature 128 / T1.2 — R5, R7 y R8. La CLAVE.
//
// La consulta NO se forja: se construye por el camino real (`prepararConsultaAnalitica`), como
// hace `_fake-operativa.ts` de la 126. Asi cada caso ejercita tambien el recorte de la 122.

const SIN_GRANO: readonly DimensionAnalitica[] = [];

describe("R5 · la clave sale del rango RESUELTO, nunca del preset", () => {
  it("el mismo preset en dos dias distintos no comparte entrada", () => {
    const hoy = consultaDe("entregas", MAESTRO, { rango: "dia" }, new Date("2026-08-03T15:00:00.000Z"));
    const ayer = consultaDe("entregas", MAESTRO, { rango: "dia" }, new Date("2026-08-02T15:00:00.000Z"));

    // Los dos son `rango: "dia"`. Si el preset entrara en la clave, serian la MISMA entrada y
    // la consulta de hoy devolveria los cubos de ayer.
    expect(hoy.rango.preset).toBe(ayer.rango.preset);
    expect(claveDeConsulta(hoy, SIN_GRANO)).not.toBe(claveDeConsulta(ayer, SIN_GRANO));
  });

  it("y el preset NO aparece en la clave: dos presets que resuelven al mismo rango comparten", () => {
    const preset = consultaDe("entregas", MAESTRO, { rango: "dia" }, new Date("2026-08-03T15:00:00.000Z"));
    const explicito = consultaDe(
      "entregas",
      MAESTRO,
      { rango: "personalizado", desde: preset.rango.desdeFecha, hasta: preset.rango.hastaFecha },
      new Date("2026-08-03T15:00:00.000Z"),
    );
    expect(explicito.rango.preset).not.toBe(preset.rango.preset);
    expect(claveDeConsulta(explicito, SIN_GRANO)).toBe(claveDeConsulta(preset, SIN_GRANO));
  });
});

describe("R7 · el filtro recortado entra normalizado: insensible al orden, sensible al contenido", () => {
  const zonas = (ids: string[]) =>
    claveDeConsulta(consultaDe("entregas", MAESTRO, { rango: "dia", zona_id: ids }), SIN_GRANO);

  it("[a,b] y [b,a] comparten entrada; [a] y [a,b] no", () => {
    expect(zonas(["z-a", "z-b"])).toBe(zonas(["z-b", "z-a"]));
    expect(zonas(["z-a"])).not.toBe(zonas(["z-a", "z-b"]));
  });

  it("un filtro por tienda distinto no comparte entrada con otro", () => {
    const t1 = claveDeConsulta(
      consultaDe("entregas", MAESTRO, { rango: "dia", tienda_id: ["t-1"] }),
      SIN_GRANO,
    );
    const t2 = claveDeConsulta(
      consultaDe("entregas", MAESTRO, { rango: "dia", tienda_id: ["t-2"] }),
      SIN_GRANO,
    );
    expect(t1).not.toBe(t2);
  });

  it("«sin filtrar por la dimension» y «filtrar por la lista vacia» no se funden", () => {
    const sinFiltro = claveDeConsulta(consultaDe("entregas", MAESTRO, { rango: "dia" }), SIN_GRANO);
    const conZona = claveDeConsulta(
      consultaDe("entregas", MAESTRO, { rango: "dia", zona_id: ["z-a"] }),
      SIN_GRANO,
    );
    expect(sinFiltro).not.toBe(conZona);
  });

  it("las tres dimensiones del filtro son independientes entre si", () => {
    // Si el codigo escribiera las tres listas en un mismo hueco, mover un id de zona a tienda
    // daria la misma clave. Aqui no.
    const enZona = claveDeConsulta(
      consultaDe("entregas", MAESTRO, { rango: "dia", zona_id: ["x"] }),
      SIN_GRANO,
    );
    const enTienda = claveDeConsulta(
      consultaDe("entregas", MAESTRO, { rango: "dia", tienda_id: ["x"] }),
      SIN_GRANO,
    );
    expect(enZona).not.toBe(enTienda);
  });
});

describe("R8 · la metrica y los granos entran en la clave", () => {
  it("la misma metrica con y sin desagregacion no comparte entrada", () => {
    const c = consultaDe("ordenes_por_estado", MAESTRO, { rango: "dia" });
    const sin = claveDeConsulta(c, SIN_GRANO);
    const con = claveDeConsulta(c, ["estatus"]);
    // Sin esto, `ordenes_por_estado` desagregada por estatus recibiria los cubos YA agregados
    // de una consulta previa sin grano y el embudo se colapsaria en un total.
    expect(sin).not.toBe(con);
  });

  it("dos metricas distintas con el mismo filtro no comparten entrada", () => {
    const entregas = consultaDe("entregas", MAESTRO, { rango: "dia" });
    const devoluciones = consultaDe("devoluciones", MAESTRO, { rango: "dia" });
    expect(claveDeConsulta(entregas, SIN_GRANO)).not.toBe(
      claveDeConsulta(devoluciones, SIN_GRANO),
    );
  });

  it("los granos se normalizan al orden canonico: pedirlos al reves es la MISMA agregacion", () => {
    const c = consultaDe("ordenes_por_estado", MAESTRO, { rango: "dia" });
    expect(claveDeConsulta(c, ["estatus", "zona"])).toBe(claveDeConsulta(c, ["zona", "estatus"]));
  });

  it("un grano de mas no comparte entrada con uno de menos", () => {
    const c = consultaDe("ordenes_por_estado", MAESTRO, { rango: "dia" });
    expect(claveDeConsulta(c, ["zona"])).not.toBe(claveDeConsulta(c, ["zona", "estatus"]));
  });
});

describe("la clave es determinista", () => {
  it("dos llamadas con la misma consulta dan la misma cadena", () => {
    const c = consultaDe("entregas", MAESTRO, { rango: "mes" });
    expect(claveDeConsulta(c, ["zona"])).toBe(claveDeConsulta(c, ["zona"]));
  });
});

// Feature 267 / R12 — DOS INTEGRADORES DISTINTOS, DOS ENTRADAS DE CACHE DISTINTAS.
//
// Es EL invariante que impide servirle a un integrador el agregado de otro. La clave no se
// forja: cada consulta se construye por el camino real (`prepararConsultaAnalitica` con el
// canal `api_key`), asi que lo que se compara es la clave que produciria el canal de verdad.
describe("267/R12 · la clave de cache separa a dos integradores", () => {
  const AHORA_267 = new Date("2026-08-03T15:00:00.000Z");

  function consultaIntegrador(usuarioId: string, metricaId = "entregas") {
    const r = prepararConsultaAnalitica(
      { rango: "dia" },
      { usuarioId, rol: "apiKey" },
      metricaId,
      AHORA_267,
      "api_key",
    );
    if (r.status !== "ok") throw new Error(`no concedio: ${JSON.stringify(r)}`);
    return r.consulta;
  }

  it("mismo rango, misma metrica, mismo filtro: la clave DIFIERE por el sujeto del alcance", () => {
    const a = consultaIntegrador("u-api-key-1");
    const b = consultaIntegrador("u-api-key-2");
    expect(claveDeConsulta(a, SIN_GRANO)).not.toBe(claveDeConsulta(b, SIN_GRANO));
  });

  it("y el mismo integrador SI comparte entrada consigo mismo (la clave es estable)", () => {
    expect(claveDeConsulta(consultaIntegrador("u-api-key-1"), SIN_GRANO)).toBe(
      claveDeConsulta(consultaIntegrador("u-api-key-1"), SIN_GRANO),
    );
  });

  it("el usuarioId del integrador entra en la clave, no un literal comodin del canal", () => {
    expect(claveDeConsulta(consultaIntegrador("u-api-key-1"), SIN_GRANO)).toContain(
      "u-api-key-1",
    );
  });

  it("un integrador y un adminTienda con el MISMO id caerian en la misma entrada, y por eso el id es unico por usuario", () => {
    // No es una laguna: `orden.tienda_id` apunta a `usuario`, y un usuario tiene UN rol. El
    // caso se deja escrito para que quede claro que la separacion la da el ID, no el rol.
    const integrador = consultaIntegrador("u-mismo-id");
    const tienda = consultaDe(
      "entregas",
      { usuarioId: "u-mismo-id", rol: "adminTienda" },
      { rango: "dia" },
      AHORA_267,
    );
    expect(claveDeConsulta(integrador, SIN_GRANO)).toBe(claveDeConsulta(tienda, SIN_GRANO));
  });
});
