import { describe, it, expect, vi } from "vitest";
import type { GestionResultado } from "@prisma/client";

import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import type {
  IRastreoPublicoRepository,
  OrdenRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import { ESTATUS_POR_RESULTADO } from "@/lib/types/gestion-destino";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { NOMBRE_RESULTADO_PENDIENTE } from "@/lib/types/rastreo-publico";

/**
 * FICHA 454 (R31, decision del humano 2026-09-24) — EL RASTREO PUBLICO NOMBRA EL RESULTADO PENDIENTE.
 *
 * La entrada pendiente de la linea publica lleva `nombreResultado`: el nombre VISIBLE del resultado
 * («Rechazada»), para que la pagina diga «Rechazada · pendiente de confirmación» y no el hito
 * compartido «No entregado». Tres cosas se afirman aqui:
 *
 *  1. CONTRATO (literal, a mano): los cinco nombres. Es lo que el destinatario lee.
 *  2. FUENTE: son los MISMOS que el chip de estado de las pantallas internas (`ORDER_STATUS_LABELS`
 *     del estado al que la aprobacion aplica el resultado). La tabla es una copia declarada porque
 *     `lib/` no puede importar de `app/`; si una cambia sin la otra, este caso se pone rojo.
 *  3. EL SERVICIO la usa: para cada resultado la entrada pendiente trae su nombre, y nada mas que
 *     lo ya publico (`hito`, `fecha`, `pendiente`) — ningun codigo interno.
 */

const RESULTADOS: readonly GestionResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

describe("454/R31 · el nombre visible del resultado pendiente en el rastreo publico", () => {
  it("contrato: los cinco nombres, escritos a mano", () => {
    expect(NOMBRE_RESULTADO_PENDIENTE).toEqual({
      entregada: "Entregada",
      reprogramada: "Reprogramada",
      devuelta: "Devuelta",
      rechazada: "Rechazada",
      incidente: "Incidente",
    });
  });

  it("fuente: cada nombre es el del chip de estado del destino de aplicacion", () => {
    for (const r of RESULTADOS) {
      expect(NOMBRE_RESULTADO_PENDIENTE[r], r).toBe(ORDER_STATUS_LABELS[ESTATUS_POR_RESULTADO[r]]);
    }
  });

  for (const resultado of RESULTADOS) {
    it(`servicio: una gestion pendiente «${resultado}» se publica con su nombre y sin codigos`, async () => {
      const orden: OrdenRastreoFila = {
        id: "orden-interna",
        numGuia: 454_001,
        telefonoDest: "8712-3456",
        deletedAt: null,
      };
      const repo: IRastreoPublicoRepository = {
        buscarPorGuia: vi.fn(async () => orden),
        listarTransiciones: vi.fn(async () => [
          { createdAt: new Date("2026-09-24T14:00:00.000Z"), estatusValue: "en_reparto" },
        ]),
        buscarGestionPendiente: vi.fn(async () => ({
          resultado,
          createdAt: new Date("2026-09-24T16:00:00.000Z"),
        })),
      };
      const servicio = new RastreoPublicoService(repo, {
        RATE_MAX: 100,
        RATE_WINDOW_MINUTES: 10,
        DIGITOS_SEGUNDO_FACTOR: 4,
        ZONA_HORARIA: "America/Costa_Rica",
      });

      const c = await servicio.consultar(454_001, "3456");
      if (c.estado !== "ok") throw new Error("precondicion: el rastreo debia encontrar la guia");
      const ultima = c.envio.linea[c.envio.linea.length - 1]!;

      expect(Object.keys(ultima).sort()).toEqual(["fecha", "hito", "nombreResultado", "pendiente"]);
      expect(ultima.nombreResultado).toBe(NOMBRE_RESULTADO_PENDIENTE[resultado]);
      expect(ultima.pendiente).toBe(true);
      // El nombre es texto visible, no el codigo: ningun `value` del catalogo es ese texto.
      expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(ultima.nombreResultado);
      // Las entradas confirmadas conservan su forma exacta `{ hito, fecha }`.
      for (const e of c.envio.linea.slice(0, -1)) {
        expect(Object.keys(e).sort()).toEqual(["fecha", "hito"]);
      }
    });
  }
});
