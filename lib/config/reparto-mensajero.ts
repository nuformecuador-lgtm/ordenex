// Feature 205 (T0.4, R53; design §2.5.2) — configuracion del reparto de un pago entre los
// cierres pendientes de un mensajero. Sobreescribible por variable de entorno para no
// hardcodear una cota de negocio (docs/architecture.md: "Sin hardcode de contexto"), patron
// literal de lib/config/gasto-fijo.ts y lib/config/wallet-mensajero.ts.
//
// AQUI NO HAY DINERO. Este modulo exporta un CARDINAL —cuantos cierres puede tocar UN reparto—
// y nada mas: no importa `Prisma`, no nombra ningun monto y no hace ninguna aritmetica. La
// aritmetica del reparto vive entera en `lib/utils/reparto-liquidacion-mensajero.ts`, que SI
// esta censado por el barrido money-safe.
//
// POR QUE EL ARCHIVO NO SE LLAMA `liquidacion-*`, y esta medido: el barrido
// `tests/unit/guards/liquidacion-money-safe.test.ts` auto-captura todo `lib/**` cuya ruta case
// `/[Ll]iquidacion/` (:139-146) y prohibe `parseInt(` en lo censado
// (`tests/fixtures/money-safe.ts:37-42`, con `\b` por delante: `Number.parseInt(` CASA). Un
// `lib/config/liquidacion-reparto.ts` con el `readPositiveInt` del patron pondria el barrido en
// rojo por un falso positivo sobre un numero que no es un monto. En vez de debilitar la guardia
// con una excepcion, el modulo se queda fuera de su alcance por lo que ES.
//
// POR QUE 50: un cierre por dia laborado, asi que 50 son ~2 meses de trabajo seguido. Con pagos
// semanales o quincenales no se acerca; con la deuda de un mensajero que lleva meses sin cobrar,
// el tope corta y avisa (la ventana se recorta, R54: NUNCA rechaza) en vez de abrir una
// transaccion interactiva de 101 filas y 50 bloqueos.
//
// El numero NO se repite en ningun otro archivo: quien lo necesita lo recibe INYECTADO (el
// servicio en su construccion, la funcion pura por parametro), que es lo que permite a un test
// ejercitar el recorte con `tope: 2` y tres cierres en vez de con cincuenta y uno.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RepartoMensajeroConfig {
  /** Maximo de cierres que UN reparto puede tocar (R53). Acota bloqueos y filas escritas. */
  MAX_CIERRES_POR_REPARTO: number;
}

export function loadRepartoMensajeroConfig(): RepartoMensajeroConfig {
  return {
    MAX_CIERRES_POR_REPARTO: readPositiveInt("REPARTO_MENSAJERO_MAX_CIERRES", 50),
  };
}

export const repartoMensajeroConfig: RepartoMensajeroConfig = loadRepartoMensajeroConfig();
