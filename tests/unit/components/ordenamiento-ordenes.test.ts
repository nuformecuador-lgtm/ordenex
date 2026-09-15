import { describe, it, expect } from "vitest";

import {
  CAMPO_ORDEN_INICIAL,
  DIRECCION_ORDEN_INICIAL,
  ETIQUETA_CAMPO_ORDEN,
  ETIQUETA_DIRECCION,
  notaPrioridad,
  OPCIONES_CAMPO_ORDEN,
  OPCIONES_DIRECCION,
  ordenamientoDe,
  type CampoOrdenOfrecido,
} from "@/app/(app)/ordenes/_components/ordenamiento-ordenes";
import { listarOrdenesSchema, SORT_FIELDS } from "@/lib/types/orden";
import { DIRECCIONES_ORDEN } from "@/lib/types/ordenamiento-listado";

// FICHA 356 + FICHA 423 — el control declarado en la PANTALLA contra el contrato del SERVIDOR.
//
// Son dos fuentes independientes a propósito: la pantalla escribe sus literales y el servidor
// los suyos (`listarOrdenesSchema`). Derivar los de aquí de los de allí dejaría este archivo
// comparándose consigo mismo — siempre verde, incapaz de avisar de nada. Por el mismo motivo
// los textos esperados de abajo están ESCRITOS A MANO y no importados del módulo que los
// genera (memoria del repo: «aserción contra su propia fuente»).
//
// Renombrado desde `ordenamiento-creacion.test.ts`: los cinco casos de la 356 siguen aquí,
// ampliados a los dos campos que el control ofrece ahora.

/** Los dos campos que el control ofrece, escritos a mano. */
const CAMPOS_OFRECIDOS: CampoOrdenOfrecido[] = ["created_at", "num_remision"];

describe("ordenamiento-ordenes — arranque alineado con el contrato", () => {
  it("el campo y la dirección iniciales de la pantalla SON los defaults del servidor", () => {
    // Si alguien cambia el default del listado y no estos literales, la barra diría «Fecha de
    // creación / Más recientes» mientras el servidor devuelve otra cosa: el control mentiría
    // desde el primer render, sin que ninguna consulta fallara.
    const porDefecto = listarOrdenesSchema.parse({});
    expect(DIRECCION_ORDEN_INICIAL).toBe(porDefecto.sortDir);
    expect(CAMPO_ORDEN_INICIAL).toBe(porDefecto.sortBy);
  });

  it("los DOS campos ofrecidos están en la lista blanca del servidor", () => {
    // Un `sortBy` fuera de la lista es `validation_error`, o sea la tabla entera en error.
    for (const campo of OPCIONES_CAMPO_ORDEN.map((o) => o.valor)) {
      expect(SORT_FIELDS).toContain(campo);
    }
  });

  it("el ordenamiento emitido es exactamente lo que el schema admite, en las CUATRO combinaciones", () => {
    for (const campo of CAMPOS_OFRECIDOS) {
      for (const dir of DIRECCIONES_ORDEN) {
        const emitido = ordenamientoDe(campo, dir);
        expect(emitido).toEqual({ sortBy: campo, sortDir: dir });
        // `.strict()`: una clave de más aquí sería `validation_error` en el borde.
        expect(() =>
          listarOrdenesSchema.parse({ page: 1, pageSize: 25, ...emitido }),
        ).not.toThrow();
      }
    }
  });
});

describe("ordenamiento-ordenes — los DOS campos ofrecidos y ninguno más (R1)", () => {
  it("ofrece la fecha de creación y el número de remisión, en ese orden", () => {
    expect(OPCIONES_CAMPO_ORDEN.map((o) => o.valor)).toEqual([
      "created_at",
      "num_remision",
    ]);
  });

  it("NO ofrece `num_guia` aunque el servidor lo admita", () => {
    // R1 es también una prohibición: la lista blanca tiene tres claves y el control enseña dos.
    // Ofrecer la tercera llenaría la barra de una opción que nadie pidió.
    expect(OPCIONES_CAMPO_ORDEN.map((o) => o.valor)).not.toContain("num_guia");
    expect(SORT_FIELDS).toContain("num_guia");
  });

  it("cada campo se nombra con las palabras de la pantalla, no con la clave del contrato", () => {
    expect(OPCIONES_CAMPO_ORDEN[0]?.etiqueta).toBe("Fecha de creación");
    expect(OPCIONES_CAMPO_ORDEN[1]?.etiqueta).toBe("Número de remisión");
  });

  it("el campo por defecto es el PRIMERO: el control abre en lo que se está viendo", () => {
    expect(OPCIONES_CAMPO_ORDEN[0]?.valor).toBe(CAMPO_ORDEN_INICIAL);
  });
});

describe("ordenamiento-ordenes — las dos direcciones, con el texto DEL CAMPO", () => {
  it("cada campo ofrece las DOS direcciones del contrato y ninguna más", () => {
    for (const campo of CAMPOS_OFRECIDOS) {
      expect(OPCIONES_DIRECCION[campo].map((o) => o.valor).sort()).toEqual(
        [...DIRECCIONES_ORDEN].sort(),
      );
    }
  });

  it("la opción por defecto es la primera, en los dos campos", () => {
    for (const campo of CAMPOS_OFRECIDOS) {
      expect(OPCIONES_DIRECCION[campo][0]?.valor).toBe(DIRECCION_ORDEN_INICIAL);
    }
  });

  it("la FECHA conserva palabra por palabra las etiquetas de la 356", () => {
    expect(OPCIONES_DIRECCION.created_at[0]?.etiqueta).toBe("Más recientes");
    expect(OPCIONES_DIRECCION.created_at[1]?.etiqueta).toBe("Más antiguas");
  });

  it("la REMISIÓN describe el número, no el tiempo", () => {
    expect(OPCIONES_DIRECCION.num_remision[0]?.etiqueta).toBe("Más altas");
    expect(OPCIONES_DIRECCION.num_remision[1]?.etiqueta).toBe("Más bajas");
  });

  it("las etiquetas de la remisión NO usan vocabulario temporal", () => {
    // «Más recientes» sugeriría que un número mayor es más nuevo, y con cuatro series
    // conviviendo eso es falso: una remisión con prefijo no es posterior a una numérica sólo
    // por tener el número más alto. El control describiría mal lo que hace.
    for (const opcion of OPCIONES_DIRECCION.num_remision) {
      expect(opcion.etiqueta).not.toMatch(/recient|antigu|nuev|viej|fecha/i);
    }
  });

  it("los dos campos NO comparten ninguna etiqueta de dirección", () => {
    // Si las compartieran, cambiar de campo dejaría el conmutador diciendo exactamente lo
    // mismo sobre un listado distinto — y nadie notaría que el texto se quedó atrás.
    const fecha = OPCIONES_DIRECCION.created_at.map((o) => o.etiqueta);
    const remision = OPCIONES_DIRECCION.num_remision.map((o) => o.etiqueta);
    expect(fecha.filter((e) => remision.includes(e))).toEqual([]);
  });

  it("cada opción dice en PALABRAS qué hace, no una clave del servidor", () => {
    // Un conmutador cuya etiqueta fuera `asc`/`desc` obliga a traducir vocabulario del
    // servidor. FICHA 428: desde que la barra los pinta en solo icono, esta exigencia PESA MÁS,
    // no menos — la etiqueta ya no está escrita en pantalla, así que es lo único que anuncia un
    // lector de pantalla y lo único que revela el tooltip. Un `desc` ahí sería el nombre del
    // botón.
    for (const campo of CAMPOS_OFRECIDOS) {
      for (const opcion of OPCIONES_DIRECCION[campo]) {
        expect(opcion.etiqueta.trim().length).toBeGreaterThan(3);
        expect(opcion.etiqueta).not.toMatch(/^(asc|desc)$/i);
      }
      expect(new Set(OPCIONES_DIRECCION[campo].map((o) => o.etiqueta)).size).toBe(
        OPCIONES_DIRECCION[campo].length,
      );
    }
  });
});

// FICHA 428 — LA GUARDIA QUE SOSTIENE EL SOLO-ICONO.
//
// `OrdenesListado` monta estos dos conmutadores con `soloIcono`, y ahí el `Icono` deja de ser
// decoración: es LO ÚNICO que se pinta. `SegmentedToggle` tiene un fallback —la opción sin
// icono cae al botón de texto— para que nunca salga un botón vacío, pero ese fallback es una
// red, no el diseño: una opción que cayera en él aparecería con su texto al lado de tres
// botones cuadrados, o sea la barra rota que esta ficha vino a arreglar.
//
// Y es UN FALLO MUDO, que es por lo que la guardia vive aquí y no se deja a la revisión: quitar
// el `Icono` de una opción no rompe ningún otro test. El nombre accesible seguiría estando
// —viene de `etiqueta`, no del icono—, `getByRole("button", { name })` seguiría encontrando el
// botón y la suite entera seguiría verde con la pantalla descuadrada.
describe("ordenamiento-ordenes — TODA opción trae icono (lo exige el solo-icono)", () => {
  it("las dos opciones de CAMPO declaran su `Icono`", () => {
    for (const opcion of OPCIONES_CAMPO_ORDEN) {
      expect(opcion.Icono, `«${opcion.etiqueta}» sin Icono`).toBeDefined();
    }
  });

  it("las dos opciones de DIRECCIÓN de CADA campo declaran su `Icono`", () => {
    // Los DOS campos, no solo el que abre la pantalla: las opciones de la remisión solo se
    // pintan después de pulsar el otro conmutador, así que un icono que faltara ahí no se vería
    // ni entrando a `/ordenes`.
    for (const campo of CAMPOS_OFRECIDOS) {
      for (const opcion of OPCIONES_DIRECCION[campo]) {
        expect(
          opcion.Icono,
          `«${opcion.etiqueta}» (${campo}) sin Icono`,
        ).toBeDefined();
      }
    }
  });

  it("y ninguna lista se queda vacía, que dejaría la guardia sin nada que recorrer", () => {
    // Un `for` sobre una lista vacía pasa en verde sin comprobar nada (memoria del repo: «test
    // de integración verde sin datos»). Esto ancla que había algo que recorrer.
    expect(OPCIONES_CAMPO_ORDEN.length).toBe(2);
    for (const campo of CAMPOS_OFRECIDOS) {
      expect(OPCIONES_DIRECCION[campo].length).toBe(2);
    }
  });
});

describe("ordenamiento-ordenes — los dos grupos tienen nombre accesible propio", () => {
  it("el grupo de campo y el de dirección no se llaman igual", () => {
    for (const campo of CAMPOS_OFRECIDOS) {
      expect(ETIQUETA_DIRECCION[campo]).not.toBe(ETIQUETA_CAMPO_ORDEN);
    }
    expect(ETIQUETA_DIRECCION.created_at).not.toBe(
      ETIQUETA_DIRECCION.num_remision,
    );
  });

  it("el nombre del grupo de dirección dice de qué campo es", () => {
    // Dos grupos con el mismo nombre son, para un lector de pantalla, el mismo control dos
    // veces. Y uno que no nombra su campo obliga a haber oído antes el otro grupo.
    expect(ETIQUETA_DIRECCION.created_at).toContain("fecha de creación");
    expect(ETIQUETA_DIRECCION.num_remision).toContain("número de remisión");
    expect(ETIQUETA_CAMPO_ORDEN.trim().length).toBeGreaterThan(3);
  });
});

describe("notaPrioridad — nombra el campo VIGENTE (R14)", () => {
  it("con el orden por fecha dice «fecha de creación», palabra por palabra", () => {
    expect(notaPrioridad("created_at")).toBe(
      "Las órdenes prioritarias se muestran primero; el resto sigue el orden por fecha de creación.",
    );
  });

  it("con el orden por remisión dice «número de remisión», no la fecha", () => {
    // ESTE es el defecto que R14 arregla: la constante de la 356 nombraba la fecha fija, así
    // que con el orden por remisión puesto la tabla explicaba un listado que no era el suyo.
    expect(notaPrioridad("num_remision")).toBe(
      "Las órdenes prioritarias se muestran primero; el resto sigue el orden por número de remisión.",
    );
  });

  it("el texto CAMBIA con el campo (no es una constante disfrazada de función)", () => {
    expect(notaPrioridad("created_at")).not.toBe(notaPrioridad("num_remision"));
    expect(notaPrioridad("num_remision")).not.toMatch(/fecha/i);
  });

  it("cubre los TRES campos del contrato sin dejar ninguno sin nombre", () => {
    // El consumidor recibe el `sortBy` del contrato, no el estado del conmutador: un campo sin
    // nombre dejaría la nota diciendo «undefined» en pantalla.
    for (const campo of SORT_FIELDS) {
      expect(notaPrioridad(campo)).not.toMatch(/undefined/);
      expect(notaPrioridad(campo).endsWith(".")).toBe(true);
    }
  });
});
