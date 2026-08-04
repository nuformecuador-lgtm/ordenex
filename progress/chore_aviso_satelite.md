# Chore — aviso de selección en otras páginas (bodega satélite)

**Deuda:** Q-K7 de la feature 170 · FASE 2 (T K.3), en `progress/impl_170-fase2-tanda-k.md:732`.
**Decisión:** del humano, ya tomada (`progress/current.md`, «Deuda con DECISIÓN YA TOMADA»).
**Alcance:** UI, un solo componente. **Cero cambios** en `lib/`, en Server Actions ni en el
comportamiento de la selección o de las acciones de lote. Esto es **sólo un aviso**.

---

## 1. Qué se muestra, y dónde

En la barra de la selección de «Órdenes de la bodega»
(`app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx`), **dentro** del mismo
`<p role="status">` que ya lleva el contador, como una línea **subordinada** en letra menor
(`text-xs` bajo el `text-sm` de la barra):

> **Tienes N orden(es) marcadas en otras páginas que no entran en esta acción.**

Es literalmente la redacción que pidió el humano. Dice lo que importa —el número y que **no
participan**—, no que existan.

## 2. Cuándo aparece (y cuándo no)

`marcadasFuera = seleccionados.size - seleccionadas.length`, o sea: lo marcado en total menos
lo marcado **que está en la página visible**, que es lo único que la acción de lote recibe.

| situación | aviso |
| --- | --- |
| nada marcado | **no se pinta** |
| todo lo marcado está en la página visible | **no se pinta** |
| hay marcas fuera de la página visible | **se pinta**, con el número de las de FUERA |

Lo que se respetó del propio traspaso de la tanda K («añadir texto a una barra que ya avisa de
dos cosas puede estorbar más que ayudar»):

1. **No es permanente.** Sin marcas fuera de la vista no hay nada en pantalla; un «0 en otras
   páginas» sería ruido.
2. **No compite.** La barra ya dice dos cosas —el contador/la selección a la izquierda y, con
   estados mezclados, el motivo por el que no hay acción a la derecha—. El aviso **no es un
   tercer mensaje al mismo nivel**: cuelga de la línea de la selección, que es de lo que habla,
   y en letra menor.
3. **Lenguaje llano**, sin siglas ni jerga.

**Por qué el número es el de fuera y no el total:** con el total, el aviso miente en cuanto se
marca una fila de la página actual (diría «3 no entran» cuando una de las tres sí entra).

## 3. Verificación

- **Test nuevo:** `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx`
  (3 casos, 6 órdenes en `pageSize` 3 → 2 páginas, un estado por página). Cubre los **tres
  estados**: sin marcas fuera no aparece (ni con nada marcado, ni con dos marcadas de la
  página visible); con marcas fuera aparece con el número correcto; y el número es el de
  **fuera** de la página, no el total (2 marcadas en la página 1 + 1 en la 2 ⇒ dice **2**).
- La guardia `tests/unit/descarga/contadores-cabecera.guardia.test.ts` sigue verde: el número
  del aviso no sale de la longitud del array que pinta la tabla.

### Mutación ejecutada (obligatoria)

Se cambió el contador para que use el **total marcado** en vez de sólo las de otras páginas:

```diff
- const marcadasFuera = seleccionados.size - seleccionadas.length;
+ const marcadasFuera = seleccionados.size;
```

```
 FAIL  tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx > Q-K7 · aviso de selección en otras páginas (bodega satélite) > no se pinta nada mientras todo lo marcado está a la vista
AssertionError: expected 'Tienes 2 orden(es) marcadas en otras …' to be null
- Expected:  null
+ Received:  "Tienes 2 orden(es) marcadas en otras páginas que no entran en esta acción."
 ❯ tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx:246:26

 FAIL  … > avisa al cambiar de página, con el número de las que quedan fuera
AssertionError: expected 'Tienes 2 orden(es) marcadas en otras …' to be null
- Expected:  null
+ Received:  "Tienes 2 orden(es) marcadas en otras páginas que no entran en esta acción."
 ❯ tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx:274:26

 FAIL  … > cuenta las de FUERA de la página visible, no el total marcado
AssertionError: expected 'Tienes 3 orden(es) marcadas en otras …' to be 'Tienes 2 orden(es) marcadas en otras …'
Expected: "Tienes 2 orden(es) marcadas en otras páginas que no entran en esta acción."
Received: "Tienes 3 orden(es) marcadas en otras páginas que no entran en esta acción."
 ❯ tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx:290:26

 Test Files  1 failed (1)
      Tests  3 failed (3)
```

Los **tres** casos se ponen rojos, incluidos los dos de «no aparece» (con el total, el aviso se
pintaría también sin ninguna marca fuera de la vista). Mutación **revertida**.

### Gate corrido

`pnpm typecheck` ✅ · `pnpm lint` ✅ (0 errores; 44 warnings preexistentes, ninguno en estos
archivos) · `pnpm exec vitest related --run` sobre los dos archivos ⇒ 8 archivos / 130 tests ✅ ·
`pnpm exec vitest run guard` ⇒ 57 archivos / 793 tests ✅. La suite completa **no** se corrió (la
corre el humano).

## 4. Observación — NO tocada, se reporta

La selección **nunca se poda**. `seleccionados` es un `Set` de ids que sólo crece hasta que se
filtra (que la limpia entera). Si una orden marcada **abandona el listado** —hoy pasa al
reportarle un incidente: se va a `incidente`, que no es de los cinco estados de esta pantalla—,
su id **se queda en el Set**. Antes eso era invisible; con el aviso pasa a contarse como «marcada
en otras páginas» y el número puede quedar **inflado** hasta que el usuario filtre o recargue.

No se arregla aquí porque **es comportamiento de la selección**, no del aviso, y podarlo exige
decidir cosas que este chore no puede decidir (con la tabla paginada, el cliente no sabe si un id
que no ve sigue existiendo en el conjunto: sólo el servidor lo sabe). Queda declarado.

## 5. Archivos

- **Modificado:** `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx`
  (`marcadasFuera` + la línea del aviso).
- **Nuevo:** `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx`.
- **Nuevo:** este archivo.

`feature_list.json` **no se tocó**. Sin PR.
