// File-to-Markdown: extract text + images from Office/PDF, describe images via vision LLM
import { readFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'fs';
import { extname, join } from 'path';
import { execSync } from 'child_process';

const TMP_DIR = '/tmp/file2md';
mkdirSync(TMP_DIR, { recursive: true });

// Vision LLM endpoint (llm service in docker-compose)
const LLM_URL = process.env.LLM_URL || 'http://llm:8081/v1/chat/completions';

// Decode XML entities: &#12345; -> char, &amp; &lt; &gt; &quot; &apos;
function decodeXmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Save an extracted image to uploadsDir, return { url, localPath }
let _imgCounter = 0;
function saveExtractedImage(srcPath, uploadsDir) {
  if (!uploadsDir || !existsSync(srcPath)) return null;
  const ext = extname(srcPath).toLowerCase() || '.png';
  const name = `img_${Date.now()}_${_imgCounter++}${ext}`;
  const dest = join(uploadsDir, name);
  try {
    copyFileSync(srcPath, dest);
    return { url: `/uploads/${name}`, localPath: dest };
  } catch (e) {
    console.warn(`[file2md] Failed to save image: ${e.message}`);
    return null;
  }
}

/**
 * Call the vision LLM to describe an image.
 * Returns a short description string, or '' on failure.
 */
async function describeImage(localPath) {
  try {
    const imgBuf = readFileSync(localPath);
    const ext = extname(localPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    const b64 = imgBuf.toString('base64');

    const payload = {
      model: 'qwen',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          { type: 'text', text: '请用一句简短的中文描述这张图片的内容，不超过30个字。' }
        ]
      }],
      max_tokens: 80,
      temperature: 0.3
    };

    const resp = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    });

    if (!resp.ok) {
      console.warn(`[file2md] Vision LLM returned ${resp.status}`);
      return '';
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    console.log(`[file2md] Image described: ${text}`);
    return text;
  } catch (e) {
    console.warn(`[file2md] Vision LLM error: ${e.message}`);
    return '';
  }
}

/**
 * Format an image block with optional description.
 * Uses a special marker pattern that MarkdownRenderer will detect for centered display.
 */
function formatImageBlock(url, description) {
  if (description) {
    return `![image](${url})\n\n> 图片描述：${description}`;
  }
  return `![image](${url})`;
}

// Parse a .rels XML file and return a map: rId -> target path (for image types only)
function parseRelsMap(relsXml) {
  const map = {};
  const regex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"[^>]+Type="[^"]*\/image"[^>]*\/?>/g;
  let m;
  while ((m = regex.exec(relsXml)) !== null) map[m[1]] = m[2];
  // Also try reversed attribute order (Target before Type)
  const regex2 = /<Relationship[^>]+Id="([^"]+)"[^>]+Type="[^"]*\/image"[^>]+Target="([^"]+)"[^>]*\/?>/g;
  while ((m = regex2.exec(relsXml)) !== null) {
    if (!map[m[1]]) map[m[1]] = m[2];
  }
  return map;
}

// Extract all a:blip r:embed references from an XML fragment
function findBlipRefs(fragment) {
  const refs = [];
  const regex = /<a:blip[^>]+r:embed="([^"]+)"/g;
  let m;
  while ((m = regex.exec(fragment)) !== null) refs.push(m[1]);
  return refs;
}

/**
 * Extract text + images from DOCX by parsing word/document.xml
 * Returns { markdown, images: [{url, localPath}] }
 */
function extractDocxRaw(filePath, uploadsDir) {
  const workDir = join(TMP_DIR, `docx_${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    execSync(`unzip -o -q "${filePath}" -d "${workDir}"`, { timeout: 10000 });
    const xmlPath = join(workDir, 'word/document.xml');
    const xml = readFileSync(xmlPath, 'utf-8');

    // Load image relationship map: rId -> media/image1.png
    let relsMap = {};
    try {
      const relsXml = readFileSync(join(workDir, 'word/_rels/document.xml.rels'), 'utf-8');
      relsMap = parseRelsMap(relsXml);
    } catch {}

    // Collect all images for later description
    const images = [];

    // Helper: extract all text from an XML fragment, decode entities
    function grabText(fragment) {
      const texts = [];
      const regex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let m;
      while ((m = regex.exec(fragment)) !== null) texts.push(m[1]);
      return decodeXmlEntities(texts.join(''));
    }

    // Helper: extract images from a paragraph fragment and save them
    function grabImages(fragment) {
      if (!uploadsDir || !Object.keys(relsMap).length) return [];
      const refs = findBlipRefs(fragment);
      const imgResults = [];
      for (const rId of refs) {
        const target = relsMap[rId];
        if (!target) continue;
        const srcPath = join(workDir, 'word', target);
        const saved = saveExtractedImage(srcPath, uploadsDir);
        if (saved) {
          imgResults.push(saved);
          images.push(saved);
        }
      }
      return imgResults;
    }

    // Helper: parse a <w:tbl> block into a markdown table
    function parseTable(tblXml) {
      const rows = [];
      const rowRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
        const cells = [];
        const cellRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
          const paras = cellMatch[0].split(/<\/w:p>/);
          const cellTexts = paras.map(p => grabText(p).trim()).filter(Boolean);
          cells.push(cellTexts.join(' '));
        }
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) return '';
      const maxCols = Math.max(...rows.map(r => r.length));
      const padded = rows.map(r => {
        while (r.length < maxCols) r.push('');
        return r;
      });
      const header = '| ' + padded[0].join(' | ') + ' |';
      const sep = '| ' + padded[0].map(() => '---').join(' | ') + ' |';
      const body = padded.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
      return header + '\n' + sep + (body ? '\n' + body : '');
    }

    // Process a paragraph: extract text + images, push to result array
    // Images use a placeholder that will be replaced with descriptions later
    function processParagraph(p, result) {
      const text = grabText(p);
      const imgResults = grabImages(p);

      if (text.trim()) {
        const isHeading = /<w:pStyle\s+w:val="(Heading|heading|\u6807\u9898)\s*(\d?)"/i.test(p);
        const headingLevel = p.match(/<w:pStyle\s+w:val="(?:Heading|heading|\u6807\u9898)\s*(\d?)"/i);
        if (isHeading) {
          const level = headingLevel?.[1] ? Math.min(parseInt(headingLevel[1]), 4) : 1;
          result.push('#'.repeat(level) + ' ' + text.trim());
        } else {
          const isBold = /<w:b\s*\/?>/.test(p) && !/<w:b\s+w:val="(false|0)"/.test(p);
          if (isBold && text.length < 60) {
            result.push('**' + text.trim() + '**');
          } else {
            result.push(text);
          }
        }
      }

      // Append image placeholders (will be replaced with descriptions later)
      for (const img of imgResults) {
        result.push(`__IMG_PLACEHOLDER__${img.url}__END__`);
      }
    }

    // Split document body into table blocks and paragraph blocks
    const result = [];
    let cursor = 0;
    const tblRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>/g;
    let tblMatch;

    while ((tblMatch = tblRegex.exec(xml)) !== null) {
      const before = xml.slice(cursor, tblMatch.index);
      const paragraphs = before.split(/<\/w:p>/);
      for (const p of paragraphs) {
        processParagraph(p, result);
      }
      const mdTable = parseTable(tblMatch[0]);
      if (mdTable) result.push(mdTable);
      cursor = tblMatch.index + tblMatch[0].length;
    }

    const remaining = xml.slice(cursor);
    const paragraphs = remaining.split(/<\/w:p>/);
    for (const p of paragraphs) {
      processParagraph(p, result);
    }

    return { markdown: result.join('\n\n'), images };
  } finally {
    try { execSync(`rm -rf "${workDir}"`); } catch {}
  }
}

/**
 * Extract text + images from PPTX
 * Returns { markdown, images: [{url, localPath}] }
 */
function extractPptxRaw(filePath, uploadsDir) {
  const workDir = join(TMP_DIR, `pptx_${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    execSync(`unzip -o -q "${filePath}" -d "${workDir}"`, { timeout: 10000 });
    const slidesDir = join(workDir, 'ppt/slides');
    const slideFiles = readdirSync(slidesDir)
      .filter(f => /^slide\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

    const images = [];
    const slides = [];

    for (let si = 0; si < slideFiles.length; si++) {
      const xml = readFileSync(join(slidesDir, slideFiles[si]), 'utf-8');
      const paragraphs = xml.split(/<\/a:p>/);
      const lines = paragraphs.map(p => {
        const texts = [];
        const regex = /<a:t>([^<]*)<\/a:t>/g;
        let m;
        while ((m = regex.exec(p)) !== null) texts.push(m[1]);
        return decodeXmlEntities(texts.join(''));
      }).filter(l => l.trim());

      // Extract images from this slide
      const imageLines = [];
      if (uploadsDir) {
        let slideRelsMap = {};
        try {
          const relsFile = join(slidesDir, '_rels', slideFiles[si] + '.rels');
          const relsXml = readFileSync(relsFile, 'utf-8');
          slideRelsMap = parseRelsMap(relsXml);
        } catch {}

        const refs = findBlipRefs(xml);
        const seen = new Set();
        for (const rId of refs) {
          if (seen.has(rId)) continue;
          seen.add(rId);
          const target = slideRelsMap[rId];
          if (!target) continue;
          const srcPath = join(slidesDir, target);
          const saved = saveExtractedImage(srcPath, uploadsDir);
          if (saved) {
            imageLines.push(`__IMG_PLACEHOLDER__${saved.url}__END__`);
            images.push(saved);
          }
        }
      }

      if (lines.length || imageLines.length) {
        const heading = `### Slide ${si + 1}${lines.length ? ': ' + lines[0] : ''}`;
        const body = lines.slice(1).map(l => '- ' + l).join('\n');
        const imgMd = imageLines.length ? '\n\n' + imageLines.join('\n\n') : '';
        slides.push(heading + (body ? '\n\n' + body : '') + imgMd);
      }
    }
    return { markdown: slides.join('\n\n---\n\n'), images };
  } finally {
    try { execSync(`rm -rf "${workDir}"`); } catch {}
  }
}

/**
 * Extract text from XLSX and format as markdown table
 */
function extractXlsx(filePath) {
  const workDir = join(TMP_DIR, `xlsx_${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    execSync(`unzip -o -q "${filePath}" -d "${workDir}"`, { timeout: 10000 });
    const strings = [];
    const ssPath = join(workDir, 'xl/sharedStrings.xml');
    try {
      const ssXml = readFileSync(ssPath, 'utf-8');
      const regex = /<t[^>]*>([^<]*)<\/t>/g;
      let m;
      while ((m = regex.exec(ssXml)) !== null) strings.push(decodeXmlEntities(m[1]));
    } catch {}
    const sheetNames = [];
    try {
      const wbXml = readFileSync(join(workDir, 'xl/workbook.xml'), 'utf-8');
      const sheetTagRegex = /<sheet[^>]+name="([^"]*)"[^>]*\/?>|<sheet[^>]+name="([^"]*)"[^>]*>/g;
      let nm;
      while ((nm = sheetTagRegex.exec(wbXml)) !== null) {
        sheetNames.push(decodeXmlEntities(nm[1] || nm[2]));
      }
    } catch {}
    const sheetsDir = join(workDir, 'xl/worksheets');
    const sheetFiles = readdirSync(sheetsDir)
      .filter(f => /^sheet\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    const sheets = [];
    for (let si = 0; si < sheetFiles.length; si++) {
      const sf = sheetFiles[si];
      const xml = readFileSync(join(sheetsDir, sf), 'utf-8');
      const rows = [];
      const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(xml)) !== null) {
        const cells = [];
        const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/g;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          const attrs = cellMatch[1];
          const inner = cellMatch[2];
          if (/t="inlineStr"/.test(attrs)) {
            const tMatch = inner.match(/<t[^>]*>([^<]*)<\/t>/);
            cells.push(tMatch ? decodeXmlEntities(tMatch[1]) : '');
          } else if (/t="s"/.test(attrs)) {
            const vMatch = inner.match(/<v>([^<]*)<\/v>/);
            cells.push(vMatch ? (strings[parseInt(vMatch[1])] || '') : '');
          } else {
            const vMatch = inner.match(/<v>([^<]*)<\/v>/);
            cells.push(vMatch ? vMatch[1] : '');
          }
        }
        if (cells.some(c => c)) rows.push(cells);
      }
      if (rows.length) {
        const sheetTitle = sheetNames[si] || ('Sheet ' + (si + 1));
        const maxCols = Math.max(...rows.map(r => r.length));
        const padded = rows.map(r => {
          while (r.length < maxCols) r.push('');
          return r;
        });
        const header = '| ' + padded[0].join(' | ') + ' |';
        const sep = '| ' + padded[0].map(() => '---').join(' | ') + ' |';
        const body = padded.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
        sheets.push('### ' + sheetTitle + '\n\n' + header + '\n' + sep + '\n' + body);
      }
    }
    return sheets.join('\n\n---\n\n');
  } finally {
    try { execSync(`rm -rf "${workDir}"`); } catch {}
  }
}

/**
 * Extract text from PDF using pdftotext
 */
function extractPdf(filePath) {
  const workDir = join(TMP_DIR, `pdf_${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    const outFile = join(workDir, 'output.txt');
    execSync(`pdftotext -enc UTF-8 -layout "${filePath}" "${outFile}"`, { timeout: 30000 });
    const raw = readFileSync(outFile, 'utf-8').trim();
    const lines = raw.split('\n');
    const formatted = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) { formatted.push(''); continue; }
      const prevBlank = i === 0 || !lines[i - 1].trim();
      const nextBlank = i === lines.length - 1 || !lines[i + 1]?.trim();
      if (prevBlank && nextBlank && line.length < 40 && line.length > 1) {
        formatted.push('## ' + line);
      } else {
        formatted.push(line);
      }
    }
    return formatted.join('\n');
  } finally {
    try { execSync(`rm -rf "${workDir}"`); } catch {}
  }
}

/**
 * Extract text from old .doc/.xls/.ppt via LibreOffice
 */
function extractLegacyOffice(filePath) {
  const workDir = join(TMP_DIR, `legacy_${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    execSync(
      `libreoffice --headless --convert-to pdf --outdir "${workDir}" "${filePath}"`,
      { timeout: 60000, env: { ...process.env, HOME: '/tmp' } }
    );
    const pdfFiles = readdirSync(workDir).filter(f => f.endsWith('.pdf'));
    if (pdfFiles.length === 0) throw new Error('Conversion failed');
    return extractPdf(join(workDir, pdfFiles[0]));
  } finally {
    try { execSync(`rm -rf "${workDir}"`); } catch {}
  }
}

/**
 * Replace image placeholders with described image blocks.
 * Calls vision LLM for each image sequentially.
 */
async function replaceImagePlaceholders(markdown, images) {
  if (!images.length) return markdown;

  // Build url -> localPath map
  const pathMap = {};
  for (const img of images) {
    pathMap[img.url] = img.localPath;
  }

  // Find all placeholders
  const placeholderRegex = /__IMG_PLACEHOLDER__([^_]+(?:_[^_]+)*)__END__/g;
  const matches = [];
  let m;
  while ((m = placeholderRegex.exec(markdown)) !== null) {
    matches.push({ full: m[0], url: m[1] });
  }

  if (!matches.length) return markdown;

  // Describe each image sequentially (LLM can only handle one at a time)
  const descriptions = {};
  for (const match of matches) {
    if (descriptions[match.url] !== undefined) continue; // already described
    const localPath = pathMap[match.url];
    if (localPath) {
      console.log(`[file2md] Describing image: ${match.url}`);
      const startTime = Date.now();
      descriptions[match.url] = await describeImage(localPath);
      console.log(`[file2md] Description took ${Date.now() - startTime}ms`);
    } else {
      descriptions[match.url] = '';
    }
  }

  // Replace placeholders with formatted image blocks
  let result = markdown;
  for (const match of matches) {
    const desc = descriptions[match.url] || '';
    const block = formatImageBlock(match.url, desc);
    result = result.replace(match.full, block);
  }

  return result;
}

/**
 * Main entry - extraction with image support and vision descriptions
 */
export async function fileToMarkdown(filePath, originalName, uploadsDir = null) {
  const ext = extname(originalName || filePath).toLowerCase();
  console.log(`[file2md] Extracting from ${originalName} (${ext})${uploadsDir ? ' with image extraction + vision' : ''}...`);

  let markdown = '';
  let images = [];

  if (ext === '.pdf') {
    markdown = extractPdf(filePath);
  } else if (ext === '.docx') {
    const result = extractDocxRaw(filePath, uploadsDir);
    markdown = result.markdown;
    images = result.images;
  } else if (ext === '.pptx') {
    const result = extractPptxRaw(filePath, uploadsDir);
    markdown = result.markdown;
    images = result.images;
  } else if (ext === '.xlsx') {
    markdown = extractXlsx(filePath);
  } else if (['.doc', '.xls', '.ppt'].includes(ext)) {
    markdown = extractLegacyOffice(filePath);
  } else {
    return `*不支持的文件格式: ${ext}，仅支持 PDF、Word、Excel、PowerPoint*`;
  }

  if (!markdown.trim()) {
    return '*文件内容为空或无法提取文字*';
  }

  // Replace image placeholders with vision-described blocks
  if (images.length > 0) {
    console.log(`[file2md] Describing ${images.length} images via vision LLM...`);
    const descStart = Date.now();
    markdown = await replaceImagePlaceholders(markdown, images);
    console.log(`[file2md] All image descriptions done in ${Date.now() - descStart}ms`);
  }

  console.log(`[file2md] Done: ${markdown.length} chars of Markdown`);
  return markdown;
}
