# impl 235 · m4 — el rescate deja de estar apagado para el mensajero bloqueado

Cierra el último menor abierto de `progress/review_235.md` (**m4**). Solo frontend; nada de
`lib/services/`, repositorios, migraciones ni Server Actions.

## 1 · Qué cambió y por qué

**El defecto.** La card de la sección «Con ayuda solicitada» le pasaba `disabled={bloqueado}` al
`RecuperarAyudaButton`. **R25** dice lo contrario: con el mensajero bloqueado por un cierre sin
resolver, el rescate DEBE seguir disponible. Y el servicio lo cumple **a propósito** — la cabecera de
`lib/services/rescate-ayuda.ts` documenta que comprobar el bloqueo ahí crearía un **deadlock** con
R22: un mensajero con cierre `vencido` y una orden en ayuda no podría ni rescatarla (bloqueado) ni
cerrar (esa orden le bloquea el cierre). O sea: el permiso existía en el servidor y **solo la
pantalla lo negaba**. Permiso inejercitable, la misma clase que R35 prohíbe.

### `app/(app)/mis-asignaciones/_components/RepartoModule.tsx`
- Fuera `disabled={bloqueado}` del `RecuperarAyudaButton` de `renderCardConAyuda`.
- En su lugar, un comentario que deja la **excepción escrita como decisión**: el resto de la card
  sigue bloqueada (el `bloqueado` que recibe `PosOrderCardDetalle` apaga su gate de selección,
  feature 111/R14), y este botón no, porque es la salida del deadlock. Se cita R22, R25, R35 y el
  archivo del servicio, para que quien lo lea no lo tome por un olvido y lo "arregle".
- Una línea más en el JSDoc de `renderCardConAyuda`, en la viñeta que ya hablaba de «Recuperar».

Comprobado antes de tocar: `PosOrderCardDetalle` usa su prop `bloqueado` **solo** para
`posSeleccionHandlers` (`seleccionable`/`onClick`/`onKeyDown`/`tabIndex`); el slot `acciones` se
pinta tal cual. Por eso quitar el `disabled` basta: el botón queda realmente pulsable.

### `app/(app)/mis-asignaciones/_components/RecuperarAyudaButton.tsx`
- **Se retira la prop `disabled`** de `RecuperarAyudaButtonProps` y del componente; queda
  `disabled={enviando}`. Era su único llamador en todo el repo, y su JSDoc documentaba literalmente
  la conducta que R25 prohíbe (*«`true` con el mensajero bloqueado por cierre pendiente»*): dejarla
  con la doc corregida era dejar abierta la vía por la que el defecto vuelve.
- En su cabecera queda escrito **que la prop se retiró y por qué**, con el deadlock nombrado. Sin esa
  nota, «este botón no tiene `disabled`» se lee como un descuido y alguien lo repone.

### Lo que NO cambió, tras mirarlo (punto 4 del encargo)
Los dos casos de bloqueo de `tests/components/RepartoModule.test.tsx` —«R14: bloqueado deshabilita
las cards de 'En reparto'…» (l. 1158) y «R3: bloqueado sin gestión…» (l. 1261)— **no eran demasiado
anchos y siguen siendo verdad**: su helper `renderModule` pasa `conAyuda: []`, así que en esos
escenarios no existe ninguna card de ayuda, y sus aserciones están acotadas a la región «En reparto /
por gestionar» (o a `cardDe("REM-G1")`) y miran `tabindex`, no el `disabled` de un botón del slot
`acciones`. No se tocaron. Verificado ejecutándolos: 3 archivos / 109 tests en verde (§4).

## 2 · El test nuevo

`tests/components/RepartoAyuda.test.tsx`, dentro del `describe("Reparto · las órdenes con ayuda se
van abajo, a su propia sección")`, justo tras el caso de R19. Nombre exacto:

> `235/R25: bloqueado por cierre, «Recuperar» sigue pulsable y llega hasta la Server Action`

El helper `renderModule` gana un tercer parámetro `bloqueado = false` (por defecto, ningún caso
existente cambia de comportamiento): sin poder encender el bloqueo no había forma de afirmar esto.

El caso hace tres cosas, y las tres son necesarias:
1. `expect(screen.getByRole("alert")).toBeInTheDocument()` — que el bloqueo **llegó de verdad** al
   módulo. Sin esta línea el caso quedaría verde aunque la prop se ignorara, y no probaría nada.
2. `expect(recuperar).not.toBeDisabled()`.
3. **El click de punta a punta**: `user.click` → `recuperarOrdenAyuda({ ordenId: "g2" })` →
   `refreshMock`. `not.toBeDisabled()` solo mira un atributo; que el click llegue al borde es lo que
   demuestra que el permiso es *ejercitable*.

El comentario del caso lleva la **razón** (el deadlock R22/R25 y el permiso inejercitable de R35), no
solo el qué.

## 3 · La mutación, ejecutada y leída

Vitest **no type-checkea**, solo transpila. Eso obliga a dos mutaciones distintas, y la primera dio
un resultado que vale la pena dejar escrito.

| # | Estado | `RepartoModule.tsx` | `RecuperarAyudaButton.tsx` |
|---|--------|---------------------|----------------------------|
| — | antes (corregido) | `c0bfdf95e19feb89142312226fc0228b7c07aa80e9bed6eeb944ee168490597f` | `68dbfff2de0547f06ba62ff60327c2696b2a9a3188409cf9006e50a8885805db` |
| A | mutado (solo el JSX) | `da2c8ee2846d747a8f1564e629ce5c64ce4fff394770b968a869a4e797b82810` | `68dbfff2…` (sin tocar) |
| B | mutado (defecto entero) | `da2c8ee2…` | `51dc973e163fd0d2c061942c4680e3bf07fbf6cf5c8953f86ebbb86e8be88e68` |
| — | después (restaurado) | `c0bfdf95e19feb89142312226fc0228b7c07aa80e9bed6eeb944ee168490597f` | `68dbfff2de0547f06ba62ff60327c2696b2a9a3188409cf9006e50a8885805db` |

`tests/components/RepartoAyuda.test.tsx` antes y después de todo esto:
`97fd27f9080580829ecf0925907863f95a725c153de1dc4f08ee4f8599623055`.

**Mutación A — reponer solo `disabled={bloqueado}` en `RepartoModule.tsx`: SOBREVIVE.**
`Test Files 1 passed (1)` / `Tests 15 passed (15)`. Y es correcto que sobreviva: con la prop ya
retirada del componente, el atributo JSX es **inerte** —el componente no lo destructura y nunca llega
al `<Button>`—, así que esa mutación no reintroduce el defecto, solo escribe un atributo muerto (que
además `tsc` rechaza, ver §4). Dicho al revés: **retirar la prop es por sí sola una defensa**, porque
el camino corto de reponer el defecto ya no existe.

**Mutación B — el defecto ENTERO (prop de vuelta en el componente + `disabled={disabled || enviando}`
+ el JSX de A): MUERE.** `Test Files 1 failed (1)` / `Tests 1 failed | 14 passed (15)`. El único rojo
es el caso nuevo:

```
FAIL  tests/components/RepartoAyuda.test.tsx > Reparto · las órdenes con ayuda se van abajo, a su
propia sección > 235/R25: bloqueado por cierre, «Recuperar» sigue pulsable y llega hasta la Server Action
Error: expect(element).not.toBeDisabled()
Received element is disabled:
  <button aria-label="Retirar la solicitud de ayuda de la orden REM-002" … data-disabled="" disabled="" … />
 ❯ tests/components/RepartoAyuda.test.tsx:350:27
    350|     expect(recuperar).not.toBeDisabled();
```

**Comprobación extra: la pata del click también es portante.** Como `not.toBeDisabled()` corta antes,
podría estar tapando un `user.click` decorativo. Con la mutación B puesta se comentó esa línea y se
volvió a correr — el caso sigue rojo, ahora por el borde:

```
FAIL  … 235/R25: bloqueado por cierre, «Recuperar» sigue pulsable y llega hasta la Server Action
AssertionError: expected "vi.fn()" to be called with arguments: [ { ordenId: 'g2' } ]
Number of calls: 0
    355|     expect(recuperarMock).toHaveBeenCalledWith({ ordenId: "g2" });
```

Las tres corridas se ejecutaron y se leyó su salida real; los tres archivos quedaron restaurados y
sus sha256 vuelven a coincidir con la fila «antes» (tabla de arriba).

## 4 · Verificación final

```
$ pnpm exec tsc --noEmit
exit=0
--- salida (0 lineas) ---
```

(`tsc` en verde con el árbol corregido. Con la mutación A puesta habría sido **rojo**: pasarle un
`disabled` a un componente cuya interfaz ya no lo declara es error de tipos — otra razón para haber
retirado la prop en vez de conservarla.)

```
$ pnpm exec vitest run tests/components/RepartoAyuda.test.tsx \
    tests/components/RepartoModule.test.tsx \
    tests/unit/guards/ayuda-columna-retirada.guardia.test.ts

 Test Files  3 passed (3)
      Tests  109 passed (109)
   Duration  20.13s
```

Solo los archivos que tocan lo cambiado: el de la sección de ayuda (donde vive el caso nuevo), el del
módulo (que tiene los casos de bloqueo del punto 4) y la guardia que nombra `RecuperarAyudaButton`.
`eslint` sobre los tres archivos modificados: sin salida. Del gate completo se encarga el leader.

**Sin commit**, por encargo: el árbol queda con los cambios.

## 5 · Archivos

- `app/(app)/mis-asignaciones/_components/RepartoModule.tsx` (modificado)
- `app/(app)/mis-asignaciones/_components/RecuperarAyudaButton.tsx` (modificado)
- `tests/components/RepartoAyuda.test.tsx` (modificado: helper + 1 caso nuevo)
