# UML Class Diagram Generator (React)

An interactive web app where you draw UML class diagrams and it generates the matching Java source code.

## Run

```bash
npm install
npm run dev      # opens http://localhost:5173
npm run build    # production build in dist/
```

## Features

- **Visual editor**: add classes, abstract classes and interfaces; drag them around the canvas (snaps to a grid).
- **Members**: attributes and methods with visibility (`+ - # ~`), types, parameters, and static / final / abstract flags.
- **Relationships** (standard UML notation):
  | Type | Notation | Java output |
  |------|----------|-------------|
  | Inheritance | solid line, hollow triangle | `extends` |
  | Realization | dashed line, hollow triangle | `implements` |
  | Association | solid line, open arrow | field of the target type |
  | Aggregation | hollow diamond | field (`List<T>` when multiplicity is `*` / `1..*`) |
  | Composition | filled diamond | field (`List<T>` when multiplicity is `*` / `1..*`) |
  | Dependency | dashed line, open arrow | no field |
- **Java generation**: package, imports, fields, a no-arg and a full constructor (calling `super(...)` with the parent's fields), getters/setters, `addX()` for collections, method stubs, and `@Override` stubs for abstract or interface methods the class still has to implement.
- **Validation**: invalid names, duplicate classes, multiple inheritance, a class implementing a non-interface, abstract methods in a concrete class, inheritance cycles.
- **Export**: copy the code, download a single `.java` file, or download every class as a `.zip` in its package folders. The diagram can be saved and loaded as JSON, and it autosaves in the browser.

## Structure

```
src/
  App.jsx      canvas, toolbar, property editors, code panel
  javaGen.js   UML model -> Java source, plus validation
  sample.js    sample diagram (Company / Department / Employee / Payable ...)
  App.css      styles
```
