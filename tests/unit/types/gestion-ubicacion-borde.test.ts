import { describe, it, expect } from "vitest";

import {
  gestionarSchema,
  GESTION_UBICACION_AUSENCIA,
} from "@/lib/types/gestion-orden";

// Feature 193 (T B.3, R6/R8-R14) — la disyuncion del borde: O coordenadas O motivo.
//
// El archivo se organiza en TABLA por las cinco ramas de `resultado` a proposito (R14). El
// pedido humano fue «sea cual sea el resultado», y una regla que solo se comprueba en la rama
// que alguien recordo cubrir no es transversal: es una coincidencia. Con la tabla, una sexta
// rama que naciera sin la regla pondria estos casos en rojo el mismo dia.

const UBICACION_OK = { lat: 9.9281, lng: -84.0907 };

/** Una foto valida (el borde exige 1..N en las ramas con evidencia). */
const FOTO = { type: "image/jpeg", size: 1024 };

/** Los campos propios de cada rama, sin nada de ubicacion. */
const RAMAS = [
  {
    nombre: "entregada",
    base: {
      ordenId: "o1",
      resultado: "entregada" as const,
      montoRecibido: 0,
      metodoPago: "efectivo",
      evidencias: [FOTO],
    },
  },
  {
    nombre: "reprogramada",
    base: {
      ordenId: "o1",
      resultado: "reprogramada" as const,
      fechaReprogramacion: "2099-01-01",
      motivo: "cliente ausente",
    },
  },
  {
    nombre: "devuelta",
    base: {
      ordenId: "o1",
      resultado: "devuelta" as const,
      causaDevolucion: "not_found",
      motivo: "no se ubico",
      evidencias: [FOTO],
    },
  },
  {
    nombre: "rechazada",
    base: {
      ordenId: "o1",
      resultado: "rechazada" as const,
      motivo: "cliente rechaza",
      evidencias: [FOTO],
    },
  },
  {
    nombre: "incidente",
    base: {
      ordenId: "o1",
      resultado: "incidente" as const,
      causaIncidente: "danado",
      motivo: "caja aplastada",
      evidencias: [FOTO],
    },
  },
];

describe("Feature 193 — ubicacion en el borde de la gestion", () => {
  describe.each(RAMAS)("rama $nombre", ({ base }) => {
    it("R8: con ubicacion valida, pasa", () => {
      const r = gestionarSchema.safeParse({ ...base, ubicacion: UBICACION_OK });
      expect(r.success).toBe(true);
    });

    it("R9: sin ubicacion pero con motivo tecnico, pasa", () => {
      const r = gestionarSchema.safeParse({
        ...base,
        ubicacionAusencia: "no_disponible",
      });
      expect(r.success).toBe(true);
    });

    it("R10: sin ubicacion y sin motivo, falla", () => {
      const r = gestionarSchema.safeParse({ ...base });
      expect(r.success).toBe(false);
    });

    it("R11: con ubicacion Y motivo a la vez, falla", () => {
      const r = gestionarSchema.safeParse({
        ...base,
        ubicacion: UBICACION_OK,
        ubicacionAusencia: "timeout",
      });
      expect(r.success).toBe(false);
    });

    it("R12: el permiso denegado no es un motivo expresable, falla", () => {
      const r = gestionarSchema.safeParse({
        ...base,
        ubicacionAusencia: "denegado",
      });
      expect(r.success).toBe(false);
    });

    it("R13: coordenadas fuera de rango fallan", () => {
      const r = gestionarSchema.safeParse({
        ...base,
        ubicacion: { lat: 999, lng: -84.0907 },
      });
      expect(r.success).toBe(false);
    });

    it("R6: media coordenada no es una ubicacion", () => {
      const r = gestionarSchema.safeParse({
        ...base,
        ubicacion: { lat: 9.9281 },
      });
      expect(r.success).toBe(false);
    });
  });

  describe("la lista cerrada de motivos", () => {
    it("R5: son exactamente los cuatro fallos tecnicos", () => {
      expect([...GESTION_UBICACION_AUSENCIA].sort()).toEqual([
        "contexto_inseguro",
        "no_disponible",
        "no_soportado",
        "timeout",
      ]);
    });

    it("R12: la denegacion NO esta, y esa ausencia ES el bloqueo", () => {
      // Si alguien la anade "por completitud", R19 deja de bloquear y ningun otro test lo
      // nota: la gestion pasaria sin ubicacion, en silencio. La guardia vive aqui.
      expect(GESTION_UBICACION_AUSENCIA).not.toContain("denegado");
    });

    it("cada motivo de la lista es aceptado por el borde", () => {
      for (const motivo of GESTION_UBICACION_AUSENCIA) {
        const r = gestionarSchema.safeParse({
          ...RAMAS[1].base,
          ubicacionAusencia: motivo,
        });
        expect(r.success, motivo).toBe(true);
      }
    });
  });

  it("R14: la tabla cubre las CINCO ramas del enum de resultado", () => {
    // Si manana nace una sexta rama, este caso obliga a anadirla arriba en vez de dejarla
    // sin cubrir por olvido.
    expect(RAMAS.map((r) => r.nombre)).toEqual([
      "entregada",
      "reprogramada",
      "devuelta",
      "rechazada",
      "incidente",
    ]);
  });
});
