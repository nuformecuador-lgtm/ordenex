# Review de la feature 122 — analítica: alcance por rol

> Revisión independiente contra `specs/122-analitica-alcance-por-rol/`, `docs/` y
> `CHECKPOINTS.md`. Fecha: 2026-08-01. Persistido por el leader a partir del informe
> del reviewer (el reviewer no escribe archivos; midió y devolvió el veredicto).

## VEREDICTO: **APROBADO** — cero hallazgos mayores

Con una salvedad de proceso que le tocaba al **leader**, no al implementer (M-1), ya resuelta
en este mismo commit.

---

## 1. Cómo se midió (no se dio por buena la bitácora)

El `node_modules` de `wt122` colapsó durante la revisión por **MAX_PATH**: `pnpm install`
aborta con ENOENT al extraer `prisma`, `@prisma/client` queda vacío y ahí **no se puede
correr ni typecheck ni lint ni `db:generate`**. Para medir de verdad, el reviewer copió el
árbol (sin `.git` ni `node_modules`) a una ruta corta, instaló limpio y generó el cliente
Prisma **sin parches**:

| Gate | Resultado |
|---|---|
| `pnpm run typecheck` | **0 errores** |
| `pnpm run lint` | **0 errores** (20 warnings preexistentes) |
| `pnpm vitest run tests/unit/analytics` | **22 archivos / 317 tests, 0 rojos** |
| `pnpm vitest run` (completa) | **678/679 archivos, 8197/8198 tests** |

El único rojo global es `tests/unit/guards/no-embalaje.test.ts` (timeout a 20 s bajo carga,
21310 ms). **En aislado pasa en 4.8 s** y **ya salía rojo en el baseline del implementer**
antes de escribir una línea: flake de contención preexistente, no regresión. `./init.sh` no
llega a `== init OK ==` por ese flake y por nada más.

El leader confirmó por su cuenta la cifra de analítica: 22 archivos / 317 tests, 0 rojos.

## 2. Mutaciones del reviewer — 4/4 detectadas

Ninguna reutilizada del implementer. Todas aplicadas y revertidas con Edit (nunca con git);
`wt122` quedó con `git status` vacío.

- **M1 · `whereOrden(tienda)` devuelve `{}`** (fuga total entre tiendas en el adaptador)
  → 4 tests rojos en 2 archivos, entre ellos *«con dos tiendas en el universo, la ajena queda
  fuera del where»*.
- **M2 · `recortarFiltro` caso `tienda` devuelve el filtro del cliente sin intersecar ni
  escribir el recorte** — la mutación más peligrosa: un `adminTienda` sin filtro pasaría a
  consultar **sin recorte** → **7 tests rojos**, incluidos *«las 5 × 23 × 4 combinaciones
  quedan afirmadas, sin ninguna fila fuera del alcance»* y *«el caso ajeno de un rol acotado
  siempre es forbidden, nunca ok con cero filas»*. **Conclusión clave: la matriz de R22 (460
  casos) SÍ detecta la fuga; no es tautológica.**
- **M3 · `esRolAnalitica` acepta cualquier cadena** (se cae la validación de rol, R12)
  → 3 tests rojos.
- **M4 · retirar las dos directivas `@ts-expect-error` de R16/R17** → typecheck rojo
  (TS2741 y TS2345). Son portantes, no decorativas.

## 3. Trazabilidad R1–R41: **41/41**, ninguno vacío

Verificada nombre por nombre contra `progress/impl_122.md §4`; todos los `it` citados existen.
Los guardias que podrían «pasar por vacío» llevan autocomprobación y contrapeso de censo
no-vacío (R18 fixtures + `archivos.length > 0` por capa; R22 `casos === 460` y `conFilas > 0`;
R5/R7/R37 censos con fixture infractor). **R33 no es test por diseño** y se verificó a mano.

## 4. R33 — frontera de rama, verificada

`git diff --name-only be85db2d..HEAD` (solo los commits de implementación): **0** archivos en
`db/migrations/`, `app/`, `components/`, `lib/{actions,services,repositories}/`. Solo
`lib/analytics/**` (5), `tests/unit/analytics/**` (14) y `progress/impl_122.md`. La única
excepción heredada, `modulo-puro.guardia.test.ts`, va en **commit propio y aislado**
(`5aefd4dc`). Ningún archivo fuera de `lib/analytics/**` importa los cinco módulos nuevos.

## 5. Los cuatro puntos que el implementer dejó abiertos — juicio del reviewer

**(a) `design.md §3.4` era falso.** Comprobado con una sonda real fuera del módulo:
`{...} as ConsultaAnalitica` **compila sin un solo error**. En la **letra** de R16 («construir
ese valor con un literal desde fuera del módulo no debe compilar») **no se cumple**; en su
**función operativa** (R17) **sí**, y M4 lo demuestra. Peor: el guardia de R18 **tampoco**
atrapa al forjador — solo hace grep de la palabra `ConsultaAnalitica`, y un repositorio que
escriba `as unknown as ConsultaAnalitica` lo pasa (probado con fixture). Clasificado como
**menor** porque forjar no es olvidar: exige teclear `alcance: {tipo:"global"}` a mano.
→ **Corregido en `design.md §3.4` por el leader** (M-2) y dejado como deber de la 126.

**(b) Hueco de las aristas de solo tipo fuera de `lib/analytics/**`.** **Aceptable.** Un
`import type` se borra en compilación y no puede romper el propósito de R31 (importar sin
`DATABASE_URL` ni efectos); la prueba empírica está por encima de la lista. La regla dura
sigue intacta en el censo directo, con un test por cada mitad. Desvío del literal de T5.1:
**menor**, documentado.

**(c) `MENSAJERO_SIN_ASIGNAR` no se seudonimiza.** **Correcto.** Es una constante del
catálogo, no un uuid de persona; etiquetarlo `Mensajero N` inventaría un repartidor y
falsearía la distribución. Sin objeción.

**(d) `ROLES_SIN_ANALITICA = ["apiKey"]` en `alcance.ts`.** **No es una segunda tabla de
alcance** (R8): es una lista de pertenencia que no dice qué ve nadie, y el guardia exige
`ROLES_ANALITICA ∪ ROLES_SIN_ANALITICA ≡ Object.values(RolValue)`, así que un rol nuevo en el
esquema pone el guardia rojo. Sin objeción.

## 6. Hallazgos

### MAYORES (bloqueantes): **ninguno**

### MENORES

| | Hallazgo | Estado |
|---|---|---|
| **M-1** | `tasks.md` no tenía ninguna task marcada (`CHECKPOINTS.md:9` lo exige). No era culpa del implementer: R33 le prohíbe tocar `specs/`. | **RESUELTO** por el leader: T1.1–T6.2 marcadas; T6.3/T6.4 siguen abiertas (son del leader, tocan `feature_list.json`). |
| **M-2** | `design.md §3.4` afirmaba una falsedad. Debía corregirse en el **spec**, no solo en la bitácora, para que 126/127 no diseñen contra una garantía inexistente. | **RESUELTO** por el leader en `design.md §3.4`, con el deber heredado escrito. |
| **M-3** | `alcance-bordes.guardia.test.ts` **no censa el repo**: solo evalúa bordes sintéticos. Su comentario dice «si esto se pone rojo cuando la 126 aterrice…» y **no se pondrá rojo**, porque no lee `app/`. | **ABIERTO** → deber de la 126: añadir el censo. |
| **M-4** | **Oráculo residual contra R39**: `recortarFiltro` solo interseca la dimensión del alcance; un `adminTienda` puede enviar `mensajero_id: [<uuid>]` y, por el conteo devuelto, confirmar si ese mensajero trabajó para él pese a la seudonimización. Requiere conocer un uuid v4 de antemano → riesgo bajo. | **ABIERTO** → aviso dirigido a 126/133. |
| **M-5** | `politicaIdentidadDe` resuelve por rol, no por grano; R38 lo condiciona a `grano === "mensajero"`. La implementación es **más estricta**, no es un fallo. | Anotado. |
| **M-6** | Punto derivado: `adminSatelite` + grano `mensajero` ⇒ política `real`. | **Aprobado por el humano el 2026-08-01** junto con el spec. |

## 7. Checkpoints

| Punto | Estado |
|---|---|
| requirements/design/tasks existen; design con alternativa descartada | OK (2 alternativas) |
| todas las tasks marcadas | OK tras M-1 (T6.3/T6.4 abiertas, son del cierre del leader) |
| cada `R<n>` → test concreto | OK, **41/41** |
| `progress/impl_122.md` con mapa `R<n> → test` | OK |
| typecheck / lint sin errores | OK (medido por el reviewer en árbol sano) |
| `pnpm test` | 1 flake preexistente (`no-embalaje`), verde en aislado |
| E2E de flujo crítico | N/A justificado: R33 prohíbe rutas y páginas; no hay borde que ejercitar |
| RLS en tablas nuevas / migraciones reversibles | N/A: 0 migraciones, 0 tablas |
| sin secretos hardcodeados | OK (no lee `process.env`; el guardia lo censa) |
| webhooks con firma/idempotencia | N/A |
| capas separadas | OK: módulo puro, sin HTTP, sin DB, sin `interfaces/services` |
| sin hardcode de país/moneda/cuenta | OK |
| `./init.sh` verde | Corta solo por el flake de contención |

## 8. Avisos operativos vivos

1. **`wt122` no sirve para correr gates**: su `node_modules` colapsó por MAX_PATH y
   `pnpm install` no puede repararlo ahí. Para medir, copiar el árbol a una ruta corta.
   Es un defecto del **entorno**, no de la rama; en el checkout principal no ocurre.
2. El reviewer no ejecutó git destructivo, no tocó el checkout principal ni `wt130`.
