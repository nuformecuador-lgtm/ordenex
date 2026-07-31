/**
 * Feature 167 (R31) — tope de PRESENTACION de «Recolectadas hoy»: las 100 mas recientes del
 * dia. Decision del humano en la puerta del 2026-07-31 (pregunta abierta 2): solo el dia en
 * curso, tope 100, con aviso de recorte; sin "ver mas" ni historico de dias anteriores.
 *
 * El tope es de PRESENTACION, no de correccion: el service pide `TOPE + 1` fila y, si vuelve la
 * de mas, recorta a TOPE y marca `recolectadasHoyRecortada`. Asi el flag sale de un hecho medido
 * (habia al menos una mas) y no de un conteo extra ni de una suposicion.
 *
 * Vive AQUI, y no dentro del service, porque el numero lo necesitan los DOS lados: el service lo
 * aplica y el aviso de recorte que lee el mensajero lo NOMBRA. Mientras el texto llevaba el 100
 * escrito a mano, cambiar el tope dejaba el aviso mintiendo sin que ningun test lo notara
 * (hallazgo m5 del review). Un modulo de constantes puro —sin Prisma, sin repos, sin `zod`— es
 * ademas lo unico que un componente de cliente puede importar sin arrastrar el service entero
 * al bundle ni cruzar el borde RSC.
 */
export const TOPE_RECOLECTADAS_HOY = 100;
