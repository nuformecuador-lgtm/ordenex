import { describe, it, expect } from "vitest";
import {
  AnaliticaOperativaError,
  ETAPAS_OPERATIVAS,
} from "@/lib/interfaces/services/IAnaliticaOperativaService";
import type { IAnaliticaOperativaRollupRepository } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import { MENSAJERO, consultaDe, servicioCon, vivaFalso } from "./_fake-operativa";

// Feature 126 / T4.7 — R32.
//
// Un error de consulta cruza dos fronteras: llega al log del servidor y, envuelto, al borde.
// Lo que NO puede llevar es material ajeno al solicitante: ids de orden, guias, nombres,
// telefonos... ni el `where` completo con los ids del filtro y del alcance, que es la forma
// mas natural de «dar contexto» y la mutacion que R32 anticipa.
//
// El `cause` conserva el error original para el diagnostico del servidor; lo que se afirma
// aqui es el MENSAJE, que es lo que se propaga.

const UUID_DEL_ALCANCE = "11111111-2222-3333-4444-555555555555";
const UUID_DE_ORDEN = "99999999-8888-7777-6666-555555555555";

function rollupQueRevienta(): IAnaliticaOperativaRollupRepository {
  return {
    async agregarCubos() {
      // Un error crudo de la base, con material sensible dentro: es exactamente lo que NO
      // debe salir tal cual.
      throw new Error(
        `insufficient privilege on row orden_id=${UUID_DE_ORDEN} telefono=+50688887777`,
      );
    },
    async etiquetasDeEstatus() {
      return new Map();
    },
  };
}

describe("R32 · el error nombra la etapa y la metrica y no filtra identificadores", () => {
  it("el error nombra la etapa y la metrica y no filtra identificadores", async () => {
    const consulta = consultaDe("entregas", { ...MENSAJERO, usuarioId: UUID_DEL_ALCANCE });
    const servicio = servicioCon(rollupQueRevienta(), vivaFalso());

    await expect(servicio.consultar(consulta)).rejects.toBeInstanceOf(AnaliticaOperativaError);
    const error = (await servicio.consultar(consulta).catch((e: unknown) => e)) as Error;

    expect(error.message).toContain("cubos_rollup");
    expect(error.message).toContain("entregas");
    // Ni el id del alcance (que el propio actor aporto, pero sigue siendo un id) ni nada del
    // error crudo de la base.
    expect(error.message).not.toContain(UUID_DEL_ALCANCE);
    expect(error.message).not.toContain(UUID_DE_ORDEN);
    expect(error.message).not.toContain("telefono");
    expect(error.message).not.toContain("+506");
  });

  it("el `cause` conserva el original para el servidor, sin exponerlo en el mensaje", async () => {
    const consulta = consultaDe("entregas");
    const error = await servicioCon(rollupQueRevienta(), vivaFalso())
      .consultar(consulta)
      .catch((e: unknown) => e) as AnaliticaOperativaError;
    expect((error.cause as Error).message).toContain(UUID_DE_ORDEN);
    expect(error.message).not.toContain(UUID_DE_ORDEN);
  });

  it("la etapa sale de un dominio CERRADO: nada de texto libre", async () => {
    const error = await servicioCon(rollupQueRevienta(), vivaFalso())
      .consultar(consultaDe("entregas"))
      .catch((e: unknown) => e) as AnaliticaOperativaError;
    expect(ETAPAS_OPERATIVAS as readonly string[]).toContain(error.etapa);
    expect(error.metricaId).toBe("entregas");
  });

  it("cada etapa se identifica: un fallo del intradia NO se reporta como fallo del rollup", async () => {
    // Sin esto, envolver todo con la misma etiqueta dejaria el diagnostico igual de mudo que
    // no envolver nada: R32 pide la ETAPA porque hay cinco caminos distintos que fallan.
    const vivaRota = {
      async agingPorEstado(): Promise<never> {
        throw new Error("boom");
      },
      async cubosDelDiaEnCurso(): Promise<never> {
        throw new Error("boom");
      },
    };
    const rollupOk: IAnaliticaOperativaRollupRepository = {
      async agregarCubos() {
        return [];
      },
      async etiquetasDeEstatus() {
        return new Map();
      },
    };
    const error = await servicioCon(rollupOk, vivaRota)
      .consultar(consultaDe("entregas"))
      .catch((e: unknown) => e) as AnaliticaOperativaError;
    expect(error.etapa).toBe("cubos_intradia");
    expect(error.etapa).not.toBe("cubos_rollup");
  });
});
