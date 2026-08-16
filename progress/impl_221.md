# Feature 221 — El variant `dark:` también dispara al imprimir · bitácora de implementación

Rama `feature/221-dark-al-imprimir`, sobre `dev` con la 217 dentro (`9f714812`).
Ficha **sin SDD** (`sdd: false`, `low`): no hay spec, la ficha ES el encargo.

Toda medición sale de `tests/fixtures/contraste.ts` — `contraste()` y `componer()`, la
aritmética que la 210 validó contra razones publicadas de WCAG y que la 217 sacó a fixture.
**No se escribió una segunda copia de la fórmula** y **no se usó
`.claude/skills/impeccable/scripts/detector/`** ni ningún otro medidor sin autocontroles
(hay guardia que censa las dos cosas por nombre).

---

## 1 · El cambio, en una línea

`app/globals.css`: las **dos** ramas de `@custom-variant dark` pasan a vivir dentro de un
`@media not print`, con el comentario que declara su límite y sus números pegado a la regla.

```css
@custom-variant dark {
  /* … Feature 221: qué compra, qué NO, y a qué precio … */
  @media not print {
    &:is(.dark *) { @slot; }
    @media (prefers-color-scheme: dark) {
      &:is(.tema-sistema *) { @slot; }
    }
  }
}
```

No se tocó ningún componente, ni la paleta, ni la regla `@media print` de la 217.

### Que el compilador hace lo que se le pide, comprobado y no supuesto

Se compiló un CSS mínimo con este mismo cuerpo de variant contra **tailwindcss 4.3.2**
(la versión instalada, vía su API `compile()`), pidiendo las candidatas `dark:bg-tinta` y
`dark:hover:text-tinta`. Salida real, recortada:

```css
.dark\:bg-tinta {
  @media not print {
    &:is(.dark *) { background-color: var(--color-tinta); }
    @media (prefers-color-scheme: dark) {
      &:is(.tema-sistema *) { background-color: var(--color-tinta); }
    }
  }
}
```

Las **dos** ramas salen dentro del `@media not print`, y lo mismo con variantes encadenadas
(`dark:hover:*`). Con el variant viejo, esa misma utilidad se emitía sin envoltorio alguno.

---

## 2 · La medición: qué compra el cambio y qué NO

Escenario: **se imprime desde el tema oscuro elegido a mano** (`.dark`). Dos columnas, porque
son dos papeles distintos y confundirlos es la forma fácil de mentir aquí:

- **papel sin fondos** — el de verdad: el navegador no imprime superficies salvo que el
  usuario marque «gráficos de fondo», que viene **desmarcado** (es la misma lección sobre la
  que se apoya la 217). Lo que decide la legibilidad es **la tinta**.
- **con fondos** — si el usuario lo marca a mano.

**La tabla de la 208 que cita la ficha NO se copió: se volvió a medir.** De sus filas,
`Badge warning` y `Badge destructive` ya las había cerrado la 210, y sus números
(«Button outline 14.79 → 14.78, Badge success 4.84 → 4.76, danger 5.30 → 5.32») medían otra
cosa: el estado de la hoja de la factura, no el papel de la app.

### 2a · Donde la tinta es de PALETA FIJA → el papel mejora de verdad

Son las utilidades cuya rama `dark:` cambia la **tinta** por un hex sin variante de tema.
Apagar el variant devuelve la tinta oscura, y eso se ve en papel aunque no se imprima ningún
fondo. **Esto es lo que la ficha compra**:

| par | antes | después |
| --- | --- | --- |
| `Button` `brand-outline` (`text-brand` / `dark:text-brand-light`) | 1.87 | **3.18** |
| `EstatusBadge` «en reparto» (`text-brand-dark` / `dark:text-brand-light`) | 1.87 | **4.16** |
| `Toast` success (`color-mix` 55 % negro / `dark:` 80 % blanco) | 2.13 | **6.99** |
| `RankingPodio` 3.º (`text-asfalto-7` / `dark:text-foreground`) | 1.19 | **11.39** |

### 2b · Donde la tinta sale de un TOKEN → en papel NO cambia nada. Es el límite.

`.dark` **no está acotado a pantalla**: al imprimir, `--foreground` sigue siendo `#e6ecf8` y
`--success-strong` sigue siendo `#34d399`. La rama base y la rama `dark:` de estas utilidades
usan el MISMO token, así que apagar el variant no toca la tinta:

| par | papel antes | papel después |
| --- | --- | --- |
| `Badge` success / warning / danger / info | 1.92 · 1.67 · 2.77 · 2.08 | **idénticos** |
| `Button` outline (tinta `--foreground`) | 1.19 | **idéntico** |
| `Button` destructive (tinta `--destructive`) | 2.77 | **idéntico** |

**Consecuencia, dicha sin adornos: esta ficha NO consigue que «el papel salga claro en toda
la app».** Lo consigue donde la tinta es fija (2a) y donde los tokens ya son claros al
imprimir (2c). En el resto, el papel sigue saliendo con la tinta del tema oscuro. Ver §6.

### 2c · Dentro de `.papel-al-imprimir` → COMPLETA la 217

Las dos hojas del comprobante del cierre ya fijan los tokens claros al imprimir (feature 217).
Ahí, apagar el variant deja lo impreso **exactamente igual al tema claro**, y deja de depender
del tema con el que se mire la pantalla:

| par | antes | después |
| --- | --- | --- |
| P22 `Button` `destructive` | 2.90 | **3.29** |
| P23 `Button` `outline` | 14.78 | **14.79** |
| P24 `Button` `outline` en panel apagado | 7.25 | 7.25 |
| P26 `Badge` `destructive` | 5.32 | **5.30** |

**Comprobación cruzada real, y no adorno:** 3.29 · 14.79 · 7.25 · 5.30 son, a la centésima,
los suelos `claro` que la 217 dejó anotados en `factura-contraste.guardia.test.ts` con una
medición distinta y anterior. Que coincidan es la forma ejecutable de decir «el papel es ahora
el tema claro». (La 217 anotó 2.89 para el estado previo de P22; medido hoy con el fixture da
2.90 — una centésima de redondeo, no una discrepancia de método.)

### 2d · El precio, declarado

Si el usuario marca «gráficos de fondo», los cuatro `Badge` semánticos imprimen su fondo
`-soft` CLARO bajo una tinta que sigue siendo la OSCURA — el patrón que la 208 documentó, un
token que gira sobre un fondo que no:

| `Badge` | con fondos, antes | con fondos, después |
| --- | --- | --- |
| success | 6.60 | 1.70 |
| warning | 7.59 | 1.50 |
| danger / destructive | 5.20 | 2.26 |
| info | 6.97 | 1.91 |

En el camino por defecto (sin fondos) esos cuatro badges **no cambian**: seguían y siguen
ilegibles en papel (1.92 / 1.67 / 2.77 / 2.08), porque su tinta es un token. Y el estado
«antes» de esta columna tampoco es un estado que nadie quiera: es la página entera impresa en
oscuro, el gasto de tóner que la puerta humana de la 217 descartó expresamente. Queda medido
y escrito junto a la regla para que la ficha que cierre §6 no tenga que redescubrirlo.

---

## 3 · La guardia

`tests/unit/guards/impresion-sin-dark.guardia.test.ts` (nueva, 13 casos).

Lo que mira, y por qué así:

1. **Autocomprobación** — que lee el CÓDIGO (`quitarComentarios`, fixture compartido) y no la
   prosa. El comentario de la regla nombra `@media not print` a propósito: si el quitador
   dejara de pasar, el caso central se satisfaría con la explicación. Hay aserción explícita de
   que `Feature 221` aparece en el crudo y **no** en lo censado.
2. **El caso que muerde** — para **cada** `@slot` del variant se calcula su **pila de
   ancestros** y se exige que contenga un `@media not print`. Se mira la pila y no una mención
   a propósito: una at-rule escrita en otro punto del archivo no envuelve nada.
3. **Contención** — dentro de `@media not print` no se declara ningún token, porque
   `quitarBloquesDeImpresion()` borra toda at-rule que nombre `print` antes de leer los tokens
   de pantalla. Un token metido ahí desaparecería del lector y las medidas de tema oscuro
   pasarían a medir otra cosa, en verde.
4. **Los números** — las tablas de §2 congeladas, y **atadas al comentario del CSS**: cada fila
   exige que `globals.css` siga anotando su «antes → después». Si alguien actualiza la tabla y
   no la prosa (o al revés), rojo.

### Las mutaciones (árbol commiteado antes de cada una; `git diff` confirmó el cambio)

| mutación | `git diff` | resultado |
| --- | --- | --- |
| **quitar el `@media not print`** (variant como antes de la ficha) | `1 file changed, 5 insertions(+), 7 deletions(-)` | **ROJA** — 3 casos |
| **inocua A: envolver sólo la rama de `prefers-color-scheme`** | `1 file changed, 3 insertions(+), 3 deletions(-)` | **ROJA** — 1 caso |
| **inocua B: `@media not print` en otro punto del archivo, variant sin envolver** | `1 file changed, 11 insertions(+), 7 deletions(-)` | **ROJA** — 2 casos |

Mensaje real de la roja (idéntico en las tres):

```
AssertionError: el @slot nº 1 del variant `dark` NO está dentro de un `@media not print`
(sus ancestros son: @custom-variant dark › &:is(.dark *)). Sin ese envoltorio, las
utilidades `dark:` vuelven a emitir dentro de `@media print`: quien imprima desde tema
oscuro sacará insignias y botones con su tinte oscuro sobre papel blanco.
```

La **inocua B** es la que importa: es la trampa que la 217 se comió en su primera vuelta
(anclar en una mención en vez de en la regla). Un censo con `includes("@media not print")`
habría dado verde con el bug entero vivo.

El mutador aborta si el texto no cambia (`ABORTA: el texto no cambio. No hubo mutacion.`), y
cada mutación se confirmó además con `git diff --stat` antes de correr los tests.

---

## 4 · El ancla de la guardia de la 217: REEXPRESADA, no relajada

`tema-encendido.guardia.test.ts` localizaba la regla de impresión de la 217 con **«la primera
at-rule que MENCIONE `print`»** (`^\s*@media\b[^{}]*\bprint\b[^{}]*\{`). Desde esta ficha hay
**dos** at-rules así, y la nueva vive **200 líneas más arriba**: ese ancla pasaba a enganchar
el variant, y sus dos casos —el de R15 y el del orden— seguían opinando sobre el bloque
equivocado. Ahora es `^\s*@media\s+print\b[^{}]*\{`, con `print` pegado al `@media`.

**No es cosmético, y se midió**. Con el bloque de impresión de la 217 movido al final del
archivo (la trampa exacta que ese caso dice vigilar):

```
=== ANCLA PRECISA (hoy) ===
  × el bloque de impresion va ANTES de `.dark`, o el lector de tokens mide el tema equivocado
    Tests  1 failed | 15 passed (16)

=== ANCLA VIEJA + bloque de la 217 al final del archivo ===
    Tests  16 passed (16)
```

Con el ancla vieja, la guardia de la 217 **aprobaba en verde** su propia trampa. Las
aserciones de los dos casos no se tocaron: sólo el ancla, y con el motivo escrito encima.

También se corrigió la nota de alcance de `quitarBloquesDeImpresion()` en el fixture, que
decía «hoy no existe ningún `@media not print`» y desde hoy es falso.

---

## 5 · El gate

`./init.sh --rapido`, con el árbol en su estado final (`EXIT=0`):

```
✓ node v24.13.0 · ✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ typecheck paso
✓ lint paso            (10 warnings preexistentes, ninguno en lo tocado)
  test:cambiados   Test Files  4 passed (4)    ·  Tests    86 passed (86)
  test:guardias    Test Files 97 passed (97)   ·  Tests  1379 passed (1379)
✓ test:rapido paso
✓ todas las migraciones tienen down.sql · ✓ .env presente
== init OK ==
```

El gate completo (`./init.sh` sin flags) lo corre el leader.

---

## 6 · LO QUE ESTA FICHA NO CIERRA (hallazgo, para ficha propia)

**`@media not print` apaga el VARIANT; no apaga los TOKENS.** El objetivo que enuncia la ficha
—«que el papel salga claro en TODA la app»— **no se alcanza con este cambio solo**, y los
números de §2b lo dicen: fuera de `.papel-al-imprimir`, quien imprime desde `.dark` sigue
sacando tinta `#e6ecf8` sobre papel blanco (1.19:1), igual que antes.

El arreglo que faltaría es de una pieza, y es **CSS, no componentes ni paleta**: un bloque
`@media print` que redeclare los valores claros para `.dark` / `body:has(> .dark)` fuera de la
hoja del cierre. Con las dos piezas juntas, el papel sería exactamente el tema claro en todas
las rutas, y de paso desaparecería el precio de §2d (el fondo `-soft` dejaría de quedar bajo
una tinta oscura, porque la tinta también sería clara).

**No se hizo aquí, a propósito**, por tres razones: (1) la ficha dice explícitamente cuál es
el arreglo y es el que se implementó; (2) triplicar el bloque de 34 declaraciones claras —ya
está en `:root, .tema-claro` y en `.papel-al-imprimir`— pide su propia guardia espejo y su
propia decisión sobre si `.papel-al-imprimir` sigue teniendo sentido después; (3) cambia el
papel de las quince rutas del portal, que es exactamente el motivo por el que la 217 mandó
esto a ficha propia en vez de meterlo en la suya.

**Recomendación:** ficha nueva, `frontend`, `low`, nombre sugerido *«al imprimir, los tokens
también son los claros»*, dependiente de ésta. Con ella, y sólo con ella, la frase «el papel
sale claro en toda la app» pasa a ser cierta.

Segundo hallazgo, menor y ya cerrado dentro de esta ficha: cualquier censo de `globals.css`
que ancle en «una at-rule que mencione `print`» quedó ambiguo con este cambio. Se encontró uno
(§4) y se reexpresó; no hay más — se buscaron todos los consumidores de `globals.css` en
`tests/` (8 archivos) y los otros siete anclan por selector o por token, no por medio.
