// Integracion WhatsApp — normalizacion del telefono usado como CLAVE del hilo de chat y como
// destino del envio. Meta entrega el numero entrante a veces con `+` y a veces sin el
// (`+50688887777` vs `50688887777`), y una orden puede tener el destinatario en formato local
// (8 digitos). Si se usa el crudo como clave se crean DOS `chat_conversacion` para el mismo
// cliente/orden y el panel lee el hilo equivocado (vacio).
//
// Decision del humano: normalizar con el INDICADOR DE COSTA RICA (`506`) SIN el `+`. Se
// reutiliza `normalizarTelefonoCR` (feature 87), que: quita `+`/separadores, respeta un `506`
// ya presente, antepone `506` al numero local de 8 digitos, y deja los digitos tal cual en
// longitudes atipicas (no inventa prefijo). Asi `88887777`, `+506 8888-7777` y `50688887777`
// caen todos en `50688887777`.
import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";

/** Forma canonica del telefono para keyear/matchear el hilo y para el destino del envio. */
export function normalizarTelefonoWa(numero: string): string {
  return normalizarTelefonoCR(numero);
}
