// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

import {
  avisoUbicacionDenegada,
  detectarContextoDeApertura,
  leerPermisoUbicacion,
  type PermisoUbicacion,
} from "@/lib/utils/aviso-ubicacion-denegada";

// Feature 399 — el aviso de ubicacion denegada, pieza por pieza.
//
// Los textos se afirman contra LITERALES escritos a mano, nunca contra la constante que los
// genera: comparar un texto con su propia fuente sale verde pase lo que pase y no probaria
// que el mensajero lee algo que existe en su pantalla. Estos literales SON el contrato.

const RESUMEN_APP_INSTALADA =
  "Para registrar la gestión hace falta tu ubicación. Abriste Ordenex desde su ícono, así que el permiso se activa en los Ajustes del teléfono.";

const RESUMEN_NAVEGADOR =
  "Para registrar la gestión hace falta tu ubicación. Activá el permiso desde el candado de la barra de direcciones (Permisos del sitio → Ubicación) y volvé a intentarlo.";

const RESUMEN_SIN_PERMISO_DEL_TELEFONO =
  "Para registrar la gestión hace falta tu ubicación. Este sitio ya tiene el permiso, así que hay que dárselo al navegador desde los Ajustes del teléfono.";

const RESUMEN_SIN_DECIDIR =
  "Para registrar la gestión hace falta tu ubicación. Tocá «Guardar gestión» otra vez y elegí «Permitir» cuando el teléfono te pregunte.";

/** Texto entero del aviso, para las afirmaciones de AUSENCIA. */
function todoElTexto(aviso: {
  resumen: string;
  titulo: string;
  pasos: readonly string[];
  nota?: string;
}): string {
  return [aviso.resumen, aviso.titulo, ...aviso.pasos, aviso.nota ?? ""].join(
    " ",
  );
}

const matchMediaOriginal = Object.getOwnPropertyDescriptor(
  window,
  "matchMedia",
);

/** `matchMedia` que responde `true` SOLO a las consultas indicadas. */
function instalarMatchMedia(consultasQueCoinciden: string[]) {
  Object.defineProperty(window, "matchMedia", {
    value: (consulta: string) =>
      ({
        matches: consultasQueCoinciden.includes(consulta),
        media: consulta,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
    configurable: true,
    writable: true,
  });
}

const permissionsOriginal = Object.getOwnPropertyDescriptor(
  navigator,
  "permissions",
);

function instalarPermissions(valor: unknown) {
  Object.defineProperty(navigator, "permissions", {
    value: valor,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (matchMediaOriginal) {
    Object.defineProperty(window, "matchMedia", matchMediaOriginal);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
  if (permissionsOriginal) {
    Object.defineProperty(navigator, "permissions", permissionsOriginal);
  } else {
    Reflect.deleteProperty(navigator, "permissions");
  }
});

describe("detectarContextoDeApertura", () => {
  it.each([
    "(display-mode: standalone)",
    "(display-mode: fullscreen)",
    "(display-mode: minimal-ui)",
  ])("con %s abierto NO hay barra de direcciones: es la app instalada", (consulta) => {
    instalarMatchMedia([consulta]);

    expect(detectarContextoDeApertura()).toBe("app_instalada");
  });

  it("en una pestaña normal ninguna consulta coincide: es el navegador", () => {
    instalarMatchMedia([]);

    expect(detectarContextoDeApertura()).toBe("navegador");
  });

  it("sin matchMedia cae del lado del NAVEGADOR, no del de la app instalada", () => {
    // El caso del servidor y el del navegador antiguo. Caer del otro lado mandaria a todo el
    // mundo a los Ajustes del telefono a buscar una app que ni siquiera esta instalada.
    Object.defineProperty(window, "matchMedia", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(detectarContextoDeApertura()).toBe("navegador");
  });

  it("si matchMedia lanza con una consulta, no se da por instalada", () => {
    Object.defineProperty(window, "matchMedia", {
      value: () => {
        throw new TypeError("consulta no soportada");
      },
      configurable: true,
      writable: true,
    });

    expect(detectarContextoDeApertura()).toBe("navegador");
  });
});

describe("leerPermisoUbicacion", () => {
  it.each([
    { state: "denied", esperado: "denegado" },
    { state: "granted", esperado: "concedido" },
    { state: "prompt", esperado: "sin_decidir" },
  ])("traduce el estado $state de la Permissions API", async ({ state, esperado }) => {
    const query = vi.fn().mockResolvedValue({ state });
    instalarPermissions({ query });

    await expect(leerPermisoUbicacion()).resolves.toBe(esperado);
    expect(query).toHaveBeenCalledWith({ name: "geolocation" });
  });

  it("sin Permissions API resuelve desconocido, no lanza", async () => {
    instalarPermissions(undefined);

    await expect(leerPermisoUbicacion()).resolves.toBe("desconocido");
  });

  it("si query lanza (nombre no soportado) resuelve desconocido", async () => {
    instalarPermissions({
      query: () => {
        throw new TypeError("geolocation no soportado");
      },
    });

    await expect(leerPermisoUbicacion()).resolves.toBe("desconocido");
  });

  it("un estado que no conoce no se traduce a la fuerza", async () => {
    instalarPermissions({ query: vi.fn().mockResolvedValue({ state: "raro" }) });

    await expect(leerPermisoUbicacion()).resolves.toBe("desconocido");
  });
});

describe("avisoUbicacionDenegada — app instalada", () => {
  it.each<PermisoUbicacion>(["denegado", "concedido", "desconocido"])(
    "con el permiso %s manda a los Ajustes del teléfono, paso por paso",
    (permiso) => {
      const aviso = avisoUbicacionDenegada("app_instalada", permiso);

      expect(aviso.resumen).toBe(RESUMEN_APP_INSTALADA);
      expect(aviso.titulo).toBe("Activá la ubicación desde los Ajustes del teléfono");
      expect(aviso.pasos).toEqual([
        "Abrí los Ajustes del teléfono (en algunos se llama Configuración).",
        "Entrá en Aplicaciones y buscá Ordenex.",
        "Tocá Permisos y después Ubicación.",
        "Elegí «Permitir solo mientras usás la app» y dejá activado «Usar ubicación precisa».",
        "Volvé a Ordenex y tocá «Guardar gestión» otra vez.",
      ]);
    },
  );

  it("NO nombra el candado ni la barra de direcciones: ahí no existen", () => {
    const aviso = avisoUbicacionDenegada("app_instalada", "denegado");

    expect(todoElTexto(aviso)).not.toMatch(/candado/i);
    expect(todoElTexto(aviso)).not.toMatch(/barra de direcciones/i);
  });
});

describe("avisoUbicacionDenegada — navegador", () => {
  it.each<PermisoUbicacion>(["denegado", "desconocido"])(
    "con el permiso %s manda al candado, que ahí sí existe",
    (permiso) => {
      const aviso = avisoUbicacionDenegada("navegador", permiso);

      expect(aviso.resumen).toBe(RESUMEN_NAVEGADOR);
      expect(aviso.titulo).toBe("Activá la ubicación para este sitio");
      expect(aviso.pasos).toEqual([
        "Tocá el candado que está al lado de la dirección web, arriba.",
        "Entrá en Permisos del sitio y activá Ubicación.",
        "Volvé acá y tocá «Guardar gestión» otra vez.",
      ]);
    },
  );

  it("cubre el navegador embebido de WhatsApp sin fingir que lo detecta", () => {
    const aviso = avisoUbicacionDenegada("navegador", "denegado");

    expect(aviso.nota).toBe(
      "Si abriste Ordenex desde un enlace de WhatsApp y no ves el candado, tocá los tres puntos y elegí «Abrir en Chrome».",
    );
  });

  it("NO manda a los Ajustes del teléfono cuando el bloqueo es del sitio", () => {
    const aviso = avisoUbicacionDenegada("navegador", "denegado");

    expect(todoElTexto(aviso)).not.toMatch(/ajustes/i);
    expect(todoElTexto(aviso)).not.toMatch(/aplicaciones/i);
  });

  it("con el sitio YA concedido, el bloqueo viene del teléfono y allí se manda", () => {
    const aviso = avisoUbicacionDenegada("navegador", "concedido");

    expect(aviso.resumen).toBe(RESUMEN_SIN_PERMISO_DEL_TELEFONO);
    expect(aviso.titulo).toBe("El permiso lo tiene que dar el teléfono");
    expect(aviso.pasos).toEqual([
      "Abrí los Ajustes del teléfono (en algunos se llama Configuración).",
      "Entrá en Aplicaciones y buscá el navegador que estás usando: Chrome, Samsung Internet…",
      "Tocá Permisos y después Ubicación.",
      "Elegí «Permitir solo mientras usás la app» y dejá activado «Usar ubicación precisa».",
      "Volvé acá y tocá «Guardar gestión» otra vez.",
    ]);
    // Mandarla al candado seria mandarla a un interruptor que ya esta encendido.
    expect(todoElTexto(aviso)).not.toMatch(/candado/i);
  });
});

describe("avisoUbicacionDenegada — el aviso que nunca se contestó", () => {
  it.each(["app_instalada", "navegador"] as const)(
    "en %s pide reintentar y tocar Permitir, sin mandar a ningún ajuste",
    (contexto) => {
      const aviso = avisoUbicacionDenegada(contexto, "sin_decidir");

      expect(aviso.resumen).toBe(RESUMEN_SIN_DECIDIR);
      expect(aviso.titulo).toBe("Falta que aceptes el aviso de ubicación");
      expect(aviso.pasos).toEqual([
        "Tocá «Guardar gestión» otra vez.",
        "Cuando el teléfono te pregunte por la ubicación, elegí «Permitir».",
      ]);
    },
  );

  it("la salida por si el aviso no llega a salir SÍ depende del contexto", () => {
    expect(avisoUbicacionDenegada("app_instalada", "sin_decidir").nota).toBe(
      "Si no te sale ningún aviso, activá la ubicación en los Ajustes del teléfono: Aplicaciones → Ordenex → Permisos → Ubicación.",
    );
    expect(avisoUbicacionDenegada("navegador", "sin_decidir").nota).toBe(
      "Si no te sale ningún aviso, tocá el candado que está al lado de la dirección web y activá Ubicación.",
    );
  });
});
