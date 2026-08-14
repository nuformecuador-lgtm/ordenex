# Feature 222 — el botón `destructive` no llegaba al umbral en NINGUNO de los dos temas

Rama `feature/222-boton-destructive`. Ficha SIN SDD: la ficha es el encargo.
Fecha: 2026-08-13. Todas las mediciones con `contraste()` / `componer()` de
`tests/fixtures/contraste.ts` (aritmética validada contra tres razones publicadas por WCAG y los
dos extremos de la composición alfa, en `contraste-tokens.guardia.test.ts`). **No se usó**
`.claude/skills/impeccable/scripts/detector/` ni ningún otro medidor sin autocontroles.

---

## 1. Qué cambió

`components/ui/button.tsx`, variante `destructive`:

```
- bg-destructive/10 text-destructive hover:bg-destructive/20 … dark:bg-destructive/20 dark:hover:bg-destructive/30
+ bg-danger-soft text-danger-strong hover:bg-danger-strong hover:text-card … dark:bg-danger/15 dark:hover:bg-danger-strong
```

El `focus-visible:border-destructive/40` y los `ring-destructive/*` **no se tocan** (ver §6).
`--destructive` como token **no se toca**: `Alert`, `FieldError` y los `aria-invalid` de la clase
base dependen de él.

Precedente seguido: la **feature 210** resolvió este mismo par para el `Badge`
(`bg-danger-soft text-danger-strong dark:bg-danger/15`) porque `--destructive` no tiene `-strong`.
El `Button` quedó fuera de aquel alcance y es lo que cierra esta ficha. No se inventa ningún token.

---

## 2. La tabla, medida — antes → después

Tinta y fondo son los hexes REALES resueltos desde `app/globals.css`, no reconstruidos de memoria.

| tema | estado | antes (tinta/fondo) | antes | después (tinta/fondo) | después |
|---|---|---|---|---|---|
| claro | reposo | `#ef4444` / `#fdecec` (destructive/10 sobre card) | **3.29** | `#b91c1c` / `#fee2e2` (danger-soft, opaco) | **5.30** |
| claro | hover | `#ef4444` / `#fcdada` (destructive/20) | **2.90** | `#ffffff` / `#b91c1c` (danger-strong, opaco) | **6.47** |
| oscuro | reposo | `#f87171` / `#3e3045` (destructive/20 sobre card) | **4.43** | `#f87171` / `#31253c` (danger/15 sobre card) | **5.20** |
| oscuro | hover | `#f87171` / `#56384b` (destructive/30) | **3.68** | `#10203a` / `#f87171` (danger-strong, opaco) | **5.89** |

AA para texto normal (WCAG 1.4.3) = 4.5. **Antes fallaban los cuatro estados menos uno, y ese uno
—4.43— también estaba bajo umbral.** Después, el peor de los cuatro sobre la tarjeta es 5.20.

### El mismo par sobre OTRAS superficies (una primitiva no sabe dónde la montan)

Tres de los cuatro estados son **opacos** y no dependen de la superficie. El único que sí es el
reposo oscuro, que es exactamente el par que la 210 ya midió para el `Badge`:

| superficie (oscuro) | reposo `danger/15` |
|---|---|
| card / popover | 5.20 |
| background | 5.82 |
| muted / secondary | **4.65** ← el peor |
| muted/50 sobre card (fila de tabla en hover) | 4.88 |

En claro el reposo es `#fee2e2` opaco: **5.30 en las seis superficies**.

### Por qué el hover es OPACO y no un tinte más hondo

Lo natural era hundir el tinte (`hover:bg-danger/20`, que es lo que hacía la variante vieja). Se
midió y **no cumple en todas partes**: 4.99 sobre `card`, pero **4.44 sobre `secondary`** en claro
y **4.44 sobre `muted`/`secondary`** en oscuro. Un fondo con alfa vale lo que valga lo que tenga
debajo. `danger/25` es peor todavía (4.16 sobre el `muted` oscuro). El único hover que cumple en
cualquier superficie es opaco, y `--danger-strong` + `--card` giran los dos con el tema, así que un
solo par de clases (`hover:bg-danger-strong hover:text-card`) sirve para los dos temas: blanco
sobre rojo oscuro en claro (6.47), azul oscuro sobre rojo claro en oscuro (5.89).

Ese número descartado no quedó en prosa: hay un caso de guardia que lo vuelve a medir y se pone
rojo si algún día `danger/20` pasa a cumplir en todas partes — el motivo de la decisión habría
caducado y habría que releerla.

---

## 3. Comprobado contra el compilador real (tailwindcss 4.3.2)

Se compiló `app/globals.css` con `@tailwindcss/postcss` y se buscaron las ocho utilidades nuevas.
Las ocho se emiten. Dos hallazgos que no se podían dar por supuestos:

1. `.dark\:bg-danger\/15:is(.dark *)` y `.hover\:bg-danger-strong:hover` tienen **la misma
   especificidad** (dos clases), y en el CSS emitido **la de `dark:` sale DESPUÉS**
   (offset 153 800 frente a 105 708). Sin la clase `dark:hover:bg-danger-strong` —tres clases— el
   hover **no se vería en tema oscuro**: ganaría el reposo por orden de fuente. La duplicación no
   es paranoia; está medida.
2. `bg-danger/15` compila a `color-mix(in oklab, #ef4444 15%, transparent)`, es decir el color con
   alfa 0.15 que el navegador compone en sRGB sobre lo que haya debajo. Es el mismo modelo que
   `componer()` reproduce y sobre el que ya se apoyan la 210, la 217 y la 221.

---

## 4. Lo que se movió en otras guardias, y por qué

| archivo | qué | por qué |
|---|---|---|
| `tests/unit/guards/factura-contraste.guardia.test.ts` | **P22**: `tinta` pasa de `destructive` a `danger-strong`, `fondo` a `danger-soft` / `danger/15`; **suelo 3.29/4.43 → 5.30/5.20**; el motivo se reescribe | inventario CERRADO de la 217: sus cifras las mueve este cambio y R16 no admite números viejos |
| idem | la lista de deuda bajo AA pasa de `["P20","P21","P22"]` a `["P20","P21"]` | ese caso se puso rojo solo, que es para lo que se escribió: «un registro de deuda que no se entera de que la deuda se pagó es un registro falso» |
| `tests/unit/guards/impresion-sin-dark.guardia.test.ts` | fila **P22** de `EN_LA_FACTURA`: clases, tinta, fondos y números (2.90 → 3.29 pasa a **5.32 → 5.30**) | su aritmética es de tokens y **habría seguido en verde describiendo clases que ya no existen**. La comprobación cruzada con el suelo `claro` de la 217 se mantiene |
| `tests/components/Modal.test.tsx` | `toHaveClass("text-destructive")` → `text-danger-strong` | único test de componente que afirmaba una clase concreta del botón destructivo. Lo que comprueba —que el modal PROPAGA la variante— no cambia |
| `app/globals.css` | dos comentarios con números que este cambio vuelve falsos (`2.90 → 3.29` y «hoy en pantalla oscura da 4.43») | la prosa no puede separarse del dato; es la regla que la 221 dejó ejecutable para sus propias filas |

`tests/components/FormField.test.tsx` afirma `text-destructive` sobre **`FieldError`**, no sobre el
botón: no se toca (ver §7).

---

## 5. La guardia nueva, y la prueba de que muerde

`tests/unit/guards/contraste-tokens.guardia.test.ts`, bloque «Feature 222» (6 casos). No copia las
clases: **las lee del componente** (con `quitarComentarios`, feature 209), resuelve cada utilidad
contra los tokens de `globals.css` y mide.

- **umbral** 4.5 en cada uno de los cuatro estados **y en cada una de las seis superficies**;
- **suelo** por estado (5.30 · 6.47 · 4.65 · 5.89), el peor medido hoy;
- **censo**: ni el fondo ni la tinta pueden volver a `bg-destructive`/`text-destructive`;
- **el hover no puede desaparecer en silencio** (exige `hover:bg-*` y `dark:hover:bg-*`);
- **el resolutor declara qué clase gana en cada estado**, fijado con `toEqual`: un resolutor que se
  equivoque —que mida el reposo creyendo que mide el hover— devuelve un número plausible y falso;
- si hay `hover:bg-*` y `dark:bg-*` pero falta `dark:hover:bg-*`, **lanza en vez de adivinar**: en
  oscuro esas dos reglas empatan y decide el orden del CSS, que la guardia no ve.

### Mutación REAL (el token por debajo del umbral)

`--danger-strong: #b91c1c` → `#e05252` en `:root` (comprobado con `git diff` que estaba en el
árbol antes de correr):

```
× tema claro, estado reposo … `text-danger-strong` (#e05252) sobre `bg-danger-soft` (#fee2e2)
  mide 3.13, y AA para texto normal pide 4.5
× tema claro, estado hover  … `hover:text-card` (#ffffff) sobre `hover:bg-danger-strong`
  (#e05252) mide 3.82, y AA para texto normal pide 4.5
× la alternativa descartada (hover con capa `danger/20`) …
  (más los dos casos de la 210 que ya vigilaban el par de `danger`)
  Tests  5 failed | 17 passed (22)
```

Y en la guardia de la 217, el suelo nuevo de P22 mordió igual:
`P22 en tema claro EMPEORÓ … expected 3.13 to be greater than or equal to 5.29` — 4 casos rojos.

### Mutación REAL nº 2 (la variante vuelve a `--destructive`)

Devolviendo `bg-destructive/10 text-destructive hover:bg-destructive/20` al componente:

```
× la variante `destructive` del Button NO usa el token sin par … expected 'bg-destructive/10…' to contain 'bg-danger-soft'
× el resolutor elige, en cada estado, la clase que gana por especificidad
× claro/reposo … `text-destructive` (#ef4444) sobre `bg-destructive/10` (#fdecec) mide 3.29
× claro/hover  … `text-destructive` (#ef4444) sobre `hover:bg-destructive/20` (#fcdada) mide 2.90
× oscuro/hover … mide 1.00
  Tests  5 failed | 17 passed (22)
```

La guardia, leyendo las clases viejas, **reprodujo exactamente el 3.29 y el 2.90 de la ficha**. Es
la comprobación cruzada de que el instrumento mide lo que dice medir.

### Mutaciones INOCUAS (que no puede dar falso verde)

1. Tres líneas de **comentario** dentro de `button.tsx` nombrando `bg-destructive/10`,
   `text-destructive` y `hover:bg-destructive/20` → **22 passed**. El censo lee código, no prosa
   (la variante real ya lleva esas menciones en su comentario, así que la trampa está viva en el
   árbol y no sólo en el experimento).
2. **Las mismas nueve clases en otro orden** dentro de la cadena → **22 passed**. La guardia no
   está anclada a un literal: resuelve por utilidad y por especificidad.

Las cuatro mutaciones se plantaron sobre el árbol ya commiteado y se verificaron con `git diff`
antes de correr; el árbol quedó limpio después de cada una.

---

## 6. Lo que NO entra, dicho con su motivo

- **El borde y el anillo de foco siguen en `--destructive`.** Son indicadores no textuales
  (WCAG 1.4.11), no caen bajo el 1.4.3 de esta ficha, y son los mismos que la clase base usa para
  `aria-invalid`. Medido de paso: `ring-destructive/20` compuesto da **1.30** contra la tarjeta
  clara y **1.33** contra la oscura, muy por debajo del 3:1 que 1.4.11 pediría — pero eso **no es
  de esta variante**: el anillo por defecto de TODOS los botones es `focus-visible:ring-ring/50`
  y está igual. Es una ficha propia, para toda la app.
- **La deuda viva de la 210 no se cierra.** `destructive` y `danger` siguen siendo dos nombres del
  mismo aspecto. **Este cambio la agrava en el nombre y la alivia en el color**: una variante
  llamada `destructive` que pinta `danger` es un nombre más que apunta al mismo sitio (agrava),
  pero `--destructive` queda ya sólo donde hace falta un token con variante por tema —anillos,
  `aria-invalid`, `Alert`— y ninguna superficie de texto de las primitivas lo usa como par consigo
  mismo (alivia). Unificar es limpieza de paleta, no contraste.
- **La paleta de marca no se toca**: es la ficha 216 y tiene dueño. Esta ficha no la necesitó.

## 7. Encontrado y NO arreglado (no es de esta ficha)

**19 avisos hechos a mano repiten el defecto exacto que esta ficha cierra en el botón**:
`bg-destructive/10` + `text-destructive`, medido **3.29 sobre la tarjeta y 3.12 sobre el fondo de
página** en claro (en oscuro cumplen: 5.19 / 5.88). Están en 15 archivos —`CierreDiaModule` (3),
`RecepcionSateliteModule` (2), `GestionarOrdenPanel` (2), `CierresAdminModule`,
`ConsolidacionBodegaModule`, `IncidentesAdminModule`, `RecoleccionModule`, `RepartoModule`,
`RecogerModule`, `AsignarBodegaModal`, `AsignarSateliteModal`, `DeshacerAsignacionModal`,
`DevolverATiendaModal`, `RecuperarABodegaModal`, `ReportarIncidenteModal`—. A eso se suma
`text-destructive` suelto sobre la tarjeta (**3.76**) en `FieldError`, `Alert` y ~30 mensajes de
error de formulario.

No entra aquí: esta ficha es la **variante del `Button`**, y arreglar los paneles es la misma
decisión de paleta pero en otro sitio (o darles su propio componente, que es lo que DESIGN.md ya
pide para los botones). Queda medido para que la próxima ficha no tenga que redescubrirlo.

**Un comentario caducado de la 217 en `globals.css`** anunciaba como «FICHA PROPIA» el arreglo que
la 221 ya hizo, y afirmaba que la regla de impresión no apaga el variant `dark:` —hoy sí lo apaga,
desde arriba—. Se corrigió al pasar por ahí a arreglar el número; el párrafo era del 217/221, no de
esta ficha.

---

## 8. Gate

`./init.sh --rapido` — ver §gate del cierre. `pnpm run typecheck` limpio y `pnpm run lint` con
0 errores (64 warnings preexistentes de `no-unused-vars` en tests).
