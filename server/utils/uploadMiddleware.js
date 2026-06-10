import multer from 'multer';
import { randomBytes } from 'crypto';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, '../uploads');

export function createUploadFilename(originalName, id = randomBytes(8).toString('hex')) {
  return `${id}${extname(originalName || '')}`;
}

export function isImageMime(mimetype = '') {
  return mimetype.startsWith('image/');
}

export function isAudioMime(mimetype = '') {
  return mimetype.startsWith('audio/') || mimetype === 'application/octet-stream';
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, createUploadFilename(file.originalname));
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isImageMime(file.mimetype)) cb(null, true);
    else cb(new Error('只支持图片文件'));
  },
});

export const uploadAudio = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAudioMime(file.mimetype)) cb(null, true);
    else cb(new Error('只支持音频文件'));
  },
});

export const uploadFile = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});
