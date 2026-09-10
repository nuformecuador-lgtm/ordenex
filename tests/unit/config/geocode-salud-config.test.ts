import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGeocodeSaludConfig } from "@/lib/config/geocode-salud";

// FICHA 401 (T1) — R29 y R30: los CINCO numeros de la salud del geocodificador.
//
// Los defaults se afirman A MANO, uno a uno. Compararlos contra `loadGeocodeSaludConfig()` sin
// mas —o contra una constante exportada del propio modulo— seria comparar la fuente consigo
// misma y estaria verde para siempre (memoria del repo: «asercion contra su propia fuente»).
// Estos cinco numeros SON el contrato de calibracion de la ficha (design §4 y §6.2).

const VARIABLES = [
  "GEOCODE_CAIDA_JOBS_MINIMOS",
  "GEOCODE_CAIDA_VENTANA_MIN",
  "GEOCODE_RECUPERACION_LOTE",
  "GEOCODE_RECUPERACION_ESPACIADO_MS",
  "GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN",
] as const;

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  for (const v of VARIABLES) delete process.env[v];
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
});

describe("401/R29 — sin ninguna variable de entorno, los cinco defaults", () => {
  it("⭑ umbral 3 jobs, ventana 60 min, lote 5, espaciado 60000 ms y enfriamiento 60 min", () => {
    // LITERAL y a mano: es el punto de equilibrio calibrado contra el historico medido del
    // incidente del 2026-09-08 (design §4.1). Cambiarlo es una decision de producto, no un
    // refactor, y por eso tiene que poner este test rojo.
    expect(loadGeocodeSaludConfig()).toEqual({
      GEOCODE_CAIDA_JOBS_MINIMOS: 3,
      GEOCODE_CAIDA_VENTANA_MIN: 60,
      GEOCODE_RECUPERACION_LOTE: 5,
      GEOCODE_RECUPERACION_ESPACIADO_MS: 60000,
      GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN: 60,
    });
  });

  it("el umbral por defecto NO es 1: un despliegue sin credencial no puede avisar solo", () => {
    // design §4.3: el marcador de la 400 cubre tambien «falta GOOGLE_MAPS_API_KEY», que aparece
    // de forma legitima y momentanea en ventanas de despliegue.
    expect(loadGeocodeSaludConfig().GEOCODE_CAIDA_JOBS_MINIMOS).toBeGreaterThan(1);
  });

  it("el espaciado por defecto es el intervalo del cron (60 s), no menos", () => {
    // R22: con menos, mas de uno de la tanda seria reclamable en la misma corrida de 10 y la
    // recuperacion empezaria a desplazar a los otros ocho tipos de job (ficha 402).
    expect(loadGeocodeSaludConfig().GEOCODE_RECUPERACION_ESPACIADO_MS).toBeGreaterThanOrEqual(
      60000,
    );
  });

  it("el lote por defecto es la MITAD del lote del drenador (10), no mas", () => {
    // design §6.2: aunque toda una tanda cayera en la misma corrida, quedarian 5 turnos libres.
    expect(loadGeocodeSaludConfig().GEOCODE_RECUPERACION_LOTE).toBeLessThanOrEqual(5);
  });
});

describe("401/R30 — un valor ausente o invalido cae al default y NO lanza", () => {
  it.each(["", "no-es-un-numero", "0", "-7"])(
    "⭑ el valor %j deja los cinco defaults intactos, sin excepcion",
    (crudo) => {
      for (const v of VARIABLES) process.env[v] = crudo;

      expect(() => loadGeocodeSaludConfig()).not.toThrow();
      const config = loadGeocodeSaludConfig();
      expect(config.GEOCODE_CAIDA_JOBS_MINIMOS).toBe(3);
      expect(config.GEOCODE_CAIDA_VENTANA_MIN).toBe(60);
      expect(config.GEOCODE_RECUPERACION_LOTE).toBe(5);
      expect(config.GEOCODE_RECUPERACION_ESPACIADO_MS).toBe(60000);
      expect(config.GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN).toBe(60);
    },
  );

  it("⭑ cargar la configuracion NUNCA puede tumbar una corrida del drenador", () => {
    // La propiedad de R30 dicha en su forma operativa: el drenador sirve a NUEVE tipos de job y
    // una excepcion aqui se los llevaria a todos por delante.
    process.env.GEOCODE_CAIDA_JOBS_MINIMOS = "{}";
    process.env.GEOCODE_RECUPERACION_ESPACIADO_MS = "  ";
    process.env.GEOCODE_RECUPERACION_LOTE = "NaN";
    expect(() => loadGeocodeSaludConfig()).not.toThrow();
  });

  it("LIMITE CONOCIDO, declarado: `parseInt` es indulgente y «3.9.9» se lee como 3", () => {
    // No es un descuido: es el comportamiento LITERAL de `readPositiveInt` en `lib/config/jobs.ts`,
    // que este modulo clona a proposito para no inventar una segunda forma de leer enteros. Se
    // escribe aqui para que quede MEDIDO y no aparezca como sorpresa el dia que alguien ponga
    // «3.5» en un `.env` y obtenga 3. No lanza, que es lo que R30 exige.
    process.env.GEOCODE_CAIDA_JOBS_MINIMOS = "3.9.9";
    expect(() => loadGeocodeSaludConfig()).not.toThrow();
    expect(loadGeocodeSaludConfig().GEOCODE_CAIDA_JOBS_MINIMOS).toBe(3);
  });

  it("un valor VALIDO si se respeta: los cinco son configurables de verdad (Q2)", () => {
    process.env.GEOCODE_CAIDA_JOBS_MINIMOS = "7";
    process.env.GEOCODE_CAIDA_VENTANA_MIN = "15";
    process.env.GEOCODE_RECUPERACION_LOTE = "2";
    process.env.GEOCODE_RECUPERACION_ESPACIADO_MS = "90000";
    process.env.GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN = "120";

    expect(loadGeocodeSaludConfig()).toEqual({
      GEOCODE_CAIDA_JOBS_MINIMOS: 7,
      GEOCODE_CAIDA_VENTANA_MIN: 15,
      GEOCODE_RECUPERACION_LOTE: 2,
      GEOCODE_RECUPERACION_ESPACIADO_MS: 90000,
      GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN: 120,
    });
  });
});
