import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";
import { predicadoVisibilidad } from "@/lib/repositories/NotificacionRepository";
import type { NotificacionActor } from "@/lib/interfaces/repositories/INotificacionRepository";

// Feature 146 — B7. Tests del ALCANCE (R13-R17) contra el PREDICADO REAL. No se
// re-implementa la regla: se toma el `where` que produce `predicadoVisibilidad` (la fuente
// unica, design §1.5) y se evalua contra filas en memoria con un interprete generico del
// subconjunto de Prisma que el predicado usa (OR / AND / igualdad escalar). Si alguien
// cambia el predicado, estos tests lo notan.

interface FilaNotificacion {
  destinatarioUsuarioId: string | null;
  destinatarioRol: RolValue | null;
  tiendaId: string | null;
  zonaId: string | null;
}

/** Interprete generico de `Prisma.NotificacionWhereInput` limitado a OR/AND/igualdad. */
function casa(fila: FilaNotificacion, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    if (clave === "OR") {
      return (valor as Record<string, unknown>[]).some((w) => casa(fila, w));
    }
    if (clave === "AND") {
      return (valor as Record<string, unknown>[]).every((w) => casa(fila, w));
    }
    return (fila as unknown as Record<string, unknown>)[clave] === valor;
  });
}

function ve(actor: NotificacionActor, fila: Partial<FilaNotificacion>): boolean {
  const completa: FilaNotificacion = {
    destinatarioUsuarioId: null,
    destinatarioRol: null,
    tiendaId: null,
    zonaId: null,
    ...fila,
  };
  return casa(completa, predicadoVisibilidad(actor) as Record<string, unknown>);
}

const MAESTRO_A: NotificacionActor = { usuarioId: "u-maestro-a", rol: "maestro", zonaId: null };
const MAESTRO_B: NotificacionActor = { usuarioId: "u-maestro-b", rol: "maestro", zonaId: null };
const TIENDA_1: NotificacionActor = { usuarioId: "tienda-1", rol: "adminTienda", zonaId: null };
const TIENDA_2: NotificacionActor = { usuarioId: "tienda-2", rol: "adminTienda", zonaId: null };
const SATELITE_Z1: NotificacionActor = { usuarioId: "u-sat-1", rol: "adminSatelite", zonaId: "z-1" };
const SATELITE_Z2: NotificacionActor = { usuarioId: "u-sat-2", rol: "adminSatelite", zonaId: "z-2" };
const SATELITE_SIN_ZONA: NotificacionActor = {
  usuarioId: "u-sat-3",
  rol: "adminSatelite",
  zonaId: null,
};

describe("R13 — una notificacion de rol sin alcance la ven TODOS los usuarios de ese rol", () => {
  it("dos maestros distintos ven la misma notificacion dirigida a `maestro`", () => {
    const fila = { destinatarioRol: "maestro" as RolValue };
    expect(ve(MAESTRO_A, fila)).toBe(true);
    expect(ve(MAESTRO_B, fila)).toBe(true);
  });

  it("una tienda cualquiera ve la notificacion de rol `adminTienda` sin alcance", () => {
    const fila = { destinatarioRol: "adminTienda" as RolValue };
    expect(ve(TIENDA_1, fila)).toBe(true);
    expect(ve(TIENDA_2, fila)).toBe(true);
  });
});

describe("R14 — una notificacion acotada a una tienda solo la ve esa tienda", () => {
  it("la tienda dueña del alcance ve la notificacion", () => {
    expect(ve(TIENDA_1, { destinatarioRol: "adminTienda", tiendaId: "tienda-1" })).toBe(true);
  });
});

describe("R15 — un adminTienda NO ve lo acotado a otra tienda", () => {
  it("la tienda 2 no ve el rechazo acotado a la tienda 1", () => {
    expect(ve(TIENDA_2, { destinatarioRol: "adminTienda", tiendaId: "tienda-1" })).toBe(false);
  });

  it("el alcance por tienda tampoco se cuela por la rama de destinatario directo", () => {
    // `tienda_id` NO es `destinatario_usuario_id`: aunque coincidiera con el id de otro
    // usuario, la visibilidad la decide el rol + alcance, no la columna de alcance sola.
    expect(ve(MAESTRO_A, { destinatarioRol: "adminTienda", tiendaId: "u-maestro-a" })).toBe(false);
  });
});

describe("R16 — una notificacion acotada a una zona solo la ven los del rol en esa zona", () => {
  it("el adminSatelite de la zona 1 ve el aviso acotado a la zona 1", () => {
    expect(ve(SATELITE_Z1, { destinatarioRol: "adminSatelite", zonaId: "z-1" })).toBe(true);
  });

  it("el adminSatelite de la zona 2 NO ve el aviso acotado a la zona 1", () => {
    expect(ve(SATELITE_Z2, { destinatarioRol: "adminSatelite", zonaId: "z-1" })).toBe(false);
  });

  it("un adminSatelite SIN zona asignada no ve ninguna notificacion acotada por zona", () => {
    expect(ve(SATELITE_SIN_ZONA, { destinatarioRol: "adminSatelite", zonaId: "z-1" })).toBe(false);
    // pero si sigue viendo las de su rol sin alcance (R13).
    expect(ve(SATELITE_SIN_ZONA, { destinatarioRol: "adminSatelite" })).toBe(true);
  });
});

describe("R17 — nadie ve notificaciones dirigidas a un rol distinto del suyo", () => {
  it("una tienda no ve la notificacion dirigida a `maestro` aunque no tenga alcance", () => {
    expect(ve(TIENDA_1, { destinatarioRol: "maestro" })).toBe(false);
  });

  it("un adminSatelite no ve la notificacion acotada a una tienda", () => {
    expect(ve(SATELITE_Z1, { destinatarioRol: "adminTienda", tiendaId: "tienda-1" })).toBe(false);
  });

  it("un maestro no ve la notificacion acotada a su MISMA zona pero dirigida a adminSatelite", () => {
    const maestroConZona: NotificacionActor = { usuarioId: "u-m", rol: "maestro", zonaId: "z-1" };
    expect(ve(maestroConZona, { destinatarioRol: "adminSatelite", zonaId: "z-1" })).toBe(false);
  });
});

describe("direccionamiento por usuario — solo lo ve el destinatario", () => {
  it("la notificacion de carga masiva llega solo a quien la ejecuto", () => {
    expect(ve(TIENDA_1, { destinatarioUsuarioId: "tienda-1" })).toBe(true);
    expect(ve(TIENDA_2, { destinatarioUsuarioId: "tienda-1" })).toBe(false);
    expect(ve(MAESTRO_A, { destinatarioUsuarioId: "tienda-1" })).toBe(false);
  });
});
