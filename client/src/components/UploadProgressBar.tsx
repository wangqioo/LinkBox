import type { UploadProgress } from '../api/client';
import { formatSize, formatSpeed } from './addLinkModalUtils';

interface Props {
  progress: UploadProgress;
}

export default function UploadProgressBar({ progress }: Props) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{formatSize(progress.loaded)} / {formatSize(progress.total)}</span>
        <span>{formatSpeed(progress.speed)}</span>
      </div>
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full transition-all duration-300"
          style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="text-xs text-center text-gray-400">{progress.percent}%</p>
    </div>
  );
}
