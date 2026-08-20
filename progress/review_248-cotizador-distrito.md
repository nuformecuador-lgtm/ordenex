# Feature 248 — Cotizador de envío por distrito · review

Reviewer, 2026-08-20. Worktree `C:/w248`, rama `feature/248-cotizador-distrito` (36 archivos sin
commitear). Material leído: `specs/248-cotizador-distrito/{requirements,design,tasks}.md`,
`progress/impl_248-cotizador-distrito.md`, `docs/architecture.md`, `docs/conventions.md`,
`docs/verification.md`, `CHECKPOINTS.md`, `feature_list.json` (id 248).

**VEREDICTO: APROBADO.** 0 hallazgos BLOQUEANTES, 5 menores.

---

## 1. Lo que medí yo, en este worktree

| Medida | Resultado |
| --- | --- |
| `pnpm run typecheck` | **LIMPIO**, cero errores (corrido por mí) |
| `pnpm run lint` | **0 errores / 97 warnings** (corrido por mí; baseline exacto de `dev`) |
| Los 11 archivos de test de la 248 | **113 tests, 11 archivos, todos verdes** |
| `pnpm exec vitest run guard` (TODAS las guardias) | **127 archivos, 1831 tests, verdes** |
| No-regresión T1.4 (bulk + carga API + repositorio) | **8 archivos, 206 tests, verdes** |
| No-regresión T1.4 (cierre + api-key + listado) | **127 archivos, 1810 tests, verdes** |
| Espejo `openapi-spec.ts` vs `api-key-openapi.yaml` | **deep-equal EXACTO** (comprobado ad-hoc con js-yaml; el test temporal se borró) |
| Suite completa (1244 archivos, 11 rojos ambientales) | NO re-corrida: ya medida y probada como ajena |

Los 11 rojos de `tests/integration/db/` no se re-investigan por instrucción explícita: están
probados con stash como preexistentes en `dev` (enum `solicitud_ayuda_tienda`, migraciones de las
features 235/237 sin aplicar al Postgres local). Esta feature no toca `db/`: `git status -- db/`
sale vacío.

## 2. Checklist de CHECKPOINTS.md

- [x] `requirements.md` con EARS numerados (40); `design.md` con alternativas descartadas y su
      porqué (D2, D6, D12, D13, D14 las traen explícitas); `tasks.md` presente.
- [ ] **Todas las tasks `[x]`**: 30 de 32. Quedan **T8.2** (`./init.sh` completo en verde) y
      **T8.3** (PR + bookkeeping), que son cierre y trabajo del leader. Ver menor 4.
- [x] Cada `R1`-`R40` mapea a un test concreto **que lo ejercita** (ver §3).
- [x] `progress/impl_248-cotizador-distrito.md` contiene el mapa `R<n> -> test` (40 filas).
- [x] typecheck sin errores; lint sin errores.
- [ ] `pnpm test` completo: 11 rojos **ambientales**, ninguno atribuible a la 248. Ver menor 4.
- [ ] E2E: no se añadió, existiendo el precedente `e2e/rastreo-publico.spec.ts`. Ver menor 3.
- [x] RLS y migraciones: **N/A por construcción**. Cero migraciones, cero cambios de
      `db/schema.prisma`, con guardia propia que lo mide (`cotizador-sin-migracion.guardia`).
- [x] Sin secretos hardcodeados. El tope de `cantidad` sale de `lib/config/cotizador.ts` con
      override por entorno (`COTIZADOR_CANTIDAD_MIN/MAX`), no de un literal en el service.
- [x] Webhooks: N/A (no hay).
- [x] Capas: el handler `cotizar/route.ts` no tiene queries ni negocio (traduce HTTP y delega);
      `CotizadorService` y `CoberturaService` no conocen `Request`/`Response`/headers;
      `CoberturaDistritoRepository` solo consulta; interfaces en
      `lib/interfaces/{repositories,services}/`.
- [x] Permisos: `/cotizador` es pública por decisión firmada (firma 3), con la ausencia de
      `resolveActorFromSession` documentada y con test que la afirma; el canal por API key toma la
      tienda de `actor.usuarioId` y jamás del cuerpo ni de la query.
- [x] Sin hardcode de país, moneda ni cuenta.
- [ ] `./init.sh` completo en verde: **no** en esta máquina, por los 11 rojos ambientales. Menor 4.

## 3. Trazabilidad R1-R40: verificada una por una, buscando tests vacuos

Revisé los 11 archivos de test de la feature línea a línea buscando tests que pasarían igual con el
código roto. **No encontré ninguno.** Lo que sostiene esa afirmación:

- **Las cuatro guardias nuevas llevan control de no-vacuidad Y contraprueba**, y las contrapruebas
  son de verdad: la de R10 ensucia una **hoja** del grafo (`lib/utils/normalize.ts`, que no es
  raíz) con un especificador que no contiene ninguna palabra prohibida, y el detector cae **a dos
  saltos**; la de R23 fabrica un cotizador impostor con las fórmulas escritas a mano y exige que se
  cacen 8 familias; la de R35 exige además que **no** haya falsos positivos sobre 6 líneas reales
  del árbol; la de R39 distingue el 248 del slug del 248 de la hora del sello de tiempo.
- **R24 (paridad con el cierre)** no compara contra literales escritos a mano: compara contra lo que
  devuelve `agregarIngresosPorConcepto` para la misma entrada, en 16 combinaciones (4 montos x
  esCentral x cobraComision) más los dos casos MEDIDOS del docstring (14 900,00 da 521,50 y 67,80;
  16 618,40 da 581,64 y 75,61). Ese es el test que haría caer cualquier reimplementación.
- **R29 (money-safe)** recorre **exhaustivamente** las hojas del subárbol `escenarios`
  (`expect(importes).toHaveLength(20)` como control) en vez de una lista de claves a mano.
- **R26** usa el caso donde redondear al final da otro número, con `not.toBe("1744.93")`.
- **R21** espía `pagoTiendaOrdenex` con `importOriginal` (implementación real) y exige que la rama
  de devuelta **no lo llame**, ni siquiera con un `"0.00"` de relleno.
- **R1** importa el middleware REAL y añade contraprueba: `/cotizadores`, `/ordenes` y `/dashboard`
  siguen dando 307 a `/login`.
- **R5, R8 y R40** ejercen el camino real (acción -> service -> repositorio) contra un doble de
  Prisma con **trampa**: un accesor `tarifa` espiado que delataría cualquier lectura de tarifas.

## 4. Los puntos que el encargo pedía verificar de verdad

**Aritmética NO reimplementada: CONFIRMADO.** `CotizadorService` llama a
`derivarIngresoOrden("entregada")`, `derivarIngresoOrden("devuelta")`, `costosListadoOrden` y
`pagoTiendaOrdenex`. Las únicas tres operaciones propias (`sumarImportes` con `.plus`,
`negarImporte` con `.neg()`, `porCantidad` con `.mul(cantidad)`) se construyen **sobre valores ya
redondeados** por `ingreso-ordenex`, están documentadas una por una, y la guardia estática las
lista como whitelist exacta (un `.mul(otraCosa)` caería). Money-safe: todo importe nace
`Prisma.Decimal` y sale STRING escala 2; cero `number`, `parseFloat`, `Math.` o `toLocaleString` en
el fuente, medido por test.

**La superficie pública no filtra ni un importe, y el "punto de roce" es INOCUO.** Evaluado por mí,
no aceptado del informe:

- el Client Component importa de `lib/types/cotizador.ts` **solo tipos** (`import type`), que
  TypeScript borra en compilación: nada de ese módulo llega al bundle del navegador por esa vía;
- aunque llegara, el módulo **no contiene ni un valor monetario**: los DTOs de dinero son
  `interface` (borradas), y los únicos valores en tiempo de ejecución son los schemas zod y
  `textoSupuesto`. No hay tarifa, ni porcentaje, ni monto que filtrar, ni derivable por diferencia;
- el módulo está **dentro** del cierre transitivo que la guardia recorre, así que el día que
  importe `ingreso-ordenex`, `TarifaVigentePorTienda` o toque `prisma.tarifa`, se pone roja;
- el HTML server-rendered lleva el árbol geográfico **sin `zonas` ni `esCentral`** (el `select` del
  repositorio no los nombra), y el DTO de la Server Action tiene sus claves firmadas contra un
  literal, comprobadas **también en ejecución** (un spread pasaría el chequeo de literales de
  TypeScript, y por eso se mide lo que se emite de verdad).

El residuo real queda anotado en el menor 1.

**Las dos guardias re-firmadas: ACTUALIZADAS, NO DEBILITADAS.**

- `rastreo-sin-ruta-nueva.guardia`: `/cotizador` entra en su **posición real** (la comparación es
  posicional), con comentario que nombra feature, requisito y firma. `SELF_AUTH_ROUTES` no se tocó
  (ya contenía el prefijo `/api/ordenes/api-key`). La contraprueba del archivo sigue intacta.
- `openapi-177-paths-pdf-y-carga-id`: de 7 a 8 paths, `toHaveLength` + `toEqual` intactos, y **se
  endureció**: el caso del `.yaml` ahora también lleva `toHaveLength(8)`, que antes no tenía.

**T1.4, no regresión de `resolveGeo`: CONFIRMADO.** El `git diff` sobre `tests/` toca **exactamente**
los dos archivos de guardia re-firmados; ni un test ajeno de carga masiva, carga por API, listado o
cierre fue modificado. El diff de `BulkOrdenService` es una extracción **literal** (mismos mensajes
de `fieldErrors` carácter a carácter; el único cambio real es que `resolveGeo` pasa a ser genérica
sobre tipos estructurales). En `OrdenRepository`, el ternario se sustituye por `zonaDeDistrito` con
el **mismo** resultado (`unica` puebla; 0 o más de 1 dan `null` y `false`), y el `select` solo gana
`zona.nombre`, que no entra en `DistritoRow`. Corrí 2 016 tests de esas vías: todos verdes.

**El neto negativo de DEVUELTA:** construido con `.neg()` **sobre** el importe que ya devolvió
`derivarIngresoOrden({resultado:"devuelta"})`, sin recalcular nada, con la razón escrita en el
código (incluido por qué se descartó reusar `pagoTiendaOrdenex`) y publicada en el contrato (NO
EXISTE EN EL CIERRE, no debe cuadrarse contra ninguna línea de cierre). Negar cero da `"0.00"`,
nunca `"-0.00"`, con test.

**Fuera de alcance respetado:** `tarifas.status` sin filtro añadido (afirmado sobre el fuente del
service, que además no menciona `getPrismaClient|prisma.tarifa|findFirst|findMany`) y `fulfillment`
sin entrar (barrido del árbol del OpenAPI: solo dos apariciones, ambas en prosa y en negativo,
ninguna en clave, enum, ejemplo ni schema).

**Contrato publicado:** los tres artefactos coherentes. El `.yaml` es **deep-equal exacto** del
objeto TS (comprobado por mí con js-yaml), 8 paths en el mismo orden, `CotizacionResponse` como
`oneOf` de las dos formas, respuestas 401/403/422 referenciadas, y la colección Postman con carpeta
propia, Bearer heredado, cuerpos de ejemplo con `monto_cobrar` como cadena y el caso 422 de
cantidad fuera de rango.

**Convenciones y arquitectura:** util puro sin Prisma ni repositorios; repositorio sin decisiones de
negocio; textos de UI aislados del JSX; componente colocado junto a su página con el porqué escrito;
configuración por entorno con defecto en código; errores por el shape uniforme de `lib/errors`.

## 5. Hallazgos

**BLOQUEANTES: ninguno.**

**Menores (5):**

1. **menor — el roce de `lib/types/cotizador.ts` es inocuo hoy, pero su vigilancia es parcial.** El
   módulo está en el cierre transitivo de la superficie pública y aloja los DTOs monetarios del
   canal por API key. Hoy no filtra nada (ver §4). El residuo: la guardia de claves firmadas solo
   vigila `ResultadoCoberturaPublica`, y la de aislamiento solo caza las tres puertas al dinero; un
   **valor** monetario nuevo declarado en ese archivo (una tarifa de referencia, un ejemplo
   formateado) llegaría al cierre público sin poner roja ninguna guardia. Sugerencia para una ficha
   futura: separar los DTOs públicos en su propio módulo, o extender el barrido léxico al fichero
   completo y no solo al bloque del tipo público.
2. **menor — la unión de respuesta se discrimina por AUSENCIA de clave.** `CotizacionConCostos` no
   emite `costos`, mientras que `CotizacionSinCostos` emite `costos: null`. Funciona y está
   publicado como `oneOf`, pero un generador de clientes estricto produce un tipo incómodo y un
   integrador podría escribir `if (res.costos)` esperando la clave siempre presente. Un
   discriminador explícito lo cerraría.
3. **menor — sin E2E para la nueva superficie pública.** Existe el precedente
   `e2e/rastreo-publico.spec.ts` para la otra página sin sesión. La frontera RSC de
   `app/cotizador/page.tsx` no la cubre ningún gate del repo (`pnpm exec next build` no se corre en
   ninguno: limitación conocida y ajena a esta feature); el implementer la verificó a mano con
   `next dev` + `curl` (200 sin cookie, cero `esCentral` o `zonaId` en el HTML). Queda como
   verificación no reproducible por el gate.
4. **menor (ambiental) — `./init.sh` completo no termina en verde en esta máquina**, por los 11
   rojos de `tests/integration/db/` que faltan por migración local (probados ajenos a la 248). Eso
   deja T8.2 sin marcar y el checkpoint "init.sh en verde" formalmente incumplido. **No es defecto
   de la feature**: el remedio (aplicar las migraciones de las features 235/237 al Postgres local)
   es decisión del leader, porque la base puede estar compartida con otra sesión viva. T8.3 (PR y
   bookkeeping) es trabajo del leader por diseño.
5. **menor — la bitácora se llama `impl_248-cotizador-distrito.md` y T8.1 pedía `impl_248.md`.**
   Está explicado en el propio archivo (petición explícita del encargo). Solo queda anotado para
   que `progress/history.md` cite el nombre correcto.

## 6. Veredicto

**OK / APROBADO.** Ningún hallazgo bloqueante. La feature entrega los 40 requisitos con tests que
los ejercitan de verdad, no reimplementa un solo céntimo de aritmética, la superficie pública no
puede llegar al dinero (medido, no prometido), el refactor del camino que crea órdenes es de
comportamiento idéntico sin haber tocado un test ajeno, y las dos guardias congeladas se
re-firmaron con más filo del que tenían.

Antes de mergear queda, del lado del leader: decidir el remedio de los 11 rojos ambientales, correr
`./init.sh` completo y cerrar T8.2 y T8.3.
