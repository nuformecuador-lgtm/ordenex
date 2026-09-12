import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import {
  RAIZ_DEL_REPO,
  archivosDeCodigoCensados,
  fallosDelInventario,
  raicesCensadas,
} from "@/tests/fixtures/raices-de-codigo";

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ REVISION 2026-09-11 (B1 de `progress/review_422.md`) — EL CENSO LEIA 4 DE LAS 8 RAICES
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `RAICES_DEL_CENSO = ["app","components","hooks","lib"]` dejaba fuera `providers/`, y la revision
// escribio ahi un SEGUNDO `Notification.requestPermission()` mas un `subscribe` sin comprobacion
// del permiso: typecheck verde y 145 archivos de guardia / 2.091 casos EN VERDE, con esta guardia
// afirmando que la peticion aparece «una sola vez en todo el arbol».
//
// El arreglo NO es anadir `"providers"`: eso repara el sintoma de hoy y deja la causa —una lista
// escrita a mano que envejece sola y en silencio, que es la familia de fallo que esta guardia
// existe para cerrar—. Las raices se DERIVAN del disco y se comparan contra un inventario
// declarado en `tests/fixtures/raices-de-codigo.ts`; una raiz nueva pone esto rojo.
//
// Y los DETECTORES se endurecieron por el mismo criterio, porque acertar la raiz no basta si la
// aguja se puede esquivar renombrando el receptor:
//   · `requestPermission` se censa como IDENTIFICADOR DESNUDO, no como `Notification.requestPermission(`.
//     Asi `const { requestPermission } = Notification` y `const N = Notification; N.requestPermission()`
//     tambien caen.
//   · `subscribe(` se censa igual, con lista blanca de dos entradas y sus cuentas, para que
//     `const pm = registro.pushManager; pm.subscribe(...)` no se escape.

const RAIZ = RAIZ_DEL_REPO;

const RUTA_HOOK = "hooks/usePushSuscripcion.ts";
const RUTA_ALTA = "lib/pwa/alta-push.ts";
const RUTA_LAYOUT = "app/(app)/layout.tsx";
const RUTA_COMPONENTE_REACTIVACION = "components/shared/PushReactivacion.tsx";

const ARCHIVOS_DEL_CENSO = archivosDeCodigoCensados();

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

/**
 * ⭑ EL IDENTIFICADOR DESNUDO, no `Notification.requestPermission(`.
 *
 * Perseguir el receptor era una aguja esquivable: `const N = Notification; N.requestPermission()` y
 * `const { requestPermission } = Notification;` la evitan sin despeinarse. El nombre del metodo,
 * en cambio, hay que escribirlo. Medido sobre el arbol sin comentarios: aparece exactamente UNA
 * vez, y todas las demas menciones viven en la prosa (que el quitador ya retira).
 */
const PETICION_DE_PERMISO = /\brequestPermission\b/g;

/**
 * ⭑ Igual con `subscribe(`: el receptor puede renombrarse (`const pm = registro.pushManager`), el
 * nombre del metodo no. El `\b` inicial deja fuera `unsubscribe(`, que es otra cosa y aparece tres
 * veces de forma legitima.
 */
const SUSCRIBIR = /\bsubscribe\s*\(/g;

/** La forma ESPECIFICA, que se sigue afirmando aparte: `subscribe` cuelga del `pushManager`. */
const SUSCRIBIR_DEL_PUSH_MANAGER = /pushManager\s*\.\s*subscribe\s*\(/g;

const MONTAJE_REACTIVACION = /<PushReactivacion\b/g;

/**
 * Los DOS sitios del arbol donde puede aparecer un `subscribe(`, con su cuenta y su porque.
 *
 * Uno es el del canal de push; el otro no tiene nada que ver y esta aqui justo para que se vea que
 * no tiene nada que ver. Una lista blanca sin el segundo obligaria a aflojar la aguja.
 */
const SUSCRIPCIONES_AUTORIZADAS: readonly { ruta: string; veces: number; porque: string }[] = [
  {
    ruta: "hooks/use-mobile.ts",
    veces: 1,
    porque:
      "NADA QUE VER CON PUSH: es el `subscribe` de `useSyncExternalStore` para una media query " +
      "(`matchMedia('(max-width: 767px)')`). Se declara para que la aguja pueda ser el nombre del " +
      "metodo —y no `pushManager.subscribe(`, que se esquiva renombrando el receptor—.",
  },
  {
    ruta: "lib/pwa/alta-push.ts",
    veces: 1,
    porque:
      "EL UNICO DEL CANAL (R15/R17). Vive donde vive la comprobacion del permiso, y esa vecindad " +
      "es el argumento estructural del diseno: un segundo `subscribe` en otro archivo seria, por " +
      "construccion, un camino para suscribir saltandose la comprobacion.",
  },
];

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

  it("⭑ el detector del permiso NO depende del receptor: caza el alias y la desestructuracion", () => {
    // La aguja vieja (`Notification\\.requestPermission\\(`) daba CERO en los tres casos de abajo.
    // Son las formas en que un segundo camino se escribiria sin querer esconderse.
    expect(apariciones("const N = Notification; await N.requestPermission();", PETICION_DE_PERMISO)).toBe(1);
    expect(
      apariciones("const { requestPermission } = Notification; await requestPermission();", PETICION_DE_PERMISO),
    ).toBe(2);
    expect(apariciones("await globalThis.Notification.requestPermission();", PETICION_DE_PERMISO)).toBe(1);
    // Control negativo: no se dispara con un nombre que solo lo contiene.
    expect(apariciones("const requestPermissionLabel = 1;", PETICION_DE_PERMISO)).toBe(0);
  });

  it("⭑ el detector de `subscribe(` tampoco depende del receptor, y NO confunde `unsubscribe(`", () => {
    expect(apariciones("const pm = registro.pushManager; await pm.subscribe({});", SUSCRIBIR)).toBe(1);
    expect(apariciones("const { subscribe } = registro.pushManager; await subscribe({});", SUSCRIBIR)).toBe(1);
    // `unsubscribe(` NO es `subscribe(`: aparece tres veces de forma legitima en el arbol y
    // contarla convertiria a la baja y al rescate del alta en infractores.
    expect(apariciones("await suscripcion.unsubscribe();", SUSCRIBIR)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B1 · EL INVENTARIO DE RAICES: lo que «todo el arbol» significa, comparado con el disco
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/B1 · «en todo el arbol» significa TODAS las raices de codigo, y se comprueba", () => {
  it("⭑ toda raiz de codigo del repositorio esta clasificada, con su motivo", () => {
    // Sin esto, «una sola vez en todo el arbol» es una afirmacion sobre las carpetas que alguien
    // se acordo de escribir el dia que nacio la guardia. Es literalmente lo que paso con B1.
    expect(fallosDelInventario()).toEqual([]);
  });

  it("⭑ `providers/` —donde la revision colo el segundo `requestPermission`— esta DENTRO", () => {
    expect(raicesCensadas()).toContain("providers");
    expect(ARCHIVOS_DEL_CENSO).toContain("providers/ToastProvider.tsx");
    expect(ARCHIVOS_DEL_CENSO).toContain("providers/TemaProvider.tsx");
  });

  it("⭑ y el censo llega tambien a `scripts/`, `e2e/` y a los archivos sueltos de la raiz", () => {
    // Las otras tres raices que la version vieja no miraba. `middleware.ts` corre en CADA peticion.
    expect(ARCHIVOS_DEL_CENSO).toContain("middleware.ts");
    expect(ARCHIVOS_DEL_CENSO.some((r) => r.startsWith("scripts/"))).toBe(true);
    expect(ARCHIVOS_DEL_CENSO.some((r) => r.startsWith("e2e/"))).toBe(true);
    // Y NO llega a `tests/`, que es el unico limite declarado (ahi viven los dobles del navegador).
    expect(ARCHIVOS_DEL_CENSO.some((r) => r.startsWith("tests/"))).toBe(false);
  });

  it("⭑ B3: `public/sw.js` esta en el censo, y su contenido se LEE", () => {
    // El service worker DESPLEGADO es el sitio idiomatico de un segundo `pushManager.subscribe()`
    // —el manejador de `pushsubscriptionchange`—, y hasta este arreglo la guardia no lo veia: la
    // aguja de extension era `\.(ts|tsx)$` y `public/` no llegaba ni a ser «raiz de codigo».
    expect(raicesCensadas()).toContain("public");
    expect(ARCHIVOS_DEL_CENSO).toContain("public/sw.js");
    // Y se LEE: sin esto, estar en la lista y leerse vacio serian indistinguibles.
    const sw = FUENTES.get("public/sw.js") ?? "";
    expect(sw.length).toBeGreaterThan(3000);
    expect(sw).toContain("addEventListener");
    // Hoy NO trae ninguna de las dos agujas — el defecto era la ceguera, no un incumplimiento.
    expect(apariciones(sw, PETICION_DE_PERMISO)).toBe(0);
    expect(apariciones(sw, SUSCRIBIR)).toBe(0);
  });

  it("⭑ B3: un `subscribe` metido en el SERVICE WORKER se caza", () => {
    // ESTE es el agujero concreto que B3 nombra: `pushsubscriptionchange` re-suscribiendo sin
    // ninguna comprobacion de permiso, en un `.js` que el typecheck tampoco mira. Medido sobre un
    // lienzo sintetico para no enrojecer en cadena si alguien lo escribe de verdad.
    const ruta = "public/__lienzo-sw__.js";
    expect(FUENTES.has(ruta)).toBe(false);
    const conIntruso = new Map(FUENTES);
    conIntruso.set(
      ruta,
      "self.addEventListener('pushsubscriptionchange', async (evento) => {\n" +
        "  const nueva = await self.registration.pushManager.subscribe(evento.oldSubscription.options);\n" +
        "  await fetch('/api/push', { method: 'POST', body: JSON.stringify(nueva) });\n" +
        "});\n",
    );

    const suscripciones = [...conIntruso]
      .filter(([, codigo]) => apariciones(codigo, new RegExp(SUSCRIBIR.source, "g")) > 0)
      .map(([r]) => r)
      .sort();
    expect(suscripciones).toContain(ruta);
    // Y por tanto el censo deja de cuadrar con la lista blanca: R15/R17 vuelve a tener defensa.
    expect(suscripciones).not.toEqual(SUSCRIPCIONES_AUTORIZADAS.map((e) => e.ruta).sort());
  });

  it("⭑ AUTOCOMPROBACION: una raiz NUEVA sin clasificar pone el inventario rojo", () => {
    // Sobre un mundo SINTETICO, no sobre el disco: el dia que aparezca una raiz sin clasificar de
    // verdad, la noticia es el caso de arriba y este tiene que seguir midiendo lo suyo.
    const juguete = [
      { ruta: "app", censada: true, motivo: "un motivo suficientemente largo para pasar el umbral del detector" },
    ];
    expect(fallosDelInventario(["app", "widgets"], juguete)).toHaveLength(1);
    expect(fallosDelInventario(["app", "widgets"], juguete)[0]).toContain("`widgets/`");
    // Control positivo: bien clasificado, ningun fallo.
    expect(fallosDelInventario(["app"], juguete)).toEqual([]);
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

  it("⭑ EL CASO DE LA REVISION: un segundo camino escrito en `providers/` se caza", () => {
    // Reproducido TAL CUAL el intruso de `progress/review_422.md` §B1, inyectado en el RECORRIDO y
    // no en el arbol. Antes daba TSC_EXIT=0 y 145 guardias verdes; ahora cae por partida doble.
    //
    // ⚠️ EL HECHO —que `providers/` esta censado— se afirma sobre el archivo REAL; LA MEDICION va
    // sobre un lienzo SINTETICO de esa misma raiz (m3 de `review_422_fix.md`): con un infractor de
    // verdad viviendo en `ToastProvider.tsx`, este caso enrojecia en cadena y se quedaba sin su
    // noticia. Una guardia que enrojece en cadena ensena a no leer los rojos.
    expect(
      FUENTES.has("providers/ToastProvider.tsx"),
      "la raiz `providers/` tiene que estar en el censo",
    ).toBe(true);

    const ruta = "providers/__lienzo-segundo-camino__.tsx";
    expect(FUENTES.has(ruta), "el lienzo no puede existir de verdad en el arbol").toBe(false);

    const intruso =
      "export async function segundoCaminoDelAlta(reg: ServiceWorkerRegistration) {\n" +
      "  await Notification.requestPermission();\n" +
      "  await reg.pushManager.subscribe({ userVisibleOnly: true });\n" +
      "}\n";

    // (a) la peticion del permiso aparece TAMBIEN en el lienzo, o sea en un archivo mas.
    expect(apariciones(intruso, PETICION_DE_PERMISO)).toBe(1);
    const conIntruso = new Map(FUENTES);
    conIntruso.set(ruta, intruso);

    /** Los archivos que piden el permiso en un mapa de fuentes dado. */
    const quienesPiden = (fuentes: ReadonlyMap<string, string>) =>
      [...fuentes]
        .filter(([, codigo]) => apariciones(codigo, new RegExp(PETICION_DE_PERMISO.source, "g")) > 0)
        .map(([r]) => r)
        .sort();

    // ⚠️ SE MIDE EL DELTA, no la lista absoluta (m3, segunda vuelta). Con un intruso REAL viviendo
    // en cualquier otra raiz censada, una lista literal de dos nombres enrojeceria aqui por algo
    // que este caso no vigila. Lo que este caso afirma es que el detector VE el lienzo.
    const nuevos = quienesPiden(conIntruso).filter((r) => !quienesPiden(FUENTES).includes(r));
    expect(nuevos).toEqual([ruta]);
    // Y el control positivo: sin el lienzo, el hook es quien pide (y sigue siendo el unico que
    // este archivo autoriza, cosa que afirma el caso `una sola aparicion...` de mas arriba).
    expect(quienesPiden(FUENTES)).toContain(RUTA_HOOK);

    // (b) y el `subscribe` aparece fuera de `alta-push.ts`, o sea fuera de donde vive la
    // comprobacion del permiso.
    const suscripciones = [...conIntruso]
      .filter(([, codigo]) => apariciones(codigo, new RegExp(SUSCRIBIR.source, "g")) > 0)
      .map(([r]) => r)
      .sort();
    expect(suscripciones).toContain(ruta);
    expect(suscripciones).not.toEqual(SUSCRIPCIONES_AUTORIZADAS.map((e) => e.ruta).sort());
  });
});

describe("422/R15-R17 · `subscribe(` aparece UNA vez en el canal, y dentro de `alta-push.ts`", () => {
  it("⭑ el censo del NOMBRE DEL METODO cuadra con la lista blanca de dos entradas", () => {
    const filas = censo(SUSCRIBIR);
    expect(
      filas,
      "suscribir vive en UN solo sitio porque ahi vive la comprobacion del permiso (R17). Un " +
        "segundo `subscribe` en otro archivo es, por construccion, un camino para suscribir " +
        "saltandose esa comprobacion — y con la preferencia puesta se ejecutaria solo. Si tu " +
        "`subscribe` no tiene nada que ver con push, declaralo en SUSCRIPCIONES_AUTORIZADAS con " +
        "su porque, como el de `use-mobile`.",
    ).toEqual(SUSCRIPCIONES_AUTORIZADAS.map(({ ruta, veces }) => ({ ruta, veces })));
  });

  it("⭑ y el del CANAL —`pushManager.subscribe(`— sigue siendo exactamente uno", () => {
    // La aserción especifica, ademas de la generica: lo que R15/R17 protege no es «un subscribe
    // cualquiera», es el del canal de push.
    expect(censo(SUSCRIBIR_DEL_PUSH_MANAGER)).toEqual([{ ruta: RUTA_ALTA, veces: 1 }]);
  });

  it("cada entrada de SUSCRIPCIONES_AUTORIZADAS lleva su PORQUE escrito", () => {
    // Una lista blanca sin porques se convierte en una lista de excepciones que nadie relee.
    for (const entrada of SUSCRIPCIONES_AUTORIZADAS) {
      expect(entrada.porque.length, `${entrada.ruta} sin porque`).toBeGreaterThan(100);
    }
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
