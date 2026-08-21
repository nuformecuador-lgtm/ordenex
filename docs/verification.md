# docs/verification.md — Cómo demostrar que funciona

"Compila" y "el agente dice que está listo" NO son verificación. Una feature está
verificada cuando hay evidencia ejecutable.

## El gate tiene DOS niveles — usa el que toca

```bash
./init.sh --rapido   # EL GATE NORMAL, tambien para abrir un PR: typecheck + lint + relacionados + guardias
./init.sh            # ANTES DE UNA RELEASE A `prod`, y DESPUES DE CADA MERGE A `dev`: la suite entera
```

> **Cambiado el 2026-08-20.** Antes el completo era obligatorio **antes de cada PR, sin excepción**.
> Se midió lo que costaba: mover un enlace de la nav de la landing = **16.346 tests, 5–11 minutos**,
> cuando lo relacionado con ese cambio eran **21 tests + las guardias = ~33 segundos**. La regla
> cobraba lo mismo por un cambio de texto que por una migración.
>
> **Lo que NO se hizo:** relajarla a secas. `--changed` selecciona por grafo de imports y solo mira
> **tu** diff, así que hay dos huecos, y cada uno tiene su tapa:
>
> | hueco | cómo queda tapado |
> | --- | --- |
> | lo que no se relaciona por imports | **las guardias corren siempre** — recorren el árbol de archivos en vez de importar lo que vigilan |
> | el radio de explosión de un cambio de cimientos | **`--rapido` se niega solo** y te manda al completo (ver abajo) |
> | **un `dev` que ya venía rojo** | **la corrida completa post-merge** sobre `dev`, en segundo plano |
>
> Ese tercero es el que más duele y el que menos se ve: `--changed origin/dev` compara **contra**
> `dev`, así que un rojo que ya estaba ahí **no aparece en tu diff** y el modo rápido sale verde.
> En este repo `dev` llegó rojo **tres veces**, y el único check automático del PR es un build de
> Vercel que **no ejecuta un solo test**.

### Cuándo `--rapido` se niega, y por qué esas rutas

`init.sh --rapido` mira tu diff contra la base común con `origin/dev` —**lo commiteado y lo que
todavía no**— y **falla** si toca alguna de estas:

| ruta | por qué el grafo de imports no basta |
| --- | --- |
| `db/migrations/**` · `db/schema.prisma` | **una migración no la importa nadie**: ningún test sale seleccionado por tocarla |
| **`init.sh`** | tocar el gate cambia **la medida** con la que se mide todo lo demás; un fallo aquí no se ve como un rojo, se ve como **un verde que no significa nada** |
| `lib/types/**` | un catálogo o un enum **lo importa medio repo**; "los relacionados" son casi todos, y decidirlo a ojo es peor que correrlos |
| `package.json` · `pnpm-lock.yaml` · `tsconfig.json` · `middleware.ts` · `next.config.ts` · `vitest.config.ts` · `prisma.config.ts` · `eslint.config.mjs` · `.env.example` | cambian **cómo** se construye y se ejecuta todo; el grafo de imports no modela eso |
| nombres de dinero en `lib/`, `app/`, `components/` (`cierre`, `tarifa`, `pago`, `wallet`, `liquidacion`, `ingreso`, `egreso`, `caja`, `comision`, `flete`, `moneda`, `cobro`, `factura`, `premio`) | el precio de equivocarse **no es un test rojo, es dinero mal cobrado** |

**La lista se mantiene estrecha a propósito.** Medido el 2026-08-20: los nombres de dinero son
**190 de 1136** archivos de código, un **17 %**. Si crece hasta atrapar todo, vuelve el problema que
esto vino a resolver.

**No tiene escape.** La salida es correr `./init.sh`, que es exactamente lo que esos cambios
merecen. Se probó en los dos sentidos —que se niega en `lib/types/`, en un servicio de dinero, en
`db/schema.prisma` y ante una migración nueva sin rastrear; y que **deja pasar** un cambio de la
landing o de un util sin dinero—.

Comandos sueltos, por si necesitas uno concreto:

```bash
pnpm run typecheck        # TypeScript strict, cero errores
pnpm run lint             # ESLint, cero errores
pnpm test                 # la suite entera
pnpm run test:cambiados   # solo lo que el grafo de imports relaciona con tu diff vs origin/dev
pnpm run test:guardias    # las guardias (van SIEMPRE, ver abajo)
pnpm exec vitest related --run <archivos>   # que tests cubren ESTOS archivos
```

### Por que dos niveles

La suite son ~10.000 tests y ~4 minutos. Correrla al cerrar **cada** tanda convertia el arnes en
una sala de espera: una feature de 9 tandas se llevaba ~35 minutos de reloj **solo esperando**, y
el arnes existe para mejorar el trabajo, no para alargarlo.

Medido en este repo el 2026-08-03:

| Que corres | Archivos | Tests | Tiempo |
| --- | --- | --- | --- |
| suite entera | 804 | 10.187 | ~235 s |
| relacionados con un servicio | 16 | 437 | 21 s |
| relacionados con un cambio en un util muy importado | 155 | 2.577 | 103 s |
| **`./init.sh --rapido` entero** (typecheck + lint + tests) | — | — | **~58 s** |

### Las guardias van SIEMPRE, y esta es la razon

`--rapido` selecciona por el **grafo de imports**. Las guardias **no importan lo que vigilan**:
recorren el arbol de archivos (censo de tablas, columnas sensibles, modulos puros, emisores de una
categoria). **Ningun grafo de imports las selecciona**, asi que serian justo lo que se pierde. Por
eso `test:rapido` las corre enteras siempre; cuestan ~8 s.

Se seleccionan por patron (`vitest run guard`), no por lista: una guardia nueva entra sola.

### Lo que `--rapido` NO cubre — no te engañes

- Acoplamientos que **no son imports**: SQL, nombres de archivo, lectura de `feature_list.json`.
- Un cambio en un archivo **sin tests que lo importen** selecciona cero tests y sale verde.
- Regresiones lejanas que solo aparecen con la suite entera.

Por eso **antes de abrir un PR se corre `./init.sh` completo, sin excepcion**. La leccion de los
PRs #209 y #237 de este repo va justo en esa direccion: se mergeo mirando el estado del PR —que es
un build y **no corre tests**— y entro un guard rojo en `dev`.

## Qué cuenta como evidencia
- Salida real de los tests pasando, pegada en `progress/impl_<feature>.md`.
- El mapa `R<n> → test`: para cada requisito, el test que lo cubre.
- Para features con UI o flujo crítico: un test E2E que ejercita el camino
  completo, no solo un unit test del helper.

## Qué NO cuenta
- "Debería funcionar."
- Un test que no asegura nada (sin asserts reales).
- Tests que el implementer escribió para pasar, sin cubrir el requisito.

## Datos (Supabase)
- Verifica RLS con un test que intente acceder sin permiso y confirme el rechazo.
- Verifica migraciones aplicando y revirtiendo en un entorno de prueba.

## Regla del reviewer
Si un requisito no tiene test, o un test no verifica el requisito que dice cubrir,
es hallazgo bloqueante. La feature no pasa a `done`.
