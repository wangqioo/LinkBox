import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { handleImageProxyRequest } from '../utils/imageProxyService.js';
import { createItemController } from '../utils/itemController.js';
import { uploadAudio, uploadFile, uploadImage } from '../utils/uploadMiddleware.js';

const router = Router();
const controller = createItemController({ db });

// Public image proxy for card thumbnails. Keep this before authMiddleware.
router.get('/image-proxy', handleImageProxyRequest);

router.use(authMiddleware);

router.get('/', controller.list);
router.get('/:id', controller.get);
router.post('/', controller.createLink);
router.post('/text', controller.createText);
router.post('/image', uploadImage.single('image'), controller.uploadImage);
router.post('/audio', uploadAudio.single('audio'), controller.uploadAudio);
router.post('/file', uploadFile.single('file'), controller.uploadFile);
router.post('/:id/summarize', controller.summarize);
router.post('/:id/extract', controller.extract);
router.post('/:id/retry-processing', controller.retryProcessing);
router.put('/:id', controller.update);
router.delete('/:id', controller.delete);
router.post('/import', controller.importLinks);
router.get('/export/summaries', controller.exportSummaries);
router.get('/export/all', controller.exportAll);
router.post('/:id/learning-note', controller.learningNote);

export default router;
