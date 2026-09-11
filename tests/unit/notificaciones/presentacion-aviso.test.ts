import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { presentacionDe, etiquetaDeAtajo } from "@/lib/notificaciones/presentacion-aviso";

// FICHA 409 — LA PUERTA PREVIA DE LA FICHA 410 (el push al telefono).
//
// `presentacionDe(fila) -> { titulo, cuerpo, destino } | null` es una funcion PURA invocable DESDE
// EL SERVIDOR: sin sesion, sin DTO, sin React y sin Actor. El push se compone en el DRENADOR DE LA
// COLA, donde no hay ninguna de esas cosas — solo una fila de `notificacion` y el rol de quien la
// va a leer. Si esta composicion viviera SOLO dentro del mapeador a DTO de
// `NotificacionService.listar`, la 410 tendria que reimplementarla, y dos implementaciones del
// mismo texto es como la campana y el push acaban diciendo cosas distintas del mismo hecho.
//
// Los literales van ESCRITOS A MANO.

const ROOT = path.resolve(__dirname, "..", "..", "..");

describe("un aviso normal se presenta con lo que la fila ya trae persistido", () => {
  it("titulo = descripcion, cuerpo = anexo, destino = el atajo del par (evento, rol)", () => {
    expect(
      presentacionDe({
        evento: "cierre_dia_por_aprobar",
        descripcion: "Un mensajero envió su cierre del día para aprobación.",
        anexo: null,
        rolLector: "admin",
      }),
    ).toEqual({
      titulo: "Un mensajero envió su cierre del día para aprobación.",
      cuerpo: null,
      destino: "/cierres-admin",
    });
  });

  it("el anexo es el cuerpo, sin la palabra «Anexo:»", () => {
    const p = presentacionDe({
      evento: "orden_rechazada",
      descripcion: "Una orden fue rechazada por el destinatario.",
      anexo: "41270372",
      rolLector: "adminTienda",
    });

    expect(p?.cuerpo).toBe("41270372");
    expect(`${p?.titulo} ${p?.cuerpo}`).not.toContain("Anexo:");
  });

  it("un informativo NO tiene destino", () => {
    expect(
      presentacionDe({
        evento: "cierre_dia_vencido",
        descripcion: "Un cierre del día quedó vencido.",
        anexo: null,
        rolLector: "adminSatelite",
      })?.destino,
    ).toBeNull();
  });

  it("el UNICO accionable sin pantalla tampoco tiene destino, y sigue presentandose", () => {
    const p = presentacionDe({
      evento: "geocodificacion_caida",
      descripcion: "El servicio de mapas está rechazando nuestras peticiones.",
      anexo: null,
      rolLector: "maestro",
    });

    expect(p).not.toBeNull();
    expect(p?.destino).toBeNull();
  });

  it("el rol del LECTOR decide, no la columna `destinatario_rol` de la fila", () => {
    // `cierre_dia_vencido` le llega al mensajero como fila dirigida A USUARIO: su
    // `destinatario_rol` es NULL, y es para el para quien ese aviso es accionable.
    const paraElMensajero = presentacionDe({
      evento: "cierre_dia_vencido",
      descripcion: "Tu cierre del lunes quedó vencido.",
      anexo: null,
      rolLector: "mensajero",
    });

    expect(paraElMensajero?.destino).toBe("/cierre-dia");
  });
});

describe("un aviso AGREGADO se presenta con su cifra VIVA — o no se presenta", () => {
  it("cifra > 0: el titulo lleva ESA cifra y el cuerpo es la linea persistida", () => {
    expect(
      presentacionDe({
        evento: "novedades_sin_gestionar",
        descripcion: "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
        anexo: null,
        rolLector: "adminTienda",
        cifraViva: 5,
      }),
    ).toEqual({
      titulo: "5 novedades esperan tu decisión",
      cuerpo: "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
      destino: "/novedades?superficie=devolucion",
    });
  });

  it("cifra 0: devuelve `null` — no hay nada que pintar y nada que empujar (R55)", () => {
    expect(
      presentacionDe({
        evento: "novedades_sin_gestionar",
        descripcion: "La más antigua lleva 3 días en bodega.",
        anexo: null,
        rolLector: "adminTienda",
        cifraViva: 0,
      }),
    ).toBeNull();
  });

  it("cifra `null` (no se pudo resolver): SE PRESENTA igual, sin numero (R58)", () => {
    const p = presentacionDe({
      evento: "devoluciones_represadas",
      descripcion: "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
      anexo: null,
      rolLector: "maestro",
      cifraViva: null,
    });

    expect(p).not.toBeNull();
    expect(p?.titulo).toBe("La más antigua lleva 8 días en bodega. Coordiná la devolución.");
    expect(p?.destino).toBe("/ordenes");
  });

  it("el mismo agregado lleva DOS destinos segun quien lo lea", () => {
    const central = presentacionDe({
      evento: "devoluciones_represadas",
      descripcion: "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
      anexo: null,
      rolLector: "admin",
      cifraViva: 7,
    });
    const satelite = presentacionDe({
      evento: "devoluciones_represadas",
      descripcion: "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
      anexo: null,
      rolLector: "adminSatelite",
      cifraViva: 4,
    });

    expect(central?.destino).toBe("/ordenes");
    expect(central?.titulo).toBe("7 órdenes esperan volver a su tienda");
    expect(satelite?.destino).toBe("/recepcion-satelite/en-bodega");
    expect(satelite?.titulo).toBe("4 órdenes esperan volver a su tienda");
  });
});

describe("`etiquetaDeAtajo` da el nombre accesible del boton", () => {
  it("propio y descriptivo, nunca «Ver»", () => {
    expect(etiquetaDeAtajo("novedades_sin_gestionar", "adminTienda")).toBe("Gestionar novedades");
    expect(etiquetaDeAtajo("devoluciones_represadas", "adminSatelite")).toBe("Enviar a central");
    expect(etiquetaDeAtajo("devoluciones_represadas", "maestro")).toBe("Ver devoluciones");
    expect(etiquetaDeAtajo("geocodificacion_caida", "maestro")).toBeNull();
    expect(etiquetaDeAtajo("orden_rechazada", "admin")).toBeNull();
  });
});

describe("es un modulo PURO: la 410 puede importarlo desde el drenador", () => {
  it("no importa React, ni next/*, ni Prisma en runtime, ni la capa de datos", () => {
    const fuente = fs.readFileSync(
      path.join(ROOT, "lib", "notificaciones", "presentacion-aviso.ts"),
      "utf8",
    );
    const imports = fuente
      .split("\n")
      .filter((l) => l.trim().startsWith("import "))
      .join("\n");

    expect(imports).not.toMatch(/from\s+["']react["']/);
    expect(imports).not.toMatch(/from\s+["']next\//);
    expect(imports).not.toMatch(/@\/lib\/db/);
    expect(imports).not.toMatch(/@\/lib\/repositories/);
    expect(imports).not.toMatch(/@\/lib\/services/);
    // El unico `@prisma/client` admisible es un `import type` (se borra al compilar).
    for (const linea of imports.split("\n")) {
      if (linea.includes("@prisma/client")) expect(linea.trim().startsWith("import type")).toBe(true);
    }
    // Y no lee el reloj: el instante relativo no es cosa suya.
    expect(fuente).not.toContain("Date.now(");
    expect(fuente).not.toContain("new Date(");
  });

  it("y el servicio de la campana lo USA, en vez de tener su propia copia", () => {
    const fuente = fs.readFileSync(
      path.join(ROOT, "lib", "services", "NotificacionService.ts"),
      "utf8",
    );
    expect(fuente).toContain("presentacionDe(");
  });
});
