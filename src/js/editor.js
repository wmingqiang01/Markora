/**
 * Markora WYSIWYG & Markdown AST Engine
 * Provides:
 * - Bidirectional Markdown <-> Block AST parsing & serialization
 * - Typora-style Hybrid Inline & Block WYSIWYG rendering
 * - Live prefix triggers (# , > , - , 1. , - [ ] , ```, $$, ---, /)
 * - Interactive Code Blocks, MathML Blocks, Mermaid SVG Blocks, and Tables
 */

(function (global) {
  'use strict';

  const { escapeHtml, highlightCode, renderMath, renderMermaidToSVG } = global.MarkoraRenderers;

  let blockIdSeq = 1;
  function nextBlockId() {
    return 'blk_' + (blockIdSeq++);
  }

  let documentBaseDir = '';

  function setDocumentBaseDir(dirPath) {
    documentBaseDir = String(dirPath || '').replace(/\/+$/, '');
  }

  function normalizePosixPath(fullPath) {
    const parts = String(fullPath || '').split('/');
    const stack = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        stack.pop();
      } else {
        stack.push(part);
      }
    }
    return '/' + stack.join('/');
  }

  function resolveAssetUrl(rawSrc) {
    const src = String(rawSrc || '').trim();
    if (!src) return '';
    if (/^(https?:|data:|blob:|file:)/i.test(src)) {
      return src;
    }
    if (src.startsWith('/')) {
      if (src.startsWith('/workspace/')) return src;
      const encoded = src
        .split('/')
        .map(seg => {
          try {
            return encodeURIComponent(decodeURIComponent(seg));
          } catch (e) {
            return encodeURIComponent(seg);
          }
        })
        .join('/');
      return 'file://' + encoded;
    }
    if (!documentBaseDir || documentBaseDir === '/workspace') {
      return src;
    }
    const combined = normalizePosixPath(documentBaseDir + '/' + src);
    const encoded = combined
      .split('/')
      .map(seg => {
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch (e) {
          return encodeURIComponent(seg);
        }
      })
      .join('/');
    return 'file://' + encoded;
  }

  /* ==========================================================================
   * 1. MARKDOWN TO BLOCK AST PARSER
   * ========================================================================== */

  function parseMarkdownToBlocks(markdown) {
    const text = String(markdown || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip blank lines between blocks
      if (line.trim() === '') {
        i++;
        continue;
      }

      // 1. Fenced Code Block or Mermaid Block: ```lang ... ```
      const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)\s*$/);
      if (fenceMatch) {
        const lang = (fenceMatch[1] || '').trim();
        i++;
        const codeLines = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing ```
        const codeContent = codeLines.join('\n');
        if (lang.toLowerCase() === 'mermaid') {
          blocks.push({
            id: nextBlockId(),
            type: 'mermaid',
            code: codeContent
          });
        } else {
          blocks.push({
            id: nextBlockId(),
            type: 'code',
            lang: lang || 'javascript',
            code: codeContent
          });
        }
        continue;
      }

      // 2. Display Math Block: $$ ... $$
      if (line.trim().startsWith('$$')) {
        if (line.trim() !== '$$' && line.trim().endsWith('$$') && line.trim().length > 4) {
          const singleLatex = line.trim().slice(2, -2).trim();
          blocks.push({
            id: nextBlockId(),
            type: 'math',
            latex: singleLatex
          });
          i++;
          continue;
        }
        i++;
        const mathLines = [];
        while (i < lines.length && !lines[i].trim().startsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing $$
        blocks.push({
          id: nextBlockId(),
          type: 'math',
          latex: mathLines.join('\n').trim()
        });
        continue;
      }

      // 3. Heading: # .. ######
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        blocks.push({
          id: nextBlockId(),
          type: 'heading',
          level: headingMatch[1].length,
          text: headingMatch[2].trim()
        });
        i++;
        continue;
      }

      // 4. Horizontal Rule: ---, ***, ___
      if (/^(?:---|\*\*\*|___)\s*$/.test(line.trim())) {
        blocks.push({
          id: nextBlockId(),
          type: 'hr'
        });
        i++;
        continue;
      }

      // 5. Table: | col1 | col2 | followed by | --- | --- |
      if (
        line.trim().startsWith('|') &&
        i + 1 < lines.length &&
        /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1].trim())
      ) {
        const parseTableRow = raw => {
          let trimmed = raw.trim();
          if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
          if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
          return trimmed.split('|').map(c => c.trim());
        };

        const headers = parseTableRow(lines[i]);
        const alignRaw = parseTableRow(lines[i + 1]);
        const aligns = headers.map((_, idx) => {
          const a = alignRaw[idx] || '';
          if (a.startsWith(':') && a.endsWith(':')) return 'center';
          if (a.endsWith(':')) return 'right';
          return 'left';
        });

        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const rowCells = parseTableRow(lines[i]);
          while (rowCells.length < headers.length) rowCells.push('');
          rows.push(rowCells.slice(0, headers.length));
          i++;
        }
        if (rows.length === 0) {
          rows.push(headers.map(() => ''));
        }
        blocks.push({
          id: nextBlockId(),
          type: 'table',
          headers,
          aligns,
          rows
        });
        continue;
      }

      // 6. Blockquote or GitHub Callout Alert: > [!NOTE] ...
      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        const firstLine = quoteLines[0] || '';
        const calloutMatch = firstLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
        if (calloutMatch) {
          const kind = calloutMatch[1].toUpperCase();
          const restFirst = calloutMatch[2];
          const bodyLines = restFirst ? [restFirst, ...quoteLines.slice(1)] : quoteLines.slice(1);
          blocks.push({
            id: nextBlockId(),
            type: 'callout',
            calloutType: kind,
            text: bodyLines.join('\n').trim()
          });
        } else {
          blocks.push({
            id: nextBlockId(),
            type: 'blockquote',
            text: quoteLines.join('\n').trim()
          });
        }
        continue;
      }

      // 7. Task List: - [ ] or - [x]
      if (/^\s*[-*+]\s+\[([ xX])\]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+\[([ xX])\]\s+/.test(lines[i])) {
          const m = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
          items.push({
            checked: m[1].toLowerCase() === 'x',
            text: m[2]
          });
          i++;
        }
        blocks.push({
          id: nextBlockId(),
          type: 'tasklist',
          items
        });
        continue;
      }

      // 8. Unordered List: - or * or +
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]) && !/^\s*[-*+]\s+\[([ xX])\]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        blocks.push({
          id: nextBlockId(),
          type: 'ulist',
          items
        });
        continue;
      }

      // 9. Ordered List: 1. 2.
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        blocks.push({
          id: nextBlockId(),
          type: 'olist',
          items
        });
        continue;
      }

      // 10. Standalone Image Block: ![alt](src) or ![alt|75%](src)
      const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (imgMatch) {
        let rawAlt = imgMatch[1] || '';
        let width = '100%';
        const widthSuffix = rawAlt.match(/^(.*?)\|\s*(25%|33%|50%|66%|75%|100%|\d{2,3}%)\s*$/);
        if (widthSuffix) {
          rawAlt = widthSuffix[1].trim();
          width = widthSuffix[2].trim();
        }
        blocks.push({
          id: nextBlockId(),
          type: 'image',
          alt: rawAlt,
          src: imgMatch[2].trim(),
          width
        });
        i++;
        continue;
      }

      // 11. Regular Paragraph
      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^(#{1,6}\s+|```|\$\$|---|\*\*\*|___|>\s?|\s*[-*+]\s+|\s*\d+\.\s+|\||!\[[^\]]*\]\([^)]+\)\s*$)/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length === 0) {
        paraLines.push(lines[i]);
        i++;
      }
      blocks.push({
        id: nextBlockId(),
        type: 'paragraph',
        text: paraLines.join('\n')
      });
    }

    if (blocks.length === 0) {
      blocks.push({
        id: nextBlockId(),
        type: 'paragraph',
        text: ''
      });
    }

    return blocks;
  }

  /* ==========================================================================
   * 2. BLOCK AST TO MARKDOWN SERIALIZER
   * ========================================================================== */

  function serializeBlocksToMarkdown(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';

    const effectiveBlocks = blocks.slice();
    while (
      effectiveBlocks.length > 1 &&
      effectiveBlocks[effectiveBlocks.length - 1].type === 'paragraph' &&
      (effectiveBlocks[effectiveBlocks.length - 1].text || '') === ''
    ) {
      effectiveBlocks.pop();
    }

    return effectiveBlocks
      .map(block => {
        switch (block.type) {
          case 'heading': {
            const hashes = '#'.repeat(Math.min(Math.max(block.level || 1, 1), 6));
            return `${hashes} ${block.text || ''}`;
          }
          case 'paragraph':
            return block.text || '';
          case 'blockquote':
            return String(block.text || '')
              .split('\n')
              .map(l => `> ${l}`)
              .join('\n');
          case 'callout': {
            const kind = block.calloutType || 'NOTE';
            const body = String(block.text || '')
              .split('\n')
              .map(l => `> ${l}`)
              .join('\n');
            return `> [!${kind}]\n${body}`;
          }
          case 'ulist':
            return (block.items || []).map(item => `- ${item}`).join('\n');
          case 'olist':
            return (block.items || []).map((item, idx) => `${idx + 1}. ${item}`).join('\n');
          case 'tasklist':
            return (block.items || [])
              .map(item => `- [${item.checked ? 'x' : ' '}] ${item.text || ''}`)
              .join('\n');
          case 'code':
            return `\`\`\`${block.lang || ''}\n${block.code || ''}\n\`\`\``;
          case 'mermaid':
            return `\`\`\`mermaid\n${block.code || ''}\n\`\`\``;
          case 'math':
            return `$$\n${block.latex || ''}\n$$`;
          case 'image': {
            const altClean = String(block.alt || '').trim();
            const w = block.width && block.width !== '100%' ? `|${block.width}` : '';
            return `![${altClean}${w}](${block.src || ''})`;
          }
          case 'hr':
            return '---';
          case 'table': {
            const headers = block.headers || ['列 1', '列 2'];
            const aligns = block.aligns || headers.map(() => 'left');
            const rows = block.rows || [];
            const headerLine = `| ${headers.join(' | ')} |`;
            const alignLine = `| ${aligns
              .map(a => (a === 'center' ? ':---:' : a === 'right' ? '---:' : ':---'))
              .join(' | ')} |`;
            const rowLines = rows.map(r => `| ${headers.map((_, idx) => r[idx] || '').join(' | ')} |`);
            return [headerLine, alignLine, ...rowLines].join('\n');
          }
          default:
            return block.text || '';
        }
      })
      .join('\n\n') + '\n';
  }

  /* ==========================================================================
   * 3. INLINE MARKDOWN RENDERER (Supports Pure View & Hybrid Syntax Reveal)
   * ========================================================================== */

  function renderInlineMarkdown(rawText, revealSyntax = false) {
    if (!rawText) return '';
    let text = escapeHtml(rawText);

    const wrapSyntax = (markerLeft, innerHtml, markerRight = markerLeft) => {
      if (revealSyntax) {
        return `<span class="md-marker">${markerLeft}</span>${innerHtml}<span class="md-marker">${markerRight}</span>`;
      }
      return innerHtml;
    };

    // 1. Inline code: `code`
    const codePlaceholders = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = codePlaceholders.length;
      codePlaceholders.push(
        wrapSyntax('`', `<code class="md-inline-code">${code}</code>`, '`')
      );
      return `\u0000CODE_${idx}\u0000`;
    });

    // 2. Inline Math: $...$
    const mathPlaceholders = [];
    text = text.replace(/\$([^$\n]+)\$/g, (_, latex) => {
      const unescapedLatex = latex
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      const idx = mathPlaceholders.length;
      const rendered = `<span class="md-inline-math" title="LaTeX: ${escapeHtml(unescapedLatex)}">${renderMath(unescapedLatex, false)}</span>`;
      mathPlaceholders.push(
        revealSyntax
          ? `<span class="md-marker">$${latex}$</span>${rendered}`
          : rendered
      );
      return `\u0000MATH_${idx}\u0000`;
    });

    // 3. Images: ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      const unescapedUrl = url
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      const resolved = escapeHtml(resolveAssetUrl(unescapedUrl));
      const imgHtml = `<img class="md-inline-img" src="${resolved}" data-raw-src="${url}" alt="${alt}" />`;
      if (revealSyntax) {
        return `<span class="md-marker">![${alt}](${url})</span>${imgHtml}`;
      }
      return imgHtml;
    });

    // 4. Links: [label](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const linkHtml = `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      if (revealSyntax) {
        return `<span class="md-marker">[</span>${linkHtml}<span class="md-marker">](${url})</span>`;
      }
      return linkHtml;
    });

    // 5. Bold + Italic: ***text***
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, (_, inner) =>
      wrapSyntax('***', `<strong><em>${inner}</em></strong>`)
    );

    // 6. Bold: **text** or __text__
    text = text.replace(/\*\*([^*]+)\*\*/g, (_, inner) =>
      wrapSyntax('**', `<strong>${inner}</strong>`)
    );
    text = text.replace(/__([^_]+)__/g, (_, inner) =>
      wrapSyntax('__', `<strong>${inner}</strong>`)
    );

    // 7. Italic: *text* or _text_
    text = text.replace(/\*([^*\n]+)\*/g, (_, inner) =>
      wrapSyntax('*', `<em>${inner}</em>`)
    );

    // 8. Strikethrough: ~~text~~
    text = text.replace(/~~([^~\n]+)~~/g, (_, inner) =>
      wrapSyntax('~~', `<del>${inner}</del>`)
    );

    // 9. Highlight: ==text==
    text = text.replace(/==([^=\n]+)==/g, (_, inner) =>
      wrapSyntax('==', `<mark class="md-highlight">${inner}</mark>`)
    );

    // Restore math and inline code placeholders
    text = text.replace(/\u0000MATH_(\d+)\u0000/g, (_, idx) => mathPlaceholders[Number(idx)]);
    text = text.replace(/\u0000CODE_(\d+)\u0000/g, (_, idx) => codePlaceholders[Number(idx)]);

    // Line breaks
    text = text.replace(/\n/g, '<br/>');
    return text;
  }

  /* ==========================================================================
   * 4. EXTRACT HTML BACK TO INLINE MARKDOWN (For ContentEditable Sync)
   * ========================================================================== */

  function extractInlineMarkdownFromElement(el) {
    if (!el) return '';
    // If element is currently in raw-editing mode or stores raw text while typing
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (node.classList.contains('md-marker')) {
          out += node.textContent;
        } else if (node.classList.contains('md-inline-math')) {
          // If markers are not present, reconstruct $...$ from title
          const hasMarkerSibling =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          if (!hasMarkerSibling) {
            const title = node.getAttribute('title') || '';
            const latex = title.replace(/^LaTeX:\s*/, '');
            out += `$${latex}$`;
          }
        } else if (tag === 'strong' || tag === 'b') {
          const hasMarker =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          const inner = extractInlineMarkdownFromElement(node);
          out += hasMarker ? inner : `**${inner}**`;
        } else if (tag === 'em' || tag === 'i') {
          const hasMarker =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          const inner = extractInlineMarkdownFromElement(node);
          out += hasMarker ? inner : `*${inner}*`;
        } else if (tag === 'code') {
          const hasMarker =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          const inner = node.textContent;
          out += hasMarker ? inner : `\`${inner}\``;
        } else if (tag === 'del' || tag === 's') {
          const hasMarker =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          const inner = extractInlineMarkdownFromElement(node);
          out += hasMarker ? inner : `~~${inner}~~`;
        } else if (tag === 'mark') {
          const hasMarker =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          const inner = extractInlineMarkdownFromElement(node);
          out += hasMarker ? inner : `==${inner}==`;
        } else if (tag === 'a') {
          const hasMarker =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          const inner = extractInlineMarkdownFromElement(node);
          const href = node.getAttribute('href') || '';
          out += hasMarker ? inner : `[${inner}](${href})`;
        } else if (tag === 'img') {
          const hasMarker =
            node.previousElementSibling &&
            node.previousElementSibling.classList.contains('md-marker');
          if (!hasMarker) {
            const alt = node.getAttribute('alt') || '';
            const rawSrc = node.getAttribute('data-raw-src') || node.getAttribute('src') || '';
            out += `![${alt}](${rawSrc})`;
          }
        } else if (tag === 'br') {
          out += '\n';
        } else {
          out += extractInlineMarkdownFromElement(node);
        }
      }
    }
    return out.replace(/\u00a0/g, ' ');
  }

  /* ==========================================================================
   * 5. EXTRACT HEADINGS FOR OUTLINE (TOC)
   * ========================================================================== */

  function extractHeadings(blocks) {
    const headings = [];
    for (const b of blocks) {
      if (b.type === 'heading') {
        headings.push({
          id: b.id,
          level: b.level,
          text: (b.text || '未命名标题').replace(/[*_`~=#]/g, '').trim()
        });
      }
    }
    return headings;
  }

  /* ==========================================================================
   * 6. COMPUTE DOCUMENT STATISTICS
   * ========================================================================== */

  function computeDocumentStats(markdown) {
    const raw = String(markdown || '');
    const chars = raw.replace(/\s/g, '').length;
    const lines = raw === '' ? 1 : raw.split('\n').length;

    // Count CJK characters + English words
    const cjkMatches = raw.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjk = raw
      .replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ')
      .replace(/[#*`~>\-|()[\]{}]/g, ' ')
      .trim();
    const enWords = nonCjk ? nonCjk.split(/\s+/).filter(Boolean).length : 0;
    const words = cjkCount + enWords;
    const readingMinutes = Math.max(1, Math.ceil(words / 300));

    return { words, chars, lines, readingMinutes };
  }

  global.MarkoraParser = {
    nextBlockId,
    setDocumentBaseDir,
    resolveAssetUrl,
    parseMarkdownToBlocks,
    serializeBlocksToMarkdown,
    renderInlineMarkdown,
    extractInlineMarkdownFromElement,
    extractHeadings,
    computeDocumentStats
  };
})(window);
