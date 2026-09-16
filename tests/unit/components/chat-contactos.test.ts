import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  agruparContactosChat,
  contadorContactos,
  SIN_CONTACTOS,
} from "@/app/(app)/mis-asignaciones/_components/chat/chat-contactos";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// FICHA 430 (SF-001, punto 3) — LA COMPOSICION DE LOS CONTACTOS DEL CHAT.
//
// Modulo PURO, sin jsdom: lo que se fija aqui es QUE ordenes son contactos y en que grupo cae cada
// una. Lo que se VE (el badge del dia, la frase con su fecha, el detalle completo, y que desde el
// chat no se pueda trabajar la orden) vive en `tests/components/ChatContactoAntesDeRecoger.test
// .tsx`, que monta la superficie de verdad.
//
// El agujero que cierra: hasta el 2026-09-15 los contactos eran `[...porGestionar, ...conAyuda]`,
// o sea solo lo ya recogido, y una orden asignada la noche antes no tenia fila donde abrirse.

function orden(
  id: string,
  estatusValue: string,
  extra: Partial<MiAsignacionDTO> = {},
): MiAsignacionDTO {
  return {
    id,
    numGuia: 1000,
    numRemision: `R-${id}`,
    estatusValue,
    destinatario: `Cliente ${id}`,
    telefonoDest: "88887777",
    direccion: "Calle 1",
    producto: "Caja",
    peso: 1,
    montoCobrar: 5000,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "Tienda",
    zonaNombre: "Zona",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    sinpeNumero: "80000000",
    sinpeNombre: "Titular de Prueba",
    secuenciaRuta: null,
    ...extra,
  };
}

const EN_REPARTO = orden("a", "en_reparto", { secuenciaRuta: 1 });
const CON_AYUDA = orden("b", "ayuda_tienda");
const POR_RECOGER_HOY = orden("c", "por_recoger");
const POR_RECOGER_MANANA = orden("d", "por_recoger", {
  esParaManana: true,
  fechaRepartoISO: "2026-09-16",
});

const ids = (ordenes: MiAsignacionDTO[]) => ordenes.map((o) => o.id);

describe("agruparContactosChat — LA ficha: las asignadas sin recoger son contactos", () => {
  it("una orden en `por_recoger` entra a la lista de contactos", () => {
    const contactos = agruparContactosChat([EN_REPARTO], [], [POR_RECOGER_HOY]);

    expect(ids(contactos.todas)).toContain("c");
    expect(ids(contactos.porRecogerHoy)).toEqual(["c"]);
  });

  it("sin esta ficha la lista era solo lo ya recogido: el tercer argumento es lo que cambia", () => {
    // La contraprueba de que el test de arriba mide algo. Con las mismas dos primeras listas y
    // SIN la tercera, la composicion es exactamente la de antes del 2026-09-15.
    const antes = agruparContactosChat([EN_REPARTO], [CON_AYUDA]);

    expect(ids(antes.todas)).toEqual(["a", "b"]);
    expect(antes.porRecogerHoy).toEqual([]);
    expect(antes.paraOtroDia).toEqual([]);
  });

  it("las tres listas entran enteras y ninguna orden se pierde ni se duplica", () => {
    const contactos = agruparContactosChat(
      [EN_REPARTO],
      [CON_AYUDA],
      [POR_RECOGER_HOY, POR_RECOGER_MANANA],
    );

    expect(ids(contactos.todas)).toEqual(["a", "b", "c", "d"]);
    expect(new Set(ids(contactos.todas)).size).toBe(4);
  });
});

describe("los grupos: lo que el mensajero tiene en la mano decide el sitio", () => {
  it("las ya recogidas (en reparto + ayuda) van juntas y PRIMERO", () => {
    const contactos = agruparContactosChat(
      [EN_REPARTO],
      [CON_AYUDA],
      [POR_RECOGER_HOY],
    );

    expect(ids(contactos.conElPaquete)).toEqual(["a", "b"]);
    // El orden no es cosmetico: `ChatFlotante` entra por `todas[0]` cuando no hay ninguna orden
    // en detalle, asi que quien ya tiene paquetes encima abre donde abria antes de esta ficha.
    expect(contactos.todas[0]?.id).toBe("a");
  });

  it("la reservada para otro dia cae en su propio grupo, separada de la de hoy", () => {
    const contactos = agruparContactosChat(
      [],
      [],
      [POR_RECOGER_HOY, POR_RECOGER_MANANA],
    );

    expect(ids(contactos.porRecogerHoy)).toEqual(["c"]);
    expect(ids(contactos.paraOtroDia)).toEqual(["d"]);
  });

  it("sin el campo del dia, la orden se queda en el grupo de hoy (patron aditivo del DTO)", () => {
    // `esParaManana?` es opcional: una orden servida por un despliegue anterior llega sin el. La
    // regla la pone `separarPorDia` (277/R3) y aqui se comprueba que esta funcion la hereda en
    // vez de inventarse otra.
    const contactos = agruparContactosChat([], [], [orden("e", "por_recoger")]);

    expect(ids(contactos.porRecogerHoy)).toEqual(["e"]);
    expect(contactos.paraOtroDia).toEqual([]);
  });

  it("`false` explicito tampoco la manda a otro dia", () => {
    const contactos = agruparContactosChat(
      [],
      [],
      [orden("f", "por_recoger", { esParaManana: false })],
    );

    expect(ids(contactos.porRecogerHoy)).toEqual(["f"]);
  });

  it("preserva el orden de entrada dentro de cada grupo: agrupar no es reordenar", () => {
    const uno = orden("1", "por_recoger");
    const dos = orden("2", "por_recoger");
    const tres = orden("3", "por_recoger");

    const contactos = agruparContactosChat([], [], [tres, uno, dos]);

    expect(ids(contactos.porRecogerHoy)).toEqual(["3", "1", "2"]);
  });

  it("no hay ninguna asignada: los cuatro campos vienen vacios", () => {
    const contactos = agruparContactosChat([], [], []);

    expect(contactos.todas).toEqual([]);
    expect(contactos.conElPaquete).toEqual([]);
    expect(contactos.porRecogerHoy).toEqual([]);
    expect(contactos.paraOtroDia).toEqual([]);
  });
});

describe("los textos de la cabecera", () => {
  it("el contador concuerda en singular", () => {
    expect(contadorContactos(1)).toBe("1 asignada");
  });

  it("y en plural", () => {
    expect(contadorContactos(0)).toBe("0 asignadas");
    expect(contadorContactos(4)).toBe("4 asignadas");
  });

  it("ya no dice «en reparto»: con esta ficha la lista deja de ser solo de reparto", () => {
    // El contador viejo era `${n} en reparto`. Si alguien lo repone, la cabecera vuelve a
    // afirmar algo que la lista contradice tres lineas mas abajo.
    expect(contadorContactos(3)).not.toContain("en reparto");
    expect(SIN_CONTACTOS).not.toContain("en reparto");
  });
});

/* -------------------------------------------------------------------------- */
/* EL COMPOSITION ROOT: alguien tiene que PASAR las listas, no solo importarlas */
/* -------------------------------------------------------------------------- */
//
// El typecheck garantiza que las props existen (`porRecoger` es REQUERIDA en los dos consumidores),
// pero no que la pagina baje la lista de verdad en vez de un `[]`. Ese hueco ya costo caro en este
// repo -notificadores inyectados en ninguna parte con la suite en verde-, y aqui produciria un
// fallo MUDO: el chat simplemente no tendria esas conversaciones y nada fallaria.

const RAIZ = path.resolve(__dirname, "../../..");

function leer(rel: string): string {
  const ruta = path.join(RAIZ, rel);
  if (!fs.existsSync(ruta)) {
    throw new Error(
      `chat-contactos: falta \`${rel}\`. El test NO puede dar por buena una lectura vacia; si la ` +
        `pantalla se movio, actualiza la ruta — no borres la comprobacion.`,
    );
  }
  return fs.readFileSync(ruta, "utf8");
}

const PAGINA_REPARTO = "app/(app)/mis-asignaciones/reparto/page.tsx";
const PAGINA_RECOGER = "app/(app)/mis-asignaciones/recoger/page.tsx";

describe("las dos pantallas del portal bajan las asignadas sin recoger", () => {
  it("la lectura no esta vacia (si no, todo lo de abajo pasaria por no encontrar nada)", () => {
    expect(leer(PAGINA_REPARTO).length).toBeGreaterThan(200);
    expect(leer(PAGINA_RECOGER).length).toBeGreaterThan(200);
  });

  it("Reparto le pasa `result.porRecoger` al modulo", () => {
    expect(leer(PAGINA_REPARTO)).toMatch(/porRecoger=\{result\.porRecoger\}/);
  });

  it("«Por recoger» monta el chat con las TRES listas, no solo con la suya", () => {
    const fuente = leer(PAGINA_RECOGER);

    expect(fuente).toContain("<ChatDelMensajero");
    // Las tres: si faltara `porGestionar`/`conAyuda`, esta pantalla listaria menos contactos que
    // Reparto y su distintivo de sin leer diria otro numero.
    expect(fuente).toMatch(/porGestionar=\{result\.porGestionar\}/);
    expect(fuente).toMatch(/conAyuda=\{result\.conAyuda\}/);
    expect(fuente).toMatch(/porRecoger=\{result\.porRecoger\}/);
  });

  it("el detector no es un espejo: un `[]` quemado no pasaria", () => {
    // Autocomprobacion. Sin esto, un patron demasiado laxo se quedaria verde el dia que alguien
    // «simplifique» la pagina pasando una lista vacia.
    const falsificada = leer(PAGINA_REPARTO).replace(
      "porRecoger={result.porRecoger}",
      "porRecoger={[]}",
    );
    expect(falsificada).not.toMatch(/porRecoger=\{result\.porRecoger\}/);
  });
});
