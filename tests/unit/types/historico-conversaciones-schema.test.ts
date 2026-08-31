import { describe, expect, it } from "vitest";

import {
  HILOS_LIMITE_MAXIMO,
  MENSAJES_LIMITE_MAXIMO,
  listarHilosHistoricoSchema,
  listarMensajesHistoricoSchema,
  type HiloHistoricoDTO,
} from "@/lib/types/historico-conversaciones";
import { BUSQUEDA_MAX_CHARS, BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";

// Feature 321 / T2.1 — el BORDE TIPADO de las dos entradas del histórico (R38) y la propiedad
// ESTRUCTURAL de la carga perezosa (R41).
//
// Lo que se mide aqui no es «zod funciona»: es que cada entrada mal formada que el design
// enumera —cursor incompleto, fecha que no es `YYYY-MM-DD`, lista vacia, pagina fuera de
// rango, clave desconocida— cae del lado del RECHAZO. Cada uno de esos `false` es una consulta
// que no se ejecuta.

const CURSOR_HILO_VALIDO = {
  ultimaActividadAt: "2026-08-28T18:00:00.000Z",
  ordenId: "orden-1",
  mensajeroId: "mensajero-1",
};

const ENTRADA_MENSAJES_VALIDA = { ordenId: "orden-1", mensajeroId: "mensajero-1" };

describe("listarHilosHistoricoSchema — borde del listado (R38)", () => {
  it("acepta la entrada vacia: sin filtro, sin cursor y sin limite es la primera pagina", () => {
    expect(listarHilosHistoricoSchema.safeParse({}).success).toBe(true);
  });

  it("acepta el filtro completo con cursor y limite dentro de rango", () => {
    const resultado = listarHilosHistoricoSchema.safeParse({
      filtro: {
        mensajero_id: ["m1", "m2"],
        fecha_desde: "2026-08-01",
        fecha_hasta: "2026-08-28",
        orden: "REM-1001",
        q: "maria",
      },
      cursor: CURSOR_HILO_VALIDO,
      limite: HILOS_LIMITE_MAXIMO,
    });
    expect(resultado.success).toBe(true);
  });

  // R33/R38 — la lista vacia NO es «sin filtro»: falla cerrado. Si pasara, el repositorio la
  // descartaria y el filtro degradaria a «todos», que es lo contrario de lo que el usuario pidio.
  it("RECHAZA `mensajero_id: []` (lista vacia)", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({ filtro: { mensajero_id: [] } }).success,
    ).toBe(false);
  });

  it("RECHAZA una fecha que no es YYYY-MM-DD", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({ filtro: { fecha_desde: "28/08/2026" } }).success,
    ).toBe(false);
  });

  // El regex mide la FORMA, y `2026-02-31` la cumple: sin el round-trip de
  // `esFechaCalendarioValida`, el dia RUEDA al 3 de marzo y el usuario recibe otro rango.
  it("RECHAZA una fecha con forma valida pero inexistente (2026-02-31)", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({ filtro: { fecha_desde: "2026-02-31" } }).success,
    ).toBe(false);
  });

  it("RECHAZA el rango invertido (desde > hasta)", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({
        filtro: { fecha_desde: "2026-08-28", fecha_hasta: "2026-08-01" },
      }).success,
    ).toBe(false);
  });

  it("RECHAZA `limite: 0`", () => {
    expect(listarHilosHistoricoSchema.safeParse({ limite: 0 }).success).toBe(false);
  });

  it("RECHAZA `limite: 999` (por encima del maximo del listado)", () => {
    expect(listarHilosHistoricoSchema.safeParse({ limite: 999 }).success).toBe(false);
    expect(
      listarHilosHistoricoSchema.safeParse({ limite: HILOS_LIMITE_MAXIMO + 1 }).success,
    ).toBe(false);
  });

  it("RECHAZA un limite no entero", () => {
    expect(listarHilosHistoricoSchema.safeParse({ limite: 12.5 }).success).toBe(false);
  });

  // R13/R15 — un cursor al que le faltan claves NO es un cursor: es una paginacion que se
  // saltaria el desempate y repetiria o perderia hilos.
  it("RECHAZA un cursor incompleto (solo `ordenId`)", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({ cursor: { ordenId: "x" } }).success,
    ).toBe(false);
  });

  it("RECHAZA un cursor sin `ultimaActividadAt` aunque traiga las dos claves de desempate", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({
        cursor: { ordenId: "x", mensajeroId: "m" },
      }).success,
    ).toBe(false);
  });

  it("ACEPTA `ultimaActividadAt: null` (es una POSICION del recorrido, no un cursor ausente)", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({
        cursor: { ...CURSOR_HILO_VALIDO, ultimaActividadAt: null },
      }).success,
    ).toBe(true);
  });

  it("RECHAZA un `ultimaActividadAt` que no es un instante ISO", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({
        cursor: { ...CURSOR_HILO_VALIDO, ultimaActividadAt: "2026-08-28" },
      }).success,
    ).toBe(false);
  });

  it("RECHAZA una clave desconocida en el nivel superior (.strict())", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({ pagina: 2 }).success,
    ).toBe(false);
  });

  it("RECHAZA una clave desconocida dentro del filtro (.strict())", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({ filtro: { cuerpo: "hola" } }).success,
    ).toBe(false);
  });

  // R37 — el minimo del borde es la MISMA constante que consume el control de texto.
  it("RECHAZA un termino por debajo de BUSQUEDA_MIN_CHARS y lo acepta justo en el minimo", () => {
    const corto = "x".repeat(BUSQUEDA_MIN_CHARS - 1);
    const justo = "x".repeat(BUSQUEDA_MIN_CHARS);
    expect(listarHilosHistoricoSchema.safeParse({ filtro: { q: corto } }).success).toBe(false);
    expect(listarHilosHistoricoSchema.safeParse({ filtro: { q: justo } }).success).toBe(true);
  });

  it("cuenta el termino DESPUES de recortar: '  a  ' es 1 caracter, no 5", () => {
    expect(listarHilosHistoricoSchema.safeParse({ filtro: { q: "  a  " } }).success).toBe(false);
  });

  it("RECHAZA un termino por encima de BUSQUEDA_MAX_CHARS", () => {
    expect(
      listarHilosHistoricoSchema.safeParse({ filtro: { q: "x".repeat(BUSQUEDA_MAX_CHARS + 1) } })
        .success,
    ).toBe(false);
  });
});

describe("listarMensajesHistoricoSchema — borde de la pagina del hilo (R38, R17)", () => {
  it("acepta la clave del hilo sin cursor: es la pagina MAS RECIENTE (R21)", () => {
    expect(listarMensajesHistoricoSchema.safeParse(ENTRADA_MENSAJES_VALIDA).success).toBe(true);
  });

  // R42 — el hilo es el PAR. Media clave no identifica nada.
  it("RECHAZA `{ ordenId }` sin `mensajeroId`", () => {
    expect(listarMensajesHistoricoSchema.safeParse({ ordenId: "orden-1" }).success).toBe(false);
  });

  it("RECHAZA `{ mensajeroId }` sin `ordenId`", () => {
    expect(
      listarMensajesHistoricoSchema.safeParse({ mensajeroId: "mensajero-1" }).success,
    ).toBe(false);
  });

  it("RECHAZA ids vacios", () => {
    expect(
      listarMensajesHistoricoSchema.safeParse({ ordenId: "", mensajeroId: "m" }).success,
    ).toBe(false);
  });

  // R17 — el hilo abierto NO se recorta por fecha, y eso se hace cumplir en el BORDE: la clave
  // no se ignora, se rechaza. Si el esquema la aceptara y el repositorio la ignorara, un
  // llamante futuro creeria que filtra.
  it("RECHAZA cualquier clave de fecha en la entrada del hilo (R17)", () => {
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ...ENTRADA_MENSAJES_VALIDA,
        fecha_desde: "2026-08-01",
      }).success,
    ).toBe(false);
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ...ENTRADA_MENSAJES_VALIDA,
        fecha_hasta: "2026-08-28",
      }).success,
    ).toBe(false);
  });

  it("RECHAZA un cursor de mensaje incompleto", () => {
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ...ENTRADA_MENSAJES_VALIDA,
        cursor: { id: "m-1" },
      }).success,
    ).toBe(false);
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ...ENTRADA_MENSAJES_VALIDA,
        cursor: { ocurridoAt: "2026-08-28T18:00:00.000Z" },
      }).success,
    ).toBe(false);
  });

  it("acepta un cursor de mensaje completo y `null` como ausencia de cursor", () => {
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ...ENTRADA_MENSAJES_VALIDA,
        cursor: { ocurridoAt: "2026-08-28T18:00:00.000Z", id: "m-1" },
      }).success,
    ).toBe(true);
    expect(
      listarMensajesHistoricoSchema.safeParse({ ...ENTRADA_MENSAJES_VALIDA, cursor: null }).success,
    ).toBe(true);
  });

  it("RECHAZA `limite: 0` y un limite por encima del maximo del hilo", () => {
    expect(
      listarMensajesHistoricoSchema.safeParse({ ...ENTRADA_MENSAJES_VALIDA, limite: 0 }).success,
    ).toBe(false);
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ...ENTRADA_MENSAJES_VALIDA,
        limite: MENSAJES_LIMITE_MAXIMO + 1,
      }).success,
    ).toBe(false);
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ...ENTRADA_MENSAJES_VALIDA,
        limite: MENSAJES_LIMITE_MAXIMO,
      }).success,
    ).toBe(true);
  });
});

describe("HiloHistoricoDTO — la carga perezosa es ESTRUCTURAL (R41)", () => {
  // Si alguien añadiera `mensajes` al DTO, esta linea deja de compilar: `never` no admite
  // valor. Es la mitad de la comprobacion que un `expect` en tiempo de ejecucion no puede
  // hacer, porque el tipo no existe en runtime.
  it("el TIPO del listado no declara ningun campo de mensajes", () => {
    type SinMensajes = "mensajes" extends keyof HiloHistoricoDTO ? never : true;
    const comprobacionDeTipos: SinMensajes = true;
    expect(comprobacionDeTipos).toBe(true);
  });

  // Y la mitad en runtime: un DTO construido con TODAS sus claves no tiene `mensajes`. Se
  // construye completo a proposito — un `{}` vacio pasaria el `in` sin demostrar nada.
  it("un DTO completo del listado no tiene la clave `mensajes`", () => {
    const fila: HiloHistoricoDTO = {
      ordenId: "orden-1",
      mensajeroId: "mensajero-1",
      numGuia: 1001,
      numRemision: "REM-1001",
      destinatario: "MARIA GONZALEZ",
      mensajeroNombre: "Juan Perez",
      telefonoVigente: "+50688880001",
      telefonosCount: 1,
      ultimaActividadAt: "2026-08-28T18:00:00.000Z",
      totalMensajes: 4,
    };
    expect("mensajes" in fila).toBe(false);
    expect(Object.keys(fila)).not.toContain("mensajes");
  });
});
