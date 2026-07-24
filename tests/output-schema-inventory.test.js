/**
 * Exhaustive source inventory for the MCP outputSchema contract.
 *
 * The runtime fixture suite exercises representative handlers through the
 * registry/SDK dispatch path. This AST pass supplies the other half of the
 * invariant: it discovers every literal registerTool() declaration in src,
 * including audit, memory, intelligence, spatial prep, and server front-door
 * tools that a manually imported module list previously omitted.
 */
import { describe, expect, test } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function propertyNamed(node, name) {
  return (
    (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) &&
    node.text === name
  );
}

function hasOutputSchema(config) {
  return (
    ts.isObjectLiteralExpression(config) &&
    config.properties.some((property) =>
      ts.isPropertyAssignment(property) && propertyNamed(property.name, 'outputSchema'))
  );
}

function usesStructuredSuccessHelper(handler) {
  let found = false;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text.endsWith('Structured')
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(handler);
  return found;
}

function outputSchemaRegistrations() {
  const registrations = [];
  for (const file of sourceFiles(SRC)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'registerTool'
      ) {
        const [name, config, handler] = node.arguments;
        if (name && ts.isStringLiteral(name) && config && handler && hasOutputSchema(config)) {
          registrations.push({
            name: name.text,
            file: file.slice(ROOT.length + 1),
            structuredSuccess: usesStructuredSuccessHelper(handler),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return registrations;
}

describe('outputSchema source inventory', () => {
  test('discovers every literal SDK registration without duplicate public names', () => {
    const registrations = outputSchemaRegistrations();
    const names = registrations.map(({ name }) => name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    // A floor guards against the traversal silently breaking after a TS AST
    // upgrade; the exact count is intentionally not frozen as modules grow.
    expect(registrations.length).toBeGreaterThanOrEqual(100);
    expect(duplicates).toEqual([]);
  });

  test('every discovered outputSchema handler has a structured success path', () => {
    const missing = outputSchemaRegistrations()
      .filter(({ structuredSuccess }) => !structuredSuccess)
      .map(({ name, file }) => `${name} (${file})`);

    expect(missing).toEqual([]);
  });
});
