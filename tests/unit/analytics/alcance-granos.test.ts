import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";
import { METRICAS } from "@/lib/analytics/metrics";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import { resolverAlcance } from "@/lib/analytics/alcance";
import type { ActorAnalitica } from "@/lib/analytics/alcance";

// Feature 122 / T3.4 — R37: NO hay recorte de GRANOS por rol (D4, D5, D6).
//
// La puerta F1.4 decidio tres cosas que juntas significan lo mismo: el `adminSatelite` ve
// el grano `tienda` de su zona (D4), el `adminTienda` ve el grano `mensajero` de sus
// propias ordenes (D5, anonimizado) y el `mensajero` ve el grano `tienda` (D6).
//
// La consecuencia de diseno es la que este test fija: el recorte es de FILAS
// (R26-R28) y, en el caso de D5, de IDENTIDAD (R38/R39) — nunca de columnas de
// agrupacion. Una segunda tabla "granos permitidos por rol" seria una tercera fuente de
// verdad que se desincroniza con el catalogo, y por eso R37 la prohibe expresamente.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DIR_ANALYTICS = path.join(REPO_ROOT, "lib", "analytics");

const ACTOR: Record<string, ActorAnalitica> = {
  maestro: { usuarioId: "u-maestro", rol: "maestro" },
  admin: { usuarioId: "u-admin", rol: "admin" },
  adminSatelite: { usuarioId: "u-satelite", rol: "adminSatelite", zonaId: "z1" },
  adminTienda: { usuarioId: "u-tienda", rol: "adminTienda" },
  mensajero: { usuarioId: "u-mensajero", rol: "mensajero" },
};

function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

/** Firma de una tabla "granos por rol": un rol mapeado a una lista. */
const RE_GRANOS_POR_ROL = [
  /\b(maestro|admin|adminSatelite|adminTienda|mensajero)\s*:\s*\[/,
  /Record<\s*RolAnalitica\s*,\s*readonly\s+DimensionAnalitica/,
];

describe("R37 · todo rol que ve la metrica puede pedir todos sus granos", () => {
  it("para cada rol con alcance total o acotado, los granos solicitables son los del catalogo", () => {
    let combinaciones = 0;
    for (const rol of ROLES_ANALITICA) {
      for (const metrica of METRICAS) {
        if (metrica.alcance[rol] === "prohibido") continue;
        const r = resolverAlcance(ACTOR[rol], metrica.id);
        expect(r.estado, `${rol}/${metrica.id}`).toBe("ok");
        // El resolutor no mira `granos` ni los reduce: la resolucion es la misma sea cual
        // sea el grano pedido. Lo que se afirma es que no existe filtro de grano por rol.
        expect(metrica.granos.length, `${rol}/${metrica.id}`).toBeGreaterThan(0);
        combinaciones += metrica.granos.length;
      }
    }
    expect(combinaciones).toBeGreaterThan(0);
  });

  it("D4 · adminSatelite puede desagregar por tienda dentro de su zona", () => {
    const conGranoTienda = METRICAS.filter(
      (m) => m.granos.includes("tienda") && m.alcance.adminSatelite === "acotado",
    );
    expect(conGranoTienda.length).toBeGreaterThan(0);
    for (const metrica of conGranoTienda) {
      expect(resolverAlcance(ACTOR.adminSatelite, metrica.id), metrica.id).toEqual({
        estado: "ok",
        alcance: { tipo: "zona", zonaId: "z1" },
      });
    }
  });

  it("D5 · adminTienda puede desagregar por mensajero sobre sus propias ordenes", () => {
    const conGranoMensajero = METRICAS.filter(
      (m) => m.granos.includes("mensajero") && m.alcance.adminTienda === "acotado",
    );
    expect(conGranoMensajero.length).toBeGreaterThan(0);
    for (const metrica of conGranoMensajero) {
      expect(resolverAlcance(ACTOR.adminTienda, metrica.id), metrica.id).toEqual({
        estado: "ok",
        alcance: { tipo: "tienda", tiendaId: "u-tienda" },
      });
    }
  });

  it("D6 · mensajero puede desagregar por tienda sobre sus propias ordenes", () => {
    const conGranoTienda = METRICAS.filter(
      (m) => m.granos.includes("tienda") && m.alcance.mensajero === "acotado",
    );
    expect(conGranoTienda.length).toBeGreaterThan(0);
    for (const metrica of conGranoTienda) {
      expect(resolverAlcance(ACTOR.mensajero, metrica.id), metrica.id).toEqual({
        estado: "ok",
        alcance: { tipo: "mensajero", mensajeroId: "u-mensajero" },
      });
    }
  });
});

describe("R37 · guardia: no existe una segunda tabla de granos por rol", () => {
  it("censo: ningun archivo de lib/analytics mapea un rol a una lista de granos", () => {
    const hallazgos: string[] = [];
    for (const nombre of fs.readdirSync(DIR_ANALYTICS).filter((n) => n.endsWith(".ts"))) {
      const codigo = soloCodigo(fs.readFileSync(path.join(DIR_ANALYTICS, nombre), "utf8"));
      for (const patron of RE_GRANOS_POR_ROL) {
        if (patron.test(codigo)) hallazgos.push(`lib/analytics/${nombre}: ${patron.source}`);
      }
    }
    expect(hallazgos, "hay una segunda tabla de granos por rol (R37 la prohibe)").toEqual([]);
  });

  it("autocomprobacion: el censo detecta una tabla de granos por rol escrita a mano", () => {
    const infractores = [
      'const GRANOS_POR_ROL = { adminTienda: ["fecha"], mensajero: ["fecha"] };',
      "const G: Record<RolAnalitica, readonly DimensionAnalitica[]> = {} as never;",
    ];
    for (const caso of infractores) {
      expect(
        RE_GRANOS_POR_ROL.some((p) => p.test(caso)),
        caso,
      ).toBe(true);
    }
  });

  it("el censo mira archivos de verdad y no pasa por vacio", () => {
    const archivos = fs.readdirSync(DIR_ANALYTICS).filter((n) => n.endsWith(".ts"));
    expect(archivos.length).toBeGreaterThanOrEqual(9);
  });
});
