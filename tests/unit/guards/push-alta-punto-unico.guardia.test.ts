import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// FICHA 422 (T4.3, design §9 · R6, R16, R17, R24) — GUARDIA DEL PUNTO UNICO DEL ALTA, Y DE QUE LA
// PREFERENCIA NO SE META EN EL CAMINO DEL ENVIO.
//
// ---------------------------------------------------------------------------------------------
// LAS TRES COSAS QUE VIGILA, Y POR QUE NINGUNA LA CAZA UN TEST DE COMPORTAMIENTO
// ---------------------------------------------------------------------------------------------
//
// 1) `Notification.requestPermission(` aparece UNA SOLA VEZ en todo el arbol, dentro de `activar()`
//    (410/R11 y ahora 422/R16). Un test puede demostrar que la reactivacion no lo llama HOY; no
//    puede demostrar que no lo llame el camino que alguien escriba manana. Un «no» del navegador
//    es casi irreversible —hay que entrar a los ajustes del sitio, y nadie entra—, asi que una
//    segunda peticion sin gesto perderia el canal PARA SIEMPRE en media plantilla.
//
// 2) `pushManager.subscribe(` aparece UNA SOLA VEZ, y dentro de `lib/pwa/alta-push.ts`. Ahi vive la
//    comprobacion del permiso (R17). Un SEGUNDO `subscribe` en otro archivo seria, por
//    construccion, un camino por el que suscribir SALTANDOSE esa comprobacion — y con la
//    preferencia puesta se ejecutaria solo, sin que nadie lo pidiera.
//
// 3) La preferencia NO aparece en el camino del envio (R6). El conjunto de destinatarios sigue
//    siendo EXACTAMENTE el de 410/R24-R26: quien tiene suscripcion. Una preferencia puesta sin
//    suscripcion no produce ningun envio, y una suscripcion viva no deja de recibir porque una
//    columna diga otra cosa. Si alguien anadiera `WHERE avisos_push` al envio, el fallo seria mudo:
//    los push dejarian de salir para quien no tenga fila, y ningun test de suscripciones lo veria.
//
// ⚠️ VIVE EN `tests/unit/guards/` A PROPOSITO: vigila la FORMA del arbol, no un comportamiento que
// un grafo de imports seleccione. Las guardias corren SIEMPRE, tambien en el modo rapido.

const RAIZ = path.resolve(__dirname, "..", "..", "..");

const RAICES_DEL_CENSO = ["app", "components", "hooks", "lib"];

const RUTA_HOOK = "hooks/usePushSuscripcion.ts";
const RUTA_ALTA = "lib/pwa/alta-push.ts";
const RUTA_LAYOUT = "app/(app)/layout.tsx";
const RUTA_COMPONENTE_REACTIVACION = "components/shared/PushReactivacion.tsx";

function archivosDe(dir: string, acc: string[] = []): string[] {
  const abs = path.join(RAIZ, dir);
  for (const entrada of fs.readdirSync(abs)) {
    const rel = path.join(dir, entrada).replace(/\\/g, "/");
    if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) archivosDe(rel, acc);
    else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel);
  }
  return acc;
}

const ARCHIVOS_DEL_CENSO = RAICES_DEL_CENSO.flatMap((r) => archivosDe(r));

/**
 * Todo el arbol SIN COMENTARIOS. Este repo nombra en la prosa justo lo que el codigo tiene
 * prohibido —`alta-push.ts` escribe «no llama a `Notification.requestPermission()` jamas»—, asi que
 * un censo sobre el texto crudo denunciaria la explicacion.
 */
const FUENTES: ReadonlyMap<string, string> = new Map(
  ARCHIVOS_DEL_CENSO.map(
    (rel) => [rel, quitarComentarios(fs.readFileSync(path.join(RAIZ, rel), "utf8"))] as const,
  ),
);

/** CUANTAS veces aparece `aguja` en `codigo`. El numero, no un booleano (leccion medida dos veces). */
export function apariciones(codigo: string, aguja: RegExp): number {
  return [...codigo.matchAll(aguja)].length;
}

/** Los archivos donde `aguja` aparece, con su cuenta. Ordenado para que el fallo sea legible. */
function censo(aguja: RegExp): { ruta: string; veces: number }[] {
  const filas: { ruta: string; veces: number }[] = [];
  for (const [ruta, codigo] of FUENTES) {
    const veces = apariciones(codigo, new RegExp(aguja.source, "g"));
    if (veces > 0) filas.push({ ruta, veces });
  }
  return filas.sort((a, b) => a.ruta.localeCompare(b.ruta));
}

const PETICION_DE_PERMISO = /Notification\s*\.\s*requestPermission\s*\(/g;
const SUSCRIBIR = /pushManager\s*\.\s*subscribe\s*\(/g;
const MONTAJE_REACTIVACION = /<PushReactivacion\b/g;

describe("422 · autocomprobacion de la guardia", () => {
  it("el barrido lee un arbol GRANDE y de verdad", () => {
    // Sin esto, un recorrido roto dejaria TODA la guardia verde y muda. Ya paso en este repo.
    expect(ARCHIVOS_DEL_CENSO.length).toBeGreaterThan(800);
    for (const ruta of [RUTA_HOOK, RUTA_ALTA, RUTA_LAYOUT]) {
      expect(ARCHIVOS_DEL_CENSO, `el censo no llega a ${ruta}`).toContain(ruta);
    }
  });

  it("las fuentes leidas tienen contenido, no cadenas vacias", () => {
    expect((FUENTES.get(RUTA_HOOK) ?? "").length).toBeGreaterThan(1000);
    expect((FUENTES.get(RUTA_ALTA) ?? "").length).toBeGreaterThan(500);
    expect((FUENTES.get(RUTA_LAYOUT) ?? "").length).toBeGreaterThan(500);
  });

  it("⭑ el detector CUENTA y distingue un comentario de una llamada", () => {
    expect(apariciones("await Notification.requestPermission();", PETICION_DE_PERMISO)).toBe(1);
    expect(
      apariciones(
        "Notification.requestPermission(); Notification . requestPermission ()",
        PETICION_DE_PERMISO,
      ),
    ).toBe(2);
    // Y sobre un comentario, cero — porque lo que se censa es el texto SIN comentarios.
    expect(
      apariciones(
        quitarComentarios("// aqui NO se llama a Notification.requestPermission()\nexport const x = 1;\n"),
        PETICION_DE_PERMISO,
      ),
    ).toBe(0);
    expect(apariciones("registro.pushManager.subscribe({})", SUSCRIBIR)).toBe(1);
    expect(apariciones("<PushReactivacion avisosRecordados={x} />", MONTAJE_REACTIVACION)).toBe(1);
  });
});

describe("410/R11 + 422/R16 · `requestPermission` aparece UNA vez en todo el arbol", () => {
  it("⭑ una sola aparicion, y esta en `activar()` del hook", () => {
    const filas = censo(PETICION_DE_PERMISO);
    expect(
      filas,
      "el permiso se pide en UN solo sitio y solo tras el gesto de la persona sobre el " +
        "interruptor. Un segundo `requestPermission` es una peticion sin gesto, y un «no» del " +
        "navegador es casi irreversible: se pierde el canal para siempre en ese dispositivo.",
    ).toEqual([{ ruta: RUTA_HOOK, veces: 1 }]);

    // Y dentro de `activar`, no en cualquier parte del hook: al montar NO se pide nada (410/R10).
    const codigo = FUENTES.get(RUTA_HOOK) ?? "";
    const iActivar = codigo.indexOf("const activar =");
    const iDesactivar = codigo.indexOf("const desactivar =");
    const iPeticion = codigo.search(/Notification\s*\.\s*requestPermission\s*\(/);
    expect(iActivar, "no se encontro `activar` en el hook").toBeGreaterThan(-1);
    expect(iDesactivar, "no se encontro `desactivar` en el hook").toBeGreaterThan(iActivar);
    expect(iPeticion).toBeGreaterThan(iActivar);
    expect(iPeticion).toBeLessThan(iDesactivar);
  });

  it("⭑ y `alta-push.ts` —el modulo que la reactivacion reutiliza— NO la contiene", () => {
    // Es la aserción que hace que la mutacion M3 («que la reactivacion pida el permiso») no tenga
    // donde esconderse: si alguien la mete en el modulo compartido, el censo de arriba pasa a dos.
    expect(apariciones(FUENTES.get(RUTA_ALTA) ?? "", PETICION_DE_PERMISO)).toBe(0);
  });
});

describe("422/R15-R17 · `pushManager.subscribe` aparece UNA vez, y dentro de `alta-push.ts`", () => {
  it("⭑ una sola aparicion, en el modulo que COMPRUEBA el permiso", () => {
    const filas = censo(SUSCRIBIR);
    expect(
      filas,
      "suscribir vive en UN solo sitio porque ahi vive la comprobacion del permiso (R17). Un " +
        "segundo `subscribe` en otro archivo es, por construccion, un camino para suscribir " +
        "saltandose esa comprobacion — y con la preferencia puesta se ejecutaria solo.",
    ).toEqual([{ ruta: RUTA_ALTA, veces: 1 }]);
  });

  it("⭑ y la comprobacion del permiso esta ANTES del `subscribe` en ese archivo", () => {
    // El orden ES la regla: comprobar despues de suscribir no comprueba nada. La mutacion M2
    // —quitar la comprobacion— deja este caso rojo ademas del test de comportamiento.
    const codigo = FUENTES.get(RUTA_ALTA) ?? "";
    const iComprobacion = codigo.search(/Notification\s*\.\s*permission\s*!==\s*"granted"/);
    const iSubscribe = codigo.search(/pushManager\s*\.\s*subscribe\s*\(/);
    expect(
      iComprobacion,
      "no se encontro la comprobacion `Notification.permission !== \"granted\"` en `alta-push.ts`",
    ).toBeGreaterThan(-1);
    expect(iSubscribe).toBeGreaterThan(iComprobacion);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6 — LA PREFERENCIA NO ENTRA EN EL CAMINO DEL ENVIO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * EL CAMINO DEL ENVIO: desde que se decide a quien avisar hasta que sale el push. Es donde una
 * mencion a la preferencia cambiaria el conjunto de destinatarios, que es justo lo que R6 prohibe.
 */
const CAMINO_DEL_ENVIO = (ruta: string): boolean =>
  ruta.startsWith("lib/push/") ||
  ruta.startsWith("lib/notificaciones/") ||
  /^lib\/services\/PushWeb/.test(ruta) ||
  /^lib\/repositories\/PushSuscripcionRepository\.ts$/.test(ruta);

/** Como se nombra la preferencia en cualquiera de sus formas: modelo, columna, tabla, repositorio. */
const NOMBRES_DE_LA_PREFERENCIA =
  /\busuarioPreferencia\b|\bavisosPush\b|\busuario_preferencia\b|\bavisos_push\b|\bUsuarioPreferenciaRepository\b|\bIUsuarioPreferenciaRepository\b/g;

describe("422/R6 · la preferencia NO aparece en el camino del envio", () => {
  const delEnvio = ARCHIVOS_DEL_CENSO.filter(CAMINO_DEL_ENVIO);

  it("⭑ el recorrido encuentra el camino del envio de verdad", () => {
    // AUTOCOMPROBACION: sin esto, un filtro roto dejaria el barrido de abajo verde por vacio.
    expect(delEnvio.length).toBeGreaterThanOrEqual(5);
    expect(delEnvio).toContain("lib/push/web-push-sender.ts");
    expect(delEnvio).toContain("lib/services/PushWebService.ts");
    expect(delEnvio).toContain("lib/repositories/PushSuscripcionRepository.ts");
    expect(delEnvio.some((r) => r.startsWith("lib/notificaciones/"))).toBe(true);
  });

  it("⭑ ni un archivo del camino del envio nombra la preferencia", () => {
    const infractores = delEnvio
      .map((ruta) => ({ ruta, veces: apariciones(FUENTES.get(ruta) ?? "", NOMBRES_DE_LA_PREFERENCIA) }))
      .filter((f) => f.veces > 0);
    expect(
      infractores,
      "R6: el conjunto de destinatarios de un push es EXACTAMENTE quien tiene suscripcion " +
        "(410/R24-R26). Si el envio filtrara ademas por la preferencia, el fallo seria MUDO: los " +
        "avisos dejarian de salir para quien no tenga fila —o para quien la tenga en `false` con " +
        "una suscripcion viva— y ningun test de suscripciones lo veria.",
    ).toEqual([]);
  });

  it("⭑ control positivo: el detector SI encuentra la preferencia donde debe estar", () => {
    // Sin esto, el barrido de arriba pasaria en verde con una regex que no casara con nada.
    expect(apariciones(FUENTES.get("lib/actions/push.ts") ?? "", NOMBRES_DE_LA_PREFERENCIA)).toBeGreaterThan(0);
    expect(
      apariciones(FUENTES.get("lib/repositories/UsuarioPreferenciaRepository.ts") ?? "", NOMBRES_DE_LA_PREFERENCIA),
    ).toBeGreaterThan(0);
  });

  it("⭑ y el repositorio del canal sigue eligiendo destinatarios SOLO por suscripcion", () => {
    // La linea concreta de la que depende R6: `listarPorUsuarios` filtra por `usuarioId`, y por
    // nada mas. Un `AND` con la preferencia aqui es exactamente la mutacion M6.
    const codigo = FUENTES.get("lib/repositories/PushSuscripcionRepository.ts") ?? "";
    expect(codigo).toContain("async listarPorUsuarios(");
    const i = codigo.indexOf("async listarPorUsuarios(");
    const cuerpo = codigo.slice(i, i + 600);
    expect(cuerpo).toContain("pushSuscripcion.findMany");
    expect(cuerpo).not.toMatch(NOMBRES_DE_LA_PREFERENCIA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R24 — DONDE SE MONTA LA REACTIVACION (la tanda 5 la escribe; esta guardia ya la espera)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R24 · `PushReactivacion` solo puede montarse en el layout AUTENTICADO", () => {
  it("⭑ o el componente no existe y nadie lo monta, o existe y lo monta SOLO el layout del portal", () => {
    // ⚠️ ESTA ASERCION ES SIMETRICA A PROPOSITO, y por eso no puede quedarse verde y muda en
    // ninguno de los dos mundos:
    //
    //   · HOY (tanda 4 cerrada, tanda 5 pendiente) el componente NO existe, y lo que se afirma es
    //     que NADIE lo monta. Si alguien escribiera el montaje sin el componente, aqui se veria
    //     antes que en el typecheck.
    //   · EN CUANTO LA TANDA 5 CREE EL ARCHIVO, la rama de arriba entra sola y exige que el unico
    //     montaje del arbol este en `app/(app)/layout.tsx` — que es lo que sostiene R24: sin sesion
    //     no se monta nada que pueda reactivar, porque ese layout no se pinta.
    //
    // Un `if` con una sola rama util seria la familia de test que este repo persigue; este tiene
    // las dos ramas con su aserción, y el detector esta probado arriba en la autocomprobacion.
    const montajes = censo(MONTAJE_REACTIVACION);
    const existe = fs.existsSync(path.join(RAIZ, RUTA_COMPONENTE_REACTIVACION));

    if (existe) {
      expect(
        montajes,
        "R24: la reactivacion solo puede vivir en el layout del portal autenticado. Montada en " +
          "un layout publico intentaria reactivar sin sesion; montada dos veces, lo intentaria " +
          "dos veces por carga (R23).",
      ).toEqual([{ ruta: RUTA_LAYOUT, veces: 1 }]);
    } else {
      expect(
        montajes,
        "el componente `components/shared/PushReactivacion.tsx` todavia no existe (tanda 5), asi " +
          "que nadie puede montarlo. Si acabas de crearlo, móntalo en `app/(app)/layout.tsx` y " +
          "esta misma guardia pasara a exigir que sea el unico sitio.",
      ).toEqual([]);
    }
  });

  it("⭑ AUTOCOMPROBACION: el detector caza un montaje en un layout que no es el del portal", () => {
    // Se inyecta en el recorrido, no en el arbol. Asi este caso mide LO SUYO —que el detector
    // distingue— en los dos mundos, exista o no el componente.
    const fuentes = new Map(FUENTES);
    fuentes.set("app/layout.tsx", "export default function Raiz() {\n  return <PushReactivacion avisosRecordados={false} />;\n}\n");
    const encontrados = [...fuentes]
      .map(([ruta, codigo]) => ({ ruta, veces: apariciones(codigo, new RegExp(MONTAJE_REACTIVACION.source, "g")) }))
      .filter((f) => f.veces > 0)
      .map((f) => f.ruta);
    expect(encontrados).toContain("app/layout.tsx");
    expect(encontrados).not.toContain("components/ui/button.tsx");
  });
});
