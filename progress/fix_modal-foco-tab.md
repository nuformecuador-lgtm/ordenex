# fix/modal-foco-tab — `Modal.test.tsx > R30: atrapa el foco con Tab`

Rama: `fix/modal-foco-tab` (desde `origin/dev`, `bb510e04`).
Archivo tocado: `tests/components/Modal.test.tsx` (solo el test R30).
`components/shared/Modal.tsx` NO se tocó: no había defecto que arreglar ahí.

## 1. Diagnóstico: por qué cambiaba de resultado sin cambiar el código

El test afirmaba de forma **síncrona** un efecto que Base UI produce de forma
**asíncrona**, en el siguiente *animation frame*. Era una carrera contra el reloj,
no una regresión.

Secuencia real, medida con instrumentación dentro del propio test:

| Momento | `document.activeElement` |
| --- | --- |
| `confirmBtn().focus()` | botón Confirmar |
| tras el 1.er `user.tab()` | `<span data-base-ui-focus-guard>` (fuera del diálogo) |
| tras el 2.º `user.tab()` | **`<body>`** ← aquí asertaba el test |
| 50 ms después | **`<input aria-label="campo">`**, dentro del diálogo |

Es decir: el foco **sí** vuelve al interior del diálogo; solo que un frame más tarde.

Mecanismo, en el código del proveedor:

- `node_modules/@base-ui/react/floating-ui-react/components/FloatingFocusManager.mjs`
  renderiza una guarda de foco después del popup. Su `onFocus`, en modo modal, hace
  `enqueueFocus(getTabbableContent()[0])`.
- `node_modules/@base-ui/react/floating-ui-react/utils/enqueueFocus.mjs` **no** enfoca
  en el acto: `const currentRafId = requestAnimationFrame(exec)`.

En jsdom el `requestAnimationFrame` lo mueve un temporizador de ~16 ms
(`vitest.config.ts` activa `pretendToBeVisual`). El test, en cambio, avanzaba con dos
`await user.tab()` que con `delay: 0` son un par de saltos de macrotarea de pocos ms.
Resultado: el assert corría **antes o después** del frame según lo que tardaran esos
dos `tab()` en esa ejecución concreta. Nada de eso depende del código: depende del
reloj.

Por eso el mismo commit da los dos resultados. Verificado en este worktree, sobre el
código **sin tocar**:

- rojo 3/3 en un momento (y rojo en todas las corridas instrumentadas de ese rato),
- verde 7/7 un rato después, misma orden, mismo commit, misma máquina,
- verde 2/2 con 4 procesos quemando CPU,
- verde 4/4 con la suite completa corriendo en paralelo,
- verde en aislado (`-t "R30"`).

Medida del margen, con 40 repeticiones de la secuencia vieja en un solo proceso: el
hueco entre el `Tab` y el assert osciló entre **~3 ms** (rojo) y **148 ms** (verde).
El umbral es un frame, ~16 ms. Por eso "carga de la máquina" correlaciona a ratos
pero no es la causa ni predice el signo: es solo un proxy de cuánto tarda `user.tab()`.

## 2. Qué se arregló y por qué ese y no el otro

**El defecto estaba en el test, no en el componente.**

- El atrapado de foco que promete R30 funciona: el foco vuelve al primer enfocable del
  diálogo. Se comprobó que ocurre siempre; lo único discutible era *cuándo*.
- Ese "cuándo" es un `requestAnimationFrame`, y en un navegador los callbacks de rAF
  corren **antes del pintado**. La persona usuaria nunca ve el foco fuera del diálogo,
  ni con un equipo lento: un frame sigue siendo un frame. No hay defecto de
  accesibilidad que arreglar en `Modal`.
- El rAF además vive en la dependencia (`@base-ui/react`), dentro de su focus trap. El
  `Modal` no lo agenda ni podría hacerlo síncrono sin reimplementar el trap.

Cambio aplicado: esperar al **hecho observable** en vez de a un plazo.

```
confirmBtn().focus();
await user.tab();
await waitFor(() => expect(document.activeElement).toBe(primerEnfocable));
expect(dialog.contains(document.activeElement)).toBe(true);
expect(document.activeElement).not.toBe(document.body);
```

Notas de por qué esto no es maquillaje:

- **No se subió ningún timeout.** `vitest.config.ts` no se tocó. El `waitFor` no es un
  plazo de espera: es la condición de parada. En cuanto el foco aterriza, sigue.
- **La aserción es más fuerte que antes**, no más laxa. Antes: "el foco está en algún
  sitio dentro del diálogo". Ahora: "el foco está exactamente en el primer enfocable",
  que es lo que dice el nombre del test ("envuelve al primer enfocable"), **más** las
  dos aserciones originales, intactas.
- Se elimina el segundo `user.tab()`, que era un parche: en un navegador el usuario
  pulsa Tab **una** vez desde el último enfocable y la guarda lo devuelve adentro. El
  segundo Tab solo existía para darle tiempo al frame.
- **Test de mutación**: con `<Dialog.Root modal={false}>` (trap desactivado a
  propósito) el test **falla**. No se volvió un no-op.

## 3. ¿Afecta el patrón a más tests?

Se revisaron todos los tests con `user.tab()`, `{Tab}`, `activeElement`, `.focus()` o
`toHaveFocus`:

- `tests/components/Modal.test.tsx:504` (R29, foco al abrir) — **ya** usaba `waitFor`.
  Correcto de origen; es el mismo efecto diferido.
- `tests/components/LoginForm.test.tsx:388-392` (orden de tabulación) — **no** aplica:
  es orden de tabulación del DOM en un formulario plano, sin popup ni guardas; el
  movimiento de foco de `user.tab()` ahí es síncrono.
- `tests/components/Select.test.tsx:92,107` — `trigger.focus()` seguido de
  `{Enter}`/`{ArrowDown}`, pero **no** asertan sobre el foco: asertan sobre
  `onValueChange` y esperan la lista con `findByRole`. No están expuestos hoy. Es lo
  más cercano al mismo patrón (teclado sobre un popup de Base UI cuyo resaltado
  inicial también se agenda), así que es el sitio a mirar primero si aparece otra
  intermitencia de teclado.
- `tests/components/BulkUpload.test.tsx:118` y `ToastProvider.test.tsx:331` — `focus()`
  directo y aserción inmediata sobre el mismo elemento, sin efecto diferido de por medio.

Conclusión: **caso aislado**, no deuda de la suite. R30 era el único assert de foco
síncrono sobre un rebote de guarda.

## 4. Puertas

Todo desde el worktree, con `node_modules` propio (`pnpm install --frozen-lockfile`) y
cliente Prisma generado (`prisma generate`; sin él el `typecheck` da falsos negativos
`@prisma/client has no exported member`).

- `pnpm test tests/components/Modal.test.tsx` → **45/45, 3 corridas seguidas** en
  reposo; **3 más** con 6 procesos quemando CPU; **1 más** con la suite completa
  corriendo en paralelo.
- `pnpm run typecheck` → sin salida (verde).
- `pnpm run lint` → **0 errores**, 20 warnings preexistentes (`no-unused-vars` con
  prefijo `_` en tests ajenos; ya estaban en `dev`).
- `pnpm test` completo → **665 archivos, 8060/8060**.
- `./init.sh` → **`== init OK ==`**.

### Ruido descartado por el camino

En la **primera** pasada de `./init.sh` de este worktree, `OrdenesModuleReuse.test.tsx`
se cayó por *timeout* de 20 s. No es un fallo real ni tiene que ver con este cambio:
era la caché de transformación de Vite en frío, recién creado el worktree (`transform`
7,11 s la primera vez → 1,10 s la segunda). En la segunda corrida pasó, y la suite
completa quedó verde. `vitest.config.ts` ya documenta que ese archivo es de los
sensibles a la contención de CPU.
