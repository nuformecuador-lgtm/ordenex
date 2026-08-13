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
