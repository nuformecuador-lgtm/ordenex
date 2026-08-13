# Feature 217 — La factura del cierre oscurece con el tema · bitácora de implementación

Rama `feature/217-factura-oscurece-con-el-tema`, desde `origin/dev` (`804b6b05`).
Spec: `specs/217-factura-oscurece-con-el-tema/` (puerta humana PASADA el 2026-08-13).

Todo lo que aquí se mide sale de `tests/fixtures/contraste.ts`, que es la aritmética que
la 210 dejó commiteada y validada. **No se usó ninguna herramienta externa**; en
particular, ninguna medición se apoya en `.claude/skills/impeccable/scripts/detector/`
(D9 lo prohíbe por nombre, y hay una guardia que lo censa).

---

## Tanda 0 — El instrumento: una sola aritmética, compartida (T1-T4)

### T1 · `tests/fixtures/contraste.ts` (nuevo)

Extraídas **sin tocar una línea de su lógica**: `aRgb`, `luminancia`, `contraste`,
`componer`, y el lector de tokens (`partirPorTema`, `token`, `paleta`). El módulo no
importa nada de `app/` ni de producción: lo único que ejecuta al importarse es leer
`app/globals.css` como archivo de texto.

### T2 · La guardia de la 210 pasa a consumir el fixture

`git diff --stat tests/unit/guards/contraste-tokens.guardia.test.ts`:

```
 tests/unit/guards/contraste-tokens.guardia.test.ts | 111 ++-------------------
 1 file changed, 6 insertions(+), 105 deletions(-)
```

El diff **sólo quita definiciones y añade un `import`**: ningún caso cambió de nombre ni
de aserción. Los tres autocontroles (tres razones publicadas por WCAG, los dos extremos
de la composición alfa, el lector devolviendo el token vigente y no un hex de un
comentario) siguen ahí y **ahora validan la copia compartida**.

```
pnpm exec vitest run tests/unit/guards/contraste-tokens.guardia.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### T3 · El arreglo del lector ante `@media print` — ANTES de crear el bloque

`quitarBloquesDeImpresion()` en el fixture, aplicado **antes** de `partirPorTema`. El
comentario que lo acompaña nombra el fallo concreto que evita: si el bloque de impresión
cae detrás de `.dark`, sus hexes claros ganan por ser los últimos de esa mitad y
`token("oscuro", …)` devuelve los valores CLAROS — todas las comprobaciones de oscuro
pasan a medir el tema equivocado **en verde**. Vive en el fixture y no en una guardia
porque hay dos guardias que leen estos tokens: arreglado en una, quedaría vivo en la otra.

Se hizo **antes** que T5 a propósito (el orden T3 → T5 no es negociable en `tasks.md`).

### T4 · Censo del instrumento — `tests/unit/guards/factura-contraste.guardia.test.ts`

Tres casos: (a) autocomprobación de que el censo lee de verdad el árbol (`> 300` archivos
y la firma presente en la copia canónica: sin esto, un barrido que no lee nada reporta
cero infractores en verde); (b) cero segundas copias de la fórmula en `tests/`; (c) cero
referencias al detector de `.claude/skills` en `tests/`.

**Hallazgo de método, corregido:** la primera versión barría el texto crudo y **se
denunciaba a sí misma** por su propio comentario (`` `+ 0.05` `` en la prosa que explica
qué busca) y denunciaba al fixture por la línea que declara el medidor prohibido. Es
exactamente el fallo que la feature 209 documenta. Se barre el **código**, con
`quitarComentarios` compartido; así la prosa puede nombrar lo prohibido sin ser el
infractor. La alternativa —excluir del barrido al propio archivo que barre— se descartó:
sería un agujero, deja que la segunda copia se esconda justo donde nadie mira.

### Cierre de tanda 0 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files  2 passed (2)      Tests    16 passed (16)
-> test:guardias       Test Files 96 passed (96)     Tests  1317 passed (1317)
== init OK ==
```

---

## Tanda 1 — El CSS (T5, T6)

### T5 · El bloque `@media print` en `app/globals.css`

`@media print { .papel-al-imprimir { … } }` con **las 36 declaraciones** del bloque
`:root, .tema-claro`, sin excepción, colocado **inmediatamente después de ese bloque y
antes de `.dark`**. Sin `print-color-adjust`.

La colocación no es cosmética: es la segunda de las dos medidas contra la trampa del
lector (T3 es la primera). Aunque alguien retirase el `quitarBloquesDeImpresion` del
fixture, los valores que ganarían en la mitad «claro» son los que ya estaban ahí.

`git diff --stat app/globals.css` → `1 file changed, 72 insertions(+)`. **Cero líneas
quitadas**: no se tocó `.dark`, ni `.tema-sistema`, ni `@custom-variant dark` (D6).

### T6 · Los casos del bloque de impresión, en `tema-encendido.guardia.test.ts`

Van ahí y no en un archivo nuevo: ese archivo ya tiene el parser de reglas con ancestros
(`reglasDe`), es el dueño del mecanismo del tema, y es el que hay que reexpresar de todas
formas (R20). Un cuarto parser de CSS en `tests/` es lo que la 209 vino a cerrar.

Cuatro casos: una sola regla `.papel-al-imprimir` con `@media print` entre sus ancestros ·
espejo `toEqual` (claves y valores) contra `:root, .tema-claro` · fija la tinta
(`--foreground`, `--card-foreground` y los cuatro `-strong`) y tiene > 20 declaraciones ·
cero `print-color-adjust` en todo el archivo.

```
pnpm exec vitest run tests/unit/guards/tema-encendido.guardia.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)      (eran 8; +4 de la 217, ninguno de los 8 tocado)
```

`tests/unit/components/analytics-paleta.test.ts` — el que `design.md §7` mandaba vigilar
porque parte el CSS por reglas que incluyan `:root` — sigue verde sin tocarlo:
`Test Files 1 passed (1) · Tests 6 passed (6)`.

### Cierre de tanda 1 — `./init.sh --rapido`

```
✓ typecheck paso
✓ lint paso
-> test:cambiados      Test Files  3 passed (3)      Tests    28 passed (28)
-> test:guardias       Test Files 96 passed (96)     Tests  1321 passed (1321)
== init OK ==
```
