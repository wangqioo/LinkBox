import type { HealthCheckStatus, SystemHealthCheck } from '../api/client';

type Tone = 'ok' | 'warn' | 'fail' | 'unknown';

export interface OverallHealthDescription {
  label: string;
  tone: Tone;
  description: string;
}

export interface HealthCheckDescription {
  key: string;
  title: string;
  status: HealthCheckStatus;
  label: string;
  detail: string;
}

const CHECK_TITLES: Record<string, string> = {
  sqlite: 'SQLite',
  uploads: 'Uploads',
  queue: 'Queue',
  ai: 'AI Endpoint',
  pdftotext: 'pdftotext',
  libreoffice: 'LibreOffice',
};

const CHECK_ORDER = ['sqlite', 'uploads', 'queue', 'ai', 'pdftotext', 'libreoffice'];

export function describeOverallHealth(status?: string): OverallHealthDescription {
  if (status === 'healthy') {
    return {
      label: '健康',
      tone: 'ok',
      description: '核心服务和可选能力都可用。',
    };
  }
  if (status === 'degraded') {
    return {
      label: '降级',
      tone: 'warn',
      description: '核心服务可用，但部分 AI 或文档处理能力不可用。',
    };
  }
  if (status === 'unhealthy') {
    return {
      label: '异常',
      tone: 'fail',
      description: '核心依赖不可用，需要处理后再继续使用。',
    };
  }
  return {
    label: '未知',
    tone: 'unknown',
    description: '尚未加载系统健康状态。',
  };
}

export function describeHealthCheck(key: string, check: SystemHealthCheck): HealthCheckDescription {
  const title = CHECK_TITLES[key] || key;
  const label = check.status === 'ok' ? '正常' : check.status === 'warn' ? '降级' : '失败';
  return {
    key,
    title,
    status: check.status,
    label,
    detail: detailForCheck(title, check),
  };
}

export function healthChecksForDisplay(checks: Record<string, SystemHealthCheck> = {}) {
  return CHECK_ORDER
    .filter(key => checks[key])
    .map(key => describeHealthCheck(key, checks[key]));
}

function detailForCheck(title: string, check: SystemHealthCheck) {
  if (check.message) return check.message;
  if (check.version) return check.version;
  if (check.path) return check.path;
  if (check.url) return check.url;
  if (check.status === 'ok') return `${title} 可用`;
  return `${title} 当前不可用`;
}
