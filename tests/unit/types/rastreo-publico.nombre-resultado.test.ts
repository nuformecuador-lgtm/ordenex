import { describe, it, expect, vi } from "vitest";
import type { GestionResultado } from "@prisma/client";

import type {
  IRastreoPublicoRepository,
  OrdenRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import { nombreDeResultado } from "@/lib/types/gestion-resultado";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

/**
 * FICHA 454 (R31, decision del humano 2026-09-24) — EL RASTREO PUBLICO NOMBRA EL RESULTADO PENDIENTE.
 *
 * ⏳ REESCRITO EL 2026-09-24 (FICHA 455, T1.9; design §1.2/§4; R4/R33). En la 454 la entrada pendiente
 * llevaba `nombreResultado` desde una COPIA declarada de cinco nombres (`NOMBRE_RESULTADO_PENDIENTE`:
 * «Entregada», «Rechazada»…) atada por este test a `ORDER_STATUS_LABELS` de la UI, porque `lib/` no
 * podia importar de `app/`. La 455 mueve la fuente unica a `lib/types/order-status.ts` y la copia se
 * ABSORBE: la entrada pendiente es `{ nombre, fecha, pendiente }` y `nombre` es `nombreDeResultado`,
 * el nombre del estado homonimo. Se afirma lo mismo que antes:
 *
 *  1. CONTRATO (literal, a mano): los cinco nombres que el destinatario lee (requirements 455 §0.2).
 *  2. FUENTE: son los de `nombreDeResultado` (la fuente unica, la misma del chip interno).
 *  3. EL SERVICIO los publica: para cada resultado la entrada pendiente trae su nombre, y nada mas que
 *     lo ya publico (`nombre`, `fecha`, `pendiente`) — ningun codigo interno.
 */

const CONTRATO: Readonly<Record<GestionResultado, string>> = {
  entregado: "Entregado",
  reprogramado: "Reprogramado",
  novedad: "Novedad",
  devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo",
  incidente: "Incidente",
};

const RESULTADOS = Object.keys(CONTRATO) as GestionResultado[];

describe("454/R31 · 455/R33 — el nombre visible del resultado pendiente en el rastreo publico", () => {
  it("fuente: cada nombre del contrato es el de `nombreDeResultado`", () => {
    for (const r of RESULTADOS) {
      expect(nombreDeResultado(r), r).toBe(CONTRATO[r]);
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

      expect(Object.keys(ultima).sort()).toEqual(["fecha", "nombre", "pendiente"]);
      expect(ultima.nombre).toBe(CONTRATO[resultado]);
      expect(ultima.pendiente).toBe(true);
      // El nombre es texto visible, no el codigo: ningun `value` del catalogo es ese texto.
      expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(ultima.nombre);
      // Las entradas confirmadas conservan su forma exacta `{ nombre, fecha }`.
      for (const e of c.envio.linea.slice(0, -1)) {
        expect(Object.keys(e).sort()).toEqual(["fecha", "nombre"]);
      }
    });
  }

  it("un resultado que no es de gestion no publica entrada pendiente", async () => {
    const repo: IRastreoPublicoRepository = {
      buscarPorGuia: vi.fn(async () => ({
        id: "orden-interna",
        numGuia: 454_002,
        telefonoDest: "8712-3456",
        deletedAt: null,
      })),
      listarTransiciones: vi.fn(async () => [
        { createdAt: new Date("2026-09-24T14:00:00.000Z"), estatusValue: "en_reparto" },
      ]),
      buscarGestionPendiente: vi.fn(async () => ({
        resultado: "resultado_inventado",
        createdAt: new Date("2026-09-24T16:00:00.000Z"),
      })),
    };
    const servicio = new RastreoPublicoService(repo, {
      RATE_MAX: 100,
      RATE_WINDOW_MINUTES: 10,
      DIGITOS_SEGUNDO_FACTOR: 4,
      ZONA_HORARIA: "America/Costa_Rica",
    });
    const c = await servicio.consultar(454_002, "3456");
    if (c.estado !== "ok") throw new Error("precondicion: el rastreo debia encontrar la guia");
    expect(c.envio.linea.map((e) => e.nombre)).toEqual(["En reparto"]);
    expect(JSON.stringify(c)).not.toContain("resultado_inventado");
  });
});
