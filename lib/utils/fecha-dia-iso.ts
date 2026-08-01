/**
 * Feature 170 (T C.3) — día calendario (`YYYY-MM-DD`) de un instante ISO que YA viene como
 * texto desde el servidor.
 *
 * Existe porque los cuatro ledgers de dinero exponen `fechaMovimiento` como STRING ISO (no
 * como `Date`) y las cuatro tablas lo pintan con `m.fechaMovimiento.slice(0, 10)`. Las
 * columnas de export tienen que emitir EXACTAMENTE lo mismo (R11/R24), y hacerlo en cuatro
 * módulos con cuatro `slice` sueltos es cuatro sitios donde el criterio puede divergir.
 *
 * Por qué una expresión regular y no `.slice(0, 10)` sobre el valor recibido: la guardia de
 * datos sensibles ejecuta cada proyección con una SONDA (un proxy que responde a cualquier
 * lectura), y llamar a un MÉTODO sobre un campo de la sonda revienta. Con `String(valor)`
 * primero y una expresión regular después, la proyección sobrevive a la sonda Y conserva su
 * rastro (el marcador entero viaja como valor de la celda), que es justo lo que permite a la
 * guardia decir de qué campo salió cada celda.
 *
 * Un texto que no empiece por una fecha calendario se devuelve TAL CUAL en vez de recortarse
 * a ciegas: recortar los diez primeros caracteres de algo que no es una fecha produce basura
 * con pinta de dato.
 */
const DIA_ISO = /^\d{4}-\d{2}-\d{2}/;

export function fechaDiaISO(valor: string): string {
  const texto = String(valor);
  const dia = DIA_ISO.exec(texto);
  return dia ? dia[0] : texto;
}
