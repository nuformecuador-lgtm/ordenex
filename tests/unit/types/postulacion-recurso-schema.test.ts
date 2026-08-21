import { describe, it, expect } from "vitest";
import {
  RECURSO_TIPOS,
  listarPostulacionesRecursoSchema,
  postulacionRecursoIdSchema,
  postulacionRecursoSchema,
} from "@/lib/types/postulacion-recurso";
import { postulacionRecursoConfig } from "@/lib/config/postulacion-recurso";

// Feature 253 (T2.1) — el borde de entrada de la postulacion de recurso. Cubre R8-R13, R15 y la
// parte de R20 que vive en el schema (recorte y minusculas).
//
// POR QUE ESTE ARCHIVO EXISTE APARTE del test de la accion: el schema es lo UNICO que comparten
// cliente y servidor (R14). Si se prueba solo a traves de la accion, la mitad del contrato queda
// medida de refilon y un cambio de mensaje pasa sin que nadie lo vea.

function entradaValida(overrides: Record<string, unknown> = {}) {
  return {
    tipo: "vehiculo",
    nombre: "Ana Solis",
    telefono: "+506 8888-8888",
    correo: "Ana.Solis@Example.COM",
    mensaje: "Tengo un camion de 3 toneladas en Heredia, disponible entre semana.",
    ...overrides,
  };
}

type CampoDelSchema = "tipo" | "nombre" | "telefono" | "correo" | "mensaje";

/** Primer mensaje de error del campo, o `null` si el campo no fallo. */
function errorDe(
  resultado: ReturnType<typeof postulacionRecursoSchema.safeParse>,
  campo: CampoDelSchema,
): string | null {
  if (resultado.success) return null;
  return resultado.error.flatten().fieldErrors[campo]?.[0] ?? null;
}

describe("253 / R8 — se aceptan exactamente cinco campos, y `tipo` es uno de dos", () => {
  it("acepta una postulacion completa y devuelve los cinco campos", () => {
    const r = postulacionRecursoSchema.safeParse(entradaValida());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(Object.keys(r.data).sort()).toEqual([
      "correo",
      "mensaje",
      "nombre",
      "telefono",
      "tipo",
    ]);
  });

  it("acepta los DOS tipos del catalogo y ninguno mas", () => {
    expect(RECURSO_TIPOS).toEqual(["vehiculo", "bodega"]);
    for (const tipo of RECURSO_TIPOS) {
      expect(postulacionRecursoSchema.safeParse(entradaValida({ tipo })).success).toBe(true);
    }
  });

  it("un campo EXTRA no viaja al resultado (no se puede colar una columna por el borde)", () => {
    const r = postulacionRecursoSchema.safeParse(
      entradaValida({ atendidaPorId: "usr-1", id: "pr-1" }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty("atendidaPorId");
    expect(r.data).not.toHaveProperty("id");
  });
});

describe("253 / R9 — un `tipo` inventado se rechaza", () => {
  it.each(["camion", "", "VEHICULO", null, 3])("rechaza tipo = %p", (tipo) => {
    const r = postulacionRecursoSchema.safeParse(entradaValida({ tipo }));
    expect(r.success).toBe(false);
    expect(errorDe(r, "tipo")).not.toBeNull();
  });
});

describe("253 / R10-R13 — cada campo falla EN SU CAMPO, con el texto que la landing ya muestra", () => {
  it("R10: nombre vacio tras recortar -> «Escribí tu nombre»", () => {
    const r = postulacionRecursoSchema.safeParse(entradaValida({ nombre: "   " }));
    expect(errorDe(r, "nombre")).toBe("Escribí tu nombre");
  });

  it("R11: telefono de menos de 7 caracteres tras recortar -> «Escribí un teléfono de contacto»", () => {
    const r = postulacionRecursoSchema.safeParse(entradaValida({ telefono: "  888  " }));
    expect(errorDe(r, "telefono")).toBe("Escribí un teléfono de contacto");
  });

  it("R11/D2: un telefono con espacios, `+` y guiones SIGUE siendo valido (no se endurecio a digitos)", () => {
    const r = postulacionRecursoSchema.safeParse(entradaValida({ telefono: "+506 8888-8888" }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.telefono).toBe("+506 8888-8888");
  });

  it("R12: correo sin formato -> «Escribí un correo válido»", () => {
    const r = postulacionRecursoSchema.safeParse(entradaValida({ correo: "ana(arroba)ejemplo" }));
    expect(errorDe(r, "correo")).toBe("Escribí un correo válido");
  });

  it("R13: mensaje vacio tras recortar -> «Contanos brevemente qué tenés»", () => {
    const r = postulacionRecursoSchema.safeParse(entradaValida({ mensaje: "\n\t  " }));
    expect(errorDe(r, "mensaje")).toBe("Contanos brevemente qué tenés");
  });
});

describe("253 / R13 + D3 — los topes de longitud existen y estan donde dice la config", () => {
  it("el mensaje de exactamente MENSAJE_MAX_CHARS pasa; uno mas, no", () => {
    const max = postulacionRecursoConfig.MENSAJE_MAX_CHARS;
    expect(postulacionRecursoSchema.safeParse(entradaValida({ mensaje: "m".repeat(max) })).success).toBe(
      true,
    );
    const r = postulacionRecursoSchema.safeParse(entradaValida({ mensaje: "m".repeat(max + 1) }));
    expect(r.success).toBe(false);
    expect(errorDe(r, "mensaje")).toContain(String(max));
  });

  it("D3 quedo firmada en 1.000 caracteres (si alguien la mueve, que sea a sabiendas)", () => {
    // Literal a proposito: es el numero FIRMADO, no una derivacion de la constante que lo
    // produce. Una asercion contra su propia fuente siempre esta verde.
    expect(postulacionRecursoConfig.MENSAJE_MAX_CHARS).toBe(1000);
  });

  it("nombre, telefono y correo tambien estan topados", () => {
    const r1 = postulacionRecursoSchema.safeParse(
      entradaValida({ nombre: "n".repeat(postulacionRecursoConfig.NOMBRE_MAX_CHARS + 1) }),
    );
    expect(errorDe(r1, "nombre")).not.toBeNull();

    const r2 = postulacionRecursoSchema.safeParse(
      entradaValida({ telefono: "8".repeat(postulacionRecursoConfig.TELEFONO_MAX_CHARS + 1) }),
    );
    expect(errorDe(r2, "telefono")).not.toBeNull();

    const largo = "a".repeat(postulacionRecursoConfig.CORREO_MAX_CHARS) + "@ejemplo.com";
    const r3 = postulacionRecursoSchema.safeParse(entradaValida({ correo: largo }));
    expect(errorDe(r3, "correo")).not.toBeNull();
  });
});

describe("253 / R20 — lo que sale del schema esta NORMALIZADO", () => {
  it("el correo sale recortado y en MINUSCULAS (R12)", () => {
    const r = postulacionRecursoSchema.safeParse(
      entradaValida({ correo: "   Ana.Solis@Example.COM  " }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.correo).toBe("ana.solis@example.com");
  });

  it("nombre, telefono y mensaje salen recortados (y NO en minusculas: son texto de la persona)", () => {
    const r = postulacionRecursoSchema.safeParse(
      entradaValida({ nombre: "  Ana Solis  ", telefono: "  88888888  ", mensaje: "  Camión  " }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.nombre).toBe("Ana Solis");
    expect(r.data.telefono).toBe("88888888");
    expect(r.data.mensaje).toBe("Camión");
  });
});

describe("253 / R15 — los errores llegan por campo, y varios a la vez", () => {
  it("tres campos malos producen tres claves en fieldErrors", () => {
    const r = postulacionRecursoSchema.safeParse({
      tipo: "bodega",
      nombre: "",
      telefono: "1",
      correo: "no-es-correo",
      mensaje: "algo que si vale",
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(Object.keys(r.error.flatten().fieldErrors).sort()).toEqual([
      "correo",
      "nombre",
      "telefono",
    ]);
  });
});

describe("253 / R30 — el schema del listado del admin acota la pagina", () => {
  it("sin entrada, pendientes y la pagina por defecto", () => {
    const data = listarPostulacionesRecursoSchema.parse({});
    expect(data.atendidas).toBe(false);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(postulacionRecursoConfig.PAGE_SIZE_DEFAULT);
  });

  it("un pageSize desmedido se acota a PAGE_SIZE_MAX (no se pide la tabla entera)", () => {
    const data = listarPostulacionesRecursoSchema.parse({ pageSize: 100_000 });
    expect(data.pageSize).toBe(postulacionRecursoConfig.PAGE_SIZE_MAX);
  });

  it("R33: `atendidas: true` es una entrada valida (la segunda pestana existe)", () => {
    expect(listarPostulacionesRecursoSchema.parse({ atendidas: true }).atendidas).toBe(true);
  });

  it("page 0 o negativa se rechazan", () => {
    expect(listarPostulacionesRecursoSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listarPostulacionesRecursoSchema.safeParse({ page: -3 }).success).toBe(false);
  });

  it("el id del admin no puede ser vacio", () => {
    expect(postulacionRecursoIdSchema.safeParse("").success).toBe(false);
    expect(postulacionRecursoIdSchema.safeParse("pr-1").success).toBe(true);
  });
});
