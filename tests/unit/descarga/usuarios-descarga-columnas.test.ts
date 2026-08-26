import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_USUARIOS,
  filaDescargaUsuario,
} from "@/app/(app)/configuracion/_components/usuarios-descarga-columnas";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import { SIN_ZONA } from "@/app/(app)/configuracion/_components/usuario-estado-label";

// Feature 170 / T B.3 (R5/R6/R7/R8/R23/R24) — columnas de export del listado de usuarios.

const USUARIO: UsuarioListItemDTO = {
  id: "3f2b1a6c-5d4e-4f8a-9b0c-1d2e3f4a5b6c",
  nombre: "Ana Torres",
  email: "ana@example.com",
  rolValue: "adminTienda",
  estado: "inactivo",
  zonaNombre: "GAM",
  createdAt: new Date("2026-03-15T18:30:00.000Z"),
};

describe("columnas de descarga de usuarios", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_USUARIOS.map((c) => c.clave)).toEqual([
      "nombre",
      "email",
      "rol",
      "estado",
      "zona",
    ]);
    expect(COLUMNAS_DESCARGA_USUARIOS.map((c) => c.encabezado)).toEqual([
      "Nombre",
      "Email",
      "Rol",
      "Estado",
      "Zona",
    ]);
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos (R7)", () => {
    for (const [clave, celda] of Object.entries(filaDescargaUsuario(USUARIO))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("emite el rol y el estado como ETIQUETA LEGIBLE, no como valor interno (R8)", () => {
    const fila = filaDescargaUsuario(USUARIO);
    expect(fila.rol).toBe("Admin de tienda");
    expect(fila.estado).toBe("Inactivo");
    // Y NO el valor del enum, que es lo que se leería si alguien "simplificara" el módulo.
    expect(fila.rol).not.toBe("adminTienda");
    expect(fila.estado).not.toBe("inactivo");
  });

  // Pedido humano (2026-08-26): la zona entra en el archivo A LA VEZ que en la tabla (R24: el
  // export enseña lo que la pantalla enseña) y con el MISMO guion, no con una celda vacía: en una
  // hoja de cálculo el vacío se lee como dato perdido, y «sin zona» es lo normal.
  it("2026-08-26: emite la zona, y el mismo «-» que la tabla cuando no hay", () => {
    expect(filaDescargaUsuario(USUARIO).zona).toBe("GAM");
    expect(filaDescargaUsuario({ ...USUARIO, zonaNombre: null }).zona).toBe(SIN_ZONA);
  });

  it("no expone identificadores internos (R23)", () => {
    const fila = filaDescargaUsuario(USUARIO);
    expect(fila).not.toHaveProperty("id");
    expect(Object.values(fila)).not.toContain(USUARIO.id);
    // Ninguna celda con forma de uuid, venga de donde venga.
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }
  });

  it("no emite campos que el listado no muestra en pantalla (R24)", () => {
    const fila = filaDescargaUsuario(USUARIO);
    // `createdAt` VIENE en el DTO pero la tabla no lo pinta: no sale.
    expect(fila).not.toHaveProperty("createdAt");
    expect(fila).not.toHaveProperty("fechaCreacion");
    // Y las claves de la fila son EXACTAMENTE las columnas declaradas, ni una más.
    expect(Object.keys(fila).sort()).toEqual(
      COLUMNAS_DESCARGA_USUARIOS.map((c) => c.clave).sort(),
    );
  });

  it("un campo nuevo del DTO no aparece en el archivo hasta declararlo (R6)", () => {
    // El DTO crece (aquí, con un campo que NO debe publicarse jamás). La fila no cambia:
    // las columnas se enumeran a mano, no se derivan del objeto.
    const conCampoNuevo = {
      ...USUARIO,
      passwordHash: "$2b$10$loQueNuncaDebeSalir",
      telefono: "88880000",
    } as UsuarioListItemDTO;

    const fila = filaDescargaUsuario(conCampoNuevo);
    expect(Object.keys(fila).sort()).toEqual(
      COLUMNAS_DESCARGA_USUARIOS.map((c) => c.clave).sort(),
    );
    expect(Object.values(fila)).not.toContain("$2b$10$loQueNuncaDebeSalir");
    expect(Object.values(fila)).not.toContain("88880000");
  });
});
