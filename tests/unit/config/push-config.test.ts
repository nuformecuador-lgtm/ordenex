import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PushNoConfiguradoError,
  clavePublicaPush,
  loadPushConfig,
  piezasVapidAusentes,
  pushConfigurado,
} from "@/lib/config/push";

// FICHA 410 (T2.1) — LAS CLAVES VAPID. Cubre R29 (solo por entorno y fuera del repo), R30 (sin
// ellas NADA lanza y NADA se bloquea, citando el NOMBRE de la variable) y R31/R32 (la privada no
// sale nunca; la publica se resuelve en tiempo de EJECUCION).
//
// Patron y arnes de `tests/unit/config/email-config.test.ts`, del que este canal es espejo.

const VARS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
const ORIG = new Map(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    const original = ORIG.get(v);
    if (original === undefined) delete process.env[v];
    else process.env[v] = original;
  }
});

function limpiar() {
  for (const v of VARS) delete process.env[v];
}

/** Valores de mentira. NO son claves reales y no hacen falta: nada aqui firma nada. */
const PUBLICA = "BPUBLICA-de-mentira-para-el-test";
const PRIVADA = "PRIVADA-de-mentira-para-el-test";

describe("410/R30 — sin claves VAPID no hay canal, y NADA revienta", () => {
  it("⭑ `pushConfigurado()` es false y ni una de las tres funciones lanza", () => {
    limpiar();
    expect(pushConfigurado()).toBe(false);
    // La leccion de la ficha 400: un fallo de configuracion no puede parar la operacion. Si
    // cualquiera de estas lanzara, un despliegue sin VAPID tumbaria la campana entera.
    expect(() => pushConfigurado()).not.toThrow();
    expect(() => clavePublicaPush()).not.toThrow();
    expect(() => piezasVapidAusentes()).not.toThrow();
    expect(clavePublicaPush()).toBeNull();
  });

  it("sigue sin haber canal con la publica pero SIN la privada", () => {
    limpiar();
    process.env.VAPID_PUBLIC_KEY = PUBLICA;
    expect(pushConfigurado()).toBe(false);
    // Y la publica NO se sirve: ofrecer el control con media configuracion deja al navegador
    // suscrito a un canal que nunca va a entregar nada.
    expect(clavePublicaPush()).toBeNull();
  });

  it("ni con la privada pero sin la publica", () => {
    limpiar();
    process.env.VAPID_PRIVATE_KEY = PRIVADA;
    expect(pushConfigurado()).toBe(false);
  });

  it("⭑ hay canal SOLO con las dos; `VAPID_SUBJECT` no decide y cae a su default", () => {
    limpiar();
    process.env.VAPID_PUBLIC_KEY = PUBLICA;
    process.env.VAPID_PRIVATE_KEY = PRIVADA;
    expect(pushConfigurado()).toBe(true);
    expect(loadPushConfig().subject).toBe("mailto:soporte@ordenex.co");
  });

  it("una variable VACIA cuenta como ausente (no como cadena vacia)", () => {
    limpiar();
    process.env.VAPID_PUBLIC_KEY = "   ";
    process.env.VAPID_PRIVATE_KEY = PRIVADA;
    expect(pushConfigurado()).toBe(false);
    expect(piezasVapidAusentes()).toEqual(["VAPID_PUBLIC_KEY"]);
  });
});

describe("410/R30 — la falta se declara con el NOMBRE de la variable, nunca con su valor", () => {
  it("⭑ `piezasVapidAusentes` nombra las dos que faltan, en orden", () => {
    limpiar();
    // LITERAL ESCRITO A MANO, no derivado de la funcion: es lo que se va a leer en un log de
    // produccion para saber que hay que dar de alta.
    expect(piezasVapidAusentes()).toEqual(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]);
  });

  it("⭑ R31: el mensaje del error cita el NOMBRE y jamas el valor de la privada", () => {
    limpiar();
    process.env.VAPID_PUBLIC_KEY = PUBLICA;
    // Sin la privada, `loadPushConfig` lanza — y lanza a proposito: quien llama aqui ya comprobo
    // `pushConfigurado()`, asi que llegar aqui es un error de programacion y debe ser RUIDOSO.
    let error: unknown = null;
    try {
      loadPushConfig();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PushNoConfiguradoError);
    const mensaje = (error as Error).message;
    expect(mensaje).toContain("VAPID_PRIVATE_KEY");
    expect(mensaje).not.toContain(PRIVADA);
  });

  it("⭑ R31: con las dos puestas, el mensaje de NINGUN error lleva la privada", () => {
    limpiar();
    process.env.VAPID_PUBLIC_KEY = PUBLICA;
    process.env.VAPID_PRIVATE_KEY = PRIVADA;
    // `loadPushConfig` SI devuelve la privada —es quien firma—, pero es lo unico que la ve.
    expect(loadPushConfig().privateKey).toBe(PRIVADA);
    expect(new PushNoConfiguradoError("VAPID_PRIVATE_KEY").message).not.toContain(PRIVADA);
  });
});

describe("410/R32 — la clave publica se resuelve en TIEMPO DE EJECUCION", () => {
  it("⭑ cambiar la variable cambia lo que se sirve, sin reconstruir nada", () => {
    limpiar();
    process.env.VAPID_PUBLIC_KEY = PUBLICA;
    process.env.VAPID_PRIVATE_KEY = PRIVADA;
    expect(clavePublicaPush()).toBe(PUBLICA);

    // La rotacion: si esto se horneara en el bundle (`NEXT_PUBLIC_*`), esta segunda lectura
    // seguiria devolviendo la primera clave y rotar exigiria un despliegue.
    process.env.VAPID_PUBLIC_KEY = "BOTRA-clave-rotada";
    expect(clavePublicaPush()).toBe("BOTRA-clave-rotada");
  });
});

describe("410/R29 — las claves no estan en el repositorio", () => {
  const RAIZ = path.resolve(__dirname, "..", "..", "..");

  it("⭑ `.env.example` documenta los tres NOMBRES y ninguno lleva valor", () => {
    const ejemplo = fs.readFileSync(path.join(RAIZ, ".env.example"), "utf8");
    // AUTOCOMPROBACION: si el archivo no se leyera, las tres aserciones de abajo pasarian en
    // falso sobre una cadena vacia... no: `toContain` fallaria. Pero el `length` deja claro que
    // se leyo algo de verdad.
    expect(ejemplo.length).toBeGreaterThan(1000);
    for (const nombre of VARS) {
      expect(ejemplo, `falta ${nombre} en .env.example`).toContain(`${nombre}=`);
      // Sin valor: la linea es exactamente `NOMBRE=` y nada mas.
      expect(ejemplo).toMatch(new RegExp(`^${nombre}=\\s*$`, "m"));
    }
  });

  it("⭑ ningun archivo de codigo asigna una clave VAPID a un literal", () => {
    // Barrido por el arbol: `lib/`, `app/` y `components/`. Lo que se busca es la ASIGNACION DE UN
    // VALOR (`VAPID_PRIVATE_KEY = "BNc0f..."`), no la mencion — `lib/config/push.ts` DECLARA los
    // tres nombres (`export const VAPID_PUBLIC_KEY = "VAPID_PUBLIC_KEY"`) y eso es justo lo que
    // hace que los mensajes de error citen el mismo texto que `.env.example`. Por eso se compara
    // el literal con el propio nombre: si algun dia alguien pegara ahi una clave de verdad, el
    // literal dejaria de coincidir y esto se pondria rojo.
    const NOMBRES = new Set<string>(VARS);
    const sospechosas: string[] = [];
    let archivosLeidos = 0;
    const recorrer = (dir: string) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          recorrer(completo);
          continue;
        }
        if (!/\.tsx?$/.test(entrada.name)) continue;
        archivosLeidos += 1;
        const fuente = fs.readFileSync(completo, "utf8");
        for (const m of fuente.matchAll(
          /VAPID_(?:PUBLIC|PRIVATE)_KEY\s*[:=]\s*(["'`])(.*?)\1/g,
        )) {
          if (!NOMBRES.has(m[2])) sospechosas.push(`${path.relative(RAIZ, completo)}: ${m[0]}`);
        }
      }
    };
    for (const carpeta of ["lib", "app", "components"]) recorrer(path.join(RAIZ, carpeta));
    // AUTOCOMPROBACION: sin esto, un recorrido roto dejaria `sospechosas` vacio y el test verde
    // sin haber mirado un solo archivo.
    expect(archivosLeidos).toBeGreaterThan(500);
    expect(sospechosas).toEqual([]);
  });
});
