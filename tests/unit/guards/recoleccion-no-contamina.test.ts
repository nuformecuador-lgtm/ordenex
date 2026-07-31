import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 157 (R36/R37/R38) — GUARD de NO-CONTAMINACION. Patron de los censos del repo:
// verifica por lectura del fuente lo que la feature NO debe tocar, que es justo lo que ningun
// test de camino feliz puede demostrar.
//
// La decision del humano (2026-07-30) fue: la recoleccion es INVISIBLE para el cierre del dia
// y para el ranking. Se logra por AUSENCIA —no estampando `asignado_at` y no metiendo el estado
// en las listas que barren esos flujos—, y las ausencias se rompen sin que nadie se entere. De
// ahi este archivo: si alguien anade el estado a una de esas listas, o hace que la asignacion de
// recoleccion estampe `asignado_at`, el porcentaje de entregas de los mensajeros que recolectan
// empezaria a bajar solo, en silencio y sin forma de acreditarlo. Aqui falla en su lugar.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const ESTADO = "por_recolectar_en_tienda";

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** Fuente sin comentarios `//`: se juzga lo que el codigo EJECUTA, no lo que documenta. */
function sinComentarios(src: string): string {
  return src
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//"))
    .join("\n");
}

describe("Feature 157 — la recoleccion no contamina el cierre del dia (R37)", () => {
  it("`ESTADOS_PENDIENTES` del cierre NO incluye el estado de recoleccion", () => {
    const src = sinComentarios(leer("lib/services/CierreDiaService.ts"));
    const decl = src.match(/const ESTADOS_PENDIENTES = \[([^\]]*)\]/);

    expect(decl, "no se encontro ESTADOS_PENDIENTES en CierreDiaService").not.toBeNull();
    expect(decl![1]).not.toContain(ESTADO);
  });

  it("el corte diario solo barre en_reparto -> sin_gestionar, sin mencionar la recoleccion", () => {
    const src = sinComentarios(leer("lib/services/CorteDiarioService.ts"));

    expect(src).not.toContain(ESTADO);
  });
});

describe("Feature 157 — la recoleccion no contamina el ranking (R38)", () => {
  // El denominador del ranking es `orden.asignadoAt ∈ [hoy)`; el numerador cuenta entregas.
  // Una recoleccion no puede acreditarse como entrega, asi que si estampara `asignado_at`
  // restaria sin poder sumar jamas.
  // La ampliacion del 2026-07-31 hizo que la asignacion SI transicione (a `recolectando`) y
  // por tanto SI escriba historial: sin eso, la orden nunca salia del monton y se podia
  // reasignar sin fin. Lo que este guard protege sigue en pie y es lo que de verdad importa
  // para el ranking: `asignado_at` NO se estampa.
  it("`asignarRecoleccionLote` NO estampa asignadoAt, ni toca numGuia ni prioridad", () => {
    const src = leer("lib/repositories/OrdenRepository.ts");
    const metodo = src.match(/async asignarRecoleccionLote\([\s\S]*?\n {2}\}/);

    expect(metodo, "no se encontro asignarRecoleccionLote").not.toBeNull();
    const cuerpo = sinComentarios(metodo![0]);
    const data = cuerpo.match(/data:\s*\{([^}]*)\}/);
    expect(data, "no se encontro el `data` del updateMany").not.toBeNull();
    // Escribe el mensajero y el estado nuevo, nada mas.
    expect(data![1]).toContain("mensajeroAsignadoId");
    expect(data![1]).toContain("estatusId");
    // `asignado_at` es el denominador del ranking y el numerador solo cuenta entregas: una
    // recoleccion que lo estampara bajaria el porcentaje del mensajero sin poder subirlo.
    expect(data![1]).not.toContain("asignadoAt");
    expect(data![1]).not.toContain("numGuia");
    expect(data![1]).not.toContain("prioridad");
  });

  it("`asignarRecoleccionLote` SI deja rastro, con familia propia (auditoria de la asignacion)", () => {
    const src = leer("lib/repositories/OrdenRepository.ts");
    const metodo = src.match(/async asignarRecoleccionLote\([\s\S]*?\n {2}\}/);

    // Toda transicion pasa por el choke point de la feature 49; que esta lo haga es
    // justamente lo que permite saber QUIEN asigno la recoleccion y cuando.
    expect(sinComentarios(metodo![0])).toContain("appendCambioEstado");
  });

  it("el service de asignacion no toca `gestion_orden` (R36: no hay gestion todavia)", () => {
    const src = sinComentarios(leer("lib/services/GuiaAsignacionService.ts"));
    const metodo = src.match(/async asignarRecoleccion\([\s\S]*?\n  \}/);

    expect(metodo, "no se encontro asignarRecoleccion").not.toBeNull();
    expect(metodo![0]).not.toMatch(/gestion/i);
  });
});
