import { describe, it, expect, vi } from "vitest";

import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { FiltrosCierres } from "@/lib/types/filtros-cierres";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

/**
 * FICHA 386 (2026-09-07) — el recorte por ESTADO no se pierde en la capa de servicio.
 *
 * QUÉ MIDE, y qué NO. Mide una sola propiedad: que los CUATRO caminos que leen los listados de
 * cierres del día —las dos páginas y sus dos archivos— entregan al repositorio el bloque de
 * filtros TAL CUAL lo recibieron, con `estados` dentro. No mide qué filas salen: eso depende del
 * `WHERE`, y un doble no emite SQL. Las filas se miden contra Postgres en
 * `tests/integration/db/cierres-filtro-estado-sql-real.test.ts`, y la forma del objeto que Prisma
 * recibe en `tests/unit/repositories/cierres-filtros-where.test.ts`.
 *
 * POR QUÉ EXISTE UN ARCHIVO PARA ESTO. El servicio pasa `filtros` como una caja negra, así que
 * añadir una clave al schema no le pide ningún cambio… y por eso mismo tampoco pone rojo nada si
 * alguien reconstruye el objeto por el camino («paso solo lo que me interesa»): la clave llegaría
 * `undefined`, el listado saldría sin recortar y no habría ni un test en rojo. Es la misma familia
 * del composition root que importa un notificador y no lo inyecta. Se comprueba que alguien lo
 * PASA, no que exista.
 *
 * El alcance NO viaja aquí y eso también se afirma: sale del actor, y el filtro solo puede quitar
 * filas dentro de él.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

/** El bloque que la pantalla mandaría: el estado JUNTO a los otros tres recortes. */
const FILTROS: FiltrosCierres = {
  desde: "2026-09-01",
  hasta: "2026-09-07",
  destinoZonaIds: ["11111111-1111-4111-8111-111111111111"],
  mensajeroIds: ["33333333-3333-4333-8333-333333333333"],
  estados: ["vencido"],
};

function dobles() {
  // Las firmas se escriben ENTERAS —incluido el tercer/segundo argumento que este archivo mide—
  // para que `mock.calls[0]` sea una tupla con esa posicion. Con `vi.fn(async () => ...)` el
  // argumento no existe ni para TypeScript, y afirmar sobre el no compilaria.
  const findHistoricoPaginado = vi.fn(
    async (_alcance: Alcance, _rango: RangoPagina, _filtros?: FiltrosCierres) => ({
      items: [] as CierreAdminResumenRow[],
      total: 0,
    }),
  );
  const findColaPaginada = vi.fn(
    async (_alcance: Alcance, _rango: RangoPagina, _filtros?: FiltrosCierres) => ({
      items: [] as CierreAdminResumenRow[],
      total: 0,
    }),
  );
  const findHistoricoCompleto = vi.fn(
    async (_alcance: Alcance, _filtros?: FiltrosCierres) => [] as CierreAdminResumenRow[],
  );
  const findColaCompleta = vi.fn(
    async (_alcance: Alcance, _filtros?: FiltrosCierres) => [] as CierreAdminResumenRow[],
  );

  const repo = {
    findHistoricoPaginado,
    findColaPaginada,
    findHistoricoCompleto,
    findColaCompleta,
  } as unknown as ICierresAdminRepository;

  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    contarCierresAbiertosPorMensajero: vi.fn(async () => new Map()),
    findUsuarioZonaId: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async () => null),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;

  const svc = new CierresAdminService(
    repo,
    zonaRepo,
    ordenRepo,
    signedUrls,
    {
      sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, "0.00"])),
      ),
      obtenerCierreParaPago: vi.fn(async () => null),
    },
    {
      sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) =>
        Object.fromEntries(ids.map((id) => [id, "0.00"])),
      ),
    },
  );

  return { svc, findHistoricoPaginado, findColaPaginada, findHistoricoCompleto, findColaCompleta };
}

describe("FICHA 386 — el filtro por estado llega entero al repositorio", () => {
  it("la PÁGINA de pendientes entrega el bloque tal cual, con `estados` dentro", async () => {
    const d = dobles();
    await d.svc.listarPendientesCierresAdminPaginado(
      { page: 1, pageSize: 25, filtros: FILTROS },
      MAESTRO,
    );

    expect(d.findColaPaginada).toHaveBeenCalledTimes(1);
    const [alcance, , filtros] = d.findColaPaginada.mock.calls[0]!;
    // ⭑ El bloque ENTERO, no una copia recortada: el `toEqual` compara las cinco claves.
    expect(filtros).toEqual(FILTROS);
    expect(filtros?.estados).toEqual(["vencido"]);
    // Y el alcance sigue saliendo del actor, no del input.
    expect(alcance).toEqual({ destinoTipo: "bodega_central", destinoZonaId: null });
  });

  it("la PÁGINA del histórico entrega el bloque tal cual, con `estados` dentro", async () => {
    const d = dobles();
    await d.svc.listarHistoricoCierresAdminPaginado(
      { page: 1, pageSize: 25, filtros: FILTROS },
      MAESTRO,
    );

    expect(d.findHistoricoPaginado).toHaveBeenCalledTimes(1);
    const [, , filtros] = d.findHistoricoPaginado.mock.calls[0]!;
    expect(filtros).toEqual(FILTROS);
  });

  it("el ARCHIVO de cada lista recibe el MISMO bloque que su página", async () => {
    // Si divergieran, «descargar» dejaría de significar «esto que estoy viendo, entero»: el
    // usuario con un estado elegido se llevaría un archivo con los otros.
    const d = dobles();
    await d.svc.listarPendientesCierresAdminCompleto(MAESTRO, FILTROS);
    await d.svc.listarHistoricoCierresAdminCompleto(MAESTRO, FILTROS);

    expect(d.findColaCompleta.mock.calls[0]![1]).toEqual(FILTROS);
    expect(d.findHistoricoCompleto.mock.calls[0]![1]).toEqual(FILTROS);
  });

  it("sin filtros el repositorio sigue recibiendo `undefined`, no un bloque vacío", async () => {
    // La contraprueba: quien no filtra tiene que seguir por el camino de antes. Un `{}` en vez de
    // `undefined` haría que `filtrosWhere` devolviera `[]` y `colaWhere` escribiera `AND: []`,
    // que es justo lo que el caso (1) de `cierres-filtros-where.test.ts` prohíbe.
    const d = dobles();
    await d.svc.listarPendientesCierresAdminPaginado({ page: 1, pageSize: 25 }, MAESTRO);

    expect(d.findColaPaginada.mock.calls[0]![2]).toBeUndefined();
  });
});
