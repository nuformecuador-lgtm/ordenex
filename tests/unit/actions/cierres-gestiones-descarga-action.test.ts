import { describe, it, expect, vi } from "vitest";
import { listarGestionesCierresAdminCompleto } from "@/lib/actions/cierres-admin";
import { listarGestionesCierresBodegaCompleto } from "@/lib/actions/cierre-bodega";
import type { ICierresAdminService } from "@/lib/interfaces/services/ICierresAdminService";
import type { ICierresBodegaAdminService } from "@/lib/interfaces/services/ICierresBodegaAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 230 — Tandas 2 y 7 (T2.3/T7.3, R13/R17/R19/R21/R32/R36) — los DOS bordes de la
// descarga detallada.
//
// Se prueban JUNTOS y con la misma tabla de casos a propósito: son dos Server Actions con el
// mismo contrato, y el modo de fallo real es que UNA de las dos se quede corta —el `.parse` que
// no se escribió, el actor resuelto DESPUÉS de validar, la lista blanca que se copió a medias—.
// Un archivo por borde deja ese hueco abierto por construcción.
//
// El orden «actor antes de validar» (R17) no es cosmético: quien no tiene sesión no debe poder
// deducir qué claves acepta esta superficie probando entradas hasta ver cuál cambia el mensaje.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const ENTRADA_OK = { mensajeroIds: ["m-1"], desde: "2026-02-01", hasta: "2026-02-28" };

const CONJUNTO = { status: "ok" as const, items: [], total: 0 };

/** Los dos bordes, con lo mínimo para invocarlos y espiar su servicio. */
const BORDES = [
  {
    nombre: "cierres del día",
    accion: (input: unknown, deps: Record<string, unknown>) =>
      listarGestionesCierresAdminCompleto(input, deps),
    deps: (espia: ReturnType<typeof vi.fn>, getActor: () => Promise<Actor | null>) => ({
      service: { listarGestionesCierresAdminCompleto: espia } as unknown as ICierresAdminService,
      getActor,
    }),
  },
  {
    nombre: "cierres de bodega",
    accion: (input: unknown, deps: Record<string, unknown>) =>
      listarGestionesCierresBodegaCompleto(input, deps),
    deps: (espia: ReturnType<typeof vi.fn>, getActor: () => Promise<Actor | null>) => ({
      cierresBodegaAdminService: {
        listarGestionesCierresBodegaCompleto: espia,
      } as unknown as ICierresBodegaAdminService,
      getActor,
    }),
  },
];

describe.each(BORDES)("borde de la descarga detallada de $nombre (feature 230)", (borde) => {
  function armar(resultado: unknown = CONJUNTO, actor: Actor | null = MAESTRO) {
    const espia = vi.fn().mockResolvedValue(resultado);
    const getActor = vi.fn(async () => actor);
    return { espia, getActor, deps: borde.deps(espia, getActor) };
  }

  it("con sesión y entrada válida, delega en el servicio y devuelve su conjunto (R13/R36)", async () => {
    const { espia, deps } = armar();

    const r = await borde.accion(ENTRADA_OK, deps);

    expect(r).toEqual(CONJUNTO);
    // Lo elegido en el diálogo viaja como RECORTE del MISMO borde, ya parseado: no hay una
    // consulta paralela que lo resuelva por otro lado (R36).
    expect(espia).toHaveBeenCalledWith(MAESTRO, ENTRADA_OK);
  });

  it("devuelve unauthenticated sin parsear la entrada y sin filas (R17)", async () => {
    const { espia, deps } = armar(CONJUNTO, null);

    // Entrada INVÁLIDA a propósito: si el borde validara primero, el desenlace sería
    // `validation_error` y estaría contando al anónimo qué claves existen.
    const r = await borde.accion({ clave_inventada: 1 }, deps);

    expect(r).toEqual({ status: "unauthenticated" });
    expect(espia).not.toHaveBeenCalled();
  });

  it.each(["destinoZonaIds", "page", "pageSize", "estado"])(
    "una clave fuera de la lista blanca produce validation_error y ninguna fila (R19): %s",
    async (clave) => {
      const { espia, deps } = armar();

      const r = await borde.accion({ ...ENTRADA_OK, [clave]: "x" }, deps);

      expect(r).toMatchObject({ status: "validation_error" });
      expect(r).not.toHaveProperty("items");
      expect(espia).not.toHaveBeenCalled();
    },
  );

  it("un rango invertido produce validation_error sin tocar el servicio (R32)", async () => {
    const { espia, deps } = armar();

    const r = await borde.accion(
      { mensajeroIds: ["m-1"], desde: "2026-03-01", hasta: "2026-02-01" },
      deps,
    );

    expect(r).toMatchObject({ status: "validation_error" });
    expect(espia).not.toHaveBeenCalled();
  });

  it("confirmar sin ningún mensajero muere en el borde y no consulta nada (R39)", async () => {
    const { espia, deps } = armar();

    const r = await borde.accion({ mensajeroIds: [] }, deps);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(espia).not.toHaveBeenCalled();
  });

  it("propaga forbidden tal cual: es un resultado de DOMINIO, no un error de borde (R18/R25)", async () => {
    const { deps } = armar({ status: "forbidden" });

    expect(await borde.accion(ENTRADA_OK, deps)).toEqual({ status: "forbidden" });
  });

  it("propaga limite_excedido con sus conteos y sin filas (R21)", async () => {
    const { deps } = armar({ status: "limite_excedido", total: 7331, limite: 5000 });

    const r = await borde.accion(ENTRADA_OK, deps);

    expect(r).toEqual({ status: "limite_excedido", total: 7331, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });
});
