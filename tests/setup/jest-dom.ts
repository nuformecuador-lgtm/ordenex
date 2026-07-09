// Registra los matchers de @testing-library/jest-dom (toBeInTheDocument,
// toHaveAttribute, etc.) para todos los archivos de test. Es un no-op
// inocuo en los tests que corren en entorno "node" (backend), y necesario
// para los tests de componente que corren en "jsdom".
import "@testing-library/jest-dom/vitest";
