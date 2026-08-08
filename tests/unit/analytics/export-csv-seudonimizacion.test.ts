import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
} from "@/app/(app)/analitica/_components/operativo/analitica-operativa-descarga-columnas";
import { filasDeSerie } from "@/app/(app)/analitica/_components/operativo/export-operativo";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { construirDescarga } from "@/lib/utils/descarga-dataset";

import { AHORA, TIENDA, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 134 — R8 y R9. EL TEST DE FUGA (T3.1, task BLINDADA).
//
// Es la razon de ser de esta feature. Una columna de uuids reales dentro de un `.csv`
// descargable es la fuga mas dificil de retirar que esta app puede producir: el archivo se
// guarda, se reenvia por WhatsApp, se sube a un Drive compartido y se abre seis meses
// despues, cuando el filtro que lo genero ya no existe. No hay parche que lo recoja.
//
// LAS CUATRO REGLAS DEL BLINDAJE, y como las cumple este archivo:
//
//  1. LA ASERCION VA SOBRE EL STRING que devuelve `construirDescarga`, no sobre el objeto en
//     memoria. Un objeto de filas impecable que se serializa mal sigue siendo una fuga, y un
//     test que mirase `filas` no la veria.
//  2. LA FIXTURE DEVUELVE UUIDS DE VERDAD. Un repositorio falso que devolviera «Mensajero 1»
//     o «m-1» daria verde AUNQUE LA POLITICA DE IDENTIDAD NO SE APLICARA: verde gratuito. Los
//     uuids concretos se buscan literalmente dentro del texto del archivo.
//  3. SE EJECUTA LA CADENA COMPLETA: repositorio falso -> `AnaliticaOperativaService` ->
//     `consultarAnaliticaOperativa` con actor `adminTienda` -> proyeccion -> generador. No se
//     cortocircuita el servicio, que es justo la capa donde vive la garantia (la 126 la puso
//     ahi a proposito: «el id real no llega siquiera a cruzar la frontera servicio-borde, asi
//     que ningun borde futuro —la 134, por ejemplo— puede olvidarla»).
//  4. SU MUTACION ESTA COMPROBADA y su salida pegada en `progress/impl_134.md`.

/** Uuids de VERDAD, con la forma exacta que tendria un id de mensajero en produccion. */
const UUID_A = "3f0a7c62-1111-4a1e-9e21-aaaaaaaaaaaa";
const UUID_B = "3f0a7c62-2222-4a1e-9e21-bbbbbbbbbbbb";

const CUBOS = [
  cubo({ fecha: "2026-08-01", mensajeroId: UUID_A, entregas: 5 }),
  cubo({ fecha: "2026-08-01", mensajeroId: UUID_B, entregas: 3 }),
];

/** Cualquier uuid, no solo los de la fixture: la forma misma no puede aparecer. */
const FORMA_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

/**
 * LA CADENA COMPLETA. Devuelve el TEXTO del archivo tal y como se descargaria.
 *
 * El servicio real (no un doble) recibe los cubos con los uuids y aplica la politica de
 * identidad del actor; el borde real resuelve el alcance y audita lo que haya que auditar.
 * Aqui solo se inyectan los dobles de INFRAESTRUCTURA (repositorio y reloj).
 */
async function csvDeAdminTienda(): Promise<string> {
  const resultado = await consultarAnaliticaOperativa(
    { metricaId: "entregas", raw: { rango: "dia" }, desagregacion: "mensajero" },
    {
      service: servicioCon(rollupFalso(CUBOS)),
      getActor: async () => TIENDA,
      now: () => AHORA,
    },
  );
  if (resultado.status !== "ok") {
    throw new Error(`la consulta no fue ok: ${JSON.stringify(resultado)}`);
  }

  const archivo = await construirDescarga({
    tipo: "csv",
    titulo: "Entregas por mensajero",
    columnas: COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
    filas: filasDeSerie([{ etiqueta: "Entregas", serie: resultado.datos }]),
  });
  return String(archivo.contenido);
}

describe("Feature 134 (R8) — el archivo de un adminTienda no lleva identidades", () => {
  it("el CSV de un adminTienda no contiene ningun uuid de mensajero", async () => {
    const contenido = await csvDeAdminTienda();

    // (1) La asercion sobre EL TEXTO del archivo.
    expect(contenido).not.toContain(UUID_A);
    expect(contenido).not.toContain(UUID_B);
    expect(contenido).not.toMatch(FORMA_UUID);

    // Y el archivo NO esta vacio de contenido: sin esto, «no hay uuids» lo cumpliria
    // tambien un archivo sin filas, y la garantia seria falsa por vacio.
    expect(contenido).toContain("Mensajero 1");
    expect(contenido).toContain("Mensajero 2");

    const [, ...datos] = contenido.split("\r\n");
    expect(datos).toHaveLength(CUBOS.length);
    // El desglose se CONSERVA: dos mensajeros siguen siendo dos filas con sus numeros.
    const valores = datos.map((l) => l.split(",")[3]).sort();
    expect(valores).toEqual(["3", "5"]);
  });

  it("y la fixture lleva uuids de verdad: sin esto el caso anterior seria un verde gratuito", () => {
    // Regla 2 del blindaje, hecha comprobable. Si alguien «simplifica» la fixture a
    // etiquetas ya limpias, este caso cae y dice exactamente por que.
    expect(UUID_A).toMatch(FORMA_UUID);
    expect(UUID_B).toMatch(FORMA_UUID);
    expect(CUBOS.map((c) => c.mensajeroId)).toEqual([UUID_A, UUID_B]);
  });

  it("y la cadena pasa por el SERVICIO de verdad, no por una serie fabricada a mano", async () => {
    // Regla 3 del blindaje. El repositorio falso CUENTA sus llamadas: si alguien
    // cortocircuitara el servicio, aqui no habria ninguna y el caso lo dice.
    const rollup = rollupFalso(CUBOS);
    const resultado = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia" }, desagregacion: "mensajero" },
      { service: servicioCon(rollup), getActor: async () => TIENDA, now: () => AHORA },
    );
    expect(resultado.status).toBe("ok");
    expect(rollup.llamadasAgregar.length).toBeGreaterThan(0);
  });
});

describe("Feature 134 (R9) — ninguna celda permite recuperar el id real", () => {
  it("el archivo no incluye ningun mapa seudonimo→id ni valor derivado del uuid", async () => {
    const contenido = await csvDeAdminTienda();

    // Ningun prefijo, sufijo ni tramo del uuid: un `uuid.slice(0,8)` «para poder cruzar los
    // datos luego» es exactamente el mapa de vuelta que R9 prohibe.
    for (const uuid of [UUID_A, UUID_B]) {
      for (const largo of [4, 6, 8, 12]) {
        expect(contenido).not.toContain(uuid.slice(0, largo));
        expect(contenido).not.toContain(uuid.slice(-largo));
      }
      // Y sin los guiones, por si alguien lo «normaliza» antes de escribirlo.
      expect(contenido).not.toContain(uuid.replace(/-/g, ""));
    }

    // Ninguna celda es funcion inyectable del uuid: no hay celda que sea un tramo suyo.
    const celdas = contenido
      .split("\r\n")
      .flatMap((l) => l.split(","))
      .filter((c) => c.length >= 4);
    for (const celda of celdas) {
      expect(UUID_A.includes(celda), `la celda "${celda}" es un tramo del uuid`).toBe(false);
      expect(UUID_B.includes(celda), `la celda "${celda}" es un tramo del uuid`).toBe(false);
    }

    // Y no hay ninguna columna de identidad donde colgar el mapa. Se compara PALABRA a
    // palabra: «Limitacion conocida» contiene «id» como subcadena y no es una identidad.
    const palabras = contenido
      .split("\r\n")[0]
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((p) => p !== "");
    for (const prohibido of ["ref", "hash", "id", "ids", "uuid", "clave", "mensajero"]) {
      expect(palabras, `la cabecera declara una columna "${prohibido}"`).not.toContain(prohibido);
    }
  });
});
