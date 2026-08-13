// Feature 207 — el detector de MONTAJES de un componente compartido, extraído de
// `cobertura-tablas.guardia.test.ts`.
//
// Vive aparte por la misma razón que `etiquetas-datatable.ts`: la función no tenía ningún
// test propio y no podía tenerlo sin importar un archivo `.test.ts` desde otro (vitest
// re-registraría los `describe` de la guardia y ésta correría dos veces por tanda). Lo que se
// extrae es el PREDICADO —«¿este fuente monta ese componente?»—, no el recorrido del árbol:
// el recorrido sigue en la guardia, que es quien decide qué árboles mira.
import path from "node:path";

import { quitarComentarios } from "../../fixtures/money-safe";

/**
 * `true` si `fuenteBruta` MONTA de verdad el componente que vive en `rutaComponente`.
 *
 * Se exige lo mismo que para importar (`from "@/…"`) y para renderizar (`<Nombre …`), porque
 * solo con lo primero un re-export contaría como montaje, y solo con lo segundo lo haría
 * cualquier archivo que nombre el componente de pasada.
 *
 * ------------------------------------------------------------------------------------
 * Feature 207 — SE ESCANEA EL CÓDIGO, NO LA PROSA.
 *
 * El escaneo se hacía sobre el fuente CRUDO. Exigir import Y JSX a la vez MITIGA el problema
 * —hace falta que las dos cosas aparezcan en el mismo archivo— pero no lo cierra: basta con
 * que el archivo importe el componente de verdad y lo nombre entre ángulos en un comentario.
 * Eso no es hipotético, está en el árbol hoy: aplicando esta misma lógica a
 * `components/ui/input.tsx`, `RankingHistoricoModule.tsx` aparece como consumidor porque
 * importa `@/components/ui/input` (el `Input` con mayúscula) y cita `<input type="date">` en
 * dos comentarios, sin montar ni un solo `<input>` en minúscula.
 *
 * Un falso positivo aquí no es un rojo cualquiera: la guardia obligaría a DECLARAR en el censo
 * un montaje que no existe, es decir a escribir en el registro algo que el código no hace.
 *
 * Por eso los comentarios se quitan ANTES de escanear, reusando el `quitarComentarios` de
 * `tests/fixtures/money-safe.ts` (el mismo que usa `etiquetas-datatable.ts`): cubre el
 * comentario de línea —sin confundirse con el `//` de una URL—, el de bloque y el de JSX, que
 * es un bloque envuelto en llaves. Los montajes de las dos tablas compartidas del censo NO se
 * movieron con el cambio (2 y 2, medido antes y después). Las dos caras están fijadas en
 * `montajes-componente.test.ts`.
 */
export function montaComponente(fuenteBruta: string, rutaComponente: string): boolean {
  const fuente = quitarComentarios(fuenteBruta);
  const nombre = path.basename(rutaComponente).replace(/\.tsx$/, "");
  const especificador = `@/${rutaComponente.replace(/\.tsx$/, "")}`;
  const jsx = new RegExp(`<${nombre}[\\s/>]`);
  return fuente.includes(`from "${especificador}"`) && jsx.test(fuente);
}
