import { useEffect, useState } from 'react';
import type { WorkspaceOpenResult } from '../../../shared/types.js';
import type { PublicS3Settings, S3Config } from '../../../shared/sync.js';

const defaults: S3Config = { endpoint: '', region: 'us-east-1', bucket: '', prefix: 'mindmap-ai', forcePathStyle: false };

export function S3SyncDialog({ workspaceName, onBeforeTransfer, onDownloaded, onClose }: { workspaceName?: string; onBeforeTransfer(): Promise<void>; onDownloaded(result: WorkspaceOpenResult): void; onClose(): void }): React.JSX.Element {
  const [config, setConfig] = useState<S3Config>(defaults); const [saved, setSaved] = useState<PublicS3Settings | null>(null);
  const [accessKeyId, setAccessKeyId] = useState(''); const [secretAccessKey, setSecretAccessKey] = useState(''); const [sessionToken, setSessionToken] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    void window.mindmapAI.sync.getSettings().then((value) => { if (mounted) { setSaved(value); setConfig({ endpoint: value.endpoint, region: value.region, bucket: value.bucket, prefix: value.prefix, forcePathStyle: value.forcePathStyle }); } }).catch((cause: unknown) => { if (mounted) { setError(true); setMessage(cause instanceof Error ? cause.message : '读取 S3 配置失败'); } });
    return () => { mounted = false; };
  }, []);
  const dirty = !saved || JSON.stringify(config) !== JSON.stringify({ endpoint: saved.endpoint, region: saved.region, bucket: saved.bucket, prefix: saved.prefix, forcePathStyle: saved.forcePathStyle }) || !!accessKeyId || !!secretAccessKey || !!sessionToken;
  const run = async (operation: () => Promise<string | void>): Promise<void> => {
    setBusy(true); setError(false); setMessage('');
    try { const text = await operation(); if (text) setMessage(text); }
    catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : 'S3 操作失败'); }
    finally { setBusy(false); }
  };
  const save = (): Promise<void> => run(async () => {
    if (!!accessKeyId.trim() !== !!secretAccessKey.trim()) throw new Error('Access Key 和 Secret Key 需要同时填写');
    const value = await window.mindmapAI.sync.saveSettings({ config, ...(accessKeyId.trim() && secretAccessKey.trim() ? { credentials: { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), ...(sessionToken.trim() ? { sessionToken: sessionToken.trim() } : {}) } } : {}) });
    setSaved(value); setConfig({ endpoint: value.endpoint, region: value.region, bucket: value.bucket, prefix: value.prefix, forcePathStyle: value.forcePathStyle }); setAccessKeyId(''); setSecretAccessKey(''); setSessionToken('');
    return 'S3 配置已保存，凭据已由系统加密';
  });
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="s3-sync-dialog" role="dialog" aria-modal="true" aria-label="S3 同步" onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && !busy) onClose(); }}>
      <header><h2>S3 同步</h2><button disabled={busy} aria-label="关闭 S3 同步" onClick={onClose}>×</button></header>
      <p>手动上传当前工作区，或将云端版本下载到空文件夹。每个工作区请使用独立的同步目录，两台设备使用相同配置。</p>
      <fieldset disabled={busy}>
        <label>S3 服务地址<input aria-label="S3 服务地址" placeholder="留空使用 AWS；兼容服务填写 HTTPS 地址" value={config.endpoint} maxLength={2048} onChange={(event) => setConfig({ ...config, endpoint: event.target.value })} /></label>
        <div className="s3-form-row"><label>区域<input aria-label="S3 区域" value={config.region} maxLength={64} onChange={(event) => setConfig({ ...config, region: event.target.value })} /></label><label>存储桶<input aria-label="S3 存储桶" value={config.bucket} maxLength={63} onChange={(event) => setConfig({ ...config, bucket: event.target.value })} /></label></div>
        <label>同步目录<input aria-label="S3 同步目录" value={config.prefix} maxLength={256} onChange={(event) => setConfig({ ...config, prefix: event.target.value })} /></label>
        <label className="s3-path-style"><input type="checkbox" checked={config.forcePathStyle} onChange={(event) => setConfig({ ...config, forcePathStyle: event.target.checked })} />使用路径形式寻址（MinIO 等兼容服务）</label>
        <div className="s3-form-row"><label>Access Key<input aria-label="S3 Access Key" type="password" autoComplete="off" placeholder={saved?.hasCredentials ? '已保存；留空保持' : 'Access Key ID'} value={accessKeyId} maxLength={256} onChange={(event) => setAccessKeyId(event.target.value)} /></label><label>Secret Key<input aria-label="S3 Secret Key" type="password" autoComplete="off" placeholder={saved?.hasCredentials ? '已保存；留空保持' : 'Secret Access Key'} value={secretAccessKey} maxLength={1024} onChange={(event) => setSecretAccessKey(event.target.value)} /></label></div>
        <label>Session Token（可选）<input aria-label="S3 Session Token" type="password" autoComplete="off" value={sessionToken} maxLength={4096} onChange={(event) => setSessionToken(event.target.value)} /></label>
        <div className="s3-config-actions"><button onClick={() => void save()}>保存 S3 配置</button><button disabled={!saved?.hasCredentials || dirty} onClick={() => void run(() => window.mindmapAI.sync.testConnection())}>测试连接</button><button onClick={() => void run(async () => { await window.mindmapAI.sync.clearSettings(); setSaved(null); setAccessKeyId(''); setSecretAccessKey(''); setSessionToken(''); return '本机 S3 配置和凭据已清除'; })}>清除本机配置</button></div>
      </fieldset>
      <p className="s3-data-note">包含所有项目、Markdown 文档、概念／答疑及垃圾箱。API 密钥、S3 凭据和网页登录信息不会上传。仅同步工作区的数据文件，单次快照最多 128 MB。</p>
      <div className="s3-status" role={error ? 'alert' : 'status'}>{busy ? '正在处理，请稍候…' : message || (dirty ? '修改配置后请先保存。' : '配置已就绪。')}</div>
      <footer><button disabled={busy || !workspaceName || !saved?.hasCredentials || dirty} onClick={() => void run(async () => { await onBeforeTransfer(); const result = await window.mindmapAI.sync.upload(); return `${result.message} · ${(result.bytes / 1024 / 1024).toFixed(2)} MB`; })}>上传当前工作区</button><button disabled={busy || !saved?.hasCredentials || dirty} onClick={() => void run(async () => { await onBeforeTransfer(); const result = await window.mindmapAI.sync.download(); if (result) onDownloaded(result); else return '已取消下载'; })}>下载云端工作区</button></footer>
    </section>
  </div>;
}
