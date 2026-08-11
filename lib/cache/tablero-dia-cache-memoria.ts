// Feature 192 (B9.3, design.md §5.quater) — CACHE EN MEMORIA CON RELOJ INYECTADO.
//
// Existe para que R66/R70/R72 se puedan ejercitar SIN dormir el test y SIN runtime de Next:
// acierto dentro del TTL, produccion nueva al expirar y clave distinta al cruzar la
// medianoche de Costa Rica. Un test que esperase 15 s de verdad no seria un test, seria una
// sala de espera; y uno que midiera la cache real de Next no correria en la suite unitaria.
//
// ⛔ SIN INVALIDACION, igual que el puerto (R71). Expira solo por tiempo.
//
// No es un doble de test escondido en `tests/`: vive junto al adaptador de produccion a
// proposito, para que quien cambie el puerto vea las DOS implementaciones a la vez.

import { TABLERO_DIA_CACHE_TTL_SEGUNDOS } from "@/lib/config/tablero-dia-cache";
import type { ITableroDiaCache } from "@/lib/interfaces/external/ITableroDiaCache";

interface Entrada {
  readonly valor: unknown;
  /** Instante (ms) a partir del cual la entrada ya no sirve. Cota EXCLUSIVA. */
  readonly expiraEn: number;
}

export interface OpcionesCacheMemoria {
  /** Reloj inyectado (R72). Sin default `Date.now`: un default deja creer que se controla. */
  readonly ahora: () => number;
  readonly ttlSegundos?: number;
}

export class TableroDiaCacheMemoria implements ITableroDiaCache {
  private readonly entradas = new Map<string, Entrada>();
  /** Cuantas veces se ejecuto `producir` de verdad. Lo leen los tests de R66/R68. */
  producciones = 0;

  constructor(private readonly opciones: OpcionesCacheMemoria) {}

  async envolver<T>(clave: string, producir: () => Promise<T>): Promise<T> {
    const ahora = this.opciones.ahora();
    const entrada = this.entradas.get(clave);
    if (entrada !== undefined && ahora < entrada.expiraEn) return entrada.valor as T;

    this.producciones += 1;
    const valor = await producir();
    const ttl = (this.opciones.ttlSegundos ?? TABLERO_DIA_CACHE_TTL_SEGUNDOS) * 1000;
    this.entradas.set(clave, { valor, expiraEn: ahora + ttl });
    return valor;
  }

  /** Las claves vivas, para que un test pueda afirmar QUE se cacheo (y que no). */
  claves(): readonly string[] {
    return [...this.entradas.keys()];
  }
}
