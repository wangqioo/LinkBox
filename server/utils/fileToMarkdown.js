// File-to-Markdown: extract text + images from Office/PDF, describe images via vision LLM
import { readFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'fs';
import { extname, join } from 'path';
import { execSync } from 'child_process';
import { getAIConfig } from './aiConfig.js';
import {
  decodeXmlEntities,
  extractHtmlText,
  findImagePlaceholders,
  replaceImagePlaceholdersWithDescriptions,
} from './fileMarkdownUtils.js';
import {
  extractDrawingEmbedRefs,
  extractWordText,
  parseImageRelationships,
  wordTableToMarkdown,
} from './officeXmlUtils.js';
import {
  parseSharedStrings,
  parseSheetNames,
  sheetRowsToMarkdown,
  worksheetRows,
} from './spreadsheetXmlUtils.js';
import {
  presentationParagraphLines,
  slideToMarkdown,
} from './presentationXmlUtils.js';

const TMP_DIR = '/tmp/file2md';
mkdirSync(TMP_DIR, { recursive: true });

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
export async function describeImage(localPath) {
  try {
    const imgBuf = readFileSync(localPath);
    const ext = extname(localPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    const b64 = imgBuf.toString('base64');

    const aiConfig = getAIConfig({ includeSecret: true });
    const payload = {
      model: aiConfig.visionModel || aiConfig.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          { type: 'text', text: '请用一句简短的中文描述这张图片的内容，不超过30个字。' }
        ]
      }],
      max_tokens: 80,
      temperature: aiConfig.temperature,
    };
    if (aiConfig.supportsThinkingParam) {
      payload.chat_template_kwargs = { enable_thinking: aiConfig.enableThinking };
    }

    const resp = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {}),
      },
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
      relsMap = parseImageRelationships(relsXml);
    } catch {}

    // Collect all images for later description
    const images = [];

    // Helper: extract images from a paragraph fragment and save them
    function grabImages(fragment) {
      if (!uploadsDir || !Object.keys(relsMap).length) return [];
      const refs = extractDrawingEmbedRefs(fragment);
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

    // Process a paragraph: extract text + images, push to result array
    // Images use a placeholder that will be replaced with descriptions later
    function processParagraph(p, result) {
      const text = extractWordText(p);
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
      const mdTable = wordTableToMarkdown(tblMatch[0]);
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
      const lines = presentationParagraphLines(xml);

      // Extract images from this slide
      const imageLines = [];
      if (uploadsDir) {
        let slideRelsMap = {};
        try {
          const relsFile = join(slidesDir, '_rels', slideFiles[si] + '.rels');
          const relsXml = readFileSync(relsFile, 'utf-8');
          slideRelsMap = parseImageRelationships(relsXml);
        } catch {}

        const refs = extractDrawingEmbedRefs(xml);
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

      const slideMarkdown = slideToMarkdown(si + 1, lines, imageLines);
      if (slideMarkdown) slides.push(slideMarkdown);
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
      strings.push(...parseSharedStrings(ssXml));
    } catch {}
    const sheetNames = [];
    try {
      const wbXml = readFileSync(join(workDir, 'xl/workbook.xml'), 'utf-8');
      sheetNames.push(...parseSheetNames(wbXml));
    } catch {}
    const sheetsDir = join(workDir, 'xl/worksheets');
    const sheetFiles = readdirSync(sheetsDir)
      .filter(f => /^sheet\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    const sheets = [];
    for (let si = 0; si < sheetFiles.length; si++) {
      const sf = sheetFiles[si];
      const xml = readFileSync(join(sheetsDir, sf), 'utf-8');
      const rows = worksheetRows(xml, strings);
      if (rows.length) {
        const sheetTitle = sheetNames[si] || ('Sheet ' + (si + 1));
        sheets.push(sheetRowsToMarkdown(rows, sheetTitle));
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

  const matches = findImagePlaceholders(markdown);

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

  return replaceImagePlaceholdersWithDescriptions(markdown, descriptions);
}

/**
 * Main entry - extraction with image support and vision descriptions
 */
export async function fileToMarkdown(filePath, originalName, uploadsDir = null) {
  const ext = extname(originalName || filePath).toLowerCase();
  console.log(`[file2md] Extracting from ${originalName} (${ext})${uploadsDir ? ' with image extraction + vision' : ''}...`);

  let markdown = '';
  let images = [];

  if (['.txt', '.md'].includes(ext)) {
    return readFileSync(filePath, 'utf-8');
  } else if (ext === '.html' || ext === '.htm') {
    // For HTML files, extract plain text for summarization
    const html = readFileSync(filePath, 'utf-8');
    const text = extractHtmlText(html);
    return text || '*HTML 文件内容为空*';
  } else if (ext === '.pdf') {
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
