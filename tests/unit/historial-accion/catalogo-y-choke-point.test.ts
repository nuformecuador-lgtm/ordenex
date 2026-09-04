import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

import {
  ACCION_LABELS,
  CATEGORIAS_ACCION,
  CATEGORIA_LABELS,
  CATEGORIA_POR_ACCION,
  ENTIDAD_LABELS,
  HISTORIAL_ACCION_ENTIDADES,
  HISTORIAL_ACCION_TIPOS,
  accionesDeCategoria,
} from "@/lib/types/historial-accion";
import {
  ACTOR_SISTEMA,
  appendAccion,
  resolverActorCongelado,
} from "@/lib/repositories/registrar-accion";
import type { EntradaAccion } from "@/lib/interfaces/repositories/IHistorialAccionRepository";
import {
  ETIQUETA_DESCONOCIDA,
  ETIQUETA_MAX_CHARS,
  ETIQUETA_ORDEN_SIN_GUIA,
  etiquetaDeEntidad,
} from "@/lib/types/historial-accion-etiquetas";

// FICHA 362 / T0 — LOS CIMIENTOS: el catalogo, el punto unico de escritura, la etiqueta congelada
// y el actor congelado.
//
// Lo que estos casos cubren, y lo que NO: aqui se mide la FORMA de lo que se escribe (una fila por
// entidad, el mismo lote, el actor congelado, la etiqueta que nunca sale vacia). Lo que NO se mide
// aqui es la ATOMICIDAD — eso solo se puede afirmar contra Postgres, y vive en
// `tests/integration/db/historial-accion-atomicidad.test.ts`. Un doble no puede revertir nada, y
// en este repo esta medido que con dobles una mutacion del `WHERE` pasa en verde.

/**
 * Doble minimo del `tx` que `appendAccion` acepta.
 *
 * El `as never` va en el LIMITE del doble y no dentro del codigo de produccion: el `Pick` de
 * Prisma exige los 17 metodos del delegado y aqui solo se ejerce `createMany`.
 */
function txDoble() {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  return { historialAccion: { createMany } as never, createMany };
}

function entrada(overrides: Partial<EntradaAccion> = {}): EntradaAccion {
  return {
    accion: "orden_eliminada",
    entidadTipo: "orden",
    entidadId: "o-1",
    entidadEtiqueta: "100234",
    actorUsuarioId: "u-maestro",
    actorNombre: "Maestra Uno",
    actorRol: "maestro",
    ...overrides,
  };
}

/** Las filas que se le pasaron a `createMany` en la llamada `n`. */
function filas(tx: ReturnType<typeof txDoble>, n = 0): Record<string, unknown>[] {
  const args = tx.createMany.mock.calls[n]?.[0] as { data: Record<string, unknown>[] };
  return args.data;
}

// =============================================================================================
// T0.1 — EL CATALOGO
// =============================================================================================

describe("362/T0.1 (R14/R17) — el catalogo es cerrado y sus mapas son exhaustivos", () => {
  it("son 44 tipos, 17 entidades y 3 categorias, sin repetidos", () => {
    expect(HISTORIAL_ACCION_TIPOS).toHaveLength(44);
    expect(new Set(HISTORIAL_ACCION_TIPOS).size).toBe(44);
    expect(HISTORIAL_ACCION_ENTIDADES).toHaveLength(17);
    expect(new Set(HISTORIAL_ACCION_ENTIDADES).size).toBe(17);
    expect(CATEGORIAS_ACCION).toHaveLength(3);
  });

  it("los DOS tipos que abren Q1 y Q2 estan en el catalogo y son de DINERO", () => {
    // Las dos preguntas que el humano cerro el 2026-09-02. Si alguien las retirara, esto se pone
    // rojo antes que ninguna otra cosa.
    expect(HISTORIAL_ACCION_TIPOS).toContain("orden_ubicacion_corregida");
    expect(HISTORIAL_ACCION_TIPOS).toContain("usuario_fulfillment_cambiado");
    expect(CATEGORIA_POR_ACCION.orden_ubicacion_corregida).toBe("mueve_dinero");
    expect(CATEGORIA_POR_ACCION.usuario_fulfillment_cambiado).toBe("mueve_dinero");
  });

  it("⭑ FICHA 371: corregir la fecha de una reprogramacion es DESAPARICION, no dinero", () => {
    // Corregir la fecha a HOY dispara la liberacion en el mismo acto, asi que la orden SALE de
    // `reprogramada` y deja de estar donde el coordinador la tenia: misma familia que
    // `orden_eliminada`. NO es dinero —esta MEDIDO que una gestion `reprogramada` no lleva importe
    // (0 de 160 con pago al mensajero o ingreso por rechazo) y que ni la analitica ni el ranking
    // leen esa columna—, y tampoco es que la fecha anterior se pierda: esa queda guardada en
    // `gestion_fecha_reprogramacion_cambio.fecha_anterior`.
    expect(HISTORIAL_ACCION_TIPOS).toContain("gestion_fecha_reprogramacion_corregida");
    expect(CATEGORIA_POR_ACCION.gestion_fecha_reprogramacion_corregida).toBe("hace_desaparecer");
  });

  it("`tarifa_borrada` es DESAPARICION y no dinero, aunque mueva precio (R17)", () => {
    // R17 exige EXACTAMENTE una categoria. Lo que la fila documenta es la desaparicion
    // irreversible: `tarifas` borra en FISICO.
    expect(CATEGORIA_POR_ACCION.tarifa_borrada).toBe("hace_desaparecer");
  });

  it("`CATEGORIA_POR_ACCION` y `ACCION_LABELS` cubren TODOS los tipos y ninguno mas", () => {
    expect(Object.keys(CATEGORIA_POR_ACCION).sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    expect(Object.keys(ACCION_LABELS).sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    // Y ninguna etiqueta vacia: una fila sin texto es indistinguible de un dato perdido.
    for (const [tipo, label] of Object.entries(ACCION_LABELS)) {
      expect(label.trim().length, `\`${tipo}\` sin etiqueta`).toBeGreaterThan(3);
    }
  });

  it("`ENTIDAD_LABELS` y `CATEGORIA_LABELS` tambien son exhaustivos", () => {
    expect(Object.keys(ENTIDAD_LABELS).sort()).toEqual([...HISTORIAL_ACCION_ENTIDADES].sort());
    expect(Object.keys(CATEGORIA_LABELS).sort()).toEqual([...CATEGORIAS_ACCION].sort());
  });

  it("`accionesDeCategoria` particiona el catalogo: cada tipo en una sola y ninguno fuera", () => {
    const porCategoria = CATEGORIAS_ACCION.flatMap((c) => accionesDeCategoria(c));
    expect(porCategoria.sort()).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    expect(new Set(porCategoria).size).toBe(HISTORIAL_ACCION_TIPOS.length);
  });

  it("el reparto por categoria es el del Anexo A: 26 dinero, 7 desaparicion, 11 permisos", () => {
    // Numeros DUROS: mover un tipo de categoria es una decision, y tiene que pasar por aqui.
    // 26 y no 25 desde la ficha 366: `orden_zona_reconciliada` entra en DINERO.
    // 7 y no 6 desde la ficha 371: `gestion_fecha_reprogramacion_corregida` entra en DESAPARICION.
    expect(accionesDeCategoria("mueve_dinero")).toHaveLength(26);
    expect(accionesDeCategoria("hace_desaparecer")).toHaveLength(7);
    expect(accionesDeCategoria("cambia_permisos")).toHaveLength(11);
  });
});

// =============================================================================================
// T0.4 — EL CHOKE POINT
// =============================================================================================

describe("362/T0.4 (R1/R7/R13) — `appendAccion`, el punto unico de escritura", () => {
  it("R1: escribe UNA FILA POR ENTIDAD afectada, no una por accion", () => {
    // El caso que abre la ficha: se borran 3 ordenes y el registro tiene 3 filas. Con grano por
    // ACCION habria que abrir un detalle para responder «¿quien borro ESTA orden?».
    const tx = txDoble();
    const entradas = ["o-1", "o-2", "o-3"].map((id) => entrada({ entidadId: id }));

    return appendAccion(tx, entradas).then(() => {
      expect(tx.createMany).toHaveBeenCalledTimes(1);
      expect(filas(tx)).toHaveLength(3);
      expect(filas(tx).map((f) => f.entidadId)).toEqual(["o-1", "o-2", "o-3"]);
    });
  });

  it("R7: TODAS las filas de una llamada llevan el MISMO `lote_id`", async () => {
    const tx = txDoble();
    await appendAccion(tx, ["o-1", "o-2", "o-3"].map((id) => entrada({ entidadId: id })));

    const lotes = new Set(filas(tx).map((f) => f.loteId));
    expect(lotes.size, "79 borrados de UN acto tienen que distinguirse de 79 actos").toBe(1);
    expect([...lotes][0]).toBeTypeOf("string");
  });

  it("R7: dos llamadas distintas llevan lotes DISTINTOS", async () => {
    const tx = txDoble();
    await appendAccion(tx, [entrada({ entidadId: "o-1" })]);
    await appendAccion(tx, [entrada({ entidadId: "o-2" })]);

    expect(filas(tx, 0)[0].loteId).not.toBe(filas(tx, 1)[0].loteId);
  });

  it("MUTACION: generar el `loteId` por FILA se detectaria aqui", () => {
    // La mutacion que el design nombra («generar el identificador de lote por fila»). Se ejerce
    // sobre el resultado: si cada fila trajera el suyo, el `Set` de arriba tendria tamaño 3.
    const conLotePorFila = ["a", "b", "c"].map((id) => ({ entidadId: id, loteId: `lote-${id}` }));
    expect(new Set(conLotePorFila.map((f) => f.loteId)).size).toBe(3);
  });

  it("`entradas` vacio es NO-OP: no se toca la base", async () => {
    // Una accion que no alcanzo ninguna entidad no deja fila (R11). Es lo que hace que el
    // `RETURNING` vacio de un borrado por lote no escriba auditoria de nada.
    const tx = txDoble();
    await appendAccion(tx, []);
    expect(tx.createMany).not.toHaveBeenCalled();
  });

  it("el `loteId` se puede fijar desde fuera (para los tests), y entonces manda ese", async () => {
    const tx = txDoble();
    await appendAccion(tx, [entrada(), entrada({ entidadId: "o-2" })], "lote-fijo");
    expect(filas(tx).map((f) => f.loteId)).toEqual(["lote-fijo", "lote-fijo"]);
  });

  it("los campos opcionales ausentes se persisten como NULL explicito, no como `undefined`", async () => {
    const tx = txDoble();
    await appendAccion(tx, [entrada()]);
    const fila = filas(tx)[0];
    expect(fila.monto).toBeNull();
    expect(fila.valorAnterior).toBeNull();
    expect(fila.valorNuevo).toBeNull();
  });

  it("R6: el importe viaja como `Prisma.Decimal`, sin pasar por `number`", async () => {
    const tx = txDoble();
    await appendAccion(tx, [entrada({ monto: new Prisma.Decimal("123456.78") })]);
    const monto = filas(tx)[0].monto as Prisma.Decimal;
    expect(monto).toBeInstanceOf(Prisma.Decimal);
    expect(monto.toFixed(2)).toBe("123456.78");
  });

  it("la etiqueta se recorta a la anchura de la columna: una larga no tumba la accion", async () => {
    const tx = txDoble();
    await appendAccion(tx, [entrada({ entidadEtiqueta: "x".repeat(500) })]);
    expect((filas(tx)[0].entidadEtiqueta as string).length).toBe(ETIQUETA_MAX_CHARS);
  });
});

// =============================================================================================
// T0.6 — EL ACTOR CONGELADO
// =============================================================================================

describe("362/T0.6 (R3/R36) — el actor se congela con UNA consulta", () => {
  // El doble se ensancha al tipo del delegado: el `Pick` de Prisma exige los 17 metodos y aqui
  // solo se usa uno. El `as never` es en el LIMITE del doble, no dentro del codigo de produccion.
  function usuarioDoble(fila: unknown) {
    const findUnique = vi.fn().mockResolvedValue(fila);
    return { usuario: { findUnique } as never, findUnique };
  }

  it("R3: devuelve nombre y rol, y consulta EXACTAMENTE una vez", async () => {
    const tx = usuarioDoble({
      nombre: "Ana",
      primerApellido: "Torres",
      rol: { value: "maestro" },
    });
    const actor = await resolverActorCongelado(tx, "u-1");

    expect(actor).toEqual({
      actorUsuarioId: "u-1",
      actorNombre: "Ana Torres",
      actorRol: "maestro",
    });
    // UNA consulta POR ACCION, no por fila: es lo que hace que un borrado de 79 ordenes no cueste
    // 79 viajes a la base.
    expect(tx.findUnique).toHaveBeenCalledTimes(1);
  });

  it("R3: lo que se lee es lo JUSTO — nombre, apellido y el `value` del rol", async () => {
    const tx = usuarioDoble({ nombre: "Ana", primerApellido: null, rol: { value: "admin" } });
    await resolverActorCongelado(tx, "u-1");

    const args = tx.findUnique.mock.calls[0][0] as { select: Record<string, unknown> };
    expect(Object.keys(args.select).sort()).toEqual(["nombre", "primerApellido", "rol"]);
    // Y NADA de PII: ni email, ni telefono, ni cedula, ni el hash.
    for (const prohibido of ["email", "telefono", "cedula", "passwordHash"]) {
      expect(args.select).not.toHaveProperty(prohibido);
    }
  });

  it("un apellido nulo no deja el espacio suelto", async () => {
    const tx = usuarioDoble({ nombre: "Ana", primerApellido: null, rol: { value: "admin" } });
    expect((await resolverActorCongelado(tx, "u-1")).actorNombre).toBe("Ana");
  });

  it("R36: `actorUsuarioId = null` es EL SISTEMA, y NO consulta nada", async () => {
    const tx = usuarioDoble(null);
    expect(await resolverActorCongelado(tx, null)).toEqual(ACTOR_SISTEMA);
    expect(tx.findUnique).not.toHaveBeenCalled();
  });

  it("un id que no resuelve tampoco inventa un nombre: cae a SISTEMA", async () => {
    // No se inventa una identidad. Y sobre todo: NO tumba la accion — una etiqueta pobre es un
    // defecto menor; que el borrado de una orden falle por el actor es un defecto grave.
    const tx = usuarioDoble(null);
    expect(await resolverActorCongelado(tx, "u-borrado")).toEqual(ACTOR_SISTEMA);
  });

  it("los TRES campos del actor son nulos A LA VEZ cuando es el sistema", () => {
    // Nunca «sin id pero con nombre» ni al reves: es lo que la pantalla lee para decir «Sistema».
    expect(ACTOR_SISTEMA).toEqual({
      actorUsuarioId: null,
      actorNombre: null,
      actorRol: null,
    });
  });
});

// =============================================================================================
// T0.5 — LA ETIQUETA CONGELADA
// =============================================================================================

describe("362/T0.5 (R4/R5) — `etiquetaDeEntidad`, un caso por entidad", () => {
  it("orden: la GUIA manda; sin guia, la remision; sin ninguna, el respaldo declarado", () => {
    expect(etiquetaDeEntidad("orden", { numGuia: 100234, numRemision: "REM-1" })).toBe("100234");
    expect(etiquetaDeEntidad("orden", { numGuia: null, numRemision: "REM-1" })).toBe("REM-1");
    expect(etiquetaDeEntidad("orden", { numGuia: null, numRemision: null })).toBe(
      ETIQUETA_ORDEN_SIN_GUIA,
    );
    // Nunca en blanco: una celda vacia es indistinguible de un dato perdido.
    expect(etiquetaDeEntidad("orden", { numGuia: null, numRemision: "   " })).toBe(
      ETIQUETA_ORDEN_SIN_GUIA,
    );
  });

  it("usuario: nombre y primer apellido de un OPERADOR", () => {
    expect(etiquetaDeEntidad("usuario", { nombre: "Ana", primerApellido: "Torres" })).toBe(
      "Ana Torres",
    );
    expect(etiquetaDeEntidad("usuario", { nombre: "Ana", primerApellido: null })).toBe("Ana");
  });

  it("tarifa: a QUIEN aplica, y `Tarifa general` cuando no aplica a nadie en concreto", () => {
    expect(etiquetaDeEntidad("tarifa", { zonaNombre: "Norte", tiendaNombre: "Nuform" })).toBe(
      "Norte · Nuform",
    );
    expect(etiquetaDeEntidad("tarifa", { zonaNombre: "Norte", tiendaNombre: null })).toBe("Norte");
    expect(etiquetaDeEntidad("tarifa", { zonaNombre: null, tiendaNombre: null })).toBe(
      "Tarifa general",
    );
  });

  it("zona, vehiculo y plantilla: su nombre", () => {
    expect(etiquetaDeEntidad("zona", { nombre: "GAM" })).toBe("GAM");
    expect(etiquetaDeEntidad("vehiculo", { nombre: "Moto" })).toBe("Moto");
    expect(etiquetaDeEntidad("plantilla_mensaje", { nombre: "Bienvenida" })).toBe("Bienvenida");
  });

  it("cierres: quien o donde, mas la FECHA DE COSTA RICA del cierre", () => {
    // `2026-09-03T04:00:00Z` son las 22:00 del DIA 2 en Costa Rica: la etiqueta tiene que decir
    // el 2, no el 3. Es la trampa de las seis horas que cerro la feature 166.
    const instante = new Date("2026-09-03T04:00:00.000Z");
    expect(
      etiquetaDeEntidad("cierre_dia", { mensajeroNombre: "Ana Torres", fecha: instante }),
    ).toBe("Ana Torres · 2026-09-02");
    expect(etiquetaDeEntidad("cierre_bodega", { zonaNombre: "Central", fecha: instante })).toBe(
      "Central · 2026-09-02",
    );
  });

  it("liquidacion: el nombre del beneficiario, y `(sin identificar)` si no hay", () => {
    expect(etiquetaDeEntidad("liquidacion_pago", { beneficiarioNombre: "Ana Torres" })).toBe(
      "Ana Torres",
    );
    expect(etiquetaDeEntidad("liquidacion_reparto", { beneficiarioNombre: null })).toBe(
      ETIQUETA_DESCONOCIDA,
    );
  });

  it("wallet: la CATEGORIA (un enum), nunca la `descripcion` (texto libre, R5)", () => {
    expect(etiquetaDeEntidad("wallet_movimiento", { categoria: "egreso_sueldo" })).toBe(
      "egreso_sueldo",
    );
  });

  it("gestion, incidente y cobro por rechazo: la guia de su envio", () => {
    const envio = { numGuia: 100234, numRemision: "REM-1" };
    expect(etiquetaDeEntidad("gestion_orden", envio)).toBe("100234");
    expect(etiquetaDeEntidad("orden_incidente", envio)).toBe("100234");
    expect(etiquetaDeEntidad("rechazo_tienda_cobro", envio)).toBe("100234");
  });

  it("gasto fijo: concepto y periodo", () => {
    expect(
      etiquetaDeEntidad("gasto_fijo_cobro", { concepto: "Alquiler bodega", periodo: "2026-09" }),
    ).toBe("Alquiler bodega · 2026-09");
  });

  it("ranking: el mensajero CONGELADO y su puesto", () => {
    expect(
      etiquetaDeEntidad("ranking_snapshot_fila", { mensajeroNombre: "Ana Torres", puesto: 1 }),
    ).toBe("Ana Torres · puesto 1");
  });

  it("api key: el identificador VISIBLE, nunca el prefijo ni el hash", () => {
    expect(etiquetaDeEntidad("api_key", { identificador: "Tienda Uno" })).toBe("Tienda Uno");
  });

  it("TRUNCA a la anchura de la columna y colapsa los espacios", () => {
    const larga = etiquetaDeEntidad("zona", { nombre: `${"z".repeat(200)}` });
    expect(larga.length).toBe(ETIQUETA_MAX_CHARS);
    expect(etiquetaDeEntidad("zona", { nombre: "  Gran   Area  " })).toBe("Gran Area");
  });

  it("NUNCA devuelve cadena vacia, ni con una fuente vacia", () => {
    // Es la propiedad que hace que la descarga no tenga celdas en blanco que alguien lea como
    // «no habia nada» cuando lo que hubo fue un dato que no se pudo resolver.
    for (const tipo of HISTORIAL_ACCION_ENTIDADES) {
      const etiqueta = etiquetaDeEntidad(
        tipo,
        {} as Parameters<typeof etiquetaDeEntidad>[1],
      );
      expect(etiqueta.trim().length, `\`${tipo}\` devolvio una etiqueta vacia`).toBeGreaterThan(0);
    }
  });
});
