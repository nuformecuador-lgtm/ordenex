import { describe, it, expect } from "vitest";
import { NotificacionEvento as NotificacionEventoPrisma } from "@prisma/client";
import {
  EVENTOS_ENVIO_WHATSAPP,
  esEventoDisponible,
  eventosDisponibles,
  type PerfilEventoEnvio,
} from "@/lib/whatsapp-envios/eventos";
import {
  TEXTO_CIERRE_POR_APROBAR,
  textoGeocodificacionCaida,
} from "@/lib/notificaciones/emitir";

// Ficha 474 (T2.6, R49/R52) — el catalogo de eventos declara los DIECIOCHO avisos internos: diez
// disponibles (literal a mano, design §2.2) y ocho no, cada uno con su motivo. Que un valor nuevo
// del enum NO compile lo cubre el `satisfies Record<NotificacionEvento, …>` (typecheck; medido en
// impl_474.md).

const DISPONIBLES_A_MANO = [
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
].sort();

describe("474/R49 — catalogo de eventos", () => {
  it("las claves son EXACTAMENTE los valores del enum de Prisma (18)", () => {
    const delEnum = Object.values(NotificacionEventoPrisma).sort();
    expect(delEnum.length).toBe(18); // autocomprobacion: la extraccion no esta vacia
    expect(Object.keys(EVENTOS_ENVIO_WHATSAPP).sort()).toEqual(delEnum);
  });

  it("diez disponibles, exactamente los de design §2.2", () => {
    const disponibles = Object.entries(EVENTOS_ENVIO_WHATSAPP)
      .filter(([, p]) => (p as PerfilEventoEnvio).disponible)
      .map(([k]) => k)
      .sort();
    expect(disponibles).toEqual(DISPONIBLES_A_MANO);
    expect(eventosDisponibles().map((e) => e.clave).sort()).toEqual(DISPONIBLES_A_MANO);
  });

  it("los ocho no disponibles llevan un motivo no vacio", () => {
    const no = Object.values(EVENTOS_ENVIO_WHATSAPP as Record<string, PerfilEventoEnvio>).filter(
      (p) => !p.disponible,
    );
    expect(no).toHaveLength(8);
    for (const p of no) {
      if (p.disponible) throw new Error("imposible");
      expect(p.porQue.trim().length).toBeGreaterThan(10);
    }
  });

  it("ningun nombre visible usa la sigla SLA ni el plural del estado retirado", () => {
    for (const e of eventosDisponibles()) {
      expect(e.nombre).not.toMatch(/\bSLA\b/i);
      expect(e.nombre.toLowerCase()).not.toContain("reprogramadas");
      expect(e.descripcion.toLowerCase()).not.toContain("reprogramadas");
    }
  });

  it("R52: el ejemplo es el TEXTO REAL del emisor, no una copia", () => {
    const porAprobar = EVENTOS_ENVIO_WHATSAPP.cierre_dia_por_aprobar;
    expect(porAprobar.ejemploTexto).toBe(TEXTO_CIERRE_POR_APROBAR);
    expect(EVENTOS_ENVIO_WHATSAPP.geocodificacion_caida.ejemploTexto).toBe(textoGeocodificacionCaida(3));
  });

  it("esEventoDisponible: disponible / no disponible / desconocido", () => {
    expect(esEventoDisponible("geocodificacion_caida")).toBe(true);
    expect(esEventoDisponible("orden_rechazada")).toBe(false);
    expect(esEventoDisponible("no_existe")).toBe(false);
    expect(esEventoDisponible("toString")).toBe(false);
  });
});
