import { describe, it, expect, vi } from "vitest";

import { handleListadoApi } from "@/app/api/ordenes/api-key/route";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import { CODIGO_VIGENTE_DE_ANTERIOR } from "@/lib/types/order-status";

/**
 * FICHA 455 (T1.6, design §5.2; R26) — filtrar el listado por un codigo ANTERIOR responde `422` con un
 * mensaje que nombra el codigo vigente, y NO llega al servicio (no hay pagina vacia en silencio). Un
 * codigo que nunca existio sigue siendo `422`, sin ese mensaje. La ruta real, con dobles de la
 * autenticacion y del servicio (el SQL del filtro lo mide C12 contra Postgres).
 */

const SECRETO = "ordx_secretovivo1234567890";

function montar() {
  const listar = vi.fn().mockResolvedValue({ items: [], pagination: { limit: 50, offset: 0, total: 0 } });
  const lecturaService = { listar, detallePorOrdenId: vi.fn() } as unknown as IApiOrdenLecturaService;
  const autenticar = async (): Promise<ApiKeyAuthResult> => ({
    status: "ok",
    actor: { usuarioId: "store-1", rol: "apiKey" },
    apiKeyId: "key-1",
  });
  return { listar, deps: { autenticar, lecturaService } };
}

async function pedir(estado: string) {
  const m = montar();
  const res = await handleListadoApi(
    new Request(`http://localhost/api/ordenes/api-key?estado=${encodeURIComponent(estado)}`, {
      headers: { Authorization: `Bearer ${SECRETO}` },
    }),
    m.deps,
  );
  const cuerpo = (await res.json()) as { code?: string; details?: { fieldErrors?: Record<string, string[]> } };
  return { status: res.status, cuerpo, listar: m.listar };
}

describe("455/R26 — GET /api/ordenes/api-key con un codigo anterior", () => {
  it("cada uno de los 7 codigos anteriores responde 422, nombra su vigente y no consulta nada", async () => {
    for (const [anterior, vigente] of Object.entries(CODIGO_VIGENTE_DE_ANTERIOR)) {
      const r = await pedir(anterior);
      expect(r.status, anterior).toBe(422);
      expect(r.cuerpo.code).toBe("VALIDATION_ERROR");
      const [mensaje] = r.cuerpo.details?.fieldErrors?.estado ?? [];
      expect(mensaje).toBe(
        `'${anterior}' ya no existe: ahora se llama '${vigente}' («${
          {
            entregado: "Entregado",
            novedad: "Novedad",
            reprogramado: "Reprogramado",
            mensajero_recogiendo_en_bodega: "Mensajero recogiendo en la bodega",
            devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo",
            novedad_interna: "Novedad interna",
            por_devolver_a_bodega_central: "Por devolver a bodega central",
          }[vigente]
        }»). Ver docs/api/CHANGELOG.md.`,
      );
      expect(r.listar).not.toHaveBeenCalled();
    }
  });

  it("un codigo que nunca existio sigue en 422, sin el mensaje de codigo anterior", async () => {
    const r = await pedir("estado_que_nunca_existio_455");
    expect(r.status).toBe(422);
    expect((r.cuerpo.details?.fieldErrors?.estado ?? []).join(" ")).not.toContain("ya no existe");
    expect(r.listar).not.toHaveBeenCalled();
  });

  it("CONTROL: el codigo vigente pasa al servicio (200)", async () => {
    const r = await pedir("novedad");
    expect(r.status).toBe(200);
    expect(r.listar).toHaveBeenCalledTimes(1);
  });
});
