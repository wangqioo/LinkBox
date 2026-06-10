import { join } from 'path';
import { indexLinkContent, removeLinkContentIndex } from './chunkIndex.js';
import { getRuntimeQueue } from './runtimeQueue.js';
import {
  enqueueFileProcessing,
  enqueueImageProcessing,
  enqueueLinkProcessing,
} from './processingJobs.js';
import { decodeUploadName, parseTagIds } from './linkPayloads.js';
import { getItemById, getItemForUser, listItemsForUser } from './itemRepository.js';
import {
  createAudioItem,
  createFileItem,
  createImageItem,
  createLinkItem,
  createTextItem,
  importLinkItems,
} from './linkCreateService.js';
import {
  extractLinkContent,
  generateLinkLearningNote,
  summarizeLinkItem,
} from './linkAiActions.js';
import { deleteLinkItem, updateLinkItem } from './linkMutationService.js';
import { exportAllData, exportSummariesMarkdown } from './linkExportService.js';
import { UPLOADS_DIR } from './uploadMiddleware.js';

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

      const { link, processing } = createLinkItem(db, {
        userId: req.userId,
        url,
        title,
        comment,
        tagIds: tag_ids,
        importedAt: imported_at || new Date().toISOString(),
      });
      res.json(link);

      enqueueLinkProcessing(getQueue(), processing);
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

      const imagePath = `/uploads/${req.file.filename}`;
      const diskPath = join(uploadsDir, req.file.filename);
      const { comment, imported_at, title } = req.body;
      const parsedTags = parseMultipartTags(req, res);
      if (parsedTags === null) return;

      const { link, processing } = createImageItem(db, {
        userId: req.userId,
        imagePath,
        diskPath,
        originalName: decodeUploadName(req.file.originalname),
        title,
        comment,
        tagIds: parsedTags,
        importedAt: imported_at || new Date().toISOString(),
      });
      res.json(link);

      enqueueImageProcessing(getQueue(), processing);
    },

    uploadAudio(req, res) {
      if (!req.file) return res.status(400).json({ error: '请上传录音' });

      const audioPath = `/uploads/${req.file.filename}`;
      const { comment, imported_at, title } = req.body;
      const parsedTags = parseMultipartTags(req, res);
      if (parsedTags === null) return;

      const { link } = createAudioItem(db, {
        userId: req.userId,
        audioPath,
        title,
        comment,
        tagIds: parsedTags,
        importedAt: imported_at || new Date().toISOString(),
      });
      return res.json(link);
    },

    uploadFile(req, res) {
      if (!req.file) return res.status(400).json({ error: '请上传文件' });

      const filePath = `/uploads/${req.file.filename}`;
      const { comment, imported_at, title } = req.body;
      const parsedTags = parseMultipartTags(req, res);
      if (parsedTags === null) return;

      const originalName = decodeUploadName(req.file.originalname);
      const diskPath = join(uploadsDir, req.file.filename);

      const { link, processing } = createFileItem(db, {
        userId: req.userId,
        filePath,
        diskPath,
        originalName,
        sizeBytes: req.file.size,
        title,
        comment,
        tagIds: parsedTags,
        importedAt: imported_at || new Date().toISOString(),
      });
      res.json(link);

      if (processing) enqueueFileProcessing(getQueue(), processing);
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
        res.status(err.status || 500).json({ error: err.status ? err.message : `摘要失败: ${err.message}` });
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
        res.status(err.status || 500).json({ error: err.status ? err.message : `提取失败: ${err.message}` });
      }
    },

    retryProcessing(req, res) {
      const link = getItemForUser(db, { linkId: req.params.id, userId: req.userId });
      if (!link) return res.status(404).json({ error: '不存在' });

      const queue = getQueue();
      const retried = queue.retryFailedJobsForLink(link.id);
      if (!retried) {
        return res.status(409).json({ error: '没有可重试的失败任务' });
      }

      db.prepare('UPDATE links SET status = ? WHERE id = ?').run('processing', link.id);
      queue.drain();

      return res.json({ ...getItemById(db, link.id), retried });
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
        res.status(err.status || 500).json({ error: err.status ? err.message : `更新失败: ${err.message}` });
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
        res.status(err.status || 500).json({ error: err.status ? err.message : `删除失败: ${err.message}` });
      }
    },

    importLinks(req, res) {
      const { links } = req.body;
      if (!Array.isArray(links)) return res.status(400).json({ error: '请提供链接数组' });

      const { imported, toFetch } = importLinkItems(db, {
        userId: req.userId,
        items: links,
      });
      res.json({ imported });

      for (const { id, url, title } of toFetch) {
        enqueueLinkProcessing(getQueue(), { linkId: id, url, title });
      }
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
        res.status(e.status || 500).json({ error: e.status ? e.message : `生成失败: ${e.message}` });
      }
    },
  };
}
