# Review — Feature 217 · «la factura del cierre oscurece con el tema»

Rama `feature/217-factura-oscurece-con-el-tema` (7 commits sobre `dev` @ `45173fef`),
árbol limpio. Revisión hecha abriendo los tests uno a uno y **remidiendo los números por
una vía independiente**, no leyendo la bitácora.

**VEREDICTO: RECHAZADO** — 2 bloqueantes. El trabajo es sólido y casi todo lo verificado
resiste; lo que lo tumba es **un requisito (R15) cuyo test no puede ponerse rojo por la
razón que dice**, y que además figura en la bitácora como mutación vista roja.

---

## Lo que verifiqué por mi cuenta (no repetido de la bitácora)

| Qué | Cómo | Resultado |
| --- | --- | --- |
| `typecheck` | `pnpm run typecheck` | verde |
| `lint` | `pnpm run lint` | 0 errores (64 warnings preexistentes) |
| Guardias | `pnpm run test:guardias` | **96 archivos / 1360 tests, verde** |
| Los 4 archivos de la ficha | `vitest run` sobre los 4 | **72 tests verdes** |
| Tests preexistentes de la factura | `CierresAdminModule.test.tsx` | 32 verdes, **sin modificar** (no está en el diff) |
| Censo de tinta fija | `grep navy` / `grep tema-claro` en el `.tsx` | **0 y 0**, prosa incluida |
| Frontera | `git diff --name-only 804b6b05..HEAD` | 8 archivos, exactamente `design.md §0`; cero `db/`, `lib/`, `app/api/`, `components/ui/` |
| **Los 26 números del inventario** | script propio, aritmética escrita desde cero, con autocomprobación WCAG (21.00 y 4.54) | **coinciden a la centésima los 26**, incluidos P9 4.77/6.60, P20 3.76/5.89, P21 3.18/7.06, P22 3.29/4.43 y el R4 navy 15.39 → foreground 15.70 |
| Segunda copia de la fórmula | `grep 0.2126` en todo el repo | sólo `tests/fixtures/contraste.ts`. Las otras 4 viven en `.claude/skills/impeccable/`, que nada del árbol referencia |

Nota de paso: `.claude/skills/impeccable/scripts/live-browser.js:8323` calcula la
luminancia como `(0.2126*r + …)/255`, **sin linealizar sRGB**. El medidor que D9 prohibió
es efectivamente incorrecto; la decisión de la puerta se sostiene sola.

---

## Checklist de CHECKPOINTS.md

- [x] `specs/217/requirements.md` con EARS numerados (R1–R26).
- [x] `specs/217/design.md` con alternativas descartadas (nueve, A–I, con su porqué).
- [ ] **`specs/217/tasks.md` con todas las tareas marcadas `[x]`** → **0 de 23 marcadas.**
- [~] Cada `R<n>` mapea a un test concreto → **25 de 26 con dueño real; R15 no.**
- [x] `progress/impl_217.md` contiene el mapa `R → test`.
- [x] `typecheck` / `lint` / tests verdes.
- [x] E2E: **no aplica** (no hay harness ejecutable en el repo, y la feature no toca auth,
      pagos, recaudo, ingesta ni webhooks).
- [x] Datos y seguridad: **no aplica** — cero tablas, cero migraciones, cero RLS, cero
      webhooks, cero secretos. Verificado por `git diff --name-only`.
- [x] Patrón de capas: la hoja sigue siendo presentación pura (hay guardia ejecutable).
- [x] Multi-país / configuración: nada hardcodeado; el cambio es de tokens de color.
- [x] `./init.sh` completo verde (medido por el leader: 1093 archivos / 13.917 tests).
- [ ] `progress/history.md` sin entrada de la 217 (cierre del leader, no del implementer).

---

## Hallazgos

### BLOQUEANTE 1 — El test de R15 no puede ponerse rojo, y la bitácora dice que lo vio

`tests/unit/guards/tema-encendido.guardia.test.ts:230-241`, caso «junto a la regla de
impresion queda escrito su limite: no apaga el variant `dark:` (R15)»:

```js
const donde = crudo.indexOf("@media print");
const comentarioDeArriba = crudo.slice(Math.max(0, donde - 3000), donde);
expect(comentarioDeArriba).toMatch(/`dark:`/);
```

`crudo.indexOf("@media print")` **no cae en la regla**. El primer literal `@media print`
del archivo está en `app/globals.css:134`, dentro del comentario de `.tema-claro`
(«…sólo vuelve a claro AL IMPRIMIR, con la regla `@media print` de aquí abajo»). La regla
real está 120 líneas más abajo, en `app/globals.css:254`.

Consecuencia: la ventana de 3000 caracteres que el caso inspecciona cubre las líneas
**68-134**, y el `` `dark:` `` que la satisface es el de `app/globals.css:128` — prosa de
la **feature 211** sobre las utilidades `dark:` dentro de `.tema-claro`, que no tiene
nada que ver con el límite de la regla de impresión.

Medido, simulando el caso sobre copias del archivo (sin tocar el árbol):

| Escenario | `indexOf` | Veredicto del caso |
| --- | --- | --- |
| árbol real | 5635 (línea 134) | **verde** |
| borrado el bloque «LO QUE ESTA REGLA **NO** APAGA» (`:221-238`) | 5635 | **verde** |
| borrado el comentario **entero** de la regla (`:197-253`) | 5635 | **verde** |

Se puede borrar toda la declaración que R15 exige y el caso sigue verde. Lo que hoy
vigila es el comentario de `.tema-claro`, no el de la impresión.

**Por eso la fila 13 de la tabla de mutaciones (`progress/impl_217.md:486`) —«borrar la
declaración del límite `dark:` junto al bloque → R15 → 1 caso rojo»— no es
reproducible.** R24 dice que una guardia que nadie vio morder no es evidencia; aquí la
guardia **no puede** morder.

Dos matices, para que el arreglo sea del tamaño correcto:

- La declaración **sí está escrita** en el árbol (`app/globals.css:221-238`) y es buena:
  nombra el variant, dice por qué se acepta, da el número del peor caso (2.89 → 4.43) y
  remite a la ficha propia. El contenido de R15 se cumple; lo que falta es su dueño.
- La otra mitad de R15 —no tocar `@custom-variant dark`— sí tiene dueño real y verde
  (`tema-encendido` › «el variant `dark:` dispara por CLASE y tambien por preferencia del
  sistema», intacto).

**Para levantarlo:** anclar el caso a la **regla** (buscar `@media print {`, o partir del
índice que ya localiza `reglaCon(".papel-al-imprimir")`), correr otra vez la mutación 13
**viéndola roja de verdad**, y corregir esa fila de la bitácora con el resultado real.

### BLOQUEANTE 2 — `tasks.md`: 0 de 23 tareas marcadas

`specs/217-factura-oscurece-con-el-tema/tasks.md` tiene **23 `- [ ]` y ningún `- [x]`**.
CHECKPOINTS.md lo pide explícitamente. Es trámite y se arregla en un minuto, pero
mientras esté así el estado en disco dice que no se hizo nada y la bitácora dice que se
hizo todo: es justo la desincronización que este arnés existe para no tener.

---

## Menores (no bloquean, pero conviene que queden dichos)

1. **menor — el par de `Badge` variant `destructive` no está en el inventario.**
   `EstadoCierreBadge` pinta ese variant para `rechazado` y `vencido`, y se monta en las
   **dos** hojas (`cierre-factura.tsx:516` y `:1104`). El par que produce
   (`danger-strong` sobre `danger-soft` / `danger/15`) **sí está medido y con suelo**,
   pero en la guardia de la 210, no en el `INVENTARIO` de la 217, y aquí sólo se declara
   en prosa (`impl_217.md`, tabla T13). Por la regla de R16 —«un exento que desaparece de
   la lista es indistinguible de un par que nadie miró»— debería figurar en la lista,
   aunque sea remitiendo a su guardia. Cobertura: no falta nada. Lista: sí.

2. **menor — el CIERRE cierra por UTILIDAD, no por PAR.**
   `tests/unit/guards/factura-contraste.guardia.test.ts:816` recorre las utilidades del
   `.tsx` y exige que cada una caiga en un par declarado. Eso caza un `text-emerald-500`
   nuevo, pero **no** caza mover una utilidad ya declarada a un fondo nuevo: poner
   `text-muted-foreground` dentro de `bg-success/15` crea un par que nadie midió y las dos
   utilidades ya están en la lista → verde. La prosa del caso («si mañana alguien pinta un
   texto de la hoja con una pareja que nadie listó, lo caza el cierre») promete más de lo
   que puede, y `design.md §6.3` arrastra la misma frase. Bajar la afirmación al tamaño
   real basta; no hace falta cambiar el mecanismo.

3. **menor — las dos medidas contra la trampa del lector no están vigiladas por separado.**
   Verificado que el mecanismo es el que la ficha describe: el bloque vive en
   `app/globals.css:254`, antes de `.dark` (`:311`) y del espejo `prefers-color-scheme`
   (`:370`), y por eso `token("oscuro", …)` devuelve los hexes oscuros (P1 oscuro 13.74 ≠
   claro 15.70). Confirmo además, leyendo el orden del archivo, que **el hallazgo del
   implementador es correcto**: con el bloque justo detrás de `.dark`, el espejo vuelve a
   declarar los tokens y gana el último, así que esa variante de la mutación sale verde;
   hay que ponerlo detrás de los dos. Pero hoy (a) `quitarBloquesDeImpresion` es un no-op
   —el bloque no cae en la mitad «oscuro»— así que **borrarlo no pone nada rojo**, y (b)
   ningún caso exige que el bloque siga **antes** de `.dark`. Las dos defensas se pueden
   retirar de una en una sin que el gate diga nada; sólo la combinación falla. Es lo que
   `design.md §6.2` eligió a propósito, pero conviene saber que ninguno de los dos
   tirantes está clavado.

4. **menor — R4 se mide sobre `card`, y sólo sobre `card`.** El caso compara `navy`
   (15.39) con `--foreground` (15.70) sobre el papel. Cinco de los dieciséis sitios
   migrados viven sobre `muted`, `muted/40` o `muted/50`. El argumento que salva al resto
   es correcto y monotónico —`#12233f` tiene **menos** luminancia que `#0b2545`, así que
   gana contraste contra cualquier fondo más claro que los dos— pero no está escrito en el
   caso, y quien lo lea mañana no sabrá si el fondo único fue decisión o descuido.

5. **menor — la mitad CSS de R19 sólo caza la ruta del archivo.** `tema-encendido` › «la
   prosa de `.tema-claro` ya no lista la factura entre sus consumidores» cuenta apariciones
   de la cadena `cierre-factura` antes de la declaración. Volver a listar la factura sin
   escribir la ruta («2. Las dos hojas de la factura del cierre») pasa en verde. La mitad
   `.tsx` —0 `tema-claro` en todo el archivo, prosa incluida— sí es sólida.

6. **menor — R14 no censa `@page` en el CSS.** Se censa `window.print`, el rótulo
   «Imprimir» y `print-color-adjust`, pero un `@page` añadido a `app/globals.css` no
   pondría nada rojo. Hoy `@page` sólo aparece en prosa: es preventivo.

7. **menor — R5 no tiene dueño ejecutable propio.** Su evidencia es el diff (comprobado:
   las 18 líneas tocadas difieren **sólo** en el token de color) más los 7 archivos de
   tests de componente preexistentes verdes sin modificar. Es lo razonable para un «no
   rediseñes», pero la fila del mapa `R → test` debería decirlo así.

8. **menor — `progress/history.md` sin entrada de la 217.** Cierre del leader.

---

## Lo que sí resistió, y merece quedar dicho

- **Los 26 números del inventario son reales.** Los remedí con una implementación
  independiente (parser propio de `globals.css`, luminancia y composición alfa escritas
  desde cero, con autocomprobación 21.00 / 4.54) y coinciden a la centésima, uno por uno,
  incluidos los tres que se declaran bajo AA. En una jornada con tres medidores falsos,
  esto no es trámite.
- **El par que el spec se había olvidado está MEDIDO, no mencionado.** P19
  (`card-foreground` sobre `card`, 15.70 / 13.74) es la tinta que hereda todo texto sin
  clase de color, y **ninguna utilidad la escribe**: un censo de utilidades no la ve
  nunca. Encontrarla es el hallazgo más valioso de la ficha.
- **El inventario está CERRADO de verdad.** Recorrí las 20 utilidades de color vivas del
  `.tsx` una a una: todas mapean. Los tres huecos del spec (P17 `border-t-brand`, P18
  `border-border`, P19) quedaron cerrados con motivo escrito, no por omisión, y los
  exentos exigen motivo de más de 40 caracteres en el propio caso.
- **«Cero indeterminados» es cierto, no verosímil.** Comprobado en el árbol que las
  cuatro capas de opacidad cuelgan directamente de la `Card`: `bg-muted/40` en `:245`,
  `bg-muted/50` en `:581` y `:1317`, `bg-success/15` y `bg-warning/15` en `:790` y `:840`,
  y el `hover:bg-muted/50` de `:925` (las filas viven en la sección de pestañas, sobre el
  papel). **No hay ninguna opacidad sobre otra opacidad.**
- **Lo que entra por props está clasificado y no falta nada relevante.** Verifiqué los dos
  llamadores (`CierresAdminModule.tsx:749` y `:827`, `CierreDiaModule.tsx:730`), que
  `rotulo` no lo usa nadie, que `extra` sólo lo usa `CierreBodegaFacturaResumen` —que a su
  vez **no tiene ningún llamador en el repo**— y que `KpiValorAnimado` no trae color
  propio. El único par que se quedó fuera de la lista es el del menor 1.
- **La 210 salió intacta.** El diff de `contraste-tokens.guardia.test.ts` sólo quita
  definiciones y añade un `import`: ningún caso cambió de nombre ni de aserción, y los
  tres autocontroles corren hoy sobre la copia compartida (13 tests verdes).
- **R20 está reexpresado y no relajado.** El título nombra `app/page.tsx` y
  `lib/tema/tema.ts` y ya no la factura; el cuerpo conserva sus dos aserciones; y hay un
  caso que vigila **las dos mitades**: que no vuelva a mentir y que no desaparezca.
- **R17/R18 están declarados con motivo, número y fecha, y son ejecutables.** P20
  3.76/5.89, P21 3.18/7.06, P22 3.29/4.43, con `toEqual(["P20","P21","P22"])`: si la 210 o
  la 216 pagan una de esas deudas, el caso se pone rojo y obliga a actualizar la
  declaración. Ninguna se parcheó dentro de la hoja (`git diff --name-only` sin
  `components/ui/`).

---

## Para levantar el rechazo

1. Anclar el caso de R15 a la **regla** de impresión y no al primer literal
   `@media print`; volver a correr la mutación 13 y **verla roja**; corregir la fila 13 de
   `progress/impl_217.md`.
2. Marcar las 23 tareas de `specs/217-factura-oscurece-con-el-tema/tasks.md`.

Con esas dos, la ficha pasa. Los ocho menores no bloquean; el 1, el 2 y el 3 valen una
nota en la bitácora aunque no se toque el código.

*Revisado el 2026-08-13. Ningún archivo de código ni de tests fue modificado en esta
revisión; `git status` quedó limpio.*
