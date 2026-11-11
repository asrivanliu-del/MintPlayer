# Project Guidelines

## Required Change Workflow

For every code change:

1. Inspect the existing implementation and related behavior; compare suitable approaches and choose the simplest reliable option before editing.
2. Implement the change using existing project patterns and keep unrelated behavior untouched.
3. Add or update unit tests for the changed behavior and important edge cases.
4. Test the changed behavior and related existing behavior for regressions. For UI or Electron changes, run a smoke test of the affected flow when practical; do not treat a successful build as proof of runtime behavior.
5. Run the relevant tests, then the full unit-test suite and project checks (`npx tsc --noEmit -p tsconfig.json`, `npm run tsc:main`, and `npx vite build`). Report any checks that could not be run.

## Testing

- Run all unit tests with `npm test`; use `npm run test:watch` while iterating.
- Keep tests in the root `tests/` directory, grouped into `tests/unit/` and `tests/components/`; do not colocate test files in `src/`.
- Test user-facing controls through accessible roles/names and verify rendered state changes. Unit/component tests do not replace browser/Electron end-to-end or visual layout checks.
- Keep pure logic independently testable and cover success, invalid input, and boundary cases where applicable.
