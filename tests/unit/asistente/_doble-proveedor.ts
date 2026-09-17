import type {
  ConsultaAsistente,
  IAsistenteProvider,
  RespuestaAsistente,
  TrozoProveedor,
} from "@/lib/interfaces/external/IAsistenteProvider";

/**
 * ⭑ FICHA 436 (T4) — EL DOBLE DEL PROVEEDOR.
 *
 * ⚠️ NO ES UN APAÑO: es la razón por la que esta pieza se puede verificar entera —acotamiento por
 * rol, citas, tope, streaming— **sin red y sin gastar un céntimo** (D13). La credencial existe y
 * está probada, pero la suite no la usa jamás: si algún test de `asistente` sale a internet, está
 * mal escrito.
 *
 * NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
 */

/** Emisión guionizada: qué trozos salen y con qué pausas entre ellos. */
export interface GuionDelDoble {
  /** Los textos que emite, en orden. Se convierten en trozos `texto`. */
  textos?: readonly string[];
  /**
   * Una promesa que el doble ESPERA antes de emitir el trozo `fin`. Es lo que permite medir R19
   * de verdad: el test lee tres trozos del cuerpo y sólo DESPUÉS resuelve esto, así que si algún
   * día la ruta juntara la respuesta entera antes de enviarla, el test se quedaría colgado y
   * moriría por timeout en vez de pasar en verde.
   */
  esperarAntesDelFin?: Promise<void>;
  /** Pausa (ms) entre trozo y trozo. Cero por defecto: la mayoría de los casos no la necesita. */
  pausaMs?: number;
  /** El desenlace. `ok` por defecto. */
  desenlace?: RespuestaAsistente["status"];
  tokens?: { entrada: number; salida: number; cacheLectura: number };
}

export class DobleProveedor implements IAsistenteProvider {
  /** ⭑ TODAS las consultas recibidas, ENTERAS. Es lo que afirma R11: qué texto se mandó de verdad. */
  readonly llamadas: ConsultaAsistente[] = [];

  constructor(private readonly guion: GuionDelDoble = {}) {}

  async responder(consulta: ConsultaAsistente): Promise<RespuestaAsistente> {
    this.llamadas.push(consulta);

    const desenlace = this.guion.desenlace ?? "ok";
    if (desenlace === "sin_credencial") return { status: "sin_credencial" };
    if (desenlace === "transitorio") return { status: "transitorio", detalle: "doble: caido" };
    if (desenlace === "config_invalida") {
      return { status: "config_invalida", detalle: "doble: config" };
    }

    return { status: "ok", trozos: this.emitir() };
  }

  /** Todo el texto de la última consulta: instrucciones + documentos + conversación. */
  get textoEnviado(): string {
    const ultima = this.llamadas[this.llamadas.length - 1];
    if (ultima === undefined) return "";
    return [
      ultima.instrucciones,
      ...ultima.documentos.map((doc) => `${doc.slug}\n${doc.titulo}\n${doc.cuerpo}`),
      ...ultima.mensajes.map((m) => m.texto),
    ].join("\n");
  }

  private async *emitir(): AsyncGenerator<TrozoProveedor> {
    for (const texto of this.guion.textos ?? ["respuesta del doble"]) {
      if (this.guion.pausaMs) await new Promise((r) => setTimeout(r, this.guion.pausaMs));
      yield { tipo: "texto", texto };
    }
    if (this.guion.esperarAntesDelFin) await this.guion.esperarAntesDelFin;
    const tokens = this.guion.tokens ?? { entrada: 0, salida: 0, cacheLectura: 0 };
    yield {
      tipo: "fin",
      tokensEntrada: tokens.entrada,
      tokensSalida: tokens.salida,
      tokensCacheLectura: tokens.cacheLectura,
    };
  }
}

/** Una compuerta que el test abre cuando quiere. Pareja de `esperarAntesDelFin`. */
export function compuerta(): { promesa: Promise<void>; abrir: () => void } {
  let abrir: () => void = () => {};
  const promesa = new Promise<void>((r) => {
    abrir = r;
  });
  return { promesa, abrir };
}
