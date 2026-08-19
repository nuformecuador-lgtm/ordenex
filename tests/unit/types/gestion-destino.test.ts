import { describe, expect, it } from "vitest";

import {
  ESTATUS_DEVOLUCION_POR_CONFIRMAR,
  ESTATUS_POR_RESULTADO,
  estatusDestinoDeResultado,
} from "@/lib/types/gestion-destino";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";

// Feature 239 (T1.3, R3) — LA BISAGRA. Antes de esta feature el destino de una gestion no se
// declaraba en ningun sitio: se derivaba por IDENTIDAD DE NOMBRE entre el `resultado` y el
// `order_status.value` (`findEstatusIdByValue(input.resultado)`). Estos casos afirman que esa
// derivacion ya NO existe y que el mapa la sustituye.
//
// Los cinco resultados del enum `GestionResultado` (`db/schema.prisma`). Se escriben A MANO: si
// se derivaran del propio mapa, el test comprobaria que el mapa es igual a si mismo.
const RESULTADOS = ["entregada", "reprogramada", "devuelta", "rechazada", "incidente"] as const;

describe("ESTATUS_POR_RESULTADO — el mapa `resultado -> estado destino` (239/R3)", () => {
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

  // EL CASO DE LA FEATURE. Cuatro de los cinco siguen coincidiendo con su nombre; `devuelta` NO.
  // Si esto se pone verde con `devuelta -> devuelta`, la orden vuelve a entrar en `devuelta` al
  // gestionar, su ventana de SLA arranca ahi y el cron la escala y la COBRA antes de que la
  // tienda haya podido verla (`progress/auditoria_ayuda_tienda.md` §1).
  it("R2/R3: `devuelta` es el UNICO resultado cuyo destino NO es su propio nombre", () => {
    const rompenLaIdentidad = RESULTADOS.filter(
      (resultado) => estatusDestinoDeResultado(resultado) !== (resultado as string),
    );
    expect(rompenLaIdentidad).toEqual(["devuelta"]);
    expect(estatusDestinoDeResultado("devuelta")).toBe("devolucion_por_confirmar");
    expect(estatusDestinoDeResultado("devuelta")).not.toBe("devuelta");
  });

  it("R3: los otros cuatro conservan su destino de siempre (la feature no los toca)", () => {
    expect(estatusDestinoDeResultado("entregada")).toBe("entregada");
    expect(estatusDestinoDeResultado("reprogramada")).toBe("reprogramada");
    expect(estatusDestinoDeResultado("rechazada")).toBe("rechazada");
    expect(estatusDestinoDeResultado("incidente")).toBe("incidente");
  });

  it("R3: el destino NO se deriva del nombre — el mapa es la unica fuente", () => {
    // La derivacion vieja, reproducida aqui para nombrarla: `resultado` usado tal cual como
    // `value` de estatus. Para `devuelta` ya no coincide con el mapa, y esa discrepancia es
    // exactamente lo que la feature 239 introduce a proposito.
    const derivadoPorNombre = (resultado: string) => resultado;
    expect(derivadoPorNombre("devuelta")).not.toBe(estatusDestinoDeResultado("devuelta"));
  });

  it("R2: el destino de `devuelta` es un estado con arista LEGAL desde `en_reparto`", () => {
    // Coherencia con el mapa cerrado de la 140: el destino declarado aqui tiene que ser
    // alcanzable desde el unico origen posible de una gestion (`en_reparto`). Si el mapa
    // apuntara a un estado sin arista, `appendCambioEstado` rechazaria la transicion en runtime
    // y la gestion fallaria entera — un fallo que solo se veria en produccion.
    const destinos = TRANSICIONES.en_reparto.map((d) => d.to);
    for (const resultado of RESULTADOS) {
      expect(destinos).toContain(estatusDestinoDeResultado(resultado));
    }
  });

  it("la constante del pre-estado se DERIVA del mapa (no hay dos verdades)", () => {
    expect(ESTATUS_DEVOLUCION_POR_CONFIRMAR).toBe(ESTATUS_POR_RESULTADO.devuelta);
  });
});
