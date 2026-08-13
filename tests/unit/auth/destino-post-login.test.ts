import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  itemsVisibles,
  primerDestino,
  SIDEBAR_ITEMS,
} from "@/lib/auth/menu-visibility";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 133 (T5.2) — R5: EL ATERRIZAJE POST-LOGIN NO SE MUEVE.
//
// QUÉ VIGILA
// ----------
// `/dashboard` no es una pantalla para todos: redirige a
// `primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor))`, o sea al primer ítem ELEGIBLE de
// la barra de cada rol (`app/(app)/dashboard/page.tsx`). Esta feature hace visible el ítem
// "Analítica" a `adminTienda`, `adminSatelite` y `mensajero`, y ese ítem ocupa la POSICIÓN
// 2 de `SIDEBAR_ITEMS` (justo tras "Inicio", que esos roles no ven). Sin más, `mensajero` y
// `adminSatelite` habrían pasado a aterrizar en `/analitica` en vez de en su pantalla de
// trabajo. Decisión del humano (Q2, puerta cerrada el 2026-08-04): CONSERVAN su aterrizaje
// actual — un tablero de indicadores no es donde empieza el turno de nadie. La
// implementación es el campo `destinoInicial: false` del ítem (T5.1).
//
// POR QUÉ EL ESPERADO VA POR VALOR, ESCRITO A MANO
// ------------------------------------------------
// Porque el cambio habría sido SILENCIOSO. El test que hoy cubre este aterrizaje
// (`tests/components/HomePageMaestro.test.tsx:150`) calcula su valor esperado así:
//
//     const esperado = primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor));
//
// es decir, con la MISMA función que está juzgando. Eso es una tautología: pasa igual si el
// destino es `/mis-asignaciones/reparto` que si pasa a ser `/analitica`, `/configuracion` o
// cualquier otra cosa. Nunca se pondría rojo, y el desvío se habría descubierto por la
// llamada de un mensajero que abre la app y no encuentra su ruta.
//
// Por eso aquí los cinco destinos están ESCRITOS COMO LITERALES, verificados leyendo
// `SIDEBAR_ITEMS`. Es deliberadamente redundante y deliberadamente frágil: si un cambio
// futuro mueve el aterrizaje de un rol, este archivo es el que tiene que romperse y obligar
// a que alguien decida a mano si eso es lo que se quería. **PROHIBIDO** derivar el esperado
// de `primerDestino`, de `itemsVisibles` o de `SIDEBAR_ITEMS`: eso devolvería el test al
// defecto que la puerta Q2 acaba de cerrar.

const actor = (rol: RolValue): Actor => ({ usuarioId: "u1", rol });

const destinoDe = (rol: RolValue): string | null =>
  primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor(rol)));

describe("R5 — destino post-login por rol (valores escritos a mano, NO derivados)", () => {
  it("maestro aterriza en /dashboard (tiene Inicio propio: no hay redirección circular)", () => {
    expect(destinoDe("maestro")).toBe("/dashboard");
  });

  it("admin aterriza en /dashboard", () => {
    expect(destinoDe("admin")).toBe("/dashboard");
  });

  it("adminTienda aterriza en /ordenes (NO en /analitica, aunque ese ítem le sea visible y vaya antes)", () => {
    expect(destinoDe("adminTienda")).toBe("/ordenes");
  });

  it("adminSatelite aterriza en /recepcion-satelite (NO en /analitica)", () => {
    expect(destinoDe("adminSatelite")).toBe("/recepcion-satelite");
  });

  // 2026-08-12: el mensajero ya no ve "Analítica", así que su destino lo protege ahora el
  // orden de SU barra ("Entregas" primero) además de la marca `destinoInicial`. El valor
  // esperado no cambia — que es exactamente lo que este archivo existe para comprobar.
  it("mensajero aterriza en /mis-asignaciones/reparto (NO en /analitica; y es el SUBÍTEM, el padre no navega)", () => {
    expect(destinoDe("mensajero")).toBe("/mis-asignaciones/reparto");
  });

  // La otra mitad del requisito: ningún rol acaba en el tablero. Se afirma aparte de los
  // literales de arriba para que el motivo quede legible en el nombre del caso.
  it("NINGUNO de los cinco roles aterriza en /analitica", () => {
    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "adminSatelite",
      "mensajero",
    ] as RolValue[]) {
      expect(destinoDe(rol)).not.toBe("/analitica");
    }
  });

  it("apiKey no ve ningún ítem, así que no tiene destino (sigue sin navegar la UI)", () => {
    expect(destinoDe("apiKey")).toBeNull();
  });

  it("sin actor (sesión ausente o inválida) no hay destino: queda el placeholder", () => {
    expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, null))).toBeNull();
    expect(primerDestino([])).toBeNull();
  });

  // Feature 133 (T5.1): la marca es del ÍTEM, no una ruta escrita dentro de `primerDestino`.
  // Se afirma aquí porque es la pieza de la que dependen los cinco casos de arriba: si
  // alguien la borra creyéndola decorativa, este caso dice qué era y por qué estaba.
  // Feature 192 (R54): "Monitoreo" es el SEGUNDO ítem que se excluye, por la misma razón y
  // con la misma marca. Va en posición 3 de `SIDEBAR_ITEMS` y es visible para
  // `adminSatelite`, que no ve "Inicio" ni "Órdenes": sin la marca, ese rol habría pasado a
  // aterrizar en `/monitoreo` en vez de en `/recepcion-satelite`, exactamente el incidente
  // que la 133 cerró con "Analítica". La lista se sigue comparando por IGUALDAD: un ítem
  // que gane la marca sin decidirlo a mano pone este caso rojo.
  it("los ítems 'Analítica' y 'Monitoreo' declaran destinoInicial: false y son los ÚNICOS que se excluyen hoy", () => {
    const noElegibles = SIDEBAR_ITEMS.filter(
      (item) => item.destinoInicial === false,
    ).map((item) => item.href);
    expect(noElegibles).toEqual(["/analitica", "/monitoreo"]);
  });

  // 2026-08-12: el `mensajero` sale del tablero, así que la afirmación «visible pero no
  // elegible» ya sólo puede hacerse de los CUATRO roles que lo ven. La distinción que este
  // caso protege sigue siendo la misma y sigue mordiendo con ellos: `adminTienda` y
  // `adminSatelite` ven el ítem en PRIMERA posición de su barra y aun así no aterrizan ahí.
  // El mensajero se afirma por el otro lado —no lo ve— para que su salida quede escrita aquí
  // y no se lea como que este caso se recortó sin motivo.
  it("el ítem sigue siendo VISIBLE para los cuatro con acceso: no elegible como aterrizaje ≠ oculto", () => {
    for (const rol of [
      "maestro",
      "admin",
      "adminTienda",
      "adminSatelite",
    ] as RolValue[]) {
      expect(
        itemsVisibles(SIDEBAR_ITEMS, actor(rol)).some(
          (i) => i.href === "/analitica",
        ),
      ).toBe(true);
    }
    expect(
      itemsVisibles(SIDEBAR_ITEMS, actor("mensajero")).some(
        (i) => i.href === "/analitica",
      ),
    ).toBe(false);
  });
});
