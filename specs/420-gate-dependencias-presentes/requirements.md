# Feature 420 — El gate dice "dependencias presentes" cuando falta una dependencia declarada (requirements)

> **Defecto medido (2026-09-11).** `init.sh:38-43` comprueba si existe el **directorio**
> `node_modules` y, si existe, imprime `✓ dependencias presentes` **sin mirar el
> `package.json`**. Tras mergear la ficha 410 —que añade `web-push` y `@types/web-push`— el
> gate completo sobre `dev` dio ese visto bueno **en verde** y dos pasos más tarde:
>
> ```
> lib/push/web-push-sender.ts(11,21): error TS2307: Cannot find module 'web-push'
> INIT_EXIT=1
> ```
>
> Parecía un error de código y era un `pnpm install` que faltaba. Se resolvió en 1,3 s.
> Reproducido byte a byte en el worktree de esta ficha antes de tocar nada (ver
> `progress/impl_420.md`, sección "Evidencia").

> **Es la familia de fallo que este repo persigue: el sistema no falla, aparenta.** Y engaña en
> la peor dirección: dice que algo está bien **justo en el paso que existe para avisarte de lo
> contrario**. Un paso que afirma sin medir es peor que no tener el paso, porque crees que te
> cubre (mismo argumento que el bloque `jq` opcional de `init.sh:52-67`).

> **Hallazgo adicional, medido aquí (2026-09-11) y que agranda el agujero.** Quitar **solo** el
> paquete de runtime `node_modules/web-push` y dejar `node_modules/@types/web-push` deja el
> **typecheck en VERDE** (TypeScript resuelve las declaraciones desde `@types/`) — el gate
> entero pasaría y el fallo saldría **en ejecución, en producción**. O sea: el typecheck **no
> es** una red de seguridad para este fallo; solo lo caza cuando faltan los dos. El paso de
> dependencias es estrictamente más fuerte que el typecheck para esto.

> **Alcance (solo esto):** que el paso 2 de `init.sh` **mida** lo que afirma. Más el script que
> hace la medición y sus tests.
>
> **Fuera de alcance:**
> - Instalar, reparar o modificar el árbol cuando ya existe `node_modules` (ver design.md,
>   alternativa A1 descartada **con medición**).
> - Comprobar que la **versión** instalada satisface el rango declarado, o que `pnpm-lock.yaml`
>   está sincronizado con `package.json`: el defecto medido es **ausencia**, y de la
>   sincronización ya responde `--frozen-lockfile` cuando alguien instala. Límite declarado,
>   no olvidado (design.md, "Lo que esto NO cubre").
> - Dependencias **transitivas**: se comprueba lo **declarado** en `package.json`, que es lo
>   que el código importa por nombre.
> - `tests/integration/db/*-migration.test.ts` — los toca la ficha **421**, en paralelo.
> - `feature_list.json` — lo lleva el leader.

Notación EARS. Cada `R<n>` es testeable y trae su mapeo a test propuesto; el implementer lo
concreta en `progress/impl_420.md`.

---

## La comprobación

- **R1 (Ubicuo).** El paso de dependencias del gate DEBE comprobar, **paquete por paquete**,
  que cada dependencia declarada en `dependencies` y `devDependencies` de `package.json` está
  realmente instalada en el árbol (`node_modules/<nombre>` resoluble como paquete), y NO
  conformarse con que el directorio `node_modules` exista.

- **R2 (Condicional).** SI al menos una dependencia declarada NO está en el árbol, ENTONCES el
  paso de dependencias DEBE terminar en **rojo**, **cortar el gate ahí mismo** (antes de
  typecheck), y **nombrar cada paquete ausente**.

- **R3 (Por evento).** CUANDO el paso termine en rojo por dependencias ausentes, el sistema
  DEBE imprimir el comando exacto de reparación (`pnpm install --frozen-lockfile`), porque el
  arreglo medido cuesta ~1,7 s y lo caro es el diagnóstico, no la reparación.

- **R4 (De estado).** MIENTRAS todas las dependencias declaradas estén presentes, el paso DEBE
  pasar en verde **sin instalar nada, sin usar la red y sin modificar el árbol**, e informar
  **cuántas** dependencias comprobó. La cifra se **mide en cada corrida**; escrita a mano
  caducaría con el siguiente `pnpm add`, y una cifra caducada engaña más que ninguna (misma
  regla que `anunciar_tests_contra_postgres`).

- **R5 (Condicional).** SI `node_modules` no existe en absoluto (árbol recién clonado o
  `git worktree add` recién hecho), ENTONCES el sistema DEBE instalar con
  `pnpm install --frozen-lockfile` y, SI esa instalación falla, terminar en **rojo**. En ese
  caso no hay nada que "reportar": el árbol está vacío y la única salida útil es instalarlo.

- **R6 (Ubicuo).** `init.sh` DEBE **invocar** la comprobación y **fallar** cuando esta falle.
  Que el script exista no basta: un verificador que nadie llama es exactamente el mismo fallo
  mudo que esta ficha viene a cerrar, un piso más abajo.

- **R7 (Ubicuo).** La comprobación DEBE hacerse **solo con el sistema de archivos**: sin lanzar
  procesos, sin red y sin depender de ningún paquete de `node_modules` —comprobar que las
  dependencias están presentes **usando** una dependencia sería circular, y fallaría justo en
  el caso que existe para detectar—.
