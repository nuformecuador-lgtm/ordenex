import { describe, it, expect } from "vitest";
import { METRICAS } from "@/lib/analytics/metrics";
import { MENSAJERO_SIN_ASIGNAR } from "@/lib/analytics/types";
import { resolverAlcance } from "@/lib/analytics/alcance";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { whereGestionOrden, whereOrden } from "@/lib/analytics/alcance-columnas";

// Feature 122 / T5.4 — R26-R29: LO QUE CADA ROL **NO** PUEDE VER.
//
// Estos son los requisitos negativos de primer rango. Cada uno describe una fuga concreta
// que ya ha ocurrido en otros sistemas:
//   R26  el adminTienda alcanzando ordenes de otra tienda;
//   R27  el adminSatelite alcanzando ordenes de otra zona porque las gestiono un mensajero
//        de la suya (la confusion `usuario.zona_id` vs `orden.zona_id`, D9);
//   R28  el mensajero alcanzando ordenes que no le estan asignadas, incluido el cubo
//        `sin_asignar`, que NO es "suyo" por no ser de nadie;
//   R29  cualquiera de los tres alcanzando dinero.

const TIENDA: ActorAnalitica = { usuarioId: "tienda-propia", rol: "adminTienda" };
const SATELITE: ActorAnalitica = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: "z-propia" };
const MENSAJERO_A: ActorAnalitica = { usuarioId: "m-A", rol: "mensajero" };
const MENSAJERO_B: ActorAnalitica = { usuarioId: "m-B", rol: "mensajero" };

const OPERATIVAS = METRICAS.filter((m) => m.dominio === "operativa");
const FINANCIERAS = METRICAS.filter((m) => m.dominio === "financiera");

/** Aplica el fragmento de `where` de `orden` a una fila sintetica. */
function ordenAlcanzada(
  fragmento: Record<string, unknown>,
  fila: Record<string, string | null>,
): boolean {
  return Object.entries(fragmento).every(([clave, valor]) => fila[clave] === valor);
}

describe("R26 · el adminTienda no alcanza ninguna fila de otra tienda", () => {
  it("el where de toda metrica operativa contiene la igualdad de SU tienda", () => {
    for (const metrica of OPERATIVAS) {
      const r = resolverAlcance(TIENDA, metrica.id);
      expect(r.estado, metrica.id).toBe("ok");
      if (r.estado !== "ok") continue;
      expect(whereOrden(r.alcance), metrica.id).toEqual({ tiendaId: "tienda-propia" });
      expect(whereGestionOrden(r.alcance), metrica.id).toEqual({
        orden: { tiendaId: "tienda-propia" },
      });
    }
  });

  it("con dos tiendas en el universo, la ajena queda fuera del where", () => {
    const r = resolverAlcance(TIENDA, "entregas");
    if (r.estado !== "ok") throw new Error("el adminTienda debe alcanzar la operativa");
    const fragmento = whereOrden(r.alcance) as Record<string, unknown>;

    expect(ordenAlcanzada(fragmento, { tiendaId: "tienda-propia" })).toBe(true);
    expect(ordenAlcanzada(fragmento, { tiendaId: "tienda-ajena" })).toBe(false);
  });
});

describe("R27 · el adminSatelite no alcanza ordenes de otra zona (D9)", () => {
  it("el where recorta por orden.zonaId en toda metrica operativa", () => {
    for (const metrica of OPERATIVAS) {
      const r = resolverAlcance(SATELITE, metrica.id);
      expect(r.estado, metrica.id).toBe("ok");
      if (r.estado !== "ok") continue;
      expect(whereOrden(r.alcance), metrica.id).toEqual({ zonaId: "z-propia" });
    }
  });

  it("caso D9: una orden de la zona B gestionada por un mensajero de la zona A NO es alcanzable", () => {
    const r = resolverAlcance(SATELITE, "entregas");
    if (r.estado !== "ok") throw new Error("el adminSatelite debe alcanzar la operativa");
    const fragmento = whereOrden(r.alcance) as Record<string, unknown>;

    // La fila: la ORDEN es de la zona ajena; quien la gestiono vive en la zona propia.
    const ordenDeLaZonaAjena = { zonaId: "z-ajena", mensajeroAsignadoId: "m-de-z-propia" };
    expect(ordenAlcanzada(fragmento, ordenDeLaZonaAjena)).toBe(false);

    // Y el fragmento no menciona en ningun sitio la zona del usuario/mensajero.
    expect(JSON.stringify(fragmento)).not.toContain("usuario");
    expect(JSON.stringify(fragmento)).not.toContain("mensajero");
  });
});

describe("R28 · el mensajero no alcanza ordenes que no le estan asignadas", () => {
  it("el where recorta por orden.mensajeroAsignadoId, tambien en gestion_orden", () => {
    for (const metrica of OPERATIVAS) {
      const r = resolverAlcance(MENSAJERO_A, metrica.id);
      expect(r.estado, metrica.id).toBe("ok");
      if (r.estado !== "ok") continue;
      expect(whereOrden(r.alcance), metrica.id).toEqual({ mensajeroAsignadoId: "m-A" });
      expect(whereGestionOrden(r.alcance), metrica.id).toEqual({
        orden: { mensajeroAsignadoId: "m-A" },
      });
    }
  });

  it("el cubo sin_asignar queda FUERA del alcance del mensajero: no es suyo por no ser de nadie", () => {
    const r = resolverAlcance(MENSAJERO_A, "ordenes_por_estado");
    if (r.estado !== "ok") throw new Error("el mensajero debe alcanzar la operativa");
    const fragmento = whereOrden(r.alcance) as Record<string, unknown>;

    expect(ordenAlcanzada(fragmento, { mensajeroAsignadoId: MENSAJERO_SIN_ASIGNAR })).toBe(false);
    expect(ordenAlcanzada(fragmento, { mensajeroAsignadoId: null })).toBe(false);
    expect(ordenAlcanzada(fragmento, { mensajeroAsignadoId: "m-A" })).toBe(true);
  });

  it("orden reasignada de A a B: tras la reasignacion la alcanza B y no A — COMPORTAMIENTO ESPERADO (D3)", () => {
    // El caso decisivo que la puerta F1.4 decidio a sabiendas: la orden estaba asignada a
    // A, A la gestiono (queda una gestion vigente SUYA) y el maestro la reasigno a B.
    // Con `orden.mensajero_asignado_id` como unica columna de recorte, B alcanza la fila y
    // la gestion de A desde el instante de la reasignacion, y A deja de alcanzarla:
    // **A pierde el credito del trabajo que si hizo**.
    //
    // Esto NO es un defecto que arreglar: es D3, con su consecuencia escrita y asumida. Si
    // el negocio se queja, la respuesta es volver a la puerta, no parchear el adaptador.
    const ordenTrasReasignacion = { mensajeroAsignadoId: "m-B" };
    const gestionDeA = { orden: ordenTrasReasignacion, mensajeroId: "m-A" };

    const alcanceA = resolverAlcance(MENSAJERO_A, "entregas");
    const alcanceB = resolverAlcance(MENSAJERO_B, "entregas");
    if (alcanceA.estado !== "ok" || alcanceB.estado !== "ok") throw new Error("deben resolver ok");

    const whereA = whereOrden(alcanceA.alcance) as Record<string, unknown>;
    const whereB = whereOrden(alcanceB.alcance) as Record<string, unknown>;

    // La ORDEN: B si, A no.
    expect(ordenAlcanzada(whereB, ordenTrasReasignacion)).toBe(true);
    expect(ordenAlcanzada(whereA, ordenTrasReasignacion)).toBe(false);

    // La GESTION que ejecuto A: la alcanza B (ve trabajo que no hizo) y no A (pierde el
    // suyo), porque el recorte de gestiones pasa por la orden y no por `mensajero_id`.
    const gestionB = whereGestionOrden(alcanceB.alcance) as { orden: Record<string, unknown> };
    const gestionA = whereGestionOrden(alcanceA.alcance) as { orden: Record<string, unknown> };
    expect(ordenAlcanzada(gestionB.orden, gestionDeA.orden)).toBe(true);
    expect(ordenAlcanzada(gestionA.orden, gestionDeA.orden)).toBe(false);

    // Y en ningun momento se mira `gestion_orden.mensajero_id`, que aqui dice "m-A".
    expect(Object.keys(gestionB)).toEqual(["orden"]);
    expect(gestionDeA.mensajeroId).toBe("m-A");
  });
});

describe("R29 · ningun rol acotado alcanza el dinero, ni agregado ni en cero", () => {
  it("los 3 roles x las 8 financieras se deniegan antes de producir ningun where", () => {
    let casos = 0;
    for (const actor of [SATELITE, TIENDA, MENSAJERO_A]) {
      for (const metrica of FINANCIERAS) {
        const r = resolverAlcance(actor, metrica.id);
        expect(r, `${actor.rol}/${metrica.id}`).toEqual({
          estado: "denegado",
          motivo: "metrica_prohibida",
        });
        // No hay `alcance` del que derivar un fragmento: el `where` no llega a existir.
        expect("alcance" in r).toBe(false);
        casos++;
      }
    }
    expect(casos).toBe(24);
  });
});
