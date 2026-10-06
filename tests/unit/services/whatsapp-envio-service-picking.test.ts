import { describe, expect, it, vi } from "vitest";
import { WhatsappEnvioService, MSG } from "@/lib/services/WhatsappEnvioService";
import type { GuardarEnvioInput } from "@/lib/types/envios-whatsapp";
import { MAESTRO, enviosRepo, plantilla } from "./_dobles-envios-474";
import { MENSAJES_PICKING } from "@/lib/whatsapp-envios/informes/picking/parametros";

// Ficha 476 (T4.3) — guardar un envio del picking con el informe REAL del catalogo (el service usa
// `informePorClave` por defecto): R2 (sin tienda → error en `parametros.tiendaId`) y R5 (no llega a
// un adminTienda, ni como rol ni como usuario elegido).

const AHORA = new Date("2026-10-05T10:00:00.000Z");

function input(o: Partial<GuardarEnvioInput> = {}): GuardarEnvioInput {
  return {
    nombre: "Picking Gameos",
    informeClave: "picking",
    plantillaId: "pl-picking",
    parametros: { tiendaId: "t-gameos", diasAtraso: 2 },
    disparo: "hora_fija",
    diasSemana: [1, 2, 3, 4, 5],
    hora: "06:30",
    eventoClave: null,
    destinatarios: { roles: ["admin"], usuarioIds: [] },
    ...o,
  };
}

function montar(envios = enviosRepo()) {
  const plantillas = {
    findEnviableDeInformeById: vi.fn(async () =>
      plantilla({ id: "pl-picking", informeClave: "picking", llevaDocumento: true, variables: ["tienda", "ordenes"] }),
    ),
  };
  const s = new WhatsappEnvioService({
    envios,
    plantillas,
    cola: { enqueue: vi.fn(async () => null) },
    ejecuciones: { ultimaPorEnvio: vi.fn(async () => new Map()) },
    now: () => AHORA,
  });
  return { s, envios };
}

describe("476/R2 — parametros al guardar", () => {
  it("valido: se guarda", async () => {
    const { s } = montar();
    expect((await s.crear(input(), MAESTRO)).status).toBe("ok");
  });

  it("sin elegir tienda (valor de partida) → error SOLO en parametros.tiendaId", async () => {
    const { s, envios } = montar();
    const r = await s.crear(input({ parametros: { diasAtraso: 2 } }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { "parametros.tiendaId": [MENSAJES_PICKING.tienda] } });
    expect(envios.crear).not.toHaveBeenCalled();
  });

  it("diasAtraso fuera de 1..30 → error en parametros.diasAtraso", async () => {
    const { s } = montar();
    const r = await s.crear(input({ parametros: { tiendaId: "t-gameos", diasAtraso: 31 } }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { "parametros.diasAtraso": [MENSAJES_PICKING.dias] } });
  });
});

describe("476/R5 — no apto para adminTienda", () => {
  it("el ROL adminTienda entre los destinatarios → rechazo en destinatarios", async () => {
    const { s } = montar();
    const r = await s.crear(input({ destinatarios: { roles: ["maestro", "adminTienda"], usuarioIds: [] } }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { destinatarios: [MSG.adminTienda] } });
  });

  it("un USUARIO adminTienda elegido → rechazo en destinatarios", async () => {
    const envios = enviosRepo({ rolesDeUsuarios: vi.fn(async () => [{ id: "t1", rol: "adminTienda" }]) });
    const { s } = montar(envios);
    const r = await s.crear(input({ destinatarios: { roles: [], usuarioIds: ["t1"] } }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { destinatarios: [MSG.adminTienda] } });
  });
});
