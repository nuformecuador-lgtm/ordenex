import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ESTATUS_POR_RESULTADO, estatusDestinoDeResultado } from "@/lib/types/gestion-destino";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// Feature 239 (T1.3, R3) — LA BISAGRA. Antes de la 239 el destino de una gestion no se declaraba en
// ningun sitio: se derivaba por IDENTIDAD DE NOMBRE entre el `resultado` y el `order_status.value`.
// La 239 creo este mapa y rompio la identidad para `devuelta` (-> `devolucion_por_confirmar`),
// porque la gestion aplicaba el estado AL REGISTRARSE y una `devuelta` inmediata arrancaba el reloj
// del SLA —y el cobro— antes de que la tienda pudiera verla.
//
// ⏳ 2026-09-23 — FICHA 454 (T1.1, design §6/§7): el estado ya NO se aplica al registrar; lo aplica
// la APROBACION del cierre. Con eso desaparece la razon del pre-estado: `devuelta -> devuelta` vuelve
// a ser la identidad, y lo que protege del cobro prematuro es el MOMENTO (la aprobacion), no un
// estado intermedio. Lo que este archivo sigue afirmando: el mapa es la UNICA fuente del destino, y
// quien lo consume es la aprobacion (no el registro). Antes: `devuelta` era el unico resultado que
// rompia la identidad y existia `ESTATUS_DEVOLUCION_POR_CONFIRMAR`.
//
// Los cinco resultados del enum `GestionResultado` (`db/schema.prisma`). Se escriben A MANO: si
// se derivaran del propio mapa, el test comprobaria que el mapa es igual a si mismo.
const RESULTADOS = ["entregado", "reprogramado", "novedad", "devolucion_a_origen_por_rechazo", "incidente"] as const;

const RAIZ = path.resolve(__dirname, "../../..");
function fuente(rel: string): string {
  return quitarComentarios(fs.readFileSync(path.join(RAIZ, rel), "utf8"));
}

describe("ESTATUS_POR_RESULTADO — el mapa `resultado -> estado destino` (239/R3 → 454)", () => {
  it("R3: los CINCO resultados tienen destino declarado, ninguno de mas ni de menos", () => {
    expect(Object.keys(ESTATUS_POR_RESULTADO).sort()).toEqual([...RESULTADOS].sort());
  });

  it("R3: cada destino es un `value` REAL del catalogo vigente", () => {
    for (const resultado of RESULTADOS) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(
        estatusDestinoDeResultado(resultado),
      );
    }
  });

  it("454: los cinco destinos son la IDENTIDAD — el pre-estado de la 239 se retira", () => {
    // Literal A PROPOSITO: es el contrato. Un `devuelta -> devolucion_por_confirmar` de vuelta
    // dejaria ordenes aprobadas en un estado que la 454 retira del catalogo.
    expect(estatusDestinoDeResultado("entregado")).toBe("entregado");
    expect(estatusDestinoDeResultado("reprogramado")).toBe("reprogramado");
    expect(estatusDestinoDeResultado("novedad")).toBe("novedad");
    expect(estatusDestinoDeResultado("devolucion_a_origen_por_rechazo")).toBe("devolucion_a_origen_por_rechazo");
    expect(estatusDestinoDeResultado("incidente")).toBe("incidente");
  });

  it("454/R1: el REGISTRO no consulta el mapa — el destino solo se aplica al APROBAR", () => {
    // Es la garantia que sustituye a la del pre-estado: si el registro volviera a resolver un
    // destino, la gestion volveria a mover la orden al instante (y la `devuelta`, a cobrar antes).
    for (const rel of [
      "lib/repositories/GestionOrdenRepository.ts",
      "lib/services/MisAsignacionesService.ts",
    ]) {
      const src = fuente(rel);
      expect(src, rel).not.toContain("ESTATUS_POR_RESULTADO");
      expect(src, rel).not.toContain("estatusDestinoDeResultado");
    }
    // Y la aprobacion SI lo lee, para los cinco resultados.
    const aprobacion = fuente("lib/services/CierresAdminService.ts");
    for (const resultado of RESULTADOS) {
      expect(aprobacion).toContain(`ESTATUS_POR_RESULTADO.${resultado}`);
    }
  });

  it("R2: el destino de cada resultado es un estado con arista LEGAL desde `en_reparto`", () => {
    // Coherencia con el mapa cerrado de la 140: la APLICACION escribe `en_reparto -> destino` por
    // el choke point, que es de fallo cerrado. Un destino sin arista haria revertir la aprobacion
    // entera en runtime — un fallo que solo se veria en produccion.
    const destinos = TRANSICIONES.en_reparto.map((d) => d.to);
    for (const resultado of RESULTADOS) {
      expect(destinos).toContain(estatusDestinoDeResultado(resultado));
    }
  });
});
