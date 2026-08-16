import { describe, it, expect } from "vitest";

import { loadRastreoPublicoConfig } from "@/lib/config/rastreo-publico";
import type {
  IRastreoPublicoRepository,
  OrdenRastreoFila,
  TransicionRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import type { RastreoPublicoDTO } from "@/lib/types/rastreo-publico";

// Feature 229 — GUARDIA DE NO-FUGA DE PII (T4.1, cubre R22 y R23).
//
// R22 no se cumple "teniendo cuidado": se cumple porque la lista blanca es un MECANISMO
// comprobable. Esta guardia lo comprueba por los dos lados a la vez:
//
//   1. FORMA — el conjunto EXACTO de claves del DTO publico es {numGuia, hitoVigente,
//      actualizadoEn, linea}, y el de CADA entrada de `linea` es {hito, fecha}. Se compara el
//      conjunto entero, no una lista de "debe contener": un campo de mas es una fuga, no una
//      mejora (G11/G14), y un `toContain` no lo veria nunca.
//   2. CONTENIDO — ninguno de los valores sensibles de una orden poblada aparece en el
//      resultado serializado. Los valores de prueba son INCONFUNDIBLES (`FUGA-...`) para que
//      la busqueda no pueda dar un falso positivo contra una fecha o un numero de guia.
//
// El doble del repositorio devuelve A PROPOSITO filas MAS ANCHAS que su contrato: trae
// `direccion`, `montoCobrar`, `producto`, `notas`, `telefonoDest`, `mensajeroAsignadoId`, y en
// el historial `actorNombre`, `motivo`, `origenTipo`, `gestionOrdenId`, `intentos` y `umbral`.
// Eso NO es un descuido del test: es el escenario que la guardia tiene que cazar. Si el service
// construyera el DTO con un spread de la fila (`{...fila}`) en vez de campo a campo, todo eso
// cruzaria la frontera y aqui se veria. Con un doble "limpio" la guardia no probaria nada.

/* -------------------------------------------------------------------------- */
/* La orden poblada: lo que de verdad hay en la fila, no lo que deberia salir   */
/* -------------------------------------------------------------------------- */

/** Valores de prueba inconfundibles: si uno de estos aparece en la salida, es una fuga. */
const SENSIBLES = {
  ordenId: "FUGA-ID-INTERNO-0b1c2d3e",
  direccion: "FUGA-DIRECCION-Cartago-de-la-iglesia-200m-sur",
  montoCobrar: "FUGA-MONTO-48750",
  producto: "FUGA-PRODUCTO-audifonos-inalambricos",
  notas: "FUGA-NOTAS-tocar-el-porton-de-atras",
  destinatario: "FUGA-DESTINATARIO-Jimena-Porras",
  telefonoCrudo: "8712-3456",
  telefonoNormalizado: "50687123456",
  mensajeroId: "FUGA-MENSAJERO-ID-77",
  mensajeroNombre: "FUGA-MENSAJERO-Kevin-Rojas",
  tiendaId: "FUGA-TIENDA-ID-12",
  tiendaNombre: "FUGA-TIENDA-Boutique-Lila",
  zonaId: "FUGA-ZONA-ID-3",
  actorUsuarioId: "FUGA-ACTOR-ID-91",
  actorNombre: "FUGA-ACTOR-Andrea-Mora",
  motivo: "FUGA-MOTIVO-el-cliente-no-contesto-el-telefono",
  origenTipo: "FUGA-ORIGEN-gestion_mensajero",
  gestionOrdenId: "FUGA-GESTION-ID-55",
  estatusId: "FUGA-ESTATUS-ID-4",
} as const;

/** El segundo factor correcto para `telefonoCrudo` (ultimos 4 digitos). */
const FACTOR_CORRECTO = "3456";
const NUM_GUIA = 987_654;

/**
 * La fila de `orden` tal y como saldria de un repositorio DESCUIDADO: el contrato solo pide
 * cuatro campos, esta trae la orden entera. El service tiene que ignorar el resto.
 */
interface FilaOrdenPoblada extends OrdenRastreoFila {
  readonly direccion: string;
  readonly montoCobrar: string;
  readonly producto: string;
  readonly notas: string;
  readonly destinatario: string;
  readonly mensajeroAsignadoId: string;
  readonly mensajeroNombre: string;
  readonly tiendaId: string;
  readonly tiendaNombre: string;
  readonly zonaId: string;
}

/** Lo mismo para el historial: la fila cruda lleva actor, motivo, origen y gestion. */
interface FilaTransicionPoblada extends TransicionRastreoFila {
  readonly id: string;
  readonly estatusDestinoId: string;
  readonly actorUsuarioId: string;
  readonly actorNombre: string;
  readonly motivo: string;
  readonly origenTipo: string;
  readonly gestionOrdenId: string;
  readonly intentos: number;
  readonly umbral: number;
}

const FILA_POBLADA: FilaOrdenPoblada = {
  id: SENSIBLES.ordenId,
  numGuia: NUM_GUIA,
  telefonoDest: SENSIBLES.telefonoCrudo,
  deletedAt: null,
  direccion: SENSIBLES.direccion,
  montoCobrar: SENSIBLES.montoCobrar,
  producto: SENSIBLES.producto,
  notas: SENSIBLES.notas,
  destinatario: SENSIBLES.destinatario,
  mensajeroAsignadoId: SENSIBLES.mensajeroId,
  mensajeroNombre: SENSIBLES.mensajeroNombre,
  tiendaId: SENSIBLES.tiendaId,
  tiendaNombre: SENSIBLES.tiendaNombre,
  zonaId: SENSIBLES.zonaId,
};

function transicionPoblada(estatusValue: string, isoUtc: string): FilaTransicionPoblada {
  return {
    createdAt: new Date(isoUtc),
    estatusValue,
    id: `FUGA-HISTORIAL-ID-${estatusValue}`,
    estatusDestinoId: SENSIBLES.estatusId,
    actorUsuarioId: SENSIBLES.actorUsuarioId,
    actorNombre: SENSIBLES.actorNombre,
    motivo: SENSIBLES.motivo,
    origenTipo: SENSIBLES.origenTipo,
    gestionOrdenId: SENSIBLES.gestionOrdenId,
    intentos: 3,
    umbral: 3,
  };
}

const TRANSICIONES: readonly FilaTransicionPoblada[] = [
  transicionPoblada("en_preparacion", "2026-03-01T15:00:00.000Z"),
  transicionPoblada("en_bodega_central", "2026-03-02T15:00:00.000Z"),
  transicionPoblada("en_reparto", "2026-03-03T15:00:00.000Z"),
  transicionPoblada("devuelta", "2026-03-04T15:00:00.000Z"),
  transicionPoblada("entregada", "2026-03-05T15:00:00.000Z"),
];

class RepositorioPoblado implements IRastreoPublicoRepository {
  async buscarPorGuia(numGuia: number): Promise<OrdenRastreoFila | null> {
    return numGuia === NUM_GUIA ? FILA_POBLADA : null;
  }

  async listarTransiciones(): Promise<readonly TransicionRastreoFila[]> {
    return TRANSICIONES;
  }
}

async function proyectar(): Promise<RastreoPublicoDTO> {
  const service = new RastreoPublicoService(
    new RepositorioPoblado(),
    loadRastreoPublicoConfig(),
  );
  const resultado = await service.consultar(NUM_GUIA, FACTOR_CORRECTO);
  expect(resultado.estado, "el escenario base tiene que identificar el envio").toBe("ok");
  if (resultado.estado !== "ok") throw new Error("escenario base roto");
  return resultado.envio;
}

/* -------------------------------------------------------------------------- */
/* Los dos barridos, escritos como FUNCIONES para poder probarlos con una fuga  */
/* -------------------------------------------------------------------------- */

/** Todas las claves de un objeto y de sus descendientes, sin repetir. */
function clavesProfundas(valor: unknown, acumulado = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) {
    for (const item of valor) clavesProfundas(item, acumulado);
    return acumulado;
  }
  if (typeof valor === "object" && valor !== null) {
    for (const [clave, hijo] of Object.entries(valor)) {
      acumulado.add(clave);
      clavesProfundas(hijo, acumulado);
    }
  }
  return acumulado;
}

/** Cuales de los valores sensibles aparecen en la representacion serializada del objeto. */
function fugasDeValor(valor: unknown): string[] {
  const serializado = JSON.stringify(valor);
  return Object.entries(SENSIBLES)
    .filter(([, sensible]) => serializado.includes(sensible))
    .map(([nombre]) => nombre);
}

/**
 * Claves que NO pueden existir en ninguna profundidad del resultado publico. Se vigilan por
 * NOMBRE ademas de por valor: un campo puede llegar vacio o nulo hoy y con dato mañana, y la
 * clave ya estaria abierta.
 */
const CLAVES_PROHIBIDAS = [
  "id",
  "ordenId",
  "estatusId",
  "estatusDestinoId",
  "estatusValue",
  "usuarioId",
  "actorUsuarioId",
  "actorNombre",
  "origenTipo",
  "motivo",
  "gestionOrdenId",
  "intentos",
  "umbral",
  "direccion",
  "montoCobrar",
  "producto",
  "notas",
  "destinatario",
  "telefonoDest",
  "mensajeroAsignadoId",
  "mensajeroNombre",
  "tiendaId",
  "tiendaNombre",
  "zonaId",
  "deletedAt",
] as const;

function clavesProhibidasPresentes(valor: unknown): string[] {
  const presentes = clavesProfundas(valor);
  return CLAVES_PROHIBIDAS.filter((clave) => presentes.has(clave));
}

/* -------------------------------------------------------------------------- */

describe("R22 — el DTO publico es una lista blanca CERRADA de cuatro campos", () => {
  it("el DTO público tiene exactamente numGuia, hitoVigente, actualizadoEn y linea, y cada entrada solo hito y fecha", async () => {
    const envio = await proyectar();

    expect(Object.keys(envio).sort()).toEqual([
      "actualizadoEn",
      "hitoVigente",
      "linea",
      "numGuia",
    ]);

    // Control de no-vacuidad: si la linea viniera vacia, el bucle de abajo no miraria nada.
    expect(envio.linea.length).toBeGreaterThan(0);

    for (const entrada of envio.linea) {
      expect(Object.keys(entrada).sort()).toEqual(["fecha", "hito"]);
    }
  });

  it("CONTRAPRUEBA: el barrido de claves caza un campo de mas en el DTO y en una entrada", async () => {
    // Una guardia que no puede fallar no vale nada. Se fabrica la fuga EN MEMORIA, sin dejar
    // nada en el arbol, y se comprueba que la misma comparacion la denuncia.
    const envio = await proyectar();

    const dtoFugado = { ...envio, direccion: SENSIBLES.direccion };
    expect(Object.keys(dtoFugado).sort()).not.toEqual([
      "actualizadoEn",
      "hitoVigente",
      "linea",
      "numGuia",
    ]);

    const entradaFugada = { ...envio.linea[0], motivo: SENSIBLES.motivo };
    expect(Object.keys(entradaFugada).sort()).not.toEqual(["fecha", "hito"]);
  });
});

describe("R23 — con una orden poblada, el resultado no contiene dirección, monto, mensajero, actor, motivo, intentos ni ids internos", () => {
  it("ningun VALOR sensible de la orden ni del historial aparece en el resultado serializado", async () => {
    const envio = await proyectar();

    // Control de no-vacuidad del barrido: los valores sensibles SI estan en la fila cruda que
    // el doble entrego. Sin esto, un `fugasDeValor` roto daria verde por no buscar nada.
    expect(fugasDeValor(FILA_POBLADA).sort()).toEqual(
      [
        "destinatario",
        "direccion",
        "mensajeroId",
        "mensajeroNombre",
        "montoCobrar",
        "notas",
        "ordenId",
        "producto",
        "telefonoCrudo",
        "tiendaId",
        "tiendaNombre",
        "zonaId",
      ].sort(),
    );
    expect(fugasDeValor(TRANSICIONES).length).toBeGreaterThan(0);

    expect(fugasDeValor(envio)).toEqual([]);
  });

  it("no aparece ningun `id` interno, ni `intentos`, ni `umbral`, ni ninguna otra clave prohibida", async () => {
    const envio = await proyectar();

    expect(clavesProhibidasPresentes(envio)).toEqual([]);

    // Nombrados uno a uno los tres que el requisito cita expresamente, para que su entrada no
    // pase inadvertida como "una clave mas de la lista".
    const claves = clavesProfundas(envio);
    expect(claves.has("id")).toBe(false);
    expect(claves.has("intentos")).toBe(false);
    expect(claves.has("umbral")).toBe(false);

    // Y el conjunto ENTERO de claves del DTO, a cualquier profundidad, es la lista blanca.
    expect([...claves].sort()).toEqual([
      "actualizadoEn",
      "fecha",
      "hito",
      "hitoVigente",
      "linea",
      "numGuia",
    ]);
  });

  it("CONTRAPRUEBA: los dos barridos cazan una fuga inyectada por spread de la fila", async () => {
    const envio = await proyectar();

    // Exactamente el error que R23 teme: construir el DTO heredando la fila en vez de
    // enumerando campos.
    const porSpread = { ...FILA_POBLADA, ...envio };

    expect(fugasDeValor(porSpread).length).toBeGreaterThan(0);
    expect(clavesProhibidasPresentes(porSpread).length).toBeGreaterThan(0);

    // Y lo mismo dentro de la linea de tiempo, que es donde vive el historial sensible.
    const lineaFugada = envio.linea.map((entrada, indice) => ({
      ...entrada,
      ...TRANSICIONES[indice % TRANSICIONES.length],
    }));
    expect(fugasDeValor(lineaFugada).length).toBeGreaterThan(0);
    expect(clavesProhibidasPresentes(lineaFugada)).toContain("motivo");
  });
});

describe("R23 — el telefono del destinatario, que es la ENTRADA, tampoco vuelve en la salida", () => {
  it("ni crudo ni normalizado: el segundo factor no se le devuelve al que lo tecleo", async () => {
    const serializado = JSON.stringify(await proyectar());

    expect(serializado).not.toContain(SENSIBLES.telefonoCrudo);
    expect(serializado).not.toContain(SENSIBLES.telefonoNormalizado);
    expect(serializado).not.toContain("87123456");

    // Lo UNICO que el consultante recupera de lo que tecleo es su propia guia (G13).
    expect(serializado).toContain(String(NUM_GUIA));
  });
});
