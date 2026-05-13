import type Parser from 'tree-sitter';
import type { Lang } from '../discovery.js';

export interface CallEdge {
  caller: string;
  callee: string;
  file: string;
}

export function extractCallEdges(
  lang: Lang,
  relPath: string,
  _source: string,
  tree: Parser.Tree,
): CallEdge[] {
  const edges: CallEdge[] = [];

  function calleeName(callNode: Parser.SyntaxNode): string | null {
    const fn = callNode.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'member_expression' || fn.type === 'attribute') {
      const prop = fn.childForFieldName('property') ?? fn.childForFieldName('attribute');
      return prop?.text ?? null;
    }
    return null;
  }

  function visitFn(funcNode: Parser.SyntaxNode, caller: string): void {
    function walk(n: Parser.SyntaxNode): void {
      const isCall = lang === 'python' ? n.type === 'call' : n.type === 'call_expression';
      if (isCall) {
        const callee = calleeName(n);
        if (callee) edges.push({ caller, callee, file: relPath });
      }
      // Don't descend into nested functions — they're handled at top level.
      const isNestedFn =
        lang === 'python'
          ? n.type === 'function_definition' && n !== funcNode
          : (n.type === 'function_declaration' ||
              n.type === 'method_definition' ||
              n.type === 'arrow_function' ||
              n.type === 'function_expression') &&
            n !== funcNode;
      if (isNestedFn) return;
      for (const c of n.namedChildren) walk(c);
    }
    const body =
      lang === 'python'
        ? funcNode.childForFieldName('body')
        : (funcNode.childForFieldName('body') ?? funcNode);
    if (body) walk(body);
  }

  function visit(n: Parser.SyntaxNode): void {
    const isFn =
      lang === 'python'
        ? n.type === 'function_definition'
        : n.type === 'function_declaration' || n.type === 'method_definition';
    if (isFn) {
      const name = n.childForFieldName('name')?.text;
      if (name) {
        visitFn(n, name);
        return;
      }
    }
    for (const c of n.namedChildren) visit(c);
  }
  visit(tree.rootNode);
  return edges;
}
