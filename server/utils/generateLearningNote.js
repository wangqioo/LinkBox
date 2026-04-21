// Generates a structured HTML learning note from article markdown
// Uses Spark 2 local Qwen2.5-VL-3B (port 8081)
import { markdownToSummaryText } from './aiSummarize.js';

const LOCAL_LLM = process.env.LOCAL_LLM_URL || 'http://localhost:8081/v1';
const MODEL = 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf';

async function callLLM(prompt, maxTokens = 800) {
  const response = await fetch(`${LOCAL_LLM}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`LLM error ${response.status}`);
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

export async function generateLearningNote(markdown, title = '', summary = '') {
  // Convert to LLM-friendly text: image descriptions become [图：xxx], bare image URLs dropped
  const plainText = markdownToSummaryText(markdown);
  const truncated = plainText.slice(0, 4000);

  // Step 1: Extract key takeaways
  const takeawaysRaw = await callLLM(
    `文章标题：${title}\n\n文章内容：\n${truncated}\n\n请提取这篇文章最重要的3-5个核心要点，每个要点一行，用"• "开头，中文，简洁清晰：`,
    400
  );

  // Step 2: Extract key concepts
  const conceptsRaw = await callLLM(
    `文章标题：${title}\n\n文章内容：\n${truncated}\n\n请识别文章中2-4个重要概念或术语，每个格式为"【概念名】：解释（30字以内）"，每个占一行：`,
    300
  );

  // Step 3: One-sentence conclusion
  const conclusion = summary || await callLLM(
    `请用一句话（30字以内）概括这篇文章的核心结论：\n\n${truncated.slice(0, 1000)}`,
    80
  );

  // Parse takeaways
  const takeaways = takeawaysRaw
    .split('\n')
    .filter(l => l.trim().startsWith('•') || l.trim().startsWith('-') || l.trim().match(/^\d+\./))
    .map(l => l.replace(/^[•\-\*\d\.]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);

  // Parse concepts
  const concepts = conceptsRaw
    .split('\n')
    .filter(l => l.includes('：') || l.includes(':'))
    .map(l => {
      const match = l.match(/[【\[]?([^】\]：:]+)[】\]]?[：:]\s*(.+)/);
      return match ? { term: match[1].trim(), def: match[2].trim() } : null;
    })
    .filter(Boolean)
    .slice(0, 4);

  // Build mind map data from parsed content
  const shortTitle = title.slice(0, 10) || '核心内容';
  const mindData = {
    name: shortTitle,
    children: [
      {
        name: '核心结论',
        children: [{ name: conclusion.slice(0, 16) || '见文章' }]
      },
      {
        name: '核心要点',
        children: takeaways.slice(0, 5).map(t => ({ name: t.slice(0, 14) }))
      },
      ...(concepts.length > 0 ? [{
        name: '关键概念',
        children: concepts.slice(0, 4).map(c => ({ name: c.term.slice(0, 10) }))
      }] : [])
    ]
  };

  const mindDataJson = JSON.stringify(mindData);

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #1a1a2e; line-height: 1.7; }
  .page { max-width: 780px; margin: 0 auto; padding: 24px 20px 60px; }
  h1 { font-size: 1.4rem; font-weight: 700; color: #1a1a2e; margin-bottom: 20px; line-height: 1.4; }
  .conclusion { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; font-size: 1rem; font-weight: 500; line-height: 1.6; }
  .conclusion::before { content: '核心结论'; display: block; font-size: 0.7rem; opacity: 0.85; margin-bottom: 6px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .section { background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 14px; }
  .takeaways .section-title { color: #0ea5e9; }
  .concepts .section-title { color: #10b981; }
  .mindmap-section .section-title { color: #8b5cf6; }
  .takeaway-item { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
  .takeaway-item:last-child { border-bottom: none; }
  .takeaway-num { width: 22px; height: 22px; border-radius: 50%; background: #e0f2fe; color: #0ea5e9; font-size: 0.7rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
  .takeaway-text { font-size: 0.9rem; color: #334155; line-height: 1.6; }
  .concept-item { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .concept-item:last-child { border-bottom: none; }
  .concept-term { font-weight: 600; color: #065f46; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px; }
  .concept-term::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #10b981; display: inline-block; }
  .concept-def { font-size: 0.85rem; color: #64748b; margin-top: 3px; padding-left: 12px; }
  #mindmap-svg { width: 100%; overflow: visible; }
  .footer { text-align: center; font-size: 0.72rem; color: #94a3b8; margin-top: 24px; }
</style>
</head>
<body>
<div class="page">
  <h1>${escapeHtml(title)}</h1>
  
  <div class="conclusion">${escapeHtml(conclusion)}</div>

  <div class="section takeaways">
    <div class="section-title">📌 核心要点</div>
    ${takeaways.map((t, i) => `
    <div class="takeaway-item">
      <div class="takeaway-num">${i + 1}</div>
      <div class="takeaway-text">${escapeHtml(t)}</div>
    </div>`).join('')}
  </div>

  ${concepts.length > 0 ? `
  <div class="section concepts">
    <div class="section-title">🔑 关键概念</div>
    ${concepts.map(c => `
    <div class="concept-item">
      <div class="concept-term">${escapeHtml(c.term)}</div>
      <div class="concept-def">${escapeHtml(c.def)}</div>
    </div>`).join('')}
  </div>` : ''}

  <div class="section mindmap-section">
    <div class="section-title">🗺️ 知识地图</div>
    <div id="mindmap-container"></div>
  </div>

  <div class="footer">由 Qwen2.5-VL-3B 生成 · LinkBox</div>
</div>
<script>
(function() {
  const mindData = ${mindDataJson};
  const PALETTE = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#14b8a6','#8b5cf6','#f97316'];
  const W = 700, H = 460, cx = 350, cy = 230;
  const r1 = 145, r2 = 255;

  function wrapText(text, maxLen) {
    if (text.length <= maxLen) return [text];
    const lines = [];
    for (let i = 0; i < text.length && lines.length < 3; i += maxLen) {
      lines.push(text.slice(i, i + maxLen));
    }
    return lines;
  }

  function buildLayout(data) {
    const nodes = [];
    nodes.push({ name: data.name, x: cx, y: cy, depth: 0, ci: 0 });
    if (!data.children || !data.children.length) return nodes;

    const n1 = data.children.length;
    const sectorAngle = (2 * Math.PI) / n1;

    data.children.forEach(function(child, i) {
      const angle = sectorAngle * i - Math.PI / 2;
      const x = cx + r1 * Math.cos(angle);
      const y = cy + r1 * Math.sin(angle);
      const ci = i % PALETTE.length;
      nodes.push({ name: child.name, x: x, y: y, depth: 1, ci: ci, px: cx, py: cy });

      if (child.children && child.children.length) {
        const n2 = child.children.length;
        const spread = sectorAngle * 0.72;
        child.children.forEach(function(gc, j) {
          const a = angle - spread / 2 + (spread / n2) * (j + 0.5);
          nodes.push({
            name: gc.name,
            x: cx + r2 * Math.cos(a),
            y: cy + r2 * Math.sin(a),
            depth: 2, ci: ci, px: x, py: y
          });
        });
      }
    });
    return nodes;
  }

  function makeSVGEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  const nodes = buildLayout(mindData);
  const svg = makeSVGEl('svg', { viewBox: '0 0 ' + W + ' ' + H, id: 'mindmap-svg' });

  // Edges
  nodes.forEach(function(n) {
    if (n.px === undefined) return;
    svg.appendChild(makeSVGEl('line', {
      x1: n.px, y1: n.py, x2: n.x, y2: n.y,
      stroke: PALETTE[n.ci],
      'stroke-opacity': n.depth === 1 ? '0.55' : '0.3',
      'stroke-width': n.depth === 1 ? '2.5' : '1.5',
      'stroke-linecap': 'round'
    }));
  });

  // Nodes
  nodes.forEach(function(n) {
    const g = makeSVGEl('g', {});
    const color = PALETTE[n.ci];
    const maxLen = n.depth === 0 ? 7 : n.depth === 1 ? 6 : 8;
    const lines = wrapText(n.name, maxLen);
    const lh = 15, bw = n.depth === 0 ? 88 : n.depth === 1 ? 80 : 72;
    const bh = lines.length * lh + 10;

    if (n.depth === 0) {
      g.appendChild(makeSVGEl('ellipse', {
        cx: n.x, cy: n.y, rx: bw / 2 + 4, ry: bh / 2 + 4, fill: color
      }));
    } else if (n.depth === 1) {
      g.appendChild(makeSVGEl('rect', {
        x: n.x - bw/2, y: n.y - bh/2, width: bw, height: bh, rx: 10,
        fill: color + '22', stroke: color, 'stroke-width': '2'
      }));
    } else {
      g.appendChild(makeSVGEl('rect', {
        x: n.x - bw/2, y: n.y - bh/2, width: bw, height: bh, rx: 7,
        fill: color + '10', stroke: color + '70', 'stroke-width': '1'
      }));
    }

    lines.forEach(function(line, li) {
      var t = makeSVGEl('text', {
        x: n.x,
        y: n.y - (lines.length - 1) * lh / 2 + li * lh + 1,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': n.depth === 0 ? '13' : n.depth === 1 ? '12' : '11',
        'font-weight': n.depth === 0 ? '700' : n.depth === 1 ? '600' : '400',
        fill: n.depth === 0 ? 'white' : color,
        'font-family': 'system-ui,-apple-system,sans-serif'
      });
      t.textContent = line;
      g.appendChild(t);
    });
    svg.appendChild(g);
  });

  document.getElementById('mindmap-container').appendChild(svg);
})();
</script>
</body>
</html>`;

  return html;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
