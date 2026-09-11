import { describe, it, expect } from "vitest";
import type {
  ListarNotificacionesResult,
  NotificacionDTO,
} from "@/lib/types/notificacion";

// FICHA 409 (T5.1, R34) — EL CAMBIO DEL DTO ES ADITIVO.
//
// «Aditivo» aqui significa algo que un test puede romper: un DTO construido con SOLO los campos
// que existian antes de esta ficha SIGUE TIPANDO, y ningun campo vigente cambio de tipo ni
// desaparecio. Si los seis campos nuevos fueran obligatorios, este archivo no compilaria — y con
// el dejarian de compilar las suites vigentes de la campana, que construyen literales de DTO.
//
// La otra mitad de R34 la da `pnpm run typecheck`: si algun consumidor vigente dejara de compilar,
// el gate lo dice antes que este archivo.

describe("R34 — un DTO con SOLO los campos vigentes sigue tipando", () => {
  it("compila y conserva los valores", () => {
    // ⚠️ NI UN CAMPO DE LA FICHA 409 AQUI. Este literal es la foto del DTO ANTES del cambio.
    const comoAntes: NotificacionDTO = {
      id: "n-1",
      notification_type: "alert",
      description: "Una orden fue rechazada por el destinatario.",
      anexo: "REM-0042",
      read: false,
      createdAt: "2026-07-27T10:00:00.000Z",
    };

    expect(comoAntes.id).toBe("n-1");
    expect(comoAntes.anexo).toBe("REM-0042");
    // Los nuevos, ausentes, son `undefined`: nadie deja de compilar por leerlos.
    expect(comoAntes.evento).toBeUndefined();
    expect(comoAntes.accionable).toBeUndefined();
    expect(comoAntes.titulo).toBeUndefined();
    expect(comoAntes.detalle).toBeUndefined();
    expect(comoAntes.cuando).toBeUndefined();
    expect(comoAntes.atajo).toBeUndefined();
  });

  it("sin `anexo` tambien, como hasta hoy", () => {
    const sinAnexo: NotificacionDTO = {
      id: "n-2",
      notification_type: "box",
      description: "Carga masiva terminada: 3 órdenes cargadas.",
      read: true,
      createdAt: "2026-07-27T10:00:00.000Z",
    };

    expect(sinAnexo).not.toHaveProperty("anexo");
  });
});

describe("R34 — ningun campo vigente cambio de tipo", () => {
  it("los seis de siempre siguen siendo lo que eran", () => {
    const dto: NotificacionDTO = {
      id: "n-3",
      notification_type: "warning",
      description: "texto",
      read: false,
      createdAt: "2026-07-27T10:00:00.000Z",
    };

    expect(typeof dto.id).toBe("string");
    expect(typeof dto.description).toBe("string");
    expect(typeof dto.read).toBe("boolean");
    expect(typeof dto.createdAt).toBe("string");
    expect(["alert", "box", "warning"]).toContain(dto.notification_type);
  });
});

describe("el DTO COMPLETO —el que emite el servidor— tambien tipa", () => {
  it("con los seis campos nuevos, incluido el atajo nulo del unico accionable sin pantalla", () => {
    const completo: NotificacionDTO = {
      id: "n-4",
      notification_type: "alert",
      description: "El servicio de mapas está rechazando nuestras peticiones.",
      read: false,
      createdAt: "2026-07-27T10:00:00.000Z",
      evento: "geocodificacion_caida",
      accionable: true,
      titulo: "El servicio de mapas está rechazando nuestras peticiones.",
      detalle: null,
      cuando: "hace 2 h",
      atajo: null,
    };

    expect(completo.accionable).toBe(true);
    expect(completo.atajo).toBeNull();
  });
});

describe("`porHacer` viaja en el resultado del listado", () => {
  it("es un numero y convive con `noLeidas`, que NO desaparece", () => {
    const resultado: ListarNotificacionesResult = {
      status: "ok",
      items: [],
      noLeidas: 0,
      porHacer: 0,
    };

    if (resultado.status !== "ok") throw new Error("imposible");
    expect(resultado.porHacer).toBe(0);
    expect(resultado.noLeidas).toBe(0);
  });
});
