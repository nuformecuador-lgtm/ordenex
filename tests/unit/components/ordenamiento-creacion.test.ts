import { describe, it, expect } from "vitest";

import {
  CAMPO_ORDEN_CREACION,
  DIRECCION_ORDEN_INICIAL,
  OPCIONES_ORDEN_CREACION,
  ordenamientoCreacion,
} from "@/app/(app)/ordenes/_components/ordenamiento-creacion";
import { listarOrdenesSchema, SORT_FIELDS } from "@/lib/types/orden";
import { DIRECCIONES_ORDEN } from "@/lib/types/ordenamiento-listado";

// FICHA 356 — el control declarado en la PANTALLA contra el contrato del SERVIDOR.
//
// Son dos fuentes independientes a propósito: la pantalla escribe sus literales y el servidor
// los suyos (`listarOrdenesSchema`). Derivar los de aquí de los de allí dejaría este archivo
// comparándose consigo mismo — siempre verde, incapaz de avisar de nada.

describe("ordenamiento-creacion — arranque alineado con el contrato", () => {
  it("la dirección inicial de la pantalla ES el default del servidor", () => {
    // Si alguien cambia el default del listado y no este literal, la barra diría «Más
    // recientes» mientras el servidor devuelve lo contrario: el control mentiría desde el
    // primer render, sin que ninguna consulta fallara.
    const porDefecto = listarOrdenesSchema.parse({});
    expect(DIRECCION_ORDEN_INICIAL).toBe(porDefecto.sortDir);
    expect(CAMPO_ORDEN_CREACION).toBe(porDefecto.sortBy);
  });

  it("el campo ordenado está en la lista blanca del servidor", () => {
    // Un `sortBy` fuera de la lista es `validation_error`, o sea la tabla entera en error.
    expect(SORT_FIELDS).toContain(CAMPO_ORDEN_CREACION);
  });

  it("el ordenamiento emitido es exactamente lo que el schema admite", () => {
    for (const dir of DIRECCIONES_ORDEN) {
      const emitido = ordenamientoCreacion(dir);
      expect(emitido).toEqual({ sortBy: "created_at", sortDir: dir });
      // `.strict()`: una clave de más aquí sería `validation_error` en el borde.
      expect(() =>
        listarOrdenesSchema.parse({ page: 1, pageSize: 25, ...emitido }),
      ).not.toThrow();
    }
  });
});

describe("ordenamiento-creacion — las dos opciones ofrecidas", () => {
  it("ofrece las DOS direcciones del contrato y ninguna más", () => {
    expect(OPCIONES_ORDEN_CREACION.map((o) => o.valor).sort()).toEqual(
      [...DIRECCIONES_ORDEN].sort(),
    );
  });

  it("la opción por defecto es la primera: el control abre en lo que se está viendo", () => {
    expect(OPCIONES_ORDEN_CREACION[0]?.valor).toBe(DIRECCION_ORDEN_INICIAL);
  });

  it("cada opción dice en PALABRAS qué hace, no sólo con una flecha", () => {
    // Un conmutador cuyo texto fuera `asc`/`desc` obliga a traducir vocabulario del servidor;
    // uno con sólo iconos obliga a pulsarlo para averiguar qué hace.
    for (const opcion of OPCIONES_ORDEN_CREACION) {
      expect(opcion.etiqueta.trim().length).toBeGreaterThan(3);
      expect(opcion.etiqueta).not.toMatch(/^(asc|desc)$/i);
    }
    expect(new Set(OPCIONES_ORDEN_CREACION.map((o) => o.etiqueta)).size).toBe(
      OPCIONES_ORDEN_CREACION.length,
    );
  });
});
