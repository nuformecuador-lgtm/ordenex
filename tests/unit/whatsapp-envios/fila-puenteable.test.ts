import { describe, it, expect } from "vitest";
import { NotificacionEvento as NotificacionEventoPrisma } from "@prisma/client";
import { filaPuenteable } from "@/lib/whatsapp-envios/eventos";
import type { CrearNotificacionInput } from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";

// Ficha 474 (T2.6, design §6.6, R50) — la puerta del puente, recorrida sobre LAS 18 entradas.

const DISPONIBLES = new Set([
  "postulacion_mensajero_pendiente",
  "postulacion_recurso_pendiente",
  "cierre_dia_por_aprobar",
  "cierre_dia_vencido",
  "mensajero_bloqueado_por_cierres",
  "gasto_fijo_cobro_pendiente",
  "webhook_suscripcion_pausada",
  "geocodificacion_caida",
  "devoluciones_represadas",
  "reprogramadas_esperan_cierre",
]);

function fila(evento: NotificacionEvento, extra: Partial<CrearNotificacionInput> = {}): CrearNotificacionInput {
  return {
    tipo: "alert",
    evento,
    descripcion: "texto",
    entidadTipo: "orden",
    entidadId: "ent-1",
    destinatario: { tipo: "rol", rol: "maestro" },
    ...extra,
  };
}

describe("474/R50 — filaPuenteable", () => {
  const todos = Object.values(NotificacionEventoPrisma) as NotificacionEvento[];

  it("las 18: fila a rol central sin alcance pasa SOLO si el evento esta disponible", () => {
    expect(todos).toHaveLength(18);
    for (const e of todos) {
      expect(filaPuenteable(fila(e))).toBe(DISPONIBLES.has(e));
    }
  });

  it("fila dirigida a un usuario -> no (ninguno de los 18)", () => {
    for (const e of todos) {
      expect(filaPuenteable(fila(e, { destinatario: { tipo: "usuario", usuarioId: "u1" } }))).toBe(false);
    }
  });

  it("fila acotada a una zona o a una tienda -> no", () => {
    expect(
      filaPuenteable(fila("cierre_dia_por_aprobar", { destinatario: { tipo: "rol", rol: "adminSatelite", zonaId: "z" } })),
    ).toBe(false);
    expect(
      filaPuenteable(fila("devoluciones_represadas", { destinatario: { tipo: "rol", rol: "adminTienda", tiendaId: "t" } })),
    ).toBe(false);
  });

  it("alcance explicitamente null cuenta como sin alcance", () => {
    expect(
      filaPuenteable(fila("geocodificacion_caida", { destinatario: { tipo: "rol", rol: "admin", zonaId: null, tiendaId: null } })),
    ).toBe(true);
  });

  it("entidadId nulo -> no", () => {
    expect(filaPuenteable(fila("geocodificacion_caida", { entidadId: null }))).toBe(false);
  });
});
