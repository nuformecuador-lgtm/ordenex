// Mensajes de validación de zod en español claro, para toda la app.
//
// Tres cosas distintas, y las tres hacen falta:
//   1. el mapa dice lo que tiene que decir (textos literales: SON el contrato con el usuario);
//   2. los schemas reales de Envíos automáticos y Plantillas usan su mensaje propio por campo;
//   3. los DOS puntos de entrada de la app LO CARGAN —`instrumentation.ts` en el servidor y el
//      layout raíz en el cliente—, no solo que el módulo exista. Para eso cada caso vuelve antes
//      zod al inglés (el setup de la suite ya lo había puesto en español) y comprueba que es ESE
//      punto de entrada el que lo devuelve al español.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";

import { guardarEnvioSchema } from "@/lib/types/envios-whatsapp";
import { crearPlantillaSchema, previewPlantillaSchema } from "@/lib/types/plantilla-mensaje";

function primerMensaje(schema: z.ZodType, valor: unknown): string {
  const r = schema.safeParse(valor);
  if (r.success) throw new Error("se esperaba un rechazo");
  return r.error.issues[0].message;
}

function erroresDe(schema: z.ZodType, valor: unknown): Record<string, string[] | undefined> {
  const r = schema.safeParse(valor);
  if (r.success) throw new Error("se esperaba un rechazo");
  return z.flattenError(r.error).fieldErrors as Record<string, string[] | undefined>;
}

/** Devuelve zod a sus mensajes de fábrica (inglés), como si nadie lo hubiera configurado. */
function zodEnIngles(): void {
  z.config(z.locales.en());
  expect(primerMensaje(z.string().min(1), "")).toMatch(/Too small/);
}

afterEach(async () => {
  // Deja la suite como la encontró el setup: en español.
  vi.resetModules();
  vi.doUnmock("next/font/google");
  vi.doUnmock("next/script");
  const { configurarZodEnEspanol } = await import("@/lib/validacion/zod-es");
  configurarZodEnEspanol();
});

describe("mapa de mensajes por defecto", () => {
  it("obligatorio: vacío, ausente o nulo", () => {
    expect(primerMensaje(z.string().min(1), "")).toBe("Este campo es obligatorio");
    expect(primerMensaje(z.object({ a: z.string() }), {})).toBe("Este campo es obligatorio");
    expect(primerMensaje(z.number(), null)).toBe("Este campo es obligatorio");
  });

  it("longitud de texto", () => {
    expect(primerMensaje(z.string().min(3), "ab")).toBe("Debe tener al menos 3 caracteres");
    expect(primerMensaje(z.string().max(5), "abcdefg")).toBe("No puede tener más de 5 caracteres");
  });

  it("rango de números", () => {
    expect(primerMensaje(z.number().min(2), 1)).toBe("Debe ser como mínimo 2");
    expect(primerMensaje(z.number().max(10), 11)).toBe("Debe ser como máximo 10");
    expect(primerMensaje(z.number().positive(), 0)).toBe("Debe ser mayor que 0");
    expect(primerMensaje(z.number().int(), 1.5)).toBe("Debe ser un número entero");
    expect(primerMensaje(z.number(), "x")).toBe("Debe ser un número");
  });

  it("listas", () => {
    expect(primerMensaje(z.array(z.string()).min(1), [])).toBe("Elige al menos una opción");
    expect(primerMensaje(z.array(z.string()).min(2), ["a"])).toBe("Elige al menos 2 opciones");
    expect(primerMensaje(z.array(z.string()).max(1), ["a", "b"])).toBe("Puedes elegir como máximo una opción");
  });

  it("formato, opción y tipo", () => {
    expect(primerMensaje(z.email(), "no-es-correo")).toBe("Escribe un correo válido");
    expect(primerMensaje(z.uuid(), "123")).toBe("El formato no es válido");
    expect(primerMensaje(z.string().regex(/^\d+$/), "abc")).toBe("El formato no es válido");
    expect(primerMensaje(z.enum(["a", "b"]), "c")).toBe("Elige una opción válida");
    expect(primerMensaje(z.string(), 42)).toBe("El valor no es válido");
  });

  it("un mensaje propio del schema manda sobre el genérico", () => {
    expect(primerMensaje(z.string().min(1, "Escribe tu nombre"), "")).toBe("Escribe tu nombre");
  });
});

describe("mensajes propios: Envíos automáticos (474)", () => {
  const valido = {
    nombre: "Prueba diaria",
    informeClave: "prueba_envio",
    plantillaId: "p1",
    parametros: {},
    disparo: "hora_fija",
    diasSemana: [1],
    hora: "05:00",
    eventoClave: null,
    destinatarios: { roles: ["maestro"], usuarioIds: [] },
  };

  it("el schema de referencia es válido (si no, los casos de abajo no medirían nada)", () => {
    expect(guardarEnvioSchema.safeParse(valido).success).toBe(true);
  });

  it("cada campo dice qué hacer", () => {
    const e = erroresDe(guardarEnvioSchema, {
      ...valido,
      nombre: "   ",
      informeClave: "",
      plantillaId: "",
      disparo: "nunca",
      diasSemana: [0],
      hora: "5 am",
      eventoClave: "",
      destinatarios: { roles: ["cliente"], usuarioIds: [""] },
    });
    expect(e.nombre).toEqual(["Escribe un nombre para el envío"]);
    expect(e.informeClave).toEqual(["Elige un informe"]);
    expect(e.plantillaId).toEqual(["Elige una plantilla"]);
    expect(e.disparo).toEqual(["Elige cuándo se manda"]);
    expect(e.diasSemana).toEqual(["Elige días de lunes a domingo"]);
    expect(e.hora).toEqual(["Escribe la hora en formato 24 h, por ejemplo 05:00"]);
    expect(e.eventoClave).toEqual(["Elige un evento"]);
    expect(e.destinatarios).toEqual(["Ese rol no puede recibir envíos", "Elige una persona de la lista"]);
  });

  it("campos ausentes: el mismo mensaje propio, no el genérico", () => {
    const e = erroresDe(guardarEnvioSchema, { parametros: {}, destinatarios: { roles: [], usuarioIds: [] } });
    expect(e.nombre).toEqual(["Escribe un nombre para el envío"]);
    expect(e.informeClave).toEqual(["Elige un informe"]);
    expect(e.plantillaId).toEqual(["Elige una plantilla"]);
    expect(e.disparo).toEqual(["Elige cuándo se manda"]);
  });

  it("nombre demasiado largo", () => {
    expect(erroresDe(guardarEnvioSchema, { ...valido, nombre: "x".repeat(121) }).nombre).toEqual([
      "El nombre no puede tener más de 120 caracteres",
    ]);
  });
});

describe("mensajes propios: Plantillas", () => {
  it("nombre, cuerpo e informe", () => {
    const e = erroresDe(crearPlantillaSchema, { nombre: "", cuerpo: "", informeClave: "Con Espacios" });
    expect(e.nombre).toEqual(["Escribe un nombre para la plantilla"]);
    expect(e.cuerpo).toEqual(["Escribe el texto del mensaje"]);
    expect(e.informeClave).toEqual(["Elige un informe"]);
    expect(primerMensaje(previewPlantillaSchema, "")).toBe("Escribe el texto del mensaje");
  });
});

describe("los puntos de entrada de la app LO CARGAN", () => {
  it("servidor: `register()` de instrumentation.ts deja zod en español", async () => {
    zodEnIngles();
    vi.resetModules();
    const { register } = await import("@/instrumentation");
    await register();
    expect(primerMensaje(z.string().min(1), "")).toBe("Este campo es obligatorio");
  });

  it("cliente: importar el componente del layout deja zod en español", async () => {
    zodEnIngles();
    vi.resetModules();
    await import("@/components/shared/ZodEnEspanol");
    expect(primerMensaje(z.string().min(1), "")).toBe("Este campo es obligatorio");
  });

  it("cliente: el layout raíz importa y PINTA ese componente", async () => {
    // Importarlo no basta para el navegador: un componente cliente importado y NO pintado no
    // entra en el bundle de la página. Por eso se espía que el layout lo renderice.
    vi.resetModules();
    vi.doMock("next/font/google", () => ({
      Poppins: () => ({ variable: "font-sans" }),
      JetBrains_Mono: () => ({ variable: "font-mono" }),
    }));
    vi.doMock("next/script", () => ({ default: () => null }));
    const pintado = vi.fn(() => null);
    vi.doMock("@/components/shared/ZodEnEspanol", () => ({ ZodEnEspanol: pintado }));
    const { default: RootLayout } = await import("@/app/layout");

    renderToStaticMarkup(RootLayout({ children: null }));

    expect(pintado).toHaveBeenCalled();
    vi.doUnmock("@/components/shared/ZodEnEspanol");
  });
});
