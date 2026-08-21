import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi } from "vitest";

import type { RastreoPublicoConfig } from "@/lib/config/rastreo-publico";
import type {
  IRastreoPublicoRepository,
  OrdenRastreoFila,
  TransicionRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";

// Feature 229 — T2.4: la proyeccion publica del envio.
//
// R33 — el service se construye con DOBLES: ni Prisma, ni `next/headers`, ni HTTP. Si algun
// dia hiciera falta levantar algo para probarlo, la logica se habria escapado de la capa.

const CONFIG: RastreoPublicoConfig = {
  RATE_MAX: 8,
  RATE_WINDOW_MINUTES: 10,
  DIGITOS_SEGUNDO_FACTOR: 4,
  ZONA_HORARIA: "America/Costa_Rica",
};

const ORDEN_VIVA: OrdenRastreoFila = {
  id: "orden-1",
  numGuia: 4321,
  telefonoDest: "8888-7766",
  deletedAt: null,
};

function transicion(iso: string, estatusValue: string): TransicionRastreoFila {
  return { createdAt: new Date(iso), estatusValue };
}

/** Doble instrumentado: cuenta CADA llamada a datos, que es lo que mide R8/R21. */
function buildRepo(
  orden: OrdenRastreoFila | null,
  transiciones: readonly TransicionRastreoFila[] = [],
) {
  const buscarPorGuia = vi.fn(async (_numGuia: number) => orden);
  const listarTransiciones = vi.fn(async (_ordenId: string) => transiciones);
  const repo: IRastreoPublicoRepository = { buscarPorGuia, listarTransiciones };
  const llamadas = () => buscarPorGuia.mock.calls.length + listarTransiciones.mock.calls.length;
  return { repo, buscarPorGuia, listarTransiciones, llamadas };
}

function build(
  orden: OrdenRastreoFila | null,
  transiciones: readonly TransicionRastreoFila[] = [],
  config: RastreoPublicoConfig = CONFIG,
) {
  const dobles = buildRepo(orden, transiciones);
  return { ...dobles, service: new RastreoPublicoService(dobles.repo, config) };
}

const LINEA_COMPLETA: readonly TransicionRastreoFila[] = [
  transicion("2026-08-10T14:00:00.000Z", "en_preparacion"),
  transicion("2026-08-11T15:00:00.000Z", "en_bodega_central"),
  transicion("2026-08-12T16:00:00.000Z", "en_reparto"),
  transicion("2026-08-13T17:00:00.000Z", "entregada"),
];

describe("R33 — el service se construye con dobles y resuelve sin Prisma ni next/headers", () => {
  it("con un repositorio falso devuelve la proyeccion completa", async () => {
    const { service } = build(ORDEN_VIVA, LINEA_COMPLETA);
    const resultado = await service.consultar(4321, "7766");
    expect(resultado.estado).toBe("ok");
  });

  it("el modulo del service no importa Prisma ni next/headers", () => {
    const fuente = readFileSync(
      path.resolve(process.cwd(), "lib/services/RastreoPublicoService.ts"),
      "utf8",
    );
    const imports = fuente.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "";
    expect(imports).not.toContain("@prisma/client");
    expect(imports).not.toContain("next/headers");
    expect(imports).not.toContain("lib/db");
    // R24 — tampoco el service interno del historial ni su DTO.
    expect(imports).not.toContain("OrdenHistorial");
  });
});

describe("R6 — hacen falta DOS datos: la guia sola nunca devuelve seguimiento", () => {
  it("sin los cuatro digitos del telefono no consulta datos y rechaza", async () => {
    const { service, listarTransiciones } = build(ORDEN_VIVA, LINEA_COMPLETA);
    const resultado = await service.consultar(4321, "");
    expect(resultado).toEqual({ estado: "no_encontrado" });
    expect(listarTransiciones).not.toHaveBeenCalled();
  });

  it("un factor mas corto que el exigido tampoco basta", async () => {
    const { service, listarTransiciones } = build(ORDEN_VIVA, LINEA_COMPLETA);
    expect(await service.consultar(4321, "766")).toEqual({ estado: "no_encontrado" });
    expect(listarTransiciones).not.toHaveBeenCalled();
  });
});

describe("R7 — los cuatro casos malos responden IGUAL", () => {
  it("guia inexistente, factor errado, orden borrada y telefono de menos de 4 digitos devuelven un resultado estructuralmente identico", async () => {
    const inexistente = await build(null, LINEA_COMPLETA).service.consultar(9999, "7766");
    const factorErrado = await build(ORDEN_VIVA, LINEA_COMPLETA).service.consultar(4321, "0000");
    const borrada = await build(
      { ...ORDEN_VIVA, deletedAt: new Date("2026-08-14T00:00:00.000Z") },
      LINEA_COMPLETA,
    ).service.consultar(4321, "7766");
    const telefonoCorto = await build(
      { ...ORDEN_VIVA, telefonoDest: "77" },
      LINEA_COMPLETA,
    ).service.consultar(4321, "77");

    // Igualdad PROFUNDA: no basta con que los cuatro digan "no_encontrado", tienen que ser
    // el mismo objeto en forma y contenido. Cualquier payload seria un canal de fuga.
    expect(inexistente).toEqual({ estado: "no_encontrado" });
    expect(factorErrado).toEqual(inexistente);
    expect(borrada).toEqual(inexistente);
    expect(telefonoCorto).toEqual(inexistente);
    expect(new Set([inexistente, factorErrado, borrada, telefonoCorto].map((r) => JSON.stringify(r))).size).toBe(1);
  });
});

describe("R8 — mismo trabajo observable en los cuatro casos", () => {
  it("no corta antes cuando la guia no existe: el numero de llamadas a datos es el mismo en los cuatro casos", async () => {
    const escenarios = [
      { caso: "guia inexistente", ...build(null, LINEA_COMPLETA), factor: "7766" },
      { caso: "factor errado", ...build(ORDEN_VIVA, LINEA_COMPLETA), factor: "0000" },
      {
        caso: "orden borrada",
        ...build({ ...ORDEN_VIVA, deletedAt: new Date("2026-08-14T00:00:00.000Z") }, LINEA_COMPLETA),
        factor: "7766",
      },
      {
        caso: "telefono corto",
        ...build({ ...ORDEN_VIVA, telefonoDest: "77" }, LINEA_COMPLETA),
        factor: "7766",
      },
    ];

    const conteos: Record<string, number> = {};
    for (const escenario of escenarios) {
      await escenario.service.consultar(4321, escenario.factor);
      conteos[escenario.caso] = escenario.llamadas();
      // Y la busqueda por guia se INTENTA siempre, tambien cuando no existe.
      expect(escenario.buscarPorGuia).toHaveBeenCalledTimes(1);
    }

    expect(Object.values(conteos)).toEqual([1, 1, 1, 1]);
  });

  it("el modulo no tiene un retorno temprano para el caso 'la guia no existe'", () => {
    const fuente = readFileSync(
      path.resolve(process.cwd(), "lib/services/RastreoPublicoService.ts"),
      "utf8",
    );
    // Un unico `return { estado: "no_encontrado" }` por el camino de identificacion, DESPUES
    // de la comparacion: dos habrian sido la puerta al corte temprano.
    const antesDeComparar = fuente.slice(0, fuente.indexOf("const coincide"));
    expect(antesDeComparar).not.toContain('estado: "no_encontrado"');
  });
});

describe("R11 — normalizacion a digitos de AMBOS lados", () => {
  it("acepta el segundo factor con y sin separadores y normaliza tambien el telefono almacenado", async () => {
    const variantesDelFactor = ["7766", "77-66", " 7766 ", "77 66"];
    for (const factor of variantesDelFactor) {
      const { service } = build(ORDEN_VIVA, LINEA_COMPLETA);
      expect((await service.consultar(4321, factor)).estado).toBe("ok");
    }

    const variantesDelTelefono = ["8888-7766", "8888 7766", "+506 8888 7766", "(506) 8888-7766"];
    for (const telefonoDest of variantesDelTelefono) {
      const { service } = build({ ...ORDEN_VIVA, telefonoDest }, LINEA_COMPLETA);
      expect((await service.consultar(4321, "7766")).estado).toBe("ok");
    }
  });
});

describe("R14/R20 — la linea son hitos YA OCURRIDOS y el vigente es el ultimo", () => {
  it("devuelve la secuencia de hitos ocurridos con sus fechas y no añade ninguna entrada posterior a la ultima transicion", async () => {
    const { service } = build(ORDEN_VIVA, LINEA_COMPLETA);
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");

    expect(resultado.envio.linea.map((entrada) => entrada.hito)).toEqual([
      "registrado",
      "en_bodega",
      "en_reparto",
      "entregado",
    ]);
    // Nada despues del ultimo hecho registrado: ni "en camino", ni pasos pendientes (G10).
    expect(resultado.envio.linea).toHaveLength(4);
    expect(resultado.envio.linea.at(-1)?.fecha).toBe("2026-08-13T11:00-06:00");
  });

  it("el hito vigente coincide siempre con el ultimo de la linea de tiempo", async () => {
    const historiales: readonly TransicionRastreoFila[][] = [
      [transicion("2026-08-10T14:00:00.000Z", "en_preparacion")],
      [...LINEA_COMPLETA],
      [
        transicion("2026-08-10T14:00:00.000Z", "en_preparacion"),
        transicion("2026-08-11T14:00:00.000Z", "rechazada"),
        transicion("2026-08-12T14:00:00.000Z", "por_devolver"),
        transicion("2026-08-13T14:00:00.000Z", "devuelta_a_tienda"),
      ],
      [
        transicion("2026-08-10T14:00:00.000Z", "en_preparacion"),
        transicion("2026-08-11T14:00:00.000Z", "un_estatus_huerfano"),
      ],
    ];
    for (const historial of historiales) {
      const { service } = build(ORDEN_VIVA, historial);
      const resultado = await service.consultar(4321, "7766");
      if (resultado.estado !== "ok") throw new Error("se esperaba ok");
      const ultimo = resultado.envio.linea.at(-1);
      expect(resultado.envio.hitoVigente).toBe(ultimo?.hito);
      expect(resultado.envio.actualizadoEn).toBe(ultimo?.fecha);
    }
  });

  it("ordena la linea de forma ascendente aunque el repositorio devuelva las filas desordenadas", async () => {
    const { service } = build(ORDEN_VIVA, [...LINEA_COMPLETA].reverse());
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.envio.linea.map((entrada) => entrada.hito)).toEqual([
      "registrado",
      "en_bodega",
      "en_reparto",
      "entregado",
    ]);
  });
});

describe("R18 — colapso de rachas del mismo hito (G9)", () => {
  it("colapsa transiciones consecutivas del mismo hito conservando la fecha de la primera", async () => {
    const { service } = build(ORDEN_VIVA, [
      transicion("2026-08-10T14:00:00.000Z", "en_preparacion"), // registrado
      transicion("2026-08-10T15:00:00.000Z", "por_recolectar_en_tienda"), // registrado
      transicion("2026-08-10T16:00:00.000Z", "recolectando"), // registrado
      transicion("2026-08-11T14:00:00.000Z", "en_bodega_central"), // en_bodega
      transicion("2026-08-11T18:00:00.000Z", "en_bodega_satelite"), // en_bodega
      transicion("2026-08-12T14:00:00.000Z", "entregada"), // entregado
    ]);
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");

    expect(resultado.envio.linea).toEqual([
      { hito: "registrado", fecha: "2026-08-10T08:00-06:00" }, // la PRIMERA de la racha
      { hito: "en_bodega", fecha: "2026-08-11T08:00-06:00" },
      { hito: "entregado", fecha: "2026-08-12T08:00-06:00" },
    ]);
  });

  it("una racha que vuelve al mismo hito mas tarde SI produce dos entradas (solo colapsa lo consecutivo)", async () => {
    const { service } = build(ORDEN_VIVA, [
      transicion("2026-08-10T14:00:00.000Z", "en_reparto"),
      transicion("2026-08-11T14:00:00.000Z", "reprogramada"),
      transicion("2026-08-12T14:00:00.000Z", "en_reparto"),
    ]);
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.envio.linea.map((entrada) => entrada.hito)).toEqual([
      "en_reparto",
      "reprogramado",
      "en_reparto",
    ]);
  });

  // -----------------------------------------------------------------------------------------
  // FEATURE 235 (T1.4, R38) — el ciclo de AYUDA A LA TIENDA es INVISIBLE para el destinatario.
  //
  // P3 se firmo el 2026-08-19: `ayuda_tienda` comparte hito con `en_reparto`, porque para el
  // cliente final no ha cambiado nada — el paquete sigue con el mensajero — y quien resuelve la
  // incidencia es asunto interno. Este caso es lo que convierte esa firma en un hecho comprobable:
  // el colapso de rachas hace que las TRES transiciones se vean como UNA sola entrada.
  //
  // Va aqui, junto al caso hermano de la reprogramada, a proposito: los dos son el mismo mecanismo
  // y sus resultados son DISTINTOS (uno colapsa, el otro no). Leerlos juntos es lo que explica por
  // que.
  // -----------------------------------------------------------------------------------------
  it("235/R38: `en_reparto -> ayuda_tienda -> en_reparto` produce UNA sola entrada «En reparto»", () => {
    return (async () => {
      const { service } = build(ORDEN_VIVA, [
        transicion("2026-08-10T14:00:00.000Z", "en_reparto"),
        transicion("2026-08-10T16:00:00.000Z", "ayuda_tienda"), // el mensajero pide ayuda
        transicion("2026-08-10T18:00:00.000Z", "en_reparto"), // la tienda o el mensajero la rescata
      ]);
      const resultado = await service.consultar(4321, "7766");
      if (resultado.estado !== "ok") throw new Error("se esperaba ok");

      // UNA entrada, con la fecha de la PRIMERA de la racha: el destinatario no ve ningun tramite
      // nuestro, ni al pedir ayuda ni al rescatar.
      expect(resultado.envio.linea).toEqual([
        { hito: "en_reparto", fecha: "2026-08-10T08:00-06:00" },
      ]);
    })();
  });

  it("235/R38: y el hito VIGENTE mientras la orden esta en ayuda sigue siendo «En reparto»", () => {
    return (async () => {
      const { service } = build(ORDEN_VIVA, [
        transicion("2026-08-10T14:00:00.000Z", "en_reparto"),
        transicion("2026-08-10T16:00:00.000Z", "ayuda_tienda"),
      ]);
      const resultado = await service.consultar(4321, "7766");
      if (resultado.estado !== "ok") throw new Error("se esperaba ok");
      // Sin este caso, el anterior no distinguiria «colapsa» de «la ultima no se pinta».
      expect(resultado.envio.linea.map((e) => e.hito)).toEqual(["en_reparto"]);
    })();
  });
});

describe("R19 — dia y hora en el calendario del negocio", () => {
  it("formatea dia y hora en el calendario del negocio para un instante UTC conocido", async () => {
    // 2026-08-15T02:30Z son las 20:30 del DIA ANTERIOR en Costa Rica (UTC-6): el dia
    // cambia, no solo la hora. Un formateo en UTC daria el 15 y mentiria al destinatario.
    const { service } = build(ORDEN_VIVA, [transicion("2026-08-15T02:30:00.000Z", "entregada")]);
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.envio.linea[0].fecha).toBe("2026-08-14T20:30-06:00");
  });

  it("la zona sale de la CONFIGURACION: con otra zona, el mismo instante da otra hora", async () => {
    const { service } = build(
      ORDEN_VIVA,
      [transicion("2026-08-15T02:30:00.000Z", "entregada")],
      { ...CONFIG, ZONA_HORARIA: "UTC" },
    );
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.envio.linea[0].fecha).toBe("2026-08-15T02:30Z");
  });

  it("el modulo del service no hardcodea ninguna zona horaria ni pais", () => {
    const fuente = readFileSync(
      path.resolve(process.cwd(), "lib/services/RastreoPublicoService.ts"),
      "utf8",
    );
    for (const literal of ["America/", "Costa_Rica", "Costa Rica", "UTC-6", "GMT-6"]) {
      expect(fuente).not.toContain(literal);
    }
  });
});

describe("R21 — una sola lectura del historial", () => {
  it("lee el historial con una sola llamada al repositorio", async () => {
    const { service, listarTransiciones, buscarPorGuia } = build(ORDEN_VIVA, LINEA_COMPLETA);
    await service.consultar(4321, "7766");
    expect(listarTransiciones).toHaveBeenCalledTimes(1);
    expect(listarTransiciones).toHaveBeenCalledWith("orden-1");
    expect(buscarPorGuia).toHaveBeenCalledTimes(1);
  });
});

describe("R17 — una fila huerfana no rompe la proyeccion", () => {
  it("un estatus fuera del catalogo aparece como hito neutral y su value crudo no viaja", async () => {
    const { service } = build(ORDEN_VIVA, [
      transicion("2026-08-10T14:00:00.000Z", "en_preparacion"),
      transicion("2026-08-11T14:00:00.000Z", "en_fulfillment"),
    ]);
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.envio.linea.map((entrada) => entrada.hito)).toEqual([
      "registrado",
      "en_proceso",
    ]);
    expect(JSON.stringify(resultado)).not.toContain("en_fulfillment");
  });
});

describe("R22 — el DTO es la lista blanca cerrada, construida campo a campo", () => {
  it("devuelve exactamente numGuia, hitoVigente, actualizadoEn y linea, y ningun id interno", async () => {
    const { service } = build(ORDEN_VIVA, LINEA_COMPLETA);
    const resultado = await service.consultar(4321, "7766");
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");

    expect(Object.keys(resultado.envio).sort()).toEqual([
      "actualizadoEn",
      "hitoVigente",
      "linea",
      "numGuia",
    ]);
    for (const entrada of resultado.envio.linea) {
      expect(Object.keys(entrada).sort()).toEqual(["fecha", "hito"]);
    }
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain("orden-1"); // el id interno se queda en el service
    expect(serializado).not.toContain("8888"); // ni un digito del telefono del destinatario
  });
});
