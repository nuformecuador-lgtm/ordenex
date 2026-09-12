# Re-revisión acotada — ficha 422 · el arreglo de B1 y B2

**Alcance.** Solo los dos bloqueantes de `progress/review_422.md` (SHA `90fbadd8`). El arreglo llega
hasta `4643e648`. La revisión completa no se repite.

**Cómo se midió.** Worktree propio en ruta corta `R:/wt/rev422b` (detached en `4643e648`),
`pnpm install --frozen-lockfile` + `prisma generate`, `.env` copiado para correr con base y
**borrado al terminar**. Cada intruso se escribió **en el árbol de verdad** y se revirtió con copia
byte a byte verificada por SHA256 — nunca `git checkout --`.

---

## 1. Cero código de producción — **PASA**

```
$ git diff --numstat 90fbadd8..4643e648
126   3   progress/impl_422_backend.md
  3   1   specs/422-preferencia-push-recordada/tasks.md
250   0   tests/fixtures/raices-de-codigo.ts
185  19   tests/unit/guards/push-alta-punto-unico.guardia.test.ts
347  41   tests/unit/guards/push-intencion-de-baja.guardia.test.ts
```

Ni una línea de `lib/`, `app/`, `components/`, `hooks/` ni `db/`. Es exactamente lo declarado: un
fixture nuevo, las dos guardias, una celda de `tasks.md` (el menor `m1`, partido en M2a/M2b/M2a+M2b)
y la bitácora.

---

## 2. B1 — las raíces del censo — **CERRADO**

| Prueba | Resultado |
| --- | --- |
| **E1 · mi intruso original en `providers/ToastProvider.tsx`** (`tercerAdios()` + `segundoCaminoDelAlta()`, tal cual `review_422.md` B1) | **MUERE**: exit 1, **7 rojos** en las dos guardias. Antes: `TSC_EXIT=0` y 145/2.091 en verde. |
| **E3 · raíz nueva con nombre distinto al suyo** (`paneles/interno/panel.ts`; él probó `widgets/`) | **MUERE**: exit 1, **3 rojos** — `toda raiz de codigo ... esta clasificada` en las **dos** guardias + la anti-vacuidad de las ocho. La derivación desde disco funciona con cualquier nombre. |
| **E7 · los `.ts` sueltos de la raíz**: import con alias + llamada añadidos a `middleware.ts` | **MUERE**: exit 1, 2 rojos. `middleware.ts` está de verdad dentro del censo, no solo aseverado. |
| Baseline limpio de las dos guardias | 57 pasan, exit 0. |

**El inventario no perdona de más.** Verificado por mutación, no por lectura:

- **E6** — tercera entrada falsa en `SUSCRIPCIONES_AUTORIZADAS` (perdonando a `usePushSuscripcion.ts`,
  que no tiene ningún `subscribe`) da **1 rojo** (`el censo del NOMBRE DEL METODO cuadra con la lista
  blanca`). El `toEqual` es sobre la **lista completa**.
- **E8** — tercera entrada falsa en `LISTA_BLANCA` (perdonando a `AvisoVersionNueva.tsx`) da **4 rojos**.

**`tests/` como única raíz fuera: de acuerdo**, con una salvedad (ver menor m2). El argumento es
legítimo —es el único sitio con razón para nombrar lo prohibido, y censarla convertiría a las propias
guardias en infractoras— y el límite está escrito en el motivo. Lo que hay que apretar es la
**redacción** del límite: «una superficie escrita dentro de `tests/` no se despliega» es falsable.

**El defecto propio (rojos en cadena): corregido.** E3 reproducido dos veces da **3 rojos y ninguno
es una autocomprobación**: las cuatro sintéticas (`widgets`, `fantasma`, control positivo, sin
motivo) siguen verdes. La noticia se lee.

---

## 3. B2 — el alias del import — **CERRADO**

| Prueba | Resultado |
| --- | --- |
| **E2 · mi escenario original**: `import { darDeBajaDeEsteDispositivo as bajar }` + `bajar("cierre-de-sesion")` en `components/shared/AvisoVersionNueva.tsx` (componente **ya montado**) | **MUERE**: exit 1, **3 rojos**, incluido `EL CASO DE LA REVISION: alias en un componente YA montado`. |

La inversión —perseguir el **especificador del módulo** en vez de la llamada— es la corrección
correcta y no un parche al síntoma. Idem en G2 con el identificador desnudo.

---

## 4. La séptima vía — **ENCONTRADA, y no está declarada**

### B3 · BLOQUEANTE — un módulo `.js` dentro de una raíz censada es invisible para el censo **y para el tipo**

El censo define «archivo de código» con la aguja `\.(ts|tsx)` anclada al final del nombre — en
`tieneCodigo()`, en `archivosDe()` y en el barrido de los sueltos de la raíz
(`tests/fixtures/raices-de-codigo.ts:153,174,227,243`). Un `.js` **dentro de una raíz censada** no se
lee nunca.

Medido. `components/shared/adios-legacy.js`:

```js
import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";

export async function adiosLegacy() {
  await darDeBajaDeEsteDispositivo();     // SIN NINGUN MOTIVO
}
```

importado y llamado desde `components/shared/AvisoVersionNueva.tsx`, que el layout del portal **ya
monta** (la misma superficie alcanzable que usé para B2):

```
$ pnpm exec vitest run tests/unit/guards/
 Test Files  145 passed (145)
      Tests  2117 passed (2117)        VITEST_EXIT=0
$ npx tsc --noEmit                      TSC_EXIT=0
$ pnpm run lint                         LINT_EXIT=0  (0 errors)
```

**Por qué es peor que el límite ya declarado.** `tsconfig.json` tiene `allowJs: true` y **no** tiene
`checkJs`, y su `include` solo lista `**/*.ts`, `**/*.tsx` y `**/*.mts`. O sea: el `.js` **no se
type-checkea**. La llamada de arriba no pasa ningún motivo y compila. Aquí no sobrevive «la mitad
fuerte de R10 que no depende de ninguna guardia»: **caen las dos líneas de defensa a la vez**.

**Y no es una vía retorcida.** No hay obfuscación: se escribe un archivo `.js`, que es un acto
ordinario. El repo ya tiene cinco (`public/sw.js` y cuatro `scripts/*.mjs`), `allowJs` está
encendido, y ni `docs/conventions.md` ni `docs/architecture.md` prohíben `.js` en `app/` o
`components/`. Next compila y despliega un `.js` sin decir nada.

**El agujero concreto que esto deja hoy, con nombre y apellido.** `public/sw.js` (360 líneas,
registrado en `app/layout.tsx:71`, ya con su `addEventListener("push", ...)`) **ni siquiera es una
«raíz de código»** para el fixture: `public/` no contiene ningún `.ts`, así que no aparece en
`raicesDelArbol()`, no entra en `INVENTARIO_DE_RAICES`, y nadie tiene que escribir un motivo para
dejarlo fuera. Es el único archivo desplegado donde un **segundo `pushManager.subscribe()`** es
idiomático —el manejador de `pushsubscriptionchange`, que es la receta estándar para re-suscribir— y
ahí no hay ninguna comprobación de permiso. G2 seguiría afirmando «`subscribe(` aparece UNA vez, y
dentro de `alta-push.ts`, que es donde vive la comprobación» (R15/R17) mientras eso existiera.

Hoy `sw.js` no contiene `subscribe`, `requestPermission` ni `pushManager` — lo comprobé. El defecto
no es un incumplimiento actual: es que **la guardia no lo vería**, que es exactamente el mismo
enunciado que hizo bloqueante a B1.

**Qué falta para cumplirlo.** Cualquiera de las dos, y las dos son cambios solo en tests:

1. Extender la aguja de extensión a `.js`, `.jsx`, `.mjs` y `.cjs` en las tres funciones del fixture.
   El mecanismo trabaja entonces solo: `public/` pasa a ser raíz de código y **obliga** a escribir su
   decisión y su porqué en el inventario — que es justo lo que hace falta para `sw.js`.
2. O **declararlo** como límite, con el mismo rigor que el de la cadena compuesta. Pero una
   declaración solo vale si nombra `public/sw.js` explícitamente y explica por qué se acepta que
   R16/R17 no lo cubran, porque la frase «en todo el árbol» ahí es literalmente falsa. Y tiene que
   decir además que en `.js` **el tipo tampoco defiende**, cosa que no ocurre en el otro límite.

---

## 5. Lo que él declara que no cierra — **aceptable, no bloqueante**

`await import("@/lib/pwa/" + "baja-push")`. Estoy de acuerdo y no lo cuento como hallazgo:

- **el tipo conserva su mitad**: el motivo sigue siendo parámetro obligatorio de una unión cerrada,
  así que esa superficie tiene que declarar uno de los dos igualmente. R10 no se queda desnudo;
- **partir una cadena para esquivar un censo es deliberado**, y estas guardias persiguen a quien se
  olvida. Una protección que solo detiene al que no se esconde, declarada como tal, vale más que una
  que finge detener a todos;
- **está escrito con su propio caso** (`EL LIMITE, DECLARADO`) que afirma que el detector da cero
  ahí, en vez de dejarlo para que alguien lo descubra creyendo que es un fallo.

Ese es el contraste exacto con B3: allí el acto es ordinario, el tipo tampoco protege, y no está
declarado en ninguna parte.

---

## 6. Gate — **reproducido, exacto**

```
$ ./init.sh                     (worktree R:/wt/rev422b, con .env)
typecheck paso
lint paso
DATABASE_URL resuelta: los 173 archivos de tests contra Postgres SI se ejecutan
 Test Files  1950 passed (1950)
      Tests  28351 passed | 26 skipped (28377)
tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1950 ejecutado(s))
== init OK ==
INIT_EXIT=0
```

Cuadra al caso con lo que reporta la bitácora: **1950 / 28.351 / 26 skipped**, y el `INIT_EXIT=0`
está **dentro** del log, no en el exit code del shell. Los 26 skipped son los 17 de `AnaliticaPage`
(64 tests, 17 skipped) + 9 de `AnaliticaShell` (15 tests, 9 skipped); **cero** de
`tests/integration/db/`. El delta +26 sobre mi corrida anterior (28.325) es el de este arreglo. No se
propuso ningún reset de base.

---

## 7. Checklist

- [x] Cero código de producción en `90fbadd8..4643e648`, medido.
- [x] **B1 cerrado**: derivación desde disco verificada con una raíz nueva de nombre propio; los
      `.ts` sueltos de la raíz entran de verdad (`middleware.ts` caza); mi intruso original muere.
- [x] **B2 cerrado**: mi alias sobre un componente ya montado muere.
- [x] Las dos listas blancas comparan con `toEqual` sobre la lista completa: perdonar de más enrojece.
- [x] Rojos en cadena de las autocomprobaciones: corregido, medido dos veces.
- [x] Gate completo corrido por mí, verde, con los números declarados.
- [x] El menor `m1` de la revisión anterior (celda M2 de `tasks.md`) resuelto, y bien: partido en
      M2a/M2b/M2a+M2b con los rojos reales de cada uno.
- [ ] **Séptima vía**: encontrada y **no declarada** (B3).

---

## 8. Hallazgos

### BLOQUEANTE — B3 · el `.js` se cuela por las dos capas
Detalle y medición en la sección 4. Un módulo `.js` dentro de una raíz censada escapa al censo
(145/2.117 verdes) **y** al `tsc` (`TSC_EXIT=0`, `allowJs` sin `checkJs`), así que la llamada puede
ir **sin motivo**. `public/sw.js` —desplegado, registrado, con manejador `push`— no llega ni a ser
«raíz de código», y es el sitio idiomático de un segundo `pushManager.subscribe()`. No hay
declaración en ninguna parte.

### menor — m2 · la redacción del límite de `tests/` es falsable
El motivo de `tests/` dice que una superficie escrita ahí «no se despliega». Medido: un barril
`tests/fixtures/reexport-baja.ts` que reexporta desde `@/lib/pwa/baja-push`, importado **con alias**
desde `providers/ToastProvider.tsx`, pasa con 145/2.117 verdes y `TSC_EXIT=0`. Lo cuento **menor** y
no bloqueante porque exige **dos** actos deliberados (que producción importe de `@/tests/` y que
además renombre) y el tipo conserva su mitad —el motivo sigue siendo obligatorio—. Basta con
reescribir el límite: lo que `tests/` no puede hacer es desplegarse por sí misma; reexportada sí
viaja.

### menor — m3 · una autocomprobación de B2 sigue enrojeciendo en cadena
Con el intruso REAL de E1 vivo en `providers/ToastProvider.tsx`, los casos `y una RUTA RELATIVA no lo
esquiva` y `EL CASO DE LA REVISION: un segundo camino escrito en providers/` caen además de los
propios: `nuevasInfracciones` resta la infracción real porque la clave coincide, y el caso se queda
sin su noticia. Es el mismo patrón que él corrigió para el inventario, en los casos que usan un
archivo real como lienzo. Con un lienzo sintético (como el `INVENTARIO_DE_JUGUETE`) desaparece.

### fuera de alcance — no cuenta contra la 422
En **una** de mis corridas de E3, `impresion-flujo.guardia.test.ts` y
`factura-contraste.guardia.test.ts` salieron rojas (21,6 s cada una) y **no reprodujeron**; en árbol
limpio pasan (107/107) y el gate completo salió verde. Huelen a `RegExp.prototype.test` con flag
global (`lastIndex` con estado) sobre `FIRMA_DEL_PARSER`. Es de la 223, no de ésta.

---

## Veredicto

# RECHAZADO

Los **dos bloqueantes originales están cerrados de verdad**, y bien: no se parchearon los dos casos,
se arregló la propiedad —las raíces se derivan y se declaran, el censo persigue el módulo—. Lo
verifiqué con mis dos escenarios originales y con una raíz nueva de nombre propio: los tres mueren.
El gate está verde y cuadra al caso. El defecto de los rojos en cadena también está corregido.

Rechazo por **B3 y solo por B3**: hay una séptima vía, se cuela con `TSC_EXIT=0`, `LINT_EXIT=0` y
145/2.117 guardias en verde, no está declarada en ninguna parte, y a diferencia del límite que sí
está declarado **tumba también la defensa del tipo** —la baja puede escribirse sin ningún motivo—.
El criterio que hizo bloqueante a B1 es literalmente el mismo: «en todo el árbol» sigue sin ser
verdad, ahora por la extensión del archivo en vez de por el nombre de la carpeta.

Lo que falta es pequeño y vive entero en `tests/fixtures/raices-de-codigo.ts`: censar también
`.js`, `.jsx`, `.mjs` y `.cjs` —y dejar que el inventario reclame `public/` con su motivo, que es el
desenlace útil— o declarar el límite nombrando `public/sw.js` y diciendo que ahí el tipo tampoco
defiende. Vuelve al implementer; no toqué código.
