# Feature 163 — Carrusel de las órdenes en reparto · tasks

`[P]` = puede ir en paralelo con las de su mismo bloque.

## T1 — Primitiva
- [x] **T1.1** `pnpm add embla-carousel-react` (dependencia nueva).
- [x] **T1.2** `components/ui/carousel.tsx`: carousel de shadcn adaptado —`Button` y `cn`
      locales, `useSyncExternalStore` en vez de `useState`+efecto, flechas colocables debajo.
      **Hecho**: `pnpm lint` sin errores (la regla `set-state-in-effect` es error aquí).

## T2 — Compuesto shared
- [x] **T2.1** `components/shared/carrusel-rango.ts`: `rangoVisible` y `etiquetaRango`.
- [x] **T2.2** `components/shared/CarruselCards.tsx`: `basis` por breakpoint, avance por
      página, etiqueta con `aria-live`, vacío = no renderiza.

## T3 — Enganche
- [x] **T3.1** `MisAsignacionesModule`: extraer `renderCardEnReparto(orden, vista)` y usarla
      en las dos ramas.
- [x] **T3.2** Rama mosaico → `CarruselCards`; rama detalle intacta.

## T4 — Entorno de test
- [x] **T4.1** Stub de `IntersectionObserver` en `tests/setup/jest-dom.ts` (embla lo exige;
      sin él montar el carrusel lanza). **Medir** que no empeora otros archivos.

## T5 — Tests (trazabilidad R → test)

| R | Test |
|---|---|
| R1 | **PLANIFICADO, NUNCA ESCRITO** (ver T5.3, abierta) — `MisAsignacionesModule.test.tsx` › la vista arranca en mosaico y las cards siguen presentes y en orden (`MarcarLuegoToggle.test.tsx` › R19 sí verifica el orden dentro del carrusel) |
| R2 | **PLANIFICADO, NUNCA ESCRITO** (T5.3) — `MisAsignacionesModule.test.tsx` › la vista detalle conserva su lista |
| R3 | `MarcarLuegoToggle.test.tsx` › R19: el orden de las cards dentro del carrusel es el de ruta |
| R4 | `CarruselCards.test.tsx` › sin elementos no renderiza nada |
| R5 | `CarruselCards.test.tsx` › cada tarjeta lleva `basis-full sm:basis-1/2 lg:basis-1/3` |
| R6 | `CarruselCards.test.tsx` › el carrusel se configura con avance por página (`slidesToScroll: "auto"`) |
| R7 | `CarruselCards.test.tsx` › monta TODAS las tarjetas, no solo las visibles |
| R8 | `CarruselCards.test.tsx` › muestra la etiqueta de posición con el total real |
| R9 | `carrusel-rango.test.ts` › una sola visible se lee en singular |
| R10 | `carrusel-rango.test.ts` › varias visibles se leen como rango en plural |
| R11 | `carrusel-rango.test.ts` › la última página parcial muestra el rango real |
| R12 | `carrusel-rango.test.ts` › descarta índices fuera de rango |
| R13 | `carrusel-rango.test.ts` › sin información cae a la primera posición |
| R14 | `CarruselCards.test.tsx` › la etiqueta se anuncia con `aria-live="polite"` |
| R15 | `CarruselCards.test.tsx` › ofrece los controles de anterior y siguiente |
| R16 | `CarruselCards.test.tsx` › en la primera posición no se puede retroceder |
| R17 | `CarruselCards.test.tsx` › región con nombre accesible y diapositivas |
| R18 | `CarruselCards.test.tsx` › los controles no se posicionan fuera del contenedor |
| R19 | `CarruselCards.test.tsx` › se monta con elementos ajenos al dominio de órdenes |
| R20 | `CarruselCards.test.tsx` › permite sustituir el ancho por breakpoint |
| R21 | **PLANIFICADO, NUNCA ESCRITO** (T5.3) — `MisAsignacionesModule.test.tsx` › la card ofrece las mismas señales en las dos vistas |

<!-- @test-desaparecido MisAsignacionesModule.test.tsx: R1, R2 y R21 NUNCA llegaron a tener test.
     T5.3 se dejó bloqueada el 2026-07-31 (el archivo arrastraba 16 rojas ajenas) y el archivo se
     fue el 2026-08-03 con `369ccc4c`, que partió el módulo del mensajero en dos y renombró
     `MisAsignacionesModule.test.tsx` a `tests/components/RepartoModule.test.tsx`. Ese sucesor
     NO monta el conmutador ni el carrusel: hoy nadie afirma el aria-label «Órdenes en reparto»
     fuera de la fixture de `CarruselCards.test.tsx`. No se repunta la cita a `RepartoModule` ni a
     `RecogerModule.test.tsx` porque sería falsa: `RecogerModule` prueba las mismas tres conductas
     (arranca en mosaico dentro del carrusel / detalle vuelve a lista / vacío no monta carrusel)
     pero sobre «Por recoger», que estos requisitos dejan explícitamente FUERA de alcance. Lo que
     sí está probado es el compuesto (`CarruselCards.test.tsx`, R4-R8 y R14-R20) y que el enganche
     sigue vivo (`RepartoModule.tsx` monta `CarruselCards` con `ariaLabel="Órdenes en reparto"`).
     Queda sin prueba la integración en la superficie de esta feature: T5.3 sigue abierta. -->

- [x] **T5.1** `tests/unit/components/carrusel-rango.test.ts` (R9–R13).
- [x] **T5.2** `[P]` `tests/components/CarruselCards.test.tsx` (R4–R8, R14–R20).
- [ ] **T5.3** escribir R1, R2 y R21 sobre `tests/components/RepartoModule.test.tsx` (el archivo
      que hoy monta el módulo de "En reparto"). Se planificó sobre
      `tests/components/MisAsignacionesModule.test.tsx` y quedó **bloqueada** el 2026-07-31: ese
      archivo arrastraba 16 rojas AJENAS a esta feature (13 previas + 3 de los cambios sin
      commitear de `GestionarOrdenPanel`/`AsignacionDetalle` del 2026-07-30), y añadir casos ahí
      mezclaba señales. **Sigue sin hacerse**, y entretanto el archivo desapareció: `369ccc4c`
      (2026-08-03) partió el módulo y lo renombró a `RepartoModule.test.tsx`. El mismo commit
      llevó el carrusel a "Por recoger" y ESA superficie sí quedó cubierta
      (`tests/components/RecogerModule.test.tsx` › "conmutador mosaico/detalle y carrusel"),
      lo que da el molde exacto para escribir estos tres casos en Reparto.

## T6 — Verificación
- [x] **T6.1** `pnpm lint`: 0 errores. `pnpm typecheck`: limpio salvo los 2 errores previos de
      los `_Tmp*` sin commitear.
- [x] **T6.2** 19 tests propios verdes + **4 mutaciones a la aritmética de la etiqueta, las 4
      muertas**: siempre plural (3 rojos), no filtrar índices fuera de rango (1), devolver
      `null` sin visibilidad (2), rango 0-based (8).
- [x] **T6.3** Medido que el stub de `IntersectionObserver` no empeora la suite: en `Modal` +
      `MarcarLuegoToggle` pasa de 3 fallos a 1.
- [ ] **T6.4** EN PANTALLA, sin hacer: arrastre táctil y momentum, los cortes reales de
      breakpoint (redimensionar de 1 a 2 a 3), y que la etiqueta siga a la página al arrastrar.
      Los tests NO lo cubren: jsdom no mide anchos (design §4).
