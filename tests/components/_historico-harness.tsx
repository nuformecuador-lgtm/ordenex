// @vitest-environment jsdom
// Feature 318 (bloques 5 y 6) — arnés compartido de los tests de la UI del histórico.
//
// Los cinco archivos de la feature montan la MISMA superficie viva
// (`HistoricoConversacionesModule`) con las dos Server Actions dobladas. Se centraliza aquí
// para que cada test hable de lo suyo y no de fixtures.
//
// EL STUB DE `IntersectionObserver` ES LA PIEZA CLAVE. El de `tests/setup/jest-dom.ts` no
// notifica nada (existe sólo para que el carrusel no lance), así que con él el scroll infinito
// sería intestable: nunca entra nada en vista. Aquí se instala uno que RECUERDA qué elemento
// observa cada callback y permite dispararlo a mano, que es lo que convierte «el centinela
// entró en pantalla» en un evento comprobable.
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { SWRConfig } from "swr";

import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import type {
  CursorHilo,
  CursorMensaje,
  HiloHistoricoDTO,
  ListarHilosHistoricoResult,
  ListarMensajesHistoricoResult,
} from "@/lib/types/historico-conversaciones";

/** 12:00 CR del viernes 28 de agosto de 2026 — el mismo instante que fija T2.3. */
export const AHORA = new Date("2026-08-28T18:00:00.000Z");

/** Un instante de HOY en CR (14:00 del 28). */
export const HOY_ISO = "2026-08-28T20:00:00.000Z";
/** Un instante de AYER en CR (14:00 del 27). */
export const AYER_ISO = "2026-08-27T20:00:00.000Z";
/** Miércoles 26 de agosto, 14:00 CR. */
export const MIERCOLES_ISO = "2026-08-26T20:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function hilo(extra: Partial<HiloHistoricoDTO> = {}): HiloHistoricoDTO {
  return {
    ordenId: "orden-1",
    mensajeroId: "mensajero-1",
    numGuia: 12345,
    numRemision: "REM-1001",
    destinatario: "María González",
    mensajeroNombre: "Ana Mora",
    telefonoVigenteMasked: "7777",
    telefonosCount: 1,
    ultimaActividadAt: HOY_ISO,
    totalMensajes: 4,
    ...extra,
  };
}

export function mensaje(extra: Partial<ChatMensajeVista> = {}): ChatMensajeVista {
  return {
    id: "m1",
    direccion: "entrante",
    tipo: "texto",
    cuerpo: "Hola",
    estado: null,
    latitud: null,
    longitud: null,
    media: null,
    contactos: null,
    sistema: null,
    reacciones: [],
    ocurridoAt: HOY_ISO,
    ...extra,
  };
}

export function okHilos(
  items: HiloHistoricoDTO[],
  siguiente: CursorHilo | null = null,
): ListarHilosHistoricoResult {
  return { status: "ok", items, siguiente };
}

export function okMensajes(
  mensajes: ChatMensajeVista[],
  opts: { anterior?: CursorMensaje | null; cabecera?: HiloHistoricoDTO } = {},
): ListarMensajesHistoricoResult {
  return {
    status: "ok",
    mensajes,
    anterior: opts.anterior ?? null,
    cabecera: opts.cabecera ?? hilo(),
  };
}

// ---------------------------------------------------------------------------
// `IntersectionObserver` disparable a mano
// ---------------------------------------------------------------------------

interface ObservadorRegistrado {
  callback: IntersectionObserverCallback;
  observados: Element[];
}

const registrados: ObservadorRegistrado[] = [];

class IntersectionObserverDisparable implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin = "";
  readonly thresholds: readonly number[] = [];
  private readonly registro: ObservadorRegistrado;

  constructor(callback: IntersectionObserverCallback) {
    this.registro = { callback, observados: [] };
    registrados.push(this.registro);
  }

  observe(elemento: Element): void {
    this.registro.observados.push(elemento);
  }

  unobserve(elemento: Element): void {
    this.registro.observados = this.registro.observados.filter((e) => e !== elemento);
  }

  disconnect(): void {
    this.registro.observados = [];
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Instala el observador disparable. Se llama en `beforeEach` de cada archivo. */
export function instalarObservador(): void {
  registrados.length = 0;
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    IntersectionObserverDisparable;
}

/**
 * Hace entrar en pantalla al centinela indicado. Devuelve `true` si alguien lo observaba —un
 * `false` significa que el componente no registró el observador y el test estaría midiendo
 * humo.
 */
export function dispararCentinela(elemento: Element): boolean {
  let disparado = false;
  for (const registro of registrados) {
    if (!registro.observados.includes(elemento)) continue;
    disparado = true;
    const entrada = {
      isIntersecting: true,
      target: elemento,
    } as unknown as IntersectionObserverEntry;
    registro.callback([entrada], {} as IntersectionObserver);
  }
  return disparado;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** SWR aislado por test: sin caché compartida entre archivos y sin revalidar por foco. */
export function renderHistorico(ui: ReactElement) {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}
    >
      {ui}
    </SWRConfig>,
  );
}
