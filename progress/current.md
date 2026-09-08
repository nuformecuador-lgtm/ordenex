# Estado de la sesión — 2026-09-08

## Desplegado en producción y verificado

**Release #733** (`7f6455c7`) y **release #735** (`1d2e6c4e`), las dos READY y con
los errores de runtime comprobados: solo el `DeprecationWarning` de `pg`,
preexistente desde el 2026-07-27 y asociado al despliegue anterior. Cero errores
nuevos.

Fichas dentro: **376, 377, 382, 383, 384, 385, 387, 388, 390, 391**.
La **378** y la **389** se cancelaron por decisión del humano.

## En curso

| Ficha | Zona | Dónde está |
|---|---|---|
| **379** | fullstack | servidor mergeado (PR #736). Pantalla en curso: T9, T11, T13. |
| **393** | fullstack | servidor mergeado (PR #737). Pantalla en curso: F1–F7, G1–G3. |

Las dos ocupan el cupo de `fullstack`, que está a tope.

## En cola, y por qué esperan

- **386** (filtrar cierres por estado) y **392** (validar nombre de tienda y
  geografía) — listas, esperan hueco de `fullstack`.
- **381** (cargar un costo a una tienda) — **va sola**: lleva dos migraciones y
  la base local es compartida entre worktrees.
- **380** (rastro del pago al mensajero) — spec firmado, 18 requisitos.
  **Va sola y detrás de la 381**, por lo mismo.

## Deuda escrita que hay que recoger

- **379:** `lib/actions/usuarios.ts` lleva una anotación `@sin-superficie` que
  **caduca** en cuanto `UsuariosModule` llame a la acción; la guardia de
  superficie de uso exige quitarla entonces.
- **393:** falta re-exportar trece constantes desde `cierre-detalle-shared.tsx`;
  y F7 se quedó sin trabajo — los cinco `aria-label` que iba a retirar no los
  sujeta ningún test.
- **383:** siguen sin firma A1, A2, A3, A4, A5, A6 y Q3/Q4/Q5. La firma de Q1
  **no** arrastra a A2, que es la corrección manual rechazando en vez de
  reparar — al revés que la carga masiva.

## Preguntas abiertas al humano, no bloqueantes

- Los «intentos» del Excel de cierres: ¿son los de la tienda o los del mensajero?
  Si son los del mensajero, es una columna más.
- La **A2** de la 383, arriba.

## Lo firmado hoy que cambia el diseño de la 380

- **Q1 a favor:** tipo nuevo `zona_pago_mensajero_cambiado`, con migración.
- **Q2 en contra de la recomendación del leader:** solo el hecho, sin importes.
  El historial **nunca podrá reconstruir de cuánto a cuánto**. Límite aceptado.
- **Q3 en contra de la recomendación del leader:** solo la edición. Y la firma
  resultó tener mejor precedente que el consejo: el catálogo ya es asimétrico a
  propósito (`zona_borrada` sin `zona_creada`), con el motivo escrito en
  `lib/types/historial-accion.ts`.
