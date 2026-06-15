import { indexLinkContent, removeLinkContentIndex } from './chunkIndex.js';
import { jsonError } from './appError.js';
import { getRuntimeQueue } from './runtimeQueue.js';
import { parseTagIds } from './linkPayloads.js';
import { getItemForUser, listItemsForUser } from './itemRepository.js';
import {
  createAudioItem,
  createTextItem,
} from './linkCreateService.js';
import {
  extractLinkContent,
  generateLinkLearningNote,
  summarizeLinkItem,
} from './linkAiActions.js';
import { deleteLinkItem, updateLinkItem } from './linkMutationService.js';
import { exportAllData, exportSummariesMarkdown } from './linkExportService.js';
import {
  annotateDocumentInspection,
  getDocumentInspection,
  rechunkDocumentInspection,
  reindexDocumentInspection,
} from './documentInspector.js';
import { UPLOADS_DIR } from './uploadMiddleware.js';
import { normalizeUploadedAsset } from './uploadedAsset.js';
import {
  acceptImportedLinkItems,
  acceptFileItem,
  acceptImageItem,
  acceptLinkItem,
  retryItemProcessing,
} from './itemIntake.js';

function parseMultipartTags(req, res) {
  try {
    return parseTagIds(req.body.tag_ids);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return null;
  }
}

export function createItemController({
  db,
  uploadsDir = UPLOADS_DIR,
  getQueue = getRuntimeQueue,
  indexLink = indexLinkContent,
  removeIndex = removeLinkContentIndex,
} = {}) {
  if (!db) throw new Error('createItemController requires a database');

  return {
    list(req, res) {
      res.json(listItemsForUser(db, {
        userId: req.userId,
        query: req.query,
      }));
    },

    get(req, res) {
      const link = getItemForUser(db, { linkId: req.params.id, userId: req.userId });
      if (!link) return res.status(404).json({ error: '不存在' });
      return res.json(link);
    },

    createLink(req, res) {
      const { url, title, comment, tag_ids, imported_at } = req.body;
      if (!url) return res.status(400).json({ error: 'URL 不能为空' });

      const { link } = acceptLinkItem(db, getQueue(), {
        userId: req.userId,
        url,
        title,
        comment,
        tagIds: tag_ids,
        importedAt: imported_at || new Date().toISOString(),
      });
      return res.json(link);
    },

    createText(req, res) {
      const { title, content, comment, tag_ids, imported_at } = req.body;
      if (!content && !title) return res.status(400).json({ error: '标题或内容不能为空' });

      const { link } = createTextItem(db, {
        userId: req.userId,
        title,
        content,
        comment,
        tagIds: tag_ids,
        importedAt: imported_at || new Date().toISOString(),
        indexLink,
      });
      return res.json(link);
    },

    uploadImage(req, res) {
      if (!req.file) return res.status(400).json({ error: '请上传图片' });

      const asset = normalizeUploadedAsset(req.file, { uploadsDir });
      const { comment, imported_at, title } = req.body;
      const parsedTags = parseMultipartTags(req, res);
      if (parsedTags === null) return;

      const { link } = acceptImageItem(db, getQueue(), {
        userId: req.userId,
        imagePath: asset.publicPath,
        diskPath: asset.diskPath,
        originalName: asset.originalName,
        title,
        comment,
        tagIds: parsedTags,
        importedAt: imported_at || new Date().toISOString(),
      });
      return res.json(link);
    },

    uploadAudio(req, res) {
      if (!req.file) return res.status(400).json({ error: '请上传录音' });

      const asset = normalizeUploadedAsset(req.file, { uploadsDir });
      const { comment, imported_at, title } = req.body;
      const parsedTags = parseMultipartTags(req, res);
      if (parsedTags === null) return;

      const { link } = createAudioItem(db, {
        userId: req.userId,
        audioPath: asset.publicPath,
        title,
        comment,
        tagIds: parsedTags,
        importedAt: imported_at || new Date().toISOString(),
      });
      return res.json(link);
    },

    uploadFile(req, res) {
      if (!req.file) return res.status(400).json({ error: '请上传文件' });

      const asset = normalizeUploadedAsset(req.file, { uploadsDir });
      const { comment, imported_at, title } = req.body;
      const parsedTags = parseMultipartTags(req, res);
      if (parsedTags === null) return;

      const { link } = acceptFileItem(db, getQueue(), {
        userId: req.userId,
        filePath: asset.publicPath,
        diskPath: asset.diskPath,
        originalName: asset.originalName,
        sizeBytes: asset.sizeBytes,
        title,
        comment,
        tagIds: parsedTags,
        importedAt: imported_at || new Date().toISOString(),
      });
      return res.json(link);
    },

    async summarize(req, res) {
      try {
        const { link } = await summarizeLinkItem(db, {
          linkId: req.params.id,
          userId: req.userId,
        });
        res.json(link);
      } catch (err) {
        console.error('Summarize failed:', err.message);
        jsonError(res, err, '摘要失败');
      }
    },

    async extract(req, res) {
      try {
        const result = await extractLinkContent(db, {
          linkId: req.params.id,
          userId: req.userId,
        });
        res.json(result);
      } catch (err) {
        console.error('Extract failed:', err.message);
        jsonError(res, err, '提取失败');
      }
    },

    retryProcessing(req, res) {
      try {
        const { link, retried } = retryItemProcessing(db, getQueue(), {
          linkId: req.params.id,
          userId: req.userId,
        });
        return res.json({ ...link, retried });
      } catch (err) {
        return jsonError(res, err, '重试失败');
      }
    },

    update(req, res) {
      const { title, comment, content, tag_ids, imported_at } = req.body;
      try {
        const { link } = updateLinkItem(db, {
          linkId: req.params.id,
          userId: req.userId,
          title,
          comment,
          content,
          importedAt: imported_at,
          tagIds: tag_ids,
        });
        res.json(link);
      } catch (err) {
        jsonError(res, err, '更新失败');
      }
    },

    delete(req, res) {
      try {
        res.json(deleteLinkItem(db, {
          linkId: req.params.id,
          userId: req.userId,
          removeIndex,
        }));
      } catch (err) {
        jsonError(res, err, '删除失败');
      }
    },

    importLinks(req, res) {
      const { links } = req.body;
      if (!Array.isArray(links)) return res.status(400).json({ error: '请提供链接数组' });

      const { imported } = acceptImportedLinkItems(db, getQueue(), {
        userId: req.userId,
        items: links,
      });
      return res.json({ imported });
    },

    exportSummaries(req, res) {
      const ids = req.query.ids ? req.query.ids.split(',').map(Number).filter(Boolean) : null;
      const { markdown, filename } = exportSummariesMarkdown(db, {
        userId: req.userId,
        ids,
      });

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(markdown);
    },

    exportAll(req, res) {
      res.json(exportAllData(db, { userId: req.userId }));
    },

    async learningNote(req, res) {
      try {
        const result = await generateLinkLearningNote(db, {
          linkId: req.params.id,
          userId: req.userId,
          refresh: Boolean(req.query.refresh),
        });
        res.json(result);
      } catch (e) {
        console.error('learning-note error:', e.message);
        jsonError(res, e, '生成失败');
      }
    },

    getDocument(req, res) {
      try {
        res.json(getDocumentInspection(db, {
          itemId: req.params.id,
          userId: req.userId,
        }));
      } catch (err) {
        jsonError(res, err, '读取文档失败');
      }
    },

    reindexDocument(req, res) {
      try {
        res.json(reindexDocumentInspection(db, {
          itemId: req.params.id,
          userId: req.userId,
        }));
      } catch (err) {
        jsonError(res, err, '重建文档失败');
      }
    },

    rechunkDocument(req, res) {
      try {
        res.json(rechunkDocumentInspection(db, {
          itemId: req.params.id,
          userId: req.userId,
        }));
      } catch (err) {
        jsonError(res, err, '重切文档失败');
      }
    },

    annotateDocument(req, res) {
      try {
        res.json(annotateDocumentInspection(db, {
          itemId: req.params.id,
          userId: req.userId,
        }));
      } catch (err) {
        jsonError(res, err, '生成文档标注失败');
      }
    },
  };
}
