/**
 * Markora Offline Renderers Engine
 * 1. Multi-language Code Syntax Highlighter
 * 2. LaTeX to Native MathML Compiler (Zero-dependency, crisp vector math in WebKit/Chromium)
 * 3. Mermaid Diagram to Vector SVG Renderer (Flowcharts, Sequence Diagrams, State Diagrams)
 */

(function (global) {
  'use strict';

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ==========================================================================
   * 1. CODE SYNTAX HIGHLIGHTER
   * ========================================================================== */

  const KEYWORDS_COMMON = new Set([
    'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'default',
    'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw', 'throws',
    'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'as', 'from', 'import',
    'export', 'default', 'function', 'class', 'extends', 'implements', 'interface',
    'type', 'enum', 'struct', 'trait', 'impl', 'pub', 'priv', 'private', 'protected',
    'public', 'static', 'final', 'const', 'let', 'var', 'mut', 'fn', 'def', 'lambda',
    'async', 'await', 'yield', 'match', 'where', 'use', 'mod', 'package', 'namespace',
    'using', 'template', 'typename', 'virtual', 'override', 'go', 'defer', 'chan',
    'select', 'fallthrough', 'pass', 'with', 'assert', 'del', 'global', 'nonlocal',
    'module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'logic', 'always',
    'begin', 'end', 'posedge', 'negedge', 'assign', 'parameter', 'localparam'
  ]);

  const LITERALS_COMMON = new Set([
    'true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'self',
    'this', 'super', 'NaN', 'Infinity'
  ]);

  const TYPES_COMMON = new Set([
    'int', 'float', 'double', 'char', 'bool', 'boolean', 'string', 'String', 'void',
    'u8', 'u16', 'u32', 'u64', 'usize', 'i8', 'i16', 'i32', 'i64', 'isize', 'f32', 'f64',
    'str', 'Vec', 'Option', 'Result', 'Box', 'Rc', 'Arc', 'Map', 'Set', 'Array', 'Promise',
    'Object', 'Number', 'Boolean', 'Symbol', 'any', 'unknown', 'never', 'list', 'dict', 'tuple'
  ]);

  function highlightCode(code, lang) {
    const language = (lang || '').toLowerCase().trim();
    if (!code) return '';

    // Tokenize line by line or full text preserving comments & strings
    const tokenRegex = new RegExp(
      [
        // 1. Multi-line comments /* ... */ or <!-- ... -->
        '(\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->)',
        // 2. Single-line comments // ... or # ... (when not CSS hex color) or -- (SQL)
        '(\\/\\/[^\\n]*|#[^\\n]*)',
        // 3. Triple-quoted strings or template literals
        '("""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|`(?:\\\\[\\s\\S]|[^\\\\`])*`)',
        // 4. Double or single quoted strings
        '("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',
        // 5. Decorators / Macros / Annotations (@name, #[...])
        '(@[a-zA-Z_][a-zA-Z0-9_]*|#\\[[a-zA-Z0-9_:()=",\\s]+\\])',
        // 6. Numbers (hex, binary, floats, ints)
        '(\\b(?:0x[0-9a-fA-F_]+|0b[01_]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)',
        // 7. Identifiers
        '(\\b[a-zA-Z_$][a-zA-Z0-9_$]*\\b)(\\s*\\()?',
        // 8. Operators & punctuation
        '([+\\-*/%=<>!&|^~?:]+)'
      ].join('|'),
      'g'
    );

    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(code)) !== null) {
      if (match.index > lastIndex) {
        result += escapeHtml(code.slice(lastIndex, match.index));
      }

      const [
        fullMatch,
        blockComment,
        lineComment,
        multiString,
        singleString,
        decorator,
        numberLit,
        ident,
        funcCallParen,
        operator
      ] = match;

      if (blockComment || lineComment) {
        // Avoid treating #include in C/C++ as comment if desired, or style as directive/comment
        if (lineComment && /^#(include|define|ifdef|ifndef|endif|pragma)\b/.test(lineComment)) {
          result += `<span class="tok-meta">${escapeHtml(lineComment)}</span>`;
        } else {
          result += `<span class="tok-comment">${escapeHtml(fullMatch)}</span>`;
        }
      } else if (multiString || singleString) {
        result += `<span class="tok-string">${escapeHtml(fullMatch)}</span>`;
      } else if (decorator) {
        result += `<span class="tok-meta">${escapeHtml(decorator)}</span>`;
      } else if (numberLit) {
        result += `<span class="tok-number">${escapeHtml(numberLit)}</span>`;
      } else if (ident) {
        let cls = '';
        if (KEYWORDS_COMMON.has(ident)) {
          cls = 'tok-keyword';
        } else if (LITERALS_COMMON.has(ident)) {
          cls = 'tok-literal';
        } else if (TYPES_COMMON.has(ident) || /^[A-Z][a-zA-Z0-9_]*$/.test(ident)) {
          cls = 'tok-type';
        } else if (funcCallParen) {
          cls = 'tok-function';
        }

        if (cls) {
          result += `<span class="${cls}">${escapeHtml(ident)}</span>`;
        } else {
          result += escapeHtml(ident);
        }
        if (funcCallParen) {
          result += escapeHtml(funcCallParen);
        }
      } else if (operator) {
        result += `<span class="tok-operator">${escapeHtml(operator)}</span>`;
      } else {
        result += escapeHtml(fullMatch);
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < code.length) {
      result += escapeHtml(code.slice(lastIndex));
    }

    return result;
  }

  /* ==========================================================================
   * 2. LATEX TO NATIVE MATHML COMPILER
   * ========================================================================== */

  const LATEX_SYMBOLS = {
    // Lowercase Greek
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
    varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
    varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    // Uppercase Greek
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    // Operators & Relations
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', cdots: '⋯', ldots: '…',
    ddots: '⋱', vdots: '⋮', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
    oplus: '⊕', otimes: '⊗', odot: '⊙',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
    equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆',
    supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬', land: '∧', lor: '∨',
    nabla: '∇', partial: '∂', infty: '∞', aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ',
    Re: 'ℜ', Im: 'ℑ', wp: '℘',
    to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
    leftrightarrow: '↔', Leftrightarrow: '⇔', iff: '⟺', implies: '⟹',
    mapsto: '↦', uparrow: '↑', downarrow: '↓',
    // Big Operators
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
    bigcup: '⋃',bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
    // Delimiters
    langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
    '|': '‖', vert: '|', Vert: '‖'
  };

  const BIG_OPERATORS = new Set([
    'sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint',
    'bigcup', 'bigcap', 'bigoplus', 'bigotimes', 'lim', 'max', 'min', 'sup', 'inf', 'det'
  ]);

  const NAMED_FUNCTIONS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
    'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'lim', 'max', 'min', 'sup',
    'inf', 'det', 'dim', 'ker', 'hom', 'arg', 'deg', 'gcd', 'Pr'
  ]);

  function renderLatexToMathML(latex, displayMode = false) {
    const src = String(latex || '').trim();
    if (!src) return '';

    let pos = 0;

    function peek() {
      return src[pos] || '';
    }

    function skipWhitespace() {
      while (pos < src.length && /\s/.test(src[pos])) {
        pos++;
      }
    }

    function readGroup() {
      skipWhitespace();
      if (src[pos] === '{') {
        pos++; // skip '{'
        let depth = 1;
        let start = pos;
        while (pos < src.length && depth > 0) {
          if (src[pos] === '\\') {
            pos += 2;
            continue;
          }
          if (src[pos] === '{') depth++;
          else if (src[pos] === '}') depth--;
          pos++;
        }
        return src.slice(start, pos - 1);
      } else {
        return readSingleAtomRaw();
      }
    }

    function readSingleAtomRaw() {
      skipWhitespace();
      if (pos >= src.length) return '';
      if (src[pos] === '\\') {
        let start = pos;
        pos++;
        if (pos < src.length && /[a-zA-Z]/.test(src[pos])) {
          while (pos < src.length && /[a-zA-Z]/.test(src[pos])) pos++;
        } else if (pos < src.length) {
          pos++;
        }
        return src.slice(start, pos);
      }
      return src[pos++];
    }

    function readBracketArg() {
      skipWhitespace();
      if (src[pos] !== '[') return null;
      pos++;
      let start = pos;
      let depth = 1;
      while (pos < src.length && depth > 0) {
        if (src[pos] === '[') depth++;
        else if (src[pos] === ']') depth--;
        pos++;
      }
      return src.slice(start, pos - 1);
    }

    function parseAtom() {
      skipWhitespace();
      if (pos >= src.length) return null;

      const ch = src[pos];
      if (ch === '}' || ch === '&') return null;

      if (ch === '{') {
        const groupContent = readGroup();
        return {
          type: 'group',
          html: `<mrow>${parseSubExpression(groupContent)}</mrow>`
        };
      }

      if (ch === '\\') {
        pos++;
        if (pos >= src.length) return null;

        // Check escaped symbol like \{, \}, \, \; \! \quad \\
        if (!/[a-zA-Z]/.test(src[pos])) {
          const sym = src[pos++];
          if (sym === ',' || sym === ';' || sym === ':') {
            return { type: 'space', html: '<mspace width="0.22em"/>' };
          }
          if (sym === '!') {
            return { type: 'space', html: '' };
          }
          if (sym === '{' || sym === '}') {
            return { type: 'mo', html: `<mo>${sym}</mo>` };
          }
          if (sym === '|') {
            return { type: 'mo', html: '<mo>‖</mo>' };
          }
          return { type: 'mo', html: `<mo>${escapeHtml(sym)}</mo>` };
        }

        let cmd = '';
        while (pos < src.length && /[a-zA-Z]/.test(src[pos])) {
          cmd += src[pos++];
        }

        if (cmd === 'left' || cmd === 'right') {
          skipWhitespace();
          let delim = '';
          if (src[pos] === '\\') {
            pos++;
            if (src.slice(pos, pos + 6) === 'langle') { delim = '⟨'; pos += 6; }
            else if (src.slice(pos, pos + 6) === 'rangle') { delim = '⟩'; pos += 6; }
            else if (src[pos] === '{' || src[pos] === '}' || src[pos] === '|') {
              delim = src[pos] === '|' ? '‖' : src[pos];
              pos++;
            } else {
              delim = src[pos++] || '';
            }
          } else if (pos < src.length) {
            delim = src[pos++];
          }
          if (delim === '.') return { type: 'empty', html: '' };
          return { type: 'mo', html: `<mo stretchy="true">${escapeHtml(delim)}</mo>` };
        }

        if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
          const num = readGroup();
          const den = readGroup();
          return {
            type: 'frac',
            html: `<mfrac><mrow>${parseSubExpression(num)}</mrow><mrow>${parseSubExpression(den)}</mrow></mfrac>`
          };
        }

        if (cmd === 'sqrt') {
          const rootIndex = readBracketArg();
          const radicand = readGroup();
          if (rootIndex) {
            return {
              type: 'sqrt',
              html: `<mroot><mrow>${parseSubExpression(radicand)}</mrow><mrow>${parseSubExpression(rootIndex)}</mrow></mroot>`
            };
          }
          return {
            type: 'sqrt',
            html: `<msqrt><mrow>${parseSubExpression(radicand)}</mrow></msqrt>`
          };
        }

        if (cmd === 'hat' || cmd === 'bar' || cmd === 'vec' || cmd === 'tilde' || cmd === 'dot' || cmd === 'overline') {
          const base = readGroup();
          const accentMap = { hat: '^', bar: '¯', overline: '¯', vec: '→', tilde: '~', dot: '˙' };
          return {
            type: 'accent',
            html: `<mover accent="true"><mrow>${parseSubExpression(base)}</mrow><mo>${accentMap[cmd] || '^'}</mo></mover>`
          };
        }

        if (cmd === 'text' || cmd === 'textrm' || cmd === 'mbox') {
          const txt = readGroup();
          return { type: 'mtext', html: `<mtext>${escapeHtml(txt)}</mtext>` };
        }

        if (cmd === 'mathbf' || cmd === 'boldsymbol' || cmd === 'bm') {
          const content = readGroup();
          return { type: 'style', html: `<mstyle mathvariant="bold">${parseSubExpression(content)}</mstyle>` };
        }

        if (cmd === 'mathbb') {
          const content = readGroup().trim();
          const bbMap = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', E: '𝔼', P: 'ℙ' };
          return { type: 'mi', html: `<mi>${bbMap[content] || escapeHtml(content)}</mi>` };
        }

        if (cmd === 'mathcal') {
          const content = readGroup().trim();
          return { type: 'mi', html: `<mi mathvariant="script">${escapeHtml(content)}</mi>` };
        }

        if (cmd === 'mathrm' || cmd === 'operatorname') {
          const content = readGroup();
          return { type: 'mi', html: `<mi mathvariant="normal">${escapeHtml(content)}</mi>` };
        }

        if (cmd === 'quad') {
          return { type: 'space', html: '<mspace width="1em"/>' };
        }
        if (cmd === 'qquad') {
          return { type: 'space', html: '<mspace width="2em"/>' };
        }

        if (cmd === 'begin') {
          const envName = readGroup().trim();
          const endTag = `\\end{${envName}}`;
          const endIdx = src.indexOf(endTag, pos);
          let body = '';
          if (endIdx !== -1) {
            body = src.slice(pos, endIdx);
            pos = endIdx + endTag.length;
          } else {
            body = src.slice(pos);
            pos = src.length;
          }
          return {
            type: 'env',
            html: renderMatrixOrEnv(envName, body)
          };
        }

        if (BIG_OPERATORS.has(cmd)) {
          const sym = LATEX_SYMBOLS[cmd] || cmd;
          const tag = LATEX_SYMBOLS[cmd] ? 'mo' : 'mi';
          return {
            type: 'bigop',
            isBigOp: true,
            html: `<${tag} movablelimits="${!displayMode}">${escapeHtml(sym)}</${tag}>`
          };
        }

        if (NAMED_FUNCTIONS.has(cmd)) {
          return {
            type: 'func',
            html: `<mi mathvariant="normal">${escapeHtml(cmd)}</mi>`
          };
        }

        if (LATEX_SYMBOLS[cmd]) {
          const sym = LATEX_SYMBOLS[cmd];
          const isIdent = /^[α-ωΑ-Ωℵℏℓℜℑ℘]$/.test(sym);
          return {
            type: isIdent ? 'mi' : 'mo',
            html: `<${isIdent ? 'mi' : 'mo'}>${sym}</${isIdent ? 'mi' : 'mo'}>`
          };
        }

        return { type: 'mi', html: `<mi>${escapeHtml(cmd)}</mi>` };
      }

      // Numbers
      if (/[0-9]/.test(ch)) {
        let num = '';
        while (pos < src.length && /[0-9.]/.test(src[pos])) {
          num += src[pos++];
        }
        return { type: 'mn', html: `<mn>${escapeHtml(num)}</mn>` };
      }

      // Variables / letters
      if (/[a-zA-Z]/.test(ch)) {
        pos++;
        return { type: 'mi', html: `<mi>${escapeHtml(ch)}</mi>` };
      }

      // Operators / Punctuation
      pos++;
      const opMap = { '-': '−', '*': '∗', '\'': '′' };
      return {
        type: 'mo',
        html: `<mo>${escapeHtml(opMap[ch] || ch)}</mo>`
      };
    }

    function parseExpression() {
      let out = '';
      while (pos < src.length) {
        skipWhitespace();
        if (pos >= src.length || src[pos] === '}') break;

        let atom = parseAtom();
        if (!atom) break;

        // Check for subscripts (_) and superscripts (^)
        skipWhitespace();
        let sub = null;
        let sup = null;

        while (pos < src.length && (src[pos] === '_' || src[pos] === '^')) {
          const kind = src[pos++];
          const scriptContent = readGroup();
          const renderedScript = `<mrow>${parseSubExpression(scriptContent)}</mrow>`;
          if (kind === '_') sub = renderedScript;
          else sup = renderedScript;
          skipWhitespace();
        }

        if (sub && sup) {
          if (atom.isBigOp && displayMode) {
            out += `<munderover>${atom.html}${sub}${sup}</munderover>`;
          } else {
            out += `<msubsup>${atom.html}${sub}${sup}</msubsup>`;
          }
        } else if (sub) {
          if (atom.isBigOp && displayMode) {
            out += `<munder>${atom.html}${sub}</munder>`;
          } else {
            out += `<msub>${atom.html}${sub}</msub>`;
          }
        } else if (sup) {
          if (atom.isBigOp && displayMode) {
            out += `<mover>${atom.html}${sup}</mover>`;
          } else {
            out += `<msup>${atom.html}${sup}</msup>`;
          }
        } else {
          out += atom.html;
        }
      }
      return out;
    }

    function parseSubExpression(subLatex) {
      return renderLatexInner(subLatex, displayMode);
    }

    return parseExpression();
  }

  function renderMatrixOrEnv(envName, body) {
    const rows = body
      .trim()
      .split(/\\\\/)
      .map(r => r.trim())
      .filter(Boolean);

    const tableRows = rows
      .map(row => {
        const cells = row.split('&').map(cell => {
          return `<mtd><mrow>${renderLatexInner(cell.trim(), true)}</mrow></mtd>`;
        });
        return `<mtr>${cells.join('')}</mtr>`;
      })
      .join('');

    const mtable = `<mtable rowspacing="0.4em" columnspacing="0.8em">${tableRows}</mtable>`;

    if (envName === 'pmatrix') {
      return `<mrow><mo stretchy="true">(</mo>${mtable}<mo stretchy="true">)</mo></mrow>`;
    }
    if (envName === 'bmatrix') {
      return `<mrow><mo stretchy="true">[</mo>${mtable}<mo stretchy="true">]</mo></mrow>`;
    }
    if (envName === 'Bmatrix') {
      return `<mrow><mo stretchy="true">{</mo>${mtable}<mo stretchy="true">}</mo></mrow>`;
    }
    if (envName === 'vmatrix') {
      return `<mrow><mo stretchy="true">|</mo>${mtable}<mo stretchy="true">|</mo></mrow>`;
    }
    if (envName === 'Vmatrix') {
      return `<mrow><mo stretchy="true">‖</mo>${mtable}<mo stretchy="true">‖</mo></mrow>`;
    }
    if (envName === 'cases') {
      return `<mrow><mo stretchy="true">{</mo>${mtable}</mrow>`;
    }
    return `<mrow>${mtable}</mrow>`;
  }

  function renderLatexInner(latex, displayMode) {
    return renderLatexToMathML(latex, displayMode);
  }

  function renderMath(latex, displayMode = false) {
    try {
      const inner = renderLatexToMathML(latex, displayMode);
      const displayAttr = displayMode ? ' display="block"' : ' display="inline"';
      return `<math xmlns="http://www.w3.org/1998/Math/MathML"${displayAttr}><mrow>${inner}</mrow></math>`;
    } catch (e) {
      return `<code class="math-error">${escapeHtml(latex)}</code>`;
    }
  }

  /* ==========================================================================
   * 3. MERMAID DIAGRAM VECTOR SVG ENGINE
   * ========================================================================== */

  function renderMermaidToSVG(code) {
    const rawLines = String(code || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('%%'));

    if (rawLines.length === 0) {
      return '<div class="mermaid-empty">空图表（点击编辑 Mermaid 源码）</div>';
    }

    const header = rawLines[0];
    if (/^sequenceDiagram\b/i.test(header)) {
      return renderSequenceDiagram(rawLines.slice(1));
    }
    if (/^stateDiagram(-v2)?\b/i.test(header)) {
      return renderFlowchartDiagram(rawLines.slice(1), 'TD', true);
    }
    const flowMatch = header.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)?/i);
    if (flowMatch) {
      const dir = (flowMatch[1] || 'TD').toUpperCase();
      return renderFlowchartDiagram(rawLines.slice(1), dir, false);
    }

    // Default fallback: try flowchart
    return renderFlowchartDiagram(rawLines, 'LR', false);
  }

  function parseNodeToken(rawToken) {
    const token = rawToken.trim();
    if (token === '[*]') {
      return { id: '__start_end__', label: '●', shape: 'circle' };
    }
    // Match ID and optional shape wrapper
    // Shapes: id["label"], id("label"), id{"label"}, id(["label"]), id(("label"))
    const m = token.match(/^([a-zA-Z0-9_.\u4e00-\u9fa5-]+)\s*(?:\(\((.+)\)\)|\(\[(.+)\]\)|\[(.+)\]|\((.+)\)|\{(.+)\})?$/);
    if (!m) {
      const clean = token.replace(/^["']|["']$/g, '');
      return { id: clean, label: clean, shape: 'rect' };
    }
    const id = m[1];
    let label = id;
    let shape = 'rect';
    if (m[2] !== undefined) {
      label = m[2];
      shape = 'circle';
    } else if (m[3] !== undefined) {
      label = m[3];
      shape = 'stadium';
    } else if (m[4] !== undefined) {
      label = m[4];
      shape = 'rect';
    } else if (m[5] !== undefined) {
      label = m[5];
      shape = 'round';
    } else if (m[6] !== undefined) {
      label = m[6];
      shape = 'diamond';
    } else {
      shape = 'round';
    }
    label = label.trim().replace(/^["']|["']$/g, '');
    return { id, label, shape };
  }

  function measureTextWidth(text) {
    let w = 0;
    for (const ch of String(text)) {
      w += ch.charCodeAt(0) > 255 ? 15 : 8.5;
    }
    return Math.max(w, 28);
  }

  function renderFlowchartDiagram(lines, direction = 'LR', isState = false) {
    const nodes = new Map();
    const edges = [];

    function ensureNode(parsed) {
      if (!nodes.has(parsed.id)) {
        nodes.set(parsed.id, {
          id: parsed.id,
          label: parsed.label,
          shape: parsed.shape,
          rank: 0
        });
      } else {
        const existing = nodes.get(parsed.id);
        if (parsed.label !== parsed.id) {
          existing.label = parsed.label;
          existing.shape = parsed.shape;
        }
      }
      return nodes.get(parsed.id);
    }

    for (const line of lines) {
      if (/^(subgraph|end|direction|style|classDef|class)\b/i.test(line)) continue;

      // Parse edges like: A["Label"] -->|edgeLabel| B{"Label"} or A --> B : label
      const edgeRegex = /^(.+?)\s*(-->|-\.->|==>|--\s+[^-]+\s+-->)\s*(?:\|([^|]+)\|\s*)?(.+)$/;
      const m = line.match(edgeRegex);
      if (m) {
        const leftRaw = m[1].trim();
        const arrowRaw = m[2].trim();
        let edgeLabel = (m[3] || '').trim();
        let rightRaw = m[4].trim();

        // Check state diagram `: label` suffix
        if (isState && rightRaw.includes(':')) {
          const parts = rightRaw.split(':');
          rightRaw = parts[0].trim();
          edgeLabel = parts.slice(1).join(':').trim();
        }

        // Check inline `-- label -->`
        const inlineLabelMatch = arrowRaw.match(/^--\s+(.+?)\s+-->$/);
        if (inlineLabelMatch) {
          edgeLabel = inlineLabelMatch[1].trim();
        }

        const fromNode = ensureNode(parseNodeToken(leftRaw));
        const toNode = ensureNode(parseNodeToken(rightRaw));
        edges.push({
          from: fromNode.id,
          to: toNode.id,
          label: edgeLabel.replace(/^["']|["']$/g, ''),
          dashed: arrowRaw.includes('.'),
          thick: arrowRaw.includes('=')
        });
      } else {
        const single = parseNodeToken(line);
        if (single.id) ensureNode(single);
      }
    }

    if (nodes.size === 0) {
      return '<div class="mermaid-empty">未能解析图表节点</div>';
    }

    // Compute ranks via longest-path BFS
    const inDegree = new Map();
    const adj = new Map();
    for (const id of nodes.keys()) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }
    for (const e of edges) {
      adj.get(e.from)?.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    }

    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }
    if (queue.length === 0) {
      queue.push(nodes.keys().next().value);
    }

    const visited = new Set();
    while (queue.length > 0) {
      const curr = queue.shift();
      visited.add(curr);
      const currRank = nodes.get(curr).rank;
      for (const nextId of adj.get(curr) || []) {
        const nextNode = nodes.get(nextId);
        if (nextNode && nextNode.rank < currRank + 1 && !visited.has(nextId)) {
          nextNode.rank = currRank + 1;
        }
        if (!visited.has(nextId) && !queue.includes(nextId)) {
          queue.push(nextId);
        }
      }
    }

    // Group by rank
    const layers = new Map();
    let maxRank = 0;
    for (const node of nodes.values()) {
      const r = node.rank;
      if (r > maxRank) maxRank = r;
      if (!layers.has(r)) layers.set(r, []);
      layers.get(r).push(node);
    }

    const isHorizontal = direction === 'LR' || direction === 'RL';

    // Compute node sizes
    for (const node of nodes.values()) {
      const textW = measureTextWidth(node.label);
      node.w = Math.max(textW + 36, node.shape === 'diamond' ? 120 : 96);
      node.h = node.shape === 'diamond' ? 60 : 44;
    }

    const rankGap = isHorizontal ? 175 : 105;
    const siblingGap = isHorizontal ? 76 : 165;
    const padding = 36;

    let maxCrossCount = 1;
    for (const arr of layers.values()) {
      if (arr.length > maxCrossCount) maxCrossCount = arr.length;
    }

    const totalMain = (maxRank + 1) * rankGap + padding * 2;
    const totalCross = Math.max(maxCrossCount * siblingGap + padding * 2, 180);

    const svgWidth = isHorizontal ? Math.max(totalMain, 380) : Math.max(totalCross, 380);
    const svgHeight = isHorizontal ? Math.max(totalCross, 160) : Math.max(totalMain, 180);

    // Assign coordinates
    for (let r = 0; r <= maxRank; r++) {
      const group = layers.get(r) || [];
      const count = group.length;
      group.forEach((node, idx) => {
        const mainPos = padding + 65 + r * rankGap;
        const crossSpan = (count - 1) * siblingGap;
        const crossStart = (isHorizontal ? svgHeight : svgWidth) / 2 - crossSpan / 2;
        const crossPos = crossStart + idx * siblingGap;

        if (isHorizontal) {
          node.cx = mainPos;
          node.cy = crossPos;
        } else {
          node.cx = crossPos;
          node.cy = mainPos;
        }
      });
    }

    // Render edges
    let edgesSvg = '';
    edges.forEach(edge => {
      const a = nodes.get(edge.from);
      const b = nodes.get(edge.to);
      if (!a || !b) return;

      let x1 = a.cx, y1 = a.cy, x2 = b.cx, y2 = b.cy;
      if (isHorizontal) {
        x1 = a.cx + a.w / 2;
        x2 = b.cx - b.w / 2 - 4;
      } else {
        y1 = a.cy + a.h / 2;
        y2 = b.cy - b.h / 2 - 4;
      }

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const d = isHorizontal
        ? `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
        : `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;

      const dashAttr = edge.dashed ? ' stroke-dasharray="5,4"' : '';
      const strokeW = edge.thick ? '2.5' : '1.75';

      edgesSvg += `<path d="${d}" fill="none" class="mermaid-edge" stroke-width="${strokeW}"${dashAttr} marker-end="url(#mk-arrow)" />`;

      if (edge.label) {
        const lw = measureTextWidth(edge.label) + 14;
        edgesSvg += `
          <g transform="translate(${mx}, ${my})">
            <rect x="${-lw / 2}" y="-11" width="${lw}" height="22" rx="6" class="mermaid-edge-bg" />
            <text x="0" y="4" text-anchor="middle" class="mermaid-edge-text">${escapeHtml(edge.label)}</text>
          </g>
        `;
      }
    });

    // Render nodes
    let nodesSvg = '';
    for (const node of nodes.values()) {
      const { cx, cy, w, h, label, shape } = node;
      const x = cx - w / 2;
      const y = cy - h / 2;
      let shapeEl = '';

      if (shape === 'diamond') {
        const pts = `${cx},${cy - h / 2 - 4} ${cx + w / 2 + 6},${cy} ${cx},${cy + h / 2 + 4} ${cx - w / 2 - 6},${cy}`;
        shapeEl = `<polygon points="${pts}" class="mermaid-node mermaid-node-diamond" />`;
      } else if (shape === 'circle') {
        const r = Math.max(h / 2, 18);
        shapeEl = `<circle cx="${cx}" cy="${cy}" r="${r}" class="mermaid-node" />`;
      } else if (shape === 'stadium') {
        shapeEl = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" class="mermaid-node" />`;
      } else if (shape === 'round') {
        shapeEl = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="mermaid-node" />`;
      } else {
        shapeEl = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" class="mermaid-node" />`;
      }

      nodesSvg += `
        <g class="mermaid-node-group">
          ${shapeEl}
          <text x="${cx}" y="${cy + 5}" text-anchor="middle" class="mermaid-node-text">${escapeHtml(label)}</text>
        </g>
      `;
    }

    return `
      <svg class="mermaid-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" style="max-width:${svgWidth}px;">
        <defs>
          <marker id="mk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" class="mermaid-arrow-head" />
          </marker>
        </defs>
        ${edgesSvg}
        ${nodesSvg}
      </svg>
    `;
  }

  function renderSequenceDiagram(lines) {
    const participants = new Map();
    const messages = [];

    function ensureParticipant(id, label) {
      if (!participants.has(id)) {
        participants.set(id, { id, label: label || id });
      } else if (label) {
        participants.get(id).label = label;
      }
    }

    for (const line of lines) {
      const partMatch = line.match(/^(?:participant|actor)\s+([a-zA-Z0-9_\u4e00-\u9fa5-]+)(?:\s+as\s+(.+))?$/i);
      if (partMatch) {
        ensureParticipant(partMatch[1].trim(), (partMatch[2] || partMatch[1]).trim().replace(/^["']|["']$/g, ''));
        continue;
      }

      const msgMatch = line.match(/^([a-zA-Z0-9_\u4e00-\u9fa5-]+)\s*(-->>|->>|-->|->)\s*([a-zA-Z0-9_\u4e00-\u9fa5-]+)\s*:\s*(.+)$/);
      if (msgMatch) {
        const from = msgMatch[1].trim();
        const arrow = msgMatch[2].trim();
        const to = msgMatch[3].trim();
        const text = msgMatch[4].trim();
        ensureParticipant(from);
        ensureParticipant(to);
        messages.push({
          from,
          to,
          text,
          dashed: arrow.startsWith('--')
        });
      }
    }

    const partList = Array.from(participants.values());
    if (partList.length === 0) {
      return '<div class="mermaid-empty">未能解析时序图参与者</div>';
    }

    const colSpacing = 175;
    const padX = 95;
    const topY = 38;
    const rowHeight = 52;

    partList.forEach((p, idx) => {
      p.cx = padX + idx * colSpacing;
      p.w = Math.max(measureTextWidth(p.label) + 28, 108);
    });

    const totalWidth = Math.max(padX * 2 + (partList.length - 1) * colSpacing, 380);
    const bottomY = topY + 46 + messages.length * rowHeight + 22;
    const totalHeight = bottomY + 50;

    let lifelinesSvg = '';
    let boxesSvg = '';
    for (const p of partList) {
      lifelinesSvg += `<line x1="${p.cx}" y1="${topY + 36}" x2="${p.cx}" y2="${bottomY}" class="mermaid-lifeline" stroke-dasharray="5,5" />`;
      boxesSvg += `
        <rect x="${p.cx - p.w / 2}" y="${topY}" width="${p.w}" height="36" rx="7" class="mermaid-node" />
        <text x="${p.cx}" y="${topY + 23}" text-anchor="middle" class="mermaid-node-text">${escapeHtml(p.label)}</text>
        <rect x="${p.cx - p.w / 2}" y="${bottomY}" width="${p.w}" height="36" rx="7" class="mermaid-node" />
        <text x="${p.cx}" y="${bottomY + 23}" text-anchor="middle" class="mermaid-node-text">${escapeHtml(p.label)}</text>
      `;
    }

    let msgsSvg = '';
    messages.forEach((m, i) => {
      const pFrom = participants.get(m.from);
      const pTo = participants.get(m.to);
      if (!pFrom || !pTo) return;
      const y = topY + 72 + i * rowHeight;
      const x1 = pFrom.cx;
      const x2 = pTo.cx + (pFrom.cx < pTo.cx ? -6 : 6);
      const midX = (x1 + x2) / 2;
      const dash = m.dashed ? ' stroke-dasharray="5,4"' : '';

      msgsSvg += `
        <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="mermaid-edge" stroke-width="1.75"${dash} marker-end="url(#mk-seq-arrow)" />
        <text x="${midX}" y="${y - 8}" text-anchor="middle" class="mermaid-edge-text">${escapeHtml(m.text)}</text>
      `;
    });

    return `
      <svg class="mermaid-svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" style="max-width:${totalWidth}px;">
        <defs>
          <marker id="mk-seq-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" class="mermaid-arrow-head" />
          </marker>
        </defs>
        ${lifelinesSvg}
        ${msgsSvg}
        ${boxesSvg}
      </svg>
    `;
  }

  global.MarkoraRenderers = {
    escapeHtml,
    highlightCode,
    renderMath,
    renderMermaidToSVG
  };
})(window);
