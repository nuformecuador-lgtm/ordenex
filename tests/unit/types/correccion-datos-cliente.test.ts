import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  CAMPOS_CORREGIBLES,
  ESTADOS_SIN_CORRECCION,
  estadoAdmiteCorreccion,
  rolAdmiteCorreccion,
} from "@/lib/types/correccion-datos-cliente";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
import { ESTATUS_POR_GRUPO } from "@/lib/types/novedad-grupo";

// FICHA 312 / A1 — los DOS predicados que la pantalla y el servidor comparten (design §3.1).
// Sin dobles y sin I/O: son funciones puras de un estado y un rol.
//
// Los estados NO se escriben como literales sueltos donde el punto unico ya los declara: la ventana
// se comprueba contra `ESTADOS_TERMINALES` y los dos grupos contra `ESTATUS_POR_GRUPO`. Un literal
// duplicado seguiria verde el dia que el catalogo cambie debajo.

const MAESTRO: RolValue = "maestro";
const ADMIN: RolValue = "admin";
const ADMIN_TIENDA: RolValue = "adminTienda";
const MENSAJERO: RolValue = "mensajero";
const ADMIN_SATELITE: RolValue = "adminSatelite";
const API_KEY: RolValue = "apiKey";

describe("312/A1 + 327/D1 — los campos corregibles son EXACTAMENTE nueve", () => {
  it("la lista es la del alcance cerrado, sin zona ni estatus ni monto", () => {
    // R1. Este `toEqual` literal ES el contrato (312/D1 + 327/D1), no una copia de su fuente: si
    // alguien añade un campo, esta linea es la que le pregunta si de verdad quiso reabrir el
    // alcance.
    //
    // ⚠️ ACTUALIZADO EL 2026-08-28 POR LA FICHA 327, Y ESA ES LA UNICA FORMA CORRECTA DE TOCARLO.
    // La lista pasa de cuatro a nueve porque el humano REABRIO la decision de la 312 —la direccion
    // se habia dejado fuera «a sabiendas de que es el error de carga mas caro»— y le sumo la
    // ubicacion y el peso. Cambiar este literal por un `CAMPOS_CORREGIBLES.length` o por un
    // barrido derivado de su propia fuente lo dejaria SIEMPRE verde y mataria justo lo que hace:
    // obligar a que ampliar el alcance sea un gesto deliberado y visible en el diff.
    //
    // Lo que este literal sigue impidiendo, que es su verdadero trabajo: `zonaId` (la deriva el
    // servidor, 327/R5), `estatusId`, `tiendaId`, `montoCobrar`, `cobraComision`, `numGuia`,
    // `numRemision` y `mensajeroAsignadoId` (327/D2).
    expect([...CAMPOS_CORREGIBLES]).toEqual([
      // 312
      "destinatario",
      "telefonoDest",
      "producto",
      "notas",
      // 327
      "direccion",
      "provinciaId",
      "cantonId",
      "distritoId",
      "peso",
    ]);
  });

  it("327/R5 y D2 — los OCHO campos prohibidos NO estan en la lista, uno por uno", () => {
    // El `toEqual` de arriba ya lo garantiza, pero enumerarlos deja escrito CUALES son y por que
    // duelen: quien lea un fallo de este bloque ve la lista sin tener que ir al spec.
    for (const prohibido of [
      "zonaId", // 327/R5: la deriva el servidor a partir del distrito
      "estatusId", // arrastraria una fila de historial (312/D4)
      "tiendaId",
      "montoCobrar", // corregir una ubicacion mueve el FLETE, no el cobro al cliente
      "cobraComision",
      "numGuia",
      "numRemision",
      "mensajeroAsignadoId",
    ]) {
      expect(CAMPOS_CORREGIBLES).not.toContain(prohibido);
    }
  });
});

describe("312/A1 — D3: la ventana de estado", () => {
  it("la ventana bloqueada DERIVA de ESTADOS_TERMINALES y le suma `rechazada`, y nada mas", () => {
    // R11. Se compara contra la fuente unica: si un dia entra un cuarto terminal en el catalogo,
    // esta ficha lo hereda sin que nadie edite una lista, y este test lo confirma en vez de
    // congelar la foto de hoy.
    expect([...ESTADOS_SIN_CORRECCION]).toEqual([...ESTADOS_TERMINALES, "rechazada"]);
    expect(ESTADOS_SIN_CORRECCION).toHaveLength(4);
  });

  it.each([...ESTADOS_TERMINALES, "rechazada"])(
    "`%s` NO admite correccion",
    (estatusValue) => {
      expect(estadoAdmiteCorreccion(estatusValue)).toBe(false);
    },
  );

  it.each(["en_reparto", "devuelta", "ayuda_tienda", "en_bodega_central", "por_recoger"])(
    "`%s` SI admite correccion",
    (estatusValue) => {
      expect(estadoAdmiteCorreccion(estatusValue)).toBe(true);
    },
  );

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("FALLO CERRADO: %s no habilita nada", (_nombre, estatusValue) => {
    // R24. Es el caso que un `!LISTA.includes(x)` ingenuo deja pasar: con `undefined` diria «si».
    expect(estadoAdmiteCorreccion(estatusValue)).toBe(false);
  });
});

describe("312/A1 — R8: maestro y admin", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s corrige en cualquier estado dentro de la ventana", (_nombre, rol) => {
    for (const estatusValue of ["en_reparto", "devuelta", "ayuda_tienda", "en_bodega_central"]) {
      expect(rolAdmiteCorreccion(rol, estatusValue)).toBe(true);
    }
  });

  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s NO corrige en los cuatro estados bloqueados", (_nombre, rol) => {
    for (const estatusValue of ESTADOS_SIN_CORRECCION) {
      expect(rolAdmiteCorreccion(rol, estatusValue)).toBe(false);
    }
  });
});

describe("312/A1 — R9: adminTienda, en LOS DOS grupos de /novedades", () => {
  it("corrige en el grupo de la DEVOLUCION", () => {
    expect(rolAdmiteCorreccion(ADMIN_TIENDA, ESTATUS_POR_GRUPO.devolucion)).toBe(true);
  });

  it("corrige TAMBIEN en el grupo de la AYUDA (P2, 2026-08-28)", () => {
    // Este es el caso que el spec cambio de opinion: hasta el 2026-08-27 la correccion era solo
    // del grupo de devolucion. El humano la abrio a los dos porque en `ayuda_tienda` la tienda ya
    // reprograma, rechaza y escribe en el hilo. Si alguien "restaura" la version estrecha, cae
    // aqui.
    expect(rolAdmiteCorreccion(ADMIN_TIENDA, ESTATUS_POR_GRUPO.ayuda)).toBe(true);
  });

  it.each(["en_reparto", "por_recoger", "en_bodega_central", "reprogramada"])(
    "NO corrige en `%s`: fuera de los dos grupos, aunque el estado no este bloqueado",
    (estatusValue) => {
      // La asimetria de la regla: `maestro` SI puede ahi, la tienda no. Se comprueban las dos
      // mitades en la misma linea para que nadie "unifique" los dos caminos por parecerse.
      expect(estadoAdmiteCorreccion(estatusValue)).toBe(true);
      expect(rolAdmiteCorreccion(MAESTRO, estatusValue)).toBe(true);
      expect(rolAdmiteCorreccion(ADMIN_TIENDA, estatusValue)).toBe(false);
    },
  );

  it("NO corrige en los cuatro estados bloqueados", () => {
    for (const estatusValue of ESTADOS_SIN_CORRECCION) {
      expect(rolAdmiteCorreccion(ADMIN_TIENDA, estatusValue)).toBe(false);
    }
  });
});

describe("312/A1 — R10: los tres roles que nunca corrigen", () => {
  it.each([
    ["mensajero", MENSAJERO],
    ["adminSatelite", ADMIN_SATELITE],
    ["apiKey", API_KEY],
  ])("%s recibe false en TODO el catalogo de estados", (_nombre, rol) => {
    for (const estatusValue of [
      "en_reparto",
      "devuelta",
      "ayuda_tienda",
      "en_bodega_central",
      "por_recoger",
      ...ESTADOS_SIN_CORRECCION,
    ]) {
      expect(rolAdmiteCorreccion(rol, estatusValue)).toBe(false);
    }
  });
});

describe("312/A1 — el fallo cerrado alcanza tambien al predicado por rol", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
    ["adminTienda", ADMIN_TIENDA],
  ])("%s con estatus desconocido (undefined/null) no puede corregir", (_nombre, rol) => {
    expect(rolAdmiteCorreccion(rol, undefined)).toBe(false);
    expect(rolAdmiteCorreccion(rol, null)).toBe(false);
  });
});
